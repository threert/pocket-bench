// How a player gets through 调光台 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). A new 8Angle reports
// every knob at the middle; the room sends all eight positions whenever one
// knob is dragged.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "plug", do: [{ plug: "angle8" }] },
  { step: "app", do: [{ solution: true }] },
  // The first knob to the end; the room has the others at their left stop.
  { step: "red", do: [{ set: ["angle8", "knobs", [1, 0, 0, 0, 0, 0, 0, 0]] }] },
  // The solution already has the master switch: thrown for two seconds, then thrown back.
  { step: "blackout", do: [{ set: ["angle8", "switch", 1] }, { wait: 2 }, { set: ["angle8", "switch", 0] }] },
] satisfies Playthrough;
