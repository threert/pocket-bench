// The bench: one open project, the units plugged into the simulated Tab5,
// and the thread that runs it. A change to the project's files builds and
// boots it again; the units stay where they are.
import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { buildProject, type BuildProblem } from "./build.ts";
import type { BoardState, FromSim, PluggedUnit, ToSim } from "./sim/protocol.ts";
import type { LogLine } from "./sim/tab5.ts";
import type { BusTrace } from "./sim/i2c.ts";
import { unitType } from "./units/index.ts";
import type { ProjectInfo } from "./workspace.ts";

export type Phase = "idle" | "building" | "running" | "failed";

export interface BenchEvents {
  frame(n: number, rgba: Uint8Array): void;
  logs(lines: LogLine[]): void;
  /** Something of `snapshot()` changed. */
  changed(): void;
  sim(state: Extract<FromSim, { t: "state" }>): void;
  bus(entries: BusTrace[]): void;
}

export interface Failure { domain: string; message: string; stack: string }

export class Bench {
  project: ProjectInfo | null = null;
  phase: Phase = "idle";
  units: PluggedUnit[] = [];
  problems: BuildProblem[] = [];
  buildOutput = "";
  buildMs = 0;
  builds = 0;
  failure: Failure | null = null;
  pocket: string | undefined;
  logs: LogLine[] = [];
  lastFrame: Uint8Array | undefined;
  lastSim: Extract<FromSim, { t: "state" }> | undefined;
  network = true;
  tracing = false;
  private sim: Worker | undefined;
  private watcher: FSWatcher | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private building = false;
  private again = false;
  private inspections = new Map<number, (message: Extract<FromSim, { t: "inspected" }>) => void>();
  private nextInspection = 1;
  private idleWaiters: (() => void)[] = [];

  constructor(private readonly events: BenchEvents) {}

  snapshot() {
    return {
      project: this.project, phase: this.phase, units: this.units, problems: this.problems, failure: this.failure,
      buildMs: Math.round(this.buildMs), builds: this.builds, pocket: this.pocket, network: this.network,
    };
  }

  private send(message: ToSim): void { this.sim?.postMessage(message); }

  private log(text: string, level = "info"): void {
    const line: LogLine = { at: this.lastSim?.at ?? 0, domain: "host", level, text };
    this.logs.push(line);
    this.events.logs([line]);
  }

