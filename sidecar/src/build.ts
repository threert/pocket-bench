// Compiles a project for the Tab5's host contract (tab5-home) with the
// PocketJS compiler of the pinned pocket-m5, the same command that builds an
// app for the board. The simulator runs the bundles the compiler writes
// before it turns them into bytecode; the .pocket file next to them is what
// a Tab5 installs.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUN, HOST_CONFIG, POCKETJS } from "./paths.ts";
import type { AppBuild } from "./sim/tab5.ts";

export interface BuildProblem { file?: string; line?: number; column?: number; message: string }
export interface BuildResult {
  ok: boolean;
  ms: number;
  build?: AppBuild;
  /** The compiler's output, colours removed. */
  output: string;
  problems: BuildProblem[];
  /** The installable package. */
  pocket?: string;
}

const ANSI = /\u001b\[[0-9;]*m/g;

export function parseProblems(output: string): BuildProblem[] {
  const problems: BuildProblem[] = [];
  for (const line of output.split("\n")) {
    const ts = /^(.+?):(\d+):(\d+) (TS\d+: .+)$/.exec(line.trim());
    if (ts) { problems.push({ file: ts[1], line: Number(ts[2]), column: Number(ts[3]), message: ts[4]! }); continue; }
    const located = /^(?:error: )?(.+?\.(?:tsx?|json)):(\d+):(\d+):? (.+)$/.exec(line.trim());
    if (located) { problems.push({ file: located[1], line: Number(located[2]), column: Number(located[3]), message: located[4]! }); continue; }
    const plain = /^(?:PocketJS: |error: )(.+)$/.exec(line.trim());
    if (plain && !/^script ".*" exited/.test(plain[1]!)) problems.push({ message: plain[1]! });
  }
  return problems;
}

export async function buildProject(project: string): Promise<BuildResult> {
  const started = performance.now();
  const manifestPath = join(project, "pocket.app.json");
  if (!existsSync(manifestPath)) return { ok: false, ms: 0, output: "", problems: [{ message: "The project has no pocket.app.json" }] };
  let manifest: AppBuild["manifest"];
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    return { ok: false, ms: 0, output: String(error), problems: [{ file: manifestPath, message: `pocket.app.json is not JSON: ${error}` }] };
  }
  const output = manifest.app?.output;
  if (typeof output !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(output)) {
    return { ok: false, ms: 0, output: "", problems: [{ file: manifestPath, message: "app.output must be a lower-case name (letters, digits, dashes)" }] };
  }
  const outdir = join(project, ".build", "out");
  const pocket = join(project, ".build", `${output}.pocket`);
  const child = Bun.spawn([BUN, join(POCKETJS, "tools/pocket.ts"), "compile", "--manifest", manifestPath, "--host-config", HOST_CONFIG,
    "--project-root", project, "--outdir", outdir, "--plan-dir", join(outdir, "plans"), "--output", pocket],
    { cwd: project, stdout: "pipe", stderr: "pipe", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  const text = `${stdout}${stderr}`.replace(ANSI, "");
  const ms = performance.now() - started;
  if (code !== 0) {
    const problems = parseProblems(text);
    return { ok: false, ms, output: text, problems: problems.length ? problems : [{ message: text.trim().split("\n").slice(-6).join("\n") || `the compiler exited with ${code}` }] };
  }
  const js = join(outdir, `${output}.js`), pak = join(outdir, `${output}.pak`), workerJs = join(outdir, `${output}.worker.js`);
  // The plan carries the worker declaration with the host's channel sizes resolved.
  let worker = manifest.domains?.worker;
  try {
    const plan = JSON.parse(readFileSync(join(outdir, "plans", "tab5-home", "plan.json"), "utf8"));
    worker = plan?.domains?.worker ?? worker;
  } catch { /* the manifest's declaration stands */ }
  return {
    ok: true, ms, output: text, problems: [], pocket,
    build: { js, pak: existsSync(pak) ? pak : undefined, workerJs: existsSync(workerJs) ? workerJs : undefined, manifest, worker },
  };
}
