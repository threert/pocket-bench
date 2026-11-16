// 4-Relay (U097): four relays (AC 250 V / DC 28 V, 10 A), each with an LED,
// behind an STM32 at 0x26. Relays are numbered 0..3 here, 1..4 on the case.
//
//   const relays = await Relay4.open(bus);
//   await relays.set(0, true);            // close relay 1; its LED follows
//   const states = await relays.read();   // [true, false, false, false]
//
// Mini Scales answers on 0x26 too: only one of the two can be on the port.
import { write } from "@pocketjs/framework/io/i2c";
import { clamp, found, type Device, type PortA } from "./bus";

const ADDRESS = 0x26;
/** 0x10 bit 0: 1 = each LED follows its relay, 0 = the LED bits drive them.
 *  0x11: relays in bits 0..3, LEDs in bits 4..7. */
const Reg = { mode: 0x10, control: 0x11, address: 0xff } as const;

export class Relay4 {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Relay4> {
    return found("4-Relay", Relay4.ADDRESSES, Relay4.identify(bus));
  }

  /** The firmware has no identity register: a device at 0x26 with a valid
   *  mode register that is not a Mini Scales (which reports its address in
   *  0xFF) is taken to be the unit. Leaves the relays as they are and makes
   *  the LEDs follow them. undefined when nothing answers. */
  static async identify(bus: PortA): Promise<Relay4 | undefined> {
    const device = await bus.open(ADDRESS, "4-Relay");
    try {
      if ((await device.select(Reg.mode, 1))[0]! > 1) throw new Error("not a 4-Relay");
      if ((await device.select(Reg.address, 1))[0] === ADDRESS) throw new Error("a Mini Scales");
      const unit = new Relay4(device);
      await unit.setSync(true);
      return unit;
    } catch {
      device.close();
      return undefined;
    }
  }

  private constructor(private readonly device: Device) {}

  /** Reads the control register, changes it, writes it back, with no other
   *  operation in between. */
  private change(update: (control: number) => number): Promise<void> {
    return this.device.exclusive(async () => {
      const control = (await this.device.selectNow(Reg.control, 1))[0]!;
      await this.device.run([write(Reg.control, update(control) & 0xff)]);
    });
  }

  /** The four relays: true = closed. Rejects when the unit does not answer. */
  async read(): Promise<boolean[]> {
    const control = (await this.device.select(Reg.control, 1))[0]!;
    return [0, 1, 2, 3].map(bit => (control & (1 << bit)) !== 0);
  }

  /** Closes (true) or opens one relay, 0..3. */
  set(index: number, on: boolean): Promise<void> {
    const bit = 1 << clamp(Math.trunc(index), 0, 3);
    return this.change(control => (on ? control | bit : control & ~bit));
  }

  /** All four relays at once. */
  setAll(on: boolean): Promise<void> {
    return this.change(control => (on ? control | 0x0f : control & ~0x0f));
  }

  /** true: each LED shows its relay. false: setLed() drives the LEDs. */
  async setSync(sync: boolean): Promise<void> {
    await this.device.run([write(Reg.mode, sync ? 1 : 0)]);
  }

  /** One LED, 0..3; has an effect after setSync(false). */
  setLed(index: number, on: boolean): Promise<void> {
    const bit = 0x10 << clamp(Math.trunc(index), 0, 3);
    return this.change(control => (on ? control | bit : control & ~bit));
  }

  close(): void {
    this.device.close();
  }
}
