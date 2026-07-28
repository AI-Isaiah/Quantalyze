---
phase: 14b
plan: 03
type: execute
wave: 2
depends_on: [14b-01]
files_modified:
  - src/components/strategy-v2/RollingMetricsPanel.tsx
  - src/components/strategy-v2/RollingMetricsPanel.test.tsx
  - src/components/charts/RollingVolatilityChart.tsx
  - src/components/charts/RollingVolatilityChart.test.tsx
  - src/components/charts/RollingSortinoChart.tsx
  - src/components/charts/RollingSortinoChart.test.tsx
  - src/components/charts/RollingAlphaBetaChart.tsx
  - src/components/charts/RollingAlphaBetaChart.test.tsx
autonomous: true
requirements: [KPI-08, KPI-09, KPI-10, KPI-11, KPI-23b]
requirements_addressed: [KPI-08, KPI-09, KPI-10, KPI-11, KPI-23b]
tags: [strategy-v2, panel-5, rolling-metrics, segmented-control, partial-data]
must_haves:
  truths:
    - "Panel 5 mounts <RollingMetricsPanel /> with shared 3M/6M/12M segmented-control window toggle (default 6M)"
    - "Window toggle drives all 4 sub-charts (Rolling Sharpe / Vol / Sortino / α+β) via window prop"
    - "Panel 5 lazy-fetches via useLazyPanelMetrics({ fetchOnIntersect: true, strategyId, panelId: 'panel5' })"
    - "Per-window partial-data sub-banners trigger when history_days < {90,180,365} for the {3M,6M,12M} button"
    - "Rolling Sharpe sub-chart reuses existing RollingMetrics with the closest-available persisted window key (sharpe_90d for 3M, sharpe_90d-as-6M-approximation, sharpe_365d for 12M) per Grok B-01 — Phase 12 metrics.py only ships {sharpe_30d, sharpe_90d, sharpe_365d}"
    - "Rolling Volatility sub-chart is NEW: single CHART_ACCENT line, CHART_TICK_STYLE axes"
    - "Rolling Sortino sub-chart is NEW: single CHART_ACCENT line, CHART_TICK_STYLE axes"
    - "Rolling Alpha & Beta sub-chart is NEW: 2 lines (alpha solid CHART_ACCENT, beta dashed CHART_TEXT_MUTED + strokeDasharray=CHART_REFERENCE_DASH)"
  artifacts:
    - path: "src/components/strategy-v2/RollingMetricsPanel.tsx"
      provides: "Wrapper component for Panel 5 — owns window state, mounts 4 rolling sub-charts"
      exports: ["RollingMetricsPanel"]
    - path: "src/components/charts/RollingVolatilityChart.tsx"
      provides: "Single-line Recharts wrapper consuming { date, value }[] series"
      exports: ["RollingVolatilityChart"]
    - path: "src/components/charts/RollingSortinoChart.tsx"
      provides: "Single-line Recharts wrapper, identical pattern to Vol"
      exports: ["RollingSortinoChart"]
    - path: "src/components/charts/RollingAlphaBetaChart.tsx"
      provides: "Two-line chart (alpha+beta) with legend"
      exports: ["RollingAlphaBetaChart"]
  key_links:
    - from: "src/components/strategy-v2/RollingMetricsPanel.tsx"
      to: "src/components/strategy-v2/SegmentedControl.tsx"
      via: "import + render"
      pattern: "SegmentedControl"
    - from: "src/components/strategy-v2/RollingMetricsPanel.tsx"
      to: "src/hooks/useLazyPanelMetrics.ts"
      via: "useLazyPanelMetrics(\"panel5\", ...)"
      pattern: "useLazyPanelMetrics<.*>\\(\"panel5\""
---

<objective>
Ship Panel 5 — Rolling metrics. Single shared 3M/6M/12M segmented-control window toggle drives 4 stacked sub-charts: Rolling Sharpe (existing `<RollingMetrics>` reused with the closest-available persisted window key), Rolling Volatility (NEW), Rolling Sortino (NEW), Rolling Alpha & Beta (NEW). Per-window partial-data sub-banners disable rendering of the chart body when history_days < threshold for that window. Lazy-fetches via Wave-1 hook.

