---
phase: 170-pagecopy
plan: 17
subsystem: ui
tags: [layout, allocations, tab-strip, strategies, responsive, gap-closure]
status: complete

requires:
  - phase: 170-03
    provides: the Allocations narrow header strip (min-w-0 / basis-full tablist, shrinking action wrapper)
  - phase: 170-05
    provides: the /strategies N-STRAT row layout (stacked row, NowrapWords, ShareableLink size sm)
provides:
  - "GC-01: the Allocation surfaces tablist is a nowrap scroller at every width (no sm:flex-wrap, no sm:overflow-x-visible)"
  - "GC-02: the /strategies row stacks below md; md:flex-row md:items-center md:justify-between on the row, md:ml-4 md:shrink-0 on the control group"
affects: [170-18, e2e-seeded SC2-(a) V390/V640/V960, e2e-seeded N-STRAT V640]

actuals:
  tokens: 3100
  tasks: 2
  commits: 2

plan_head_before: fe0480217d9b1ee44fe270917bc736f7a24cb69b
plan_head_after: 5c387dcaa2bfe867f0ff17ff76de84902dad40ed

tech-stack:
  added: []
  patterns:
    - "A never-wrap pin strips every responsive prefix before checking, so a wrap token cannot hide behind a breakpoint"

key-files:
  created:
    - .planning/phases/170-pagecopy/170-17-SUMMARY.md
  modified:
    - src/app/(dashboard)/allocations/AllocationsTabs.tsx
    - src/app/(dashboard)/allocations/AllocationsTabs.test.tsx
    - src/app/(dashboard)/strategies/page.tsx
    - src/app/(dashboard)/strategies/page.share-affordance.test.tsx

key-decisions:
  - "GC-01 applied as a two-token removal on the tablist only; the wrapper, tabs, separator and actions are untouched (the wrapper's existing sm:flex-nowrap keeps tablist and Export on one line)"
  - "GC-02 applied as a prefix move sm: -> md: on exactly five utilities; the name block, NowrapWords, tag row, ShareableLink size and control-group order are unchanged"

duration: ~6min
completed: 2026-09-30
---

# Phase 170 Plan 17: Tab strip one scrolling line (GC-01) and /strategies row stacked below md (GC-02) Summary

**Closes VERIFICATION gaps 3 and 4. The Allocations tablist drops `sm:flex-wrap sm:overflow-x-visible` and stays one scrolling line at every width. The `/strategies` row and its control group move their five layout utilities from `sm:` to `md:`. Both changes are pinned by vitest cases that fail on the old markup.**

## Performance

- Duration: about 6 minutes
- Tasks: 2 of 2
- Files modified: 4

## Accomplishments

- **GC-01 (gap 3).** The tablist className is now `flex flex-nowrap items-center gap-1 min-w-0 basis-full overflow-x-auto snap-x [scrollbar-width:none] [-webkit-overflow-scrolling:touch] sm:basis-auto`. From `sm` up it is still a shrinking flex item on the action row (`sm:basis-auto`), so it shares the line with Export and scrolls inside itself only when its tabs do not fit. The existing `computeTabStripScroll` effect now applies at V640/V960 as well.
- All three stale comments are rewritten to describe GC-01: the NAV-02 block above the tablist, the `computeTabStripScroll` effect comment (it said the strip "wraps and never overflows" at >=sm), and the action-wrapper comment.
- **GC-02 (gap 4).** The row is `flex flex-col gap-3 md:flex-row md:items-center md:justify-between` and the control group is `flex flex-wrap items-center gap-3 md:ml-4 md:shrink-0`. At V640 the row stacks, so the name block is full width.

## Task Commits

1. **Task 1 (tracer): GC-01 tablist** — `e0baf6139` (fix)
2. **Task 2: GC-02 /strategies row** — `5c387dcaa` (fix)

## Test evidence (RED, neuter, GREEN)

