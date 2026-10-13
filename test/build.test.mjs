import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildAll, parseFrontmatter, render } from "../scripts/build.mjs";
import { profiles } from "../harness/profiles.mjs";

const out = mkdtempSync(join(tmpdir(), "pstack-build-test-"));
const problems = buildAll(out);

test("every harness builds with no lint problems", () => {
  assert.deepEqual(problems, []);
});

test("skill names match their directories and descriptions survive", () => {
  for (const h of Object.keys(profiles)) {
    for (const dir of readdirSync(join(out, h, "skills"))) {
      const { data } = parseFrontmatter(readFileSync(join(out, h, "skills", dir, "SKILL.md"), "utf8"));
      assert.equal(data.name, dir, `${h}/${dir}`);
      assert.ok(data.description?.length > 20, `${h}/${dir} description`);
    }
  }
});

test("manual-only skills stay manual on every harness", () => {
  assert.match(readFileSync(join(out, "claude/skills/arena/SKILL.md"), "utf8"), /disable-model-invocation: true/);
  assert.match(readFileSync(join(out, "grok/skills/arena/SKILL.md"), "utf8"), /disable-model-invocation: true/);
  assert.match(readFileSync(join(out, "opencode/skills/arena/SKILL.md"), "utf8"), /"opencode\/autoinvoke": "false"/);
  assert.match(readFileSync(join(out, "codex/skills/arena/agents/openai.yaml"), "utf8"), /allow_implicit_invocation: false/);
});

test("agents render in each harness's format", () => {
  assert.match(readFileSync(join(out, "claude/agents/pstack-reader.md"), "utf8"), /disallowedTools: "Edit, Write, NotebookEdit"/);
  assert.match(readFileSync(join(out, "opencode/agents/pstack-reader.md"), "utf8"), /mode: "subagent"\npermission:\n  "edit": "deny"/);
  assert.match(readFileSync(join(out, "grok/agents/pstack-reader.md"), "utf8"), /permission_mode: "plan"/);
  const toml = readFileSync(join(out, "codex/agents/poteto-agent.toml"), "utf8");
  assert.match(toml, /^name = "poteto-agent"\n/);
  assert.match(toml, /sandbox_mode = "workspace-write"\ndeveloper_instructions = '''\n/);
});

test("skill invocations use the harness prefix", () => {
  assert.equal(render("run `/how` then /why now", profiles.codex), "run `$how` then $why now");
  assert.equal(render("see ../how/SKILL.md and /tmp/how", profiles.codex), "see ../how/SKILL.md and /tmp/how");
  assert.equal(render("{{#if grok}}G{{/if}}{{#unless grok}}N{{/unless}}", profiles.grok), "G");
  assert.throws(() => render("{{nope}}", profiles.claude), /unknown token/);
});

test("the shipped tools are executable in every rendering", () => {
  for (const h of Object.keys(profiles)) assert.ok(existsSync(join(out, h, "skills/poteto-mode/scripts/pstack/pstack-run")));
});
