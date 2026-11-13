---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 14
subsystem: lean-deletion
tags: [dead-code, orphan-sweep, census, lean]
requires: ["196-01", "196-02", "196-03", "196-04", "196-05", "196-06", "196-07", "196-08", "196-09", "196-10", "196-11", "196-12", "196-13", "196-15", "196-16", "196-17", "196-18", "196-19", "196-20"]
provides:
  - "the retired v2 shell, its two D-06 panels, every shell-only component and four shell-only libraries plus BookIntroCall are gone, with their tests"
affects: [196-21]
tech-stack:
  added: []
  patterns: ["a scan-test row moves in the same commit as the file it lists", "orphan sweep decided by non-test importers, never by knip's default mode"]
key-files:
  created: []
  modified:
    - src/components/layout/DashboardChrome.test.tsx
    - src/__tests__/display-sign-single-source.test.ts
    - src/__tests__/figure-gate-census.test.ts
    - src/components/charts/charts.signed-zero.test.tsx
    - tests/a11y/chart-contrast.test.ts
    - tests/visual/chart-accessibility-layer.test.ts
    - .env.example
    - src/lib/queries.ts
    - src/lib/types.ts
    - src/lib/factsheet/build-payload.ts
    - src/lib/queries.test.ts
  deleted:
    - "74 paths, every one declared in this plan's files_deleted (lists below)"
key-decisions:
  - "getStrategyDetailV2, fetchStrategyLazyMetrics, getStrategyDetail and getPublicStrategyDetail are removed (no non-test importer); the orchestrator declared the two extra test files that only exercised them (699b93e12)"
  - "the manager-redaction and trades_fetched_at pins moved onto getFactsheetDetail, the one detail reader left"
  - "NEXT_PUBLIC_SCHEDULING_URL leaves .env.example with BookIntroCall, its only reader"
requirements-completed: [LEAN-02]
status: complete
commits: 6
plan_head_before: b1631272e75ca7381a9bd54a0f9bfc160727625c
plan_head_after: 0f3e2929f4c5b591ff60edaad5320dc607955ef1
actuals:
  tokens: 148000
  tasks: 3
  commits: 6
---

# Phase 196 Plan 14: Delete the retired v2 shell and its orphans Summary

The v2 shell, both D-06 panels, ten charts, the shell-only panels and helpers, five library modules and the four query readers they orphaned (`getStrategyDetailV2`, `fetchStrategyLazyMetrics`, `getStrategyDetail`, `getPublicStrategyDetail`) are gone with their tests: 74 declared paths. The first pass stopped short of the readers because removing them needed two test deletions the plan had not declared (R1); the orchestrator declared them (699b93e12) and the second pass finished the job.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 1921b9eea | StrategyV2Shell, TradeAndPositionPanel, TradeMixSubPanel, ExposureAndGreeksPanel and tests; two `tests/visual/strategy-v2-*` gates; `lazy-panel-fetch-failure.test.tsx`; the panel arm of `CorrelationWithBenchmark.reason.test.tsx`; scan rows |
| 2 | 442b734e0 | the other 7 strategy-v2 panels/helpers (Drawdown, HeadlineMetrics, Overview, ReturnsDistribution, RollingMetrics, BenchmarkGreeksTable, MetricCell, format, panel7-series) and ten charts, with tests; scan rows; the 196 REDIRECTED census closure |
| 3 | 8c46e330c | `useLazyPanelMetrics`, `queries-client`, `benchmark-why`, `drawdown-math`, `BookIntroCall` with tests; `.env.example` entry |
| 4 (export half of 3) | 0f3e2929f | the four query readers, `StrategyV2*` types and constants, `LazyMetricsPanelKindMap` and validators, `LazyMetricsPanelId`; the two newly declared tests, `queries.v2-*` and the four `v2-joint*` files; the test-arm edits below |

`commits: 6` is the measured count from the ledger and includes the orchestrator's plan-amendment commit 699b93e12 and the first SUMMARY commit 282b5bcc6.

## D-06: what the two dropped panels showed (for plan 21's TODOS entry and the ship notes)

- **Trades & positions** showed the strategy's trade counts (total, long, short, wins, losses, win rate), position counts (open, closed, average duration), the risk-reward profile (R:R, weighted R:R, profit factor, payoff ratio, long/short profit factor, expectancy, SQN), volume metrics (gross volume, mean trade size, daily and monthly turnover), and a Trade mix sub-panel (long and short maker/taker buckets and entry counts).
- **Exposure & benchmark greeks** showed the net and gross exposure chart, the turnover chart, the benchmark greeks table (alpha, beta, information ratio, Treynor) and the 90-day rolling correlation with BTC chart, each with a say-why line when its series was absent.

