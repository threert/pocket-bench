# PocketJS on the Tab5: what an app can import

The reference behind `AGENTS.md`. Every signature here was read from the framework the bench builds with
(`node_modules/@pocketjs/framework`, version 0.16) and run on the bench. Paths are exact: a subpath that is not
listed here is for another device.

## The two realms

| | UI (`main.tsx` and what it imports) | Worker (`worker.ts` and what it imports) |
| --- | --- | --- |
| Runs | once a frame, 30 Hz | when a timer, an I2C answer or a channel record wakes it |
| May import | `solid-js`, `@pocketjs/framework/{solid,components,lifecycle,clock,animation,gesture,input,device,worker/channels}` | `@pocketjs/framework/{io,io/i2c,worker}` |
| Globals | `console`, `Math`, `JSON`, typed arrays. No `setTimeout`, `fetch`, `document`, `window`. | the same, and no `TextEncoder` |

A file both import (`protocol.ts`, `ui/channel.ts`) imports nothing of either list. The wrong import fails the
build with `TS2306 ... not-in-domain.d.ts is not a module`.

## `pocket.app.json`

Keep `id`, `title`, `app.output`, `app.surfaces`, `app.viewport`, `engine.capabilities` as the template has them.
What an app changes is `domains.worker`:

```json
"domains": { "worker": {
  "entry": "worker.ts",
  "nodes": [ { "name": "porta", "kind": "i2c" }, { "name": "sys", "kind": "i2c" }, { "name": "http", "kind": "http" } ],
  "channels": [
    { "name": "state", "kind": "snapshot", "direction": "worker-to-ui", "recordBytes": 256, "capacity": 1 },
    { "name": "events", "kind": "ring", "direction": "worker-to-ui", "recordBytes": 32, "capacity": 8 },
    { "name": "commands", "kind": "ring", "direction": "ui-to-worker", "recordBytes": 64, "capacity": 8 }
  ]
} }
```

- Nodes on the bench: `porta` (Port A, I2C, 100 kHz), `sys` (the board's own I2C bus: BMI270 motion sensor at
  0x68, RX8130CE clock at 0x32, INA226 battery monitor at 0x41) and `http`. Declare the ones the worker opens.
  The real Tab5 also has `mqtt` and `rs485` (a UART); the bench does not answer on them.
- A **snapshot** keeps the newest record: the reader always sees the latest (a state). A **ring** keeps up to
  `capacity` records in order and refuses more (events, commands).
- `recordBytes` at most 1024, `capacity` at most 8, 8 channels.

## UI

### Start

```tsx
import { mount } from "@pocketjs/framework/solid";
import { AuxiliarySurface, Image, Text, View, type NodeMirror } from "@pocketjs/framework/components";

mount(() => <AuxiliarySurface><View class="w-full h-full bg-[#0b0f14]">...</View></AuxiliarySurface>);
```

The Tab5's screen is the **auxiliary surface**: everything is drawn inside one `<AuxiliarySurface>` (`Screen` of
`ui/` is one). What is mounted outside it is not on the screen.

### State: Solid

```tsx
import { batch, createEffect, createMemo, createSignal, For, Index, Match, onCleanup, Show, Switch } from "solid-js";

const [count, setCount] = createSignal(0);
const double = createMemo(() => count() * 2);
<Text class="text-lg">{count()} doubled is {double()}</Text>      // read signals inside JSX
<Show when={count() > 3} fallback={<Text>keep going</Text>}><Text>done</Text></Show>
<Index each={bars()}>{(bar, index) => <View style={{ height: bar() }} />}</Index>   // a fixed number of slots
<For each={rows()}>{(row, index) => <Text>{row.name}</Text>}</For>                  // items that come and go
```

A component function runs **once**. Props are read where they are used (`props.value` inside JSX), never
destructured. `array.map` in JSX is for a list that never changes.

### Elements and their props

