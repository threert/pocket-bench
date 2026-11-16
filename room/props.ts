// What acts on the sensors, and what the relays switch. Props are loose things on the bench the user carries
// about: warm air for the ENV Unit, a target for the ultrasonic one, cards for the reader, weights for the scale,
// a hot mug for the thermometer. Loads are fixed: a desk lamp, a fan, a lit sign and a beacon, one per relay.
import { CylinderGeometry, Group, LatheGeometry, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, Texture, Vector2, type Scene } from "@threert/scene";
import { Kit, coated, glow, mm, movable, roundedPlate, std, type V3 } from "./lib.ts";
import { BENCH, PROP_HOMES, RISER, ROOM } from "./layout.ts";

export interface Prop {
  id: string;
  /** The name the pointer shows. */
  title: string;
  hint: string;
  root: Group;
  home: V3;
  /** Half extents of its box, and the box's centre above its origin (its origin is the middle of its underside). */
  half: V3;
  /** Grams, for the scale. */
  grams: number;
  /** Surface temperature, for the thermometer. */
  celsius: number;
  /** A card for the reader. */
  card?: { uid: number[]; kind: "classic1k" | "ultralight" };
  /** Lies flat (a card): it can rest on a reader or a pan without toppling. */
  flat?: boolean;
  /** A click switches it. */
  toggles?: boolean;
  on: boolean;
  /** What changes with `on`. */
  indicator?: MeshStandardMaterial;
}

export interface Load {
  id: string;
  title: string;
  /** The relay channel that switches it. */
  channel: number;
  root: Group;
  center: V3;
  half: V3;
  /** Lit or running by hand (a click), whatever the relay says. */
  manual: boolean;
  on: boolean;
  emitters: { material: MeshStandardMaterial; nits: number }[];
  /** A part that turns while it runs. */
  spinner?: Group;
}

export interface PropKit { props: Prop[]; loads: Load[]; switchPlate: { center: V3; half: V3; rocker: Mesh } }

const TOP = BENCH.top;