## Declared deletions

`git diff --name-only --diff-filter=D b1631272e..HEAD` lists 74 paths and every one is in `files_deleted` as amended by 699b93e12 (72 original + `queries.hh-1255.test.ts` and `queries.hh-0495.test.ts`; checked by script). Nothing declared was left behind.

## Orphan table (non-test modules; "last importer" is what was deleted in this phase)

| File | Last importer before this plan | Result | Reason |
|------|--------------------------------|--------|--------|
| strategy-v2/StrategyV2Shell | the retired strategy route trees (plans 17, 18) | deleted | no importer |
| strategy-v2/TradeAndPositionPanel, TradeMixSubPanel, ExposureAndGreeksPanel | StrategyV2Shell | deleted | D-06 |
| strategy-v2/DrawdownPanel, HeadlineMetricsPanel, OverviewPanel, ReturnsDistributionPanel, RollingMetricsPanel | StrategyV2Shell | deleted | shell-only |
| strategy-v2/BenchmarkGreeksTable, MetricCell, panel7-series | the panels above | deleted | panel-only |
| strategy-v2/format.ts | the panels above | deleted | the `./format` in `src/app/factsheet/[id]/v2/` is a different file (verified: it has its own `format.ts`); zero imports of `strategy-v2/format` remain |
| strategy-v2/SegmentedControl, PartialDataBanner | FactsheetView, rolling-window-choice, ScenarioComposer, StressVarSection, WeightOptimizerSection | KEPT | live non-test importers |
| charts/CorrelationWithBenchmark, DailyHeatmap, MonthlyHeatmap, YearlyReturns, WorstDrawdowns, EquityCurve, DrawdownChart, NetGrossExposureChart, TurnoverChart, RollingAlphaBetaChart | the panels above | deleted | zero non-test importers. `allocations/widgets/performance/DrawdownChart.tsx` is a different, live file and its tests were not touched |
| hooks/useLazyPanelMetrics | the panels above | deleted | `src/test-setup.ts` mention is a comment |
| lib/queries-client | useLazyPanelMetrics (dynamic import) | deleted | |
| lib/benchmark-why | none (type-imports `v2-joint`) | deleted | no importer |
| lib/drawdown-math | none | deleted | `portfolio-stats.ts` mention is a comment |
| strategy/BookIntroCall | none | deleted | no importer at all; its only reader of `NEXT_PUBLIC_SCHEDULING_URL` |
| lib/factsheet/v2-joint | queries.ts (`getStrategyDetailV2`) | deleted (pass 2) | its one importer went with `getStrategyDetailV2`; `build-payload.normalizeDailyReturns` was exported only for it and is module-private again |

## Removed exports (all had zero non-test importers: grep -w over src, scripts, e2e hit only comments and tests)

- `src/lib/queries.ts`: `getStrategyDetailV2`, `StrategyV2Detail`, `StrategyV2ProjectedColumns`, `STRATEGY_V2_STRATEGY_COLUMNS`, `STRATEGY_V2_ANALYTICS_COLUMNS`; `fetchStrategyLazyMetrics`, `LazyMetricsPanelKindMap`, its compile-time assertions and `EXPECTED_LAZY_METRICS_KINDS_BY_PANEL`, the `LazyMetricsPanelId` re-export; `getPublicStrategyDetail`; `getStrategyDetail` and `STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS`; the now-unused imports (`v2-joint`, `LazyMetricsPayload`, `LazyMetricsPanelId`, `TradeMetrics`, `AnalyticsDataQualityFlags`, `isComputedAnalytics`). `grep -a -c getStrategyDetailV2 src/lib/queries.ts` is 0 (HEAD 11): acceptance criterion met.
- `src/lib/types.ts`: `LazyMetricsPanelId` (its only users were the deleted fetchers). `LazyMetricsPayload` stays: `types-design-tests.test.ts` and a `self-referential-oracle` allowlist entry still pin it (residual R5).
- Kept as the plan said: `getFactsheetDetail`, `getPercentiles`, `PUBLIC_ANALYTICS_COLUMNS`, `failAnonRead`, `loadManagerIdentity`, `readPublicVerificationSignals` (all have live callers).
- T-196-47 for the phase security review: `getStrategyDetail` and `getPublicStrategyDetail` were the manager-identity redaction readers. No caller remains, so no surface lost its redaction. `getFactsheetDetail` (the tearsheet reader) applies the same `loadManagerIdentity` tier gate and is untouched; its redaction is now pinned by the arms moved into `queries.test.ts` (below), and shown RED by neutering the `disclosureTier !== "institutional"` guard.

