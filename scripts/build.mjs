#!/usr/bin/env node
// Renders src/ into dist/<harness>/ for every harness in harness/profiles.mjs, then lints the output.
// Usage: node scripts/build.mjs [--check]   (--check fails if dist/ is stale instead of writing it)

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { profiles, harnessIds } from "../harness/profiles.mjs";

const root = resolve(dirname(new URL(import.meta.url).pathname), "..");
const src = join(root, "src");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const skillNames = readdirSync(join(src, "skills")).filter((n) => statSync(join(src, "skills", n)).isDirectory());

// ---------- frontmatter ----------

export function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return { data: {}, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) throw new Error("unterminated frontmatter");
  const lines = text.slice(4, end).split("\n");
  const body = text.slice(end + 4).replace(/^\n/, "");
  const data = {};
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (/^[>|]-?$/.test(raw)) {
      const block = [];
      while (i + 1 < lines.length && (/^\s+/.test(lines[i + 1]) || lines[i + 1] === "")) block.push(lines[++i].trim());
      data[key] = raw.startsWith(">") ? block.filter(Boolean).join(" ") : block.join("\n");
    } else if (/^".*"$/.test(raw)) data[key] = JSON.parse(raw);
    else if (/^'.*'$/.test(raw)) data[key] = raw.slice(1, -1).replace(/''/g, "'");
    else if (raw === "true" || raw === "false") data[key] = raw === "true";
    else data[key] = raw;
  }
  return { data, body };
}

