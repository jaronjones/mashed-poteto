import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCommand, chooseCli, clampEffort, parseModel } from "../src/skills/poteto-mode/scripts/pstack/pstack-run.mjs";

const bin = new URL("../src/skills/poteto-mode/scripts/pstack/pstack-run", import.meta.url).pathname;

test("parseModel splits provider, model and effort", () => {
  assert.deepEqual(parseModel("anthropic/claude-opus-5-5#xhigh"), { provider: "anthropic", model: "claude-opus-5-5", effort: "xhigh" });
  assert.deepEqual(parseModel("xai/grok-4.7"), { provider: "xai", model: "grok-4.7", effort: undefined });
  assert.deepEqual(parseModel("inherit-parent"), { alias: "inherit-parent" });
  assert.throws(() => parseModel("grok-4.7-xhigh-fast"), /provider\/model#effort/);
  assert.throws(() => parseModel("xai/grok-4.7#ultra"), /bad effort/);
});

test("chooseCli prefers the provider's own CLI, then opencode", () => {
  const spec = parseModel("xai/grok-4.7#high");
  assert.equal(chooseCli(spec, undefined, ["claude", "grok"]), "grok");
  assert.equal(chooseCli(spec, undefined, ["claude", "opencode"]), "opencode");
  assert.throws(() => chooseCli(spec, undefined, ["claude"]), /no installed CLI serves provider "xai"/);
  assert.equal(chooseCli(spec, "opencode", ["grok", "opencode"]), "opencode");
  assert.equal(chooseCli(parseModel("auto"), undefined, ["codex", "grok"]), "codex");
});

test("clampEffort picks the highest supported effort at or below the request", () => {
  assert.equal(clampEffort("max", ["low", "medium", "high", "xhigh"]), "xhigh");
  assert.equal(clampEffort("xhigh", ["low", "medium", "high"]), "high");
  assert.equal(clampEffort("high", []), "high");
  assert.equal(clampEffort(undefined, ["low"]), undefined);
});

test("buildCommand maps read-only, model and effort per CLI", () => {
  const spec = parseModel("anthropic/claude-opus-5-5#xhigh");
  const opts = { spec, readonly: true, cwd: "/w", promptFile: "/p", outFile: "/o" };
  assert.deepEqual(buildCommand("claude", opts).args, ["-p", "--output-format", "json", "--permission-mode", "plan", "--model", "claude-opus-5-5", "--effort", "xhigh"]);
  const codex = buildCommand("codex", { ...opts, spec: parseModel("openai/gpt-5.5#high") }).args;
  assert.deepEqual(codex.slice(codex.indexOf("-s"), codex.indexOf("-s") + 2), ["-s", "read-only"]);
  assert.ok(codex.includes('model_reasoning_effort="high"'));
  const grokWrite = buildCommand("grok", { ...opts, readonly: false, spec: parseModel("xai/grok-4.7#xhigh") }).args;
  assert.ok(grokWrite.includes("bypassPermissions"));
  assert.deepEqual(buildCommand("codex", { ...opts, resume: "abc" }).args.slice(0, 3), ["exec", "resume", "abc"]);
});

test("end to end through a fake CLI: prompt, agent preamble, out file, session id", () => {
  const dir = mkdtempSync(join(tmpdir(), "pstack-run-test-"));
  const fake = join(dir, "fake-claude");
  writeFileSync(
    fake,
    `#!/bin/sh\ncat > "${dir}/stdin.txt"\necho "$@" > "${dir}/args.txt"\necho '{"result":"done","session_id":"s-1","is_error":false}'\n`,
  );
  chmodSync(fake, 0o755);
  const env = { ...process.env, PSTACK_RUN_INSTALLED: "claude", PSTACK_RUN_BIN_CLAUDE: fake, PSTACK_HOME: join(dir, "none") };
  const out = join(dir, "out.md");
  const r = spawnSync(bin, ["--model", "anthropic/claude-haiku-5-5#low", "--agent", "poteto-agent", "--prompt", "do the thing", "--out", out, "--cwd", dir], { env, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, "utf8"), "done");
  assert.match(r.stderr, /session s-1 \(via claude\)/);
  const stdin = readFileSync(join(dir, "stdin.txt"), "utf8");
  assert.match(stdin, /poteto-mode skill is at .*poteto-mode\/SKILL\.md/);
  assert.match(stdin, /do the thing$/);
  assert.match(readFileSync(join(dir, "args.txt"), "utf8"), /--permission-mode bypassPermissions --model claude-haiku-5-5 --effort low/);
});

test("exits 3 with a clear message when no CLI serves the provider", () => {
  const r = spawnSync(bin, ["--model", "xai/grok-4.7", "--prompt", "x"], { env: { ...process.env, PSTACK_RUN_INSTALLED: "claude" }, encoding: "utf8" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /no installed CLI serves provider "xai"/);
});

test("--list marks the harness's native models", () => {
  const out = execFileSync(bin, ["--list", "--harness", "claude"], { env: { ...process.env, PSTACK_RUN_INSTALLED: "claude" }, encoding: "utf8" });
  assert.match(out, /^anthropic\/claude-opus-5-5\tvia claude\tefforts=low,medium,high,xhigh,max\tnative$/m);
});
