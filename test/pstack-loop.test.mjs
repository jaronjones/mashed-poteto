import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const bin = new URL("../src/skills/poteto-mode/scripts/pstack/pstack-loop.mjs", import.meta.url).pathname;

// A temp HOME with a fake harness binary that records each call as one JSON line.
function fixture({ tickMs = 0 } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pstack-loop-"));
  const home = join(root, "home");
  mkdirSync(home);
  const calls = join(root, "calls.jsonl");
  const fake = join(root, "fake-harness");
  writeFileSync(fake, `#!${process.execPath}
const fs = require("fs");
const start = Date.now();
let stdin = "";
try { stdin = fs.readFileSync(0, "utf8"); } catch {}
setTimeout(() => {
  fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify({ args: process.argv.slice(2), stdin, start, end: Date.now() }) + "\\n");
  console.log("fake harness ran");
}, ${tickMs});
`);
  chmodSync(fake, 0o755);
  const prompt = join(root, "tick.md");
  writeFileSync(prompt, "check CI");
  const env = { HOME: home, PATH: process.env.PATH };
  for (const h of ["CODEX", "OPENCODE", "CLAUDE", "GROK"]) env[`PSTACK_LOOP_BIN_${h}`] = fake;
  return { root, home, calls, prompt, env, loops: join(home, ".config", "pstack", "loops") };
}

function run(f, args) {
  const r = spawnSync(process.execPath, [bin, ...args], { cwd: f.root, encoding: "utf8", env: f.env });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

const state = (f, name) => JSON.parse(readFileSync(join(f.loops, `${name}.json`), "utf8"));
const calls = (f) => (existsSync(f.calls) ? readFileSync(f.calls, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function waitFor(pred, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (pred()) return;
    await sleep(100);
  }
  assert.fail("timed out waiting");
}

test("claude loop resumes the session until --max, then marks done", async () => {
  const f = fixture();
  const r = run(f, ["start", "--harness", "claude", "--session", "sess-123", "--every", "1s", "--max", "2", "--prompt-file", f.prompt, "--name", "ci"]);
  assert.equal(r.code, 0, r.err);
  assert.ok(state(f, "ci").pid > 0);
  await waitFor(() => state(f, "ci").status === "done");
  assert.equal(state(f, "ci").ticks, 2);
  assert.match(state(f, "ci").reason, /--max 2/);
  assert.deepEqual(calls(f).map((c) => c.args), [["-p", "-r", "sess-123", "--permission-mode", "acceptEdits"], ["-p", "-r", "sess-123", "--permission-mode", "acceptEdits"]]);
  assert.equal(calls(f)[0].stdin, "check CI", "the prompt goes on stdin so it can never parse as a flag");
  const log = readFileSync(join(f.loops, "ci.log"), "utf8");
  assert.match(log, /tick 1/);
  assert.match(log, /fake harness ran/);
});

test("codex gets the prompt on stdin and --until ends the loop", async () => {
  const f = fixture();
  const flag = join(f.root, "green");
  const r = run(f, ["start", "--harness", "codex", "--session", "abc", "--every", "1s", "--until", `test -f ${flag}`, "--prompt-file", f.prompt]);
  assert.equal(r.code, 0, r.err);
  await waitFor(() => calls(f).length >= 1);
  writeFileSync(flag, "");
  await waitFor(() => state(f, "codex-abc").status === "done");
  assert.equal(state(f, "codex-abc").reason, "check passed");
  assert.deepEqual(calls(f)[0].args, ["exec", "resume", "abc", "--skip-git-repo-check", "-c", 'sandbox_mode="workspace-write"', "-"]);
  assert.equal(calls(f)[0].stdin, "check CI");
});

test("opencode and grok argument shapes", async () => {
  const f = fixture();
  run(f, ["start", "--harness", "opencode", "--session", "s1", "--every", "1s", "--max", "1", "--prompt-file", f.prompt, "--name", "oc"]);
  run(f, ["start", "--harness", "grok", "--session", "s2", "--every", "1s", "--max", "1", "--prompt-file", f.prompt, "--name", "gk"]);
  await waitFor(() => state(f, "oc").status === "done" && state(f, "gk").status === "done");
  const args = calls(f).map((c) => c.args).sort();
  assert.deepEqual(args, [
    ["-r", "s2", "--permission-mode", "acceptEdits", "--prompt-file", f.prompt],
    ["run", "-s", "s1", "-f", f.prompt, "--", "Follow the instructions in the attached prompt file exactly."],
  ]);
});

test("ticks never overlap when a tick outlasts the interval", async () => {
  const f = fixture({ tickMs: 1500 });
  run(f, ["start", "--harness", "claude", "--session", "s", "--every", "1s", "--max", "2", "--prompt-file", f.prompt, "--name", "slow"]);
  await waitFor(() => state(f, "slow").status === "done");
  const [a, b] = calls(f);
  assert.ok(b.start >= a.end, "second tick started before the first ended");
});

test("stop kills the worker, marks stopped and is idempotent", async () => {
  const f = fixture();
  run(f, ["start", "--harness", "grok", "--session", "s", "--every", "1s", "--prompt-file", f.prompt, "--name", "w"]);
  const { pid } = state(f, "w");
  await waitFor(() => calls(f).length >= 1);
  const r = run(f, ["stop", "w"]);
  assert.equal(r.code, 0, r.err);
  assert.equal(state(f, "w").status, "stopped");
  await waitFor(() => !alive(pid));
  const again = run(f, ["stop", "w"]);
  assert.equal(again.code, 0);
  assert.match(again.out, /already stopped/);
  assert.match(run(f, ["list"]).out, /^w\tstopped\tgrok\ts\tevery 1s/m);
  const n = calls(f).length;
  await sleep(1500);
  assert.equal(calls(f).length, n, "ticked after stop");
});

test("start validates its arguments", () => {
  const f = fixture();
  const base = ["start", "--harness", "claude", "--session", "s", "--prompt-file", f.prompt];
  assert.equal(run(f, [...base, "--every", "5"]).code, 2);
  assert.equal(run(f, ["start", "--harness", "cursor", "--session", "s", "--every", "1s", "--prompt-file", f.prompt]).code, 2);
  assert.equal(run(f, [...base, "--every", "1s", "--max", "0"]).code, 2);
  assert.equal(run(f, ["start", "--harness", "claude", "--session", "s", "--every", "1s", "--prompt-file", join(f.root, "nope")]).code, 2);
  assert.equal(run(f, ["stop", "ghost"]).code, 2);
  assert.match(run(f, ["list"]).out, /no loops/);
});
