import { Picc, parseCard } from "../chips/picc.ts";
import { Ws1850s } from "../chips/ws1850s.ts";
import type { UnitType } from "./unit.ts";

export const rfid2: UnitType = {
  id: "rfid2", name: "RFID 2", sku: "U031-B",
  blurb: "13.56 MHz card reader and writer",
  use: "A door badge, a toy that knows its figures, a loyalty card.",
  port: "A", addresses: [0x28], size: [48, 24, 8],
  inputs: [{ key: "card", label: "Card over the reader", unit: "", min: 0, max: 0, default: null, kind: "card" }],
  driver: "kit/drivers/rfid2.ts",
  datasheet: `RFID 2 = WS1850S (0x28) on Port A, register compatible with the NXP MFRC522; reads cards within 20 mm.
On I2C every byte of one write or read goes to the same register: write(0x09, frame) fills the FIFO, read(0x09, [bytes(n)]) empties it.
Registers: 0x01 Command (0x00 Idle, 0x03 CalcCRC, 0x0C Transceive, 0x0E MFAuthent, 0x0F SoftReset), 0x04 ComIrq (0x20 Rx, 0x10 Idle, 0x01 Timer;
  write 0x7F to clear), 0x05 DivIrq (0x04 CRC done), 0x06 Error (0x13 frame errors, 0x08 collision), 0x08 Status2 (0x08 MFCrypto1On; write 0 to end Crypto1),
  0x09 FIFOData, 0x0A FIFOLevel (write 0x80 to flush), 0x0C Control (bits 0..2: valid bits of the last received byte), 0x0D BitFraming (0x80 StartSend | bits of the last byte),
  0x11 Mode (0x3D: CRC preset 0x6363), 0x14 TxControl (bits 0..1: antenna on), 0x15 TxASK (0x40), 0x21/0x22 CRC result high/low,
  0x2A TMode (0x80: timer starts after each transmission), 0x2B TPrescaler, 0x2C/0x2D TReload, 0x37 Version (0x15 on this part).
Init: SoftReset, wait 50 ms, TMode 0x80, TPrescaler 0xA9, TReload 0x03E8 (25 ms), TxASK 0x40, Mode 0x3D, TxControl |= 0x03. A card needs 5 ms of field before it answers.
One exchange: Command = Idle, ComIrq = 0x7F, FIFOLevel = 0x80, FIFOData = frame, Command = Transceive, BitFraming = 0x80 | lastBits;
  poll ComIrq until Rx (answer in the FIFO) or Timer (no answer); read Error, FIFOLevel, then FIFOData.
ISO 14443A: WUPA 0x52 or REQA 0x26 (7 bits) -> ATQA (2 bytes). Anticollision [0x93, 0x20] -> 4 UID bytes + their XOR.
  SELECT [0x93, 0x70, 4 bytes, XOR, CRC_A] -> SAK + CRC_A. SAK bit 2 set: the UID continues (first byte was 0x88), repeat with 0x95.
  SAK 0x08 = MIFARE Classic 1K, 0x00 = MIFARE Ultralight. HLTA [0x50, 0x00, CRC_A] is not answered; a halted card answers WUPA, not REQA.
  CRC_A: initial 0x6363, low byte first (the host appends and checks it; or use CalcCRC).
Classic: MFAuthent with FIFO [0x60 (key A) or 0x61 (key B), block, 6 key bytes, last 4 UID bytes]; wait for Idle; Status2 bit 3 = success. Default key FF x 6.
  Then READ [0x30, block, CRC] -> 16 bytes + CRC; WRITE [0xA0, block, CRC] -> ACK (4 bits, 0xA), then [16 bytes, CRC] -> ACK. One authentication covers one sector (4 blocks);
  block 0 is read-only, each sector's last block holds its keys. Clear Status2 after HLTA.
Ultralight: READ [0x30, page, CRC] -> 4 pages (16 bytes) + CRC; WRITE [0xA2, page, 4 bytes, CRC] -> ACK. Pages 4..15 are user data.`,
  create() {
    const chip = new Ws1850s();
    // Every card this reader has met, by UID: a card taken away and held over
    // it again is the same card, with what was written to it.
    const met = new Map<string, { given: string; card: Picc }>();
    let card: Picc | undefined, input = "null";
    return {
      chips: [chip],
      set(key, value, now) {
        if (key !== "card") return;
        const spec = parseCard(value), given = JSON.stringify(spec);
        // The room repeats the card it holds: only a change is a new placement.
        if (given === input) return;
        input = given;
        card = undefined;
        if (spec) {
          const id = `${spec.kind}:${spec.uid.join(".")}`, known = met.get(id);
          card = known?.given === given ? known.card : new Picc(spec);
          met.set(id, { given, card });
        }
        chip.place(card, now);
      },
      state() {
        let writes = 0;
        for (const { card: each } of met.values()) writes += each.writes;
        return { card: card ? card.snapshot() : null, writes, field: chip.field };
      },
    };
  },
};
