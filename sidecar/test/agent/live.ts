// One turn with a real agent through a running sidecar, as the app would
// drive it: connects to /app, sends agent.select and agent.prompt, writes
// every agent message and every change of the agent's state to a JSONL file
// and prints a summary. A permission item ends the run (the point of the
// bench's rules is that the common path has none) unless --answer is given.
//   vendor/bin/bun sidecar/test/agent/live.ts --port 8741 --agent claude --prompt "..." [--out file.jsonl] [--answer <option kind>] [--timeout 300]
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const port = Number(option("--port", "8741")), agent = option("--agent", "claude")!, prompt = option("--prompt");
const out = option("--out", `/tmp/pb-agent-${agent}.jsonl`)!, answer = option("--answer"), timeout = Number(option("--timeout", "300"));
if (!prompt) { console.error("live.ts --prompt <text> [--agent claude|codex] [--port N] [--out file]"); process.exit(2); }

interface Item { id: string; turn: number; kind: string; text?: string; title?: string; status?: string; path?: string; diff?: { path: string; added: number; removed: number }; options?: { id: string; label: string; kind: string }[] }
const items = new Map<string, Item>();
let deltas = 0, permissions = 0, lastState = "", sent = false;
const started = Date.now();
writeFileSync(out, "");
const record = (message: unknown) => appendFileSync(out, JSON.stringify({ at: Date.now() - started, ...message as object }) + "\n");

function finish(code: number, why: string): never {
  console.log(`\n${why}`);
  for (const item of items.values()) {
    const text = (item.title ?? item.text ?? "").replace(/\s+/g, " ").slice(0, 110);
    console.log(`  ${item.kind.padEnd(10)} ${(item.status ?? "").padEnd(7)} ${text}${item.diff ? `  (+${item.diff.added} -${item.diff.removed} ${item.diff.path})` : ""}`);
  }
  console.log(`${items.size} items, ${deltas} deltas, ${permissions} permission prompts; transcript in ${out}`);
  process.exit(code);
}

const socket = new WebSocket(`ws://127.0.0.1:${port}/app?role=test`);
socket.onerror = () => finish(2, `no sidecar on port ${port}`);
setTimeout(() => finish(1, `no end of the turn after ${timeout} s`), timeout * 1000);
socket.onmessage = event => {
  if (typeof event.data !== "string") return;
  const message = JSON.parse(event.data) as { t: string; [key: string]: unknown };
  if (message.t === "state") {
    const state = JSON.stringify(message.agent);
    if (state !== lastState) { lastState = state; record({ t: "state", agent: message.agent }); }
    if (!sent) {
      sent = true;
      socket.send(JSON.stringify({ t: "agent.select", agent }));
      socket.send(JSON.stringify({ t: "agent.prompt", text: prompt }));
    }
    return;
  }
  if (message.t === "error") { record(message); finish(1, `the sidecar answered: ${String(message.message)}`); }
  if (!message.t.startsWith("agent.")) return;
  record(message);
  if (message.t === "agent.delta") { deltas++; const item = items.get(String(message.id)); if (item) item.text = (item.text ?? "") + String(message.text); }
  if (message.t === "agent.item") {
    const item = message.item as Item;
    if (item.kind === "permission" && !items.has(item.id)) {
      permissions++;
      const choice = answer ? item.options?.find(entry => entry.kind === answer) : undefined;
      if (choice) socket.send(JSON.stringify({ t: "agent.permission", id: item.id, optionId: choice.id }));
      else { items.set(item.id, item); socket.send(JSON.stringify({ t: "agent.cancel" })); finish(1, `the agent asked for permission: ${item.title} / ${item.text}`); }
    }
    items.set(item.id, { ...items.get(item.id), ...item });
  }
  // The state that follows the end of the turn (idle, or error) is part of the record.
  if (message.t === "agent.turn" && message.status === "ended") setTimeout(() => finish(message.stopReason === "end_turn" ? 0 : 1, `turn ${String(message.turn)} ended: ${String(message.stopReason)} after ${(Number(message.ms) / 1000).toFixed(1)} s`), 200);
};
