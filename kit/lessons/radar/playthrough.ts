// How a player gets through 倒车雷达 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The distances are what
// the room sets on the Unit: 3584 mm to the far wall while nothing stands in
// front of it, and the yellow block between 2 and 18 cm.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "plug", do: [{ plug: "sonic" }, { set: ["sonic", "millimetres", 3584] }] },
  { step: "app", do: [{ solution: true }] },
  // The yellow block is put down in front of the Unit, 15 cm away.
  { step: "near", do: [{ set: ["sonic", "millimetres", 150] }] },
  // The solution already has the warning: the block is pushed on to 6 cm.
  { step: "warn", do: [{ set: ["sonic", "millimetres", 60] }] },
  // The block is taken away: the Unit sees the far wall again.
  { step: "back", do: [{ set: ["sonic", "millimetres", 3584] }] },
] satisfies Playthrough;
