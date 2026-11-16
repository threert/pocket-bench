// Look development for the second workstation: the shell, the main bench and the Tab5 for scale, then the station.
//   vendor/bin/bun tools/look.ts room --game room/decor/station.preview.game.ts --spp 96
import { PerspectiveCamera, Scene, SkyColor, Vector3 } from "@threert/scene";
import { defineGame } from "@threert/gameplay";
import { buildBench } from "../bench.ts";
import { VIEWS } from "../layout.ts";
import { buildShell } from "../shell.ts";
import { buildTab5 } from "../tab5.ts";
import { buildStation } from "./station.ts";

export default defineGame({
  state: {},
  pointer: "free",
  setup() {
    const scene = new Scene();
    scene.environment = new SkyColor(0x000000, 0);
    buildShell(scene);
    buildBench(scene);
    buildTab5(scene);
    buildStation(scene);
    const view = VIEWS.room!;
    const camera = new PerspectiveCamera(view.fov, 16 / 10, 0.02, 60);
    camera.position.set(...view.position);
    camera.lookAt(new Vector3(...view.target));
    camera.setManualExposure(7.7);
    scene.add(camera);
    return { scene, camera, options: { name: "pocket-bench-station", preset: "preview" as const, width: 1440, height: 900, overrides: { native: { maxBounces: 6 } } } };
  },
  handlers: {},
  frame() {},
});
