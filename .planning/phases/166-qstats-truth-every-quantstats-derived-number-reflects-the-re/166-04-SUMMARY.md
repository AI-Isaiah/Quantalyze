---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 04
subsystem: analytics-service/services/metrics.py
status: complete
tags: [rank-05, quantstats, qstats-truth, money-math, windows-9, psr]
requires:
  - _prepared_returns_no_guess
  - _annualized_vol_sharpe
  - _QSTATS_SINGLE_ARG_SCALARS
  - _Q166_PARITY_SITES
provides:
  - _payoff_ratio_no_guess
  - _kelly_criterion
  - _probabilistic_sharpe_ratio
  - _common_sense_ratio
  - _cpc_index
  - "_QSTATS_SINGLE_ARG_SCALARS with every entry a module mirror"
affects: [166-05, 166-06]
tech-stack:
  added: []
  patterns: ["loss-family mirrors compose kwarg-proven quantstats leaves on P(r), never the payoff/win-loss functions"]
key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py
    - analytics-service/tests/fixtures/golden_252d_expected.json
decisions:
  - "All eight dispatched qstats scalars are now module mirrors. No table entry references a quantstats function object"
  - "PSR (D-16) feeds the non-excess fourth moment (pandas kurtosis + 3) into the unchanged 0.0.81 expression. It is anchored to the published formula, not to live quantstats"
  - "The golden PSR line was replaced in place, because the committed golden does not round-trip through regen_golden's serializer (some sections are not key-sorted)"
metrics:
  duration: ~35min
  completed: 2026-09-24
requirements: [SC-2, SC-4, SC-5, WINDOWS-5, WINDOWS-9]
plan_head_before: c702b19fb4a1c010dbc9ecc6a598ab88c15ab1f6
actuals:
  tokens: 6650
  tasks: 3
  commits: 3
---

# Phase 166 Plan 04: Loss-family qstats mirrors and the PSR kurtosis fix Summary

Plan 04 closes the quantstats price guess on the last four dispatched scalars: `kelly_criterion`,
`probabilistic_sharpe_ratio`, `common_sense_ratio` and `cpc_index`. Each one is now an inline
mirror of 0.0.81 minus the guess, built on `P(r)`. The PSR base comes from plan 01's
`_annualized_vol_sharpe` with ppy=1. PSR also takes the D-16 correction: it uses the non-excess
fourth moment, as in the published formula. That moves one golden key path, disclosed below.

`actuals.commits: 3` was measured with `git rev-list --count <plan_head_before>..HEAD` before this
SUMMARY was written. The SUMMARY commit is the fourth. `actuals.tokens` is chars/4 over the
realized diff: about 26,617 changed characters.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer): RED invariants and shuffle test, five mirror functions, four table entries re-pointed | 09eb012f6 | `services/metrics.py`, `tests/test_metrics.py` |
| 2: live-quantstats parity rows and the composed-leaf fault test | ca9b2a3d3 | `tests/test_metrics.py` |
| 3: D-16 PSR correction, published-formula anchor, one golden key path | b5d96e9d5 | `services/metrics.py`, `tests/test_metrics.py`, `tests/fixtures/golden_252d_expected.json` |

## RED-first evidence (D-09)

### Task 1, against plan 03's end state

At that point the four keys still dispatched to `qs.stats.kelly_criterion`,
`qs.stats.probabilistic_ratio`, `qs.stats.common_sense_ratio` and `qs.stats.cpc_index`. Command,
from `analytics-service/`: `pytest tests/test_metrics.py -q -k "q166_all_winning_series_has_no_loss or q166_all_winning_loss or q166_nonmonotone_series_has_no_loss or q166_shuffle"`

```
E       AssertionError: common_sense_ratio=0.0: profit factor has no losses to divide by
E       AssertionError: persisted common_sense_ratio=0.0: no losses to divide by
E           AssertionError: kelly_criterion=0.3890395480225989: its denominator is a loss that does not exist
E       AssertionError: probabilistic_sharpe_ratio changed under a pure reordering
E       assert 0.9951264924286105 == 0.9997018052168664 ± 1.0e-09
4 failed, 195 deselected, 10 warnings in 1.06s
```

pytest stops at the first failing assert in each test. The other keys were measured on the same
pre-mirror tree with a scratchpad probe (`<scratchpad>/q166-04-probe.py`, not committed), through
both `compute_qstats_scalars` and `compute_all_metrics(...)["metrics_json"]`:

