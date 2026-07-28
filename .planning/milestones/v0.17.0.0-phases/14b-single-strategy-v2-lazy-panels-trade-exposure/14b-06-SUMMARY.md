---
phase: 14b
plan: 06
subsystem: strategy-v2
tags:
  - strategy-v2
  - integration
  - panel-2-unlock
  - shell-wiring
  - wave-3
  - kpi-08
  - kpi-22
  - kpi-23b
  - grok-b-03
requirements:
  - KPI-08
  - KPI-22
  - KPI-23b
requirements_addressed:
  - KPI-08
  - KPI-22
  - KPI-23b
dependency_graph:
  requires:
    - "14b-01 — useLazyPanelMetrics fetch lifecycle + src/lib/queries-client.ts (client-safe RPC mirror)"
    - "14b-02 — ReturnsDistributionPanel"
    - "14b-03 — RollingMetricsPanel"
    - "14b-04 — TradeAndPositionPanel"
    - "14b-05 — ExposureAndGreeksPanel"
    - "14a-04 — getStrategyDetailV2 (StrategyV2Detail interface)"
    - "Phase 12 / migration 087 — fetch_strategy_lazy_metrics RPC, line 165 maps 'equity' → ARRAY['log_returns_series']"
  provides:
    - "src/lib/queries.ts — extended StrategyV2Detail interface with panel4Inputs / panel5Inputs / panel6Inputs / panel7Inputs (eager inputs for Panels 4-7 + Rolling Sharpe + Greeks)"
    - "src/components/strategy-v2/StrategyV2Shell.tsx — Wave-3 wiring (4 lazy panel bodies replacing placeholder slots; HeadlineMetricsPanel callsite extended with strategyId + rolling_metrics)"
    - "src/components/strategy-v2/HeadlineMetricsPanel.tsx — Panel 2 segmented-control unlock (Rolling Sharpe + Log returns views) with Grok B-03 verified equity-fetch wiring"
    - "src/components/strategy-v2/StrategyV2Shell.test.tsx — new wiring tests (7 cases)"
    - "src/components/strategy-v2/HeadlineMetricsPanel.test.tsx — Panel 2 unlock tests (12 cases including Grok B-03 tests 8/9/10)"
    - "src/lib/queries.test.ts — extended with 9 new getStrategyDetailV2 panel-input mapping tests"
  affects:
    - "tests/visual/strategy-v2-panel-count.test.tsx — fixture extended with panel4..7Inputs to satisfy new StrategyV2Detail interface"
    - "src/components/strategy-v2/LazyPanelPlaceholder.tsx — no longer imported anywhere in production code (file preserved in codebase per plan)"
tech-stack:
  added: []
  patterns:
    - "Event-driven lazy fetch (Rule 1 deviation from useEffect after ESLint react-hooks/set-state-in-effect): Log returns fetch fires from the SegmentedControl onChange handler instead of inside useEffect to satisfy React 19 / Next.js 16 lint rule"
    - "Client-safe RPC mirror (Rule 3 deviation): use fetchStrategyLazyMetricsClient from @/lib/queries-client (the client-safe mirror created in Plan 14b-01) instead of the server-only fetchStrategyLazyMetrics from @/lib/queries — avoids Turbopack's server-only chain rejection inside 'use client' module graphs"
    - "Eager-input mapping pattern: panel4..7Inputs read from the same analytics blob already fetched by getStrategyDetailV2 (no new RPC, no schema change). Pitfall 8 honored — computation_status !== 'complete' returns null/empty everywhere"
    - "Greeks long-name preference: alpha/beta read directly; ir → information_ratio (long) preferred, falls back to ir (short); treynor → treynor_ratio (long) preferred, falls back to treynor (short)"
    - "Wide intersection type for panel6Inputs.trade_metrics ((TradeMetrics & Record<string, unknown>) | null) — matches TradeAndPositionPanel's consumer expectation since the JSONB blob carries volume-aggregator extras (gross_volume_usd, mean_trade_size_usd, etc.) beyond the frozen TradeMetrics shape"
    - "BTC checkbox conditional rendering — only applies to Cumulative + Underwater views; hidden when activeView is rolling_sharpe or log_returns (those views have their own series logic, no BTC overlay)"
