// The back wall of the studio: a dark steel pegboard of hand tools, tape and cable above the main bench; a wall of
// small-parts drawers to its left (grey steel cabinets below, shallower ivory organisers above); a row of six
// clipboards (the quest cards) and a small whiteboard over the drawers. Everything mounts on z = ROOM.back and
// comes toward +z.
//
// Plain colours are one palette texture shared by three finishes (gloss, satin, matte): a part's geometry carries
// its colour as a UV, so a tool or a cabinet is two or three meshes whatever the number of colours on it.
import {
  BufferGeometry, Color, DataTexture, Group, InstancedMesh, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry,
  Quaternion, Texture, Vector3, type Object3D, type Scene,
} from "@threert/scene";
import { Kit, curve, noiseTexture, rng, roundedBox, roundedPlate, std, tube, type V3 } from "../lib.ts";
import { ROOM } from "../layout.ts";

export interface QuestHandle { group: Group; sheet: Mesh; material: MeshStandardMaterial; center: V3 }
export interface WallHandles { quests: QuestHandle[]; pegboard: Group; drawers: Group; whiteboard: Group }

const WALL = ROOM.back;
/** The pegboard: two panels of 37 x 24 holes at 25 mm, 6 mm proud of the wall. */
export const PEGBOARD = { left: -0.93, right: 0.93, bottom: 1.2, top: 1.8, proud: 0.006, pitch: 0.025, panel: 0.925, columns: 37, rows: 24 } as const;
/** Kept clear for what the app mounts on the board. */
export const PEGBOARD_RESERVED = { x: [0.55, 0.93], y: [1.22, 1.5] } as const;
/** The drawer wall: grey cabinets on a plinth up to the ledge, shallower ivory organisers above. */
export const DRAWER_WALL = { left: -3.05, right: -1.2, plinth: 0.08, ledge: 1.0, top: 1.78, lowerDepth: 0.22, upperDepth: 0.16 } as const;
/** The clipboards: A4 hardboard, a 200 x 280 mm sheet on each. */
export const CLIPBOARDS = { first: -2.27, pitch: 0.243, y: 1.955, board: [0.225, 0.315] as [number, number], sheet: [0.2, 0.28] as [number, number] } as const;
export const WHITEBOARD = { at: [-2.73, 2.03, WALL] as V3, size: [0.6, 0.45] as [number, number] } as const;

// ----------------------------------------------------------------------------------------------- palette

const INK = {
  white: 0xf1f0ea, paper: 0xfaf9f4, ivory: 0xe6dcc0, cream: 0xdfcfa2, bone: 0xcfc9b8, silver: 0xa9adb2, grey: 0x7d8187, cabinet: 0x6c7076,
  plinth: 0x35373b, oxide: 0x232427, black: 0x121214, rubber: 0x1b1b1d, hook: 0xcf1f1c, red: 0xc4211d, orange: 0xec5a10, blue: 0x1658b6,
  yellow: 0xf0c00c, green: 0x1e8c4c, teal: 0x2a9d93, amber: 0xc98718, tan: 0xb98a52, card: 0x9c7a4f, pink: 0xd8676b, strip: 0xd9c58e,
  led: 0xf6e37a, copper: 0xb9713a, felt: 0x3d434c, usb: 0xc9ccd1,
} as const;
type Ink = keyof typeof INK;
const INKS = Object.keys(INK) as Ink[];
const inkU = (ink: Ink) => (INKS.indexOf(ink) + 0.5) / INKS.length;

function paletteTexture(): DataTexture {
  const cell = 4, width = INKS.length * cell, px = new Uint8Array(width * cell * 4);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < width; x++) {
      const value = INK[INKS[Math.floor(x / cell)]!], o = (y * width + x) * 4;
      px[o] = (value >> 16) & 255; px[o + 1] = (value >> 8) & 255; px[o + 2] = value & 255; px[o + 3] = 255;
    }
  }
  const texture = new DataTexture(width, cell, px);
  texture.wrap = "clamp";
  return texture;
}

// ----------------------------------------------------------------------------------------------- shapes

/** Collects parts into one geometry: each part is placed by the current transform and painted with the current ink. */
class Shape {
  private readonly p: number[] = [];
  private readonly n: number[] = [];
  private readonly t: number[] = [];
  private readonly idx: number[] = [];
  private readonly stack: Matrix4[] = [];
  private m = new Matrix4();
  private u = 0.5;

