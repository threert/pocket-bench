// 测温枪: what the worker tells the UI, and what the UI asks of it.
// One snapshot record (13 of the channel's 256 bytes) and one command.
import { commands, record } from "./ui/channel";

/** What the worker knows about the NCIR. */
export const Status = {
  /** Nothing answers at 0x5A: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** Readings are coming in. */
  live: 1,
  /** The Unit answers but its readings fail their checksum. */
  fault: 2,
} as const;

/** 烫不烫: below WARM a drink has gone cold (凉了), up to HOT it is just right (正好喝), above HOT it burns (小心烫). */
export const WARM = 40, HOT = 50;

export const State = record({
  status: "u8",
  /** The surface the Unit looks at, °C. */
  object: "f32",
  /** The Unit's own temperature: the air around it, °C. */
  ambient: "f32",
  /** The highest object temperature since the app started or 重新记录 was pressed. */
  peak: "f32",
});

export const Command = commands({
  /** Forget the highest temperature: it starts again from the present reading. */
  resetPeak: {},
});
