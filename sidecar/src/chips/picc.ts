// A proximity card in the reader's field: the ISO/IEC 14443-3 Type A state
// machine (IDLE, READY, ACTIVE, HALT; REQA, WUPA, anticollision and SELECT
// through the cascade levels, HLTA) and the memory commands of two cards:
//
//   classic1k   MIFARE Classic 1K: 64 blocks of 16 bytes in 16 sectors. A
//               sector reads and writes after an authentication with its key
//               A or key B (bytes 0..5 and 10..15 of the sector's last block,
//               0xFF x 6 on a new card). SAK 0x08.
//   ultralight  MIFARE Ultralight (MF0ICU1): 16 pages of 4 bytes, no keys.
//               SAK 0x00.
//
// The reader runs Crypto1 with a Classic card; the cipher itself is not
// computed here. `encrypted` states whether the reader's cipher is on, and a
// card hears only the frames whose encryption matches its own state.
export type CardKind = "classic1k" | "ultralight";
export interface CardSpec {
  /** 4 or 7 bytes. */
  uid: number[];
  kind: CardKind;
  /** Contents by block (classic1k, 16 bytes each) or page (ultralight, 4 bytes each). */
  blocks?: Record<number, number[]>;
}
/** A card's answer. `bits` is set when the last byte carries fewer than 8. */
export interface Answer { data: number[]; bits?: number }

/** CRC_A (ISO/IEC 14443-3 Annex B) from `preset`, low byte first. */
export function crcA(bytes: ArrayLike<number>, preset = 0x6363): [number, number] {
  let crc = preset;
  for (let i = 0; i < bytes.length; ++i) crc = crcStep(crc, bytes[i]!);
  return [crc & 0xff, crc >> 8];
}
export function crcStep(crc: number, value: number): number {
  let ch = (value ^ crc) & 0xff;
  ch = (ch ^ (ch << 4)) & 0xff;
  return ((crc >> 8) ^ (ch << 8) ^ (ch << 3) ^ (ch >> 4)) & 0xffff;
}
function crcValid(frame: ArrayLike<number>): boolean {
  if (frame.length < 3) return false;
  const [lo, hi] = crcA(Array.prototype.slice.call(frame, 0, frame.length - 2));
  return frame[frame.length - 2] === lo && frame[frame.length - 1] === hi;
}

const byte = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 255;

/** A card as the room describes it, or null when the value is not one. */
export function parseCard(value: unknown): CardSpec | null {
  if (!value || typeof value !== "object") return null;
  const { uid, kind, blocks } = value as Record<string, unknown>;
  if (!Array.isArray(uid) || (uid.length !== 4 && uid.length !== 7) || !uid.every(byte)) return null;
  if (kind !== "classic1k" && kind !== "ultralight") return null;
  const size = kind === "classic1k" ? 16 : 4, count = kind === "classic1k" ? 64 : 16;
  const parsed: Record<number, number[]> = {};
  if (blocks && typeof blocks === "object") {
    for (const [key, data] of Object.entries(blocks as Record<string, unknown>)) {
      const index = Number(key);
      if (Number.isInteger(index) && index >= 0 && index < count && Array.isArray(data) && data.length === size && data.every(byte)) parsed[index] = data as number[];
    }
  }
  return { uid: uid as number[], kind, blocks: parsed };
}

const ACK: Answer = { data: [0x0a], bits: 4 };

export class Picc {
  readonly memory: Uint8Array;
  /** Blocks or pages written by a reader since the card was made. */
  writes = 0;
  private readonly factory: Uint8Array;
  private readonly unit: number;
  private state: "idle" | "ready" | "active" | "halt" = "idle";
  /** Where an error returns the card to: HALT once it was halted. */
  private home: "idle" | "halt" = "idle";
  private level = 0;
  /** The authenticated sector of a Classic card, or -1. */
  private sector = -1;
  /** The block a two-part WRITE waits to fill, or -1. */
  private writing = -1;

