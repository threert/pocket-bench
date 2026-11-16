// Where things are in the room, metres. The origin is on the floor under the middle of the main bench's front edge;
// X runs to the right along the back wall, Y up, Z toward the viewer.
import type { V3 } from "./lib.ts";

export const ROOM = { left: -3.3, right: 3.5, back: -0.86, front: 3.4, height: 2.85 } as const;
/** The main bench: its top is the work surface. */
export const BENCH = { width: 1.9, depth: 0.8, top: 0.76, left: -0.95, right: 0.95, back: -0.8, front: 0 } as const;
/** The riser at the back of the bench that carries the instruments. */
export const RISER = { depth: 0.3, height: 0.26, thickness: 0.018 } as const;

/** The Tab5 on its tripod: the centre of the device, and how far it leans back. */
export const TAB5 = { at: [0.0, BENCH.top + 0.118, -0.34] as V3, tilt: (14 * Math.PI) / 180 };

/** Where Units sit when they are plugged in. Their cables run to the hub, and the hub's to the Tab5's Port A. */
export const PADS: { id: string; at: V3 }[] = [
  { id: "pad-a", at: [-0.36, BENCH.top, -0.30] },
  { id: "pad-b", at: [-0.20, BENCH.top, -0.30] },
  { id: "pad-c", at: [0.22, BENCH.top, -0.30] },
];
export const HUB: V3 = [-0.13, BENCH.top, -0.47];

/** The organiser the Units live in: 5 columns by 2 rows of compartments. */
export const TRAY = { at: [-0.66, BENCH.top, -0.14] as V3, columns: 5, rows: 2, cell: [0.068, 0.062] as [number, number] };

export const VIEWS: Record<string, { position: V3; target: V3; fov: number }> = {
  room: { position: [0.35, 1.52, 2.55], target: [0.02, 1.02, -0.45], fov: 40 },
  bench: { position: [-0.04, 1.13, 0.40], target: [-0.06, 0.84, -0.30], fov: 40 },
  screen: { position: [0.0, 0.99, 0.02], target: [0.0, 0.875, -0.34], fov: 32 },
  parts: { position: [-0.62, 1.12, 0.42], target: [-0.6, 0.78, -0.16], fov: 34 },
  wall: { position: [-1.5, 1.45, 1.6], target: [-1.75, 1.25, -0.8], fov: 40 },
};
