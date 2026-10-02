---
phase: 14b
fixed_at: 2026-04-29T14:51:49Z
review_path: .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-REVIEW.md
iteration: 1
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 14b: Code Review Fix Report

**Fixed at:** 2026-04-29T14:51:49Z
**Source review:** `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 7
- Fixed: 7
- Skipped: 0

---

## Fixed Issues

### IN-02: Add CHART_POSITIVE / CHART_NEGATIVE / CHART_NEUTRAL to chart-tokens.ts

**Files modified:** `src/components/charts/chart-tokens.ts`
**Commit:** `7662e40`
**Applied fix:** Added three new exports after `CHART_REFERENCE_DASH`:
- `CHART_POSITIVE = "#16A34A"` mirroring `--color-positive` in globals.css
- `CHART_NEGATIVE = "#DC2626"` mirroring `--color-negative`
- `CHART_NEUTRAL = "#FFFFFF"` for zero/neutral cells

Applied first (before CR-01) because DailyHeatmap and MonthlyReturnsBar both depend on these tokens.

---

### CR-01: DailyHeatmap SVG branch renders raw daily data in a 12-column monthly viewBox

**Files modified:** `src/components/charts/DailyHeatmap.tsx`
**Commit:** `a6e0af4` (also covers WR-01 and IN-02 consumption in the same file)
**Applied fix (Option A):** Replaced the `cols = Math.min(12, cellCount)` monthly layout with a year-row × day-of-year column layout matching the Canvas branch:
- Introduced `SVG_DOY_CELL_W = 2` (2px cells, 365 columns, same as Canvas)
- `width = SVG_LEFT_GUTTER + 365 * SVG_DOY_CELL_W = 786px`; `height` computed from `rows.length`
- Cell x-position uses `dayOfYear(d.date) * SVG_DOY_CELL_W` instead of `colIdx * SVG_CELL_W`
- Month labels repositioned to `MONTH_DOY_START[]` offsets (mirrors `MONTH_OFFSETS[]`)
- Dropped the unused `cellCount` / `cols` variables; `colIdx` loop variable removed

Overflow-protection: last day-of-year is 364 (clamped in `dayOfYear()`), giving max x = `56 + 364 * 2 = 784px` which fits within the `786px` viewBox.

---

### WR-01: Canvas height capped at 400px — strategies older than 5 years silently lose years

**Files modified:** `src/components/charts/DailyHeatmap.tsx`
**Commit:** `a6e0af4` (same file as CR-01)
**Applied fix:** Removed the `CANVAS_HEIGHT = 400` constant. Introduced:
```tsx
const canvasHeight = Math.max(CELL_H, rowsByYear.length * CELL_H);
```
The `<canvas height={canvasHeight}>` attribute and the wrapper `<div style={{ minHeight: Math.max(360, rowsByYear.length * CELL_H) }}>` now scale with the actual number of distinct years in the data.

---

### WR-02: `as never` cast on CorrelationWithBenchmark bypasses all TypeScript safety

**Files modified:** `src/components/charts/CorrelationWithBenchmark.tsx`, `src/components/strategy-v2/ExposureAndGreeksPanel.tsx`
**Commit:** `bc41bca`
**Applied fix:** Changed `CorrelationWithBenchmarkProps.analytics` from `StrategyAnalytics` to `Pick<StrategyAnalytics, "returns_series" | "metrics_json">`. This matches `resolveBenchmarkCorrelation`'s own parameter type at line 58. Removed `as never` cast from `ExposureAndGreeksPanel.tsx:135` — `correlation_analytics: CorrelationAnalyticsSubset` now satisfies the narrowed prop type without a cast. TypeScript confirms zero errors.

---

### WR-03: sharpeGated banner shows misleading "need ≥N days" when data key is simply absent

**Files modified:** `src/components/strategy-v2/RollingMetricsPanel.tsx`, `src/components/strategy-v2/RollingMetricsPanel.test.tsx`
**Commits:** `2db2a07` (source fix), `50e3ffd` (test update)
**Applied fix:** Introduced `sharpeKeyAbsent` to separate the two gate reasons:
```tsx
const sharpeKeyAbsent = Object.keys(sharpeForWindow).length === 0;
const sharpeGated = windowGated || sharpeKeyAbsent;
const sharpeGatedBody = windowGated
  ? subBannerBody                          // "Awaiting more data — need ≥N days…"
  : "Rolling Sharpe series not yet computed for this strategy. Check back after the next analytics run.";
