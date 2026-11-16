import { Sht30 } from "../chips/sht30.ts";
import { Qmp6988 } from "../chips/qmp6988.ts";
import type { UnitType } from "./unit.ts";

export const env3: UnitType = {
  id: "env3", name: "ENV III", sku: "U001-C",
  blurb: "Temperature, humidity, pressure",
  use: "A weather station, a greenhouse monitor, a comfort meter.",
  port: "A", addresses: [0x44, 0x70], size: [32, 24, 8],
  inputs: [
    { key: "celsius", label: "Air temperature", unit: "°C", min: -10, max: 60, default: 24.6 },
    { key: "humidity", label: "Relative humidity", unit: "%RH", min: 5, max: 98, default: 48 },
    { key: "pascals", label: "Pressure", unit: "Pa", min: 87_000, max: 108_000, default: 101_180 },
  ],
  driver: "kit/drivers/env3.ts",
  datasheet: `ENV III = SHT30 (0x44) + QMP6988 (0x70) on Port A.
SHT30: write command 0x24 0x00 (single shot, high repeatability), wait >= 16 ms, then a bare read of 6 bytes:
  T_hi T_lo CRC RH_hi RH_lo CRC. celsius = -45 + 175 * T / 65535; humidity = 100 * RH / 65535.
  CRC-8 polynomial 0x31, init 0xFF over each 2-byte word. The read is NACKed until the conversion is done.
QMP6988: chip id 0x5C at 0xD1. Read 25 OTP bytes at 0xA0, write CTRL_MEAS 0xF4 (forced mode) to convert,
  read 6 bytes at 0xF7 (pressure, temperature; 24-bit, offset 2^23), compensate with the datasheet polynomials.`,
  create() {
    const sht = new Sht30(), qmp = new Qmp6988();
    return {
      chips: [sht, qmp],
      set(key, value, now) {
        const number = Number(value);
        if (!Number.isFinite(number)) return;
        if (key === "celsius") { sht.celsius.set(number, now); qmp.celsius.set(number + 0.3, now); }
        else if (key === "humidity") sht.humidity.set(number, now);
        else if (key === "pascals") qmp.pascals.set(number, now);
      },
      state(now) {
        return { celsius: sht.celsius.read(now), humidity: sht.humidity.read(now), pascals: qmp.pascals.read(now) };
      },
    };
  },
};