## Knip new-entry table (current reading vs `## pre-phase` of 196-KNIP-BASELINE.txt; the file was not touched)

Pre-phase: 45 unused files, 70 unused-export lines. Now: 46 and 73. Every pre-phase entry is still present and unchanged. Entries not in the baseline:

| New entry | Disposition |
|-----------|-------------|
| `scripts/factsheet-census/run.ts` (unused file) | KEPT. Created by plan 01 (census script); not from this plan's deletions. Plan 21 owns the census and its wiring |
| `src/app/factsheet/[id]/trade-fetch-lines.tsx: TradeFetchUnavailableLine` | KEPT, residual R2. Orphaned by plan 15/17; the file is not declared here. Only a comment in `FactsheetView.reconstructed-range.test.tsx` mentions it |
| `src/components/charts/chart-tokens.ts: CHART_SURFACE, CHART_TRACK, CHART_NEUTRAL, CHART_POSITIVE_100/300/700/800, CHART_NEGATIVE_100/300/700/800, CHART_TEXT_ON_LIGHT_POSITIVE, CHART_TEXT_ON_LIGHT_NEGATIVE` | KEPT, residual R3. Last readers were the deleted charts; the file is not declared here and is pinned by token-drift tests |
| `src/lib/min-history.ts: CORRELATION_90D_MIN_DAYS, BENCHMARK_ROLLING_WINDOW_DAYS, WORST_DRAWDOWNS_MIN_DAYS` | KEPT, residual R4. Last readers were the deleted panels and charts; the file is not declared here |

## Residual list for plan 21 (orphans left, none deleted undeclared)

