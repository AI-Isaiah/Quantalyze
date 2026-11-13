# Phase 194 plan 10: annualised-figure sites confirmed at HEAD

**Taken:** 2026-11-07, plan 10 Task 1, at the wave-5 base (the merge of wave 4, after Phase 195 TRIM `3ba04e9a0`).
**Basis:** the committed census `194-ANNUALISED-CENSUS.md` (sections A to D and R3). Routes are the census's, as extended by plans 11 to 24 where a later plan took a site R3 had left unplanned. Rows B1-B13 and every page outside 194's set route to Phase 194.1 (D-10) and are named here, not gated.

**Command** (recorded at the top of the census, run at HEAD):

```bash
grep -arliE 'cagr|sharpe|sortino|calmar|volatility' src/app src/components | grep -avE '\.test\.|__tests__|__fixtures__|\.spec\.'
```

It returns **75 files** at HEAD (80 at planning time; Phase 195 removed five, below). The second pass `annuali[sz]ed|ann\.? ?(vol|ret)` returns the same 2 extra files the census named (`ScenarioBenchmarkSection.tsx`, `AlphaBetaDecomposition.tsx`), giving 77. The census added three files by hand (the last table). Every one of the 80 is named in the census; none is new.

**Route key.** `194-NN` is a 194 plan id; `194.1` is Phase 194.1; `excluded:` carries one of the census's three allowed reasons (label only, static copy, no render) or "deleted by 195" or "comment-only". A row with two plan ids is gated by both. A mixed row (a 194 plan plus a 194.1 part) counts as a 194 row.

## Sites returned by the command (77)

