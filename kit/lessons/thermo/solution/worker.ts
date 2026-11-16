// 测温枪, the worker: finds the NCIR on Port A, reads the object and the
// ambient temperature five times a second and remembers the highest object
// temperature. When the Unit is pulled it says so and keeps looking for it.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { BusError, PortA, message } from "./drivers/bus";
import { Ncir } from "./drivers/ncir";
import { Command, State, Status } from "./protocol";

/** Microseconds between two readings. */
const PERIOD = 200_000;

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
/** No reading yet (or 重新记录 was pressed): the next one is the highest so far. */
let freshPeak = true;

function publish(): void {
  channel.publish(State.encode(state));
}

/** The life of the sensor: look for it, read it until it stops answering, look again. */
async function sense(): Promise<void> {
  for (;;) {
    let ncir: Ncir;
    try {
      ncir = await Ncir.open(bus);                    // rejects while the Unit is not on Port A
    } catch {
      if (state.status !== Status.missing) { state.status = Status.missing; publish(); }
      await sleep(400_000);
      continue;
    }
    console.log("NCIR found on Port A");
    for (let failures = 0; failures < 3;) {
      try {
        const { objectCelsius, ambientCelsius } = await ncir.read();
        state.object = objectCelsius;
        state.ambient = ambientCelsius;
        state.peak = freshPeak ? objectCelsius : Math.max(state.peak, objectCelsius);
        freshPeak = false;
        state.status = Status.live;
        failures = 0;
      } catch (error) {
        ++failures;
        // No answer at all means the Unit is gone; anything else is a bad reading (a checksum, the sensor's error flag).
        if (error instanceof BusError) failures = 3; else state.status = Status.fault;
        console.log(`NCIR: ${message(error)}`);
      }
      publish();
      await sleep(PERIOD);
    }
    ncir.close();                                     // a worker holds 8 handles: give this one back
    state.status = Status.missing;
    publish();
    console.log("NCIR gone: looking for it again");
  }
}

/** What the screen asks for. */
async function listen(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    if (Command.decode(bytes)?.name === "resetPeak") {
      // With the Unit there the highest is what it reads now; without it, the next reading.
      if (state.status === Status.live) state.peak = state.object; else freshPeak = true;
      publish();
    }
  }
}

async function main(): Promise<void> {
  await sleep(0);                                     // the clock starts with the first turn
  publish();
  void listen();
  await sense();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
