# Technology Stack — v0.17.0.0 Sprint 12 (KPI Parity + Discovery v2)

**Researched:** 2026-04-26
**Scope:** STACK gaps for T7 (Discovery v2), T8a (backend metric contracts), T8b (Single-Strategy v2 7-panel UI). Team-side workspace (S1–S5) is deferred to v0.18 and out of scope for this research.
**Verdict:** **NO new top-level dependencies required.** Every chart need v0.17 introduces is solvable inside the libraries already bundled, plus one optional micro-package for SVG performance on the Daily Heatmap. Backend metric extensions are pure `metrics.py` additions on top of `pandas + quantstats + numpy` already pinned in `analytics-service/requirements.txt`.

## TL;DR Decision Matrix

| Surface / Need | Library to use | Already installed? | Rationale |
|---|---|---|---|
| Equity vs BTC overlay (Panel 2) | `lightweight-charts@^5.1.0` | ✓ | Already powers `<EquityCurve>`. Native `addSeries(LineSeries, …)` + tooltip + crosshair; toggle just adds 2nd series. Zero retraining. |
| Drawdown chart (Panel 3) | `recharts@^3.8.1` `<AreaChart>` | ✓ | Existing `<DrawdownChart>` is exactly this. No change. |
| Worst 5 Drawdowns table (Panel 3) | Plain HTML + Tailwind (no chart lib) | n/a | Existing `<WorstDrawdowns>` already follows DESIGN.md. No change. |
| Monthly heatmap (Panel 4) | CSS Grid + Tailwind (no chart lib) | n/a | Existing `<MonthlyHeatmap>` is 12 cells × N rows with `bg-emerald-*` / `bg-red-*` quantized — needs DESIGN.md *recolor* to `accent` ramp + `negative` ramp, not a library swap. |
| Daily heatmap (Panel 4 — NEW) | Hand-rolled SVG, conditional canvas fallback at >1825 cells | n/a | A library would be heavier than a 90-line SVG. See FM-5 mitigation below. |
| Return histogram (Panel 4) | `recharts@^3.8.1` `<BarChart>` | ✓ | Existing `<ReturnHistogram>` — re-bin + accent recolor only. |
| Return Quantiles boxplot (Panel 4) | `@nivo/boxplot@^0.99.0` OR existing hand-rolled SVG | ✓ (both) | Already installed but **not currently used**. Existing `<ReturnQuantiles>` is hand-rolled SVG. **Recommendation: keep hand-rolled, drop `@nivo/boxplot` from the bundle.** See "Anti-recommendations" below. |
| Yearly returns bar (Panel 4) | `recharts@^3.8.1` `<BarChart>` | ✓ | Existing `<YearlyReturns>`. Recolor only. |
| Rolling Sharpe / Sortino / Vol with toggle (Panel 5) | `recharts@^3.8.1` `<LineChart>` + `<ReferenceLine>` | ✓ | Existing `<RollingMetrics>` covers Sharpe; extend to Sortino/Vol via the same component shape (3 windows × 3 metrics in a single grid pattern). |
| Trade-table aggregations (Panel 6) | Plain HTML tables + `formatPercent/formatNumber` utilities | n/a | qstats values come back as scalars — table rows, not charts. |
| Exposure / Turnover series (Panel 7) | `recharts@^3.8.1` `<LineChart>` | ✓ | Same component shape as `<RollingMetrics>`. |
| BTC correlation panel (Panel 7) | `recharts@^3.8.1` `<LineChart>` | ✓ | Existing `<CorrelationWithBenchmark>`. No change. |
| Discovery v2 grid view (T7) | Existing `<StrategyGrid>` + new `<StrategyCard>` (Tailwind only) | n/a | No chart lib. Cards reuse `<Sparkline>` (SVG, ~50 lines). |
| Discovery v2 sparkline color split (in-the-money vs negative) | Existing `<Sparkline>` (`color` prop already accepts CSS var) | ✓ | Just pass `var(--color-negative)` for losses; one-liner. |

