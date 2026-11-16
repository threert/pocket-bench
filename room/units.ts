// The Units: M5Stack's small sensor and control modules, each a white body with a printed label, a red
// HY2.0-4P socket at one end, and whatever it senses or drives on top. They live in a foam tray on the bench and
// sit on a pad when they are plugged in. A Unit's origin is the middle of its underside; its socket is at -X.
import { Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, Object3D, PlaneGeometry, Texture, type Scene } from "@threert/scene";
import { Kit, coated, mm, movable, roundedPlate, std, type V3 } from "./lib.ts";
import { TRAY_POCKETS, TRAY_SIZE, UNIT_SPECS, type UnitSpec } from "./catalog.ts";
import { HUB, TRAY } from "./layout.ts";

/** Something on a Unit the pointer works: a knob, a stick, a button. Its place is in the Unit's own space. */
export interface UnitControl {
  id: string;
  kind: "knob" | "switch" | "stick" | "button" | "dial";
  at: V3;
  /** Pick radius, metres. */
  radius: number;
  object: Object3D;
}

export interface UnitModel {
  spec: UnitSpec;
  root: Group;
  /** Length, height, depth in metres. */
  size: V3;
  /** The socket's mouth in the Unit's space: where its cable leaves. */
  socket: V3;
  /** Lamps by name ("led0"...), dark until the sidecar says otherwise. */
  lamps: Record<string, MeshStandardMaterial>;
  controls: UnitControl[];
  /** The top surface something can be put on (a card on the reader, a weight on the pan), in the Unit's space. */
  deck?: { at: V3; radius: number };
  /** Where the Unit rests in the tray, world space. */
  home: V3;
}

const BODY = coated("unit_body", 0xf1f0ec, 0.5, 0.25);
const SOCKET_RED = coated("unit_socket", 0xc4201f, 0.45, 0.3);
const DARK = std("unit_dark", 0x121214, 0.5);
const PIN = std("unit_pin", 0xd6b452, 0.25, 1);
const STEEL = std("unit_steel", 0xb7babf, 0.28, 1);
const KNOB = std("unit_knob", 0x2a2b2f, 0.45);
const KNOB_MARK = std("unit_knob_mark", 0xf2f2f2, 0.5);
const RELAY_BLUE = coated("unit_relay", 0x1d5fb8, 0.35, 0.5);
const TERMINAL = coated("unit_terminal", 0x2e9a52, 0.45, 0.3);

/** A lamp: a small diffuser that is dark grey until it is lit. */
function lamp(name: string): MeshStandardMaterial {
  return new MeshStandardMaterial({ name, color: 0x6a6c70, roughness: 0.35, emissive: 0x000000, emissiveIntensity: 0 });
}
/** Sets a lamp from 8-bit RGB as the Unit's firmware holds it. */
export function setLamp(material: MeshStandardMaterial, rgb: readonly number[] | undefined, nits = 2600): void {
  const [r, g, b] = rgb ?? [0, 0, 0];
  const peak = Math.max(r ?? 0, g ?? 0, b ?? 0);
  if (peak <= 0) { material.emissiveIntensity = 0; return; }
  material.emissive.setRGB(Math.pow((r ?? 0) / 255, 2.2), Math.pow((g ?? 0) / 255, 2.2), Math.pow((b ?? 0) / 255, 2.2));
  material.emissiveIntensity = nits;
}

