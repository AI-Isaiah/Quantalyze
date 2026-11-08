---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 21
subsystem: factsheet-comparator-block
tags: [trust-05, d-11, d-14, d-15, joint-metrics, comparator, rolling-window]

requires:
  - phase: 194-04
    provides: payload.figureRecord (full-history record)
  - phase: 194-14
    provides: deriveSeriesBundle's required figureRecord argument, rederiveArgs carrying it, rollingWindow1y with calendarDays, optional ComparatorBlock types
  - phase: 194-23
    provides: rollingCalendarStats, ROLL_WINDOW_1Y_DAYS
provides:
  - "buildComparatorBlock(..., figureRecord?, rollCalendarDays?): record-gated joint plus jointAnnualization marker, and the comparator's own rollingVol1y / rollingSharpe1y / rollingSortino1y"
affects: [194-15, 194-24, 194-08]

actuals:
  tokens: 40000
  tasks: 2
  commits: 2

commits: 2
plan_head_before: 073c404ad2936d35272665b2b0c670adf7518fd0
plan_head_after: 0a627ac9356e30392c55c171f0d6cd17848f8aec

key-files:
  created:
    - src/lib/factsheet/comparator-block.d11.test.ts
    - src/lib/factsheet/comparator-block.d14.test.ts
    - src/app/factsheet/[id]/v2/basis-context.joint-record.test.tsx
  modified:
    - src/lib/factsheet/comparator-block.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/app/factsheet/[id]/v2/FactsheetBody.flat-leg.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.joint-floor.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx
    - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.book-btc.test.tsx

key-decisions:
  - "The record gate lives only in buildComparatorBlock; no reader gates alpha, IR, TE or Treynor."
  - "The overlap span is dates[first paired] to dates[last paired]; it only qualifies (short), the total record withholds."
  - "The 1y comparator series run rollingCalendarStats over the compacted covered returns and dates and are scattered back onto the strategy axis (null on uncovered days), the same covered region rollingOverCovered reads."

status: complete
---

# Phase 194 Plan 21: Record-gated joint and the comparator's own 365-day series Summary

**Factsheet alpha, information ratio, tracking error and Treynor are withheld (NaN, so every reader prints a dash) only when the strategy's total record is under D-15's minimum, in one place (`buildComparatorBlock`), and the comparator now carries its own 365-calendar-day volatility, Sharpe and Sortino beside its unchanged row-window series.**

## What was built

