// A lesson's reference solution: kit/lessons/<id>/solution, a folder shaped
// like a project. `lesson.solution` copies it over the open project.
//
//   main.tsx, worker.ts, protocol.ts, any other file   copied as they are
//   pocket.app.json                                    not copied: only what an app's code depends on is taken
//                                                      from it (the worker's nodes and channels, the capabilities),
//                                                      so the project keeps its id, title and output name
//
// Nothing is deleted from the project, and its ui/ and drivers/ stay unless
// the solution brings files for them.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const solutionDir = (kit: string, lesson: string) => join(kit, "lessons", lesson, "solution");
export const hasSolution = (kit: string, lesson: string) => existsSync(join(solutionDir(kit, lesson), "main.tsx"));

interface Manifest {
  engine?: { capabilities?: { requires?: string[] } };
  domains?: { worker?: { entry?: string; nodes?: unknown[]; channels?: unknown[] } };
  [key: string]: unknown;
}

/** The fields of a solution's manifest that matter, laid over the project's. */
export function mergeManifest(project: Manifest, solution: Manifest): Manifest {
  const merged: Manifest = JSON.parse(JSON.stringify(project));
  const worker = solution.domains?.worker;
  if (worker) {
    merged.domains = { ...merged.domains, worker: { ...merged.domains?.worker, ...(worker.entry ? { entry: worker.entry } : {}), ...(worker.nodes ? { nodes: worker.nodes } : {}), ...(worker.channels ? { channels: worker.channels } : {}) } };
  }
  const requires = solution.engine?.capabilities?.requires;
  if (requires) {
    const all = [...new Set([...(merged.engine?.capabilities?.requires ?? []), ...requires])];
    merged.engine = { ...merged.engine, capabilities: { ...merged.engine?.capabilities, requires: all } };
  }
  return merged;
}

/** Copies the solution over the project. Returns the files written, relative to the project. */
export function applySolution(kit: string, lesson: string, project: string): string[] {
  const source = solutionDir(kit, lesson);
  if (!hasSolution(kit, lesson)) throw new Error(`The lesson ${lesson} has no solution (${source}/main.tsx)`);
  const written: string[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      if (name.startsWith(".")) continue;
      const full = join(dir, name), relative = `${prefix}${name}`;
      if (statSync(full).isDirectory()) { walk(full, `${relative}/`); continue; }
      const target = join(project, relative);
      if (relative === "pocket.app.json") {
        const merged = mergeManifest(JSON.parse(readFileSync(target, "utf8")), JSON.parse(readFileSync(full, "utf8")));
        writeFileSync(target, JSON.stringify(merged, null, 2) + "\n");
      } else {
        mkdirSync(dirname(target), { recursive: true });
        cpSync(full, target);
      }
      written.push(relative);
    }
  };
  walk(source, "");
  return written;
}
