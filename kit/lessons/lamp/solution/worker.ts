// 智能台灯, the worker. Two Units share Port A and each has its own loop:
//
//   the DLight    is read five times a second. In automatic mode its reading decides whether
//                 the lamp should be on: on below 50 lx, off above 150 lx, unchanged in between.
//   the 4-Relay   switches the desk lamp on its first channel to what was decided, by the
//                 light or by the person.
//
// Either Unit may be missing or pulled while the app runs: its loop says so and keeps looking.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, message } from "./drivers/bus";
import { DLight } from "./drivers/dlight";
import { Relay4 } from "./drivers/relay4";
import { Command, GAP, HISTORY, LAMP, OFF_ABOVE, ON_BELOW, State } from "./protocol";

const bus = new PortA();
const channel = io.channel("state");
const state = State.empty();
state.auto = true;
state.history.fill(GAP);

/** Whether the lamp should be on. undefined: nobody has decided yet, the relay stays as it was found. */
let wanted: boolean | undefined;

function publish(): void {
  channel.publish(State.encode(state));
}

/** Automatic mode's rule, with its two limits. */
function decide(): void {
  if (!state.auto || !state.sensor) return;
  if (state.lux < ON_BELOW) wanted = true;
  else if (state.lux > OFF_ABOVE) wanted = false;
}

/** The life of the light sensor: look for it, read it until it stops answering, look again. */
async function sensor(): Promise<void> {
  for (;;) {
    let light: DLight | undefined;
    try {
      light = await DLight.open(bus);                // rejects while the Unit is not on Port A
      console.log("DLight found on Port A");
      for (;;) {
        state.lux = await light.read();              // rejects when the Unit is pulled
        state.sensor = true;
        decide();
        publish();
        await sleep(200_000);
      }
    } catch (error) {
      if (state.sensor) console.log(`DLight gone: ${message(error)}`);
      state.sensor = false;
      publish();
      await sleep(400_000);
    } finally {
      light?.close();                                // a worker holds 8 handles: give this one back
    }
  }
}

/** The life of the relays: look for the Unit, keep the lamp as it should be, look again. */
async function relays(): Promise<void> {
  for (;;) {
    let unit: Relay4 | undefined;
    try {
      unit = await Relay4.open(bus);                 // rejects while the Unit is not on Port A
      console.log("4-Relay found on Port A");
      state.on = (await unit.read())[LAMP]!;
      state.relay = true;
      publish();
      for (let round = 0; ; ++round) {
        if (wanted !== undefined && wanted !== state.on) {
          await unit.set(LAMP, wanted);              // the relay clicks
          state.on = wanted;
          console.log(`lamp ${wanted ? "on" : "off"} (${state.auto ? "automatic" : "by hand"}, ${state.lux.toFixed(0)} lx)`);
          publish();
        }
        // Nothing to switch most of the time: a read twice a second notices a Unit that was pulled.
        if (round % 10 === 0) await unit.read();
        await sleep(50_000);
      }
    } catch (error) {
      if (state.relay) console.log(`4-Relay gone: ${message(error)}`);
      state.relay = false;
      publish();
      await sleep(400_000);
    } finally {
      unit?.close();
    }
  }
}

/** What the screen asks for. */
async function listen(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    const command = Command.decode(bytes);
    if (command?.name === "toggle") {
      // A hand on the switch overrides the light until 切回自动.
      state.auto = false;
      wanted = !(wanted ?? state.on);
    } else if (command?.name === "auto") {
      state.auto = true;
      decide();
    }
    publish();
  }
}

/** One point a second, whether there is a reading or not, so the chart shows the gap too. */
async function remember(): Promise<void> {
  for await (const _ of io.timer(1_000_000)) {
    state.history = [...state.history.slice(1 - HISTORY), state.sensor ? Math.min(GAP - 1, Math.round(state.lux)) : GAP];
    publish();
  }
}

async function main(): Promise<void> {
  await sleep(0);                                    // the clock starts with the first turn
  publish();
  void sensor();
  void relays();
  void listen();
  void remember();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
