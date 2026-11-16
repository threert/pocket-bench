// The second workstation, at the right of the main bench: a white steel bench with a pale anti-static mat, a back
// frame of light-blue louvred tool panels under a shelf with a strip light, a digital microscope with its monitor, a
// fume extractor with its ribbed hose, a hot-air rework station and the small things of a soldering place. Around
// it: three mesh-back task chairs, a tower of plastic drawer units between the benches, a waste bin, a power strip
// and shipping boxes by the right wall.
import {
  BufferGeometry, DataTexture, Group, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshGeometry, MeshPhysicalMaterial, MeshStandardMaterial,
  Object3D, RingGeometry, Texture, TorusGeometry, Vector3, type Scene,
} from "@threert/scene";
import { Kit, coated, curve, glow, mm, noiseTexture, rng, roundedBox, roundedPlate, std, tube, type V3 } from "../lib.ts";
import { ROOM } from "../layout.ts";

export interface StationHandles {
  /** The microscope monitor's picture (emissive art). */
  microscopeScreen: MeshStandardMaterial;
  /** The luminaire under the shelf: the app switches it by `emissiveIntensity`. */
  stripLight: MeshStandardMaterial;
  chairs: Group[];
}

/** Where the station stands. The bench's top is 1.83 x 0.75 m, 0.76 m high, its back frame against the wall. */
export const STATION = {
  left: 1.22, right: 3.05, back: ROOM.back + 0.02, depth: 0.75, top: 0.76,
  /** The tool panels' span in height, the shelf's top and the frame's. */
  panel: [0.95, 1.45] as [number, number], shelf: 1.5, frameTop: 1.75,
  /** Nits of the strip light when it is on. */
  stripNits: 4800,
} as const;

const TAU = Math.PI * 2;
type Rect = [number, number, number, number];
type Parent = Object3D;

// ----------------------------------------------------------------------------------------------- print

/** The print sheet (room/art/station/print.svg): rectangles in texels, x, y from the top left. */
const SHEET = 1024;
const ART = {
  rework: [0, 0, 456, 312] as Rect,
  extractor: [460, 0, 400, 480] as Rect,
  label: (i: number): Rect => [868, 4 + 60 * i, 150, 56],
  ship: [0, 320, 300, 450] as Rect,
  pcb: [310, 490, 480, 330] as Rect,
  ipa: [0, 780, 240, 160] as Rect,
  fragile: [800, 490, 200, 100] as Rect,
  up: [800, 600, 200, 200] as Rect,
  strip: [310, 830, 600, 100] as Rect,
  reel: [0, 946, 240, 74] as Rect,
};
/** UV corners of a sheet rectangle: [u0, v of its bottom, u1, v of its top]. */
function uvOf([x, y, w, h]: Rect, inset = 0.6): [number, number, number, number] {
  return [(x + inset) / SHEET, 1 - (y + h - inset) / SHEET, (x + w - inset) / SHEET, 1 - (y + inset) / SHEET];
}

/** A plane in XY facing +Z whose corners carry the given UVs (bottom left u0 v0, top right u1 v1). */
function uvPlane(width: number, height: number, u0 = 0, v0 = 0, u1 = 1, v1 = 1): BufferGeometry {
  const x = width / 2, y = height / 2;
  return new BufferGeometry().setData([-x, -y, 0, x, -y, 0, x, y, 0, -x, y, 0], [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], [u0, v0, u1, v0, u1, v1, u0, v1], [0, 1, 2, 0, 2, 3]);
}
const sheet = (width: number, height: number, rect: Rect) => uvPlane(width, height, ...uvOf(rect));

/** A thin board lying flat (top +Y, the picture's top toward -Z) printed with a sheet rectangle; its edges and
 *  underside take the colour of the texel at `edge` (so a circuit board has green edges). */
function slab(width: number, depth: number, thickness: number, rect: Rect, edge: [number, number]): BufferGeometry {
  const [u0, v0, u1, v1] = uvOf(rect), eu = (rect[0] + edge[0]) / SHEET, ev = 1 - (rect[1] + edge[1]) / SHEET;
  const x = width / 2, y = thickness / 2, z = depth / 2;
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  const face = (corners: V3[], normal: V3, uv?: number[]) => {
    const start = positions.length / 3;
    corners.forEach((c, i) => { positions.push(...c); normals.push(...normal); uvs.push(...(uv ? [uv[i * 2]!, uv[i * 2 + 1]!] : [eu, ev])); });
    index.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  face([[-x, y, z], [x, y, z], [x, y, -z], [-x, y, -z]], [0, 1, 0], [u0, v0, u1, v0, u1, v1, u0, v1]);
  face([[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [0, -1, 0]);
  face([[-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z]], [0, 0, 1]);
  face([[x, -y, -z], [-x, -y, -z], [-x, y, -z], [x, y, -z]], [0, 0, -1]);
  face([[x, -y, z], [x, -y, -z], [x, y, -z], [x, y, z]], [1, 0, 0]);
  face([[-x, -y, -z], [-x, -y, z], [-x, y, z], [-x, y, -z]], [-1, 0, 0]);
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/** A label wrapped on an upright cylinder: `arc` radians of it, centred on +Z. */
function labelBand(radius: number, height: number, arc: number, rect: Rect, segments = 10): BufferGeometry {
  const [u0, v0, u1, v1] = uvOf(rect);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments, a = (t - 0.5) * arc, s = Math.sin(a), c = Math.cos(a);
    positions.push(radius * s, -height / 2, radius * c, radius * s, height / 2, radius * c);
    normals.push(s, 0, c, s, 0, c);
    uvs.push(u0 + (u1 - u0) * t, v0, u0 + (u1 - u0) * t, v1);
    if (i < segments) index.push(i * 2, i * 2 + 2, i * 2 + 3, i * 2, i * 2 + 3, i * 2 + 1);
  }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

// ----------------------------------------------------------------------------------------------- shapes

const SOFT = new Map<string, BufferGeometry>();
/** A rounded box, shared between parts of the same size. */
function softGeo(size: V3, r: number, segments = 2): BufferGeometry {
  const key = `${size.map(v => v.toFixed(5)).join("x")}:${r.toFixed(5)}:${segments}`;
  let geometry = SOFT.get(key);
  if (!geometry) SOFT.set(key, geometry = roundedBox(size[0], size[1], size[2], r, segments));
  return geometry;
}

/** A rounded bar along X that tapers from (w0 x h0) at -X to (w1 x h1) at +X and drops by `drop`: a chair's spoke. */
function taperedBar(length: number, h0: number, w0: number, h1: number, w1: number, drop: number, r: number): BufferGeometry {
  const geometry = roundedBox(length, h0, w0, r, 2);
  const p = geometry.positions;
  for (let i = 0; i < p.length; i += 3) {
    const t = p[i]! / length + 0.5;
    p[i + 1] = p[i + 1]! * (1 + (h1 / h0 - 1) * t) - drop * t;
    p[i + 2] = p[i + 2]! * (1 + (w1 / w0 - 1) * t);
  }
  return geometry;
}

/** A convex outline in (z, y) pushed along X by `width`, flat-shaded: wedges, brackets, louvre lips. */
function extrudeX(outline: [number, number][], width: number): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  let area = 0;
  for (let i = 0; i < outline.length; i++) { const [z0, y0] = outline[i]!, [z1, y1] = outline[(i + 1) % outline.length]!; area += z0 * y1 - z1 * y0; }
  const ring = area > 0 ? outline : [...outline].reverse();   // counter-clockwise seen from -X (z right, y up)
  const x = width / 2;
  const quad = (a: V3, b: V3, c: V3, d: V3, normal: V3) => {
    const start = positions.length / 3;
    for (const v of [a, b, c, d]) { positions.push(...v); normals.push(...normal); uvs.push(0.5, 0.5); }
    index.push(start, start + 1, start + 2, start, start + 2, start + 3);
  };
  for (let i = 0; i < ring.length; i++) {
    const [z0, y0] = ring[i]!, [z1, y1] = ring[(i + 1) % ring.length]!;
    const length = Math.hypot(z1 - z0, y1 - y0) || 1;
    quad([-x, y0, z0], [x, y0, z0], [x, y1, z1], [-x, y1, z1], [0, -(z1 - z0) / length, (y1 - y0) / length]);
  }
  for (const side of [-1, 1]) {
    const start = positions.length / 3;
    for (const [z, y] of ring) { positions.push(side * x, y, z); normals.push(side, 0, 0); uvs.push(0.5, 0.5); }
    for (let i = 1; i < ring.length - 1; i++) index.push(...(side < 0 ? [start, start + i, start + i + 1] : [start, start + i + 1, start + i]));
  }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/** Radius / height pairs turned about Y. Ascending pairs face outward. */
const lathe = (points: [number, number][], sides = 24) => new LatheGeometry(points.map(([x, y]) => ({ x, y })), sides);

/** Points every `spacing` along a path. */
function resample(path: V3[], spacing: number): V3[] {
  const out: V3[] = [path[0]!];
  let carried = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!, b = path[i + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    let at = spacing - carried;
    while (at <= length) {
      const t = at / length;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      at += spacing;
    }
    carried = length - (at - spacing);
  }
  return out;
}

/** A corrugated hose along a path: `rib` deep ridges every `pitch`. */
function ribbedTube(path: V3[], radius: number, rib: number, pitch: number, sides = 16): BufferGeometry {
  const per = 4, points = resample(path, pitch / per).map(p => new Vector3(...p));
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  let normal = new Vector3(0, 1, 0);
  for (let i = 0; i < points.length; i++) {
    const tangent = new Vector3().subVectors(points[Math.min(i + 1, points.length - 1)]!, points[Math.max(i - 1, 0)]!).normalize();
    normal = normal.clone().addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) normal = Math.abs(tangent.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    normal.normalize();
    const binormal = new Vector3().crossVectors(tangent, normal);
    const phase = (i / per) * TAU;
    const r = radius + rib * 0.5 * (1 + Math.cos(phase)), slope = (-rib * 0.5 * Math.sin(phase) * TAU) / pitch;
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU, c = Math.cos(a), d = Math.sin(a);
      const rx = normal.x * c + binormal.x * d, ry = normal.y * c + binormal.y * d, rz = normal.z * c + binormal.z * d;
      positions.push(points[i]!.x + rx * r, points[i]!.y + ry * r, points[i]!.z + rz * r);
      const nx = rx - tangent.x * slope, ny = ry - tangent.y * slope, nz = rz - tangent.z * slope, length = Math.hypot(nx, ny, nz);
      normals.push(nx / length, ny / length, nz / length);
      uvs.push(s / sides, i / (points.length - 1));
    }
  }
  const ring = sides + 1;
  for (let i = 0; i < points.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * ring + s, b = a + 1, c = a + ring, e = c + 1;
      index.push(a, c, b, b, c, e);
    }
  }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/** The outline of a rectangle with rounded corners, counter-clockwise from the middle of its bottom side. */
function roundRect(width: number, height: number, r: number, perCorner = 6): [number, number][] {
  const out: [number, number][] = [[0, -height / 2]];
  const corners: [number, number, number][] = [[width / 2 - r, -height / 2 + r, -Math.PI / 2], [width / 2 - r, height / 2 - r, 0], [-width / 2 + r, height / 2 - r, Math.PI / 2], [-width / 2 + r, -height / 2 + r, Math.PI]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= perCorner; i++) {
      const a = start + (i / perCorner) * (Math.PI / 2);
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------------------- textures

/** A chair's mesh back: a dark knit with rows of small holes, 8 x 8 holes a tile. */
function meshTexture(): DataTexture {
  const size = 64, px = new Uint8Array(size * size * 4), random = rng(77);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / 8), cx = ((x + (row % 2) * 4) % 8) - 3.5, cy = (y % 8) - 3.5;
      const hole = Math.max(0, 1 - Math.hypot(cx, cy * 1.25) / 3.0);
      const v = 44 - 36 * Math.min(1, hole * 2.2) + (random() - 0.5) * 7;
      const o = (y * size + x) * 4;
      px[o] = v; px[o + 1] = v; px[o + 2] = v + 1; px[o + 3] = 255;
    }
  }
  return new DataTexture(size, size, px);
}

/** Milky drawer fronts with what is inside showing as soft patches of colour: eight rows, one per drawer. */
const DRAWER_ROWS = 8;
function drawerTexture(): DataTexture {
  const w = 128, rowH = 32, h = rowH * DRAWER_ROWS, px = new Uint8Array(w * h * 4), random = rng(4211);
  const palette: V3[] = [[196, 62, 50], [52, 104, 186], [222, 176, 52], [48, 140, 88], [44, 46, 52], [224, 122, 44], [150, 96, 60], [236, 236, 230]];
  for (let row = 0; row < DRAWER_ROWS; row++) {
    const blobs = Array.from({ length: 5 }, () => ({ x: random() * w, y: rowH * (0.45 + random() * 0.5), r: 9 + random() * 16, c: palette[Math.floor(random() * palette.length)]!, a: 0.3 + random() * 0.3 }));
    for (let y = 0; y < rowH; y++) {
      for (let x = 0; x < w; x++) {
        // Fuller toward the bottom of the drawer; the top is empty air behind the plastic.
        const colour: V3 = [214 - y * 0.25, 217 - y * 0.25, 214 - y * 0.2];
        for (const blob of blobs) {
          const d = Math.hypot((x - blob.x) / 1.6, y - blob.y) / blob.r;
          const k = Math.max(0, 1 - d * d) * blob.a;
          for (let c = 0; c < 3; c++) colour[c] = colour[c]! + (blob.c[c]! - colour[c]!) * k;
        }
        const o = ((row * rowH + y) * w + x) * 4;
        for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, colour[c]! + (random() - 0.5) * 5));
        px[o + 3] = 255;
      }
    }
  }
  return new DataTexture(w, h, px);
}

