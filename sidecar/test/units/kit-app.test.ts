// The kit's drivers inside a real project: copied into it as the bench copies
// them, compiled by the PocketJS compiler for the Tab5 (its type check, the
// worker bundle, QuickJS bytecode) and run on the simulated board.
import { beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOME } from "./home.ts";
import { Board, Tab5, boardBus, portABus, type LogLine } from "../../src/sim/tab5.ts";
import { unitType, type UnitInstance } from "../../src/units/index.ts";

const ROOT = resolve(import.meta.dir, "../../..");
const MAIN = `import { AuxiliarySurface, Text, View } from "@pocketjs/framework/components";
import { setSwitch } from "@pocketjs/framework/device";
import { mount } from "@pocketjs/framework/solid";

mount(() => {
  // Port A's units take their supply from EXT 5V.
  setSwitch("ext-5v", true);
  return <AuxiliarySurface>
    <View class="absolute" style={{ insetL: 0, insetT: 0, width: 640, height: 360, bgColor: "#0d1117" }}>
      <Text class="absolute text-xl font-bold" style={{ insetL: 16, insetT: 12, width: 400, textColor: "#e6edf3" }}>Kit drivers</Text>
    </View>
  </AuxiliarySurface>;
});
`;
const WORKER = `import { sleep } from "@pocketjs/framework/worker";
import { PortA, message } from "./drivers/bus";
import { Angle8 } from "./drivers/angle8";
import { DLight } from "./drivers/dlight";
import { Encoder } from "./drivers/encoder";
import { Env3 } from "./drivers/env3";
import { Joystick2 } from "./drivers/joystick2";
import { Ncir } from "./drivers/ncir";
import { Relay4 } from "./drivers/relay4";
import { Rfid2 } from "./drivers/rfid2";
import { Scales } from "./drivers/scales";
import { Sonic } from "./drivers/sonic";

const bus = new PortA();
const DRIVERS = { Angle8, DLight, Encoder, Env3, Joystick2, Ncir, Relay4, Rfid2, Scales, Sonic };

/** A thermostat with a setpoint knob: the relay closes below it. */
async function thermostat(): Promise<void> {
  const env = await Env3.identify(bus);
  if (!env) return;
  let knobs: Angle8 | undefined, relays: Relay4 | undefined;
  try {
    knobs = await Angle8.open(bus);
    relays = await Relay4.open(bus);
    console.log("thermostat: units found");
    for (;;) {
      const { celsius } = await env.read();
      const setpoint = 10 + 30 * await knobs.knob(0);
      const heat = celsius < setpoint;
      await relays.set(0, heat);
      await knobs.setLed(0, heat ? 255 : 0, 0, heat ? 0 : 255);
      console.log(\`thermostat: \${celsius.toFixed(1)} C, setpoint \${setpoint.toFixed(1)} C, heat \${heat ? "on" : "off"}\`);
      await sleep(250_000);
    }
  } finally {
    env.close(); knobs?.close(); relays?.close();
  }
}

async function main(): Promise<void> {
  await sleep(0);
  console.log(\`kit worker: \${Object.keys(DRIVERS).length} drivers\`);
  for (;;) {
    try {
      await thermostat();
    } catch (error) {
      console.log(\`thermostat stopped: \${message(error)}\`);
    }
    await sleep(200_000);
  }
}
void main();
`;

const logs: string[] = [];
const buses = { sys: boardBus(), porta: portABus() };
let tab5: Tab5;

beforeAll(async () => {
  const { WORKSPACE } = await import("../../src/paths.ts");
  if (WORKSPACE !== HOME) throw new Error(`the workspace is ${WORKSPACE}, not the tests' own`);
  const { ensureWorkspace } = await import("../../src/workspace.ts");
  const { buildProject } = await import("../../src/build.ts");
  ensureWorkspace();
  const project = join(WORKSPACE, "kit-app");
  mkdirSync(project, { recursive: true });
  cpSync(join(ROOT, "kit/drivers"), join(project, "drivers"), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(ROOT, "vendor/pocket-m5/apps/unit-swap/pocket.app.json"), "utf8"));
  manifest.id = "bench.test.kit-app"; manifest.title = "Kit drivers"; manifest.app.output = "kit-app";
  manifest.domains.worker = { entry: "worker.ts", nodes: [{ name: "porta", kind: "i2c" }] };
  writeFileSync(join(project, "pocket.app.json"), JSON.stringify(manifest, null, 2));
  writeFileSync(join(project, "main.tsx"), MAIN);
  writeFileSync(join(project, "worker.ts"), WORKER);
  const result = await buildProject(project);
  if (!result.ok || !result.build) throw new Error(`the kit app did not build:\n${result.output}`);
  tab5 = new Tab5({ build: result.build, buses, board: new Board(), log: (line: LogLine) => { if (line.domain === "worker") logs.push(line.text); } });
  await tab5.boot();
}, 120_000);

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

test("an app built from the kit's drivers runs three units together", async () => {
  expect(await until(/^kit worker/)).toBe("kit worker: 10 drivers");
  const knobs = plug("angle8", { knobs: [0.8, 0, 0, 0, 0, 0, 0, 0] });
  const relays = plug("relay4");
  const env = plug("env3");
  await until(/^thermostat: units found/);
  // 24.6 C in the room, the knob at 0.8 asks for 34 C: the heater's relay closes.
  expect(await until(/^thermostat: 24\.\d C, setpoint 34\.0 C, heat on/)).toBeTruthy();
  expect(relays.state(tab5.now)).toMatchObject({ relays: [true, false, false, false], leds: [true, false, false, false], sync: true });
  expect((knobs.state(tab5.now).leds as number[][])[0]).toEqual([25, 0, 0]);

  let mark = logs.length;
  knobs.set("knobs", [0.2, 0, 0, 0, 0, 0, 0, 0], tab5.now);
  await until(/^thermostat: .* setpoint 16\.0 C, heat off/, mark);
  expect(relays.state(tab5.now).relays).toEqual([false, false, false, false]);
  expect((knobs.state(tab5.now).leds as number[][])[0]).toEqual([0, 0, 25]);

  // A unit pulled mid-loop: the driver's read rejects, the app catches it and starts over.
  mark = logs.length;
  for (const chip of env.chips) buses.porta.detach(chip);
  expect(await until(/^thermostat stopped/, mark)).toContain("nothing answered at 0x44 on Port A");
  mark = logs.length;
  for (const chip of env.chips) buses.porta.attach(chip, tab5.now);
  await until(/^thermostat: units found/, mark);
}, 120_000);
