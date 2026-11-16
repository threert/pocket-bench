// ENV III (U001-C): temperature and humidity from an SHT30 at 0x44, pressure
// from a QMP6988 at 0x70.
//
//   const env = await Env3.open(bus);
//   const { celsius, humidity, pascals } = await env.read();
//
// Adapted from pocket-m5, apps/unit-swap/units/env3.ts and decode.ts (MIT,
// Pocket Nexus).
import { bytes, read, receive, u8, write } from "@pocketjs/framework/io/i2c";
import { sleep } from "@pocketjs/framework/worker";
import { found, type Device, type PortA } from "./bus";

const SHT30 = 0x44, QMP6988 = 0x70;
/** SHT3x single shot, high repeatability: at most 15.5 ms; the read is not
 *  acknowledged before the conversion is done. */
const SHT_MEASURE = [write(0x24, 0x00)];
/** QMP6988 CTRL_MEAS: temperature x1, pressure x8, forced mode (one conversion). */
const QMP_MEASURE = [write(0xf4, (0b001 << 5) | (0b100 << 2) | 0b01)];
const CONVERSION = 25_000;

export interface Env3Reading {
  celsius: number;
  /** Relative humidity, percent. */
  humidity: number;
  pascals: number;
  /** The QMP6988's own temperature: a check against the SHT30. */
  qmpCelsius: number;
}

export class Env3 {
  static readonly ADDRESSES = [SHT30, QMP6988];

  /** The unit, or an Error when it is not on the port. */
  static open(bus: PortA): Promise<Env3> {
    return found("ENV III", Env3.ADDRESSES, Env3.identify(bus));
  }

  /** Checks both chips and reads the pressure sensor's calibration;
   *  undefined when this is not an ENV III. */
  static async identify(bus: PortA): Promise<Env3 | undefined> {
    const sht = await bus.open(SHT30, "ENV III SHT30");
    const qmp = await bus.open(QMP6988, "ENV III QMP6988").catch(error => { sht.close(); throw error; });
    try {
      if ((await qmp.run([read(0xd1, [u8])]))[0] !== 0x5c) throw new Error("not a QMP6988");
      // The status word (command 0xF32D) proves an SHT3x: its CRC must match.
      if (shtWord(await sht.run([write(0xf3, 0x2d), receive([bytes(3)])]), 0) === undefined) throw new Error("not an SHT30");
      // Soft reset, then the 25 calibration bytes and the IIR filter (N = 4).
      await qmp.run([write(0xe0, 0xe6)]).catch(() => undefined);
      await sleep(20_000);
      await qmp.run([write(0xe0, 0x00)]);
      const calibration = qmpCalibration(await qmp.run([read(0xa0, [bytes(25)])]));
      await qmp.run([write(0xf1, 0x02)]);
      return new Env3(sht, qmp, calibration);
    } catch {
      sht.close(); qmp.close();
      return undefined;
    }
  }

  private constructor(private readonly sht: Device, private readonly qmp: Device, private readonly calibration: QmpCalibration) {}

  /** One measurement of both sensors; takes about 30 ms. Rejects when the
   *  unit does not answer or a checksum is wrong. */
  read(): Promise<Env3Reading> {
    return this.sht.exclusive(async () => {
      await this.sht.run(SHT_MEASURE);
      await this.qmp.run(QMP_MEASURE);
      await sleep(CONVERSION);
      const raw = await this.sht.run([receive([bytes(6)])]);
      const t = shtWord(raw, 0), rh = shtWord(raw, 3);
      if (t === undefined || rh === undefined) throw new Error("ENV III: SHT30 checksum mismatch");
      const { celsius, pascals } = qmpCompensate(this.calibration, await this.qmp.run([read(0xf7, [bytes(6)])]));
      return { celsius: -45 + 175 * t / 65535, humidity: 100 * rh / 65535, pascals, qmpCelsius: celsius };
    });
  }

  close(): void {
    this.sht.close(); this.qmp.close();
  }
}

