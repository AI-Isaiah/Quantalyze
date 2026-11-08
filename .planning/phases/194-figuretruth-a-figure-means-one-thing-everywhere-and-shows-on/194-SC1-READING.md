# Phase 194 SC-1: read-only PROD reading of what each page shows per figure

Purpose (TRUST-04, SC-1): record, before any code of this phase changes, the value each page shows
for each metric TRUST-04 names, for one published strategy (S1) and for the book, and name the cause
of each difference from the RESEARCH engine matrix ("Engine and field matrix", "Where the same name
differs today"). The PROD rows are evidence and stay as they are.

Operator: the orchestrator session. Stored values through the Supabase MCP, one statement per call,
never chained. The marker statement (Q0) runs first and alone; its answer must equal
`database_marker` in `scripts/prod-prober/cron-manifest.json`, otherwise nothing further runs. Page
values are read in the founder's signed-in browser with no control that writes. Only if the MCP is
unreachable does the CLAUDE.md CLI fallback run, still one statement per call.

Public repo rules: strategies are labelled S1 and "book", never named or identified. Money is
recorded as a relation (equal, not equal, a ratio), percentages to 2 dp. No id, dollar amount,
account number, user id or home path is written here.

Every statement below is a SELECT. Copy each as it stands.

## Q0 marker

SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();

Result: the marker answered the PRODUCTION text, equal to `database_marker` in `scripts/prod-prober/cron-manifest.json`. Run first and alone through the approved MCP channel, 2026-11-07T16:54Z.

## Q1 stored figures

S1 is chosen by the statement itself: the published, non-example strategy with a computed analytics
row and the longest return series, ties broken by id (the id is never selected).

SELECT sa.cumulative_return,
       sa.cagr,
       sa.sharpe,
       sa.sortino,
       sa.calmar,
       sa.volatility,
       sa.max_drawdown,
       sa.six_month_return,
       sa.metrics_json->>'three_month' AS three_month,
       sa.metrics_json->>'var_1d_95' AS var_1d_95,
       sa.metrics_json->>'cvar' AS cvar,
       jsonb_array_length(sa.returns_series) AS series_len,
       sa.returns_series->0->>'date' AS series_first,
       sa.returns_series->-1->>'date' AS series_last,
       sa.data_quality_flags->>'headline_since' AS headline_since,
       (s.aum IS NOT NULL) AS aum_is_set
  FROM public.strategy_analytics sa
  JOIN public.strategies s ON s.id = sa.strategy_id
 WHERE s.status = 'published'
   AND NOT s.is_example
   AND sa.computation_status IN ('complete', 'complete_with_warnings')
   AND jsonb_typeof(sa.returns_series) = 'array'
 ORDER BY jsonb_array_length(sa.returns_series) DESC, s.id
 LIMIT 1;

Result (as percentages, 2 dp): cumulative 16.34, CAGR 24.08, Sharpe 0.96, Sortino 2.41, Calmar 2.45, volatility 25.48, max drawdown -9.83, six_month_return 16.60, three_month 1.89, var_1d_95 -2.13, cvar -3.40; series_len 257, series_first 2026-02-23, series_last 2026-11-06 (256 days), headline_since null, aum_is_set true.

## Q2 fleet counts

Per asset class: complete rows, and how many carry fewer than 365 calendar days between the first
and last series date, fewer than 90 calendar days, and fewer than 60 observations (D-15's crypto
and non-crypto bounds).

SELECT t.asset_class,
       count(*) AS complete_rows,
       count(*) FILTER (WHERE t.span_days < 365) AS under_365_days,
       count(*) FILTER (WHERE t.span_days < 90)  AS under_90_days,
       count(*) FILTER (WHERE t.obs < 60)        AS under_60_obs
  FROM (SELECT s.asset_class,
               ((sa.returns_series->-1->>'date')::date - (sa.returns_series->0->>'date')::date) AS span_days,
               jsonb_array_length(sa.returns_series) AS obs
          FROM public.strategy_analytics sa
          JOIN public.strategies s ON s.id = sa.strategy_id
         WHERE sa.computation_status IN ('complete', 'complete_with_warnings')
           AND CASE WHEN jsonb_typeof(sa.returns_series) = 'array'
                    THEN jsonb_array_length(sa.returns_series) > 0
                    ELSE false END) t
 GROUP BY t.asset_class
 ORDER BY t.asset_class;

Result: crypto 11 complete rows, 8 under 365 days, 1 under 90 days, 1 under 60 observations; traditional 16 complete rows, 11 under 365 days, 1 under 90 days, 1 under 60 observations.

## Page readings

Stored value for each S1 row is the Q1 answer; the page cells record what each page shows.
`n/a` is a page that does not show the metric.

| metric | My Strategies | factsheet | tearsheet | Holdings | Scenario | cause |
|---|---|---|---|---|---|---|
| 6 Month | +16.60% (discovery list) | +15.30% | +16.60% | n/a (S1 not in book) | n/a | stored = last 126 rows; factsheet = calendar window offsetDays(182) |
| 3 Month | n/a | +21.24% | n/a | n/a | n/a | stored 1.89% = last 63 rows; factsheet offsetDays(90) differs by far more than the 90 vs 91 day question; cause to be confirmed in plan 02 |
| VaR 95% | n/a | -0.86% | -2.13% | n/a | n/a | stored = quantstats parametric; factsheet = historical floor-index quantile |
| CVaR 95% | n/a | -2.03% | -3.40% | n/a | n/a | tail rule: stored mean under parametric VaR; factsheet mean of floor(0.05n) smallest |
| CAGR | +24.08% | +24.1% (1 dp) | +24.08% | n/a | n/a | agree (factsheet overlays stored at full history); factsheet prints 1 dp |
| Sharpe | 0.96 | 0.96 | 0.96 | n/a | n/a | agree; no short-record gate on list or tearsheet (factsheet warns: 256 observations) |
| Sortino | n/a | 2.41 | 2.41 | n/a | n/a | agree; no short-record gate on tearsheet |
| Calmar | n/a | 2.45 | 2.45 | n/a | n/a | agree; no short-record gate on tearsheet |
| Volatility | +25.48% | 25.48% | +25.48% | n/a | n/a | agree; sign prefix differs by page |
| Return % | +16.34% | +16.34% | +16.34% | n/a | n/a | agree |
| Max DD | -9.83% | -9.83% | -9.83% | n/a | n/a | agree |
| tearsheet AUM row | AUM cell shown, = strategies.aum (aum_is_set true) | n/a | Minimum Allocation = list AUM, ratio 1.000 (read as admin) | n/a | n/a | label naming: one field, two names (AUM vs Minimum Allocation) |
| book equity | n/a | n/a | n/a | n/a | Scenario AUM input / Holdings Gross 0.815, / Holdings Net 1.022 | Overview shows no book equity figure: equity history held back (latest rebuild failed its checks); relations to equity n/a |
| book exposure (gross and net) | n/a | n/a | n/a | Net/Gross 0.798, Long/Gross 0.899, Short/Gross 0.101, Long - Short = Net within 1%; labels Gross/Net unqualified, "net long" | basis: 90 overlapping days, no Models N of M note | Gross and Net unlabelled by quantity; Scenario AUM differs from both Gross and Net |

## Lines

marker: PRODUCTION
sc1-head: ac3fa8c89affb75e7d1866a1271024f514572bf2
sc1-read-at: 2026-11-07T16:54Z
sc1-source: mcp+browser
sc1-metric: 6 Month pages=differ cause=row-count 126 stored vs calendar 182 days factsheet
sc1-metric: 3 Month pages=differ cause=row-count 63 stored vs calendar 90 days factsheet, gap larger than 90 vs 91
sc1-metric: VaR 95% pages=differ cause=parametric stored vs historical quantile factsheet
sc1-metric: CVaR 95% pages=differ cause=CVaR tail rule differs (parametric vs historical floor)
sc1-metric: CAGR pages=agree cause=factsheet overlays stored at full history (1 dp display)
sc1-metric: Sharpe pages=agree cause=same stored value; no short-record gate on list or tearsheet
sc1-metric: Sortino pages=agree cause=same stored value; no gate on tearsheet
sc1-metric: Calmar pages=agree cause=same stored value; no gate on tearsheet
sc1-metric: Volatility pages=agree cause=same stored value; sign prefix differs
sc1-metric: Return % pages=agree cause=same stored value
sc1-metric: Max DD pages=agree cause=same stored value
sc1-metric: tearsheet AUM row pages=agree cause=same field, label naming AUM vs Minimum Allocation
sc1-metric: book equity pages=differ cause=no equity headline shown (history held back); Scenario AUM differs from Holdings Gross and Net
sc1-metric: book exposure pages=differ cause=Gross and Net unlabelled by quantity

## Reading

Today the factsheet and the stored row disagree on four figures for S1: 6 Month (15.30% vs 16.60%), 3 Month (21.24% vs 1.89%), VaR 95% (-0.86% vs -2.13%) and CVaR 95% (-2.03% vs -3.40%). The list and the tearsheet print the stored values, so the same name shows two numbers depending on the page. The causes are the engine split RESEARCH names: row-count windows in the producer against calendar windows in the factsheet engine, and a parametric VaR/CVaR in the producer against a historical quantile in the factsheet. The 3 Month gap is far larger than either the 63-row vs 90-day or the 90 vs 91 day difference would explain on its own, so plan 02 should confirm its cause before it locks D-03. CAGR, Sharpe, Sortino, Calmar, Volatility, Return % and Max DD agree on every page that shows them, because the factsheet overlays the stored scalars at full history. Only the factsheet warns about the short record (256 observations, 0.70y, against 257 stored rows); the list and the tearsheet print Sharpe, Sortino and Calmar with no gate. The tearsheet's Minimum Allocation is the same field the list calls AUM. For the book, the Overview shows no equity figure (the history is held back after a failed rebuild), Holdings' Gross and Net carry no quantity label, and the Scenario AUM matches neither Gross (0.815) nor Net (1.022). Fleet: 19 of 27 complete rows span under 365 days and 2 under 90 days, so D-14 and D-15 gates will withhold figures on most strategies.
