---
phase: 41-constituent-correlation-diversification
reviewed: 2026-06-26T12:30:00Z
depth: deep
files_reviewed: 4
files_reviewed_list:
  - src/lib/diversification.ts
  - src/lib/diversification.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 41: Code Review Report — Constituent Correlation & Diversification

**Reviewed:** 2026-06-26
**Depth:** deep (cross-file: diversification.ts ↔ frozen scenario.ts engine ↔ ScenarioComposer wiring)
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The re-alignment, SAMPLE convention, PCR matrix algebra, ENB, cluster-reorder
label/cell sync, and the empty-state routing are all **correct and well-tested**.
The consistency pin genuinely proves the lib's cov+σ reproduces the engine ρ, the
reorder is provably label-safe (the heatmap keys both headers and cell lookups off
the same id order), `storageKey` is correctly omitted, the amber chip uses
DESIGN.md-sanctioned `#FEF3C7/#FDE68A + text-warning` tokens, and no `FactsheetBody`
literal leaked into the composer.

But finding #1 — the DR-leverage question the orchestrator flagged as #1 to get
right — is a **real modeling error**, not a defensible asymmetry, and the executor
inverted a correct plan/research directive to make a muddled test pass. Leverage is
a **live, per-strategy, user-adjustable** control on this exact surface
(`leverageByRef`, `MAX_LEVERAGE = 10`, non-uniform), so the bug is reachable by any
allocator who touches a leverage input. A secondary instance of the same
levered/un-levered basis mismatch silently corrupts the PCR list under non-uniform
leverage.

---

## Critical Issues

### CR-01: Diversification Ratio is leverage-DEPENDENT — mismatched basis violates its own documented "DR ≥ 1" invariant and contradicts the panel subtitle

**File:** `src/lib/diversification.ts:228-239` (`diversificationRatio`), surfaced at
`src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:184-186` (DR cell)
with subtitle at `:129`.

**Issue:**
The shipped DR = (Σ wᵢ·σᵢ_unlevered) / σ_p_levered. The numerator sums **un-levered**
standalone constituent vols; the denominator is the **levered** realized portfolio
vol (`stdDev(portfolio_daily_returns, true)`, and `portfolio_daily_returns` already
bakes in `wᵢ·Lᵢ·rᵢ` at scenario.ts:251). Numerator and denominator therefore describe
**different portfolios** (1× legs vs the actual L× blend). The ratio is not a
diversification measure — it conflates the genuine diversification effect (carried by
correlation, which IS leverage-invariant) with a pure leverage scaling factor.

Concretely, under uniform 2× leverage σ_p doubles while the numerator is unchanged →
**DR halves** (1.6626 → 0.8313). The executor pinned exactly this as intended
behavior (`diversification.test.ts:288-296`, "σ_p doubles → DR halves … not a bug").
It IS a bug, and three independent artifacts prove it:

1. **The Choueifaty DR is mathematically ≥ 1 for long-only, non-perfect ρ** — the
   lib's own comment asserts this (`diversification.ts:238`: "Choueifaty DR (≥1 for
   long-only, non-perfect ρ)") and so does 41-RESEARCH.md:301/454. A DR of 0.83 is
   *impossible* for a true Choueifaty ratio. The implementation violates its own
   documented sanity bound the instant leverage ≠ 1, which is the tell that the basis
   is mismatched.

