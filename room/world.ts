// What happens in the room: the camera, the pointer, carrying Units and props, plugging in, the cables, and what
// the props do to the sensors. The frame script calls `step` every frame; the sidecar's messages arrive through
// `onMessage`; what the room decides goes out through `post` (to the sidecar: `room.*`, `screen.*`; to the app's
// panels: `ui.*`).
import { Group, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, Quaternion, Vector3, Matrix4, type Scene } from "@threert/scene";
import type { BenchParts } from "./bench.ts";
import { UNIT_SPECS } from "./catalog.ts";
import { BENCH, HUB, PADS, ROOM, TAB5, VIEWS } from "./layout.ts";
import { Kit, approach, clamp, coated, curve, ease, lerp, mm, std, tube, type V3 } from "./lib.ts";
import type { Load, Prop, PropKit } from "./props.ts";
import type { CeilingLight } from "./shell.ts";
import { PANEL, PORT_A, SCREEN_PX, type Tab5Parts } from "./tab5.ts";
import { setLamp, type UnitControl, type UnitKit, type UnitModel } from "./units.ts";

export interface Input {
  pointer: { u: number; v: number };
  button(n: number): boolean;
  pressed(key: string): boolean;
  released(key: string): boolean;
  down(key: string): boolean;
  wheel: number;
}
type Post = (message: Record<string, unknown>) => void;

export interface QuestBoard { group: Object3D; center: V3; half: V3 }

export interface RoomParts {
  scene: Scene;
  camera: PerspectiveCamera;
  bench: BenchParts;
  tab5: Tab5Parts;
  kit: UnitKit;
  props: PropKit;
  ceiling: CeilingLight[];
  taskLight?: MeshStandardMaterial;
  quests?: QuestBoard[];
}

interface Pose { at: V3; tip: number }
interface Flight { from: Pose; to: Pose; t: number; duration: number; lift: number; then?: () => void }
interface UnitState {
  model: UnitModel;
  /** "tray", a pad's id, or "hand" while it is carried. */
  where: string;
  pose: Pose;
  flight?: Flight;
  cable?: Mesh;
  /** Asked of the sidecar, not confirmed yet. */
  pending: boolean;
  values: Record<string, unknown>;
  sent: Record<string, string>;
  rise: number;
}
interface PropState { prop: Prop; at: V3; flight?: Flight; pose: Pose; onDeck?: string; sprayUntil: number }

const UP = new Vector3(0, 1, 0);
const AMBIENT = { celsius: 24.6, humidity: 48 };
const TOP = BENCH.top;

export class World {
  private readonly units = new Map<string, UnitState>();
  private readonly propStates: PropState[] = [];
  private aspect = 16 / 10;
  private time = 0;
  // The camera: where it is, where it looks, and where both are going.
  private eye = new Vector3(...VIEWS.bench!.position);
  private look = new Vector3(...VIEWS.bench!.target);
  private fov = VIEWS.bench!.fov;
  private goal: { eye: Vector3; look: Vector3; fov: number } | null = null;
  private view = "bench";
  // The pointer.
  private press: { u: number; v: number; at: number; button: number; target: Target | null; moved: boolean; last: { u: number; v: number } } | null = null;
  private carried: { kind: "unit"; unit: UnitState; grab: Vector3 } | { kind: "prop"; state: PropState; grab: Vector3 } | null = null;
  private control: { unit: UnitState; control: UnitControl; start: { u: number; v: number }; value: number } | null = null;
  private touching = false;
  private lastTouch = "";
  private hover = "";
  private selected = "";
  // The room's lights.
  private lightsOn = true;
  private lightLevel = 1;
  private exposure = 7.7;
  private relays: boolean[] = [false, false, false, false];
  private fanAngle = 0;
  private cableKit: Kit;
  private readonly trunk: Mesh;
  private lastClick = { at: -1, id: "" };
  private simPending: Record<string, unknown> | null = null;
  // The Tab5 in the hand: how far it is leaned from its rest, and how fast that changes.
  private lean = { pitch: 0, roll: 0, wantPitch: 0, wantRoll: 0, vPitch: 0, vRoll: 0, held: false, sent: "", cable: "" };
  private trace: string[] = [];
  private note(text: string): void { this.trace.push(`${this.time.toFixed(2)} ${text}`); if (this.trace.length > 12) this.trace.shift(); }

