// 厨房秤, the worker: finds the Mini Scales on Port A, reads the weight ten
// times a second, tares when the Unit's button or the screen's asks for it,
// judges the 凑重量 game and paints the Unit's LED: green on the target, amber
// when close, red otherwise. When the Unit is pulled it says so and keeps
// looking for it.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message, now, pace } from "./drivers/bus";
import { Scales } from "./drivers/scales";
import { Command, State, Status, TARGET, TOLERANCE } from "./protocol";

/** Microseconds between two readings. */
const PERIOD = 100_000;
/** The reading is steady when the last few differ by less than this many grams. */
const STEADY_SPAN = 0.6, STEADY_COUNT = 4;
/** "Close" for the LED and the ring: within this many grams of the target. */
const NEAR = 25;

const GREEN = [0, 200, 40], AMBER = [230, 120, 0], RED = [200, 16, 8];

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
/** The screen's 去皮 button was pressed: tare at the next reading. */
let tareAsked = false;

function publish(): void {
  channel.publish(State.encode(state));
}

/** The life of the scale: look for it, read it until it stops answering, look again. */
async function sense(): Promise<void> {
  for (;;) {
    let scale: Scales | undefined;
    try {
      scale = await Scales.open(bus);                 // rejects while the Unit is not on Port A
      console.log("Mini Scales found on Port A");
      // The Unit takes what is on its pan as zero when it gets power: nothing is tared yet.
      state.tare = 0;
      tareAsked = false;
      const recent: number[] = [];
      let pressed = false, led = "";
      for (;;) {
        const started = now();
        const { grams, button } = await scale.read();   // rejects when the Unit is pulled
        // The Unit's button counts once for each press, not for as long as it is held.
        const wanted = tareAsked || (button && !pressed);
        pressed = button;
        if (wanted) {
          tareAsked = false;
          await scale.tare();
          state.tare += grams;
          recent.length = 0;
          console.log(`tared ${grams.toFixed(1)} g away`);
          continue;                                   // read again at once: the display jumps to 0
        }

        recent.push(grams);
        if (recent.length > STEADY_COUNT) recent.shift();
        state.status = Status.live;
        state.grams = grams;
        state.steady = recent.length === STEADY_COUNT && Math.max(...recent) - Math.min(...recent) < STEADY_SPAN;
        // A weight that only passes 250 g on its way up does not win: it has to rest there.
        const inside = Math.abs(grams - TARGET) <= TOLERANCE;
        state.hit = inside && (state.hit || state.steady);
        publish();

        const colour = state.hit ? GREEN : Math.abs(grams - TARGET) <= NEAR ? AMBER : RED;
        if (colour.join() !== led) {                  // write the LED only when it changes
          await scale.setLed(colour[0]!, colour[1]!, colour[2]!);
          led = colour.join();
        }
        await pace(started, PERIOD);
      }
    } catch (error) {
      if (state.status === Status.live) console.log(`Mini Scales: ${message(error)}`);
      state.status = Status.missing;
      state.hit = false;
      state.steady = false;
      publish();
      await sleep(400_000);
    } finally {
      scale?.close();                                 // a worker holds 8 handles: give this one back
    }
  }
}

/** What the screen asks for. */
async function listen(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    if (Command.decode(bytes)?.name === "tare") tareAsked = true;
  }
}

async function main(): Promise<void> {
  await sleep(0);                                     // the clock starts with the first turn
  publish();
  void listen();
  await sense();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
