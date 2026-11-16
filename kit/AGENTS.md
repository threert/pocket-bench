# Writing an app on Pocket Bench

You are writing a **PocketJS app for the M5Stack Tab5** in TypeScript. It runs on a simulated Tab5 in the user's
room; the user plugs sensor Units into the Tab5's Port A and watches the screen. Your working directory is the
project. A file you change is rebuilt and restarted by the bench within seconds: there is no build command.

An app has two realms that share no memory:

| Realm | File | What it is for |
| --- | --- | --- |
| UI | `main.tsx` | Draws the screen: **640 x 360** logical pixels (shown at 1280 x 720), 30 frames a second, one finger of touch. Solid signals and JSX; `View`, `Text` and `Image` are the only elements. |
| Worker | `worker.ts` | All hardware: I2C to the Units on Port A, HTTP, timers. No screen. |

They talk through **channels** declared in `pocket.app.json`: fixed-size byte records, one direction each.

## Files

```
AGENTS.md  docs/bench-cli.md  docs/pocketjs.md      this guide, the bench command, the API cheat sheet (read-only)
<project>/                                          your working directory
  pocket.app.json    the manifest: the worker's nodes and channels. Keep id, title, app.output, surfaces, viewport.
  main.tsx           the UI
  worker.ts          the worker
  protocol.ts        the records both sides share (import it from both)
  fonts.json         the font Chinese text is baked from
  ui/                parts for a 640 x 360 screen: index.tsx, theme.ts, channel.ts. Pictures in ui/README.md.
  drivers/           one driver for each Unit, and bus.ts (Port A). Notes in drivers/README.md.
  .build/            what a build writes, and your screenshots
```

`ui/` and `drivers/` are the project's own copies: read them, use them, change them when a part falls short.

## The loop

1. Edit.
2. `bench check`: waits for the build, then prints the build's problems, a fault of the app, the last log lines and
   the texts on the screen. `build FAILED` or `app FAULT` in its first lines means broken: fix it before anything
   else. **Run `bench` plainly, alone or joined with `&&`: no `; echo $?`, no `$`, no redirection.** Those, and
   any program that is not `bench` or a reader (`cat ls head tail grep sed -n wc`), stop and ask the user.
3. `bench shot`, then **read the PNG**. The texts do not show overlap, clipping, colour or a missing glyph.
4. Act on the hardware as the user would and look again: `bench set env3-1 celsius 35`, `bench wait 6`,
   `bench tap 320 300`, `bench unplug env3-1`. Put back what you changed.
5. `bench check` once more before you answer.

`bench units` lists the plugged Units with their uid, I2C addresses, inputs and datasheet notes; `bench logs` shows
`console.log` of both realms. All commands: `docs/bench-cli.md`. While you write several files the bench builds in
between: errors of those builds in the log are expected, the first lines of `bench check` are the present state.
Edit files with your editing tool, not with a script.

Test three states of every app that reads a Unit: **live**, **no Unit** (`bench unplug`), and **a value at its
extreme** (`bench set`). A sensor follows a new value over a few seconds, as the real part does.

## Hard rules of the platform

- **No DOM, no CSS, no `window`, no Node APIs, no npm packages.** Imports are `solid-js`,
  `@pocketjs/framework/...` and the project's own files.
- **No `setTimeout`, `setInterval`, `fetch` or `Date.now()` for timing.** UI: `onFrame(() => ...)` runs every
  frame (30 a second); `after(seconds, fn)` runs once. Worker: `await sleep(micros)` and
  `for await (const _ of io.timer(micros))`. Worker times are **microseconds**.
- **Hardware only in the worker.** `main.tsx` cannot import `drivers/*` or `@pocketjs/framework/io`, and
  `worker.ts` cannot import `ui/index.tsx` or anything that draws. Both may import `protocol.ts` and
  `ui/channel.ts`.
- **A class string is compiled at build time and looked up as written.** `class="flex-row gap-2"` works;
  `` class={`text-${size}`} `` and `class={"p-" + n}` do not. Choose between whole literals
  (`class={on ? "bg-green-600" : "bg-slate-700"}`) or use `style={{ ... }}` for values known at run time.
  `ui/` already wraps this: prefer its parts to raw classes.
