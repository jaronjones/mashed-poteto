import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const bin = new URL("../src/skills/poteto-mode/scripts/pstack/pstack-mode", import.meta.url).pathname;
const START = "<!-- pstack-mode:start -->";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "pstack-mode-"));
  const run = (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env: { HOME: home, PATH: process.env.PATH } });
    return { code: r.status, out: r.stdout, err: r.stderr };
  };
  return { home, run };
}

const count = (text, needle) => text.split(needle).length - 1;

test("on creates parent dirs and one block per file, even when run twice", () => {
  const { home, run } = fixture();
  assert.equal(run("on", "--harness", "all").code, 0);
  assert.equal(run("on", "--harness", "all").code, 0);
  const files = {
    claude: join(home, ".claude", "CLAUDE.md"),
    codex: join(home, ".codex", "AGENTS.md"),
    opencode: join(home, ".config", "opencode", "AGENTS.md"),
    grok: join(home, ".grok", "rules", "pstack-mode.md"),
  };
  for (const file of Object.values(files)) assert.equal(count(readFileSync(file, "utf8"), START), 1, file);
  assert.match(readFileSync(files.codex, "utf8"), /\$poteto-mode/);
  assert.match(readFileSync(files.claude, "utf8"), /`\/poteto-mode`/);
  assert.match(readFileSync(files.claude, "utf8"), /opt out/);
  assert.match(run("status").out, /claude: on[\s\S]*grok: on/);
});

test("on then off restores the original file byte for byte", () => {
  const { home, run } = fixture();
  const file = join(home, ".claude", "CLAUDE.md");
  mkdirSync(join(home, ".claude"));
  const original = "# Mine\r\n\nkeep  this\ttext\n<!-- other marker -->\n\n";
  writeFileSync(file, original);
  run("on", "--harness", "claude");
  const withBlock = readFileSync(file, "utf8");
  assert.ok(withBlock.startsWith(original));
  run("on", "--harness", "claude");
  assert.equal(readFileSync(file, "utf8"), withBlock);
  run("off", "--harness", "claude");
  assert.equal(readFileSync(file, "utf8"), original);
  run("off", "--harness", "claude");
  assert.equal(readFileSync(file, "utf8"), original);
  assert.match(run("status", "--harness", "claude").out, /claude: off/);
});

test("a block between other content is replaced in place and removed cleanly", () => {
  const { home, run } = fixture();
  const file = join(home, ".codex", "AGENTS.md");
  mkdirSync(join(home, ".codex"));
  writeFileSync(file, `top\n\n${START}\nold wording\n<!-- pstack-mode:end -->\n\nbottom\n`);
  run("on", "--harness", "codex");
  const text = readFileSync(file, "utf8");
  assert.equal(count(text, START), 1);
  assert.ok(!text.includes("old wording"));
  assert.ok(text.startsWith("top\n\n") && text.endsWith("\n\nbottom\n"));
  run("off", "--harness", "codex");
  assert.equal(readFileSync(file, "utf8"), "top\n\nbottom\n");
});

test("CODEX_HOME is respected, grok off deletes its rules file", () => {
  const { home, run } = fixture();
  const codexHome = join(home, "alt-codex");
  const r = spawnSync(bin, ["on", "--harness", "codex"], { encoding: "utf8", env: { HOME: home, CODEX_HOME: codexHome, PATH: process.env.PATH } });
  assert.equal(r.status, 0);
  assert.ok(existsSync(join(codexHome, "AGENTS.md")));
  run("on", "--harness", "grok");
  const grok = join(home, ".grok", "rules", "pstack-mode.md");
  assert.ok(readFileSync(grok, "utf8").startsWith(START));
  run("off", "--harness", "grok");
  assert.ok(!existsSync(grok));
  assert.equal(run("off", "--harness", "grok").code, 0);
});

test("on and off require --harness; bad input exits 2", () => {
  const { run } = fixture();
  assert.equal(run("on").code, 2);
  assert.equal(run("on", "--harness", "cursor").code, 2);
  assert.equal(run("flip", "--harness", "claude").code, 2);
});
