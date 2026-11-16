// The M5Stack Tab5: the open-hardware enclosure (m5stack/M5_Hardware, MIT; tools/blender/tab5_shell.py) with what
// the enclosure file leaves out: the cover glass, the 5-inch panel, the connectors in the cut-outs, the camera, and
// a small tripod in the 1/4-inch nut. Device space: millimetres come from the drawing; +X to the camera side, +Y
// up, +Z out of the screen, the origin at the centre of the 128 x 80 x 12 body.
import { CircleGeometry, GLTFModel, Group, MaterialFunction, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry, StreamTexture, type Scene } from "@threert/scene";
import { Kit, coated, mm, movable, roundedPlate, std, type V3 } from "./lib.ts";
import { TAB5 } from "./layout.ts";

export const SCREEN_PX = { width: 640, height: 360 } as const;
/** The panel's lit area, metres, and its centre in device space (the bezel is wider on the camera side). */
export const PANEL = { width: 110.0 * mm, height: 62.0 * mm, at: [-3.0 * mm, 0, 5.62 * mm] as V3 };
/** Port A in device space: the middle of the red socket's mouth on the left edge. */
export const PORT_A: V3 = [-64.2 * mm, -26.0 * mm, -0.6 * mm];

// The panel: what the Tab5's program draws, as light. A material function, so the live view shows this frame's
// picture (emission from a function keeps a short history) and not a blend of the last ones.
const PANEL_FN = new MaterialFunction("tab5_panel", {
  params: { Nits: 320, Backlight: 1, Black: 0.6 },
  textures: ["Picture"],
  code: `
    let c = msample_color(m, i, $Picture, i.uv, exp2(i.uvd)).rgb;
    o.emissive = (c * $Nits + vec3<f32>($Black)) * $Backlight * i.power;
    o.base = vec3<f32>(0.004);
    o.roughness = 0.06;
    o.metallic = 0.0;
    o.specular = 0.5;`,
});

export interface Tab5Parts {
  /** Moves with the device: position and rotation are the frame script's. */
  root: Group;
  /** The lit panel: a touch is a ray against it. */
  panel: Mesh;
  panelMaterial: MeshStandardMaterial;
  picture: StreamTexture;
  setBacklight(level: number): void;
}

