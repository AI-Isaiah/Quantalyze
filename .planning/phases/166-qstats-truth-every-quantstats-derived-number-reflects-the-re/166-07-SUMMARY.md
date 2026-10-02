---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
plan: 07
subsystem: analytics-service/tests (quantstats AST gate)
status: complete
tags: [rank-05, quantstats, qstats-truth, ast-gate, census, d-14, d-07, windows-9]
requires:
  - _recovery_factor
  - _ulcer_index
  - _ulcer_performance_index
  - _kelly_criterion
  - _probabilistic_sharpe_ratio
  - _common_sense_ratio
  - _cpc_index
  - _serenity_index
  - _r_squared
  - _greeks_no_guess
  - _rolling_greeks
provides:
  - tests/qstats_gate.py (SERVICE_ROOT, scanned_files, COVERED_MODULES, KWARG_PROVEN, EXEMPT, MIRRORED, Violation, CensusRow, scan_source, scan_tree, mirror_rows, census_lines)
  - the printed qstats-gate census in pytest_terminal_summary
affects: [166-08]
tech-stack:
  added: []
  patterns: ["stdlib-ast gate over every production module, allowlisting named leaf functions, census printed through the one pytest_terminal_summary hook"]
key-files:
  created:
    - analytics-service/tests/qstats_gate.py
    - analytics-service/tests/test_qstats_gate.py
  modified:
    - analytics-service/tests/conftest.py
    - analytics-service/tests/test_metrics.py
decisions:
  - "The reconciliation counts 'qs.stats.' as a LITERAL string (str.count). A regex grep, where the dots match any character, reads 42 at the phase-start commit, not the research's 30"
  - "Node accounting: census rows plus non-import violations must equal the scanned node count, so a node that is examined and neither passes nor fails turns the not-blind test RED"
  - "MIRRORED reasons were checked against the installed quantstats 0.0.81 source, not written from memory"
metrics:
  duration: ~12min
  completed: 2026-09-24
requirements: [SC-2, SC-3, TODOS-0f, WINDOWS-9]
plan_head_before: 54ab93333de721779d60ae6c6bed7a04f11cfefe
actuals:
  tokens: 9115
  tasks: 2
  commits: 2
---

# Phase 166 Plan 07: quantstats AST gate and printed census Summary

Plan 07 replaces the RANK-05 region gate, which matched lines of text, with a stdlib-`ast` gate over
every production `*.py` under `analytics-service/`. The new gate prints a census on every pytest run.
The old gate was deleted in the same commit that added the new one, so no commit is ever without a
gate.

The old gate scanned the lines of `compute_all_metrics` and trusted the text `prepare_returns=False`.
The new scanner resolves aliases first. It then judges four things:

- **importer coverage:** a module that imports quantstats must be in `COVERED_MODULES`;
- **direct calls:** each must be a `KWARG_PROVEN` leaf called with the constant `prepare_returns=False`, or the `EXEMPT` `drawdown_details`;
- **aliased references** to quantstats functions and to the stats namespace;
- **indirect reach into quantstats:** `getattr` dispatch over the namespace (it reports the dispatched names, read from the module-level table), and any reach into the preparers through `utils`, `_prepare_*` or a from-import.

`actuals.commits: 2` was measured with `git rev-list --count <plan_head_before>..HEAD` before this
SUMMARY was written. The SUMMARY commit is the third. `actuals.tokens` is chars/4 over the realized
diff.

## Commits

| Task | Commit | Files |
|---|---|---|
| 1 (tracer): AST scanner, real-corpus gate clean / not blind / allowlist not stale, old line gate deleted | 38ec7cc44 | `tests/qstats_gate.py`, `tests/test_qstats_gate.py`, `tests/test_metrics.py` |
| 2: census rows plus the 30-vs-9 reconciliation, printed through the one existing `pytest_terminal_summary` | 2abc1775e | `tests/qstats_gate.py`, `tests/test_qstats_gate.py`, `tests/conftest.py` |

`git show --name-only 38ec7cc44` lists both `tests/test_metrics.py` (old gate removed) and the new
`tests/test_qstats_gate.py`.

## The printed census (verbatim, from `census_lines()` at 2abc1775e)

