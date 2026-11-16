// The check DSL against a fake bench, and the ten lessons as data.
//   vendor/bin/bun test sidecar/test/lessons
import "./env.ts";
import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { LESSONS } from "../../src/lessons/catalog.ts";
import { describe as say, evaluate, explain, numbersOn, parseSource, validate, type Memory } from "../../src/lessons/checks.ts";
import type { BenchView, Check, Playthrough } from "../../src/lessons/types.ts";
import { UNITS } from "../../src/units/index.ts";

const KIT = join(import.meta.dir, "../../../kit");

/** A bench with an ENV III, a 4-Relay and an 8Angle on it, the app showing a weather screen. */
function bench(over: Partial<BenchView> = {}): BenchView {
  return {
    at: 100_000, running: true, changed: true,
    units: [
      { uid: "env3-1", type: "env3", inputs: { celsius: 45, humidity: 48, pascals: 101_180 } },
      { uid: "relay4-1", type: "relay4", inputs: {} },
      { uid: "angle8-1", type: "angle8", inputs: { knobs: [0.9, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5], switch: 0 } },
      { uid: "rfid2-1", type: "rfid2", inputs: { card: null } },
    ],
    sim: {
      "env3-1": { celsius: 24.63, humidity: 48.2, pascals: 101_180 },
      "relay4-1": { relays: [false, false, false, true], leds: [false, false, false, true], sync: true },
      "angle8-1": { knobs: [0.9, 0.1, 0.1, 0.5, 0.5, 0.5, 0.5, 0.5], switch: 0, leds: [[25, 2, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]] },
      "rfid2-1": { card: { uid: [0x04, 0xa3, 0x1b, 0x7c], kind: "classic1k", blocks: {} }, writes: 0, field: true },
      tab5: { volts: 7.9 },
    },
    recent: [],
    texts: ["桌面气象站", "24.6", "°C", "48", "%", "1011.8", "hPa", "点了 3 次"],
    ...over,
  };
}
const holds = (check: Check, view = bench(), memory?: Memory) => evaluate(check, view, memory);

