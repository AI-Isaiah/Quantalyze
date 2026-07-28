# Phase 107: Leverage as a dailies transform - Context

**Gathered:** 2026-07-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Leverage becomes a **dailies-level preparation transform** (`r → L·r`) feeding the ONE
factsheet backbone. At L≠1 the active-basis dailies are scaled and the shared
`deriveSeriesBundle` re-runs, so the ENTIRE factsheet re-derives levered — every chart
(equity/drawdown/returns/rolling/heatmaps) AND the right rail follow, and α→L·α / β→L·β
render honestly. This DELETES the bespoke frontend re-scale + its MODELED/CAVEAT/α-IR-blanking
disclosure (~780 LOC) and keeps the slider STATE. Frontend-only, single-key-only, display-only
(leverage never persists). LEV-02 scenario leverage (`scenario.ts`) is OUT OF SCOPE and untouched.
Precedent: `scenario.ts:427`.

</domain>

<decisions>
## Implementation Decisions

### Scope — leverage under MTM (USER DECISION)
- **Allow leverage on whatever basis is ACTIVE** (cash_settlement OR mark_to_market), not cash-only.
  With a real re-derive from the active-basis dailies, levering the MTM series is honest (the old
  cash-only `leverageEligible` gate existed only because the bespoke recompute would fabricate an
  MTM line off the cash series — that failure mode is deleted).
- Remove the `basis === "cash_settlement"` restriction from `leverageEligible`
  (`FactsheetView.tsx:1174-1175`); KEEP the non-composite gate and the `periodsPerYear != null` gate.
- Composition order: basis-merge FIRST (`useBasisSeriesView`), then `r→L·r` + re-derive on that
  result. Leverage always operates on the active-basis dailies.
- Accepts slightly larger test surface: both bases must be covered under leverage.

### Copy — keep a reworded "modeled what-if" framing (USER DECISION)
- KEEP the "modeled / what-if projection" disclosure, but REWORD it. The levered numbers are now the
  REAL re-derived levered track (not a fake scalar rescale), yet leverage still excludes borrow,
  funding, and liquidation cost → an honest "what-if projection, excludes financing cost" note stays.
- DROP the now-false language: "everything else on this page … stays on the base 1× track", the
  "BASE · 1× TRACK" rail eyebrow, and "volatility/drawdown scale only in the headline KPIs above"
  (the whole page now re-derives levered).
- The ControlBar input title/aria/clamp copy (`:1185-1194, :1233-1234`) that references "modeled
  leverage" is reworded to match — leverage is a real re-derived what-if that excludes financing cost.

### Architecture / composition (Claude's Discretion — per RESEARCH recommendation)
- Compose the leverage transform INTO the one shared view hook (`useBasisSeriesView`,
  `basis-context.tsx:132`) that all ~12 dailies-derivable panels already read — WRAP/extend it
  (keep the name or a thin wrapper), do NOT rename across 12 call sites. This guarantees every
  chart/panel/rail follows leverage with no per-consumer wiring ("nothing bypasses the backbone").
- `deriveSeriesBundle` (`build-payload.ts:186`) must be EXPORTED (currently private) for the
  client-side re-derive.
- `deriveSeriesBundle` re-derive args: `periodsPerYear` from `payload.periodsPerYear`;
  `isArithmetic: false` (single-key is geometric); pass `markets` + `strategyName`; **OMIT**
  `comparatorAnnVol` (let the levered bundle vol-match to its own levered vol, as the MTM arm does).
- Do NOT lever the benchmark leg — only the strategy dailies are multiplied; this is what makes
  β→L·β / α→L·α honest via `jointMetrics(leveredStrat, unleveredBench)`.

### isArithmetic threading (Claude's Discretion — confirm at plan time)
- Default: hard-code `isArithmetic: false` for the single-key path (single-key is geometric; the
  Zavara "simple" arithmetic override is composite/allocated-capital only).
- Plan-time REQUIREMENT: add an assertion/guard confirming no arithmetic single-key case exists
  (A2). If one can exist, thread `cumulativeMethod` onto the payload instead of hard-coding.

### Performance — full re-derive per L change (Claude's Discretion — measurement-gated)
- Default: re-run the FULL `deriveSeriesBundle` on each L change (option a — simplest, honest).
- Plan-time: MEASURE `bootstrapCI` cost (the heaviest sub-derivation, deliberately skipped by the
  old bespoke path). If the interactive slider janks, debounce OR exclude bootstrapCI from the
  levered bundle (keep it un-levered with an explicit note) — but only if measurement shows a need.
  Prefer the honest full re-derive unless it demonstrably janks.

