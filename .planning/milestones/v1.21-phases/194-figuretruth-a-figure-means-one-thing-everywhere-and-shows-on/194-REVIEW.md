---
phase: 194-figuretruth
round: 2
reviewed: 2026-11-07T00:00:00Z
reviewed_at_sha: 75f69d42eced35873651879bf7d19415d6c9fae8
depth: standard
files_reviewed: 17
files_reviewed_list:
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/basis-metrics.ts
  - src/lib/factsheet/comparator-block.ts
  - src/lib/factsheet/allocator-portfolio-payload.ts
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/page.tsx
  - supabase/migrations/20261107140000_get_verified_cohort_rank_span_gate.sql
  - supabase/migrations/down/20261107140000-rollback.sql
  - src/components/portfolio/PortfolioImpactPanel.tsx
  - src/lib/api/simulatorSchema.ts
  - src/lib/record-span-read.ts
  - src/app/browse/[slug]/[strategyId]/page.tsx
  - src/components/strategy/StrategyGrid.tsx
  - analytics-service/services/match_engine.py
  - analytics-service/services/portfolio_optimizer.py
  - analytics-service/services/simulator_scoring.py
findings:
  critical: 0
  warning: 2
  info: 0
  total: 2
status: issues_found
---

# Phase 194: Code Review Report, round 2

**Reviewed:** 2026-11-07, at HEAD `75f69d42e`
**Depth:** standard. Only MEDIUM and above are reported, as the brief asked.
**Status:** issues_found. The coverage is PARTIAL; see "Not reviewed" below.

## Summary

Founder decisions this round is judged against, quoted from 194-CONTEXT.md:
- D-15: "The withhold gate is the strategy's TOTAL track record, never the selected window." "non-crypto, 60 return observations (trading days, `MIN_ANNUALIZATION_OBS`)".
- D-16: "The factsheet benchmark column (BTC / S&P 500) shows CAGR, volatility, Sharpe, Sortino and Calmar on any zoom, with the same muted under-1y note as the strategy column. Phase 170.6 D-07's 90-day overlap gate on the benchmark summary is superseded."
- D-18: "a record under the D-15 minimum leaves the Sharpe and Sortino peer sets and stays in the Max drawdown set."
- D-19: "When the strategy's TOTAL record is under the D-15 minimum, the factsheet benchmark column's annualised cells (CAGR, volatility, Sharpe, Sortino, Calmar) are withheld with the same reason."

**Round-1 fixes I checked and found correct:**
- **CR-01:** `record_observations` is now read without condition (`fetch-and-build-payload.ts:933-939`) and passed to the native build and to `buildUsdView` (`:1069`, `:1155`). `build-payload.ts:899` reads it from the new `recordObservations` option. The select at `:318` projects it. The allocator-portfolio build (`allocator-portfolio-payload.ts:113`) gets no count. A blend has no stored count, so it falls back to the span bound (A-194-D15-02), which I accept.
- **D-19:** the benchmark cells go through the strategy's `gv` (`MetricsColumn.tsx:361`, `:393-398`). A short total record therefore withholds both columns together.
- **D-18 (SQL):** `v_n` is the rec_ok set and is used for Sharpe and Sortino and as `cohort_n`. `v_n_all` is the Max DD set. The early return fires on `v_n_all`, and min-N is applied per rank (`20261107140000_...sql:312`, `:335`, `:364-366`). The `cohort_n` semantics are documented in the header (`:46-55`). The ARMS_FLOOR arithmetic in `ci.yml` checks out: 418 − 6 + 14 = 426. The down migration carries no `rec_ok`, so it restores the pre-phase body.
- **SFH-M3 (simulator):** an absent `annualization_periods` now withholds `sharpe_delta` and gives a reason (`PortfolioImpactPanel.tsx:555-564`).
- **Span-read:** `readRecordSpan` reports its own failures (`record-span-read.ts:94`). The `createClient` catch in `browse/.../page.tsx` reports and logs with the id, and the caption is shown.
- **StrategyGrid:** the CAGR uses the table's `rowRecord`, `gateAnnualized` and `annualizedCell`. The grid shows no other annualised figure.

Necessity was not assessed: I did not read `necessity-review.md` this round, so `necessity:` is left out of the frontmatter.

**Not reviewed (fail loud). This round ran out of budget before part 2 was done.** Read in full or diffed and judged above: the files in the list. NOT reviewed this round:
- the AlphaBetaDecomposition gate fix and the `seed-demo-data.ts` `returns_series` fix (D-17), with their tests;
- the TS side of D-18 in `percentile-core.ts`. Round 1 read it as already keeping Max DD, but I did not re-read it here;
- PortfolioOptimizer, ScenarioComposer, ScenarioBenchmarkSection, `scenario-factsheet-payload.ts`, the tearsheet page, AnalyticalPanels, BatchDPanels, `chart-configs.ts`, `rolling-window-choice.tsx`, `scenario-peer-request.ts`, `return-stats.ts`, `types.ts`;
- every test file, so the question of whether each test can fail was NOT answered.

