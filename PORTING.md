# Porting conventions

mashed-poteto is a port of [pstack](https://github.com/cursor/plugins/tree/main/pstack) (Cursor) to Claude Code, Codex CLI, OpenCode and Grok Build. The port is based on cursor/plugins@dbf49813a39c1a5389c5e28cb8e4c1c2379e2454. `src/` holds the ported, harness-neutral source. `scripts/build.mjs` renders `src/` into `dist/<harness>/` for each target.

## Rules for `src/`

1. Keep every upstream behavior. A Cursor-only capability gets an equivalent, never a deletion. When a harness lacks the primitive, the shipped tools in `skills/poteto-mode/scripts/pstack/` supply it.
2. Change only what is Cursor-coupled. Keep upstream wording elsewhere so upstream syncs stay diffable.
3. Never name a harness-specific tool, path or command directly in `src/`. Use a token from the table below. The build fails on unresolved tokens and on leftover Cursor references.
4. Model values are `provider/model#effort`, for example `anthropic/claude-opus-5-5#xhigh` or `xai/grok-4.7#xhigh`. Upstream's Cursor slugs (`claude-opus-5-5-xhigh`, `grok-4.7-xhigh-fast`) map to these.
5. Mechanics (how to spawn with a model, panels, transcripts, loops, isolation) live in one place: `skills/poteto-mode/references/harness.md`. Skills say what to do and point there for how.

## Tokens

Tokens are `{{name}}`. Values per harness live in `harness/profiles.mjs`.

| Token | Meaning | Claude Code example |
|---|---|---|
| `{{harness}}` | Harness display name | Claude Code |
| `{{spawn_tool}}` | The subagent spawn tool, formatted | the `Agent` tool |
| `{{todo_tool}}` | The todo or plan tool | the task list tools (`TaskCreate`/`TaskUpdate`) |
| `{{ask_tool}}` | The structured ask-the-user tool | `AskUserQuestion` |
| `{{invoke}}` | Prefix to invoke a skill by name | `/` |
| `{{project_skills_dir}}` | Where project-local skills live | `.claude/skills` |
| `{{user_skills_dir}}` | Where user-level skills live | `~/.claude/skills` |
| `{{instructions_file}}` | Always-on project instructions file | `CLAUDE.md` |
| `{{loop}}` | How to run a recurring tick, as a phrase | `/loop` |
| `{{models_file}}` | The per-role model config | `~/.config/pstack/models.md` |
| `{{plan_mode}}` | The harness's plan mode, as a phrase | Claude Code's plan mode |
| `{{agent_list}}` | Where to check a running agent's status | the background task list |

Conditional text: `{{#if claude}}...{{/if}}`, also `codex`, `opencode`, `grok`, and negation `{{#unless claude}}...{{/unless}}`. Use these sparingly, for a sentence or two. Anything longer belongs in `harness.md`.

## Replacements for Cursor-only capabilities

| Cursor | Port |
|---|---|
| `Task` with `subagent_type`, `model`, `readonly`, `run_in_background` | "Spawn a subagent" per `harness.md` → Spawning. It names the native type when the harness can run the model, and otherwise a bridge subagent that runs `pstack-run`. |
| `subagent_type: generalPurpose` | the harness's general-purpose agent type, per `harness.md` |
| `readonly: true` / Ask mode | "read-only" spawn, per `harness.md` → Read-only |
| `environment: "cloud"` | "isolated" spawn: its own git worktree, or the harness's cloud or remote mode where one exists, per `harness.md` → Isolation |
| `~/.cursor/rules/pstack-models.mdc` | `{{models_file}}`, same line format |
| `agent-transcripts/` and `~/.cursor/projects/<slug>/...` | `pstack-transcripts` (`list`, `current`, `show`), per `harness.md` → Transcripts |
| `/loop` | `{{loop}}`, per `harness.md` → Loops (`pstack-loop` where there is no native loop) |
| `AskQuestion` | `{{ask_tool}}` |
| todolist | `{{todo_tool}}` |
| Cursor's built-in `create-skill` | the bundled **create-skill** skill |
| `cursor-team-kit` (`deslop`, `control-cli`, `control-ui`) | bundled as **deslop**, **control-cli**, **control-ui** |
| Custom Modes (sticky `/poteto-mode`) | per `harness.md` → Sticky mode |
| Cursor Automations, Grok Bot webhook routines | `pstack-hookd` routes (webhook, Slack events, schedule) that wake a headless run |
| Cursor dashboard, cloud agent status | `{{agent_list}}` |
| `mcps/` directory listing | the harness's MCP/tool listing, per `harness.md` → MCP discovery |
| Bugbot | unchanged. It is a GitHub reviewer and works with any harness. |

## Syncing with upstream

1. Clone cursor/plugins and diff `pstack/` (and `cursor-team-kit/skills/{deslop,control-cli,control-ui}`) between the base commit above and the new one.
2. Apply each change to the matching file in `src/`, applying the rules above to anything Cursor-coupled.
3. Run `node scripts/build.mjs` and `npm test`, then record the new base commit in this file.

## Tools shipped in `skills/poteto-mode/scripts/pstack/`

- `pstack-run`: run a prompt on any `provider/model#effort` through whichever installed CLI serves it (`claude -p`, `codex exec`, `grok -p`, `opencode run`).
- `pstack-transcripts`: locate and read this workspace's session transcripts for any harness.
- `pstack-loop`: re-wake a headless session on an interval until a check passes, for harnesses without a native loop.
- `pstack-hookd`: a local webhook, Slack-events and schedule server that wakes a headless run. Replaces Cursor routines and automations.
