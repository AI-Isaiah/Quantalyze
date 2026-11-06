---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 03
subsystem: analytics-service/services/metrics.py
status: complete
tags: [rank-05, quantstats, qstats-truth, money-math, windows-9]
requires:
  - _max_drawdown_from_wealth
  - _drawdown_series_from_wealth
  - _cvar_of_tail
provides:
  - _prepared_returns_no_guess
  - _drawdown_series_no_guess
  - _recovery_factor
  - _ulcer_index
  - _ulcer_performance_index
  - _serenity_index
  - "_QSTATS_SINGLE_ARG_SCALARS as (key, callable)"
  - _Q166_PARITY_SITES
affects: [166-04, 166-05, 166-06]
tech-stack:
  added: []
  patterns: ["dispatch table of module callables in place of getattr over the quantstats namespace"]
key-files:
  created: []
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/tests/test_metrics.py
decisions:
  - "The mirrors use quantstats' own fillna(0) cleanup (P(r)), not Phase 159's skipna, so only trigger-shaped series change value"
  - "_QSTATS_SINGLE_ARG_SCALARS moved below the mirror definitions, because it now holds module callables. The _QstatsScalarKey Literal stays where it was"
  - "recovery_factor's arithmetic-sum numerator (upi's is compounded) is recorded, not changed (D-08)"
metrics:
  duration: ~30min
  completed: 2026-09-24
requirements: [SC-2, SC-4, SC-5, WINDOWS-5, WINDOWS-9]
plan_head_before: 13ad4850ef887030f18a9f673ad012f49e9f5bcd
actuals:
  tokens: 6000
  tasks: 2
  commits: 2
---

# Phase 166 Plan 03: Drawdown-family qstats mirrors Summary

Plan 03 closes the quantstats price guess for `recovery_factor`, `ulcer_index`, `upi` and
`serenity_index`. Each one is now an inline mirror of 0.0.81 with the guess removed, built on
plan 01's drawdown and CVaR-tail primitives. On all-winning input, `ulcer_index` is now 0.0 and
the three ratios are None. On benign input, all four are bit-equal to live quantstats.

`actuals.commits: 2` was measured with `git rev-list --count <plan_head_before>..HEAD` before
this SUMMARY was written. The SUMMARY commit is the third. `actuals.tokens` is chars/4 over the
realized diff: about 23,955 changed characters.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) - RED invariants, four mirrors, retyped dispatch table, re-targeted fault tests | 202c1c838 | `services/metrics.py`, `tests/test_metrics.py` |
| 2 - live-quantstats parity on four benign fixtures | c99b86b02 | `tests/test_metrics.py` |

## RED-first evidence (D-09)

These tests were written first and run against the pre-mirror `services/metrics.py`
(`pytest tests/test_metrics.py -q -k q166`, from `analytics-service/`):

```
E       AssertionError: no losing day, but ulcer_index=0.9947130555497081
E       AssertionError: persisted ulcer_index=0.9947130555497081
E       AssertionError: no losing day, but ulcer_index=0.9919239385213344
FAILED tests/test_metrics.py::test_q166_all_winning_series_has_no_drawdown_derived_ratios
FAILED tests/test_metrics.py::test_q166_all_winning_drawdown_values_reach_metrics_json
FAILED tests/test_metrics.py::test_q166_nonmonotone_series_has_no_drawdown_derived_ratios
3 failed, 1 passed, 171 deselected, 6 warnings in 1.02s
```

The one pass is `test_q166_nonmonotone_trigger_actually_trips_the_heuristic`, the anti-vacuity
guard, which passes by design. pytest stops at the first failing assert in each test, so the output
above only names `ulcer_index`. The other three keys were measured on the same pre-mirror tree
with a scratchpad probe (`<scratchpad>/q166-03-probe.py`, not committed), through both
`compute_qstats_scalars` and `compute_all_metrics(...)["metrics_json"]`. Both paths gave the same
values:

| Test | Key | Observed pre-fix | Invariant |
|---|---|---|---|
| `test_q166_all_winning_series_has_no_drawdown_derived_ratios` (canonical) | ulcer_index | 0.9947130555497081 | == 0.0 |
| same | recovery_factor | 2.0737188382869305 | None |
| same | upi | 2.9998728744771372 | None |
| same | serenity_index | 0.3204442673452879 | None |
| `test_q166_all_winning_drawdown_values_reach_metrics_json` (canonical, metrics_json) | the same four | the same four values | the same |
| `test_q166_nonmonotone_series_has_no_drawdown_derived_ratios` | ulcer_index | 0.9919239385213344 | == 0.0 |
| same | recovery_factor | 92.05882352941175 | None |
| same | upi | 4.117455241335786 | None |
| same | serenity_index | 0.36207650738764285 | None |

Every value matches the research Q4 measurement exactly. After the mirrors went in, the same
selection printed `4 passed`.

