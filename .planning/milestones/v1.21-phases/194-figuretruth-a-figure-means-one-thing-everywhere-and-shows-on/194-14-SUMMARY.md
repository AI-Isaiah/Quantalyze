---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 14
subsystem: factsheet-payload, scenario-payload
tags: [trust-05, d-11, d-14, d-15, rolling-window, figure-gate]

requires:
  - phase: 194-04
    provides: payload.figureRecord (stored observation count or null)
  - phase: 194-12
    provides: gateRollingWindow, RollingVerdict
  - phase: 194-23
    provides: ROLL_WINDOW_1Y_DAYS, rollingCalendarStats
provides:
  - "RollWindowPick.annualization and .calendarDays"
  - "rollingWindow1y and strategyRollingVol1y / Sharpe1y / Sortino1y on BasisSeriesBundle, FactsheetCommon, and the Scenario payload (null under 365 days)"
  - "deriveSeriesBundle's required figureRecord argument; rederiveArgs passes view.figureRecord"
  - "optional ComparatorBlock.jointAnnualization / rollingVol1y / rollingSharpe1y / rollingSortino1y; OwnBookDeltaPayload.span_days / records (types only)"
affects: [194-15, 194-16, 194-17, 194-21, 194-24, 194-08]

actuals:
  tokens: 35000
  tasks: 3
  commits: 3

commits: 3
plan_head_before: de4a9813054a217410c6705c50ed76b139be71d1
plan_head_after: a92f9b20c916c70b373983e7fb287b1710184b87

key-files:
  created:
    - src/lib/factsheet/build-payload.d11.test.ts
    - src/app/factsheet/[id]/v2/basis-context.figure-record.test.tsx
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.d11.test.ts
  modified:
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
    - src/lib/factsheet/build-payload.rolling-basis.test.ts
    - src/app/factsheet/[id]/v2/basis-context.tsx
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts

key-decisions:
  - "The payload's figureRecord is built once, before the three bundles, and passed to all of them (cash, MTM, smoothed); the old inline build in `common` now reads that one object."
  - "The 1y window's `window` is the index of the first date whose span from the first date reaches 365 days, plus one (366 on a 400-day daily record), computed from dates, not from which series value happens to be non-null."
  - "The 1y series reuse the row windows' basis split: Sharpe on the active-basis series, volatility and Sortino on the dense series, each with its own dates (`seriesDatesFor`: kept days under the active basis, zero-filled calendar days of a composite)."
  - "The empty Scenario blend sets no figureRecord (key absent) and a withheld/record/0 rolling verdict, as the plan specified for the verdict only."

status: complete
---

# Phase 194 Plan 14: Rolling verdict and the added 365-day window Summary

**The factsheet and Scenario payloads now say, at the place the rolling window is picked, whether the window may be drawn (D-11 as superseded by D-15), and a record of 365 days or more also carries a 365-calendar-day window beside the row window (D-14, additive). Every bundle builder and both client re-derives gate on the one total record.**

## What was built

- **Types** (`types.ts`): `RollWindowPick.annualization?: RollingVerdict` and `.calendarDays?`; `rollingWindow1y?: RollWindowPick | null` plus three `strategyRolling*1y` series (`Array<number|null> | null`) on both `BasisSeriesBundle` and `FactsheetCommon`; `ComparatorBlock.jointAnnualization?` and `rollingVol1y/rollingSharpe1y/rollingSortino1y?`; `OwnBookDeltaPayload.span_days?` and `records?`. All optional.
- **`deriveSeriesBundle`**: new required `figureRecord: FigureRecord | null` argument. A non-null record sets `rollingWindow.annualization = gateRollingWindow(record, dates, { rows }, enough)`; null leaves the key absent. From 365 days it also sets `rollingWindow1y` (verdict `gateRollingWindow(record, dates, { calendarDays: 365 }, true)`) and three series from `rollingCalendarStats`; under 365 days all four keys are `null`, never omitted, never `undefined`. `rollBetaWindow` is untouched.
- **`buildFromBuildableSeries`**: the `figureRecord` is hoisted above the bundles and passed to cash, MTM and smoothed; the four 1y keys are copied to the payload beside `rollingWindow`.
- **`basis-context.tsx`**: one key in `rederiveArgs`, `figureRecord: view.figureRecord ?? null`, which covers the leverage arm and `windowView`. Nothing else in the file changed.
- **Scenario builder**: builds the blend's `figureRecord` once from the blend dates, the overlap count and the received `periodsPerYear`; sets the verdict, the 1y window and series (null under 365 days) and the payload's `figureRecord`. The empty blend gets `{ withheld, days 0, cause "record" }` and no record.

