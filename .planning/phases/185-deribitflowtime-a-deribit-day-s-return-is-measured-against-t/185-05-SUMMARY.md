---
phase: 185-deribitflowtime-a-deribit-day-s-return-is-measured-against-t
plan: 05
subsystem: allocator-dashboard
tags: [deribit, allocator, key_inputs, caveat, factsheet, kpistrip, tdd]
status: complete

requires:
  - phase: 185-deribitflowtime
    provides: "plan 185-04: key_inputs options_cash_basis flag, OPTIONS_CASH_BASIS_FLAG, isOptionsCashBasis, the F3 answer (D-09)"
provides:
  - "readMarksStart returns optionsCashBasis; MyAllocationDashboardPayload.optionsCashBasis on both return branches"
  - "dataQuality.optionsCashBasis on the allocator factsheet payload, only when true"
  - "AllocationDashboardV2 optionsCashBasis prop, passed to the builder and listed in the memo's dependencies"
  - "the third sentence arm of KpiStrip's one amber paragraph, the founder's F3 sentence"
affects: [185-08]

requirements-completed: [SC-3]

plan_head_before: a6821ea92945c61d0608bce0c6b57f24421c8815
plan_head_after: a7ddaa9336bba3fa6f32649517cf653f7afe5c78
actuals:
  tokens: 20000
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "a second field carried on the NAVMTM marks_since read: same rows, same single query, same fail-closed rule"
    - "present-only dataQuality field set by spread in the allocator builder, absent otherwise"

key-files:
  created:
    - src/app/(dashboard)/allocations/AllocationDashboardV2.options-caveat.test.tsx
  modified:
    - src/lib/queries.ts
    - src/lib/queries.my-allocation.test.ts
    - src/lib/factsheet/allocator-portfolio-payload.ts
    - src/lib/factsheet/allocator-portfolio-payload.test.ts
    - src/lib/factsheet/types.ts
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.kpistrip.test.tsx
    - src/__tests__/options-cash-basis-literal-pin.test.ts

key-decisions:
  - "F3 / D-09 placement=a: the sentence is a third arm of the existing amber paragraph, after the small-balance and large-flow arms, so one paragraph prints however many flags are true."
  - "The flag is carried on dataQuality.optionsCashBasis with composite: false, the value a payload without dataQuality is read as by every other consumer."

duration: 40min
completed: 2026-11-01
---

# Phase 185 Plan 05: Interim options caveat (reader half) Summary

An allocator book whose drawn keys store `options_cash_basis: true` now shows the founder's F3 sentence in the existing amber paragraph on the /allocations Overview, read from the `key_inputs` rows the dashboard already reads, with no new query.

## Founder answer used (F3, D-09)

f3-answer (copied from plan 185-04's SUMMARY): placement=a trigger=a removal=a sentence="Some days on a Deribit account were measured against its cash balance, which leaves out open option positions, so their returns can be extreme."

The rendered text is `⚠ ` plus that sentence. `grep -c` of the sentence prints 1 in `FactsheetView.tsx` and 1 in plan 185-04's SUMMARY; the kpistrip test asserts the rendered paragraph equals `⚠ ` plus the same text.

## Task Commits

| Task | Commit | Message |
|---|---|---|
| 1 RED | d25830463 | test(185-05): RED - the options caveat never reaches the allocator book |
| 1 GREEN | 6b9c97af4 | feat(185-05): the options caveat reaches the allocator book |
| 2 RED | 65055bde9 | test(185-05): RED - the allocator caveat's sentence and its edges |
| 2 GREEN | a7ddaa933 | feat(185-05): the allocator book shows the founder's options caveat |

`commits: 4` is `git rev-list --count a6821ea92..a7ddaa933`, measured from the per-plan ledger file in the git dir.

## RED evidence

- Task 1 (`/tmp/deribitflowtime-05/red1.log`): 3 failed, 187 passed. The two queries tests failed with `expected undefined to be true` / `to be false`; the dashboard "optionsCashBasis true" test failed with `expected 'false' to be 'true'`. The dashboard's false and absent cases passed (they describe today's behaviour and are pins).
- Task 2 (`/tmp/deribitflowtime-05/red2.log`): 1 failed, 282 passed. The failure is the render test "shows exactly one amber paragraph reading the founder's sentence". Every other new test passed on Task 1's code.

### Edge tests that were pins (passed on first run)

These passed at RED because Task 1's code already implements the strict reader, the fail-closed rule, the builder parse and the key lookup. Their ability to fail is shown by the drills below, not by a first red run:

