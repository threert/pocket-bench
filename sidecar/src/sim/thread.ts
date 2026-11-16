// One simulated Tab5 in a thread of its own: a bundle evaluates into the
// thread's global realm, so every boot of an app is a new thread, and an app
// that loops for ever takes this thread with it, not the sidecar.
import { Board, FRAME_HZ, SCREEN, Tab5, boardBus, portABus, type LogLine } from "./tab5.ts";
import type { BusTrace } from "./i2c.ts";
import type { BoardState, FromSim, PluggedUnit, ToSim } from "./protocol.ts";
import { unitType, type UnitInstance } from "../units/index.ts";
import { boardChips } from "../chips/board.ts";

declare const self: Worker;
const post = (message: FromSim, transfer: ArrayBuffer[] = []) => (self as unknown as { postMessage(m: unknown, t: unknown[]): void }).postMessage(message, transfer);

const buses = { sys: boardBus(), porta: portABus() };
const board = new Board();
const onBoard = boardChips(buses.sys);
const units = new Map<string, { type: string; instance: UnitInstance }>();
let tab5: Tab5 | undefined;
let paused = false;
let tracing = false;
let logs: LogLine[] = [];
let trace: BusTrace[] = [];

const now = () => tab5?.now ?? 0;

function plug(unit: PluggedUnit): void {
  if (units.has(unit.uid)) return;
  const type = unitType(unit.type);
  if (!type) { logs.push({ at: now(), domain: "host", level: "warn", text: `unknown unit type ${unit.type}` }); return; }
  const instance = type.create();
  for (const [key, value] of Object.entries(unit.inputs)) instance.set(key, value, now());
  try {
    for (const chip of instance.chips) buses.porta.attach(chip, now());
  } catch (error) {
    for (const chip of instance.chips) buses.porta.detach(chip);
    logs.push({ at: now(), domain: "host", level: "warn", text: String(error instanceof Error ? error.message : error) });
    return;
  }
  units.set(unit.uid, { type: unit.type, instance });
}
function unplug(uid: string): void {
  const unit = units.get(uid);
  if (!unit) return;
  for (const chip of unit.instance.chips) buses.porta.detach(chip);
  units.delete(uid);
}

function boardState(): BoardState {
  return { brightness: board.brightness, volume: board.volume, switches: { ...board.switches }, pins: Object.fromEntries(board.pins) };
}

async function run(): Promise<void> {
  const period = 1000 / FRAME_HZ;
  let next = performance.now();
  let last: Uint8Array | undefined;
  let sinceKey = 0, sinceState = 0;
  const failed = () => {
    const failure = tab5!.failure!;
    post({ t: "logs", lines: logs.splice(0) });
    post({ t: "failure", domain: failure.domain, message: failure.message, stack: failure.stack });
  };
  for (;;) {
    if (!paused && tab5 && !tab5.failure) {
      const alive = await tab5.frame();
      const rgba = tab5.pixels();
      ++sinceKey;
      if (!last || sinceKey >= FRAME_HZ || Buffer.compare(rgba, last) !== 0) {
        sinceKey = 0;
        last = rgba;
        const copy = rgba.slice();
        post({ t: "frame", n: tab5.frames, rgba: copy.buffer as ArrayBuffer }, [copy.buffer as ArrayBuffer]);
      }
      if (!alive) failed();
    }
    if (logs.length) post({ t: "logs", lines: logs.splice(0) });
    if (tracing && trace.length) post({ t: "bus", entries: trace.splice(0) });
    if (++sinceState >= 3 && tab5) {
      sinceState = 0;
      const state: Record<string, Record<string, unknown>> = {};
      for (const [uid, unit] of units) state[uid] = unit.instance.state(now());
      state.tab5 = onBoard.state(now());
      post({ t: "state", at: now(), frames: tab5.frames, turns: tab5.workerTurns(), units: state, board: boardState(), addresses: buses.porta.powered ? buses.porta.addresses() : [] });
    }
    next += period;
    const wait = next - performance.now();
    if (wait < -200) next = performance.now(); // fell behind (a debugger, a sleep): do not catch up
    await new Promise(resolve => setTimeout(resolve, Math.max(0, wait)));
  }
}

self.onmessage = async (event: MessageEvent<ToSim>) => {
  const message = event.data;
  switch (message.t) {
    case "boot": {
      for (const unit of message.units) plug(unit);
      if (message.board) {
        if (message.board.brightness !== undefined) board.brightness = message.board.brightness;
        if (message.board.volume !== undefined) board.volume = message.board.volume;
      }
      const candidate = new Tab5({ build: message.build, buses, board, network: message.network, log: line => { logs.push(line); if (logs.length > 2000) logs.splice(0, 1000); } });
      buses.porta.trace = entry => { if (tracing) { trace.push(entry); if (trace.length > 4000) trace.splice(0, 2000); } };
      buses.sys.trace = buses.porta.trace;
      try {
        await candidate.boot();
      } catch (error) {
        post({ t: "failure", domain: "host", message: String(error instanceof Error ? error.message : error), stack: error instanceof Error ? error.stack ?? "" : "" });
        return;
      }
      tab5 = candidate;
      post({ t: "ready", title: message.build.manifest.title });
      if (tab5.failure) { post({ t: "logs", lines: logs.splice(0) }); post({ t: "failure", domain: tab5.failure.domain, message: tab5.failure.message, stack: tab5.failure.stack }); }
      void run();
      break;
    }
    case "touch": tab5?.setTouch(message.point); break;
    case "text": tab5?.typeText(message.text); break;
    case "plug": plug(message.unit); break;
    case "unplug": unplug(message.uid); break;
    case "set": {
      if (message.uid === "tab5") onBoard.set(message.key, message.value, now());
      else units.get(message.uid)?.instance.set(message.key, message.value, now());
      break;
    }
    case "board": {
      if (message.key === "usb-a" || message.key === "headphone") board.ports[message.key] = !!message.value;
      break;
    }
    case "pause": paused = message.paused; break;
    case "trace": tracing = message.on; if (!tracing) trace = []; break;
    case "inspect": {
      if (!tab5) { post({ t: "inspected", id: message.id }); break; }
      if (message.want === "tree") post({ t: "inspected", id: message.id, tree: tab5.tree() });
      else { const copy = tab5.pixels().slice(); post({ t: "inspected", id: message.id, rgba: copy.buffer as ArrayBuffer }, [copy.buffer as ArrayBuffer]); }
      break;
    }
  }
};
void SCREEN;
