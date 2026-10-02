---
phase: 22-methodology-honesty-scaffolding
plan: 02
subsystem: ui
tags: [honesty-gate, sample-floor, empty-state, contracts-registry, scenario, vitest, tdd]

# Dependency graph
requires:
  - phase: 21-surfacing-correlation-honest-projection
    provides: "CorrelationHeatmap empty-state shell (pinned tokens), scenario-history.ts/min-history.ts pure-lib conventions, ComputedMetrics.n overlapping-day count"
provides:
  - "src/lib/sample-floor.ts — HONEST-02 single source: SAMPLE_FLOOR_OVERLAPPING_DAYS=60 + evaluateSampleFloor gate + reason/empty-state copy builders"
  - "SampleFloorEmptyState — below-floor honest empty state (verbatim CorrelationHeatmap shell), reason-routed body naming N + floor"
  - "CONTRACT_GUARDS registration pinning the floor value + every gate branch (fails loud if forked)"
affects: [26-stress-var, 27-monte-carlo]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure-lib floor gate (guard-first, never-throws, value-pinned) modeled on scenario-history.ts + min-history.ts"
    - "Single-source named constant + CONTRACT_GUARDS pin so downstream phases import, never re-declare, the floor"
    - "Empty-state shell reuse by COPYING markup tokens (not importing the source component) — separate statistic-specific threshold, shared visual shell"

key-files:
  created:
    - src/lib/sample-floor.ts
    - src/lib/sample-floor.test.ts
    - src/components/scenarios/SampleFloorEmptyState.tsx
    - src/components/scenarios/SampleFloorEmptyState.test.tsx
  modified:
    - src/__tests__/contracts/contracts-registry.test.ts
    - src/__tests__/contracts/REGISTRY.md

key-decisions:
  - "SAMPLE_FLOOR_OVERLAPPING_DAYS named distinctively (NOT MIN_*) to avoid grep collision with min-history.ts's MIN_DAYS consts (Pitfall 3)"
  - "Guard (null/NaN/non-finite/negative) evaluated FIRST so Infinity never passes despite > floor (Pitfall 2 / T-22-04)"
  - "Component imports copy builders + heading from @/lib/sample-floor and COPIES the CorrelationHeatmap markup — it does not import/modify CorrelationHeatmap (different threshold, shared shell)"
  - "0/1-strategy route uses a call-site strategyCount prop (the pure gate cannot see strategy count) and takes precedence over the numeric verdict"

patterns-established:
  - "HONEST single-source floor primitive: one exported const + a never-throws verdict gate + exported reason copy, pinned in CONTRACT_GUARDS — the template Phases 26/27 reuse"
  - "Honest below-floor empty state = neutral (no role=alert, no red/warning); names the actual N + floor, never 'No data', never a fabricated number"

requirements-completed: [HONEST-02]

# Metrics
duration: ~14min
completed: 2026-06-21
---

# Phase 22 Plan 02: Sample-Floor Honesty Primitive Summary

**HONEST-02 single-source minimum-sample floor: a pure `evaluateSampleFloor` gate (default 60 overlapping days, override-able) that never passes a null/NaN/non-finite/negative/below-floor n, a verbatim-shell below-floor empty state naming the actual N + floor, and a CONTRACT_GUARDS pin that fails loud if a future feature forks the floor.**

## Performance

- **Duration:** ~14 min
- **Started:** 2026-06-21T18:38:00Z
- **Completed:** 2026-06-21T18:43:00Z
- **Tasks:** 2
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- `src/lib/sample-floor.ts` — the ONE source of truth for the distributional/tail floor: `SAMPLE_FLOOR_OVERLAPPING_DAYS = 60`, `evaluateSampleFloor(n, floor?) → { ok, n, floor, reason }` (guard-first, never throws), and the heading + three reason-body copy builders. Phases 26/27 import this; they never re-declare `60`.
- `SampleFloorEmptyState` — the below-floor honest empty state, reusing the Phase-21 `CorrelationHeatmap` shell verbatim, reason-routing the body (0/1-strategy → no-usable-n → below-floor names N + floor). Not an alert, no red/warning color.
- Pinned the floor value + every gate branch in `sample-floor.test.ts` and registered it in `CONTRACT_GUARDS` (+ `REGISTRY.md` row) so a silent fork/drop fails loud.
- 100% statement/branch/function/line coverage on both new files (Pitfall 4 coverage defense — the new gate cannot regress the blocking coverage gate).

## Task Commits

Each task was committed atomically (TDD: failing test written first, then implementation, committed together per task):

