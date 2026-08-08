---
phase: 152-scen-composer-legibility
plan: 03
subsystem: allocations-scenario-composer
tags: [SCEN-04, legibility, a11y, honesty-copy, ui]
requires:
  - "ScenarioComposer CompositionList (post-151: AUM input, per-row USD input)"
  - "151 em-dash pattern (title + duplicated sr-only sentence)"
provides:
  - "scenario-added-header — aria-hidden column-label strip above the added-strategies group"
  - "scenario-added-header-label — the five label spans (test seam)"
  - "NOTIONAL_UNAVAILABLE_NOTE — cause-accurate non-derivable notional sentence"
affects:
  - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (added-row render only)"
tech-stack:
  added: []
  patterns:
    - "invisible-sizer idiom: a header label column matches a content-sized control by reproducing its box classes around invisible placeholder text, with the label absolutely overlaid"
    - "cause-accurate remedy copy: an absence sentence must name the condition that actually produced the absence"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - ".planning/phases/152-scen-composer-legibility/152-VALIDATION.md"
decisions:
  - "D-3 upheld in code: the non-derivable notional says 'Notional needs live book equity — not derivable in this scenario', NOT CONTEXT's AUM sentence, because the cell's em-dash is driven by totalBookEquity == null and not by scenarioAum"
  - "Header and separator share ONE `addedStrategies.length > 0` guard via a fragment — no second conditional to drift"
  - "Header labels carry a data-testid seam so DOM order is assertable without depending on the invisible sizer's text"
metrics:
  duration: "~25 min"
  completed: 2026-08-07
  tasks: 2
  commits: 3
---

# Phase 152 Plan 03: Composer column labels + honest notional Summary

Labelled the composer's five unlabelled numeric columns with one aria-hidden
mono-eyebrow strip, and made the added row's non-derivable notional explain its
own em-dash with a cause-accurate sentence instead of the AUM remedy that could
never fix it.

## What Was Built

**Task 1 — the header strip** (`b7427750`)

A single `<li aria-hidden="true" data-testid="scenario-added-header">` mounted
inside the *existing* `draft.addedStrategies.length > 0` guard (the separator and
the header now share one conditional via a fragment), between the
`Strategies added · N` separator and the first added row. Five labels —
`WEIGHT` `USD` `MODE` `LEV` `NOTIONAL` — laid out with the row's own `gap-2` flex
and the live column widths (`w-20` / `w-24` / content / `w-16` / `w-20`), plus a
trailing spacer sized like the remove `×` button.

`MODE` has no fixed width because the mode toggle is content-sized, so the label
column uses the invisible-sizer idiom: a `relative` span carrying the toggle's
box classes (`rounded border border-transparent px-2 py-1 font-metric
text-fixed-11 uppercase tracking-wider`) around an invisible `Leverage` text
node, with the `MODE` label absolutely overlaid. The column therefore cannot
drift from the live control.

Two limitations are recorded in-code rather than left for a reviewer to
rediscover: the strip is sized for the DEFAULT Leverage mode (a Target-max-DD row
injects an extra `w-16` sub-control and drifts on that row only — UI-SPEC
Contract 3, accepted), and per-key rows deliberately get no header (post-151 they
have neither a dollar input nor a remove button).

**Task 2 — the honest notional** (`25c31f7c`)

