---
phase: 26-stress-testing-var
plan: 01
subsystem: testing
tags: [typescript, vitest, var, cvar, expected-shortfall, beta-shock, stress-test, scenario, honesty-contract]

# Dependency graph
requires:
  - phase: 24-scenario-benchmark
    provides: computeScenarioBenchmark + innerJoinByDate (the β source + intersection alignment) and the null-on-degenerate relative-scale guard pattern
  - phase: 22-sample-floor
    provides: SAMPLE_FLOOR_OVERLAPPING_DAYS=60 + evaluateSampleFloor (the floor SoT the section — plan 26-02 — gates on)
provides:
  - "Pure null-safe computeScenarioStress(portfolioDaily, btcDaily, opts) lib over the already-leveraged portfolio_daily_returns"
  - "Historical (empirical floor-quantile) VaR + tail-mean CVaR, WRAP-not-fork around computeVaR/computeExpectedShortfall"
  - "β-propagated shock projectedImpact = computeScenarioBenchmark(...).beta · shock over the BTC inner-join intersection"
  - "Two distinct overlap-N fields (varN = scenario overlap, betaN = BTC inner-join overlap)"
  - "Falsifiable golden+invariant+degeneracy test matrix mitigating the full honesty/correctness threat class (T-26-01..06)"
