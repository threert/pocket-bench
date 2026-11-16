// WS1850S contactless reader (Unit RFID 2), register compatible with the NXP
// MFRC522 (datasheet rev. 3.9, section 9). On I2C the byte after the address
// selects a register and every further byte of the transfer goes to, or comes
// from, that same register, so one write fills the FIFO with a frame.
//
// Modelled: the 64-byte FIFO, the commands Idle, CalcCRC, Transmit,
// Transceive, MFAuthent and SoftReset, ComIrqReg / DivIrqReg with their
// set-and-clear writes, ErrorReg, the CRC coprocessor with ModeReg's preset,
// TxCRCEn / RxCRCEn, the timer started by a transmission (TAuto) with
// TPrescaler and TReload, the antenna drivers of TxControlReg, Crypto1's
// MFCrypto1On, RxLastBits, and frame times at 106 kbit/s. The card in the
// field is a Picc (picc.ts); a card needs 5 ms of field before it listens.
// Reset values are the MFRC522's; VersionReg reads 0x15, the value M5Stack's
// library reads from the part (M5Unit-RFID, unit_WS1850S.cpp).
import type { I2CChip } from "../sim/i2c.ts";
import { crcA, crcStep, type Answer, type Picc } from "./picc.ts";

const R = {
  command: 0x01, comIrq: 0x04, divIrq: 0x05, error: 0x06, status1: 0x07, status2: 0x08, fifoData: 0x09, fifoLevel: 0x0a,
  waterLevel: 0x0b, control: 0x0c, bitFraming: 0x0d, coll: 0x0e, mode: 0x11, txMode: 0x12, rxMode: 0x13, txControl: 0x14,
  crcHigh: 0x21, crcLow: 0x22, tMode: 0x2a, tPrescaler: 0x2b, tReloadHigh: 0x2c, tReloadLow: 0x2d, version: 0x37,
} as const;
const Cmd = { idle: 0x0, calcCrc: 0x3, transmit: 0x4, receive: 0x8, transceive: 0xc, authent: 0xe, softReset: 0xf } as const;
const Irq = { tx: 0x40, rx: 0x20, idle: 0x10, error: 0x02, timer: 0x01 } as const;
const Err = { bufferOverflow: 0x10, crc: 0x04, protocol: 0x01 } as const;
const DEFAULTS: Record<number, number> = {
  0x01: 0x20, 0x02: 0x80, 0x0b: 0x08, 0x0c: 0x10, 0x0e: 0x80, 0x11: 0x3f, 0x14: 0x80, 0x16: 0x10, 0x17: 0x84, 0x18: 0x84,
  0x19: 0x4d, 0x1c: 0x62, 0x1f: 0xeb, 0x24: 0x26, 0x26: 0x48, 0x27: 0x88, 0x28: 0x20, 0x29: 0x20,
};
/** One bit at 106 kbit/s, microseconds. */
const BIT = 9.44;
/** The card answers 86 to 91 us after the reader's last bit. */
const FRAME_DELAY = 87;
/** The field a card needs before it listens (ISO/IEC 14443-3: at most 5 ms). */
const CARD_STARTUP = 5_000;
const VERSION = 0x15;

export class Ws1850s implements I2CChip {
  readonly name = "WS1850S";
  private card: Picc | undefined;
  private cardSince = 0;
  private readonly reg = new Uint8Array(64);
  private pointer = 0;
  private fifo: number[] = [];
  private command = 0;
  private comIrq = 0x14;
  private divIrq = 0;
  private error = 0;
  private crypto = false;
  private rxLastBits = 0;
  private crc = 0xffff;
  private crcReady = false;
  /** When the antenna drivers were switched on; Infinity while they are off. */
  private fieldSince = Infinity;
  private busyUntil = 0;
  /** What is still to happen on the air: ends of frames, the timer. */
  private events: { at: number; run: () => void }[] = [];
  constructor(readonly address = 0x28) {}

  /** Puts a card over the antenna, or takes it away. */
  place(card: Picc | undefined, now: number): void {
    this.advance(now);
    this.card = card;
    this.cardSince = now;
    card?.powerOn();
  }
  get field(): boolean { return this.fieldSince !== Infinity; }

