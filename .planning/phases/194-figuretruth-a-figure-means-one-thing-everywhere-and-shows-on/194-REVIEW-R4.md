---
phase: 194-figuretruth
round: 4
reviewed: 2026-11-08T09:45:00Z
reviewed_range: 9cb039142..a4cfebe09
depth: standard
files_reviewed: 63
files_reviewed_list:
  - analytics-service/services/metrics.py
  - analytics-service/tests/fixtures/e2_match_score_golden.json
  - analytics-service/tests/fixtures/rolling_1y_vectors.json
  - analytics-service/tests/test_figure_gate_span.py
  - analytics-service/tests/test_match_engine.py
  - analytics-service/tests/test_match_router_asset_class.py
  - analytics-service/tests/test_portfolio_optimizer.py
  - analytics-service/tests/test_rolling_1y.py
  - scripts/seed-demo-data.ts
  - src/__tests__/figure-parity-pages.test.tsx
  - src/__tests__/seed-demo-data-kpi-series.test.ts
  - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.d11.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.book-btc.test.tsx
  - src/app/(dashboard)/allocations/widgets/attribution/AlphaBetaDecomposition.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.d11.test.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/(dashboard)/compare/page.test.tsx
  - src/app/browse/[slug]/[strategyId]/page.figure-gate.test.tsx
  - src/app/factsheet/[id]/tearsheet/page.rank-gate.test.tsx
  - src/app/factsheet/[id]/tearsheet/page.test.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.d11.test.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.ownbook.test.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.rolling-gate.test.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.figure-gate.test.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/basis-context.figure-record.test.tsx
  - src/app/factsheet/[id]/v2/basis-context.joint-record.test.tsx
  - src/components/portfolio/PortfolioImpactPanel.test.tsx
  - src/components/portfolio/PortfolioOptimizer.test.tsx
  - src/components/portfolio/PortfolioOptimizer.tsx
  - src/components/strategy/StrategyGrid.figure-gate.test.tsx
  - src/components/strategy/StrategyTable.test.tsx
  - src/lib/closed-sets.cohort-gate-parity.test.ts
  - src/lib/factsheet/__snapshots__/build-payload.test.ts.snap
  - src/lib/factsheet/build-payload.d11.test.ts
  - src/lib/factsheet/build-payload.rolling-basis.test.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/comparator-block.d11.test.ts
  - src/lib/factsheet/comparator-block.d14.test.ts
  - src/lib/factsheet/comparator-block.ts
  - src/lib/factsheet/fetch-and-build-payload.test.ts
  - src/lib/factsheet/rolling-calendar.test.ts
  - src/lib/factsheet/rolling.ts
  - src/lib/figure-gate.d11.test.ts
  - src/lib/figure-gate.test.ts
  - src/lib/figure-gate.ts
  - src/lib/portfolio-analytics-adapter.test.ts
  - src/lib/portfolio-analytics-adapter.ts
  - src/lib/queries.my-allocation.test.ts
  - src/lib/queries.own-capital-span.test.ts
  - src/lib/queries.percentiles.test.ts
  - src/lib/types.ts
  - supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql
  - supabase/schema/functions/get_verified_cohort_rank.sql
  - supabase/tests/test_get_verified_cohort_rank_gate.sql
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
status: issues_found
---

# Phase 194: Code Review Report, round 4

**Reviewed:** 2026-11-08. Range `9cb039142..a4cfebe09` (13 commits), `.planning/` excluded. This covers fixer I (the round-3 MEDIUMs), fixer H (D-20) and fixer J (D-21).
**Depth:** standard. Where a fix depends on another file I also read the call chain: KpiStrip, `scenario.ts` effective window, the `useWindowedView` scope, the simulator's `_cumulative_curve`, the HARD-04 `insufficient_window` producer, and the optimizer card's data path.
**Status:** issues_found. 1 MEDIUM, 0 HIGH, 0 CRITICAL. The brief asked for MEDIUM and above only, so LOW and INFO are left out.