affects: [26-02 StressVarSection (consumes computeScenarioStress + the two Ns), 27-monte-carlo, 28-optimizer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wrap-not-fork: reuse golden-tested arithmetic (computeVaR/computeExpectedShortfall/computeScenarioBenchmark) behind a null-on-degenerate envelope so a fabricated 0 can never escape"
    - "Relative-scale degeneracy guard (sqrt(var) <= 1e-12·(|mean|+1e-12)) for the float-residue-constant series case, NOT exact === 0"
    - "Two-N discipline: VaR window N and β-shock window N tracked as two distinct result fields"
    - "Structure-keyed negative control: assert the VaR is an exact sample order statistic (a parametric/interpolated impl fails structurally, not on a magnitude epsilon)"

key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/scenario-stress.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-stress.test.ts"
  modified: []

key-decisions:
  - "WRAP computeVaR/computeExpectedShortfall (never fork) — short-circuit to null on degeneracy BEFORE calling them so the 'return 0 on empty' trap can never surface a fabricated 0"
  - "Reuse computeScenarioBenchmark for β (NOT computeAlphaBeta directly) to inherit its constant-BTC relative-scale guard"
  - "Read betaN from innerJoinByDate(...).p.length explicitly (rather than computeScenarioBenchmark(...).n) so the two-N intent is unambiguous at the call site"
  - "VaR computed on the raw already-leveraged series with NO leverage multiplier (leverage is baked into portfolio_daily_returns via w·L·r); the 2×-leverage test PROVES scaling is automatic"
  - "Strengthened the 'not parametric' negative control to key on STRUCTURE (result === an exact order statistic) instead of a magnitude epsilon, after the Normal-tail value landed coincidentally close (0.0026) for this series"

patterns-established:
  - "Wrap-not-fork null-on-degenerate envelope over reused arithmetic"
  - "Two-N result interface (varN / betaN) for two statistics over two overlap windows"

requirements-completed: [STRESS-01, STRESS-02]

# Metrics
duration: 18min
completed: 2026-06-22
---

# Phase 26 Plan 01: Stress-Testing / VaR Math Lib Summary

**Pure null-safe `computeScenarioStress` lib — historical floor-quantile VaR + tail-mean CVaR (wrap-not-fork over `computeVaR`/`computeExpectedShortfall`) and a β-propagated BTC shock (`β·shock` over the inner-join intersection), with two distinct overlap-Ns and a falsifiable golden+invariant+degeneracy test matrix that fails loud on every honesty bug.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-22T13:55:00Z (approx)
- **Completed:** 2026-06-22T13:59:00Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- `computeScenarioStress(portfolioDaily, btcDaily, { confidence=0.95, shock=-0.30 })` returns `{ varN, betaN, beta, projectedImpact, var, cvar }`, every numeric estimate `number | null`, null on degeneracy so the consumer renders an em-dash.
- VaR/CVaR path WRAPS (never forks) `computeVaR`/`computeExpectedShortfall` behind a null-on-degenerate envelope (empty series + float-residue-constant series via the `1e-12` relative-scale guard) so the "return 0 on empty" trap can never leak a fabricated 0.
- β-shock path REUSES `computeScenarioBenchmark(...).beta` (inheriting its constant-BTC guard) over the BTC inner-join; `projectedImpact = beta · shock`; null β ⇒ null impact.
- Two distinct overlap-N fields tracked: `varN` (scenario overlap = `portfolioDaily.length`) and `betaN` (BTC inner-join overlap = `innerJoinByDate(...).p.length`).
- 11-test falsifiable matrix (all green, <1s): golden VaR/CVaR oracle (`-0.060`/`-0.070`), not-parametric structural negative control, near-market-neutral β≈0 invariant, positive-β `β·shock`, intersection-not-union, 2×-leverage VaR-doubles-but-Sharpe-invariant, drawdown-monotone caveat, and the full degeneracy null matrix.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build the null-safe computeScenarioStress lib (wrap-not-fork)** - `2f97b8c7` (feat)
2. **Task 2: Pin the golden oracle + invariant + degeneracy test matrix** - `b6cc4123` (test)

_Note: Task 1 carried `tdd="true"`; the plan splits the lib (Task 1) and its dedicated test matrix (Task 2) into separate tasks, so each task is a single commit rather than a RED/GREEN pair within one task._

## Files Created/Modified
- `src/app/(dashboard)/allocations/lib/scenario-stress.ts` (145 lines) - Pure, side-effect-free `computeScenarioStress` + `ScenarioStress` interface. VaR/CVaR wrap, β-shock reuse, two-N tracking, relative-scale degeneracy guard.
- `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` (322 lines) - The golden VaR/CVaR oracle, the near-market-neutral β invariant, the positive-β `β·shock` test, intersection-not-union, the 2×-leverage VaR/CVaR-scales-but-Sharpe-invariant contrast, the drawdown-monotone caveat, and the degeneracy null matrix.

## Decisions Made
- **Wrap, not fork** the VaR/CVaR arithmetic (per RESEARCH recommendation A4): one tested arithmetic source, only the null-on-degenerate envelope + relative-scale guard added in the new lib.
- **`computeScenarioBenchmark` for β, not `computeAlphaBeta`** directly: the benchmark function adds the relative-scale guard that catches a numerically-constant BTC series (whose float-residue variance ~1e-37 would otherwise fabricate a finite β ~2 through `computeAlphaBeta`'s `varB > 0` branch).
- **`betaN` read from `innerJoinByDate(...).p.length`** explicitly (equivalent to `computeScenarioBenchmark(...).n`) to make the two-N intent unambiguous at the call site.
- **No leverage multiplier in the lib** — leverage is already baked into `portfolio_daily_returns`; the 2×-leverage test proves the scaling is automatic.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Strengthened the "not parametric" negative control to be structurally falsifiable**
- **Found during:** Task 2 (the test matrix)
- **Issue:** The plan's "not parametric" control asserted `|VaR − NormalTail| > 0.005`. For the specific 20-value RESEARCH series the parametric Normal-tail value (`mean − 1.645·std ≈ −0.0574`) lands only ~0.0026 from the floor-quantile `−0.060`, so a magnitude-epsilon control of 0.005 was not satisfiable and — more importantly — would have been a weak, series-dependent control (Rule 9: a test must encode WHY, here that the model is empirical, not the coincidental magnitude gap).
- **Fix:** Re-keyed the negative control on the *structure* of a historical (type-1, floor) VaR: the result must be an EXACT member of the observed sample (`expect(SORTED).toContain(r.var)` + `toBe(-0.06)`), which a parametric Normal VaR or a linear-interpolation (R-7) quantile structurally cannot be. The R-7 value (`≈ −0.061`) is also computed and asserted distinct. This is falsifiable against both alternative models regardless of how close their magnitudes happen to fall.
- **Files modified:** src/app/(dashboard)/allocations/lib/scenario-stress.test.ts
- **Verification:** Test passes; the control now fails loud for both a Normal-tail and an interpolated quantile impl.
- **Committed in:** `b6cc4123` (Task 2 commit)

**2. [Rule 3 - Blocking] Fixed the test date-fixture helper for n>=60 fixtures**
- **Found during:** Task 2 (the degeneracy null matrix)
- **Issue:** The plan modeled the n>=60 fixtures on the benchmark test's single-month `days(n)` helper (`2024-01-NN`), which cannot produce more than 31 distinct strictly-increasing dates. The `days(31).concat(days(31).map(s => s.replace("01-","02-")))` workaround yielded only 62 dates (and the orthogonality math in the near-market-neutral test needed a whole number of period-4 blocks), so the `toBe(64)` overlap assertions failed.
- **Fix:** Added a `manyDays(n)` helper that rolls dates across 28-day months to produce N distinct ISO dates, and used it for all n>=60 fixtures (near-market-neutral, leverage, both degenerate-null cases).
- **Files modified:** src/app/(dashboard)/allocations/lib/scenario-stress.test.ts
- **Verification:** All 11 tests pass; `varN`/`betaN` assert exactly 64.
- **Committed in:** `b6cc4123` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 bug — test-intent hardening, 1 blocking — fixture helper).
**Impact on plan:** Both confined to the test file (Task 2). No change to the lib's surface or to the plan's invariants; the golden oracle, the two-N interface, the wrap-not-fork lib, and every named test from the plan are present and pass. No scope creep — the lib (`scenario-stress.ts`) was implemented exactly as specified.

## Issues Encountered
None beyond the two test-side deviations above. The lib type-checked and passed its grep acceptance criteria on first write.

## Threat Surface Scan
No new security-relevant surface. This plan adds NO server endpoint, NO migration, NO Python, NO auth, NO route, NO dependency, NO persistence (per the plan `<threat_model>` and RESEARCH §Security Domain). The threat class is honesty/correctness only, and each register entry (T-26-01..06) has a passing falsifiable test:
- T-26-01 (fabricated number) → "degenerate null" matrix + the `1e-12` relative-scale guard in the lib.
- T-26-02 (leverage mis-scaling) → "leverage scales VaR not Sharpe" (2× VaR/CVaR + Sharpe invariant); no leverage multiplier re-applied.
- T-26-03 (union-not-intersection) → "intersection not union" (divergent non-overlapping value does not move the impact).
- T-26-04 (parametric/wrong tail) → golden VaR/CVaR oracle + structural "not parametric" control.
- T-26-05 (face-value shock) → "near-market-neutral" (cov≈0 ⇒ |impact| < 1e-9, not 0.30).
- T-26-06 (wrong N) → `varN`/`betaN` as two distinct fields; the intersection + degeneracy tests exercise the smaller BTC overlap independently.

## Known Stubs
None. Both files are complete; no placeholder values, no TODO/FIXME, no unwired data source. The lib is pure and fully exercised by the test matrix.

## Next Phase Readiness
- Plan 26-02 (`StressVarSection.tsx` + its test + the `ScenarioComposer` mount seam) can consume `computeScenarioStress` and thread `varN`/`betaN` into the two floor gates + two methodology captions exactly as RESEARCH §Two-N trap describes.
- No blockers. No new dependency, no migration, no Python — consistent with the phase lock.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/lib/scenario-stress.ts` — FOUND
- `src/app/(dashboard)/allocations/lib/scenario-stress.test.ts` — FOUND
- `.planning/phases/26-stress-testing-var/26-01-SUMMARY.md` — FOUND
- Commit `2f97b8c7` (Task 1, feat) — FOUND
- Commit `b6cc4123` (Task 2, test) — FOUND
- Tests: 11/11 passing; `tsc --noEmit` clean for scenario-stress.*
