---
phase: 190-factsheetqueued
plan: 07
subsystem: lists-compare
tags: [stale-analytics, recompute, stored-result, snapshot, d-02, d-04, d-05, compare, strategy-table, v2-joint]

requires:
  - phase: 190-03
    provides: hasStoredAnalyticsResult, effectiveDataQualityFlags, usesLastSuccessSnapshot, hasUnboundDerivePrestamp, isRecomputeOverStoredResult
  - phase: 190-09
    provides: the computed_at-bound data_quality_flags.last_success_snapshot the new aliases read
provides:
  - shapeRowAnalytics admits a pending or computing row over a stored success result, flagged analytics_updating
  - four scalar aliases in CATEGORY_RANKING_ANALYTICS_COLUMNS (marker + last-success snapshot)
  - StrategyAnalytics.analytics_updating?: true and three last_success_* alias fields
  - StrategyTable.isDisplayedRow, one decision for #n, sort, cell gates, sync claim and chip
  - readV2BenchmarkJoint on the factsheet's rule, D-04 withhold included
  - /compare reads every row from one flags generation, dated by the effective headline_since, no service-role read
affects: [190-08]

tech-stack:
  added: []
  patterns:
    - "list admission is decided once, in the server-side shaper, and the client reads a flag instead of re-deriving the evidence"
    - "alias inputs of a generation choice are consumed in the page/shaper and dropped before any client component"

key-files:
  modified:
    - src/lib/types.ts
    - src/lib/queries.ts
    - src/lib/queries.test.ts
    - src/lib/queries.stale-analytics-detail.test.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyTable.stale-analytics.test.tsx
    - src/lib/factsheet/v2-joint.ts
    - src/lib/factsheet/v2-joint.test.ts
    - src/app/(dashboard)/compare/page.tsx
    - src/app/(dashboard)/compare/page.test.tsx
    - src/app/(dashboard)/compare/page.strategy-only-charts.regression-1.test.tsx
    - src/components/strategy/CompareEquityOverlay.tsx

key-decisions:
  - "A re-running list row keeps its figures and #n but stays out of every percentile cohort (OQ-2 default); getPercentiles and getOwnRowPercentiles are untouched."
  - "The unit a list row shows follows the same flags generation as its figures, on the recompute arm and on the terminal arm."
  - "/compare dates a chain-broken row by its effective headline_since; the stored cash series row is no longer read."

requirements-completed: [SC-3, SC-4, SC-6]

actuals:
  tokens: 22000
  tasks: 3
  commits: 3
plan_head_before: 5e86c55dba334f520303a49bf9df76ea76bb0e17
plan_head_after: dd1e4a1a1c2dbee1d3e47c30c258ee262f7f8788

duration: ~75min
completed: 2026-11-03
status: complete
---

# Phase 190 Plan 07: Lists, joint and /compare follow the stored-result rule Summary

**A strategy re-computing over a stored success now keeps its last computed figures, sparklines and `#n` on the discovery and owner lists (no new marker, out of every percentile cohort), the strategy page's benchmark joint admits and withholds by the factsheet's rule (D-04 included), and /compare draws each row's curve, flag and covered-from date from one flags generation with no service-role read.**

## What changed

- **Task 1, `shapeRowAnalytics`.** After the terminal-success arm, a new arm admits `isRecomputeOverStoredResult(status, hasStoredAnalyticsResult(a))` and returns the terminal shape plus `analytics_updating: true`. A shared helper `shapedNativeUnit` takes the unit from the same flags generation as the figures: when `usesLastSuccessSnapshot(a)` it reads `last_success_native_unit` (alias row) or the effective snapshot flags (blob row), otherwise exactly what the terminal arm always read. This changes only a row whose live marker alias is gone and whose snapshot is bound, which is a row the status bridge holds at a terminal-success status through the derive hop. Every shaped object drops the three `last_success_*` keys. `CATEGORY_RANKING_ANALYTICS_COLUMNS` gained `cumulative_method`, `last_success_cumulative_method`, `last_success_computed_at`, `last_success_native_unit` (each once, scalars over a column the anon projection already reads). The computing-arm comment is rewritten: reason 1 retired, reason 2 a deliberate split, reason 3 context. `getPercentiles` and `getOwnRowPercentiles` are untouched.
- **Task 2, table and joint.** `isDisplayedRow(s)` (terminal success, or `analytics.analytics_updating === true`) now backs `isRankedRow` and `hasComputedAnalytics`, so figures, `#n`, sort position, sync claim and the owner Syncing and No data chip follow one decision. The STALE-01 comment says the shown-figures and `#n` lockstep stays and the percentile cohort is the one deliberate exception. `readV2BenchmarkJoint` selects `cumulative_return, computed_at` too, admits by the factsheet's two predicates, reads `effectiveDataQualityFlags(analytics).flags`, and withholds `not_computed` for a terminal-success row with `hasUnboundDerivePrestamp`.
- **Task 3, /compare.** `COMPARE_ANALYTICS_COLUMNS` gained `computed_at` and five aliases (`headline_since`, `last_success_computed_at`, `last_success_cumulative_method`, `last_success_twr_chain_broken`, `last_success_headline_since`). The page decides the generation once per row with `usesLastSuccessSnapshot(row)`; on the snapshot generation the row's `twr_chain_broken`, `cumulative_method` and covered-from date come from the last-success aliases, otherwise from the live aliases as fetched. The covered-from date is `readHeadlineBasis({twr_chain_broken: true, headline_since: effective})`, so the factsheet's validator decides. `headline_since` and the four `last_success_*` aliases are deleted from the analytics object before any item is built. The service-role import, the series reader, the try/catch and the `read_failed` arm are removed. `CompareEquityOverlay.tsx` changed in comments only.

