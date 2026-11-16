// 接星星, the worker: reads the Joystick2 on Port A sixty times a second and
// publishes where the stick is; flashes the Unit's LED when the game asks
// for it (green for a catch, red for a miss) and keeps it dark otherwise.
// When the Unit is pulled it says so and keeps looking for it.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message, now, pace } from "./drivers/bus";
import { Joystick2 } from "./drivers/joystick2";
import { Command, State, Status } from "./protocol";

/** Microseconds between two readings: twice a frame, so every frame of the game has a fresh one. */
const PERIOD = 16_000;
/** A flash: the colour in full for this long, then a quarter of it for this long, then dark. Microseconds. */
const FLASH_FULL = 300_000, FLASH_DIM = 200_000;

type Rgb = [number, number, number];

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
/** The colour the game asked for since the last reading. */
let asked: Rgb | undefined;

function publish(): void {
  channel.publish(State.encode(state));
}

/** The life of the stick: look for it, read it until it stops answering, look again. */
async function sense(): Promise<void> {
  for (;;) {
    let stick: Joystick2 | undefined;
    try {
      stick = await Joystick2.open(bus);              // rejects while the Unit is not on Port A
      console.log("Joystick2 found on Port A");
      await stick.setLed(0, 0, 0);                    // dark between flashes, whatever the app before left
      asked = undefined;
      let held = (await stick.read()).button;
      // The flash in progress: its colour, when it began, and how far it is (0 dark, 1 full, 2 dim).
      let colour: Rgb = [0, 0, 0], since = 0, stage = 0;
      for (;;) {
        const started = now();
        const { x, y, button } = await stick.read();  // rejects when the Unit is pulled
        // A press counts once, when the stick goes down.
        if (button && !held) state.presses = (state.presses + 1) & 0xff;
        held = button;
        state.status = Status.live;
        state.x = x;
        state.y = y;
        state.held = button;
        publish();

        // The LED is written here and nowhere else, so its bytes never mix with a reading's.
        if (asked) {
          colour = asked; asked = undefined; since = started; stage = 1;
          await stick.setLed(colour[0], colour[1], colour[2]);
        } else if (stage === 1 && started - since >= FLASH_FULL) {
          stage = 2;
          await stick.setLed(colour[0] / 4, colour[1] / 4, colour[2] / 4);
        } else if (stage === 2 && started - since >= FLASH_FULL + FLASH_DIM) {
          stage = 0;
          await stick.setLed(0, 0, 0);
        }
        await pace(started, PERIOD);
      }
    } catch (error) {
      if (state.status === Status.live) console.log(`Joystick2: ${message(error)}`);
      state.status = Status.missing;
      state.x = state.y = 0;
      state.held = false;
      publish();
      await sleep(400_000);
    } finally {
      stick?.close();                                 // a worker holds 8 handles: give this one back
    }
  }
}

/** What the game asks for. */
async function listen(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    const command = Command.decode(bytes);
    if (command?.name === "flash") asked = [command.r, command.g, command.b];
  }
}

async function main(): Promise<void> {
  await sleep(0);                                     // the clock starts with the first turn
  publish();
  void listen();
  await sense();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
