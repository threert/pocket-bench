// The sidecar's door: one HTTP and WebSocket server on the loopback.
//
//   WS  /app          the app: JSON messages both ways, and the Tab5's frames as binary messages
//   GET /api/...      the same bench for command-line tools (the agent's `bench` command) and tests
//
// A frame is 16 bytes of header ("PBF1", width u16, height u16, frame u32, reserved u32, little endian) and
// then width x height RGBA8 pixels.
import type { ServerWebSocket } from "bun";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bench } from "./bench.ts";
import { idleFrame } from "./idle.ts";
import { encodePng } from "./png.ts";
import { WORKSPACE } from "./paths.ts";
import { SCREEN } from "./sim/tab5.ts";
import { UNITS } from "./units/index.ts";
import { createProject, ensureWorkspace, listProjects, projectFiles, templates } from "./workspace.ts";

type Socket = ServerWebSocket<{ role: string }>;
type Json = Record<string, unknown>;
export type Handler = (message: Json, reply: (message: Json) => void) => void | Promise<void>;

export class Server {
  readonly bench: Bench;
  readonly handlers = new Map<string, Handler>();
  private readonly sockets = new Set<Socket>();
  private server!: ReturnType<typeof Bun.serve>;
  private stateTimer: ReturnType<typeof setTimeout> | undefined;
  /** Extra parts of the state snapshot (the agent, the lessons). */
  readonly stateParts: (() => Json)[] = [];
  private pending = new Map<number, (answer: Json) => void>();
  private nextRequest = 1;

  constructor() {
    this.bench = new Bench({
      frame: (n, rgba) => this.frame(n, rgba),
      logs: lines => this.broadcast({ t: "logs", lines }),
      changed: () => this.stateChanged(),
      sim: state => this.broadcast({ t: "sim", at: state.at, units: state.units, board: state.board, addresses: state.addresses }),
      bus: entries => this.broadcast({ t: "bus", entries }),
    });
    this.install();
  }

