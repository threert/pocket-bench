// How a player gets through 桌面气象站 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The heat gun and the
// mist sprayer are what the room sets on the Unit when they are used.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "plug", do: [{ plug: "env3" }] },
  { step: "app", do: [{ solution: true }] },
  // The heat gun: the air at the Unit goes to 45 °C; the sensor follows over some seconds.
  { step: "heat", do: [{ set: ["env3", "celsius", 45] }] },
  // The solution already has the alert: the step completes when the reading passes 30 °C.
  { step: "alert", do: [] },
  // The heat gun off, the mist sprayer on.
  { step: "mist", do: [{ set: ["env3", "celsius", 24.6] }, { set: ["env3", "humidity", 88] }] },
] satisfies Playthrough;