  get triangles(): number { return this.idx.length / 3; }
  ink(name: Ink): this { this.u = inkU(name); return this; }
  /** What follows is turned about Z, then X, then Y, and moved to `at`, inside the placement before it. */
  push(at: V3 = [0, 0, 0], rz = 0, rx = 0, ry = 0): this {
    this.stack.push(this.m);
    const local = new Matrix4().makeTranslation(at[0], at[1], at[2]);
    if (ry) local.multiply(new Matrix4().makeRotationY(ry));
    if (rx) local.multiply(new Matrix4().makeRotationX(rx));
    if (rz) local.multiply(new Matrix4().makeRotationZ(rz));
    this.m = this.m.clone().multiply(local);
    return this;
  }
  pop(): this { this.m = this.stack.pop() ?? new Matrix4(); return this; }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number): number {
    const e = this.m.elements;
    this.p.push(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!);
    this.n.push(e[0]! * nx + e[4]! * ny + e[8]! * nz, e[1]! * nx + e[5]! * ny + e[9]! * nz, e[2]! * nx + e[6]! * ny + e[10]! * nz);
    this.t.push(this.u, 0.5);
    return this.p.length / 3 - 1;
  }
  /** A flat convex polygon, wound to face `facing` when given. */
  poly(points: V3[], facing?: V3): this {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!, b = points[(i + 1) % points.length]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const length = Math.hypot(nx, ny, nz);
    if (length < 1e-14) return this;
    nx /= length; ny /= length; nz /= length;
    let ordered = points;
    if (facing && nx * facing[0] + ny * facing[1] + nz * facing[2] < 0) { ordered = [...points].reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const start = this.p.length / 3;
    for (const q of ordered) this.vertex(q[0], q[1], q[2], nx, ny, nz);
    for (let i = 1; i < ordered.length - 1; i++) this.idx.push(start, start + i, start + i + 1);
    return this;
  }
  /** A box; with `c`, its edges and corners are chamfered by c (flat facets: 44 triangles). */
  block(at: V3, size: V3, c = 0): this {
    const h: V3 = [size[0] / 2, size[1] / 2, size[2] / 2];
    c = Math.min(c, h[0] * 0.49, h[1] * 0.49, h[2] * 0.49);
    const pt = (full: number, s: V3): V3 => [0, 1, 2].map(k => at[k]! + s[k]! * (k === full || c <= 0 ? h[k]! : h[k]! - c)) as V3;
    const unit = (a: number, s: number): V3 => { const v: V3 = [0, 0, 0]; v[a] = s; return v; };
    for (let a = 0; a < 3; a++) {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      for (const s of [1, -1]) {
        const corner = (su: number, sv: number) => { const k: V3 = [0, 0, 0]; k[a] = s; k[u] = su; k[v] = sv; return pt(a, k); };
        this.poly([corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)], unit(a, s));
      }
    }
    if (c <= 0) return this;
    for (let t = 0; t < 3; t++) {
      const a = (t + 1) % 3, b = (t + 2) % 3;
      for (const sa of [1, -1]) for (const sb of [1, -1]) {
        const k = (st: number): V3 => { const v: V3 = [0, 0, 0]; v[a] = sa; v[b] = sb; v[t] = st; return v; };
        const facing: V3 = [0, 0, 0]; facing[a] = sa; facing[b] = sb;
        this.poly([pt(a, k(-1)), pt(a, k(1)), pt(b, k(1)), pt(b, k(-1))], facing);
      }
    }
    for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) this.poly([pt(0, [sx, sy, sz]), pt(1, [sx, sy, sz]), pt(2, [sx, sy, sz])], [sx, sy, sz]);
    return this;
  }
  /** The visible part of a drawer front or a lip: the +Z face with chamfered edges and the four sides, no back. */
  front(at: V3, size: V3, c: number): this {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const o = (x: number, y: number, z: number): V3 => [at[0] + x, at[1] + y, at[2] + z];
    const F = (sx: number, sy: number) => o(sx * (hx - c), sy * (hy - c), hz), X = (sx: number, sy: number) => o(sx * hx, sy * (hy - c), hz - c);
    const Y = (sx: number, sy: number) => o(sx * (hx - c), sy * hy, hz - c), C = (sx: number, sy: number) => o(sx * hx, sy * hy, hz - c), B = (sx: number, sy: number) => o(sx * hx, sy * hy, -hz);
    this.poly([F(-1, -1), F(1, -1), F(1, 1), F(-1, 1)], [0, 0, 1]);
    for (const s of [1, -1]) {
      this.poly([F(s, -1), X(s, -1), X(s, 1), F(s, 1)], [s, 0, 1]);
      this.poly([F(-1, s), Y(-1, s), Y(1, s), F(1, s)], [0, s, 1]);
      this.poly([C(s, -1), C(s, 1), B(s, 1), B(s, -1)], [s, 0, 0]);
      this.poly([C(-1, s), C(1, s), B(1, s), B(-1, s)], [0, s, 0]);
      for (const k of [1, -1]) {
        this.poly([F(s, k), X(s, k), Y(s, k)], [s, k, 1]);
        this.poly([X(s, k), C(s, k), Y(s, k)], [0, 0, 1]);
      }
    }
    return this;
  }
  /** A drawer's pull: a small ledge, its top sloping back to the front it grows from; no back. */
  lip(at: V3, size: V3): this {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2], o = (x: number, y: number, z: number): V3 => [at[0] + x, at[1] + y, at[2] + z];
    this.poly([o(-hx, -hy, hz), o(hx, -hy, hz), o(hx, hy * 0.2, hz), o(-hx, hy * 0.2, hz)], [0, 0, 1]);
    this.poly([o(-hx, hy * 0.2, hz), o(hx, hy * 0.2, hz), o(hx, hy, -hz), o(-hx, hy, -hz)], [0, 1, 0.3]);
    this.poly([o(-hx, -hy, hz), o(hx, -hy, hz), o(hx, -hy, -hz), o(-hx, -hy, -hz)], [0, -1, 0]);
    for (const s of [1, -1]) this.poly([o(s * hx, -hy, -hz), o(s * hx, -hy, hz), o(s * hx, hy * 0.2, hz), o(s * hx, hy, -hz)], [s, 0, 0]);
    return this;
  }
  /** A convex outline in XY extruded from z0 to z1, the front edge chamfered by c. */
  prism(outline: [number, number][], z0: number, z1: number, c = 0): this {
    let area = 0;
    for (let i = 0; i < outline.length; i++) { const a = outline[i]!, b = outline[(i + 1) % outline.length]!; area += a[0] * b[1] - b[0] * a[1]; }
    const pts = area < 0 ? [...outline].reverse() : outline, count = pts.length;
    const edgeNormal = (i: number): [number, number] => { const a = pts[i]!, b = pts[(i + 1) % count]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[1] - a[1]) / l, -(b[0] - a[0]) / l]; };
    const inset = pts.map((q, i): [number, number] => {
      const n1 = edgeNormal((i + count - 1) % count), n2 = edgeNormal(i), k = c / (1 + n1[0] * n2[0] + n1[1] * n2[1]);
      return [q[0] - (n1[0] + n2[0]) * k, q[1] - (n1[1] + n2[1]) * k];
    });
    this.poly(inset.map(q => [q[0], q[1], z1] as V3), [0, 0, 1]);
    this.poly(pts.map(q => [q[0], q[1], z0] as V3), [0, 0, -1]);
    for (let i = 0; i < count; i++) {
      const a = pts[i]!, b = pts[(i + 1) % count]!, n = edgeNormal(i);
      this.poly([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1 - c], [a[0], a[1], z1 - c]], [n[0], n[1], 0]);
      if (c > 0) { const ia = inset[i]!, ib = inset[(i + 1) % count]!; this.poly([[a[0], a[1], z1 - c], [b[0], b[1], z1 - c], [ib[0], ib[1], z1], [ia[0], ia[1], z1]], [n[0], n[1], 1]); }
    }
    return this;
  }
  /** A round bar from `from` to `to`, tapering from r0 to r1. */
  rod(from: V3, to: V3, r0: number, r1 = r0, sides = 10, caps: "both" | "end" | "none" = "both"): this {
    const d = new Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]), length = d.length();
    d.normalize();
    const u = new Vector3().crossVectors(Math.abs(d.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0), d).normalize(), v = new Vector3().crossVectors(d, u);
    const start = this.p.length / 3, slope = (r0 - r1) / length;
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2, cx = u.x * Math.cos(a) + v.x * Math.sin(a), cy = u.y * Math.cos(a) + v.y * Math.sin(a), cz = u.z * Math.cos(a) + v.z * Math.sin(a);
      const nl = Math.hypot(1, slope), nx = (cx + d.x * slope) / nl, ny = (cy + d.y * slope) / nl, nz = (cz + d.z * slope) / nl;
      this.vertex(from[0] + cx * r0, from[1] + cy * r0, from[2] + cz * r0, nx, ny, nz);
      this.vertex(to[0] + cx * r1, to[1] + cy * r1, to[2] + cz * r1, nx, ny, nz);
    }
    for (let k = 0; k < sides; k++) { const a = start + k * 2; this.idx.push(a, a + 2, a + 1, a + 2, a + 3, a + 1); }
    const cap = (at: V3, r: number, sign: number) => {
      const ring: V3[] = [];
      for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2; ring.push([at[0] + (u.x * Math.cos(a) + v.x * Math.sin(a)) * r, at[1] + (u.y * Math.cos(a) + v.y * Math.sin(a)) * r, at[2] + (u.z * Math.cos(a) + v.z * Math.sin(a)) * r]); }
      this.poly(ring, [d.x * sign, d.y * sign, d.z * sign]);
    };
    if (caps !== "none" && r1 > 1e-6) cap(to, r1, 1);
    if (caps === "both" && r0 > 1e-6) cap(from, r0, -1);
    return this;
  }
  /** A profile of (radius, height[, ink from here on]) turned about Y. Walk the profile counter-clockwise (out along
   *  the bottom, up the outside, in along the top) so that the faces look outward; each segment is one flat band. */
  turn(profile: ([number, number] | [number, number, Ink])[], sides = 24): this {
    for (let i = 0; i < profile.length - 1; i++) {
      const a = profile[i]!, b = profile[i + 1]!;
      if (a[2]) this.ink(a[2]);
      const dr = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dr, dy);
      if (length < 1e-9 || (a[0] < 1e-9 && b[0] < 1e-9)) continue;
      const nr = dy / length, ny = -dr / length, start = this.p.length / 3;
      for (let k = 0; k <= sides; k++) {
        const phi = (k / sides) * Math.PI * 2, s = Math.sin(phi), c = Math.cos(phi);
        this.vertex(a[0] * s, a[1], a[0] * c, nr * s, ny, nr * c);
        this.vertex(b[0] * s, b[1], b[0] * c, nr * s, ny, nr * c);
      }
      for (let k = 0; k < sides; k++) { const q = start + k * 2; this.idx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1); }
    }
    return this;
  }
  /** Any geometry (a rounded box, a tube), placed and inked. */
  add(geometry: BufferGeometry, at: V3 = [0, 0, 0]): this {
    const start = this.p.length / 3, positions = geometry.positions, normals = geometry.normals;
    for (let i = 0; i < positions.length; i += 3) this.vertex(positions[i]! + at[0], positions[i + 1]! + at[1], positions[i + 2]! + at[2], normals[i]!, normals[i + 1]!, normals[i + 2]!);
    for (const i of geometry.index) this.idx.push(start + i);
    return this;
  }
  /** A cable or a wire along a smooth curve through `points`. */
  cable(points: V3[], radius: number, sides = 6, steps = 6): this {
    return this.add(tube(curve(points, steps), radius, sides));
  }
  geometry(): BufferGeometry {
    return new BufferGeometry().setData(this.p, this.n, this.t, this.idx);
  }
}

// ----------------------------------------------------------------------------------------------- print

/** The label atlas (room/art/wall/labels.svg): cells in texels of a 1024 x 1024 sheet. */
const ATLAS = {
  drawer: (i: number): Cell => [(i % 4) * 256, Math.floor(i / 4) * 102, 256, 102],
  sticker: (i: number): Cell => [(i % 4) * 256, 512 + Math.floor(i / 4) * 96, 256, 96],
  tag: (i: number): Cell => [i * 128, 704, 128, 128],
  reel: [512, 704, 256, 128] as Cell,
  notice: [768, 704, 256, 128] as Cell,
};
type Cell = [number, number, number, number];
/** A printed rectangle of w x h metres showing one cell of the atlas (texels inset so neighbours do not bleed in). */
function printed(w: number, h: number, cell: Cell): BufferGeometry {
  const geometry = new PlaneGeometry(w, h), uv = new Float32Array(geometry.uvs);
  const u0 = (cell[0] + 1.5) / 1024, u1 = (cell[0] + cell[2] - 1.5) / 1024, v1 = 1 - (cell[1] + 1.5) / 1024, v0 = 1 - (cell[1] + cell[3] - 1.5) / 1024;
  for (let i = 0; i < uv.length; i += 2) { uv[i] = u0 + (u1 - u0) * uv[i]!; uv[i + 1] = v0 + (v1 - v0) * uv[i + 1]!; }
  geometry.uvs = uv;
  return geometry;
}

/** The pegboard's face: charcoal powder coat with square holes at 25 mm, 8 x 8 holes to the tile. */
function pegboardTexture(): DataTexture {
  const size = 512, cell = size / 8, px = new Uint8Array(size * size * 4), random = rng(5);
  const half = (4.1 / 25) * cell, corner = (1.3 / 25) * cell, cells = 16;
  const mottle = Array.from({ length: cells * cells }, () => random());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const lx = Math.abs((x % cell) - cell / 2 + 0.5) - (half - corner), ly = Math.abs((y % cell) - cell / 2 + 0.5) - (half - corner);
      const d = Math.hypot(Math.max(lx, 0), Math.max(ly, 0)) + Math.min(Math.max(lx, ly), 0) - corner;
      const hole = Math.max(0, Math.min(1, 0.5 - d)), rim = Math.max(0, 1 - Math.abs(d - 1.8) / 1.6);
      const fx = (x / size) * cells, fy = (y / size) * cells, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = smooth(fx - x0), ty = smooth(fy - y0);
      const at = (i: number, j: number) => mottle[(j % cells) * cells + (i % cells)]!;
      const low = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
      const shade = (low - 0.5) * 9 + (random() - 0.5) * 7 + rim * 9, o = (y * size + x) * 4;
      const base = [76, 80, 90], dark = [13, 13, 15];
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round((base[c]! + shade) * (1 - hole) + dark[c]! * hole)));
      px[o + 3] = 255;
    }
  }
  return new DataTexture(size, size, px);
}

