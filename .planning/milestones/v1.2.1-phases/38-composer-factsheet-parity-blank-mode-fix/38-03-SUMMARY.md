---
phase: 38-composer-factsheet-parity-blank-mode-fix
plan: 03
subsystem: allocations/composer-charts
tags: [react, factsheet-parity, chart-engine-reuse, provider-mount, shared-window, composer, scope-boundary]

# Dependency graph
requires:
  - phase: 38-composer-factsheet-parity-blank-mode-fix (Plan 01)
    provides: "buildScenarioFactsheetPayload + SCENARIO_EQUITY_CONFIG + SCENARIO_DRAWDOWN_CONFIG"
  - phase: 38-composer-factsheet-parity-blank-mode-fix (Plan 02)
    provides: "FactsheetProvider persist?: boolean opt-out (default true)"
provides:
  - "ScenarioFactsheetChart — composer-side mount of the REAL factsheet TimeSeriesChart + MasterBrush under ONE FactsheetProvider(persist=false), fed the synth scenario payload (equity + drawdown stacked, sharing one xRange)"
  - "The composer call-site swap: ScenarioComposer renders <ScenarioFactsheetChart/> at both former chart sites"
  - "A stable scenario-line test hook: data-testid=\"equity-chart-scenario-overlay\" (carried for Plan 05 overlay assertions)"
affects: [38-04, 38-05, scenario-tab, composer-factsheet-mount]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Engine reuse via synth payload under one provider — the factsheet TimeSeriesChart/MasterBrush are imported verbatim, never reimplemented (factsheet stays the truth)."
    - "Q4 shared window = ONE provider ⇒ one XRangeContext for both panels (no parallel range lifted)."
    - "Q3 period control as a child INSIDE the provider that calls useXRange().setXRange — a fixed-period jump over the date axis, not sliceByPeriod."
    - "Scope-bounded swap: new composer-side component, NOT an in-place re-back of the dual-purpose EquityChart.tsx (Overview EquityChartWidget left on legacy render)."

key-files:
  created:
    - "src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx"
    - "src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"

key-decisions:
  - "Mount BOTH equity + drawdown under ONE FactsheetProvider — the single provider IS the entire Q4 shared-window mechanism; no separate range state is lifted."
  - "The SegmentedControl is a fixed-period JUMP (most-recent N trading days @ 252; ALL→resetXRange), not a stateful persisted period. It carries no active-highlight because the shared xRange — driven equally by the brush, wheel, keyboard, and these buttons — is the single source of truth for the window; a sticky button state could desync from a brush pan."
  - "stale/lastSyncAt no longer flow to the chart: the csv-arm synth payload carries computedAt:\"\" and ScenarioFactsheetChart renders NO header, so the legacy H-1226 'sync stamp lies in blank mode' failure mode is STRUCTURALLY impossible. The composer test was reframed to pin that the new chart receives NEITHER sync prop."
  - "Scope boundary is load-bearing: created a NEW composer-side component rather than re-backing EquityChart.tsx (which is ALSO the Overview EquityChartWidget). git diff confirms AllocationDashboardV2.tsx + EquityChart.tsx are untouched; the 328-line Overview header test passes unchanged."

requirements-completed: [PARITY-01]

# Metrics
duration: ~18min
completed: 2026-06-25
tasks: 2
files: 4
---

# Phase 38 Plan 03: ScenarioFactsheetChart — composer factsheet engine reuse Summary

**The composer's scenario equity + drawdown now render through the REAL factsheet `TimeSeriesChart` + `MasterBrush` engine, mounted under ONE `FactsheetProvider(persist=false)` fed `buildScenarioFactsheetPayload`'s synth payload — equity + drawdown share a single brush-zoom window (Q4), the scenario is the accent strategy line / benchmark the muted comparator via `resolveSeries` (Q2), and a 3M/6M/12M/ALL SegmentedControl drives the shared `xRange` (Q3). This is the core of PARITY-01: "the scenario should look exactly the same and use the same factsheet assets."**

