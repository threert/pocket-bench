// DLight (U136): ambient light from a BH1750FVI at 0x23, 1 to 54612 lx.
//
//   const light = await DLight.open(bus);
//   const lux = await light.read();
import { receive, u16be, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { found, now, type Device, type PortA } from "./bus";

const ADDRESS = 0x23;
/** The BH1750 has no registers: one byte is an opcode. */
const POWER_ON = 0x01, CONTINUOUS_HIGH = 0x10;
/** One conversion in high-resolution mode: 120 ms, 180 ms at most. */
const CONVERSION = 180_000;

export class DLight {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<DLight> {
    return found("DLight", DLight.ADDRESSES, DLight.identify(bus));
  }

  /** The chip has no identity register: a unit that takes the two opcodes
   *  is taken to be one. undefined when nothing does. */
  static async identify(bus: PortA): Promise<DLight | undefined> {
    const device = await bus.open(ADDRESS, "DLight");
    try {
      await device.run([write(POWER_ON)]);
      await device.run([write(CONTINUOUS_HIGH)]);
      return new DLight(device, now() + CONVERSION);
    } catch {
      device.close();
      return undefined;
    }
  }

  /** `readyAt`: when the first conversion is in the data register. */
  private constructor(private readonly device: Device, private readonly readyAt: number) {}

  /** Illuminance in lux, 1 lx steps. The sensor converts continuously, so
   *  this is the latest result; only the first call waits for one.
   *  Rejects when the unit does not answer. */
  async read(): Promise<number> {
    if (now() < this.readyAt) await sleep(this.readyAt - now());
    const raw = await this.device.run([receive([u16be])]);
    return ((raw[0]! << 8) | raw[1]!) / 1.2;
  }

  close(): void {
    this.device.close();
  }
}
