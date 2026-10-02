---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 08
subsystem: analytics-service/tests (quantstats AST gate)
status: complete
tags: [rank-05, quantstats, qstats-truth, ast-gate, needles, neuter-drill, d-14, d-03, windows-9]
requires:
  - tests/qstats_gate.py (scan_source, scan_tree, KWARG_PROVEN, Violation) from 166-07
  - tests/test_metrics.py _rank05_trigger_series
provides:
  - permanent RED and GREEN needles per call shape, through the production scan_source
  - an uncovered-importer needle through scan_tree
  - behavioural preparer-spy pins over sorted(KWARG_PROVEN), plus cvar / payoff_ratio calibration rows
  - four real-file neuter-drill records (below)
affects: [166-09, 166-10]
tech-stack:
  added: []
  patterns: ["needle per call shape through the same scanner the real-corpus gate uses; behavioural allowlist pinned by a preparer spy with expected-RED calibration rows"]
key-files:
  created: []
  modified:
    - analytics-service/tests/test_qstats_gate.py
decisions:
  - "Needles run with module name services/metrics.py (a covered module), so a RED needle is the call shape itself and not the importer rule"
  - "GREEN needles also assert the scanner is LOOKING (nodes > 0 and one census row per node), so a blind scanner cannot pass them"
  - "The calibration rows are GREEN tests that assert the spy DOES see cvar / payoff_ratio reach a preparer; if quantstats ever fixes them the row fails and the change gets read"
metrics:
  duration: ~10min
  completed: 2026-09-24
requirements: [SC-3, TODOS-0f, WINDOWS-9]
plan_head_before: 8be6b11a02115769e22596b449d5e05cdc1b53bc
actuals:
  tokens: 3284
  tasks: 2
  commits: 2
---

# Phase 166 Plan 08: the quantstats gate proven able to fail Summary

Plan 07's AST gate now has permanent proof that it can fail. That proof covers every call shape it
claims to see: 12 RED needles, an importer needle and 3 GREEN needles, all through the same
`scan_source` / `scan_tree` the real-corpus gate uses. Behavioural preparer-spy pins cover every
`KWARG_PROVEN` leaf, and two calibration rows show the spy can see a function that accepts the
keyword and then drops it. Four neuter drills were also run against the real
`services/metrics.py`. Each was observed RED naming the site, then restored byte-identical.

`actuals.commits: 2` was measured with `git rev-list --count <plan_head_before>..HEAD` before this
SUMMARY was written. The SUMMARY commit is the third. `actuals.tokens` is chars/4 over the realized
diff (13137 chars).

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer): RED and GREEN needles per shape, importer needle | 4d338a183 | `tests/test_qstats_gate.py` |
| 2: behavioural kwarg pins, calibration rows, neuter drills (drills not committed) | 9e89ec533 | `tests/test_qstats_gate.py` |

## Needles (Task 1)

The `RED_NEEDLES` dict drives `test_qstats_gate_red_needle_is_named`, one parametrize id per shape.
Each case asserts a violation carrying the module, the enclosing function, the quantstats name and a
reason substring:

| id | shape | function / qs name |
|---|---|---|
| needle_direct_unclosed_call | `qs.stats.sharpe(r)` | compute_all_metrics / sharpe |
| needle_prepare_returns_true | `prepare_returns=True` | compute_all_metrics / volatility |
| needle_prepare_returns_variable | `prepare_returns=flag` | compute_all_metrics / volatility |
| needle_kwargs_splat | `**kwargs` | compute_all_metrics / volatility |
| needle_cvar_keyword_that_lies | `cvar(..., prepare_returns=False)` | compute_all_metrics / cvar |
| needle_payoff_ratio_keyword_that_lies | `payoff_ratio(..., prepare_returns=False)` | _kelly_criterion / payoff_ratio |
| needle_attribute_dispatch_over_table | getattr over a module-level table | compute_qstats_scalars / getattr, reason lists `recovery_factor, ulcer_index` |
| needle_function_alias | `fn = qs.stats.greeks` | compute_all_metrics / greeks |
| needle_from_stats_import | `from quantstats.stats import greeks` | `<module>` / greeks |
| needle_preparer_reference | `qs.utils._prepare_returns(r)` | compute_all_metrics / utils |
| needle_rolling_alpha_beta_bare_rolling_greeks | `rolling_greeks` in `_rolling_alpha_beta` | _rolling_alpha_beta / rolling_greeks |
| needle_stats_namespace_import_alias | `from quantstats import stats as S`; `S.sharpe(r)` | compute_all_metrics / sharpe |

