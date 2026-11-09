---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 09
subsystem: ui
tags: [factsheet, metrics-rail, d-04, lean-05, census]
status: complete

requires:
  - phase: 196
    provides: plan 01's census counter (countFactsheetCensus) and the censusPayloadA/B/C fixtures
provides:
  - MetricsColumn part prop (all | main | detailed)
  - variant prop (full | document) on BootstrapCIPanel, TermsPanel, ExtendedMetricsPanel, BenchmarkMetricsBody and RollingMetricsPanel
  - exported headlineBenchSource
  - MetricsColumn.parts.test.tsx (29 arms)
affects: [196-10, 196-11, 196-21]

key-files:
  created:
    - src/app/factsheet/[id]/v2/MetricsColumn.parts.test.tsx
  modified:
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
    - src/app/factsheet/[id]/v2/MandatePanels.tsx

key-decisions:
  - "Group sub-headings in the Main metrics panel reuse the Terms panel's h4 sub-heading style; no new visual token"
  - "The detailed part drops the rolling table's short-window sentence (a census-family warning) and keeps a withheld window's reason"
  - "Bootstrap keeps its footer line (resample count, dropped-resample note); only the low-N sentence 'Bootstrap resamples are drawn from N observations' goes"
  - "The Style section is omitted from the detailed part when there is no style drift and no scenario panels"

requirements-completed: [LEAN-05]

actuals:
  tokens: 14000
  tasks: 3
  commits: 3
plan_head_before: aab9f6a1abc16d008aea11e447054698e1767686
plan_head_after: 78d502797094b3a35733f43fdd063767893a9bc8
---

# Phase 196 Plan 09: Metrics rail halves Summary

`MetricsColumn` now renders in three forms: the whole rail (default, byte-identical to HEAD), `part="main"` (the one Main metrics table with Record, Returns and Risk groups) and `part="detailed"` (a "Detailed metrics" heading, then the rest of the rail with every moved metric removed), so plan 10 can mount the opening view and the Advanced rail without printing any metric twice.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 75abbced6 | `part` prop, `part="main"`, exported `headlineBenchSource`, parts test for default identity and the main table |
| 2 | 792b1971a | `part="detailed"`, `variant="document"` on four panels, detailed-part arms, census zero-repeat arm |
| 3 | 78d502797 | note classification, rolling short-window sentence dropped from detailed, per-note arms |

## Prop signatures plans 10 and 11 consume

```ts
export type MetricsPart = "all" | "main" | "detailed";
export function MetricsColumn(props: { scenarioMode?: boolean; part?: MetricsPart }): JSX.Element; // part defaults to "all"
export function headlineBenchSource(
  dataQuality: FactsheetPayload["dataQuality"], basis: Basis, selected: boolean, block: ComparatorBlock,
): ComparatorSummary | null;
export function BootstrapCIPanel(props: { wholeRecordWithheld: boolean; figureState?: FigureState; variant?: "full" | "document" });
export function TermsPanel(props: { variant?: "full" | "document" });
// internal to MetricsColumn.tsx, set by part="detailed": ExtendedMetricsPanel, BenchmarkMetricsBody, RollingMetricsPanel { variant?: "full" | "document" }
```

Markup contract: `part="main"` renders `<aside>` with `RangeEyebrow` (`data-testid="range-eyebrow-rail"`) and one `Panel` titled `Main metrics`; `part="detailed"` renders `<aside>` whose first child is a `<header>` with an `h3` reading `Detailed metrics`. Neither carries `data-census-section`; plan 10 puts the hook on the wrapper it owns (the Main metrics panel needs it).

## Behavior as built

