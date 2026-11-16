// Look development: bundles the room and renders named views offline with the engine's renderer.
//   bun tools/look.ts [view ...] [--spp 96] [--width 1440 --height 900]      views: layout.ts VIEWS, or name=JSON
import { $ } from "bun";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";
import { VIEWS } from "../room/layout.ts";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1]! : fallback; };
const flags = new Set(["--spp", "--width", "--height", "--game", "--time"]);
const names = args.filter((arg, i) => !arg.startsWith("--") && !flags.has(args[i - 1] ?? ""));
const game = option("--game", "room/bench.game.ts");
const bundle = join(root, ".build/look.js");
const built = await bundleGame(join(root, game), bundle);
console.log(`bundle ${(built.bytes / 1024).toFixed(0)} KiB`);
mkdirSync(join(root, ".build/look"), { recursive: true });
for (const name of names.length ? names : ["bench"]) {
  const [key, json] = name.includes("=") ? [name.slice(0, name.indexOf("=")), name.slice(name.indexOf("=") + 1)] : [name, undefined];
  const view = json ? JSON.parse(json) : VIEWS[key!];
  if (!view) { console.error(`no view ${key}`); continue; }
  const out = join(root, `.build/look/${key}.png`);
  const started = performance.now();
  const run = await $`${join(root, "engine/renderer/target/release/threert-render")} render ${bundle} -o ${out} --assets ${root} --presets ${join(root, "engine/presets")} --spp ${option("--spp", "96")} --width ${option("--width", "1440")} --height ${option("--height", "900")} --camera ${JSON.stringify(view)} ${args.includes("--time") ? ["--time", option("--time", "0")] : []}`.quiet().nothrow();
  if (run.exitCode !== 0) { console.error(run.stderr.toString().split("\n").slice(-12).join("\n")); process.exit(1); }
  console.log(`${key}: ${out} (${((performance.now() - started) / 1000).toFixed(1)} s)`);
}
