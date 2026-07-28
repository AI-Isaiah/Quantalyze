---
phase: 14b
plan: 05
type: execute
wave: 2
depends_on: [14b-01, 14b-04]
files_modified:
  - src/components/strategy-v2/ExposureAndGreeksPanel.tsx
  - src/components/strategy-v2/ExposureAndGreeksPanel.test.tsx
  - src/components/strategy-v2/BenchmarkGreeksTable.tsx
  - src/components/strategy-v2/BenchmarkGreeksTable.test.tsx
  - src/components/charts/NetGrossExposureChart.tsx
  - src/components/charts/NetGrossExposureChart.test.tsx
  - src/components/charts/TurnoverChart.tsx
  - src/components/charts/TurnoverChart.test.tsx
autonomous: true
requirements: [KPI-18, KPI-19, KPI-20, KPI-21, KPI-23b]
requirements_addressed: [KPI-18, KPI-19, KPI-20, KPI-21, KPI-23b]
tags: [strategy-v2, panel-7, exposure, turnover, correlation, greeks, partial-data]
must_haves:
  truths:
    - "Panel 7 mounts <ExposureAndGreeksPanel /> with 4 sub-components: Net & gross exposure / Turnover / Correlation with BTC / Benchmark greeks"
    - "Panel 7 lazy-fetches via useLazyPanelMetrics({ fetchOnIntersect: true, strategyId, panelId: 'panel7' }) — returns { exposure_series, turnover_series }"
    - "NetGrossExposureChart renders Recharts ComposedChart: gross filled area (CHART_ACCENT 0.2 opacity) + net solid line (CHART_ACCENT 1.5px) with reference line at 0"
    - "TurnoverChart renders Recharts LineChart: single CHART_ACCENT 1.5px line, height=200"
    - "CorrelationWithBenchmark reused as-is for BTC correlation"
    - "BenchmarkGreeksTable: 4 cells (alpha / beta / IR / Treynor) using MetricCell primitive from 14b-04"
    - "Panel-level partial-data when history_days < 30 (KPI-23b)"
    - "Correlation sub-section banner when history_days < 90 (existing CorrelationWithBenchmark logic preserved)"
  artifacts:
    - path: "src/components/strategy-v2/ExposureAndGreeksPanel.tsx"
      provides: "Wrapper for Panel 7 — 4 sub-components stacked"
      exports: ["ExposureAndGreeksPanel"]
    - path: "src/components/charts/NetGrossExposureChart.tsx"
      provides: "ComposedChart with gross fill area + net line + reference line at 0"
      exports: ["NetGrossExposureChart"]
    - path: "src/components/charts/TurnoverChart.tsx"
      provides: "Single-line LineChart for daily turnover %"
      exports: ["TurnoverChart"]
    - path: "src/components/strategy-v2/BenchmarkGreeksTable.tsx"
      provides: "4-cell strip — alpha / beta / IR / Treynor"
      exports: ["BenchmarkGreeksTable"]
  key_links:
    - from: "src/components/strategy-v2/ExposureAndGreeksPanel.tsx"
      to: "src/components/charts/CorrelationWithBenchmark.tsx"
      via: "import + render (existing component reused)"
      pattern: "CorrelationWithBenchmark"
    - from: "src/components/strategy-v2/BenchmarkGreeksTable.tsx"
      to: "src/components/strategy-v2/MetricCell.tsx"
      via: "import + render 4 cells"
      pattern: "MetricCell"
---

<objective>
Ship Panel 7 — Exposure & benchmark greeks. Mounts 4 stacked sub-components: NetGrossExposureChart (NEW), TurnoverChart (NEW), CorrelationWithBenchmark (existing — reused), BenchmarkGreeksTable (NEW, 4-cell alpha/beta/IR/Treynor strip). Lazy-fetches `panel7` → `exposure` → `{ exposure_series, turnover_series }` per migration 087. Panel-level partial-data banner triggers below 30-day history.

