---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 11
subsystem: ui
tags: [factsheet, d-04, lean-05, census, chart-hint, kpi-strip, advanced-disclosure]
status: complete

requires:
  - phase: 196
    provides: "plan 01 census counter and fixtures, plan 09 MetricsColumn parts and exported headlineBenchSource, plan 10 document layout and AdvancedDisclosure"
provides:
  - "chart-hint.tsx: ChartHintContext, ChartHint, CHART_HINT_ID, CHART_HINT_TEXT"
  - "document layout: one chart hint, one small-sample warning, empty sections and an empty Advanced not rendered"
  - "KpiStrip comparatorLine prop (document layout only)"
  - "advancedSectionContent (exported): the per-section content predicates"
  - "FactsheetBody.census.test.tsx: 27 arms, SC-5 after-targets on fixtures A, B, C"
affects: [196-12, 196-13, 196-14, 196-21]

key-files:
  created:
    - src/app/factsheet/[id]/v2/chart-hint.tsx
    - src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/AdvancedDisclosure.tsx
    - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
    - src/app/factsheet/[id]/v2/HistogramChart.tsx
    - src/app/factsheet/[id]/v2/MasterBrush.tsx

key-decisions:
  - "The chart hint copy is the UI-SPEC string verbatim; the two per-chart interactions it omits are recorded as open item 2, not invented into the copy"
  - "The Advanced census hook moved from a wrapper div onto the details row itself, so the row counts once (4 sections closed, not 5)"
  - "The rolling-table repeated labels with Advanced open are pinned as an open item, not hidden and not accepted"
  - "A rail with no record is the only rail-empty case: hasRailContent is view.dates.length > 0"

requirements-completed: [LEAN-05]

actuals:
  tokens: 33000
  tasks: 3
  commits: 3
plan_head_before: afff3f94d16cbfcace00877d420877235e249268
plan_head_after: 6a2b8ab2a2833951a2a4ac3243835a2f7dec5e8a
---

# Phase 196 Plan 11: D-04 page rules and the SC-5 census Summary