// ----------------------------------------------------------------------------------------------- the wall

interface Finishes { gloss: MeshStandardMaterial; satin: MeshStandardMaterial; matte: MeshStandardMaterial; steel: MeshStandardMaterial; print: MeshStandardMaterial }

export function buildWall(scene: Scene): WallHandles {
  const kit = new Kit(scene);
  const palette = paletteTexture();
  const finishes: Finishes = {
    gloss: new MeshPhysicalMaterial({ name: "wall_gloss", map: palette, roughness: 0.36, clearcoat: 0.25, clearcoatRoughness: 0.15 }),
    satin: new MeshStandardMaterial({ name: "wall_satin", map: palette, roughness: 0.55 }),
    matte: new MeshStandardMaterial({ name: "wall_matte", map: palette, roughness: 0.86 }),
    steel: std("wall_steel", 0xc9ccd0, 0.3, 1),
    print: new MeshStandardMaterial({ name: "wall_print", map: new Texture("room/assets/gen/wall/labels.png"), roughness: 0.62 }),
  };
  const pegboard = buildPegboard(kit, finishes);
  const drawers = buildDrawerWall(kit, finishes);
  const quests = buildClipboards(kit, finishes);
  const whiteboard = buildWhiteboard(kit, finishes);
  return { quests, pegboard, drawers, whiteboard };
}

// ----------------------------------------------------------------------------------------------- pegboard

interface Tool { gloss?: Shape; satin?: Shape; steel?: Shape }
const TOOL_Z = 0.0155;

/** One handle of a plier-like tool: a steel arm from the pivot and a dipped grip that bows back in. */
function handle(tool: Required<Tool>, side: number, root: [number, number], o: { spread: number; bow: number; arm: number; grip: [number, number, number]; ink: Ink; tip?: Ink; armInk?: Ink }): void {
  const [gw, gl, gt] = o.grip;
  tool.satin.ink(o.armInk ?? "oxide").push([side * root[0], root[1], TOOL_Z], side * o.spread).block([0, -o.arm / 2, 0], [gw * 0.55, o.arm + 0.006, 0.0045], 0.0008);
  tool.satin.push([0, -o.arm + 0.004, 0], -side * o.bow).block([0, -0.012, 0], [gw * 0.5, 0.03, 0.0045], 0.0008).pop().pop();
  tool.gloss.ink(o.ink).push([side * root[0], root[1], TOOL_Z], side * o.spread).push([0, -o.arm + 0.004, 0], -side * o.bow);
  tool.gloss.add(roundedBox(gw, gl, gt, Math.min(gw, gt) * 0.46, 2), [0, -0.012 - gl / 2, 0]);
  tool.gloss.block([0, -0.014, 0], [gw + 0.003, 0.005, gt + 0.002], 0.0012);
  tool.gloss.add(roundedBox(gw + 0.0026, 0.016, gt + 0.0016, Math.min(gw, gt) * 0.5, 2), [side * 0.0006, -0.012 - gl + 0.0075, 0]);
  if (o.tip) tool.gloss.ink(o.tip).add(roundedBox(gw + 0.0012, gl * 0.2, gt + 0.0012, Math.min(gw, gt) * 0.48, 2), [0, -0.012 - gl * 0.9, 0]);
  tool.gloss.pop().pop();
}
const blank = (): Required<Tool> => ({ gloss: new Shape(), satin: new Shape(), steel: new Shape() });
const bolt = (tool: Required<Tool>, x: number, y: number, r = 0.0034, proud = 0.0062) => tool.steel.rod([x, y, TOOL_Z], [x, y, TOOL_Z + proud], r, r * 0.86, 10, "end");

/** A ratchet crimper: a black frame with bright dies in its mouth, two long grips. About 200 mm. */
function crimper(grips: [Ink, Ink], spread: number, wide: boolean): Tool {
  const tool = blank(), w = wide ? 0.024 : 0.02, z0 = TOOL_Z - 0.0042, z1 = TOOL_Z + 0.0042;
  tool.satin.ink("oxide").prism([[-w + 0.006, 0.007], [w - 0.006, 0.007], [w, 0.02], [w, 0.0325], [-w, 0.0325], [-w, 0.02]], z0, z1, 0.0008);
  tool.satin.prism([[-w, 0.0415], [w, 0.0415], [w, 0.05], [w - 0.006, 0.056], [-w + 0.006, 0.056], [-w, 0.05]], z0, z1, 0.0008);
  tool.satin.block([-w + 0.003, 0.037, TOOL_Z], [0.006, 0.012, 0.0074], 0.0006);
  // The dies: two bright blocks with the crimp notches between them.
  tool.steel.block([0.003, 0.0349, TOOL_Z], [2 * w - 0.008, 0.0042, 0.0098], 0.0006).block([0.003, 0.0394, TOOL_Z], [2 * w - 0.008, 0.0036, 0.0098], 0.0006);
  bolt(tool, -w + 0.007, 0.0165); bolt(tool, w - 0.007, 0.0165); bolt(tool, 0, 0.025, 0.0042); bolt(tool, w - 0.006, 0.049, 0.0028);
  handle(tool, -1, [0.0105, 0.012], { spread, bow: 0.15, arm: 0.04, grip: [0.019, 0.104, 0.0135], ink: grips[0] });
  handle(tool, 1, [0.0105, 0.012], { spread, bow: 0.15, arm: 0.04, grip: [0.019, 0.104, 0.0135], ink: grips[1] });
  // The ratchet's link between the handles.
  tool.satin.ink("oxide").rod([-0.019, -0.03, TOOL_Z], [0.017, -0.022, TOOL_Z], 0.0026, 0.0026, 8);
  return tool;
}
/** A ferrule crimper: a squarer head with a round die. About 180 mm. */
function ferruleCrimper(grips: [Ink, Ink], spread: number): Tool {
  const tool = blank(), z0 = TOOL_Z - 0.0042, z1 = TOOL_Z + 0.0042;
  tool.satin.ink("oxide").prism([[-0.013, 0.007], [0.013, 0.007], [0.019, 0.016], [0.019, 0.04], [0.013, 0.05], [-0.013, 0.05], [-0.019, 0.04], [-0.019, 0.016]], z0, z1, 0.0008);
  tool.steel.push([0, 0.036, TOOL_Z], 0, Math.PI / 2).turn([[0.0036, 0.0042], [0.0085, 0.0042], [0.0085, 0.0056], [0.0036, 0.0056], [0.0036, 0.0042]], 16).pop();
  tool.satin.ink("black").rod([0, 0.036, z1], [0, 0.036, z1 + 0.0003], 0.0036, 0.0036, 12, "end");
  bolt(tool, -0.011, 0.016); bolt(tool, 0.011, 0.016); bolt(tool, 0, 0.022, 0.003);
  handle(tool, -1, [0.0095, 0.012], { spread, bow: 0.14, arm: 0.034, grip: [0.018, 0.092, 0.013], ink: grips[0] });
  handle(tool, 1, [0.0095, 0.012], { spread, bow: 0.14, arm: 0.034, grip: [0.018, 0.092, 0.013], ink: grips[1], tip: "orange" });
  return tool;
}
/** A wire stripper: two flat steel blades with graded notches, yellow grips. About 185 mm. */
function stripper(): Tool {
  const tool = blank(), z0 = TOOL_Z - 0.0022, z1 = TOOL_Z + 0.0022;
  tool.steel.prism([[0.0004, 0.006], [0.0115, 0.006], [0.0105, 0.032], [0.0045, 0.074], [0.0004, 0.074]], z0, z1, 0.0005);
  tool.steel.prism([[-0.0004, 0.006], [-0.0004, 0.074], [-0.0045, 0.074], [-0.0105, 0.032], [-0.0115, 0.006]], z0, z1, 0.0005);
  tool.satin.ink("black");
  [0.036, 0.042, 0.0475, 0.0525, 0.057, 0.061].forEach((y, i) => tool.satin.rod([0, y, z1 - 0.0002], [0, y, z1 + 0.0002], 0.0021 - i * 0.00024, 0.0021 - i * 0.00024, 8, "end"));
  bolt(tool, 0, 0.0165, 0.0036, 0.004);
  handle(tool, -1, [0.006, 0.012], { spread: 0.25, bow: 0.13, arm: 0.03, grip: [0.0155, 0.086, 0.011], ink: "yellow", tip: "black", armInk: "silver" });
  handle(tool, 1, [0.006, 0.012], { spread: 0.25, bow: 0.13, arm: 0.03, grip: [0.0155, 0.086, 0.011], ink: "yellow", tip: "black", armInk: "silver" });
  return tool;
}
/** Long-nose pliers: tapered jaws, a round joint, slim grips. About 165 mm. */
function longNose(grip: Ink): Tool {
  const tool = blank(), z0 = TOOL_Z - 0.0036, z1 = TOOL_Z + 0.0036;
  tool.steel.prism([[0.0003, 0.02], [0.0088, 0.02], [0.0078, 0.034], [0.0017, 0.08], [0.0003, 0.08]], z0, z1, 0.0007);
  tool.steel.prism([[-0.0003, 0.02], [-0.0003, 0.08], [-0.0017, 0.08], [-0.0078, 0.034], [-0.0088, 0.02]], z0, z1, 0.0007);
  tool.steel.rod([0, 0.019, z0 - 0.0006], [0, 0.019, z1 + 0.0008], 0.0108, 0.0102, 18);
  tool.steel.rod([0, 0.019, z1 + 0.0008], [0, 0.019, z1 + 0.0018], 0.0032, 0.0028, 10, "end");
  handle(tool, -1, [0.005, 0.014], { spread: 0.26, bow: 0.15, arm: 0.03, grip: [0.0128, 0.088, 0.0112], ink: grip, armInk: "silver" });
  handle(tool, 1, [0.005, 0.014], { spread: 0.26, bow: 0.15, arm: 0.03, grip: [0.0128, 0.088, 0.0112], ink: grip, armInk: "silver" });
  return tool;
}
/** Flush cutters: a short pointed head, a return spring, slim grips. About 130 mm. */
function flushCutter(grip: Ink): Tool {
  const tool = blank(), z0 = TOOL_Z - 0.003, z1 = TOOL_Z + 0.003;
  tool.steel.prism([[0.0003, 0.016], [0.0105, 0.016], [0.0108, 0.026], [0.0014, 0.047], [0.0003, 0.047]], z0, z1, 0.0007);
  tool.steel.prism([[-0.0003, 0.016], [-0.0003, 0.047], [-0.0014, 0.047], [-0.0108, 0.026], [-0.0105, 0.016]], z0, z1, 0.0007);
  bolt(tool, 0, 0.0225, 0.0036, 0.0046);
  tool.steel.cable([[-0.007, -0.004, TOOL_Z], [-0.003, 0.008, TOOL_Z + 0.001], [0, 0.011, TOOL_Z + 0.001], [0.003, 0.008, TOOL_Z + 0.001], [0.007, -0.004, TOOL_Z]], 0.0007, 5, 4);
  handle(tool, -1, [0.0052, 0.013], { spread: 0.24, bow: 0.1, arm: 0.022, grip: [0.0112, 0.076, 0.0098], ink: grip, armInk: "silver" });
  handle(tool, 1, [0.0052, 0.013], { spread: 0.24, bow: 0.1, arm: 0.022, grip: [0.0112, 0.076, 0.0098], ink: grip, armInk: "silver" });
  return tool;
}

