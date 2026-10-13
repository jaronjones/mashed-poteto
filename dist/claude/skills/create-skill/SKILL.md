---
name: "create-skill"
description: "Write, edit, or tune an agent skill (a SKILL.md and its directory). Use for \"create a skill\", \"write a skill for X\", \"turn this workflow into a skill\", \"edit this SKILL.md\", \"the skill didn't trigger\", or \"improve this skill's description\". Covers placement, frontmatter, progressive disclosure, writing for an agent reader, and a draft, test, iterate loop in fresh subagents."
---

# Create a skill

A skill is a directory with a `SKILL.md` that an agent loads when its description matches the task. Write it for that agent. It reads the file cold, mid-task, and follows each sentence as an instruction.

## Where it lives

- Project skills go in `<name>/SKILL.md` under `.claude/skills`. Commit them with the repo.
- Personal skills go in `<name>/SKILL.md` under `~/.claude/skills`. They apply in every project.
- Before you write a new skill, search both places for one that already covers the topic. Extending a real home beats adding a neighbor.

## Frontmatter

Every `SKILL.md` starts with YAML frontmatter. Without it the skill never registers.

```yaml
---
name: verify-billing
description: "Drive the billing app the way a user does and capture proof. Use for \"verify billing\", \"repro this in billing\", or before claiming a billing change works."
---
```

- `name` matches the directory name. Lowercase letters, digits, and hyphens only.
- `description` says what the skill does and when to use it, with the phrases a user would actually type. The agent picks skills from descriptions alone, so a vague one never fires and a broad one fires on the wrong task. Name what it is not for when a neighbor skill is easy to confuse with it.
- Keep `description` one YAML scalar. Quote it when it holds a colon, a quote, or a leading special character, or use `description: >-` with indented continuation lines.
- Add `disable-model-invocation: true` for a skill that should run only when the user types `/<name>`. Use it for workflows with side effects or high token cost.

## Keep SKILL.md short

Load cost is paid on every use. Put the steps and rules every run needs in `SKILL.md`, and move the rest out.

- `references/` holds detail one branch of the work needs, such as a per-source playbook, a template, or a worked example. Link each file from the step that needs it and say when to read it.
- `scripts/` holds code the agent runs instead of retyping. Make each script executable and show its exact invocation in `SKILL.md`.
- Link with relative paths. A link the agent can't resolve is a dead instruction.

## Write for an agent reader

- Use the imperative. "Run the doctor check first", not "The doctor check should be run".
- Be concrete. Name the command, the file, the flag, and the observable result that means done.
- Give the reason behind a rule in one clause when the reason changes how to apply it.
- State each rule once, in the section where it applies.
- Cut filler, motivation, and history. Every sentence becomes behavior, so a sentence with no behavior behind it is noise.
- Point to other skills by name instead of pasting their content.
- Run the finished prose through the **unslop** skill.

## Draft, test, iterate

1. Draft the skill from a real task you or the user just did. Write down 2 or 3 realistic prompts that should use it, in the words a user would type, and one that should not.
2. Spawn a fresh subagent per prompt, per the poteto-mode skill's [`harness.md`](../poteto-mode/references/harness.md) → Spawning. Run each prompt twice. One brief tells the subagent to read the draft `SKILL.md` first, and the other leaves it out. For a trigger test, install the draft and give the bare prompt instead. Fresh subagents matter because your own context already knows what the skill says.
3. Compare the runs. Read each subagent's transcript (`pstack-transcripts show <path>`, per harness.md → Transcripts) or its final reply. Check that the skill fired on the right prompts and not on the wrong one, that the agent followed each step, and that its output beat the run without the skill.
4. Tighten. A skipped step needs a clearer instruction or a better spot in the file. A misread sentence needs rewording. A rule nothing exercised may not belong. Fix the cause in the skill, then rerun the prompts that failed.
5. Stop when two rounds in a row change nothing that matters.

### Tune the description

When a skill exists but didn't fire when it should have, or fired when it shouldn't, change only the `description`. Collect the prompts that misfired, add the missing trigger phrases or the exclusion, and rerun step 2 with those prompts plus the originals so the fix doesn't break a case that worked.
