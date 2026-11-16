// What the room's parts are built with: a palette, materials, and the few shapes three.js does not give
// (boxes and plates with rounded edges, tubes along a path). Sizes are metres; a `mm` is a thousandth.
import {
  BoxGeometry, BufferGeometry, Color, CylinderGeometry, DataTexture, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D,
  SphereGeometry, Vector3,
} from "@threert/scene";

export type V3 = [number, number, number];
export const mm = 0.001;

/** sRGB hex to the linear colour materials take. */
export const hex = (value: number) => new Color(value);

export function std(name: string, color: number, roughness = 0.7, metalness = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color: hex(color), roughness, metalness });
}
/** Glossy plastic or painted metal under a clear coat. */
export function coated(name: string, color: number, roughness = 0.45, clearcoat = 0.6): MeshPhysicalMaterial {
  return new MeshPhysicalMaterial({ name, color: hex(color), roughness, clearcoat, clearcoatRoughness: 0.08 });
}
/** A surface that only glows: `nits` of `color`. */
export function glow(name: string, color: number, nits: number): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color: 0x000000, roughness: 1, emissive: hex(color), emissiveIntensity: nits });
}

/** A deterministic random stream (mulberry32): the room is the same on every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise as a texture: faint variation for paint, laminate and rubber, so large surfaces are not one flat colour. */
export function noiseTexture(seed: number, size: number, base: V3, spread: number, cells = 24, streak = 1): DataTexture {
  const random = rng(seed);
  const gw = cells, gh = Math.max(2, Math.round(cells / streak));
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = random();
  const px = new Uint8Array(size * size * 4);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * gw, fy = (y / size) * gh;
      const x0 = Math.floor(fx) % gw, y0 = Math.floor(fy) % gh, x1 = (x0 + 1) % gw, y1 = (y0 + 1) % gh;
      const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
      const a = grid[y0 * gw + x0]! * (1 - tx) + grid[y0 * gw + x1]! * tx, b = grid[y1 * gw + x0]! * (1 - tx) + grid[y1 * gw + x1]! * tx;
      const v = (a * (1 - ty) + b * ty - 0.5) * 2 * spread + (random() - 0.5) * spread * 0.35;
      const o = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) px[o + c] = Math.max(0, Math.min(255, Math.round((base[c]! + v) * 255)));
      px[o + 3] = 255;
    }
  }
  return new DataTexture(size, size, px);
}

// ----------------------------------------------------------------------------------------------- shapes

/** A box whose edges and corners are rounded by `r`: what makes a moulded or machined part read as one. */
export function roundedBox(width: number, height: number, depth: number, r: number, segments = 4): BufferGeometry {
  r = Math.min(r, width / 2 - 1e-6, height / 2 - 1e-6, depth / 2 - 1e-6);
  const n = 2 * (segments + 1);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  const inner: V3 = [width / 2 - r, height / 2 - r, depth / 2 - r];
  // A cube sphere whose octants are pushed out to the box's inner corners.
  const face = (axis: number, sign: number) => {
    const start = positions.length / 3;
    const u = (axis + 1) % 3, v = (axis + 2) % 3;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const half = (k: number) => (k < n / 2 ? -1 : 1);
        const t = (k: number) => {
          const local = k < n / 2 ? k : k - n / 2;      // 0..segments
          const angle = (local / segments) * (Math.PI / 4);
          return k < n / 2 ? -Math.tan(Math.PI / 4 - angle) : Math.tan(angle);
        };
        const p: V3 = [0, 0, 0];
        p[axis] = sign; p[u] = t(i); p[v] = t(j);
        const length = Math.hypot(p[0], p[1], p[2]);
        const d: V3 = [p[0] / length, p[1] / length, p[2] / length];
        const corner: V3 = [0, 0, 0];
        corner[axis] = sign * inner[axis]!; corner[u] = half(i) * inner[u]!; corner[v] = half(j) * inner[v]!;
        positions.push(corner[0] + d[0] * r, corner[1] + d[1] * r, corner[2] + d[2] * r);
        normals.push(d[0], d[1], d[2]);
        const size: V3 = [width, height, depth];
        uvs.push((corner[u]! + d[u]! * r) / size[u]! + 0.5, (corner[v]! + d[v]! * r) / size[v]! + 0.5);
      }
    }
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = start + j * n + i, b = a + 1, c = a + n, e = c + 1;
        if (sign > 0) index.push(a, b, e, a, e, c);
        else index.push(a, e, b, a, c, e);
      }
    }
  };
  for (let axis = 0; axis < 3; axis++) { face(axis, 1); face(axis, -1); }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/** A flat plate in XY with rounded corners (radius `r`), `thickness` along Z, centred; the +Z face carries UVs 0..1. */
