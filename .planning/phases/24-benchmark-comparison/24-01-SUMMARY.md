---
phase: 24-benchmark-comparison
plan: 01
subsystem: analytics
tags: [typescript, scenario, benchmark, alpha-beta, tracking-error, information-ratio, capm, inner-join, vitest, tdd]

# Dependency graph
requires:
  - phase: 23-scenario-persistence
    provides: computeScenario engine + ComputedMetrics shape + ScenarioComposer mount
provides:
  - "ComputedMetrics.portfolio_daily_returns? — additive OPTIONAL full-resolution, unrounded daily portfolio-return series (the source the BTC benchmark inner-join reads)"
  - "scenario-benchmark.ts — innerJoinByDate (date-intersection alignment) + computeScenarioBenchmark (TE/IR/alpha/beta/correlation over the aligned window, 252-annualized)"
  - "Golden + intersection + null-safety test pins for BENCH-01 honesty invariants"
affects: [benchmark-comparison-ui, scenario-composer-benchmark-section, btc-overlay]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Date-keyed inner-join (intersection, no zero-fill) BEFORE the positional computeAlphaBeta/computeTrackingError helpers"
    - "Relative-scale degeneracy detection (std <= 1e-12·(|mean|+1e-12)) instead of exact ===0 to surface null for a numerically-constant series"
    - "Additive OPTIONAL field on a widely-imported interface → zero construction-site edits, fully non-breaking"

key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/scenario-benchmark.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts"
  modified:
    - "src/lib/scenario.ts"
    - "src/lib/scenario.test.ts"

key-decisions:
  - "Constant-benchmark degeneracy detected by RELATIVE scale, not exact varB===0 — float residue from mean-subtraction leaves ~1e-37 variance that produced a meaningless beta of ~2 (Rule 1 bug, caught by the pinned test)"
  - "portfolio_daily_returns declared OPTIONAL so the two external ComputedMetrics construction sites (liveBaselineToComputedMetrics, NULL_METRICS) compile unchanged"
  - "All three degenerate early-returns set the field to [] (no false overlap window), including the activeIds.length===0 path the plan did not enumerate"

patterns-established:
  - "Inner-join intersection alignment mirrors analytics-service/routers/portfolio.py:915-916 (reindex().dropna())"
  - "Null-not-zero honesty: every degenerate metric surfaces null for the UI em-dash, never a fabricated 0"

requirements-completed: [BENCH-01]

# Metrics
duration: 6min
completed: 2026-06-22
---

# Phase 24 Plan 01: Benchmark Comparison (data primitives) Summary

**Pure-TS BTC active-return engine: date-intersection inner-join + TE/IR/alpha/beta/correlation (252-annualized, reusing computeAlphaBeta/computeTrackingError), plus an additive OPTIONAL full-resolution daily portfolio-return series on computeScenario as the source it reads from.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-06-21T23:42:25Z
- **Completed:** 2026-06-21T23:48:40Z
- **Tasks:** 3 (4 commits — Task 2 and Task 3 each TDD)
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments
- `scenario-benchmark.ts`: `innerJoinByDate` aligns scenario daily returns ∩ BTC daily returns by INTERSECTION (no zero-fill, no positional zip), and `computeScenarioBenchmark` assembles tracking error / information ratio / alpha / beta / correlation over the aligned window, reusing the golden-tested `computeAlphaBeta` + `computeTrackingError` (252-annualized, never √365).
- `computeScenario` now exposes `portfolio_daily_returns?` — the full-resolution, UNROUNDED daily portfolio-return series — additively and OPTIONALLY, with zero construction-site edits and zero regression to the 28 pre-existing `scenario.test.ts` pins.
- Honesty invariants pinned by test: intersection-not-union (a divergent value on a non-overlapping date does NOT move any metric), null-not-zero (n<2 → all null; constant benchmark var(b)=0 → beta/alpha/correlation null; te=0 → information ratio null), and `[]` on every degenerate scenario path.

## Task Commits

Each task was committed atomically:

1. **Task 1: golden test stub for scenario-benchmark.ts (RED)** — `81e0a2fa` (test)
2. **Task 2: implement scenario-benchmark.ts (inner-join + 4 metrics) (GREEN)** — `4a6ab302` (feat)
3. **Task 3 (RED): pin additive portfolio_daily_returns** — `87bd2dea` (test)
4. **Task 3 (GREEN): additive OPTIONAL portfolio_daily_returns on computeScenario** — `ec07307f` (feat)

