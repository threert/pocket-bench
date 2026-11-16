# Lessons

A lesson is a task card: a small guided build in three to five steps that alternate between the room (plug a
Unit, use a prop) and the coding agent (ask for an app). The sidecar knows the ten lessons, shows which step is
in turn and decides by itself, from the live bench, when a step is done.

| Part | Where |
| --- | --- |
| The engine | `sidecar/src/lessons/`: `index.ts` (state, messages, the once-a-second check), `checks.ts` (the check DSL), `solution.ts`, `types.ts`, `catalog.ts` (the ten, in order), `fonts.ts` (the Chinese face of the kit) |
| A lesson | `kit/lessons/<id>/lesson.ts` (texts, steps, checks), `solution/` (the reference app), `playthrough.ts` (what a player does, for the test) |
| What a project starts from | `kit/templates/blank/`, with `kit/ui/` and `kit/drivers/` copied in; the guide the agent reads is `kit/AGENTS.md` |
| Tests | `sidecar/test/lessons/`: `vendor/bin/bun test sidecar/test/lessons` |

The ten: `hello` 你好，Tab5 · `weather` 桌面气象站 (env3) · `radar` 倒车雷达 (sonic) · `mixer` 调光台 (angle8) · `door`
门禁打卡 (rfid2, relay4) · `lamp` 智能台灯 (dlight, relay4) · `scale` 厨房秤 (scales) · `game` 摇杆小游戏 (joystick2) ·
`thermo` 测温枪 (ncir) · `timer` 番茄钟 (encoder). `hello` and `weather` have solutions; the other eight have
their texts and checks and wait for one.

## What the app sees

Every `state` message carries two more fields:

```
lessons: [{ id, number, title, tagline, units: string[], minutes, level: 1|2|3, done }]        all ten, in order
lesson:  null | { id, number, title, tagline, story, units, minutes, level, done,
                  steps: [{ id, text, hint, prompt, done }], prompts: string[] }                the active one
```

`prompt` of a step is a ready request for the coding agent ("" when the step is something to do in the room);
`prompts` are two or three ideas to go on with. All texts are Simplified Chinese.

