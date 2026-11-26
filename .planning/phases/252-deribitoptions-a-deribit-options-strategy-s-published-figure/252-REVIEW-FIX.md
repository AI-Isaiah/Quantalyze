---
phase: 252-deribitoptions
fixed_at: 2026-11-25T22:50:00Z
review_path: .planning/phases/252-deribitoptions-a-deribit-options-strategy-s-published-figure/252-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 252: Code Review Fix Report

**Fixed at:** 2026-11-25
**Source review:** 252-REVIEW.md (WR-01, WR-02) plus the silent-failure review's SFH-HIGH-1
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (WR-01, WR-02, SFH-HIGH-1; IN-* are never fixed)
- Fixed: 3
- Skipped: 0

Verification ran in the phase worktree `quantalyze-wt-252` on branch `gsd/phase-252-deribitoptions`
(no extra fixer worktree: the caller pointed the run at that checkout), not in the main checkout.

## Fixed Issues

### SFH-HIGH-1: own-capital Holdings could never bind a `last_success_snapshot`

**Files modified:** `src/lib/queries.ts`, `src/lib/queries.options-withhold.test.ts`
**Commit:** f2e540856
**Applied fix:** `getOwnCapitalStrategies` now selects `computed_at`, and strips it (`computed_at: _ca`)
with the other dropped columns before `analyticsRest`, so the payload shape is unchanged for the MT5
parity surfaces. The reason therefore resolves on the effective flags generation, as in
`getMyAllocationDashboard`. The plan-04 test and comment that pinned "a snapshot alone does not mark the
row" now pin the new behaviour: live flags without the reason plus a snapshot bound to `computed_at`
marks the row, and a snapshot bound to another success does not.
**PROOF-01:** the mock ignores the select string, so the test also asserts the projection names
`computed_at`. Neuter 1 (drop `computed_at` from the select) went RED on that assertion. Neuter 2
(stop stripping it) went RED on the "never ride the payload" test (new `computed_at` absent check).
Restored by `cp` from a byte backup plus `cmp`, then GREEN (450 tests across the four queries files).
**Status:** fixed: requires human verification (generation-selection logic).

### WR-01: Holdings showed a flagged strategy's cash-wallet MTD and Max DD

**Files modified:** `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts`,
`src/app/(dashboard)/allocations/components/HoldingsTable.tsx`,
`src/app/(dashboard)/allocations/lib/strategies-row-adapter.test.ts`,
`src/app/(dashboard)/allocations/components/HoldingsTable.figure-gate.test.tsx`
**Commits:** c0a3da3ed, plus a follow-up that typechecks the adapter test's `daily_returns` fixture
(`as never`, the idiom the file already uses); the first commit passed vitest but not `tsc`.
**Applied fix:** on both halves `mtd` and `maxDd` are null when `figure_withheld_by` is the options
cash-wallet cause. `HoldingsTable` renders those two cells through a small `strategyCashFigureCell`
(dash, `withheldCellTitle(row.sharpeRecord)` as title and sr-only text, the way the Sharpe cell does).
Tests: adapter (both halves, unmarked row keeps both figures) and a rendered HoldingsTable test.
**PROOF-01:** neutering the three adapter sites went RED on the adapter test, neutering the cell's
`withheldBy` branch went RED on the table test. Restored by `cp` plus `cmp`, GREEN.
**Status:** fixed: requires human verification (a first attempt at the neuter by `sed` broke the file
and failed everything, so it was discarded; the verified neuter was a targeted edit).

### WR-02: rolling charts' "avg" label printed a cash-wallet figure inside a zoom

**Files modified:** `src/app/factsheet/[id]/v2/FactsheetView.tsx`,
`src/app/factsheet/[id]/v2/FactsheetView.withheld-renderings.test.tsx`
**Commit:** 2354497db
**Applied fix:** `railAvgWithheld = fullHistoryWithheld && (!zoomed || isRangeWithheld(payload.dataQuality, basisForNote))`,
the same term and arguments as the rail's `wholeRecordWithheld`. Test: inside a zoom an options-book
payload has no `avg ` label in the Rolling Volatility chart, and a chain-broken Withheld payload keeps
it (D-78).
**Side effect to know:** the same flag drives `lastPointWithheld`, so inside a zoom the options-book
crosshair's last point now dashes too, consistent with the rail.
**PROOF-01:** the test was RED before the fix, passed after, went RED again with the new term neutered,
then GREEN after `cp` restore plus `cmp`.
**Status:** fixed: requires human verification (gate condition).

## Verification

- `npm run typecheck`: clean after the follow-up commit.
- `npm run lint`: 0 errors; 4 pre-existing warnings in files this run did not touch.
- 195 test files, 3700 tests pass (queries files, all of `allocations/`, the factsheet withheld-renderings
  and window-kpis files, both census files), with `--testTimeout=60000`.
- Known local-only failures (`compute.conventions.test.ts` fixtures B/C, `RiskTabPanel.book-series.test.tsx`)
  were not touched.

---

_Fixed: 2026-11-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
