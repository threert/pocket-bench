// The lessons engine against a fake bench: what it adds to the state, how
// steps complete in order and are kept, and what the lesson messages do.
import "./env.ts";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lessons, screenItems, sourcesDigest, type LessonHost } from "../../src/lessons/index.ts";
import { mergeManifest } from "../../src/lessons/solution.ts";
import type { LessonDef, LessonState, LessonSummary } from "../../src/lessons/types.ts";
import type { ProjectInfo } from "../../src/workspace.ts";

type Json = Record<string, unknown>;

const LESSON: LessonDef = {
  id: "probe", number: 1, title: "探针", tagline: "一句话", story: "一个故事。", units: ["env3"], minutes: 5, level: 1,
  steps: [
    { id: "plug", text: "插上模块", hint: "点一下", check: { plugged: "env3" } },
    { id: "app", text: "做个界面", hint: "跟 AI 说", prompt: "显示温度", check: { all: [{ changed: true }, { running: true }, { shows: "env3.celsius", tolerance: 0.6 }] } },
    { id: "heat", text: "吹热它", hint: "热风枪", check: { input: "env3.celsius", gt: 30 } },
  ],
  prompts: ["再来一个", "换个颜色"],
};
const OTHER: LessonDef = { ...LESSON, id: "other", number: 2, title: "另一课", units: [], steps: [{ id: "only", text: "等着", hint: "不用做", check: { running: true } }] };

const tree = (texts: string[]) => ({ type: "view", text: "", hidden: false, rect: [0, 0, 640, 360], children: texts.map((text, index) => ({ type: "text", text: "", hidden: false, rect: [10, 10 + index * 20, 100, 18], children: [{ type: "text", text, hidden: false, rect: null, children: [] }] })) });

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function rig() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "pb-lessons-engine-")));
  made.push(workspace);
  const kit = join(workspace, "kit");
  mkdirSync(join(kit, "lessons", "probe", "solution", "extra"), { recursive: true });
  writeFileSync(join(kit, "lessons", "probe", "solution", "main.tsx"), "// solved\n");
  writeFileSync(join(kit, "lessons", "probe", "solution", "extra", "notes.ts"), "export const note = 1;\n");
  writeFileSync(join(kit, "lessons", "probe", "solution", "pocket.app.json"), JSON.stringify({
    id: "not.this", title: "Not this", engine: { capabilities: { requires: ["io.i2c", "net.http"] } },
    domains: { worker: { channels: [{ name: "state", kind: "snapshot", direction: "worker-to-ui", recordBytes: 64, capacity: 1 }] } },
  }));
  const projects: ProjectInfo[] = [];
  const create = (name: string, lesson?: string, title = name): ProjectInfo => {
    const path = join(workspace, name);
    mkdirSync(join(path, "ui"), { recursive: true });
    writeFileSync(join(path, "main.tsx"), "// template\n");
    writeFileSync(join(path, "ui", "index.tsx"), "// kit\n");
    writeFileSync(join(path, "pocket.app.json"), JSON.stringify({ id: `bench.local.${name}`, title, app: { output: name }, engine: { capabilities: { requires: ["io.i2c"] } }, domains: { worker: { entry: "worker.ts", nodes: [{ name: "porta", kind: "i2c" }], channels: [] } } }));
    writeFileSync(join(path, ".bench.json"), JSON.stringify({ template: "blank", lesson, created: "2026-01-01T00:00:00.000Z" }));
    const project = { name, path, title, id: `bench.local.${name}`, modified: Date.now(), lesson };
    projects.unshift(project);
    return project;
  };
  const handlers = new Map<string, (message: Json, reply: (message: Json) => void) => void | Promise<void>>();
  const sent: Json[] = [];
  const bench = {
    project: null as ProjectInfo | null, phase: "idle", units: [] as { uid: string; type: string; inputs: Record<string, unknown> }[],
    problems: [] as { message: string }[], failure: null as { domain: string; message: string; stack: string } | null,
    lastSim: undefined as { at: number; units: Record<string, Record<string, unknown>> } | undefined,
    texts: [] as string[], opened: [] as string[],
    async tree() { return tree(this.texts); },
    async open(project: ProjectInfo) { this.project = project; this.phase = "running"; this.opened.push(project.name); },
  };
  const host: LessonHost = {
    bench, stateParts: [],
    on(type, handler) { handlers.set(type, handler); },
    broadcast(message) { sent.push(message); },
    stateChanged() { sent.push({ t: "state", ...Object.assign({}, ...host.stateParts.map(part => part())) }); },
  };
  let clock = 1_000_000;
  const lessons = new Lessons(host, {
    lessons: [OTHER, LESSON], workspace, kit, intervalMs: 0, now: () => clock,
    projects: { list: () => projects, create: (_template, name, options) => create(name, options.lesson, options.title) },
  });
  const send = async (message: Json): Promise<Json[]> => {
    const replies: Json[] = [];
    await handlers.get(String(message.t))!(message, reply => replies.push(reply));
    return replies;
  };
  const state = () => Object.assign({}, ...host.stateParts.map(part => part())) as { lessons: LessonSummary[]; lesson: LessonState | null };
  const done = () => state().lesson?.steps.filter(step => step.done).map(step => step.id) ?? [];
  const notes = (name: string) => JSON.parse(readFileSync(join(workspace, name, ".bench.json"), "utf8")) as { lesson?: string; steps?: Record<string, string>; baseline?: string; template?: string };
  const advance = (ms: number) => { clock += ms; };
  return { workspace, kit, bench, host, lessons, sent, send, state, done, notes, create, advance, projects };
}

