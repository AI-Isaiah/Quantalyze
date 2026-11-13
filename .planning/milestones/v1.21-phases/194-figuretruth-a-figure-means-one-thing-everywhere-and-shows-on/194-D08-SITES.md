# Phase 194 D-08 site census

Plan 194-05, Task 1. Enumerates every site where an equity or exposure figure carries a label, and classifies it.

Method: the UI-SPEC grep (`"AUM"`, `label="Gross"`, `label="Net"`, `"Equity"`, `>Gross<`, `>Net<`, widened to `Gross`, `Net`, `AUM`, `Equity`, `Total`, `Portfolio`, `Value` label shapes) with `grep -arn` over `src/app/(dashboard)/allocations` and `src/components/portfolio`, test files excluded. `src/app/(dashboard)/overview` does not exist. A second pass over all of `src` for the exact UI-SPEC strings found the three discovery/strategy `AUM` hits and one strategy chart title, recorded below so the census does not claim a narrower search than it ran.

Classes: `book equity`, `modelled equity`, `gross exposure`, `net exposure`, `none`. `apply-in` is the plan that may edit the row.

| file:line | today's label | class | apply-in | reason |
|---|---|---|---|---|
| `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx:113` | `Gross` (KPI cell, `kpi-gross`) | gross exposure | 194-05 | confirmed D-08 site; becomes `Gross exposure` |
| `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx:115` | `Net` (KPI cell, `kpi-net`) | net exposure | 194-05 | confirmed D-08 site; becomes `Net exposure` |
| `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx:190` | `Gross` (table column header) | gross exposure | 194-05 | same quantity as the KPI, per-slice; labelled to match |
| `src/app/(dashboard)/allocations/widgets/positions/ExposureByClass.tsx:191` | `Net` (table column header) | net exposure | 194-05 | same quantity as the KPI, per-slice; labelled to match |
| `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx:127` | `Net` (`LegendChip`) | net exposure | 194-05 | confirmed D-08 site |
| `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx:128` | `Gross` (`LegendChip`) | gross exposure | 194-05 | confirmed D-08 site |
| `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx:150` | `Gross` (series `name`, shown in the tooltip) | gross exposure | 194-05 | confirmed D-08 site |
| `src/app/(dashboard)/allocations/widgets/positions/NetExposureChart.tsx:159` | `Net` (series `name`, shown in the tooltip) | net exposure | 194-05 | confirmed D-08 site |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:5304` | `PORTFOLIO AUM (USD)` | modelled equity (book mode) | 194-05 | book mode seeds the field from the modelled book (Models N of M keys); becomes `Modelled equity` in book mode only. Blank mode is a typed input and keeps `PORTFOLIO AUM (USD)` |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:794,796,1498,4647,4648,7277,7507` | error strings and hints that say "portfolio AUM" | none | none | UI-SPEC: error strings that say "portfolio AUM" stay |
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:683` | `Value (USD)` | none | none | per-position mark value, not a book total |
| `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx:308` | `Total unrealized P&L (equity contribution)` | none | none | a P&L total, not an equity figure |
| `src/app/(dashboard)/allocations/MandateTabPanel.tsx:78` | `Minimum AUM` | none | none | mandate threshold (UI-SPEC) |
| `src/app/(dashboard)/allocations/lib/mandate-gates.ts:195` | `Min AUM` | none | none | mandate threshold (UI-SPEC) |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1283,1499,1660,2371` | aria-labels `Equity chart`, `Equity series visibility`, `Equity curve` | none | none | aria-labels stay (D-08); no dollar figure is labelled |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:1629,1969,2416` | `Portfolio` (legend, tooltip row) | none | none | a return-percentage series, not an equity or exposure figure; file is shared with Phase 195 and unedited |
| `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:175` | aria-label `Portfolio equity curve` | none | none | aria-label stays |
| `src/app/(dashboard)/allocations/widgets/outcomes/OutcomesWidget.tsx:219` | `Total outcomes` | none | none | a count, not a dollar figure |
| `src/app/(dashboard)/allocations/components/KpiStrip.tsx` (comments only) | the `AUM` cell was removed in Phase 64 | none | none | no rendered `AUM` label remains; a negative test pins it |
| `src/components/strategy/StrategyFilters.tsx:121` | `AUM` (discovery sort option) | none | none | manager-declared strategy figure (UI-SPEC A-5); outside the two scanned directories, found by the all-`src` pass |
| `src/components/strategy/CustomizeDrawer.tsx:24` | `AUM` (discovery column option) | none | none | UI-SPEC A-5; found by the all-`src` pass |
| `src/components/strategy/StrategyTable.tsx:316` | `AUM` (discovery column) | none | none | UI-SPEC A-5; found by the all-`src` pass |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx:1699` | `AUM` (`CapacityChip`) | none | none | the strategy's declared AUM on a strategy factsheet header; the Overview mounts the factsheet body with `hideHeader`, so the chip never shows the allocator's book. Phase 195 shares the file; not edited |
| `src/components/strategy-v2/HeadlineMetricsPanel.tsx:293` | `Equity vs BTC` | none | none | a strategy equity-curve chart title (a normalised series), not a dollar equity figure; found by the all-`src` pass |

`src/components/portfolio/PortfolioKpiPanel.tsx` no longer exists at this HEAD, and `src/app/portfolio-pdf/[id]/` carries no `AUM`, `Gross`, `Net` or `Equity` label, so neither contributes a row.

## Whole-book dollar headline (`Book equity`)

Searched by role, not string: every `formatUsd(` and `formatCurrency(` call, and every `total`, `sum`, `reduce`, `Equity`, `Portfolio`, `Value` label shape under `src/app/(dashboard)/allocations`, plus `AllocationDashboardV2.tsx` (the Overview), `HoldingsTabPanel.tsx`, `HoldingsTable.tsx`, `OpenPositionsTable.tsx`, `KpiStrip.tsx` and the factsheet header the Overview mounts. Findings:

- Overview: `KpiStrip` is return-form only (the `AUM` dollar cell was removed in Phase 64); the factsheet body is mounted `hideHeader`, so the `CapacityChip` is not shown. The payload's `aum` is `analytics.total_aum`, which `analytics-service/routers/portfolio.py` builds as a sum of the strategies' own declared `aum`, not custody.
- Holdings: dollar figures are per-position (`value_usd`, `allocation`) and one P&L footer; there is no book-total line.
- Exposure widgets: `ExposureByClass` Gross and Net are exposure, handled above.
- Scenario: the only book-total dollar figure is the book-mode `PORTFOLIO AUM` field, which this plan labels `Modelled equity` because it is the modelled book, not custody's whole-book total.

d08-book-equity: none — searched every dollar-figure render and every total/sum under the allocations tree, the Overview factsheet mount and the Holdings tab; each is a per-position value, a P&L total, a declared strategy AUM or an exposure, so no surface states the custody whole-book dollar total (the only candidate, the Scenario book-mode field, is the modelled book and is labelled `Modelled equity`).

d08-sites: 24
d08-apply-194-08: 0
