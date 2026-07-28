# Stack Research — v1.2.2 scenario-tab-factsheet-parity

**Domain:** Client-side factsheet-metric computation for a hypothetical scenario blend
**Researched:** 2026-06-25
**Confidence:** HIGH (grounded in direct repo reads, not training data)

> Supersedes the v1.2 Allocator Cohesion STACK.md. v1.2's question was "confirm
> everything is reuse for unification." v1.2.2's question is the metric-port one:
> does computing the FULL factsheet metric set client-side from a blended
> daily-returns series (252-basis parity) need any stack additions, plus a
> constituent correlation matrix?

## TL;DR — The Headline Finding

**No stack additions are needed. Zero new dependencies. The "GAP" framed in the
milestone brief is already solved.**

The brief assumed the full factsheet metric set (skew, kurtosis, VaR/CVaR,
profit factor, win rate, MTD/YTD/3M/6M/1Y, Calmar-by-year, bootstrap CIs, style
drift, monthly/daily heatmaps, EoY, quantiles, streaks, stress windows) would
have to be *newly* computed client-side in TS "from the blend's daily returns."
**It already is.** There is a complete, tested TypeScript port —
`src/lib/factsheet/compute.ts` plus the `src/lib/factsheet/*` helper family —
that computes *every one of those fields* from a bare `number[]` of daily returns
and a `string[]` of dates. The production strategy factsheet
(`factsheet/[id]/v2/page.tsx`) renders through this exact TS path, **not** through
Python `compute_all_metrics`. So feeding the blend's daily returns into the same
assembler (`buildFactsheetPayload`) is parity-by-construction with real
strategies — they share one code path.

The genuinely-new work is **adapter plumbing, not math**: build the blend's
`DailyReturn[]` from the frozen engine's `portfolio_daily_returns`, call the
existing `buildFactsheetPayload` (or extend the thin scenario adapter to do the
same), and render the already-mounted `FactsheetBody`. Plus ONE small new panel
(constituent correlation) for which the matrix math *also already exists* in the
frozen engine and a prior-art renderer.

This directly serves the user's north-star directive: "take the existing
factsheet wholesale and feed it the blend as its input." The stack already
supports that with no additions.

## Recommended Stack

### Core Technologies (all already in the repo — REUSE, do not add)

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `src/lib/factsheet/compute.ts` — `compute(rets, dates)` | in-repo | Computes the ENTIRE `ComputeResult` (skew, kurt, var95, cvar95, profit_factor, win_rate, avg_win/loss, best/worst day-week-month-quarter-year, mtd/ytd/p3m/p6m/p1y, recovery/pain/ulcer/tail/omega/common-sense ratios, yearly map, sharpe/sortino/calmar/cagr/ann_vol/max_dd/longest_dd) from bare returns | This IS the de-facto factsheet parity reference. The production factsheet renders through it. Hand-rolled, zero-dep, tested (`compute.test.ts`, `compute.metrics.test.ts`, `compute.dd.test.ts`). |
| `src/lib/factsheet/build-payload.ts` — `buildFactsheetPayload(strategy, dailyReturns)` | in-repo | Assembles the COMPLETE `FactsheetCommon` (every field the brief calls a "gap") from one `DailyReturn[]` | One function already wires compute + rolling + bootstrap + style-drift + calmar-by-year + streaks + period-buckets + stress + quantiles + correlations + correlation-matrix + comparators into a valid `FactsheetPayload`. The scenario adapter's job is to *call this*, not re-implement it. |
| `src/lib/scenario.ts` — `computeScenario(...)` (FROZEN) | in-repo | Already emits `portfolio_daily_returns: {date,value}[]` (unrounded, full-resolution, daily-RETURN form) AND `correlation_matrix` for the blend | This is the input the adapter feeds `buildFactsheetPayload` (returns) and the new constituent panel (matrix). **Do not touch** — SCENARIO-05 zero-diff pins. Both fields already exist for exactly this purpose (BENCH-01). |
| `src/lib/factsheet/types.ts` — `FactsheetPayload` / `FactsheetCsvPayload` | in-repo | The complete payload contract every field must fill | The `csv` arm is correct-by-construction for a hypothetical blend (peer/allocator/signature panels absent) per the no-invented-data invariant. The peer-override is a contract decision (see below), not a stack one. |

