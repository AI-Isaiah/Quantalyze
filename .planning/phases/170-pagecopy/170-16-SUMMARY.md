---
phase: 170-pagecopy
plan: 16
subsystem: ui
tags: [reflow, containing-block, responsive-table, sr-only, gap-closure]
status: complete

requires:
  - phase: 170
    provides: "170-15 containing-block-aware offender walk and its escapee / contained-escapee self-test fixtures"
provides:
  - "ResponsiveTable scroll region is `relative`, so it is the containing block of its absolutely positioned descendants (sr-only labels) and clips them"
  - "[170-GAP-1] vitest pin on the region's `relative` class"
  - "recorded audit of all 11 ResponsiveTable consumers"
affects: [170-11]

actuals:
  tokens: 3500
  tasks: 2
  commits: 1   # task commits; the SUMMARY commit is the plan's metadata commit

plan_head_before: 24d2c734c66b1ed156e754d0b15de3383a2081b9
plan_head_after: acf24d57288976038eeb995941c1c9b81bf9a2d0

tech-stack:
  added: []
  patterns:
    - "A shared overflow scroller is also the containing block of its content"

key-files:
  created: []
  modified:
    - src/components/ResponsiveTable.tsx
    - src/components/ResponsiveTable.test.tsx

key-decisions:
  - "Class-wide fix on the shared scroller, not on the composer's list card, so every consumer with sr-only content inside it (composer, StrategyTable) gets it"
  - "Task 2 changed no code: the audit found no visible absolutely positioned element that the new containing block would clip"

metrics:
  duration: "~20 min"
  completed: 2026-09-30
---

# Phase 170 Plan 16: ResponsiveTable scroller becomes a containing block Summary

The shared `ResponsiveTable` scroll region now carries `relative`. The composer's
`sr-only` weight and leverage labels are `position: absolute`. Until now their containing block was
the page, so they escaped both the region and `#main-content` and widened the document. They
now take the region as their containing block, and the region clips them. A vitest case pins the
class. A composer-shaped Chromium fixture reproduces the CI signature on the old markup and
comes back clean with the fix.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 (tracer, tdd) | the scroll region becomes a containing block, pinned by vitest | `acf24d572` | src/components/ResponsiveTable.tsx, src/components/ResponsiveTable.test.tsx |
| 2 | consumer audit and the consumers' own suites | no commit (no code change) | none |

## Evidence

**RED on the unchanged component.** I wrote the `[170-GAP-1] the scroll region is the containing block of
its absolutely positioned content` case first. `npx vitest run src/components/ResponsiveTable.test.tsx`
reported `Tests 1 failed | 5 passed (6)`, failing at `expect(region).toHaveClass("relative")`.

**GREEN with the fix:** `Tests 6 passed (6)`.

**Neuter.** I took a scratchpad byte backup, then removed the `"relative",` line from the class
array by hand. The run gave `FAIL ... [170-GAP-1] ...` and `Tests 1 failed | 5 passed (6)`. I restored
the line by hand. `cmp` against the backup reported the file identical, and the run gave
`Tests 6 passed (6)`.

**Mechanism in Chromium (170-15 self-test, unedited).**
`CI=1 npx playwright test e2e/reflow.spec.ts -g "helper self-test"` gave `5 passed`. The escapee
case logs `LAYOUT-NARROW-OFFENDER viewport=390 main=0 doc=247 offender=LABEL#escapee`. The
contained-escapee case logs `LAYOUT-NARROW-CLEAN viewport=390 main=0 doc=0`.

**Composer-shaped local reproduction.** I used a scratch spec, deleted afterwards and never committed. It ran
at 390 px through the real `assertNoReflow` and mirrored the composer's row anatomy:
- `#main-content` is unpositioned and `overflow-y:auto`.
- A region with `overflow-x:auto` holds a `min-width:max-content` grid `ul`.
- Each `li` is a `flex-col` card. Inside it, a `justify-between` row puts the controls div (`flex items-center gap-2`) at the right end.
- The controls div holds the sr-only weight and leverage labels, their inputs, and a notional span with an sr-only suffix. The sr-only style is Tailwind's `sr-only` declarations, written inline.

