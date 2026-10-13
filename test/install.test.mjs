import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const installer = new URL("../scripts/install.mjs", import.meta.url).pathname;
const run = (home, ...args) =>
  spawnSync("node", [installer, ...args], { env: { ...process.env, HOME: home, PSTACK_BIN_DIR: join(home, "bin"), PSTACK_HOME: "" }, encoding: "utf8" });

test("installs skills and agents, keeps foreign skills, and uninstalls only its own files", () => {
  const home = mkdtempSync(join(tmpdir(), "pstack-install-test-"));
  mkdirSync(join(home, ".claude/skills/arena"), { recursive: true });
  writeFileSync(join(home, ".claude/skills/arena/SKILL.md"), "mine");

  const first = run(home, "claude");
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /skipped 1 path\(s\) that pstack did not install/);
  assert.ok(existsSync(join(home, ".claude/skills/poteto-mode/SKILL.md")));
  assert.ok(existsSync(join(home, ".claude/agents/poteto-agent.md")));
  assert.ok(lstatSync(join(home, "bin/pstack-run")).isSymbolicLink());
  for (const h of ["claude", "codex", "opencode", "grok"]) assert.ok(existsSync(join(home, ".local/share/pstack", h, "skills/poteto-mode/SKILL.md")));

  const listed = spawnSync(join(home, "bin/pstack-run"), ["--list"], { env: { ...process.env, PSTACK_RUN_INSTALLED: "claude" }, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);

  assert.equal(run(home, "claude").status, 0, "reinstall is idempotent");
  const removed = run(home, "claude", "--uninstall");
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(readdirSync(join(home, ".claude/skills")), ["arena"]);
});

test("codex agents install as TOML under CODEX_HOME", () => {
  const home = mkdtempSync(join(tmpdir(), "pstack-install-test-"));
  assert.equal(run(home, "codex").status, 0);
  assert.ok(existsSync(join(home, ".codex/agents/pstack-reader.toml")));
  assert.ok(existsSync(join(home, ".agents/skills/poteto-mode/SKILL.md")));
});