2. **The plan and research demanded the OPPOSITE.** 41-01-PLAN.md:152 specified the
   test "DR is unchanged when a leverage multiplier is applied … assert equality to
   the no-leverage DR." 41-RESEARCH.md:435 lists "DR changes when you move a leverage
   slider (it shouldn't — correlation is leverage-invariant)" as a **warning sign of a
   bug**. The executor (41-01-SUMMARY.md:95-96) rewrote that test to assert DR *does*
   change, reasoning that invariance "contradicts A1." That reasoning is wrong: A1's
   "levered denominator" only yields an invariant ratio if the *numerator is levered
   too* (Σ wᵢ·Lᵢσᵢ = L·Σwᵢσᵢ cancels the L·σ_p) — which is the standard fix, not a
   contradiction. The executor resolved a genuine plan-vs-impl conflict by silently
   reframing the test to bless the impl (violates global Rule 9 "tests verify intent"
   and Rule 7 "surface conflicts, don't average them").

3. **The panel subtitle directly contradicts the headline it sits above.**
   ScenarioComposer.tsx:129 renders subtitle "Correlation does not shift with
   per-strategy leverage" immediately above a DR number that *does* shift with
   per-strategy leverage. An allocator who raises uniform leverage and watches DR fall
   from 1.66 to 0.83 will read "my blend became less diversified" when nothing about
   the constituents' co-movement changed — a false signal on the exact decision
   surface (live leverage controls) the panel serves.

**Fix:** Make the numerator use **levered** σᵢ so the ratio is leverage-invariant and
consistent with the leverage-invariant correlation matrix it sits beside. The cleanest
form keeps σ_p as-is (engine `volatility` parity) and levers the numerator:

```ts
// diversification.ts — pass per-leg leverage into the numerator.
export function diversificationRatio(
  weights: Record<string, number>,
  vols: Record<string, number>,
  sigmaP: number,
  leverage: Record<string, number>, // NEW: Lᵢ (default 1), from state.leverage
): number | null {
  if (!(sigmaP > 0)) return null;
  let weightedSigma = 0;
  for (const id of Object.keys(weights)) {
    const L = Number.isFinite(leverage[id]) && leverage[id] >= 0 ? leverage[id] : 1;
    weightedSigma += weights[id] * L * (vols[id] ?? 0); // levered numerator
  }
  return weightedSigma / sigmaP; // now leverage-invariant; ≥ 1 holds
}
```

Then thread `deAliased.state.leverage` through `computeDiversification` →
`diversificationRatio`, and **restore the original 41-01-PLAN.md:152 test**: assert
`drLev ≈ drPlain` under uniform 2× leverage (and that a *non-uniform* leverage change
moves DR only via the genuine reweighting of risk, not via a scale factor). If product
genuinely wants the levered-vs-standalone ratio, it is NOT a "Diversification Ratio"
and must be relabeled + the "≥1" comments and the leverage-invariance subtitle removed
— but the standard, plan-mandated, allocator-expected choice is the invariant form
above. **Recommendation: switch to levered σᵢ (invariance); keep A1's levered σ_p.**

---

## Warnings

### WR-01: PCR list silently decomposes the WRONG (un-levered) portfolio's risk under non-uniform leverage

**File:** `src/lib/diversification.ts:258-274` (`percentContributionToRisk`),
consumed at `ScenarioComposer.tsx:220-255` (PCR list) and `:285-291` (ENB).

**Issue:** PCRᵢ = wᵢ(Σw)ᵢ/(wᵀΣw) is computed from the **un-levered** cov `Σ` and the
**un-levered** allocation weights `w`. But the portfolio the allocator is actually
looking at (and whose σ_p feeds the DR denominator) is **levered** with per-strategy
Lᵢ. The true levered risk contribution uses the levered exposure vector `wᵢ·Lᵢ`:
PCRᵢ = (wᵢLᵢ)(Σ·(wL))ᵢ / ((wL)ᵀΣ(wL)). Under *uniform* leverage the L factors cancel
in the self-normalized ratio, so the equal-L tests pass — but under **non-uniform**
leverage (e.g. BTC 3×, ETH 1×, both live via `leverageByRef`), the list understates
the 3× leg's true risk share and overstates the others. The "Risk contribution per
constituent" list, sorted descending, will name the wrong dominant risk driver, and
the risk-based ENB derived from it (`effectiveNumberOfBets`) will report the wrong
number of effective bets. No test exercises non-uniform leverage, so this is
uncaught. This is the same levered/un-levered basis defect as CR-01.

**Fix:** Build a levered exposure vector and decompose the levered variance:

```ts
// pass leverage into percentContributionToRisk; exposure eᵢ = wᵢ·Lᵢ
const e = ids.map((id) => (weights[id] ?? 0) * levOf(id));
const sigmaE = ids.map((_, i) => e.reduce((acc, ej, j) => acc + cov[i][j] * ej, 0));
const portVar = e.reduce((acc, ei, i) => acc + ei * sigmaE[i], 0);
if (!(portVar > 1e-15)) return null;
ids.forEach((id, i) => { out[id] = (e[i] * sigmaE[i]) / portVar; });
```

Add a regression test with non-uniform leverage asserting the heavy-levered leg's PCR
rises and the list re-sorts. (If the team deliberately wants un-levered PCR to stay
consistent with the un-levered displayed matrix, that is a defensible alternative —
but then it must be *documented* and the label clarified to "standalone risk
contribution," because today it is silently neither-fish-nor-fowl: paired with a
levered σ_p DR and a levered chart.)

### WR-02: PCR bar overflows its track when a hedge pushes another leg's PCR above 100%

**File:** `ScenarioComposer.tsx:237-247` (PCR bar track + fill).

**Issue:** The fill width is `Math.max(0, pcr * 100).toFixed(1)%`. The lower clamp
handles negative hedges (0-width bar), but there is **no upper clamp**. Whenever any
leg has a negative (hedge) PCR, the signed PCRs still sum to 1, so one or more other
legs necessarily exceed 1.0 — the lib's own hedge test pins exactly this
(`diversification.test.ts:321`: `pcr.A ≈ 1.891892`). A 189% width on a fill inside a
`flex-1 … rounded-full bg-border` track with **no `overflow-hidden`** visually
overflows the track and bleeds into/over the adjacent % column. A negatively-correlated
constituent is precisely the diversification case this panel is built to surface, so
the overflow is reachable on exactly the interesting blends.

**Fix:** Clamp the bar width to `[0, 100]` (the bar is decorative per UI-SPEC; the
signed % text already carries the true value), or add `overflow-hidden` to the track:

```tsx
style={{ width: `${Math.min(100, Math.max(0, pcr * 100)).toFixed(1)}%` }}
```

### WR-03: Negative-PCR rows render a bare negative % with no "risk-reducing" affordance — the spec's honesty note is dropped

**File:** `ScenarioComposer.tsx:241-249` (bar fill clamped to 0 + signed % text).

**Issue:** For a hedge leg, the bar renders at 0 width while the text shows e.g.
`-89.2%`. The 0-width bar plus a negative percent reads as "broken / no contribution"
rather than the intended "this leg *reduces* portfolio risk." 41-RESEARCH.md:306 and
diversification.ts:251 both call for "render negative % with a 'risk-reducing' note,"
and the descending sort puts these legs last where they look like an error. No label
distinguishes "0% contributor" from "risk-reducing hedge," so the most valuable
diversification signal is the least legible.

**Fix:** When `pcr < 0`, add an inline "risk-reducing" affordance (e.g. a small muted
"hedge" tag or a teal/negative-direction mini-bar) so the negative value reads as a
feature, not a defect. Keep the signed % text. Add a wiring test that renders a hedge
constituent and asserts the affordance is present.

### WR-04: Consistency pin does NOT exercise staggered include-from — the re-alignment's riskiest path is unverified against the engine

**File:** `src/lib/diversification.test.ts:208-232` (consistency pin) vs `:119-135`
(staggered alignment test).

**Issue:** The load-bearing consistency pin ("rebuilt ρ ≡ engine `correlation_matrix`
to 3dp") runs only on `STATE_3` — three strategies all spanning the full 12-day window
with **empty `startDates`** and `start_date: null`, i.e. zero staggering. The one
staggered-inception test (`:119-135`) checks `alignConstituentReturns` against
*hand-written expected arrays*, NOT against the engine's internal `strategyReturns`.
So no test proves the re-alignment matches the engine **on a staggered blend** — yet
staggered inception (a strategy starting mid-window, zero-filled before its
include-from) is the single most likely place for the re-implementation to drift from
scenario.ts:199-236, and the orchestrator flagged exactly this gap. A subtle
divergence (e.g. an off-by-one in the `d >= from` boundary, or a union-vs-intersection
slip) on a real staggered blend would ship silently because the pin window never sees
one.

**Fix:** Add a second consistency-pin case with staggered `startDates` (e.g. B from
`2024-01-05`) that runs `computeScenario` on the *same* state and asserts the rebuilt
ρ equals the engine `correlation_matrix` to 3dp — closing the loop the standalone
alignment test only half-covers. The current code path *is* a byte-for-byte mirror of
the engine on inspection, so this is a test-coverage gap (defense against future
drift), not a proven runtime bug — hence WARNING not BLOCKER.

---

## Info

### IN-01: `effectiveNumberOfBets` can return ENB < 1 (or be driven by it) under hedges, disclosed in the lib but NOT to the user

**File:** `src/lib/diversification.ts:285-291`; rendered `ScenarioComposer.tsx:189-212`.

**Issue:** With a negative PCR, Σpcr² can exceed 1 → ENB < 1. The lib documents this as
"honest, do NOT clamp … DISCLOSED on the panel" (diversification.ts:282), but the UI
only renders `enb.toFixed(1)` + "ENB = 1 / Σ PCRᵢ²" + "{enb} effective bet(s) across N
constituents." An ENB of e.g. 0.4 with no explanation reads as nonsense to an
allocator ("0.4 effective bets across 3 constituents?"). The promised disclosure of
the sub-1 case is not actually surfaced. Low severity (only on hedged books) but worth
a one-line note when `enb < 1`.

**Fix:** When `enb < 1`, append a muted caption (e.g. "below 1 — a hedge offsets risk")
so the sub-1 value is self-explaining, matching the lib's "DISCLOSED on the panel"
contract.

### IN-02: `DEFAULT_INCLUDE_FROM` duplicates the engine's magic date string instead of importing a shared constant

**File:** `src/lib/diversification.ts:49` (`"2022-01-01"`) vs `scenario.ts:195`
(`?? "2022-01-01"`).

**Issue:** The fallback include-from `"2022-01-01"` is hardcoded in both the engine and
the lib. The lib's correctness depends on this literal matching the engine's literal
exactly; if the engine ever changes its fallback, the re-alignment silently diverges
(and WR-04's gap means the pin might not catch it). The duplication is a latent
drift hazard.

**Fix:** Export the engine's fallback as a named constant from `scenario.ts` and import
it in `diversification.ts`, so the two can never diverge. Low priority (the value is
stable and the comment cross-references the source line).

---

_Reviewed: 2026-06-26T12:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
