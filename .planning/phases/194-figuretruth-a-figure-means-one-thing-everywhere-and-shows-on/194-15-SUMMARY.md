---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 15
subsystem: factsheet-rail
tags: [trust-05, d-04, d-11, d-13, d-14, d-15, rolling, bootstrap, figure-gate]

requires:
  - phase: 194-04
    provides: payload.figureRecord, the rail's one record-scope verdict (gateState) in MetricsColumn
  - phase: 194-12
    provides: RollingVerdict, widenedWithheldReason, widenedShortNote
  - phase: 194-14
    provides: rollingWindow.annualization, rollingWindow1y and strategyRolling*1y (null under 365 days), ComparatorBlock.jointAnnualization (type)
provides:
  - "`rolling-annualization-note` and the additive `Rolling Metrics (1y)` table (`rolling-metrics-1y`) on the rail"
  - "`joint-annualization-note` in section IV's joint arm"
  - "Cumulative Return Metrics CAGR gated by the record-scope verdict"
  - "`BootstrapCIPanel` `figureState` prop: Sharpe and Sortino dashed and un-sparklined when withheld; muted, glyph-free low-N sentence"
affects: [194-08, 194-21]

requirements-completed: [TRUST-05]

actuals:
  tokens: 12500
  tasks: 3
  commits: 3

commits: 3
plan_head_before: 073c404ad2936d35272665b2b0c670adf7518fd0
plan_head_after: 6ca991b52162b9fefbf66c70f5f5343940ec1619

key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.d11.test.tsx
    - src/app/factsheet/[id]/v2/AnalyticalPanels.d11.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.rolling-now.test.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx

key-decisions:
  - "The 1y table is a second Panel in a `data-testid=rolling-metrics-1y` wrapper, returned beside the row-window Panel from `RollingMetricsPanel` (a fragment), so the first table's title, rows and note are untouched."
  - "The 1y table dashes when its own verdict is withheld or the legacy whole-record withhold is on, and carries no note (plan: its verdict is full)."
  - "`rollingVerdictNote`: cause `record` reads only a day count, so it falls back to the verdict's own `days` when the rail has no record; cause `gate` needs a record and prints no line without one (unreachable: the builder sets the verdict only with a record)."
  - "`BootstrapCIPanel.figureState` is optional and defaults to `null` (figures show), so the four existing direct callers in tests stay valid; the one production caller always passes it."
  - "`jointAnnualizationNote` prints nothing under the legacy `wholeRecordWithheld` path, like the flat-leg reason beside it."

status: complete
---

# Phase 194 Plan 15: Rail rolling, joint, CAGR and Bootstrap verdicts Summary

**The factsheet rail now follows D-04 and D-11 as superseded by D-15 on every annualized figure it shows: the rolling table dashes or qualifies from the payload's verdict, a record of a year or more gets a plain second `Rolling Metrics (1y)` table beside the row-window one, section IV says why alpha, IR, Treynor and TE are blank, the last ungated CAGR is gated, and Bootstrap withholds Sharpe and Sortino (not Max Drawdown) on a short total record.**

## Accomplishments

- **Task 1 (tracer):** `RollingMetricsPanel` reads `view.rollingWindow?.annualization`. Withheld nulls Now/Avg/Min/Max of all three rows and the one muted note (`rolling-annualization-note`) carries `widenedWithheldReason("rolling", record)` for cause `gate` or `("rolling-record", record)` for cause `record`; short carries `widenedShortNote("rolling", days)`; absent prints no note. When `view.rollingWindow1y` and the three `strategyRolling*1y` arrays are non-null a second `Rolling Metrics (1y)` table follows, restricted to a selected range with the same `within` slice, with no note. The shared table markup moved into `RollingTable` so both tables are the same code.
- **Task 2:** `BenchmarkMetricsBody` gained `annualizationNote`, rendered after the reason line as `joint-annualization-note`, fed from `jointCmp.jointAnnualization` in the `jointCmp.joint` arm only (`widenedWithheldReason("overlap", rail record)` or `widenedShortNote("overlap", days)`). `CumulativeReturnsPanel` takes `figureState` (the record-scope `gateState`, correct because the panel mounts only at full history) and prints `gatedValue(m.cagr, figureState)`.
- **Task 3:** `BootstrapCIPanel` takes `figureState`. Withheld replaces Sharpe and Sortino with the existing withheld form (`withheldBootstrapCI`), skips their two `BootHist` sparklines, and drops them from the "resamples dropped" caption; Max Drawdown row, interval and sparkline are untouched. The low-N paragraph is `text-text-muted` with no inline warning colour and no glyph, trigger and words unchanged. `CalmarByYearPanel` was not edited.

## Assumptions recorded