```
`SubChartSection` for Rolling Sharpe now receives `sharpeGatedBody` instead of `subBannerBody`. Test 7 updated to assert the new correct copy and explicitly assert the old wrong copy is absent for a `history_days=365` strategy.

**Note:** Requires human verification of the logic branching — both branches of `sharpeGatedBody` exercise different copy paths based on `windowGated`. The logic matches the fix spec exactly.

---

### IN-01: TradeMixSubPanel hardcodes bar fill colors instead of importing chart-tokens

**Files modified:** `src/components/strategy-v2/TradeMixSubPanel.tsx`
**Commit:** `e3cf75c`
**Applied fix:** Added `import { CHART_ACCENT, CHART_TEXT_MUTED } from "@/components/charts/chart-tokens"` and replaced `"#1B6B5A"` → `CHART_ACCENT` and `"#94A3B8"` → `CHART_TEXT_MUTED` in the two `BucketBar` call sites. Values are identical; this is a single-source-of-truth fix only.

---

### IN-03: DESIGN-01 audit incomplete — RiskOfRuin.tsx and MonthlyReturnsBar.tsx still use off-brand hex

**Files modified:** `src/components/charts/RiskOfRuin.tsx`, `src/components/charts/MonthlyReturnsBar.tsx`
**Commit:** `f90dc54`
**Applied fix:**
- `RiskOfRuin.tsx`: imported `CHART_ACCENT, CHART_AXIS_TICK, CHART_BORDER, CHART_FONT_MONO`; replaced all 3 occurrences of `#0D9488` with `CHART_ACCENT`, `#64748B` with `CHART_AXIS_TICK`, `#E2E8F0` with `CHART_BORDER`, and `'JetBrains Mono', monospace` with `CHART_FONT_MONO`.
- `MonthlyReturnsBar.tsx`: imported `CHART_AXIS_TICK, CHART_BORDER, CHART_FONT_MONO, CHART_NEGATIVE, CHART_POSITIVE`; replaced `#059669` (wrong emerald) with `CHART_POSITIVE`, `#DC2626` with `CHART_NEGATIVE`, and standardized the axis tick/border/font literals to tokens.

---

## Post-Fix Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm test -- --run` | 2580 passed, 148 skipped, 0 failed (274 files) |

---

_Fixed: 2026-04-29T14:51:49Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

---

## UI Review Fix Pass

**Source review:** `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-UI-REVIEW.md`
**Fixed at:** 2026-04-29T17:03:00Z
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (3 priority + 2 minor)
- Fixed: 5
- Skipped: 0

### P1 (A11Y-01): MonthlyHeatmap zero-cell text contrast

**Files modified:** `src/components/charts/MonthlyHeatmap.tsx`
**Commit:** `df96177`
**Applied fix:** Added `import { CHART_AXIS_TICK } from "./chart-tokens"`. Changed `color: "#94A3B8"` (CHART_TEXT_MUTED, 2.5:1 contrast — WCAG AA fail) on the `value === 0` branch to `color: CHART_AXIS_TICK` (#64748B, 4.85:1 contrast). Zero-value numeric text now passes WCAG AA.

### P2 (Typography): RollingMetrics axis ticks use CHART_TICK_STYLE

**Files modified:** `src/components/charts/RollingMetrics.tsx`
**Commit:** `d2d598c`
**Applied fix:** Replaced inline `tick={{ fontSize: 11, fill: CHART_AXIS_TICK, fontFamily: CHART_FONT_MONO }}` on both XAxis and YAxis with `tick={CHART_TICK_STYLE}` (fontSize 12, AA-compliant fill, tabular-nums). Raised ReferenceLine avg label from `fontSize: 10` to `fontSize: 12`. Removed now-unused `CHART_AXIS_TICK` and `CHART_FONT_MONO` imports (both values are already embedded in `CHART_TICK_STYLE`).

### P3 (Typography + Color): DailyHeatmap month-axis fontSize 12 + CHART_AXIS_TICK fill

**Files modified:** `src/components/charts/DailyHeatmap.tsx`
**Commit:** `48474d3`
**Applied fix:** SVG `<text data-axis="month">` elements changed from `fontSize={10}` to `fontSize={12}` and from `fill={CHART_TEXT_MUTED}` (#94A3B8, 2.5:1) to `fill={CHART_AXIS_TICK}` (#64748B, 4.85:1). Year labels at `fontSize={12}` with `fill={CHART_TEXT_MUTED}` were left unchanged (context labels, not tick text — acceptable per existing review).

### Minor 1: ReturnHistogram inline hex → CHART_POSITIVE/CHART_NEGATIVE

**Files modified:** `src/components/charts/ReturnHistogram.tsx`
**Commit:** `159efd8`
**Applied fix:** Added `CHART_NEGATIVE` and `CHART_POSITIVE` to the chart-tokens import. Replaced `"#16A34A"` and `"#DC2626"` in the `Cell` fill prop with the token references. Single-source-of-truth restored; no visual change.

### Minor 2: BenchmarkGreeksTable p-3 per-cell padding

**Files modified:** `src/components/strategy-v2/BenchmarkGreeksTable.tsx`
**Commit:** `159efd8`
**Applied fix:** MetricCell has no internal padding (only `space-y-1` between label and value). Wrapped each `<MetricCell>` in a `<div className="p-3">` to deliver the 12px per-cell padding specified in UI-SPEC §1.

---

### Post-Fix Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | 0 errors |
| `npm run build` | Clean — all routes compiled, 0 warnings |
| `npm test -- --run` | 2580 passed, 148 skipped, 0 failed (274 files) |

_UI fix pass completed: 2026-04-29T17:03:00Z_
_Fixer: Claude (gsd-code-fixer)_