### Supporting Libraries (all in-repo factsheet helpers — REUSE)

Every "gap" field maps to a dedicated, tested, pure-TS helper that takes bare
`number[]` / `string[]`. None require a fetch, DB, time, or external lib.

| Helper (in `src/lib/factsheet/`) | Fills payload field(s) | Signature | Notes |
|---|---|---|---|
| `bootstrap.ts` — `bootstrapCI(rets)` | `bootstrapCI` | `(number[], n_resamples=2000, block_len=5, seed=42)` | Stationary block bootstrap, deterministic Mulberry32 PRNG. Sharpe/Sortino/MaxDD CIs + histograms. |
| `style-drift.ts` — `computeStyleDrift(rets,dates)` + `ksStatPValue(a,b)` | `styleDrift` | `(number[], string[])` | 50/50 split + **hand-rolled** two-sample KS D-stat with Stephens(1970) finite-n correction. **No scipy/jstat needed.** |
| `calmar-by-year.ts` — `calmarByYear(rets,dates)` | `calmarByYear` | `(number[], string[])` | Per-year ret / \|max_dd\|. |
| `streak.ts` — `streakLengths` + `streakHistogram` | `streaks` | `(number[])` | Win/loss run-length histogram. |
| `period-buckets.ts` — `monthlyReturnsMatrix` + `dailyReturnsByYear` | `monthlyReturns`, `dailyHeatmap` | `(number[], string[])` | Year×month compounded matrix + GitHub-grid daily heatmap. |
| `rolling.ts` — `rollingVol/Sharpe/Sortino` + `pickRollingWindow` | `strategyRollingVol/Sharpe/Sortino`, `rollingWindow`, `rollingBetaWindow` | `(number[], window)` | **POPULATION** std (`pstdev`), √252 annualized. Window auto-ladders 126d→90d→30d. |
| `compute.ts` — `cumEq`, `drawdowns`, `worstDrawdowns`, `findDrawdownPeriods` | `strategyEquity`, `strategyDrawdowns`, `strategyWorst10` | `(number[])` | Equity + underwater + worst-N DD bands. |
| `stress-windows.ts` — `computeStressWindows(...)` | `stressWindows` | `(dates, stratRet, benchRet, benchName, markets)` | Named market-stress windows. Needs a benchmark series (BTC fixture available). |
| `build-payload.ts` — `pearsonCorr` + `quantileSummary` (file-local) | `correlations`, `correlationMatrix`, `quantiles` | `(number[])` | Cross-asset ρ strip + benchmark matrix + 5-number box. |
| `comparator-block.ts` — `buildComparatorBlock` / `noneComparatorBlock` | `comparators.{btc,spx,none}` | `(...)` | BTC/SPX overlay blocks (already wired in `build-payload`; minimal scenario adapter already handles the BTC overlay). |

### Already-existing render-side (REUSE — do not rebuild)

| Component | Status | Notes |
|---|---|---|
| `FactsheetBody` / `FactsheetProvider` (`factsheet/[id]/v2/`) | **Already mounted in `AllocationDashboardV2.tsx:142`** with `hideHeader / hideAllocatorSection / hideFooter / topSlot` flags | The "render the REAL FactsheetView, fed a synthesized payload" pattern is already shipped for the allocator's own live book — exactly the north-star pattern. The composer reuses the identical mount under `persist={false}` (Phase-38 precedent in `ScenarioFactsheetChart.tsx`). |
| `buildScenarioFactsheetPayload` (`scenario-factsheet-payload.ts`) | Exists, currently MINIMAL (charts only; `zeroedComputeSummary`, empty panel arrays) | **The single file to extend minimal→complete.** The extension swaps the zeroed scalars + empty arrays for calls into the helpers above. |
| `widgets/risk/CorrelationMatrix.tsx` | Existing client component | Renders a pairwise-Pearson constituent matrix as a teal/red HTML table with a legend — prior-art renderer for the one new panel. |