## What was built

### Task 1 — `ScenarioFactsheetChart.tsx` + `scenario-shared-window.test.tsx` (commit `6a92ffe2`)
- A `"use client"` component taking the composer's existing chart props (`equityDailyPoints`, `scenarioSeries`, `benchmark`, `scenarioDailyPoints`). It calls `buildScenarioFactsheetPayload({ scenario, baseline, benchmark })` (memoized) and mounts EXACTLY the FactsheetView template:
  - ONE `<FactsheetProvider payload={synthPayload} persist={false}>`
  - `<MasterBrush />` (draws the scenario equity sparkline + the draggable window)
  - `<TimeSeriesChart config={SCENARIO_EQUITY_CONFIG} />` (scenario + benchmark)
  - `<TimeSeriesChart config={SCENARIO_DRAWDOWN_CONFIG} />` (underwater fill)
  - The two panels under one provider = **Q4 shared window** (one `XRangeContext`; no parallel range).
- A `PeriodControl` child rendered INSIDE the provider (so it can call `useXRange().setXRange`). A 3M/6M/12M click → `setXRange([endIdx-N, endIdx])` over the scenario date axis (N = 63/126/252 trading days); "ALL" → `resetXRange()`. The provider's `setXRange` clamps to `MIN_VISIBLE_SAMPLES`, so a short series degrades safely. **Q3** satisfied without `sliceByPeriod`.
- **Q2 color**: no inline strokes — the scenario→accent / benchmark→muted contract flows entirely through `resolveSeries` via the two Plan-01 `ChartConfig` constants.
- **Stable test hook**: the scenario strategy-line panel is wrapped in `data-testid="equity-chart-scenario-overlay"` (the SAME id the legacy `EquityChart.scenario.test.tsx` queries) so Plan 05 can retarget overlay-presence assertions to the new path.
- `scenario-shared-window.test.tsx` (3 cases): (1) the real assets mount — `MasterBrush` affordance + TWO `svg[role="img"][tabindex="0"]` panels + the scenario-overlay testid; (2) a window change driven on the equity chart's keyboard nav re-renders the brush window labels (proving one shared `XRangeContext` reaches every panel + the brush), with both panels still co-mounted; (3) the SegmentedControl narrows the shared window on "3M" and restores it on "ALL".

### Task 2 — composer call-site swap (commit `e25b03ed`)
- `ScenarioComposer.tsx`: the two former chart renders (`<EquityChart/>` :2228 equity, `<DrawdownChart/>` :2259 drawdown) collapse into ONE `<ScenarioFactsheetChart/>` receiving the same data props. The grid changed from a 2-column (equity | drawdown) layout to a single-column stack, because the factsheet engine stacks both panels vertically under one provider (the shared-window mechanism).
- The PROJECTED honesty pill (:1865, unconditional, blank mode included) and the "BTC Benchmark" toggle survive as composer-owned chrome around the new component — NOT pushed into the factsheet engine.
- Dropped the now-dead `EquityChart`/`DrawdownChart` imports (kept `toWealth` — still builds `scenarioWealthSeries` at :1567) and the orphaned `lastSyncAt` payload destructure.
- Retargeted the composer suite's chart-presence/prop assertions from the legacy `EquityChart`/`DrawdownChart` mocks to a `ScenarioFactsheetChart` mock (the mock keeps the equity + drawdown sub-testids so present-panel asserts still read the mount). Coverage retained, not deleted.

## Scenario-line test hook (for Plan 05)

`data-testid="equity-chart-scenario-overlay"` — carried verbatim on the scenario strategy-line panel wrapper inside `ScenarioFactsheetChart`. Plan 05's blank-slate overlay-presence assertions can query this id on the new path exactly as `EquityChart.scenario.test.tsx` did on the legacy path.

## Verification

