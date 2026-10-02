---
phase: 41-constituent-correlation-diversification
plan: 01
subsystem: client-portfolio-math
tags: [diversification, correlation, choueifaty, pcr, enb, clustering, pure-ts]
requires:
  - "src/lib/scenario.ts (FROZEN engine: correlation_matrix, portfolio_daily_returns, n — read-only/type-only)"
  - "src/lib/portfolio-math-utils.ts (mean, stdDev sample-default)"
provides:
  - "src/lib/diversification.ts — pure-TS SAMPLE-convention diversification math (align, cov, σ, DR, PCR, ENB, cluster order, too-similar, orchestrator)"
affects:
  - "Phase 41 wiring waves (ScenarioComposer builds the constituents input; ScenarioFactsheetChart renders the panel) — consume computeDiversification + alignConstituentReturns"
tech-stack:
  added: []
  patterns:
    - "scenario-blend-panels.ts shape: pure-TS engine-output adapter, reuse mean/stdDev, MIN_USABLE floor, degenerate→null, golden-tested"
    - "SAMPLE convention (÷n−1) end-to-end to stay consistent with the engine's displayed correlation_matrix + volatility"
key-files:
  created:
    - "src/lib/diversification.ts"
    - "src/lib/diversification.test.ts"
  modified: []
decisions:
  - "DR A1 leverage asymmetry: un-levered σᵢ numerator / levered σ_p denominator (Choueifaty standard); DR magnitude scales with uniform leverage, but σᵢ + correlation matrix are leverage-invariant — pinned that way (not DR-magnitude equality, which would wrongly assert both-levered → DR≈1)"
  - "SAMPLE convention LOCKED (not the factsheet body's POPULATION pstdev); consistency pin + grep-assert enforce it"
  - "Signed PCR (hedges negative, sum-to-1, not clamped); risk-based ENB = 1/Σ PCRᵢ² (Meucci), not weight-HHI"
metrics:
  duration: ~25m
  completed: 2026-06-26
  tasks: 2
  files: 2
  tests: 29
---

# Phase 41 Plan 01: Constituent Diversification Math Library Summary

Pure-TS, zero-dependency SAMPLE-convention `src/lib/diversification.ts` that re-aligns the per-constituent returns the FROZEN scenario engine discards and derives the Choueifaty Diversification Ratio, signed percent-contribution-to-risk, risk-based Effective Number of Bets, an average-linkage cluster order, and the ρ≥0.85 "too similar" pairs — pinned by a consistency golden test that rebuilds ρ from the lib's own cov+σ and asserts equality with the engine `correlation_matrix` to 3 decimals.

## What Was Built

**`src/lib/diversification.ts`** (428 lines, 9 exported functions + 2 constants + 3 interfaces):

| Export | Contract |
|--------|----------|
| `alignConstituentReturns(strategies, state)` | Mirrors scenario.ts:199-236 byte-for-byte: active filter, include-from `state.startDates[id] ?? s.start_date ?? "2022-01-01"`, union-of-dates axis, per-strategy zero-fill, RAW (un-levered) values. Returns `{ ids, commonDates, returnsById }`. |
| `covarianceMatrix(returnsById, ids)` | Two-pass demeaned SAMPLE cov (÷T−1); null on T<2. |
| `constituentVols(returnsById, ids)` | Per-id SAMPLE σ (`stdDev(x, true)`); null on empty. SAMPLE LOCKED. |
| `diversificationRatio(weights, vols, σ_p)` | Choueifaty (Σwᵢσᵢ)/σ_p; null on σ_p≤0. A1 asymmetry: un-levered numerator / levered denominator. |
| `percentContributionToRisk(ids, weights, cov)` | Euler wᵢ(Σw)ᵢ/(wᵀΣw), signed, sum-to-1; null on wᵀΣw≤1e-15. |
| `effectiveNumberOfBets(pcr)` | Risk-based 1/Σ PCRᵢ² (Meucci); null on null pcr / non-positive denom. |
| `clusterOrder(corr, ids)` | Hand-rolled average-linkage on ½(1−ρ); identity for ≤2 ids; missing ρ → max distance 1 (no NaN). |
| `tooSimilarPairs(corr, ids, threshold=0.85)` | Off-diagonal j>i pairs with ρ≥0.85; [] on null matrix. |
| `computeDiversification(input)` | Orchestrator + global gate (ids<2 / n<MIN_USABLE / null matrix → all-null, identity clusterOrderIds). No NaN/Inf escapes. |

**`src/lib/diversification.test.ts`** (473 lines, 29 tests) — golden tests on a hand-computed 12-observation, 3-constituent fixture (A,B strongly correlated ρ≈0.998; C near-orthogonal ρ≈−0.29), the consistency pin, the leverage-asymmetry pin, and every degenerate path.

## How It Works