Purpose: KPI-18 (Net & Gross Exposure series), KPI-19 (Turnover series), KPI-20 (Correlation with BTC), KPI-21 (Benchmark Greeks) + Panel 7 portion of KPI-23b.
Output: 1 panel wrapper + 3 new chart/cell components + 4 test files. Reuses MetricCell from 14b-04 (depends_on). NOT yet mounted in StrategyV2Shell (that's 14b-06).

**Revision (2026-04-29 Grok B-03):** Verified migration 087 CASE statement (lines 162-176) explicitly maps `WHEN 'equity' THEN ARRAY['log_returns_series']`. The `'equity'` panelId IS supported by the RPC, contradicting the Grok finding's premise. The actual contract: Plan 14b-05 fetches `panel7` (NOT `panel7=equity`) for Net/Gross + Turnover series. Plan 14b-06 makes a separate DIRECT call to `fetchStrategyLazyMetrics(strategyId, 'equity')` for Panel 2 Log Returns — not via this panel. We add an explicit integration test in plan 14b-06 (and a smoke test note here) asserting the `'equity'` fetch path resolves correctly. No data shape change in plan 14b-05.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/STATE.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-CONTEXT.md
@.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md
@.planning/phases/14a-single-strategy-v2-eager-panels-identity/14A-UI-SPEC.md
@DESIGN.md
@src/components/charts/chart-tokens.ts
@src/components/charts/CorrelationWithBenchmark.tsx
@src/components/strategy-v2/PartialDataBanner.tsx
@src/lib/types.ts
@src/lib/queries.ts
@supabase/migrations/087_strategy_analytics_series.sql

<interfaces>
<!-- Contracts the executor uses directly. -->

From 14b-01 (Wave 1 — assumed shipped):

```typescript
useLazyPanelMetrics<T>(panelId: "panel4"|"panel5"|"panel6"|"panel7", opts: {
  fetchOnIntersect?: boolean;
  strategyId?: string;
}): { ref; data: T | null; status };
```

From 14b-04 (Wave 2 prereq):

```typescript
// src/components/strategy-v2/MetricCell.tsx
export function MetricCell({ label, value, negative }: {
  label: string;
  value: string | null;
  negative?: boolean;
}): JSX.Element;
```

Panel 7 lazy-fetched payload (from migration 087 exposure mapping per src/lib/queries.ts:439):

```typescript
type Panel7LazyPayload = {
  exposure_series?: { date: string; gross: number; net: number }[];
  turnover_series?: { date: string; value: number }[];
};
```

(Per Plan 12-04 SUMMARY: `compute_exposure_metrics` emits `exposure_series: [{date, gross, net}]`; `compute_turnover_series` emits `[{date, value}]` where value = abs(Δposition × price) / NAV.)

**Migration 087 panel-id → kinds map (verified 2026-04-29 — Grok B-03):**

```sql
-- supabase/migrations/087_strategy_analytics_series.sql lines 162-176
WHEN 'overview'     THEN ARRAY[]::TEXT[]
WHEN 'equity'       THEN ARRAY['log_returns_series']     -- valid; used by Panel 2 Log Returns (Plan 14b-06 Task 3)
WHEN 'drawdown'     THEN ARRAY[]::TEXT[]
WHEN 'returns_dist' THEN ARRAY['daily_returns_grid']     -- Plan 14b-02
WHEN 'rolling'      THEN ARRAY['rolling_sortino_3m', ..., 'rolling_alpha', 'rolling_beta']  -- Plan 14b-03
WHEN 'trades'       THEN ARRAY[]::TEXT[]                 -- Plan 14b-04 (Grok B-04: panel6 sets fetchOnIntersect:false)
WHEN 'exposure'     THEN ARRAY['exposure_series', 'turnover_series']  -- this plan
ELSE ARRAY[]::TEXT[]
```

Plan 14b-05 fetches `panelId='panel7'` (which the hook maps via PANEL_TO_ID to `'exposure'`). The 'equity' panel-id is fetched ONLY by Plan 14b-06's Panel 2 Log Returns toggle, via a direct call to `fetchStrategyLazyMetrics(strategyId, 'equity')` (NOT via this hook). No change required in plan 14b-05.

Eager scalars from getStrategyDetailV2's analytics blob (`metrics_json`):
- `analytics.metrics_json.benchmark_returns` → for CorrelationWithBenchmark
- `analytics.returns_series` → for CorrelationWithBenchmark
- Greeks scalars live at the top level of `metrics_json` per `metrics.py:255-267`:
  - `alpha: number | null`
  - `beta: number | null`
  - `information_ratio: number | null` (or `ir`)
  - `treynor_ratio: number | null` (or `treynor`)

The 14b ExposureAndGreeksPanel must accept these scalars as props.

Existing CorrelationWithBenchmark interface (src/components/charts/CorrelationWithBenchmark.tsx — Phase 09.1):

```typescript
// Reads: analytics with returns_series + metrics_json.benchmark_returns
// + metrics_json.btc_rolling_correlation_90d (precomputed) OR computes inline.
// Empty-state copy: "Insufficient data — 90 days needed, {N} days so far."
// (existing copy — reused per UI-SPEC §4.3 Panel 7 sub-section banner)
interface Props {
  analytics: { ... }; // existing shape — see file
}
```

The wrapper passes through the analytics blob. To stay on the existing contract, ExposureAndGreeksPanel composes a subset of analytics fields into the shape CorrelationWithBenchmark expects.

From chart-tokens.ts:
- CHART_ACCENT = "#1B6B5A"
- CHART_BORDER = "#E2E8F0"
- CHART_REFERENCE_DASH = "3 3"
- CHART_TEXT_MUTED = "#94A3B8"
- CHART_TICK_STYLE = { fontFamily, fontSize: 12, fontVariantNumeric: "tabular-nums", fill: "#64748B" }
- CHART_TOOLTIP_STYLE = { ... }

Per UI-SPEC §4.3 partial-data thresholds for Panel 7:
- Panel-level: history_days < 30 → "Awaiting more data" + "needs at least 30 days of trading history to compute exposure and benchmark greeks."
- Sub Correlation: history_days < 90 → reuse existing CorrelationWithBenchmark empty-state copy (preserved).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Ship NetGrossExposureChart + TurnoverChart components</name>
  <files>src/components/charts/NetGrossExposureChart.tsx, src/components/charts/NetGrossExposureChart.test.tsx, src/components/charts/TurnoverChart.tsx, src/components/charts/TurnoverChart.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.4 (full Panel 7 spec — NetGrossExposureChart and TurnoverChart specifics)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §5 (color tokens — gross fill at opacity 0.2 over CHART_ACCENT; net solid CHART_ACCENT line)
    - src/components/charts/chart-tokens.ts (full token export)
    - src/components/charts/RollingMetrics.tsx (Recharts shape precedent)
  </read_first>
  <behavior>
    - Test 1 (NetGrossExposureChart shape): With `data: [{date:'2024-01-01',gross:0.8,net:0.5},...]`, renders Recharts `<ComposedChart>` with one `<Area>` and one `<Line>`. Returns `null` when data empty.
    - Test 2 (NetGrossExposureChart fills): The Area's `fill` is `#1B6B5A` (CHART_ACCENT) with `fillOpacity={0.2}`. The Line's `stroke` is `#1B6B5A` with `strokeWidth={1.5}`.
    - Test 3 (NetGrossExposureChart reference line): Renders `<ReferenceLine y={0}>` with `stroke=CHART_TEXT_MUTED` + `strokeDasharray=CHART_REFERENCE_DASH`.
    - Test 4 (NetGrossExposureChart axes + height): Wrapper renders inside `<ResponsiveContainer width="100%" height={240}>`. Both XAxis and YAxis spread `CHART_TICK_STYLE`.
    - Test 5 (NetGrossExposureChart accessibility): Outer wrapper has `role="img" aria-label="Net and gross exposure over time"`.
    - Test 6 (NetGrossExposureChart legend): Renders `<Legend>` with two entries labelled `Gross` / `Net` (sentence-case).
    - Test 7 (TurnoverChart shape): With `data: [{date,value},...]`, renders `<LineChart>` with one `<Line>`. Returns `null` when data empty.
    - Test 8 (TurnoverChart styling): Line `stroke=CHART_ACCENT` `strokeWidth={1.5}`. Wrapper height=200. Both axes spread `CHART_TICK_STYLE`. Y-axis tickFormatter formats as percent with 1 decimal: `(v) => v.toFixed(1) + '%'`.
    - Test 9 (TurnoverChart accessibility): Outer wrapper has `role="img" aria-label="Daily turnover as percent of NAV"`.
    - Test 10 (no inline tick objects in either): `grep -cE "tick=\\{\\{.*fontSize" src/components/charts/{NetGrossExposureChart,TurnoverChart}.tsx` returns 0.
  </behavior>
  <action>
    **A. src/components/charts/NetGrossExposureChart.tsx:**

    ```typescript
    "use client";

    import {
      Area,
      ComposedChart,
      Legend,
      Line,
      ReferenceLine,
      ResponsiveContainer,
      Tooltip,
      XAxis,
      YAxis,
    } from "recharts";
    import {
      CHART_ACCENT,
      CHART_BORDER,
      CHART_REFERENCE_DASH,
      CHART_TEXT_MUTED,
      CHART_TICK_STYLE,
      CHART_TOOLTIP_STYLE,
    } from "./chart-tokens";

    interface NetGrossExposureChartProps {
      data: { date: string; gross: number; net: number }[];
    }

    export function NetGrossExposureChart({ data }: NetGrossExposureChartProps) {
      if (!data || data.length === 0) return null;
      return (
        <div role="img" aria-label="Net and gross exposure over time">
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="date"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={{ stroke: CHART_BORDER }}
                tickFormatter={(d: string) => d.slice(5)}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, String(name)]}
              />
              <Legend />
              <ReferenceLine
                y={0}
                stroke={CHART_TEXT_MUTED}
                strokeDasharray={CHART_REFERENCE_DASH}
              />
              <Area
                type="monotone"
                dataKey="gross"
                name="Gross"
                fill={CHART_ACCENT}
                fillOpacity={0.2}
                stroke="none"
              />
              <Line
                type="monotone"
                dataKey="net"
                name="Net"
                stroke={CHART_ACCENT}
                strokeWidth={1.5}
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      );
    }
    ```

    **B. src/components/charts/TurnoverChart.tsx:**

    ```typescript
    "use client";

    import {
      Line,
      LineChart,
      ResponsiveContainer,
      Tooltip,
      XAxis,
      YAxis,
    } from "recharts";
    import {
      CHART_ACCENT,
      CHART_BORDER,
      CHART_TICK_STYLE,
      CHART_TOOLTIP_STYLE,
    } from "./chart-tokens";

    interface TurnoverChartProps {
      data: { date: string; value: number }[];
    }

    export function TurnoverChart({ data }: TurnoverChartProps) {
      if (!data || data.length === 0) return null;
      return (
        <div role="img" aria-label="Daily turnover as percent of NAV">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={data} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="date"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={{ stroke: CHART_BORDER }}
                tickFormatter={(d: string) => d.slice(5)}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => `${(v * 100).toFixed(1)}%`}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Turnover"]}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={CHART_ACCENT}
                strokeWidth={1.5}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }
    ```

    Test files (`*.test.tsx`) for both. Mock Recharts ResponsiveContainer the same way as 14b-03 Task 1 (vi.mock pattern).

    Concrete data assumption: `value` and `gross/net` are decimal fractions (e.g. `0.21` = 21%). Phase 12 METRICS-05 / METRICS-06 / METRICS-19 documentation in 12-04-SUMMARY confirms this — `turnover = sum_over_symbols(abs(delta * price)) / nav` is dimensionless.
  </action>
  <verify>
    <automated>npm test -- src/components/charts/NetGrossExposureChart.test.tsx src/components/charts/TurnoverChart.test.tsx --run</automated>
  </verify>
  <done>
    - Both test files pass.
    - `grep -c "ComposedChart" src/components/charts/NetGrossExposureChart.tsx` ≥ 1.
    - `grep -c "ReferenceLine" src/components/charts/NetGrossExposureChart.tsx` ≥ 1.
    - `grep -c "fillOpacity={0.2}" src/components/charts/NetGrossExposureChart.tsx` returns 1.
    - `grep -c "role=\"img\"" src/components/charts/{NetGrossExposureChart,TurnoverChart}.tsx` returns 2 (1 each).
    - `grep -cE "tick=\\{\\{.*fontSize" src/components/charts/{NetGrossExposureChart,TurnoverChart}.tsx` returns 0.
    - `npx tsc --noEmit` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship BenchmarkGreeksTable + ExposureAndGreeksPanel wrapper</name>
  <files>src/components/strategy-v2/BenchmarkGreeksTable.tsx, src/components/strategy-v2/BenchmarkGreeksTable.test.tsx, src/components/strategy-v2/ExposureAndGreeksPanel.tsx, src/components/strategy-v2/ExposureAndGreeksPanel.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.4 (full Panel 7 layout)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §10.4 (Greek-letter cell labels — lowercase: alpha / beta / IR / Treynor)
    - src/components/strategy-v2/MetricCell.tsx (post 14b-04)
    - src/components/charts/CorrelationWithBenchmark.tsx (existing reusable component — read to understand `analytics` prop shape)
    - src/components/strategy-v2/PartialDataBanner.tsx (reused)
  </read_first>
  <behavior>
    - Test 1 (BenchmarkGreeksTable 4 cells): With `{ alpha: 0.05, beta: 1.2, ir: 0.8, treynor: 0.04 }`, renders 4 MetricCells in a `grid-cols-4 gap-3` container. Labels exactly: `alpha`, `beta`, `IR`, `Treynor` (case-sensitive — alpha/beta lowercase Greek convention; IR uppercase acronym; Treynor title-case proper noun).
    - Test 2 (BenchmarkGreeksTable formatting): Values render to 3 decimals via `toFixed(3)`. e.g. alpha=0.05 → "0.050".
    - Test 3 (BenchmarkGreeksTable null values): When alpha is null, that cell renders em-dash via MetricCell.
    - Test 4 (BenchmarkGreeksTable negative styling): When alpha < 0, that MetricCell receives `negative={true}` (verified via prop assertion on MetricCell mock).
    - Test 5 (ExposureAndGreeksPanel chrome): Renders `<section data-panel="exposure" data-panel-status="..." aria-label="Exposure & benchmark greeks">` with 14a panel chrome.
    - Test 6 (ExposureAndGreeksPanel panel-level partial data): With `history_days={20}`, renders panel-level banner: heading "Awaiting more data" body "This strategy needs at least 30 days of trading history to compute exposure and benchmark greeks." NO sub-components.
    - Test 7 (ExposureAndGreeksPanel ready full): With status='ready' + history_days=365 + lazy data has `exposure_series` + `turnover_series` + analytics has correlation data + greeks scalars present, all 4 sub-sections render in order: H3 `Net & gross exposure` → NetGrossExposureChart; H3 `Turnover` → TurnoverChart; H3 `Correlation with BTC` → CorrelationWithBenchmark; H3 `Benchmark greeks` → BenchmarkGreeksTable.
    - Test 8 (ExposureAndGreeksPanel sub-section empty fallbacks): When `exposure_series` is empty/undefined but other sections have data, renders `<p>Net & gross exposure unavailable for this strategy.</p>` instead of the chart, while OTHER sections still render. Same pattern for empty turnover_series.
    - Test 9 (ExposureAndGreeksPanel lifecycle): status='loading' → centered "Loading…"; status='error' → error PartialDataBanner.
    - Test 10 (no forbidden classes): No `font-medium`, `text-sm`, `text-xl`, `text-2xl`.
    - Test 11 (lazy hook fires): `useLazyPanelMetrics("panel7", { fetchOnIntersect: true, strategyId })` invoked.
  </behavior>
  <action>
    **A. src/components/strategy-v2/BenchmarkGreeksTable.tsx:**

    ```typescript
    import { MetricCell } from "./MetricCell";

    interface BenchmarkGreeksTableProps {
      alpha: number | null;
      beta: number | null;
      ir: number | null;
      treynor: number | null;
    }

    function fmt(v: number | null): string | null {
      if (v == null || !Number.isFinite(v)) return null;
      return v.toFixed(3);
    }

    export function BenchmarkGreeksTable({ alpha, beta, ir, treynor }: BenchmarkGreeksTableProps) {
      return (
        <div className="grid grid-cols-4 gap-3">
          <MetricCell label="alpha" value={fmt(alpha)} negative={(alpha ?? 0) < 0} />
          <MetricCell label="beta" value={fmt(beta)} negative={(beta ?? 0) < 0} />
          <MetricCell label="IR" value={fmt(ir)} />
          <MetricCell label="Treynor" value={fmt(treynor)} negative={(treynor ?? 0) < 0} />
        </div>
      );
    }
    ```

    Concrete value: labels MUST be exactly `alpha` / `beta` / `IR` / `Treynor` per UI-SPEC §10.4 (case-sensitive).

    **B. src/components/strategy-v2/ExposureAndGreeksPanel.tsx:**

    ```typescript
    "use client";

    import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
    import { PartialDataBanner } from "./PartialDataBanner";
    import { BenchmarkGreeksTable } from "./BenchmarkGreeksTable";
    import { NetGrossExposureChart } from "@/components/charts/NetGrossExposureChart";
    import { TurnoverChart } from "@/components/charts/TurnoverChart";
    import { CorrelationWithBenchmark } from "@/components/charts/CorrelationWithBenchmark";

    /**
     * Subset of the analytics blob CorrelationWithBenchmark expects. Maps the
     * Phase 14b panel input shape to the existing component's contract without
     * forking. See src/components/charts/CorrelationWithBenchmark.tsx for the
     * full required shape; this panel only forwards what's needed for rolling 90d.
     */
    interface CorrelationAnalyticsSubset {
      returns_series: { date: string; value: number }[] | null;
      metrics_json: Record<string, unknown> | null;
    }

    interface ExposureAndGreeksPanelProps {
      strategyId: string;
      history_days: number;
      benchmark_greeks: {
        alpha: number | null;
        beta: number | null;
        ir: number | null;
        treynor: number | null;
      };
      correlation_analytics: CorrelationAnalyticsSubset;
    }

    interface Panel7LazyPayload {
      exposure_series?: { date: string; gross: number; net: number }[];
      turnover_series?: { date: string; value: number }[];
    }

    export function ExposureAndGreeksPanel(props: ExposureAndGreeksPanelProps) {
      const { ref, data, status } = useLazyPanelMetrics<Panel7LazyPayload>("panel7", {
        fetchOnIntersect: true,
        strategyId: props.strategyId,
      });

      const panelLevelGated = props.history_days < 30;

      return (
        <section
          ref={ref}
          data-panel="exposure"
          data-panel-status={status === "idle" ? "placeholder" : status}
          aria-label="Exposure & benchmark greeks"
          className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
        >
          <h2 className="text-base font-semibold text-text-primary">
            Exposure &amp; benchmark greeks
          </h2>

          {panelLevelGated ? (
            <div className="mt-4">
              <PartialDataBanner
                heading="Awaiting more data"
                body="This strategy needs at least 30 days of trading history to compute exposure and benchmark greeks."
              />
            </div>
          ) : status === "idle" || status === "loading" ? (
            <div
              aria-live="polite"
              className="mt-4 flex items-center justify-center text-xs font-normal text-text-muted"
              style={{ minHeight: 180 }}
            >
              {"Loading…"}
            </div>
          ) : status === "error" ? (
            <div className="mt-4">
              <PartialDataBanner
                heading="Couldn't load this section"
                body="Refresh the page to retry. The other panels still work."
              />
            </div>
          ) : (
            <div className="mt-4 space-y-6">
              <SubSection title="Net & gross exposure">
                {data?.exposure_series && data.exposure_series.length > 0 ? (
                  <NetGrossExposureChart data={data.exposure_series} />
                ) : (
                  <SubBanner body="Net & gross exposure unavailable for this strategy." />
                )}
              </SubSection>

              <SubSection title="Turnover">
                {data?.turnover_series && data.turnover_series.length > 0 ? (
                  <TurnoverChart data={data.turnover_series} />
                ) : (
                  <SubBanner body="Turnover unavailable for this strategy." />
                )}
              </SubSection>

              <SubSection title="Correlation with BTC">
                <CorrelationWithBenchmark
                  analytics={props.correlation_analytics as never}
                />
              </SubSection>

              <SubSection title="Benchmark greeks">
                <BenchmarkGreeksTable
                  alpha={props.benchmark_greeks.alpha}
                  beta={props.benchmark_greeks.beta}
                  ir={props.benchmark_greeks.ir}
                  treynor={props.benchmark_greeks.treynor}
                />
              </SubSection>
            </div>
          )}
        </section>
      );
    }

    function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
      return (
        <div>
          <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
            {title}
          </h3>
          {children}
        </div>
      );
    }

    function SubBanner({ body }: { body: string }) {
      return <p className="text-xs font-normal text-text-muted">{body}</p>;
    }
    ```

    NOTE on CorrelationWithBenchmark prop typing: The existing component's analytics prop is broadly typed. Use `as never` cast at the call site (per the existing pattern in v1 page.tsx) to avoid blocking the build on shape mismatch — IF and only if the existing prop shape is too narrow. Executor MUST first inspect the existing component's actual prop interface and pass the matching subset. If the existing component expects more fields, extend `CorrelationAnalyticsSubset` accordingly. Do NOT modify CorrelationWithBenchmark itself.

    Concrete values to keep stable:
    - `data-panel="exposure"`
    - H2: `Exposure & benchmark greeks` (with `&amp;` entity)
    - H3 sub-section labels (verbatim): `Net & gross exposure`, `Turnover`, `Correlation with BTC`, `Benchmark greeks`
    - Panel-level banner body: `This strategy needs at least 30 days of trading history to compute exposure and benchmark greeks.` (verbatim)
    - Sub-banner copy: `Net & gross exposure unavailable for this strategy.` / `Turnover unavailable for this strategy.`

    Create both test files covering all 11 behaviours.
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/ExposureAndGreeksPanel.test.tsx src/components/strategy-v2/BenchmarkGreeksTable.test.tsx --run</automated>
  </verify>
  <done>
    - Both test files pass.
    - `grep -c "data-panel=\"exposure\"" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` returns 1.
    - `grep -c "useLazyPanelMetrics<Panel7LazyPayload>(\"panel7\"" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` returns 1.
    - `grep -c "fetchOnIntersect: true" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` returns 1.
    - `grep -c "NetGrossExposureChart" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` ≥ 2.
    - `grep -c "TurnoverChart" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` ≥ 2.
    - `grep -c "CorrelationWithBenchmark" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` ≥ 2.
    - `grep -c "BenchmarkGreeksTable" src/components/strategy-v2/ExposureAndGreeksPanel.tsx` ≥ 2.
    - `grep -c "MetricCell" src/components/strategy-v2/BenchmarkGreeksTable.tsx` ≥ 4.
    - `grep -cE "(font-medium|text-sm|text-xl|text-2xl)" src/components/strategy-v2/{ExposureAndGreeksPanel,BenchmarkGreeksTable}.tsx` returns 0.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npm test -- src/components/strategy-v2/{ExposureAndGreeksPanel,BenchmarkGreeksTable}.test.tsx src/components/charts/{NetGrossExposureChart,TurnoverChart}.test.tsx --run` all green.
- `grep -rn "ExposureAndGreeksPanel\\|BenchmarkGreeksTable\\|NetGrossExposureChart\\|TurnoverChart" src/components/strategy-v2/StrategyV2Shell.tsx` returns 0 (NOT yet wired — that's 14b-06).
- CorrelationWithBenchmark unmodified (`grep -c "CorrelationWithBenchmark" src/components/charts/CorrelationWithBenchmark.tsx` count unchanged).
- **Grok B-03 verification**: `grep -c "WHEN 'equity'" supabase/migrations/087_strategy_analytics_series.sql` returns 1 — confirms migration 087's CASE statement supports the 'equity' panelId. Plan 14b-06 leverages this for Panel 2 Log Returns; Plan 14b-05 does NOT use 'equity'.
</verification>

<success_criteria>
- KPI-18 (Net + Gross Exposure series), KPI-19 (Turnover series), KPI-20 (Correlation with BTC), KPI-21 (Benchmark Greeks) all rendered.
- KPI-23b Panel 7 partial-data: panel-level <30d banner; per-sub-section empty fallbacks for exposure/turnover.
- BenchmarkGreeksTable composes MetricCell from 14b-04 — no duplicated styling code.
- **Grok B-03 clarified: 'equity' panelId IS supported by migration 087 (line 165). Plan 14b-06 (not this plan) consumes it for Panel 2 Log Returns. Plan 14b-05 fetches `panel7` only.**
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-05-SUMMARY.md` documenting the 4 new components, the CorrelationWithBenchmark passthrough strategy, the migration 087 panel-id verification (Grok B-03), and any deviations.
</output>