// ----------------------------------------------------------------------------------------------- materials

function materials() {
  const kraftMap = noiseTexture(41, 128, [0.70, 0.54, 0.37], 0.03, 16, 5);
  const matMap = noiseTexture(42, 128, [0.80, 0.835, 0.82], 0.012, 22);
  matMap.repeat = [4, 2];
  const meshMap = meshTexture();
  meshMap.repeat = [40, 40];
  const print = new Texture("room/assets/gen/station/print.png");
  print.wrap = "clamp";
  const panelMap = new Texture("room/assets/gen/station/panel.png");
  panelMap.wrap = "clamp";
  const scopeMap = new Texture("room/assets/gen/station/scope.png");
  scopeMap.wrap = "clamp";
  const lcdMap = new Texture("room/assets/gen/station/lcd.png");
  lcdMap.wrap = "clamp";
  return {
    frame: coated("station_frame", 0xe9e9e6, 0.4, 0.3),
    laminate: std("station_laminate", 0xdfdfdb, 0.45),
    dark: std("station_black", 0x1d1e20, 0.5),
    rubber: std("station_rubber", 0x141415, 0.85),
    fabric: std("station_fabric", 0x1b1b1d, 0.95),
    mesh: new MeshStandardMaterial({ name: "station_chair_mesh", map: meshMap, roughness: 0.8, side: "double" }),
    mat: new MeshStandardMaterial({ name: "station_mat", map: matMap, roughness: 0.42 }),
    panel: new MeshStandardMaterial({ name: "station_panel", map: panelMap, roughness: 0.45 }),
    blue: coated("station_blue", 0x3f97d3, 0.42, 0.25),
    red: coated("station_red", 0xc7261f, 0.45, 0.3),
    yellow: coated("station_yellow", 0xe5b21c, 0.45, 0.3),
    steel: std("station_steel", 0xc4c7cb, 0.28, 1),
    alu: std("station_alu", 0xa9adb2, 0.42, 0.85),
    white: coated("station_white", 0xe7e7e3, 0.45, 0.25),
    hose: std("station_hose", 0xecebe6, 0.55),
    silicone: std("station_silicone", 0x55718b, 0.78),
    bottle: coated("station_bottle", 0x2f8fc4, 0.3, 0.5),
    amber: coated("station_amber", 0xb5701f, 0.3, 0.6),
    kraft: new MeshStandardMaterial({ name: "station_kraft", map: kraftMap, roughness: 0.85 }),
    bin: std("station_bin", 0x8a8f95, 0.5),
    print: new MeshStandardMaterial({ name: "station_print", map: print, roughness: 0.5 }),
    milky: new MeshPhysicalMaterial({ name: "station_drawer", map: drawerTexture(), roughness: 0.38, clearcoat: 0.3, clearcoatRoughness: 0.2 }),
    lens: new MeshPhysicalMaterial({ name: "station_lens", color: 0x08090c, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 }),
    screen: new MeshStandardMaterial({ name: "microscope_screen", color: 0x000000, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 160, emissiveMap: scopeMap }),
    lcd: new MeshStandardMaterial({ name: "station_lcd", color: 0x000000, roughness: 0.3, emissive: 0xffffff, emissiveIntensity: 190, emissiveMap: lcdMap }),
    ring: glow("station_ring_light", 0xf2f6ff, 1400),
    strip: glow("station_strip_light", 0xf1f6ff, STATION.stripNits),
  };
}
type Mats = ReturnType<typeof materials>;

/** What every builder below draws with. */
class Shop {
  readonly kit: Kit;
  constructor(readonly root: Group, readonly m: Mats) { this.kit = new Kit(root); }
  group(id: string | null, at: V3 = [0, 0, 0], parent: Parent = this.root): Group { return this.kit.group(id, at, parent); }
  soft(id: string, size: V3, r: number, at: V3, material: MeshStandardMaterial, parent: Parent = this.root, segments = 2): Mesh {
    return this.kit.mesh(id, softGeo(size, r, segments), at, material, parent);
  }
  box(id: string, size: V3, at: V3, material: MeshStandardMaterial, parent: Parent = this.root): Mesh { return this.kit.box(id, size, at, material, parent); }
  drum(id: string, radius: number, height: number, at: V3, material: MeshStandardMaterial, parent: Parent = this.root, top = radius, sides = 20): Mesh {
    return this.kit.drum(id, radius, height, at, material, parent, top, sides);
  }
  /** A cylinder lying along X or Z. */
  roll(id: string, axis: "x" | "z", radius: number, length: number, at: V3, material: MeshStandardMaterial, parent: Parent = this.root, top = radius, sides = 20): Mesh {
    const mesh = this.kit.drum(id, radius, length, at, material, parent, top, sides);
    if (axis === "x") mesh.rotation.z = -Math.PI / 2; else mesh.rotation.x = Math.PI / 2;
    return mesh;
  }
  rod(id: string, from: V3, to: V3, radius: number, material: MeshStandardMaterial, parent: Parent = this.root, sides = 10): Mesh {
    return this.kit.rod(id, from, to, radius, material, parent, sides);
  }
  ball(id: string, radius: number, at: V3, material: MeshStandardMaterial, parent: Parent = this.root): Mesh { return this.kit.ball(id, radius, at, material, parent); }
  mesh(id: string, geometry: BufferGeometry, at: V3, material: MeshStandardMaterial, parent: Parent = this.root): Mesh { return this.kit.mesh(id, geometry, at, material, parent); }
  /** A cable or hose through `points`. */
  cable(id: string, points: V3[], radius: number, material: MeshStandardMaterial, parent: Parent = this.root, steps = 6, sides = 6): Mesh {
    return this.kit.mesh(id, tube(curve(points, steps), radius, sides), [0, 0, 0], material, parent);
  }
  /** A printed sticker standing in XY (facing +Z). */
  sticker(id: string, width: number, height: number, rect: Rect, at: V3, parent: Parent = this.root): Mesh {
    const mesh = this.kit.mesh(id, sheet(width, height, rect), at, this.m.print, parent);
    mesh.castShadow = false;
    return mesh;
  }
}

// ----------------------------------------------------------------------------------------------- the bench

const S = STATION;
const WIDTH = S.right - S.left, CX = (S.left + S.right) / 2;
const FRONT = S.back + S.depth;
/** The back frame: 40 mm uprights against the wall; the board starts in front of them. */
const TUBE = 0.04, UPRIGHT_Z = S.back + TUBE / 2, BOARD_BACK = S.back + TUBE, BOARD_Z = (BOARD_BACK + FRONT) / 2, BOARD_DEPTH = FRONT - BOARD_BACK;
const BAY = (WIDTH - TUBE) / 3, PANEL_W = BAY - TUBE, PANEL_H = S.panel[1] - S.panel[0], PANEL_Y = (S.panel[0] + S.panel[1]) / 2;
/** The front face of the panels' sheet. */
const FACE = UPRIGHT_Z + 0.008;
const uprightX = (i: number) => S.left + TUBE / 2 + i * BAY;
const panelX = (i: number) => uprightX(i) + BAY / 2;
const SHELF_DEPTH = 0.3, SHELF_T = 0.022, SHELF_FRONT = BOARD_BACK + SHELF_DEPTH;

