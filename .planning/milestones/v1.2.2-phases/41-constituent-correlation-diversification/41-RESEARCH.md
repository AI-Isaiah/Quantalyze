# Phase 41: Constituent correlation & diversification - Research

**Researched:** 2026-06-26
**Domain:** Client-side portfolio diversification math (pure TS) + factsheet-shaped panel wiring (React) on a FROZEN scenario engine
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Placement, renderer & data source**
- The panel is a **scenario-scoped `CollapsibleSection` rendered in `ScenarioFactsheetChart.tsx`** (factsheet-shaped editorial styling, below the mounted body), NOT a field on `FactsheetCsvPayload` and NOT inline in `ScenarioComposer.tsx` (static-guard at ScenarioComposer.test.tsx:3377). The constituent data is passed from the composer into `ScenarioFactsheetChart` as a new additive prop.
- **Reuse the existing `src/components/portfolio/CorrelationHeatmap.tsx`** — WCAG-audited (diverging teal→burnt-orange palette, colorblind-safe), empty-state routed, accepts `{ correlationMatrix, strategyNames, overlappingDays, avgAbsCorrelation }`. Do not build a new heatmap.
- **Matrix data = the engine's `correlation_matrix`** (CORR-01; frozen, already emitted as `Record<id, Record<id, number>>`, 3-decimal). Never recompute ρ in the panel.
- **Labels = the existing `strategyNames` de-aliased memo** (ScenarioComposer.tsx:1531, keyed off `deAliased.strategies`) — already human names, not UUIDs (CORR-04 done-by-reuse via `scenario-dealias.ts`).

**Diversification math & thresholds**
- **Diversification Ratio = (Σ wᵢσᵢ) / σ_portfolio** (Choueifaty); σᵢ from each constituent's `daily_returns`; σ_portfolio from `scenarioMetrics.portfolio_daily_returns`.
- **Effective Number of Bets = 1 / Σ PCRᵢ²** (RISK-based, correlation-aware — uses per-constituent risk contributions, NOT the naive weight-HHI 1/Σwᵢ²). Formula DISCLOSED on the panel.
- **"Too similar" flag at ρ ≥ 0.85** (CORR-02, locked).
- **Empty gate = GLOBAL n** — the engine nulls the whole `correlation_matrix` at n<10 → whole-panel honest empty; 0/1-constituent → "add a second strategy" empty. The engine emits NO per-pair overlap metadata, so the floor is global-n, NOT per-cell; DOCUMENT this (do not fabricate per-pair overlap tracking). Any genuinely-missing cell renders "—".

**Risk contribution & clustering**
- **PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw)** (CORR-05), where Σ is a covariance matrix DERIVED client-side from constituents' `daily_returns` (engine emits only ρ, not Σ or σ). Show per-constituent %-of-risk alongside the matrix.
- **Cluster reorder (CORR-06)** = hand-rolled pure-TS **average-linkage** hierarchical clustering on distance ½(1−ρ); reorder matrix rows/cols so correlated clusters group visually. No new dependency. Full dendrogram viz is v2 (CORR-V2-02).
- **Math home = a NEW pure-TS `src/lib/diversification.ts`** (DR, risk-based ENB, PCR, covariance-from-returns, average-linkage order) with golden unit tests. Keep `correlation_matrix` consumption read-only.
- **Honest empties:** 0/1-constituent → "add a second strategy"; n<10 → engine-null empty state (reason-routed by `CorrelationHeatmap`).
- Reaffirm the **leverage-invariance** note on the panel header (correlation does not shift with per-strategy leverage; live at ScenarioComposer.tsx:2204).

### Claude's Discretion
- The exact `diversification.ts` function signatures, internal helpers, and numerical-stability guards (subject to the convention pins below).
- The exact prop name/shape on `ScenarioFactsheetChart` (CONTEXT suggests `constituents`).
- The panel's internal layout (heatmap + DR/ENB headline + PCR list arrangement) within the `CollapsibleSection`, matching DESIGN.md editorial styling.

### Deferred Ideas (OUT OF SCOPE)
- Crisis-window sub-correlation (CORR-V2-01) — v2.
- Full dendrogram visualization (CORR-V2-02) — v2 (this phase REORDERS only).
- Peer-cohort / mandate → Phase 42. Toggle fold + guards + Phase-40 UI-review carry-forwards → Phase 43.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORR-01 | Constituent correlation matrix from frozen engine's `correlation_matrix`, factsheet-shaped layout | Reuse `CorrelationHeatmap` + engine matrix verbatim (scenario.ts:401-432). Pass-through wiring in §Data Threading. |
| CORR-02 | Pairs ≥0.85 flagged + DR/ENB headline | `tooSimilarPairs(corr, ids, 0.85)` helper + `diversificationRatio` + `effectiveNumberOfBets` in diversification.ts (§1). |
| CORR-03 | Per-cell overlap floor → "—"; 0/1-constituent → honest empty | Engine has NO per-pair overlap → floor is GLOBAL-n (engine null at n<10). Heatmap renders "—" on null cells already (CorrelationHeatmap.tsx:283-302). Empty routing inherited. §5. |
| CORR-04 | De-aliased labels (strategy name vs API-key-strategy, not UUIDs) | `strategyNames` memo (ScenarioComposer.tsx:1531) already de-aliased via `collapseAliasedHoldingStrategies`. Done-by-reuse. |
| CORR-05 | Per-constituent PCRᵢ = wᵢ·(Σw)ᵢ/(wᵀΣw) alongside matrix | `covarianceMatrix` + `percentContributionToRisk` in diversification.ts. Σ from client-side cov (§1, §2). |
| CORR-06 | Hierarchical-cluster reorder on distance ½(1−ρ) | `clusterOrder` (average-linkage) in diversification.ts; reorder matrix+labels BEFORE passing to heatmap (§4). |
</phase_requirements>

## Summary

Phase 41 adds a NEW pure-TS `src/lib/diversification.ts` (DR, risk-based ENB, PCR, client-side covariance, average-linkage cluster order) plus a factsheet-shaped `CollapsibleSection` rendered inside `ScenarioFactsheetChart.tsx`, fed by a new additive `constituents` prop threaded from `ScenarioComposer`. The `scenario.ts` engine stays FROZEN: it already emits the `correlation_matrix` (read-only), but it does NOT emit the per-constituent volatilities, the covariance matrix, or — critically — the **aligned-on-commonDates per-constituent return series** that DR/PCR need. Those aligned series exist only as a transient local (`strategyReturns`, scenario.ts:229-236) and are discarded. The composer holds `deAliased.strategies` (RAW, unaligned `daily_returns`) + `deAliased.state` (selected/weights/startDates/leverage). **Therefore the panel MUST re-align** the per-constituent series using the SAME union-of-dates + per-strategy include-from + zero-fill logic the engine uses internally — this is the single biggest landmine of the phase.