`test_qstats_gate_importer_needle_names_the_uncovered_module` builds `services/metrics.py` (clean)
and `services/other.py` (`import quantstats`) under `tmp_path`. `scan_tree` over that directory
must report exactly one violation: `("services/other.py", "uncovered importer")`.

`GREEN_NEEDLES` drives `test_qstats_gate_green_needle_is_silent`, with three sources. The first is a
clean module that calls all 7 `KWARG_PROVEN` leaves with the constant keyword, plus
`drawdown_details(dd)`. The second has a commented-out unclosed call and the third a string literal
of one. Each must produce zero violations, `nodes > 0`, and one census row per node.

**The needle tests were shown able to fail.** This was a one-off run in which the test module's
`scan_source` binding was replaced; nothing from it is committed.

| Replacement scanner | Result |
|---|---|
| blind (returns nothing) | 12/12 RED needles failed and 3/3 GREEN needles failed (the GREEN needles fail on the `nodes > 0` looking-check) |
| text-matching (flags every `qs.stats.sharpe` line) | `needle_green_commented_out_call` and `needle_green_string_literal_call` failed |

## Allowlisted leaves and the pin that proves each (Task 2)

Each leaf has a row in `test_qstats_gate_kwarg_proven_leaf_never_reaches_a_preparer`, parametrized
over `sorted(KWARG_PROVEN)`. For each row, a spy wraps `quantstats.utils._prepare_returns` and
`_prepare_prices`, and the leaf is called on `_rank05_trigger_series()` with
`prepare_returns=False`. The row requires the preparer call list to be `[]`.

| KWARG_PROVEN leaf | pin id | observed preparer calls |
|---|---|---|
| avg_loss | `[avg_loss]` | `[]` |
| avg_win | `[avg_win]` | `[]` |
| profit_factor | `[profit_factor]` | `[]` |
| tail_ratio | `[tail_ratio]` | `[]` |
| value_at_risk | `[value_at_risk]` | `[]` |
| volatility | `[volatility]` | `[]` |
| win_rate | `[win_rate]` | `[]` |

The calibration rows are the same spy in
`test_qstats_gate_calibration_non_honouring_functions_do_reach_a_preparer`:

| function | observed | row |
|---|---|---|
| payoff_ratio | `['_prepare_returns', '_prepare_returns']` | GREEN (a call was seen) |
| cvar | `['_prepare_returns']` | GREEN (a call was seen) |

As a check, the pin itself was run directly on those two names. Both failed:
`payoff_ratio(prepare_returns=False) still reached ['_prepare_returns', '_prepare_returns'] on the trigger fixture: it is not a closure, and KWARG_PROVEN must not allowlist it`,
and the same message for `cvar` with `['_prepare_returns']`.

## Neuter drills against the real `services/metrics.py`

Every drill followed the same steps:

1. `cp services/metrics.py <scratchpad>/q166-08-metrics.py.bak`, then `cmp` to confirm the backup.
2. Insert the neuter statement with a scratchpad AST helper, which places it after the target function's docstring.
3. Run `tests/test_qstats_gate.py::test_qstats_gate_real_corpus_is_clean`.
4. `cp` the backup back, then `cmp` it.
5. Re-run the gate and `git status --porcelain -- services`.

No git checkout, restore or stash was used.

**(a) Attribute dispatch in `compute_qstats_scalars`.** Inserted
`for _q166_fn_name in _Q166_NEUTER_TABLE: getattr(qs.stats, _q166_fn_name)(returns)` plus a
module-level `_Q166_NEUTER_TABLE = ("recovery_factor", "ulcer_index", "serenity_index")`.
```
E           services/metrics.py:compute_qstats_scalars:getattr:2449 [attribute dispatch] getattr over the quantstats namespace dispatches: recovery_factor, ulcer_index, serenity_index
1 failed in 3.04s
[a] cmp: restored byte-identical
1 passed in 2.96s
[a] git status services: ''
```

