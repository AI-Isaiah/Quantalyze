---
phase: 166
round: 1
reviewed_range: origin/main...aeefaf733
date: 2026-09-24
reviewer: silent-failure-hunter
scope: git diff origin/main...HEAD excluding .planning/ (services/metrics.py mirrors and call sites, tests/qstats_gate.py, conftest census hook, csv-finalize route, percentile-core.ts, queries.ts)
counts:
  critical: 0
  high: 2
  medium: 2
  low: 4
  info: 2
---

# Phase 166 QSTATS-TRUTH: silent-failure review, round 1

Method: read the full diff. Ran `tests/test_metrics.py` and `tests/test_qstats_gate.py` (263 passed) in a
throwaway copy of `analytics-service/`, then ran 14 single-arm neuter drills against that copy. The branch
checkout was never edited. Probed the AST gate with bypass snippets through `scan_source`, and probed the
mirrors directly on constant and tz-aware series.

Neuter-drill results (RED = at least one test failed, which is the result we want):

| drill | arm neutered | result |
|---|---|---|
| N1 | `_greeks_no_guess` zero-variance returns `0.0, 0.0` | RED |
| N2 | `_greeks_no_guess` pair `fillna(0)` instead of `dropna()` | RED |
| N3 | `_probabilistic_sharpe_ratio` drops the D-16 `+ 3` | RED |
| N4 | `_rolling_greeks` alpha on full-sample means | RED |
| N5 | `_safe_qstats_scalar` returns `0.0` on exception | RED |
| N6 | `_recovery_factor` `max_dd == 0` returns `0.0` | RED |
| N8 | `_serenity_index` `sd == 0` returns `0.0` | **GREEN (survives)** |
| N9 | `_ulcer_performance_index` `u == 0` returns `0.0` | RED |
| N10 | `_serenity_index` `den == 0` returns `0.0` | **GREEN (survives)** |
| N11 | `_greeks_no_guess` RAISES on zero benchmark variance | **GREEN (survives)** |
| N12 | `_greeks_no_guess` RAISES on fewer than 2 complete rows | **GREEN (survives)** |
| N13 | `_kelly_criterion` NaN-payoff guard returns `0.0` | RED |
| N14 | `_payoff_ratio_no_guess` `avg_loss == 0` returns `0.0` | GREEN (unreachable arm, see INFO-1) |
| N15 | `_annualized_vol_sharpe` no-divide branch returns sharpe `0.0` | **GREEN (survives)** |

---

## HIGH

### HIGH-1: `_annualized_vol_sharpe` guards only an EXACT zero vol, so a constant-return series persists a Sharpe of about 3.6e16

**Location:** `services/metrics.py`, `_annualized_vol_sharpe`. Consumers: the headline `sharpe` in
`compute_all_metrics`, `sharpe_vol_status_from_backbone`, and the `info_ratio` / tracking-error pair.

**Issue:** the no-divide branch is `if vol == 0.0 or math.isnan(vol)`. For a constant series such as
`0.001` every business day, pandas `std()` returns a floating-point residue near 1e-19, not 0.0. The
branch is skipped and the quotient is persisted. Measured on the branch: `compute_all_metrics` over 120
days of constant `0.001` returns **`sharpe = 3.645128673430614e+16`**. `sharpe_vol_status_from_backbone`
takes the same path. Its `vol == 0.0` test also misses, so it reports status `ok` with that Sharpe.

**Pre-existing, not a regression.** The main branch computes the same quotient inline. It belongs to this
phase anyway, for two reasons. Phase 166 extracted the arithmetic into a primitive whose docstring presents
the no-divide branch as the zero-vol handling. And drill N15, which changes that branch to return `0.0`,
survives the whole suite, so no test ever reaches the branch that is supposed to prevent this. Sharpe is a
ranked KPI (`PERCENTILE_METRICS`), so one constant-yield strategy lands at the top of every Sharpe
percentile. This breaks the "no invented data" rule: the panel shows a number where it should show nothing.

**Hidden errors:** zero-variance input (constant-yield or stablecoin-lending series, a single repeated
value after upstream dedup, a CSV with one value carried forward).