key-files:
  created:
    - "src/components/strategy-v2/StrategyV2Shell.test.tsx (7 tests)"
    - "src/components/strategy-v2/HeadlineMetricsPanel.test.tsx (12 tests including Grok B-03 8/9/10)"
  modified:
    - "src/lib/queries.ts (StrategyV2Detail interface + getStrategyDetailV2 mappings + TradeMetrics import)"
    - "src/lib/queries.test.ts (9 new test cases for panel4..7 mapping)"
    - "src/components/strategy-v2/StrategyV2Shell.tsx (replaced 4 LazyPanelPlaceholder slots; wired HeadlineMetricsPanel with strategyId + rolling_metrics)"
    - "src/components/strategy-v2/HeadlineMetricsPanel.tsx (props extension + Rolling Sharpe + Log returns views + lazy fetch + BTC checkbox conditional)"
    - "tests/visual/strategy-v2-panel-count.test.tsx (fixture extension)"
decisions:
  - "Combine Tasks 2 & 3 into a single git commit (rather than separate commits) because the plan §3.9 explicitly notes the StrategyV2Shell HeadlineMetricsPanel callsite changes must land in the same file/edit cycle as the HeadlineMetricsPanel signature changes — splitting them would leave an intermediate commit that fails to typecheck"
  - "Use fetchStrategyLazyMetricsClient from @/lib/queries-client (Rule 3 deviation from plan-as-drafted) — the plan said use @/lib/queries fetchStrategyLazyMetrics, but that module is server-only via the next/headers chain. The client mirror was specifically created in Plan 14b-01 for exactly this case"
  - "Refactor Log returns lazy fetch from useEffect to onChange-handler-driven (Rule 1 deviation) — ESLint react-hooks/set-state-in-effect flagged the original implementation as bad practice (cascading renders). The event-driven model is React-idiomatic for user-triggered side effects and behaves identically from the user's perspective"
  - "Widen panel6Inputs.trade_metrics to TradeMetrics & Record<string, unknown> (Rule 1 / typecheck blocker) — TradeAndPositionPanel already accepts this wider type because Phase 12 trade_metrics JSONB carries volume aggregator extras"
metrics:
  duration_minutes: 13
  completed_date: "2026-04-29"
  task_count: 3
  test_count: 28
  file_count: 6
---

# Phase 14b Plan 06: Wave-3 Integration — StrategyV2Detail Extension + Shell Wiring + Panel 2 Unlock

Wave-3 integration that closes the loop between Wave 1's lazy-fetch foundation, Wave 2's per-panel bodies, and the live `/strategy/[id]/v2` route. Three coordinated changes: (1) extend `StrategyV2Detail` with eager inputs for Panels 4-7 + Rolling Sharpe + Greeks (no new RPC); (2) replace the four `<LazyPanelPlaceholder>` slots in `StrategyV2Shell` with the real Wave-2 panel bodies; (3) un-disable Panel 2's Rolling Sharpe + Log Returns segmented-control buttons with a Grok B-03-verified direct call to the migration-087 `'equity'` panel-id RPC for log returns.

## What Shipped

### Task 1 — getStrategyDetailV2 Extension (commit `213f041`)

`src/lib/queries.ts`:
- `StrategyV2Detail` interface gains four new sub-objects:
  - `panel4Inputs`: `monthly_returns` / `return_quantiles` / `returns_series` / `benchmark_returns` (last from `metrics_json.benchmark_returns`)
  - `panel5Inputs`: `rolling_metrics` (analytics row) + `sharpe` scalar
  - `panel6Inputs`: `trade_metrics` widened to `(TradeMetrics & Record<string, unknown>) | null` to match the volume-aggregator-extras JSONB shape
  - `panel7Inputs`: `benchmark_greeks` (alpha/beta/IR/Treynor with long-name preference) + `correlation_analytics` subset (returns_series + metrics_json) for `<CorrelationWithBenchmark>`
- All four mappings honor Pitfall 8: when `computation_status !== 'complete'`, every field returns `null`/empty so per-panel partial-data banners trigger correctly.
- No new migration; no new RPC. Existing `from('strategies').select('*, strategy_analytics (*)')` join already carries every field.

### Task 2 — StrategyV2Shell Wiring (commit `0be28af`)