describe("leaf checks", () => {
  test("plugged, running, changed", () => {
    expect(holds({ plugged: "env3" })).toBe(true);
    expect(holds({ plugged: "sonic" })).toBe(false);
    expect(holds({ running: true })).toBe(true);
    expect(holds({ running: true }, bench({ running: false }))).toBe(false);
    expect(holds({ changed: true }, bench({ changed: false }))).toBe(false);
  });

  test("text matches one text or all of them joined, case-insensitively", () => {
    expect(holds({ text: "气象站" })).toBe(true);
    expect(holds({ text: "^48$" })).toBe(true);
    expect(holds({ text: "HPA" })).toBe(true);
    expect(holds({ text: "HPA", flags: "" })).toBe(false);
    expect(holds({ text: "24\\.6 °C" })).toBe(true);      // two texts, joined by a space
    expect(holds({ text: "太热了" })).toBe(false);
  });

  test("shows compares a number on the screen with the live value", () => {
    expect(holds({ shows: "env3.celsius", tolerance: 0.6 })).toBe(true);
    expect(holds({ shows: "env3.celsius", tolerance: 0.6 }, bench({ texts: ["23.9"] }))).toBe(false);
    expect(holds({ shows: "env3.pascals", scale: 0.01, tolerance: 2 })).toBe(true);
    expect(holds({ shows: "env3.pascals", scale: 0.001, tolerance: 0.2 })).toBe(false);
    expect(holds({ shows: "env3.celsius", scale: 1.8, offset: 32, tolerance: 0.5 }, bench({ texts: ["76.3 °F"] }))).toBe(true);
    expect(holds({ shows: "env3.pascals", tolerance: 1, percent: 1 }, bench({ texts: ["101900 Pa"] }))).toBe(true);
    expect(holds({ shows: "sonic.millimetres", tolerance: 1000 })).toBe(false);   // the Unit is not plugged
    expect(holds({ shows: 3, tolerance: 0 })).toBe(true);                          // a fixed number: "点了 3 次"
    expect(holds({ shows: 0, tolerance: 1.5, pattern: "(-?[0-9.]+)\\s*g" }, bench({ texts: ["-0.4 g", "250"] }))).toBe(true);
    expect(holds({ shows: 0, tolerance: 1.5, pattern: "(-?[0-9.]+)\\s*g" }, bench({ texts: ["310.2 g", "0"] }))).toBe(false);
  });

  test("numbersOn reads signed decimals and a typographic minus", () => {
    expect(numbersOn(["-3.5 °C", "−2", "0x26", "v1.2.3"])).toEqual([-3.5, -2, 0, 26, 1.2, 3]);
    expect(numbersOn(["得分：12", "生命 3"], "得分[^0-9]*([0-9]+)")).toEqual([12, 12]);
  });

  test("input compares what a sensor is looking at", () => {
    expect(holds({ input: "env3.celsius", gt: 30 })).toBe(false);          // the sensor is still at 24.6, whatever the room set
    expect(holds({ input: "env3.celsius", between: [24, 25] })).toBe(true);
    expect(holds({ input: "angle8.knobs[0]", gt: 0.8 })).toBe(true);
    expect(holds({ input: "angle8.knobs[1]", gt: 0.8 })).toBe(false);
    expect(holds({ input: "angle8.switch", eq: 0 })).toBe(true);
    expect(holds({ input: "angle8.switch" })).toBe(false);                // nothing to compare with: the value itself
    expect(holds({ input: "rfid2.card", present: true })).toBe(true);
    expect(holds({ input: "rfid2.card", uid: "04 a3 1b 7c" })).toBe(true);
    expect(holds({ input: "rfid2.card", uid: "9E 12 55 0D" })).toBe(false);
    const empty = bench(); empty.sim["rfid2-1"] = { card: null };
    expect(holds({ input: "rfid2.card", present: false }, empty)).toBe(true);
    expect(holds({ input: "rfid2.card", uid: "04 A3 1B 7C" }, empty)).toBe(false);
    expect(holds({ input: "tab5.volts", gt: 7 })).toBe(true);
  });

  test("an input is seen for a moment after it passed", () => {
    const view = bench({ recent: [{ at: 99_200, sim: { "env3-1": { celsius: 31 } } }, { at: 97_000, sim: { "env3-1": { celsius: 40 } } }] });
    expect(holds({ input: "env3.celsius", gt: 30 }, view)).toBe(true);                       // 0.8 s ago
    expect(holds({ input: "env3.celsius", gt: 35 }, view)).toBe(false);                      // 3 s ago: outside the 1.5 s
    expect(holds({ input: "env3.celsius", gt: 35, withinSeconds: 5 }, view)).toBe(true);
    expect(holds({ input: "env3.celsius", gt: 30, withinSeconds: 0 }, view)).toBe(false);    // now only
  });

  test("output reads relays and LEDs", () => {
    expect(holds({ output: "relay4.relays[3]", on: true })).toBe(true);
    expect(holds({ output: "relay4.relays[0]", on: true })).toBe(false);
    expect(holds({ output: "relay4.relays[0]", on: false })).toBe(true);
    expect(holds({ output: "relay4.relays", on: true })).toBe(true);      // any of the four
    expect(holds({ output: "relay4.relays", on: false })).toBe(false);    // none of the four
    expect(holds({ output: "angle8.leds", lit: true })).toBe(true);
    expect(holds({ output: "angle8.leds[1]", lit: true })).toBe(false);
    expect(holds({ output: "angle8.leds", lit: true, min: 30 })).toBe(false);
    expect(holds({ output: "angle8.leds", dominant: "r" })).toBe(true);
    expect(holds({ output: "angle8.leds", dominant: "g" })).toBe(false);
    expect(holds({ output: "angle8.leds[0]", near: [25, 0, 0], tolerance: 5 })).toBe(true);
    expect(holds({ output: "angle8.leds[0]", near: [0, 0, 25], tolerance: 5 })).toBe(false);
    expect(holds({ output: "sonic.led", lit: false })).toBe(false);       // no such Unit: nothing holds
  });
});

