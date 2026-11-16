import { expect, test } from "bun:test";
import { crcA, Picc } from "../../src/chips/picc.ts";
import { Ws1850s } from "../../src/chips/ws1850s.ts";
import { Rig, rejection, unanswered } from "./harness.ts";

interface Card { uid: number[]; kind: string; sak: number; atqa: number }
const CLASSIC = { uid: [0xde, 0xad, 0xbe, 0xef], kind: "classic1k" };
const ULTRALIGHT = { uid: [0x04, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6], kind: "ultralight" };
const ascii = (text: string) => Array.from({ length: 16 }, (_, index) => text.charCodeAt(index) || 0);

test("RFID 2: identify, a Classic card: UID, read, write, keys, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("rfid2", "identify")).toBe(false);
  const unit = rig.plug("rfid2");
  expect(unit.state(rig.now)).toEqual({ card: null, writes: 0, field: false });
  expect(await rig.call("rfid2", "identify")).toBe(true);
  expect(unit.state(rig.now).field).toBe(true);
  expect(await rig.call("rfid2", "poll")).toBeNull();
  expect(await rig.call("rfid2", "readText")).toBeNull();
  expect(await rig.call("rfid2", "writeText", "nobody")).toBe(false);

  unit.set("card", CLASSIC, rig.now);
  await rig.advance(0.01);
  expect(await rig.call<Card>("rfid2", "poll")).toEqual({ uid: CLASSIC.uid, kind: "classic1k", sak: 0x08, atqa: 0x0004 });
  // Halted after each call, the card still answers the next one.
  expect((await rig.call<Card>("rfid2", "poll")).uid).toEqual(CLASSIC.uid);
  expect(await rig.call("rfid2", "readText")).toBe("");
  expect(await rig.call("rfid2", "writeText", "Pocket Bench #1")).toBe(true);
  expect(await rig.call("rfid2", "readText")).toBe("Pocket Bench #1");
  expect(unit.state(rig.now)).toEqual({ card: { ...CLASSIC, blocks: { 4: ascii("Pocket Bench #1") } }, writes: 1, field: true });
  // Another block of another sector; block 0 holds the UID and is read-only.
  expect(await rig.call("rfid2", "writeBlock", { bytes: ascii("sector two") }, 9)).toBe(true);
  expect(await rig.call("rfid2", "readBlock", 9)).toEqual(ascii("sector two"));
  expect((await rig.call<number[]>("rfid2", "readBlock", 0)).slice(0, 5)).toEqual([0xde, 0xad, 0xbe, 0xef, 0xde ^ 0xad ^ 0xbe ^ 0xef]);
  expect((await rejection(rig.call("rfid2", "writeBlock", { bytes: ascii("x") }, 0))).message).toContain("did not take the write");
  expect(unit.state(rig.now).writes).toBe(2);

  // Taken away and held over the reader again: the same card.
  unit.set("card", null, rig.now);
  expect(await rig.call("rfid2", "poll")).toBeNull();
  unit.set("card", CLASSIC, rig.now);
  await rig.advance(0.01);
  expect(await rig.call("rfid2", "readText")).toBe("Pocket Bench #1");

  // A card whose sector 1 has another key A refuses the default one.
  const locked = { uid: [1, 2, 3, 4], kind: "classic1k", blocks: { 7: [0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xff, 0x07, 0x80, 0x69, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff], 4: ascii("secret") } };
  unit.set("card", locked, rig.now);
  await rig.advance(0.01);
  expect((await rig.call<Card>("rfid2", "poll")).uid).toEqual([1, 2, 3, 4]);
  expect((await rejection(rig.call("rfid2", "readText"))).message).toContain("refused the key");
  expect(await rig.call("rfid2", "readBlock", 8)).toEqual(ascii(""));

  rig.unplug(unit);
  await unanswered(rig, "rfid2", "poll");
});

