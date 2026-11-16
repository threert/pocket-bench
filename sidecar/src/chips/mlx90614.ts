// Melexis MLX90614 infrared thermometer (Unit NCIR). It speaks SMBus: a read
// is the command byte, a repeated START, then the word low byte first and a
// PEC (CRC-8, polynomial 0x07) over the address bytes, the command and the
// data. A STOP between the command and the read ends the transaction.
//
//   0x00 | n  RAM:    0x06 ambient TA, 0x07 object TOBJ1 (0x08 TOBJ2 on dual-zone parts)
//   0x20 | n  EEPROM: 0x24 emissivity (0xFFFF = 1.0), 0x2E SMBus address, 0x3C..0x3F ID
//   0xF0      flags   0xFF  sleep (the part stops answering until its supply cycles)
//
// A temperature word is kelvin / 0.02.
import type { I2CChip } from "../sim/i2c.ts";
import { Lagged, Noise, clamp } from "./util.ts";

/** SMBus packet error code: CRC-8, polynomial 0x07, initial value 0. */
export function pec(bytes: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; ++i) {
    crc ^= bytes[i]!;
    for (let bit = 0; bit < 8; ++bit) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

export class Mlx90614 implements I2CChip {
  readonly name = "MLX90614";
  /** The surface in the 90 degree field of view, Celsius. The filter settles in a fraction of a second. */
  readonly object = new Lagged(24, 0.12);
  /** The sensor's own package, Celsius. */
  readonly ambient = new Lagged(24.5, 3);
  private readonly noise = new Noise(0x9061);
  private readonly eeprom = new Uint16Array(32);
  /** The command byte of the transaction in progress. */
  private command: number | undefined;
  private asleep = false;
  constructor(readonly address = 0x5a) {
    this.eeprom[0x04] = 0xffff;                 // emissivity 1.0
    this.eeprom[0x0e] = 0xbe00 | this.address;  // SMBus address
    this.eeprom.set([0x2a0c, 0x8214, 0x61c3, 0x1d37], 0x1c); // ID number
  }

  // The EEPROM keeps what was written to it; a supply cycle ends a sleep.
  reset(_now: number): void { this.command = undefined; this.asleep = false; }
  acks(): boolean { return !this.asleep; }
  stop(): void { this.command = undefined; }

  private kelvinWord(celsius: number, min: number, max: number): number {
    return Math.round((clamp(celsius, min, max) + 273.15) / 0.02);
  }
  private word(command: number, now: number): number {
    if (command === 0x06) return this.kelvinWord(this.ambient.read(now) + this.noise.gauss() * 0.01, -40, 125);
    if (command === 0x07) return this.kelvinWord(this.object.read(now) + this.noise.gauss() * 0.02, -70, 380);
    if (command >= 0x20 && command <= 0x3f) return this.eeprom[command & 0x1f]!;
    return 0; // other RAM cells and the flags
  }

  write(data: Uint8Array, _now: number): boolean {
    this.command = data[0];
    if (data.length === 2 && data[0] === 0xff) {
      if (data[1] !== pec([this.address << 1, 0xff])) return false;
      this.asleep = true;
    } else if (data.length === 4 && data[0]! >= 0x20 && data[0]! <= 0x3f) {
      if (data[3] !== pec([this.address << 1, data[0]!, data[1]!, data[2]!])) return false;
      this.eeprom[data[0]! & 0x1f] = data[1]! | (data[2]! << 8);
    }
    return true;
  }
  read(length: number, now: number): Uint8Array {
    const out = new Uint8Array(length).fill(0xff);
    if (this.command === undefined) return out; // no command in this transaction: nothing drives the bus
    const value = this.word(this.command, now);
    const frame = [value & 0xff, value >> 8, 0];
    frame[2] = pec([this.address << 1, this.command, (this.address << 1) | 1, frame[0]!, frame[1]!]);
    out.set(frame.slice(0, length));
    return out;
  }
}
