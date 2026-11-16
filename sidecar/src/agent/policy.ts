// What a coding agent may do without asking the user.
//
//   write   files under the open project (not its .git, agent settings or .bench.json)
//   read    files anywhere in the workspace, and in the framework the workspace links to
//   run     `bench ...`, and a short list of commands that only read, on paths it may read
//
// Everything else (other commands, the network, paths outside the workspace)
// is the user's decision. The same rules answer the agent's permission
// requests (`decide`) and confine the file methods the bridge serves itself
// (`readTextFile`, `writeTextFile`). Nothing here trusts a tool call's title.
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path";
import { homedir } from "node:os";

export interface Scope {
  /** The open project, the agent's working directory. */
  project: string;
  workspace: string;
  writeRoots: string[];
  readRoots: string[];
  /** The `bench` launcher, which may also be run by its full path. */
  bench?: string;
}

/** Folder and file names an agent does not change on its own: they decide what runs or what is allowed. */
const GUARDED = new Set([".git", ".claude", ".codex", ".cursor", ".vscode", ".mcp.json", ".bench.json", "node_modules"]);

/** The path with every link on the way resolved; the part that does not exist yet is kept as written. */
export function real(path: string): string {
  let head = resolve(path), tail = "";
  for (;;) {
    try { return tail ? join(realpathSync(head), tail) : realpathSync(head); } catch { /* not there: try the parent */ }
    const parent = dirname(head);
    if (parent === head) return resolve(path);
    tail = tail ? join(basename(head), tail) : basename(head);
    head = parent;
  }
}

export function inside(root: string, path: string): boolean {
  return path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
}

export function makeScope(project: string, workspace: string, readAlso: string[] = [], bench?: string): Scope {
  const projectReal = real(project), workspaceReal = real(workspace);
  return {
    project: projectReal, workspace: workspaceReal, writeRoots: [projectReal],
    readRoots: [workspaceReal, ...readAlso.filter(existsSync).map(real)], bench,
  };
}

export type Access = "write" | "read" | "none";

/** What the agent may do with a file. A relative path is taken from `cwd`. */
export function access(scope: Scope, path: string, cwd = scope.project): Access {
  if (!path || path.includes("\0")) return "none";
  const expanded = path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
  if (expanded.startsWith("~")) return "none";
  const target = real(isAbsolute(expanded) ? expanded : join(cwd, expanded));
  for (const root of scope.writeRoots) {
    if (!inside(root, target)) continue;
    const guarded = target.slice(root.length).split(sep).some(part => GUARDED.has(part));
    return guarded ? "read" : "write";
  }
  return scope.readRoots.some(root => inside(root, target)) ? "read" : "none";
}

// ----- commands -----

const SHELLS = new Set(["sh", "bash", "zsh", "/bin/sh", "/bin/bash", "/bin/zsh"]);

/** The command line of an execute tool call, from the raw input the agents send. */
export function commandOf(rawInput: unknown): string | null {
  if (!rawInput || typeof rawInput !== "object") return null;
  const input = rawInput as Record<string, unknown>;
  const value = input.command ?? input.cmd;
  // Codex wraps some command lines in a shell: ["/bin/zsh", "-lc", "<line>"], or the same as one string.
  const wrapped = (parts: string[]) => parts.length === 3 && SHELLS.has(parts[0]!) && /^-l?c$/.test(parts[1]!);
  if (typeof value === "string") {
    const words = /^\S*sh -l?c /.test(value) ? parseCommand(value) : null;
    return words?.length === 1 && wrapped(words[0]!) ? words[0]![2]! : value;
  }
  if (Array.isArray(value) && value.length && value.every(part => typeof part === "string")) {
    const parts = value as string[];
    if (wrapped(parts)) return parts[2]!;
    return parts.every(part => /^[\w@%+=:,./-]+$/.test(part)) ? parts.join(" ") : null;
  }
  return null;
}

/** Splits a command line at `&&`, `||`, `;` and `|` into words. Null when it holds anything a shell would expand or redirect. */
export function parseCommand(line: string): string[][] | null {
  const text = line.replace(/(^|\s)2>&1(?=\s|$)/g, "$1").trim();
  const segments: string[][] = [];
  let words: string[] = [], word = "", open = false, quote = "";
  const endWord = () => { if (open) words.push(word); word = ""; open = false; };
  const endSegment = () => { endWord(); if (!words.length) return false; segments.push(words); words = []; return true; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) { quote = ""; continue; }
      if (quote === '"' && (c === "$" || c === "`" || c === "\\")) return null;
      word += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; open = true; continue; }
    if (c === " " || c === "\t") { endWord(); continue; }
    if (c === ";") { if (!endSegment()) return null; continue; }
    if (c === "&" || c === "|") {
      if (c === "&" && text[i + 1] !== "&") return null;
      if (text[i + 1] === c) i++;
      if (!endSegment()) return null;
      continue;
    }
    if ("$`<>(){}\\\n\r#!".includes(c)) return null;
    word += c; open = true;
  }
  if (quote || !endSegment()) return null;
  return segments;
}

/** Commands that only read. The value says which of their arguments would make them do more. */
const READERS: Record<string, (args: string[]) => boolean> = {
  ls: () => true, cat: () => true, head: () => true, tail: () => true, wc: () => true, nl: () => true,
  grep: () => true, egrep: () => true, fgrep: () => true, pwd: () => true, which: () => true, file: () => true,
  stat: () => true, diff: () => true, uniq: () => true, cut: () => true, echo: () => true, true: () => true,
  date: () => true, basename: () => true, dirname: () => true, realpath: () => true,
  rg: args => !args.some(arg => arg.startsWith("--pre")),
  sort: args => !args.some(arg => arg.startsWith("-o") || arg.startsWith("--output")),
  tree: args => !args.some(arg => arg.startsWith("-o")),
  find: args => !args.some(arg => /^-(exec|execdir|ok|okdir|delete|fprint|fprintf|fls)$/.test(arg)),
  // Only the print-some-lines form: sed -n '10,40p' file.
  sed: args => args[0] === "-n" && /^\d+(,(\d+|\$))?p$/.test(args[1] ?? "") && args.length <= 3,
};

