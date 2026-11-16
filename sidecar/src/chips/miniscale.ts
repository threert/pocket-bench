// Unit Mini Scales (U177): a 5 kg load cell on an HX711, a button and one
// SK6812 behind an STM32F030 at 0x26. The register map is M5Stack's
// (Unit_MiniScale_I2C_Protocol.pdf, protocol v3; Arduino UNIT_SCALES). A read
// returns from the selected register to the end of its group:
//
//   0x00  R    raw ADC, i32 little endian
//   0x10  R    weight in grams, f32 little endian: (raw - offset) / gap
//   0x20  R    the button's pin level: 0 pressed, 1 released
//   0x30  R/W  LED: R, G, B
//   0x40  R/W  gap, f32 little endian: raw counts a gram (kept in flash)
//   0x50  W    1 = take the present raw value as the offset (tare)
//   0x60  R    weight * 100, i32 little endian
//   0x70  R    weight as text, zero terminated, at most 15 characters
//   0x80  R/W  filters: low-pass on (0..1, default 1), averaging level
//              (0..50, default 10), EMA alpha (0..99, default 10)
//   0xFE firmware version, 0xFF I2C address
//
// The firmware of this unit is not published. M5Stack's libraries read it
// after a repeated START, so its I2C slave is taken to be the newer one
// (stm32.ts, "ll"). The offset is taken at power-on, as the firmware of the
// older Unit Scales does.
import { Lagged, Noise } from "./util.ts";
import { Stm32Unit, type Rgb } from "./stm32.ts";

/** A 1 mV/V, 5 kg cell on an HX711 at gain 128: 2^23 counts for 0.5/128 of the excitation. */
const COUNTS_PER_GRAM = 429.5;
/** The cell's own imbalance and the pan. */
const ZERO = 87_300;
/** The HX711 converts 80 times a second. */
const SAMPLE = 12_500;

export class MiniScale extends Stm32Unit {
  /** Load on the pan in grams. The cell and the pan settle in about 0.3 s. */
  readonly grams = new Lagged(0, 0.1);
  pressed = false;
  led: Rgb = [0, 0, 0];
  private gap = COUNTS_PER_GRAM;
  private offset = ZERO;
  private filters = [1, 10, 10];
  private raw = ZERO;
  private sampledAt = -1;
  private readonly noise = new Noise(0x5c26);
  constructor(address = 0x26) { super(address, "Mini Scales STM32", "ll", 600, 600); }

  override reset(now: number): void {
    super.reset(now);
    this.led = [0, 0, 0];
    this.filters = [1, 10, 10];
    this.sampledAt = -1;
    this.offset = this.sample(now);
  }

  /** The latest conversion: the value holds until the HX711's next one. */
  private sample(now: number): number {
    const tick = Math.floor(now / SAMPLE);
    if (tick !== this.sampledAt) {
      this.sampledAt = tick;
      const [, average, ema] = this.filters as [number, number, number];
      const smoothing = ema > 0 ? Math.sqrt(ema / (200 - ema)) : 1;
      const sigma = 40 / Math.sqrt(1 + average) * smoothing;
      this.raw = Math.round(ZERO + this.grams.read(now) * COUNTS_PER_GRAM + this.noise.gauss() * sigma);
    }
    return this.raw;
  }

  protected receive(length: number, now: number): void {
    const register = this.rx[0]!, data = this.rx.subarray(1, length);
    if (length > 1) {
      if (register >= 0x30 && register <= 0x32) data.subarray(0, 0x33 - register).forEach((byte, index) => { this.led[register - 0x30 + index] = byte; });
      else if (register === 0x40 && length >= 5) {
        const gap = new DataView(data.slice(0, 4).buffer).getFloat32(0, true);
        if (Number.isFinite(gap) && gap !== 0) this.gap = gap;
      } else if (register === 0x50) { if (data[0] === 1) this.offset = this.sample(now); }
      else if (register >= 0x80 && register <= 0x82) data.subarray(0, 0x83 - register).forEach((byte, index) => { this.filters[register - 0x80 + index] = byte; });
      return;
    }
    if (length !== 1) return;
    const raw = this.sample(now), weight = (raw - this.offset) / this.gap;
    const group = (first: number, bytes: ArrayLike<number>) => this.send(Array.from(bytes).slice(register - first));
    const i32 = (value: number) => new Uint8Array(Int32Array.of(value).buffer);
    if (register <= 0x03) group(0x00, i32(raw));
    else if (register >= 0x10 && register <= 0x13) group(0x10, new Uint8Array(Float32Array.of(weight).buffer));
    else if (register === 0x20) this.send([this.pressed ? 0 : 1]);
    else if (register >= 0x30 && register <= 0x32) group(0x30, this.led);
    else if (register >= 0x40 && register <= 0x43) group(0x40, new Uint8Array(Float32Array.of(this.gap).buffer));
    else if (register >= 0x60 && register <= 0x63) group(0x60, i32(Math.round(weight * 100)));
    else if (register >= 0x70 && register <= 0x7f) {
      const text = new Uint8Array(16);
      Array.from(weight.toFixed(2).slice(0, 15)).forEach((char, index) => { text[index] = char.charCodeAt(0); });
      group(0x70, text);
    } else if (register >= 0x80 && register <= 0x82) group(0x80, this.filters);
    else if (register === 0xfe) this.send([4]);
    else if (register === 0xff) this.send([this.address]);
  }
}
