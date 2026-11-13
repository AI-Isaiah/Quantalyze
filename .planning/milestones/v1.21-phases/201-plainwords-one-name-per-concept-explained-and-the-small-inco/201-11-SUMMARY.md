---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 11
subsystem: scenario-composer-copy
tags: [d-18, u-19, u-07, d-04, d-11, d-01, scenario-draft, scenario-aum]
requires: [201-25, 201-26]
provides:
  - composer heading Scenario draft, empty state Start a scenario, buttons Save scenario / Update scenario / Save as new scenario
  - size input SCENARIO AUM (USD) and every composer and scenario-state message about it saying scenario AUM
  - entry-mode toggle From my allocation
  - outside-window month through formatMonth (formatIsoMonth deleted)
  - flagged-holdings card title term through Term
  - ledger plan-11 empty
affects: [201-24, 201-27]
key-files:
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
    - src/app/(dashboard)/allocations/hooks/useScenarioState.ts
    - src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx
    - src/app/(dashboard)/allocations/lib/scenario-state.ts
    - src/app/(dashboard)/allocations/lib/scenario-state.test.ts
    - e2e/composer-axe.spec.ts
    - e2e/axe-app-wide.spec.ts
    - e2e/layout-narrow.spec.ts
    - scripts/copy-census/ledgers/plan-11.ts
decisions:
  - "formatIsoMonth and its month table were deleted rather than delegated; the two call sites use formatMonth directly (the plan allows either)."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 27600
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: bd8a7f0b90e2796d16e0f7953c074fb8c0598dde
---

# Phase 201 Plan 11: Scenario composer copy Summary

The scenario composer now speaks one word per concept: a saved draft is a scenario, its manually entered size is Scenario AUM, the live-allocation mode reads From my allocation, and the one term in a label position (Bridge in the flagged-holdings title) renders through Term. The save and update requests are unchanged; the save tests drive the renamed buttons by accessible name.

This plan was resumed after an interruption. Tasks 1 and 2 were already committed by the earlier executor (7a47c5ebb, 0666114a4); their commits were inspected and kept. The uncommitted remainder (Bridge Term, layout-narrow admin locator, ledger emptied, composer test pins) was verified and committed as task 3 (bd8a7f0b9).

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 7a47c5ebb | Scenario draft h2, Start a scenario, Save/Update/Save as new scenario, name field and notices say scenario; save and composer tests and the three e2e heading locators in the same commit |
| 2 | 0666114a4 | SCENARIO AUM (USD) label and messages in composer, useScenarioState, scenario-state; From my allocation toggle; formatMonth for the outside-window month; tests pin the strings |
| 3 | bd8a7f0b9 | Term on the Bridge label, data-term pin in the composer test, layout-narrow `Edit mandate`, ledger plan-11 `pending: {}` |

## Verification (real output)

- `npx tsx scripts/copy-census/run.ts --ledger plan-11`: exit 0, no remaining hits; ledger has `pending: {}`.
- Task 3 vitest scope (ScenarioComposer*, scenario-state, scenario-benchmark, useScenario*, return-stats.sites, copy-census, figure-gate-census): 15 files passed, 870 tests passed, 0 failed.
- `npx eslint` on every touched source, test and spec file and the ledger: exit 0.
- `npm run typecheck` (tsc --noEmit): no errors printed.
- Acceptance greps: `Scenario portfolio` in ScenarioComposer.tsx = 0; `portfolio AUM` in non-comment lines of composer, hook and state = 0; the e2e `hasText` retired-heading grep = 0 for composer-axe and layout-narrow; no `Start a portfolio`, `Scenario portfolio` or `Edit preferences` left in the three e2e specs.

gc-201-11-gates: vitest=green eslint=clean tsc=clean

## Neuter lines (gates shown able to fail)

Both neuters were run in this resumed session on a `cp -p` backup in the scratchpad, restored with `cp -p`, and `cmp` exited 0.

- Task 1: restored the old save-button wording (`Save scenario` to `Save portfolio`, one line in ScenarioComposer.tsx). `ScenarioComposer.save.test.tsx` went RED: `13 failed | 20 passed (33)`, first failure `Unable to find an accessible element with the role "button" and name /^Save scenario$/i`.
  gc-201-11-neuter: gate=ScenarioComposer.save.test.tsx result=red restored=identical
- Task 2: restored the old size label (`SCENARIO AUM (USD)` to `PORTFOLIO AUM (USD)`). `ScenarioComposer.test.tsx` went RED: `1 failed | 467 passed (468)`, `Expected: "SCENARIO AUM (USD)"  Received: "PORTFOLIO AUM (USD)"`.
  gc-201-11-neuter: gate=ScenarioComposer.test.tsx result=red restored=identical

## Deviations from Plan

1. **`verify-plan-anchors.mjs` exits 1 after the work** (not a defect of the work). It reports `[symbol-absent] ScenarioComposer.tsx formatIsoMonth`: the plan's own `verify-symbol` anchor names a symbol that Task 2 is told to delete or delegate, and it was deleted. The anchor held at plan time and is expected to fail once the task is done. Pre-work state was not re-measured by this executor (the earlier executor ran first).
2. **Sharpe, Max DD and TWR labels are not wrapped in Term.** Task 3's behavior line names a `[data-term="sharpe"]` render "at least", but the plan also says the runner is the list of what to wrap, and the runner listed one rule B hit only (the Bridge title). The `Sharpe` / `Max DD` / `TWR` strings in ScenarioComposer.tsx are plain string arguments to a delta-item builder (`pushDelta("Sharpe", ...)`) rendered elsewhere, and an uppercase `SHARPE` eyebrow, none of which the census flags. I did not widen the scope. The behavior line is therefore proven for Bridge (`data-term="bridge"` asserted and its absence asserted when nothing is flagged), not for Sharpe. Flagged for the verifier.
3. The Bridge label is wrapped in Term as the census requires (rule B). This does not apply the F-04 Bridge retirement, which plans 201-28..201-34 own.

## cross-plan-pins (for plan 201-24)

- `src/app/(dashboard)/allocations/AllocationsTabs.connect-key-predicate.test.tsx` line ~216: asserts `screen.getByText("Start a portfolio")` on the scenario tab. The composer's empty state now reads `Start a scenario`, so this assertion will fail until plans 201-12 / 201-15 (owners of `AllocationsTabs.*` tests) change it to `Start a scenario`. Not edited here.
- `src/app/(dashboard)/allocations/HoldingsTabPanel.key-read-notes.test.tsx` and `src/app/(dashboard)/allocations/lib/live-holdings-summary.test.ts`: pin `portfolio AUM leaves it out` (price-gap note); the note's source is not in this plan's files. Owners are 201-12 / 201-15.
- `ScenarioCommitDrawer.test.tsx`, `SavedScenariosList.tsx`, `src/app/api/allocator/scenario/commit/route.ts`: carry portfolio wording; owned by plan 201-27 and plan 201-21.

## reported-not-edited

Nothing: no phase-200 file was touched.

## Known Stubs

None.

## Threat Flags

None. Copy and display only; the save and commit requests are unchanged (T-201-16: the save tests drive the renamed controls by accessible name and the e2e anchors moved in the same commit as the copy).

## Self-Check: PASSED

- FOUND: 7a47c5ebb, 0666114a4, bd8a7f0b9 (ancestors of HEAD on wt/201-p11)
- FOUND: every file listed under key-files.modified is in `git diff --name-only 8724de1ab..HEAD`
- `commits: 3` measured with `git rev-list --count 8724de1ab..bd8a7f0b9` before this SUMMARY commit.
