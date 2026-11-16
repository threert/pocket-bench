// 倒车雷达: what the worker tells the UI. One snapshot record, 10 of the
// channel's 256 bytes.
import { record } from "./ui/channel";

/** What the worker knows about the Ultrasonic Unit. */
export const Status = {
  /** Nothing answers at 0x57: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** Echoes are coming in. */
  live: 1,
} as const;

export const State = record({
  status: "u8",
  /** False when the echo is outside the module's 20 mm .. 4.5 m: there is no distance to show. */
  inRange: "bool",
  /** Distance to the nearest thing in front of the Unit, millimetres. */
  millimetres: "f32",
  /** How fast it changes, millimetres a second: negative while something comes closer. */
  speed: "f32",
});

/** Centimetres, the unit the screen speaks. */
export const TOO_CLOSE = 10, DANGER = 20, CAUTION = 50;
