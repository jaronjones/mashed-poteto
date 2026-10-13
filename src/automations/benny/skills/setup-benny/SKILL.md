---
name: setup-benny
description: Configure Benny and prepare its triage and repro pstack-hookd routes. Use when installing Benny or changing its Slack, tracker, repository, routing, control, model, or budget settings.
disable-model-invocation: true
---

# Set up Benny

Benny ships as a dormant automation pack inside pstack. The plugin manifest exposes only pstack's normal skill root; this file and the two operational files are not slash skills.

The human enters setup by pointing their agent at the pack's `FOR_AGENTS.md`. The bootstrap flow copies the whole pack into the target repository, then reads this file directly at `.pstack/automations/benny/skills/setup-benny/SKILL.md`.

Benny needs external configuration and two live `pstack-hookd` routes. `pstack-hookd` lives in the `scripts/pstack/` directory next to the `poteto-mode` skill. Its mechanics are in `poteto-mode`'s `references/harness.md` → Webhooks, Slack and schedules.

- `benny-triage` is a Slack Events API route. Slack posts each new top-level message in the source channel to it.
- `benny-reproduce` is a webhook route. The triage run wakes it once, after a `bug` or `performance` verdict lands in the source thread.

Do not create or update a route until the user explicitly asks. Never put a secret value in plugin files, prompts, or committed configuration.

## 1. Copy the pack and enable shared pstack skills

Do this before asking for Benny configuration and before drafting either route.

Ask which repository will run the automations. The source pack is the directory containing `FOR_AGENTS.md`. The destination is `<target-repository>/.pstack/automations/benny/`.

Merge the entire source pack into the destination:

1. Create the destination when it is absent.
2. Copy every source file to the same relative path.
3. Preserve destination-only files. Never delete unrelated files during install or refresh.
4. Keep user-owned configuration, feature maps, and routing maps outside the destination. Never overwrite them.
5. When an existing source-managed file differs, inspect the diff and merge without discarding local edits. If ownership is ambiguous, stop and ask before replacing it.
6. Verify that the destination contains `FOR_AGENTS.md`, this setup file, both operational files, their references, and the templates.

If this file is already being read from the target destination, treat the copy as complete and run the same verification before continuing.

Ask which harness runs the routes: `claude`, `codex`, `grok`, or `opencode`. Install pstack for that harness on the machine that runs `pstack-hookd`. Run `./install.sh <harness>` from the pstack checkout there. Do not change unrelated harness settings or other plugins.

Start a fresh headless run of that harness rooted in the target repository, for example with `pstack-run --model inherit-parent --via <harness> --cwd <target-repository>`. Verify that these shared pstack skills resolve there:

- `how`
- `why`
- `tdd`
- `unslop`
- `principle-separate-before-serializing-shared-state`
- `principle-minimize-reader-load`
- `principle-guard-the-context-window`
- `principle-sequence-verifiable-units`
- `principle-fix-root-causes`
- `principle-prove-it-works`

Do not count a skill loaded from the current session. The check must show that a fresh headless run of the route harness in the target repository receives pstack.

If pstack cannot be installed for that harness or any shared dependency does not resolve, stop and explain the failure.

The Benny files are read directly from `.pstack/automations/benny/`. Do not add that directory to a plugin manifest or expect its `SKILL.md` files to appear in the slash-skill list.

Tell the user that `.pstack/automations/benny/`, the route prompts, and any referenced secret-free configuration must be committed before either route is enabled. Do not commit them unless the user asks.

Once this check passes, route prompts may read the committed operational files by their stable repository-relative paths. They must not embed a plugin cache path or copy the file contents.

## 2. Adapt the configuration

Open these copied examples:

- `../../templates/configuration.example.yaml`
- `../reproduce-and-fix-issues/references/feature-map.example.md`

Create user-owned copies outside `.pstack/automations/benny/`. These are configuration files, not pack files. Example locations:

