import { expect, test } from "bun:test";
import { Bh1750 } from "../../src/chips/bh1750.ts";
import { Rig, unanswered } from "./harness.ts";

test("DLight: identify, read, follow the room, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("dlight", "identify")).toBe(false);
  const unit = rig.plug("dlight");
  expect(await rig.call("dlight", "identify")).toBe(true);
  const opened = rig.now;
  // The first read waits for the first conversion.
  expect(Math.abs(await rig.call<number>("dlight", "read") - 320)).toBeLessThan(8);
  expect(rig.now - opened).toBeGreaterThan(170_000);

  unit.set("lux", 12_000, rig.now);
  await rig.advance(0.4);
  expect(Math.abs(await rig.call<number>("dlight", "read") - 12_000)).toBeLessThan(250);
  expect(unit.state(rig.now).lux as number).toBeCloseTo(12_000, 0);

  // 16 bits at 1.2 counts a lux: high-resolution mode tops out at 54612 lx.
  unit.set("lux", 65_535, rig.now);
  await rig.advance(0.4);
  expect(await rig.call<number>("dlight", "read")).toBeCloseTo(65_535 / 1.2, 3);

  rig.unplug(unit);
  await unanswered(rig, "dlight", "read");
});

test("BH1750: one-time modes, resolution, measurement time", () => {
  const chip = new Bh1750();
  chip.reset(0);
  chip.lux.jump(1000, 0);
  const word = (at: number) => { const raw = chip.read(2, at); return (raw[0]! << 8) | raw[1]!; };
  expect(word(0)).toBe(0);
  // One-time high resolution: nothing before 120 ms, then the result stays.
  chip.write(Uint8Array.of(0x20), 1_000);
  expect(word(100_000)).toBe(0);
  const once = word(130_000);
  expect(Math.abs(once / 1.2 - 1000)).toBeLessThan(20);
  chip.lux.jump(5000, 200_000);
  expect(word(900_000)).toBe(once);
  // High resolution 2 counts twice as fine; low resolution is done in 16 ms, in steps of 4 lx.
  chip.write(Uint8Array.of(0x11), 1_000_000);
  expect(Math.abs(word(1_130_000) / 2.4 - 5000)).toBeLessThan(100);
  chip.write(Uint8Array.of(0x13), 2_000_000);
  expect(Math.abs(word(2_020_000) / 1.2 - 5000)).toBeLessThan(100);
  expect(word(2_020_000) % 4).toBe(0);
  // MTreg 138 doubles time and sensitivity.
  chip.write(Uint8Array.of(0x44), 3_000_000);
  chip.write(Uint8Array.of(0x6a), 3_000_000);
  chip.write(Uint8Array.of(0x10), 3_000_000);
  const stale = word(3_130_000);
  expect(Math.abs(word(3_250_000) / 1.2 * 69 / 138 - 5000)).toBeLessThan(100);
  expect(stale).not.toBe(word(3_250_000));
  // Power down stops the conversions; reset clears the register only while powered.
  chip.write(Uint8Array.of(0x00), 4_000_000);
  chip.write(Uint8Array.of(0x07), 4_000_000);
  expect(word(4_500_000)).toBeGreaterThan(0);
  chip.write(Uint8Array.of(0x01), 5_000_000);
  chip.write(Uint8Array.of(0x07), 5_000_000);
  expect(word(5_000_100)).toBe(0);
});
