# The coding agent's bridge

The user types a request in the app's chat panel; Claude Code or Codex edits the files of the open project; the
bench rebuilds by itself; the agent checks its own work with the `bench` command. The bridge is the part of the
sidecar between the panel and the agent: `sidecar/src/agent/` and `sidecar/src/cli/bench.ts`.

## Processes

```
app (chat panel) ── WebSocket /app ── sidecar ── stdio, ACP ── adapter (Bun) ── the user's agent CLI
                                         ▲                                         │ shell
                                         └────────── HTTP 127.0.0.1 ──── bench ◄───┘
```

| Agent | Adapter (pinned in `adapters.ts`) | Started as | Agent binary | Mode |
| --- | --- | --- | --- | --- |
| Claude Code | `@agentclientprotocol/claude-agent-acp` 0.107.3 | `vendor/bin/bun <agents>/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js` | the user's `claude`, through `CLAUDE_CODE_EXECUTABLE` | `acceptEdits` (`session/set_mode`); `_meta.claudeCode.options = { allowDangerouslySkipPermissions: false, allowedTools: ["Bash(bench:*)"] }` on `session/new` |
| Codex | `@agentclientprotocol/codex-acp` 2.6.0, which runs `codex app-server` | `vendor/bin/bun <agents>/node_modules/@agentclientprotocol/codex-acp/dist/index.js` | the user's `codex`, through `CODEX_PATH` | `workspace-write` (`INITIAL_AGENT_MODE`): sandbox with the project writable, network off, approval on request by the user; `NO_BROWSER=1` |

- `<agents>` is `<workspace>/.bench/agents` (or `POCKET_BENCH_AGENTS_DIR`). An adapter is installed there at its
  first use with `bun add --exact --omit optional <package>@<version>` (87 MB for both; the optional packages are
  the agents' own binaries, 700 MB, which the user has). If the install fails, `npx -y <package>@<version>` runs it.
- The agent binaries are looked for on the sidecar's PATH and in the usual folders (`~/.local/bin`, `~/.bun/bin`,
  `/opt/homebrew/bin`, the newest nvm node, ...), since an app started from the Finder has a bare PATH.
  `CLAUDE_CODE_EXECUTABLE` and `CODEX_PATH` in the sidecar's environment override the search. The state says what
  was found (`agents[].installed`, `version`, `note` = the path, or what to install).
- The logins are the agents' own (Claude Code's keychain entry, `~/.codex`). The bridge reads no credential and
  changes no file of the user's Claude or Codex configuration.
- The adapter runs in its own process group with the project as its working directory, and PATH starting with
  `<workspace>/.bench/bin`, where `installCli()` writes the `bench` launcher at every sidecar start.
- One process and one ACP session for each (project, agent). It starts at the first prompt and stays between
  prompts. If it dies, the turn ends with an error item and the next prompt starts a new process, which resumes
  the session (`session/resume`) when the agent can. `agent.new` ends the selected agent's process and transcript.
  Opening another project, or closing it, ends both sessions. On sidecar exit every process group gets SIGTERM;
  if the sidecar is killed outright, the adapters end when their stdin closes (seen with `kill -9` and Codex).

## Protocol

The sidecar is an ACP v1 client built on `@agentclientprotocol/sdk` 2.7.0 (`client()`, `ndJsonStream`), a
dependency of `sidecar/package.json` (`vendor/bin/bun install` in `sidecar/`).

- `initialize` with `clientCapabilities: { fs: { readTextFile, writeTextFile }, terminal: false, session: { notices: {} } }`.
  Both adapters run commands themselves, so the bridge serves no `terminal/*`.
- `session/new { cwd: <project>, mcpServers: [] }`, then `session/set_mode` when the session is not in the mode
  above, then `session/set_config_option` for the optional overrides (see Debugging).
- `session/prompt` with one text block: the preamble, then the user's text. `session/cancel` on `agent.cancel`; an
  agent that has not ended the turn 10 s later is stopped.
- `fs/read_text_file` and `fs/write_text_file` are served by `policy.ts` under the rules below (neither adapter
  calls them today: Claude Code and Codex write files themselves, inside their own permission systems).

### The preamble

`preamble.ts` composes it for every prompt, about 60 to 150 words:

```
<bench>
Project "Unit Swap" in /Users/me/PocketBench/probe (your working directory). It runs on the simulated M5Stack Tab5 of Pocket Bench and is rebuilt when a file changes.
Units plugged into Port A: ENV III (env3-1, type env3, I2C 0x44 0x70).
<the `context` string of agent.prompt, verbatim: the lesson>
The last build failed:
  main.tsx:3 TS2304: Cannot find name 'x'.
The app stopped with a fault in ui: <message>
On your first turn read /Users/me/PocketBench/AGENTS.md. Finish every change by running `bench check` and fix what it reports.
</bench>
```

## Permissions

Two layers. The agent's own mode keeps the common path silent: edits in the working directory, `bench`, and
commands the agent itself classes as read-only never reach the bridge. What the agent does ask
(`session/request_permission`) is answered by `decide()` in `policy.ts`:

| The tool call | Answer |
| --- | --- |
| `edit` or `delete` whose every path is under the project, outside `.git`, `.claude`, `.codex`, `.cursor`, `.vscode`, `.mcp.json`, `.bench.json`, `node_modules` | allowed |
| `read` or `search` whose every path is in the workspace, or in the framework and Solid the workspace links to | allowed |
| `execute` of `bench ...`, or of commands that only read (`ls cat head tail wc grep rg find sed -n 'N,Mp' ...`) on paths that may be read; joined with `&&`, `||`, `;`, `|`; `cd` into a readable folder; `2>&1` | allowed |
| a command line with `$`, a backtick, a redirection, a subshell, `&`, an environment prefix; any other command; `fetch`; `move`; a path outside the workspace; a call without a path | the user is asked |

- Allowed means the agent's `allow_once` option is selected. The bridge never picks an "always" option and never
  uses a bypass mode: Claude Code's is taken out of the session, Codex's `agent-full-access` is never selected.
- Paths are resolved through links before they are compared, so a link out of the project does not carry its
  rights. A tool call's title is never part of the decision.
- Asked means a `permission` item with the agent's options; the status is `waiting` until `agent.permission
  {id, optionId}`. `agent.cancel`, the end of the turn or the death of the process answer it `cancelled`.
- The workspace's `docs/` is read-only like the rest of the workspace outside the project (the sidecar rewrites
  it from the kit at every start). `Scope.writeRoots` in `makeScope` is the one place to change that.
- With Codex the sandbox is the first wall: a command runs in it without a question, with the project (and the
  temporary folders) writable and no network. `bench` needs the loopback, so Codex asks to run it outside the
  sandbox, and the rule above answers.

## Messages

App → sidecar: `agent.select {agent}`, `agent.prompt {text, context?}`, `agent.cancel {}`, `agent.permission {id,
optionId}`, `agent.new {}`, `agent.history {}`. `agent.prompt` is answered at once; a refusal (no project, an empty
text, a turn still running) is an `error` reply.

Sidecar → app:

- `state.agent`: `{ selected, agents: [{ id, name, installed, version?, note? }], status: "idle" | "starting" |
  "working" | "waiting" | "error", error?, turn }`, for the selected agent's session.
- `agent.item { item }` upserts by `item.id`: `{ id, turn, kind: "user" | "text" | "thought" | "tool" | "plan" |
  "permission" | "notice" | "error", text?, title?, toolKind?: "read" | "edit" | "execute" | "search" | "fetch" |
  "think" | "other", status?: "pending" | "running" | "done" | "failed", path?, diff?: { path, added, removed },
  options?: [{ id, label, kind }], entries?: [{ text, status }], done? }`.
- `agent.delta { id, text }` appends to a `text` or `thought` item. The item arrives first, with the first chunk;
  it arrives once more with the whole text and `done: true` when the next thing starts or the turn ends.
- `agent.turn { turn, status: "started" | "ended", stopReason?, ms? }`. `stopReason` is the agent's (`end_turn`,
  `cancelled`, `max_tokens`, `max_turn_requests`, `refusal`) or `error`.
- `agent.history { items }`: the reply to `agent.history`, and also broadcast when the transcript on show is
  replaced: after `agent.select`, `agent.new`, and when the project changes.

Details the panel can rely on:

- Ids: `user-N`, `text-N`, `thought-N`, `notice-N`, `error-N`, `permission-N`, `tool-<the agent's tool call id>`,
  `plan-<turn>`. A tool item is created by the first report of the call and updated in place; a tool still
  `pending` or `running` when the turn ends becomes `failed`.
