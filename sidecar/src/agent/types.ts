// What the coding agent's bridge says to the app. The chat panel is written
// against these shapes (docs/AGENT-BRIDGE.md): keep them as they are.
import type { BuildProblem } from "../build.ts";
import type { Failure } from "../bench.ts";
import type { PluggedUnit } from "../sim/protocol.ts";
import type { ProjectInfo } from "../workspace.ts";

export type AgentId = "claude" | "codex";
export type AgentStatus = "idle" | "starting" | "working" | "waiting" | "error";
export type ItemKind = "user" | "text" | "thought" | "tool" | "plan" | "permission" | "notice" | "error";
export type ToolKind = "read" | "edit" | "execute" | "search" | "fetch" | "think" | "other";
export type ItemStatus = "pending" | "running" | "done" | "failed";

/** One entry of the transcript. `agent.item` upserts it by `id`. */
export interface Item {
  /** Unique in its session; items keep the order of their first appearance. */
  id: string;
  turn: number;
  kind: ItemKind;
  text?: string;
  title?: string;
  toolKind?: ToolKind;
  status?: ItemStatus;
  /** Relative to the project, for a tool that works on one file. */
  path?: string;
  diff?: { path: string; added: number; removed: number };
  /** The choices of a permission item. */
  options?: { id: string; label: string; kind: string }[];
  /** The steps of a plan item. */
  entries?: { text: string; status: string }[];
  done?: boolean;
}

export interface AgentInfo { id: AgentId; name: string; installed: boolean; version?: string; note?: string }

/** The `agent` part of the `state` message. */
export interface AgentState {
  selected: AgentId;
  agents: AgentInfo[];
  status: AgentStatus;
  error?: string;
  turn: number;
}

type Json = Record<string, unknown>;
type Handler = (message: Json, reply: (message: Json) => void) => void | Promise<void>;

/** The part of the sidecar's server the bridge uses (`Server` has all of it). */
export interface AgentHost {
  readonly bench: { project: ProjectInfo | null; units: PluggedUnit[]; problems: BuildProblem[]; failure: Failure | null };
  readonly stateParts: (() => Json)[];
  on(type: string, handler: Handler): void;
  broadcast(message: Json): void;
  stateChanged(): void;
}
