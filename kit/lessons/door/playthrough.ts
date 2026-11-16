// How a player gets through 门禁打卡 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The cards are the
// room's: 员工卡 04 A3 1B 7C and 访客卡 9E 12 55 0D, each as the room reports it
// while it rests on the reader.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

const STAFF = { uid: [0x04, 0xa3, 0x1b, 0x7c], kind: "classic1k" };
const VISITOR = { uid: [0x9e, 0x12, 0x55, 0x0d], kind: "classic1k" };

export default [
  { step: "plug", do: [{ plug: "rfid2" }, { plug: "relay4" }] },
  // The staff card is put on the reader once the app runs.
  { step: "read", do: [{ solution: true }, { set: ["rfid2", "card", STAFF] }] },
  // The solution already has the rule: that same swipe is welcomed and lights the sign for 3 s.
  { step: "welcome", do: [] },
  // The staff card back to the rack, the visitor's card on the reader.
  { step: "refuse", do: [{ set: ["rfid2", "card", null] }, { wait: 1 }, { set: ["rfid2", "card", VISITOR] }] },
  // The solution already keeps the log: both swipes are in it.
  { step: "log", do: [] },
] satisfies Playthrough;
