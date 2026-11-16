// Boots the pocket-m5 unit-swap sample against the virtual board and writes frames as PNGs.
//   bun src/smoke.ts [seconds]
import { join, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { Board, Tab5, boardBus, portABus, SCREEN } from "./sim/tab5.ts";
import { env3 } from "./units/env3.ts";
import { sonic } from "./units/sonic.ts";
import { encodePng } from "./png.ts";

const m5 = resolve(import.meta.dir, "../../vendor/pocket-m5");
const out = join(m5, ".pocket-build/apps/unit-swap");
const manifest = await Bun.file(join(m5, "apps/unit-swap/pocket.app.json")).json();
const buses = { sys: boardBus(), porta: portABus() };
const board = new Board();
const tab5 = new Tab5({
  build: { js: join(out, "unit-swap.js"), pak: join(out, "unit-swap.pak"), workerJs: join(out, "unit-swap.worker.js"), manifest },
  buses, board, log: line => console.log(`[${(line.at / 1e6).toFixed(2)}s ${line.domain}] ${line.text}`),
});
await tab5.boot();
const shots = resolve(import.meta.dir, "../../.build/smoke");
mkdirSync(shots, { recursive: true });
const seconds = Number(process.argv[2] ?? 12);
const unit = env3.create();
let second: ReturnType<typeof sonic.create> | undefined;
const started = performance.now();
for (let frame = 0; frame < seconds * 30; frame++) {
  if (frame === 45) { for (const chip of unit.chips) buses.porta.attach(chip, tab5.now); console.log("-- ENV III plugged in"); }
  if (frame === 150) unit.set("celsius", 38, tab5.now);
  if (frame === 240) { for (const chip of unit.chips) buses.porta.detach(chip); console.log("-- ENV III pulled"); }
  if (frame === 270) { second = sonic.create(); for (const chip of second.chips) buses.porta.attach(chip, tab5.now); second.set("millimetres", 235, tab5.now); console.log("-- Ultrasonic plugged in"); }
  if (!(await tab5.frame())) { console.log("FAILED", tab5.failure); break; }
  if (frame % 30 === 29) await Bun.write(join(shots, `f${String(frame + 1).padStart(4, "0")}.png`), encodePng(tab5.pixels(), SCREEN.width, SCREEN.height));
}
const elapsed = performance.now() - started;
console.log(`${tab5.frames} frames in ${elapsed.toFixed(0)} ms (${(elapsed / tab5.frames).toFixed(2)} ms a frame), ${tab5.workerTurns()} worker turns, ext-5v ${board.switches["ext-5v"]}`);
