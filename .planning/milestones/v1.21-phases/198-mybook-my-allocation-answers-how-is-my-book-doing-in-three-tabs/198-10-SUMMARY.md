---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 10
subsystem: allocator-overview-missing-data-message
tags: [d-01, route-07, panel-retired, class-parity, fail-closed]
status: complete
requires:
  - phase: 198-09
    provides: MissingDataMessage mounted on the Overview, the old panel unmounted
provides:
  - every missing-data sentence lives once, in MissingDataMessage.tsx
  - EquityHistoryRebuilding.tsx holds only the rebuild-reason class table, its guards and ExchangesPageLink
  - the Scenario class-parity and fail-closed tests compare against the message
affects: []
actuals:
  tokens: 22000
  tasks: 2
  commits: 2
plan_head_before: 6677a260b8c304bf4a933f2bc14b884bcdf2a9e2
plan_head_after: db1acbac13869dfdac0030acab0c9a419b57f88c
commits: 2
tech-stack:
  added: []
  patterns: [one sentence table (BOOK_LINE) keyed by every non-needs-action reason via satisfies, so a reason moved between classes fails to compile]
key-files:
  modified:
    - src/app/(dashboard)/allocations/components/EquityHistoryRebuilding.tsx
    - src/app/(dashboard)/allocations/components/MissingDataMessage.tsx
    - src/app/(dashboard)/allocations/components/MissingDataMessage.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
key-decisions:
  - "The two sentences the message still read from the old REASON_LINE table (account_identity_pending, shared_account_history_truncated) moved into BOOK_LINE, byte-identical, so the table is now keyed by all five non-needs-action reasons and the missingDataLines branch chain collapses to one else."
requirements-completed: [ROUTE-07]
---

# Phase 198 Plan 10: retire the old equity-history panel from the code Summary

The generic equity-history panel is gone from code and from the Scenario test. Its class table and link stay where `ScenarioComposer.tsx` reads them, and every sentence the Overview message prints has one home.

## What changed

- `EquityHistoryRebuilding.tsx` lost the panel component, `HEADING_ID`, `HEADING_BY_CLASS`, the generic body, `REASON_LINE`, `NotSyncingLine`, `NeedsActionLine` and their unused imports. It keeps `REBUILD_REASON_CLASS`, the class and reason types, `isKnownRebuildReason`, `equityHistoryRebuildClass`, `isNeedsActionReason` and `ExchangesPageLink`. The docblock now says what the file is, and that `MissingDataMessage` replaced the panel (D-01).
- `MissingDataMessage.tsx` now owns `NotSyncingKey`, `NotSyncingLine` (with 198-09's one-rule label) and `NeedsActionLine`, copy byte-identical. `BOOK_LINE` carries the two moved sentences beside the three it had.
- `MissingDataMessage.test.tsx` gained an exports case: the module lists exactly `ExchangesPageLink`, `REBUILD_REASON_CLASS`, `equityHistoryRebuildClass`, `isKnownRebuildReason`, `isNeedsActionReason`. It was RED first (it listed the panel, `NeedsActionLine` and `REASON_LINE`), then GREEN.
- `ScenarioComposer.test.tsx`: SFH-C3-01 renders the composer beside `<MissingDataMessage lines={missingDataLines(...)} />` and checks, per class, the Scenario line, the Exchanges link on both surfaces exactly for `needs_action`, "reload the page" on both exactly for `read_failed`, "being rebuilt" and the daily-run sentence exactly for `rebuilding`, and "holding back" on the Scenario exactly for `held_back`. IN-01 pins an unknown reason and `constructor` to what a null reason renders, same text and paragraph count, no console error. `OVERVIEW_HEADING_BY_CLASS` is deleted with a comment saying D-01 retired the headings.

## Neuter record

gc-198-10-neuter: gate=MissingDataMessage.test.tsx account_identity_pending shipped unnamed sentence (one word of a moved sentence changed, daily to weekly) result=red restored=identical
gc-198-10-neuter: gate=ScenarioComposer.test.tsx SFH-C3-01 duplicate_account (Exchanges link dropped from the duplicate_account fallback) result=red restored=identical

Each used a `cp -p` byte copy in the scratchpad, `cmp` exit 0 after restore, and a GREEN rerun.

gc-198-10-gates: vitest=green headings=0 tsc=clean lint=clean

Evidence for the gates line:
- `npx vitest run "src/app/(dashboard)/allocations" contracts-registry display-sign-single-source figure-gate-census`: 180 files, 3213 tests passed.
- `npx tsc --noEmit`: exit 0.
- `npm run lint`: ESLint 0 errors (2 warnings in files this plan does not touch); the only red is the known rule 6e on ROADMAP.md (a "Phase 196" bullet), recorded in the phase notes as not this plan's.
- `headings=0` means zero retired headings in any component or non-test source. See the deviation below for two test files.

## Deviations from Plan

**1. [Rule 1 - Plan premise] `REBUILD_REASON_CLASS` was not exported at HEAD.** The plan lists it among the module's exports and says to keep it unchanged. At HEAD it was a plain `const`. The exports case needs it exported, so the only change to the kept block is the word `export`. No other kept line changed.

**2. [Conflict between two plan statements] The four-heading grep still finds two files.** The acceptance criteria expect `grep -arl -F "We are holding back your equity history" src` to print nothing, but two tests added by 198-09 name the four headings as strings that must never render: `AllocationDashboardV2.rebuilding.test.tsx` (`RETIRED_HEADINGS`) and `OverviewRisk.history-parity.test.tsx` (`RETIRED`). They are the pins for this plan's own prohibition ("the retired panel's headings never come back on any surface"). Deleting them would remove the only gate behind that prohibition, so I kept them. No component, no source file and no positive test carries a heading. If the literal grep must be empty, those two lists need to be built from word fragments, which would hide the pin from a reader, so I did not do it. Left for the orchestrator to decide.

**3. Anchor verifier run after the edit.** `node scripts/verify-plan-anchors.mjs` was run after Task 1's edit, not before. It reported two misses (`HEADING_BY_CLASS`, `NotSyncingLine` in `EquityHistoryRebuilding.tsx`), which is the expected result of the deletion. At HEAD both were present (`git show HEAD:... | grep` found 4 hits), and the other 8 claims resolved. The `ScenarioComposer.test.tsx` anchors (`OVERVIEW_HEADING_BY_CLASS`) are likewise now absent by design.

**4. Task 1 commit leaves `tsc` red until Task 2.** `ScenarioComposer.test.tsx` imported the deleted panel, so `ab06c31fd` alone does not type-check. Task 2's commit restores it. Both are in the same branch push.

## Not touched

No migration, no API route change, no analytics-service change. STATE.md, ROADMAP.md, CHANGELOG.md and VERSION are untouched. The 19,000-line `ScenarioComposer.test.tsx` kept every other case byte-identical.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

- Commits `ab06c31fd` and `db1acbac1` are on `feat/198-mybook`.
- `grep -a -c "HEADING_BY_CLASS"` on `EquityHistoryRebuilding.tsx` prints 0; `export function EquityHistoryRebuilding` 0; `export function ExchangesPageLink` 1; `export function equityHistoryRebuildClass` 1.
- `grep -a -c "overview-equity-rebuilding"` and `OVERVIEW_HEADING_BY_CLASS` on `ScenarioComposer.test.tsx` print 0.
