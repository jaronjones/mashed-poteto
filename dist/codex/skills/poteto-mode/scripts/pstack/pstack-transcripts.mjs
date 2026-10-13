#!/usr/bin/env node
// pstack-transcripts: locate and read this workspace's session transcripts for
// Claude Code, Codex CLI, Grok Build and OpenCode. See references/harness.md → Transcripts.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

const HARNESSES = ["claude", "codex", "grok", "opencode"];
const USAGE = `usage:
  pstack-transcripts list    [--harness <id|all>] [--since 7d|12h|30m] [--grep <text>] [--subagents] [--workspace <dir>]
  pstack-transcripts current [--harness <id|all>] [--id] [--workspace <dir>]
  pstack-transcripts show <path> [--grep <text>] [--role user|assistant|tool] [--workspace <dir>]
harness ids: ${HARNESSES.join(", ")}, all (default)`;

class UsageError extends Error {}

const home = () => process.env.HOME;
const truncate = (s, n = 200) => (s.length > n ? s.slice(0, n) + "…" : s);
const oneLine = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const compact = (v) => truncate(oneLine(typeof v === "string" ? v : JSON.stringify(v ?? "")));
const isInside = (dir, root) => {
  const rel = path.relative(root, dir);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};
const mtimeOf = (p) => fs.statSync(p).mtimeMs;
const listDir = (p) => {
  try {
    return fs.readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
};

function readJsonl(file) {
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // A harness may be mid-write on the last line; skip anything unparseable.
    }
  }
  return out;
}

// Reads one line without loading the file. Codex's first line can be large.
function readFirstLine(file) {
  const fd = fs.openSync(file, "r");
  try {
    const chunks = [];
    const buf = Buffer.alloc(65536);
    let pos = 0;
    for (;;) {
      const n = fs.readSync(fd, buf, 0, buf.length, pos);
      if (n === 0) break;
      const nl = buf.subarray(0, n).indexOf(10);
      if (nl >= 0) {
        chunks.push(Buffer.from(buf.subarray(0, nl)));
        break;
      }
      chunks.push(Buffer.from(buf.subarray(0, n)));
      pos += n;
    }
    return Buffer.concat(chunks).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

// ---- Claude Code: ~/.claude/projects/<slug>/<session>.jsonl ----

const claudeSlug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, "-");

function claudeCwd(file) {
  // Most lines carry `cwd`; the first few lines are enough.
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(262144);
  const n = fs.readSync(fd, buf, 0, buf.length, 0);
  fs.closeSync(fd);
  for (const line of buf.subarray(0, n).toString("utf8").split("\n")) {
    try {
      const cwd = JSON.parse(line).cwd;
      if (cwd) return cwd;
    } catch {}
  }
  return null;
}

function claudeSessions(ws, { subagents }) {
  const root = path.join(home(), ".claude", "projects");
  const slug = claudeSlug(ws);
  const out = [];
  for (const proj of listDir(root)) {
    // The slug is lossy, so it only narrows the search; `cwd` inside decides.
    if (!proj.isDirectory() || !(proj.name === slug || proj.name.startsWith(slug + "-"))) continue;
    const dir = path.join(root, proj.name);
    for (const f of listDir(dir)) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;
      const file = path.join(dir, f.name);
      const cwd = claudeCwd(file);
      if (cwd ? !isInside(cwd, ws) : proj.name !== slug) continue;
      out.push({ harness: "claude", path: file, id: f.name.slice(0, -6), mtime: mtimeOf(file) });
      if (!subagents) continue;
      const subDir = path.join(dir, f.name.slice(0, -6), "subagents");
      for (const s of listDir(subDir)) {
        if (!s.isFile() || !s.name.endsWith(".jsonl")) continue;
        const sub = path.join(subDir, s.name);
        out.push({ harness: "claude", path: sub, id: s.name.slice(0, -6), mtime: mtimeOf(sub) });
      }
    }
  }
  return out;
}

function claudeMessages(file) {
  const out = [];
  for (const o of readJsonl(file)) {
    if (o.type !== "user" && o.type !== "assistant") continue;
    const content = o.message?.content;
    if (typeof content === "string") {
      out.push({ role: o.type, text: content });
      continue;
    }
    for (const b of content ?? []) {
      if (b.type === "text") out.push({ role: o.type, text: b.text });
      else if (b.type === "tool_use") out.push({ role: "tool", text: `${b.name} ${compact(b.input)}` });
      else if (b.type === "tool_result") {
        const text = Array.isArray(b.content) ? b.content.map((c) => c.text ?? "").join(" ") : b.content;
        out.push({ role: "tool", text: `=> ${compact(text)}` });
      }
    }
  }
  return out;
}

// ---- Codex CLI: ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl ----

const codexRoot = () => path.join(process.env.CODEX_HOME || path.join(home(), ".codex"), "sessions");

function codexMeta(file) {
  try {
    const first = JSON.parse(readFirstLine(file));
    return first.type === "session_meta" ? first.payload : null;
  } catch {
    return null;
  }
}