## Call-site measurement

`grep -rnE 'deriveSeriesBundle\(|deriveSeriesBundle\)\.getMockImplementation\(\)!?\(' src | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)' | grep -v 'export function deriveSeriesBundle('` printed **29 lines** at the start, as the plan predicted (5 production, 24 test). tsc then listed exactly 24 test errors. Files that gained `figureRecord: null`, with call counts: `basis-context.leverage.test.tsx` 5, `FactsheetView.leverage.test.tsx` 4, `TimeSeriesChart.marks-start.test.tsx` 2, `FactsheetView.headline-coverage.test.tsx` 2, `FactsheetBody.basis.test.tsx` 2, `basis-context.window.test.tsx` 2, and 1 each in `build-payload.covered-days.test.ts`, `comparator-block.volmatch-nan.test.ts`, `MetricsColumn.record-length.test.tsx`, `TimeSeriesChart.coverage-gap.test.tsx`, `FactsheetView.leverage-honesty.test.tsx`, `basis-context.cash-leverage-repin.test.tsx`, `FactsheetView.window-kpis.test.tsx` (the mocked-handle form; its assertions are untouched and it passes). Total 24. No expectation in any of them moved.

## SC-4 snapshot key-level review

Backup by `cp -p`, then `npx vitest run src/lib/factsheet/build-payload.test.ts -u` on that one file. Before the update the three arms failed, each only on the added paths. Throwaway script (scratchpad, untracked) loaded the backup and updated `.snap`, parsed each arm, deleted the five paths, and required `JSON.stringify` equality with the backup's arm:

```
entries bak/upd: 3 3 same names: true
composite arithmetic payload      | byte-equal after delete: true
ingestSource:'api' payload        | byte-equal after delete: true
single-key geometric payload      | byte-equal after delete: true
```

Added values, identical in all three arms: `rollingWindow.annualization` = `{"state":"withheld","days":61,"cause":"gate"}`; `rollingWindow1y`, `strategyRollingVol1y`, `strategyRollingSharpe1y`, `strategyRollingSortino1y` = `null`. Plan 04's `figureRecord` (`{"spanDays":61,"observations":null,"crypto":true}`) did not move. Occurrence counts in the `.snap`: `"annualization":` 3, `"rollingWindow1y":null` 3, `"strategyRollingSharpe1y":null` 3.

## Neuter, RED, restore (byte backups via `cp -p`, `cmp` clean after each)

Task 1 (`build-payload.d11.test.ts`):
1. `{ rows: 126 }` passed for the 30-row window: `AssertionError: expected { state: 'withheld', days: 99, …(1) } to deeply equal { state: 'short', days: 29, …(1) }` (100-day case; the 70-weekday case also RED).
2. 1y window replacing `rollingWindow`: `AssertionError: expected { window: 366, label: '1y', …(3) } to deeply equal { window: 126, label: '6mo', …(2) }` (400-row additivity pin; MTM and null-record cases also RED).
3. 1y computation skipped: `AssertionError: expected null to deeply equal { window: 366, label: '1y', …(3) }` (6 cases RED).

Task 2 (`basis-context.figure-record.test.tsx`):
1. `rederiveArgs` passing `figureRecord: null`: `AssertionError: expected undefined to deeply equal { state: 'withheld', days: 59, …(1) }` (all three leverage-arm cases RED).
2. 1y keys omitted under 365 days: `AssertionError: rollingWindow1y: expected { window: 366, label: '1y', …(3) } to be null` (MTM merge case and JSON case RED).
3. 1y keys `undefined`: in memory the merge copies the `undefined`; after the JSON round-trip the key is dropped and the cash window returns: `AssertionError: rollingWindow1y: expected { window: 366, label: '1y', …(3) } to be null` (JSON case RED).
4. `windowView` copying the slice bundle's `rollingWindow`: `AssertionError: expected { window: 30, label: '30d', …(2) } to deeply equal { window: 126, label: '6mo', …(2) }` (both zoom cases RED).

