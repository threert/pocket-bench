// 厨房秤: what the worker tells the UI, and what the UI asks of it.
// One snapshot record (11 of the channel's 256 bytes) and one command.
import { commands, record } from "./ui/channel";

/** What the worker knows about the Mini Scales. */
export const Status = {
  /** Nothing answers at 0x26: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** Readings are coming in. */
  live: 1,
} as const;

/** The game: put this many grams on the pan... */
export const TARGET = 250;
/** ...give or take this many. */
export const TOLERANCE = 5;

export const State = record({
  status: "u8",
  /** What the display shows: the load on the pan minus what was tared away. */
  grams: "f32",
  /** Grams tared away since the Unit was found (a mug: 310). */
  tare: "f32",
  /** The reading has stopped moving. */
  steady: "bool",
  /** The reading rests within TOLERANCE of TARGET: the game is won, the Unit's LED is green. */
  hit: "bool",
});

export const Command = commands({
  /** Make the present load 0 g, as the Unit's own button does. */
  tare: {},
});
