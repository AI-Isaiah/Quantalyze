# Phase 30: Factsheet Graphs on the Blend - Pattern Map

**Mapped:** 2026-06-23
**Files analyzed:** 4 (2 NEW, 2 MODIFIED) + 5 read-only leaf-chart analogs
**Analogs found:** 4 / 4 (every file has a concrete in-repo analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/lib/scenario-blend-panels.ts` (NEW) | utility (pure-TS adapter) | transform | `src/lib/portfolio-stats.ts::computeRollingMetric` (sample-std × √252, `[]` below window) | exact (role + data flow) |
| `src/lib/scenario-blend-panels.test.ts` (NEW) | test | transform | `src/lib/portfolio-stats.test.ts` (deterministic fixture + numeric-parity convention pins) | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (MODIFIED) | component (host mount) | request-response (props-only, client) | the existing `<Card className="mt-6">` sibling mounts in the same file (ScenarioBenchmarkSection :1975, StressVarSection :1992, MonteCarloSection :2011, CorrelationHeatmap :2048) | exact (same file) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (MODIFIED) | test | component | the existing R3/IMPACT-02 guard block (:2916-2953) | exact (same block) |

**Read-only leaf-chart analogs (DO NOT MODIFY — prop contracts documented below):**
`src/components/charts/{ReturnHistogram,ReturnQuantiles,RollingMetrics,RollingVolatilityChart,RollingSortinoChart}.tsx`, plus `src/components/strategy-v2/{SegmentedControl,PartialDataBanner}.tsx`.

---

## Pattern Assignments

### `src/lib/scenario-blend-panels.ts` (NEW — utility, transform)

**Primary analog:** `src/lib/portfolio-stats.ts::computeRollingMetric` (lines 104-135). MIRROR this math — sample-std × √252, dated at the window's last day, `[]` below window. Do NOT mirror `src/lib/factsheet/rolling.ts` (it uses `pstdev` = POPULATION std and null-pads — violates the LOCKED pin).

**Imports pattern** (portfolio-stats.ts:14-15 — reuse the SAME `stdDev`/`mean` so numeric parity is exact, not re-implemented):
```typescript
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { mean, stdDev } from "@/lib/portfolio-math-utils";
```
- `stdDev(values, sample = true)` divides by `n-1` (Bessel) — `portfolio-math-utils.ts:74-81`. `stdDev(slice, true)` IS the "sample-std" the pin requires; `stdDev(slice, false)` would be population (the wrong/forbidden basis). The `n < 2 && sample → 0` guard is built in.
- The histogram-input type is `DailyPoint` (`{ date: string; value: number }`, `portfolio-math-utils.ts:11-14`). `computeScenario().portfolio_daily_returns` is the structurally-identical `Array<{ date: string; value: number }>` (`scenario.ts:128`).

**Core rolling-metric pattern — sample-std × √252** (copy the exact arithmetic from `portfolio-stats.ts:117-135`):
```typescript
// MIRROR computeRollingMetric (portfolio-stats.ts:117-135). Sample std (n-1).
if (daily.length < window) return [];          // degenerate-[] rule (pin)
const result: DailyPoint[] = [];
const sqrt252 = Math.sqrt(252);
for (let i = window - 1; i < daily.length; i++) {
  const slice = daily.slice(i - window + 1, i + 1).map((d) => d.value);
  const m = mean(slice);
  const s = stdDev(slice, true);               // SAMPLE std — NOT pstdev
  // volatility: s * sqrt252 ; sharpe: s > 0 ? (m * sqrt252) / s : 0
  result.push({ date: daily[i].date, value: /* metric */ });
}
return result;
```
- The pin test must assert numeric PARITY of the adapter's vol/sharpe against `computeRollingMetric(fixture, window, "volatility"|"sharpe")` on a shared fixture (this is the "mirror" proof). `RESEARCH §Code Examples` confirms.

**Rolling Sortino — downside-RMS ÷ TOTAL window n × √252** (mirror the FROZEN ENGINE, `scenario.ts:354-361`, on a sample basis; the windowed SHAPE comes from `factsheet/rolling.ts:103-121` but on the sample/n denominator the engine uses):
```typescript
// Engine convention (scenario.ts:354-361): downside sum-of-squares ÷ n (TOTAL
// observations), NOT ÷ count-of-down-days. × √252. Numerator = mean × 252.
for (let i = window - 1; i < daily.length; i++) {
  const slice = daily.slice(i - window + 1, i + 1).map((d) => d.value);
  const m = mean(slice);
  let downSq = 0;
  for (const x of slice) if (x < 0) downSq += x * x;
  const dd = Math.sqrt(downSq / window) * Math.sqrt(252);   // ÷ window (total n)
  result.push({ date: daily[i].date, value: dd > 0 ? (m * 252) / dd : 0 });
}
```
- Engine reference (scenario.ts:343-361): `downsideVar = downsideSumSq / n` then `× √252`, numerator `meanR * 252`. `factsheet/rolling.ts:117` confirms the `/ window` denominator (its only correct part) but uses `pstdev` elsewhere — do NOT copy its vol/sharpe.

**Histogram cumulative-wealth transform — THE TRAP** (`ReturnHistogram` derives daily internally from a CUMULATIVE series, `ReturnHistogram.tsx:35-39`):
```typescript
// cumprod (1+r) off the UNROUNDED portfolio_daily_returns → wealth series ~1.0.
// NEVER feed raw daily returns; NEVER read the rounded/downsampled equity_curve.
let c = 1;
const histogramSeries = portfolioDaily.map((p) => {
  c *= 1 + p.value;
  return { date: p.date, value: c };  // wealth form (starts near 1.0)
});
```
- `ReturnHistogram.tsx:36-39`: `cumulative.slice(1).map((v,i) => cumulative[i] !== 0 ? v/cumulative[i] - 1 : 0)` — it RE-derives daily returns from a cumulative input. The engine's own cumprod precedent is `detectRegimeChanges` (`portfolio-stats.ts:548-554`: `c *= 1 + d.value`) and `computeScenario` (`scenario.ts:271-274`). Note `toWealth` (`scenario.ts:520-530`) brands an ALREADY-cumulative `equity_curve`; it does NOT cumprod — so build the cumprod yourself off `portfolio_daily_returns`.

**Quantiles record shape** (`ReturnQuantiles.tsx:68` destructures positional `[q0,q25,q50,q75,q100]`):
```typescript
const sorted = [...portfolioDaily.map((p) => p.value)].sort((a, b) => a - b);
// linear-interp percentile; record keyed by period label (single "All" is the
// minimal honest read per RESEARCH A2 / Open Q2). Monotonic non-decreasing.
const quantiles: Record<string, number[]> = {
  All: [sorted[0], Q(0.25), Q(0.5), Q(0.75), sorted.at(-1)!],
};
```
- Distinct from `portfolio-stats.ts`'s bin-based `computeReturnDistribution` (lines 181-227) and from any `{p05,p25,…}` OBJECT shape — the leaf wants POSITIONAL arrays.

**Degenerate / non-finite guard (LOCKED pin → `[]`/`{}`):**
```typescript
const MIN_USABLE = 10;
// every series → [] when: portfolioDaily.length < window, < 10 usable points,
// or any non-finite value present. Drop-non-finite precedent:
// portfolio-stats.ts:193-200 (computeReturnDistribution) + normalizeDailyReturns
// (portfolio-math-utils.ts:35 Number.isFinite filter).
```
- Mirror the non-finite handling style of `computeReturnDistribution` (`portfolio-stats.ts:190-200`) — skip/guard non-finite rather than letting NaN poison output. The pin requires the WHOLE series to collapse to `[]` on any non-finite (stricter than the per-value skip).

**Recommended signature** (from `RESEARCH §Pattern 1`):
```typescript
export interface BlendPanelSeries {
  histogramSeries: { date: string; value: number }[];   // [] if degenerate
  quantiles: Record<string, number[]>;                   // {} if degenerate
  rollingSharpe: Record<string, { date: string; value: number }[]>; // key "sharpe_365d" for accent
  rollingVol: { date: string; value: number }[];
  rollingSortino: { date: string; value: number }[];
  usableN: number;
}
export function buildBlendPanels(
  portfolioDaily: { date: string; value: number }[],
  window: number, // 63 | 126 | 252 (default 63 per RESEARCH; toggle 3M/6M/12M)
): BlendPanelSeries { /* … */ }
```
- Key the single blend Sharpe series `sharpe_365d` so `RollingMetrics.STROKE_BY_KEY` (`RollingMetrics.tsx:50-54`) resolves `CHART_ACCENT` (RESEARCH Pattern 4 / A3 — zero-touch on the leaf).

---

### `src/lib/scenario-blend-panels.test.ts` (NEW — test, transform)

**Analog:** `src/lib/portfolio-stats.test.ts` (lines 1-71 read).

**Imports + deterministic fixture pattern** (portfolio-stats.test.ts:1-32):
```typescript
import { describe, it, expect } from "vitest";
import type { DailyPoint } from "./portfolio-math-utils";
import { computeRollingMetric } from "./portfolio-stats"; // for the parity assert
import { buildBlendPanels } from "./scenario-blend-panels";

// deterministic, no Math.random — sinusoidal series like the analog (line 23-26)
const DAILY: DailyPoint[] = Array.from({ length: 252 }, (_, i) => ({
  date: new Date(2025, 0, 2 + i).toISOString().slice(0, 10),
  value: (Math.sin(i / 20) * 0.02 + 0.0003) * (1 + Math.cos(i / 50) * 0.5),
}));
```

**Convention-pin tests to encode (one `it` each; Rule 9 — assert WHY):**
- **sample-std parity:** `buildBlendPanels(DAILY, 63).rollingVol` numerically equals `computeRollingMetric(DAILY, 63, "volatility")` point-for-point (`toBeCloseTo`, ~10 dp). This is the "mirror `portfolio-stats.ts`, not `factsheet/rolling.ts`" proof. (RESEARCH Pitfall 2.)
- **sharpe convention:** parity vs `computeRollingMetric(DAILY, 63, "sharpe")` (= `mean × √252 ÷ sample-std`).
- **sortino ÷ n:** on a hand-checkable slice, assert downside RMS divides by the FULL window length (not down-day count) — anchor against a tiny fixed window computed by hand.
- **252-only:** numeric anchor proving √252 (NOT √365/√250) — e.g. constant-return fixture → vol matches `s * √252` exactly; OR a source-read assertion that the module contains no `365`/`250` literal.
- **histogram cumulative:** feed `DAILY`, assert `histogramSeries` is cumprod-monotone-ish (starts ~1.0) AND that piping it through the leaf's `v/cumulative[i]-1` recovers the ORIGINAL daily distribution (not wealth-ratio garbage). (RESEARCH Pitfall 1.)
- **quantiles monotonic:** each record value is non-decreasing `[q0 ≤ q25 ≤ q50 ≤ q75 ≤ q100]`.
- **degenerate → []/{}:** positive+negative control — `length < window`, `< 10` points, and a `NaN`/`Infinity`-injected series each return empty series; a healthy series returns non-empty (proves non-vacuity).

Use `toBeCloseTo` for float asserts (analog precedent: portfolio-stats.test.ts:65 `toBeCloseTo(expected, 8)`).

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (MODIFIED — component, props-only client mount)

**Analog:** the existing `<Card className="mt-6">` sibling blocks in THIS file. Mount the two NEW Cards AFTER the CorrelationHeatmap Card (closes line 2064), BEFORE the Bridge-flagged block (`{flaggedHoldings.length > 0 && …}` at line 2066).

**Existing sibling-Card mount pattern** (lines 1975-1981 — the canonical shape to copy; props-only over `portfolio_daily_returns ?? []`, no fetch/state/memo):
```tsx
<Card className="mt-6">
  <ScenarioBenchmarkSection
    portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
    btcDaily={btcDaily}
    benchmarkAvailable={btcAvailable}
  />
</Card>
```
- Identical `?? []` read at :1977 / :1994 / :2013 — the NEW panels MUST read the SAME `scenarioMetrics.portfolio_daily_returns ?? []` (never the rounded `equity_curve`; RESEARCH Pitfall 3). `scenarioMetrics.n` (:1997/:2014) is the overlapping-day count for disclosure copy (`A4`: length === n on the success path).

**Card-with-heading + caveat pattern** (CorrelationHeatmap Card, lines 2048-2064 — the model for a panel that owns a heading + a muted disclosure line):
```tsx
<Card className="mt-6">
  <div className="mb-3">
    <h2 className="text-sm font-semibold text-text-primary">Pairwise correlation</h2>
    <p className="text-xs text-text-muted mt-0.5">Live-computed from the scenario&apos;s daily returns. …</p>
  </div>
  <CorrelationHeatmap … />
</Card>
```
- UI-SPEC §Typography sets the panel H2 to `text-base font-semibold text-text-primary` ("Returns distribution" / "Rolling metrics") and sub-headings to `text-xs font-normal uppercase tracking-wider text-text-secondary`. The per-panel disclosure line is `text-xs text-text-muted` (matches this `<p>` and the `RollingMetrics` caption at `RollingMetrics.tsx:165`).

**Leaf-chart prop contracts to feed (READ-ONLY analogs — exact shapes, do NOT modify the leaves):**

| Leaf | Import | Prop contract | Self-gate (renders `null`) |
|------|--------|---------------|----------------------------|
| `ReturnHistogram` | `@/components/charts/ReturnHistogram` | `({ returns: {date,value}[], benchmarkReturns?, bins=20 })` — **`returns` is CUMULATIVE wealth** (derives daily as `v/cumulative[i]-1`, line 35-39). Pass `histogramSeries`. | `returns.length < 10` (line 33) OR `max === min` (line 43) |
| `ReturnQuantiles` | `@/components/charts/ReturnQuantiles` | `({ data: Record<string, number[]> })`, each value positional `[q0,q25,q50,q75,q100]` (destructured line 68). | `Object.keys(data).length === 0` (line 25) |
| `RollingMetrics` | `@/components/charts/RollingMetrics` | `({ data: Record<string,{date,value}[]>, overallSharpe?, daysOfHistory? })`. Only key `sharpe_365d` → `CHART_ACCENT` (STROKE_BY_KEY :50-54). Pass `daysOfHistory={usableN}` so the dashed avg line self-suppresses below `ROLLING_SHARPE_MIN_DAYS=365` (:99-104) — do NOT disable the whole chart (RESEARCH Pitfall 4). | `Object.keys(data).length === 0` (line 86) |
| `RollingVolatilityChart` | `@/components/charts/RollingVolatilityChart` | `({ data: {date,value}[] })` — percent Y-axis (`(v*100).toFixed(0)+"%"`, :42), `CHART_ACCENT` stroke, `role="img" aria-label="Rolling volatility"`. | `data.length === 0` (line 25) |
| `RollingSortinoChart` | `@/components/charts/RollingSortinoChart` | `({ data: {date,value}[] })` — ratio Y-axis (`v.toFixed(2)`, :41), `CHART_ACCENT` stroke, `role="img" aria-label="Rolling Sortino"`. | `data.length === 0` (line 25) |
| `SegmentedControl` | `@/components/strategy-v2/SegmentedControl` | `({ options:{id,label,disabled?}[], activeId, onChange, ariaLabel })`. The 3M/6M/12M toggle. Active = accent border+text; uses `aria-pressed`. | n/a |
| `PartialDataBanner` | `@/components/strategy-v2/PartialDataBanner` | `({ heading, body })` — `role="status"`, neutral `bg-surface-subtle p-4`. Server-safe (NOT `"use client"`). Use for the below-floor empty branch — NEVER `role="alert"`. | n/a |

**MUST NOT import (LOCKED honesty invariant — RESEARCH §Anti-Patterns + UI-SPEC §5):**
`FactsheetBody`, `MetricsColumn`, `buildAllocatorPortfolioFactsheetPayload`, `PercentileRankBadge`, and any `strategy-v2/*Panel.tsx` WRAPPER. Verified coupling: `RollingMetricsPanel.tsx:4,85-87` and `ReturnsDistributionPanel.tsx:4,50-52` both call `useLazyPanelMetrics(…, { strategyId })` — DB-fetch-coupled, unusable on a blend. Also forbidden: any `ingestSource:"api"` literal on the blend path; the per-strategy window keys `WINDOW_TO_DAYS={3M:90,6M:180,12M:365}` (`RollingMetricsPanel.tsx:14`) — the blend uses client-side 63/126/252 instead.

**GRAPH-01 (existing equity/drawdown, reskin only — lines 1902-1967):** `EquityChart scenarioSeries={scenarioWealthSeries}` (:1914-1920) + `DrawdownChart scenarioDailyPoints={…}` (:1945-1952) already render in the `lg:grid-cols-2` grid off `portfolio_daily_returns`-derived series. GRAPH-01 is a token-alignment verification (axes/grid/accent/tooltip read `chart-tokens.ts` literals) — NO new data path, NO relocation. The `scenarioAum <= 0` "Illustrative shape only" caveat (:1958-1965) and the BTC overlay toggle (:1925-1938) stay verbatim. (Open Q1: Wave-0 read of `../widgets/performance/EquityChart.tsx` + `DrawdownChart.tsx` to confirm they already read every token; if compliant, GRAPH-01 is verification-only.)

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` (MODIFIED — test, component)

**Analog:** the existing R3/IMPACT-02 guard (lines 2916-2953) — EXTEND it; do not replace it.

**Existing non-vacuous-guard pattern** (the discipline to preserve — :2925-2952):
```tsx
// Positive control: the projection DID render its KPI surface.
expect(screen.getByTestId("kpi-strip-mock")).toBeInTheDocument();
// ABSENT assertions keyed on a UNIQUE render-only testid (NOT queryByText
// (/percentile/i) which is vacuous — that text lives only in a title= attr).
expect(document.getElementById("factsheet-allocator")).toBeNull();
expect(document.getElementById("factsheet-signatures")).toBeNull();
expect(screen.queryByTestId("percentile-rank-badge")).toBeNull();
expect(screen.queryByText(/ranked against peers/i)).toBeNull();
// Positive control proves NON-VACUITY: render a real PercentileRankBadge in
// isolation, assert the SAME query finds it (fails loudly if testid renamed).
cleanup();
render(<PercentileRankBadge metric="sharpe" percentile={95} />);
expect(screen.getByTestId("percentile-rank-badge")).toBeInTheDocument();
```
- `PercentileRankBadge` is already imported at `:147` (`@/components/strategy/PercentileRankBadge`) — reuse for the positive control.

**Extensions required (RESEARCH §Test Map + Pitfall 5):**
1. **R3-guard-with-new-panels:** ensure the absence-assert runs WITH the two new Cards mounted (the default render already mounts them — assert `data-panel="blend-returns-distribution"` / `data-panel="blend-rolling"` ARE present alongside the percentile-badge ABSENT assert). Keep the isolated positive control intact.
2. **Per-panel empty branch:** render with `portfolio_daily_returns` below floor (`< window` / `< 10`) → assert each panel body swaps to `PartialDataBanner` (`role="status"`, the prescribed copy from UI-SPEC §Copywriting) and NO `role="alert"` appears; AND with a healthy series → assert the disclosure line ("… overlapping … not a forecast.") is present (heading-matches-body, #509 rule).
3. **Static import guard:** a source-read test asserting `ScenarioComposer.tsx` source does NOT import `FactsheetBody`/`MetricsColumn`/`buildAllocatorPortfolioFactsheetPayload` and contains no `ingestSource:"api"` literal.

**Mock precedent for new leaf charts:** the file already module-mocks `EquityChart`/`DrawdownChart`/`KpiStrip` to inert spies (`vi.mock` at :70-127). New recharts leaves either mock the same way OR follow the recharts-mock pattern in `ReturnHistogram.test.tsx` (RESEARCH Wave-0 note). `vi.mocked(X).mock.calls[0][0]` is the established prop-assert technique (:434/:517/:557).

---

## Shared Patterns

### Sample-std × √252 rolling math (the convention to MIRROR)
**Source:** `src/lib/portfolio-stats.ts::computeRollingMetric` (lines 117-135) + `src/lib/portfolio-math-utils.ts::stdDev` (lines 74-81, `sample=true` ⇒ n-1).
**Apply to:** the new adapter's `rollingVol` + `rollingSharpe`. The adapter's test must assert numeric parity against `computeRollingMetric` (proves "mirror").
**Anti-pattern (do NOT apply):** `src/lib/factsheet/rolling.ts` (lines 82-101, 129-134) uses `pstdev` (population, ÷n) and null-pads the warmup region — both MISMATCH the LOCKED pin. Its Sortino `/window` denominator (line 117) is the ONLY correct part, but compute it on the sample basis the engine uses.

### Engine annualization conventions (252-only, downside ÷ total n)
**Source:** FROZEN `src/lib/scenario.ts` (lines 340-361): `volatility = volDaily × √252`, `sharpe = meanR×252 / volatility`, `downsideVar = downsideSumSq / n` then `× √252`, numerator `meanR × 252`.
**Apply to:** every rolling series — the blend math must match the KPI-strip math the same engine produces. NO `√365`/`*365`/`√250` anywhere. ZERO diff to `scenario.ts`/`scenario.test.ts` (CI diff check).

### Honest empty / disclosure chrome
**Source:** `src/components/strategy-v2/PartialDataBanner.tsx` (`role="status"`, `bg-surface-subtle`) + the muted caption pattern in `RollingMetrics.tsx:164-168` (`text-xs text-text-muted`) + the existing composer caveat (`ScenarioComposer.tsx:1958-1965`, `text-[11px] text-text-muted`).
**Apply to:** both new panels. Each renders its OWN method/overlap-N/horizon line above the floor and `PartialDataBanner` below it — NEVER `role="alert"` (no fetch to fail; absence is honest-neutral).

### Chart-stack visual tokens
**Source:** `src/components/charts/chart-tokens.ts` — `CHART_ACCENT="#1B6B5A"` (:8), `CHART_POSITIVE="#15803D"` (:24), `CHART_NEGATIVE="#DC2626"` (:25), `CHART_TEXT_MUTED="#94A3B8"` (:10), `CHART_AXIS_TICK="#64748B"` (:19), `CHART_TICK_STYLE` (:70), `CHART_TOOLTIP_STYLE` (:55), `CHART_TRACK="#F1F5F9"` (:17), `CHART_BORDER="#E2E8F0"` (:11).
**Apply to:** the reused leaves ALREADY read these (verified per leaf). The host Card chrome uses `--color-*` Tailwind classes (`text-text-primary`, `text-text-muted`, `bg-surface`). GRAPH-01 verifies equity/drawdown read these literals.

---

## No Analog Found

None. Every file has a strong in-repo analog:

| File | Role | Analog status |
|------|------|---------------|
| `scenario-blend-panels.ts` | adapter | exact — `portfolio-stats.ts::computeRollingMetric` |
| `scenario-blend-panels.test.ts` | test | exact — `portfolio-stats.test.ts` |
| `ScenarioComposer.tsx` (edit) | host mount | exact — its own `<Card className="mt-6">` siblings |
| `ScenarioComposer.test.tsx` (edit) | test | exact — its own R3 guard block (:2916-2953) |

---

## Metadata

**Analog search scope:** `src/lib/` (portfolio-stats, portfolio-math-utils, scenario, factsheet/rolling, min-history), `src/components/charts/` (5 leaf charts + chart-tokens), `src/components/strategy-v2/` (SegmentedControl, PartialDataBanner, RollingMetricsPanel, ReturnsDistributionPanel), `src/app/(dashboard)/allocations/components/` (ScenarioComposer + test + ScenarioBenchmarkSection).
**Files scanned:** 16 (12 read in full / targeted, 4 grep-located).
**Pattern extraction date:** 2026-06-23
