---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 06
subsystem: analytics-service/services/metrics.py
status: complete
tags: [rank-05, quantstats, qstats-truth, money-math, windows-9, benchmark, rolling-greeks, d-17]
requires:
  - _prepared_returns_no_guess
  - _tz_naive_like_qs
  - _align_benchmark_like_qs
  - _q166_benchmark_trigger
  - _q166_calendar_mismatch
  - _q166_benchmark_pair
provides:
  - _rolling_greeks
  - _q166_windowed_regression
  - _q166_rolling_pair
affects: [166-07]
tech-stack:
  added: []
  patterns: ["rolling benchmark leg mirrors 0.0.81 rolling_greeks minus the guess on both legs; alpha is the windowed intercept (D-17)"]
key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py
    - analytics-service/tests/fixtures/golden_252d_expected.json
decisions:
  - "The strategy leg of _rolling_greeks takes 0.0.81 _prepare_returns' tz step as well (_tz_naive_like_qs), as plan 05's _r_squared does, because the prepared strategy index is the period the benchmark aligns to"
  - "Rolling beta keeps 0.0.81's corr * std_r / std_b expression order; measured max abs diff against live quantstats is 0.0 on the golden and calendar-mismatch pairs"
  - "Rolling alpha is mean_w(r) - beta_t * mean_w(b) over the beta window (D-17), unannualized (Phase 34)"
metrics:
  duration: ~20min
  completed: 2026-09-24
requirements: [SC-2, SC-4, SC-5, WINDOWS-5, WINDOWS-9]
plan_head_before: 270ef0912a1949e07bef7ada71d98f05242e53a0
actuals:
  tokens: 10442
  tasks: 2
  commits: 2
---

# Phase 166 Plan 06: Rolling benchmark leg (rolling alpha/beta) Summary

Plan 06 closes the quantstats price guess on the rolling benchmark leg. `_rolling_alpha_beta` now
makes one call to the inline `_rolling_greeks`. That function mirrors 0.0.81 `rolling_greeks`, with
both legs prepared without the guess. It also fixes F-4 under D-17: rendered rolling alpha is now
the windowed intercept, where it used to be a full-sample-mean transform of rolling beta. Only one
golden key path moved, `sibling.rolling_alpha`, and it is disclosed below. **The rendered rolling
alpha of every benchmarked strategy changes on its next compute.**

`actuals.commits: 2` was measured with `git rev-list --count <plan_head_before>..HEAD` before this
SUMMARY was written. The SUMMARY commit is the third. `actuals.tokens` is chars/4 over the realized
diff, which is 41,766 bytes including the golden fixture's 154 moved values.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer): `_rolling_greeks` wired into `_rolling_alpha_beta`, fault tests re-targeted, dead branch and its test removed, golden `sibling.rolling_alpha` | 8dbcd8bff | `services/metrics.py`, `tests/test_metrics.py`, `tests/fixtures/golden_252d_expected.json` |
| 2: full-precision rolling beta parity and windowed-intercept proofs on `_rolling_greeks` | dbb7a64da | `tests/test_metrics.py` |

## RED-first evidence (D-09)

### Task 1, against plan 05's end state (`qs.stats.rolling_greeks` still called)

From `analytics-service/`: `pytest tests/test_metrics.py -q -k "q166_rolling"`

```
E       AssertionError: rolling beta last point=-0.0889; rolling cov/var of the raw pair over the last 90 rows is -0.7554623350311168
E       AssertionError: 161/161 rolling alpha points are not the windowed intercept; last (date, written, windowed intercept): ('2024-12-13', -0.0007, 0.005021601501212131)
2 failed, 228 deselected in 1.06s
```

After the mirror went in, and before the re-target, three tests failed:
`test_rolling_alpha_beta_single_rolling_greeks_call` (0 `qs.stats.rolling_greeks` calls),
`..._logs_warning_on_qs_failure` (the fault never reached production), and
`..._missing_columns_returns_empty_and_logs` (the branch it guarded can no longer run). The two new
tests passed. After the re-target and the deletion: `9 passed, 220 deselected`. That is
2 new + 2 re-targeted + 4 unedited guard tests + `test_compute_all_metrics_no_benchmark_rolling_alpha_beta_are_empty_lists`,
so the floor of 8 is met.

### Task 2

These tests pin math that Task 1 had already shipped, so they passed on first run
(`5 passed`: the beta parity and windowed-intercept tests each have two parametrized cases). To
show they can fail, I ran neuter drills on the mirror. Each used a byte backup in `<scratchpad>/`,
was restored with `cp`, and was confirmed clean with `cmp` and `git diff --quiet`:

