---
phase: 14b
plan: 05
subsystem: strategy-v2
tags: [strategy-v2, panel-7, exposure, turnover, correlation, greeks, partial-data, kpi-18, kpi-19, kpi-20, kpi-21, kpi-23b, grok-b-03]
requires:
  - 14a panel chrome (data-panel/data-panel-status/aria-label/section + 14a card classes)
  - 14a PartialDataBanner primitive (src/components/strategy-v2/PartialDataBanner.tsx)
  - 14a useLazyPanelMetrics hook (src/hooks/useLazyPanelMetrics.ts) — fetchOnIntersect option already shipped in Wave 1 / Plan 14b-01
  - 14b-04 MetricCell primitive (src/components/strategy-v2/MetricCell.tsx) — reused by BenchmarkGreeksTable
  - Phase 09.1 CorrelationWithBenchmark chart (src/components/charts/CorrelationWithBenchmark.tsx) — reused unmodified
  - chart-tokens.ts (CHART_ACCENT, CHART_BORDER, CHART_REFERENCE_DASH, CHART_TEXT_MUTED, CHART_TICK_STYLE, CHART_TOOLTIP_STYLE)
  - Migration 087 — fetch_strategy_lazy_metrics RPC with `WHEN 'exposure' THEN ARRAY['exposure_series', 'turnover_series']` mapping
provides:
  - NetGrossExposureChart (src/components/charts/NetGrossExposureChart.tsx) — Recharts ComposedChart for KPI-18
  - TurnoverChart (src/components/charts/TurnoverChart.tsx) — Recharts LineChart for KPI-19
  - BenchmarkGreeksTable (src/components/strategy-v2/BenchmarkGreeksTable.tsx) — 4-cell strip for KPI-21
  - ExposureAndGreeksPanel (src/components/strategy-v2/ExposureAndGreeksPanel.tsx) — Panel 7 wrapper composing all 4 sub-sections; NOT yet wired in StrategyV2Shell
affects:
  - 14b-06 — will mount <ExposureAndGreeksPanel /> inside the StrategyV2Shell scroll, replacing the LazyPanelPlaceholder slot for Panel 7; will also pass benchmark_greeks (alpha/beta/IR/Treynor) read from analytics.metrics_json scalars
  - 14b-06 — Plan 14b-06 makes a SEPARATE direct call to fetchStrategyLazyMetrics(strategyId, 'equity') for Panel 2 Log Returns; that path is independent of this plan and exercises migration 087's WHEN 'equity' branch (Grok B-03 verified)
tech-stack:
  added: []
  patterns:
    - Recharts ComposedChart with overlay (Area + Line on shared axes) — first project use; precedent for any future "fill area + overlay line" pattern
    - Reference line at y=0 with CHART_TEXT_MUTED + CHART_REFERENCE_DASH (matches RollingMetrics 'avg' line styling)
    - Panel-level partial-data gate (history_days < 30) at the wrapper layer, BEFORE lazy lifecycle dispatch — partial banner replaces the entire body region uniformly
    - Per-sub-section empty fallbacks (empty exposure_series → SubBanner only, leaves Turnover / Correlation / Greeks intact) — follows ReturnsDistributionPanel idiom from Plan 14b-02
    - Narrow analytics-subset cast for CorrelationWithBenchmark (`as never` at call site) — keeps the existing Phase 09.1 component unmodified while accepting only the 2 keys it actually consumes (returns_series + metrics_json) per its `resolveBenchmarkCorrelation` helper
    - 3-decimal formatting for greeks (alpha 0.05 → "0.050") via toFixed(3); null/NaN/Infinity collapse to em-dash via MetricCell
    - Sign-aware negative styling on alpha/beta/Treynor only — IR is intentionally never sign-flagged because IR's sign-convention varies by benchmark
