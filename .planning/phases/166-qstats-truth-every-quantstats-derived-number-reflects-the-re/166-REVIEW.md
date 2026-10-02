---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
reviewed: 2026-09-24T21:16:39Z
depth: standard
files_reviewed: 12
files_reviewed_list:
  - analytics-service/services/metrics.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/fixtures/golden_252d_expected.json
  - analytics-service/tests/qstats_gate.py
  - analytics-service/tests/test_metrics.py
  - analytics-service/tests/test_qstats_gate.py
  - src/__tests__/csv-finalize-cross-submission-merge.test.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/lib/closed-sets.ts
  - src/lib/percentile-core.ts
  - src/lib/queries.percentile-columns.test.ts
  - src/lib/queries.ts
findings:
  critical: 0
  warning: 1
  info: 6
  total: 7
status: issues_found
---

# Phase 166: Code Review Report

**Reviewed:** 2026-09-24T21:16:39Z
**Depth:** standard
**Files Reviewed:** 12
**Status:** issues_found

## Summary

Reviewed the diff `origin/main...HEAD` for the 12 scoped files. I did not flag the
founder-approved value changes D-15, D-16 and D-17. Each one was checked against its decision text.

How the mirrors were checked. I read every Phase 166 mirror against the installed quantstats
0.0.81 source. The mirrors are `_recovery_factor`, `_ulcer_index`, `_ulcer_performance_index`,
`_serenity_index`, `_kelly_criterion`, `_payoff_ratio_no_guess`, `_probabilistic_sharpe_ratio`,
`_common_sense_ratio`, `_cpc_index`, `_align_benchmark_like_qs`, `_r_squared`,
`_greeks_no_guess` and `_rolling_greeks`. The quantstats functions they were compared with are
`ulcer_index`, `ulcer_performance_index`, `serenity_index`, `recovery_factor`, `max_drawdown`,
`to_drawdown_series`, `conditional_value_at_risk`, `value_at_risk`, `tail_ratio`,
`profit_factor`, `win_rate`, `avg_win`, `avg_loss`, `payoff_ratio`, `kelly_criterion`,
`probabilistic_ratio`, `greeks`, `r_squared`, `rolling_greeks`, `utils._prepare_benchmark`,
`utils._prepare_returns`, `utils._prepare_prices` and `utils.to_prices`. Every mirror follows
its source's expression order, apart from the documented guess removal and the D-15/D-16/D-17
changes.

The D-16 algebra is correct. `1 + 0.5·SR² − γ3·SR + ((γ4−3)/4)·SR²`, with γ4 the non-excess
kurtosis, reduces exactly to the published `1 − γ3·SR + ((γ4−1)/4)·SR²`.

Direct probes:
- On a random NaN-free pair, `_greeks_no_guess` equals live `greeks(prepare_returns=False)`
  bit for bit.
- A NaN on the benchmark leg is now handled pairwise. Live 0.0.81 raises a shape error there.
- `_r_squared` equals live `r_squared` on a weekday-only benchmark, which exercises the reindex
  branch.
- The canonical trigger now yields `ulcer_index=0.0`. `recovery_factor`, `upi`,
  `serenity_index`, `kelly_criterion`, `common_sense_ratio` and `cpc_index` are all None.
  PSR is `0.99985`.

`pytest tests/test_metrics.py tests/test_qstats_gate.py` gave 263 passed, run locally from
`analytics-service/`.

The golden fixture moves only `probabilistic_sharpe_ratio` (D-16) and the `rolling_alpha`
sibling series (D-17), plus one key reorder (IN-04). On the TS side, D-12 derives both lists
from `PERCENTILE_METRICS`, and the derivation is byte-neutral. The two new byte pins are
written by hand, so they can fail. I did not run `tsc`/`vitest` for this review: the worktree
has no `node_modules`, and D-19's symlink step belongs to the executor.

The one substantive defect is in the new AST gate. Its docstring and test claim to cover every
quantstats node in every production module. It is actually blind to every way of reaching
quantstats except `<alias>.stats.*` and `<alias>.utils`, all measured below. No such use
exists in the tree today, so this is a WARNING (gate soundness) and not a BLOCKER.

## Warnings

### WR-01: The AST gate is blind to quantstats reached any way other than `<alias>.stats.X` / `<alias>.utils`

