// How a player gets through 智能台灯 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The lux values are the
// room's: 582 with its lights on, 12 with them off, and 22 more while the
// desk lamp is lit.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "plug", do: [{ plug: "dlight" }, { plug: "relay4" }, { set: ["dlight", "lux", 582] }] },
  { step: "app", do: [{ solution: true }] },
  // The switch on the screen: the relay closes, the lamp adds its light.
  { step: "manual", do: [{ tapText: "^开灯$" }, { set: ["dlight", "lux", 604] }] },
  // The solution already has automatic mode. Back to it: the room is bright, so the lamp goes off.
  // Then the wall switch: the room goes dark, the lamp comes on by itself and adds its light.
  {
    step: "auto",
    do: [
      { tapText: "^切回自动$" }, { wait: 1 }, { set: ["dlight", "lux", 582] },
      { set: ["dlight", "lux", 12] }, { wait: 1 }, { set: ["dlight", "lux", 34] },
    ],
  },
  // The room's lights on again: the lamp goes off, and its own light is gone from the reading.
  { step: "morning", do: [{ set: ["dlight", "lux", 604] }, { wait: 1 }, { set: ["dlight", "lux", 582] }] },
] satisfies Playthrough;