/** A red plastic peg: a base that plugs two holes, a peg rising a little toward its upturned tip. */
function hookShape(length: number, double = false): BufferGeometry {
  const s = new Shape().ink("hook");
  if (double) s.block([0, -0.004, 0.0025], [0.046, 0.024, 0.005], 0.0011); else s.block([0, -0.0085, 0.0025], [0.0165, 0.037, 0.005], 0.0011);
  for (const x of double ? [-0.015, 0.015] : [0]) {
    const rise = length * HOOK_RISE;
    s.block([x, -0.003, 0.0072], [0.0085, 0.013, 0.0055], 0.0012);
    s.rod([x, 0, 0.004], [x, rise, length], 0.0033, 0.003, 10, "none");
    s.rod([x, rise - 0.0006, length - 0.0012], [x, rise + 0.0075, length + 0.0022], 0.003, 0.0027, 10);
  }
  return s.geometry();
}
const HOOK_RISE = 0.1;

/** A roll of tape on its core, the axis along Z: the faces a little uneven, as wound tape is. */
function rollShape(od: number, id: number, width: number, tape: Ink, core: Ink, seed: number): BufferGeometry {
  const ro = od / 2, ri = id / 2, rc = Math.min(ri + 0.0032, ro - 0.002), h = width / 2, hc = h + 0.0009, b = Math.min(0.0012, width * 0.12), random = rng(seed);
  const face: [number, number][] = [];
  const steps = ro - rc > 0.012 ? 3 : 1;
  for (let i = 1; i < steps; i++) { const r = rc + ((ro - rc) * (i + (random() - 0.5) * 0.5)) / steps, dip = 0.0003 + random() * 0.0005; face.push([r, 0], [r + 0.0004, dip]); }
  let depth = 0;
  const back: ([number, number] | [number, number, Ink])[] = [[rc, -h, tape]], frontFace: [number, number][] = [];
  for (let i = 0; i < face.length; i += 2) {
    back.push([face[i]![0], -h + depth]); frontFace.push([face[i]![0], h - depth]);
    depth = depth > 0 ? 0 : face[i + 1]![1];
    back.push([face[i + 1]![0], -h + depth]); frontFace.push([face[i + 1]![0], h - depth]);
  }
  const profile: ([number, number] | [number, number, Ink])[] = [[ri, -hc, core], [rc, -hc], ...back, [ro - b, -h + depth], [ro, -h + depth + b], [ro, h - depth - b], [ro - b, h - depth], ...frontFace.reverse(), [rc, h, core], [rc, hc], [ri, hc], [ri, -hc]];
  return new Shape().push([0, 0, 0], 0, Math.PI / 2).turn(profile, od > 0.075 ? 40 : 28).geometry();
}

/** A coil of hook-up wire: the wraps as ridges round a ring, two ties, a loose end. */
function coilShape(radius: number, bundle: number, wire: Ink, tie: Ink, seed: number): BufferGeometry {
  const random = rng(seed), s = new Shape().ink(wire), lobes = 6, count = lobes * 3, profile: [number, number][] = [];
  for (let k = 0; k <= count; k++) {
    const a = (k / count) * Math.PI * 2, bump = k % 3 === 0 ? 0.8 : 1.04;
    profile.push([radius + bundle * 1.2 * bump * Math.cos(a), bundle * 0.85 * bump * Math.sin(a)]);
  }
  s.push([0, 0, 0], 0, Math.PI / 2).turn(profile, 28).pop();
  // Two turns that did not lie down with the rest.
  for (let k = 0; k < 2; k++) {
    const loose: V3[] = [], phase = random() * 6, out = bundle * (0.5 + random() * 0.5);
    for (let i = 0; i <= 14; i++) { const a = (i / 14) * Math.PI * 2, r = radius + out * Math.cos(a + phase) + bundle * 0.5 * Math.sin(a * 2 + phase); loose.push([Math.cos(a) * r, Math.sin(a) * r, bundle * (0.75 + 0.35 * Math.sin(a * 2 + phase * 2))]); }
    s.cable(loose, bundle * 0.24, 5, 2);
  }
  const tail = 0.9 + random() * 0.5, tr = bundle * 0.24;
  s.cable([[Math.cos(tail) * radius, -Math.sin(tail) * radius, bundle * 0.7], [Math.cos(tail + 0.5) * (radius + bundle * 1.6), -Math.sin(tail + 0.5) * (radius + bundle * 1.3), bundle], [Math.cos(tail + 0.8) * (radius + bundle * 2.4), -Math.sin(tail + 0.8) * radius - 0.02, bundle * 0.6], [Math.cos(tail + 0.8) * (radius + bundle * 2) + 0.004, -radius - 0.05 - random() * 0.02, 0.001]], tr, 6, 6);
  s.ink(tie);
  for (const a of [0.5 + random() * 0.5, 2.6 + random() * 0.6]) s.push([Math.cos(a) * radius, Math.sin(a) * radius, 0], a).block([0, 0, 0], [bundle * 2.75, 0.0042, bundle * 2.05], 0.0008).pop();
  return s.geometry();
}

