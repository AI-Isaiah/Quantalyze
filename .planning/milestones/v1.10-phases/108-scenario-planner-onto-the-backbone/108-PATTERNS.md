# Phase 108: Scenario-planner onto the backbone - Pattern Map

**Mapped:** 2026-07-15
**Files analyzed:** 6 (1 delete, 1 delete-test, 1 consumer rewire, 1 new adapter, 2 new/edited tests)
**Analogs found:** 6 / 6 (all in-repo, live precedents)

> Pure client-side TS refactor. No API/DB/server/CDN. The Next.js `next-cache-components`
> and `react-best-practices` skill injections fired on path globs but are **not relevant** —
> nothing here touches caching, RSC boundaries, or new React patterns. The consumer edit is a
> one-line import swap + a `useMemo` body change inside an existing client component.

---

## File Classification

| File (new/modified/deleted) | Action | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|---|
| `src/lib/scenario-blend-panels.ts` | **DELETE** | utility (pure derive) | transform | — (removed) | n/a |
| `src/lib/scenario-blend-panels.test.ts` | **DELETE** | test | transform | — (removed with module) | n/a |
| `src/lib/scenario-blend-panels-adapter.ts` *(new; name at planner discretion)* | **CREATE** | utility (backbone adapter) | transform | `scenario-factsheet-payload.ts` | exact (sibling scenario→backbone adapter) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | **MODIFY** | component (consumer) | request-response (props) | itself (`:2814-2823` memo) | self / in-place |
| new SC-2 delete-gate test *(e.g. `src/lib/scenario-blend-panels-absent.test.ts`)* | **CREATE** | test (source-scan) | transform | `leverage-backbone-gates.test.ts` | exact (107 delete-gate) |
| SC-4 parity pin *(in the new adapter's `.test.ts`)* | **CREATE** | test (mutation-falsifiable pin) | transform | `scenario-factsheet-payload.test.ts:210-223` PAYLOAD-03 | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` | **MODIFY** | test | — | itself (`:3553` positive control) | self / in-place |

**Confirmed UNTOUCHED (out of scope — do NOT edit):** `src/lib/portfolio-stats.ts`,
`src/lib/health-score.ts`, `src/__tests__/metrics-parity.test.ts`, `src/lib/scenario.ts` (byte-frozen).
`metrics-parity.test.ts` does not import the deleted module, so deletion cannot touch it.

---

## Pattern Assignments

### `src/lib/scenario-blend-panels-adapter.ts` (utility, transform) — THE core new file

**Primary analog:** `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts`
(the LIVE sibling: already routes the scenario **chart** onto backbone primitives by synthesizing off
`portfolio_daily_returns`). **Primitive source:** `src/lib/factsheet/rolling.ts`.

The new adapter must reproduce the SAME public shape the deleted `buildBlendPanels` returned (the composer
is props-only and unchanged in shape), but compute the rolling series via the **population-std** backbone
primitives (`rollingVol`/`rollingSharpe`/`rollingSortino` from `factsheet/rolling.ts`) and the quantiles via
`quantileSummary` (`factsheet/quantiles.ts`), reshaped back to min/max whiskers.

**Shape to preserve (from the deleted `BlendPanelSeries`, `scenario-blend-panels.ts:43-56`):**
```typescript
export interface BlendPanelSeries {
  histogramSeries: { date: string; value: number }[];   // cumprod(1+r) wealth
  quantiles: Record<string, number[]>;                   // { All: [min, p25, p50, p75, max] }
  rollingSharpe: Record<string, { date: string; value: number }[]>; // { sharpe_365d: series }
  rollingVol: { date: string; value: number }[];
  rollingSortino: { date: string; value: number }[];
  usableN: number;
}
```

**Imports pattern to mirror** (`scenario-factsheet-payload.ts:59-74` — how the sibling pulls backbone
primitives + `DailyPoint`):
```typescript
import type { DailyPoint } from "@/lib/portfolio-math-utils";
import { rollingVol, rollingSharpe, rollingSortino } from "@/lib/factsheet/rolling";
import { quantileSummary } from "@/lib/factsheet/quantiles";
```
Do NOT import `mean, stdDev` from `portfolio-math-utils` (that was the sample-std path the delete removes).

**Backbone rolling primitives already accept an explicit window** — this is what preserves the 3M/6M/12M
toggle without calling the heavy `deriveSeriesBundle` (`factsheet/rolling.ts:85-97`):
```typescript
export function rollingVol(rets: number[], window = ROLL_WINDOW_6MO, periodsPerYear = 252) {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  const sqrtN = Math.sqrt(periodsPerYear);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    out[i] = pstdev(w) * sqrtN;   // ÷ n (POPULATION) — vs deleted module's stdDev(slice, true) ÷ n−1
  }
  return out;
}
```
`rollingSharpe` (`:99-113`) and `rollingSortino` (`:115-137`) have the identical `(rets, window, periodsPerYear)`
signature. **CONTRACT NOTE:** they return `Array<number | null>` **parallel to the full `rets` index**
(null for `i < window-1`), NOT the compacted `{date,value}[]` the deleted module produced. The adapter MUST
**zip `dates[i] ↔ value[i]` and drop the leading `null` warmup** to reproduce today's `{date,value}[]`
(dated at the window's last day). This is the one seam where the backbone output shape differs.

**Degenerate `usableN` gate to re-home VERBATIM** (`scenario-blend-panels.ts:154-176`) — Claude's-discretion
re-home; keep it co-located in the adapter so the 3 composer UI keys stay in sync:
```typescript
let usableN = 0;
let hasNonFinite = false;
for (const p of portfolioDaily) {
  if (Number.isFinite(p.value)) usableN++;
  else hasNonFinite = true;
}
if (hasNonFinite || portfolioDaily.length < MIN_USABLE /* 10 */ || portfolioDaily.length < window) {
  return { ...EMPTY, usableN: hasNonFinite ? 0 : usableN };
}
```
`MIN_USABLE = 10`. Report `usableN: 0` when ANY non-finite value is present (poisons the whole series) —
this exact rule is what WR-02 (`ScenarioComposer.test.tsx:3495`) pins.

**Histogram cumulative-wealth** — copy unchanged (`scenario-blend-panels.ts:182-186`); this is backbone-consistent
geometric wealth (same as `compute.ts::cumEq`), no second Sharpe involved:
```typescript
let c = 1;
const histogramSeries = portfolioDaily.map((p) => { c *= 1 + p.value; return { date: p.date, value: c }; });
```

**Quantiles — reshape at the seam to KEEP min/max whiskers** (USER DECISION; do NOT adopt p05/p95).
`quantileSummary` (`quantiles.ts:19-27`) returns `{p05,p25,p50,p75,p95,min,max,mean}`. Build the positional
`{All: [...]}` the `ReturnQuantiles` chart expects (`ReturnQuantiles.tsx:12-14` → `data: Record<string, number[]>`),
taking **min/max** for tails:
```typescript
const q = quantileSummary(rets);
const quantiles = { All: [q.min, q.p25, q.p50, q.p75, q.max] };
```
This matches today's positional `[q0, q25, q50, q75, q100]` where q0/q100 were absolute min/max
(`scenario-blend-panels.ts:190-198`).

**Sharpe key stays `sharpe_365d`** (`scenario-blend-panels.ts:204-206`) — `RollingMetrics` resolves the
`CHART_ACCENT` stroke off that key; the composer overrides the visible legend label to the true window
(`ScenarioComposer.tsx:4361 seriesLabels={{ sharpe_365d: \`${rollingWindow}d\` }}`). Do not rename the key.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (component, consumer) — MODIFY in place

**Analog:** itself — a two-point surgical edit, no shape change (SC-4 parity; UI must stay pixel-identical).

**Import swap** (`:102`):
```typescript
// FROM:
import { buildBlendPanels } from "@/lib/scenario-blend-panels";
// TO (new adapter export name — planner's choice):
import { buildBlendPanels } from "@/lib/scenario-blend-panels-adapter";
```
Keeping the export named `buildBlendPanels` minimizes the diff and keeps the memo body byte-identical.

**Call site unchanged in shape** (`:2818-2823`) — same args, same returned `BlendPanelSeries`:
```typescript
const blendPanels = useMemo(
  () => buildBlendPanels(portfolioDaily, rollingWindow, blendBasis),
  [portfolioDaily, rollingWindow, blendBasis],
);
```
`portfolioDaily` = `scenarioMetrics.portfolio_daily_returns ?? []` (`:2814-2816`, memoized on engine-output
reference). `blendBasis` (√365 if any crypto leg else 252) is defined at `:2472` and already fed to
`computeScenario`. `rollingWindow` state defaults to `126` (`:1015`); toggle at `:4331-4340`.

**The 3 `usableN` UI keys that MUST render identically** (do not touch):
- distribution empty-branch: `:4282` `blendPanels.histogramSeries.length === 0`
- per-option `SegmentedControl` disable: `:4338` `blendPanels.usableN < Number(w)`
- rolling empty-branch: `:4342` `blendPanels.usableN < rollingWindow`

`WINDOW_LABEL` (`:202-206`): `{63:"3M", 126:"6M", 252:"12M"}`. Frozen caption `252-day annualized`
(`:4377`) stays verbatim even for crypto blends (UI-SPEC copy contract).

---

### SC-2 delete-gate test (test, source-scan) — CREATE

**Analog:** `src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts` (107's permanent tripwire).
**Copy its exact structure:** `// @vitest-environment node`, recursive `walkSource(SRC_ROOT)`, `stripComments`
(so prose can't self-trip), a self-exclusion `SELF_REL`, and a **liveness** test proving the matcher actually
matches a retired sample.

**Adapt the assertion to SC-2:** assert the deleted module + its export are **absent** from `src/`, and the
KEEP siblings are **present**. Mirror the concatenated-token trick (`leverage-backbone-gates.test.ts:56-60`)
so the gate never matches itself:
```typescript
const FORBIDDEN = ["scenario-blend-" + "panels", "buildBlend" + "Panels"];
// assert no src/ file (except self) imports/defines these
// AND assert-present: portfolio-stats.ts, health-score.ts, metrics-parity.test.ts still exist on disk
```
Note the NEW adapter file name must NOT contain the forbidden `scenario-blend-panels` token, or add it to
the self-exclusion list. Prefer a distinct name (e.g. `scenario-blend-adapter.ts`) to avoid the collision.

---

### SC-4 parity pin (test, mutation-falsifiable) — CREATE (in the new adapter's `.test.ts`)

**Analog:** `scenario-factsheet-payload.test.ts:210-223` (PAYLOAD-03). This is the exact template: it pins the
**population-std** value at 6 decimals and documents that a sample-std bleed fails loudly.
```typescript
// PAYLOAD-03 (the template): compute.ts uses POPULATION stdev (÷n); the deleted
// scenario-blend-panels.ts used SAMPLE stdev (÷n−1). For a fixture whose population
// σ is exactly 0.0075, ann_vol = 0.0075·√252. A sample-std bleed → ≈0.12110, fails @6dp.
it("ann_vol is the POPULATION-std value 0.0075·√252 — a sample-std bleed fails", () => {
  const p = buildScenarioFactsheetPayload({ portfolioDaily: BLEND_30 });
  expect(p.strategyMetrics.ann_vol).toBeCloseTo(0.0075 * Math.sqrt(252), 6);
});
```
**Adapt:** pin the backbone-routed blend's rolling vol/Sharpe/Sortino to their **population-std** values for a
representative blend, **at each window (63/126/252)**, and assert the **min/max whiskers** (not p05/p95).
Make it mutation-falsifiable: feeding a sample-std source turns it RED. Build a fixture with a known population
σ (reuse the `0.0075·√252` construction if convenient).

---

### `ScenarioComposer.test.tsx` (test) — MODIFY: re-anchor the positive control

**Analog:** itself (`:3545-3561`, the "no factsheet import on the blend path" static guard).
The positive control at `:3553` currently reads:
```typescript
expect(source).toMatch(/buildBlendPanels/);
```
After the rewire, `buildBlendPanels` still appears (if the export keeps that name) — but if the planner renames
the export, re-anchor to a live token present in the rewired source (e.g. the new adapter import specifier).
The forbidden regex (`:3554-3560` — `FactsheetBody|MetricsColumn|buildAllocatorPortfolioFactsheetPayload`,
`ingestSource:"api"`, `PercentileRankBadge`, `*Panel`) is NOT tripped by importing from the backbone adapter
or `factsheet/rolling.ts` — confirm the honesty guard still holds. WR-02 (`:3495`) must stay green through
the rewire (it pins the `usableN` degenerate-collapse behavior).

---

## Shared Patterns

### Synthesize-a-minimal-input off `portfolio_daily_returns` (the sibling adapter discipline)
**Source:** `scenario-factsheet-payload.ts:293-386` (`buildReturnsBody`).
**Apply to:** the new blend-panels adapter.
The engine emits the canonical input at `scenario.ts:440-443`:
```typescript
const portfolio_daily_returns = commonDates.map((date, i) => ({ date, value: portDaily[i] }));
```
`value` is the daily RETURN (decimal), full-resolution, unrounded — the correct input for the backbone
primitives. A hypothetical blend has no natural markets/name; the sibling synthesizes `markets: []`,
`strategyName: "Scenario"` (`:459-461`). The blend is always **geometric** (`isArithmetic: false`) — the engine
only cumprods `1+r` (`scenario.ts:449`), there is no arithmetic path.

### Degenerate gate BEFORE any math, never NaN/Inf to a chart (security V5)
**Source:** `scenario-factsheet-payload.ts:304-330` (returns-degenerate gate before `compute()`), and the
deleted module's stricter `usableN` gate (`scenario-blend-panels.ts:154-176`).
**Apply to:** the new adapter. Preserve the collapse-to-empty on `hasNonFinite || length < 10 || length < window`
so no non-finite value reaches `ReturnHistogram`/`RollingMetrics`. `computeScenario` already pre-collapses
`portfolio_daily_returns → []` on its own degenerate early-returns (`scenario.ts:250,393,503`).

### Permanent source-scan tripwire (the 107 delete-gate discipline)
**Source:** `leverage-backbone-gates.test.ts` (whole file).
**Apply to:** the SC-2 delete-gate. Node env, recursive walk, comment-stripping, concatenated forbidden tokens,
a liveness sub-test proving the matcher works.

### Mutation-falsifiable convention pin (the PAYLOAD-03 discipline)
**Source:** `scenario-factsheet-payload.test.ts:210-223`.
**Apply to:** the SC-4 parity pin. Pin the population-std value at 6dp with a WHY comment; a sample-std bleed
must fail loudly (CLAUDE.md Rule 9).

---

## No Analog Found

None. Every file has a strong in-repo precedent (the sibling adapter, 107's gate, PAYLOAD-03). No RESEARCH-only
fallback patterns are required.

---

## Key Seam Reminders (the four load-bearing deltas)

1. **Sample-std → population-std** (DECIDED: accept backbone). `rolling.ts::pstdev` ÷n vs deleted `stdDev(slice,true)`
   ÷n−1. Sub-display-precision shift; pin the population value.
2. **Toggle preserved via primitives, not `deriveSeriesBundle`** (DECIDED). `rollingVol/Sharpe/Sortino` take an
   explicit `window` (`rolling.ts:87`) — call them with `rollingWindow` directly. Do NOT call the 235ms
   `deriveSeriesBundle` per toggle press.
3. **Quantiles reshape to min/max** (DECIDED: keep min/max). `{All:[min,p25,p50,p75,max]}` from `quantileSummary`.
4. **Output-shape mismatch:** backbone primitives return `Array<number|null>` parallel to `rets`; the adapter
   zips against `dates[]` and drops the leading null warmup to reproduce `{date,value}[]`.

---

## Metadata

**Analog search scope:** `src/lib/`, `src/lib/factsheet/`, `src/app/(dashboard)/allocations/`,
`src/app/factsheet/[id]/v2/`, `src/components/charts/`.
**Files read (full or targeted):** `scenario-blend-panels.ts`, `scenario-factsheet-payload.ts`,
`factsheet/rolling.ts`, `factsheet/quantiles.ts`, `ScenarioComposer.tsx` (:200-206, :2800-2839, :4270-4389),
`leverage-backbone-gates.test.ts`, `scenario-factsheet-payload.test.ts:195-238`,
`ScenarioComposer.test.tsx:3485-3561`, `107-01-SUMMARY.md`, `scenario.ts:438-443`,
`ReturnQuantiles.tsx`/`RollingMetrics.tsx` prop heads.
**Pattern extraction date:** 2026-07-15
