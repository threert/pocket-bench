// How a player gets through 番茄钟 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). The room turns the
// Encoder's knob by setting its count of detents, and a click on the knob
// holds its button for 0.18 s (docs/ROOM-PROPS.md).
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

/** A click on the knob. */
const press = [{ set: ["encoder", "button", 1] }, { wait: 0.18 }, { set: ["encoder", "button", 0] }] satisfies Playthrough[number]["do"];

export default [
  { step: "plug", do: [{ plug: "encoder" }] },
  { step: "app", do: [{ solution: true }] },
  // Twenty detents anticlockwise: from 25 minutes down to 5.
  { step: "set", do: [{ set: ["encoder", "steps", -20] }] },
  // The countdown starts: 04:59 a second later.
  { step: "start", do: press },
  // The solution already lights the LEDs: green while it counts down, then a second click pauses it and they turn amber.
  { step: "leds", do: press },
] satisfies Playthrough;
