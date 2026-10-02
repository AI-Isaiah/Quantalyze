# Phase 166: QSTATS-TRUTH - Pattern Map

**Mapped:** 2026-09-24
**Files analyzed:** 11 (7 source/test files modified, 2 new test files, 2 ledger files)
**Analogs found:** 11 / 11. Every analog is git-tracked source, checked with `git ls-files`.

> Citation rule: code is cited by SYMBOL. Any line number below is marked `~` and is approximate
> (measured at worktree HEAD 2026-09-24). Re-resolve by symbol before editing.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `analytics-service/services/metrics.py`: extracted primitives (`_drawdown_series`/`_max_drawdown`, `_annualized_vol_sharpe`, `_downside_rms`, `_cvar_tail`, `_prepared_returns_no_guess`, `_align_benchmark_like_qs`) | utility (pure money math) | transform | the inline drawdown / Sharpe / Sortino / smart_* / cvar blocks inside `compute_all_metrics`, plus `sharpe_vol_status_from_backbone`, in the same file | exact. They are the code being extracted. |
| `analytics-service/services/metrics.py`: 8 scalar mirrors plus `_r_squared` | service (scalar compute) | transform | the RANK-05 inline sites in `compute_all_metrics` (headline sharpe/sortino, smart_sharpe/smart_sortino, cvar) | exact (same P114 house style) |
| `analytics-service/services/metrics.py`: `_QSTATS_SINGLE_ARG_SCALARS` and `compute_qstats_scalars` | service (dispatch plus failure-soft) | batch (table-driven) | the existing `_QSTATS_SINGLE_ARG_SCALARS` / `_safe_qstats_scalar` / `compute_qstats_scalars` | exact (shape kept, element type changes) |
| `analytics-service/services/metrics.py`: inlined `greeks` in the M1 benchmark block (D-05, D-15) | service | transform | the M1 block in `compute_all_metrics` (`aligned_returns.corr(aligned_benchmark)` sibling) | exact |
| `analytics-service/services/metrics.py`: `_rolling_alpha_beta` plus a `_rolling_greeks` mirror (D-06, D-17) | service (rolling series) | transform, series to sibling_kinds | `_rolling_sharpe`, `_rolling_correlation`, and `_rolling_alpha_beta` itself | exact |
| `analytics-service/tests/test_qstats_gate.py` (NEW) | test (AST gate plus printed census) | batch (source scan) | `analytics-service/tests/test_raw_5xx_census.py` (`scan_source`, `_enclosing_function_resolver`, needle self-tests, `TestVacuityFence`). Also the gate being replaced, `test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics` | exact |
| `analytics-service/tests/qstats_gate.py` (NEW helper, recommended) | utility (test support) | transform | `analytics-service/tests/live_db_transport.py`, the non-test helper module that `conftest.py` lazily imports | role-match |
| `analytics-service/tests/conftest.py` | config (pytest hook) | event-driven (terminal summary) | its own `pytest_terminal_summary` / `live_db_retry_summary_line` | exact |
| `analytics-service/tests/test_metrics.py` | test (economic invariants, parity, fault injection) | request-response | its own Phase 159 RANK-05 section and the Q8 fault-injection tests | exact |
| `src/lib/queries.ts`, `src/app/api/strategies/csv-finalize/route.ts`, prose in `src/lib/closed-sets.ts` | config (constant derivation) | transform | `src/lib/percentile-core.ts` `PERCENTILE_METRICS` (already imported by `queries.ts`) | exact |
| New TS byte pin (e.g. `src/lib/percentile-columns.test.ts`) | test | request-response (captured `.select()`) | `src/lib/queries.test.ts` `captureSelect` (RANK-02 block) and `src/lib/queries.percentiles.test.ts` mock chain | exact |
| `.planning/WINDOWS.md` entries 5 and 9, `TODOS.md` 0f | ledger | none | `gsd-tools windows fixed <id>` (per the WINDOWS.md header) | n/a |

`analytics-service/tests/test_metrics_parity.py` is **not modified**. It is the byte oracle: 1e-12 for scalars, 1e-9 for series. If it moves, the mirror has a defect. The fixture must never be regenerated to make it pass.

