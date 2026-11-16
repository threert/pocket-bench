// 调光台, the worker: reads the eight knobs and the switch of the 8Angle
// about twenty times a second, works out a colour for each of its nine
// LEDs and writes the ones that changed. Throwing the switch turns every
// LED off; throwing it back brings the colours back, because they are
// computed from the knobs every time.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { Angle8 } from "./drivers/angle8";
import { PortA, message, now, pace } from "./drivers/bus";
import { Knob, LEDS, State, Status } from "./protocol";

type Rgb = [number, number, number];

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();

function publish(): void {
  channel.publish(State.encode(state));
}

// ---- colour -------------------------------------------------------------------

/** Turns a colour around the colour wheel by `degrees`, keeping how light and how vivid it is. */
function turnHue([r, g, b]: Rgb, degrees: number): Rgb {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), span = max - min;
  if (span === 0 || degrees === 0) return [r, g, b];       // a grey has no hue to turn
  let hue = max === r ? ((g - b) / span + 6) % 6 : max === g ? (b - r) / span + 2 : (r - g) / span + 4;
  hue = (hue + degrees / 60) % 6;
  // From the hue back to three channels between min and max.
  const channelAt = (offset: number) => {
    const k = (offset + hue) % 6;
    return max - span * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [channelAt(5), channelAt(3), channelAt(1)];
}

const towards = (colour: Rgb, target: number, amount: number): Rgb => colour.map(value => value + (target - value) * amount) as Rgb;

/** A small random generator (the worker has no need for a better one): 0..1. */
let seed = 0x2f6e2b1;
function random(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 0x100000000;
}

/** How far the travelling gradient has moved, in strip lengths, and each LED's sparkle as it fades. */
let travelled = 0;
const sparkle = new Array<number>(8).fill(0);

/** The colour of every LED for this moment, 0..255 a channel.
 *  `knobs` are 0..1, `seconds` the clock, `step` the seconds since the last call. */
function lights(knobs: readonly number[], seconds: number, step: number): Rgb[] {
  // Knobs 1 to 3 mix the colour; knob 4 washes it out towards white.
  const mixed = towards([knobs[Knob.red]! * 255, knobs[Knob.green]! * 255, knobs[Knob.blue]! * 255], 255, knobs[Knob.white]!);
  // Knob 6: the gradient travels along the strip, up to one length a second.
  travelled = (travelled + knobs[Knob.flow]! * step) % 1;
  // Knob 7: all LEDs breathe together, one breath in three seconds, never quite going out.
  const breath = 1 - knobs[Knob.breath]! * 0.85 * (0.5 - 0.5 * Math.cos(seconds * 2 * Math.PI / 3));
  const out: Rgb[] = [];
  for (let index = 0; index < 8; ++index) {
    // Knob 5: neighbours drift apart around the colour wheel, up to a whole rainbow. The
    // offset rises and falls along the strip (a triangle), so it has no seam while it travels.
    const along = (index / 8 + travelled) % 1;
    let colour = turnHue(mixed, knobs[Knob.spread]! * 360 * (1 - Math.abs(2 * along - 1)));
    colour = towards(colour, 0, 1 - breath);
    // Knob 8: now and then an LED flashes white and fades.
    sparkle[index] = random() < knobs[Knob.sparkle]! * step * 3 ? 1 : sparkle[index]! * Math.max(0, 1 - step * 5);
    out.push(towards(colour, 255, sparkle[index]!));
  }
  // The ninth LED, beside the switch, shows the plain mix.
  out.push(mixed);
  return out;
}

/** The firmware drives an LED at a tenth of the byte it is given: 26 steps. Colours are
 *  rounded to those steps here, so that an LED is only written when it really changes. */
const steps = (colour: Rgb): Rgb => colour.map(value => Math.round(Math.max(0, Math.min(255, value)) / 10) * 10) as Rgb;

// ---- the Unit -----------------------------------------------------------------

/** The life of the Unit: look for it, run the desk until it stops answering, look again. */
async function desk(): Promise<void> {
  for (;;) {
    let unit: Angle8 | undefined;
    try {
      unit = await Angle8.open(bus);                 // rejects while the Unit is not on Port A
      console.log("8Angle found on Port A");
      // What each LED was last told, to skip writes that change nothing. Empty: write them all.
      const written: string[] = [];
      let before = now();
      for (;;) {
        const start = now();
        const input = await unit.read();             // nine short reads; rejects when the Unit is pulled
        // A knob's reading wobbles by a count or two: keep the number until it really moves.
        state.knobs = input.knobs.map((position, index) => Math.abs(position * 255 - state.knobs[index]!) > 0.8 ? Math.round(position * 255) : state.knobs[index]!);
        state.dark = input.switch;
        const colours = lights(state.knobs.map(value => value / 255), start / 1e6, Math.min(0.2, (start - before) / 1e6)).map(steps);
        before = start;
        // The switch is the master: thrown, every LED goes off, whatever the knobs say.
        if (state.dark) for (const colour of colours) colour.fill(0);
        for (let index = 0; index < LEDS; ++index) {
          const [r, g, b] = colours[index]!, key = `${r},${g},${b}`;
          if (written[index] === key) continue;
          await unit.setLed(index, r, g, b);
          written[index] = key;
        }
        state.leds = colours.flat();
        state.status = Status.live;
        publish();
        await pace(start, 50_000);                   // twenty rounds a second
      }
    } catch (error) {
      if (state.status === Status.live) console.log(`8Angle gone: ${message(error)}`);
      state.status = Status.missing;
      publish();
      await sleep(400_000);
    } finally {
      unit?.close();                                 // a worker holds 8 handles: give this one back
    }
  }
}

async function main(): Promise<void> {
  await sleep(0);                                    // the clock starts with the first turn
  publish();
  await desk();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
