// End to end: pocket-m5's Unit Swap sample, unmodified, built as the bench
// builds a project and run on the simulated Tab5. Its RFID 2, ENV III and
// Ultrasonic drivers are the reference the chip models have to satisfy.
import { beforeAll, expect, test } from "bun:test";
import { cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOME } from "./home.ts";
import { boardChips } from "../../src/chips/board.ts";
import { Board, Tab5, boardBus, portABus, type LogLine } from "../../src/sim/tab5.ts";
import { unitType, type UnitInstance } from "../../src/units/index.ts";

const logs: string[] = [];
const buses = { sys: boardBus(), porta: portABus() };
let tab5: Tab5;

beforeAll(async () => {
  const { WORKSPACE } = await import("../../src/paths.ts");
  if (WORKSPACE !== HOME) throw new Error(`the workspace is ${WORKSPACE}, not the tests' own`);
  const { ensureWorkspace } = await import("../../src/workspace.ts");
  const { buildProject } = await import("../../src/build.ts");
  ensureWorkspace();
  const project = join(WORKSPACE, "unit-swap");
  cpSync(resolve(import.meta.dir, "../../../vendor/pocket-m5/apps/unit-swap"), project, { recursive: true });
  const result = await buildProject(project);
  if (!result.ok || !result.build) throw new Error(`unit-swap did not build:\n${result.output}`);
  boardChips(buses.sys);
  tab5 = new Tab5({ build: result.build, buses, board: new Board(), log: (line: LogLine) => { if (line.domain === "worker") logs.push(line.text); } });
  await tab5.boot();
}, 120_000);

async function run(seconds: number): Promise<void> {
  for (let frame = 0; frame < seconds * 30; ++frame) {
    if (!(await tab5.frame())) throw new Error(`the app failed: ${tab5.failure?.message}`);
  }
}
/** Runs until a worker log line matches, 20 s at most; the line. */
async function until(pattern: RegExp, from = 0): Promise<string> {
  for (let frame = 0; frame < 600; ++frame) {
    const line = logs.slice(from).find(text => pattern.test(text));
    if (line) return line;
    if (!(await tab5.frame())) throw new Error(`the app failed: ${tab5.failure?.message}`);
  }
  throw new Error(`no worker log matched ${pattern} in 20 s:\n${logs.slice(from).join("\n")}`);
}
function plug(id: string, inputs: Record<string, unknown> = {}): UnitInstance {
  const type = unitType(id)!, unit = type.create();
  for (const input of type.inputs) unit.set(input.key, inputs[input.key] ?? input.default, tab5.now);
  for (const chip of unit.chips) buses.porta.attach(chip, tab5.now);
  return unit;
}
function unplug(unit: UnitInstance): void {
  for (const chip of unit.chips) buses.porta.detach(chip);
}

test("Unit Swap's own RFID 2 driver reads cards from the WS1850S model", async () => {
  await run(1);
  const rfid = plug("rfid2");
  expect(await until(/^RFID 2: VersionReg/)).toBe("RFID 2: VersionReg 0x15, antenna on");
  await until(/^RFID 2 attached at 0x28/);
  await run(1);
  expect(logs.some(text => text.startsWith("RFID 2: card"))).toBe(false);

  // A MIFARE Classic 1K with text in block 4: authenticated with the default key and read.
  let mark = logs.length;
  const text = Array.from({ length: 16 }, (_, index) => "Hello Tab5".charCodeAt(index) || 0);
  rfid.set("card", { uid: [0xde, 0xad, 0xbe, 0xef], kind: "classic1k", blocks: { 4: text } }, tab5.now);
  expect(await until(/^RFID 2: card/, mark)).toBe("RFID 2: card DEADBEEF SAK 0x08 data 1");
  await run(1);
  expect(rfid.state(tab5.now)).toMatchObject({ field: true, writes: 0 });

  // Taken away, then an Ultralight with a 7-byte UID: two cascade levels.
  rfid.set("card", null, tab5.now);
  await run(1);
  mark = logs.length;
  rfid.set("card", { uid: [0x04, 0xa1, 0xb2, 0xc3, 0xd4, 0xe5, 0xf6], kind: "ultralight" }, tab5.now);
  expect(await until(/^RFID 2: card/, mark)).toBe("RFID 2: card 04A1B2C3D4E5F6 SAK 0x00 data 1");

  // A Classic card with another key A on sector 1: selected, authentication refused (data state 2).
  rfid.set("card", null, tab5.now);
  await run(1);
  mark = logs.length;
  rfid.set("card", { uid: [1, 2, 3, 4], kind: "classic1k", blocks: { 7: [1, 2, 3, 4, 5, 6, 0xff, 0x07, 0x80, 0x69, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff] } }, tab5.now);
  expect(await until(/^RFID 2: card/, mark)).toBe("RFID 2: card 01020304 SAK 0x08 data 2");

  mark = logs.length;
  unplug(rfid);
  await until(/^RFID 2 removed/, mark);
}, 120_000);

test("Unit Swap still runs ENV III and Ultrasonic", async () => {
  let mark = logs.length;
  const env = plug("env3");
  await until(/^ENV III attached at 0x44 0x70/, mark);
  const line = await until(/^ENV III: [\d.]+ C/, mark);
  const [, celsius, humidity, hectopascals] = /^ENV III: ([\d.]+) C ([\d.]+) %RH ([\d.]+) hPa/.exec(line)!;
  expect(Math.abs(Number(celsius) - 24.6)).toBeLessThan(0.3);
  expect(Math.abs(Number(humidity) - 48)).toBeLessThan(1.5);
  expect(Math.abs(Number(hectopascals) - 1011.8)).toBeLessThan(0.3);
  mark = logs.length;
  unplug(env);
  await until(/^ENV III removed/, mark);

  mark = logs.length;
  const sonic = plug("sonic", { millimetres: 235 });
  await until(/^Ultrasonic I2C attached at 0x57/, mark);
  const echo = await until(/^Ultrasonic: [\d.]+ mm/, mark);
  expect(Math.abs(Number(/^Ultrasonic: ([\d.]+) mm/.exec(echo)![1]) - 235)).toBeLessThan(2);
  unplug(sonic);
}, 120_000);
