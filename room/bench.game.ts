// The room: a hardware studio with an M5Stack Tab5 on the bench.
import { PerspectiveCamera, Scene, SkyColor, Vector3 } from "@threert/scene";
import { defineGame, host } from "@threert/gameplay";
import { buildBench } from "./bench.ts";
import { VIEWS } from "./layout.ts";
import { buildProps } from "./props.ts";
import { buildShell } from "./shell.ts";
import { buildTab5 } from "./tab5.ts";
import { buildUnits } from "./units.ts";
import { World, type QuestBoard, type RoomParts } from "./world.ts";
import { buildWall } from "./decor/wall.ts";
import { buildStation } from "./decor/station.ts";
import { buildInstruments } from "./decor/instruments.ts";

let parts: RoomParts | undefined;
let world: World | undefined;
/** What the app said before the first frame. */
const early: Record<string, unknown>[] = [];

for (const type of ["state", "sim", "room.refused", "room.do", "room.view"]) {
  host.on(type, message => {
    if (world) world.onMessage(message as Record<string, unknown>);
    else early.push(message as Record<string, unknown>);
  });
}

export default defineGame({
  state: {},
  pointer: "free",
  setup() {
    const scene = new Scene();
    scene.environment = new SkyColor(0x000000, 0);
    const { ceiling } = buildShell(scene);
    const bench = buildBench(scene);
    const tab5 = buildTab5(scene);
    const kit = buildUnits(scene);
    const props = buildProps(scene);
    const wall = buildWall(scene);
    buildStation(scene);
    buildInstruments(scene);
    const quests: QuestBoard[] = wall.quests.map(quest => ({ group: quest.group, center: quest.center, half: [0.115, 0.165, 0.02] }));
    const view = VIEWS.bench!;
    const camera = new PerspectiveCamera(view.fov, 16 / 10, 0.02, 60);
    camera.position.set(...view.position);
    camera.lookAt(new Vector3(...view.target));
    camera.setManualExposure(7.7);
    scene.add(camera);
    parts = { scene, camera, bench, tab5, kit, props, ceiling, quests };
    world = undefined;
    return { scene, camera, options: { name: "pocket-bench", preset: "preview" as const, width: 1440, height: 900, overrides: { native: { maxBounces: 6 } } } };
  },
  handlers: {},
  frame(f) {
    if (!parts) return;
    if (!world) {
      // (The scene and the camera of the frame are the ones setup made.)
      world = new World({ ...parts, scene: f.scene as Scene, camera: f.camera as PerspectiveCamera }, message => void host.post(message as { t: string }));
      for (const message of early.splice(0)) world.onMessage(message);
    }
    world.step(Math.min(f.dt, 0.1), f.input);
  },
});
