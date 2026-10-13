---
name: "setup-pstack"
description: "Configure which models pstack uses per role and at what reasoning budget. Detects your available models and writes a per-role config file that overrides the skill defaults. Use for /setup-pstack, \"configure pstack models\", \"pstack budget\", or changing pstack's model choices."
---

# Setup pstack

Write `~/.config/pstack/models.md`, a config file every pstack skill reads to set its model per role. Every harness pstack supports shares this one file.

## Steps

### 1. Detect available models

Run `<scripts>/pstack-run --list --harness grok`, per the `poteto-mode` skill's `references/harness.md` → Detecting models (`<scripts>` is defined there). It prints one model per line, tab-separated: `provider/model`, then `via <cli>`, then `efforts=<list>` when the CLI reports which efforts that model accepts, then `native` when Grok Build can spawn it natively. For example `xai/grok-4.7<TAB>via grok<TAB>efforts=low,medium,high,xhigh`. Add any model the `spawn_subagent` tool (collect results with `get_command_or_subagent_output`) accepts natively that the list misses. Together these are the detected set. If you cannot detect any, ask the user to paste the `provider/model` values they have access to. Never write a real value you have not confirmed is available. The aliases `inherit-parent` and `auto` are always valid even though they are not detected values.

### 2. Load current state

The default role-to-model mapping is the file shape shown in step 5 below. If `~/.config/pstack/models.md` already exists, read it and treat its `# budget` line, its `bridge permissions` line, and its role values as the current choices. Otherwise start from those defaults. A line whose role is not in step 5, such as `how critics`, is from a retired role. Drop it.

### 3. Budget, map, and confirm

**(a) Ask for a budget.** Prefer `ask_user_question` over free text. Offer these four options with these exact labels, and name the current budget when the file records one. With no file, say that `large` matches the skill defaults.

- `unlimited — max reasoning`
- `large — xhigh reasoning`
- `medium — high reasoning`
- `small — medium reasoning`

**(b) Apply it.** Build the working table from the skill defaults, and on a re-run keep any role you changed by family, list, or alias (`inherit-parent`, `auto`). `unlimited`, `large`, `medium`, and `small` set the `#effort` suffix of every real value, panel entries included, to `max`, `xhigh`, `high`, or `medium`. Efforts sit on the ladder `max` > `xhigh` > `high` > `medium` > `low`. If the model is not in the detected set, use the same family's detected model, else mark the role as needing a choice. If its `efforts=` list omits the target, use the highest listed effort at or below the target. `inherit-parent` and `auto` do not change. So `unlimited` turns `anthropic/claude-opus-5-5#xhigh` into `anthropic/claude-opus-5-5#max`. Grok tops out at `xhigh`, so under `unlimited` the fallback puts Grok at `xhigh` and keeps `xai/grok-4.7#xhigh` as it is. Check that against the `efforts=` list when `pstack-run --list` prints one, and follow the list when it differs. `large` keeps both defaults. `small` turns them into `anthropic/claude-opus-5-5#medium` and `xai/grok-4.7#medium`.

**(c) Show the roles and confirm.** Show every role with its model, marking any real value not in the detected set as needing a choice. Also list each line step 2 dropped. Ask whether to accept as-is or change specific roles, offering the detected models plus `inherit-parent` and `auto` (both mean: this role runs on the parent chat model, which is how Auto users stay on Auto) as the options. Prefer `ask_user_question` over free text. For panel roles (arena runners, architect runners, interrogate reviewers) the value is a list, and one subagent runs per entry, alias entries included, so the list length sets the count. `arena cross-judge pool` is also a list, but Arena selects one value from it whose model family differs from the parent's when possible. `swarm workers` is the default model for every worker unless a race or comparison assigns another model per arm.

**(d) Ask about unattended permissions.** Prefer `ask_user_question`. Name the current choice when the file records one, otherwise say the default is `default`. Explain in one sentence each, per the `poteto-mode` skill's `references/harness.md` → Permissions:

- `default`: bridged write runs, loop ticks, and webhook runs keep each harness's sandbox. Safer, but a run that needs the network, a push, or a command outside your allowlist stops with a denial.
- `full`: those runs get `bypassPermissions` or `danger-full-access`, the closest match to upstream's auto-run delegates. Only for machines and repos where you accept that.

Never pick `full` for the user. On `full` in Codex, also tell them to run `./install.sh codex --full-access`, because Codex sets a subagent's sandbox in its agent file.

### 4. Validate

Every real value written must be in the detected set, as `provider/model#effort`. `inherit-parent` and `auto` always pass. If a chosen real value is not available, stop and ask again.

### 5. Write the file

Write `~/.config/pstack/models.md` as plain markdown, creating `~/.config/pstack/` if needed. It holds a `# budget` line with the chosen label and its target effort, a `bridge permissions` line with the step 3(d) choice, and one line per role, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent. Shape:

```
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (the Parent spawn route). Alias entries in a panel list still count toward its fan-out.
# Every harness reads this file. A value is valid while some installed CLI serves it. Each harness decides native or bridge per spawn.
# budget: large (xhigh)
bridge permissions: default
feature, refactoring: xai/grok-4.7#xhigh
bug-fix: xai/grok-4.7#xhigh
perf-issue: xai/grok-4.7#xhigh
hillclimb: xai/grok-4.7#xhigh
judgment and prose: anthropic/claude-opus-5-5#xhigh
hardest tasks: anthropic/claude-opus-5-5#xhigh
how explorer: xai/grok-4.7#xhigh
how explainer: anthropic/claude-opus-5-5#xhigh
why investigators: xai/grok-4.7#xhigh
why synthesizer: anthropic/claude-opus-5-5#xhigh
reflect tooling: xai/grok-4.7#xhigh
reflect judgment, divergent, synthesizer: anthropic/claude-opus-5-5#xhigh
arena runners: anthropic/claude-opus-5-5#xhigh, xai/grok-4.7#xhigh
arena cross-judge pool: anthropic/claude-opus-5-5#xhigh, xai/grok-4.7#xhigh
swarm workers: xai/grok-4.7#xhigh
architect runners: anthropic/claude-opus-5-5#xhigh, xai/grok-4.7#xhigh
interrogate reviewers: anthropic/claude-opus-5-5#xhigh, xai/grok-4.7#xhigh
```

### 6. Confirm

Tell the user the file was written. It applies right away, in every harness, because skills read it each time they spawn. Re-running this skill updates it.

### 7. Offer a verification skill (optional)

Check whether the project has a way to drive the real app for proof (a `verify-*` skill, or an existing harness). If not, offer once: "want a project-local verification skill, so agents can drive the app the way a user does and prove changes work? I can generate one with /create-verification-skill." On yes, invoke `/create-verification-skill` (resolves wherever pstack is installed: workspace, user, or plugin). On no, move on without pushing.