function buildBenchFrame(shop: Shop): void {
  const { m } = shop;
  const bench = shop.group("station-bench");
  const boardT = 0.03, legTop = S.top - boardT - 0.002;
  const foot = m.rubber;
  // Front legs, inset like the main bench's; the back legs are the end uprights of the tool frame.
  const frontZ = FRONT - 0.05;
  for (const x of [S.left + 0.05, S.right - 0.05]) {
    shop.soft("station_frame", [TUBE, legTop - 0.012, TUBE], 0.004, [x, (legTop + 0.012) / 2, frontZ], m.frame, bench);
    shop.box("station_frame", [0.05, 0.012, 0.05], [x, 0.006, frontZ], foot, bench);
    const span = frontZ - UPRIGHT_Z - TUBE;
    for (const y of [legTop - 0.02, 0.16]) shop.soft("station_frame", [TUBE, TUBE, span], 0.004, [x, y, (frontZ + UPRIGHT_Z) / 2], m.frame, bench);
  }
  shop.soft("station_frame", [WIDTH - 0.14, TUBE, TUBE], 0.004, [CX, legTop - 0.02, frontZ], m.frame, bench);
  shop.soft("station_frame", [WIDTH - 0.08, TUBE, TUBE], 0.004, [CX, legTop - 0.02, UPRIGHT_Z + TUBE], m.frame, bench);
  shop.soft("station_frame", [WIDTH - 0.08, TUBE, TUBE], 0.004, [CX, 0.16, UPRIGHT_Z + TUBE], m.frame, bench);
  // Uprights: the two at the ends stand on the floor, the two between rise from the back rail.
  for (let i = 0; i < 4; i++) {
    const outer = i === 0 || i === 3, bottom = outer ? 0.012 : legTop - 0.06;
    shop.soft("station_frame", [TUBE, S.frameTop - bottom, TUBE], 0.004, [uprightX(i), (S.frameTop + bottom) / 2, UPRIGHT_Z], m.frame, bench);
    shop.box("station_frame", [TUBE - 0.004, 0.003, TUBE - 0.004], [uprightX(i), S.frameTop + 0.0015, UPRIGHT_Z], m.dark, bench);
    if (outer) shop.box("station_frame", [0.05, 0.012, 0.05], [uprightX(i), 0.006, UPRIGHT_Z], foot, bench);
    // The end uprights also join the side rails.
    if (outer) for (const y of [legTop - 0.02, 0.16]) shop.soft("station_frame", [0.03, TUBE, TUBE], 0.004, [uprightX(i) + (i === 0 ? 0.03 : -0.03), y, UPRIGHT_Z + TUBE], m.frame, bench);
  }
  shop.soft("station_frame", [WIDTH - 2 * TUBE, TUBE, TUBE * 0.75], 0.004, [CX, S.frameTop - 0.05, UPRIGHT_Z], m.frame, bench);
  shop.soft("station_frame", [WIDTH - 2 * TUBE, 0.03, 0.02], 0.003, [CX, S.panel[0] - 0.02, UPRIGHT_Z], m.frame, bench);

  // The top: white laminate with a dark edge band, and the pale anti-static mat.
  shop.soft("station_top", [WIDTH, boardT, BOARD_DEPTH], 0.003, [CX, S.top - boardT / 2 - 0.002, BOARD_Z], m.laminate, bench);
  shop.box("station_top", [WIDTH + 0.002, boardT * 0.72, 0.004], [CX, S.top - boardT / 2 - 0.0035, FRONT + 0.0006], m.dark, bench);
  for (const side of [-1, 1]) shop.box("station_top", [0.004, boardT * 0.72, BOARD_DEPTH], [CX + side * (WIDTH / 2 + 0.0006), S.top - boardT / 2 - 0.0035, BOARD_Z], m.dark, bench);
  const mat = shop.mesh("station_mat", roundedPlate(WIDTH - 0.12, BOARD_DEPTH - 0.07, 0.002, 0.014), [CX, S.top - 0.001, BOARD_Z + 0.005], m.mat, bench);
  mat.rotation.x = -Math.PI / 2;

  // A socket trunking under the panels.
  const trunkY = S.top + 0.105;
  shop.soft("station_trunking", [WIDTH - 2 * TUBE - 0.02, 0.055, 0.045], 0.004, [CX, trunkY, BOARD_BACK + 0.0225], m.alu, bench);
  for (let i = 0; i < 6; i++) {
    const x = S.left + 0.2 + i * 0.29;
    shop.soft("station_trunking", [0.07, 0.044, 0.004], 0.0015, [x, trunkY, BOARD_BACK + 0.046], m.white, bench, 1);
    for (const dx of [-0.008, 0.008]) shop.box("station_trunking", [0.003, 0.009, 0.001], [x + dx, trunkY + 0.008, BOARD_BACK + 0.0484], m.dark, bench);
    shop.box("station_trunking", [0.003, 0.009, 0.001], [x, trunkY - 0.009, BOARD_BACK + 0.0484], m.dark, bench);
  }
}

/** The pressed lip of one louvre: a wedge that opens downward. */
const LIP = extrudeX([[0, 0.0045], [0.0052, -0.0045], [0, -0.0045]], 0.04);

function buildPanels(shop: Shop): void {
  const { m } = shop;
  for (let i = 0; i < 3; i++) {
    const mirrored = i === 1;
    const panel = shop.group(`tool-panel-${i}`, [panelX(i), PANEL_Y, FACE]);
    shop.soft("tool_panel", [PANEL_W - 0.003, PANEL_H, 0.016], 0.002, [0, 0, -0.008], m.blue, panel, 1);
    const face = shop.mesh("tool_panel", mirrored ? uvPlane(PANEL_W - 0.006, PANEL_H - 0.004, 1, 0, 0, 1) : uvPlane(PANEL_W - 0.006, PANEL_H - 0.004), [0, 0, 0.0003], m.panel, panel);
    face.castShadow = false;
    // The lips over the slots drawn in panel.svg: 5 columns by 13 rows on the louvred half.
    const lips = new InstancedMesh(LIP, m.blue, 65);
    const matrix = new Matrix4();
    for (let column = 0; column < 5; column++) {
      for (let row = 0; row < 13; row++) {
        const x = ((40 + 54 * column) / 557 - 0.5) * (PANEL_W - 0.006) * (mirrored ? -1 : 1), y = (0.5 - (34 + 36 * row) / 500) * (PANEL_H - 0.004) + 0.0035;
        lips.setMatrixAt(column * 13 + row, matrix.makeTranslation(x, y, 0.0003));
      }
    }
    shop.kit.add(lips, "tool_panel", [0, 0, 0], panel);
    // Four screws at the corners.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) shop.roll("tool_panel", "z", 0.0045, 0.002, [sx * (PANEL_W / 2 - 0.014), sy * (PANEL_H / 2 - 0.012), 0.001], m.steel, panel, 0.0045, 10);
  }
}

function buildShelf(shop: Shop, handles: { strip: Mesh | null }): void {
  const { m } = shop;
  const shelf = shop.group("station-shelf");
  const y = S.shelf - SHELF_T / 2, z = (BOARD_BACK + SHELF_FRONT) / 2;
  shop.soft("station_shelf", [WIDTH, SHELF_T, SHELF_DEPTH], 0.003, [CX, y, z], m.laminate, shelf);
  shop.soft("station_shelf", [WIDTH + 0.002, SHELF_T + 0.004, 0.006], 0.002, [CX, y, SHELF_FRONT + 0.002], m.alu, shelf, 1);
  // Brackets from the uprights.
  const bracket = extrudeX([[0, 0], [SHELF_DEPTH - 0.04, 0], [SHELF_DEPTH - 0.04, -0.02], [0, -0.16]], 0.005);
  for (let i = 0; i < 4; i++) shop.mesh("station_shelf", bracket, [uprightX(i) + (i === 3 ? -0.012 : i === 0 ? 0.012 : 0), S.shelf - SHELF_T, BOARD_BACK], m.frame, shelf);
  // The luminaire under the front edge: an aluminium channel with a diffuser that glows.
  const length = 1.6, ly = S.shelf - SHELF_T, lz = SHELF_FRONT - 0.03;
  shop.soft("strip_light", [length + 0.03, 0.012, 0.024], 0.002, [CX, ly - 0.006, lz], m.alu, shelf, 1);
  for (const side of [-1, 1]) shop.soft("strip_light", [0.008, 0.016, 0.026], 0.002, [CX + side * (length / 2 + 0.018), ly - 0.008, lz], m.white, shelf, 1);
  const strip = shop.soft("strip_light_glow", [length, 0.006, 0.012], 0.0025, [CX, ly - 0.0135, lz], m.strip, shelf, 2);
  strip.castShadow = false;
  handles.strip = strip;
  shop.cable("strip_light", [[CX - length / 2 - 0.02, ly - 0.008, lz], [CX - length / 2 - 0.05, ly - 0.012, lz - 0.05], [CX - length / 2 - 0.06, ly - 0.008, BOARD_BACK + 0.03], [uprightX(0) + 0.03, ly - 0.07, BOARD_BACK + 0.004]], 0.002, m.white, shelf);

  // On the shelf: an opened carton of parts, component reels, small boxes.
  const top = S.shelf;
  const carton = shop.group("parts-carton", [2.02, top, z + 0.01], shelf);
  carton.rotation.y = 0.08;
  const cw = 0.3, ch = 0.11, cd = 0.2, ct = 0.004;
  shop.box("parts_carton", [cw, ct, cd], [0, ct / 2, 0], m.kraft, carton);
  for (const side of [-1, 1]) {
    shop.box("parts_carton", [cw, ch, ct], [0, ch / 2, side * (cd - ct) / 2], m.kraft, carton);
    shop.box("parts_carton", [ct, ch, cd - 2 * ct], [side * (cw - ct) / 2, ch / 2, 0], m.kraft, carton);
  }
  // Flaps: the long ones stand open, the short ones lie out.
  const back = shop.box("parts_carton", [cw - 0.004, cd / 2, 0.003], [0, ch + cd / 4 * Math.cos(0.25), -cd / 2 - cd / 4 * Math.sin(0.25)], m.kraft, carton);
  back.rotation.x = -0.25;
  const front = shop.box("parts_carton", [cw - 0.004, cd / 2, 0.003], [0, ch - cd / 4 * Math.sin(0.5), cd / 2 + cd / 4 * Math.cos(0.5)], m.kraft, carton);
  front.rotation.x = Math.PI / 2 + 0.5;
  for (const side of [-1, 1]) {
    const flap = shop.box("parts_carton", [cd / 2, 0.003, cd - 0.01], [side * (cw / 2 + cd / 4 * Math.cos(0.5)), ch + cd / 4 * Math.sin(0.5), 0], m.kraft, carton);
    flap.rotation.z = side * 0.5;
  }
  // Inside: bags and small boxes, up to the rim.
  const fill: [V3, V3, MeshStandardMaterial][] = [[[0.11, 0.07, 0.15], [-0.085, 0.06, 0], m.white], [[0.08, 0.09, 0.07], [0.02, 0.075, -0.05], m.blue], [[0.085, 0.06, 0.08], [0.02, 0.05, 0.045], m.dark], [[0.07, 0.085, 0.16], [0.105, 0.07, 0], m.alu]];
  for (const [size, at, material] of fill) shop.soft("parts_carton", size, 0.004, at, material, carton, 1);
  shop.sticker("parts_carton", 0.09, 0.028, ART.reel, [0.03, ch * 0.55, cd / 2 + 0.0004], carton);

  // A stack of 7-inch reels with a label, and two small cartons at the left.
  const reels = shop.group("reel-stack", [2.76, top, z + 0.02], shelf);
  for (let i = 0; i < 5; i++) {
    const dx = [0, 0.004, -0.003, 0.002, -0.005][i]!, dz = [0, -0.003, 0.004, 0.001, 0.003][i]!;
    shop.drum("reel", 0.089, 0.0115, [dx, 0.006 + i * 0.012, dz], i % 2 ? m.dark : m.blue, reels, 0.089, 28);
  }
  const reelLabel = shop.mesh("reel", sheet(0.075, 0.023, ART.reel), [0.02, 0.0605, 0.03], m.print, reels);
  reelLabel.rotation.set(-Math.PI / 2, 0, 0.3);
  const standing = shop.drum("reel", 0.089, 0.0115, [0.16, 0.089, -0.085], m.dark, reels, 0.089, 28);
  standing.rotation.set(Math.PI / 2 - 0.14, 0, 0);
  shop.drum("reel", 0.03, 0.013, [0.16, 0.089, -0.0845], m.white, reels, 0.03, 20).rotation.set(Math.PI / 2 - 0.14, 0, 0);

  const small = shop.group("parts-boxes", [1.5, top, z], shelf);
  shop.soft("parts_box", [0.24, 0.085, 0.17], 0.003, [0, 0.0425, 0], m.kraft, small, 1).rotation.y = -0.06;
  shop.box("parts_box", [0.045, 0.0006, 0.172], [0, 0.0853, 0], m.amber, small).rotation.y = -0.06;
  shop.soft("parts_box", [0.17, 0.05, 0.12], 0.004, [-0.01, 0.111, 0.005], m.white, small, 1).rotation.y = 0.12;
  const sticker = shop.sticker("parts_box", 0.075, 0.023, ART.reel, [-0.01, 0.111, 0.0655], small);
  sticker.rotation.y = 0.12;
  sticker.position.set(-0.01 + 0.0605 * Math.sin(0.12), 0.111, 0.005 + 0.0605 * Math.cos(0.12));
  shop.soft("parts_box", [0.1, 0.12, 0.1], 0.006, [0.2, 0.06, 0.01], m.blue, small, 1);
  shop.soft("parts_box", [0.104, 0.012, 0.104], 0.004, [0.2, 0.123, 0.01], m.white, small, 1);
}

