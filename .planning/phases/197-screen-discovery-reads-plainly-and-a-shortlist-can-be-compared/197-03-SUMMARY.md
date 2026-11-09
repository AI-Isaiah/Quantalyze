---
phase: 197-screen-discovery-reads-plainly-and-a-shortlist-can-be-compared
plan: 03
subsystem: ui
tags: [discovery, strategy-table, stale-data, clar-02, series-end, freshness]
requires:
  - phase: 197-01
    provides: "DISCOVERY_COLUMNS, Track column, byte-pin fixture at its post-plan-01 state"
provides:
  - "listSeriesVerdict + SERIES_STALE_DAYS_TRADITIONAL: the one data-age verdict, read from series_end"
  - "StaleSeriesChip.tsx: DATA_STATE_CHIP (moved), StaleSeriesChip, notRankedReason"
  - "StrategyTable stale partition, #n over current rows only, optional nowMs prop"
  - "discovery page prop harness (page.test.tsx) extended by plans 05 and 06"
affects: [197-04, 197-05, 197-06]
tech-stack:
  added: []
  patterns: ["One verdict memo per mount shared by sort, ordinals, percentile suffix, chip and the grid (passed as a map)"]
key-files:
  created:
    - src/components/strategy/StaleSeriesChip.tsx
    - src/components/strategy/StrategyTable.stale-series.test.tsx
    - "src/app/(dashboard)/discovery/[slug]/page.test.tsx"
  modified:
    - src/lib/freshness.ts
    - src/lib/freshness.test.ts
    - src/components/strategy/StrategyTable.tsx
    - src/components/strategy/StrategyGrid.tsx
    - "src/app/(dashboard)/discovery/[slug]/page.tsx"
    - src/components/strategy/StrategyTable.stale-analytics.test.tsx
    - src/components/strategy/StrategyTable.test.tsx
    - src/components/strategy/StrategyTable.visibility.test.tsx
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-default-mounts.json
key-decisions:
  - "The verdict map holds displayed rows only, so the grid reads it as 'which cards carry a chip' without restating isDisplayedRow"
  - "Fixtures get a current series_end relative to the real clock (yesterday), the idiom those files already use for computed_at, rather than a new frozen clock per file"
  - "nowMs is optional; /browse/[slug] is not edited and runs on the table's once-per-mount instant (T-197-18 accepted)"
requirements-completed: [CLAR-02]
duration: ~50m
completed: 2026-11-08
status: complete
actuals:
  tokens: 32000
  tasks: 3
  commits: 4
commits: 4
plan_head_before: 13dc6bb06d0c4cb125c194c7d37e142554d9cb80
plan_head_after: 9bfedbd934229a081266e2df90c8a05e35872788
---

# Phase 197 Plan 03: Stale strategies are flagged and never rank as current Summary

A discovery row whose newest stored return day (`series_end`, the last `returns_series` date) is more than 7 whole UTC days old (crypto) or 10 (everything else) now sorts after every current row under any sort, loses its `#n` and `Pnn`, and shows an amber "Data from {date}" chip; a row whose newest day cannot be read is treated the same way and says "Data date unknown".

## What was built

- **Task 1 (tracer):** `listSeriesVerdict` in `freshness.ts` (whole-UTC-day arithmetic as `bucketSeriesAge`, any future date current, `computed_at` and `trades_fetched_at` never read); `StaleSeriesChip.tsx` (`DATA_STATE_CHIP` moved out of the table with its comment, the chip, `notRankedReason`); in `StrategyTable.tsx` one `seriesVerdicts` memo (published-only mounts, null otherwise), one `isCurrentRow` predicate, a second direction-independent partition after the STALE-01 one, `rankOrdinals` over ranked AND current rows, the chip after the strategy-type badges.
- **Task 2:** optional `nowMs` prop (`useState(() => nowMs ?? Date.now())`); `pctSuffix` returns null for a row with no ordinal; rank-cell `title` plus sr-only reason; `StrategyGrid` takes the verdict map and renders the same chip; the discovery page passes `nowMs={Date.now()}`; the page-prop harness test.
- **Task 3:** fixture freshness in three existing test files; the byte pin moved on the discovery and browse strings only.

