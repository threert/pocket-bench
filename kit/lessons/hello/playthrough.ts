// How a player gets through 你好，Tab5 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it).
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

export default [
  { step: "tap", do: [{ tapText: "^Tap me$" }] },
  { step: "greet", do: [{ solution: true }] },
  { step: "count", do: [{ tapText: "^点我$" }, { tapText: "^点我$" }, { tapText: "^点我$" }] },
  { step: "colour", do: [{ tapText: "^换颜色$" }] },
] satisfies Playthrough;
