// Sensirion SHT30 (and SHT31/35: same commands): humidity and temperature.
// Commands are two bytes; a measurement is read back as two words, each
// followed by its CRC. In single-shot mode without clock stretching the read
// header is NACKed until the conversion is done (datasheet table 4).
import type { I2CChip } from "../sim/i2c.ts";
import { clamp, crc8, Lagged, Noise } from "./util.ts";

const DURATION: Record<number, number> = { 0x2400: 15_500, 0x240b: 6_500, 0x2416: 4_500, 0x2c06: 15_500, 0x2c0d: 6_500, 0x2c10: 4_500 };

export class Sht30 implements I2CChip {
  readonly name = "SHT30";
  /** Air temperature in Celsius and relative humidity in percent, with the package's lag. */
  readonly celsius = new Lagged(24.6, 5);
  readonly humidity = new Lagged(48, 6);
  private readonly noise = new Noise(0x5173);
  private response: Uint8Array | undefined;
  private readyAt = 0;
  private status = 0x8010;
  private heater = false;
  private periodic = 0;
  constructor(readonly address = 0x44) {}

  reset(now: number): void { this.response = undefined; this.readyAt = now + 1_000; this.status = 0x8010; this.heater = false; this.periodic = 0; }

  private words(...values: number[]): Uint8Array {
    const out = new Uint8Array(values.length * 3);
    values.forEach((value, index) => {
      out[index * 3] = value >> 8; out[index * 3 + 1] = value & 0xff;
      out[index * 3 + 2] = crc8(out, index * 3, 2);
    });
    return out;
  }
  private measure(now: number): Uint8Array {
    const celsius = this.celsius.read(now) + (this.heater ? 3.2 : 0) + this.noise.gauss() * 0.04;
    const humidity = clamp(this.humidity.read(now) + this.noise.gauss() * 0.25, 0, 100);
    const t = clamp(Math.round((celsius + 45) * 65535 / 175), 0, 65535);
    const rh = clamp(Math.round(humidity * 65535 / 100), 0, 65535);
    return this.words(t, rh);
  }

  write(data: Uint8Array, now: number): boolean {
    if (now < this.readyAt && this.response) return false; // busy converting
    if (data.length < 2) return true;
    const command = (data[0]! << 8) | data[1]!;
    if (DURATION[command] !== undefined) {
      this.response = this.measure(now);
      this.readyAt = now + DURATION[command]!;
    } else if (command === 0xf32d) {
      this.response = this.words(this.status | (this.heater ? 0x2000 : 0));
      this.readyAt = now;
    } else if (command === 0x3041) {
      this.status &= ~0x8c10; this.response = undefined;
    } else if (command === 0x30a2) {
      this.reset(now);
    } else if (command === 0x306d) { this.heater = true;
    } else if (command === 0x3066) { this.heater = false;
    } else if ((command & 0xff00) >= 0x2000 && (command & 0xff00) <= 0x2700) {
      // Periodic acquisition: 0.5, 1, 2, 4 or 10 measurements a second.
      this.periodic = now; this.response = undefined;
    } else if (command === 0xe000) {
      if (!this.periodic) return false;
      this.response = this.measure(now); this.readyAt = now;
    } else if (command === 0x3093) {
      this.periodic = 0;
    } else {
      this.status |= 0x0002; // command not processed
      return false;
    }
    return true;
  }
  read(length: number, now: number): Uint8Array | undefined {
    if (!this.response || now < this.readyAt) return undefined;
    const out = new Uint8Array(length).fill(0xff);
    out.set(this.response.subarray(0, length));
    return out;
  }
}
