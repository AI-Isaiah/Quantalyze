# Phase 108: Scenario-planner onto the backbone - Research

**Researched:** 2026-07-15
**Domain:** Frontend TS analytics refactor — routing the scenario-planner/blend panels off a duplicate "second-Sharpe" TS compute (`scenario-blend-panels.ts`) onto the ONE backbone (`deriveSeriesBundle`), mirroring the Phase-107 leverage-as-a-dailies-transform precedent.
**Confidence:** HIGH (every claim below grep/read-verified against source at cited file:line; no external deps, no version research needed).

## Summary

Phase 108 is the scenario-planner analogue of Phase 107. It deletes `src/lib/scenario-blend-panels.ts` (211 LOC, verified `wc -l`), the one real duplicate TS Sharpe/vol/Sortino annualization compute, and has the scenario-planner blend panels (returns histogram, quantiles, rolling Sharpe/vol/Sortino) flow from the shared backbone instead. The blend's canonical input already exists: `computeScenario` emits `portfolio_daily_returns` (full-resolution, unrounded daily-return form) at `scenario.ts:440-443`, and Phase 107 just exported `deriveSeriesBundle` from `build-payload.ts:186`. The scenario engine (`scenario.ts`) is byte-frozen by 107 and must stay so — this phase touches only the *panel derivation* layer in `ScenarioComposer.tsx`, not the blend math.

The one consumer of `buildBlendPanels` is `ScenarioComposer.tsx` (import at :102, single call at :2818-2823). Deleting the module is mechanically small, but routing onto `deriveSeriesBundle` is **not a drop-in** — it surfaces four concrete seams the planner must resolve: (1) a **sample-std → population-std** value shift, (2) a **user-selectable 3M/6M/12M rolling window** the bundle does not natively support, (3) a **quantiles shape/point mismatch**, and (4) a bespoke **`usableN` degenerate gate** the bundle has no equivalent for. An existing sibling adapter, `scenario-factsheet-payload.ts`, already routes the scenario *chart* onto backbone primitives (`compute` + `worstDrawdowns`) and is the established pattern for "synthesize a minimal payload off `portfolio_daily_returns`."

