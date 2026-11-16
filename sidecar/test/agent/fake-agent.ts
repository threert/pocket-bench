// A stand-in for a coding agent: ACP over newline-delimited JSON-RPC on
// stdio, written without the SDK so the bridge is tested against the wire
// format. The last line of a prompt chooses what it does:
//
//   edit      thinks, streams a message, reads and rewrites main.tsx (asking first), runs `bench check`, plans
//   danger    asks to run `rm -rf build` and reports the answer
//   outside   tries to write a file outside the project through the client
//   echo      answers with the prompt it was given
//   die       exits in the middle of the turn
//   (other)   answers "ok"
import { join } from "node:path";

type Json = Record<string, unknown>;
const pending = new Map<number, (message: Json) => void>();
let nextId = 1000, cwd = "", mode = "ask", resumed = false, cancelled: (() => void) | undefined;

const write = (message: Json): void => { process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n"); };
const request = (method: string, params: Json) => new Promise<Json>(resolve => { const id = nextId++; pending.set(id, resolve); write({ id, method, params }); });
const update = (sessionId: string, body: Json) => write({ method: "session/update", params: { sessionId, update: body } });
const say = (sessionId: string, text: string, kind = "agent_message_chunk") => update(sessionId, { sessionUpdate: kind, content: { type: "text", text } });
const options = [
  { optionId: "allow", name: "Allow", kind: "allow_once" },
  { optionId: "always", name: "Always allow", kind: "allow_always" },
  { optionId: "reject", name: "Reject", kind: "reject_once" },
];
const outcome = (answer: Json) => {
  const result = (answer.result as { outcome?: { outcome: string; optionId?: string } } | undefined)?.outcome;
  return result ? `${result.outcome}${result.optionId ? `:${result.optionId}` : ""}` : `error:${(answer.error as { message?: string } | undefined)?.message}`;
};

async function prompt(sessionId: string, text: string): Promise<string> {
  const scenario = text.trim().split("\n").at(-1)!.trim();
  const file = join(cwd, "main.tsx");
  if (scenario === "edit") {
    say(sessionId, "Looking at the title.", "agent_thought_chunk");
    say(sessionId, "I will ");
    say(sessionId, "change the title.");
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read `main.tsx`", kind: "read", status: "pending", locations: [{ path: file }] });
    const read = await request("fs/read_text_file", { sessionId, path: file });
    const before = (read.result as { content: string }).content;
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" });
    const after = before.replace("Unit Swap", "Hello Bench");
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t2", title: "Write main.tsx", kind: "edit", status: "pending", locations: [{ path: file }],
      rawInput: { file_path: file }, content: [{ type: "diff", path: file, oldText: before, newText: after }] });
    const first = outcome(await request("session/request_permission", { sessionId, toolCall: { toolCallId: "t2" }, options }));
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "in_progress" });
    await request("fs/write_text_file", { sessionId, path: file, content: after });
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t2", status: "completed" });
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "t3", title: "bench check", kind: "execute", status: "pending", rawInput: { command: "bench check 2>&1" } });
    const second = outcome(await request("session/request_permission", { sessionId, toolCall: { toolCallId: "t3", kind: "execute", rawInput: { command: "bench check 2>&1" } }, options }));
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t3", status: "completed" });
    update(sessionId, { sessionUpdate: "plan", entries: [{ content: "Change the title", priority: "high", status: "completed" }, { content: "Check the screen", priority: "medium", status: "in_progress" }] });
    say(sessionId, `Done (${first}, ${second}, mode ${mode}${resumed ? ", resumed" : ""}).`);
    return "end_turn";
  }
  if (scenario === "danger") {
    update(sessionId, { sessionUpdate: "tool_call", toolCallId: "d1", title: "rm -rf build", kind: "execute", status: "pending", rawInput: { command: "rm -rf build" } });
    const answer = await Promise.race([
      request("session/request_permission", { sessionId, toolCall: { toolCallId: "d1" }, options }).then(outcome),
      new Promise<string>(resolve => { cancelled = () => resolve("interrupted"); }),
    ]);
    if (answer === "interrupted") return "cancelled";
    update(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "d1", status: answer === "selected:allow" ? "completed" : "failed" });
    say(sessionId, `The answer was ${answer}.`);
    return answer === "cancelled" ? "cancelled" : "end_turn";
  }
  if (scenario === "outside") {
    const target = join(cwd, "..", "..", "outside.txt");
    const written = await request("fs/write_text_file", { sessionId, path: target, content: "x" });
    const read = await request("fs/read_text_file", { sessionId, path: "/etc/hosts" });
    say(sessionId, `write ${written.error ? "refused" : "done"}, read ${read.error ? "refused" : "done"}`);
    return "end_turn";
  }
  if (scenario === "echo") { say(sessionId, text); return "end_turn"; }
  if (scenario === "die") { say(sessionId, "Going down."); await new Promise(done => setTimeout(done, 50)); console.error("fake agent: fatal"); process.exit(3); }
  say(sessionId, "ok");
  return "end_turn";
}

async function handle(message: Json): Promise<void> {
  const { id, method } = message as { id?: number; method?: string };
  const params = (message.params ?? {}) as Json;
  if (method === undefined) { pending.get(id!)?.(message); pending.delete(id!); return; }
  const answer = (result: Json) => write({ id, result });
  switch (method) {
    case "initialize":
      return answer({ protocolVersion: 1, agentCapabilities: { loadSession: false, sessionCapabilities: { resume: {} } }, agentInfo: { name: "fake-agent", version: "0.0.1" }, authMethods: [] });
    case "session/new":
      if (process.env.FAKE_AUTH) return write({ id, error: { code: -32000, message: "Authentication required" } });
      cwd = String(params.cwd);
      return answer({ sessionId: `fake-${process.pid}`, modes: { currentModeId: mode, availableModes: [{ id: "ask", name: "Ask" }, { id: "edits", name: "Edits" }] } });
    case "session/resume": cwd = String(params.cwd); resumed = true; return answer({});
    case "session/set_mode": mode = String(params.modeId); return answer({});
    case "session/prompt": {
      const text = (params.prompt as { type: string; text?: string }[]).map(block => block.text ?? "").join("");
      return answer({ stopReason: await prompt(String(params.sessionId), text) });
    }
    case "session/cancel": cancelled?.(); return;
    default:
      if (id !== undefined) write({ id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}

let buffer = "";
process.stdin.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8");
  for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
    const line = buffer.slice(0, end).trim();
    buffer = buffer.slice(end + 1);
    if (line) void handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));
