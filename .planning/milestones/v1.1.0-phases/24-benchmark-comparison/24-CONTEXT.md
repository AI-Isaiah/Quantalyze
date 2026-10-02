# Phase 24: Benchmark Comparison - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — grey areas decided by orchestrator per no-clients directive; user may override)

<domain>
## Phase Boundary

The active scenario projection gains a benchmark dimension. Three capabilities, nothing more:

1. **Overlay** a benchmark series (BTC, reusing the existing `benchmark_prices` table that `benchmark.py` populates) on the scenario projection's equity chart, aligned to the common-overlap window (intersection of scenario dates ∩ benchmark dates).
2. **Surface** the standard active-return metrics — tracking error, information ratio, alpha, beta — computed over that aligned window using the product-wide **252-day** annualization (never √365 / a monthly path).
3. **Honest empty state** — when the benchmark series does not cover the scenario window (or overlap is below the floor), render a neutral "Benchmark comparison unavailable" state instead of a mismatched-window or fabricated comparison.

Out of scope (defer): benchmark columns inside the Phase-23 multi-scenario compare table (this phase attaches to the single ACTIVE scenario projection); multiple benchmarks (only BTC exists); byte-exact TS↔Python parity with quantstats `greeks` (we use the standard CAPM definitions, tested against hand-computed goldens).
</domain>

<decisions>
## Implementation Decisions

### Benchmark data path
- Benchmark = **BTC only** — the only series in `benchmark_prices` (`supabase/migrations/20260405093623_indexes_and_benchmark.sql`: `date`, `symbol`, `close_price`, PK `(date, symbol)`), populated by `analytics-service/services/benchmark.py` (`get_benchmark_returns("BTC")`). Label the UI "vs BTC".
- New GET route exposes the BTC **daily-returns** series to the frontend as `[{date, value}]` (pct-change of `close_price`, matching `prices_to_returns`). The benchmark daily-returns series is NOT currently exposed (only the aggregated `benchmark_comparison` scalar). `benchmark_prices` is **shared market data, not user-scoped** → the route is cacheable (a short cache is fine; NOT the allocator no-store path) and needs no per-tenant RLS. Read the table server-side; verify benchmark_prices is frontend-readable (public/no-RLS) — if it is RLS-locked, read via the appropriate server client.
- **No Python / no analytics-service change** → Railway deploy is a no-op (matches Phases 21/22/23). No new dependencies.

### Active-return math (pure TS, 252-annualized)
- **Reuse** `computeTrackingError(returns, benchmark)` from `src/lib/portfolio-stats.ts:444` (`stdDev(excess) × √252`).
- Implement as pure-TS helpers (new, e.g. in a `scenario-benchmark.ts` or alongside the compare lib), each tested against hand-computed golden values:
  - **Information ratio** = `mean(excess) × 252 / trackingError` (mirrors `metrics.py:814`).
  - **Beta** = `cov(portfolioReturns, benchmarkReturns) / var(benchmarkReturns)` (OLS slope).
  - **Alpha** = `(mean(portfolioReturns) − beta × mean(benchmarkReturns)) × 252` (annualized CAPM intercept).
  - **Correlation** may reuse the Pearson helper in `scenario.ts:389`.
  All use `Math.sqrt(252)` / `× 252` — the canonical convention in `scenario.ts:300,308` and `portfolio-stats.ts:119`. NO √365.
- **Alignment = INTERSECTION (inner-join)** of the scenario projection's dates with the benchmark's dates — mirror the Python `aligned = portfolio_returns.reindex(benchmark.index).dropna()` pattern (`portfolio.py:915-916`). Do NOT reuse the scenario's internal date-UNION (`scenario.ts:181`) — the benchmark cannot be zero-filled. The scenario's daily portfolio returns are the left series; derive them from the engine (computeScenario already builds them internally; the planner picks the cleanest source — expose the daily returns or reconstruct from `equity_curve`).

