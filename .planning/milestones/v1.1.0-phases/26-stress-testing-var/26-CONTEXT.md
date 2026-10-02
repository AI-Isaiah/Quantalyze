# Phase 26: Stress Testing & VaR - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — grey-area answers proposed + auto-accepted (no clients yet; decisions taken autonomously). Most areas are pre-locked by the ROADMAP success criteria + the carried v1.1.0 risk gate ("Phase 22's sample-floor gate is the single source of truth reused by 26 + 27 — pin it once") and heavy reuse of the frozen `computeScenario` engine + the Phase-24 β machinery.

<domain>
## Phase Boundary

On the own-book Scenario composer, an allocator applies a **parameterized, β-propagated single-factor (BTC) market shock** and sees a **disclosed downside risk measure** (historical **VaR + CVaR/Expected Shortfall**). The shock propagates through each strategy's **data-derived β to BTC** so a near-market-neutral strategy shows a near-zero hit (not the full shock). VaR/ES/drawdown **scale with leverage** (already baked into `portfolio_daily_returns` via the `w·L·r` weighting — NOT scale-invariant, unlike Sharpe). Every output discloses **method, window, confidence level, and N inline** (never a bare VaR), gates on the **Phase-22 minimum-sample floor** below which it renders the honest empty state, and shows an **em-dash** (never a fabricated 0) for any degenerate input.

In scope: a pure stress/VaR computation lib (over the already-computed `portfolio_daily_returns` + BTC series + per/portfolio β) + a "Stress & VaR" section in the own-book `ScenarioComposer` + golden-fixture tests + honesty/floor tests.

Out of scope (deferred / other phases): Monte-Carlo forward bands (Phase 27), the optimizer (Phase 28), multi-factor / regime-switching shock models, parametric (Normal) VaR, sandbox (example-universe) stress/VaR, any new migration / Python / dependency.
</domain>

<decisions>
## Implementation Decisions

