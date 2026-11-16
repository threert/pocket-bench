# Unit drivers

One file per M5Stack Unit, for the **worker** of a PocketJS app on the Tab5. They are plain TypeScript on
`@pocketjs/framework/io`, `/io/i2c` and `/worker`: read them, change them, copy from them.

Every Unit here plugs into **Port A** (the red Grove socket: GND, 5 V, SDA on G53, SCL on G54, 100 kHz). Three
things have to be in place before a Unit answers:

1. `pocket.app.json` declares the bus: `"domains": { "worker": { "entry": "worker.ts", "nodes": [{ "name": "porta", "kind": "i2c" }] } }`
   and requires `runtime.worker` and `io.i2c`.
2. The UI switches the socket's supply on: `setSwitch("ext-5v", true)` from `@pocketjs/framework/device`.
3. The worker opens the Unit through `PortA` (`bus.ts`).

## The pattern

```ts
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message } from "./drivers/bus";
import { Env3 } from "./drivers/env3";

const bus = new PortA();

async function main(): Promise<void> {
  for (;;) {
    const env = await Env3.identify(bus);          // undefined: not plugged in
    if (env) {
      try {
        for (;;) {
          const { celsius } = await env.read();    // rejects when the Unit is pulled
          console.log(`${celsius.toFixed(1)} C`);
          await sleep(500_000);                    // microseconds; there is no setTimeout
        }
      } catch (error) {
        console.log(`ENV III lost: ${message(error)}`);
      } finally {
        env.close();                               // gives its handles back
      }
    }
    await sleep(250_000);
  }
}
void main();
```

Each driver class has

- `static ADDRESSES`: the I2C addresses the Unit answers on;
- `static identify(bus)`: the Unit, set up and ready, or `undefined` when it is not on the port;
- `static open(bus)`: the same, or an `Error` that names the Unit and its address;
- methods in physical units that **reject with a `BusError`** (an `Error`; `address`, `status`) when the Unit
  stops answering;
- `close()`.

Limits to keep in mind: a worker holds **8 open handles** (ENV III takes 2, the others 1; `bus.probe` borrows 4
for a moment) and **8 requests in flight**; one script carries at most 1024 bytes. Call one method of a Unit at a
time, or let the driver queue them: every driver runs its multi-step operations one after another.