Task 3 (`scenario-factsheet-payload.d11.test.ts`):
1. Record built at 252 regardless of the received `periodsPerYear`: `AssertionError: expected { Object (spanDays, observations, ...) } to deeply equal { Object (spanDays, observations, ...) }` (the 70-consecutive-day crypto case and the 400-day record case RED).
2. 1y replacing `rollingWindow` on the 400-day blend: `AssertionError: expected { window: 366, label: '1y', …(3) } to deeply equal { window: 126, label: '6mo', …(2) }`.

## Verification

- `npx vitest run src/lib/factsheet "src/app/factsheet/[id]/v2"`: 2835 passed, 4 failed. The four are the known pre-existing ones: `compute.conventions` fixtures B and C, and the two `MetricsColumn.arithmetic-windows` tests (not edited).
- `npx vitest run "src/app/factsheet/[id]/v2"` after Task 2: 1350 passed, 2 failed (the two known `MetricsColumn.arithmetic-windows`). An earlier run at machine load 54 timed out ten unrelated tests at the 5 s default; the same suite is green at `--testTimeout=60000`, and those tests did not touch anything this plan edited.
- `npx vitest run "src/app/(dashboard)/allocations"`: 161 files, 2729 passed (includes the parity guard).
- `npm run typecheck`: clean with `figureRecord` required. eslint on the three touched directories: 0 errors, the two pre-existing unused-import warnings (`nativeUnitReason`, `isRankableAnalyticsRow`).
- Plan greps: `gateRollingWindow(`, `rollingCalendarStats(`, `annualization?: RollingVerdict`, `rollingWindow1y?: RollWindowPick | null`, `calendarDays?: number`, `figureRecord: FigureRecord | null;` and `figureRecord: view.figureRecord` all present; Task 2's `git status --porcelain` on `basis-context.tsx` and `build-payload.ts` was empty after the neuters.

## Deviations from Plan

**1. [Rule 3 - Blocking] `build-payload.rolling-basis.test.ts` is not in `files_modified`.** One case deep-equals `rollingWindow` (`{ window: 126, label: "6mo", enough: true }`) and failed only because of the added `annualization` key. Updated to include `annualization: { state: "short", days: 125, cause: null }` with a comment citing D-11 / D-15; window, label and enough are unchanged.

**2. [Plan arithmetic] Task 3's 70-day crypto case.** The plan says "the same dates at 365 (one crypto leg): withheld, cause gate (crypto bound, 90 days)" for the 70-weekday fixture. Those 70 weekday observations span 95 calendar days, which clears the crypto 90-day bound, so a crypto blend over them is drawn (short), not withheld. The test uses 70 CONSECUTIVE days (span 69) for the withheld-at-365 case, and one extra case pins the weekday-dates-at-365 reading (short). The neuter (record at 252) still bites the consecutive-day case. Flagged for the checker, no product code is affected.

**3. [Plan wording] The parity guard needed no extension.** `scenario-factsheet-parity-guard.test.ts` is a source-level import/membership guard and does not enumerate `rollingWindow` keys, so it is unedited and passes.

**4. [Decision, within the plan] The 1y `window` index is date-based.** The plan says "first non-null index plus one"; the code uses the first date whose span from the first date reaches 365 days, plus one. Identical on every fixture (366 at 400 daily rows), but it does not depend on a series value happening to be non-null (a degenerate Sharpe window).

**5. No Co-Authored-By or Claude-Session trailers** on any commit (project rule overrides the harness attribution reminder).

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; T-194-29 is mitigated as the plan's register describes.

## Self-Check: PASSED

Created files exist (the three test files and this SUMMARY); commits `858f28bc0`, `b067197e6` and `a92f9b20c` are ancestors of HEAD.