export function buildTab5(scene: Scene): Tab5Parts {
  const kit = new Kit(scene);
  const root = movable(kit.group("tab5", TAB5.at));
  root.rotation.x = -TAB5.tilt;
  const body = kit.group(null, [0, 0, 0], root);

  const shell = new GLTFModel("room/assets/tab5/shell.glb");
  kit.add(shell, "tab5_shell", [0, 0, 0], body);

  // The cover glass sits inside the shell's rim, black behind the bezel.
  const glass = new MeshPhysicalMaterial({ name: "tab5_glass", color: 0x050506, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03 });
  kit.mesh("tab5_glass", roundedPlate(124.9 * mm, 76.9 * mm, 1.0 * mm, 2.6 * mm), [0, 0, 5.1 * mm], glass, body);
  // The panel, a hair above the glass's face.
  const picture = new StreamTexture("tab5", SCREEN_PX.width, SCREEN_PX.height);
  const panelMaterial = new MeshStandardMaterial({ name: "tab5_panel", color: 0x000000, roughness: 0.06, emissive: 0xffffff, emissiveIntensity: 1 });
  panelMaterial.shader = PANEL_FN.with({}, { Picture: picture });
  const panel = kit.add(new Mesh(new PlaneGeometry(PANEL.width, PANEL.height), panelMaterial), "tab5_screen", PANEL.at, body);
  panel.castShadow = false;
  // The camera in the right bezel: a ring and a lens.
  const lens = new MeshPhysicalMaterial({ name: "tab5_lens", color: 0x0a0a12, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02 });
  kit.add(new Mesh(new CircleGeometry(2.4 * mm, 24), std("tab5_lens_ring", 0x1b1b1e, 0.35, 0.6)), "tab5_camera", [59.55 * mm, 0, 5.63 * mm], body);
  kit.add(new Mesh(new CircleGeometry(1.3 * mm, 20), lens), "tab5_camera", [59.55 * mm, 0, 5.66 * mm], body);

  // Connectors, behind their cut-outs. Left edge, top to bottom: power button, USB-A, USB-C, headphones, Port A.
  const metal = std("tab5_port_metal", 0xb9bcc0, 0.3, 1), dark = std("tab5_port_dark", 0x101012, 0.5), red = coated("tab5_grove", 0xc81e1e, 0.4, 0.4);
  const white = std("tab5_button", 0xe6e6e4, 0.5), brass = std("tab5_brass", 0xc9a04a, 0.3, 1), pin = std("tab5_pin", 0xd8b656, 0.25, 1);
  const x = -62.2 * mm;
  kit.soft("tab5_power", [3 * mm, 7.2 * mm, 3.2 * mm], 0.8 * mm, [-63.4 * mm, 28 * mm, -0.5 * mm], white, body);
  kit.box("tab5_usb_a", [4 * mm, 12.6 * mm, 5.4 * mm], [x, 15 * mm, -1.4 * mm], metal, body);
  kit.box("tab5_usb_a", [4.2 * mm, 11 * mm, 1.6 * mm], [x - 0.2 * mm, 15 * mm, -2.2 * mm], dark, body);
  kit.soft("tab5_usb_c", [4 * mm, 8.0 * mm, 2.9 * mm], 1.2 * mm, [x, 0, 0.5 * mm], metal, body);
  kit.soft("tab5_usb_c", [4.2 * mm, 6.4 * mm, 1.0 * mm], 0.4 * mm, [x - 0.3 * mm, 0, 0.5 * mm], dark, body);
  const jack = kit.drum("tab5_jack", 3.0 * mm, 4 * mm, [x, -13 * mm, -0.6 * mm], dark, body);
  jack.rotation.z = Math.PI / 2;
  // Port A: the red HY2.0-4P socket with its four pins.
  kit.box("tab5_port_a", [5 * mm, 9.6 * mm, 5.0 * mm], [-61.6 * mm, -26 * mm, -0.6 * mm], red, body);
  kit.box("tab5_port_a", [4.6 * mm, 7.8 * mm, 3.2 * mm], [-62.4 * mm, -26 * mm, -0.6 * mm], dark, body);
  for (let i = 0; i < 4; i++) kit.box("tab5_port_a", [3 * mm, 0.5 * mm, 0.5 * mm], [-62.6 * mm, (-26 - 3 + i * 2) * mm, -0.6 * mm], pin, body);
  // Bottom edge: the 2x5 expansion header, the card slot, the tripod nut, the speaker.
  kit.box("tab5_ext", [12.6 * mm, 4 * mm, 5.0 * mm], [-38 * mm, -37.8 * mm, -0.6 * mm], dark, body);
  kit.box("tab5_sd", [12 * mm, 3 * mm, 1.5 * mm], [-15.2 * mm, -38 * mm, -1.7 * mm], metal, body);
  kit.box("tab5_speaker", [20 * mm, 2 * mm, 7 * mm], [36.2 * mm, -37.5 * mm, 0], dark, body);
  // Top edge: the two antenna jacks.
  for (const ax of [-47.9, 1.0]) {
    kit.drum("tab5_antenna", 1.9 * mm, 4 * mm, [ax * mm, 38.2 * mm, -1.1 * mm], brass, body);
  }

  // The tripod: a ball head on three short legs, screwed into the nut in the bottom edge. It stays upright under
  // the leaning device, so it hangs from the root and undoes the tilt.
  const stand = kit.group("tab5_stand", [0, 0, 0], root);
  const anodised = std("tripod_black", 0x17181a, 0.38, 0.7), rubber = std("tripod_rubber", 0x0e0e0e, 0.8);
  const down = -40 * mm;
  kit.drum("tab5_stand", 4.5 * mm, 8 * mm, [0, down - 4 * mm, 0], brass, stand);
  kit.drum("tab5_stand", 9 * mm, 5 * mm, [0, down - 10 * mm, 0], anodised, stand);
  kit.ball("tab5_stand", 8.5 * mm, [0, down - 20 * mm, 0], std("tripod_ball", 0x9a9da1, 0.25, 1), stand);
  const hub = kit.group(null, [0, down - 30 * mm, 0], stand);
  hub.rotation.x = TAB5.tilt;
  kit.drum("tab5_stand", 11 * mm, 14 * mm, [0, -2 * mm, 0], anodised, hub);
  // (The device's centre is 118 mm above the bench: the legs reach down what is left.)
  const floorY = -(TAB5.at[1] - 0.76) / Math.cos(0) + 0;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const reach = 62 * mm, drop = 48 * mm;
    const from: V3 = [Math.sin(a) * 6 * mm, -6 * mm, Math.cos(a) * 6 * mm], to: V3 = [Math.sin(a) * reach, -drop + 5 * mm, Math.cos(a) * reach];
    kit.rod("tab5_stand", from, to, 4.2 * mm, anodised, hub, 12);
    kit.ball("tab5_stand", 5.2 * mm, [to[0], to[1] - 1.5 * mm, to[2]], rubber, hub);
  }
  void floorY;

  return {
    root, panel, panelMaterial, picture,
    setBacklight(level) { panelMaterial.shader = PANEL_FN.with({ Backlight: level }, { Picture: picture }); },
  };
}
