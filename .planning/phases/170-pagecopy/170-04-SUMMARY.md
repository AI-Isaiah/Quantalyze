---
phase: 170-pagecopy
plan: 04
subsystem: ui
tags: [layout, scenario-footer, responsive-table, allocations]

requires:
  - phase: 170-01
    provides: shared narrow-width layout primitives this footer and list sit inside
  - phase: 170-02
    provides: the allocations surface the scenario tab renders on
provides:
  - Wrap-safe scenario commit bar that clears the mobile nav and prints the empty state once
  - Constituent member rows scrolling inside one labelled focusable region
affects: [170-09, layout-narrow N-FOOT, layout-narrow N-SCN]

actuals:
  tokens: 3996
  tasks: 2
  commits: 4

plan_head_before: 86bda60c01ad2b5ded7c2e2f5e31d82931da3076
plan_head_after: 78cb29a490f42616bba22907e077a13d4831dbcb

tech-stack:
  added: []
  patterns:
    - "Sticky offset as responsive classes (bottom-16 md:bottom-0), not an inline style object"
    - "Fixed-anatomy rows scroll inside ResponsiveTable rather than wrapping"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
    - src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx

key-decisions:
  - "Empty state prints once in the change-count chip; the summary slot renders only when hasDiffs"
  - "Summary items wrap between items: each '{value} {label}' is whitespace-nowrap and the joiner sits outside that span"
  - "Did not pass a ResponsiveTable hint; the component default stays (list wording is a later copy question)"

patterns-established:
  - "N-FOOT: sticky bottom-16 md:bottom-0, min-h-[56px], flex-wrap, action group ml-auto shrink-0"
  - "N-SCN: constituent ul inside ResponsiveTable label Strategies and weights, ul min-w-max"

requirements-completed: []

coverage:
  - id: D1
    description: "At zero diffs 'No changes yet' renders once, in the change-count chip; the summary slot renders only when there are diffs"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx#T_F1 diff_count=0"
        status: pass
    human_judgment: false
  - id: D2
    description: "Commit scenario sits in a right-aligned shrink-0 action group, at least 44px tall, in a wrap-safe sticky footer that clears the mobile nav below md"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx#T_F8 class sticky offset"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx#T_F11 action group"
        status: pass
    human_judgment: true
    rationale: "In-viewport and not-covered at V390/V640/V960 is the seeded layout-narrow N-FOOT row, which this plan does not run locally"
  - id: D3
    description: "Muted-only diffs keep 'No material change yet.'; one material diff renders '1 change' plus the summary"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx#T_F5 muted deltas"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx#T_F10 material delta"
        status: pass
    human_judgment: false
  - id: D4
    description: "Constituent rows scroll inside a focusable region named Strategies and weights; header strips stay inside the same ul"
    verification:
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#wraps the constituent list"
        status: pass
      - kind: unit
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx#keeps both column-header strips"
        status: pass
    human_judgment: true
    rationale: "scrollWidth greater than clientWidth and no page overflow at V390/V640 is the seeded layout-narrow N-SCN row, not asserted by vitest"

duration: 5min
completed: 2026-09-27
status: complete
---

# Phase 170 Plan 04: Scenario Footer and Member Rows Summary

**The scenario commit bar wraps inside one opaque box above the mobile nav, prints "No changes yet" once, and the member rows scroll inside a labelled region instead of widening the page.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-09-27T20:58:21Z
- **Completed:** 2026-09-27T21:02:49Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Replaced the footer's inline sticky style with classes: `sticky bottom-16 md:bottom-0 z-10 min-h-[56px] flex flex-wrap`, so the box grows when content wraps and sits 64 px above the scroll-port bottom below `md`.
- The empty state prints once, in the change-count chip. The summary slot renders only when `hasDiffs`. Material items are `whitespace-nowrap` spans joined by ` · ` outside those spans.
- Reset and Commit stay in `ml-auto flex shrink-0` with `min-h-[44px]`. Region label, both testids, accent fill, disabled states, and `aria-describedby` on a blocked commit are unchanged.
- The constituent `ul` is wrapped in `<ResponsiveTable label="Strategies and weights">` and carries `min-w-max`. Both `aria-hidden` header strips stay inside that `ul`. Row control widths were not touched.

## Task Commits

Each task was committed atomically:

1. **Task 1 RED: failing footer tests** - `ff376bc55` (test)
2. **Task 1 GREEN: wrap-safe footer, empty state once** - `d9bf73cbc` (feat)
3. **Task 2 RED: failing constituent-region tests** - `92b296bd0` (test)
4. **Task 2 GREEN: labelled ResponsiveTable region** - `78cb29a49` (feat)