key-files:
  created:
    - src/components/charts/NetGrossExposureChart.tsx
    - src/components/charts/NetGrossExposureChart.test.tsx
    - src/components/charts/TurnoverChart.tsx
    - src/components/charts/TurnoverChart.test.tsx
    - src/components/strategy-v2/BenchmarkGreeksTable.tsx
    - src/components/strategy-v2/BenchmarkGreeksTable.test.tsx
    - src/components/strategy-v2/ExposureAndGreeksPanel.tsx
    - src/components/strategy-v2/ExposureAndGreeksPanel.test.tsx
  modified: []
decisions:
  - "Grok B-03 verified — migration 087 supports WHEN 'equity' (line 165, ARRAY['log_returns_series']) AND WHEN 'exposure' (line 174, ARRAY['exposure_series', 'turnover_series']). Plan 14b-05 fetches panel7 → 'exposure' only; the 'equity' path is consumed independently by Plan 14b-06 Panel 2 Log Returns via a direct fetchStrategyLazyMetrics call (NOT via this hook). No cross-plan coupling."
  - "Reuse CorrelationWithBenchmark unmodified — narrow analytics subset typed locally (returns_series + metrics_json) and `as never` cast at the call site (matches existing Phase 09.1 PerformanceReport.tsx idiom). Forking the component would have duplicated the 90d rolling-correlation math + the cumulative→daily conversion logic for zero benefit."
  - "BenchmarkGreeksTable label casing per UI-SPEC §10.4: alpha / beta lowercase (Greek-letter convention), IR uppercase (acronym), Treynor title-case (proper noun). Tested explicitly with case-sensitive equality."
  - "IR is never sign-flagged for negative styling — IR sign-conventions are ambiguous (some benchmarks treat above-benchmark IR as positive regardless of underlying-return sign; others flip). Caller decides; we render the value in default style with the sign baked in. Documented inline."
  - "fillOpacity={0.2} on Gross area is the literal value the test asserts (string '0.2' on the data-fill-opacity attribute). React renders the numeric prop as the string '0.2', so do not change to 0.20 or 0.200."
  - "TurnoverChart Y-axis tickFormatter renders percent with 1 decimal: (v * 100).toFixed(1) + '%'. The 0.21 → '21.0%' assertion proves both the multiplication AND the 1-decimal precision in a single test."
  - "NetGrossExposureChart Y-axis tickFormatter renders percent with 0 decimals: (v * 100).toFixed(0) + '%'. Less aggressive than turnover (turnover values are smaller and benefit from 1 decimal of precision)."
  - "Per-sub-section empty fallbacks for exposure_series / turnover_series; correlation + greeks always render in the ready state — the Correlation banner is internal to CorrelationWithBenchmark (preserved from Phase 09.1) and the greeks render as em-dashes via MetricCell when scalars are null."
metrics:
  duration_minutes: 5
  completed_date: "2026-04-29"
  tests: 30
  files_created: 8
  files_modified: 0
---

# Phase 14b Plan 05: Panel 7 — Exposure & Benchmark Greeks Summary

Panel 7 ships as a 4-section composite panel: Net & gross exposure (lazy `exposure_series` from migration 087), Turnover (lazy `turnover_series`), Correlation with BTC (existing Phase 09.1 chart reused unmodified), and Benchmark greeks (4-cell alpha / beta / IR / Treynor strip composed from MetricCell). Lazy-fetches via `useLazyPanelMetrics("panel7", { fetchOnIntersect: true, strategyId })`. Panel-level partial-data banner gates the entire body when `history_days < 30`; per-sub-section banners replace empty exposure / turnover series independently while leaving Correlation + Greeks intact.

## What shipped

### 1. `NetGrossExposureChart` (Task 1)

Recharts `ComposedChart` overlaying two visual layers on shared axes:

- **Gross**: filled `<Area>` at `CHART_ACCENT` (#1B6B5A) with `fillOpacity={0.2}`, `stroke="none"`. Renders the absolute leverage envelope.
- **Net**: solid `<Line>` at `CHART_ACCENT` 1.5px stroke, `dot={false}`. Renders directional bias on top of the gross envelope.
- **Reference line at y=0**: `<ReferenceLine>` with `CHART_TEXT_MUTED` (#94A3B8) + `CHART_REFERENCE_DASH` ("3 3"). Lets allocators read net-long vs net-short at a glance.
- **Y-axis**: percent with 0 decimals (`(v * 100).toFixed(0) + '%'`). Decimal-fraction input convention per Phase 12 METRICS-05/06 (gross/net are dimensionless ratios).
- **X-axis**: `dataKey="date"`, `tickFormatter` strips year (`d.slice(5)` → "01-15"), `interval="preserveStartEnd"`.
- **Height**: 240px. Returns `null` on empty data (caller renders the empty-state banner).
- **A11Y**: outer `<div role="img" aria-label="Net and gross exposure over time">` so screen readers can identify the chart region.
- **Legend**: enabled with auto-generated entries (sentence-case names "Gross" / "Net" passed via Recharts `name` prop on Area/Line).

### 2. `TurnoverChart` (Task 1)

Single-line Recharts `LineChart`, 200px tall:

- Single `<Line>` at `CHART_ACCENT` 1.5px stroke, `dot={false}`, `dataKey="value"`.
- **Y-axis**: percent with 1 decimal (`(v * 100).toFixed(1) + '%'`). Test asserts `0.21 → "21.0%"`. Decimal-fraction input per Phase 12 METRICS-19 (`turnover = Σ|Δposition × price| / NAV`).
- **Tooltip**: 2-decimal precision (`(v * 100).toFixed(2) + '%'`) labelled "Turnover" so hover text shows finer detail than tick labels.
- **A11Y**: outer `<div role="img" aria-label="Daily turnover as percent of NAV">`.
- Returns `null` on empty data.

Both charts use `CHART_TICK_STYLE` spread on `<XAxis tick={...}>` / `<YAxis tick={...}>` per the project's tabular-nums centralization rule (DESIGN-02 / Pitfall 14). Inverted grep guard confirms zero inline `tick={{ ... fontSize ... }}` literals.

### 3. `BenchmarkGreeksTable` (Task 2)

4-cell strip composed from MetricCell (Plan 14b-04 primitive):

- **Container**: `grid grid-cols-4 gap-3`
- **Cells in order**: `alpha` / `beta` / `IR` / `Treynor` (case-sensitive labels per UI-SPEC §10.4)
- **Value formatting**: `toFixed(3)` for finite numbers (e.g. `0.05 → "0.050"`); null / NaN / Infinity collapse to `null` which MetricCell renders as em-dash (U+2014).
- **Negative styling**: alpha / beta / Treynor receive `negative={true}` when value < 0 (text-negative); IR is never sign-flagged because IR's sign-convention varies by benchmark (some benchmarks invert when underlying returns are negative). Documented inline.

Reuses MetricCell verbatim — no styling code duplicated between Panel 6 and Panel 7. The 4 cells produce 4 `<dl>` semantic elements per the existing MetricCell wrapping.

### 4. `ExposureAndGreeksPanel` wrapper (Task 2)

Mounts the 14a panel chrome:

```html
<section data-panel="exposure" data-panel-status="..." aria-label="Exposure & benchmark greeks"
         class="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card">
  <h2 class="text-base font-semibold text-text-primary">Exposure &amp; benchmark greeks</h2>
  ...
</section>
```

**Lazy fetch contract**: `useLazyPanelMetrics<Panel7LazyPayload>("panel7", { fetchOnIntersect: true, strategyId })`. The hook's `PANEL_TO_ID` map (`src/hooks/useLazyPanelMetrics.ts:26-31`) routes `panel7 → 'exposure'`, which migration 087's `fetch_strategy_lazy_metrics` RPC maps to `ARRAY['exposure_series', 'turnover_series']` (line 174). Payload shape: `{ exposure_series?: { date, gross, net }[]; turnover_series?: { date, value }[] }`.

**Render-state matrix**:

| Condition                                  | Body region                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `history_days < 30`                        | PartialDataBanner — "Awaiting more data" / "needs at least 30 days..."         |
| `status === 'idle' \|\| 'loading'`         | Centered "Loading…" with `aria-live="polite"`                                  |
| `status === 'error'`                       | PartialDataBanner — "Couldn't load this section" / "Refresh the page to retry." |
| `status === 'ready'`                       | 4 stacked sub-sections (see below)                                             |

**4 sub-sections in `ready` state** (in order, separated by `space-y-6`):

1. **Net & gross exposure** (H3) — `<NetGrossExposureChart data={data.exposure_series} />` when populated; `<SubBanner body="Net & gross exposure unavailable for this strategy." />` when empty.
2. **Turnover** (H3) — `<TurnoverChart data={data.turnover_series} />` when populated; `<SubBanner body="Turnover unavailable for this strategy." />` when empty.
3. **Correlation with BTC** (H3) — `<CorrelationWithBenchmark analytics={correlation_analytics as never} />` always renders; the existing Phase 09.1 component handles its own internal empty-state ("Insufficient data — 90 days needed, {N} days so far.") when fewer than 90 aligned daily-return pairs are available.
4. **Benchmark greeks** (H3) — `<BenchmarkGreeksTable {...benchmark_greeks} />` always renders; null scalars become em-dashes via MetricCell.

H3 sub-section labels are exact: `Net & gross exposure`, `Turnover`, `Correlation with BTC`, `Benchmark greeks`.

## Why each design decision

### Reuse CorrelationWithBenchmark unmodified

The existing Phase 09.1 component already handles:

- 90d rolling-window math via `rollingCorrelation` + `cumulativeToDailyMap`
- Server-side precomputed series fallback (`metrics_json.btc_rolling_correlation_90d`)
- Three-way empty-state branching ("Benchmark data unavailable" vs "Insufficient data — 90 days..." vs full series)
- Recharts LineChart with reference line at y=0 + Y-domain locked to [-1, 1]

Forking it for the v2 panel would have copy-pasted 100+ lines of math. The component's `Props` accepts `StrategyAnalytics` (broad), but `resolveBenchmarkCorrelation` only reads `returns_series` + `metrics_json` (per the helper signature `Pick<StrategyAnalytics, "returns_series" | "metrics_json">`). The panel input is typed as a narrow `CorrelationAnalyticsSubset` containing exactly those two keys; the call site uses `as never` to satisfy the broad Props expectation without runtime cost. This pattern matches the existing v1 PerformanceReport.tsx idiom.

### Migration 087 panel-id verification (Grok B-03)

Pre-flight grep guards on `supabase/migrations/087_strategy_analytics_series.sql`:

- `grep -c "WHEN 'exposure'"` → **1** (line 174: `ARRAY['exposure_series', 'turnover_series']`)
- `grep -c "WHEN 'equity'"` → **1** (line 165: `ARRAY['log_returns_series']`)

The Grok B-03 finding originally questioned whether `'equity'` was supported — verified that it IS supported in the RPC's CASE statement. Plan 14b-05 fetches `panel7 → 'exposure'` only (via the hook's `PANEL_TO_ID` map). Plan 14b-06 makes a separate DIRECT call to `fetchStrategyLazyMetrics(strategyId, 'equity')` for Panel 2 Log Returns — that path is independent and exercises the `'equity'` branch documented in this plan's `<interfaces>` section (line 122 of 14b-05-PLAN.md).

### Panel-level vs sub-section partial-data thresholds

Per UI-SPEC §4.3:

- **Panel-level (history_days < 30)**: replaces the entire body uniformly because below 30 days, NONE of the 4 sub-sections produce statistically meaningful output (exposure/turnover series too short to chart; correlation needs 90 days; greeks need a 30+ day series for stable estimation).
- **Sub-section (empty exposure_series / turnover_series at ready)**: replaces only that section. Correlation has its own 90d threshold inside CorrelationWithBenchmark; greeks render em-dashes via MetricCell when scalars are null. The 4 sub-sections are decoupled in the `ready` state — empty exposure_series leaves Turnover / Correlation / Greeks intact.

This 2-tier gating mirrors the ReturnsDistributionPanel idiom from Plan 14b-02 (panel-level + per-sub-section banners).

## Test coverage

### NetGrossExposureChart.test.tsx — 8 tests

- Test 1: renders one Area + one Line; returns null on empty data
- Test 2: Area `fill=CHART_ACCENT`, `fillOpacity=0.2`, `dataKey="gross"`; Line `stroke=CHART_ACCENT`, `strokeWidth=1.5`, `dataKey="net"`
- Test 3: ReferenceLine `y=0`, `stroke=CHART_TEXT_MUTED`, `strokeDasharray=CHART_REFERENCE_DASH`
- Test 4: ResponsiveContainer `height=240`; both axes spread CHART_TICK_STYLE
- Test 5: outer `<div role="img" aria-label="Net and gross exposure over time">`
- Test 6: Legend renders + Area `name="Gross"`, Line `name="Net"`
- Test 10: source has zero inline `tick={{ ... fontSize ... }}` literals
- Source uses ComposedChart import

### TurnoverChart.test.tsx — 6 tests

- Test 7: single Line, `stroke=CHART_ACCENT`, `strokeWidth=1.5`
- Test 7b: returns null on empty data
- Test 8: ResponsiveContainer `height=200`; axes spread CHART_TICK_STYLE; Y-formatter renders `0.21 → "21.0%"`
- Test 9: outer `<div role="img" aria-label="Daily turnover as percent of NAV">`
- Test 10: zero inline tick fontSize literals

### BenchmarkGreeksTable.test.tsx — 6 tests

- Test 1: `grid grid-cols-4 gap-3` container; 4 MetricCells with verbatim labels `["alpha", "beta", "IR", "Treynor"]`
- Test 2: 3-decimal formatting (`0.05 → "0.050"`, `1.2 → "1.200"`, `0.8 → "0.800"`, `0.04 → "0.040"`)
- Test 3: null inputs → null MetricCell values (em-dash via primitive)
- Test 4: alpha/beta/Treynor get `negative={true}` when < 0; IR never sign-flagged
- Test 4b: positive values do NOT receive negative flag
- Test 4c: NaN/Infinity collapse to null + no negative flag

### ExposureAndGreeksPanel.test.tsx — 10 tests

- Test 5: chrome — `section[data-panel="exposure"]` with 14a card classes + `aria-label="Exposure & benchmark greeks"`
- Test 6: panel-level partial data when `history_days < 30` — banner only, no sub-components
- Test 7: ready full — 4 H3s in order (`Net & gross exposure` / `Turnover` / `Correlation with BTC` / `Benchmark greeks`); all 4 sub-components mount; data routes correctly
- Test 8a: empty `exposure_series` → SubBanner replaces NetGross only; Turnover + Correlation + Greeks unaffected
- Test 8b: empty `turnover_series` → SubBanner replaces Turnover only
- Test 8c: `data === null` at ready → both NetGross + Turnover sub-banners; Correlation + Greeks still render
- Test 9a: `status='loading'` → centered Loading…; no sub-components
- Test 9b: `status='error'` → error PartialDataBanner; no sub-components
- Test 10: no forbidden type-scale classes (`font-medium`, `text-sm`, `text-xl`, `text-2xl`)
- Test 11: `useLazyPanelMetrics` called with `panelId='panel7'` + `fetchOnIntersect: true` + `strategyId='s1'`

**Total: 30 tests across 4 files, all passing.**

## Verification gates (from PLAN.md)

| Gate | Result |
|------|--------|
| `npm test -- src/components/strategy-v2/{ExposureAndGreeksPanel,BenchmarkGreeksTable}.test.tsx src/components/charts/{NetGrossExposureChart,TurnoverChart}.test.tsx --run` | 4 passed (4 files) / 30 passed (30 tests) |
| `grep -rn "ExposureAndGreeksPanel\|BenchmarkGreeksTable\|NetGrossExposureChart\|TurnoverChart" src/components/strategy-v2/StrategyV2Shell.tsx` returns 0 | 0 (correct — wiring is 14b-06's responsibility) |
| CorrelationWithBenchmark unmodified | confirmed (`git status` shows the file is not in the working tree changes) |
| `grep -c "WHEN 'equity'" supabase/migrations/087_strategy_analytics_series.sql` returns 1 | 1 (Grok B-03 verified) |
| `grep -c "WHEN 'exposure'" supabase/migrations/087_strategy_analytics_series.sql` returns 1 | 1 |
| `grep -c "ComposedChart" src/components/charts/NetGrossExposureChart.tsx` ≥ 1 | 4 |
| `grep -c "ReferenceLine" src/components/charts/NetGrossExposureChart.tsx` ≥ 1 | 2 |
| `grep -c "fillOpacity={0.2}" src/components/charts/NetGrossExposureChart.tsx` returns 1 | 1 |
| `grep -c "role=\"img\"" src/components/charts/{NetGrossExposureChart,TurnoverChart}.tsx` returns 2 | 2 (1 each) |
| Inline tick fontSize (must be 0) | 0 (both files) |
| `grep -c "data-panel=\"exposure\"" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` returns 1 | 1 |
| `grep -c "useLazyPanelMetrics<Panel7LazyPayload>(\"panel7\"" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` returns 1 | 1 |
| `grep -c "fetchOnIntersect: true" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` returns 1 | 1 |
| `grep -c "MetricCell" src/components/strategy-v2/BenchmarkGreeksTable.tsx` ≥ 4 | 7 (4 component instances + 1 import + 2 doc-string mentions) |
| Forbidden classes (font-medium / text-sm / text-xl / text-2xl) in panel + table | 0 / 0 |
| `npx tsc --noEmit` exits 0 | 0 |
| `npm run build` exits 0 | 0 |

## Requirements satisfied

| Req | Description | Status |
|-----|-------------|--------|
| KPI-18 | Net & gross exposure series chart | ✓ NetGrossExposureChart with ComposedChart (Area + Line) |
| KPI-19 | Turnover series chart | ✓ TurnoverChart with single-line LineChart |
| KPI-20 | Correlation with BTC | ✓ CorrelationWithBenchmark reused unmodified |
| KPI-21 | Benchmark greeks (alpha / beta / IR / Treynor) | ✓ BenchmarkGreeksTable composing MetricCell |
| KPI-23b (Panel 7 portion) | Panel 7 partial-data | ✓ panel-level <30d banner + per-sub-section empty fallbacks for exposure_series / turnover_series |

## Deviations from Plan

None — plan executed exactly as written.

The plan's `<action>` block included a NOTE about possibly using `as never` cast on CorrelationWithBenchmark — that path was taken (the existing component's Props type expects the full `StrategyAnalytics`; we pass a narrow subset and cast). This was the plan's preferred path A and the executed path A; not a deviation.

## What 14b-06 picks up

Plan 14b-06 will:

1. Mount `<ExposureAndGreeksPanel />` inside `StrategyV2Shell.tsx`, replacing the `<LazyPanelPlaceholder />` slot for Panel 7.
2. Pass `benchmark_greeks` derived from `analytics.metrics_json.alpha / beta / information_ratio / treynor_ratio` (or `ir` / `treynor` aliases — exact key names live in metrics.py:255-267 per Phase 12 contract).
3. Pass `correlation_analytics` as a slim shape `{ returns_series, metrics_json }` from the eager analytics blob.
4. Pass `history_days` (the same prop already wired into Panels 1–6).
5. Pass `strategyId` for the lazy fetch.
6. Make a separate direct call to `fetchStrategyLazyMetrics(strategyId, 'equity')` for Panel 2 Log Returns — independent of this plan, exercises migration 087's `WHEN 'equity'` branch (Grok B-03 cross-plan dependency note).

The Panel 7 component itself is feature-complete; the only remaining work is the wiring + prop derivation in StrategyV2Shell.

## Stub tracking

No stubs. Each component is fully wired or returns `null` for empty inputs (NetGross / Turnover) — empty-input handling at the wrapper layer dispatches to the explicit `<SubBanner body="..." />` placeholders, which are intentional UX (not unwired data).

## Self-Check: PASSED

- All 8 created files exist on disk.
- Both per-task commits exist in git history (`38ad781`, `0fa89dd`).