In the document layout the page now carries one visible chart hint under the drawdown chart (every chart points `aria-describedby` at it), at most one small-sample warning (the strip's), no empty section and no empty Advanced, and each of the seven KPI cells prints the active comparator's value beneath it; a fixture census test (27 arms) pins the SC-5 after-targets on every CI run. The full layout (allocator mounts) is unchanged. One SC-5 target, zero repeated metrics with Advanced open, is not met: see open item 1.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | cce238ede | `chart-hint.tsx`, the three charts read the context, the document branch provides it and renders the hint, tracer arms |
| 2 | 2823fbaca | rolling suffix and cards dropped in the document layout, section content predicates, `hasRailContent`, census hook on the Advanced row, small-sample and empty-section arms |
| 3 | 6a2b8ab2a | `KpiStrip comparatorLine`, comparator-line arms, the after-target census arms |

Tracer gate: `<verify>` re-run end to end after Task 1 (12 files, 158 tests green); no `gate` attribute on the task, `HUMAN_VERIFY_MODE` default, automated-only verify, so no checkpoint.

## Task 1: the one hint

- `CHART_HINT_ID = "factsheet-chart-hint"`; `ChartHintContext` defaults to `null` (the full layout, no provider).
- `TimeSeriesChart`: context non-null means no `chart-help-*` span and `aria-describedby` points at the shared id; null renders exactly what it did. `grep -c "chart-help-"` on it stays 2 (acceptance).
- `HistogramChart`: the visible "Ctrl/Cmd + wheel to zoom" line is omitted when the context is set, and the frame gets `aria-describedby`. `MasterBrush`: its `role="img"` frame gets `aria-describedby` (it had none; it has no hint of its own).
- `FactsheetView` document branch: provider wraps the whole branch, so Advanced's charts reference the same hint. `<ChartHint />` sits after the equity pair inside `[data-census-section="equity"]`. A `-mt-10` wrapper cancels the column's `gap-10` so the hint sits at the UI-SPEC's `mt-2` under the drawdown chart; the wrapper carries `factsheet-v2-no-print` too.
- The hint carries `factsheet-v2-no-print`, `text-caption text-text-muted`, no accent.

## Task 2: predicates

Each predicate reads the same basis view its panels read (`useBasisSeriesView`), inside `DocumentAdvanced` (a component under `BasisProvider`). A panel that would draw only its own placeholder counts as absent.

| Section | Predicate (`advancedSectionContent`) | Data field read |
|---------|-------------------------------------|-----------------|
| Performance (rest charts) | has a record and returns | `dates.length > 0 && strategyReturns.length > 0` |
| Distribution | any of: a finite daily return (histogram), a yearly row (EOY bars), a correlation row (strip), a matrix label | `strategyReturns`, `strategyMetrics.yearly`, `correlations`, `correlationMatrix.labels` |
| Heatmaps | either grid has data | `monthlyReturns`, `dailyHeatmap` |
| Stress Windows | at least one evaluated window; the panel's "all N catalogued windows outside the record" line is a placeholder, so it does not count | `stressWindows.windows` |
| Returns Signatures | the section's own gate, unchanged | `signaturesSectionRenders` (comparator or native unit, and `ingestSource === "api"`) |
| Streaks | at least one streak counted | `streaks.totalWins + streaks.totalLosses` |
| Detailed metrics rail (`hasRailContent`) | there is a record | `dates.length > 0` |

`AdvancedDisclosure` takes `hasRailContent` (default true), omits "Detailed metrics" from the contents line when false, and returns null with no section and no rail. `DocumentAdvanced` returns null in the same case, before mounting anything. The contents line and the mount read one `present` record, so they cannot disagree. `FactsheetSections` takes an optional `present` (default: all six), so the full layout never hides a section.

Honesty note on Signatures: that section was kept on its existing gate. A native-unit strategy gets the section whatever the comparator, and its panels are the "withheld form with the stated reason" (164.6.6.2 D-10), which is arguably a placeholder-only section under this plan's rule. Not changed: it was an explicit earlier decision, and the plan names no predicate for it. See open item 5.

### Small-sample note family: every instance, document layout

| Instance (196-CENSUS.md family) | Where | Document layout | UI-SPEC reason |
|---------------------------------|-------|-----------------|----------------|
| `strip-figure-gate-note` | KPI strip note slot | kept (the one warning) | the page's one small-sample statement |
| `figure-gate-note` | rail Main Metrics (whole rail) | removed (plan 09: absent from `main` and `detailed`); present in the full layout | duplicate of the strip's note |
| `bootstrap-line` "resamples are drawn from N observations" | Bootstrap panel | removed (plan 09, `variant="document"`); present in the full layout | listed duplicate |
| `rolling-subtitle`, chart subtitle suffix | `PerformanceCharts` rolling charts | removed here (`documentLayout`), present in the full layout | listed duplicate |
| `rolling-subtitle`, rail Rolling Metrics table sentence | `RollingMetricsPanel` | removed (plan 09); present in the full layout | census-family member |
| `not-enough-data-card`: "Rolling Metrics — Not enough data" | `PerformanceCharts` | removed here (panel not drawn); present in the full layout | listed, "panels are simply not drawn" |
| `not-enough-data-card`: "Rolling β — Not enough data" | `PerformanceCharts` | removed here; present in the full layout | same |
| `not-enough-data-card`: "Volatility Matched — Not available" | `PerformanceCharts` | removed here; present in the full layout | same |

Kept, not in the family: `bench-figure-gate-note`, joint-floor and flat-leg reasons, the window-withheld reason, withheld markers and the strip's data-quality caveats (UI-SPEC kept list).

### Neuter evidence (Task 2)

1. Rolling suffix restored in the document layout (`FactsheetView.tsx` backed up with `cp -p`, `&& !documentLayout` removed from `rollShortDays`): `npx vitest run FactsheetBody.census.test.tsx` RED, `fixture B (a record under a year): the strip's note renders once and nothing else says so`, `AssertionError: expected 4 to be 1` (the census warning count with Advanced open). Restored with `cp -p`; `cmp` exit 0; 15 passed.
2. Heatmaps predicate forced to `true` (same backup method): 3 arms RED, `a record with no heatmap data mounts no Heatmaps section and does not name it` (`expected 'AdvancedPerformance · Distribution · …' not to contain 'Heatmaps'`), `advancedSectionContent: each predicate flips on its own field and no other`, and the no-section arm. Restored; `cmp` exit 0; 15 passed.

## Task 3: comparator line and census

`KpiStrip comparatorLine` (true only from the document branch): under each of the seven cells one `text-caption font-metric text-text-muted` line `<short name> <value>`. Source is `headlineBenchSource(payload.dataQuality, basis, selected, wv.comparators[cmpKey])`, the rail's arguments (the windowed view's block, `useBasisOrCash`, the `selected` flag). Formatters are the strip cell's own (`formatSignedPercent` 1dp for Cum. Return and CAGR, `num` for ratios, `formatUnsignedPercent` 1dp for Max DD, `pct` 1dp for Ann. Vol) and the five annualised cells go through the same gate `gv` as the strategy's cell. A withheld row has no source (`headlineBenchSource` returns null), so all seven read `—`; a non-finite value prints `—`; the line never carries a tone class or an inline colour. No comparator means no line (the `hb` read is skipped).

