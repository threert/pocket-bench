// What a lesson is made of (docs/LESSONS.md). A lesson is data: its texts
// are what the app shows, its checks are what the sidecar tests against the
// live bench about once a second.

/** The catalogue ids of the Units (sidecar/src/units), and the board itself. */
export type UnitId = "env3" | "sonic" | "rfid2" | "angle8" | "joystick2" | "encoder" | "dlight" | "ncir" | "scales" | "relay4";

/** A value of a Unit on the bench: `<unit type>.<key>` of what the Unit
 *  reports to the room (its `sim` state: `bench state` prints it), with an
 *  index into a list when the key holds one: "env3.celsius",
 *  "relay4.relays[3]", "angle8.knobs[0]", "rfid2.card". `tab5.<key>` is the
 *  board. A key the Unit does not report is looked up in what the room last
 *  set on it. */
export type Source = `${UnitId | "tab5"}.${string}`;

export interface Compare {
  gt?: number; gte?: number; lt?: number; lte?: number;
  /** Both ends included. */
  between?: [number, number];
  eq?: number | boolean | string;
  ne?: number | boolean | string;
}

export type Check =
  /** A Unit of this type is on Port A. */
  | { plugged: UnitId }
  /** The last build has no problem and the app runs without a fault. */
  | { running: true }
  /** A source file of the project differs from what the lesson started with. */
  | { changed: true }
  /** A regular expression matches one of the texts on the screen, or all of
   *  them joined by spaces, top to bottom. `flags` default to "i". */
  | { text: string; flags?: string }
  /** A number on the screen is within `tolerance` of the live value times
   *  `scale` plus `offset` (grams shown as kilograms: scale 0.001).
   *  `pattern` narrows where the number is read: a regular expression whose
   *  first group is the number, tried on each text and on all joined. */
  | { shows: Source; tolerance: number; scale?: number; offset?: number; pattern?: string }
  /** What the user did to a sensor with a prop, compared with a number
   *  (`gt`, `lt`, ...), or for a card reader `present` and `uid`
   *  ("04 A3 1B 7C"). True when it held at any moment of the last
   *  `withinSeconds` (1.5), so a short press is not missed. */
  | ({ input: Source; present?: boolean; uid?: string; withinSeconds?: number } & Compare)
  /** What the app did to a Unit: a relay (`on`), an LED (`lit`: any channel
   *  above `min`, default 0; `near`: an [r, g, b] it must be within
   *  `tolerance` of, default 60 a channel). A list without an index is
   *  tested as a whole: `on` and `lit` hold when any entry does. */
  | ({ output: Source; on?: boolean; lit?: boolean; min?: number; near?: [number, number, number]; tolerance?: number; withinSeconds?: number } & Compare)
  | { all: Check[] }
  | { any: Check[] }
  /** Each check must become true after the one before it did: "the lamp went on, then off". */
  | { then: Check[] }
  /** The check stays true for this long without a break. */
  | { hold: Check; seconds: number }
  | { not: Check };

export interface StepDef {
  /** Unique in the lesson; kept in the project's .bench.json. */
  id: string;
  /** What to do in the room, or what to ask for. */
  text: string;
  /** How to do it. */
  hint: string;
  /** A ready request for the coding agent, offered as a one-click chip. */
  prompt?: string;
  check: Check;
}

export interface LessonDef {
  /** The lesson's folder in kit/lessons and its project's name. */
  id: string;
  number: number;
  title: string;
  tagline: string;
  story: string;
  units: UnitId[];
  minutes: number;
  level: 1 | 2 | 3;
  steps: StepDef[];
  /** Two or three ideas to go on with. */
  prompts: string[];
}

/** One scripted action of a playthrough (kit/lessons/<id>/playthrough.ts). */
export type Action =
  /** Plugs a Unit of this type (uid `<type>-1`). */
  | { plug: UnitId }
  | { unplug: UnitId }
  /** Sets an input of a plugged Unit, as a prop in the room does. */
  | { set: [unit: UnitId, key: string, value: unknown] }
  /** Touches the screen at a point (640 x 360). */
  | { tap: [x: number, y: number] }
  /** Touches the middle of the first text on the screen the regular expression matches. */
  | { tapText: string }
  /** Applies the lesson's reference solution (`lesson.solution`). */
  | { solution: true }
  /** Lets the bench run. */
  | { wait: number };

/** What a player does to complete each step, in the lesson's order. A step
 *  with no entry must complete by itself. */
export type Playthrough = { step: string; do: Action[] }[];

/** What the checks see of the bench at one moment. */
export interface BenchView {
  /** Milliseconds, for `hold` and the window of `input` and `output`. */
  at: number;
  running: boolean;
  changed: boolean;
  units: { uid: string; type: string; inputs: Record<string, unknown> }[];
  /** The Units' live state by uid, and `tab5`. */
  sim: Record<string, Record<string, unknown>>;
  /** Earlier states of the last seconds, oldest first (the latest is `sim`). */
  recent: { at: number; sim: Record<string, Record<string, unknown>> }[];
  /** The texts on the screen, top to bottom. */
  texts: string[];
}

/** The lesson parts of the `state` message. */
export interface LessonSummary { id: string; number: number; title: string; tagline: string; units: string[]; minutes: number; level: 1 | 2 | 3; done: boolean }
export interface LessonState extends LessonSummary {
  story: string;
  steps: { id: string; text: string; hint: string; prompt: string; done: boolean }[];
  prompts: string[];
}
