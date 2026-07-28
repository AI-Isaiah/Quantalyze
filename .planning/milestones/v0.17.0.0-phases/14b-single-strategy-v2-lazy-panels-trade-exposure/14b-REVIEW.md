---
phase: 14b
status: issues_found
critical_count: 1
medium_count: 3
low_count: 3
date: 2026-04-29
depth: standard
files_reviewed: 28
files_reviewed_list:
  - src/hooks/useLazyPanelMetrics.ts
  - src/lib/queries-client.ts
  - src/components/charts/DailyHeatmap.tsx
  - src/components/strategy-v2/ReturnsDistributionPanel.tsx
  - src/components/strategy-v2/RollingMetricsPanel.tsx
  - src/components/charts/RollingVolatilityChart.tsx
  - src/components/charts/RollingSortinoChart.tsx
  - src/components/charts/RollingAlphaBetaChart.tsx
  - src/components/strategy-v2/MetricCell.tsx
  - src/components/strategy-v2/TradeAndPositionPanel.tsx
  - src/components/strategy-v2/TradeMixSubPanel.tsx
  - src/components/strategy-v2/ExposureAndGreeksPanel.tsx
  - src/components/charts/NetGrossExposureChart.tsx
  - src/components/charts/TurnoverChart.tsx
  - src/components/strategy-v2/BenchmarkGreeksTable.tsx
  - src/lib/queries.ts
  - src/components/strategy-v2/StrategyV2Shell.tsx
  - src/components/strategy-v2/HeadlineMetricsPanel.tsx
  - src/lib/strategy-ui-v2-flag.ts
  - src/app/strategy/[id]/v2/page.tsx
  - src/app/globals.css
  - e2e/strategy-v2-axe.spec.ts
  - e2e/discovery-axe.spec.ts
  - e2e/strategy-v2-keyboard.spec.ts
  - e2e/strategy-v2-chart-parity.spec.ts
  - e2e/strategy-v2-partial-data.spec.ts
  - e2e/helpers/axe.ts
  - src/lib/types.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
---

# Phase 14b: Code Review Report

**Reviewed:** 2026-04-29T00:00:00Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Phase 14b lands 7 new panel bodies (Panels 4–7), lazy-fetch infrastructure, axe-core CI, keyboard nav, chart-parity snapshots, and the `strategy.ui_v2` flag flip to default ON. The Grok B-01 through B-05 blockers are all addressed and their mitigations are correct. The flag-flip SSR pattern (B-05) correctly returns `false` on the server and upgrades in `useEffect`. The Grok W-01 memo/useMemo mitigation lands in `ReturnsDistributionPanel` and `DailyHeatmap`. The Grok W-02 scroll-before-assert fix lands in both axe specs and the keyboard spec. IntersectionObserver cleanup (I-01) is present.

One critical geometry bug was found in the SVG renderer of `DailyHeatmap`: the viewBox width is capped at 12 columns (monthly layout intent) but the component receives raw daily data points, so the vast majority of cells for any real strategy are rendered outside the viewBox and clipped invisible. Three medium-severity issues are also identified: Canvas height overflow for strategies older than 5 years, an unsafe `as never` type cast, and a misleading partial-data banner copy. Three low-severity identity and code quality items complete the set.

## Summary Table

| ID | File | Line(s) | Severity | Category | Issue |
|----|------|---------|----------|----------|-------|
| CR-01 | DailyHeatmap.tsx | 113–191 | Critical | Bug / Geometry | SVG branch viewBox width is 12-column monthly layout; receives raw daily data → most cells invisible |
| WR-01 | DailyHeatmap.tsx | 195–197 | Warning | Bug / Geometry | Canvas height hardcoded to 5-year budget; year 6+ is silently clipped |
| WR-02 | ExposureAndGreeksPanel.tsx | 135 | Warning | Type Safety | `as never` cast on `CorrelationWithBenchmark` analytics prop bypasses all type checking |
| WR-03 | RollingMetricsPanel.tsx | 94–98, 162–165 | Warning | UX / Logic | sharpeGated banner shows misleading "need ≥N days" when threshold is met but key is absent |
| IN-01 | TradeMixSubPanel.tsx | 72–78 | Info | Identity | Hardcoded hex `#1B6B5A` / `#94A3B8` instead of `CHART_ACCENT` / `CHART_TEXT_MUTED` from chart-tokens |
| IN-02 | DailyHeatmap.tsx | 57–65 | Info | Identity | `cellFill()` hardcodes `#16A34A`, `#DC2626`, `#FFFFFF` rather than referencing chart-tokens |
| IN-03 | src/components/charts/RiskOfRuin.tsx, MonthlyReturnsBar.tsx | — | Info | Identity | DESIGN-01 audit (Phase 14b scope) left `#0D9488` (RiskOfRuin) and `#059669` (MonthlyReturnsBar) unfixed |