## Summary

I judged the range against D-11 and D-13 to D-21 in `194-CONTEXT.md`.

I ran the touched tests at HEAD:
- vitest: 10 files (figure-gate, figure-gate.d11, rolling-calendar, ScenarioComposer.d11, BatchDPanels ownbook and peer-scenario, PortfolioOptimizer, the portfolio analytics adapter, the cohort-gate parity test, the seed KPI test). 225 passed.
- pytest: `test_rolling_1y`, `test_figure_gate_span`, `test_match_router_asset_class`, `test_match_engine`, `test_portfolio_optimizer`. 177 passed.

**D-20, the one span definition: checked, no inconsistency found.**
- TS `coveredDays` is `spanDays + 1` (`figure-gate.ts:72-74`).
- Python `_index_span_days` is `.days + 1` (`metrics.py:175`).
- SQL `rec_ok` adds `+ 1` in both queries and in the self-verifying `v_rec_pred` copy.
- A grep for raw `spanDays(` callers finds one left, `rolling.ts:185`. It is correct there: it is the window's lower edge, a calendar gap, and not a length.
- Every surface that judges a record or window length now goes through `figureRecord`/`figureSpan`, `coveredDays` or `rollingWindowSpanDays`. That covers the rail and the strip for a selected range (whose `scope.start` is the first return date, `basis-context.tsx:560-562`), the StyleDrift halves, the own-book delta, the Scenario benchmark overlap, the alpha widget, the comparator overlap and its `coveredShortSpanDays`, and the Holdings/percentile records.
- The simulator's curve dates are return dates (`simulator_scoring.py:327-341`), so `figureSpan` there does not count an anchor day.
- At 89/90 and 364/365, the TS, Python and SQL tests each pin both sides of the boundary. The parity pins can fail: the TS test regex-reads the Python `+ 1`, and the occurrence count reads the SQL `END) + 1 < v_min_span_days`.

**D-21, the 1-year rolling window: checked, consistent.**
- The TS warm-up (`coveredDays(dates[0], dates[i]) < windowDays`) and the Python `index[0] + (window_days - 1)` agree with the window body `(t - 365, t]`.
- I recomputed `rolling_1y_vectors.json` from scratch in plain Python, using the rule and not either implementation. All 7 vectors match: the same first-point index and every vol value. So the regenerated fixture hides no unintended change.
- The 1y series gates (`build-payload.ts:540/556`, `scenario-factsheet-payload.ts:424/426`, `ScenarioComposer.tsx:4230`) and `gateRollingWindow`'s calendar arm (`record.spanDays < calendarDays`) all count the same way.

**Regenerated goldens and snapshots.**
- `e2_match_score_golden.json`: only `sharpe_lift_span_days` 39 becomes 40.
- `build-payload.test.ts.snap`: a token diff shows only span/day fields +1 (`figureRecord.spanDays`, `jointAnnualization.days`, `coveredShortSpanDays`, the 30d verdict `days`). No value moved.

**Round-3 findings: all closed.**
- **R3 WR-01 (strip vs footer Sharpe delta): closed.**
  - `sharpeDeltaState` is now computed once (`ScenarioComposer.tsx:4484-4501`). The footer reads it.
  - The strip gets `gatedLiveMetrics`, whose `sharpe` is withheld when the book's record is. So the pill and the "Current book" title both dash.
  - Max DD and TWR stay ungated, because they are not annualised.
  - The new d11 test (60-day book beside a 400-day blend) checks `liveMetrics.sharpe === null` on the strip mock and can fail.
  - The rebuild case stays as the accepted D-17 behaviour.
- **R3 SFH-M2 (unreadable own-book series): closed.**
  - `ownBookUnreadable` fails the delta closed to withheld on both surfaces and reports once per transition.
  - An empty or single-return book is not treated as unreadable (`[].every` is true).