## D-04 and D-05 reach (for plan 08)

- D-04 reaches the strategy page's joint (this plan) and, through plan 03's resolve stage, the composite joint and the discovery detail page. The lists and /compare do not apply it: they read scalar aliases only, a scalar alias cannot see the null-valued `last_success_snapshot` key, and keying on the missing marker alone would blank every legacy row at rest. A terminal-success row in that state keeps its stored figures on the lists and /compare beside its live aliases. The shaper's recompute arm cannot meet the state (a pending or computing row in it fails check (c)).
- In the D-04 state the strategy page shows its stored panels beside a not-computed joint (`getStrategyDetailV2` keeps its own terminal-status gate and live data-quality chips).

## Detail reads (for plan 08's VERIFICATION hand-off)

All three share `PUBLIC_ANALYTICS_COLUMNS` (`cumulative_return … computation_status, computed_at, trades_fetched_at`), which carries `computed_at` and `cumulative_return` but no series (`daily_returns`, `returns_series`, `series_end`) and no flags or marker alias. The plan said not to widen any detail select, so:

| read | verdict |
|------|---------|
| `getPublicStrategyDetail` | still withholds during a re-run (projection lacks a series and the flags or marker alias) |
| `getFactsheetDetail` (tearsheet) | still withholds during a re-run (same projection plus `monthly_returns`, `metrics_json`; no series, no marker) |
| `getStrategyDetail` (`/discovery/[slug]/[id]`) | still withholds during a re-run (`STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS = PUBLIC_ANALYTICS_COLUMNS`); the page's factsheet builds through plan 03's resolve stage, which admits |

Fail closed by design. `/strategies` keeps its probe skip on `isComputedAnalytics` (progress, RESEARCH keep list); only its row shaping (`shapeRowAnalytics` over the ranking columns) changed. Plan 01's coverage reading: the stored-result evidence holds on 27 of 27 terminal-success PROD rows (3 published), so the lists admit essentially every strategy that has ever computed.

## /compare terminal-row outcomes that change

Both move toward the factsheet's own verdict for the same row (the planner default, still flippable by the founder in plan 08's hand-off):

1. A chain-broken row with no valid `headline_since` (a legacy mixed-basis row, which the factsheet Withholds) now draws no curve, with the existing "cannot be dated" note.
2. A chain-broken row whose stored series row echoes another densify convention, but whose flags carry `headline_since`, now draws its dated curve.

For a row computed since Phase 164.6.6.3.3 on a broker series, both sources name the first day of `nav_twr`'s last-interior-break suffix, so the date is unchanged.

## Deleted test cases (page.test.tsx, "covered-from read for chain-broken rows")

The page no longer has a read that can produce these outcomes:

- `a missing or undatable series is "undatable" with no date`: it pinned the series-row reader returning null; the undatable outcome is now driven by `headline_since` (the four it.each cases).
- `a payload that echoes another densify convention is "undatable"`: a series-row convention is no longer consulted (outcome 2 above).
- `a failed read is "read_failed", logs the message only, and the page still renders`: there is no read left to fail.

Rewritten rather than deleted: `a row whose alias is "true" is read once ...` (now asserts the live `headline_since` date and that `adminReadIds` stays empty, with the series mock answering a different date), `reads only the chain-broken row of a mixed pair`, the `it.each` non-"true" alias cases, and `never hands the overlay the series payload` (now the no-alias-input and exact-keys case). The regression-1 file lost its admin-client mock and gained the alias-input assertion over overlay, matrix and table.

## Can-fail proofs (byte backups in the scratchpad, restored with `cp`, `cmp` silent each time; no git checkout, restore or stash)

