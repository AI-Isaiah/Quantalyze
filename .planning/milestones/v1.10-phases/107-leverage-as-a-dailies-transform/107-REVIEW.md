---
phase: 107-leverage-as-a-dailies-transform
reviewed: 2026-07-15T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/lib/factsheet/build-payload.ts
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/factsheet/[id]/v2/leverage-context.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/basis-context.leverage.test.tsx
  - src/lib/factsheet/joint.test.ts
  - src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx
  - src/app/factsheet/[id]/v2/leverage-context.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx
  - src/app/factsheet/[id]/v2/leverage-backbone-gates.test.ts
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
status: issues_found
---

# Phase 107: Code Review Report

**Reviewed:** 2026-07-15
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 107 refactors leverage into a dailies transform composed into the single
shared `useBasisSeriesView` hook, deleting ~780 LOC of `useLeveragedMetrics` /
`useModeledLeverage` disclosure machinery. The core mechanism is correct and
unusually well-pinned:

- **SC-4 (L=1 by-reference short-circuit):** `if (L === 1) return base` precedes
  every `deriveSeriesBundle` call; verified against the fixture tests (Test A
  round-trip + component byte-identity). Correct.
- **No-fabrication guards (composite / periodsPerYear-absent / MTM-bundle-absent):**
  all four guards return `base` by reference and are individually pinned
  (Tests D1/D2/D3 + component eligibility/hide tests). Correct.
- **Levered-vs-unlevered leg separation:** only the strategy leg is scaled
  (`r → L·r`); `deriveSeriesBundle` re-aligns un-levered benchmark legs, so
  `β→L·β / α→L·α`, corr-invariant fall out honestly. Pinned algebraically in
  `joint.test.ts` and end-to-end in `basis-context.leverage.test.tsx` Test C.
  Correct.
- **Delete hygiene:** no orphaned references to the deleted hooks remain in `src/`
  (only comments and the SC-3 tripwire test that forbids their return); the
  `build-payload.ts` change is a one-line `export` of `deriveSeriesBundle`. Clean.

The defects found all stem from ONE architectural seam introduced by the 107-03
`useDeferredValue` debounce: **the `useBasisSeriesView` hook reads a *deferred*
leverage, but the `KpiStrip` re-derives its own leverage-applied gate + disclosure
caption from the *immediate* `useLeverage()` value.** The two can disagree during
a slider drag and at the persisted↔recompute boundary.

## Warnings

### WR-01: KpiStrip caption/gate reads immediate leverage while the displayed metrics read the deferred leverage — the what-if caption can claim a projection the numbers do not yet reflect

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:757-769`, `:854-862`
(interacts with `src/app/factsheet/[id]/v2/basis-context.tsx:171`)

**Issue:** `useBasisSeriesView` defers the leverage read
(`const leverage = useDeferredValue(rawLeverage)`, basis-context.tsx:171), so the
re-derived `view.strategyMetrics` / `view.comparators` lag the slider by the
~235ms `deriveSeriesBundle` cost — the intended debounce. But the `KpiStrip`
computes its gate and caption from the **immediate** value:

```ts
const { leverage } = useLeverage();                       // immediate, NOT deferred
const appliedLeverage = sanitizeLeverage(leverage, { signal: false });
const leverageApplied = appliedLeverage !== 1 && !composite && ... ;
const m = leverageApplied ? view.strategyMetrics : basisM; // view is DEFERRED
```

During the deferred window after the user sets L=2:
- `leverageApplied` is already `true` (immediate = 2)
- `view.strategyMetrics` is still the **unlevered** base (deferred still = 1, so
  the hook returned `base` by reference)
- `m = view.strategyMetrics` → the strip renders the **unlevered** Sharpe / Ann.
  Vol / α under the caption *"What-if projection at 2× leverage…"* (`appliedLeverage`
  is also immediate, so the caption text says "2×").

The reverse also occurs on "Reset 1×": the caption disappears immediately
(immediate = 1) while the numbers stay levered for ~235ms until the deferred
render lands. This directly violates the design invariant asserted in the code's
own comment (FactsheetView.tsx:852-853): *"The gate is the EXACT mirror of the
plan-01 view guards → the caption can never claim a what-if the view did not
apply."* Because the gate reads a different (non-deferred) leverage source, it
CAN. The act()-flushed component tests never expose this — they flush both the
urgent and deferred renders synchronously — so it is unpinned.

Impact: transient (self-healing) but user-visible mislabeling on an institutional
factsheet whose contract is honest labeling; the misleading state persists for the
whole re-derive duration on every drag step.

**Fix:** Make the gate consume the same deferred leverage the view used, so the
caption and numbers move together. Cleanest is to have the hook expose the applied
leverage it actually derived (e.g. return `{ view, appliedLeverage }` or a small
`useAppliedLeverage()` that also defers), and drive both `m` and the caption from
it:

```ts
// in basis-context.tsx — expose what the view actually applied
export function useAppliedLeverage(): number {
  const raw = useContext(LeverageContext)?.leverage ?? 1;
  return sanitizeLeverage(useDeferredValue(raw), { signal: false });
}