## What's already in `package.json` (v0.15.13.0) — verify before adding ANY library

```json
{
  "@nivo/boxplot": "^0.99.0",     // installed but unused; consider removal
  "@tanstack/react-table": "^8.21.3", // for sortable Discovery table
  "lightweight-charts": "^5.1.0",  // EquityCurve only
  "react-markdown": "10.1.0",      // notes — unrelated to v0.17
  "recharts": "^3.8.1",            // 7 of 12 chart components
  "rehype-sanitize": "6.0.0",      // notes — unrelated
  "remark-gfm": "4.0.1"            // notes — unrelated
}
```

Latest versions (2026-04-26 npm): `recharts@3.8.1` (current — pinned), `lightweight-charts@5.2.0` (minor bump available — non-blocking, defer), `@nivo/boxplot@0.99.0` (current). **No security or feature pressure to upgrade in this milestone.**

## Backend stack — `analytics-service/requirements.txt` (UNCHANGED)

```
quantstats==0.0.81
pandas==2.2.3
numpy==2.2.4
fastapi==0.115.12
```

Every metric T8a needs (`daily_returns_grid`, `rolling_sortino_series`, `rolling_volatility_series`, `exposure_series`, `turnover_series`, trade aggregations: `trade_main`, `trade_mix`, `position_main`, `risk_reward`, `sqn`, `expectancy`) is computable from `pandas + numpy + quantstats` already pinned. **NO new Python dependencies.**

Specifically:
- `daily_returns_grid` — already half-built. `_monthly_returns_grid_from_series` at `metrics.py:351` is the template; `daily_returns_grid` is the same shape with `.resample("D")` instead of `.resample("ME")`. Pure pandas reshape.
- `rolling_sortino_series` — clone of `_rolling_sharpe` at `metrics.py:374`, divide rolling mean by downside std (`returns[returns < 0].rolling(window).std()`).
- `rolling_volatility_series` — `returns.rolling(window).std() * np.sqrt(252)`. One line.
- `exposure_series` — **existing infrastructure**: `compute_exposure_metrics` in `position_reconstruction.py:435` already aggregates from `position_snapshots`; the *aggregates* (mean/std/max gross+net) are computed but the underlying per-date `gross_exposures` / `net_exposures` arrays are *thrown away* (lines 461-487). Refactor to also persist them as a series — pure plumbing, no new math.
- `turnover_series` — same pattern. Today only `mean_daily_turnover` is exposed (visible in `types.ts:47`); add per-day series alongside it.
- `trade_main / trade_mix / position_main / risk_reward / sqn / expectancy` — `volume_metrics` and `trade_metrics` JSONB columns already exist on `strategy_analytics` (verified in `VolumeExposureTab.tsx:10-28`). Add per-side rollups using qstats: `qs.stats.win_rate`, `qs.stats.profit_factor`, `qs.stats.expected_return` for SQN ratio (`mean(R)/std(R) * sqrt(N)` — pandas one-liner).
- BTC-only correlation already shipped (`metrics.py:269` `btc_rolling_correlation_90d`). Multi-benchmark (ETH/SOL) is descoped per UC#6 — no work here.

## Database — `is_example` flag is ALREADY THERE

Plan claims the plan's S6/T7 Discovery v2 needs a "new `strategies.is_example` flag." **This is incorrect — the column exists.** Verified at `supabase/migrations/001_initial_schema.sql:64`:

```sql
is_example BOOLEAN NOT NULL DEFAULT false,
```

It's also typed in `src/lib/types.ts:52`. The existing `<StrategyTable>` (line 130) **already filters on it** when `showExamples=false`. T7's contribution is:
1. Add a "Customize" drawer (already partially scaffolded — `CustomizeModal` is a function in `StrategyFilters.tsx:583`).
2. Persist `CustomizeSettings` (already typed at `StrategyFilters.tsx:63`) to `localStorage` under `discovery_view_preferences:{slug}`.
3. Default the toggle to `hideExamples=true` rather than the current `showExamples=true` (one boolean flip in `StrategyTable.tsx:90`).