- Main metrics: Record (Start Date, End Date, Years Observed), Returns (month row, Year-to-date, 3 Month, 6 Month, 1 Year, 3 Year, 5 Year, Win Rate (days), Profit Factor), Risk (Longest DD (days), VaR 95%, CVaR 95%, Avg Win, Avg Loss, Skew, Kurtosis (excess)), `VAR_METHOD_LINE` once under Risk. Every row uses the same `gv`/`wr` wrappers, formatters and visibility rule as the whole rail (trailing rows hide while a range is selected with `window-trailing-note`; 6 Month / 1 Year follow the record's length; 3 Year / 5 Year only when non-null, and only at full history as before).
- Detailed: Strategy Thesis, Performance (EOY Returns, Rolling Metrics), Risk (Bootstrap CI-only, Best / Worst, Calmar by Year, Worst 10 Drawdowns, Extended Metrics minus the moved rows), Style (omitted when no style drift), Terms (no fee rows, no Observation start/end, memorandum sentence kept), Benchmark (no Alpha, no Information Ratio).
- T-196-20: an arm renders A, B, C and a withheld-headline payload and asserts every main row's value and benchmark cell equals a cell the whole rail prints; a second arm asserts every whole-record figure reads `—` on a withheld row.

## Note classification (Task 3)

Notes in `MetricsColumn.tsx` (and the panels the detailed part mounts), classified against UI-SPEC "One small-sample warning":

| Note | Where | Decision | Reason |
|------|-------|----------|--------|
| `figure-gate-note` | rail Main Metrics (whole rail only) | dropped in main, absent from detailed | the KPI strip's note is the page's one small-sample statement; arm: absent from both parts |
| `bench-figure-gate-note` | Main metrics | kept in main | comparator-specific (its own span), not a page small-sample warning; arm present on B |
| span note (`headlineCoverageNote` "main" slot / `windowCoverageNote`) | Main metrics, top | kept in main | data coverage: which span the figures cover; flagged assumption in the plan |
| `window-trailing-note` | Returns group | kept in main | explains hidden rows under a selected range |
| returns coverage note (`returnsSpan`) | Returns group | kept in main | data coverage (Win Rate and Profit Factor cover the whole record) |
| `maxDdSpan` | Risk group | kept in main | it is the only statement that Longest DD, VaR, CVaR, Avg Win and Avg Loss cover the whole record. Its wording still names "Max Drawdown", which now lives in the strip; see open item 2 |
| `var-method-line` | Risk group | kept in main (once); dropped from Extended Metrics in detailed | VaR and CVaR left Extended, the line went with them; arm: exactly one across both parts |
| `RangeEyebrow` label | top of main | kept | data eyebrow, 193 D-03 |
| `rolling-annualization-note`, short variant ("annualized from a N-day window, under one year") | Rolling Metrics | dropped from detailed (`variant="document"`) | a `rolling-subtitle` member of the census family; arm: absent from both parts, present in the whole rail |
| `rolling-annualization-note`, withheld variant ("appear once the record reaches 90 days") | Rolling Metrics | kept in detailed | a per-figure withheld reason, not a small-sample warning; arm on fixture C |
| Bootstrap "resamples are drawn from N observations" | Bootstrap | dropped from detailed | UI-SPEC lists it as a duplicate of the strip's note; arm: absent from both parts |
| Bootstrap footer ("N stationary block-bootstrap resamples ... dropped-resample note") | Bootstrap | kept in detailed | method statement and the SFH-R2-M2 dropped-resample disclosure; not a small-sample warning |
| `joint-floor-reason`, `joint-flat-leg-reason`, `joint-annualization-note` | Benchmark | kept in detailed | comparator-specific (UI-SPEC kept list); arm on B for the overlap note |
| EOY comparator partial-year note | EOY Returns | kept in detailed | data coverage |
| Calmar-by-year partial-years note, Strategy Thesis footnote, Terms memorandum sentence, KS drift line, scope-note chip | detailed | kept | not small-sample statements |
| Cumulative Return Metrics span note | not rendered in either part | n/a | its panel has no rows left; the Returns group's coverage note speaks for the same rows |

Not touched because the files are outside this plan's `files_modified` (flagged, see open item 3): `style-drift-figure-gate-note` ("Half-record figures are annualized from N days, under one year") and the "One or both halves have < 126 obs" line in `BatchDPanels.tsx`. Both read as small-sample statements but are not members of the census counter's family.

## Neuter evidence (RED once, restore, GREEN)

1. Repeat metric. `cp -p MetricsColumn.tsx` to a backup, added `<Row label="Sharpe" .../>` back into the main part's Risk group, ran the parts test: 7 arms RED, including `has the three groups ...` (extra "Sharpe"), `prints none of the figures the KPI strip owns` (`expected [ 'sharpe' ] to deeply equal []`) and `the census finds no repeated metric label` for A, B and C (`expected [ 'sharpe' ] to deeply equal []`). Restored with `cp -p`; `cmp` exit 0; 29 passed.
2. On-request row. `cp -p MandatePanels.tsx` to a backup, made the document variant render one `Lockup` row reading the on-request placeholder, ran the parts test: 4 arms RED (`Terms drops the on-request rows ...` with `expected '...' not to contain 'on request'`, and the census arm for A, B and C with `expected 1 to be +0` on `onRequestRows`). Restored with `cp -p`; `cmp` exit 0; 29 passed.

## Verification

- `npx vitest run "src/app/factsheet/[id]/v2"`: 112 files, 1462 tests passed (whole factsheet folder, proving the default path is untouched).
- HEAD identity, measured once and not committed: the HEAD copies of the three source files were loaded as `*.headcopy.tsx` beside the new ones and `MetricsColumn` was rendered from both over fixtures A, B and C with `scenarioMode` false and true: 6 of 6 `innerHTML` equal (each over 5,000 characters). The copies were deleted afterwards.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors; 2 warnings, both pre-existing (`nativeUnitReason` in MetricsColumn.tsx, `isRankableAnalyticsRow` in composite-read-path.ts).
- Acceptance greps: `title="Main metrics"` 1; `export function headlineBenchSource` 1; `Detailed metrics` 1; `— on request` in MandatePanels.tsx 7.
- No pre-existing `MetricsColumn.*.test.tsx` was edited.

## Deviations from Plan

**1. [Rule 2 - correctness against UI-SPEC] Rolling table short-window sentence dropped from the detailed part.** Found in Task 3: the plan-01 counter counts the Rolling Metrics table's "annualized from a N-day window, under one year" line as a `rolling-subtitle` warning, and it prints on every record, including a two-year one (the 6mo window is always under a year). Left in, SC-5's "at most one small-sample warning" cannot hold. Added `variant` to `RollingMetricsPanel` (default `full`, unchanged). Commit 78d502797.

**2. [Rule 3] Test timeout raised for the parts file.** Several arms render the whole rail repeatedly; on a loaded machine (seven parallel executors) they hit vitest's 5 s default. `vi.setConfig({ testTimeout: 60_000 })` in the file only. Two pre-existing files (`figure-gate`, `headline-bench`) also timed out once under that load and passed on re-run; they were not edited.

**3. Task commits.** Tasks 1 and 2 share files. Task 1's commit was built by temporarily reverting the Task 2 pieces from backups, so each commit passes on its own.

## Open items (not resolved here, owner named)

1. **Rolling Metrics repeats three labels on a year-long record.** "Rolling Metrics (6mo)" and "Rolling Metrics (1y)" both list Volatility, Sharpe and Sortino, and the census counts a label once per table. The plan and UI-SPEC keep Rolling Metrics in the detailed part, so this plan merges and relabels nothing. The parts test pins the finding (`pinned open item` arm: A repeats `sharpe`, `sortino`, `volatility`; B and C repeat nothing) and sets the 1y table aside in the zero-repeat arm. Separately, at page level the strip's Sharpe and Sortino will also repeat against the rolling rows' labels. Plan 21's census-after run will report `repeated > 0` until someone decides: relabel the rolling rows, merge the two tables, or exempt rolling rows in the counter. Needs a planner or founder call; when it is made the pinned arm goes red and must be updated.
2. **`maxDdSpan` wording.** The kept Risk-group note says "Max Drawdown covers only that span; the other figures in this panel cover the whole record", but Max Drawdown is in the strip now. Plan 11 or 14 may want a Risk-group variant of the sentence; the dated-record case only.
3. **Style Drift table is invisible to the census.** Its rows (Sharpe, Sortino, Ann. Volatility, Skew, Kurtosis, Max Drawdown per half) sit in a `text-fixed-11` table the counter's `text-fixed-12` selector does not read, so the "zero repeats" result does not cover them. They are first-half/second-half figures, arguably not repeats of the headline ones, but the counter cannot say so either way. `BatchDPanels.tsx` was outside this plan's files.
4. UI-SPEC says the Main metrics header carries `Strategy` plus the comparator column; the existing `Panel` has no per-column `Strategy` header and none was added (the dated `vs <comparator>` header is there). Plan 10 may add it if the founder wants the label.

## Known Stubs

None.

## Threat Flags

None. Rows were moved or removed; no endpoint, auth path or schema was added. T-196-20 is covered by the cell-equality and withheld arms.

## Not measured

No PROD database or browser pass was done; the fixture census runs in jsdom, which does not mount the signatures section. `gsd_run windows append` was not available in this worktree shell, so open items 1 to 3 are recorded here rather than in `.planning/WINDOWS.md`; the orchestrator may ledger them.

## Self-Check: PASSED

- Created: `src/app/factsheet/[id]/v2/MetricsColumn.parts.test.tsx` found.
- Commits found as ancestors of HEAD: 75abbced6, 792b1971a, 78d502797.
