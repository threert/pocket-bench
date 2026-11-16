# Pocket Bench

A hardware studio you can play in. An M5Stack Tab5 stands on the bench of a path-traced workshop; you plug Units
into it by hand, a local coding agent writes the app in TypeScript, and the app runs on the Tab5 in the room.

像摆乐高一样搭硬件：在光追的工作室里把模块接到 Tab5 上，说出想法，本地 Agent 用 TypeScript 写出带界面的
PocketJS 应用，马上在房间里的那台 Tab5 上跑起来。

- **The room** is rendered live by [ThreeRT](https://github.com/meshy-dev/ThreeRT) (hardware ray tracing on Apple
  silicon). The Tab5's shell is M5Stack's open-hardware enclosure; its screen is the simulator's framebuffer, as light.
- **The Tab5** is simulated at the level of its buses. The app is built by the PocketJS compiler for the board's
  host contract (`tab5-home`), the same command that builds for the device; its worker talks I2C to register-level
  models of the chips in ten Units (ENV III, Ultrasonic, RFID 2, 8Angle, Joystick 2, DLight, 4-Relay, Mini Scales,
  NCIR, Encoder) and of the board's own motion sensor, clock and power monitor. The drivers are the ones that run
  on the real parts.
- **The props** act on the sensors: a heat gun and a mist sprayer for the ENV Unit, a block to slide in front of the
  ultrasonic one, cards for the reader, weights for the scale, a hot mug for the thermometer, the room's light
  switch for the light sensor. The relays switch a desk lamp, a fan, a sign and a beacon that light the room.
  Dragging the Tab5 leans it, and its motion sensor feels it.
- **The agent** is Claude Code or Codex, driven over the Agent Client Protocol from the app's side panel. It edits
  the project's files; the bench rebuilds on every change; the agent checks its own work with the `bench` command
  (`bench check`, `bench shot`, `bench set env3-1 celsius 35`).
- **Task cards** walk through ten small builds, from "Hello, Tab5" to an access-control door, checking each step
  against the live bench.

## Run it

Requirements: an Apple-silicon Mac (M3 or later for hardware ray tracing) with macOS 14+, Xcode, Rust, `xcodegen`,
and Claude Code and/or Codex installed and signed in for the agent.

```sh
# once: the engine checkout (engine/ is a link to a ThreeRT checkout with the stream-texture change), then
vendor/bin/bun tools/art.ts            # printed surfaces (labels, panels, cards): SVG -> PNG
vendor/bin/bun tools/app.ts --run      # room bundle, Rust core, Xcode project, app; opens it
```

Projects live in `~/PocketBench` (`POCKET_BENCH_HOME` to put them elsewhere). `tools/dev.sh` runs the app against a
scratch home and `tools/bench` talks to it (window screenshots, pointer events, the sidecar's state): see
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

In the room: click a Unit in the tray (or drag it onto a green pad) to plug it in, double-click it to pull it;
drag props about, click the heat gun, the sprayer, the lamp or the light switch; drag knobs and the joystick; drag
the Tab5's body to lean it; click its screen to come close, then a click is a touch. Right-drag or drag the empty
bench to orbit, scroll to zoom, 1-6 for the views, L for the lights.

## Layout

| Path | What |
| --- | --- |
| `app/` | The macOS app (SwiftUI): the window, the panels, the wires between the room and the sidecar |
| `core/` | The room's renderer as a static library: ThreeRT's live path tracer and the room's script behind a C ABI |
| `room/` | The room: a ThreeRT game in TypeScript (`bench.game.ts`), its parts (`decor/`), its printed art (`art/`) |
| `sidecar/` | The simulated Tab5, the builds, the Units' models, the lessons, the agent bridge (TypeScript on Bun) |
| `kit/` | What every project gets: drivers, UI helpers, templates, the agent's guide, the lessons and their solutions |
| `engine/` | A ThreeRT checkout (not in this repository) |
| `vendor/` | Bun 1.4.2 and pocket-m5 with its pinned PocketJS (not in this repository) |
| `docs/` | Architecture, Units, lessons, the agent bridge |

## Credits

The Tab5 enclosure model is from [m5stack/M5_Hardware](https://github.com/m5stack/M5_Hardware) (MIT, © M5Stack). The
ENV III, Ultrasonic and RFID 2 drivers started from [pocket-m5](https://github.com/pocket-nexus/pocket-m5)'s Unit
Swap. M5Stack, Tab5 and the Unit names are M5Stack's; this project is not affiliated with M5Stack.
