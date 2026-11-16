// Encoder (U135): an endless knob with 30 detents a turn, a push switch and
// two RGB LEDs behind an STM32 at 0x40.
//
//   const knob = await Encoder.open(bus);
//   const { steps, button } = await knob.read();   // detents since open
//   await knob.setLed(0, 0, 60, 0);                // 0 = both, 1 or 2 = one
import { write } from "@pocketjs/framework/io/i2c";
import { channel, found, type Device, type PortA } from "./bus";

const ADDRESS = 0x40;
const Reg = { mode: 0x00, counter: 0x10, button: 0x20, led: 0x30, zero: 0x40 } as const;
/** The firmware counts every edge of the encoder's two signals: two a detent. */
const COUNTS_PER_DETENT = 2;

export class Encoder {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Encoder> {
    return found("Encoder", Encoder.ADDRESSES, Encoder.identify(bus));
  }

  /** The firmware has no identity register: a device at 0x40 that returns
   *  its counter is taken to be the unit. undefined when nothing does. */
  static async identify(bus: PortA): Promise<Encoder | undefined> {
    const device = await bus.open(ADDRESS, "Encoder");
    const unit = new Encoder(device);
    try {
      unit.last = await unit.counter();
      return unit;
    } catch {
      device.close();
      return undefined;
    }
  }

  private last = 0;
  private counts = 0;
  private constructor(private readonly device: Device) {}

  /** The firmware's counter: a signed 16-bit number that wraps. */
  private async counter(): Promise<number> {
    const raw = await this.device.select(Reg.counter, 2);
    return new DataView(raw.buffer, raw.byteOffset, 2).getInt16(0, true);
  }

  /** `steps`: detents turned since open() or zero(), clockwise positive,
   *  without the counter's wrap. `button`: whether the knob is pressed.
   *  Rejects when the unit does not answer. */
  async read(): Promise<{ steps: number; button: boolean }> {
    const counter = await this.counter();
    // The difference of two 16-bit readings, taken the short way round.
    this.counts += ((counter - this.last + 0x8000) & 0xffff) - 0x8000;
    this.last = counter;
    // The switch register is the pin's level: 0 while pressed.
    const button = (await this.device.select(Reg.button, 1))[0] === 0;
    return { steps: Math.trunc(this.counts / COUNTS_PER_DETENT), button };
  }

  /** Makes the present position step 0. */
  async zero(): Promise<void> {
    await this.device.run([write(Reg.zero, 1)]);
    this.last = 0;
    this.counts = 0;
  }

  /** Colour of LED 1 or 2, or of both with index 0; each channel 0..255. */
  async setLed(index: 0 | 1 | 2, r: number, g: number, b: number): Promise<void> {
    await this.device.run([write(Reg.led, index, channel(r), channel(g), channel(b))]);
  }

  close(): void {
    this.device.close();
  }
}
