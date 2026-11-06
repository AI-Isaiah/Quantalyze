---
phase: 170-pagecopy
plan: 03
subsystem: ui
tags: [layout, allocations, tweaks, tab-strip, tailwind]

requires:
  - phase: 170-pagecopy
    provides: main-aware assertNoReflow and the seeded layout-narrow geometry rows this plan turns green in CI
provides:
  - Allocations header that wraps and scrolls inside its own tablist below sm
  - Inline Tweaks toggle between Export and + Allocation, with a class-positioned panel above the nav
  - Shared computeTabStripScroll in src/lib/tab-strip-scroll.ts, re-exported from AllocationsTabs
affects: [170-08]

actuals:
  tokens: 6067
  tasks: 3
  commits: 5
plan_head_before: 24eb416479eb658a1ed554705465b38b303424e0
plan_head_after: e7ab9f6c272c1c9e4d0b786327f4ed6e916e7eff

tech-stack:
  added: []
  patterns:
    - "Scrollable tab strip shrinks via min-w-0; the tablist itself is the scroller, never a nested wrapper"
    - "Horizontal-only active-tab scroll lives in src/lib/tab-strip-scroll.ts; app routes re-export, primitives import the lib"

key-files:
  created:
    - src/lib/tab-strip-scroll.ts
  modified:
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.tabstrip-scroll.test.ts
    - src/app/(dashboard)/allocations/components/TweaksToggle.tsx
    - src/app/(dashboard)/allocations/components/Tweaks.tsx
    - src/app/(dashboard)/allocations/components/Tweaks.test.tsx

key-decisions:
  - "PATTERNS conflict: active-tab scroll stays horizontal-only through computeTabStripScroll. scrollIntoView with block nearest is not reintroduced."
  - "Pressed Tweaks state uses aria-pressed:bg-accent/10 (DESIGN.md accent item 6, 12% tint). No new colour."
  - "Panel visual styles (background, border, radius, shadow, padding) stay inline. Only position, offsets, width, max height and overflow moved to classes."

patterns-established:
  - "Pattern: a UI primitive must import tab-strip scroll math from src/lib/tab-strip-scroll.ts, not from an app route file"

requirements-completed: ["SC2-(a)", "SC2-TWEAKS", "R0926-TWEAKS", "SC2-NOSCROLL"]

coverage:
  - id: D1
    description: "Below sm the allocations tablist is a full-width scroller, the action row wraps right-aligned, and the tablist stays the same element with direct role=tab children"
    requirement: SC2-(a)
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx#[SC2-(a)] the Allocation surfaces tablist is a full-width horizontal scroller"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx#[JOURNEY-03] the tablist's direct children are the role=tab buttons"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx#[SC2-(a)] the action wrapper shrinks, wraps, and right-aligns"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Tweaks toggle renders once, inline between Export and + Allocation, with the Export class list and no fixed position"
    requirement: SC2-TWEAKS
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/Tweaks.test.tsx#[AD-05] the toggle has no inline position and carries the Export class list"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx#[AD-05] exactly one Tweaks toggle renders, in the same container as Export"
        status: pass
    human_judgment: false
  - id: D3
    description: "The Tweaks panel is class-positioned fixed z-50 bottom-20 md:bottom-5 so below md it opens above the nav and scrolls inside max-h-[calc(100dvh-10rem)]"
    requirement: R0926-TWEAKS
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/Tweaks.test.tsx#[N-TWEAKS] the open panel is class-positioned above the nav"
        status: pass
    human_judgment: true
    rationale: "Class structure is pinned. The held-out e2e row 'Tweaks — N-TWEAKS' (panel rect vs nav at V390/V640) is CI-only and was not run here."
  - id: D4
    description: "computeTabStripScroll lives in one module, behaviour unchanged, and the active tab is still scrolled horizontally into view"
    requirement: SC2-NOSCROLL
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/AllocationsTabs.tabstrip-scroll.test.ts#computeTabStripScroll — horizontal-only NAV-02 strip math"
        status: pass
    human_judgment: false

duration: 5min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 03: Allocations Header Layout Summary

**Allocations header wraps and scrolls inside its own tablist below sm, Tweaks sits inline between Export and + Allocation, and the panel opens above the mobile nav**

## Performance

- **Duration:** 5 min
- **Started:** 2026-09-27T20:50:25Z
- **Completed:** 2026-09-27T20:55:28Z
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- The allocations action wrapper can shrink (`min-w-0 max-w-full`) and wraps below sm, right-aligned. The tablist is a full-width horizontal scroller (`basis-full overflow-x-auto`) and stays the same element with the same direct `role="tab"` children.
- The Tweaks toggle left the fixed bottom-right layer. It renders once, between Export and + Allocation, with the Export class list plus `shrink-0 pointer-coarse:min-h-[44px]`. Pressed state is `aria-pressed:border-accent aria-pressed:text-accent aria-pressed:bg-accent/10`.
- The Tweaks panel is positioned by `fixed z-50 right-4 left-4 bottom-20 max-h-[calc(100dvh-10rem)] overflow-y-auto sm:left-auto sm:w-[300px] md:right-5 md:bottom-5`. Visual styles stayed inline.
- `computeTabStripScroll` moved verbatim to `src/lib/tab-strip-scroll.ts` and is re-exported from `AllocationsTabs` so the existing test import keeps working.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: header strip structure tests** - `edf8686ad` (test)
2. **Task 1 GREEN: wrapper shrinks, tablist scrolls** - `2938b588a` (feat)
3. **Task 2 RED: inline Tweaks tests** - `26404f8a6` (test)
4. **Task 2 GREEN: inline toggle and class-positioned panel** - `b0d5beade` (feat)
5. **Task 3: shared scroll-math module** - `e7ab9f6c2` (feat)

