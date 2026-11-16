// The bench's instruments. On the riser: a 4-channel oscilloscope with its probe, a linear power supply with its
// leads, a 5.5-digit bench multimeter, a waveform generator, and between them a spool of solder, a box of jumper
// wires and a parts box. On the bench, at the back corners: a soldering station with its iron in a holder (right),
// a handheld multimeter with its leads, tweezers, a roll of polyimide tape and a few wire offcuts (left).
//
// Every front panel is one picture (room/art/instruments/*-panel.svg, a unit is 0.1 mm): the keys are caps whose
// tops show the part of that picture they sit on, so a key carries its printed legend without a material of its
// own. Small coloured parts share two materials through a palette texture (`TONES`).
import {
  BufferGeometry, CylinderGeometry, DataTexture, type Group, LatheGeometry, type Mesh, MeshPhysicalMaterial, MeshStandardMaterial, type Object3D,
  PlaneGeometry, RingGeometry, type Scene, SphereGeometry, Texture, TorusGeometry,
} from "@threert/scene";
import { Kit, coated, curve, glow, mm, noiseTexture, rng, roundedBox, roundedPlate, std, tube, type V3 } from "../lib.ts";
import { BENCH, RISER } from "../layout.ts";

export interface InstrumentHandles {
  /** The emissive pictures of the four displays the app animates, each on its own mesh. */
  scopeScreen: MeshStandardMaterial;
  psuDisplay: MeshStandardMaterial;
  dmmDisplay: MeshStandardMaterial;
  stationDisplay: MeshStandardMaterial;
}

/** The top of the riser's mat and of the bench's. */
const SHELF = BENCH.top + RISER.height + 0.002, TABLE = BENCH.top;
const ART = "room/assets/gen/instruments/";

// ------------------------------------------------------------------------------------------- the palette

/** Colours of the small parts (sRGB). One texel block each in the palette texture. */
const TONES = {
  black: 0x111213, graphite: 0x25272b, slate: 0x3b3f45, grey: 0x7b7f86, silver: 0xb6b8bc, light: 0xd5d4cf, white: 0xf1f0ea,
  red: 0xc3241d, orange: 0xe0561b, yellow: 0xe8b923, green: 0x2e9a4b, blue: 0x1f5aa6, cyan: 0x27b7d6, violet: 0x7a4bb5, brown: 0x7a4a26,
  kraft: 0xb7986a, cream: 0xe4dfd0, frost: 0xcdd5d6,
} as const;
type Tone = keyof typeof TONES;
const TONE_NAMES = Object.keys(TONES) as Tone[];
/** A palette colour as hard plastic, the same as rubber or card, or a material of its own. */
type Paint = Tone | { rubber: Tone } | MeshStandardMaterial;

function paletteTexture(): DataTexture {
  const cell = 8, w = TONE_NAMES.length * cell;
  const px = new Uint8Array(w * cell * 4);
  for (let y = 0; y < cell; y++) {
    for (let x = 0; x < w; x++) {
      const value = TONES[TONE_NAMES[Math.floor(x / cell)]!], o = (y * w + x) * 4;
      px[o] = (value >> 16) & 255; px[o + 1] = (value >> 8) & 255; px[o + 2] = value & 255; px[o + 3] = 255;
    }
  }
  const texture = new DataTexture(w, cell, px);
  texture.wrap = "clamp";
  return texture;
}

/** Points every vertex of `geometry` at one palette colour. */
function tint(geometry: BufferGeometry, tone: Tone): BufferGeometry {
  const uvs = new Float32Array((geometry.positions.length / 3) * 2);
  const u = (TONE_NAMES.indexOf(tone) + 0.5) / TONE_NAMES.length;
  for (let i = 0; i < uvs.length; i += 2) { uvs[i] = u; uvs[i + 1] = 0.5; }
  geometry.uvs = uvs;
  return geometry;
}

// ------------------------------------------------------------------------------------------- shapes

type Rect = [u0: number, v0: number, u1: number, v1: number];
/** Where things are on the label sheet (room/art/instruments/labels.svg). */
const LABEL = {
  solder: [6 / 1024, 1 - 506 / 640, 506 / 1024, 1 - 6 / 640], parts: [0.5, 0.6, 1, 1], jumpers: [0.5, 0.2, 1, 0.6],
  calibrated: [0, 0, 0.25, 0.2], asset: [0.25, 0, 0.5, 0.2], hot: [0.5, 0, 0.75, 0.2], passed: [0.75, 0, 1, 0.2],
} satisfies Record<string, Rect>;

/** A rounded rectangle's outline, counter-clockwise, with the outward direction at each point. */
function outline(width: number, height: number, r: number, segments: number): [number, number, number, number][] {
  r = Math.max(1e-6, Math.min(r, width / 2, height / 2));
  const out: [number, number, number, number][] = [];
  const corners: [number, number, number][] = [[width / 2 - r, height / 2 - r, 0], [-width / 2 + r, height / 2 - r, Math.PI / 2], [-width / 2 + r, -height / 2 + r, Math.PI], [width / 2 - r, -height / 2 + r, 1.5 * Math.PI]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2), c = Math.cos(a), s = Math.sin(a);
      out.push([cx + c * r, cy + s * r, c, s]);
    }
  }
  return out;
}

/**
 * A key cap: a rounded rectangle `t` tall standing on z = 0, its top edge chamfered by `bevel`. Its UVs lay the
 * rectangle `uv` of a picture over the top (the sides take the picture's colour at the cap's rim).
 */
function keycap(width: number, height: number, t: number, r: number, bevel: number, uv: Rect, segments = 3, closed = false): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  const outer = outline(width, height, r, segments), inner = outline(width - 2 * bevel, height - 2 * bevel, r - bevel, segments), n = outer.length;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
    const length = Math.hypot(nx, ny, nz);
    positions.push(x, y, z); normals.push(nx / length, ny / length, nz / length);
    const fx = Math.max(-0.47, Math.min(0.47, x / width)) + 0.5, fy = Math.max(-0.47, Math.min(0.47, y / height)) + 0.5;
    uvs.push(uv[0] + fx * (uv[2] - uv[0]), uv[1] + fy * (uv[3] - uv[1]));
    return positions.length / 3 - 1;
  };
  const centre = push(0, 0, t, 0, 0, 1);
  const top = inner.map(([x, y, nx, ny]) => push(x, y, t, nx * 0.12, ny * 0.12, 1));
  for (let i = 0; i < n; i++) index.push(centre, top[i]!, top[(i + 1) % n]!);
  const strip = (upper: number[], lower: number[]) => {
    for (let i = 0; i < n; i++) {
      const a = upper[i]!, b = upper[(i + 1) % n]!, c = lower[i]!, d = lower[(i + 1) % n]!;
      index.push(c, d, b, c, b, a);
    }
  };
  // The chamfer's normals run from the top's to the side's, so it shades as a rounded edge.
  const rim = outer.map(([x, y, nx, ny]) => push(x, y, t - bevel, nx, ny, 0.2));
  if (bevel > 0) strip(top, rim);
  strip(rim, outer.map(([x, y, nx, ny]) => push(x, y, 0, nx, ny, 0)));
  if (closed) {
    const back = push(0, 0, 0, 0, 0, -1), ring = outer.map(([x, y]) => push(x, y, 0, 0, 0, -1));
    for (let i = 0; i < n; i++) index.push(back, ring[(i + 1) % n]!, ring[i]!);
  }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/**
 * A knob standing on z = 0: a skirt, a grip that narrows a little (fluted when `flutes` > 0) and a flat top with a
 * rounded edge.
 */