  constructor(readonly spec: CardSpec) {
    const { uid, kind } = spec;
    const classic = kind === "classic1k";
    this.unit = classic ? 16 : 4;
    this.memory = new Uint8Array(classic ? 1024 : 64);
    if (classic) {
      // Block 0: the UID, its check byte for a 4-byte UID, SAK, ATQA, manufacturer data.
      this.memory.set(uid.length === 4 ? [...uid, uid[0]! ^ uid[1]! ^ uid[2]! ^ uid[3]!, 0x08, 0x04, 0x00] : [...uid, 0x08, 0x44, 0x00]);
      this.memory.set([0x62, 0x63, 0x64, 0x65, 0x66, 0x67], 10);
      // Sector trailers in transport configuration: key A, access bits, key B.
      for (let sector = 0; sector < 16; ++sector) {
        this.memory.set([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x07, 0x80, 0x69, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], sector * 64 + 48);
      }
    } else if (uid.length === 7) {
      this.memory.set([uid[0]!, uid[1]!, uid[2]!, 0x88 ^ uid[0]! ^ uid[1]! ^ uid[2]!, uid[3]!, uid[4]!, uid[5]!, uid[6]!,
        uid[3]! ^ uid[4]! ^ uid[5]! ^ uid[6]!, 0x48, 0x00, 0x00]);
    } else {
      this.memory.set(uid);
    }
    this.factory = this.memory.slice();
    for (const [index, data] of Object.entries(spec.blocks ?? {})) this.memory.set(data, Number(index) * this.unit);
  }

  /** The card as it is now: its blocks that differ from a new card's. */
  snapshot(): CardSpec {
    const blocks: Record<number, number[]> = {};
    for (let index = 0; index < this.memory.length / this.unit; ++index) {
      const at = index * this.unit, now = this.memory.subarray(at, at + this.unit);
      if (now.some((value, offset) => value !== this.factory[at + offset])) blocks[index] = Array.from(now);
    }
    return { uid: [...this.spec.uid], kind: this.spec.kind, blocks };
  }

  /** The field came up: the card starts in IDLE. */
  powerOn(): void { this.state = "idle"; this.home = "idle"; this.level = 0; this.sector = -1; this.writing = -1; }

  get atqa(): [number, number] { return [this.spec.uid.length === 7 ? 0x44 : 0x04, 0x00]; }
  get sak(): number { return this.spec.kind === "classic1k" ? 0x08 : 0x00; }
  get authenticated(): boolean { return this.sector >= 0; }
  /** The UID as each cascade level sends it: four bytes and their XOR. */
  private levels(): number[][] {
    const u = this.spec.uid, part = (bytes: number[]) => [...bytes, bytes[0]! ^ bytes[1]! ^ bytes[2]! ^ bytes[3]!];
    return u.length === 7 ? [part([0x88, u[0]!, u[1]!, u[2]!]), part(u.slice(3))] : [part(u)];
  }

  private fail(): undefined { this.state = this.home; this.level = 0; this.sector = -1; this.writing = -1; return undefined; }
  private nak(code: number): Answer { this.fail(); return { data: [code], bits: 4 }; }

  /** One frame from the reader. `lastBits` is the count of bits in its last
   *  byte (0 = all eight; 7 for the short frames REQA and WUPA). Undefined =
   *  the card stays silent. */
  frame(data: Uint8Array, lastBits: number, encrypted: boolean): Answer | undefined {
    if (encrypted !== this.authenticated) return this.fail();
    if (lastBits === 7 && data.length === 1) {
      const command = data[0]! & 0x7f;
      const wakes = command === 0x52 ? this.state === "idle" || this.state === "halt" : command === 0x26 && this.state === "idle";
      if (!wakes) return this.fail();
      this.state = "ready"; this.level = 0;
      return { data: this.atqa };
    }
    if (lastBits !== 0 || !data.length) return this.fail();
    if (this.state === "ready") return this.select(data);
    if (this.state === "active") return this.command(data);
    return undefined;
  }

  private select(data: Uint8Array): Answer | undefined {
    const levels = this.levels(), own = levels[this.level]!;
    if (data.length < 2 || data[0] !== 0x93 + this.level * 2) return this.fail();
    const nvb = data[1]!;
    if (nvb === 0x70) {
      if (data.length !== 9 || !crcValid(data) || own.some((value, index) => value !== data[2 + index])) return this.fail();
      const last = this.level === levels.length - 1;
      if (last) this.state = "active"; else ++this.level;
      const sak = last ? this.sak : 0x04;
      return { data: [sak, ...crcA([sak])] };
    }
    // Anticollision: the reader names the UID bits it knows; the card whose UID starts with them sends the rest.
    const known = (nvb >> 4) - 2;
    if ((nvb & 0x07) !== 0 || known < 0 || known > 4 || data.length !== 2 + known) return this.fail();
    if (own.slice(0, known).some((value, index) => value !== data[2 + index])) return this.fail();
    return { data: own.slice(known) };
  }

