---
phase: 26-stress-testing-var
reviewed: 2026-06-22T14:18:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - src/app/(dashboard)/allocations/lib/scenario-stress.ts
  - src/app/(dashboard)/allocations/components/StressVarSection.tsx
findings:
  critical: 0
  warning: 3
  info: 3
  total: 6
status: issues_found
---

# Phase 26: Code Review Report

**Reviewed:** 2026-06-22T14:18:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Reviewed the two Phase 26 "Stress Testing & VaR" source files at standard depth, with the
threat class framed as **math correctness + honesty** (not classic injection security). I
traced every load-bearing math claim through to its delegated helpers (`computeVaR`,
`computeExpectedShortfall`, `computeScenarioBenchmark`, `innerJoinByDate`, `evaluateSampleFloor`,
`methodologyLine`, `formatPercent`) and through the engine that feeds the mount
(`computeScenario.portfolio_daily_returns` / `.n`).

**The core engineering is sound.** The implementation is genuinely a wrapper, not a fork: VaR
is the empirical floor-quantile order statistic (verified against `computeVaR` line 142-154),
CVaR is the mean of the tail at/beyond VaR (line 160-168, correct `<=` inclusion, no off-by-one),
the loss-sign convention is preserved (signed returns, never flipped), β-propagation uses
`computeScenarioBenchmark(...).beta` over the BTC inner-join intersection (no zero-fill union),
the near-market-neutral case correctly yields ~0 impact, the two N values (`varN` scenario vs
`betaN` BTC-overlap) are kept distinct and each disclosed against its own metric, leverage is
NOT re-scaled (it rides the already-leveraged series), the floor SoT is imported (no re-declared
literal 60), and the honesty render is monochrome with em-dash-on-null. **All 21 tests pass.**

The findings below are robustness / defense-in-depth gaps and one documentation overclaim — no
Critical fabricated-number, mis-scaled, wrong-tail, or red-loss violation was found. The most
material is **WR-01**: the module's docstring claims null-safety on "non-finite series", but the
function itself does NOT defend against a NaN injected directly through its public signature; it
relies entirely on the upstream `computeScenario` producer to have suppressed non-finite series
to `[]`. Live mount is safe; the public contract is overstated.

## Warnings

### WR-01: `computeScenarioStress` is NOT null-safe against a NaN-bearing input array — the degeneracy guard silently passes NaN through to `computeVaR`

**File:** `src/app/(dashboard)/allocations/lib/scenario-stress.ts:118-145`
**Issue:** The module docstring (lines 5-6, 16-17) claims the result is "fully null-safe" and that
the engine "emits `[]` for n<10 / constant / **non-finite** series" so "no fabricated 0 can ever
escape." But `computeScenarioStress` is an exported function with a public `DailyPoint[]` signature
— its own null-safety depends entirely on the caller having pre-suppressed non-finite values. Trace
a NaN injected directly:

1. `portfolioDaily.length === 0`? No (the array is non-empty).
2. Relative-scale guard: `meanSeries = mean([..., NaN, ...]) = NaN`; `varSeries = NaN`;
   `seriesIsDegenerate = Math.sqrt(NaN) <= 1e-12 * (Math.abs(NaN) + 1e-12)` → `NaN <= NaN` → **`false`**.
   NaN defeats the guard (every comparison with NaN is false), so it does NOT short-circuit to null.
3. It calls `computeVaR(values, 0.95)`, whose `[...returns].sort((a,b) => a - b)` produces an
   undefined ordering when NaN participates (the comparator returns NaN), and `computeExpectedShortfall`'s
   `filter(r => r <= var_)` can drop or admit the wrong rows — yielding a **NaN or a meaningless quantile**,
   not `null`.

`formatPercent` would catch a final NaN as an em-dash, but a *non-NaN-but-wrong* quantile (from the
corrupted sort) would render as a confident, fabricated number. The live mount happens to be safe only
because `computeScenario` (scenario.ts:302-329) returns `portfolio_daily_returns: []` whenever any
cumulative value is non-finite — so the docstring's "the engine emits []" is true for the *current
sole caller*, but the function's stated contract ("fully null-safe") is not met by the function itself.
This is the exact "NaN in the input" edge the phase asks to be adversarial about.

**Fix:** Make the guard finite-aware so the function honors its own contract independent of the caller:
```ts
function computeVarPath(
  portfolioDaily: DailyPoint[],
  confidence: number,
): { var: number | null; cvar: number | null } {
  if (portfolioDaily.length === 0) return NULL_VAR;
  const values = portfolioDaily.map((d) => d.value);
  // Any non-finite contaminant ⇒ surface null (a NaN defeats the relative-scale
  // guard below: NaN <= NaN is false, so it would otherwise reach computeVaR).
  if (!values.every(Number.isFinite)) return NULL_VAR;
  const meanSeries = mean(values);
  const varSeries = mean(values.map((x) => (x - meanSeries) ** 2));
  const seriesIsDegenerate =
    Math.sqrt(varSeries) <= 1e-12 * (Math.abs(meanSeries) + 1e-12);
  if (seriesIsDegenerate) return NULL_VAR;
  return {
    var: computeVaR(values, confidence),
    cvar: computeExpectedShortfall(values, confidence),
  };
}
```
Add a regression test feeding `[{date, value: NaN}, ...]` and asserting `var`/`cvar` are `null`.

