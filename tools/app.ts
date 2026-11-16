// Builds the app: the room's bundle, the Rust core, then the Xcode project (xcodegen) and the app itself.
//   bun tools/app.ts [--run] [--no-core]
import { $ } from "bun";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const args = process.argv.slice(2);
// Printed surfaces first: the room's textures are files.
await $`${process.execPath} tools/unit-art.ts`.cwd(root).quiet();
await $`${process.execPath} tools/quest-art.ts`.cwd(root).quiet();
await $`${process.execPath} tools/art.ts`.cwd(root);
await $`${process.execPath} tools/room.ts`.cwd(root);
if (!args.includes("--no-core")) await $`cargo build --release`.cwd(join(root, "core")).env({ ...process.env, PATH: `${process.env.HOME}/.cargo/bin:${process.env.PATH}` });
await $`xcodegen generate --quiet`.cwd(join(root, "app"));
const build = await $`xcodebuild -project PocketBench.xcodeproj -scheme PocketBench -configuration Release -derivedDataPath ${join(root, ".build/xcode")} build`.cwd(join(root, "app")).quiet().nothrow();
if (build.exitCode !== 0) {
  const text = build.stdout.toString() + build.stderr.toString();
  console.error(text.split("\n").filter(line => /error:|warning: unre|BUILD FAILED/.test(line)).slice(0, 40).join("\n"));
  process.exit(1);
}
const app = join(root, ".build/xcode/Build/Products/Release/Pocket Bench.app");
console.log(app);
if (args.includes("--run")) await $`open -n ${app}`;
