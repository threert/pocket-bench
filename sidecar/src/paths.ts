// Where things are. The sidecar runs from the repository in development and
// from the app's Resources when it is packaged (POCKET_BENCH_ROOT).
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const ROOT = resolve(process.env.POCKET_BENCH_ROOT ?? join(import.meta.dir, "../.."));
export const M5 = join(ROOT, "vendor/pocket-m5");
export const POCKETJS = join(M5, "third_party/pocketjs");
export const HOST_CONFIG = join(M5, "programs/m5stack-tab5/pocket.host.config.ts");
export const BUN = process.execPath;
/** The user's projects. */
export const WORKSPACE = resolve(process.env.POCKET_BENCH_HOME ?? join(homedir(), "PocketBench"));
export const KIT = join(ROOT, "kit");
