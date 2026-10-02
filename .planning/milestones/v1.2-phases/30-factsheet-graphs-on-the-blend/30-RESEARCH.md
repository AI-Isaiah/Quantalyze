# Phase 30: Factsheet Graphs on the Blend - Research

**Researched:** 2026-06-23
**Domain:** Client-side TS analytics adapter + Recharts leaf-chart reuse (Next.js 16, Vitest, Tailwind v4)
**Confidence:** HIGH (every claim verified against in-repo source; no external deps)

## Summary

Phase 30 adds three factsheet-grade graph surfaces to the BLENDED portfolio in the Phase-29 unified `ScenarioComposer`. All net-new series come from ONE new pure-TS adapter `src/lib/scenario-blend-panels.ts` consuming the frozen engine's UNROUNDED `portfolio_daily_returns` (the engine stays byte-frozen — SCENARIO-05). The leaf charts (`ReturnHistogram`, `ReturnQuantiles`, `RollingMetrics`, `RollingVolatilityChart`, `RollingSortinoChart`) are reused verbatim — they all have 0 `strategyId` / 0 `fetch` refs [VERIFIED: read each file].

The single highest-risk finding: **`ReturnHistogram` does NOT take daily returns — it takes a CUMULATIVE (wealth-or-equity) series and derives daily returns internally** as `value[i+1]/value[i] - 1` [VERIFIED: ReturnHistogram.tsx:35-39 + ReturnHistogram.test.tsx:60-64 feeds `1 + sin(i/3)*0.1`, a wealth series oscillating around 1.0]. Feeding raw `portfolio_daily_returns` (values near 0) into it produces garbage (ratios of consecutive near-zero numbers). The adapter must build a cumulative-wealth series for the histogram — there is already a battle-tested constructor: `toWealth(cumprod(1+r))` or reuse `scenarioMetrics.equity_curve` mapped to wealth (but `equity_curve` is rounded/downsampled — prefer cumprod off the unrounded `portfolio_daily_returns`).

The second decisive finding: there are **THREE rolling-metric implementations in the repo with TWO different std conventions**. `src/lib/portfolio-stats.ts::computeRollingMetric` uses **SAMPLE std (n-1)** via `stdDev(slice, true)` and returns `[]` below window — this EXACTLY matches the LOCKED convention pin ("sample-std × √252"), the frozen engine's all-time-vol convention, and the degenerate-`[]` rule. By contrast `src/lib/factsheet/rolling.ts` uses **POPULATION std (÷window)** via `pstdev` and emits leading `null`s — it MISMATCHES the pin. **The adapter must mirror `portfolio-stats.ts`, NOT `factsheet/rolling.ts`.**

**Primary recommendation:** Write `scenario-blend-panels.ts` to mirror `portfolio-stats.ts`'s sample-std × √252 math (NOT factsheet/rolling.ts). Default rolling window = **63 trading days**; toggle 63/126/252 (3M/6M/12M). With a typical blended series of ~925–1100+ days, all three windows clear their own length floor, but only the 252-day Sharpe also clears `ROLLING_SHARPE_MIN_DAYS=365` for the optional avg-reference line. Adapter signature: takes `portfolio_daily_returns: {date,value}[]` (+ optional window), returns `{ histogramSeries, quantiles, rollingSharpe, rollingVol, rollingSortino, usableN }` shaped to each leaf's exact prop contract.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **The one new file:** `src/lib/scenario-blend-panels.ts` — pure TS, zero deps. Consumes `portfolio_daily_returns` (full-res, unrounded) from `computeScenario`'s output. Derives returns-distribution buckets + quantiles, and rolling Sharpe / vol / Sortino series. A `scenario-blend-panels.test.ts` pins the conventions.
- **Convention pins (LOCKED exit gate):** rolling vol = sample-std × √252; rolling Sortino divides downside RMS by the TOTAL window n (mirror the engine); rolling Sharpe = windowed mean × 252 ÷ windowed vol; degenerate windows (`series.length < window`, < 10 points, non-finite) return `[]`. NO `√365` / `*365` / `√250` anywhere. Read `portfolio_daily_returns`, never the rounded `equity_curve`.
- **The panels (reuse factsheet LEAF charts only):** Reuse the plain-prop LEAF charts (0 `strategyId` / `fetch` refs). NEVER the `strategyId`-coupled panel WRAPPERS (those lazy-fetch per-strategy DB).
- **GRAPH-01 equity/drawdown:** the composer's existing equity + drawdown charts ARE the projection charts; align them to the DESIGN.md factsheet chart-stack treatment (visual identity only — no new data path, reuse the existing `portfolio_daily_returns`-derived equity/drawdown).
- **Placement:** add the new distribution + rolling panels in the projection region (below the KPI strip / existing equity-drawdown). Do NOT reorder to graphs-lead or add collapsibility (that is Phase 31).
- **Honesty (LOCKED exit gates):** The R3 / IMPACT-02 `percentile-rank-badge` guard stays non-vacuous on the composer AND on EVERY new panel (a positive control proves non-vacuity). NO import of `FactsheetBody` / `MetricsColumn` / `buildAllocatorPortfolioFactsheetPayload`; NO `ingestSource:"api"` literal on the blend path. NO Trade/Position or Greeks panel.
- Every new panel has a tested degenerate-empty branch keyed off `portfolio_daily_returns.length` and renders its OWN method / overlap-N / horizon disclosure — the page-level PROJECTED badge is NOT sufficient.
- **Frozen engine:** ZERO diff to `src/lib/scenario.ts` / `src/lib/scenario.test.ts` (CI diff check); full SCENARIO-05 suite passes unchanged. 252-day annualization only.

