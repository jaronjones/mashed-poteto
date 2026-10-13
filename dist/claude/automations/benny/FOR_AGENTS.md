# benny automation intent

## what i want to automate

i want two `pstack-hookd` routes that work together in one slack issue channel.

### automation 1: triage issue reports

- trigger: when someone posts a new top-level report in my configured source slack channel, i want this route to start on that report and keep its original thread coordinates. slack delivers the report to a slack events route on my `pstack-hookd`.
- behavior: i want it to read the thread and attachments, classify the report as a bug or performance issue, feature request, question or feedback, or reroute, and trace the likely owning layer before routing.
- tracker: i want it to search my configured tracker for duplicates, update a confident duplicate, and create a ticket only for a clear net-new bug.
- tools: i want slack thread read and reply access, my configured tracker integration, and my optional routing map.
- outcome: i want exactly one reply in the source thread with a short verdict and `[benny:bug]`, `[benny:performance]`, or `[benny:other]`. a bug or performance marker may include the tracker url.
- handoff: after a bug or performance verdict lands, i want it to wake the repro route once with the same source coordinates.
- boundary: i never want this automation to post a root message in the source channel.

### automation 2: reproduce and fix confirmed bugs

- trigger: i want this route to start when the triage run wakes it for the same top-level report, then confirm the trusted triage marker in the original thread.
- gates: i want it to stop when someone clearly owns the fix. if an existing pull request or merged commit may fix the report, i want verification instead of a competing change.
- behavior: i want it to use my configured control adapter and feature map, reproduce the exact symptom twice through the real ui, and capture screenshots, video, and a read-only state cross-check.
- fix: i want it to verify existing pull requests without authoring over them. after a confirmed repro, it may attempt one bounded root-cause fix, use tdd when the test is cheap, smoke the blast radius, and open a draft pull request only when before-and-after proof passes.
- tools: i want slack thread read and reply access, repository and history access, draft pull request creation, my configured tracker, and my control adapter.
- outcome: i want evidence and a verified result in the source or optional operations threads, plus an optional draft pull request. updates should be concise.
- boundary: i never want this automation to post a root message in the source channel.

### shared rules

- i want the source channel and root thread coordinates to stay immutable for the whole run.
- i treat utility and debug bots as evidence, not delegation or fix ownership.
- i allow subagents to help, but they cannot post to slack or receive slack credentials.
- i want this entire pack committed at `.pstack/automations/benny/` in the target repository. its `SKILL.md` files are direct automation instructions, not registered plugin skills.
- i want pstack installed for the harness that runs the routes (`./install.sh <harness>`) on the machine running `pstack-hookd`, only for shared dependencies such as `how`, `why`, `tdd`, `unslop`, and the required principle skills.
- i want each route prompt to read its committed operational file directly. i do not want plugin cache paths, copied excerpts, or slash-skill discovery.
- i keep user-owned configuration, feature maps, routing maps, route prompts, and secrets outside `.pstack/automations/benny/` so pack refreshes cannot overwrite them.
- i want both automations to fail closed when channel coordinates, tracker access, the control adapter, or the feature map are missing or uncertain.
- i want draft pull requests only. do not merge or deploy.

### my configuration

- source slack channel: `<channel>`
- optional operations channel: `<channel or none>`
- repository and default branch: `<repo>`, `<branch>`
- tracker: `<type, team, project, labels, intake status>`
- routing map: `<path or none>`
- triage identity: `<slack identity>`
- control skill: `<configured skill or adapter>`
- feature map: `<committed same-repo path outside the copied pack, or behavior to paraphrase>`
- route harness: `<claude, codex, grok, or opencode>`
- models: `<triage, reproduce, code, media review>`
- status emoji strings: `<seen, reproducing, reproduced, blocked, fixing, failed, pull request opened>`
- budgets: `<polling, verdict wait, follow-up, repro, rejection, fix>`
- optional bot token capability: `<none, file download, or editable operations status>`

start from [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md). copy and fill them outside this pack, for example under `.pstack/benny/`. keep secret values in a secret manager or environment.

## for the agent

the human enters setup by pointing their agent at this file. do not look for or invoke a discovered benny slash skill.

1. ask which repository will run the automations.
2. treat the directory containing this `FOR_AGENTS.md` as the source pack.
3. merge the entire source pack into `<target-repository>/.pstack/automations/benny/`.
4. preserve every destination-only file. never delete unrelated files or overwrite user-owned configuration, feature maps, routing maps, or route prompts.
5. when an existing destination file at a source-managed path differs, review the diff and merge without discarding local edits. if ownership is ambiguous, stop and ask before replacing it.
6. verify that the copied `FOR_AGENTS.md` and `skills/setup-benny/SKILL.md` exist in the target repository.
7. read and follow `.pstack/automations/benny/skills/setup-benny/SKILL.md` directly from the target repository.

i want pstack installed for the harness that runs the routes, on the machine that runs `pstack-hookd`. run `./install.sh <harness>` from the pstack checkout there. do not change unrelated harness settings or other plugins.

i want verification from a fresh headless run of that harness rooted in the target repository. confirm that pstack's `how`, `why`, `tdd`, `unslop`, and the principle skills used by benny resolve there. do not count skills loaded from the current session.

if pstack cannot be installed for that harness or any shared dependency does not resolve, stop and explain what failed. do not add `.pstack/automations/benny/skills/` to a plugin manifest or expect its files to appear in the slash-skill list.

tell me that `.pstack/automations/benny/`, the route prompts, and any referenced secret-free configuration must be committed before either route is enabled. do not create or update a route until i explicitly ask.

for first-time creation, draft the triage route prompt and the repro route prompt from the copied templates. complete the draft review, my approval, the readiness check, and `pstack-hookd add` for the first route before starting the second.

paraphrase this intent and the finished configuration into each route prompt. the triage prompt must read and follow `.pstack/automations/benny/skills/triage-issue-reports/SKILL.md`. the repro prompt must read and follow `.pstack/automations/benny/skills/reproduce-and-fix-issues/SKILL.md`. use these repo-relative paths only after you confirm they are committed in the checkout the route runs in.

for existing routes, do not add a second route with the same job. validate the configuration, then use the concise field checklist in the copied setup file so i can update each route prompt or re-add a route after my confirmation. do not create duplicates.
