// The bridge against a fake ACP agent (fake-agent.ts): the messages the app
// gets, the permission rules at work, and the life of the agent's process.
//   vendor/bin/bun test sidecar/test/agent
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSpec } from "../../src/agent/adapters.ts";
import { AgentBridge } from "../../src/agent/index.ts";
import type { AgentHost, AgentId, AgentState, Item } from "../../src/agent/types.ts";

type Json = Record<string, unknown>;

const fake = (id: AgentId, env: Record<string, string> = {}): AgentSpec => ({
  id, name: id === "claude" ? "Claude Code" : "Codex", mode: "edits", login: "The fake agent is not logged in",
  detect: async () => ({ id, name: id, installed: true, version: "0.0.1" }),
  launch: async () => ({ command: [process.execPath, join(import.meta.dir, "fake-agent.ts")], env: { ...process.env as Record<string, string>, ...env } }),
});

function bench(env: Record<string, string> = {}) {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "pb-agent-test-")));
  const path = join(workspace, "probe");
  mkdirSync(path);
  writeFileSync(join(path, "main.tsx"), `const title = "Unit Swap";\nexport default title;\n`);
  writeFileSync(join(workspace, "AGENTS.md"), "# Guide\n");
  const handlers = new Map<string, (message: Json, reply: (message: Json) => void) => void | Promise<void>>();
  const sent: Json[] = [];
  const host: AgentHost & { bench: AgentHost["bench"] } = {
    bench: { project: { name: "probe", path, title: "Probe", id: "bench.local.probe", modified: 0 }, units: [{ uid: "env3-1", type: "env3", inputs: { celsius: 24.6 } }], problems: [], failure: null },
    stateParts: [],
    on(type, handler) { handlers.set(type, handler); },
    broadcast(message) { sent.push(message); },
    stateChanged() { sent.push({ t: "state", ...Object.assign({}, ...host.stateParts.map(part => part())) }); },
  };
  const bridge = new AgentBridge(host, { agents: { claude: fake("claude", env), codex: fake("codex", env) }, workspace, readAlso: [] });
  const send = async (message: Json): Promise<Json[]> => {
    const replies: Json[] = [];
    await handlers.get(String(message.t))!(message, reply => replies.push(reply));
    return replies;
  };
  const until = async <T>(look: () => T | undefined | false, what: string): Promise<T> => {
    for (let waited = 0; waited < 8000; waited += 10) {
      const found = look();
      if (found) return found;
      await new Promise(done => setTimeout(done, 10));
    }
    throw new Error(`timed out waiting for ${what}; got ${JSON.stringify(sent.slice(-6))}`);
  };
  const items = (): Item[] => {
    const byId = new Map<string, Item>();
    for (const message of sent) {
      if (message.t === "agent.item") { const item = message.item as Item; byId.set(item.id, { ...byId.get(item.id), ...item }); }
      if (message.t === "agent.delta") { const item = byId.get(String(message.id))!; item.text = (item.text ?? "") + String(message.text); }
    }
    return [...byId.values()];
  };
  const ended = (turn: number) => until(() => sent.find(message => message.t === "agent.turn" && message.turn === turn && message.status === "ended"), `the end of turn ${turn}`);
  const states = () => sent.filter(message => message.t === "state").map(message => (message.agent as AgentState).status);
  return { workspace, path, host, bridge, sent, send, until, items, ended, states };
}

let open: ReturnType<typeof bench>[] = [];
const start = (env?: Record<string, string>) => { const made = bench(env); open.push(made); return made; };
afterEach(() => {
  for (const made of open) { made.bridge.dispose(); rmSync(made.workspace, { recursive: true, force: true }); }
  open = [];
});

