---
phase: 107-leverage-as-a-dailies-transform
plan: 01
subsystem: ui
tags: [react, factsheet, leverage, context, useMemo, vitest, dailies-transform]

# Dependency graph
requires:
  - phase: 103-mtm-daily-series-charts-follow
    provides: useBasisSeriesView per-basis series view-merge + deriveSeriesBundle per-basis derivation
  - phase: 90.5-leverage-context
    provides: LeverageContext/LeverageProvider + sanitizeLeverage read-side clamp
provides:
  - deriveSeriesBundle exported from build-payload.ts (was module-private)
  - LeverageContext exported for graceful useContext read
  - leverage layer composed INTO useBasisSeriesView (basis-merge first, then r→L·r re-derive)
  - SC-4 by-reference short-circuit at sanitizeLeverage(L)===1
  - SC-2 α/β honesty algebra pinned at the joint unit level
affects: [107-02, factsheet-view, kpi-strip, metrics-column, control-bar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Leverage as a dailies transform: lever the strategy daily return r→L·r, then RE-derive the whole bundle (never analytic-rescale α/β)"
    - "Two-layer view composition in one shared hook: active-basis merge FIRST, leverage transform SECOND"
    - "SC-4 by-reference short-circuit at unity precedes any deriveSeriesBundle call (byte-identity, not float reasoning)"

key-files:
  created:
    - src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
  modified:
    - src/lib/factsheet/build-payload.ts
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/leverage-context.tsx
    - src/lib/factsheet/joint.test.ts

key-decisions:
  - "Composed leverage INTO useBasisSeriesView in place (name/signature/export unchanged) so all ~12 consumers follow L with zero per-consumer wiring — consumers rewired in plan 02"
  - "comparatorAnnVol OMITTED on the levered re-derive so the levered bundle vol-matches its OWN levered vol (mirrors the MTM arm)"
  - "Four fail-closed guards each return base BY REFERENCE: L===1, composite, periodsPerYear absent, MTM-bundle-absent (no fabrication)"
  - "Only the strategy leg is levered; benchmark legs re-align un-levered inside deriveSeriesBundle → β→L·β / α→L·α / corr-invariant fall out honestly"

patterns-established:
  - "Pattern 1: leverage-as-a-dailies-transform — scale r→L·r on the active-basis dailies then re-derive, per scenario.ts lev() precedent"
  - "Pattern 2: unity short-circuit returns base by reference so L=1 render is byte-identical"

requirements-completed: [LEV-BB]

# Metrics
duration: 12min
completed: 2026-07-15
---

# Phase 107 Plan 01: Levered-view backbone Summary

**Composed a leverage layer into the one shared `useBasisSeriesView` hook — active-basis dailies are scaled r→L·r and the whole bundle re-derives at L≠1 (charts + rolling + comparators + rail scalars), with a by-reference no-op at L=1, and the α/β honesty algebra pinned falsifiably at the joint unit level.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-15T15:55:00Z
- **Completed:** 2026-07-15T16:02:00Z
- **Tasks:** 2
- **Files modified:** 4 (+1 created)

## Accomplishments
- Exported `deriveSeriesBundle` (build-payload.ts) and `LeverageContext` (leverage-context.tsx) as the two enablers for a client-side levered re-derive.
- Extended `useBasisSeriesView` with a second layer: basis-merge first, then `r→L·r` re-derive via `deriveSeriesBundle` at L≠1 (SC-1 backbone), with the SC-4 by-reference short-circuit at `sanitizeLeverage(L)===1` placed BEFORE any derive call.
- Four fail-closed guards (L===1, composite, periodsPerYear absent, MTM-bundle-absent) each return the base view by reference — no fabricated basis.
- Pinned the SC-2 honesty algebra (`β→L·β`, `α→L·α`, corr invariant) at the `jointMetrics` unit level, falsifiable against any future analytic re-scale.
- New hook-level test file (Tests A–G): SC-4 reference identity + round-trip, SC-1 cash scaling, SC-2 comparator wiring, three guards, MTM-levered active-basis, mask preservation, and graceful degrade without a LeverageProvider.

## Task Commits

Each task was committed atomically:

1. **Task 1: SC-2 joint L-scaling proof + export enablers** - `8fc83990` (test)
2. **Task 2: Compose the leverage layer into useBasisSeriesView** - `50f6a01c` (feat)

_Task 2 is TDD: the test file was authored first and shown RED (4 failures at L≠1) before the hook extension turned it GREEN; both committed together as the atomic task unit._

## Files Created/Modified
- `src/lib/factsheet/joint.test.ts` - Added the "LEV-BB leverage scaling (Phase 107 SC-2)" describe: β→L·β, α→L·α (10dp), corr invariant.
- `src/lib/factsheet/build-payload.ts` - `deriveSeriesBundle` made `export function` (only change).
- `src/app/factsheet/[id]/v2/leverage-context.tsx` - `LeverageContext` made `export const` (only change).
- `src/app/factsheet/[id]/v2/basis-context.tsx` - Composed the leverage layer into `useBasisSeriesView`; added imports (`deriveSeriesBundle`, `sanitizeLeverage`, `LeverageContext`); useMemo deps now `[basis, leverage, payload]`; updated doc block.
- `src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx` - New hook-level leverage-view test file (Tests A–G).

## Decisions Made
- Kept `useBasisSeriesView` name/signature/export unchanged and composed leverage in place — the CONTEXT-locked "no rename across the 12 call sites" constraint; consumers are rewired in plan 02.
- `comparatorAnnVol` deliberately omitted on the levered re-derive; `missingSegments: base.missingSegments` passed through explicitly (the bundle spread would otherwise clobber the base mask with undefined).
- Both contexts read via non-throwing `useContext(...)?.` reads so isolated panel mounts degrade to cash / L=1 rather than crash.
- The transient `leverage-context ⇄ basis-context` import cycle in this wave is benign (neither references the other's bindings at top-level evaluation); plan 02 removes the `useBasisMetrics` leg.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Non-null assertions on comparator `joint` in the SC-2 wiring test**
- **Found during:** Task 2 (basis-context.leverage.test.tsx)
- **Issue:** `comparators.btc.joint` is typed `JointMetrics | null`; `tsc --noEmit` flagged `TS18047 'joint' is possibly null` on Test C's β/α/corr assertions.
- **Fix:** Added `expect(...).not.toBeNull()` guards plus `!` assertions on `baseJoint`/`levJoint` in the arithmetic assertions.
- **Files modified:** src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
- **Verification:** `tsc --noEmit` exit 0; Test C still green.
- **Committed in:** `50f6a01c` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking, test-only type-narrowing).
**Impact on plan:** Scoped entirely to the new test file; no production behavior change, no scope creep.

## Issues Encountered
None — planned work executed as specified.

## Known Stubs
None — no placeholder/empty-data stubs introduced. The hook re-derives real bundles; L=1 and all four guards return the fully-populated base view by reference.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can now delete `useModeledLeverage` / `useLeveragedMetrics` and rewire the 12 consumers (KpiStrip, MetricsColumnWithBasis, ControlBar, charts) onto the levered `useBasisSeriesView` view.
- No consumer file touched yet — `FactsheetView` still compiles against the old hooks (SC-5 grep-gate + consumer rewire land in plan 02).
- Byte-untouched invariants held: `scenario.ts`, `leverage.ts`, `joint.ts`, and the `build-payload.test.ts.snap` SC-4 golden are all unchanged.

## Self-Check: PASSED

- FOUND: src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
- FOUND: .planning/phases/107-leverage-as-a-dailies-transform/107-01-SUMMARY.md
- FOUND commit: 8fc83990 (Task 1)
- FOUND commit: 50f6a01c (Task 2)

---
*Phase: 107-leverage-as-a-dailies-transform*
*Completed: 2026-07-15*