---

## Pattern Assignments

### `services/metrics.py` — Wave 1: extract primitives FIRST (D-04 order binds)

**Analog A — drawdown** (`compute_all_metrics`, the "RANK-05 (Phase 159) — WHY INLINE, NOT quantstats. `max_drawdown` and `to_drawdown_series`" block, ~L700-750):
```python
_wealth = (1.0 + returns.fillna(0)).cumprod()
max_dd = _safe_float(
    float((_wealth / _wealth.cummax().clip(lower=1.0)).min()) - 1.0
)
dd_series = (
    cumulative / cumulative.cummax().clip(lower=1.0) - 1.0
).replace([np.inf, -np.inf, -0.0], 0.0)
```
Constraints to carry into the primitive:
- The primitive takes a **wealth curve**, not returns. `max_dd` builds its wealth from `returns.fillna(0)` (unclipped). `dd_series` builds it from `cumulative`, which comes from `returns_for_chart` (floored at `_LOG_RETURN_FLOOR`). Do not unify the clip (RESEARCH Pattern 1).
- `max_dd` applies `.min()` then `- 1.0` with **no** `-0.0` replace. `dd_series` applies the replace. Keep both operation orders, or assert `math.copysign` on the all-winning fixture (RESEARCH Pitfall 6).
- Keep the docblock text (the baseline-ladder divergence and the NaN convention). Move it onto the primitive and leave a one-line pointer at the call site.

**Analog B — annualized vol/Sharpe** (the headline site after the `volatility` kwarg call, ~L814-818; and `sharpe_vol_status_from_backbone`, ~L1636-1642):
```python
_stat_std = stat_returns.std()  # pandas default ddof=1 == quantstats' std(ddof=1)
sharpe = _safe_float(
    (stat_returns.mean() * periods_per_year)
    / (_stat_std * math.sqrt(periods_per_year))
)
# backbone spelling:
vol = _safe_float(returns.std() * math.sqrt(periods_per_year))
mean_ret = returns.mean() * periods_per_year
sharpe = _safe_float(mean_ret / vol)
```
One primitive returns `(vol, sharpe)` with `vol = std * sqrt(ppy)` and `sharpe = (mean * ppy) / vol`. RESEARCH shows this is bit-identical for both callers. With `ppy=1` it gives the PSR base `mean/std` exactly. Keep `sharpe_vol_status_from_backbone`'s status ladder (`insufficient_history` / `nan_vol` / `zero_volatility` / `ok`) outside the primitive.

**Analog C — downside RMS** (headline sortino ~L830-837; `smart_sortino` ~L1193-1197):
```python
_downside_sq_sum = float((_sortino_excess[_sortino_excess < 0.0] ** 2).sum())
_sortino_n = int(_sortino_excess.count())
_downside = math.sqrt(_downside_sq_sum / _sortino_n) if _sortino_n > 0 else float("nan")
# smart_sortino:
math.sqrt(float((_smart_r[_smart_r < 0.0] ** 2).sum()) / _smart_n) if _smart_n > 0 else float("nan")
```
`_smart_r` is `dropna()`, so `len == count`. One `_downside_rms(x)` using `x.count()` serves both. Research reports this is a pure dedup: none of the new mirrors consumes it. It is still extracted first, because D-04 binds the order.

**Analog D — CVaR tail** (the inline `cvar` block after `var_1d_95`, ~L997-1006):
```python
_cvar_tail = returns[returns < _cvar_threshold]
metrics_json["cvar"] = _safe_float(
    float(_cvar_tail.mean()) if len(_cvar_tail) > 0 else _cvar_threshold
)
```
Extract `_cvar_tail(series, threshold)` so that `serenity_index` can reuse it on the drawdown series. The threshold still comes from `qs.stats.value_at_risk(dd, confidence=0.95, prepare_returns=False)`, which is a proven kwarg leaf.

**Gate for Wave 1:** the full suite plus `tests/test_metrics_parity.py` stay green **with no test edits**.

---

### `services/metrics.py` — mirrors (8 scalars plus `_r_squared`)

