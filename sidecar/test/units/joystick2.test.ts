import { expect, test } from "bun:test";
import { Rig, bytes, read, transact, unanswered, write } from "./harness.ts";

interface Reading { x: number; y: number; button: boolean }

test("Joystick2: identify, stick and button, LED, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("joystick2", "identify")).toBe(false);
  const unit = rig.plug("joystick2");
  expect(await rig.call("joystick2", "identify")).toBe(true);
  // At rest the firmware's dead band gives exactly 0.
  expect(await rig.call<Reading>("joystick2", "read")).toEqual({ x: 0, y: 0, button: false });
  const rest = await rig.call<{ x: number; y: number }>("joystick2", "raw");
  expect(Math.abs(rest.x - 33_665)).toBeLessThan(120);

  unit.set("x", 0.5, rig.now); unit.set("y", -1, rig.now); unit.set("button", 1, rig.now);
  await rig.advance(0.1);
  let reading = await rig.call<Reading>("joystick2", "read");
  expect(Math.abs(reading.x - 0.5)).toBeLessThan(0.01);
  expect(reading.y).toBeLessThan(-0.99);
  expect(reading.button).toBe(true);
  expect(unit.state(rig.now).y as number).toBeCloseTo(-1, 3);
  expect(unit.state(rig.now).button).toBe(1);

  unit.set("x", -0.25, rig.now); unit.set("y", 1, rig.now); unit.set("button", 0, rig.now);
  await rig.advance(0.1);
  reading = await rig.call<Reading>("joystick2", "read");
  expect(Math.abs(reading.x + 0.25)).toBeLessThan(0.01);
  expect(reading.y).toBeGreaterThan(0.99);
  expect(reading.button).toBe(false);

  await rig.call("joystick2", "setLed", 10, 200, 30);
  expect(unit.state(rig.now).led).toEqual([10, 200, 30]);

  rig.unplug(unit);
  await unanswered(rig, "joystick2", "read");
});

test("Joystick2 firmware: repeated START, register groups, calibration", async () => {
  const rig = await Rig.start();
  const unit = rig.plug("joystick2", { x: 1, y: 0 });
  // M5Stack's Arduino library reads after a repeated START.
  const raw = transact(rig, 0x63, [read(0x00, [bytes(4)])]);
  expect(raw.ok).toBe(true);
  expect(Math.abs((raw.data[0]! | (raw.data[1]! << 8)) - 65_440)).toBeLessThan(120);
  // A read from inside a group returns the rest of it: 0x02 is Y.
  const y = transact(rig, 0x63, [read(0x02, [bytes(2)])]).data;
  expect(Math.abs((y[0]! | (y[1]! << 8)) - 33_665)).toBeLessThan(120);
  expect(transact(rig, 0x63, [read(0x60, [bytes(2)])]).data).toEqual([127, 0]);
  expect(transact(rig, 0x63, [read(0x20, [bytes(1)])]).data).toEqual([1]);
  expect(transact(rig, 0x63, [read(0xff, [bytes(1)])]).data).toEqual([0x63]);
  // The LED register is 0x00RRGGBB, little endian; M5Stack's library writes four bytes.
  transact(rig, 0x63, [write(0x30, 0x33, 0x22, 0x11, 0x00)]);
  expect(unit.state(rig.now).led).toEqual([0x11, 0x22, 0x33]);
  expect(transact(rig, 0x63, [read(0x30, [bytes(4)])]).data).toEqual([0x33, 0x22, 0x11, 0x00]);
  // The calibration maps raw values to -4095..4095: with the positive range
  // cut to half the travel, half deflection already reads full scale.
  const cal = transact(rig, 0x63, [read(0x40, [bytes(16)])]).data;
  expect(cal.slice(0, 8)).toEqual([130, 0, 0x32, 0x82, 0xd0, 0x84, 0xa0, 0xff]);
  unit.set("x", 0.5, rig.now);
  await rig.advance(0.1);
  const before = transact(rig, 0x63, [read(0x50, [bytes(2)])]).data;
  expect(Math.abs((before[0]! | (before[1]! << 8)) - 2047)).toBeLessThan(12);
  const top = 34_000 + (65_440 - 34_000) / 2;
  transact(rig, 0x63, [write(0x46, top & 0xff, top >> 8)]);
  const after = transact(rig, 0x63, [read(0x50, [bytes(2)])]).data;
  expect(after[0]! | (after[1]! << 8)).toBeGreaterThan(4080);
});