**No migration needed.** No new column. Plan over-scoped this; phase planner should mark it as "already done at the schema layer."

The new tables T7 introduces are:
- `user_watchlist (user_id UUID, strategy_id UUID, added_at TIMESTAMPTZ)` — single migration, two-column PK, allocator-RLS scoped. Pure schema work, no library question.

## Recommended Stack (composite for v0.17)

### Frontend charts

| Library | Version | Where | Why this and not alternatives |
|---|---|---|---|
| `recharts` | `^3.8.1` (current) | All Cartesian time-series + bars | Already standardized. Has `<ReferenceLine>` for "avg" overlays, `<Legend formatter>` for renaming `sharpe_90d → "3M"`, `<Tooltip contentStyle>` already wrapped in `chart-tokens.ts:CHART_TOOLTIP_STYLE`. `lightweight-charts` is purpose-built for OHLC and overcrowds for simple line charts. |
| `lightweight-charts` | `^5.1.0` (pinned) | Equity vs BTC overlay only (Panel 2) | Already powers `EquityCurve.tsx`. Native crosshair, two-series toggle, custom `priceFormat: { type: "custom", formatter }` already wired. |
| `@nivo/boxplot` | `^0.99.0` | **Remove** | Installed but `ReturnQuantiles.tsx` doesn't import it. Hand-rolled SVG (78 LoC) is cleaner and matches DESIGN.md tokens directly. Removing it shrinks the bundle by ~80KB gzipped. |
| Tailwind CSS Grid | `^4` | Monthly heatmap, Daily heatmap | Both heatmaps are 2D grids of 1px-bordered cells with quantized fill — that is literally `grid grid-cols-12 gap-px`. A library is overkill. |
| Hand-rolled SVG | n/a | Daily heatmap (FM-5 mitigation), Sparkline | SVG with explicit `viewBox` is fine up to ~2000 cells. For 5-year daily history (~1825 cells) at 12-wide × 152-tall layout, SVG is well under the 5K-node browser-perf threshold. **Canvas fallback only triggers at >1825 cells**, gated by a `cells.length > 1825` branch. See "Daily heatmap concrete recommendation" below. |

### Backend metrics (analytics-service)

| Library | Version | Why no change |
|---|---|---|
| `quantstats` | `0.0.81` (pinned) | Provides `qs.stats.win_rate`, `qs.stats.profit_factor`, `qs.stats.expected_return`, `qs.stats.greeks` already used. Trade aggregations come from these. |
| `pandas` | `2.2.3` (pinned) | `.resample`, `.rolling`, `.quantile` cover every series operation T8a needs. |
| `numpy` | `2.2.4` (pinned) | `np.sqrt(252)` for annualization, `np.percentile` for VaR. Used. |

**Do NOT add `scipy` / `statsmodels` / `arch`.** None of the T8a metrics require them; pandas+numpy is sufficient.

## Daily heatmap — concrete recommendation (FM-5 mitigation)

The plan's failure-mode registry (FM-5) flags "Daily heatmap render slow on 5y history" with mitigation "Render as virtualized canvas instead of SVG." This is the right instinct but premature without numbers. Concrete spec:

**Layout:** `<DailyHeatmap>` — 12 columns × N rows where N = months in history. Each cell is one *day* colored by `cellColor(returnPct)` (same quantized ramp as `<MonthlyHeatmap>` but applied to daily returns).

**Threshold:** Render in SVG if `cells.length <= 1825` (5 years of daily data); switch to `<canvas>` otherwise.

**SVG implementation (default path):**
```tsx
<svg viewBox={`0 0 ${width} ${height}`} className="w-full">
  {cells.map((c, i) => (
    <rect
      key={i}
      x={c.col * cellW}
      y={c.row * cellH}
      width={cellW - 1}
      height={cellH - 1}
      fill={cellColor(c.value)}
    >
      <title>{`${c.date}: ${(c.value * 100).toFixed(2)}%`}</title>
    </rect>
  ))}
</svg>
```

