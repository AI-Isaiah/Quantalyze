---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
plan: 09
subsystem: factsheet
tags: [factsheet, withheld, eoy-bars, monthly-heatmap, worst-10-chart, rolling-hover, FACT-01]
requires: [237-03, 237-04, 237-12]
provides:
  - "EOY bar chart, Worst 10 chart, heatmap YTD column and rolling hover reading withheld on a Withheld full-history view"
  - "optional ChartConfig fields withheldNote and lastPointWithheld"
affects: []
tech-stack:
  added: []
  patterns: ["verdict computed where the element mounts and passed as a prop or config field; no element calls isHeadlineWithheld"]
key-files:
  created:
    - src/app/factsheet/[id]/v2/FactsheetView.withheld-renderings.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/DistributionPanels.tsx
    - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
    - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
    - src/app/factsheet/[id]/v2/chart-configs.ts
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx
decisions:
  - "The legend chip above a rolling chart prints the same hover value as the crosshair card, so it dashes at the last index too (not named in the plan; without it the withheld figure reached the DOM through the chip)"
  - "worstDDsNote is memoised in PerformanceCharts: it is an object, and a fresh one per render would rebuild every chart config"
status: complete
actuals:
  tokens: 42000
  tasks: 3
  commits: 3
plan_head_before: 4f85f4b95baae2a643cfeda432a37d89f1763535
plan_head_after: 92a267dc3293fc10671894a40b2ca599d1296110
---

# Phase 237 Plan 09: Secondary renderings of the withheld figures Summary

On a Withheld full-history view the End-of-Year Returns bar chart, the Monthly Returns heatmap's YTD column, the Worst 10 Drawdown Periods chart and the rolling charts' last-point hover reading now withhold the same figures the rail panels withhold, inside a zoom included. A Dated or clean row renders exactly as before.

Agent branch: `worktree-agent-ab6991acc8f4a3cb6`, re-based to `4f85f4b95baae2a643cfeda432a37d89f1763535` before any work (verified `git rev-parse HEAD`). Final code HEAD before this SUMMARY commit: `92a267dc3293fc10671894a40b2ca599d1296110`.

## What changed

