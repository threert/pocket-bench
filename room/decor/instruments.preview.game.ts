// Look development for room/decor/instruments.ts: the shell, the bench and the Tab5, then the instruments.
//   vendor/bin/bun tools/look.ts shelf='{"position":[0,1.25,0.35],"target":[0,1.08,-0.64],"fov":42}' --game room/decor/instruments.preview.game.ts
import { PerspectiveCamera, Scene, SkyColor, Vector3 } from "@threert/scene";
import { defineGame } from "@threert/gameplay";
import { buildBench } from "../bench.ts";
import { VIEWS } from "../layout.ts";
import { buildShell } from "../shell.ts";
import { buildTab5 } from "../tab5.ts";
import { buildInstruments } from "./instruments.ts";

export default defineGame({
  state: {},
  pointer: "free",
  setup() {
    const scene = new Scene();
    scene.environment = new SkyColor(0x000000, 0);
    buildShell(scene);
    buildBench(scene);
    buildTab5(scene);
    buildInstruments(scene);
    const view = VIEWS.bench!;
    const camera = new PerspectiveCamera(view.fov, 16 / 10, 0.02, 60);
    camera.position.set(...view.position);
    camera.lookAt(new Vector3(...view.target));
    camera.setManualExposure(7.7);
    scene.add(camera);
    return { scene, camera, options: { name: "pocket-bench-instruments", preset: "preview" as const, width: 1440, height: 900, overrides: { native: { maxBounces: 6 } } } };
  },
  handlers: {},
  frame() {},
});
