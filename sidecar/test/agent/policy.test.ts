// The permission rules and the transcript's helpers, without an agent.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { access, allowOnce, commandAllowed, commandOf, decide, makeScope, parseCommand, readTextFile, Refused, writeTextFile } from "../../src/agent/policy.ts";
import { countChanges, describeTool } from "../../src/agent/transcript.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "pb-policy-test-")));
const workspace = join(root, "PocketBench"), project = join(workspace, "probe"), other = join(workspace, "other"), framework = join(root, "framework");
for (const dir of [project, other, join(workspace, "docs"), framework, join(project, ".git", "hooks")]) mkdirSync(dir, { recursive: true });
writeFileSync(join(project, "main.tsx"), "a\nb\nc\n");
writeFileSync(join(workspace, "AGENTS.md"), "guide\n");
writeFileSync(join(root, "secret.txt"), "no\n");
symlinkSync(root, join(project, "escape"));
const bench = join(workspace, ".bench", "bin", "bench");
const scope = makeScope(project, workspace, [framework], bench);
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("files", () => {
  test("the project is written, the workspace is read, the rest is neither", () => {
    expect(access(scope, join(project, "main.tsx"))).toBe("write");
    expect(access(scope, join(project, "new", "deep", "file.ts"))).toBe("write");
    expect(access(scope, "worker.ts")).toBe("write");
    expect(access(scope, join(workspace, "AGENTS.md"))).toBe("read");
    expect(access(scope, join(workspace, "docs", "bench-cli.md"))).toBe("read");
    expect(access(scope, join(other, "main.tsx"))).toBe("read");
    expect(access(scope, join(framework, "index.d.ts"))).toBe("read");
    expect(access(scope, join(root, "secret.txt"))).toBe("none");
    expect(access(scope, "../../secret.txt")).toBe("none");
    expect(access(scope, "~/.ssh/id_rsa")).toBe("none");
    expect(access(scope, "/etc/hosts")).toBe("none");
  });
  test("a link out of the project does not carry the project's rights", () => {
    expect(access(scope, join(project, "escape", "secret.txt"))).toBe("none");
  });
  test("what decides what runs is not written without asking", () => {
    expect(access(scope, join(project, ".git", "hooks", "pre-commit"))).toBe("read");
    expect(access(scope, join(project, ".claude", "settings.json"))).toBe("read");
    expect(access(scope, join(project, ".bench.json"))).toBe("read");
  });
  test("the client's file methods follow the same rules", () => {
    expect(readTextFile(scope, { path: join(project, "main.tsx") })).toBe("a\nb\nc\n");
    expect(readTextFile(scope, { path: join(project, "main.tsx"), line: 2, limit: 1 })).toBe("b");
    expect(() => readTextFile(scope, { path: join(root, "secret.txt") })).toThrow(Refused);
    expect(() => readTextFile(scope, { path: "main.tsx" })).toThrow(Refused);
    writeTextFile(scope, { path: join(project, "units", "new.ts"), content: "x" });
    expect(readTextFile(scope, { path: join(project, "units", "new.ts") })).toBe("x");
    expect(() => writeTextFile(scope, { path: join(workspace, "AGENTS.md"), content: "x" })).toThrow(Refused);
    expect(() => writeTextFile(scope, { path: join(project, "escape", "x.txt"), content: "x" })).toThrow(Refused);
  });
});

