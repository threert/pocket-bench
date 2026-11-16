// 门禁打卡: what the worker tells the UI. One snapshot record, 55 of the
// channel's 256 bytes.
import { record } from "./ui/channel";

/** Which card it is. The names are the UI's: only this number travels. */
export const Who = { unknown: 0, staff: 1, visitor: 2 } as const;

/** What the door said to a card. */
export const Verdict = { none: 0, granted: 1, refused: 2 } as const;

/** Relay channels of the 4-Relay in the room, counted from 0: the "ON AIR" sign and the amber beacon. */
export const SIGN = 2, BEACON = 3;
/** Seconds the sign stays on for a card that is let in, and the beacon for one that is not. */
export const SIGN_SECONDS = 3, BEACON_SECONDS = 2;

/** How many swipes the log keeps. */
export const LOG = 5;

export const State = record({
  /** The RFID 2 answers on Port A. */
  reader: "bool",
  /** The 4-Relay answers on Port A. Without it the door still reads cards. */
  relay: "bool",
  /** The worker's clock in seconds: the UI counts "12 秒前" from it. */
  now: "f32",
  /** How many cards were swiped since the start. A change means "a new swipe": the UI animates. */
  swipes: "u16",
  /** The swipe on show: Verdict.none while the screen says 请刷卡. */
  verdict: "u8",
  who: "u8",
  /** The card's UID, 4 or 7 bytes. */
  uid: "u8[7]",
  uidBytes: "u8",
  /** When that card was swiped (seconds of the worker's clock). */
  at: "f32",
  /** The relays as the worker last set them. */
  sign: "bool",
  beacon: "bool",
  /** The last swipes, newest first: who, the verdict, when. `logged` of them are real. */
  logged: "u8",
  logWho: "u8[5]",
  logVerdict: "u8[5]",
  logAt: "f32[5]",
});
