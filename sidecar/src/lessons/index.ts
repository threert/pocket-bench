// The lessons: guided builds of ten small apps (docs/LESSONS.md). A lesson
// is the data of kit/lessons/<id>/lesson.ts; its project is an ordinary
// project made from the blank template whose .bench.json names the lesson.
//
//   app → sidecar   lesson.start {id}  lesson.stop {}  lesson.solution {}  lesson.reset {}  lesson.status {}
//   sidecar → app   state.lessons  state.lesson  lesson.step {id, step, done}  lesson.done {id}
//
// About once a second the step in turn is checked against the live bench
// (checks.ts). A step that holds is done for good: the project's
// .bench.json keeps it, and <workspace>/.bench/progress.json keeps which
// lessons were finished.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BuildProblem } from "../build.ts";
import type { Failure } from "../bench.ts";
import { KIT, WORKSPACE } from "../paths.ts";
import type { PluggedUnit } from "../sim/protocol.ts";
import { createProject, listProjects, type ProjectInfo } from "../workspace.ts";
import { LESSONS } from "./catalog.ts";
import { evaluate, explain, type Memory } from "./checks.ts";
import { applySolution, hasSolution } from "./solution.ts";
import type { BenchView, LessonDef, LessonState, LessonSummary } from "./types.ts";

export type { Action, BenchView, Check, LessonDef, LessonState, LessonSummary, Playthrough, StepDef } from "./types.ts";
export { LESSONS } from "./catalog.ts";

type Json = Record<string, unknown>;
type Handler = (message: Json, reply: (message: Json) => void) => void | Promise<void>;

/** The part of the sidecar's server the lessons use (`Server` has all of it). */
export interface LessonHost {
  readonly bench: {
    project: ProjectInfo | null;
    phase: string;
    units: PluggedUnit[];
    problems: BuildProblem[];
    failure: Failure | null;
    lastSim?: { at: number; units: Record<string, Record<string, unknown>> } | undefined;
    tree(): Promise<unknown>;
    open(project: ProjectInfo): Promise<void>;
  };
  readonly stateParts: (() => Json)[];
  on(type: string, handler: Handler): void;
  broadcast(message: Json): void;
  stateChanged(): void;
}

export interface LessonOptions {
  lessons?: LessonDef[];
  workspace?: string;
  /** The kit: lessons/<id>/solution and templates/blank are looked up here. */
  kit?: string;
  /** How often the step in turn is checked, milliseconds. 0: only when `tick()` is called. */
  intervalMs?: number;
  /** Where projects come from (the workspace's own, unless a test brings others). */
  projects?: { list(): ProjectInfo[]; create(template: string, name: string, options: { title?: string; lesson?: string }): ProjectInfo };
  now?: () => number;
}

/** What a lesson project's .bench.json holds besides what `createProject` wrote. */
interface ProjectNotes { lesson?: string; steps?: Record<string, string>; baseline?: string; [key: string]: unknown }

const SAMPLE_MS = 100, RECENT_MS = 5000;

export interface ScreenText { x: number; y: number; w: number; h: number; text: string }

/** Every text on the screen with its box, top to bottom, left to right: what
 *  a person reads. A <Text> made of several pieces ("Count: " and a number)
 *  is one text here. */
