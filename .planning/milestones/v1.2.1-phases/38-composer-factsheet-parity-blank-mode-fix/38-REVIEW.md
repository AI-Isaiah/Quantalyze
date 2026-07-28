---
phase: 38-composer-factsheet-parity-blank-mode-fix
reviewed: 2026-06-25T00:00:00Z
depth: deep
files_reviewed: 11
files_reviewed_list:
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/factsheet/[id]/v2/factsheet-context.tsx
  - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/AllocationsTabs.tsx
  - src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts
  - src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/EquityChart.scenario.test.tsx
  - src/app/(dashboard)/allocations/widgets/performance/composer-width.test.tsx
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 38: Code Review Report

**Reviewed:** 2026-06-25
**Depth:** deep
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Phase 38 re-backs the composer's scenario equity+drawdown charts with the real factsheet `TimeSeriesChart` + `MasterBrush` engine via a new `ScenarioFactsheetChart` component and a pure `buildScenarioFactsheetPayload` adapter. The implementation is structurally sound: the `persist={false}` gate is correctly wired to suppress both URL `history.replaceState` and `localStorage setStoredView`; `factsheet-context.tsx` is additively changed (default `persist=true`, existing factsheet page unchanged); and the `EquityChart.tsx` guard is the surgical one-boolean fix mirroring `DrawdownChart.tsx:147`.

All six guardrails pass:

- **factsheet-context.tsx additive-only**: confirmed via `git show 68bf5e0c` — 4 functional lines added, default `true`, factsheet page behavior byte-identical.
- **persist={false} gates BOTH side-effects**: `history.replaceState` and `setStoredView` are both skipped at line 311 when `!persist`.
- **EquityChart.tsx scope boundary**: only the `&& !hasScenario` guard changed; Overview passes `hasScenario=false` → behavior unchanged.
- **No inline strokes in Phase 38 chart code**: `ScenarioFactsheetChart.tsx` and `scenario-factsheet-payload.ts` carry no `stroke=` or `color:` inline; the `SCENARIO_EQUITY_CONFIG` / `SCENARIO_DRAWDOWN_CONFIG` constants flow through `resolveSeries`.
- **Honesty / blank-slate contract**: empty baseline with present scenario emits a non-empty `strategyEquity` from the adapter (degenerate gated on `scenario.length`); PROJECTED pill renders unconditionally at `ScenarioComposer.tsx:1877`.
- **scenario.ts engine untouched**: no edits in any Phase 38 commit.

One WARNING and two INFO findings are recorded below.

---

## Warnings

### WR-01: `void scenarioDailyPoints` — dead prop with no caller-visible contract

**File:** `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx:144`

**Issue:** The `scenarioDailyPoints` prop (typed `DailyReturn[] | null`) is accepted by the component signature and immediately discarded via `void scenarioDailyPoints` to suppress the `no-unused-vars` lint error. The drawdown series is re-derived inside `buildScenarioFactsheetPayload` from `scenarioSeries` (the wealth-normalized form), making `scenarioDailyPoints` genuinely inert at runtime.

The mathematical result is correct — peak-anchored fractional drawdown is invariant under uniform scaling, so wealth-normalized and USD-scaled series produce identical percentage drawdowns. But the interface is misleading: a caller reading the prop signature cannot know the prop has zero effect on output. The USD-scaled `scenarioDailyPointsForDrawdown` built inside `ScenarioComposer.tsx` (lines 2218–2224) is computed, passed, and silently dropped.

There are two concrete failure modes:
1. A future maintainer changes `scenarioDailyPoints` expecting to observe a drawdown change, spends debugging time tracing why nothing moves.
2. If a future call site uses a non-uniform scaling (e.g., an AUM-denominated time series with varying notional), the invariant silently breaks and the drawdown diverges from the caller's expectation.

**Fix:** Either remove the prop entirely and update the three call sites to not pass it, or replace the `void` pattern with an explicit comment at the prop definition that marks it as unused and explains why. The cleaner option is removal:

```tsx
// ScenarioFactsheetChart.tsx — remove scenarioDailyPoints from props
interface ScenarioFactsheetChartProps {
  equityDailyPoints: DailyReturn[];
  scenarioSeries: WealthPoint[] | null;
  benchmark?: BenchmarkSeries | null;
  // scenarioDailyPoints removed — drawdowns are re-derived from scenarioSeries inside
  // buildScenarioFactsheetPayload; the two are peak-equivalent (scale-invariant)
}

// ScenarioComposer.tsx — call site, drop the prop
<ScenarioFactsheetChart
  equityDailyPoints={baselineEquityDailyPoints}
  scenarioSeries={scenarioWealthSeries}
  benchmark={btcWealth}
/>
```

If call-site symmetry with the legacy `EquityChart` API is intentional (so both can be swapped under a shared interface), document the contract explicitly in a JSDoc `@deprecated` or `@unused` tag on the prop so the intent survives the next reader.

---

## Info

### IN-01: Loading skeleton comment stale after chart consolidation

**File:** `src/app/(dashboard)/allocations/AllocationsTabs.tsx:127`

**Issue:** The loading skeleton block still carries a comment `{/* 2 charts × ~280px */}` (or similar) referring to the prior side-by-side equity + drawdown layout. After Plan 03 the loaded content is a single stacked `ScenarioFactsheetChart` that renders both panels vertically under one provider. The skeleton structure itself (`grid-cols-1 gap-4 lg:grid-cols-2` with two placeholder cells) is pre-existing and not a Phase 38 regression, but the mismatch between skeleton layout (2-column) and loaded content (1 stacked component) is now more visible.

**Fix:** Remove or update the stale comment. Cleaning up the skeleton's 2-column structure to match the single-component layout is out of scope for Phase 38 but worth noting for a polish pass.

---

### IN-02: Benchmark swatch uses raw hex literal instead of CSS token (pre-existing, moved by Phase 38)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2253`

**Issue:** The BTC Benchmark toggle swatch uses `style={{ backgroundColor: "#94A3B8" }}` — the raw hex — rather than `var(--color-chart-benchmark)` which is defined in `globals.css:69` and used throughout `EquityChart.tsx` and `DrawdownChart.tsx`. The swatch block was not introduced by Phase 38 (confirmed: it existed pre-`e3b44155` and was relocated by `e25b03ed`), but Phase 38 is the natural opportunity to correct it since the block was touched.

**Fix:**
```tsx
// replace
style={{ backgroundColor: "#94A3B8" }}
// with
style={{ backgroundColor: "var(--color-chart-benchmark)" }}
```

---

_Reviewed: 2026-06-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