**Analog:** the RANK-05 inline sites. Copy the docblock shape used at the headline sharpe/sortino site (~L771-813) and at `smart_sharpe` (~L1133-1155):
```python
# RANK-05 (Phase 159) — WHY INLINE, NOT quantstats. The pinned quantstats
# 0.0.81 routes every stat through `_utils._prepare_returns`, which carries a
# PRICE-detection heuristic ...
#     elif data.min() >= 0 and data.max() > 1:
#         data = data.pct_change(fill_method=None)
# ...
# MATH PARITY — reproduces quantstats 0.0.81 exactly, MINUS the price guess
# (quantstats/stats.py, `sharpe` and `sortino`):
#     sharpe:  divisor = returns.std(ddof=1)
#              res = returns.mean() / divisor; return res * sqrt(periods)
# ...
# NaN CONVENTION (deliberate, recorded): ...
```
Every mirror docblock needs four parts: (1) WHY INLINE, citing the RESEARCH §Q2 spy result for that function, (2) MATH PARITY, quoting the 0.0.81 body from RESEARCH §Q3, (3) the NaN CONVENTION, and (4) any recorded divergence, such as F-2 for PSR.

**NaN convention (RESEARCH Pattern 2, Rule 7):** the new mirrors use `P(r) = inf→NaN→fillna(0)`, which is `_prepared_returns_no_guess`. They do **not** use 159's skipna. Record this divergence at the site, next to 159's skipna note, so the reader sees both conventions and the reason for each.

**Composing on kwarg-proven leaves.** Precedent: `compute_all_metrics` already calls `qs.stats.profit_factor(returns, prepare_returns=False)` and `qs.stats.tail_ratio(returns, prepare_returns=False)`. `kelly`, `common_sense`, `cpc` and `payoff` compose on `qs.stats.{profit_factor, tail_ratio, win_rate, avg_win, avg_loss}(P(r), prepare_returns=False)`. **Never** call `payoff_ratio`, `win_loss_ratio` or `cvar` through qs: they drop the kwarg (RESEARCH §Q2, F-5).

**Imports.** Add `from scipy.stats import linregress, norm` at module level. The house style for a direct scipy import is `services/portfolio_metrics.py`: `from scipy.optimize import brentq, newton`. Import at module scope so tests can `monkeypatch.setattr(metrics_module, "linregress", boom)`. That is how the r_squared fault tests get re-targeted. mypy already sets `ignore_missing_imports` for `scipy.*`.

**D-09 / D-16 outputs.** Every mirror returns a raw float or NaN, and `_safe_float` maps NaN and ±inf to `None`. That mapping is how `recovery_factor`, `upi`, `serenity_index` and `common_sense_ratio` reach `None`. Do not special-case them. The PSR mirror uses the NON-excess fourth moment (D-16). Its test anchor is an in-test computation of the published formula, not live quantstats.

---

### `services/metrics.py` — `_QSTATS_SINGLE_ARG_SCALARS` / `compute_qstats_scalars`

**Analog:** the current definitions (~L168-194, ~L227-254, ~L1824-1843):
```python
_QSTATS_SINGLE_ARG_SCALARS: tuple[tuple[_QstatsScalarKey, str], ...] = (
    ("recovery_factor", "recovery_factor"),
    ...
)
...
for result_key, qs_attr in _QSTATS_SINGLE_ARG_SCALARS:
    result[result_key] = _safe_qstats_scalar(
        result_key, getattr(qs.stats, qs_attr), returns, returns_len
    )
...
r_squared_val = _safe_float(qs.stats.r_squared(returns, benchmark))
result["r_squared"] = r_squared_val
result["r_squared_status"] = "ok" if r_squared_val is not None else "error"
```
Changes:
- Keep the `_QstatsScalarKey` Literal. Retype the table to `tuple[tuple[_QstatsScalarKey, Callable[[pd.Series], float]], ...]` with module callables, and delete the `getattr(qs.stats, …)` line.
- Keep `_safe_qstats_scalar(name, fn, returns, returns_len)`, since `fn: Any` already fits. The H-0710 WARNING text `"qstats scalar %s failed ..."` and `_should_emit_traceback` dedupe stay unchanged.
- Replace `qs.stats.r_squared(returns, benchmark)` with `_r_squared(returns, benchmark)`. Keep the `r_squared_status` three-state logic and the `except` WARNING exactly as they are.
- Call `_align_benchmark_like_qs` **twice**, as quantstats does, against the UNALIGNED benchmark. Never use the M1 inner-join pair for r² (RESEARCH Pitfall 3).
- Update the dispatch-table comment ("(result_key, qs.stats attribute name)") so it still describes the code.

