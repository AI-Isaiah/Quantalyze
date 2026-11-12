---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 27
subsystem: allocations-scenario-tab
tags: [copy, plainwords, term, formatDay, census, saved-scenarios, compare]
requires: [201-01, 201-03, 201-06, 201-25, 201-26]
provides:
  - SavedScenariosList speaks scenario (D-18, U-19), names the live row "Live allocation" (D-04) and prints saved-on dates through formatDay (D-11, U-14)
  - ScenarioComparePanel and ScenarioCompareTable name the live column and the select-two prompt with "live allocation"
  - ScenarioCompareTable metric labels and ScenarioBenchmarkSection metric labels render through Term
  - scripts/copy-census/ledgers/plan-27.ts at pending {} with no exceptions
affects: [201-11, 201-23, 201-24]
tech-stack:
  added: []
  patterns: [Term Form A on a static table label via an optional registry key on the row, MetricRow term prop]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/SavedScenariosList.tsx
    - src/app/(dashboard)/allocations/components/SavedScenariosList.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCompareTable.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCompareTable.all-columns.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
    - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioCommitDrawer.test.tsx
    - scripts/copy-census/ledgers/plan-27.ts
key-decisions:
  - "ScenarioCommitDrawer.tsx, ScenarioFooter.tsx and the four scenario-* lib modules needed no source change: the census lists no hit in them and their remaining retired words are machine values (stale_portfolio, portfolio_fingerprint_stale) or comments. No exception row was needed because the runner never listed them."
  - "Alpha in the benchmark section is wrapped too (term alpha) although the census does not flag it (the registry label is 'Alpha (ann)', so the policy form does not match 'Alpha'). The plan says registered terms in the benchmark label positions render through Term."
patterns-established:
  - "A static metric row carries an optional registry key; the cell renders Term when present and the plain label otherwise (Cumulative Return stays plain, UI-SPEC Not registered)."
requirements-completed: [CLAR-03, CLAR-04, CLAR-06]
status: complete
duration: 25min
completed: 2026-11-11
actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: def3af90b
---

# Phase 201 Plan 27: saved scenarios, commit drawer and compare views in one vocabulary Summary

The saved list now says scenario, the live pseudo-row and the compare views say "Live allocation", the saved-on date prints as `Oct 9, 2026` through `formatDay`, and the compare and benchmark metric labels open their registry definitions. Ledger plan-27 is `pending: {}` with no exceptions.

## Task Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | a589e2aec | Saved list copy per UI-SPEC "Scenario (saved draft)", `Live allocation` pseudo-row, `formatDay` date, ledger drops SavedScenariosList (A 15, C 1) |
| 2 | 539230101 | Compare panel live column `Live allocation` (computed and throwing branch), compare table prompt, drawer fallback pinned, ledger drops the panel and the table's rule A hit |
| 3 | def3af90b | Term on compare table rows and benchmark section labels with render assertions, ledger `pending: {}` |

`commits: 3` is `git rev-list --count 8724de1ab..HEAD` taken before this SUMMARY's own commit; `plan_head_after` is the last code commit.

## Strings changed (SavedScenariosList)

`Saved scenarios`, `No saved scenarios yet`, the body naming `Save scenario`, `Couldn't load your saved scenarios. Try again.`, `Enter a name to save this scenario.`, `Scenario names are limited to 120 characters.`, `Couldn't rename this scenario. Try again.`, `Couldn't delete this scenario. Try again.`, `Rename scenario {name}` (aria-label), `Live allocation` (checkbox name and label), `Select 2 or more scenarios (or the live allocation) to compare.` The `saved-portfolios-heading` element id became `saved-scenarios-heading` (no other reference in `src`, `e2e` or `tests`).

## TDD and RED proofs

- Task 1: tests updated first; 11 of 29 failed on the old copy before the source edit (named: empty state, validation, rename, delete, load error, live allocation checkbox, select-two sentence).
- Task 2: tests renamed with the source edit; proved by the neuter below.
- Task 3: the two new Term arms failed first (`expected null to be 'tracking_error'` and `expected null to be 'cagr'`) and turned green after the wrap.

Neuter discipline: `cp -p` backup to the scratchpad, neuter, RED naming the cause, `cp -p` back, `cmp` exit 0, GREEN.

