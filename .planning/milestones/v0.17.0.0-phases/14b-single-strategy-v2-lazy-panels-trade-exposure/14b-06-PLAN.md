---
phase: 14b
plan: 06
type: execute
wave: 3
depends_on: [14b-02, 14b-03, 14b-04, 14b-05]
files_modified:
  - src/lib/queries.ts
  - src/components/strategy-v2/StrategyV2Shell.tsx
  - src/components/strategy-v2/StrategyV2Shell.test.tsx
  - src/components/strategy-v2/HeadlineMetricsPanel.tsx
  - src/components/strategy-v2/HeadlineMetricsPanel.test.tsx
autonomous: true
requirements: [KPI-08, KPI-22, KPI-23b]
requirements_addressed: [KPI-08, KPI-22, KPI-23b]
tags: [strategy-v2, integration, panel-2-unlock, shell-wiring]
must_haves:
  truths:
    - "StrategyV2Shell mounts the 4 lazy panel bodies (ReturnsDistributionPanel / RollingMetricsPanel / TradeAndPositionPanel / ExposureAndGreeksPanel) in place of LazyPanelPlaceholder"
    - "StrategyV2Shell still renders exactly 7 <section data-panel> elements (KPI-22 invariant preserved)"
    - "Panel 2 segmented control un-disables Rolling Sharpe AND Log returns (4 buttons all enabled)"
    - "Rolling Sharpe button mounts <RollingMetrics /> with eager rolling_metrics from analytics blob"
    - "Log returns button mounts <EquityCurve /> with log_returns_series from migration 087's 'equity' panel RPC (Grok B-03 — verified panelId mapping line 165)"
    - "getStrategyDetailV2 extends StrategyV2Detail to expose: monthly_returns, return_quantiles, returns_series, trade_metrics, rolling_metrics, benchmark_greeks (alpha/beta/ir/treynor) and the analytics subset CorrelationWithBenchmark needs"
    - "All 7 panels reach data-panel-status='ready' after IntersectionObserver fires for panels 4-7 (panel6 reaches ready via fetchOnIntersect:false lifecycle path per Grok B-04)"
  artifacts:
    - path: "src/lib/queries.ts"
      provides: "Extended StrategyV2Detail interface with Panel 4-7 input fields + getStrategyDetailV2 maps from analytics blob"
      contains: "panel4Inputs"
    - path: "src/components/strategy-v2/StrategyV2Shell.tsx"
      provides: "Replaces 4 LazyPanelPlaceholder slots with real lazy bodies"
    - path: "src/components/strategy-v2/HeadlineMetricsPanel.tsx"
      provides: "Panel 2 segmented control unlocks Rolling Sharpe + Log returns buttons via direct fetchStrategyLazyMetrics(strategyId, 'equity') call"
  key_links:
    - from: "src/components/strategy-v2/StrategyV2Shell.tsx"
      to: "src/components/strategy-v2/{ReturnsDistributionPanel,RollingMetricsPanel,TradeAndPositionPanel,ExposureAndGreeksPanel}.tsx"
      via: "import + render"
      pattern: "ReturnsDistributionPanel|RollingMetricsPanel|TradeAndPositionPanel|ExposureAndGreeksPanel"
    - from: "src/components/strategy-v2/StrategyV2Shell.tsx"
      to: "src/components/strategy-v2/LazyPanelPlaceholder.tsx"
      via: "REMOVED — no longer imported or rendered"
      pattern: "LazyPanelPlaceholder"
    - from: "src/components/strategy-v2/HeadlineMetricsPanel.tsx"
      to: "src/lib/queries.ts:fetchStrategyLazyMetrics"
      via: "direct call with panelId='equity' for Log Returns toggle"
      pattern: "fetchStrategyLazyMetrics\\(.*'equity'\\)"
---

<objective>
Wave-3 integration. Three coordinated changes that wire Wave-2 panel bodies into the live route:

1. **getStrategyDetailV2 extension** — extend `StrategyV2Detail` interface to carry the eager fields Panel 4-7 wrappers need from analytics (monthly_returns, return_quantiles, returns_series, trade_metrics, rolling_metrics, benchmark_greeks, correlation_analytics). No new RPC; everything maps from the existing analytics blob already fetched in 14a.
2. **StrategyV2Shell wiring** — replace the 4 `<LazyPanelPlaceholder>` JSX slots with the real Wave-2 panel components. Remove the now-unused LazyPanelPlaceholder import. Pass through the new fields. Panel-count contract (exactly 7 `<section data-panel>`) preserved.
3. **Panel 2 segmented control unlock** — un-disable Rolling Sharpe and Log returns buttons in HeadlineMetricsPanel. Wire Rolling Sharpe → existing `<RollingMetrics>` view fed by analytics.rolling_metrics; wire Log returns → re-render EquityCurve with the `log_returns_series` field which Phase 12 ships via the `'equity'` lazy panel RPC (Grok B-03 — verified at migration 087 line 165: `WHEN 'equity' THEN ARRAY['log_returns_series']`). Direct call from inside HeadlineMetricsPanel (Panel 2 is eager-mounted; no IntersectionObserver needed).