function buildPegboard(kit: Kit, f: Finishes): Group {
  const P = PEGBOARD, cy = (P.bottom + P.top) / 2, face = WALL + P.proud;
  // The group sits at the middle of the board's face: local x and y are the room's x and height above 1.5 m.
  const board = kit.group("pegboard", [0, cy, face]);
  const random = rng(77);
  const map = pegboardTexture();
  map.repeat = [P.columns / 8, P.rows / 8];
  const coat = new MeshPhysicalMaterial({ name: "pegboard_coat", map, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.3 });
  const panel = roundedPlate(P.panel, P.top - P.bottom, P.proud, 0.004);
  const centres = [P.left + P.panel / 2, P.right - P.panel / 2];
  for (const x of centres) {
    kit.mesh("pegboard_panel", panel, [x, 0, -P.proud / 2], coat, board);
    for (const sx of [-1, 0, 1]) for (const sy of [-1, 1]) {
      const screw = kit.drum("pegboard_screw", 0.0042, 0.0022, [x + sx * (P.panel / 2 - 0.0125), sy * ((P.top - P.bottom) / 2 - 0.0125), 0.0011], f.steel, board, 0.0036, 12);
      screw.rotation.x = Math.PI / 2;
    }
  }
  /** The hole in column i, row j (from the bottom) of the left (0) or right (1) panel, in the group's space. */
  const hole = (panelIndex: number, i: number, j: number): [number, number] => [centres[panelIndex]! - P.panel / 2 + (i + 0.5) * P.pitch, P.bottom + (j + 0.5) * P.pitch - cy];
  const hooks = new Map<string, BufferGeometry>();
  const hook = (at: [number, number], length: number, double = false) => {
    const key = `${length}:${double}`;
    if (!hooks.has(key)) hooks.set(key, hookShape(length, double));
    return kit.mesh("peg_hook", hooks.get(key)!, [at[0], at[1], 0], f.gloss, board);
  };
  /** Where something hung on a peg rests: the top of the peg, `along` metres from the board. */
  const seat = (at: [number, number], along: number): V3 => [at[0], at[1] + along * HOOK_RISE + 0.0031, along];
  const sticker = (at: [number, number], index: number, tilt = 0) => {
    const label = kit.mesh("peg_label", printed(0.034, 0.01275, ATLAS.sticker(index)), [at[0], at[1], 0.0002], f.print, board);
    label.rotation.z = tilt;
  };

  // Hand tools along the top of the left panel, hung jaws-up with a peg between the handles.
  const hang = (id: string, tool: Tool, at: [number, number], stickerIndex: number) => {
    const group = kit.group(id, [at[0], at[1], 0], board);
    hook(at, 0.032);
    group.rotation.z = (random() - 0.5) * 0.2;
    if (tool.gloss) kit.mesh(id, tool.gloss.geometry(), [0, 0, 0], f.gloss, group);
    if (tool.satin) kit.mesh(id, tool.satin.geometry(), [0, 0, 0], f.satin, group);
    if (tool.steel) kit.mesh(id, tool.steel.geometry(), [0, 0, 0], f.steel, group);
    sticker([at[0] + (random() - 0.5) * 0.004, P.top - cy - 0.0125 + (random() - 0.5) * 0.002], stickerIndex, (random() - 0.5) * 0.05);
  };
  hang("wire_stripper", stripper(), hole(0, 2, 19), 1);
  hang("crimper", crimper(["orange", "orange"], 0.3, false), hole(0, 7, 20), 0);
  hang("crimper", crimper(["orange", "rubber"], 0.25, true), hole(0, 12, 20), 2);
  hook(hole(0, 16, 20), 0.034, true);
  sticker([hole(0, 16, 20)[0], P.top - cy - 0.0125], 5, 0.02);
  hang("crimper", crimper(["red", "red"], 0.32, false), hole(0, 20, 20), 0);
  hang("ferrule_crimper", ferruleCrimper(["blue", "blue"], 0.27), hole(0, 25, 20), 5);
  hang("long_nose_pliers", longNose("blue"), hole(0, 30, 19), 3);
  hang("flush_cutter", flushCutter("red"), hole(1, 14, 20), 4);

  // Rolls of tape on long pegs: wide ones in the middle row, smaller below and at the top right.
  const roll = (at: [number, number], od: number, id: number, width: number, tape: Ink, finish: keyof Finishes, core: Ink = "card") => {
    hook(at, Math.max(0.04, width + 0.016));
    const s = seat(at, 0.006 + width / 2);
    const mesh = kit.mesh("tape_roll", rollShape(od, id, width, tape, core, Math.round(od * 1e4 + width * 1e5)), [s[0] + (random() - 0.5) * 0.004, s[1] - id / 2, s[2]], f[finish], board);
    mesh.rotation.z = random() * 6;
    mesh.rotation.x = 0.02 + random() * 0.03;
  };
  roll(hole(0, 12, 12), 0.15, 0.076, 0.045, "white", "matte", "white");
  roll(hole(0, 20, 12), 0.116, 0.076, 0.036, "cream", "matte");
  roll(hole(0, 26, 12), 0.104, 0.076, 0.048, "silver", "satin", "white");
  roll(hole(0, 33, 12), 0.126, 0.076, 0.048, "tan", "gloss");
  roll(hole(0, 8, 5), 0.086, 0.076, 0.01, "amber", "gloss", "black");
  roll(hole(0, 18, 5), 0.062, 0.032, 0.018, "black", "gloss", "white");
  roll(hole(0, 29, 5), 0.096, 0.076, 0.024, "cream", "matte");
  roll(hole(0, 34, 5), 0.058, 0.032, 0.018, "red", "gloss", "white");
  roll(hole(1, 2, 20), 0.088, 0.05, 0.024, "grey", "satin");
  roll(hole(1, 6, 20), 0.082, 0.07, 0.012, "cream", "matte", "white");
  roll(hole(1, 2, 5), 0.124, 0.076, 0.019, "pink", "satin", "white");
  roll(hole(1, 8, 5), 0.108, 0.076, 0.019, "red", "gloss", "white");
  roll(hole(1, 13, 5), 0.056, 0.032, 0.018, "teal", "gloss", "white");
  sticker([hole(0, 16, 12)[0], hole(0, 16, 12)[1] + 0.03], 6, -0.02);
  sticker([hole(1, 4, 15)[0], hole(1, 4, 15)[1] + 0.006], 7, 0.015);

  // Coils of hook-up wire.
  const coil = (at: [number, number], radius: number, bundle: number, wire: Ink, tie: Ink, finish: keyof Finishes = "gloss") => {
    hook(at, 0.04);
    const s = seat(at, 0.012);
    const mesh = kit.mesh("wire_coil", coilShape(radius, bundle, wire, tie, Math.round(radius * 1e4)), [s[0], s[1] - radius + bundle * 1.15, s[2]], f[finish], board);
    mesh.rotation.x = 0.04;
  };
  coil(hole(1, 2, 12), 0.04, 0.0058, "red", "white");
  coil(hole(1, 7, 12), 0.036, 0.0052, "black", "white");
  coil(hole(1, 12, 12), 0.039, 0.0056, "yellow", "black");
  coil(hole(0, 23, 5), 0.047, 0.0082, "rubber", "white", "satin");

  // Cable bundles hung in loops, long ones clear of the reserved corner.
  const bundle = (at: [number, number], o: { count: number; length: [number, number]; width: [number, number]; inks: Ink[]; radius: number; lean?: number }, ends: { length: number; ink: Ink; radius: number; plug: Ink; dx: number }[] = []) => {
    hook(at, 0.045);
    const shape = new Shape(), metal = new Shape();
    for (let k = 0; k < o.count; k++) {
      const along = 0.009 + (k / Math.max(1, o.count - 1)) * 0.026, top = seat(at, along), points: V3[] = [], count = o.length[1] > 0.3 ? 24 : 18;
      const length = o.length[0] + random() * (o.length[1] - o.length[0]), width = o.width[0] + random() * (o.width[1] - o.width[0]);
      const sway = (random() - 0.5) * 0.014, lean = (o.lean ?? 0) + (random() - 0.5) * 0.022, phase = random() * 6;
      for (let i = 0; i <= count; i++) {
        const a = (i / count) * Math.PI * 2, s = (1 - Math.cos(a)) / 2;
        const x = (width / 2) * Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.62) * (0.3 + 0.7 * Math.pow(s, 0.8)) + lean * s + sway * Math.sin(a * 2 + phase) * s;
        // Off the peg the cable falls back to hang against the board and its neighbours.
        const z = top[2] * (1 - s) + (o.radius + 0.0015 + (k % 4) * 0.0028) * s + Math.sin(a * 3 + phase) * 0.0014 * s;
        points.push([top[0] + x, top[1] + o.radius - length * s, z]);
      }
      shape.ink(o.inks[k % o.inks.length]!).cable(points, o.radius, 5, 2);
    }
    ends.forEach((end, k) => {
      const top = seat(at, 0.014 + k * 0.01), x = top[0] + end.dx, bottom = top[1] - end.length, swing = (random() - 0.5) * 0.3;
      shape.ink(end.ink).cable([[top[0] - end.dx * 0.3, top[1] - 0.012, top[2]], [top[0], top[1] + end.radius, top[2]], [top[0] + end.dx * 0.5, top[1] - 0.012, top[2] - 0.002], [x, top[1] - end.length * 0.5, end.radius + 0.004], [x + (random() - 0.5) * 0.01, bottom, end.radius + 0.003]], end.radius, 5, 5);
      shape.ink(end.plug).push([x, bottom, end.radius + 0.004], swing).add(roundedBox(0.0105, 0.022, 0.0068, 0.002, 2), [0, -0.01, 0]).pop();
      metal.push([x, bottom, end.radius + 0.004], swing).block([0, -0.0265, 0], [0.0078, 0.011, 0.0034], 0.0005).pop();
    });
    kit.mesh("cable_bundle", shape.geometry(), [0, 0, 0], f.satin, board);
    if (metal.triangles) kit.mesh("cable_bundle", metal.geometry(), [0, 0, 0], f.steel, board);
  };
  bundle(hole(1, 17, 21), { count: 6, length: [0.36, 0.46], width: [0.036, 0.066], inks: ["rubber", "rubber", "red", "rubber", "tan", "rubber"], radius: 0.002 }, [{ length: 0.37, ink: "rubber", radius: 0.002, plug: "black", dx: -0.028 }, { length: 0.3, ink: "rubber", radius: 0.002, plug: "white", dx: 0.02 }]);
  bundle(hole(1, 26, 21), { count: 6, length: [0.15, 0.215], width: [0.034, 0.058], inks: ["red", "black", "red", "rubber"], radius: 0.0013 });
  bundle(hole(1, 29, 21), { count: 5, length: [0.16, 0.215], width: [0.034, 0.056], inks: ["rubber", "tan", "rubber", "pink"], radius: 0.0017 }, [{ length: 0.15, ink: "tan", radius: 0.0017, plug: "amber", dx: 0.012 }]);
  bundle(hole(1, 32, 21), { count: 5, length: [0.15, 0.21], width: [0.034, 0.056], inks: ["usb", "usb", "rubber"], radius: 0.0019 }, [{ length: 0.14, ink: "usb", radius: 0.0019, plug: "usb", dx: -0.014 }]);
  bundle(hole(1, 35, 21), { count: 3, length: [0.12, 0.2], width: [0.018, 0.034], inks: ["red", "black"], radius: 0.0014, lean: -0.006 });
  bundle(hole(1, 10, 21), { count: 2, length: [0.17, 0.2], width: [0.014, 0.024], inks: ["red"], radius: 0.0016, lean: 0.004 });
  bundle(hole(0, 2, 12), { count: 3, length: [0.12, 0.15], width: [0.022, 0.032], inks: ["rubber"], radius: 0.0017 }, [{ length: 0.12, ink: "rubber", radius: 0.0017, plug: "black", dx: 0.012 }]);

  // A reel of LED strip, a tail of it hanging free.
  {
    const at = hole(1, 22, 20);
    hook(at, 0.04);
    const s = seat(at, 0.016), reel = new Shape().ink("white");
    const group = kit.group("led_reel", [s[0], s[1] - 0.0125, s[2]], board);
    reel.push([0, 0, 0], 0, Math.PI / 2);
    reel.turn([[0.0125, -0.008], [0.07, -0.008], [0.07, -0.0066], [0.0125, -0.0066], [0.0125, -0.008]], 36);
    reel.turn([[0.0125, -0.0066], [0.03, -0.0066], [0.03, 0.0066], [0.0125, 0.0066], [0.0125, -0.0066]], 28);
    reel.turn([[0.061, 0.0066], [0.07, 0.0066], [0.07, 0.008], [0.061, 0.008], [0.061, 0.0066]], 36);
    reel.turn([[0.0125, 0.0066], [0.034, 0.0066], [0.034, 0.008], [0.0125, 0.008], [0.0125, 0.0066]], 28);
    reel.ink("strip").turn([[0.03, -0.0052], [0.0555, -0.0052], [0.0565, -0.0042], [0.0565, 0.0042], [0.0555, 0.0052], [0.047, 0.0052], [0.0466, 0.0046], [0.039, 0.0046], [0.0386, 0.0052], [0.03, 0.0052]], 36);
    reel.pop().ink("white");
    for (let k = 0; k < 4; k++) reel.push([0, 0, 0.0073], k * (Math.PI / 2) + 0.5).block([0, 0.0475, 0], [0.0085, 0.029, 0.0014], 0.0004).pop();
    // LEDs on the outer wrap, and on the tail.
    reel.ink("led");
    for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; reel.push([Math.sin(a) * 0.0569, Math.cos(a) * 0.0569, 0], -a).block([0, 0, 0], [0.0036, 0.0012, 0.0036], 0.0003).pop(); }
    // The tail leaves the reel edge-on and turns to face the room as it hangs.
    const tail = 0.085, steps = 12, across = (i: number): V3 => { const phi = Math.min(1, i / 5) * (Math.PI / 2); return [Math.sin(phi) * 0.005, 0, Math.cos(phi) * 0.005]; };
    const along = (i: number): V3 => [0.0572 + Math.min(1, i / 5) * 0.004, -(i / steps) * tail, 0.001 * Math.min(1, i / 5)];
    reel.ink("strip");
    for (let i = 0; i < steps; i++) {
      const a0 = along(i), a1 = along(i + 1), w0 = across(i), w1 = across(i + 1);
      const quad: V3[] = [[a0[0] - w0[0], a0[1], a0[2] - w0[2]], [a0[0] + w0[0], a0[1], a0[2] + w0[2]], [a1[0] + w1[0], a1[1], a1[2] + w1[2]], [a1[0] - w1[0], a1[1], a1[2] - w1[2]]];
      reel.poly(quad).poly([...quad].reverse());
    }
    for (let k = 0; k < 3; k++) {
      const y = -tail * (0.5 + k * 0.166);
      reel.ink("led").block([0.0612, y, 0.0018], [0.0036, 0.0036, 0.0013], 0.0003).ink("copper").block([0.0612, y - 0.0071, 0.0012], [0.0072, 0.002, 0.0003]);
    }
    kit.mesh("led_reel", reel.geometry(), [0, 0, 0], f.satin, group);
    kit.mesh("peg_label", printed(0.04, 0.02, ATLAS.reel), [at[0] - 0.014, at[1] - 0.1, 0.0002], f.print, board).rotation.z = 0.03;
  }
  // A spool of solder and a bag of cable ties.
  {
    const at = hole(0, 35, 16), s = seat(at, 0.022), spool = new Shape();
    hook(at, 0.045);
    spool.push([0, 0, 0], 0, Math.PI / 2).turn([[0.0062, -0.016, "blue"], [0.025, -0.016], [0.025, -0.0142], [0.0188, -0.0142, "silver"], [0.0192, -0.007], [0.0186, 0], [0.0192, 0.007], [0.0188, 0.0142, "blue"], [0.025, 0.0142], [0.025, 0.016], [0.0062, 0.016], [0.0062, -0.016]], 24).pop();
    spool.ink("silver").cable([[0.019, 0.002, 0.004], [0.024, -0.012, 0.006], [0.02, -0.03, 0.004], [0.026, -0.05, 0.002]], 0.0005, 4, 4);
    kit.mesh("solder_spool", spool.geometry(), [s[0], s[1] - 0.0062, s[2]], f.gloss, board);
    const peg = hole(0, 2, 5), top = seat(peg, 0.012), bag = new Shape().ink("bone");
    bag.add(roundedBox(0.078, 0.104, 0.0036, 0.0016, 2), [0, -0.066, 0]).ink("red").block([0, -0.004, 0], [0.078, 0.024, 0.0016], 0.0004);
    // The ties show through the bag: a fanned bundle of black strips.
    bag.ink("rubber");
    for (let k = 0; k < 9; k++) bag.push([-0.02 + k * 0.005, -0.074, 0.0019 + (k % 3) * 0.0004], (k - 4) * 0.035 + (random() - 0.5) * 0.05).block([0, 0, 0], [0.0036, 0.074, 0.001], 0.0003).pop();
    const hung = kit.mesh("tie_bag", bag.geometry(), [top[0], top[1] - 0.001, top[2]], f.gloss, board);
    hung.rotation.z = 0.05;
    kit.mesh("tie_bag", printed(0.05, 0.02, ATLAS.drawer(15)), [top[0] + 0.001, top[1] - 0.004, top[2] + 0.001], f.print, board).rotation.z = 0.05;
  }
  // The notice at the top left, and pegs waiting for what is out on the bench.
  kit.mesh("peg_label", printed(0.06, 0.03, ATLAS.notice), [hole(0, 5, 12)[0], hole(0, 5, 12)[1] + 0.034, 0.0002], f.print, board).rotation.z = -0.015;
  for (const [panelIndex, i, j] of [[0, 5, 12], [0, 2, 5], [0, 13, 5], [0, 16, 12], [1, 20, 9], [1, 20, 5]] as [number, number, number][]) hook(hole(panelIndex, i, j), 0.04);
  return board;
}

