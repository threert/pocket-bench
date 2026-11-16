// Ultrasonic I2C (U098-B1): distance from an RCWL-9620 at 0x57, 20 mm to
// 4500 mm.
//
//   const sonic = await Sonic.open(bus);
//   const millimetres = await sonic.read();   // undefined: nothing in range
//
// Adapted from pocket-m5, apps/unit-swap/units/sonic.ts (MIT, Pocket Nexus).
import { bytes, receive, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { found, type Device, type PortA } from "./bus";

const ADDRESS = 0x57;
/** The byte 0x01 starts a measurement; the echo of 4.5 m is back in 120 ms. */
const TRIGGER = [write(0x01)];
const MEASURE = 120_000;
export const MIN_MM = 20, MAX_MM = 4500;

export class Sonic {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Sonic> {
    return found("Ultrasonic I2C", Sonic.ADDRESSES, Sonic.identify(bus));
  }

  /** The chip has no identity register: a unit that answers one measurement
   *  is taken to be one. undefined when nothing does. */
  static async identify(bus: PortA): Promise<Sonic | undefined> {
    const device = await bus.open(ADDRESS, "Ultrasonic I2C");
    const unit = new Sonic(device);
    try {
      await unit.raw();
      return unit;
    } catch {
      device.close();
      return undefined;
    }
  }

  private constructor(private readonly device: Device) {}

  /** One measurement, 120 ms: the three bytes are the distance in
   *  micrometres, big endian. Rejects when the unit does not answer. */
  raw(): Promise<number> {
    return this.device.exclusive(async () => {
      await this.device.run(TRIGGER);
      await sleep(MEASURE);
      const echo = await this.device.run([receive([bytes(3)])]);
      return ((echo[0]! << 16) | (echo[1]! << 8) | echo[2]!) / 1000;
    });
  }

  /** The distance in millimetres, or undefined when the echo is outside
   *  the module's 20..4500 mm. */
  async read(): Promise<number | undefined> {
    const millimetres = await this.raw();
    return millimetres >= MIN_MM && millimetres <= MAX_MM ? millimetres : undefined;
  }

  close(): void {
    this.device.close();
  }
}

/** The middle of a few readings: drops a single bad echo. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b), middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