  constructor(private readonly parts: RoomParts, private readonly post: Post) {
    this.cableKit = new Kit(parts.scene);
    for (const spec of UNIT_SPECS) {
      const model = parts.kit.units[spec.id]!;
      // (The 8Angle's knobs rest at their middle, as the sidecar's model starts them.)
      const values: Record<string, unknown> = spec.id === "angle8" ? { knobs: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], switch: 0 } : {};
      this.units.set(spec.id, { model, where: "tray", pose: { at: [...model.home] as V3, tip: 0 }, pending: false, values, sent: {}, rise: 0 });
    }
    for (const prop of parts.props.props) this.propStates.push({ prop, at: [...prop.home] as V3, pose: { at: [...prop.home] as V3, tip: 0 }, sprayUntil: -1 });
    // The hub's cable to the Tab5's Port A is always there; its plug at the port moves with the device.
    this.trunk = this.cableKit.mesh("cable-trunk", tube(curve(this.trunkPath(), 10), 1.5 * mm, 7), [0, 0, 0], CABLE);
    this.trunk.dynamicGeometry = true;
    const from = parts.kit.hubPorts[0]!;
    this.cableKit.soft("cable-trunk", [7 * mm, 4.6 * mm, 8.6 * mm], 1 * mm, [from[0] + 0.003, from[1], from[2]], PLUG);
    this.cableKit.soft("cable-trunk", [7 * mm, 4.6 * mm, 8.6 * mm], 1 * mm, [PORT_A[0] - 0.0035, PORT_A[1], PORT_A[2]], PLUG, parts.tab5.root);
  }

  // ------------------------------------------------------------------------------------------- geometry

  /** A point of the Tab5's own space, in the room. */
  private tab5Point(local: V3): V3 {
    const root = this.parts.tab5.root;
    root.updateWorldMatrix(true, false);
    const p = new Vector3(...local).applyMatrix4(root.matrixWorld);
    return [p.x, p.y, p.z];
  }

  /** From the hub's first socket up to Port A, wherever the device leans. */
  private trunkPath(): V3[] {
    const port = this.tab5Point(PORT_A), out = this.tab5Point([PORT_A[0] - 0.03, PORT_A[1], PORT_A[2]]);
    const from = this.parts.kit.hubPorts[0]!;
    const floor = TOP + 0.004;
    return [from, [from[0] + 0.03, floor, from[2] + 0.004], [from[0] + 0.075, floor, from[2] + 0.03], [(out[0] + from[0] + 0.075) / 2 - 0.01, (out[1] + floor) / 2 - 0.02, (out[2] + from[2] + 0.03) / 2 + 0.01], out, [port[0] + (out[0] - port[0]) * 0.25, port[1] + (out[1] - port[1]) * 0.25, port[2] + (out[2] - port[2]) * 0.25]];
  }

  /** A Grove cable along a path, with a plug at each end. */
  private cable(id: string, path: V3[], plugs: V3[]): Mesh {
    const mesh = this.cableKit.mesh(id, tube(curve(path, 10), 1.5 * mm, 7), [0, 0, 0], CABLE);
    mesh.dynamicGeometry = true;
    for (const at of plugs) this.cableKit.soft(id, [7 * mm, 4.6 * mm, 8.6 * mm], 1 * mm, at, PLUG, mesh);
    return mesh;
  }

  private ray(u: number, v: number): { origin: Vector3; dir: Vector3 } {
    const camera = this.parts.camera;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const dir = new Vector3((u * 2 - 1) * tan * this.aspect, (1 - v * 2) * tan, -1).applyQuaternion(camera.quaternion).normalize();
    return { origin: camera.position.clone(), dir };
  }
  /** Where a point of the room is in the picture (0..1), or null when it is behind the camera. */
  private project(p: V3): { u: number; v: number } | null {
    const camera = this.parts.camera;
    const local = new Vector3(p[0], p[1], p[2]).sub(camera.position).applyQuaternion(camera.quaternion.clone().invert());
    if (local.z > -0.01) return null;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    return { u: (local.x / (-local.z * tan * this.aspect) + 1) / 2, v: (1 - local.y / (-local.z * tan)) / 2 };
  }

  private unitPose(unit: UnitState, where: string): Pose {
    if (where === "tray") return { at: [...unit.model.home] as V3, tip: 0 };
    const pad = PADS.find(item => item.id === where)!;
    const [, height, depth] = unit.model.size;
    if (unit.model.spec.upright) return { at: [pad.at[0], TOP + depth / 2 + 0.0016, pad.at[2] - height / 2], tip: Math.PI / 2 };
    return { at: [pad.at[0], TOP + 0.0018, pad.at[2]], tip: 0 };
  }
  /** A point of a Unit's own space in the room, for a pose. */
  private unitPoint(pose: Pose, local: V3): V3 {
    const c = Math.cos(pose.tip), s = Math.sin(pose.tip);
    return [pose.at[0] + local[0], pose.at[1] + local[1] * c - local[2] * s, pose.at[2] + local[1] * s + local[2] * c];
  }

  // ------------------------------------------------------------------------------------------- picking

  private pick(u: number, v: number): Target | null {
    const { origin, dir } = this.ray(u, v);
    let best: Target | null = null;
    const consider = (t: number | null, make: () => Omit<Target, "t">) => { if (t !== null && t > 0 && (!best || t < best.t)) best = { ...make(), t }; };
    // The Tab5: its panel, then its body.
    const screen = this.screenHit(origin, dir);
    if (screen) consider(screen.t, () => ({ kind: "screen", id: "tab5-screen", x: screen.x, y: screen.y }));
    consider(rayBox(origin, dir, this.parts.tab5.root, [0, 0, -0.0006], [0.066, 0.042, 0.0058]), () => ({ kind: "tab5", id: "tab5" }));
    for (const unit of this.units.values()) {
      const [length, height, depth] = unit.model.size;
      const extra = unit.model.spec.id === "scales" ? 0.012 : 0;
      const t = rayBox(origin, dir, unit.model.root, [0, height / 2 + 0.004, 0], [length / 2 + 0.004 + extra, height / 2 + 0.008, depth / 2 + 0.004 + extra]);
      consider(t, () => {
        // A control under the pointer, when the Unit is in use.
        let control: UnitControl | undefined;
        if (unit.where.startsWith("pad") && t !== null) {
          const hit = origin.clone().addScaledVector(dir, t);
          let nearest = Infinity;
          for (const candidate of unit.model.controls) {
            const at = this.unitPoint(unit.pose, candidate.at);
            // Distance from the control's centre to the ray: knobs stand proud of the body.
            const d = distanceToRay(origin, dir, new Vector3(...at));
            if (d < candidate.radius && d < nearest) { nearest = d; control = candidate; }
          }
          void hit;
        }
        return { kind: "unit", id: unit.model.spec.id, control };
      });
    }
    for (const state of this.propStates) {
      const p = state.prop;
      consider(rayBox(origin, dir, p.root, [0, p.half[1], 0], [p.half[0] + 0.004, p.half[1] + 0.004, p.half[2] + 0.004]), () => ({ kind: "prop", id: p.id }));
    }
    for (const load of this.parts.props.loads) consider(rayAabb(origin, dir, load.center, load.half), () => ({ kind: "load", id: load.id }));
    const plate = this.parts.props.switchPlate;
    consider(rayAabb(origin, dir, plate.center, plate.half), () => ({ kind: "switch", id: "light-switch" }));
    (this.parts.quests ?? []).forEach((quest, index) => consider(rayAabb(origin, dir, quest.center, quest.half), () => ({ kind: "quest", id: `quest-${index}`, index })));
    consider(rayAabb(origin, dir, [this.parts.kit.tray.position.x, TOP + 0.007, this.parts.kit.tray.position.z], [0.136, 0.007, 0.111]), () => ({ kind: "tray", id: "tray" }));
    return best;
  }

  private screenHit(origin: Vector3, dir: Vector3): { t: number; x: number; y: number } | null {
    const panel = this.parts.tab5.panel;
    panel.updateWorldMatrix(true, false);
    const inverse = new Matrix4().copy(panel.matrixWorld).invert();
    const o = origin.clone().applyMatrix4(inverse), d = dir.clone().transformDirection(inverse);
    if (Math.abs(d.z) < 1e-6 || d.z > 0) return null;
    const t = -o.z / d.z;
    if (t <= 0) return null;
    const x = o.x + d.x * t, y = o.y + d.y * t;
    if (Math.abs(x) > PANEL.width / 2 || Math.abs(y) > PANEL.height / 2) return null;
    const world = new Vector3(x, y, 0).applyMatrix4(panel.matrixWorld);
    return { t: world.distanceTo(origin), x: (x / PANEL.width + 0.5) * SCREEN_PX.width, y: (0.5 - y / PANEL.height) * SCREEN_PX.height };
  }

  /** Where the pointer's ray meets a level plane. */
  private onPlane(u: number, v: number, y: number): Vector3 | null {
    const { origin, dir } = this.ray(u, v);
    if (Math.abs(dir.y) < 1e-5) return null;
    const t = (y - origin.y) / dir.y;
    return t > 0 ? origin.addScaledVector(dir, t) : null;
  }

  // ------------------------------------------------------------------------------------------- messages

  onMessage(message: Record<string, unknown>): void {
    switch (message.t) {
      case "room.view": {
        const width = Number(message.width), height = Number(message.height);
        if (width > 0 && height > 0) this.aspect = width / height;
        break;
      }
      case "state": this.reconcile((message.units as { uid: string; type: string }[] | undefined) ?? []); break;
      case "sim": this.simPending = message; break;
      case "room.refused": {
        const type = String(message.uid ?? "").replace(/-\d+$/, "");
        const unit = this.units.get(type);
        if (unit) { unit.pending = false; this.sendHome(unit, false); }
        this.post({ t: "ui.toast", text: String(message.reason ?? "This Unit cannot be plugged in"), tone: "warn" });
        break;
      }
      case "room.do": this.command(message); break;
    }
  }

  private command(message: Record<string, unknown>): void {
    const type = String(message.unit ?? "");
    switch (message.do) {
      case "view": this.flyTo(String(message.name ?? "bench")); break;
      case "plug": { const unit = this.units.get(type); if (unit && unit.where === "tray") this.plugSomewhere(unit); break; }
      case "unplug": { const unit = this.units.get(type); if (unit && unit.where !== "tray") this.sendHome(unit, true); break; }
      case "lights": this.setLights(message.on === undefined ? !this.lightsOn : !!message.on); break;
      case "select": this.select(type); break;
      case "load": { const load = this.parts.props.loads.find(item => item.id === message.id); if (load) { load.manual = message.on === undefined ? !load.manual : !!message.on; } break; }
      case "reset": for (const state of this.propStates) this.dropProp(state, state.prop.home, true); break;
      case "probe": {
        // Where things are in the picture, for a test that drives the pointer.
        const points: Record<string, [number, number] | null> = {};
        const put = (id: string, at: V3) => { const p = this.project(at); points[id] = p ? [Math.round(p.u * 1000) / 1000, Math.round(p.v * 1000) / 1000] : null; };
        for (const unit of this.units.values()) {
          put(unit.model.spec.id, this.unitPoint(unit.pose, [0, unit.model.size[1] * 0.6, 0]));
          for (const control of unit.model.controls) put(`${unit.model.spec.id}:${control.id}`, this.unitPoint(unit.pose, control.at));
        }
        for (const state of this.propStates) put(`prop:${state.prop.id}`, [state.pose.at[0], state.pose.at[1] + state.prop.half[1], state.pose.at[2]]);
        for (const pad of PADS) put(pad.id, pad.at);
        for (const load of this.parts.props.loads) put(`load:${load.id}`, load.center);
        put("switch", this.parts.props.switchPlate.center);
        put("screen", this.tab5Point(PANEL.at));
        put("screen:tl", this.tab5Point([PANEL.at[0] - PANEL.width / 2, PANEL.height / 2, PANEL.at[2]]));
        put("screen:br", this.tab5Point([PANEL.at[0] + PANEL.width / 2, -PANEL.height / 2, PANEL.at[2]]));
        this.post({ t: "ui.probe", trace: this.trace, points, view: this.view, where: Object.fromEntries([...this.units.values()].map(unit => [unit.model.spec.id, unit.where])) });
        break;
      }
    }
  }

  /** The sidecar's list of plugged Units is the truth: a Unit it has that the room does not goes onto a pad. */
  private reconcile(list: { uid: string; type: string }[]): void {
    const plugged = new Set(list.map(item => item.type));
    for (const unit of this.units.values()) {
      const type = unit.model.spec.id;
      if (plugged.has(type)) {
        unit.pending = false;
        if (unit.where === "tray" && !unit.flight) { const pad = this.freePad(); if (pad) this.place(unit, pad, false); }
      } else if (unit.where.startsWith("pad") && !unit.pending && !unit.flight) {
        // The sidecar lost it (it restarted): say it again.
        unit.pending = true;
        this.post({ t: "room.plug", uid: `${type}-1`, type, inputs: unit.values });
      }
    }
  }

  // ------------------------------------------------------------------------------------------- plugging

  private freePad(): string | null {
    const taken = new Set([...this.units.values()].map(unit => unit.where));
    return PADS.find(pad => !taken.has(pad.id))?.id ?? null;
  }

  private plugSomewhere(unit: UnitState): void {
    const pad = this.freePad();
    if (!pad) { this.post({ t: "ui.toast", text: "三个底座都占用了：先拔下一个模块", tone: "warn" }); return; }
    this.place(unit, pad, true);
  }

  /** Flies a Unit to a pad; when it lands its cable appears and the sidecar hears of it. */
  private place(unit: UnitState, pad: string, tell: boolean): void {
    this.removeCable(unit);
    unit.where = pad;
    unit.pending = tell;
    this.fly(unit, this.unitPose(unit, pad), () => {
      this.wire(unit);
      if (tell) this.post({ t: "room.plug", uid: `${unit.model.spec.id}-1`, type: unit.model.spec.id, inputs: unit.values });
      this.post({ t: "ui.sound", name: "plug" });
    });
    this.select(unit.model.spec.id);
  }

  private sendHome(unit: UnitState, tell: boolean): void {
    const was = unit.where;
    this.removeCable(unit);
    unit.where = "tray";
    if (tell && was.startsWith("pad")) this.post({ t: "room.unplug", uid: `${unit.model.spec.id}-1` });
    // Whatever rested on it stays where it is, on the bench.
    for (const state of this.propStates) if (state.onDeck === unit.model.spec.id) this.dropProp(state, [state.at[0], TOP, state.at[2]], false);
    this.fly(unit, this.unitPose(unit, "tray"));
    if (this.selected === unit.model.spec.id) this.select("");
  }

  private fly(unit: UnitState, to: Pose, then?: () => void): void {
    const distance = Math.hypot(to.at[0] - unit.pose.at[0], to.at[2] - unit.pose.at[2]);
    unit.flight = { from: { at: [...unit.pose.at] as V3, tip: unit.pose.tip }, to, t: 0, duration: clamp(0.25 + distance * 0.9, 0.3, 0.75), lift: clamp(0.03 + distance * 0.12, 0.03, 0.09), then };
  }

  private removeCable(unit: UnitState): void {
    if (unit.cable) { this.parts.scene.remove(unit.cable); unit.cable = undefined; }
  }

  /** The cable from a Unit on its pad to the hub's socket for that pad. */
  private wire(unit: UnitState): void {
    this.removeCable(unit);
    const index = PADS.findIndex(pad => pad.id === unit.where);
    if (index < 0) return;
    const pose = this.unitPose(unit, unit.where);
    const start = this.unitPoint(pose, unit.model.socket);
    const port = this.parts.kit.hubPorts[index + 1]!;
    const floor = TOP + 0.004;
    const path: V3[] = [start, [start[0] - 0.02, Math.max(floor, start[1] - 0.004), start[2] - 0.004]];
    if (index === 0) path.push([start[0] - 0.035, floor, start[2] - 0.06], [port[0] - 0.02, floor, port[2] + 0.07], [port[0], floor + 0.001, port[2] + 0.022]);
    else if (index === 1) path.push([start[0] - 0.04, floor, start[2] - 0.045], [port[0] + 0.03, floor, port[2] + 0.085], [port[0], floor + 0.001, port[2] + 0.022]);
    else path.push([start[0] - 0.05, floor, start[2] - 0.05], [0.0, floor, PADS[1]!.at[2] - 0.058], [port[0] + 0.07, floor, port[2] + 0.07], [port[0], floor + 0.001, port[2] + 0.022]);
    path.push(port);
    unit.cable = this.cable(`cable-${unit.model.spec.id}`, path, [[start[0] - 0.004, start[1], start[2]], port]);
  }

  // ------------------------------------------------------------------------------------------- selection, camera

  private select(id: string): void {
    if (this.selected === id) return;
    this.selected = id;
    const unit = this.units.get(id);
    this.post({ t: "ui.select", unit: id || null, plugged: !!unit && unit.where.startsWith("pad") });
  }

  flyTo(name: string): void {
    const view = VIEWS[name];
    if (!view) return;
    this.view = name;
    this.goal = { eye: new Vector3(...view.position), look: new Vector3(...view.target), fov: view.fov };
    this.post({ t: "ui.view", name });
  }

  private setLights(on: boolean): void {
    this.lightsOn = on;
    this.post({ t: "ui.lights", on });
    this.post({ t: "ui.sound", name: "switch" });
  }

  // ------------------------------------------------------------------------------------------- the frame

  step(dt: number, input: Input): void {
    this.time += dt;
    const { u, v } = input.pointer;
    const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
    const target = inside && !this.carried && !this.control ? this.pick(u, v) : null;

    // --- keys
    ["room", "bench", "work", "screen", "parts", "wall"].forEach((name, index) => { if (input.pressed(String(index + 1))) this.flyTo(name); });
    if (input.pressed("Escape")) { this.select(""); this.flyTo("bench"); }
    if (input.pressed("L")) this.setLights(!this.lightsOn);

    // --- the pointer goes down
    for (const button of [0, 2, 1]) {
      if (input.pressed(`Mouse${button}`) && !this.press) {
        this.press = { u, v, at: this.time, button, target: button === 0 ? target : null, moved: false, last: { u, v } };
        this.note(`press ${button} on ${target ? target.kind + ":" + target.id : "nothing"}`);
        if (button === 0 && target) this.begin(target, u, v);
      }
    }
    // --- it moves
    if (this.press) {
      const press = this.press;
      const du = u - press.last.u, dv = v - press.last.v;
      if (Math.hypot(u - press.u, (v - press.v) / this.aspect) > 0.006) press.moved = true;
      if (this.touching) this.touch(u, v);
      else if (this.control) this.turn(u, v);
      else if (this.carried) this.carry(u, v);
      else if (press.moved && press.button === 0 && press.target?.kind === "tab5") {
        // The device in the hand: it leans with the pointer.
        this.lean.held = true;
        this.lean.wantRoll = clamp(-(u - press.u) * 3.2, -1.0, 1.0);
        this.lean.wantPitch = clamp((v - press.v) * 2.6, -0.7, 0.9);
      } else if (press.moved && (press.button !== 0 || !press.target || press.target.kind === "tray" || press.target.kind === "load" || press.target.kind === "quest")) {
        if (press.button === 1 || input.down("Shift")) this.pan(du, dv);
        else this.orbit(du, dv);
      } else if (press.moved && press.button === 0 && press.target && !this.carried) {
        // A press that started on something and moved picks it up.
        this.grab(press.target, u, v);
      }
      press.last = { u, v };
      if (input.released(`Mouse${press.button}`) || !input.button(press.button)) {
        this.note(`release moved=${press.moved} held=${input.button(press.button)} carried=${this.carried?.kind ?? "-"}`);
        this.end(u, v);
        this.press = null;
      }
    }
    if (input.wheel && inside) this.dolly(input.wheel, u, v);

    // --- what is under the pointer
    const hoverId = this.carried ? "" : target ? (target.kind === "unit" && target.control ? `${target.id}:${target.control.id}` : target.id) : "";
    if (hoverId !== this.hover) {
      this.hover = hoverId;
      this.post({ t: "ui.hover", ...(target && !this.carried ? this.describe(target) : { id: null }) });
    }

    this.moveThings(dt);
    this.leanTab5(dt);
    this.sense();
    this.applySim();
    this.light(dt);
    this.moveCamera(dt);
  }

  private describe(target: Target): Record<string, unknown> {
    switch (target.kind) {
      case "unit": {
        const unit = this.units.get(target.id)!;
        const spec = unit.model.spec;
        const plugged = unit.where.startsWith("pad");
        const control = target.control ? { knob: "拖动旋转", switch: "点一下拨动", stick: "按住拖动 · 点一下按键", button: "点一下", dial: "拖动旋转 · 点一下按下" }[target.control.kind] : undefined;
        return { id: target.id, kind: "unit", title: `${spec.zh} ${spec.name}`, subtitle: control ?? (plugged ? `已接入 Port A · I2C ${spec.addresses}` : `${spec.blurb} · 点一下接到 Tab5`) };
      }
      case "prop": { const p = this.propStates.find(state => state.prop.id === target.id)!.prop; return { id: target.id, kind: "prop", title: p.title, subtitle: p.hint }; }
      case "load": { const load = this.parts.props.loads.find(item => item.id === target.id)!; return { id: target.id, kind: "load", title: load.title, subtitle: "点一下手动开关" }; }
      case "screen": return { id: target.id, kind: "screen", title: "Tab5 屏幕", subtitle: this.view === "screen" ? "点按就是触摸" : "点一下靠近" };
      case "tab5": return { id: target.id, kind: "tab5", title: "M5Stack Tab5", subtitle: "ESP32-P4 · 5 英寸 · 拖动机身可以倾斜它（内置 IMU 会感觉到）" };
      case "switch": return { id: target.id, kind: "switch", title: "房间灯", subtitle: this.lightsOn ? "点一下关灯" : "点一下开灯" };
      case "quest": return { id: target.id, kind: "quest", title: "任务卡", subtitle: "点一下查看任务" };
      case "tray": return { id: target.id, kind: "tray", title: "模块盒", subtitle: "十个 Unit，都接 Port A" };
    }
    return { id: null };
  }

  // --- press on something

  private begin(target: Target, u: number, v: number): void {
    if (target.kind === "screen" && this.screenIsNear()) {
      this.touching = true;
      this.touch(u, v);
    } else if (target.kind === "unit" && target.control) {
      const unit = this.units.get(target.id)!;
      const control = target.control;
      const current = control.kind === "knob" ? Number((unit.values.knobs as number[] | undefined)?.[Number(control.id.slice(4))] ?? 0) : control.kind === "dial" ? Number(unit.values.steps ?? 0) : 0;
      this.control = { unit, control, start: { u, v }, value: current };
    }
  }

  private screenIsNear(): boolean {
    const left = this.project(this.tab5Point([-PANEL.width / 2 + PANEL.at[0], 0, PANEL.at[2]])), right = this.project(this.tab5Point([PANEL.width / 2 + PANEL.at[0], 0, PANEL.at[2]]));
    return !!left && !!right && Math.abs(right.u - left.u) > 0.3;
  }

  private touch(u: number, v: number): void {
    const { origin, dir } = this.ray(u, v);
    const hit = this.screenHit(origin, dir);
    if (!hit) return;
    const key = `${Math.round(hit.x)},${Math.round(hit.y)}`;
    if (key === this.lastTouch) return;
    this.lastTouch = key;
    this.post({ t: "screen.touch", x: Math.round(hit.x), y: Math.round(hit.y) });
  }

  private grab(target: Target, u: number, v: number): void {
    this.note(`grab ${target.kind}:${target.id}`);
    if (target.kind === "unit") {
      const unit = this.units.get(target.id)!;
      if (unit.flight) return;
      const was = unit.where;
      this.removeCable(unit);
      if (was.startsWith("pad")) { this.post({ t: "room.unplug", uid: `${target.id}-1` }); for (const state of this.propStates) if (state.onDeck === target.id) this.dropProp(state, [state.at[0], TOP, state.at[2]], false); }
      unit.where = "hand";
      const plane = this.onPlane(u, v, TOP) ?? new Vector3(...unit.pose.at);
      // (Held near where it was taken, but never far from the pointer: a tall Unit is not dragged by its shadow.)
      this.carried = { kind: "unit", unit, grab: new Vector3(clamp(unit.pose.at[0] - plane.x, -0.03, 0.03), 0, clamp(unit.pose.at[2] - plane.z, -0.03, 0.03)) };
      this.select(target.id);
      this.post({ t: "ui.sound", name: "lift" });
    } else if (target.kind === "prop") {
      const state = this.propStates.find(item => item.prop.id === target.id)!;
      state.flight = undefined;
      state.onDeck = undefined;
      const plane = this.onPlane(u, v, TOP) ?? new Vector3(...state.pose.at);
      this.carried = { kind: "prop", state, grab: new Vector3(clamp(state.pose.at[0] - plane.x, -0.03, 0.03), 0, clamp(state.pose.at[2] - plane.z, -0.03, 0.03)) };
    }
  }

  /** What is carried hangs above the point of the bench the pointer is over. */
  private carry(u: number, v: number): void {
    const carried = this.carried!;
    const p = this.onPlane(u, v, TOP);
    if (!p) return;
    const at: V3 = [clamp(p.x + carried.grab.x, BENCH.left + 0.03, BENCH.right - 0.03), TOP + 0.045, clamp(p.z + carried.grab.z, BENCH.back + 0.34, BENCH.front - 0.02)];
    if (carried.kind === "unit") { carried.unit.pose.at = at; carried.unit.pose.tip = 0; }
    else carried.state.pose.at = at;
  }

  /** The free pad nearest a point, within reach. */
  private padNear(x: number, z: number): string | null {
    const taken = new Set([...this.units.values()].map(unit => unit.where));
    let best: string | null = null, nearest = 0.11;
    for (const pad of PADS) {
      if (taken.has(pad.id)) continue;
      const d = Math.hypot(pad.at[0] - x, pad.at[2] - z);
      if (d < nearest) { nearest = d; best = pad.id; }
    }
    return best;
  }

  private turn(u: number, v: number): void {
    const { unit, control, start, value } = this.control!;
    const dx = u - start.u, dy = (v - start.v) / this.aspect;
    switch (control.kind) {
      case "knob": {
        const index = Number(control.id.slice(4));
        const knobs = [...((unit.values.knobs as number[] | undefined) ?? [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])];
        knobs[index] = clamp(value + (dx - dy) * 2.6, 0, 1);
        unit.values.knobs = knobs;
        break;
      }
      case "dial": unit.values.steps = Math.round(value + (dx - dy) * 60); break;
      case "stick": { unit.values.x = clamp(dx * 9, -1, 1); unit.values.y = clamp(-dy * 9, -1, 1); break; }
    }
  }

  private end(u: number, v: number): void {
    const press = this.press!;
    if (this.lean.held) { this.lean.held = false; this.lean.wantPitch = 0; this.lean.wantRoll = 0; return; }
    const quick = !press.moved && this.time - press.at < 0.45;
    if (this.touching) {
      this.touching = false;
      this.lastTouch = "";
      this.post({ t: "screen.touch", up: true });
    } else if (this.control) {
      const { unit, control } = this.control;
      if (control.kind === "stick") { unit.values.x = 0; unit.values.y = 0; }
      if (quick) {
        if (control.kind === "switch") unit.values.switch = unit.values.switch ? 0 : 1;
        else if (control.kind !== "knob") { unit.values.button = 1; unit.values.buttonUntil = this.time + 0.18; }
        this.post({ t: "ui.sound", name: "tick" });
      }
      this.control = null;
    } else if (this.carried) {
      const carried = this.carried;
      this.carried = null;
      if (carried.kind === "unit") {
        const unit = carried.unit;
        const pad = this.padNear(unit.pose.at[0], unit.pose.at[2]);
        if (pad) this.place(unit, pad, true);
        else { unit.where = "hand"; this.sendHome(unit, false); }
      } else {
        this.dropProp(carried.state, [carried.state.pose.at[0], TOP, carried.state.pose.at[2]], false);
      }
    } else if (quick && press.button === 0 && press.target) {
      this.click(press.target, u, v);
    }
  }

  private click(target: Target, u: number, v: number): void {
    const double = this.lastClick.id === target.id && this.time - this.lastClick.at < 0.4;
    this.lastClick = { at: this.time, id: target.id };
    switch (target.kind) {
      case "unit": {
        const unit = this.units.get(target.id)!;
        if (unit.flight) break;
        if (unit.where === "tray") this.plugSomewhere(unit);
        else if (double) this.sendHome(unit, true);
        else this.select(target.id);
        break;
      }
      case "prop": {
        const state = this.propStates.find(item => item.prop.id === target.id)!;
        const p = state.prop;
        if (p.id === "mister") { state.sprayUntil = this.time + 2.5; this.post({ t: "ui.sound", name: "spray" }); }
        else if (p.toggles) { p.on = !p.on; this.post({ t: "ui.sound", name: "switch" }); }
        break;
      }
      case "load": { const load = this.parts.props.loads.find(item => item.id === target.id)!; load.manual = !load.manual; this.post({ t: "ui.sound", name: "switch" }); break; }
      case "switch": this.setLights(!this.lightsOn); break;
      case "screen": case "tab5": this.flyTo("screen"); break;
      case "quest": this.post({ t: "ui.quest", index: target.index }); break;
      case "tray": this.flyTo(this.view === "parts" ? "bench" : "parts"); break;
    }
    void u; void v;
  }

  /** Lets a prop down: onto a reader or a pan under it, or onto the bench. */
  private dropProp(state: PropState, at: V3, home: boolean): void {
    state.onDeck = undefined;
    let to: V3 = [at[0], TOP, at[2]];
    if (!home) {
      for (const unit of this.units.values()) {
        const deck = unit.model.deck;
        if (!deck || !unit.where.startsWith("pad")) continue;
        const centre = this.unitPoint(unit.pose, deck.at);
        if (Math.hypot(centre[0] - at[0], centre[2] - at[2]) > deck.radius + 0.02) continue;
        if (unit.model.spec.id === "rfid2" && !state.prop.card) continue;
        const stacked = this.propStates.filter(other => other !== state && other.onDeck === unit.model.spec.id).length;
        to = [centre[0] + (stacked ? (stacked % 2 ? 0.012 : -0.012) : 0), centre[1] + stacked * 0.003, centre[2] + (stacked > 1 ? 0.01 : 0)];
        state.onDeck = unit.model.spec.id;
        break;
      }
    }
    state.at = to;
    const distance = Math.hypot(to[0] - state.pose.at[0], to[2] - state.pose.at[2]);
    state.flight = { from: { at: [...state.pose.at] as V3, tip: 0 }, to: { at: to, tip: 0 }, t: 0, duration: clamp(0.12 + distance * 0.8, 0.14, 0.6), lift: home ? 0.05 : 0 };
    if (state.onDeck) this.post({ t: "ui.sound", name: "tap" });
  }

  // --- the camera

  private orbit(du: number, dv: number): void {
    this.goal = null;
    this.freeView();
    const offset = this.eye.clone().sub(this.look);
    const radius = offset.length();
    let yaw = Math.atan2(offset.x, offset.z), pitch = Math.asin(clamp(offset.y / radius, -1, 1));
    yaw -= du * 3.2;
    pitch = clamp(pitch + dv * 2.2, 0.06, 1.35);
    yaw = clamp(yaw, -1.25, 1.25);
    this.eye.set(this.look.x + Math.sin(yaw) * Math.cos(pitch) * radius, this.look.y + Math.sin(pitch) * radius, this.look.z + Math.cos(yaw) * Math.cos(pitch) * radius);
    this.keepInside();
  }
  private pan(du: number, dv: number): void {
    this.goal = null;
    this.freeView();
    const camera = this.parts.camera;
    const distance = this.eye.distanceTo(this.look);
    const right = new Vector3(1, 0, 0).applyQuaternion(camera.quaternion), up = new Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const k = distance * Math.tan((this.fov * Math.PI) / 360) * 2;
    const move = right.multiplyScalar(-du * k * this.aspect).addScaledVector(up, dv * k);
    this.eye.add(move); this.look.add(move);
    this.keepInside();
  }
  private dolly(notches: number, u: number, v: number): void {
    this.goal = null;
    this.freeView();
    const offset = this.eye.clone().sub(this.look);
    const distance = offset.length();
    const next = clamp(distance * Math.exp(-notches * 0.12), 0.16, 4.2);
    // Zoom toward what the pointer is over.
    const under = this.onPlane(u, v, this.look.y);
    if (under && notches > 0 && under.distanceTo(this.look) < 1.5) this.look.lerp(under, 0.12);
    this.eye.copy(this.look).addScaledVector(offset.normalize(), next);
    this.keepInside();
  }
  /** The user moved the camera off a named view. */
  private freeView(): void {
    if (this.view === "free") return;
    this.view = "free";
    this.post({ t: "ui.view", name: "free" });
  }
  private keepInside(): void {
    this.eye.x = clamp(this.eye.x, ROOM.left + 0.25, ROOM.right - 0.25);
    this.eye.y = clamp(this.eye.y, 0.3, ROOM.height - 0.25);
    this.eye.z = clamp(this.eye.z, ROOM.back + 0.25, ROOM.front - 0.2);
    this.look.x = clamp(this.look.x, ROOM.left + 0.2, ROOM.right - 0.2);
    this.look.y = clamp(this.look.y, 0.2, ROOM.height - 0.3);
    this.look.z = clamp(this.look.z, ROOM.back, ROOM.front - 0.5);
  }

  private moveCamera(dt: number): void {
    if (this.goal) {
      const half = 0.11;
      this.eye.set(approach(this.eye.x, this.goal.eye.x, dt, half), approach(this.eye.y, this.goal.eye.y, dt, half), approach(this.eye.z, this.goal.eye.z, dt, half));
      this.look.set(approach(this.look.x, this.goal.look.x, dt, half), approach(this.look.y, this.goal.look.y, dt, half), approach(this.look.z, this.goal.look.z, dt, half));
      this.fov = approach(this.fov, this.goal.fov, dt, half);
      if (this.eye.distanceTo(this.goal.eye) < 0.002 && this.look.distanceTo(this.goal.look) < 0.002) this.goal = null;
    }
    const camera = this.parts.camera;
    camera.position.copy(this.eye);
    camera.fov = this.fov;
    camera.quaternion.setFromRotationMatrix(new Matrix4().lookAt(this.eye, this.look, UP));
  }

  /** The Tab5 follows the hand, springs back when let go, and its motion sensor feels both. */
  private leanTab5(dt: number): void {
    const lean = this.lean;
    const step = (value: number, want: number, velocity: number): [number, number] => {
      // A spring: stiff in the hand, a little bouncy on the way back.
      const k = lean.held ? 260 : 120, damping = lean.held ? 30 : 9;
      const next = velocity + (k * (want - value) - damping * velocity) * dt;
      return [value + next * dt, next];
    };
    const beforePitch = lean.pitch, beforeRoll = lean.roll;
    [lean.pitch, lean.vPitch] = step(lean.pitch, lean.wantPitch, lean.vPitch);
    [lean.roll, lean.vRoll] = step(lean.roll, lean.wantRoll, lean.vRoll);
    if (!lean.held && Math.abs(lean.pitch) < 1e-4 && Math.abs(lean.roll) < 1e-4 && Math.abs(lean.vPitch) < 1e-3 && Math.abs(lean.vRoll) < 1e-3) { lean.pitch = 0; lean.roll = 0; lean.vPitch = 0; lean.vRoll = 0; }
    this.parts.tab5.pose(lean.pitch, lean.roll);
    const key = `${lean.pitch.toFixed(3)},${lean.roll.toFixed(3)}`;
    if (key !== lean.cable) { lean.cable = key; this.trunk.geometry = tube(curve(this.trunkPath(), 10), 1.5 * mm, 7); }
    // Gravity in the device's axes (x to the camera side, y to its top edge, z out of the screen), in g.
    const a = -TAB5.tilt + lean.pitch, r = lean.roll;
    const accel = [Math.cos(a) * Math.sin(r), Math.cos(a) * Math.cos(r), -Math.sin(a)].map(v => Math.round(v * 1000) / 1000);
    const gyro = [(lean.pitch - beforePitch) / Math.max(dt, 1e-3), 0, (lean.roll - beforeRoll) / Math.max(dt, 1e-3)].map(v => Math.round((v * 180) / Math.PI));
    const text = JSON.stringify([accel, gyro]);
    if (text !== lean.sent) {
      lean.sent = text;
      this.post({ t: "room.set", uid: "tab5", key: "accel", value: accel });
      this.post({ t: "room.set", uid: "tab5", key: "gyro", value: gyro });
    }
  }

  // --- things in flight, things turning

  private moveThings(dt: number): void {
    const carrying = this.carried?.kind === "unit" ? this.carried.unit : null;
    const near = carrying ? this.padNear(carrying.pose.at[0], carrying.pose.at[2]) : null;
    const taken = new Set([...this.units.values()].map(unit => unit.where));
    for (const pad of PADS) {
      const material = this.parts.bench.pads[pad.id]!.material;
      const want = carrying ? (pad.id === near ? 260 : taken.has(pad.id) ? 0 : 60 + 30 * Math.sin(this.time * 5)) : 0;
      material.emissiveIntensity = approach(material.emissiveIntensity, want, dt, 0.06);
    }
    for (const unit of this.units.values()) {
      if (unit.flight) advance(unit.flight, unit.pose, dt, () => { unit.flight = undefined; });
      const root = unit.model.root;
      // A Unit in the tray rises a little under the pointer.
      const resting = unit.where === "tray" && !unit.flight;
      unit.rise = approach(unit.rise, resting && this.hover === unit.model.spec.id ? 0.006 : 0, dt, 0.035);
      root.position.set(unit.pose.at[0], unit.pose.at[1] + unit.rise, unit.pose.at[2]);
      root.rotation.set(unit.pose.tip, 0, 0);
      // Its controls follow its values.
      const values = unit.values;
      if (values.buttonUntil !== undefined && this.time > Number(values.buttonUntil)) { values.button = 0; values.buttonUntil = undefined; }
      for (const control of unit.model.controls) {
        const object = control.object;
        if (control.kind === "knob") object.rotation.y = -(Number((values.knobs as number[] | undefined)?.[Number(control.id.slice(4))] ?? 0) - 0.5) * 4.7;
        else if (control.kind === "dial") { object.rotation.y = -Number(values.steps ?? 0) * (Math.PI / 12); object.position.y = unit.model.controls[0] === control && values.button ? -0.0012 : 0; }
        else if (control.kind === "stick") object.rotation.set(-Number(values.y ?? 0) * 0.42, 0, -Number(values.x ?? 0) * 0.42);
        else if (control.kind === "switch") object.position.x = 56.5 * mm + (values.switch ? 1.6 : -1.6) * mm;
      }
      this.tell(unit);
    }
    for (const state of this.propStates) {
      if (state.flight) advance(state.flight, state.pose, dt, () => { state.flight = undefined; });
      state.prop.root.position.set(...state.pose.at);
      if (state.prop.indicator) state.prop.indicator.emissiveIntensity = approach(state.prop.indicator.emissiveIntensity, state.prop.on ? 4200 : 0, dt, 0.25);
    }
  }

  /** Sends a Unit's changed values to the sidecar. */
  private tell(unit: UnitState): void {
    if (!unit.where.startsWith("pad") || unit.flight) return;
    for (const [key, value] of Object.entries(unit.values)) {
      if (key === "buttonUntil" || value === undefined) continue;
      const text = JSON.stringify(typeof value === "number" ? Math.round(value * 1000) / 1000 : value);
      if (unit.sent[key] === text) continue;
      unit.sent[key] = text;
      this.post({ t: "room.set", uid: `${unit.model.spec.id}-1`, key, value: JSON.parse(text) });
    }
  }

  // --- what the props do to the sensors

  private sense(): void {
    const loads = this.parts.props.loads;
    const lamp = loads.find(load => load.id === "lamp")!;
    const dryer = this.propStates.find(state => state.prop.id === "dryer")!;
    const mister = this.propStates.find(state => state.prop.id === "mister")!;
    for (const unit of this.units.values()) {
      if (!unit.where.startsWith("pad") || unit.flight) continue;
      const centre = this.unitPoint(unit.pose, [0, unit.model.size[1] / 2, 0]);
      const distanceTo = (state: PropState) => Math.hypot(state.pose.at[0] - centre[0], state.pose.at[2] - centre[2]);
      switch (unit.model.spec.id) {
        case "env3": {
          const heat = dryer.prop.on ? clamp(1 - (distanceTo(dryer) - 0.06) / 0.3, 0, 1) : 0;
          const mist = this.time < mister.sprayUntil ? clamp(1 - (distanceTo(mister) - 0.05) / 0.35, 0, 1) : 0;
          unit.values.celsius = AMBIENT.celsius + heat * 27;
          unit.values.humidity = clamp(AMBIENT.humidity - heat * 22 + mist * 38, 8, 96);
          break;
        }
        case "sonic": case "ncir": {
          // It looks along +Z from its face: the nearest thing in front of it.
          const face = this.unitPoint(unit.pose, [unit.model.spec.id === "sonic" ? 6 * mm : unit.model.size[0] / 2 - 8 * mm, unit.model.size[1], 0]);
          const origin = new Vector3(...face), dir = new Vector3(0, 0, 1);
          let nearest = ROOM.front - face[2], celsius = AMBIENT.celsius;
          for (const state of this.propStates) {
            if (this.carried?.kind === "prop" && this.carried.state === state) continue;
            const p = state.prop;
            const t = rayBox(origin, dir, p.root, [0, p.half[1], 0], [p.half[0] + 0.012, p.half[1] + 0.02, p.half[2]]);
            if (t !== null && t < nearest) { nearest = t; celsius = p.id === "dryer" && p.on ? 86 : p.celsius; }
          }
          if (unit.model.spec.id === "sonic") unit.values.millimetres = Math.round(nearest * 1000);
          else { unit.values.objectCelsius = celsius; unit.values.ambientCelsius = AMBIENT.celsius + 1.2; }
          break;
        }
        case "dlight": {
          // The room's panels are most of it; the task strip leaves a glow when they are off, and the desk lamp
          // (aimed at the other end of the bench) adds a little.
          unit.values.lux = Math.round(12 + this.lightLevel * 570 + (lamp.on ? 22 : 0));
          break;
        }
        case "rfid2": {
          const card = this.propStates.find(state => state.onDeck === "rfid2" && !state.flight && state.prop.card);
          unit.values.card = card ? { uid: card.prop.card!.uid, kind: card.prop.card!.kind } : null;
          break;
        }
        case "scales": {
          let grams = 0;
          for (const state of this.propStates) if (state.onDeck === "scales" && !state.flight) grams += state.prop.grams;
          unit.values.grams = grams;
          break;
        }
      }
    }
  }

  // --- what the Units do to the room

  private applySim(): void {
    const sim = this.simPending;
    if (!sim) return;
    this.simPending = null;
    const states = (sim.units as Record<string, Record<string, unknown>> | undefined) ?? {};
    let relays: boolean[] = [false, false, false, false];
    for (const unit of this.units.values()) {
      const state = states[`${unit.model.spec.id}-1`];
      const lamps = unit.model.lamps;
      const plugged = unit.where.startsWith("pad") && !!state;
      switch (unit.model.spec.id) {
        // (The 8Angle's firmware dims its lamps to a tenth: its state tops out at 25.)
        case "angle8": for (let i = 0; i < 9; i++) setLamp(lamps[`led${i}`]!, plugged ? (state!.leds as number[][] | undefined)?.[i]?.map(c => Math.min(255, c * 10)) : undefined); break;
        case "encoder": for (let i = 0; i < 2; i++) setLamp(lamps[`led${i}`]!, plugged ? (state!.leds as number[][] | undefined)?.[i] : undefined); break;
        case "joystick2": case "scales": setLamp(lamps.led!, plugged ? (state!.led as number[] | undefined) : undefined); break;
        case "relay4": {
          const on = plugged ? ((state!.relays as boolean[] | undefined) ?? []) : [];
          const leds = plugged ? ((state!.leds as boolean[] | undefined) ?? on) : [];
          for (let i = 0; i < 4; i++) setLamp(lamps[`led${i}`]!, leds[i] ? [255, 40, 30] : undefined, 1800);
          relays = [0, 1, 2, 3].map(i => !!on[i]);
          break;
        }
      }
    }
    if (relays.some((on, i) => on !== this.relays[i])) this.post({ t: "ui.sound", name: "relay" });
    this.relays = relays;
  }

  private light(dt: number): void {
    this.lightLevel = approach(this.lightLevel, this.lightsOn ? 1 : 0, dt, 0.12);
    for (const item of this.parts.ceiling) item.light.intensity = item.nits * this.lightLevel;
    const wantExposure = this.lightsOn ? 7.7 : 5.4;
    this.exposure = approach(this.exposure, wantExposure, dt, 0.35);
    this.parts.camera.setManualExposure(this.exposure);
    const rocker = this.parts.props.switchPlate.rocker;
    rocker.rotation.x = this.lightsOn ? -0.09 : 0.09;
    for (const load of this.parts.props.loads) {
      load.on = load.manual !== this.relays[load.channel]!;
      for (const emitter of load.emitters) {
        const pulse = load.id === "beacon" ? 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(this.time * 7), 3) : 1;
        emitter.material.emissiveIntensity = approach(emitter.material.emissiveIntensity, load.on ? emitter.nits * pulse : 0, dt, load.id === "beacon" ? 0.02 : 0.08);
      }
      if (load.spinner) {
        if (load.on) this.fanAngle += dt * 26;
        load.spinner.rotation.z = this.fanAngle;
      }
    }
  }
}

