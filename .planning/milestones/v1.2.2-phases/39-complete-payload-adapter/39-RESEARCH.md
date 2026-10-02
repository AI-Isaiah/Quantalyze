# Phase 39: Complete payload adapter - Research

**Researched:** 2026-06-26
**Domain:** Pure-TS financial-metrics adapter (no new deps, no new math) — translating a frozen scenario engine's `portfolio_daily_returns` into a complete, parity-by-construction `FactsheetCsvPayload`
**Confidence:** HIGH (entirely first-party codebase; every claim verified against source with file:line)

## Summary

Phase 39 extends `buildScenarioFactsheetPayload` from the minimal "two-chart" payload it produces today (zeroed `strategyMetrics`, `[]` panel arrays) into a COMPLETE `FactsheetCsvPayload` synthesized entirely from the blend's daily-return series via the existing pure-TS `compute.ts` helper family. The server-side `buildFactsheetPayload` (`src/lib/factsheet/build-payload.ts:56–278`) is the exact assembly template: every panel field has a named helper with a known signature, and the adapter mirrors that assembly for the csv arm only.

The single largest landmine is a **data-model mismatch**: the adapter's current input (`args.scenario`) is a cumulative-**WEALTH** series (starts ~1.0), but `compute()` and every factsheet helper consume daily-**RETURNS** (decimal, e.g. 0.012). The phase must thread the engine's `portfolio_daily_returns` (`{ date, value }[]`, value = daily return) — which the composer already holds at the exact mount site — into `ScenarioFactsheetChart`, then into the adapter, and feed THAT to `compute()`. Deriving returns from the wealth series in the adapter is possible but lossy (the wealth series is downsampled + 5-decimal-rounded from `equity_curve`); the unrounded `portfolio_daily_returns` is the correct source and is what `scenario-blend-panels.ts` and the benchmark/stress/MC sections already consume.

The convention reconciliation is clean and already proven: `compute.ts` uses **population** stdev (`pstdev`, n), **252**-day vol/Sharpe/Sortino, **365.25**-calendar-day CAGR. `scenario-blend-panels.ts` deliberately uses **SAMPLE** stdev (`stdDev(slice, true)`, n-1) and `scenario.ts` uses `years = n/252` for CAGR. The locked decision is: feed `strategyMetrics` and ALL factsheet-body rolling fields through the `compute.ts`/`rolling.ts` (population) path; never reuse `scenario-blend-panels.ts` for the factsheet body. A golden fixture pins a hand-computed population-std value that a sample-std bleed fails.

**Primary recommendation:** Add a `portfolioDaily: DailyPoint[]` (daily returns) input to the adapter args, thread `scenarioMetrics.portfolio_daily_returns` to it through `ScenarioFactsheetChart`, and replace the zeroed/empty payload body with the `build-payload.ts` csv-arm assembly recipe (Section: Field-by-Field Assembly Recipe), guarded by a single degenerate gate (empty / any non-finite / `< 2` distinct dates → safe empty) that runs BEFORE any `compute()` call.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Adapter Population Scope**
- Rolling vol/Sharpe/Sortino fed via the **factsheet helpers** (`rollingVol` / `rollingSharpe` / `rollingSortino` from the build-payload path, compute.ts convention) — parity-by-construction. Do NOT reuse `scenario-blend-panels.ts` (sample-std) for the factsheet body's rolling fields — that would bleed the wrong convention.
- Market correlations (ρ vs BTC/ETH/SPX/Gold/IEF) and the market `correlationMatrix` stay **honest-empty in Phase 39** — there is no aligned benchmark daily series to honestly correlate against, and the CONSTITUENT-correlation matrix (engine `correlation_matrix`) is Phase 41's job.
- `stressWindows` is **populated** — `computeStressWindows(returns, dates)` is honestly derivable from the blend's own daily returns (return + max-DD during named windows), no fabrication.
- Benchmark `comparators` overlay: **keep the existing BTC comparator wiring as-is** (BENCH-01 already shipped). No SPX/none expansion this phase.
- Populate every other daily-return-derivable panel array per PAYLOAD-02: `monthlyReturns`, `dailyHeatmap`, `calmarByYear`, `bootstrapCI`, `streaks`, `quantiles`, `strategyWorst10`, period/EoY buckets, full `strategyMetrics`.

**Sample Floors & Honest-n**
- **Trust the engine's gate**: the frozen engine already returns empty `portfolio_daily_returns` when n < 10, so the adapter collapses naturally below that. The adapter additionally guards empty / any non-finite value → safe empty payload. No separate adapter floor constant.
- `strategyMetrics.n` = the **true overlapping-observation count** = blend `portfolio_daily_returns.length`, NOT `dates.length` (PAYLOAD-04).
- Reuse the **existing factsheet `n < 252` low-sample caveat unchanged** — it fires honestly off the true n.
- Degenerate blends (empty / single-strategy / sub-floor / non-finite) collapse to a **safe empty payload** (extend current behavior) — never NaN/Inf into a panel, never fabricated zeros presented as real metrics (PAYLOAD-05).

**Golden-Parity Fixture & CI Drift Gate**
- Parity tolerance: **`toBeCloseTo(_, 6)`**, matching existing compute/payload tests.
- The fixture asserts the synthesized `strategyMetrics` **≡ `compute(blendReturns, dates)` field-by-field**, plus a spot-check on one panel array.
- Convention-drift guard: pin a **hand-computed population-std value** that a sample-std implementation would fail — so a sample-std bleed from `scenario-blend-panels.ts` fails CI loudly (PAYLOAD-03).
- Fixture data: **extend the existing 30-day `SCENARIO` fixture** and **add a ≥252-day series** so the `n < 252` caveat boundary is exercised.

### Claude's Discretion

- North-star (user directive, REQUIREMENTS core value): take the existing factsheet wholesale and feed it the blend — reuse maximized, zero new math, zero new deps. The adapter's job is to translate, not to compute new metrics.
- Out-of-scope reminder: do NOT unify the population-std (factsheet) vs sample-std (engine/blend-graphs) conventions globally — commit `compute.ts` (population) for the blend's `strategyMetrics`, leave blend-graph rolling panels on their existing convention.

### Deferred Ideas (OUT OF SCOPE)

