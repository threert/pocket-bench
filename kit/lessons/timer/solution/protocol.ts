// 番茄钟: what the worker tells the UI, and what the UI asks of it.
// One snapshot record (13 of the channel's 256 bytes) and two commands.
import { commands, record } from "./ui/channel";

/** What the worker knows about the Encoder. */
export const Status = {
  /** Nothing answers at 0x40: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** The knob is being read. */
  live: 1,
} as const;

/** Where the timer is. */
export const Phase = {
  /** 准备: the knob sets the minutes, a press starts. */
  ready: 0,
  /** 专注中: counting down. */
  focus: 1,
  /** 已暂停: a press goes on. */
  paused: 2,
  /** 休息一下: the time is up. */
  done: 3,
} as const;

/** The knob sets between this many minutes... */
export const MIN_MINUTES = 1, MAX_MINUTES = 60;
/** ...and starts at this many. */
export const DEFAULT_MINUTES = 25;

export const State = record({
  status: "u8",
  phase: "u8",
  /** What the knob set: the length of a session. */
  minutes: "u8",
  /** Seconds left of the session (the whole of it while the timer is ready). */
  remaining: "f32",
  /** What the Unit's two LEDs show right now: r, g, b of the first, then of the second. */
  leds: "u8[6]",
});

export const Command = commands({
  /** What a press of the knob does: start, pause, go on, or back to 准备 when the time is up. */
  press: {},
  /** Back to 准备 with the minutes that were set. */
  reset: {},
});
