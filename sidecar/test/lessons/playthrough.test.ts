// Every lesson that has a reference solution, played from start to finish on
// a real bench: kit/lessons/<id>/solution applied over a new project,
// kit/lessons/<id>/playthrough.ts as the player. A build takes a few
// seconds and a sensor warms up as the part does, so a lesson takes about a
// minute.
import { TEST_HOME } from "./env.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Lessons } from "../../src/lessons/index.ts";
import { LESSONS } from "../../src/lessons/catalog.ts";
import type { Playthrough } from "../../src/lessons/types.ts";
import { KIT, WORKSPACE } from "../../src/paths.ts";
import { Server } from "../../src/server.ts";
import { Player } from "./playthrough.ts";

const solved = LESSONS.filter(lesson => existsSync(join(KIT, "lessons", lesson.id, "solution", "main.tsx")));
let server: Server, lessons: Lessons, player: Player;

beforeAll(() => {
  // paths.ts was loaded by an earlier test file with another home: refuse to play in the user's workspace.
  if (WORKSPACE !== TEST_HOME) throw new Error(`the workspace is ${WORKSPACE}, not the test's ${TEST_HOME}: run this file by itself, or with POCKET_BENCH_HOME set to a scratch folder`);
  server = new Server();
  lessons = new Lessons(server, { intervalMs: 0 });
  // PLAY_LOG=1 prints every action; PLAY_STEP_SECONDS shortens the wait for a step (60 s) while working on a lesson.
  player = new Player(server, lessons, { log: process.env.PLAY_LOG ? line => console.log(line) : undefined, stepSeconds: Number(process.env.PLAY_STEP_SECONDS ?? 60) });
});
afterAll(() => {
  lessons?.dispose();
  server?.bench.close();
});

describe("playthroughs", () => {
  test("hello and weather have solutions", () => {
    expect(solved.map(lesson => lesson.id)).toEqual(expect.arrayContaining(["hello", "weather"]));
  });

  for (const lesson of solved) {
    test(`${lesson.id}: every step completes, in order`, async () => {
      const script = (await import(join(KIT, "lessons", lesson.id, "playthrough.ts"))).default as Playthrough;
      const took = await player.play(lesson, script);
      expect(Object.keys(took)).toEqual(lesson.steps.map(step => step.id));
      // The lesson is finished: in the state, in the project, in the workspace.
      const state = server.state() as { lesson: { id: string; done: boolean; steps: { done: boolean }[] }; lessons: { id: string; done: boolean }[] };
      expect(state.lesson.id).toBe(lesson.id);
      expect(state.lesson.steps.every(step => step.done)).toBe(true);
      expect(state.lesson.done).toBe(true);
      expect(state.lessons.find(item => item.id === lesson.id)?.done).toBe(true);
      const project = server.bench.project!;
      expect(project.name).toBe(lesson.id);
      expect(Object.keys(JSON.parse(readFileSync(join(project.path, ".bench.json"), "utf8")).steps)).toEqual(lesson.steps.map(step => step.id));
      expect(JSON.parse(readFileSync(join(WORKSPACE, ".bench", "progress.json"), "utf8")).lessons[lesson.id].done).toBe(true);
      // The solution leaves a healthy app behind.
      expect(server.bench.problems).toEqual([]);
      expect(server.bench.failure).toBeNull();
      for (const unit of lesson.units) await player.send({ t: "room.unplug", uid: `${unit}-1` });
    }, 300_000);
  }
});