- `buildComparatorBlock` gained two trailing optional parameters after `spanStart` (the `headlineCoversFrom` value): `figureRecord?: FigureRecord | null` and `rollCalendarDays?: number`.
- **Joint gate (Task 1).** After `gateFlatLeg`, when the joint exists and a record was passed, the overlap span is `spanDays(dates[pairedIdx[0]], dates[pairedIdx.at(-1)])` and the verdict is `gateAnnualized(record, overlapSpan)`. Withheld: `alpha`, `info_ratio`, `tracking_error`, `treynor` are NaN, and `jointAnnualization { state: "withheld", days }` is set. Short: values kept, `{ state: "short", days }`. Full or an absent record: no key, joint as before. The paired floor (`jointWithheld`) and `flatLeg` run unchanged, and under both gates the NaN set is the union. Beta, correlation, R-squared and the captures are never touched (A-194-D11-03).
- `deriveSeriesBundle` passes `args.figureRecord` after `args.headlineCoversFrom` at both call sites, so the cash, MTM and smoothed bundles and both client re-derives (`windowView` and the leverage arm, through plan 14's `rederiveArgs`) share the one total record. `basis-context.tsx` is not edited (byte-equal to its committed state; `git status --porcelain` on it is empty).
- **Comparator 1y series (Task 2).** When `rollCalendarDays` is set (the bundle's `rollingWindow1y.calendarDays`, undefined when plan 14's window is null), the block adds `rollingVol1y`, `rollingSharpe1y`, `rollingSortino1y` from `rollingCalendarStats` over the covered returns and dates, at the comparator's own `benchPeriodsPerYear`. `rollingVol` / `rollingSharpe` / `rollingSortino` and `rollingBeta` are untouched. `scatterCovered` now accepts nullable per-covered values (its only change).
- Tests: `comparator-block.d11.test.ts` (13 cases: the plan's 8 block cases plus the non-crypto 59-observation case and union cases), `comparator-block.d14.test.ts` (9 cases), `basis-context.joint-record.test.tsx` (6 cases: zoomed 59-day withheld, zoomed cleared 400-day short, leverage-arm 59-day withheld, leverage-arm 400-day full, and two KPI-strip cases).

## Neuter, RED, restore (byte backups via `cp -p`, `cmp` clean after each)

Task 1:
1. NaN step skipped (`joint = flatGated`): `AssertionError: alpha: expected 0.8956178395023563 to be NaN` (3 cases RED: crypto 59-day, non-crypto 59 observations, flat-leg union).
2. Gate on the overlap span alone with the superseded 90-day rule: `AssertionError: alpha: expected NaN to be 0.8956178395023563 // Object.is equality` and `expected { state: 'withheld', days: 59 } to deeply equal { state: 'short', days: 59 }` (the 400-day-record-60-date cases, plus the non-crypto 60-observation case, RED).
3. `rederiveArgs` passing `figureRecord: null` (in `basis-context.tsx`, restored from `cp -p` backup): `AssertionError: alpha: expected 0.2903856055638309 to be NaN` (zoomed 59-day), `expected undefined to deeply equal { state: 'short', days: 29 }` (zoomed 400-day) and `alpha: expected 1.3501511692559751 to be NaN` (levered 59-day).

Task 2:
1. `rollCalendarDays` ignored: `TypeError: Cannot read properties of undefined (reading 'length')` (4 cases RED: 500-day daily, weekday comparator x2, builder case).
2. 1y series written into `rollingVol` instead of the 1y keys: `AssertionError: expected '[null,null,null,null,null,null,null,n…' to be '[null,null,null,null,null,null,null,n…'` (additivity pin RED, with the 1y-key cases).

## SC-4 snapshot key-level review

`.snap` backed up by `cp -p`, then `npx vitest run src/lib/factsheet/build-payload.test.ts -u` on that one file (3 snapshots updated, 29 tests pass). Before the update the three arm tests failed. A throwaway script (scratchpad, untracked, text-parses both `.snap` files without evaluation) required, per arm: each of the 8 joint fields `null` in the updated arm and a finite number in the backup arm; both `jointAnnualization` keys present with state `withheld`; then, deleting those two keys and copying the backup's 8 values back, the arm re-serializes byte-equal to the backup's arm.

```
entries bak/upd: 3 3 same names: true
composite arithmetic payload (metricsByBasis + markers) | jointAnnualization btc={"state":"withheld","days":61} spx={"state":"withheld","days":58} | byte-equal after revert: true; verdict: OK
ingestSource:'api' payload (synthesized panels)         | jointAnnualization btc={"state":"withheld","days":61} spx={"state":"withheld","days":58} | byte-equal after revert: true; verdict: OK
single-key geometric payload (whole-payload pin)        | jointAnnualization btc={"state":"withheld","days":61} spx={"state":"withheld","days":58} | byte-equal after revert: true; verdict: OK
ALL OK: true
```

Occurrence counts in the `.snap`: `"jointAnnualization":` 6, and `"alpha":null`, `"info_ratio":null`, `"tracking_error":null`, `"treynor":null` 6 each. No expectation in the SC-4 pins was hand-edited.

## Verification

- `npx vitest run src/lib/factsheet "src/app/factsheet/[id]/v2" "src/app/(dashboard)/allocations" --testTimeout=60000`: 5618 passed, 2 failed. The two are the known pre-existing `compute.conventions.test.ts` fixtures B and C. This covers the plan's required `allocations/widgets/performance` directory.
- `npm run typecheck`: clean. eslint on the five new or core files (`comparator-block.ts`, both new block tests, `build-payload.ts`, `basis-context.joint-record.test.tsx`): clean.
- Plan greps: `jointAnnualization` and `rollingCalendarStats(` and `rollingVol1y` present in `comparator-block.ts`; `args.headlineCoversFrom, args.figureRecord` on 2 lines of `build-payload.ts`; `basis-context.tsx` unmodified.

## Expectations edited because D-11 / D-15 made them false (listed per the plan)

All are 30 to 50 day crypto records, under D-15's 90-day minimum, that asserted an annualized joint value. Each is lengthened so the record clears, because each test is about something other than the joint gate:

1. `FactsheetBody.flat-leg.test.tsx`: three cases ("Tracking Error keeps its number", and the two "control: a leg that varies" cases) now build a 400-day record (`build(START, fn, 400)`). Assertions unchanged.
2. `FactsheetBody.joint-floor.test.tsx`: `build` gained an optional `n` (default unchanged); "BTC active on the same record: the figures render" uses 400 days.
3. `FactsheetView.leverage.test.tsx`: `SMALL_STRAT` / `SMALL_BENCH` go from 50 to 120 days so the 119-day record clears (short, values kept) and "α → L·α" is still asserted as written.
4. `AlphaBetaDecomposition.book-btc.test.tsx` (allocations, not a factsheet file): the parity cases (60-day book, 10 paired, 30 paired) run on a book with 90 earlier days that carry no BTC close, so the record clears and the same days pair. See Deferred Issues.

`FactsheetView.window-kpis.test.tsx` (the 195-shared file in the plan's list) needed no edit; no expectation in it moved. The KPI strip cases were added to the new `basis-context.joint-record.test.tsx` instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Four existing tests outside `files_modified` edited.** The plan's action tells the executor to fix every test the new gate turns red; the four above were the only ones, and each is listed. No product code changed for them.

**2. [Plan wording] Parameter name.** The plan calls the existing positional parameter `headlineCoversFrom`; in `buildComparatorBlock` it is `spanStart` (the call sites pass `args.headlineCoversFrom`). The two new parameters follow it.

**3. [Rule 1 - test fixture] d14 builder cases start at 2024-01-01.** The bundled BTC closes begin 2023-04-26, so the daily 500-day fixture from 2023-01-02 is used only for direct block cases; the builder cases use 2024-01-01 so BTC covers every date.

## Deferred Issues

- `AlphaBetaDecomposition.tsx` (`computeBookAlphaBeta`) is not gated by D-15. A book under 90 days prints a dash in the Overview's alpha cell and a number in the widget. D-69 parity holds only on records that clear D-15. No 194 plan names the widget. Recorded in `deferred-items.md`. It needs its own `gateAnnualized` verdict built from the book's record.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; T-194-41 is mitigated as the plan's register describes (single gate at the block, record carried through `rederiveArgs` and proven through both arms with the `rederiveArgs` neuter).

## Self-Check: PASSED

Created files exist (`comparator-block.d11.test.ts`, `comparator-block.d14.test.ts`, `basis-context.joint-record.test.tsx`, this SUMMARY); commits `b116cb3e0` and `0a627ac93` are ancestors of HEAD.