| Test | Key | Observed pre-fix | Invariant |
|---|---|---|---|
| `test_q166_all_winning_series_has_no_loss_derived_ratios` (canonical) | common_sense_ratio | 0.0 | None |
| same | probabilistic_sharpe_ratio | 0.1531252134903383 | > 0.5 |
| `test_q166_all_winning_loss_values_reach_metrics_json` (canonical, metrics_json) | common_sense_ratio / PSR | 0.0 / 0.1531252134903383 | None / > 0.5 |
| `test_q166_nonmonotone_series_has_no_loss_derived_ratios` | kelly_criterion | 0.3890395480225989 | None |
| same | cpc_index | 11.695887516415286 | None |
| same | common_sense_ratio | 23.98015435501653 | None |
| `test_q166_shuffle_order_independent_scalars` (non-monotone, seed 4242) | PSR original -> shuffled | 0.9997018052168664 -> 0.9951264924286105 | equal (rel 1e-9) |
| same | kelly original -> shuffled | 0.3890395480225989 -> 0.48502611367127496 | equal |
| same | common_sense original -> shuffled | 23.98015435501653 -> 166.9573245794009 | equal |
| same | cpc original -> shuffled | 11.695887516415286 -> 557.4949646142284 | equal |

Every pre-fix value matches research Q4 exactly. The shuffle test also checks, inside itself, that
live `qs.stats.kelly_criterion` gives different values on the original and shuffled series. That
proves the fixture exercises the guess, so the post-fix None == None cannot pass vacuously. After
the mirrors went in, the plan's verify selection printed `24 passed` (floor 18).

### Task 3, against Task 1's 0.0.81-form PSR mirror

`pytest tests/test_metrics.py -q -k q166_psr`:

```
E       AssertionError: PSR on benign_mixed is not the published formula: 0.7693296699257343 vs 0.7691467583727061
E       AssertionError: PSR on golden_returns is not the published formula: 0.37176286348610654 vs 0.37177281607707485
E       AssertionError: PSR undefined on benign_all_positive; published value 1.0
E       AssertionError: probabilistic_sharpe_ratio=None for a series that never lost a day
4 failed, 216 deselected, 6 warnings in 1.01s
```

After the D-16 change: `4 passed`.

## D-10 disclosure rows (changed values)

Values read through `compute_qstats_scalars`. The canonical row was also checked through
`compute_all_metrics(...)["metrics_json"]`, which gave the same values.

| Metric key | Fixture | Before | After | Reason |
|---|---|---|---|---|
| common_sense_ratio | `_rank05_trigger_series` (canonical) | 0.0 | None | no losing day: profit factor is +inf. quantstats read the returns as prices |
| probabilistic_sharpe_ratio | canonical | 0.1531252134903383 | 0.9998517975825096 | guess removed (Task 1: 0.9999630294673815), then D-16 |
| kelly_criterion | canonical | None | None | unchanged, but pre-fix it was None for the wrong reason (research Q4) |
| cpc_index | canonical | None | None | same as kelly |
| kelly_criterion | `_q166_trigger_nonmonotone` | 0.3890395480225989 | None | no losing day: payoff undefined |
| cpc_index | non-monotone | 11.695887516415286 | None | same |
| common_sense_ratio | non-monotone | 23.98015435501653 | None | no losing day: profit factor undefined |
| probabilistic_sharpe_ratio | non-monotone | 0.9997018052168664 | 0.9999997591042462 | guess removed (Task 1: 0.9999999995117091), then D-16 |
| probabilistic_sharpe_ratio | `_rank05_benign_mixed` | 0.7693296699257343 | 0.7691467583727061 | D-16 only (the guess cannot fire) |
| probabilistic_sharpe_ratio | `_rank05_benign_all_positive` | None | 1.0 | D-16 only. The 0.0.81 variance term went negative. The published PSR saturates the normal CDF at 1.0 |
| probabilistic_sharpe_ratio | `golden_returns` (conftest) | 0.37176286348610654 | 0.37177281607707485 | D-16 only |
| probabilistic_sharpe_ratio | `golden_returns` with 3 NaN days | 0.3564313296632511 | 0.3564452921230312 | D-16 only |
| **golden** `metrics_json.metrics_json.probabilistic_sharpe_ratio` | `golden_252d_input.parquet` | 0.5815691494050974 | 0.5815640555270074 | D-16 only. The one golden key path this plan moves |

The benign kelly, common-sense and cpc values did not move: on `_rank05_benign_mixed` they stay
0.06044860544137644, 1.2710944312227488 and 0.6338794871802247.