## Files Created/Modified

- `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` - class-based sticky footer; summary gated on `hasDiffs`; `FOOTER_STYLE` removed.
- `src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx` - T_F1 tightened to length 1; T_F8 re-pinned to classes; T_F10–T_F12 added.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - constituent list wrapped in `ResponsiveTable`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - region name, focusability, `min-w-max`, and header-strip parent assertions.

## Decisions Made

- The joiner ` · ` sits outside each `whitespace-nowrap` span. Putting it inside the span would let a wrap split the separator from the next value, or keep a separator glued to an item.
- No `hint` was passed to `ResponsiveTable`. The accessible name stays `${label}: ${DEFAULT_HINT}`. List wording is a later copy question, as the plan said.
- Plan frontmatter names requirements `(f)`, `(g)`, `(h)`, `SC2-(d)`, and `SC2-NOSCROLL`. None of those ids exist in `REQUIREMENTS.md`, so none were marked complete.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Joiner placed outside the nowrap item span**
- **Found during:** Task 1 (GREEN)
- **Issue:** The first GREEN pass put ` · ` inside the `whitespace-nowrap` span, so the second item's text was ` · −4% Max DD` and a wrap could still glue the joiner to an item.
- **Fix:** Each `{value} {label}` is its own nowrap child; the joiner is a sibling text node. T_F12 asserts the item text without the joiner.
- **Files modified:** ScenarioFooter.tsx, ScenarioFooter.test.tsx
- **Verification:** Footer file 14/14 green after the fix.
- **Committed in:** `d9bf73cbc` (part of the Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix is the wrap contract the plan already named. No scope change.

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (task 1) | `ff376bc55` test(170-04) | present; vitest RED recorded below |
| GREEN (task 1) | `d9bf73cbc` feat(170-04) | present; 14/14 pass |
| RED (task 2) | `92b296bd0` test(170-04) | present; region query RED recorded below |
| GREEN (task 2) | `78cb29a49` feat(170-04) | present; 381/381 pass |
| REFACTOR | — | not needed |

The plan type is `execute`, with both tasks `tdd="true"`. RED commits precede each GREEN commit.

`check tdd-red-evidence` was not used as the verdict. It reads `node --test` summary lines (`# tests` / `# pass` / `# fail`) and unindented TAP names. This repo's runner is vitest, which does not print that footer. Faking those lines to obtain `RED_EVIDENCE_OK` would be a false record. The RED evidence is the vitest output below.

**Task 1 RED at HEAD** (`npx vitest run` on `ScenarioFooter.test.tsx`, before any footer implementation): 4 failed, 10 passed, exit 1.

- `T_F1` — expected length 1, received 2 (`getAllByText(/No changes yet/i)`).
- `T_F8` — expected class `sticky`, received `''` (inline style, no class).
- `T_F11` — expected `ml-auto`, received `flex items-center gap-3`.
- `T_F12` — expected 2 nowrap item spans, received 0.

**Task 1 neuter RED** (summary span rendered unconditionally, with the zero-diff string restored): `T_F1` failed, expected length 1, received 2. Gate re-applied; file then 14/14.

**Task 2 RED at HEAD** (`-t "wraps the constituent list"`, before the wrapper): `getByRole("region", { name: /^Strategies and weights/ })` threw `TestingLibraryElementError`. Exit 1.

**Task 2 neuter RED** (wrapper removed, `min-w-max` left on the `ul`): the same region query threw. Wrapper restored; the two new cases passed.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Ready for plan 170-05. Plan 170-09 edits `ScenarioComposer.tsx` after this plan and must not run against a checkout that lacks this wrap.
- CI `e2e-seeded` still owns the geometry proof: layout-narrow rows "composed scenario — N-FOOT" and "constituent rows — N-SCN". This plan did not weaken `e2e/layout-narrow.spec.ts` and did not run that spec.
- `npx tsc --noEmit -p .` exited 0. Eslint on the four touched files exited 0.

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/components/ScenarioFooter.tsx
- FOUND: src/app/(dashboard)/allocations/components/ScenarioFooter.test.tsx
- FOUND: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
- FOUND: src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
- FOUND: ff376bc55
- FOUND: d9bf73cbc
- FOUND: 92b296bd0
- FOUND: 78cb29a49

---
*Phase: 170-pagecopy*
*Completed: 2026-09-27*