// ----------------------------------------------------------------------------------------------- tools on the panels

/** Pliers hanging in a rail, jaws up: the handles' colour makes the kind. */
function pliers(shop: Shop, parent: Parent, at: V3, grip: MeshStandardMaterial, jaw: number, spread: number): void {
  const { m } = shop;
  const tool = shop.group(null, at, parent);
  for (const side of [-1, 1]) {
    const blade = shop.soft("pliers", [0.007, jaw, 0.006], 0.0015, [side * 0.0042, 0.02 + jaw / 2, 0], m.steel, tool, 1);
    blade.rotation.z = side * 0.03;
    shop.rod("pliers", [side * 0.003, 0.014, 0], [side * (0.006 + spread * 0.25), -0.012, 0], 0.004, m.steel, tool, 8);
    shop.rod("pliers", [side * (0.006 + spread * 0.25), -0.012, 0], [side * spread, -0.105, 0], 0.0062, grip, tool, 10);
    shop.ball("pliers", 0.0062, [side * spread, -0.105, 0], grip, tool);
  }
  shop.roll("pliers", "z", 0.0095, 0.009, [0, 0.017, 0], m.steel, tool, 0.0095, 12);
}

function buildPanelTools(shop: Shop): void {
  const { m } = shop;
  const z = FACE;
  // Panel 0, perforated half: a rail of pliers and cutters.
  const rail0 = shop.group("pliers-rail", [panelX(0) + 0.135, 1.31, z]);
  shop.soft("tool_holder", [0.225, 0.024, 0.006], 0.002, [0, 0.004, 0.003], m.red, rail0, 1);
  shop.soft("tool_holder", [0.225, 0.012, 0.034], 0.003, [0, -0.002, 0.02], m.red, rail0, 1);
  const kinds: [number, MeshStandardMaterial, number, number][] = [[-0.08, m.red, 0.05, 0.024], [-0.027, m.yellow, 0.036, 0.021], [0.027, m.red, 0.058, 0.023], [0.08, m.blue, 0.04, 0.02]];
  for (const [x, grip, jaw, spread] of kinds) pliers(shop, rail0, [x, -0.008, 0.02], grip, jaw, spread);
  for (let i = 0; i < 3; i++) shop.sticker("tool_label", 0.034, 0.0127, ART.label(i), [panelX(0) + 0.075 + i * 0.062, 1.418, z + 0.0006]);

  // Panel 1, perforated half: a rack of screwdrivers.
  const rack = shop.group("screwdriver-rack", [panelX(1) - 0.135, 1.33, z]);
  shop.soft("tool_holder", [0.215, 0.034, 0.005], 0.002, [0, 0.012, 0.0025], m.red, rack, 1);
  shop.soft("tool_holder", [0.215, 0.006, 0.042], 0.002, [0, 0, 0.024], m.red, rack, 1);
  const grips = [m.yellow, m.red, m.dark, m.yellow, m.blue, m.red];
  for (let i = 0; i < 6; i++) {
    const x = -0.085 + i * 0.034, big = i < 3 ? 1 : 0.8;
    shop.drum("screwdriver", 0.0105 * big, 0.062 * big, [x, 0.003 + 0.031 * big + 0.008, 0.026], grips[i]!, rack, 0.0085 * big, 12);
    shop.drum("screwdriver", 0.0062 * big, 0.01, [x, 0.008, 0.026], m.dark, rack, 0.0062 * big, 10);
    shop.drum("screwdriver", 0.0024 * big, 0.085 * big, [x, -0.0425 * big, 0.026], m.steel, rack, 0.0024 * big, 8);
    shop.ball("screwdriver", 0.0086 * big, [x, 0.003 + 0.062 * big + 0.008, 0.026], grips[i]!, rack).scale.y = 0.0045 * big;
  }
  shop.sticker("tool_label", 0.034, 0.0127, ART.label(3), [panelX(1) - 0.135, 1.418, z + 0.0006]);
  // Tweezers and a roll of tape on hooks beside it.
  const hookX = panelX(1) - 0.245;
  shop.rod("tool_hook", [hookX, 1.2, z], [hookX, 1.2, z + 0.045], 0.002, m.steel);
  shop.rod("tool_hook", [hookX, 1.2, z + 0.045], [hookX, 1.212, z + 0.05], 0.002, m.steel);
  const tape = shop.mesh("tape_roll", new TorusGeometry(0.036, 0.011, 8, 24), [hookX, 1.166, z + 0.02], m.yellow);
  tape.scale.z = 1.6;
  const tape2 = shop.mesh("tape_roll", new TorusGeometry(0.03, 0.009, 8, 24), [hookX + 0.012, 1.172, z + 0.04], m.dark);
  tape2.scale.z = 1.5;
  tape2.rotation.z = 0.2;

  // Panel 2, perforated half: side cutters, a wrist strap and a spool on a peg.
  const rail2 = shop.group("cutters-rail", [panelX(2) + 0.135, 1.31, z]);
  shop.soft("tool_holder", [0.14, 0.024, 0.006], 0.002, [-0.04, 0.004, 0.003], m.red, rail2, 1);
  shop.soft("tool_holder", [0.14, 0.012, 0.034], 0.003, [-0.04, -0.002, 0.02], m.red, rail2, 1);
  pliers(shop, rail2, [-0.08, -0.008, 0.02], m.yellow, 0.034, 0.02);
  pliers(shop, rail2, [-0.03, -0.008, 0.02], m.dark, 0.05, 0.022);
  pliers(shop, rail2, [0.006, -0.008, 0.02], m.blue, 0.03, 0.017);
  shop.sticker("tool_label", 0.034, 0.0127, ART.label(1), [panelX(2) + 0.075, 1.418, z + 0.0006]);
  shop.sticker("tool_label", 0.034, 0.0127, ART.label(4), [panelX(2) + 0.137, 1.418, z + 0.0006]);
  const pegX = panelX(2) + 0.215;
  shop.rod("tool_hook", [pegX, 1.3, z], [pegX, 1.305, z + 0.06], 0.0025, m.steel);
  shop.roll("solder_spool", "z", 0.03, 0.004, [pegX, 1.3, z + 0.012], m.white, undefined, 0.03, 20);
  shop.roll("solder_spool", "z", 0.022, 0.03, [pegX, 1.3, z + 0.029], m.steel, undefined, 0.022, 20);
  shop.roll("solder_spool", "z", 0.03, 0.004, [pegX, 1.3, z + 0.046], m.white, undefined, 0.03, 20);
  // A coiled wrist strap cord hanging from a hook.
  const strapX = panelX(2) + 0.2;
  shop.rod("tool_hook", [strapX, 1.13, z], [strapX, 1.134, z + 0.04], 0.002, m.steel);
  const coil: V3[] = [];
  for (let i = 0; i <= 90; i++) { const t = i / 90, a = t * TAU * 9; coil.push([strapX + Math.cos(a) * 0.007, 1.13 - t * 0.13, z + 0.028 + Math.sin(a) * 0.007]); }
  shop.mesh("wrist_strap", tube(coil, 0.0016, 5), [0, 0, 0], m.blue);
  shop.soft("wrist_strap", [0.03, 0.012, 0.02], 0.004, [strapX, 0.993, z + 0.028], m.blue, undefined, 1);

  // Small part bins hooked on the louvres: open fronts, labels on the lips.
  const bins: [number, number, number, MeshStandardMaterial, number][] = [
    [0, -0.215, 1.375, m.red, 5], [0, -0.108, 1.375, m.blue, 6], [0, -0.215, 1.303, m.yellow, 7],
    [1, 0.215, 1.375, m.yellow, 6], [1, 0.108, 1.375, m.red, 7], [1, 0.215, 1.303, m.blue, 5], [1, 0.108, 1.303, m.blue, 6],
    [2, -0.215, 1.375, m.blue, 7], [2, -0.108, 1.375, m.red, 5], [2, -0.215, 1.303, m.red, 6], [2, -0.108, 1.303, m.yellow, 7], [2, -0.215, 1.231, m.yellow, 5], [2, -0.108, 1.231, m.blue, 6],
  ];
  const contents = [m.kraft, m.steel, m.dark, m.white];
  bins.forEach(([panel, dx, y, material, label], i) => {
    const bin = shop.group(`part-bin-${i}`, [panelX(panel) + dx, y, z + 0.004]);
    const w = 0.1, h = 0.052, d = 0.092, t = 0.002;
    shop.box("part_bin", [w, t, d], [0, t / 2, d / 2], material, bin);
    shop.box("part_bin", [w, h + 0.012, t], [0, (h + 0.012) / 2, t / 2], material, bin);
    for (const side of [-1, 1]) shop.mesh("part_bin", BIN_SIDE, [side * (w - t) / 2, 0, 0], material, bin);
    const lip = shop.box("part_bin", [w, h * 0.52, t], [0, h * 0.24, d + 0.004], material, bin);
    lip.rotation.x = 0.3;
    shop.box("part_bin", [w - 2 * t - 0.002, h * 0.3, d - 0.008], [0, t + h * 0.15, d / 2], contents[i % contents.length]!, bin);
    const sticker = shop.sticker("part_bin", 0.056, 0.021, ART.label(label), [0, h * 0.25, d + 0.0058], bin);
    sticker.rotation.x = 0.3;
  });
}
/** A bin's side wall: full height at the back, cut down toward the open front. */
const BIN_SIDE = extrudeX([[0, 0], [0.092, 0], [0.1, 0.027], [0.05, 0.052], [0, 0.064]], 0.002);