- Style-drift panel computed on the blend (STYLE-V2-01) — v2.
- Crisis-window sub-correlation / full dendrogram (CORR-V2-*) — Phase 41 brings the base constituent correlation; conditioned/visualized variants are v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PAYLOAD-01 | `buildScenarioFactsheetPayload` populates the full scalar metric set from the blend's `portfolio_daily_returns` via `compute()` — no zeroed summary | `compute(rets, dates)` (`compute.ts:15`) returns the full `ComputeResult`; strip `eq`/`dd` per `build-payload.ts:132`. Field-by-Field Assembly Recipe maps every scalar. |
| PAYLOAD-02 | Panel-array fields populated from existing pure helpers, not left empty | Every helper signature documented in Field-by-Field Assembly Recipe + Helper Signature Reference. `comparators.btc` already wired (BENCH-01); other panels follow `build-payload.ts:210–231`. |
| PAYLOAD-03 | Blend metrics use `compute.ts` convention (population stdev, 252 vol/Sharpe, 365.25 CAGR), pinned by golden fixture; sample-std bleed fails CI | Convention divergence point pinned in Annualization Convention Reconciliation; golden fixture shape in Validation Architecture. |
| PAYLOAD-04 | `strategyMetrics.n` = TRUE overlapping-observation count (not `dates.length`) so `n < 252` caveats fire honestly | `compute()` sets `n = rets.length` (`compute.ts:16,156`). Caveat reads `m.n`/`payload.strategyMetrics.n` at `FactsheetView.tsx:664`, `MetricsColumn.tsx:42`, `AnalyticalPanels.tsx:216`. For the blend, `rets.length === portfolio_daily_returns.length === dates.length` so `n` is correct by construction — see Degenerate / Honest-n Handling. |
| PAYLOAD-05 | Degenerate blends collapse to honest empty/safe payload — never NaN/Inf, never fabricated zeros | Engine gate (`scenario.ts:157,210,312`), adapter gate (`scenario-factsheet-payload.ts:199–201`), `compute()` throw-on-empty (`compute.ts:17`). Degenerate-collapse rule documented. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blend daily-return computation | Frozen engine (`scenario.ts::computeScenario`) | — | FROZEN this phase — read-only; produces `portfolio_daily_returns` |
| Daily-return → full factsheet metrics | Pure lib (`compute.ts` + factsheet helpers) | — | Existing population-convention math; zero new code |
| Engine output → `FactsheetCsvPayload` translation | Adapter (`scenario-factsheet-payload.ts`) | — | The one new surface this phase touches; pure TS, no fetch/DOM/time |
| Plumbing `portfolio_daily_returns` to the adapter | Client component (`ScenarioFactsheetChart.tsx`) + composer (`ScenarioComposer.tsx`) | — | New prop wiring; data already in composer scope at mount site |
| Payload → chart rendering | Factsheet engine (`TimeSeriesChart`, `MasterBrush`, Phase 40 `FactsheetBody`) | — | Unchanged consumer; payload must be parity-by-construction |
| Convention isolation (population vs sample) | Pure lib boundary | — | `compute.ts`/`rolling.ts` = population; `scenario-blend-panels.ts` = sample — kept separate, never blended |

## Standard Stack

No external packages. This phase is 100% first-party TypeScript reuse. The "stack" is the existing factsheet helper family.

### Core (all existing, zero new deps)
| Module | Path | Purpose | Why Standard |
|--------|------|---------|--------------|
| `compute` | `src/lib/factsheet/compute.ts:15` | Full scalar `ComputeResult` from daily returns + dates | The population-convention reference the real factsheet uses |
| `cumEq`, `drawdowns`, `worstDrawdowns`, `findDrawdownPeriods` | `src/lib/factsheet/compute.ts:223,234,286,257` | Equity curve / drawdown series / worst-N DD periods | Already used by `build-payload.ts` |
| `rollingVol`/`rollingSharpe`/`rollingSortino`/`pickRollingWindow` | `src/lib/factsheet/rolling.ts:82,92,103,30` | Rolling 6mo (population-std) series + window picker | Population convention — the locked choice for the body |
| `streakLengths`/`streakHistogram` | `src/lib/factsheet/streak.ts:9,48` | Win/loss streak runs + histogram | Pure, daily-return derivable |
| `calmarByYear` | `src/lib/factsheet/calmar-by-year.ts:17` | Per-year Calmar table | Pure |
| `bootstrapCI` | `src/lib/factsheet/bootstrap.ts:31` | Block-bootstrap 95% CIs (SEEDED — deterministic) | Pure + seeded → fixture-safe |
| `monthlyReturnsMatrix`/`dailyReturnsByYear` | `src/lib/factsheet/period-buckets.ts:11,51` | Monthly heatmap + daily calendar | Pure |
| `computeStressWindows` | `src/lib/factsheet/stress-windows.ts:82` | Named-window return + max-DD | Pure; LOCKED to populate |
| `buildComparatorBlock`/`noneComparatorBlock` | `src/lib/factsheet/comparator-block.ts:19,74` | BTC/SPX comparator slices | BTC wiring kept as-is per CONTEXT |
| `deriveSnapshotDrawdowns` | `src/app/(dashboard)/allocations/lib/drawdown.ts:17` | Wealth-series → peak-anchored DD (already in adapter) | Existing; pinned by current test |

### Supporting (referenced but NOT to be reused for the body)
| Module | Path | Purpose | Why NOT for the body |
|--------|------|---------|----------------------|
| `buildBlendPanels` | `src/lib/scenario-blend-panels.ts:130` | Blend-graph rolling series | SAMPLE-std (`stdDev(slice,true)`) — WRONG convention for the factsheet body (locked) |
| `stdDev(_, sample=true)` | `src/lib/portfolio-math-utils.ts:74` | n-1 std | The convention the body must NOT use |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Threading `portfolio_daily_returns` as a new prop | Deriving daily returns from the existing wealth series inside the adapter (`r_i = wealth_i/wealth_{i-1} - 1`) | REJECTED: the wealth series is the downsampled, 5-decimal-rounded `equity_curve` (`scenario.ts:434–447`) → returns derived from it are lossy and would FAIL `toBeCloseTo(_,6)` parity vs `compute(portfolio_daily_returns)`. Use the unrounded engine series. |
| Calling `compute()` directly | Re-deriving scalars by hand | REJECTED: violates zero-new-math north-star; `compute()` IS the parity reference. |

**Installation:** None. `npm install` adds nothing.

## Package Legitimacy Audit

Not applicable — this phase installs zero external packages. All code is first-party reuse within `src/`. No registry interaction, no `npm install`, no slopcheck surface.

## Architecture Patterns

### System Architecture Diagram

```
ScenarioComposer.tsx (client)
  │  computeScenario(deAliased.strategies, state, cache)   [FROZEN engine, scenario.ts:149]
  │     └─► scenarioMetrics.portfolio_daily_returns : {date,value}[]  (daily RETURN, unrounded)
  │     └─► scenarioMetrics.equity_curve ──toWealth──► scenarioWealthSeries (wealth, ~1.0)
  │
  ▼  (NEW PLUMBING — Phase 39)
ScenarioFactsheetChart.tsx (client)
  props: scenarioSeries (wealth, existing), benchmark (wealth, existing),
         portfolioDaily (daily RETURN, NEW)  ◄── scenarioMetrics.portfolio_daily_returns
  │
  ▼
buildScenarioFactsheetPayload(args)  [scenario-factsheet-payload.ts:191]
  │  degenerate gate (empty / non-finite / <2 dates) ──► SAFE EMPTY payload (current behavior)
  │  else:
  │     dates       = portfolioDaily.map(p => p.date)
  │     rets        = portfolioDaily.map(p => p.value)            (daily RETURN)
  │     full        = compute(rets, dates)            [compute.ts:15]  ← population, 252, 365.25
  │     {eq,dd,...strategyMetrics} = full             (strip eq/dd, build-payload.ts:132)
  │     strategyEquity   = cumEq(rets)  OR  scenarioSeries wealth (chart contract — see Pitfall 4)
  │     strategyDrawdowns= drawdowns(eq)  OR  deriveSnapshotDrawdowns(scenario) (current pin)
  │     strategyWorst10  = worstDrawdowns(dd,10)
  │     rolling*         = rollingVol/Sharpe/Sortino(rets, rollWindow.window)
  │     streaks/calmar/bootstrap/monthly/heatmap/quantiles/stress = helpers(rets,dates)
  │     comparators.btc  = (existing BTC wiring, kept)
  │     correlations/correlationMatrix = HONEST-EMPTY (locked; Phase 41 owns constituent corr)
  │
  ▼  FactsheetCsvPayload (ingestSource:"csv")
FactsheetProvider → TimeSeriesChart + MasterBrush  (Phase 38, unchanged)
                  → FactsheetBody (Phase 40, future — consumes the now-complete payload)
```

