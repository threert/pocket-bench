// The tests' own workspace. paths.ts reads POCKET_BENCH_HOME when it is first
// imported, so a test that builds a project imports this module before it
// imports anything of src/ that reaches paths.ts: a developer's real
// workspace is never written to.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const HOME = mkdtempSync(join(tmpdir(), "pb-test-home-"));
process.env.POCKET_BENCH_HOME = HOME;
