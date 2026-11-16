// How a player gets through 厨房秤 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The weights and the mug
// are what the room sets on the Unit when they rest on its pan
// (docs/ROOM-PROPS.md): 50, 100 and 200 g of brass, a 310 g mug.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "plug", do: [{ plug: "scales" }] },
  // The solution stands in for the agent; then the 100 g weight goes on the pan.
  { step: "weigh", do: [{ solution: true }, { set: ["scales", "grams", 100] }] },
  // The weight off, the mug on. Once the reading rests, 去皮 on the screen makes it 0.
  { step: "tare", do: [{ set: ["scales", "grams", 310] }, { wait: 1 }, { tapText: "^去皮$" }] },
  // The mug off (the display reads -310), the Unit's own button to tare the empty pan (the room holds it
  // for 0.18 s), then 50 g and 200 g together. The solution already has the game: 成功！ and a green LED.
  {
    step: "game",
    do: [
      { set: ["scales", "grams", 0] }, { wait: 1 },
      { set: ["scales", "button", 1] }, { wait: 0.18 }, { set: ["scales", "button", 0] }, { wait: 0.5 },
      { set: ["scales", "grams", 250] },
    ],
  },
] satisfies Playthrough;
