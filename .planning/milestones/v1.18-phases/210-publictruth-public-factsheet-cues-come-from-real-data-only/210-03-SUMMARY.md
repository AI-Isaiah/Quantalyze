---
phase: 210-publictruth-public-factsheet-cues-come-from-real-data-only
plan: 03
subsystem: factsheet
tags: [factsheet, dead-code, tracer, d-13]
requires: []
provides:
  - FactsheetBodyOptions no longer declares the no-op allocator-section prop (D-13)
  - tsc forbids any caller from passing it again
affects: [factsheet, publictruth]
key-files:
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/(dashboard)/allocations/AllocationDashboardV2.tsx
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
    - 43 render test files under src (attribute deleted, three comments reworded)
decisions:
  - "Test edits were scripted (regex delete of the bare attribute); the diff was reviewed and shows 55 insertions and 67 deletions, all re-rendered FactsheetBody lines or reworded comments"
metrics:
  completed: 2026-11-14
status: complete
actuals:
  tokens: 20000
  tasks: 2
  commits: 2
plan_head_before: 291125b6e09de2b4cdc97c64052e80d1f32a3d5b
plan_head_after: 0569228c52fad374629e9f72e66a2a72bdf48583
commits: 2
---

# Phase 210 Plan 03: remove the no-op allocator-section prop Summary

`FactsheetBodyOptions.hideAllocatorSection`, a no-op since QUIETVIEW, is gone from the interface, from both production mounts (allocator Overview and the scenario chart) and from 43 render tests, so `git grep -a hideAllocatorSection -- src` finds nothing and tsc rejects a re-added prop.

## Commits

- `f328b78b4` refactor(210-03): interface member and docblock, both production props and the comments naming it (Task 1, tracer).
- `0569228c5` test(210-03): bare attribute deleted from every FactsheetBody render in 43 tests; three comments that listed it reworded (Task 2).

## Verification

- `npx tsc --noEmit`: after Task 1, 64 `error TS` lines, all in `*.test.tsx` files and none in production files (the expected excess-property errors); after Task 2, exit 0 with no output.
- Tracer gate: `AllocationDashboardV2.staleness` and `scenario-factsheet-payload.empty-render` tests pass (13 tests).
- `src/app/factsheet/[id]/v2`, `src/app/api/og/factsheet/[id]`, `src/lib/freshness.two-surfaces.test.tsx` and `src/app/(dashboard)/allocations/widgets`: 180 files, 2267 tests pass, none skipped by this change.
- The plan-level `npm run lint` and full `npm test` were not run in this execution; the touched-path vitest set and tsc were.

## Deviations from Plan

None - plan executed as written.

## Known Stubs

None.

## Self-Check: PASSED

- f328b78b4 and 0569228c5 are ancestors of HEAD.
- Three edited production files exist; absence grep over src returns no match.
