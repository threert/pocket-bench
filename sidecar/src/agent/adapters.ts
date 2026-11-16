// The two coding agents and how each is started as an ACP agent on stdio.
//
//   Claude Code   @agentclientprotocol/claude-agent-acp, driving the user's `claude` (CLAUDE_CODE_EXECUTABLE)
//   Codex         @agentclientprotocol/codex-acp, driving `codex app-server` of the user's `codex` (CODEX_PATH)
//
// The adapters are installed once into <workspace>/.bench/agents with the
// project's Bun (without their optional packages: those are 700 MB of the
// agents' own binaries, which the user already has) and run with it; when
// the install fails, `npx -y <package>` is the fallback.
import { accessSync, constants, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { BUN, WORKSPACE } from "../paths.ts";
import type { AgentId, AgentInfo } from "./types.ts";

export interface Launch { command: string[]; env: Record<string, string> }

export interface AgentSpec {
  id: AgentId;
  name: string;
  /** Whether the agent can be started here, for the state. */
  detect(): Promise<AgentInfo>;
  /** The command that speaks ACP on stdio; `note` reports a slow step (the first install). */
  launch(note: (text: string) => void): Promise<Launch>;
  /** `_meta` of `session/new`. */
  sessionMeta?: Record<string, unknown>;
  /** The session mode the bridge selects: edits in the working directory without asking, the rest on request. */
  mode: string;
  /** Session config options to set, by category ("model", "thought_level"). */
  config?: Record<string, string | undefined>;
  /** What to tell the user when the agent answers that it needs a login. */
  login: string;
}

const PINNED = {
  claude: { pkg: "@agentclientprotocol/claude-agent-acp", version: "0.107.3" },
  codex: { pkg: "@agentclientprotocol/codex-acp", version: "2.6.0" },
} as const;

export const agentsDir = (): string => process.env.POCKET_BENCH_AGENTS_DIR ?? join(WORKSPACE, ".bench", "agents");
/** Where `installCli` puts the `bench` launcher. */
export const benchBin = (): string => join(WORKSPACE, ".bench", "bin");

/** Folders a command-line tool of the user is usually in. An app started from the Finder has none of them on its PATH. */
function userDirs(): string[] {
  const home = homedir();
  const dirs = [join(home, ".local/bin"), join(home, ".claude/local"), join(home, ".bun/bin"), join(home, ".npm-global/bin"),
    join(home, ".volta/bin"), join(home, ".cargo/bin"), "/opt/homebrew/bin", "/usr/local/bin"];
  try {
    const nvm = join(home, ".nvm/versions/node");
    const versions = readdirSync(nvm).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (versions[0]) dirs.push(join(nvm, versions[0], "bin"));
  } catch { /* no nvm */ }
  return dirs;
}

function searchPath(): string[] {
  const seen = new Set<string>();
  return [...(process.env.PATH ?? "").split(delimiter), ...userDirs()].filter(dir => dir && !seen.has(dir) && !!seen.add(dir));
}

export function findBinary(name: string): string | undefined {
  for (const dir of searchPath()) {
    const path = join(dir, name);
    try { accessSync(path, constants.X_OK); return path; } catch { /* not here */ }
  }
  return undefined;
}

/** The PATH of an agent's process: the `bench` command first, then the sidecar's own and the user's folders. */
export function agentPath(): string {
  return [benchBin(), ...searchPath().filter(dir => existsSync(dir))].join(delimiter);
}

async function versionOf(path: string): Promise<string | undefined> {
  try {
    const child = Bun.spawn([path, "--version"], { stdout: "pipe", stderr: "ignore", stdin: "ignore", env: agentEnv({}) });
    const timer = setTimeout(() => child.kill(), 8000);
    const text = await new Response(child.stdout).text();
    clearTimeout(timer);
    return /\d+\.\d+\.\d+[\w.-]*/.exec(text)?.[0];
  } catch { return undefined; }
}

/** Variables that tie a process to the Claude Code session the sidecar itself may have been started from. */
const SESSION_VARS = ["CLAUDECODE", "CLAUDE_PID", "CLAUDE_EFFORT", "CLAUDE_AGENT_SDK_VERSION", "AI_AGENT", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ATTENDED", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS", "CLAUDE_CODE_STARTUP_FAILURE_RESULTS", "CLAUDE_CODE_SSE_PORT"];

export function agentEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !SESSION_VARS.includes(key)) env[key] = value;
  return { ...env, PATH: agentPath(), POCKET_BENCH_HOME: WORKSPACE, ...extra };
}

