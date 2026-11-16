import { expect, test } from "bun:test";
import { Rig, bytes, read, transact, unanswered, write } from "./harness.ts";

interface Reading { grams: number; button: boolean }

test("Mini Scales: identify, weight with its settling, tare, button, LED, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("scales", "identify")).toBe(false);
  const unit = rig.plug("scales");
  expect(await rig.call("scales", "identify")).toBe(true);
  // A 4-Relay would answer on the same address; this is not one.
  expect(await rig.call("relay4", "identify")).toBe(false);
  let reading = await rig.call<Reading>("scales", "read");
  expect(Math.abs(reading.grams)).toBeLessThan(0.1);
  expect(reading.button).toBe(false);

  unit.set("grams", 250, rig.now); unit.set("button", 1, rig.now);
  await rig.advance(0.08);
  reading = await rig.call<Reading>("scales", "read");
  // The pan is still settling.
  expect(reading.grams).toBeGreaterThan(80);
  expect(reading.grams).toBeLessThan(200);
  expect(reading.button).toBe(true);
  await rig.advance(1);
  reading = await rig.call<Reading>("scales", "read");
  expect(Math.abs(reading.grams - 250)).toBeLessThan(0.2);
  expect(unit.state(rig.now).grams as number).toBeCloseTo(250, 1);

  // Tare with the load on, then add to it.
  await rig.call("scales", "tare");
  expect(Math.abs((await rig.call<Reading>("scales", "read")).grams)).toBeLessThan(0.2);
  unit.set("grams", 262.5, rig.now);
  await rig.advance(1);
  expect(Math.abs((await rig.call<Reading>("scales", "read")).grams - 12.5)).toBeLessThan(0.2);

  // Calibration: the gap is raw counts a gram.
  const loaded = await rig.call<number>("scales", "raw");
  unit.set("grams", 0, rig.now);
  await rig.advance(1);
  const empty = await rig.call<number>("scales", "raw");
  await rig.call("scales", "calibrate", empty, loaded, 525);
  await rig.call("scales", "tare");
  unit.set("grams", 100, rig.now);
  await rig.advance(1);
  expect(Math.abs((await rig.call<Reading>("scales", "read")).grams - 200)).toBeLessThan(0.5);

  await rig.call("scales", "setLed", 0, 255, 64);
  expect(unit.state(rig.now).led).toEqual([0, 255, 64]);

  rig.unplug(unit);
  await unanswered(rig, "scales", "read");
});

test("Mini Scales registers, as M5Stack's library reads them", async () => {
  const rig = await Rig.start();
  // The offset is taken at power-on: the load that is on the pan reads 0.
  const unit = rig.plug("scales", { grams: 40 });
  const f32 = (data: number[]) => new DataView(Uint8Array.from(data).buffer).getFloat32(0, true);
  const i32 = (data: number[]) => new DataView(Uint8Array.from(data).buffer).getInt32(0, true);
  expect(Math.abs(f32(transact(rig, 0x26, [read(0x10, [bytes(4)])]).data))).toBeLessThan(0.1);
  unit.set("grams", 163.21, rig.now);
  await rig.advance(1.5);
  const grams = f32(transact(rig, 0x26, [read(0x10, [bytes(4)])]).data);
  expect(Math.abs(grams - 123.21)).toBeLessThan(0.1);
  expect(Math.abs(i32(transact(rig, 0x26, [read(0x60, [bytes(4)])]).data) - 12_321)).toBeLessThan(10);
  const text = transact(rig, 0x26, [read(0x70, [bytes(16)])]).data;
  expect(Math.abs(Number(String.fromCharCode(...text.slice(0, text.indexOf(0)))) - 123.21)).toBeLessThan(0.1);
  expect(f32(transact(rig, 0x26, [read(0x40, [bytes(4)])]).data)).toBeCloseTo(429.5, 3);
  expect(transact(rig, 0x26, [read(0x80, [bytes(3)])]).data).toEqual([1, 10, 10]);
  transact(rig, 0x26, [write(0x81, 25)]);
  expect(transact(rig, 0x26, [read(0x80, [bytes(3)])]).data).toEqual([1, 25, 10]);
  expect(transact(rig, 0x26, [read(0x20, [bytes(1)])]).data).toEqual([1]);
  expect(transact(rig, 0x26, [read(0xff, [bytes(1)])]).data).toEqual([0x26]);
  transact(rig, 0x26, [write(0x30, 1, 2, 3)]);
  expect(transact(rig, 0x26, [read(0x30, [bytes(3)])]).data).toEqual([1, 2, 3]);
});