  async open(project: ProjectInfo): Promise<void> {
    this.watcher?.close();
    this.project = project;
    this.logs = [];
    this.watcher = watch(project.path, { recursive: true }, (_event, file) => {
      if (!file || file.startsWith(".build") || file.startsWith(".") || file.includes("node_modules")) return;
      if (!/\.(tsx?|json|png)$/.test(file)) return;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.timer = undefined; void this.build(`${file} changed`); }, 250);
    });
    await this.build("opened");
  }

  close(): void {
    this.watcher?.close();
    this.stopSim();
    this.project = null;
    this.phase = "idle";
    this.events.changed();
  }

  /** Builds the project and boots the result. A build asked for while one runs follows it. */
  async build(reason: string): Promise<void> {
    if (!this.project) return;
    if (this.building) { this.again = true; return; }
    this.building = true;
    this.phase = "building";
    this.events.changed();
    this.log(`building (${reason})`);
    const result = await buildProject(this.project.path);
    this.building = false;
    this.buildMs = result.ms;
    this.buildOutput = result.output;
    this.problems = result.problems;
    ++this.builds;
    if (!result.ok || !result.build) {
      // The last good build keeps running: a mistake in the source does not blank the screen.
      this.phase = this.sim ? "running" : "failed";
      for (const problem of result.problems) this.log(`${problem.file ? `${problem.file}:${problem.line ?? 0} ` : ""}${problem.message}`, "error");
    } else {
      this.pocket = result.pocket;
      this.log(`built in ${(result.ms / 1000).toFixed(1)} s`);
      this.boot(result.build);
    }
    this.events.changed();
    if (this.again) { this.again = false; await this.build("changed during the build"); return; }
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }

  /** Resolves when no build is running. */
  settled(): Promise<void> {
    if (!this.building && !this.timer) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  private stopSim(): void {
    if (this.sim) { this.sim.onmessage = null; this.sim.terminate(); this.sim = undefined; }
  }

  private boot(build: NonNullable<Awaited<ReturnType<typeof buildProject>>["build"]>): void {
    this.stopSim();
    this.failure = null;
    this.phase = "running";
    const sim = new Worker(new URL("./sim/thread.ts", import.meta.url).href);
    this.sim = sim;
    sim.onmessage = (event: MessageEvent<FromSim>) => {
      if (this.sim !== sim) return;
      const message = event.data;
      switch (message.t) {
        case "frame": { const rgba = new Uint8Array(message.rgba); this.lastFrame = rgba; this.events.frame(message.n, rgba); break; }
        case "logs": this.logs.push(...message.lines); if (this.logs.length > 4000) this.logs.splice(0, 2000); this.events.logs(message.lines); break;
        case "state": this.lastSim = message; this.events.sim(message); break;
        case "bus": this.events.bus(message.entries); break;
        case "failure":
          this.failure = { domain: message.domain, message: message.message, stack: message.stack };
          this.phase = "failed";
          this.log(`${message.domain} fault: ${message.message}`, "error");
          this.events.changed();
          break;
        case "inspected": this.inspections.get(message.id)?.(message); this.inspections.delete(message.id); break;
        case "ready": break;
      }
    };
    sim.onerror = error => {
      if (this.sim !== sim) return;
      this.failure = { domain: "host", message: String((error as ErrorEvent).message ?? error), stack: "" };
      this.phase = "failed";
      this.events.changed();
    };
    sim.postMessage({ t: "boot", build, units: this.units, network: this.network } satisfies ToSim);
    if (this.tracing) this.send({ t: "trace", on: true });
  }

  restart(): Promise<void> { return this.build("restart"); }

  // ----- the room -----

  plug(uid: string, type: string, inputs: Record<string, unknown> = {}): { ok: boolean; reason?: string } {
    const model = unitType(type);
    if (!model) return { ok: false, reason: `No unit ${type} in the catalogue` };
    if (this.units.some(unit => unit.uid === uid)) return { ok: true };
    const taken = new Map<number, string>();
    for (const unit of this.units) for (const address of unitType(unit.type)?.addresses ?? []) taken.set(address, unit.type);
    const clash = model.addresses.find(address => taken.has(address));
    if (clash !== undefined) {
      const other = unitType(taken.get(clash)!)?.name ?? "another unit";
      return { ok: false, reason: `${model.name} and ${other} both answer at 0x${clash.toString(16).toUpperCase().padStart(2, "0")}: one I2C bus takes one of them` };
    }
    const unit: PluggedUnit = { uid, type, inputs: { ...Object.fromEntries(model.inputs.map(input => [input.key, input.default])), ...inputs } };
    this.units.push(unit);
    this.send({ t: "plug", unit });
    this.log(`${model.name} plugged into Port A (${model.addresses.map(address => `0x${address.toString(16).toUpperCase().padStart(2, "0")}`).join(", ")})`);
    this.events.changed();
    return { ok: true };
  }
  unplug(uid: string): void {
    const index = this.units.findIndex(unit => unit.uid === uid);
    if (index < 0) return;
    const [unit] = this.units.splice(index, 1);
    this.send({ t: "unplug", uid });
    this.log(`${unitType(unit!.type)?.name ?? unit!.type} unplugged`);
    this.events.changed();
  }
  set(uid: string, key: string, value: unknown): void {
    const unit = this.units.find(item => item.uid === uid);
    if (unit) unit.inputs[key] = value;
    this.send({ t: "set", uid, key, value });
  }
  touch(point: { x: number; y: number } | null): void { this.send({ t: "touch", point }); }
  type(text: string): void { this.send({ t: "text", text }); }
  setTracing(on: boolean): void { this.tracing = on; this.send({ t: "trace", on }); }
  pause(paused: boolean): void { this.send({ t: "pause", paused }); }

  private inspect(want: "tree" | "frame"): Promise<Extract<FromSim, { t: "inspected" }> | null> {
    if (!this.sim) return Promise.resolve(null);
    const id = this.nextInspection++;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.inspections.delete(id); resolve(null); }, 2000);
      this.inspections.set(id, message => { clearTimeout(timer); resolve(message); });
      this.send({ t: "inspect", id, want });
    });
  }
  async tree(): Promise<unknown> { return (await this.inspect("tree"))?.tree ?? null; }
  async pixels(): Promise<Uint8Array | null> {
    const answer = await this.inspect("frame");
    return answer?.rgba ? new Uint8Array(answer.rgba) : this.lastFrame ?? null;
  }
  board(): BoardState | undefined { return this.lastSim?.board; }
}
void join;