### Surfacing & honesty
- **Overlay:** benchmark series on the scenario projection equity chart — reuse the existing `EquityCurve.tsx` `benchmarkSeries?: {date,value}[]` prop + lightweight-charts pattern (`src/components/charts/EquityCurve.tsx:15-31`), toggleable (a "show benchmark" control like the factsheet). Reuse, don't redesign.
- **Metrics:** TE / IR / alpha / beta in a labeled section attached to the scenario projection ("vs BTC over {N} overlapping days"). Numbers in Geist Mono per DESIGN.md.
- **Honest empty/degenerate states (load-bearing — milestone honesty invariant):**
  - Benchmark missing / doesn't cover the window / overlap below floor → reuse `EmptyStateCard` (`src/components/ui/EmptyStateCard.tsx`) with a neutral "Benchmark comparison unavailable" heading whose body explains why (heading must match body — the #509 lesson). Use the Phase-22 `evaluateSampleFloor(n, 30)` (`src/lib/sample-floor.ts`) with a **30-day** benchmark floor, matching the Python portfolio-benchmark precedent (`portfolio.py:917`).
  - Any individual degenerate metric (null / non-finite) renders an em-dash "—", NEVER a fabricated 0 / "0.00%" / "N/A".
- **Methodology disclosure:** stamp the aligned window + N via `methodologyLine(n)` (`src/lib/scenario-history.ts:41`) plus a note that metrics are 252-day annualized active returns.

### Claude's Discretion
- Exact route path/name, the daily-returns source (expose from computeScenario vs reconstruct from equity_curve), the metrics-section layout, and the overlay toggle placement are the planner's call within the locked behaviors above.

### Honesty / no-invented-data invariant
- Same invariant as Phases 21/22/23 and the #509 fix: a missing/insufficient benchmark window must surface honestly, never a mismatched-window comparison or a fabricated number.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `benchmark_prices` table + `benchmark.py` `get_benchmark_returns("BTC")` (already populated; no Python change).
- `computeTrackingError(returns, benchmark)` — `src/lib/portfolio-stats.ts:444` (×√252).
- 252-annualization canon — `src/lib/scenario.ts:300,308`, `portfolio-stats.ts:119`. Pearson correlation — `scenario.ts:389`.
- `EquityCurve.tsx` `benchmarkSeries` overlay + `showBenchmark` toggle — `src/components/charts/EquityCurve.tsx:15-31,44`.
- Phase-22 honesty: `evaluateSampleFloor`/`SAMPLE_FLOOR_OVERLAPPING_DAYS` (`src/lib/sample-floor.ts`), `methodologyLine` (`src/lib/scenario-history.ts:41`), `EmptyStateCard`.
- Scenario engine output `ComputedMetrics` (incl. `equity_curve` cumulative-RETURN form, `effective_start/end`, `n`) — `src/lib/scenario.ts:85`; the Phase-23 compare lib `computeMetricsForDraft` — `src/app/(dashboard)/allocations/lib/scenario-compare.ts`.
- Python reference for the exact metric defs + inner-join alignment: `analytics-service/services/metrics.py:804-814` + `routers/portfolio.py:915-926`.

### Established Patterns
- The scenario surface computes all metrics CLIENT-SIDE in TS (scenario.ts) — phase 24 keeps that philosophy (TS active-return helpers), no worker round-trip.
- Cacheable shared-data routes vs allocator no-store routes — benchmark series is the former.

### Integration Points
- The composer's scenario projection (EquityChart area in `ScenarioComposer.tsx`) — where the overlay + metrics section + empty state mount.
- New: 1 GET route (benchmark series) + a pure-TS active-return helper module + the overlay/metrics/empty-state UI.
</code_context>

<specifics>
## Specific Ideas

- TS↔Python: `metrics.py` computes benchmark active-return for STRATEGIES/PORTFOLIOS via the worker; the SCENARIO benchmark comparison is a NEW client-side computation, so it is not parity-bound to a live Python path — it just must be internally correct and use the 252 convention. Pin the math with golden unit tests.
- Intersection vs union is the easy mistake here: the scenario engine unions strategy dates (zero-fill), but the benchmark must be inner-joined (no zero-fill) — getting this wrong silently widens the window and fabricates active return.
</specifics>

<deferred>
## Deferred Ideas

- Benchmark columns in the Phase-23 multi-scenario compare table (each scenario vs BTC side-by-side) — natural extension, out of scope for BENCH-01's single-projection wording.
- Additional benchmarks (SPX/SPY/etc.) — only BTC exists in `benchmark_prices`; multi-benchmark is a data + UI expansion.
- Byte-exact parity with quantstats `greeks` alpha/beta — we use the standard CAPM definitions; exact-parity would need golden fixtures against the Python lib.
</deferred>
