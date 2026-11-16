// What travels between worker.ts and main.tsx, written once for both.
// `state` is the worker's newest picture of the world (a snapshot channel:
// the UI always reads the latest one). `commands` carries what the UI asks
// the worker to do (a ring: every command arrives, in order).
// Sizes: pocket.app.json gives `state` 256 bytes and `commands` 64 bytes;
// State.bytes and Command.bytes must fit.
import { commands, record } from "./ui/channel";

export const State = record({
  /** Counts the records published: the UI sees the worker is alive. */
  ticks: "u32",
  /** Seconds since the worker started. */
  uptime: "f32",
  /** How many I2C addresses answer on Port A, and the first eight of them. */
  found: "u8",
  addresses: "u8[8]",
});

export const Command = commands({
  /** Scan Port A now instead of waiting for the next second. */
  scan: {},
});
