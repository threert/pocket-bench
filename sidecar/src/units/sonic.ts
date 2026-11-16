import { Rcwl9620 } from "../chips/rcwl9620.ts";
import type { UnitType } from "./unit.ts";

export const sonic: UnitType = {
  id: "sonic", name: "Ultrasonic I2C", sku: "U098-B1",
  blurb: "Distance, 2 cm to 4.5 m",
  use: "A parking sensor, a height gauge, a hand-wave switch.",
  port: "A", addresses: [0x57], size: [56, 24, 15],
  inputs: [{ key: "millimetres", label: "Distance to the target", unit: "mm", min: 20, max: 4500, default: 600 }],
  driver: "kit/drivers/sonic.ts",
  datasheet: `Ultrasonic I2C = RCWL-9620 (0x57) on Port A.
Write the single byte 0x01 to trigger a measurement, wait 120 ms, then a bare read of 3 bytes:
the distance in micrometres, big endian (millimetres = value / 1000). Valid range 20..4500 mm.`,
  create() {
    const chip = new Rcwl9620();
    return {
      chips: [chip],
      set(key, value, now) { if (key === "millimetres" && Number.isFinite(Number(value))) chip.millimetres.set(Number(value), now); },
      state(now) { return { millimetres: chip.millimetres.read(now) }; },
    };
  },
};
