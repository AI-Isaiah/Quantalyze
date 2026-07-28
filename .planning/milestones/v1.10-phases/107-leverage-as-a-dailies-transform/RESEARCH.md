# Phase 107: Leverage as a dailies transform — Research

**Researched:** 2026-07-15
**Domain:** Frontend factsheet re-derive architecture (TS/React) — collapse a bespoke frontend leverage re-scale into the shared `deriveSeriesBundle` backbone
**Confidence:** HIGH (this is a codebase-internal refactor; every claim below is grep/read-verified against source at the cited file:line, not training data)

## Summary

Phase 107 is a **frontend-only, single-key** refactor. Leverage today is a bespoke re-scale that touches only the 7 KpiStrip headline scalars and blanks α/IR behind a MODELED eyebrow; every chart and the entire right rail stay on the un-levered 1× track. The target is to make leverage a **preparation transform**: at L≠1, map the active-basis dailies `r → L·r` and re-run the SAME `deriveSeriesBundle` every chart/panel/rail already consumes (via `useBasisSeriesView`), so the whole factsheet re-derives levered. α→L·α and β→L·β then fall out **honestly and for free** from the joint math (verified below), which deletes the entire MODELED/CAVEAT/α-IR-blanking disclosure apparatus (~780 LOC across `leverage-context.tsx`, `FactsheetView.tsx`, and their two test files).