**Canvas implementation (fallback):** Single `<canvas>` element, drawn once on data change via `useEffect`; no animation, no per-frame re-render. ~30 lines.

**Why not a library:** `react-calendar-heatmap` (~12K weekly downloads) targets GitHub-style year-grid layouts and inserts its own DOM/styles that conflict with DESIGN.md tokens. `visx`/`@visx/heatmap` is 50KB+ for what amounts to `<rect>` placement. Hand-rolled SVG keeps `chart-tokens.ts` as the single source of truth for color, font, gridline.

## Anti-recommendations (DO NOT add)

| Library | Why not |
|---|---|
| `plotly.js` / `react-plotly.js` | The whole point of v0.17 (per plan Identity Rules) is to *replace* `qs.reports.html()`'s Plotly chrome. Adding Plotly to render it ourselves would defeat the design goal and add ~3MB gzip. |
| `chart.js` / `react-chartjs-2` | Canvas-based, doesn't compose with Tailwind/DESIGN.md tokens cleanly, no `<ReferenceLine>` analogue without plugins. We already have Recharts. |
| `apexcharts` | Heavier than Recharts, no codebase precedent, would force a third standard. |
| `echarts` / `echarts-for-react` | Strong heatmap support but 800KB+ gzipped baseline. Would be the third charting standard after Recharts and lightweight-charts. **Reject — adds a learning surface for one chart (daily heatmap) we can do in 90 lines of SVG.** |
| `visx` / `@visx/*` | Excellent low-level primitives but increases mental overhead to mix with Recharts. Recommend only if a future requirement lands that Recharts genuinely can't serve. |
| `nivo` (other than `@nivo/boxplot` already installed) | Same family as visx in spirit (composable D3 wrappers), and `@nivo/boxplot` itself is unused — adding sibling packages compounds the bundle without solving anything. |
| `react-calendar-heatmap` | Opinionated GitHub-style layout that does not match the qstats daily-heatmap shape (12-mo × N-yr rectangle); would need overrides that defeat the point. |
| New backend Python deps (`scipy`, `statsmodels`, `arch`, `pyfolio`) | The premise-3-corrected catalogue is all `pandas + numpy + quantstats` work. `pyfolio` overlaps with `quantstats` and is unmaintained since 2020. |

## Integration map — where each new chart slots in

```
src/components/charts/
├── chart-tokens.ts           [REUSE — single color/font source]
├── EquityCurve.tsx           [REUSE — Panel 2 cumulative path]
├── DrawdownChart.tsx         [REUSE — Panel 3]
├── MonthlyHeatmap.tsx        [RECOLOR — replace bg-emerald-* with accent ramp]
├── ReturnHistogram.tsx       [RECOLOR — replace #059669/#DC2626 with accent/negative]
├── ReturnQuantiles.tsx       [RECOLOR — already SVG, swap #0D9488 → #1B6B5A]
├── RollingMetrics.tsx        [EXTEND — currently Sharpe-only; add Sortino, Vol via metricKey prop]
├── Sparkline.tsx             [REUSE — Discovery card, identity-translate]
├── WorstDrawdowns.tsx        [REUSE — Panel 3 table]
├── YearlyReturns.tsx         [RECOLOR — same swap]
├── CorrelationWithBenchmark.tsx [REUSE — Panel 7]
├── DailyHeatmap.tsx          [NEW — SVG/canvas hybrid, ~90 LOC]
├── ExposureSeries.tsx        [NEW — Recharts LineChart, ~60 LOC]
├── TurnoverSeries.tsx        [NEW — Recharts LineChart, ~60 LOC]
└── UnderwaterToggle.tsx      [NEW — segmented control wrapper for Panel 2 view-mode toggle]
```