_Task 1's test and Task 2's implementation form the RED→GREEN cycle for the benchmark lib; Task 3 is its own RED→GREEN cycle on scenario.ts._

## Files Created/Modified
- `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` — NEW. `innerJoinByDate` + `computeScenarioBenchmark` + `ScenarioBenchmark` type. Reuses `computeAlphaBeta`/`computeTrackingError` from `@/lib/portfolio-stats` and `mean` from `@/lib/portfolio-math-utils`.
- `src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts` — NEW. 14 pins: hand-computed goldens, intersection (n===4 with non-overlap exclusion), and null degenerate paths.
- `src/lib/scenario.ts` — added `portfolio_daily_returns?` to `ComputedMetrics`; built it from `commonDates`+`portDaily` on the success path; set it to `[]` on all three degenerate early-returns.
- `src/lib/scenario.test.ts` — 5 new `[24-01]` pins for the additive field (length/dates/unrounded + `[]` on every degenerate path + multi-strategy blend equivalence).

## Decisions Made
- **Relative-scale degeneracy detection** for the constant benchmark instead of `varB === 0`. See Deviations (Rule 1) — the exact check missed floating-point residue and produced a meaningless beta. Threshold `std <= 1e-12·(|mean|+1e-12)` flags any numerically-constant series while never mis-flagging a real BTC series.
- **Set `portfolio_daily_returns: []` on the `activeIds.length === 0` early-return too** (the plan enumerated only the n<10 and non-finite blocks). The field is optional so the absence would have compiled, but degenerate-honesty consistency demands `[]` on every degenerate path; additive, no harm, and the "no strategies selected" test pins it.
- Correlation surfaces `null` (not 0) on either-side zero variance, using the same relative-degeneracy guard as beta/alpha for internal consistency.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Constant-benchmark degeneracy missed by exact `varB === 0`**
- **Found during:** Task 2 (implement scenario-benchmark.ts)
- **Issue:** The plan/CONTEXT specify `varB === 0` as the constant-benchmark short-circuit. But a genuinely constant series (e.g. every value `0.003`) does NOT yield an exact-zero variance after floating-point mean subtraction: `mean([0.003×6]) === 0.0029999999999999996`, leaving ~`1.88e-37` residual variance. `varB === 0` was therefore `false`, `computeAlphaBeta` ran, and dividing two ~`1e-36` near-zero quantities produced a meaningless `beta` of ~2 — exactly the fabricated-number the honesty invariant forbids. The pinned "constant benchmark → beta null" test failed (`expected 2 to be null`).
- **Fix:** Replaced the exact equality with a relative-scale degeneracy test: `Math.sqrt(varB) <= 1e-12 * (Math.abs(meanB) + 1e-12)`. Applied the same guard to the correlation (std-based). This is the root-cause-correct criterion ("the benchmark's spread is negligible relative to its level") rather than a band-aid.
- **Files modified:** `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts`
- **Verification:** All 14 scenario-benchmark pins green, including the constant-benchmark (beta/alpha/correlation null) and te=0 (information ratio null) cases.
- **Committed in:** `4a6ab302` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix is load-bearing for the milestone's headline honesty invariant (a constant benchmark must render "—", not a fabricated 0/2). No scope creep — same surface, more robust degeneracy test.

## Issues Encountered
None beyond the deviation above. The `next-cache-components` skill hook fired on the `app/**` path suffix when writing the test file, but it is irrelevant here (pure-TS test, no route handler / no `use cache`); no action taken.

## User Setup Required
None — no external service configuration required. Frontend-only, pure-TS, no new deps, no Python, no migration.

## Next Phase Readiness
- BENCH-01 math + alignment primitives exist, golden-tested, 252-annualized, intersection-aligned, and null-safe (em-dash-ready).
- Plan 24-02/24-03 (the BTC GET route + the ScenarioComposer benchmark section/overlay/empty-state) can now consume `computeScenarioBenchmark(metrics.portfolio_daily_returns ?? [], btcDaily)` and gate render on `evaluateSampleFloor(n, 30)`.
- No blockers. `npm run typecheck` clean; consumers (scenario-compare, scenario-adapter, portfolio-stats) regression-checked green.

## Self-Check: PASSED

All created/modified files present on disk; all four task commits (`81e0a2fa`, `4a6ab302`, `87bd2dea`, `ec07307f`) confirmed in git history.

---
*Phase: 24-benchmark-comparison*
*Completed: 2026-06-22*