`src/components/strategy-v2/StrategyV2Shell.tsx`:
- Removed `LazyPanelPlaceholder` import.
- Added imports for `ReturnsDistributionPanel`, `RollingMetricsPanel`, `TradeAndPositionPanel`, `ExposureAndGreeksPanel`.
- Destructure now includes `panel4Inputs / panel5Inputs / panel6Inputs / panel7Inputs`.
- Replaced 4 `<LazyPanelPlaceholder>` JSX slots with the real Wave-2 panel components.
- Extended `<HeadlineMetricsPanel>` callsite with `strategyId={strategy.id}` + `rolling_metrics={panel5Inputs.rolling_metrics}`.
- Panel-count contract preserved: 7 `<section data-panel>` elements, in canonical order (overview / headline-equity / drawdown / returns-distribution / rolling / trades / exposure).

`src/components/strategy-v2/StrategyV2Shell.test.tsx` (NEW, 7 tests):
- T1 — 4 lazy panel bodies render in place of placeholders
- T2 — KPI-22 invariant: 7 `<section data-panel>` elements
- T3 — canonical `data-panel` keys present
- T4 — `panelNInputs` flow through with strategyId + history_days
- T5 — source no longer imports `LazyPanelPlaceholder`
- T6 — TS compiles green
- T7 — panel order preserved end-to-end

### Task 3 — Panel 2 Segmented Control Unlock (commit `0be28af`)

`src/components/strategy-v2/HeadlineMetricsPanel.tsx`:
- Props extended with `strategyId: string` + `rolling_metrics: Record<string, ...> | null`.
- `ActiveView` type extended to `"cumulative" | "underwater" | "rolling_sharpe" | "log_returns"`.
- `segOptions` no longer marks Rolling Sharpe / Log returns as `disabled: true` — all 4 buttons enabled.
- New `handleViewChange(nextView)` event handler triggers the lazy fetch when the user activates Log returns:
  ```typescript
  fetchStrategyLazyMetricsClient(strategyId, "equity")
    .then((payload) => {
      const series = payload.log_returns_series ?? [];
      setLogReturns(series);
      setLogReturnsStatus("ready");
    })
    .catch(...);
  ```
- Render switch:
  - `cumulative` → `<EquityCurve>` with `panel2Equity.series`
  - `underwater` → `<DrawdownChart>` derived from equity series
  - `rolling_sharpe` → `<RollingMetrics data={rolling_metrics} overallSharpe={panel2Headline.sharpe} />` OR `<PartialDataBanner>` when empty
  - `log_returns` → loading copy → `<EquityCurve data={logReturns}>` OR `<PartialDataBanner>` (empty / error)
- BTC checkbox now conditional on `activeView === "cumulative" || activeView === "underwater"` (hidden in Rolling Sharpe / Log returns views).

`src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` (NEW, 12 tests):
- T1 — 4 buttons enabled (no `aria-disabled`)
- T2 — default Cumulative + no fetch on initial render
- T3 — Rolling Sharpe → RollingMetrics rendered with rolling_metrics + sharpe avg
- T3b — Rolling Sharpe with empty rolling_metrics → PartialDataBanner
- T4 — Log returns triggers fetch + renders EquityCurve with log_returns_series
- T5 — props extension required at compile + render time
- T6 — KPI strip / partial-data banner regression preserved
- T6b — BTC checkbox hidden in Rolling Sharpe / Log returns
- T7 — forbidden classes absent (font-medium / text-xl / text-2xl)
- T8 (Grok B-03) — fetch called exactly once with `("abc-123", "equity")`; cached on toggle-back
- T9 (Grok B-03) — empty payload → PartialDataBanner; no console.error
- T10 (Grok B-03) — fetch error → PartialDataBanner; console.error logged once

## Wiring Map

