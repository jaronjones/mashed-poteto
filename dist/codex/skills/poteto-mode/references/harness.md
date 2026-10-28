# Harness mechanics (Codex CLI)

pstack skills say *what* to spawn, read, or schedule. This file says *how* on Codex CLI. Skills point here by section name.

`<scripts>` below means the `scripts/pstack/` directory next to the `poteto-mode` skill's `SKILL.md` (this file lives at `references/harness.md` under that skill). If the installer put shims on `PATH`, `pstack-run` and friends also work by bare name.

## Agent types

pstack ships four subagent types for Codex CLI:

| Type | Use | Writes? |
|---|---|---|
| `poteto-agent` | Code-writing delegates and helpers inside a `poteto-mode` playbook step. Reads `poteto-mode` in full first. | yes |
| `pstack-worker` | General-purpose spawns a skill asks for (upstream's general-purpose type). Also the runner for every Bridge spawn. | yes |
| `pstack-reader` | Native read-only spawns: reviewers, judges, explorers, investigators. | no |
| `comment-sicko` | The comment reviewer `no-comments` spawns. | no |

When pstack is installed as a plugin, the harness may namespace these types, for example `pstack:poteto-agent`. Use the exact name your spawn tool lists. A user-level install (`install.sh`) keeps the bare names.

## Model values

Role lines in `~/.config/pstack/models.md` and skill defaults use `provider/model#effort`, for example `anthropic/claude-opus-5-5#xhigh` or `xai/grok-4.7#xhigh`. Effort is one of `max`, `xhigh`, `high`, `medium`, `low`. Two aliases are always valid: `inherit-parent` and `auto`. Both mean the spawn runs on the parent chat model.

When a skill names a role, read that role's line in `~/.config/pstack/models.md`. If the file or the line is missing, use the default the skill gives.

## Spawning

Every spawn resolves to one of three routes. Pick it per model value.

1. **Parent.** The value is `inherit-parent` or `auto`. Spawn natively and leave the model unset.
2. **Native.** The provider is `openai`. Spawn natively with the `spawn_agent` tool (collect results with `wait_agent`), `model` set to the model part and `reasoning_effort` set to the effort part.
3. **Bridge.** Anything else. Codex CLI cannot run that model in a subagent, so a subagent runs it through `pstack-run`, which calls whichever installed CLI serves the provider (`claude -p` for `anthropic`, `codex exec` for `openai`, `grok -p` for `xai`, `opencode run` for any provider OpenCode is configured with).

### Native spawn parameters

- Type: `agent_type` set to the pstack type from the table above. Put the full brief in the message.
- Background: spawns run concurrently. Call `wait_agent` when you need results. Up to `[agents] max_concurrent_threads_per_session` run at once.
- Isolation: Codex has no per-spawn worktree option. Create one first (`git worktree add <dir> -b <branch>`) and tell the agent to work only inside `<dir>`. Where upstream asked for a cloud agent, `codex cloud exec` is an alternative when the user has Codex cloud set up. Otherwise use a local worktree.
- Resume or message a running agent: `send_input`, or `resume_agent` for a closed one. Close finished agents with `close_agent`.
- Nesting: depth is capped ("Agent depth limit reached"). A subagent at the cap that needs its own fan-out runs `pstack-run` directly from its shell, one process per member, because a bridged run is a fresh top-level session that can spawn.

### Bridge spawn

1. Write the full brief to a prompt file, for example `/tmp/pstack/<run>/<role>-<n>.md`.
2. Spawn a native `pstack-worker` on the Parent route, in the background, with this brief and nothing else. The runner is always `pstack-worker`, because the bridged CLI needs to write its own session state. `--readonly` enforces read-only on the bridged session itself.

   > Run this command and wait for it to finish: `<scripts>/pstack-run --model <value> [--readonly] [--agent poteto-agent] --cwd <dir> --prompt-file <file> --out <file>.out`. Then reply with the full contents of `<file>.out`, verbatim. Do not do the task yourself. If the command fails, reply with its exit code and stderr.

3. Pass `--readonly` when the upstream spawn was read-only. Pass `--agent poteto-agent` when the role is a `poteto-agent` delegate, so the bridged session reads `poteto-mode` first. Pass `--cwd` with the agent's worktree for isolated work.

`pstack-run` prints the bridged session id to stderr as `pstack-run: session <id>`. To follow up on a bridged agent, run `pstack-run --resume <id> --model <value> --prompt-file <next>` the same way.

If `pstack-run` reports that no installed CLI serves the provider, run that seat on the closest model this harness can run natively, and say so in your reply.

### Panels

A panel role (arena runners, architect runners, interrogate reviewers) is a list. One spawn runs per entry, alias entries included, so the list length sets the count. Launch every member of a panel in one message so they run concurrently. Each member takes its own route. A panel can mix native and bridged members.

### Read-only

A read-only spawn uses `pstack-reader` (native) or `--readonly` (bridge). Upstream sometimes asks for a non-read-only spawn because its read-only mode stripped MCP access. Keep that intent here: those spawns use `pstack-worker` so they keep every MCP tool, and the brief tells them not to edit files.

A bridged session has the bridged CLI's MCP servers, not this session's. Before you bridge a seat whose job depends on a specific MCP server (an investigator that owns one source, a reviewer that spot-checks tickets), check that the bridged CLI has it (`<cli> mcp list`). If it does not, run that seat on the Parent route and say so in your reply. Never let a missing server pass as a null result.

## Permissions

Unattended runs (Bridge spawns, `pstack-loop` ticks, `pstack-hookd` routes) cannot stop to ask for approval, so their permissions are set up front. Read-only runs are always read-only. Write runs default to each harness's sandbox: `acceptEdits` for `claude` and `grok`, `workspace-write` for `codex`, and opencode.json's permissions for `opencode`. In that mode a run can edit files, but commands outside the user's allowlist are denied, and Codex blocks network and writes outside the workspace (including `git push` and commits from a worktree whose `.git` lives elsewhere).

Full access is opt-in. `bridge permissions: full` in `~/.config/pstack/models.md` (written by `setup-pstack` when the user chooses it), `PSTACK_PERMISSIONS=full`, or `--permissions full` on one run switches write runs to `bypassPermissions` or `danger-full-access`. Codex fixes a subagent's sandbox in its agent file, so native `poteto-agent` and `pstack-worker` spawns get full access only after `./install.sh codex --full-access`. Never enable full access yourself. If a delegate fails on a permission or sandbox denial, report the denial and name the opt-in.

## Isolation

An isolated spawn gets its own checkout, so parallel agents never write the same files. Upstream ran these as cloud agents. Here:

- Native: create the worktree yourself (`git worktree add <dir> -b <branch> <base>`) and name `<dir>` in the brief. `codex cloud exec` is the cloud alternative when the user has Codex cloud set up.
- Bridge: create the worktree yourself and pass it as `--cwd`.
- A spawn that must drive this machine's apps, simulators, or local transcripts runs unisolated in the main checkout, or in a worktree on this machine. Never in a cloud session.

## Agent store

Long-running programs (orchestrate, multi-phase plans) keep durable state in `~/.config/pstack/store/<repo-name>/`: the ledger, `units.tsv`, standing orders, plan files, and the inbox. Upstream kept these in its agent store. Every harness and every bridged run reads the same path, so a program survives a harness restart or a switch to another harness.

## Detecting models

`<scripts>/pstack-run --list --harness codex` prints every model reachable from this machine, one per line:

`provider/model<TAB>via <cli>[<TAB>efforts=a,b,c][<TAB>default=<effort>][<TAB>native]`

`via` names the CLI a Bridge spawn would use. `efforts=` lists the efforts that CLI offers for the model, when it reports them. `default=` is the effort the CLI uses when none is passed. A requested effort above the top listed one runs at the highest listed effort at or below it (Grok tops out at `xhigh`). `native` marks models Codex CLI can run on the Native route. `setup-pstack` uses this list.

## Transcripts

`<scripts>/pstack-transcripts` reads session history for the active workspace only.

- `pstack-transcripts list --harness codex [--since 7d] [--grep <text>]` prints `mtime<TAB>path<TAB>session-id`, newest first.
- `pstack-transcripts current --harness codex` prints the path of the most recently active session's transcript in this workspace, which is this chat's when you call it from this chat. Add `--id` to print its session id instead.
- `pstack-transcripts show <path> [--grep <text>] [--role user|assistant|tool]` prints a transcript as plain lines, one message per line.
- `--harness all` covers every installed harness, for users who switch between them.

Never read another workspace's transcripts unless the user asks. `list` and `current` stay in this workspace unless you pass `--workspace <dir>` explicitly, and `show` exits 2 on a transcript from another workspace without it. In `show` output, a tool result prints as `tool: => <output>`, truncated to 200 characters.

## Loops

Codex has no recurring loop. For "run until done" inside one session, keep working toward the predicate, and use `/goal` to pin it. For a timed tick (`loop 1h`), arm `pstack-loop`. It re-wakes this session headless on the interval until a check command passes:

`<scripts>/pstack-loop start --harness codex --session <id> --every 1h --until '<check command>' --prompt-file <tick.md>`

Get `<id>` from `pstack-transcripts current --harness codex --id`. `pstack-loop list` and `pstack-loop stop <name>` manage armed loops.

Where a skill says "arm `pstack-loop` (Codex has no recurring loop; see harness.md → Loops) with interval X", use the mechanism above. Always give the loop a check that can pass or fail, not a duration.

A `pstack-loop` tick is a separate headless resume of this session. It sees the session's history, but it cannot reach subagents the live session spawned, and its output goes to `~/.config/pstack/loops/<name>.log`, not to the chat. Write tick prompts that probe durable state (the agent store, branches, PRs) and send status where the operator will see it (a PR comment, team chat, or a `pstack-hookd` route).


## Sticky mode

Upstream made `$poteto-mode` sticky through Cursor's Custom Modes. Here, `<scripts>/pstack-mode on --harness codex` (or `--harness all`; the flag is required) adds a marked block to your user-level `AGENTS.md`. The block tells every new session to apply `poteto-mode` when a playbook matches or the task needs rigor, and to stay out of the way otherwise. `pstack-mode off --harness codex` removes it. `pstack-mode status` shows the current state. Both are idempotent. Without sticky mode, start each task with `$poteto-mode`.

## MCP discovery

List the MCP servers available to this session from your tool list. Tool names carry their server's name. To confirm which servers are configured, run `codex mcp list`. A configured server whose tools are not in your session is unavailable this run, so skip it and say so.

## Webhooks, Slack and schedules

Upstream used Cursor routines and automations. Here `<scripts>/pstack-hookd` runs a local server whose routes wake a headless run of any harness:

- `pstack-hookd add <name> --harness <id> --prompt-file <file> [--model <value>] [--cwd <dir>]` creates a webhook route. It writes the sender key to `~/.config/pstack/hooks/<name>.key` (mode 600) and prints the URL. It never prints the key.
- `--slack-signing-secret-env <VAR>` makes the route a Slack Events API endpoint. It answers Slack's URL check and verifies each request signature.
- `--every <interval>` adds a schedule to the route.
- `--concurrency N` (default 1) runs up to N at once. `--queue N` (default 100) holds later wakes in order. A webhook answers 202 when it accepts a wake and 429 when the queue is full.
- `--isolate worktree [--base <ref>]` gives each run its own detached worktree of `--cwd` at `<ref>` (default `HEAD`). A clean worktree is removed after the run. One with commits, a branch, or changes is kept and its path logged. Use it for any route that writes with `--concurrency` above 1.
- `pstack-hookd serve [--port 8787] [--host 127.0.0.1]` runs every route. `pstack-hookd list` and `pstack-hookd remove <name>` manage them. Restart `serve` after `add` or `remove`.

A Slack route wakes only on new top-level human messages. Bot posts, edits and thread replies are acknowledged and dropped. Each run reads the route's prompt file fresh. Logs are under `~/.config/pstack/hooks/logs/<name>/`.

Every request body reaches the run as untrusted data inside a fenced block, after the route's prompt.