## Installation

```bash
# NOTHING TO INSTALL. Zero new runtime or dev dependencies.
# All math is in-repo, hand-rolled, pure TS, already unit-tested.
```

No `npm install`. No `requirements.txt` change in `analytics-service/`. If a
roadmap phase proposes adding a stats/charting/correlation package, treat it as a
red flag and re-derive from the reuse inventory above.

## The Parity Reference — Which Convention to Match

**Match the existing TS `compute.ts` port, NOT `analytics-service/metrics.py` directly.**

This is the load-bearing decision for the metric port:

- The production strategy factsheet (`factsheet/[id]/v2/page.tsx:120`) builds its
  displayed payload via `buildFactsheetPayload` → `compute.ts` (TS), reading the
  strategy's `daily_returns` array. **It does not call Python
  `compute_all_metrics` for the factsheet body.** Python writes the upstream
  series (`returns_series` / `daily_returns`); the TS port computes the displayed
  factsheet metrics. (Verified: `page.tsx` imports `buildFactsheetPayload`; no
  `compute_all_metrics` fetch in the render path. The discovery detail page uses
  the same import.)
- Therefore the correct parity target for a blend factsheet is the *other TS
  factsheets*, which all flow through `compute.ts`. If the blend reuses
  `compute.ts`, it is consistent with every real factsheet by sharing the code
  path — nothing to re-verify.
- `compute.ts`'s own header documents its reference (the mockup generator
  `gen_factsheet_v3.py`): **252 trading days/yr**, **population** stdev
  (`statistics.pstdev`), CAGR = `eq[-1]**(1/years)-1`, Sharpe/Sortino rf=0. The
  252-basis convention the milestone constraint mandates is already honored
  throughout (`rolling.ts` √252, `compute.ts` ×252).

### Known parity nuance to flag (NOT a blocker — pre-existing, inherited)

Two std conventions live in the repo intentionally:

| Path | std convention | Used for |
|---|---|---|
| `compute.ts` / `rolling.ts` (factsheet) | **POPULATION** (`pstdev`, ÷n) | Factsheet scalar metrics + factsheet rolling charts |
| `scenario.ts` / `scenario-blend-panels.ts` / `portfolio-stats.ts` | **SAMPLE** (÷n−1) | Frozen engine KPIs + v1.2 blend graphs |

Implication: the blend's **factsheet `strategyMetrics`** must be computed with
`compute.ts` (population) so the blend factsheet matches real factsheets. The
composer's existing KPI strip / `buildBlendPanels` graphs use the sample
convention. These two already coexist on the same composer page today (v1.2.1
shipped chart reuse with this exact split). Do **not** unify them in this
milestone — that is out-of-scope code-motion and risks the frozen engine's
SCENARIO-05 pins. Route each surface to its established helper.

Versus Python `metrics.py`: it uses `quantstats` (`qs.stats.*`) + pandas
`Series.skew()` / `Series.kurtosis()` (sample / bias-corrected, ddof=1), threading
`periods_per_year=252`. This already differs from the TS `compute.ts`
(population) — but that divergence is **pre-existing and irrelevant here**,
because the factsheet UI never reads the Python scalars. Chasing Python parity for
the blend would actually *break* parity with the real TS factsheets.
(HIGH confidence — confirmed by reading both render paths.)

## The ONE Genuinely New Panel — Constituent Correlation

The milestone's single new panel (pairwise correlation across the blend's
constituent strategies / API-key-strategies — "are any too similar?") is the only
item with no ready-made payload slot. But the **math already exists**, so this is
wiring, not new algorithm work:

