// The room. (First cut: enough of it to see the Tab5's screen in the path tracer.)
import { BoxGeometry, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, RectAreaLight, Scene, SkyColor, StreamTexture, Vector3 } from "@threert/scene";
import { defineGame, host } from "@threert/gameplay";

const SCREEN = new StreamTexture("tab5", 640, 360);

export default defineGame({
  state: {},
  pointer: "free",
  setup() {
    const scene = new Scene();
    scene.environment = new SkyColor(0x000000, 0);
    const box = (id: string, size: [number, number, number], at: [number, number, number], color: number, roughness = 0.8) => {
      const mesh = new Mesh(new BoxGeometry(...size), new MeshStandardMaterial({ name: id, color, roughness }));
      mesh.id = id; mesh.position.set(...at); scene.add(mesh);
      return mesh;
    };
    box("floor", [6, 0.1, 6], [0, -0.05, 0], 0x7a6a58, 0.6);
    box("wall", [6, 3, 0.1], [0, 1.5, -1.2], 0xb9bcc0);
    box("bench", [1.8, 0.04, 0.8], [0, 0.76, -0.6], 0x2f7a5a, 0.7);
    box("tab5", [0.128, 0.08, 0.012], [0, 0.86, -0.6], 0xf2f2f2, 0.5);
    const screen = new Mesh(new PlaneGeometry(0.1107, 0.0623), new MeshStandardMaterial({ name: "screen", color: 0x000000, roughness: 0.2, emissive: 0xffffff, emissiveMap: SCREEN, emissiveIntensity: 300 }));
    screen.id = "screen";
    screen.position.set(-0.003, 0.86, -0.6 + 0.0062);
    scene.add(screen);
    const light = new RectAreaLight(0xfff1dc, 9000, 1.2, 0.3);
    light.position.set(0, 2.6, -0.3);
    light.lookAt(0, 0, -0.3);
    scene.add(light);
    const camera = new PerspectiveCamera(38, 16 / 9, 0.02, 50);
    camera.position.set(0.1, 1.0, -0.1);
    camera.lookAt(new Vector3(0, 0.86, -0.6));
    scene.add(camera);
    return { scene, camera };
  },
  handlers: {},
  frame(f) {
    if (f.input.pressed("Mouse0")) host.post({ t: "ui.click", u: f.input.pointer.u, v: f.input.pointer.v });
  },
});
