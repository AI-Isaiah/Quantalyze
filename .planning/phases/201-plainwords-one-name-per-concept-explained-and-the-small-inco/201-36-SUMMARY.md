---
phase: 201-plainwords-one-name-per-concept-explained-and-the-small-inco
plan: 36
subsystem: allocations-ui
tags: [plainwords, dates, formatDay, gap-closure, clar-06, f-11, d-11]
requires: ["201-24"]
provides:
  - "My allocation Exposure captions, holdings read-day notes and the recorded-outcome row print every day through formatDay (SC-3 date gap, My allocation half)"
affects: []
tech-stack:
  added: []
  patterns: ["wrap the helper at the print position only; comparison fields stay ISO"]
key-files:
  modified:
    - src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx
    - src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.test.tsx
    - src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.tsx
    - src/app/(dashboard)/allocations/widgets/allocation/AllocationOverTime.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.key-read-notes.test.tsx
    - src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx
    - src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx
decisions:
  - "staleReadGroups, its returned asof and every comparison stay on the ISO value; formatDay wraps only inside the three note sentences (T-201-51 mitigation)."
  - "key-read-notes fixtures stay ISO and the 17 pinned sentences were re-pinned to the helper's literal form, plus a negative raw-ISO assertion on a position note and the partial-read note."
status: complete
plan_head_before: 95bf90ac7f0a1a7e3dabee322bf42a45678f2d15
plan_head_after: ac557983ca83e3c950fcf8b80a55f4e93671cb41
commits: 2
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
---

# Phase 201 Plan 36: My allocation dates through formatDay Summary

Five print sites in My allocation (two Exposure chart captions, three holdings read-day notes, the recorded-outcome row) now print days through `formatDay`, so one section reads one format (`as of Jan 12, 2026`, `are as last read on Aug 31, 2026`, `on Apr 20, 2026`).

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 (tracer) | Exposure "as of" captions through formatDay | 025baad43 |
| 2 | Holdings notes and recorded-outcome row through formatDay | ac557983c |

## What changed

- `NetExposureChart.tsx`, `AllocationOverTime.tsx`: caption `as of {formatDay(points.at(-1)!.asof)}`. Data, keys and tooltip path untouched.
- `HoldingsTabPanel.tsx`: imports `formatDay`; `openPositionReadDayNotes`, `spotHoldingReadDayNotes`, `partialPositionReadNotes` print the day through it. `staleReadGroups` untouched.
- `OutcomeRecordedRow.tsx`: `allocated_at` through `formatDay` (null prints the helper's em dash).
- Tests re-pinned, with header notes citing F-11, D-11, R3-01 and plan 201-36, and negative `YYYY-MM-DD` assertions: NetExposureChart, AllocationOverTime, HoldingsTabPanel.exposure (computed `isoDay(4)` expects `formatDay(isoDay(4))`), key-read-notes (17 sentences), ScenarioFlaggedHoldingsList (`on Apr 20, 2026`).

## RED proofs (tests written first, seen RED against HEAD)

- Task 1 against `95bf90ac7`: 3 failed arms (NetExposureChart, AllocationOverTime, HoldingsTabPanel.exposure), 36 passed.
- Task 2 against `025baad43`: 13 failed (12 key-read-notes arms, 1 ScenarioFlaggedHoldingsList outcome row).

## Neuter record (byte backup via cp -p, cmp exit 0 after restore, then GREEN)

- gc-201-36-neuter: gate=NetExposureChart.test.tsx site=src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx result=red restored=identical
  RED line: `Unable to find an element with the text: as of Jan 12, 2026` (1 failed, 9 passed).
- gc-201-36-neuter: gate=HoldingsTabPanel.key-read-notes.test.tsx site=src/app/(dashboard)/allocations/HoldingsTabPanel.tsx result=red restored=identical
  RED line: expected `Positions from the Binance key Old are as last read on Aug 31, 2026: BTC-PERP, SOL-PERP.`, received `... on 2026-08-31: ...` (10 failed in the isolated run, 11 with both neuters).
- gc-201-36-neuter: gate=ScenarioFlaggedHoldingsList.test.tsx site=src/app/(dashboard)/allocations/components/OutcomeRecordedRow.tsx result=red restored=identical
  RED line: `expected '✓Recorded: Allocated % on 2026-04-20 …' to contain 'on Apr 20, 2026'` (1 failed, 7 passed).

## Verification

- Plan anchors: `node scripts/verify-plan-anchors.mjs <plan>` exit 0, 8 claims, no stale.
- Task 1 verify: 4 files, 57 tests passed.
- Task 2 verify: vitest 15 files, 198 tests passed (HoldingsTabPanel*, ScenarioFlaggedHoldingsList, widgets/positions, widgets/allocation, copy-census); eslint on the four source files exit 0; `npm run typecheck` exit 0.
- Acceptance greps: `{points.at(-1)!.asof}` 0 in both chart files; `${asof}` 0 and `formatDay(` 3 in HoldingsTabPanel.tsx; `{outcome.allocated_at}` 0 in OutcomeRecordedRow.tsx.
- gc-201-36-gates: vitest=green eslint=clean tsc=clean

## Deviations from Plan

None. The plan executed as written. The plan's note that the `as of Oct 3, 2026` and `as of Mar 1, 2024` arms stay unchanged held.

## reported-not-edited

None. No phase-200 file needed a copy change.

## Known Stubs

None.

## Threat Flags

None. T-201-51 mitigated: the grouping arms of key-read-notes ran unchanged (fixtures ISO) and are green.

## Self-Check: PASSED

Commits 025baad43 and ac557983c are on `wt/201-p36`; all nine modified files are committed.
