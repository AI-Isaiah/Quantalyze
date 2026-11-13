# Phase 194 — planning-time census of annualised-figure sites (D-04 "every page")

**Taken:** 2026-11-07, planning revision 2, at worktree HEAD `e673bbc68` (branch `feat/194-figuretruth`).
**Status:** INPUT for the split decision. This census is not the execution-time `194-ANNUALISED-SITES.md` that plan 10 Task 1 writes.

**Command** (case-insensitive, non-test, per the checker's fix hint):

```bash
grep -arliE 'cagr|sharpe|sortino|calmar|volatility' src/app src/components | grep -avE '\.test\.|__tests__|__fixtures__|\.spec\.'
```

It matched **80 files**. A second pass on `annuali[sz]ed|ann\.? ?(vol|ret)` found 2 more (`ScenarioBenchmarkSection.tsx`, `AlphaBetaDecomposition.tsx`). `FactsheetPreview.tsx` matches neither pattern but prints the figures it is handed, so it was added by hand.
Phase 195 file sets were read from the local `feat/195-trim` ref. `origin/feat/195-trim` does not exist.

## A. Gated by a plan in 194-01..10

| Site | Figures | Route |
|---|---|---|
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | CAGR, Ann. Vol, Sharpe, Sortino, Calmar | 194-04 |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` (strip `KpiStrip()` ~:1790) | CAGR, Sharpe, Sortino, Calmar | 194-08 (195-shared) |
| `src/app/factsheet/[id]/tearsheet/page.tsx` (also mounts `PercentileRankBadge`) | hero + Detail | 194-07 (195-shared) |
| `src/components/strategy/StrategyTable.tsx` | CAGR, Sharpe, Vol, Calmar | 194-06 (195-shared) |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` blend section, and `KpiStrip.tsx` (the "Scenario blend" row, :5835, fed by the composer) | blend Sharpe and the others | 194-05. `KpiStrip.tsx` is not named in the plan. |
| `src/app/browse/[slug]/[strategyId]/page.tsx` | hero + mini | 194-10 (195-shared) |
| `src/components/strategy/CompareTable.tsx` + `compare/page.tsx` (strategy columns) | five | 194-10 |
| `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`, `src/app/factsheet/[id]/v2/page.tsx` | via `FactsheetView` | 04 + 08 (v2 `page.tsx` :843 reads `cagr`; triage that line) |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | via `FactsheetBody` (synthetic blend payload) | 04 + 08. **GAP:** neither plan uses the `"blend"` scope wording when `scenarioMode` is set. |

## B. Prints a strategy or blend annualised figure, NOT gated by any plan

| # | Site | Figures | Audience | 195 | Span source available |
|---|---|---|---|---|---|
| B1 | `src/app/strategy/[id]/page.tsx` hero :151-175 **and** `generateMetadata` :38-39 (link-preview text) | CAGR, Sharpe, Sortino, Vol | public share link | no | `readRecordSpan` (plan 07) |
| B2 | `src/components/strategy-v2/HeadlineMetricsPanel.tsx` (`/strategy/[id]/v2`) | CAGR, Sharpe, Sortino, Vol | public | no | `getStrategyDetailV2` payload |
| B3 | `src/app/api/og/factsheet/[id]/route.tsx` (OG share image, Next route) | CAGR, Sharpe, Vol | public | no | `readRecordSpan` |
| B4 | `src/app/scenario-share/[token]/page.tsx` :408-410 | blend CAGR, Vol, Sharpe | public share | no | blend window in the share payload |
| B5 | `src/app/(dashboard)/recommendations/page.tsx` :553-554 | CAGR, Sharpe | allocator | no | extend its `strategy_analytics` select (:264) with `series_start` / `headline_since` scalars |
| B6 | `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` two arms :1701, :2088 (→ `SubmitStep.tsx` reuses the snapshot; rendered by `src/components/strategy/FactsheetPreview.tsx` `qualifier`) | CAGR, Sharpe, Sortino, Vol | manager (own) | no | add scalar aliases to its two selects |
| B7 | `src/app/(dashboard)/allocations/components/ScenarioCompareTable.tsx` (saved-blend columns) | CAGR, Sharpe, Sortino, Vol | allocator | no | per-column engine window |
| B8 | `ScenarioComposer.tsx` constituent rows :8300-8325 (`scenario-detail-cagr-*`, `-sharpe-*`) | per-strategy CAGR, Sharpe | allocator | no | constituent series already in memory |
| B9 | **Live Holdings**: `HoldingsTable.tsx` `StrategyRowsTable` :515, fed by `allocations/lib/strategies-row-adapter.ts` `toStrategyRows`, fed by `src/lib/queries.ts` (`OwnCapitalStrategy`, the dashboard `strategies` embed) | Sharpe | allocator | no | server-side, as `mtd` is computed today (queries.ts docblock ~:2597) |
| B10 | `src/components/strategy/StrategyGrid.tsx` :199-201 (grid view mounted by `StrategyTable`) | CAGR (+ others) | public/allocator | file not in 195; parent is | plan 06 aliases |
| B11 | `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts` → CompareTable holding columns | Sharpe | allocator | no | holding returns dates (plan 10 says "unchanged") |
| B12 | admin: `src/components/admin/AdminTabs.tsx` :516-517, `src/components/admin/CandidateDetail.tsx` :72-74, `src/app/(dashboard)/admin/intros/page.tsx` :68, :228 (frozen snapshot) | CAGR, Sharpe, Vol | admin only | no | AdminTabs/Candidate: scalar aliases; intros: frozen snapshot, NO span |
| B13 | `src/components/landing/VerificationResults.tsx` :62 | Sharpe of a verified key | public visitor (own key) | no | unverified |

**DEFECT in plan 04 Task 3:** it gates `holdings-adapter.ts` `toDesignHoldings`. That function has **no non-test caller**: `grep -arn toDesignHoldings src` returns only its definition and a comment. So `DesignHoldingsTable` and `HoldingDetail.tsx` :232 are unreachable. The Sharpe column users actually see is B9.

## C. Need a founder ruling (derived from an annualised figure, or outside D-04's five)

| Site | What it prints | Question |
|---|---|---|
| `PortfolioImpactPanel.tsx`, `ReplacementCard.tsx` (`sharpe_delta`), `PortfolioOptimizer.tsx` / `OptimizerPanel.tsx` ("Sharpe lift") | a modelled Sharpe delta | Is a delta of annualised figures gated? These payloads carry no span. |
| `BatchDPanels.tsx` :101-102, :172-173; `api/scenario/peer-rank` → `ScenarioComposer` → `ScenarioFactsheetChart` `scenarioPeer` | percentile ranks of Sharpe/Sortino, deltas vs benchmark | Is the rank or delta of a withheld figure withheld? |
| `RollingMetrics.tsx`, `RollingSortinoChart.tsx`, `RollingVolatilityChart.tsx`, `RollingMetricsPanel.tsx`, `TimeSeriesChart.tsx` rolling configs, `AnalyticalPanels.tsx` | fixed-window rolling estimates (30-day floor today) | Is D-04 a headline-figure rule (planner's reading), or does it cover rolling charts too? |
| `ScenarioBenchmarkSection.tsx`, `AlphaBetaDecomposition.tsx` | annualised alpha, tracking error, information ratio | D-04 names five figures. Are these included? |

## D. Excluded (reason named)

- **Deleted by 195:** `portfolios/[id]/page.tsx`, `StrategyBreakdownTable.tsx` (195-02); `PortfolioKpiPanel.tsx`, `CompositionDonut.tsx` (195-06); `portfolio-pdf/[id]/page.tsx` (195-01 retires the renderer).
- **Label only:** `StrategyFilters.tsx`, `CustomizeDrawer.tsx`, `PercentileRankBadge.tsx` (label map; its tearsheet mount is under 194-07), `WeightOptimizerSection.tsx`, `PreferencesPanel.tsx`, `SimulateImpactButton.tsx`, `HoldingFactsheet.tsx` (reason strings).
- **Static copy:** `(marketing)/for-quants/page.tsx` (`SAMPLE_METRICS` demo), `legal/disclaimer`, `security`.
- **No render** (compute or transport, gated at the render site named above): `mandate-gates.ts` (no live caller), `scenario-adapter.ts`, `scenario-compare.ts`, `scenario-benchmark.ts`, `ScenarioComparePanel.tsx` (→ B7), `scenario-factsheet-payload.ts`, `holdings-adapter.ts` (dead), `api/scenario/optimize`, `api/scenario/peer-rank` (→ C), `api/simulator`, `api/strategies/{create-with-key,csv-finalize,finalize-wizard,[id]/returns}`, `admin/page.tsx`, `AllocatorMatchQueue.tsx` (→ CandidateDetail), `scenario-share/[token]/share-resolve.ts`, `VerificationSection.tsx`, `StrategyV2Shell.tsx`, `basis-context.tsx`, `chart-configs.ts`, `format.ts`.
- **Comment-only hits:** `BridgeDrawer.tsx`, `ScenarioFooter.tsx`, `HoldingsTabPanel.tsx`, `scenario-montecarlo.ts`, `MetadataStep.tsx`.

**Not fully read:** the B13 span source, the `factsheet/[id]/v2/page.tsx` :843 line, and the `AnalyticalPanels.tsx` table headers. The next planning pass must open these three before routing them.

## R3. Revision 3 routing (2026-11-07, after founder answers D-10..D-13)

**Resolved from section A/B notes.** The plan 04 Task 3 defect is fixed: Holdings moved to new plan **194-11**, which gates the live B9 path (`StrategyRowsTable` <- `toStrategyRows` <- `getOwnCapitalStrategies` / `getMyAllocationDashboard`) after plan 06; `toDesignHoldings` is not edited. B9 is therefore a **194** row, not 194.1. The `ScenarioFactsheetChart` blend-wording GAP is closed in plans 04 (rail) and 08 (strip).

**The three items not fully read, opened at worktree HEAD:**

| Item | What it is | Route |
|---|---|---|
| B13 span source | `VerificationResults.tsx` props carry `equity_curve: { date, value }[] \| null`; its first and last `date` give the span. Mounted only by `VerificationSection.tsx` (landing page). | **194.1** (landing page is outside 194's set) |
| `factsheet/[id]/v2/page.tsx` ~:843 | JSON-LD `interestRate` publishes the API strategy's CAGR as a machine-readable figure with no span gate. | **194** (factsheet page). Not yet in a plan: see "Not planned in revision 3" below |
| `AnalyticalPanels.tsx` tables | `BootstrapCIPanel` (Sharpe/Sortino point + 95% CI, amber `⚠` under 252 obs) and `CalmarByYearPanel` (per-year Calmar, amber `⚠` on years under 200 trading days), both mounted in `MetricsColumn.tsx`. | **194** (factsheet rail). Not yet in a plan: see below |

**D-11 widened kinds on 194's own pages (measured at HEAD):**

| Kind | Site (194 page) | Data path |
|---|---|---|
| Rolling charts | factsheet `FactsheetView.tsx` `PerformanceCharts` rolling vol/Sharpe/Sortino (126-row window, 30-row fallback, `pickRollingWindow` in `src/lib/factsheet/rolling.ts`); rail `MetricsColumn.tsx` `RollingMetricsPanel`; Scenario `ScenarioComposer.tsx` blend rolling panel (63/126/252-row windows) | client-side; window span = `spanDays` over the payload dates |
| Alpha / TE / IR | factsheet `MetricsColumn.tsx` §IV `BenchmarkMetricsBody` and the KPI strip α/IR, both fed by `buildComparatorBlock` (`comparator-block.ts`, paired dates known); Scenario `ScenarioBenchmarkSection.tsx` (`pairScenarioWithBtc` returns dates) | client-side |
| Peer ranks | lists `StrategyTable.tsx` `pctSuffix` and tearsheet `PercentileRankBadge`, both from `getPercentiles` / `getOwnRowPercentiles` -> `scoreAgainstPopulation` (`percentile-core.ts`); Scenario rail `PeerPercentilePanel` from `/api/scenario/peer-rank` -> SQL RPC `get_verified_cohort_rank` (latest definition `20260821120000_get_verified_cohort_rank_computed_gate.sql`) | population exclusion needs span columns in the percentile select and, for Scenario, a migration |
| Sharpe deltas / lifts | lists `SimulateImpactButton` -> `PortfolioImpactPanel` `sharpe_delta` (response carries `equity_curve_proposed` dates); Scenario rail `OwnBookDeltaPanel`; Holdings `OptimizerPanel` -> `PortfolioOptimizer.tsx` `sharpe_lift` (**195-shared**: 195-02; no span in the stored suggestion, `match_engine.py` / `portfolio_optimizer.py` must emit one) | mixed client / Python |

Outside 194's pages (194.1): `BridgeWidget` -> `ReplacementCard` `sharpe_delta` (Overview tab), `AlphaBetaDecomposition` widget, `/strategy/[id]/v2` rolling and greeks panels, `scenario-share` (also mounts `ScenarioBenchmarkSection`; it inherits any gate added to that component).

**Not planned in revision 3 (the planner ran out of context, so this is not a scope decision).** These items are routed to 194 and have NO plan yet: the D-11 rows above, the v2 `page.tsx` JSON-LD CAGR, and the two `AnalyticalPanels.tsx` tables. A fresh planner pass should add them as plans 12 onward.
