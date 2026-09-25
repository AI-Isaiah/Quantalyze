---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 05
subsystem: analytics-service/services/metrics.py
status: complete
tags: [rank-05, quantstats, qstats-truth, money-math, windows-9, benchmark, greeks, r-squared]
requires:
  - _prepared_returns_no_guess
  - _annualized_vol_sharpe
  - _q166_golden_with_nan_days
provides:
  - _tz_naive_like_qs
  - _align_benchmark_like_qs
  - _r_squared
  - _greeks_no_guess
  - "from scipy.stats import linregress, norm"
  - _q166_benchmark_trigger
  - _q166_calendar_mismatch
  - _q166_benchmark_pair
affects: [166-06, 166-07]
tech-stack:
  added: []
  patterns: ["benchmark leg mirrors 0.0.81 _prepare_benchmark minus the guess, reindex/bfill branch kept"]
key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py
decisions:
  - "r_squared prepares the benchmark twice against the UNALIGNED series, as 0.0.81 does (Pitfall 3); linregress, not corrcoef"
  - "Scalar alpha/beta are computed over pairwise-complete rows of the M1 pair and are None when beta is undefined (D-15); 0.0.81's trailing fillna(0) is not reproduced"
  - "The tz step of 0.0.81 is a shared helper _tz_naive_like_qs, applied to the prepared strategy index as well as the benchmark, because the prepared strategy index is the alignment period"
metrics:
  duration: ~25min
  completed: 2026-09-24
requirements: [SC-2, SC-4, SC-5, WINDOWS-5, WINDOWS-9]
plan_head_before: 497d90914ba330eb3c0e8267641983573e3aa99f
actuals:
  tokens: 5983
  tasks: 2
  commits: 2
---

# Phase 166 Plan 05: Scalar benchmark leg (r_squared, alpha, beta) Summary

Plan 05 closes the quantstats price guess on the scalar benchmark leg. `r_squared` in
`compute_qstats_scalars` and alpha/beta in the `compute_all_metrics` M1 block are now inline
mirrors of quantstats 0.0.81. Their benchmark leg goes through `_align_benchmark_like_qs`, which is
0.0.81 `_prepare_benchmark` minus the guess. Alpha/beta also take the D-15 correction: a
NaN-bearing strategy no longer persists a fabricated `alpha = 0.0, beta = 0.0`, and an undefined
beta is None. No golden key path moved.

`actuals.commits: 2` was measured with `git rev-list --count <plan_head_before>..HEAD` before this
SUMMARY was written. The SUMMARY commit is the third. `actuals.tokens` is chars/4 over the realized
diff, which is about 23,931 changed characters.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer): `_align_benchmark_like_qs` + `_r_squared`, wired through `compute_qstats_scalars`, fault tests re-targeted | df4c09de5 | `services/metrics.py`, `tests/test_metrics.py` |
| 2: `_greeks_no_guess` on the M1 pair, pairwise-complete, None-not-zero | 097966d84 | `services/metrics.py`, `tests/test_metrics.py` |

## RED-first evidence (D-09)

### Task 1, against plan 04's end state (`qs.stats.r_squared` still called)

From `analytics-service/`: `pytest tests/test_metrics.py -q -k "q166_benchmark or q166_parity_r_squared or r_squared_status"`

```
E       AssertionError: r_squared=0.006670639650444322; squared correlation of the raw pair is 0.0037210240094842067
E       AssertionError: persisted r_squared=0.006670639650444322; squared correlation is 0.0037210240094842067
E       AssertionError: r_squared changed under a joint pair permutation: 0.006670639650444322 -> 0.00558463303811363
3 failed, 7 passed, 213 deselected in 1.09s
```

The three failures are `..._is_the_squared_correlation`, `..._reaches_metrics_json` and
`..._is_pair_permutation_invariant`. The anti-vacuity test and the three parity cases passed on the
pre-mirror code, as they should: live quantstats is the reference on benign pairs.

After the mirror went in, before the fault tests were re-targeted, the two `r_squared_status` fault
tests failed. They monkeypatched `qs.stats.r_squared`, which production no longer calls. After the
re-target: `10 passed, 213 deselected` (floor 10).

### Task 2, against Task 1's end state (`qs.stats.greeks(..., prepare_returns=False)` still called)

`pytest tests/test_metrics.py -q -k "q166_benchmark_greeks or q166_greeks or q166_parity_greeks"`

