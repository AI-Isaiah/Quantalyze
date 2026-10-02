---
phase: 47-hand-rolled-svg-charts-touch-legibility-portrait
plan: 01
subsystem: ui
tags: [react, hooks, pointer-events, touch-gesture, svg-charts, vitest, testing]

# Dependency graph
requires:
  - phase: 47 (reference)
    provides: "TimeSeriesChart.tsx tap-pins-crosshair gesture core (the extraction source; NOT modified)"
provides:
  - "src/hooks/useTapPin.ts — the single shared tap-vs-drag + pin-toggle gesture contract for the Phase-47 tap-reveal SVG charts (CHART-01a DRY)"
  - "useTapPin(opts: { count, pointerToIndex }) → { selectedIdx, pinned, svgRef, onPointerDown, onPointerMove, onPointerUp, onPointerLeave }"
  - "Exported gesture constants TAP_SLOP_SQ=64, TAP_MAX_MS=350, RETAP_THRESHOLD=3"
  - "100%-branch unit-test suite (useTapPin.test.ts) proving every gesture return arm, falsifiable by spot-mutation"
affects:
  - "47-02 (legibility/portrait tuning charts)"
  - "47-03 (the 3 tap-reveal charts: StreakDistributionPanel, DailyReturnsHeatmap, DailyHeatmap — consume this hook)"
  - "47-04, 47-05 (parity/target-size verification of the tap hit-rects)"

# Tech tracking
tech-stack:
  added: []  # zero net-new npm deps (locked constraint)
  patterns:
    - "Caller-supplied pointerToIndex(clientX, clientY, rect) callback contract — the hook owns gesture mechanics, the consuming chart owns the value reveal (reads precomputed payload at selectedIdx, never recomputes)"
    - "Gesture-core extraction WITHOUT refactoring the reference: TimeSeriesChart.tsx stays byte-identical; the hook copies only the slop/time/touch-only/re-tap/leave semantics, excluding pan/zoom/wheel/deferred-tooltip machinery"
    - "Falsifiable branch test: spot-mutate a guard, prove tests fail, revert (acceptance-criteria-enforced)"

key-files:
  created:
    - src/hooks/useTapPin.ts
    - src/hooks/useTapPin.test.ts
  modified: []

key-decisions:
  - "Generalized the line chart's pixelToIdx(clientX, rect) to pointerToIndex(clientX, clientY, rect) — passes clientY too so heatmap/2D consumers can map a cell, not just an x-column"
  - "Hook clamps selectedIdx to [0, count-1] (T-47-01 mitigation: no array OOB); pointerToIndex returning null clears + un-pins"
  - "Pointer-capture calls (setPointerCapture on down, releasePointerCapture on up) wrapped in try/catch — the reference releases capture inside its pan/zoom block; the hook releases unconditionally on up since it owns no nav state"
  - "Added 2 tests beyond the 8 plan-named arms (small-move-within-slop tap; pointermove-with-no-prior-pointerdown no-op) to reach 100% branch coverage on the hook"

patterns-established:
  - "useTapPin is the DRY tap-gesture contract for Phase-47 tap-reveal charts — consumers supply pointerToIndex + count and render their own reveal from selectedIdx/pinned"

requirements-completed: [CHART-01a]

# Metrics
duration: 5min
completed: 2026-06-27
---

# Phase 47 Plan 01: Shared useTapPin Gesture Hook Summary

**Extracted the TimeSeriesChart touch tap-to-pin gesture core into one thin shared `useTapPin` hook (slop 8px / <350ms / touch-only / re-tap-toggle / pointerleave-survival) with a caller-supplied `pointerToIndex` contract and a 100%-branch, falsifiable unit suite — TimeSeriesChart.tsx left byte-identical.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-06-27T22:24:04Z
- **Completed:** 2026-06-27T22:29:xxZ
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- `useTapPin` hook: the single shared tap-vs-drag + pin-toggle gesture contract the 3 Phase-47 tap-reveal SVG charts (Plan 03) will consume instead of 4× re-implementing the gesture (locked DRY decision, CHART-01a).
- Generalized the line chart's `pixelToIdx(clientX, rect)` into a caller-supplied `pointerToIndex(clientX, clientY, rect): number | null` callback (clientY passed too, so heatmap/2D consumers can map a cell). The hook clamps to `[0, count-1]` and returns `{ selectedIdx, pinned, svgRef, onPointer* }`; the consuming chart renders its own value reveal from `selectedIdx`.
- Deliberately excluded all pan/zoom/wheel/deferred-tooltip machinery (TimeSeriesChart-specific) — verified `grep -ciE 'wheel|useDeferredValue|pan|zoom'` returns 0.
- 15-test branch-coverage suite covering every return arm, falsifiable: mutating the `ti.type !== "touch"` guard to always-return fails 8 tests (verified, then reverted). 100% branch coverage on the hook (22/22) — well above the blocking ratchet (branches 72).
- `TimeSeriesChart.tsx` byte-identical throughout (`git diff --quiet` exits 0); SCENARIO-05 frozen-spine guard still green (5/5).