function buildUnit(kit: Kit, spec: UnitSpec, home: V3): UnitModel {
  const [length, depth, height] = [spec.size[0] * mm, spec.size[1] * mm, spec.size[2] * mm];
  const root = movable(kit.group(`unit-${spec.id}`, home));
  const id = `unit-${spec.id}`;
  const lamps: Record<string, MeshStandardMaterial> = {};
  const controls: UnitControl[] = [];
  // The body, its label, its socket.
  const base = spec.id === "relay4" ? 6 * mm : Math.min(height, 8 * mm);
  kit.soft(id, [length, base, depth], 1.3 * mm, [0, base / 2, 0], BODY, root);
  const label = new MeshStandardMaterial({ name: `unit_label_${spec.id}`, map: new Texture(`room/assets/gen/units/${spec.id}.png`), roughness: 0.42 });
  if (spec.id !== "relay4") {
    const plate = kit.mesh(id, roundedPlate(length - 2.4 * mm, depth - 2.4 * mm, 0.25 * mm, 1.4 * mm), [0, base + 0.1 * mm, 0], label, root);
    plate.rotation.x = -Math.PI / 2;
  }
  kit.box(id, [3.2 * mm, 5.2 * mm, 9.8 * mm], [-length / 2 - 0.6 * mm, 3.2 * mm, 0], SOCKET_RED, root);
  kit.box(id, [1.2 * mm, 3.4 * mm, 7.8 * mm], [-length / 2 - 1.7 * mm, 3.2 * mm, 0], DARK, root);
  for (let i = 0; i < 4; i++) kit.box(id, [1.4 * mm, 0.5 * mm, 0.5 * mm], [-length / 2 - 1.6 * mm, 3.2 * mm, (-3 + i * 2) * mm], PIN, root);
  const model: UnitModel = { spec, root, size: [length, height, depth], socket: [-length / 2 - 2.2 * mm, 3.2 * mm, 0], lamps, controls, home };
  const top = base;

  switch (spec.id) {
    case "env3": {
      // The sensors breathe through a slot at the far end.
      kit.box(id, [5 * mm, 0.4 * mm, 1.2 * mm], [length / 2 - 5.5 * mm, top + 0.3 * mm, 4 * mm], DARK, root);
      kit.box(id, [5 * mm, 0.4 * mm, 1.2 * mm], [length / 2 - 5.5 * mm, top + 0.3 * mm, 6.4 * mm], DARK, root);
      break;
    }
    case "sonic": {
      // Two 16 mm transducers: an aluminium can with a mesh face.
      for (const x of [-13, 13]) {
        kit.drum(id, 8 * mm, 9 * mm, [x * mm + 6 * mm, top + 4.5 * mm, 0], STEEL, root);
        kit.drum(id, 6.6 * mm, 0.5 * mm, [x * mm + 6 * mm, top + 9.1 * mm, 0], std("unit_sonic_mesh", 0x2a2c30, 0.6, 0.4), root);
      }
      break;
    }
    case "rfid2": {
      model.deck = { at: [4 * mm, top + 0.4 * mm, 0], radius: 26 * mm };
      break;
    }
    case "angle8": {
      // Eight knobs in a row, a lamp in front of each, and a slide switch with the ninth lamp at the far end.
      for (let i = 0; i < 8; i++) {
        const x = (-52 + i * 13.2) * mm;
        const knob = kit.group(null, [x, top, -1.5 * mm], root);
        kit.drum(id, 4.6 * mm, 6.5 * mm, [0, 3.4 * mm, 0], KNOB, knob, 4.2 * mm, 20);
        kit.box(id, [0.9 * mm, 0.5 * mm, 3.6 * mm], [0, 6.7 * mm, -2.2 * mm], KNOB_MARK, knob);
        controls.push({ id: `knob${i}`, kind: "knob", at: [x, top + 6 * mm, -1.5 * mm], radius: 6.2 * mm, object: knob });
        lamps[`led${i}`] = lamp(`unit_angle8_led${i}`);
        kit.soft(id, [3 * mm, 1.1 * mm, 3 * mm], 0.4 * mm, [x, top + 0.7 * mm, 8.2 * mm], lamps[`led${i}`]!, root).castShadow = false;
      }
      const toggle = kit.group(null, [56.5 * mm, top, -1.5 * mm], root);
      kit.box(id, [7 * mm, 2.4 * mm, 4 * mm], [0, 1.2 * mm, 0], DARK, root).position.set(56.5 * mm, top + 1.2 * mm, -1.5 * mm);
      kit.box(id, [2.4 * mm, 3 * mm, 2.4 * mm], [0, 3.6 * mm, 0], STEEL, toggle);
      controls.push({ id: "switch", kind: "switch", at: [56.5 * mm, top + 4 * mm, -1.5 * mm], radius: 6 * mm, object: toggle });
      lamps.led8 = lamp("unit_angle8_led8");
      kit.soft(id, [3 * mm, 1.1 * mm, 3 * mm], 0.4 * mm, [56.5 * mm, top + 0.7 * mm, 8.2 * mm], lamps.led8, root).castShadow = false;
      break;
    }
    case "joystick2": {
      kit.drum(id, 9.5 * mm, 2.4 * mm, [4 * mm, top + 1.2 * mm, 0], DARK, root);
      const stick = kit.group(null, [4 * mm, top + 2 * mm, 0], root);
      kit.drum(id, 2.6 * mm, 8 * mm, [0, 4 * mm, 0], STEEL, stick);
      kit.drum(id, 7.6 * mm, 3.4 * mm, [0, 9.4 * mm, 0], KNOB, stick, 6.8 * mm, 24);
      controls.push({ id: "stick", kind: "stick", at: [4 * mm, top + 10 * mm, 0], radius: 11 * mm, object: stick });
      lamps.led = lamp("unit_joystick_led");
      kit.soft(id, [3 * mm, 1.1 * mm, 3 * mm], 0.4 * mm, [-13 * mm, top + 0.7 * mm, 8 * mm], lamps.led, root).castShadow = false;
      break;
    }
    case "dlight": {
      // The sensor under a clear window.
      kit.box(id, [3.4 * mm, 0.5 * mm, 2.6 * mm], [length / 2 - 6 * mm, top + 0.3 * mm, 5 * mm], new MeshPhysicalMaterial({ name: "unit_dlight_window", color: 0x1a1d24, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.03 }), root);
      break;
    }
    case "relay4": {
      // A board: four blue relays, a screw terminal for each, a lamp for each.
      const pcb = std("unit_relay_pcb", 0x1b1c20, 0.5);
      kit.box(id, [length - 3 * mm, 1 * mm, depth - 3 * mm], [0, top + 0.5 * mm, 0], pcb, root);
      for (let i = 0; i < 4; i++) {
        const x = (-27 + i * 18.5) * mm;
        kit.soft(id, [15.2 * mm, 11 * mm, 19 * mm], 0.8 * mm, [x + 2 * mm, top + 6.5 * mm, 4 * mm], RELAY_BLUE, root);
        kit.soft(id, [15.2 * mm, 8 * mm, 7.6 * mm], 0.5 * mm, [x + 2 * mm, top + 5 * mm, -19 * mm], TERMINAL, root);
        for (const dx of [-5, 0, 5]) kit.drum(id, 1.5 * mm, 0.6 * mm, [x + 2 * mm + dx * mm, top + 9.1 * mm, -19 * mm], STEEL, root, 1.5 * mm, 10);
        lamps[`led${i}`] = lamp(`unit_relay_led${i}`);
        kit.soft(id, [2.6 * mm, 1 * mm, 2.6 * mm], 0.3 * mm, [x + 2 * mm, top + 1.5 * mm, 19 * mm], lamps[`led${i}`]!, root).castShadow = false;
      }
      break;
    }
    case "scales": {
      // A brushed pan on a short post, a tare button and a lamp on the front.
      kit.drum(id, 5 * mm, 3.4 * mm, [3 * mm, top + 1.7 * mm, 0], DARK, root);
      const pan = kit.mesh(id, roundedPlate(46 * mm, 46 * mm, 1.6 * mm, 5 * mm), [3 * mm, top + 4.2 * mm, 0], std("unit_scales_pan", 0xc4c7cb, 0.32, 1), root);
      pan.rotation.x = -Math.PI / 2;
      model.deck = { at: [3 * mm, top + 5 * mm, 0], radius: 23 * mm };
      const button = kit.group(null, [-14.5 * mm, top, 0], root);
      kit.drum(id, 2.6 * mm, 1.6 * mm, [0, 0.8 * mm, 0], KNOB, button);
      controls.push({ id: "button", kind: "button", at: [-14.5 * mm, top + 1 * mm, 0], radius: 4 * mm, object: button });
      lamps.led = lamp("unit_scales_led");
      kit.soft(id, [2.6 * mm, 1 * mm, 2.6 * mm], 0.3 * mm, [-14.5 * mm, top + 0.6 * mm, 8 * mm], lamps.led, root).castShadow = false;
      break;
    }
    case "ncir": {
      // The thermopile in its metal can.
      kit.drum(id, 4.6 * mm, 4.2 * mm, [length / 2 - 8 * mm, top + 2.1 * mm, 0], STEEL, root);
      kit.drum(id, 1.9 * mm, 0.3 * mm, [length / 2 - 8 * mm, top + 4.3 * mm, 0], std("unit_ncir_window", 0x23252b, 0.15, 0.2), root);
      break;
    }
    case "encoder": {
      const dial = kit.group(null, [3 * mm, top, 0], root);
      kit.drum(id, 6.8 * mm, 11 * mm, [0, 5.5 * mm, 0], std("unit_encoder_knob", 0xa9acb1, 0.3, 1), dial, 6.2 * mm, 28);
      kit.box(id, [1 * mm, 0.4 * mm, 4.5 * mm], [0, 11.1 * mm, -3 * mm], KNOB, dial);
      controls.push({ id: "dial", kind: "dial", at: [3 * mm, top + 9 * mm, 0], radius: 9 * mm, object: dial });
      for (let i = 0; i < 2; i++) {
        lamps[`led${i}`] = lamp(`unit_encoder_led${i}`);
        kit.soft(id, [2.6 * mm, 1 * mm, 2.6 * mm], 0.3 * mm, [(i ? 12.5 : -9.5) * mm, top + 0.6 * mm, 8.4 * mm], lamps[`led${i}`]!, root).castShadow = false;
      }
      break;
    }
  }
  return model;
}