| Message to the sidecar | Effect |
| --- | --- |
| `lesson.start {id}` | Opens the newest project whose `.bench.json` names this lesson, or makes one from the blank template (name `<id>`, title the lesson's) and opens it. The lesson becomes active. The reply comes when the first build is done; an unknown id is an `error` reply. |
| `lesson.stop {}` | No lesson is active; the project stays open. Starting the lesson again brings it back. |
| `lesson.solution {}` | Copies the lesson's reference solution over the open project (below); the bench rebuilds. Reply `lesson.solution {id, files}`, or `error` when the lesson has none. |
| `lesson.reset {}` | The steps are undone and checked again from the first. A lesson finished once stays `done` in the list. |
| `lesson.status {}` | For whoever writes a lesson: reply `lesson.status {id, step, checks: string[], texts, running, changed}`, the step in turn with every part of its check and whether it holds now. |

| Message from the sidecar | When |
| --- | --- |
| `lesson.step {id, step, done: true}` | A step completed (the app plays a sound). A new `state` follows. |
| `lesson.done {id}` | The last step completed. |

The active lesson follows the open project: opening a lesson's project restores the lesson with its steps,
opening any other project (or none) clears it.

What is kept:

- `<project>/.bench.json`: `lesson` (the id), `steps` (`{ <step id>: <ISO time it completed> }`), `baseline` (a
  digest of the project's sources when the lesson started; `ui/`, `drivers/`, `.build` and dotfiles are left out).
- `<workspace>/.bench/progress.json`: `{ lessons: { <id>: { done: true, at } } }`.

## How a step completes

Once a second the engine evaluates the check of the **first step that is not done** against the bench. When it
holds, the step is done for good; the next one is looked at a second later. So steps complete in order, and a
later step whose check already holds waits for the ones before it. While a build runs nothing is checked: the
screen still shows the build before.

A check is data:

| Check | Holds when |
| --- | --- |
| `{ plugged: "env3" }` | A Unit of that type is on Port A. |
| `{ running: true }` | The last build has no problem and the app runs without a fault. |
| `{ changed: true }` | The project's sources differ from the baseline: the agent (or the solution) did something. |
| `{ text: "太热了" }` | The regular expression matches one of the texts on the screen, or all of them joined by spaces in reading order. Flags default to `"i"`. A `<Text>` of several pieces ("点了 ", 3, " 次") is one text. |
| `{ shows: "env3.celsius", tolerance: 0.6 }` | A number on the screen is within the tolerance of the live value. `scale` and `offset` convert it first (`"sonic.millimetres", scale: 0.1` for centimetres); `percent` widens the tolerance for large values; `pattern` (a regular expression with one group) says which numbers count. `shows` may be a fixed number: `{ shows: 0, tolerance: 1.5, pattern: "(-?[0-9.]+)\\s*g" }`. |
| `{ input: "env3.celsius", gt: 30 }` | What the sensor is looking at passed a threshold: the user used a prop. Comparisons: `gt gte lt lte between: [a, b] eq ne`. For a card reader: `present: true`, `uid: "04 A3 1B 7C"`. |
| `{ output: "relay4.relays[3]", on: true }` | What the app did to a Unit. `on` for relays; for LEDs `lit: true` (a channel above `min`), `dominant: "r" \| "g" \| "b"` (that channel leads by half again, whatever the brightness), `near: [r, g, b]` with `tolerance`. Without an index a list is taken as a whole: any relay on, any LED lit. |
| `{ all: [...] }`, `{ any: [...] }`, `{ not: check }` | As they read. |
| `{ then: [a, b] }` | `a` held at some moment, and `b` at a later one: "the lamp went on, then off". |
| `{ hold: check, seconds: 3 }` | The check held for that long without a break. |

A source is `<unit type>.<key>` or `<unit type>.<key>[index]` of what the Unit reports to the room: its `sim`
state, the values `bench state` prints and `GET /api/state` has under `sim.units`. `tab5.<key>` is the board
(`accel`, `gyro`, `volts`, `amps`). The keys:

| Unit | Keys |
| --- | --- |
| `env3` | `celsius`, `humidity`, `pascals` |
| `sonic` | `millimetres` |
| `rfid2` | `card` (`null`, or `{ uid: number[], kind, blocks }`), `writes`, `field` |
| `angle8` | `knobs` (8 x 0..1), `switch` (0 or 1), `leds` (9 x [r, g, b], 0..25: the firmware's tenth of the colour written) |
| `joystick2` | `x`, `y` (-1..1), `button` (0 or 1), `led` ([r, g, b]) |
| `encoder` | `steps` (detents, clockwise positive), `button`, `leds` (2 x [r, g, b]) |
| `dlight` | `lux` |
| `ncir` | `objectCelsius`, `ambientCelsius` |
| `scales` | `grams` (the load on the pan, whatever the tare), `button`, `led` ([r, g, b]) |
| `relay4` | `relays` (4 booleans: 0 desk lamp, 1 fan, 2 "ON AIR" sign, 3 amber beacon), `leds`, `sync` |

`input` and `output` read the same state; they differ in what they compare. Both look at the last 1.5 seconds
(`withinSeconds`), so that a press of 200 ms or a flash of an LED is seen by a check that runs once a second.
Give `withinSeconds: 0` where "now" is meant (`on: false`, `lit: false`, a `not`).

A test (`checks.test.ts`) validates every check of every lesson against the Unit models: an unknown key, a
regular expression that does not compile, a `pattern` without a group fail it.

### Writing checks that work

- **A room step** is `plugged`, or an `input` together with what the app must show for it: `all: [{ input:
  "env3.celsius", gt: 28 }, { shows: "env3.celsius", tolerance: 1.5 }]`. The second part is what makes the step
  about the app and not only about the prop.
- **An agent step** is `all: [{ changed: true }, { running: true }, <what the screen must show>]`. `changed`
  alone holds from the first edit on, so later agent steps are told apart by what they add to the screen or
  to a Unit.
- **Screen texts are the agent's words.** The step's `prompt` names the words the check looks for (「太热了」,
  「得分：N」), and the expression allows the near synonyms. A person who asks in their own words may get a
  screen the check does not recognise: that is the price of checks without a model, and why every prompt chip
  is specific.
- **Tolerances** follow the value: 0.6 for a temperature at rest shown with one decimal, 1.5 while it is
  moving (the screen is half a second behind), 2 for a humidity in whole percent.
- **A step must not hold before the player acts.** The playthrough test fails a lesson whose step completes
  before its actions.

## A lesson's files

`kit/lessons/<id>/lesson.ts` exports the lesson as its default (`satisfies LessonDef`, `types.ts`): `id`,
`number`, `title`, `tagline`, `story` (one or two sentences), `units`, `minutes`, `level`, `steps` (`id`, `text`
what to do, `hint` how, `prompt?`, `check`), `prompts`. A new lesson is added to `catalog.ts`.

The voice: a patient friend at the workbench, a little playful. Short sentences. `text` says what to do in the
room or what to ask for; `hint` says how ("点一下盒子里的『温湿度气压』模块，它会自己飞到绿色底座上并接好线").
Names like Tab5, I2C, Port A, ENV III stay as they are. A prompt is what a person would say to the agent,
complete enough to be done in one turn, and it quotes the words the screen must show.

## How to write a lesson's solution and its playthrough test

`hello` and `weather` are the models: read `kit/lessons/weather/solution/` first.

### 1. The solution folder

`kit/lessons/<id>/solution/` is shaped like a project. `lesson.solution` copies it over the open project:

| File | What happens |
| --- | --- |
| `main.tsx` | Required. Copied. |
| `worker.ts`, `protocol.ts`, any other file or folder | Copied as they are, to the same relative path. |
| `pocket.app.json` | **Not copied.** Only `domains.worker.entry`, `.nodes`, `.channels` and `engine.capabilities.requires` (added to the project's) are taken from it, so the project keeps its id, title and output name. Write it only when the solution needs other channels or nodes than the blank template's (`state` snapshot of 256 bytes worker to UI, `commands` ring of 64 bytes x 8 UI to worker; nodes `porta` and `sys`), and then with nothing but those fields. |
| `fonts.json` | Only when the app shows characters at run time that no literal has: `{ "fallback": ["../.bench/fonts/cjk.otf"], "characters": "..." }`. |

Nothing is deleted from the project. Do not put copies of `ui/` or `drivers/` in a solution: it uses the
project's. When a part of `kit/ui` or a driver falls short, improve it in the kit.

### 2. What the app must be

- **The finished lesson**, every step's request included: a solution applied at step 2 lets the later "ask the
  agent" steps complete as soon as the room is in the state they ask for. It has to satisfy every check of
  `lesson.ts`: read them, and note the exact words (`text`) and numbers (`shows`) they look for.
- **Built on `./ui` and `./drivers`**, in the shape of `kit/AGENTS.md`: `protocol.ts` with a `record()` both
  realms import; a worker whose sensor loop opens the driver, reads until it fails, publishes the state, closes
  and tries again; a UI that draws `useChannel("state", State)`.
- **Every state designed**: live; no Unit (a `Notice` that names the Unit and Port A); the Unit pulled while
  running (back to the Notice, and live again when it returns, without a restart); values at their extremes
  (three digits, a negative number, the alert state).
- **Chinese on the screen**, the lesson's own words. Latin for units and part names (°C, hPa, ENV III).
- **Worth looking at on a 5-inch screen**: one subject a screen, the main number at 54 px, 44 px controls, no
  text under 12 px, nothing clipped at 640 x 360. Look at a screenshot of every state at twice the size before
  calling it done.
- **Commented for a reader**: the next person to open `worker.ts` is a learner, or an agent asked to change it.

### 3. Working on it

```
POCKET_BENCH_HOME=/tmp/pb-<you> vendor/bin/bun sidecar/src/main.ts --port 87xx      # a sidecar and workspace of your own
curl -s -X POST localhost:87xx/api/send -d '{"t":"lesson.start","id":"radar"}'       # the project /tmp/pb-<you>/radar
curl -s -X POST localhost:87xx/api/send -d '{"t":"room.plug","uid":"sonic-1","type":"sonic"}'
curl -s -X POST localhost:87xx/api/send -d '{"t":"lesson.solution"}'                 # after each change in kit/lessons/radar/solution
curl -s -X POST localhost:87xx/api/send -d '{"t":"room.set","uid":"sonic-1","key":"millimetres","value":80}'
curl -s -X POST localhost:87xx/api/send -d '{"t":"lesson.status"}'                   # which part of the step's check does not hold
curl -s 'localhost:87xx/api/shot.png?scale=2' -o /tmp/shot.png                       # and look at it
curl -s -X POST localhost:87xx/api/send -d '{"t":"lesson.reset"}'                    # run the steps again
```

Edit in `kit/lessons/<id>/solution/` and apply with `lesson.solution`; or edit in the scratch project (the
bench rebuilds on every save) and copy the files back when they are right. `GET /api/texts`, `/api/logs`,
`/api/state` and `POST /api/tap {x, y}` are the rest of the tools (`kit/docs/bench-cli.md` has the same as the
`bench` command, from inside the project).

What the room's props set, for `room.set` and the playthrough (`uid` is `<type>-1`):

| Prop | Sets |
| --- | --- |
| Heat gun, mist sprayer | `env3` `celsius` (air at 24.6 without it), `humidity` (48 without it) |
| Yellow target block | `sonic` `millimetres` (20..4500, 600 at first) |
| Cards | `rfid2` `card`: `{ "uid": [4, 163, 27, 124], "kind": "classic1k" }` (员工卡 04 A3 1B 7C), `{ "uid": [158, 18, 85, 13], "kind": "classic1k" }` (访客卡 9E 12 55 0D), a 7-byte `"ultralight"` (the key fob), `null` (no card) |
| Knobs, switch | `angle8` `knobs` (eight numbers 0..1), `switch` (0 or 1) |
| Stick | `joystick2` `x`, `y` (-1..1), `button` (0 or 1) |
| Knob | `encoder` `steps` (the absolute count of detents), `button` |
| Room light, desk lamp | `dlight` `lux` (320 with the room light on) |
| Mug (62 °C) | `ncir` `objectCelsius` (24 without it) |
| Weights 50, 100, 200 g, mug 310 g | `scales` `grams`, `button` |

A sensor follows a new value as the part does (the SHT30 of ENV III passes 30 °C a couple of seconds after
the air went to 45 °C, and needs half a minute to arrive): a step that waits for a threshold takes that long.

### 4. The playthrough

`kit/lessons/<id>/playthrough.ts` says what a player does for each step, in the lesson's order
(`satisfies Playthrough`):

```ts
export default [
  { step: "plug", do: [{ plug: "env3" }] },
  { step: "app", do: [{ solution: true }] },                      // the "ask the agent" step: the solution stands in for the agent
  { step: "heat", do: [{ set: ["env3", "celsius", 45] }] },       // the heat gun
  { step: "alert", do: [] },                                      // nothing more to do: it completes when the reading passes 30
  { step: "mist", do: [{ set: ["env3", "celsius", 24.6] }, { set: ["env3", "humidity", 88] }] },
] satisfies Playthrough;
```

| Action | Does |
| --- | --- |
| `{ plug: "env3" }`, `{ unplug: "env3" }` | `room.plug` / `room.unplug` of `<type>-1` |
| `{ set: [unit, key, value] }` | `room.set` on `<unit>-1` |
| `{ tap: [x, y] }` | A touch at a point of the 640 x 360 screen |
| `{ tapText: "^点我$" }` | A touch in the middle of the first text the expression matches (it waits up to 15 s for it): use this for buttons, it survives a change of layout |
| `{ solution: true }` | `lesson.solution`, then waits for the build |
| `{ wait: seconds }` | Lets the bench run: between a press and a release, or to hold something |

`sidecar/test/lessons/playthrough.test.ts` plays every lesson that has `solution/main.tsx`, on a real bench in
the test's process: a new project from the blank template, the PocketJS compiler, the simulated Tab5, the Unit
models. For each step it checks that the step is **not** done before its actions (when it has any), performs
them, and waits up to 60 s for the step to complete; then that exactly the steps so far are done. At the end
the lesson is `done` in the state, in `.bench.json` and in `progress.json`, and the app has no build problem
and no fault. A failure prints the step's check part by part and the texts on the screen.

```
vendor/bin/bun test sidecar/test/lessons                                   # everything (about 30 s for two lessons)
PLAY_LOG=1 vendor/bin/bun test sidecar/test/lessons/playthrough.test.ts     # with every action and how long each step took
PLAY_STEP_SECONDS=8 vendor/bin/bun test sidecar/test/lessons/playthrough.test.ts   # give up on a step sooner while working on it
vendor/pocket-m5/third_party/pocketjs/node_modules/.bin/tsc --noEmit -p sidecar/test/lessons/tsconfig.json
```

A lesson with a solution and no `playthrough.ts`, or one whose steps differ from the lesson's, fails
`checks.test.ts`.

### 5. Before it is done

1. `bun test sidecar/test/lessons` passes, twice in a row.
2. You looked at screenshots: no Unit, live, every alert or game state, a Unit pulled and put back.
3. Unplug the Unit while the app runs, plug it again: the app recovers, `bench logs` has no fault.
4. A fresh project with only the solution's files builds without a warning in `GET /api/build-output`.
5. The steps' prompts, given to the real agent one after the other on a blank project, lead to an app that
   completes the lesson. When they do not, fix the prompt (name the words the check needs) or loosen the check.

## The kit's Chinese font

PocketJS bakes each character from the first face that has it: Inter, then the fallback faces of the app's
`fonts.json`. The blank template names `../.bench/fonts/cjk.otf`, which `ensureWorkspace()` makes once
(`lessons/fonts.ts`): the W6 face of `/System/Library/Fonts/Hiragino Sans GB.ttc` written out as a font of its
own (the framework's font reader takes one-face files, not collections), or a link to Arial Unicode when that
collection is missing, or the framework's Noto Sans CJK demo subset so that a build still succeeds.

- One weight for regular and bold: a fallback face is not chosen by weight.
- About 10 KiB of the app for each distinct character (all nine sizes of `kit/ui`): the blank template's pak is
  1.1 MiB, the hello solution's 1.5 MiB, the weather solution's 1.9 MiB.
- The glyphs are a system font's. On this Mac that is what any app does; a package that is given to others
  should name a font it may carry (Noto Sans SC) in its `fonts.json`.

## Limits

- Checks read the screen as text and numbers. They do not see colour, position or motion: "the number turns
  red" is checked through the word beside it.
- The 1.5 s window makes `input` and `output` forgiving; a `hold` on them is shorter in truth by up to that much.
- `changed` compares with the project's first state, not with the step before.
- The engine does not act in the room: it never plugs a Unit or moves a prop. The room does, and tells the
  sidecar with `room.plug` and `room.set`.
- `lesson.start` answers after the project's first build (3 to 13 s); the `state` with the lesson arrives at
  once.