describe("commands", () => {
  const allowed = (line: string) => commandAllowed(line, scope);
  test("bench runs", () => {
    for (const line of ["bench check", "bench set env3-1 celsius 35", "bench check 2>&1", `cd ${project} && bench check`, "bench check 2>&1 | tail -20", `${bench} shot`, "bench type 'hello; world'"]) expect(allowed(line)).toBe(true);
  });
  test("commands that only read run on what may be read", () => {
    for (const line of ["ls", "ls -la units", "cat main.tsx | head -5", `cat ${join(workspace, "AGENTS.md")}`, "grep -rn 'onFrame(' .", "rg -n Text main.tsx", "sed -n '1,40p' main.tsx",
      "find . -name '*.ts'", "wc -l main.tsx && pwd", `ls ${framework}`, "cat ../docs/bench-cli.md", "grep -rn Text .."]) expect(allowed(line)).toBe(true);
    for (const line of ["cat /etc/passwd", "cat ~/.ssh/id_rsa", "cat ../../secret.txt", "ls /", "grep -r key ../..", "cat escape/secret.txt", "cd / && ls", "grep --file=/etc/passwd x main.tsx"]) expect(allowed(line)).toBe(false);
  });
  test("anything else asks", () => {
    for (const line of ["rm -rf .build", "npm install", "curl https://example.com", "bench check; rm -rf ~", "bench check && rm x", "bench check > /tmp/x", "bench `whoami`", "bench $(id)",
      "echo \"$HOME\"", "FOO=1 bench check", "./bench check", "/tmp/bench check", "find . -delete", "find . -exec rm {} +", "sort -o main.tsx main.tsx", "sed -i '' s/a/b/ main.tsx",
      "sed -n '1w out' main.tsx", "rg --pre ./x foo", "bench check &", "cat main.tsx | sh", "git status", "bun run x.ts", ""]) expect(allowed(line)).toBe(false);
  });
  test("the command line is read from the shapes the agents send", () => {
    expect(commandOf({ command: "bench check" })).toBe("bench check");
    expect(commandOf({ command: ["/bin/zsh", "-lc", "bench check"] })).toBe("bench check");
    expect(commandOf({ command: ["bench", "check"] })).toBe("bench check");
    expect(commandOf({ command: `/bin/zsh -lc "rg -n 'Hello Bench' main.tsx; cat main.tsx"` })).toBe("rg -n 'Hello Bench' main.tsx; cat main.tsx");
    expect(commandOf({ command: `/bin/zsh -lc "echo $HOME"` })).toBe(`/bin/zsh -lc "echo $HOME"`);
    expect(commandOf({ command: ["sh", "x y"] })).toBeNull();
    expect(commandOf({ file_path: "x" })).toBeNull();
    expect(parseCommand("a 'b c' \"d\" | e")).toEqual([["a", "b c", "d"], ["e"]]);
  });
});

describe("permission requests", () => {
  test("the rules", () => {
    expect(decide({ kind: "execute", rawInput: { command: "bench check" } }, scope).allow).toBe(true);
    expect(decide({ kind: "execute", rawInput: { command: ["/bin/zsh", "-lc", "bench shot"], cwd: project } }, scope).allow).toBe(true);
    expect(decide({ kind: "execute", rawInput: { command: "bench check", cwd: "/" } }, scope).allow).toBe(false);
    expect(decide({ kind: "execute", rawInput: { command: "npm i left-pad" } }, scope).allow).toBe(false);
    expect(decide({ kind: "execute" }, scope).allow).toBe(false);
    // A title is the agent's word: it does not decide.
    expect(decide({ kind: "other", rawInput: { command: "rm -rf /" } }, scope).allow).toBe(false);
    expect(decide({ kind: "edit", locations: [{ path: join(project, "main.tsx") }] }, scope).allow).toBe(true);
    expect(decide({ kind: "edit", rawInput: { file_path: join(project, "a.ts") }, content: [{ type: "diff", path: join(other, "main.tsx"), newText: "x" }] }, scope).allow).toBe(false);
    expect(decide({ kind: "edit", rawInput: { changes: { [join(project, "a.ts")]: {}, [join(project, "b.ts")]: {} } } }, scope).allow).toBe(true);
    expect(decide({ kind: "edit", rawInput: { changes: { [join(project, "a.ts")]: {}, "/etc/hosts": {} } } }, scope).allow).toBe(false);
    expect(decide({ kind: "edit" }, scope).allow).toBe(false);
    expect(decide({ kind: "delete", locations: [{ path: join(workspace, "AGENTS.md") }] }, scope).allow).toBe(false);
    expect(decide({ kind: "read", locations: [{ path: join(workspace, "AGENTS.md") }] }, scope).allow).toBe(true);
    expect(decide({ kind: "read", rawInput: { file_path: "/etc/hosts" } }, scope).allow).toBe(false);
    expect(decide({ kind: "read" }, scope).allow).toBe(false);
    expect(decide({ kind: "search", rawInput: { pattern: "Text" } }, scope).allow).toBe(true);
    expect(decide({ kind: "search", rawInput: { pattern: "key", path: "/Users" } }, scope).allow).toBe(false);
    expect(decide({ kind: "fetch", rawInput: { url: "https://example.com" } }, scope).allow).toBe(false);
    expect(decide({ kind: "move", locations: [{ path: join(project, "a.ts") }] }, scope).allow).toBe(false);
    expect(decide({ kind: "switch_mode" }, scope).allow).toBe(false);
  });
  test("only a one-time permission is given by the rules", () => {
    expect(allowOnce([{ optionId: "a", kind: "allow_always" }, { optionId: "b", kind: "allow_once" }])).toBe("b");
    expect(allowOnce([{ optionId: "a", kind: "allow_always" }, { optionId: "r", kind: "reject_once" }])).toBeUndefined();
  });
});

