---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 37
subsystem: scenario-composer-dates
tags: [F-11, D-11, CLAR-06, gap-closure, formatDay, SC-3]
requires: [201-24]
provides:
  - "composer primary header, compared-scenario window stamp, both-ends Include label and range-picker clamp announcement all print days through formatDay in the UI-SPEC range form"
affects:
  - src/app/(dashboard)/allocations/components/BlendHeader.tsx
  - src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/CustomRangePicker.tsx
tech-stack:
  added: []
  patterns: ["wrap formatDay at the print position only; comparisons keep ISO values"]
key-files:
  modified:
    - src/app/(dashboard)/allocations/components/BlendHeader.tsx
    - src/app/(dashboard)/allocations/components/BlendHeader.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/CustomRangePicker.tsx
    - src/app/(dashboard)/allocations/components/CustomRangePicker.test.tsx
    - e2e/composer-axe.spec.ts
decisions:
  - "Day range = two formatDay calls joined by space, U+2013, space (UI-SPEC Interaction contract 5); the composer window value keeps its pre-existing arrow separator (not raised by R3-01)"
metrics:
  tasks: 3
status: complete
commits: 3
plan_head_before: 95bf90ac7f0a1a7e3dabee322bf42a45678f2d15
plan_head_after: ed29a8e63354fd257f75903d2f76c5631527d6ed
actuals:
  tasks: 3
  commits: 3
---

# Phase 201 Plan 37: Scenario composer date gap (SC-3) Summary

Four composer sites now print or announce days through `formatDay` in the UI-SPEC form (`Jun 15, 2022 – Jun 15, 2024`): the blend header window, each compared scenario's window stamp, the both-ends Include label, and the range picker's clamp announcement. Comparisons (`truncated`, `clampDate`) and `<input type="date">` values stay ISO.

## Tasks

| Task | Commit | Result |
|------|--------|--------|
| 1 (tracer) BlendHeader header window | 6e37dd54d | `Mean of 3 strategies · Jun 15, 2022 – Jun 15, 2024`; truncation arm still fires on ISO compare; docblock updated with F-11 line |
| 2 Compare stamp, Include label, e2e pin | a6fe62e11 | stamp `· Jan 2, 2024 – Jun 1, 2024` in the single `font-metric` span; both-ends label `Jan 4, 2026 – Jan 9, 2026`; composer-axe regex re-pinned |
| 3 CustomRangePicker clamp announcement | ed29a8e63 | `Start date Jan 1, 2099 is outside the allowed range; adjusted to Jun 30, 2024.` plus End twin; inputs stay ISO |

## Neuter evidence (each on a `cp -p` byte backup, `cmp` exit 0 after restore, GREEN after)

- `gc-201-37-neuter: gate=BlendHeader.test.tsx (N>=2 not truncated + truncation arm) site=BlendHeader.tsx result=red restored=identical` (RED line: `Received: Mean of 3 strategies · 2022-06-15 – Jun 15, 2024`, 2 failed)
- `gc-201-37-neuter: gate=ScenarioCompareTable.test.tsx (effective-window + heterogeneous arms) site=ScenarioCompareTable.tsx result=red restored=identical` (RED line: `Received: "... · 2024-01-02 – Jun 1, 2024"`, 2 failed)
- `gc-201-37-neuter: gate=ScenarioComposer.test.tsx (COVERAGE-04 BOTH-ends Include arm) site=ScenarioComposer.tsx result=red restored=identical` (spaces removed around the dash; 1 failed)
- `gc-201-37-neuter: gate=CustomRangePicker.test.tsx (Start and End clamp arms) site=CustomRangePicker.tsx result=red restored=identical` (RED line: `Start date Jan 1, 2099 ... adjusted to 2024-06-30.`, 2 failed)
- Tests were also seen RED against HEAD before each source change for Tasks 1, 2 (stamp arms) and 3.

e2e-stale-pin: `e2e/composer-axe.spec.ts` asserted `scenario-coverage-window-value` matches an ISO-day-arrow-ISO-day regex; cause is review R2-02 fix `9ec81739d`, which moved that value to `formatDay`. Re-pinned to `[A-Z][a-z]{2} \d{1,2}, \d{4} → …` with the comment updated. Not run locally (seeded CI lane only), per plan.

## Verify results

- Task 1: `BlendHeader.test.tsx` 8/8 pass.
- Task 2: ScenarioCompareTable* + ScenarioComposer.test.tsx, 4 files, 503/503 pass.
- Task 3: CustomRangePicker, BlendHeader, ScenarioCompareTable*, copy-census.test.ts, 6 files, 91/91 pass; eslint clean on the four source files; `npm run typecheck` exit 0.
- `gc-201-37-gates: vitest=green eslint=clean tsc=clean`
- Acceptance greps: `{effStart}|{effEnd}` 0; `formatDay(eff` 3 lines; `{c.metrics.effective_(start|end)}` 0; old both-ends unspaced form 0; old composer-axe ISO regex 0 and the `scenario-coverage-window-value` assertion still present; `date ${toISODate(` 0.

## Deviations from Plan

None to behaviour. One literal-count note: the Task 3 criterion "`grep -a -c 'formatDay(' CustomRangePicker.tsx` prints at least 4" reads 2 under `-c` because it counts lines and each clamp sentence is one line with two calls. `grep -a -o 'formatDay(' | wc -l` prints 4, which is the intended count (two calls in each of the two sentences). No code was reshaped to satisfy the grep.

## reported-not-edited

None. No phase-200 files were touched.

## Known Stubs

None.

## Threat Flags

None. T-201-52 mitigated (the `truncated` compare still runs on ISO, proven by the truncation arm). T-201-53 mitigated (`formatDay` reads the same ISO string the input holds; exact days asserted).

## Self-Check: PASSED

Commits 6e37dd54d, a6fe62e11 and ed29a8e63 are on `wt/201-p37`; all nine modified files exist and are committed. STATE.md and ROADMAP.md untouched.