describe("state", () => {
  test("every state carries the lessons in order and no active lesson at first", () => {
    const { state } = rig();
    expect(state().lessons).toEqual([
      { id: "probe", number: 1, title: "探针", tagline: "一句话", units: ["env3"], minutes: 5, level: 1, done: false },
      { id: "other", number: 2, title: "另一课", tagline: "一句话", units: [], minutes: 5, level: 1, done: false },
    ]);
    expect(state().lesson).toBeNull();
  });

  test("lesson.start makes the lesson's project from the blank template and opens it", async () => {
    const { send, state, bench, notes, sent } = rig();
    expect(await send({ t: "lesson.start", id: "probe" })).toEqual([]);
    expect(bench.opened).toEqual(["probe"]);
    expect(bench.project?.title).toBe("探针");
    expect(state().lesson).toEqual({
      id: "probe", number: 1, title: "探针", tagline: "一句话", story: "一个故事。", units: ["env3"], minutes: 5, level: 1, done: false,
      steps: [
        { id: "plug", text: "插上模块", hint: "点一下", prompt: "", done: false },
        { id: "app", text: "做个界面", hint: "跟 AI 说", prompt: "显示温度", done: false },
        { id: "heat", text: "吹热它", hint: "热风枪", prompt: "", done: false },
      ],
      prompts: ["再来一个", "换个颜色"],
    });
    expect(notes("probe").lesson).toBe("probe");
    expect(notes("probe").baseline).toMatch(/^[0-9a-f]{40}$/);
    expect(notes("probe").template).toBe("blank");      // what createProject wrote stays
    expect(sent.some(message => message.t === "state" && (message.lesson as LessonState | null)?.id === "probe")).toBe(true);
  });

  test("an unknown lesson is refused", async () => {
    const { send, bench } = rig();
    expect(await send({ t: "lesson.start", id: "nope" })).toEqual([{ t: "error", message: "No lesson nope" }]);
    expect(bench.opened).toEqual([]);
  });

  test("starting a lesson again reopens its project instead of making another", async () => {
    const { send, bench, create, projects, state } = rig();
    await send({ t: "lesson.start", id: "probe" });
    await bench.open(create("free"));
    expect(state().lesson).toBeNull();                  // a project without a lesson clears it
    await send({ t: "lesson.start", id: "probe" });
    expect(bench.opened).toEqual(["probe", "free", "probe"]);
    expect(projects.filter(project => project.lesson === "probe").length).toBe(1);
    expect(state().lesson?.id).toBe("probe");
  });

  test("opening a lesson's project by hand restores the lesson; lesson.stop puts it away", async () => {
    const { send, bench, create, state } = rig();
    await bench.open(create("mine", "other", "另一课"));
    expect(state().lesson?.id).toBe("other");
    await send({ t: "lesson.stop" });
    expect(state().lesson).toBeNull();
    expect(bench.project?.name).toBe("mine");           // the project stays open
    await send({ t: "lesson.start", id: "other" });
    expect(state().lesson?.id).toBe("other");
    expect(bench.opened).toEqual(["mine"]);             // and it was not opened a second time
  });
});