  reset(now: number): void {
    this.reg.fill(0);
    for (const [register, value] of Object.entries(DEFAULTS)) this.reg[Number(register)] = value;
    this.fifo = []; this.events = []; this.command = Cmd.idle;
    this.comIrq = 0x14; this.divIrq = 0; this.error = 0; this.crypto = false; this.rxLastBits = 0;
    this.crc = 0xffff; this.crcReady = false; this.pointer = 0;
    this.setField(false, now);
    // The oscillator starts: CommandReg shows PowerDown until the part is ready.
    this.busyUntil = now + 1_000;
  }

  private setField(on: boolean, now: number): void {
    if (on === this.field) return;
    this.fieldSince = on ? now : Infinity;
    this.card?.powerOn();
  }
  private listening(now: number): boolean {
    return !!this.card && now >= Math.max(this.fieldSince, this.cardSince) + CARD_STARTUP;
  }
  private schedule(at: number, run: () => void): void {
    let index = this.events.length;
    while (index > 0 && this.events[index - 1]!.at > at) --index;
    this.events.splice(index, 0, { at, run });
  }
  private advance(now: number): void {
    while (this.events.length && this.events[0]!.at <= now) this.events.shift()!.run();
  }
  /** The period of the timer: 13.56 MHz / (2 * TPrescaler + 1), TReload + 1 ticks. */
  private timerMicros(): number {
    const prescaler = ((this.reg[R.tMode]! & 0x0f) << 8) | this.reg[R.tPrescaler]!;
    const reload = (this.reg[R.tReloadHigh]! << 8) | this.reg[R.tReloadLow]!;
    return Math.round((prescaler * 2 + 1) * (reload + 1) / 13.56);
  }

  // ----- commands -----

  private start(value: number, now: number): void {
    const command = value & 0x0f;
    if (command === Cmd.softReset) { this.reset(now); return; }
    this.reg[R.command] = value & 0x30;
    // A new command ends the one in progress and what it was waiting for.
    this.events = [];
    this.command = command;
    if (command === Cmd.calcCrc) {
      this.crc = [0x0000, 0x6363, 0xa671, 0xffff][this.reg[R.mode]! & 3]!;
      for (const byte of this.fifo.splice(0)) this.crc = crcStep(this.crc, byte);
      this.crcReady = true;
      this.divIrq |= 0x04;
    } else if (command === Cmd.transmit) {
      this.transmit(now, false);
    } else if (command === Cmd.authent) {
      this.authenticate(now);
    }
  }

  /** Sends the FIFO as one frame and, for Transceive, waits for the card. */
  private transmit(now: number, receive: boolean): void {
    let frame = this.fifo.splice(0);
    if (!frame.length) return;
    this.error &= Err.bufferOverflow;
    const lastBits = this.reg[R.bitFraming]! & 0x07;
    if ((this.reg[R.txMode]! & 0x80) && !lastBits) frame = [...frame, ...crcA(frame)];
    // Start bit, nine bits a byte with its parity (a short frame has none), end of frame.
    const bits = lastBits ? (frame.length - 1) * 9 + lastBits + 2 : frame.length * 9 + 2;
    const sent = now + Math.ceil(bits * BIT);
    const answer = this.field && this.listening(now) ? this.card!.frame(Uint8Array.from(frame), lastBits, this.crypto) : undefined;
    this.schedule(sent, () => {
      this.comIrq |= Irq.tx;
      if (!receive) { this.comIrq |= Irq.idle; this.command = Cmd.idle; }
    });
    if (!receive) return;
    if (answer) {
      const length = answer.bits ?? answer.data.length * 9;
      this.schedule(sent + FRAME_DELAY + Math.ceil((length + 2) * BIT), () => this.received(answer));
    } else if (this.reg[R.tMode]! & 0x80) {
      this.schedule(sent + this.timerMicros(), () => { this.comIrq |= Irq.timer; });
    }
  }
  private received(answer: Answer): void {
    let data = answer.data;
    if ((this.reg[R.rxMode]! & 0x80) && !answer.bits) {
      // RxCRCEn: the receiver checks the CRC and keeps it out of the FIFO.
      const body = data.slice(0, -2), [lo, hi] = crcA(body);
      if (data.length < 3 || data[data.length - 2] !== lo || data[data.length - 1] !== hi) this.error |= Err.crc;
      data = body;
    }
    for (const byte of data) {
      if (this.fifo.length < 64) this.fifo.push(byte); else this.error |= Err.bufferOverflow;
    }
    this.rxLastBits = answer.bits ?? 0;
    this.comIrq |= Irq.rx | (this.error ? Irq.error : 0);
  }
  /** MFAuthent: command, block, six key bytes and four UID bytes from the
   *  FIFO. The three passes with the card take about 3 ms; without the right
   *  answer the command waits, and the timer is what ends the wait. */
  private authenticate(now: number): void {
    const data = this.fifo.splice(0, 12);
    const present = this.field && this.listening(now);
    const granted = present && data.length === 12 &&
      this.card!.authenticate(data[0]!, data[1]!, data.slice(2, 8), data.slice(8, 12), this.crypto);
    this.crypto = false;
    if (granted) {
      this.schedule(now + 3_200, () => { this.crypto = true; this.comIrq |= Irq.idle; this.command = Cmd.idle; });
    } else if (this.reg[R.tMode]! & 0x80) {
      this.schedule(now + 1_100 + this.timerMicros(), () => {
        if (present) { this.error |= Err.protocol; this.comIrq |= Irq.error; }
        this.comIrq |= Irq.timer;
      });
    }
  }