That part of the scope is still open and needs another review pass before this phase can be called reviewed.

## Warnings

### WR-01: At full history, the benchmark column shows annualised figures over a short overlap with no note, which D-16 requires (a regression from the D-16 fix)

**File:** `src/lib/factsheet/comparator-block.ts:105-121` (`summaryOf`), `src/app/factsheet/[id]/v2/MetricsColumn.tsx:353-361`, `:393-398`

**Issue:** The D-16 fix deleted the 170.6 overlap gate from `summaryOf`. It also deleted the line that said why the benchmark cells read "—". The only qualifier left for the benchmark is the strategy's `gateNote`. That note comes from `gateAnnualized(figureRec, gateWindowSpan)`, and at full history `gateWindowSpan` is `undefined`. The note therefore depends only on the strategy's record.

The benchmark summary, however, is computed over the comparator's own covered dates (`summary: summaryOf(benchSummary)`, which is built from `coveredDates`). Take a strategy with a record of a year or more and a comparator that covers only a short span, for example S&P 500 data that starts late. Then:
- the strategy column shows its figures plain, which is correct;
- the benchmark column shows CAGR, volatility, Sharpe, Sortino and Calmar annualised over that short overlap, with no note at all.

This is the case Phase 170.6 recorded on PROD (`page.tsx:269`: "SPX over 5 days read a Sharpe of 10.24"). It now ships with no note, while D-16 requires "the same muted under-1y note as the strategy column". D-16 lifts the withhold. It does not lift the note, and the note is now absent exactly where the benchmark's own window is under a year. The `bnDated` header ("{bn} to {date}") marks only a comparator that stops early, not one that starts late. User-facing; MEDIUM.

**Fix:** Measure the benchmark's own covered span. When it is under 365 days, give the benchmark column the D-13 muted note even if the strategy's state is `full`. D-19 still decides whether the cells are withheld.

```ts
// comparator-block.ts: carry the covered span on the block (one new field)
coveredSpanDays: coveredDates.length >= 2 ? spanDays(coveredDates[0], coveredDates[coveredDates.length - 1]) : null,

// MetricsColumn.tsx, beside gateNote
const benchSpan = cmpBlock?.coveredSpanDays ?? null;
const benchNote = bn != null && gateState !== "withheld" && benchSpan != null && benchSpan < 365
  ? shortTrackNote("range", benchSpan) /* worded for the benchmark */ : null;
```

Pin it with a MetricsColumn test: a strategy record of two years and a comparator covering 20 days. The benchmark Sharpe shows, and the note is present.

### WR-02: The match engine gates every Sharpe-lift reason on the crypto 90-day bound, so a non-crypto record that clears D-15 on 60 observations is withheld here and shown everywhere else

**File:** `analytics-service/services/match_engine.py:795-808` (`unknown_class_crypto = blend_gate_crypto([None])`, passed for both the candidate and the book)

**Issue:** `blend_gate_crypto([None])` is `True` (`metrics.py:144`: unknown counts as crypto). The match engine therefore judges every candidate and every book on the 90-calendar-day bound. D-15 says "non-crypto, 60 return observations". Its sibling `portfolio_optimizer.py` gates the same lift on the real asset classes (`periods_per_year_for_asset_class(...) == 365`, `book_gate_crypto`).

Take a traditional strategy with 60 to 64 weekday observations, about 84 to 89 days:
- it clears on the list, the factsheet (after CR-01), the optimizer and Holdings;
- it loses its "Lifts portfolio Sharpe by …" reason in the match engine.

That is two verdicts for one record, the failure TRUST-05 targets. The code comment says the engine "holds no asset class". That explains the choice, but it does not make the choice the D-15 rule. The error runs in the conservative direction, since it withholds more than D-15 asks, which is why this is a WARNING and not a BLOCKER.

**Fix:** Pass `strategies.asset_class` for the candidate and the book legs into `_compute_portfolio_fit_components`. The optimizer already receives `asset_classes`, so use the same projection. Call `sharpe_lift_gate(..., periods_per_year_for_asset_class(cand_class) == 365, blend_gate_crypto(book_classes))`. Add a pytest: a traditional candidate with 62 observations over 87 days keeps its lift reason, and with 59 observations it loses it.

## Lineage: round 1 (2026-11-07, 23 files)

Round 1 found 1 critical and 2 warnings:
- **CR-01:** the factsheet gated non-crypto records on 90 days, not 60 observations, whenever no cash headline was admitted, and the USD view always did.
- **WR-01:** a zoomed factsheet withheld the benchmark column on window length.
- **WR-02:** the SQL cohort and the TS percentiles disagreed on the Max DD peer set.

It also rated the AlphaBetaDecomposition disagreement as user-facing, at least MEDIUM.

The founder decided D-16, D-18 and D-19 on these findings. Round 2 confirms that CR-01, D-18 (SQL) and D-19 are fixed as decided. WR-01 above is a new defect introduced by the D-16 fix.

---

_Reviewed: 2026-11-07_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
