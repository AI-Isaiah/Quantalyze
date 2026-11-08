---
phase: 198-mybook-my-allocation-answers-how-is-my-book-doing-in-three-tabs
plan: 02
subsystem: allocations-holdings
tags: [cash-symbols, dust, closed-sets, parity-test]
requires:
  - phase: 194.1
    provides: figure-gate census (precondition)
provides:
  - CASH_SYMBOLS, isCashHolding (src/lib/closed-sets.ts)
  - isDust, DUST_ABS_USD, DUST_BOOK_SHARE, DUST_RULE_CAPTION, dustControlLabel, dustAnnouncement, dustHiddenLine
affects: [198-07, 198-11, 198-13]
tech-stack:
  added: []
  patterns: [TS set mirrored from a Python frozenset literal and pinned by a regex parity test]
key-files:
  created:
    - src/lib/closed-sets.cash-symbols.test.ts
    - src/app/(dashboard)/allocations/lib/dust.ts
    - src/app/(dashboard)/allocations/lib/dust.test.ts
  modified:
    - src/lib/closed-sets.ts
key-decisions:
  - "The cash set is the seven-symbol Python STABLECOINS literal; split-suffix tokens (USDE, PYUSD, USDB) are not cash."
  - "isDust is an OR of two strict magnitude tests ($50, 0.1% of Book equity); unpriced rows, rows on a key needing attention and non-finite values are never dust."
requirements-completed: [ROUTE-08, LEAN-06]
status: complete
duration: about 20 min
completed: 2026-11-08
commits: 2
plan_head_before: 9e32d7881fbeec5e93d70a9b7922bea8d256a7ff
plan_head_after: 891ac76a4cef51478e9769b933deef0020f7aa5e
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
---

# Phase 198 Plan 02: Cash set and dust rule Summary

Holdings now has two pure rules, each in one place: `isCashHolding` over a `CASH_SYMBOLS` set that a parity test pins member for member to the analytics writer's `STABLECOINS` literal, and `isDust`, D-04 read strictly on the row's printed USD magnitude with fixed copy for the dust control.

## Tasks

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | One cash set mirrored from the Python STABLECOINS literal, RED first (ROUTE-08) | 8fea2a063 |
| 2 | The dust rule as one pure function with strict comparisons (D-04, LEAN-06) | 891ac76a4 |

## Gate evidence

- gc-198-02-red: test=closed-sets.cash-symbols cause=missing_export (16 of 16 cases failed before the export existed)
- gc-198-02-neuter: gate=closed-sets.cash-symbols (USDE added to the set) result=red restored=identical (parity, split-suffix and the USDE spot case went RED; cmp exit 0; rerun 16/16 green)
- gc-198-02-neuter: gate=dust.test (`<` changed to `<=` in the $50 test) result=red restored=identical (exactly-$50, short -$50 and exactly-$50-and-0.1% cases went RED; cmp exit 0; rerun 21/21 green)
- gc-198-02-neuter: gate=dust.test (`<` changed to `<=` in the share test) result=red restored=identical (exactly-0.1% and the combined case went RED; cmp exit 0)
- gc-198-02-gates: vitest=green tsc=clean lint=clean-except-known (eslint 0 errors, 2 pre-existing warnings in unrelated files; the one red is check-planning-hygiene rule 6e on ROADMAP.md, the known Phase 196 bullet, not touched here)
- Anchor verifier on this plan: exit 0, 10 claims checked. Existing closed-sets and fixed-mark parity tests: 237 passed with the new file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test inconsistency] The plan's exactly-$50 example contradicted its own OR rule**
- **Found during:** Task 2, first GREEN run
- **Issue:** The behavior list asserts `valueUsd: 50` is not dust with Book equity 1,000,000, but $50 is under 0.1% of that book (1,000), so the OR rule makes it dust. The implementation was right; the example was not.
- **Fix:** The strict $50 case now uses a $10,000 book (0.1% is $10, so only the absolute test can bite). Added a case where $50 is exactly 0.1% of a $50,000 book (not dust), and one where $50 on a $1M book is dust. Both strict comparisons were neutered separately and seen RED.
- **Files modified:** src/app/(dashboard)/allocations/lib/dust.test.ts
- **Commit:** 891ac76a4

Also: a first USDE neuter attempt ran before the export edit had landed (the edit tool refused an unread file), so it measured nothing; it was discarded and redone after the implementation, and only the valid run is recorded above.

## Known Stubs

None.

## Threat Flags

None. No endpoints, auth paths or schema changes.

## Self-Check: PASSED

- FOUND: src/lib/closed-sets.cash-symbols.test.ts, src/app/(dashboard)/allocations/lib/dust.ts, src/app/(dashboard)/allocations/lib/dust.test.ts
- FOUND commits: 8fea2a063, 891ac76a4
- `grep -a -c "export const CASH_SYMBOLS"` = 1, `export function isCashHolding` = 1, `export function isDust` = 1, `<= 50|<= DUST_ABS_USD` in dust.ts = 0, import count in closed-sets.ts = 1 (zod only).
