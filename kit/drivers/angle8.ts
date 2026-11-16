// 8Angle (U154): eight potentiometers, a toggle switch and nine RGB LEDs
// behind an STM32 at 0x43. LED 0..7 sit under the knobs, LED 8 by the switch.
//
//   const knobs = await Angle8.open(bus);
//   const { knobs: positions, switch: on } = await knobs.read();   // 0..1 each
//   await knobs.setLed(0, 255, 80, 0);
import { write } from "@pocketjs/framework/io/i2c";
import { channel, clamp, found, type Device, type PortA } from "./bus";

const ADDRESS = 0x43;
const Reg = { knob12: 0x00, knob8: 0x10, toggle: 0x20, led: 0x30, version: 0xfe, address: 0xff } as const;
export const KNOBS = 8, LEDS = 9;

export class Angle8 {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Angle8> {
    return found("8Angle", Angle8.ADDRESSES, Angle8.identify(bus));
  }

  /** The firmware reports its own address in register 0xFF; undefined when
   *  the device at 0x43 does not. */
  static async identify(bus: PortA): Promise<Angle8 | undefined> {
    const device = await bus.open(ADDRESS, "8Angle");
    try {
      if ((await device.select(Reg.address, 1))[0] !== ADDRESS) throw new Error("not an 8Angle");
      return new Angle8(device);
    } catch {
      device.close();
      return undefined;
    }
  }

  private constructor(private readonly device: Device) {}

  /** One knob, 0..1 (12 bits). The firmware returns one value a read. */
  async knob(index: number): Promise<number> {
    const raw = await this.device.select(Reg.knob12 + 2 * clamp(Math.trunc(index), 0, KNOBS - 1), 2);
    return (raw[0]! | (raw[1]! << 8)) / 4095;
  }

  /** Whether the toggle switch's pin reads 1. */
  async switch(): Promise<boolean> {
    return (await this.device.select(Reg.toggle, 1))[0] === 1;
  }

  /** All eight knobs and the switch: nine reads, a few milliseconds.
   *  Rejects when the unit does not answer. */
  async read(): Promise<{ knobs: number[]; switch: boolean }> {
    const knobs: number[] = [];
    for (let index = 0; index < KNOBS; ++index) knobs.push(await this.knob(index));
    return { knobs, switch: await this.switch() };
  }

  /** Colour of LED 0..8, each channel 0..255, and a brightness of 0..100.
   *  The firmware limits the LEDs' current: full brightness is a tenth of
   *  what the LED could give. */
  async setLed(index: number, r: number, g: number, b: number, brightness = 100): Promise<void> {
    const register = Reg.led + 4 * clamp(Math.trunc(index), 0, LEDS - 1);
    await this.device.run([write(register, channel(r), channel(g), channel(b), clamp(Math.round(brightness), 0, 100))]);
  }

  async clearLeds(): Promise<void> {
    for (let index = 0; index < LEDS; ++index) await this.setLed(index, 0, 0, 0, 0);
  }

  close(): void {
    this.device.close();
  }
}