describe("the transcript's helpers", () => {
  test("lines added and removed", () => {
    expect(countChanges("a\nb\nc\n", "a\nB\nc\n")).toEqual({ added: 1, removed: 1 });
    expect(countChanges(null, "a\nb\n")).toEqual({ added: 2, removed: 0 });
    expect(countChanges("a\nb\nc\nd\n", "a\nd\n")).toEqual({ added: 0, removed: 2 });
    expect(countChanges("a\nb\nc\nd", "a\nx\nc\ny\nd")).toEqual({ added: 2, removed: 1 });
    expect(countChanges("same", "same")).toEqual({ added: 0, removed: 0 });
  });
  test("tool titles are short and say what happens", () => {
    expect(describeTool({ kind: "read", title: "Read /long/path/main.tsx (1 - 40)", locations: [{ path: join(project, "main.tsx") }] }, project)).toEqual({ title: "Reading main.tsx", toolKind: "read", path: "main.tsx" });
    expect(describeTool({ kind: "edit", rawInput: { file_path: join(project, "units", "env3.ts") } }, project)).toEqual({ title: "Editing env3.ts", toolKind: "edit", path: "units/env3.ts" });
    expect(describeTool({ kind: "read", locations: [{ path: join(workspace, "AGENTS.md") }] }, project)).toEqual({ title: "Reading AGENTS.md", toolKind: "read" });
    expect(describeTool({ kind: "execute", title: "`cd x && bench check 2>&1`", rawInput: { command: `cd ${project} && bench check 2>&1` } }, project)).toEqual({ title: "Running bench check", toolKind: "execute" });
    expect(describeTool({ kind: "execute", rawInput: { command: ["/bin/zsh", "-lc", "bench shot"] } }, project).title).toBe("Running bench shot");
    expect(describeTool({ kind: "execute", title: "Terminal", rawInput: {} }, project).title).toBe("Running a command");
    expect(decide({ kind: "execute", rawInput: { command: `/bin/zsh -lc "bench check; rm -rf x"` } }, scope).allow).toBe(false);
    expect(decide({ kind: "execute", rawInput: { command: `/bin/zsh -lc "cat main.tsx | head -3"` } }, scope).allow).toBe(true);
    expect(describeTool({ kind: "search", title: "grep", rawInput: { pattern: "onFrame" } }, project)).toEqual({ title: "Searching for onFrame", toolKind: "search" });
    expect(describeTool({ kind: "fetch", rawInput: { url: "https://docs.m5stack.com/en/unit/envIII" } }, project).title).toBe("Fetching docs.m5stack.com");
    expect(describeTool({ kind: "delete", locations: [{ path: join(project, "old.ts") }] }, project)).toEqual({ title: "Deleting old.ts", toolKind: "edit", path: "old.ts" });
    expect(describeTool({ kind: "other", title: "Update TODOs\nwith detail" }, project)).toEqual({ title: "Update TODOs", toolKind: "other" });
    expect(describeTool({ kind: "edit", rawInput: { changes: { [join(project, "a.ts")]: {}, [join(project, "b.ts")]: {} } } }, project).title).toBe("Editing 2 files");
  });
});
