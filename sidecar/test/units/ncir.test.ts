import { expect, test } from "bun:test";
import { Mlx90614, pec } from "../../src/chips/mlx90614.ts";
import { Rig, unanswered } from "./harness.ts";

interface Reading { objectCelsius: number; ambientCelsius: number }

test("NCIR: identify, read, follow the room, unplug", async () => {
  const rig = await Rig.start();
  expect(await rig.call("ncir", "identify")).toBe(false);
  const unit = rig.plug("ncir", { objectCelsius: 36.6 });
  expect(await rig.call("ncir", "identify")).toBe(true);
  let reading = await rig.call<Reading>("ncir", "read");
  expect(Math.abs(reading.objectCelsius - 36.6)).toBeLessThan(0.1);
  expect(Math.abs(reading.ambientCelsius - 24.5)).toBeLessThan(0.1);

  unit.set("objectCelsius", 182, rig.now); unit.set("ambientCelsius", 31, rig.now);
  await rig.advance(1.5);
  reading = await rig.call<Reading>("ncir", "read");
  expect(Math.abs(reading.objectCelsius - 182)).toBeLessThan(0.1);
  // The package warms slowly: 3 s time constant.
  expect(reading.ambientCelsius).toBeGreaterThan(25.5);
  expect(reading.ambientCelsius).toBeLessThan(29.5);
  await rig.advance(25);
  reading = await rig.call<Reading>("ncir", "read");
  expect(Math.abs(reading.ambientCelsius - 31)).toBeLessThan(0.1);
  expect(unit.state(rig.now).objectCelsius as number).toBeCloseTo(182, 1);

  rig.unplug(unit);
  await unanswered(rig, "ncir", "read");
});

test("MLX90614: SMBus read word, PEC, EEPROM, sleep", () => {
  const chip = new Mlx90614();
  chip.reset(0);
  chip.object.jump(100, 0);
  // Command, repeated START, word and PEC.
  chip.write(Uint8Array.of(0x07), 10);
  const frame = chip.read(3, 10);
  chip.stop();
  expect((frame[0]! | (frame[1]! << 8)) * 0.02 - 273.15).toBeCloseTo(100, 0);
  expect(frame[2]).toBe(pec([0xb4, 0x07, 0xb5, frame[0]!, frame[1]!]));
  // A STOP after the command ends the transaction: the read finds no command.
  chip.write(Uint8Array.of(0x07), 20);
  chip.stop();
  expect(Array.from(chip.read(3, 20))).toEqual([0xff, 0xff, 0xff]);
  // The emissivity cell takes a word with a valid PEC only.
  expect(chip.write(Uint8Array.of(0x24, 0x00, 0x80, 0x00), 30)).toBe(false);
  expect(chip.write(Uint8Array.of(0x24, 0x00, 0x80, pec([0xb4, 0x24, 0x00, 0x80])), 30)).toBe(true);
  chip.stop();
  chip.write(Uint8Array.of(0x24), 40);
  expect(Array.from(chip.read(2, 40))).toEqual([0x00, 0x80]);
  chip.stop();
  // Sleep: no acknowledge until the supply cycles.
  expect(chip.write(Uint8Array.of(0xff, pec([0xb4, 0xff])), 50)).toBe(true);
  expect(chip.acks()).toBe(false);
  chip.reset(60);
  expect(chip.acks()).toBe(true);
});