---

### `services/metrics.py` — inlined greeks in the M1 benchmark block (D-05, D-15)

**Analog:** the M1 block (`compute_all_metrics`, "Benchmark metrics (single greeks() call ...)", ~L1344-1391):
```python
aligned = returns.align(benchmark_returns, join="inner")
aligned_returns, aligned_benchmark = aligned[0], aligned[1]
if len(aligned_returns) > 1:
    greeks = qs.stats.greeks(aligned_returns, aligned_benchmark, periods=periods_per_year, prepare_returns=False)
    metrics_json["alpha"] = _safe_float(greeks.get("alpha", 0))
    metrics_json["beta"] = _safe_float(greeks.get("beta", 0))
    metrics_json["correlation"] = _safe_float(aligned_returns.corr(aligned_benchmark))
    ...
    beta = metrics_json.get("beta", 0)
    if beta and beta != 0 and cagr is not None:
        metrics_json["treynor"] = _safe_float(cagr / beta)
```
- Keep the inner-join `aligned` pair exactly as it is (the M1 contract). Replace only the `qs.stats.greeks` line and the two `.get(..., 0)` reads. The `0` defaults are the fabrication path and must go.
- D-15: compute over pairwise-complete observations (the `correlation` sibling on the next line is the house precedent). `beta = cov/var`. `alpha = (mean_r − beta·mean_b)·periods_per_year`, so F-1 is kept. Emit `None` when there are fewer than 2 complete pairs or `var(b) == 0`, and never `0.0`. The treynor guard `if beta and beta != 0` already skips a `None` beta, so it needs no change. Verify that claim and do not add a guard.
- Replace the "RESIDUAL, recorded rather than silently left" comment with the closure note, and cite the D-15 disclosure.
- The surrounding `except` WARNING (`"benchmark_metrics fan-out failed ..."`) stays as the failure-soft envelope.

---

### `services/metrics.py` — `_rolling_alpha_beta` (D-06, D-17)

**Analog 1:** `_rolling_alpha_beta` itself (~L2071-2130). Keep the guards (None, `returns.align(benchmark, join="inner")`, `aligned_n < window`) and the H-0726.3 WARNING-plus-`([], [])` failure envelope:
```python
try:
    greeks = qs.stats.rolling_greeks(aligned_returns, aligned_benchmark, window)
except Exception as exc:  # noqa: BLE001
    logger.warning(
        "rolling_greeks failed (aligned_n=%s, window=%s): %s",
        aligned_n, window, exc, exc_info=True,
    )
    return [], []
...
return _finalize_rolling(greeks["alpha"]), _finalize_rolling(greeks["beta"])
```
**Analog 2** (house rolling-math style): `_rolling_sharpe` and `_rolling_correlation`:
```python
roll_mean = returns.rolling(window).mean()
roll_std = returns.rolling(window).std()
ratio = np.where(roll_std > 0, roll_mean / roll_std, np.nan)
...
return _finalize_rolling(a.rolling(window).corr(b))
```
- Put the mirror in one helper (for example `_rolling_greeks(r, b, window) -> pd.DataFrame`) and call it **once**. That keeps H-0711 and gives the test a single spy target.
- Keep the WARNING message containing the substring `rolling_greeks`, because `test_rolling_alpha_beta_logs_warning_on_qs_failure` matches on it.
- Rolling beta: `corr·std_r/std_b.replace(0, NaN)` on `DataFrame({P(r), _align_benchmark_like_qs(b)}).fillna(0)`, exactly as 0.0.81 computes it.
- Rolling alpha (D-17): the windowed intercept `mean_w(r) − β_t·mean_w(b)`, UNANNUALIZED. Keep the Phase 34 NOTE text and add a D-17 line.
- The "missing expected alpha/beta columns" branch becomes dead. Delete it and `test_rolling_alpha_beta_missing_columns_returns_empty_and_logs` together, and record the deletion (159 Deviation-2 rule).
- Update the `_rolling_alpha` / `_rolling_beta` docstrings ("via qs.stats.rolling_greeks") so they stay true.

