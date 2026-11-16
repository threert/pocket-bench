// Unit Joystick2 (U024-V2): a Hall-effect stick with a push button and one
// WS2812 behind an STM32G030 at 0x63. Register map and behaviour follow the
// firmware source (m5stack/M5Unit-Joystick2-Internal-FW, version 1). A read
// returns from the selected register to the end of its group:
//
//   0x00..0x03  R    X then Y, 16 bits little endian, 0..65535
//   0x10..0x11  R    X, Y as 8 bits
//   0x20        R    the button's pin level: 0 pressed, 1 released
//   0x30..0x33  R/W  LED: blue, green, red, unused (a little-endian 0x00RRGGBB)
//   0x40..0x4F  R/W  calibration, eight u16: X negative min, negative max,
//                    positive min, positive max, then the same for Y
//   0x50..0x53  R    X then Y calibrated, i16 little endian, -4095..4095, 0 in the dead band
//   0x60..0x61  R    X, Y calibrated as i8, -127..127
//   0xFC bootloader version, 0xFE firmware version, 0xFF I2C address
import { Lagged, Noise, clamp } from "./util.ts";
import { Stm32Unit, map, type Rgb } from "./stm32.ts";

/** The firmware's default calibration: the stick rests inside 33330..34000. */
const CALIBRATION = [130, 33330, 34000, 65440, 130, 33330, 34000, 65440];

export class Joystick2 extends Stm32Unit {
  /** Stick deflection, -1..1 on each axis. The spring returns it in a few milliseconds. */
  readonly x = new Lagged(0, 0.008);
  readonly y = new Lagged(0, 0.008);
  pressed = false;
  /** The LED register: 0x00RRGGBB. */
  private color = 0;
  private readonly calibration = Uint16Array.from(CALIBRATION);
  private readonly noise = new Noise(0x1063);
  constructor(address = 0x63) { super(address, "Joystick2 STM32", "ll", 600, 600); }

  // Calibration lives in flash and survives a power cycle; the LED does not.
  override reset(now: number): void { super.reset(now); this.color = 0; }
  get led(): Rgb { return [(this.color >> 16) & 0xff, (this.color >> 8) & 0xff, this.color & 0xff]; }

  /** The 16-bit value of one axis: its calibration range spans the stick's travel. */
  private adc(axis: Lagged, base: number, now: number): number {
    const deflection = clamp(axis.read(now), -1, 1);
    const [negativeMin, negativeMax, positiveMin, positiveMax] = CALIBRATION.slice(base, base + 4) as [number, number, number, number];
    const rest = (negativeMax + positiveMin) / 2;
    const value = deflection > 0 ? positiveMin + deflection * (positiveMax - positiveMin)
      : deflection < 0 ? negativeMax + deflection * (negativeMax - negativeMin) : rest;
    return clamp(Math.round(value + this.noise.gauss() * 14), 0, 65535);
  }
  private calibrated(value: number, base: number, full: number): number {
    const [negativeMin, negativeMax, positiveMin, positiveMax] = Array.from(this.calibration.subarray(base, base + 4)) as [number, number, number, number];
    if (value >= positiveMin) return map(value, positiveMin, positiveMax, 0, full, true);
    if (value <= negativeMax) return map(value, negativeMin, negativeMax, -full, 0, true);
    return 0;
  }

  protected receive(length: number, now: number): void {
    const register = this.rx[0]!;
    if (length > 1) {
      // Each byte lands on its own register of the group; the rest keep their value.
      const data = this.rx.subarray(1, length);
      if (register >= 0x30 && register <= 0x33) {
        const bytes = new Uint8Array(new Uint32Array([this.color]).buffer);
        data.subarray(0, 0x34 - register).forEach((byte, index) => { bytes[register - 0x30 + index] = byte; });
        this.color = new Uint32Array(bytes.buffer)[0]!;
      } else if (register >= 0x40 && register <= 0x4f) {
        const bytes = new Uint8Array(this.calibration.buffer);
        data.subarray(0, 0x50 - register).forEach((byte, index) => { bytes[register - 0x40 + index] = byte; });
      }
      return; // 0xFF (address) and 0xFD (bootloader) are not simulated
    }
    if (length !== 1) return;
    const x = this.adc(this.x, 0, now), y = this.adc(this.y, 4, now);
    const group = (first: number, bytes: ArrayLike<number>) => this.send(Array.from(bytes).slice(register - first));
    const words = (...values: number[]) => new Uint8Array(Int16Array.from(values).buffer);
    if (register <= 0x03) group(0x00, new Uint8Array(Uint16Array.of(x, y).buffer));
    else if (register >= 0x10 && register <= 0x11) group(0x10, [map(x, 0, 65535, 0, 255, true), map(y, 0, 65535, 0, 255, true)]);
    else if (register === 0x20) this.send([this.pressed ? 0 : 1]);
    else if (register >= 0x30 && register <= 0x33) group(0x30, new Uint8Array(Uint32Array.of(this.color).buffer));
    else if (register >= 0x40 && register <= 0x4f) group(0x40, new Uint8Array(this.calibration.buffer));
    else if (register >= 0x50 && register <= 0x53) group(0x50, words(this.calibrated(x, 0, 4095), this.calibrated(y, 4, 4095)));
    else if (register >= 0x60 && register <= 0x61) group(0x60, new Uint8Array(Int8Array.of(this.calibrated(x, 0, 127), this.calibrated(y, 4, 127)).buffer));
    else if (register === 0xfc || register === 0xfe) this.send([1]);
    else if (register === 0xff) this.send([this.address]);
  }
}