describe("combinations", () => {
  test("all, any, not", () => {
    expect(holds({ all: [{ plugged: "env3" }, { running: true }] })).toBe(true);
    expect(holds({ all: [{ plugged: "env3" }, { plugged: "sonic" }] })).toBe(false);
    expect(holds({ any: [{ plugged: "sonic" }, { plugged: "env3" }] })).toBe(true);
    expect(holds({ any: [{ plugged: "sonic" }, { text: "太热了" }] })).toBe(false);
    expect(holds({ not: { text: "太热了" } })).toBe(true);
  });

  test("then wants its parts one after the other, each at a later moment", () => {
    const check: Check = { then: [{ output: "relay4.relays[0]", on: true, withinSeconds: 0 }, { output: "relay4.relays[0]", on: false, withinSeconds: 0 }] };
    const memory: Memory = new Map();
    const relay = (on: boolean, at: number) => { const view = bench({ at }); view.sim["relay4-1"] = { relays: [on, false, false, false] }; return view; };
    expect(evaluate(check, relay(false, 1000), memory)).toBe(false);   // off before it was ever on does not count
    expect(evaluate(check, relay(true, 2000), memory)).toBe(false);    // the first part
    expect(evaluate(check, relay(true, 3000), memory)).toBe(false);
    expect(evaluate(check, relay(false, 4000), memory)).toBe(true);    // the second, later
    expect(evaluate(check, relay(true, 5000), memory)).toBe(true);     // and it stays done
    // Two parts that hold at the same moment still take two evaluations.
    const both: Check = { then: [{ plugged: "env3" }, { running: true }] }, fresh: Memory = new Map();
    expect(evaluate(both, bench(), fresh)).toBe(false);
    expect(evaluate(both, bench(), fresh)).toBe(true);
  });

  test("hold wants its check true without a break", () => {
    const check: Check = { hold: { input: "env3.celsius", gt: 30, withinSeconds: 0 }, seconds: 2 };
    const memory: Memory = new Map();
    const at = (celsius: number, time: number) => { const view = bench({ at: time }); view.sim["env3-1"] = { celsius }; return view; };
    expect(evaluate(check, at(31, 0), memory)).toBe(false);
    expect(evaluate(check, at(31, 1000), memory)).toBe(false);
    expect(evaluate(check, at(29, 1500), memory)).toBe(false);   // the break
    expect(evaluate(check, at(31, 2000), memory)).toBe(false);
    expect(evaluate(check, at(31, 3900), memory)).toBe(false);
    expect(evaluate(check, at(31, 4000), memory)).toBe(true);
  });

  test("a then inside an all keeps counting while its neighbours fail", () => {
    const check: Check = { all: [{ text: "太热了" }, { then: [{ plugged: "env3" }, { running: true }] }] };
    const memory: Memory = new Map();
    expect(evaluate(check, bench(), memory)).toBe(false);
    expect(evaluate(check, bench(), memory)).toBe(false);
    expect(evaluate(check, bench({ texts: ["太热了"] }), memory)).toBe(true);
  });

  test("explain lists every part with its state and leaves the memory alone", () => {
    const check: Check = { all: [{ plugged: "env3" }, { then: [{ plugged: "env3" }, { text: "太热了" }] }] };
    const memory: Memory = new Map();
    const lines = explain(check, bench(), memory);
    expect(lines.map(line => `${line.depth} ${line.ok} ${line.says}`)).toEqual([
      "0 false all of these", "1 true env3 is plugged in", "1 false these, one after the other", "2 true env3 is plugged in", "2 false the screen says /太热了/",
    ]);
    expect(memory.size).toBe(0);
    expect(say({ input: "env3.celsius", gt: 30 })).toBe("env3.celsius > 30");
    expect(say({ output: "relay4.relays[3]", on: true })).toBe("relay4.relays[3] is on");
  });
});

describe("checks as data", () => {
  test("a source is <unit>.<key> with an optional index", () => {
    expect(parseSource("relay4.relays[3]")).toEqual({ unit: "relay4", key: "relays", index: 3 });
    expect(parseSource("env3.celsius")).toEqual({ unit: "env3", key: "celsius", index: undefined });
    expect(() => parseSource("celsius")).toThrow();
  });

  test("validate names what is wrong", () => {
    const keys = { env3: ["celsius"], relay4: ["relays"] };
    expect(validate({ all: [{ plugged: "env3" }, { input: "env3.celsius", gt: 1 }] }, keys)).toEqual([]);
    expect(validate({ input: "env3.kelvin" as never, gt: 1 }, keys)[0]).toContain("env3 reports celsius");
    expect(validate({ plugged: "toaster" as never }, keys)[0]).toContain("no Unit");
    expect(validate({ text: "(" }, keys)[0]).toContain("/(/");
    expect(validate({ shows: "env3.celsius", tolerance: 1, pattern: "[0-9]+" }, keys)[0]).toContain("group");
    expect(validate({ plugged: "env3", running: true } as never, keys)[0]).toContain("exactly one");
    expect(validate({ all: [] }, keys)[0]).toContain("list");
  });
});

