// A session's transcript: the items the chat panel shows, built from the
// agent's `session/update` notifications. A message streams into one text
// item (`agent.item` once, then `agent.delta`s); a tool call is one item
// that changes status; a plan is one item per turn.
import { basename, relative } from "node:path";
import type { SessionUpdate, ToolCallUpdate } from "@agentclientprotocol/sdk";
import { commandOf, inside, pathsOf, real } from "./policy.ts";
import type { Item, ItemStatus, ToolKind } from "./types.ts";

export const TRANSCRIPT_CAP = 500;

export interface TranscriptEvents {
  item(item: Item): void;
  delta(id: string, text: string): void;
}

/** A tool call as the agent has described it so far (an update carries only what changed). */
export interface ToolRecord {
  kind?: string | null;
  title?: string | null;
  status?: string | null;
  rawInput?: unknown;
  locations?: { path: string }[] | null;
  content?: unknown[] | null;
}

const TOOL_KINDS: Record<string, ToolKind> = {
  read: "read", edit: "edit", delete: "edit", move: "edit", search: "search", execute: "execute", think: "think", fetch: "fetch",
};
const STATUS: Record<string, ItemStatus> = { pending: "pending", in_progress: "running", completed: "done", failed: "failed" };

function oneLine(text: string, limit: number): string {
  const line = text.replace(/`/g, "").split("\n").map(part => part.trim()).find(part => part) ?? "";
  return line.length > limit ? `${line.slice(0, limit - 1).trimEnd()}…` : line;
}

/** Lines added and removed between two texts (the longest common subsequence of their lines). */
export function countChanges(oldText: string | null | undefined, newText: string): { added: number; removed: number } {
  const lines = (text: string) => { const parts = text.split("\n"); if (parts.at(-1) === "") parts.pop(); return parts; };
  let a = lines(oldText ?? ""), b = lines(newText);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  a = a.slice(start, a.length - end); b = b.slice(start, b.length - end);
  if (!a.length || !b.length) return { added: b.length, removed: a.length };
  // Too large for the table: every line of the changed part counts as changed.
  if (a.length * b.length > 4_000_000) return { added: b.length, removed: a.length };
  let previous = new Uint32Array(b.length + 1), current = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) current[j] = a[i - 1] === b[j - 1] ? previous[j - 1]! + 1 : Math.max(previous[j]!, current[j - 1]!);
    [previous, current] = [current, previous];
  }
  const common = previous[b.length]!;
  return { added: b.length - common, removed: a.length - common };
}

/** A short title for a tool call ("Reading main.tsx", "Running bench check") and the file it works on. */
export function describeTool(record: ToolRecord, project: string): { title: string; toolKind: ToolKind; path?: string } {
  const toolKind = TOOL_KINDS[record.kind ?? ""] ?? "other";
  const paths = pathsOf(record);
  const first = paths[0];
  const inProject = first !== undefined && inside(project, real(first)) ? relative(project, real(first)) : undefined;
  const name = paths.length > 1 ? `${paths.length} files` : first !== undefined ? basename(first) : undefined;
  const fallback = oneLine(record.title ?? "", 80);
  const input = record.rawInput && typeof record.rawInput === "object" ? record.rawInput as Record<string, unknown> : {};
  let title = fallback;
  if (record.kind === "execute") {
    const command = commandOf(record.rawInput);
    if (command) {
      // The working directory and the stream merge say nothing about what runs.
      const line = command.replace(/^\s*cd\s+\S+\s*&&\s*/, "").replace(/\s+2>&1/g, "");
      title = `Running ${oneLine(line, 60)}`;
    } else if (!title) title = "Running a command";
  } else if (name && (record.kind === "read" || record.kind === "edit" || record.kind === "delete" || record.kind === "move")) {
    title = `${{ read: "Reading", edit: "Editing", delete: "Deleting", move: "Moving" }[record.kind]} ${name}`;
  } else if (record.kind === "search") {
    const pattern = input.pattern ?? input.query;
    if (typeof pattern === "string" && pattern) title = `Searching for ${oneLine(pattern, 48)}`;
    else if (!title) title = "Searching";
  } else if (record.kind === "fetch") {
    try { if (typeof input.url === "string") title = `Fetching ${new URL(input.url).host}`; } catch { /* the agent's title stands */ }
    if (!title) title = "Fetching";
  } else if (!title) title = record.kind === "think" ? "Thinking" : "Working";
  return { title, toolKind, ...(inProject !== undefined && paths.length === 1 ? { path: inProject } : {}) };
}

function diffOf(record: ToolRecord, project: string): Item["diff"] {
  let path: string | undefined, added = 0, removed = 0;
  for (const block of record.content ?? []) {
    const diff = block as { type?: string; path?: unknown; oldText?: string | null; newText?: unknown };
    if (diff?.type !== "diff" || typeof diff.path !== "string" || typeof diff.newText !== "string") continue;
    const target = real(diff.path);
    path ??= inside(project, target) ? relative(project, target) : diff.path;
    const count = countChanges(diff.oldText, diff.newText);
    added += count.added; removed += count.removed;
  }
  return path === undefined ? undefined : { path, added, removed };
}

export class Transcript {
  readonly items: Item[] = [];
  private byId = new Map<string, Item>();
  private tools = new Map<string, ToolRecord>();
  /** The text or thought item that is still streaming, and the agent's id of its message. */
  private open: { item: Item; message: string | undefined } | undefined;
  private serial = 0;

  /** `project` is the resolved path of the project, for relative paths in tool items. */
  constructor(private readonly project: string, private readonly events: TranscriptEvents) {}

  private put(item: Item): Item {
    const known = this.byId.get(item.id);
    if (known) Object.assign(known, item);
    else {
      this.byId.set(item.id, item);
      this.items.push(item);
      if (this.items.length > TRANSCRIPT_CAP) for (const old of this.items.splice(0, this.items.length - TRANSCRIPT_CAP)) this.byId.delete(old.id);
    }
    const stored = known ?? item;
    this.events.item({ ...stored });
    return stored;
  }
  get(id: string): Item | undefined { return this.byId.get(id); }
  /** What is known of a tool call, for the permission rules. */
  tool(id: string): ToolRecord | undefined { return this.tools.get(id); }

  /** Ends the streaming item: what comes next is a new one. */
  private close(): void {
    if (!this.open) return;
    const { item } = this.open;
    this.open = undefined;
    this.put({ ...item, done: true });
  }

  add(turn: number, kind: "user" | "notice" | "error", text: string, more: Partial<Item> = {}): Item {
    this.close();
    return this.put({ id: `${kind}-${++this.serial}`, turn, kind, text, ...more });
  }

  private chunk(turn: number, kind: "text" | "thought", text: string, message: string | undefined): void {
    if (!text) return;
    const open = this.open;
    if (open && open.item.kind === kind && (open.message === undefined || message === undefined || open.message === message)) {
      open.item.text = (open.item.text ?? "") + text;
      this.events.delta(open.item.id, text);
      return;
    }
    this.close();
    const item = this.put({ id: `${kind}-${++this.serial}`, turn, kind, text });
    this.open = { item, message };
  }

  /** Takes a tool call or an update of one (also the one inside a permission request). */
  toolCall(turn: number, update: ToolCallUpdate & { title?: string | null }): Item {
    this.close();
    const record = this.tools.get(update.toolCallId) ?? {};
    this.tools.set(update.toolCallId, record);
    for (const key of ["kind", "title", "status", "rawInput", "locations", "content"] as const) {
      const value = (update as Record<string, unknown>)[key];
      if (value !== undefined && value !== null) (record as Record<string, unknown>)[key] = value;
    }
    const id = `tool-${update.toolCallId}`;
    const diff = diffOf(record, this.project);
    return this.put({
      id, turn: this.byId.get(id)?.turn ?? turn, kind: "tool", ...describeTool(record, this.project),
      status: STATUS[record.status ?? "pending"] ?? "pending", ...(diff ? { diff } : {}),
    });
  }

  update(turn: number, update: SessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const content = update.content as { type: string; text?: string };
        const message = (update as { messageId?: string | null }).messageId ?? undefined;
        if (content.type === "text") this.chunk(turn, update.sessionUpdate === "agent_message_chunk" ? "text" : "thought", content.text ?? "", message);
        break;
      }
      case "tool_call":
      case "tool_call_update":
        this.toolCall(turn, update);
        break;
      case "plan": {
        this.close();
        const entries = update.entries.map(entry => ({ text: entry.content, status: entry.status }));
        this.put({ id: `plan-${turn}`, turn, kind: "plan", entries, done: entries.length > 0 && entries.every(entry => entry.status === "completed") });
        break;
      }
      default: {
        // A live notice of the agent ("MCP server unavailable"). The other kinds (commands, modes, usage) have no place in the chat.
        const notice = update as { sessionUpdate: string; title?: unknown; description?: unknown; severity?: unknown };
        if (notice.sessionUpdate === "notice" && typeof notice.title === "string") {
          const text = typeof notice.description === "string" && notice.description ? `${notice.title}: ${notice.description}` : notice.title;
          this.add(turn, notice.severity === "error" ? "error" : "notice", text);
        }
      }
    }
  }

  /** A question for the user. `settle` closes it. */
  permission(turn: number, title: string, text: string, options: NonNullable<Item["options"]>): Item {
    this.close();
    return this.put({ id: `permission-${++this.serial}`, turn, kind: "permission", title, text, options, status: "pending" });
  }
  settle(id: string, status: ItemStatus): void {
    const item = this.byId.get(id);
    if (item && item.status === "pending") this.put({ ...item, status, done: true });
  }

  /** The turn is over: nothing of it streams or runs any more. */
  endTurn(turn: number): void {
    this.close();
    for (const item of this.items) {
      if (item.turn !== turn) continue;
      if ((item.kind === "tool" || item.kind === "permission") && (item.status === "pending" || item.status === "running")) this.put({ ...item, status: "failed", ...(item.kind === "permission" ? { done: true } : {}) });
    }
  }
}
