# Pocket Bench: how it is put together

Pocket Bench is a macOS app: a path-traced hardware studio with an M5Stack Tab5 on the bench. The user plugs Units
into the Tab5, a local coding agent writes a PocketJS app in TypeScript, and the app runs on a simulated Tab5 whose
screen is in the room.

## Three parts

| Part | Where | What it owns |
| --- | --- | --- |
| The app | `app/` (SwiftUI) + `core/` (Rust static library on the ThreeRT engine, `engine/`) | The window, the panels, the room's renderer. It starts the sidecar and carries messages between the room's script and the sidecar. |
| The room | `room/bench.game.ts` (a ThreeRT game, bundled to `.build/room.js` by `tools/room.ts`) | The 3D scene and what the user does in it: picking Units up, plugging them in, the props that act on sensors. |
| The sidecar | `sidecar/` (TypeScript on Bun 1.4.2, `vendor/bin/bun`) | The simulated Tab5, the project's builds, the Units' models, the lessons, the coding agent. |

## The simulated Tab5 (`sidecar/src/sim`)

- An app is built by the PocketJS compiler of the pinned `vendor/pocket-m5` for the board's host contract
  (`tab5-home`): the same command that builds for the board (`sidecar/src/build.ts`). The simulator runs the JS
  bundles the compiler writes before bytecode (`<out>.js`, `<out>.pak`, `<out>.worker.js`).
- The UI realm runs on PocketJS's wasm core (`bootBundle` of `programs/sim/sim.ts`): 640x360 RGBA, 30 Hz, touch.
- The worker realm (`worker-realm.ts`) is a `node:vm` context that sees only `__pocketWorker`, driven turn by turn in
  virtual microseconds, as the firmware drives it. Its `i2c` nodes (`sys`, `porta`) are virtual buses (`i2c.ts`).
- A Unit (`sidecar/src/units/*.ts`, `UnitType`) owns chips modelled at the transaction level (`sidecar/src/chips`),
  takes what the room does to it (`set(key, value)`) and reports what it does to the room (`state()`).
- One simulated board is one thread (`sim/thread.ts`); `bench.ts` supervises it, rebuilds on file changes and keeps
  the plugged Units across boots.

## Messages

JSON objects with a string `t`. The app holds one WebSocket to the sidecar (`ws://127.0.0.1:<port>/app`); the Tab5's
frames arrive on it as binary messages ("PBF1" header, then RGBA). The same handlers answer `POST /api/send`.

| From → to | Messages |
| --- | --- |
| room → sidecar (through the app) | `room.plug {uid,type}`, `room.unplug {uid}`, `room.set {uid,key,value}`, `screen.touch {x,y}` / `{up:true}` |
| panels → sidecar | `project.new/open/build/close`, `agent.*`, `lesson.*` |
| sidecar → app | `state` (the whole bench, on every change), `catalog`, `logs`, `sim` (Units' and board's state, 10 Hz), `agent.*`, `lesson.*` |
| sidecar → room (through the app) | `state`, `sim`, `catalog`, `room.refused`, `room.do`, `lesson` |

`GET /api/state | shot.png | texts | tree | logs | settled | catalog` and `POST /api/tap | send | app` are for the
agent's command line and for tests (`sidecar/src/server.ts`).

## Running it in development

```
vendor/bin/bun tools/app.ts            # room bundle, Rust core, Xcode project, app
tools/dev.sh                           # run the app with POCKET_BENCH_HOME=/tmp/pb-home; prints the sidecar's port
tools/bench shot /tmp/x.png            # the window as a PNG (the room traced offscreen if the display sleeps)
tools/bench screen /tmp/s.png          # the Tab5's screen
POCKET_BENCH_HOME=/tmp/x vendor/bin/bun sidecar/src/main.ts --port 8731    # the sidecar alone
```