- **`style` keys are the framework's, not CSS's**: `bgColor`, `textColor`, `width`, `height`, `radius`,
  `opacity`, `translateX`, `insetL`, `paddingT`, `gap`... (list in `docs/pocketjs.md`). Colours are `"#rrggbb"`.
- **Every character on the screen is baked into the app's fonts from the string literals of the source.**
  Importing from `./ui` covers ASCII, `°` and a few symbols. Chinese written as a literal (`"温度"`) is baked too
  (through `fonts.json`). A character that only arrives at run time (text read from a card, from HTTP) and is in
  no literal draws as a hollow box: add it to `"characters"` in `fonts.json`.
- **Font sizes are fixed**: 10, 12, 14, 16, 18, 20, 24, 36, 54 px (`Label size="2xs" | "xs" | "sm" | "base" |
  "lg" | "xl" | "2xl" | "4xl" | "5xl"`). There is no other size, and no 30 or 48.
- **A text is one line.** It never wraps or shrinks: write a second `Label` for a second line. At 14 px a line
  across the whole screen holds about 80 Latin or 40 Chinese characters; a card half as wide, half of that.
- **Limits of a worker**: 8 open I2C handles, 8 requests in flight, 1024 bytes for one I2C script or channel
  record, 8 channels. A driver holds one handle for each address: `close()` a driver you stop using.
- **Channels are what `pocket.app.json` declares**, by name. A record larger than the channel's `recordBytes`
  throws; a ring that is full refuses the record. The template declares `state` (snapshot, worker to UI, 256
  bytes) and `commands` (ring, UI to worker, 64 bytes x 8). Add a channel there before you use it.
- **Port A has power only while EXT 5V is on**, and it is off after every start. `Screen` of `ui/` switches it
  on (`setSwitch("ext-5v", true)` from `@pocketjs/framework/device`). Without it every Unit is silent.

## One app end to end

A Unit is read in the worker, published, shown by the UI, and the UI sends a command back.

`protocol.ts`, shared:

```ts
import { commands, record } from "./ui/channel";

export const State = record({ ok: "bool", celsius: "f32", humidity: "f32", peak: "f32" });   // 13 of the channel's 256 bytes
export const Command = commands({ resetPeak: {} });
```

`worker.ts`:

```ts
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message } from "./drivers/bus";
import { Env3 } from "./drivers/env3";
import { Command, State } from "./protocol";

const bus = new PortA(), out = io.channel("state"), state = State.empty();

async function sense(): Promise<void> {
  await sleep(0);                                    // the clock starts with the first turn
  for (;;) {
    let env: Env3 | undefined;
    try {
      env = await Env3.open(bus);                    // rejects while the Unit is not on Port A
      for (;;) {
        const { celsius, humidity } = await env.read();   // rejects when the Unit is pulled
        Object.assign(state, { ok: true, celsius, humidity, peak: Math.max(state.peak, celsius) });
        out.publish(State.encode(state));
        await sleep(500_000);                        // microseconds
      }
    } catch (error) {
      if (state.ok) console.log(message(error));     // `bench logs` shows it
      state.ok = false;
      out.publish(State.encode(state));
      await sleep(500_000);
    } finally {
      env?.close();                                  // a worker holds 8 handles: give them back
    }
  }
}

async function listen(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    if (Command.decode(bytes)?.name === "resetPeak") state.peak = state.celsius;
  }
}

void sense();
void listen();
```

`main.tsx`:

```tsx
import { Show } from "solid-js";
import { mount } from "@pocketjs/framework/solid";
import { Command, State } from "./protocol";
import { Button, Card, Header, Notice, Screen, Stat, send, useChannel } from "./ui";

mount(() => {
  const state = useChannel("state", State);          // a signal: the worker's newest record
  return <Screen>
    <Header title="Thermometer" status={state().ok ? "live" : "no Unit"} tone={state().ok ? "good" : "warn"} />
    <Show when={state().ok} fallback={<Notice title="Plug in the ENV III" lines={["Port A, the red socket."]} />}>
      <Card title="TEMPERATURE" grow justify="between">
        <Stat value={state().celsius.toFixed(1)} unit="°C" />
        <Button label={`Peak ${state().peak.toFixed(1)} °C. Reset`} onPress={() => send("commands", Command.encode("resetPeak"))} />
      </Card>
    </Show>
  </Screen>;
});
```

