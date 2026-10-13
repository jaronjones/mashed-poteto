# Prompts worth copying

Swap in the real paths, skills, and done checks. Informal wording works.

## Understand

- `$2 read <thread>. restate the underlying issue in your own words, in plain english.`
- `$2 <long or messy ask>`
- `$2 investigate why <symptom>. give me what we know, what data you used, and your best hypotheses. don't change any code yet.`
- `use $2 to understand <subsystem>. then use $2 to find out why it broke recently.`
- `$2 my work on <topic> from last week, then read <issue>.`
- `$2 me why you implemented it this way and not <other way>. what did you trade off?`
- `$2 take over this branch. read the decision log, find what's done, and continue. don't redo finished work.`

## Build

- Bug: `$2 <symptom>. repro first, then fix and verify.`
- Bug in an app: `$2 repro this with /verify-<app>. if it repros on main, fix it and show me a video as proof.`
- Bug with a cheap test: `$2 repro <bug> first. if there's a cheap test path, $2 it. then fix and rerun.`
- Feature: `$2 add <behavior>. <current output> stays byte-identical. verify both.`
- Refactor: `$2 move <code> into one module, zero behavior change. record the current output first and prove it's unchanged after.`
- Perf: `$2 <operation> takes <time> on <fixture>. trace it, fix the measured cause, show me before and after.`

## Design and plan

- `$2 prototype a few options for <feature>. take screenshots or videos for me to compare.`
- `$2 we need <feature>. $2 it first, and answer open questions with prototypes. let me review before proceeding.`
- `$2 write a tutorial for how i would use <new package> first. then $2 me why it beats the current one.`
- `ask $2 for a second opinion on this thread and our approach.`
- `$2 turn this design into a plan. small verifiable PRs, each with its own verification steps.`
- `$2 plan the migration of <library> to <target>. small verifiable PRs. the result must match the original exactly, bugs included.`

## Review and ship

- `$2 the whole branch, but skeptically. don't change anything yet. no nitpicks unless it's a real bug or regression.` Read the dismissals too.
- `$2 check every package under <dir> against its check script. one worker per package. one report.`
- `$2 open the pr. small ordered commits, evidence in the description.`
- `$2 babysit this pr. get it green.` For status only: `$2 check on pr <number>. anything outstanding?`
- `$2 land the stack.`

## Away and back

- `$2 im going to bed. <goal> in a fresh worktree off <base>. done means <checks>. keep a decision log. don't ask me before committing. /loop until done. if you're truly stuck after a few hours, stop and write up why.`
- `$2 catch me up on what you did last night.` Read its Attention section first.
- `$2 full autopilot on this queue. each item is independent.`
- `$2 autopilot these changes but stack them, don't ship. i'll land the stack.`
- `$2 capture what we learned so the next run doesn't repeat it.` Approve only edits that change a future decision.
- `$2` restates the last reply in plain words.
