#!/usr/bin/env node
// Run one prompt on any provider/model#effort through whichever installed agent CLI serves it.
// See ../../references/harness.md → Bridge spawn and Detecting models.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { permissionArgs, resolvePermissions } from "./permissions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const CLIS = ["claude", "codex", "grok", "opencode"];
const PROVIDER_CLI = { anthropic: "claude", openai: "codex", xai: "grok" };
const NATIVE_PROVIDER = { claude: "anthropic", codex: "openai", grok: "xai", opencode: null };
const CLAUDE_MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"];

const usage = `usage:
  pstack-run --model <provider/model#effort|inherit-parent|auto> [--via claude|codex|grok|opencode]
             [--readonly | --permissions default|full] [--agent NAME] [--cwd DIR] [--prompt-file F | --prompt TEXT | stdin]
             [--out F] [--resume SESSION] [--dry-run]
  pstack-run --list [--harness claude|codex|grok|opencode]`;

function fail(code, message) {
  process.stderr.write(`pstack-run: ${message}\n`);
  process.exit(code);
}

// ---------- model values ----------

export function parseModel(value) {
  if (value === "inherit-parent" || value === "auto") return { alias: value };
  const m = value.match(/^([a-z0-9-]+)\/([^#\s]+)(?:#([a-z]+))?$/);
  if (!m) throw new Error(`bad model value "${value}". Expected provider/model#effort, inherit-parent, or auto.`);
  const [, provider, model, effort] = m;
  if (effort && !EFFORTS.includes(effort)) throw new Error(`bad effort "${effort}". Expected one of ${EFFORTS.join(", ")}.`);
  return { provider, model, effort };
}

const onPath = (bin) => spawnSync("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" }).status === 0;

export function chooseCli(spec, via, installed) {
  if (via) {
    if (!installed.includes(via)) throw new Error(`--via ${via}: ${via} is not installed`);
    return via;
  }
  if (spec.alias) {
    const cli = installed[0];
    if (!cli) throw new Error("no agent CLI installed");
    return cli;
  }
  const preferred = PROVIDER_CLI[spec.provider];
  if (preferred && installed.includes(preferred)) return preferred;
  if (installed.includes("opencode")) return "opencode";
  throw new Error(`no installed CLI serves provider "${spec.provider}". Install ${preferred ?? "opencode"} or configure that provider in opencode.`);
}

// Highest supported effort at or below the request, when the CLI reports what it supports.
export function clampEffort(effort, supported) {
  if (!effort || !supported?.length) return effort;
  const rank = EFFORTS.indexOf(effort);
  const fits = supported.filter((e) => EFFORTS.indexOf(e) <= rank).sort((a, b) => EFFORTS.indexOf(b) - EFFORTS.indexOf(a));
  return fits[0] ?? supported[0];
}

// ---------- model catalogs ----------

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function catalog(cli) {
  const home = process.env.HOME || homedir();
  if (cli === "claude") return CLAUDE_MODELS.map((id) => ({ id: `anthropic/${id}`, efforts: EFFORTS }));
  if (cli === "codex") {
    const cache = readJson(join(process.env.CODEX_HOME || join(home, ".codex"), "models_cache.json"));
    return (cache?.models ?? [])
      .filter((m) => m.visibility !== "hide")
      .map((m) => ({ id: `openai/${m.slug}`, efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort), defaultEffort: m.default_reasoning_level }));
  }
  if (cli === "grok") {
    const cache = readJson(join(home, ".grok", "models_cache.json"));
    const fromCache = Object.entries(cache?.models ?? {})
      .filter(([, m]) => !m.info?.hidden)
      .map(([id, m]) => ({ id: `xai/${id}`, efforts: (m.info?.reasoning_efforts ?? []).map((e) => e.value), defaultEffort: m.info?.reasoning_effort }));
    if (fromCache.length) return fromCache;
    const out = spawnSync("grok", ["models"], { encoding: "utf8" }).stdout ?? "";
    return [...out.matchAll(/^\s*[*-]\s+([\w.-]+)/gm)].map(([, id]) => ({ id: `xai/${id}`, efforts: [] }));
  }
  if (cli === "opencode") {
    const out = spawnSync("opencode", ["models"], { encoding: "utf8" }).stdout ?? "";
    return out.split("\n").filter((l) => /^[\w-]+\/\S+$/.test(l.trim())).map((l) => ({ id: l.trim(), efforts: [] }));
  }
  return [];
}

function supportedEfforts(cli, spec) {
  return catalog(cli).find((m) => m.id === `${spec.provider}/${spec.model}`)?.efforts;
}

function list(harness, installed) {
  const seen = new Set();
  for (const cli of installed) {
    for (const m of catalog(cli)) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      const native = harness && m.id.startsWith(`${NATIVE_PROVIDER[harness]}/`) ? "\tnative" : "";
      const efforts = m.efforts.length ? `\tefforts=${m.efforts.join(",")}` : "";
      const fallback = m.defaultEffort ? `\tdefault=${m.defaultEffort}` : "";
      process.stdout.write(`${m.id}\tvia ${cli}${efforts}${fallback}${native}\n`);
    }
  }
}

