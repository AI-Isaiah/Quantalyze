# Phase 30: Factsheet Graphs on the Blend - Context

**Gathered:** 2026-06-23
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous — grey areas resolved to recommended defaults per the no-clients-decide-autonomously directive; locked roadmap exit gates carried in verbatim)

<domain>
## Phase Boundary

Bring factsheet-grade GRAPHS to the BLENDED portfolio in the unified composer
(at `/allocations?tab=scenario`, built in Phase 29). Net-new this phase:
- A returns-distribution view (histogram + quantiles) of the blended series (GRAPH-02).
- Rolling Sharpe / volatility / Sortino of the blended series (GRAPH-03).
- Equity + drawdown presented in the DESIGN.md factsheet chart-stack visual
  identity (GRAPH-01) — the composer already renders equity + drawdown; this
  phase ensures they read as the factsheet chart stack (reskin to the leaf-chart
  treatment only — no new data path).
- Every projection graph declares its own method, overlap-N, and horizon, and
  shows an honest empty state below the sample floor (GRAPH-04).

All new series come from ONE genuinely-new pure-TS adapter
`src/lib/scenario-blend-panels.ts` consuming the frozen engine's UNROUNDED
`portfolio_daily_returns` — NEVER by editing the engine, NEVER a Python endpoint,
NEVER a new dep.

**Out of scope this phase (LOCKED):** the graphs-lead / collapsible layout
(Phase 31 — this phase just ADDS the panels in a reasonable position below the
existing projection; it does NOT make graphs lead or controls collapse); any
`/scenarios` retirement (Phase 32); Bridge continuity / WCAG audit (Phase 33);
peer / percentile / signature ranking of the blend (LOCKED honesty invariant —
never).

</domain>

<decisions>
## Implementation Decisions

### The new adapter (the one new file)
- `src/lib/scenario-blend-panels.ts` — pure TS, zero deps. Consumes
  `portfolio_daily_returns` (full-res, unrounded) from `computeScenario`'s output.
  Derives: returns-distribution buckets + quantiles, and rolling Sharpe / vol /
  Sortino series. A `scenario-blend-panels.test.ts` pins the conventions.
- **Convention pins (LOCKED exit gate):** rolling vol = sample-std × √252;
  rolling Sortino divides downside RMS by the TOTAL window n (mirror the engine);
  rolling Sharpe = windowed mean × 252 ÷ windowed vol; degenerate windows
  (`series.length < window`, < 10 points, non-finite) return `[]`. NO `√365` /
  `*365` / `√250` anywhere. Read `portfolio_daily_returns`, never the rounded
  `equity_curve`.

### The panels (reuse factsheet LEAF charts only)
- Reuse the factsheet LEAF chart components (plain-prop, e.g.
  `ReturnHistogram` / `ReturnQuantiles` / the rolling-metrics leaf charts) — they
  take a plain series and have 0 `strategyId` / `fetch` refs. NEVER the
  `strategyId`-coupled panel WRAPPERS (those lazy-fetch per-strategy DB and are
  unusable on a blend).
- GRAPH-01 equity/drawdown: the composer's existing equity + drawdown charts ARE
  the projection charts; align them to the DESIGN.md factsheet chart-stack
  treatment (visual identity only — no new data path, reuse the existing
  `portfolio_daily_returns`-derived equity/drawdown).
- Placement: add the new distribution + rolling panels in the projection region
  (below the KPI strip / existing equity-drawdown). Do NOT reorder to graphs-lead
  or add collapsibility — that is Phase 31.

### Honesty (LOCKED exit gates)
- The R3 / IMPACT-02 `percentile-rank-badge` guard stays non-vacuous on the
  composer AND on EVERY new panel (a positive control proves non-vacuity). NO
  import of `FactsheetBody` / `MetricsColumn` /
  `buildAllocatorPortfolioFactsheetPayload`; NO `ingestSource:"api"` literal on
  the blend path. NO Trade/Position or Greeks panel on the blend (structurally
  omitted).
- Every new panel has a tested degenerate-empty branch keyed off
  `portfolio_daily_returns.length` and renders its OWN method / overlap-N /
  horizon disclosure — the page-level PROJECTED badge is NOT sufficient.

### Frozen engine
- ZERO diff to `src/lib/scenario.ts` / `src/lib/scenario.test.ts` (CI diff check);
  the full SCENARIO-05 suite passes unchanged. 252-day annualization only.

### Claude's Discretion
- The rolling window length default (e.g. 63-day ≈ quarter vs 30/90) — resolve in
  the plan-phase research pass against the typical `portfolio_daily_returns`
  length; pick a default that yields a non-trivial series above the sample floor.
- Histogram bin count + quantile set defaults — at the implementer's discretion
  within DESIGN.md, mirroring the factsheet leaf charts' existing defaults.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/strategy-v2/` factsheet panels — the LEAF charts (ReturnHistogram,
  ReturnQuantiles, Rolling*Chart, etc.) take plain props and are reusable on a
  blended series; the panel WRAPPERS are `strategyId`-coupled and are NOT.
- `src/lib/scenario.ts::computeScenario` — emits `portfolio_daily_returns`
  (full-res, unrounded). Frozen (SCENARIO-05 pins). Reuse output; do not edit.
- The Phase-29 unified composer (`ScenarioComposer.tsx`) — the host; already
  renders the KPI strip + equity + drawdown + the IMPACT-02 PROJECTED honesty
  pill + `percentile-rank-badge` guard.

### Established Patterns
- Per-panel method/overlap-N/horizon disclosure + sample-floor empty states
  (the v1.1.0 disclosure convention).
- 252-day annualization is product-wide.

### Integration Points
- New file: `src/lib/scenario-blend-panels.ts` (+ its test).
- Mount the distribution + rolling panels inside `ScenarioComposer.tsx`'s
  projection region.

</code_context>

<specifics>
## Specific Ideas

- ONE new file (`scenario-blend-panels.ts`); reuse factsheet leaf charts; no new
  deps; no Python endpoint; no engine edit.
- Each panel self-discloses method/N/horizon + honest empty below the sample floor.

</specifics>

<deferred>
## Deferred Ideas

- Graphs-lead layout + collapsible composition controls → **Phase 31**.
- `/scenarios` redirect / ScenarioBuilder delete → **Phase 32**.
- Bridge → composer continuity + WCAG-AA audit → **Phase 33**.
- Exposure / turnover panel on the blend (EXPO-01) → v2 deferred.

</deferred>