// in KpiStrip
const appliedLeverage = useAppliedLeverage();          // deferred, matches `view`
const leverageApplied = appliedLeverage !== 1 && !composite
  && payload.periodsPerYear != null
  && !(basis === "mark_to_market" && !mtmBundlePresent);
```

This removes the duplicated inline guard list (currently re-implemented in three
places: the hook, the KpiStrip gate, and the ControlBar `leverageEligible`) and
guarantees caption/gate/numbers cannot drift.

### WR-02: leverage-invariant scalars (Sharpe/Sortino/Calmar) jump at the L=1↔L≠1 boundary for MTM-participant strategies, because base uses the persisted overlay while the levered view uses a fresh client recompute

**File:** `src/app/factsheet/[id]/v2/FactsheetView.tsx:769`
(with `src/app/factsheet/[id]/v2/basis-context.tsx:221-236` and `:94-108`)

**Issue:** At L=1 the strip shows `basisM` — for an MTM options book this is
`overlayBasisScalars(payload.strategyMetrics, metricsByBasis.mark_to_market)`, i.e.
the **persisted dense-Python** scalars (the F3 contract that makes rail == strip).
At L≠1 the strip shows `view.strategyMetrics`, which for the levered path is the
**client TS recompute** of `deriveSeriesBundle(levered, …)` with NO persisted
overlay applied (basis-context.tsx:221-236 spreads only the levered bundle).

Sharpe / Sortino / Calmar are leverage-invariant (rf=0: `mean·√P/sd` is unchanged
by `r→L·r`). So engaging leverage on an MTM options book flips these cells from
the persisted value (e.g. `sharpe 1.20`, the fixture's `MTM.sharpe`) to the
client-recomputed value, which differs whenever persisted ≠ client recompute —
exactly the sparse-vs-dense / arithmetic-vs-geometric divergence the F3 overlay
exists to hide (see `fixtureSingleKeyMtmParity`, which proves bundle.sharpe `5.50`
≠ persisted `1.20`). The user sees a "leverage-invariant" metric change value
purely by engaging leverage. This is confined to MTM participants: plain single-key
cash strategies have no `cash_settlement` overlay, so `basisM` already equals the
client recompute and there is no jump. Uncovered — `LEV-MTM-1` dials leverage under
MTM but only asserts the homogeneous Ann. Vol, never Sharpe.

**Fix:** Re-apply the leverage-invariant persisted scalars onto the levered view's
`strategyMetrics` so the boundary is continuous (leverage only moves the
homogeneous scalars — cum_ret, cagr, ann_vol, max_dd — while sharpe/sortino/calmar
stay pinned to the persisted authoritative value). In the levered arm:

```ts
if (basis === "mark_to_market" && payload.seriesByBasis?.mark_to_market) {
  const persisted = payload.metricsByBasis?.mark_to_market ?? {};
  lb.strategyMetrics = { ...lb.strategyMetrics,
    sharpe: persisted.sharpe ?? lb.strategyMetrics.sharpe,
    sortino: persisted.sortino ?? lb.strategyMetrics.sortino,
    calmar: persisted.calmar ?? lb.strategyMetrics.calmar };
}
```

At minimum, if the intent is to fully abandon the persisted overlay under any
what-if, document that choice at the caption and add a test asserting the intended
Sharpe behavior at L≠1, so the boundary discontinuity is deliberate and pinned
rather than incidental.

## Info

### IN-01: the debounced re-derive runs once per consumer, not once per view — the ~235ms cost is paid N times per drag step

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:160-238`
(consumers: `FactsheetView.tsx:414` PerformanceCharts, `:755` KpiStrip, plus
`MetricsColumn` and any panel calling `useBasisSeriesView`)