```
E       AssertionError: beta=-0.015400848308443902; OLS slope of the raw pair is 0.007651507459018336
E       AssertionError: fabricated zeros: alpha=0.0, beta=0.0
E       AssertionError: alpha=0.0 over a zero-variance benchmark
3 failed, 2 passed, 223 deselected, 2 warnings in 1.14s
```

pytest stops at the first failing assert, so the one-complete-pair sub-case of
`test_q166_greeks_undefined_beta_is_none_not_zero` was measured separately on the same pre-fix tree
with a scratchpad probe (`<scratchpad>/`, not committed): alpha 0.0, beta 0.0. After the mirror:
`5 passed`.

## D-10 disclosure rows (changed values)

Every value was measured by running `compute_all_metrics(...)` (default periods 252), reading
`["metrics_json"]` for alpha/beta/treynor/r_squared and the top-level `cagr` key. The before column
was measured on the tree before each task's edit, and the after column on the tree after it.
Nothing was computed by hand.

| Metric key | Fixture | Before | After | Reason |
|---|---|---|---|---|
| r_squared | `_q166_benchmark_trigger` | 0.006670639650444322 | 0.0037210240094842093 | benchmark guess removed. The squared Pearson correlation of the raw pair is 0.0037210240094842067 |
| beta | benchmark trigger | -0.015400848308443902 | 0.007651507459018336 | benchmark guess removed |
| alpha | benchmark trigger | 0.12212418616146373 | 0.1516558141912828 | benchmark guess removed |
| treynor (derived: cagr / beta, cagr 0.1888455342481099) | benchmark trigger | -12.262021576082311 | 24.680827308810883 | follows beta. It changes sign and stays present |
| alpha | `golden_returns` with 3 NaN days + `benchmark_returns` | 0.0 | -0.05937915926821179 | D-15. The 0.0 was fabricated by 0.0.81's `fillna(0)` |
| beta | same | 0.0 | -0.020437191682559225 | D-15 |
| treynor (derived, cagr -0.07952520231005455) | same | absent | 3.891200099567501 | follows beta. It was skipped while beta was 0 |
| r_squared | same | 0.0011742485146902892 | 0.0011742485146902892 | unchanged (the benchmark cannot trip the guess) |
| alpha / beta | 60-day strategy vs a constant 0.001 benchmark | 0.0 / 0.0 | None / None | D-15 / D-09: zero benchmark variance means beta is undefined. treynor stays absent |
| alpha / beta | strategy with one non-NaN day vs a moving benchmark | 0.0 / 0.0 | None / None | D-15: fewer than 2 complete pairs |

Unchanged, measured the same way: on clean `golden_returns` + `benchmark_returns`, alpha
-0.052418708977644966, beta -0.020102356752731546, treynor 4.083225956399804 and r_squared
0.0011339717436389088 have the same value before and after.

Treynor is the only persisted value derived from alpha/beta. `correlation` and `info_ratio` read the
aligned pair directly, and their lines in the M1 block are unchanged.

**Golden scope.** The key-path diff against the phase-base golden (parent of 88dd7fafe) printed
`golden key paths moved since phase base: ['metrics_json.metrics_json.probabilistic_sharpe_ratio']`
(exit 0) after Task 1 and again after Task 2. That is plan 04's PSR path only, so the r_squared,
alpha and beta key paths did not move. `tests/test_metrics_parity.py` recomputes the golden and
compares it at rel 1e-12. It passed unedited in both full runs, and so did
`test_periods_param_rescales_365`. `git diff --quiet <merge-base> -- tests/test_metrics_parity.py
tests/test_composite_headline_parity.py` exits 0.

## Parity with live quantstats 0.0.81 (D-08)

- `test_q166_parity_r_squared_matches_live_quantstats` is parametrized over three pairs, one
  collected case each: (`golden_returns`, `benchmark_returns`), `_q166_calendar_mismatch()`
  (a 160-row weekday strategy vs a 366-row calendar-day benchmark, so the reindex/bfill branch
  runs), and (`golden_returns` with NaN days, `benchmark_returns`). All three are equal to live
  `qs.stats.r_squared` at rel 1e-12.
- `test_q166_parity_greeks_match_live_quantstats_on_nan_free_series` covers
  (`golden_returns`, `benchmark_returns`) and `_q166_calendar_mismatch()`. It compares against live
  `qs.stats.greeks(aligned_r, aligned_b, periods=252, prepare_returns=False)` on the inner-join pair,
  at rel 1e-12.

