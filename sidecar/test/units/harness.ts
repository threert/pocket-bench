// Runs the kit's drivers against the chip models with no UI: one worker
// bundle (worker.ts, compiled as the PocketJS build compiles an app's
// worker) in the real worker realm, on a Port A bus of its own, in virtual
// time.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorker } from "../../../vendor/pocket-m5/third_party/pocketjs/tools/build-worker.ts";
import { I2CBus, type BusTrace } from "../../src/sim/i2c.ts";
import { WorkerRealm, type WorkerDeclaration } from "../../src/sim/worker-realm.ts";
import { unitType, type UnitInstance } from "../../src/units/index.ts";

const DECLARATION: WorkerDeclaration = {
  entry: "worker.ts", nodes: [{ name: "porta", kind: "i2c" }],
  channels: [{ name: "call", kind: "ring", direction: "ui-to-worker", recordBytes: 1024, capacity: 8 }],
};
let bundle: Promise<string> | undefined;

function workerBundle(): Promise<string> {
  return bundle ??= (async () => {
    const outdir = mkdtempSync(join(tmpdir(), "pb-units-"));
    await buildWorker({ declaration: DECLARATION, projectRoot: import.meta.dir, outdir, output: "units" });
    return Bun.file(join(outdir, "units.worker.js")).text();
  })();
}

/** What a driver call rejected with, as the worker reported it. */
export class DriverError extends Error {
  constructor(message: string, readonly kind: string) { super(message); this.name = "DriverError"; }
}

export class Rig {
  readonly bus = new I2CBus("porta", 100_000);
  readonly logs: string[] = [];
  readonly trace: BusTrace[] = [];
  private readonly replies = new Map<number, { ok?: unknown; error?: string; name?: string }>();
  private readonly realm: WorkerRealm;
  private calls = 0;

  private constructor(source: string) {
    this.bus.trace = entry => { this.trace.push(entry); };
    this.realm = new WorkerRealm({
      source, name: "units", declaration: DECLARATION, buses: { porta: this.bus },
      log: entry => {
        if (entry.text.startsWith("@reply ")) {
          const reply = JSON.parse(entry.text.slice(7));
          this.replies.set(reply.id, reply);
        } else this.logs.push(entry.text);
      },
    });
    this.realm.boot();
  }
  static async start(): Promise<Rig> {
    const rig = new Rig(await workerBundle());
    await rig.advance(0.001);
    return rig;
  }

  /** Virtual microseconds. */
  get now(): number { return this.realm.now; }

  /** Plugs a unit of the catalogue into Port A, as the bench does. */
  plug(id: string, inputs: Record<string, unknown> = {}): UnitInstance {
    const type = unitType(id);
    if (!type) throw new Error(`no unit ${id}`);
    const unit = type.create();
    for (const input of type.inputs) unit.set(input.key, inputs[input.key] ?? input.default, this.now);
    for (const chip of unit.chips) this.bus.attach(chip, this.now);
    return unit;
  }
  unplug(unit: UnitInstance): void {
    for (const chip of unit.chips) this.bus.detach(chip);
  }

  async advance(seconds: number): Promise<void> {
    await this.realm.runUntil(this.realm.now + Math.round(seconds * 1e6));
    if (this.realm.failure) throw new Error(`the worker failed: ${this.realm.failure.message}`);
  }

  /** Calls a method of a driver in the worker and steps time until it
   *  settles. Rejects with a DriverError when the driver rejected. */
  async call<T = unknown>(unit: string, method: string, ...args: unknown[]): Promise<T> {
    const id = ++this.calls;
    const status = this.realm.bridge().publish(1, new TextEncoder().encode(JSON.stringify({ id, unit, method, args })));
    if (status !== 0) throw new Error(`the call channel refused the record: ${status}`);
    const deadline = this.realm.now + 20e6;
    while (!this.replies.has(id)) {
      if (this.realm.now >= deadline) throw new Error(`${unit}.${method} did not settle in 20 s`);
      await this.advance(0.0005);
    }
    const reply = this.replies.get(id)!;
    this.replies.delete(id);
    if (reply.error !== undefined) throw new DriverError(reply.error, reply.name ?? "");
    return reply.ok as T;
  }
}

/** The error a promise rejects with; fails when it resolves. */
export async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a rejection");
}

/** A call must reject with the kit's BusError once the unit is off the port. */
export async function unanswered(rig: Rig, unit: string, method: string, ...args: unknown[]): Promise<DriverError> {
  const error = await rejection(rig.call(unit, method, ...args));
  if (!(error instanceof DriverError) || error.kind !== "BusError") throw new Error(`expected a BusError, got ${error.name}: ${error.message}`);
  return error;
}