const CABLE = std("grove_cable", 0x1d1e21, 0.6);
const PLUG = coated("grove_plug", 0xf2f1ec, 0.45, 0.3);

type Target =
  | { t: number; kind: "unit"; id: string; control?: UnitControl }
  | { t: number; kind: "prop" | "load" | "tab5" | "switch" | "tray"; id: string }
  | { t: number; kind: "screen"; id: string; x: number; y: number }
  | { t: number; kind: "quest"; id: string; index: number };

/** One step of a flight: along a raised arc from one pose to the other. */
function advance(flight: Flight, pose: Pose, dt: number, done: () => void): void {
  flight.t = Math.min(1, flight.t + dt / flight.duration);
  const k = ease(flight.t);
  pose.at = [lerp(flight.from.at[0], flight.to.at[0], k), lerp(flight.from.at[1], flight.to.at[1], k) + Math.sin(Math.PI * k) * flight.lift, lerp(flight.from.at[2], flight.to.at[2], k)];
  pose.tip = lerp(flight.from.tip, flight.to.tip, k);
  if (flight.t >= 1) { const then = flight.then; done(); then?.(); }
}

/** The distance along a ray to a box in an object's own space (its centre and half extents there), or null. */
function rayBox(origin: Vector3, dir: Vector3, object: Object3D, center: V3, half: V3): number | null {
  object.updateWorldMatrix(true, false);
  const inverse = new Matrix4().copy(object.matrixWorld).invert();
  const o = origin.clone().applyMatrix4(inverse), d = dir.clone().transformDirection(inverse);
  return slab([o.x - center[0], o.y - center[1], o.z - center[2]], [d.x, d.y, d.z], half);
}
function rayAabb(origin: Vector3, dir: Vector3, center: V3, half: V3): number | null {
  return slab([origin.x - center[0], origin.y - center[1], origin.z - center[2]], [dir.x, dir.y, dir.z], half);
}
function slab(o: V3, d: V3, half: V3): number | null {
  let near = -Infinity, far = Infinity;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]!) < 1e-9) { if (Math.abs(o[i]!) > half[i]!) return null; continue; }
    let a = (-half[i]! - o[i]!) / d[i]!, b = (half[i]! - o[i]!) / d[i]!;
    if (a > b) [a, b] = [b, a];
    near = Math.max(near, a); far = Math.min(far, b);
    if (near > far) return null;
  }
  return far < 0 ? null : Math.max(near, 0);
}
function distanceToRay(origin: Vector3, dir: Vector3, point: Vector3): number {
  const to = point.clone().sub(origin);
  const along = to.dot(dir);
  return to.addScaledVector(dir, -along).length();
}
void Group; void Quaternion; void MeshStandardMaterial;
