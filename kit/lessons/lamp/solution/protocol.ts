// 智能台灯: what travels between the worker and the UI. The state is one
// snapshot record, 128 of the channel's 256 bytes; the commands are one byte.
import { commands, record } from "./ui/channel";

/** Relay channel of the desk lamp, counted from 0 (CH1 on the case). */
export const LAMP = 0;
/** Automatic mode: the lamp goes on below ON_BELOW lux and off only above OFF_ABOVE. Between
 *  the two it stays as it is, so it does not flicker when the light hovers around one limit
 *  (the lamp's own light raises the reading a little, too). */
export const ON_BELOW = 50, OFF_ABOVE = 150;

/** Seconds of history in the chart: one point a second. */
export const HISTORY = 60;
/** A second without a reading. */
export const GAP = 65535;

export const State = record({
  /** The DLight answers on Port A. */
  sensor: "bool",
  /** The 4-Relay answers on Port A. */
  relay: "bool",
  /** Light on the sensor, lux. */
  lux: "f32",
  /** The lamp's relay as the worker last set it. */
  on: "bool",
  /** True: the light decides. False: the person did, with the switch on the screen. */
  auto: "bool",
  /** The last minute of lux, oldest first, whole lux; GAP where there was no reading. */
  history: "u16[60]",
});

export const Command = commands({
  /** The switch on the screen: turns the lamp the other way and leaves automatic mode. */
  toggle: {},
  /** Back to automatic mode. */
  auto: {},
});