---

## Critical Issues

### CR-01: DailyHeatmap SVG branch renders raw daily data in a 12-column monthly viewBox

**File:** `src/components/charts/DailyHeatmap.tsx:113–191`

**Issue:** The SVG renderer was designed for pre-aggregated monthly data: `cols = Math.min(12, Math.max(1, cellCount))` caps the column count at 12, and the viewBox width is `SVG_LEFT_GUTTER + cols * SVG_CELL_W = 56 + 12 × 24 = 344px`. However, `ReturnsDistributionPanel` passes the raw `daily_returns_grid` payload directly — individual trading days, not monthly aggregates. For a 1-year strategy with 252 trading days in a single year, `colIdx` iterates 0..251 and cell x-positions reach `56 + 251 × 24 = 6,080px` — well beyond the 344px viewBox. SVG clips overflow by default, making 240 of 252 cells invisible. The heatmap appears to show data for only the first ~2 weeks of each year. The chart-parity golden for a 252-day fixture will capture this broken baseline.

**The comment at line 113 acknowledges the intent** ("show day-1-of-month as a representative — the SVG branch is small enough that we render one rect per data point and let the consumer pre-aggregate") but `ReturnsDistributionPanel` never pre-aggregates; it passes the raw payload unconditionally.

**Fix — Option A (recommended): Change `cols` to use actual per-year max column count**

Replace the `cols`/`width` calculation with the actual day-of-year range using the existing `dayOfYear()` utility, so the viewBox spans all 365 columns with 2px cells (same as the Canvas branch):

```tsx
// In SvgRenderer — match Canvas branch: 365 day-of-year columns, 2px cells
const SVG_DOY_CELL_W = 2; // 365 * 2 = 730px — mirrors Canvas branch
const width = SVG_LEFT_GUTTER + 365 * SVG_DOY_CELL_W;
const height = SVG_TOP_GUTTER + rows.length * SVG_CELL_H + 8;

// In the cell render, replace colIdx-based x with dayOfYear-based x:
const x = SVG_LEFT_GUTTER + dayOfYear(d.date) * SVG_DOY_CELL_W;
// y remains: SVG_TOP_GUTTER + rowIdx * SVG_CELL_H
```

**Fix — Option B: Pre-aggregate in ReturnsDistributionPanel before passing to DailyHeatmap**

Reduce `daily_returns_grid` to one representative point per month (e.g. first trading day) before passing to `<DailyHeatmap>` when data.length ≤ SVG_THRESHOLD_CELLS. This preserves the 12-column layout intent at the cost of information loss.

---

## Warnings

### WR-01: Canvas height capped at 400px — strategies older than 5 years silently lose years

**File:** `src/components/charts/DailyHeatmap.tsx:195–197`

```ts
const CELL_H = 80;
const CANVAS_HEIGHT = 400; // = 5 * 80
```

**Issue:** `CANVAS_HEIGHT` is hardcoded to 400px (5 years × 80px per year). For strategies with 6 or more years of data, `yearIdx` 5+ yields `y = 5 × 80 = 400px` — at the canvas boundary. Those rows are painted at y=400..480, which is outside the 400px canvas buffer and silently clipped. The `<canvas height={400}>` element does not grow; the clipped rows are not scrollable. Any strategy live since before 2021 (5+ years of daily data) will have its oldest year(s) invisible with no indication to the user.

**Fix:** Compute canvas height dynamically from the actual number of distinct years in the data:

```tsx
// Replace static constants with dynamic sizing
const yearCount = rowsByYear.length;
const canvasHeight = Math.max(400, yearCount * CELL_H);

// In JSX:
<canvas
  ref={canvasRef}
  width={CANVAS_WIDTH}
  height={canvasHeight}   // dynamic
  ...
/>
```

The outer `<div style={{ minHeight: 360 }}>` should also update to `Math.max(360, yearCount * CELL_H)`.

---

### WR-02: `as never` cast on CorrelationWithBenchmark bypasses all TypeScript safety

**File:** `src/components/strategy-v2/ExposureAndGreeksPanel.tsx:135`

```tsx
<CorrelationWithBenchmark
  analytics={correlation_analytics as never}
/>
```