File-to-implementation mapping is in the Component Responsibilities table below; the diagram is data flow only.

### Component Responsibilities
| Component | File | Phase 39 change |
|-----------|------|-----------------|
| Frozen engine | `src/lib/scenario.ts` | NONE (read-only) |
| Adapter | `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` | Replace zeroed/empty body with full `compute()`-driven assembly + accept `portfolioDaily` input |
| Chart wrapper | `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | Add `portfolioDaily` prop; pass to adapter |
| Composer | `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2224` | Pass `portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}` to the chart |
| Adapter test | `scenario-factsheet-payload.test.ts` | Extend fixtures + add golden-parity + convention-drift assertions |
| Composer test | `ScenarioComposer.test.tsx` | Update `ScenarioFactsheetChart` mock-prop assertions (new prop) |

### Pattern 1: Mirror `build-payload.ts` csv-arm assembly verbatim
**What:** The csv arm of `buildFactsheetPayload` (`build-payload.ts:176–231,277`) is the exact field set the adapter must produce. Copy its `common: FactsheetCommon = {...}` block, substituting honest-empty for the market-correlation fields and keeping the existing BTC comparator wiring.
**When to use:** For every `FactsheetCommon` field.
**Example:**
```typescript
// Source: src/lib/factsheet/build-payload.ts:129–231 (csv arm)
const rollWindow = pickRollingWindow(rets.length);                 // rolling.ts:30
const rollBetaWindow = pickRollingWindow(rets.length, [
  { window: ROLL_WINDOW_90D, label: "90d" },
  { window: ROLL_WINDOW_30D, label: "30d" },
]);
const fullMetrics = compute(rets, dates);                          // compute.ts:15
const { eq, dd, ...strategyMetrics } = fullMetrics;                // strip heavy arrays
// ... strategyEquity, strategyDrawdowns, rolling*, streaks, calmar, bootstrap,
//     monthly, heatmap, quantiles, stress per build-payload.ts:193–231
```

### Anti-Patterns to Avoid
- **Feeding the wealth series to `compute()`:** `compute()` expects daily RETURNS. Passing a wealth series (~1.0 values) produces a ~+100%/day mean and garbage metrics. Use `portfolio_daily_returns`.
- **Reusing `scenario-blend-panels.ts` for the factsheet body:** it is sample-std (n-1). The body is locked to population-std (`compute.ts`/`rolling.ts`).
- **Calling `compute()` before the degenerate gate:** `compute()` THROWS on empty input (`compute.ts:17`). The gate must short-circuit to a safe empty payload first.
- **Setting `n = dates.length` separately:** `compute()` already sets `n = rets.length` (`compute.ts:16,156`). Do not override it. For the blend, `rets.length === dates.length === portfolio_daily_returns.length`, so this is correct automatically (PAYLOAD-04).
- **Fabricating zeros:** the current `zeroedComputeSummary()` (`scenario-factsheet-payload.ts:112–157`) must be used ONLY on the degenerate path, never on the populated path.

## Field-by-Field Assembly Recipe (`FactsheetCsvPayload` csv arm)

> Template: `src/lib/factsheet/build-payload.ts` lines in the `Source` column. `rets` = `portfolioDaily.map(p=>p.value)` (daily RETURN); `dates` = `portfolioDaily.map(p=>p.date)`. All helpers take **daily returns**, not equity, unless noted.

| Payload field | Helper | Exact signature | Input | Returns | Source line |
|---------------|--------|-----------------|-------|---------|-------------|
| `strategyMetrics` | `compute` then strip | `compute(rets:number[], dates:string[], rf=0): ComputeResult` | returns + dates | `ComputeResult` → `const {eq,dd,...strategyMetrics}=full` → `ComputeSummary` | `build-payload.ts:129–132` |
| `strategyReturns` | (identity) | — | `rets` | `number[]` (decimal returns) | `build-payload.ts:116,193` |
| `strategyEquity` | `cumEq` | `cumEq(rets:number[]): number[]` | returns | wealth `number[]` base 1.0 | `build-payload.ts:133` / `compute.ts:223`. **See Pitfall 4 — chart contract may require the wealth series instead.** |
| `strategyDrawdowns` | `drawdowns` (from `compute().dd`) OR `deriveSnapshotDrawdowns` | `drawdowns(eq:number[]):number[]` / `deriveSnapshotDrawdowns(points:DailyPoint[]):{date,value}[]` | equity / wealth points | `number[]` (≤0) | `build-payload.ts:132,200`. Current adapter pins `deriveSnapshotDrawdowns(scenario)` (`scenario-factsheet-payload.ts:205–207`) — **see Pitfall 4**. |
| `strategyWorst10` | `worstDrawdowns` | `worstDrawdowns(dd:number[], n=10): DrawdownPeriod[]` | the `dd` array from `compute()` | `{start,trough,recover,depth}[]` | `build-payload.ts:201` |
| `strategyRollingVol` | `rollingVol` | `rollingVol(rets:number[], window=126): Array<number\|null>` | returns | nulls during warmup | `build-payload.ts:195` / `rolling.ts:82` |
| `strategyRollingSharpe` | `rollingSharpe` | `rollingSharpe(rets:number[], window=126): Array<number\|null>` | returns | nulls during warmup | `build-payload.ts:196` / `rolling.ts:92` |
| `strategyRollingSortino` | `rollingSortino` | `rollingSortino(rets:number[], window=126): Array<number\|null>` | returns | nulls during warmup | `build-payload.ts:197` / `rolling.ts:103` |
| `rollingWindow` | `pickRollingWindow` | `pickRollingWindow(seriesLength:number, tiers?): RollWindowPick` | `rets.length` | `{window,label,enough}` (default tiers 6mo→30d) | `build-payload.ts:123,198` / `rolling.ts:30` |
| `rollingBetaWindow` | `pickRollingWindow` (β tiers) | same, `tiers=[{90d},{30d}]` | `rets.length` | `RollWindowPick` | `build-payload.ts:124–127,199` |
| `streaks` | `streakLengths`+`streakHistogram` | `streakLengths(rets):{wins:number[],losses:number[]}`; `streakHistogram(streaks:number[], maxLen=14):number[]` | returns | `StreakPayload` (MAX_LEN=14) | `build-payload.ts:210–222` / `streak.ts:9,48` |
| `calmarByYear` | `calmarByYear` | `calmarByYear(rets:number[], dates:string[]): CalmarYearRow[]` | returns + dates | per-year rows | `build-payload.ts:223` / `calmar-by-year.ts:17` |
| `bootstrapCI` | `bootstrapCI` | `bootstrapCI(rets:number[], n_resamples=2000, block_len=5, seed=42): BootstrapCISummary` | returns | SEEDED (mulberry32) — deterministic | `build-payload.ts:224` / `bootstrap.ts:31` |
| `monthlyReturns` | `monthlyReturnsMatrix` | `monthlyReturnsMatrix(rets:number[], dates:string[]): MonthlyReturnsRow[]` | returns + dates | one row/year | `build-payload.ts:225` / `period-buckets.ts:11` |
| `dailyHeatmap` | `dailyReturnsByYear` | `dailyReturnsByYear(rets:number[], dates:string[]): DailyHeatmapYear[]` | returns + dates | per-year calendar grid | `build-payload.ts:226` / `period-buckets.ts:51` |
| `quantiles` | local `quantileSummary` | `quantileSummary(rets:number[]): QuantilePayload` | returns | 5-num + min/max/mean | `build-payload.ts:172,305–331`. **Note: this helper is a module-local function in `build-payload.ts`, NOT exported.** Either re-implement the identical pure body in the adapter, or extract it to a shared module. See Open Questions. |
| `stressWindows` | `computeStressWindows` | `computeStressWindows(dates:string[], stratRet:number[], benchRet:number[], benchName:string, markets:string[]=[]): StressWindowPayload` | dates + returns + bench returns | LOCKED to populate | `build-payload.ts:229` / `stress-windows.ts:82`. **THROWS if `dates[0]` is not ISO `YYYY-MM-DD` (`stress-windows.ts:89`)** — blend dates are ISO (engine `commonDates`), so safe. `benchRet` may be the aligned BTC series or the strat's own returns; pass `markets=[]` → catalogue shows all (`classifyMarkets`, `stress-windows.ts:62–66`). |
| `comparators` | `buildComparatorBlock` (BTC kept) / `inertComparatorBlock` | existing | — | KEEP current BTC wiring (BENCH-01) per CONTEXT; the adapter's existing `inertComparatorBlock` + benchmark→`btc.cumulative` align stays | `scenario-factsheet-payload.ts:161–177,227–228` |
| `activeComparator` | (existing) | — | `hasBenchmark ? "btc" : "none"` | unchanged | `scenario-factsheet-payload.ts:258` |
| `correlations` | **HONEST-EMPTY** | — | — | `[]` (locked — no aligned benchmark series to correlate) | CONTEXT locked decision |
| `correlationMatrix` | **HONEST-EMPTY** | — | — | `{labels:[],matrix:[]}` (locked — constituent corr is Phase 41) | CONTEXT locked decision |
| `styleDrift` | **`null`** | `computeStyleDrift(rets,dates):StyleDriftMetrics\|null` exists but is DEFERRED (STYLE-V2-01) | — | `null` | CONTEXT Deferred. Note PAYLOAD-02 lists `styleDrift` in its helper list, but CONTEXT explicitly defers the style-drift PANEL to v2 — **honor CONTEXT: leave `styleDrift: null`.** Flag for planner: REQUIREMENTS PAYLOAD-02 text and CONTEXT conflict here; CONTEXT (later, more specific) wins per project Rule 7. |
| `ingestSource` | (constant) | — | `"csv"` | LOCKED — never flip to "api" (keeps synth panels structurally absent) | `scenario-factsheet-payload.ts:231` |
| FactsheetCommon scalar/meta fields (`strategyName`, `strategyId`, `markets`, `trustTier`, `description`, etc.) | (constants) | — | keep current safe defaults | `scenario-factsheet-payload.ts:232–246` |

### Helper Signature Reference — does it take returns or equity?

| Helper | Takes | Needs dates? | Throws? | Notes |
|--------|-------|--------------|---------|-------|
| `compute` | daily **returns** | YES | `n===0` or `dates.length!==n` → throws (`compute.ts:17`) | `n=rets.length`; population std; 252 vol; 365.25 CAGR |
| `cumEq` | daily **returns** | no | no | wealth base 1.0 |
| `drawdowns` | **equity** (wealth) | no | no | feed `compute().eq` or `cumEq(rets)` |
| `worstDrawdowns` | **dd array** (drawdowns) | no | no | feed `compute().dd` |
| `rollingVol/Sharpe/Sortino` | daily **returns** | no | no | population std; nulls during warmup |
| `pickRollingWindow` | length (number) | no | no | pure |
| `streakLengths` | daily **returns** | no | no | zero-return day breaks both streaks |
| `streakHistogram` | streak lengths (number[]) | no | no | maxLen rollup |
| `calmarByYear` | daily **returns** | YES | no | groups by `dates[i].slice(0,4)` |
| `bootstrapCI` | daily **returns** | no | no | SEEDED (seed=42), deterministic |
| `monthlyReturnsMatrix` | daily **returns** | YES | no (returns `[]` if mismatch) | |
| `dailyReturnsByYear` | daily **returns** | YES | no (returns `[]` if mismatch) | |
| `computeStressWindows` | daily **returns** (strat+bench) | YES | THROWS if `dates[0]` not ISO (`stress-windows.ts:89`) | blend dates are ISO → safe |
| `deriveSnapshotDrawdowns` | **wealth points** (`DailyPoint[]`) | dates carried in points | no | current adapter pin |
| `computeStyleDrift` | daily **returns** | YES | no (returns null if `<4`) | DEFERRED this phase |

## Annualization-Convention Reconciliation (PAYLOAD-03)

### `compute.ts` (FACTSHEET convention — what the body MUST use) [VERIFIED: compute.ts source]
| Quantity | Implementation | Line |
|----------|----------------|------|
| Std dev | **population** `pstdev(xs)` = `sqrt(Σ(x-m)²/n)` (divide by **n**) | `compute.ts:297–301` |
| Ann. vol | `pstdev × sqrt(252)` | `compute.ts:32` |
| Sharpe | `(m·252)/(s·sqrt(252))` with `s=pstdev` | `compute.ts:33` |
| Sortino | downside RMS divides by **n** (total), × sqrt(252) | `compute.ts:36–37` |
| CAGR | `eq[-1]^(1/years) - 1`, `years = (endDate−startDate in days)/**365.25**` | `compute.ts:25–31` |
| `rollingVol/Sharpe/Sortino` | **population** `pstdev` (divide by n), × sqrt(252) | `rolling.ts:82–134` |

### `scenario.ts` engine (DIVERGENT — FROZEN, do NOT mirror for the body) [VERIFIED: scenario.ts source]
| Quantity | Implementation | Line |
|----------|----------------|------|
| Vol | **SAMPLE** variance `/(n-1)` | `scenario.ts:338` |
| Sharpe | `(meanR·252)/volatility` with sample vol | `scenario.ts:341` |
| Sortino | downside RMS `/n` (matches compute) but on sample-vol basis | `scenario.ts:354–361` |
| CAGR | `(1+twr)^(1/years)-1`, `years = **n/252**` (trading-day, NOT 365.25 calendar) | `scenario.ts:332–333` |
| Correlation | **SAMPLE** covariance `/(n-1)` | `scenario.ts:390,420` |

### `scenario-blend-panels.ts` (DIVERGENT — the explicit "do NOT reuse" source) [VERIFIED: scenario-blend-panels.ts source]
| Quantity | Implementation | Line |
|----------|----------------|------|
| Rolling vol | `stdDev(slice, true)` = **SAMPLE** (n-1) × sqrt(252) | `scenario-blend-panels.ts:72` |
| Rolling Sharpe | mean × sqrt(252) ÷ **SAMPLE** std | `scenario-blend-panels.ts:88` |
| Rolling Sortino | downside RMS ÷ total window n × sqrt(252) | `scenario-blend-panels.ts:106` |

### The precise divergence point a golden fixture must pin

**Sample vs population stdev** is the cleanest, most-measurable divergence. For a series of `n` daily returns with sum-of-squared-deviations `SS`:
- population (compute.ts): `σ_pop = sqrt(SS/n)`
- sample (blend-panels):  `σ_samp = sqrt(SS/(n-1))`
- ratio: `σ_samp/σ_pop = sqrt(n/(n-1))`

This ratio propagates into `ann_vol` (and inversely into Sharpe). For a **30-day** series, `sqrt(30/29) ≈ 1.0170` — a **1.70%** difference in `ann_vol`, far larger than the `toBeCloseTo(_,6)` (1e-6) tolerance. A sample-std bleed therefore fails the golden assertion loudly even on the small fixture.

**Recommended pin:** assert the synthesized `strategyMetrics.ann_vol` (and `sharpe`) equal `compute(blendReturns, dates).ann_vol` to 6 decimals, PLUS a hand-computed population value. Worked example for the existing-style 30-day fixture `rets[i] = i%2===0 ? 0.01 : -0.005` (from `compute.metrics.test.ts:6`):
- mean `m = (15·0.01 + 15·(-0.005))/30 = 0.0025`
- each even day dev `= 0.0075`, each odd day dev `= -0.0075`; `SS = 30·0.0075² = 30·5.625e-5 = 1.6875e-3`
- `σ_pop = sqrt(1.6875e-3/30) = sqrt(5.625e-5) = 0.0075` exactly
- `ann_vol_pop = 0.0075·sqrt(252) ≈ 0.119059…`
- `σ_samp = sqrt(1.6875e-3/29) = 0.0076286…` → `ann_vol_samp ≈ 0.121102…` (differs at the 3rd decimal → fails `toBeCloseTo(_,6)`)

Pin `expect(strategyMetrics.ann_vol).toBeCloseTo(0.119059, 6)` (recompute the exact constant in-test from `0.0075*Math.sqrt(252)` to avoid a hand-typo). A sample-std implementation yields ~0.12110 and fails.

**Also note (CAGR axis):** `compute()` derives `years` from calendar days (`365.25`), so the fixture's `dates` array spacing matters. Use consecutive calendar days (as the existing fixtures do via `setUTCDate(+i)`) so CAGR is deterministic and reproducible. Do NOT compare CAGR against the engine's `n/252` value — they intentionally differ; the parity assertion is adapter-output vs `compute()`, not adapter-output vs engine.

## Degenerate / Honest-n Handling (PAYLOAD-04, PAYLOAD-05)

### Engine gate (FROZEN — the adapter trusts it) [VERIFIED: scenario.ts source]
`computeScenario` returns `portfolio_daily_returns: []` on every degenerate path:
- `activeIds.length === 0` → empty (`scenario.ts:157–174`)
- `n < 10` (union date count below floor) → empty (`scenario.ts:210–227`)
- `anyNonFinite || minCumulative <= 0` (NaN/Inf contamination or catastrophic loss) → empty (`scenario.ts:302–329`)

On the success path, `portfolio_daily_returns = commonDates.map((date,i)=>({date, value:portDaily[i]}))` (`scenario.ts:264–267`) — exactly `n` points, one per common date, unrounded. So **`portfolio_daily_returns.length === n === dates.length`** by construction. This is why PAYLOAD-04 is satisfied automatically: feeding `rets = portfolio_daily_returns.map(p=>p.value)` to `compute()` sets `strategyMetrics.n = rets.length` = the true overlapping-observation count.

### Adapter gate today (minimal payload) [VERIFIED: scenario-factsheet-payload.ts source]
```typescript
// scenario-factsheet-payload.ts:199–201
const degenerate =
  scenario.length === 0 ||
  scenario.some((p) => !Number.isFinite(p.value));
```
Today this guards the WEALTH input. Phase 39 must extend it to also guard the NEW `portfolioDaily` (returns) input, since that is what `compute()` consumes.

### `build-payload.ts` floor for comparison [VERIFIED: build-payload.ts source]
The real factsheet builder requires `>= 2` distinct dated observations and returns `null` below that (`build-payload.ts:101–112`); `!dailyReturns.length → null` (`build-payload.ts:80`). The scenario adapter does NOT return null (its return type is non-nullable `FactsheetCsvPayload`) — it returns a safe empty payload instead. Keep that contract.

### Precise rule the adapter needs
1. Compute `rets = portfolioDaily.map(p=>p.value)`, `dates = portfolioDaily.map(p=>p.date)`.
2. **Degenerate if:** `portfolioDaily.length === 0` OR `rets.some(v => !Number.isFinite(v))` OR `dates.length < 2` (compute's CAGR/period math needs ≥2 dated points; `compute()` itself only throws on `n===0`, but a single observation yields a meaningless 0-vol payload — collapse it). The engine's `n<10` floor means the adapter realistically sees either `[]` or `length>=10`, but guard defensively.
3. **If degenerate:** return the existing safe-empty payload (`zeroedComputeSummary()` + empty arrays) — current behavior, no NaN/Inf, no fabricated metrics presented as real.
4. **Else:** call `compute(rets, dates)` and assemble the full body. `n` flows through `strategyMetrics.n` untouched.

### Where `n` lives and where the caveat fires [VERIFIED: source grep]
- `n` lives at `strategyMetrics.n` (`ComputeSummary.n`, set by `compute()` `compute.ts:156`).
- The `n < 252` low-sample caveat reads `payload.strategyMetrics.n` at THREE sites — all UNCHANGED, fire honestly once `n` is real:
  - `FactsheetView.tsx:664` — hero-strip warning (`m.n < 252`)
  - `MetricsColumn.tsx:42` — right-rail caveat
  - `AnalyticalPanels.tsx:216` — `const lowN = payload.strategyMetrics.n < 252`
- The ≥252-day fixture (CONTEXT) exercises the boundary: a 30-day blend → `n=30` → caveat ON; a 252-day blend → `n=252` → caveat OFF (`m.n < 252` is false at exactly 252).

## Runtime State Inventory

Not applicable — this is a greenfield code-extension phase (new payload fields + new prop), not a rename/refactor/migration. No stored data keys, no live-service config, no OS-registered state, no secrets, no build artifacts carry a renamed string. **None — verified by phase scope (pure-TS adapter + prop plumbing, no persistence layer touched).**

## Common Pitfalls

### Pitfall 1: WEALTH-vs-RETURNS input mismatch (HIGH severity)
**What goes wrong:** Feeding `args.scenario` (wealth, ~1.0) to `compute()` produces a ~+100%/day mean return → astronomically wrong CAGR/vol/Sharpe.
**Why it happens:** The adapter's existing input IS wealth (`scenario-factsheet-payload.ts:204`, `strategyEquity = scenario.map(p=>p.value)`); `compute()` silently accepts any `number[]` and won't throw.
**How to avoid:** Thread the engine's `portfolio_daily_returns` (daily returns) as a NEW input and feed THAT to `compute()`. Never derive metrics from the wealth series.
**Warning signs:** `cum_ret` in the thousands of percent; `ann_vol` near 0 (wealth is near-constant ~1.0 so its "returns" interpreted directly look low-variance).

### Pitfall 2: Lossy derivation from the downsampled wealth series (HIGH severity)
**What goes wrong:** If you instead derive returns from `scenarioWealthSeries`, parity vs `compute(portfolio_daily_returns)` fails at 6 decimals.
**Why it happens:** `scenarioWealthSeries` comes from `equity_curve`, which is **downsampled every 5 business days and rounded to 5 decimals** (`scenario.ts:434–447`). `portfolio_daily_returns` is full-resolution + unrounded (`scenario.ts:117–127, 264–267`).
**How to avoid:** Always source from `portfolio_daily_returns`.
**Warning signs:** golden `toBeCloseTo(_,6)` assertions fail by ~1e-4.

### Pitfall 3: Calling `compute()` on the degenerate path (MEDIUM)
**What goes wrong:** `compute([], [])` throws (`compute.ts:17`) → the adapter (whose contract is "never throw", `scenario-factsheet-payload.ts:34–36`) crashes the composer.
**How to avoid:** Run the degenerate gate FIRST; only call `compute()` on a non-empty, all-finite, ≥2-date series.
**Warning signs:** uncaught error in `useMemo` → React error boundary on the Scenario tab.

### Pitfall 4: `strategyEquity`/`strategyDrawdowns` chart-contract divergence (MEDIUM)
**What goes wrong:** The Phase-38 charts and the existing pinned test (`scenario-factsheet-payload.test.ts:30–37,73–80`) assert `strategyEquity[i] === scenario[i].value` (the WEALTH series) and `strategyDrawdowns === deriveSnapshotDrawdowns(scenario)`. But `compute()` produces equity via `cumEq(rets)` and drawdowns via `drawdowns(eq)`. These two derivations should be numerically ~identical (both are `cumprod(1+r)`), BUT the wealth series is rounded/downsampled and the returns series is not, so they can differ at the 5th–6th decimal and the existing exact-equality tests (`.toBe`, `.toEqual`) would break.
**Why it happens:** Two sources of the same curve (rounded wealth vs unrounded `cumEq(rets)`).
**How to avoid:** Decide explicitly (flag for planner — see Open Questions): EITHER (a) keep `strategyEquity`/`strategyDrawdowns` sourced from the wealth series (preserve existing exact-equality tests; the CHART line stays byte-identical) and source ONLY the scalar/panel metrics from `compute(rets)`, OR (b) switch both to the returns-derived `cumEq`/`drawdowns` and relax the existing tests to `toBeCloseTo`. Option (a) is lower-risk: it keeps Phase-38 chart parity and the existing pins intact while satisfying PAYLOAD-01/02 (which concern `strategyMetrics` + panel arrays, not the equity line). **Recommend Option (a).**
**Warning signs:** `dates is the scenario axis…` / `strategyDrawdowns equals deriveSnapshotDrawdowns…` tests fail.

### Pitfall 5: `stressWindows` benchmark argument (LOW)
**What goes wrong:** `computeStressWindows` needs a `benchRet` series. The scenario blend has no aligned benchmark daily-return series in-adapter (the benchmark prop is sparse wealth).
**How to avoid:** Pass the strat's own returns as `benchRet` (the windows' `benchReturn`/`benchMaxDD` then mirror the strategy — honest, since there is genuinely no separate benchmark), OR pass a zero-filled array. Confirm the consumer (Phase 40 `FactsheetBody`) tolerates equal strat/bench in the stress table. Recommend passing strat returns and `benchName: ""` (or `"—"`), matching the inert-comparator honesty.

### Pitfall 6: RSC serialization (LOW — informational)
**What goes wrong:** A non-serializable value in the payload would break the server→client boundary IF this were an RSC payload.
**Why it's low risk here:** `ScenarioFactsheetChart` is a `"use client"` component (`ScenarioFactsheetChart.tsx:1`) and the adapter runs client-side inside `useMemo` (`ScenarioFactsheetChart.tsx:137`). The payload never crosses an RSC boundary in this phase. All `compute()` outputs are plain numbers/arrays/strings (JSON-safe). `recovery_factor`/`tail_ratio`/`omega_ratio`/`common_sense_ratio` can be `null` (intentional, type-allowed). No `undefined`, no functions, no class instances. **Phase 40, which mounts `FactsheetBody`, should re-verify if any part renders server-side — but Phase 39's surface is client-only.**

## Code Examples

### Threading the new input (composer → chart → adapter)
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:2224 (mount site)
// portfolio_daily_returns is ALREADY in scope here (passed to sibling sections at :2272, :2289).
<ScenarioFactsheetChart
  equityDailyPoints={baselineEquityDailyPoints}
  scenarioSeries={scenarioWealthSeries}
  benchmark={btcWealth}
  portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}  // NEW — daily RETURN form
/>
```

### Populated body assembly (replacing zeroed/empty)
```typescript
// Source pattern: src/lib/factsheet/build-payload.ts:123–231 (csv arm)
const rets = portfolioDaily.map((p) => p.value);
const datesR = portfolioDaily.map((p) => p.date);

const degenerate =
  portfolioDaily.length === 0 ||
  rets.some((v) => !Number.isFinite(v)) ||
  datesR.length < 2;
if (degenerate) return /* current safe-empty payload */;

