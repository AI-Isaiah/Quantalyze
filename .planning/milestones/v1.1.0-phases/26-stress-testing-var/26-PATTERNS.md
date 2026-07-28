# Phase 26: Stress Testing & VaR - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 5 (4 new + 1 modified)
**Analogs found:** 5 / 5 (every new file has an exact sibling analog)

> Phase 26 is **pure assembly of golden-tested primitives** — almost no novel arithmetic (only `projectedImpact = beta * shock` + a null-on-degenerate envelope). The entire risk class is **honesty/correctness**, and every analog below is the established honesty template. Copy structure, copy guard order, copy the formatter-on-every-value discipline. Do NOT fork the VaR arithmetic; WRAP it.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/lib/scenario-stress.ts` | utility (pure math lib) | transform | `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` (structure) + `src/lib/portfolio-stats.ts` `computeVaR`/`computeExpectedShortfall`/`computeAlphaBeta` (arithmetic to reuse) | exact (sibling) |
| `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` | test | transform | `src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts` (golden + intersection + null-safety) + `src/lib/sample-floor.test.ts` (degenerate matrix style) | exact (sibling) |
| `src/app/(dashboard)/allocations/components/StressVarSection.tsx` | component (props-only presentational) | request-response | `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx` + `src/components/scenarios/SampleFloorEmptyState.tsx` + `src/components/strategy-v2/SegmentedControl.tsx` | exact (sibling) |
| `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` | test (component) | request-response | `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx` + `src/components/scenarios/SampleFloorEmptyState.test.tsx` | exact (sibling) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (mount edit only) | component (mount seam) | request-response | the existing `ScenarioBenchmarkSection` mount block at lines 1574-1580 (insert a sibling `<Card className="mt-6">` immediately after) | exact (in-file seam) |

**ANTI-PATTERN reference (do NOT copy):** `src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx` — the existing VaR widget. It paints losses red (`#DC2626`), fabricates a `0` zero-state, and uses a `<10` length guard. It is the *non-compliant precedent*. Reuse its *arithmetic source* (`computeVaR`/`computeExpectedShortfall` from `@/lib/portfolio-stats`) but NOT its presentation or degeneracy handling. Do not edit this widget (out of scope).

---

## ⚠️ Load-bearing trap: the two different Ns (map each correctly)

Two statistics live in one section over **two different overlap windows**. Wiring both on the same N is a misrepresentation bug. The plan must thread each N to its own floor gate AND its own disclosure caption.