- **Drill 1:** alpha set back to 0.0.81's full-sample `df["returns"].mean() - beta * df["benchmark"].mean()`.
  Four tests went RED: `test_q166_rolling_alpha_is_the_windowed_intercept`, both cases of
  `test_q166_rolling_greeks_alpha_is_the_windowed_intercept_full_precision` (161/161 and 411/411
  mismatched), and `test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form`.
- **Drill 2:** beta rewritten as rolling `cov / var`, which is algebraically equal but uses a
  different operation order. The rel 1e-12 parity test stayed GREEN, so it cannot detect
  operation-order drift. That is why I also measured the exact difference directly: max abs diff of
  rolling beta against live `qs.stats.rolling_greeks` is **0.0** on the golden input pair (163
  defined points) and on `_q166_calendar_mismatch` (71 points). Rolling beta is bit-identical, as
  measured. The test threshold stays at the plan's rel 1e-12.

## D-10 disclosure rows (changed values)

Before is live 0.0.81 `qs.stats.rolling_greeks` on the inner-joined pair, which is what production
called. After is `_rolling_greeks` on the same pair. Both are unrounded. The written column is what
`_finalize_rolling` persists (4 decimals).

| Metric key | Fixture | Before | After | Reason |
|---|---|---|---|---|
| rolling_beta, last point (2024-12-13) | `_q166_benchmark_trigger` | -0.08887237598396791 (written -0.0889) | -0.7554623350323423 (written -0.7555) | benchmark guess removed (D-06). The in-test raw-pair cov/var is -0.7554623350311168 |
| rolling_alpha, last point (2024-12-13) | `_q166_benchmark_trigger` | -0.0006752004065154814 (written -0.0007) | 0.005021601501217535 (written 0.005) | benchmark guess removed (D-06), and full-sample means replaced by the windowed intercept (D-17). Research Q4's 0.013161136406196155 is the guess-free value that still uses full-sample means, so D-17 is responsible for the rest of the move |
| golden `sibling.rolling_alpha` | `golden_252d_input` (returns + benchmark) | 163 points, last 2025-12-18 = 0.0002 | 163 points, last 2025-12-18 = 0.0023, with 154 of 163 written values changed and dates unchanged | D-17 only. The benign golden cannot trip the guess, and its rolling beta is bit-identical |

**Every benchmarked strategy's rendered rolling alpha (`RollingAlphaBetaChart`) changes on its next
compute.** On the golden pair the change is D-17 alone. On a guess-tripping benchmark, rolling beta
changes as well. Stored `strategy_analytics_series` rows keep their old values until each strategy
recomputes (D-11). The code touches no remote database.

**Golden scope.** I wrote the new `sibling.rolling_alpha` with a throwaway `<scratchpad>/` script.
It computes `compute_all_metrics(...).sibling_kinds["rolling_alpha"]` on the parquet input (the same
path `test_metrics_parity_full` uses), and serializes with `regen_golden.py`'s `_json_default`,
`indent=2, sort_keys=True`, keeping the existing trailing newline. I did not run `regen_golden.py`.
The key-path diff against the phase-base golden (the parent of 88dd7fafe) printed:

```
golden key paths moved since phase base: ['metrics_json.metrics_json.probabilistic_sharpe_ratio', 'sibling.rolling_alpha']
```

It exited 0. **`sibling.rolling_beta`, `alpha`, `beta` and `r_squared` did not move.**
`tests/test_metrics_parity.py` was left unedited. It failed on the pre-update golden
(`sibling.rolling_alpha[0].value: series mismatch ... expected 0.0001, got -0.0006`) and passed after
the update (`35 passed`).

## Deleted test and branch

`test_rolling_alpha_beta_missing_columns_returns_empty_and_logs` (M-0682) was deleted in 8dbcd8bff,
together with the `"rolling_greeks missing expected alpha/beta columns"` branch it covered. The
branch guarded against a quantstats column rename. The frame is now built in this module, so that
branch could not run, and a test that cannot fail was deleted under the 159 Deviation-2 rule. The
`_rolling_alpha_beta` docstring records the removal. The H-0726.3 WARNING (`rolling_greeks failed
...`) and the `([], [])` contract are kept. The fault test now injects into `_rolling_greeks`.

## Parity with live quantstats 0.0.81 (D-08)