| Existing source | What it gives |
|---|---|
| `scenario.ts` `computeScenario().correlation_matrix` (FROZEN) | `Record<id, Record<id, number>>` — pairwise Pearson across the active blend's constituents, **already computed on every blend recompute** (sample covariance n−1). Plus `avg_pairwise_correlation` (avg of \|ρ\|). The cleanest source — the engine already emits it; no recompute. |
| `src/lib/correlation-math.ts` `pearson(a,b)` | Null-returning Pearson (distinguishes "0 corr" from "undefined") + `rollingCorrelation`. Fallback if the adapter must recompute. |
| `widgets/risk/CorrelationMatrix.tsx` | A complete client component rendering a pairwise-Pearson constituent matrix as a teal/red HTML table + legend — prior-art renderer. |

Recommendation: source the matrix from the **frozen engine's already-emitted
`correlation_matrix`** (no recompute, no new math), map constituent ids→display
names at the adapter boundary, and render with the `CorrelationMatrix.tsx`
pattern (or a DESIGN.md-aligned variant). **Note:** the factsheet's own
`correlationMatrix` payload field is a DIFFERENT thing (strategy-vs-benchmark
cross-asset returns heatmap) — the constituent matrix is a NEW panel slotted into
the composer layout, not that field. Don't conflate them.

## Field-by-Field Map: `FactsheetPayload` → reuse / wire / new

Legend: **REUSE** = existing helper fills it directly · **WIRE** = adapter
assembles from existing helpers/engine output · **NEW** = genuinely new (one panel).

| Payload field | Source | Status |
|---|---|---|
| `strategyMetrics` (skew, kurt, var95, cvar95, profit_factor, win_rate, mtd/ytd/p3m/p6m/p1y, best/worst periods, recovery/pain/ulcer/tail/omega/CSR, yearly, sharpe/sortino/calmar/cagr/ann_vol/max_dd/longest_dd) | `compute.ts::compute(rets,dates)` minus eq/dd | **REUSE** — the entire "gap" scalar list is one function call |
| `strategyEquity` / `strategyDrawdowns` / `strategyWorst10` | `cumEq` / `drawdowns` / `worstDrawdowns` | **REUSE** |
| `strategyReturns` | the blend's daily-return array | **WIRE** (already in engine `portfolio_daily_returns`) |
| `strategyRollingVol/Sharpe/Sortino` + `rollingWindow` / `rollingBetaWindow` | `rolling.ts` + `pickRollingWindow` | **REUSE** |
| `bootstrapCI` | `bootstrap.ts::bootstrapCI` | **REUSE** |
| `styleDrift` | `style-drift.ts::computeStyleDrift` (hand-rolled KS) | **REUSE** |
| `calmarByYear` | `calmar-by-year.ts::calmarByYear` | **REUSE** |
| `streaks` | `streak.ts::streakLengths` + `streakHistogram` | **REUSE** |
| `monthlyReturns` / `dailyHeatmap` | `period-buckets.ts` | **REUSE** |
| `quantiles` | `build-payload.ts::quantileSummary` (file-local; lift or inline) | **REUSE** |
| `correlations` / `correlationMatrix` (vs benchmarks) | `build-payload.ts::pearsonCorr` + BTC/SPX/ETH/GLD/IEF fixtures | **WIRE** (decide if the benchmark cross-asset strip is meaningful for a blend, or omit) |
| `comparators.{btc,spx,none}` | `comparator-block.ts::buildComparatorBlock` | **WIRE** (BTC overlay already supported in the minimal adapter) |
| `stressWindows` | `stress-windows.ts::computeStressWindows` (needs a benchmark series) | **WIRE** (BTC fixture available) |
| `peerPercentile` / `allocatorPortfolios` / `eventSignatures` (api-arm only) | absent on `csv` arm by construction | **CONTRACT DECISION** (peer override — see below) |
| Constituent correlation matrix (NEW PANEL) | `computeScenario().correlation_matrix` (frozen) + `CorrelationMatrix.tsx` renderer | **NEW** — the one genuinely new panel; math already exists |