// ----------------------------------------------------------------------------------------------- on the bench

function buildMicroscope(shop: Shop): void {
  const { m } = shop;
  const scope = shop.group("microscope", [1.5, S.top, -0.47]);
  scope.rotation.y = 0.12;
  // The base: a white plate with a dark work pad, and the pillar at the back.
  shop.soft("microscope", [0.2, 0.014, 0.27], 0.004, [0, 0.007, 0], m.white, scope);
  const pad = shop.mesh("microscope", roundedPlate(0.15, 0.17, 0.0015, 0.006), [0, 0.0146, 0.03], m.silicone, scope);
  pad.rotation.x = -Math.PI / 2;
  for (const [x, z] of [[-0.085, -0.12], [0.085, -0.12], [-0.085, 0.12], [0.085, 0.12]] as [number, number][]) shop.drum("microscope", 0.008, 0.003, [x, 0.0005, z], m.rubber, scope, 0.008, 10);
  const pz = -0.105;
  shop.drum("microscope", 0.021, 0.022, [0, 0.025, pz], m.alu, scope, 0.017);
  shop.drum("microscope", 0.0125, 0.36, [0, 0.194, pz], m.steel, scope, 0.0125, 20);
  shop.drum("microscope", 0.0135, 0.006, [0, 0.376, pz], m.dark, scope, 0.0135, 16);
  // The focus block on the pillar with its two knobs, and the arm to the camera.
  const hy = 0.27;
  shop.soft("microscope", [0.062, 0.075, 0.056], 0.006, [0, hy, pz + 0.004], m.dark, scope);
  for (const side of [-1, 1]) {
    shop.roll("microscope", "x", 0.017, 0.018, [side * 0.04, hy - 0.005, pz + 0.004], m.dark, scope, 0.017, 18);
    shop.roll("microscope", "x", 0.0185, 0.004, [side * 0.05, hy - 0.005, pz + 0.004], m.alu, scope, 0.0185, 18);
  }
  shop.roll("microscope", "x", 0.006, 0.02, [0.04, hy + 0.024, pz - 0.012], m.steel, scope, 0.006, 10);
  shop.soft("microscope", [0.04, 0.034, 0.07], 0.005, [0, hy + 0.004, pz + 0.062], m.dark, scope);
  // The camera: a black body, the zoom lens, the ring light.
  const cz = 0.02;
  shop.soft("microscope", [0.066, 0.064, 0.074], 0.006, [0, hy, cz], m.dark, scope, 3);
  shop.box("microscope", [0.03, 0.012, 0.0006], [0, hy + 0.012, cz + 0.0373], m.alu, scope);
  shop.drum("microscope", 0.026, 0.05, [0, hy - 0.056, cz], m.dark, scope, 0.028);
  shop.drum("microscope", 0.0295, 0.02, [0, hy - 0.07, cz], m.alu, scope, 0.0295, 24);
  shop.drum("microscope", 0.023, 0.034, [0, hy - 0.097, cz], m.dark, scope, 0.025);
  shop.drum("microscope", 0.041, 0.016, [0, hy - 0.118, cz], m.dark, scope, 0.038, 24);
  const lens = shop.drum("microscope", 0.017, 0.002, [0, hy - 0.1262, cz], m.lens, scope, 0.017, 20);
  lens.castShadow = false;
  const ring = shop.mesh("microscope_ring_light", new RingGeometry(0.022, 0.035, 28), [0, hy - 0.1264, cz], m.ring, scope);
  ring.rotation.x = Math.PI / 2;
  ring.castShadow = false;
  // The monitor on a bracket over the camera, tipped back a little.
  shop.soft("microscope", [0.03, 0.07, 0.012], 0.003, [0, hy + 0.06, cz - 0.03], m.dark, scope, 1);
  const monitor = shop.group("microscope-monitor", [0, hy + 0.168, cz - 0.012], scope);
  monitor.rotation.x = -0.17;
  const mw = 0.246, mh = 0.164;
  shop.soft("microscope_monitor", [mw, mh, 0.017], 0.006, [0, 0, 0], m.dark, monitor, 3);
  shop.mesh("microscope_monitor", roundedPlate(mw - 0.006, mh - 0.006, 0.001, 0.004), [0, 0, 0.0086], m.lens, monitor).castShadow = false;
  const picture = shop.mesh("microscope_screen", uvPlane(0.2175, 0.136), [0, 0.003, 0.0093], m.screen, monitor);
  picture.castShadow = false;
  shop.soft("microscope_monitor", [0.075, 0.075, 0.012], 0.004, [0, -0.01, -0.0135], m.dark, monitor, 1);
  for (let i = 0; i < 4; i++) shop.soft("microscope_monitor", [0.007, 0.003, 0.003], 0.001, [0.07 + i * 0.012, -mh / 2 - 0.0008, 0.002], m.alu, monitor, 1);
  // Cables: camera to monitor, and power down the back.
  shop.cable("microscope_cable", [[0.034, hy + 0.01, cz - 0.02], [0.07, hy + 0.03, cz - 0.03], [0.08, hy + 0.1, cz - 0.045], [0.05, hy + 0.15, cz - 0.04]], 0.002, m.rubber, scope);
  shop.cable("microscope_cable", [[-0.06, hy + 0.14, cz - 0.04], [-0.1, hy + 0.08, cz - 0.07], [-0.115, 0.08, pz - 0.03], [-0.11, 0.004, pz - 0.06], [-0.06, 0.003, pz - 0.14], [0.02, 0.003, pz - 0.2]], 0.0022, m.rubber, scope);
  // A board under the lens.
  const board = shop.mesh("microscope_sample", slab(0.072, 0.0495, 0.0016, ART.pcb, [30, 40]), [0.004, 0.0162, cz + 0.004], m.print, scope);
  board.rotation.y = -0.3;
}

function buildExtractor(shop: Shop): void {
  const { m } = shop;
  const unit = shop.group("fume-extractor", [2.31, S.top, -0.655]);
  unit.rotation.y = -0.1;
  const w = 0.2, h = 0.24, d = 0.2;
  shop.soft("fume_extractor", [w, h, d], 0.012, [0, h / 2 + 0.006, 0], m.white, unit, 3);
  shop.sticker("fume_extractor", w - 0.024, h - 0.03, ART.extractor, [0, h / 2 + 0.006, d / 2 + 0.0003], unit);
  shop.roll("fume_extractor", "z", 0.015, 0.014, [0.059, 0.039, d / 2 + 0.007], m.dark, unit, 0.014, 18);
  shop.box("fume_extractor", [0.002, 0.012, 0.0006], [0.059, 0.046, d / 2 + 0.0144], m.white, unit);
  for (const [x, z] of [[-0.075, -0.075], [0.075, -0.075], [-0.075, 0.075], [0.075, 0.075]] as [number, number][]) shop.drum("fume_extractor", 0.012, 0.007, [x, 0.0035, z], m.rubber, unit, 0.012, 12);
  shop.soft("fume_extractor", [0.09, 0.006, 0.02], 0.003, [0, h + 0.012, -0.07], m.dark, unit, 1);
  // The hose: out of the top, over, and down to the work spot, ending in a hood.
  const top = h + 0.006;
  shop.drum("fume_hose", 0.043, 0.02, [0, top + 0.01, 0.01], m.white, unit, 0.039, 24);
  const path = curve([[0, top + 0.015, 0.01], [0, top + 0.1, 0.012], [-0.035, top + 0.2, 0.07], [-0.105, top + 0.22, 0.185], [-0.165, top + 0.12, 0.28], [-0.19, top - 0.01, 0.325], [-0.195, top - 0.07, 0.335]], 10);
  shop.mesh("fume_hose", ribbedTube(path, 0.031, 0.0055, 0.0085, 18), [0, 0, 0], m.hose, unit);
  const end = new Vector3(...path[path.length - 1]!), before = new Vector3(...path[path.length - 4]!);
  const along = new Vector3().subVectors(end, before).normalize();
  const hood = shop.group("fume-hood", [end.x, end.y, end.z], unit);
  hood.quaternion.setFromAxisAngle(new Vector3().crossVectors(new Vector3(0, -1, 0), along).normalize(), Math.acos(Math.max(-1, Math.min(1, -along.y))));
  shop.drum("fume_hose", 0.039, 0.024, [0, -0.008, 0], m.white, hood, 0.039, 24);
  const mouth = shop.mesh("fume_hose", lathe([[0.036, -0.02], [0.04, -0.03], [0.074, -0.082], [0.077, -0.088], [0.073, -0.088], [0.036, -0.032], [0.0, -0.03]], 4), [0, 0, 0], m.hose, hood);
  mouth.rotation.y = Math.PI / 4;
  mouth.scale.set(1.25, 1, 0.8);
}