describe("the ten lessons", () => {
  /** What each Unit reports to the room, read from the models themselves. */
  const keys: Record<string, string[]> = Object.fromEntries(UNITS.map(unit => [unit.id, [...new Set([...Object.keys(unit.create().state(0)), ...unit.inputs.map(input => input.key)])]]));
  const chinese = /[一-鿿]/;

  test("are the ten the room and the app know, in order", () => {
    expect(LESSONS.map(lesson => lesson.id)).toEqual(["hello", "weather", "radar", "mixer", "door", "lamp", "scale", "game", "thermo", "timer"]);
    expect(LESSONS.map(lesson => lesson.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(LESSONS.map(lesson => lesson.title)).toEqual(["你好，Tab5", "桌面气象站", "倒车雷达", "调光台", "门禁打卡", "智能台灯", "厨房秤", "摇杆小游戏", "测温枪", "番茄钟"]);
    expect(LESSONS.map(lesson => lesson.units)).toEqual([[], ["env3"], ["sonic"], ["angle8"], ["rfid2", "relay4"], ["dlight", "relay4"], ["scales"], ["joystick2"], ["ncir"], ["encoder"]]);
  });

  for (const lesson of LESSONS) {
    test(`${lesson.id}: texts, steps and checks are well formed`, () => {
      expect(lesson.steps.length).toBeGreaterThanOrEqual(3);
      expect(lesson.steps.length).toBeLessThanOrEqual(5);
      expect(new Set(lesson.steps.map(step => step.id)).size).toBe(lesson.steps.length);
      expect(lesson.prompts.length).toBeGreaterThanOrEqual(2);
      expect(lesson.prompts.length).toBeLessThanOrEqual(3);
      expect([1, 2, 3]).toContain(lesson.level);
      for (const text of [lesson.title, lesson.tagline, lesson.story, ...lesson.prompts]) expect(text).toMatch(chinese);
      for (const unit of lesson.units) expect(Object.keys(keys)).toContain(unit);
      for (const step of lesson.steps) {
        expect(step.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(step.text).toMatch(chinese);
        expect(step.hint).toMatch(chinese);
        if (step.prompt !== undefined) expect(step.prompt).toMatch(chinese);
        expect(validate(step.check, keys)).toEqual([]);
      }
      // A lesson is some asking and some doing: at least one step offers a ready request, at least one does not.
      expect(lesson.steps.some(step => step.prompt)).toBe(true);
      expect(lesson.steps.some(step => !step.prompt)).toBe(true);
      // Every Unit of the lesson is asked for by a step, and no other Unit is.
      const plugged = new Set<string>();
      const walk = (check: Check) => {
        if ("plugged" in check) plugged.add(check.plugged);
        for (const part of "all" in check ? check.all : "any" in check ? check.any : "then" in check ? check.then : "hold" in check ? [check.hold] : "not" in check ? [check.not] : []) walk(part);
      };
      lesson.steps.forEach(step => walk(step.check));
      expect([...plugged].sort()).toEqual([...lesson.units].sort());
    });
  }

  test("a solution comes with a playthrough that names the lesson's steps", async () => {
    const solved = LESSONS.filter(lesson => existsSync(join(KIT, "lessons", lesson.id, "solution", "main.tsx")));
    expect(solved.map(lesson => lesson.id)).toEqual(expect.arrayContaining(["hello", "weather"]));
    for (const lesson of solved) {
      const script = (await import(join(KIT, "lessons", lesson.id, "playthrough.ts"))).default as Playthrough;
      expect(script.map(entry => entry.step)).toEqual(lesson.steps.map(step => step.id));
    }
  });
});
