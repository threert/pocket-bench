// 番茄钟, the worker: the Encoder on Port A is the timer's crown. Turning it
// sets the minutes (while the timer is ready), a press starts and pauses the
// countdown, and its two LEDs show how it goes: green while counting down,
// dimmer as the time runs out (the second LED fades over the first half of
// the session, the first over the second half), amber while paused, a red
// blink when the time is up. When the Unit is pulled the countdown pauses
// and the worker keeps looking for it.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, clamp, message, now, pace } from "./drivers/bus";
import { Encoder } from "./drivers/encoder";
import { Command, DEFAULT_MINUTES, MAX_MINUTES, MIN_MINUTES, Phase, State, Status } from "./protocol";

/** Microseconds between two looks at the knob: 25 a second, so a short press is not missed. */
const PERIOD = 40_000;
/** Half a period of the red blink when the time is up, microseconds. */
const BLINK = 400_000;

type Rgb = [number, number, number];
const OFF: Rgb = [0, 0, 0], BLUE: Rgb = [0, 24, 72], AMBER: Rgb = [200, 110, 0], RED: Rgb = [220, 0, 0];

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
state.minutes = DEFAULT_MINUTES;
state.remaining = DEFAULT_MINUTES * 60;
/** What the screen's buttons asked for since the last look at the knob. */
let pressAsked = false, resetAsked = false;

function publish(): void {
  channel.publish(State.encode(state));
}

/** A press of the knob (or of the screen's button). */
function press(): void {
  if (state.phase === Phase.ready) { state.phase = Phase.focus; state.remaining = state.minutes * 60; }
  else if (state.phase === Phase.focus) state.phase = Phase.paused;
  else if (state.phase === Phase.paused) state.phase = Phase.focus;
  else reset();
}

function reset(): void {
  state.phase = Phase.ready;
  state.remaining = state.minutes * 60;
}

/** The colours of the two LEDs at this moment. */
function leds(at: number): [Rgb, Rgb] {
  switch (state.phase) {
    case Phase.focus: {
      // 1 at the start of the session, 0 at its end. Steps of 4 keep the writes few.
      const left = clamp(state.remaining / (state.minutes * 60), 0, 1);
      const level = (share: number) => Math.round(share * 46) * 4;
      return [[0, 16 + level(Math.min(1, left * 2)), 0], [0, level(Math.max(0, left * 2 - 1)), 0]];
    }
    case Phase.paused: return [AMBER, AMBER];
    case Phase.done: return Math.floor(at / BLINK) % 2 === 0 ? [RED, RED] : [OFF, OFF];
    default: return [BLUE, BLUE];
  }
}

/** The life of the knob: look for it, read it until it stops answering, look again. */
async function sense(): Promise<void> {
  for (;;) {
    let knob: Encoder | undefined;
    try {
      knob = await Encoder.open(bus);                 // rejects while the Unit is not on Port A
      console.log("Encoder found on Port A");
      // The Unit counts detents from the moment it is opened; its LEDs are dark after it got power.
      let steps = 0, held = (await knob.read()).button, last = now();
      const written = ["", ""];
      pressAsked = resetAsked = false;
      state.status = Status.live;
      for (;;) {
        const started = now();
        const reading = await knob.read();            // rejects when the Unit is pulled

        // Turning sets the minutes, but only while the timer waits: a nudge during a session changes nothing.
        const turned = reading.steps - steps;
        steps = reading.steps;
        if (turned && state.phase === Phase.ready) {
          state.minutes = clamp(state.minutes + turned, MIN_MINUTES, MAX_MINUTES);
          state.remaining = state.minutes * 60;
        }
        // A press counts once, when the knob goes down.
        if ((reading.button && !held) || pressAsked) press();
        if (resetAsked) reset();
        held = reading.button;
        pressAsked = resetAsked = false;

        // The countdown runs on the worker's clock, whatever the loop's pace.
        const at = now();
        if (state.phase === Phase.focus) {
          state.remaining -= (at - last) / 1e6;
          if (state.remaining <= 0) { state.remaining = 0; state.phase = Phase.done; console.log("time is up"); }
        }
        last = at;

        // Each LED is written only when its colour changes.
        const colours = leds(at);
        for (const index of [0, 1] as const) {
          const colour = colours[index];
          if (colour.join() === written[index]) continue;
          await knob.setLed(index === 0 ? 1 : 2, colour[0], colour[1], colour[2]);
          written[index] = colour.join();
        }
        state.leds = [...colours[0], ...colours[1]];
        publish();
        await pace(started, PERIOD);
      }
    } catch (error) {
      if (state.status === Status.live) console.log(`Encoder: ${message(error)}`);
      state.status = Status.missing;
      // Nobody can pause a timer whose knob is gone: it waits for the knob to come back.
      if (state.phase === Phase.focus) state.phase = Phase.paused;
      publish();
      await sleep(400_000);
    } finally {
      knob?.close();                                  // a worker holds 8 handles: give this one back
    }
  }
}

/** What the screen asks for. */
async function listen(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    const command = Command.decode(bytes);
    if (command?.name === "press") pressAsked = true;
    else if (command?.name === "reset") resetAsked = true;
  }
}

async function main(): Promise<void> {
  await sleep(0);                                     // the clock starts with the first turn
  publish();
  void listen();
  await sense();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