`NOTIONAL_UNAVAILABLE_NOTE` was defined adjacent to `AUM_UNSET_REMEDY` so the two
sentences sit side by side and the distinction is visible at the definition site.
The added row hoists `const nText = notionalText(a.id)` and branches only on the
render: when `nText === "—"` the span's `title` becomes the cause-accurate
sentence and an `sr-only` span carries the same words (a `title` alone is
unreachable by keyboard/touch — 151's `renderDollarInput` rationale). The derived
branch keeps its original sentence byte-verbatim.

`notionalText`'s arithmetic, the per-key notional span, `AUM_UNSET_REMEDY`, and
every 151 sizing control are untouched — the component diff is three hunks
(5814, 6327, 6413).

## Key Decisions

**The copy names the real cause.** CONTEXT pinned "Set portfolio AUM to size in
dollars" for this cell. That sentence is false here: the em-dash comes from
`totalBookEquity == null` (or a missing blend share), and `scenarioAum` is a
deliberately distinct number. A book-less allocator who followed that remedy
would type an AUM and watch the cell stay dashed. Shipping it would have been the
same defect class the phase exists to remove, so the plan's D-3 narrowing was
implemented as written, with the reasoning recorded in a code comment so the next
reader cannot "unify" the two strings as a tidy-up.

**One guard, not two.** Putting the header behind its own
`addedStrategies.length > 0` check would have created a second condition that can
drift from the separator's. A fragment inside the existing guard makes the
"header renders iff the separator renders" invariant structural rather than
tested-by-coincidence.

## Tests

8 new tests across two describes, plus one relaxed pre-existing assertion.

`SCEN-04 header (Phase 152)` — 5 tests: absent with zero added strategies (proved
non-vacuous by rendering a live per-key book alongside), exactly one instance
with two added rows, `aria-hidden="true"` with the labels unreachable as
accessible names, the five labels in exact DOM order with no separator glyph, and
sibling placement between the separator and the first row (asserted twice —
sibling walk and `compareDocumentPosition`).

`SCEN-04 honest notional (Phase 152)` — 3 tests: the non-derivable branch (title,
em-dash text, and the sr-only sentence found by `within(cell).getByText`, plus an
explicit assertion that it is *not* the AUM sentence), the derived branch pinned
byte-verbatim, and the per-key span proven untouched. Both cells are scoped by
`[data-scope-ref=...]` because the `scenario-constituent-notional` testid lives on
two row types.

**SC3 falsifier observed.** Making the remedy `title` unconditional turned
"SCEN-04 honest notional (derived)" RED with the exact wrong-branch message
(`expected 'Notional needs live book equity…' to be 'Notional = equity × blend
share…'`). Reverted from a scratchpad snapshot (md5-verified in both directions,
never `git checkout --`), re-ran green. Recorded in 152-VALIDATION.md.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Phase 112 test (f) pinned the notional cell's textContent to exactly "—"**
- **Found during:** Task 2, full-file verification
- **Issue:** `(f) — added-only mode (no book equity) renders the notional as an
  em-dash, never $0` asserted `cell.textContent` `.toBe("—")`. The new sr-only
  sentence lives inside that span, so `textContent` is now `"—"` plus the
  sentence. The failure was the assertion's *shape*, not its intent — the test
  exists to forbid a fabricated `$0`.
- **Fix:** relaxed to `.toContain("—")` and strengthened the companion line from
  `.not.toContain("$0")` to `.not.toMatch(/\$/)` so the test still fails on any
  dollar figure, fabricated or real. The intent and its falsifiability are
  preserved; a comment records why the equality was relaxed and points at the
  block that now pins the sentence.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- **Commit:** `25c31f7c`

**2. [Rule 3 - Blocking] New describes needed their own capturing browse-drawer mock**
- **Found during:** Task 1, first RED run
- **Issue:** `addStrategy` failed on `expect(browseOnAdd).not.toBeNull()` — the
  file-level `vi.clearAllMocks()` wipes the drawer mock implementation, and every
  top-level describe in this file re-installs its own capturing mock in a local
  `beforeEach`. The new describes had none.
- **Fix:** added the same local `beforeEach`/`afterEach` pair (the file's
  established convention) to both new describes, with a comment naming why.
- **Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
- **Commits:** `b7427750`, `25c31f7c`

### Architectural changes

None.

## Verification

| Check | Result |
|-------|--------|
| `npx vitest run "…/ScenarioComposer.test.tsx" --no-file-parallelism` | 263/263 passed |
| `npx vitest run … -t "SCEN-04" --no-file-parallelism` | 8 passed |
| `npx eslint "…/ScenarioComposer.tsx" "…/ScenarioComposer.test.tsx"` | clean |
| `npx tsc --noEmit` | clean |
| `grep -c 'scenario-added-header"'` in the component | 1 (single mount) |
| `grep -c` the pinned notional sentence in the component | 1 (the const only) |
| `AUM_UNSET_REMEDY` value | unchanged — `"Set portfolio AUM to size in dollars"` |
| component diff hunks | 3 (const, `nText` hoist, added-row span) + the Task-1 header — per-key span and `notionalText` body untouched |
| repo-wide grep for the two testids outside this component/test pair | none |

## Known Stubs

None.

## Threat Flags

None — the header renders no data and is `aria-hidden`; the notional change is
copy on an existing read-only cell. No new network, auth, file, or schema
surface.

## Notes for Downstream Plans

- **152-05 / 152-06 build on this file.** The header li is a NON-ROW `<li>` in
  `scenario-constituent-list`. Any future `getAllByRole("listitem")` assertion
  scoped to that ul must account for it (the three existing ones are scoped to
  the PCR list and were unaffected).
- The added row now defines `const nText` before its `return` — the row-detail
  work in 152-06 shares that scope.
- Pitfall 3 stands: a Target-max-DD row drifts its own labels. If a later plan
  wants that fixed, it is a per-row header, not a tweak to this strip.

## Self-Check: PASSED

- `152-03-SUMMARY.md`, `ScenarioComposer.tsx`, `ScenarioComposer.test.tsx` — all present on disk.
- Commits `b7427750` and `25c31f7c` — both found in `git log`.