export function screenItems(tree: unknown): ScreenText[] {
  interface Node { type: string; text: string; hidden: boolean; rect: [number, number, number, number] | null; children: Node[] }
  const found: ScreenText[] = [];
  const pieces = (node: Node): string => node.hidden ? "" : (node.text ?? "") + (node.children ?? []).map(pieces).join("");
  const walk = (node: Node | null) => {
    if (!node || node.hidden) return;
    if (node.type === "text") {
      const text = pieces(node);
      if (text) found.push({ x: node.rect?.[0] ?? 0, y: node.rect?.[1] ?? 0, w: node.rect?.[2] ?? 0, h: node.rect?.[3] ?? 0, text });
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(tree as Node | null);
  return found.map((item, index) => ({ item, index })).sort((a, b) => a.item.y - b.item.y || a.item.x - b.item.x || a.index - b.index).map(entry => entry.item);
}
export const screenTexts = (tree: unknown): string[] => screenItems(tree).map(item => item.text);

/** A digest of the project's own sources: everything but the kit's copies and what a build writes. */
export function sourcesDigest(project: string): string {
  const hash = createHash("sha1");
  const walk = (dir: string, prefix: string) => {
    let names: string[];
    try { names = readdirSync(dir).sort(); } catch { return; }
    for (const name of names) {
      if (name.startsWith(".") || name === "node_modules") continue;
      if (!prefix && (name === "ui" || name === "drivers")) continue;
      const full = join(dir, name);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.(tsx?|json)$/.test(name)) { hash.update(`${prefix}${name}\0`); hash.update(readFileSync(full)); hash.update("\0"); }
    }
  };
  walk(project, "");
  return hash.digest("hex");
}

export class Lessons {
  readonly lessons: LessonDef[];
  private readonly workspace: string;
  private readonly kit: string;
  private readonly projects: NonNullable<LessonOptions["projects"]>;
  private readonly now: () => number;
  /** The project the present state belongs to. */
  private path: string | null = null;
  private active: LessonDef | null = null;
  private notes: ProjectNotes = {};
  /** `lesson.stop` on this project: its lesson stays off until it is started again or another project opens. */
  private stopped: string | null = null;
  private memory: Memory = new Map();
  private recent: BenchView["recent"] = [];
  private lastSample: unknown;
  private timers: ReturnType<typeof setInterval>[] = [];
  private checking = false;

  constructor(private readonly host: LessonHost, options: LessonOptions = {}) {
    this.lessons = [...(options.lessons ?? LESSONS)].sort((a, b) => a.number - b.number);
    this.workspace = options.workspace ?? WORKSPACE;
    this.kit = options.kit ?? KIT;
    this.projects = options.projects ?? { list: listProjects, create: createProject };
    this.now = options.now ?? Date.now;
    host.stateParts.push(() => { this.follow(); return { lessons: this.summaries(), lesson: this.state() }; });
    host.on("lesson.start", (message, reply) => this.start(String(message.id ?? ""), reply));
    host.on("lesson.stop", () => this.stop());
    host.on("lesson.solution", (_message, reply) => this.solution(reply));
    host.on("lesson.reset", () => this.reset());
    host.on("lesson.status", async (_message, reply) => reply(await this.status()));
    const interval = options.intervalMs ?? 1000;
    if (interval > 0) {
      this.timers.push(setInterval(() => void this.tick().catch(error => console.error("lessons:", error)), interval));
      this.timers.push(setInterval(() => this.sample(), SAMPLE_MS));
    }
  }

  dispose(): void {
    for (const timer of this.timers) clearInterval(timer);
    this.timers = [];
  }

  // ----- what the app shows -----

  private progress(): Record<string, { done?: boolean; at?: string }> {
    try { return JSON.parse(readFileSync(join(this.workspace, ".bench", "progress.json"), "utf8")).lessons ?? {}; } catch { return {}; }
  }
  private finished(id: string): void {
    const lessons = this.progress();
    if (lessons[id]?.done) return;
    lessons[id] = { done: true, at: new Date(this.now()).toISOString() };
    mkdirSync(join(this.workspace, ".bench"), { recursive: true });
    writeFileSync(join(this.workspace, ".bench", "progress.json"), JSON.stringify({ lessons }, null, 2) + "\n");
  }

  summaries(): LessonSummary[] {
    const progress = this.progress();
    return this.lessons.map(lesson => ({
      id: lesson.id, number: lesson.number, title: lesson.title, tagline: lesson.tagline, units: lesson.units,
      minutes: lesson.minutes, level: lesson.level, done: progress[lesson.id]?.done === true,
    }));
  }

  state(): LessonState | null {
    const lesson = this.active;
    if (!lesson) return null;
    const done = this.notes.steps ?? {};
    return {
      id: lesson.id, number: lesson.number, title: lesson.title, tagline: lesson.tagline, story: lesson.story, units: lesson.units,
      minutes: lesson.minutes, level: lesson.level, done: this.progress()[lesson.id]?.done === true,
      steps: lesson.steps.map(step => ({ id: step.id, text: step.text, hint: step.hint, prompt: step.prompt ?? "", done: done[step.id] !== undefined })),
      prompts: lesson.prompts,
    };
  }

  // ----- the project's notes -----

  private readNotes(path: string): ProjectNotes {
    try { return JSON.parse(readFileSync(join(path, ".bench.json"), "utf8")) as ProjectNotes; } catch { return {}; }
  }
  private writeNotes(): void {
    if (!this.path) return;
    // Other fields of the file (the template, the date) are kept as they are.
    const file = join(this.path, ".bench.json");
    writeFileSync(file, JSON.stringify({ ...this.readNotes(this.path), lesson: this.notes.lesson, steps: this.notes.steps ?? {}, baseline: this.notes.baseline }, null, 2) + "\n");
  }

  /** The lesson on show is the open project's: a lesson project restores it, any other project clears it. */
  private follow(): void {
    const path = this.host.bench.project?.path ?? null;
    if (path === this.path) return;
    this.path = path;
    this.active = null;
    this.notes = {};
    this.memory = new Map();
    this.recent = [];
    if (this.stopped !== path) this.stopped = null;
    if (!path) return;
    const notes = this.readNotes(path);
    const lesson = this.lessons.find(item => item.id === notes.lesson);
    if (!lesson) return;
    this.notes = notes;
    if (!notes.baseline) { this.notes.baseline = sourcesDigest(path); this.writeNotes(); }
    if (this.stopped !== path) this.active = lesson;
  }

  // ----- messages -----

  private async start(id: string, reply: (message: Json) => void): Promise<void> {
    const lesson = this.lessons.find(item => item.id === id);
    if (!lesson) { reply({ t: "error", message: `No lesson ${id}` }); return; }
    try {
      // The newest project of this lesson, or a new one from the blank template.
      const project = this.projects.list().find(item => item.lesson === id)
        ?? this.projects.create("blank", id, { title: lesson.title, lesson: id });
      this.stopped = null;
      if (this.host.bench.project?.path !== project.path) await this.host.bench.open(project);
      else { this.path = null; }
      this.follow();
      this.host.stateChanged();
    } catch (error) {
      reply({ t: "error", message: String(error instanceof Error ? error.message : error) });
    }
  }

  private stop(): void {
    this.follow();
    if (!this.active) return;
    this.stopped = this.path;
    this.active = null;
    this.host.stateChanged();
  }

  private solution(reply: (message: Json) => void): void {
    this.follow();
    if (!this.active || !this.path) { reply({ t: "error", message: "No lesson is open" }); return; }
    if (!hasSolution(this.kit, this.active.id)) { reply({ t: "error", message: `The lesson ${this.active.id} has no solution yet` }); return; }
    try {
      const files = applySolution(this.kit, this.active.id, this.path);
      reply({ t: "lesson.solution", id: this.active.id, files });
    } catch (error) {
      reply({ t: "error", message: String(error instanceof Error ? error.message : error) });
    }
  }

  private reset(): void {
    this.follow();
    if (!this.active) return;
    this.notes.steps = {};
    this.memory = new Map();
    this.writeNotes();
    this.host.stateChanged();
  }

  // ----- checking -----

  /** Keeps the Units' states of the last seconds, so that a short press is seen by a check a second later. */
  private sample(): void {
    const sim = this.host.bench.lastSim;
    if (!sim || sim === this.lastSample || !this.active) return;
    this.lastSample = sim;
    const at = this.now();
    this.recent.push({ at, sim: sim.units });
    while (this.recent.length && this.recent[0]!.at < at - RECENT_MS) this.recent.shift();
  }

  async view(): Promise<BenchView> {
    const bench = this.host.bench;
    this.sample();
    const texts = bench.phase === "idle" ? [] : screenTexts(await bench.tree().catch(() => null));
    return {
      at: this.now(),
      running: bench.phase === "running" && !bench.failure && bench.problems.length === 0,
      changed: !!this.path && !!this.notes.baseline && sourcesDigest(this.path) !== this.notes.baseline,
      units: bench.units.map(unit => ({ uid: unit.uid, type: unit.type, inputs: unit.inputs })),
      sim: bench.lastSim?.units ?? {},
      recent: this.recent,
      texts,
    };
  }

  /** Checks the step in turn; a step that holds is done. Returns the step that was completed. */
  async tick(): Promise<string | undefined> {
    if (this.checking) return undefined;
    this.checking = true;
    try {
      this.follow();
      const lesson = this.active, path = this.path;
      if (!lesson || !path) return undefined;
      const done = this.notes.steps ?? {};
      const step = lesson.steps.find(item => done[item.id] === undefined);
      if (!step) return undefined;
      // A build in progress shows the last app: its screen says nothing about the new sources.
      if (this.host.bench.phase === "building") return undefined;
      const view = await this.view();
      if (this.path !== path || this.active !== lesson) return undefined;
      if (!evaluate(step.check, view, this.memory)) return undefined;
      this.notes.steps = { ...done, [step.id]: new Date(this.now()).toISOString() };
      this.memory = new Map();
      this.writeNotes();
      this.host.broadcast({ t: "lesson.step", id: lesson.id, step: step.id, done: true });
      if (lesson.steps.every(item => this.notes.steps![item.id] !== undefined)) {
        this.finished(lesson.id);
        this.host.broadcast({ t: "lesson.done", id: lesson.id });
      }
      this.host.stateChanged();
      return step.id;
    } finally {
      this.checking = false;
    }
  }

  /** The step in turn and what its check sees right now: for whoever writes a lesson. */
  async status(): Promise<Json> {
    this.follow();
    const lesson = this.active;
    if (!lesson) return { t: "lesson.status", id: null };
    const done = this.notes.steps ?? {};
    const step = lesson.steps.find(item => done[item.id] === undefined);
    if (!step) return { t: "lesson.status", id: lesson.id, step: null, done: true };
    const view = await this.view();
    return {
      t: "lesson.status", id: lesson.id, step: step.id, done: false,
      checks: explain(step.check, view, this.memory).map(line => `${"  ".repeat(line.depth)}${line.ok ? "ok " : "no "} ${line.says}`),
      texts: view.texts, running: view.running, changed: view.changed,
    };
  }
}

/** Registers the lessons on the server. */
export function installLessons(host: LessonHost, options: LessonOptions = {}): Lessons {
  if (!existsSync(join(options.kit ?? KIT, "lessons"))) console.error("lessons: the kit has no lessons folder");
  return new Lessons(host, options);
}
