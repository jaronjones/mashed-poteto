#!/usr/bin/env node
// pstack-mode: make poteto-mode sticky by adding a marked block to the user-level
// instructions file of each harness. See references/harness.md → Sticky mode.
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const HARNESSES = ["claude", "codex", "opencode", "grok"];
const USAGE = `usage: pstack-mode on|off --harness <${HARNESSES.join("|")}|all>\n       pstack-mode status [--harness <${HARNESSES.join("|")}|all>]`;
const START = "<!-- pstack-mode:start -->";
const END = "<!-- pstack-mode:end -->";

class UsageError extends Error {}

function target(harness) {
  const home = process.env.HOME;
  switch (harness) {
    case "claude":
      return path.join(home, ".claude", "CLAUDE.md");
    case "codex":
      return path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "AGENTS.md");
    case "opencode":
      return path.join(home, ".config", "opencode", "AGENTS.md");
    case "grok":
      return path.join(home, ".grok", "rules", "pstack-mode.md");
  }
}

// Grok reads a whole rules file, so its block is the file and `off` deletes it.
const ownsFile = (harness) => harness === "grok";

function block(harness) {
  const invoke = harness === "codex" ? "$poteto-mode" : "/poteto-mode";
  return `${START}
## pstack: poteto-mode

Apply the \`poteto-mode\` skill to every task where one of its playbooks matches or the task needs rigor. At the start of such a task, read the skill (invoke it as \`${invoke}\`) and follow it. For everything else, stay out of the way and work normally. The user can opt out for a single message by saying so, for example "no poteto-mode".
${END}`;
}

// Matches a block plus its trailing newline, and the blank line `on` put before it.
const BLOCK_RE = new RegExp(`(?<=^|\\n)\\n?${START}[\\s\\S]*?${END}\\n?`, "g");

const read = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const hasBlock = (text) => text !== null && text.includes(START);

function on(harness) {
  const file = target(harness);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = read(file);
  let next;
  if (ownsFile(harness)) next = block(harness) + "\n";
  else if (hasBlock(text)) {
    // Replace the first block in place (refreshing its wording) and drop any duplicates.
    let first = true;
    next = text.replace(BLOCK_RE, (m) => {
      if (!first) return "";
      first = false;
      return m.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block(harness));
    });
  } else if (!text) next = block(harness) + "\n";
  else next = text + (text.endsWith("\n") ? "" : "\n") + "\n" + block(harness) + "\n";
  if (next !== text) fs.writeFileSync(file, next);
  console.log(`${harness}: on (${file})`);
}

function off(harness) {
  const file = target(harness);
  const text = read(file);
  if (hasBlock(text)) {
    if (ownsFile(harness)) fs.rmSync(file);
    else fs.writeFileSync(file, text.replace(BLOCK_RE, ""));
  }
  console.log(`${harness}: off (${file})`);
}

function status(harness) {
  const file = target(harness);
  console.log(`${harness}: ${hasBlock(read(file)) ? "on" : "off"} (${file})`);
}

function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { harness: { type: "string" }, help: { type: "boolean", short: "h" } },
  });
  const [cmd] = positionals;
  if (o.help || !cmd) return console.log(USAGE);
  const action = { on, off, status }[cmd];
  if (!action) throw new UsageError(`unknown command ${cmd}`);
  // Writing every harness's instructions file must be asked for; status may default to all.
  const harness = o.harness ?? (cmd === "status" ? "all" : null);
  if (!harness) throw new UsageError(`${cmd} needs --harness`);
  if (harness !== "all" && !HARNESSES.includes(harness)) throw new UsageError(`unknown --harness ${harness}`);
  for (const h of harness === "all" ? HARNESSES : [harness]) action(h);
}

try {
  main(process.argv.slice(2));
} catch (e) {
  const usage = e instanceof UsageError || e.code?.startsWith("ERR_PARSE_ARGS");
  process.stderr.write(`pstack-mode: ${e.message}\n${usage ? USAGE + "\n" : ""}`);
  process.exitCode = usage ? 2 : 1;
}
