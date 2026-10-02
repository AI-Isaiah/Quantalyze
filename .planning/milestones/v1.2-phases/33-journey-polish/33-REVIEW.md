---
phase: 33-journey-polish
reviewed: 2026-06-23T21:05:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/__tests__/bridge-to-composer-seam.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - e2e/composer-axe.spec.ts
findings:
  critical: 0
  warning: 0
  info: 2
  total: 2
status: clean
---

# Phase 33: Code Review Report

**Reviewed:** 2026-06-23T21:05:00Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** clean

## Summary

Phase 33 (Journey Polish) is a verification/polish phase: two new test files (JOURNEY-01
Vitest regression + JOURNEY-03 Playwright axe e2e) and a single 2-line `className` change in
`ScenarioComposer.tsx` (JOURNEY-02 focus ring). I reviewed adversarially against the four
phase-specific load-bearing checks, traced every test assertion back to the actual production
implementations (`scenario-state.ts`, `scenario-compare.ts`, `keys.ts`, `axe.ts`), and confirmed
the frozen-spine and no-regression guarantees. The submitted work holds up: the JOURNEY-01 test
is genuinely non-vacuous and falsifiable, the axe spec has real false-green guards with zero rule
suppression, `src/lib/scenario.ts` is untouched, and the composer change is strictly additive
(no copy/disclosure/honesty-guard regression).

No Critical or Warning findings. Two Info items are stylistic conformance notes, not defects.

### Load-bearing checks (all PASS)

1. **JOURNEY-01 non-vacuity / falsifiability — PASS.** Assertion (d) compares
   `computeMetricsForDraft(next)` against a captured `baseline = computeMetricsForDraft(draft)`
   on `twr` and `volatility` via `.not.toBeCloseTo(..., 6)`. I traced `addStrategyBridge`
   (`scenario-state.ts:364`): neutering it to `return draft` makes `next === draft`, so `after`
   is field-identical to `baseline` and the `.not.toBeCloseTo` pair throws — the test genuinely
   fails on a no-op seam. The membership-only assertions (a) also fail under the no-op
   (`addedStrategies` never grows). The candidate's distinct return profile
   (`altReturns(dates, -0.015, 0.02)` vs holdings `0.01/-0.008` and `0.012/-0.009`) at a
   ~37.5% bridged weight guarantees a real numeric move, and the sanity gate (`baseline.twr`
   / `baseline.volatility` non-null, `n === 80`) rules out a null→null false "no movement".

2. **JOURNEY-03 axe spec not false-green — PASS.** The spec gates `analyze()` behind, in order:
   (a) `test.skip(!HAS_SEED_ENV, ...)` skip-on-no-seed; (b) a sanity heading
   `h2:has-text("Portfolio")` visible; (c) `data-panel="blend-returns-distribution"` scrolled +
   visible; (d) `data-panel="blend-rolling"` scrolled + visible. Both `data-panel` selectors were
   verified present in `ScenarioComposer.tsx:2076` and `:2126`. `buildAxe` (`e2e/helpers/axe.ts`)
   is `withTags(["wcag2a","wcag2aa","best-practice"])` — confirmed WCAG-AA, and the spec contains
   ZERO `disableRules` / `.exclude` rule suppression. Final assertion is
   `expect(results.violations).toEqual([])`.

3. **`src/lib/scenario.ts` frozen (SCENARIO-05) — PASS.** `git diff 5ce18bcc~1 5edc4762
   --name-only` returns exactly the 3 expected files plus planning artifacts; `scenario.ts` is
   not in the diff.

4. **ScenarioComposer change is focus-ring only — PASS.** The hunk (`:1604`, `:1611`) appends
   `focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50` to two CTA `className`
   strings inside the `isEmptyState` branch. Copy (`Connect Exchange →`, `Browse strategies`),
   heading (`Start a portfolio`), card shell, and surrounding `<p>` are byte-unchanged. No
   PROJECTED/IMPACT-02 honesty-guard or Phase-30 disclosure code is touched.

### Convention adherence

- **Vitest, not Jest:** JOURNEY-01 imports `{ describe, it, expect } from "vitest"`. PASS.
- **Reachability hinge:** `onAddToScenario={` count is 1 in `ScenarioComposer.tsx` and 0 in
  `BridgeWidget.tsx` (both verified on disk). The prop-form regex `/onAddToScenario=\{/g`
  correctly excludes the composer's prose comment mention at `:9`. The self-pin positive sample
  guards against an inert matcher. PASS.
- **Weight assertions verified against source:** `defaultDraftFromHoldings` (`:187`) sets BTC
  weight `60000/100000 = 0.6`; `addStrategyBridge` gives the candidate `heldWeight = 0.6`, then
  `renormalizeWeights` (`:165`) over `{BTC:0.6, ETH:0.4, uuid-2:0.6}` (sum 1.6) yields
  `0.6/1.6`, `0.4/1.6`, `0.6/1.6`. Test assertions (b)/(c) match exactly.
- **`REF_BTC` scope-ref shape:** `holdingScopeKey` (`src/lib/keys.ts:23`) emits
  `holding:{venue}:{symbol}:{holding_type}` = `holding:binance:BTC:spot`, matching the test
  constant. PASS.

## Info

### IN-01: New-CTA focus ring diverges from the named OnboardingBanner analog (`focus-visible:` vs `focus:`)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1604,1611`
**Issue:** The phase brief names the OnboardingBanner as the analog the focus ring must match.
OnboardingBanner (`OnboardingBanner.tsx:65,73`) uses the `focus:ring-2 focus:ring-accent/50`
variant (ring on any focus). The new CTAs use `focus-visible:ring-2 focus-visible:ring-accent/50`
(ring only on keyboard focus). These are not byte-identical to the named analog. This is NOT a
defect: `focus-visible` is the more correct accessibility behavior (suppresses the ring on mouse
click while preserving it for keyboard nav), and it is byte-identical to the same-surface
entry-mode segments at `:1684`/`:1700` that the commit message actually cites — so the change
conforms to the dominant in-file convention. The `ring-accent/50` opacity token matches both
references. Flagged only because the brief singled out OnboardingBanner; the chosen analog is
arguably the better one.
**Fix:** No change required. If strict OnboardingBanner parity is desired, the two analogs
themselves diverge (`focus:` vs `focus-visible:`) and should be reconciled repo-wide in a
separate pass rather than regressing this CTA to the weaker `focus:` variant.

### IN-02: `loginViaForm` duplicated across axe specs instead of sharing `e2e/helpers/login.ts`

**File:** `e2e/composer-axe.spec.ts:24-44`
**Issue:** `loginViaForm` is copied verbatim from `discovery-axe.spec.ts:30-39`, and a
near-equivalent `loginAs` already exists in `e2e/helpers/login.ts`. Three copies of the same
form-login flow now drift independently (selectors, `waitForURL` route list, 10s timeout). This
is consistent with the existing axe-spec idiom (the commit deliberately mirrors
`discovery-axe.spec.ts`), so it is not a regression introduced by this phase — but the
duplication is pre-existing tech debt this file extends.
**Fix:** Opportunistic only — when an axe spec next forces a touch, hoist the shared
`loginViaForm` into `e2e/helpers/` (or reuse `loginAs`) so the three copies converge. Do not
refactor now; out of scope for a polish phase.

---

_Reviewed: 2026-06-23T21:05:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
