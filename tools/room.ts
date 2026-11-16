// Bundles the room (room/bench.game.ts) with the engine's bundler: one script for the renderer's script runtime.
//   bun tools/room.ts [--watch]
import { watch } from "node:fs";
import { join, resolve } from "node:path";
import { bundleGame } from "../engine/tools/bundle-game.ts";

const root = resolve(import.meta.dir, "..");
const source = join(root, "room/bench.game.ts"), out = join(root, ".build/room.js");
async function build() {
  try {
    const result = await bundleGame(source, out);
    console.log(`room: ${(result.bytes / 1024).toFixed(0)} KiB in ${result.ms.toFixed(0)} ms`);
    // A running app reloads the room when the sidecar tells it to.
    try {
      const { port } = await Bun.file(join(process.env.POCKET_BENCH_HOME ?? join(process.env.HOME!, "PocketBench"), ".bench/server.json")).json();
      await fetch(`http://127.0.0.1:${port}/api/send`, { method: "POST", body: JSON.stringify({ to: "app", message: { t: "app.reload-room", bundle: out } }) });
    } catch { /* no sidecar */ }
  } catch (error) {
    console.error(String(error instanceof Error ? error.message : error));
  }
}
await build();
if (process.argv.includes("--watch")) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(join(root, "room"), { recursive: true }, () => { clearTimeout(timer); timer = setTimeout(build, 150); });
}
