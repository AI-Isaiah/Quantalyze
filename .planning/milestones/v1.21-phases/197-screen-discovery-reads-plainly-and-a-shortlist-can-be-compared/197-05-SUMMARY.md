---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
plan: 05
subsystem: ui
tags: [discovery, compare, route-05, selection, sticky-bar, pinned-stack, a11y]
requires:
  - phase: 197-03
    provides: "series_end verdict partition, so fixtures with a current series_end keep their order"
  - phase: 197-04
    provides: "compare-href.ts (COMPARE_MAX_ITEMS, compareHref) and the /compare Add and Remove side"
provides:
  - "StrategyTable selectable prop: leading select column, sr-only status, sticky Compare (n) bar with chips, Clear, cap of four"
  - "SelectCheckbox.tsx: the 44 x 44 'Select {name} to compare' checkbox shared by the table cell and the grid card overlay"
  - "Select column in the @3xl pinned stack with measured --pin-rank-left / --pin-star-left / --pin-strategy-left offsets"
  - "phase-149 pin 2b: the anonymous /browse page never passes selectable"
affects: [197-06]
tech-stack:
  added: []
  patterns: ["opt-in prop gates every branch so the three byte-pinned default mounts do not move", "focus targets found by data-select-for / data-chip-remove-for inside the list panel, resolved after commit"]
key-files:
  created:
    - src/components/strategy/SelectCheckbox.tsx
    - src/components/strategy/StrategyTable.selection.test.tsx
  modified:
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - src/components/strategy/StrategyTable.test.tsx
    - "src/app/(dashboard)/discovery/[slug]/page.tsx"
    - "src/app/(dashboard)/discovery/[slug]/page.test.tsx"
    - src/__tests__/phase-149-my-strategies-parity.test.ts
    - e2e/layout-narrow.spec.ts
key-decisions:
  - "Selection is table state in tick order; the cap is enforced in the state setter as well as by disabled boxes, so a fifth id cannot reach compareHref by any path"
  - "Rank cells write both class strings in full (default and --pin-rank-left) instead of a template variable, so the default literal stays in the source for the existing StrategyTable.test.tsx pins and the byte pin"
  - "SelectCheckbox is a small shared file (two call sites, and the grid cannot import the table without a cycle)"
  - "A chip x that leaves fewer than two focuses the REMOVED strategy's checkbox when its row is on screen, else the first visible checkbox (UI-SPEC says 'that strategy', read as the one whose chip was activated)"
requirements-completed: [ROUTE-05]
duration: ~70m
completed: 2026-11-08
status: complete
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
commits: 3
plan_head_before: 9488fd14d21695cf04d289dd1a3e47443a6ac7c5
plan_head_after: d42d3a209fca7f57a82cf097751ac608656747ba
---

# Phase 197 Plan 05: Discovery row selection and the Compare bar Summary

On `/discovery/[slug]` an allocator ticks 2 to 4 rows (table or grid) and opens `/compare?ids=` with exactly those strategies, in tick order, from a sticky bar; no other mount renders any of it.

## What was built

- **Task 1 (tracer), `e5ecd1fac`:** `selectable` prop on `StrategyTable`, `selectedIds` state, a leading 44px select column (header sr-only "Select to compare", cell `SelectCheckbox`, empty placeholder-row cell, `emptyRowColSpan` + 1), the always-mounted sr-only `role="status"` line, the bar from two selected with a `Link` copying the `Button` primary md classes and `href={compareHref(selectedIds)}`; the discovery page passes `selectable`.
- **Task 2, `d3a32b5af`:** cap of four (disabled unchecked boxes with the cap `title`, cap caption in the bar), chips in tick order (`max-w-64` truncate with `title`, x buttons with the 44px coarse-pointer target), `Clear`, focus per the UI-SPEC, status text at 1/2-3/4, grid checkbox overlay as a sibling of the card link (spacer widened to `w-20` when both show), and the pinned stack: select at `@3xl:left-0`, rank on `--pin-rank-left`, star and Strategy offsets measured with select included, rem calc fallbacks, no px literal.
- **Task 3, `d42d3a209`:** phase-149 pin 2b (browse page free of `selectable`, discovery page carries it), `e2e/layout-narrow.spec.ts` discovery pinned block moved to select, rank, star, Strategy (indices, precondition, select-to-rank edge equality at rest and max scroll, `select` in the pinned-cells list, select box CSS in the P-5 rebuild), and a new below-@3xl check that select cells scroll away.

