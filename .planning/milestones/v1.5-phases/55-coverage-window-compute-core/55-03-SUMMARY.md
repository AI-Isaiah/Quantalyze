---
phase: 55-coverage-window-compute-core
plan: 03
subsystem: testing
tags: [vitest, numpy, scenario, coverage-window, golden-fixture, blend07]

# Dependency graph
requires:
  - phase: 55-01
    provides: scenario-window.ts (coverageSpanOf, defaultWindowFor, covers)
  - phase: 55-02
    provides: computeScenario coverage-window path + additive member_count/member_ids
provides:
  - Committed deterministic 6-series fixture (mm/neon1/pokeokx/uc244+okx/bybit)
  - From-scratch numpy verification artifact (OLD + NEW numbers, divisor fact)
  - CI-enforced vitest gate asserting computeScenario == numpy over max-overlap window
  - The Phase 60 precondition — this gate is GREEN before any golden re-bake
affects: [56-factsheet-parity, 60-golden-rebake]

# Tech tracking
tech-stack:
  added: []  # zero new deps — numpy is the pre-provisioned analytics-service venv, run-once
  patterns:
    - "Committed deterministic golden fixture + independent numpy oracle recorded in a tracked markdown artifact, pinned by a hermetic vitest gate"
    - "Fixture provenance documented in-artifact when real prod data is not committable"

key-files:
  created:
    - src/lib/__fixtures__/blend07-six-series.json
    - src/lib/__fixtures__/BLEND-07-verification.md
    - src/lib/scenario-blend07.test.ts
    - analytics-service/scripts/gen_blend07_fixture.py
  modified: []

key-decisions:
  - "Artifact + fixture live at src/lib/__fixtures__/ (tracked), NOT .planning/ (gitignored) — a committed durable artifact was the CONTEXT Q3 requirement"
  - "Fixture is a deterministic fixed-seed synthesis (real 6-series not committable, live pull non-deterministic) with one ended-tail member so max-overlap < union"
  - "fp precision = toBeCloseTo at the payload rounding (5 dp twr/cagr/vol/maxDD, 3 dp sharpe); raw TS/numpy series agree to ~1e-10"

patterns-established:
  - "Independent-oracle gate: the numpy number the goldens do NOT derive from is the defense against a Phase-60 re-bake masking a math bug"

requirements-completed: [BLEND-07]

# Metrics
duration: 18min
completed: 2026-07-01
---

# Phase 55 Plan 03: BLEND-07 From-Scratch Numpy Verification Gate Summary

**A committed deterministic 6-series fixture + an independent from-scratch numpy re-derivation (recorded in a tracked markdown artifact) + a hermetic vitest gate that pins `computeScenario` to the numpy blend over the max-overlap window to floating-point precision with divisor === live-member count — GREEN before any Phase 60 golden re-bake.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-07-01T15:33:00Z
- **Completed:** 2026-07-01T15:40:00Z
- **Tasks:** 2
- **Files modified:** 4 created, 0 modified

## Accomplishments