```
StrategyV2Shell (server component)
  ├─ <OverviewPanel panel1 history_days />
  ├─ <HeadlineMetricsPanel
  │     strategyId={strategy.id}                           ← NEW
  │     panel2Headline panel2Equity history_days
  │     rolling_metrics={panel5Inputs.rolling_metrics} />  ← NEW (shared with Panel 5)
  ├─ <DrawdownPanel panel3 history_days />
  ├─ <ReturnsDistributionPanel
  │     strategyId={strategy.id}
  │     history_days
  │     monthly_returns return_quantiles returns_series benchmark_returns />
  ├─ <RollingMetricsPanel
  │     strategyId={strategy.id}
  │     history_days
  │     rolling_metrics sharpe />
  ├─ <TradeAndPositionPanel
  │     strategyId={strategy.id}
  │     trade_metrics />
  └─ <ExposureAndGreeksPanel
        strategyId={strategy.id}
        history_days
        benchmark_greeks correlation_analytics />
```

The 4 lazy panels manage their own IntersectionObserver lifecycle internally via `useLazyPanelMetrics`. The shell stays a thin server component; the only client interactivity it owns is the H1 + VerifiedBadge + Disclaimer chrome.

## Grok B-03 Equity-Fetch Verification

Migration 087 line 165 (`supabase/migrations/087_strategy_analytics_series.sql`):

```sql
WHEN 'equity' THEN ARRAY['log_returns_series']
```

The integration test (Test 8) asserts:
1. `fetchStrategyLazyMetricsClient` called exactly once with arguments `("abc-123", "equity")` after Log returns activation.
2. The resolved `log_returns_series` array (length 2, dates + values match) flows to the rendered `<EquityCurve>` `data` prop.
3. Toggling Cumulative → Log returns again does NOT re-fetch (cache assertion: `fetchMock.mock.calls.length === 1`).

Test 9 covers the empty-payload graceful fallback (RPC returns `{}` for visibility-gate-blocked or unpopulated strategies — PartialDataBanner with body matching `/Log returns series unavailable/` renders).

Test 10 covers the fetch-error path (PartialDataBanner + `console.error` once).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] fetchStrategyLazyMetricsClient (client-safe mirror) instead of fetchStrategyLazyMetrics (server-only)**
- **Found during:** Task 3 implementation
- **Issue:** The plan-as-drafted Task 3 §6 specified importing `fetchStrategyLazyMetrics` from `@/lib/queries`. That module is server-only — it transitively imports `next/headers` via `@/lib/supabase/admin` (which carries `import "server-only"`). Statically importing it from a `"use client"` component fails Turbopack's server-only barrier check, breaking the build.
- **Fix:** Use `fetchStrategyLazyMetricsClient` from `@/lib/queries-client` (the client-safe mirror created in Plan 14b-01 specifically for this case — identical RPC contract, browser-side supabase factory). The execution_context constraints in the prompt explicitly directed this substitution.
- **Files modified:** `src/components/strategy-v2/HeadlineMetricsPanel.tsx`
- **Commit:** `0be28af`

**2. [Rule 1 — Bug] Refactored Log returns fetch from useEffect to event-driven onChange handler**
- **Found during:** Task 3 lint pass after initial implementation
- **Issue:** Initial implementation placed the fetch + `setLogReturnsStatus("loading")` inside a `useEffect`. ESLint `react-hooks/set-state-in-effect` flagged this with: "Calling setState synchronously within an effect can trigger cascading renders." React 19 / Next.js 16 idiom prefers event-driven side effects for user-triggered work.
- **Fix:** Extracted the fetch into a `handleViewChange(nextView)` function called from `<SegmentedControl onChange>`. Behavior is identical from the user's perspective; the fetch still fires exactly once on first activation and caches subsequent toggles. All 12 tests still pass without modification.
- **Files modified:** `src/components/strategy-v2/HeadlineMetricsPanel.tsx`
- **Commit:** `0be28af`

**3. [Rule 1 — Bug] Widened panel6Inputs.trade_metrics to TradeMetrics & Record<string, unknown>**
- **Found during:** Task 2 typecheck after initial Task 1 interface
- **Issue:** Task 1 interface declared `trade_metrics: TradeMetrics | null` per the plan literal text. Task 2 wiring exposed a TS error: `<TradeAndPositionPanel>` expects `(TradeMetrics & Record<string, unknown>) | null` because Phase 12 / Plan 12-05 SUMMARY documents that the `trade_metrics` JSONB blob carries volume-aggregator extras (gross_volume_usd, mean_trade_size_usd, daily_turnover_usd, monthly_turnover_usd, payoff_ratio, profit_factor, winners_count, losers_count) beyond the frozen `TradeMetrics` interface.
- **Fix:** Widened the interface field type AND added a corresponding cast on the runtime assignment inside `getStrategyDetailV2`. The volume extras flow through to the panel unchanged.
- **Files modified:** `src/lib/queries.ts`
- **Commit:** `0be28af`