export function roundedPlate(width: number, height: number, thickness: number, r: number, segments = 8): BufferGeometry {
  r = Math.min(r, width / 2, height / 2);
  const outline: [number, number][] = [];
  const corners: [number, number, number][] = [[width / 2 - r, height / 2 - r, 0], [-width / 2 + r, height / 2 - r, Math.PI / 2], [-width / 2 + r, -height / 2 + r, Math.PI], [width / 2 - r, -height / 2 + r, 1.5 * Math.PI]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= segments; i++) {
      const a = start + (i / segments) * (Math.PI / 2);
      outline.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  const count = outline.length, z = thickness / 2;
  for (const sign of [1, -1]) {
    const start = positions.length / 3;
    positions.push(0, 0, sign * z); normals.push(0, 0, sign); uvs.push(0.5, 0.5);
    for (const [x, y] of outline) { positions.push(x, y, sign * z); normals.push(0, 0, sign); uvs.push(x / width + 0.5, y / height + 0.5); }
    for (let i = 0; i < count; i++) {
      const a = start + 1 + i, b = start + 1 + ((i + 1) % count);
      if (sign > 0) index.push(start, a, b); else index.push(start, b, a);
    }
  }
  const side = positions.length / 3;
  for (let i = 0; i < count; i++) {
    const [x, y] = outline[i]!, [px, py] = outline[(i + count - 1) % count]!, [nx, ny] = outline[(i + 1) % count]!;
    let tx = nx - px, ty = ny - py;
    const length = Math.hypot(tx, ty) || 1;
    tx /= length; ty /= length;
    for (const sz of [z, -z]) { positions.push(x, y, sz); normals.push(ty, -tx, 0); uvs.push(i / count, sz > 0 ? 1 : 0); }
  }
  for (let i = 0; i < count; i++) {
    const a = side + i * 2, b = side + ((i + 1) % count) * 2;
    index.push(a, a + 1, b + 1, a, b + 1, b);
  }
  return new BufferGeometry().setData(positions, normals, uvs, index);
}

/** Points along a Catmull-Rom curve through `points`. */
export function curve(points: V3[], steps: number): V3[] {
  if (points.length < 2) return points;
  const out: V3[] = [];
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]!;
  for (let s = 0; s < points.length - 1; s++) {
    const p0 = at(s - 1), p1 = at(s), p2 = at(s + 1), p3 = at(s + 2);
    for (let k = 0; k < steps; k++) {
      const t = k / steps, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map(c => 0.5 * (2 * p1[c]! + (-p0[c]! + p2[c]!) * t + (2 * p0[c]! - 5 * p1[c]! + 4 * p2[c]! - p3[c]!) * t2 + (-p0[c]! + 3 * p1[c]! - 3 * p2[c]! + p3[c]!) * t3)) as V3);
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** A round tube of `radius` along a path (a cable, a hose). */
export function tube(path: V3[], radius: number, sides = 8): BufferGeometry {
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [], index: number[] = [];
  let normal = new Vector3(0, 1, 0);
  const points = path.map(p => new Vector3(...p));
  for (let i = 0; i < points.length; i++) {
    const tangent = new Vector3().subVectors(points[Math.min(i + 1, points.length - 1)]!, points[Math.max(i - 1, 0)]!).normalize();
    // Carry the frame along the path: remove the tangent's part from the last normal.
    normal = normal.clone().addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-8) normal = Math.abs(tangent.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
    normal.normalize();
    const binormal = new Vector3().crossVectors(tangent, normal);
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * Math.PI * 2, c = Math.cos(a), d = Math.sin(a);
      const nx = normal.x * c + binormal.x * d, ny = normal.y * c + binormal.y * d, nz = normal.z * c + binormal.z * d;
      positions.push(points[i]!.x + nx * radius, points[i]!.y + ny * radius, points[i]!.z + nz * radius);
      normals.push(nx, ny, nz);
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

// ----------------------------------------------------------------------------------------------- building

const BOXES = new Map<string, BoxGeometry>();
const CYLINDERS = new Map<string, CylinderGeometry>();
const SPHERE = new SphereGeometry(1, 24, 14);

/** Adds parts to a parent, giving every id one object ("drawer", "drawer#2", ...: a pick reads the name before the #). */
export class Kit {
  private readonly used = new Map<string, number>();
  constructor(readonly root: Object3D) {}

  add<T extends Object3D>(object: T, id: string | null, at: V3 = [0, 0, 0], parent: Object3D = this.root): T {
    if (id) {
      const n = (this.used.get(id) ?? 0) + 1;
      this.used.set(id, n);
      object.id = n === 1 ? id : `${id}#${n}`;
    }
    object.position.set(...at);
    parent.add(object);
    return object;
  }
  group(id: string | null, at: V3 = [0, 0, 0], parent: Object3D = this.root): Group {
    return this.add(new Group(), id, at, parent);
  }
  box(id: string | null, size: V3, at: V3, material: MeshStandardMaterial, parent: Object3D = this.root): Mesh {
    const key = size.map(v => v.toFixed(5)).join("x");
    let geometry = BOXES.get(key);
    if (!geometry) BOXES.set(key, geometry = new BoxGeometry(...size));
    return this.add(new Mesh(geometry, material), id, at, parent);
  }
  /** A box with rounded edges. */
  soft(id: string | null, size: V3, r: number, at: V3, material: MeshStandardMaterial, parent: Object3D = this.root, segments = 3): Mesh {
    return this.add(new Mesh(roundedBox(size[0], size[1], size[2], r, segments), material), id, at, parent);
  }
  /** An upright cylinder (axis Y); `top` is its radius at the top when it tapers. */
  drum(id: string | null, radius: number, height: number, at: V3, material: MeshStandardMaterial, parent: Object3D = this.root, top = radius, sides = 28): Mesh {
    const key = `${top.toFixed(5)}:${radius.toFixed(5)}:${height.toFixed(5)}:${sides}`;
    let geometry = CYLINDERS.get(key);
    if (!geometry) CYLINDERS.set(key, geometry = new CylinderGeometry(top, radius, height, sides));
    return this.add(new Mesh(geometry, material), id, at, parent);
  }
  /** A cylinder between two points (a leg, a rod, a hook). */
  rod(id: string | null, from: V3, to: V3, radius: number, material: MeshStandardMaterial, parent: Object3D = this.root, sides = 14): Mesh {
    const a = new Vector3(...from), b = new Vector3(...to);
    const length = a.distanceTo(b);
    const mesh = this.drum(id, radius, length, [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2], material, parent, radius, sides);
    aim(mesh, new Vector3(0, 1, 0), b.sub(a).normalize());
    return mesh;
  }
  ball(id: string | null, radius: number, at: V3, material: MeshStandardMaterial, parent: Object3D = this.root): Mesh {
    const mesh = this.add(new Mesh(SPHERE, material), id, at, parent);
    mesh.scale.set(radius, radius, radius);
    return mesh;
  }
  mesh(id: string | null, geometry: BufferGeometry, at: V3, material: MeshStandardMaterial, parent: Object3D = this.root): Mesh {
    return this.add(new Mesh(geometry, material), id, at, parent);
  }
}

/** Turns `object` so that its local `from` axis points along `to` (both unit vectors). */
export function aim(object: Object3D, from: Vector3, to: Vector3): void {
  const dot = clamp(from.dot(to), -1, 1);
  const axis = new Vector3().crossVectors(from, to);
  if (axis.lengthSq() < 1e-10) {
    // Parallel: nothing to do, or half a turn about any axis across it.
    if (dot > 0) return;
    axis.set(Math.abs(from.x) < 0.9 ? 1 : 0, Math.abs(from.x) < 0.9 ? 0 : 1, 0);
    axis.crossVectors(from, axis.clone());
  }
  object.quaternion.setFromAxisAngle(axis.normalize(), Math.acos(dot));
}

/** Marks an object and everything under it as moved by the frame script (the renderer updates it in place). */
export function movable<T extends Object3D>(object: T): T {
  object.movable = true;
  return object;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Moves `current` toward `target` so that the gap halves every `halfLife` seconds. */
export const approach = (current: number, target: number, dt: number, halfLife: number) => target + (current - target) * Math.pow(0.5, dt / Math.max(halfLife, 1e-4));
export const ease = (t: number) => t * t * (3 - 2 * t);