Purpose: KPI-08 / KPI-09 / KPI-10 / KPI-11 + Panel 5 portion of KPI-23b.
Output: 1 panel wrapper + 3 new chart components + 4 test files. NOT yet mounted in StrategyV2Shell (that's 14b-06).

**Revision (2026-04-29 Grok B-01):** Phase 12 metrics.py persists rolling Sharpe at windows {30, 90, 365} ONLY (verified at `analytics-service/services/metrics.py:145-147`). The original plan's `pickSharpeForWindow` mapped 6M → `sharpe_180d`, which does not exist — silent empty render on the default-active window. CONTEXT.md locks the user-facing toggle labels to 3M/6M/12M (UI-SPEC §3.2). Adding a 180d backend window is out of scope (Python service untouched per CONTEXT). Resolution: pick the closest existing key per window with explicit fallbacks documented in code; user-facing copy explains the approximation only when the data shape requires it. Mapping:

| Toggle | Conceptual window | Persisted key (Phase 12) | Fallback if absent |
|--------|-------------------|--------------------------|--------------------|
| 3M     | 90d               | `sharpe_90d`             | `sharpe_30d`        |
| 6M     | 180d              | `sharpe_90d` (closest available; 180d does not ship in v0.17.0) | `sharpe_365d` |
| 12M    | 365d              | `sharpe_365d`            | `sharpe_90d`        |

The `pickSharpeForWindow()` helper ALWAYS returns a non-empty series when ANY of the 3 keys is present in `analytics.rolling_metrics`. The 6M button never silently empties.
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
@src/components/charts/RollingMetrics.tsx
@src/components/strategy-v2/SegmentedControl.tsx
@src/components/strategy-v2/PartialDataBanner.tsx
@src/components/strategy-v2/HeadlineMetricsPanel.tsx
@src/lib/types.ts
@analytics-service/services/metrics.py

<interfaces>
<!-- Contracts the executor uses directly. -->

From 14b-01 (Wave 1 — assumed shipped):

```typescript
useLazyPanelMetrics<T>(panelId: "panel4"|"panel5"|"panel6"|"panel7", opts: {
  fetchOnIntersect?: boolean;
  strategyId?: string;
}): { ref; data: T | null; status };
```

Panel 5 lazy-fetched payload (from migration 087 rolling mapping per src/lib/queries.ts:437):

```typescript
// rolling → [rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta]
type Panel5LazyPayload = {
  rolling_sortino_3m?: { date: string; value: number }[];
  rolling_sortino_6m?: { date: string; value: number }[];
  rolling_sortino_12m?: { date: string; value: number }[];
  rolling_volatility_3m?: { date: string; value: number }[];
  rolling_volatility_6m?: { date: string; value: number }[];
  rolling_volatility_12m?: { date: string; value: number }[];
  rolling_alpha?: { date: string; value: number }[];
  rolling_beta?: { date: string; value: number }[];
};
```

Eager Sharpe data — from getStrategyDetailV2's analytics.rolling_metrics blob:

```typescript
// src/lib/types.ts
rolling_metrics: Record<string, { date: string; value: number }[]> | null;
// Verified persisted keys (Phase 12 metrics.py:145-147): sharpe_30d, sharpe_90d, sharpe_365d.
// sharpe_180d is NOT persisted — Grok B-01 verified.
```

Existing RollingMetrics component (Phase 09.1) signature:

```typescript
// src/components/charts/RollingMetrics.tsx
interface RollingMetricsProps {
  data: Record<string, { date: string; value: number }[]>;
  overallSharpe?: number | null;
}
export function RollingMetrics({ data, overallSharpe }): JSX.Element;
// STROKE_BY_KEY only knows the 3 actual persisted keys: sharpe_30d, sharpe_90d, sharpe_365d.
// Pass via one of those keys — falling back to a different key (e.g. "sharpe") would
// render via the default CHART_TEXT_MUTED stroke, NOT the documented CHART_ACCENT.
```

Existing SegmentedControl (Phase 14a) — REUSED:

```typescript
interface SegmentedOption { id: string; label: string; disabled?: boolean; }
interface SegmentedControlProps {
  options: SegmentedOption[];
  activeId: string;
  onChange: (id: string) => void;
  ariaLabel: string;
}
```

Window mapping per Grok B-01 verification (UI-SPEC §3.2 + actual persisted shape):

| Toggle ID | Display label | Threshold (history_days)  | Sharpe key (1st choice) | Sharpe fallback | Vol/Sortino key suffix |
|-----------|---------------|---------------------------|-------------------------|-----------------|------------------------|
| `3M`      | "3M"          | 90                        | `sharpe_90d`            | `sharpe_30d`    | `_3m`                  |
| `6M`      | "6M"          | 180 (default-active)      | `sharpe_90d`            | `sharpe_365d`   | `_6m`                  |
| `12M`     | "12M"         | 365                       | `sharpe_365d`           | `sharpe_90d`    | `_12m`                 |

Note for executors: For Vol / Sortino / α+β, the lazy payload DOES carry per-window keys (`rolling_volatility_6m`, `rolling_sortino_6m`, etc.) per Phase 12 METRICS-02/03. Only the Rolling Sharpe series is sourced from the all-time `rolling_metrics` blob, which lacks a 180d window.

From chart-tokens.ts:
- CHART_ACCENT = "#1B6B5A"
- CHART_TEXT_MUTED = "#94A3B8"
- CHART_BORDER = "#E2E8F0"
- CHART_REFERENCE_DASH = "3 3"
- CHART_TICK_STYLE = { fontFamily: CHART_FONT_MONO, fontSize: 12, fontVariantNumeric: "tabular-nums", fill: CHART_AXIS_TICK }

Per UI-SPEC §4.3 partial-data thresholds for Panel 5:
- Panel-level: history_days < 90 → "Awaiting more data" + "needs at least 90 days of trading history for rolling 3M metrics."
- Window-specific: 6M button shows full chart with sub-banner when history_days < 180; 12M same when < 365.
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Ship 3 new rolling-chart components (Volatility, Sortino, Alpha+Beta)</name>
  <files>src/components/charts/RollingVolatilityChart.tsx, src/components/charts/RollingVolatilityChart.test.tsx, src/components/charts/RollingSortinoChart.tsx, src/components/charts/RollingSortinoChart.test.tsx, src/components/charts/RollingAlphaBetaChart.tsx, src/components/charts/RollingAlphaBetaChart.test.tsx</files>
  <read_first>
    - src/components/charts/RollingMetrics.tsx (Phase 09.1 precedent — Recharts LineChart shape, ResponsiveContainer height=250, axis tick / legend / tooltip wiring; the 3 new charts mirror this shape but with single series for Vol/Sortino, dual for α/β)
    - src/components/charts/chart-tokens.ts (full token export)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.2 (full Panel 5 layout with each sub-chart's contract)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §5 (color tokens for each series)
  </read_first>
  <behavior>
    - Test 1 (Volatility): Renders Recharts `<LineChart>` with one `<Line>` whose `stroke` = `CHART_ACCENT` (`#1B6B5A`) and `strokeWidth` = `1.5`. Empty data array (`data: []`) returns `null`.
    - Test 2 (Volatility axes): Both `<XAxis>` and `<YAxis>` spread `CHART_TICK_STYLE`. `<YAxis tickFormatter>` formats values as percent (e.g. `0.21` → `21%`).
    - Test 3 (Sortino): Identical structure to Volatility — single `<Line>` `stroke=CHART_ACCENT`, `strokeWidth=1.5`. Empty data → `null`.
    - Test 4 (Sortino axes): Both axes spread `CHART_TICK_STYLE`. Y-axis formatter is `(v) => v.toFixed(2)` (Sortino is unitless ratio, NOT percent).
    - Test 5 (AlphaBeta dual lines): Renders two `<Line>` elements. Alpha line: `stroke=CHART_ACCENT`, `strokeWidth=1.5`, NO `strokeDasharray`. Beta line: `stroke=CHART_TEXT_MUTED` (`#94A3B8`), `strokeWidth=1`, `strokeDasharray=CHART_REFERENCE_DASH` (`"3 3"`).
    - Test 6 (AlphaBeta legend): `<Legend>` renders with two entries labelled "alpha" and "beta" (lowercase per UI-SPEC §10.4 Greek-letter convention).
    - Test 7 (AlphaBeta empty): When both alpha and beta arrays are empty, returns `null`. When only one is populated, the other line is omitted (still renders the populated one).
    - Test 8 (no inline tick objects): None of the 3 new files contains the regex `tick=\\{\\{.*fontSize`.
    - Test 9 (height): All 3 charts render inside `<ResponsiveContainer width="100%" height={250}>` matching Phase 09.1 RollingMetrics precedent.
    - Test 10 (svg role): Each chart's outer wrapper carries `role="img"` + `aria-label` matching the chart name (e.g. `aria-label="Rolling volatility"`) — required for axe-core `svg-img-alt` rule.
  </behavior>
  <action>
    Create the three new chart components. They share the same skeleton pattern; differ only in stroke / formatter / line count.

    **A. src/components/charts/RollingVolatilityChart.tsx:**

    ```typescript
    "use client";

    import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
    import {
      CHART_ACCENT,
      CHART_BORDER,
      CHART_TICK_STYLE,
      CHART_TOOLTIP_STYLE,
    } from "./chart-tokens";

    interface RollingVolatilityChartProps {
      data: { date: string; value: number }[];
    }

    export function RollingVolatilityChart({ data }: RollingVolatilityChartProps) {
      if (!data || data.length === 0) return null;
      return (
        <div role="img" aria-label="Rolling volatility">
          <ResponsiveContainer width="100%" height={250}>
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
                tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v) => [`${(Number(v) * 100).toFixed(2)}%`, "Volatility"]}
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

    **B. src/components/charts/RollingSortinoChart.tsx:**

    Identical to Volatility but:
    - `aria-label="Rolling Sortino"`
    - YAxis `tickFormatter={(v: number) => v.toFixed(2)}` (NO `* 100`)
    - Tooltip formatter `(v) => [Number(v).toFixed(2), "Sortino"]`

    **C. src/components/charts/RollingAlphaBetaChart.tsx:**

    ```typescript
    "use client";

    import { useMemo } from "react";
    import { Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
    import {
      CHART_ACCENT,
      CHART_BORDER,
      CHART_REFERENCE_DASH,
      CHART_TEXT_MUTED,
      CHART_TICK_STYLE,
      CHART_TOOLTIP_STYLE,
    } from "./chart-tokens";

    interface RollingAlphaBetaChartProps {
      alpha: { date: string; value: number }[];
      beta: { date: string; value: number }[];
    }

    export function RollingAlphaBetaChart({ alpha, beta }: RollingAlphaBetaChartProps) {
      const merged = useMemo(() => {
        const dateMap = new Map<string, { date: string; alpha?: number; beta?: number }>();
        for (const p of alpha ?? []) {
          if (!dateMap.has(p.date)) dateMap.set(p.date, { date: p.date });
          dateMap.get(p.date)!.alpha = p.value;
        }
        for (const p of beta ?? []) {
          if (!dateMap.has(p.date)) dateMap.set(p.date, { date: p.date });
          dateMap.get(p.date)!.beta = p.value;
        }
        return Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));
      }, [alpha, beta]);

      if (merged.length === 0) return null;
      const hasAlpha = (alpha ?? []).length > 0;
      const hasBeta = (beta ?? []).length > 0;

      return (
        <div role="img" aria-label="Rolling alpha and beta">
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={merged} margin={{ top: 5, right: 5, bottom: 5, left: 5 }}>
              <XAxis
                dataKey="date"
                tick={CHART_TICK_STYLE}
                tickLine={false}
                axisLine={{ stroke: CHART_BORDER }}
                tickFormatter={(d: string) => d.slice(5)}
                interval="preserveStartEnd"
              />
              <YAxis tick={CHART_TICK_STYLE} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE}
                formatter={(v, name) => [Number(v).toFixed(3), String(name)]}
              />
              <Legend />
              {hasAlpha && (
                <Line
                  type="monotone"
                  dataKey="alpha"
                  stroke={CHART_ACCENT}
                  strokeWidth={1.5}
                  dot={false}
                />
              )}
              {hasBeta && (
                <Line
                  type="monotone"
                  dataKey="beta"
                  stroke={CHART_TEXT_MUTED}
                  strokeWidth={1}
                  strokeDasharray={CHART_REFERENCE_DASH}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      );
    }
    ```

    Test files (`*.test.tsx`) cover the 10 behaviours above. Use `@testing-library/react` `render` + Recharts ResponsiveContainer mock from `src/test-setup.ts` — IF the existing test setup does not stub ResponsiveContainer's 0-width rendering, mock it locally:
    ```typescript
    vi.mock("recharts", async () => {
      const actual = await vi.importActual<typeof import("recharts")>("recharts");
      return {
        ...actual,
        ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
          <div style={{ width: 800, height: 250 }}>{children}</div>
        ),
      };
    });
    ```
    Mirror this exact pattern in all 3 test files.
  </action>
  <verify>
    <automated>npm test -- src/components/charts/Rolling --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/charts/RollingVolatilityChart.test.tsx --run` passes.
    - `npm test -- src/components/charts/RollingSortinoChart.test.tsx --run` passes.
    - `npm test -- src/components/charts/RollingAlphaBetaChart.test.tsx --run` passes.
    - `grep -c "CHART_ACCENT" src/components/charts/RollingVolatilityChart.tsx` ≥ 1.
    - `grep -c "CHART_ACCENT" src/components/charts/RollingSortinoChart.tsx` ≥ 1.
    - `grep -c "CHART_REFERENCE_DASH" src/components/charts/RollingAlphaBetaChart.tsx` ≥ 1.
    - `grep -cE "tick=\\{\\{.*fontSize" src/components/charts/Rolling*.tsx` returns 0.
    - `npx tsc --noEmit` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Ship RollingMetricsPanel wrapper with window toggle (Grok B-01 sharpe key fix)</name>
  <files>src/components/strategy-v2/RollingMetricsPanel.tsx, src/components/strategy-v2/RollingMetricsPanel.test.tsx</files>
  <read_first>
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.2 (full Panel 5 layout)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §4.3 (per-window partial-data thresholds)
    - src/components/strategy-v2/HeadlineMetricsPanel.tsx (Phase 14a precedent — uses SegmentedControl + manages active state with useState; this panel mirrors the pattern)
    - src/components/strategy-v2/SegmentedControl.tsx (signature)
    - src/components/charts/RollingMetrics.tsx (existing — accepts `Record<key, series[]>` shape; STROKE_BY_KEY only recognizes sharpe_30d/sharpe_90d/sharpe_365d — DO NOT pass key like "sharpe" or "sharpe_180d" or the line falls back to default muted stroke)
    - analytics-service/services/metrics.py (verify lines 145-147 still produce {sharpe_30d, sharpe_90d, sharpe_365d} only — this is the source-of-truth assertion for Grok B-01)
  </read_first>
  <behavior>
    - Test 1 (chrome): Renders `<section data-panel="rolling" data-panel-status="..." aria-label="Rolling metrics">` with 14a panel chrome classes.
    - Test 2 (panel-level partial data): With `history_days={60}`, renders `<PartialDataBanner heading="Awaiting more data" body="This strategy needs at least 90 days of trading history for rolling 3M metrics." />` and NO sub-charts.
    - Test 3 (default 6M active): With status='ready' + history_days=365, the SegmentedControl renders 3 buttons (3M / 6M / 12M); 6M is `aria-pressed="true"`.
    - Test 4 (window switch updates rendered series): Click "12M". The 4 sub-charts re-render reading `rolling_*_12m` keys (not `_6m`). Default `_6m` data is no longer rendered.
    - **Test 5 (Sharpe key mapping — Grok B-01): With `props.rolling_metrics = { sharpe_30d: [...], sharpe_90d: [...], sharpe_365d: [...] }`:**
      - 3M active → `<RollingMetrics>` receives `data={{ sharpe_90d: <props.rolling_metrics.sharpe_90d> }}`. Verified via `vi.mock("@/components/charts/RollingMetrics")` and asserting the `data` prop's keys.
      - 6M active (default) → `<RollingMetrics>` receives `data={{ sharpe_90d: <props.rolling_metrics.sharpe_90d> }}` (closest available — sharpe_180d does not ship in v0.17.0).
      - 12M active → `<RollingMetrics>` receives `data={{ sharpe_365d: <props.rolling_metrics.sharpe_365d> }}`.
      In ALL three cases, the data passed contains exactly one entry whose key is one of {sharpe_30d, sharpe_90d, sharpe_365d} so RollingMetrics' STROKE_BY_KEY resolves to CHART_ACCENT (or its 30d/90d siblings).
    - **Test 6 (Sharpe fallback chain — Grok B-01): With `props.rolling_metrics = { sharpe_30d: [...] }` only (sparse — only the 30d window persisted), at 3M-active, `<RollingMetrics>` receives `data={{ sharpe_30d: ... }}` via the fallback. Never empty when ANY of the 3 keys exists.**
    - **Test 7 (Sharpe empty when all 3 keys absent): With `props.rolling_metrics = null` OR `{}`, the Rolling Sharpe sub-section renders the gated sub-banner (NOT an empty `<RollingMetrics>`).**
    - Test 8 (window-specific banner): With `history_days=120` and 6M active, the Rolling Sharpe sub-section shows a sub-banner "Awaiting more data — need ≥180 days for 6M rolling window." (covers UI-SPEC §4.3). Other sub-charts at 6M show similar sub-banner.
    - Test 9 (12M sub-banner): With `history_days=200` and 12M active, all 4 sub-charts show sub-banner "Awaiting more data — need ≥365 days for 12M rolling window."
    - Test 10 (no panel-level banner at 90d): With `history_days=100` and 3M active (default would be 6M; flip to 3M), all 4 sub-charts render full because their 3M-window data is available. 6M and 12M buttons remain enabled (per UI-SPEC §3.2 — none disabled) but switching to them shows sub-banners.
    - Test 11 (H3 sub-headings): 4 H3s render in order: `Rolling Sharpe`, `Rolling volatility`, `Rolling Sortino`, `Rolling alpha & beta`, all with `text-xs font-normal uppercase tracking-wider text-text-secondary`.
    - Test 12 (lifecycle copy): When status='loading', renders centered "Loading…" (Unicode U+2026). When status='error', renders error PartialDataBanner.
    - Test 13 (no inline tick objects): Source has zero `tick={{` literal-object spread.
  </behavior>
  <action>
    Create `src/components/strategy-v2/RollingMetricsPanel.tsx`:

    ```typescript
    "use client";

    import { useState } from "react";
    import { useLazyPanelMetrics } from "@/hooks/useLazyPanelMetrics";
    import { SegmentedControl } from "./SegmentedControl";
    import { PartialDataBanner } from "./PartialDataBanner";
    import { RollingMetrics } from "@/components/charts/RollingMetrics";
    import { RollingVolatilityChart } from "@/components/charts/RollingVolatilityChart";
    import { RollingSortinoChart } from "@/components/charts/RollingSortinoChart";
    import { RollingAlphaBetaChart } from "@/components/charts/RollingAlphaBetaChart";

    type WindowId = "3M" | "6M" | "12M";
    const WINDOW_TO_DAYS: Record<WindowId, number> = { "3M": 90, "6M": 180, "12M": 365 };
    const WINDOW_TO_SUFFIX: Record<WindowId, "3m" | "6m" | "12m"> = {
      "3M": "3m", "6M": "6m", "12M": "12m",
    };

    /**
     * Per-window primary + fallback Sharpe keys (Grok B-01 — Phase 12 metrics.py
     * persists ONLY {sharpe_30d, sharpe_90d, sharpe_365d}; sharpe_180d is NOT shipped
     * in v0.17.0). For each toggle, try the primary key first; fall back to the
     * documented secondary if the primary is absent. The Rolling Sharpe sub-section
     * only renders the gated sub-banner if BOTH primary and fallback are absent.
     *
     * 6M maps to sharpe_90d as the closest-available approximation; downstream
     * tooltips / labels still say "6M" because UI-SPEC §3.2 locks the toggle copy.
     * The 180d window is a v0.17.1+ backend item if/when prioritized.
     */
    const SHARPE_KEY_BY_WINDOW: Record<
      WindowId,
      { primary: "sharpe_30d" | "sharpe_90d" | "sharpe_365d";
        fallback: "sharpe_30d" | "sharpe_90d" | "sharpe_365d"; }
    > = {
      "3M":  { primary: "sharpe_90d",  fallback: "sharpe_30d"  },
      "6M":  { primary: "sharpe_90d",  fallback: "sharpe_365d" },
      "12M": { primary: "sharpe_365d", fallback: "sharpe_90d"  },
    };

    interface RollingMetricsPanelProps {
      strategyId: string;
      history_days: number;
      /** Eager Sharpe series from analytics.rolling_metrics; key is sharpe_30d/90d/365d only. */
      rolling_metrics: Record<string, { date: string; value: number }[]> | null;
      /** Eager scalar — overall (all-time) Sharpe for the avg reference line on RollingMetrics. */
      sharpe?: number | null;
    }

    interface Panel5LazyPayload {
      rolling_sortino_3m?: { date: string; value: number }[];
      rolling_sortino_6m?: { date: string; value: number }[];
      rolling_sortino_12m?: { date: string; value: number }[];
      rolling_volatility_3m?: { date: string; value: number }[];
      rolling_volatility_6m?: { date: string; value: number }[];
      rolling_volatility_12m?: { date: string; value: number }[];
      rolling_alpha?: { date: string; value: number }[];
      rolling_beta?: { date: string; value: number }[];
    }

    export function RollingMetricsPanel(props: RollingMetricsPanelProps) {
      const { ref, data, status } = useLazyPanelMetrics<Panel5LazyPayload>("panel5", {
        fetchOnIntersect: true,
        strategyId: props.strategyId,
      });
      const [activeWindow, setActiveWindow] = useState<WindowId>("6M");

      const panelLevelGated = props.history_days < 90;

      return (
        <section
          ref={ref}
          data-panel="rolling"
          data-panel-status={status === "idle" ? "placeholder" : status}
          aria-label="Rolling metrics"
          className="mt-8 min-h-[240px] rounded-lg border border-border bg-surface p-6 shadow-card"
        >
          <h2 className="text-base font-semibold text-text-primary">Rolling metrics</h2>

          {panelLevelGated ? (
            <div className="mt-4">
              <PartialDataBanner
                heading="Awaiting more data"
                body="This strategy needs at least 90 days of trading history for rolling 3M metrics."
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
              <div className="mb-4">
                <SegmentedControl
                  ariaLabel="Rolling window"
                  options={[
                    { id: "3M", label: "3M" },
                    { id: "6M", label: "6M" },
                    { id: "12M", label: "12M" },
                  ]}
                  activeId={activeWindow}
                  onChange={(id) => setActiveWindow(id as WindowId)}
                />
              </div>

              <SubChartSection
                title="Rolling Sharpe"
                gated={
                  props.history_days < WINDOW_TO_DAYS[activeWindow] ||
                  Object.keys(pickSharpeForWindow(props.rolling_metrics, activeWindow)).length === 0
                }
                gatedBody={`Awaiting more data — need ≥${WINDOW_TO_DAYS[activeWindow]} days for ${activeWindow} rolling window.`}
              >
                <RollingMetrics
                  data={pickSharpeForWindow(props.rolling_metrics, activeWindow)}
                  overallSharpe={props.sharpe ?? null}
                />
              </SubChartSection>

              <SubChartSection
                title="Rolling volatility"
                gated={props.history_days < WINDOW_TO_DAYS[activeWindow]}
                gatedBody={`Awaiting more data — need ≥${WINDOW_TO_DAYS[activeWindow]} days for ${activeWindow} rolling window.`}
              >
                <RollingVolatilityChart
                  data={data?.[`rolling_volatility_${WINDOW_TO_SUFFIX[activeWindow]}` as keyof Panel5LazyPayload] as { date: string; value: number }[] ?? []}
                />
              </SubChartSection>

              <SubChartSection
                title="Rolling Sortino"
                gated={props.history_days < WINDOW_TO_DAYS[activeWindow]}
                gatedBody={`Awaiting more data — need ≥${WINDOW_TO_DAYS[activeWindow]} days for ${activeWindow} rolling window.`}
              >
                <RollingSortinoChart
                  data={data?.[`rolling_sortino_${WINDOW_TO_SUFFIX[activeWindow]}` as keyof Panel5LazyPayload] as { date: string; value: number }[] ?? []}
                />
              </SubChartSection>

              <SubChartSection
                title="Rolling alpha & beta"
                gated={false /* alpha/beta are NOT window-segmented in 087 mapping */}
                gatedBody=""
              >
                <RollingAlphaBetaChart
                  alpha={data?.rolling_alpha ?? []}
                  beta={data?.rolling_beta ?? []}
                />
              </SubChartSection>
            </div>
          )}
        </section>
      );
    }

    /**
     * Grok B-01 — Pick the closest-available persisted Sharpe key for the
     * selected toggle window. Phase 12 metrics.py emits {sharpe_30d, sharpe_90d,
     * sharpe_365d} ONLY (verified at metrics.py:145-147). Returns an empty
     * object iff NONE of the 3 known keys is populated, in which case the
     * caller renders the gated sub-banner.
     *
     * The returned shape is `{ sharpe_30d|sharpe_90d|sharpe_365d: series }` so
     * downstream <RollingMetrics> resolves the line stroke via STROKE_BY_KEY.
     * Never use a key like "sharpe" or "sharpe_180d" — STROKE_BY_KEY would
     * default to CHART_TEXT_MUTED instead of CHART_ACCENT.
     */
    function pickSharpeForWindow(
      rolling: Record<string, { date: string; value: number }[]> | null,
      win: WindowId,
    ): Record<string, { date: string; value: number }[]> {
      if (!rolling) return {};
      const { primary, fallback } = SHARPE_KEY_BY_WINDOW[win];
      if (Array.isArray(rolling[primary]) && rolling[primary].length > 0) {
        return { [primary]: rolling[primary] };
      }
      if (Array.isArray(rolling[fallback]) && rolling[fallback].length > 0) {
        return { [fallback]: rolling[fallback] };
      }
      return {};
    }

    function SubChartSection({
      title, gated, gatedBody, children,
    }: { title: string; gated: boolean; gatedBody: string; children: React.ReactNode }) {
      return (
        <div>
          <h3 className="mb-4 text-xs font-normal uppercase tracking-wider text-text-secondary">
            {title}
          </h3>
          {gated ? (
            <p className="text-xs font-normal text-text-muted">{gatedBody}</p>
          ) : (
            children
          )}
        </div>
      );
    }
    ```

    Concrete values to keep stable:
    - `data-panel="rolling"`
    - H2: `Rolling metrics`
    - Panel-level banner body: `This strategy needs at least 90 days of trading history for rolling 3M metrics.` (verbatim)
    - Sub-banner template: `Awaiting more data — need ≥{N} days for {W} rolling window.` (with em-dash and ≥ unicode chars)
    - Default activeWindow = `"6M"`
    - SegmentedControl ariaLabel = `"Rolling window"`
    - **`SHARPE_KEY_BY_WINDOW` constant — exact mapping per Grok B-01.**

    Create `src/components/strategy-v2/RollingMetricsPanel.test.tsx` covering the 13 behaviours. Use `vi.mock("@/hooks/useLazyPanelMetrics")` to drive `status` / `data`. Use `vi.mock("@/components/charts/RollingMetrics")` to inspect the `data` prop keys for tests 5/6/7. For the segmented-control click test, use `@testing-library/user-event` `userEvent.setup().click(button)`.
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/RollingMetricsPanel.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/strategy-v2/RollingMetricsPanel.test.tsx --run` passes 13/13.
    - `grep -c "data-panel=\"rolling\"" src/components/strategy-v2/RollingMetricsPanel.tsx` returns 1.
    - `grep -c "useLazyPanelMetrics<Panel5LazyPayload>(\"panel5\"" src/components/strategy-v2/RollingMetricsPanel.tsx` returns 1.
    - `grep -c "fetchOnIntersect: true" src/components/strategy-v2/RollingMetricsPanel.tsx` returns 1.
    - `grep -c "SegmentedControl" src/components/strategy-v2/RollingMetricsPanel.tsx` ≥ 2 (import + render).
    - **`grep -c "SHARPE_KEY_BY_WINDOW" src/components/strategy-v2/RollingMetricsPanel.tsx` ≥ 2 (definition + usage in pickSharpeForWindow) — Grok B-01.**
    - **`grep -c "sharpe_180d" src/components/strategy-v2/RollingMetricsPanel.tsx` returns 0 (forbidden — non-existent key).**
    - **`grep -c "sharpe_90d\\|sharpe_30d\\|sharpe_365d" src/components/strategy-v2/RollingMetricsPanel.tsx` ≥ 3 (all three persisted keys reachable in the mapping).**
    - `grep -cE "tick=\\{\\{.*fontSize" src/components/strategy-v2/RollingMetricsPanel.tsx` returns 0.
    - `grep -cE "(font-medium|text-sm|text-xl|text-2xl)" src/components/strategy-v2/RollingMetricsPanel.tsx` returns 0.
    - `npx tsc --noEmit` exits 0.
    - `npm run build` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npm test -- src/components/charts/Rolling src/components/strategy-v2/RollingMetricsPanel.test.tsx --run` all green.
- `grep -rn "RollingVolatilityChart\\|RollingSortinoChart\\|RollingAlphaBetaChart\\|RollingMetricsPanel" src/components/strategy-v2/StrategyV2Shell.tsx` returns 0 (NOT yet wired — that's 14b-06).
- `grep -rn "sharpe_180d" src/components/strategy-v2/ src/components/charts/` returns 0 (Grok B-01 — non-existent backend key never referenced).
- `npm test -- src/components --run` (full component sweep) green; existing 14a tests unaffected.
</verification>

<success_criteria>
- KPI-08 (Rolling Sharpe), KPI-09 (Rolling Volatility), KPI-10 (Rolling Sortino), KPI-11 (Rolling Alpha+Beta) panel bodies shipped.
- Single shared SegmentedControl drives all 4 sub-charts via window state (default 6M).
- KPI-23b Panel 5 partial-data: panel-level <90d banner; per-window sub-banners on threshold violations.
- **Grok B-01 mitigation: 6M default-active button no longer maps to a non-existent `sharpe_180d` key. The closest-available persisted key chain (sharpe_90d primary, sharpe_365d fallback) is used; gated sub-banner only renders when ALL 3 known keys are absent.**
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-03-SUMMARY.md` documenting the 4 new components, the window→suffix mapping, the SHARPE_KEY_BY_WINDOW table (Grok B-01), and any deviations.
</output>
