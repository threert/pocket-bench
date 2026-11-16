// Port A of the Tab5 (the red Grove socket: G53 SDA, G54 SCL, 5 V) through
// the worker's `porta` I2C node. The app's pocket.app.json declares the node:
//   "domains": { "worker": { "entry": "worker.ts", "nodes": [{ "name": "porta", "kind": "i2c" }] } }
// and the UI switches the socket's 5 V on: setSwitch("ext-5v", true) from
// "@pocketjs/framework/device". Without it no unit answers.
//
// A worker holds 8 open handles and 8 requests in flight in all, and one
// script carries at most 1024 bytes. A unit driver keeps one handle per
// address; probing opens four at a time and closes them again.
//
// Adapted from pocket-m5, apps/unit-swap/units/bus.ts (MIT, Pocket Nexus).
import { io, ResourceError, ResourceStatus, type I2CDevice } from "@pocketjs/framework/io";
import { bytes, receive, write, type I2CStep } from "@pocketjs/framework/io/i2c";
import { nowMicros, sleep } from "@pocketjs/framework/worker";

const PROBE_BATCH = 4;

/** A transaction that did not go through: the unit was unplugged, has no
 *  power, or refused the bytes. `status` is the worker's ResourceStatus. */
export class BusError extends Error {
  constructor(readonly address: number, readonly status: number, what: string) {
    super(`${what}: nothing answered at ${hex(address)} on Port A (status ${status})`);
    this.name = "BusError";
  }
}

export class PortA {
  constructor(readonly node = "porta") {}

  /** Opens a handle to one address. While all 8 handles are taken it waits
   *  2 ms and tries again (a closed handle is released a moment later). */
  async open(address: number, name = "I2C device", timeoutMillis = 25): Promise<Device> {
    for (let attempt = 0; ; ++attempt) {
      try {
        return new Device(address, name, io.i2c(this.node).open({ address, timeoutMillis }));
      } catch (error) {
        if (attempt >= 100 || !message(error).endsWith(`: ${ResourceStatus.busy}`)) throw error;
        await sleep(2000);
      }
    }
  }

  /** Which of the addresses acknowledge, ascending: what an I2C scan does. */
  async probe(addresses: readonly number[]): Promise<number[]> {
    const answered: number[] = [];
    for (let start = 0; start < addresses.length; start += PROBE_BATCH) {
      const batch: Device[] = [];
      for (const address of addresses.slice(start, start + PROBE_BATCH)) batch.push(await this.open(address, "probe", 5));
      const results = await Promise.all(batch.map(device => device.probe()));
      batch.forEach((device, index) => {
        device.close();
        if (results[index]) answered.push(device.address);
      });
    }
    return answered.sort((a, b) => a - b);
  }

  /** Whether all of the addresses acknowledge. */
  async has(addresses: readonly number[]): Promise<boolean> {
    return (await this.probe(addresses)).length === addresses.length;
  }

  /** Every address that answers, 0x08..0x77. */
  scan(): Promise<number[]> {
    return this.probe(Array.from({ length: 0x78 - 0x08 }, (_, index) => 0x08 + index));
  }
}

export class Device {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly address: number, readonly name: string, private readonly handle: I2CDevice) {}

  /** One script: its steps run as one transaction, a repeated START between
   *  them and one STOP at the end. Resolves with the bytes read. Rejects with
   *  a BusError when the unit does not answer. */
  async run(script: readonly I2CStep[], timeoutMillis?: number): Promise<Uint8Array> {
    for (let attempt = 0; ; ++attempt) {
      try {
        return await this.handle.run(script, timeoutMillis ? { timeoutMillis } : undefined);
      } catch (error) {
        if (!(error instanceof ResourceError)) throw error;
        // The request table was full: nothing was sent. Wait a moment and submit again.
        if (error.request < 0 && error.status === ResourceStatus.busy && attempt < 100) { await sleep(1000); continue; }
        throw new BusError(this.address, error.status, this.name);
      }
    }
  }

  /** Reads `length` bytes from `register` in two transactions: the register
   *  byte, STOP, then a bare read. The STM32 inside M5Stack's own units
   *  prepares its answer when the first transaction ends. */
  select(register: number, length: number): Promise<Uint8Array> {
    return this.exclusive(() => this.selectNow(register, length));
  }
  /** select() for a task that already runs inside exclusive(). */
  async selectNow(register: number, length: number): Promise<Uint8Array> {
    await this.run([write(register)]);
    return this.run([receive([bytes(length)])]);
  }

  /** Runs `task` after the tasks queued before it, so that the transactions
   *  of two operations on one unit never interleave. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Whether the address acknowledges. */
  async probe(): Promise<boolean> {
    for (let attempt = 0; ; ++attempt) {
      try {
        return await this.handle.probe();
      } catch (error) {
        if (attempt >= 100) throw error;
        await sleep(1000);
      }
    }
  }

  close(): void {
    this.handle.close();
  }
}

/** What a driver's `open` does with `identify`: the unit, or an Error that
 *  says what is missing. */
export async function found<T>(name: string, addresses: readonly number[], unit: Promise<T | undefined>): Promise<T> {
  const result = await unit;
  if (!result) throw new Error(`${name} is not on Port A (expected at ${addresses.map(hex).join(" and ")})`);
  return result;
}

export function hex(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The worker's clock in microseconds (latched once a turn). */
export function now(): number {
  return nowMicros() ?? 0;
}

/** Sleeps until `start + period` microseconds, at least 1 ms: the pause at
 *  the end of a sampling loop. */
export function pace(start: number, period: number): Promise<void> {
  return sleep(Math.max(1000, Math.round(start + period - now())));
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** A colour channel as a byte. */
export const channel = (value: number) => clamp(Math.round(value), 0, 255);