| file | census row | route |
|---|---|---|
| `src/app/(dashboard)/admin/intros/page.tsx` | B12 | 194.1 (admin, frozen snapshot) |
| `src/app/(dashboard)/admin/page.tsx` | D | excluded: no render (compute or transport; gated at the render site) |
| `src/app/(dashboard)/allocations/components/BridgeDrawer.tsx` | D | excluded: comment-only hit |
| `src/app/(dashboard)/allocations/components/HoldingDetail.tsx` | B defect note | excluded: no render (reached only through the `rows` branch of `HoldingsTable`, whose feed `toDesignHoldings` has no non-test caller at HEAD) |
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` | B9, R3 | 194-11 (live path is `StrategyRowsTable`) |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` | A | 194-05 (the Scenario blend row; plan 05 gates it through the composer's `scenarioMetrics` (plan 05 SUMMARY deviation 2)) |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.tsx` | C | excluded: label only (glossary copy for the "Sharpe lift" label; the figure renders in `PortfolioOptimizer.tsx`, 194-22) |
| `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx` | C, R3 | 194-17 |
| `src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx` | D | excluded: no render (-> B7 `ScenarioCompareTable.tsx`) |
| `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` | B7 | 194.1 (saved-blend columns) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | A, B8, R3 | 194-05, 194-17 (constituent rows (B8) are 194.1's) |
| `src/app/(dashboard)/allocations/components/ScenarioFooter.tsx` | D | excluded: comment-only hit |
| `src/app/(dashboard)/allocations/components/WeightOptimizerSection.tsx` | D | excluded: label only |
| `src/app/(dashboard)/allocations/HoldingsTabPanel.tsx` | D | excluded: comment-only hit |
| `src/app/(dashboard)/allocations/lib/holdings-adapter.ts` | D | excluded: no render (dead: no non-test caller) |
| `src/app/(dashboard)/allocations/lib/mandate-gates.ts` | D | excluded: no render (no live caller) |
| `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` | D | excluded: no render |
| `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` | D | excluded: no render |
| `src/app/(dashboard)/allocations/lib/scenario-compare.ts` | D | excluded: no render |
| `src/app/(dashboard)/allocations/lib/scenario-montecarlo.ts` | D | excluded: comment-only hit |
| `src/app/(dashboard)/allocations/lib/strategies-row-adapter.ts` | B9, R3 | 194-11 |
| `src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx` | C, R3 | 194.1 (outside 194's pages) |
| `src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts` | D | excluded: no render (transport; gated at the render site; plan 14 adds payload fields) |
| `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` | B11 | 194.1 (holding columns unchanged by plan 10) |
| `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` | A | 194-04, 194-08 (via `FactsheetView`) |
| `src/app/(dashboard)/recommendations/page.tsx` | B5 | 194.1 |
| `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.tsx` | D | excluded: comment-only hit |
| `src/app/(dashboard)/strategies/new/wizard/steps/SubmitStep.tsx` | B6 | 194.1 (reuses the SyncPreview snapshot) |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` | B6 | 194.1 (two arms) |
| `src/app/(marketing)/for-quants/page.tsx` | D | excluded: static copy (`SAMPLE_METRICS` demo) |
| `src/app/(marketing)/legal/disclaimer/page.tsx` | D | excluded: static copy |
| `src/app/(marketing)/security/page.tsx` | D | excluded: static copy |
| `src/app/api/og/factsheet/[id]/route.tsx` | B3 | 194.1 (OG share image) |
| `src/app/api/scenario/optimize/route.ts` | D | excluded: no render |
| `src/app/api/scenario/peer-rank/route.ts` | D | excluded: no render (-> C; gated at the render site by 194-19 and 194-20) |
| `src/app/api/simulator/route.ts` | D | excluded: no render |
| `src/app/api/strategies/[id]/returns/route.ts` | D | excluded: no render |
| `src/app/api/strategies/create-with-key/route.ts` | D | excluded: no render |
| `src/app/api/strategies/csv-finalize/route.ts` | D | excluded: no render |
| `src/app/api/strategies/finalize-wizard/route.ts` | D | excluded: no render |
| `src/app/browse/[slug]/[strategyId]/page.tsx` | A | 194-10 (hero and mini metrics; this plan, Task 2) |
| `src/app/factsheet/[id]/tearsheet/page.tsx` | A | 194-07, 194-18 (also mounts `PercentileRankBadge`) |
| `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` | C, R3 | 194-15 (BootstrapCI and CalmarByYear tables) |
| `src/app/factsheet/[id]/v2/basis-context.tsx` | D | excluded: no render (plan 14 threads the record through `rederiveArgs`) |
| `src/app/factsheet/[id]/v2/BatchDPanels.tsx` | C, R3 | 194-16 |
| `src/app/factsheet/[id]/v2/chart-configs.ts` | D | excluded: no render (rolling configs; plan 24 gates the chart mount) |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | A, R3 | 194-08, 194-24 (KPI strip and rolling charts) |
| `src/app/factsheet/[id]/v2/format.ts` | D | excluded: no render |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | A, R3 | 194-04, 194-15 |
| `src/app/factsheet/[id]/v2/page.tsx` | A, R3 | 194-04, 194-08, 194-16 (JSON-LD CAGR is plan 16's) |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | C | 194-24 (rolling configs mounted by `FactsheetView` (the file carries no gate of its own)) |
| `src/app/scenario-share/[token]/page.tsx` | B4 | 194.1 (also mounts `ScenarioBenchmarkSection`, which inherits plan 17's gate) |
| `src/app/scenario-share/[token]/share-resolve.ts` | D | excluded: no render |
| `src/app/strategy/[id]/page.tsx` | B1 | 194.1 (hero and `generateMetadata`) |
| `src/components/admin/AdminTabs.tsx` | B12 | 194.1 |
| `src/components/admin/AllocatorMatchQueue.tsx` | D | excluded: no render (-> `CandidateDetail.tsx`) |
| `src/components/admin/CandidateDetail.tsx` | B12 | 194.1 |
| `src/components/admin/PreferencesPanel.tsx` | D | excluded: label only |
| `src/components/charts/RollingMetrics.tsx` | C, R3 | 194-17 (Scenario mount; the `/strategy/[id]/v2` mount is 194.1's) |
| `src/components/charts/RollingSortinoChart.tsx` | C, R3 | 194-17 (Scenario mount; the `/strategy/[id]/v2` mount is 194.1's) |
| `src/components/charts/RollingVolatilityChart.tsx` | C, R3 | 194-17 (Scenario mount; the `/strategy/[id]/v2` mount is 194.1's) |
| `src/components/discovery/SimulateImpactButton.tsx` | D | excluded: label only (the figure renders in `PortfolioImpactPanel.tsx`, 194-22) |
| `src/components/landing/VerificationResults.tsx` | B13 | 194.1 (landing page) |
| `src/components/landing/VerificationSection.tsx` | D | excluded: no render |
| `src/components/portfolio/PortfolioImpactPanel.tsx` | C, R3 | 194-22 |
| `src/components/portfolio/PortfolioOptimizer.tsx` | C, R3 | 194-22 (195-shared) |
| `src/components/portfolio/ReplacementCard.tsx` | C, R3 | 194.1 (Overview-tab `BridgeWidget`, outside 194's pages) |
| `src/components/strategy-v2/HeadlineMetricsPanel.tsx` | B2 | 194.1 (`/strategy/[id]/v2`) |
| `src/components/strategy-v2/RollingMetricsPanel.tsx` | C, R3 | 194.1 (mounted only by `StrategyV2Shell` (`/strategy/[id]/v2`)) |
| `src/components/strategy-v2/StrategyV2Shell.tsx` | D | excluded: no render |
| `src/components/strategy/CompareTable.tsx` | A | 194-10 (five annualised rows; this plan, Task 3) |
| `src/components/strategy/CustomizeDrawer.tsx` | D | excluded: label only |
| `src/components/strategy/HoldingFactsheet.tsx` | D | excluded: label only (reason strings) |
| `src/components/strategy/PercentileRankBadge.tsx` | D, R3 | 194-18 (the census read it as label only; its tearsheet mount and the rank marker are plan 18's) |
| `src/components/strategy/StrategyFilters.tsx` | D | excluded: label only |
| `src/components/strategy/StrategyGrid.tsx` | B10 | 194.1 (grid view mounted by `StrategyTable`) |
| `src/components/strategy/StrategyTable.tsx` | A | 194-06 |

## Named by the census, not returned by the command (3)

| file | census row | route |
|---|---|---|
| `src/components/strategy/FactsheetPreview.tsx` | B6 (hand-added) | 194.1 (matches neither pattern; prints the figures it is handed, rendered by the wizard steps) |
| `src/app/(dashboard)/compare/page.tsx` | A (hand-added) | 194-10 (computes the server-side record for `CompareTable`; Task 3) |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | A (hand-added) | 194-04, 194-08 (via `FactsheetBody`; synthetic blend payload) |

## Census rows no longer present at HEAD (deleted or retired by Phase 195, not counted)

`portfolios/[id]/page.tsx`, `StrategyBreakdownTable.tsx`, `PortfolioKpiPanel.tsx` and `CompositionDonut.tsx` are absent from the tree (excluded: deleted by 195). `portfolio-pdf/[id]/page.tsx` exists as a retired-report landing page and no longer matches the command (excluded: deleted by 195, renderer retired, no figures).

## New since census

None. Every file the command returns at HEAD is named in the census (A to D, R3), so nothing is `unrouted`.

## Notes for the orchestrator

- `KpiStrip.tsx` is a 194-05 site that plan 05's `files_modified` does not list; plan 05's SUMMARY records that it gated the strip through the composer's `scenarioMetrics` instead (the strip receives gated values).
- `HoldingDetail.tsx` prints Sharpe but is reachable only through `HoldingsTable`'s `rows` branch; `toDesignHoldings`, the only builder of those rows, has no non-test caller. If a caller is ever added, this row becomes a 194.1 site.
- `PercentileRankBadge.tsx` was "label only" in the census; plan 18 owns its marker, so it is a 194 row here.

ann-sites: 80
ann-194: 24
ann-194-1: 18
ann-excluded: 38
ann-new: 0