test("RFID 2: an Ultralight card with a 7-byte UID", async () => {
  const rig = await Rig.start();
  const unit = rig.plug("rfid2", { card: { ...ULTRALIGHT, blocks: { 4: [0x74, 0x61, 0x67, 0x21] } } });
  expect(await rig.call("rfid2", "open")).toBe(true);
  expect(await rig.call<Card>("rfid2", "poll")).toEqual({ uid: ULTRALIGHT.uid, kind: "ultralight", sak: 0x00, atqa: 0x0044 });
  expect(await rig.call("rfid2", "readText")).toBe("tag!");
  // READ returns four pages; page 0 and 1 are the UID with its check bytes.
  expect((await rig.call<number[]>("rfid2", "readBlock", 0)).slice(0, 8)).toEqual([0x04, 0xa1, 0xb2, 0x88 ^ 0x04 ^ 0xa1 ^ 0xb2, 0xc3, 0xd4, 0xe5, 0xf6]);
  expect(await rig.call("rfid2", "writeText", "four pages of it")).toBe(true);
  expect(await rig.call("rfid2", "readText")).toBe("four pages of it");
  const state = unit.state(rig.now) as { card: { blocks: Record<number, number[]> }; writes: number };
  expect(state.writes).toBe(4);
  expect(state.card.blocks[7]).toEqual([0x66, 0x20, 0x69, 0x74]);
  // The UID pages do not take a write.
  expect((await rejection(rig.call("rfid2", "writeBlock", { bytes: ascii("x") }, 0))).message).toContain("did not take the write");
});

/** The reader as an Arduino MFRC522 library drives it: one register a
 *  transfer, the CRC from the coprocessor, REQA, the valid-bits count from
 *  ControlReg. Time passes with every transfer. */
class Arduino {
  now = 10_000;
  constructor(readonly chip: Ws1850s) {}
  set(register: number, ...values: number[]): void { this.chip.write(Uint8Array.of(register, ...values), this.now); this.now += 300; }
  get(register: number, count = 1): number[] { this.chip.write(Uint8Array.of(register), this.now); const out = this.chip.read(count, this.now); this.now += 300; return Array.from(out); }
  init(): void {
    this.set(0x01, 0x0f);
    this.now += 50_000;
    this.set(0x2a, 0x80); this.set(0x2b, 0xa9); this.set(0x2c, 0x03); this.set(0x2d, 0xe8);
    this.set(0x15, 0x40); this.set(0x11, 0x3d);
    this.set(0x14, this.get(0x14)[0]! | 0x03);
    this.now += 6_000;
  }
  crc(data: number[]): number[] {
    this.set(0x01, 0x00); this.set(0x05, 0x04); this.set(0x0a, this.get(0x0a)[0]! | 0x80);
    this.set(0x09, ...data); this.set(0x01, 0x03);
    for (let i = 0; !(this.get(0x05)[0]! & 0x04); ++i) if (i > 100) throw new Error("CRC timeout");
    this.set(0x01, 0x00);
    return [this.get(0x22)[0]!, this.get(0x21)[0]!];
  }
  /** PCD_CommunicateWithPICC: the answer and its valid bits, or a status. */
  exchange(command: number, wait: number, data: number[], lastBits = 0): { data: number[]; bits: number } | "timeout" | "error" {
    this.set(0x01, 0x00); this.set(0x04, 0x7f); this.set(0x0a, this.get(0x0a)[0]! | 0x80);
    this.set(0x09, ...data); this.set(0x0d, lastBits); this.set(0x01, command);
    if (command === 0x0c) this.set(0x0d, this.get(0x0d)[0]! | 0x80);
    for (let i = 0; ; ++i) {
      const irq = this.get(0x04)[0]!;
      if (irq & wait) break;
      if (irq & 0x01 || i > 200) return "timeout";
      this.now += 400;
    }
    if (this.get(0x06)[0]! & 0x13) return "error";
    const count = this.get(0x0a)[0]!;
    return { data: count ? this.get(0x09, count) : [], bits: this.get(0x0c)[0]! & 0x07 };
  }
  transceive(data: number[], lastBits = 0) { return this.exchange(0x0c, 0x30, data, lastBits); }
  withCrc(data: number[]) { return this.transceive([...data, ...this.crc(data)]); }
}