// ----------------------------------------------------------------------------------------------- drawers

interface Slot { x: number; y: number; z: number; w: number; h: number; upper: boolean; unit: number; column: number; row: number }

function buildDrawerWall(kit: Kit, f: Finishes): Group {
  const D = DRAWER_WALL, random = rng(2026);
  // The group sits on the floor at the wall, under the middle of the cabinets.
  const cx = (D.left + D.right) / 2, wall = kit.group("drawer-wall", [cx, 0, WALL]);
  const gap = 0.003, unitW = (D.right - D.left - 2 * gap) / 3;
  const lowerH = (D.ledge - D.plinth) / 2, upperH = (D.top - D.ledge) / 2;
  const LOWER = { columns: 8, rows: 10, t: 0.012, depth: D.lowerDepth, height: lowerH, gapX: 0.0046, gapY: 0.0032 };
  const UPPER = { columns: 5, rows: 8, t: 0.007, depth: D.upperDepth, height: upperH, gapX: 0.0042, gapY: 0.0036 };

  // The plinth, set back under the cabinets.
  kit.mesh("drawer_cabinet", new Shape().ink("plinth").block([0, D.plinth / 2, (D.lowerDepth - 0.025) / 2], [D.right - D.left - 0.01, D.plinth, D.lowerDepth - 0.025], 0.0015).geometry(), [0, 0, 0], f.satin, wall);

  const carcass = (spec: { columns: number; rows: number; t: number; depth: number; height: number }, ink: Ink, chamfer: number): BufferGeometry => {
    const s = new Shape().ink(ink), { t, depth, height } = spec;
    for (const side of [-1, 1]) s.block([side * (unitW / 2 - t / 2), height / 2, depth / 2], [t, height, depth], chamfer);
    for (const y of [t / 2, height - t / 2]) s.block([0, y, depth / 2], [unitW - 2 * t, t, depth], chamfer);
    s.block([0, height / 2, 0.002], [unitW - 2 * t, height - 2 * t, 0.004]);
    const inner = unitW - 2 * t, tall = height - 2 * t;
    for (let c = 1; c < spec.columns; c++) s.block([-inner / 2 + (c * inner) / spec.columns, height / 2, (depth - 0.003) / 2], [0.0016, tall, depth - 0.003]);
    for (let r = 1; r < spec.rows; r++) s.block([0, t + (r * tall) / spec.rows, (depth - 0.003) / 2], [inner, 0.0016, depth - 0.003]);
    return s.geometry();
  };
  const lowerCarcass = carcass(LOWER, "cabinet", 0.0015), upperCarcass = carcass(UPPER, "ivory", 0.002);
  const slots: Slot[] = [];
  for (let unit = 0; unit < 12; unit++) {
    const upper = unit >= 6, spec = upper ? UPPER : LOWER, column = unit % 3, tier = Math.floor((unit % 6) / 3);
    const x = -(D.right - D.left) / 2 + unitW / 2 + column * (unitW + gap), y = upper ? D.ledge + tier * upperH : D.plinth + tier * lowerH;
    kit.mesh("drawer_cabinet", upper ? upperCarcass : lowerCarcass, [x, y, 0], f.satin, wall);
    const inner = unitW - 2 * spec.t, tall = spec.height - 2 * spec.t, px = inner / spec.columns, py = tall / spec.rows;
    for (let r = 0; r < spec.rows; r++) for (let c = 0; c < spec.columns; c++) {
      slots.push({ x: x - inner / 2 + (c + 0.5) * px, y: y + spec.t + (r + 0.5) * py, z: spec.depth - 0.0015, w: px - spec.gapX, h: py - spec.gapY, upper, unit, column: c, row: r });
    }
    // The yellow asset tag at each grey cabinet's top left corner.
    if (!upper) kit.mesh("drawer_tag", printed(0.0085, 0.0085, ATLAS.tag(unit % 4)), [x - unitW / 2 + 0.019, y + spec.height - spec.t / 2, spec.depth + 0.0002], f.print, wall);
  }

  kit.mesh("drawer_tag", printed(0.04, 0.04, ATLAS.tag(1)), [(D.right - D.left) / 2 + 0.0002, 0.9, 0.15], f.print, wall).rotation.y = Math.PI / 2;
  kit.mesh("drawer_tag", printed(0.07, 0.035, ATLAS.reel), [(D.right - D.left) / 2 + 0.0002, 1.62, 0.09], f.print, wall).rotation.y = Math.PI / 2;
  // Fronts: a chamfered slab with a pull lip, one geometry per cabinet type, instanced.
  const T = 0.011;
  const frontShape = (w: number, h: number, lip: number): BufferGeometry => new Shape().ink("white").front([0, 0, -T / 2], [w, h, T], 0.0012).lip([0, -h / 2 + 0.0058, 0.0035], [lip, 0.0052, 0.007]).geometry();
  const lowerSlots = slots.filter(s => !s.upper), upperSlots = slots.filter(s => s.upper);
  const smoke = new MeshStandardMaterial({ name: "drawer_smoke", color: 0x5a5d63, roughness: 0.34 });
  const milky = new MeshPhysicalMaterial({ name: "drawer_milky", color: 0xe4e1d6, roughness: 0.3, clearcoat: 0.5, clearcoatRoughness: 0.12 });
  // A few drawers left pulled out.
  const pulled = new Map<Slot, number>();
  const choose = (pool: Slot[], count: number, ok: (s: Slot) => boolean) => {
    for (let guard = 0; pulled.size < count && guard < 400; guard++) { const s = pool[Math.floor(random() * pool.length)]!; if (ok(s) && !pulled.has(s)) pulled.set(s, 0.02 + random() * 0.04); }
  };
  choose(lowerSlots, 5, s => s.y > 0.3 && s.unit % 3 >= 1);
  choose(upperSlots, 7, s => s.y < 1.36);
  const place = new Matrix4(), turn = new Quaternion(), tint = new Color();
  const tones: Map<Slot, [number, number, number]> = new Map();
  const fronts = (pool: Slot[], material: MeshStandardMaterial, lip: number) => {
    const first = pool[0]!, mesh = new InstancedMesh(frontShape(first.w, first.h, lip), material, pool.length);
    pool.forEach((s, i) => {
      mesh.setMatrixAt(i, place.makeTranslation(s.x, s.y, s.z + (pulled.get(s) ?? 0)));
      // What is in a drawer shows through its front: mostly dark, some empty and pale, some coloured.
      let tone: [number, number, number];
      if (s.upper) {
        const fill = random(), hue = random();
        const v = fill < 0.18 ? 1 : 0.5 + random() * 0.35;
        tone = hue < 0.12 ? [v * 0.72, v * 0.95, v * 0.78] : hue < 0.2 ? [v, v * 0.82, v * 0.62] : hue < 0.26 ? [v * 0.75, v * 0.85, v] : [v, v * 0.985, v * 0.95];
        // The top-left organiser holds a block of green-bagged parts.
        if (s.unit === 9 && s.column < 2 && s.row > 2) tone = [0.42, 0.78, 0.5];
      } else {
        const v = 0.62 + random() * 0.5;
        tone = [v, v, v * 1.03];
      }
      tones.set(s, tone);
      mesh.setColorAt(i, tint.setRGB(...tone));
    });
    kit.add(mesh, "drawer", [0, 0, 0], wall);
  };
  fronts(lowerSlots, smoke, 0.03);
  fronts(upperSlots, milky, 0.052);

  // Labels: twenty prints, most red and white; each print is one instanced mesh.
  const LABEL: [number, number] = [0.058, 0.0232];
  const byPrint: Slot[][] = Array.from({ length: 20 }, () => []);
  const coloured = [6, 10, 13, 14, 18], red = Array.from({ length: 20 }, (_, i) => i).filter(i => !coloured.includes(i));
  for (const s of slots) {
    if (random() < 0.012) continue;                                     // a drawer nobody labelled
    let print = red[Math.floor(random() * red.length)]!;
    if (random() < 0.07) print = coloured[Math.floor(random() * coloured.length)]!;
    if (s.unit === 9 && s.column < 2 && s.row > 2) print = random() < 0.8 ? 10 : 14;
    if (s.unit === 7 && s.row === 6) print = 6;
    byPrint[print]!.push(s);
  }
  byPrint.forEach((pool, print) => {
    if (!pool.length) return;
    const mesh = new InstancedMesh(printed(LABEL[0], LABEL[1], ATLAS.drawer(print)), f.print, pool.length);
    pool.forEach((s, i) => {
      const scale = s.upper ? 1.16 : 1, skew = (random() - 0.5) * 0.03;
      turn.setFromAxisAngle(new Vector3(0, 0, 1), skew);
      mesh.setMatrixAt(i, place.compose(new Vector3(s.x + (random() - 0.5) * 0.003, s.y + (s.upper ? 0.0052 : 0.0048) + (random() - 0.5) * 0.0012, s.z + (pulled.get(s) ?? 0) + 0.0002), turn, new Vector3(scale, scale, 1)));
    });
    kit.add(mesh, "drawer_label", [0, 0, 0], wall);
  });

  // The pulled drawers show their trays and what is in them.
  const cube = new Shape().ink("white").block([0, 0, 0], [1, 1, 1]).geometry();
  const trayParts: { at: V3; size: V3; tone: [number, number, number]; upper: boolean }[] = [], specks: { at: V3; size: V3; tone: [number, number, number]; spin: number }[] = [];
  const partColours: [number, number, number][] = [[0.05, 0.05, 0.06], [0.75, 0.7, 0.55], [0.1, 0.25, 0.7], [0.75, 0.12, 0.1], [0.85, 0.85, 0.85], [0.1, 0.5, 0.2], [0.8, 0.55, 0.1], [0.3, 0.3, 0.33]];
  for (const [s, out] of pulled) {
    const depth = 0.13, zc = s.z + out - T - depth / 2, tone = tones.get(s)!, wallT = 0.0016;
    trayParts.push({ at: [s.x, s.y - s.h / 2 + wallT / 2 + 0.001, zc], size: [s.w - 0.002, wallT, depth], tone, upper: s.upper });
    for (const side of [-1, 1]) trayParts.push({ at: [s.x + side * (s.w / 2 - 0.001 - wallT / 2), s.y - s.h * 0.06, zc], size: [wallT, s.h * 0.86, depth], tone, upper: s.upper });
    const colour = partColours[Math.floor(random() * partColours.length)]!, kind = random();
    for (let k = 0; k < 16; k++) {
      const size: V3 = kind < 0.5 ? [0.004 + random() * 0.004, 0.002 + random() * 0.002, 0.003 + random() * 0.003] : [0.007 + random() * 0.005, 0.003, 0.0035];
      specks.push({ at: [s.x + (random() - 0.5) * (s.w - 0.014), s.y - s.h / 2 + 0.0035 + random() * 0.003, s.z + out - T - 0.004 - random() * Math.max(0.006, out + 0.01)], size, tone: random() < 0.8 ? colour : partColours[Math.floor(random() * partColours.length)]!, spin: random() * 3 });
    }
  }
  for (const upper of [false, true]) {
    const pool = trayParts.filter(p => p.upper === upper);
    if (!pool.length) continue;
    const mesh = new InstancedMesh(cube, upper ? milky : smoke, pool.length);
    pool.forEach((p, i) => { mesh.setMatrixAt(i, place.compose(new Vector3(...p.at), turn.set(0, 0, 0, 1), new Vector3(...p.size))); mesh.setColorAt(i, tint.setRGB(...p.tone)); });
    kit.add(mesh, "drawer_tray", [0, 0, 0], wall);
  }
  const parts = new InstancedMesh(cube, f.satin, specks.length);
  specks.forEach((p, i) => { parts.setMatrixAt(i, place.compose(new Vector3(...p.at), turn.setFromAxisAngle(new Vector3(0, 1, 0), p.spin), new Vector3(...p.size))); parts.setColorAt(i, tint.setRGB(...p.tone)); });
  kit.add(parts, "drawer_parts", [0, 0, 0], wall);

  // On the ledge the grey cabinets leave: a parts box and a reel someone has not put back.
  const ledge = new Shape().ink("teal");
  ledge.front([0.52, D.ledge + 0.011, D.upperDepth + 0.024], [0.074, 0.022, 0.04], 0.0015).ink("black").front([0.52, D.ledge + 0.0235, D.upperDepth + 0.024], [0.076, 0.003, 0.042], 0.001);
  ledge.ink("tan").front([-0.31, D.ledge + 0.019, D.upperDepth + 0.027], [0.11, 0.038, 0.046], 0.001).ink("cream").front([-0.31, D.ledge + 0.0385, D.upperDepth + 0.027], [0.03, 0.0006, 0.046], 0);
  ledge.ink("black").push([0.1, D.ledge + 0.0065, D.upperDepth + 0.03], Math.PI / 2, 0, 0.12).rod([0, -0.06, 0], [0, 0.05, 0], 0.0065, 0.0065, 12).ink("red").rod([0, 0.05, 0], [0, 0.072, 0], 0.007, 0.0062, 12).pop();
  kit.mesh("ledge_box", ledge.geometry(), [0, 0, 0], f.satin, wall);
  return wall;
}