## Verification

- `npx vitest run src/components/strategy "src/app/(dashboard)/discovery" src/__tests__/phase-149-my-strategies-parity.test.ts src/__tests__/critical-regressions.test.ts`: 88 files, 1618 tests pass. Selection test: 18 tests. Default-mounts byte pin passes with no fixture edit (`git diff --name-only -- src/components/strategy/__fixtures__` empty).
- `npx tsc --noEmit` clean; `npm run lint` 0 errors (2 pre-existing unused-var warnings in untouched factsheet files), route-contract and planning-hygiene OK; `npx playwright test --list e2e/layout-narrow.spec.ts` lists 64 tests in 1 file.
- px-literal acceptance: `git diff <base> -- StrategyTable.tsx | grep '^+' | grep -E '[0-9]+px' | grep -v 44px` prints nothing.
- RED evidence (Task 1): the new file against the pre-change source failed 4 of 5 tests (checkbox missing, status region missing, bar missing); the fifth, no `selectable` renders nothing, passed as the control.
- Gate-can-fail check (byte backup, restored, `cmp` identical): with the state-setter cap guard, the Clear focus request and the checkbox `disabled` removed and the href re-ordered, 5 tests went RED (tick-order href, cap, chips href, Clear focus, grid overlay); restored, 18/18 green.

## Deviations from Plan

**1. [Rule 3 - Blocking] Pinned-cell census in `StrategyTable.test.tsx` updated (file not in the plan's list).**
- **Found during:** Task 2. The 170.2 census counts `@3xl:left-0` tokens (3) and total offset tokens (12) in the source; the opt-in select column adds three `@3xl:left-0` cells (header, data row, placeholder row).
- **Fix:** counts moved to 6 and 15 with a comment saying why. The rank, star and Strategy literal pins (`sticky @3xl:left-0 z-10 w-14 bg-surface px-2` and the rest) pass unedited, which is why the rank cells carry both class strings in full rather than `${rankLeftClass}`.
- **Commit:** `d3a32b5af`.

**2. [Process] TDD by test-first plus a neuter run, not separate RED commits.** `tdd_mode` is false and the plan is `type: execute`; the RED output is quoted above.

**3. Interpretation, focus after a chip x down to one.** The UI-SPEC and plan say focus moves to "that strategy's checkbox"; implemented as the strategy whose chip x was activated (the control that held focus), falling back to the first visible checkbox when its row is hidden. A test covers both arms.

No Rule 4 items.

## Observations for the verifier

- **Cap caption on a phone.** The UI-SPEC puts "Up to 4. Remove one to add another." inside the chip group, which is hidden under the bar's @2xl width, and the 375px backstop wants only the count and two buttons on one line. A touch user at the cap therefore sees disabled boxes whose reason is in the sr-only status and the `title` only. Followed the spec literally; if U-14 ("says why") should hold on touch, the caption needs its own row under @2xl. Recorded, not changed.
- **Backstop rows** (long chip name at 1280px, 375px bar on one line, pinned stack at @3xl, keyboard walk) are visual and were not run in a browser here. The e2e spec changes are type-checked and listed only; the seeded lane runs on the PR bound to the head SHA (VALIDATION.md phase gate).
- `ROUTE-05` is marked complete: plan 04 delivered the `/compare` Add and Remove side and this plan the discovery selection side.

## Known Stubs

None.

## Threat Flags

None beyond the register (T-197-13 mitigated: `compareHref` over server-provided strategy ids only, cap in state and in the UI, test asserts exactly four ids; T-197-14 mitigated: opt-in prop, phase-149 pin 2b, byte pin unchanged).

## Self-Check: PASSED

Created files exist (`SelectCheckbox.tsx`, `StrategyTable.selection.test.tsx`); commits `e5ecd1fac`, `d3a32b5af`, `d42d3a209` are ancestors of HEAD.