| Statistic | N source | Where it comes from | Floor gate |
|-----------|----------|---------------------|------------|
| **VaR / CVaR** | `scenarioMetrics.n` (the scenario's own UNION-axis overlap, the same N the benchmark heading + methodology line already report) | `computeScenario(...).n` — built over `commonDates` (the zero-filled union axis), `src/lib/scenario.ts:209-211` | `evaluateSampleFloor(scenarioMetrics.n, 60)` |
| **β-shock** | `innerJoinByDate(portfolioDaily, btcDaily).p.length` (the BTC INTERSECTION overlap — can be **strictly smaller**, BTC may not cover the full scenario window) | `innerJoinByDate` in `scenario-benchmark.ts:63-79` (intersection only, no zero-fill) | `evaluateSampleFloor(innerJoinByDate(...).p.length, 60)` |

**Disclosure rule (RESEARCH Pitfall 2 + Open Q1):** each number names its OWN true N. If the two Ns differ → render **two methodology captions** (one under the shock row using the BTC-overlap N, one under the VaR/CVaR rows using the scenario N). If equal (common when BTC covers the full window) → a single caption is fine. NEVER collapse to one N when they differ. `[VERIFIED: scenario.ts computes n over the UNION commonDates (:209-211); scenario-benchmark.ts computes n over the inner-join intersection (:101-102)]`

---

## Pattern Assignments

### `src/app/(dashboard)/allocations/lib/scenario-stress.ts` (utility, transform)

**Primary analog:** `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` (structure: pure, null-on-degenerate result interface, inner-join, relative-scale degeneracy guard).
**Arithmetic to REUSE (wrap, never fork):** `computeVaR`, `computeExpectedShortfall`, `computeAlphaBeta` from `@/lib/portfolio-stats`; `innerJoinByDate` + `computeScenarioBenchmark` from `../lib/scenario-benchmark`.

**Imports pattern** (copy from `scenario-benchmark.ts:38-39`, extend):
```typescript
import { computeVaR, computeExpectedShortfall } from "@/lib/portfolio-stats";
import { mean, type DailyPoint } from "@/lib/portfolio-math-utils";
import { computeScenarioBenchmark, innerJoinByDate } from "./scenario-benchmark";
// DailyPoint is also re-exported from "@/lib/scenario" — use the same import the
// sibling section uses for consistency.
```

**Null-safe result interface pattern** (mirror `scenario-benchmark.ts:41-54` + the `NULL_RESULT` factory at `:81-88`):
```typescript
// scenario-benchmark.ts:81-88 — copy this NULL_RESULT shape verbatim for the stress result.
const NULL_RESULT = (n: number): ScenarioBenchmark => ({
  n,
  trackingError: null,
  informationRatio: null,
  alpha: null,
  beta: null,
  correlation: null,
});
// → for stress: every field (beta, projectedImpact, var, cvar) is `number | null`,
//   each `null` on degeneracy so the UI renders an em-dash. Two N fields: the VaR
//   window N (scenario) and the β-shock window N (BTC overlap) — see the two-N trap.
```

**β-shock path — REUSE the β source, never re-derive cov/var** (the single call from `scenario-benchmark.ts:147`):
```typescript
// The β you need IS computeScenarioBenchmark(...).beta — it already inner-joins,
// computes cov/var via the golden-tested computeAlphaBeta, AND null-guards the
// constant-benchmark degeneracy via the relative-scale test. Reuse it directly.
const m = computeScenarioBenchmark(portfolioDaily, btcDaily); // m.beta = β_portfolio
const projectedImpact = m.beta === null ? null : m.beta * shock; // null β ⇒ null impact ⇒ "—"
// Near-market-neutral invariant: cov≈0 book ⇒ m.beta≈0 ⇒ projectedImpact≈0, NOT the full shock.
```

**VaR/CVaR path — WRAP the existing arithmetic with a null guard (Pitfall 1)** — these are the EXACT pre-existing signatures, verified from `src/lib/portfolio-stats.ts:142-168`:
```typescript
// src/lib/portfolio-stats.ts:142-154 (VERIFIED — live code; returns 0 NOT null on empty)
export function computeVaR(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;            // ← THE TRAP: returns 0, NOT null
  const sorted = [...returns].sort((a, b) => a - b);   // ascending
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((1 - confidence) * sorted.length)),  // LOWER/floor (type-1) quantile
  );
  return sorted[idx];                            // signed return quantile (negative in the tail)
}
// src/lib/portfolio-stats.ts:160-168 (VERIFIED)
export function computeExpectedShortfall(returns: number[], confidence: number): number {
  const var_ = computeVaR(returns, confidence);
  const tail = returns.filter((r) => r <= var_);  // at/beyond the VaR quantile (inclusive ≤)
  if (tail.length === 0) return var_;
  return mean(tail);                             // mean of the tail (CVaR ≤ VaR always)
}
```
**The wrap (do this in scenario-stress.ts):** short-circuit to `null` BEFORE calling them — never let a fabricated `0` escape. Only call `computeVaR`/`computeExpectedShortfall` on a non-empty, floor-passing, non-constant series:
```typescript
// 1. portfolioDaily.length === 0 (engine emits [] for n<10/constant/non-finite) → var:null, cvar:null
// 2. relative-scale degeneracy guard (Pattern 3) on the series for the n≥60-but-constant case → null
// 3. else call computeVaR/computeExpectedShortfall on portfolioDaily.map(d => d.value)
//    NO leverage multiplier — leverage is ALREADY baked into portfolio_daily_returns (Pitfall 3).
```

**β source signature** (verified `src/lib/portfolio-stats.ts:412-436`): `computeAlphaBeta(returns, benchmark) → { alpha, beta }`, `beta = varB > 0 ? cov/varB : 0`. NOTE its `varB > 0` branch returns `0` (not null) for n<2, and **fabricates a finite beta ~2 for a numerically-constant benchmark** (float residue ~1e-37 passes `> 0`) — this is exactly why you go through `computeScenarioBenchmark` (which adds the relative-scale guard at `scenario-benchmark.ts:139-140`), NOT `computeAlphaBeta` directly.

**Relative-scale degeneracy guard (Pattern 3) — copy verbatim from `scenario-benchmark.ts:139-140`:**
```typescript
const benchmarkIsDegenerate =
  Math.sqrt(varB) <= 1e-12 * (Math.abs(meanB) + 1e-12);
// Exact `=== 0` MISSES float residue and fabricates finite garbage. Use this for the
// constant-portfolio-series VaR guard (n≥60 but numerically constant) too.
```

---

### `src/app/(dashboard)/allocations/components/StressVarSection.tsx` (component, presentational props-only)

**Primary analog:** `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx` (the verbatim template — props-only, guard-order routing, `MetricRow`, methodology caption, em-dash discipline).
**Secondary analogs:** `SampleFloorEmptyState.tsx` (below-floor render), `SegmentedControl.tsx` (the shock control).

**Imports + `"use client"` pattern** (copy from `ScenarioBenchmarkSection.tsx:1-11`, add the floor + segmented control):
```typescript
"use client";
import { formatPercent, formatNumber } from "@/lib/utils";
import { methodologyLine } from "@/lib/scenario-history";
import { evaluateSampleFloor } from "@/lib/sample-floor";
import { EmptyStateCard } from "@/components/ui/EmptyStateCard";
import { SampleFloorEmptyState } from "@/components/scenarios/SampleFloorEmptyState";
import { SegmentedControl } from "@/components/strategy-v2/SegmentedControl";
import { computeScenarioStress } from "../lib/scenario-stress";
import type { DailyPoint } from "@/lib/scenario";
```

**Props shape** (mirror `ScenarioBenchmarkSection.tsx:62-72`, extend per RESEARCH mount seam):
```typescript
interface StressVarSectionProps {
  portfolioDaily: DailyPoint[];   // scenarioMetrics.portfolio_daily_returns ?? []
  btcDaily: DailyPoint[];         // composer btcDaily state
  btcAvailable: boolean;          // composer btcAvailable (mirrors benchmarkAvailable)
  n: number;                      // scenarioMetrics.n — the VaR-window N (NOT the BTC overlap)
  strategyCount: number;          // deAliased.strategies.length (gate can't see it; call-site supplies)
}
```

**`MetricRow` — copy verbatim from `ScenarioBenchmarkSection.tsx:74-98`** (same tokens, same `data-testid` shape; numbers are MONOCHROME `text-text-secondary` Geist Mono — NOT red):
```typescript
function MetricRow({ metric, label, value }: { metric: string; label: string; value: string }) {
  return (
    <div data-testid={`stress-row-${metric}`}
      className="flex items-center justify-between border-b border-border/50 py-2">
      <span className="text-xs text-text-muted">{label}</span>
      <span data-testid={`stress-value-${metric}`}
        className="text-xs font-metric text-text-secondary">{value}</span>
    </div>
  );
}
```

**Guard-order routing (NON-NEGOTIABLE, #509)** — copy the exact ordering from `ScenarioBenchmarkSection.tsx:119-131`, adapted to the UI-SPEC §States 4-state contract:
```typescript
// 1. scenario-side absence FIRST (never misattribute to BTC)
if (portfolioDaily.length === 0) {
  return <EmptyStateCard heading={EMPTY_HEADING} body={NO_SCENARIO_RETURNS_BODY} />;
}
// 2. BTC unavailable (mirrors benchmarkAvailable=false)
if (!btcAvailable) {
  return <EmptyStateCard heading={BTC_UNAVAILABLE_HEADING} body={BTC_UNAVAILABLE_BODY} />;
}
// 3. floor gate — pass the verdict + feature + strategyCount; the component itself
//    routes no-usable-n FIRST then below-floor (SampleFloorEmptyState.tsx:50 drops on ok).
const verdict = evaluateSampleFloor(n, /* SAMPLE_FLOOR_OVERLAPPING_DAYS — import, never literal 60 */);
if (!verdict.ok) {
  return <SampleFloorEmptyState verdict={verdict} feature="VaR" strategyCount={strategyCount} />;
}
// 4. ok — SegmentedControl + headline impact + VaR/CVaR rows + methodology caption(s)
```
> NOTE the two-N trap: the β-shock area has its OWN floor verdict on the BTC-overlap N. The plan decides whether the section degrades the whole section on the scenario N or gates the shock row independently on the BTC-overlap N (RESEARCH recommends per-area gating + per-area caption).

**Methodology caption — extend `methodologyLine(n)` exactly as the sibling does** (`ScenarioBenchmarkSection.tsx:160-162`):
```typescript
// Sibling appends "Metrics are 252-day annualized active returns." after the line.
// Phase 26 appends the confidence level + keeps "not a forecast" (already in the line):
<p className="mt-2 text-[11px] text-text-muted">
  {methodologyLine(m.n)} {/* "Historical realized · {N} overlapping days · not a forecast." */}
</p>
// UI-SPEC §Copywriting target: "Historical · {N} overlapping days · 95% · not a forecast."
```
`methodologyLine` verified at `src/lib/scenario-history.ts:41-43`: `` `Historical realized · ${n} overlapping days · not a forecast.` ``

**Shock control — `SegmentedControl` (verified `src/components/strategy-v2/SegmentedControl.tsx:31-73`):**
```typescript
// Props: { options: {id,label,disabled?}[], activeId, onChange, ariaLabel }.
// Active segment = border-accent + text-accent (the ONE accent use in the section).
// Inactive = border-border + text-text-secondary. 12px / 2-weight contract honored.
<SegmentedControl
  options={[{ id: "-0.10", label: "−10%" }, { id: "-0.20", label: "−20%" }, { id: "-0.30", label: "−30%" }]}
  activeId={shockId}            // default "-0.30"
  onChange={setShockId}
  ariaLabel="BTC shock"
/>
```
This is the ONLY stateful piece in an otherwise pure section — `useState` for the active shock preset; the projection recomputes from it (UI-SPEC: the shock-preset selection IS the interaction, no submit CTA).

**Empty-state copy (UI-SPEC §Copywriting — verbatim, heading MUST match body, #509):**
- `EMPTY_HEADING = "Stress & VaR unavailable"`
- `NO_SCENARIO_RETURNS_BODY = "This scenario has no projected return history yet, so there's nothing to stress or measure. Add strategies with enough history to the scenario first."`
- `BTC_UNAVAILABLE_HEADING = "Stress testing unavailable"`
- `BTC_UNAVAILABLE_BODY = "The BTC factor series isn't available right now, so we can't project a market shock. Try again shortly."`
- below-floor copy comes from `@/lib/sample-floor` via `SampleFloorEmptyState` — NEVER re-authored.

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — MOUNT EDIT ONLY

**Insertion point: immediately AFTER the `ScenarioBenchmarkSection` `<Card>` block, lines 1574-1580** (verified). Surrounding JSX:
```tsx
// src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1574-1580 (EXISTING — the seam)
<Card className="mt-6">
  <ScenarioBenchmarkSection
    portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
    btcDaily={btcDaily}
    benchmarkAvailable={btcAvailable}
  />
</Card>
{/* ── INSERT NEW Phase-26 section HERE, before the CORR-01 "Pairwise correlation" Card at :1589 ── */}
```
**The new mount block to add** (sibling `<Card className="mt-6">`, every prop already in composer scope — no new state/fetch/memo):
```tsx
<Card className="mt-6">
  <StressVarSection
    portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
    btcDaily={btcDaily}
    btcAvailable={btcAvailable}
    n={scenarioMetrics.n}
    strategyCount={deAliased.strategies.length}
  />
</Card>
```

**Props each sibling section receives (verified in composer scope):**
| Prop | Source in composer | Line |
|------|--------------------|------|
| `portfolioDaily` | `scenarioMetrics.portfolio_daily_returns ?? []` (from `computeScenario` memo) | `:937`, `:1576` |
| `btcDaily` | `const [btcDaily, setBtcDaily] = useState<DailyPoint[]>([])` | `:439` |
| `btcAvailable` | `const [btcAvailable, setBtcAvailable] = useState(false)` | `:440` |
| `n` (VaR window) | `scenarioMetrics.n` (same N the correlation heatmap uses at `:1602`) | `:937` |
| `strategyCount` | `deAliased.strategies.length` (the active de-aliased strategy set) | `:923`, `:937` |

Imports needed in the composer: add `import { StressVarSection } from "./StressVarSection";` next to the existing `import { ScenarioBenchmarkSection } from "./ScenarioBenchmarkSection";` at `:93`. `Card` is already imported (`:71`).

---

### `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` (test, transform)

**Primary analog:** `scenario-benchmark.test.ts` (golden + intersection + null-safety, 3 `describe` blocks). **Secondary:** `sample-floor.test.ts` (one-`it`-per-branch degenerate matrix).

**Fixture helper — copy `days(n)` verbatim from `scenario-benchmark.test.ts:34-39`:**
```typescript
type DP = { date: string; value: number };
function days(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `2024-01-${String(i + 1).padStart(2, "0")}`);
}
```

**Golden VaR/CVaR oracle (RESEARCH §Code Examples — the falsifiable pin):** 20-value series, `idx = floor((1-0.95)*20) = 1`, `VaR(95%) = sorted[1] = -0.060`, `CVaR(95%) = mean([-0.080, -0.060]) = -0.070`:
```typescript
expect(var95).toBeCloseTo(-0.060, 10);
expect(cvar95).toBeCloseTo(-0.070, 10);
expect(cvar95).toBeLessThanOrEqual(var95);   // CVaR always at least as extreme
// "not parametric" negative control: a Normal-tail / linear-interp impl would NOT yield -0.060.
```
Derive expected numbers from the math definitions IN the test (mirror the `scenario-benchmark.test.ts` golden-comment style at `:45-62`) — never read back from the implementation.

**Intersection test — copy the divergent-poison structure from `scenario-benchmark.test.ts:105-160`** (a wild value on a non-overlapping date must NOT move `projectedImpact` → proves the β-shock inner-joins, not unions).

**Null-safety / degeneracy matrix — copy the `describe(... null degenerate paths ...)` style from `scenario-benchmark.test.ts:166-258`** and the RESEARCH §Degeneracy matrix:
| Input | Expected |
|-------|----------|
| `portfolioDaily = []` | all fields null |
| constant `portfolioDaily` (float-residue var) n≥60 | `var`/`cvar` null (relative-scale guard, never fabricated 0) |
| constant BTC series over overlap ≥60 | `beta`/`projectedImpact` null (`computeScenarioBenchmark` already guards) |

**Phase-26-specific invariant tests (RESEARCH §Validation):**
- near-market-neutral: cov≈0 book ⇒ `|projectedImpact| < ε`, NOT `≈ |shock|`.
- leverage: 2× uniform leverage ⇒ `var/cvar` `toBeCloseTo(2×, 8)` (quantile of linearly-scaled daily series); **Sharpe unchanged** (the invariant contrast). Max-drawdown scales **monotonically** (more negative), NOT exactly 2× (compounding caveat, Pitfall 4) — use a monotone assertion there.

---

### `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` (test, component)

**Primary analog:** `ScenarioBenchmarkSection.test.tsx` (state matrix, em-dash, disclosure presence). **Secondary:** `SampleFloorEmptyState.test.tsx` (below-floor render + honest-absence assertions).

**Test scaffolding — copy `buildDates` + `series` helpers verbatim from `ScenarioBenchmarkSection.test.tsx:25-50`** (business-day ISO dates, non-degenerate alternating series).

**State-matrix tests to mirror** (`ScenarioBenchmarkSection.test.tsx:60-244`):
- ok state renders SegmentedControl + headline impact + VaR/CVaR rows + the exact methodology line (assert the FULL string incl. the N, not just a substring — see `:90-92`).
- scenario-side empty (`portfolioDaily=[]`) names the scenario cause, NOT the BTC cause (`:173-200`).
- BTC-unavailable empty (`btcAvailable=false`) names the BTC cause (`:155-171`).
- below-floor → `SampleFloorEmptyState` heading "Not enough history for this estimate".
- em-dash discipline: a null metric cell renders `"—"`, NEVER `"0.00"` (copy the beta/alpha `within(row).getByTestId(...)` assertion at `:202-244`).
- honest absence: every empty state has NO `role="alert"`, NO `.text-negative` / red class (copy `:99`, `:126-127`, `SampleFloorEmptyState.test.tsx:73-83`).
- losses are MONOCHROME: assert no `#DC2626` / `text-negative` / `text-red` on the VaR/CVaR value cells (the explicit divergence from `VarExpectedShortfall.tsx`).

---

## Shared Patterns

### Honesty guard-order (#509) — applies to the StressVarSection
**Source:** `ScenarioBenchmarkSection.tsx:119-131`
**Apply to:** `StressVarSection.tsx`
Order is FIXED: (1) scenario-side absence → (2) BTC unavailable → (3) floor fail → (4) ok. Each empty state's heading and body describe the SAME true cause. Never blame BTC for a scenario-side absence.

### Sample-floor single source of truth (Phase-22)
**Source:** `src/lib/sample-floor.ts` (`SAMPLE_FLOOR_OVERLAPPING_DAYS=60` at `:37`, `evaluateSampleFloor` guard-first at `:70-88`) + `SampleFloorEmptyState.tsx`
**Apply to:** every tail/shock estimate in `scenario-stress.ts` + `StressVarSection.tsx`
Import `SAMPLE_FLOOR_OVERLAPPING_DAYS` — NEVER re-declare `60`. `evaluateSampleFloor` guards no-usable-n (null/NaN/Inf/negative) FIRST, then below-floor. `SampleFloorEmptyState` renders `null` on an `ok` verdict (fail-loud, `:50`). Pass `feature` ("VaR" / "stress") + `strategyCount` so a 0/1-strategy set routes to `fewStrategiesBody`. The single-source-value pin lives in `sample-floor.test.ts:31-33`; Phase 26 is the FIRST real consumer — `sample-floor.test.ts:18-23` notes the consumer-literal-ban teeth should be added when 26/27 land (planner discretion: a grep/AST sweep test asserting the section imports the constant).

### Em-dash discipline (never a fabricated 0)
**Source:** `src/lib/utils.ts` `formatPercent` (`:3-12`) + `formatNumber` (`:27-30`) — both return `"—"` for `null`/non-finite
**Apply to:** every value rendered in `StressVarSection.tsx`
Wrap EVERY metric value through `formatPercent`/`formatNumber`. `formatPercent` renders a signed value (`+`/`-`) — correct for the signed-return VaR convention (Pitfall 6: VaR = signed return quantile, negative in the tail; CVaR more negative; never flip the sign).

### Disclosure line single-source
**Source:** `src/lib/scenario-history.ts` `methodologyLine(n)` (`:41-43`)
**Apply to:** the VaR/CVaR caption (and the shock caption) in `StressVarSection.tsx`
Build on `methodologyLine(n)`, append the confidence level — exactly as `ScenarioBenchmarkSection.tsx:161` appends "Metrics are 252-day annualized active returns." Each caption names ITS OWN N (two-N trap).

### Leverage is already baked in — do NOT re-apply (Pitfall 3)
**Source:** `src/lib/scenario.ts:248-254` (`r += w * lev(s.id) * strategyReturns[s.id][i]`) — `portfolio_daily_returns` is the LEVERED series
**Apply to:** the VaR/CVaR path in `scenario-stress.ts`
Compute VaR/CVaR directly on `portfolioDaily.value[]` with NO leverage multiplier. The 2×-leverage-doubles-VaR test PROVES it is automatic. The engine emits `portfolio_daily_returns: []` for `n<10`/constant/non-finite (`scenario.ts:172,210-225,327`) — `length===0` short-circuits to the scenario-side empty state before any VaR runs.

---

## No Analog Found

None. Every new file has an exact sibling analog already shipped in the codebase (the `scenario-benchmark` / `sample-floor` family from Phases 22 + 24). This phase is pure assembly — no novel structural pattern is introduced.

---

## Metadata

**Analog search scope:**
- `src/app/(dashboard)/allocations/lib/` (scenario-benchmark.ts + its test)
- `src/app/(dashboard)/allocations/components/` (ScenarioBenchmarkSection + ScenarioComposer mount seam)
- `src/app/(dashboard)/allocations/widgets/risk/` (VarExpectedShortfall — the anti-pattern)
- `src/lib/` (portfolio-stats, sample-floor, scenario-history, scenario, utils)
- `src/components/scenarios/` (SampleFloorEmptyState + test)
- `src/components/strategy-v2/` (SegmentedControl)
- `src/components/ui/` (EmptyStateCard, Card)

**Files scanned:** 13 (all read directly this session; line numbers verified)
**Pattern extraction date:** 2026-06-22