describe("steps", () => {
  test("complete in order, one a check, are announced and are kept in the project", async () => {
    const { send, bench, lessons, done, sent, notes, advance } = rig();
    await send({ t: "lesson.start", id: "probe" });
    // Everything the third step wants is already true: it still waits for the first two.
    bench.lastSim = { at: 1, units: { "env3-1": { celsius: 35 } } };
    expect(await lessons.tick()).toBeUndefined();
    expect(done()).toEqual([]);

    bench.units = [{ uid: "env3-1", type: "env3", inputs: { celsius: 35 } }];
    expect(await lessons.tick()).toBe("plug");
    expect(sent.filter(message => message.t === "lesson.step")).toEqual([{ t: "lesson.step", id: "probe", step: "plug", done: true }]);
    expect(done()).toEqual(["plug"]);
    expect(Object.keys(notes("probe").steps!)).toEqual(["plug"]);

    // The second step: the sources have to change, the app has to run, the number has to be on the screen.
    bench.texts = ["35.0"];
    expect(await lessons.tick()).toBeUndefined();
    writeFileSync(join(bench.project!.path, "main.tsx"), "// the agent wrote this\n");
    bench.problems = [{ message: "TS2304" }];
    expect(await lessons.tick()).toBeUndefined();        // a broken build is not a running app
    bench.problems = [];
    bench.phase = "building";
    expect(await lessons.tick()).toBeUndefined();        // nor is one that is still building
    bench.phase = "running";
    expect(await lessons.tick()).toBe("app");

    advance(1000);
    expect(await lessons.tick()).toBe("heat");
    expect(done()).toEqual(["plug", "app", "heat"]);
    expect(sent.filter(message => message.t === "lesson.done")).toEqual([{ t: "lesson.done", id: "probe" }]);
    expect(await lessons.tick()).toBeUndefined();
  });

  test("a finished lesson is done in the list, for good", async () => {
    const { send, lessons, state, workspace } = rig();
    await send({ t: "lesson.start", id: "other" });
    expect(await lessons.tick()).toBe("only");
    expect(state().lessons.map(lesson => [lesson.id, lesson.done])).toEqual([["probe", false], ["other", true]]);
    expect(state().lesson?.done).toBe(true);
    expect(JSON.parse(readFileSync(join(workspace, ".bench", "progress.json"), "utf8")).lessons.other.done).toBe(true);
    await send({ t: "lesson.reset" });
    expect(state().lesson?.steps.map(step => step.done)).toEqual([false]);
    expect(state().lessons[1]!.done).toBe(true);        // resetting the steps does not take the lesson back
  });

  test("steps survive closing and reopening the project", async () => {
    const { send, bench, lessons, create, done } = rig();
    await send({ t: "lesson.start", id: "probe" });
    bench.units = [{ uid: "env3-1", type: "env3", inputs: {} }];
    await lessons.tick();
    await bench.open(create("free"));
    expect(done()).toEqual([]);
    await send({ t: "lesson.start", id: "probe" });
    expect(done()).toEqual(["plug"]);
  });

  test("a short press is seen by the next check", async () => {
    const { send, bench, lessons, advance } = rig();
    // The sensor is hot while the engine samples and cool again by the time the step is checked.
    await send({ t: "lesson.start", id: "probe" });
    bench.units = [{ uid: "env3-1", type: "env3", inputs: {} }];
    await lessons.tick();
    writeFileSync(join(bench.project!.path, "main.tsx"), "// changed\n");
    bench.texts = ["24.0"];
    bench.lastSim = { at: 1, units: { "env3-1": { celsius: 24 } } };
    await lessons.tick();
    bench.lastSim = { at: 2, units: { "env3-1": { celsius: 31 } } };   // hot for a moment
    await lessons.view();                                                  // the 100 ms sampler would have seen it
    advance(500);
    bench.lastSim = { at: 3, units: { "env3-1": { celsius: 24 } } };
    expect(await lessons.tick()).toBe("heat");
  });

  test("lesson.status says what the step in turn is missing", async () => {
    const { send, bench } = rig();
    expect(await send({ t: "lesson.status" })).toEqual([{ t: "lesson.status", id: null }]);
    await send({ t: "lesson.start", id: "probe" });
    bench.texts = ["你好"];
    const [status] = await send({ t: "lesson.status" });
    expect(status).toMatchObject({ t: "lesson.status", id: "probe", step: "plug", done: false, checks: ["no  env3 is plugged in"], texts: ["你好"], running: true, changed: false });
  });
});