## Findings recorded, not changed

- **F-1 (D-08):** alpha is an arithmetic return annualized on the FREQUENCY clock (`periods`), not
  the calendar clock. The `_greeks_no_guess` docstring records it. `test_periods_param_rescales_365`
  still pins it.
- The strategy index is tz-normalised inside `_greeks_no_guess` before the pairwise join. 0.0.81
  does not need that, because `np.cov` pairs by position. Without it, a tz-aware strategy would not
  line up with the tz-naive prepared benchmark. On tz-naive input (every fixture, and the parity
  runs) it does nothing.

## Verification

| Check (from `analytics-service/`) | Result |
|---|---|
| Task 1 verify 1: `-k "q166_benchmark or q166_parity_r_squared or r_squared_status"` | `10 passed, 213 deselected` (floor 10) |
| Task 1 verify 2: `pytest -q -n auto` | `6161 passed, 90 skipped, 453 warnings` |
| mypy, CI's exact command (`--strict --follow-imports=silent --config-file=pyproject.toml` over `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`), after Tasks 1 and 2 | `Success: no issues found in 100 source files` |
| Task 2 verify 1: `test_metrics.py test_composite_headline_parity.py test_metrics_parity.py -k "q166_benchmark_greeks or q166_greeks or q166_parity_greeks or periods_param or composite or parity"` | `84 passed, 186 deselected` |
| Task 2 verify 2: AST probe for `qs.stats.greeks` / `qs.stats.r_squared` | `open scalar benchmark nodes: []`, exit 0 |
| Task 2 verify 2: `pytest -q -n auto` | `6166 passed, 90 skipped, 460 warnings` |
| Task 2 verify 3: golden key-path diff | exactly plan 04's PSR path, exit 0 |
| Acceptance greps (`_align_benchmark_like_qs`, `_r_squared`, `_greeks_no_guess` defs, the call-site line, the scipy import) | each prints 1 |
| Homebrew `ruff check services/metrics.py` | `All checks passed!` The test file keeps the same five pre-existing findings plan 04 recorded |

`test_limiter_identity` did not flake in either full run.

## Deviations from Plan

### Auto-fixed Issues

None. There were no bugs outside the plan's scope.

**Small departures, each scoped to this plan's files:**
- The plan's behaviour text reads `compute_all_metrics(r, b)["r_squared"]`. The persisted scalars
  live under `["metrics_json"]` (`metrics_json.update(qstats_scalars)`), so the tests read
  `compute_all_metrics(r, b)["metrics_json"][...]`.
- The plan copies the 0.0.81 tz step into `_align_benchmark_like_qs` verbatim. It is a small helper,
  `_tz_naive_like_qs`, because `_r_squared` also needs it: 0.0.81 `_prepare_returns` tz-normalises
  the strategy, and the prepared strategy index is the period the benchmark aligns to.
  `_prepared_returns_no_guess` omits that step, and its docstring says no scalar reads the index.
  Here the index is read. `_greeks_no_guess` uses the same helper (see Findings).
- Added a shared test helper, `_q166_benchmark_pair`, and `_q166_raw_pair_regression`, the
  in-test OLS anchor the plan describes.
- The `compute_all_metrics` comment "Benchmark metrics (single greeks() call for alpha + beta)"
  now names `_greeks_no_guess`, because the old text was no longer true.
- The branch is the orchestrator-pinned `feat/166-qstatstruth`, as in plans 01, 03 and 04.

## Known Stubs

None.

## Threat Flags

None. The change adds no endpoint, auth path, file access or schema surface.
- T-166-10: D-15 pairwise regression, None when undefined, observed RED first, and the
  `.get(..., 0)` defaults are gone.
- T-166-12: reindex/bfill reproduced, with the calendar-mismatch parity case. No r_squared golden
  movement.
- T-166-02: every output passes through `_safe_float`.
- T-166-09: the fault is injected into `linregress`, and status 'error' is asserted.
- T-166-03: output quoted here is repo-relative, and the SUMMARY passed the planning-hygiene check
  while staged.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` has `_align_benchmark_like_qs`, `_r_squared` and
  `_greeks_no_guess`. Each acceptance grep prints 1.
- Commits df4c09de5 and 097966d84 exist on `feat/166-qstatstruth`.
