// 桌面气象站: what the worker tells the UI. One snapshot record, 193 of the
// channel's 256 bytes.
import { record } from "./ui/channel";

/** What the worker knows about the ENV III. */
export const Status = {
  /** Nothing answers at 0x44 and 0x70: the Unit is not plugged in (or Port A has no power). */
  missing: 0,
  /** Readings are coming in. */
  live: 1,
  /** The Unit answers but its readings fail their checksum. */
  fault: 2,
} as const;

/** Seconds of history in the chart: one point a second. */
export const HISTORY = 60;
/** A second without a reading. */
export const GAP = -32768;

export const State = record({
  status: "u8",
  celsius: "f32",
  /** Relative humidity, percent. */
  humidity: "f32",
  pascals: "f32",
  /** The last minute of temperature, oldest first, in hundredths of a degree; GAP where there was none. */
  celsiusHistory: "i16[60]",
  /** The same minute of humidity, whole percent; 255 where there was none. */
  humidityHistory: "u8[60]",
});
