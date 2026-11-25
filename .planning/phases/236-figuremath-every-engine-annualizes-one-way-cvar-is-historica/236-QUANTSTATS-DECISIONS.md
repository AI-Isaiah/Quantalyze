# Phase 236 FIG-03: quantstats 0.0.81 to 0.0.86 per-metric decision record

Measured on a scratch interpreter (`PY086`, quantstats 0.0.86 installed on the locked
requirements, Python 3.12, numpy 2.5.4, pandas 3.0.3, scipy 1.18.0; the shared main venv was
never mutated). Every claim below was read from the 0.0.86 source or measured on `PY086` and, where
a figure moves, on the 0.0.81 venv too. Regenerate rather than trust: the numbers are bound to this
measurement, not to a later head.

## Rules this record follows (quoted verbatim)

- FIG-03: "quantstats moves to 0.0.86 in the same PR as a per-metric decision record. Re-pinning moved values without a decision is not a close."
- F-5: "Figures: one convention, '365, ddof 1 everywhere'. This applies inside the existing annualization rule: risk is annualized by frequency (crypto 365, traditional 252), returns by calendar, and a blend uses 365 if any leg is crypto. The TypeScript engines move to match Python."
- F-6: "CVaR is historical CVaR, null below a minimum number of observations."
- Q3 (founder 2026-11-25): "Yes, adopt under that rule (Recommended)". Rule: "Adopt each upstream correction unless F-5/F-6 says otherwise (CVaR stays historical)." "Confirm each against the 0.0.86 source and record a per-metric decision record."
- A2: "`serenity_index`'s CVaR leg stays historical — F-6 'CVaR is historical CVaR'."
- A3: "`common_sense_ratio` / `win_rate` / exposure take 0.0.86's observed-only NaN handling — Q3 'adopt each upstream correction unless F-5/F-6 says otherwise', after plan 04 measures the RED list in a throwaway venv."

## A7 confirmed

RESEARCH A7 (zero-fill removed from `_prepare_returns`) is CONFIRMED against the 0.0.86 source
(`quantstats/utils.py` `_prepare_returns`): the body is `data.replace([inf, -inf], NaN)` and nothing
else; its own comment reads "Missing observations stay NaN from here on... pandas aggregations skip
NaN, so statistics are computed on observed data; helpers that build a cumulative series fill
locally instead." `_prepare_returns` also gained `apply_rf` and lost the `inspect.stack()` caller-name
hack. This is why only the arms whose value depends on a NaN day moved.

## RED list (full analytics-service corpus under 0.0.86, before any edit)

`7 failed, 16670 passed, 93 skipped, 1147 warnings in 270.16s (0:04:30)` (`-n 4`, from `analytics-service/`)

```
FAILED tests/test_metrics.py::test_rank05_quantstats_pin_is_still_0_0_81
FAILED tests/test_qstats_gate.py::test_qstats_gate_calibration_non_honouring_functions_do_reach_a_preparer[cvar]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-benign_mixed]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]
FAILED tests/test_metrics.py::test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form
```