- `npx vitest run ".../scenario-shared-window.test.tsx"` → **3 passed** (MasterBrush + two charts under one provider; a chart-driven window change moves the shared brush window; the SegmentedControl narrows/resets the shared range).
- `npx vitest run ".../widgets/performance/"` → **119 passed** (all perf-dir suites, incl. the legacy DrawdownChart/EquityChart scenario tests still green — those files are untouched).
- `npx vitest run "src/app/factsheet/"` → **43 passed** (reuse, not fork — no factsheet file changed in this plan).
- `npx vitest run ".../ScenarioComposer.test.tsx" ".../ScenarioComposer.save.test.tsx" ".../EquityChartWidget.header.test.tsx"` → **105 passed** (composer + save + the 328-line Overview header test green — scope boundary held).
- `npx tsc --noEmit` → **clean** (exit 0).
- `npx eslint` on the 4 touched files → **clean** (0 warnings, 0 errors).
- Scope-boundary grep: `git diff --name-only` does NOT include `AllocationDashboardV2.tsx` or `widgets/performance/EquityChart.tsx`. `grep "PROJECTED\|hypothetical"` confirms the honesty pill survives unconditionally. `grep -c "<FactsheetProvider"` in `ScenarioFactsheetChart.tsx` = 1 (one JSX mount). Inline `stroke=`/`color:` (comments excluded) = 0.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking lint] Removed the orphaned `lastSyncAt` payload destructure**
- **Found during:** Task 2 (eslint after the swap).
- **Issue:** The swap removed the only consumer of `lastSyncAt` (the legacy `<EquityChart lastSyncAt=.../>`), leaving the destructured binding unused → `@typescript-eslint/no-unused-vars` warning.
- **Fix:** Dropped the `lastSyncAt` line from the `payload` destructure (kept `allKeysStale`, still used at :2186). Surgical — no behavior change.
- **Files modified:** `ScenarioComposer.tsx`
- **Commit:** `e25b03ed`

### Acceptance-criterion note (no code impact)

- The Task-1 acceptance check `grep -c "FactsheetProvider" .../ScenarioFactsheetChart.tsx == 1` reads literally as 4 because the term appears in the import, JSDoc comments, AND the JSX mount. The substantive intent — "exactly ONE provider (Q4; not a parallel range)" — is satisfied and was verified with the precise check `grep -c "<FactsheetProvider" == 1` (one JSX mount, one `XRangeContext`). No second provider exists.

### Reframed test (coverage retained, not deleted)

- The legacy B14/H-1226 test ("EquityChart receives stale + lastSyncAt so the Scenario-tab sync stamp is honest") guarded against a sync-stamp LIE that could only occur because the legacy `EquityChart` rendered an inner header. `ScenarioFactsheetChart` renders NO header (the csv-arm synth payload has `computedAt:""`), so that failure mode is structurally gone. The test was reframed to pin the new honest contract: the scenario chart receives NEITHER `stale` nor `lastSyncAt` — a future refactor cannot reintroduce a stamp surface to lie.

## Threat surface

No new security-relevant surface. Per the plan's threat register: `persist={false}` (T-38-03-01, mitigate) is asserted present; the synth payload is built client-side from data already in the composer (no fetch/send); no package installs (T-38-03-SC). The ExportMenu's `factsheet_v2_chart_export` PostHog event now fires from the composer (T-38-03-03, accept) — a benign analytics-hygiene note, no data leak.

## Known Stubs

None. The component is fully wired to live composer data (`scenarioWealthSeries`, `baselineEquityDailyPoints`, `btcWealth`, `scenarioDailyPointsForDrawdown`) through the Plan-01 adapter; no placeholder/empty-data paths were introduced.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx`
- FOUND: `src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx`
- FOUND commit: `6a92ffe2`
- FOUND commit: `e25b03ed`

---
*Phase: 38-composer-factsheet-parity-blank-mode-fix*
*Completed: 2026-06-25*