## TDD evidence

**RED at the pre-change source** (`StrategyTable.stale-series.test.tsx` run before any source edit; 5 of the 6 initial cases failed, the sixth is the "figures kept" control):

```
FAIL ... renders the stale row below every current row, without #1, under Sharpe descending
AssertionError: expected [ 'Dormant Quartz', …(2) ] to deeply equal [ 'Meridian Current', …(2) ]
- Expected  + Received
+   "Dormant Quartz",   (the stale best-Sharpe row, rendered FIRST)
    "Meridian Current",
    "Bastion Current",
-   "Dormant Quartz",
FAIL ... keeps the stale row below every current row under Sharpe ascending
AssertionError: expected '#3' not to contain '#'
FAIL ... shows the amber 'Data from {series_end}' chip ...
Unable to find an element with the text: Data from 2026-10-09.
FAIL ... sorts a null-series_end row after the current rows ...
AssertionError: expected [ 'Unreadable Vesper', …(2) ] to deeply equal [ 'Meridian Current', …(2) ]
```

GREEN after Task 1: 6 of 6. The fixture row carries `computed_at` and `trades_fetched_at` equal to the frozen now and the best Sharpe, cagr and return, so only `series_end` can place it.

**Neuter proof (SC-3 gate can fail).** Byte backup of `src/lib/freshness.ts` to the session scratchpad, then `listSeriesVerdict` edited to always return `current`. 20 of 28 stale-series tests went RED, including the browse-prop-set cases:

```
x renders the stale row below every current row, without #1, under Sharpe descending
x keeps the stale row below every current row under Sharpe ascending (direction-independent)
x shows the amber 'Data from {series_end}' chip on the stale row and on no current row
x does not let a fresh computed_at or trades_fetched_at rescue the stale row
x sorts a null-series_end row after the current rows, with 'Data date unknown' and no ordinal   (and 15 more)
x orders a 30-day-old best-Sharpe row after every current row under Sharpe descending and ascending   [/browse prop set]
x gives it no ordinal and no percentile, the chip, and leaves the current rows #1 and #2              [/browse prop set]
x a row current at the system clock but stale at the passed nowMs renders stale
```

Restored with `cp` from the backup; `cmp` reported identical; the three files re-ran green (44 tests).

## Verification

- TABLE SUITE plus the cross-surface guards, `freshness.test.ts` and the discovery page test, exactly as listed in Task 3's verify: **89 files, 1592 tests, all pass**.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors (2 pre-existing warnings in files this plan does not touch).
- Acceptance greps: `SERIES_STALE_DAYS_TRADITIONAL` one line assigning 10; `export function listSeriesVerdict` 1; one `listSeriesVerdict(` call in `StrategyTable.tsx`, reading `s.analytics.series_end`; `const DATA_STATE_CHIP` in the table 0, `export const DATA_STATE_CHIP` in the chip module 1; `nowMs={Date.now()}` in the discovery page 1; `nowMs ?? Date.now()` in the table 1; threshold-literal grep over the chip module's code lines 0; `Phase 197 plan 03` in the default-mounts test 1; `writeFileSync|toMatchSnapshot` there 0.
- `git diff --name-only 13dc6bb06 -- "src/app/browse/[slug]/page.tsx"` prints nothing: the browse page is untouched.

## Byte-pin fixture (audited hunks)

Rendered the three mounts into the session scratchpad (a temporary copy of the test writing HTML there, deleted before any commit), diffed per mount at tag granularity, classified every hunk. Discovery 9 hunks (rank cells 3, "Data date unknown" chips 3, removed `Pnn` 3); browse 6 (rank cells 3, chips 3); **myStrategiesOwner 0**. `JSON.parse(git show BASE:fixture).myStrategiesOwner === working copy's` printed `true` (28893 characters). Only the `discovery` and `browse` lines of the JSON moved; the dated docblock paragraph records the counts.

