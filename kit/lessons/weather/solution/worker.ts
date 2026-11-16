// 桌面气象站, the worker: finds the ENV III on Port A, reads it twice a
// second and publishes the reading with the last minute of history. When the
// Unit is pulled it says so and keeps looking for it.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { BusError, PortA, message } from "./drivers/bus";
import { Env3 } from "./drivers/env3";
import { GAP, HISTORY, State, Status } from "./protocol";

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
state.celsiusHistory.fill(GAP);
state.humidityHistory.fill(255);

function publish(): void {
  channel.publish(State.encode(state));
}

/** The life of the sensor: look for it, read it until it stops answering, look again. */
async function sense(): Promise<void> {
  for (;;) {
    let env: Env3;
    try {
      env = await Env3.open(bus);
    } catch {
      // Not on the port (or EXT 5V is still off right after the start).
      if (state.status !== Status.missing) { state.status = Status.missing; publish(); }
      await sleep(400_000);
      continue;
    }
    console.log("ENV III found on Port A");
    for (let failures = 0; failures < 3;) {
      try {
        const reading = await env.read();
        state.celsius = reading.celsius;
        state.humidity = reading.humidity;
        state.pascals = reading.pascals;
        state.status = Status.live;
        failures = 0;
      } catch (error) {
        ++failures;
        // No answer at all means the Unit is gone; anything else is a bad reading.
        if (error instanceof BusError) failures = 3; else state.status = Status.fault;
        console.log(`ENV III: ${message(error)}`);
      }
      publish();
      await sleep(500_000);
    }
    env.close();
    state.status = Status.missing;
    publish();
    console.log("ENV III gone: looking for it again");
  }
}

/** One point a second, whether there is a reading or not, so the chart shows the gap too. */
async function remember(): Promise<void> {
  for await (const _ of io.timer(1_000_000)) {
    const live = state.status === Status.live;
    state.celsiusHistory = [...state.celsiusHistory.slice(1 - HISTORY), live ? Math.round(state.celsius * 100) : GAP];
    state.humidityHistory = [...state.humidityHistory.slice(1 - HISTORY), live ? Math.round(state.humidity) : 255];
    publish();
  }
}

async function main(): Promise<void> {
  await sleep(0);
  publish();
  void remember();
  await sense();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
