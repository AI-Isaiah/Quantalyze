---
phase: 170-pagecopy
plan: 18
subsystem: e2e
tags: [layout, e2e, geometry, tab-strip, gap-closure, GC-01, GC-02]
status: complete

requires:
  - phase: 170-15
    provides: the reflow.spec.ts self-test describes (shared file)
  - phase: 170-17
    provides: "GC-01 tablist markup (nowrap scroller at every width) and GC-02 /strategies row (stacks below md)"
provides:
  - "assertFitsOrScrollsInside: the GC-01 tab-strip contract as a geometry helper, with four Chromium self-test fixtures"
  - "SC2-(a) at V390/V640/V960 and SC2-PROFILE at V390/V640 assert fits-or-scrolls, never an unconditional scroll"
  - "SC2-PROFILE scrolls Disconnect into view before the viewport check (gap 7)"
  - "N-TABLE anchors on [data-strategy-table] (gap 5)"
  - "N-STRAT asserts the GC-02 row shape: stacked at V390/V640, one row at V960"
affects: [e2e-seeded SC2-(a), SC2-PROFILE, N-TABLE, N-STRAT]

actuals:
  tokens: 3600
  tasks: 3
  commits: 3

plan_head_before: 24d2c734c66b1ed156e754d0b15de3383a2081b9
plan_head_after: 8f5db38244294b534b06666d59a80a0320ec782c

tech-stack:
  added: []
  patterns:
    - "Wrap detection by vertical overlap (a child starting at or below another child's bottom), not by equal tops, so items-center children of different heights do not read as a wrap"

key-files:
  created:
    - .planning/phases/170-pagecopy/170-18-SUMMARY.md
  modified:
    - e2e/helpers/geometry.ts
    - e2e/reflow.spec.ts
    - e2e/layout-narrow.spec.ts

key-decisions:
  - "The wrap rule is 'max child top >= min child bottom - 1 px' instead of the plan's 'tops differ by more than 2 px': an Allocations tab can carry a count badge, and under items-center a taller tab shifts tops without wrapping"
  - "The helper also fails on a strip with no laid-out child (W-02), alongside the zero-count locator guard"

duration: ~20min
completed: 2026-09-30
---

# Phase 170 Plan 18: Seeded layout spec asserts GC-01/GC-02 and loses its two test defects Summary

**A new `assertFitsOrScrollsInside` helper encodes GC-01 (one line, scroll only when the tabs do not fit, never wrap, never overflow unscrolled) and has four server-free Chromium fixtures. SC2-(a) runs at all three widths with it, and at V960 also checks the strip sits on the Export row. SC2-PROFILE uses it and scrolls Disconnect into view first. N-TABLE anchors on the table, and N-STRAT asserts the GC-02 row shape. Closes VERIFICATION gaps 3 and 7, the test half of gap 5, and the GC-02 half of gap 4.**

## Task Commits

1. **Task 1 (tracer): `assertFitsOrScrollsInside` plus its self-test.** `d0cc4fd63` (test)
2. **Task 2: SC2-(a) and SC2-PROFILE assert GC-01; Disconnect is scrolled into view.** `843c5f9ad` (test)
3. **Task 3: N-TABLE anchors on the table; N-STRAT asserts the GC-02 row shape.** `8f5db3824` (test)

## Test evidence

**Task 1: `geometry helper self-test (Phase 170 GC-01)`** in `e2e/reflow.spec.ts`, run locally in Chromium with `CI=1`, no server.
- GREEN: `CI=1 npx playwright test e2e/reflow.spec.ts -g "self-test" --reporter=line` gives **9 passed**: the 5 `assertNoReflow helper self-test` cases from 170-01/170-15 plus the 4 new ones (fits `scrolls=false`, scrolls `scrolls=true`, wraps rejects, overflows rejects).
- **Neuter (a).** The wrap check was disabled with `if (false && …)` after a scratchpad `cp` backup. Result: RED, `1 failed`, **`wraps fixture: a flex-wrap strip whose tabs fall onto two lines rejects`**, `Error: expect(received).rejects.toThrow()`. The other 3 passed. Restored from the backup with `cp`, and `cmp` reported the file identical.
- **Neuter (b).** The overflow-x check was disabled the same way. Result: RED, `1 failed`, **`overflows fixture: a nowrap strip with visible overflow wider than its box rejects`**, `Error: expect(received).rejects.toThrow()`. The other 3 passed. Restored the same way (`cmp` identical). After that, `git status` showed only the intended edits, and the full self-test was GREEN again at 9 passed.
- Tracer gate (auto mode, `workflow.auto_advance: true`). The `<verify>` was re-run end-to-end after both restores and gave 9 passed, so Tasks 2 and 3 could start.