The convention is the second landmine. The engine's `correlation_matrix` and `volatility` use **SAMPLE** covariance/std (÷(n−1), scenario.ts:338,390-393,420). The factsheet body's `compute.ts` uses **POPULATION** std (÷n, pstdev) — a deliberately-coexisting convention (REQUIREMENTS.md:73 "Out of Scope" pins this split). For the DR and PCR to be internally consistent **with the displayed correlation matrix**, `diversification.ts` MUST use SAMPLE covariance/std end-to-end — NOT the factsheet population convention. σ_portfolio for the DR denominator must likewise be the SAMPLE std of `portfolio_daily_returns` (matching the engine's own `volatility`). This is a LOCKED convention for the golden tests; a population-std bleed would silently desync DR from the matrix it sits beside.

No new dependency is needed and none exists for it (39 deps, ZERO clustering/linalg/matrix libs) — average-linkage is hand-rolled, ~40 lines, O(n²·log n) which is fine for the small-n constituent sets (typically <30). The established precedent is `src/lib/scenario-blend-panels.ts`: a pure-TS, zero-dep adapter that consumes engine output, reuses `mean`/`stdDev` from `portfolio-math-utils`, applies a `MIN_USABLE` floor, collapses degenerate input to empty, and is pinned by golden tests. `diversification.ts` is the same shape.

**Primary recommendation:** Build `src/lib/diversification.ts` as a pure-TS helper that (a) re-aligns per-constituent returns on the engine's union-of-dates axis using SAMPLE covariance/std, (b) computes DR/ENB/PCR/cluster-order with explicit degenerate→null/identity returns, pinned by hand-computed golden tests. Thread a `constituents` prop from `ScenarioComposer` → `ScenarioFactsheetChart`, render a `CollapsibleSection` below `FactsheetBody` reusing `CorrelationHeatmap` (reorder matrix+labels before passing). The engine stays frozen; ρ is read-only.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pairwise ρ (correlation matrix) | Frozen engine (`scenario.ts`, client) | — | Already emitted (SCENARIO-05 freeze); read-only. |
| Per-constituent return re-alignment | New pure-TS lib (`diversification.ts`, client) | — | Engine discards the aligned series; the lib must reconstruct on the same axis. |
| DR / ENB / PCR / covariance / cluster-order | New pure-TS lib (`diversification.ts`, client) | — | Pure deterministic math, no I/O — belongs in a unit-tested lib, not a component. |
| Panel rendering (heatmap + headline + PCR list) | React widget (`ScenarioFactsheetChart.tsx`, client) | `CorrelationHeatmap` (reused) | Presentational; mounts under the existing factsheet provider. |
| Data threading (constituents → panel) | React composer (`ScenarioComposer.tsx`, client) | — | Composer owns the de-aliased set + projection state; passes an additive prop. |
| De-aliased labels | React composer memo (`strategyNames`, client) | `scenario-dealias.ts` | Already exists (CORR-04 done-by-reuse). |

**Tier note:** This is a 100% client-tier phase. No API/backend, no database, no network, no auth. The Python `analytics-service/` is untouched. The frozen `scenario.ts` engine is the only "backend-like" boundary and it is read-only.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| (none new) | — | — | **Hand-rolled pure TS** per CONTEXT lock. No clustering/linalg dep exists or is wanted (parity-by-construction, frozen-engine safety, parallel-agent collision avoidance). |

### Supporting (existing, reused)
| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `mean`, `stdDev` | `src/lib/portfolio-math-utils.ts:64-81` | Mean + std (`stdDev(values, sample=true)` ÷(n−1); pass `false` for ÷n) | σᵢ and σ_portfolio — call with `sample=true` (the default) for engine consistency. |
| `pearson` | `src/lib/correlation-math.ts:17-40` | Pearson ρ, returns `null` on zero-variance | NOT for the matrix (engine owns that) — available if a defensive cross-check is wanted; the panel reads the engine matrix. |
| `CorrelationHeatmap` | `src/components/portfolio/CorrelationHeatmap.tsx` | The reused renderer | Pass `{ correlationMatrix, strategyNames, overlappingDays, avgAbsCorrelation }`. |
| `CollapsibleSection` | `src/components/ui/CollapsibleSection.tsx` | Factsheet-shaped `<details>` section | Wrap the panel. ⚠️ persist note below. |
| `scenario-blend-panels.ts` | `src/lib/scenario-blend-panels.ts` | **PATTERN PRECEDENT** (pure-TS engine-output adapter w/ golden tests, MIN_USABLE floor, degenerate→empty) | Copy its shape for `diversification.ts`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled average-linkage | `ml-hclust` / `density-clustering` npm | NEW dependency — CONTEXT explicitly forbids; ~40 lines of TS is cheaper and parity-safe. `[REJECTED]` |
| Re-aligning per-constituent returns in the panel | Modifying engine to emit aligned series | Engine is FROZEN (SCENARIO-05); re-alignment in the lib is the only frozen-safe path. `[REJECTED — engine change]` |
| `pearson` from correlation-math.ts for the matrix | — | The engine ALREADY emits ρ; recomputing risks drift + violates "never recompute ρ" lock. Use the engine matrix. `[REJECTED]` |

**Installation:** None. No `npm install`. Phase is pure additive TS + React in an existing workspace.

## Package Legitimacy Audit

> N/A — this phase installs **NO external packages**. All math is hand-rolled pure TS; all reused components/libs already exist in the repo. slopcheck not run (nothing to check). No registry surface.

## Architecture Patterns

### System Architecture Diagram

```
ScenarioComposer (client component)
  │
  ├─ deAliased = collapseAliasedHoldingStrategies(adapterStrategies, projectionState, symbolByHoldingId)
  │     └─ deAliased.strategies : StrategyForBuilder[]  (RAW daily_returns, UNALIGNED)
  │     └─ deAliased.state      : { selected, weights, startDates, leverage }
  │
  ├─ scenarioMetrics = computeScenario(deAliased.strategies, deAliased.state, dateMapCache)   [FROZEN]
  │     └─ emits: correlation_matrix, avg_pairwise_correlation, n, portfolio_daily_returns
  │     └─ does NOT emit: aligned per-constituent series, σᵢ, covariance Σ
  │
  ├─ strategyNames memo (de-aliased id→name)                          [exists, ScenarioComposer.tsx:1531]
  │
  ▼  NEW: build `constituents` prop
  constituentsForPanel = useMemo(() => buildConstituentsInput(
        deAliased.strategies, deAliased.state,                         // → re-align returns + weights
        scenarioMetrics.correlation_matrix, scenarioMetrics.n,
        scenarioMetrics.portfolio_daily_returns, strategyNames))
  │
  ▼  pass as additive prop
ScenarioFactsheetChart (client widget)
  │
  ├─ <FactsheetProvider><FactsheetBody …/></FactsheetProvider>        [Phase 40, unchanged]
  │
  ▼  NEW below the body:
  <CollapsibleSection title="Constituent diversification">
     │
     ├─ div = computeDiversification(constituents)   ──► src/lib/diversification.ts  [NEW pure TS]
     │     ├─ covarianceMatrix(returnsById, ids)   (SAMPLE, ÷(n−1))
     │     ├─ constituentVols (σᵢ, SAMPLE)
     │     ├─ diversificationRatio(weights, vols, σ_p)
     │     ├─ percentContributionToRisk(weights, cov)  → array Σ=1
     │     ├─ effectiveNumberOfBets(pcr) = 1/Σpcrᵢ²
     │     ├─ clusterOrder(corr, ids)  (average-linkage, distance ½(1−ρ))
     │     └─ tooSimilarPairs(corr, ids, 0.85)
     │
     ├─ DR / ENB headline (formula disclosed)
     ├─ <CorrelationHeatmap correlationMatrix={REORDERED} strategyNames overlappingDays={n} avgAbsCorrelation/>
     ├─ PCR list (per-constituent %-of-risk)
     └─ "too similar (ρ≥0.85)" flags + leverage-invariance note
  </CollapsibleSection>
```

### Recommended Project Structure
```
src/lib/
├── diversification.ts          # NEW — pure TS: cov, σ, DR, PCR, ENB, cluster-order, too-similar
├── diversification.test.ts     # NEW — golden tests (hand-computed 3-constituent fixture)
├── scenario.ts                 # FROZEN — read correlation_matrix only
├── scenario-blend-panels.ts    # PATTERN PRECEDENT (do not edit)
├── portfolio-math-utils.ts     # reuse mean/stdDev
└── correlation-math.ts         # pearson available (defensive only)

src/app/(dashboard)/allocations/
├── components/ScenarioComposer.tsx              # EDIT — build + pass `constituents` prop
├── components/ScenarioComposer.test.tsx         # EDIT — wiring test (prop spy)
└── widgets/performance/ScenarioFactsheetChart.tsx     # EDIT — accept prop, render panel
    widgets/performance/ScenarioFactsheetChart.test.tsx (if exists) # EDIT/ADD — panel render test
```

### Pattern 1: Pure-TS engine-output adapter (the `scenario-blend-panels.ts` shape)
**What:** A pure function consuming frozen-engine output + the de-aliased input set, reusing `mean`/`stdDev`, with a hard degenerate→empty collapse and golden tests.
**When to use:** All of `diversification.ts`.
**Example:**
```typescript
// Source: src/lib/scenario-blend-panels.ts:1-30 (convention pins) + portfolio-math-utils.ts
import { mean, stdDev } from "@/lib/portfolio-math-utils";
const MIN_USABLE = 10; // mirror the engine's n<10 null gate

// SAMPLE convention (÷(n−1)) — matches the engine's correlation_matrix + volatility,
// NOT the factsheet population convention. stdDev defaults to sample=true.
function sigma(returns: number[]): number {
  return stdDev(returns, true); // ÷(n−1)
}
```

### Pattern 2: Re-align per-constituent returns on the engine's axis
**What:** Reconstruct the aligned series the engine computes internally but discards.
**When to use:** Inside `buildConstituentsInput` (composer) OR inside `diversification.ts` — recommend the composer, keyed on `deAliased`, so the lib receives already-aligned arrays and stays a pure number-cruncher.
**Example:**
```typescript
// Mirror scenario.ts:199-236 EXACTLY (union of dates ≥ each strategy's include-from,
// zero-fill where a strategy isn't active yet). The matrix the engine emits was built
// from THESE arrays, so DR/PCR are consistent only if re-alignment matches byte-for-byte.
// Source: src/lib/scenario.ts:199-236
const allDateSet = new Set<string>();
for (const s of activeStrategies) {
  const from = startDates[s.id] ?? s.start_date ?? "2022-01-01";
  for (const d of s.daily_returns) if (d.date >= from) allDateSet.add(d.date);
}
const commonDates = Array.from(allDateSet).sort();
const returnsById: Record<string, number[]> = {};
for (const s of activeStrategies) {
  const map = new Map(s.daily_returns.map(d => [d.date, d.value]));
  const from = startDates[s.id] ?? s.start_date ?? "2022-01-01";
  returnsById[s.id] = commonDates.map(d => (d >= from ? (map.get(d) ?? 0) : 0));
}
```
⚠️ **LANDMINE:** Do NOT apply leverage to the per-constituent series for correlation/σ. The engine deliberately does NOT (scenario.ts:69-82 + 387: the correlation matrix is built from `strategyReturns`, the UN-levered series). Leverage is a scale transform that cancels in Pearson normalization. For DR/PCR **consistency with the displayed matrix**, σᵢ and Σ must also be UN-levered. (The engine applies leverage only to `portDaily`/`portfolio_daily_returns` at scenario.ts:251 — so σ_portfolio in the DR denominator IS levered. This is the Choueifaty DR's intended asymmetry: numerator uses standalone un-levered σᵢ, denominator uses the realized portfolio σ. Document it; it is internally consistent because the matrix is un-levered too.)

### Pattern 3: Hand-rolled average-linkage (the only novel algorithm)
**What:** Agglomerative hierarchical clustering on distance d(i,j)=½(1−ρᵢⱼ), average linkage, emit a leaf order.
**When to use:** `clusterOrder(corr, ids)` in diversification.ts.
**Algorithm (precise):**
1. Build the n×n distance matrix `D[i][j] = 0.5 * (1 - ρ(i,j))`. Missing/`null` ρ → treat as max distance `1` (uncorrelated-most-distant) so a flat-window pair doesn't collapse the tree. Self-distance 0.
2. Initialize n singleton clusters, each a leaf list `[id]`.
3. Repeat until one cluster:
   - Find the pair of clusters (A,B) with the smallest **average** inter-cluster distance: `dist(A,B) = mean over a∈A,b∈B of D[a][b]`.
   - Merge into a new cluster whose leaf order is `A.leaves ++ B.leaves` (concatenate so correlated members stay adjacent).
4. Output the final cluster's leaf id order.
- **Edge n≤2:** return `[...ids]` (identity order — clustering is a no-op for 0/1/2 ids; 2 ids are trivially adjacent).
- **Edge missing ρ:** as above, distance=1 (max). Never `NaN` into the comparison.
- Complexity O(n²·log n) recompute-naive is fine for n<30. (Lance–Williams update is an optional optimization; not needed.)
**Reorder application:** Reorder the MATRIX and LABELS in the composer/panel BEFORE passing to `CorrelationHeatmap` — the heatmap renders `Object.keys(correlationMatrix)` order (CorrelationHeatmap.tsx:183) and has NO custom-order prop. Build a reordered `Record<id,Record<id,number>>` (insertion order = cluster order) and pass the same `strategyNames` (keyed by id, order-independent). See §4.

### Anti-Patterns to Avoid
- **Recomputing ρ in the panel.** Locked-out — read the engine matrix. Recomputing risks sample-vs-population drift and a fabricated diagonal.
- **Population std for DR/PCR.** Would desync DR from the SAMPLE matrix it sits beside. Use `stdDev(x, true)`. (See §2.)
- **Applying leverage to the per-constituent series.** Breaks matrix consistency; the engine doesn't. Un-levered σᵢ + levered σ_portfolio is the correct, intended asymmetry.
- **Re-aligning with a different date axis than the engine.** Any divergence (e.g. intersection instead of union, or omitting the include-from zero-fill) makes σᵢ/Σ describe a different window than ρ. Mirror scenario.ts:199-236 exactly.
- **A 1×1 heatmap or a fabricated Avg|ρ|.** The heatmap's `ids.length < 2` gate (CorrelationHeatmap.tsx:191) prevents the 1×1; rely on it.
- **NaN/Inf into the UI.** Every diversification.ts function must return `null` (or a safe default) on degenerate input. See §5.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Pairwise correlation ρ | A new Pearson loop in the panel | Engine `correlation_matrix` (scenario.ts:401-432) | Already emitted, frozen, 3-decimal, sample-cov, leverage-invariant. Recomputing risks drift. |
| Heatmap rendering | A new grid/palette | `CorrelationHeatmap` (WCAG-audited) | Colorblind-safe diverging palette, empty-state routing, aria labels, CI contrast sweep. |
| Empty-state routing (n<10, <2 strategies, engine-null) | New empty copy | `CorrelationHeatmap`'s reason-routed `EmptyStateCard` (CorrelationHeatmap.tsx:191-233) | 4 distinct reasons already mapped + /qa-hardened. |
| mean / std | Inline reduce | `mean`, `stdDev` from portfolio-math-utils | Matches `scenario-blend-panels.ts` parity convention exactly. |
| Collapsible section (factsheet-shaped) | New `<details>` | `CollapsibleSection` | Keyboard-accessible, factsheet-styled, persist-aware. |
| De-aliasing labels | New label logic | `strategyNames` memo + `collapseAliasedHoldingStrategies` | CORR-04 done-by-reuse; venue aliases already collapsed. |

**What you MUST hand-roll (no library):** DR, PCR, risk-based ENB, covariance-from-returns, average-linkage cluster order. These are the `diversification.ts` core. No npm dependency exists or is wanted.

**Key insight:** The entire phase is "reuse the renderer + the matrix + the labels + the empty states; hand-roll ONLY the four diversification formulas + one clustering algorithm; re-align the per-constituent series the engine threw away." The reuse surface is huge; the novel surface is one small pure-TS file.

## Runtime State Inventory

> N/A — greenfield additive phase. NO rename/refactor/migration. NO stored data, no live-service config, no OS-registered state, no secrets/env vars, no build artifacts affected. The new `diversification.ts` is additive; the engine, the heatmap, and the de-alias lib are read-only/reused.
> **Verified by:** the only file edits are additive (new lib + new prop + new panel render); no string renames, no DB keys, no migrations.

## §1 — `diversification.ts` Exact Contract

All functions are pure, synchronous, no I/O. **SAMPLE convention throughout** (see §2). Recommended signatures (Claude's discretion on exact names; semantics are locked):

```typescript
// src/lib/diversification.ts
import { mean, stdDev } from "@/lib/portfolio-math-utils";

export interface DiversificationInput {
  ids: string[];                              // de-aliased constituent ids, ACTIVE only
  returnsById: Record<string, number[]>;      // ALIGNED on the engine's commonDates axis (§3)
  weights: Record<string, number>;            // normalized (sum→1) over the active set
  portfolioDailyReturns: number[];            // engine portfolio_daily_returns values (levered)
  correlationMatrix: Record<string, Record<string, number>> | null; // engine ρ (read-only)
  n: number;                                  // engine overlapping-day count
}

export interface DiversificationResult {
  diversificationRatio: number | null;
  effectiveNumberOfBets: number | null;
  pcr: Record<string, number> | null;        // sums to 1 over active ids
  clusterOrderIds: string[];                  // reordered id list (identity when n≤2 ids)
  tooSimilarPairs: Array<[string, string, number]>; // ρ≥0.85 off-diagonal pairs
  // σ exposed for the panel headline / disclosure if wanted:
  vols: Record<string, number> | null;
}
```

### `covarianceMatrix(returnsById, ids): number[][] | null`
- **Formula:** Σ[i][j] = Σₖ (rᵢₖ − r̄ᵢ)(rⱼₖ − r̄ⱼ) / (T−1)  — **SAMPLE** (÷(T−1)), matching the engine (scenario.ts:420 `cov = T > 1 ? cov / (T - 1) : 0`).
- **Alignment:** consumes the ALREADY-ALIGNED `returnsById` (all arrays length T over the same `commonDates`). Re-alignment is done upstream in the composer (§3) — the engine's aligned series live ONLY as the local `strategyReturns` (scenario.ts:229-236) and are NOT emitted, so the composer reconstructs them by mirroring scenario.ts:199-236 (Pattern 2). The lib does NOT re-align; it asserts equal lengths.
- **Edge — <2 obs (T<2):** return `null` (cov undefined; mirrors engine `T>1 ? … : 0` but the lib returns null so the whole panel degrades honestly rather than emitting a 0-matrix). The global n<10 gate (§5) makes this branch effectively unreachable in production, but it's a defensive floor.
- **Edge — zero-variance constituent:** Σ[i][i]=0 for that row/col is mathematically fine; it only poisons PCR if it drives `wᵀΣw`→0 (handled in PCR).
- **Numerical note:** two-pass (compute means first, then demeaned products) — NOT the naive E[XY]−E[X]E[Y] one-pass, which loses precision on small daily returns near 0. Mirror the engine's two-pass demeaned approach (scenario.ts:388-419).

### `constituentVols(returnsById, ids): Record<string, number> | null`  (σᵢ)
- **Formula:** σᵢ = `stdDev(returnsById[id], /*sample*/ true)` (÷(T−1)).
- **Convention — SAMPLE, locked.** Justification: the displayed correlation matrix is sample-cov; ρᵢⱼ = covᵢⱼ/(σᵢσⱼ) with sample cov AND sample σ. For DR/PCR to be internally consistent with that matrix, σᵢ must be the SAME sample σ. Using the factsheet POPULATION σ here would make σᵢσⱼ ≠ the denominator that produced the displayed ρ, silently desyncing the headline from the grid. **Do NOT match the factsheet-body convention** — that's a different surface (REQUIREMENTS.md:73). See §2.
- **NOT annualized** — DR is a ratio (Σwᵢσᵢ)/σ_p; annualization (×√252) cancels, so use the daily σ on both sides for simplicity. (If annualized σᵢ is shown in the disclosure, annualize consistently on both numerator and denominator — the ratio is invariant.)
- **Edge — zero-variance:** σᵢ=0 (flat constituent). Valid; contributes 0 to the DR numerator. Only an issue if ALL constituents flat → σ_p=0 → DR null (handled below).
- **Edge — T<2:** `stdDev` returns 0 for sample with n<2 (portfolio-math-utils.ts:76). The lib should treat the whole input as degenerate via the global gate before this.

### `diversificationRatio(weights, vols, portfolioVol): number | null`
- **Formula:** DR = (Σᵢ wᵢ·σᵢ) / σ_p  (Choueifaty).
- **σ_p source:** `stdDev(portfolioDailyReturns, /*sample*/ true)` (÷(n−1)) — the SAME sample std the engine uses for `volatility` (scenario.ts:338-340). This σ_p is LEVERED (built from `portDaily` which applies `wᵢ·Lᵢ·rᵢ`). The numerator σᵢ are UN-levered (per-constituent standalone). This asymmetry is the Choueifaty DR's correct form and is internally consistent because the matrix is also un-levered (see Pattern 2 landmine).
- **Edge — σ_p = 0:** return `null` (degenerate, all-flat blend; UI shows "—"). Never divide by 0.
- **Edge — Σwᵢσᵢ = 0:** DR = 0 (all constituents flat) — but σ_p=0 too, so the null branch fires first. Safe.
- **Sanity bound:** DR ≥ 1 for long-only weights with non-perfect correlation; DR = 1 when all ρ=1 (no diversification). The golden test pins a known case.

### `percentContributionToRisk(weights, cov): Record<string, number> | null`
- **Formula:** PCRᵢ = wᵢ·(Σw)ᵢ / (wᵀΣw), where (Σw)ᵢ = Σⱼ Σ[i][j]·wⱼ. Array sums to 1 (Euler decomposition of variance).
- **Edge — wᵀΣw = 0:** return `null` (degenerate portfolio variance — all-flat or perfectly-offsetting; UI shows "—"). **This is the "degenerate cov makes PCR explode" landmine** — wᵀΣw in the denominator is exactly the portfolio variance; if it's 0 the contributions are undefined, NOT 0/0=NaN. Guard explicitly: `if (portVar <= 0) return null;`.
- **Edge — negative PCRᵢ:** possible with strong negative correlation (a leg that REDUCES portfolio risk). Keep the signed value (it's honest — a hedge has negative risk contribution). The ENB formula squares it so sign doesn't break ENB; the PCR list can render negative % with a "risk-reducing" note. **Do NOT clamp to 0** (would break the sum-to-1 invariant).
- **Numerical:** wᵀΣw computed as Σᵢ wᵢ·(Σw)ᵢ — reuse the (Σw) vector. Tiny negative from float error (e.g. −1e−18) → treat as ≤0 → null. Use a small epsilon (`portVar <= 1e-15`).

### `effectiveNumberOfBets(pcr): number | null`
- **Formula:** ENB = 1 / Σᵢ PCRᵢ²  (RISK-based, correlation-aware — Meucci). DISCLOSED on the panel.
- **Edge — empty / null pcr:** return `null`.
- **Edge — Σpcr² = 0:** unreachable when pcr sums to 1 (at least one nonzero) — but guard `denom > 0 ? 1/denom : null` defensively.
- **Range:** 1 ≤ ENB ≤ k (k = #constituents). ENB=k when all PCR equal (perfectly diversified risk); ENB=1 when one leg owns all risk.
- **Note:** with negative PCR (hedges), Σpcr² can exceed 1, pushing ENB < 1 — honest (a hedged book can be "less than one independent bet" in this measure). Document; don't clamp.

### `clusterOrder(corr, ids): string[]`
- **Algorithm:** average-linkage agglomerative on distance ½(1−ρ) — full spec in Pattern 3.
- **Edge — n≤2 ids:** return `[...ids]` (identity).
- **Edge — missing/null ρ:** distance = 1 (max). No NaN in the comparison.
- **Output:** reordered id list. The panel builds a reordered matrix + passes the same `strategyNames` (§4).

### `tooSimilarPairs(corr, ids, threshold=0.85): Array<[id, id, ρ]>`
- Off-diagonal pairs (j>i) with `corr[i][j] != null && corr[i][j] >= 0.85`. CORR-02.
- Edge — null matrix: return `[]`.

### `computeDiversification(input): DiversificationResult`
- Orchestrator: applies the global gate (ids.length<2 OR n<10 OR matrix null → all-null result with `clusterOrderIds = [...ids]`), else computes cov→vols→DR→PCR→ENB→clusterOrder→tooSimilarPairs.

**NO new dependency.** All hand-rolled. **Numerical-stability concerns flagged:** (1) wᵀΣw→0 PCR explosion (guarded with epsilon); (2) two-pass covariance for small-magnitude daily returns; (3) negative-PCR honesty (don't clamp); (4) float epsilon on the portfolio-variance gate.

## §2 — Convention Consistency (CRITICAL, LOCKED)

**The engine uses SAMPLE covariance/std (÷(n−1)). `diversification.ts` MUST use SAMPLE too.**

Engine citations (`scenario.ts`):
- File-level note: *"Correlation uses SAMPLE covariance (divide by n-1), consistent with the SAMPLE std used for portfolio volatility."* (scenario.ts:27-28)
- Portfolio variance (vol): `variance = …/(n - 1)` (scenario.ts:337-338) → `volatility = volDaily * √252` (scenario.ts:340).
- Per-constituent sample var for the matrix: `sampleVar = … / (vec.length - 1)` (scenario.ts:390-393).
- Pairwise sample cov: `cov = T > 1 ? cov / (T - 1) : 0` (scenario.ts:420); `corr = cov/(stdA·stdB)` (scenario.ts:421-422).

Contrast — the **factsheet body** (`compute.ts`) uses POPULATION std (`pstdev`, ÷n): annVol `s * √252` where `s` is population std (compute.ts:8 comment "population stdev (not sample)"; downside dev `÷ n` at compute.ts:36). REQUIREMENTS.md:73 LOCKS this coexistence as Out-of-Scope-to-unify.

**Locked convention for golden tests:**
1. `covarianceMatrix`, `constituentVols`: SAMPLE (÷(T−1)) → `stdDev(x, true)`.
2. `diversificationRatio` σ_p: SAMPLE std of `portfolio_daily_returns` → `stdDev(portfolioDailyReturns, true)` — numerically equal to the engine's `volatility / √252`.
3. PCR's Σ: the same SAMPLE cov matrix.
4. **Why:** ρᵢⱼ = covᵢⱼ^sample/(σᵢ^sample·σⱼ^sample). Mixing a population σ into DR/PCR would make the headline describe a different statistic than the grid beside it. The golden test asserts: rebuilding ρ from `diversification.ts`'s own cov+σ reproduces the engine's `correlation_matrix` to 3 decimals (the consistency pin).

## §3 — Data Threading (where the ALIGNED returns live)

**The aligned per-constituent series are NOT emitted by the engine.** They exist only as the local `strategyReturns` (scenario.ts:229-236), computed from `commonDates` (the union of all active strategies' dates ≥ each strategy's include-from, scenario.ts:199-208) with per-strategy zero-fill, and discarded after the matrix is built.

**What the composer HAS:**
- `deAliased.strategies: StrategyForBuilder[]` — each carries RAW, UNALIGNED `daily_returns: DailyPoint[]` (ScenarioComposer.tsx:1494-1502 → scenario-dealias.ts; `StrategyForBuilder.daily_returns` at scenario.ts:57).
- `deAliased.state: { selected, weights, startDates, leverage? }` (scenario-dealias.ts:161-166).
- `scenarioMetrics.correlation_matrix`, `.n`, `.portfolio_daily_returns`, `.avg_pairwise_correlation` (engine output, ScenarioComposer.tsx:1507-1510).
- `strategyNames` (de-aliased id→name, ScenarioComposer.tsx:1531-1535).

**What the composer must DO (new memo, keyed on `deAliased` + `scenarioMetrics`):**
1. Determine the ACTIVE set: `deAliased.strategies.filter(s => deAliased.state.selected[s.id])` — same filter the engine uses (scenario.ts:154-156).
2. **Re-align** each active constituent's returns by mirroring scenario.ts:199-236 (Pattern 2): union of dates ≥ include-from, zero-fill. ⚠️ Use the SAME include-from resolution: `state.startDates[id] ?? s.start_date ?? "2022-01-01"` (scenario.ts:195).
3. **Normalize weights** over the active set: `wᵢ = weights[id] / Σ weights` (scenario.ts:177-182). The engine renormalizes internally; the panel must use the SAME normalized weights for DR/PCR.
4. Extract `portfolioDailyReturns = scenarioMetrics.portfolio_daily_returns.map(p => p.value)`.
5. Build the `constituents` prop: `{ ids, returnsById, weights (normalized), portfolioDailyReturns, correlationMatrix, n }` + `strategyNames` (passed separately or inside).

**Recommendation:** Do the re-alignment + weight-normalization in the COMPOSER (a memo keyed on `deAliased`), so `diversification.ts` receives clean aligned arrays and stays a pure number-cruncher (easier to golden-test). Alternatively, factor the re-alignment into a small exported helper in `diversification.ts` (e.g. `alignConstituentReturns(strategies, state)`) that the composer calls — this keeps the alignment logic unit-testable in the lib. **Prefer the helper-in-lib approach** so the byte-for-byte-mirror-of-scenario.ts:199-236 is covered by golden tests (the alignment is the highest-risk piece).

⚠️ **The single biggest landmine:** if the re-alignment diverges from scenario.ts:199-236 (e.g. intersection instead of union, wrong include-from default, no zero-fill), σᵢ/Σ describe a different window than the engine's ρ, and DR/PCR silently lie. The §2 consistency golden test (rebuild ρ from the lib's cov+σ, assert == engine matrix) is the guard that catches this.

## §4 — CorrelationHeatmap Reuse

**Exact props (CorrelationHeatmap.tsx:7-31):**
```typescript
interface CorrelationHeatmapProps {
  correlationMatrix: Record<string, Record<string, number>> | null;
  strategyNames: Record<string, string>;
  overlappingDays?: number;        // → scenarioMetrics.n  (reason-routes <10 vs <2 empties)
  avgAbsCorrelation?: number | null; // → scenarioMetrics.avg_pairwise_correlation
}
```
- **Pass directly:** `correlationMatrix={REORDERED matrix}`, `strategyNames={strategyNames}`, `overlappingDays={scenarioMetrics.n}`, `avgAbsCorrelation={scenarioMetrics.avg_pairwise_correlation}`. ✅ Confirmed compatible — this is the EXACT call shape already in the composer at ScenarioComposer.tsx:2353-2358.
- **avg_pairwise_correlation IS emitted by the engine** (scenario.ts:431-432, sample-cov, abs-mean, 3-decimal). Do NOT compute it locally — pass the engine value (the heatmap NEVER computes its own average, CorrelationHeatmap.tsx:310-319). CORR-03's caption is single-sourced.
- **Empty-state routing is inherited** (CorrelationHeatmap.tsx:191-233): null matrix → engine-nulled/few-days/combined copy by `overlappingDays`; `ids.length < 2` → few-strategies. The panel does NOT add empty logic.
- **Missing cell → "—"** already handled (CorrelationHeatmap.tsx:283-302, `hasValue ? v.toFixed(2) : "—"`). CORR-03's per-cell "—" is free.

**Cluster reorder (CORR-06):** The heatmap renders axis/cell order from `Object.keys(correlationMatrix)` (CorrelationHeatmap.tsx:183) — there is **NO custom-order prop**. So the panel must **build a reordered matrix** before passing:
```typescript
// clusterOrderIds from diversification.ts; build a new Record with insertion order = cluster order
const reordered: Record<string, Record<string, number>> = {};
for (const r of clusterOrderIds) {
  reordered[r] = {};
  for (const c of clusterOrderIds) reordered[r][c] = correlationMatrix[r][c];
}
// strategyNames is keyed by id (order-independent) — pass unchanged.
```
**No prop must be added to `CorrelationHeatmap`** for the reorder or the "too similar" flag. The "too similar" flag (CORR-02) is rendered OUTSIDE the heatmap (a list/badges from `tooSimilarPairs`) — the heatmap's burnt-orange cells already visually flag high ρ; the explicit ≥0.85 callout is panel chrome, not a heatmap prop. **CorrelationHeatmap stays UNCHANGED** (zero edits) — important for not regressing its CI contrast sweep + the portfolio-detail + scenario-share consumers.

## §5 — Degenerate / Honest Empties

| Scenario | Engine output | diversification.ts returns | Panel renders |
|----------|---------------|----------------------------|---------------|
| 0 constituents | `correlation_matrix: null`, n=0 (scenario.ts:157-174) | global gate → all-null, `clusterOrderIds: []` | CorrelationHeatmap empty: "add 2 strategies" (few-strategies branch); no DR/ENB/PCR. |
| 1 constituent | `{id:{id:1}}` 1×1, n≥10 | global gate (ids.length<2) → all-null, `clusterOrderIds:[id]` | Heatmap `ids.length<2` → "Not enough strategies" empty (CorrelationHeatmap.tsx:219-226); no headline. |
| n<10 overlapping | `correlation_matrix: null`, n<10 (scenario.ts:210-227) | global gate (matrix null) → all-null | Heatmap null+overlappingDays<10 → "Not enough overlap" empty. |
| Zero-variance constituent (flat returns) | matrix cell ρ→0 (engine `std>0 ? … : 0`, scenario.ts:421-422) — engine emits 0 not null for a flat leg | σᵢ=0 for that leg; cov row 0; PCRᵢ=0; DR numerator unaffected (wᵢ·0) | Heatmap shows the engine's value (0.00 for the flat leg's off-diagonals). PCR list shows 0% for that leg. ⚠️ NOTE: the engine emits **0** for a flat-leg correlation (scenario.ts:422 `: 0`), NOT null — so the cell shows "0.00", not "—". The "—" path triggers only when a cell is genuinely ABSENT from the matrix object (CorrelationHeatmap.tsx:274 `?? null`). This is a known engine convention; document it (CONTEXT: "Any genuinely-missing cell renders —"). |
| Non-finite returns / leverage wipeout | `correlation_matrix: null`, n≥10 (scenario.ts:312-329) | global gate (matrix null) → all-null | Heatmap null+overlappingDays≥10 → "Correlation unavailable for this scenario" (non-finite/wipeout copy, CorrelationHeatmap.tsx:207-218). |
| σ_p = 0 (all-flat blend) | matrix may be present | DR → null, PCR → null (wᵀΣw≤0), ENB → null | Headline shows "—"; heatmap may still render. |

**Confirmation:** No NaN/Inf reaches the UI. Every diversification.ts function has an explicit degenerate→null guard. The DR/ENB/PCR null values render as "—" via the panel's `formatNumber`/`??"—"` (same pattern as the engine's null KPIs). The global gate (ids.length<2 OR n<10 OR matrix null) short-circuits before any division. The two division-by-zero risks (σ_p=0 in DR, wᵀΣw=0 in PCR) are both guarded with explicit `<= 0` / `<= epsilon` checks returning null.

## Common Pitfalls

### Pitfall 1: Re-alignment drift breaks DR-vs-matrix consistency
**What goes wrong:** The panel re-aligns per-constituent returns differently than scenario.ts:199-236 (intersection vs union, missing zero-fill, wrong include-from default) → σᵢ/Σ describe a different window than the engine's ρ → DR/PCR silently lie.
**Why it happens:** The aligned series aren't emitted; you must reconstruct them and it's easy to "improve" the alignment.
**How to avoid:** Mirror scenario.ts:199-236 byte-for-byte (same union-of-dates, same `state.startDates[id] ?? s.start_date ?? "2022-01-01"`, same zero-fill). Golden-test the consistency: rebuild ρ from your cov+σ, assert == engine `correlation_matrix` to 3 decimals.
**Warning signs:** DR < 1 (impossible for long-only un-correlated); the rebuilt-ρ test fails; PCR doesn't sum to 1.

### Pitfall 2: Sample-vs-population convention bleed
**What goes wrong:** Using `stdDev(x, false)` (population) or `compute.ts`'s pstdev → σᵢσⱼ ≠ the engine's ρ denominator → headline desyncs from grid.
**Why it happens:** The factsheet body (rightly) uses population std; copying that into the same file feels consistent but is wrong for THIS surface.
**How to avoid:** SAMPLE everywhere in diversification.ts. `stdDev` defaults to `sample=true`; never pass `false`. §2 golden pin.
**Warning signs:** rebuilt-ρ ≠ engine matrix by a (n−1)/n factor.

### Pitfall 3: Degenerate covariance explodes PCR
**What goes wrong:** `wᵀΣw → 0` (all-flat or perfectly-offsetting blend) → PCRᵢ = wᵢ(Σw)ᵢ/0 = ±Inf/NaN into the UI.
**Why it happens:** No guard on the portfolio-variance denominator.
**How to avoid:** `if (portVar <= 1e-15) return null;` before dividing. Return null → UI "—".
**Warning signs:** PCR cells show "Infinity"/"NaN"; ENB explodes.

### Pitfall 4: Leverage applied to per-constituent series
**What goes wrong:** Levering σᵢ/Σ → matrix consistency breaks (engine's matrix is un-levered).
**Why it happens:** The composer holds `leverage` in `deAliased.state`; tempting to apply it.
**How to avoid:** Build `returnsById` from RAW (un-levered) `daily_returns`, exactly as the engine builds `strategyReturns` (scenario.ts:233-235, no `lev()` factor). Only `portfolio_daily_returns` (σ_p) is levered — that's the intended Choueifaty asymmetry.
**Warning signs:** rebuilt-ρ ≠ engine matrix; DR changes when you move a leverage slider (it shouldn't — correlation is leverage-invariant, ScenarioComposer.tsx:2204).

### Pitfall 5: Adding a custom-order prop to CorrelationHeatmap
**What goes wrong:** Editing CorrelationHeatmap to accept a cluster order → risks its CI contrast sweep + the 2 other consumers (portfolio-detail, scenario-share).
**Why it happens:** It seems like the natural place for reorder.
**How to avoid:** Reorder the matrix+labels in the PANEL before passing; leave CorrelationHeatmap untouched (zero edits).
**Warning signs:** `git diff` touches CorrelationHeatmap.tsx; portfolio-detail/scenario-share tests change.

## Code Examples

### DR + ENB + PCR (the core)
```typescript
// Source: derived from CONTEXT formulas + scenario.ts convention pins
export function diversificationRatio(
  weights: Record<string, number>, vols: Record<string, number>, sigmaP: number,
): number | null {
  if (!(sigmaP > 0)) return null;                // σ_p=0 → "—"
  let weightedSigma = 0;
  for (const id of Object.keys(weights)) weightedSigma += weights[id] * (vols[id] ?? 0);
  return weightedSigma / sigmaP;                 // Choueifaty DR (≥1)
}

export function percentContributionToRisk(
  ids: string[], weights: Record<string, number>, cov: number[][],
): Record<string, number> | null {
  // (Σw)ᵢ = Σⱼ cov[i][j]·wⱼ ; portVar = wᵀΣw ; PCRᵢ = wᵢ(Σw)ᵢ/portVar
  const w = ids.map(id => weights[id] ?? 0);
  const sigmaW = ids.map((_, i) => w.reduce((acc, wj, j) => acc + cov[i][j] * wj, 0));
  const portVar = w.reduce((acc, wi, i) => acc + wi * sigmaW[i], 0);
  if (!(portVar > 1e-15)) return null;           // degenerate → "—" (no NaN/Inf)
  const out: Record<string, number> = {};
  ids.forEach((id, i) => { out[id] = (w[i] * sigmaW[i]) / portVar; }); // Σ = 1
  return out;
}

export function effectiveNumberOfBets(pcr: Record<string, number> | null): number | null {
  if (!pcr) return null;
  const denom = Object.values(pcr).reduce((a, p) => a + p * p, 0);
  return denom > 0 ? 1 / denom : null;           // 1/Σpcrᵢ²  (RISK-based, Meucci)
}
```

### Average-linkage cluster order
```typescript
// Source: Pattern 3 spec. distance = ½(1−ρ), missing ρ → 1 (max distance).
export function clusterOrder(
  corr: Record<string, Record<string, number>> | null, ids: string[],
): string[] {
  if (!corr || ids.length <= 2) return [...ids];            // identity for n≤2
  const D = ids.map(a => ids.map(b => {
    const r = corr[a]?.[b];
    return (r == null || !Number.isFinite(r)) ? 1 : 0.5 * (1 - r);
  }));
  let clusters = ids.map((_, i) => ({ leaves: [ids[i]], members: [i] }));
  while (clusters.length > 1) {
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        let sum = 0, cnt = 0;
        for (const a of clusters[i].members) for (const b of clusters[j].members) { sum += D[a][b]; cnt++; }
        const avg = sum / cnt;                               // AVERAGE linkage
        if (avg < best) { best = avg; bi = i; bj = j; }
      }
    const merged = {
      leaves: [...clusters[bi].leaves, ...clusters[bj].leaves],
      members: [...clusters[bi].members, ...clusters[bj].members],
    };
    clusters = clusters.filter((_, k) => k !== bi && k !== bj);
    clusters.push(merged);
  }
  return clusters[0].leaves;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Naive ENB = 1/Σwᵢ² (weight HHI) | Risk-based ENB = 1/Σ PCRᵢ² (correlation-aware, Meucci) | CONTEXT lock | Counts INDEPENDENT bets, not just unequal weights — a 2-leg book of perfectly-correlated strategies has ENB≈1 (honest), naive HHI would say ENB=2 (lie). |
| Inline Pearson per surface | Single frozen-engine `correlation_matrix` | scenario.ts (existing) | One source of ρ; panel reads it. |

**Deprecated/outdated:** None. This is additive on a mature, frozen engine.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | DR numerator uses UN-levered σᵢ, denominator uses LEVERED σ_p (Choueifaty asymmetry) | §1 DR, Pattern 2 | If the planner/user wants both levered, DR would be ~1.0 always (leverage scales both). The un-levered/levered split is the standard Choueifaty form AND matches the leverage-invariant matrix. LOW risk — well-grounded, but flag for confirmation since it's a modeling choice. |
| A2 | σ daily (not annualized) is fine for DR since ×√252 cancels | §1 σ | If the panel SHOWS annualized σᵢ in the disclosure, annualize consistently. Cosmetic; ratio unchanged. |
| A3 | Negative PCR (hedges) kept signed, not clamped | §1 PCR | If product wants clamped-to-0 display, the sum-to-1 invariant breaks. Keeping signed is the honest/correct choice; flag for UX confirmation on display. |

**If this table is empty:** it is not — 3 modeling choices flagged for confirmation (all LOW risk, all defensible defaults). None block planning; the planner can lock A1/A3 via discuss or accept the defaults.

## Open Questions (RESOLVED)

1. **Where to put the re-alignment helper — composer memo or `diversification.ts`?**
   - What we know: both work; the lib-helper version is golden-testable (highest-risk piece).
   - What's unclear: nothing blocking.
   - Recommendation: factor `alignConstituentReturns(strategies, state)` into `diversification.ts` (exported, golden-tested mirroring scenario.ts:199-236); the composer calls it inside a memo keyed on `deAliased`.

2. **Does the panel need its own `persist`/`storageKey` discipline?**
   - What we know: `CollapsibleSection` accepts an optional `storageKey` (persisted via cross-tab). Phase 38's RT2 lesson (MEMORY): the scenario mount is `persist={false}` to avoid cross-tab bleed via the shared `/allocations` URL.
   - Recommendation: give the new `CollapsibleSection` NO `storageKey` (so it never touches localStorage) OR a scenario-scoped key NOT shared with the real factsheet — to avoid the Phase-38 RT2 class. Default: omit `storageKey` (open/closed is ephemeral, matching the scenario's persist=false ethos). Plan should verify (GUARD-04 is Phase 43, but don't introduce the bug here).

## Environment Availability

> SKIPPED — no external dependencies. Pure-TS + React in an existing workspace. No tools, services, runtimes, or CLIs beyond the project's own (Node/vitest already present). Step 2.6: SKIPPED (no external dependencies identified).

## Validation Architecture

> nyquist_validation: **true** (config.json) → section INCLUDED.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (+ @testing-library/react, jsdom) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run src/lib/diversification.test.ts` |
| Full suite command | `npm test` (`vitest run`) — ⚠️ local CPU-contention flakes are known (MEMORY); `npx vitest run --no-file-parallelism` restores green locally. CI sharded is reliable. |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CORR-01 | Matrix renders from engine `correlation_matrix` in the panel | integration (RTL) | `npx vitest run src/app/.../ScenarioFactsheetChart.test.tsx -t "correlation matrix"` | ❌ Wave 0 (new panel test) |
| CORR-02 | ρ≥0.85 pairs flagged; DR/ENB headline shown | unit + integration | `npx vitest run src/lib/diversification.test.ts -t "tooSimilar\|diversificationRatio\|effectiveNumberOfBets"` | ❌ Wave 0 |
| CORR-03 | 0/1-constituent + n<10 → honest empty; missing cell → "—" | integration | `npx vitest run src/app/.../ScenarioFactsheetChart.test.tsx -t "empty"` | ❌ Wave 0 (CorrelationHeatmap.test.tsx already covers heatmap empties) |
| CORR-04 | De-aliased labels (not UUIDs) | integration | `npx vitest run src/app/.../ScenarioComposer.test.tsx -t "CORR-01.*de-aliased"` | ✅ exists (3499) |
| CORR-05 | PCR per-constituent sums to 1, hand-verified | unit | `npx vitest run src/lib/diversification.test.ts -t "percentContributionToRisk"` | ❌ Wave 0 |
| CORR-06 | Cluster order groups correlated leg adjacency (hand-verified 3-leg) | unit | `npx vitest run src/lib/diversification.test.ts -t "clusterOrder"` | ❌ Wave 0 |
| (consistency pin) | rebuilt-ρ from lib cov+σ == engine matrix (3dp) | unit | `npx vitest run src/lib/diversification.test.ts -t "consistency\|matches engine"` | ❌ Wave 0 (the §2 landmine guard) |
| (wiring) | composer passes `constituents` prop to ScenarioFactsheetChart | unit (mock spy) | `npx vitest run src/app/.../ScenarioComposer.test.tsx -t "constituents"` | ❌ Wave 0 (extend existing mock at test:94) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/diversification.test.ts` (the golden math — <2s).
- **Per wave merge:** `npx vitest run src/lib/diversification.test.ts src/app/\(dashboard\)/allocations` (math + wiring).
- **Phase gate:** `npm run test:coverage` green (ratchet: lines 82 / functions 74 / branches 72 — CLAUDE.md) before `/gsd:verify-work`. The new pure-TS lib with golden tests should LIFT coverage (high-density branch coverage on a small file).

### Wave 0 Gaps
- [ ] `src/lib/diversification.test.ts` — golden tests for cov/σ/DR/PCR/ENB/cluster-order + the consistency pin. **Hand-computed fixture:** 3 constituents, 3 daily returns each, with KNOWN pairwise ρ (e.g. legs A,B strongly correlated, C orthogonal) so cluster order ([A,B,C] or [C,A,B]), PCR (sums to 1), DR (>1), ENB (∈[1,3]) are all hand-verifiable.
- [ ] `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.test.tsx` — panel render test (matrix present, headline present, empty routing). Check if this file exists; if not, create it.
- [ ] `ScenarioComposer.test.tsx` — extend the existing `ScenarioFactsheetChart` mock (test:94) to spy the new `constituents` prop; assert the composer builds + passes it.
- [ ] No framework install needed (Vitest present).

### Existing tests that MUST stay green
- `src/lib/scenario.test.ts` — ALL pins (correlation_matrix sample-cov, avg_pairwise abs, null gates, Sortino, leverage). **The engine is FROZEN — do not edit scenario.ts.** (scenario.test.ts:180-181, 372-394, 646+).
- `src/components/portfolio/CorrelationHeatmap.test.tsx` — contrast sweep + empty routing (CorrelationHeatmap stays UNCHANGED → these can't regress).
- `ScenarioComposer.test.tsx:3377` — the "no FactsheetBody import in composer" static guard. ⚠️ The `constituents`-building code in the composer MUST NOT import `FactsheetBody`/`MetricsColumn`/payload-builder or contain `ingestSource: "api"` — the panel mount stays in `ScenarioFactsheetChart.tsx` only.
- `ScenarioComposer.test.tsx:3499` (CORR-01 de-aliased labels) — still passes (the existing own-book heatmap at composer:2353 is unaffected; or if the plan moves it into the panel, re-point this test).
- The scenario-share + portfolio-detail CorrelationHeatmap consumers (page.test.tsx) — unchanged (heatmap untouched).

## Security Domain

> `security_enforcement` absent in config → treated as enabled. This phase is 100% client-tier pure-math + presentational React with NO auth, NO network, NO storage writes (the CollapsibleSection's optional storageKey is recommended OMITTED — Open Q2), NO user input parsing (inputs are engine-produced numbers), NO database, NO secrets. The ASVS surface is therefore minimal.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface. |
| V3 Session Management | no | No session surface. |
| V4 Access Control | no | Renders only data the composer already holds (allocator's own blend, RLS-gated upstream). |
| V5 Input Validation | minimal | Inputs are engine-produced `number[]` / matrices — not user strings. Defensive: every function guards non-finite → null (no NaN/Inf to UI). |
| V6 Cryptography | no | No crypto. |

### Known Threat Patterns for {client pure-TS math}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| NaN/Inf rendered as "metrics" (information integrity) | Tampering (data-integrity) | Explicit degenerate→null guards in every diversification.ts function; the §5 honest-empty map; the engine's existing non-finite gate upstream. |
| Cross-tab state bleed via shared `/allocations` URL (Phase-38 RT2 class) | Tampering | Omit `storageKey` on the new CollapsibleSection (Open Q2); persist=false ethos. |
| Fabricated correlation presented as real (honesty) | Repudiation/integrity | Never recompute ρ; read frozen engine matrix; "—" on genuinely-missing cells; global-n gate; disclose the ENB/DR formulas. |

## Sources

### Primary (HIGH confidence)
- `src/lib/scenario.ts` (FROZEN engine) — read in full. Key lines: correlation_matrix sample-cov 401-432; aligned `strategyReturns` (NOT emitted) 229-236; commonDates union 199-208; n<10 null gate 210-227; non-finite gate 302-329; portfolio σ sample-std 336-340; leverage asymmetry 69-82,251.
- `src/lib/scenario-dealias.ts` — `collapseAliasedHoldingStrategies` output shape (60-167): `deAliased.strategies` carry RAW daily_returns; `deAliased.state` {selected,weights,startDates,leverage?}.
- `src/lib/portfolio-math-utils.ts` — `mean`(64), `stdDev`(74, sample default).
- `src/lib/correlation-math.ts` — `pearson`(17, null on zero-variance).
- `src/components/portfolio/CorrelationHeatmap.tsx` — props(7-31), empty routing(191-233), missing-cell "—"(283-302), avg caption single-source(310-319), order from Object.keys(183).
- `src/components/ui/CollapsibleSection.tsx` — props + optional storageKey persist(33-90).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — projectionState(1438-1486), deAliased(1494-1502), scenarioMetrics(1507-1510), strategyNames(1531-1535), existing heatmap mount(2353-2358), leverage caveat(2198-2209), ScenarioFactsheetChart mount(2224-2229).
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` — the seam: props(64-92), FactsheetBody mount(150-209). THE place to add the `constituents` prop + panel.
- `src/lib/scenario-blend-panels.ts` — the PATTERN PRECEDENT (pure-TS engine-output adapter, sample-std reuse, MIN_USABLE floor, degenerate→empty, golden tests).
- `src/lib/factsheet/compute.ts` — POPULATION std convention(8,36) — the OTHER convention, NOT used here.
- `.planning/REQUIREMENTS.md` (CORR-01..06, Out-of-Scope convention lock:73), `.planning/phases/41-…/41-CONTEXT.md` (all locks).
- `package.json` — verified ZERO clustering/linalg deps (39 total); test scripts.
- `.planning/config.json` — nyquist_validation:true.

### Secondary (MEDIUM confidence)
- `ScenarioComposer.test.tsx` — mock pattern for ScenarioFactsheetChart(94), prop-spy pattern(552-668), existing CORR-01 test(3499), static guard(3377).
- `CLAUDE.md` — coverage ratchet (lines 82/functions 74/branches 72, blocking CI gate).

### Tertiary (LOW confidence)
- None. All claims verified against repo source.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — verified no new dep needed/wanted (package.json scanned); all reused modules read in full.
- Architecture: HIGH — the seam (ScenarioFactsheetChart), the data source (engine matrix + de-aliased set), the re-alignment requirement, and the convention split are all confirmed against source lines.
- Math contract: HIGH — formulas from CONTEXT + engine convention pins; the one modeling choice (DR levered-denominator asymmetry) flagged in Assumptions Log A1.
- Pitfalls: HIGH — the re-alignment-drift and sample-vs-population landmines are confirmed against scenario.ts vs compute.ts source.

**Research date:** 2026-06-26
**Valid until:** 2026-07-26 (stable — frozen engine, mature reused components; the only change risk is a parallel agent touching ScenarioComposer/ScenarioFactsheetChart — re-check `git diff` on those two files before implementing).

## RESEARCH COMPLETE

Phase 41 adds one NEW pure-TS file (`src/lib/diversification.ts`: client-side SAMPLE-convention covariance, per-constituent σ, Choueifaty Diversification Ratio, risk-based Effective-Number-of-Bets, percent-contribution-to-risk, hand-rolled average-linkage cluster order, and a ρ≥0.85 "too similar" flag — NO new dependency, none exists or is wanted) plus a factsheet-shaped `CollapsibleSection` rendered inside `ScenarioFactsheetChart.tsx` and fed by a new additive `constituents` prop threaded from `ScenarioComposer`. The frozen `scenario.ts` engine is read-only for `correlation_matrix` + `portfolio_daily_returns` + `n`; its aligned per-constituent series (the inputs the matrix was built from) are computed internally (scenario.ts:229-236) but NOT emitted, so the composer MUST re-align them by mirroring scenario.ts:199-236 byte-for-byte — the single biggest landmine, guarded by a consistency golden test that rebuilds ρ from the lib's own cov+σ and asserts equality with the engine matrix. The second landmine is convention: the displayed matrix is SAMPLE (÷(n−1)), so DR/PCR/σ must be SAMPLE too — NOT the factsheet body's deliberately-coexisting POPULATION convention. The reused `CorrelationHeatmap` stays UNCHANGED (reorder the matrix+labels before passing; it has no custom-order prop); all empty-state routing and the "—" missing-cell and single-sourced Avg|ρ| are inherited for free. Every degenerate path (0/1 constituent, n<10, σ_p=0, wᵀΣw→0, non-finite) returns null → "—", so no NaN/Inf reaches the UI. Validation is golden unit tests on the pure lib (hand-computed 3-constituent fixture) + RTL wiring tests, with the engine's frozen scenario.test.ts pins and the heatmap's CI contrast sweep kept green.