export function buildProps(scene: Scene): PropKit {
  const kit = new Kit(scene);
  const props: Prop[] = [];
  const prop = (id: string, title: string, hint: string, home: V3, half: V3, grams: number, celsius = 24.6): Prop & { root: Group } => {
    home = PROP_HOMES[id] ?? home;
    const root = movable(kit.group(`prop-${id}`, home));
    const p: Prop = { id, title, hint, root, home, half, grams, celsius, on: false };
    props.push(p);
    return p as Prop & { root: Group };
  };
  const steel = std("prop_steel", 0xb9bcc1, 0.3, 1), dark = std("prop_dark", 0x18191c, 0.5), white = coated("prop_white", 0xf0efec, 0.4, 0.4);

  // ---- the heat gun: a small hot-air tool on its stand, its nozzle toward the pads
  {
    const p = prop("dryer", "热风枪", "点一下开关 · 拖到温湿度模块旁边", [0.47, TOP, -0.10], [0.085, 0.07, 0.03], 240, 31);
    const body = coated("dryer_body", 0xe8742a, 0.42, 0.5);
    const barrel = kit.drum(`prop-dryer`, 21 * mm, 96 * mm, [8 * mm, 96 * mm, 0], body, p.root, 19 * mm, 24);
    barrel.rotation.z = Math.PI / 2;
    const nozzle = kit.drum("prop-dryer", 11 * mm, 34 * mm, [-55 * mm, 96 * mm, 0], steel, p.root, 13 * mm, 20);
    nozzle.rotation.z = Math.PI / 2;
    p.indicator = new MeshStandardMaterial({ name: "dryer_coil", color: 0x1a1a1a, roughness: 0.6, emissive: 0xff5a18, emissiveIntensity: 0 });
    const coil = kit.drum("prop-dryer", 9 * mm, 1 * mm, [-72.2 * mm, 96 * mm, 0], p.indicator, p.root, 9 * mm, 20);
    coil.rotation.z = Math.PI / 2;
    coil.castShadow = false;
    kit.soft("prop-dryer", [30 * mm, 78 * mm, 26 * mm], 6 * mm, [30 * mm, 46 * mm, 0], std("dryer_grip", 0x2b2c30, 0.6), p.root).rotation.z = -0.12;
    kit.soft("prop-dryer", [70 * mm, 8 * mm, 52 * mm], 3 * mm, [26 * mm, 4 * mm, 0], dark, p.root);
    kit.soft("prop-dryer", [8 * mm, 3 * mm, 12 * mm], 1 * mm, [16 * mm, 62 * mm, 14 * mm], std("dryer_switch", 0xd9d9d6, 0.4), p.root);
    p.toggles = true;
  }
  // ---- the mister: a spray bottle; a click sprays
  {
    const p = prop("mister", "加湿喷雾", "点一下喷水雾 · 湿度上升", [0.60, TOP, -0.10], [0.03, 0.075, 0.03], 180);
    const bottle = new MeshPhysicalMaterial({ name: "mister_bottle", color: 0x4d9fd6, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.05 });
    const profile = [[0.001, 0], [24, 0], [26, 3], [26, 78], [22, 92], [11, 100], [11, 112]].map(([r, y]) => new Vector2(r! * mm, y! * mm));
    kit.mesh("prop-mister", new LatheGeometry(profile, 28), [0, 0, 0], bottle, p.root);
    kit.soft("prop-mister", [26 * mm, 22 * mm, 22 * mm], 4 * mm, [-2 * mm, 124 * mm, 0], white, p.root);
    kit.soft("prop-mister", [18 * mm, 7 * mm, 9 * mm], 2 * mm, [-22 * mm, 128 * mm, 0], white, p.root);
    kit.soft("prop-mister", [6 * mm, 26 * mm, 10 * mm], 2 * mm, [-10 * mm, 104 * mm, 0], white, p.root).rotation.z = 0.35;
    p.toggles = true;
  }
  // ---- the target block for the ultrasonic Unit
  {
    const p = prop("block", "挡板", "拖到超声波模块前面 · 改变距离", [0.74, TOP, -0.12], [0.04, 0.05, 0.014], 85);
    kit.soft("prop-block", [80 * mm, 100 * mm, 28 * mm], 4 * mm, [0, 50 * mm, 0], coated("block_yellow", 0xf0b62a, 0.45, 0.5), p.root);
    kit.soft("prop-block", [60 * mm, 6 * mm, 28.4 * mm], 1 * mm, [0, 78 * mm, 0], std("block_stripe", 0x1b1b1b, 0.5), p.root);
  }
  // ---- the mug: hot coffee
  {
    const p = prop("mug", "热咖啡", "62 °C · 给红外测温模块量一量", [0.86, TOP, -0.10], [0.05, 0.048, 0.042], 310, 62);
    const ceramic = coated("mug_ceramic", 0xf3f2ee, 0.25, 0.9);
    const outer = [[0.001, 0], [36, 0], [39, 4], [41, 92], [39.5, 95], [37.5, 92], [36, 8], [0.001, 6]].map(([r, y]) => new Vector2(r! * mm, y! * mm));
    kit.mesh("prop-mug", new LatheGeometry(outer, 32), [0, 0, 0], ceramic, p.root);
    kit.drum("prop-mug", 36.5 * mm, 1 * mm, [0, 80 * mm, 0], std("mug_coffee", 0x2a1509, 0.15), p.root);
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      kit.ball("prop-mug", 5.2 * mm, [(41 + Math.cos(a) * 20) * mm, (48 + Math.sin(a) * 26) * mm, 0], ceramic, p.root);
    }
  }
  // ---- cards for the reader
  const cardArt = (id: string, title: string, home: V3, color: number, stripe: number, uid: number[], kind: "classic1k" | "ultralight") => {
    const p = prop(id, title, "拖到读卡模块上刷卡", home, [0.043, 0.002, 0.027], 6);
    const face = kit.mesh(`prop-${id}`, roundedPlate(85.6 * mm, 54 * mm, 0.9 * mm, 3.2 * mm), [0, 0.6 * mm, 0], coated(`card_${id}`, color, 0.35, 0.6), p.root);
    face.rotation.x = -Math.PI / 2;
    const band = kit.mesh(`prop-${id}`, roundedPlate(85.6 * mm, 13 * mm, 0.1 * mm, 0.5 * mm), [0, 1.12 * mm, 14 * mm], std(`card_${id}_stripe`, stripe, 0.4), p.root);
    band.rotation.x = -Math.PI / 2;
    kit.box(`prop-${id}`, [11 * mm, 0.1 * mm, 9 * mm], [-26 * mm, 1.12 * mm, -8 * mm], std("card_chip", 0xd6b452, 0.3, 1), p.root);
    p.card = { uid, kind };
    p.flat = true;
    return p;
  };
  cardArt("card-a", "员工卡", [0.50, TOP, -0.23], 0xf4f4f1, 0x1d63c4, [0x04, 0xa3, 0x1b, 0x7c], "classic1k");
  cardArt("card-b", "访客卡", [0.60, TOP, -0.225], 0xfae7a1, 0xd0473c, [0x9e, 0x12, 0x55, 0x0d], "classic1k");
  {
    const p = prop("tag", "钥匙扣", "NTAG · 拖到读卡模块上", [0.685, TOP, -0.235], [0.021, 0.004, 0.016], 4);
    const blue = coated("tag_blue", 0x1f5fb8, 0.4, 0.6);
    kit.soft("prop-tag", [34 * mm, 5 * mm, 28 * mm], 2.4 * mm, [2 * mm, 2.5 * mm, 0], blue, p.root);
    kit.drum("prop-tag", 7 * mm, 2.2 * mm, [-17 * mm, 1.6 * mm, 0], steel, p.root, 7 * mm, 18);
    p.card = { uid: [0x04, 0x5f, 0x2a, 0x91, 0x6c, 0x33, 0x80], kind: "ultralight" };
    p.flat = true;
  }
  // ---- calibration weights
  const weight = (grams: number, radius: number, height: number, home: V3) => {
    const p = prop(`weight-${grams}`, `${grams} g 砝码`, "拖到电子秤上", home, [radius * mm, (height + 8) * mm / 2, radius * mm], grams);
    const brass = std("weight_brass", 0xc8a04c, 0.28, 1);
    kit.drum(`prop-weight-${grams}`, radius * mm, height * mm, [0, (height / 2) * mm, 0], brass, p.root, radius * 0.94 * mm, 28);
    kit.drum(`prop-weight-${grams}`, radius * 0.36 * mm, 4 * mm, [0, (height + 2) * mm, 0], brass, p.root, radius * 0.3 * mm, 18);
    kit.drum(`prop-weight-${grams}`, radius * 0.6 * mm, 4 * mm, [0, (height + 6) * mm, 0], brass, p.root, radius * 0.6 * mm, 20);
  };
  weight(50, 9, 20, [0.775, TOP, -0.235]);
  weight(100, 11.5, 26, [0.825, TOP, -0.235]);
  weight(200, 14.5, 32, [0.885, TOP, -0.235]);

  // ---------------------------------------------------------------------------------------- loads on the relays
  const loads: Load[] = [];
  const shelf = TOP + RISER.height;
  // CH1: a desk lamp on the riser, its head over the right of the bench.
  {
    const root = kit.group("load-lamp", [0.84, shelf, -0.66]);
    const paint = coated("lamp_paint", 0x1f2328, 0.4, 0.5);
    kit.drum("load-lamp", 62 * mm, 14 * mm, [0, 7 * mm, 0], paint, root, 58 * mm, 32);
    kit.rod("load-lamp", [0, 14 * mm, 0], [-30 * mm, 250 * mm, 60 * mm], 5 * mm, steel, root);
    kit.rod("load-lamp", [-30 * mm, 250 * mm, 60 * mm], [-150 * mm, 330 * mm, 250 * mm], 5 * mm, steel, root);
    kit.ball("load-lamp", 9 * mm, [-30 * mm, 250 * mm, 60 * mm], paint, root);
    const head = kit.group(null, [-165 * mm, 318 * mm, 275 * mm], root);
    head.rotation.x = 0.35;
    kit.drum("load-lamp", 60 * mm, 46 * mm, [0, 0, 0], paint, head, 34 * mm, 32);
    const bulb = new MeshStandardMaterial({ name: "lamp_bulb", color: 0x8a8a86, roughness: 0.4, emissive: 0xffd9a8, emissiveIntensity: 0 });
    const disc = kit.drum("load-lamp", 52 * mm, 2 * mm, [0, -23.5 * mm, 0], bulb, head, 52 * mm, 32);
    disc.castShadow = false;
    loads.push({ id: "lamp", title: "台灯 · 继电器 CH1", channel: 0, root, center: [0.84 - 0.1, shelf + 0.2, -0.66 + 0.16], half: [0.14, 0.2, 0.19], manual: false, on: false, emitters: [{ material: bulb, nits: 24000 }] });
  }
  // CH2: a desk fan.
  {
    const root = kit.group("load-fan", [0.665, shelf, -0.66]);
    const paint = coated("fan_paint", 0xe9e8e4, 0.4, 0.5);
    kit.drum("load-fan", 46 * mm, 10 * mm, [0, 5 * mm, 0], paint, root, 42 * mm, 28);
    kit.rod("load-fan", [0, 10 * mm, 0], [0, 78 * mm, 0], 6 * mm, paint, root);
    const cage = kit.group(null, [0, 96 * mm, 12 * mm], root);
    const ring = new CylinderGeometry(62 * mm, 62 * mm, 30 * mm, 36, 1, true);
    const shell = kit.add(new Mesh(ring, std("fan_cage", 0xd5d4d0, 0.45, 0.4)), "load-fan", [0, 0, 0], cage);
    shell.rotation.x = Math.PI / 2;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      kit.rod("load-fan", [0, 0, 15 * mm], [Math.cos(a) * 62 * mm, Math.sin(a) * 62 * mm, 15 * mm], 0.8 * mm, steel, cage, 6);
    }
    kit.drum("load-fan", 14 * mm, 22 * mm, [0, 0, -6 * mm], paint, cage).rotation.x = Math.PI / 2;
    const spinner = movable(kit.group("load-fan-blades", [0, 0, 6 * mm], cage));
    const blade = std("fan_blade", 0x3d8fd1, 0.4);
    for (let i = 0; i < 5; i++) {
      const b = kit.mesh("load-fan-blades", roundedPlate(46 * mm, 22 * mm, 1.2 * mm, 9 * mm), [0, 0, 0], blade, spinner);
      const a = (i / 5) * Math.PI * 2;
      b.position.set(Math.cos(a) * 30 * mm, Math.sin(a) * 30 * mm, 0);
      b.rotation.set(0.35, 0, a);
    }
    loads.push({ id: "fan", title: "风扇 · 继电器 CH2", channel: 1, root, center: [0.665, shelf + 0.085, -0.65], half: [0.07, 0.085, 0.05], manual: false, on: false, emitters: [], spinner });
  }
  // CH3: a lit sign on the pegboard.
  {
    const root = kit.group("load-sign", [0.71, 1.37, ROOM.back + 0.03]);
    kit.soft("load-sign", [300 * mm, 104 * mm, 34 * mm], 6 * mm, [0, 0, 0], std("sign_case", 0x16171a, 0.45), root);
    const face = new MeshStandardMaterial({ name: "sign_face", color: 0x1a0505, roughness: 0.35, emissive: 0xffffff, emissiveMap: new Texture("room/assets/gen/props/sign.png"), emissiveIntensity: 0 });
    kit.add(new Mesh(new PlaneGeometry(284 * mm, 88 * mm), face), "load-sign", [0, 0, 17.3 * mm], root).castShadow = false;
    loads.push({ id: "sign", title: "灯牌 · 继电器 CH3", channel: 2, root, center: [0.71, 1.37, ROOM.back + 0.03], half: [0.15, 0.052, 0.02], manual: false, on: false, emitters: [{ material: face, nits: 900 }] });
  }
  // CH4: an amber beacon beside it.
  {
    const root = kit.group("load-beacon", [0.905, 1.26, ROOM.back + 0.03]);
    kit.drum("load-beacon", 26 * mm, 18 * mm, [0, 9 * mm, 0], std("beacon_base", 0x16171a, 0.45), root, 24 * mm, 24);
    const dome = new MeshStandardMaterial({ name: "beacon_dome", color: 0xb8650a, roughness: 0.22, emissive: 0xff8a00, emissiveIntensity: 0 });
    kit.drum("load-beacon", 21 * mm, 34 * mm, [0, 35 * mm, 0], dome, root, 17 * mm, 24).castShadow = false;
    kit.ball("load-beacon", 17 * mm, [0, 52 * mm, 0], dome, root).castShadow = false;
    loads.push({ id: "beacon", title: "警示灯 · 继电器 CH4", channel: 3, root, center: [0.905, 1.295, ROOM.back + 0.03], half: [0.03, 0.04, 0.03], manual: false, on: false, emitters: [{ material: dome, nits: 5200 }] });
  }

  // The room's light switch, on the wall between the benches.
  const plate = kit.soft("light-switch", [86 * mm, 86 * mm, 9 * mm], 3 * mm, [1.085, 1.28, ROOM.back + 4.5 * mm], coated("switch_plate", 0xf2f1ee, 0.35, 0.5));
  void plate;
  const rocker = kit.soft("light-switch", [34 * mm, 52 * mm, 6 * mm], 2 * mm, [1.085, 1.28, ROOM.back + 10 * mm], coated("switch_rocker", 0xfafaf7, 0.3, 0.6));
  rocker.movable = true;
  return { props, loads, switchPlate: { center: [1.085, 1.28, ROOM.back + 0.008], half: [0.05, 0.05, 0.012], rocker } };
}