### Peer-percentile override (milestone decision 2026-06-25) — a contract, not a stack item

The milestone overrides the no-peer-rank-a-hypothetical invariant to show an
honest cohort number for the blend. The existing `peer-cohort.ts`
(`computePeerPercentile(sharpe, sortino, max_dd)`) is a **synthesized demo
cohort** (20 deterministic peers, seed 42) and can be called with the blend's
computed Sharpe/Sortino/MaxDD — **no new dependency**. But two things make this a
REQUIREMENTS decision, not a stack one, and should be flagged to the roadmapper:
1. `FactsheetCsvPayload` structurally OMITS `peerPercentile` (it lives only on the
   `api` arm). Showing it on a blend requires either rendering via the `api` arm
   (which also unlocks allocator/signature panels — likely undesirable) or an
   additive carve-out to expose just `peerPercentile` on the scenario payload.
2. The demo cohort is explicitly tagged "demo" in the UI; honesty framing for a
   hypothetical blend must be decided in REQUIREMENTS.

Stack verdict: the helper exists, zero new lib. The arm/contract decision is for
requirements + roadmap.

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Reuse `compute.ts` + `build-payload.ts` (TS, in-repo) | Call Python `compute_all_metrics` for the blend | NEVER for this milestone. A hypothetical blend has no `strategy_id` and never hits ingestion; a round-trip adds a network hop + auth surface and — worse — *breaks* parity with the TS-rendered real factsheets. Python stays the upstream series producer only. |
| Hand-rolled KS / quantiles / bootstrap | `jstat` / `simple-statistics` / `d3-array` | NEVER. Every primitive is already hand-rolled and tested; repo convention is explicitly hand-rolled stats (Ledoit-Wolf was hand-rolled in v1.1). A lib duplicates working code and bloats the bundle. |
| Frozen-engine `correlation_matrix` for the constituent panel | Recompute pairwise Pearson in the adapter via `correlation-math.pearson` | Only if the engine's matrix doesn't carry the labels/ordering the new panel needs. Prefer engine output (zero recompute). |
| Extend `buildScenarioFactsheetPayload` to call helpers | New parallel `compute_blend_factsheet` module | Only if the scenario payload diverges structurally from `buildFactsheetPayload`. It shouldn't — same `FactsheetCsvPayload` shape. Extend in place (one file, minimal→complete). |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| Any npm stats library (`jstat`, `simple-statistics`, `mathjs`, `d3-array`, `ml-*`, `numeric`, `quantstats`-js) | Every needed primitive (skew, kurt, VaR, CVaR, KS, quantiles, bootstrap, correlation, drawdown) is already hand-rolled, tested, and parity-locked. A lib adds bundle weight, a supply-chain surface, and a *second* convention that would silently diverge from `compute.ts`. None are in `package.json` today — keep it that way. | In-repo `src/lib/factsheet/*` + `correlation-math.ts` helpers |
| Editing `src/lib/scenario.ts` (frozen engine) | SCENARIO-05 zero-diff regression pins; the engine already emits `portfolio_daily_returns` + `correlation_matrix` — everything the adapter needs is already an output. Touching it breaks the milestone's hard "frozen engine stays frozen" constraint. | Read existing engine outputs; do all new work in the adapter + new panel |
| Editing any `factsheet/[id]/v2/*` render file to special-case the blend | "Factsheet files stay byte-identical (additive only)" is load-bearing; their tests must not break. The Phase-38 `persist={false}` precedent shows reuse without edits. | Feed the REAL `FactsheetBody`/`FactsheetProvider` a synthesized payload; pass behavior via existing props (`hideHeader`, `persist={false}`, `topSlot`) |
| Python `compute_all_metrics` parity as the target | The factsheet UI renders TS `compute.ts`, not Python. Matching Python (sample skew/kurt via pandas, quantstats scalars) would diverge from real TS factsheets. | Match `compute.ts` (population stdev, 252-basis) — automatic via reuse |
| Re-deriving a constituent correlation matrix from scratch | The frozen engine already computes it on every recompute; a renderer already exists. | `computeScenario().correlation_matrix` + `CorrelationMatrix.tsx` pattern |
| Adding a charting library for the new panel | recharts + lightweight-charts + the existing HTML-table `CorrelationMatrix` already cover every visual in scope (carried over from v1.2 verdict). | Existing chart engines + `CorrelationMatrix.tsx` |