**Issue:** `CorrelationWithBenchmark` declares `analytics: StrategyAnalytics` (the full interface from `types.ts`), but `ExposureAndGreeksPanel` passes a narrow `CorrelationAnalyticsSubset` (`{ returns_series, metrics_json }`) cast to `never`. Using `as never` completely disables TypeScript's type checking for this prop. If `CorrelationWithBenchmark` ever adds a required field to `StrategyAnalytics` that is absent from the subset, the type error is silently hidden at compile time and only surfaces at runtime. The runtime behavior is currently correct because `resolveBenchmarkCorrelation` only reads `returns_series` and `metrics_json` (confirmed at `CorrelationWithBenchmark.tsx:61, 67–68`), but the suppression creates a permanent maintenance trap.

**Fix:** Narrow the `CorrelationWithBenchmark` props interface to match what it actually consumes, then remove the cast:

```tsx
// In CorrelationWithBenchmark.tsx
interface CorrelationWithBenchmarkProps {
  analytics: Pick<StrategyAnalytics, "returns_series" | "metrics_json">;
}
// Then in ExposureAndGreeksPanel.tsx — cast removed entirely:
<CorrelationWithBenchmark analytics={correlation_analytics} />
```

This is a one-line change in `CorrelationWithBenchmark` plus cast removal, and the narrow type is already precisely documented in `resolveBenchmarkCorrelation`'s signature at line 58.

---

### WR-03: sharpeGated banner shows misleading "need ≥N days" when data key is simply absent

**File:** `src/components/strategy-v2/RollingMetricsPanel.tsx:94–98, 162–165`

```ts
const sharpeGated = windowGated || Object.keys(sharpeForWindow).length === 0;
// ...
<SubChartSection gated={sharpeGated} gatedBody={subBannerBody}>
```

where `subBannerBody = "Awaiting more data — need ≥${windowDays} days for ${activeWindow} rolling window."`.

**Issue:** `sharpeGated` is true when either (a) the strategy doesn't yet have enough history (`windowGated=true`), OR (b) the strategy HAS enough history but none of the three known Sharpe keys (`sharpe_30d`, `sharpe_90d`, `sharpe_365d`) is present in `rolling_metrics`. In case (b), the banner displays "Awaiting more data — need ≥90 days for 3M rolling window" even for a strategy with 500+ days of history where rolling Sharpe was simply not computed (e.g. analytics recompute in progress, or a legacy row). The user sees a history-shortage message that is factually wrong.

**Fix:** Distinguish the two gate reasons:

```tsx
const windowGated = props.history_days < windowDays;
const sharpeKeyAbsent = Object.keys(sharpeForWindow).length === 0;
const sharpeGated = windowGated || sharpeKeyAbsent;

const sharpeGatedBody = windowGated
  ? subBannerBody
  : "Rolling Sharpe series not yet computed for this strategy. Check back after the next analytics run.";

// Pass sharpeGatedBody (not subBannerBody) to the sharpe SubChartSection:
<SubChartSection gated={sharpeGated} gatedBody={sharpeGatedBody}>
```

---

## Info

### IN-01: TradeMixSubPanel hardcodes bar fill colors instead of importing chart-tokens

**File:** `src/components/strategy-v2/TradeMixSubPanel.tsx:72–78`

```tsx
<BucketBar label="Long entries" count={longCount} total={total} fillColor="#1B6B5A" />
<BucketBar label="Short entries" count={shortCount} total={total} fillColor="#94A3B8" />
```

**Issue:** The values `#1B6B5A` and `#94A3B8` are correct (they match `CHART_ACCENT` and `CHART_TEXT_MUTED` from `chart-tokens.ts`) but are inlined as string literals rather than imported from the single source of truth. If the design system accent changes, chart-tokens is updated but TradeMixSubPanel is missed.

**Fix:**
```tsx
import { CHART_ACCENT, CHART_TEXT_MUTED } from "@/components/charts/chart-tokens";
// ...
<BucketBar label="Long entries" count={longCount} total={total} fillColor={CHART_ACCENT} />
<BucketBar label="Short entries" count={shortCount} total={total} fillColor={CHART_TEXT_MUTED} />
```

---

### IN-02: DailyHeatmap cellFill() hardcodes positive/negative hex instead of chart-tokens

**File:** `src/components/charts/DailyHeatmap.tsx:57–65`

```ts
if (v >= 0.1) return { fill: "#16A34A", opacity: 1 };
// ... 8 more branches using "#16A34A" and "#DC2626" ...
if (v === 0)  return { fill: "#FFFFFF", opacity: 1 };
```

