#!/usr/bin/env node
// User-level installer. See README → Install.
// Usage: install.sh <claude|codex|opencode|grok|all> [--plugin] [--force] [--full-access] [--uninstall] [--dry-run]

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { harnessIds } from "../harness/profiles.mjs";

const repo = resolve(dirname(new URL(import.meta.url).pathname), "..");
const home = process.env.HOME || homedir();
const pstackHome = process.env.PSTACK_HOME || join(home, ".local", "share", "pstack");
const binDir = process.env.PSTACK_BIN_DIR || join(home, ".local", "bin");
const tools = ["pstack-run", "pstack-transcripts", "pstack-loop", "pstack-mode", "pstack-hookd"];

const targets = {
  claude: { skills: join(home, ".claude", "skills"), agents: join(home, ".claude", "agents") },
  codex: { skills: join(home, ".agents", "skills"), agents: join(process.env.CODEX_HOME || join(home, ".codex"), "agents") },
  opencode: { skills: join(home, ".config", "opencode", "skills"), agents: join(home, ".config", "opencode", "agents") },
  grok: { skills: join(home, ".grok", "skills"), agents: join(home, ".grok", "agents") },
};

const pluginSteps = {
  claude: [`claude plugin marketplace add ${repo}`, "claude plugin install pstack@mashed-poteto"],
  codex: [`codex plugin marketplace add ${repo}`, "codex plugin add pstack"],
  grok: [`grok plugin install ${join(repo, "dist", "grok")} --trust`],
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    plugin: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "full-access": { type: "boolean", default: false },
    uninstall: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
  },
});
const which = positionals[0];
if (!which || !(which === "all" || harnessIds.includes(which))) {
  console.error(`usage: install.sh <${harnessIds.join("|")}|all> [--plugin] [--force] [--full-access] [--uninstall] [--dry-run]`);
  process.exit(2);
}
const selected = which === "all" ? harnessIds : [which];
const dry = values["dry-run"];
const act = (msg, fn) => {
  console.log(`${dry ? "would " : ""}${msg}`);
  if (!dry) fn();
};

const manifestPath = (h) => join(pstackHome, `installed-${h}.json`);
const readManifest = (h) => (existsSync(manifestPath(h)) ? JSON.parse(readFileSync(manifestPath(h), "utf8")) : []);
const exists = (p) => {
  try {
    lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

function uninstall(h) {
  for (const p of readManifest(h)) if (exists(p)) act(`remove ${p}`, () => rmSync(p, { recursive: true, force: true }));
  act(`remove ${manifestPath(h)}`, () => rmSync(manifestPath(h), { force: true }));
}

// Copies each entry of srcDir into destDir. Paths pstack did not install are collisions:
// skipped, or moved aside to <name>.pstack-backup-<ts> with --force.
function installEntries(srcDir, destDir, owned, installed, collisions) {
  for (const name of readdirSync(srcDir)) {
    const dest = join(destDir, name);
    if (exists(dest) && !owned.includes(dest)) {
      if (!values.force) {
        collisions.push(dest);
        continue;
      }
      act(`move aside ${dest}`, () => renameSync(dest, `${dest}.pstack-backup-${Date.now()}`));
    } else if (exists(dest)) act(`replace ${dest}`, () => rmSync(dest, { recursive: true, force: true }));
    act(`install ${dest}`, () => {
      mkdirSync(destDir, { recursive: true });
      cpSync(join(srcDir, name), dest, { recursive: true });
    });
    installed.push(dest);
  }
}

function install(h) {
  const dist = join(repo, "dist", h);
  const owned = readManifest(h);
  const installed = [];
  const collisions = [];

  if (values.plugin && pluginSteps[h]) {
    console.log(`\n${h}: run these to install pstack as a plugin:\n${pluginSteps[h].map((s) => `  ${s}`).join("\n")}`);
    if (h === "codex") {
      console.log("codex plugins cannot ship subagents, so the agents are installed at user level:");
      installEntries(join(dist, "agents"), targets[h].agents, owned, installed, collisions);
    }
  } else {
    if (values.plugin) console.log(`${h} has no plugin system, installing at user level.`);
    installEntries(join(dist, "skills"), targets[h].skills, owned, installed, collisions);
    installEntries(join(dist, "agents"), targets[h].agents, owned, installed, collisions);
  }
  // Codex fixes a subagent's sandbox in its TOML, so opting in to full access happens at install time.
  if (h === "codex" && values["full-access"])
    for (const p of installed.filter((p) => p.endsWith(".toml") && (dry || readFileSync(p, "utf8").includes('"workspace-write"'))))
      act(`grant full access in ${p}`, () =>
        writeFileSync(p, readFileSync(p, "utf8").replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "danger-full-access"')),
      );
  for (const stale of owned.filter((p) => !installed.includes(p) && exists(p))) act(`remove stale ${stale}`, () => rmSync(stale, { recursive: true, force: true }));
  act(`record ${manifestPath(h)}`, () => {
    mkdirSync(pstackHome, { recursive: true });
    writeFileSync(manifestPath(h), JSON.stringify(installed, null, 2) + "\n");
  });

  if (collisions.length) {
    console.log(`\n${h}: skipped ${collisions.length} path(s) that pstack did not install:\n${collisions.map((c) => `  ${c}`).join("\n")}`);
    console.log("Rerun with --force to move them aside, or use --plugin where available (plugin skills are namespaced as pstack:<name>).");
  }
}

if (!existsSync(join(repo, "dist"))) {
  console.error("dist/ is missing. Run: node scripts/build.mjs");
  process.exit(1);
}

for (const h of selected) (values.uninstall ? uninstall : install)(h);

if (!values.uninstall) {
  // Every rendering goes under PSTACK_HOME so a bridged run reads instructions written for its own harness.
  for (const h of harnessIds)
    act(`stage ${join(pstackHome, h)}`, () => {
      rmSync(join(pstackHome, h), { recursive: true, force: true });
      cpSync(join(repo, "dist", h), join(pstackHome, h), { recursive: true });
    });
  const scripts = join(pstackHome, harnessIds[0], "skills", "poteto-mode", "scripts", "pstack");
  for (const t of tools) {
    const link = join(binDir, t);
    if (exists(link) && !lstatSync(link).isSymbolicLink() && !values.force) {
      console.log(`skip ${link}: exists and is not a pstack shim`);
      continue;
    }
    act(`link ${link}`, () => {
      mkdirSync(binDir, { recursive: true });
      rmSync(link, { force: true });
      symlinkSync(join(scripts, t), link);
    });
  }
  if (!(process.env.PATH ?? "").split(":").includes(binDir)) console.log(`\nAdd ${binDir} to PATH to use the pstack-* tools by name.`);
  if (selected.includes("claude") && selected.some((h) => h === "opencode" || h === "grok"))
    console.log("\nNote: OpenCode and Grok Build also read ~/.claude/skills, so they may list pstack skills twice.");
}