**Golden scope.** The key-path diff against the phase-base golden (parent of 88dd7fafe, plan 01's
first `services/metrics.py` commit) printed
`golden key paths moved since phase base: ['metrics_json.metrics_json.probabilistic_sharpe_ratio']`
both before and after the commit. `git show --stat --format= HEAD -- analytics-service/tests/fixtures`
on b5d96e9d5 lists only `golden_252d_expected.json | 2 +-`. After Task 1, before D-16, the golden
had not moved, and `tests/test_metrics_parity.py` passed unedited.

## Parity with live quantstats 0.0.81 (D-08)

`_Q166_PARITY_SITES` gained `kelly_criterion`, `common_sense_ratio` and `cpc_index`. Measured
relative difference, mirror vs live quantstats, through `compute_qstats_scalars`:

| Fixture | kelly_criterion | common_sense_ratio | cpc_index | PSR (Task 1, 0.0.81 form) |
|---|---|---|---|---|
| `_rank05_benign_mixed` | 0.0 | 0.0 | 0.0 | 0.0 |
| `_rank05_benign_all_positive` | both None | both None | both None | both None |
| `golden_returns` | 0.0 | 0.0 | 0.0 | 0.0 |
| `golden_returns` with 3 NaN days | 0.0 | 0.0 | 0.0 | 0.0 |