describe("solutions", () => {
  test("lesson.solution copies the files and takes only the worker's wiring from the manifest", async () => {
    const { send, bench } = rig();
    await send({ t: "lesson.start", id: "probe" });
    const before = sourcesDigest(bench.project!.path);
    expect(await send({ t: "lesson.solution" })).toEqual([{ t: "lesson.solution", id: "probe", files: ["extra/notes.ts", "main.tsx", "pocket.app.json"] }]);
    const path = bench.project!.path;
    expect(readFileSync(join(path, "main.tsx"), "utf8")).toBe("// solved\n");
    expect(readFileSync(join(path, "extra", "notes.ts"), "utf8")).toContain("note");
    const manifest = JSON.parse(readFileSync(join(path, "pocket.app.json"), "utf8"));
    expect(manifest.id).toBe("bench.local.probe");
    expect(manifest.title).toBe("探针");
    expect(manifest.app.output).toBe("probe");
    expect(manifest.engine.capabilities.requires).toEqual(["io.i2c", "net.http"]);
    expect(manifest.domains.worker.entry).toBe("worker.ts");
    expect(manifest.domains.worker.nodes).toEqual([{ name: "porta", kind: "i2c" }]);
    expect(manifest.domains.worker.channels).toEqual([{ name: "state", kind: "snapshot", direction: "worker-to-ui", recordBytes: 64, capacity: 1 }]);
    expect(sourcesDigest(path)).not.toBe(before);       // which is what `changed` looks at
  });

  test("a lesson without a solution, or no lesson, is an error reply", async () => {
    const { send } = rig();
    expect(await send({ t: "lesson.solution" })).toEqual([{ t: "error", message: "No lesson is open" }]);
    await send({ t: "lesson.start", id: "other" });
    expect(await send({ t: "lesson.solution" })).toEqual([{ t: "error", message: "The lesson other has no solution yet" }]);
  });

  test("mergeManifest leaves a project without a worker section alone otherwise", () => {
    expect(mergeManifest({ id: "a", title: "A" }, { id: "b", domains: { worker: { nodes: [{ name: "porta" }] } } })).toEqual({ id: "a", title: "A", domains: { worker: { nodes: [{ name: "porta" }] } } });
  });
});

describe("helpers", () => {
  test("the sources' digest ignores the kit's copies, builds and notes", () => {
    const { create } = rig();
    const { path } = create("digest");
    const before = sourcesDigest(path);
    writeFileSync(join(path, "ui", "index.tsx"), "// changed kit copy\n");
    mkdirSync(join(path, ".build"));
    writeFileSync(join(path, ".build", "out.ts"), "x");
    writeFileSync(join(path, ".bench.json"), "{}");
    writeFileSync(join(path, "README.md"), "notes");
    expect(sourcesDigest(path)).toBe(before);
    writeFileSync(join(path, "worker.ts"), "// new\n");
    expect(sourcesDigest(path)).not.toBe(before);
  });

  test("a text made of several pieces is one text, in reading order", () => {
    const node = (type: string, text: string, rect: number[] | null, children: unknown[] = []) => ({ type, text, hidden: false, rect, children });
    const items = screenItems(node("view", "", [0, 0, 640, 360], [
      node("text", "", [300, 50, 80, 20], [node("text", "右", null)]),
      node("text", "", [10, 50, 80, 20], [node("text", "点了 ", null), node("text", "3", null), node("text", " 次", null)]),
      node("text", "", [10, 10, 80, 20], [node("text", "标题", null)]),
      { ...node("text", "", [10, 90, 80, 20], [node("text", "藏起来的", null)]), hidden: true },
    ]));
    expect(items.map(item => item.text)).toEqual(["标题", "点了 3 次", "右"]);
    expect(items[1]).toEqual({ x: 10, y: 50, w: 80, h: 20, text: "点了 3 次" });
  });
});
