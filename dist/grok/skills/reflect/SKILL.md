---
name: "reflect"
description: "Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect."
disable-model-invocation: true
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## 1. Locate the active transcript

Before fanning out, find this conversation's transcript with `pstack-transcripts`, per the `poteto-mode` skill's `references/harness.md` → Transcripts (`<scripts>` is defined there). Stay in this workspace. Never pass `--workspace`. That crosses workspace boundaries and reads private chats from unrelated projects.

```bash
<scripts>/pstack-transcripts current --harness grok
<scripts>/pstack-transcripts list --harness grok | head -10
```

`current` prints the path of the most recently active transcript in this workspace, which is this chat's. `list` prints `mtime<TAB>path<TAB>session-id`, newest first. To confirm a candidate, run `pstack-transcripts show <path> --role user` and check that its first line contains the conversation's opening user prompt. Take that file's absolute path. If none matches, pass a tight digest of the session instead.

## 2. Spawn three reviewers in parallel

One message, three `pstack-worker` spawns, not read-only, per harness.md → Panels and → Read-only. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, and a read-only spawn can strip MCPs. Each brief says "do not edit files."

Each reviewer and the synthesizer name a role line in `~/.config/pstack/models.md` and a default. Use that line's value, or the default if the file or the line is missing. Each spawn takes its route per harness.md → Spawning. A value of `auto` or `inherit-parent` takes the Parent route. If a value is unavailable on its route (a native spawn error, or `pstack-run` reports no CLI serves it), use the default and say so. If the default is unavailable, use the closest model of the same provider that `pstack-run --list` shows.

| Lens | Role line | Default model | Prompt template |
|---|---|---|---|
| Judgment | `reflect judgment, divergent, synthesizer` | `anthropic/claude-opus-5-5#xhigh` | `references/judgment-reviewer.md` |
| Tooling | `reflect tooling` | `xai/grok-4.7#xhigh` | `references/tooling-reviewer.md` |
| Divergent | `reflect judgment, divergent, synthesizer` | `anthropic/claude-opus-5-5#xhigh` | `references/divergent-reviewer.md` |

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in their final reply.

## 3. Synthesize

One `pstack-worker` spawn, not read-only, on the `reflect judgment, divergent, synthesizer` line (default `anthropic/claude-opus-5-5#xhigh`). It spot-verifies citations through MCP, and a read-only spawn can strip MCPs. Its brief says "do not edit files." Pass `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. It returns an Accepted / Rejected / Backlog list.

## 4. Structural enforcement check

Move any Accepted item that a lint rule, script, metadata flag, or runtime check would enforce more reliably to Backlog. See the **encode-lessons-in-structure** principle skill.

## 5. Apply

Present the synthesizer's full Accepted / Rejected / Backlog output and wait for explicit approval before applying any Accepted edit. The user picks the subset and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

File each Backlog item to your team's devex or backlog tracker without waiting. Only the Accepted list waits for approval.

Follow each approved row's Routing exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): the parent does it directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): hand to the bundled **create-skill** skill and run its draft / test / iterate loop.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): hand to `create-skill` and run its description-optimization loop.
- `new skill via create-skill: <kebab-name>`: hand creation to `create-skill`. Do not invent the shape ad hoc.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done.

## 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
