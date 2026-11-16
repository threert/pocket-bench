// One coding agent at work on one project: an ACP agent process on stdio
// and one ACP session in it, with the project as the working directory.
// The process starts at the first prompt and stays between prompts; when it
// dies the next prompt starts another and resumes the session if the agent
// can. The bridge is the ACP client: it answers the agent's permission
// requests by the rules of policy.ts and passes the rest to the user.
import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import {
  client, ndJsonStream, PROTOCOL_VERSION, RequestError,
  type AnyMessage, type ClientConnection, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification, type Stream,
} from "@agentclientprotocol/sdk";
import type { AgentSpec } from "./adapters.ts";
import { allowOnce, commandOf, decide, pathsOf, readTextFile, Refused, writeTextFile, type Scope } from "./policy.ts";
import { Transcript } from "./transcript.ts";
import type { AgentStatus, Item } from "./types.ts";

export interface SessionEvents {
  item(item: Item): void;
  delta(id: string, text: string): void;
  turn(turn: number, status: "started" | "ended", stopReason?: string, ms?: number): void;
  /** `status`, `error` or `turn` changed. */
  changed(): void;
}

/** A permission request the user has not answered yet. */
interface Pending { resolve(response: RequestPermissionResponse): void }
interface NewSession { sessionId: string; modes?: { currentModeId: string; availableModes: { id: string }[] } | null; configOptions?: { id: string; category?: string | null; type?: string; options?: unknown[] }[] | null }

/** POCKET_BENCH_ACP_LOG=<file> appends every JSON-RPC message, the agents' stderr and the bridge's own notes to that file. */
function trace(agent: string, mark: string, text: string): void {
  const file = process.env.POCKET_BENCH_ACP_LOG;
  if (!file) return;
  // Owner-only: the messages hold file contents and the account the agent reports.
  try { appendFileSync(file, `${new Date().toISOString()} ${agent} ${mark} ${text}\n`, { mode: 0o600 }); } catch { /* the log is a debugging aid */ }
}

