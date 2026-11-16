// 接星星: what the worker tells the UI, and what the UI asks of it. The
// game itself runs in the UI, on the screen's 30 frames a second; the worker
// is its hands: the stick in, the LED out.
// One snapshot record (11 of the channel's 256 bytes) and one command.
import { commands, record } from "./ui/channel";

/** What the worker knows about the Joystick2. */
export const Status = {
  /** Nothing answers at 0x63: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** The stick is being read. */
  live: 1,
} as const;

export const State = record({
  status: "u8",
  /** The stick, -1..1: left to right, and towards the player to away. Exactly 0 at rest. */
  x: "f32",
  y: "f32",
  /** The stick is pressed down right now. */
  held: "bool",
  /** Counts the presses (it wraps at 256): a press shorter than a frame is not lost. */
  presses: "u8",
});

export const Command = commands({
  /** Flash the Unit's LED in this colour for half a second: green for a catch, red for a miss. */
  flash: { r: "u8", g: "u8", b: "u8" },
});