**File:** `analytics-service/tests/qstats_gate.py` — `scan_source` (the B1/B2/B4 walk, `is_qs` / `is_stats_ns` / `roots_at_quantstats`)

**Issue:** The module docstring and `test_qstats_gate_real_corpus_is_clean` claim that
"every quantstats node in every production module is closed or exempt". The scanner only
counts and judges these shapes:
- attributes whose value is a stats namespace;
- `getattr` over a qs or stats alias;
- utils and `_prepare_*` references;
- a few from-imports.

Any other attribute on a quantstats alias is never counted as a node and never raises a
violation. I measured this by feeding `scan_source` needles under the covered module name
`services/metrics.py`, and under `services/other.py` for the re-export shapes. Each case
returned `violations=[]` and `nodes=0`:

| Source shape | Why it reopens the price guess |
|---|---|
| `qs.reports.metrics(r, mode='full', display=False)` | `reports.metrics` calls dozens of `stats.*` functions with the guess on |
| `qs.extend_pandas()` then `r.max_drawdown()` | monkeypatches every stats function onto `pd.Series`, so the call is a pandas method the gate cannot see |
| `from quantstats import *` then `stats.sharpe(r)` | a star import binds `stats`/`utils` without adding them to `stats_aliases`/`utils_aliases` |
| `from services.metrics import qs` then `qs.stats.sharpe(r)` (in another module) | a re-export of the alias is not an `import quantstats`, so Rule A (importer coverage) never fires and the name is not a qs alias |
| `from services import metrics` then `metrics.qs.stats.sharpe(r)` | same: the chain roots at `metrics`, not at a qs alias |

The first three reach `_prepare_returns` / `_prepare_prices` through exactly the heuristic this
phase closes. The last two let any module bypass `COVERED_MODULES`. The gate reports these as
clean, not as blind: the anti-vacuity assertion `nodes > 0` still passes on the real corpus,
because the other 13 nodes are present. D-14 required the gate to fail if a new module
reaches quantstats without being covered, and it does not do that for the re-export shapes.

**Fix:** Fail closed on every quantstats shape the gate does not positively recognise:
```python
# 1. Any use of a qs alias that is not `<qs>.stats` (as the value of an Attribute),
#    not a getattr() first argument, and not `<qs>.utils`/`_utils` (already RED) is RED:
for node in ast.walk(tree):
    if is_qs(node) and id(node) not in handled:
        par = parent.get(node)
        if not (isinstance(par, ast.Attribute) and par.attr == "stats"):
            scanned += 1
            violate(node, getattr(par, "attr", node.id), "non-stats namespace",
                    "quantstats reached outside qs.stats; reports/extend_pandas/plots prepare internally")
# 2. In the ImportFrom branch: alias.name == "*" is RED, and any
#    `from quantstats import <name>` other than `stats` is RED.
# 3. Rule A': in scan_tree, flag any module (other than COVERED_MODULES) that imports the
#    name `qs` from services.metrics or dereferences `<metrics module alias>.qs`.
```
Then add a RED needle per shape to `RED_NEEDLES`, so that each closure is proven able to fail.

## Info

### IN-01: The PSR mirror raises ZeroDivisionError on a one-observation series (0.0.81 returned NaN silently)

**File:** `analytics-service/services/metrics.py` — `_probabilistic_sharpe_ratio`

**Issue:** `base` now comes from `_annualized_vol_sharpe`, which returns a Python `float("nan")`
and not a numpy scalar. With `n = 1`, the expression `(...) / (n - 1)` is Python float / int 0,
which raises `ZeroDivisionError`. It does not produce NaN. Measured:
`compute_qstats_scalars(<1-row series>, b)` logs
`qstats scalar probabilistic_sharpe_ratio failed (returns_len=1): float division by zero`
with a traceback. The persisted value is still None, and `compute_all_metrics` returns early
at `len(returns) < 2`, so production never reaches this. It is a behaviour change from
0.0.81, where numpy division gave NaN without a log, and it would put a false "scalar failed"
WARNING in the logs for any direct caller.

**Fix:** Return NaN when `n < 2` before the division, or compute the division in numpy
(`np.divide(inner, n - 1)`), as `_ulcer_index` already does for the same reason.

### IN-02: `_greeks_no_guess` tz-normalises only one leg, so any tz-aware pair raises TypeError