- `test_q166_parity_rolling_beta_matches_live_quantstats` runs on (`golden_returns`,
  `benchmark_returns`) and `_q166_calendar_mismatch()`, each inner-joined as `_rolling_alpha_beta`
  joins them. Every defined beta point matches at rel 1e-12, and the undefined points fall on the
  same dates.
- `test_q166_rolling_greeks_alpha_is_the_windowed_intercept_full_precision` runs on the benchmark
  trigger and the golden pair. It checks against an in-test numpy loop (`_q166_windowed_regression`)
  at rel 1e-9, with no pandas rolling and no quantstats.
- `test_q166_rolling_greeks_alpha_differs_from_the_full_sample_form` is the anti-vacuity check for
  D-17 on the golden pair.

## Verification

| Check (from `analytics-service/`) | Result |
|---|---|
| Task 1 verify 1: `-k "q166_rolling or rolling_alpha_beta"` | `9 passed, 220 deselected` (floor 8) |
| Task 1 verify 2: golden key-path diff vs phase base | exactly the PSR path and `sibling.rolling_alpha`, exit 0 |
| Task 1 verify 3: AST probe for `qs.stats.greeks` / `r_squared` / `rolling_greeks` | `open benchmark nodes: []`, exit 0 |
| Task 1 verify 3: `pytest -q -n auto` | `6167 passed, 90 skipped, 460 warnings` |
| mypy, CI's exact command (`--strict --follow-imports=silent --config-file=pyproject.toml` over `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) | `Success: no issues found in 100 source files` |
| Task 2 verify 1: `-k "q166_parity_rolling or q166_rolling_greeks"` | `5 passed, 229 deselected` (floor 3) |
| Task 2 verify 2: `tests/test_metrics.py tests/test_metrics_parity.py` | `269 passed` |
| Full suite after Task 2: `pytest -q -n auto` | `6172 passed, 90 skipped, 460 warnings` |
| Acceptance greps: `^def _rolling_greeks(` / deleted test / the two Task 2 test defs | 1 / 0 / 1 / 1 |
| Homebrew `ruff check services/metrics.py` | `All checks passed!` The test file has the same five pre-existing findings (E402 x2, F401 x3) it had at `plan_head_before` |

`test_limiter_identity` did not flake in either full run. Task 2 did not change `services/metrics.py`,
so the golden diff did not need to be re-run for it.

## Findings recorded, not changed

- F-1 (D-08) is unchanged: only the SCALAR greeks alpha is annualized, on the frequency clock.
  Rolling alpha stays a per-period intercept. The Phase 34 note moved onto `_rolling_greeks`.

## Deviations from Plan

### Auto-fixed Issues

None.

**Small departures, each scoped to this plan's files:**
- `P(returns)` in `_rolling_greeks` is `_tz_naive_like_qs(_prepared_returns_no_guess(returns))`,
  not only `_prepared_returns_no_guess`. 0.0.81 `_prepare_returns` ends with that tz step, and plan
  05's `_r_squared` uses the same composition. On tz-naive input it does nothing.
- The plan asks for the full-precision tests to use "(golden_returns, benchmark_returns) and
  `_q166_calendar_mismatch()`" for beta, and "the benchmark trigger AND (golden_returns,
  benchmark_returns)" for alpha. Both are pytest-parametrized, one collected case per pair, as
  plan 05's parity tests are. Added test helpers: `_q166_windowed_regression` (the in-test anchor)
  and `_q166_rolling_pair`.
- The `compute_all_metrics` comment "ONE rolling_greeks pass" now names `_rolling_greeks`.
- The branch is the orchestrator-pinned `feat/166-qstatstruth`, as in plans 01 and 03 to 05.

## Known Stubs

None.

## Threat Flags

None. The change adds no endpoint, auth path, file access or schema surface.
- T-166-11: the windowed intercept is anchored to an in-test formula at full and at written
  precision, with a D-10 row. Rolling beta parity holds at rel 1e-12 and the measured difference is
  0.0.
- T-166-02: output still passes through `_finalize_rolling`, which drops non-finite points.
- T-166-09: the fault is injected into `_rolling_greeks`, and both the WARNING and `([], [])` are
  asserted. The dead-branch test was deleted only together with its branch.
- T-166-08: the flattened key-path diff shows exactly the two disclosed paths.
- T-166-03: output quoted here is repo-relative, and this SUMMARY passed the planning-hygiene check
  while staged.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` has `_rolling_greeks` (grep prints 1). The deleted test
  grep prints 0.
- Commits 8dbcd8bff and dbb7a64da exist on `feat/166-qstatstruth`.
