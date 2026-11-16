// Joystick2 (U024-V2): a Hall-effect stick with a push button and one RGB
// LED behind an STM32 at 0x63.
//
//   const stick = await Joystick2.open(bus);
//   const { x, y, button } = await stick.read();   // x, y: -1..1
//   await stick.setLed(0, 40, 255);
import { write } from "@pocketjs/framework/io/i2c";
import { channel, found, type Device, type PortA } from "./bus";

const ADDRESS = 0x63;
const Reg = { raw: 0x00, button: 0x20, led: 0x30, calibrated: 0x50, address: 0xff } as const;

export class Joystick2 {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Joystick2> {
    return found("Joystick2", Joystick2.ADDRESSES, Joystick2.identify(bus));
  }

  /** The firmware reports its own address in register 0xFF; undefined when
   *  the device at 0x63 does not. */
  static async identify(bus: PortA): Promise<Joystick2 | undefined> {
    const device = await bus.open(ADDRESS, "Joystick2");
    try {
      if ((await device.select(Reg.address, 1))[0] !== ADDRESS) throw new Error("not a Joystick2");
      return new Joystick2(device);
    } catch {
      device.close();
      return undefined;
    }
  }

  private constructor(private readonly device: Device) {}

  /** The stick's deflection, -1..1 on each axis and exactly 0 at rest (the
   *  firmware applies its calibration and a dead band), and the button.
   *  Rejects when the unit does not answer. */
  async read(): Promise<{ x: number; y: number; button: boolean }> {
    const raw = await this.device.select(Reg.calibrated, 4);
    const view = new DataView(raw.buffer, raw.byteOffset, 4);
    // The button register is the pin's level: 0 while pressed.
    const button = (await this.device.select(Reg.button, 1))[0] === 0;
    return { x: view.getInt16(0, true) / 4095, y: view.getInt16(2, true) / 4095, button };
  }

  /** The two axes as the ADC reports them, 0..65535, about 33665 at rest. */
  async raw(): Promise<{ x: number; y: number }> {
    const raw = await this.device.select(Reg.raw, 4);
    return { x: raw[0]! | (raw[1]! << 8), y: raw[2]! | (raw[3]! << 8) };
  }

  /** Colour of the LED, each channel 0..255. The register holds blue,
   *  green, red in that order. */
  async setLed(r: number, g: number, b: number): Promise<void> {
    await this.device.run([write(Reg.led, channel(b), channel(g), channel(r), 0)]);
  }

  close(): void {
    this.device.close();
  }
}
