# benny

benny gives you two `pstack-hookd` routes for slack issue reports. one triages each report. the other reproduces confirmed bugs and may prepare a small draft fix.

the files in this directory are dormant setup and automation sources. they do not appear as slash skills.

## how the routes fire

- `benny-triage` is a slack events route. slack posts each new top-level message in the source channel to it.
- `benny-reproduce` is a webhook route. the triage run wakes it once, after its bug or performance verdict lands in the source thread.

both routes run on the machine that runs `pstack-hookd serve`. each route names the harness and model that run it.

## set it up

1. point your agent at [`FOR_AGENTS.md`](./FOR_AGENTS.md) and name the target repository.
2. let setup merge this whole directory into the target at `.pstack/automations/benny/`. it must preserve destination-only files and review conflicts instead of overwriting local edits.
3. install pstack for the harness that runs the routes (`./install.sh <harness>`) on the machine running `pstack-hookd`. benny uses it for shared dependencies.
4. keep user-owned configuration outside the copied pack, for example in `.pstack/benny/`. adapt [`configuration.example.yaml`](./templates/configuration.example.yaml) and [`feature-map.example.md`](./skills/reproduce-and-fix-issues/references/feature-map.example.md).
5. commit `.pstack/automations/benny/`, the route prompts, and any secret-free configuration before enabling either route.
6. review each route prompt before setup adds it. then send a harmless test report and verify every source-channel post stays in the original thread.
