// The user's workspace: a folder of projects, each one PocketJS app for the
// Tab5 (pocket.app.json, main.tsx, worker.ts). The framework and Solid are
// linked once at the workspace root, where every project resolves them.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KIT, M5, POCKETJS, ROOT, WORKSPACE } from "./paths.ts";

export interface ProjectInfo {
  name: string;
  path: string;
  title: string;
  id: string;
  modified: number;
  lesson?: string;
}

const TSCONFIG = {
  compilerOptions: {
    target: "ESNext", module: "ESNext", moduleResolution: "bundler", lib: ["ESNext"], jsx: "preserve", jsxImportSource: "solid-js",
    strict: true, noEmit: true, allowImportingTsExtensions: true, verbatimModuleSyntax: true, skipLibCheck: true, types: [],
  },
  exclude: ["node_modules", "**/.build"],
};

function link(target: string, path: string): void {
  try {
    if (lstatSync(path)) rmSync(path, { recursive: true, force: true });
  } catch { /* nothing there */ }
  symlinkSync(target, path);
}

/** Creates the workspace, or brings its links and guides up to date. */
export function ensureWorkspace(): void {
  mkdirSync(join(WORKSPACE, "node_modules", "@pocketjs"), { recursive: true });
  link(POCKETJS, join(WORKSPACE, "node_modules", "@pocketjs", "framework"));
  link(join(M5, "node_modules", "solid-js"), join(WORKSPACE, "node_modules", "solid-js"));
  writeFileSync(join(WORKSPACE, "tsconfig.json"), JSON.stringify(TSCONFIG, null, 2) + "\n");
  for (const guide of ["AGENTS.md"]) {
    const source = join(KIT, guide);
    if (existsSync(source)) {
      cpSync(source, join(WORKSPACE, guide));
      cpSync(source, join(WORKSPACE, "CLAUDE.md"));
    }
  }
  if (existsSync(join(KIT, "docs"))) cpSync(join(KIT, "docs"), join(WORKSPACE, "docs"), { recursive: true });
}

export function projectPath(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(name)) throw new Error(`A project's name is lower-case letters, digits and dashes: ${name}`);
  return join(WORKSPACE, name);
}

export function listProjects(): ProjectInfo[] {
  if (!existsSync(WORKSPACE)) return [];
  const projects: ProjectInfo[] = [];
  for (const name of readdirSync(WORKSPACE)) {
    const path = join(WORKSPACE, name), manifest = join(path, "pocket.app.json");
    if (!existsSync(manifest)) continue;
    try {
      const json = JSON.parse(readFileSync(manifest, "utf8"));
      let lesson: string | undefined;
      try { lesson = JSON.parse(readFileSync(join(path, ".bench.json"), "utf8")).lesson; } catch { /* a free project */ }
      projects.push({ name, path, title: json.title ?? name, id: json.id ?? name, modified: statSync(manifest).mtimeMs, lesson });
    } catch { /* not a project */ }
  }
  return projects.sort((a, b) => b.modified - a.modified);
}

export function templates(): string[] {
  const dir = join(KIT, "templates");
  return existsSync(dir) ? readdirSync(dir).filter(name => existsSync(join(dir, name, "pocket.app.json"))) : [];
}

/** A new project from a template of the kit; the name is made unique. */
export function createProject(template: string, wanted: string, options: { title?: string; lesson?: string } = {}): ProjectInfo {
  const source = join(KIT, "templates", template);
  if (!existsSync(join(source, "pocket.app.json"))) throw new Error(`No template ${template}`);
  ensureWorkspace();
  let name = wanted, n = 2;
  while (existsSync(projectPath(name))) name = `${wanted}-${n++}`;
  const path = projectPath(name);
  cpSync(source, path, { recursive: true });
  // Every project carries the kit's drivers and UI helpers as its own files: the agent reads them, changes them, and they ship with the app.
  for (const part of ["drivers", "ui"]) {
    if (existsSync(join(KIT, part)) && !existsSync(join(path, part))) cpSync(join(KIT, part), join(path, part), { recursive: true });
  }
  const manifestPath = join(path, "pocket.app.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  manifest.id = `bench.local.${name}`;
  manifest.app.output = name;
  if (options.title) manifest.title = options.title;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(join(path, ".bench.json"), JSON.stringify({ template, lesson: options.lesson, created: new Date().toISOString() }, null, 2) + "\n");
  writeFileSync(join(path, ".gitignore"), ".build/\n");
  return { name, path, title: manifest.title, id: manifest.id, modified: Date.now(), lesson: options.lesson };
}

/** The project's source files, for the code panel: path relative to the project, newest first. */
export function projectFiles(path: string): { path: string; bytes: number; modified: number }[] {
  const files: { path: string; bytes: number; modified: number }[] = [];
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".") || name === "node_modules") continue;
      const full = join(dir, name), stat = statSync(full);
      if (stat.isDirectory()) walk(full, `${prefix}${name}/`);
      else if (/\.(tsx?|json|md|png)$/.test(name)) files.push({ path: `${prefix}${name}`, bytes: stat.size, modified: stat.mtimeMs });
    }
  };
  walk(path, "");
  return files;
}
void ROOT;
