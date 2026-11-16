// What the Tab5 shows when no app runs: a still picture, drawn once from SVG.
import { createRequire } from "node:module";
import { join } from "node:path";
import { ROOT } from "./paths.ts";
import { SCREEN } from "./sim/tab5.ts";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="${SCREEN.width}" height="${SCREEN.height}" viewBox="0 0 640 360">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="#16212b"/><stop offset="1" stop-color="#090c10"/></radialGradient></defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <rect x="270" y="96" width="100" height="64" rx="9" fill="none" stroke="#3ddc97" stroke-width="3"/>
  <rect x="282" y="108" width="76" height="40" rx="3" fill="#3ddc97" fill-opacity="0.16"/>
  <circle cx="320" cy="174" r="3" fill="#3ddc97"/>
  <text x="320" y="218" text-anchor="middle" font-family="Helvetica Neue, Arial" font-weight="700" font-size="26" fill="#e6edf3" letter-spacing="1">Tab5 准备好了</text>
  <text x="320" y="248" text-anchor="middle" font-family="PingFang SC, Helvetica" font-size="15" fill="#8b98a8">挑一张任务卡，或者告诉 Agent 你想做什么</text>
  <text x="320" y="330" text-anchor="middle" font-family="Menlo, monospace" font-size="11" fill="#4d5a6a">PocketJS · ESP32-P4 · 1280 × 720</text>
</svg>`;

let cached: Uint8Array | undefined;

/** 640x360 RGBA, or undefined where the rasteriser is not installed. */
export async function idleFrame(): Promise<Uint8Array | undefined> {
  if (cached) return cached;
  try {
    // (No types here: the rasteriser is the engine checkout's, not a dependency of the sidecar.)
    const sharp = createRequire(join(ROOT, "engine/package.json"))("sharp") as (input: Buffer) => { ensureAlpha(): { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer }> } } };
    const { data } = await sharp(Buffer.from(SVG)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    cached = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    return cached;
  } catch {
    return undefined;
  }
}