`bus.ts` also has `bus.probe(addresses)` (which of them acknowledge), `bus.scan()` (all of 0x08..0x77),
`now()` (the worker's clock, microseconds) and `pace(start, period)` for a loop with a fixed period.

Two Units share address 0x26 (4-Relay and Mini Scales): only one of them can be on the port.

## ENV III (`env3.ts`): temperature, humidity, pressure

SHT30 at **0x44** and QMP6988 at **0x70**. One `read()` takes about 30 ms.

```ts
import { Env3, altitude, dewPoint } from "./drivers/env3";

const env = await Env3.open(bus);
const { celsius, humidity, pascals } = await env.read();
console.log(`${celsius.toFixed(1)} C, ${humidity.toFixed(0)} %RH, ${(pascals / 100).toFixed(1)} hPa`);
console.log(`dew point ${dewPoint(celsius, humidity).toFixed(1)} C, ${altitude(pascals).toFixed(0)} m`);
```

The sensor's package follows the air slowly: a step in temperature takes many seconds to show in full.

## Ultrasonic I2C (`sonic.ts`): distance

RCWL-9620 at **0x57**, 20 mm to 4500 mm. One `read()` takes 120 ms (the echo's flight time).

```ts
import { Sonic, median } from "./drivers/sonic";

const sonic = await Sonic.open(bus);
const millimetres = await sonic.read();          // undefined: nothing in range
if (millimetres !== undefined) console.log(`${(millimetres / 10).toFixed(1)} cm`);
// A median of a few readings drops a single bad echo.
const window: number[] = [];
for (let i = 0; i < 5; ++i) { const mm = await sonic.read(); if (mm !== undefined) window.push(mm); }
if (window.length) console.log(`steady: ${median(window).toFixed(0)} mm`);
```

## RFID 2 (`rfid2.ts`): 13.56 MHz cards

WS1850S reader at **0x28** (the MFRC522's registers). Reads cards within 20 mm: MIFARE Classic 1K/4K and MIFARE
Ultralight / NTAG. Every call wakes the card, works and halts it, so poll as often as you like.

```ts
import { Rfid2, hexUid } from "./drivers/rfid2";

const rfid = await Rfid2.open(bus);
const card = await rfid.poll();                  // null: no card over the reader
if (card) {
  console.log(`${card.kind} ${hexUid(card.uid)}`);   // "classic1k DEADBEEF"
  await rfid.writeText("door 12");                   // 16 ASCII characters at most
  console.log(await rfid.readText());                // "door 12"
}
```

`readBlock(block)` / `writeBlock(bytes16, block)` move 16 raw bytes. Text and blocks default to block 4: sector 1
of a Classic card, pages 4..7 of an Ultralight. On a Classic card do not write block 0 (the UID) or the last
block of a sector (3, 7, 11, ...: its keys). `rfid.key` is the Classic key A, FF x 6 on a new card; a card with
another key rejects with "refused the key".

## 8Angle (`angle8.ts`): eight knobs, a switch, nine LEDs

STM32 at **0x43**. LED 0..7 sit under the knobs, LED 8 by the switch. `read()` is nine short reads.

```ts
import { Angle8 } from "./drivers/angle8";

const knobs = await Angle8.open(bus);
const { knobs: positions, switch: on } = await knobs.read();   // eight numbers 0..1, a boolean
const volume = await knobs.knob(0);                            // one knob alone
// Light each LED by its knob: colour 0..255, then brightness 0..100.
for (let i = 0; i < 8; ++i) await knobs.setLed(i, 255, 160, 0, positions[i]! * 100);
await knobs.setLed(8, 0, on ? 255 : 0, 0);
```

The firmware limits the LEDs: full brightness is a tenth of what the LED could give, which is plenty.

## Joystick2 (`joystick2.ts`): a stick, its button, an LED

STM32 at **0x63**. The firmware calibrates the Hall sensor and holds the rest position at exactly 0.

```ts
import { Joystick2 } from "./drivers/joystick2";

const stick = await Joystick2.open(bus);
const { x, y, button } = await stick.read();     // x, y: -1..1; button: pressed
if (Math.hypot(x, y) > 0.5) console.log(`pushed towards ${(Math.atan2(y, x) * 180 / Math.PI).toFixed(0)} degrees`);
await stick.setLed(button ? 255 : 0, 0, 40);     // r, g, b: 0..255
```

Which way is +x and +y depends on how the Unit is mounted: check with the stick in your hand.

## Encoder (`encoder.ts`): an endless knob, its switch, two LEDs

STM32 at **0x40**. 30 detents a turn. `steps` counts detents since `open()` or `zero()`, clockwise positive.

```ts
import { sleep } from "@pocketjs/framework/worker";
import { Encoder } from "./drivers/encoder";

const knob = await Encoder.open(bus);
let volume = 50;
let last = 0;
for (;;) {
  const { steps, button } = await knob.read();
  volume = Math.min(100, Math.max(0, volume + steps - last));
  last = steps;
  await knob.setLed(0, 0, volume * 2, button ? 255 : 0);   // 0 = both LEDs, 1 or 2 = one
  await sleep(30_000);
}
```

Poll it a few times a second at least: the driver follows the firmware's 16-bit counter across its wrap.

## DLight (`dlight.ts`): ambient light

BH1750FVI at **0x23**. 1 lx steps up to 54612 lx. The sensor converts continuously (120 ms a conversion);
`read()` returns the latest result, and only the first call waits for one.

```ts
import { DLight } from "./drivers/dlight";

const light = await DLight.open(bus);
const lux = await light.read();
console.log(lux < 10 ? "dark" : lux < 500 ? "indoors" : lux < 10_000 ? "bright" : "sunlight");
```

## NCIR (`ncir.ts`): temperature without contact

MLX90614 at **0x5A**. It averages over a 90 degree cone, so hold it close: at 5 cm it sees a 10 cm circle.

```ts
import { Ncir } from "./drivers/ncir";

const ncir = await Ncir.open(bus);
const { objectCelsius, ambientCelsius } = await ncir.read();   // 0.02 C steps
console.log(`surface ${objectCelsius.toFixed(1)} C, sensor ${ambientCelsius.toFixed(1)} C`);
```

## Mini Scales (`scales.ts`): weight, a button, an LED

STM32 + HX711 at **0x26**, 5 kg. The reading settles about 0.3 s after the load changes.

```ts
import { Scales } from "./drivers/scales";

const scale = await Scales.open(bus);
await scale.tare();                              // the empty pan is 0 g
const { grams, button } = await scale.read();
if (button) await scale.tare();                  // the Unit's button as a tare key
await scale.setLed(0, grams > 1 ? 255 : 0, 0);
console.log(`${grams.toFixed(1)} g`);
```

`raw()` and `calibrate(emptyRaw, loadedRaw, grams)` recalibrate it with a known weight.

## 4-Relay (`relay4.ts`): four switches for real loads

STM32 at **0x26**. Each relay switches up to AC 250 V / DC 28 V, 10 A. Relays are numbered 0..3 here (1..4 on
the case). `open()` leaves the relays as they are and makes each LED follow its relay.

```ts
import { Relay4 } from "./drivers/relay4";

const relays = await Relay4.open(bus);
await relays.set(0, true);                       // close relay 1
console.log(await relays.read());                // [true, false, false, false]
await relays.setAll(false);
// LEDs on their own: setSync(false), then setLed(index, on).
```

A relay is a mechanical switch: it clicks, takes about 10 ms, and wears. Do not toggle it many times a second.