function buildRework(shop: Shop): void {
  const { m } = shop;
  const unit = shop.group("rework-station", [2.73, S.top, -0.6]);
  unit.rotation.y = -0.16;
  const w = 0.19, h = 0.13, d = 0.22;
  shop.soft("rework_station", [w, h, d], 0.008, [0, h / 2 + 0.008, 0], m.white, unit, 3);
  shop.sticker("rework_station", w - 0.012, h - 0.012, ART.rework, [0, h / 2 + 0.008, d / 2 + 0.0003], unit);
  const px = (mmx: number) => ((mmx - 95) / 190) * (w - 0.012), py = (mmy: number) => 0.008 + h / 2 + ((65 - mmy) / 130) * (h - 0.012);
  const lcd = shop.mesh("rework_lcd", uvPlane(0.08 * (w - 0.012) / 0.19, 0.028 * (h - 0.012) / 0.13), [px(95), py(31), d / 2 + 0.0006], m.lcd, unit);
  lcd.castShadow = false;
  for (const kx of [45, 145]) {
    shop.roll("rework_station", "z", 0.0165, 0.016, [px(kx), py(88), d / 2 + 0.008], m.dark, unit, 0.0145, 20);
    shop.box("rework_station", [0.002, 0.011, 0.0006], [px(kx) + 0.004, py(88) + 0.008, d / 2 + 0.0164], m.white, unit).rotation.z = -0.5;
  }
  for (const [x, z] of [[-0.07, -0.085], [0.07, -0.085], [-0.07, 0.085], [0.07, 0.085]] as [number, number][]) shop.drum("rework_station", 0.011, 0.008, [x, 0.004, z], m.rubber, unit, 0.011, 12);
  // Vent slots on the side toward the room, and the air outlet with the handpiece's hose.
  for (let i = 0; i < 6; i++) shop.box("rework_station", [0.0008, 0.05, 0.005], [-w / 2 - 0.0002, h / 2 + 0.02, -0.06 + i * 0.012], m.dark, unit);
  shop.roll("rework_station", "x", 0.011, 0.016, [-w / 2 - 0.006, 0.04, 0.06], m.dark, unit, 0.011, 14);
  // The cradle on the left side: a steel bracket with a fork.
  const cx = -w / 2 - 0.036, cy = 0.1, cz = 0.02;
  shop.box("rework_cradle", [0.003, 0.05, 0.05], [-w / 2 - 0.0016, cy - 0.01, cz], m.steel, unit);
  shop.soft("rework_cradle", [0.036, 0.004, 0.04], 0.0015, [-w / 2 - 0.018, cy - 0.03, cz], m.steel, unit, 1);
  for (const dz of [-0.022, 0.022]) shop.soft("rework_cradle", [0.05, 0.03, 0.003], 0.001, [cx, cy - 0.016, cz + dz], m.steel, unit, 1);
  // The handpiece lies in the fork, nozzle up and forward.
  const tool = shop.group("rework-handpiece", [cx, cy + 0.004, cz], unit);
  tool.rotation.x = Math.PI / 2 - 0.42;
  shop.drum("rework_handpiece", 0.0165, 0.12, [0, -0.045, 0], m.dark, tool, 0.019, 18);
  shop.drum("rework_handpiece", 0.02, 0.012, [0, 0.021, 0], m.dark, tool, 0.02, 18);
  shop.drum("rework_handpiece", 0.0135, 0.075, [0, 0.064, 0], m.steel, tool, 0.0135, 18);
  shop.drum("rework_handpiece", 0.0135, 0.022, [0, 0.112, 0], m.steel, tool, 0.0045, 18);
  shop.drum("rework_handpiece", 0.013, 0.012, [0, -0.111, 0], m.rubber, tool, 0.0165, 14);
  // Its hose: from the tail, down to the mat and round to the outlet.
  const tail: V3 = [cx, cy + 0.004 - 0.117 * Math.sin(0.42), cz - 0.117 * Math.cos(0.42)];
  shop.cable("rework_hose", [tail, [cx - 0.004, tail[1] - 0.03, tail[2] - 0.05], [cx - 0.03, 0.012, tail[2] - 0.03], [cx - 0.05, 0.0075, cz + 0.02], [cx - 0.02, 0.012, 0.075], [-w / 2 - 0.016, 0.04, 0.06]], 0.0062, m.rubber, unit, 8, 8);
  shop.cable("rework_cable", [[0.03, 0.04, -d / 2], [0.04, 0.02, -d / 2 - 0.03], [0.09, 0.004, -d / 2 - 0.04]], 0.003, m.rubber, unit);
}

function buildSolderStand(shop: Shop): void {
  const { m } = shop;
  const stand = shop.group("solder-stand", [2.515, S.top, -0.55]);
  stand.rotation.y = 0.5;
  shop.soft("solder_stand", [0.075, 0.018, 0.13], 0.005, [0, 0.009, 0], m.dark, stand);
  // The brass wool in its cup at the front.
  shop.drum("solder_stand", 0.027, 0.02, [0, 0.026, 0.035], m.steel, stand, 0.029, 18);
  const wool = shop.ball("solder_stand", 0.026, [0, 0.036, 0.035], m.amber, stand);
  wool.scale.y = 0.014;
  // The spring holder: a coil that widens toward its mouth, tipped up.
  const tilt = 0.75, sin = Math.sin(tilt), cos = Math.cos(tilt);
  const coil: V3[] = [];
  for (let i = 0; i <= 150; i++) {
    const t = i / 150, a = t * TAU * 12, r = 0.0095 + 0.007 * t * t, l = t * 0.085;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    coil.push([x, 0.04 + y * sin * 0 + l * sin + y * cos, -0.045 + l * cos * -1 * -1 - y * sin]);
  }
  shop.mesh("solder_stand", tube(coil, 0.0011, 5), [0, 0, 0], m.steel, stand);
  shop.rod("solder_stand", [0, 0.018, -0.045], [0, 0.04, -0.045], 0.003, m.steel, stand, 8);
  // The iron in it: the handle and its cord.
  const at = (l: number): V3 => [0, 0.04 + l * sin, -0.045 + l * cos];
  shop.rod("solder_iron", at(-0.01), at(0.07), 0.0032, m.steel, stand, 8);
  shop.rod("solder_iron", at(0.07), at(0.095), 0.0085, m.dark, stand, 12);
  shop.rod("solder_iron", at(0.095), at(0.2), 0.0105, m.blue, stand, 14);
  shop.rod("solder_iron", at(0.2), at(0.225), 0.006, m.rubber, stand, 10);
  shop.cable("solder_iron", [at(0.225), at(0.27), [0.02, 0.2, 0.18], [0.07, 0.06, 0.19], [0.12, 0.004, 0.12], [0.16, 0.003, 0.0], [0.15, 0.003, -0.12]], 0.0025, m.rubber, stand, 8);
}

function buildWorkMat(shop: Shop): void {
  const { m } = shop;
  const mat = shop.group("work-mat", [2.0, S.top, -0.31]);
  mat.rotation.y = 0.03;
  const w = 0.45, d = 0.3;
  const plate = shop.mesh("work_mat", roundedPlate(w, d, 0.003, 0.012), [0, 0.0015, 0], m.silicone, mat);
  plate.rotation.x = -Math.PI / 2;
  // A raised rim, and a row of screw compartments along the far edge.
  const rim = 0.0022, ry = 0.003 + rim / 2;
  shop.soft("work_mat", [w - 0.012, rim, 0.005], 0.001, [0, ry, -d / 2 + 0.006], m.silicone, mat, 1);
  shop.soft("work_mat", [w - 0.012, rim, 0.005], 0.001, [0, ry, d / 2 - 0.006], m.silicone, mat, 1);
  shop.soft("work_mat", [w - 0.012, rim, 0.004], 0.001, [0, ry, -d / 2 + 0.062], m.silicone, mat, 1);
  for (const side of [-1, 1]) shop.soft("work_mat", [0.005, rim, d - 0.012], 0.001, [side * (w / 2 - 0.006), ry, 0], m.silicone, mat, 1);
  for (let i = 1; i < 8; i++) shop.soft("work_mat", [0.004, rim, 0.054], 0.001, [-w / 2 + 0.006 + i * (w - 0.012) / 8, ry, -d / 2 + 0.034], m.silicone, mat, 1);
  const random = rng(905);
  for (let i = 0; i < 16; i++) {
    const cell = Math.floor(random() * 5), x = -w / 2 + 0.02 + (cell + random() * 0.6) * (w - 0.012) / 8, z = -d / 2 + 0.016 + random() * 0.036;
    const screw = shop.drum("work_mat_screw", 0.0011, 0.006, [x, 0.0041, z], i % 4 ? m.steel : m.dark, mat, 0.0011, 6);
    screw.rotation.set(Math.PI / 2, 0, random() * 3);
    shop.drum("work_mat_screw", 0.002, 0.0012, [x + Math.sin(screw.rotation.z) * 0.003, 0.0041, z + Math.cos(screw.rotation.z) * 0.003], i % 4 ? m.steel : m.dark, mat, 0.002, 6).rotation.copy(screw.rotation);
  }
  // The board being worked on, with a few parts standing on it.
  const board = shop.group("work-board", [0.05, 0.003, 0.035], mat);
  board.rotation.y = 0.2;
  shop.mesh("work_board", slab(0.08, 0.055, 0.0016, ART.pcb, [30, 40]), [0, 0.0008, 0], m.print, board);
  const onBoard = (mmx: number, mmy: number): [number, number] => [(mmx - 40) * mm, (mmy - 27.5) * mm];
  const [ux, uz] = onBoard(40, 20.5);
  shop.soft("work_board", [0.012, 0.0014, 0.014], 0.0003, [ux, 0.0023, uz], m.dark, board, 1);
  const [ax, az] = onBoard(67, 40);
  shop.soft("work_board", [0.013, 0.0024, 0.016], 0.0005, [ax, 0.0028, az], m.alu, board, 1);
  const [jx, jz] = onBoard(9.2, 18.5);
  shop.soft("work_board", [0.0045, 0.0052, 0.0125], 0.0006, [jx - 0.0026, 0.0042, jz], m.white, board, 1);
  const [hx, hz] = onBoard(28, 49);
  shop.soft("work_board", [0.0325, 0.0025, 0.0026], 0.0004, [hx, 0.0029, hz], m.dark, board, 1);
  for (let i = 0; i < 8; i++) shop.box("work_board", [0.0006, 0.006, 0.0006], [hx - 0.014 + i * 0.004, 0.0072, hz], m.steel, board);
  const [ex, ez] = onBoard(56, 10);
  shop.drum("work_board", 0.004, 0.008, [ex, 0.0056, ez], m.dark, board, 0.004, 12);
  shop.drum("work_board", 0.0036, 0.0003, [ex, 0.0098, ez], m.alu, board, 0.0036, 12);

  // Tweezers, a precision screwdriver, a flux pen.
  const tweezers = shop.group("tweezers", [0.14, 0.0034, 0.07], mat);
  tweezers.rotation.y = -0.5;
  for (const side of [-1, 1]) {
    const blade = shop.mesh("tweezers", TWEEZER, [side * 0.0022, 0.0022, 0], m.steel, tweezers);
    blade.rotation.y = side * 0.035;
    blade.scale.x = side;
  }
  const driver = shop.group("precision-driver", [-0.12, 0.003, 0.085], mat);
  driver.rotation.y = 1.25;
  shop.roll("precision_driver", "x", 0.0048, 0.075, [0, 0.0048, 0], m.blue, driver, 0.0048, 12);
  shop.roll("precision_driver", "x", 0.0054, 0.012, [-0.044, 0.0054, 0], m.alu, driver, 0.0054, 12);
  shop.roll("precision_driver", "x", 0.0014, 0.05, [0.0625, 0.0048, 0], m.steel, driver, 0.0014, 8);
  const pen = shop.group("flux-pen", [0.165, 0.003, -0.03], mat);
  pen.rotation.y = 0.9;
  shop.roll("flux_pen", "x", 0.0062, 0.1, [0, 0.0062, 0], m.white, pen, 0.0062, 12);
  shop.roll("flux_pen", "x", 0.0066, 0.03, [0.064, 0.0066, 0], m.yellow, pen, 0.0066, 12);
}
/** One blade of a pair of tweezers: wide at the joined end, a point at the tip. */
const TWEEZER = taperedBar(0.12, 0.0009, 0.009, 0.0009, 0.0012, 0, 0.0003).rotateY(Math.PI / 2);