**Recommendation:** treat vol as zero when it is negligible relative to the series scale, for example
`vol <= 1e-12 * max(1.0, abs(r.mean()) * periods_per_year)` or `r.dropna().nunique() <= 1`. Apply that one
test in the primitive, so the headline, the backbone and `info_ratio` all inherit it. Add a
constant-series test asserting `sharpe is None` and backbone status `zero_volatility`. That test is what
turns N15 RED.

### HIGH-2: the AST gate cannot see any quantstats surface other than `stats`: `extend_pandas`, `reports`, `plots`, `from quantstats import reports`

**Location:** `tests/qstats_gate.py`, `scan_source` (rules B1 to B4 only inspect `<qs>.stats.*`,
`getattr(<qs|stats>, …)` and utils/preparer names).

**Issue:** measured through `scan_source("services/metrics.py", …)`. Each of these returns **0 violations
and 0 scanned nodes**:

- `qs.extend_pandas()` followed by `r.max_drawdown()`
- `qs.reports.metrics(r, display=False)`
- `qs.plots.snapshot(r)`
- `from quantstats import reports; reports.metrics(r)`
- `importlib.import_module("quantstats").stats.sharpe(r)`
- `vars(qs)["stats"].sharpe(r)`

`extend_pandas` is the dangerous case. It attaches every guessing stats function to `pd.Series`, so every
later call such as `returns.sharpe()` or `returns.max_drawdown()` contains no quantstats token that the AST
can see. The module docstring says the gate judges every production module's quantstats use, and the
census would print "clean" with these present. The gate cannot fail for this whole class. The last two
shapes are contrived and could be left as a recorded limit, but the first four are ordinary quantstats
usage.

**Recommendation:** add a rule B5. Any attribute of a quantstats alias other than `stats` is RED unless it
is explicitly allowlisted, with `extend_pandas` named as RED. Any `from quantstats import <X>` with X not
`stats` is RED. Add red needles for `extend_pandas`, `reports` and `plots` to
`test_qstats_gate_red_needle_is_named`.

---

## MEDIUM

### MEDIUM-1: `test_q166_greeks_undefined_beta_is_none_not_zero` passes when the whole benchmark fan-out aborts

**Location:** `tests/test_metrics.py`, `test_q166_greeks_undefined_beta_is_none_not_zero`. Behaviour under
test: the benchmark block of `compute_all_metrics` and `_greeks_no_guess`.

**Issue:** the test asserts `mj.get("alpha") is None`, which is also true when the key is ABSENT. The
benchmark block's `except Exception` logs a WARNING and drops alpha, beta, correlation, info_ratio, treynor
and `btc_rolling_correlation_90d` together. Drills N11 and N12 make `_greeks_no_guess` raise on both
undefined-beta paths, and both survive. So the D-09 contract ("undefined is None") cannot be told apart
from "the fan-out crashed and five sibling metrics vanished".

**Recommendation:** assert `"alpha" in mj and mj["alpha"] is None` (same for beta). In the flat-benchmark
case also assert `"info_ratio" in mj`: tracking error is positive there, so info_ratio must survive. Use
`caplog` to assert that no `benchmark_metrics fan-out failed` record was emitted.

### MEDIUM-2: two `_serenity_index` undefined arms are untested (a fabricated 0.0 would ship green)

**Location:** `services/metrics.py`, `_serenity_index` (`sd == 0` and `den == 0` branches).

**Issue:** drills N8 and N10 change each branch to return `0.0` instead of NaN, and both survive. The D-09
tests reach serenity's None through a NaN VaR on the all-winning fixtures, never through these branches. If
either branch regresses, a strategy with no drawdown persists serenity `0.0` ("measured, terrible")
instead of None. For comparison, the `upi` and `recovery_factor` equivalents (N9, N6) go RED.

**Recommendation:** add fixtures that hit each branch. A constant series reaches `den == 0` through ulcer
0 (see HIGH-1 on exact-zero `sd`). The `sd == 0` arm is probably unreachable for the same float-residue
reason, so either reach it with a series whose `std()` is exactly 0 (all zeros), or record it as a parity
arm with no reachable input.

---

## LOW

### LOW-1: the benchmark mirrors raise `TypeError` on tz-aware input where 0.0.81 `greeks` succeeded

**Location:** `_greeks_no_guess`, `_r_squared`, `_rolling_greeks` (all through
`_align_benchmark_like_qs`).