test("WS1850S as an MFRC522 library drives it: REQA, select, authenticate, read, write, halt", () => {
  const chip = new Ws1850s();
  chip.reset(0);
  const card = new Picc({ uid: [0x11, 0x22, 0x33, 0x44], kind: "classic1k", blocks: { 5: ascii("block five") } });
  chip.place(card, 0);
  const pcd = new Arduino(chip);
  expect(pcd.get(0x37)).toEqual([0x15]);
  // The antenna is off after a reset: nobody answers.
  pcd.set(0x01, 0x0f);
  pcd.now += 50_000;
  pcd.set(0x2a, 0x80); pcd.set(0x2b, 0xa9); pcd.set(0x2c, 0x03); pcd.set(0x2d, 0xe8);
  const silent = pcd.now;
  expect(pcd.transceive([0x26], 7)).toBe("timeout");
  // TPrescaler 0xA9, TReload 1000: the timer ends the wait after 25 ms.
  expect(pcd.now - silent).toBeGreaterThan(25_000);
  expect(pcd.now - silent).toBeLessThan(32_000);

  pcd.init();
  // The coprocessor's CRC_A of HLTA is 57 CD.
  expect(pcd.crc([0x50, 0x00])).toEqual([0x57, 0xcd]);
  expect(pcd.transceive([0x26], 7)).toEqual({ data: [0x04, 0x00], bits: 0 });
  const anticollision = pcd.transceive([0x93, 0x20]);
  expect(anticollision).toEqual({ data: [0x11, 0x22, 0x33, 0x44, 0x11 ^ 0x22 ^ 0x33 ^ 0x44], bits: 0 });
  const sak = pcd.withCrc([0x93, 0x70, 0x11, 0x22, 0x33, 0x44, 0x44]);
  expect(sak).toEqual({ data: [0x08, ...crcA([0x08])], bits: 0 });

  // Before the authentication a Classic card does not answer READ.
  expect(pcd.withCrc([0x30, 0x05])).toBe("timeout");
  // ... and it fell back to IDLE: wake and select it again.
  expect(pcd.transceive([0x52], 7)).toEqual({ data: [0x04, 0x00], bits: 0 });
  pcd.transceive([0x93, 0x20]);
  pcd.withCrc([0x93, 0x70, 0x11, 0x22, 0x33, 0x44, 0x44]);
  // A wrong key: the timer ends MFAuthent, MFCrypto1On stays clear.
  expect(pcd.exchange(0x0e, 0x10, [0x60, 0x05, 1, 2, 3, 4, 5, 6, 0x11, 0x22, 0x33, 0x44])).toBe("timeout");
  expect(pcd.get(0x08)[0]! & 0x08).toBe(0);
  pcd.transceive([0x52], 7); pcd.transceive([0x93, 0x20]); pcd.withCrc([0x93, 0x70, 0x11, 0x22, 0x33, 0x44, 0x44]);
  expect(pcd.exchange(0x0e, 0x10, [0x60, 0x05, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x11, 0x22, 0x33, 0x44])).toEqual({ data: [], bits: 0 });
  expect(pcd.get(0x08)[0]! & 0x08).toBe(0x08);

  const block = pcd.withCrc([0x30, 0x05]) as { data: number[] };
  expect(block.data.slice(0, 16)).toEqual(ascii("block five"));
  expect(block.data.slice(16)).toEqual(pcd.crc(block.data.slice(0, 16)));
  // The sector trailer never shows key A.
  expect((pcd.withCrc([0x30, 0x07]) as { data: number[] }).data.slice(0, 10)).toEqual([0, 0, 0, 0, 0, 0, 0xff, 0x07, 0x80, 0x69]);
  // WRITE: a 4-bit ACK after the command and after the data.
  expect(pcd.withCrc([0xa0, 0x06])).toEqual({ data: [0x0a], bits: 4 });
  expect(pcd.withCrc(ascii("written"))).toEqual({ data: [0x0a], bits: 4 });
  expect(Array.from(card.memory.subarray(96, 112))).toEqual(ascii("written"));
  expect(card.writes).toBe(1);
  // A block of another sector needs its own authentication: NAK.
  expect(pcd.withCrc([0x30, 0x08])).toEqual({ data: [0x04], bits: 4 });

  // HLTA is not answered. With Crypto1 left on, the reader's frames are
  // ciphertext to a card that is no longer in the session.
  pcd.transceive([0x52], 7);
  expect(pcd.transceive([0x52], 7)).toBe("timeout");
  pcd.set(0x08, pcd.get(0x08)[0]! & ~0x08);
  expect(pcd.transceive([0x52], 7)).toEqual({ data: [0x04, 0x00], bits: 0 });
  pcd.transceive([0x93, 0x20]); pcd.withCrc([0x93, 0x70, 0x11, 0x22, 0x33, 0x44, 0x44]);
  expect(pcd.withCrc([0x50, 0x00])).toBe("timeout");
  // A halted card ignores REQA and answers WUPA.
  expect(pcd.transceive([0x26], 7)).toBe("timeout");
  expect(pcd.transceive([0x52], 7)).toEqual({ data: [0x04, 0x00], bits: 0 });
  // Field off and on again: the card starts over in IDLE and answers REQA.
  pcd.transceive([0x93, 0x20]); pcd.withCrc([0x93, 0x70, 0x11, 0x22, 0x33, 0x44, 0x44]); pcd.withCrc([0x50, 0x00]);
  pcd.set(0x14, 0x80);
  pcd.set(0x14, 0x83);
  expect(pcd.transceive([0x26], 7)).toBe("timeout");
  pcd.now += 6_000;
  expect(pcd.transceive([0x26], 7)).toEqual({ data: [0x04, 0x00], bits: 0 });
});

