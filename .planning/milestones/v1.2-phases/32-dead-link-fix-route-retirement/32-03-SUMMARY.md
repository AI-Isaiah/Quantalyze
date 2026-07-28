---
phase: 32-dead-link-fix-route-retirement
plan: 03
subsystem: ui
tags: [next, navigation, sidebar, vitest, knip, route-retirement, frozen-spine-guard]

# Dependency graph
requires:
  - phase: 32-dead-link-fix-route-retirement (32-01)
    provides: "?portfolio= attach-back links on the 2 portfolio-context add-strategy controls"
  - phase: 32-dead-link-fix-route-retirement (32-02)
    provides: "/scenarios 307 redirect, ScenarioBuilder deletion, composer self-loop removal"
  - phase: 31-graphs-lead-layout (31-02)
    provides: "phase-31-frozen-spine-guards.test.ts — the guard pattern mirrored here"
provides:
  - "Sidebar nav consolidated to ONE allocator entry (/allocations); the /scenarios Strategy Sandbox item + unused BeakerIcon removed"
  - "Managers keep /portfolios (not orphaned)"
  - "src/__tests__/phase-32-frozen-spine-guards.test.ts — durable guard pinning all Phase-32 retirement invariants (engine zero-diff + 6 content gates)"
affects: [phase-33, phase-34, nav, scenario-composer, route-retirement]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Phase frozen-spine guard mirrors phase-31: resolveBaselineRef + FALLBACK_BASE_SHA + fail-loud (Rule 12), git zero-diff of the frozen engine, readFileSync content gates, non-vacuity self-pins on every regex"
    - "knip run as a <verify> exit-gate (no new orphans), NOT embedded as a slow per-test assertion"

key-files:
  created:
    - src/__tests__/phase-32-frozen-spine-guards.test.ts
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx

key-decisions:
  - "Reworked the Sidebar.test.tsx Sandbox describe block into a retirement gate (asserts no role flavour resurrects the item) rather than a blank delete — adds Rule 9 regression value at the render layer, complementing the source-content guard."
  - "Kept the guard's no-/scenarios gate STRICT (bare substring, not just the quoted href) — this forced rewording the Task-1 explanatory comment, which is correct: a /scenarios string in this file (even a comment-as-code regression) should trip the gate."
  - "knip exits 1 against a PRE-EXISTING repo baseline (74 unused exports / 209 unused types, never CI-gated). The plan's gate is 'no NEW orphans from Phase 32' — verified satisfied (no Phase-32 symbol/file flagged; the only whole-file deletions vs baseline are the 3 Phase-32 files, which can only reduce orphans)."

patterns-established:
  - "Per-phase frozen-spine + retirement guard with fail-loud baseline resolution and self-pinned regexes (now phase-31 + phase-32)."

requirements-completed: [FLOW-03]

# Metrics
duration: 6min
completed: 2026-06-23
---

# Phase 32 Plan 03: FLOW-03 Nav Consolidation + Phase-32 Frozen-Spine Guard Summary

**Collapsed the three-surface allocator nav to ONE entry (/allocations) by retiring the /scenarios Strategy Sandbox item + its unused BeakerIcon, and locked the entire Phase-32 retirement with a durable guard (scenario.ts zero-diff + 6 live-source content gates + a knip exit-gate).**

## Performance

- **Duration:** 6 min
- **Started:** 2026-06-23T18:13:29Z
- **Completed:** 2026-06-23T18:19:02Z
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- Removed the `/scenarios` "Strategy Sandbox" workspace nav entry from `Sidebar.tsx` and deleted the now-unused file-private `BeakerIcon` SVG factory. The allocator now has ONE discoverable entry point (`/allocations` → the Phase-29 blank-slate composer front door); `/portfolios` is kept for managers (no orphaning).
- Reworked the `Sidebar.test.tsx` Sandbox describe block into a retirement gate that asserts no role flavour (allocator / manager / admin / dual-role / no-flags) resurrects the Sandbox item; 29 Sidebar tests pass.
- Added `src/__tests__/phase-32-frozen-spine-guards.test.ts` (mirroring phase-31): fail-loud baseline resolution (`FALLBACK_BASE_SHA=b8a0337b`), `scenario.ts` zero-diff, and 6 live-source content gates covering the full retirement (redirect present + no admin-client, ScenarioBuilder deleted, no `/scenarios` nav, no composer self-loop, both portfolio links carry `?portfolio=`, no bare `/discovery/crypto-sma` in the portfolios tree), with non-vacuity self-pins on both regexes.
- Verified knip introduces NO new orphans from the 32-02 deletions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove the /scenarios Strategy Sandbox nav item + unused BeakerIcon; update Sidebar tests** - `81814ab6` (feat)
2. **Task 2: Add the phase-32 frozen-spine + retirement content guard (incl. knip-clean)** - `58fdd682` (test)