**Issue:** each mirror tz-normalises the strategy leg first, then compares its naive index against a
still-tz-aware benchmark index. Measured with UTC-localised series: all three raise `Cannot compare dtypes
datetime64[us, UTC] and datetime64[us]`. Live `qs.stats.greeks(..., prepare_returns=False)` returned the
correct alpha and beta on the same input. Today this cannot be reached, because `compute_all_metrics`
already raises earlier on tz-aware input (the `ytd` comparison). If that changes, the benchmark fan-out
`except` swallows the error into a WARNING, and alpha, beta, correlation, info_ratio and treynor all
disappear. The `_greeks_no_guess` docstring claims the tz step exists "so the pairwise join lines the two
legs up by date", but for tz-aware input it does the opposite.

**Recommendation:** in `_align_benchmark_like_qs`, normalise the benchmark with `_tz_naive_like_qs` before
the `set(period) != set(benchmark.index)` comparison. Alternatively, record that the mirrors require
tz-naive input and assert it at entry.

### LOW-2: rolling and scalar greeks use different NaN conventions on the same page, and the difference is not recorded

**Location:** `_rolling_greeks` (`.fillna(0)` on the joined frame) compared with `_greeks_no_guess`
(pairwise-complete, D-15).

**Issue:** scalar alpha and beta drop gap days (D-15 argues that zero-filling fabricates observations). The
rolling pair keeps 0.0.81's `df.fillna(0)`, so a gap day enters every 90-day window as a 0.0 return on
either leg. The `_rolling_greeks` docstring quotes the fillna under MATH PARITY, but does not record it as a
deliberate divergence from D-15.

**Recommendation:** add one sentence to the `_rolling_greeks` docstring that records it (D-08 parity kept on
purpose, divergence from D-15), or align the two conventions.

### LOW-3: `_recovery_factor` shows a net-losing strategy as a POSITIVE recovery factor

**Location:** `_recovery_factor`, `abs(total) / abs(max_dd)`.

**Issue:** this matches 0.0.81 (D-08), but the docstring's "RECORDED, NOT CHANGED" note covers only the
arithmetic-versus-compounded numerator. The `abs()` sign loss is a second quantstats inconsistency that
reaches the UI and is not recorded.

**Recommendation:** record it in the same note.

### LOW-4: an undefined mirror result and a broken mirror both become None with no log line

**Location:** `_safe_qstats_scalar` and the eight mirrors. Example: `_probabilistic_sharpe_ratio`, where
`np.sqrt` of a negative inner term gives NaN.

**Issue:** D-09 intentionally maps NaN to None. But a mirror that starts returning NaN because of a bug is
indistinguishable from a legitimately undefined ratio: there is no status companion (unlike `r_squared`'s
`r_squared_status`) and no log line. The only output is a numpy `RuntimeWarning` that does not name the
scalar. The benign golden fixture limits the damage, since a mirror going NaN on benign data turns
`golden_252d_expected.json` RED.

**Recommendation:** accept it as recorded. Optionally, log at DEBUG with the scalar name when a mirror
returns non-finite on a series with at least one loss and at least one gain.

---

## INFO

- **INFO-1: `_payoff_ratio_no_guess` `avg_loss_val == 0` is an unreachable parity arm.** quantstats
  `avg_loss` is the mean of strictly negative values, so it is either negative or NaN. Drill N14 surviving
  is expected. Keep the arm for 0.0.81 parity and optionally note that it cannot be reached.
- **INFO-2: `compute_qstats_scalars` sets `r_squared_status = "error"` on a non-finite `r_squared` without
  a log line.** The exception path does log. This is pre-existing, and the new `_r_squared` does not change
  it.

## Done well

- D-15 removes the fabricated `alpha = 0.0, beta = 0.0`, and N1 and N2 both go RED.
- `_safe_qstats_scalar` keeps a per-scalar WARNING with a deduped traceback. N5 goes RED across the whole
  dispatch table.
- The gate's anti-vacuity checks (node count, importer equality, census = nodes) and the preparer-spy
  calibration rows for `cvar` and `payoff_ratio` let the spy prove it can fail.
- The TypeScript byte pins (`queries.percentile-columns.test.ts`, the csv-finalize BYTE PIN) are written by
  hand and are not recomputed from the source they pin. No silent-failure change in the csv-finalize
  route: its error handling is untouched and only the column list is derived.
