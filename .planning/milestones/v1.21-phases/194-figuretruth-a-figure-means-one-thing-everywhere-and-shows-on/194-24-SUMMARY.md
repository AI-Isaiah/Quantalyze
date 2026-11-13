---
phase: 194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on
plan: 24
subsystem: factsheet-charts
tags: [trust-05, d-11, d-14, d-15, rolling-window, figure-gate]

requires:
  - phase: 194-14
    provides: rollingWindow.annualization, rollingWindow1y, strategyRolling*1y on the view
  - phase: 194-21
    provides: the comparator's rollingVol1y / rollingSharpe1y / rollingSortino1y
  - phase: 194-12
    provides: widenedWithheldReason, widenedShortNote
provides:
  - "PerformanceCharts gated by roll.annualization (withheld drops the three rolling charts, short qualifies them)"
  - "RollingWindowChoice and applyRollingWindowChoice (D-14, additive 1y option)"
  - "chart-configs 1y stratField keys; ComparatorSeriesKey admits optional numeric-array keys"
affects: [194-08]

actuals:
  tokens: 40000
  tasks: 1
  commits: 1

commits: 1
plan_head_before: 91ffad9446edd88ae1ddd475d0788517599fe01c
plan_head_after: bb748dafd

key-files:
  created:
    - src/app/factsheet/[id]/v2/rolling-window-choice.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.rolling-gate.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/chart-configs.ts

key-decisions:
  - "The row window stays the chart default on every record; 1y is an option beside it, offered only when view.rollingWindow1y is non-null and the row charts are drawn."
  - "The effective choice is the row window whenever the view has no 1y window, so a 1y choice made on a cash view cannot leak onto a shorter MTM view."
  - "applyRollingWindowChoice takes (cfg, choice, roll1y): the plan's `roll` argument was unused, so it is not in the signature."

status: complete
---

# Phase 194 Plan 24: Factsheet rolling charts follow the rolling verdict and gain the 1y option Summary

**The factsheet's rolling volatility, Sharpe and Sortino charts now read the rolling verdict (withheld removes them and shows the shared reason, short draws them with a one-year note), and a record of a year or more offers a plain 1y window beside the row window, which stays the default.**

## What was built

- `FactsheetView.tsx`, inside `PerformanceCharts` only (plus two import lines): reads `roll.annualization`. Withheld (cause `gate` or `record`) filters the three rolling charts out; the existing `NotEnoughDataPanel` then renders when the verdict is withheld or `!roll.enough`, with its title kept and its body from `widenedWithheldReason("rolling" | "rolling-record", payload.figureRecord)`. The old "too short to compute even a 30-day rolling volatility" sentence is gone. When the payload has no `figureRecord` (stale cache), the body is the one sentence "Rolling annualized figures appear once the record covers one full rolling window." with no count.
- Short: each rolling config's subtitle gets `widenedShortNote("rolling", days)`, joined with ` · ` after an existing subtitle (none exists today, so it is the note alone).
- D-14: one `useState` for the choice, default row. `RollingWindowChoice` mounts once before the first rolling chart when `view.rollingWindow1y` is non-null; the effective choice is the row window when it is null or absent. `1y` maps the three configs through `applyRollingWindowChoice`.
- `rolling-window-choice.tsx` (new, client): `RollingWindowChoice` (a `SegmentedControl` wrapped in `data-testid="rolling-window-choice"`, options the row label and `1y`) and `applyRollingWindowChoice`, which maps `stratField` / `comparatorField` to the `*1y` siblings, titles `(1y)`, sets `warmup: rollingWindow1y.window` and adds no note.
- `chart-configs.ts`: three `strategyRolling*1y` `stratField` keys; `ComparatorSeriesKey` mapped with `-?` over `Exclude<..., undefined>` (proved by a throwaway tsc check: `rollingVol1y` compiles, `jointAnnualization` and `name` fail); `resolveSeries` draws no strategy line for an absent array.
- The rolling beta chart and its panel are untouched; a test compares them with and without the verdict at 60 and 200 days.

## Neuter, RED, restore (byte backups via `cp -p`, `cmp` clean after each)

`FactsheetView.tsx`, test `FactsheetView.rolling-gate.test.tsx`:
1. Withheld filter dropped (`(!roll.enough || rollWithheld)` to `(!roll.enough)`): `AssertionError: expected <div …(6)></div> to be null` (the 59-day gate case).
2. `short` treated as withheld: `TestingLibraryElementError: Unable to find an element by: [data-testid="rolling-window-choice"]` (5 cases RED: 30-row, 6mo/200-day, 400-day additivity pin, control order, basis switch).
3. Choice defaulted to `1y`: `AssertionError: expected 'Rolling Volatility (1y)' to contain '(6mo)'` (additivity pin RED).
4. Effective choice taken from the state alone: `AssertionError: expected false to be true // Object.is equality` (basis-switch case: the MTM charts lose the 125-day note).

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2"`: 109 files, 1406 tests passed (includes the 9 new cases; the two `MetricsColumn.arithmetic-windows` failures plan 14 recorded did not reproduce at this base).
- `npm run typecheck`: clean. eslint on the four touched files: clean.
- Plan greps: `roll.annualization`, `applyRollingWindowChoice(`, `data-testid="rolling-window-choice"`, `"strategyRollingSharpe1y"` present; the old sentence absent.
- `git diff` hunks in `FactsheetView.tsx`: the two import lines, then only inside `PerformanceCharts`.

## Deviations from Plan

**1. [Plan wording] `applyRollingWindowChoice(cfg, choice, roll1y)` has no `roll` argument.** The plan's four-argument form never used `roll`; the row choice returns the config unchanged and the existing row mapping runs in `PerformanceCharts`. The key-link pattern `applyRollingWindowChoice\(` still matches.

**2. [Rule 2 - robustness] Unknown record fallback.** The plan names `widenedWithheldReason` for the panel body, which needs a record. With no `figureRecord` (stale cache, `!roll.enough`) a fixed sentence without a count is used instead of printing "0 days" for an unknown record.

**3. Edited expectations in 195-shared test files:** none. No existing test's expectation moved (D-14 is additive; no existing test asserted the old rolling sentence).

**4. Test note.** The 1y chart cases read the config the page hands `TimeSeriesChart` (stubbed), not the drawn SVG; the series field names and warmup are what `PerformanceCharts` decides, and `resolveSeries` is unchanged beyond the absent-array guard.

No Co-Authored-By or Claude-Session trailers on the commit (project rule overrides the harness attribution reminder).

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema; T-194-49 is mitigated as the plan's register describes.

## Self-Check: PASSED

Created files exist (`rolling-window-choice.tsx`, `FactsheetView.rolling-gate.test.tsx`, this SUMMARY); commit `bb748dafd` is an ancestor of HEAD.