---

### `analytics-service/tests/test_qstats_gate.py` (NEW — AST gate, D-14 / D-07)

**Primary analog:** `analytics-service/tests/test_raw_5xx_census.py`. Copy its structure as-is: one pure scanner exercised both by the disk walk and by the needle fixtures.

Enclosing-function resolver (`_enclosing_function_resolver`). Copy it verbatim. It keys on the function name, not `lineno`:
```python
def _enclosing_function_resolver(tree: ast.AST) -> dict[ast.AST, str]:
    parent: dict[ast.AST, ast.AST] = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parent[child] = node
    resolved: dict[ast.AST, str] = {}
    for node in ast.walk(tree):
        cursor: ast.AST | None = parent.get(node)
        name = "<module>"
        while cursor is not None:
            if isinstance(cursor, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = cursor.name
                break
            cursor = parent.get(cursor)
        resolved[node] = name
    return resolved
```
Scanner shape (`scan_source(module_name, source) -> list[NamedTuple]`) and file walk (`scanned_files`):
```python
SERVICE_ROOT = Path(__file__).resolve().parent.parent
def scanned_files() -> list[Path]:
    paths: list[Path] = []
    for pattern in ("routers/**/*.py", "services/**/*.py"):
        paths.extend(SERVICE_ROOT.glob(pattern))
    paths.append(SERVICE_ROOT / "main.py")
    return sorted({p for p in paths if "tests" not in p.relative_to(SERVICE_ROOT).parts})
```
For D-14 Rule A, widen this to every `*.py` under `analytics-service/` except `tests/` and `.venv/`, so that a new importer anywhere turns the gate RED.

Needle self-tests (`TestNeedle…` class) are one positive and one negative per shape, each against the SAME `scan_source`:
```python
def test_positive_a_status_on_a_CONTINUATION_LINE_is_detected(self) -> None:
    source = (
        "from fastapi import HTTPException\n"
        "def handler():\n"
        "    raise HTTPException(\n"
        "        status_code=500,\n"
        ...
    found = self._five_xx(source)
    assert found == [Construction("needle.py", "handler", "HTTPException", 500)]
```
Required RED needles (RESEARCH Pattern 3):
- a direct unclosed call
- `prepare_returns=True`
- `cvar(..., prepare_returns=False)`
- `payoff_ratio(..., prepare_returns=False)`
- `getattr(qs.stats, name)` over a table, with the dispatched names reported
- an alias `fn = qs.stats.x`
- `from quantstats.stats import greeks`
- a `qs.utils` / `_prepare_*` reference
- a `_rolling_alpha_beta` helper calling `rolling_greeks`
- a new importer module outside `COVERED_MODULES`

Required GREEN needles: one clean module, and the commented-out-call and string-literal negatives copied from `test_negative_a_COMMENTED_OUT_raise_is_NOT_detected` and `test_negative_a_string_mentioning_the_constructor_is_NOT_detected`.

Vacuity fence (`TestVacuityFence`):
```python
found, file_count = scan_tree()
assert file_count >= MIN_FILES_SCANNED, (...)
```
For this gate, assert `scanned_nodes > 0` and `covered_modules_found == COVERED_MODULES`. Carry over the "blind, not clean" assertion message from the old gate.

**Secondary analog:** the gate being replaced, `test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics` in `tests/test_metrics.py`, ~L2934. Keep its ANTI-VACUITY docblock reasoning. Delete the test in the same commit that lands the AST gate, so there is never a window with no gate.