`-k "q166_parity or q166_composed_leaf"` printed `37 passed` after Task 2 (floor 33: 8 sites x
4 fixtures, the fault test, and plan 03's 4 anchor cases). Task 3 removed the PSR row, because D-16
makes it fail by design. A comment in `_Q166_PARITY_SITES` points to the anchor test. The same
selection then printed `33 passed` (post-Task-3 floor 29).

**The parity and fault tests can fail.** As a neuter drill (not committed), `_kelly_criterion`
was changed to read `win_rate` off the raw series instead of `P(r)`, and `_cpc_index` was changed
to use a constant 0.5 in place of `win_rate`. Result: `5 failed, 32 passed`. The failures were
`kelly_criterion-golden_returns_with_nan_days`, `cpc_index-benign_mixed`,
`cpc_index-golden_returns`, `cpc_index-golden_returns_with_nan_days` and
`test_q166_composed_leaf_fault_is_failure_soft`. I restored the file from a byte backup and confirmed
it with `cmp` and an empty `git diff`.

`test_q166_composed_leaf_fault_is_failure_soft` monkeypatches `qs.stats.win_rate` to raise. kelly and
cpc become None, each with a WARNING naming its key, and the other six scalars stay non-None on
`golden_returns`.

## PSR anchor (D-16)

`test_q166_psr_matches_the_published_formula` is parametrized over `benign_mixed`,
`golden_returns` and `benign_all_positive`, one collected case each. It computes
`norm.cdf(SR / sqrt((1 - g3*SR + ((g4 - 1)/4)*SR**2) / (n - 1)))`, with SR = numpy mean /
std(ddof=1) of the fillna(0) series and g3, g4 from `scipy.stats.skew` / `scipy.stats.kurtosis(fisher=False)`
(bias=False, nan_policy="omit") on the raw series. It checks the result at rel 1e-10. It never calls
quantstats or pandas `.skew()` / `.kurtosis()`. The source is Bailey and Lopez de Prado,
https://www.davidhbailey.com/dhbpapers/deflated-sharpe.pdf.

## "kwarg-closable" is REFUTED for kelly_criterion, common_sense_ratio and cpc_index

WINDOWS.md entry 9 and the 159-05 Residual table describe these three as closable with
`prepare_returns=False`. Research Q2 refutes that. Its spy saw each of them still reach
`_prepare_returns` through a leaf that does not receive the keyword: `payoff_ratio` and `win_rate`
for kelly, `profit_factor` and `tail_ratio` for common-sense, and all three for cpc. 0.0.81
`payoff_ratio` and `win_loss_ratio` do not forward the keyword to `avg_win` / `avg_loss`. That is why
`_payoff_ratio_no_guess` composes those two leaves directly. Each mirror's docblock states the
refutation at the site. PSR has no keyword at all.

## Verification

| Check (from `analytics-service/`) | Result |
|---|---|
| `pytest tests/test_metrics.py -q -k "q166_all_winning or q166_nonmonotone or q166_shuffle or qstats_scalars"`, after Task 1 | `24 passed` (floor 18) |
| AST probe: dispatched-scalar / payoff / win-loss / cvar `qs.stats` nodes and `getattr(qs.stats, ...)` | `open quantstats nodes: []`, exit 0 |
| `pytest -q -n auto`, after Task 1 | `6137 passed, 90 skipped, 465 warnings` |
| `pytest tests/test_metrics.py -q -k "q166_parity or q166_composed_leaf"`, after Task 2 | `37 passed` (floor 33) |
| `pytest tests/test_metrics.py tests/test_metrics_parity.py -q`, after Task 2 | `251 passed` |
| `pytest tests/test_metrics.py -q -k q166_psr`, after Task 3 | `4 passed` (floor 4) |
| golden key-path diff vs phase base, after Task 3 | `['metrics_json.metrics_json.probabilistic_sharpe_ratio']`, exit 0 |
| `pytest -q -n auto`, after Task 3 | `6154 passed, 90 skipped, 453 warnings` |
| `pytest tests/test_metrics.py tests/test_metrics_parity.py -q`, after Task 3 | `251 passed` |
| mypy, CI's exact command (`--strict --follow-imports=silent --config-file=pyproject.toml` over `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`), after Tasks 1 and 3 | `Success: no issues found in 100 source files` |
| `grep -c 'probabilistic_sharpe_ratio' tests/test_metrics.py` | 17 (floor 3) |
| Homebrew `ruff check services/metrics.py tests/test_metrics.py` | metrics.py clean. The 5 test-file findings (E402 x2, F401 x3) are pre-existing, the same five plan 03 recorded |

`test_limiter_identity` did not flake in either full run.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Golden PSR line replaced in place, not re-dumped**
- **Found during:** Task 3, step 4
- **Issue:** The plan says to rewrite the golden with regen_golden's serializer
  (`json.dumps(indent=2, sort_keys=True)`). A round-trip check before writing showed the committed
  file does NOT reproduce under that serializer. Some sections are not key-sorted, for example
  `mean_daily_turnover_usd` / `mean_monthly_turnover_usd` / `gross_volume_usd`, and the file is 1 byte
  longer. Re-dumping would have reordered unrelated lines, so the byte diff would not have been
  limited to one line.
- **Fix:** The scratchpad script asserts that the old `"probabilistic_sharpe_ratio": <old>,` line
  occurs exactly once. It replaces only that value, with the `json.dumps` float repr, and re-parses
  the result to confirm the new value. The byte diff is `1 1`, and the key-path diff proves the scope.
- **Files modified:** `analytics-service/tests/fixtures/golden_252d_expected.json`
- **Commit:** b5d96e9d5

**Small additions the plan did not name (scoped to this plan's files):**
- `_Q166_LOSS_RATIO_KEYS` and the `_q166_psr_published` helper in the tests. The helper is the
  in-test anchor the plan describes.
- The dispatch-table comment now names the six kwarg-proven leaves the mirrors still call. The
  `compute_qstats_scalars` docstring and two stale "until plan 166-04" references (one in the
  `_annualized_vol_sharpe` docstring, one in `test_qstats_scalars_dispatch_table_per_entry`) were
  updated to the new state.

**Other departures:**
- The branch is the orchestrator-pinned `feat/166-qstatstruth`, not an `agent-*` branch, as in
  plans 01 and 03.
- Edge case, recorded rather than tested: live `sharpe` raises `DataValidationError` on an empty or
  all-NaN series. The PSR mirror instead returns NaN, which maps to None with no WARNING. The
  persisted value (None) is the same. Only the log line is gone.

## Known Stubs

None.

## Threat Flags

None. The change adds no endpoint, auth path, file access or schema surface.
- T-166-07: the invariants and the shuffle test were RED first, and the AST probe is empty.
- T-166-08: the D-10 rows above, plus the key-path diff.
- T-166-02: every mirror output passes through `_safe_qstats_scalar` -> `_safe_float`.
- T-166-09: the composed-leaf fault test.
- T-166-03: output quoted here is repo-relative.
- T-166-SC: scipy is already installed and locked, and nothing was installed.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` has the five `def` lines the plan requires, one each.
  The acceptance grep printed 5.
- `grep -c '^def test_q166_shuffle_order_independent_scalars'` and
  `grep -c '^def test_q166_composed_leaf_fault_is_failure_soft'` each print 1 in
  `analytics-service/tests/test_metrics.py`.
- Commits 09eb012f6, ca9b2a3d3 and b5d96e9d5 exist on `feat/166-qstatstruth`.