/** True when the command line is `bench ...` or reads inside what the agent may read, and nothing else. */
export function commandAllowed(line: string, scope: Scope, cwd = scope.project): boolean {
  const segments = parseCommand(line);
  if (!segments) return false;
  let here = cwd;
  if (access(scope, here) === "none") return false;
  for (const [command, ...args] of segments as [string, ...string[]][]) {
    if (/^\w+=/.test(command)) return false;
    if (command === "bench" || (scope.bench !== undefined && command === scope.bench)) continue;
    if (command === "cd") {
      if (args.length !== 1 || access(scope, args[0]!, here) === "none") return false;
      here = real(isAbsolute(args[0]!) ? args[0]! : join(here, args[0]!));
      continue;
    }
    const reader = READERS[command];
    if (!reader || !reader(args)) return false;
    if (command === "sed") { if (args[2] !== undefined && access(scope, args[2], here) === "none") return false; continue; }
    for (const arg of args) {
      let path = arg;
      if (arg.startsWith("-")) {
        if (!arg.includes("/") && !arg.includes("~")) continue;
        if (!arg.includes("=")) return false;
        path = arg.slice(arg.indexOf("=") + 1);
      }
      const pathLike = path.includes("/") || path.startsWith("~") || path === "..";
      if (pathLike && command !== "echo" && access(scope, path, here) === "none") return false;
    }
  }
  return true;
}

// ----- permission requests -----

/** The parts of an ACP tool call the rules look at. */
export interface ToolAsk {
  kind?: string | null;
  rawInput?: unknown;
  locations?: { path: string }[] | null;
  content?: unknown[] | null;
}

/** Every file a tool call names: its locations, its raw input and its diffs. */
export function pathsOf(call: ToolAsk): string[] {
  const paths = new Set<string>();
  for (const location of call.locations ?? []) if (typeof location?.path === "string") paths.add(location.path);
  const input = call.rawInput && typeof call.rawInput === "object" ? call.rawInput as Record<string, unknown> : {};
  for (const key of ["file_path", "path", "notebook_path", "filePath"]) if (typeof input[key] === "string") paths.add(input[key] as string);
  // Codex names the files of a patch as the keys of `changes`.
  if (input.changes && typeof input.changes === "object" && !Array.isArray(input.changes)) for (const key of Object.keys(input.changes)) paths.add(key);
  for (const block of call.content ?? []) {
    const entry = block as { type?: string; path?: unknown };
    if (entry?.type === "diff" && typeof entry.path === "string") paths.add(entry.path);
  }
  return [...paths];
}

export interface Verdict { allow: boolean; why: string }

export function decide(call: ToolAsk, scope: Scope): Verdict {
  const input = call.rawInput && typeof call.rawInput === "object" ? call.rawInput as Record<string, unknown> : {};
  const command = commandOf(call.rawInput);
  if (call.kind === "execute" || command !== null) {
    if (command === null) return { allow: false, why: "a command the bench cannot read" };
    const cwd = typeof input.cwd === "string" ? input.cwd : scope.project;
    return commandAllowed(command, scope, cwd)
      ? { allow: true, why: "bench or a read-only command" }
      : { allow: false, why: "a command other than bench" };
  }
  const paths = pathsOf(call);
  const levels = paths.map(path => access(scope, path));
  if (call.kind === "read" || call.kind === "search") {
    if (call.kind === "read" && !paths.length) return { allow: false, why: "a read without a path" };
    return levels.every(level => level !== "none")
      ? { allow: true, why: "reads inside the workspace" }
      : { allow: false, why: "reads outside the workspace" };
  }
  if (call.kind === "edit" || call.kind === "delete") {
    if (!paths.length) return { allow: false, why: "a change without a path" };
    return levels.every(level => level === "write")
      ? { allow: true, why: "changes inside the project" }
      : { allow: false, why: "changes outside the project" };
  }
  return { allow: false, why: `a ${call.kind ?? "tool"} call` };
}

/** The option that lets this one call through, when the agent offers one. */
export function allowOnce(options: { optionId: string; kind: string }[]): string | undefined {
  return options.find(option => option.kind === "allow_once")?.optionId;
}

// ----- the client's file methods -----

export class Refused extends Error {}

export function readTextFile(scope: Scope, params: { path: string; line?: number | null; limit?: number | null }): string {
  if (!isAbsolute(params.path)) throw new Refused("fs/read_text_file takes an absolute path");
  if (access(scope, params.path) === "none") throw new Refused(`${params.path} is outside the workspace`);
  const text = readFileSync(real(params.path), "utf8");
  if (params.line == null && params.limit == null) return text;
  const lines = text.split("\n"), first = Math.max(0, (params.line ?? 1) - 1);
  return lines.slice(first, params.limit == null ? undefined : first + params.limit).join("\n");
}

export function writeTextFile(scope: Scope, params: { path: string; content: string }): void {
  if (!isAbsolute(params.path)) throw new Refused("fs/write_text_file takes an absolute path");
  if (access(scope, params.path) !== "write") throw new Refused(`${params.path} is not a file of the project the agent may write`);
  const target = real(params.path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, params.content);
}