function yamlValue(v) {
  if (typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

function emitFrontmatter(entries) {
  const out = ["---"];
  for (const [k, v] of entries) {
    if (v === undefined) continue;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(`${k}:`);
      for (const [k2, v2] of Object.entries(v)) out.push(`  ${JSON.stringify(k2)}: ${yamlValue(v2)}`);
    } else out.push(`${k}: ${yamlValue(v)}`);
  }
  out.push("---", "");
  return out.join("\n");
}

// ---------- text rendering ----------

export function render(text, profile, file = "?") {
  let out = text.replace(/\{\{#(if|unless) ([a-z]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, kind, id, inner) => {
    if (!harnessIds.includes(id)) throw new Error(`${file}: unknown harness in conditional: ${id}`);
    return (id === profile.id) === (kind === "if") ? inner : "";
  });
  out = out.replace(/\{\{([a-z_]+)\}\}/g, (whole, key) => {
    if (typeof profile[key] !== "string") throw new Error(`${file}: unknown token ${whole}`);
    return profile[key];
  });
  if (profile.invoke !== "/") {
    const names = skillNames.map((n) => n.replace(/[-]/g, "\\-")).join("|");
    out = out.replace(new RegExp(`(^|[\\s\`(\\[])/(${names})(?![\\w/-])`, "gm"), (_, pre, name) => pre + profile.invoke + name);
  }
  return out;
}

// ---------- per-harness skill frontmatter ----------

function skillFrontmatter(dirName, data, profile) {
  const name = dirName;
  const description = data.description;
  if (!description) throw new Error(`skills/${dirName}: missing description`);
  const manualOnly = data["disable-model-invocation"] === true;
  switch (profile.id) {
    case "claude":
    case "grok":
      return emitFrontmatter([
        ["name", name],
        ["description", description],
        ["argument-hint", data["argument-hint"]],
        ["disable-model-invocation", manualOnly || undefined],
      ]);
    case "codex":
      return emitFrontmatter([["name", name], ["description", description]]);
    case "opencode":
      return emitFrontmatter([
        ["name", name],
        ["description", description],
        ["metadata", { "opencode/slash": "true", ...(manualOnly ? { "opencode/autoinvoke": "false" } : {}) }],
      ]);
  }
}

// ---------- per-harness agents ----------

function renderAgent(fileText, profile, file) {
  const { data, body } = parseFrontmatter(render(fileText, profile, file));
  const { name, description } = data;
  const readonly = data.readonly === true;
  const background = data.background === true;
  if (!name || !description) throw new Error(`${file}: agent needs name and description`);
  switch (profile.id) {
    case "claude":
      return emitFrontmatter([
        ["name", name],
        ["description", description],
        ["background", background || undefined],
        ["disallowedTools", readonly ? "Edit, Write, NotebookEdit" : undefined],
      ]) + body;
    case "grok":
      return emitFrontmatter([
        ["name", name],
        ["description", description],
        ["prompt_mode", "full"],
        ["model", "inherit"],
        ["permission_mode", readonly ? "plan" : "default"],
        ["agents_md", true],
      ]) + body;
    case "opencode":
      return emitFrontmatter([
        ["description", description],
        ["mode", "subagent"],
        ["permission", readonly ? { edit: "deny" } : undefined],
      ]) + body;
    case "codex": {
      if (body.includes("'''")) throw new Error(`${file}: body contains ''' and cannot be a TOML literal string`);
      return [
        `name = ${JSON.stringify(name)}`,
        `description = ${JSON.stringify(description)}`,
        readonly ? `sandbox_mode = "read-only"` : `sandbox_mode = "workspace-write"`,
        `developer_instructions = '''`,
        body.trimEnd(),
        `'''`,
        "",
      ].join("\n");
    }
  }
}

// ---------- manifests ----------

const meta = {
  name: "pstack",
  version: pkg.version,
  description: pkg.description,
  author: { name: "Lauren Tan (pstack); harness port: mashed-poteto" },
  homepage: pkg.homepage,
  repository: pkg.repository,
  license: "MIT",
  keywords: ["pstack", "poteto-mode", "workflow", "principles", "subagents", "unslop"],
};

function writeManifests(out, profile) {
  const write = (p, obj) => {
    mkdirSync(dirname(join(out, p)), { recursive: true });
    writeFileSync(join(out, p), JSON.stringify(obj, null, 2) + "\n");
  };
  if (profile.id === "claude") write(".claude-plugin/plugin.json", meta);
  if (profile.id === "codex")
    write("plugin.json", {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      ...meta,
      skills: "./skills/",
    });
  if (profile.id === "grok") write("plugin.json", { ...meta, skills: "./skills/", agents: "./agents/" });
}

// ---------- tree walk ----------

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === "node_modules") return [];
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function buildHarness(profile, outRoot) {
  const out = join(outRoot, profile.id);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  for (const file of walk(src)) {
    const rel = relative(src, file);
    if (rel.startsWith(`agents${sep}`)) continue;
    const dest = join(out, rel);
    mkdirSync(dirname(dest), { recursive: true });
    if (!file.endsWith(".md")) {
      cpSync(file, dest);
      continue;
    }
    let text = render(readFileSync(file, "utf8"), profile, rel);
    const skillMatch = rel.match(/^skills[\\/]([^\\/]+)[\\/]SKILL\.md$/);
    if (skillMatch) {
      const { data, body } = parseFrontmatter(text);
      text = skillFrontmatter(skillMatch[1], data, profile) + body;
      if (profile.id === "codex" && data["disable-model-invocation"] === true) {
        const yaml = join(dirname(dest), "agents", "openai.yaml");
        mkdirSync(dirname(yaml), { recursive: true });
        writeFileSync(yaml, "policy:\n  allow_implicit_invocation: false\n");
      }
    }
    writeFileSync(dest, text);
  }

  mkdirSync(join(out, "agents"), { recursive: true });
  for (const file of readdirSync(join(src, "agents"))) {
    const rel = join("agents", file);
    const text = renderAgent(readFileSync(join(src, rel), "utf8"), profile, rel);
    writeFileSync(join(out, "agents", file.replace(/\.md$/, profile.layout.agentExt)), text);
  }

  writeFileSync(join(out, "skills", "poteto-mode", "VERSION"), pkg.version + "\n");
  writeManifests(out, profile);
  return out;
}

// ---------- lint ----------

// Cursor-only constructs that must not survive into dist/. Upstream credit lines use the
// literal phrase "pstack (Cursor)" or the upstream URL, which these patterns do not match.
const forbidden = [
  [/~\/\.cursor|(^|[\s`'"(])\.cursor\//m, "Cursor path"],
  [/\bgeneralPurpose\b/, "Cursor subagent type"],
  [/\bAskQuestion\b/, "Cursor ask tool"],
  [/\.mdc\b/, "Cursor rule file"],
  [/agent-transcripts/, "Cursor transcript path"],
  [/cursor-team-kit/, "cursor-team-kit reference"],
  [/\b(claude-opus-5-5|grok-4\.7)-(max|xhigh|high|medium|low)(-fast)?\b/, "Cursor model slug"],
  [/`Task`|\bTask tool\b|\bTask call|\bTask subagent|`Task` call/, "Cursor Task tool"],
  [/Cursor's built-in|built into Cursor|\bin Cursor\b|Cursor restart|Cursor dashboard|Cursor model picker|cursor automations?|Cursor Slack|Cursor environment|Cursor subagents|Cursor's own|Cursor's docs|Cursor's Plan|Cursor protocol|api2\.cursor\.sh/i, "Cursor-specific feature"],
  [/environment: "(cloud|local)"/, "Cursor spawn environment"],
  [/\{\{|\}\}/, "unresolved token"],
];

function lint(out) {
  const problems = [];
  for (const file of walk(out)) {
    if (!/\.(md|toml|json|yaml|sh|tsv)$/.test(file)) continue;
    const rel = relative(out, file);
    const text = readFileSync(file, "utf8");
    if (/\.md$/.test(file)) {
      for (const [re, label] of forbidden) {
        const m = text.match(re);
        if (m) problems.push(`${rel}: ${label}: ${JSON.stringify(m[0])}`);
      }
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target) || !/[./]/.test(target)) continue;
        const path = target.split("#")[0];
        if (path && !existsSync(join(dirname(file), path))) problems.push(`${rel}: broken link ${target}`);
      }
    }
  }
  return problems;
}

// ---------- main ----------

export function buildAll(outRoot) {
  const problems = [];
  for (const id of harnessIds) problems.push(...lint(buildHarness(profiles[id], outRoot)).map((p) => `${id}/${p}`));
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  const outRoot = check ? mkdtempSync(join(tmpdir(), "pstack-build-")) : join(root, "dist");
  const problems = buildAll(outRoot);
  if (problems.length) {
    console.error(problems.join("\n"));
    console.error(`\n${problems.length} problem(s)`);
    process.exit(1);
  }
  if (check) {
    try {
      execFileSync("diff", ["-r", outRoot, join(root, "dist")], { stdio: "inherit" });
    } catch {
      console.error("dist/ is stale. Run: node scripts/build.mjs");
      process.exit(1);
    }
  }
  console.log(`built ${harnessIds.join(", ")} into ${outRoot}`);
}