Purpose: KPI-22 (7-panel scrollable shell — preserved with real bodies); KPI-08 unlocks Rolling Sharpe view in Panel 2; KPI-23b panel 4-7 partial-data flows through into the live shell; closes the integration loop so Wave-4 tests have something real to scan.
Output: 1 query extension + 1 shell rewrite + 1 panel 2 segmented-control un-disable. Each change is line-localized — no rearchitecting.

**Revision (2026-04-29 Grok B-03):** Added an explicit integration test (Task 3 Test 8) asserting `fetchStrategyLazyMetrics(strategyId, 'equity')` is invoked exactly once when the user clicks Log returns and that the resolved `log_returns_series` field is passed to EquityCurve. Migration 087's CASE statement supports `'equity'` (verified — see line 165 in `supabase/migrations/087_strategy_analytics_series.sql`).
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
@src/lib/queries.ts
@src/lib/types.ts
@src/components/strategy-v2/StrategyV2Shell.tsx
@src/components/strategy-v2/HeadlineMetricsPanel.tsx
@src/components/strategy-v2/LazyPanelPlaceholder.tsx
@src/components/charts/EquityCurve.tsx
@src/components/charts/RollingMetrics.tsx
@src/hooks/useLazyPanelMetrics.ts
@src/components/strategy-v2/ReturnsDistributionPanel.tsx
@src/components/strategy-v2/RollingMetricsPanel.tsx
@src/components/strategy-v2/TradeAndPositionPanel.tsx
@src/components/strategy-v2/ExposureAndGreeksPanel.tsx
@supabase/migrations/087_strategy_analytics_series.sql

<interfaces>
<!-- Pre-existing contracts the executor uses. -->

From 14b-02..05 (Wave 2 — assumed shipped):

```typescript
// ReturnsDistributionPanel
interface ReturnsDistributionPanelProps {
  strategyId: string;
  history_days: number;
  monthly_returns: Record<string, Record<string, number>> | null;
  return_quantiles: Record<string, number[]> | null;
  returns_series: { date: string; value: number }[] | null;
  benchmark_returns?: { date: string; value: number }[] | null;
}

// RollingMetricsPanel
interface RollingMetricsPanelProps {
  strategyId: string;
  history_days: number;
  rolling_metrics: Record<string, { date: string; value: number }[]> | null;
  sharpe?: number | null;
}

// TradeAndPositionPanel
interface TradeAndPositionPanelProps {
  strategyId: string;
  trade_metrics: (TradeMetrics & Record<string, unknown>) | null;
}

// ExposureAndGreeksPanel
interface ExposureAndGreeksPanelProps {
  strategyId: string;
  history_days: number;
  benchmark_greeks: { alpha; beta; ir; treynor };
  correlation_analytics: { returns_series; metrics_json };
}
```

From src/lib/queries.ts:317-345 (Phase 14a — current shape, TO BE EXTENDED):

```typescript
export interface StrategyV2Detail {
  strategy: Strategy;
  panel1: { ... };
  panel2Headline: { ... };
  panel2Equity: { ... };
  panel3: { ... };
  lazyKeys: ("panel4" | "panel5" | "panel6" | "panel7")[];
  history_days: number;
}
```

From src/lib/queries.ts:347-423 (current implementation): `getStrategyDetailV2` queries `from('strategies').select('*, strategy_analytics (*)')` and extracts via `extractAnalytics(...)`. The analytics row already carries `monthly_returns`, `return_quantiles`, `returns_series`, `trade_metrics`, `rolling_metrics`, `metrics_json` — see src/lib/types.ts:97-117 (StrategyAnalytics interface).

**Grok B-03 verification — migration 087 panel-id contract (lines 162-176):**

```sql
v_kinds := CASE p_panel_id
  WHEN 'overview'     THEN ARRAY[]::TEXT[]
  WHEN 'equity'       THEN ARRAY['log_returns_series']  -- this is what Plan 14b-06 leverages for Panel 2 Log Returns
  WHEN 'drawdown'     THEN ARRAY[]::TEXT[]
  WHEN 'returns_dist' THEN ARRAY['daily_returns_grid']
  WHEN 'rolling'      THEN ARRAY['rolling_sortino_3m', ..., 'rolling_alpha', 'rolling_beta']
  WHEN 'trades'       THEN ARRAY[]::TEXT[]
  WHEN 'exposure'     THEN ARRAY['exposure_series', 'turnover_series']
  ELSE ARRAY[]::TEXT[]
END;
```

