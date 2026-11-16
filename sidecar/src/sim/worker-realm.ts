// The host of a PocketJS app worker, as the Tab5 firmware is one
// (pocket-m5 platforms/esp-idf/pocket_worker_esp over engine/worker): a
// second realm that sees only `__pocketWorker`, driven turn by turn with the
// facts that arrived. The bus behind its `i2c` nodes is virtual (i2c.ts).
//
// Time is virtual microseconds. A turn runs at the time of the earliest fact
// or deadline, so a worker that sleeps 20 ms between a command and its read
// meets a chip that is 20 ms older, whatever the frame rate of the UI.
import { createContext, Script, type Context } from "node:vm";
import { Status, type I2CBus } from "./i2c.ts";

export const FactKind = { ready: 1, complete: 2, data: 3, end: 4, gap: 5, timer: 6, channel: 7, headers: 8, error: 9, credit: 10, closed: 11 } as const;
const LIMITS = { resources: 8, requests: 8, payloadBytes: 1024, events: 8, timers: 8, channels: 8 } as const;
const KIND = { i2c: 1, uart: 2, http: 3, mqtt: 4 } as const;

interface Fact {
  kind: number; handle: number; request: number; status: number; offset: number;
  data: Uint8Array; timer: number; channel: number; deadline: number; missed: number;
}
const fact = (fields: Partial<Fact>): Fact => ({
  kind: 0, handle: 0, request: 0, status: 0, offset: 0, data: new Uint8Array(0), timer: 0, channel: 0, deadline: 0, missed: 0, ...fields,
});

interface Resource { kind: number; node: string; address: number; inflight: number; closed: boolean; http?: HttpState; uart?: UartPort }
interface HttpState { options: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number }; abort?: AbortController }
interface Channel { snapshot: boolean; size: number; capacity: number; toWorker: boolean; queue: Uint8Array[]; mirror: Uint8Array[]; pendingToWorker: number }

/** A byte stream behind a `uart` node (the RS485 transceiver, or Port A's pins as a UART). */
export interface UartPort {
  /** Bytes the worker wrote. */
  write(data: Uint8Array, now: number): void;
  /** Called when the worker opens the port, with a sink for received bytes. */
  open(config: { baudRate: number; dataBits: number; stopBits: number; parity: number }, receive: (data: Uint8Array) => void): void;
  close(): void;
}

export interface WorkerLog { at: number; level: string; text: string }
export interface WorkerDeclaration {
  entry: string;
  nodes: { name: string; kind: "i2c" | "uart" | "http" | "mqtt" }[];
  channels?: { name: string; kind: "snapshot" | "ring"; direction: "ui-to-worker" | "worker-to-ui"; recordBytes: number; capacity: number }[];
}

export interface WorkerRealmOptions {
  source: string;
  name: string;
  declaration: WorkerDeclaration;
  /** The i2c nodes of the host by name ("sys", "porta"). */
  buses: Record<string, I2CBus>;
  uarts?: Record<string, UartPort>;
  /** Whether `http` nodes reach the network. */
  network?: boolean;
  log(entry: WorkerLog): void;
}

const immediate = () => new Promise<void>(resolve => setImmediate(resolve));

export class WorkerRealm {
  now = 0;
  failure: { message: string; stack: string } | null = null;
  turns = 0;
  private sequence = 0;
  private readonly generation = 1;
  private readonly context: Context;
  private readonly pending: { at: number; order: number; fact: Fact }[] = [];
  private order = 0;
  private readonly timers = new Map<number, { deadline: number; period: number }>();
  private readonly resources = new Map<number, Resource>();
  private nextHandle = 1;
  private nextRequest = 1;
  private inflight = 0;
  private readonly cancelled = new Set<number>();
  private readonly channels = new Map<number, Channel>();
  private needsTurn = true;
  private readonly options: WorkerRealmOptions;
  /** The worker realm's own Uint8Array: bytes handed to it are instances of it, as on the device. */
  private readonly Bytes: Uint8ArrayConstructor;