**Tasks 2 and 3.** The seeded spec runs only in CI `e2e-seeded`. Locally it was checked only for compiling and enumerating:
- `CI=1 npx playwright test --list e2e/layout-narrow.spec.ts` lists **Total: 28 tests in 1 file**, with no Error. That includes 3 SC2-(a) titles (V390/V640/V960), 2 SC2-PROFILE titles (V390/V640), 3 N-STRAT and 3 N-TABLE.
- `npx tsc --noEmit -p .`: exit 0, no output.
- `npx eslint` on all three touched files: clean.
- Acceptance greps:
  - `assertFitsOrScrollsInside` appears 3 times in layout-narrow (the import plus 2 call sites).
  - `scrollIntoViewIfNeeded` appears once.
  - Non-comment `still scrolls` appears 0 times.
  - The old `a[href="/my-strategies"]').first()` anchor appears 0 times.
  - `GC-02` appears 4 times.
  - In geometry.ts, `export async function assertFitsOrScrollsInside` appears once.
- No seeded row can be neutered locally, because there is no seed env and TEST is off-limits here. The helper self-test above covers the two ways each row can fail on a wrap or an unscrolled overflow. Each row's own RED/GREEN verdict comes only from CI.

## Changed seeded rows (every one confirmed ONLY by the post-land e2e-seeded run)

| Row | What it now asserts | Expected post-land |
|---|---|---|
| SC2-(a) V390 | tablist fits-or-scrolls on one line (`scrolls=` logged), no reflow, last tab focused and inside the strip after End | GREEN. It passed before; with 170-17's markup it most likely logs `scrolls=true` |
| SC2-(a) V640 | same | GREEN. The strip fit at 264/264 in run 36764778803; now that passes, and it logs `scrolls=false` or `true` |
| SC2-(a) V960 | same, plus the tablist's vertical centre inside the Export button's vertical span | GREEN only if 170-17's nowrap strip keeps it on one line beside Export (it was 13 px off when it wrapped) |
| SC2-PROFILE V390 | profile tab list fits-or-scrolls; Disconnect scrolled into view, then inside the viewport and not covered | GREEN (passed before) |
| SC2-PROFILE V640 | same | GREEN. Disconnect at y=439 is scrolled into view; the tab list is not required to scroll |
| N-TABLE V390 | anchors on `[data-strategy-table]`, then the Sort selects are the hit target | first real measurement of the (k) fix below md. Pass/fail is unknown until CI |
| N-TABLE V640 | same | same |
| N-TABLE V960 | same (anchor change only) | GREEN (passed before) |
| N-STRAT V390 | no intersection; control group top ≥ name block bottom − 1 (stacked); one-line tag chips | GREEN if 170-17's `md:` stack holds |
| N-STRAT V640 | stacked, as at V390; name block ≥ 160 px | GREEN if the stacked name block is full width (was 142 px beside the group) |
| N-STRAT V960 | control group and name block overlap vertically (one row); name block ≥ 160 px | GREEN (one row from md up, passed before) |

## Deviations from Plan

**1. [Rule 1 - Bug] The wrap rule uses vertical overlap, not equal tops.**
- **Found during:** Task 1, while reading `AllocationsTabs.tsx`. A tab renders a count badge when `count > 0`, and the strip is `items-center`.
- **Issue:** The plan's rule was "tops differ by more than 2 px". A taller badge-carrying tab shifts its top even on one line, so that rule would fail a strip that is correct.
- **Fix:** The helper fails when the largest child top is ≥ the smallest child bottom − 1 px, i.e. some child starts at or below another child's bottom. This is true only on a second line. It gives the same four fixture outcomes.
- **Files:** `e2e/helpers/geometry.ts`. **Commit:** `d0cc4fd63`.

**2. [Rule 2] The helper also fails on a strip with no laid-out element child.** This is W-02: an empty strip must not pass. It sits beside the zero-count locator guard. **Commit:** `d0cc4fd63`.

**Branch note.** The commits are on `feat/170-gap-18`, as the orchestrator assigned. They are not in the `agent-*` namespace, which is the same way 170-15/17/19 committed before their merge at `24d2c734c`. `node_modules` (a symlink) was never staged.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: e2e/helpers/geometry.ts, e2e/reflow.spec.ts, e2e/layout-narrow.spec.ts
- FOUND commits: d0cc4fd63, 843c5f9ad, 8f5db3824