| region | result |
|---|---|
| unpositioned (old) | `reflow: main=0 doc=415 scroller=doc offender=LABEL`, log `LAYOUT-NARROW-OFFENDER viewport=390 main=0 doc=415 offender=LABEL also=LABEL,SPAN` |
| `position:relative` (new) | `LAYOUT-NARROW-CLEAN viewport=390 main=0 doc=0` |

The old row matches CI run `36764778803`: main does not overflow and the document does. The
named offender is the sr-only `LABEL`, with a second sr-only label and the sr-only notional `SPAN`
as `also=` offenders.

A first fixture put the labels as direct children of a flex `li` and did NOT overflow. An
absolutely positioned child of a flex container gets its static position at the container's
start, which there was x≈0. The real labels sit in the controls div at the row's right end, so
their static position is that div's start, and that is where they escape from. The fixture was
corrected to match. This detail explains why the doc edge tracks the list's right end in CI.

This is the mechanism under the real class anatomy. It is not the seeded route.
The seeded rows are proven only in the post-land CI run (below).

**Consumer suites (Task 2):**
`npx vitest run src/components/ResponsiveTable.test.tsx src/components/strategy "src/app/(dashboard)/allocations" "src/app/factsheet/[id]/v2" src/components/admin`
gave `Test Files 254 passed (254)`, `Tests 3641 passed (3641)` and exit 0.
`npx tsc --noEmit -p .` exits 0.
`npx eslint src/components/ResponsiveTable.tsx src/components/ResponsiveTable.test.tsx` exits 0.
No snapshot or test pins the region's exact class string.

Acceptance greps: `grep -c '"relative"' src/components/ResponsiveTable.tsx` → 1.
`grep -c '170-GAP-1' src/components/ResponsiveTable.test.tsx` → 1.

## Consumer audit (measured at HEAD `acf24d572`)

`grep -rln '<ResponsiveTable' src` lists 11 consumers plus two test files: `ResponsiveTable.test.tsx`
and `OpenPositionsTable.all-columns.test.tsx`. For each consumer I scanned the `<ResponsiveTable>`…`</ResponsiveTable>`
subtree for `absolute`, `fixed`, `sticky`, `relative`, `sr-only` and portals. I also scanned
every component rendered inside a subtree.

| Consumer (region) | absolute / sr-only sites inside the region | nearest positioned ancestor | effect of `relative` |
|---|---|---|---|
| StressWindowsPanel ("Stress windows") | none | n/a | none |
| MetricsColumn ("Worst 10 drawdowns") | none | n/a | none |
| HoldingsTable ("Strategies", "Holdings" x2) | none in the subtrees. Child components (StrategySortableHeader, SortableHeader, StatusDot, OwnershipTag, Button, Link, HoldingNoteIconButton, HoldingNoteRow, HoldingDetail, BridgeOutcomeBanner) have no absolute, fixed or sr-only sites | n/a | none |
| OpenPositionsTable ("Open positions") | none | n/a | none |
| ScenarioCompareTable ("Scenario comparison") | none | n/a | none |
| ScenarioComposer ("Strategies and weights") | 2 header-label overlays `absolute inset-0` (one per list header) | a `relative shrink-0` span inside the region | none. They were already inside the scroller |
| ScenarioComposer (same) | sr-only `<label>`s `weight-${k.id}`, `leverage-${k.id}`, `weight-${a.id}`, `leverage-${a.id}` | before the fix, none (initial containing block) | **now clipped by the region. This is the intended fix** |
| ScenarioComposer (same) | lowercase renderers called inside the rows. The subtree scan could not see these, so I scanned their definitions separately. `renderNotional` has the sr-only `{labelText} notional.` span and the sr-only cause note. `renderDollarInput` has the sr-only `AUM_UNSET_REMEDY` span and the sr-only `alloc-usd-${ref}` label. `renderTargetInput` has the sr-only `target-dd-${ref}` label. `renderModeToggle` and `renderSolveState` have no absolute or sr-only sites | before the fix, none (initial containing block) | **now clipped by the region, which is the intended fix.** The notional sr-only span is the `SPAN` in the fixture's `also=` list |
| ScenarioComposer (same) | children TrustTierLabel, CoverageStateChip, YoursChip, Link | no absolute sites | none |
| CorrelationMatrix ("Correlation matrix") | none | n/a | none |
| AllocatorMatchQueue ("Match candidates", "Excluded strategies", "Decision history") | `thead sticky top-0 z-10` (sticky, not absolute); ScoreCell has none | n/a | none. Sticky keeps this region as its scroll container, and z-index auto on the region creates no stacking context |
| MatchQueueIndex ("Match queue allocators") | none | n/a | none |
| ComputeJobsTable ("Compute jobs") | none (ui `Table*` primitives have no positioned sites) | n/a | none |
| StrategyTable ("Strategies") | sr-only `Rank`, `Watchlist` and `Details` spans | their `sticky` `<th>` (sticky is positioned) inside the region | none. They were already contained |
| StrategyTable (same) | StarToggle failure hint `absolute left-full` | StarToggle's own `relative inline-flex` span inside the region | none. It was already inside the scroller |
| StrategyTable (same) | SimulateImpactButton: `Tooltip` is a `createPortal` with `position: fixed`, and the dynamic-import loading overlay is `fixed inset-0 z-50` | the viewport (no transform on the region) | none |
| StrategyTable (same) | sticky cells `z-10`/`z-20`/`z-30` | n/a | none. Their z-order resolves in the card's `relative isolate` stacking context either way |
| StrategyTable (outside) | scroll cue `absolute inset-y-0 right-0`, a LATER sibling of the region inside the `relative isolate` card | the card | none. It is not inside the region, and as a later z-auto positioned sibling it still paints over the region |