The worker loop is the shape of every sensor app: open, read until it fails, say so, close, try again. That is
what makes "no Unit" and "Unit pulled" work without a restart.

## `ui/`: the parts

Import from `./ui`. Everything is laid out with flexbox; sizes are pixels.

| Part | Use |
| --- | --- |
| `Screen` | The root, once. A column with padding; powers Port A; shows toasts. |
| `Header title subtitle status tone` | The top line. `status` is a chip at the right ("live", "no Unit"). |
| `Row`, `Col`, `Spacer` | Layout. Props `gap`, `justify`, `align`, `grow`, `w`, `h`. |
| `Card title grow` | A panel around one idea. With `onPress` it is a button. |
| `Stat value unit label size` | The big number. `lg` 54 px, `md` 36 px, `sm` 24 px. |
| `Label size bold tone` | One line of text. Tones: `text`, `muted`, `faint`, `accent`, `good`, `warn`, `bad`, `info`. |
| `Field label value` | A name at the left, its value at the right. |
| `Button label onPress tone` | 44 px high. Tones `accent`, `neutral`, `good`, `warn`, `bad`, `ghost`. |
| `Toggle label value onChange`, `Slider value onChange min max step w` | Touch controls. |
| `Bar value`, `Gauge value` (a ring, children inside) | Meters, `value` 0..1. |
| `Chart values h grow minSpan mark`, `Sparkline values` | History from an array, oldest first; `undefined` or NaN is a gap. |
| `Chip`, `Dot`, `Notice title lines`, `toast(text, tone)` | States: a word in a pill, a light, a whole-panel message, a line that goes away. |
| `useChannel(name, codec)`, `onChannel`, `send(name, bytes)` | The worker's channels as signals. |
| `theme()`, `setTheme("light")`, `mix`, `alpha`, `toneColor` | Colours. Dark is the default. |

`ui/channel.ts` (both realms): `record({ name: "f32", list: "i16[60]", text: "utf8[24]", flag: "bool" })` gives
`bytes`, `empty()`, `encode(value)`, `decode(bytes)`; `commands({ name: { field: "u8" } })` gives
`encode(name, value)` and `decode(bytes)`. Field types: `u8 i8 u16 i16 u32 i32 f32 bool`, lists, `utf8[N]`.

## Units and `drivers/`

`bench units` tells what is plugged in now; `bench catalog` lists every Unit of the room. Each has a driver:
`const unit = await Env3.open(bus)` rejects with an Error when the Unit is not there, and every method rejects
with a `BusError` when it stops answering. Read the driver's header comment for its methods and units, and
`drivers/README.md` for all of them.

| Unit (type) | Driver | Reads / does |
| --- | --- | --- |
| ENV III (`env3`) | `Env3` | `read()`: celsius, humidity, pascals |
| Ultrasonic (`sonic`) | `Sonic` | `read()`: millimetres or undefined |
| RFID 2 (`rfid2`) | `Rfid2` | `poll()`: card or null; `readText`, `writeText` |
| 8Angle (`angle8`) | `Angle8` | `read()`: 8 knobs 0..1, switch; `setLed(index, r, g, b)` |
| Joystick2 (`joystick2`) | `Joystick2` | `read()`: x, y -1..1, button; `setLed(r, g, b)` |
| Encoder (`encoder`) | `Encoder` | `read()`: steps, button; `setLed(index, r, g, b)` |
| DLight (`dlight`) | `DLight` | `read()`: lux |
| NCIR (`ncir`) | `Ncir` | `read()`: objectCelsius, ambientCelsius |
| Mini Scales (`scales`) | `Scales` | `read()`: grams, button; `tare()`; `setLed(r, g, b)` |
| 4-Relay (`relay4`) | `Relay4` | `set(index, on)`, `read()`. In the room: 0 desk lamp, 1 fan, 2 "ON AIR" sign, 3 amber beacon |

