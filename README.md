# mashed-poteto

[pstack](https://github.com/cursor/plugins/tree/main/pstack) by Lauren Tan ([poteto](https://x.com/poteto)), ported from Cursor to **Claude Code**, **Codex CLI**, **OpenCode** and **Grok Build**. Every skill, playbook, agent, script and template is kept. Cursor-only features are replaced with harness-native equivalents or with small shipped tools.

The full user README is [`src/README.md`](src/README.md). Each harness gets its own rendering of it in `dist/<harness>/README.md`.

## Install

Claude Code (plugin, skills namespaced as `pstack:<name>`):

```
/plugin marketplace add jaronjones/mashed-poteto
/plugin install pstack@mashed-poteto
```

Grok Build: `grok plugin install <clone>/dist/grok --trust`.
Codex CLI: `codex plugin marketplace add jaronjones/mashed-poteto`, then `codex plugin add pstack`, then `./install.sh codex --plugin` from a clone for the agents.
OpenCode, or any harness at user level: `./install.sh <claude|codex|opencode|grok|all>` from a clone (`--dry-run` to preview).

Then run `/setup-pstack` (`$setup-pstack` on Codex) and start tasks with `/poteto-mode`.

## Layout

| Path | What |
|---|---|
| `upstream/` | Pristine pstack and the three bundled cursor-team-kit skills, at the commit in `upstream/COMMIT`. |
| `src/` | The harness-neutral port. Edit here. |
| `harness/profiles.mjs` | Per-harness token values. |
| `scripts/build.mjs` | Renders `src/` into `dist/<harness>/` and lints for leftover Cursor coupling and broken links. |
| `dist/` | Generated, committed so plugin marketplaces can install from git. `npm run check` fails if it is stale. |
| `PORTING.md` | Conventions, the token table, and what replaced each Cursor-only feature. |
| `src/skills/poteto-mode/references/harness.md` | How each harness spawns subagents, bridges models, loops, reads transcripts, and isolates work. |

## Develop

```
node scripts/build.mjs   # render dist/
npm test                 # node:test suite
npm run check            # fail if dist/ is stale
```

## License

MIT. pstack is © Lauren Tan, and the bundled cursor-team-kit skills are © Cursor (see `upstream/cursor-team-kit/LICENSE`).