### SC-5 fixture census, before and after (jsdom, `countFactsheetCensus`, document layout)

Before is from 196-CENSUS.md (the fixture rows, full layout at the 196 base). After closed is Advanced closed; after open has Advanced open and its heatmaps mounted.

| Fixture | State | sections | charts | repeated metrics | small-sample warnings | visible hints | on-request rows |
|---------|-------|----------|--------|------------------|-----------------------|---------------|-----------------|
| A | before | 12 | 22 | 22 | 4 | 1 | 7 |
| A | after, closed | 4 | 2 | 0 | 0 | 1 | 0 |
| A | after, open | 16 | 22 | 3 (sharpe, sortino, volatility) | 0 | 1 | 0 |
| B | before | 12 | 22 | 20 | 7 | 1 | 7 |
| B | after, closed | 4 | 2 | 0 | 1 | 1 | 0 |
| B | after, open | 15 | 21 | 2 (sharpe, sortino) | 1 | 1 | 0 |
| C | before | 10 | 14 | 17 | 4 | 1 | 7 |
| C | after, closed | 4 | 2 | 0 | 1 | 1 | 0 |
| C | after, open | 13 | 13 | 2 (sharpe, sortino) | 1 | 1 | 0 |

Targets: opening view 3 blocks + Advanced row (4 sections) met; 2 charts closed met; repeated 0 closed met, **open not met** (open item 1); warnings at most 1 met; 1 hint met; 0 on-request met. Charts differ between B open (21) and A open (22) because a 200-day record's rolling beta or window-gated charts follow the rolling gates.

Census arms: per fixture, closed (sections = 4, charts = 2, masterBrush = 1, labels contain start date / var 95% / sharpe / max drawdown as the positive control, repeated = 0, warnings <= 1, hints = 1, on-request = 0) and open (charts >= 6 as the positive control that Advanced contents are counted, hints = 1, on-request = 0, warnings <= 1, repeated pinned).

### Neuter evidence (Task 3)

1. A second `<ChartHint />` rendered inside Advanced (backup `cp -p`): 4 arms RED, `renders one visible hint under the drawdown chart, with the UI-SPEC copy` (`expected …(2) to have a length of 1 but got 2`) and the open census arm for A, B and C (`expected 2 to be 1`, on `visibleChartHints`). Restored; `cmp` exit 0; 27 passed.
2. The annualisation gate dropped from the comparator's Sharpe line (`gv(hb?.sharpe)` to `hb?.sharpe`): RED, `withholds the annualised comparator figures with the strategy's own gate (fixture C, comparator on)` (`cell 2: strategy withheld, comparator must be too: expected '2.31' to be '—'`). Restored; `cmp` exit 0; 27 passed.

Comparator-line oracle is independent arithmetic on `payload.comparators.btc.summary` (`toFixed`, sign by value), plus a cross-check against the full layout's rail Sharpe benchmark cell (same string).

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2" "src/app/(dashboard)/allocations"`: 297 files, 4731 tests passed (allocator mounts unchanged).
- Plan verify (Task 1): `FactsheetBody`, `charts.signed-zero`, `ResponsiveChartFrame`: 12 files, 158 tests passed. Task 3 verify: census + `FactsheetView.kpistrip.test.tsx` green.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 2 warnings, both pre-existing (`nativeUnitReason` in MetricsColumn.tsx, `isRankableAnalyticsRow` in composite-read-path.ts); trailing checks OK.
- Acceptance: `ChartHintContext` in TimeSeriesChart, HistogramChart, MasterBrush each >= 1; `chart-help-` in TimeSeriesChart 2; `headlineBenchSource` in FactsheetView.tsx 3 (import, comment, use; HEAD 0).
- Wider sweep (`src/__tests__`, `tests/visual`, `scripts/factsheet-census`, `src/app/factsheet`, `src/components/strategy`): 405 files, 8001 tests passed, 273 skipped (pre-existing skips), 1 failed: `verify-plan-anchors.test.ts` "--pending exits 0", the known noise (red until every SUMMARY exists).

## Deviations from Plan