function messageOf(error: unknown): string {
  if (error instanceof RequestError) {
    const data = error.data as { details?: unknown; message?: unknown } | string | undefined;
    const detail = typeof data === "string" ? data : typeof data?.details === "string" ? data.details : typeof data?.message === "string" ? data.message : "";
    return detail && !error.message.includes(detail) ? `${error.message}: ${detail}` : error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export class AgentSession {
  status: AgentStatus = "idle";
  error: string | undefined;
  turn = 0;
  transcript: Transcript;
  private child: ChildProcess | undefined;
  private connection: ClientConnection | undefined;
  private sessionId: string | undefined;
  /** The session of a process that died, to resume in the next one. */
  private resumable: string | undefined;
  private starting: Promise<void> | undefined;
  private active = false;
  private cancelled = false;
  private killTimer: ReturnType<typeof setTimeout> | undefined;
  private pending = new Map<string, Pending>();
  private stderr = "";
  /** How the last process ended ("exit 1", "SIGTERM"). */
  private exit: string | undefined;
  /** Resolves when the current process has ended. */
  private gone: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(readonly spec: AgentSpec, readonly scope: Scope, private readonly events: SessionEvents) {
    this.transcript = new Transcript(scope.project, events);
  }

  get busy(): boolean { return this.active; }

  private set(status: AgentStatus, error?: string): void {
    if (this.status === status && this.error === error) return;
    this.status = status; this.error = error;
    this.events.changed();
  }

  // ----- the process -----

  private start(): Promise<void> {
    if (this.connection) return Promise.resolve();
    return this.starting ??= this.launch().finally(() => { this.starting = undefined; });
  }

  private async launch(): Promise<void> {
    const { spec, scope } = this;
    const launch = await spec.launch(text => this.transcript.add(this.turn, "notice", text));
    if (this.disposed) throw new Error("the session was closed");
    trace(spec.id, "#", `spawn ${launch.command.join(" ")} in ${scope.project}`);
    // Its own process group, so the agent's own children (the CLI, its shells) go with it.
    const child = spawn(launch.command[0]!, launch.command.slice(1), { cwd: scope.project, env: launch.env, stdio: ["pipe", "pipe", "pipe"], detached: true });
    this.child = child;
    this.stderr = ""; this.exit = undefined;
    child.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderr = (this.stderr + text).slice(-4000);
      trace(spec.id, "!", text.trimEnd());
    });
    const exited = new Promise<never>((_resolve, reject) => {
      child.once("error", error => reject(new Error(`${spec.name} could not be started: ${error.message}`)));
      child.once("exit", (code, signal) => { this.exit = signal ?? `exit ${code}`; reject(new Error(`${spec.name}'s process stopped (${this.exit})${this.stderrTail()}`)); });
    });
    exited.catch(() => this.dropped(child));
    this.gone = exited.catch(() => { /* that is the news */ });

    const wire = ndJsonStream(Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>);
    const app = client({ name: "pocket-bench" })
      .onNotification("session/update", context => this.updated(context.params))
      .onNotification("*", () => { /* an extension of the agent the bridge has no use for */ })
      .onRequest("session/request_permission", context => this.asked(context.params, context.signal))
      .onRequest("fs/read_text_file", context => this.files(() => ({ content: readTextFile(scope, context.params) })))
      .onRequest("fs/write_text_file", context => this.files(() => { writeTextFile(scope, context.params); return {}; }));
    const connection = app.connect(tapped(wire, spec.id));
    // A connection that closed has no use for its process.
    void connection.closed.then(() => this.kill(child));
    try {
      const agent = connection.agent;
      const hello = await Promise.race([exited, agent.request("initialize", {
        protocolVersion: PROTOCOL_VERSION,
        // The agents run their commands themselves: no client terminals.
        clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: false, session: { notices: {} } },
        clientInfo: { name: "pocket-bench", title: "Pocket Bench", version: "0.1.0" },
      })]);
      if (hello.protocolVersion !== PROTOCOL_VERSION) throw new Error(`${spec.name}'s adapter speaks ACP ${hello.protocolVersion}, the bench speaks ${PROTOCOL_VERSION}`);
      const setup = { cwd: scope.project, mcpServers: [], ...(spec.sessionMeta ? { _meta: spec.sessionMeta } : {}) };
      const capabilities = hello.agentCapabilities?.sessionCapabilities as { resume?: unknown } | undefined;
      let session: NewSession | undefined, resumed = false;
      if (this.resumable && capabilities?.resume) {
        const sessionId = this.resumable;
        try { session = { ...await Promise.race([exited, agent.request("session/resume", { sessionId, ...setup })]) as Omit<NewSession, "sessionId">, sessionId }; resumed = true; } catch (error) {
          trace(spec.id, "#", `session/resume failed: ${messageOf(error)}`);
        }
      }
      if (!session) {
        if (this.resumable) this.transcript.add(this.turn, "notice", `${spec.name} was started again and does not remember the conversation so far`);
        session = await Promise.race([exited, agent.request("session/new", setup)]) as NewSession;
      }
      this.resumable = undefined;
      await this.configure(connection, session, resumed);
      if (this.disposed) throw new Error("the session was closed");
      this.connection = connection;
      this.sessionId = session.sessionId;
    } catch (error) {
      connection.close();
      this.kill(child);
      throw (error instanceof RequestError && error.code === -32000) ? new Error(spec.login) : error;
    }
  }

  /** Selects the session mode and the config options of the spec, where the agent has them. */
  private async configure(connection: ClientConnection, session: NewSession, resumed: boolean): Promise<void> {
    const { spec } = this;
    const sessionId = session.sessionId;
    const modes = session.modes;
    if (modes && modes.currentModeId !== spec.mode) {
      if (modes.availableModes.some(mode => mode.id === spec.mode)) await connection.agent.request("session/set_mode", { sessionId, modeId: spec.mode });
      else this.transcript.add(this.turn, "notice", `${spec.name} has no ${spec.mode} mode here: it stays in ${modes.currentModeId} and asks more often`);
    } else if (!modes && resumed) {
      // A resumed session that does not say its mode is put into ours again.
      await connection.agent.request("session/set_mode", { sessionId, modeId: spec.mode }).catch(() => { /* an agent without modes */ });
    }
    for (const [category, value] of Object.entries(spec.config ?? {})) {
      if (!value) continue;
      const option = session.configOptions?.find(item => item.category === category || item.id === category);
      if (!option) continue;
      try { await connection.agent.request("session/set_config_option", { sessionId, configId: option.id, value }); } catch (error) {
        this.transcript.add(this.turn, "notice", `${spec.name} did not take ${category} ${value}: ${messageOf(error)}`);
      }
    }
  }

  private stderrTail(): string {
    const lines = this.stderr.replace(/\u001b\[[0-9;]*m/g, "").trim().split("\n").filter(line => line.trim());
    return lines.length ? `: ${lines.at(-1)!.slice(0, 300)}` : "";
  }

  private kill(child: ChildProcess): void {
    try { child.stdin?.end(); } catch { /* already closed */ }
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
  }

  /** The process is gone (it died, or the bridge killed it). */
  private dropped(child: ChildProcess): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.connection?.close();
    this.connection = undefined;
    if (this.sessionId) this.resumable = this.sessionId;
    this.sessionId = undefined;
    this.cancelPending();
  }

  // ----- the agent's side -----

  private updated(notification: SessionNotification): void {
    if (this.disposed || (this.sessionId !== undefined && notification.sessionId !== this.sessionId)) return;
    this.transcript.update(this.turn, notification.update);
  }

  private files<T>(work: () => T): T {
    try { return work(); } catch (error) {
      if (error instanceof Refused) throw RequestError.invalidParams(undefined, error.message);
      throw RequestError.resourceNotFound(messageOf(error));
    }
  }

  private asked(request: RequestPermissionRequest, signal: AbortSignal): RequestPermissionResponse | Promise<RequestPermissionResponse> {
    const item = this.transcript.toolCall(this.turn, request.toolCall);
    const call = this.transcript.tool(request.toolCall.toolCallId) ?? request.toolCall;
    const verdict = decide(call, this.scope);
    const allow = allowOnce(request.options);
    trace(this.spec.id, "#", `permission for ${item.title}: ${verdict.allow && allow ? "allowed" : "asked"} (${verdict.why})`);
    if (verdict.allow && allow) return { outcome: { outcome: "selected", optionId: allow } };
    if (!this.active || this.cancelled) return { outcome: { outcome: "cancelled" } };

    const command = commandOf(call.rawInput);
    const detail = command ?? pathsOf(call).join("\n");
    const question = this.transcript.permission(this.turn, item.title ?? "Permission", detail || (call.title ?? ""),
      request.options.map(option => ({ id: option.optionId, label: option.name, kind: option.kind })));
    this.set("waiting");
    return new Promise<RequestPermissionResponse>(resolve => {
      const settle = (response: RequestPermissionResponse, status: "done" | "failed") => {
        if (!this.pending.delete(question.id)) return;
        this.transcript.settle(question.id, status);
        if (this.active && !this.pending.size) this.set("working");
        resolve(response);
      };
      this.pending.set(question.id, {
        resolve: response => {
          const chosen = response.outcome.outcome === "selected" ? request.options.find(option => option.optionId === (response.outcome as { optionId: string }).optionId) : undefined;
          settle(response, chosen?.kind.startsWith("allow") ? "done" : "failed");
        },
      });
      // The agent withdrew the question ($/cancel_request).
      signal.addEventListener("abort", () => settle({ outcome: { outcome: "cancelled" } }, "failed"), { once: true });
    });
  }

  private cancelPending(): void {
    for (const pending of [...this.pending.values()]) pending.resolve({ outcome: { outcome: "cancelled" } });
  }

  // ----- the user's side -----

  /** Runs one turn. Resolves when it ended; what happened is in the transcript and the events. */
  async prompt(text: string, preamble: string): Promise<void> {
    if (this.active) throw new Error(`${this.spec.name} is still working`);
    this.active = true; this.cancelled = false;
    const turn = ++this.turn, started = performance.now();
    this.transcript.add(turn, "user", text);
    this.events.turn(turn, "started");
    this.set(this.connection ? "working" : "starting");
    let stopReason = "error", failure: string | undefined;
    try {
      await this.start();
      if (this.cancelled) stopReason = "cancelled";
      else {
        this.set("working");
        const connection = this.connection!;
        const answer = await connection.agent.request("session/prompt", { sessionId: this.sessionId!, prompt: [{ type: "text", text: preamble + text }] }).catch(async error => {
          if (error instanceof RequestError && !connection.signal.aborted) throw error;
          // The pipe closes a moment before the process is reported gone: say how it ended, with the last line of its stderr.
          await Promise.race([this.gone, new Promise(done => setTimeout(done, 1500))]);
          throw this.exit ? new Error(`${this.spec.name}'s process stopped (${this.exit})${this.stderrTail()}`) : error;
        });
        stopReason = answer.stopReason;
      }
    } catch (error) {
      // A cancel that had to kill the process is still a cancel.
      if (this.cancelled) stopReason = "cancelled";
      else failure = error instanceof RequestError && error.code === -32000 ? this.spec.login : messageOf(error);
    }
    clearTimeout(this.killTimer);
    this.active = false;
    this.cancelPending();
    if (failure !== undefined && !this.disposed) this.transcript.add(turn, "error", failure);
    this.transcript.endTurn(turn);
    this.events.turn(turn, "ended", stopReason, Math.round(performance.now() - started));
    this.set(failure === undefined ? "idle" : "error", failure);
  }

  cancel(): void {
    if (!this.active || this.cancelled) return;
    this.cancelled = true;
    this.cancelPending();
    if (this.connection && this.sessionId) {
      void this.connection.agent.notify("session/cancel", { sessionId: this.sessionId }).catch(() => { /* the process is going */ });
      // An agent that does not end the turn is stopped; the next prompt starts it again.
      const child = this.child;
      this.killTimer = setTimeout(() => { if (this.active && child) this.kill(child); }, 10_000);
    }
  }

  /** The user's answer to a permission item. */
  answer(id: string, optionId: string): boolean {
    const pending = this.pending.get(id);
    const item = this.transcript.get(id);
    if (!pending || !item?.options?.some(option => option.id === optionId)) return false;
    pending.resolve({ outcome: { outcome: "selected", optionId } });
    return true;
  }

  /** Ends the session and its process. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelled = true;
    clearTimeout(this.killTimer);
    this.cancelPending();
    const child = this.child;
    if (child) { this.dropped(child); this.kill(child); }
    this.resumable = undefined;
  }
}

/** The stream with every message written to the ACP log on its way. */
function tapped(stream: Stream, agent: string): Stream {
  if (!process.env.POCKET_BENCH_ACP_LOG) return stream;
  const out = new TransformStream<AnyMessage, AnyMessage>({ transform(message, controller) { trace(agent, ">", JSON.stringify(message)); controller.enqueue(message); } });
  void out.readable.pipeTo(stream.writable).catch(() => { /* the process is gone */ });
  const incoming = new TransformStream<AnyMessage, AnyMessage>({ transform(message, controller) { trace(agent, "<", JSON.stringify(message)); controller.enqueue(message); } });
  return { writable: out.writable, readable: stream.readable.pipeThrough(incoming) };
}