// ----------------------------------------------------------------------------------------------- clipboards

function buildClipboards(kit: Kit, f: Finishes): QuestHandle[] {
  const C = CLIPBOARDS, random = rng(606);
  const [bw, bh] = C.board, [sw, sh] = C.sheet;
  const hardboard = new MeshStandardMaterial({ name: "clipboard_board", map: noiseTexture(31, 128, [0.5, 0.345, 0.2], 0.035, 20, 5), roughness: 0.58 });
  const boardShape = roundedPlate(bw, bh, 0.003, 0.012);
  // The clip: a plate riveted to the board, a sprung jaw with a rolled edge, and the hanging hole's tab.
  const clip = new Shape();
  clip.block([0, bh / 2 - 0.021, 0.0021], [0.1, 0.03, 0.0012], 0.0004);
  clip.rod([-0.046, bh / 2 - 0.012, 0.0085], [0.046, bh / 2 - 0.012, 0.0085], 0.0042, 0.0042, 12);
  for (const x of [-0.04, 0.04]) clip.block([x, bh / 2 - 0.012, 0.0055], [0.008, 0.01, 0.006], 0.0005);
  clip.push([0, bh / 2 - 0.012, 0.0085], 0, 0.2).block([0, -0.016, 0.003], [0.104, 0.03, 0.0012], 0.0004).rod([-0.052, -0.031, 0.0022], [0.052, -0.031, 0.0022], 0.0016, 0.0016, 8).pop();
  clip.push([0, bh / 2 - 0.012, 0.0085], 0, 0.3).block([0, 0.011, 0.0034], [0.034, 0.02, 0.0012], 0.0004).rod([-0.017, 0.021, 0.0042], [0.017, 0.021, 0.0042], 0.0014, 0.0014, 8).pop();
  // The wire loop it hangs by.
  clip.cable([[-0.013, bh / 2 - 0.012, 0.004], [-0.009, bh / 2 + 0.002, 0.003], [0, bh / 2 + 0.0068, 0.003], [0.009, bh / 2 + 0.002, 0.003], [0.013, bh / 2 - 0.012, 0.004]], 0.0009, 5, 4);
  for (const x of [-0.036, 0.036]) clip.rod([x, bh / 2 - 0.026, 0.0026], [x, bh / 2 - 0.026, 0.0034], 0.0026, 0.0022, 8, "end");
  const clipShape = clip.geometry();
  const nail = new Shape().rod([0, 0, -0.002], [0, 0.0012, 0.009], 0.0012, 0.0012, 8, "none").rod([0, 0.0012, 0.009], [0, 0.0012, 0.0102], 0.0034, 0.003, 10).geometry();
  const paper = new Shape().ink("paper").poly([[-sw / 2, -sh / 2, 0], [sw / 2, -sh / 2, 0], [sw / 2, sh / 2, 0], [-sw / 2, sh / 2, 0]], [0, 0, 1]).geometry();
  const quests: QuestHandle[] = [];
  for (let i = 0; i < 6; i++) {
    const x = C.first + i * C.pitch, y = C.y + (random() - 0.5) * 0.008, tilt = (random() - 0.5) * 0.045;
    const group = kit.group(`quest-${i}`, [x, y, WALL + 0.0035]);
    group.rotation.z = tilt;
    kit.mesh("clipboard", boardShape, [0, 0, 0], hardboard, group);
    kit.mesh("clipboard", clipShape, [0, 0, 0], f.steel, group);
    kit.mesh("clipboard", nail, [0, bh / 2 + 0.0048, -0.0015], f.steel, group);
    // Under the card, a few older pages not quite squared up.
    const under = kit.mesh("clipboard", paper, [(random() - 0.5) * 0.004, -0.0065 - random() * 0.003, 0.0021], f.matte, group);
    under.rotation.z = (random() - 0.5) * 0.03;
    const material = new MeshStandardMaterial({ name: `quest-sheet-${i}`, map: new Texture(`room/assets/gen/wall/quest-${i}.png`), roughness: 0.72 });
    const at: V3 = [0, -0.0055, 0.0028];
    const sheet = kit.add(new Mesh(new PlaneGeometry(sw, sh), material), `quest-sheet-${i}`, at, group);
    const c = Math.cos(tilt), s = Math.sin(tilt);
    quests.push({ group, sheet, material, center: [x + at[0] * c - at[1] * s, y + at[0] * s + at[1] * c, WALL + 0.0035 + at[2]] });
  }
  return quests;
}

