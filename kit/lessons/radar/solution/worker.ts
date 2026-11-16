// 倒车雷达, the worker: finds the Ultrasonic Unit on Port A, measures about
// seven times a second and publishes the distance. When the Unit is pulled
// it says so and keeps looking for it.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message, now } from "./drivers/bus";
import { Sonic, median } from "./drivers/sonic";
import { State, Status } from "./protocol";

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();

function publish(): void {
  channel.publish(State.encode(state));
}

/** The life of the sensor: look for it, measure until it stops answering, look again. */
async function sense(): Promise<void> {
  for (;;) {
    let sonic: Sonic | undefined;
    try {
      sonic = await Sonic.open(bus);                 // rejects while the Unit is not on Port A
      console.log("Ultrasonic found on Port A");
      // The last five echoes: their median drops a stray one and steadies the last digit.
      const recent: number[] = [];
      // Where the target was over the last second, to tell how fast it moves.
      const trail: { millimetres: number; at: number }[] = [];
      for (;;) {
        const millimetres = await sonic.read();      // 120 ms; rejects when the Unit is pulled
        state.status = Status.live;
        state.inRange = millimetres !== undefined;
        if (millimetres === undefined) {
          // Nothing within 4.5 m (or something closer than 2 cm): forget the old echoes.
          recent.length = 0; trail.length = 0; state.speed = 0;
        } else {
          recent.push(millimetres);
          if (recent.length > 5) recent.shift();
          state.millimetres = median(recent);
          trail.push({ millimetres: state.millimetres, at: now() });
          while (trail.length > 1 && now() - trail[0]!.at > 1_000_000) trail.shift();
          const seconds = (now() - trail[0]!.at) / 1e6;
          state.speed = seconds > 0.4 ? (state.millimetres - trail[0]!.millimetres) / seconds : 0;
        }
        publish();
        await sleep(20_000);
      }
    } catch (error) {
      if (state.status === Status.live) console.log(`Ultrasonic gone: ${message(error)}`);
      state.status = Status.missing;
      state.speed = 0;
      publish();
      await sleep(400_000);
    } finally {
      sonic?.close();                                // a worker holds 8 handles: give this one back
    }
  }
}

async function main(): Promise<void> {
  await sleep(0);                                    // the clock starts with the first turn
  publish();
  await sense();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