Two moves are NOT on the RED list because no live arm covered them (PSR on a NaN-carrying series,
`time_in_market`'s denominator). They were found by measuring each Q3-touched metric on the four
parity fixtures, and each gets its own row below.

## Per-metric decisions

Fixtures: `benign_mixed` (250 days, seed 15905), `golden_returns` (500 days, seed 42), `golden_nan`
(`golden_returns` with rows 10, 50, 100 set to NaN), `golden_252d` (the cross-runtime golden input).

| Metric (metrics.py symbol) | 0.0.86 change (source function) | Repo state before | Decision | Rule followed | Figure that moves, and for whom | Parity arm that pins it |
|---|---|---|---|---|---|---|
| version pin | `quantstats.__version__ == "0.0.86"` | `assert qs.__version__ == "0.0.81"` | ADOPT | FIG-03, Q3 | none (a guard) | `test_rank05_quantstats_pin_is_still_0_0_86` |
| stored `cvar`, `var_1d_95` (`_historical_var_cvar`) | `conditional_value_at_risk` default is `method="parametric"` (closed-form `_gaussian_expected_shortfall`), `"historical"` averages `series <= series.quantile(alpha)`; the 0.0.81 mixed estimator is gone | repo historical rule: sort, `k = floor(0.05 n)`, mean of `sorted[0:max(1,k)]`, null below `CVAR_MIN_OBS` | KEEP | F-6 "CVaR is historical CVaR"; Q3 "CVaR stays historical" | none. golden_252d: repo -0.028192093685001335; live 0.0.86 parametric -0.027414109363493682, live 0.0.86 historical -0.027724972787671658. The repo rule is deliberately a third estimator (floor index, no interpolation), shared with the TS twin `historicalVarCvar` | `test_figure_parity.py::test_historical_var_cvar_matches_hand_derived_vector` (repo rule vs hand-derived vector, not upstream's) and the new `test_fig03_stored_cvar_keeps_the_repo_floor_index_rule` |
| `cvar(prepare_returns=False)` gate calibration | `cvar` now honours `prepare_returns=False`: no preparer is reached on the trigger series (`conditional_value_at_risk` body) | `cvar` was a known NON-honouring calibration row in `test_qstats_gate.py` | ADOPT (the measurement) | Q3 | none. The repo does not call `cvar` (stored CVaR is `_historical_var_cvar`), so it is NOT added to `KWARG_PROVEN` (that set is held equal to the leaves the code calls); the calibration keeps `payoff_ratio`, which still reaches a preparer | `test_qstats_gate_calibration_non_honouring_functions_do_reach_a_preparer[payoff_ratio]` stays; new `test_fig03_cvar_honours_prepare_returns_false` pins the changed fact |
| `_serenity_index`, `_cvar_of_tail` (serenity's CVaR leg on the drawdown series) | `serenity_index` calls `cvar(dd)`, which is now PARAMETRIC by default | mirrored the 0.0.81 mixed estimator: mean of `dd < parametric VaR(dd)`, falling back to the VaR | ADOPT the historical tail, as 0.0.86 `cvar(dd, method="historical")` computes it: `dd.dropna()`, `dd[dd <= dd.quantile(1 - 0.95)].mean()`, NaN when empty. NOT upstream's parametric default | A2 + F-6. Alternative considered and rejected: the repo floor-index rule (`sorted[0:max(1,floor(0.05 n))]`); it is a different estimator from the one 0.0.86 computes, so no live arm could pin it. Measured: benign_mixed floor 0.14886201996071927 vs historical 0.1494210488068295 | every strategy with a drawdown. benign_mixed 0.143686058754821 to 0.1494210488068295; golden_returns -0.01831167833570924 to -0.01854033228533958; golden_nan -0.021149502360481718 to -0.021338928621832; golden_252d 0.019258489731125872 to 0.01893104775322315 (independent numpy recomputation; also a golden JSON key). No-loss series stay None (ulcer 0) | `test_q166_parity_every_mirror_matches_live_quantstats[serenity_index-*]` re-based: the live arm recomposes serenity from live `to_drawdown_series`, `ulcer_index`, `cvar(dd, method="historical", prepare_returns=False)`, `sum` and `std`, never `qs.stats.serenity_index` (it bakes the parametric default); plus `test_fig03_serenity_is_the_historical_tail_not_the_parametric_default` |
| `_common_sense_ratio` (profit_factor x tail_ratio) | `_prepare_returns` no longer `fillna(0)`; `profit_factor` and `tail_ratio` run on the observed series (`quantile` skips NaN) | mirror zero-filled (`P(r)`), so a NaN day entered `tail_ratio`'s quantiles as a 0.0% return | ADOPT observed-only NaN handling | A3; a NaN day is not a 0% return (same skipna convention as the headline Sharpe/Sortino and the no-invented-data rule) | only strategies carrying NaN gap days: golden_nan 0.9094449129830964 to 0.909416022493258. NaN-free series are bit-identical (golden_returns 0.9138072667720697 both) | `test_q166_parity_every_mirror_matches_live_quantstats[common_sense_ratio-golden_returns_with_nan_days]` (GREEN on the moved mirror) |
| `time_in_market` (`compute_qstats_scalars`; upstream `exposure`) | `_exposure` denominator is `observed = int((~isnan(ret)).sum())`, 0.0 when none | numerator `notna & != 0` over `len(returns)` (NaN gap days counted as "not in market") | ADOPT the observed denominator. KEEP the unrounded fraction (upstream still `ceil`-rounds UP to a percent) | A3; the ceil is not a correction, it is the rounding H-0724 already declined (1 active day in 252 would read 1%) | only NaN-carrying series: golden_nan 0.994 to 1.0 (497 of 497 observed). Hand case 2 active of 10 rows with 5 NaN: 0.2 to 0.4 | new `test_fig03_time_in_market_is_the_unrounded_observed_exposure` (live `qs.stats.exposure` equals the ceil-to-percent of the repo value on every parity fixture); hand-arithmetic `test_qstats_scalars_time_in_market_excludes_nan_rows` 0.2 to 0.4 |
| stored/mirror `win_rate` use (`_kelly_criterion`, `_cpc_index`; live leaf `qs.stats.win_rate(p, prepare_returns=False)`) | `_win_rate` does `series.dropna()` first | leaf called on the zero-filled `P(r)` | ADOPT (no value move) | A3 | none. A zero return is excluded from the non-zero denominator either way, so filling or dropping a NaN gives the same ratio: golden_nan 0.5110663983903421 on raw and on `P(r)` | `test_fig03_win_rate_is_nan_invariant` plus the existing kelly/cpc live arms (GREEN on all four fixtures) |
| PSR (`_probabilistic_sharpe_ratio`) | `probabilistic_ratio`: `kurtosis_no = kurtosis + 3`, variance `1 - skew*base + ((kurtosis_no - 1)/4) * base**2` (the published formula); base Sharpe through `sharpe()`, which now skips NaN; `annualize` ignored | mirror carries D-16 (`gamma4 = kurtosis + 3`), algebraically equal; the base Sharpe was on `P(r)` (zero-filled) | ADOPT (D-16 already adopted the variance; the NaN base is the newly measured part: observed-only base) | Q3, A3. `n = len(series)` (NaN rows included) is upstream's own and the mirror already reproduces it: KEPT | only NaN-carrying series: golden_nan 0.3564452921230312 to 0.35603160170583026. NaN-free series unchanged (benign_mixed 0.7691467583727061, golden_returns 0.37177281607707485 equal live) | new live arm `test_fig03_live_psr_matches_mirror[*]` on the four fixtures (impossible under 0.0.81, whose PSR carried the double-subtract defect); `test_q166_psr_matches_the_published_formula` stays |
| `_rolling_greeks` alpha | `rolling_greeks`: `means = df.rolling(periods).mean()`, `alpha = means["returns"] - beta * means["benchmark"]` (the window's own intercept) | mirror already windowed (D-17) | ALREADY-ADOPTED | Q3 | none. Max alpha gap mirror vs live: 0.0 on 0.0.86; 0.003406719654229685 against 0.0.81 | new `test_fig03_live_rolling_alpha_matches_the_mirror` replaces `test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form` (which asserted a gap to the 0.0.81 form) |
| `_greeks_no_guess`, `_r_squared` strategy-gap pairs | `greeks` and `r_squared` use `_paired_observations` (dropna on both legs) | mirror pairs through `_benchmark_pair` (166.4 D-A) | ALREADY-ADOPTED for a strategy gap and for equal-index pairs | Q3 | none. Strategy-NaN pair: greeks beta 0.04582232879504599 / alpha -0.4565415759588476 and r_squared 0.0052797272367667725 equal live. 0.0.81 `greeks` raises `ValueError` on a gapped pair | new `test_fig03_live_greeks_and_r_squared_on_a_strategy_gap_pair` (impossible under 0.0.81: it raises); the existing equal-index arms stay |
| `_r_squared` on a BENCHMARK-gap pair | live 0.0.86 `_prepare_benchmark` still rebuilds benchmark prices and zero-fills a first return when the calendars differ | mirror reads the 166.4 D-A interval pair (founder-ratified 2026-09-27) | KEEP (no change from 0.0.81 behaviour; 0.0.86 did not touch it) | 166.4 D-A and D-06, a prior founder ruling, not an F-5/F-6 override | none moved. Measured on a benchmark-NaN pair: live 0.0037907434562500187 vs mirror 0.0036314976158032027; greeks beta/alpha equal | none by design: live is not the oracle for a benchmark gap, and the existing arms pin equal-index pairs only |
| drawdown baseline (`_max_drawdown_from_wealth`, `_drawdown_series_from_wealth`) | `_get_baseline_value`: baseline 1.0 for a series rebuilt from returns, the first price otherwise; `to_drawdown_series` builds the cumulative path with a local fill | mirror pins 1.0 ("minus the price guess"), fills locally | ALREADY-ADOPTED | Q3 | none. A series starting with a -6% day: max drawdown -0.35747583977173036 and first drawdown -0.06000000000000005 equal on both versions | the existing live arms `test_rank05_benign_*` (max_drawdown) and `test_q166_parity_every_mirror_matches_live_quantstats[recovery_factor/ulcer_index/upi-*]`, GREEN on 0.0.86. HONEST LIMIT: no differentiating arm exists, because the 0.0.86 baseline change acts on price-path input the repo never feeds |
| headline sortino count (`_downside_rms`) | `sortino`: `downside` divides by `returns.count()`, not `len(returns)`, on the observed series | repo already `int(x.count())` | ALREADY-ADOPTED | Q3, Phase 166 | none. NaN-gap series: live -2.811417355886042 vs mirror composition -2.8114173558860416 (0.0.81 live -2.7944979403086943) | new `test_fig03_live_sortino_matches_the_skipna_count` (impossible under 0.0.81) |
| `ulcer_index`, `ulcer_performance_index`, `recovery_factor`, `kelly_criterion`, `payoff_ratio`, `cpc_index`, `omega` | bodies unchanged in value (formatting, docstring, `_rf_is_nonzero` only; the drawdown helpers fill locally) | mirrors | KEEP (no change) | Q3 (nothing to adopt) | none | the existing live arms, GREEN on all four fixtures including NaN days; comments re-cited to 0.0.86 |
| live leaves `value_at_risk`, `volatility`, `avg_win`, `avg_loss`, `profit_factor`, `tail_ratio`, `drawdown_details` (called `prepare_returns=False`) | none in value (`value_at_risk`, `volatility` bodies unchanged; `avg_win`/`avg_loss` lose a redundant `.dropna()`, and pandas `mean` skips NaN) | called on the raw series | KEEP (no change) | Q3 (nothing to adopt) | none; `KWARG_PROVEN` arms all GREEN under 0.0.86 (they reach no preparer) | `test_qstats_gate_kwarg_proven_leaf_never_reaches_a_preparer[*]` |

## Notes

- Every figure that moves is for a strategy with a drawdown (`serenity_index`) or with NaN gap days
  (`common_sense_ratio`, `time_in_market`, PSR). Stored `cvar` and `var_1d_95` do not move.
- The fleet re-derive (a PROD write) is the coordinator's step; this record names what it will move.
- Upstream 0.0.82-0.0.84 `kelly_criterion` churn nets to docstring-only (reverted in 0.0.84).
- Knock-ons the A2 move forced, recorded so they are decisions and not drift:
  - `_mirror_keys_defined_by` (the broken-mirror-signal predicate): serenity's third conjunct, real
    dispersion in the drawdown series, existed only because 0.0.81's parametric VaR needs a positive
    scale. Under the historical tail it is gone and the key needs a losing day plus real raw
    dispersion. `[-0.1, 0, 0, 0, 0]` was undefined and is now -0.4 (hand arithmetic,
    `test_fig03_serenity_flat_drawdown_is_defined`); its row left `_Q166R2_UNDEFINED_CASES`.
  - `value_at_risk` left `KWARG_PROVEN`: the serenity mirror was its last call site, and the gate
    holds that set EQUAL to the leaves the code calls.
  - `time_in_market` of an all-NaN series stays None (0.0.86's `_exposure` says 0.0): a figure with
    no observation behind it is undefined, not zero. Pinned by
    `test_fig03_time_in_market_of_an_all_nan_series_is_none_not_zero`.
- Observation, not a change: 0.0.86 `kelly_criterion`, `cpc_index`, `payoff_ratio` and
  `recovery_factor` now ACCEPT `prepare_returns=` but still reach a preparer with it False (measured
  with the gate's spy on the trigger series: `R,R,R,R` / `R,R,R,R,R` / `R,R` / `P`), so the inline
  mirrors stay justified. `probabilistic_ratio`, `serenity_index` and `ulcer_index` still raise
  TypeError on the keyword.
- Golden JSON: `metrics_json.serenity_index` in `golden_252d_expected.json` moved by hand from
  0.019258489731125872 to 0.01893104775322315, the independent closed-form value (numpy: drawdown
  path, ulcer with the n-1 denominator, 5% quantile, mean of the days at or below it, ddof-1 std).
  No other golden key moves: the golden input carries no NaN day. `regen_golden.py` was not run.