_Note: Task 2's commit also folded the one-line Sidebar.tsx comment reword that the strict guard required (see Deviations)._

## Files Created/Modified
- `src/components/layout/Sidebar.tsx` - Removed the Strategy Sandbox nav push + the unused `BeakerIcon` function; reworded the FLOW-03 comment so it contains no `/scenarios` literal.
- `src/components/layout/Sidebar.test.tsx` - Sandbox describe block reworked into a retirement gate; `/allocations` + `/portfolios` assertions untouched.
- `src/__tests__/phase-32-frozen-spine-guards.test.ts` - New durable Phase-32 exit-gate guard (engine zero-diff + 6 content gates + self-pins).

## Decisions Made
- **Retirement gate over blank delete:** kept a `describe("Sidebar Strategy Sandbox nav item is retired (FLOW-03)")` block instead of deleting the Sandbox tests outright — it pins that no role resurrects the item at the render layer, complementing the source-content guard (Rule 9 intent over WHAT).
- **Strict no-/scenarios gate:** the guard asserts `Sidebar.tsx` contains no `/scenarios` substring at all (not just the quoted href). This is the correct durable invariant; it caught my own Task-1 comment and forced the reword.
- **knip "no new orphans" interpretation:** `npx knip` exits 1 against a pre-existing, never-CI-gated baseline (74 unused exports / 209 unused types). The plan's gate is satisfied — no Phase-32 symbol or file is flagged, and the only whole-file deletions vs baseline are the 3 Phase-32 files (deletions can only reduce the orphan set). Documented as the knip exit-gate result, not a blocker.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Reworded the Task-1 Sidebar FLOW-03 comment to satisfy the strict no-/scenarios content gate**
- **Found during:** Task 2 (running the new phase-32 guard)
- **Issue:** The guard's FLOW-03 gate asserts `Sidebar.tsx` contains no `/scenarios` substring. The explanatory comment I added in Task 1 mentioned `/scenarios` twice, tripping the gate (1 failed / 7 passed on first run).
- **Fix:** Reworded the comment to describe the retirement without the literal route string ("the now-retired Sandbox route" / "the legacy route now 307-redirects"). Kept the gate strict rather than loosening it to match only `href="/scenarios"` — a `/scenarios` literal in this file, even in a comment, is a retirement-regression signal worth catching.
- **Files modified:** `src/components/layout/Sidebar.tsx`
- **Verification:** `grep -c '/scenarios' src/components/layout/Sidebar.tsx` == 0; guard + Sidebar test 37/37 green; `tsc --noEmit` exit 0.
- **Committed in:** `58fdd682` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** The deviation was a self-inflicted, in-scope comment reword required by my own (correctly strict) guard. No scope creep; no behavior change.

## Issues Encountered
- `npx knip` exits 1 due to a pre-existing repo-wide unused-exports/types baseline that has never been wired into CI (no `knip` npm script). This is not introduced by Phase 32 — verified by (a) no Phase-32 symbol/file in the report and (b) the only whole-file deletions vs baseline being the 3 Phase-32 files. The plan's "no new orphans" gate holds. Left the absolute baseline untouched (out of scope; would be a separate tech-debt item to wire knip into CI and burn down the baseline).

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 32 is functionally complete across all 3 plans: FLOW-01 (?portfolio= attach-back), FLOW-02 (/scenarios redirect + ScenarioBuilder deletion + self-loop removal), FLOW-03 (nav consolidation), all locked by the phase-32 frozen-spine guard.
- The frozen engine (`src/lib/scenario.ts`) remains zero-diff vs the v1.2 baseline (b8a0337b) — Phase 33+ can rely on the same SCENARIO-05 invariant.
- No blockers. (Optional future tech-debt: wire `npx knip` into CI and burn down the pre-existing 74/209 unused-exports baseline.)

## Self-Check: PASSED

- FOUND: `src/__tests__/phase-32-frozen-spine-guards.test.ts`
- FOUND: `src/components/layout/Sidebar.tsx`
- FOUND: `src/components/layout/Sidebar.test.tsx`
- FOUND: `.planning/phases/32-dead-link-fix-route-retirement/32-03-SUMMARY.md`
- FOUND commit: `81814ab6` (Task 1)
- FOUND commit: `58fdd682` (Task 2)

---
*Phase: 32-dead-link-fix-route-retirement*
*Completed: 2026-06-23*
