---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 01
subsystem: analytics-service/services/metrics.py
status: complete
tags: [rank-05, quantstats, refactor, byte-neutral, money-math]
requires: []
provides:
  - _max_drawdown_from_wealth
  - _drawdown_series_from_wealth
  - _annualized_vol_sharpe
  - _downside_rms
  - _cvar_of_tail
affects: [166-03, 166-04, 166-05, 166-06]
tech-stack:
  added: []
  patterns: ["module-level money-math primitives; callers keep their own _safe_float and status handling"]
key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
decisions:
  - "info_ratio re-pointed at _annualized_vol_sharpe: tracking error and the information ratio are the same annualized vol/Sharpe math on the excess series, bit-identical, so leaving it inline would have been a third hand-copy (D-04)"
  - "The simple-path _underwater drawdown stays inline: its operations (cumsum, peak clipped at 0.0, subtraction) differ from the geometric primitives"
metrics:
  duration: ~25min
  completed: 2026-09-24
requirements: [TODOS-0f, SC-2]
plan_head_before: 73cbf2995da56879f4c242347c9a9c05d910118a
actuals:
  tokens: 4500
  tasks: 2
  commits: 2
---

# Phase 166 Plan 01: Extract the RANK-05 money-math primitives Summary

The drawdown, annualized vol/Sharpe, downside-RMS and CVaR-tail math each exist once now, as
module-level functions in `services/metrics.py`. Every bit-identical inline spelling calls them.
The change is byte-neutral: the golden parity file and the full suite pass with no test edited.

`actuals.commits: 2` counts the two task commits, measured with
`git rev-list --count <plan_head_before>..HEAD` before this SUMMARY was written. The SUMMARY
commit that follows is the third.

## Test counts

| Measurement | Command (from `analytics-service/`) | Result |
|---|---|---|
| Baseline, before any edit | `<venv>/bin/python -m pytest -q -n auto` | `6109 passed, 90 skipped, 928 warnings` |
| After Task 1 | same | `6109 passed, 90 skipped, 928 warnings` (see the flake note) |
| After Task 2, two runs | same | `6109 passed, 90 skipped, 925 warnings` both times |
| Golden parity after Task 2 | `pytest tests/test_metrics_parity.py -q` | `35 passed` |
| After Task 1, metrics files | `pytest tests/test_metrics.py tests/test_metrics_parity.py -q` | `206 passed` |
| mypy after Task 1 | `mypy --strict --follow-imports=silent services/ routers/ models/` | `Success: no issues found in 96 source files` |
| mypy after Task 2, CI's exact surface | the same command plus `--config-file=pyproject.toml` and `main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 100 source files` |
| ruff | `ruff check services/metrics.py`, before and after | `All checks passed!` both times |

The warning count fell from 928 to 925 after Task 2. The headline `sharpe` used to divide by a
zero vol and raise a numpy RuntimeWarning. `_annualized_vol_sharpe` no longer does that
division. No persisted value moved, because `_safe_float` maps inf and NaN to None in both cases.

**No file under `analytics-service/tests/` changed.** `git status --porcelain -- analytics-service/tests`
printed nothing after each task, and each task commit touches only `analytics-service/services/metrics.py`.

**Flake (pre-existing, unrelated).** I ran the full suite five times after the Task 1 edit.
Two runs reported `1 failed, 6108 passed`. The failure named by `-rf` was
`tests/test_limiter_identity.py::TestClassClosure::test_every_router_limiter_is_the_one_singleton`,
and the other failing run was not captured with `-rf`. The other three runs passed with 6109.
Run in isolation, that file passes (`76 passed`). The test checks the router limiter
singleton, which `services/metrics.py` cannot reach. The failures came while the load average
was about 20, and they look like an xdist ordering flake. Both runs after Task 2 were clean.

## Inline spellings found, per primitive