// ----------------------------------------------------------------------------------------------- whiteboard

function buildWhiteboard(kit: Kit, f: Finishes): Group {
  const [w, h] = WHITEBOARD.size, bar = 0.015, deep = 0.016;
  const board = kit.group("whiteboard", WHITEBOARD.at);
  board.rotation.z = -0.006;
  const surface = new MeshPhysicalMaterial({ name: "whiteboard_surface", map: new Texture("room/assets/gen/wall/whiteboard.png"), roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.08 });
  kit.add(new Mesh(new PlaneGeometry(w - 2 * bar + 0.004, h - 2 * bar + 0.004), surface), "whiteboard", [0, 0, 0.009], board);
  kit.mesh("whiteboard", new Shape().ink("white").block([0, 0, 0.0045], [w - 0.01, h - 0.01, 0.008]).geometry(), [0, 0, 0], f.matte, board);
  const aluminium = std("whiteboard_frame", 0xcfd2d6, 0.34, 0.9);
  kit.soft("whiteboard", [w - 0.02, bar, deep], 0.0025, [0, h / 2 - bar / 2, deep / 2], aluminium, board, 2);
  kit.soft("whiteboard", [w - 0.02, bar, deep], 0.0025, [0, -h / 2 + bar / 2, deep / 2], aluminium, board, 2);
  kit.soft("whiteboard", [bar, h - 0.02, deep], 0.0025, [-w / 2 + bar / 2, 0, deep / 2], aluminium, board, 2);
  kit.soft("whiteboard", [bar, h - 0.02, deep], 0.0025, [w / 2 - bar / 2, 0, deep / 2], aluminium, board, 2);
  // Plastic corner caps, the marker tray, two markers, an eraser, two magnets.
  const bits = new Shape().ink("grey");
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) bits.add(roundedBox(0.024, 0.024, deep + 0.002, 0.004, 2), [sx * (w / 2 - 0.011), sy * (h / 2 - 0.011), deep / 2 + 0.0005]);
  bits.ink("silver").block([0.03, -h / 2 + 0.003, deep + 0.024], [0.44, 0.003, 0.05], 0.0008).block([0.03, -h / 2 + 0.008, deep + 0.048], [0.44, 0.011, 0.003], 0.0008);
  for (const sx of [-1, 1]) bits.ink("grey").block([0.03 + sx * 0.221, -h / 2 + 0.007, deep + 0.024], [0.004, 0.013, 0.052], 0.001);
  const marker = (x: number, ink: Ink, turnY: number) => {
    bits.push([x, -h / 2 + 0.013, deep + 0.03], Math.PI / 2, 0, turnY);
    bits.ink("white").turn([[0, -0.06], [0.0072, -0.06], [0.0078, -0.058], [0.0078, 0.03], [0.0072, 0.031], [0, 0.031]], 14);
    bits.ink(ink).turn([[0, 0.031], [0.0084, 0.031], [0.0084, 0.066], [0.0076, 0.07], [0, 0.07]], 14).turn([[0.0078, -0.058], [0.0084, -0.058], [0.0084, -0.05], [0.0078, -0.05]], 14);
    bits.pop();
  };
  marker(-0.09, "black", 0.05); marker(0.06, "red", -0.08);
  bits.ink("blue").add(roundedBox(0.1, 0.024, 0.044, 0.006, 2), [0.185, -h / 2 + 0.0245, deep + 0.025]).ink("felt").block([0.185, -h / 2 + 0.0085, deep + 0.025], [0.098, 0.008, 0.042], 0.0015);
  bits.ink("yellow").block([-0.195, -0.115, 0.0093], [0.076, 0.076, 0.0005]);
  bits.ink("red").push([-0.195, -0.086, 0.0096], 0, Math.PI / 2).turn([[0, 0], [0.012, 0], [0.013, 0.001], [0.013, 0.005], [0.0115, 0.0066], [0, 0.0066]], 18).pop();
  bits.ink("blue").push([0.245, -0.005, 0.009], 0, Math.PI / 2).turn([[0, 0], [0.012, 0], [0.013, 0.001], [0.013, 0.005], [0.0115, 0.0066], [0, 0.0066]], 18).pop();
  kit.mesh("whiteboard", bits.geometry(), [0, 0, 0], f.gloss, board);
  return board;
}

/** Triangles under `root`, an instanced mesh counted once per instance; and the materials used. */
export function wallBudget(root: Object3D): { triangles: number; materials: string[]; meshes: number } {
  let triangles = 0, meshes = 0;
  const materials = new Set<string>();
  const visit = (object: Object3D) => {
    const mesh = object as unknown as { isMesh?: boolean; geometry?: BufferGeometry; material?: MeshStandardMaterial; count?: number; isInstancedMesh?: boolean };
    if (mesh.isMesh && mesh.geometry) {
      const tris = (mesh.geometry.index.length || mesh.geometry.positions.length / 3) / 3;
      triangles += tris * (mesh.isInstancedMesh ? mesh.count ?? 1 : 1);
      meshes++;
      if (mesh.material) materials.add(mesh.material.name);
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  return { triangles, materials: [...materials].sort(), meshes };
}