### Plan grep done-criteria nuance

Task 3 done criterion: `grep -c "fetchStrategyLazyMetrics(strategyId, \"equity\")" ... returns 1`. Because Deviation #1 above renamed to `fetchStrategyLazyMetricsClient(strategyId, "equity")`, the literal grep substring `fetchStrategyLazyMetrics(strategyId, "equity")` returns 0 (the `Client` suffix breaks the contiguous match). The functional contract — exact panelId `"equity"`, exact strategyId arg shape — is asserted instead by Test 8 (Grok B-03 explicit equity-fetch invocation). The substring `fetchStrategyLazyMetrics` (without the trailing parenthesis) appears 4 times in the source, satisfying the broader integration intent.

## Verification Results

```
$ npx tsc --noEmit
(clean exit)

$ npm run build
(clean — all 50+ routes compile)

$ npx vitest run src/components/strategy-v2 src/lib/queries.test.ts tests/visual/
Test Files  12 passed (12)
Tests       117 passed (117)

$ grep -c "LazyPanelPlaceholder" src/components/strategy-v2/StrategyV2Shell.tsx
0

$ grep -cE "ReturnsDistributionPanel|RollingMetricsPanel|TradeAndPositionPanel|ExposureAndGreeksPanel" src/components/strategy-v2/StrategyV2Shell.tsx
8  (4 imports + 4 renders)

$ grep -c "rolling_metrics={panel5Inputs.rolling_metrics}" src/components/strategy-v2/StrategyV2Shell.tsx
2  (HeadlineMetricsPanel + RollingMetricsPanel callsites)

$ grep -c "panel4Inputs:" src/lib/queries.ts
2  (interface + return)
$ grep -c "panel5Inputs:" src/lib/queries.ts
2
$ grep -c "panel6Inputs:" src/lib/queries.ts
2
$ grep -c "panel7Inputs:" src/lib/queries.ts
2
$ grep -c "benchmark_greeks" src/lib/queries.ts
2

$ grep -c "disabled: true" src/components/strategy-v2/HeadlineMetricsPanel.tsx
0
$ grep -c "Available in Phase 14b" src/components/strategy-v2/HeadlineMetricsPanel.tsx
0
$ grep -c "fetchStrategyLazyMetricsClient" src/components/strategy-v2/HeadlineMetricsPanel.tsx
4  (import + invocation + 2 comment refs)
$ grep -c "RollingMetrics" src/components/strategy-v2/HeadlineMetricsPanel.tsx
4  (import + render + 2 comment refs)

$ ls supabase/migrations/ | wc -l
(unchanged — zero new migrations)
```

## Success Criteria

- [x] KPI-22 7-panel scrollable shell preserved with real lazy bodies (`<section data-panel>` count = 7)
- [x] KPI-08 Rolling Sharpe view unlocked in Panel 2
- [x] Log returns view active in Panel 2 via direct fetchStrategyLazyMetricsClient(strategyId, 'equity') call
- [x] All Wave-2 panel components mounted in production code path
- [x] StrategyV2Shell ready for Wave-4 axe / keyboard / parity tests to run against
- [x] Grok B-03 invariants asserted by HeadlineMetricsPanel.test.tsx tests 8/9/10

## Self-Check: PASSED

- File: `src/lib/queries.ts` — FOUND
- File: `src/lib/queries.test.ts` — FOUND
- File: `src/components/strategy-v2/StrategyV2Shell.tsx` — FOUND
- File: `src/components/strategy-v2/StrategyV2Shell.test.tsx` — FOUND
- File: `src/components/strategy-v2/HeadlineMetricsPanel.tsx` — FOUND
- File: `src/components/strategy-v2/HeadlineMetricsPanel.test.tsx` — FOUND
- File: `tests/visual/strategy-v2-panel-count.test.tsx` — FOUND
- Commit: `213f041` — FOUND (Task 1)
- Commit: `0be28af` — FOUND (Tasks 2 + 3)