A successful call to `fetchStrategyLazyMetrics(strategyId, 'equity')` returns `{ log_returns_series: [{date, value}, ...] }`. Plan 14b-06 Task 3 reads `payload.log_returns_series` and passes it to EquityCurve.

From src/components/charts/EquityCurve.tsx (existing component):

```typescript
// Already accepts data + benchmarkSeries + hideBenchmarkToggle props per Plan 14a-03 SUMMARY.
// For Log returns rendering, the executor must verify the prop interface
// (lightweight-charts wrapper) accepts the log-returns series shape — should
// be { date: string; value: number }[] same as cumulative.
```

From src/hooks/useLazyPanelMetrics.ts (post 14b-01):
- Supports `panelId: "panel4" | "panel5" | "panel6" | "panel7"` only.
- For Panel 2 Log Returns we need the `'equity'` panel from migration 087. The hook does NOT include `'equity'` in its LazyPanelId union (Panel 2 was eager in 14a, no observer needed). To fetch log_returns_series we use option (b): direct call to `fetchStrategyLazyMetrics(strategyId, 'equity')` from inside HeadlineMetricsPanel without going through the hook (since Panel 2 is eager-mounted, no IntersectionObserver needed).

Decision (locked): option (b) — direct call from HeadlineMetricsPanel. Panel 2 is eager (not lazy); using the hook there would be code-smell. The fetch fires on first render of HeadlineMetricsPanel only when the user clicks the Log returns button (lazy data acquisition triggered by user interaction).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend StrategyV2Detail + getStrategyDetailV2 mapping</name>
  <files>src/lib/queries.ts, src/lib/queries.test.ts</files>
  <read_first>
    - src/lib/queries.ts:300-423 (getStrategyDetailV2 implementation + StrategyV2Detail interface)
    - src/lib/types.ts:84-160 (StrategyAnalytics interface + TradeMetrics shape)
    - src/lib/queries.test.ts (existing test cases — extend)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §0 (inheritance from 14a — `getStrategyDetailV2` is REUSED, not replaced)
    - 14b-02 / 14b-03 / 14b-04 / 14b-05 PLAN files (the panel wrapper props they expect)
  </read_first>
  <behavior>
    - Test 1 (extended interface): The exported `StrategyV2Detail` type now includes new fields:
      - `panel4Inputs: { monthly_returns: ...; return_quantiles: ...; returns_series: ...; benchmark_returns: ...; }`
      - `panel5Inputs: { rolling_metrics: ...; sharpe: number | null; }`
      - `panel6Inputs: { trade_metrics: TradeMetrics | null; }`
      - `panel7Inputs: { benchmark_greeks: { alpha; beta; ir; treynor }; correlation_analytics: { returns_series; metrics_json }; }`
    - Test 2 (mapping from analytics): When the analytics blob has `monthly_returns: {2024:{Jan:0.01}}`, getStrategyDetailV2 returns `result.panel4Inputs.monthly_returns` matching that shape.
    - Test 3 (mapping benchmark_returns): `panel4Inputs.benchmark_returns` reads from `analytics.metrics_json.benchmark_returns` (same source the Correlation widget uses).
    - Test 4 (mapping greeks): `panel7Inputs.benchmark_greeks.alpha` reads from `analytics.metrics_json.alpha` (top-level scalars per metrics.py:255-267). Same for `beta`, `ir` (key candidates: `information_ratio` OR `ir`), `treynor` (candidates: `treynor_ratio` OR `treynor`). Read both candidates, prefer the more-specific name.
    - Test 5 (mapping rolling_metrics): `panel5Inputs.rolling_metrics` reads from `analytics.rolling_metrics` (existing field on StrategyAnalytics interface).
    - Test 6 (Pitfall 8 honored): When `computation_status !== 'complete'`, all new fields return `null` / empty objects (mirrors Phase 14a pattern for panel2Headline).
    - Test 7 (visibility gate): When strategy is private/unpublished, `getStrategyDetailV2` returns `null` (existing behavior preserved — `.eq("status", "published")`).
    - Test 8 (no schema change): `npx supabase migration list` (or equivalent) shows zero new migrations created. This plan touches src/ only.
  </behavior>
  <action>
    Edit `src/lib/queries.ts`:

    1. Update `StrategyV2Detail` interface (around lines 317-345). Add the 4 new sub-objects:

       ```typescript
       export interface StrategyV2Detail {
         strategy: Strategy;
         panel1: {
           supported_exchanges: string[];
           strategy_types: string[];
           subtypes: string[];
           markets: string[];
           leverage_range: string | null;
           avg_daily_turnover: number | null;
         };
         panel2Headline: {
           cumulative_return: number | null;
           cagr: number | null;
           sharpe: number | null;
           sortino: number | null;
           max_drawdown: number | null;
           volatility: number | null;
         };
         panel2Equity: {
           series: { date: string; value: number }[] | null;
           btc_overlay: { date: string; value: number }[] | null;
         };
         panel3: {
           drawdown_series: { date: string; value: number }[] | null;
           drawdown_episodes: unknown[] | null;
         };
         // NEW — Phase 14b
         panel4Inputs: {
           monthly_returns: Record<string, Record<string, number>> | null;
           return_quantiles: Record<string, number[]> | null;
           returns_series: { date: string; value: number }[] | null;
           benchmark_returns: { date: string; value: number }[] | null;
         };
         panel5Inputs: {
           rolling_metrics: Record<string, { date: string; value: number }[]> | null;
           sharpe: number | null;
         };
         panel6Inputs: {
           trade_metrics: TradeMetrics | null;
         };
         panel7Inputs: {
           benchmark_greeks: {
             alpha: number | null;
             beta: number | null;
             ir: number | null;
             treynor: number | null;
           };
           correlation_analytics: {
             returns_series: { date: string; value: number }[] | null;
             metrics_json: Record<string, unknown> | null;
           };
         };
         lazyKeys: ("panel4" | "panel5" | "panel6" | "panel7")[];
         history_days: number;
       }
       ```

       Import `TradeMetrics` from `@/lib/types` at the top of the file if not already imported.

    2. Inside `getStrategyDetailV2` (around lines 347-423), after the existing `panel3` block and before the `history_days` derivation, add the 4 new mappings:

       ```typescript
       const panel4Inputs = {
         monthly_returns: isComplete ? (a?.monthly_returns ?? null) : null,
         return_quantiles: isComplete ? (a?.return_quantiles ?? null) : null,
         returns_series: isComplete ? (a?.returns_series ?? null) : null,
         benchmark_returns: isComplete
           ? ((metricsJson["benchmark_returns"] as { date: string; value: number }[] | undefined) ?? null)
           : null,
       };

       const panel5Inputs = {
         rolling_metrics: isComplete ? (a?.rolling_metrics ?? null) : null,
         sharpe: isComplete ? (a?.sharpe ?? null) : null,
       };

       const panel6Inputs = {
         trade_metrics: isComplete ? (a?.trade_metrics ?? null) : null,
       };

       // Greeks scalars: metrics.py emits both `information_ratio` and `treynor_ratio` (long names).
       // Prefer those; fall back to short names if they ever appear.
       const greeksJson = metricsJson;
       const panel7Inputs = {
         benchmark_greeks: isComplete
           ? {
               alpha: typeof greeksJson["alpha"] === "number" ? (greeksJson["alpha"] as number) : null,
               beta: typeof greeksJson["beta"] === "number" ? (greeksJson["beta"] as number) : null,
               ir: typeof greeksJson["information_ratio"] === "number"
                 ? (greeksJson["information_ratio"] as number)
                 : typeof greeksJson["ir"] === "number" ? (greeksJson["ir"] as number) : null,
               treynor: typeof greeksJson["treynor_ratio"] === "number"
                 ? (greeksJson["treynor_ratio"] as number)
                 : typeof greeksJson["treynor"] === "number" ? (greeksJson["treynor"] as number) : null,
             }
           : { alpha: null, beta: null, ir: null, treynor: null },
         correlation_analytics: {
           returns_series: isComplete ? (a?.returns_series ?? null) : null,
           metrics_json: isComplete ? metricsJson : null,
         },
       };
       ```

    3. Update the return statement to include the new fields:

       ```typescript
       return {
         strategy: strategy as Strategy,
         panel1,
         panel2Headline,
         panel2Equity,
         panel3,
         panel4Inputs,
         panel5Inputs,
         panel6Inputs,
         panel7Inputs,
         lazyKeys: ["panel4", "panel5", "panel6", "panel7"],
         history_days,
       };
       ```

    4. Extend `src/lib/queries.test.ts` (or create if absent) with the 8 behaviours above. Use the existing Supabase mock pattern from `queries.test.ts` (the file already exists per Plan 12-08 SUMMARY — has 9 tests).
  </action>
  <verify>
    <automated>npm test -- src/lib/queries.test.ts --run</automated>
  </verify>
  <done>
    - `npm test -- src/lib/queries.test.ts --run` passes (existing 9 + new test cases).
    - `grep -c "panel4Inputs:" src/lib/queries.ts` ≥ 2 (interface + return).
    - `grep -c "panel5Inputs:" src/lib/queries.ts` ≥ 2.
    - `grep -c "panel6Inputs:" src/lib/queries.ts` ≥ 2.
    - `grep -c "panel7Inputs:" src/lib/queries.ts` ≥ 2.
    - `grep -c "benchmark_greeks" src/lib/queries.ts` ≥ 2.
    - `npx tsc --noEmit` exits 0.
    - No new file created under `supabase/migrations/`.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire Wave-2 panel bodies into StrategyV2Shell</name>
  <files>src/components/strategy-v2/StrategyV2Shell.tsx, src/components/strategy-v2/StrategyV2Shell.test.tsx, tests/visual/strategy-v2-panel-count.test.tsx</files>
  <read_first>
    - src/components/strategy-v2/StrategyV2Shell.tsx (current shape — 99 LOC)
    - tests/visual/strategy-v2-panel-count.test.tsx (Phase 14a-05 — asserts exactly 7 `<section data-panel>`; this test MUST still pass)
    - 14b-02..05 PLAN files (panel wrapper props they expect)
    - src/components/strategy-v2/LazyPanelPlaceholder.tsx (will become unused)
  </read_first>
  <behavior>
    - Test 1 (4 lazy panel bodies replace placeholders): StrategyV2Shell mounts `<ReturnsDistributionPanel>`, `<RollingMetricsPanel>`, `<TradeAndPositionPanel>`, `<ExposureAndGreeksPanel>` instead of 4 `<LazyPanelPlaceholder>` elements.
    - Test 2 (panel-count invariant): Exactly 7 `<section data-panel>` elements render. The Phase 14a panel-count test passes unchanged.
    - Test 3 (data-panel keys): The 4 lazy panels carry `data-panel="returns-distribution"`, `data-panel="rolling"`, `data-panel="trades"`, `data-panel="exposure"` respectively (the Wave-2 plans assigned these — verify match).
    - Test 4 (props passed): Each panel wrapper receives the corresponding `panelNInputs` from `detail` plus `strategyId={detail.strategy.id}` and `history_days={detail.history_days}` where applicable.
    - Test 5 (LazyPanelPlaceholder removed): Source no longer imports `LazyPanelPlaceholder`. The file `src/components/strategy-v2/LazyPanelPlaceholder.tsx` is NOT deleted in this plan — it stays in the codebase (test still imports it for unit isolation), but `StrategyV2Shell.tsx` does not import it.
    - Test 6 (build green): `npm run build` exits 0.
    - Test 7 (panel order preserved): Order remains: Overview → Headline+Equity → Drawdown → Returns distribution → Rolling → Trades → Exposure.
  </behavior>
  <action>
    Edit `src/components/strategy-v2/StrategyV2Shell.tsx`:

    1. Update imports at top — replace:
       ```typescript
       import { LazyPanelPlaceholder } from "./LazyPanelPlaceholder";
       ```
       with:
       ```typescript
       import { ReturnsDistributionPanel } from "./ReturnsDistributionPanel";
       import { RollingMetricsPanel } from "./RollingMetricsPanel";
       import { TradeAndPositionPanel } from "./TradeAndPositionPanel";
       import { ExposureAndGreeksPanel } from "./ExposureAndGreeksPanel";
       ```

    2. Update `StrategyV2ShellProps` destructure to include new fields:
       ```typescript
       const { strategy, panel1, panel2Headline, panel2Equity, panel3,
               panel4Inputs, panel5Inputs, panel6Inputs, panel7Inputs,
               history_days } = detail;
       ```

    3. Replace the 4 `<LazyPanelPlaceholder>` JSX blocks (lines 67-90 in current shape) with:
       ```tsx
       <ReturnsDistributionPanel
         strategyId={strategy.id}
         history_days={history_days}
         monthly_returns={panel4Inputs.monthly_returns}
         return_quantiles={panel4Inputs.return_quantiles}
         returns_series={panel4Inputs.returns_series}
         benchmark_returns={panel4Inputs.benchmark_returns}
       />

       <RollingMetricsPanel
         strategyId={strategy.id}
         history_days={history_days}
         rolling_metrics={panel5Inputs.rolling_metrics}
         sharpe={panel5Inputs.sharpe}
       />

       <TradeAndPositionPanel
         strategyId={strategy.id}
         trade_metrics={panel6Inputs.trade_metrics}
       />

       <ExposureAndGreeksPanel
         strategyId={strategy.id}
         history_days={history_days}
         benchmark_greeks={panel7Inputs.benchmark_greeks}
         correlation_analytics={panel7Inputs.correlation_analytics}
       />
       ```

    4. Keep all other JSX (header, OverviewPanel, HeadlineMetricsPanel, DrawdownPanel, Disclaimer footer) unchanged.

    5. Create `src/components/strategy-v2/StrategyV2Shell.test.tsx` if it doesn't exist (Phase 14a tests live in `tests/visual/strategy-v2-panel-count.test.tsx`). Add the 7 behaviours. Use a synthetic `StrategyV2Detail` fixture mirroring the Phase 14a panel-count test. Mock the 4 new panel components (and the Phase 14a ones) so the shell test focuses purely on shape + props passed.

    6. Verify `tests/visual/strategy-v2-panel-count.test.tsx` still passes — extend its synthetic `StrategyV2Detail` fixture to include the new `panelNInputs` fields (they're required per the new TS interface). Use sensible test values: `panel4Inputs: { monthly_returns: null, return_quantiles: null, returns_series: null, benchmark_returns: null }` etc. The 14a panel-count assertion (`toHaveCount(7)`) is unchanged.
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/StrategyV2Shell.test.tsx tests/visual/strategy-v2-panel-count.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/strategy-v2/StrategyV2Shell.test.tsx --run` passes 7/7.
    - `npm test -- tests/visual/strategy-v2-panel-count.test.tsx --run` (existing 14a test) still passes.
    - `grep -c "LazyPanelPlaceholder" src/components/strategy-v2/StrategyV2Shell.tsx` returns 0 (import removed).
    - `grep -c "ReturnsDistributionPanel\\|RollingMetricsPanel\\|TradeAndPositionPanel\\|ExposureAndGreeksPanel" src/components/strategy-v2/StrategyV2Shell.tsx` ≥ 8 (4 imports + 4 renders).
    - `npm run build` exits 0.
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Un-disable Panel 2 segmented control (Rolling Sharpe + Log returns) — Grok B-03 explicit equity-fetch test</name>
  <files>src/components/strategy-v2/HeadlineMetricsPanel.tsx, src/components/strategy-v2/HeadlineMetricsPanel.test.tsx</files>
  <read_first>
    - src/components/strategy-v2/HeadlineMetricsPanel.tsx (full file; segmented control options at lines 70-75; render switch at lines 175-220)
    - src/components/charts/EquityCurve.tsx (verify it accepts the log-returns series shape)
    - src/components/charts/RollingMetrics.tsx (existing component; signature is `{ data: Record<string, series[]>; overallSharpe?: number | null }`)
    - src/lib/queries.ts:fetchStrategyLazyMetrics (Phase 12 — used to fetch `equity` panel for log_returns_series)
    - supabase/migrations/087_strategy_analytics_series.sql (verify `WHEN 'equity' THEN ARRAY['log_returns_series']` is at line 165 — Grok B-03 verification)
    - .planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14B-UI-SPEC.md §3.2 (Panel 2 segmented control unlock — Rolling Sharpe and Log returns details)
  </read_first>
  <behavior>
    - Test 1 (4 buttons all enabled): Segmented control renders 4 buttons; none is disabled. `aria-disabled` attribute absent on all 4. The "Available in Phase 14b" tooltip is gone.
    - Test 2 (default still Cumulative): With no clicks, `activeView === 'cumulative'` and the EquityCurve renders the cumulative series.
    - Test 3 (Rolling Sharpe activates RollingMetrics view): Click "Rolling Sharpe". The chart body now renders `<RollingMetrics data={...} overallSharpe={panel2Headline.sharpe} />`. Data passed must be drawn from a new prop `rolling_metrics` (added to HeadlineMetricsPanelProps in this task). Pass via shell wiring (Task 2).
    - Test 4 (Log returns activates EquityCurve with log series): Click "Log returns". Component fires `fetchStrategyLazyMetrics(strategyId, 'equity')` once, awaits the `log_returns_series` field, then renders `<EquityCurve data={logReturns} ... />`. Loading state shows centered "Loading…" until the fetch resolves. Subsequent toggles back to Cumulative DO NOT re-fetch (cache the result via useState).
    - Test 5 (props extension): `HeadlineMetricsPanelProps` now includes `strategyId: string` and `rolling_metrics: Record<string, ...> | null`. Shell wiring (Task 2) passes these through.
    - Test 6 (no regression): The KPI strip + BTC checkbox + partial-data banners (history_days < 30 / < 7) all preserve their Phase 14a behavior. Cumulative + Underwater views unchanged.
    - Test 7 (forbidden classes): No `font-medium`, etc.
    - **Test 8 (Grok B-03 — exact equity-fetch invocation):**
      - Set up `vi.mock("@/lib/queries", async (orig) => ({ ...(await orig()), fetchStrategyLazyMetrics: vi.fn().mockResolvedValue({ log_returns_series: [{ date: "2024-01-01", value: 0.0 }, { date: "2024-01-02", value: 0.01 }] }) }))`.
      - Render HeadlineMetricsPanel with `strategyId="abc-123"`. Click "Log returns".
      - Assert: `fetchStrategyLazyMetrics` called exactly once with arguments `("abc-123", "equity")`.
      - Assert: After resolution, the rendered EquityCurve receives `data` equal to the `log_returns_series` array (length 2, dates and values match).
      - Toggle to "Cumulative" then back to "Log returns". Assert: `fetchStrategyLazyMetrics.mock.calls.length === 1` (cached, no re-fetch).
      - This guards Grok B-03's concern: even though migration 087 supports 'equity' (verified at line 165), an explicit integration-level assertion proves the wire-up survives refactors.
    - **Test 9 (Grok B-03 — empty equity payload graceful fallback):**
      - Mock `fetchStrategyLazyMetrics` to resolve with `{}` (visibility-gate-blocked or empty payload). Click "Log returns".
      - Assert: PartialDataBanner with body matching `/Log returns series unavailable/` renders (no console.error). EquityCurve does NOT render.
    - **Test 10 (Grok B-03 — equity fetch error path):**
      - Mock `fetchStrategyLazyMetrics` to reject. Click "Log returns".
      - Assert: PartialDataBanner with the same "unavailable" copy renders. The error is logged via `console.error` once.
  </behavior>
  <action>
    Edit `src/components/strategy-v2/HeadlineMetricsPanel.tsx`:

    1. Extend props interface:
       ```typescript
       interface HeadlineMetricsPanelProps {
         strategyId: string;                                                   // NEW
         panel2Headline: StrategyV2Detail["panel2Headline"];
         panel2Equity: StrategyV2Detail["panel2Equity"];
         rolling_metrics: Record<string, { date: string; value: number }[]> | null; // NEW
         history_days: number;
       }
       ```

    2. Extend `ActiveView` type:
       ```typescript
       type ActiveView = "cumulative" | "underwater" | "rolling_sharpe" | "log_returns";
       ```

    3. Remove `disabled: true` from segOptions (lines 70-75):
       ```typescript
       const segOptions = [
         { id: "cumulative", label: "Cumulative" },
         { id: "underwater", label: "Underwater" },
         { id: "rolling_sharpe", label: "Rolling Sharpe" },
         { id: "log_returns", label: "Log returns" },
       ];
       ```

    4. Update `onChange` in SegmentedControl to allow all 4 ids:
       ```typescript
       onChange={(id) => setActiveView(id as ActiveView)}
       ```

    5. Add log-returns lazy fetch state at top of function:
       ```typescript
       const [logReturns, setLogReturns] = useState<{ date: string; value: number }[] | null>(null);
       const [logReturnsStatus, setLogReturnsStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");

       useEffect(() => {
         if (activeView !== "log_returns") return;
         if (logReturnsStatus !== "idle") return;
         setLogReturnsStatus("loading");
         // Grok B-03: panelId "equity" maps via migration 087 (line 165) to
         // ARRAY['log_returns_series']. The RPC returns
         // { log_returns_series: [{date, value}, ...] } on success or {} on
         // visibility-gate / empty payload. Defensive null-check below renders
         // the partial-data banner if the payload is empty.
         fetchStrategyLazyMetrics(strategyId, "equity")
           .then((payload) => {
             const series = (payload as { log_returns_series?: { date: string; value: number }[] }).log_returns_series ?? [];
             setLogReturns(series);
             setLogReturnsStatus("ready");
           })
           .catch((err: unknown) => {
             console.error("HeadlineMetricsPanel log_returns fetch failed", { strategyId, err });
             setLogReturnsStatus("error");
           });
       }, [activeView, logReturnsStatus, strategyId]);
       ```
       Import `useEffect`, `useState` from `react` and `fetchStrategyLazyMetrics` from `@/lib/queries` at the top.

    6. Extend the render switch (around lines 175-220) to handle the 2 new views. Below the existing Cumulative / Underwater branches, add:
       ```tsx
       ) : activeView === "rolling_sharpe" ? (
         rolling_metrics && Object.keys(rolling_metrics).length > 0 ? (
           <RollingMetrics
             data={rolling_metrics}
             overallSharpe={panel2Headline.sharpe ?? null}
           />
         ) : (
           <PartialDataBanner
             heading="Awaiting more data"
             body="Rolling Sharpe series not yet computed for this strategy."
           />
         )
       ) : activeView === "log_returns" ? (
         logReturnsStatus === "loading" || logReturnsStatus === "idle" ? (
           <div
             aria-live="polite"
             className="flex items-center justify-center text-xs font-normal text-text-muted"
             style={{ minHeight: 240 }}
           >
             {"Loading…"}
           </div>
         ) : logReturnsStatus === "error" || !logReturns || logReturns.length === 0 ? (
           <PartialDataBanner
             heading="Awaiting more data"
             body="Log returns series unavailable for this strategy."
           />
         ) : (
           <EquityCurve
             data={logReturns}
             benchmarkSeries={null}
             hideBenchmarkToggle
           />
         )
       ) : (
         /* fallback — should be unreachable given the union */
         null
       )
       ```
       Add imports: `RollingMetrics` from `@/components/charts/RollingMetrics`.

    7. **Hide BTC checkbox in non-equity views.** Wrap the existing BTC checkbox JSX at lines ~157-167 with a conditional:
       ```tsx
       {benchmarkAvailable && (activeView === "cumulative" || activeView === "underwater") ? (
         <label ...>...</label>
       ) : null}
       ```
       This ensures the checkbox does not render for Rolling Sharpe / Log returns views (which have their own series, no BTC overlay logic).

    8. Update `src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` (extends Phase 14a tests). Use `vi.mock("@/lib/queries", () => ({ fetchStrategyLazyMetrics: vi.fn() }))` to control the log-returns fetch. Tests 8/9/10 (Grok B-03) MUST be added.

    9. **Wire the new props in StrategyV2Shell.tsx (Task 2 modification — touch the same file once with both changes):** Update the `<HeadlineMetricsPanel>` callsite to pass:
       ```tsx
       <HeadlineMetricsPanel
         strategyId={strategy.id}
         panel2Headline={panel2Headline}
         panel2Equity={panel2Equity}
         rolling_metrics={panel5Inputs.rolling_metrics}
         history_days={history_days}
       />
       ```

    Concrete value preservation:
    - Segmented control labels: `Cumulative`, `Underwater`, `Rolling Sharpe`, `Log returns` (verbatim — case-sensitive).
    - Loading copy: `Loading…` (Unicode U+2026).
    - Banner heading: `Awaiting more data`.
    - Banner body for empty log_returns: `Log returns series unavailable for this strategy.` (verbatim)
    - **fetchStrategyLazyMetrics called with exactly the string `"equity"` for the second argument (Grok B-03).**
  </action>
  <verify>
    <automated>npm test -- src/components/strategy-v2/HeadlineMetricsPanel.test.tsx --run</automated>
  </verify>
  <done>
    - `npm test -- src/components/strategy-v2/HeadlineMetricsPanel.test.tsx --run` passes (existing tests + new tests including Grok B-03 tests 8/9/10).
    - `grep -c "disabled: true" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 0.
    - `grep -c "Available in Phase 14b" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 0.
    - `grep -c "rolling_sharpe\\|log_returns" src/components/strategy-v2/HeadlineMetricsPanel.tsx` ≥ 4 (type union + 2 render branches + onClick handling).
    - `grep -c "fetchStrategyLazyMetrics" src/components/strategy-v2/HeadlineMetricsPanel.tsx` ≥ 2 (import + invocation).
    - **`grep -c "fetchStrategyLazyMetrics(strategyId, \"equity\")" src/components/strategy-v2/HeadlineMetricsPanel.tsx` returns 1 (Grok B-03 — exact panelId).**
    - `grep -c "RollingMetrics" src/components/strategy-v2/HeadlineMetricsPanel.tsx` ≥ 2 (import + render).
    - `grep -c "rolling_metrics={panel5Inputs.rolling_metrics}" src/components/strategy-v2/StrategyV2Shell.tsx` returns 1.
    - `npm run build` exits 0.
  </done>
</task>

</tasks>

<verification>
- `npm test -- src/components/strategy-v2 src/lib/queries.test.ts tests/visual/ --run` all green.
- `grep -rln "LazyPanelPlaceholder" src/components/strategy-v2/StrategyV2Shell.tsx` returns 0.
- All 7 panel `data-panel` attributes preserved (overview / headline-equity / drawdown / returns-distribution / rolling / trades / exposure).
- Panel 2 has 4 enabled buttons in the segmented control.
- **Grok B-03 invariant: Panel 2 Log Returns wires `fetchStrategyLazyMetrics(strategyId, "equity")` directly. Migration 087 line 165 supports this panelId. Tests 8/9/10 in HeadlineMetricsPanel.test.tsx prove the round-trip.**
- `npm run build` exits 0.
</verification>

<success_criteria>
- KPI-22 7-panel scrollable shell preserved with real lazy bodies.
- KPI-08 Rolling Sharpe view unlocked in Panel 2.
- Log returns view active in Panel 2 via direct fetchStrategyLazyMetrics(strategyId, 'equity') call (migration 087 supports this panelId — Grok B-03 verified).
- All Wave-2 panel components mounted in production code path.
- StrategyV2Shell ready for Wave-4 axe / keyboard / parity tests to run against.
</success_criteria>

<output>
After completion, create `.planning/phases/14b-single-strategy-v2-lazy-panels-trade-exposure/14b-06-SUMMARY.md` documenting the StrategyV2Detail extension, the panel wiring map, the Panel 2 segmented-control unlock, the Grok B-03 equity-fetch integration tests added, and any deviations.
</output>