- `DistributionPanels.tsx`: `EndOfYearBarsPanel` keeps its boolean `fullHistoryWithheld` prop. In-panel it computes `headlineCoverageNote(payload.dataQuality, useBasisOrCash(), "panel")` (hook called unconditionally at the top). Gate on and note present: the `<figure>` keeps its `<h3>` (including the vs-comparator form) and renders `PanelWithheldNote testId="chart-withheld-note"` only: no subtitle, no svg, no legend. Gate on and note null (failed): returns null. The old last-year-only rule (`year === lastYear`) is removed.
- `HeatmapPanels.tsx`: `ytdWithheld={fullHistoryWithheld}` for every row; the dashed YTD `td` carries `data-testid="heatmap-ytd-withheld"` (no title, no tone). `withheldMonthIdx` is untouched (last row's last month keeps its existing withheld treatment).
- `chart-configs.ts`: two optional `ChartConfig` fields, `withheldNote?: HeadlineNote` (type-only import from `./MetricsColumn`; `MetricsColumn` imports neither `chart-configs` nor `TimeSeriesChart`, `grep` printed nothing) and `lastPointWithheld?: boolean`.
- `TimeSeriesChart.tsx`: with `config.withheldNote` set, an early return (after every hook) renders the header title and `PanelWithheldNote testId="chart-withheld-note"`: no subtitle, frame, line, bands, depth labels, crosshair, legend chips or export menu. With `lastPointWithheld`, the strategy row (series 0 when the strategy series resolved) at index `n - 1` prints a dash in the crosshair card (`data-testid="crosshair-value-withheld"`, swatch and name kept) and in the legend chip.
- `FactsheetView.tsx` (`PerformanceCharts`): `worstDDsNote` (memoised) is the plan-03 "panel" note when `fullHistoryWithheld` (not the slice-aware `railAvgWithheld`, because the bands are whole-record even when zoomed); the `worstDDs` config gets `withheldNote`, or is filtered out on the failed cause. The rolling configs get `lastPointWithheld: true` beside `showStratAverage: false` when `railAvgWithheld`. Both new values are in the `useMemo` dependency list.

## Tests

- New `FactsheetView.withheld-renderings.test.tsx`, 22 cases: EOY chart (standalone panel: note shape, recomputing, failed, Dated; whole body with and without a range, failed, a +900% last year reaches neither label nor scale); heatmap (every row dashed at full history and in a range, dashed count equals year count, no tone, no title, month cells keep figures except the last row's last month, every cause, Dated has none); Worst 10 chart (Dated premise draws bands and `#n` labels; Withheld at full history and in a range: title plus one note, no svg or subtitle or label or button, rail table withheld at full history and showing its slice in a range; recomputing; failed absent in both); rolling hover (for each of Rolling Volatility, Sharpe and Sortino: dash at the last index in card and legend chip, figure at the previous index; comparator row unchanged; inside a zoom ending at the last day a figure; Dated and clean a figure).

### Tests rewritten in place (all in this plan's files)

| Test (all in `FactsheetView.headline-coverage.test.tsx`) | Why |
|---|---|
| WR-02 (title now "superseded by Phase 237 FACT-01, UI-SPEC 1.6") | Pinned "no last-year label, bar or scale; earlier years keep theirs". Now asserts one note, no svg, no scale caption, no row for any year, no `%` or `900` text. The clean premise keeps labels and bars in view |
| WR-03 (title now "superseded by Phase 237 FACT-01, UI-SPEC 1.6") | Pinned "earlier rows keep their YTD total". Now asserts every earlier row's total is `—`, untoned and untitled; the last-row month assertions are unchanged |
| "scope" describe, `readCopies` (chart half) | Gained `barNotes`, `barSvg`, `heatYtds`. The cash MTM-vs-cash case and the in-a-zoom case now expect no bar row, no svg, one chart note, and every heatmap YTD dashed; MTM expects every YTD figure and no chart note |

Found by running the factsheet directory before editing: exactly these four test cases were red (WR-02, WR-03 and the two scope cases), and no other. A body-level grep for "End-of-Year Returns" and "Monthly Returns" found no other case reading these surfaces; no case in the file reads the Worst 10 chart or a rolling tooltip. The six `EndOfYearBarsPanel` mounts (edge-tick-labels, EoyComparatorCoverage, no-hover-panels-viewport, FactsheetView.returns-unit-comparisons, MetricsColumn.comparator-through, panels.signed-zero) stayed green untouched.

## PROOF-01 (byte-backed neuter, RED then GREEN)

Backups in the session scratchpad (outside the repo); each restore by `cp`, `cmp` printed `cmp exit 0` before the next neuter; no backup was committed.

**Neuter 1 (Task 1): `DistributionPanels.tsx` ignores `fullHistoryWithheld` (treated as false).** `npx vitest run FactsheetView.withheld-renderings.test.tsx`. RED, verbatim:

```
     × keeps the title and replaces everything else with one note: no svg, no subtitle, no bar label, no legend 652ms
     × recomputing cause: the FH237-PANEL-RECOMPUTING sentence under the title 499ms
     × failed cause: the figure is absent (the page already states the analytics failed) 379ms
     × whole body: a Withheld full-history row carries the note, with and without a range 1283ms
     × whole body: the failed cause leaves no End-of-Year Returns chart at all 847ms
     × whole body: the year every earlier test fixes as the last (set far above the rest) leaves no digit in the figure 1349ms
 Test Files  1 failed (1)
      Tests  6 failed | 1 passed (7)
```
(The last case was renamed afterwards to "a last year set far above the rest (+900%) reaches neither a label nor a scale".) GREEN after restore (`cmp exit 0`): `Test Files  1 passed (1)  Tests  7 passed (7)`.

**Neuter 2: `HeatmapPanels.tsx` restores `ytdWithheld={fullHistoryWithheld && r.year === lastYear}`.** RED, verbatim:

```
     × at full history: every row's YTD cell reads the dash, untoned and untitled, and the dashed count equals the year count 703ms
     × inside a range: every row's YTD cell reads the dash, untoned and untitled, and the dashed count equals the year count 1038ms
     × every cause dashes, the failed cause included 335ms
 Test Files  1 failed (1)
      Tests  3 failed | 19 passed (22)
AssertionError: the dashed YTD count equals the year count: expected <td …(3)></td> to have a length of 2 but got 1
```
GREEN after restore (`cmp exit 0`).

**Neuter 3: `FactsheetView.tsx` gates the Worst 10 note on `railAvgWithheld` (the not-zoomed scope) instead of `fullHistoryWithheld`.** RED, verbatim:

```
     × inside a range (its bands are whole-record even when zoomed): the title and one note, no subtitle, frame, bands, depth labels or crosshair; the rail table keeps its slice in a range 377ms
     × failed cause: the chart is absent, at full history and inside a range 703ms
 Test Files  1 failed (1)
      Tests  2 failed | 20 passed (22)
```
GREEN after restore (`cmp exit 0`).

**Neuter 4: `TimeSeriesChart.tsx` drops the last-index condition (`withheldRow={withheldHoverIdx >= 0 ? 0 : null}`).** RED, verbatim:

```
     × Rolling Volatility: the strategy row prints a dash at the last index and a figure at the one before 235ms
     × Rolling Sharpe: the strategy row prints a dash at the last index and a figure at the one before 295ms
     × Rolling Sortino: the strategy row prints a dash at the last index and a figure at the one before 292ms
 Test Files  1 failed (1)
      Tests  3 failed | 19 passed (22)
AssertionError: expected 'crosshair-value-withheld' to be null
```
GREEN after restore (`cmp exit 0`): `Test Files  4 passed (4)  Tests  48 passed (48)` (withheld-renderings, window-gesture, rolling-bridge, heatmap tint-contrast).

## Gates

- `npx vitest run 'src/app/factsheet/[id]/v2' src/__tests__/copy-census.test.ts src/__tests__/degrade-warning-scan.test.ts src/__tests__/figure-gate-census.test.ts --maxWorkers=3`: `Test Files  129 passed (129)  Tests  1900 passed (1900)`.
- `npx tsc --noEmit`: exit 0, no output.
- Lint chain run step by step: `eslint src/` (no `--cache`) 0 errors, 4 warnings, all pre-existing and in lines or files this plan did not touch (`nativeUnitReason`, `isRankableAnalyticsRow`, `WARNED_ROW`, `COMPUTING_ROW`); `check-admin-route-manifest`, `check-route-contract`, `check-planning-hygiene` and `check-canonical-domain` all OK.
- Acceptance greps: `heatmap-ytd-withheld` on code lines of HeatmapPanels.tsx: 1; `chart-withheld-note` in TimeSeriesChart.tsx: 1 and in DistributionPanels.tsx: 1; `crosshair-value-withheld` on code lines of TimeSeriesChart.tsx: 1.

## Pins

No pin moved, so neither `copy-census.test.ts` nor `FactsheetBody.census.test.tsx` was edited. Both passed untouched in the full run above (the new note reuses plan 03's two FH237 sentences, and no census fixture is a Withheld row).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Legend chip dashes at the last index too**
- **Found during:** Task 2
- **Issue:** The rolling chart's legend row prints each series' value at the hovered index (`deferredCrossIdx`), the same figure as the crosshair card. Dashing only the card would leave the withheld last rolling value in the DOM through the chip, which the plan's prohibition forbids ("no ... tooltip value carries it").
- **Fix:** The chip's strategy value prints `—` when the hovered index is the last index and `lastPointWithheld` is set. It carries no testid of its own (the acceptance grep pins the `crosshair-value-withheld` literal to one code line); the tests read it through the chip's text.
- **Files modified:** `TimeSeriesChart.tsx`
- **Commit:** f7bc48a6a

Otherwise: plan executed as written. Only the nine declared files (plus the new test file, which is declared) changed.

## Residue, recorded not fixed

- The per-chart Export menu on a rolling chart still downloads the visible window's CSV, which includes the last rolling value. It is a file download, not a DOM rendering, and was outside the plan's four named elements. The Worst 10 chart's export menu is removed with the chart body.
- The crosshair dot at the last index sits at the series value's height, and the line itself ends there: the hover note is the only rolling-chart surface the follow-on names.
- Test-run note: under default parallelism the factsheet directory has produced 5000 ms timeouts in plan 03's run. This run used `--maxWorkers=3` throughout and saw none.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path or schema surface; the change only withholds figures (T-237-15 mitigated: tests assert no `%` text in the EOY figure, no band rect or depth label in the Worst 10 chart, no title on the dashed YTD cell, and the dash at the last index in both the card and the legend chip).

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/FactsheetView.withheld-renderings.test.tsx` present; `DistributionPanels.tsx` contains `chart-withheld-note`; `HeatmapPanels.tsx` contains `heatmap-ytd-withheld`; `TimeSeriesChart.tsx` contains `crosshair-value-withheld`.
- Commits `2ec8f7f1b`, `f7bc48a6a` and `92a267dc3` are ancestors of HEAD.