| | `View` | `Text` | `Image` |
| --- | --- | --- | --- |
| `class` (a whole literal) | yes | yes | yes |
| `style={{ key: value }}` | yes | yes | yes |
| `ref={(node: NodeMirror) => ...}` | yes | yes | yes |
| `focusable` + `onPress={() => ...}` (a tap) | yes | | |
| `src="name.png"` | | | yes |

- `Text` holds strings and numbers only, one line. Its colour and size come from its own class or style.
- `Image`: `src` is a file name beside `main.tsx` (PNG, 8-bit RGB or RGBA; **sides a power of two, 512 at
  most**; a smaller picture sits at the top left of a padded file and is cropped by an `overflow-hidden` View).
  The name must be a literal somewhere in the source.

### Classes (compiled at build time)

A class string compiles only if **every** token is one of these; otherwise the node gets no style and the app
faults with `unknown class`.

| Group | Utilities |
| --- | --- |
| Flex | `flex-row` `flex-col` `flex-wrap` `flex-1` `grow` `grow-0` `shrink-0` `basis-N` `gap-N` `justify-start\|center\|end\|between\|around` `items-start\|center\|end\|stretch` |
| Size | `w-N` `h-N` `w-full` `h-full` `w-[123]` `h-[123]` `min-w-N` `min-h-N` `max-w-N` `max-h-N` (N x 4 px; `full` only for `w` and `h`) |
| Space | `p-N` `px-N` `py-N` `pt-N` `pr-N` `pb-N` `pl-N` `m-N` `mx-N` `my-N` `mt-N` ... (no negative steps: `mt-[-4]`) |
| Position | `absolute` `relative` `inset-N` `top-N` `right-N` `bottom-N` `left-N` `z-N` `hidden` `overflow-hidden` |
| Colour | `bg-` `text-` `border-` + Tailwind's palette (`slate-700`, `emerald-500`, `white`, `black`, `transparent`) or `[#rrggbb]` |
| Shape | `rounded` `rounded-sm\|md\|lg\|xl` `rounded-[N]` `rounded-full` (needs `w-N h-N` in the same string) `border` `border-2\|4\|8` `opacity-N` `shadow` `shadow-md\|lg` |
| Gradient | `bg-gradient-to-t\|b\|l\|r` `from-*` `via-*` `to-*` |
| Text | `text-2xs\|xs\|sm\|base\|lg\|xl\|2xl\|4xl\|5xl` (10 12 14 16 18 20 24 36 54 px) `font-bold` `font-mono` (12, 14, 16 px only) `text-left\|center\|right` `leading-N` `tracking-wide` |
| Transform | `translate-x-N` `translate-y-N` `scale-N` `rotate-N` `origin-*` |
| Motion | `transition` `transition-colors\|opacity\|transform\|all` `duration-N` `delay-N` `ease-linear\|in\|out\|in-out\|spring\|out-back` `animate-spin\|ping\|pulse\|bounce` |
| State | `active:` before any utility (while pressed): `active:opacity-60`. No `hover:`. |

Not there: `text-3xl`, `rounded-2xl`, `justify-evenly`, `items-baseline`, `self-*`, `grid`, `space-x-N`, `w-1/2`,
`h-screen`, percentages, `-mt-2`, `font-medium`, `italic`, `underline`, `truncate`, `line-clamp`.

A size of text that is used is baked into the app with every character: 20 KiB for the smallest, 500 KiB for
the largest. `Label` of `ui/` names all nine, so an app built on it carries them all (1.1 MiB).

### `style` keys

Values are numbers (pixels, degrees, 0..1) or `"#rrggbb"` / `"#rrggbbaa"`. A key that is dropped keeps its last
value: always write the resting value.