**Behavioural kwarg pins.** The analog is `test_rank05_drawdown_details_is_heuristic_free` (~L2915). That test is a source scan. The new pin is behavioural, per RESEARCH "Behavioural kwarg pin": spy `quantstats.utils._prepare_returns` / `_prepare_prices` with `monkeypatch`, call `getattr(qs.stats, name)(_rank05_trigger_series(), prepare_returns=False)`, and assert `calls == []`. Parametrize it over `KWARG_PROVEN`. Add `payoff_ratio` and `cvar` as expected-RED calibration rows. `drawdown_details` stays pinned by the existing source-scan test and is the one EXEMPT name.

**Allowlists are named SETS pinned by tests, never counts or keyword text.** Use `KWARG_PROVEN` (a frozenset of leaf names that are actually called) and `EXEMPT = {"drawdown_details"}`. A GREEN call must carry `keyword prepare_returns` with a value that is `ast.Constant(False)`.

---

### `analytics-service/tests/qstats_gate.py` (NEW helper, recommended) and `tests/conftest.py`

**Analog:** `conftest.py`'s `live_db_retry_summary_line` and `pytest_terminal_summary` (~L300-312). Note the lazy import of a non-test helper module:
```python
def live_db_retry_summary_line() -> str:
    """The exact line `pytest_terminal_summary` writes. Split out so it can be
    asserted against a REAL run's stdout rather than re-spelled in a test."""
    from tests.live_db_transport import retry_stats
    ...
def pytest_terminal_summary(terminalreporter):
    terminalreporter.write_line(live_db_retry_summary_line())
```
- Put the scanner and census builder in `tests/qstats_gate.py`, a helper beside `tests/live_db_transport.py`. The test file and the conftest hook then import the same single implementation, and conftest never imports a `test_*` module.
- Extend the one existing `pytest_terminal_summary`. Do NOT define a second hook with the same name in the same conftest, because the later definition silently shadows the earlier one. Keep `live_db_retry_summary_line()` first, then `write_line` each census row and the 30-vs-9 reconciliation line.
- The census is a pure function of source text, so the controller can compute it directly in the hook. Unlike the retry counter, it needs no xdist worker aggregation (`pytest_sessionfinish` / `_LiveDbRetryNodeCollector`).
- Pitfall 5: `print()` inside a passing test is captured and never shows. Use the hook.

---

### `analytics-service/tests/test_metrics.py` — Phase 166 section plus re-targets

**Analog — section header and fixtures** (the "Phase 159 / Plan 05 — RANK-05" block, ~L2578-2635):
```python
def _rank05_trigger_series() -> pd.Series:
    n = 60
    dates = pd.bdate_range("2024-01-01", periods=n)
    vals = np.linspace(0.012, 0.004, n)
    vals[0] = 1.5
    return pd.Series(vals, index=dates, name="returns").astype("float64")
```
New fixtures in the same style:
- `_q166_trigger_nonmonotone`: 60 bdays from 2024-01-01, even rows 0.004, odd rows 0.02, row 0 = 1.5.
- A benchmark-leg trigger: strategy `normal(0.0006, 0.013, 250)` with seed 15905; benchmark `[1.5] + linspace(0.02, 0.001, 249)`.
- A weekday-strategy vs 7-day-benchmark calendar-mismatch fixture.
- A 3-NaN-day `golden_returns` variant.

Each fixture gets an anti-vacuity guard modelled on `test_rank05_trigger_fixture_actually_trips_the_heuristic`.

**Analog — economic invariants.** `test_rank05_all_winning_series_has_zero_drawdown` and `test_rank05_all_winning_series_has_no_pain`. Record the measured pre-fix value in the docstring, as those tests do ("Pre-fix measurement: …").

**Analog — live parity table.** `_RANK05_PARITY_SITES` plus the parametrized `test_rank05_every_closed_site_matches_live_quantstats_on_a_benign_series`. Add a `_Q166_PARITY_SITES` table of `(key, oracle lambda)` for the 8 scalars plus r_squared, alpha and beta, compared at `rel=1e-12` over the benign fixtures. Also compare rolling series point by point. PSR is the exception: after D-16 its anchor is an in-test formula, not live qs.

