// Where things are in the room, metres. The origin is on the floor under the middle of the main bench's front edge;
// X runs to the right along the back wall, Y up, Z toward the viewer.
import type { V3 } from "./lib.ts";

export const ROOM = { left: -3.3, right: 3.5, back: -0.86, front: 3.4, height: 2.85 } as const;
/** The main bench: its top is the work surface. */
export const BENCH = { width: 1.9, depth: 0.8, top: 0.76, left: -0.95, right: 0.95, back: -0.8, front: 0 } as const;
/** The riser at the back of the bench that carries the instruments. */
export const RISER = { depth: 0.3, height: 0.26, thickness: 0.018 } as const;

/** The Tab5 on its tripod: the centre of the device, and how far it leans back. */
export const TAB5 = { at: [0.0, BENCH.top + 0.118, -0.37] as V3, tilt: (14 * Math.PI) / 180 };

/** Where Units sit when they are plugged in: a row in front of the Tab5. Their cables run to the hub, and the
 *  hub's to the Tab5's Port A. */
export const PADS: { id: string; at: V3 }[] = [
  { id: "pad-a", at: [-0.165, BENCH.top, -0.19] },
  { id: "pad-b", at: [0.0, BENCH.top, -0.19] },
  { id: "pad-c", at: [0.165, BENCH.top, -0.19] },
];
export const HUB: V3 = [-0.2, BENCH.top, -0.375];

/** The foam tray the Units live in, left of the pads. */
export const TRAY = { at: [-0.415, BENCH.top, -0.215] as V3 };
/** Where the props rest, right of the pads: a grid of places from the back row to the front. */
export const PROP_HOMES: Record<string, V3> = {
  dryer: [0.335, BENCH.top, -0.335], mister: [0.455, BENCH.top, -0.34], mug: [0.545, BENCH.top, -0.33],
  block: [0.33, BENCH.top, -0.215], "weight-200": [0.43, BENCH.top, -0.215], "weight-100": [0.49, BENCH.top, -0.215], "weight-50": [0.545, BENCH.top, -0.215],
  "card-a": [0.335, BENCH.top, -0.115], "card-b": [0.435, BENCH.top, -0.11], tag: [0.525, BENCH.top, -0.115],
};

/** Camera views. The app's chat panel covers the right quarter of the window, so each view looks a little to the
 *  right of its subject: the subject sits in the middle of what is left. */
export const VIEWS: Record<string, { position: V3; target: V3; fov: number }> = {
  room: { position: [0.75, 1.52, 2.7], target: [0.42, 1.02, -0.45], fov: 40 },
  bench: { position: [0.22, 1.33, 0.70], target: [0.22, 0.82, -0.28], fov: 46 },
  work: { position: [0.09, 1.10, 0.24], target: [0.09, 0.83, -0.29], fov: 40 },
  screen: { position: [0.043, 1.0, 0.0], target: [0.043, 0.868, -0.37], fov: 30 },
  parts: { position: [-0.27, 1.12, 0.2], target: [-0.27, 0.77, -0.2], fov: 42 },
  wall: { position: [-1.2, 1.5, 1.7], target: [-1.5, 1.3, -0.8], fov: 42 },
};
