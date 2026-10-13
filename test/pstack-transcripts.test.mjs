import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = new URL("../src/skills/poteto-mode/scripts/pstack/pstack-transcripts.mjs", import.meta.url).pathname;

const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
function put(file, text, mtimeSec) {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
  if (mtimeSec) utimesSync(file, mtimeSec, mtimeSec);
}

// A temp HOME holding one session per harness for `ws`, plus decoys for `other`.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pstack-transcripts-")));
  const home = join(root, "home");
  const ws = join(root, "ws");
  const other = join(root, "other");
  mkdirSync(join(ws, "sub"), { recursive: true });
  mkdirSync(other, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  const slug = (d) => d.replace(/[^a-zA-Z0-9]/g, "-");

  const claudeDir = join(home, ".claude", "projects", slug(ws));
  const claude = join(claudeDir, "c1.jsonl");
  put(claude, jsonl([
    { type: "permission-mode", sessionId: "c1" },
    { type: "user", cwd: ws, message: { role: "user", content: "Fix the Flaky test" } },
    { type: "assistant", cwd: ws, message: { content: [
      { type: "thinking", thinking: "hidden" },
      { type: "text", text: "Looking now." },
      { type: "tool_use", name: "Bash", input: { command: "x".repeat(300) } },
    ] } },
    { type: "user", cwd: ws, message: { content: [{ type: "tool_result", content: "ok" }] } },
  ]), now - 100);
  put(join(claudeDir, "c1", "subagents", "agent-a.jsonl"), jsonl([
    { type: "user", cwd: ws, message: { content: "sub task" } },
  ]), now - 90);
  put(join(home, ".claude", "projects", slug(other), "c2.jsonl"), jsonl([
    { type: "user", cwd: other, message: { content: "secret other" } },
  ]), now - 10);

  const codex = join(home, ".codex", "sessions", "2026", "10", "13", "rollout-2026-10-13T00-00-00-x1.jsonl");
  put(codex, jsonl([
    { type: "session_meta", payload: { id: "x1", cwd: join(ws, "sub"), base_instructions: "long" } },
    { type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "dev" }] } },
    { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "codex hello" }] } },
    { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: '{"cmd":"ls"}' } },
    { type: "response_item", payload: { type: "function_call_output", output: "file.txt" } },
    { type: "event_msg", payload: { type: "agent_message", message: "dup" } },
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "codex done" }] } },
  ]), now - 50);
  put(join(home, ".codex", "sessions", "2026", "10", "12", "rollout-2026-10-12T00-00-00-x2.jsonl"), jsonl([
    { type: "session_meta", payload: { id: "x2", cwd: other } },
  ]), now - 5);

  const grok = join(home, ".grok", "sessions", encodeURIComponent(ws), "g1", "chat_history.jsonl");
  put(grok, jsonl([
    { type: "system", content: "sys" },
    { type: "user", content: [{ type: "text", text: "grok hi" }] },
    { type: "reasoning", summary: [] },
    { type: "assistant", content: "grok reply", tool_calls: [{ id: "t", name: "read_file", arguments: '{"path":"a"}' }] },
    { type: "tool_result", tool_call_id: "t", content: "contents" },
  ]), now - 20);

  return { root, home, ws, other, claude, codex, grok, now };
}

function run(f, args, { cwd = f.ws, path = join(f.root, "nobin") } = {}) {
  const r = spawnSync(process.execPath, [bin, ...args], {
    cwd,
    encoding: "utf8",
    env: { HOME: f.home, PATH: path },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split("\n").filter(Boolean) };
}

test("list merges harnesses for this workspace only, newest first", () => {
  const f = fixture();
  const r = run(f, ["list"]);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.lines.map((l) => l.split("\t")[2]), ["g1", "x1", "c1"]);
  assert.deepEqual(r.lines.map((l) => l.split("\t")[1]), [f.grok, f.codex, f.claude]);
  assert.match(r.lines[0].split("\t")[0], /^\d{4}-\d\d-\d\dT/);
  assert.match(r.err, /skipping opencode: opencode is not on PATH/);
});

test("list --subagents, --since and --grep", () => {
  const f = fixture();
  assert.deepEqual(run(f, ["list", "--harness", "claude", "--subagents"]).lines.map((l) => l.split("\t")[2]), ["agent-a", "c1"]);
  assert.deepEqual(run(f, ["list", "--since", "1m"]).lines.map((l) => l.split("\t")[2]), ["g1", "x1"]);
  assert.deepEqual(run(f, ["list", "--grep", "flaky"]).lines.map((l) => l.split("\t")[2]), ["c1"]);
  assert.equal(run(f, ["list", "--since", "7x"]).code, 2);
});