**Analog — shuffle.** `_RANK05_ORDER_INVARIANT(_MJ)` plus `test_rank05_order_independent_statistics_survive_a_shuffle`. The shuffle set is PSR, kelly, csr and cpc only. For the benchmark leg, use a joint permutation of (r, b) pairs.

**Analog — fault re-targeting.** `test_rank05_inlined_scalars_are_failure_soft_without_quantstats`: (a) replace qs with a function that raises and assert the value survives; (b) inject a real fault into the inline math, `monkeypatch.setattr(metrics_module.np, "corrcoef", boom)`, and assert the named WARNING. Re-target these Q8 rows:

| Existing test | Re-target |
|---|---|
| `test_qstats_scalars_logs_warning_on_qs_failure` | inject into the `recovery_factor` mirror (or its drawdown primitive) and keep the WARNING-names-scalar assert |
| `test_qstats_scalars_dispatch_table_per_entry` | parametrize over the new table's callables. Monkeypatch the table entry (or the module attribute it references) and keep the per-row WARNING assert |
| `test_qstats_scalars_r_squared_status_error_on_qs_failure` / `_when_qs_returns_nan` | `monkeypatch.setattr(metrics_module, "linregress", ...)`. Keep the `'error'` status contract |
| `test_rolling_alpha_beta_single_rolling_greeks_call` | count calls to the new inline rolling helper, and assert exactly 1 per `compute_all_metrics` run |
| `test_rolling_alpha_beta_logs_warning_on_qs_failure` | detonate the inline rolling helper and keep `([], [])` plus a WARNING containing `rolling_greeks` |
| `test_rolling_alpha_beta_missing_columns_returns_empty_and_logs` | delete it together with the dead branch, and record the deletion |
| `test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics` | delete it once `test_qstats_gate.py` lands (same commit) |

Keep untouched: `test_rank05_quantstats_pin_is_still_0_0_81`, `test_rank05_drawdown_details_is_heuristic_free`, the `_rolling_alpha_beta` guard tests, `test_qstats_scalars_complete_set` / `_handle_missing_benchmark`, and `test_compute_all_metrics_inline_qstats_scalar_failures_log_warning`. That last test injects into `value_at_risk` / `tail_ratio` / `profit_factor`, which are still qs leaves.

**Imports** (top of `test_metrics.py`) are `import quantstats as qs` and `from services.metrics import compute_all_metrics, _safe_float, sanitize_metrics`. Local tests use `import services.metrics as metrics_module` inside the function body before monkeypatching. Follow that.

---

### `src/lib/queries.ts`, `src/app/api/strategies/csv-finalize/route.ts`, `src/lib/closed-sets.ts` (D-12 / D-18)

**Source of truth:** `src/lib/percentile-core.ts` `export const PERCENTILE_METRICS` (same 7 columns in the same order, `as const`, no imports). `queries.ts` already imports from it (`import { scoreAgainstPopulation, type PercentileMap } from "./percentile-core";`). Extend that import and do not add a second import line.

Current literals, which must stay byte-identical:
```ts
// queries.ts
const PERCENTILE_ANALYTICS_COLUMNS =
  "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return";
// route.ts
const CLOCK_SAFETY_KPI_COLUMNS = ["cagr", "sharpe", "sortino", "calmar", "max_drawdown", "volatility", "cumulative_return"] as const;
// route.ts, the clock-safety guard's .select(...)
"cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return, computation_status",
```
Derivation (RESEARCH §Q7):
- `PERCENTILE_METRICS.join(", ")`.
- In the route: `import { PERCENTILE_METRICS } from "@/lib/percentile-core";`. `PERCENTILE_GATE_COLUMN` comes from `@/lib/closed-sets`, which the route already imports twice (`isComputedAnalytics`, `MAGNITUDE_CAPS`). Fold it into one of those import statements.
- Prose that must be rewritten in the SAME commit, or it becomes false:
  - the route's `CLOCK_SAFETY_KPI_COLUMNS` docblock ("MIRRORING … member for member … duplicated rather than imported deliberately … original is not exported")
  - the guard's inline "⛔ The column set MIRRORS" comment
  - the `queries.ts` "⚠️ BYTE-FROZEN" docblock
  - the `closed-sets.ts` RANK-01 comment above `PERCENTILE_GATE_COLUMN` ("mirrored member-for-member … would silently falsify three comments")

