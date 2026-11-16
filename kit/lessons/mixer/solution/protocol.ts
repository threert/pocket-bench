// 调光台: what the worker tells the UI. One snapshot record, 37 of the
// channel's 256 bytes.
import { record } from "./ui/channel";

/** What the worker knows about the 8Angle. */
export const Status = {
  /** Nothing answers at 0x43: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** The knobs are being read and the LEDs driven. */
  live: 1,
} as const;

/** What each knob does, left to right. The first three mix the colour. */
export const Knob = { red: 0, green: 1, blue: 2, white: 3, spread: 4, flow: 5, breath: 6, sparkle: 7 } as const;

/** LED 0..7 sit under the knobs, LED 8 beside the switch. */
export const LEDS = 9;

export const State = record({
  status: "u8",
  /** The toggle switch is thrown: every LED is off until it is thrown back. */
  dark: "bool",
  /** The eight knobs, 0..255. */
  knobs: "u8[8]",
  /** The colour of each LED as the worker last set it: r, g, b for LED 0, then LED 1 ... (0..255). */
  leds: "u8[27]",
});
