import { expect, test } from "bun:test";
import { Rig, bytes, read, receive, transact, unanswered, write } from "./harness.ts";

interface Reading { steps: number; button: boolean }

test("Encoder: identify, steps and button, LEDs, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("encoder", "identify")).toBe(false);
  // The knob has been turned before: the counter still starts at 0.
  const unit = rig.plug("encoder", { steps: 40 });
  expect(await rig.call("encoder", "identify")).toBe(true);
  expect(await rig.call<Reading>("encoder", "read")).toEqual({ steps: 0, button: false });

  unit.set("steps", 45, rig.now); unit.set("button", 1, rig.now);
  expect(await rig.call<Reading>("encoder", "read")).toEqual({ steps: 5, button: true });
  unit.set("steps", 37, rig.now); unit.set("button", 0, rig.now);
  expect(await rig.call<Reading>("encoder", "read")).toEqual({ steps: -3, button: false });
  expect(unit.state(rig.now)).toMatchObject({ steps: 37, button: 0 });

  // Past the 16-bit counter's wrap, a little at a time.
  for (let steps = 37; steps <= 37 + 20_000; steps += 4000) {
    unit.set("steps", steps, rig.now);
    await rig.call("encoder", "read");
  }
  expect((await rig.call<Reading>("encoder", "read")).steps).toBe(19_997);
  await rig.call("encoder", "zero");
  expect((await rig.call<Reading>("encoder", "read")).steps).toBe(0);

  await rig.call("encoder", "setLed", 1, 255, 0, 10);
  expect(unit.state(rig.now).leds).toEqual([[255, 0, 10], [0, 0, 0]]);
  await rig.call("encoder", "setLed", 2, 1, 2, 3);
  expect(unit.state(rig.now).leds).toEqual([[255, 0, 10], [1, 2, 3]]);
  await rig.call("encoder", "setLed", 0, 0, 90, 0);
  expect(unit.state(rig.now).leds).toEqual([[0, 90, 0], [0, 90, 0]]);

  rig.unplug(unit);
  await unanswered(rig, "encoder", "read");
});

test("Encoder firmware: two counts a detent, modes, counter write, STOP before a read", async () => {
  const rig = await Rig.start();
  const unit = rig.plug("encoder");
  const counter = () => {
    expect(transact(rig, 0x40, [write(0x10)]).ok).toBe(true);
    const raw = transact(rig, 0x40, [receive([bytes(2)])]).data;
    return ((raw[0]! | (raw[1]! << 8)) << 16) >> 16;
  };
  unit.set("steps", 3, rig.now);
  expect(counter()).toBe(6);
  unit.set("steps", -2, rig.now);
  expect(counter()).toBe(-4);
  expect(transact(rig, 0x40, [read(0x10, [bytes(2)])]).ok).toBe(false);
  // The counter is writable, and 0x40 zeroes it.
  transact(rig, 0x40, [write(0x10, 0x10, 0x27)]);
  expect(counter()).toBe(10_000);
  transact(rig, 0x40, [write(0x40, 1)]);
  expect(counter()).toBe(0);
  // Mode 1 counts the rising edges of one signal, upwards in both directions.
  transact(rig, 0x40, [write(0x00, 1)]);
  unit.set("steps", 8, rig.now);
  unit.set("steps", 2, rig.now);
  expect(counter()).toBe(8);
  transact(rig, 0x40, [write(0x00, 0)]);
  expect(counter()).toBe(0);
  // The switch register is the pin: 1 released, 0 pressed.
  transact(rig, 0x40, [write(0x20)]);
  expect(transact(rig, 0x40, [receive([bytes(1)])]).data).toEqual([1]);
});