## e2e census

`grep -rn -a -E "#1|#2|tbody tr.*(first|nth)|Data date" e2e/discovery*.spec.ts e2e/full-flow.spec.ts e2e/axe-app-wide.spec.ts`: every hit is a hex colour, a PR number in a comment, or `table tbody tr a ... .first()` in `full-flow.spec.ts` (lines 125, 230), which takes the first link without reading rank text. The seeding helper anchors its series at `Date.now()` (age 0), so seeded rows read current and no row order changes. No e2e file edited; nothing recorded for plan 05 beyond that `e2e/layout-narrow.spec.ts` was not touched. The seeded e2e lane was not executed.

## Deviations from Plan

**1. [Rule 3 - Blocking] `react-hooks/purity` rejects `Date.now()` in the discovery page's JSX.**
- **Found during:** Task 2 lint. `npm run lint` errored: "Cannot call impure function during render" on `nowMs={Date.now()}`.
- **Fix:** an `eslint-disable-next-line react-hooks/purity` line with its reason (an async server page runs once per request, not per re-render, and the instant is serialised once) directly above the prop. The plan said "touch nothing else in it"; the prop line and the disable comment are the only change. The acceptance grep (`nowMs={Date.now()}` count 1) holds.
- **Files modified:** `src/app/(dashboard)/discovery/[slug]/page.tsx`. **Commit:** `4798498f2`.

**2. [Plan wording] Fixtures use yesterday on the real clock, not a new frozen clock.**
- Task 3 allowed fake timers "where the file has no clock yet". The three affected files (`stale-analytics`, `StrategyTable.test`, `visibility`) already stamp `computed_at` and `trades_fetched_at` from the real clock or fixed dates, and a `series_end` of yesterday is 6 days inside the threshold, so adding a frozen clock to files with 90+ tests each would have been churn with no extra determinism. A test that needs a stale or undated row passes `series_end` explicitly.

**3. Files in Task 3's list that needed no edit.** `trade-venue`, `examples-first-paint` and `headers` tests stayed green unchanged. Only four test files went red (stale-analytics 8, StrategyTable.test 3, visibility 1, default-mounts 2), all handled.

**4. Design point beyond the plan.** The `seriesVerdicts` map holds displayed rows only, so the grid reads "has a verdict" as "show a chip" without a second copy of `isDisplayedRow` (the STALE-01 hoisting rule). The comparator only asks about rows that are both ranked, so an undisplayed row's absence never matters.

## Known limits, recorded not fixed

- **Percentile cohorts still include stale peers** (`getPercentiles` unchanged; RESEARCH Pitfall 9, booked for plan 06). A current row's `Pnn` is still computed against a cohort that contains stale rows.
- **`/browse/[slug]` runs on the table's own once-per-mount instant** (T-197-18, accepted): a UTC midnight between server render and hydration, with a row exactly at its 7 or 10 day line, would change that row's chip and position and React would re-render it. Remedy once Phase 196 lands: `nowMs={Date.now()}` on that mount (and the same purity disable).
- **`SyncBadge` is unchanged** (UI-SPEC A-4): a stale crypto row can show its own red series dot beside the amber chip.
- **Example rows** are judged by the same verdict as any displayed row; a stale demo seed would sort after current rows and carry the chip. No such seed was measured.
- The 375px / 1280px visual check of the chip (wrapping in the Strategy cell second line, card badge row) was NOT run; it needs a browser.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; the server instant is a number derived from the server clock.

## Self-Check: PASSED

Created files exist (`StaleSeriesChip.tsx`, `StrategyTable.stale-series.test.tsx`, the discovery `page.test.tsx`, this SUMMARY); commits `18d7f0a0b`, `d6526628e`, `4798498f2`, `9bfedbd93` are ancestors of HEAD; browse page diff empty; owner string equal.