- **A-194-D13-01 (Bootstrap low-N, muted):** the Bootstrap low-observation sentence is a short-record warning, so per D-13 it is muted with no glyph; its trigger (`b.n < 252`, not withheld) and its words are kept. Pinned by `AnalyticalPanels.d11.test.tsx`.
- **A-194-D13-02 (Calmar by year stays amber):** per-year Calmar is a calendar-year return over that year's drawdown, not annualized, so a 60-day record still shows every row while the headline Calmar on the same rail is a dash; its partial-year marker is a comparability caveat, so it keeps `var(--color-warning)`. Pinned in the same file, with a comment naming A-194-D13-02.
- **Bootstrap verdict follows D-15:** the verdict passed is `gateState`, `gateAnnualized(record, windowSpan)` over the TOTAL record. A selected range never withholds; only the total record does.

## Neuter, RED, restore (byte backups via `cp -p`, `cmp` clean after each)

Task 1 (`MetricsColumn.d11.test.tsx`):
1. Withheld state ignored (`dashRows = wholeRecordWithheld`): `AssertionError: expected [ '25.0%', '26.0%', '20.0%', '32.0%' ] to deeply equal [ '—', '—', '—', '—' ]` (gate and record dash cases, 2 failed).
2. Note suppressed for the 30-row short window (`days >= 30` guard): `AssertionError: expected undefined to be 'Rolling figures are annualized from a…'` (1 failed).
3. Only the 1y table when `rollingWindow1y` is present (row-window Panel rendered only when `view1y == null`): `Error: no panel titled "Rolling Metrics (6mo)"` (6 failed, the 400-day additivity pin among them).

Task 2:
1. `gatedValue` dropped from the cumulative CAGR: `AssertionError: expected '+1.95%' to be '—'` (60-day CAGR case, 1 failed).
2. `jointAnnualizationNote` returning nothing (extra, beyond the plan): 4 failed, e.g. `AssertionError: expected undefined to be 'Alpha, information ratio, Treynor and…'`.

Task 3 (`AnalyticalPanels.d11.test.tsx`):
1. `figureState` ignored: `AssertionError: expected [ '0.20', '[-11.07, 11.35]' ] to deeply equal [ '—', '[—, —]' ]` (1 failed).
2. Low-N sentence restored to the amber style and glyph (extra): `AssertionError: expected 'mb-2 text-micro italic' to contain 'text-text-muted'` (1 failed).

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2"`: 106 files, 1373 passed, 0 failed (the 2 `MetricsColumn.arithmetic-windows` failures plan 04 recorded do not reproduce at this base).
- Outside the directory: allocations `widgets/performance`, `ScenarioComposer`, OG factsheet routes, `phase-52-frozen-spine-guards`, `audit-c20` pass. `display-sign-single-source.test.ts` timed out once under load in the combined run and passes alone (26 passed, 32 s).
- `npm run typecheck` clean. eslint: 0 errors; one pre-existing warning (`nativeUnitReason` unused import, untouched).
- Plan greps: `rolling-annualization-note`, `rolling-metrics-1y`, `joint-annualization-note` in `MetricsColumn.tsx`; `figureState` and `Years with &lt; 200 trading days` in `AnalyticalPanels.tsx`.

## Deviations from Plan

**1. [Rule 3 - Blocking] Two older test files matched the bare title `Rolling Metrics` and broke with a second table present.** `MetricsColumn.rolling-now.test.tsx` used `getByText(/Rolling Metrics/)` (3 cases failed with "multiple elements"); `FactsheetView.headline-coverage.test.tsx`'s `panelSection` matched by `startsWith("Rolling Metrics")` (20 cases failed with "2 panels"). Both fixtures are 500 days or more, so plan 14's builder gives them a real 1y window. Each now selects the row-window table (the first by `Rolling Metrics \((6mo|30d)\)`, the second by excluding the exact title `Rolling Metrics (1y)`); no expectation moved. Neither file was in the plan's `files_modified`.

**2. [Plan wording] `figureState` is optional on `BootstrapCIPanel`.** The plan says "add a `figureState: FigureState` prop". Four test files render the panel directly with only `wholeRecordWithheld`; an optional prop defaulting to `null` leaves them untouched and the one production caller (`MetricsColumn`) always passes it.

**3. No Co-Authored-By or Claude-Session trailers** on the three commits (project rule overrides the harness attribution reminder).

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema; T-194-30 is mitigated as the register describes (verdicts read from the payload, copy from `figure-gate.ts`, neuter-RED per task).

## Notes for later plans

- Plan 21 sets `jointAnnualization` and the NaN figures; this rail already reads both, and its tests build them in fixtures. Plan 08 integrates the real producer.
- The Scenario payload reaches the rail's gates through `payload.figureRecord` and `rollingWindow.annualization`, which plan 14 sets on the blend.

## Self-Check: PASSED

Created files exist (`MetricsColumn.d11.test.tsx`, `AnalyticalPanels.d11.test.tsx`); commits `c7af23cd7`, `49209dfcc` and `6ca991b52` are ancestors of HEAD.