- Project config, such as `.pstack/benny/configuration.yaml`
- Project feature map, such as `.pstack/benny/feature-map.md`
- Project routing map, such as `.pstack/benny/routing.md`
- Route prompts, such as `.pstack/benny/triage-route-prompt.md` and `.pstack/benny/reproduce-route-prompt.md`
- User config, such as `~/.config/benny/configuration.yaml`
- User feature map, such as `~/.config/benny/feature-map.md`

Fill one feature-map section for every user-facing feature the automation may reproduce. Keep it at the user point of view. Do not freeze implementation details or current code paths in the map.

Do not edit the copied examples. Pack refreshes may update source-managed files after conflict review, but they must never touch the user-owned copies.

Prefer committed, secret-free files in the target repository when a route's run must read them. Otherwise paraphrase the required values into the route prompt. Reference a repository file only after you confirm with `git` that the file is committed on the branch checked out in the route's `--cwd`.

Use stable repository-relative paths for committed pack and configuration files. Never reference the plugin source directory or a plugin cache path from a route prompt.

## 3. Fill the required choices

Ask for or confirm:

- Source Slack channel ID
- Optional operations or status channel ID
- Repository URL and default branch
- Triage identity or Slack user ID
- Issue tracker type, team, project, labels, and intake status
- Tracker adapter skill or MCP actions
- Optional routing map path
- Required control skill name
- Required user-facing feature-map path
- Status emoji strings
- Pull request URL format
- Polling and effort budgets
- Route harness that runs both routes
- Route checkout directory, a clone of the repository on the default branch that the routes use as `--cwd`
- Slack signing secret environment variable name
- Triage and repro concurrency
- Model value for triage, repro, code work, and media review

Use only `provider/model#effort` values whose model `pstack-run --list` shows on the machine that runs `pstack-hookd`, or `inherit-parent` for the route harness's default model. Do not guess a value and do not carry over a private default. The triage and repro values become each route's `--model`. Runs spawn code-work and media-review subagents with their values per `harness.md` → Spawning.

The source channel, triage identity, repository, route harness, tracker adapter, control skill, and feature map must be explicit. Fail setup if any required value stays ambiguous.

Use pstack's `unslop` skill on the final route names and route prompts before saving them.

## 4. Check integration capabilities

The triage automation needs:

- Read access to the configured source Slack channel and its threads
- Thread-reply access in that channel
- Attachment metadata and file download access when reports include media
- Search, read, create, and update access through the configured issue-tracker adapter

The repro automation needs:

- Read access to the source thread
- Thread-reply access in the source channel
- Optional post and edit access in the configured operations channel
- Repository read and history access
- A pull request action that can open a draft pull request
- The configured control-adapter skill

Both routes run headless on the route harness, so its Slack MCP must be configured for that harness on the `pstack-hookd` machine. Check it per `harness.md` → MCP discovery. The Slack identity it posts as is the triage identity.

The triage route also needs a Slack app whose Event Subscriptions deliver `message.channels` (or `message.groups` for a private channel) to `benny-triage`, and whose signing secret is in the configured environment variable of the `pstack-hookd serve` process. The Slack app delivers events only for channels it is a member of.

Prefer the harness's Slack MCP for reads and posts. The optional `BENNY_SLACK_BOT_TOKEN` may fill a narrow gap such as editing one operations status message or downloading an attachment. Store the value in a secret manager or environment, not in YAML.

Do not use undocumented integration endpoints.

## 5. Prepare the routing map

If the user wants reroutes or owner pings:

1. Copy `../triage-issue-reports/references/routing.example.md` outside `.pstack/automations/benny/`.
2. Replace every placeholder with public or organization-local values.
3. Keep owner pings off by default.
4. Allow a ping only for a configured feature owner or a confirmed likely regression author.

If no routing map is configured, triage may classify a report but must not guess a destination or owner.

## 6. Verify the control adapter

Read `../reproduce-and-fix-issues/references/control-adapter.md` and the user's completed feature map.

Confirm that the named skill can:

- Bring up the target app
- Navigate every mapped feature through the real UI
- Exercise mapped states through declared adapter actions
- Inspect state without forcing the result
- Capture screenshots
- Start and stop a recording
- Clean up its processes and temporary data

If any capability is missing, leave the repro route uncreated.

Ask how many repros the adapter can run at once without sharing an app instance, port, profile, account state, or screen recording. Set `routes.reproduce_concurrency` to that number. Use 1 when the answer is unclear. It must fail closed rather than claim a reproduction it did not perform.

## 7. Prepare the live routes

Ask whether this is first-time creation or configuration of existing routes. Run `pstack-hookd list` to see which Benny routes already exist.

Read `../../FOR_AGENTS.md` from the copied pack as the primary user-intent source for either path. Use it to understand the two triggers, tools, instructions, outcomes, and shared rules.

### First-time creation

Create one route at a time. Start with triage. The triage handoff fails closed while the repro route does not exist, so triage can run alone.

For each route:

1. Read the matching copied prompt template as secondary internal source material.
2. Turn `FOR_AGENTS.md`, the finished Benny configuration, and the template intent into a complete natural-language route prompt.
3. Tell the route prompt to read and follow its exact committed operational file under `.pstack/automations/benny/`.
4. Use the stable repository-relative path, not a plugin source or cache path. Do not copy the operational file contents into the route prompt.
5. Save the route prompt outside the pack at the configured prompt path.
6. Confirm with `git` that the copied pack, the route prompt, and any referenced configuration files are committed on the branch checked out in the route checkout directory.
7. Show the user a draft table with the route name, kind, harness, model, `--cwd`, and the full prompt. Get explicit approval.
8. Ask whether the user is ready to create the route. Run `pstack-hookd add` only after a yes.
9. Finish this route's setup before starting the next one.

Give the triage route prompt this complete intent, filled from configuration:

- Name `benny-triage`.
- Read and follow `.pstack/automations/benny/skills/triage-issue-reports/SKILL.md` for every run.
- Map the appended Slack Events payload to the trigger, and stop unless it is a new top-level report in the configured source Slack channel.
- Read the triggering thread and reply only inside it.
- Use the configured issue-tracker integration.
- Classify, inspect evidence, trace cause, dedupe, and create only clear new bugs.
- End one thread-only verdict with the configured `[benny:bug]`, `[benny:performance]`, or `[benny:other]` marker and optional tracker URL.
- Wake the repro route after a landed `bug` or `performance` verdict, as the operational file describes.
- Never post a source-channel root message.

Create it as a Slack route:

```
pstack-hookd add benny-triage --harness <routes.harness> --model <models.triage> \
  --cwd <route checkout> --prompt-file <routes.triage_prompt_path> \
  --slack-signing-secret-env <routes.slack_signing_secret_env> \
  --concurrency <routes.triage_concurrency> --isolate worktree --base <repository.default_branch>
```

Triage writes no files, but each run still gets its own worktree. Parallel runs then never see each other's state or a moving checkout.

Then wire Slack to it:

1. Restart `pstack-hookd serve` with the signing secret in its environment. Read the secret from the user's secret manager. Never paste it in chat or a file in the repository.
2. `pstack-hookd` binds `127.0.0.1`. Slack needs a public HTTPS URL. Expose only the `/hooks/benny-triage` path through a tunnel the user trusts, for example `tailscale funnel --bg --set-path /hooks/benny-triage http://127.0.0.1:8787/hooks/benny-triage`. Never expose any other route.
3. Ask the user to set that HTTPS URL as the Slack app's Event Subscriptions Request URL. Slack verifies it with a signed challenge that `benny-triage` answers.
4. Do not invite the Slack app to the source channel yet. That is the enable step.

After the triage route is set up, give the repro route prompt this complete intent:

- Name `benny-reproduce`.
- Read and follow `.pstack/automations/benny/skills/reproduce-and-fix-issues/SKILL.md` for every run.
- Wake when the triage run posts the frozen source coordinates of a report in the configured source Slack channel.
- Use the configured repository and default branch.
- Read the source thread and reply only inside it.
- Include pull request creation and the configured tracker, control-adapter, and feature-map requirements. Paraphrase mapped user paths and states unless you confirm an eligible committed file in the same repository.
- Confirm a trusted triage marker before acting.
- Reproduce the exact symptom twice through the mapped real UI and capture evidence.
- Verify an existing fix without authoring over it.
- Attempt an optional bounded fix only after confirmed repro, then open a draft pull request when proof and checks pass.
- Never post a source-channel root message.

Create it as a webhook route on the same machine:

```
pstack-hookd add benny-reproduce --harness <routes.harness> --model <models.reproduce> \
  --cwd <route checkout> --prompt-file <routes.reproduce_prompt_path> \
  --concurrency <routes.reproduce_concurrency> --isolate worktree --base <repository.default_branch>
```

`add` writes the sender key to the key file and prints its path. Set `routes.reproduce_key_file` and `routes.reproduce_url` from that output. Never read, print, or copy the key. Keep this route on localhost. Restart `pstack-hookd serve`.

Both routes start from one checkout, and every run works in its own worktree of the default branch. Keep that branch current in the route checkout, for example with a scheduled `git pull --ff-only`. Reports beyond the concurrency wait in order in each route's queue.

A repro run that commits or leaves changes keeps its worktree under `~/.config/pstack/hooks/worktrees/benny-reproduce/`, and the `pstack-hookd` log names the path. That keeps a draft-fix branch safe until its pull request lands. Tell the user to remove kept worktrees with `git worktree remove` once they are done with them.

### Existing routes

Do not add a second route for a job that already has one.

Finish configuration, routing, control-adapter, and feature-map validation. Then give the user this concise checklist.

For the existing triage route, check:

- Route prompt file and its direct instruction to read `.pstack/automations/benny/skills/triage-issue-reports/SKILL.md`
- Slack route kind, signing secret variable, and source channel
- Route harness, model, and `--cwd`
- Slack thread read and reply capabilities through the harness's Slack MCP
- Issue-tracker integration
- Paraphrased triage instructions, thread-only rule, Benny verdict markers, and repro handoff

For the existing repro route, check:

- Route prompt file and its direct instruction to read `.pstack/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`
- Webhook route kind and the key file path in configuration
- Route harness, model, and `--cwd`
- Repository and default branch
- Slack thread read and reply capabilities
- Pull request action
- Tracker, control-adapter, and feature-map requirements
- Paraphrased marker check, evidence, verification, and bounded-fix instructions

A route reads its prompt file on every run, so prompt changes need only an edit and a commit. Changing the harness, model, `--cwd`, or kind means `pstack-hookd remove` and `add` again. Do either only after the user confirms. Re-adding `benny-reproduce` writes a new key, so update `routes.reproduce_key_file` if its path changed.

### Creation boundary

Never call a Slack or tracker admin API to create apps, channels, or subscriptions on the user's behalf. Never put a key, signing secret, or token in a route prompt, a command line you print, or a committed file. The only way to create a route is `pstack-hookd add` after the user's explicit approval.

Do not enable either route until the thread-safety test passes.

## 8. Test thread safety

Use a test channel or a harmless test report.

Before testing, confirm that `.pstack/automations/benny/`, both route prompts, and every referenced secret-free configuration file are committed on the branch checked out in the route checkout. Confirm that both route prompts point at their exact committed operational files. If any check fails, stop. Tell the user that the route cannot be enabled yet.

Verify:

1. Triage stores the root `thread_ts` and posts exactly one verdict as a reply.
2. The verdict contains one configured marker.
3. Repro accepts the marker only from the configured triage identity.
4. Repro keeps the same immutable source coordinates.
5. No source-channel root message appears.
6. A delegated worker cannot use any Slack write action.
7. Missing coordinates, a deleted parent, or a failed preflight produces no post and no tracker issue.

Read each run's log under `~/.config/pstack/hooks/logs/<route>/` to check the run output.

Enable normal traffic only after all seven checks pass. Enabling means inviting the Slack app to the source channel.
