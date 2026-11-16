// The main workbench: a white steel frame, a board with a green anti-static mat, and a riser at the back for the
// instruments. The mat is printed like a cutting mat: a centimetre grid, bolder every five.
import { Mesh, MeshStandardMaterial, Texture, type Scene } from "@threert/scene";
import { Kit, coated, glow, roundedPlate, std, type V3 } from "./lib.ts";
import { BENCH, PADS, RISER } from "./layout.ts";

export interface BenchParts { pads: Record<string, { plate: Mesh; material: MeshStandardMaterial }> }

export function buildBench(scene: Scene): BenchParts {
  const kit = new Kit(scene);
  const steel = coated("bench_frame", 0xe9e9e6, 0.4, 0.3);
  const board = std("bench_board", 0xcdb48c, 0.55);
  const edge = std("bench_edge", 0xb99a6a, 0.6);
  const foot = std("bench_foot", 0x1c1c1c, 0.7);
  const { width, depth, top } = BENCH;
  const cz = -depth / 2;
  const boardT = 0.03, legTop = top - boardT - 0.002;
  // Legs and stretchers of 40 mm square tube.
  const tubeSize = 0.04;
  for (const x of [BENCH.left + 0.05, BENCH.right - 0.05]) {
    for (const z of [BENCH.back + 0.05, BENCH.front - 0.05]) {
      kit.soft("bench_frame", [tubeSize, legTop - 0.012, tubeSize], 0.004, [x, (legTop + 0.012) / 2, z], steel);
      kit.box("bench_frame", [0.05, 0.012, 0.05], [x, 0.006, z], foot);
    }
    kit.soft("bench_frame", [tubeSize, tubeSize, depth - 0.14], 0.004, [x, legTop - 0.02, cz], steel);
    kit.soft("bench_frame", [tubeSize, tubeSize, depth - 0.14], 0.004, [x, 0.16, cz], steel);
  }
  kit.soft("bench_frame", [width - 0.14, tubeSize, tubeSize], 0.004, [0, legTop - 0.02, BENCH.back + 0.05], steel);
  kit.soft("bench_frame", [width - 0.14, tubeSize, tubeSize], 0.004, [0, legTop - 0.02, BENCH.front - 0.05], steel);
  kit.soft("bench_frame", [width - 0.14, tubeSize, tubeSize], 0.004, [0, 0.16, BENCH.back + 0.05], steel);
  // The board with its edge band, and the mat on it.
  kit.soft("bench_top", [width, boardT, depth], 0.003, [0, top - boardT / 2 - 0.002, cz], board);
  kit.box("bench_top", [width + 0.002, boardT * 0.55, 0.004], [0, top - boardT / 2 - 0.002, BENCH.front + 0.001], edge);
  // (The mat's print, a centimetre grid, is room/art/bench/mat.svg.)
  const print = new Texture("room/assets/gen/bench/mat.png");
  print.wrap = "clamp";
  const matMaterial = new MeshStandardMaterial({ name: "bench_mat", map: print, roughness: 0.62 });
  const mat = kit.mesh("bench_mat", roundedPlate(width - 0.03, depth - 0.03, 0.002, 0.012), [0, top - 0.001, cz], matMaterial);
  mat.rotation.x = -Math.PI / 2;

  // The riser: a green shelf on grey posts along the back.
  const riserZ = BENCH.back + RISER.depth / 2 + 0.01, shelfY = top + RISER.height;
  const post = std("riser_post", 0x9ea3a8, 0.35, 0.6);
  for (const x of [-0.88, -0.3, 0.3, 0.88]) {
    for (const z of [riserZ - RISER.depth / 2 + 0.035, riserZ + RISER.depth / 2 - 0.035]) {
      kit.drum("riser", 0.016, RISER.height - RISER.thickness, [x, top + (RISER.height - RISER.thickness) / 2, z], post);
      kit.drum("riser", 0.024, 0.006, [x, top + 0.003, z], post);
    }
  }
  kit.soft("riser", [width - 0.02, RISER.thickness, RISER.depth], 0.003, [0, shelfY - RISER.thickness / 2, riserZ], board);
  const shelfMat = kit.mesh("riser", roundedPlate(width - 0.035, RISER.depth - 0.015, 0.002, 0.008), [0, shelfY + 0.001, riserZ], std("riser_mat", 0x1e6f4e, 0.62));
  shelfMat.rotation.x = -Math.PI / 2;
  // A strip light under the riser's front edge: the bench's task light.
  kit.box("task_light", [width - 0.2, 0.008, 0.016], [0, shelfY - RISER.thickness - 0.004, riserZ + RISER.depth / 2 - 0.02], std("task_light_body", 0xd8d8d8, 0.4, 0.5));
  kit.box("task_light_glow", [width - 0.22, 0.002, 0.01], [0, shelfY - RISER.thickness - 0.009, riserZ + RISER.depth / 2 - 0.02], glow("task_light_glow", 0xfff0dc, 5200)).castShadow = false;

  // The pads Units sit on when they are plugged in: plates that light up while a Unit is carried.
  const pads: BenchParts["pads"] = {};
  for (const pad of PADS) {
    const material = new MeshStandardMaterial({ name: pad.id, color: 0x2a8a63, roughness: 0.5, emissive: 0x55ffb0, emissiveIntensity: 0 });
    const plate = kit.mesh(pad.id, roundedPlate(0.086, 0.064, 0.0012, 0.008), [pad.at[0], top + 0.0008, pad.at[2]], material);
    plate.rotation.x = -Math.PI / 2;
    pads[pad.id] = { plate, material };
  }
  return { pads };
}
export type { V3 };
