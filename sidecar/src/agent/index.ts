// The coding agent's bridge: the app's chat panel on one side, Claude Code
// or Codex as an ACP agent on the other (docs/AGENT-BRIDGE.md).
//
//   app → sidecar   agent.select {agent}  agent.prompt {text, context?}  agent.cancel {}
//                   agent.permission {id, optionId}  agent.new {}  agent.history {}
//   sidecar → app   state.agent  agent.item {item}  agent.delta {id, text}
//                   agent.turn {turn, status, stopReason?, ms?}  agent.history {items}
//
// There is one session for each agent on the open project. The messages
// carry the selected agent's session; the other one keeps its transcript,
// and `agent.history` is sent again when the selection or the project changes.
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BUN, M5, POCKETJS, ROOT, WORKSPACE } from "../paths.ts";
import { AGENTS, benchBin, type AgentSpec } from "./adapters.ts";
import { makeScope } from "./policy.ts";
import { composePreamble } from "./preamble.ts";
import { AgentSession } from "./session.ts";
import type { AgentHost, AgentId, AgentInfo, AgentState } from "./types.ts";

export type { AgentHost, AgentId, AgentInfo, AgentState, AgentStatus, Item } from "./types.ts";

export interface BridgeOptions {
  agents?: Record<AgentId, AgentSpec>;
  workspace?: string;
  /** Folders outside the workspace the agent may read. */
  readAlso?: string[];
}

const IDS: AgentId[] = ["claude", "codex"];

export class AgentBridge {
  selected: AgentId = "claude";
  private chosen = false;
  private readonly agents: Record<AgentId, AgentSpec>;
  private readonly workspace: string;
  private readonly readAlso: string[];
  private infos: Record<AgentId, AgentInfo>;
  private sessions = new Map<AgentId, AgentSession>();
  /** The project the sessions belong to. */
  private project: string | null = null;

  constructor(private readonly host: AgentHost, options: BridgeOptions = {}) {
    this.agents = options.agents ?? AGENTS;
    this.workspace = options.workspace ?? WORKSPACE;
    // The framework and Solid are links in the workspace's node_modules: their files are outside it.
    this.readAlso = options.readAlso ?? [POCKETJS, join(M5, "node_modules", "solid-js")];
    this.infos = Object.fromEntries(IDS.map(id => [id, { id, name: this.agents[id].name, installed: false }])) as Record<AgentId, AgentInfo>;
    this.project = host.bench.project?.path ?? null;
    host.stateParts.push(() => { this.follow(); return { agent: this.state() }; });
    host.on("agent.select", message => this.select(message.agent));
    host.on("agent.prompt", (message, reply) => this.prompt(String(message.text ?? ""), typeof message.context === "string" ? message.context : undefined, reply));
    host.on("agent.cancel", () => this.session()?.cancel());
    host.on("agent.permission", (message, reply) => {
      if (!this.session()?.answer(String(message.id), String(message.optionId))) reply({ t: "error", message: `no open permission ${String(message.id)} with option ${String(message.optionId)}` });
    });
    host.on("agent.new", () => this.fresh());
    host.on("agent.history", (_message, reply) => reply(this.history()));
    void this.detect();
  }

  /** Looks for the agents' command-line tools; the state follows. */
  async detect(): Promise<void> {
    await Promise.all(IDS.map(async id => {
      try { this.infos[id] = await this.agents[id].detect(); } catch (error) { this.infos[id] = { id, name: this.agents[id].name, installed: false, note: String(error instanceof Error ? error.message : error) }; }
    }));
    if (!this.chosen && !this.infos.claude.installed && this.infos.codex.installed) this.selected = "codex";
    this.host.stateChanged();
  }

  state(): AgentState {
    const session = this.session();
    return {
      selected: this.selected, agents: IDS.map(id => this.infos[id]), status: session?.status ?? "idle",
      ...(session?.error ? { error: session.error } : {}), turn: session?.turn ?? 0,
    };
  }

  private session(): AgentSession | undefined { return this.sessions.get(this.selected); }
  private history() { return { t: "agent.history", items: this.session()?.transcript.items ?? [] }; }

  /** A session is of one project: when another is opened, or none, the sessions end. */
  private follow(): void {
    const path = this.host.bench.project?.path ?? null;
    if (path === this.project) return;
    this.project = path;
    if (!this.sessions.size) return;
    this.dispose();
    queueMicrotask(() => this.host.broadcast(this.history()));
  }

  private open(id: AgentId, project: string): AgentSession {
    const known = this.sessions.get(id);
    if (known) return known;
    const scope = makeScope(project, this.workspace, this.readAlso, join(benchBin(), "bench"));
    const mine = () => this.sessions.get(id) === session && this.selected === id;
    const session: AgentSession = new AgentSession(this.agents[id], scope, {
      item: item => { if (mine()) this.host.broadcast({ t: "agent.item", item }); },
      delta: (itemId, text) => { if (mine()) this.host.broadcast({ t: "agent.delta", id: itemId, text }); },
      turn: (turn, status, stopReason, ms) => {
        if (mine()) this.host.broadcast({ t: "agent.turn", turn, status, ...(stopReason !== undefined ? { stopReason } : {}), ...(ms !== undefined ? { ms } : {}) });
      },
      changed: () => { if (mine()) this.host.stateChanged(); },
    });
    this.sessions.set(id, session);
    return session;
  }

  private select(agent: unknown): void {
    if (agent !== "claude" && agent !== "codex") throw new Error(`no agent ${String(agent)}`);
    this.chosen = true;
    if (agent === this.selected) return;
    this.selected = agent;
    this.host.stateChanged();
    this.host.broadcast(this.history());
  }

  private prompt(text: string, context: string | undefined, reply: (message: Record<string, unknown>) => void): void {
    this.follow();
    const project = this.host.bench.project;
    if (!project) { reply({ t: "error", message: "Open a project first: the agent works on its files" }); return; }
    if (!text.trim()) { reply({ t: "error", message: "The prompt is empty" }); return; }
    const session = this.open(this.selected, project.path);
    if (session.busy) { reply({ t: "error", message: `${session.spec.name} is still working: cancel the turn or wait for it` }); return; }
    // The turn reports through the events; the message is answered at once.
    void session.prompt(text, composePreamble(this.host.bench, this.workspace, context)).catch(error => console.error("agent:", error));
  }

  /** `agent.new`: the selected agent starts over with an empty transcript. */
  private fresh(): void {
    const session = this.sessions.get(this.selected);
    this.sessions.delete(this.selected);
    session?.dispose();
    this.host.stateChanged();
    this.host.broadcast(this.history());
  }

  /** Ends every session and its process. */
  dispose(): void {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.dispose();
  }
}

/** Registers the bridge on the server. The agents' processes end with the sidecar. */
export function installAgent(host: AgentHost, options: BridgeOptions = {}): AgentBridge {
  const bridge = new AgentBridge(host, options);
  process.on("exit", () => bridge.dispose());
  return bridge;
}

const quoted = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

/** Writes the `bench` launcher into <workspace>/.bench/bin, the first folder of the agents' PATH. Returns its path. */
export function installCli(): string {
  const dir = benchBin(), path = join(dir, "bench");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, `#!/bin/sh
# Pocket Bench's command line for the coding agent (kit/docs/bench-cli.md). Written by the sidecar when it starts.
POCKET_BENCH_HOME=${quoted(WORKSPACE)} POCKET_BENCH_ROOT=${quoted(ROOT)} exec ${quoted(BUN)} ${quoted(join(import.meta.dir, "../cli/bench.ts"))} "$@"
`);
  chmodSync(path, 0o755);
  return path;
}