### Claude's Discretion
- The rolling window length default (resolved below: **63-day default**, toggle 63/126/252).
- Histogram bin count + quantile set defaults (resolved below: `bins=20`; quantiles `[q0,q25,q50,q75,q100]` per-period record, mirroring the leaf defaults).

### Deferred Ideas (OUT OF SCOPE)
- Graphs-lead layout + collapsible composition controls → **Phase 31**.
- `/scenarios` redirect / ScenarioBuilder delete → **Phase 32**.
- Bridge → composer continuity + WCAG-AA audit → **Phase 33**.
- Exposure / turnover panel on the blend (EXPO-01) → v2 deferred.
- Peer / percentile / signature ranking of the blend → **never** (LOCKED honesty invariant).
- Rolling alpha & beta on the blend → structurally omitted (needs benchmark regression the honesty invariant doesn't support on a hypothetical).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GRAPH-01 | Equity + drawdown in factsheet visual identity (DESIGN.md chart stack) | Existing `EquityChart scenarioSeries` (ScenarioComposer.tsx:1914) + `DrawdownChart scenarioDailyPoints` (:1945) already render off `portfolio_daily_returns`-derived series. GRAPH-01 is a reskin-only alignment to `chart-tokens.ts` (CHART_TICK_STYLE/CHART_TRACK/CHART_BORDER/CHART_ACCENT/CHART_TOOLTIP_STYLE). Verify the existing widgets already read these tokens; no new data path. |
| GRAPH-02 | Returns-distribution view (histogram + quantiles) of the blend | New `ReturnHistogram` (cumulative-wealth input!) + `ReturnQuantiles` (`Record<string,number[]>` of `[q0,q25,q50,q75,q100]`) fed by adapter. Both leaves verified 0 strategyId/fetch. Histogram self-gates at <10 points (returns `null`). |
| GRAPH-03 | Rolling Sharpe / volatility / Sortino of the blend | New `RollingMetrics` (Sharpe, keyed `sharpe_365d` to get CHART_ACCENT stroke), `RollingVolatilityChart`, `RollingSortinoChart` fed by adapter mirroring `portfolio-stats.ts` (sample-std × √252). Window toggle via `SegmentedControl`. |
| GRAPH-04 | Per-panel method/overlap-N/horizon disclosure + honest empty below floor; never peer-rank | Each new panel renders its own 12px muted disclosure line + `PartialDataBanner` (role="status") when adapter returns `[]`/empty. The R3 guard (ScenarioComposer.test.tsx:2916-2953) enforces no percentile/peer language. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Derive distribution buckets + quantiles from blended returns | Browser / Client (pure TS adapter) | — | No server compute; the unrounded series is already in the client `scenarioMetrics`. LOCKED: no Python endpoint. |
| Derive rolling Sharpe/vol/Sortino series | Browser / Client (pure TS adapter) | — | Same — client-side off `portfolio_daily_returns`. |
| Render histogram/quantiles/rolling charts | Browser / Client (`"use client"` Recharts/SVG leaf charts) | — | Recharts + interactive `SegmentedControl` require client; all leaves are already `"use client"`. |
| Honest empty / disclosure | Browser / Client (panel chrome in `ScenarioComposer`) | — | Keyed off `portfolio_daily_returns.length` in-component. |
| Provide the blended return series | Frozen engine `computeScenario` (already client-side) | — | FROZEN — read output only; zero diff (SCENARIO-05). |

**Tier sanity note for the planner:** Every capability lives in the browser tier. There is NO API/backend/SSR work in Phase 30. Any plan task that proposes a route handler, server action, or Python endpoint is mis-assigned and violates a LOCKED constraint.

## Standard Stack

### Core (all pre-existing — Phase 30 adds ZERO dependencies)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| recharts | (installed) | `ReturnHistogram`, `RollingMetrics`, `RollingVolatilityChart`, `RollingSortinoChart` rendering | Already the factsheet chart-stack engine; leaves built on it [VERIFIED: imports in each leaf] |
| (hand-rolled SVG) | — | `ReturnQuantiles` box plot | Pure inline SVG, no lib [VERIFIED: ReturnQuantiles.tsx] |
| vitest | ^4.1.2 | Test runner (`vitest run`) | Project standard; coverage gate is a blocking CI check (CLAUDE.md) |
| @vitest/coverage-v8 | ^4.1.5 | Coverage (lines 82 / stmts 80 / fns 74 / branches 72 gate) | New adapter + panels must not regress coverage |

### Supporting (reuse contract — DO NOT rebuild)
| Asset | Path | Prop contract / Use |
|-------|------|---------------------|
| `ReturnHistogram` | `src/components/charts/ReturnHistogram.tsx` | `({ returns: {date,value}[], benchmarkReturns?, bins=20 })` — **`returns` is a CUMULATIVE series**, derives daily internally. Self-gates: `returns.length < 10 → null`; `max===min → null`. |
| `ReturnQuantiles` | `src/components/charts/ReturnQuantiles.tsx` | `({ data: Record<string, number[]> })` where each value is `[q0,q25,q50,q75,q100]` (5-number box). Self-gates: `Object.keys(data).length===0 → null`. |
| `RollingMetrics` | `src/components/charts/RollingMetrics.tsx` | `({ data: Record<string,{date,value}[]>, overallSharpe?, daysOfHistory? })`. Strokes by key: only `sharpe_365d → CHART_ACCENT`; `sharpe_30d/90d` → muted/secondary. Self-gates: `Object.keys(data).length===0 → null`. `daysOfHistory < ROLLING_SHARPE_MIN_DAYS(365)` suppresses the avg line. |
| `RollingVolatilityChart` | `src/components/charts/RollingVolatilityChart.tsx` | `({ data: {date,value}[] })` — percent Y-axis. Self-gates: `data.length===0 → null`. |
| `RollingSortinoChart` | `src/components/charts/RollingSortinoChart.tsx` | `({ data: {date,value}[] })` — ratio Y-axis. Self-gates: `data.length===0 → null`. |
| `SegmentedControl` | `src/components/strategy-v2/SegmentedControl.tsx` | `({ options:{id,label,disabled?}[], activeId, onChange, ariaLabel })` — the 3M/6M/12M toggle recipe. |
| `PartialDataBanner` | `src/components/strategy-v2/PartialDataBanner.tsx` | `({ heading, body })` — `role="status"`, neutral `bg-surface-subtle`. NOT `"use client"` (server-safe). |
| `chart-tokens.ts` | `src/components/charts/chart-tokens.ts` | The literal-hex chart-stack visual contract (CHART_ACCENT `#1B6B5A`, CHART_TICK_STYLE, etc.). |
| `computeScenario` output | `src/lib/scenario.ts` | `portfolio_daily_returns?: {date,value}[]` — UNROUNDED, full-res, cumulative-RETURN-per-day form (value is the daily return, NOT cumulative). FROZEN. |
| `toWealth` | `src/lib/scenario.ts` (re-exported) | Brands a cumulative-RETURN→WEALTH point array; warns if first < 0.05. Useful when building the histogram's cumulative input. |

### Convention source (the rolling math to MIRROR)
| Source | Std convention | Output shape | Verdict |
|--------|----------------|--------------|---------|
| `src/lib/portfolio-stats.ts::computeRollingMetric` | **SAMPLE std (n-1)** via `stdDev(slice, true)` | `(n-window+1)` points, dated at window's last day, `[]` if `daily.length<window` | ✅ **MIRROR THIS** — matches LOCKED pin + engine + degenerate-`[]` rule |
| `src/lib/scenario.ts` all-time vol | SAMPLE std (n-1), × √252 | scalar | ✅ matches pin |
| `src/lib/factsheet/rolling.ts` (`rollingVol`/`rollingSharpe`/`rollingSortino`) | **POPULATION std (÷window)** via `pstdev`; leading `null`s | same-length array with `null` warmup | ❌ **DO NOT mirror** — population std mismatches "sample-std × √252"; null-padded shape mismatches the `[]`-degenerate rule |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Mirroring `portfolio-stats.ts` math by hand in the adapter | Importing `computeRollingMetric` from `portfolio-stats.ts` directly | `computeRollingMetric` covers Sharpe + vol but NOT Sortino, and its `< window → []` gate doesn't add the "<10 points / non-finite → []" floor the pin requires. Recommend: write the adapter's own three functions matching `portfolio-stats.ts`'s sample-std × √252 exactly, with the extra `<10`/non-finite guard. (A pin test should assert numeric parity against `portfolio-stats.ts` on a shared fixture to prove "mirror".) |

**Installation:** None. Phase 30 adds zero dependencies [VERIFIED: CONTEXT.md + UI-SPEC §Registry Safety].

## Package Legitimacy Audit

Not applicable — Phase 30 installs **no external packages**. It adds one pure-TS file and reuses existing components. No registry verification needed.

## Architecture Patterns

### System Architecture Diagram

```
  computeScenario(strategies, draftState, dateMapCache)   [FROZEN ENGINE — read only]
        │
        ▼
  scenarioMetrics.portfolio_daily_returns : {date, value}[]   (UNROUNDED daily-return-per-day)
        │
        ├──────────────────────────────────────────────┐
        ▼                                                ▼
  src/lib/scenario-blend-panels.ts  (NEW, pure TS)   (existing equity/drawdown path — unchanged)
        │                                                │
        │  buildBlendPanels(portfolio_daily_returns, window)
        │     ├─ histogramSeries  = cumprod(1+r) → {date,value}[]  (CUMULATIVE for ReturnHistogram!)
        │     ├─ quantiles        = Record<label, [q0,q25,q50,q75,q100]>
        │     ├─ rollingSharpe    = {sharpe_365d: {date,value}[]}   (sample-std × √252)
        │     ├─ rollingVol       = {date,value}[]                  (sample-std × √252)
        │     ├─ rollingSortino   = {date,value}[]                  (downsideRMS ÷ window n × √252)
        │     └─ usableN          = number   (drives empty branch + disclosure copy)
        │        (every series → [] when length<window / <10 / non-finite)
        ▼                                                ▼
  ScenarioComposer projection region (existing host, "use client")
        ├─ <Card> Returns distribution  (NEW)  → ReturnHistogram + ReturnQuantiles + disclosure / PartialDataBanner
        ├─ <Card> Rolling metrics       (NEW)  → SegmentedControl + RollingMetrics + RollingVolatilityChart
        │                                         + RollingSortinoChart + disclosure / PartialDataBanner
        └─ EquityChart + DrawdownChart  (existing) → GRAPH-01 reskin to chart-tokens only
```

A reader traces: frozen engine → unrounded series → ONE adapter → leaf charts inside two new Cards mounted in the existing projection region. No fetch, no server, no engine edit.

### Recommended file changes (minimal — Rule 3 surgical)
```
src/lib/scenario-blend-panels.ts          # NEW — the one adapter
src/lib/scenario-blend-panels.test.ts     # NEW — convention pins + degenerate-[] tests
src/app/(dashboard)/allocations/components/ScenarioComposer.tsx   # EDIT — mount 2 new Cards + GRAPH-01 token alignment
src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx  # EDIT — extend R3 guard + add per-panel empty tests
# Optionally extract panel bodies into co-located components, but the UI-SPEC mounts them inline as <Card> siblings.
```

### Pattern 1: Adapter signature (recommended)
**What:** One pure function deriving every panel's series from the blended return array.
**When to use:** Always — single source of truth, single test target.
**Example:**
```typescript
// src/lib/scenario-blend-panels.ts  (recommended shape — NO deps, NO fetch, NO DOM/time)
import type { DailyPoint } from "@/lib/scenario";

export interface BlendPanelSeries {
  /** CUMULATIVE-wealth series for ReturnHistogram (it derives daily internally). [] if degenerate. */
  histogramSeries: { date: string; value: number }[];
  /** Record<periodLabel, [q0,q25,q50,q75,q100]> for ReturnQuantiles. {} if degenerate. */
  quantiles: Record<string, number[]>;
  /** {sharpe_365d: series} so RollingMetrics resolves CHART_ACCENT via STROKE_BY_KEY. {} if degenerate. */
  rollingSharpe: Record<string, { date: string; value: number }[]>;
  rollingVol: { date: string; value: number }[];      // [] if degenerate
  rollingSortino: { date: string; value: number }[];  // [] if degenerate
  /** Count of usable daily returns — drives empty-branch + "{n} overlapping days" copy. */
  usableN: number;
}

const MIN_USABLE = 10;

export function buildBlendPanels(
  portfolioDaily: { date: string; value: number }[],
  window: number,   // 63 | 126 | 252
): BlendPanelSeries { /* mirror portfolio-stats.ts sample-std × √252; cumprod for histogram */ }
```
**Source:** Synthesized from `portfolio-stats.ts::computeRollingMetric` (sample-std × √252) + `ReturnHistogram.tsx` (cumulative input) + `RollingMetrics.tsx` STROKE_BY_KEY + UI-SPEC §Adapter contract.

### Pattern 2: Histogram cumulative-input adapter (THE trap)
**What:** Convert daily returns → cumulative wealth before passing to `ReturnHistogram`.
**Why:** `ReturnHistogram` (line 35-39) computes `dailyReturns = cumulative.slice(1).map((v,i) => v/cumulative[i]-1)`. It expects a cumulative series. Pass raw daily returns and you get `dailyReturn[i+1]/dailyReturn[i] - 1` — meaningless ratios of consecutive near-zero numbers.
**Example:**
```typescript
// cumprod off the UNROUNDED portfolio_daily_returns (NOT the rounded equity_curve)
let c = 1;
const histogramSeries = portfolioDaily.map((p) => {
  c *= 1 + p.value;
  return { date: p.date, value: c };  // wealth form, starts near 1.0
});
// ReturnHistogram(returns=histogramSeries) → correct per-day bins
```
**Source:** ReturnHistogram.tsx:35-39 + ReturnHistogram.test.tsx:60-64 [VERIFIED].

### Pattern 3: Quantiles record shape
**What:** `ReturnQuantiles` takes `Record<string, number[]>`, each value `[q0,q25,q50,q75,q100]` (5-number, in plot order min→max).
**Note:** This is DIFFERENT from `build-payload.ts::quantileSummary` which returns an OBJECT `{p05,p25,...}`. The leaf wants positional arrays. Use a single period key (e.g. `"All"` or the overlap window) or split by sub-period.
**Example:**
```typescript
const sorted = [...portfolioDaily.map(p => p.value)].sort((a,b)=>a-b);
const Q = (p:number) => /* linear-interp percentile, n>1 */;
const quantiles = { "All": [sorted[0], Q(.25), Q(.5), Q(.75), sorted.at(-1)!] };
```
**Source:** ReturnQuantiles.tsx:68 destructures `[q0,q25,q50,q75,q100]`; queries.ts:574 `return_quantiles: Record<string,number[]>` [VERIFIED].

### Pattern 4: Rolling Sharpe keyed for accent
**What:** `RollingMetrics` strokes lines by key; only `sharpe_365d` → CHART_ACCENT.
**Why:** The blend produces ONE rolling-Sharpe line. To get the accent identity (UI-SPEC §Color reserves accent for the blend's primary series), key it `sharpe_365d` regardless of window, OR accept that a `sharpe_63d` key falls through to `CHART_TEXT_MUTED`. Recommend keying the single blend series `sharpe_365d` so it renders accent (and pass `daysOfHistory` so the avg-line gate stays honest).
**Source:** RollingMetrics.tsx:50-54 STROKE_BY_KEY + RollingMetricsPanel.tsx:224 pickSharpeForWindow note [VERIFIED].

### Anti-Patterns to Avoid
- **Feeding raw daily returns to `ReturnHistogram`.** It expects cumulative. (Pattern 2.)
- **Mirroring `factsheet/rolling.ts`.** Population std — violates the "sample-std × √252" pin. Mirror `portfolio-stats.ts` instead.
- **Reading `scenarioMetrics.equity_curve` for any panel.** It is ROUNDED (5 dp) AND downsampled (every 5 business days, scenario.ts:435-447). The pin says read `portfolio_daily_returns`. The histogram's cumprod must be off the unrounded series.
- **Importing any `*Panel.tsx` wrapper** from `strategy-v2/` (`ReturnsDistributionPanel`, `RollingMetricsPanel`). They call `useLazyPanelMetrics({strategyId})` — DB-fetch coupled, unusable on a blend, and would trip the honesty guard.
- **Using windows 90/180/365** (the `RollingMetricsPanel.WINDOW_TO_DAYS` values). Those are the per-strategy panel's backend-keyed windows. The blend adapter computes client-side, so it can use the cleaner trading-day windows 63/126/252.
- **Adding `role="alert"` to any new panel.** There is no fetch to fail; below-floor absence is `role="status"` neutral (UI-SPEC §Copywriting / §3).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Histogram binning + sign coloring | Custom bar chart | `ReturnHistogram` | Already bins, colors by sign, aligns benchmark overlay, AA-pass hexes [VERIFIED] |
| Box-plot quantiles | Custom SVG | `ReturnQuantiles` | Accent box/median + muted whiskers, AA-pass [VERIFIED] |
| Rolling line charts | New Recharts wrappers | `RollingVolatilityChart` / `RollingSortinoChart` / `RollingMetrics` | percent vs ratio axes, accent strokes, tooltip tokens already correct [VERIFIED] |
| Window toggle | Custom radio group | `SegmentedControl` | aria + accent focus + disabled tooltip recipe [VERIFIED] |
| Empty state | Custom banner | `PartialDataBanner` | `role="status"`, neutral surface, server-safe [VERIFIED] |
| Rolling Sharpe/vol math | New formula | Mirror `portfolio-stats.ts::computeRollingMetric` | Sample-std × √252 already pin-aligned; copy the exact arithmetic |

**Key insight:** This phase is almost entirely assembly. The ONLY genuinely new code is the ~80-line pure adapter; everything visual already exists and is grep-pinned to DESIGN.md. Custom math or custom charts here would re-introduce the exact convention-drift the LOCKED pins exist to prevent.

## Runtime State Inventory

Not a rename/refactor/migration phase — greenfield client logic over existing data. No stored data, live-service config, OS-registered state, secrets, or build artifacts are affected. **None — verified: Phase 30 adds one TS file + edits two TSX files; no DB, no env, no external service, no schema (REQUIREMENTS.md "no schema change").**

## Common Pitfalls

### Pitfall 1: ReturnHistogram daily-vs-cumulative confusion
**What goes wrong:** Passing `portfolio_daily_returns` (daily returns ~0.001) directly to `ReturnHistogram` produces nonsense bins.
**Why:** The leaf derives daily returns internally from a cumulative input (`v/cumulative[i]-1`).
**How to avoid:** Adapter cumprods `(1+r)` into a wealth series for `histogramSeries`. Pin test: assert the histogram bins match the daily-return distribution, not the wealth-ratio distribution.
**Warning signs:** Bins all collapse near one extreme; a pin test on a known return distribution fails.

### Pitfall 2: Sample vs population std drift
**What goes wrong:** Copying `factsheet/rolling.ts` gives population std; values differ from KPI-strip vol/Sharpe.
**Why:** Two rolling implementations coexist with different denominators.
**How to avoid:** Mirror `portfolio-stats.ts` (n-1). Pin test asserts numeric parity vs `computeRollingMetric` on a shared fixture.
**Warning signs:** Adapter vol ≠ `computeRollingMetric` vol on the same window/series.

### Pitfall 3: Reading the rounded/downsampled equity_curve
**What goes wrong:** Histogram cumprod off `equity_curve` is 5-day-downsampled + 5dp-rounded → wrong daily distribution.
**Why:** `equity_curve` is explicitly payload-optimized; `portfolio_daily_returns` is the full-res source.
**How to avoid:** Read `scenarioMetrics.portfolio_daily_returns ?? []` only (the same prop the benchmark/stress/MC sections already read, ScenarioComposer.tsx:1977/1994/2013).
**Warning signs:** Far fewer histogram samples than `usableN`.

### Pitfall 4: Window floor vs Sharpe-avg-line floor confusion
**What goes wrong:** Disabling toggle options below 252 because of `ROLLING_SHARPE_MIN_DAYS=365`.
**Why:** Two different floors. The rolling SERIES floor is just `series.length >= window`. The `ROLLING_SHARPE_MIN_DAYS=365` floor only gates the optional dashed AVG reference line inside `RollingMetrics` (and `CORRELATION_90D_MIN_DAYS=250` is unrelated — correlation only).
**How to avoid:** Enable a toggle window iff `usableN >= window`. Pass `daysOfHistory=usableN` to `RollingMetrics` so the avg line self-suppresses below 365 without you disabling the whole chart.
**Warning signs:** A 1000-day blend shows an empty 3M chart.

### Pitfall 5: Honesty-guard goes vacuous when new panels mount
**What goes wrong:** A new panel renders a `data-testid` or "percentile"/"ranked" text that the R3 guard's absence-assert can't see, OR the positive control breaks silently.
**Why:** The guard (ScenarioComposer.test.tsx:2916-2953) asserts ABSENCE of `percentile-rank-badge` testid + `/ranked against peers/i` text, with a positive control rendering a real `PercentileRankBadge`.
**How to avoid:** New panels introduce NO peer/percentile/rank/signature testid or copy. Extend the existing test so the absence-assert runs WITH the new panels mounted, keeping the positive control intact. Add a static import-guard test asserting `ScenarioComposer` source does not import `FactsheetBody`/`MetricsColumn`/`buildAllocatorPortfolioFactsheetPayload` and contains no `ingestSource:"api"` literal.
**Warning signs:** Guard passes even after deleting the absence-target (vacuous) — the positive control must fail loudly if the testid is renamed.

## Code Examples

### Mirror portfolio-stats.ts rolling math (sample-std × √252)
```typescript
// Source: src/lib/portfolio-stats.ts:112-135 (computeRollingMetric) — VERIFIED
// stdDev(slice, true) = SAMPLE std (n-1). Returns (n-window+1) pts dated at window end; [] if length<window.
const sqrt252 = Math.sqrt(252);
for (let i = window - 1; i < daily.length; i++) {
  const slice = daily.slice(i - window + 1, i + 1).map(d => d.value);
  const m = mean(slice);
  const s = stdDev(slice, /* sample */ true);
  // sharpe: (m * sqrt252) / s ; volatility: s * sqrt252
}
```

### Rolling Sortino (downside RMS ÷ TOTAL window n — mirror the engine)
```typescript
// Source: scenario.ts:354-361 (all-time) + factsheet/rolling.ts:103-121 (windowed shape) — adapted to sample basis
// Pin: divide downside sum-of-squares by the FULL window length (n), NOT the count of down-days.
for (let i = window - 1; i < daily.length; i++) {
  const slice = daily.slice(i - window + 1, i + 1).map(d => d.value);
  const m = mean(slice);
  let downSq = 0;
  for (const x of slice) if (x < 0) downSq += x * x;
  const dd = Math.sqrt(downSq / window) * Math.sqrt(252);   // ÷ window (total n), × √252
  out.push({ date: daily[i].date, value: dd > 0 ? (m * 252) / dd : 0 });
}
```

### Mount point in ScenarioComposer (the two new Cards)
```tsx
// Source: ScenarioComposer.tsx — insert after the CorrelationHeatmap <Card> (closes ~line 2064),
// before the Bridge-flagged block (~line 2066). Mirror the existing <Card className="mt-6"> siblings.
<Card className="mt-6">
  {/* GRAPH-02 — Returns distribution */}
  {/* heading + 12px disclosure + ReturnHistogram(cumulative) + ReturnQuantiles OR PartialDataBanner */}
</Card>
<Card className="mt-6">
  {/* GRAPH-03 — Rolling metrics: SegmentedControl + RollingMetrics + RollingVolatilityChart + RollingSortinoChart OR PartialDataBanner */}
</Card>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-strategy `*Panel.tsx` wrappers fetch rolling/dist via `useLazyPanelMetrics({strategyId})` | Blend derives client-side from `portfolio_daily_returns` (no fetch, no strategyId) | Phase 30 | The wrappers are unusable on a blend; reuse only the LEAF charts |
| `factsheet/rolling.ts` (population std, null-padded) | `portfolio-stats.ts` (sample std, `[]`-degenerate) is the convention to mirror | n/a (both exist) | Adapter must pick `portfolio-stats.ts` to satisfy the LOCKED pin |

**Deprecated/outdated for this phase:**
- `RollingMetricsPanel.WINDOW_TO_DAYS = {3M:90, 6M:180, 12M:365}` — backend-keyed; NOT the blend's client-side windows (use 63/126/252).
- `factsheet/rolling.ts` population-std functions — do not reuse for the blend.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The existing `EquityChart`/`DrawdownChart` widgets already consume `chart-tokens.ts` literals, so GRAPH-01 is a thin token-alignment, not a rebuild | GRAPH-01 | If they use different hardcoded hexes, GRAPH-01 grows from "verify tokens" to "reskin axes/grid". Planner should add a Wave-0 read of `EquityChart.tsx`/`DrawdownChart.tsx` to confirm. LOW risk (chart stack is grep-pinned per UI-SPEC). |
| A2 | A single quantile period key (`"All"`) satisfies GRAPH-02's quantiles requirement | Pattern 3 | If the design wants per-sub-period boxes (e.g. 30d/90d/1y), the adapter returns multiple keys. UI-SPEC says "mirror leaf defaults / 5-number summary" — single period is the minimal honest read. Implementer's discretion per CONTEXT. |
| A3 | Keying the single blend Sharpe series `sharpe_365d` to get the accent stroke is acceptable (vs. extending STROKE_BY_KEY) | Pattern 4 | Editing `RollingMetrics.tsx` to add a `sharpe_blend` key is allowed (it's a leaf, not the engine) but expands the diff. Keying `sharpe_365d` is zero-touch. If a 63d window must NOT be labeled "365d", the planner adds a key. LOW. |
| A4 | `usableN` for the blend ≈ `scenarioMetrics.n` (the engine's overlapping-day count), so `portfolio_daily_returns.length === n` on the success path | Sample-floor math | scenario.ts:264 builds `portfolio_daily_returns` as `commonDates.map(...)` of length `n` — so length === n exactly on success [VERIFIED scenario.ts:209/264]. Risk negligible. |

## Open Questions (RESOLVED)

1. **Does GRAPH-01 require any code change at all, or is it already compliant?**
   - What we know: equity/drawdown already render off `portfolio_daily_returns`-derived series and the chart stack is token-governed.
   - What's unclear: whether `EquityChart`/`DrawdownChart` already read every `chart-tokens.ts` literal (ticks/grid/axis/accent/tooltip) or carry legacy inline hexes.
   - Recommendation: Wave-0 task to read `../widgets/performance/EquityChart.tsx` + `DrawdownChart.tsx`; if compliant, GRAPH-01 is a verification-only acceptance test; if not, a surgical token swap.

2. **One quantile box vs multiple sub-period boxes for `ReturnQuantiles`.**
   - What we know: leaf renders one box per record key; single `"All"` key is honest and minimal.
   - Recommendation: ship single period; defer multi-period to a fast-follow if design asks. (CONTEXT marks bin/quantile defaults as Claude's discretion.)

## Environment Availability

Skipped — Phase 30 has no external dependencies (pure client TS/TSX changes; existing recharts/vitest already installed). No CLI/service/runtime probing applicable.

## Validation Architecture

> nyquist_validation = true [VERIFIED: .planning/config.json]. Section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 (+ @testing-library/react, jsdom; recharts mocked per leaf test precedent) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run command | `npx vitest run src/lib/scenario-blend-panels.test.ts` |
| Full suite command | `npm run test` (`vitest run`); coverage gate `npm run test:coverage` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| GRAPH-02 | Histogram fed CUMULATIVE series; bins reflect daily-return distribution | unit | `npx vitest run src/lib/scenario-blend-panels.test.ts -t histogram` | ❌ Wave 0 |
| GRAPH-02 | Quantiles record = `[q0,q25,q50,q75,q100]`, monotonic non-decreasing | unit | `npx vitest run src/lib/scenario-blend-panels.test.ts -t quantiles` | ❌ Wave 0 |
| GRAPH-03 | rollingVol = sample-std × √252 — numeric parity vs `portfolio-stats.ts::computeRollingMetric` on shared fixture | unit | `npx vitest run src/lib/scenario-blend-panels.test.ts -t "sample-std parity"` | ❌ Wave 0 |
| GRAPH-03 | rollingSortino divides downside RMS by TOTAL window n; rollingSharpe = mean×252÷annualized-vol | unit | `npx vitest run src/lib/scenario-blend-panels.test.ts -t "sortino\|sharpe convention"` | ❌ Wave 0 |
| GRAPH-03 | NO `√365`/`*365`/`√250` — convention pin (grep-style source assertion or numeric anchor) | unit | `npx vitest run src/lib/scenario-blend-panels.test.ts -t "252-only"` | ❌ Wave 0 |
| GRAPH-04 | Degenerate input (`length<window`, `<10`, non-finite) → every series `[]`/`{}` (per-panel positive+negative control) | unit | `npx vitest run src/lib/scenario-blend-panels.test.ts -t degenerate` | ❌ Wave 0 |
| GRAPH-04 | Each new panel renders PartialDataBanner (role="status") below floor + its own disclosure line above floor | component | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx -t "blend panel empty"` | ❌ Wave 0 (extend existing) |
| GRAPH-04 | R3 honesty guard stays NON-VACUOUS with new panels mounted (positive control finds real PercentileRankBadge; absence-assert on projection) | component | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx -t "R3 guard"` | ✅ extend (test at line 2916) |
| GRAPH-04 | Static import-guard: composer does NOT import FactsheetBody/MetricsColumn/buildAllocatorPortfolioFactsheetPayload and has no `ingestSource:"api"` | unit (source read) | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx -t "no factsheet import"` | ❌ Wave 0 |
| GRAPH-01 | Equity/drawdown axes/grid/accent/tooltip read chart-tokens literals | component | `npx vitest run -t "GRAPH-01 chart-stack tokens"` | ❌ Wave 0 (or verification-only per Open Q1) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/scenario-blend-panels.test.ts` (adapter) + the touched composer test.
- **Per wave merge:** `npm run test` (full suite).
- **Phase gate:** `npm run test:coverage` green (coverage gate must not regress — new adapter is highly testable pure TS; aim ≥ the 82/80/74/72 floor) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/scenario-blend-panels.test.ts` — convention pins (sample-std parity, sortino÷n, sharpe, 252-only, degenerate-`[]`, histogram-cumulative, quantiles-monotonic) — covers GRAPH-02/03/04
- [ ] Extend `ScenarioComposer.test.tsx` — per-panel empty/disclosure tests + R3-guard-with-new-panels + static import guard — covers GRAPH-04
- [ ] Decide GRAPH-01 test depth pending Open Q1 (verification-only vs token-swap test)
- [ ] No framework install needed — Vitest + RTL + recharts-mock precedent already present (see ReturnHistogram.test.tsx mock pattern)

## Security Domain

> `security_enforcement` not present in config; default = enabled. Phase 30 introduces NO new attack surface: no route, no input parsing of untrusted data, no auth/session/access-control change, no crypto, no DB. The adapter consumes already-authorized, already-loaded client-side data.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no auth touched) |
| V3 Session Management | no | — |
| V4 Access Control | no | — (RLS-scoped data already loaded in Phase 29) |
| V5 Input Validation | minimal | Adapter guards non-finite values → `[]` (already a LOCKED pin); no external input |
| V6 Cryptography | no | — |

### Known Threat Patterns for {client-side TS chart adapter}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Misleading risk display (false precision on a hypothetical) | Information disclosure / trust | LOCKED honesty invariants: per-panel disclosure, no peer/percentile rank, neutral empty state, IMPACT-02 guard non-vacuous (the core security-of-trust control for this phase) |
| NaN/Infinity poisoning a chart into garbage | Tampering (data quality) | Degenerate-`[]` guard on non-finite values; pin test |

## Sources

### Primary (HIGH confidence — in-repo source, read this session)
- `src/lib/scenario.ts` — frozen engine; `portfolio_daily_returns` shape (unrounded, daily-return form, length === n), `toWealth`, 252-only, degenerate `[]` returns.
- `src/components/charts/ReturnHistogram.tsx` (+ `.test.tsx`) — CUMULATIVE input contract, `bins=20`, sign coloring, `<10 → null`.
- `src/components/charts/ReturnQuantiles.tsx` — `Record<string,number[]>` `[q0,q25,q50,q75,q100]`, `{} → null`.
- `src/components/charts/RollingMetrics.tsx` — STROKE_BY_KEY (`sharpe_365d`→accent), `daysOfHistory`/`overallSharpe` avg-line gate on `ROLLING_SHARPE_MIN_DAYS`.
- `src/components/charts/RollingVolatilityChart.tsx` / `RollingSortinoChart.tsx` — `{date,value}[]`, `[] → null`, percent vs ratio axes.
- `src/lib/portfolio-stats.ts::computeRollingMetric` — SAMPLE std × √252, `[]` below window (the convention to MIRROR).
- `src/lib/factsheet/rolling.ts` — POPULATION std (the convention to AVOID).
- `src/lib/min-history.ts` — `ROLLING_SHARPE_MIN_DAYS=365`, `CORRELATION_90D_MIN_DAYS=250`, `WORST_DRAWDOWNS_MIN_DAYS=365`.
- `src/components/strategy-v2/{ReturnsDistributionPanel,RollingMetricsPanel,PartialDataBanner,SegmentedControl}.tsx` — wrapper coupling (`useLazyPanelMetrics({strategyId})`) + reusable shells.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — mount points (Cards at :1975/:1992/:2011/:2027/:2048; equity/drawdown :1902-1967), `portfolio_daily_returns ?? []` reads.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx:2916-2953` — the R3/IMPACT-02 non-vacuous guard + positive control.
- `src/lib/queries.ts:574-575` — `return_quantiles: Record<string,number[]>`, `returns_series: {date,value}[]` payload shapes.
- `.planning/phases/29-*/29-RESEARCH.md:114-115` — example-universe `daily_returns` lengths `[1108,1092,1062,853,636,940,811,1006,1072,1103,1049,963,679,758,745]` (avg ~925, range 636–1108).
- `.planning/config.json` — `nyquist_validation: true`.
- `package.json` — `test`/`test:coverage` scripts, vitest ^4.1.2.

### Secondary (MEDIUM)
- `30-UI-SPEC.md` / `30-CONTEXT.md` / `.planning/REQUIREMENTS.md` — locked decisions, copy, placement, requirement IDs.

### Tertiary (LOW)
- None — every load-bearing claim is from in-repo source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every reused component read directly; zero new deps.
- Architecture/adapter contract: HIGH — histogram-cumulative trap and sample-vs-population std conflict both verified in source + tests.
- Pitfalls: HIGH — derived from the actual leaf internals and existing test conventions.
- Sample-floor math: HIGH — typical lengths verified from Phase-29 live-DB measurement; floor semantics verified in `min-history.ts` + `RollingMetrics.tsx`.

**Research date:** 2026-06-23
**Valid until:** 2026-07-23 (stable — depends only on frozen engine + existing leaf charts; re-check only if those change)