describe("a turn", () => {
  test("streams the message, reports the tools and edits the file without asking", async () => {
    const b = start();
    expect(await b.send({ t: "agent.prompt", text: "Change the title\nedit", context: "Lesson 2: show the temperature." })).toEqual([]);
    const end = await b.ended(1);
    expect(end.stopReason).toBe("end_turn");
    expect(typeof end.ms).toBe("number");
    expect(b.sent.find(message => message.t === "agent.turn")).toEqual({ t: "agent.turn", turn: 1, status: "started" });

    const items = b.items();
    expect(items.map(item => item.kind)).toEqual(["user", "thought", "text", "tool", "tool", "tool", "plan", "text"]);
    expect(items[0]).toMatchObject({ kind: "user", turn: 1, text: "Change the title\nedit" });
    expect(items[1]).toMatchObject({ kind: "thought", text: "Looking at the title.", done: true });
    expect(items[2]).toMatchObject({ kind: "text", text: "I will change the title.", done: true });
    expect(items[3]).toMatchObject({ kind: "tool", title: "Reading main.tsx", toolKind: "read", status: "done", path: "main.tsx" });
    expect(items[4]).toMatchObject({ kind: "tool", title: "Editing main.tsx", toolKind: "edit", status: "done", path: "main.tsx", diff: { path: "main.tsx", added: 1, removed: 1 } });
    expect(items[5]).toMatchObject({ kind: "tool", title: "Running bench check", toolKind: "execute", status: "done" });
    expect(items[6]).toMatchObject({ kind: "plan", entries: [{ text: "Change the title", status: "completed" }, { text: "Check the screen", status: "in_progress" }] });
    // Both requests were allowed by the rules, and the session was put into the spec's mode.
    expect(items[7]!.text).toBe("Done (selected:allow, selected:allow, mode edits).");
    expect(new Set(items.map(item => item.id)).size).toBe(items.length);

    // The second chunk of the message came as a delta of the item the first one made.
    const text = b.sent.filter(message => message.t === "agent.item" && (message.item as Item).kind === "text")[0]!.item as Item;
    expect(text.text).toBe("I will ");
    expect(b.sent.some(message => message.t === "agent.delta" && message.id === text.id && message.text === "change the title.")).toBe(true);

    expect(readFileSync(join(b.path, "main.tsx"), "utf8")).toContain("Hello Bench");
    expect(b.states()).toEqual(expect.arrayContaining(["starting", "working", "idle"]));
    expect(b.states()).not.toContain("waiting");
    expect(b.bridge.state()).toMatchObject({ selected: "claude", status: "idle", turn: 1 });
    expect((await b.send({ t: "agent.history" }))[0]).toMatchObject({ t: "agent.history", items: items.map(item => ({ id: item.id })) });
  });

  test("sends the bench's preamble in front of the prompt", async () => {
    const b = start();
    b.host.bench.problems = [{ file: "main.tsx", line: 3, message: "TS2304: Cannot find name 'x'." }];
    await b.send({ t: "agent.prompt", text: "echo", context: "Lesson 2: show the temperature." });
    await b.ended(1);
    const said = b.items().find(item => item.kind === "text")!.text!;
    expect(said).toContain(`Project "Probe" in ${b.path}`);
    expect(said).toContain("ENV III (env3-1, type env3, I2C 0x44 0x70)");
    expect(said).toContain("Lesson 2: show the temperature.");
    expect(said).toContain("main.tsx:3 TS2304: Cannot find name 'x'.");
    expect(said).toContain(`read ${join(b.workspace, "AGENTS.md")}`);
    expect(said).toContain("`bench check`");
    expect(said.split(/\s+/).length).toBeLessThan(250);
    expect(said.endsWith("\n\necho")).toBe(true);
  });

  test("keeps the process between prompts and refuses a second prompt while one runs", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "danger" });
    await b.until(() => b.items().find(item => item.kind === "permission"), "the permission item");
    expect((await b.send({ t: "agent.prompt", text: "hello" }))[0]).toMatchObject({ t: "error" });
    await b.send({ t: "agent.cancel" });
    await b.ended(1);
    await b.send({ t: "agent.prompt", text: "hello" });
    await b.ended(2);
    expect(b.items().filter(item => item.kind === "text").at(-1)).toMatchObject({ turn: 2, text: "ok" });
    // One start: the second turn went to the process of the first.
    expect(b.states().filter((status, index, all) => status === "starting" && all[index - 1] !== "starting").length).toBe(1);
  });
});

