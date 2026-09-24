---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 09
subsystem: phase disclosure (D-10 / D-11 / D-13) and ledgers
status: complete
tags: [rank-05, quantstats, qstats-truth, disclosure, d-10, d-11, d-13, windows-5, windows-9, todos-0f]
requires:
  - "166-01 .. 166-08 (every mirror, the gate and the per-plan D-10 rows this plan consolidates)"
provides:
  - "D-10 before/after table measured from two code trees"
  - "D-11 read-only census SQL for the founder"
  - "D-13 reader list re-grepped at HEAD"
  - "WINDOWS.md entries 5 and 9 fixed; TODOS 0f closed"
affects: [166-10]
tech-stack:
  added: []
  patterns: ["two-tree disclosure: git archive of services/ at the phase base and at HEAD, measured in separate python processes on verbatim fixture recipes"]
key-files:
  created: []
  modified:
    - .planning/WINDOWS.md
    - TODOS.md
decisions:
  - "Every movement measured between the phase base and HEAD is inside the admitted set (guess closure, D-15, D-16, D-17, and treynor as a derived mover). No defect was found, so nothing was re-baselined"
  - "The harness diffs the WHOLE flattened compute_all_metrics payload and every sibling kind, not only the named keys, so a movement outside the named keys would have been seen"
metrics:
  duration: ~35min
  completed: 2026-09-24
requirements: [SC-1, SC-5, TODOS-0f, WINDOWS-5, WINDOWS-9]
plan_head_before: c7d5aafb8d3a4d3b2b6e06252d240021b325a4a3
actuals:
  tokens: 3274
  tasks: 2
  commits: 1
---

# Phase 166 Plan 09: disclosure of every changed value, census SQL and ledger closures Summary

This plan measures every value Phase 166 changed. It runs the phase-base `services/` tree and the
HEAD tree side by side on the same fixtures. Every measured movement is one the phase's decisions
admit, and each one has its own row below. The golden file moved on exactly the two disclosed key
paths. The plan also writes the census SQL for the founder, re-checks the readers, and closes
WINDOWS.md entries 5 and 9 and TODOS 0f.

`actuals.commits: 1` is the measured `git rev-list --count <plan_head_before>..HEAD` before this
SUMMARY was written. Task 1 produces no repository file by design: its harness, the two extracted
trees and the two JSON outputs live in `<scratchpad>/`. The SUMMARY commit is the second.
`actuals.tokens` is chars/4 over the realized diff (TODOS.md + WINDOWS.md).

## Library decision (SC-1, D-01, D-02)

**Does quantstats stay? Yes.** It stays pinned at `quantstats==0.0.81` (`analytics-service/requirements.in`,
`requirements.txt`, and the dev pin in `requirements-dev.txt`). No dependency file changed in this
phase.

- **PyPI re-read at execution (2026-09-24):** `info.version` = **0.0.81**. The upload time is
  2026-01-13T18:18:20. The four newest releases are `0.0.75, 0.0.76, 0.0.77, 0.0.81`. No newer
  release exists, so D-01 routes nothing to Phase 165.
- **What production still calls:** the census in `166-07-SUMMARY.md` lists 13 quantstats call
  nodes. 12 are `kwarg-proven` calls on 7 leaf functions (`avg_loss`, `avg_win`, `profit_factor`,
  `tail_ratio`, `value_at_risk`, `volatility`, `win_rate`), each with the constant
  `prepare_returns=False`. Each leaf has a behavioural preparer-spy pin (plan 08). The 13th is
  `drawdown_details`, which is `exempt` because it consumes the drawdown curve and never a returns
  series (pinned by `test_rank05_drawdown_details_is_heuristic_free`). The other 11 former sites
  are inline mirrors.
- **The live parity oracle:** tests call live 0.0.81 as the non-self-referential anchor on benign
  fixtures. The three disclosed corrections are the exception: PSR (D-16), the scalar greeks on
  NaN-bearing input (D-15) and rolling alpha (D-17). Each of these is anchored to an independent
  in-test formula instead.
