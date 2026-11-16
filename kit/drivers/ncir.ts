// NCIR (U028): contactless temperature from an MLX90614 at 0x5A. It looks at
// a 90 degree cone, so it reads the average of what fills that cone.
//
//   const ncir = await Ncir.open(bus);
//   const { objectCelsius, ambientCelsius } = await ncir.read();
import { bytes, read } from "@pocketjs/framework/io/i2c";
import { found, type Device, type PortA } from "./bus";

const ADDRESS = 0x5a;
/** RAM cells: the sensor's own temperature and the object's. */
const TA = 0x06, TOBJ1 = 0x07;
/** EEPROM cell 0x0E (command 0x2E): the part's own address, in the low byte. */
const SMBUS_ADDRESS = 0x2e;

export class Ncir {
  static readonly ADDRESSES = [ADDRESS];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Ncir> {
    return found("NCIR", Ncir.ADDRESSES, Ncir.identify(bus));
  }

  /** An MLX90614 answers a word read with a valid checksum and stores its
   *  own address; undefined when the device does not. */
  static async identify(bus: PortA): Promise<Ncir | undefined> {
    const device = await bus.open(ADDRESS, "NCIR");
    const unit = new Ncir(device);
    try {
      if (((await unit.word(SMBUS_ADDRESS)) & 0x7f) !== ADDRESS) throw new Error("not an MLX90614");
      return unit;
    } catch {
      device.close();
      return undefined;
    }
  }

  private constructor(private readonly device: Device) {}

  /** SMBus "read word": the command, a repeated START, then low byte, high
   *  byte and the PEC, all in one transaction. */
  private async word(command: number): Promise<number> {
    const raw = await this.device.run([read(command, [bytes(3)])]);
    const check = pec([ADDRESS << 1, command, (ADDRESS << 1) | 1, raw[0]!, raw[1]!]);
    if (check !== raw[2]) throw new Error("NCIR: checksum mismatch");
    return raw[0]! | (raw[1]! << 8);
  }

  /** Both temperatures in Celsius, 0.02 C steps. Rejects when the unit does
   *  not answer, a checksum is wrong or the sensor flags an error. */
  async read(): Promise<{ objectCelsius: number; ambientCelsius: number }> {
    const object = await this.word(TOBJ1), ambient = await this.word(TA);
    if (object & 0x8000) throw new Error("NCIR: the sensor reports a measurement error");
    return { objectCelsius: object * 0.02 - 273.15, ambientCelsius: ambient * 0.02 - 273.15 };
  }

  close(): void {
    this.device.close();
  }
}

/** SMBus packet error code: CRC-8, polynomial 0x07, initial value 0. */
function pec(data: readonly number[]): number {
  let crc = 0;
  for (const value of data) {
    crc ^= value;
    for (let bit = 0; bit < 8; ++bit) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}