1. **Task 1: sample-floor primitive + exhaustive gate-branch pin** - `3f7cdf8d` (feat)
2. **Task 2: below-floor honest empty state + single-source pin registration** - `e1243395` (feat)

**Plan metadata:** (this SUMMARY + STATE.md + ROADMAP.md) — see final docs commit.

## Files Created/Modified
- `src/lib/sample-floor.ts` - HONEST-02 single-source: floor const + `evaluateSampleFloor` gate + reason/empty-state copy builders (pure, never throws)
- `src/lib/sample-floor.test.ts` - Value pin `toBe(60)` + exhaustive gate-branch matrix (ok / below-floor / no-usable-n incl. null/NaN/±Infinity/negative / per-call override) + copy-naming assertions (19 tests)
- `src/components/scenarios/SampleFloorEmptyState.tsx` - Below-floor honest empty state, verbatim CorrelationHeatmap shell, reason-routed body
- `src/components/scenarios/SampleFloorEmptyState.test.tsx` - RTL render proof: names N + floor, no fabricated number, not role=alert/not red, pinned shell tokens (5 tests)
- `src/__tests__/contracts/contracts-registry.test.ts` - +1 CONTRACT_GUARDS entry for `sample-floor.test.ts` (EXPECTED_RULES untouched)
- `src/__tests__/contracts/REGISTRY.md` - matching human-readable registry row

## Decisions Made
- **Named the const `SAMPLE_FLOOR_OVERLAPPING_DAYS`, not `MIN_*`** — to avoid a grep collision with `min-history.ts`'s `*_MIN_DAYS` chart constants (Pitfall 3). It is documented as distinct from both the correlation engine's 10-day bar and the 250/365 chart bars.
- **Guard branch first** — `n == null || !Number.isFinite(n) || n < 0` returns `no-usable-n` before the `< floor` check, so an `Infinity` never passes despite being `> floor` (Pitfall 2 / threat T-22-04). `n` is normalized to `null` in the no-usable-n verdict so callers never read a poisoned value.
- **Component copies the shell, does not import CorrelationHeatmap** — the 60-day distributional floor and the 10-day correlation bar are different statistic-specific thresholds that merely share a visual shell; coupling them would invite a future unintended unification. The component imports only the copy builders + heading + verdict type from `@/lib/sample-floor`.
- **`0/1-strategy` body is a call-site prop, not a gate output** — the pure gate cannot see strategy count, so `SampleFloorEmptyState` takes an optional `strategyCount` and routes `< 2` to the few-strategies body (takes precedence over the numeric verdict), matching the locked interface's precedence order.

## Deviations from Plan

None - plan executed exactly as written. (One cosmetic comment reword: the component doc-comment originally contained the literal substring `role="alert"` in prose, which tripped the plan's own `grep -c 'role="alert"'` verify check as a false positive; reworded the comment to "not an alert role" so the verify grep cleanly returns 0. No behavior change; the component never had an alert role.)

## Issues Encountered
- The Task 2 verify grep `grep -c 'role="alert"'` matched the phrase inside a doc comment (a false positive). Resolved by rewording the comment; the component carries no alert role and the render test asserts `screen.queryByRole("alert")` is null.

## User Setup Required
None - no external service configuration required. This plan adds zero packages (no supply-chain surface, threat T-22-SC N/A).

## Next Phase Readiness
- **HONEST-02 primitive is exported and pinned.** Phases 26 (Stress/VaR) and 27 (Monte-Carlo) import `SAMPLE_FLOOR_OVERLAPPING_DAYS`, `evaluateSampleFloor`, and the copy builders + render `SampleFloorEmptyState` for any below-floor input — they pass their own `floor` per-call and supply `feature` + `strategyCount` at the call site.
- **Deferred (per plan scope):** the 60-day gate is NOT retrofitted onto the live composer/sandbox projection (would change Phase-21 ≥10-day behavior — RESEARCH Open Q3); per-call degenerate routing (0/1 strategy, metric-nullity at large n) lives at the future call site. No ESLint rule was added (deferred to 26/27 per RESEARCH A3 / B16-B17 precedent).
- **No blockers.** Full suite green (6208 passed), new-file coverage 100% on all four dimensions, engine untouched.

## Self-Check: PASSED
- FOUND: src/lib/sample-floor.ts
- FOUND: src/lib/sample-floor.test.ts
- FOUND: src/components/scenarios/SampleFloorEmptyState.tsx
- FOUND: src/components/scenarios/SampleFloorEmptyState.test.tsx
- FOUND commit: 3f7cdf8d (Task 1)
- FOUND commit: e1243395 (Task 2)

---
*Phase: 22-methodology-honesty-scaffolding*
*Completed: 2026-06-21*
