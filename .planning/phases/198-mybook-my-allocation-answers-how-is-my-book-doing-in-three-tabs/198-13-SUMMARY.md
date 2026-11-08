---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 13
subsystem: holdings-table-labels
tags: [route-08, holdings-table, labels, cash, c1]
requires:
  - phase: 198-02
    provides: isCashHolding (closed-sets, parity-tested against the Python cash set)
provides:
  - an own-capital strategy row with no amount reads "no amount entered", never "not allocated"
  - the spot Type column prints Cash for a cash balance (stablecoin symbol), Spot otherwise
affects: [198-07]
tech-stack:
  added: []
  patterns: [Type cell classifies through the one shared rule isCashHolding, no local symbol list]
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
key-decisions:
  - "The two strategy-rows label pins were rewritten in place (none deleted) and gained a negative assertion; the old two-word label in the negative pins is assembled with join so the test file does not itself carry the retired literal."
requirements-completed: [ROUTE-08]
status: complete
duration: about 20 min
completed: 2026-11-08
commits: 2
plan_head_before: f0f76b5d4cb0cd2a5c272292ede2c881c4765ea9
plan_head_after: 0ce0cf5d40e56cf2f9bf3053b2b9830a915d841e
actuals:
  tokens: 4000
  tasks: 2
  commits: 2
---

# Phase 198 Plan 13: the Holdings table labels Summary

The Strategies table says "no amount entered" for an own-capital row without an amount, and the positions table's Type column reads Cash for a cash balance through the shared `isCashHolding` rule.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | The Strategies no-amount caption (ROUTE-08, C1) | f8e2c2c3f |
| 2 | The Cash Type cell (ROUTE-08) | 0ce0cf5d4 |

## What was built

- `HoldingsTable.tsx`: the strategies amount cell keeps its em dash span and its muted caption now reads `no amount entered`. The spot Type cell prints `Cash` when `isCashHolding(h)`, else the shipped `Spot` or `Derivative`. `isCashHolding` joins the existing `@/lib/closed-sets` import. No `.toFixed`, no tone rule.
- `HoldingsTable.strategy-rows.test.tsx`: both label pins (the row-state case and the panel hand-off case) now expect the new caption, and each gains a negative assertion that the old label appears in no cell.
- `HoldingsTable.test.tsx`: five Type-cell cases (USDT Cash, usdc Cash, BTC Spot, USDE Spot, derivative on a stable symbol Derivative), headed by the ROUTE-08 reason.
- No migration, no API route change.

## Gate evidence

- gc-198-13-neuter: gate=HoldingsTable.strategy-rows.test.tsx (caption restored to the old label) result=red restored=identical (both label pins RED, `cp -p` restore, `cmp` exit 0, 27/27 GREEN)
- gc-198-13-neuter: gate=HoldingsTable.test.tsx (cash check dropped from the Type cell) result=red restored=identical (USDT and usdc cases RED, `cmp` exit 0, 45/45 GREEN)
- gc-198-13-gates: vitest=green census=green tsc=clean lint=clean-except-known (see Notes)

Results: `HoldingsTable.test.tsx`, `HoldingsTable.strategy-rows.test.tsx`, `closed-sets.cash-symbols.test.ts`, `display-sign-single-source.test.ts` and `figure-gate-census.test.ts`: 5 files, 124 tests, all green. `node scripts/verify-plan-anchors.mjs` OK (11 claims). `npx tsc --noEmit` clean. Acceptance greps: the old label in `HoldingsTable.tsx` 0 (1 at HEAD), `no amount entered` 1, `isCashHolding(` 1.

## Deviations from Plan

None - plan executed exactly as written.

## Notes

- `npm run lint`: ESLint 0 errors (2 pre-existing unused-var warnings in untouched files). The planning-hygiene rule 6e red on ROADMAP.md (the Phase 196 bullet) is the known one and was not touched.
- The Strategies label pins live only in `HoldingsTable.strategy-rows.test.tsx`; no other file matched the old caption.

## Known Stubs

None.

## Self-Check: PASSED

- f8e2c2c3f and 0ce0cf5d4 are ancestors of HEAD; the three modified files exist; `commits:` measured from `f0f76b5d4..HEAD` = 2.
