---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 12
subsystem: holdings-panel
tags: [lean-06, holdings, flagged-positions, c9, d-02, oq-7]
requires:
  - phase: 198-11
    provides: the Positions section, hiddenRowIds and the table wrappers
provides:
  - mapFlagsToRows, refOfRowId and the FlaggedRows prop type
  - a flagged prop on both position tables (chip, row action, one inline sub-row)
  - Holdings lists every flagged position once; the separate list carries only flags with no rendered row
affects: []
tech-stack:
  added: []
  patterns: [a flag is per scope ref and rows are per key, so the map fans a flag out and merges nothing]
key-files:
  created:
    - src/app/(dashboard)/allocations/lib/flagged-position-map.ts
    - src/app/(dashboard)/allocations/lib/flagged-position-map.test.ts
    - src/app/(dashboard)/allocations/components/PositionsTables.flagged.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.positions-once.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.flagged-rows.test.tsx
  modified:
    - src/__tests__/holding-scope-key-census.test.ts
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
    - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
key-decisions:
  - "The panel's renderedIds also excludes spot rows hidden by the untrusted-key filter (showRevoked off), not only dust, so a flag on such a row falls to the list instead of vanishing."
status: complete
requirements-completed: [LEAN-06]
duration: about 50 min
completed: 2026-11-08
commits: 4
plan_head_before: d2933882c99cd7233e02eabd2d2e4d927851da8f
plan_head_after: ea0ba3534991b450b7c51d02f67f71467e786101
actuals:
  tokens: 16000
  tasks: 3
  commits: 4
---

# Phase 198 Plan 12: Holdings lists every flagged position once Summary

A flagged position now carries a `Flagged` chip and a `Record outcome…` action in its own Holdings row, opening the shipped outcome form inline, one at a time; the separate flagged list mounts only for flags with no rendered row.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | The flag-to-row map and its census entry (C9) | bf751aa1b |
| 2 | A flag prop on both position tables | bcf22e8a7 |
| 3 | Holdings lists every flagged position once | 25bc89444 |
| - | Memoize the flaggedHoldings default (lint warning from the new dependency) | ea0ba3534 |

## What was built

- `lib/flagged-position-map.ts`: `refOfRowId` splits at the last `#`; `mapFlagsToRows(flags, rowIds)` builds each flag's ref with one `buildHoldingRef(` call and maps every row of that ref, returning `unmatched` flags. The census has a `key-free-by-design` entry for it (M2 count 1).
- `HoldingsTable` (legacy mode) and `OpenPositionsTable` take an optional `flagged: FlaggedRows`. Each main row carries `data-position-row`; a flagged row shows the chip and a 44px `Record outcome…` button (`aria-expanded`, `aria-controls="flagged-outcome-{id}"`); the open row gets one sub-row spanning every column. Footer passes still iterate every row.
- `HoldingsTabPanel`: one `useMemo` map over the ids the tables actually draw; `openOutcomeRowId`, `localDecisionsByRef` and `errorByRef` state; `renderOutcome` hands the exported `BannerSubRowContent` the flag object (never the row id), so the write carries `holding:binance:BTC:spot`, no `#`. A decision made from one key's row is reused by the other key's row.
- `ScenarioFlaggedHoldingsList` exports `BannerSubRowContent`, otherwise unchanged. `ScenarioStub`, `ScenarioComposer` and `BridgeDrawer` are untouched.
- No migration, no API route change, no wire-shape change, no package added.

## Neuter record (data-integrity and user-facing gates can fail)

gc-198-12-neuter: gate=flagged-position-map.test.ts (match rows by symbol only) result=red restored=identical
gc-198-12-neuter: gate=PositionsTables.flagged.test.tsx (open sub-row for every row of the open row's ref) result=red restored=identical
gc-198-12-neuter: gate=HoldingsTabPanel.positions-once/flagged-rows (mount list with every flag again) result=red restored=identical
gc-198-12-neuter: gate=HoldingsTabPanel.flagged-rows (drop the unmatched mount, SOL and dust cases) result=red restored=identical
gc-198-12-neuter: gate=HoldingsTabPanel.flagged-rows (pass every row id including hidden dust, flagged-dust case) result=red restored=identical

Each restored from a byte copy with `cp -p`, `cmp` exit 0, then GREEN.

## Gates

gc-198-12-gates: vitest=red(3 files, none touched by this plan) tsc=clean lint=red(rule 6e only, known and not this plan's)

- `npx tsc --noEmit`: exit 0.
- `npm run lint`: eslint 0 errors (the 2 remaining warnings are in files this plan did not touch); `check-planning-hygiene` rule 6e on ROADMAP.md:376 (the known "Phase 196" bullet, not fixed per the brief).
- `npm test`: 24643 passed, 4 failed in 3 files, none of which this plan touches (`git diff` of the 4 commits is the 11 files listed above):
  - `src/__tests__/check-planning-hygiene.test.ts` (live ROADMAP.md, the same rule 6e).
  - `src/lib/factsheet/compute.conventions.test.ts` (2 inline snapshots, fixtures B and C).
  - `src/__tests__/e2e-seeded-hydration-guard.test.ts` (CI list parses 27 specs, pin expects 26).
  The last two are unrelated to Holdings and were left alone (scope boundary); they need an owner.
- Allocations directory and the census: 182 files, 3195 tests green. The two earlier full runs differed by one failing file, so one of the three may be order-sensitive.

## Decisions Made

- `renderedIds` also drops spot rows hidden by the untrusted-key filter when `showRevoked` is off. The plan named only dust; without this a flag on such a row maps to a row the table does not draw and is unreachable (T-198-22). Covered by a test.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Untrusted-key filter can hide a flagged row**
- **Found during:** Task 3
- **Issue:** the plan's `renderedIds` removed only dust, so with "Show holdings from ... off" a flagged row on a revoked key had no drawn row and no list entry.
- **Fix:** exclude spot rows that `keyNeedsAttention` while `showRevoked` is false.
- **Files modified:** HoldingsTabPanel.tsx; test in HoldingsTabPanel.flagged-rows.test.tsx
- **Commit:** 25bc89444

**2. [Rule 1 - Lint] flaggedHoldings default re-created per render**
- **Found during:** gates
- **Issue:** `props.flaggedHoldings ?? []` as a new useMemo dependency raised `react-hooks/exhaustive-deps`.
- **Fix:** wrapped it in its own `useMemo`.
- **Commit:** ea0ba3534

The tables' first-cell chip row also gained `flex-wrap` so the new action wraps on narrow cells.

## Open

- OQ-7 stays an assumption (chip + inline action instead of a separate list); reversing it is one mount.
- The three unrelated failing test files above, and rule 6e.

## Known Stubs

None.

## Self-Check: PASSED

Files exist; commits bf751aa1b, bcf22e8a7, 25bc89444 and ea0ba3534 are on feat/198-mybook.
