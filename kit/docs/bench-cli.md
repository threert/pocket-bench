# `bench`: the command line to the bench

`bench` talks to the running Pocket Bench: the simulated Tab5 your project runs on, and the Units plugged into it.
It is on your PATH. Run it from the project folder. It prints plain text; exit status 0 is good, 1 means the build
or the app is broken or the bench refused, 2 means a wrong command line or no bench.

The bench rebuilds and restarts the app when a `.ts`, `.tsx`, `.json` or `.png` file of the project changes. There
is no build command. After every change, run `bench check`.

## Commands

| Command | What it does |
| --- | --- |
| `bench check` | Waits until no build is running and the restarted app is past its first second. Prints the build (ok, or each problem as `file:line:column message`), the app (running, or the fault with its domain and the top of its stack), the last 15 log lines, and the texts on the screen. Exit 1 when the build failed or the app stopped. |
| `bench shot [file.png]` | Saves the Tab5's screen as a PNG (the 640x360 screen at twice the size, 1280x720) and prints the path. Without a name: `.build/shots/screen-HHMMSS.png`. The file must be inside the project. Read the image to see layout, colours, clipping. |
| `bench texts` | The texts on the screen, top to bottom: `x,y WxH "text"` in screen pixels (640x360). |
| `bench logs [-n N]` | The last N log lines (40): virtual time, domain (`ui`, `worker`, `host`), text. `console.log` of the app arrives here. |
| `bench state` | Build and app state, the plugged Units with what was set on them and what they read now, the board (brightness, volume, switches). |
| `bench units` | The plugged Units: uid, type, I2C addresses, inputs with their ranges, the driver in the project, the datasheet notes for writing a driver. |
| `bench catalog` | Every Unit the room has, plugged or not. |
| `bench set <uid> <key> <json>` | Acts on a Unit as the room would: `bench set env3-1 celsius 35`. The keys are the Unit's inputs (`bench units`). |
| `bench tap <x> <y>` | Touches the screen at a point (x 0..639, y 0..359) and lets go. |
| `bench type <text>` | Types on the keyboard. |
| `bench plug <type> [uid]` | Plugs a Unit of the catalogue into Port A. Refused when its I2C address is taken. |
| `bench unplug <uid>` | Pulls a Unit. |
| `bench wait <seconds>` | Lets the app run (10 at most). A sensor follows a new value over some seconds, as the part does. |

## What `bench check` prints

```
project probe "Unit Swap"
build ok (build 4, 1.7 s)
app running, 1.3 s up
logs (last 3)
     0.00s worker unit-swap worker: porta node declared
     0.13s worker ENV III attached at 0x44 0x70
     0.16s worker ENV III: 24.60 C 48.0 %RH 1011.78 hPa (QMP6988 24.90 C, 0 CRC errors)
screen (x,y WxH text)
  16, 10 380x24  "Unit Swap"
  22, 94 140x65  "24.6"
 166,104 380x24  "°C"
```

A broken build keeps the last good build on the screen, so read the first lines before the texts:

```
build FAILED (build 5); the last good build keeps running
  worker.ts:198:7 TS2322: Type 'string' is not assignable to type 'number'.
```

A fault at run time reads `app FAULT in ui: <message>` (or `worker`), followed by the top of the stack.

## The loop

Asked for "the temperature in red when it is above 30":

1. Edit `main.tsx`.
2. `bench check`: the build is ok, the app runs, the screen shows `"24.6"`. Nothing proves the red yet.
3. `bench shot`, read the PNG: the layout is intact, the number is white at 24.6 °C.
4. `bench set env3-1 celsius 35`, then `bench wait 6`: the simulated SHT30 warms up as the part does (it reads
   28 °C after 2 s, 32 °C after 6 s, 34 °C after 12 s). `bench state` shows what a unit reads now.
5. `bench check`: the screen shows `"31.6"`. `bench shot`, read the PNG: the number is red.
6. `bench set env3-1 celsius 24.6` to leave the bench as it was.

```
$ bench set env3-1 celsius 35
env3-1 celsius = 35 (was 24.6). A sensor follows over some seconds: bench state shows what the unit reads now.
$ bench wait 6
$ bench check
project probe "Unit Swap"
build ok (build 4, 1.7 s)
app running, 27.9 s up
...
  22, 94 140x65  "31.6"
```

## Notes

- `bench check` reads the bench, it does not build: it waits for the build the file change started.
- The texts are what a person would read, with their boxes: a text missing from the list is not on the screen,
  and a box that ends past x 640 or y 360 is cut off.
- A unit's uid is its type and a number (`env3-1`). `bench state` lists the ones plugged in.
- If `bench` says the bench does not answer, the app is closed or a sandbox blocks the loopback: `bench` needs
  `127.0.0.1`. It is approved to run outside a sandbox.
