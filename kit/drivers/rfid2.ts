// RFID 2 (U031-B): a WS1850S reader at 0x28 (register compatible with the
// NXP MFRC522) for 13.56 MHz ISO 14443A cards within 20 mm: MIFARE Classic
// and MIFARE Ultralight / NTAG.
//
//   const rfid = await Rfid2.open(bus);
//   const card = await rfid.poll();                   // null: no card
//   if (card) console.log(card.kind, hexUid(card.uid));
//   await rfid.writeText("hello");                    // 16 characters at most
//   const text = await rfid.readText();
//
// Every call wakes the card, selects it, does its work and halts it again,
// so a card may come and go between calls. The reader only transmits,
// receives and runs Crypto1; framing, CRC_A and the card commands are here.
//
// Adapted from pocket-m5, apps/unit-swap/units/rfid2.ts and decode.ts (MIT,
// Pocket Nexus).
import { bytes, read, u8, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { found, now, type Device, type PortA } from "./bus";

const ADDRESS = 0x28;
const Reg = {
  command: 0x01, comIrq: 0x04, error: 0x06, status2: 0x08, fifoData: 0x09, fifoLevel: 0x0a,
  bitFraming: 0x0d, coll: 0x0e, mode: 0x11, txMode: 0x12, rxMode: 0x13, txControl: 0x14, txAsk: 0x15,
  modWidth: 0x24, tMode: 0x2a, tPrescaler: 0x2b, tReloadH: 0x2c, tReloadL: 0x2d, version: 0x37,
} as const;
const Pcd = { idle: 0x00, transceive: 0x0c, authent: 0x0e, softReset: 0x0f } as const;
/** ComIrqReg bits. */
const Irq = { rx: 0x20, idle: 0x10, timer: 0x01 } as const;
/** ErrorReg: BufferOvfl, ParityErr, ProtocolErr; CollErr apart. */
const FRAME_ERRORS = 0x13, COLLISION = 0x08;
const SELECT = [0x93, 0x95, 0x97] as const;
const WUPA = 0x52, READ = 0x30, WRITE_CLASSIC = 0xa0, WRITE_PAGE = 0xa2, AUTH_KEY_A = 0x60;
/** A card answers WUPA 91 us after the frame; 5 ms covers the I2C round
 *  trips. Other commands wait for the reader's 25 ms timer. */
const WUPA_WAIT = 5_000, FRAME_WAIT = 30_000;
/** Sector 1's first block on a Classic card; pages 4..7 on an Ultralight:
 *  the first 16 bytes that are free for data on both. */
export const DATA_BLOCK = 4;

export type CardKind = "ultralight" | "classic1k" | "classic4k" | "other";
export interface Card {
  /** 4, 7 or 10 bytes. */
  uid: Uint8Array;
  kind: CardKind;
  /** The select acknowledge byte the kind is read from. */
  sak: number;
  atqa: number;
}
interface Frame { data: Uint8Array; error: number }

export class Rfid2 {
  static readonly ADDRESSES = [ADDRESS];

  /** MIFARE Classic key A for readBlock / writeBlock: six bytes. A new card's is FF x 6. */
  key: readonly number[] = [0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Rfid2> {
    return found("RFID 2", Rfid2.ADDRESSES, Rfid2.identify(bus));
  }

  /** Reads the version register, resets the reader and switches the antenna
   *  on; undefined when the device at 0x28 is not one. */
  static async identify(bus: PortA): Promise<Rfid2 | undefined> {
    const device = await bus.open(ADDRESS, "RFID 2");
    try {
      const version = (await device.run([read(Reg.version, [u8])]))[0]!;
      if (version === 0x00 || version === 0xff) throw new Error("no version");
      await device.run([write(Reg.command, Pcd.softReset)]).catch(() => undefined);
      await sleep(50_000);
      for (let attempt = 0; ((await device.run([read(Reg.command, [u8])]))[0]! & 0x10) && attempt < 10; ++attempt) await sleep(5_000);
      // Timer: starts after each transmission, 25 us a tick (prescaler 0xA9),
      // 1000 ticks = 25 ms. 100 % ASK modulation, CRC preset 0x6363.
      await device.run([write(Reg.txMode, 0x00), write(Reg.rxMode, 0x00), write(Reg.modWidth, 0x26)]);
      await device.run([write(Reg.tMode, 0x80), write(Reg.tPrescaler, 0xa9), write(Reg.tReloadH, 0x03)]);
      await device.run([write(Reg.tReloadL, 0xe8), write(Reg.txAsk, 0x40), write(Reg.mode, 0x3d)]);
      const tx = (await device.run([read(Reg.txControl, [u8])]))[0]!;
      if ((tx & 0x03) !== 0x03) await device.run([write(Reg.txControl, tx | 0x03)]);
      // A card needs up to 5 ms of field before it listens.
      await sleep(6_000);
      return new Rfid2(device, version);
    } catch {
      device.close();
      return undefined;
    }
  }

  /** `version`: VersionReg, 0x15 on a WS1850S. */
  private constructor(private readonly device: Device, readonly version: number) {}

  // ---- what an app calls -----------------------------------------------------

  /** The card over the reader, or null. Rejects when the unit does not answer. */
  poll(): Promise<Card | null> {
    return this.session(async card => card);
  }

  /** 16 bytes: `block` of a Classic card (after authenticating its sector
   *  with `key`) or pages block..block+3 of an Ultralight. null: no card. */
  readBlock(block = DATA_BLOCK): Promise<Uint8Array | null> {
    return this.session(async card => {
      await this.unlock(card, block);
      const frame = [READ, block];
      const answer = await this.transceive([...frame, ...crcA(frame)]);
      if (!answer || answer.error || answer.data.length !== 18 || !crcAValid(answer.data)) throw new Error(`RFID 2: block ${block} did not read`);
      return answer.data.slice(0, 16);
    });
  }

  /** Writes 16 bytes to `block` (Classic) or pages block..block+3
   *  (Ultralight). false: no card. Do not write a Classic card's block 0 or
   *  the last block of a sector (3, 7, 11, ...): that one holds its keys. */
  async writeBlock(data: Uint8Array, block = DATA_BLOCK): Promise<boolean> {
    if (data.length !== 16) throw new RangeError("RFID 2: a block is 16 bytes");
    const done = await this.session(async card => {
      await this.unlock(card, block);
      if (card.kind === "ultralight") {
        for (let page = 0; page < 4; ++page) {
          const frame = [WRITE_PAGE, block + page, ...data.subarray(page * 4, page * 4 + 4)];
          if (!acked(await this.transceive([...frame, ...crcA(frame)]))) throw new Error(`RFID 2: page ${block + page} did not take the write`);
        }
      } else {
        // The command, a 4-bit ACK, the 16 bytes, another ACK.
        const command = [WRITE_CLASSIC, block];
        if (!acked(await this.transceive([...command, ...crcA(command)])) || !acked(await this.transceive([...data, ...crcA(data)]))) {
          throw new Error(`RFID 2: block ${block} did not take the write`);
        }
      }
      return true;
    });
    return done === true;
  }

  /** The text in a block: its ASCII characters up to the first zero byte. null: no card. */
  async readText(block = DATA_BLOCK): Promise<string | null> {
    const data = await this.readBlock(block);
    if (!data) return null;
    let text = "";
    for (const code of data) {
      if (code === 0) break;
      text += code >= 0x20 && code < 0x7f ? String.fromCharCode(code) : "?";
    }
    return text;
  }

  /** Stores up to 16 ASCII characters in a block, zero padded. false: no card. */
  writeText(text: string, block = DATA_BLOCK): Promise<boolean> {
    const data = new Uint8Array(16);
    for (let i = 0; i < Math.min(text.length, 16); ++i) {
      const code = text.charCodeAt(i);
      data[i] = code >= 0x20 && code < 0x7f ? code : 0x3f;
    }
    return this.writeBlock(data, block);
  }

  close(): void {
    this.device.close();
  }

  // ---- card session ----------------------------------------------------------

  /** Wakes and selects the card, runs `task` with it, halts it. null when no
   *  card answers. */
  private session<T>(task: (card: Card) => Promise<T>): Promise<T | null> {
    return this.device.exclusive(async () => {
      const atqa = await this.wake();
      if (atqa === undefined) return null;
      try {
        const selected = await this.select();
        if (!selected) return null;
        return await task({ uid: Uint8Array.from(selected.uid), kind: cardKind(selected.sak), sak: selected.sak, atqa });
      } finally {
        await this.halt();
      }
    });
  }

  /** A Classic card opens one sector at a time to the reader that knows its
   *  key; the reader then encrypts the traffic (Crypto1). */
  private async unlock(card: Card, block: number): Promise<void> {
    if (card.kind === "other") throw new Error(`RFID 2: a card with SAK 0x${card.sak.toString(16)} is not supported`);
    if (card.kind === "ultralight") return;
    await this.start(Pcd.authent, [AUTH_KEY_A, block, ...this.key, ...Array.from(card.uid).slice(-4)], 0);
    const finished = await this.waitIrq(Irq.idle, FRAME_WAIT);
    if (!finished || !((await this.device.run([read(Reg.status2, [u8])]))[0]! & 0x08)) {
      throw new Error(`RFID 2: the card refused the key for block ${block}`);
    }
  }

  // ---- ISO 14443A ------------------------------------------------------------

  /** WUPA wakes an idle or halted card; its ATQA, low byte first. */
  private async wake(): Promise<number | undefined> {
    const answer = await this.transceive([WUPA], 7, WUPA_WAIT);
    return answer && !answer.error && answer.data.length === 2 ? answer.data[0]! | (answer.data[1]! << 8) : undefined;
  }

  /** HLTA, which a card does not answer, and Crypto1 off. A halted card
   *  answers the next WUPA. */
  private async halt(): Promise<void> {
    const frame = [0x50, 0x00];
    await this.start(Pcd.transceive, [...frame, ...crcA(frame)], 0);
    await sleep(1_000);
    await this.device.run([write(Reg.command, Pcd.idle), write(Reg.status2, 0x00)]);
  }

  /** Anticollision and SELECT through up to three cascade levels: a level
   *  whose SAK has bit 2 set started with the cascade tag 0x88 and the UID
   *  goes on in the next. */
  private async select(): Promise<{ uid: number[]; sak: number } | undefined> {
    const uid: number[] = [];
    await this.device.run([write(Reg.coll, 0x00)]);
    for (const level of SELECT) {
      const anticollision = await this.transceive([level, 0x20]);
      if (!anticollision || anticollision.error || anticollision.data.length !== 5) return undefined;
      const [a, b, c, d, bcc] = Array.from(anticollision.data) as [number, number, number, number, number];
      if ((a ^ b ^ c ^ d) !== bcc) return undefined;
      const frame = [level, 0x70, a, b, c, d, bcc];
      const answer = await this.transceive([...frame, ...crcA(frame)]);
      if (!answer || answer.error || answer.data.length !== 3 || !crcAValid(answer.data)) return undefined;
      const sak = answer.data[0]!;
      if (sak & 0x04) {
        if (a !== 0x88) return undefined;
        uid.push(b, c, d);
        continue;
      }
      uid.push(a, b, c, d);
      return { uid, sak };
    }
    return undefined;
  }

  // ---- reader ----------------------------------------------------------------

  /** Idles the reader, clears its interrupt flags, flushes the FIFO, loads
   *  the frame and starts the command: two scripts of register writes. */
  private async start(command: number, frame: readonly number[], lastBits: number): Promise<void> {
    await this.device.run([write(Reg.command, Pcd.idle), write(Reg.comIrq, 0x7f), write(Reg.fifoLevel, 0x80)]);
    await this.device.run(command === Pcd.transceive
      ? [write(Reg.fifoData, frame), write(Reg.command, command), write(Reg.bitFraming, 0x80 | lastBits)]
      : [write(Reg.fifoData, frame), write(Reg.command, command)]);
  }

  /** Polls ComIrqReg until a bit of `mask` is set; false when the reader's
   *  timer expires or `wait` microseconds pass first. */
  private async waitIrq(mask: number, wait: number): Promise<boolean> {
    const start = now();
    for (;;) {
      const irq = (await this.device.run([read(Reg.comIrq, [u8])]))[0]!;
      if (irq & mask) return true;
      if (irq & Irq.timer || now() - start > wait) return false;
      await sleep(1_500);
    }
  }

  /** Sends one frame (`lastBits`: bits of its last byte, 0 = all eight) and
   *  reads the answer; undefined when no card answered. */
  private async transceive(frame: readonly number[], lastBits = 0, wait = FRAME_WAIT): Promise<Frame | undefined> {
    await this.start(Pcd.transceive, frame, lastBits);
    if (!(await this.waitIrq(Irq.rx | Irq.idle, wait))) return undefined;
    const error = (await this.device.run([read(Reg.error, [u8])]))[0]! & (FRAME_ERRORS | COLLISION);
    const level = (await this.device.run([read(Reg.fifoLevel, [u8])]))[0]! & 0x7f;
    const data = level ? await this.device.run([read(Reg.fifoData, [bytes(level)])]) : new Uint8Array(0);
    return { data, error };
  }
}

/** A UID as text: "04A1B2C3". */
export function hexUid(uid: Uint8Array): string {
  return Array.from(uid, value => value.toString(16).toUpperCase().padStart(2, "0")).join("");
}

/** The card family a final SAK announces (NXP AN10833). */
function cardKind(sak: number): CardKind {
  if (sak === 0x00) return "ultralight";
  if (sak === 0x08 || sak === 0x28) return "classic1k";
  if (sak === 0x18 || sak === 0x38) return "classic4k";
  return "other";
}

/** A card's 4-bit acknowledge: 0xA. */
function acked(frame: Frame | undefined): boolean {
  return !!frame && frame.data.length === 1 && (frame.data[0]! & 0x0f) === 0x0a;
}

/** CRC_A (ISO/IEC 14443-3 Annex B): initial value 0x6363, low byte first. */
function crcA(data: readonly number[] | Uint8Array): [number, number] {
  let crc = 0x6363;
  for (const value of data) {
    let ch = (value ^ crc) & 0xff;
    ch = (ch ^ (ch << 4)) & 0xff;
    crc = ((crc >> 8) ^ (ch << 8) ^ (ch << 3) ^ (ch >> 4)) & 0xffff;
  }
  return [crc & 0xff, crc >> 8];
}

function crcAValid(data: Uint8Array): boolean {
  if (data.length < 3) return false;
  const [lo, hi] = crcA(data.subarray(0, data.length - 2));
  return data[data.length - 2] === lo && data[data.length - 1] === hi;
}