## Task Commits

Each task was committed atomically:

1. **Task 1: Author the useTapPin hook** - `58116839` (feat)
2. **Task 2: Branch-coverage unit test for every return arm** - `94396973` (test)

_TDD note: the plan tags both tasks `tdd="true"`. The hook (Task 1) was authored first since there is no observable behavior to test until the contract exists; the falsifiable RED proof (spot-mutation) was applied within Task 2 per its acceptance criteria, then reverted to GREEN._

## Files Created/Modified
- `src/hooks/useTapPin.ts` (181 lines) - `"use client"` shared gesture hook; exports `useTapPin`, `TAP_SLOP_SQ`, `TAP_MAX_MS`, `RETAP_THRESHOLD`, `UseTapPinOptions`, `UseTapPin`.
- `src/hooks/useTapPin.test.ts` (262 lines) - jsdom `renderHook` branch-coverage suite, 15 `it` blocks, 100% branch coverage on the hook.

## Decisions Made
- **Generalized to a 2D-capable callback:** `pointerToIndex(clientX, clientY, rect)` (not just `clientX`) so heatmap consumers (DailyReturnsHeatmap, DailyHeatmap) can map a cell; line-of-x consumers simply ignore `clientY`. This is the documented generalization in the plan/RESEARCH (the reference's `pixelToIdx` only needed `clientX`).
- **Unconditional pointer-capture release on up:** the reference releases capture inside its pan/zoom branch; the hook owns no nav state, so it releases unconditionally (try/catch-guarded) on `onPointerUp`. Behaviorally equivalent for the tap path.
- **Two extra tests beyond the 8 plan-named arms** to reach 100% branch coverage (small-move-within-slop still taps; pointermove with no prior pointerdown is a no-op) — strengthens the suite, holds the ratchet with maximum headroom.

## Deviations from Plan

None - plan executed exactly as written. The two additional tests are additive coverage strengthening within Task 2's stated goal ("cover EACH branch ... so branch coverage does not regress below 72"), not a scope change.

## Issues Encountered
- The Task-1 acceptance criterion `grep -ciE 'wheel|useDeferredValue|pan|zoom' returns 0` initially returned 1 due to a DOC-COMMENT substring ("scroll-**wheel**" / "pan / zoom") describing the EXCLUDED machinery. Reworded the comment to name the excluded behavior without the literal tokens — the hook contains no actual pan/zoom/wheel/useDeferredValue code identifier. Resolved before the Task-1 commit; final leak count is 0.

## User Setup Required
None - no external service configuration required. Zero net-new npm dependencies (locked constraint).

## Next Phase Readiness
- `useTapPin` is ready for Plan 03 to wire into the 3 firm tap-reveal charts (StreakDistributionPanel, DailyReturnsHeatmap, DailyHeatmap). Each supplies its own `pointerToIndex` (cell/bar/period mapping) and `count`, renders its reveal from `selectedIdx`, and must keep its desktop render byte-identical (gate the affordance so it only fires for `pointerType === "touch"` — the hook already enforces this).
- No blockers. The frozen-math boundary is untouched (this plan adds no data flow); SCENARIO-05/BODY-02 remain the value-change guards.

## Self-Check: PASSED

- FOUND: src/hooks/useTapPin.ts
- FOUND: src/hooks/useTapPin.test.ts
- FOUND: .planning/phases/47-hand-rolled-svg-charts-touch-legibility-portrait/47-01-SUMMARY.md
- FOUND commit: 58116839 (feat — useTapPin hook)
- FOUND commit: 94396973 (test — branch coverage)
- TimeSeriesChart.tsx byte-identical: `git diff --quiet` exit 0
- useTapPin.test.ts: 15 passing, 100% branch coverage on the hook
- SCENARIO-05 frozen-spine guard: green (5/5)

---
*Phase: 47-hand-rolled-svg-charts-touch-legibility-portrait*
*Completed: 2026-06-27*