const rollWindow = pickRollingWindow(rets.length);
const rollBetaWindow = pickRollingWindow(rets.length, [
  { window: ROLL_WINDOW_90D, label: "90d" },
  { window: ROLL_WINDOW_30D, label: "30d" },
]);
const { eq, dd, ...strategyMetrics } = compute(rets, datesR);  // population/252/365.25

// strategyMetrics.n === rets.length === true overlap count  → PAYLOAD-04 satisfied
return {
  ingestSource: "csv",
  // ... meta/safe-default fields kept as today ...
  dates,                                  // chart axis = scenario dates (existing)
  strategyReturns: rets,
  strategyEquity,                         // KEEP wealth-series source (Pitfall 4, Option a)
  strategyRollingVol: rollingVol(rets, rollWindow.window),
  strategyRollingSharpe: rollingSharpe(rets, rollWindow.window),
  strategyRollingSortino: rollingSortino(rets, rollWindow.window),
  rollingWindow: rollWindow,
  rollingBetaWindow: rollBetaWindow,
  strategyDrawdowns,                      // KEEP deriveSnapshotDrawdowns source (Pitfall 4)
  strategyWorst10: worstDrawdowns(dd, 10),
  strategyMetrics,
  // comparators: keep existing BTC wiring
  streaks: /* streakLengths + streakHistogram, build-payload.ts:210–222 */,
  calmarByYear: calmarByYear(rets, datesR),
  bootstrapCI: bootstrapCI(rets),          // seeded → deterministic
  monthlyReturns: monthlyReturnsMatrix(rets, datesR),
  dailyHeatmap: dailyReturnsByYear(rets, datesR),
  correlations: [],                        // HONEST-EMPTY (locked)
  correlationMatrix: { labels: [], matrix: [] },  // HONEST-EMPTY (locked)
  stressWindows: computeStressWindows(datesR, rets, rets, "", markets),
  quantiles: quantileSummary(rets),        // see Open Questions re: helper location
  styleDrift: null,                        // DEFERRED (CONTEXT)
};
```

## State of the Art

Not applicable — no external library landscape. The "state of the art" is the project's own factsheet helper family, all current and in-repo. No deprecated APIs involved.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Keeping `strategyEquity`/`strategyDrawdowns` sourced from the wealth series (Option a) preserves the existing exact-equality tests AND satisfies PAYLOAD-01/02 | Pitfall 4 | If a reviewer requires the equity line to come from `cumEq(rets)`, the existing `.toBe`/`.toEqual` pins must relax to `toBeCloseTo`. Low risk — PAYLOAD reqs concern metrics/panels, not the line. |
| A2 | `quantileSummary` (used for the `quantiles` field) is a module-local function in `build-payload.ts` (not exported); the adapter must re-implement or extract it | Field Recipe / Open Questions | If it IS exported somewhere I missed, simpler reuse. Verified non-export via grep of `build-payload.ts` (it is `function quantileSummary` at :305, not `export`). |
| A3 | Passing strat returns as `benchRet` to `computeStressWindows` is honest (no separate benchmark exists for the blend) | Pitfall 5 | If Phase 40's stress table requires a distinct benchmark column, may need a zero-filled bench or the BTC overlay aligned. |
| A4 | CONTEXT's `styleDrift: null` (deferred) overrides PAYLOAD-02's mention of `style-drift.ts` | Field Recipe | If the milestone owner wants style-drift populated now, add `computeStyleDrift(rets,dates)`. CONTEXT is explicit and later — treat as authoritative. |

## Open Questions

1. **`strategyEquity`/`strategyDrawdowns` source — wealth series vs `cumEq(rets)`?**
   - What we know: existing tests pin exact equality to the wealth-series-derived values (`scenario-factsheet-payload.test.ts:30–37,73–80`); `compute()` produces an equivalent (but unrounded) curve.
   - What's unclear: whether to switch the equity LINE to the returns-derived curve (risking those pins) or keep it (Option a).
   - Recommendation: **Option (a)** — keep the wealth-series equity/drawdown LINE (chart parity + existing pins intact); source only scalar metrics + panel arrays from `compute(rets)`. Planner should make this an explicit task decision.

2. **`quantileSummary` location.**
   - What we know: it's a non-exported local in `build-payload.ts:305–331`.
   - What's unclear: re-implement the identical body in the adapter, or extract to a shared `quantiles.ts`.
   - Recommendation: extract to `src/lib/factsheet/quantiles.ts` and import from both `build-payload.ts` and the adapter (DRY, one parity source). Low-risk surgical extraction.

3. **`computeStressWindows` benchmark argument** — strat returns vs zero-fill vs aligned BTC. Recommendation: strat returns + `benchName:""` (Pitfall 5); confirm against Phase 40 consumer.

4. **PAYLOAD-02 vs CONTEXT on `styleDrift`** — REQUIREMENTS lists `style-drift.ts` among the helpers to populate; CONTEXT defers the style-drift panel to v2. Recommendation: follow CONTEXT (`styleDrift: null`); surface the conflict to the milestone owner.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | build/test | ✓ | (project toolchain) | — |
| vitest + @vitest/coverage-v8 | test suite | ✓ | configured (`vitest.config.ts`) | — |
| TypeScript | typecheck gate | ✓ | (project) | — |

No external services, runtimes, databases, or CLIs required. This is a pure-TS, in-process code change. Step 2.6 audit: no new external dependencies introduced.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (jsdom environment, `vitest.config.ts:21`) |
| Config file | `vitest.config.ts` (include glob at :25; setupFiles `src/test-setup.ts` at :46) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/widgets/performance/scenario-factsheet-payload.test.ts` |
| Full suite command | `npm run test:coverage` (blocking CI gate; thresholds lines 82/stmts 80/fns 74/branches 72) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PAYLOAD-01 | Full scalar set populated via `compute()` (no zeroed summary) | unit | `npx vitest run …/scenario-factsheet-payload.test.ts -t "strategyMetrics"` | ✅ extend |
| PAYLOAD-02 | Panel arrays populated from helpers | unit | same file, new `it` per panel + spot-check | ✅ extend |
| PAYLOAD-03 | Population-convention golden parity; sample-std bleed fails | unit (golden) | new `it`: `strategyMetrics ≡ compute(rets,dates)` field-by-field + hand-pinned pop-std `ann_vol` | ✅ extend |
| PAYLOAD-04 | `strategyMetrics.n` = true overlap count (not dates.length) | unit | new `it`: assert `n === portfolioDaily.length`; exercise 30-day (caveat on) + ≥252-day (caveat off) | ✅ extend |
| PAYLOAD-05 | Degenerate → safe empty, no NaN/Inf, no fabricated zeros | unit | extend existing degenerate tests (`…test.ts:90–119`) for the new returns input | ✅ extend |
| ingestSource invariant | csv arm; synth panels absent | unit | new `it`: `ingestSource==="csv"`; assert 4 synth fields `in payload === false` (mirror `audit-c20.test.ts:371`) | ✅ extend |

