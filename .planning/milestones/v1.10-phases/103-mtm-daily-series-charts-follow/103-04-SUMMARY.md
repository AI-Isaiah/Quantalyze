---
phase: 103-mtm-daily-series-charts-follow
plan: 04
subsystem: factsheet-client-view
tags: [typescript, nextjs, react, mtm, client-view-merge, charts, MTM-04, factsheet]

# Dependency graph
requires:
  - phase: 103-03
    provides: payload.seriesByBasis.mark_to_market (per-basis bundle — own axis + own mask + every dailies-derivable panel)
provides:
  - useBasisSeriesView — the client view-merge that selects the active-basis bundle ({...payload, ...bundle} under MTM; identity under cash/absent-bundle)
  - every chart surface + every dailies-derivable statistics panel follows the basis toggle
  - basis-aware three-state chart caption (cash / MTM+bundle / MTM-fallback); a11y gap summary counts the active basis
affects: [ship-time re-derive backfill (Zavara falls back to cash charts + honest caption until backfilled)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "useBasisSeriesView reads BasisContext directly (not useBasis) → degrades to cash WITHOUT a BasisProvider instead of throwing (additive enhancement; isolated chart mounts/tests stay green)"
    - "Every consuming component: const view = useBasisSeriesView(usePayload()) then swap payload.→view. — external fields (correlations/correlationMatrix/strategyMetrics) pass through as cash by construction, ZERO per-panel branching"
    - "Defensive axis clamp in TimeSeriesChart (xStart/xEnd clamped to view.dates.length-1) — the MTM axis is shorter than the frozen cash-index xRange; belt-and-suspenders with resetXRange-on-toggle (T-103-08)"
    - "resetXRange on basis change via the FROZEN context's own API (skip-on-mount ref) — factsheet-context.tsx byte-untouched"

key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/factsheet/[id]/v2/basis-context.test.tsx
    - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
    - src/app/factsheet/[id]/v2/DistributionPanels.tsx
    - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
    - src/app/factsheet/[id]/v2/StressWindowsPanel.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx

key-decisions:
  - "useBasisSeriesView reads the context via useContext(BasisContext) with a cash fallback rather than useBasis() (which throws). The view-merge is a pure additive enhancement; a chart/panel mounted without a BasisProvider must degrade to cash, not crash. This kept TimeSeriesChart.markers.test.tsx (renders under FactsheetProvider only) GREEN UNMODIFIED, satisfying the Task-1 <done> byte-parity requirement."
  - "Defensive axis clamp: the frozen xRange is maintained in cash-index space (context length = cash dates). Under a SHORTER MTM axis the persisted window end can exceed the MTM series bounds. Clamping xStart/xEnd to view.dates.length-1 makes the MTM series fill the plot AND prevents any geometry from indexing past view.dates. No-op under cash (byte-identical). This is the primary mechanism; resetXRange-on-toggle is the secondary (matters only when the user had zoomed)."
  - "Correlations / correlationMatrix routed through `view.` for uniformity, but because they are NOT in the bundle the merge passes them through as CASH under both bases with zero branching — NO basis eyebrow/label added (honesty by construction, per 103-03 hand-off)."
  - "BootstrapCIPanel: b = view.bootstrapCI follows MTM; the low-N warning stays on view.strategyMetrics.n (cash passthrough) since strategyMetrics is excluded from the bundle and the KpiStrip owns MTM scalars (Phase 102). Minor cash-coarse count under MTM — acceptable, no MTM n scalar exists."

requirements-completed: [MTM-04]

# Metrics
duration: ~75min
completed: 2026-07-12
---

# Phase 103 Plan 04: MTM daily series — charts + dailies-derivable panels follow the toggle Summary

**A single client-side hook (`useBasisSeriesView`) selects the active basis's series bundle, and every chart surface plus every dailies-derivable statistics panel (heatmaps, worst-10, quantiles, streaks, calmar-by-year, bootstrap CI, style drift, stress-windows strat columns) reads through it — so toggling mark-to-market now moves the WHOLE factsheet, with a basis-aware three-state caption, an active-basis a11y gap count, and zoom-reset-on-toggle, while external-data panels (correlations/correlationMatrix) and the frozen chart spine stay byte-untouched.**

## Task Commits
1. **Task 1** `4e1349bc` feat(103-04): useBasisSeriesView + TimeSeriesChart view-merge + zoom reset
2. **Task 2** `8bd093a1` feat(103-04): heatmaps + worst-10 + dailies-derivable panels + basis-aware caption follow the toggle
3. **Task 3** `673df687` test(103-04): keystone falsifiable per-basis series tests

## Caption three-state matrix (the stale cash-only copy is gone)
Gated on `mtmToggleAvailable = composite || payload.mtmGate != null` (single-key options included — NOT composite-only). Pre-mounted role=status region (F5 discipline: content change, never mount-on-toggle):

| basis | bundle | caption |
|-------|--------|---------|
| cash | any | `""` (empty, unchanged idiom) |
| mark_to_market | present | "Charts show the mark-to-market series." |
| mark_to_market | ABSENT | "Charts show the cash-settlement series. Mark-to-market applies to summary metrics only." (honest fallback — stale cache / not-yet-backfilled / gated) |

## Dailies-derivable-vs-external panel split (which follow MTM vs stay cash)
- **FOLLOW MTM (view.field):** all TimeSeriesCharts (equity/cumVsBench/volMatched/dailyReturns/rolling vol·sharpe·sortino·beta/worstDDs/underwater incl. axis+comparators+worst-10 bands+segment mask), MonthlyReturnsHeatmap, DailyReturnsHeatmap, QuantileBoxPlotPanel, StreakDistributionPanel, CalmarByYearPanel, BootstrapCIPanel (CI values), StyleDriftPanel, StressWindowsPanel (strat columns), MetricsColumn WorstDrawdownsTablePanel (worst-10 + dates — BOTH from view so indices map to the right axis), ExtendedMetricsPanel quantile rows (P5/P95/Median).
- **STAY CASH (external / KpiStrip-owned):** CorrelationStripPanel, CorrelationsMatrixPanel (external-data — no MTM equivalent; pass through the merge as cash, NO basis label). EndOfYearBarsPanel + all strategyMetrics-scalar KPM tables (Compound/Main/Returns/Risk/Extended-scalars/Benchmark α·β·IR) — strategyMetrics is excluded from the bundle; the KpiStrip owns MTM for headline scalars (Phase 102).
- **MIXED (stressWindows):** strat columns follow MTM; the benchmark column is basis-invariant by construction (same series aligned to the MTM axis — no new math).

## Single-key interior mask honesty (from 103-PROBE-OQ1)
The caption promises only what the compute produces. Single-key MTM interior gap markers are structurally EMPTY unless a DQ-01 guard genuinely fired on the book — the common clean-book case surfaces a **span-level** difference (a shorter MTM date window) rather than interior holes. Composites carry full interior + span marks by construction (inter-member gaps + member NaN days). No user-facing copy promises interior single-key marks the compute cannot produce.

## Neuter-confirmation (performed, BOTH directions)
Temporarily neutered `useBasisSeriesView` to `return payload` always, ran the keystone test → RED:
- **Charts-follow direction:** under MTM the cumulative chart's MTM-only gap seam ("5d — no data") vanished, Calmar showed cash year "2023" not the bundle sentinel "1999", and the quantile box showed cash "P5 -0.3%" not the sentinel "P5 -9.0%" → the keystone `toContain` assertions failed. Restored → green.
- **External-other-direction:** the sentinel cash correlation ("SENTINEL_BTC") stayed present under BOTH bases with and without the merge — the 1c assertion proves external-data panels do NOT follow the basis (a bundle wrongly carrying correlations would drop the sentinel → RED the other way).

## Verification
- `npx vitest run src/app/factsheet/[id]/v2` → **198 passed** (22 files), incl. the 13-test FactsheetBody.basis suite (9 prior + 4 new keystone) and the unmodified TimeSeriesChart.markers + FactsheetView.kpistrip + guard04 + scenario-mode + leverage suites.
- `basis-context.test.tsx` → 12 passed (5 new: identity / merge-passthrough / absent-bundle-fallback / memo-stability / toggle-restore).
- **Frozen-spine guard** (`phase-52-frozen-spine-guards.test.ts`) → **9 passed** — all 8 frozen islands zero-diff (factsheet-context.tsx, MasterBrush, HistogramChart, EquityChart, TouchTooltip, useTapPin, useBreakpoint, montecarlo.worker). TimeSeriesChart is the Phase-90 editable carve-out (not frozen).
- `npx tsc --noEmit` → clean. `npm run lint` → **0 errors**, 1 pre-existing WARNING in the frozen `EquityChart.tsx` (untouched — out of scope; my new effect/memo hooks produced no react-hooks warnings).
- Coverage (scoped v2 subset): `basis-context.tsx` 97.1/91.7/100/100 (stmts/branch/funcs/lines). Full-suite ratchet (82/80/74/72) is CI-enforced; the changes are additive wiring covered by the passing tests — ratchet holds.

## Deviations from Plan
- **[Rule 3 — Blocking] useBasisSeriesView reads the context directly, not via useBasis().** The plan said "keeps the GUARD-04 no-storage discipline (pure context + memo)". Implemented with `useContext(BasisContext)?.basis ?? "cash_settlement"` rather than `useBasis()` because `useBasis()` THROWS outside a BasisProvider, which crashed TimeSeriesChart.markers.test.tsx (renders under FactsheetProvider only). The graceful-cash degradation is the correct, robust design (the merge is additive) and it kept the existing marker tests GREEN UNMODIFIED, satisfying the Task-1 <done>. GUARD-04 still holds (no storage/URL/history; basis-context.test.tsx Test 7 green). Commit 4e1349bc.
- **[Rule 2 — Honesty] MetricsColumn rail is now MIXED-basis under MTM; the composite "BASIS · CASH SETTLEMENT" eyebrow now under-describes it.** Per the plan the rail's dailies-derivable panels (Calmar, Bootstrap, Worst-10 table, Style Drift, quantile rows) now follow MTM, while the strategyMetrics scalar tables stay cash. The Phase-90 blanket eyebrow (`MetricsColumnWithBasis`, composite-only) therefore no longer literally describes the whole column. I did NOT invent new product copy (the plan sanctioned only the chart caption as a new string; the eyebrow is DESIGN.md-governed). Instead I updated the stale code comment to state the mixed reality and LEFT the eyebrow string verbatim, flagged below for design/red-team. Single-key options (the milestone focus) shows NO eyebrow, so the honesty gap is composite-only.
- Otherwise executed as written (Rules 1/4 not triggered).

## Flagged for red team / ship-time
- **[DESIGN decision needed] Composite rail eyebrow.** `MetricsColumnWithBasis` still renders "BASIS · CASH SETTLEMENT" over the right rail under MTM, but the rail is now mixed (dailies-derivable panels follow MTM; strategyMetrics scalar tables stay cash). Composite-only (single-key options unaffected). A design call is required on whether to reword (e.g. scope it to the summary/headline scalar metrics) or drop it. Not shipped as a copy change to avoid an unsanctioned DESIGN.md deviation.
- **[Ship-time backfill gate — UNCHANGED from 103-02/03] Zavara + existing options strategies have NO `mtm_daily_returns` row until a post-deploy re-derive backfill runs.** `payload.seriesByBasis` is absent until then → 103-04 falls back to CASH charts + the honest "showing cash" caption (proven by the FALLBACK keystone test). The `${id}::${computedAt}` cache key invalidates naturally on re-derive. The live Zavara MTM-curve corroboration is the POST-DEPLOY gate after the backfill (deferred per CONTEXT).
- **Bootstrap low-N count under MTM** shows the cash observation count (`view.strategyMetrics.n`, a passthrough) while the CI VALUES follow MTM — no MTM n scalar exists (strategyMetrics excluded from the bundle). Cosmetic; the "< 252 obs" guard is coarse.
- **Threat surface:** no new endpoints/auth/schema. T-103-07 (UI honesty) mitigated by the three-state bundle-keyed caption + honest single-key-mask copy; T-103-08 (axis-swap out-of-range) mitigated by resetXRange-on-toggle + the defensive TimeSeriesChart clamp. No new threat flags.

## Self-Check: PASSED
- Files verified on disk: all 11 modified paths present (git show confirms the 3 task commits landed on `gsd/v1.10-portfolio-intelligence-options-mtm`).
- Commits verified in `git log`: 4e1349bc, 8bd093a1, 673df687 — all present.
- `.planning/` artifacts left local/gitignored — NOT staged (per task instructions + MEMORY). No STATE.md/ROADMAP.md mutation performed (deferred to the orchestrator — not requested by the launching agent and .planning is gitignored/local).

---
*Phase: 103-mtm-daily-series-charts-follow*
*Completed: 2026-07-12*