test("WS1850S: an Ultralight through two cascade levels, FIFO and CRC options", () => {
  const chip = new Ws1850s();
  chip.reset(0);
  const card = new Picc({ uid: [0x04, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6], kind: "ultralight" });
  chip.place(card, 0);
  const pcd = new Arduino(chip);
  pcd.init();
  expect(pcd.transceive([0x26], 7)).toEqual({ data: [0x44, 0x00], bits: 0 });
  const first = [0x88, 0x04, 0xa1, 0xb2], firstBcc = 0x88 ^ 0x04 ^ 0xa1 ^ 0xb2;
  expect(pcd.transceive([0x93, 0x20])).toEqual({ data: [...first, firstBcc], bits: 0 });
  // The reader may name UID bytes it already knows: the card sends the rest.
  expect(pcd.transceive([0x93, 0x40, 0x88, 0x04])).toEqual({ data: [0xa1, 0xb2, firstBcc], bits: 0 });
  // SAK 0x04: the UID is not complete.
  expect(pcd.withCrc([0x93, 0x70, ...first, firstBcc])).toEqual({ data: [0x04, ...crcA([0x04])], bits: 0 });
  const second = [0xc3, 0xd4, 0xe5, 0xf6], secondBcc = 0xc3 ^ 0xd4 ^ 0xe5 ^ 0xf6;
  expect(pcd.transceive([0x95, 0x20])).toEqual({ data: [...second, secondBcc], bits: 0 });
  expect(pcd.withCrc([0x95, 0x70, ...second, secondBcc])).toEqual({ data: [0x00, ...crcA([0x00])], bits: 0 });

  // COMPATIBILITY WRITE takes 16 bytes and stores the first four.
  expect(pcd.withCrc([0xa0, 0x06])).toEqual({ data: [0x0a], bits: 4 });
  expect(pcd.withCrc([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16])).toEqual({ data: [0x0a], bits: 4 });
  expect(Array.from(card.memory.subarray(24, 32))).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
  // The one-time-programmable page only ever gains bits.
  pcd.withCrc([0xa2, 0x03, 0x0f, 0, 0, 0]);
  pcd.withCrc([0xa2, 0x03, 0xf0, 0, 0, 1]);
  expect(Array.from(card.memory.subarray(12, 16))).toEqual([0xff, 0, 0, 1]);
  expect(card.writes).toBe(3);

  // TxCRCEn and RxCRCEn: the reader appends the CRC and keeps the answer's out of the FIFO.
  pcd.set(0x12, 0x80); pcd.set(0x13, 0x80);
  expect(pcd.transceive([0xa2, 0x05, 9, 8, 7, 6])).toEqual({ data: [0x0a], bits: 4 });
  const pages = pcd.transceive([0x30, 0x04]) as { data: number[] };
  expect(pages.data).toEqual([0, 0, 0, 0, 9, 8, 7, 6, 1, 2, 3, 4, 0, 0, 0, 0]);
  // READ near the end rolls over to page 0.
  expect((pcd.transceive([0x30, 0x0f]) as { data: number[] }).data.slice(4, 7)).toEqual([0x04, 0xa1, 0xb2]);
  // A page past the end: NAK, and the card leaves the ACTIVE state.
  expect(pcd.transceive([0x30, 0x10])).toEqual({ data: [0x00], bits: 4 });
  expect(pcd.transceive([0x30, 0x04])).toBe("timeout");
  pcd.set(0x12, 0x00); pcd.set(0x13, 0x00);

  // The FIFO holds 64 bytes; one more sets BufferOvfl until it is flushed.
  pcd.set(0x01, 0x00); pcd.set(0x0a, 0x80);
  pcd.set(0x09, ...Array.from({ length: 64 }, (_, index) => index));
  expect(pcd.get(0x0a)).toEqual([64]);
  expect(pcd.get(0x06)[0]! & 0x10).toBe(0);
  pcd.set(0x09, 0xee);
  expect(pcd.get(0x06)[0]! & 0x10).toBe(0x10);
  expect(pcd.get(0x09, 3)).toEqual([0, 1, 2]);
  pcd.set(0x0a, 0x80);
  expect(pcd.get(0x0a)).toEqual([0]);
  expect(pcd.get(0x06)[0]! & 0x10).toBe(0);
});