  state(): Json {
    const state: Json = { t: "state", ...this.bench.snapshot(), projects: listProjects(), templates: templates(), workspace: WORKSPACE };
    for (const part of this.stateParts) Object.assign(state, part());
    return state;
  }
  /** Sends the state to every client, a few times a second at most. */
  stateChanged(): void {
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => { this.stateTimer = undefined; this.broadcast(this.state()); }, 30);
  }
  broadcast(message: Json): void {
    const text = JSON.stringify(message);
    for (const socket of this.sockets) socket.send(text);
  }
  private frame(n: number, rgba: Uint8Array): void {
    if (!this.sockets.size) return;
    const packet = new Uint8Array(16 + rgba.length);
    packet.set([0x50, 0x42, 0x46, 0x31]);
    const view = new DataView(packet.buffer);
    view.setUint16(4, SCREEN.width, true); view.setUint16(6, SCREEN.height, true); view.setUint32(8, n, true);
    packet.set(rgba, 16);
    for (const socket of this.sockets) socket.send(packet);
  }

  /** Asks the app and waits for its answer: a window screenshot, a camera move. Every connected app hears the
   *  request (a socket that went stale does not swallow it); the first answer is the answer. */
  askApp(message: Json, timeoutMs = 8000): Promise<Json> {
    const apps = [...this.sockets].filter(socket => socket.data.role === "app");
    if (!apps.length) return Promise.resolve({ ok: false, error: "the app is not connected" });
    const request = this.nextRequest++;
    return new Promise(resolve => {
      const timer = setTimeout(() => { this.pending.delete(request); resolve({ ok: false, error: "the app did not answer" }); }, timeoutMs);
      this.pending.set(request, answer => { clearTimeout(timer); resolve(answer); });
      const text = JSON.stringify({ ...message, request });
      for (const app of apps) app.send(text);
    });
  }

  on(type: string, handler: Handler): void { this.handlers.set(type, handler); }

  private install(): void {
    const bench = this.bench;
    this.on("hello", (_m, reply) => { reply(this.state()); reply({ t: "catalog", units: catalog() }); });
    this.on("answer", m => { this.pending.get(Number(m.request))?.(m); this.pending.delete(Number(m.request)); });
    this.on("room.plug", (m, reply) => {
      const result = bench.plug(String(m.uid), String(m.type), (m.inputs as Json | undefined) ?? {});
      if (!result.ok) reply({ t: "room.refused", uid: m.uid, reason: result.reason });
    });
    this.on("room.unplug", m => bench.unplug(String(m.uid)));
    this.on("room.set", m => bench.set(String(m.uid), String(m.key), m.value));
    this.on("screen.touch", m => bench.touch(m.up ? null : { x: Number(m.x), y: Number(m.y) }));
    this.on("screen.text", m => bench.type(String(m.text ?? "")));
    this.on("project.open", async m => {
      const project = listProjects().find(item => item.name === m.name);
      if (project) await bench.open(project);
    });
    this.on("project.new", async (m, reply) => {
      try {
        const project = createProject(String(m.template ?? "blank"), String(m.name ?? "my-app"), { title: m.title as string | undefined, lesson: m.lesson as string | undefined });
        await bench.open(project);
      } catch (error) {
        reply({ t: "error", message: String(error instanceof Error ? error.message : error) });
      }
    });
    this.on("project.build", () => bench.build("asked"));
    this.on("project.close", async () => {
      bench.close();
      const frame = await idleFrame();
      if (frame) this.frame(0, frame);
    });
    this.on("project.files", (_m, reply) => { if (bench.project) reply({ t: "project.files", files: projectFiles(bench.project.path) }); });
    this.on("project.read", (m, reply) => {
      if (!bench.project) return;
      const path = String(m.path ?? "");
      if (path.includes("..") || path.startsWith("/")) return;
      try { reply({ t: "project.file", path, text: readFileSync(join(bench.project.path, path), "utf8") }); } catch { reply({ t: "project.file", path, text: "" }); }
    });
    this.on("bus.trace", m => bench.setTracing(!!m.on));
    this.on("sim.pause", m => bench.pause(!!m.paused));
  }

  private async dispatch(socket: Socket | null, message: Json): Promise<Json[]> {
    const replies: Json[] = [];
    const handler = this.handlers.get(String(message.t));
    if (!handler) return [{ t: "error", message: `unknown message ${String(message.t)}` }];
    try {
      await handler(message, reply => { if (socket) socket.send(JSON.stringify(reply)); else replies.push(reply); });
    } catch (error) {
      const failure = { t: "error", message: String(error instanceof Error ? error.message : error) };
      if (socket) socket.send(JSON.stringify(failure)); else replies.push(failure);
    }
    return replies;
  }

  private async api(request: Request, url: URL): Promise<Response> {
    const bench = this.bench;
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value, null, 1), { status, headers: { "content-type": "application/json" } });
    const path = url.pathname.slice("/api/".length);
    if (path === "state") return json({ ...this.state(), sim: bench.lastSim ? { at: bench.lastSim.at, frames: bench.lastSim.frames, turns: bench.lastSim.turns, units: bench.lastSim.units, board: bench.lastSim.board, addresses: bench.lastSim.addresses } : null });
    if (path === "catalog") return json(catalog());
    if (path === "shot.png") {
      const rgba = await bench.pixels();
      if (!rgba) return json({ error: "nothing is running" }, 409);
      const scale = Math.max(1, Math.min(4, Number(url.searchParams.get("scale") ?? 1) | 0));
      return new Response(encodePng(scale === 1 ? rgba : upscale(rgba, SCREEN.width, SCREEN.height, scale), SCREEN.width * scale, SCREEN.height * scale), { headers: { "content-type": "image/png" } });
    }
    if (path === "tree") return json(await bench.tree());
    if (path === "texts") return new Response(texts(await bench.tree()), { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (path === "logs") {
      const count = Number(url.searchParams.get("last") ?? 80);
      return json(bench.logs.slice(-count));
    }
    if (path === "build-output") return new Response(bench.buildOutput, { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (path === "settled") { await bench.settled(); return json(bench.snapshot()); }
    if (path === "app" && request.method === "POST") return json(await this.askApp(await request.json() as Json, 20_000));
    if (path === "send" && request.method === "POST") {
      const body = await request.json() as Json;
      if (body.to === "app") { this.broadcast(body.message as Json); return json({ ok: true }); }
      return json(await this.dispatch(null, body));
    }
    if (path === "tap" && request.method === "POST") {
      const body = await request.json() as { x: number; y: number; ms?: number };
      bench.touch({ x: body.x, y: body.y });
      await new Promise(resolve => setTimeout(resolve, body.ms ?? 120));
      bench.touch(null);
      await new Promise(resolve => setTimeout(resolve, 120));
      return json({ ok: true });
    }
    return json({ error: `no ${path}` }, 404);
  }

  start(port = Number(process.env.POCKET_BENCH_PORT ?? 0)): number {
    ensureWorkspace();
    const self = this;
    this.server = Bun.serve<{ role: string }, never>({
      hostname: "127.0.0.1",
      port,
      async fetch(request, server) {
        const url = new URL(request.url);
        if (url.pathname === "/app") {
          return server.upgrade(request, { data: { role: url.searchParams.get("role") ?? "app" } }) ? undefined as unknown as Response : new Response("expected a WebSocket", { status: 400 });
        }
        if (url.pathname.startsWith("/api/")) return self.api(request, url);
        return new Response("Pocket Bench sidecar\n");
      },
      websocket: {
        maxPayloadLength: 64 << 20,
        open(socket) {
          self.sockets.add(socket);
          socket.send(JSON.stringify(self.state()));
          socket.send(JSON.stringify({ t: "catalog", units: catalog() }));
          if (self.bench.project && self.bench.lastFrame) self.frame(0, self.bench.lastFrame);
          else void idleFrame().then(frame => { if (frame && !self.bench.project) self.frame(0, frame); });
        },
        close(socket) { self.sockets.delete(socket); },
        async message(socket, data) {
          if (typeof data !== "string") return;
          let message: Json;
          try { message = JSON.parse(data); } catch { return; }
          await self.dispatch(socket, message);
        },
      },
    });
    const actual = this.server.port!;
    mkdirSync(join(WORKSPACE, ".bench"), { recursive: true });
    writeFileSync(join(WORKSPACE, ".bench", "server.json"), JSON.stringify({ port: actual, pid: process.pid, started: new Date().toISOString() }) + "\n");
    return actual;
  }
}

export function catalog() {
  return UNITS.map(unit => ({
    id: unit.id, name: unit.name, sku: unit.sku, blurb: unit.blurb, use: unit.use, port: unit.port,
    addresses: unit.addresses, size: unit.size, inputs: unit.inputs, datasheet: unit.datasheet, driver: unit.driver,
  }));
}

function upscale(rgba: Uint8Array, width: number, height: number, k: number): Uint8Array {
  const out = new Uint8Array(width * k * height * k * 4);
  const src = new Uint32Array(rgba.buffer, rgba.byteOffset, width * height), dst = new Uint32Array(out.buffer);
  for (let y = 0; y < height * k; y++) {
    const row = Math.floor(y / k) * width;
    for (let x = 0; x < width * k; x++) dst[y * width * k + x] = src[row + Math.floor(x / k)]!;
  }
  return out;
}

interface Node { type: string; text: string; hidden: boolean; rect: [number, number, number, number] | null; children: Node[] }
/** Every text on the screen with its box, top to bottom: what a person would read. */
export function texts(tree: unknown): string {
  const lines: { y: number; x: number; line: string }[] = [];
  const walk = (node: Node | null, inherited: Node["rect"]) => {
    if (!node || node.hidden) return;
    // A <Text> is a box holding its string as a child text node without a box of its own.
    const rect = node.rect ?? inherited;
    if (node.type === "text" && node.text && rect) {
      const [x, y, w, h] = rect;
      lines.push({ y, x, line: `${String(x).padStart(4)},${String(y).padStart(3)} ${String(w).padStart(3)}x${String(h).padEnd(3)} ${JSON.stringify(node.text)}` });
    }
    for (const child of node.children ?? []) walk(child, node.type === "text" ? rect : null);
  };
  walk(tree as Node | null, null);
  lines.sort((a, b) => a.y - b.y || a.x - b.x);
  return lines.map(item => item.line).join("\n") + "\n";
}