  constructor(options: WorkerRealmOptions) {
    this.options = options;
    const consoleOf = (level: string) => (...args: unknown[]) => options.log({ at: this.now, level, text: args.map(text).join(" ") });
    this.context = createContext({
      __pocketWorker: this.host(),
      console: { log: consoleOf("log"), info: consoleOf("info"), warn: consoleOf("warn"), error: consoleOf("error"), debug: consoleOf("debug") },
    });
    this.Bytes = new Script("Uint8Array").runInContext(this.context) as Uint8ArrayConstructor;
  }

  /** Evaluates the bundle: the worker's entry runs up to its first await. */
  boot(): void {
    try {
      new Script(this.options.source, { filename: `${this.options.name}.worker.js` }).runInContext(this.context);
      if (typeof (this.context as Record<string, unknown>).__pocketWorkerTurn !== "function") throw new Error("the worker bundle installed no turn entry");
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error: unknown): void {
    if (this.failure) return;
    this.failure = error instanceof Error ? { message: `${error.name}: ${error.message}`, stack: error.stack ?? "" } : { message: String(error), stack: "" };
    this.options.log({ at: this.now, level: "error", text: `worker fault: ${this.failure.message}` });
  }

  private push(at: number, value: Fact): void {
    const entry = { at, order: this.order++, fact: value };
    let index = this.pending.length;
    while (index > 0 && (this.pending[index - 1]!.at > at)) --index;
    this.pending.splice(index, 0, entry);
  }

  private host() {
    const self = this;
    return {
      open(kind: number, node: string, config: Uint8Array): number {
        if (self.resources.size >= LIMITS.resources) return Status.busy;
        const declared = self.options.declaration.nodes.find(item => item.name === node);
        if (!declared || KIND[declared.kind] !== kind) return Status.invalid;
        const resource: Resource = { kind, node, address: 0, inflight: 0, closed: false };
        if (kind === KIND.i2c) {
          if (!self.options.buses[node]) return Status.unsupported;
          if (config.length < 2 || config[0] !== 1) return Status.invalid;
          resource.address = config[1]!;
        } else if (kind === KIND.http) {
          try { resource.http = { options: JSON.parse(new TextDecoder().decode(config)) }; } catch { return Status.invalid; }
        } else if (kind === KIND.uart) {
          const port = self.options.uarts?.[node];
          if (!port) return Status.unsupported;
          if (config.length < 9) return Status.invalid;
          resource.uart = port;
          const handle = self.nextHandle;
          port.open({ dataBits: config[1]!, stopBits: config[2]!, parity: config[3]!, baudRate: new DataView(config.buffer, config.byteOffset + 4, 4).getUint32(0, true) },
            data => { for (let at = 0; at < data.length; at += LIMITS.payloadBytes) self.push(self.now, fact({ kind: FactKind.data, handle, data: data.slice(at, at + LIMITS.payloadBytes) })); });
        } else {
          return Status.unsupported;
        }
        const handle = self.nextHandle++;
        self.resources.set(handle, resource);
        return handle;
      },
      submit(handle: number, opcode: number, payload: Uint8Array, _resultCapacity: number): number {
        const resource = self.resources.get(handle);
        if (!resource || resource.closed) return Status.invalid;
        if (self.inflight >= LIMITS.requests) return Status.busy;
        const request = self.nextRequest++;
        if (resource.kind === KIND.i2c) {
          const bus = self.options.buses[resource.node]!;
          const copy = payload.slice();
          const transfer = opcode === 2 ? bus.probe(resource.address, self.now)
            : opcode === 1 ? bus.run(resource.address, copy, self.now)
            : { status: Status.unsupported, data: new Uint8Array(0), micros: 0 };
          // A NACKed address costs the controller its timeout on a real bus only when
          // the lines are stuck; a plain NACK returns at once.
          self.begin(resource);
          self.push(self.now + Math.max(50, transfer.micros), fact({ kind: FactKind.complete, handle, request, status: transfer.status, data: transfer.data }));
          return request;
        }
        if (resource.kind === KIND.http && opcode === 1) {
          self.begin(resource);
          void self.http(handle, request, resource);
          return request;
        }
        return Status.unsupported;
      },
      cancel(request: number): number { self.cancelled.add(request); return Status.ok; },
      close(handle: number): number {
        const resource = self.resources.get(handle);
        if (!resource) return Status.invalid;
        resource.closed = true;
        resource.http?.abort?.abort();
        resource.uart?.close();
        if (resource.inflight) return Status.busy;
        self.resources.delete(handle);
        return Status.ok;
      },
      write(handle: number, data: Uint8Array): number {
        const resource = self.resources.get(handle);
        if (!resource || resource.closed) return Status.invalid;
        if (!resource.uart) return Status.unsupported;
        resource.uart.write(data.slice(), self.now);
        return data.length;
      },
      publish(channel: number, data: Uint8Array): number {
        const target = self.channels.get(channel);
        if (!target || target.toWorker || data.length > target.size) return Status.invalid;
        if (target.snapshot) { target.queue = [data.slice()]; return Status.ok; }
        if (target.queue.length >= target.capacity) return Status.busy;
        target.queue.push(data.slice());
        return Status.ok;
      },
      timer(id: number, deadline: number, period: number): number {
        if (!Number.isInteger(id) || id < 1 || id > LIMITS.timers) return Status.invalid;
        if (deadline <= 0) self.timers.delete(id);
        else self.timers.set(id, { deadline, period });
        return Status.ok;
      },
      declareChannel(id: number, snapshot: number, maxBytes: number, capacity: number, direction: number): number {
        if (id < 1 || id > LIMITS.channels || self.channels.has(id)) return Status.invalid;
        self.channels.set(id, { snapshot: snapshot === 1, size: maxBytes, capacity: snapshot === 1 ? 1 : capacity, toWorker: direction === 1, queue: [], mirror: [], pendingToWorker: 0 });
        return Status.ok;
      },
    };
  }

  private begin(resource: Resource): void { ++resource.inflight; ++this.inflight; }
  private end(handle: number): void {
    const resource = this.resources.get(handle);
    --this.inflight;
    if (!resource) return;
    if (--resource.inflight <= 0 && resource.closed) this.resources.delete(handle);
  }

  private async http(handle: number, request: number, resource: Resource): Promise<void> {
    const { options } = resource.http!;
    const done = (status: number, data = new Uint8Array(0)) => this.push(this.now, fact({ kind: FactKind.complete, handle, request, status, data }));
    if (this.options.network === false) { this.push(this.now, fact({ kind: FactKind.error, handle, status: Status.failed, data: new TextEncoder().encode("network is off") })); done(Status.failed); return; }
    const abort = new AbortController();
    resource.http!.abort = abort;
    const timeout = setTimeout(() => abort.abort(), options.timeoutMs ?? 30_000);
    try {
      const response = await fetch(options.url, { method: options.method ?? "GET", headers: options.headers, body: options.body, signal: abort.signal });
      const head = { status: response.status, headers: Object.fromEntries([...response.headers].map(([key, value]) => [key.toLowerCase(), value])) };
      this.push(this.now, fact({ kind: FactKind.headers, handle, status: response.status, data: new TextEncoder().encode(JSON.stringify(head)).slice(0, LIMITS.payloadBytes) }));
      const body = new Uint8Array(await response.arrayBuffer());
      const limit = Math.min(body.length, options.maxBytes ?? body.length);
      for (let offset = 0; offset < limit; offset += LIMITS.payloadBytes) {
        this.push(this.now, fact({ kind: FactKind.data, handle, offset, data: body.slice(offset, Math.min(limit, offset + LIMITS.payloadBytes)) }));
      }
      this.push(this.now, fact({ kind: FactKind.end, handle, status: Status.ok, offset: limit }));
      done(Status.ok);
    } catch (error) {
      this.push(this.now, fact({ kind: FactKind.error, handle, status: Status.failed, data: new TextEncoder().encode(String(error)).slice(0, 200) }));
      done(Status.failed);
    } finally {
      clearTimeout(timeout);
    }
  }

  // ----- the UI's side of the channels (engine/worker quickjs_ui.c) -----

  /** The UI realm's `__pocketWorkerChannels`. */
  bridge() {
    const self = this;
    return {
      configure(id: number, snapshot: number): number {
        const channel = self.channels.get(id);
        return channel && channel.snapshot === (snapshot === 1) ? Status.ok : Status.invalid;
      },
      publish(id: number, data: Uint8Array): number {
        const channel = self.channels.get(id);
        if (!channel || !channel.toWorker || data.length > channel.size) return Status.invalid;
        if (!channel.snapshot && channel.pendingToWorker >= channel.capacity) return Status.busy;
        ++channel.pendingToWorker;
        self.push(self.now, fact({ kind: FactKind.channel, channel: id, data: data.slice() }));
        return Status.ok;
      },
      observe(id: number): Uint8Array[] {
        return self.channels.get(id)?.mirror ?? [];
      },
    };
  }
  /** Before a UI frame: the records the worker published since the last one. */
  latch(): void {
    for (const channel of this.channels.values()) {
      if (channel.toWorker) continue;
      if (channel.snapshot) { if (channel.queue.length) { channel.mirror = channel.queue; channel.queue = []; } }
      else { channel.mirror = channel.queue; channel.queue = []; }
    }
  }

  // ----- turns -----

  private nextDeadline(): number | undefined {
    let earliest: number | undefined;
    for (const timer of this.timers.values()) if (earliest === undefined || timer.deadline < earliest) earliest = timer.deadline;
    return earliest;
  }

  /** Runs every turn that is due up to `until` (virtual microseconds), then
   *  leaves the clock there. */
  async runUntil(until: number): Promise<void> {
    let guard = 0;
    while (!this.failure) {
      const factAt = this.pending[0]?.at;
      const timerAt = this.nextDeadline();
      let at = this.needsTurn ? this.now : undefined;
      if (factAt !== undefined && (at === undefined || factAt < at)) at = factAt;
      if (timerAt !== undefined && (at === undefined || timerAt < at)) at = timerAt;
      if (at === undefined || at > until) break;
      this.needsTurn = false;
      this.now = Math.max(this.now, at);
      const facts: Fact[] = [];
      while (this.pending.length && this.pending[0]!.at <= this.now && facts.length < LIMITS.events) {
        const next = this.pending.shift()!.fact;
        if (next.kind === FactKind.complete) {
          this.end(next.handle);
          if (this.cancelled.delete(next.request)) { next.status = Status.cancelled; next.data = new Uint8Array(0); }
        } else if (next.kind === FactKind.channel) {
          const channel = this.channels.get(next.channel);
          if (channel) --channel.pendingToWorker;
        }
        next.data = new this.Bytes(next.data);
        facts.push(next);
      }
      for (const [id, timer] of this.timers) {
        if (timer.deadline > this.now) continue;
        const missed = timer.period ? Math.floor((this.now - timer.deadline) / timer.period) : 0;
        facts.push(fact({ kind: FactKind.timer, timer: id, deadline: timer.deadline, missed }));
        if (timer.period) timer.deadline += (missed + 1) * timer.period;
        else this.timers.delete(id);
      }
      try {
        (this.context as { __pocketWorkerTurn: (context: unknown, facts: Fact[]) => void }).__pocketWorkerTurn(
          { generation: this.generation, sequence: ++this.sequence, nowMicros: this.now, wallClock: { utcMicros: Date.now() * 1000, generation: 1, errorMicros: 1000, source: "sim" } }, facts);
      } catch (error) {
        this.fail(error);
        break;
      }
      ++this.turns;
      // The realm's Promise jobs run before the next turn, as the host runs them on the device.
      await immediate();
      if (++guard > 20_000) { this.fail(new Error("the worker ran 20000 turns inside one frame: a loop without a sleep or a pace")); break; }
    }
    if (until > this.now) this.now = until;
  }
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}