Several Units share Port A when their addresses differ (Mini Scales and 4-Relay both use 0x26: one of the two).

## Designing for a 5-inch screen

- **One idea a screen.** One big number or one control is the subject; the rest supports it. Three cards at most.
- **Large type.** The main value at `lg` (54 px), secondary values at `md`, captions at `xs` or `sm`. Nothing a
  user must read below 12 px.
- **Touch targets at least 44 px** high and wide, 8 px apart. `Button`, `Toggle` and `Slider` already are.
- **Dark theme** unless asked otherwise. One accent colour; green, amber and red only for states.
- **Fill 640 x 360 without crowding**: 16 px to the edges, 12 px between cards (`Screen` and `gap={12}` do it).
- **Design the states**: no Unit plugged (a `Notice` that says which Unit and where: "Port A, the red socket"), a
  sensor that stopped answering, a value out of range, the first second before any reading.
- **Show what a person wants**: `24.6 °C`, not `24.5999`; "card removed", not `null`. Units next to numbers.
- **Write the screen in the user's language.** If they write Chinese, the app's texts are Chinese.

## Troubleshooting

| `bench check` says | Cause and fix |
| --- | --- |
| `TS2306: File '.../not-in-domain.d.ts' is not a module` | The UI imports something of the worker (a driver, `@pocketjs/framework/io`), or the worker something of the UI. Move the code to the right realm; share data through a channel. |
| `build FAILED` with only `PocketJS compiler failed: 1` | The compiler stopped on a `class` built with a template string, or on `classList`. Use whole literals or `style`. |
| `FAULT in ui: unknown class "..." - not in the compiled style table` | A token of that class string is not a supported utility (`items-centre`, `text-3xl`, `rounded-2xl`, `-mt-2`), so the whole string was dropped. Supported ones: `docs/pocketjs.md`. |
| `TS2353: ... 'backgroundColor' does not exist in type 'StyleObject'` | `style` takes the framework's keys: `bgColor`, `textColor`, `radius`... |
| `FAULT in ui: Undeclared worker channel: x` (or `FAULT in host` from the worker) | `pocket.app.json` has no channel of that name: add it under `domains.worker.channels`. |
| `RangeError: Channel state record exceeds 256 bytes` | The record outgrew the channel: raise `recordBytes` (1024 at most) or send less. `State.bytes` is the size. |
| `Cannot open i2c node porta: -4` | More than 8 handles are open: a driver was opened again without `close()`. |
| `Undeclared i2c node: x` | The worker's nodes are `porta` (Port A) and `sys` (the board's own bus). |
| `<Unit> is not on Port A (expected at 0x44 and 0x70)` in the logs | The Unit is not plugged in (`bench units`), or EXT 5V is off: `Screen` switches it on, an app without `Screen` calls `setSwitch("ext-5v", true)` itself. |
| `BusError: ... nothing answered at 0x44 on Port A (status -1)` | The Unit was pulled while the driver ran. Catch it, show "no Unit", close the driver and open it again in a loop. |
| `FAULT in host:` a long line of minified code, then `ReferenceError: setTimeout is not defined` (or `fetch`, `TextEncoder`) | Read the last line. The worker has none of these: use `sleep`, `io.timer`, `io.http`, `utf8()` of `@pocketjs/framework/io`. A fault in the worker's async code is reported as `host`. |
| A hollow box where a character should be (only the screenshot shows it) | The character is in no string literal: add it to `"characters"` in `fonts.json`. Emoji are not in the fonts. |
| A text is cut off or runs over its neighbour | Texts do not wrap or shrink. Shorten it, give the `Label` a `w`, or use a smaller `size`. |
| A card with a border turns the border's colour | A see-through `bgColor` on a node with a border: use `mix(theme().panel, colour, 0.15)`. |
| The number is right in `bench texts` but nothing changes on the screen | The value is read once, outside JSX. Read signals inside JSX or `createMemo`: `{state().celsius}`, not `const c = state().celsius`. |
| The screen is stale after an edit | The build failed and the last good build keeps running: read the top of `bench check`. |

More: `docs/pocketjs.md` (imports, signatures, class utilities, style keys), `ui/README.md`, `drivers/README.md`.
