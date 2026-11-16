// How a player gets through 摇杆小游戏 with the reference solution
// (sidecar/test/lessons/playthrough.test.ts runs it). Holding the stick is
// what the room sets on the Unit: x from -1 (left) to 1 (right), 0 when it
// is let go (docs/ROOM-PROPS.md).
//
// The solution's tray follows the stick: x = 0.5 holds it halfway to the
// right edge. Every round opens with four stars at fixed places (OPENING in
// solution/main.tsx), the first three one at a time, so that a player, and
// this script, can learn the game before the stars come at random.
import type { Playthrough } from "../../../sidecar/src/lessons/types.ts";

/** Where the first four stars of a round fall, as stick positions: OPENING of solution/main.tsx. */
const OPENING = [-0.55, 0.5, -0.2, 0.35];
/** Waits until the screen shows this score. There is no action that only waits for a text: `tapText`
 *  does, and then touches the score, which nothing in the game listens to. */
const score = (points: number) => ({ tapText: `^得分：${points}$` });

export default [
  { step: "plug", do: [{ plug: "joystick2" }] },
  { step: "app", do: [{ solution: true }] },
  // Pushing the stick starts the round. The tray goes under each star before it lands.
  {
    step: "play",
    do: [
      { set: ["joystick2", "x", OPENING[0]] }, score(1),
      { set: ["joystick2", "x", OPENING[1]] }, score(2),
      { set: ["joystick2", "x", OPENING[2]] }, score(3),
      // On to the fourth star, for the next step.
      { set: ["joystick2", "x", OPENING[3]] },
    ],
  },
  // The solution already flashes the Unit's LED: the green of the third catch is still in the check's
  // 1.5 s window, and the fourth star brings the next one.
  { step: "flash", do: [] },
] satisfies Playthrough;
