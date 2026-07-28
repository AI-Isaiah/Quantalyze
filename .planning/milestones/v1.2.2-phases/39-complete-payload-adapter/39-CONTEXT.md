# Phase 39: Complete payload adapter - Context

**Gathered:** 2026-06-26
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend `buildScenarioFactsheetPayload` (in
`src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts`)
from the minimal payload it produces today into a COMPLETE, valid
`FactsheetCsvPayload` synthesized from the scenario blend's
`portfolio_daily_returns`, using the existing pure-TS `src/lib/factsheet/compute.ts`
helper family as the parity reference. The blend never hits the Python compute.
The `scenario.ts` engine stays FROZEN — this phase only reads its
`portfolio_daily_returns` output. Downstream (Phase 40) mounts the real
`FactsheetBody` on this payload, so the payload must be parity-by-construction
with what the real factsheet route produces from `compute.ts`.

</domain>

<decisions>
## Implementation Decisions

### Adapter Population Scope
- Rolling vol/Sharpe/Sortino fed via the **factsheet helpers** (`rollingVol` /
  `rollingSharpe` / `rollingSortino` from the build-payload path, compute.ts
  convention) — parity-by-construction. Do NOT reuse `scenario-blend-panels.ts`
  (sample-std) for the factsheet body's rolling fields — that would bleed the
  wrong convention.
- Market correlations (ρ vs BTC/ETH/SPX/Gold/IEF) and the market
  `correlationMatrix` stay **honest-empty in Phase 39** — there is no aligned
  benchmark daily series to honestly correlate against, and the
  CONSTITUENT-correlation matrix (engine `correlation_matrix`) is Phase 41's job.
- `stressWindows` is **populated** — `computeStressWindows(returns, dates)` is
  honestly derivable from the blend's own daily returns (return + max-DD during
  named windows), no fabrication.
- Benchmark `comparators` overlay: **keep the existing BTC comparator wiring
  as-is** (BENCH-01 already shipped). No SPX/none expansion this phase.
- Populate every other daily-return-derivable panel array per PAYLOAD-02:
  `monthlyReturns`, `dailyHeatmap`, `calmarByYear`, `bootstrapCI`, `streaks`,
  `quantiles`, `strategyWorst10`, period/EoY buckets, full `strategyMetrics`.

### Sample Floors & Honest-n
- **Trust the engine's gate**: the frozen engine already returns empty
  `portfolio_daily_returns` when n < 10, so the adapter collapses naturally below
  that. The adapter additionally guards empty / any non-finite value → safe empty
  payload. No separate adapter floor constant.
- `strategyMetrics.n` = the **true overlapping-observation count** =
  blend `portfolio_daily_returns.length`, NOT `dates.length` (PAYLOAD-04).
- Reuse the **existing factsheet `n < 252` low-sample caveat unchanged** — it
  fires honestly off the true n.
- Degenerate blends (empty / single-strategy / sub-floor / non-finite) collapse
  to a **safe empty payload** (extend current behavior) — never NaN/Inf into a
  panel, never fabricated zeros presented as real metrics (PAYLOAD-05).

### Golden-Parity Fixture & CI Drift Gate
- Parity tolerance: **`toBeCloseTo(_, 6)`**, matching existing compute/payload
  tests.
- The fixture asserts the synthesized `strategyMetrics` **≡ `compute(blendReturns,
  dates)` field-by-field**, plus a spot-check on one panel array.
- Convention-drift guard: pin a **hand-computed population-std value** that a
  sample-std implementation would fail — so a sample-std bleed from
  `scenario-blend-panels.ts` fails CI loudly (PAYLOAD-03).
- Fixture data: **extend the existing 30-day `SCENARIO` fixture** and **add a
  ≥252-day series** so the `n < 252` caveat boundary is exercised.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/factsheet/compute.ts` — `compute(rets, dates, rf=0)` returns the full
  `ComputeResult` (cagr, ann_vol, sharpe, sortino, calmar, max_dd, skew, kurt,
  tail/omega/common-sense ratios, period returns, best/worst buckets, win_rate,
  profit_factor, var95, cvar95). Also `cumEq`, `drawdowns`, `findDrawdownPeriods`,
  `worstDrawdowns`. Convention: **population stdev**, **252** trading-day vol/Sharpe,
  **365.25** CAGR-years.
- `src/lib/factsheet/build-payload.ts` — the real factsheet's server payload builder
  (`buildFactsheetPayload`, lines 41–275) is the template: it calls `compute()`,
  `cumEq`, `drawdowns`, `worstDrawdowns`, `rollingVol/Sharpe/Sortino`,
  `streakLengths`/`streakHistogram`, `calmarByYear`, `bootstrapCI`,
  `monthlyReturnsMatrix`, `dailyReturnsByYear`, `computeStressWindows`,
  `pickRollingWindow`, and wraps in the discriminated union. Mirror its panel
  assembly (csv arm only).
- Helper modules named in PAYLOAD-02: `bootstrap.ts`, `style-drift.ts`,
  `calmar-by-year.ts`, `period-buckets.ts`, `streak.ts`, `stress-windows.ts`,
  `comparator-block.ts`.
- `deriveSnapshotDrawdowns(scenario)` already used in the minimal adapter.

### Established Patterns
- `deriveIngestSource(dailyRaw)` (build-payload.ts:41) is the single source of
  truth: an array (even empty) → `"csv"`; null/undefined → `"api"`. The csv arm
  PHYSICALLY OMITS the synthesized panels (`peerPercentile`,
  `allocatorPortfolios`, `eventSignatures`, `benchEventSignatures`) — a csv
  consumer cannot read them at compile time.
- `FactsheetPayload` type in `src/lib/factsheet/types.ts:330–449`
  (`FactsheetCommon` + `FactsheetApiPayload` | `FactsheetCsvPayload`).
- Engine output `portfolio_daily_returns`: `Array<{ date: string; value: number }>`
  (decimal daily return), from `computeScenario()` in `src/lib/scenario.ts`
  (field at lines 128/264/463); empty when n < 10.
- Tests assert with `.toBeCloseTo(val, 6)`. Existing fixtures in
  `scenario-factsheet-payload.test.ts` (30-day SCENARIO) and
  `compute.test.ts` / `compute.metrics.test.ts`.

### Integration Points
- `buildScenarioFactsheetPayload` is the sole adapter; its output feeds Phase 40's
  real `FactsheetBody` mount. Keep `ingestSource === "csv"` (never flip to "api").

</code_context>

<specifics>
## Specific Ideas

- North-star (user directive, REQUIREMENTS core value): take the existing factsheet
  wholesale and feed it the blend — reuse maximized, zero new math, zero new deps.
  The adapter's job is to translate, not to compute new metrics.
- Out-of-scope reminder: do NOT unify the population-std (factsheet) vs sample-std
  (engine/blend-graphs) conventions globally — commit `compute.ts` (population) for
  the blend's `strategyMetrics`, leave blend-graph rolling panels on their existing
  convention.

</specifics>

<deferred>
## Deferred Ideas

- Style-drift panel computed on the blend (STYLE-V2-01) — v2.
- Crisis-window sub-correlation / full dendrogram (CORR-V2-*) — Phase 41 brings the
  base constituent correlation; conditioned/visualized variants are v2.

</deferred>
