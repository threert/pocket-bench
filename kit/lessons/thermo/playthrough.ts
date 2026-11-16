// How a player gets through 测温枪 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The mug of coffee in
// front of the Unit is what makes it read 62 °C; with nothing there it reads
// the room, 24.6 °C (docs/ROOM-PROPS.md).
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "plug", do: [{ plug: "ncir" }] },
  { step: "app", do: [{ solution: true }] },
  // The mug is dragged in front of the Unit's eye.
  { step: "mug", do: [{ set: ["ncir", "objectCelsius", 62] }] },
  // The solution already has the 烫不烫 indicator: with the mug still there it says 小心烫 at once.
  { step: "hot", do: [] },
  // The mug goes back to its place: the Unit looks at the room again.
  { step: "away", do: [{ set: ["ncir", "objectCelsius", 24.6] }] },
] satisfies Playthrough;