## Stack Patterns by Variant

**If the constituent matrix needs per-constituent labels the engine's
`correlation_matrix` keys (strategy ids) don't surface nicely:**
- Map ids→display names at the adapter boundary (the blend already knows its
  `StrategyForBuilder[]`), render with `CorrelationMatrix.tsx`.
- Because the engine already computed ρ — no recompute, no `correlation-math` call.

**If a blend constituent is an API-key-strategy (per-key series, v1.2.1):**
- Its daily returns already flow through the same `DailyPoint[]` shape into
  `computeScenario`; the correlation matrix treats it as just another series.
- No new handling — the dual-axis per-key work (v1.2.1) already normalized this.

**If a phase claims a new dependency is "needed":**
- Re-check the field-by-field map and "What NOT to Use" first.
- Every in-scope capability is already covered; a new dep is almost certainly an
  avoidable fork of an existing pattern.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| (none added) | — | Zero new packages. The only "compatibility" concern is the population-vs-sample std split documented above, which is intra-repo and already coexisting in production. Existing stack (next `^16`, react `19`, vitest `^4`) unchanged; coverage stays a blocking CI gate (lines 82 / fns 74 / branches 72) so new adapter code must carry tests. |

## Sources

- `src/lib/factsheet/compute.ts`, `build-payload.ts`, `bootstrap.ts`,
  `style-drift.ts`, `calmar-by-year.ts`, `rolling.ts`, `period-buckets.ts`,
  `streak.ts`, `peer-cohort.ts`, `types.ts`, `compute.metrics.test.ts` — direct
  read (HIGH). The complete TS factsheet metric port + assembler.
- `src/lib/scenario.ts` (frozen engine) — direct read (HIGH). Confirms
  `portfolio_daily_returns` + `correlation_matrix` already emitted.
- `src/lib/scenario-blend-panels.ts` — direct read (HIGH). v1.2 blend-graph
  derivations (sample-std convention; documents the split).
- `src/lib/correlation-math.ts`, `widgets/risk/CorrelationMatrix.tsx` — direct
  read (HIGH). Prior art for the new constituent-correlation panel.
- `src/app/factsheet/[id]/v2/page.tsx` — direct read (HIGH). Proves the
  production factsheet renders via TS `buildFactsheetPayload`, NOT Python.
- `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx`,
  `widgets/performance/ScenarioFactsheetChart.tsx`,
  `scenario-factsheet-payload.ts` — direct read (HIGH). Render-side mount pattern
  + the minimal adapter to extend.
- `analytics-service/services/metrics.py` — direct read (HIGH). Confirms Python
  uses quantstats + pandas (sample) and threads `periods_per_year=252`; confirms
  it is the upstream series producer, not the factsheet renderer.
- `package.json` — direct read (HIGH). No stats library present; 21 runtime deps.

Context7 / web search were NOT consulted: the question is "does this repo already
compute X", which the codebase answers authoritatively. No new package is
proposed, so no external-version question arose — pulling docs for a library we
are deliberately NOT adding would be noise.

---
*Stack research for: client-side factsheet-metric computation on a scenario blend (v1.2.2)*
*Researched: 2026-06-25*