- queries: "true" and 1 give false; the departed key counts without `departed_history_unavailable` and fails closed with it; a live key still counts with it; another owner's row never raises it; a failed read gives false, warns once with `key_inputs marks_since read failed` and leaves `marksStart` null.
- builder: `{ composite: false, optionsCashBasis: true }` on true; "true", 1, false, null and absent are `toStrictEqual` to the build without the key; the flag with `marksStart` keeps `marksSince`.
- kpistrip: no paragraph without the flag; a strategy payload with `smallBaseMeasured` keeps its sentence; with all three flags one paragraph prints and the small-balance sentence wins.
- literal pin: `queries.ts` reads `isOptionsCashBasis(payload?.[OPTIONS_CASH_BASIS_FLAG])` and the builder calls `isOptionsCashBasis(meta.optionsCashBasis)`. The plan said the pin's new assertions must fail at RED; they cannot, because Task 1 had already written the lines they match. Neuter drill 2 below does make the pin fail.

## Neuter drills (each restored with `cp`, confirmed with `cmp`)

1. Task 1, hop prop to payload (`neuter1.log`): deleted the `dataQuality` spread entry in `allocator-portfolio-payload.ts`. `AllocationDashboardV2.options-caveat.test.tsx`: 1 failed ("optionsCashBasis true: the payload handed to the body carries it"), 2 passed. Restored, `cmp` clean.
2. Task 2, strictness (`neuter2.log`): replaced `isOptionsCashBasis(payload?.[OPTIONS_CASH_BASIS_FLAG])` with `Boolean(payload?.[OPTIONS_CASH_BASIS_FLAG])` in `readMarksStart`. 3 failed: the "string true" and "number 1" queries tests, and the literal pin's lookup assertion. Restored, `cmp` clean.
3. Task 2, fail-closed (`neuter3.log`): replaced the fail-closed `some(...)` with `optionsCashBasisKeyIds.length > 0`. 1 failed: "a departed key's flag counts when the derive left no departed account out, and fails closed when it did (T-185-16)". Restored, `cmp` clean.

## Verification

- `npx vitest run` of `queries.my-allocation`, `allocator-portfolio-payload`, `FactsheetView.kpistrip`, `options-cash-basis-literal-pin`, `nav-marks-start-literal-pin` and `AllocationDashboardV2.options-caveat`: 6 files, 295 tests passed. The `AllocationDashboardV2.staleness` test (mocked builder) also passes unedited (Task 1 run: 5 files, 267 passed).
- `npm run typecheck`: clean. `npm run lint`: 0 errors, 2 warnings, both unused-variable warnings in `MetricsColumn.tsx` and `composite-read-path.ts`, files this plan did not touch.
- `grep -c 'OPTIONS_CASH_BASIS_FLAG' src/lib/queries.ts`: 2. `grep -c optionsCashBasis AllocationDashboardV2.tsx`: 3. `grep -c optionsCashBasis FactsheetView.tsx`: 2.
- `grep -c 'from("allocator_equity_derived")' src/lib/queries.ts`: 3 at `PLAN_BASE` and 3 now (no new read).
- The existing D-15 caveat describe is unedited: `git diff PLAN_BASE HEAD -- FactsheetView.kpistrip.test.tsx` has 0 removed lines (the file only gains the new import and describe).

## Whole-object `dataQuality` reads checked (Task 2 read_first)

Each treats `{ composite: false, optionsCashBasis: true }` like an absent `dataQuality` for every other field, because each gates on `twrChainBroken === true`, `composite === true`, a `degradedMembers` length, or optional chaining, none of which the new object sets:

- `FactsheetView.tsx:1804` `isHeadlineWithheld(payload.dataQuality, basis)`: requires `twrChainBroken === true`.
- `FactsheetView.tsx:1841` `windowCoverageNote(...)` and `:1844` `headlineCoverageNote(...)`: return null unless `twrChainBroken === true`.
- `FactsheetView.tsx:2130,2133` `degradedMembers!`: rendered only inside `(degradedMembers?.length ?? 0) > 0`.
- `TimeSeriesChart.tsx:507`: a memo dependency, with `composite === true` read beside it.
- `MetricsColumn.tsx` `isHeadlineWithheld`, `headlineCoverageNote`, `windowCoverageNote`, `headlineBenchSource` (called at 291, 335, 340, 341, 967): all gated on `twrChainBroken === true`.
- `src/app/factsheet/[id]/v2/page.tsx` mentions of `dataQuality` are comments on the strategy cache key, which this plan does not touch.

## Deviations from Plan

None - plan executed as written. One plan premise was inaccurate and is recorded above: the literal pin's new assertions could not fail at RED because Task 1 had already written the matched lines.

## skip-ui

skip-ui: re-uses the existing amber paragraph; copy per f3-answer. No new component, token or layout; DESIGN.md's warning-amber rule (recoverable disclosure) applies and the paragraph keeps its class and `var(--color-warning)` style.

## PR-1 ship note

The /allocations Overview shows the founder's options caveat when any drawn key's stored inputs carry the flag, with no new read and no strategy factsheet change. With plan 185-04 (the writer) this completes PR-1.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, read, auth path or schema; the existing user-client read now also returns one bool.

## Self-Check: PASSED

Found: `src/app/(dashboard)/allocations/AllocationDashboardV2.options-caveat.test.tsx`. Commits d25830463, 6b9c97af4, 65055bde9 and a7ddaa933 are ancestors of HEAD.