const installs = new Map<string, Promise<string[]>>();

/** The command that runs an adapter: its installed entry with Bun, or npx. */
function adapter(id: AgentId, note: (text: string) => void): Promise<string[]> {
  const { pkg, version } = PINNED[id];
  const known = installs.get(id);
  if (known) return known;
  const task = (async () => {
    const dir = agentsDir(), home = join(dir, "node_modules", pkg);
    const entry = (): string | undefined => {
      try {
        const manifest = JSON.parse(readFileSync(join(home, "package.json"), "utf8"));
        if (manifest.version !== version) return undefined;
        const bin = typeof manifest.bin === "string" ? manifest.bin : Object.values(manifest.bin ?? {})[0];
        return typeof bin === "string" && existsSync(join(home, bin)) ? join(home, bin) : undefined;
      } catch { return undefined; }
    };
    let path = entry();
    if (!path) {
      note(`Installing ${pkg} ${version} (once)`);
      mkdirSync(dir, { recursive: true });
      if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "pocket-bench-agents", private: true }) + "\n");
      const child = Bun.spawn([BUN, "add", "--exact", "--omit", "optional", `${pkg}@${version}`], { cwd: dir, stdout: "ignore", stderr: "pipe", stdin: "ignore" });
      const timer = setTimeout(() => child.kill(), 240_000);
      const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited]);
      clearTimeout(timer);
      path = entry();
      if (!path) {
        const npx = findBinary("npx");
        if (!npx) throw new Error(`Could not install ${pkg} (bun add exited with ${code}): ${stderr.trim().split("\n").at(-1) ?? ""}`);
        note(`Could not install ${pkg}: running it with npx`);
        return [npx, "-y", `${pkg}@${version}`];
      }
    }
    return [BUN, path];
  })();
  installs.set(id, task);
  // A failed install is tried again at the next start.
  task.catch(() => installs.delete(id));
  return task;
}

function agentSpec(options: { id: AgentId; name: string; binary: string; override: string; mode: string; login: string; missing: string;
  extraEnv?: Record<string, string>; sessionMeta?: Record<string, unknown> }): AgentSpec {
  const { id, name } = options;
  const upper = id.toUpperCase();
  const locate = () => {
    const given = process.env[options.override];
    return given && existsSync(given) ? given : findBinary(options.binary);
  };
  return {
    id, name, mode: options.mode, login: options.login, sessionMeta: options.sessionMeta,
    config: { model: process.env[`POCKET_BENCH_${upper}_MODEL`], thought_level: process.env[`POCKET_BENCH_${upper}_EFFORT`] },
    async detect() {
      const path = locate();
      if (!path) return { id, name, installed: false, note: options.missing };
      const version = await versionOf(path);
      return { id, name, installed: true, ...(version ? { version } : {}), note: path };
    },
    async launch(note) {
      const path = locate();
      if (!path) throw new Error(options.missing);
      return { command: await adapter(id, note), env: agentEnv({ [options.override]: path, ...options.extraEnv }) };
    },
  };
}

export const claude: AgentSpec = agentSpec({
  id: "claude", name: "Claude Code", binary: "claude", override: "CLAUDE_CODE_EXECUTABLE",
  // Edits in the working directory go through; a command or a file elsewhere comes to the bridge's rules.
  mode: "acceptEdits",
  missing: "Claude Code is not installed: see https://claude.com/claude-code, then run `claude` once to log in",
  login: "Claude Code is not logged in: run `claude` in a terminal and log in",
  sessionMeta: {
    claudeCode: {
      options: {
        // Takes the bypass mode out of this session, whatever the user's settings allow.
        allowDangerouslySkipPermissions: false,
        allowedTools: ["Bash(bench:*)"],
      },
    },
  },
});

export const codex: AgentSpec = agentSpec({
  id: "codex", name: "Codex", binary: "codex", override: "CODEX_PATH",
  // The workspace-write sandbox with approval on request, the user as the reviewer.
  mode: "workspace-write",
  missing: "Codex is not installed: npm i -g @openai/codex, then run `codex login`",
  login: "Codex is not logged in: run `codex login` in a terminal",
  extraEnv: { INITIAL_AGENT_MODE: "workspace-write", NO_BROWSER: "1" },
});

export const AGENTS: Record<AgentId, AgentSpec> = { claude, codex };