- Tool titles are made by `describeTool`: "Reading main.tsx", "Editing worker.ts", "Editing 3 files", "Running
  bench check", "Searching for onFrame", "Fetching docs.m5stack.com". `path` is set for a tool on one file inside
  the project. `diff` counts the lines of the diffs the agent reported (for Claude Code's Edit, of the replaced
  fragment).
- A permission item has `title` (as a tool title), `text` (the whole command line, or the paths) and `options`
  in the agent's order; `kind` is ACP's `allow_once`, `allow_always`, `reject_once` or `reject_always`. It ends as
  `done` when an allow option was chosen, else `failed`, with `done: true`.
- The transcript is kept in memory, 500 items for each session, and is gone when the sidecar exits.
- The messages carry the selected agent's session only. The other agent's session keeps running and recording;
  `agent.select` back shows it through `agent.history`.

## The `bench` command

`sidecar/src/cli/bench.ts`, reference in `kit/docs/bench-cli.md` (copied to `<workspace>/docs/`). The launcher
`<workspace>/.bench/bin/bench` is a three-line `sh` script that runs it with the project's Bun and
`POCKET_BENCH_HOME` set. It reads the port from `<workspace>/.bench/server.json` and uses `GET /api/state |
texts | logs | catalog | shot.png` and `POST /api/send | tap`: no route was added for it.

`bench check` does not use `GET /api/settled`: it polls `/api/state` until the phase is not `building`, then waits
for the restarted app's clock (`sim.at`) to start over and pass 1.2 s, so the texts are the new build's.
(`/api/settled` does not return when nothing is building after a file-change build: `Bench.timer` keeps the fired
timeout, see Limits.) `bench shot` writes only inside the open project.

## Tests and debugging

```
vendor/bin/bun test sidecar/test/agent        # the rules, the transcript, the bridge against a fake ACP agent
vendor/bin/bun sidecar/test/agent/live.ts --port 8741 --agent claude --prompt "..."   # one real turn, JSONL transcript
```

| Environment variable of the sidecar | Effect |
| --- | --- |
| `POCKET_BENCH_ACP_LOG=<file>` | Appends every JSON-RPC message (`>` to the agent, `<` from it), the adapters' stderr (`!`) and the bridge's own notes (`#`: spawn command, each permission decision and why). The file is created readable by its owner only: it holds file contents and the account the agent reports. |
| `POCKET_BENCH_CLAUDE_MODEL`, `POCKET_BENCH_CLAUDE_EFFORT`, `POCKET_BENCH_CODEX_MODEL`, `POCKET_BENCH_CODEX_EFFORT` | Set the session's `model` and `thought_level` config options (`sonnet`, `medium`, ...). Without them the user's own defaults apply. |
| `POCKET_BENCH_AGENTS_DIR=<dir>` | Where the adapters are installed. |
| `CLAUDE_CODE_EXECUTABLE`, `CODEX_PATH` | The agent binary to use instead of the one found. |

`grep ' # ' <log>` shows what was allowed or asked. `tools/dev.sh` ends every process whose command line holds
`sidecar/src/main.ts`; a sidecar started for a test as `cd sidecar/src && ../../vendor/bin/bun main.ts` survives it.

## Limits

- No client terminals, no MCP servers passed to the agents, no images in prompts, no `session/load` replay: a
  transcript does not survive the sidecar.
- Codex ends the turn (`cancelled`) when its "No" option is chosen (seen with codex-acp 2.6.0). Claude Code's
  adapter is written to hand the model a denial and go on; no real run here exercised that.
- The rules read the command line as text. A command they do not understand is asked about, never allowed; they
  do not look inside `bench`'s arguments (the command itself confines `bench shot`).
- Variables that tie a child to the Claude Code session the sidecar was started from (`CLAUDECODE`,
  `CLAUDE_CODE_SESSION_ID`, ...) are removed from the agents' environment; the rest is inherited.
- `Bench.settled()` (`GET /api/settled`) waits for the next build when called after a file-change build, because
  `Bench.timer` is not cleared when it fires. `bench check` works around it.
- The compiler's problems reach `bench check` and the preamble as `build.ts` parses them; a path inside the
  message (`PocketJS: /abs/worker.ts:198:7 ...`) is shortened by `bench check` only.
