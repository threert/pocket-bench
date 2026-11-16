// Plays a lesson on a real bench in this process, as a person would: the
// project is made from the blank template and built by the PocketJS
// compiler, the app runs on the simulated Tab5, the Units are the models of
// sidecar/src/units, and each step's actions come from the lesson's
// playthrough.ts. Every step has to complete, in order, and none before the
// player did what it asks for.
import type { Lessons } from "../../src/lessons/index.ts";
import { screenItems } from "../../src/lessons/index.ts";
import type { Action, LessonDef, Playthrough } from "../../src/lessons/types.ts";
import type { Server } from "../../src/server.ts";

type Json = Record<string, unknown>;
const sleep = (ms: number) => new Promise(done => setTimeout(done, ms));

export interface PlayOptions {
  /** Seconds a step may take after its actions (a build, a sensor that warms up). */
  stepSeconds?: number;
  log?: (line: string) => void;
}

export class Player {
  constructor(readonly server: Server, readonly lessons: Lessons, private readonly options: PlayOptions = {}) {}

  private log(line: string): void { this.options.log?.(line); }

  async send(message: Json): Promise<Json[]> {
    const handler = this.server.handlers.get(String(message.t));
    if (!handler) throw new Error(`no handler for ${String(message.t)}`);
    const replies: Json[] = [];
    await handler(message, reply => replies.push(reply));
    const error = replies.find(reply => reply.t === "error");
    if (error) throw new Error(`${String(message.t)}: ${String(error.message)}`);
    return replies;
  }

  /** Waits until no build is running and the app has drawn a few frames of the build that is. */
  async settled(sinceBuild = 0, seconds = 120): Promise<void> {
    const bench = this.server.bench;
    const deadline = Date.now() + seconds * 1000;
    for (;;) {
      if (bench.builds > sinceBuild && bench.phase !== "building") {
        if (bench.phase === "failed" || bench.problems.length) throw new Error(`the build failed:\n${bench.problems.map(problem => `  ${problem.file ?? ""}:${problem.line ?? 0} ${problem.message}`).join("\n")}\n${bench.failure ? `${bench.failure.domain} fault: ${bench.failure.message}` : ""}`);
        if ((bench.lastSim?.frames ?? 0) >= 20 && (bench.lastSim?.at ?? 0) < 3_600_000_000) break;
      }
      if (Date.now() > deadline) throw new Error(`the bench did not settle in ${seconds} s (phase ${bench.phase}, build ${bench.builds})`);
      await sleep(100);
    }
  }

  private doneSteps(): string[] {
    return this.lessons.state()?.steps.filter(step => step.done).map(step => step.id) ?? [];
  }

  async tap(x: number, y: number): Promise<void> {
    this.server.bench.touch({ x, y });
    await sleep(130);
    this.server.bench.touch(null);
    await sleep(170);
  }

  private async act(action: Action): Promise<void> {
    const bench = this.server.bench;
    if ("plug" in action) await this.send({ t: "room.plug", uid: `${action.plug}-1`, type: action.plug });
    else if ("unplug" in action) await this.send({ t: "room.unplug", uid: `${action.unplug}-1` });
    else if ("set" in action) await this.send({ t: "room.set", uid: `${action.set[0]}-1`, key: action.set[1], value: action.set[2] });
    else if ("tap" in action) await this.tap(action.tap[0], action.tap[1]);
    else if ("tapText" in action) {
      const pattern = new RegExp(action.tapText);
      for (let waited = 0; ; waited += 200) {
        const item = screenItems(await bench.tree()).find(entry => pattern.test(entry.text));
        if (item) { await this.tap(Math.round(item.x + item.w / 2), Math.round(item.y + item.h / 2)); break; }
        if (waited > 15_000) throw new Error(`no text /${action.tapText}/ on the screen: ${screenItems(await bench.tree()).map(entry => entry.text).join(" | ")}`);
        await sleep(200);
      }
    } else if ("solution" in action) {
      const before = bench.builds;
      await this.send({ t: "lesson.solution" });
      await this.settled(before);
    } else if ("wait" in action) await sleep(action.wait * 1000);
  }

  /** Starts the lesson and plays every step. Returns the seconds each step took after its actions. */
  async play(lesson: LessonDef, script: Playthrough): Promise<Record<string, number>> {
    const bench = this.server.bench;
    const before = bench.builds;
    const opening = this.send({ t: "lesson.start", id: lesson.id });
    await this.settled(before);
    await opening;
    if (this.lessons.state()?.id !== lesson.id) throw new Error(`the lesson ${lesson.id} did not become active`);
    if (this.doneSteps().length) throw new Error(`a new project starts with steps done: ${this.doneSteps().join(", ")}`);
    const took: Record<string, number> = {};
    for (const [index, step] of lesson.steps.entries()) {
      const entry = script.find(item => item.step === step.id);
      if (!entry) throw new Error(`the playthrough has no entry for the step ${step.id}`);
      // A step that asks the player for something must not hold before they did it.
      if (entry.do.length) {
        const early = await this.lessons.tick();
        if (early) throw new Error(`the step ${early} completed before its actions: its check is too easy`);
      }
      for (const action of entry.do) { this.log(`${lesson.id}/${step.id}: ${JSON.stringify(action)}`); await this.act(action); }
      const started = Date.now(), limit = (this.options.stepSeconds ?? 60) * 1000;
      for (;;) {
        const completed = await this.lessons.tick();
        if (completed && completed !== step.id) throw new Error(`the step ${completed} completed while ${step.id} was in turn`);
        if (completed === step.id) break;
        if (Date.now() - started > limit) {
          const status = await this.lessons.status();
          throw new Error(`the step ${lesson.id}/${step.id} did not complete in ${limit / 1000} s:\n${(status.checks as string[] ?? []).join("\n")}\nscreen: ${(status.texts as string[] ?? []).join(" | ")}`);
        }
        await sleep(250);
      }
      took[step.id] = (Date.now() - started) / 1000;
      this.log(`${lesson.id}/${step.id}: done after ${took[step.id]!.toFixed(1)} s`);
      const done = this.doneSteps();
      const expected = lesson.steps.slice(0, index + 1).map(item => item.id);
      if (done.join() !== expected.join()) throw new Error(`after ${step.id} the steps done are ${done.join(", ")}, expected ${expected.join(", ")}`);
    }
    return took;
  }
}