### New TS byte pin

**Analog:** `src/lib/queries.test.ts` RANK-02 `captureSelect`, which records the `.select()` string and asserts on the captured string. Also `src/lib/queries.percentiles.test.ts`, whose `vi.mock("@/lib/supabase/server", …)` thenable chain makes `getPercentiles` resolvable. Modify it so `chain.select = (cols) => { recorded.push(cols); return chain; }`. For the route, the analog is the `strategy_analytics` branch in `src/__tests__/csv-finalize-cross-submission-merge.test.ts` mock (~L245). Today it ignores the select argument, so the pin must capture it.

The pin asserts the OLD literal strings exactly. It is observed GREEN on the literals before the derivation, still GREEN after it, and RED when the join separator is mutated (D-18). No existing test pins these bytes. RESEARCH confirmed "byte-frozen" is enforced only by prose.

TS verification needs the D-19 symlinked `node_modules`, created and removed before every commit. Exit code 127 counts as a FAIL.

---

## Shared Patterns

### Failure-soft scalar contract
**Source:** `services/metrics.py` `_safe_qstats_scalar`, `_safe_float`, `_should_emit_traceback`.
**Apply to:** every mirror output and every new `try`.
```python
except Exception as exc:  # noqa: BLE001
    logger.warning(
        "qstats scalar %s failed (returns_len=%s): %s",
        name, returns_len, exc,
        exc_info=_should_emit_traceback(name, exc),
    )
    return None
```
One failing scalar never takes the others down, and the WARNING names the scalar. NaN and ±inf map to `None` through `_safe_float`. Postgres JSONB rejects NaN, so this is the only exit path.

### P114 mirror docblock
**Source:** `compute_all_metrics` "RANK-05 (Phase 159) — WHY INLINE, NOT quantstats" blocks, at the headline sharpe/sortino site and at `smart_sharpe`.
**Apply to:** every extracted primitive and every mirror. Each needs: the quoted 0.0.81 source, MATH PARITY, the NaN CONVENTION, and a recorded divergence where one exists (F-1 kept, F-2/F-3/F-4 fixed under D-15/16/17, the recovery_factor arithmetic-vs-compounded numerator kept).

### The 159 test triad
**Source:** `tests/test_metrics.py` RANK-05 section.
**Apply to:** each closed site. The triad is: (1) an economic invariant on a trigger fixture, observed RED against HEAD before the fix (neuter, then RED, then restore); (2) live-quantstats parity on benign fixtures; (3) shuffle invariance for statistics that do not depend on order.

### Gate by pure scanner plus needles plus vacuity fence
**Source:** `tests/test_raw_5xx_census.py`.
**Apply to:** `test_qstats_gate.py`. The scanner is a single implementation. Every allowlist entry is a named site pinned by a test. Floors and anti-vacuity checks are asserted. The census is printed through `pytest_terminal_summary`.

### Python test execution
Run from `analytics-service/` only, with the main checkout's `.venv` python given by absolute path. Never run from the repo root, where cassettes miss and broker calls go live. Never run against a database.

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `_align_benchmark_like_qs` (inside `services/metrics.py`) | utility | transform | Nothing in the repo reproduces quantstats' `_prepare_benchmark` reindex and bfill. Use the RESEARCH Pattern 2 code sketch, and copy the tz-normalisation step verbatim from the installed 0.0.81 `quantstats/utils.py` |
| PSR mirror with non-excess kurtosis (D-16) | service | transform | No PSR code exists outside quantstats. Use the RESEARCH §Q3 row plus the F-2 citation. The test anchor is an in-test formula |

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/tests/`, `src/lib/`, `src/app/api/strategies/csv-finalize/`, `src/__tests__/`, `.planning/WINDOWS.md`, `TODOS.md`
**Files scanned:** ~16
**Pattern extraction date:** 2026-09-24