describe("permissions", () => {
  test("a command outside the rules waits for the user's answer", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "danger" });
    const asked = await b.until(() => b.items().find(item => item.kind === "permission"), "the permission item");
    expect(asked).toMatchObject({ kind: "permission", status: "pending", title: "Running rm -rf build", text: "rm -rf build" });
    expect(asked.options).toEqual([{ id: "allow", label: "Allow", kind: "allow_once" }, { id: "always", label: "Always allow", kind: "allow_always" }, { id: "reject", label: "Reject", kind: "reject_once" }]);
    await b.until(() => b.states().at(-1) === "waiting", "the waiting status");
    expect((await b.send({ t: "agent.permission", id: asked.id, optionId: "nope" }))[0]).toMatchObject({ t: "error" });
    expect(await b.send({ t: "agent.permission", id: asked.id, optionId: "allow" })).toEqual([]);
    await b.ended(1);
    expect(b.items().find(item => item.id === asked.id)).toMatchObject({ status: "done", done: true });
    expect(b.items().at(-1)!.text).toBe("The answer was selected:allow.");
    expect(b.items().find(item => item.kind === "tool")).toMatchObject({ status: "done" });
  });

  test("a rejection reaches the agent", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "danger" });
    const asked = await b.until(() => b.items().find(item => item.kind === "permission"), "the permission item");
    await b.send({ t: "agent.permission", id: asked.id, optionId: "reject" });
    await b.ended(1);
    expect(b.items().find(item => item.id === asked.id)).toMatchObject({ status: "failed", done: true });
    expect(b.items().at(-1)!.text).toBe("The answer was selected:reject.");
  });

  test("cancel answers the open permission as cancelled and ends the turn", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "danger" });
    const asked = await b.until(() => b.items().find(item => item.kind === "permission"), "the permission item");
    await b.send({ t: "agent.cancel" });
    expect((await b.ended(1)).stopReason).toBe("cancelled");
    expect(b.items().find(item => item.id === asked.id)).toMatchObject({ status: "failed", done: true });
    expect(b.items().find(item => item.kind === "tool")).toMatchObject({ status: "failed" });
    expect(b.bridge.state().status).toBe("idle");
  });

  test("the client's file methods stay inside the workspace", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "outside" });
    await b.ended(1);
    expect(b.items().at(-1)!.text).toBe("write refused, read refused");
    expect(existsSync(join(b.workspace, "..", "outside.txt"))).toBe(false);
  });
});

describe("the process", () => {
  test("a death ends the turn with an error, and the next prompt starts again", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "die" });
    expect((await b.ended(1)).stopReason).toBe("error");
    const error = b.items().find(item => item.kind === "error")!;
    expect(error.text).toContain("process stopped (exit 3)");
    expect(error.text).toContain("fake agent: fatal");
    expect(b.bridge.state()).toMatchObject({ status: "error", error: error.text });
    await b.send({ t: "agent.prompt", text: "edit" });
    await b.ended(2);
    // The new process was asked to resume the session of the dead one.
    expect(b.items().at(-1)!.text).toBe("Done (selected:allow, selected:allow, mode edits, resumed).");
    expect(b.bridge.state().status).toBe("idle");
  });

  test("an agent that needs a login says how", async () => {
    const b = start({ FAKE_AUTH: "1" });
    await b.send({ t: "agent.prompt", text: "hello" });
    await b.ended(1);
    expect(b.items().find(item => item.kind === "error")!.text).toBe("The fake agent is not logged in");
    expect(b.bridge.state().status).toBe("error");
  });

  test("agent.new empties the transcript; each agent has its own; another project ends the sessions", async () => {
    const b = start();
    await b.send({ t: "agent.prompt", text: "hello" });
    await b.ended(1);
    await b.send({ t: "agent.select", agent: "codex" });
    expect(b.sent.at(-1)).toEqual({ t: "agent.history", items: [] });
    expect(b.bridge.state()).toMatchObject({ selected: "codex", status: "idle", turn: 0 });
    await b.send({ t: "agent.select", agent: "claude" });
    expect((b.sent.at(-1)!.items as Item[]).map(item => item.kind)).toEqual(["user", "text"]);
    await b.send({ t: "agent.new" });
    expect(b.sent.at(-1)).toEqual({ t: "agent.history", items: [] });
    expect(b.bridge.state().turn).toBe(0);

    await b.send({ t: "agent.prompt", text: "hello" });
    await b.ended(1);
    b.host.bench.project = null;
    b.host.stateChanged();
    expect(b.bridge.state()).toMatchObject({ status: "idle", turn: 0 });
    expect((await b.send({ t: "agent.prompt", text: "hello" }))[0]).toMatchObject({ t: "error" });
    await expect(b.send({ t: "agent.select", agent: "gemini" })).rejects.toThrow("no agent gemini");
  });
});