The precedent (`scenario.ts:427`) and the in-repo template (`basis-context.tsx`'s `useBasisSeriesView`) both already do exactly this shape: apply a per-strategy multiplier to the daily returns, then derive everything from the leveraged series. The re-derive **must be client-side** — the leverage slider is a continuous, interactive control (L ∈ [0, 10]), so unlike the discrete MTM basis (precomputed server-side into `payload.seriesByBasis`) the levered bundle cannot be pre-baked; it is computed in-browser on each L change. Python `derive_basis_series` is NOT in the interactive path — it only persists server-side dailies; leverage is a pure display transform and never persists. **This is TS-only.**

**Primary recommendation:** Export `deriveSeriesBundle` from `build-payload.ts:186` and compose a leverage transform INTO the existing shared view hook (`useBasisSeriesView` in `basis-context.tsx:132`, which all ~12 dailies-derivable panels already read). At L=1 return the base view **by reference** (the SC-4 identity short-circuit — mirrors the hook's existing cash/no-bundle branch), so the existing `build-payload.test.ts` SC-4 snapshot proves byte-identity with zero new golden infrastructure. Swap the KpiStrip from `useLeveragedMetrics` to reading the levered view's `strategyMetrics` + joint. Delete the disclosure code; keep the slider state (`LeverageProvider`/`useLeverage`) and the `sanitizeLeverage`/`MAX_LEVERAGE` contract untouched. LEV-02 scenario leverage (`scenario.ts`) is a separate module and is not touched.

## User Constraints

**No CONTEXT.md exists** in `.planning/phases/107-leverage-as-a-dailies-transform/` — discuss-phase has not run yet. This is standalone research. The constraints below are extracted from ROADMAP.md Phase-107 success criteria + BACKBONE-BYPASS-INVENTORY.md Tier-3 + REQUIREMENTS.md LEV-BB (they function as locked scope until discuss-phase produces a CONTEXT.md):

### Locked scope (from ROADMAP SC 1–5 + inventory)
- Leverage = a dailies-level preparation transform (`r → L·r`) feeding the ONE backbone; the ENTIRE factsheet re-derives levered (charts + rail + α/β), not just the 7 KpiStrip scalars.
- α→L·α and β→L·β render **honestly** at L≠1 — no MODELED-eyebrow blanking of α/IR.
- DELETE `useLeveragedMetrics`/`useModeledLeverage` + the CAVEAT/MODELED-eyebrow/α-IR-blanking disclosure (~780 LOC). **KEEP the slider STATE.**
- At L=1 the factsheet is **byte-identical** to pre-change (SC-4 no-op-at-unity), proven by a golden.
- Mirror the `scenario.ts:427` precedent — one preparation transform, no second leverage compute path remains.

### Out of scope (do not touch)
- **LEV-02 scenario leverage** (`scenario.ts` engine `lev()` closure + persisted draft leverage map + `sanitizeLeverageMap` rehydrate) — a separate path (the scenario planner / composer), not the factsheet slider. Confirmed a distinct module below.
- Python `derive_basis_series` and any server-side persist — leverage never persists.
- Composite factsheets — the leverage control is single-key-only by construction (`leverageEligible` gate at `FactsheetView.tsx:1174`).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LEV-BB | Leverage becomes a dailies-level preparation transform feeding the one backbone; whole factsheet re-derives levered (charts + rail + honest α→L·α); deletes the frontend re-scale + disclosure (~780 LOC); precedent `scenario.ts:427`. | Insertion point identified (`deriveSeriesBundle` at `build-payload.ts:186`, composed into `useBasisSeriesView` at `basis-context.tsx:132`); α/β honesty proven from `joint.ts:30-31`; delete-list + keep-list enumerated with file:line; SC-4 golden identified (`build-payload.test.ts:97` snapshot). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Leverage `r→L·r` transform | Browser / Client (React hook) | — | The slider is a continuous interactive control; L is not persisted and cannot be pre-baked server-side (unlike discrete MTM). |
| Bundle re-derivation | Browser / Client (pure TS) | — | `deriveSeriesBundle` is a pure function of (dailies, conventions); runs identically in `page.tsx` (server) and in-browser. |
| Persisted dailies / scalars | Database / Worker (Python) | — | Untouched — leverage is display-only; no server persist. |
| Slider state | Browser / Client (context) | — | Ephemeral component state (`LeverageProvider`), no storage/URL (GUARD-04). |

## Standard Stack

No new packages. This phase is a pure internal TS refactor using existing modules:

| Module | Location | Role in Phase 107 |
|--------|----------|-------------------|
| `deriveSeriesBundle` | `src/lib/factsheet/build-payload.ts:186` | The shared per-series derivation to re-run on levered dailies. **Must be exported** (currently private). |
| `useBasisSeriesView` | `src/app/factsheet/[id]/v2/basis-context.tsx:132` | The client view-merge template + the ONE hook all ~12 dailies-derivable panels read. Compose leverage into it (or wrap it). |
| `compute` | `src/lib/factsheet/compute.ts` | Pure metrics (cum/CAGR/Sharpe/Sortino/maxDD/vol) — already leverage-aware by construction (path-dependent from scaled series). |
| `jointMetrics` | `src/lib/factsheet/joint.ts:10` | α/β/IR/corr — the honesty mechanism (α→L·α, β→L·β derived, corr invariant). |
| `sanitizeLeverage` / `MAX_LEVERAGE` | `src/lib/leverage.ts` | The read-side clamp contract. **KEEP** — used by both the slider and (in the new design) the transform's L=1 short-circuit. |
| `LeverageProvider` / `useLeverage` | `src/app/factsheet/[id]/v2/leverage-context.tsx:44,54` | Slider state + setter. **KEEP.** |

**No installation. No Environment Availability audit needed (code-only). No Package Legitimacy Audit (no external packages). No Security Domain concern beyond the existing input-clamp (`onLeverageChange` at `FactsheetView.tsx:1182` already validates the slider input — ASVS V5; unchanged).**

## Architecture Patterns

### The precedent — `scenario.ts:427` (VERIFIED)
```typescript
// src/lib/scenario.ts:325-328 — the per-strategy leverage closure
const lev = (id: string): number => {
  const L = state.leverage?.[id];
  return Number.isFinite(L) && (L as number) >= 0 ? (L as number) : 1;
};
// src/lib/scenario.ts:424-427 — leverage scales the DAILY RETURN, in the numerator,
// BEFORE the cumulative/metrics derivation. Everything downstream (cumulative,
// TWR, drawdown, Sharpe) derives from the leveraged portDaily.
r += w * lev(s.id) * strategyReturns[s.id][i];
```
The scenario engine applies L to the daily returns, then builds `portDaily → cumulative → metrics` from the leveraged series. **Phase 107 mirrors this at the factsheet-single-key level:** map the active-basis dailies `r → L·r`, then re-run `deriveSeriesBundle` (the factsheet's equivalent of the scenario engine's derive step). Note `scenario.ts` deliberately does NOT lever the correlation-matrix input series (comment at `:110-114`) — corr is leverage-invariant, consistent with `joint.ts` (see α/β honesty below).

### The in-repo template — `useBasisSeriesView` (VERIFIED, `basis-context.tsx:132-164`)
This hook is the exact shape to copy/extend. It:
1. Reads ephemeral context (`basis`), degrading to a passthrough when absent.
2. At the identity case (cash / no bundle) returns `payload` **by reference** → byte-identical render (SC-4).
3. At the active case returns `useMemo(() => ({...payload, ...bundle, strategyMetrics: overlay}))`.

The MTM bundle it spreads is precomputed server-side in `build-payload.ts:428-443` (`opts.mtmSeries → deriveSeriesBundle → payload.seriesByBasis.mark_to_market`) because MTM is a **discrete** basis. **Leverage is continuous** → the bundle must be computed in the hook at L≠1 by calling `deriveSeriesBundle` directly on the leveraged dailies.

### Recommended pattern: compose leverage INTO the shared view hook
All ~12 dailies-derivable consumers **already** read `useBasisSeriesView(payload)`: `MetricsColumn.tsx:39`, `TimeSeriesChart.tsx`, `HeatmapPanels.tsx`, `HistogramChart.tsx`, `DistributionPanels.tsx`, `AnalyticalPanels.tsx`, `StressWindowsPanel.tsx`, `BatchDPanels.tsx`, `MasterBrush.tsx`, plus `FactsheetView.tsx`. If the leverage transform composes into that ONE hook (rename to e.g. `useDerivedSeriesView`, or wrap: `const base = useBasisSeriesView(payload); return leverageMerge(base, L)`), **every chart/panel/rail follows leverage with no per-consumer wiring** — the literal realization of "nothing bypasses the backbone." This is the recommended approach; it minimizes churn and cannot leave a panel behind.

**Composition order:** leverage applies to the **active-basis** dailies. Do basis merge first (`useBasisSeriesView`), then `r→L·r` + `deriveSeriesBundle` on that result. At L=1 short-circuit to the base view by reference.

### `deriveSeriesBundle` call args for the client re-derive (from `build-payload.ts:186-196, 411-418`)
```typescript
deriveSeriesBundle(clippedLeveredDailies, {
  periodsPerYear,          // from payload.periodsPerYear (already emitted for LEV-01, build-payload.ts:502)
  isArithmetic: false,     // single-key is GEOMETRIC (composite hides the slider); payload carries no isArithmetic field — see Open Questions
  markets: payload.markets,
  strategyName: payload.strategyName,
  // comparatorAnnVol: OMIT — let the levered bundle compute its own vol (= L·vol) honestly,
  //   exactly as the MTM arm omits it (build-payload.ts:437-438). Do NOT pass the persisted
  //   cash overlay ann_vol here (that would un-lever the comparator vol-match).
})
```

### Anti-Patterns to Avoid
- **Do NOT re-scale scalars analytically** (`vol *= L`, `alpha *= L`) — that is exactly the bespoke path being deleted, and it loses path-dependent KPIs (cum/CAGR/maxDD). Re-derive from the leveraged series.
- **Do NOT lever the benchmark leg.** Only the strategy dailies are multiplied; `deriveSeriesBundle` aligns fixed benchmark series (`BTC_DAILY` etc.) internally, and `jointMetrics(stratReturns, benchReturns)` must receive levered strat + un-levered bench (this is what makes β→L·β honest).
- **Do NOT compute the levered bundle at L=1.** Short-circuit to the base view by reference — this is the SC-4 guarantee and avoids any float re-summation.
- **Do NOT persist leverage** (no storage/URL/history — preserve GUARD-04, pinned by `leverage-context.test.tsx` Test 6 source scan).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Levered charts/rolling/drawdown/α/β | A new levered-metrics recompute | Re-run existing `deriveSeriesBundle` | It already derives every dailies-panel from a series; reuse = one code path, no drift (the whole point of LEV-BB). |
| L=1 byte-identity | A float-tolerant deep-equal | Reference short-circuit at L=1 | `r→1·r===r` is exact for finite doubles, but returning the base object by reference is unconditionally byte-identical and needs no tolerance. |
| Leverage clamp | New validation | `sanitizeLeverage` (`leverage.ts`) | Shared contract already mirrors the engine `lev()` + adds the `MAX_LEVERAGE` ceiling. |

**Key insight:** The honest levered factsheet is not new math — it is the existing backbone (`deriveSeriesBundle` + `compute` + `jointMetrics`) run on a pre-scaled input series. The entire delete is possible precisely because the backbone already produces everything the bespoke path faked.

## The current implementation — trace + delete-list vs keep-list

### What the frontend re-scales TODAY
- **KpiStrip** (`FactsheetView.tsx:783`): `const { basis, m, modeled, appliedLeverage } = useLeveragedMetrics(payload)`. At L≠1 this runs a **standalone** `compute(payload.strategyReturns.map(r => L*r), dates, 0, periodsPerYear)` (`leverage-context.tsx:154-159`) and **discards eq/dd** — only the 7 headline scalars (Cum/CAGR/Sharpe/Sortino/Calmar/MaxDD/Vol) are re-scaled. Charts/rail never see it.
- **α/IR blanking** (`FactsheetView.tsx:821-839`): `suppressRelative = modeled || (MTM && !bundle)`. When `modeled`, α and IR render `"—"` because the standalone recompute discarded the joint. This is the dishonesty SC-2 removes.
- **MODELED eyebrow + CAVEAT** (`FactsheetView.tsx:767-768, 875-887`): the `LEVERAGE_CAVEAT` const + the amber `MODELED · {L}×` block, rendered only at L≠1.
- **BASE · 1× TRACK rail eyebrow** (`FactsheetView.tsx:329-372` in `MetricsColumnWithBasis`): reads the cheap `useModeledLeverage` predicate (`:337`) to label the rail "still on the un-levered base track."
- **Under MTM leverage is disabled** (`leverageEligible` requires `basis === "cash_settlement"`, `FactsheetView.tsx:1174-1175`; the recompute also short-circuits under MTM, `leverage-context.tsx:147-152`).

### Every consumer of the leverage-scaled values (enumerated)
1. `KpiStrip` — `useLeveragedMetrics` → `m.*` (7 scalars) + `modeled`/`appliedLeverage` (eyebrow) + `suppressRelative` (α/IR blank). `FactsheetView.tsx:783, 829-839, 875-887`.
2. `MetricsColumnWithBasis` — `useModeledLeverage` → `modeled` (BASE·1× eyebrow). `FactsheetView.tsx:337, 362-372`.
3. `ControlBar` — `useLeverage` → `leverage`/`setLeverage` (the slider itself). `FactsheetView.tsx:1176`. **This is STATE, not a scaled value — KEEP.**

Only **two** consumers read scaled values (1 and 2); both collapse into "read the levered view like every other panel."

### DELETE-list (~780 LOC target; confirm exact counts at plan time)
| File | What to delete | Approx LOC |
|------|----------------|-----------|
| `leverage-context.tsx` | `useLeveragedMetrics` (`:110-168`) + `useModeledLeverage` (`:71-92`) + their doc blocks | ~110 of 168 |
| `FactsheetView.tsx` | `LEVERAGE_CAVEAT` const (`:767-768`); MODELED eyebrow+caveat JSX (`:869-887`); `suppressRelative` α/IR blanking (`:821-839` → becomes unconditional honest values); `useModeledLeverage` read + BASE·1× eyebrow in `MetricsColumnWithBasis` (`:329-372`, the `modeled` branch) | ~120 |
| `FactsheetView.leverage.test.tsx` | The MODELED/caveat/α-IR-suppression/BASE·1× describe blocks (`:239-356`) — rewrite to assert charts+rail+α/β now follow L; keep eligibility + clamp-message tests | ~200 of 429 |
| `leverage-context.test.tsx` | The `useLeveragedMetrics`/`useModeledLeverage` recompute + MTM-short-circuit tests | ~150 of 210 |

### KEEP-list
- `LeverageProvider`, `useLeverage`, `LeverageContext` (`leverage-context.tsx:31-58`) — slider state (GUARD-04 ephemeral).
- The ControlBar leverage input cluster + `onLeverageChange`/`resetLeverage`/`leverageMsg` clamp messaging (`FactsheetView.tsx:1181-1270`) — the UX, unchanged (note: the copy references "modeled" and "base 1× track" — see Open Questions on copy).
- `src/lib/leverage.ts` in full (`sanitizeLeverage`, `sanitizeLeverageMap`, `MAX_LEVERAGE`) — shared contract, also used by LEV-02.
- `scenario.ts` — byte-untouched (LEV-02).

## α/β honesty mechanism (SC-2) — VERIFIED from `joint.ts:16-32`

`jointMetrics(rets, bench, rf, ppy)` computes, with `m = mean(rets)`, `cov = mean((rets-m)(bench-mb))`, `varB = var(bench)`:
- `beta = cov / varB` → under `rets → L·rets`: `cov → L·cov`, `varB` unchanged (bench not levered) ⇒ **β → L·β**. ✓ (`joint.ts:30`)
- `alpha = (m - beta·mb)·ppy` → `(L·m − L·beta·mb)·ppy` = **L·alpha**. ✓ (`joint.ts:31`)
- `corr = cov/(s·sb)` → `s → L·s` ⇒ corr is **leverage-INVARIANT** (correct — correlation shouldn't move; matches `scenario.ts:110-114`). ✓ (`joint.ts:32`)
- `info_ratio`, `tracking_error`, `up/down_capture` re-derive honestly (non-linear in L; that's correct, not a bug).

**Conclusion:** Because `deriveSeriesBundle` → `buildComparatorBlock` (`comparator-block.ts:36`) calls `jointMetrics(stratReturns, benchReturns)` with the (levered) strategy leg and the (un-levered) benchmark leg, re-running the bundle on `r→L·r` produces α→L·α and β→L·β **automatically and honestly**. No special-case code — the MODELED blanking exists ONLY because the old standalone `compute()` threw the joint away. Delete the blanking and the honest values already flow.

## SC-4 (L=1 no-op byte-identity) — proof approach

**Guarantee mechanism:** the leverage view-merge, at `sanitizeLeverage(L) === 1`, returns the base (basis-merged) view **by reference** — never calls `deriveSeriesBundle`. This mirrors the existing identity short-circuits: `useBasisSeriesView` returns `payload` by reference under cash (`basis-context.tsx:141`), and the current `useLeveragedMetrics` returns `m` untouched at L=1 (`leverage-context.tsx:148-152`). A reference-equal return renders byte-identically and needs no float tolerance.

**Float trap note:** `r → 1·r === r` is exact for all finite IEEE-754 doubles (multiply by 1.0 is exact), so even a non-short-circuited path would be numerically identical — BUT summation order in `cumEq`/`compute` is already fixed and would be re-run identically. The reference short-circuit removes the question entirely; recommend it as the load-bearing SC-4 mechanism, not float reasoning.

**The golden:** `src/lib/factsheet/build-payload.test.ts:97-115` — the SC-4 keystone: `expect(stableStringify(payload)).toMatchSnapshot()` over the whole payload (single-key geometric, composite arithmetic, api). Snapshot committed at `src/lib/factsheet/__snapshots__/build-payload.test.ts.snap`. Reuse this discipline: add an L=1 assertion that the leverage-merged view **is reference-equal (or `stableStringify`-equal)** to the base view for a representative single-key payload. Component-level, the existing `FactsheetView.leverage.test.tsx:239-247` ("at L=1 the view contains NO 'MODELED', NO caveat, NO 'Reset 1×'") already pins L=1 render-stability — extend it to assert chart/rail DOM is byte-identical at L=1.

## Common Pitfalls

### Pitfall 1: A panel left reading raw `payload` instead of the levered view
**What goes wrong:** a chart that reads `usePayload()` directly (17 such readers) instead of the shared view hook stays un-levered → the "whole factsheet re-derives" claim silently fails on that panel.
**How to avoid:** compose leverage into the ONE `useBasisSeriesView` hook so every current consumer inherits it; audit the 17 `usePayload` readers to confirm none render a dailies-derivable series outside the view hook. Warning sign: a chart moves under MTM but not under leverage (or vice-versa).

### Pitfall 2: `isArithmetic` unknown on the client
**What goes wrong:** `deriveSeriesBundle` needs `isArithmetic` (arithmetic vs geometric equity/drawdown); the payload does not carry it (`build-payload.ts:381` computes it from `opts.cumulativeMethod`, server-only). Guessing wrong flips the equity/drawdown curve basis.
**How to avoid:** the leverage slider is single-key-only (composite hides it, `:1174`), and single-key is **geometric** → `isArithmetic: false` is correct for this path. Confirm no arithmetic single-key case exists (the Zavara "simple" override is composite/allocated-capital). Flagged in Open Questions.

### Pitfall 3: Comparator vol-match un-levered
**What goes wrong:** passing `comparatorAnnVol: strategyMetrics.ann_vol` (the persisted cash overlay) into the levered `deriveSeriesBundle` vol-matches the benchmark to the UN-levered vol → the comparator overlay disagrees with the levered strategy curve.
**How to avoid:** OMIT `comparatorAnnVol` on the leverage re-derive (as the MTM arm does, `:437-438`) so the bundle vol-matches to its own levered vol.

### Pitfall 4: Deleting the slider state with the disclosure
**What goes wrong:** over-deleting `leverage-context.tsx` removes `LeverageProvider`/`useLeverage`, breaking the ControlBar.
**How to avoid:** delete only the two derived hooks; keep the provider/state/`LeverageContext`. Pinned by the KEEP-list above.

## Runtime State Inventory

This is a frontend refactor with no stored state, but it IS a delete/refactor phase, so per protocol:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — leverage is ephemeral component state; GUARD-04 guarantees no storage/cookie/URL/history write (`leverage-context.tsx:16-21`, pinned by `leverage-context.test.tsx` Test 6). | none |
| Live service config | None — no external service references the factsheet leverage slider. | none |
| OS-registered state | None. | none |
| Secrets/env vars | None. | none |
| Build artifacts | None — pure TS; no generated artifact carries "leverage" identity. The `__snapshots__/build-payload.test.ts.snap` golden is a test fixture, not a build artifact, and should NOT change (SC-4). | Verify snapshot unchanged post-refactor. |

**Cross-language rename risk:** none — `useLeveragedMetrics`/`useModeledLeverage` are TS-only symbols. Grep confirms references only in `FactsheetView.tsx` + the two test files (no Python, no other module). LEV-02's `sanitizeLeverageMap`/`scenario.ts` `lev()` are separate and stay.

## Validation Architecture

`nyquist_validation: true` in config → this section required.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (v8 coverage), jsdom for `.tsx` component tests |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run command | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx --no-file-parallelism` |
| Full suite command | `npm run test` (or `npm run test:coverage` for the CI gate) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | L≠1 re-derives charts + rail (not just 7 scalars) | component | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx` | ✅ (rewrite the MODELED blocks to assert charts/rail follow) |
| SC-2 | α→L·α, β→L·β honest at L≠1 | unit + component | `npx vitest run src/lib/factsheet/joint.test.ts` (add L-scaling case) + FactsheetView.leverage | ✅ joint.test.ts exists; add scaling assertion |
| SC-3 | disclosure code deleted; slider kept | source-scan + component | grep-gate (no `useLeveragedMetrics`/`useModeledLeverage`/`LEVERAGE_CAVEAT`) + leverage-context.test.tsx | ✅ |
| SC-4 | L=1 byte-identical | snapshot/reference | `npx vitest run src/lib/factsheet/build-payload.test.ts` + L=1 render-identity assertion | ✅ SC-4 snapshot at build-payload.test.ts:97 |
| SC-5 | one transform, no second compute path | source-scan | grep-gate: no standalone `compute(...map(r => L * r)...)` outside `scenario.ts` | ✅ (new grep gate) |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched leverage/basis test files> --no-file-parallelism`
- **Per wave merge:** `npm run test` (full vitest suite — 8000+ tests)
- **Phase gate:** full suite green + coverage thresholds hold + SC-4 snapshot unchanged.

### Wave 0 Gaps
- [ ] Rewrite `FactsheetView.leverage.test.tsx` — replace the MODELED/α-IR-suppression/BASE·1× assertions with "charts + rail + α/β follow L" assertions.
- [ ] Add an L-scaling case to `joint.test.ts` proving β→L·β, α→L·α, corr-invariant (falsifiable: fails if a future change re-analytic-scales).
- [ ] Add SC-4 L=1 reference/byte-identity assertion (extend build-payload.test.ts or a new leverage-view test).
- [ ] Add SC-5 grep-gate test (no second leverage compute path).
- *(Prune leverage-context.test.tsx to the kept-state surface.)*

## Code Examples

### The honest joint scaling (verified, `joint.ts:30-31`)
```typescript
// Under rets → L·rets, bench unchanged:
const beta = varB > 0 ? cov / varB : 0;      // cov→L·cov, varB fixed ⇒ beta→L·beta
const alpha = (m - beta * mb) * periodsPerYear; // (L·m − L·beta·mb)·ppy ⇒ alpha→L·alpha
```

### The identity short-circuit template (verified, `basis-context.tsx:139-141`)
```typescript
return useMemo<FactsheetPayload>(() => {
  const bundle = payload.seriesByBasis?.mark_to_market;
  if (basis !== "mark_to_market" || !bundle) return payload; // by reference ⇒ byte-identical
  // ... merge
}, [basis, payload]);
```
The leverage transform adds an analogous `if (sanitizeLeverage(L) === 1) return baseView;` before calling `deriveSeriesBundle`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Leverage = standalone scalar recompute (7 KPIs), charts un-levered, α/IR blanked, MODELED disclosure | Leverage = dailies transform → shared `deriveSeriesBundle` re-derive; whole factsheet levered; α/β honest | Phase 107 (this) | Deletes ~780 LOC; removes the last frontend backbone bypass (Tier-3). |
| MTM basis precomputed server-side (`seriesByBasis`) | Same for MTM (discrete); leverage computed client-side (continuous) | Phase 103 established the view-merge; 107 reuses it for a continuous transform | Client re-derive on each L change (cheap — one bundle; no bootstrapCI needed unless a panel demands it — see Open Questions). |

**Deprecated by this phase:** `useLeveragedMetrics`, `useModeledLeverage`, `LEVERAGE_CAVEAT`, MODELED eyebrow, BASE·1× eyebrow, α/IR `suppressRelative` blanking.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `build-payload.ts` (and thus `deriveSeriesBundle`) is client-safe — no server-only imports; it runs in vitest/jsdom today (many `.test.tsx` import `buildFactsheetPayload`). | Insertion point | LOW — verified: imports are pure TS libs (compute/align/benchmarks/rolling/joint), no `server-only`, no `next/headers`; the arithmetic test is `.tsx` (jsdom). |
| A2 | Single-key factsheets are always geometric (`isArithmetic: false`), so the client re-derive can hard-code it. | Pitfall 2 | MEDIUM — if any single-key strategy is arithmetic, the levered equity/drawdown basis flips. Plan-time: confirm `cumulativeMethod` is only ever "arithmetic" on composite/allocated-capital paths. |
| A3 | Re-running the full `deriveSeriesBundle` (incl. `bootstrapCI`, `styleDrift`) on every slider tick is performant enough interactively. | Open Questions | MEDIUM — bootstrapCI is the heaviest sub-derivation (`loading.tsx:3` calls it out as slow). May need to debounce or exclude bootstrapCI from the levered re-derive. |
| A4 | Leverage should compose with the ACTIVE basis (lever the MTM series when MTM is active), not stay cash-only. | Composition order | MEDIUM — ROADMAP says "apply r→L·r to the DAILIES"; the honest reading is active-basis dailies, but current code gates leverage to cash-only. A scope decision for discuss-phase. |

## Open Questions

1. **Compose leverage into `useBasisSeriesView` vs. a separate `useLeveragedSeriesView`?**
   - Know: all ~12 panels already read `useBasisSeriesView`; composing in = zero per-consumer wiring.
   - Unclear: whether to rename the hook (touches 12 call sites) or wrap it (keep the name, add a leverage layer).
   - Recommendation: wrap/extend the existing hook so consumers are untouched; keep the basis-then-leverage order.

2. **Does leverage now work under MTM, or stay cash-only?** (A4)
   - Know: the old cash-only gate (`leverageEligible`, `:1174`) existed because the standalone recompute would fabricate an MTM line off the cash series. With a real re-derive from the active-basis dailies, levering MTM is honest.
   - Recommendation: allow leverage on whatever basis is active (lever the active series) — but confirm at discuss-phase; if kept cash-only, the composition is simpler.

3. **Performance: full bundle re-derive per slider tick?** (A3)
   - Know: `bootstrapCI` is the slow part; the current bespoke path deliberately skipped it (`leverage-context.tsx:107` "NO bootstrapCI").
   - Options: (a) re-derive everything (simplest, honest); (b) memoize/debounce; (c) omit bootstrapCI from the levered bundle and keep it un-levered with a note. Recommend measuring first; prefer (a) unless it janks.

4. **Copy: the ControlBar input title/aria still say "modeled" / "excludes borrow / funding" (`:1233-1234`).** After the delete the numbers are the real re-derived levered track — is "modeled" copy still wanted (leverage IS still a what-if projection excluding borrow cost), or does it soften? Discuss-phase copy decision. The kept clamp messages (`:1185-1194`) also say "modeled leverage" / "modeled in this projection."

5. **`isArithmetic` threading (A2):** confirm single-key is always geometric, or thread `cumulativeMethod` onto the payload so the client re-derive matches the server basis exactly.

## Sources

### Primary (HIGH confidence — read directly this session)
- `src/app/factsheet/[id]/v2/leverage-context.tsx` (full) — the hooks being deleted + slider state kept.
- `src/app/factsheet/[id]/v2/basis-context.tsx` (full) — `useBasisSeriesView` template.
- `src/lib/factsheet/build-payload.ts:120-506` — `deriveSeriesBundle` + payload assembly + MTM bundle precedent.
- `src/lib/factsheet/joint.ts` (full) — α/β/corr honesty math.
- `src/lib/factsheet/comparator-block.ts:22-56` — `jointMetrics(stratReturns, benchReturns)` call (strat levered, bench not).
- `src/lib/scenario.ts:318-443` — the `lev()` closure + `r += w * lev · r` precedent (`:427`).
- `src/lib/leverage.ts` (full) — `sanitizeLeverage`/`MAX_LEVERAGE` shared contract (kept).
- `src/app/factsheet/[id]/v2/FactsheetView.tsx:315-395, 755-895, 1160-1270` — consumers, MODELED/CAVEAT/BASE·1× disclosure, ControlBar.
- `src/lib/factsheet/build-payload.test.ts:9-115` + `__snapshots__/build-payload.test.ts.snap` — SC-4 golden.
- `src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx` (describe scan) + `leverage-context.test.tsx` — existing test contracts.
- `.planning/ROADMAP.md` (Phase 107 §), `.planning/BACKBONE-BYPASS-INVENTORY.md` (Tier-3 + Dead-Route #7), `.planning/REQUIREMENTS.md` (LEV-BB), `.planning/STATE.md`.

### Secondary / Tertiary
- None — this is a closed-codebase refactor; no web sources needed.

## Metadata

**Confidence breakdown:**
- Insertion point / architecture: HIGH — `deriveSeriesBundle` + `useBasisSeriesView` read directly; the client-side re-derive requirement is proven by MTM's precomputed-vs-continuous contrast.
- α/β honesty (SC-2): HIGH — derived algebraically from `joint.ts:30-31` and confirmed the strategy leg is the only levered input.
- SC-4 mechanism + golden: HIGH — the reference short-circuit pattern + the existing snapshot are both in-repo.
- Delete/keep LOC counts: MEDIUM — line ranges verified, exact LOC totals ("~780") should be re-counted at plan time against a fresh diff.
- Performance / composition-under-MTM / isArithmetic: MEDIUM — flagged as Open Questions for discuss-phase.

**Research date:** 2026-07-15
**Valid until:** ~2026-08-15 (stable internal code; re-verify line anchors if 106 lands frontend changes first, though 106 is worker/cutover-only per ROADMAP).
