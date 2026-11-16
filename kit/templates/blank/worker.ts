// The worker: the only place that talks to hardware. It runs beside the UI,
// reads the Units on Port A through drivers/, and publishes what it knows on
// the `state` channel. Here it only scans Port A once a second and says
// which I2C addresses answer.
import { io } from "@pocketjs/framework/io";
import { sleep } from "@pocketjs/framework/worker";
import { PortA, hex, message, now } from "./drivers/bus";
import { Command, State } from "./protocol";

const bus = new PortA();
const stateChannel = io.channel("state");
const state = State.empty();
let startedAt = 0;

function publish(): void {
  state.ticks += 1;
  state.uptime = (now() - startedAt) / 1e6;
  stateChannel.publish(State.encode(state));
}

/** Which addresses answer on Port A. Nothing answers while EXT 5V is off (the UI switches it on). */
async function scan(): Promise<void> {
  const answering = await bus.scan();
  const before = state.addresses.slice(0, state.found).join(",");
  state.found = Math.min(answering.length, 255);
  state.addresses = [...answering.slice(0, 8), 0, 0, 0, 0, 0, 0, 0, 0].slice(0, 8);
  if (answering.join(",") !== before) console.log(answering.length ? `Port A: ${answering.map(hex).join(" ")} answer` : "Port A: nothing answers");
}

async function scanLoop(): Promise<void> {
  for await (const _ of io.timer(1_000_000)) await scan().catch(error => console.log(`scan: ${message(error)}`));
}

async function publishLoop(): Promise<void> {
  for await (const _ of io.timer(250_000)) publish();
}

async function commandLoop(): Promise<void> {
  for await (const bytes of io.channel("commands").observe()) {
    const command = Command.decode(bytes);
    if (command?.name === "scan") await scan().catch(error => console.log(`scan: ${message(error)}`));
  }
}

async function main(): Promise<void> {
  // The clock starts with the first turn.
  await sleep(0);
  startedAt = now();
  publish();
  void scanLoop();
  void publishLoop();
  void commandLoop();
}
void main().catch(error => console.log(`worker: ${message(error)}`));
