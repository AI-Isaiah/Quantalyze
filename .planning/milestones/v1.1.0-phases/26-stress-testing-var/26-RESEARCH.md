# Phase 26: Stress Testing & VaR - Research

**Researched:** 2026-06-22
**Domain:** Client-side TypeScript financial math (historical VaR / CVaR + β-propagated single-factor shock) over the frozen `computeScenario` engine — no migration, no Python, no new server surface, no new dependency.
**Confidence:** HIGH (every load-bearing claim is verified directly against the named source file in this repo; the math definitions are standard and cross-checked against the codebase's existing `computeVaR`/`computeAlphaBeta` implementations)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Shock model (STRESS-01)**
- Single factor = **BTC**, reusing the Phase-24 public BTC daily-returns series (`GET /api/benchmark/btc`, already fetched into the composer's `btcDaily` state; `btcAvailable=false` on fetch failure → honest unavailable).
- **β-propagated, linear, historical.** Each strategy's data-derived β to BTC is `cov(r_i, r_btc)/var(r_btc)` over the **inner-joined overlap window** (reuse `computeAlphaBeta` / the `computeScenarioBenchmark` machinery — do NOT re-derive cov/var, do NOT zero-fill non-overlapping dates). Projected portfolio impact of a factor shock `s` = `Σ wᵢ·Lᵢ·βᵢ·s` (equivalently `β_portfolio·s`, since β aggregates linearly and `β_portfolio` is computed on the already-leveraged `portfolio_daily_returns`). A near-market-neutral book → `β_portfolio ≈ 0` → near-zero hit (the load-bearing success-criterion behavior; pin it with a test).
- Show the **headline portfolio impact**; a **per-strategy β breakdown** is planner discretion (nice-to-have; the portfolio invariant is the must).
- **Shock parameterization:** small set of preset BTC-shock magnitudes (−10% / −20% / −30%) plus "BTC −30%" as default; custom magnitude input is planner discretion. Keep minimal + DESIGN.md-conformant.
- **Disclosed assumptions (inline, mandatory):** single-factor (BTC only), linear β propagation, historical β over N overlapping days, point-in-time (no regime change / no correlation breakdown under stress). End with "not a forecast".

**Area 2 — Downside measure: historical VaR + CVaR/ES (STRESS-02)**
- **Historical / empirical, NOT parametric (no Normal-tail assumption).** VaR = empirical quantile of `portfolio_daily_returns` (already-leveraged) at the confidence level; **CVaR/ES** = mean of returns in the tail at/beyond the VaR quantile. Explicit + consistent loss-sign convention + quantile-interpolation method.
- **Confidence level: 95% headline** (disclosed inline). 99% level is planner discretion. Never a bare VaR.
- **Disclosure (mandatory, inline):** method ("Historical / empirical"), window (`{N} overlapping days` via `methodologyLine(n)`), confidence level ("95%"), and N — plus "not a forecast". Reuse `ScenarioBenchmarkSection` methodology-line pattern verbatim.
- **Leverage scaling (load-bearing):** VaR/ES/drawdown derived from `portfolio_daily_returns` (bakes leverage via `w·L·r`) → scale automatically. Pin: doubling uniform leverage ~doubles VaR/ES (monotone, not invariant); contrast with leverage-invariant Sharpe.

**Area 3 — Floor gating + honesty (STRESS-02 / cross-cutting)**
- Gate every tail estimate on the **Phase-22 SoT**: `evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS=60)` where `n` is the overlap N used for the estimate. Below floor → `SampleFloorEmptyState` with a stress/VaR `feature` label; `no-usable-n` → `noUsableSampleBody`; 0/1-strategy → `fewStrategiesBody`. Do NOT introduce a second floor primitive (guard order: no-usable-n FIRST, then below-floor, then ok).
- **Degenerate input → em-dash "—", never a fabricated 0.** Constant/`n<10` series (engine returns null KPIs + empty `portfolio_daily_returns`) → honest absence. Empty-state heading must match its body (the #509 invariant).
- Failed/empty BTC fetch → shock section degrades to honest "stress unavailable" empty state (mirror `benchmarkAvailable=false`), never fabricated impact.

**Area 4 — UI placement**
- New **"Stress & VaR"** section in the own-book `ScenarioComposer`, **after `ScenarioBenchmarkSection`**, as a presentational section fed engine-resolved props (`portfolioDaily`, `btcDaily`, `btcAvailable`, `n`, leverage-aware metrics) — mirror `ScenarioBenchmarkSection`'s props-only, unit-testable shape (extract math into a pure lib).
- **Own-book composer ONLY for v1.** Sandbox stress/VaR deferred.
- Return/percentage form; PROJECTED framing intact; conform to DESIGN.md + reuse existing primitives.

### Claude's Discretion
- Exact quantile-interpolation method; whether to show 99% alongside 95%; the per-strategy β breakdown; the precise shock-control affordance (presets vs custom input); the section's exact layout within the DESIGN.md grid. All deferred to the planner within the locked invariants above.

### Deferred Ideas (OUT OF SCOPE)
- Monte-Carlo forward bands (Phase 27), optimizer (Phase 28).
- Multi-factor / regime-switching shock; parametric (Normal) VaR; correlation-breakdown-under-stress modeling.
- Sandbox (example-universe) stress/VaR; per-strategy β breakdown (if not built); 99% confidence level (if not built).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STRESS-01 | Allocator can apply a parameterized market shock (e.g. "BTC −30%") propagated through each strategy's data-derived β to the shocked factor, and see the projected impact | β-propagated shock model pinned to `β_portfolio·s` over the BTC inner-join overlap, reusing `computeAlphaBeta` (§Architecture Patterns Pattern 2, §Code Examples). Near-market-neutral invariant + leverage-scaling tests in §Validation Architecture. BTC factor series + `btcAvailable` degrade path already wired in `ScenarioComposer`. |
| STRESS-02 | Allocator sees a downside risk measure — historical VaR + CVaR/Expected Shortfall — with method, window, and confidence level disclosed | Historical/empirical VaR + CVaR definition pinned with a hand-computable golden oracle (§resolve item 1, §Code Examples). Mandatory inline disclosure via `methodologyLine(n)` extended with confidence level (§UI contract). Floor gate + degeneracy matrix in §Validation Architecture. Leverage-scaling contrast in §Validation Architecture. |
</phase_requirements>

---

## Summary

Phase 26 adds a "Stress & VaR" section to the own-book `ScenarioComposer`. It is **pure client-side TypeScript math** over the **already-computed, already-leveraged** `portfolio_daily_returns` series produced by the frozen `computeScenario` engine, plus the public BTC daily-returns series already fetched into the composer. There is **no migration, no Python, no new route, no new dependency, no auth surface**. The entire risk class for this phase is **honesty/correctness**: a fabricated number, leverage mis-scaling, a union-instead-of-intersection alignment, a parametric-instead-of-historical VaR, or a floor bypass. Each of those is mitigated by a single falsifiable unit test — the threat model is a test matrix, not an attack surface.

The codebase already contains the exact building blocks. **`computeAlphaBeta(returns, benchmark)` in `@/lib/portfolio-stats`** computes `beta = cov/var` and is the golden-tested machinery to reuse for β-propagation (do NOT re-derive). **`innerJoinByDate` + `computeScenarioBenchmark` in `allocations/lib/scenario-benchmark.ts`** are the canonical intersection-alignment + relative-scale-degeneracy-guard pattern; the new stress lib should be a sibling that follows the same shape. **`evaluateSampleFloor(n, 60)` + `SampleFloorEmptyState` in `@/lib/sample-floor`** are the Phase-22 single-source floor (do NOT introduce a second primitive). **`methodologyLine(n)` in `@/lib/scenario-history`** is the mandatory disclosure builder. **`ScenarioBenchmarkSection.tsx`** is the verbatim template for the new `StressVarSection` — copy its props-only shape, its guard-order empty-state routing, its `MetricRow` shape, and its formatter-on-every-value discipline.

**A critical pre-existing-code finding:** `@/lib/portfolio-stats` ALREADY exports `computeVaR(returns, confidence)` and `computeExpectedShortfall(returns, confidence)`, used today by the (non-scenario) `VarExpectedShortfall.tsx` dashboard widget. Their quantile method, loss-sign convention, and degeneracy behavior are documented below and must be reconciled deliberately — they return a **fabricated 0 on empty input** (not null) and the consuming widget paints losses **red** and shows a fabricated 0 "Insufficient data" zero-state, both of which **violate this phase's honesty contract**. The planner must decide whether to reuse `computeVaR`/`computeExpectedShortfall` directly (and add a null-on-degenerate wrapper) or fork a scenario-specific variant. The recommendation below is to **wrap, not fork**: reuse the floor-tested arithmetic but gate it through the same relative-scale/null-on-degenerate discipline `computeScenarioBenchmark` already established.

**Primary recommendation:** Build one pure lib `src/app/(dashboard)/allocations/lib/scenario-stress.ts` exporting a single null-safe `computeScenarioStress(portfolioDaily, btcDaily, { confidence: 0.95, shock: -0.30 })` that returns `{ n, beta, projectedImpact, var: , cvar:  }` with every field `null` on degeneracy, plus a presentational `StressVarSection` mounted after `ScenarioBenchmarkSection`. Pin the math with a hand-computed golden VaR/CVaR oracle, a near-market-neutral β≈0 invariant test, a 2×-leverage-doubles-VaR-but-not-Sharpe contrast test, and the full degeneracy/floor null-safety matrix.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Historical VaR / CVaR computation | Browser / Client (pure TS lib) | — | Operates on `portfolio_daily_returns` already resolved client-side by `computeScenario`; no server round-trip, no persistence. Exactly mirrors `scenario-benchmark.ts`. |
| β-propagated BTC shock | Browser / Client (pure TS lib) | API (read-only, BTC series only) | β math is client-side over the BTC series the composer already fetched; the only server touch is the *already-shipped* public `GET /api/benchmark/btc` (Phase 24) — Phase 26 adds zero new server code. |
| BTC factor series fetch | API / Backend (existing) | CDN / Static (cached) | `GET /api/benchmark/btc` is public-cacheable shared market data shipped in Phase 24 (`Cache-Control: public s-maxage=3600 SWR`); reused as-is, no change. |
| Floor gating + honest empty states | Browser / Client (pure lib + presentational) | — | `evaluateSampleFloor` is pure TS; `SampleFloorEmptyState` is a presentational React component. No tier crossing. |
| Disclosure / methodology line | Browser / Client (presentational) | — | `methodologyLine(n)` is a pure string builder; rendered in the section. |

**No server/database/persistence tier is touched by Phase 26.** The stress/VaR result is ephemeral exploration state (consistent with leverage being ephemeral, never persisted — see `ScenarioComposer` `leverageByRef` comment "Ephemeral exploration … not recorded when you commit this scenario").

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | — | This phase adds **zero dependencies** (locked in CONTEXT "no new … dependency"). Everything is in-repo TypeScript. |

### Supporting (in-repo modules to reuse — these ARE the stack)
| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `computeAlphaBeta` | `src/lib/portfolio-stats.ts` | `beta = cov(r,b)/var(b)`; golden-tested | β-propagation: feed the BTC inner-join aligned arrays. Do NOT re-derive cov/var. `[VERIFIED: repo grep src/lib/portfolio-stats.ts:412]` |
| `computeVaR` / `computeExpectedShortfall` | `src/lib/portfolio-stats.ts` | Empirical quantile VaR + tail-mean CVaR | The arithmetic core. **Wrap with a null-on-degenerate guard** (they return 0, not null, on empty/degenerate — see Pitfall 1). `[VERIFIED: repo grep src/lib/portfolio-stats.ts:142,160]` |
| `innerJoinByDate` | `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` | Intersection alignment of two dated series (no zero-fill) | β needs the BTC overlap window — reuse this, never a positional zip or union. `[VERIFIED: repo grep scenario-benchmark.ts:63]` |
| `computeScenarioBenchmark` | `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` | β + relative-scale degeneracy guard over BTC overlap | The β you need for the shock is `m.beta` from this exact function — reuse it directly (it already null-guards constant-benchmark). `[VERIFIED: repo grep scenario-benchmark.ts:97]` |
| `evaluateSampleFloor` | `src/lib/sample-floor.ts` | The Phase-22 floor gate (`SAMPLE_FLOOR_OVERLAPPING_DAYS=60`) | Gate EVERY tail/shock estimate. Never re-declare 60. `[VERIFIED: repo grep sample-floor.ts:37,70]` |
| `SampleFloorEmptyState` | `src/components/scenarios/SampleFloorEmptyState.tsx` | Below-floor honest empty state | Render below-floor; pass `feature` + `strategyCount`. `[VERIFIED: repo read]` |
| `methodologyLine` | `src/lib/scenario-history.ts` | `"Historical realized · {n} overlapping days · not a forecast."` | Base of the mandatory disclosure line; extend with confidence level. `[VERIFIED: repo grep scenario-history.ts:41]` |
| `formatPercent` / `formatNumber` | `src/lib/utils.ts` | Render "—" for null/non-finite | Wrap every value so degenerate → em-dash. `[VERIFIED: repo grep src/lib/utils.ts:3,27]` |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx` | Neutral honest-absence card | Scenario-side + BTC-unavailable empty states. `[VERIFIED: repo grep]` |
| `SegmentedControl` | `src/components/strategy-v2/SegmentedControl.tsx` | Shock-preset affordance | The shock control (per UI-SPEC, locked). `[CITED: 26-UI-SPEC.md]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reuse `computeVaR`/`computeExpectedShortfall` + null wrapper | Fork a `scenarioVaR`/`scenarioCVaR` in the new lib | Forking duplicates the M-0541 clamp + tail logic and risks drift; the existing functions are floor-tested. **Recommendation: wrap, not fork** — keep the arithmetic, add only the null-on-degenerate + floor gating in the new lib. |
| Empirical (historical) VaR | Parametric (Normal) VaR | **OUT OF SCOPE** — CONTEXT explicitly forbids parametric. A Normal-tail VaR would understate fat-tailed crypto downside. |
| `β_portfolio · s` (single aggregate β) | `Σ wᵢ·Lᵢ·βᵢ·s` (per-strategy β sum) | Mathematically identical because β aggregates linearly and `β_portfolio` is computed on the already-leveraged `portfolio_daily_returns`. **Use `β_portfolio · s`** (simpler, one `computeScenarioBenchmark` call); the per-strategy breakdown is discretion and, if built, must use the same machinery per strategy. |

**Installation:** None — no packages installed. (The Package Legitimacy Audit below is therefore N/A.)

---

## Package Legitimacy Audit

**Not applicable.** Phase 26 installs **zero external packages** (CONTEXT locks "no new … dependency"; the entire phase is in-repo TypeScript reusing existing modules). No registry verification, no slopcheck, no postinstall-script audit is required because nothing is added to `package.json`. If the planner discovers a need for any package, that is a scope violation and must be escalated, not silently added.

---

## Architecture Patterns

### System Architecture Diagram

```
                        ScenarioComposer (own-book, existing 2032-line component)
                                          │
        ┌─────────────────────────────────┼──────────────────────────────────┐
        │                                 │                                    │
 scenarioMetrics                     btcDaily / btcAvailable            strategyCount
 = computeScenario(...)              (fetched from GET /api/benchmark/btc)  (active set size)
        │                                 │                                    │
 .portfolio_daily_returns ───┐           │                                    │
   (already-leveraged,        │           │                                    │
    cumulative-return-per-day, │          │                                    │
    UNROUNDED, [] on degenerate)│         │                                    │
        │                      ▼          ▼                                    ▼
        │            ┌──────────────────────────────────────────────────────────────┐
        │            │  NEW pure lib: scenario-stress.ts                              │
        │            │  computeScenarioStress(portfolioDaily, btcDaily, opts)         │
        │            │                                                                │
        ├───────────►│  (A) VaR/CVaR path: empirical quantile + tail-mean over        │
        │            │      portfolioDaily.value[] (leverage already baked in)         │
        │            │      → wrap computeVaR / computeExpectedShortfall + null guard   │
        │            │                                                                │
        └───────────►│  (B) β-shock path: innerJoinByDate(portfolioDaily, btcDaily)    │
                     │      → computeScenarioBenchmark(...).beta = β_portfolio          │
                     │      → projectedImpact = β_portfolio · shock                     │
                     │                                                                │
                     │  Every field null on degeneracy (relative-scale guard).        │
                     │  Returns { n, beta, projectedImpact, var, cvar }               │
                     └──────────────────────────────────┬───────────────────────────┘
                                                         │
                                                         ▼
                     ┌──────────────────────────────────────────────────────────────┐
                     │  NEW presentational: StressVarSection (props-only)             │
                     │  guard order (mirrors ScenarioBenchmarkSection #509):          │
                     │   1. portfolioDaily.length===0 → scenario-side EmptyStateCard   │
                     │   2. !btcAvailable             → BTC-unavailable EmptyStateCard  │
                     │   3. !evaluateSampleFloor(n,60).ok → SampleFloorEmptyState       │
                     │   4. ok → SegmentedControl + headline impact + VaR/CVaR rows    │
                     │          + methodologyLine(n) + "95%" + "not a forecast"        │
                     │  every value via formatPercent/formatNumber → "—" on null       │
                     └──────────────────────────────────────────────────────────────┘
                                                         │
                                                         ▼
                          Mounted in ScenarioComposer AFTER ScenarioBenchmarkSection
                          (Card className="mt-6", at ScenarioComposer.tsx:1580–1581 seam)
```

### Recommended Project Structure
```
src/app/(dashboard)/allocations/
├── lib/
│   ├── scenario-benchmark.ts        # EXISTING — the template + the β source (reuse)
│   ├── scenario-benchmark.test.ts   # EXISTING — golden/intersection/null-safety test template
│   ├── scenario-stress.ts           # NEW — pure stress/VaR math (computeScenarioStress)
│   └── scenario-stress.test.ts      # NEW — golden VaR/CVaR + β-neutral + leverage + null matrix
└── components/
    ├── ScenarioBenchmarkSection.tsx       # EXISTING — verbatim template for the new section
    ├── ScenarioBenchmarkSection.test.tsx  # EXISTING — section test template (states, em-dash)
    ├── StressVarSection.tsx               # NEW — presentational, props-only
    └── StressVarSection.test.tsx          # NEW — state matrix + em-dash + disclosure tests
```

**Note on lib placement (resolving CONTEXT discretion):** Put the lib at `src/app/(dashboard)/allocations/lib/scenario-stress.ts`, NOT `src/lib/scenario-stress.ts`. Rationale: it is a sibling of `scenario-benchmark.ts` (same `allocations/lib/` home), consumes the BTC-overlap machinery that lives there, and is scoped to the allocations composer surface. `src/lib/sample-floor.ts` and `src/lib/portfolio-stats.ts` stay where they are (cross-surface primitives). `[VERIFIED: repo grep — scenario-benchmark.ts lives at allocations/lib/]`

### Pattern 1: Props-only presentational section over a pure lib (the #509 honesty pattern)
**What:** Extract ALL math into a pure, side-effect-free lib that returns a fully null-safe result object; the React section is purely presentational over resolved props, so honesty/leverage/floor are unit-testable without mounting the 2032-line composer.
**When to use:** Always for this phase — it is the locked Area-4 decision and the established `ScenarioBenchmarkSection` pattern.
**Example:**
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx (template to mirror)
// Guard order is non-negotiable (#509): scenario-side absence FIRST, then BTC, then floor.
if (portfolioDaily.length === 0) {
  return <EmptyStateCard heading={EMPTY_HEADING} body={NO_SCENARIO_RETURNS_BODY} />;
}
if (!benchmarkAvailable || n === 0) {
  return <EmptyStateCard heading={EMPTY_HEADING} body={NO_OVERLAP_BODY} />;
}
if (!verdict.ok) {
  return <EmptyStateCard heading={EMPTY_HEADING} body={belowFloorBody(n)} />;
}
// ok path — every value through a formatter so null → "—"
```

### Pattern 2: Reuse the β source — never re-derive cov/var
**What:** The β you need for the shock is exactly `computeScenarioBenchmark(portfolioDaily, btcDaily).beta`. It already inner-joins, computes `cov/var` via the golden-tested `computeAlphaBeta`, and null-guards the constant-benchmark degeneracy via the relative-scale test.
**When to use:** The β-shock path.
**Example:**
```typescript
// Source: src/app/(dashboard)/allocations/lib/scenario-benchmark.ts:147 (the call you reuse)
const ab = computeAlphaBeta(p, b); // beta = cov/var over the inner-join arrays p,b
// β_portfolio is null when the BTC overlap is degenerate (constant b, or n<2).
// projectedImpact = β_portfolio * shock; null β ⇒ null impact ⇒ "—" (never a fabricated 0).
```

### Pattern 3: Relative-scale degeneracy guard (NOT exact `=== 0`)
**What:** A numerically-constant series leaves a float-residue variance (~1e-37), which sails past an exact `var === 0` check and fabricates a meaningless finite number. The codebase guards by relative scale: `Math.sqrt(varB) <= 1e-12 * (Math.abs(meanB) + 1e-12)`.
**When to use:** Any degeneracy check in the new lib (a constant `portfolio_daily_returns` for VaR; a constant BTC for β).
**Example:**
```typescript
// Source: src/app/(dashboard)/allocations/lib/scenario-benchmark.ts:139
const benchmarkIsDegenerate = Math.sqrt(varB) <= 1e-12 * (Math.abs(meanB) + 1e-12);
// For VaR, the constant-series case is ALSO handled upstream: computeScenario already
// returns portfolio_daily_returns=[] for n<10 / constant / non-finite, so length===0
// short-circuits to the scenario-side empty state before any VaR is computed.
```

### Anti-Patterns to Avoid
- **Painting losses red (`#DC2626`):** the existing `VarExpectedShortfall.tsx` widget colors VaR/CVaR red. UI-SPEC §Color forbids this for the new section — a loss is honest data, not an error. Numbers are monochrome (`text-text-secondary`, Geist Mono). `[CITED: 26-UI-SPEC.md §Color]`
- **Fabricating a 0 zero-state:** `VarExpectedShortfall.tsx` returns `{var95:0, var99:0, es95:0}` for `< 10` returns and renders an "Insufficient data" branch keyed on `=== 0`. The new section must render the floor/scenario empty states and em-dashes instead — never a 0 that could be mistaken for "no risk".
- **Union/positional alignment for β:** the BTC overlap MUST be the inner-join intersection (a non-overlapping date is an absence, not a 0% return). Use `innerJoinByDate`, never `computeScenario`'s zero-filled union axis.
- **A second floor primitive:** never re-declare `60` or invent a stress-specific floor. Import `SAMPLE_FLOOR_OVERLAPPING_DAYS`.
- **Re-deriving cov/var/quantile:** reuse `computeAlphaBeta` and `computeVaR`/`computeExpectedShortfall`; only add the null-on-degenerate envelope.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Empirical quantile VaR | A new sort+index function | `computeVaR(returns, confidence)` | Already has the M-0541 both-bounds index clamp (confidence=0/1 no longer poisons with `undefined`). |
| Tail-mean CVaR | A new `filter(<=var).mean()` | `computeExpectedShortfall(returns, confidence)` | Already handles empty-tail fallback (`tail.length===0 → var_`). |
| β = cov/var | A new covariance loop | `computeAlphaBeta(p, b)` (via `computeScenarioBenchmark`) | Golden-tested; aggregates linearly; reused by the benchmark section. |
| Two-series date alignment | A positional zip / union zero-fill | `innerJoinByDate(port, bench)` | Intersection-only, no zero-fill — the load-bearing honesty step. |
| Minimum-sample gate | A `if (n < 60)` inline | `evaluateSampleFloor(n, 60)` | Single source of truth; guard-first (null/NaN/Inf/negative → no-usable-n). |
| Constant-series degeneracy detection | `var === 0` | relative-scale guard `sqrt(var) <= 1e-12*(|mean|+1e-12)` | Exact-zero misses float residue and fabricates finite garbage. |
| "—" rendering | Manual null checks in JSX | `formatPercent` / `formatNumber` | Both return "—" for null/non-finite; single discipline. |
| Disclosure copy | A hand-written caption | `methodologyLine(n)` extended | Single-sourced so the two surfaces can't drift. |

**Key insight:** Phase 26 is almost entirely an *assembly* of golden-tested primitives. The only genuinely new arithmetic is the trivial `projectedImpact = beta * shock` multiply and the null-on-degenerate envelope. The risk is not in the math complexity (it is low) but in the *honesty wiring* — getting the guard order, the floor `n`, the inner-join, and the em-dash discipline right so the section never lies.

---

## Runtime State Inventory

> Phase 26 is NOT a rename/refactor/migration phase. It is greenfield additive client-side code. This section is included only to record that the inventory was considered and is empty.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — VaR/shock are ephemeral exploration state, never persisted (consistent with `leverageByRef` being ephemeral; verified by `ScenarioComposer` comment "not recorded when you commit this scenario"). No new column, no `scenarios` field. | none |
| Live service config | **None** — no external service, no UI/DB-only config. | none |
| OS-registered state | **None** — no scheduled task, no process. | none |
| Secrets/env vars | **None** — no secret read; the BTC route is public-cacheable shared market data with no auth. | none |
| Build artifacts | **None** — no package install, no compiled artifact, no egg-info. | none |

---

## Common Pitfalls

### Pitfall 1: The pre-existing `computeVaR`/`computeExpectedShortfall` return 0 (not null) on degenerate input
**What goes wrong:** `computeVaR([], c)` returns `0`; `computeExpectedShortfall` then returns `var_`(=0). The consuming `VarExpectedShortfall.tsx` widget treats `0` as "Insufficient data" — but a real all-flat strategy could legitimately have a near-0 VaR, so a bare 0 is ambiguous and, in this section's honesty contract, a fabricated number.
**Why it happens:** Those functions were written for a different surface (the dashboard widget) with a `< 10` length guard at the call site and a red zero-state.
**How to avoid:** In `computeScenarioStress`, **short-circuit to null BEFORE calling them**: if `portfolioDaily.length === 0` (the engine already emits `[]` for `n<10`/constant/non-finite) OR the floor gate fails, return `{ var: null, cvar: null, ... }`. Only call `computeVaR`/`computeExpectedShortfall` on a floor-passing, non-empty series. Additionally guard the constant-series case with the relative-scale test (Pattern 3) so a `n≥60` but numerically-constant window also surfaces null. Wrap, don't fork.
**Warning signs:** A VaR of exactly `0.00000` rendering as "0.00%" instead of "—" for a degenerate scenario.

### Pitfall 2: The VaR `n` and the β-shock `n` are DIFFERENT overlap counts
**What goes wrong:** VaR/CVaR are computed over `portfolio_daily_returns` ALONE — its `n` is `scenarioMetrics.n` (the scenario's own union-axis overlap, the same `n` the methodology line and benchmark heading already report for the scenario). The β-shock is computed over the **BTC inner-join intersection** — its `n` can be *strictly smaller* (the BTC series may not cover the full scenario window). Gating both on the same `n` would either over-gate the VaR (using the smaller BTC-overlap n) or under-gate the shock (using the larger scenario n on a thin BTC overlap).
**Why it happens:** Two different statistics over two different windows that happen to share a section.
**How to avoid:** Treat them as two floor checks. The VaR/CVaR rows gate on `evaluateSampleFloor(scenarioMetrics.n, 60)`. The β-shock gates on `evaluateSampleFloor(innerJoinByDate(portfolioDaily, btcDaily).p.length, 60)`. The disclosure line for each must report ITS OWN n (the VaR line's `{N}` is the scenario overlap; the shock line's `{N}` is the BTC overlap). **Recommendation (resolving the ambiguity for the planner):** if the section shows a single shared heading "over {N} overlapping days", use the BTC-overlap N for the shock disclosure and the scenario N for the VaR disclosure, OR render two methodology captions. The simplest honest design is **two captions** — one under the shock row, one under the VaR/CVaR rows — each naming its true N. Do NOT collapse to one N if they differ. `[VERIFIED: scenario.ts computes n over the UNION commonDates; scenario-benchmark.ts computes n over the inner-join intersection]`

### Pitfall 3: Leverage is baked into `portfolio_daily_returns` — do NOT re-apply it
**What goes wrong:** Multiplying VaR by leverage again, or scaling the BTC series, double-counts leverage.
**Why it happens:** `computeScenario` already applies `w·L·r` at line 251, so `portfolio_daily_returns` is the *levered* series. VaR/ES/drawdown over it scale automatically.
**How to avoid:** Compute VaR/CVaR directly on `portfolioDaily.value[]` with NO leverage multiplier. The leverage-scaling test (below) PROVES this is automatic, not manual.
**Warning signs:** A 2× leverage producing a ~4× VaR (double-applied) instead of ~2×.

### Pitfall 4: Compounding makes leverage scaling *approximately*, not *exactly*, linear
**What goes wrong:** A test that asserts `var(2×L) === 2 * var(1×L)` exactly will fail.
**Why it happens:** `portfolio_daily_returns` is per-day arithmetic return scaled by L in the engine, so the *per-day* return scales exactly linearly with L, and since historical VaR is a quantile of those per-day returns, **VaR/CVaR DO scale exactly ~linearly with uniform leverage at the daily level** (the quantile of `2r` is `2×` the quantile of `r`). The non-linearity caveat applies to *cumulative* / *drawdown* measures, where `∏(1+L·rᵢ)` is not `∏(1+rᵢ)^L`. Max-drawdown therefore scales monotonically but NOT exactly linearly.
**How to avoid:** Assert VaR/CVaR scale within a tight tolerance (they are quantiles of the linearly-scaled daily series → effectively exact, `toBeCloseTo(2×, 8)`); assert max-drawdown scales **monotonically** (`ddAt2x < ddAt1x`, more negative) but use a looser/monotone assertion, not an exact 2×. Disclose the compounding caveat in the leverage caption (the existing `scenario-leverage-caveat` already says "excludes borrow / funding cost" — reuse that framing).
**Warning signs:** A flaky exact-equality leverage test.

### Pitfall 5: Heading-matches-body (#509) — never blame BTC for a scenario-side absence
**What goes wrong:** A degenerate scenario (no returns) rendering "BTC unavailable" copy, or vice-versa.
**Why it happens:** Wrong guard order.
**How to avoid:** Guard order is FIXED (mirrors `ScenarioBenchmarkSection`): (1) `portfolioDaily.length===0` → scenario-side body; (2) `!btcAvailable` → BTC-unavailable body; (3) floor fail → `SampleFloorEmptyState`; (4) ok. Each empty state's heading and body must both describe the same true cause. UI-SPEC §States pins this exact order and copy. `[CITED: 26-UI-SPEC.md §States, §Copywriting]`

### Pitfall 6: Loss-sign convention drift
**What goes wrong:** Reporting VaR as a positive "loss magnitude" in some places and a negative "return" in others.
**Why it happens:** VaR has two common conventions: VaR-as-loss (positive number) or VaR-as-return-quantile (negative number).
**How to avoid:** The codebase convention is **VaR = the signed return quantile (a negative number for a downside tail)**. `computeVaR` returns `sorted[idx]` — the raw (signed) return at the quantile, so a 95% VaR is the ~5th-percentile daily return (negative). CVaR is the mean of returns ≤ VaR (more negative). Render both with `formatPercent` (which prints the sign), label them "Value at Risk (95%)" / "Expected Shortfall (CVaR, 95%)", and never flip the sign. The projected shock impact is also a signed return (`β·s`, negative for a `−30%` shock on a positive-β book). `[VERIFIED: src/lib/portfolio-stats.ts:153 returns sorted[idx]; existing tests at portfolio-stats.test.ts:149-153 confirm an all-positive series yields a positive VaR — i.e. signed-return convention]`

---

## Code Examples

### Empirical VaR + CVaR — the exact pre-existing definition (the oracle to pin)
```typescript
// Source: src/lib/portfolio-stats.ts:142-168 (VERIFIED — this is the live code)

export function computeVaR(returns: number[], confidence: number): number {
  if (returns.length === 0) return 0;            // ← Pitfall 1: returns 0, NOT null
  const sorted = [...returns].sort((a, b) => a - b);   // ascending
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((1 - confidence) * sorted.length)),  // LOWER/floor interpolation
  );
  return sorted[idx];                             // signed return quantile (negative in the tail)
}

export function computeExpectedShortfall(returns: number[], confidence: number): number {
  const var_ = computeVaR(returns, confidence);
  const tail = returns.filter((r) => r <= var_);  // at/beyond the VaR quantile (inclusive ≤)
  if (tail.length === 0) return var_;
  return mean(tail);                              // mean of the tail (more negative than VaR)
}
```

**Quantile method pinned (resolving CONTEXT discretion):**
- **Sort ascending**, pick index `idx = floor((1 - confidence) * n)` clamped to `[0, n-1]`. This is the **lower / floor (type-1 / inverse-CDF) empirical quantile** — NO linear interpolation between order statistics. (This matters: a linear-interpolation quantile would give a different golden value.) **Use the existing floor method** — it is already tested and matches the dashboard widget, so the two VaR surfaces stay consistent.
- **Loss-sign:** VaR is the signed return at that index (negative for a real downside tail). CVaR is the arithmetic mean of all returns `≤ VaR` (inclusive). CVaR ≤ VaR always.

### Hand-computable golden oracle (the test the plan must pin)
A 20-value daily-return series, VaR/CVaR at 95%:
```typescript
// 20 values, sorted ascending shown for clarity:
// [-0.080, -0.060, -0.045, -0.030, -0.025, -0.020, -0.015, -0.010, -0.005, 0.000,
//   0.005,  0.010,  0.012,  0.015,  0.018,  0.020,  0.025,  0.030,  0.040,  0.060]
// n = 20, confidence = 0.95
// idx = floor((1 - 0.95) * 20) = floor(0.05 * 20) = floor(1.0) = 1
// VaR(95%)  = sorted[1] = -0.060   (the 2nd-worst day, signed-return convention)
// tail      = { r <= -0.060 } = [-0.080, -0.060]
// CVaR(95%) = mean([-0.080, -0.060]) = -0.070
//
// Assertions:
//   expect(var95).toBeCloseTo(-0.060, 10);
//   expect(cvar95).toBeCloseTo(-0.070, 10);
//   expect(cvar95).toBeLessThanOrEqual(var95);   // CVaR at least as extreme
```
This is the falsifiable VaR/CVaR oracle — a parametric (Normal) implementation or a linear-interpolation quantile would NOT produce `-0.060` / `-0.070` and the test would fail loud.

### β-propagated shock — the model + the near-market-neutral invariant
```typescript
// Source pattern: scenario-benchmark.ts (reused) + scenario-stress.ts (new, trivial multiply)
const m = computeScenarioBenchmark(portfolioDaily, btcDaily); // m.beta = β_portfolio (cov/var)
const shock = -0.30;                                          // "BTC −30%" default
const projectedImpact = m.beta === null ? null : m.beta * shock;

// Near-market-neutral invariant (the load-bearing success criterion):
//   If the book is engineered so cov(portfolio, btc) ≈ 0 (e.g. portfolio returns
//   orthogonal to BTC), then m.beta ≈ 0, so projectedImpact ≈ 0 — NOT the full −30%.
//   Construct a portfolioDaily that is uncorrelated with btcDaily over the overlap
//   and assert |projectedImpact| < small_epsilon. Falsifiable: a "shock applied at
//   face value" bug (impact = shock) makes |impact| ≈ 0.30 and the test fails.
```

### Mount seam (verbatim insertion point)
```tsx
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1574-1580
// Insert the NEW section immediately AFTER this <Card> (the established seam).
<Card className="mt-6">
  <ScenarioBenchmarkSection
    portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
    btcDaily={btcDaily}
    benchmarkAvailable={btcAvailable}
  />
</Card>
{/* NEW — Phase 26: */}
<Card className="mt-6">
  <StressVarSection
    portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}
    btcDaily={btcDaily}
    btcAvailable={btcAvailable}
    n={scenarioMetrics.n}
    strategyCount={/* active-strategy count already in composer scope */}
  />
</Card>
```
The composer ALREADY holds every prop the new section needs (`scenarioMetrics`, `btcDaily`, `btcAvailable`, `scenarioMetrics.n`, and the active-strategy count) — no new state, no new fetch, no new memo required beyond the section's own props wiring.

---

## State of the Art

| Old Approach (existing dashboard widget) | Current Approach (this phase) | When Changed | Impact |
|------------------------------------------|-------------------------------|--------------|--------|
| `VarExpectedShortfall.tsx` paints VaR/CVaR **red** (`#DC2626`) | Monochrome neutral numbers (`text-text-secondary`, Geist Mono) | Phase 26 (UI-SPEC §Color) | A loss is honest data, not an error. |
| Returns fabricated `0` on `< 10` returns + red zero-state | `null` → "—" em-dash + floor empty state | Phase 26 (honesty contract) | Never present a fabricated 0 as risk. |
| `< 10` length guard at the call site | `evaluateSampleFloor(n, 60)` Phase-22 SoT (60-day floor) | Phase 26 | A tail estimate on <60 overlapping days is false precision. |
| No methodology disclosure | Mandatory `methodologyLine(n)` + confidence + "not a forecast" | Phase 26 (STRESS-02) | Never a bare VaR. |

**Deprecated/outdated for this surface:**
- The dashboard `VarExpectedShortfall.tsx` widget's UX (red, fabricated 0, 99% shown, `< 10` floor) is the **anti-pattern**, not the template. Reuse its *arithmetic* (`computeVaR`/`computeExpectedShortfall`) but NOT its presentation or its degeneracy handling. Do not edit that widget (out of scope; surgical-changes rule).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The lower/floor (type-1) empirical quantile (`floor((1-c)*n)`, no interpolation) is the correct method to lock, matching the existing `computeVaR`. | Code Examples | LOW — it is the live, tested convention; locking a *different* interpolation would make the new VaR inconsistent with the dashboard widget. If the planner/user prefers a higher-fidelity interpolation (e.g. linear/`R-7`), the golden oracle value changes (`-0.060`→ interpolated) and consistency with the existing widget breaks. Flagged for confirmation only if the planner wants a non-floor quantile. |
| A2 | VaR is reported in the **signed-return** convention (negative for downside), not a positive loss-magnitude. | Pitfall 6 | LOW — verified against existing tests; but if the UI prefers "loss = positive 6.0%", the sign must be flipped consistently in the section (label + value), and the golden assertions adjust. |
| A3 | The 60-day floor (`SAMPLE_FLOOR_OVERLAPPING_DAYS`) is the correct gate for BOTH the VaR window (scenario n) and the β-shock window (BTC-overlap n). | Pitfall 2 | LOW — CONTEXT explicitly locks the Phase-22 floor as the SoT reused by 26; the only open design point is whether to use one shared N or two (resolved: two captions if they differ). |
| A4 | Recommend reusing (wrapping) `computeVaR`/`computeExpectedShortfall` rather than forking scenario-specific variants. | Standard Stack Alternatives | LOW-MEDIUM — a wrapper keeps one tested arithmetic source; a fork would duplicate the M-0541 clamp. If the planner forks, it must re-pin the clamp + tail-empty fallback, and a drift test should compare the two. |
| A5 | The shock control is `SegmentedControl` presets (−10/−20/−30, −30 default), per UI-SPEC. | User Constraints / UI | LOW — locked autonomously in UI-SPEC; custom-magnitude input is explicit planner discretion. |

**If this table is empty:** it is not — all five are LOW/LOW-MEDIUM risk and are design-confirmation points, not factual uncertainties. Every *factual* claim about the code is `[VERIFIED]` against the named file.

---

## Open Questions

1. **One shared overlap-N caption or two?**
   - What we know: VaR uses the scenario union-axis n (`scenarioMetrics.n`); the β-shock uses the BTC inner-join n (can be smaller).
   - What's unclear: whether the UI shows one heading "over {N}" or splits.
   - Recommendation: render **two methodology captions** when the two N differ (one under the shock row, one under the VaR/CVaR rows), each naming its true N. If they are equal (common when BTC covers the full window), a single caption is fine. The planner decides layout within DESIGN.md; the *invariant* is each number names its own honest N.

2. **Show 99% alongside 95%?**
   - What we know: 95% is the locked headline; 99% is planner discretion; the existing widget shows both.
   - Recommendation: ship 95% only for v1 (CONTEXT default, minimal control). If 99% is added, disclose it in the same line and add a "99% more extreme than 95%" monotonicity test (the existing widget already pins this relationship).

3. **Per-strategy β breakdown?**
   - What we know: discretion; the portfolio invariant is the must.
   - Recommendation: defer the breakdown unless cheap; if built, compute each strategy's β via the SAME `computeScenarioBenchmark(strategyDaily, btcDaily)` per strategy (reuse, don't re-derive) and prove a near-market-neutral strategy shows ≈0 in the breakdown too.

---

## Environment Availability

> Phase 26 has no external tool/service/runtime dependencies beyond the project's own TypeScript/Vitest stack and the already-shipped public BTC route. This section is included for completeness.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / TypeScript | All client code | ✓ (project) | per repo | — |
| Vitest + @testing-library/react | Tests | ✓ (project) | per repo | — |
| `GET /api/benchmark/btc` | β-shock factor series | ✓ (shipped Phase 24) | — | `btcAvailable=false` → honest "stress unavailable" empty state (already wired in composer) |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** the BTC route degrading to `200 []` → `btcAvailable=false` is the *designed* fallback (honest empty state), not a missing dependency.

---

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json` — this section is required. The phase is pure math, so nearly every requirement maps to a fast, automated, falsifiable unit test (< 1s each). This is the heart of the phase: the honesty/correctness threat class IS the test matrix.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (TS); `@testing-library/react` for the section component |
| Config file | `vitest.config.ts` (coverage gate: lines 82 / statements 80 / functions 74 / branches 72 — CLAUDE.md) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-stress.test.ts` |
| Full suite command | `npm run test` (and `npm run test:coverage` for the blocking gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STRESS-02 | Historical VaR(95%) matches the hand-computed floor-quantile oracle (`-0.060` for the 20-value series) | unit | `npx vitest run scenario-stress.test.ts -t "golden VaR"` | ❌ Wave 0 |
| STRESS-02 | CVaR(95%) = mean of tail ≤ VaR (`-0.070`), and `CVaR ≤ VaR` | unit | `... -t "golden CVaR"` | ❌ Wave 0 |
| STRESS-02 | A linear-interpolation / parametric VaR impl would NOT match the oracle (negative control) | unit | `... -t "not parametric"` | ❌ Wave 0 |
| STRESS-01 | Near-market-neutral book (cov≈0) → `projectedImpact ≈ 0`, NOT the full shock | unit | `... -t "near-market-neutral"` | ❌ Wave 0 |
| STRESS-01 | β-shock uses the BTC inner-join intersection (a divergent value on a non-overlapping date does not move the impact) | unit | `... -t "intersection not union"` | ❌ Wave 0 |
| STRESS-01 | A positive-β book → `projectedImpact ≈ β·shock` (sign + magnitude) | unit | `... -t "beta-propagated impact"` | ❌ Wave 0 |
| STRESS-02 | 2× uniform leverage → ~2× VaR and ~2× CVaR (quantile of linearly-scaled daily series); Sharpe unchanged | unit | `... -t "leverage scales VaR not Sharpe"` | ❌ Wave 0 |
| STRESS-02 | 2× uniform leverage → max-drawdown more severe **monotonically** (not exactly 2×, compounding caveat) | unit | `... -t "leverage drawdown monotone"` | ❌ Wave 0 |
| STRESS-02 | Degeneracy matrix → every field `null` (em-dash), never a fabricated 0 (see matrix below) | unit | `... -t "degenerate null"` | ❌ Wave 0 |
| STRESS-01/02 | Section renders the correct empty state per guard order (#509: scenario-side / BTC / floor / ok) | component | `npx vitest run StressVarSection.test.tsx` | ❌ Wave 0 |
| STRESS-02 | Section never re-declares `60` — imports `SAMPLE_FLOOR_OVERLAPPING_DAYS` | unit (grep/import assert) | `... -t "uses floor SoT"` | ❌ Wave 0 |

### Degeneracy / Floor Null-Safety Matrix (the test oracle for honesty)
| Input | Expected output | Why |
|-------|-----------------|-----|
| `portfolioDaily = []` (engine `n<10`/constant/non-finite → `portfolio_daily_returns=[]`) | scenario-side `EmptyStateCard`; all fields null | Honest scenario-side absence; #509 heading matches body |
| constant `portfolioDaily` (float-residue var) with n≥60 | VaR/CVaR `null` → "—" | relative-scale degeneracy guard; never a fabricated 0 |
| `btcAvailable = false` (fetch failed / `200 []`) | BTC-unavailable `EmptyStateCard`; β/impact null | mirrors `benchmarkAvailable=false`; never a fabricated impact |
| BTC overlap n < 60 (real but below floor) | β-shock → `SampleFloorEmptyState(feature="stress")` | below-floor; names the actual N + floor |
| scenario n < 60 (real but below floor) | VaR/CVaR → `SampleFloorEmptyState(feature="VaR")` | below-floor on the VaR window |
| `n = null / NaN / Infinity / negative` | `noUsableSampleBody` (no number named) | guard-FIRST: no-usable-n before below-floor |
| 0 or 1 active strategy | `fewStrategiesBody` (via `strategyCount` prop) | gate can't see count; call-site supplies it |
| constant BTC series (var(b)≈0) over overlap ≥60 | β `null` → impact "—" | `computeScenarioBenchmark` already null-guards this |

### Sampling Rate
- **Per task commit:** `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-stress.test.ts src/app/\(dashboard\)/allocations/components/StressVarSection.test.tsx`
- **Per wave merge:** `npm run test`
- **Phase gate:** full suite green + coverage gate held (lines 82 / statements 80 / functions 74 / branches 72) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` — covers STRESS-01 (β-shock, neutral invariant, intersection) + STRESS-02 (golden VaR/CVaR, leverage scaling, degeneracy)
- [ ] `src/app/(dashboard)/allocations/components/StressVarSection.test.tsx` — covers the state matrix, em-dash discipline, disclosure-line presence (model on `ScenarioBenchmarkSection.test.tsx`)
- [ ] Framework install: none — Vitest + RTL already configured.
- [ ] No `conftest`/shared-fixture file needed; build fixtures inline (the existing `scenario-benchmark.test.ts` `days(n)` helper style).

---

## Security Domain

> `security_enforcement` is `null` in config (absent = enabled), so this section is required. **However, Phase 26 adds NO server surface, NO migration, NO Python, NO auth, NO route, NO dependency, NO persistence.** The classical attack surface is empty. The real, load-bearing risk class is **HONESTY / CORRECTNESS** — a number that lies to an allocator making a real allocation decision. Frame the per-plan `<threat_model>` accordingly.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth touched; the only server call is the existing public BTC route. |
| V3 Session Management | no | No session interaction. |
| V4 Access Control | no | No new data access; VaR/shock are computed over data the allocator already sees in their own composer. No cross-tenant path. |
| V5 Input Validation | yes (light) | The shock magnitude is a fixed preset set (`SegmentedControl`) — a closed domain. If a custom-magnitude input is added (discretion), clamp it to a sane range and reject non-finite (mirror `handleLeverageChange`'s `Number.isFinite` + clamp). |
| V6 Cryptography | no | No crypto. |

### Honesty / Correctness Threat Class (the real per-plan threat_model)

| Honesty Threat | "STRIDE-analog" | Falsifiable Mitigation (the test) |
|----------------|-----------------|-----------------------------------|
| **Fabricated number** — a degenerate input renders `0.00%` instead of "—" | Information / misrepresentation | Degeneracy matrix tests: every field `null` → em-dash on empty/constant/below-floor/no-usable-n input. |
| **Leverage mis-scaling** — VaR doesn't scale with leverage, or double-counts it | Tampering (with the truth of the number) | `2× leverage ⇒ ~2× VaR/CVaR` (toBeCloseTo) AND `Sharpe unchanged` (the invariant contrast). |
| **Union-instead-of-intersection** — β computed over a zero-filled union window | Tampering | "divergent value on a non-overlapping date does not move the impact" test (proves inner-join). |
| **Parametric-instead-of-historical** — a Normal-tail VaR slips in | Misrepresentation | Golden oracle (`-0.060`/`-0.070`) that a parametric/interpolated impl would fail; explicit "not parametric" negative control. |
| **Floor bypass** — a tail estimate shown on <60 overlapping days | Misrepresentation (false precision) | `evaluateSampleFloor(n, 60)` gate test + below-floor empty-state render test; import-the-SoT assertion (no re-declared `60`). |
| **Shock applied at face value** — impact = shock instead of β·shock | Tampering | Near-market-neutral invariant: cov≈0 book ⇒ `|impact| < ε` (a face-value bug yields `|impact| ≈ |shock|`). |
| **Wrong-N disclosure** — the methodology line names the union N for a thinner BTC overlap | Misrepresentation | Each disclosure caption names its true N; test asserts the rendered N matches the actual overlap used. |
| **Bare VaR (no disclosure)** | Misrepresentation | Component test asserts the methodology line (method + N + 95% + "not a forecast") renders whenever a VaR renders. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Client-side number rendered as authoritative | Misrepresentation | "PROJECTED — not a forecast" framing (already the composer convention) + mandatory methodology disclosure. |
| Non-finite poisoning the math (NaN/±Inf) | Tampering | The engine already suppresses non-finite into `portfolio_daily_returns=[]`; `evaluateSampleFloor` guards null/NaN/Inf/negative n FIRST; `formatPercent`/`formatNumber` render "—" for non-finite. |

**Bottom line for the planner's `<threat_model>`:** "No new attack surface (no server/migration/auth/dep). The threat class is honesty/correctness: fabricated number, leverage mis-scaling, union-instead-of-intersection, parametric-instead-of-historical, floor bypass, face-value shock, wrong-N disclosure, bare VaR — each mitigated by exactly one falsifiable test enumerated in §Validation Architecture."

---

## Sources

### Primary (HIGH confidence — verified by direct repo read this session)
- `src/lib/scenario.ts` — `computeScenario`, `portfolio_daily_returns` (leverage `w·L·r` at :251; `n<10`/constant/non-finite → `[]`; `max_drawdown` loop :364)
- `src/lib/portfolio-stats.ts` — `computeVaR` (:142, floor quantile, returns 0 on empty), `computeExpectedShortfall` (:160), `computeAlphaBeta` (:412, cov/var)
- `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` — `innerJoinByDate` (:63), `computeScenarioBenchmark` (:97), relative-scale degeneracy guard (:139)
- `src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts` — golden/intersection/null-safety test template
- `src/lib/sample-floor.ts` — `SAMPLE_FLOOR_OVERLAPPING_DAYS=60` (:37), `evaluateSampleFloor` guard-first (:70), body builders
- `src/lib/sample-floor.test.ts` — degenerate-matrix test style
- `src/components/scenarios/SampleFloorEmptyState.tsx` — below-floor render, `feature`/`strategyCount` props
- `src/lib/scenario-history.ts` — `methodologyLine(n)` (:41)
- `src/lib/portfolio-math-utils.ts` — `mean`/`stdDev`/`compound`, `DailyPoint`
- `src/lib/utils.ts` — `formatPercent` (:3), `formatNumber` (:27) — "—" on null/non-finite
- `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx` — the verbatim section template + guard order
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — mount seam (:1574-1580), `btcDaily`/`btcAvailable` state (:439-440), `MAX_LEVERAGE` (:118), leverage caveat (:1488)
- `src/app/(dashboard)/allocations/widgets/risk/VarExpectedShortfall.tsx` — the existing VaR widget (anti-pattern reference: red losses, fabricated 0)
- `.planning/phases/26-stress-testing-var/26-CONTEXT.md`, `26-UI-SPEC.md` — locked decisions + UI contract
- `.planning/REQUIREMENTS.md` — STRESS-01/02 (:52-53), no-invented-data scope note (:82)
- `.planning/STATE.md` — Phase-22 floor SoT carried gate (:59), Phase-24 BTC route decision (:231)
- `.planning/config.json` — `nyquist_validation: true`, `security_enforcement: null`, no enhanced search

### Secondary (MEDIUM)
- (none — no web search needed; the math definitions are standard and cross-checked against the in-repo implementations)

### Tertiary (LOW)
- (none)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every module verified by direct read; zero new packages by lock.
- Architecture: HIGH — the new section/lib mirror the shipped `ScenarioBenchmarkSection`/`scenario-benchmark.ts` exactly; mount seam located.
- Math correctness: HIGH — VaR/CVaR/β definitions cross-checked against the live `computeVaR`/`computeExpectedShortfall`/`computeAlphaBeta` and a hand-computed golden oracle; leverage-scaling derived from the engine's `w·L·r` line.
- Pitfalls: HIGH — each pitfall is anchored to a specific verified line (the `0`-not-`null` VaR return, the two-different-N overlap, the leverage bake-in, the #509 guard order).

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable — pure in-repo TS over frozen engine; no fast-moving external dependency. The only invalidation risk is a change to `computeScenario`/`computeAlphaBeta`/`sample-floor.ts`, which would be a roadmap-level event.)
