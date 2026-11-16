// Mini Scales (U177): a 5 kg load cell with a button and one RGB LED behind
// an STM32 at 0x26.
//
//   const scale = await Scales.open(bus);
//   await scale.tare();                            // the empty pan is 0 g
//   const { grams, button } = await scale.read();
//
// 4-Relay answers on 0x26 too: only one of the two can be on the port.
import { write } from "@pocketjs/framework/io/i2c";
import { channel, found, type Device, type PortA } from "./bus";

const ADDRESS = 0x26;
const Reg = { raw: 0x00, grams: 0x10, button: 0x20, led: 0x30, gap: 0x40, tare: 0x50, address: 0xff } as const;

export class Scales {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Scales> {
    return found("Mini Scales", Scales.ADDRESSES, Scales.identify(bus));
  }

  /** The firmware reports its own address in register 0xFF; undefined when
   *  the device at 0x26 does not (a 4-Relay). */
  static async identify(bus: PortA): Promise<Scales | undefined> {
    const device = await bus.open(ADDRESS, "Mini Scales");
    try {
      if ((await device.select(Reg.address, 1))[0] !== ADDRESS) throw new Error("not a Mini Scales");
      return new Scales(device);
    } catch {
      device.close();
      return undefined;
    }
  }

  private constructor(private readonly device: Device) {}

  /** The weight in grams (it settles about 0.3 s after the load changes)
   *  and the button. Rejects when the unit does not answer. */
  async read(): Promise<{ grams: number; button: boolean }> {
    const raw = await this.device.select(Reg.grams, 4);
    const grams = new DataView(raw.buffer, raw.byteOffset, 4).getFloat32(0, true);
    // The button register is the pin's level: 0 while pressed.
    const button = (await this.device.select(Reg.button, 1))[0] === 0;
    return { grams, button };
  }

  /** Makes the present load 0 g. */
  async tare(): Promise<void> {
    await this.device.run([write(Reg.tare, 1)]);
  }

  /** The HX711's raw counts: weight = (raw - offset) / gap. */
  async raw(): Promise<number> {
    const raw = await this.device.select(Reg.raw, 4);
    return new DataView(raw.buffer, raw.byteOffset, 4).getInt32(0, true);
  }

  /** Calibrates with a known weight: raw counts with the pan empty and with
   *  `grams` on it. The unit keeps the result in its flash. */
  async calibrate(emptyRaw: number, loadedRaw: number, grams: number): Promise<void> {
    const gap = new Uint8Array(4);
    new DataView(gap.buffer).setFloat32(0, (loadedRaw - emptyRaw) / grams, true);
    await this.device.run([write(Reg.gap, gap)]);
  }

  /** Colour of the LED, each channel 0..255. */
  async setLed(r: number, g: number, b: number): Promise<void> {
    await this.device.run([write(Reg.led, channel(r), channel(g), channel(b))]);
  }

  close(): void {
    this.device.close();
  }
}