test("current picks the newest session per harness, --id prints the id", () => {
  const f = fixture();
  assert.deepEqual(run(f, ["current", "--harness", "claude"]).lines, [f.claude]);
  assert.deepEqual(run(f, ["current", "--harness", "codex", "--id"]).lines, ["x1"]);
  assert.deepEqual(run(f, ["current", "--id"]).lines, ["g1"]);
  const empty = run(f, ["current", "--harness", "grok"], { cwd: f.other });
  assert.equal(empty.code, 1);
  assert.match(empty.err, /no grok session found/);
});

test("show renders each format as role lines", () => {
  const f = fixture();
  const claude = run(f, ["show", f.claude]).lines;
  assert.equal(claude[0], "user: Fix the Flaky test");
  assert.equal(claude[1], "assistant: Looking now.");
  assert.match(claude[2], /^tool: Bash \{"command":"x+…$/);
  assert.ok(claude[2].length < 230);
  assert.equal(claude[3], "tool: => ok");

  assert.deepEqual(run(f, ["show", f.codex]).lines, [
    "user: codex hello",
    'tool: exec_command {"cmd":"ls"}',
    "tool: => file.txt",
    "assistant: codex done",
  ]);
  assert.deepEqual(run(f, ["show", f.grok]).lines, [
    "user: grok hi",
    "assistant: grok reply",
    'tool: read_file {"path":"a"}',
    "tool: => contents",
  ]);
  assert.deepEqual(run(f, ["show", f.grok, "--role", "tool", "--grep", "CONTENTS"]).lines, ["tool: => contents"]);
});

test("show refuses another workspace's transcript unless --workspace is explicit", () => {
  const f = fixture();
  const otherCodex = join(f.home, ".codex", "sessions", "2026", "10", "12", "rollout-2026-10-12T00-00-00-x2.jsonl");
  const refused = run(f, ["show", otherCodex]);
  assert.equal(refused.code, 2);
  assert.match(refused.err, /refusing.*--workspace/);
  assert.equal(run(f, ["show", otherCodex, "--workspace", f.other]).code, 0);
  assert.deepEqual(run(f, ["list", "--harness", "claude", "--workspace", f.other]).lines.map((l) => l.split("\t")[2]), ["c2"]);
});

test("the workspace defaults to the git root of the cwd", () => {
  const f = fixture();
  const git = spawnSync("git", ["init", "-q", f.ws]);
  if (git.status !== 0) return; // git missing on this machine
  const r = spawnSync(process.execPath, [bin, "list", "--harness", "codex"], {
    cwd: join(f.ws, "sub"),
    encoding: "utf8",
    env: { HOME: f.home, PATH: process.env.PATH },
  });
  assert.equal(r.stdout.split("\t")[2]?.trim(), "x1");
});

test("opencode goes through the CLI and caches exports", () => {
  const f = fixture();
  const binDir = join(f.root, "bin");
  mkdirSync(binDir);
  const fake = join(binDir, "opencode");
  writeFileSync(fake, `#!${process.execPath}
const [cmd, arg] = process.argv.slice(2);
const ws = ${JSON.stringify(f.ws)};
if (cmd === "session") {
  console.log(JSON.stringify([
    { id: "ses_1", directory: ws, time: { created: 1, updated: ${f.now * 1000} } },
    { id: "ses_2", directory: "/elsewhere", time: { created: 1, updated: ${f.now * 1000} } },
  ]));
} else if (cmd === "export") {
  console.log("Exporting session: " + arg);
  console.log(JSON.stringify({ info: { id: arg, directory: ws }, messages: [
    { info: { role: "user" }, parts: [{ type: "text", text: "oc question" }] },
    { info: { role: "assistant" }, parts: [{ type: "text", text: "oc answer" }, { type: "tool", tool: "bash", state: { input: { command: "ls" }, output: "a" } }] },
  ] }));
} else process.exit(3);
`);
  chmodSync(fake, 0o755);
  const cache = join(f.home, ".cache", "pstack", "opencode", "ses_1.json");
  const list = run(f, ["list", "--harness", "opencode"], { path: binDir });
  assert.equal(list.code, 0, list.err);
  assert.deepEqual(list.lines.map((l) => l.split("\t").slice(1)), [[cache, "ses_1"]]);
  assert.equal(run(f, ["current", "--harness", "opencode"], { path: binDir }).lines[0], cache);
  assert.ok(existsSync(cache));
  assert.deepEqual(run(f, ["show", cache], { path: binDir }).lines, [
    "user: oc question",
    "assistant: oc answer",
    'tool: bash {"command":"ls"}',
    "tool: => a",
  ]);
  // Without the CLI, show falls back to the cache and list explains itself.
  assert.equal(run(f, ["show", cache]).lines[0], "user: oc question");
  const missing = run(f, ["list", "--harness", "opencode"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /opencode is not on PATH/);
});
