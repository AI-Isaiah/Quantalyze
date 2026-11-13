---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 07
subsystem: allocations-exposure
tags: [route-08, lean-06, exposure, cash, formatUsd]
requires: ["198-02"]
provides:
  - "ExposureSnapshot.cashUsd (null when no cash row was read)"
  - "cash-free exposure snapshot and net exposure series"
  - "five-cell Exposure strip with a Cash cell, no position drilldown"
affects: ["198-13"]
tech-stack:
  added: []
  patterns: ["one cash rule (isCashHolding) feeds the snapshot and the net series"]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/lib/exposure-snapshot.ts
    - src/app/(dashboard)/allocations/lib/exposure-snapshot.test.ts
    - src/lib/portfolio-exposure.ts
    - src/lib/portfolio-exposure.test.ts
    - src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx
    - src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx
    - src/app/(dashboard)/allocations/HoldingsTabPanel.exposure-agreement.test.tsx
decisions:
  - "Net exposure series excludes cash; Allocation over time keeps cash in venue weights (it shows where capital sits)."
  - "Exposure card prints every money value with formatUsd, so one figure never has two formats on the card."
metrics:
  tasks: 2
  files: 9
status: complete
actuals:
  tokens: 28000
  tasks: 2
  commits: 2
plan_head_before: 48a5c6d0721b39bbdc3b7e6df3b09af181f897b7
plan_head_after: 59f7af0a55cdd94c97e7a57c17c06c26cf8e4400
---

# Phase 198 Plan 07: Cash leaves the exposure figures Summary

Cash rows (`isCashHolding`) no longer count in Gross, Net, Long, Short, the Spot share or the net exposure series; a fifth `Cash` cell prints their total (`$0` only when cash rows summed to zero, an em dash when none was read), and the Exposure card stops re-listing positions.

## What changed

- `exposureSnapshotFromHoldings` splits cash rows into `cashUsd` (null when none read). A book of only cash is a snapshot with no slices, and the read-day stamp still sees the cash rows.
- `ExposureSnapshot` gained `cashUsd: number | null`.
- `getNetExposureSeries` skips cash in net and gross but keeps the row in the day set, so a cash-only day stays as a zero point and is not a gap.
- `getAllocationSeries` is unchanged except its docblock: cash stays in venue weights.
- `ExposureByClass`: five cells (`sm:grid-cols-5` wraps in a narrow container), every value through `formatUsd`, the drilldown table, `ResponsiveTable` use and the `keyLabels` prop removed. `HoldingsTabPanel` drops that one prop at the call site.
- Tests: new cash cases in the snapshot, series, card, panel and agreement tests. The agreement file lost `exposureTokens` and every `s.exposure` assertion; it now pins `gross + cash` to the Holdings total plus the Open Positions notional in every book, including a new spot USDT book.

## Neuter record

gc-198-07-neuter: gate=exposure-snapshot.test.ts (mixed-book, zero-cash and cash-only cases) result=red restored=identical
gc-198-07-neuter: gate=portfolio-exposure.test.ts (BTC-plus-USDT day and cash-only day cases) result=red restored=identical
gc-198-07-neuter: gate=ExposureByClass.test.tsx and HoldingsTabPanel.exposure-agreement.test.tsx (null-reads-dash case, Cash cell printing formatUsd(cashUsd ?? 0)) result=red restored=identical

Each neuter was made on a byte copy in the scratchpad and restored with `cp -p`; `cmp` exited 0 each time and the files were GREEN after.

## Gates

gc-198-07-gates: vitest=green census=green tsc=clean lint=clean

- vitest: `src/app/(dashboard)/allocations`, `portfolio-exposure.test.ts`, `closed-sets.cash-symbols.test.ts`, `contracts-registry.test.ts`, `figure-gate-census.test.ts` and `display-sign-single-source.test.ts`: all green (177 files, 3144 tests, plus the census file run separately).
- `npx tsc --noEmit`: clean.
- `npm run lint`: no errors in touched files. The only failure is the known, not-mine `check-planning-hygiene` rule 6e on ROADMAP.md (a "Phase 196" bullet), plus two pre-existing unused-var warnings in unrelated files. "lint=clean" therefore means clean for this plan's files.
- `node scripts/verify-plan-anchors.mjs` on this plan: OK, 17 claims checked.
- Acceptance greps: `drilldown` testid 0, `kpi-cash` 1, `formatCurrency` 0, `keyLabels` 0 in `ExposureByClass.tsx`; `exposureTokens` 0 in the agreement test; the `.toFixed` count in `ExposureByClass.tsx` is the same three share-percent calls (aria-label x2, legend x1).

## Deviations from Plan

- [Process] The Task 2 component edit was written before its test rewrites (the plan says tests first). RED was then shown by the neuter above instead of by a pre-implementation failing run. The Task 1 tests were written first and seen RED (7 failing) as planned.
- [Test shape] `HoldingsTabPanel.exposure.test.tsx`: the key-label drilldown case was replaced by a two-keys-sum case that asserts the card holds no table, plus a spot USDT case, rather than a bare "no table" case. Coverage for the 65,000 gross is kept.
- A stray `src/app/(dashboard)/allocations/node_modules/.vite` created by running vitest from that directory was deleted before the commit; it was never staged.

## Known Stubs

None.

## Threat Flags

None. T-198-13 is mitigated: one `isCashHolding` rule feeds the snapshot and the series, `cashUsd` is null with no cash row, and the agreement test pins `gross + cash` to the tables' totals.

## Self-Check: PASSED

- Commits `78cfe9d84` (Task 1) and `59f7af0a5` (Task 2) exist on `feat/198-mybook`.
- All nine modified source and test files are in those commits; the worktree was clean before this SUMMARY.