No consumer uses a portal whose content lives inside the region. No visible absolutely
positioned element is newly clipped. The only newly clipped elements are the composer's sr-only
labels, which is the point of the fix.

**Paint-order side effect, checked.** A `relative` region with z-index auto now paints in the
positioned layer, in tree order. Absolute or fixed sites outside the regions in the 11 consumer
files: only the StrategyTable cue, a later sibling that still paints on top. The other matches
were `text-fixed-*` false positives. An app-wide search for z-auto dropdowns
(`absolute … top-full` with no `z-`) found none.

**`offsetParent` side effect, checked.** `relative` also makes the region the `offsetParent` of
its non-positioned descendants. I grepped `offset(Top|Left|Parent)` over the 11 consumer files,
`src/components/strategy`, `src/components/notes` and the allocations components, and found no
reads. StrategyTable's cue uses `scrollWidth`/`clientWidth`, and the Tooltip uses
`getBoundingClientRect`. Neither is affected.

## Post-land must-have (orchestrator, first e2e-seeded run after the gap plans land)

These seven composed-scenario rows must print `LAYOUT-NARROW-CLEAN` for their `assertNoReflow` calls:

1. N-FOOT V390
2. N-FOOT V640
3. N-FOOT V960
4. N-SCN V390
5. N-SCN V640
6. N-KPI composed V390
7. N-KPI composed V640

The N-FOOT (f)/(g) footer assertions then run for the first time, and their outcomes belong in
the phase re-verification. If any row still overflows, 170-15's walker names the offender. That
name becomes a follow-up gap INSIDE Phase 170. It is not papered over here.

## Deviations from Plan

**1. [Evidence, additive] Composer-shaped Chromium reproduction.** The plan's local evidence was
170-15's generic fixture. The orchestrator asked for a reproduction under the ResponsiveTable and
sr-only structure where possible, so I added one as a throwaway spec. It was not committed, and
`e2e/reflow.spec.ts` is unedited. Results are above.

**2. [Process] Branch namespace.** `feat/170-gap-16` is outside the executor's `agent-*`
allow-list. The orchestrator assigned it explicitly, and it is not a protected branch, so I
committed on it (same as 170-15).

Otherwise the plan was executed as written.

## Known limits

- The seeded composed-scenario route was not run locally, by design. The seven CI rows above are the row-level proof.
- The vitest pin checks the class token in jsdom. It cannot measure layout. The layout claim rests on the Chromium fixtures.
- Only absolute and fixed boxes were audited. Containing blocks created by `transform`, `filter` or `contain` inside a region were not searched for. None of the scanned subtrees showed them.

## Threat Flags

None. This is a single CSS class on a shared UI primitive, with no new surface. T-170-40 is
mitigated by the audit and the consumer suites. T-170-41 is mitigated by the named post-land rows.

## Self-Check: PASSED

- src/components/ResponsiveTable.tsx and src/components/ResponsiveTable.test.tsx are modified in `acf24d572`.
- `acf24d572` exists on `feat/170-gap-16`.