/** Dew point in Celsius (Magnus formula, valid -45..60 C). */
export function dewPoint(celsius: number, humidity: number): number {
  const gamma = Math.log(Math.max(humidity, 0.01) / 100) + 17.62 * celsius / (243.12 + celsius);
  return 243.12 * gamma / (17.62 - gamma);
}

/** Barometric altitude in metres against 101325 Pa at sea level. */
export function altitude(pascals: number): number {
  return 44330 * (1 - Math.pow(pascals / 101325, 1 / 5.255));
}

// ---- SHT30 ---------------------------------------------------------------

/** Sensirion CRC-8: polynomial 0x31, initial value 0xFF. */
function crc8(data: Uint8Array, offset: number, length: number): number {
  let crc = 0xff;
  for (let i = offset; i < offset + length; ++i) {
    crc ^= data[i]!;
    for (let bit = 0; bit < 8; ++bit) crc = crc & 0x80 ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
  }
  return crc;
}

/** A 16-bit word followed by its CRC, or undefined when the CRC is wrong. */
function shtWord(raw: Uint8Array, offset: number): number | undefined {
  if (raw.length < offset + 3) return undefined;
  return crc8(raw, offset, 2) === raw[offset + 2] ? (raw[offset]! << 8) | raw[offset + 1]! : undefined;
}

// ---- QMP6988 -------------------------------------------------------------

interface QmpCalibration {
  a0: number; a1: number; a2: number;
  b00: number; bt1: number; bt2: number; bp1: number; b11: number; bp2: number; b12: number; b21: number; bp3: number;
}

/** The 25 OTP bytes from 0xA0. a0 and b00 are 20 bits wide (their low
 *  nibbles share byte 24) and convert as OTP / 16; the others are 16 bits,
 *  big endian, and convert as A + S * OTP / 32767 (datasheet table). */
function qmpCalibration(otp: Uint8Array): QmpCalibration {
  const s16 = (offset: number) => { const value = (otp[offset]! << 8) | otp[offset + 1]!; return value & 0x8000 ? value - 0x10000 : value; };
  const s20 = (value: number) => (value & 0x80000 ? value - 0x100000 : value);
  const k = (a: number, s: number, offset: number) => a + s * s16(offset) / 32767;
  return {
    b00: s20((otp[0]! << 12) | (otp[1]! << 4) | (otp[24]! >> 4)) / 16,
    bt1: k(1.0e-1, 9.1e-2, 2), bt2: k(1.2e-8, 1.2e-6, 4), bp1: k(3.3e-2, 1.9e-2, 6),
    b11: k(2.1e-7, 1.4e-7, 8), bp2: k(-6.3e-10, 3.5e-10, 10), b12: k(2.9e-13, 7.6e-13, 12),
    b21: k(2.1e-15, 1.2e-14, 14), bp3: k(1.3e-16, 7.9e-17, 16),
    a0: s20((otp[18]! << 12) | (otp[19]! << 4) | (otp[24]! & 0x0f)) / 16,
    a1: k(-6.3e-3, 4.3e-4, 20), a2: k(-1.9e-11, 1.2e-10, 22),
  };
}

/** Registers 0xF7..0xFC: pressure then temperature, 24 bits each, offset by
 *  2^23. Tr is the temperature in 1/256 C; the pressure polynomial takes it. */
function qmpCompensate(cal: QmpCalibration, raw: Uint8Array): { celsius: number; pascals: number } {
  const dp = ((raw[0]! << 16) | (raw[1]! << 8) | raw[2]!) - 0x800000;
  const dt = ((raw[3]! << 16) | (raw[4]! << 8) | raw[5]!) - 0x800000;
  const tr = cal.a0 + cal.a1 * dt + cal.a2 * dt * dt;
  const pascals = cal.b00 + cal.bt1 * tr + cal.bp1 * dp + cal.b11 * tr * dp + cal.bt2 * tr * tr +
    cal.bp2 * dp * dp + cal.b12 * dp * tr * tr + cal.b21 * dp * dp * tr + cal.bp3 * dp * dp * dp;
  return { celsius: tr / 256, pascals };
}
