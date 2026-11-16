// The studio's shell: walls, floor, ceiling and the lights that are part of the building. The reference is a
// hardware lab: grey painted walls, a green anti-static floor zone marked off with hazard tape beside a warm vinyl
// floor, and flat LED panels overhead.
import { RectAreaLight, type Scene } from "@threert/scene";
import { Kit, hex, noiseTexture, std, type V3 } from "./lib.ts";
import { ROOM } from "./layout.ts";
import { MeshStandardMaterial } from "@threert/scene";

export interface CeilingLight { light: RectAreaLight; nits: number }

export function buildShell(scene: Scene): { ceiling: CeilingLight[] } {
  const kit = new Kit(scene);
  const width = ROOM.right - ROOM.left, depth = ROOM.front - ROOM.back, cx = (ROOM.left + ROOM.right) / 2, cz = (ROOM.back + ROOM.front) / 2;
  const textured = (name: string, seed: number, base: V3, spread: number, roughness: number, repeat: [number, number], cells = 24, streak = 1) => {
    const map = noiseTexture(seed, 256, base, spread, cells, streak);
    map.repeat = repeat;
    return new MeshStandardMaterial({ name, map, roughness });
  };
  // Painted plaster: a cool light grey, a little uneven.
  const wall = textured("wall_paint", 11, [0.72, 0.73, 0.72], 0.009, 0.92, [2, 1], 10);
  const ceilingMat = textured("ceiling", 12, [0.88, 0.88, 0.87], 0.006, 0.95, [4, 4]);
  // The work zone's floor: green anti-static vinyl. The rest: a warm wood-tone vinyl.
  const green = textured("floor_esd", 13, [0.105, 0.36, 0.25], 0.03, 0.42, [5, 5], 30);
  const vinyl = textured("floor_vinyl", 14, [0.60, 0.44, 0.31], 0.035, 0.5, [3, 12], 40, 6);

  const t = 0.12;
  kit.box("ceiling", [width + 2 * t, t, depth + 2 * t], [cx, ROOM.height + t / 2, cz], ceilingMat);
  kit.box("wall_back", [width + 2 * t, ROOM.height, t], [cx, ROOM.height / 2, ROOM.back - t / 2], wall);
  kit.box("wall_front", [width + 2 * t, ROOM.height, t], [cx, ROOM.height / 2, ROOM.front + t / 2], wall);
  kit.box("wall_left", [t, ROOM.height, depth], [ROOM.left - t / 2, ROOM.height / 2, cz], wall);
  kit.box("wall_right", [t, ROOM.height, depth], [ROOM.right + t / 2, ROOM.height / 2, cz], wall);
  // The floor in two zones; the green one runs from x = -1.55 to the right wall.
  const edge = -1.55;
  kit.box("floor", [edge - ROOM.left, 0.1, depth], [(ROOM.left + edge) / 2, -0.05, cz], vinyl);
  kit.box("floor", [ROOM.right - edge, 0.1, depth], [(edge + ROOM.right) / 2, -0.05, cz], green);
  // Hazard tape along the zone's edge: yellow with black bars.
  const yellow = std("tape_yellow", 0xe8b400, 0.55), black = std("tape_black", 0x161616, 0.6);
  kit.box("tape", [0.06, 0.0012, depth - 0.02], [edge, 0.0006, cz], yellow);
  for (let i = 0; i < 34; i++) {
    const bar = kit.box("tape", [0.06, 0.0016, 0.05], [edge, 0.0008, ROOM.back + 0.09 + i * 0.125], black);
    bar.rotation.y = 0.5;
    bar.scale.set(1.1, 1, 1);
  }
  // Skirting.
  const skirting = std("skirting", 0x3b3d40, 0.6);
  kit.box("skirting", [width, 0.08, 0.012], [cx, 0.04, ROOM.back + 0.006], skirting);
  kit.box("skirting", [0.012, 0.08, depth], [ROOM.left + 0.006, 0.04, cz], skirting);
  kit.box("skirting", [0.012, 0.08, depth], [ROOM.right - 0.006, 0.04, cz], skirting);

  // Ceiling panels: 600 x 600 LED troffers in a grid, each a rectangle of light in a white frame.
  const ceiling: CeilingLight[] = [];
  const frame = std("panel_frame", 0xdcdcdc, 0.5);
  const NITS = 3400;
  for (const x of [-1.9, -0.1, 1.7]) {
    for (const z of [0.25, 1.9]) {
      kit.box("ceiling_panel", [0.66, 0.012, 0.03], [x, ROOM.height - 0.006, z - 0.315], frame);
      kit.box("ceiling_panel", [0.66, 0.012, 0.03], [x, ROOM.height - 0.006, z + 0.315], frame);
      kit.box("ceiling_panel", [0.03, 0.012, 0.6], [x - 0.315, ROOM.height - 0.006, z], frame);
      kit.box("ceiling_panel", [0.03, 0.012, 0.6], [x + 0.315, ROOM.height - 0.006, z], frame);
      const light = new RectAreaLight(hex(0xfff3e4), NITS, 0.6, 0.6);
      kit.add(light, `ceiling_light_${ceiling.length}`, [x, ROOM.height - 0.004, z]);
      light.lookAt(x, 0, z);
      ceiling.push({ light, nits: NITS });
    }
  }
  return { ceiling };
}