### Sampling Rate
- **Per task commit:** `npx vitest run` the adapter test file + `ScenarioComposer.test.tsx` (new-prop assertions).
- **Per wave merge:** `npm run test:coverage` (full, blocking).
- **Phase gate:** full suite green + typecheck before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Extend `scenario-factsheet-payload.test.ts` — add a ≥252-day deterministic blend fixture (returns form) + golden-parity block + convention-drift pin + `n`-boundary + ingestSource-absence assertions.
- [ ] Update `ScenarioComposer.test.tsx` — `ScenarioFactsheetChart` mock now receives `portfolioDaily`; assert it's the engine's `portfolio_daily_returns` (returns form, not wealth). Existing prop assertions at `:552,640,694,1863,1934,3611` remain.
- [ ] (Optional) `quantiles.ts` extraction → new `quantiles.test.ts` if extracted.
- Framework install: none — vitest already configured.

*(No new test infrastructure needed; the existing `compute.test.ts`, `compute.metrics.test.ts`, `compute.dd.test.ts`, `audit-c20.test.ts`, and `scenario-factsheet-payload.test.ts` establish the `toBeCloseTo(_,6)` + `in payload` patterns to follow.)*

### Golden-parity fixture shape (recommended)
```typescript
// Deterministic returns-form blend (NO Math.random — bootstrapCI is seeded internally).
const ymd = (i: number) => new Date(Date.UTC(2024, 0, i + 1)).toISOString().slice(0, 10);

// 30-day blend → n=30 → n<252 caveat ON. Alternating ±, net-positive (matches compute.metrics.test.ts).
const BLEND_30: DailyPoint[] = Array.from({ length: 30 }, (_, i) => ({
  date: ymd(i), value: i % 2 === 0 ? 0.01 : -0.005,
}));
// ≥252-day blend → n=252 → caveat OFF (boundary exercised).
const BLEND_252: DailyPoint[] = Array.from({ length: 252 }, (_, i) => ({
  date: ymd(i), value: (i % 2 === 0 ? 0.002 : 0),
}));

// PAYLOAD-01/03: field-by-field parity vs compute().
const rets = BLEND_30.map(p => p.value);
const dates = BLEND_30.map(p => p.date);
const ref = compute(rets, dates);
const p = buildScenarioFactsheetPayload({ scenario: /*wealth*/…, portfolioDaily: BLEND_30 });
for (const k of Object.keys(ref) as (keyof typeof ref)[]) {
  if (k === "eq" || k === "dd" || k === "yearly") continue; // arrays/objects asserted separately
  if (typeof ref[k] === "number") expect(p.strategyMetrics[k]).toBeCloseTo(ref[k] as number, 6);
}
// Convention-drift pin (fails on a sample-std bleed):
expect(p.strategyMetrics.ann_vol).toBeCloseTo(0.0075 * Math.sqrt(252), 6); // pop-std exact
// PAYLOAD-04:
expect(p.strategyMetrics.n).toBe(30);
// PAYLOAD-02 spot-check (one panel array non-empty + structurally correct):
expect(p.calmarByYear.length).toBeGreaterThan(0);
expect(p.monthlyReturns.length).toBeGreaterThan(0);
// ingestSource invariant:
expect(p.ingestSource).toBe("csv");
for (const f of ["peerPercentile","allocatorPortfolios","eventSignatures","benchEventSignatures"])
  expect(f in p).toBe(false);
```
**bootstrapCI determinism:** `bootstrapCI` uses a fixed mulberry32 seed (seed=42, `bootstrap.ts:31,36`) → identical output every run. No special fixture handling needed; assert its `point`/`lo`/`hi` to 6 decimals against `bootstrapCI(rets)`.