**Issue:** `useBasisSeriesView` is a plain hook with per-call `useMemo` state; every
component that calls it independently re-runs `deriveSeriesBundle` (incl.
`bootstrapCI` at 2000 resamples) on each leverage change. The `useDeferredValue`
debounce keeps the *input* responsive but does not deduplicate the identical levered
bundle across the 3+ consumers, so a single drag step schedules N × ~235ms of
main-thread work. (Performance is out of v1 scope, so this is INFO — flagged only
because it materially undercuts the effectiveness of the 107-03 debounce, an
explicit focus area.)

**Fix:** Compute the levered/basis view once at a provider boundary (e.g. a
`BasisSeriesViewProvider` memoized on `[basis, deferredLeverage, payload]`) and have
consumers read it via context, rather than each recomputing. Out of scope to fix
now; worth a follow-up ticket.

### IN-02: three copies of the four-guard eligibility predicate risk silent drift

**File:** `src/app/factsheet/[id]/v2/basis-context.tsx:206-216`,
`src/app/factsheet/[id]/v2/FactsheetView.tsx:764-768`,
`src/app/factsheet/[id]/v2/FactsheetView.tsx:1148-1151`

**Issue:** The "leverage applies" predicate (L≠1 / not-composite / periodsPerYear
present / not MTM-without-bundle) is hand-inlined in the view hook, the KpiStrip
gate, and the ControlBar `leverageEligible`. They agree today, but WR-01 is already
a live instance of the KpiStrip copy drifting from the view copy (immediate vs
deferred leverage). Any future guard change must be mirrored in three places.

**Fix:** Extract a single `leverageApplies(payload, basis, appliedLeverage)` helper
(and the `useAppliedLeverage` hook from WR-01) so all three sites derive from one
source of truth. Folding this in resolves WR-01 as a side effect.

---

## Narrative Findings (AI reviewer)

All findings above are narrative (direct-read) findings; no `<structural_findings>`
substrate was provided for this phase. Positive verifications worth recording for
downstream consumers:

- **SC-4 short-circuit ordering** is correct: the `L === 1` return precedes all
  subsequent guards and the sole `deriveSeriesBundle` call (basis-context.tsx:206).
- **Guard-4 reference identity** holds: MTM-without-bundle returns `payload` by
  reference from Layer 1, and the leverage guard preserves it (Test D3).
- **Only the strategy leg is levered**; benchmark re-alignment is internal to
  `deriveSeriesBundle`, so `jointMetrics(leveredStrat, unleveredBench)` yields
  honest `β→L·β / α→L·α` (joint.test.ts LEV-BB block + Test C).
- **`comparatorAnnVol` is correctly omitted** on the levered arm, mirroring the MTM
  build-payload arm, so the levered comparator vol-matches its own levered vol.
- **Delete left no orphans**: `useLeveragedMetrics` / `useModeledLeverage` /
  `LEVERAGE_CAVEAT` survive only in comments + the SC-3 tripwire; the D4 base-track
  rail eyebrow is deleted (test-pinned), not merely hidden.
- **`build-payload.ts` diff** is a single `export` keyword — no behavioral change to
  the payload build path; the SC-4 byte-identity of cash is preserved.

---

_Reviewed: 2026-07-15_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