- **R3 WR-02 (sample/252 captions in BatchDPanels): closed for both captions.** The Scenario chart passes `periodsPerYear={blendBasis}` into the synth payload (`ScenarioComposer.tsx:6085`), so `figureRecord.crypto` is the blend's own flag. But a third caption of the same kind, on the same page, was missed. See WR-01 below.
- **R3 WR-03 (router asset_class untested): closed.** The projecting fake returns only the columns and embeds that the select names. So dropping `asset_class` from `match.py:421` or the `strategies(asset_class)` embed at `:1223` turns each test red. The `:566` and `:1289` copies are covered too.
- **R3 SFH-M1 (optimizer raw lift state): closed.**
  - The adapter keeps `sharpe_lift_state_raw` only on a coerced value.
  - The card (`PortfolioOptimizer.tsx:164-169`) reports `lift-state-unrecognised` with the stored value, and a genuine `withheld` keeps `lift-record-unreadable`.
  - The card itself reads the raw stored JSON (`watchlist-read.ts:186`), not the adapter, so its own closed-set check is still the live one.

**Noted, not counted (out of this phase's scope):** the HARD-04 `insufficient_window` flag still uses the raw first-to-last gap (`metrics.py:2080-2081`, `:2136/2152`). So a crypto record of exactly 90 daily returns gets the flag, while D-15/D-20 clear it. Its only reader is the strategy wizard's composite caveat (`SyncPreviewStep.tsx:2879-2883`). The census routes the wizard surfaces (B6, `194-ANNUALISED-SITES.md:47-48`, `:102`) to 194.1, so 194.1 should pick this up. Re-pointing the flag to `_index_span_days` (or to `record_clears`) is the fix.

I did not assess necessity this round (I did not read `necessity-review.md`), so `necessity:` is left out of the frontmatter.

## Warnings

### WR-01: The Scenario "vs BTC" section says "252-day annualized" for a crypto blend whose TE, IR and alpha are annualised at √365 (MEDIUM, user-facing; sibling of R3 WR-02 and the round-2 WR-03 rolling caption)

**File:** `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx:209` (caption); `:152` (`computeScenarioBenchmark(portfolioDaily, btc, periodsPerYear)`); `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:6164-6170` (passes `periodsPerYear={blendBasis}`); test `ScenarioBenchmarkSection.test.tsx:110-112`

**Issue:** The section prints a hard-coded `Metrics are 252-day annualized active returns.` But:
- the values above it are annualised at `periodsPerYear`: TE, IR and alpha ride `√periodsPerYear` (`scenario-benchmark` doc, "TE/IR/alpha ride √periodsPerYear");
- the composer passes `blendBasis`, which is 365 whenever any leg is crypto or unknown, the default on this product;
- this section also judges its D-15 record with that same `periodsPerYear` (`:159-164`), so the figure-record and the caption disagree inside one component.

Failure scenario: an allocator composes a two-crypto-leg blend on /allocations Scenario.
- The rolling panel caption on the same composer reads "365-day annualized" (fixed in round 2, pinned at `ScenarioComposer.d11.test.tsx:648-658`).
- The two BatchDPanels captions now read "sample/365 basis" (R3 WR-02).
- The "vs BTC over N overlapping days" card directly below says the Tracking Error, Information Ratio and Alpha are "252-day annualized".

That is the crypto/traditional basis mix-up R3 WR-02 was raised for, still left in one place on the same page. The only test pins the literal "252-day annualized active returns" with the component's default `periodsPerYear = 252` (`:120`), so the defect cannot turn it red.

**Fix (minimal):**

```tsx
<p className="mt-2 text-fixed-11 text-text-muted">
  {methodologyLine(n)} Metrics are {periodsPerYear}-day annualized active returns.
</p>
```

Add a test that renders with `periodsPerYear={365}` and asserts `"365-day annualized active returns"` and not `"252-day"`. Keep the existing 252 assertion as the default-basis arm.

---

_Reviewed: 2026-11-08_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
