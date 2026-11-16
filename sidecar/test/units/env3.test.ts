import { expect, test } from "bun:test";
import { Rig, rejection, unanswered } from "./harness.ts";

interface Reading { celsius: number; humidity: number; pascals: number; qmpCelsius: number }

test("ENV III: identify, read, follow the room, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("env3", "identify")).toBe(false);
  expect((await rejection(rig.call("env3", "open"))).message).toContain("ENV III is not on Port A (expected at 0x44 and 0x70)");

  const unit = rig.plug("env3");
  expect(await rig.call("bus", "probe", [0x44, 0x45, 0x70])).toEqual([0x44, 0x70]);
  expect(await rig.call("env3", "open")).toBe(true);
  let reading = await rig.call<Reading>("env3", "read");
  expect(reading.celsius).toBeCloseTo(24.6, 0);
  expect(reading.humidity).toBeCloseTo(48, 0);
  expect(Math.abs(reading.pascals - 101_180)).toBeLessThan(15);
  expect(reading.qmpCelsius).toBeCloseTo(24.9, 0);

  unit.set("celsius", 38, rig.now); unit.set("humidity", 71, rig.now); unit.set("pascals", 98_650, rig.now);
  // The SHT30's package follows the air with a time constant of 5 s.
  await rig.advance(2);
  reading = await rig.call<Reading>("env3", "read");
  expect(reading.celsius).toBeGreaterThan(27);
  expect(reading.celsius).toBeLessThan(31);
  await rig.advance(45);
  reading = await rig.call<Reading>("env3", "read");
  expect(Math.abs(reading.celsius - 38)).toBeLessThan(0.2);
  expect(Math.abs(reading.humidity - 71)).toBeLessThan(1);
  expect(Math.abs(reading.pascals - 98_650)).toBeLessThan(15);
  expect(unit.state(rig.now).celsius as number).toBeCloseTo(38, 1);

  rig.unplug(unit);
  expect((await unanswered(rig, "env3", "read")).message).toContain("0x44");
});