function codexSessions(ws, { sinceMs }) {
  const out = [];
  const walk = (dir) => {
    for (const e of listDir(dir)) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) {
        const mtime = mtimeOf(p);
        if (sinceMs && mtime < sinceMs) continue; // skip the first-line read for old files
        const meta = codexMeta(p);
        if (meta?.cwd && isInside(meta.cwd, ws)) out.push({ harness: "codex", path: p, id: meta.id, mtime });
      }
    }
  };
  walk(codexRoot());
  return out;
}

function codexMessages(file) {
  const out = [];
  for (const o of readJsonl(file)) {
    if (o.type !== "response_item") continue;
    const p = o.payload ?? {};
    if (p.type === "message" && (p.role === "user" || p.role === "assistant")) {
      const text = (p.content ?? []).map((c) => c.text ?? "").join(" ");
      if (text.trim()) out.push({ role: p.role, text });
    } else if (p.type === "function_call") out.push({ role: "tool", text: `${p.name} ${compact(p.arguments)}` });
    else if (p.type === "custom_tool_call") out.push({ role: "tool", text: `${p.name} ${compact(p.input)}` });
    else if (p.type === "function_call_output" || p.type === "custom_tool_call_output") {
      out.push({ role: "tool", text: `=> ${compact(p.output)}` });
    }
  }
  return out;
}

// ---- Grok Build: ~/.grok/sessions/<encodeURIComponent(cwd)>/<id>/chat_history.jsonl ----

function grokSessions(ws) {
  const root = path.join(home(), ".grok", "sessions");
  const out = [];
  for (const d of listDir(root)) {
    if (!d.isDirectory()) continue;
    let cwd;
    try {
      cwd = decodeURIComponent(d.name);
    } catch {
      continue;
    }
    if (!path.isAbsolute(cwd) || !isInside(cwd, ws)) continue;
    for (const s of listDir(path.join(root, d.name))) {
      const file = path.join(root, d.name, s.name, "chat_history.jsonl");
      if (s.isDirectory() && fs.existsSync(file)) out.push({ harness: "grok", path: file, id: s.name, mtime: mtimeOf(file) });
    }
  }
  return out;
}

function grokMessages(file) {
  const out = [];
  for (const o of readJsonl(file)) {
    if (o.type === "user") {
      const text = Array.isArray(o.content) ? o.content.map((c) => c.text ?? "").join(" ") : o.content;
      out.push({ role: "user", text });
    } else if (o.type === "assistant") {
      if (o.content?.trim()) out.push({ role: "assistant", text: o.content });
      for (const c of o.tool_calls ?? []) out.push({ role: "tool", text: `${c.name} ${compact(c.arguments)}` });
    } else if (o.type === "tool_result") out.push({ role: "tool", text: `=> ${compact(o.content)}` });
  }
  return out;
}

// ---- OpenCode: SQLite storage, read through the `opencode` CLI, exports cached as JSON ----

const opencodeCache = () => path.join(home(), ".cache", "pstack", "opencode");

function opencodeCli(args, cwd) {
  try {
    return execFileSync("opencode", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28 });
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("opencode is not on PATH; cannot read OpenCode sessions");
    throw new Error(`opencode ${args.join(" ")} failed: ${oneLine(e.stderr) || e.message}`);
  }
}