  // ----- registers -----

  private store(register: number, value: number, now: number): void {
    switch (register) {
      case R.command: this.start(value, now); return;
      // Bit 7 chooses whether the marked bits are set or cleared.
      case R.comIrq: this.comIrq = value & 0x80 ? this.comIrq | (value & 0x7f) : this.comIrq & ~value; return;
      case R.divIrq: this.divIrq = value & 0x80 ? this.divIrq | (value & 0x14) : this.divIrq & ~value; return;
      case R.error: case R.status1: case R.crcHigh: case R.crcLow: case R.version: return;
      case R.status2:
        // Software can only clear MFCrypto1On; a successful MFAuthent sets it.
        if (!(value & 0x08)) this.crypto = false;
        this.reg[register] = value & 0xc0;
        return;
      case R.fifoData:
        if (this.command === Cmd.calcCrc) this.crc = crcStep(this.crc, value);
        else if (this.fifo.length < 64) this.fifo.push(value);
        else this.error |= Err.bufferOverflow;
        return;
      case R.fifoLevel:
        if (value & 0x80) { this.fifo = []; this.error &= ~Err.bufferOverflow; }
        return;
      case R.bitFraming:
        // StartSend acts once, and only while Transceive is the command.
        this.reg[register] = value & 0x7f;
        if ((value & 0x80) && this.command === Cmd.transceive) this.transmit(now, true);
        return;
      case R.txControl:
        this.reg[register] = value;
        this.setField((value & 0x03) !== 0, now);
        return;
      default: this.reg[register] = value;
    }
  }
  private load(register: number, now: number): number {
    switch (register) {
      case R.command: return now < this.busyUntil ? 0x30 : this.reg[register]! | this.command;
      case R.comIrq: return this.comIrq;
      case R.divIrq: return this.divIrq;
      case R.error: return this.error;
      case R.status1: return (this.crc === 0 ? 0x40 : 0) | (this.crcReady ? 0x20 : 0) | (this.fifo.length <= (this.reg[R.waterLevel]! & 0x3f) ? 0x01 : 0);
      case R.status2: return this.reg[register]! | (this.crypto ? 0x08 : 0);
      case R.fifoData: return this.fifo.shift() ?? 0;
      case R.fifoLevel: return this.fifo.length;
      case R.control: return this.rxLastBits;
      // One card answers alone: there is never a collision position.
      case R.coll: return (this.reg[register]! & 0x80) | 0x20;
      case R.crcHigh: return this.crc >> 8;
      case R.crcLow: return this.crc & 0xff;
      case R.version: return VERSION;
      default: return this.reg[register]!;
    }
  }

  write(data: Uint8Array, now: number): boolean {
    this.advance(now);
    if (!data.length) return true;
    this.pointer = data[0]! & 0x3f;
    for (let i = 1; i < data.length; ++i) this.store(this.pointer, data[i]!, now);
    return true;
  }
  read(length: number, now: number): Uint8Array {
    this.advance(now);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; ++i) out[i] = this.load(this.pointer, now);
    return out;
  }
}