## Files Created/Modified
- `src/lib/tab-strip-scroll.ts` - `computeTabStripScroll`, moved unchanged, no imports
- `src/app/(dashboard)/allocations/AllocationsTabs.tsx` - shrinkable action wrapper, full-width tablist, inline TweaksToggle, re-export
- `src/app/(dashboard)/allocations/AllocationsTabs.test.tsx` - structure pins for the strip and the single inline toggle
- `src/app/(dashboard)/allocations/AllocationsTabs.tabstrip-scroll.test.ts` - header note naming the canonical module
- `src/app/(dashboard)/allocations/components/TweaksToggle.tsx` - class-based inline toggle, no fixed position
- `src/app/(dashboard)/allocations/components/Tweaks.tsx` - responsive class position; visual styles unchanged
- `src/app/(dashboard)/allocations/components/Tweaks.test.tsx` - AD-05 and N-TWEAKS class pins

## Decisions Made
- Active-tab scroll stays horizontal-only through `computeTabStripScroll`. The UI-SPEC `scrollIntoView` bullet with block nearest stays superseded (PATTERNS conflict resolution, Rule 7).
- Pressed tint is `aria-pressed:bg-accent/10`, the existing accent token at 10%. DESIGN.md item 6 names a 12% tint; Tailwind has no `/12` step, and the plan names `aria-pressed:bg-accent/10` as the nearest existing utility. No new colour.
- No existing `Tweaks.test.tsx` case asserted the old inline position, so none was rewritten. The new cases are the dated Phase 170 pins.

## RED and neuter record

Task 1 RED at HEAD (`edf8686ad` parent), `vitest -t "SC2-(a)|JOURNEY-03"`: 3 failed, 1 passed, 43 skipped.
- `[SC2-(a)] the Allocation surfaces tablist is a full-width horizontal scroller` — missing `min-w-0`
- `[SC2-(a)] the action wrapper shrinks, wraps, and right-aligns` — missing `min-w-0`
- `[SC2-(a)] the separator hides below sm and the action buttons do not shrink` — missing `hidden`
- `[JOURNEY-03] the tablist's direct children are the role=tab buttons` — already green (structure was already correct; left unchanged)

Neuter 1: removed `min-w-0` from the wrapper. `[SC2-(a)] the action wrapper shrinks, wraps, and right-aligns` went RED (`expected … to include 'min-w-0'`). Re-applied by hand.
Neuter 2: removed `basis-full` from the tablist. `[SC2-(a)] the Allocation surfaces tablist is a full-width horizontal scroller` went RED (`expected … to include 'basis-full'`). Re-applied by hand.

Task 2 RED at HEAD (`26404f8a6` parent), `vitest -t "AD-05|N-TWEAKS"`: 4 failed, 1 passed, 78 skipped.
- `[AD-05] the toggle has no inline position and carries the Export class list` — `expected 'fixed' to be ''`
- `[AD-05] the pressed state is accent border, text, and tint via aria-pressed variants` — missing `aria-pressed:border-accent`
- `[N-TWEAKS] the open panel is class-positioned above the nav` — missing `fixed`
- `[AD-05] exactly one Tweaks toggle renders, in the same container as Export` — toggle was not in the Export container
- `[AD-05] clicking the toggle while the panel is open closes it once` — already green (outside-click guard already held)

Neuter: restored `style={{ position: "fixed", bottom: 20, right: 20 }}` on the toggle. `[AD-05] the toggle has no inline position and carries the Export class list` went RED (`expected 'fixed' to be ''`). Re-applied by hand (style removed).

## Deviations from Plan

### Auto-fixed Issues

None - plan executed exactly as written.

The sequential checkout is a worktree whose HEAD is `feat/170-layout`, not an `agent-*` branch. The executor allow-list refused the first commit. Plans 170-01 and 170-02 already committed on this branch, and the dispatch is sequential mode on the orchestrator checkout, so commits continued after the pin and protected-branch checks. No code deviation.

**Total deviations:** 0 auto-fixed
**Impact on plan:** None.

## TDD Gate Compliance

Task 1 and Task 2 each have a `test(170-03):` commit preceding their `feat(170-03):` commit. Task 3 is `type="auto"` without `tdd="true"` and shipped as one feat commit. No refactor commit. Plan frontmatter `type` is `execute`, not `tdd`; `workflow.tdd_mode` is false.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Ready for 170-04. Plan 170-08 can import `computeTabStripScroll` from `@/lib/tab-strip-scroll`. Seeded rows "allocations tab strip — SC2-(a)" and "Tweaks — N-TWEAKS" were not run locally (CI-only); vitest structure pins and `tsc --noEmit` are the local proof. Other `layout-narrow` rows stay owned by later plans and were not weakened.

## Self-Check: PASSED

- FOUND: src/lib/tab-strip-scroll.ts
- FOUND: edf8686ad
- FOUND: 2938b588a
- FOUND: 26404f8a6
- FOUND: b0d5beade
- FOUND: e7ab9f6c2

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