- `gc-201-27-neuter: gate=SavedScenariosList.test.tsx (D11 date arm and WR-04 'Saved Jun 10, 2026') result=red restored=identical` Replaced the helper call with a locale-formatted date (en-GB). RED: `Unable to find an element with the text: Updated Oct 9, 2026` and `... Saved Jun 10, 2026`. Restored, `cmp` 0, census and list green.
- `gc-201-27-neuter: gate=ScenarioComparePanel.test.tsx (T_CP2 and the table-withheld arm) result=red restored=identical` Restored the HEAD label `Live book` in the computed branch. RED: `Unable to find an element with the text: Live allocation` and `cell-Live allocation-sharpe`. Restored, `cmp` 0, GREEN.
- Extra (not required): `gc-201-27-neuter: gate=ScenarioComparePanel.test.tsx (T_CP7b) result=red restored=identical` Restored `Live book` in the throwing (empty-metrics) branch only. RED: `Unable to find an element with the text: Live allocation`. Restored, `cmp` 0, GREEN. T_CP7b is new, since no existing arm covered the live column's catch branch.

`gc-201-27-gates: vitest=green eslint=clean tsc=clean`

## Verification

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 4 claims.
- The Task 3 scoped vitest command (saved list, drawer, compare, benchmark, footer, four lib families, copy census, figure-gate census): 14 files, 280 tests green.
- `npx eslint` on every touched source and test file: clean. `npm run typecheck`: clean.
- `npx tsx scripts/copy-census/run.ts --ledger plan-27` prints nothing; `scripts/copy-census/ledgers/plan-27.ts` has `pending: {}`, `exceptions: []`, `pinnedExceptionCount: 0`.
- `grep -a -c "toLocaleDateString"` in SavedScenariosList.tsx: 0 (1 at HEAD). `grep -a -c "Live book"` in ScenarioComparePanel.tsx: 0 (2 at HEAD).
- A read-only neighbour run (scenario-share, `AllocationsTabs.scenario-composer`, the ScenarioComposer families, figure-gate, series-space, display-sign and degrade-warning guards) passed on assertions. Five tests timed out under the machine load of 16 parallel executors (`display-sign-single-source` R7 at 30 s, four ScenarioComposer arms at 5 to 10 s); none is an assertion failure and the ScenarioComposer families belong to plan 201-11.

## Deviations from Plan

### 1. [Plan wording] `stale_portfolio` count is 5 at HEAD, not 3
The acceptance criterion says `grep -a -c "stale_portfolio"` prints "the same count as at HEAD (3)". The count at HEAD is 5 (`git show HEAD:... | grep -a -c`), and it is 5 now; the drawer source is untouched, so the criterion's real intent (the machine value stays unchanged) holds. The "3" in the plan was a miscount.

### 2. [No change needed] Commit drawer and the exceptions list
The runner lists no hit in `ScenarioCommitDrawer.tsx`, and no machine value appears in the runner output, so no exception row was recorded and `pinnedExceptionCount` stays 0. The drawer's stale-conflict fallback ("Your holdings changed since you started this scenario. ...") already carries no retired word. I added one drawer test arm that pins it (a 409 with only the machine code renders that fallback, with no `portfolio` or `book` word and no machine code on screen). It passes at HEAD, so it is a guard rather than a RED proof.

### 3. [Rule 2 - extra] Alpha wrapped in the benchmark section
Not flagged by the census (policy form does not match the label `Alpha`), wrapped for consistency with the other three labels; the test asserts all four.

No auth gates. No threat flags: copy and display only, the save, rename, delete, compare and commit requests are unchanged.

## cross-plan-pins

None needed from this plan's literals. `grep -a -rn -F` for each changed literal (`Saved portfolios`, `No saved portfolios yet`, `Rename portfolio`, `Live book`, the save, rename and delete messages) over `src`, `e2e` and `tests` found no pin outside this plan's files, except these remaining uses owned by other plans (not edited here, listed for plan 201-24):
- `ScenarioComposer.save.test.tsx` pins `Enter a name to save this portfolio.` and `Portfolio names are limited to 120 characters.` (the composer's own save messages, plan 201-11).
- `src/app/scenario-share/[token]/page.test.tsx` pins `PROJECTED — hypothetical, not a live book` (share page, another plan; UI-SPEC "Live allocation" family row `PROJECTED — hypothetical, not a live allocation`).

## Known Stubs

None.

## Self-Check: PASSED

- Commits a589e2aec, 539230101 and def3af90b are ancestors of HEAD on wt/201-p27.
- All files in key-files exist; STATE.md and ROADMAP.md untouched.
