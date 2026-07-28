# Phase 84: Blend & allocation asset-class annualization (#597 part 2) - Context

**Gathered:** 2026-07-10
**Status:** Ready for planning
**Source:** Carried from the shipped single-strategy half (#597, v0.39.0.0 @11143763, PR #599)

<domain>
## Phase Boundary

Make **blended / multi-strategy** KPI surfaces asset-class-aware, completing #597. The single-strategy half already shipped: a strategy's own factsheet/OG/backend KPIs annualize on `strategies.asset_class` (crypto √365 / traditional √252). This phase does the surfaces that combine MULTIPLE strategies into one series: the scenario-composer and the actual allocation/portfolio.

IN SCOPE:
- Scenario-composer blend KPIs (all `computeScenario` / `buildBlendPanels` / `sampleBasisRatios` call sites).
- The actual allocation/portfolio KPIs (allocator-portfolio-payload, allocator.ts reference panels, computeAlphaBeta/scenario-benchmark).
- `scenario-factsheet-payload` preview surface.
- Convert `scenario.ts` CAGR years from count-based to calendar-span.
- CSV-finalize `asset_class` forwarding (the deferred upload-picker persistence).

OUT OF SCOPE: single-strategy surfaces (done in #597); any change to the shipped compute.ts / joint.ts / bootstrap.ts / rolling.ts single-strategy path.
</domain>

<decisions>
## Implementation Decisions (LOCKED — carried from #597 review + user rulings)

### Blend annualization rule (user decision, logged)
- A blended portfolio annualizes on **√365 if ANY constituent leg is crypto, else √252**. Rationale: the blended daily return series is calendar-daily (7-day) the moment a crypto leg is present, so it has ~365 obs/year. A pure-tradfi blend (all legs traditional) stays √252.
- Derive it: `blendPeriodsPerYear(legs) = legs.some(l => l.asset_class === 'crypto') ? 365 : 252`. Single place, mirrors `annualizationPeriods()` in `src/lib/closed-sets.ts`.

### Two clocks (from the shipped #597 convention — do not violate)
- RISK metrics (Sharpe/Sortino/vol/alpha/tracking-error/info-ratio/treynor) ride the FREQUENCY clock (√periodsPerYear).
- RETURN/CAGR rides the CALENDAR clock (days/365.25), asset-class-INVARIANT. In `scenario.ts` today CAGR is count-based (`years = n / periodsPerYear`), an approximation valid only for dense axes. Convert it to calendar-span years from the date axis (per the Fable CAGR ruling; matches compute.ts + Python TWR-05).
- Peer-percentile ranks the RAW annualized Sharpe/Sortino — **NO basis rescale** (annualized Sharpe is frequency-invariant). Do NOT reintroduce a √(252/365) "correction" (rejected in #597; it penalizes 24/7 sleeves ~17%).

### Threading mechanism (mirror #597)
- The engine functions already carry a trailing `periodsPerYear = 252` param (added but currently INERT — no caller passes non-default). Wire the callers to pass the blend basis.
- Populate `StrategyForBuilder.asset_class` in the scenario adapters (currently the field exists on the type but no adapter writes it). Then each `computeScenario` call site derives `blendPeriodsPerYear` from the active units' asset_class and passes it.
- Default 252 must stay byte-identical for any pure-tradfi / unknown blend (regression-pin it).

### Call sites to thread (from #597 specialist sweep)
- `computeScenario`: ScenarioComposer.tsx:2317, scenario-compare.ts:287, share-resolve.ts:273, queries.ts:2169, scenario.ts:758.
- `buildBlendPanels`: ScenarioComposer.tsx:2647. `sampleBasisRatios`: ScenarioComposer.tsx:2692 (NOTE: sample-basis-ratios is ALSO the peer-rank replica — peer ranking needs a consistent cohort basis; keep peer-rank on its own basis, only the blend DISPLAY metrics move).
- `scenario-factsheet-payload.ts:332` (`compute(rets, datesR)` — the scenario-mode factsheet preview).
- Allocation/portfolio: `allocator.ts:79-80` (reference panels — 60/40 pure-tradfi=252, any BTC/ETH-legged blend=365), `computeAlphaBeta` (scenario-benchmark.ts:152, AlphaBetaDecomposition), `allocator-portfolio-payload.ts`.

### CSV-finalize forwarding
- `CsvSubmitStep` → `csv-finalize` route currently drops the wizard `asset_class` picker value. Forward + persist it (mirror the finalize-wizard force-derive pattern, but CSV strategies KEEP the user's picker choice — they can be traditional).

### Claude's Discretion
- Exact helper name/location for `blendPeriodsPerYear`; how to thread asset_class through the scenario adapter unit construction; whether to derive the blend basis inside `computeScenario` vs at each caller (prefer caller-side to keep the engine's pure param contract).
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The shipped single-strategy pattern to mirror
- `src/lib/closed-sets.ts` — `annualizationPeriods(assetClass)` + `calendarYears(firstMs,lastMs)` helpers (the pattern; add a blend sibling).
- `src/lib/factsheet/build-payload.ts` — how #597 threaded periodsPerYear from asset_class through single-strategy KPIs (the model for blend threading).
- `analytics-service/services/metrics.py` — `periods_per_year_for_asset_class` + founder decision TWR-05 (CAGR calendar clock).

### Frozen-engine awareness
- `src/lib/scenario.ts` — the projection engine; ALREADY a phase-52 frozen-spine carve-out (ADR-001 + #597). Its `periodsPerYear` param exists. Editing it is allowed (reviewed math edit) but its scenario.test.ts pins the 252 math — keep default byte-identical.
- `src/lib/sample-basis-ratios.ts` — the parity-pinned replica of computeScenario's ratio math AND the peer-rank basis. Thread carefully; peer-rank stays on its cohort basis.

### Memory
- `project_597_asset_class_annualization` (memory) — full conventions, the blend rule, and the call-site list.
</canonical_refs>

<specifics>
## Specific Ideas
- Every supported exchange is crypto today, so in practice most real blends → 365; a pure-CSV-tradfi blend is the 252 case that must stay byte-identical.
- Regression tests: a blend with ≥1 crypto leg annualizes √365; a pure-tradfi blend stays √252 (byte-identical to today); scenario CAGR is calendar-based (gap-robust); peer-rank unchanged (no rescale).
</specifics>

<deferred>
## Deferred Ideas
- None specific to this phase. EURR pinned-$1.0 and other v1.9 items are separate.
</deferred>

---

*Phase: 84-blend-allocation-asset-class-annualization*
*Context: 2026-07-10, carried from #597*