- **Re-alignment** reconstructs the exact window the engine's displayed ρ was built on. The engine computes the aligned per-constituent series as a transient local (`strategyReturns`, scenario.ts:229-236) and discards it; re-aligning in the lib (mirroring scenario.ts:199-236 exactly — union not intersection, same include-from default, same zero-fill, RAW values) is the only frozen-safe path. The lib imports scenario.ts **type-only** and never calls the engine.
- **SAMPLE convention** end-to-end (÷n−1) keeps DR/PCR internally consistent with the engine's sample-cov `correlation_matrix` + sample-std `volatility`. The factsheet body's POPULATION `pstdev` convention is a deliberately-coexisting different surface and is NOT used here.
- **A1 leverage asymmetry:** numerator σᵢ are standalone un-levered; the denominator σ_p is the realized levered portfolio std (`portfolio_daily_returns` already has leverage baked in by the engine). DR is the standard Choueifaty form. The genuinely leverage-invariant quantities are σᵢ and the correlation matrix.

## Consistency-Pin Mutation Proof

The 12-obs fixture is sized so a sample→population σ bleed shifts the rebuilt ρ by the (n−1)/n = 11/12 factor, exceeding the 3dp/0.001 tolerance. Empirically verified by mutating `constituentVols`' `stdDev(x, true)` → `stdDev(x, false)`:

```
=== with population bleed (consistency pin FAILS) ===
AssertionError: expected 1.089 to be close to 0.998,
  received difference is 0.09099999999999997, but expected 0.0005
```

ρ(A,B) jumps from 0.998 (sample, matches engine) to 1.089 (population bleed) — a 0.091 shift ≫ tolerance → RED. Restored to `true` → green. A population-std bleed cannot silently ship.

## Hand-Verified Golden Values (fixture)

- DR (equal weight) = **1.662551** (>1) ✓; under uniform 2x leverage σ_p doubles, σᵢ + matrix unchanged, DR halves (A1) ✓
- PCR = {A: 0.333324, B: 0.297104, C: 0.369572}, sums to **1.000000000**; portVar ≡ σ_p² ✓
- Signed hedge (A + ρ=−1 leg D, weights 0.7/0.3): PCR(D) = **−0.891892** (negative, not clamped), A+D sum = 1 ✓
- ENB = **2.976552**; equal-PCR k legs → ENB=k (3-leg → 3.0) ✓
- Cluster order: A,B (ρ≈0.998) always adjacent, C the outlier ✓
- Too-similar: exactly {A,B} flagged at ρ≥0.85 ✓

## Deviations from Plan

**1. [Rule 3 - Blocking] Nested `/* */` in a JSDoc comment broke the oxc parser**
- **Found during:** Task 1 first test run.
- **Issue:** An inline `/*sample*/` clarifier inside a `/** ... */` block comment prematurely closed the block (PARSE_ERROR at diversification.ts:186).
- **Fix:** Rewrote the clarifier as `sample=true` (no nested comment delimiter).
- **Files modified:** src/lib/diversification.ts
- **Commit:** 5364d55e

**2. [Rule 1 - Test correctness] Leverage-invariance test asserted the wrong invariant**
- **Found during:** Task 2 first full run.
- **Issue:** The plan's `<behavior>` truth ("DR is unchanged when leverage is applied") is the leverage-invariance of the *correlation matrix and σᵢ*, NOT of the DR *magnitude*. The first draft asserted DR-magnitude equality, which contradicts the same plan's locked A1 asymmetry (un-levered numerator / levered denominator → DR magnitude genuinely changes; asserting both-levered would force DR≈1 always — exactly the failure mode A1 warns against). The implementation was correct; the test encoded a muddled intent.
- **Fix:** Rewrote the test to pin the actually-correct, A1-consistent properties: (a) the engine `correlation_matrix` is byte-identical under leverage, (b) the re-aligned σᵢ are leverage-independent (the lib never levers the per-constituent series, Pitfall 4), (c) σ_p doubles under 2x leverage so DR halves (the documented Choueifaty asymmetry). This honors Rule 9 (tests verify intent) by pinning the asymmetry rather than masking it.
- **Files modified:** src/lib/diversification.test.ts
- **Commit:** 66cce49d

## Verification

- `npx vitest run src/lib/diversification.test.ts --no-file-parallelism` → 29/29 green (incl. consistency pin).
- `npx vitest run src/lib/scenario.test.ts src/components/portfolio/CorrelationHeatmap.test.tsx` → 57/57 green (frozen engine + reused heatmap untouched).
- `npx tsc --noEmit` clean; `npx eslint` clean.
- Acceptance greps: ENB uses `Σ p*p` (risk-based, not weight-HHI); PCR guards `portVar > 1e-15`; no `stdDev(...false)`/`pstdev` bleed (only the prose "POPULATION" doc word); `git diff` source = only the two diversification files (scenario.ts untouched).

## Known Stubs

None — the library is fully implemented and golden-tested. Panel wiring (composer input build + ScenarioFactsheetChart render) is a separate Phase 41 wave by design; this plan delivers only the pure-TS math surface per its scope.

## Self-Check: PASSED

- `src/lib/diversification.ts` — FOUND
- `src/lib/diversification.test.ts` — FOUND
- `41-01-SUMMARY.md` — FOUND (gitignored ledger, written to disk per the sequential-executor contract)
- Commit 5364d55e (Task 1) — FOUND
- Commit 66cce49d (Task 2) — FOUND
- Source files committed clean; no `.planning/` / STATE / ROADMAP staged.
