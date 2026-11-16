import { expect, test } from "bun:test";
import { Rig, unanswered } from "./harness.ts";

test("Ultrasonic I2C: identify, read, out of range, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("sonic", "identify")).toBe(false);
  const unit = rig.plug("sonic");
  expect(await rig.call("sonic", "identify")).toBe(true);
  expect(Math.abs(await rig.call<number>("sonic", "read") - 600)).toBeLessThan(4);

  unit.set("millimetres", 235, rig.now);
  await rig.advance(0.5);
  const before = rig.now;
  expect(Math.abs(await rig.call<number>("sonic", "read") - 235)).toBeLessThan(2);
  // The trigger, 120 ms for the echo, the read.
  expect(rig.now - before).toBeGreaterThan(120_000);
  expect(unit.state(rig.now).millimetres as number).toBeCloseTo(235, 0);

  unit.set("millimetres", 6000, rig.now);
  await rig.advance(0.5);
  expect(await rig.call("sonic", "read")).toBeUndefined();
  expect(await rig.call<number>("sonic", "raw")).toBeGreaterThan(4500);

  rig.unplug(unit);
  await unanswered(rig, "sonic", "read");
});