function knobGeometry(R: number, h: number, flutes: number, sides: number): BufferGeometry {
  const e = Math.min(R * 0.14, h * 0.14);
  const rows: [radius: number, z: number, grip: number][] = [
    [R, 0, 0], [R, h * 0.16, 0], [R, h * 0.16, 0], [R * 0.9, h * 0.22, 1], [R * 0.86, h - e, 1], [R * 0.82, h - e * 0.3, 0.3], [R * 0.72, h, 0], [R * 0.72, h, 0], [0, h, 0],
  ];
  const positions: number[] = [], index: number[] = [];
  for (const [radius, z, grip] of rows) {
    for (let i = 0; i < sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const r = radius * (1 - (flutes ? grip * 0.07 * (0.5 - 0.5 * Math.cos(a * flutes)) : 0));
      positions.push(Math.cos(a) * r, Math.sin(a) * r, z);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    if (rows[j]![0] === rows[j + 1]![0] && rows[j]![1] === rows[j + 1]![1]) continue;
    for (let i = 0; i < sides; i++) {
      const a = j * sides + i, b = j * sides + ((i + 1) % sides), c = a + sides, d = b + sides;
      index.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry().setData(positions, new Array(positions.length).fill(0), new Array((positions.length / 3) * 2).fill(0), index);
  geometry.computeVertexNormals();
  return geometry;
}

/** A solid of flat faces: each quad counter-clockwise seen from outside. */
function facets(quads: V3[][]): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  for (const quad of quads) {
    const [a, b, c] = quad as [V3, V3, V3];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1]! * v[2]! - u[2]! * v[1]!, ny = u[2]! * v[0]! - u[0]! * v[2]!, nz = u[0]! * v[1]! - u[1]! * v[0]!, length = Math.hypot(nx, ny, nz) || 1;
    const start = positions.length / 3;
    for (const p of quad) { positions.push(...p); normals.push(nx / length, ny / length, nz / length); uvs.push(0, 0); }
    index.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/** A bar along +X from the origin, `t` thick (Y), that narrows from `w0` to `w1` (Z): a tweezer's blade. */
function taperBar(length: number, w0: number, w1: number, t: number): BufferGeometry {
  const a = w0 / 2, b = w1 / 2, L = length;
  return facets([
    [[0, t, a], [L, t, b], [L, t, -b], [0, t, -a]], [[0, 0, -a], [L, 0, -b], [L, 0, b], [0, 0, a]],
    [[0, 0, a], [L, 0, b], [L, t, b], [0, t, a]], [[0, 0, -a], [0, t, -a], [L, t, -b], [L, 0, -b]],
    [[0, 0, -a], [0, 0, a], [0, t, a], [0, t, -a]], [[L, 0, b], [L, 0, -b], [L, t, -b], [L, t, b]],
  ]);
}

/** A plain box (millimetres), for parts too thin to need rounded edges. */
function boxGeometry(size: V3): BufferGeometry {
  const w = (size[0] * mm) / 2, h = (size[1] * mm) / 2, d = (size[2] * mm) / 2;
  return facets([
    [[-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]], [[w, -h, -d], [-w, -h, -d], [-w, h, -d], [w, h, -d]],
    [[w, -h, d], [w, -h, -d], [w, h, -d], [w, h, d]], [[-w, -h, -d], [-w, -h, d], [-w, h, d], [-w, h, -d]],
    [[-w, h, d], [w, h, d], [w, h, -d], [-w, h, -d]], [[-w, -h, -d], [w, -h, -d], [w, -h, d], [-w, -h, d]],
  ]);
}

/**
 * Loops of a loosely coiled lead lying flat: control points around (cx, cz), rising by `rise` a turn. The loops
 * wander by `loose` so that they lie beside each other and not in one ring.
 */
function coilPoints(cx: number, cz: number, R: number, turns: number, start: number, y: number, rise: number, loose: number): V3[] {
  const out: V3[] = [], per = 8, count = Math.round(turns * per);
  for (let i = 0; i <= count; i++) {
    const t = (i / per) * Math.PI * 2, a = start + t, r = R + loose * 0.7 * Math.sin(t * 0.53 + 2);
    out.push([cx + loose * Math.sin(t * 0.37 + 1) + Math.cos(a) * r, y + (rise * i) / per, cz + loose * 0.8 * Math.cos(t * 0.29) + Math.sin(a) * r]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------- building

type Axis = "x" | "y" | "z";
/** Turns a geometry built along +Y so that it runs along `axis`. */
function along<T extends BufferGeometry>(geometry: T, axis: Axis): T {
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  else if (axis === "x") geometry.rotateZ(-Math.PI / 2);
  return geometry;
}
interface Options { parent?: Object3D; seg?: number; sides?: number; top?: number; steps?: number }

/** What the parts are made of, and the geometries they share. */
class Workshop {
  readonly kit: Kit;
  private readonly geometries = new Map<string, BufferGeometry>();
  private readonly palette = paletteTexture();
  readonly plastic = new MeshStandardMaterial({ name: "inst_plastic", map: this.palette, roughness: 0.45 });
  readonly rubber = new MeshStandardMaterial({ name: "inst_rubber", map: this.palette, roughness: 0.85 });
  /** Moulded cases, a little uneven so that a large face is not one flat colour. */
  readonly caseLight = this.moulded("inst_case_light", 31, [0.835, 0.83, 0.81], 0.5);
  readonly caseDark = this.moulded("inst_case_dark", 32, [0.2, 0.208, 0.222], 0.55);
  /** Painted sheet steel: the sleeves of the supply and the multimeter. */
  readonly steel: MeshStandardMaterial;
  readonly metal = std("inst_metal", 0xc4c6c9, 0.3, 1);
  readonly brass = std("inst_brass", 0xc9a24a, 0.32, 1);
  readonly glass = new MeshPhysicalMaterial({ name: "inst_glass", color: 0x050506, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 });
  readonly led = glow("inst_led", 0x4dff86, 1000);
  readonly labels = new MeshStandardMaterial({ name: "inst_labels", map: new Texture(`${ART}labels.png`), roughness: 0.6 });

  constructor(scene: Scene) {
    this.kit = new Kit(scene);
    const paint = noiseTexture(33, 128, [0.79, 0.795, 0.79], 0.012, 12);
    paint.repeat = [2, 2];
    this.steel = coated("inst_case_steel", 0xffffff, 0.42, 0.35);
    this.steel.map = paint;
  }
  private moulded(name: string, seed: number, base: V3, roughness: number): MeshStandardMaterial {
    const map = noiseTexture(seed, 128, base, 0.014, 16);
    map.repeat = [2, 2];
    return new MeshStandardMaterial({ name, map, roughness });
  }
  /** A printed panel's material. */
  art(name: string, file: string, roughness = 0.5): MeshStandardMaterial {
    const map = new Texture(`${ART}${file}.png`);
    map.wrap = "clamp";
    return new MeshStandardMaterial({ name, map, roughness });
  }
  /** A display: its picture as light. */
  lit(name: string, file: string, nits: number): MeshStandardMaterial {
    const map = new Texture(`${ART}${file}.png`);
    map.wrap = "clamp";
    return new MeshStandardMaterial({ name, color: 0x000000, roughness: 0.18, emissive: 0xffffff, emissiveIntensity: nits, emissiveMap: map });
  }
  /** The geometry `key` in `paint`, made once. */
  resolve(key: string, paint: Paint, make: () => BufferGeometry): [BufferGeometry, MeshStandardMaterial] {
    const tone = typeof paint === "string" ? paint : "rubber" in paint ? paint.rubber : null;
    const id = tone ? `${key}|${tone}` : key;
    let geometry = this.geometries.get(id);
    if (!geometry) this.geometries.set(id, geometry = tone ? tint(make(), tone) : make());
    return [geometry, typeof paint === "string" ? this.plastic : "rubber" in paint ? this.rubber : paint];
  }
  part(id: string, at: V3, yaw = 0): Part {
    const root = this.kit.group(id, at);
    root.rotation.y = yaw;
    return new Part(this, id, root);
  }
}

let unique = 0;

/** One thing: a group and what is added to it. Sizes and places are millimetres in the group's space. */
class Part {
  constructor(readonly shop: Workshop, readonly id: string, readonly root: Group) {}

  group(at: V3 = [0, 0, 0], parent: Object3D = this.root): Group {
    return this.shop.kit.group(null, [at[0] * mm, at[1] * mm, at[2] * mm], parent);
  }
  /** Adds a geometry (metres) at a place (millimetres). */
  put(key: string | null, make: () => BufferGeometry, paint: Paint, at: V3, parent: Object3D = this.root): Mesh {
    const [geometry, material] = this.shop.resolve(key ?? `one:${++unique}`, paint, make);
    return this.shop.kit.mesh(this.id, geometry, [at[0] * mm, at[1] * mm, at[2] * mm], material, parent);
  }
  box(size: V3, at: V3, paint: Paint, o: Options = {}): Mesh {
    return this.put(`box:${size.join(":")}`, () => boxGeometry(size), paint, at, o.parent);
  }
  /** A box with rounded edges. */
  soft(size: V3, r: number, at: V3, paint: Paint, o: Options = {}): Mesh {
    const seg = o.seg ?? 2;
    return this.put(`soft:${size.join(":")}:${r}:${seg}`, () => roundedBox(size[0] * mm, size[1] * mm, size[2] * mm, r * mm, seg), paint, at, o.parent);
  }
  /** A cylinder along `axis`, centred on `at`; `top` is its radius at the far end when it tapers. */
  cyl(radius: number, length: number, at: V3, paint: Paint, axis: Axis = "z", o: Options = {}): Mesh {
    const top = o.top ?? radius, sides = o.sides ?? 20;
    return this.put(`cyl:${radius}:${top}:${length}:${sides}:${axis}`, () => along(new CylinderGeometry(top * mm, radius * mm, length * mm, sides), axis), paint, at, o.parent);
  }
  /** A moulded front: a rounded rectangle `depth` deep whose face is the plane z = `at[2]`, its rim eased by `bevel`. */
  slab(width: number, height: number, depth: number, r: number, bevel: number, at: V3, paint: Paint, o: Options = {}): Mesh {
    return this.put(`slab:${width}:${height}:${depth}:${r}:${bevel}`, () => keycap(width * mm, height * mm, depth * mm, r * mm, bevel * mm, [0, 0, 1, 1], 6, true), paint, [at[0], at[1], at[2] - depth], o.parent);
  }
  ball(radius: number, at: V3, paint: Paint, o: Options = {}): Mesh {
    return this.put(`ball:${radius}`, () => new SphereGeometry(radius * mm, 16, 10), paint, at, o.parent);
  }
  /** A turned shape: `profile` is (radius, height) from the base up, about `axis` through `at`. */
  lathe(profile: [number, number][], at: V3, paint: Paint, axis: Axis = "z", o: Options = {}): Mesh {
    const sides = o.sides ?? 24;
    return this.put(`lathe:${profile.join(";")}:${sides}:${axis}`, () => along(new LatheGeometry(profile.map(([x, y]) => ({ x: x * mm, y: y * mm })), sides), axis), paint, at, o.parent);
  }
  /** A cable through `points` (millimetres). */
  tube(points: V3[], radius: number, paint: Paint, o: Options = {}): Mesh {
    const path = curve(points.map(p => [p[0] * mm, p[1] * mm, p[2] * mm] as V3), o.steps ?? 5);
    return this.put(null, () => tube(path, radius * mm, o.sides ?? 6), paint, [0, 0, 0], o.parent);
  }
  /** A printed sticker from the label sheet, `rect` of it, lying on a surface that faces +Y (or +Z when `upright`). */
  sticker(rect: Rect, w: number, h: number, at: V3, turn = 0, upright = false): Mesh {
    const mesh = this.put(`sticker:${rect.join(":")}:${w}:${h}`, () => keycap(w * mm, h * mm, 0.12 * mm, Math.min(w, h) * 0.08 * mm, 0, rect, 2), this.shop.labels, at);
    if (!upright) mesh.rotation.set(-Math.PI / 2, 0, turn);
    return mesh;
  }
  /** Thin dark slots in a row: a vent. */
  slots(count: number, size: V3, first: V3, step: V3, paint: Paint = "black"): void {
    for (let i = 0; i < count; i++) this.box(size, [first[0] + step[0] * i, first[1] + step[1] * i, first[2] + step[2] * i], paint);
  }
  /** A knob facing +Z on `at`, turned by `angle` (0: the mark points up). */
  knob(at: V3, R: number, h: number, paint: Paint, mark: Paint, o: { angle?: number; flutes?: number; parent?: Object3D } = {}): Group {
    const flutes = o.flutes ?? 0, sides = flutes ? flutes * 3 : 28;
    const group = this.group(at, o.parent);
    group.rotation.z = o.angle ?? 0;
    this.put(`knob:${R}:${h}:${flutes}`, () => knobGeometry(R * mm, h * mm, flutes, sides), paint, [0, 0, 0], group);
    const w = Math.max(0.7, R * 0.11);
    this.box([w, R * 0.46, 0.3], [0, R * 0.47, h + 0.1], mark, { parent: group });
    this.box([w, 0.5, h * 0.6], [0, R * 0.875, h * 0.58], mark, { parent: group });
    return group;
  }
  /** A panel BNC jack facing +Z. */
  bnc(at: V3): void {
    const metal = this.shop.metal;
    this.cyl(7.6, 2.2, [at[0], at[1], at[2] + 1.1], metal, "z", { sides: 6 });
    this.lathe([[6.0, 0], [6.0, 4.6], [4.85, 4.6], [4.85, 12.2], [4.6, 12.5], [4.2, 12.5], [4.05, 12.3], [4.05, 6.2], [1.25, 6.2], [1.25, 9.6], [0.9, 9.9], [0, 9.9]], at, metal, "z", { sides: 20 });
    this.put("bnc:ptfe", () => new RingGeometry(1.25 * mm, 4.05 * mm, 20), "white", [at[0], at[1], at[2] + 6.4]);
    for (const side of [-1, 1]) this.cyl(1.0, 1.7, [at[0] + side * 5.5, at[1], at[2] + 10], metal, "x", { sides: 8 });
  }
  /** A shrouded 4 mm jack facing +Z. */
  jack(at: V3, tone: Tone): void {
    this.lathe([[6.2, 0], [6.2, 3.2], [5.7, 3.8], [3.0, 3.8], [2.6, 3.5], [2.6, 0.5], [0, 0.5]], at, tone, "z", { sides: 20 });
    this.put("jack:hole", () => new RingGeometry(0, 2.6 * mm, 12), "black", [at[0], at[1], at[2] + 0.6]);
  }
  /** A binding post facing +Z: a fluted cap on a plated stud. */
  post(at: V3, tone: Tone): void {
    this.cyl(5.2, 2.4, [at[0], at[1], at[2] + 1.2], this.shop.metal, "z", { sides: 6 });
    this.cyl(3.0, 3, [at[0], at[1], at[2] + 3.5], this.shop.metal, "z", { sides: 12 });
    this.put("post:cap", () => knobGeometry(6.6 * mm, 10.5 * mm, 12, 36), tone, [at[0], at[1], at[2] + 4.6]);
    this.put("post:hole", () => new RingGeometry(0, 2.3 * mm, 12), "black", [at[0], at[1], at[2] + 15.2]);
  }
  /** A rocker switch facing +Z, pressed in at the top. */
  rocker(at: V3, w: number, h: number): void {
    this.soft([w + 3, h + 3, 2.4], 1.2, [at[0], at[1], at[2] + 1.2], "black");
    const paddle = this.soft([w, h, 5], 1.2, [at[0], at[1], at[2] + 2.6], "graphite");
    paddle.rotation.x = -0.14;
    const dot = this.box([0.7, h * 0.2, 0.3], [at[0], at[1] + h * 0.27, at[2] + 4.55], "white");
    dot.rotation.x = -0.14;
  }
}


/** A front panel: a printed plate on the plane z = 0 of its part, and what stands on it. Millimetres from its top left. */
class Panel {
  /** The printed face's height over the surface it lies on (`base`). */
  readonly z: number;
  constructor(readonly part: Part, readonly material: MeshStandardMaterial, readonly W: number, readonly H: number, readonly centre: [number, number], r: number, base = 0) {
    this.z = base + 0.4;
    part.put(null, () => roundedPlate(W * mm, H * mm, 0.4 * mm, r * mm), material, [centre[0], centre[1], base + 0.2]);
  }
  at(px: number, py: number, dz = 0): V3 {
    return [this.centre[0] - this.W / 2 + px, this.centre[1] + this.H / 2 - py, this.z + dz];
  }
  /** A key whose top shows the picture under it. */
  key(px: number, py: number, w: number, h: number, t = 1.6, r = 1.1): Mesh {
    const uv: Rect = [(px - w / 2) / this.W, 1 - (py + h / 2) / this.H, (px + w / 2) / this.W, 1 - (py - h / 2) / this.H];
    return this.part.put(null, () => keycap(w * mm, h * mm, t * mm, r * mm, 0.35 * mm, uv, r > 3 ? 5 : 3), this.material, this.at(px, py));
  }
  keys(places: [number, number][], w: number, h: number, t = 1.6): void {
    for (const [px, py] of places) this.key(px, py, w, h, t);
  }
  /** A window of dark glass with a lit picture behind it, and optionally a raised rim around it. */
  display(material: MeshStandardMaterial, px: number, py: number, glass: [number, number], lit: [number, number], rim?: Paint): void {
    const shop = this.part.shop;
    this.part.put(null, () => roundedPlate(glass[0] * mm, glass[1] * mm, 1 * mm, 2.2 * mm), shop.glass, this.at(px, py, 0.5));
    const picture = this.part.put(null, () => new PlaneGeometry(lit[0] * mm, lit[1] * mm), material, this.at(px, py, 1.08));
    picture.castShadow = false;
    if (rim) {
      const b = 2.4, proud = 2.2, w = glass[0] + 2 * b, h = glass[1] + 2 * b;
      for (const side of [-1, 1]) {
        this.part.soft([w, b, proud], 0.9, this.at(px, py + side * (h - b) / 2, proud / 2 - 0.2), rim);
        this.part.soft([b, h, proud], 0.9, this.at(px + side * (w - b) / 2, py, proud / 2 - 0.2), rim);
      }
    }
  }
  /** A small round indicator. */
  lamp(px: number, py: number, paint: Paint, radius = 1.3): void {
    this.part.cyl(radius + 0.6, 0.8, this.at(px, py, 0.4), "black", "z", { sides: 14 });
    this.part.cyl(radius, 1.2, this.at(px, py, 0.8), paint, "z", { sides: 12 });
  }
}

// ------------------------------------------------------------------------------------------- the oscilloscope

function buildScope(shop: Workshop, at: V3): MeshStandardMaterial {
  const p = shop.part("scope", at);
  const feet = 6, W = 312, H = 146, mid = feet + H / 2;
  for (const x of [-124, 124]) for (const z of [-16, -104]) p.soft([22, 8, 14], 2.5, [x, 4, z], { rubber: "black" });
  // A light bezel in front of a dark shell, with a grip moulded into the top.
  p.slab(W, H, 34, 7, 1.6, [0, mid, 0], shop.caseLight);
  p.soft([W - 12, H - 10, 90], 14, [0, mid - 1, -77], shop.caseDark, { seg: 4 });
  p.soft([124, 7, 22], 3, [0, feet + H - 7.5, -84], { rubber: "graphite" });
  for (const side of [-1, 1]) {
    p.slots(8, [2.2, 0.8, 36], [side * 80, feet + H - 6.35, -84], [side * 6, 0, 0]);
    p.slots(7, [0.8, 2.2, 44], [side * (W / 2 - 6.35), mid - 30, -80], [0, 9, 0]);
  }

  p.sticker(LABEL.calibrated, 24, 12, [118, feet + H + 0.02, -15], 0.04);

  const panel = new Panel(p, shop.art("scope_panel", "scope-panel"), 306, 140, [0, mid], 4.5);
  const screen = shop.lit("scope_screen", "scope-screen", 180);
  panel.display(screen, 88, 57, [160, 98], [152, 91], shop.caseLight);
  // Soft keys beside the screen, level with the menu the screen shows.
  panel.keys([[177.5, 17.5], [177.5, 30], [177.5, 41.6], [177.5, 53.1], [177.5, 64.7], [177.5, 76.3], [177.5, 87.8], [177.5, 100]], 11, 7);
  panel.keys([[222, 14], [236, 14], [250, 14], [222, 26], [236, 26], [250, 26]], 12, 7.5);
  panel.keys([[271, 14], [289, 14], [271, 26], [289, 26]], 15, 8);
  panel.keys([[200, 53], [200, 65], [200, 77], [200, 89]], 11, 8);
  panel.keys([[200, 99.5], [214.5, 99.5], [229, 99.5], [261, 99.5]], 12, 7);
  panel.keys([[288, 71], [288, 85], [288, 99.5]], 13, 7.5);
  panel.key(13, 124.5, 11.6, 11.6, 1.4, 5.8);
  panel.lamp(13, 114.8, shop.led, 1.1);
  // The knob field: position knobs small, scale knobs larger.
  const knobs: [number, number, number, number, number][] = [[202, 20, 7, 11, 0.5], [229, 56, 6, 12, -0.7], [229, 79.7, 8.5, 13, 0.9], [261, 56, 6, 12, 0.2], [261, 86.8, 7.8, 13, -1.2], [288, 56, 6, 12, 2.1]];
  for (const [px, py, R, h, angle] of knobs) p.knob(panel.at(px, py), R, h, "silver", "graphite", { angle, flutes: 12 });
  // A USB socket, four inputs, and the probe-adjust tabs.
  p.soft([14.4, 7, 1.4], 0.6, panel.at(34, 124.5, 0.5), shop.metal);
  p.box([12.6, 5.2, 0.4], panel.at(34, 124.5, 1.25), "black");
  p.box([11, 1.7, 0.5], panel.at(34, 125.4, 1.4), "white");
  for (const px of [183, 215, 247, 279]) p.bnc(panel.at(px, 124.5));
  for (const py of [120.2, 130.8]) {
    p.box([4.4, 1.0, 5], panel.at(297.6, py, 2.5), shop.metal);
    p.box([5.6, 3.4, 0.8], panel.at(297.6, py, 0.4), "black");
  }

  // The probe on channel 1: its plug and compensation box, the lead lying coiled beside the scope, the probe in front.
  const jack = panel.at(183, 124.5);
  p.lathe([[7.3, 3], [7.3, 15], [6.4, 16], [6.4, 18], [0, 18]], [jack[0], jack[1], jack[2]], shop.metal, "z", { sides: 20 });
  p.soft([14, 12, 27], 2.2, [jack[0], jack[1], jack[2] + 30], "grey");
  p.box([8, 0.3, 12], [jack[0], jack[1] + 6.05, jack[2] + 30], "yellow");
  p.lathe([[4.2, 0], [3.6, 5], [2.4, 14], [0, 14]], [jack[0], jack[1], jack[2] + 43], { rubber: "slate" }, "z", { sides: 12 });
  const world = (v: V3): V3 => [at[0] + v[0] * mm, at[1] + v[1] * mm, at[2] + v[2] * mm];
  const start = world([jack[0], jack[1], jack[2] + 56]), y = SHELF + 0.0021;
  const cx = at[0] - 0.221, cz = at[2] - 0.006;     // the coil's centre, left of the scope
  const lead: V3[] = [
    [start[0], start[1], start[2] - 0.006], start, [start[0] - 0.001, start[1] - 0.004, start[2] + 0.012], [start[0] - 0.004, y + 0.008, start[2] + 0.024],
    [start[0] - 0.014, y, start[2] + 0.031], [start[0] - 0.05, y, start[2] + 0.028], [start[0] - 0.11, y, start[2] + 0.02], [start[0] - 0.17, y, start[2] + 0.024],
    [cx + 0.03, y, cz + 0.058],
    ...coilPoints(cx, cz, 0.042, 2.75, Math.PI / 2, y, 0.0024, 0.006),
    [cx + 0.049, y + 0.007, cz + 0.026], [cx + 0.058, y + 0.006, cz + 0.043], [cx + 0.07, y + 0.0056, cz + 0.047],
  ];
  const cable = new Part(shop, "scope-probe", shop.kit.group("scope-probe", [0, 0, 0]));
  cable.put(null, () => tube(curve(lead, 4), 0.0016, 6), { rubber: "slate" }, [0, 0, 0]);
  // The probe lies along X in front of the scope, tip to the right.
  const probe = shop.part("scope-probe", [cx + 0.07, SHELF + 0.0077, cz + 0.047]);
  probe.lathe([[2.2, 0], [2.6, 5], [3.4, 13], [3.4, 13], [5.0, 14.5], [5.6, 17], [5.6, 60], [5.6, 60], [7.4, 62], [7.6, 63.2], [7.4, 64.4], [5.4, 66.5], [5.2, 72], [3.3, 90]], [0, 0, 0], "grey", "x", { sides: 20 });
  for (let i = 0; i < 5; i++) probe.cyl(5.75, 1.1, [26 + i * 3.2, 0, 0], "slate", "x", { sides: 20 });
  probe.cyl(5.75, 4, [52, 0, 0], "yellow", "x", { sides: 20 });
  probe.lathe([[3.25, 0], [3.25, 22], [2.95, 24.2]], [90, 0, 0], "black", "x", { sides: 16 });
  probe.cyl(0.55, 7, [117.5, 0, 0], shop.metal, "x", { sides: 8 });
  // Its ground lead: a short wire from the probe's collar to a small clip.
  probe.cyl(5.4, 3, [76, 0, 0], "black", "x", { sides: 16 });
  probe.tube([[76, 3, 5], [78, 0.5, 12], [86, -6.3, 20], [100, -6.8, 24], [116, -6.8, 20], [128, -6.8, 21]], 0.9, { rubber: "black" }, { sides: 5, steps: 4 });
  const clip = probe.group([128, -6.8, 21]);
  clip.rotation.y = -0.05;
  probe.soft([20, 5, 6], 2, [9, 1.6, 0], { rubber: "black" }, { parent: clip, seg: 2 });
  for (const side of [-1, 1]) {
    const jaw = probe.put("probe:jaw", () => taperBar(13 * mm, 4.4 * mm, 2 * mm, 0.6 * mm), shop.metal, [18, 1.6 + side * 1.1 - 0.3, 0], clip);
    jaw.rotation.z = side * -0.09;
  }
  return screen;
}

// ------------------------------------------------------------------------------------------- the power supply

function buildSupply(shop: Workshop, at: V3): MeshStandardMaterial {
  const p = shop.part("psu", at);
  const feet = 8, W = 130, H = 152, D = 240, mid = feet + H / 2;
  for (const x of [-48, 48]) for (const z of [-26, -214]) p.cyl(9, 10, [x, 5, z], { rubber: "black" }, "y", { top: 8 });
  // A steel sleeve behind a dark moulded front.
  p.soft([W, H, D - 6], 2.5, [0, mid, -6 - (D - 6) / 2], shop.steel, { seg: 3 });
  p.slab(W + 2, H + 2, 9, 3.5, 1.2, [0, mid, 0], shop.caseDark);
  for (const side of [-1, 1]) {
    for (const z of [-70, -150]) p.slots(9, [0.8, 2.4, 46], [side * (W / 2 - 0.35), mid - 40, z], [0, 9, 0]);
    for (const z of [-30, -200]) p.cyl(2.2, 0.8, [side * (W / 2 + 0.2), mid + 62, z], shop.metal, "x", { sides: 10 });
  }
  for (const x of [-36, 0, 36]) p.slots(11, [28, 0.8, 2.4], [x, feet + H - 0.35, -70], [0, 0, -9]);
  p.sticker(LABEL.asset, 24, 12, [-40, feet + H + 0.02, -32], -0.03);
  p.sticker(LABEL.calibrated, 24, 12, [38, feet + H + 0.02, -30], 0.05);

  const panel = new Panel(p, shop.art("psu_panel", "psu-panel"), 124, 146, [0, mid], 2.5);
  const display = shop.lit("psu_display", "psu-display", 620);
  panel.display(display, 62, 33, [106, 50], [98, 44], "graphite");
  panel.lamp(13, 64.5, shop.led);
  panel.lamp(33, 64.5, "brown");
  for (const [px, R, h, angle] of [[22, 9.5, 15, -0.9], [46, 6.5, 13, 0.6], [78, 9.5, 15, -2.0], [102, 6.5, 13, 1.4]] as const) {
    p.knob(panel.at(px, 86), R, h, "graphite", "white", { angle, flutes: 12 });
  }
  p.rocker(panel.at(17, 122), 13, 20);
  panel.key(42, 121.5, 14, 10, 2);
  // Terminals: negative, earth, positive, with a pair of leads plugged in.
  const posts: [number, Tone][] = [[68, "black"], [87, "green"], [106, "red"]];
  for (const [px, tone] of posts) p.post(panel.at(px, 122), tone);
  const leads = new Part(shop, "psu-leads", shop.kit.group("psu-leads", [0, 0, 0]));
  const y = TABLE + 0.0023;
  for (const [px, tone, sag, end] of [[68, "black", 0, -0.705], [106, "red", 0.012, -0.688]] as const) {
    const [x, py, z] = panel.at(px, 122);
    // A stacking plug: its body on the post's axis, the cable leaving downward.
    p.lathe([[4.7, 0], [4.7, 17], [4.2, 18], [2.4, 18], [2.4, 12], [0, 12]], [x, py, z + 15.4], tone, "z", { sides: 16 });
    p.cyl(3.4, 9, [x, py - 7.5, z + 25], tone, "y", { sides: 12, top: 4.2 });
    const wx = at[0] + x * mm, wy = at[1] + (py - 12) * mm, wz = at[2] + (z + 25) * mm, drift = tone === "red" ? 0.007 : 0.004;
    const path: V3[] = [
      [wx, wy + 0.01, wz], [wx, wy, wz], [wx - drift * 0.5, wy - 0.045, wz + 0.004], [wx - drift * 1.2, TABLE + 0.17, wz + 0.002 + sag * 0.4], [wx + drift * 0.6, TABLE + 0.085, wz - 0.006 + sag * 0.8],
      [wx + drift * 2.2, TABLE + 0.03, wz - 0.022 + sag], [wx + drift * 2.6, y + 0.002, wz - 0.052 + sag], [wx + drift * 1.2, y, wz - 0.1], [wx + drift * 2.1, y, wz - 0.165], [wx + drift * 0.9, y + 0.0028, end + 0.034], [wx + drift * 0.9, y + 0.0028, end + 0.02],
    ];
    leads.put(null, () => tube(curve(path.slice(1), 5), 0.0019, 6), { rubber: tone }, [0, 0, 0]);
    // The free end: a 4 mm plug lying behind the riser's post.
    const plug = new Part(shop, "psu-leads", shop.kit.group(null, [wx + drift * 0.9, y + 0.0028, end + 0.034], leads.root));
    plug.lathe([[2.4, 0], [3.4, 6], [4.6, 8], [4.6, 30], [4.0, 31], [0, 31]], [0, 0, 0], tone, "z", { sides: 14 }).rotation.y = Math.PI;
    plug.lathe([[2.0, 0], [2.0, 16], [1.4, 18], [0, 18]], [0, 0, -31], shop.brass, "z", { sides: 10 }).rotation.y = Math.PI;
  }
  return display;
}

// ------------------------------------------------------------------------------------------- the bench multimeter

function buildMeter(shop: Workshop, at: V3): MeshStandardMaterial {
  const p = shop.part("dmm", at);
  const feet = 7, W = 215, H = 88, D = 258, mid = feet + H / 2;
  for (const x of [-84, 84]) for (const z of [-24, -232]) p.soft([24, 9, 16], 2.5, [x, 4.5, z], { rubber: "black" });
  p.soft([W, H, D], 2.2, [0, mid, -2 - D / 2], shop.steel, { seg: 3 });
  for (const side of [-1, 1]) for (const z of [-90, -150]) p.slots(7, [0.8, 2.2, 40], [side * (W / 2 - 0.35), mid - 24, z], [0, 8, 0]);
  // Rubber bumpers: a frame around the front that stands proud of the panel, a block around the back.
  const bumper: Paint = { rubber: "graphite" };
  for (const side of [-1, 1]) {
    p.soft([W + 16, 8, 30], 3.5, [0, mid + side * (H / 2 + 1.5), -9], bumper, { seg: 3 });
    p.soft([8, H + 11, 30], 3.5, [side * (W / 2 + 1.5), mid, -9], bumper, { seg: 3 });
  }
  p.soft([W + 16, H + 11, 26], 8, [0, mid, -2 - D + 9], bumper, { seg: 3 });
  p.sticker(LABEL.calibrated, 24, 12, [84, feet + H + 0.02, -48], -0.02);

  const panel = new Panel(p, shop.art("dmm_panel", "dmm-panel"), 213, 86, [0, mid], 1.5);
  const display = shop.lit("dmm_display", "dmm-display", 150);
  panel.display(display, 66, 29, [118, 38], [110, 30]);
  panel.key(13, 66, 9.6, 9.6, 1.4, 4.8);
  panel.lamp(13, 56.5, shop.led, 1.1);
  const keys: [number, number][] = [];
  for (const py of [58, 73]) for (const px of [31, 48, 65, 82, 99, 116, 139, 156]) keys.push([px, py]);
  for (const py of [19, 34]) for (const px of [139, 156]) keys.push([px, py]);
  panel.keys(keys, 13.5, 8.5, 1.8);
  // Input and sense terminals, the current fuse and the front/rear switch.
  p.jack(panel.at(180, 24), "red"); p.jack(panel.at(200, 24), "red");
  p.jack(panel.at(180, 48), "black"); p.jack(panel.at(200, 48), "black");
  p.lathe([[5.6, 0], [5.6, 2.6], [5.0, 3.2], [0, 3.2]], panel.at(180, 70), "black", "z", { sides: 16 });
  p.box([7.5, 1.2, 0.4], panel.at(180, 70, 3.3), "slate").rotation.z = 0.5;
  panel.key(200, 70, 8.4, 8.4, 3);
  return display;
}

// ------------------------------------------------------------------------------------------- the generator

function buildGenerator(shop: Workshop, at: V3): void {
  const p = shop.part("awg", at);
  const feet = 7, W = 260, H = 103, D = 280, mid = feet + H / 2;
  for (const x of [-104, 104]) for (const z of [-22, -250]) p.soft([24, 9, 16], 2.5, [x, 4.5, z], { rubber: "black" });
  // A light moulded front on a dark case.
  p.slab(W, H, 26, 8, 1.8, [0, mid, 0], shop.caseLight);
  p.soft([W - 8, H - 7, D - 22], 3, [0, mid, -22 - (D - 22) / 2], shop.caseDark, { seg: 3 });
  for (const side of [-1, 1]) for (const z of [-110, -180]) p.slots(8, [0.8, 2.2, 44], [side * (W / 2 - 4.35), mid - 28, z], [0, 8, 0]);
  for (const x of [-72, 0, 72]) p.slots(9, [50, 0.8, 2.2], [x, mid + (H - 7) / 2 - 0.35, -120], [0, 0, -9]);
  p.sticker(LABEL.calibrated, 24, 12, [-96, mid + (H - 7) / 2 + 0.02, -48], 0.03);
  p.sticker(LABEL.passed, 24, 12, [-66, mid + (H - 7) / 2 + 0.02, -50], -0.06);

  const panel = new Panel(p, shop.art("awg_panel", "awg-panel"), 254, 97, [0, mid], 4);
  panel.display(shop.lit("awg_screen", "awg-screen", 170), 61, 38, [104, 62], [95, 54], shop.caseDark);
  panel.keys([21.4, 37.2, 53.1, 68.9, 84.7, 100.6].map(px => [px, 75.5] as [number, number]), 12, 6.5);
  panel.key(14, 88.5, 9.6, 9.6, 1.4, 4.8);
  panel.lamp(24.5, 83.5, shop.led, 1.0);
  const small: [number, number][] = [[161, 15], [175, 15], [189, 15], [161, 82], [216, 54], [236, 54]];
  for (const py of [15, 28, 41, 56, 69, 82]) for (const px of [126, 141]) small.push([px, py]);
  panel.keys(small, 12.5, 7);
  const pad: [number, number][] = [];
  for (const py of [30, 43, 56, 69]) for (const px of [161, 175, 189]) pad.push([px, py]);
  panel.keys(pad, 11.5, 9.5, 2);
  panel.key(182, 82, 26.5, 7);
  panel.keys([[212, 66.5], [240, 66.5]], 13, 7);
  // The big knob, with a finger dimple.
  const knob = p.knob(panel.at(226, 28), 17, 15, "silver", "graphite", { angle: 0.8, flutes: 16 });
  p.put("awg:dimple", () => new RingGeometry(0, 3.6 * mm, 16), "grey", [6.5, -3.5, 15.08], knob);
  p.bnc(panel.at(212, 83));
  p.bnc(panel.at(240, 83));
}

// ------------------------------------------------------------------------------------------- small things on the riser

function buildSolder(shop: Workshop, at: V3): void {
  const p = shop.part("solder-stand", at);
  // A bent-steel stand: a plate, two uprights, an axle front to back.
  p.soft([62, 2.4, 60], 1, [0, 1.2, 0], "graphite", { seg: 1 });
  for (const z of [-24, 24]) {
    p.soft([16, 46, 2.2], 1, [0, 24, z], "graphite", { seg: 1 });
    p.cyl(4.5, 3, [0, 43, z + Math.sign(z) * 2], shop.metal, "z", { sides: 6 });
  }
  p.cyl(2.5, 58, [0, 43, 0], shop.metal, "z", { sides: 10 });
  // The spool: two flanges, and the wound solder as rings.
  for (const z of [-15, 15]) p.lathe([[9, 0], [29, 0], [29, 0], [29.4, 0.4], [29.4, 1.8], [29, 2.2], [29, 2.2], [9, 2.2]], [0, 43, z - 1.1], "blue", "z", { sides: 28 });
  const rings: [number, number][] = [[23.6, 0]];
  for (let i = 0; i < 16; i++) rings.push([24.4, i * 1.74 + 0.5], [23.6, i * 1.74 + 1.4]);
  rings.push([23.6, 27.8]);
  p.lathe(rings, [0, 43, -13.9], "silver", "z", { sides: 24 });
  p.put("solder:label", () => keycap(54 * mm, 54 * mm, 0.15 * mm, 27 * mm, 0, LABEL.solder, 8), shop.labels, [0, 43, 16.15]);
  // The free end, pulled up and over toward the front.
  p.tube([[-22, 52, 6], [-16, 62, 7], [-2, 72, 9], [12, 74, 14], [22, 66, 24], [26, 52, 34], [25, 40, 40]], 0.45, "silver", { sides: 5, steps: 4 });
}

function buildJumpers(shop: Workshop, at: V3): void {
  const p = shop.part("jumper-box", at, 0.06);
  const W = 122, D = 84, H = 34, card: Paint = { rubber: "kraft" };
  p.box([W, 1.4, D], [0, 0.7, 0], card);
  for (const side of [-1, 1]) {
    p.box([W, H, 1.4], [0, H / 2, side * (D / 2 - 0.7)], card);
    p.box([1.4, H, D], [side * (W / 2 - 0.7), H / 2, 0], card);
  }
  p.sticker(LABEL.jumpers, 60, 30, [0, H / 2, D / 2 + 0.02], 0, true);
  // A loose hank of wires in the box, a few hanging over the front wall.
  const random = rng(505), tones: Tone[] = ["red", "orange", "yellow", "green", "blue", "violet", "grey", "white", "black", "brown"];
  for (let i = 0; i < 30; i++) {
    const tone = tones[(i * 7) % tones.length]!, turn = (random() - 0.5) * 0.9, half = 36 + random() * 12, lift = 2 + (i / 30) * 13 + random() * 2;
    const c = Math.cos(turn), sn = Math.sin(turn), ox = (random() - 0.5) * 16, oz = (random() - 0.5) * 34, bow = (random() - 0.5) * 22;
    // Along the wire `u`, across it `v`: keep the ends inside the box.
    const reach = Math.min(half, (W / 2 - 12) / Math.max(Math.abs(c), 0.3)), spot = (u: number, v: number, dy: number): V3 => {
      const x = ox + u * c - v * sn, z = oz + u * sn + v * c;
      return [Math.max(-W / 2 + 4, Math.min(W / 2 - 4, x)), lift + dy, Math.max(-D / 2 + 4, Math.min(D / 2 - 4, z))];
    };
    p.tube([spot(-reach, 0, 0), spot(-reach * 0.55, bow * 0.5, 1 + random() * 3), spot(0, bow, 2 + random() * 4), spot(reach * 0.55, bow * 0.6, 1 + random() * 3), spot(reach, bow * 0.1, 0)], 0.65, tone, { sides: 5, steps: 3 });
    for (const [u, v] of [[-reach - 5, 0], [reach + 5, bow * 0.1]] as const) {
      const end = spot(u, v, 0);
      p.box([12, 2.5, 2.5], end, "black").rotation.y = -turn + (random() - 0.5) * 0.3;
    }
  }
  for (const [x, tone, reach] of [[-28, "yellow", 24], [-21, "green", 30], [18, "red", 26]] as const) {
    p.tube([[x - 6, 14, -10], [x - 2, 22, 14], [x, H + 2.2, D / 2 - 0.5], [x + 2, H - 6, D / 2 + 5], [x + 3, 6, D / 2 + 9], [x + 6, 0.8, D / 2 + 16], [x + 9, 0.8, D / 2 + reach - 12]], 0.65, tone, { sides: 5, steps: 4 });
    p.box([2.5, 2.5, 12], [x + 10, 1.25, D / 2 + reach - 6], "black").rotation.y = 0.24;
    p.cyl(0.35, 6, [x + 12.2, 1.25, D / 2 + reach + 2.7], shop.brass, "z", { sides: 5 }).rotation.y = 0.24;
  }
}

/** An assortment box with a hinged lid, on top of the multimeter. */
function buildPartsBox(shop: Workshop, at: V3): void {
  const p = shop.part("parts-box", at, -0.07);
  p.soft([132, 21, 92], 3, [0, 10.5, 0], "frost", { seg: 3 });
  p.soft([134, 6, 94], 2, [0, 23, 0], "frost", { seg: 2 });
  for (const x of [-38, 38]) {
    p.soft([16, 12, 3], 1.2, [x, 18, 47.5], "blue");
    p.soft([18, 5, 3], 1, [x, 21, -47.6], "frost");
  }
  // The compartments show through the lid as a faint grid.
  for (let i = 1; i < 6; i++) p.box([0.8, 0.2, 86], [-66 + i * 22, 26.05, 0], "silver");
  for (const z of [-15, 15]) p.box([126, 0.2, 0.8], [0, 26.05, z], "silver");
  p.sticker(LABEL.parts, 64, 32, [-20, 26.1, 10]);
}

// ------------------------------------------------------------------------------------------- the soldering corner

function buildStation(shop: Workshop, at: V3, holderAt: V3): MeshStandardMaterial {
  const p = shop.part("solder-station", at);
  const feet = 3, W = 115, H = 92, D = 126, mid = feet + H / 2;
  for (const x of [-42, 42]) for (const z of [-18, -110]) p.cyl(6, 4, [x, 2, z], { rubber: "black" }, "y", { sides: 14 });
  p.soft([W, H, D - 4], 9, [0, mid, -4 - (D - 4) / 2], "blue", { seg: 4 });
  p.slab(W - 3, H - 3, 8, 7, 1.5, [0, mid, 0], "graphite");
  for (const x of [-30, 30]) p.slots(7, [34, 0.8, 2.2], [x, feet + H - 0.35, -40], [0, 0, -9]);
  p.sticker(LABEL.hot, 24, 12, [0, feet + H + 0.02, -20]);
  const panel = new Panel(p, shop.art("station_panel", "station-panel"), 107, 84, [0, mid], 4);
  const display = shop.lit("station_display", "station-display", 520);
  panel.display(display, 28, 20, [40, 22], [30, 13]);
  panel.lamp(56.6, 21, shop.led, 1.2);
  p.knob(panel.at(80, 28), 12, 14, "graphite", "white", { angle: 0, flutes: 12 });
  p.rocker(panel.at(80, 68), 14, 21);
  // The iron's socket, with its plug: an elbow, so the cable leaves sideways along the bench.
  const socket = panel.at(33, 68);
  p.lathe([[9, 0], [9, 2.6], [8.2, 3.2], [7.2, 3.2], [7.2, 1]], socket, shop.metal, "z", { sides: 20 });
  p.lathe([[6.6, 0], [6.6, 10], [6.0, 11], [0, 11]], [socket[0], socket[1], socket[2] + 1], "black", "z", { sides: 16 });
  p.soft([15, 13, 13], 3.5, [socket[0] + 1.5, socket[1], socket[2] + 12], "black", { seg: 3 });
  p.lathe([[4.2, 0], [3.6, 4], [2.9, 12], [0, 12]], [socket[0] + 8, socket[1], socket[2] + 12], { rubber: "black" }, "x", { sides: 12 });

  // The holder: a heavy base with a cup of brass wool at the front, and a spring that takes the iron.
  const h = shop.part("iron-holder", holderAt);
  for (const x of [-30, 30]) for (const z of [-36, 36]) h.cyl(5, 3, [x, 1.5, z], { rubber: "black" }, "y", { sides: 12 });
  h.soft([80, 15, 92], 4, [0, 9.5, 0], "graphite", { seg: 3 });
  h.lathe([[26, 0], [26, 6], [25, 7], [22.6, 7], [22.6, 1.5], [0, 1.5]], [0, 17, 19], "black", "y", { sides: 28 });
  const wool = h.put("wool:core", () => new SphereGeometry(20.5 * mm, 16, 10), shop.brass, [0, 21, 19]);
  wool.scale.set(1, 0.52, 1);
  const random = rng(909), strands: V3[] = [];
  for (let i = 0; i < 150; i++) {
    const a = random() * Math.PI * 2, b = Math.acos(random() * 0.95), r = 19.5 + random() * 3.5;
    strands.push([Math.cos(a) * Math.sin(b) * r, 21 + Math.cos(b) * r * 0.56, 19 + Math.sin(a) * Math.sin(b) * r]);
  }
  h.tube(strands, 0.3, shop.brass, { sides: 4, steps: 3 });
  // Everything on the iron's axis is built along +Z of a group leaning back from the tip.
  const elevation = (55 * Math.PI) / 180, tip: V3 = [0, 30, -38];
  const lean = h.group(tip);
  lean.rotation.x = -elevation;
  const inLean = { parent: lean };
  h.soft([12, 31, 2.4], 1, [0, 32, -12], "graphite", { seg: 1 });
  h.soft([12, 2.4, 72], 1, [0, -11.8, 43], "graphite", { ...inLean, seg: 1 });
  for (const z of [10, 76]) h.soft([4, 5, 3], 1, [0, -10.4, z], "graphite", { ...inLean, seg: 1 });
  h.cyl(5.2, 12, [0, 0, 2], shop.metal, "z", { ...inLean, sides: 14 });
  const spring: V3[] = [];
  for (let i = 0; i <= 10 * 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    spring.push([Math.cos(a) * 9.8, Math.sin(a) * 9.8, 8 + (i / 120) * 70]);
  }
  h.put("iron:spring", () => tube(spring.map(v => [v[0] * mm, v[1] * mm, v[2] * mm] as V3), 1.0 * mm, 5), shop.metal, [0, 0, 0], lean);
  for (const z of [8, 78]) h.put("iron:ring", () => new TorusGeometry(9.8 * mm, 1.3 * mm, 6, 24), shop.metal, [0, 0, z], lean);
  // The iron: tip, heater, nut, and a handle with a grip.
  h.lathe([[0.5, 0], [2.6, 15], [2.6, 17], [3.7, 17], [3.7, 58]], [0, 0, 0], shop.metal, "z", { ...inLean, sides: 14 });
  h.lathe([[5.6, 0], [5.6, 9], [4.6, 10]], [0, 0, 56], shop.metal, "z", { ...inLean, sides: 8 });
  h.lathe([[5.2, 0], [7.4, 2], [9.8, 10], [10.4, 12], [10.4, 12], [10.4, 16]], [0, 0, 64], "black", "z", { ...inLean, sides: 20 });
  h.lathe([[10.4, 0], [9.2, 6], [8.9, 40], [9.6, 66], [10.6, 76], [10.6, 76], [10.2, 80]], [0, 0, 80], { rubber: "blue" }, "z", { ...inLean, sides: 20 });
  h.lathe([[10.2, 0], [9.0, 8], [6.4, 12], [6.4, 12], [5.6, 14], [3.4, 34], [0, 34]], [0, 0, 160], { rubber: "black" }, "z", { ...inLean, sides: 16 });
  for (let i = 0; i < 5; i++) h.put("iron:rib", () => new TorusGeometry(9.3 * mm, 0.7 * mm, 5, 20), { rubber: "blue" }, [0, 0, 92 + i * 7], lean);

  // The cable: from the plug along the bench, then up to the handle.
  const c = Math.cos(elevation), s = Math.sin(elevation);
  const end: V3 = [holderAt[0], holderAt[1] + (tip[1] + s * 193) * mm, holderAt[2] + (tip[2] + c * 193) * mm];
  const from: V3 = [at[0] + (socket[0] + 20) * mm, at[1] + socket[1] * mm, at[2] + (socket[2] + 12) * mm], y = TABLE + 0.0029;
  const path: V3[] = [
    [from[0] - 0.01, from[1], from[2]], from, [from[0] + 0.012, from[1] - 0.004, from[2] + 0.002], [from[0] + 0.03, y + 0.004, from[2] + 0.006], [from[0] + 0.05, y, from[2] + 0.009],
    [from[0] + 0.085, y, from[2] + 0.008], [end[0] - 0.075, y, end[2] + 0.012], [end[0] - 0.058, y + 0.012, end[2] + 0.018], [end[0] - 0.046, y + 0.07, end[2] + 0.021],
    [end[0] - 0.034, y + 0.15, end[2] + 0.023], [end[0] - 0.017, end[1] + 0.008, end[2] + 0.022], [end[0] - 0.004, end[1] + 0.016, end[2] + 0.014], end, [end[0], end[1] - s * 0.01, end[2] - c * 0.01],
  ];
  const cable = new Part(shop, "iron-cable", shop.kit.group("iron-cable", [0, 0, 0]));
  cable.put(null, () => tube(curve(path, 5).slice(5, -5), 0.0024, 7), { rubber: "black" }, [0, 0, 0]);
  return display;
}

// ------------------------------------------------------------------------------------------- the left corner

function buildHandheld(shop: Workshop, at: V3, yaw: number): void {
  const p = shop.part("handheld-dmm", at, yaw);
  // Built standing (Y to the top of the meter, Z out of its face), then laid on its back.
  const flat = p.group();
  flat.rotation.x = -Math.PI / 2;
  const o = { parent: flat };
  const holster: Paint = { rubber: "orange" };
  p.soft([84, 178, 38], 10, [0, 0, 19], holster, { ...o, seg: 4 });
  for (const y of [-71, 71]) p.soft([89, 38, 41], 11, [0, y, 20.5], holster, { ...o, seg: 4 });
  const inner = new Part(shop, p.id, flat);
  inner.slab(80, 174, 8, 5, 1, [0, 0, 44.2], "graphite");
  const panel = new Panel(inner, shop.art("handheld_face", "handheld-face", 0.4), 78, 172, [0, 0], 4, 44.2);
  panel.keys([[13.5, 54], [30.5, 54], [47.5, 54], [64.5, 54]], 13, 7, 1.8);
  // The selector, turned to DC volts.
  const dial = inner.knob(panel.at(39, 98), 20.5, 8, "graphite", "white", { angle: Math.PI / 3 });
  inner.soft([9, 38, 5], 2.2, [0, 0, 9.5], "graphite", { parent: dial });
  inner.box([1.4, 9, 0.3], [0, 13.5, 12.1], "white", { parent: dial });
  const jacks: [number, Tone][] = [[12, "red"], [30, "red"], [48, "black"], [66, "red"]];
  for (const [px, tone] of jacks) inner.jack(panel.at(px, 152), tone);
}

function buildLeads(shop: Workshop, cx: number, cz: number): void {
  const p = new Part(shop, "dmm-leads", shop.kit.group("dmm-leads", [0, 0, 0]));
  const y = TABLE + 0.0022;
  for (const [tone, R, dy, dz, plugX, plugZ, turn, probeZ] of [["red", 0.041, 0, 0, -0.047, 0.088, 1.25, -0.047], ["black", 0.036, 0.0036, 0.002, -0.024, 0.104, 1.0, -0.031]] as const) {
    const z0 = cz + dz, probe: V3 = [cx + 0.062, TABLE + 0.0064, cz + probeZ];
    // The plug: right-angled, lying on the bench; the cable leaves along its +X.
    const plugAt: V3 = [cx + plugX, y + 0.0032, cz + plugZ], c = Math.cos(turn), s = Math.sin(turn);
    const plug = new Part(shop, p.id, shop.kit.group(null, plugAt, p.root));
    plug.root.rotation.y = turn;
    plug.soft([10, 9.6, 11], 3, [0, 0, 0], tone, { seg: 3 });
    plug.lathe([[3.6, 0], [3.2, 4], [2.4, 10], [0, 10]], [4.5, 0, 0], tone, "x", { sides: 10 });
    plug.lathe([[4.6, 0], [4.6, 14], [4.1, 15], [2.2, 15]], [0, 0, 4], tone, "z", { sides: 14 });
    plug.cyl(2.0, 9, [0, 0, 22.5], shop.brass, "z", { sides: 10 });
    const out = (d: number): V3 => [plugAt[0] + c * d, plugAt[1], plugAt[2] - s * d];
    const path: V3[] = [
      out(0.004), out(0.014), out(0.03), [cx - R - 0.002, y + dy, z0 + 0.03],
      ...coilPoints(cx, z0, R, 2.25, Math.PI, y + dy, 0.0026, 0.0035),
      [cx + 0.03, y + dy + 0.006, z0 - R + 0.001], [probe[0] - 0.012, probe[1], probe[2]], probe, [probe[0] + 0.01, probe[1], probe[2]],
    ];
    p.put(null, () => tube(curve(path, 4).slice(4, -4), 0.0017, 6), { rubber: tone }, [0, 0, 0]);
    // The probe: a grip with a finger guard and a steel tip, pointing right.
    const pen = new Part(shop, p.id, shop.kit.group(null, probe, p.root));
    pen.lathe([[2.2, 0], [3.4, 10], [4.6, 14], [4.6, 80], [4.6, 80], [6.4, 82], [6.4, 84], [4.2, 86], [3.0, 104], [1.6, 106], [0, 106]], [0, 0, 0], tone, "x", { sides: 14 });
    pen.lathe([[1.0, 0], [1.0, 13], [0.3, 17], [0, 17]], [106, 0, 0], shop.metal, "x", { sides: 8 });
  }
  // A twist tie holds the coil.
  const tie = p.put(null, () => new TorusGeometry(5.4 * mm, 0.9 * mm, 5, 14), "white", [(cx + 0.039) / mm, (y + 0.0036) / mm, cz / mm]);
  tie.rotation.y = 0.2;
}

function buildTweezers(shop: Workshop, at: V3, yaw: number): void {
  const p = shop.part("tweezers", at, yaw);
  // Two blades joined at the back; the upper one springs up toward the tips.
  p.put("tweezers:blade", () => taperBar(100 * mm, 9.5 * mm, 2.4 * mm, 1.1 * mm), "black", [0, 0, 0]);
  p.put("tweezers:tip", () => taperBar(20 * mm, 2.4 * mm, 0.5 * mm, 0.9 * mm), shop.metal, [100, 0.1, 0]);
  const upper = p.group([4, 1.3, 0]);
  upper.rotation.z = 0.055;
  p.put("tweezers:blade", () => taperBar(100 * mm, 9.5 * mm, 2.4 * mm, 1.1 * mm), "black", [-4, 0, 0], upper);
  p.put("tweezers:tip", () => taperBar(20 * mm, 2.4 * mm, 0.5 * mm, 0.9 * mm), shop.metal, [96, 0.1, 0], upper);
  p.soft([14, 3.2, 9.5], 1.2, [5, 1.5, 0], "black");
  for (let i = 0; i < 6; i++) p.box([1.2, 0.3, 7.2 - i * 0.5], [28 + i * 3.4, 1.2, 0], "slate", { parent: upper });
}

function buildTape(shop: Workshop, at: V3): void {
  const p = shop.part("kapton", at);
  const kapton = new MeshPhysicalMaterial({ name: "inst_kapton", color: 0xc27a12, roughness: 0.16, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 });
  p.lathe([[14, 0], [27.4, 0], [27.4, 0], [28, 0.6], [28, 11.4], [27.4, 12], [27.4, 12], [14, 12]], [0, 0, 0], kapton, "y", { sides: 32 });
  p.lathe([[14, 0.1], [14, 12.1], [14, 12.1], [12.4, 12.1], [12.4, 12.1], [12.4, 0.1]], [0, 0, 0], { rubber: "cream" }, "y", { sides: 28 });
  // The loose end, lifted a little off the roll.
  const tail = p.box([13, 12, 0.12], [-27.6, 6, 7.5], kapton);
  tail.rotation.y = 0.16;
}

function buildOffcuts(shop: Workshop): void {
  const p = new Part(shop, "wire-offcuts", shop.kit.group("wire-offcuts", [0, TABLE, 0]));
  const random = rng(4411), tones: Tone[] = ["red", "black", "yellow", "blue", "red", "green", "black"];
  const spots: [number, number][] = [[-0.575, -0.318], [-0.553, -0.338], [-0.6, -0.306], [-0.648, -0.402], [-0.54, -0.362], [-0.672, -0.306]];
  spots.forEach(([x, z], i) => {
    const group = shop.kit.group(null, [x, 0, z], p.root);
    group.rotation.y = random() * Math.PI;
    const piece = new Part(shop, p.id, group), half = 8 + random() * 10, bend = (random() - 0.5) * 8;
    piece.tube([[-half, 0.8, 0], [-half * 0.4, 0.8, bend * 0.6], [half * 0.4, 0.8, bend], [half, 0.8, bend * 0.3]], 0.8, tones[i]!, { sides: 5, steps: 3 });
    piece.cyl(0.38, 5, [half + 2.3, 0.8, bend * 0.3], shop.brass, "x", { sides: 5 });
  });
}

// ------------------------------------------------------------------------------------------- everything

export function buildInstruments(scene: Scene): InstrumentHandles {
  const shop = new Workshop(scene);
  // The riser, left to right. Each instrument's place is the middle of its front, on the shelf.
  const scopeScreen = buildScope(shop, [-0.624, SHELF, -0.595]);
  buildSolder(shop, [-0.408, SHELF, -0.565]);
  const psuDisplay = buildSupply(shop, [-0.28, SHELF, -0.5]);
  const dmmDisplay = buildMeter(shop, [-0.055, SHELF, -0.506]);
  buildPartsBox(shop, [-0.07, SHELF + 0.095, -0.64]);
  buildJumpers(shop, [0.152, SHELF, -0.578]);
  buildGenerator(shop, [0.412, SHELF, -0.505]);
  // The bench's back corners.
  const stationDisplay = buildStation(shop, [0.64, TABLE, -0.374], [0.82, TABLE, -0.445]);
  buildHandheld(shop, [-0.855, TABLE, -0.395], 0.1);
  buildLeads(shop, -0.735, -0.428);
  buildTweezers(shop, [-0.705, TABLE, -0.335], 0.22);
  buildTape(shop, [-0.575, TABLE, -0.405]);
  buildOffcuts(shop);
  return { scopeScreen, psuDisplay, dmmDisplay, stationDisplay };
}