```
src/components/strategy/
├── PerformanceReport.tsx     [REPLACE — old 5-tab is route /strategy/[id]; keep at v1]
├── PerformanceReportV2.tsx   [NEW — 7-panel layout at /strategy/[id]/v2 OR feature-flagged at /strategy/[id]]
├── StrategyTable.tsx         [EXTEND — already supports table+grid; just toggle default + persist]
├── StrategyFilters.tsx       [EXTEND — Customize modal already exists; persist to localStorage]
├── StrategyCard.tsx          [NEW — grid view card, ~120 LOC, reuses Sparkline]
└── overview/
    └── OverviewCards.tsx     [NEW — Panel 1 six cards]
```

```
analytics-service/services/
├── metrics.py                [EXTEND — add 5 functions: daily_returns_grid, rolling_sortino_series, rolling_volatility_series, trade_aggregations, sqn_expectancy]
└── position_reconstruction.py [EXTEND — compute_exposure_metrics already collects per-date arrays at lines 461-487; persist them, don't discard]

analytics-service/tests/
├── test_metrics.py           [EXTEND — fixtures for 30d/180d/2y/5y; per-metric golden]
└── fixtures/
    └── ... (NEW fixtures)    [Need 1y daily fixture for cross-runtime parity check vs qstats]
```

## Installation diff — what changes in `package.json`

**Adds:** none.

**Removes (recommended cleanup):**
```bash
npm uninstall @nivo/boxplot
```

**Optional bump (non-blocking, defer to maintenance window):**
```bash
npm install lightweight-charts@^5.2.0
```

**Backend (`analytics-service/requirements.txt`):** no changes.

## Confidence

| Claim | Confidence | Source |
|---|---|---|
| `is_example` already exists | HIGH | `supabase/migrations/001_initial_schema.sql:64` + `src/lib/types.ts:52` (verified by grep) |
| `compute_exposure_metrics` exists but discards series | HIGH | `position_reconstruction.py:461-495` (read directly) |
| `volume_metrics` / `trade_metrics` JSONB already populated | HIGH | `VolumeExposureTab.tsx:10-28` (read directly) |
| `@nivo/boxplot` is unused | MEDIUM | grep across `src/components/charts/*.tsx` for `@nivo` returned no imports; inspect imports in any factsheet/dashboard surface before npm-uninstalling |
| `metrics.py` does NOT compute rolling Sortino/Vol series, daily grid, exposure series, turnover series, multi-benchmark, or trade aggregations | HIGH | `metrics.py` (411 lines) read directly; only Sharpe windows 30/90/365 series exist; aggregates only for vol/sortino |
| Recharts 3.8.1 + lightweight-charts 5.1.0 are current and adequate | HIGH | `npm view` returned 3.8.1 / 5.2.0 (one minor available, non-blocking) |
| Daily heatmap SVG ≤ 1825 cells is performant | MEDIUM | Browser SVG node thresholds are well-documented (~5K nodes); 1825 cells = 1825 `<rect>` is well under, but no benchmark in this codebase yet — phase planner should add a perf budget assertion |
| BTC-only correlation is the right v0.17 scope | HIGH | UC#6 in plan resolution explicitly descopes ETH/SOL; benchmark.py rejects ETH/SOL with ValueError per Eng review |

## Sources

- `package.json` (v0.15.13.0)
- `analytics-service/requirements.txt`
- `analytics-service/services/metrics.py` (411 lines, read fully)
- `analytics-service/services/position_reconstruction.py:435-495` (compute_exposure_metrics)
- `src/components/charts/*.tsx` (12 files inspected)
- `src/components/strategy/PerformanceReport.tsx`
- `src/components/strategy/StrategyTable.tsx`
- `src/components/strategy/StrategyFilters.tsx`
- `src/components/strategy/VolumeExposureTab.tsx`
- `src/lib/types.ts` (grep results)
- `supabase/migrations/001_initial_schema.sql:64` (`is_example` confirmation)
- `DESIGN.md` (chart identity rules § Color, § Typography)
- `~/.claude/plans/strategy-teams-kpi-parity.md` § "What already exists", § "Coverage gap to current state", T8a, T8b, FM-5
- `npm view` (recharts, lightweight-charts, @nivo/boxplot, echarts, echarts-for-react) — 2026-04-26