**Issue:** `#16A34A` matches `--color-positive` and `#DC2626` matches `--color-negative` in `globals.css`, but `chart-tokens.ts` does not export these (it only exports `CHART_ACCENT = #1B6B5A`). The values are correct for now but bypass the design system's single source of truth. `MonthlyHeatmap.tsx` has the same pattern. A future design refresh that changes the positive/negative palette would need to update multiple files.

**Fix:** Export the positive/negative tokens from `chart-tokens.ts` and import them:

```ts
// In chart-tokens.ts — add:
export const CHART_POSITIVE = "#16A34A";   // = --color-positive
export const CHART_NEGATIVE = "#DC2626";   // = --color-negative
export const CHART_NEUTRAL  = "#FFFFFF";   // neutral/zero cell

// In DailyHeatmap.tsx cellFill():
import { CHART_POSITIVE, CHART_NEGATIVE, CHART_NEUTRAL } from "./chart-tokens";
if (v >= 0.1) return { fill: CHART_POSITIVE, opacity: 1 };
// ... etc.
```

---

### IN-03: DESIGN-01 audit incomplete — RiskOfRuin.tsx and MonthlyReturnsBar.tsx still use off-brand hex

**Files:** `src/components/charts/RiskOfRuin.tsx:28, 29, 56` | `src/components/charts/MonthlyReturnsBar.tsx:39`

**Issue:** Phase 14b scope explicitly lists "DESIGN-01 audits on existing chart components (#0D9488/#059669/bg-emerald-* fixes)". `MonthlyHeatmap.tsx` was fixed (confirmed). However:

- `RiskOfRuin.tsx` still uses `#0D9488` (wrong teal — the pre-v2 brand accent, not `CHART_ACCENT = #1B6B5A`) on lines 28, 29, 56.
- `MonthlyReturnsBar.tsx` still uses `#059669` (wrong emerald green) on line 39 for positive cell fill.

Both files are rendered in the strategy detail page. The off-brand strokes are visible whenever these charts appear.

**Fix (RiskOfRuin.tsx):** Replace `#0D9488` → `CHART_ACCENT` from chart-tokens.

**Fix (MonthlyReturnsBar.tsx):** Replace `#059669` → `CHART_POSITIVE` (once added per IN-02) or `#16A34A` directly, consistent with `MonthlyHeatmap.tsx` which already uses `#16A34A`.

---

## Grok Finding Verification

| Grok ID | Status | Notes |
|---------|--------|-------|
| B-01 (sharpe_180d missing) | Resolved | `SHARPE_KEY_BY_WINDOW` in `RollingMetricsPanel.tsx` maps 6M→sharpe_90d with documented fallback chain. Logic is correct. |
| B-02 (Canvas geometry) | Resolved | Canvas now uses `CELL_W=2`, `CANVAS_WIDTH=730 (= 365×2)`. Max x = `364×2 = 728px` fits within 730px. Grok fix landed correctly. |
| B-03 (equity panelId) | Resolved | `HeadlineMetricsPanel` calls `fetchStrategyLazyMetricsClient(strategyId, "equity")` directly, bypassing `PANEL_TO_ID`. `"equity"` is in `LazyMetricsPanelId` union in `queries-client.ts`. Comment at `queries.ts:535` confirms migration 087 CASE maps equity → log_returns_series. |
| B-04 (panel6 lazy error) | Resolved | `TradeAndPositionPanel` uses `fetchOnIntersect: false`; hook emits `ready` on intersection without a network call. Eager data is always used. |
| B-05 (SSR hydration) | Resolved | `isStrategyUiV2Enabled()` returns `false` when `typeof window === "undefined"`. Page comment documents the two-pass `useState(false)` + `useEffect` consumer pattern. |
| W-01 (render explosions) | Resolved | `DailyHeatmap` is `memo()`-wrapped; `dailyReturnsData` is stabilized with `useMemo` in `ReturnsDistributionPanel`. Both `SvgRenderer` and `CanvasRenderer` are individually `memo()`-wrapped. |
| W-02 (axe env guard / scroll) | Resolved | `discovery-axe.spec.ts` skips when `SLUG` is empty. `strategy-v2-keyboard.spec.ts` scrolls each panel section into view before asserting focus order. |
| I-01 (observer cleanup) | Resolved | `useLazyPanelMetrics` has a dedicated `useEffect` that runs only on mount and returns `() => { observerRef.current?.disconnect(); observerRef.current = null; }`. |

---

_Reviewed: 2026-04-29T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
