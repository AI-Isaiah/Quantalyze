# Architecture Research — v1.2.2 scenario-tab-factsheet-parity

**Domain:** Integrate the REAL factsheet `FactsheetBody` onto a hypothetical scenario blend in the `/allocations` composer — feed the existing factsheet a COMPLETE `FactsheetPayload` synthesized from the blend.
**Researched:** 2026-06-25
**Confidence:** HIGH (every integration point read in full against live source: `scenario-factsheet-payload.ts`, `ScenarioFactsheetChart.tsx`, `FactsheetView.tsx`, `MetricsColumn.tsx`, `factsheet-context.tsx`, `MandatePanels.tsx`, `BatchDPanels.tsx`, `types.ts`, `build-payload.ts`, `compute.ts`, `scenario.ts`, `scenario-blend-panels.ts`, `correlation-math.ts`, `scenario-adapter.ts`, and the composer mount site)

> Supersedes the v1.2 (Allocator Cohesion) ARCHITECTURE.md. v1.2's question was integration *topology* (which surfaces collapse into one). v1.2.2's question is *component reuse depth*: feed the existing `FactsheetBody` a complete synthesized payload so the composer renders a full factsheet on the blend — factsheet files stay byte-identical.

---

## North-Star Restated (the design constraint, not an option)

Do **not** rebuild any factsheet UI. **Take the existing factsheet wholesale and feed it the blend.** The milestone collapses to:

1. **ONE adapter** — extend `buildScenarioFactsheetPayload` from *minimal* (charts-only) to *complete* (every metric computed client-side from the blend's `portfolio_daily_returns`).
2. **Mount the REAL `FactsheetBody`** (already exported, already prop-gated) under the existing `<FactsheetProvider persist={false}>`.
3. **ONE genuinely new panel** — constituent correlation matrix (already-computed by the engine; render-only addition).
4. Factsheet files stay **byte-identical** (additive-only props, exactly like Phase 38's `persist?: boolean`).

The entire heavy lift is the adapter. Everything else is wiring + gating.

---

## Standard Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  ScenarioComposer.tsx  (/allocations — the host, FROZEN engine above)  │
│                                                                        │
│   computeScenario(deAliased) ──► scenarioMetrics                       │
│        │                            ├─ portfolio_daily_returns[]  ◄── THE BLEND SERIES
│        │                            ├─ correlation_matrix         ◄── CONSTITUENT ρ (already computed)
│        │                            └─ equity_curve / effective_*       │
│        ▼                                                                │
│   deAliased.strategies[]  (per-constituent daily_returns + names)  ◄── CONSTITUENT SERIES
│        │                                                                │
│        ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │  buildScenarioFactsheetPayload  (EXTEND minimal → complete)   │     │ ← the ONE adapter
│  │   reuses factsheet/compute.ts compute(), bootstrap, calmar,   │     │
│  │   period-buckets, streak, style-drift, stress-windows,        │     │
│  │   comparator-block  →  a COMPLETE FactsheetCsvPayload         │     │
│  └───────────────────────────┬──────────────────────────────────┘     │
│                              ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐     │
│  │  <FactsheetProvider payload={synth} persist={false}>          │     │ ← UNCHANGED provider
│  │     <FactsheetBody payload={synth}                            │     │ ← REAL component, additive props
│  │        hideHeader hideFooter hideAllocatorSection             │     │
│  │        scenarioMode />     ← NEW additive flag (default off)  │     │
│  │  </FactsheetProvider>                                         │     │
│  └──────────────────────────────────────────────────────────────┘     │
│                                                                        │
│   Constituent-Correlation panel — render scenarioMetrics.correlation_  │ ← the ONE new panel
│   matrix (existing <CorrelationHeatmap> already mounted at :2352)      │
└──────────────────────────────────────────────────────────────────────┘
                       SHARED (do NOT touch its byte output)
        /factsheet/[id]/v2/* ── real route ── + Overview EquityChartWidget
```

### Component Responsibilities

| Component | Responsibility | Status |
|-----------|----------------|--------|
| `computeScenario` (`src/lib/scenario.ts`) | FROZEN. Produces `portfolio_daily_returns` (unrounded blend daily returns) + `correlation_matrix` (per-constituent ρ) + `equity_curve`. | **Frozen — read only** |
| `buildScenarioFactsheetPayload` (`.../performance/scenario-factsheet-payload.ts`) | The adapter. Extend from minimal (charts) to complete (full metric set). | **MODIFY (additive)** |
| `factsheet/compute.ts` `compute()` | Pure `(rets[], dates[]) → ComputeResult` — produces the ENTIRE scalar set (skew/kurt/var95/cvar95/win_rate/profit_factor/mtd/ytd/p3m/p6m/p1y/best-worst-period/yearly/recovery/pain/ulcer/tail/omega). | **Reuse as-is** |
| `bootstrap.ts`, `calmar-by-year.ts`, `streak.ts`, `period-buckets.ts`, `style-drift.ts`, `stress-windows.ts`, `comparator-block.ts`, `compute.ts::worstDrawdowns/cumEq`, `rolling.ts` | Pure factsheet builders the real `buildFactsheetPayload` already composes. | **Reuse as-is** |
| `FactsheetBody` (`FactsheetView.tsx`) | The full article body (KpiStrip + SectionNav + ControlBar + body grid + MetricsColumn). Already exported, already takes `hideHeader/hideFooter/hideAllocatorSection/topSlot`. | **MODIFY (one additive prop)** |
| `FactsheetProvider` (`factsheet-context.tsx`) | View-state context with `persist?: boolean` (Phase 38). | **Reuse as-is — NO change** |
| `MetricsColumn` | 380px right rail (Performance/Risk/Style/Terms/Benchmark). | **MODIFY (one additive gate)** |
| `<CorrelationHeatmap>` (`@/components/portfolio/`) | Already mounted in composer at line 2352 rendering `scenarioMetrics.correlation_matrix`. | **Reuse — this IS the constituent panel** |

---

## The Minimal Seam (Question 1)

**Recommendation: mount `FactsheetBody`, NOT the top-level `FactsheetView`.**

`FactsheetView` wraps its body in its OWN `<FactsheetProvider payload={...}>` (no `persist` prop → defaults to `true`). Using it would double-wrap the provider and re-enable persistence (clobbering Phase 38's `persist={false}` contract on the shared `/allocations` URL). `FactsheetBody` is already exported (FactsheetView.tsx:156) and documented as "Must be mounted inside a FactsheetProvider" — it is the exact subtree designed for external mounting.

The composer's scenario block becomes:

```tsx
<FactsheetProvider payload={synthComplete} persist={false}>
  <FactsheetBody
    payload={synthComplete}
    hideHeader            // composer owns its own PROJECTED-hypothetical header
    hideFooter            // composer owns closing chrome
    hideAllocatorSection  // already gated to ingestSource==="api" anyway
    scenarioMode          // NEW additive flag — see Q2
  />
</FactsheetProvider>
```

This **subsumes** the current `ScenarioFactsheetChart` (which mounts only `TimeSeriesChart` + `MasterBrush` + a `PeriodControl`). `FactsheetBody` already renders `MasterBrush`, the full `PerformanceCharts` set, distribution/heatmap/stress sections, and `MetricsColumn` — all under one shared provider. The Phase-38 `ScenarioFactsheetChart` either retires into this body or stays as the equity/drawdown lead with the full body mounting below it (a build-order call — see Phasing).

### Reusable as-is vs blend-incompatible (component-level)

| Factsheet component | Reads | Verdict |
|---------------------|-------|---------|
| `KpiStrip` | `strategyMetrics` (+ active comparator joint) | **As-is** once adapter fills `strategyMetrics` |
| `MasterBrush`, `TimeSeriesChart`, `PerformanceCharts` | `dates`, `strategyEquity/Returns/Rolling*`, `strategyDrawdowns`, `comparators` | **As-is** (Phase 38 proves the chart path) |
| `HistogramChart`, `QuantileBoxPlotPanel`, `EndOfYearBarsPanel` | `strategyReturns`, `quantiles`, `calmarByYear`/`yearly` | **As-is** once adapter fills them |
| `MonthlyReturnsHeatmap`, `DailyReturnsHeatmap` | `monthlyReturns`, `dailyHeatmap` | **As-is** once adapter fills them |
| `StressWindowsPanel` | `stressWindows` | **As-is** — `computeStressWindows(...)` is pure |
| `StreakDistributionPanel`, `CalmarByYearPanel`, `BootstrapCIPanel` | `streaks`, `calmarByYear`, `bootstrapCI` | **As-is** once adapter fills them |
| `MetricsColumn` Performance/Risk sections | `strategyMetrics`, `quantiles`, `strategyWorst10`, `strategyRolling*` | **As-is** once adapter fills them |
| `StyleDriftPanel` | `styleDrift` (50/50 split + KS) | **As-is** — `computeStyleDrift(blendRet, dates)` is pure and meaningful on a blend |
| `PeerPercentilePanel` | `payload.peerPercentile` (api-arm only) | **Blend-incompatible** — see Q2/Q4 |
| `StrategyThesisPanel`, `TermsPanel` | `strategyName/Types/markets/trustTier/startDate` + `strategyMetrics.{n,years,start,end}` | **Renders, but reads single-strategy registry framing** — see Q2 |
| `LeverageProfilePanel` | nothing (returns `null`) | **As-is** (already inert) |
| `SignaturesSection`/`CrossSignaturesSection` | gated `ingestSource === "api"` | **Suppressed by construction** (synth is `csv`) |
| `AllocatorSection` | `payload.allocatorPortfolios` (api-arm) | **Suppressed by construction** + `hideAllocatorSection` |

---

## Per-Panel Data Sourcing Classification (Question 2)

Key: **(a)** renders fine from a complete blend payload · **(b)** needs a NEW client-side computation IN THE ADAPTER · **(c)** blend has no native source → gate/derive without forking.

| Panel / Section | Payload field(s) | Class | Adapter action |
|-----------------|------------------|-------|----------------|
| **KpiStrip** (Cum/CAGR/Sharpe/Sortino/Calmar/MaxDD/Vol + α/IR) | `strategyMetrics`, comparator `joint` | **b** | `compute(blendRet, dates)` fills `strategyMetrics`; comparator `joint` via `buildComparatorBlock` |
| **Compound Performance** (start/end/years) | `strategyMetrics.{start,end,years}` | **b** | from `compute()` |
| **Main Metrics** (skew/kurtosis incl.) | `strategyMetrics.{skew,kurt,...}` | **b** | from `compute()` |
| **Returns** (MTD/YTD/3M/6M/1Y/win-rate/profit-factor) | `strategyMetrics.{mtd,ytd,p3m,p6m,p1y,win_rate,profit_factor}` | **b** | from `compute()` (derives all period returns) |
| **EoY Returns** | `strategyMetrics.yearly` + comparator `dailyReturns` | **b** | `compute()` + comparator block |
| **Rolling Metrics** (Now/Avg/Min/Max) | `strategyRolling{Vol,Sharpe,Sortino}`, `rollingWindow` | **b** | `rolling.ts` + `pickRollingWindow` |
| **Cumulative Return Metrics** (3Y/5Y/inception) | `strategyEquity`, `strategyMetrics` | **a** | panel self-derives 3Y/5Y from `strategyEquity` |
| **Max Drawdown / VaR / CVaR / Avg Win-Loss** | `strategyMetrics.{max_dd,longest_dd,var95,cvar95,avg_win,avg_loss}` | **b** | from `compute()` |
| **Bootstrap CI** (Sharpe/Sortino/MaxDD) | `bootstrapCI` | **b** | `bootstrapCI(blendRet)` (v1.1 block-bootstrap, pure) |
| **Best/Worst Period** | `strategyMetrics.best_*/worst_*` | **b** | from `compute()` |
| **Calmar-by-Year** | `calmarByYear` | **b** | `calmarByYear(blendRet, dates)` |
| **Worst-10 Drawdowns table** | `strategyWorst10`, `dates` | **b** | `worstDrawdowns(blendDd, 10)` |
| **Extended Metrics** (omega/tail/recovery/pain/ulcer/P5/P50/P95) | `strategyMetrics.*`, `quantiles` | **b** | `compute()` + `quantileSummary(blendRet)` |
| **Quantile box-plot** | `quantiles` | **b** | `quantileSummary(blendRet)` |
| **Histogram / EoY bars** | `strategyReturns`, `calmarByYear` | **b** | adapter must set `strategyReturns = blendRet` (currently `[]`) |
| **Monthly + Daily heatmaps** | `monthlyReturns`, `dailyHeatmap` | **b** | `monthlyReturnsMatrix` + `dailyReturnsByYear` |
| **Stress Windows** | `stressWindows` | **b** | `computeStressWindows(dates, blendRet, btcRet, "BTC", markets)` |
| **Streaks** | `streaks` | **b** | `streakLengths` + `streakHistogram` |
| **Style Drift** | `styleDrift` | **b** | `computeStyleDrift(blendRet, dates)` — honest (half-vs-half of the blend's own series) |
| **Benchmark section** (α/β/corr/IR/TE/capture) | comparator `joint` | **b** | `buildComparatorBlock("BTC-USD",...,blendRet,...)` — composer already has `btcWealth` |
| **Peer Percentile** | `peerPercentile` (api-arm) | **c** | **NEW honest cohort** — user override 2026-06-25; see Q4 |
| **Strategy Thesis** (Mandate) | registry framing | **c** | Re-skin copy for "blend" OR omit via `scenarioMode` |
| **Terms / Fees** (Mandate) | per-strategy fee/lockup placeholders | **c** | **Omit** for a blend via `scenarioMode` |
| **Leverage Profile** (Mandate) | `null` | **a** | already inert |
| **Signatures / Cross-Signatures** | api-arm event studies | **c** | Suppressed by construction (`ingestSource: "csv"`) — no action |
| **Allocator Section** | api-arm demo portfolios | **c** | Suppressed by construction + `hideAllocatorSection` |

**Bottom line:** the adapter swap is overwhelmingly **class (b)** — every (b) row reuses a pure function the REAL `buildFactsheetPayload` already calls (`build-payload.ts:129-231`). Cleanest implementation: **the extended adapter calls the same pure helpers `buildFactsheetPayload` does**, fed `blendRet`/`dates` instead of a strategy's series, then forces `ingestSource: "csv"` so api-only synthesized panels stay absent by construction. Only **(c)** rows need a gating decision.

### Gating the (c) panels WITHOUT forking the component

Three additive mechanisms, in preference order:

1. **Payload discriminant (already exists, zero new code):** `ingestSource: "csv"` already suppresses Signatures, Cross-Signatures, and AllocatorSection at the `FactsheetBody`/`SectionNav` level; `MetricsColumn` already wraps `PeerPercentilePanel` in `payload.ingestSource === "api"`. So Peer/Signatures/Allocator are **already hidden** for the synth payload today. No change needed to keep them hidden.

2. **One additive boolean prop `scenarioMode` (default `false`)** threaded `FactsheetBody → MetricsColumn`:
   - Suppress the Mandate **Terms** section — a blend has no single-manager fees/lockup.
   - Suppress (or blend-reskin) `StrategyThesisPanel`. The panel reads `strategyName/types/markets` from the payload, so the adapter setting `strategyName: "Scenario blend"` degrades the prose gracefully ("is a systematic strategy across …"), but a `scenarioMode` omit is cleaner.
   - This is the *exact* additive pattern of the existing `hideHeader`/`hideFooter`/`hideAllocatorSection` in `FactsheetBodyOptions`. Default `false` ⇒ the real route's byte output is unchanged.

3. **Peer Percentile (the override):** the user explicitly overrode the no-peer-rank-a-hypothetical invariant on 2026-06-25. Showing an honest number would normally require the **api arm** for this field — but that arm also unlocks Signatures/Allocator. **Recommended resolution:** keep `ingestSource: "csv"` (Signatures/Allocator stay suppressed by construction) and surface Peer via the `scenarioMode` prop + a NEW optional `scenarioPeer?: PeerPercentilePayload` field on `FactsheetCsvPayload` (additive; absent for real CSV strategies). `MetricsColumn` renders `PeerPercentilePanel` when `payload.ingestSource === "api"` **OR** (`scenarioMode && scenarioPeer != null`). The cohort comes from the existing `peer-cohort.ts` `computePeerPercentile(blendSharpe, blendSortino, blendMaxDd)`, **labeled honestly** (the panel already prints "Synthesized peer cohort (deterministic seed)"). This keeps the discriminated-union no-invented-data backstop intact for the real route while satisfying the override on the scenario surface. **Flag for the roadmapper / design pass:** confirm whether the cohort is the existing synthesized demo cohort or a real cohort built from the platform strategy DB — a data-sourcing product decision, not an architectural one.

---

## The Constituent-Correlation Panel (Question 3)

**It already exists in the composer and already renders the right data.** `ScenarioComposer.tsx:2352` mounts `<CorrelationHeatmap correlationMatrix={scenarioMetrics.correlation_matrix} … />`, where `correlation_matrix` is the **per-constituent pairwise Pearson matrix the frozen engine computes** over the blend's strategies/API-keys (`ComputedMetrics.correlation_matrix: Record<string, Record<string, number>>`, with `avg_pairwise_correlation` alongside). The de-aliased axis labels (`strategyNames`, line 1531) come from `deAliased.strategies` — the actual constituents (holdings, added catalog strategies, and per-`api_key` units from Phase 37).

So the data the milestone calls "genuinely new" is **not new to compute** — it is the engine's existing output. The only question is **placement**:

- **Recommendation: keep it composer-owned, slotted into the factsheet-shaped layout — do NOT inject it into `FactsheetView`'s section list.** Reasons:
  - The factsheet's own "correlation" (`correlationMatrix` payload field) is **strategy-vs-benchmark** (BTC/ETH/SPX/Gold/IEF) — a different axis. Injecting a constituent matrix into that slot conflates two concepts and forces a factsheet-component fork (violates byte-identity).
  - The constituent matrix has **scenario-only** semantics (diversification across the things YOU composed); it has no meaning on a single-strategy factsheet, so it doesn't belong in the shared component.
  - It is already mounted; the work is to **restyle/reposition** it to read as a factsheet panel (DESIGN.md palette + editorial section eyebrow) and drop it into the new factsheet-shaped composer layout — likely adjacent to `MetricsColumn` or below the Risk section.

- **Per-constituent return series — does the composer already have them?** **Yes, all three sources:**
  - **Holdings / added catalog strategies:** `deAliased.strategies[i].daily_returns` (`DailyPoint[]`, post-collapse, with `.name`).
  - **Per-`api_key` units (Phase 37):** flow through the SAME `deAliased.strategies` path when `usePerKeySources` is active (`buildPerKeyStrategyForBuilderSet` emits a `StrategyForBuilder` per `api_key_id` with `daily_returns`).
  - The matrix itself is already built by `computeScenario` from these — no re-derivation needed. If a future need arises (e.g. a different window), `pearson()`/`rollingCorrelation()` from `correlation-math.ts` are the pure primitives.

**Net:** the "new panel" is mostly a presentation refit of an already-wired heatmap; minimal genuinely new code.

---

## Byte-Identity Strategy (Question 4)

The factsheet component is **SHARED** by three surfaces: the real `/factsheet/[id]/v2` route, the Overview `EquityChartWidget`, and (newly) the scenario composer. Every change must default to today's behavior.

| Change | Mechanism | Byte-identity guarantee |
|--------|-----------|-------------------------|
| Mount full body in composer | Use already-exported `FactsheetBody` + already-exported `FactsheetProvider persist={false}` | Phase 38 proved the `persist` opt-out leaves the real route byte-identical; this adds a new *call site*, not a component edit |
| Suppress Mandate Terms / re-skin Thesis | NEW additive prop `scenarioMode?: boolean` (default `false`) on `FactsheetBodyOptions` + threaded to `MetricsColumn` | Default `false` ⇒ real route + Overview render the identical tree. Same pattern as existing `hideHeader/hideFooter/hideAllocatorSection` |
| Show Peer for the blend | NEW additive optional field `scenarioPeer?` on `FactsheetCsvPayload` + the `scenarioMode && scenarioPeer` OR-branch in `MetricsColumn` | Real CSV payloads never set the field (absent) ⇒ the existing `ingestSource === "api"` gate is the only active branch ⇒ no behavior change |
| Constituent-correlation panel | Composer-owned, OUTSIDE the factsheet component tree | Zero factsheet-file edits |
| Adapter completion | All change inside `buildScenarioFactsheetPayload` (a composer-side file, NOT a factsheet file) | Factsheet files untouched |
| **Frozen-engine guard** | `computeScenario` / `scenario.ts` **never edited**; the adapter consumes its output (`portfolio_daily_returns`, `correlation_matrix`) read-only. `compute()` (factsheet) is a SEPARATE pure metric engine fed the blend series. | `scenario.test.ts` SCENARIO-05 zero-diff pins hold by construction |

**Scope-bounding rule for the roadmapper:** every diff under `src/app/factsheet/[id]/v2/**` and `src/lib/factsheet/**` MUST be additive-only (new optional prop defaulting to current behavior, or new optional payload field). The existing factsheet test files (`format.test.ts`, `factsheet-context.*.test.ts`, `audit-c20.test.ts`) plus the `scenario-factsheet-payload.test.ts` LOCKED pins are the regression gate. A mutation-style oracle (set `scenarioMode={false}` and assert the rendered tree equals the pre-change snapshot for a real payload) is the cleanest byte-identity proof — mirrors the DSRC-03/PARITY-03 falsifiable-oracle pattern the codebase already uses.

**Do NOT touch:** `EquityChartWidget` (Overview) stays on its legacy render (the Phase-38 scope boundary holds). The real route's `page.tsx` and `buildFactsheetPayload` are untouched.

---

## Architectural Patterns

### Pattern 1: Adapter completion by helper reuse (the core move)

**What:** The extended `buildScenarioFactsheetPayload` calls the SAME pure functions `buildFactsheetPayload` composes — fed the blend's daily returns instead of a strategy's.
**When:** This milestone's whole foundation.
**Trade-offs:** Maximum reuse, zero math re-derivation, parity-by-construction with the real factsheet. The one risk is the **two annualization conventions**: `factsheet/compute.ts` annualizes with `√252` (population std, `years = days/365.25`) while `scenario-blend-panels.ts` uses SAMPLE std. The adapter must commit to ONE source per displayed metric. **Recommendation:** drive `strategyMetrics` + the MetricsColumn from `factsheet/compute()` (so KPI strip + rail are factsheet-identical); verify no visible double-standard (a Sharpe in the KPI strip differing from a Sharpe in a rolling panel). This is the single most important correctness check of the milestone.

```typescript
// extended adapter (sketch — fed blendRet/dates instead of strategy series)
const m = compute(blendRet, dates);            // full ComputeResult
const { eq, dd, ...strategyMetrics } = m;
return {
  ingestSource: "csv",                          // keeps api-only panels absent by construction
  strategyName: "Scenario blend",
  dates, strategyReturns: blendRet,
  strategyEquity: cumEq(blendRet),
  strategyDrawdowns: dd,
  strategyWorst10: worstDrawdowns(dd, 10),
  strategyMetrics,
  strategyRollingVol: rollingVol(blendRet, w), /* …Sharpe, Sortino… */
  rollingWindow: pickRollingWindow(blendRet.length),
  bootstrapCI: bootstrapCI(blendRet),
  calmarByYear: calmarByYear(blendRet, dates),
  monthlyReturns: monthlyReturnsMatrix(blendRet, dates),
  dailyHeatmap: dailyReturnsByYear(blendRet, dates),
  styleDrift: computeStyleDrift(blendRet, dates),
  streaks: /* streakLengths + streakHistogram */,
  quantiles: quantileSummary(blendRet),
  stressWindows: computeStressWindows(dates, blendRet, btcRet, "BTC", []),
  comparators: { btc: buildComparatorBlock("BTC-USD","BTC",btcRet,blendRet,...), spx, none },
  // …degenerate-collapse guard preserved verbatim (empty/non-finite → safe empty)…
  scenarioPeer: computePeerPercentile(m.sharpe, m.sortino, m.max_dd) ?? undefined, // Q4 override
};
```

### Pattern 2: Additive prop gating (the byte-identity discipline)

**What:** New behavior enters the shared component as a prop defaulting to false / a payload field defaulting to absent.
**When:** Every edit to a `factsheet/**` file.
**Trade-offs:** Slightly more prop-threading; in exchange the shared component's three consumers cannot drift. The codebase's established convention (`persist?`, `hideHeader?`, the `ingestSource` discriminant).

### Pattern 3: Engine-output, not engine-edit (frozen-engine respect)

**What:** Read `scenarioMetrics.{portfolio_daily_returns, correlation_matrix}`; never edit `scenario.ts`.
**When:** Everywhere the blend's numbers are needed.
**Trade-offs:** None — `portfolio_daily_returns` was explicitly designed (BENCH-01) as the unrounded full-resolution series for this kind of downstream consumption.

---

## Data Flow

### Render Flow

```
toggle / reweight / add-strategy
    ↓
projectionState → deAliased → computeScenario  (FROZEN)
    ↓                               ↓
portfolio_daily_returns      correlation_matrix
    ↓                               ↓
buildScenarioFactsheetPayload   <CorrelationHeatmap>  (constituent panel, composer-owned)
(complete synth, ingestSource:csv)
    ↓
<FactsheetProvider persist={false}> <FactsheetBody scenarioMode …/> </FactsheetProvider>
    ↓
KpiStrip · PerformanceCharts · Distribution · Heatmaps · Stress · Streaks · MetricsColumn
(every panel reads the synth payload; api-only panels absent by construction)
```

### Key Data Flows

1. **Blend → metrics:** `portfolio_daily_returns` (unrounded) → `compute()` → `strategyMetrics` → KpiStrip + MetricsColumn. One series, one metric engine, full parity with the real factsheet.
2. **Blend → charts:** `equity_curve` → `toWealth()` → `strategyEquity`; `deriveSnapshotDrawdowns` → `strategyDrawdowns`. (Shipped in Phase 38; unchanged.)
3. **Constituents → diversification:** `deAliased.strategies[].daily_returns` → engine `correlation_matrix` → heatmap. (Already wired.)
4. **Override → Peer:** blend `compute()` ratios → `computePeerPercentile` → `scenarioPeer` → gated render.

---

## Suggested Build Order / Phase Breakdown (Question 5)

Dependency-ordered, each phase shippable and falsifiable. The frozen-engine constraint is satisfied throughout (no `scenario.ts` edits).

| # | Phase | Depends on | Why this order | Deliverable / oracle |
|---|-------|-----------|----------------|----------------------|
| **1** | **Complete payload adapter** | — | Foundation. Everything downstream reads the complete payload. Pure TS, no UI risk, fully unit-testable in isolation. Resolve the annualization-convention question here (Pattern 1). | Extend `buildScenarioFactsheetPayload`; new unit tests asserting each metric equals `buildFactsheetPayload`'s value for the same series (golden parity, like the TS↔Py optimizer precedent). Degenerate-collapse guard preserved. |
| **2** | **Mount full factsheet body** | 1 | With the payload complete, render the REAL `FactsheetBody` under the existing `persist={false}` provider. Add `scenarioMode` (default false) + thread to `MetricsColumn`; suppress Mandate Terms; decide Thesis copy/omit. Fold the Phase-38 `ScenarioFactsheetChart` equity/drawdown lead into this body. | Body renders; api-only panels confirmed absent. Byte-identity oracle: real-route snapshot unchanged with `scenarioMode={false}`. |
| **3** | **Constituent correlation panel** | 2 | Restyle/reposition the already-mounted `<CorrelationHeatmap>` into the factsheet-shaped layout (DESIGN.md palette + editorial section). Lowest-risk (data already flows). | Panel reads `scenarioMetrics.correlation_matrix` with de-aliased constituent labels; honest empty state for <2 constituents / below overlap floor. |
| **4** | **Peer-cohort override + Mandate disposition** | 1, 2 | The honesty-invariant override. Wire `scenarioPeer` (additive field) + the `scenarioMode && scenarioPeer` gate. Finalize Mandate Thesis/Terms decision. Most needs **design/CEO review** (overrides a locked invariant) and a **fresh-Claude no-invented-data red-team**. | Peer panel renders an honest, labeled number for the blend; real CSV route still suppresses it (field absent). |
| **5** | **Blank/edge states + toggle fold + guards** | 1–4 | Fold the on/off/add-strategy toggles into the factsheet-shaped layout; blank-slate scenario (0/1 active strategy, <10 overlap days, non-finite) → honest empty states across the full body; extend the WCAG-AA composer axe gate; the byte-identity regression test as a permanent gate. | Degenerate inputs render empty states (never fabricated zeros); a11y gate green; factsheet regression pins green. |

**Research flags for the roadmapper:**
- **Phase 1 needs the annualization-convention reconciliation first** — the one real correctness landmine (factsheet `compute()` population-std vs `scenario-blend-panels.ts` sample-std). Likely a short verification spike.
- **Phase 4 (Peer override) is the highest-judgment phase** — it intentionally crosses the no-peer-rank-a-hypothetical invariant PROJECT.md still lists as LOCKED. Route through CEO+Design review + a no-invented-data red-team. The cohort-source decision (synthesized demo vs platform DB) is an open product question.
- **Phases 2, 3, 5 are standard integration** — additive props + reuse, unlikely to need deep research.

---

## Anti-Patterns

### Anti-Pattern 1: Mounting `FactsheetView` instead of `FactsheetBody`
**What people do:** Reuse the top-level `FactsheetView` for the scenario surface.
**Why it's wrong:** `FactsheetView` wraps its own `<FactsheetProvider>` with `persist` defaulting to `true` — double-provider + re-enabled persistence on the shared `/allocations` URL, re-introducing the exact cross-tab bleed Phase 38's RT2 fix closed.
**Do this instead:** Mount the exported `FactsheetBody` under the existing `<FactsheetProvider persist={false}>`.

### Anti-Pattern 2: Forking a panel to make it blend-aware
**What people do:** Copy `PeerPercentilePanel`/`MetricsColumn`/`StrategyThesisPanel` into a scenario variant.
**Why it's wrong:** Forks the shared component → byte-drift, duplicate maintenance, the real route and scenario surface diverge silently.
**Do this instead:** Additive prop (`scenarioMode`) or additive payload field (`scenarioPeer`) defaulting to current behavior.

### Anti-Pattern 3: Editing the frozen engine to emit factsheet metrics
**What people do:** Add skew/kurt/VaR to `computeScenario`'s output because "it already computes the blend."
**Why it's wrong:** Breaks `scenario.test.ts` SCENARIO-05 zero-diff pins and conflates two engines.
**Do this instead:** Feed `scenarioMetrics.portfolio_daily_returns` into the separate pure `factsheet/compute()` inside the adapter.

### Anti-Pattern 4: Injecting the constituent matrix into the factsheet's correlation slot
**What people do:** Overwrite `payload.correlationMatrix` (strategy-vs-benchmark) with the constituent matrix.
**Why it's wrong:** Conflates two semantically different correlation views and forces a factsheet-component edit.
**Do this instead:** Keep the constituent heatmap composer-owned, outside the factsheet tree.

### Anti-Pattern 5: Two annualization conventions on one screen
**What people do:** Charts use sample-std rolling Sharpe while the KPI strip uses population-std `compute()` Sharpe.
**Why it's wrong:** The same metric shows two values → an honesty/credibility failure.
**Do this instead:** Pick one source per displayed metric; verify no visible double-standard in Phase 1.

---

## Integration Points

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `ScenarioComposer` ↔ frozen `scenario.ts` | Read `computeScenario()` output only | `portfolio_daily_returns` + `correlation_matrix` are the contract; never mutate the engine |
| Adapter ↔ `factsheet/compute.ts` + builders | Direct pure-function calls | Same helpers `buildFactsheetPayload` uses; the reuse seam |
| Composer ↔ `FactsheetBody` | Additive props (`scenarioMode`, existing `hide*`) + complete synth payload | The byte-identity boundary |
| `FactsheetBody` ↔ `FactsheetProvider` | `persist={false}` (Phase 38) | Unchanged; prevents URL/localStorage bleed on shared `/allocations` |
| Composer ↔ `<CorrelationHeatmap>` | `scenarioMetrics.correlation_matrix` + de-aliased labels | Already wired (line 2352); the constituent panel |

### External Services

None. Entirely client-side TypeScript reuse — no new API, no Python analytics endpoint, no migration. (The BTC benchmark series the composer fetches for `btcWealth` is the only external data, and it is already wired.)

---

## Sources

- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` — the adapter to extend — HIGH
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` — current minimal mount — HIGH
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — `FactsheetBody` export + `FactsheetBodyOptions` + panel gating — HIGH
- `src/app/factsheet/[id]/v2/MetricsColumn.tsx` — the 380px rail + Peer/Mandate gating — HIGH
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` — `FactsheetProvider persist?` contract — HIGH
- `src/app/factsheet/[id]/v2/MandatePanels.tsx`, `BatchDPanels.tsx` — blend-incompatible panels — HIGH
- `src/lib/factsheet/types.ts` — `FactsheetPayload` discriminated union (csv vs api arms) — HIGH
- `src/lib/factsheet/build-payload.ts` — the model "complete" payload + every pure helper to reuse — HIGH
- `src/lib/factsheet/compute.ts` — `compute()` full `ComputeResult`, `cumEq`, `worstDrawdowns` — HIGH
- `src/lib/scenario.ts` — `ComputedMetrics` (`portfolio_daily_returns`, `correlation_matrix`), frozen engine — HIGH
- `src/lib/scenario-blend-panels.ts` — v1.2 `buildBlendPanels` + the SAMPLE-std annualization convention to reconcile — HIGH
- `src/lib/correlation-math.ts` — `pearson`/`rollingCorrelation` primitives — HIGH
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — host wiring: `scenarioMetrics`, `deAliased.strategies`, per-key path, existing `<CorrelationHeatmap>` + `ScenarioFactsheetChart` mounts — HIGH
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` — `buildPerKeyStrategyForBuilderSet` (per-`api_key` constituent series) — HIGH
- `.planning/PROJECT.md` — north-star directive, locked invariants, Phase-38 precedent — HIGH

---
*Architecture research for: v1.2.2 scenario-tab-factsheet-parity (factsheet-body integration onto the scenario blend)*
*Researched: 2026-06-25*