- **Deterministic 6-series fixture** (`blend07-six-series.json`) with the real strategy ids `mm/neon1/pokeokx/uc244+okx/bybit`, staggered inceptions, a longer union span, and one **ended-tail member** (`pokeokx` last day `2025-12-31`) so the max-overlap window `[2023-10-11, 2025-12-31]` is strictly tighter than the union — the shape that proves the ended strategy no longer dilutes.
- **From-scratch numpy artifact** (`BLEND-07-verification.md`) recording the full numpy script (252-annualization, `ddof=1`, `rf=0` — matching `scenario.ts:497-543`), the **NEW** window-bounded numbers (total +115.68%, CAGR 39.57%, Sharpe 2.967, MaxDD −6.03%, n=581, divisor=6), the **OLD** union prod-audit numbers (+586.86% / 51.82% / 2.43 / −15.15% / n=1163) for contrast, and the divisor===live-member-count invariant.
- **Hermetic vitest gate** (`scenario-blend07.test.ts`, 4 tests) — loads the fixture, derives the window via `defaultWindowFor`, runs `computeScenario` with an explicit window + equal weights, and asserts every metric matches the numpy oracle to fp precision AND `member_count === 6`. Plus an **anti-dilution assertion**: extending the window to the union end drops `pokeokx` (member_count 6 → 5) — the exact v1.5 behavior.
- **Engine reproduces numpy exactly** at the payload precision (twr 1.15679, cagr 0.39567, vol 0.11463, sharpe 2.967, maxDD −0.06029). Full suite green: 617 files / 7252 tests pass; 5 frozen-spine guards green (new files don't trip them); `tsc --noEmit` clean.

## Task Commits

1. **Task 1: Commit the deterministic 6-series fixture + record the from-scratch numpy artifact** — `49286631` (test)
2. **Task 2: Write the vitest gate asserting computeScenario == numpy over the max-overlap window** — `2ab2cc99` (test)

_Note: Task 2 was tagged `tdd="true"`. As a verification gate against the already-landed 55-02 engine, the RED/GREEN sequence collapses: the test encodes the independent numpy oracle and the engine (landed in 55-02) satisfies it. There was one genuine RED-then-GREEN cycle within the task — a bug in the test's own fixture-shape assertion (see Deviations)._

## Files Created/Modified

- `src/lib/__fixtures__/blend07-six-series.json` — deterministic committed 6-series fixture (map id → `{date, value}[]`); 18.7k lines (the 6 raw return series).
- `src/lib/__fixtures__/BLEND-07-verification.md` — the durable numpy artifact: script + OLD/NEW numbers + divisor fact + reproduce steps.
- `src/lib/scenario-blend07.test.ts` — the CI-enforced gate (4 tests: fixture-shape pin, derived-window pin, fp-precision blend match, anti-dilution exclusion).
- `analytics-service/scripts/gen_blend07_fixture.py` — run-once idempotent generator (fixed RNG seeds) that produces the fixture and prints the numpy numbers.

## Decisions Made

- **Artifact location corrected to a tracked path** (`src/lib/__fixtures__/BLEND-07-verification.md`), NOT the plan's `.planning/phases/55-.../` location, because `.planning/` is gitignored in this repo — a committed durable artifact was the whole point of CONTEXT Q3. Co-located with the tracked fixture JSON. (Per the executor's critical-path override.)
- **Fixture is a deterministic fixed-seed synthesis, not a prod pull.** The real 6-series are not committed anywhere in-repo and a live pull is non-deterministic (can't run hermetically in CI — 55-RESEARCH A2). The synthesis reproduces the shape that matters (staggered spans + ended-tail member); provenance is documented in the artifact.
- **fp precision = `toBeCloseTo` at the payload's own rounding** (5 dp for twr/cagr/vol/maxDD, 3 dp for Sharpe per `scenario.ts:617-622`). The raw TS and numpy series agree to ~1e-10 before rounding; the committed artifact records the rounded payload numbers.
- **Added an anti-dilution assertion** beyond the plan's stated behavior: the plan's gate asserts the blend over the derived (tightest) window where all 6 are members; I added a second window that extends to the union end to directly demonstrate `pokeokx` (ended) being EXCLUDED (member_count 6 → 5). This is the literal BLEND-07 claim ("proving the ended strategy no longer dilutes") and would otherwise only be implicit.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `toBeLessThan` on ISO-date strings in the fixture-shape assertion**
- **Found during:** Task 2 (vitest gate), first run
- **Issue:** The fixture-shape sanity test compared `pokeokx`'s end date against the union end via `expect(...).toBeLessThan(...)`, which requires number/bigint — vitest threw `TypeError: actual value must be number or bigint, received "string"`.
- **Fix:** Switched to lexicographic string compare (`expect(pokeokxEnd < unionEnd).toBe(true)`) — ISO `YYYY-MM-DD` dates are chronological under string compare, consistent with the `dateday.ts` convention used throughout the engine.
- **Files modified:** `src/lib/scenario-blend07.test.ts`
- **Verification:** All 4 gate tests green; full suite (7252) green.
- **Committed in:** `2ab2cc99` (Task 2 commit — the fix was applied before the task was committed).

---

**Total deviations:** 1 auto-fixed (1 bug, all in the executor's own new test code — not the engine).
**Impact on plan:** No scope creep. The artifact-location correction and the anti-dilution assertion strengthen the deliverable against its stated purpose. The engine (55-02) was NOT touched — this plan is pure verification.

## Issues Encountered

None beyond the one test-code bug documented above. The engine reproduced the independent numpy oracle exactly on the first probe, confirming the 55-02 coverage-window math is correct — which is the entire point of BLEND-07.

## User Setup Required

None — pure client-side compute verification. numpy is the pre-provisioned `analytics-service` venv, used run-once at dev time; not a new project dependency.

## Next Phase Readiness

- **BLEND-07 is complete and GREEN** — the milestone's #1 correctness anchor and the explicit precondition for Phase 60. `npx vitest run src/lib/scenario-blend07.test.ts` passes; it is part of `npm test` (hermetic, no network, no seed-gate).
- Phase 56 (Factsheet Parity Re-Verify, PARITY-01) can proceed — this plan touched no engine code and no factsheet surface, so the parity-by-construction contract is intact.
- **Do NOT re-bake any golden until Phase 60** — this gate must stay green through 56–59 first (the #1 defense against a re-bake masking a regression).

## Self-Check: PASSED

- FOUND: `src/lib/__fixtures__/blend07-six-series.json`
- FOUND: `src/lib/__fixtures__/BLEND-07-verification.md`
- FOUND: `src/lib/scenario-blend07.test.ts`
- FOUND: `analytics-service/scripts/gen_blend07_fixture.py`
- FOUND: commit `49286631` (Task 1)
- FOUND: commit `2ab2cc99` (Task 2)
- `npx vitest run src/lib/scenario-blend07.test.ts` → 4 passed
- `npx tsc --noEmit` → exit 0
- Full suite `npm test` → 617 files / 7252 tests passed

---
*Phase: 55-coverage-window-compute-core*
*Completed: 2026-07-01*
