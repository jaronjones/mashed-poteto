#!/usr/bin/env node
// pstack-loop: re-wake a headless harness session on an interval until a check
// passes, for harnesses without a native loop. See references/harness.md → Loops.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { permissionArgs, resolvePermissions } from "./permissions.mjs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const HARNESSES = ["codex", "opencode", "claude", "grok"];
const USAGE = `usage:
  pstack-loop start --harness <${HARNESSES.join("|")}> --session <id> --every <30s|10m|1h|1d>
                    --prompt-file <file> [--until '<shell check>'] [--max <n>] [--name <name>]
                    [--permissions default|full]
  pstack-loop list
  pstack-loop stop <name>`;

class UsageError extends Error {}

const loopsDir = () =>
  path.join(process.env.PSTACK_CONFIG_DIR || path.join(process.env.HOME, ".config", "pstack"), "loops");
const stateFile = (name) => path.join(loopsDir(), `${name}.json`);
const logFile = (name) => path.join(loopsDir(), `${name}.log`);

function readState(name) {
  try {
    return JSON.parse(fs.readFileSync(stateFile(name), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function writeState(state) {
  const tmp = `${stateFile(state.name)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, stateFile(state.name));
}

const log = (name, msg) => fs.appendFileSync(logFile(name), `${new Date().toISOString()} ${msg}\n`);

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

function parseInterval(s) {
  const m = /^(\d+)([smhd])$/.exec(s ?? "");
  if (!m || Number(m[1]) === 0) throw new UsageError(`--every must look like 30s, 10m, 1h or 1d, got ${s}`);
  return Number(m[1]) * { s: 1e3, m: 60e3, h: 3600e3, d: 86400e3 }[m[2]];
}

// The headless resume command for each harness. The prompt goes on stdin for codex.
function resumeCommand(harness, session, prompt, permissions = "default") {
  const bin = process.env[`PSTACK_LOOP_BIN_${harness.toUpperCase()}`] || harness;
  const perms = permissionArgs(harness, { readonly: false, permissions, resume: true });
  switch (harness) {
    case "codex":
      return { bin, args: ["exec", "resume", session, ...perms, "-"], input: prompt };
    case "opencode":
      return { bin, args: ["run", "-s", session, ...perms, prompt] };
    case "claude":
      return { bin, args: ["-p", "-r", session, ...perms, prompt] };
    case "grok":
      return { bin, args: ["-r", session, ...perms, "-p", prompt] };
  }
}

function start(o) {
  if (!HARNESSES.includes(o.harness)) throw new UsageError(`--harness must be one of ${HARNESSES.join(", ")}`);
  if (!o.session) throw new UsageError("--session is required");
  if (!o["prompt-file"]) throw new UsageError("--prompt-file is required");
  const everyMs = parseInterval(o.every);
  const promptFile = path.resolve(o["prompt-file"]);
  if (!fs.existsSync(promptFile)) throw new UsageError(`no such prompt file: ${promptFile}`);
  let permissions;
  try {
    permissions = resolvePermissions(o.permissions);
  } catch (e) {
    throw new UsageError(e.message);
  }
  const max = o.max === undefined ? null : Number(o.max);
  if (max !== null && !(Number.isInteger(max) && max > 0)) throw new UsageError("--max must be a positive integer");
  const name = o.name ?? `${o.harness}-${o.session.slice(0, 8)}`;
  if (!/^[\w.-]+$/.test(name)) throw new UsageError(`--name may only use letters, digits, '.', '_' and '-'`);

  fs.mkdirSync(loopsDir(), { recursive: true });
  const prev = readState(name);
  if (prev?.status === "running" && alive(prev.pid)) throw new UsageError(`loop ${name} is already running (pid ${prev.pid})`);

  const state = {
    name,
    harness: o.harness,
    session: o.session,
    every: o.every,
    everyMs,
    until: o.until ?? null,
    max,
    permissions,
    promptFile,
    cwd: process.cwd(),
    status: "running",
    ticks: 0,
    startedAt: new Date().toISOString(),
    pid: null,
  };
  writeState(state);
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "run", name], {
    detached: true,
    stdio: "ignore",
    cwd: state.cwd,
    env: process.env,
  });
  child.unref();
  // The worker may already have finished a tick; update only the pid.
  writeState({ ...readState(name), pid: child.pid });
  log(name, `armed: ${o.harness} session ${o.session} every ${o.every}`);
  console.log(`pstack-loop: ${name} armed (pid ${child.pid}), log ${logFile(name)}`);
}

// Ends the loop unless `stop` already did. Never overwrites a stop.
function finish(name, status, reason) {
  const state = readState(name);
  if (state?.status !== "running") return;
  writeState({ ...state, status, reason, endedAt: new Date().toISOString() });
  log(name, `${status}: ${reason}`);
}

async function run(name) {
  const logFd = fs.openSync(logFile(name), "a");
  for (;;) {
    let state = readState(name);
    if (state?.status !== "running") return;
    await sleep(state.everyMs);
    state = readState(name);
    if (state?.status !== "running") return;

    if (state.until) {
      const check = spawnSync("sh", ["-c", state.until], { cwd: state.cwd, stdio: ["ignore", logFd, logFd] });
      if (check.status === 0) return finish(name, "done", "check passed");
      log(name, `check exited ${check.status ?? check.signal}`);
    }

    // Ticks run synchronously in this worker, so they never overlap.
    const prompt = fs.readFileSync(state.promptFile, "utf8");
    const { bin, args, input } = resumeCommand(state.harness, state.session, prompt, state.permissions);
    log(name, `tick ${state.ticks + 1}: ${bin} ${args.slice(0, -1).join(" ")} …`);
    const res = spawnSync(bin, args, {
      cwd: state.cwd,
      input,
      stdio: [input === undefined ? "ignore" : "pipe", logFd, logFd],
    });
    log(name, `tick ${state.ticks + 1} exited ${res.error ? res.error.message : (res.status ?? res.signal)}`);

    state = readState(name);
    if (state?.status !== "running") return;
    const ticks = state.ticks + 1;
    writeState({ ...state, ticks, lastTickAt: new Date().toISOString() });
    if (state.max && ticks >= state.max) return finish(name, "done", `reached --max ${state.max}`);
  }
}

function list() {
  let files = [];
  try {
    files = fs.readdirSync(loopsDir()).filter((f) => f.endsWith(".json"));
  } catch {}
  if (files.length === 0) return console.log("pstack-loop: no loops");
  for (const f of files.sort()) {
    const s = readState(f.slice(0, -5));
    const status = s.status === "running" && !(s.pid && alive(s.pid)) ? "dead" : s.status;
    console.log([s.name, status, s.harness, s.session, `every ${s.every}`, `ticks ${s.ticks}`, s.until ?? "-"].join("\t"));
  }
}

function stop(name) {
  if (!name) throw new UsageError("stop needs a loop name");
  const state = readState(name);
  if (!state) throw new UsageError(`no loop named ${name}`);
  if (state.status !== "running") return console.log(`pstack-loop: ${name} already ${state.status}`);
  writeState({ ...state, status: "stopped", reason: "stopped by user", endedAt: new Date().toISOString() });
  if (state.pid && alive(state.pid)) {
    // The worker leads its own process group; kill the group so a running tick dies too.
    try {
      process.kill(-state.pid, "SIGTERM");
    } catch {
      try {
        process.kill(state.pid, "SIGTERM");
      } catch {}
    }
  }
  log(name, "stopped by user");
  console.log(`pstack-loop: ${name} stopped`);
}

async function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      harness: { type: "string" },
      session: { type: "string" },
      every: { type: "string" },
      until: { type: "string" },
      max: { type: "string" },
      "prompt-file": { type: "string" },
      name: { type: "string" },
      permissions: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, name] = positionals;
  if (o.help || !cmd) return console.log(USAGE);
  if (cmd === "start") return start(o);
  if (cmd === "list") return list();
  if (cmd === "stop") return stop(name);
  if (cmd === "run") return run(name);
  throw new UsageError(`unknown command ${cmd}`);
}

main(process.argv.slice(2)).catch((e) => {
  const usage = e instanceof UsageError || e.code?.startsWith("ERR_PARSE_ARGS");
  process.stderr.write(`pstack-loop: ${e.message}\n${usage ? USAGE + "\n" : ""}`);
  process.exitCode = usage ? 2 : 1;
});