// ---------- agent preamble ----------

function stripAgentFile(text) {
  const toml = text.match(/developer_instructions = '''\n([\s\S]*?)'''/);
  if (toml) return toml[1];
  return text.replace(/^---\n[\s\S]*?\n---\n/, "");
}

// Prefer the target CLI's own rendering of pstack so the bridged session reads instructions
// written for its harness. Falls back to the copy this script ships in.
function pstackRootFor(cli) {
  const home = process.env.HOME || homedir();
  const candidates = [
    process.env.PSTACK_HOME && join(process.env.PSTACK_HOME, cli),
    join(home, ".local", "share", "pstack", cli),
    resolve(here, "..", "..", "..", ".."),
  ].filter(Boolean);
  return candidates.find((r) => existsSync(join(r, "skills", "poteto-mode", "SKILL.md")));
}

function agentPreamble(name, cli) {
  const root = pstackRootFor(cli);
  if (!root) throw new Error("cannot find a pstack install to read agent definitions from");
  const file = [".md", ".toml"].map((ext) => join(root, "agents", name + ext)).find(existsSync);
  if (!file) throw new Error(`unknown agent "${name}" in ${join(root, "agents")}`);
  const skill = join(root, "skills", "poteto-mode", "SKILL.md");
  return `${stripAgentFile(readFileSync(file, "utf8")).trim()}\n\nThe poteto-mode skill is at ${skill}. Your parent gave you this absolute path.\n\n---\n\n`;
}

// ---------- per-CLI invocation ----------

export function buildCommand(cli, { spec, readonly, permissions = "default", cwd, resume, promptFile, outFile }) {
  const perms = permissionArgs(cli, { readonly, permissions, resume: Boolean(resume) });
  const model = spec.alias ? undefined : spec.model;
  const effort = spec.effort;
  const extra = (process.env[`PSTACK_RUN_${cli.toUpperCase()}_ARGS`] ?? "").split(" ").filter(Boolean);
  switch (cli) {
    case "claude":
      return {
        bin: "claude",
        args: [
          "-p", "--output-format", "json",
          ...perms,
          ...(model ? ["--model", model] : []),
          ...(effort ? ["--effort", effort] : []),
          ...(resume ? ["--resume", resume] : []),
          ...extra,
        ],
        stdin: true,
        parse: (stdout) => {
          const d = JSON.parse(stdout);
          return { text: d.result ?? "", session: d.session_id, error: d.is_error ? d.subtype : null };
        },
      };
    case "codex":
      return {
        bin: "codex",
        args: [
          "exec", ...(resume ? ["resume", resume] : []),
          "--json", "--skip-git-repo-check", "-o", outFile,
          ...perms,
          ...(resume ? [] : ["-C", cwd]),
          ...(model ? ["-m", model] : []),
          ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
          ...extra,
          "-",
        ],
        stdin: true,
        parse: (stdout) => {
          const events = stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
          const failed = events.find((e) => e.type === "turn.failed" || e.type === "error");
          return {
            text: existsSync(outFile) ? readFileSync(outFile, "utf8") : "",
            session: events.find((e) => e.type === "thread.started")?.thread_id,
            error: failed ? failed.error?.message ?? failed.message : null,
          };
        },
      };
    case "grok":
      return {
        bin: "grok",
        args: [
          "--prompt-file", promptFile, "--output-format", "json", "--cwd", cwd,
          ...perms,
          ...(model ? ["-m", model] : []),
          ...(effort ? ["--effort", effort] : []),
          ...(resume ? ["--resume", resume] : []),
          ...extra,
        ],
        stdin: false,
        parse: (stdout) => {
          const d = JSON.parse(stdout);
          return { text: d.text ?? "", session: d.sessionId, error: d.error ?? null };
        },
      };
    case "opencode":
      return {
        bin: "opencode",
        args: [
          "run", "--format", "json",
          ...perms,
          ...(spec.alias ? [] : ["-m", `${spec.provider}/${spec.model}`]),
          ...(effort ? ["--variant", effort] : []),
          ...(resume ? ["-s", resume] : []),
          ...extra,
          // The prompt rides as an attached file: a bare argument could parse as a flag or exceed ARG_MAX.
          "-f", promptFile, "--", "Follow the instructions in the attached prompt file exactly.",
        ],
        stdin: false,
        parse: (stdout) => {
          const events = stdout.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } });
          if (events.some((e) => e === null)) return { text: stdout, session: undefined, error: null };
          const text = events.filter((e) => e.type === "text").map((e) => e.part?.text ?? e.text ?? "").join("");
          const session = events.find((e) => e.sessionID)?.sessionID;
          const error = events.find((e) => e.type === "error");
          return { text, session, error: error ? JSON.stringify(error.error ?? error) : null };
        },
      };
  }
}