// `opencode export` may print a status line before the JSON.
const parseLooseJson = (text) => JSON.parse(text.slice(text.search(/[[{]/)));

function opencodeExport(id, cwd) {
  const data = parseLooseJson(opencodeCli(["export", id], cwd));
  fs.mkdirSync(opencodeCache(), { recursive: true });
  const file = path.join(opencodeCache(), `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

function opencodeSessions(ws) {
  const list = parseLooseJson(opencodeCli(["session", "list", "--format", "json"], ws));
  return list
    .filter((s) => !s.directory || isInside(s.directory, ws))
    .map((s) => ({
      harness: "opencode",
      path: path.join(opencodeCache(), `${s.id}.json`),
      id: s.id,
      mtime: Number(s.time?.updated ?? s.updated ?? s.time?.created ?? 0),
    }));
}

function opencodeMessages(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (const m of data.messages ?? []) {
    const role = m.info?.role ?? m.role;
    for (const part of m.parts ?? []) {
      if (part.type === "text" && part.text?.trim()) out.push({ role, text: part.text });
      else if (part.type === "tool") {
        out.push({ role: "tool", text: `${part.tool} ${compact(part.state?.input)}` });
        if (part.state?.output != null) out.push({ role: "tool", text: `=> ${compact(part.state.output)}` });
      }
    }
  }
  return out;
}

// ---- dispatch ----

const SESSIONS = { claude: claudeSessions, codex: codexSessions, grok: grokSessions, opencode: opencodeSessions };

function detect(file) {
  const abs = path.resolve(file);
  if (isInside(abs, opencodeCache())) return "opencode";
  if (isInside(abs, codexRoot()) || /rollout-.*\.jsonl$/.test(abs)) return "codex";
  if (path.basename(abs) === "chat_history.jsonl") return "grok";
  if (abs.endsWith(".jsonl")) return "claude";
  throw new UsageError(`cannot tell which harness wrote ${file}`);
}

// The workspace a transcript belongs to, used to refuse cross-workspace reads.
function sessionCwd(harness, file) {
  if (harness === "claude") return claudeCwd(file);
  if (harness === "codex") return codexMeta(file)?.cwd ?? null;
  if (harness === "grok") return decodeURIComponent(path.basename(path.dirname(path.dirname(file))));
  return JSON.parse(fs.readFileSync(file, "utf8")).info?.directory ?? null;
}

function sessions(harness, ws, opts) {
  const ids = harness === "all" ? HARNESSES : [harness];
  const out = [];
  for (const h of ids) {
    try {
      out.push(...SESSIONS[h](ws, opts));
    } catch (e) {
      // With `all`, a missing harness is normal; say so and keep going.
      if (harness !== "all") throw e;
      process.stderr.write(`pstack-transcripts: skipping ${h}: ${e.message}\n`);
    }
  }
  return out.filter((s) => !opts.sinceMs || s.mtime >= opts.sinceMs).sort((a, b) => b.mtime - a.mtime);
}

function render(harness, file, { grep, role } = {}) {
  const read = { claude: claudeMessages, codex: codexMessages, grok: grokMessages, opencode: opencodeMessages }[harness];
  const needle = grep?.toLowerCase();
  return read(file)
    .map((m) => ({ role: m.role, line: `${m.role}: ${oneLine(m.text)}` }))
    .filter((m) => (!role || m.role === role) && (!needle || m.line.toLowerCase().includes(needle)))
    .map((m) => m.line);
}

function gitRoot(cwd) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function parseSince(s) {
  const m = /^(\d+)([dhm])$/.exec(s);
  if (!m) throw new UsageError(`--since must look like 7d, 12h or 30m, got ${s}`);
  return Date.now() - Number(m[1]) * { d: 86400e3, h: 3600e3, m: 60e3 }[m[2]];
}

function main(argv) {
  const { values: o, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      harness: { type: "string", default: "all" },
      workspace: { type: "string" },
      since: { type: "string" },
      grep: { type: "string" },
      role: { type: "string" },
      subagents: { type: "boolean", default: false },
      id: { type: "boolean", default: false },
      help: { type: "boolean", short: "h" },
    },
  });
  const [cmd, target] = positionals;
  if (o.help || !cmd) return console.log(USAGE);
  if (o.harness !== "all" && !HARNESSES.includes(o.harness)) throw new UsageError(`unknown --harness ${o.harness}`);
  if (o.role && !["user", "assistant", "tool"].includes(o.role)) throw new UsageError(`--role must be user, assistant or tool`);
  const wsArg = path.resolve(o.workspace ?? gitRoot(process.cwd()) ?? process.cwd());
  const ws = fs.existsSync(wsArg) ? fs.realpathSync(wsArg) : wsArg;
  const opts = { subagents: o.subagents, sinceMs: o.since ? parseSince(o.since) : 0 };

  if (cmd === "list") {
    for (const s of sessions(o.harness, ws, opts)) {
      if (o.grep) {
        if (s.harness === "opencode") opencodeExport(s.id, ws);
        if (render(s.harness, s.path, { grep: o.grep }).length === 0) continue;
      }
      console.log(`${new Date(s.mtime).toISOString()}\t${s.path}\t${s.id}`);
    }
  } else if (cmd === "current") {
    const [s] = sessions(o.harness, ws, opts);
    if (!s) {
      process.stderr.write(`pstack-transcripts: no ${o.harness} session found for ${ws}\n`);
      return 1;
    }
    if (s.harness === "opencode") opencodeExport(s.id, ws);
    console.log(o.id ? s.id : s.path);
  } else if (cmd === "show") {
    if (!target) throw new UsageError("show needs a transcript path");
    const harness = detect(target);
    if (harness === "opencode") {
      // Refresh the export so `show` sees the live session; fall back to the cache.
      try {
        opencodeExport(path.basename(target, ".json"), ws);
      } catch (e) {
        if (!fs.existsSync(target)) throw e;
        process.stderr.write(`pstack-transcripts: using cached export: ${e.message}\n`);
      }
    }
    if (!fs.existsSync(target)) throw new UsageError(`no such transcript: ${target}`);
    const cwd = sessionCwd(harness, target);
    if (!cwd || !isInside(cwd, ws)) {
      const hint = o.workspace ? "" : " Pass --workspace <dir> explicitly to read another workspace's transcripts.";
      process.stderr.write(`pstack-transcripts: refusing: ${target} belongs to ${cwd ?? "an unknown workspace"}, not ${ws}.${hint}\n`);
      return 2;
    }
    for (const line of render(harness, target, o)) console.log(line);
  } else {
    throw new UsageError(`unknown command ${cmd}`);
  }
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (e) {
  const usage = e instanceof UsageError || e.code?.startsWith("ERR_PARSE_ARGS");
  process.stderr.write(`pstack-transcripts: ${e.message}\n${usage ? USAGE + "\n" : ""}`);
  process.exitCode = usage ? 2 : 1;
}