### Area 1 — Shock model (STRESS-01)
- **Single factor = BTC**, reusing the Phase-24 public BTC daily-returns series (`GET /api/benchmark/btc`, already fetched into the composer's `btcDaily` state; `btcAvailable=false` on fetch failure → honest unavailable).
- **β-propagated, linear, historical.** Each strategy's data-derived β to BTC is `cov(r_i, r_btc)/var(r_btc)` over the **inner-joined overlap window** (reuse `computeAlphaBeta` / the `computeScenarioBenchmark` machinery — do NOT re-derive cov/var, do NOT zero-fill non-overlapping dates). Projected portfolio impact of a factor shock `s` = `Σ wᵢ·Lᵢ·βᵢ·s` (equivalently `β_portfolio·s`, since β aggregates linearly and `β_portfolio` is computed on the already-leveraged `portfolio_daily_returns`). A near-market-neutral book → `β_portfolio ≈ 0` → near-zero hit (the load-bearing success-criterion behavior; pin it with a test).
- Show the **headline portfolio impact** for the shock; a **per-strategy β breakdown** (so a near-market-neutral strategy visibly shows ≈0) is planner discretion (nice-to-have; the portfolio invariant is the must).
- **Shock parameterization:** a small set of preset BTC-shock magnitudes (e.g. −10% / −20% / −30%) plus the criterion's "BTC −30%" example as default; a custom magnitude input is planner discretion. Keep the control minimal and DESIGN.md-conformant.
- **Disclosed assumptions (inline, mandatory):** single-factor (BTC only), linear β propagation, **historical β over N overlapping days**, point-in-time (no regime change / no correlation breakdown under stress). End with the "not a forecast" framing.

### Area 2 — Downside measure: historical VaR + CVaR/ES (STRESS-02)
- **Historical / empirical, NOT parametric (no Normal-tail assumption).** VaR = the empirical quantile of `portfolio_daily_returns` (the already-leveraged series) at the confidence level; **CVaR / Expected Shortfall** = the mean of the returns in the tail at/beyond the VaR quantile. Be explicit + consistent about the loss-sign convention and the quantile-interpolation method.
- **Confidence level: 95% headline** (disclosed inline). A 99% level is planner discretion (if shown, disclose it too). Never a bare VaR number.
- **Disclosure (mandatory, inline):** method ("Historical / empirical"), window (`{N} overlapping days` via `methodologyLine(n)`), confidence level ("95%"), and N — plus the "not a forecast" framing. Reuse the `ScenarioBenchmarkSection` methodology-line pattern verbatim.
- **Leverage scaling (load-bearing):** VaR/ES/drawdown are derived from `portfolio_daily_returns`, which already bakes leverage in via `w·L·r`, so they scale automatically. Pin this with a test: doubling uniform leverage ~doubles VaR/ES (monotone, not invariant); contrast with the leverage-invariant Sharpe.

### Area 3 — Floor gating + honesty (STRESS-02 / cross-cutting)
- Gate every tail estimate on the **Phase-22 single source of truth**: `evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS=60)` where `n` is the overlap N used for the estimate. Below floor → `SampleFloorEmptyState` with a stress/VaR `feature` label; `no-usable-n` (null/NaN/Inf/negative) → `noUsableSampleBody`; 0/1-strategy → `fewStrategiesBody`. Do NOT introduce a second floor primitive — reuse the existing one (guard order: no-usable-n FIRST, then below-floor, then ok).
- **Degenerate input → em-dash "—", never a fabricated 0.** A constant/`n<10` series (engine returns null KPIs + empty `portfolio_daily_returns`) → honest absence. Empty-state heading must match its body (the #509 invariant).
- A failed/empty BTC fetch → the shock section degrades to an honest "stress unavailable" empty state (mirror `benchmarkAvailable=false`), never a fabricated impact.

### Area 4 — UI placement
- Mount a new **"Stress & VaR"** section in the own-book `ScenarioComposer`, **after `ScenarioBenchmarkSection`** (the established seam), as a presentational section fed server/engine-resolved props (`portfolioDaily`, `btcDaily`, `benchmarkAvailable`/`btcAvailable`, `n`, leverage-aware metrics) — mirroring `ScenarioBenchmarkSection`'s props-only, unit-testable shape (extract the math into a pure lib so honesty/leverage/floor are testable without mounting the 1900-line composer).
- **Own-book composer ONLY for v1** (consistent with the benchmark section, which the example-universe Strategy Sandbox deliberately does NOT show). Sandbox stress/VaR is deferred.
- Return/percentage form; PROJECTED framing intact; conform to DESIGN.md + reuse existing card/empty-state/typography primitives (no new visual language).

### Claude's Discretion
- Exact quantile-interpolation method; whether to show 99% alongside 95%; the per-strategy β breakdown; the precise shock-control affordance (presets vs custom input); the section's exact layout within the DESIGN.md grid. All deferred to the planner within the locked invariants above.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Engine + leveraged series:** `src/lib/scenario.ts` `computeScenario` → `ComputedMetrics.portfolio_daily_returns` (cumulative-return form, leverage already applied via `w·L·r` at ~line 251; `max_drawdown` at ~line 92; `n<10` → null KPIs + empty series).
- **β / alpha-beta + inner-join:** `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` `computeScenarioBenchmark(portfolioDaily, btcDaily)` (β = cov/var, 252-annualized, intersection-only, constant-benchmark → null not 0); helpers `computeAlphaBeta` in `@/lib/portfolio-stats`.
- **BTC factor series:** `GET /api/benchmark/btc` → daily returns `[{date,value}]`, public-cacheable, error→200-empty; fetched in `ScenarioComposer` (`btcDaily`/`btcAvailable`).
- **Sample-floor SoT (Phase 22):** `src/lib/sample-floor.ts` (`SAMPLE_FLOOR_OVERLAPPING_DAYS=60`, `evaluateSampleFloor`, `belowFloorBody`/`noUsableSampleBody`/`fewStrategiesBody`/`sampleFloorBody`) + `src/components/scenarios/SampleFloorEmptyState.tsx` (heading "Not enough history for this estimate"; renders null on `ok`).
- **Disclosure:** `src/lib/scenario-history.ts` `methodologyLine(n)` ("Historical realized · {n} overlapping days · not a forecast.") + `shortestHistoryName`; `formatPercent`/`formatNumber` render "—" for null.
- **Mount seam:** `ScenarioComposer.tsx` ~line 1574-1580 (`ScenarioBenchmarkSection`); new section mounts after it.

### Established Patterns
- Pure, props-only presentational sections (extract math into a lib; section takes resolved props) — `ScenarioBenchmarkSection` is the template (3 honest empty states; methodology line; em-dash on null).
- Intersection-not-union for any two-series alignment; constant/degenerate → null, never 0.
- Reuse the single sample-floor gate; never a second floor primitive.

### Integration Points
- New pure lib (e.g. `src/app/(dashboard)/allocations/lib/scenario-stress.ts` or `src/lib/scenario-stress.ts`) computing β-propagated shock impact + historical VaR/CVaR over `portfolio_daily_returns`, leverage-aware, floor-gated.
- New presentational `StressVarSection` mounted in `ScenarioComposer` after `ScenarioBenchmarkSection`.
- Tests mirror `scenario-benchmark.test.ts` (golden + intersection + null-safety), `sample-floor.test.ts`, `ScenarioBenchmarkSection.test.tsx`, `SampleFloorEmptyState.test.tsx`.
</code_context>

<specifics>
## Specific Ideas
- VaR(95%) headline + CVaR/ES alongside; "Historical · {N} overlapping days · 95% · not a forecast."
- Shock: BTC −30% default; impact = β_portfolio × shock; near-market-neutral (β≈0) → ≈0 hit (pinned test).
- Leverage test: 2× uniform leverage ⇒ ~2× VaR/ES (monotone), Sharpe unchanged (invariant) — the explicit success-criterion contrast.
- Floor: `evaluateSampleFloor(n, 60)`; below → `SampleFloorEmptyState(feature="stress")`/("VaR").
</specifics>

<deferred>
## Deferred Ideas
- Monte-Carlo forward bands (Phase 27), optimizer (Phase 28).
- Multi-factor / regime-switching shock; parametric (Normal) VaR; correlation-breakdown-under-stress modeling.
- Sandbox (example-universe) stress/VaR; per-strategy β breakdown (if not built); 99% confidence level (if not built).
</deferred>
