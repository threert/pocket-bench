// Imported first by every test here: the workspace of a test is a folder of
// its own under the system's temporary directory, never the user's
// ~/PocketBench. (paths.ts reads POCKET_BENCH_HOME when it is first loaded.)
import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary = realpathSync(tmpdir());
const given = process.env.POCKET_BENCH_HOME;
if (!given || !(given.startsWith(temporary) || given.startsWith("/tmp/") || given.startsWith("/private/tmp/"))) {
  process.env.POCKET_BENCH_HOME = mkdtempSync(join(temporary, "pb-lessons-test-"));
}
export const TEST_HOME = process.env.POCKET_BENCH_HOME!;