```
qstats-gate census: 13 quantstats node(s) in services/metrics.py, 11 mirror(s), 0 violation(s); arms kwarg-proven=12 exempt=1 inline=11
  services/metrics.py | _serenity_index | value_at_risk | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _payoff_ratio_no_guess | avg_loss | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _payoff_ratio_no_guess | avg_win | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _kelly_criterion | win_rate | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _common_sense_ratio | profit_factor | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _common_sense_ratio | tail_ratio | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _cpc_index | profit_factor | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | _cpc_index | win_rate | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | compute_all_metrics | volatility | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | compute_all_metrics | value_at_risk | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | compute_all_metrics | tail_ratio | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | compute_all_metrics | profit_factor | call | kwarg-proven | prepare_returns=False on a leaf that honours it
  services/metrics.py | compute_all_metrics | drawdown_details | call | exempt | consumes the drawdown curve, never a returns series; pinned by test_rank05_drawdown_details_is_heuristic_free
  services/metrics.py | _common_sense_ratio | common_sense_ratio | mirror | inline | profit_factor/tail_ratio called without forwarding the kwarg
  services/metrics.py | _cpc_index | cpc_index | mirror | inline | profit_factor/win_rate/win_loss_ratio called without forwarding the kwarg
  services/metrics.py | _greeks_no_guess | greeks | mirror | inline | benchmark leg runs _prepare_benchmark unconditionally; D-15 pairwise, None not 0.0
  services/metrics.py | _kelly_criterion | kelly_criterion | mirror | inline | payoff_ratio/win_rate called without forwarding the kwarg
  services/metrics.py | _probabilistic_sharpe_ratio | probabilistic_ratio | mirror | inline | no prepare_returns kwarg; also D-16 non-excess kurtosis fix
  services/metrics.py | _r_squared | r_squared | mirror | inline | benchmark leg runs _prepare_benchmark unconditionally
  services/metrics.py | _recovery_factor | recovery_factor | mirror | inline | max_drawdown (which runs _prepare_prices) is called without the kwarg
  services/metrics.py | _rolling_greeks | rolling_greeks | mirror | inline | benchmark leg runs _prepare_benchmark unconditionally; D-17 windowed alpha intercept
  services/metrics.py | _serenity_index | serenity_index | mirror | inline | no prepare_returns kwarg; to_drawdown_series and cvar guess
  services/metrics.py | _ulcer_index | ulcer_index | mirror | inline | no prepare_returns kwarg; to_drawdown_series guesses
  services/metrics.py | _ulcer_performance_index | ulcer_performance_index | mirror | inline | no prepare_returns kwarg; ulcer_index and comp guess
qstats-gate reconciliation: services/metrics.py has 33 text occurrence(s) of 'qs.stats.' vs 13 AST quantstats node(s); the text count includes comments and docstrings, which cannot call anything (phase start: 30 vs 9)
```

The same header and reconciliation lines appear in the terminal output of a full
`pytest -q -n auto` run (6176 passed, 90 skipped). That is the Pitfall 5 check: the census is
visible on a green run.

## Reconciliation (30-vs-9)

| Reading | `qs.stats.` literal text occurrences in `services/metrics.py` | AST quantstats nodes | Violations |
|---|---|---|---|
| Phase start, `73cbf2995` (166-01 `plan_head_before`) | 30 | 9 | 4 |
| Now, `2abc1775e` | 33 | 13 | 0 |

The text count rose while every open site closed. The mirrors' docblocks cite the 0.0.81 functions
they mirror, which adds comment and docstring hits that cannot call anything. The AST node count
rose because the mirrors compose on kwarg-proven leaves: `_serenity_index`, `_payoff_ratio_no_guess`,
`_kelly_criterion`, `_common_sense_ratio` and `_cpc_index` together add 8 leaf calls. The dispatch
node, `greeks`, `r_squared` and `rolling_greeks` all left, so 9 - 4 + 8 = 13.

**The scanner, run against the phase-start `services/metrics.py`, finds exactly the research's
9 nodes. 5 pass and it reports exactly the 4 open sites:**

| Enclosing function | quantstats | shape | reason printed |
|---|---|---|---|
| compute_all_metrics | greeks | call | not a kwarg-proven leaf |
| compute_qstats_scalars | getattr | attribute dispatch | dispatches: recovery_factor, ulcer_index, ulcer_performance_index, kelly_criterion, probabilistic_ratio, common_sense_ratio, cpc_index, serenity_index |
| compute_qstats_scalars | r_squared | call | not a kwarg-proven leaf |
| _rolling_alpha_beta | rolling_greeks | call | not a kwarg-proven leaf |

The old gate reported that same tree as clean. Plan 08 turns this into permanent needles and
real-file neuter drills. The reading above was a one-off `scan_source` call on the phase-start file,
not a committed test.

## Allowlisted leaves

- `KWARG_PROVEN` = `avg_loss`, `avg_win`, `profit_factor`, `tail_ratio`, `value_at_risk`,
  `volatility`, `win_rate` (7). `test_qstats_gate_kwarg_allowlist_is_not_stale` holds this set EQUAL
  to the leaves the code calls, minus `EXEMPT`.
- `EXEMPT` = `drawdown_details` (1). It stays pinned by `test_rank05_drawdown_details_is_heuristic_free`.
  That test's docstring now points at the AST gate's `EXEMPT` rather than "the region gate below".
- `COVERED_MODULES` = `services/metrics.py`. `routers/process_key.py`, `services/analytics_runner.py`
  and `services/equity_reconstruction.py` mention quantstats only in comments, and the AST walk
  correctly finds no import in them.

**D-02, answered:** quantstats stays in production as a kwarg-closed dependency and the parity oracle.
The residual kwarg-closed sites are the 12 `kwarg-proven` rows above, over the 7 leaves.

## Verification