- **OPEN-1 is moot.** Research §Q1 found upstream `main` identical to tag `v0.0.81` (GitHub
  compare: ahead 0, behind 0), with both heuristics still present. The only maintained fork,
  `quantstats-lumi` 1.1.5, also carries both heuristics. Neither open upstream PR (#541, #545)
  removes the guess. There is nothing to adopt.
- **Removal belongs to Phase 165.** That phase owns the dependency campaign. The notes it needs are
  under Findings below.

## Before / after (D-10)

**Method.** `BEFORE_SHA` = **`73cbf2995da56879f4c242347c9a9c05d910118a`**. That is the parent of
`88dd7fafe`, the first commit since `git merge-base HEAD origin/main` that touches
`analytics-service/services/metrics.py`, and the same phase base that plans 03-06 diffed their golden
against. `git archive` extracted `analytics-service/services` at `BEFORE_SHA` into
`<scratchpad>/q166-09-before/` and at HEAD (`c7d5aafb8`) into `<scratchpad>/q166-09-after/`.
`<scratchpad>/q166_disclosure.py` rebuilds each fixture from recipes copied verbatim from
`tests/test_metrics.py` and `tests/conftest.py`. It asserts that it imported the tree it was pointed
at, calls `compute_all_metrics(returns, benchmark)` (default periods 252) and
`compute_qstats_scalars`, and writes one JSON per tree. The two runs used `<venv>/bin/python` in
separate processes, cwd `<scratchpad>/`, with `PYTHONPATH` pointing at each extracted
`analytics-service`. Values are read from the persisted dict: `result.metrics_json["metrics_json"][key]`
for the scalars, `result.metrics_json["cagr"]`, and `result.sibling_kinds["rolling_alpha" / "rolling_beta"]`
as written (4 decimal places). `compute_qstats_scalars` read directly agreed with the persisted dict
on every fixture in both trees.

**Movement check, beyond the named keys.** The harness also stores the FULL flattened
`result.metrics_json` and every sibling kind. `<scratchpad>/q166_diff.py` lists every path that
moved. Output per fixture:

| fixture | moved `metrics_json` paths | moved sibling kinds |
|---|---|---|
| canonical_trigger | common_sense_ratio, probabilistic_sharpe_ratio, recovery_factor, serenity_index, ulcer_index, upi | none |
| nonmonotone_trigger | common_sense_ratio, cpc_index, kelly_criterion, probabilistic_sharpe_ratio, recovery_factor, serenity_index, ulcer_index, upi | none |
| benign_all_positive | probabilistic_sharpe_ratio | none |
| benign_mixed | probabilistic_sharpe_ratio | none |
| golden_returns + benchmark_returns | probabilistic_sharpe_ratio | rolling_alpha |
| golden_returns with 3 NaN days + benchmark_returns | alpha, beta, probabilistic_sharpe_ratio, treynor | rolling_alpha |
| `_q166_benchmark_trigger` | alpha, beta, probabilistic_sharpe_ratio, r_squared, treynor | rolling_alpha, rolling_beta |
| `_q166_calendar_mismatch` | probabilistic_sharpe_ratio | rolling_alpha |

(All the `metrics_json` paths are under the inner `metrics_json.` dict. No top-level key moved,
including `cagr`, `sharpe`, `max_drawdown` and every chart series.)

Every movement is in the admitted set:
- **D-16:** PSR moved on all eight fixtures. Each one has a non-zero Sharpe, so a PSR that stayed
  put would itself have been a defect.
- **D-17:** `rolling_alpha` moved on all four benchmarked fixtures. On each of them its point
  count equals `rolling_beta`'s.
- **D-15:** alpha, beta and treynor moved only on the NaN-bearing benchmarked fixture. On the
  NaN-free benchmarked fixtures (golden, calendar mismatch) they are bit-identical.
- **Guess closure:** the three trigger fixtures moved in the keys each was built to trip.
- **Treynor, as a derived mover:** it moved only where beta moved, and cagr is unchanged on every
  fixture.
- **Unchanged:** `r_squared` and `rolling_beta` did not move on any non-trigger fixture.

**No movement fell outside the admitted set, so the plan did not stop.**

### The table

| metric key | fixture | before | after | reason |
|---|---|---|---|---|
| recovery_factor | canonical trigger (`_rank05_trigger_series`) | 2.0737188382869305 | None | guess closure (D-04/D-09): no losing day means max drawdown is 0, so the ratio is undefined |
| ulcer_index | canonical trigger | 0.9947130555497081 | 0.0 | guess closure: no drawdown, so the RMS drawdown is 0 |
| upi | canonical trigger | 2.9998728744771372 | None | guess closure (D-09): ulcer is 0 |
| kelly_criterion | canonical trigger | None | None | unchanged in value. Before, it was None for the wrong reason (the guessed series had no positive day) |
| probabilistic_sharpe_ratio | canonical trigger | 0.1531252134903383 | 0.9998517975825096 | guess closure (a PSR below 0.5 for a series that never lost a day), then D-16 |
| common_sense_ratio | canonical trigger | 0.0 | None | guess closure (D-09): no losing day, so profit factor is undefined |
| cpc_index | canonical trigger | None | None | unchanged in value, wrong reason before (as kelly) |
| serenity_index | canonical trigger | 0.3204442673452879 | None | guess closure (D-09): ulcer is 0 |
| recovery_factor | non-monotone trigger (`_q166_trigger_nonmonotone`) | 92.05882352941175 | None | guess closure (D-09) |
| ulcer_index | non-monotone trigger | 0.9919239385213344 | 0.0 | guess closure |
| upi | non-monotone trigger | 4.117455241335786 | None | guess closure (D-09) |
| kelly_criterion | non-monotone trigger | 0.3890395480225989 | None | guess closure (D-09): no losing day, so payoff is undefined |
| probabilistic_sharpe_ratio | non-monotone trigger | 0.9997018052168664 | 0.9999997591042462 | guess closure, then D-16 |
| common_sense_ratio | non-monotone trigger | 23.98015435501653 | None | guess closure (D-09) |
| cpc_index | non-monotone trigger | 11.695887516415286 | None | guess closure (D-09) |
| serenity_index | non-monotone trigger | 0.36207650738764285 | None | guess closure (D-09) |
| r_squared | benchmark trigger (`_q166_benchmark_trigger`) | 0.006670639650444322 | 0.0037210240094842093 | guess closure on the benchmark leg (D-03/D-05). The squared Pearson correlation of the raw pair is 0.0037210240094842067 |
| alpha | benchmark trigger | 0.12212418616146373 | 0.1516558141912828 | guess closure on the benchmark leg (D-05) |
| beta | benchmark trigger | -0.015400848308443902 | 0.007651507459018336 | guess closure on the benchmark leg (D-05) |
| treynor | benchmark trigger | -12.262021576082311 | 24.680827308810883 | derived: cagr / beta, and beta moved per D-05. cagr is unchanged at 0.1888455342481099. Treynor changes sign and stays present |
| rolling_beta (161 points, last 2024-12-13) | benchmark trigger | -0.0889 | -0.7555 | guess closure on the benchmark leg (D-06). All 161 written points changed, and the point count is unchanged |
| rolling_alpha (161 points, last 2024-12-13) | benchmark trigger | -0.0007 | 0.005 | D-06 guess closure plus D-17 windowed intercept. All 161 written points changed, and the count still equals rolling_beta's |
| probabilistic_sharpe_ratio | benchmark trigger | 0.8344501196416503 | 0.8341066738127161 | D-16 only. The strategy leg is benign, and the other seven dispatched scalars are bit-identical |
| alpha | golden_returns with 3 NaN days + benchmark_returns | 0.0 | -0.05937915926821179 | D-15: pairwise-complete greeks. The 0.0 came from 0.0.81's `fillna(0)` |
| beta | golden 3-NaN-day variant | 0.0 | -0.020437191682559225 | D-15 |
| treynor | golden 3-NaN-day variant | absent | 3.891200099567501 | derived: cagr / beta, and beta moved per D-15. cagr is unchanged at -0.07952520231005455. Before, treynor was skipped because beta was 0 |
| rolling_alpha (411 points, last 2024-11-29) | golden 3-NaN-day variant | -0.0003 | 0.0002 | D-17. 403 of 411 written points changed. rolling_beta is unchanged (last 0.0423) |
| probabilistic_sharpe_ratio | golden 3-NaN-day variant | 0.3564313296632511 | 0.3564452921230312 | D-16 |
| probabilistic_sharpe_ratio | golden_returns + benchmark_returns | 0.37176286348610654 | 0.37177281607707485 | D-16 |
| rolling_alpha (411 points, last 2024-11-29) | golden_returns + benchmark_returns | -0.0002 | 0.0002 | D-17. 403 of 411 written points changed. rolling_beta, alpha (-0.052418708977644966), beta (-0.020102356752731546), treynor (4.083225956399804) and r_squared (0.0011339717436389088) are bit-identical |
| probabilistic_sharpe_ratio | calendar mismatch (`_q166_calendar_mismatch`) | 0.7023657243124253 | 0.702243350077209 | D-16 |
| rolling_alpha (71 points, last 2024-09-11) | calendar mismatch | 0.0005 | -0.0003 | D-17. 67 of 71 written points changed. rolling_beta, alpha (0.13859455190461534), beta (0.012560995909126458), treynor (10.244913675949753) and r_squared (0.0005305518445182663) are bit-identical |
| probabilistic_sharpe_ratio | `_rank05_benign_mixed` | 0.7693296699257343 | 0.7691467583727061 | D-16 only. The other seven scalars are bit-identical |
| probabilistic_sharpe_ratio | `_rank05_benign_all_positive` | None | 1.0 | D-16 only. The 0.0.81 variance term went negative, so live PSR was undefined. The published PSR saturates the normal CDF |

Every value above matches the per-plan D-10 rows in the 03, 04, 05 and 06 SUMMARYs where they
overlap. Rolling values are the written 4-dp points. The unrounded benchmark-trigger rolling
values are in `166-06-SUMMARY.md`.

**Canonical-trigger assertion (Task 1 verify 1):** `before ulcer 0.9947130555497081 after ulcer 0.0`,
exit 0. The assertion also checks that recovery is None and PSR > 0.5.

### Golden phase diff

Flattened key-path compare of `git show 73cbf2995:analytics-service/tests/fixtures/golden_252d_expected.json`
against the working tree (Task 1 verify 2):

```
phase golden key paths moved: ['metrics_json.metrics_json.probabilistic_sharpe_ratio', 'sibling.rolling_alpha']
```

Exit 0. Exactly the two disclosed paths.

| golden key path | before | after | reason |
|---|---|---|---|
| `metrics_json.metrics_json.probabilistic_sharpe_ratio` | 0.5815691494050974 | 0.5815640555270074 | D-16 |
| `sibling.rolling_alpha` | 163 points, last 2025-12-18 = 0.0002 | 163 points, last 2025-12-18 = 0.0023. 154 of 163 values changed, and every date is unchanged | D-17 |

`sibling.rolling_beta` is equal before and after (measured).

**Added 2026-09-24, code review round 1 (IN-04): one byte movement with no value change.** The
regeneration also re-sorted three keys inside two sub-objects. The key-path compare above is
dict-based, so it could not see this, and until now no row described it. D-10 treats an undescribed
fixture movement as a defect, so it gets its own row:

| golden key path | before | after | reason |
|---|---|---|---|
| key ORDER of `mean_daily_turnover_usd`, `mean_monthly_turnover_usd` and `mean_trade_size_usd` inside `metrics_json.trade_metrics` and `metrics_json.volume_metrics` | not alphabetical (`mean_trade_size_usd` before `mean_monthly_turnover_usd` in both, and `mean_daily_turnover_usd` ahead of `expectancy` in `trade_metrics`) | alphabetical | Cosmetic, from the regeneration serialiser. No value, key or key count changed, and every parity reader is dict-based. Kept, not reverted. |

**Added 2026-09-24, code review round 1: corrected values on CONSTANT-series inputs (SFH HIGH-1
and its class).** None of the fixtures above moves: the golden, parity and trigger tests pass
unchanged. These rows come from the same two-tree method as the table above. Before is the tree at
`2c5733bb7` and after is the round-1 fix tree. Values are read from `compute_all_metrics(r, b)` and
`sharpe_vol_status_from_backbone(r, 252)`.

| metric key | fixture | before | after | reason |
|---|---|---|---|---|
| sharpe | constant `0.001`, 120 business days | 3.645128673430614e+16 | None | HIGH-1: `std()` of a constant series is float residue, not 0 |
| backbone `(vol, sharpe, status)` | constant `0.001`, 120 business days | (6.9e-18, 3.645e+16, `ok`) | (0.0, None, `zero_volatility`) | HIGH-1 |
| sharpe | constant `-0.002`, 250 business days | -7.306168277482229e+16 | None | HIGH-1 |
| backbone `(vol, sharpe, status)` | constant `-0.002`, 250 business days | (6.9e-18, -7.306e+16, `ok`) | (0.0, None, `zero_volatility`) | HIGH-1 |
| probabilistic_sharpe_ratio | constant `-0.002`, 250 business days | 1.294498818537706e-110 | None | HIGH-1: the PSR base is the same primitive |
| serenity_index | constant `-0.002`, 250 business days | -2.2339635725366214e-18 | None | HIGH-1 class: serenity's `std == 0` test now uses the same residue guard |
| alpha | normal(0.001, 0.01) strategy vs a constant `0.001` benchmark, 250 days | 0.3386020485210516 | None | HIGH-1 class: the greeks benchmark-variance test now uses the same residue guard (D-09) |
| beta | same pair | -1.9200000000000002 | None | same |
| treynor | same pair | 0.07804666007757768 | absent | derived: skipped because beta is undefined |

The TypeScript tests that read the golden were run at HEAD through the D-19 `node_modules` link:
`metrics-parity.test.ts`, `metrics-parity-helper.test.ts`, `MetricPanel.types.test.ts` and
`contracts-registry.test.ts` gave `Test Files 4 passed (4)` / `Tests 101 passed (101)`. The link
was removed afterwards.

## Findings recorded, not changed (D-08)

- **F-1: scalar greeks alpha is annualized on the FREQUENCY clock.** `_greeks_no_guess` computes
  `(mean(r) - beta*mean(b)) * periods`, which is an arithmetic return scaled by
  `periods_per_year` (365 crypto / 252 traditional). It is not scaled on the calendar clock. For a
  sparse series (fewer rows than calendar days) the two differ. `test_periods_param_rescales_365`
  pins the current behaviour, and the `_greeks_no_guess` docstring records it. It is recorded, not
  changed. Rolling alpha is not affected: it stays an unannualized per-period intercept (Phase 34).
- **`recovery_factor`'s numerator is arithmetic, `upi`'s is compounded.** `_recovery_factor` uses
  `returns.sum()`, while `_ulcer_performance_index` uses `comp(r) = r.add(1).prod() - 1`. This is
  an inconsistency inside quantstats 0.0.81, and the mirrors reproduce it so that benign values do
  not move (D-08). The `_recovery_factor` docblock records it.
- **F-2, fixed under D-16:** PSR fed pandas EXCESS kurtosis into a term that expects the
  non-excess fourth moment. See the PSR rows above; all eight fixtures moved.
- **F-3, fixed under D-15:** `greeks` ended in `.fillna(0)`, so a NaN-bearing benchmarked series
  persisted `alpha = 0.0, beta = 0.0`. See the golden 3-NaN-day rows above.
- **F-4, fixed under D-17:** rolling alpha used full-sample means. See the rolling_alpha rows above.
- **Routed to Phase 165, changing nothing here (re-measured at HEAD):**
  - `services/metrics.py` now imports `from scipy.stats import linregress, norm` directly. But
    `requirements.txt` pins `scipy==1.18.0` only `# via quantstats`, so removing quantstats would
    drop scipy unless `requirements.in` promotes it.
  - `requirements.in` pins `pandas==2.2.3` while the lock carries `pandas==3.0.3`.

## Surfaces (D-13)

Re-grepped at HEAD over `src/`: `--include='*.ts' --include='*.tsx'`, excluding `*.test.*` and
`__tests__`, for every affected key and its camelCase form.

| key | readers under `src/` | how null renders |
|---|---|---|
| `recovery_factor`, `ulcer_index`, `common_sense_ratio` / `commonSenseRatio` | `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, `src/lib/factsheet/compute.ts`, `src/lib/factsheet/types.ts`, and the scenario payload builder `scenario-factsheet-payload.ts` | These read the TS `compute()` summary from dailies (`view.strategyMetrics`), not `metrics_json`. `num()` / `pct()` render `—` for null or non-finite values |
| `upi`, `kelly_criterion`, `probabilistic_sharpe_ratio`, `cpc_index`, `serenity_index`, `r_squared` (and camelCase) | **none** | persisted-only |
| `alpha`, `beta`, `treynor` (metrics_json) | `src/lib/queries.ts` `getStrategyDetailV2` builds `benchmark_greeks`: `typeof metricsJson["alpha"] === "number" ? … : null`, the same for beta, and `treynor_ratio` then `treynor`. That feeds `ExposureAndGreeksPanel`, then `BenchmarkGreeksTable`, where `fmt()` returns null for a null or non-finite value, and `MetricCell` renders `value ?? "—"` | em-dash |
| `treynor` in `MetricsColumn.tsx` / `src/lib/factsheet/joint.ts` / `comparator-block.ts` | TS-computed from dailies (`joint.treynor`), not `metrics_json` | not affected |
| `rolling_alpha`, `rolling_beta` (sibling kinds) | `src/lib/queries.ts` (sibling-kind projection), `RollingMetricsPanel`, `RollingAlphaBetaChart` (`alpha ?? []` / `beta ?? []`, and `null` when both are empty); `src/lib/metrics-parity-helper.ts` reads the golden in tests only | empty series is handled. NaN points never reach JSONB (`_finalize_rolling` drops non-finite values) |
| `rollingBeta` (camelCase) | `src/lib/factsheet/rolling.ts`, `FactsheetView.tsx`, `chart-configs.ts`, `comparator-block.ts`, the scenario payload | TS-computed from dailies, not the sibling kind; not affected |

**No surface renders null as 0 or crashes, so D-13 needs no TS change.** The eight dispatched
scalars (recovery_factor, ulcer_index, upi, kelly_criterion, probabilistic_sharpe_ratio,
common_sense_ratio, cpc_index, serenity_index) have no `metrics_json` reader under `src/`. Their
wrong values were persisted but never rendered. `r_squared` is also persisted-only. The
rendered surfaces this phase changes are alpha/beta/treynor in the Benchmark greeks table (D-15,
and the guess closure on a guess-tripping benchmark) and the rolling alpha/beta chart (D-17 for
every benchmarked strategy).

## Census SQL for the founder (D-11, read-only)

**This phase recomputed no PRODUCTION row and connected to no remote database.** Every statement
below is a `SELECT`, and the founder runs them. The founder has already answered OPEN-2
(2026-09-24, `166-CONTEXT.md`): after 166 merges, run the census and queue a recompute of the
affected rows through the normal job path. Plan 10 records that decision. Column and table names
were checked against `supabase/schema/baseline.sql` (`strategy_analytics.metrics_json jsonb`;
`strategy_analytics_series (strategy_id, kind, payload jsonb, computed_at)`;
`benchmark_prices (date, symbol, close_price)`).

```sql
-- READ-ONLY. (1) Guess-trigger population: strategies whose last computed input tripped the
-- quantstats guess. The guess fires when min(r) >= 0 AND max(r) >= 1 (the union of the
-- _prepare_returns and _prepare_prices conditions). daily_returns_grid is the stored proxy of the
-- series compute_all_metrics saw.
SELECT sas.strategy_id,
       min((e->>'value')::float8) AS min_r,
       max((e->>'value')::float8) AS max_r,
       count(*)                   AS n_days
FROM public.strategy_analytics_series sas
CROSS JOIN LATERAL jsonb_array_elements(sas.payload) AS e
WHERE sas.kind = 'daily_returns_grid'
  AND jsonb_typeof(sas.payload) = 'array'
GROUP BY sas.strategy_id
HAVING min((e->>'value')::float8) >= 0
   AND max((e->>'value')::float8) >= 1;

-- READ-ONLY. (2) Benchmark leg: has the cached BTC series ever had a >= +100% day? Expected: no
-- row with r >= 1.
SELECT date, close_price,
       close_price / lag(close_price) OVER (ORDER BY date) - 1 AS r
FROM public.benchmark_prices
WHERE symbol = 'BTC'
ORDER BY r DESC NULLS LAST
LIMIT 5;

-- READ-ONLY. (3) D-15 NaN-greeks fabricated-zero population: rows whose persisted alpha AND beta
-- are both exactly 0. After recompute these become the pairwise-complete values, or null when
-- beta is undefined.
SELECT count(*) AS alpha_and_beta_exactly_zero
FROM public.strategy_analytics
WHERE jsonb_typeof(metrics_json->'alpha') = 'number'
  AND jsonb_typeof(metrics_json->'beta')  = 'number'
  AND (metrics_json->>'alpha')::float8 = 0
  AND (metrics_json->>'beta')::float8  = 0;

-- READ-ONLY. (4) D-17 population: strategies with a non-empty rolling_alpha series. Every one of
-- them renders a different rolling alpha after its next compute.
SELECT count(DISTINCT strategy_id) AS strategies_with_rolling_alpha
FROM public.strategy_analytics_series
WHERE kind = 'rolling_alpha'
  AND jsonb_typeof(payload) = 'array'
  AND jsonb_array_length(payload) > 0;

-- READ-ONLY. (5) D-16 population: rows carrying probabilistic_sharpe_ratio (persisted-only, no
-- reader under src/). Every non-zero-Sharpe row moves after recompute; a row whose PSR is null
-- today may gain a value.
SELECT count(*) FILTER (WHERE metrics_json ? 'probabilistic_sharpe_ratio')                     AS rows_with_psr_key,
       count(*) FILTER (WHERE jsonb_typeof(metrics_json->'probabilistic_sharpe_ratio') = 'number') AS rows_with_numeric_psr
FROM public.strategy_analytics;
```

**Caveats to read with the results:**
- `daily_returns_grid` is capped to the most recent 5000 points by `cap_data_points`. Older days
  of a longer series are not visible to query (1).
- The grid is rounded to 6 dp. A value within 5e-7 of the `>= 1` boundary can land on either side.
- Query (1) sees the series as persisted in the grid. If a per-basis recompute fed quantstats a
  differently conditioned series, the grid is a proxy, not the exact input.
- Query (3) counts exactly-zero pairs. A genuine 0.0 alpha and 0.0 beta would also be counted, but
  that is not a realistic outcome for real data.
- **Ledger venues never re-compute on their own** (project memory: `process_key_long` is enqueued
  only at creation). Their stored values stay pre-fix until a recompute is explicitly queued. That
  is exactly what OPEN-2's answer asks for.

## Gate evidence

- **The census:** `166-07-SUMMARY.md` "The printed census". It lists 13 quantstats nodes in
  `services/metrics.py`, 11 mirrors and 0 violations, with arms kwarg-proven=12, exempt=1 and
  inline=11. It prints through `pytest_terminal_summary` on every run, a green run included.
  Re-observed this session: `tests/test_metrics.py tests/test_metrics_parity.py tests/test_qstats_gate.py`
  printed the census and `298 passed, 100 warnings in 13.97s`.
- **Needles and neuter drills:** `166-08-SUMMARY.md`. It has 12 RED needles, 1 importer needle and
  3 GREEN needles through the production `scan_source` / `scan_tree`. It has behavioural
  preparer-spy pins over `sorted(KWARG_PROVEN)`, and `cvar` / `payoff_ratio` calibration rows.
  Four real-file neuter drills were each observed RED naming the site and then restored
  byte-identical.
- **30 vs 9:** the "30 call sites" of success criterion 2 was a text count. At the phase start,
  `services/metrics.py` had 30 literal `qs.stats.` occurrences (count with `grep -cF`, since a regex
  grep reads 42) against 9 AST call nodes. Most occurrences were comments and docstrings. The
  scanner run on the phase-start file found exactly those 9 nodes, with 4 open (`greeks`, the
  getattr dispatch over 8 scalars, `r_squared`, `rolling_greeks`). Now there are 33 text
  occurrences against 13 nodes, with 0 open. The mirrors' docblocks add text hits. The mirrors'
  kwarg-proven leaf calls add nodes: 9 - 4 + 8 = 13. The printed reconciliation line carries both
  readings.

## Ledgers

Closure commit **`9aadde8c0`** `docs(166): close WINDOWS 5 and 9 and TODOS 0f`.
`git show --name-only` lists exactly `.planning/WINDOWS.md` and `TODOS.md`.

**gsd-tools handler, collateral check.**
1. Before the call, `git status --porcelain` was captured to `<scratchpad>/q166-09-status-before.txt`.
   It was empty.
2. Byte backups were taken: `<scratchpad>/q166-09-bak-{WINDOWS.md,STATE.md,ROADMAP.md,state.json}`,
   each confirmed with `cmp`.
3. `node ~/.claude/gsd-core/bin/gsd-tools.cjs windows fixed 5`, then `... windows fixed 9`. Both
   returned `"ok": true`.
4. After the call, `git status --porcelain` showed exactly one new line: ` M .planning/WINDOWS.md`.
5. `cmp` against the backups: `STATE.md`, `ROADMAP.md` and `state.json` were **unchanged**. There
   was **no collateral**, so nothing was restored.
6. `git diff -- .planning/WINDOWS.md` touched only:
   - the frontmatter: `open_count` 50 → 48, `fixed_count` 16 → 18, and `last_updated`;
   - table rows 5 and 9: status `open` → `fixed`, plus a `resolved_at` timestamp;
   - the matching `"status"` / `"resolved_at"` fields of entries 5 and 9 in the file's embedded
     JSON block. That block is the handler's own mirror of the same two rows.
   There was no other change.

**Verify results:**
- `grep -E '^\| (5|9) \| 159 \|' .planning/WINDOWS.md | grep -c '| fixed |'` = 2, exit 0.
- `tsx scripts/check-planning-hygiene.ts`, run with both files staged, reported
  `OK — 7022 tracked files scanned`, exit 0. The link was removed before commit
  (`test -L node_modules` was false).

**TODOS 0f `[159-SIMPLIFY-DEFER]`:** the lineage text is kept. A dated note was appended:
"✅ CLOSED 2026-09-24 by Phase 166 QSTATS-TRUTH". It names the plan 01 primitives, the plan 07-08
AST gate and the plan 02 KPI array derived from `PERCENTILE_METRICS`. `grep -c 'CLOSED .* by Phase 166'
TODOS.md` = 1. `grep -c REFUTED TODOS.md` is 3, against 2 at `BEFORE_SHA`.

**The refuted claim.** WINDOWS.md entry 9 and the 159-05 Residual table called `recovery_factor`,
`kelly_criterion`, `common_sense_ratio`, `cpc_index` and `r_squared` "kwarg-closable". The phase's
preparer-spy measurement (research §Q2, pinned in tests by plan 08) refuted that: none of them honours
`prepare_returns=False` all the way to the preparers. `recovery_factor`, `kelly_criterion`,
`common_sense_ratio`, `cpc_index` and the benchmark leg of `r_squared` / `greeks` /
`rolling_greeks` all went to inline mirrors. The TODOS note, the closure commit message, and the
mirror docblocks (plans 03-05) each state this.

## Deviations from Plan

None. The plan was executed as written.

- **TDD:** this plan adds no production or test code. Its measurements are the plan's own `<verify>`
  commands, and each one was run and exited 0 (quoted above). There was no RED/GREEN cycle to run.
- **Beyond the plan (measurement only, nothing committed):**
  - The harness diffs the whole flattened payload, not only the named keys, so movement anywhere
    else would have been caught.
  - The four TS tests that read the golden were run to confirm D-17's golden move breaks no TS
    reader.
- Census SQL (1) gained a `jsonb_typeof(sas.payload) = 'array'` guard beyond the research text, so
  a non-array payload cannot abort `jsonb_array_elements`.

## Known Stubs

None.

## Threat Flags

None. The only files changed are the two ledgers.
- T-166-17: SQL is table-level, and hygiene passed while staged.
- T-166-18: every statement is a SELECT, and nothing was recomputed.
- T-166-19: the table was measured from two trees, and the golden diff shows exactly two paths.
- T-166-20: byte backups, a `cmp` check, and no collateral.

## Self-Check: PASSED
