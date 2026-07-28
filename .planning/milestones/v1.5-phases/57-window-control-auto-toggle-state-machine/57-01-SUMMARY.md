---
phase: 57-window-control-auto-toggle-state-machine
plan: 01
subsystem: api
tags: [typescript, coverage-window, scenario-blend, pure-helpers, interval-math]

# Dependency graph
requires:
  - phase: 55-coverage-window-compute-core
    provides: "scenario-window.ts primitives (coverageSpanOf, intersectionOf, defaultWindowFor, covers) + CoverageSpan/CoverageWindow types"
provides:
  - "unionOf(spans): CoverageWindow | null — the 'Full range (some drop out)' preset target (WINDOW-05), [min(firsts), max(lasts)] lexicographic; null only on empty set"
  - "outlierIdsFor(spansById): string[] — names the strategy id(s) breaking an empty coverage intersection so the WINDOW-06 banner can offer a one-click 'deselect {X}' fix"
affects: [57-02, 57-03, ScenarioComposer, useScenarioState, empty-intersection-banner, full-range-preset]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Union is the direction-mirror of intersection — same lexicographic min/max convention, opposite comparators; symmetry keeps ALL interval math in one file"
    - "Outlier detection delegates ALL intersection math to intersectionOf (no re-derived start>end inline) — single source of the overlap predicate"
    - "Candidate-order encodes the deterministic tie-break (max-first before min-last), keeping outlier detection O(n) instead of testing every removal"

key-files:
  created: []
  modified:
    - "src/lib/scenario-window.ts — added unionOf (below intersectionOf) + outlierIdsFor (below covers)"
    - "src/lib/scenario-window.test.ts — added 5 unionOf boundary-cell tests + 7 outlierIdsFor tests incl. removal-restores-overlap invariant"

key-decisions:
  - "unionOf returns null ONLY on empty input — a non-empty union always has a valid window (min(firsts) <= max(lasts) always holds), even for fully-disjoint spans. No start>end degenerate exists for union, unlike intersection."
  - "outlierIdsFor candidates are exactly two spans: the max-first (latest start) and min-last (earliest end). Dropping anything else cannot move both offending bounds — so the search is O(n), not O(n²)."
  - "Deterministic tie-break when both candidates individually restore overlap: prefer latest first, then earliest last (candidate array order [maxFirstId, minLastId])."
  - "If neither single removal restores overlap, return BOTH bounding ids (their joint removal restores a common window) — the empty-array-never case for a genuinely non-overlapping multi-way set."

patterns-established:
  - "Mirror-of-intersection: new window primitives are authored as the direction-symmetric twin of an existing one, reusing its comparator convention and doc-comment voice"
  - "Removal-restores-overlap invariant as a first-class test: every id returned by outlierIdsFor, when removed, must yield a non-null intersectionOf over the remainder (T-57-02 mitigation)"

requirements-completed: [WINDOW-05, WINDOW-06]

# Metrics
duration: 4min
completed: 2026-07-01
---

# Phase 57 Plan 01: unionOf + outlier-detection window helpers Summary

**Two pure, zero-dep window primitives added to `scenario-window.ts`: `unionOf` (the WINDOW-05 "Full range" preset target = widest [min-first, max-last] bounds) and `outlierIdsFor` (the WINDOW-06 empty-intersection fix = names the strategy id(s) whose removal restores a common window), both mirroring the Phase-55 lexicographic/null-on-empty contracts with no change to existing exports.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-01T16:06:00Z
- **Completed:** 2026-07-01T16:10:00Z
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files modified:** 2

## Accomplishments
- `unionOf(spans)` — the "Full range (some drop out)" preset target (WINDOW-05): `[min(firsts), max(lasts)]` by lexicographic string compare, the direction-mirror of `intersectionOf`. Returns `null` only for an empty set; a non-empty union (even fully-disjoint spans) always yields a valid window. Non-covering members are dropped downstream by `covers`, never by this helper.
- `outlierIdsFor(spansById)` — the WINDOW-06 "name the outlier(s)" source: given a `{strategyId → CoverageSpan}` map with an empty overall intersection, returns the id(s) whose removal restores a non-null intersection (the strategy(ies) the guided-fix banner names). Delegates ALL interval math to `intersectionOf` — no re-derived `start > end` inline.
- 12 new boundary-cell tests (5 union + 7 outlier), including the removal-restores-overlap invariant and no-mutation guards. All 28 scenario-window tests green; the 4 downstream consumer suites (66 tests) unaffected.