**1. [Rule 1 - Bug] Census hook on the Advanced row, not a wrapper.** Plan 10 put `data-census-section="advanced"` on a wrapper div around `details#factsheet-advanced`; the counter dedupes by element, so the wrapper and the details counted as two sections and the opening view measured 5 sections against the target of 3 blocks + the Advanced row (4). The hook now sits on the `details` itself (`AdvancedDisclosure.tsx`), the wrapper is gone, and the closed count is 4 on all three fixtures. No test referenced the wrapper (the one grep hit asserts absence in `printView`).

**2. [Rule 3] `advancedSectionContent` is exported** so the per-section predicates can be tested directly (Performance and Distribution cannot be emptied through a rendered payload without breaking the page). Not used outside tests and `FactsheetView.tsx`.

**3. Task 1 files: `FactsheetView.tsx` carries more than the hint** (the `DocumentAdvanced` component, the `present` record). All inside the plan's `files_modified`.

**4. [Rule 4-adjacent, recorded not decided] Chart hint copy vs the per-chart texts.** The plan says to STOP if a per-chart text states an interaction the UI-SPEC copy omits. Two differences exist (open item 2). The orchestrator brief for this run said to record rather than decide, so the UI-SPEC copy is used verbatim and the gap is booked below.

## Open items (not resolved here, owner named)

1. **Repeated metrics with Advanced open: A 3 (sharpe, sortino, volatility), B 2 (sharpe, sortino), C 2 (sharpe, sortino).** The SC-5 target is 0 and the plan's must-have says "0 repeated metrics closed and open". Cause is 196-09's open item 1: the Rolling Metrics tables (6mo and, on a year-long record, 1y) list Volatility, Sharpe and Sortino, repeating each other and the strip's Sharpe and Sortino. It needs a planner or founder call (relabel the rolling rows, merge the two tables, or exempt rolling rows in the counter); plan 21's census-after will report `repeated > 0` until then. The census test pins the exact sets in an arm that goes RED the day it is fixed, with an instruction to set it to `[]`.
2. **Hint copy parity (prohibition: do not drop a described interaction).** Per-chart sr-only text said "Home or zero resets" and "the wheel alone scrolls the page"; the UI-SPEC copy says "Home resets" and omits the plain-wheel statement. The chart code also resets on `0` and `Escape` (code, not copy). A screen-reader user told only "Home resets" loses the `0` alias, and nothing says a plain wheel scrolls the page. The histogram's "double-click to reset" is kept. UI-SPEC copy is a designer decision; propose adding "Home, 0 or Escape resets" if parity is to be literal.
3. **BASIS eyebrow twice (from 196-10).** `part="detailed"` still renders the BASIS eyebrow wrapper, so on a composite or MTM strategy with Advanced open the eyebrow shows once above Main metrics and once above Detailed metrics. Not changed (design call); plan 14 or the founder may drop it from `detailed`.
4. **`maxDdSpan` wording (from 196-09 item 2).** The Risk group's kept note still names "Max Drawdown", which lives in the strip now. Not changed.
5. **Signatures for a native-unit strategy** renders its section with withheld-form panels (an earlier phase's decision, D-10), which the "empty sections hidden" rule could be read to cover. Kept on its own gate; booked for a planner.
6. Style Drift table rows are invisible to the census (196-09 open item 3); unchanged, `BatchDPanels.tsx` is outside this plan.

## Not measured

- No browser pass: the hint's visual offset (the `-mt-10` wrapper against the column's `gap-10`), the strip line's wrapping at 390 px and the print rendering were not looked at. jsdom does not mount the signatures section, so signatures predicates were verified by the gate only.
- No e2e spec run. The golden `full-page-*` images change with the layout (plan 10's note stands) and the strip lines add height to the opening view.
- No PROD access. Production census numbers belong to plan 21.

## Known Stubs

None.

## Threat Flags

None. T-196-25 (comparator figure integrity): values come from the exported `headlineBenchSource` with the rail's arguments and the strip cell's formatter and gate; arms cover finite, non-finite, withheld-row and gated-annualised cases and a cross-check against the rail. T-196-26 (silent omission): predicates are listed above with their fields, and the open census arm proves Advanced still holds 13 to 22 charts.

## Self-Check: PASSED

- Created files found: `chart-hint.tsx`, `FactsheetBody.census.test.tsx`.
- Commits cce238ede, 2823fbaca, 6a2b8ab2a are ancestors of HEAD; `git rev-list --count afff3f94d..HEAD` is 3 before this SUMMARY commit.