**Task 1: `[GC-01] the tablist never wraps and never switches to visible overflow at any breakpoint`** (new case in the `AllocationsTabs — Phase 170 item (a) narrow header strip` describe)
- RED on the old markup: `AssertionError: expected [ 'flex', 'flex-nowrap', …(11) ] to not include 'flex-wrap'` (1 failed).
- GREEN after the change: `AllocationsTabs.test.tsx` + `AllocationsTabs.tabstrip-scroll.test.ts`, 2 files, 56 of 56 passed. The `[SC2-(a)]` tablist case, the `[JOURNEY-03]` direct-children case and the action-wrapper case stay green.
- Neuter (scratchpad `cp` backup, `sm:overflow-x-visible` put back by hand): `AssertionError: expected [ 'flex', 'flex-nowrap', …(10) ] to not include 'overflow-x-visible'` (1 failed). Restored from the backup, `cmp` identical, 56 of 56 GREEN again.
- Tracer gate (auto mode): `<verify>` re-run end-to-end after the restore, green, before Task 2.

**Task 2: `StrategiesPage — N-STRAT row layout (170-05)`, case renamed "stacks below md, …"**
- RED on the old markup: `AssertionError: expected [ 'flex', 'flex-col', 'gap-3', …(3) ] to include 'md:flex-row'` (1 failed).
- GREEN: `vitest run src/app/(dashboard)/strategies`, 42 files, 803 of 803 passed.
- Neuter 1 (swap `md:shrink-0` back to `sm:shrink-0`): `expected [ 'flex', 'flex-wrap', …(4) ] to include 'md:shrink-0'`. RED.
- Neuter 2 (keep `md:shrink-0`, add `sm:shrink-0`), which exercises the no-`sm:` arm on its own: `expected [ 'sm:flex-row', …(4) ] to not include 'sm:shrink-0'`. RED.
- Each neuter was restored from a scratchpad `cp` backup and checked with `cmp`. Nothing was restored with `git checkout --`. GREEN afterwards: 9 of 9 in the file.

**Static checks.** `npx tsc --noEmit -p .` exits 0 with no output. `npx eslint` on all four touched files is clean.

**Acceptance greps.** The tablist line has 0 `overflow-x-visible` and 1 `sm:basis-auto`. The test has 2 `GC-01` hits. `page.tsx` has at least 1 `md:flex-row` and at least 1 `md:shrink-0`. The strategies test has 1 or more `GC-02` hits.

## Browser rows: proven only in CI, not locally

This executor ran no seeded e2e, per the plan environment. The e2e assertions belong to plan 170-18. They are confirmed in the orchestrator's single post-land CI run. What that run should show:
- **SC2-(a) V390:** the tablist is its own full-width row and scrolls (`scrollWidth > clientWidth`). The last tab is reachable after End. The page does not scroll sideways.
- **SC2-(a) V640:** the tablist sits on the action row beside Export and does not wrap. It scrolls only if `scrollWidth > clientWidth`. The last tab is reachable after End.
- **SC2-(a) V960:** the tablist stays on ONE line, on the same row as Export. The 13 px offset from run 36764778803 should be gone.
- **N-STRAT V640:** the row is stacked, so the name block is full width (at least 160 px) and the control group sits below it. From V960 up it is one row.

## Deviations from Plan

None. The plan executed as written. One small addition: Task 2 also got an additive neuter (neuter 2 above), so the "no `sm:` token" arm is shown to bite on its own and not only through the missing `md:` token.

## Issues Encountered

None. The plan matched HEAD: every anchor it names (tablist className, the three comments, the row and control-group classNames, the layout test case) was present as described.

## Out of scope, noted

GC-01 also names the `/profile` tab list. That file is not in this plan's `files_modified` and this plan did not touch it. A grep over `src` at HEAD found no other tablist carrying `sm:flex-wrap` or `sm:overflow-x-visible`.

## Next Phase Readiness

Plan 170-18 (same wave, file-disjoint) owns the matching e2e assertions. The markup contract they check is now in place.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/AllocationsTabs.tsx, AllocationsTabs.test.tsx, src/app/(dashboard)/strategies/page.tsx, page.share-affordance.test.tsx
- FOUND: e0baf6139, 5c387dcaa (`git rev-list --count fe0480217..HEAD` = 2 at SUMMARY write)
