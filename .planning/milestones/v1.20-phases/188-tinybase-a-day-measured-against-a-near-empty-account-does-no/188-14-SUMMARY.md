---
phase: 188-tinybase-a-day-measured-against-a-near-empty-account-does-no
plan: 14
subsystem: scenario engine / KL-5 tiny-base strategy legs
tags: [tinybase, D-12, KL-5, drills, scenario, share]
requires: []
provides:
  - "the KL-5 drill table: nine sites, each shown RED when its one wiring line is removed"
  - "StrategyForBuilder.undefined_return_days docstring names every builder that sets it"
affects: [src/lib/scenario.ts]
key-files:
  modified: [src/lib/scenario.ts]
decisions:
  - "D-12 holds at HEAD with no new arm and no new wiring: every site's named test already fails when its line is removed."
metrics:
  tasks: 2
  files: 1
status: complete
commits: 2
plan_head_before: 3e7547bd2988097560d761c0b4362daf68d1ca29
plan_head_after: 2821f73cc97100bb74cec3526da0bbe6af8e44a9
actuals:
  tokens: 1000
  tasks: 2
  commits: 2
---

# Phase 188 Plan 14: KL-5 drills (D-12) Summary

D-12 is closed by evidence: for each of the nine sites that carries a strategy's tiny-base days onto a scenario leg (or onto the stored flag a leg reads), removing that one line turns the site's named test RED, and restoring it (byte backup, `cmp -s`) turns it GREEN. No drill left its named arm green, so no `KL5-DRILL` arm and no wiring was added. The only product-file change is a docstring correction.

`plan_head_after` is the docstring commit (code head); the second counted commit is this SUMMARY.

## Premise check