## Task Commits

Each task was committed atomically (TDD collapsed into a single feat commit per task — RED verified, then GREEN implemented before commit):

1. **Task 1: unionOf(spans) helper (WINDOW-05 target)** — `d1531f7e` (feat)
2. **Task 2: outlierIdsFor helper (WINDOW-06 target)** — `171a9040` (feat)

_Note: RED was verified for each task before GREEN (`unionOf is not a function` / `outlierIdsFor is not a function` failures observed), then the minimal implementation landed in the same task commit. `.planning/` is gitignored — this SUMMARY is local tracking only; no separate metadata commit is pushed._

## Files Created/Modified
- `src/lib/scenario-window.ts` — added `unionOf` (directly below `intersectionOf`, opposite comparators) + `outlierIdsFor` (below `covers`, delegating to `intersectionOf`). Additions-only; no existing export signature changed.
- `src/lib/scenario-window.test.ts` — added a `unionOf` describe block (5 cases: empty→null, single, overlapping, fully-disjoint→spanning-window, no-mutation) and an `outlierIdsFor` describe block (7 cases: empty map→[], single→[], valid-intersection→[], late-starter named, one-outlier-of-four named, removal-restores-overlap invariant, no-mutation).

## Decisions Made
- **unionOf has no null-degenerate beyond empty:** unlike intersection (`start > end` → null), a union's `min(firsts) <= max(lasts)` always holds for a non-empty set, so `null` is returned ONLY when `spans` is empty. Pinned in a boundary test for fully-disjoint spans.
- **Outlier candidates are exactly the two bounding spans** (max-first, min-last): dropping any other span cannot move both offending bounds, so the search is O(n) — find the two, test their removal. This is the plan's exact algorithm.
- **Tie-break via candidate array order** `[maxFirstId, minLastId]`: prefer the latest-start strategy, then the earliest-end one; when they are the same id it is tested once. If neither single removal restores overlap, both are returned (joint removal restores overlap for a genuinely non-overlapping multi-way set).

## Deviations from Plan

None - plan executed exactly as written. Both tasks followed the specified signatures, behavior cases, and acceptance criteria verbatim; no bugs, missing functionality, or blocking issues were encountered (no deviation rules invoked).

## Issues Encountered

- **TDD import-boundary handling (not a deviation):** the test file imports both new helpers, so at the Task 1 commit boundary the not-yet-existing `outlierIdsFor` import would break `tsc`/lint pre-commit hooks. Resolved cleanly by staging Task 1 with only the `unionOf` import (unionOf impl + its 5 tests, all compiling and green), then re-adding the `outlierIdsFor` import in Task 2 alongside its implementation. Each commit compiles and its tests pass standalone — proper atomic TDD boundaries, no `--no-verify` used.

## User Setup Required

None - no external service configuration required. Pure in-memory TypeScript, zero new dependencies.

## Next Phase Readiness
- The two contracts Plan 02/03 consume are now in place: `unionOf` is the "Full range" preset target and `outlierIdsFor` is the empty-intersection guided-fix source. The composer (57-02/03) can wire the window control + auto-excluded group + WINDOW-06 banner without hand-rolling any interval math (research "Don't Hand-Roll" honored — all coverage-interval math stays in `scenario-window.ts`).
- The BLEND-07 numpy verification gate and factsheet-parity guards remain green (unchanged; new helpers are unreferenced by the engine yet). No blockers.

## TDD Gate Compliance
Both tasks are `tdd="true"` (task-level, not a plan-level `type: tdd`). RED was verified before GREEN for each (`unionOf is not a function` and `outlierIdsFor is not a function` failures observed), then the minimal passing implementation was committed within the same task commit. No unexpected-pass-in-RED occurred. No REFACTOR was needed (the mirror-of-intersection shape was already minimal).

## Self-Check: PASSED
- `src/lib/scenario-window.ts` — FOUND (contains `export function unionOf` + `export function outlierIdsFor`, both grep-verified single-match)
- `src/lib/scenario-window.test.ts` — FOUND (contains `unionOf` + `outlierIdsFor` describe blocks)
- Commit `d1531f7e` — FOUND (Task 1)
- Commit `171a9040` — FOUND (Task 2)
- `npx vitest run src/lib/scenario-window.test.ts` — 28 passed
- `npx tsc --noEmit` — clean (no scenario-window errors, whole project clean)
- `npx eslint` on both files — clean

---
*Phase: 57-window-control-auto-toggle-state-machine*
*Completed: 2026-07-01*
