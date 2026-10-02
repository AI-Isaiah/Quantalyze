---
phase: 133-smoothed-mtm-factsheet-toggle
plan: 01
subsystem: ui
tags: [factsheet, basis-toggle, smoothed-mtm, react, typescript, deribit-options]

# Dependency graph
requires:
  - phase: 132-smoothed-mtm-worker-persistence
    provides: "persisted metrics_json_by_basis.smoothed_mtm scalars + smoothed_mtm_daily_returns series (kind KIND_SMOOTHED_MTM)"
  - phase: 103-mtm-04-per-basis-series
    provides: "the mark_to_market two-layer basis mechanism (payload plumbing + basis-context + SegmentedControl) this clones as a sibling"
provides:
  - "Third factsheet basis segment: Smoothed mark-to-market, reading persisted smoothed_mtm scalars + series"
  - "smoothed_mtm through BOTH read paths (composite readCompositeFactsheet AND single-key page.tsx threading)"
  - "smoothedGate (server-truth availability) + smoothedDisabledReasonCopy (closed-set honest-disabled)"
  - "A decided, test-pinned smoothed posture at every basis-consuming render surface (eyebrow, caption, suppressRelative, leverage re-pin/eligibility, peer-rank note, brush x-range clamp)"
affects: [factsheet-render, deribit-options-books, phase-134+, live-verification-followup]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling-arm additivity: every smoothed hunk is a new arm beside an existing mark_to_market site; the only edited existing predicate is the singleKeyBasisOpts early return (pure additive check)"
    - "Bundle-READ sites are basis surfaces too: the factsheet-context brush x-range clamp (invisible to a `=== \"mark_to_market\"` grep) needed the smoothed third max() term"

key-files:
  created: []
  modified:
    - src/lib/types.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/metrics-parity-helper.ts
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/factsheet-context.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx

key-decisions:
  - "Segment label = 'Smoothed mark-to-market' (full-word, sentence case) to match the existing 'Mark-to-market' sibling per DESIGN.md, NOT the plan's suggested abbreviation 'Smoothed MTM'"
  - "smoothedGate carries a single closed-set reason 'smoothed_basis_unavailable' (no persisted smoothed-reason column exists); its copy is always STEADY/muted — no amber tone split needed"
  - "Toggle-availability predicate deliberately UNwidened: payload.mtmGate != null already covers the {smoothed_mtm}-only edge after Task-1's early-return extension"
  - "singleKeyBasisOpts :364 early return extended to check the smoothed key too, so a {smoothed_mtm}-only row (MTM degraded reason-lessly) is no longer silently dropped"

patterns-established:
  - "Per-basis three-state chart caption + three-way eyebrow: cash/MTM/smoothed each own a decided label; no silent cash fallthrough under a non-cash label"
  - "React Compiler dependency-inference match: the smoothed brush-clamp dep is specified at the inferred `.dates` array level (not `.dates.length`) to preserve manual memoization"

requirements-completed: [SMTM-01, SMTM-04]

# Metrics
duration: ~90min
completed: 2026-07-22
---

# Phase 133 Plan 01: Smoothed MTM Factsheet Toggle Summary

**A third "Smoothed mark-to-market" basis segment on the factsheet SegmentedControl that reads the Phase-132-persisted `smoothed_mtm` scalars + series on both composite and single-key factsheets, honest-disabled with a mapped reason where absent, with a decided smoothed posture pinned at every basis-consuming render surface.**

## Performance

- **Duration:** ~90 min (resumed after a prior executor stalled mid-Task-1; Task-1 WIP recovered from working tree)
- **Completed:** 2026-07-22
- **Tasks:** 3 completed
- **Files modified:** 10 source + 4 test files

## Accomplishments
- Smoothed_mtm flows server → payload on BOTH read paths — composite `readCompositeFactsheet` and the single-key `page.tsx` series threading (the plan-check HIGH-1 gap), wiring-guarded.
- basis-context third arm: Basis union, scalar overlay, series-view swap, levered persisted-scalar re-pin, and leverage eligibility — all exact structural clones of the MTM arms.
- Third SegmentedControl segment + a test-pinned smoothed posture at every basis site: eyebrows (two), chart caption three-state, suppressRelative, peer-rank note, and the F2.3 brush x-range clamp (the plan-check HIGH-2 bundle-READ site).

## Task Commits

Each task was committed atomically (per the resumption mandate — a stall cannot lose committed progress):