| Group | Keys |
| --- | --- |
| Box | `width` `height` `minW` `minH` `maxW` `maxH` `paddingT\|R\|B\|L` `marginT\|R\|B\|L` `gap` `grow` `shrink` `basis` |
| Position | `insetT` `insetR` `insetB` `insetL` (with class `absolute`) `zIndex` |
| Look | `bgColor` `radius` `opacity` `borderColor` `borderWidth` `gradFrom` `gradTo` |
| Text | `textColor` `textAlign` (0 left, 1 centre, 2 right; needs a width) `lineHeight` `tracking` |
| Transform (no relayout: use for motion) | `translateX` `translateY` `scale` `scaleX` `scaleY` `rotate` |
| Arc | `arcStart` (degrees, 0 at 12 o'clock, clockwise) `arcSweep` `arcWidth`: the node draws a ring segment in its `bgColor` |
| Touch | `hitPass: 1`: touches go through this node to what is under it |

### Time and motion

```ts
import { onFrame } from "@pocketjs/framework/lifecycle";        // onFrame(() => { ... }): every frame, 30 a second
import { after, virtualNow } from "@pocketjs/framework/clock";   // after(2.5, () => ...): once, returns a cancel function; virtualNow(): seconds since the start
import { animate, jump, cancelAnim } from "@pocketjs/framework/animation";

animate(node, "translateX", 120, { dur: 200, easing: "out", delay: 0 });   // ms; easings: linear in out in-out out-back spring spring-bouncy
jump(node, "opacity", 0);                                                   // set at once
```

`node` is what `ref` hands over. Animate transform keys and `opacity`; `width` and `height` relayout every frame.
The app's clock is its frames: a counter in `onFrame` is the timer (`if (++frames % 30 === 0)` is once a second).

### Touch

A tap is `focusable onPress` on a `View`; the nearest ancestor with `onPress` takes it. For a drag:

```ts
import { createGesture } from "@pocketjs/framework/gesture";

createGesture({
  surface: "auxiliary",                       // required on the Tab5: the default watches the other surface
  region: { node: () => trackNode },          // touches that land in this node's subtree
  axis: "x",                                  // "x" | "y" | "any"
  onDown(c) {}, onPanStart(c) {}, onPanMove(c) {}, onPanEnd(c) {}, onTap(c) {}, onLongPress(c) {}, onCancel(c) {},
});
// c: x, y, startX, startY, dx, dy (since down), fdx, fdy (this frame), vx, vy (px a second), hit (id of the node under the finger at down)
```

Coordinates are screen pixels (0..639, 0..359). There is no way to ask where a node is: a control that needs
positions inside itself gets a fixed size (`Slider` of `ui/` shows how). One finger; no hover.
`auxiliaryTouches()` of `@pocketjs/framework/input` gives the raw contacts of this frame.

### The board

```ts
import { deviceStatus, setBrightness, setSwitch, setVolume } from "@pocketjs/framework/device";

setSwitch("ext-5v", true);          // Port A's power. Other switches: "usb-5v", "charge", "quick-charge", "antenna"
setBrightness(60);                  // percent
deviceStatus();                     // { display: { brightness }, volume, temperature, switches: [{ id, on }], ports: [{ id, connected }] } | null
```

Sound, the camera, Wi-Fi setup and files are on the real Tab5 but not on the bench: do not build on them here.

### Channels, UI side

```ts
import { worker } from "@pocketjs/framework/worker/channels";

const state = worker.channel("state");            // throws "Undeclared worker channel" for a name the manifest lacks
onFrame(() => { for (const view of state.observe()) use(view.copy()); });   // a snapshot hands its record over every frame
worker.channel("commands").publish(bytes);        // false: the ring is full
```

A view is valid for one frame: `copy()` gives bytes to keep. `useChannel`, `onChannel` and `send` of `ui/` wrap
this; `record()` and `commands()` of `ui/channel.ts` make and read the bytes.

## Worker

```ts
import { FactKind, io, ResourceError, ResourceStatus, utf8, utf8Text } from "@pocketjs/framework/io";
import { bytes, f32, i16be, i16le, i24, read, receive, u16be, u16le, u24, u32, u8, write } from "@pocketjs/framework/io/i2c";
import { nowMicros, settle, sleep, wallClock } from "@pocketjs/framework/worker";
```

The file's top level runs once: open what is needed and start `async` functions. Nothing is exported. An
exception nobody catches stops the worker (`FAULT`): wrap each loop's body in `try`.

### Time

- `await sleep(micros)`; `await sleep(0)` first of all, so that the clock is running.
- `for await (const tick of io.timer(periodMicros)) { ... }`: a steady period; `tick.missed` counts skipped ones.
- `nowMicros()`: microseconds since the start (`undefined` before the first `await`; `now()` of
  `drivers/bus.ts` is a number always). `wallClock()?.utcMicros`: the date and time, when the board knows it.

### I2C

```ts
const device = io.i2c("porta").open({ address: 0x44, timeoutMillis: 25 });   // one of the worker's 8 handles
const data = await device.run([write(0x24, 0x00), receive([bytes(6)])]);     // one transaction; resolves with the bytes read
await device.probe();                                                         // true when the address acknowledges
device.close();
```

- `write(register, ...bytes)`: the register byte, then the bytes. `read(register, layout)`: the register byte, a
  repeated START, then a read. `receive(layout)`: a bare read, no register byte.
- A layout is a list of `u8`, `u16le`, `u16be`, `i16le`, `i16be`, `u24`, `i24`, `u32`, `f32`, `bytes(n)`; the
  result is the bytes in order (read numbers with a `DataView`).
- `run` rejects with a `ResourceError` (`status` -1: no answer) when the device does not acknowledge.
- **Use `drivers/bus.ts` instead of this**: `new PortA()`, `bus.open(address)`, `bus.scan()`, `device.run`,
  `device.select(register, length)`, and a `BusError` that says which address was silent. Some Units need two
  transactions for a register read (`select`): the driver of each Unit knows.

### Channels, worker side

```ts
io.channel("state").publish(bytes);                                 // worker to UI; false when a ring is full
for await (const bytes of io.channel("commands").observe()) { ... }  // UI to worker, every record in order
```

### HTTP

Declare the node (`{ "name": "http", "kind": "http" }`). A response arrives as facts on the request's stream:

```ts
async function httpGet(url: string, maxBytes = 65536): Promise<{ status: number; text: string }> {
  const request = io.http("http").open({ url, timeoutMs: 8000, maxBytes });   // also: method, headers, body (text)
  const chunks: Uint8Array[] = [];
  let status = 0;
  // Read the stream from before the request starts: a fact nobody reads is gone with its turn.
  const reading = (async () => {
    for await (const fact of request.observe()) {
      if (fact.kind === FactKind.headers) status = fact.status;
      else if (fact.kind === FactKind.data) chunks.push(fact.data);           // 1024 bytes at most each
      else if (fact.kind === FactKind.end || fact.kind === FactKind.error) break;
    }
  })();
  const id = request.submit();
  await reading;
  await settle(id);
  request.close();
  const body = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let at = 0;
  for (const chunk of chunks) { body.set(chunk, at); at += chunk.length; }
  return { status, text: utf8Text(body) };                                     // status 0: the request did not get through
}
```

The URL, method, headers and body together fit in 1024 bytes. Join the chunks before decoding: a character may
be split between two. The result goes to the UI through a channel: at most 1024 bytes a record, so send the few
values the screen shows, not the document.

## Text and fonts

- The build collects every character of every string literal in the files `main.tsx` reaches and bakes them
  into each font size in use. `GLYPHS` of `ui/theme.ts` is such a literal: ASCII, `°±×÷·•…–—←↑→↓≤≥≈µΩ✓✗`.
- Latin comes from Inter. A character Inter lacks is taken from the fallback faces of `fonts.json`:
  `../.bench/fonts/cjk.otf`, a Chinese face the bench prepares (Hiragino Sans GB W6). It has one weight:
  Chinese is as heavy in a bold text as in a regular one.
- `fonts.json`: `"fallback"` (font files, `.ttf` or `.otf`, one face each; a `.ttc` collection is not read),
  `"characters"` (a string of characters to bake although no literal has them), `"ranges"` (`"U+4E00-4EFF"`).
- Each Chinese character costs about 10 KiB in the app, over all sizes: bake what the app shows, not the whole
  script. A range of thousands makes a build slow and an app of tens of megabytes.
- Text that arrives at run time (a name read from a card, a title from the network) shows only the characters
  that were baked; the rest are hollow boxes.