## `ingestSource` Invariant (confirmed)

The scenario adapter hard-codes `ingestSource: "csv"` (`scenario-factsheet-payload.ts:231`) and returns a `FactsheetCsvPayload` (the csv arm of the discriminated union, `types.ts:436–438`). Because it never narrows to the `"api"` arm, the four synthesized panels (`peerPercentile`, `allocatorPortfolios`, `eventSignatures`, `benchEventSignatures`) are **structurally absent** from the object — not null, absent — so they never serialize and a consumer cannot read them without a compile error (`types.ts:411–430`).

`deriveIngestSource` (`build-payload.ts:41`) is the server-side classifier for REAL strategies; the scenario adapter does NOT call it (it knows it's a hypothetical) — it just emits `"csv"` directly. This is correct and must be preserved. The contract is pinned by `audit-c20.test.ts` (the `RED-TEAM-M2/M3 + B6` block at `:371–412` asserts the four fields satisfy `f in payload === false` for csv; `RED-TEAM-H1` at `:497–539` pins `deriveIngestSource`). Phase 39's new adapter test should add an equivalent `in payload === false` assertion so a regression that accidentally flips the adapter to the api arm fails loudly.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Coverage is a blocking CI gate** (`CLAUDE.md`): `npm run test:coverage`; thresholds lines 82 / stmts 80 / fns 74 / branches 72. New adapter branches MUST be covered (the degenerate + populated paths both need tests) or the `frontend-coverage` job fails branch protection.
- **DESIGN.md before any visual/UI decision** — Phase 39 is payload-only (no UI), so no DESIGN.md impact; Phase 40 (mounting `FactsheetBody`) will need it.
- **AGENTS.md / "This is NOT the Next.js you know"** — read `node_modules/next/dist/docs/` before any Next-specific code. Phase 39 touches a `"use client"` component prop only (no server components, no RSC boundary, no Next API surface) — minimal Next exposure, but the prop-threading edit in `ScenarioComposer.tsx`/`ScenarioFactsheetChart.tsx` stays within existing client-component conventions.
- **Rule 3 (surgical changes):** touch only the adapter, the chart wrapper's prop, the composer's one mount line, and the two test files. Do not "improve" the frozen engine or `scenario-blend-panels.ts`.
- **Rule 7 (surface conflicts, don't average):** the PAYLOAD-02-vs-CONTEXT `styleDrift` conflict (Open Question 4) — pick CONTEXT, flag the other.
- **Rule 9 (tests verify intent):** the convention-drift pin must FAIL on a sample-std implementation (encode WHY population-std matters), not merely assert a number.

## Sources

### Primary (HIGH confidence — all first-party source, read in full this session)
- `src/lib/scenario.ts` — frozen engine; `portfolio_daily_returns` production + all degenerate gates + divergent convention (sample std, n/252 CAGR)
- `src/lib/factsheet/compute.ts` — population-convention reference (`pstdev`, 252, 365.25); throw-on-empty
- `src/lib/factsheet/build-payload.ts` — the assembly template (csv arm); `deriveIngestSource`; `quantileSummary` (local)
- `src/lib/factsheet/types.ts` — `FactsheetCsvPayload` / `FactsheetCommon` / `ComputeSummary` / discriminated union
- `src/lib/factsheet/{rolling,bootstrap,streak,calmar-by-year,period-buckets,stress-windows,comparator-block,align,style-drift}.ts` — every helper signature + throw conditions
- `src/lib/scenario-blend-panels.ts` — the explicit "do NOT reuse" sample-std source
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` + `.test.ts` — current adapter + pinned tests
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` — current mount; confirms `portfolio_daily_returns` NOT yet plumbed
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1507–1585, 2224–2289` — data availability at mount site
- `src/app/(dashboard)/allocations/lib/drawdown.ts` — `deriveSnapshotDrawdowns`
- `src/lib/portfolio-math-utils.ts` — `stdDev(_, sample)` (the sample-std primitive to avoid for the body)
- `src/app/factsheet/[id]/v2/{FactsheetView,MetricsColumn,AnalyticalPanels}.tsx` — `n < 252` caveat read sites
- `src/lib/factsheet/audit-c20.test.ts`, `compute.test.ts`, `compute.metrics.test.ts` — test/assertion conventions (`toBeCloseTo(_,6)`, `in payload`)
- `.planning/{REQUIREMENTS,STATE}.md`, `39-CONTEXT.md`, `CLAUDE.md`, `AGENTS.md`

### Secondary / Tertiary
- None — no web search or external docs needed; the phase is entirely internal-codebase reuse.

## Metadata

**Confidence breakdown:**
- Standard stack (helper signatures): HIGH — every signature read from source with file:line.
- Architecture (assembly recipe + data flow): HIGH — `build-payload.ts` is a concrete template; data flow traced end-to-end.
- Convention reconciliation: HIGH — population-vs-sample divergence read line-by-line in all three modules; worked numeric example provided.
- Pitfalls: HIGH — Pitfall 1 (wealth/returns) and Pitfall 4 (equity-line source) are load-bearing and verified against the current tests.
- Open Questions: 4 genuine decision points surfaced for the planner (all low-risk with clear recommendations).

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable — first-party code; only invalidated if the frozen engine or factsheet helpers change, which this milestone forbids)

## RESEARCH COMPLETE

Phase 39 is a pure-TS, zero-new-dep translation phase: extend `buildScenarioFactsheetPayload` to synthesize a COMPLETE `FactsheetCsvPayload` by feeding the frozen engine's `portfolio_daily_returns` (daily-RETURN form — which must be newly threaded from `ScenarioComposer` → `ScenarioFactsheetChart` → adapter, since today only the wealth series reaches the adapter) into the existing population-convention `compute()` helper family, mirroring the `build-payload.ts` csv-arm assembly field-for-field. The body's metrics and rolling fields use `compute.ts`/`rolling.ts` (population stdev, 252 vol/Sharpe, 365.25 CAGR); `scenario-blend-panels.ts` (sample stdev, n-1) is explicitly NOT reused, and a golden fixture pins a hand-computed population-std `ann_vol` (0.0075·√252 for the 30-day fixture) that a sample-std bleed fails at 6 decimals. `strategyMetrics.n` flows from `rets.length` (= true overlap count) automatically, driving the unchanged `n < 252` caveats; degenerate blends (empty / non-finite / <2 dates — already pre-collapsed to `[]` by the engine's n<10 gate) short-circuit to the existing safe-empty payload before any `compute()` call; market `correlations`/`correlationMatrix` stay honest-empty (Phase 41 owns constituent correlation), `styleDrift` stays null (deferred), and `ingestSource` stays `"csv"` keeping the four synthesized panels structurally absent. The three decisions the planner must lock are: keep the equity/drawdown LINE on the wealth-series source (Option a, preserves Phase-38 pins) vs `cumEq(rets)`; extract vs re-implement `quantileSummary`; and the `computeStressWindows` benchmark argument.