function buildBenchClutter(shop: Shop): void {
  const { m } = shop;
  // The alcohol bottle with its pump top.
  const bottle = shop.group("ipa-bottle", [2.44, S.top, -0.4]);
  bottle.rotation.y = -0.35;
  shop.mesh("ipa_bottle", lathe([[0, 0], [0.028, 0], [0.031, 0.004], [0.031, 0.074], [0.028, 0.086], [0.0185, 0.094], [0.0185, 0.1], [0, 0.1]], 22), [0, 0, 0], m.bottle, bottle);
  shop.drum("ipa_bottle", 0.021, 0.014, [0, 0.105, 0], m.steel, bottle, 0.021, 20);
  shop.mesh("ipa_bottle", lathe([[0, 0.112], [0.012, 0.112], [0.029, 0.121], [0.03, 0.1235], [0.027, 0.1235], [0.011, 0.1165], [0, 0.1165]], 22), [0, 0, 0], m.steel, bottle);
  shop.drum("ipa_bottle", 0.004, 0.006, [0, 0.118, 0], m.steel, bottle, 0.004, 10);
  shop.mesh("ipa_bottle", labelBand(0.0313, 0.04, 1.9, ART.ipa), [0, 0.042, 0], m.print, bottle).castShadow = false;

  // Polyimide tape, a desoldering wick spool and a spool of solder near the mat.
  const kapton = shop.mesh("kapton_tape", lathe([[0.02, 0], [0.036, 0], [0.036, 0.012], [0.02, 0.012], [0.02, 0]], 26), [2.39, S.top, -0.2], m.amber);
  kapton.rotation.y = 0.4;
  shop.mesh("kapton_tape", lathe([[0.0195, 0.0005], [0.0195, 0.0115], [0.017, 0.0115], [0.017, 0.0005], [0.0195, 0.0005]], 26), [2.39, S.top, -0.2], m.white);
  const wick = shop.group("wick-spool", [2.3, S.top, -0.24]);
  shop.drum("wick_spool", 0.027, 0.002, [0, 0.001, 0], m.blue, wick, 0.027, 22);
  shop.drum("wick_spool", 0.019, 0.009, [0, 0.0065, 0], m.amber, wick, 0.019, 22);
  shop.drum("wick_spool", 0.027, 0.002, [0, 0.012, 0], m.blue, wick, 0.027, 22);
  shop.box("wick_spool", [0.035, 0.0008, 0.0025], [0.03, 0.006, 0.012], m.amber, wick).rotation.y = -0.4;
  const solder = shop.group("solder-spool", [2.565, S.top, -0.33]);
  shop.drum("solder_spool", 0.029, 0.004, [0, 0.002, 0], m.white, solder, 0.029, 22);
  shop.drum("solder_spool", 0.023, 0.04, [0, 0.024, 0], m.steel, solder, 0.023, 22);
  shop.drum("solder_spool", 0.029, 0.004, [0, 0.046, 0], m.white, solder, 0.029, 22);
  shop.cable("solder_spool", [[0.021, 0.03, 0.009], [0.035, 0.03, 0.03], [0.02, 0.012, 0.06], [-0.01, 0.001, 0.08], [-0.05, 0.0008, 0.085]], 0.0005, m.steel, solder, 5, 4);

  // The board holder: a bar with two sprung clamps and a board tilted in them.
  const holder = shop.group("pcb-holder", [2.83, S.top, -0.27]);
  holder.rotation.y = -0.3;
  shop.soft("pcb_holder", [0.22, 0.014, 0.04], 0.004, [0, 0.007, 0], m.dark, holder);
  for (const side of [-1, 1]) {
    shop.soft("pcb_holder", [0.035, 0.012, 0.09], 0.004, [side * 0.1, 0.006, 0], m.dark, holder, 1);
    shop.drum("pcb_holder", 0.005, 0.07, [side * 0.085, 0.049, 0], m.steel, holder, 0.005, 10);
    shop.soft("pcb_holder", [0.014, 0.022, 0.03], 0.003, [side * 0.082, 0.085, 0], m.blue, holder, 1);
    shop.roll("pcb_holder", "x", 0.007, 0.012, [side * 0.097, 0.085, 0], m.dark, holder, 0.007, 10);
  }
  const held = shop.mesh("pcb_holder", slab(0.15, 0.103, 0.0016, ART.pcb, [30, 40]), [0, 0.087, 0], m.print, holder);
  held.rotation.x = 0.35;
}

// ----------------------------------------------------------------------------------------------- chairs

const SPOKE = taperedBar(0.27, 0.036, 0.05, 0.022, 0.03, 0.03, 0.007);
const BACK = { width: 0.44, height: 0.45, radius: 0.085 };
/** How the back's surface bows: its sides come forward round the sitter, and it widens toward the top. */
const backPoint = (x: number, y: number, behind = 0): V3 => {
  const wide = x * (1 + 0.1 * (y / BACK.height + 0.5));
  return [wide, y, -0.055 * (2 * x / BACK.width) ** 2 - 0.012 * Math.cos((Math.PI * y) / BACK.height) + behind];
};
const BACK_FRAME = (() => {
  const outline = roundRect(BACK.width, BACK.height, BACK.radius, 7);
  const path = [...outline, outline[0]!, outline[1]!].map(([x, y]) => backPoint(x, y));
  return tube(path, 0.0125, 10);
})();
const BACK_MESH = (() => {
  const outline = roundRect(BACK.width - 0.01, BACK.height - 0.01, BACK.radius - 0.005, 7);
  const rings = 5, positions: number[] = [...backPoint(0, 0)], uvs: number[] = [0.5, 0.5], index: number[] = [];
  for (let k = 1; k <= rings; k++) {
    for (const [x, y] of outline) {
      positions.push(...backPoint((x * k) / rings, (y * k) / rings));
      uvs.push((x * k) / rings / BACK.width + 0.5, (y * k) / rings / BACK.width + 0.5);
    }
  }
  const n = outline.length;
  for (let i = 0; i < n; i++) index.push(0, 1 + i, 1 + ((i + 1) % n));
  for (let k = 1; k < rings; k++) {
    for (let i = 0; i < n; i++) {
      const a = 1 + (k - 1) * n + i, b = 1 + (k - 1) * n + ((i + 1) % n), c = a + n, e = b + n;
      index.push(a, c, e, a, e, b);
    }
  }
  return new MeshGeometry(positions, index, undefined, uvs);
})();

function buildChair(shop: Shop, index: number, at: [number, number], turn: number, seatHeight: number, backTilt: number): Group {
  const { m } = shop;
  const random = rng(310 + index * 17);
  const chair = shop.group(`chair-${index}`, [at[0], 0, at[1]]);
  chair.rotation.y = turn;
  // The five-star base on twin-wheel castors. It swivels independently of the seat.
  const base = shop.group(null, [0, 0, 0], chair);
  base.rotation.y = random() * TAU;
  shop.drum("chair_base", 0.036, 0.058, [0, 0.109, 0], m.dark, base, 0.03, 20);
  for (let k = 0; k < 5; k++) {
    const arm = shop.group(null, [0, 0, 0], base);
    arm.rotation.y = (k / 5) * TAU;
    shop.mesh("chair_base", SPOKE, [0.158, 0.114, 0], m.dark, arm);
    const castor = shop.group(null, [0.29, 0, 0], arm);
    castor.rotation.y = random() * TAU;
    shop.drum("chair_castor", 0.0055, 0.03, [0, 0.063, 0], m.steel, castor, 0.0055, 8);
    shop.soft("chair_castor", [0.02, 0.026, 0.05], 0.008, [0, 0.042, -0.012], m.dark, castor, 2);
    for (const side of [-1, 1]) shop.roll("chair_castor", "x", 0.025, 0.017, [side * 0.0135, 0.025, -0.018], m.rubber, castor, 0.025, 18);
    shop.roll("chair_castor", "x", 0.008, 0.05, [0, 0.025, -0.018], m.dark, castor, 0.008, 8);
  }
  // The gas lift: the outer tube and the bright piston.
  shop.drum("chair_lift", 0.027, 0.15, [0, 0.21, 0], m.dark, chair, 0.025, 18);
  const pistonTop = seatHeight - 0.1;
  shop.drum("chair_lift", 0.014, pistonTop - 0.285, [0, (pistonTop + 0.285) / 2, 0], m.steel, chair, 0.014, 14);

  // Everything above turns and rises with the seat.
  const seat = shop.group(null, [0, seatHeight, 0], chair);
  shop.soft("chair_seat", [0.15, 0.042, 0.2], 0.008, [0, -0.101, 0.01], m.dark, seat);
  shop.rod("chair_seat", [0.07, -0.1, -0.03], [0.215, -0.106, -0.03], 0.004, m.dark, seat, 8);
  shop.soft("chair_seat", [0.05, 0.008, 0.024], 0.003, [0.235, -0.106, -0.03], m.dark, seat, 1);
  shop.soft("chair_seat", [0.46, 0.018, 0.44], 0.007, [0, -0.073, 0], m.dark, seat);
  shop.soft("chair_seat", [0.49, 0.068, 0.47], 0.03, [0, -0.034, -0.005], m.fabric, seat, 4);
  // T-arms.
  for (const side of [-1, 1]) {
    shop.soft("chair_arm", [0.1, 0.016, 0.07], 0.005, [side * 0.24, -0.089, 0.03], m.dark, seat, 1);
    shop.soft("chair_arm", [0.022, 0.275, 0.052], 0.007, [side * 0.287, 0.04, 0.03], m.dark, seat);
    shop.soft("chair_arm", [0.072, 0.027, 0.245], 0.011, [side * 0.287, 0.19, 0.005], m.rubber, seat, 3);
  }
  // The back: a frame with the mesh stretched in it, held by a spine that forks into a yoke.
  const origin: V3 = [0, 0.035, 0.235], sin = Math.sin(backTilt), cos = Math.cos(backTilt);
  const back = shop.group(null, origin, seat);
  back.rotation.x = backTilt;
  const cy = BACK.height / 2 + 0.012;
  shop.mesh("chair_back", BACK_FRAME, [0, cy, 0], m.dark, back);
  shop.mesh("chair_back", BACK_MESH, [0, cy, 0], m.mesh, back);
  const fork: V3 = [0, 0.09, 0.062];
  for (const side of [-1, 1]) {
    const tip = backPoint(side * BACK.width / 2, 0.03, 0.006), mid = backPoint(side * 0.12, -0.07, 0.05);
    const yoke = shop.mesh("chair_back", tube(curve([fork, [mid[0], cy + mid[1], mid[2]], [tip[0], cy + tip[1], tip[2]]], 8), 0.013, 8), [0, 0, 0], m.dark, back);
    yoke.castShadow = true;
  }
  const lumbar: V3[] = [];
  for (let i = 0; i <= 10; i++) { const p = backPoint((i / 10 - 0.5) * BACK.width * 0.93, -0.1, 0.012); lumbar.push([p[0], cy + p[1], p[2]]); }
  shop.mesh("chair_back", tube(lumbar, 0.011, 8), [0, 0, 0], m.dark, back).scale.y = 1;
  const toSeat = (p: V3): V3 => [p[0], origin[1] + p[1] * cos - p[2] * sin, origin[2] + p[1] * sin + p[2] * cos];
  const spine = shop.mesh("chair_back", tube(curve([[0, -0.1, 0.05], [0, -0.108, 0.17], [0, -0.085, 0.27], toSeat([0, 0.0, 0.07]), toSeat(fork), toSeat([0, 0.12, 0.058])], 8), 0.017, 10), [0, 0, 0], m.dark, seat);
  spine.scale.x = 1.9;
  return chair;
}