**(b) Bare `rolling_greeks` in `_rolling_alpha_beta`.** Inserted
`_q166_neuter = qs.stats.rolling_greeks(returns, benchmark, window)`.
```
E           services/metrics.py:_rolling_alpha_beta:rolling_greeks:2797 [call] not a kwarg-proven leaf; prepare_returns=False is not honoured transitively (or the function has no such keyword)
1 failed in 2.94s
[b] cmp: restored byte-identical
1 passed in 2.90s
[b] git status services: ''
```

**(c) Direct unclosed call in `compute_all_metrics`.** Inserted `_q166_neuter = qs.stats.sharpe(returns)`.
```
E           services/metrics.py:compute_all_metrics:sharpe:1138 [call] not a kwarg-proven leaf; prepare_returns=False is not honoured transitively (or the function has no such keyword)
1 failed in 2.94s
[c] cmp: restored byte-identical
1 passed in 2.95s
[c] git status services: ''
```

**(d) New importer.** Created `services/_q166_neuter_probe.py` containing only `import quantstats`.
```
E           services/_q166_neuter_probe.py:<module>:quantstats:1 [uncovered importer] imports quantstats but is not in COVERED_MODULES
1 failed in 2.98s
[d] probe removed; git status services: ''; exists: no
[d] metrics.py cmp unchanged
1 passed in 3.04s
```

`git status --porcelain -- analytics-service/services` was empty at both task commits, and
`test -e analytics-service/services/_q166_neuter_probe.py` is false.

## Verification

| Command (from `analytics-service/`, main-checkout venv) | Result |
|---|---|
| `pytest tests/test_qstats_gate.py -q -k "needle or importer"` | `16 passed, 5 deselected` |
| `pytest -q -n auto` after Task 1 | `6192 passed, 90 skipped` |
| `pytest tests/test_qstats_gate.py -q -k "kwarg_proven or calibration"` | `9 passed, 21 deselected` |
| `test -z "$(git status --porcelain -- services)" && pytest -q -n auto && mypy --strict --follow-imports=silent services/ routers/ models/` (Task 2 verify, verbatim) | `6201 passed, 90 skipped`; `Success: no issues found in 96 source files` |
| CI's exact mypy: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 100 source files` |
| `mypy --strict --follow-imports=silent --config-file=pyproject.toml tests/test_qstats_gate.py` | `Success: no issues found in 1 source file` (tests are outside CI's mypy surface; run for hygiene) |
| `ruff check tests/test_qstats_gate.py` | `All checks passed!` |

Acceptance greps on `tests/test_qstats_gate.py`: `_rolling_alpha_beta` = 4, `payoff_ratio` = 5.

The census and reconciliation lines printed unchanged on every run: 13 nodes, 0 violations, and
33 vs 13 against the phase-start 30 vs 9.

## TDD note

The scanner (plan 07) and quantstats' behaviour already existed, so the new tests went GREEN on their
first run. What they need is proof that each one can fail, and that proof is recorded above:

- the needle tests failed against a blind scanner and against a text-matching scanner;
- the pin failed when run directly on `payoff_ratio` and `cvar`;
- the real-corpus gate failed at every one of the four drill shapes.

## Deviations from Plan

### Auto-fixed Issues

None. The plan was executed as written, with two additions that do not change its contract:

- The GREEN needles also assert that the scanner is looking (`nodes > 0` and one census row per node). Without this, a blind scanner would pass them.
- `_preparer_calls` asserts `quantstats.stats._utils is quantstats.utils`. If quantstats ever stops reaching the preparers through that module, the spy would silently patch the wrong object, and this assertion catches that.

Drill (a) put its table at module level so that the dispatched names resolve in the RED line. That
is the pre-Phase-166 `_QSTATS_SINGLE_ARG_SCALARS` shape.

## Known limits (recorded, not hidden)

- The pins measure quantstats 0.0.81 on one trigger fixture. That fixture trips both preparer
  guesses, but it has no benchmark leg. None of the 7 leaves takes a benchmark, so this is complete
  for the current allowlist. A benchmark-taking leaf could not join `KWARG_PROVEN` without a
  benchmark-leg pin.
- The calibration rows give 2 warnings: numpy RuntimeWarnings from `cvar` on the all-winning fixture
  (the mean of an empty slice). The run still passes.

## Known Stubs

None.

## Threat Flags

None. The change is test-only.

## Self-Check: PASSED

- FOUND: analytics-service/tests/test_qstats_gate.py
- FOUND: 4d338a183
- FOUND: 9e89ec533
- ABSENT (as required): analytics-service/services/_q166_neuter_probe.py
