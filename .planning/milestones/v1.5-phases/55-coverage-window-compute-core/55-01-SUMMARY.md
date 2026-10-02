---
phase: 55-coverage-window-compute-core
plan: 01
subsystem: scenario-blend-engine
tags: [coverage-window, blend, pure-helper, dateday, zero-deps]
requires: []
provides:
  - "coverageSpanOf / intersectionOf / defaultWindowFor / covers — the single source for scenario window derivation"
affects:
  - "55-02 (computeScenario coverage path), 55-03 (BLEND-07 gate), Phases 57/59 (composer/share/compare)"
tech-stack:
  added: []            # zero new deps (locked)
  patterns:
    - "Lexicographic YYYY-MM-DD string compare (dateday.ts convention) — no Date objects"
    - "Additive-optional field doc-comment discipline mirrored from scenario.ts leverage? (:68-82)"
key-files:
  created:
    - src/lib/scenario-window.ts
    - src/lib/scenario-window.test.ts
  modified: []
decisions:
  - "coverageSpanOf derives [first,last] from the returns array ONLY — no 2022 sentinel, no start_date metadata (Pitfall 2)"
  - "covers() is inclusive-closed: span.first <= window.start && span.last >= window.end (Pitfall 1)"
  - "Empty / non-overlapping intersection returns null, never a fabricated window (no-invented-data, Pitfall 4)"
  - "defaultWindowFor delegates to intersectionOf — ONE implementation of the intersection math"
  - "Touching-at-a-point spans yield a valid single-day window (start === end), not null"
metrics:
  duration: ~3 min
  completed: 2026-07-01
  tasks: 1
  files: 2
requirements: [BLEND-02]
---

# Phase 55 Plan 01: Coverage-Window Compute Core Summary

Pure, zero-new-dep `src/lib/scenario-window.ts` exporting `coverageSpanOf`,
`intersectionOf`, `defaultWindowFor`, and `covers` — the single source of truth
for coverage-span and intersection-window derivation that the 55-02 engine
rewrite, the 55-03 BLEND-07 gate, and the Phase 57/59 composer/share/compare
consumers all import so the window is derived identically everywhere.

## What Was Built

- **`src/lib/scenario-window.ts`** (~110 lines incl. doc-comments; ~25 LOC of
  logic). Four pure functions over `YYYY-MM-DD` strings using lexicographic
  compare (the `dateday.ts` convention) — no `Date` objects, no mutation, no I/O:
  - `coverageSpanOf(dailyReturns): { first, last } | null` — min/max date over
    the returns array (defensive scan, does NOT assume pre-sort); `null` for an
    empty series. Ignores leading/trailing absence: coverage is date presence
    ONLY, never the pre-data sentinel or `start_date` metadata (Pitfall 2).
  - `intersectionOf(spans): { start, end } | null` — `[max(firsts), min(lasts)]`;
    `null` on an empty set OR empty intersection (`start > end`). A single-day
    intersection (`start === end`) is a valid closed window, not null.
  - `defaultWindowFor(spans)` — delegates to `intersectionOf` (single impl).
  - `covers(span, window): boolean` — inclusive-closed containment
    (`span.first <= window.start && span.last >= window.end`, Pitfall 1).
  - Exported `CoverageSpan` / `CoverageWindow` interfaces for downstream typing.
- **`src/lib/scenario-window.test.ts`** — 16 boundary-cell tests, each encoding
  WHY (Rule 9): empty-series null, single-entry first===last, leading-gap first,
  trailing-gap last, unsorted min/max; the 4 `covers()` boundary cells (one day
  before / exactly on / one day after each of winStart and winEnd) plus the two
  "inside" cells; 2-span intersection, `defaultWindowFor`≡`intersectionOf`
  delegation, non-overlapping → null (both fns), empty-set → null, single-member,
  and touching-at-a-point → single-day window.

## How It Was Verified

- `npx vitest run src/lib/scenario-window.test.ts` → **16 passed**.
- `grep -n "2022-01-01\|new Date\|Date(" src/lib/scenario-window.ts` → **no
  matches** (no sentinel, no Date objects — Pitfall 2 grep-gate green).
- All four exports confirmed present via `grep "export function <fn>"`.
- `npx tsc --noEmit` → **clean** (exit 0), no type errors introduced.
- `npx eslint src/lib/scenario-window.ts src/lib/scenario-window.test.ts` →
  **clean** (exit 0). Pre-commit hooks ran on commit (no `--no-verify`).

## TDD Flow

RED: wrote `scenario-window.test.ts` importing the not-yet-existent module →
`vitest run` failed with "Failed to resolve import ./scenario-window". GREEN:
wrote `scenario-window.ts` → all 16 tests pass. No REFACTOR commit needed (the
~25 LOC were minimal and clean as first written; committed RED+GREEN together as
the single atomic plan task per the plan's one-task breakdown).

## Deviations from Plan

**1. [Rule 3 - Blocking] Reworded a doc-comment to satisfy the Pitfall-2 grep gate**
- **Found during:** Task 1 acceptance-criteria check.
- **Issue:** The initial header doc-comment literally spelled the `"2022-01-01"`
  sentinel (while documenting that it must NOT be used) and the word `Date(`.
  Acceptance criterion (55-01-PLAN.md:101) requires
  `grep -n "2022-01-01\|new Date\|Date(" src/lib/scenario-window.ts` to return NO
  matches — the grep-gate cannot distinguish a comment from code, and future
  automated frozen-spine guards run this exact grep, so a match in a comment
  would trip them.
- **Fix:** Replaced `"2022-01-01" sentinel` with "legacy pre-data sentinel" and
  `Date objects` with "JS date objects" in the doc-comment. No logic change; the
  invariant is still documented in prose.
- **Files modified:** src/lib/scenario-window.ts (doc-comment only).
- **Commit:** 67e63d8d (folded into the single task commit).

Note: the sentinel/date strings still appear in `scenario-window.test.ts` as
legitimate boundary-cell DATA (e.g. `2022-12-31`, `2023-01-01`). The acceptance
grep is scoped to `scenario-window.ts` only (not the test file), so this is
correct and expected.

## Known Stubs

None. Both functions are fully implemented and tested; nothing is placeholder or
mock-wired.

## Threat Flags

None. Pure client-side math helper — no auth, network, persistence, or external
input crosses any boundary (matches the plan's threat_model, which declares no
new trust boundary). The two `mitigate` dispositions in the threat register are
both satisfied: T-55-01-01 (coverage-from-returns-only) is enforced by the
grep-gate; T-55-01-02 (no fabricated window) is test-pinned by the
non-overlapping → null case.

## For Downstream Plans

- **55-02** imports `coverageSpanOf` + `covers` for the present-`window`
  membership path, and the scenario tab derives its default window via
  `defaultWindowFor()` (intersection of selected+enabled spans). The
  absent-`window` union path is untouched (byte-compat for Category-C own-book
  callers).
- **55-03** (BLEND-07) uses `defaultWindowFor()` to compute the max-overlap
  window before matching `computeScenario` against the from-scratch numpy numbers.
- **Phase 59** (PERSIST-02) will import the SAME helpers in share-resolve so the
  persisted/derived window is identical to the composer's — the helper now exists
  for that import.

## Self-Check: PASSED

- FOUND: src/lib/scenario-window.ts
- FOUND: src/lib/scenario-window.test.ts
- FOUND: .planning/phases/55-coverage-window-compute-core/55-01-SUMMARY.md
- FOUND commit: 67e63d8d