All nine quoted lines were present at the plan base (`grep -anF`), the three Task 1 test files were GREEN at the base (76 tests), the plan-anchor check exited 0, and the precondition (phase branch contains main's latest `src/` and `job_worker.py`) held. Nothing in the sites table had moved.

## KL-5 drill table

Each drill: byte backup, remove the one line (or replace the spread with `{}`), run the named test file(s) with `--reporter=default` (pytest `-q -rf` for K), restore from the backup, `cmp -s`. The drill is never committed. The named arm is the one the gate table requires on a ` FAIL ` / `FAILED` line.

kl5-drill: site=S2 test=src/app/scenario-share/[token]/page.test.tsx arm=reads data_quality_flags.tiny_base_days into the resolver red=yes restored=cmp-ok added_arm=no
kl5-drill: site=S1 test=src/app/scenario-share/[token]/share-resolve.test.ts + page.test.tsx arm=reads a named day as the other leg alone, never as the leg's flat 0% AND reads data_quality_flags.tiny_base_days into the resolver red=yes restored=cmp-ok added_arm=no
kl5-drill: site=E test=src/lib/scenario.tiny-base.test.ts arm=a unit sits out a named day's numerator AND weight (also SC-4 absent-day 0-fill, present-window path, twr chain) red=yes restored=cmp-ok added_arm=no
kl5-drill: site=A test=src/app/(dashboard)/allocations/lib/scenario-strategy-tiny-base.test.ts arm=reads a named day as the other leg alone, never as the strategy's flat 0% red=yes restored=cmp-ok added_arm=no
kl5-drill: site=C test=src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx arm=round 1 (MEDIUM-4) a book strategy's tiny_base_days AND HYD-188 round 1 (MEDIUM-4) a drawer-added strategy's tiny_base_days red=yes restored=cmp-ok added_arm=no
kl5-drill: site=P test=src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx arm=T_188_R1 carries a strategy's tiny_base_days into the added-strategy metadata lookup red=yes restored=cmp-ok added_arm=no
kl5-drill: site=Q test=src/lib/queries.my-allocation.test.ts arm=188 D-07 round 1 (MEDIUM-4): a book row ships the strategy's tiny_base_days red=yes restored=cmp-ok added_arm=no
kl5-drill: site=R test=src/app/api/strategies/[id]/returns/route.test.ts arm=R-188 round 1 MEDIUM-4: tiny_base_days is the strictly parsed list (the HONEST-05 additive-contract arm also failed) red=yes restored=cmp-ok added_arm=no
kl5-drill: site=K test=analytics-service/tests/test_nav_marks_composite.py arm=test_a_members_realized_era_tiny_day_is_named_for_the_leg_readers AND test_a_closed_members_tail_tiny_day_is_named_for_the_leg_readers red=yes restored=cmp-ok added_arm=no

Drill shapes, where the plan left room: S2 removed the whole `tinyBaseDaysById[r.strategy_id] = readTinyBaseDays(...)` statement; the page arm failed on its own assertion (`named_` equal to `plain`), not on a crash. S1, A and P replaced the conditional spread with `...({})`. C removed the spread line. Q removed the `tiny_base_days` spread. R removed the `tiny_base_days,` member. K replaced the generator argument of `_listed_tiny.update(` with `()`; pytest reported `2 failed, 26 passed`. `job_worker.py` is byte-identical to its backup and not in this plan's diff.

kl5-census: computeCompositeCurve production_callers=0

(`grep -rn 'computeCompositeCurve(' src --include='*.ts' --include='*.tsx' | grep -v '\.test\.'` prints only its definition in `src/lib/scenario.ts`. Not edited.)

kl5-verdict: closed-at-HEAD. The wiring was shipped by `58b228d00` (strategy legs sit out their tiny-base days: dashboard payload, `/returns`, composer, compare panel, `buildAddedUnits`, share page and `share-resolve`), with composite members covered by `fe05c62b1` (R2-01) and `83ad5065d` (R3-01). This plan added no arm and no wiring; it added the proof that each site can fail, and the docstring correction.

## What changed

- `src/lib/scenario.ts`: the `StrategyForBuilder.undefined_return_days` docstring now reads "Set by the two per-key builders and by every strategy-leg builder, from the strategy's `data_quality_flags.tiny_base_days` (188 D-12); a value is a day to leave out, never a return." Comment only. Commit `2821f73cc`.

## Verification

- Gate table: every site's named arms appear on ` FAIL ` / `FAILED` lines in its drill log (verify `red` function, all nine sites).
- `cmp -s` on all nine product files against their byte backups: equal. Site E's backup equals `scenario.ts` at the parent of the docstring commit, so the only difference from the base is the docstring.
- vitest on the 8 named files plus `src/lib/scenario.test.ts`: all passed (share-resolve + page + engine 76; strategy-tiny-base 2; composer 458; compare panel 11; queries.my-allocation + route + scenario + tiny-base + share trio 400). `npx tsc --noEmit`: no `error TS`. `npm run lint`: exit 0 (2 pre-existing warnings, 0 errors). `python -m pytest tests/test_nav_marks_composite.py`: 28 passed.
- `git diff 3e7547bd2 HEAD --stat` before this SUMMARY: `src/lib/scenario.ts | 6 ++++--`. No product file other than that docstring.
- Acceptance: `grep -ac 'Set only by the two' src/lib/scenario.ts` = 0 (baseline 1); `grep -ac 'data_quality_flags.tiny_base_days' src/lib/scenario.ts` = 1 (baseline 0).

## Deviations from Plan

None - plan executed as written, with one operational note: the plan's scratch directory is `/tmp/tinybase-14`; the session's rules put scratch files in the session scratchpad, so backups and drill logs lived there instead and the verify command was run with that path substituted. Task 1 produced no commit (no test arm was needed, no file changed).

## Known Stubs

None.

## Threat Flags

None. No product file other than a comment changed; the share page keeps the day list server-side, unchanged (T-188-33).

## Note for the orchestrator

188-VERIFICATION's SC-2 row read KL-5 as still carried, from the plan-09 and plan-10 SUMMARYs. The review fix rounds (`58b228d00`, `fe05c62b1`, `83ad5065d`, shipped in #1196) had already wired it, and this plan's nine drills show each site fails without its line. Recording that correction in CONTEXT and ROADMAP is the orchestrator's call, not this plan's.

## Self-Check: PASSED

- `src/lib/scenario.ts` docstring edit present; commit `2821f73cc` is an ancestor of HEAD.
- All nine drilled files equal their backups.
