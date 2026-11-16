// The room's printed surfaces: every room/art/**/*.svg becomes room/assets/gen/<same path>.png (labels, panels,
// quest cards), rendered with the system's fonts. A file's width and height attributes are its texels.
//   bun tools/art.ts [--watch]
import { Glob } from "bun";
import { mkdirSync, statSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";

const root = resolve(import.meta.dir, "..");
// The rasteriser comes with the engine's checkout.
const sharp = createRequire(join(root, "engine/package.json"))("sharp") as typeof import("sharp");
const source = join(root, "room/art"), target = join(root, "room/assets/gen");
let made = 0;
for await (const file of new Glob("**/*.svg").scan(source)) {
  const from = join(source, file), to = join(target, file.replace(/\.svg$/, ".png"));
  if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs && !process.argv.includes("--all")) continue;
  mkdirSync(dirname(to), { recursive: true });
  await sharp(from, { density: 72 }).png({ compressionLevel: 9 }).toFile(to);
  ++made;
}
console.log(`art: ${made} rendered`);
