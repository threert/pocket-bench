// `bench`: the coding agent's command line to the running bench. It talks to
// the sidecar over HTTP on the loopback (the port is in
// <workspace>/.bench/server.json) and prints plain text for a model to read.
// Reference: kit/docs/bench-cli.md. Exit status: 0, 1 when the build or the
// app is broken or the bench refused, 2 for a wrong command line or no bench.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inside, real } from "../agent/policy.ts";
import { WORKSPACE } from "../paths.ts";

const USAGE = `bench: the Pocket Bench the project runs on
  bench check                   wait for the build, then: build, app fault, last logs, texts on the screen
  bench shot [file.png]         save the Tab5's screen (1280x720) and print the path
  bench texts                   the texts on the screen: x,y WxH "text"
  bench logs [-n N]             the last N log lines (40)
  bench state                   phase, plugged units with their live values, the board
  bench units                   the plugged units: inputs, datasheet notes, driver
  bench catalog                 every unit the room has
  bench set <uid> <key> <json>  act on a unit as the room would: bench set env3-1 celsius 35
  bench tap <x> <y>             touch the screen (0..639, 0..359)
  bench type <text>             type on the keyboard
  bench plug <type> [uid]       plug a unit into Port A
  bench unplug <uid>            pull it
  bench wait <seconds>          let the app run (10 at most)`;

interface Problem { file?: string; line?: number; column?: number; message: string }
interface Plugged { uid: string; type: string; inputs: Record<string, unknown> }
interface State {
  project: { name: string; path: string; title: string } | null;
  phase: string; units: Plugged[]; problems: Problem[]; failure: { domain: string; message: string; stack: string } | null;
  buildMs: number; builds: number;
  sim: { at: number; frames: number; units: Record<string, Record<string, unknown>>; board: { brightness: number; volume: number; switches: Record<string, boolean>; pins: Record<string, number> } } | null;
}
interface Unit {
  id: string; name: string; sku: string; blurb: string; use: string; port: string; addresses: number[];
  inputs: { key: string; label: string; unit: string; min: number; max: number; default: number }[]; datasheet: string; driver?: string;
}
interface Log { at: number; domain: string; level: string; text: string }

class Stop extends Error { constructor(message: string, readonly status = 1) { super(message); } }

const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));
const hex = (address: number) => `0x${address.toString(16).toUpperCase().padStart(2, "0")}`;
const number = (value: unknown) => typeof value === "number" ? String(Math.round(value * 100) / 100) : JSON.stringify(value);
const pairs = (record: Record<string, unknown>) => Object.entries(record).map(([key, value]) => `${key}=${number(value)}`).join(" ");