  private store(index: number, data: ArrayLike<number>): Answer {
    this.memory.set(Array.prototype.slice.call(data, 0, this.unit), index * this.unit);
    ++this.writes;
    return ACK;
  }

  private command(data: Uint8Array): Answer | undefined {
    const classic = this.spec.kind === "classic1k";
    if (this.writing >= 0) {
      // The second part of a WRITE: 16 bytes and their CRC.
      const index = this.writing;
      this.writing = -1;
      if (data.length !== 18 || !crcValid(data)) return this.nak(classic ? 0x05 : 0x01);
      return this.store(index, classic ? data : this.page(index, data));
    }
    if (!crcValid(data)) return this.nak(classic ? 0x05 : 0x01);
    const command = data[0]!, address = data[1]!;
    if (command === 0x50 && address === 0x00 && data.length === 4) {
      this.state = "halt"; this.home = "halt"; this.sector = -1;
      return undefined;
    }
    if (classic) {
      if (!this.authenticated) return this.fail();
      const allowed = address < 64 && (address >> 2) === this.sector;
      if (command === 0x30 && data.length === 4) {
        if (!allowed) return this.nak(0x04);
        const out = Array.from(this.memory.subarray(address * 16, address * 16 + 16));
        if ((address & 3) === 3) out.fill(0, 0, 6); // key A never reads back
        return { data: [...out, ...crcA(out)] };
      }
      if (command === 0xa0 && data.length === 4) {
        if (!allowed || address === 0) return this.nak(0x04);
        this.writing = address;
        return ACK;
      }
      return this.nak(0x04); // value-block commands are not simulated
    }
    if (command === 0x30 && data.length === 4) {
      if (address > 15) return this.nak(0x00);
      const out: number[] = [];
      for (let i = 0; i < 16; ++i) out.push(this.memory[(address * 4 + i) % 64]!); // rolls over to page 0
      return { data: [...out, ...crcA(out)] };
    }
    if (command === 0xa2 && data.length === 8) {
      if (address < 2 || address > 15) return this.nak(0x00);
      return this.store(address, this.page(address, data.subarray(2, 6)));
    }
    if (command === 0xa0 && data.length === 4) {
      if (address < 2 || address > 15) return this.nak(0x00);
      this.writing = address;
      return ACK;
    }
    return this.nak(0x00);
  }
  /** What a write leaves in an Ultralight page: lock and OTP bits only ever set. */
  private page(index: number, data: ArrayLike<number>): number[] {
    const now = this.memory.subarray(index * 4, index * 4 + 4);
    if (index === 2) return [now[0]!, now[1]!, now[2]! | data[2]!, now[3]! | data[3]!];
    if (index === 3) return [0, 1, 2, 3].map(i => now[i]! | data[i]!);
    return Array.prototype.slice.call(data, 0, 4);
  }

  /** The reader's MFAuthent with key A (0x60) or key B (0x61) for the sector
   *  of `block`. The cipher is seeded with the last four UID bytes. */
  authenticate(command: number, block: number, key: ArrayLike<number>, uid: ArrayLike<number>, encrypted: boolean): boolean {
    const own = this.spec.uid.slice(-4);
    const valid = this.spec.kind === "classic1k" && this.state === "active" && encrypted === this.authenticated &&
      (command === 0x60 || command === 0x61) && block < 64 && key.length === 6 && uid.length === 4;
    if (!valid) { this.fail(); return false; }
    const trailer = (block | 3) * 16 + (command === 0x61 ? 10 : 0);
    for (let i = 0; i < 6; ++i) if (this.memory[trailer + i] !== key[i]) { this.fail(); return false; }
    for (let i = 0; i < 4; ++i) if (own[i] !== uid[i]) { this.fail(); return false; }
    this.sector = block >> 2;
    return true;
  }
}
