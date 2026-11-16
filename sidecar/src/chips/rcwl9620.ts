// RCWL-9620 ultrasonic ranging (M5Stack Unit Ultrasonic-I2C). Writing 0x01
// starts a measurement; three bytes read back afterwards are the distance in
// micrometres, big endian. The module ranges 20 mm to 4500 mm; beyond that
// the echo is lost and it reports its maximum.
import type { I2CChip } from "../sim/i2c.ts";
import { Lagged, Noise } from "./util.ts";

export class Rcwl9620 implements I2CChip {
  readonly name = "RCWL-9620";
  /** Distance to the nearest surface in front of the transducers, millimetres. */
  readonly millimetres = new Lagged(600, 0.02);
  private readonly noise = new Noise(0x77c1);
  private measuredAt = -1;
  private micrometres = 0;
  constructor(readonly address = 0x57) {}
  reset(): void { this.measuredAt = -1; this.micrometres = 0; }
  write(data: Uint8Array, now: number): boolean {
    if (data[0] === 0x01) {
      const truth = this.millimetres.read(now);
      // Sound travels there and back: 5.8 us a millimetre, plus the burst.
      const flight = Math.min(truth, 4500) * 5.8 + 2_000;
      this.measuredAt = now + flight;
      const noisy = truth + this.noise.gauss() * Math.max(0.6, truth * 0.002);
      this.micrometres = truth > 4500 || truth < 0 ? 4_500_000 + 1000 : Math.max(0, Math.round(noisy * 1000));
    }
    return true;
  }
  read(length: number, now: number): Uint8Array {
    const out = new Uint8Array(length);
    const value = this.measuredAt >= 0 && now >= this.measuredAt ? this.micrometres : 0;
    if (length >= 3) { out[0] = (value >> 16) & 0xff; out[1] = (value >> 8) & 0xff; out[2] = value & 0xff; }
    return out;
  }
}