let base = "";
let token = "";
function connect(): void {
  const file = join(WORKSPACE, ".bench", "server.json");
  try { const server = JSON.parse(readFileSync(file, "utf8")); base = `http://127.0.0.1:${server.port}`; token = server.token; } catch { throw new Stop(`The bench is not running (no ${file}). Open Pocket Bench.`, 2); }
}
async function call(path: string, body?: unknown): Promise<Response> {
  try {
    const headers = { authorization: `Bearer ${token}` };
    return await fetch(`${base}/api/${path}`, body === undefined ? { headers } : { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Stop(`The bench does not answer at ${base}. Open Pocket Bench. (A sandbox that blocks the loopback also ends here: run bench outside it.)`, 2);
  }
}
const get = async <T>(path: string): Promise<T> => await (await call(path)).json() as T;
/** A message for the sidecar, as the app would send it; the replies come back. */
async function send(message: Record<string, unknown>): Promise<Record<string, unknown>[]> {
  const replies = await (await call("send", message)).json() as Record<string, unknown>[];
  const error = replies.find(reply => reply.t === "error");
  if (error) throw new Stop(String(error.message));
  return replies;
}
async function state(): Promise<State> {
  const now = await get<State>("state");
  if (!now.project) throw new Stop("No project is open on the bench.");
  return now;
}
async function texts(): Promise<string> { return (await (await call("texts")).text()).trimEnd(); }

function logLine(line: Log): string {
  return `  ${(line.at / 1e6).toFixed(2).padStart(7)}s ${line.domain.padEnd(6)} ${line.level === "info" || line.level === "log" ? "" : `${line.level} `}${line.text}`;
}

/** The build and the app, as text. False when either is broken. */
function report(now: State, out: string[]): boolean {
  const project = now.project!;
  // file:line message, the file as the project names it (the compiler prints full paths, some inside the message).
  const line = (problem: Problem) => {
    const text = `${problem.file ? `${problem.file}:${problem.line ?? 0}${problem.column ? `:${problem.column}` : ""} ` : ""}${problem.message}`;
    return text.replace(/^PocketJS: /, "").split(`${project.path}/`).join("").split(`${real(project.path)}/`).join("");
  };
  if (now.problems.length) {
    out.push(`build FAILED (build ${now.builds})${now.phase === "running" ? "; the last good build keeps running" : ""}`);
    for (const problem of now.problems.slice(0, 20)) out.push(`  ${line(problem)}`);
    if (now.problems.length > 20) out.push(`  and ${now.problems.length - 20} more`);
  } else out.push(`build ok (build ${now.builds}, ${(now.buildMs / 1000).toFixed(1)} s)`);
  if (now.failure) {
    out.push(`app FAULT in ${now.failure.domain}: ${now.failure.message}`);
    for (const line of now.failure.stack.split("\n").map(line => line.trim()).filter(line => line && !now.failure!.message.includes(line)).slice(0, 4)) out.push(`  ${line}`);
  } else if (now.phase === "running") out.push(`app running${now.sim ? `, ${(now.sim.at / 1e6).toFixed(1)} s up` : ""}`);
  else out.push(`app ${now.phase}`);
  return !now.problems.length && !now.failure && now.phase === "running";
}

/** Waits until the bench shows what the files on disk are: no build running, and an app booted a moment ago past its first second. */
async function settled(): Promise<State> {
  const clock = (at: State) => at.sim?.at ?? -1;
  let before = await state();
  // A file saved a moment ago starts its build after the watcher's 250 ms.
  await sleep(350);
  let now = await state(), built = now.builds !== before.builds;
  const deadline = Date.now() + 120_000;
  while (now.phase === "building" && Date.now() < deadline) { built = true; before = now; await sleep(150); now = await state(); }
  const wait = async (ms: number, more: () => boolean) => {
    for (const until = Date.now() + ms; more() && now.phase === "running" && !now.failure && Date.now() < until;) { await sleep(100); now = await state(); }
  };
  // A good build boots the app again, and its clock starts over. A clock that stands still is the old app's last word.
  if (built && !now.problems.length) await wait(4000, () => clock(now) < 0 || (clock(before) >= 0 && clock(now) >= clock(before)));
  else await wait(2000, () => clock(now) === clock(before));
  await wait(3000, () => clock(now) < 1_200_000);
  return now;
}

async function check(): Promise<void> {
  const now = await settled();
  let screen = "";
  if (now.phase === "running" && !now.failure) for (const until = Date.now() + 2000; !(screen = await texts()) && Date.now() < until;) await sleep(200);
  const out: string[] = [`project ${now.project!.name} "${now.project!.title}"`];
  const ok = report(now, out);
  const logs = await get<Log[]>("logs?last=15");
  out.push(`logs (last ${logs.length})`, ...logs.map(logLine));
  out.push(screen ? "screen (x,y WxH text)" : "screen: nothing drawn", ...(screen ? [screen] : []));
  console.log(out.join("\n"));
  if (!ok) process.exitCode = 1;
}

async function shot(wanted?: string): Promise<void> {
  const now = await state();
  const stamp = new Date().toTimeString().slice(0, 8).replace(/:/g, "");
  const path = resolve(wanted ?? join(now.project!.path, ".build", "shots", `screen-${stamp}.png`));
  if (!path.endsWith(".png")) throw new Stop("bench shot writes a .png", 2);
  // Inside the project: that is where the agent may write, and read the image back without asking.
  if (!inside(real(now.project!.path), real(path))) throw new Stop(`bench shot writes inside the project (${now.project!.path}); without a file name it picks one under .build/shots`, 2);
  const response = await call("shot.png?scale=2");
  if (!response.ok) throw new Stop("Nothing is running on the Tab5: bench check says why.");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, new Uint8Array(await response.arrayBuffer()));
  console.log(`${path}\n1280x720 (the screen is 640x360, drawn twice the size): read it as an image`);
}

async function showState(): Promise<void> {
  const now = await state();
  const out = [`project ${now.project!.name} "${now.project!.title}" ${now.project!.path}`];
  report(now, out);
  out.push(now.units.length ? "units on Port A" : "units on Port A: none");
  for (const unit of now.units) {
    const live = now.sim?.units[unit.uid];
    out.push(`  ${unit.uid} (${unit.type})  set: ${pairs(unit.inputs) || "-"}${live ? `  now: ${pairs(live)}` : ""}`);
  }
  const board = now.sim?.board;
  if (now.sim?.units.tab5 && Object.keys(now.sim.units.tab5).length) out.push(`tab5  now: ${pairs(now.sim.units.tab5)}`);
  if (board) {
    out.push(`board  brightness ${board.brightness}, volume ${board.volume}`);
    out.push(`  switches: ${Object.entries(board.switches).map(([id, on]) => `${id} ${on ? "on" : "off"}`).join(", ")}`);
    if (Object.keys(board.pins).length) out.push(`  pins: ${pairs(board.pins)}`);
  }
  console.log(out.join("\n"));
}

function unitCard(unit: Unit, plugged?: Plugged): string[] {
  const out = [`${plugged ? `${plugged.uid}: ` : ""}${unit.name} (type ${unit.id}, ${unit.sku}), Port ${unit.port}, I2C ${unit.addresses.map(hex).join(" ")}`, `  ${unit.blurb}. ${unit.use}`];
  for (const input of unit.inputs) out.push(`  input ${input.key}: ${input.label}, ${input.min}..${input.max} ${input.unit}${plugged ? `, now ${number(plugged.inputs[input.key])}` : `, starts at ${input.default}`}`);
  if (unit.driver) out.push(`  driver: ${unit.driver.replace(/^kit\//, "")} (in the project)`);
  return out;
}

async function units(): Promise<void> {
  const [now, all] = [await state(), await get<Unit[]>("catalog")];
  if (!now.units.length) { console.log("No unit is plugged into Port A. bench catalog lists what the room has; bench plug <type> plugs one."); return; }
  const out: string[] = [];
  for (const plugged of now.units) {
    const unit = all.find(item => item.id === plugged.type);
    if (!unit) { out.push(`${plugged.uid}: ${plugged.type}`); continue; }
    out.push(...unitCard(unit, plugged), ...unit.datasheet.split("\n").map(line => `  ${line}`));
  }
  console.log(out.join("\n"));
}

async function plugged(uid: string): Promise<{ now: State; unit: Plugged }> {
  const now = await state();
  const unit = now.units.find(item => item.uid === uid);
  if (!unit) throw new Stop(`No unit ${uid} is plugged in. Plugged: ${now.units.map(item => item.uid).join(", ") || "none"}.`);
  return { now, unit };
}

async function main(args: string[]): Promise<void> {
  const [command, ...rest] = args;
  if (!command || command === "help" || command === "--help" || command === "-h") { console.log(USAGE); return; }
  connect();
  switch (command) {
    case "check": return check();
    case "shot": return shot(rest[0]);
    case "texts": await state(); console.log(await texts() || "nothing drawn"); return;
    case "logs": {
      const count = rest[0] === "-n" ? Number(rest[1]) : Number(rest[0] ?? 40);
      if (!Number.isInteger(count) || count < 1) throw new Stop("bench logs [-n N]", 2);
      console.log((await get<Log[]>(`logs?last=${Math.min(count, 500)}`)).map(logLine).join("\n") || "no logs");
      return;
    }
    case "state": return showState();
    case "units": return units();
    case "catalog": console.log((await get<Unit[]>("catalog")).flatMap(unit => unitCard(unit)).join("\n")); return;
    case "set": {
      const [uid, key, ...value] = rest;
      if (!uid || !key || !value.length) throw new Stop("bench set <uid> <key> <json-value>", 2);
      const { unit } = await plugged(uid);
      if (!(key in unit.inputs)) throw new Stop(`${uid} has no input ${key}. Its inputs: ${Object.keys(unit.inputs).join(", ")}.`);
      let parsed: unknown = value.join(" ");
      try { parsed = JSON.parse(value.join(" ")); } catch { /* a bare word is a string */ }
      await send({ t: "room.set", uid, key, value: parsed });
      console.log(`${uid} ${key} = ${number(parsed)} (was ${number(unit.inputs[key])}). A sensor follows over some seconds: bench state shows what the unit reads now.`);
      return;
    }
    case "tap": {
      const [x, y] = rest.map(Number);
      if (rest.length !== 2 || !(x! >= 0 && x! < 640 && y! >= 0 && y! < 360)) throw new Stop("bench tap <x> <y>, with x 0..639 and y 0..359", 2);
      await state();
      await call("tap", { x, y });
      console.log(`tapped ${x},${y}`);
      return;
    }
    case "type": {
      if (!rest.length) throw new Stop("bench type <text>", 2);
      await state();
      await send({ t: "screen.text", text: rest.join(" ") });
      console.log(`typed ${JSON.stringify(rest.join(" "))}`);
      return;
    }
    case "plug": {
      const [type, wanted] = rest;
      if (!type) throw new Stop("bench plug <type> [uid]", 2);
      const now = await state();
      let uid = wanted, n = 1;
      while (!uid || (!wanted && now.units.some(unit => unit.uid === uid))) uid = `${type}-${n++}`;
      const refused = (await send({ t: "room.plug", uid, type })).find(reply => reply.t === "room.refused");
      if (refused) throw new Stop(`Not plugged: ${String(refused.reason)}`);
      console.log(`${uid} (${type}) is plugged into Port A`);
      return;
    }
    case "unplug": {
      if (!rest[0]) throw new Stop("bench unplug <uid>", 2);
      await plugged(rest[0]);
      await send({ t: "room.unplug", uid: rest[0] });
      console.log(`${rest[0]} is unplugged`);
      return;
    }
    case "wait": {
      const seconds = Number(rest[0]);
      if (!(seconds > 0 && seconds <= 10)) throw new Stop("bench wait <seconds>, 10 at most", 2);
      await sleep(seconds * 1000);
      return;
    }
    default: throw new Stop(`bench: no command ${command}\n${USAGE}`, 2);
  }
}

main(process.argv.slice(2)).catch(error => {
  process.stderr.write(`${error instanceof Stop ? error.message : `bench: ${error instanceof Error ? error.message : error}`}\n`);
  process.exit(error instanceof Stop ? error.status : 1);
});