## D-10 disclosure rows (changed values)

| Metric key | Fixture | Before | After | Reason |
|---|---|---|---|---|
| recovery_factor | `_rank05_trigger_series` (canonical) | 2.0737188382869305 | None | max drawdown is 0 on a series with no losing day. quantstats read the returns as prices |
| ulcer_index | canonical | 0.9947130555497081 | 0.0 | no drawdown, so the RMS drawdown is 0 |
| upi | canonical | 2.9998728744771372 | None | ulcer is 0, so the ratio is undefined |
| serenity_index | canonical | 0.3204442673452879 | None | ulcer is 0 and the VaR of an all-zero drawdown series is NaN |
| recovery_factor | `_q166_trigger_nonmonotone` | 92.05882352941175 | None | same as canonical |
| ulcer_index | non-monotone | 0.9919239385213344 | 0.0 | same as canonical |
| upi | non-monotone | 4.117455241335786 | None | same as canonical |
| serenity_index | non-monotone | 0.36207650738764285 | None | same as canonical |

**No golden or parity fixture byte moved.** The key-path diff against the phase-base golden
(the parent of plan 01's first `services/metrics.py` commit, 88dd7fafe) printed
`golden key paths moved since phase base: []`. `tests/test_metrics_parity.py` passes unedited.

The four loss/Sharpe-family keys did not change on either trigger in this plan. Post-fix, canonical:
kelly None, PSR 0.1531252134903383, csr 0.0, cpc None. Non-monotone: kelly 0.3890395480225989,
PSR 0.9997018052168664, csr 23.98015435501653, cpc 11.695887516415286. Plan 04 corrects these.

## Parity with live quantstats 0.0.81 (D-08)

`test_q166_parity_every_mirror_matches_live_quantstats` has two stacked parametrize decorators,
so each (site, fixture) pair is its own case: 4 sites x 4 fixtures = 16 cases. Each case reads
through `compute_qstats_scalars` at rel 1e-12 (None == None where both are undefined).
`test_q166_parity_benign_mixed_reproduces_the_research_anchor` adds 4 more cases. The selection
`-k q166_parity` printed `20 passed`.

Measured relative difference, mirror vs live quantstats:

| Fixture | recovery_factor | ulcer_index | upi | serenity_index |
|---|---|---|---|---|
| `_rank05_benign_mixed` | 0.0 | 0.0 | 0.0 | 0.0 |
| `_rank05_benign_all_positive` | both None | 0.0 | both None | both None |
| `golden_returns` | 0.0 | 0.0 | 0.0 | 0.0 |
| `_q166_golden_with_nan_days(golden_returns)` | 0.0 | 0.0 | 0.0 | 0.0 |

The research anchors on benign-mixed hold at rel 1e-12: recovery_factor 0.9517263110721105,
ulcer_index 0.09511182002853455, upi 1.583422458226051, serenity_index 0.143686058754821.

**The parity test can fail.** As a neuter drill, I changed the `_ulcer_index` denominator from
the raw row count to the skipna count (`r.count() - 1`). The three NaN-day rows that use it went
RED: `ulcer_index-`, `upi-` and `serenity_index-golden_returns_with_nan_days`. The result was
`3 failed, 17 passed`. I restored the file from a byte backup and confirmed it with `cmp` and an
empty `git diff`.

## Recorded, not changed (D-08)

`recovery_factor`'s numerator is an ARITHMETIC sum of daily returns (`returns.sum()`), while
`upi`'s numerator is the COMPOUNDED return (`comp(r) = r.add(1).prod() - 1`). That is an
inconsistency inside quantstats 0.0.81. Fixing it would move benign values, and D-08 forbids that,
so the mirror reproduces it. The `_recovery_factor` docblock records it.

## "kwarg-closable" is REFUTED for recovery_factor

WINDOWS.md entry 9 and the 159-05 Residual table describe `recovery_factor` as closable with
`prepare_returns=False`. Research Q2 refutes that. Its spy saw
`recovery_factor(r, prepare_returns=False)` still reach `_prepare_prices` through `max_drawdown`,
which has no such keyword. On the canonical trigger it returned 1.9733 with the keyword, still
wrong. That is why this plan closes it with an inline mirror. The `_recovery_factor` docblock
states the refutation at the site.

## Interim state handed to plan 04

`_QSTATS_SINGLE_ARG_SCALARS` is now `tuple[tuple[_QstatsScalarKey, Callable[[pd.Series], float]], ...]`:

| Key | Callable in this plan | Owner of the mirror |
|---|---|---|
| recovery_factor | `_recovery_factor` | 03 (done) |
| ulcer_index | `_ulcer_index` | 03 (done) |
| upi | `_ulcer_performance_index` | 03 (done) |
| kelly_criterion | `qs.stats.kelly_criterion` | **plan 04** |
| probabilistic_sharpe_ratio | `qs.stats.probabilistic_ratio` | **plan 04** |
| common_sense_ratio | `qs.stats.common_sense_ratio` | **plan 04** |
| cpc_index | `qs.stats.cpc_index` | **plan 04** |
| serenity_index | `_serenity_index` | 03 (done) |

The four quantstats entries make exactly the call the old `getattr` dispatch made, so their
values are unchanged. The plan 04 RED-first tests run against this state. `_Q166_PARITY_SITES`
carries a comment saying plan 04 extends it. Note for the D-14 AST gate: the four
`qs.stats.<name>` entries are Attribute references that are not calls. A gate that flags
non-call references will flag them until plan 04 replaces them. That is the intended interim
state.

## Verification

| Check (from `analytics-service/`) | Result |
|---|---|
| `pytest tests/test_metrics.py -q -k "q166_all_winning or q166_nonmonotone or qstats_scalars"` | `20 passed` (floor 14) |
| AST probe for drawdown-family `qs.stats` nodes and `getattr(qs.stats, ...)` | `open drawdown-family quantstats nodes: []`, exit 0 |
| golden key-path diff vs phase base | `golden key paths moved since phase base: []`, exit 0 |
| `pytest -q -n auto`, after Task 1 | `6113 passed, 90 skipped, 441 warnings` |
| `pytest tests/test_metrics.py -q -k q166_parity` | `20 passed` (floor 16) |
| `pytest tests/test_metrics.py tests/test_metrics_parity.py -q` | `230 passed` |
| `pytest -q -n auto`, after Task 2 | `6133 passed, 90 skipped, 457 warnings` |
| mypy, CI's exact command (`--strict --follow-imports=silent --config-file=pyproject.toml` over `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`), after each task | `Success: no issues found in 100 source files` |
| Homebrew `ruff check services/metrics.py tests/test_metrics.py` | metrics.py clean. The 5 test-file findings (E402 x2, F401 x3) are pre-existing and identical at the plan base |

I did not run the full suite before editing, so I have no baseline warning count of my own. Plan
01's SUMMARY recorded 925. The drop to about 441 plausibly comes from the mirrors no longer calling
quantstats' `cvar`, which emits a "Mean of empty slice" warning. I did not measure the cause.
`test_limiter_identity` did not flake in either full run.

## Deviations from Plan

### Auto-fixed Issues

None. No bug fix was needed: every parity case was bit-equal on its first run.

**Small additions the plan did not name (Rule 2, scoped to this plan's files):**
- `_drawdown_series_no_guess(r)` names the plan's `DD(r)` =
  `_drawdown_series_from_wealth((1.0 + r.fillna(0)).cumprod())`. Ulcer and serenity both need
  it, and the plan's own D-04 forbids spelling it twice.
- In the tests: `_Q166_DRAWDOWN_RATIO_KEYS`, `_Q166_BENIGN_FIXTURES`, a `_q166_benign_fixture`
  resolver (it uses `request.getfixturevalue("golden_returns")`, as the plan asks), and
  `test_q166_parity_benign_mixed_reproduces_the_research_anchor`. The anchor test pins the
  research values as numbers, which the plan's behaviour bullet requires.
- The re-targeted `test_qstats_scalars_logs_warning_on_qs_failure` now also asserts that the
  other seven scalars are non-None. Before, the "other scalars still computed" contract lived
  only in a comment. `test_qstats_scalars_dispatch_table_per_entry` now also checks that the
  record's level is WARNING.

**Other departures:**
- `_QSTATS_SINGLE_ARG_SCALARS` moved from its old spot beside `_QstatsScalarKey` to just after
  the mirror section. It now holds module callables, which must be defined first. The Literal
  and the key order are unchanged.
- The worktree branch is the orchestrator-pinned `feat/166-qstatstruth`, not an `agent-*`
  branch, as in plan 01.

## Known Stubs

None.

## Threat Flags

None. The change adds no endpoint, auth path, file access or schema surface. T-166-07: the
invariants above were RED first, and the AST probe confirms the attribute dispatch is gone.
T-166-02: every mirror output still passes through `_safe_qstats_scalar` -> `_safe_float`.
T-166-09: the fault tests inject into real inline math and into each table entry.
T-166-03: output quoted here is repo-relative.

## Self-Check: PASSED

- `analytics-service/services/metrics.py` has all five `def` lines the plan requires, one each.
  The acceptance grep printed 5, and the `Callable[[pd.Series], float]` grep printed 1.
- `analytics-service/tests/test_metrics.py` has `_q166_trigger_nonmonotone`,
  `_q166_golden_with_nan_days` and `_Q166_PARITY_SITES`, one each.
- Commits 202c1c838 and c99b86b02 exist on `feat/166-qstatstruth`.