1. **Task 1: Types + payload plumbing — smoothed_mtm through BOTH read paths** — `6c04f609` (feat) — includes the metrics-parity-helper.ts exclusion (the tsc unblock).
2. **Task 2: basis-context third arm — union, overlay, series swap, leverage re-pin + eligibility** — `44b01f9f` (feat)
3. **Task 3: SegmentedControl third segment + smoothed posture at every basis site** — `acb49ef7` (feat)

_TDD: Tasks 2 and 3 followed failing-test-first (RED confirmed meaningful before GREEN). Task 1 was recovered WIP already carrying its tests; verified green before committing._

## Files Created/Modified
- `src/lib/types.ts` — `SmoothedMtmDailyReturnsSeriesPayload` (basis:"smoothed_mtm" literal, optional nan_dates) + kind literal/constant + discriminated row member
- `src/lib/factsheet/types.ts` — metricsByBasis/seriesByBasis `smoothed_mtm` keys + `smoothedGate` typing
- `src/lib/factsheet/composite-read-path.ts` — `parseSmoothedSeriesPayload` (wrong-basis reject + nan_dates tolerance), `readSmoothedSeries`, composite gate/series threading, widened `singleKeyBasisOpts` early return, `shouldReadSingleKeySmoothedSeries`
- `src/lib/factsheet/build-payload.ts` — `seriesByBasis.smoothed_mtm` bundle assembly + smoothedGate passthrough (BuildFactsheetOpts sibling fields)
- `src/lib/metrics-parity-helper.ts` — exclude `smoothed_mtm_daily_returns` (a directly-read sibling kind, not an RPC-panel kind)
- `src/app/factsheet/[id]/v2/page.tsx` — single-key smoothed series read threaded as the 5th arg to `singleKeyBasisOpts`
- `src/app/factsheet/[id]/v2/basis-context.tsx` — Basis union third member; smoothed overlay/series-view arms; :325 re-pin; leverageEligibleFor clause; `smoothedDisabledReasonCopy`
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` — F2.3 brush x-range clamp third `max()` term over `seriesByBasis.smoothed_mtm.dates` + dep
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — third SegmentedControl segment + inline disabled reason; MetricsColumn eyebrow three-way; composite KpiStrip eyebrow three-way; caption three-state; suppressRelative smoothed clause; smoothedGate vars
- `src/app/factsheet/[id]/v2/BatchDPanels.tsx` — peer-rank note also renders under smoothed
- Tests: `composite-read-path.test.ts`, `build-payload.arithmetic.test.tsx`, `basis-context.test.tsx`, `basis-context.leverage.test.tsx`, `FactsheetBody.basis.test.tsx`, `MasterBrush.basis.test.tsx`

## Closure-grep audit (`grep -rn 'mark_to_market' src/app/factsheet src/lib`, non-comment non-test hits)

Every remaining non-comment hit has a decided, test-pinned smoothed posture:

| Site | Kind | Smoothed posture |
|------|------|------------------|
| FactsheetView :343 | switch (MetricsColumn eyebrow predicate) | extended — `onMtm` also true under smoothed w/ bundle; `basisEyebrowLabel` = "SMOOTHED MARK-TO-MARKET" |
| FactsheetView :431 | bundle read (PerformanceCharts) | `smoothedBundlePresent` sibling added |
| FactsheetView :525 | caption switch | per-basis three-state (smoothed present/absent copies) |
| FactsheetView :777 | bundle read (KpiStrip) | `smoothedBundlePresent` sibling added |
| FactsheetView :830 | switch (suppressRelative) | smoothed clause added (absent-bundle smoothed hides α/IR) |
| FactsheetView :870 | switch (composite eyebrow) | three-way label |
| FactsheetView :1309 | SegmentedControl item | third `smoothed_mtm` segment added |
| basis-context (9 sites) | union + overlay + series + re-pin + eligibility | Task-2 smoothed siblings |
| factsheet-context :228, :246 | bundle READ (brush clamp + dep) | smoothed third max() term + dep |
| BatchDPanels :132 | switch (peer note) | gate includes `smoothed_mtm` |
| types.ts :568 / factsheet/types.ts :570,:633 | type declaration | smoothed sibling types added (Task 1) |
| build-payload.ts :446 | series assembly | smoothed bundle assembly added (Task 1) |
| composite-read-path.ts :301,:431,:456,:503 | read/extract sites | smoothed siblings added (Task 1) |

Chart components (TimeSeriesChart, HistogramChart, MasterBrush, MetricsColumn, DistributionPanels) reference `mark_to_market` only in COMMENTS — they consume through the basis-agnostic `useBasisSeriesView` and follow smoothed automatically with no code change (comment-only hits, verified).

## Decisions Made
See `key-decisions` frontmatter. Most notable: the segment label conforms to the existing "Mark-to-market" full-word sentence-case convention ("Smoothed mark-to-market") rather than the plan's suggested "Smoothed MTM" — a DESIGN.md-conformance choice.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] React Compiler manual-memoization preservation on the brush-clamp dependency**
- **Found during:** Task 3 (factsheet-context brush x-range clamp)
- **Issue:** Adding `payload.seriesByBasis?.smoothed_mtm?.dates.length` to the `setXRange` useCallback dependency array tripped `react-hooks/preserve-manual-memoization` — the React Compiler inferred the dependency at the `.dates` array level while the source specified the more-specific `.dates.length`, so it refused to preserve the memo (lint error, blocking the Task-3 gate).
- **Fix:** Specified the smoothed dependency at the inferred `.dates` array level (`payload.seriesByBasis?.smoothed_mtm?.dates`) to match the compiler's inference. Behavior-neutral (the memo re-computes on payload change either way; this is a new dependency, so no cash/MTM byte-identity impact). The existing `mark_to_market` dep line was left byte-untouched.
- **Files modified:** `src/app/factsheet/[id]/v2/factsheet-context.tsx`
- **Verification:** `npx eslint` clean on the file; full factsheet vitest surface (526) re-run green post-fix.
- **Committed in:** `acb49ef7` (part of Task 3)

**2. [DESIGN.md conformance] Segment label wording**
- **Found during:** Task 3
- **Issue:** The plan suggested "Smoothed MTM"; the existing sibling segment is "Mark-to-market" (full word, sentence case).
- **Fix:** Used "Smoothed mark-to-market" for label/casing consistency (DESIGN.md takes precedence per CLAUDE.md). Eyebrow uses the uppercased "SMOOTHED MARK-TO-MARKET" matching the existing "MARK-TO-MARKET" eyebrow.
- **Committed in:** `acb49ef7`

---

**Total deviations:** 2 (1 Rule-3 blocking auto-fix, 1 DESIGN.md conformance choice)
**Impact on plan:** No scope creep. The lint fix was required for the gate; the label choice honors the codebase convention.

## Issues Encountered
Prior executor stalled (infra watchdog) mid-Task-1. Task-1 WIP was recovered from the working tree (uncommitted). Verified the recovered WIP fully satisfied Task 1 (types, single-key page.tsx read, parser nan_dates tolerance, extended :364 early-return predicate + wiring-guard test), ran its gates green (97 tests), and committed it atomically — including the metrics-parity-helper.ts tsc unblock. Then executed Tasks 2 and 3 with per-task commits so a future stall cannot lose progress.

## Known Stubs
None. The segment reads REAL persisted data (metrics_json_by_basis.smoothed_mtm + smoothed_mtm_daily_returns series) — no static placeholders; absent data yields the honest-disabled segment (`?? {}` no-invented-data), never cash under a smoothed label.

## Verification
- `npx vitest run "src/app/factsheet/[id]/v2" src/lib/factsheet --no-file-parallelism` → **526 passed / 47 files** (before: same suite green; after: +11 new smoothed tests, 0 pre-existing modified).
- `npx tsc --noEmit` → **clean (exit 0)**.
- `npm run lint` → **0 errors** (1 pre-existing warning in the untouched `EquityChart.tsx` — out of scope).
- cash/MTM byte-identity: every hunk is a smoothed sibling arm or an additive predicate/`max()` term; all pre-existing basis/kpistrip/MasterBrush tests green UNMODIFIED.

## Follow-ups (named in the plan's success criteria, NOT in this plan)
- Phase close-out: gsd-code-reviewer + gsd-verifier per founder review policy.
- Live verification (Phoenix re-onboard + Zav2 + perp-only byte-identity spot check) — blocked on re-onboarding the deleted key.

## Self-Check: PASSED
- Commits `6c04f609`, `44b01f9f`, `acb49ef7` all FOUND in git log.
- All 10 modified source files present and committed; 526-test surface green; tsc + lint clean.