// ----------------------------------------------------------------------------------------------- on the floor

function buildDrawers(shop: Shop): void {
  const { m } = shop;
  // Narrow five-drawer towers: 0.26 m is what the gap between the two benches takes.
  const w = 0.26, h = 0.6, d = 0.42, wall = 0.012;
  const stack = shop.group("drawer-stack", [1.085, 0, -0.55]);
  const [u0, , u1] = [0.01, 0, 0.99];
  for (let unit = 0; unit < 2; unit++) {
    const body = shop.group(`drawer-unit-${unit}`, [unit ? 0.003 : 0, unit * (h + 0.001), unit ? -0.006 : 0], stack);
    body.rotation.y = unit ? 0.012 : 0;
    shop.soft("drawer_unit", [w, 0.02, d], 0.006, [0, h - 0.01, 0], m.white, body);
    shop.soft("drawer_unit", [w, 0.024, d], 0.006, [0, 0.012, 0], m.white, body);
    for (const side of [-1, 1]) shop.soft("drawer_unit", [wall, h - 0.02, d - 0.004], 0.004, [side * (w - wall) / 2, h / 2, 0], m.white, body, 1);
    shop.box("drawer_unit", [w - 0.01, h - 0.03, 0.004], [0, h / 2, -d / 2 + 0.004], m.white, body);
    const inner = w - 2 * wall, dh = (h - 0.044 - 0.004) / 5;
    for (let i = 0; i < 5; i++) {
      const y = 0.024 + 0.002 + dh * (i + 0.5), pull = (unit === 0 && i === 3) ? 0.035 : (unit === 1 && i === 1) ? 0.012 : 0;
      const row = (unit * 5 + i) % DRAWER_ROWS, v1 = 1 - row / DRAWER_ROWS - 0.004, v0 = 1 - (row + 1) / DRAWER_ROWS + 0.004;
      const drawer = shop.group(null, [0, y, d / 2 - 0.012 + pull], body);
      shop.soft("drawer", [inner - 0.004, dh - 0.006, 0.014], 0.004, [0, 0, 0], m.white, drawer, 2);
      shop.mesh("drawer", uvPlane(inner - 0.016, dh - 0.02, u0, v0, u1, v1), [0, -0.002, 0.0072], m.milky, drawer).castShadow = false;
      shop.soft("drawer", [0.085, 0.012, 0.014], 0.004, [0, dh / 2 - 0.012, 0.011], m.white, drawer, 1);
      if (pull) {
        // The pulled drawer shows its sides and what is in it.
        for (const side of [-1, 1]) shop.box("drawer", [0.003, dh - 0.012, pull], [side * (inner / 2 - 0.004), -0.002, -pull / 2 - 0.006], m.white, drawer);
        shop.box("drawer", [inner - 0.012, dh * 0.5, pull], [0, -dh * 0.2, -pull / 2 - 0.006], [m.red, m.blue, m.kraft][i % 3]!, drawer);
      }
    }
  }
  // On top: a coil of cable and a small box.
  const top = 2 * h + 0.001;
  const coil = shop.mesh("drawer_stack_cable", new TorusGeometry(0.062, 0.011, 8, 28), [0.01, top + 0.012, 0.06], m.rubber, stack);
  coil.rotation.x = Math.PI / 2;
  coil.scale.z = 1.5;
  shop.soft("drawer_stack_box", [0.16, 0.06, 0.11], 0.004, [-0.02, top + 0.03, -0.11], m.kraft, stack, 1).rotation.y = 0.2;
}

function buildFloorItems(shop: Shop): void {
  const { m } = shop;
  // The waste bin under the bench, with its liner folded over the rim.
  const bin = shop.group("waste-bin", [2.78, 0, -0.5]);
  shop.mesh("waste_bin", lathe([[0, 0], [0.1, 0], [0.102, 0.004], [0.125, 0.3], [0.128, 0.303], [0.122, 0.303], [0.119, 0.296], [0.096, 0.012], [0, 0.012]], 28), [0, 0, 0], m.bin, bin);
  shop.mesh("waste_bin", lathe([[0.1222, 0.235], [0.1275, 0.3], [0.1305, 0.3058], [0.121, 0.3072], [0.117, 0.29], [0.094, 0.03], [0, 0.022]], 28), [0, 0, 0], m.hose, bin);
  const paper = rng(52);
  for (let i = 0; i < 5; i++) {
    const ball = shop.ball("waste_bin", 0.035 + paper() * 0.02, [(paper() - 0.5) * 0.1, 0.06 + paper() * 0.06, (paper() - 0.5) * 0.1], i % 2 ? m.hose : m.kraft, bin);
    ball.scale.y *= 0.7;
  }

  // A four-way power strip along the wall, two plugs in it, its cable to a wall socket.
  const strip = shop.group("power-strip", [1.82, 0, -0.775]);
  shop.soft("power_strip", [0.3, 0.036, 0.052], 0.006, [0, 0.018, 0], m.white, strip);
  const print = shop.mesh("power_strip", sheet(0.292, 0.047, ART.strip), [0, 0.0363, 0], m.print, strip);
  print.rotation.x = -Math.PI / 2;
  print.castShadow = false;
  shop.soft("power_strip", [0.02, 0.006, 0.013], 0.002, [-0.127, 0.038, 0], m.red, strip, 1).rotation.z = 0.12;
  for (const socket of [0, 2]) {
    const x = -0.062 + socket * 0.058;
    shop.soft("power_strip_plug", [0.036, 0.03, 0.036], 0.006, [x, 0.051, 0], m.dark, strip);
    shop.cable("power_strip_plug", [[x, 0.066, 0], [x + 0.004, 0.1, -0.012], [x + 0.03, 0.2, -0.062], [x + 0.04, 0.5, -0.07], [x + 0.03, 0.72, -0.07]], 0.0035, m.rubber, strip, 6);
  }
  const socketX = 2.57 - 1.82, wallZ = ROOM.back + 0.775;
  shop.cable("power_strip_cable", [[0.15, 0.016, 0], [0.2, 0.006, 0.01], [0.32, 0.005, -0.03], [0.5, 0.005, -0.045], [0.66, 0.006, -0.05], [socketX - 0.01, 0.1, wallZ + 0.02], [socketX, 0.27, wallZ + 0.03], [socketX, 0.3, wallZ + 0.03]], 0.004, m.white, strip, 8, 8);
  shop.soft("wall_socket", [0.086, 0.086, 0.01], 0.003, [socketX, 0.3, wallZ + 0.005], m.white, strip);
  shop.soft("wall_socket", [0.034, 0.038, 0.03], 0.006, [socketX, 0.3, wallZ + 0.024], m.white, strip);

  // Two shipping boxes by the right wall.
  const boxes = shop.group("shipping-boxes", [3.27, 0, -0.52]);
  const carton = (id: string, size: V3, at: V3, turn: number): Group => {
    const [w, h, d] = size;
    const box = shop.group(id, at, boxes);
    box.rotation.y = turn;
    shop.soft("shipping_box", size, 0.003, [0, h / 2, 0], m.kraft, box, 1);
    // The flap seam under the tape, the tape over the top and down both ends.
    shop.box("shipping_box", [0.05, 0.0005, d + 0.001], [0, h + 0.0003, 0], m.amber, box);
    for (const side of [-1, 1]) {
      shop.box("shipping_box", [0.05, 0.07, 0.0005], [0, h - 0.035, side * (d / 2 + 0.0003)], m.amber, box);
      shop.box("shipping_box", [w / 2 - 0.03, 0.0004, 0.0015], [side * (w / 4 + 0.012), h + 0.0002, 0], m.dark, box);
    }
    return box;
  };
  const lower = carton("shipping-box-0", [0.34, 0.4, 0.5], [0, 0, 0], 0.03);
  const upper = carton("shipping-box-1", [0.3, 0.24, 0.4], [-0.012, 0.4005, 0.03], -0.14);
  const side = (parent: Group, w: number, h: number, rect: Rect, at: V3) => { const s = shop.sticker("shipping_label", w, h, rect, at, parent); s.rotation.y = -Math.PI / 2; return s; };
  side(lower, 0.12, 0.12, ART.up, [-0.1704, 0.25, 0.1]);
  side(lower, 0.15, 0.075, ART.fragile, [-0.1704, 0.12, -0.08]).rotation.set(0, -Math.PI / 2, 0);
  side(upper, 0.1, 0.15, ART.ship, [-0.1504, 0.12, 0.04]);
  shop.sticker("shipping_label", 0.15, 0.075, ART.fragile, [0.02, 0.2, 0.2504], lower);
}

// ----------------------------------------------------------------------------------------------- all of it

export function buildStation(scene: Scene): StationHandles {
  const root = new Group();
  root.id = "station";
  scene.add(root);
  const shop = new Shop(root, materials());
  const lit: { strip: Mesh | null } = { strip: null };
  buildBenchFrame(shop);
  buildPanels(shop);
  buildShelf(shop, lit);
  buildPanelTools(shop);
  buildMicroscope(shop);
  buildExtractor(shop);
  buildRework(shop);
  buildSolderStand(shop);
  buildWorkMat(shop);
  buildBenchClutter(shop);
  buildDrawers(shop);
  buildFloorItems(shop);
  const chairs = [
    buildChair(shop, 0, [2.1, 0.45], 0.35, 0.46, 0.16),
    buildChair(shop, 1, [3.0, 1.2], -2.2, 0.44, 0.2),
    buildChair(shop, 2, [-1.3, 0.75], -0.61, 0.475, 0.13),
  ];
  return { microscopeScreen: shop.m.screen, stripLight: shop.m.strip, chairs };
}

/** Triangles and materials under an object: the module's budget check. */
export function countStation(root: Object3D): { triangles: number; unique: number; meshes: number; materials: number } {
  const geometries = new Set<BufferGeometry>(), materialsSeen = new Set<MeshStandardMaterial>();
  let triangles = 0, unique = 0, meshes = 0;
  root.traverse(object => {
    const mesh = object as Mesh & { isMesh?: boolean; isInstancedMesh?: boolean; count?: number };
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry as BufferGeometry;
    const count = (geometry.index.length || geometry.positions.length / 3) / 3;
    triangles += count * (mesh.isInstancedMesh ? mesh.count ?? 1 : 1);
    if (!geometries.has(geometry)) { geometries.add(geometry); unique += count; }
    materialsSeen.add(mesh.material);
    meshes++;
  });
  return { triangles, unique, meshes, materials: materialsSeen.size };
}