| Primitive | Site (by symbol) | Outcome |
|---|---|---|
| `_max_drawdown_from_wealth` | `compute_all_metrics`, geometric branch, `max_dd` (wealth from `returns.fillna(0)`, unclipped) | re-pointed |
| `_max_drawdown_from_wealth` | `compute_all_metrics`, simple (arithmetic) branch, `_underwater` / `max_dd` | **left inline.** It uses cumsum with the peak clipped at 0.0 and a subtraction. That is a different operation from ratio-to-peak minus 1 |
| `_drawdown_series_from_wealth` | `compute_all_metrics`, geometric branch, `dd_series` (wealth is `cumulative`, from `returns_for_chart`) | re-pointed. The trailing inf/-0.0 replace is kept inside the primitive |
| `_drawdown_series_from_wealth` | `compute_all_metrics`, simple branch, `dd_series = _underwater` | left inline, same reason as above |
| `_annualized_vol_sharpe` | `compute_all_metrics` headline `sharpe` (operand `stat_returns`) | re-pointed. The `_stat_std` local was removed |
| `_annualized_vol_sharpe` | `sharpe_vol_status_from_backbone` (operand `returns`) | re-pointed. The status ladder and `_safe_float(vol)` stay outside the primitive. The `mean_ret` local was removed |
| `_annualized_vol_sharpe` | `compute_all_metrics` benchmark block, `te` / `info_ratio` (operand `excess`) | **re-pointed. The plan did not name this site** (see Deviations) |
| `_annualized_vol_sharpe` | `compute_all_metrics` `volatility` | left as is. It is a kwarg-closed `qs.stats.volatility` call, not an inline spelling |
| `_annualized_vol_sharpe` | `_rolling_sharpe`, `_rolling_volatility` | left inline. They are rolling-window computations, not a scalar primitive |
| `_annualized_vol_sharpe` | `compute_all_metrics` `smart_sharpe` | left inline. It uses a fixed `sqrt(252)` and an autocorrelation penalty (recorded Phase 159 behaviour), so it is a different expression |
| `_annualized_vol_sharpe` | outlier ratios `std_ret` | left inline. It is an unannualized std threshold |
| `_downside_rms` | headline `sortino` (operand `_sortino_excess`) | re-pointed. The locals `_downside_sq_sum` and `_sortino_n` were removed. The "downside == 0 means undefined" handling stays at the site |
| `_downside_rms` | `smart_sortino` (operand `_smart_r`, already dropna'd, so count equals len) | re-pointed. The `* _smart_penalty` stays at the site |
| `_downside_rms` | `_rolling_sortino_from_components` | left inline. It is a rolling-window computation |
| `_cvar_of_tail` | `compute_all_metrics` `cvar` block | re-pointed. The local `_cvar_tail` was dropped and the `None`-threshold branch stays at the site |

## Zero/NaN-vol side-effect proof (Task 2 step 6)

Scratchpad script `<scratchpad>/166-01-zerovol.py` (not committed) calls
`sharpe_vol_status_from_backbone(series, 365)` with `warnings.filterwarnings("error", message=".*divide.*")`:

| Tree | length-10 all-0.0 | length-10 all-NaN |
|---|---|---|
| Before the extraction (after Task 1, backbone untouched) | `(0.0, None, 'zero_volatility')` | `(None, None, 'nan_vol')` |
| After Task 2 | `(0.0, None, 'zero_volatility')` | `(None, None, 'nan_vol')` |

Neither case raised on either tree. The all-NaN case raised no warning before the extraction
either. The plan's automated zero-vol check therefore carries the proof. That check can fail. I
performed the unguarded division `(mean*365)/(std*sqrt(365))` on an all-0.0 series with the same
filter, and it raises `RuntimeWarning invalid value encountered in scalar divide`. So removing the
no-divide branch from `_annualized_vol_sharpe` would turn the check red.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] `info_ratio` re-pointed at `_annualized_vol_sharpe`**
- **Found during:** Task 2 (the spelling sweep)
- **Issue:** the plan named two callers, the headline and the backbone. The `info_ratio` block
  computes `te = float(excess.std() * np.sqrt(ppy))` and `excess.mean() * ppy / te`. That is the
  same annualized vol/Sharpe math on the excess series. Leaving it inline would break the
  plan's must-have "every pre-existing call site that spelled them inline now calls the primitive".
- **Fix:** `te, _info_ratio = _annualized_vol_sharpe(excess, periods_per_year)`. The existing
  `if te > 0` guard is kept. `np.sqrt` and `math.sqrt` are both correctly rounded IEEE square
  roots, and the division order is identical, so the values are bit-identical. With a NaN `te`,
  both versions skip the guard. With an inf `te`, both versions divide and give 0.0.
- **Evidence:** full suite and golden parity green, with no test edited.
- **Files modified:** `analytics-service/services/metrics.py`
- **Commit:** c94788406

**Other departures from the plan text**
- The plan's `ruff` step: the main venv has no `ruff` module, and CI does not run ruff. Homebrew
  `ruff` passed on the file before and after the change.
- The worktree branch is `feat/166-qstatstruth`, as the orchestrator pinned it, not an `agent-*`
  branch.

## Known Stubs

None.

## Threat Flags

None. The change adds no endpoint, auth path, file access or schema surface. T-166-01 is
mitigated by the unedited golden parity file. T-166-02 is mitigated because every call site keeps
its `_safe_float` wrapper.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` contains each of the five `def` lines exactly once. The call-count greps give 4 for `_annualized_vol_sharpe(`, 3 for `_downside_rms(` and 2 for `_cvar_of_tail(`.
- Commits 88dd7fafe and c94788406 exist on `feat/166-qstatstruth`.