### SC-4 — L=1 byte-identity (load-bearing)
- The leverage view-merge, at `sanitizeLeverage(L) === 1`, returns the base (basis-merged) view
  **by reference** — never calls `deriveSeriesBundle`. Reference-equal render ⇒ byte-identical, no
  float tolerance. Mirrors the existing `useBasisSeriesView` cash short-circuit.
- Golden: reuse `build-payload.test.ts:97` SC-4 snapshot discipline + a component-level L=1
  chart/rail DOM-identity assertion.

### GUARD-04 — leverage stays ephemeral
- No storage/cookie/URL/history write for leverage. Keep `LeverageProvider`/`useLeverage` state
  only; the GUARD-04 source-scan test (`leverage-context.test.tsx` Test 6) stays green.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `deriveSeriesBundle` (`src/lib/factsheet/build-payload.ts:186`) — the shared per-series
  derivation; export and re-run on levered dailies (the honest levered factsheet is NOT new math).
- `useBasisSeriesView` (`src/app/factsheet/[id]/v2/basis-context.tsx:132`) — the ONE view-merge hook
  all ~12 dailies-derivable panels read; the exact identity-short-circuit template to extend.
- `jointMetrics` (`src/lib/factsheet/joint.ts:10,30-31`) — α/β/IR/corr; the honesty mechanism
  (β→L·β, α→L·α fall out automatically; corr leverage-invariant).
- `compute` (`src/lib/factsheet/compute.ts`) — path-dependent metrics, already leverage-aware from a
  scaled series.
- `sanitizeLeverage` / `MAX_LEVERAGE` (`src/lib/leverage.ts`) — shared read-side clamp; KEEP (also
  used by LEV-02). Powers the L=1 short-circuit.
- `LeverageProvider` / `useLeverage` (`leverage-context.tsx:31-58`) — slider state; KEEP.

### Established Patterns
- Precedent `scenario.ts:424-427` — lever the daily return in the numerator BEFORE cumulative/metrics
  derivation; do NOT lever the correlation-matrix / benchmark input (`:110-114`).
- MTM basis is precomputed server-side (discrete, `seriesByBasis`); leverage is CONTINUOUS → the
  levered bundle is computed client-side in the hook on each L change (cannot be pre-baked).

### Integration Points
- KpiStrip (`FactsheetView.tsx:783`): swap `useLeveragedMetrics` → read the levered view's
  `strategyMetrics` + joint.
- `MetricsColumnWithBasis` (`FactsheetView.tsx:337`): delete the `useModeledLeverage` BASE·1× branch.
- DELETE-list: `useLeveragedMetrics` + `useModeledLeverage` (`leverage-context.tsx:71-168`);
  `LEVERAGE_CAVEAT` + MODELED eyebrow/caveat JSX + `suppressRelative` α/IR blanking + BASE·1× eyebrow
  (`FactsheetView.tsx:767-768, 821-887, 329-372`); the MODELED/α-IR/BASE·1× test blocks in
  `FactsheetView.leverage.test.tsx` + `leverage-context.test.tsx` (rewrite to assert charts+rail+α/β
  follow L). Re-count exact "~780 LOC" at plan time.
- KEEP-list: `LeverageProvider`/`useLeverage`/`LeverageContext`; the ControlBar leverage input cluster
  + clamp messaging (reworded copy); `src/lib/leverage.ts` in full; `scenario.ts` byte-untouched.

</code_context>

<specifics>
## Specific Ideas

- SC-5 grep-gate: after the refactor, NO standalone `compute(...map(r => L * r)...)` may exist outside
  `scenario.ts` — one preparation transform, no second leverage compute path.
- SC-2 unit proof: add an L-scaling case to `joint.test.ts` asserting β→L·β, α→L·α, corr-invariant
  (falsifiable — fails if a future change re-analytic-scales).
- Verify `__snapshots__/build-payload.test.ts.snap` is UNCHANGED post-refactor (SC-4).

</specifics>

<deferred>
## Deferred Ideas

- LEV-02 scenario-planner leverage (`scenario.ts` `lev()` closure + persisted draft leverage map) —
  a separate path; Phase 108 addresses the scenario-planner backbone, not this slider.
- bootstrapCI performance optimization (debounce/exclude) — only if plan-time measurement shows the
  full re-derive janks; otherwise the honest full re-derive stands.

</deferred>