export interface UnitKit {
  units: Record<string, UnitModel>;
  tray: Group;
  hub: Group;
  /** The hub's sockets in world space: [toward the Tab5, then three for Units]. */
  hubPorts: V3[];
}

export function buildUnits(scene: Scene): UnitKit {
  const kit = new Kit(scene);
  // The tray: a foam insert in a shallow case, printed with what goes where.
  const tray = kit.group("unit-tray", TRAY.at);
  const [tw, td] = [TRAY_SIZE[0] * mm, TRAY_SIZE[1] * mm];
  const trayH = 12 * mm;
  kit.soft("unit-tray", [tw + 8 * mm, trayH, td + 8 * mm], 3 * mm, [0, trayH / 2, 0], std("tray_case", 0x15161a, 0.5), tray);
  const print = kit.add(new Mesh(new PlaneGeometry(tw, td), new MeshStandardMaterial({ name: "tray_print", map: new Texture("room/assets/gen/units/tray.png"), roughness: 0.92 })), "unit-tray", [0, trayH + 0.15 * mm, 0], tray);
  print.rotation.x = -Math.PI / 2;

  const units: Record<string, UnitModel> = {};
  for (const spec of UNIT_SPECS) {
    const [px, pz] = TRAY_POCKETS[spec.id]!;
    units[spec.id] = buildUnit(kit, spec, [TRAY.at[0] + px * mm, TRAY.at[1] + trayH + 0.3 * mm, TRAY.at[2] + pz * mm]);
  }

  // The hub: one socket toward the Tab5 at its right end, three for Units along its front. It stays on the
  // bench, wired to Port A.
  const hub = kit.group("hub", HUB);
  kit.soft("hub", [44 * mm, 8 * mm, 22 * mm], 1.3 * mm, [0, 4 * mm, 0], BODY, hub);
  const hubLabel = kit.mesh("hub", roundedPlate(40 * mm, 18 * mm, 0.25 * mm, 1.4 * mm), [0, 8.1 * mm, 0], new MeshStandardMaterial({ name: "hub_label", map: new Texture("room/assets/gen/units/hub.png"), roughness: 0.42 }), hub);
  hubLabel.rotation.x = -Math.PI / 2;
  const ports: V3[] = [];
  const socket = (x: number, z: number, alongX: boolean) => {
    const size: V3 = alongX ? [3.2 * mm, 5.2 * mm, 9.8 * mm] : [9.8 * mm, 5.2 * mm, 3.2 * mm];
    kit.box("hub", size, [x, 3.2 * mm, z], SOCKET_RED, hub);
    const mouth: V3 = alongX ? [1.2 * mm, 3.4 * mm, 7.8 * mm] : [7.8 * mm, 3.4 * mm, 1.2 * mm];
    const out: V3 = [x + (alongX ? Math.sign(x) * 1.1 * mm : 0), 3.2 * mm, z + (alongX ? 0 : Math.sign(z) * 1.1 * mm)];
    kit.box("hub", mouth, out, DARK, hub);
    ports.push([HUB[0] + out[0] + (alongX ? Math.sign(x) * 1 * mm : 0), HUB[1] + 3.2 * mm, HUB[2] + out[2] + (alongX ? 0 : Math.sign(z) * 1 * mm)]);
  };
  socket(22.6 * mm, 0, true);            // toward the Tab5
  socket(-13 * mm, 11.6 * mm, false);    // Units
  socket(0, 11.6 * mm, false);
  socket(13 * mm, 11.6 * mm, false);
  return { units, tray, hub, hubPorts: ports };
}