**Primary recommendation:** Delete `scenario-blend-panels.ts` + its test, and replace the `buildBlendPanels` call in `ScenarioComposer.tsx` with a thin backbone-fed derivation (either `deriveSeriesBundle` per 107, or the backbone's own rolling/quantile/equity primitives — decide in discuss-phase). Treat the sample→population std shift and the 3M/6M/12M window support as the two load-bearing discuss-phase decisions; both bear directly on SC-4 ("no user-visible regression within parity tolerance"). Keep `metrics-parity.test.ts`, `portfolio-stats.ts`, and `health-score.ts` untouched.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Scenario blend math (weights, leverage, correlation, TWR/CAGR) | Frontend Client (`scenario.ts::computeScenario`) | — | Byte-frozen by 107; client-side what-if engine, no backend. Produces canonical `portfolio_daily_returns`. |
| Blend panel derivation (histogram/quantiles/rolling) | Frontend Client (backbone: `build-payload.ts::deriveSeriesBundle`) | — | The refactor target — must move here from the duplicate `scenario-blend-panels.ts`. |
| Panel rendering (charts) | Browser/Client (`ReturnHistogram`/`ReturnQuantiles`/`RollingMetrics`) | — | Props-only leaf charts; unchanged. |
| Backbone rolling primitives | Frontend Client (`factsheet/rolling.ts`, `factsheet/compute.ts`) | — | The population-std source of truth the blend must adopt. |

All tiers are client-side TS — this is a pure frontend refactor. No API/DB/CDN involvement. No tier misassignment risk.

## Standard Stack

No new packages. This is a deletion + rewire within the existing frontend. Relevant existing modules:

| Module | Role | Anchor |
|--------|------|--------|
| `src/lib/scenario.ts` | Blend engine; produces `portfolio_daily_returns` (canonical daily-return series) | `scenario.ts:440-443` (the field), `:183` (type decl). BYTE-FROZEN. |
| `src/lib/factsheet/build-payload.ts` | The backbone. `deriveSeriesBundle` (now exported by 107) is the shared per-basis derivation | `build-payload.ts:186` (export), consumed by 107 at `basis-context.tsx:223` |
| `src/lib/factsheet/rolling.ts` | Backbone rolling primitives (`rollingVol`/`rollingSharpe`/`rollingSortino`) — **population std** | `rolling.ts:85-137`, `pstdev` at `:145-150` |
| `src/lib/factsheet/compute.ts` | `compute`/`cumEq`/`worstDrawdowns` — headline scalars + equity | imported by `scenario-factsheet-payload.ts` |
| `src/lib/factsheet/quantiles.ts` | `quantileSummary` → `{p05,p25,p50,p75,p95,min,max,mean}` | `quantiles.ts:3-27` |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` | **Existing** scenario→backbone adapter (chart path); precedent for synthesizing a payload off `portfolio_daily_returns` | `:403` (`buildScenarioFactsheetPayload`) |

**Installation:** none. **Version verification:** N/A (no dependency changes). Vitest `^4.1.2`, TypeScript `^6` confirmed in `package.json:69-70`.

## Package Legitimacy Audit

Not applicable — Phase 108 installs no external packages. It deletes one module and rewires one consumer to existing in-repo backbone modules.

## Architecture Patterns

### System Data Flow (target state)

```
computeScenario(strategies, state, cache, blendBasis)   [scenario.ts — FROZEN]
        │
        ▼  emits
  portfolio_daily_returns : {date, value}[]   (full-res, unrounded, daily-return form)
        │
        │   ── TODAY ──────────────► buildBlendPanels(portfolioDaily, rollingWindow, blendBasis)   [scenario-blend-panels.ts — DELETE]
        │                                    │  sample-std rolling + positional quantiles + usableN
        │                                    ▼
        │                            { histogramSeries, quantiles, rollingSharpe, rollingVol, rollingSortino, usableN }
        │
        └── TARGET ─────────────────► deriveSeriesBundle(portfolioDaily, {periodsPerYear: blendBasis, isArithmetic:false, markets, strategyName})
                                             │  population-std rolling + quantileSummary + cumEq equity   [build-payload.ts:186]
                                             ▼  + ADAPTER (reshape number[]→{date,value}[], usableN gate, quantiles map, window)
                                     panels consumed by ReturnHistogram / ReturnQuantiles / RollingMetrics
                                             │
                                             ▼
                        ScenarioComposer.tsx blend-returns-distribution + blend-rolling Cards
```

### Pattern 1: Dailies-transform → shared re-derive (the 107 precedent)
**What:** Take a daily-return series, feed it to `deriveSeriesBundle`, read every derived panel off the returned bundle. Never maintain a parallel compute.
**When to use:** Any surface that needs Sharpe/vol/Sortino/equity/quantiles from a return series.
**Source:** `src/app/factsheet/[id]/v2/basis-context.tsx:223` (107 shipped) — `const lb = deriveSeriesBundle(levered, {...})`.
```typescript
// 107 precedent (basis-context.tsx) — lever the dailies, re-derive the whole bundle
const lb = deriveSeriesBundle(levered, {
  periodsPerYear, isArithmetic, markets, strategyName,
  // comparatorAnnVol OMITTED → bundle vol-matches its own vol (honest)
  missingSegments: base.missingSegments,
});
```

### Pattern 2: Synthesize-a-minimal-payload (the existing scenario chart adapter)
**What:** For a hypothetical blend with no real strategy identity, build a minimal VALID payload off `portfolio_daily_returns` using backbone helpers, single canonical `dates[]` axis.
**Source:** `scenario-factsheet-payload.ts:1-60` header + `:403`. Already uses `compute` + `worstDrawdowns` (population-std backbone), already pins population std in its test (`scenario-factsheet-payload.test.ts:212`, PAYLOAD-03). This is the closest live precedent to what 108 must do for the blend panels.

### Anti-Patterns to Avoid
- **Touching `scenario.ts`:** it is byte-frozen by 107 (SC-5 grep-gate is live). The blend math and `portfolio_daily_returns` shape are fixed inputs. Do not re-plumb the engine.
- **Re-deriving the full heavy bundle 3× for the window toggle:** `deriveSeriesBundle` computes benchmarks (BTC/ETH/SPX/GLD/IEF alignment), correlations, correlationMatrix, monthlyReturns, dailyHeatmap, streaks, calmarByYear, `bootstrapCI` (2000 resamples), styleDrift, stressWindows — none of which the 5 blend panels need. 107 measured `deriveSeriesBundle` at **median 235ms** on a 3000-day series (STATE.md, 107-03). Calling it per 3M/6M/12M toggle press would be visibly janky.
- **Silently changing numbers without a re-derived parity pin:** the sample→population shift is a real value change; it must be a deliberate, pinned decision (CLAUDE.md Rule 9), not a blind update.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Rolling Sharpe/vol/Sortino | A second annualization impl (this is exactly what `scenario-blend-panels.ts` IS) | `factsheet/rolling.ts::rollingVol/rollingSharpe/rollingSortino` (accept explicit `window` + `periodsPerYear`) | The whole point of the phase — one backbone, not two. These primitives already take an arbitrary `window` arg (`rolling.ts:87`), so the 3M/6M/12M toggle can call them directly. |
| Cumulative-wealth equity for the histogram | Bespoke cumprod loop | `factsheet/compute.ts::cumEq` (or `deriveSeriesBundle.strategyEquity`) | Same geometric wealth series; backbone-consistent. |
| Quantiles | Positional 5-number `{All:[...]}` re-impl | `factsheet/quantiles.ts::quantileSummary` (reshape at the seam) | Backbone quantile source; note shape/point mismatch (Pitfall 3). |

**Key insight:** `scenario-blend-panels.ts` is itself the hand-rolled duplicate the backbone program exists to eliminate. Its own header (`:17-27`) admits it "REUSES the same `mean`/`stdDev`" and "mirrors `portfolio-stats.ts::computeRollingMetric`" and "mirrors the frozen engine (`scenario.ts:354-361`)" — i.e. it is three parallel copies pinned by convention. The fix is to stop copying.

## Delete-list vs Keep-list (file:line anchors, verified)

### DELETE
| Item | Anchor | LOC | Notes |
|------|--------|-----|-------|
| `src/lib/scenario-blend-panels.ts` | whole file | **211** (`wc -l`) | Exports `buildBlendPanels()` + `interface BlendPanelSeries`. The one real "second-Sharpe" TS compute. |
| `src/lib/scenario-blend-panels.test.ts` | whole file | 251 | Dies with the module (`import { buildBlendPanels } from "./scenario-blend-panels"` at `:6`). Its convention pins (sample-std, engine-mirror Sortino, degenerate collapse) are superseded by the backbone. |

### KEEP (verified out of scope — do NOT touch)
| Item | Anchor | LOC | Why it stays |
|------|--------|-----|--------------|
| `src/__tests__/metrics-parity.test.ts` | whole file | 427 | Guards the Python↔TS backbone identity (schema gate + independent math oracle over golden fixtures). Does NOT import `scenario-blend-panels` — deleting the module cannot touch it. MORE load-bearing after the reorg. |
| `src/lib/portfolio-stats.ts` | whole file | 634 | Tier-4/Tier-5 residual (BYPASS-INVENTORY `:35`). Consumed by 6+ live modules: `scenario-benchmark.ts`, `scenario-stress.ts`, `RegimeDetector.tsx`, `AlphaBetaDecomposition.tsx`, `VarExpectedShortfall.tsx`, `RiskDecomposition.tsx`, `HealthScore.tsx` (verified grep). `buildBlendPanels` only *mirrors* its `computeRollingMetric`; deleting the mirror does not affect `portfolio-stats.ts`. |
| `src/lib/health-score.ts` | whole file | 190 | Tier-5 residual. Consumed by `HealthScore.tsx`. Out of scope. |
| `src/lib/scenario.ts` | whole file | 803 | The blend engine. BYTE-FROZEN by 107 (its `lev()` at `:427` is the leverage precedent). Provides `portfolio_daily_returns`. |

BYPASS-INVENTORY `:54` states verbatim: "`scenario-blend-panels.ts` (~211 LOC) — the ONE real 'second Sharpe' TS compute — DEAD iff `deriveSeriesBundle` emits the blend panels. `portfolio-stats.ts`/`health-score.ts` STILL-LIVE; `metrics-parity.test.ts` KEEP."

## Common Pitfalls

### Pitfall 1: Sample-std → population-std is a real value shift (the parity crux)
**What goes wrong:** `scenario-blend-panels.ts` computes rolling vol/Sharpe/Sortino with **SAMPLE** std (`stdDev(slice, true)` = ÷ n−1, `scenario-blend-panels.ts:80,101,121`). The backbone's `factsheet/rolling.ts` uses **POPULATION** std (`pstdev` = ÷ n, `rolling.ts:145-150`). Routing the blend panels onto the backbone therefore shifts every rolling number (differs at the 3rd–4th significant figure). `scenario-factsheet-payload.test.ts:207-222` (PAYLOAD-03) already documents this exact tension and pins the population value at 6 decimals — proving a sample-std bleed fails loudly.
**Why it happens:** the two subsystems were written with different ddof conventions; the blend panels deliberately matched `portfolio-stats.ts` (sample), the factsheet backbone uses population.
**How to avoid:** make the shift a DELIBERATE, re-derived, pinned decision (like `scenario.ts:510-529`'s TWR-05 note). SC-4 says "within parity tolerance" — confirm in discuss-phase whether the sample→population shift IS within accepted tolerance (it is a genuine change, not float noise). The scenario factsheet chart path ALREADY uses population (via `compute`), so the blend panels moving to population makes the whole scenario surface internally consistent — a coherence argument for accepting it.
**Warning signs:** any parity test that pins a sample-std blend value; a reviewer asking "did the rolling Sharpe number move?"

### Pitfall 2: `deriveSeriesBundle` has a FIXED rolling window; the blend UI has a 3M/6M/12M toggle
**What goes wrong:** The blend rolling Card has a `SegmentedControl` (3M/6M/12M → 63/126/252-day windows, default 126) driven by `rollingWindow` state (`ScenarioComposer.tsx:1015`, `:4331-4340`); `buildBlendPanels(portfolioDaily, rollingWindow, blendBasis)` recomputes at the selected window. `deriveSeriesBundle` computes ONE window via `pickRollingWindow(stratRet.length)` (preferred 126, falls back to 30 — `build-payload.ts:203`, `rolling.ts:30-44`) and bakes it into the bundle. A naive route onto `deriveSeriesBundle` would LOSE the 3M/12M options (SC-4 "no user-visible regression").
**How to avoid:** Two viable shapes (discuss-phase): (a) keep the window-selectable adapter but have it call the backbone's `rollingVol/rollingSharpe/rollingSortino` primitives directly with the explicit `rollingWindow` (they accept it — `rolling.ts:87`) instead of the deleted sample-std copies; or (b) re-derive `deriveSeriesBundle` per window (expensive per Pitfall/anti-pattern above). Option (a) is lighter, preserves the toggle, and still eliminates the duplicate — arguably the truer reading of "flows from the backbone."
**Warning signs:** the 3M/12M segmented options disappear or become permanently disabled.

### Pitfall 3: Quantiles shape and points differ
**What goes wrong:** `buildBlendPanels` emits `quantiles: {All: [q0,q25,q50,q75,q100]}` — a positional 5-number summary where q0/q100 are min/max, keyed `Record<string, number[]>` exactly as `ReturnQuantiles` expects (`ReturnQuantiles.tsx:12-14`). The backbone's `quantileSummary` returns `{p05,p25,p50,p75,p95,min,max,mean}` (`quantiles.ts:19-27`) — a different SHAPE and different tail points (p05/p95 vs min/max). Feeding `quantileSummary` output straight to `ReturnQuantiles` would not typecheck and would change the whiskers (5th/95th percentile vs absolute min/max).
**How to avoid:** reshape at the seam — either build `{All:[min,p25,p50,p75,max]}` from `quantileSummary`, or keep a 3-line positional-quantile helper. Decide whether the box should show min/max (today) or p05/p95 (backbone) — a visible change either way.

### Pitfall 4: The bespoke `usableN` degenerate gate has no backbone equivalent
**What goes wrong:** `buildBlendPanels` returns `usableN` and collapses EVERY series to `[]/{}` on a STRICTER condition than a plain length check: `hasNonFinite || length < MIN_USABLE(10) || length < window` (`scenario-blend-panels.ts:154-176`), reporting `usableN: 0` when any non-finite value is present. The composer keys three UI behaviors off it: the distribution empty-branch (`ScenarioComposer.tsx:4282`), the SegmentedControl per-option disable (`:4338` `blendPanels.usableN < Number(w)`), and the rolling empty-branch (`:4342`). `deriveSeriesBundle` has no `usableN` and does not collapse on a non-finite point the same way.
**How to avoid:** reproduce the gate at the new seam. A dedicated test (`ScenarioComposer.test.tsx:3494`, WR-02) pins that a ≥10-length-but-below-window series shows the honest `role=status` banner — that behavior must survive. `computeScenario` already suppresses `portfolio_daily_returns → []` on its own degenerate early-returns (`scenario.ts:250,393,503`), so the non-finite case is partly pre-filtered upstream, but the length/window gate is panel-local.

### Pitfall 5: The static source-scan guard's positive control references `buildBlendPanels`
**What goes wrong:** `ScenarioComposer.test.tsx:3553` asserts `expect(source).toMatch(/buildBlendPanels/)` as a positive control (proving the on-disk read is real) inside the "no factsheet import on the blend path" guard. Once `buildBlendPanels` is removed from the composer source, this positive control FAILS.
**How to avoid:** re-anchor the positive control to a new real token in the rewired source (e.g. `deriveSeriesBundle`). NOTE the same guard forbids `FactsheetBody|MetricsColumn|buildAllocatorPortfolioFactsheetPayload` (`:3554`) — importing `deriveSeriesBundle` from `build-payload.ts` is NOT forbidden by that regex, so the backbone route does not trip the honesty guard. Confirm the guard's intent (no api-ingest/peer-rank panels on a what-if) still holds.

### Pitfall 6: `blendBasis`, arithmetic-vs-geometric, markets/name args
**What goes wrong:** `deriveSeriesBundle` needs `{periodsPerYear, isArithmetic, markets, strategyName}` (`build-payload.ts:186-196`). The blend already has `blendBasis` (√365 if any crypto leg else 252, `ScenarioComposer.tsx:2472`, same value fed to the engine and `buildBlendPanels`). The blend is **geometric** (`computeScenario` cumprods `1+r`, `scenario.ts:449-452`) → `isArithmetic: false`. But a hypothetical blend has NO natural `markets` or `strategyName` — must synthesize (e.g. `markets: []`, `strategyName: "Scenario blend"`), exactly as `scenario-factsheet-payload.ts` already does for the csv arm. Omit `comparatorAnnVol` so the derivation vol-matches its own vol (107 precedent, `basis-context.tsx` decision).
**How to avoid:** thread `blendBasis` as `periodsPerYear`, `isArithmetic:false`, synthesize markets/name. Confirm the blend is always geometric (it is — the engine has no arithmetic path; arithmetic is a composite-only flag in `build-payload.ts:381`).

## Runtime State Inventory

This is a rename/refactor-class phase (deletes a module, rewires a consumer), so the inventory applies. It is a **pure client-side TS refactor** — no server, DB, or OS state.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `scenario-blend-panels.ts` is a pure synchronous compute with "zero dependencies, no fetch / DOM / time" (its own header `:4`). No DB rows, no persisted keys reference it. | none |
| Live service config | None — no external service, cron, or worker references the module (grep-verified: only `src/` imports + comments). | none |
| OS-registered state | None — client TS; no scheduler/pm2/systemd entries. | none |
| Secrets/env vars | None — no env var gates this code path. | none |
| Build artifacts | Vitest coverage baseline shifts (one module + its 251-LOC test removed). CI coverage ratchet (lines 82 / stmts 80 / funcs 74 / branches 72, `vitest.config.ts`) must stay green after deletion. | verify `test:coverage` exit 0 post-delete |

**Canonical question — after every file is updated, what runtime systems still cache the old code?** None. The only "cache" concern is Vitest coverage numbers and the source-scan guards (Pitfall 5). No prod runtime state.

## Code Examples

### The single live consumer today (to be replaced)
```typescript
// ScenarioComposer.tsx:2814-2823 — the ONE call site
const portfolioDaily = useMemo(
  () => scenarioMetrics.portfolio_daily_returns ?? [],
  [scenarioMetrics.portfolio_daily_returns],
);
const blendPanels = useMemo(
  // BLEND-01 — same derived blend basis as the headline KPIs
  () => buildBlendPanels(portfolioDaily, rollingWindow, blendBasis),
  [portfolioDaily, rollingWindow, blendBasis],
);
```

### Backbone rolling primitives already accept an explicit window (enables the toggle)
```typescript
// factsheet/rolling.ts:85-97 — population std (pstdev), arbitrary window + basis
export function rollingVol(rets: number[], window = ROLL_WINDOW_6MO, periodsPerYear = 252) {
  const out: Array<number | null> = new Array(rets.length).fill(null);
  const sqrtN = Math.sqrt(periodsPerYear);
  for (let i = window - 1; i < rets.length; i++) {
    const w = rets.slice(i - window + 1, i + 1);
    out[i] = pstdev(w) * sqrtN;   // ← ÷ n (population), vs blend-panels ÷ n−1 (sample)
  }
  return out;
}
```

### Chart prop contracts the new seam must feed (unchanged)
```typescript
// ReturnHistogram.tsx:13-14  → returns: { date: string; value: number }[]  (cumulative-WEALTH series)
// ReturnQuantiles.tsx:12-14  → data: Record<string, number[]>              (e.g. {All:[q0,q25,q50,q75,q100]})
// RollingMetrics.tsx:19      → data: Record<string, {date,value}[]> keyed "sharpe_365d" (for CHART_ACCENT stroke)
//   + rollingVol/rollingSortino consumed as {date,value}[]
```
Backbone rolling outputs are `Array<number | null>` parallel to `dates` — the adapter must zip `dates[i] ↔ value[i]` and drop the leading `null` warmup region to produce `{date,value}[]`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-surface duplicate TS Sharpe/vol/Sortino (sample std), pinned by convention | ONE backbone (`deriveSeriesBundle` / `factsheet/rolling.ts`, population std); every surface derives from dailies | v1.10 backbone program (Phases 103–108) | The blend panels are the last single-strategy-scoped duplicate. 108 retires it. |
| Leverage / scenario re-scale metrics analytically | Transform the dailies (`r→L·r`), re-derive the whole bundle | Phase 107 (shipped this branch) | 108 applies the same "derive, don't re-scale" discipline to blend panels. |

**Deprecated/outdated after this phase:** `scenario-blend-panels.ts::buildBlendPanels` + `BlendPanelSeries` — the last real second-Sharpe TS compute in single-strategy scope. (Portfolio-aggregation duplicates `portfolio_metrics.py`/`portfolio-stats.ts` are explicitly DEFERRED to v1.11 per REQUIREMENTS `:44` E1.)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The scenario blend is ALWAYS geometric (never arithmetic), so `isArithmetic:false` is correct for `deriveSeriesBundle`. | Pitfall 6 | If a future arithmetic blend path exists, the histogram/equity basis would mismatch. Verified today: `computeScenario` has only the geometric cumprod path (`scenario.ts:449`); arithmetic is a composite-only `build-payload.ts:381` flag. LOW risk. |
| A2 | SC-4 "parity tolerance" is intended to ACCEPT the sample→population std shift (not require byte-identity of rolling numbers). | Pitfall 1 | If the intent is byte-identity, routing onto population-std backbone is impossible without also changing the backbone — a much larger scope. This is THE discuss-phase question. |
| A3 | The 3M/6M/12M rolling-window toggle must be preserved (removing it is a user-visible regression barred by SC-4). | Pitfall 2 | If the toggle is deemed expendable, a direct `deriveSeriesBundle` route (fixed window) becomes viable and simpler. |
| A4 | Reusing backbone *primitives* (`factsheet/rolling.ts` etc.) counts as "flows from the ONE backbone," not only a literal `deriveSeriesBundle` call. | Pattern 1/2, Pitfall 2 | If the phase demands the literal `deriveSeriesBundle` entry (strict 107 analogy), the lighter primitive-reuse option is off the table. Discuss-phase must pick the seam. |

## Open Questions

1. **Sample-std → population-std: accepted within SC-4 tolerance?**
   - Known: blend panels use sample (÷n−1), backbone uses population (÷n); the scenario *chart* path already uses population.
   - Unclear: whether the deliberate rolling-number shift is "within parity tolerance."
   - Recommendation: treat as the primary discuss-phase decision; if accepted, add a re-derived population-std pin (mirroring PAYLOAD-03) and a caption/no-op note; if not, scope grows to reconcile the backbone.

2. **Adapter seam: literal `deriveSeriesBundle` (107-analogy, heavy, fixed window) vs backbone primitives (lighter, window-selectable)?**
   - Known: `deriveSeriesBundle` is 235ms/heavy and fixed-window; `factsheet/rolling.ts` primitives take explicit window + basis and are cheap.
   - Recommendation: primitive-reuse preserves the toggle and eliminates the duplicate; propose it, let discuss-phase confirm it satisfies "flows from the backbone."

3. **Quantiles: keep min/max whiskers (today) or adopt p05/p95 (backbone `quantileSummary`)?**
   - Recommendation: reshape to preserve today's min/max unless discuss-phase wants the p05/p95 change (visible).

4. **`usableN` gate: re-home in the adapter or in the composer?**
   - Recommendation: keep the gate logic co-located with the new derivation so the three UI keys (`:4282/:4338/:4342`) stay in sync; preserve WR-02 behavior.

## Environment Availability

Skipped — no external dependencies. Pure in-repo TS refactor; the only tooling is the existing Vitest/tsc/lint pipeline already present and green on this branch.

## Validation Architecture

`workflow.nyquist_validation: true` (config.json) — section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.2` (`package.json:70`) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / funcs 74 / branches 72) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx src/lib/scenario.test.ts` |
| Full suite command | `npm test` (`vitest run`) |
| Coverage command | `npm run test:coverage` (blocking CI gate per CLAUDE.md) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCEN-BB / SC-1 | Blend panels derive from the backbone, not `scenario-blend-panels.ts` | unit + source-scan | `npx vitest run src/app/\(dashboard\)/allocations/components/ScenarioComposer.test.tsx` | ✅ (guard at `:3549` needs re-anchor — Wave 0) |
| SC-2 | `scenario-blend-panels.ts` deleted; `portfolio-stats.ts`/`health-score.ts` remain | source-scan | new grep-gate test (module absent; siblings present) | ❌ Wave 0 (add a delete-gate like 107's `leverage-backbone-gates.test.ts`) |
| SC-3 | `metrics-parity.test.ts` kept + green | unit | `npx vitest run src/__tests__/metrics-parity.test.ts` | ✅ (427 LOC, untouched) |
| SC-4 | Blend panels match pre-change within parity tolerance | unit (re-derived pin) | new parity pin on the rewired derivation (population-std, mirroring PAYLOAD-03) | ❌ Wave 0 |
| SC-4 (UI) | 3M/6M/12M toggle + `usableN` empty-states preserved (WR-02) | component | `ScenarioComposer.test.tsx` WR-02 at `:3494` | ✅ (must stay green through the rewire) |

### Sampling Rate
- **Per task commit:** `npx vitest run` on the touched files (`ScenarioComposer.test.tsx`, `scenario.test.ts`, `metrics-parity.test.ts`, any new gate test) — < 30s.
- **Per wave merge:** `npm test` (full suite; 8142 baseline green per 107-03).
- **Phase gate:** `npm run test:coverage` exit 0 (thresholds hold after the module + its 251-LOC test are removed) + `npm run typecheck` + `npm run lint`, before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Re-anchor the `ScenarioComposer.test.tsx:3553` positive control off `/buildBlendPanels/` to a live token (Pitfall 5).
- [ ] Add an SC-2/SC-3 source-scan gate: assert `scenario-blend-panels.ts` is absent AND `portfolio-stats.ts`/`health-score.ts`/`metrics-parity.test.ts` are present (pattern: 107 `leverage-backbone-gates.test.ts`).
- [ ] Add an SC-4 re-derived parity pin on the new backbone-fed derivation (population-std value, mutation-falsifiable — mirror PAYLOAD-03 at `scenario-factsheet-payload.test.ts:207`).
- [ ] Delete `scenario-blend-panels.test.ts` (251 LOC) with the module; confirm no orphaned import.

## Security Domain

`security_enforcement` not disabled in config → nominally required, but this phase has a minimal security surface (pure client-side numeric transform of already-loaded return series; no auth, no I/O, no persistence, no new inputs).

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | marginal | The derivation already guards non-finite/degenerate input (`scenario.ts` non-finite short-circuit `:478-507`; the panel `usableN` gate). Preserve those guards at the new seam — a non-finite value must not reach a chart (no NaN/Inf render). |
| V2/V3/V4/V6 (auth/session/access/crypto) | no | No auth, session, access-control, or cryptographic surface in a client-side blend-panel derivation. |

| Threat Pattern | STRIDE | Mitigation |
|----------------|--------|------------|
| NaN/Inf poisoning a chart (bad return series at 10× leverage ceiling) | Tampering (data-integrity) | Preserve the degenerate collapse → honest empty-state (today's `hasNonFinite → usableN:0` behavior; `scenario-blend-panels.ts:162-176`). |

## Sources

### Primary (HIGH confidence — read/grep-verified in-repo)
- `src/lib/scenario-blend-panels.ts` (211 LOC) — the DELETE target; exports + conventions.
- `src/lib/scenario.ts` (803 LOC) — engine, `portfolio_daily_returns` at `:440`, FROZEN.
- `src/lib/factsheet/build-payload.ts` — `deriveSeriesBundle` export at `:186`, args contract.
- `src/lib/factsheet/rolling.ts` — population-std rolling primitives (`pstdev` `:145`).
- `src/lib/factsheet/quantiles.ts` — `quantileSummary` shape `:19-27`.
- `src/__tests__/metrics-parity.test.ts` (427 LOC) — the KEEP test; schema gate + math oracle.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — the sole consumer (`:102`, `:2814-2823`, `:4276-4382`).
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — WR-02 `:3494`, source-scan guard `:3549-3554`.
- `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` + `.test.ts:207` (PAYLOAD-03 population-std pin) — the sibling adapter precedent.
- `src/components/charts/{ReturnHistogram,ReturnQuantiles,RollingMetrics}.tsx` — prop contracts.
- `.planning/BACKBONE-BYPASS-INVENTORY.md:35,53,54` — Tier-5 E4 scope, KEEP/GO list.
- `.planning/REQUIREMENTS.md:41,44` — SCEN-BB + deferred E1/E2.
- `.planning/ROADMAP.md` Phase 108 line + coverage matrix.
- `.planning/phases/107-leverage-as-a-dailies-transform/107-01-SUMMARY.md` — the dailies-transform → re-derive precedent, 235ms measurement.
- `.planning/STATE.md` — 107 CLOSED, deriveSeriesBundle exported, scenario.ts frozen.
- `package.json:13-15,69-70`, `CLAUDE.md` — Vitest, coverage gate.

### Secondary / Tertiary
- None — no external sources needed; entirely in-repo, source-verified.

## Metadata

**Confidence breakdown:**
- Delete/keep list: HIGH — every file + LOC + caller grep-verified.
- Consumer trace: HIGH — single call site + all UI keys read directly from source.
- Parity crux (sample vs population): HIGH — both denominators read at file:line; existing PAYLOAD-03 test corroborates the tension.
- Adapter shape (window toggle, quantiles, usableN): HIGH on the mismatch facts; the chosen *resolution* is a discuss-phase decision (flagged as Open Questions, not asserted).
- Backbone-routing pattern: HIGH — 107 shipped precedent read in full.

**Research date:** 2026-07-15
**Valid until:** 2026-08-14 (stable; in-repo only. Invalidated earlier only if 108's branch base changes or `scenario.ts`/`build-payload.ts` are edited before planning.)