**File:** `analytics-service/services/metrics.py` — `_greeks_no_guess`

**Issue:** The docstring says the strategy index is tz-normalised "so the pairwise join lines
the two legs up". But only `aligned_returns` goes through `_tz_naive_like_qs`, and
`aligned_benchmark` keeps its tz. `set(period) != set(benchmark.index)` is therefore always
true, and `_align_benchmark_like_qs` then fails in `reindex` with
`TypeError: Cannot compare dtypes datetime64[us, UTC] and datetime64[us]`. That was measured
on a tz-aware UTC pair. Live `greeks(..., prepare_returns=False)` handled the same pair,
because it normalised neither leg before the set check. The failure is not reachable today:
`compute_all_metrics` rejects tz-aware input earlier (measured, a pre-existing TypeError), and
the production callers build naive indexes. The helper's stated contract is still false.

**Fix:** Normalise both legs before aligning:
`r = _tz_naive_like_qs(aligned_returns); b = _align_benchmark_like_qs(_tz_naive_like_qs(aligned_benchmark), r.index)`.
Or drop the strategy-side normalisation and its docstring claim.

### IN-03: Stale docstring and log wording on `_safe_qstats_scalar`

**File:** `analytics-service/services/metrics.py` — `_safe_qstats_scalar`

**Issue:** The docstring still says "Run a single-arg qs.stats scalar", and the parameter is
typed `fn: Any`. After Phase 166, every callable in `_QSTATS_SINGLE_ARG_SCALARS` is a module
mirror, and the table is typed `Callable[[pd.Series], float]`. The "qs version drift"
rationale for the traceback dedup no longer describes what fails there.

**Fix:** Type `fn: Callable[[pd.Series], float]` and reword the docstring to "run one
single-arg scalar mirror".

### IN-04: The golden fixture carries an unrelated key reorder that no D-10 row describes

**File:** `analytics-service/tests/fixtures/golden_252d_expected.json` — `metrics_json.trade_metrics` and `metrics_json.volume_metrics`

**Issue:** Besides the D-16 (`probabilistic_sharpe_ratio`) and D-17 (`rolling_alpha`) value
moves, the regeneration re-sorted `mean_daily_turnover_usd` / `mean_trade_size_usd` /
`mean_monthly_turnover_usd` inside two sub-objects. No value changed. The parity readers are
dict-based, so no test is affected. D-10 still says "a fixture that moves without a row in
that table is a defect", and a byte-level reviewer will see these moves.

**Fix:** Either restore the original key order, or add one line to the D-10 record saying the
reorder is cosmetic, caused by the regeneration serialiser.

### IN-05: csv-finalize builds its projection and its check from two names for one array

**File:** `src/app/api/strategies/csv-finalize/route.ts` — `CLOCK_SAFETY_KPI_COLUMNS` and the `.select(...)` in `resolveExistingStrategyOrRefuse`

**Issue:** `CLOCK_SAFETY_KPI_COLUMNS` is now just `PERCENTILE_METRICS`. The `.select()` joins
`PERCENTILE_METRICS` directly, while the presence check iterates `CLOCK_SAFETY_KPI_COLUMNS`.
They are the same object today, so nothing is wrong. But this makes the constant a pure alias,
and the "projection == checked set" invariant now depends on two spellings.

**Fix:** Use `CLOCK_SAFETY_KPI_COLUMNS.join(", ")` in the select, or delete the alias and use
`PERCENTILE_METRICS` in both places.

### IN-06: The census hook in `pytest_terminal_summary` is unguarded

**File:** `analytics-service/tests/conftest.py` — `pytest_terminal_summary`

**Issue:** `census_lines()` parses every production `*.py` on every pytest invocation. If any
of those files fails to parse, or is unreadable (for example, a half-written file during local
work, or a non-UTF-8 file under `scripts/`), the terminal-summary hook raises. That turns the
session into an INTERNALERROR and hides the real test outcome behind a stack trace from the
census.

**Fix:** Wrap the census in `try/except Exception as exc:` and write
`qstats-gate census: FAILED TO BUILD ({exc!r})`. The gate itself stays in
`test_qstats_gate.py`, where a parse failure is a proper test failure.

---

_Reviewed: 2026-09-24T21:16:39Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
