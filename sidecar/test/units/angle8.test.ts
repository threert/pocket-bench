import { expect, test } from "bun:test";
import { Rig, bytes, read, receive, transact, unanswered, write } from "./harness.ts";

interface Reading { knobs: number[]; switch: boolean }

test("8Angle: identify, knobs and switch, LEDs, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("angle8", "identify")).toBe(false);
  const unit = rig.plug("angle8");
  expect(await rig.call("angle8", "identify")).toBe(true);
  let reading = await rig.call<Reading>("angle8", "read");
  expect(reading.switch).toBe(false);
  for (const knob of reading.knobs) expect(Math.abs(knob - 0.5)).toBeLessThan(0.002);

  const positions = [0, 0.1, 0.25, 0.4, 0.6, 0.75, 0.9, 1];
  unit.set("knobs", positions, rig.now); unit.set("switch", 1, rig.now);
  await rig.advance(0.2);
  reading = await rig.call<Reading>("angle8", "read");
  expect(reading.switch).toBe(true);
  reading.knobs.forEach((knob, index) => expect(Math.abs(knob - positions[index]!)).toBeLessThan(0.002));
  expect(reading.knobs[0]).toBe(0);
  expect(reading.knobs[7]).toBe(1);
  expect(Math.abs(await rig.call<number>("angle8", "knob", 2) - 0.25)).toBeLessThan(0.002);
  expect((unit.state(rig.now).knobs as number[])[6]).toBeCloseTo(0.9, 3);

  // The firmware drives an LED at colour * brightness / 1000.
  await rig.call("angle8", "setLed", 3, 255, 128, 0);
  await rig.call("angle8", "setLed", 8, 0, 0, 200, 50);
  const leds = unit.state(rig.now).leds as number[][];
  expect(leds).toHaveLength(9);
  expect(leds[3]).toEqual([25, 12, 0]);
  expect(leds[8]).toEqual([0, 0, 10]);
  expect(leds[0]).toEqual([0, 0, 0]);
  await rig.call("angle8", "clearLeds");
  expect((unit.state(rig.now).leds as number[][])[3]).toEqual([0, 0, 0]);

  rig.unplug(unit);
  await unanswered(rig, "angle8", "read");
});

test("8Angle firmware: STOP before a read, one value a read, single-byte LED writes", async () => {
  const rig = await Rig.start();
  const unit = rig.plug("angle8", { knobs: [1, 0, 0, 0, 0, 0, 0, 0.5] });
  // As M5Stack's Arduino library reads: register, STOP, then the bytes.
  expect(transact(rig, 0x43, [write(0x00)]).ok).toBe(true);
  expect(transact(rig, 0x43, [receive([bytes(2)])]).data).toEqual([0xff, 0x0f]);
  expect(transact(rig, 0x43, [write(0x10)]).ok).toBe(true);
  expect(transact(rig, 0x43, [receive([bytes(1)])]).data).toEqual([255]);
  expect(transact(rig, 0x43, [write(0xfe)]).ok).toBe(true);
  expect(transact(rig, 0x43, [receive([bytes(1)])]).data).toEqual([1]);
  // A repeated START finds the register byte unprocessed: no answer.
  expect(transact(rig, 0x43, [read(0x10, [bytes(1)])]).ok).toBe(false);
  expect(transact(rig, 0x43, [write(0x17), receive([bytes(1)])]).ok).toBe(false);
  // The failed transaction's STOP hands the register over all the same.
  const eight = transact(rig, 0x43, [receive([bytes(1)])]).data[0]!;
  expect(Math.abs(eight - 127)).toBeLessThanOrEqual(1);
  // One byte to an LED register sets that channel alone, without the brightness scale.
  transact(rig, 0x43, [write(0x30 + 4 * 2 + 1, 0x40)]);
  expect((unit.state(rig.now).leds as number[][])[2]).toEqual([0, 0x40, 0]);
});