### WR-02: `confidence` is accepted as an opts param but never clamped — an out-of-range value silently produces a meaningless tail

**File:** `src/app/(dashboard)/allocations/lib/scenario-stress.ts:88,142-143`
**Issue:** `computeScenarioStress` accepts `opts.confidence` (default 0.95) and forwards it verbatim
to `computeVaR` / `computeExpectedShortfall`. `computeVaR` clamps only the *index* (portfolio-stats.ts:149-152),
not the confidence semantics: a `confidence` of `0`, `1`, `1.5`, `NaN`, or negative yields a clamped-to-edge
or NaN-derived quantile that is rendered as a confident number while the VaR row + disclosure still
hard-code the "(95%)" / "95% confidence." label. The component never passes a non-default confidence
(it is effectively locked at 0.95), so this is latent — but the public signature invites a future caller
(the deferred Strategy-Sandbox stress surface mentioned in the mount comment) to pass an arbitrary value
that will desync the rendered "95%" label from the actual computation, an honesty violation by drift.
**Fix:** Either drop the `confidence` opt entirely (lock it to the headline 0.95, matching the locked
UI label) or validate it and surface null on an out-of-range value:
```ts
const confidence = opts?.confidence ?? 0.95;
if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) {
  // a caller that desyncs from the rendered "95%" label gets honest "—", not a fabricated tail
  return { varN, betaN, beta, projectedImpact, var: null, cvar: null };
}
```
Given the UI label is a hard-coded literal, locking the constant is the simpler root-cause fix.

### WR-03: β-shock disclosure caption asserts a methodology + N for a value that is "—" when the BTC overlap is degenerate/tiny

**File:** `src/app/(dashboard)/allocations/components/StressVarSection.tsx:218-228`
**Issue:** In the ok path (scenario `n >= 60`), the β-shock caption is rendered unconditionally with the
true `betaN`. But `projectedImpact` is `null` (em-dash) whenever the BTC inner-join is degenerate (constant
BTC) or `betaN < 2` (benchmark returns NULL_RESULT for n<2). In that state the user sees the impact cell
"—" yet reads a caption that confidently asserts "Single-factor (BTC), linear β propagation over {betaN}
overlapping days, point-in-time — not a forecast." For a tiny `betaN` (e.g. 3) the caption names a real but
inadequate window while the value is suppressed — the caption describes a methodology that did not, in fact,
produce a usable number. This is a softer honesty concern (the N is truthful), but a methodology caption
attached to a suppressed value can read as a contradiction. **Fix:** When `result.projectedImpact === null`,
either suppress the β caption or swap it for an honest "BTC overlap too short to project a shock" note, so a
"—" impact never carries an affirmative methodology claim. The VaR caption (which names `varN` and always
has a value in the ok path) does not have this problem.

## Info

### IN-01: `innerJoinByDate` is computed twice per call (once for `betaN`, once inside `computeScenarioBenchmark`)

**File:** `src/app/(dashboard)/allocations/lib/scenario-stress.ts:104-105`
**Issue:** `betaN` reads `innerJoinByDate(portfolioDaily, btcDaily).p.length`, then line 105 calls
`computeScenarioBenchmark(...)` which calls `innerJoinByDate` again internally (scenario-benchmark.ts:101).
The inline comment (lines 99-103) explicitly justifies the redundant call "so the two-N intent is unambiguous
at the call site." That is a defensible readability trade and `computeScenarioBenchmark` already exposes `.n`
(= the same inner-join overlap). Out-of-scope as a perf issue per v1 rules; noted only because `.n` would
remove the duplication with zero loss of the two-N clarity (`const bench = computeScenarioBenchmark(...);
const betaN = bench.n; const beta = bench.beta;`).

### IN-02: `NULL_VAR` is a shared module-level mutable object literal returned by reference

**File:** `src/app/(dashboard)/allocations/lib/scenario-stress.ts:66,123,137`
**Issue:** `const NULL_VAR = { var: null, cvar: null }` is returned by reference from two code paths.
Both fields are `null` and no caller mutates the returned object (the result is spread into a fresh object
at line 109), so there is no live aliasing bug. Flagged only as a latent footgun: if a future edit ever
mutates a returned `{ var, cvar }` in place, every degenerate result would share state. A frozen constant
(`Object.freeze`) or returning a fresh literal each time removes the footgun.

### IN-03: Headline `formatPercent(result.projectedImpact)` / VaR rows render a leading "+" for non-negative values via the default `signed:true`

**File:** `src/app/(dashboard)/allocations/components/StressVarSection.tsx:196,201,206`
**Issue:** `formatPercent` defaults `signed: true` (utils.ts:9-10), so a non-negative VaR/CVaR/impact
renders with a leading "+" (e.g. an all-gains series gives a positive 5%-quantile → "+0.50%" on a
"Value at Risk" row). This is mathematically honest (the empirical low quantile of an all-positive series
*is* positive, and a positive-β book under a positive shock would give a positive impact), and the monochrome
token keeps it non-alarming, so it is not a defect. Noted only so a future reviewer does not mistake a "+"
on a risk row for a sign-flip bug — it is the correct order statistic, not a fabrication. No change needed
unless the UI-SPEC intends to suppress the "+" on risk rows specifically.

---

_Reviewed: 2026-06-22T14:18:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
