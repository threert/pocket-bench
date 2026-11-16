// ROHM BH1750FVI ambient light sensor (Unit DLight). There are no registers:
// the controller writes one opcode byte, and a read returns the two bytes of
// the data register, big endian. lux = counts / 1.2 at the default
// measurement time (datasheet, "Measurement sequence example").
//
//   0x00 power down      0x01 power on      0x07 reset the data register (while powered)
//   0x10 continuous H (1 lx, 120 ms)   0x11 continuous H2 (0.5 lx, 120 ms)   0x13 continuous L (4 lx, 16 ms)
//   0x20 / 0x21 / 0x23   the same once, then power down
//   0x40 | MT[7:5], 0x60 | MT[4:0]     measurement time register, 31..254, default 69
import type { I2CChip } from "../sim/i2c.ts";
import { Lagged, Noise, clamp } from "./util.ts";

/** Typical conversion times at MTreg 69 (the datasheet's maximum is 180 ms and 24 ms). */
const H_MICROS = 120_000, L_MICROS = 16_000;

export class Bh1750 implements I2CChip {
  readonly name = "BH1750FVI";
  /** Illuminance on the sensor in lux. The photodiode itself is fast. */
  readonly lux = new Lagged(320, 0.01);
  private readonly noise = new Noise(0xb175);
  private powered = false;
  /** The running mode's opcode (0x10, 0x11, 0x13 or their one-time forms), or 0. */
  private mode = 0;
  private mtreg = 69;
  private data = 0;
  /** When the conversion in progress ends. */
  private doneAt = 0;
  constructor(readonly address = 0x23) {}

  reset(_now: number): void { this.powered = false; this.mode = 0; this.mtreg = 69; this.data = 0; this.doneAt = 0; }

  private duration(): number {
    return Math.round(((this.mode & 0x03) === 0x03 ? L_MICROS : H_MICROS) * this.mtreg / 69);
  }
  private convert(at: number): number {
    const lux = this.lux.read(at) * (1 + this.noise.gauss() * 0.004);
    // H mode counts 1.2 a lux at MTreg 69; H2 twice that; L mode is H at a quarter of the resolution.
    const h = lux * 1.2 * (this.mtreg / 69);
    const counts = (this.mode & 0x03) === 0x01 ? h * 2 : (this.mode & 0x03) === 0x03 ? Math.round(h / 4) * 4 : h;
    return clamp(Math.round(counts), 0, 65535);
  }
  /** Finishes the conversions that ended by `now`. */
  private advance(now: number): void {
    if (!this.mode || now < this.doneAt) return;
    if (this.mode & 0x20) {
      this.data = this.convert(this.doneAt);
      this.mode = 0; this.powered = false;
      return;
    }
    // Continuous: the register holds the last conversion that completed.
    const period = this.duration();
    const last = this.doneAt + Math.floor((now - this.doneAt) / period) * period;
    this.data = this.convert(last);
    this.doneAt = last + period;
  }

  write(data: Uint8Array, now: number): boolean {
    this.advance(now);
    for (const opcode of data) {
      if (opcode === 0x00) { this.powered = false; this.mode = 0; }
      else if (opcode === 0x01) this.powered = true;
      else if (opcode === 0x07) { if (this.powered) this.data = 0; }
      else if ([0x10, 0x11, 0x13, 0x20, 0x21, 0x23].includes(opcode)) {
        // A measurement opcode powers the part on by itself.
        this.powered = true; this.mode = opcode; this.doneAt = now + this.duration();
      } else if ((opcode & 0xf8) === 0x40) this.mtreg = clamp((this.mtreg & 0x1f) | ((opcode & 0x07) << 5), 31, 254);
      else if ((opcode & 0xe0) === 0x60) this.mtreg = clamp((this.mtreg & 0xe0) | (opcode & 0x1f), 31, 254);
      // Any other opcode is acknowledged and ignored.
    }
    return true;
  }
  read(length: number, now: number): Uint8Array {
    this.advance(now);
    const out = new Uint8Array(length).fill(0xff);
    if (length > 0) out[0] = this.data >> 8;
    if (length > 1) out[1] = this.data & 0xff;
    return out;
  }
}
