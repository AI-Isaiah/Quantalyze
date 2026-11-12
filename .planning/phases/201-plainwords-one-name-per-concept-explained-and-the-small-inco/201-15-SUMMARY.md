---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 15
subsystem: allocations-holdings-copy
tags: [d-01, d-04, d-05, d-06, d-07, d-11, d-17, u-09, u-12, copy-census, term, formatDay]
requires: [201-25, 201-26]
provides:
  - browse-drawer rows that print the route's displayed name once, with the codename line only when it differs
  - Term on the word "mandate" in the three fit badges
  - watchlist, Strategies-page, capital-ownership and allocation wording per UI-SPEC
  - plan-15 copy-census ledger with `pending: {}` and one exception
affects: [201-23, 201-24]
tech-stack:
  added: []
  patterns:
    - "the drawer compares the codename against the row's `name` exactly as the browse route returned it; no second name source (T-201-20)"
    - "helper dates go through formatDay; date table cells carry whitespace-nowrap"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.tsx
    - src/app/(dashboard)/allocations/components/StrategyBrowseDrawer.test.tsx
    - src/app/(dashboard)/allocations/components/WatchlistPanel.tsx
    - src/app/(dashboard)/allocations/components/WatchlistPanel.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.all-columns.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - src/app/(dashboard)/allocations/components/AddAllocationFlow.tsx
    - src/app/(dashboard)/allocations/components/AddAllocationFlow.test.tsx
    - src/app/(dashboard)/allocations/components/AllocateDialog.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.dust.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-header.test.tsx
    - src/app/(dashboard)/allocations/lib/add-allocation.ts
    - src/app/(dashboard)/allocations/lib/add-allocation.test.ts
    - src/lib/capital-ownership.ts
    - src/lib/capital-ownership.test.ts
    - scripts/copy-census/ledgers/plan-15.ts
decisions:
  - "One permanent census exception: the `Max DD floor` label in lib/mandate-gates.ts has no render caller (deriveMandateGates is read only by its own tests), so it is closed as not user-visible; a future render must wrap Max DD in a Term. pinnedExceptionCount is 1."
  - "The other allocations files named in files_modified (RiskTabPanel, EmptyState, OutcomesTabPanel, ScenarioStub, MissingDataMessage, AllocateDialog, WidgetState) needed no source change: the census reports no hit in them."
metrics:
  tasks: 3
  completed: 2026-11-11
status: complete
actuals:
  tokens: 60000
  tasks: 3
  commits: 3
plan_head_before: 8724de1ab708bff9ef2d452ffeb07ac6c4a2d03b
plan_head_after: 842d72752cdfddf5d94061321e330941f14894f7
---

# Phase 201 Plan 15: Holdings tab and allocations remainder copy Summary

The Holdings tab names strategies once in the browse drawer, explains "mandate" in its fit badges, and uses the canonical words (allocation, Strategies, watchlist) and the `formatDay` date format.

## Tasks

| Task | Name | Commit |
|------|------|--------|
| 1 (tracer) | Browse-drawer row shows the displayed name once; fit badges wrap "mandate" in Term; created-at through formatDay | 5b505fa36 |
| 2 | Watchlist sentence and nowrap formatDay cells, Strategies page name, capital-ownership sentences, add-allocation confirmation date | 041329c7d |
| 3 | Holdings tab and remainder: Allocation equity, Term on Sharpe and Max DD, ledger emptied | 842d72752 |

## Verification (this resume, at HEAD 842d72752)

- Scoped vitest (the task 3 verify family plus `copy-census.test.ts` and `figure-gate-census.test.ts`): 33 files, 564 tests passed.
- `npx tsx scripts/copy-census/run.ts --ledger plan-15`: exit 0, no remaining hit.
- eslint on all touched source files and the ledger: exit 0.
- `npm run typecheck`: exit 0.
- Acceptance counts: `toLocaleDateString(` in StrategyBrowseDrawer.tsx outside comments 0 (was 2); `formatCalendarDate` in add-allocation.ts 0 (was 2); `My Strategies` in the capital-ownership ternary sentences 0 (was 2). The remaining `My Strategies` and `Book equity` strings in these files are code comments only.
- Ledger `scripts/copy-census/ledgers/plan-15.ts`: `pending: {}`.

`gc-201-15-neuter: gate=StrategyBrowseDrawer.test.tsx result=red restored=identical` (replaced `s.codename !== s.name` with `true` on a byte backup; the arm "U-12: a row whose displayed name IS the codename prints it once; the second line carries only markets" went RED, 1 failed / 52 passed; `cp -p` back, `cmp` exit 0, 53/53 GREEN).

`gc-201-15-gates: vitest=green eslint=clean tsc=clean`

human-verify: look at the browse drawer and the Add allocation search rows with a long real strategy name at 390px and 1440px; the name should wrap or truncate with the full name recoverable by title, and the codename line should appear only when it differs from the name.

cross-plan-pins: for plan 201-24 to confirm on the merged branch. Tests outside this plan that still carry old literals were not edited here: `MissingDataMessage.test.tsx` and `AllocationsTabs.*` (plan 201-12), `GlancePanel.*` and `GlancePanel.scenario-parity.test.tsx` (plan 201-12), `lib/dust.test.ts` and `lib/book-figures.test.ts` (match "Book equity", plan 201-12's string). None failed in the scoped run.

## Deviations from Plan

**1. [Anchor drift, expected] `verify-plan-anchors` reports one MISS.** The plan's `verify-symbol` for `formatCalendarDate` in add-allocation.ts is absent because Task 2 deleted that local formatter in favour of `formatDay`, which is the plan's own instruction. The same applies to the "No favorites yet" and "My Strategies" anchors, which the copy change removed. This is the plan's intended end state, not a defect; the pre-flight anchor check was valid at task start and cannot pass after the change.

**2. Test files beyond files_modified.** The renames touched `HoldingsTable.all-columns.test.tsx`, `HoldingsTable.strategy-rows.test.tsx`, `HoldingsTabPanel.positions-header.test.tsx` and `AllocateDialog.test.tsx`, which are colocated tests of files this plan owns (test ownership rule in the plan context).

Otherwise: none; the plan executed as written. This resume found all three tasks committed and every acceptance criterion already met, so no follow-up code commit was needed.

## Known Stubs

None.

## Threat Flags

None. T-201-20 holds: the drawer prints only the route's `name` and the codename it already carried; the change hides a duplicate codename line and adds no name source.

## Self-Check

PASSED
- Commits 5b505fa36, 041329c7d, 842d72752 exist on wt/201-p15 (`git log` shows all three above 8724de1ab).
- Modified files listed in key-files exist in the tree (the scoped run imports them; typecheck clean).
- `git rev-list --count 8724de1ab..HEAD` = 3 matches `commits: 3`.
- Neuter run recorded above with byte-identical restore (`cmp` exit 0).