| proof | mutation | RED lines | cmp |
|-------|----------|-----------|-----|
| shaper arm | the recompute arm's condition replaced by `false` | 8 failed: `D1`, `D2`, `D3`, `D8`, `D10` in `queries.stale-analytics-detail.test.ts`; "prints the re-running row's last computed figures and gives it a contiguous #n", "a computing row WITHOUT a stored result ... ranked last in both directions", "a re-running row shows its figures and #n and no Syncing chip ..." in the table file | silent |
| joint D-04 | `isComputedAnalytics(status) && hasUnboundDerivePrestamp(...)` replaced by `false && ...` | `D04-1`, `D04-2` failed (2 failed, 33 passed); `D04-3` and the two at-rest controls stay green | silent |
| compare generation | `usesLastSuccessSnapshot(row) && false` | "post-derive, old success chain-broken and new derive clean", "post-derive, old success clean and new derive chain-broken", "the correlation matrix receives the same effective cumulative_method" failed (3 failed, 38 passed) | silent |

After each restore the file was rerun green.

## Series-row reader audit (`grep -rn 'from("strategy_analytics_series")' src`, test files excluded)

All four hits are in `src/lib/factsheet/composite-read-path.ts`:

- `readMtmSeries` (:113) and `readSmoothedSeries` (:159): paired with the live derive by plan 05.
- `readHeadlineCoversFrom` (:679): handled by this plan. It now has no production caller (no non-test file outside its own module references it) and its JSDoc still names /compare. It is left exported for plan 05, which owns the file, and booked for plan 08's cleanup hand-off.
- `readCashConventions` (:1032, caller `fetch-and-build-payload.ts:620`): the cash conventions echo, a known limit for plan 08.

## Deviations from Plan

**1. [Rule 3 - Blocking] The projection pins in `queries.test.ts` had to be amended in Task 1.**
- **Found during:** Task 1. The existing pin allowed exactly one `->>native_unit` form of `data_quality_flags` and would have failed on the four new aliases by construction.
- **Fix:** replaced it with an exact-set pin (the five allowed alias expressions are stripped and nothing may remain), and added a positive pin that each of the four new aliases appears exactly once. The bare column, the snapshot object, its `flags` object and any other key still fail.
- **Commit:** `da6be5145`.

**2. [Rule 2 - Missing coverage] Added two tests the plan did not list:** a `getPercentiles` test (five computed peers plus a re-running row: the row gets no entry, so it carries no suffix, the OQ-2 claim) and a Group E table seam, owner-mount and direct-mount set. No production change beyond the plan.

Otherwise the plan was executed as written. Pins updated in the same commit as their change: the v2-joint select-string pin (`v2-joint.test.ts`, now names `cumulative_return, computed_at`); no other parity test pinned it.

## Verification

- Task 1 verify (5 files): 216 tests passed. Task 2 verify (6 files): 101 passed. Task 3 verify (6 files): 85 passed. Counts at the final runs of each.
- Wide run (`src/lib`, `src/components/strategy`, compare, strategies, discovery, browse, my-strategies, `src/__tests__`): 591 files passed, 18 skipped, 1 failed; 14187 tests passed, 299 skipped, 2 failed. The two failures are the known pre-existing `compute.conventions.test.ts` fixtures B and C, identical on the base.
- `npm run typecheck`: clean. `npm run lint`: 0 errors; 2 warnings, both pre-existing in files this plan did not touch (`MetricsColumn.tsx` `nativeUnitReason`, `composite-read-path.ts` `isRankableAnalyticsRow`).
- Acceptance greps: `analytics_updating: true` in queries.ts 1, `analytics_updating?: true` in types.ts 1, `analytics_updating === true` in StrategyTable 1, `isRecomputeOverStoredResult` in v2-joint 3, `hasUnboundDerivePrestamp(` in v2-joint 1, compare page comment-stripped count of `readHeadlineCoversFrom|createAdminClient` 0, `usesLastSuccessSnapshot(` 1, `readHeadlineBasis(` 1, each of the five compare aliases 1, overlay diff is comment-only, `git diff --stat -- src/lib/factsheet/composite-read-path.ts` prints nothing.
- Known pre-existing local failure, not touched: `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C (last float digit of `skew` under local Node 25).

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None beyond the plan's register. T-190-14 and T-190-22 add only scalar aliases over a column those projections already read; T-190-23 and T-190-24 are pinned by the post-derive, D-04 and generation tests above; the compare page no longer crosses the deny-all series table at all.

## Commits

- `da6be5145` feat(190-07): shapeRowAnalytics admits a re-run over a stored success result; the ranked projection carries the marker
- `3ff2c205b` feat(190-07): StrategyTable and the benchmark joint follow the stored-result rule
- `dd1e4a1a1` feat(190-07): /compare draws every row from one flags generation and dates a chain-broken row by its headline_since

## Self-Check: PASSED

Modified files exist, all three commits are ancestors of HEAD on `feat/190-p07`, and the final verify runs were green.
