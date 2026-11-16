// The worker the unit tests run: every kit driver behind one command
// channel. A record on `call` is {id, unit, method, args} as JSON; the answer
// is a console line "@reply {id, ok | error}".
import { io, utf8Text } from "@pocketjs/framework/io";
import { PortA } from "../../../kit/drivers/bus";
import { Angle8 } from "../../../kit/drivers/angle8";
import { DLight } from "../../../kit/drivers/dlight";
import { Encoder } from "../../../kit/drivers/encoder";
import { Env3 } from "../../../kit/drivers/env3";
import { Joystick2 } from "../../../kit/drivers/joystick2";
import { Ncir } from "../../../kit/drivers/ncir";
import { Relay4 } from "../../../kit/drivers/relay4";
import { Rfid2 } from "../../../kit/drivers/rfid2";
import { Scales } from "../../../kit/drivers/scales";
import { Sonic } from "../../../kit/drivers/sonic";

type Methods = Record<string, (...args: unknown[]) => unknown>;
interface Driver { readonly ADDRESSES: readonly number[]; identify(bus: PortA): Promise<unknown>; open(bus: PortA): Promise<unknown> }

const bus = new PortA();
const DRIVERS: Record<string, Driver> = {
  env3: Env3, sonic: Sonic, rfid2: Rfid2, angle8: Angle8, joystick2: Joystick2, encoder: Encoder, dlight: DLight, ncir: Ncir, scales: Scales, relay4: Relay4,
};
const open: Record<string, Methods> = {};

/** {bytes: [...]} in the arguments stands for a Uint8Array. */
function revive(value: unknown): unknown {
  const bytes = (value as { bytes?: number[] } | null)?.bytes;
  return Array.isArray(bytes) ? Uint8Array.from(bytes) : value;
}

async function call(unit: string, method: string, args: unknown[]): Promise<unknown> {
  if (unit === "bus") return (bus as unknown as Methods)[method]!(...args);
  const driver = DRIVERS[unit];
  if (!driver) throw new Error(`no driver ${unit}`);
  if (method === "ADDRESSES") return driver.ADDRESSES;
  if (method === "identify" || method === "open") {
    open[unit]?.close!();
    delete open[unit];
    const found = await driver[method](bus);
    if (found) open[unit] = found as Methods;
    return !!found;
  }
  const target = open[unit];
  if (!target) throw new Error(`${unit} is not open`);
  const result = await target[method]!(...args.map(revive));
  if (method === "close") delete open[unit];
  return result;
}

async function main(): Promise<void> {
  for await (const record of io.channel("call").observe()) {
    const { id, unit, method, args } = JSON.parse(utf8Text(record)) as { id: number; unit: string; method: string; args: unknown[] };
    let reply: Record<string, unknown>;
    try {
      reply = { id, ok: await call(unit, method, args) };
    } catch (error) {
      reply = { id, error: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.name : "" };
    }
    console.log(`@reply ${JSON.stringify(reply, (_key, value) => (value instanceof Uint8Array ? Array.from(value) : value))}`);
  }
}
void main();
