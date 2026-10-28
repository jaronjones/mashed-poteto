---
name: "swarm"
description: "Fan out N parallel workers, drain them, and return one report. Use for /swarm, 'swarm this', or parallel coverage, races, gauntlets, and exploration."
disable-model-invocation: true
---

# Swarm

## Start

Open a todolist with one entry per phase before launching anything.

1. Frame
2. Fan out
3. Aggregate
4. Report

## Phase A: Frame

1. State the done predicate and the artifact or report the swarm must return.
2. Choose the shape. Partition into slices, race N workers on identical briefs, or mix both. For a race or mixed shape, declare `first pass`, `rank all`, or `best-of` before spawning.
3. Pick the worker model from the `swarm workers` line in `~/.config/pstack/models.md`. If the file or that line is missing, use `xai/grok-4.7#xhigh`. For `auto` or `inherit-parent`, take the Parent route so the workers run on the parent model. If the model is unavailable on its route (a native spawn error, or `pstack-run` reports no CLI serves it), use the default and say so. If the default is unavailable, use the closest model of the same provider that `pstack-run --list` shows. For a model race, name each arm's model up front.
4. Give each worker its own writable output when it writes. When workers verify or measure commits, each brief names the exact SHAs. A measurement brief also names the method (sample count, what one sample is, order). The worker records both in its result.

## Phase B: Fan out

Spawn all N workers in one message as `pstack-worker` subagents, in the background, on the step 3 model. Each takes its route per the `poteto-mode` skill's `references/harness.md` → Spawning. Make each an isolated spawn per harness.md → Native spawn parameters → Isolation, using the harness's cloud mode where it has one. Skip the cloud mode, and use a local worktree, only when the worker needs access to something on the user's computer.

When a worker must start from a non-default pushed branch, base its worktree or cloud session on that branch.

Every brief stands alone. Include the goal, scope, exact slice or race arm, how to verify, and what to report. Reports use `PASS`, `ISSUES`, or `BLOCKED` with evidence. A worker that can prove a defect reports `ISSUES` and lists every issue it can prove, not only the first.

If a worker drops out, proceed with N-1 and note it.

## Phase C: Aggregate

Read the terminal results. Drop a result that does not record the SHAs and method its brief names, and respawn that worker once. After a second miss, record a gap. A gap does not count as a pass. For coverage, every required slice needs a result. For a race, apply the selection rule declared up front. Use first pass, rank all, or best-of. Do not paste raw worker dumps.

## Phase D: Report

Return one consolidated in-chat report with a result table, issue one-liners, gaps or dropouts, and the race rule when used.