// ---------- main ----------

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: "string" },
      via: { type: "string" },
      readonly: { type: "boolean", default: false },
      permissions: { type: "string" },
      agent: { type: "string" },
      cwd: { type: "string" },
      "prompt-file": { type: "string" },
      prompt: { type: "string" },
      out: { type: "string" },
      resume: { type: "string" },
      list: { type: "boolean", default: false },
      harness: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) return console.log(usage);
  if (values.via && !CLIS.includes(values.via)) fail(2, `--via must be one of ${CLIS.join(", ")}`);
  if (values.harness && !CLIS.includes(values.harness)) fail(2, `--harness must be one of ${CLIS.join(", ")}`);

  const installed = (process.env.PSTACK_RUN_INSTALLED?.split(",") ?? CLIS.filter(onPath)).filter(Boolean);
  if (values.list) return list(values.harness, installed);
  if (!values.model) fail(2, `--model is required\n${usage}`);

  let spec, cli;
  try {
    spec = parseModel(values.model);
    cli = chooseCli(spec, values.via, installed);
  } catch (e) {
    fail(spec ? 3 : 2, e.message);
  }
  if (!spec.alias && cli === "opencode" && PROVIDER_CLI[spec.provider] && PROVIDER_CLI[spec.provider] !== "opencode")
    process.stderr.write(`pstack-run: ${PROVIDER_CLI[spec.provider]} not installed, using opencode for ${spec.provider}\n`);
  const effort = clampEffort(spec.effort, spec.alias ? undefined : supportedEfforts(cli, spec));
  if (effort !== spec.effort) process.stderr.write(`pstack-run: ${cli} does not offer effort ${spec.effort} for ${spec.model}, using ${effort}\n`);
  spec = { ...spec, effort };

  let prompt =
    values.prompt ??
    (values["prompt-file"] ? readFileSync(values["prompt-file"], "utf8") : process.stdin.isTTY ? fail(2, "no prompt given") : readFileSync(0, "utf8"));
  if (values.agent) prompt = agentPreamble(values.agent, cli) + prompt;

  const cwd = resolve(values.cwd ?? process.cwd());
  // Private per-run dir (0700, files 0600): prompts can carry webhook payloads.
  const workDir = mkdtempSync(join(tmpdir(), "pstack-run-"));
  process.on("exit", () => rmSync(workDir, { recursive: true, force: true }));
  const promptFile = join(workDir, "prompt.md");
  const outFile = values.out ? resolve(values.out) : join(workDir, "out.md");
  writeFileSync(promptFile, prompt, { mode: 0o600 });

  let permissions;
  try {
    permissions = resolvePermissions(values.permissions);
  } catch (e) {
    fail(2, e.message);
  }
  const cmd = buildCommand(cli, { spec, readonly: values.readonly, permissions, cwd, resume: values.resume, promptFile, outFile: join(workDir, "last.md") });
  if (values["dry-run"]) return console.log(JSON.stringify({ cli, bin: cmd.bin, args: cmd.args, cwd, stdin: cmd.stdin }));

  const child = spawn(process.env[`PSTACK_RUN_BIN_${cli.toUpperCase()}`] ?? cmd.bin, cmd.args, { cwd, stdio: ["pipe", "pipe", "inherit"] });
  child.on("error", (e) => fail(1, `cannot start ${cli}: ${e.message}`));
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"])
    process.on(signal, () => {
      child.kill(signal);
      fail(128 + { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 }[signal], `stopped by ${signal}`);
    });
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d));
  if (cmd.stdin) child.stdin.end(prompt);
  else child.stdin.end();
  const code = await new Promise((r) => child.on("close", r));

  let result;
  try {
    result = cmd.parse(stdout);
  } catch {
    result = { text: stdout, session: undefined, error: code ? `exit ${code}` : null };
  }
  if (result.session) process.stderr.write(`pstack-run: session ${result.session} (via ${cli})\n`);
  writeFileSync(outFile, result.text);
  process.stdout.write(result.text.endsWith("\n") ? result.text : result.text + "\n");
  if (code !== 0 || result.error) fail(code || 1, `${cli} failed: ${result.error ?? `exit ${code}`}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main();
