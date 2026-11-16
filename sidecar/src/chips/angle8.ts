// Unit 8Angle (U154): eight potentiometers, a toggle switch and nine SK6812
// LEDs behind an STM32F030 at 0x43. Register map and behaviour follow the
// firmware source (m5stack/M5Unit-8Angle-Internal-FW, version 1):
//
//   0x00..0x0F  R  knob n as 12 bits, little endian, at 0x00 + 2n. One read
//                  returns the two bytes of one knob.
//   0x10..0x17  R  knob n as 8 bits, one byte a read
//   0x20        R  the switch's pin level, 0 or 1
//   0x30 + 4n   W  LED n (0..8): R, G, B, brightness 0..100 in one write.
//                  The firmware drives the LED at value * brightness / 1000.
//                  A write of a single byte sets that one channel unscaled.
//   0xFE        R  firmware version (1)     0xFF  R  I2C address
import { Lagged, Noise, clamp } from "./util.ts";
import { Stm32Unit, type Rgb } from "./stm32.ts";

export class Angle8 extends Stm32Unit {
  /** Knob positions, 0 (fully one way) to 1. */
  readonly knobs = Array.from({ length: 8 }, () => new Lagged(0.5, 0.01));
  /** The toggle switch's pin level. */
  toggle = 0;
  /** What each LED is driven with, 0..255 a channel. */
  readonly pixels: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  /** The firmware's per-channel bytes behind single-byte writes. */
  private readonly single: Rgb[] = Array.from({ length: 9 }, () => [0, 0, 0] as Rgb);
  private readonly noise = new Noise(0x8a43);
  constructor(address = 0x43) { super(address, "8Angle STM32", "hal", 50, 50); }

  override reset(now: number): void {
    super.reset(now);
    for (const pixel of [...this.pixels, ...this.single]) pixel.fill(0);
  }

  /** The ADC's 12 bits: 20 samples averaged, so a count or two of noise. */
  private adc(knob: number, now: number): number {
    return clamp(Math.round(this.knobs[knob]!.read(now) * 4095 + this.noise.gauss() * 1.2), 0, 4095);
  }

  protected receive(length: number, now: number): void {
    const register = this.rx[0]!;
    if (length === 1) {
      if (register <= 0x0f) this.sendWord(this.adc(register >> 1, now));
      else if (register >= 0x10 && register <= 0x17) this.send([Math.trunc(this.adc(register - 0x10, now) * 255 / 4095)]);
      else if (register === 0x20) this.send([this.toggle]);
      else if (register === 0xfe) this.send([1]);
      else if (register === 0xff) this.send([this.address]);
      return;
    }
    if (register < 0x30 || register > 0x53) return; // 0xFF changes the address in flash: not simulated
    const led = (register - 0x30) >> 2, channel = (register - 0x30) & 3;
    if (length === 2) {
      if (channel < 3) this.single[led]![channel] = this.rx[1]!;
      this.pixels[led] = [...this.single[led]!];
    } else {
      // Bytes the write did not carry are whatever the buffer held, as in the firmware.
      const brightness = Math.min(100, this.rx[4]!);
      this.single[led]!.fill(0);
      this.pixels[led] = [this.rx[1]!, this.rx[2]!, this.rx[3]!].map(value => Math.trunc(value * brightness / 1000)) as Rgb;
    }
  }
}