- **R1 (closed).** The export removal waited on two undeclared test deletions; the orchestrator declared them and pass 2 removed the exports and every arm that exercised them (moved-test table).
- R2 `TradeFetchUnavailableLine` and the `fixed-10` size in `trade-fetch-lines.tsx` (plan 15/17 note): still present, not declared.
- R3 the unused `chart-tokens.ts` exports above. R4 the unused `min-history.ts` constants above. R5 `LazyMetricsPayload` in `types.ts` (type-only, pinned by a test, no production user) and its `self-referential-oracle` allowlist entry.
- `readRecordSpan` (plan 13's candidate) was not in this plan's `files_deleted`; knip does not list it, so it was left alone.
- `.planning/codebase/STACK.md` and `INTEGRATIONS.md` still describe `BookIntroCall` and `NEXT_PUBLIC_SCHEDULING_URL`. They are generated maps, not touched here.
- `src/test-setup.ts`'s IntersectionObserver stub comment still names `useLazyPanelMetrics` (comment-only, left as the plan said).

## Moved-test table

| Test | Change |
|------|--------|
| `src/components/layout/DashboardChrome.test.tsx` | `ALLOWED` row for `StrategyV2Shell.tsx` removed; `PartialDataBanner`, `ViewerBar` and `VisitorHeader` rows kept |
| `src/__tests__/display-sign-single-source.test.ts` | file-list rows for TradeAndPositionPanel, HeadlineMetricsPanel and 7 charts removed; per-file map rows for TradeAndPositionPanel, TurnoverChart and WorstDrawdowns removed; `SCAN_DIRS` still lists `src/components/strategy-v2` (two live files remain) |
| `src/components/charts/charts.signed-zero.test.tsx` | 7 describes removed (Monthly/DailyHeatmap, DrawdownChart, EquityCurve, YearlyReturns, RollingAlphaBetaChart, CorrelationWithBenchmark); arms 22 -> 5 (17 removed); the 5 live arms (ReturnQuantiles, ReturnHistogram x2, RollingSortinoChart, RollingMetrics) are byte-unchanged; unused `afterEach` import dropped |
| `tests/a11y/chart-contrast.test.ts` | 4 of the 6 Phase 14b chart rows removed, count pin 6 -> 2; V2_DIR walker kept (SegmentedControl and PartialDataBanner remain) |
| `tests/visual/chart-accessibility-layer.test.ts` | breadth floor 18 -> 14 (the live recharts file count measured 15 after the deletions); comment dated |
| `src/__tests__/figure-gate-census.test.ts` | the five `REDIRECTED` rows removed across Tasks 1 and 2 (ExposureAndGreeksPanel and StrategyV2Shell in Task 1; HeadlineMetricsPanel, RollingMetricsPanel, BenchmarkGreeksTable in Task 2), then the `REDIRECTED` constant, its reason pattern, the "196-redirected files" test and the header paragraph. Closes TODOS `194.1-CENSUS-196-STALE-EXCLUSIONS` for plan 21's TODOS edit. No kept file needed re-classifying |
| `src/lib/queries.test.ts` | removed 7 describes (`getStrategyDetail` x3, `getPublicStrategyDetail` redaction, `fetchStrategyLazyMetrics` RPC consumer, `getStrategyDetailV2` x2), the `v2-joint` mock and its reset. MOVED: the manager-redaction pair (exploratory reads no `profiles`; institutional reads it through the admin client) now runs against `getFactsheetDetail`, and the `trades_fetched_at` projection pin now targets `getFactsheetDetail`; both shown RED (guard neutered; column renamed) and restored. Tests 151 pass |
| `src/lib/queries.stale-analytics-detail.test.ts` | groups A (`getPublicStrategyDetail`) and C (`getStrategyDetail`) removed; B (`getFactsheetDetail`) and D (`shapeRowAnalytics`, the shared shaper) kept: 18 pass |
| `src/lib/queries.public-verification.test.ts` | the `getStrategyDetail` class-closure describe (2 arms) removed; the 6 `readPublicVerificationSignals` arms kept. `getFactsheetDetail` does not project `trust_tier`, so there was nothing to retarget |
| `src/lib/queries.anon-read-errors.test.ts` | `getPublicStrategyDetail` describe (3 arms) removed; the `getFactsheetDetail` and `getStrategiesByCategory` arms already cover the same 42501 / PGRST116 / non-UUID contract |
| `src/lib/anon-strategies-projection.test.ts` | `ANON_READERS` 3 -> 2 (a missing function still fails: the `functionBody === null` arm is unchanged) |
| `src/lib/anon-strategies-live-probe.test.ts` | arms (d) and (g) removed (live-probe arms, skipped without the probe secret) |
| `src/app/browse/breadcrumb-root.test.tsx`, `disclaimer-once.test.tsx` | the dead `getPublicStrategyDetail` mock factory entry, import and `mockResolvedValue` seed removed (the category page never called it) |
| `src/components/charts/CorrelationWithBenchmark.reason.test.tsx` | Task 1 removed the `ExposureAndGreeksPanel Correlation with BTC (v2)` describe (5 arms: the 240px say-why block at 72 days, the 2-point chart plus caption, the benchmark-unavailable cause, the parsed native-unit flag, the say-why block being neither focusable nor live) and its mocks; the 8 resolver arms stayed until Task 2 deleted the file with the chart. The resolver and its ladder have no remaining caller |

Gates that disappeared with their subjects (not moved): `tests/visual/strategy-v2-panel-count.test.tsx` (counted the shell's panels) and `tests/visual/strategy-v2-type-scale.test.ts` (DESIGN-02 type-scale lint over the whole `strategy-v2` directory; the two remaining files there, SegmentedControl and PartialDataBanner, are no longer under that lint).

## RED evidence for the gates I moved

Each neutered from a `cp` backup, run, restored with `cp`, `cmp` identical, rerun GREEN:

- `chart-contrast.test.ts`: added a third path to the Phase 14b list -> RED `expected 3 to be 2`.
- `chart-accessibility-layer.test.ts`: floor raised to 16 -> RED `expected 15 to be greater than or equal to 16`.
- `figure-gate-census.test.ts`: planted `src/components/strategy-v2/StrategyV2Shell.tsx` back into `EXCLUDED` -> RED `stale: EXCLUDED key src/components/strategy-v2/StrategyV2Shell.tsx names a file the walk does not find`.
- Restored files rerun: 3 files, 17 tests passed.

## Verification (after each task)

- Task 1: `npx tsc --noEmit` clean after removing `lazy-panel-fetch-failure.test.tsx` (it imported the deleted panel; its other arm drove RollingMetricsPanel, deleted in Task 2). Full `npx vitest run src scripts tests`: 2 failed files, all known noise (`compute.conventions` skew snapshots x2, `verify-plan-anchors` `--pending`).
- Task 2: tsc clean. Full vitest: new reds were `chart-accessibility-layer` (breadth floor, fixed) and `return-stats.single-source` (5000 ms timeout on a whole-tree scan under full load; passes alone, 36 tests with the other file); the rest known noise.
- Task 3: tsc clean. Full vitest: `env-manifest` went red (`NEXT_PUBLIC_SCHEDULING_URL` read nowhere once BookIntroCall was deleted); fixed by removing the entry; the rest known noise (`compute.conventions` x2, `verify-plan-anchors`).
- Last full run (before the env fix): 3 files failed, 1183 passed; 4 tests failed (the three known-noise items plus `env-manifest`), 24,619 passed, 308 skipped. `env-manifest` rerun alone after the fix: 2 passed. A full run after the env fix was not repeated; the fix touched only `.env.example`.
- Pass 2 (commit 0f3e2929f): `npx tsc --noEmit` clean; `npx vitest run src scripts tests`: 1 file failed (`compute.conventions` skew snapshots x2, known noise), 24,504 passed, 306 skipped; `complete-status-scan.test.ts` passes without a row change. knip after pass 2: the same four new-entry rows as before, `normalizeDailyReturns` (appeared when `v2-joint` went) fixed by making it module-private.
- knip: `npx knip --include files,exports --reporter compact` exits 1 as at the baseline; the diff against `## pre-phase` is the new-entry table above.

## Deviations from Plan

**1. [Rule 3 - Blocking] `lazy-panel-fetch-failure.test.tsx` deleted in Task 1, not Task 2**
- Found during: Task 1 tsc. It imports `ExposureAndGreeksPanel`, so Task 1 could not stay green without it. It is declared in `files_deleted`; only the task boundary moved. Commit 1921b9eea.

**2. [Rule 1 - Bug] `tests/visual/chart-accessibility-layer.test.ts` breadth floor lowered, and `.env.example` entry removed**
- The floor guards the recharts file count and fell below 18 once the ten charts went (15 remain). `NEXT_PUBLIC_SCHEDULING_URL` became a dead `.env.example` key when its only reader, `BookIntroCall`, was deleted, and `env-manifest` fails a dead key. Neither file is in `files_modified`; both edits are direct consequences of declared deletions. Commits 442b734e0 and 8c46e330c.

**3. [Plan gap, resolved by the orchestrator] The export half of Task 3**
- The plan's rule removes an export whose every non-test importer is gone, but that needed deleting `queries.hh-1255.test.ts` and `queries.hh-0495.test.ts`, which were not declared. I stopped and reported; the orchestrator declared them in 699b93e12 and pass 2 completed the removal.

**4. [Rule 3 - Blocking] Edits outside `files_modified` forced by the declared deletions**
- `src/lib/factsheet/build-payload.ts` (`normalizeDailyReturns` de-exported, knip entry), the six other test files in the moved-test table, and `src/lib/types.ts`/`queries.ts` (declared). No deletion outside `files_deleted`.

## Auth gates

None.

## Known Stubs

None. This plan only deletes.

## Threat Flags

None. No new network, auth or schema surface. T-196-46: every deleted module was re-checked for non-test importers before `git rm`, tsc and the full vitest run after each task. T-196-47: the redaction readers were removed only after their last non-test importer was gone (see Removed exports).

## Self-Check: PASSED

- Commits 1921b9eea, 442b734e0, 8c46e330c, 0f3e2929f are ancestors of HEAD (`git merge-base --is-ancestor`).
- `test -f src/components/strategy-v2/StrategyV2Shell.tsx` exits 1; `grep -a -rn StrategyV2Shell src tests` prints three lines, all comments (`VerifiedBadge.tsx:17`, `DashboardChrome.test.tsx:632`, `queries.ts:2027`); no import remains.
- `ls src/components/strategy-v2/` lists only `PartialDataBanner.tsx`, `SegmentedControl.tsx`, `SegmentedControl.test.tsx`.
- `test -f src/components/charts/CorrelationWithBenchmark.tsx` and `test -f src/components/strategy/BookIntroCall.tsx` exit 1.
- `git status --porcelain` on `196-KNIP-BASELINE.txt`: nothing. STATE.md and ROADMAP.md untouched.
