---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 10
subsystem: factsheet
tags: [copy, plainwords, tearsheet, dates, trust-tier]
requires: [201-25, 201-26]
provides:
  - tier-conditioned tearsheet custody clause (D-24)
  - factsheet dates through formatDay (U-14)
  - Diversified Crypto Blend / My allocation names (U-20, D-04)
affects: [201-23, 201-24]
key-files:
  modified:
    - src/app/factsheet/[id]/tearsheet/page.tsx
    - src/app/factsheet/[id]/tearsheet/page.test.tsx
    - src/app/factsheet/[id]/trade-fetch-lines.tsx
    - src/app/factsheet/[id]/trade-fetch-lines.test.ts
    - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
    - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/basis-context.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.joint-floor.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.flat-leg.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx
    - src/app/factsheet/[id]/v2/heatmap-month-labels.test.tsx
    - src/app/factsheet/[id]/v2/charts.signed-zero.test.tsx
    - src/lib/factsheet/joint.ts
    - src/lib/factsheet/joint.test.ts
    - src/lib/factsheet/returns-unit.ts
    - src/lib/factsheet/returns-unit.test.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/lib/factsheet/allocator-portfolio-payload.ts
    - src/lib/factsheet/allocator-portfolio-payload.test.ts
    - scripts/copy-census/ledgers/plan-10.ts
status: complete
commits: 3
plan_head_before: 5f40a8082
plan_head_after: 7f957cafd
actuals:
  tasks: 3
  commits: 3
---

# Phase 201 Plan 10: factsheet copy, dates and tearsheet custody Summary

The tearsheet now says "monitored via read-only exchange APIs" only for an `api_verified` strategy, and every factsheet date prints the full day through `formatDay`.

## Tasks

| Task | Commit | Result |
|---|---|---|
| 1 (tracer) tearsheet custody clause by trust tier, formatDay `generated` stamp | f84c35ed3 | csv, self-reported, missing and unknown tiers read `Managers retain asset custody.` |
| 2 dates via helper, demo/fallback names, positions wording | 63e095173 | `formatIsoDate`/`formatCloseDay` delegate to `formatDay`; heatmap and ticks read `MONTH_ABBR`; `pairedFloorReason` ends with the full day and gains `"allocation"` |
| 2 follow-up: signed-zero heatmap title pins | 7f957cafd | `charts.signed-zero.test.tsx` pins `Apr 2023: 0.00%` form |
| 3 Term on remaining labels, ledger empty | (no code) | the plan-10 census reports zero rule A, B and C hits; `plan-10.ts` has `pending: {}` since Task 2. No file needed Term wrapping, so no `.terms.test.tsx` was created |

## Verification

- `npx tsx scripts/copy-census/run.ts --ledger plan-10`: no hits, exit 0.
- Scoped vitest (factsheet dirs, `src/lib/factsheet/`, copy-census, figure-gate-census, factsheet-census count, with the plan's excludes): 3418 passed, 3 failed, 198 files (196 passed, 2 failed). The 3 failures are not caused by this plan:
  - `compute.conventions.test.ts` fixtures B and C (2): last-digit float differences in `skew` (`-0.11360716852722537` vs `...538`, `0.036844507138639` vs `...638946`). `compute.ts` and that test are untouched by this branch; this is platform float drift in a frozen snapshot, deferred.
  - `MetricsColumn.comparator-floor.test.tsx` (1): see cross-plan-pins.
- `npx eslint` on the touched source files: exit 0, clean.
- `npx tsc --noEmit -p .`: exit 0 (no output).
- Snapshot check: the `build-payload` snapshot diff is one line, and replacing `Diversified Crypto Book` with `Diversified Crypto Blend` in the old line reproduces the new line exactly. Only the name moved.

gc-201-10-neuter: gate=src/app/factsheet/[id]/tearsheet/page.test.tsx (custody clause made unconditional) result=red restored=identical
gc-201-10-neuter: gate=src/lib/factsheet/returns-unit.test.ts (formatCloseDay honours { year: false }; "Oct 8" vs "Oct 8, 2026") result=red restored=identical
gc-201-10-neuter: gate=src/lib/factsheet/joint.test.ts (comparator end date off formatDay) result=red restored=identical
gc-201-10-gates: vitest=green-except-3-noted eslint=clean tsc=clean

cross-plan-pins: `src/app/factsheet/[id]/v2/MetricsColumn.comparator-floor.test.tsx` "the KPI strip line and section IV both end with 'SPX prices end Aug 2.'" (line 171) expects `... SPX prices end Aug 2.`; the sentence now ends `Aug 2, 2024.` (U-14). Owned by plan 201-08 (MetricsColumn), recorded for plan 201-24, not edited here.

## Deviations from Plan

- The first executor was killed mid-run. Resumed: committed its uncommitted `charts.signed-zero.test.tsx` (a heatmap title pin that moved with Task 2's `Mon YYYY` titles) as a separate commit; re-ran all three neuters on byte backups to record them from this session.
- Task 3 produced no code change because the census had no remaining hits after Tasks 1 and 2.
- Plan 201-09 also edits `FactsheetBody.basis.test.tsx` and `FactsheetBody.joint-floor.test.tsx`; the orchestrator resolves the merge overlap.

## Known Stubs

None.

## Self-Check: PASSED

Commits f84c35ed3, 63e095173, 7f957cafd are on branch wt/201-p10; acceptance greps (`toLocaleDateString`, `MONTH_HEADERS`, `formatAbsoluteDate`, `Diversified Crypto Book`, `My Portfolio` all 0; `api_verified` 3) verified.