| Command (from `analytics-service/`, main-checkout venv) | Result |
|---|---|
| `pytest tests/test_qstats_gate.py -q -k "real_corpus or not_stale"` (Task 1 verify) | `3 passed` |
| `pytest tests/test_qstats_gate.py -q` (Task 2 verify; log checked for both line prefixes) | `5 passed`; census and reconciliation lines present; 1 `exempt` row, 11 `inline` rows |
| `pytest -q -n auto` after Task 1 | `6174 passed, 90 skipped` |
| `pytest -q -n auto` after Task 2 | `6176 passed, 90 skipped`, census printed |
| `mypy --strict --follow-imports=silent --config-file=pyproject.toml tests/qstats_gate.py tests/test_qstats_gate.py` | `Success: no issues found in 2 source files` (tests are outside CI's mypy surface; run for hygiene) |
| `ruff check tests/qstats_gate.py tests/test_qstats_gate.py` | `All checks passed!` |

Acceptance greps: `^def scan_source(` = 1; the old gate's `def` = 0 in `test_metrics.py`;
`def test_rank05_drawdown_details_is_heuristic_free` = 1; `^def pytest_terminal_summary` in
`conftest.py` = 1; `^def census_lines(` = 1.

The scanner was also exercised once on ad-hoc sources for each shape. Each needle below went RED:

- a direct unclosed call;
- `prepare_returns=True`;
- a variable value;
- a `**kwargs` splat;
- `cvar(..., prepare_returns=False)`;
- getattr over a table (names resolved);
- the `fn = qs.stats.x` alias;
- the `ns = qs.stats` alias;
- `from quantstats.stats import greeks`;
- `from quantstats import stats as S` then `S.greeks(...)`;
- `qs.utils._prepare_returns`;
- `qs.stats._utils._prepare_prices`;
- `_rolling_alpha_beta` calling `rolling_greeks`;
- a new importer outside `COVERED_MODULES`.

One control stayed GREEN: a clean module with a commented-out call and a string literal of one. A
temp-copy drill renaming `_cpc_index` printed that mirror as `MISSING` with `inline=10`. None of
these one-off checks is committed; plan 08 owns the permanent needles.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale pointer in the kept exemption pin's docstring**
- **Found during:** Task 1
- **Issue:** `test_rank05_drawdown_details_is_heuristic_free` said "the region gate below excludes it BY NAME". That gate was being deleted.
- **Fix:** The docstring now names `tests/qstats_gate.py`'s `EXEMPT`. The test body is unchanged.
- **Commit:** 38ec7cc44

**2. [Rule 2 - Missing correctness] Node accounting in the not-blind test**
- **Found during:** Task 1
- **Issue:** `nodes > 0` plus importer equality could not see a node that was examined and then silently dropped.
- **Fix:** The test now also asserts census rows plus non-import violations equals scanned nodes. Import-statement violations (`IMPORT_SHAPES`) are judged but not counted as nodes.
- **Commit:** 38ec7cc44

**3. [Rule 2 - Missing correctness] MIRRORED reasons checked against the installed library**
- **Found during:** Task 2
- **Issue:** Four drafted reasons did not match 0.0.81:
  - `cpc_index` calls `win_loss_ratio`, not `payoff_ratio`;
  - `serenity_index` guesses through `to_drawdown_series` and `cvar`;
  - `rolling_greeks`' strategy leg does take the kwarg, so the open leg is the benchmark;
  - `recovery_factor`'s wording was imprecise.
- **Fix:** Rewrote those four reasons from `inspect.getsource` of the installed functions.
- **Commit:** 2abc1775e

**4. Additions beyond the artifact list (no behaviour change to the plan's contract):**
- `mirror_rows()` is split out of `census_lines()` so the census test can assert arms without parsing text.
- `IMPORT_SHAPES`, `RECONCILED_MODULE` and `PHASE_START_TEXT_OCCURRENCES` / `PHASE_START_AST_NODES` are named constants. They keep the phase-start "30 vs 9" in the printed line and out of prose.

## Known limits (recorded, not hidden)

- **`KWARG_PROVEN` rests on research Q2's measurement, not on an in-tree test, until plan 08 lands.**
  Plan 08 adds the behavioural preparer-spy pins, parametrized over `sorted(KWARG_PROVEN)`. The
  census reason "a leaf that honours it" is a claim that those pins will hold.
- The reconciliation counts `qs.stats.` literally. A regex `grep -c 'qs.stats.'` over-matches
  (42 at phase start), so reproduce the 30 with `grep -cF`.
- The census is computed on the xdist controller from source text. If a production module ever fails
  to parse, the terminal-summary hook raises at the end of the run. That is loud by design.

## Known Stubs

None.

## Threat Flags

None. The change is test-only: no endpoint, no auth path and no schema.

## Self-Check: PASSED

- FOUND: analytics-service/tests/qstats_gate.py
- FOUND: analytics-service/tests/test_qstats_gate.py
- FOUND: 38ec7cc44
- FOUND: 2abc1775e
