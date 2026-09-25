---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
round: 2
reviewed: 2026-09-25T00:00:00Z
depth: standard
reviewed_range: 2c5733bb7..HEAD (round-1 fix commits), read against origin/main
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/metrics.py
  - analytics-service/tests/qstats_gate.py
  - analytics-service/tests/test_qstats_gate.py
  - analytics-service/tests/test_metrics.py
  - analytics-service/tests/conftest.py
  - src/app/api/strategies/csv-finalize/route.ts
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 166: Code Review Report, round 2

**Reviewed:** 2026-09-25
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

This round reviewed the round-1 fix range `2c5733bb7..HEAD`, checking whether each round-1 finding is
really closed and looking for regressions the fixes introduced. Every probe ran in the scratchpad,
imported the pinned checkout read-only, and used the main checkout's `analytics-service/.venv`.
`pytest tests/test_metrics.py tests/test_qstats_gate.py tests/test_metrics_parity.py`, run from
`analytics-service/`, gave **331 passed**, with the census clean (13 nodes, 11 mirrors, 0 violations).

**Confirmed closed:**
- **MEDIUM-1:** the test now asserts that the keys are present, and that no fan-out WARNING was logged.
- **MEDIUM-2:** both serenity arms are pinned. The `den == 0` arm is forced, and the reasoning is sound.
- **LOW-1 / IN-02:** a same-tz aware pair now works. See IN-03 for a narrow side effect.
- **LOW-2 / LOW-3 / INFO-1:** recorded as described.
- **IN-01:** PSR returns NaN when `n < 2`.
- **IN-03:** the type and docstring are fixed.
- **IN-05:** `.select()` joins `CLOCK_SAFETY_KPI_COLUMNS`.
- **IN-06:** `safe_census_lines` turns a census failure into one named line, and the gate tests still fail on the same cause.
- **B5 / B6:** they fail closed on every shape round 1 named, and on the extra shapes I tried
  (`st = qs.stats`, bare `import quantstats.stats`, `import quantstats.reports` without `as`,
  `qs.stats.__dict__[...]`, `stats.extend_pandas`).

**The LOW-4 predicate `_every_mirror_ratio_is_defined` holds up under measurement.** I checked every
predicate-true series in two sets:
- 11,391 random series in four shapes: a high per-period Sharpe with a few small losses, a
  loss only on day 1, NaN gaps, and normal draws.
- an exhaustive 12-value grid at n=4 and n=5, plus a 5% sample at n=6, including NaN and
  a +150% day. That is 335,887 series.

On all of them, every one of the eight mirrors returned a finite value. The "the mirror is suspect"
WARNING therefore raised no false alarm on any input I could build.

**Not closed: HIGH-1, the headline fix.** The residue guard compares the float residue against
`|mean|`. The residue that `x / y - 1` leaves is absolute, about 1e-16, so it does not shrink with
`|mean|`. A constant yield of 1e-4 or 1e-5 a day, derived from a compounding equity curve, still
persists a Sharpe of about 1e13 with status `ok` and a PSR of 1.0 (CR-01). Separately, `smart_sharpe`
still persists 4.6e15 on the exact constant fixture the round-1 test uses (WR-01).

## Critical Issues

### CR-01: `_dispersion_is_residue` scales the residue by `|mean|`, so an equity-derived constant yield still persists a Sharpe of about 1e13 with status `ok`

**File:** `analytics-service/services/metrics.py`: `_DISPERSION_RESIDUE_REL`, `_dispersion_is_residue`. The
defect reaches `_annualized_vol_sharpe` (headline `sharpe`, `sharpe_vol_status_from_backbone`,
`info_ratio`, and the PSR base), `_greeks_no_guess` and `_serenity_index`.

**Issue:** The guard is `sd <= 1e-12 * abs(mean)`. Its comment says the residue is "about
`1e-16 * |mean|`". That holds only for a series built by repeating one float, which is the only shape
the new tests use (`_q166r_constant_series`). A constant yield computed the way this platform
actually gets returns, as the `pct_change` of an equity curve, carries a residue of about 1e-16 in
**absolute** terms, because the error comes from the ratio `E_t/E_{t-1}`, which is about 1. Relative
to a small mean, that residue grows past the threshold. Measured through `compute_all_metrics(r,
periods_per_year=365)` on `r = (10000 * (1 + y) ** arange(366)).pct_change().dropna()`:

| daily yield `y` | `sd / abs(mean)` | headline `sharpe` | backbone | PSR | `smart_sharpe` |
|---|---|---|---|---|---|
| 1e-3 | 1.2e-13 | None | `zero_volatility` | None | 8.7e13 |
| 1.3e-4 | 9.8e-13 | None | `zero_volatility` | None | 1.1e13 |
| **1e-4** | **1.28e-12** | **1.49e13** | **`ok`, 1.49e13** | **1.0** | 8.6e12 |
| **1e-5** | **1.27e-11** | **1.50e12** | **`ok`, 1.50e12** | **1.0** | 8.9e11 |

A 1e-4 daily yield (about 3.7% APY, a stablecoin-lending shape) therefore still ranks at the top of
every Sharpe percentile. That is the exact user-facing lie HIGH-1 was opened for. Whether the guard
catches a series flips between 1.3e-4 and 1e-4, so its behaviour depends on the yield, not on the
data. The same shape on the benchmark leg gets past the new `_greeks_no_guess` guard: alpha comes out
as -3.5e10 and beta as 9.6e11. The rendered rolling series on the same input have exact `> 0` / `!= 0`
guards and never reach this helper. `_rolling_sharpe` renders values around 1.9e13, and
`_rolling_greeks` renders a rolling beta around 2.8e13. So the class the fix report calls closed is
open at every divisor that sees an equity-derived series.

The docstring claim "it only reclassifies a series whose per-period mean/std exceeds 1e12, which no
real return series reaches" is also contradicted by the 1e-4 row: that is a real return series,
and it sits at mean/std ≈ 7.8e11.

Round 1's recommendation already had the missing term: `1e-12 * max(1.0, abs(r.mean()) * periods)`.
The fix dropped the `max(1.0, ...)` floor.

**Fix:** anchor the residue to the scale returns are computed at, which is `|1 + r| ≈ 1`:
```python
def _dispersion_is_residue(sd: float, mean: float) -> bool:
    # A return is a ratio to 1: `E_t / E_{t-1} - 1` leaves an ABSOLUTE ~1e-16
    # residue however small the mean is, so the floor is on max(1, |mean|).
    return bool(sd <= _DISPERSION_RESIDUE_REL * max(1.0, abs(mean)))
```
Also apply the same predicate to `_rolling_sharpe`'s `roll_std > 0`, `_rolling_greeks`'
`std["benchmark"].replace(0, np.nan)` and the `smart_sharpe` divisor (WR-01). Add a fixture built by
`pct_change` of a compounding curve at yields 1e-3, 1.3e-4, 1e-4 and 1e-5 to
`test_q166r_constant_series_sharpe_is_undefined_not_a_residue_quotient`, and a matching one to the
greeks test. Update the D-10 rows in `09cd04bd1` to name this shape.

One limit should be recorded rather than fixed. An equity curve rounded to cents carries real
quantisation noise: sd/|mean| is about 4e-3, and the Sharpe comes out around 4700. No residue
threshold can tell that apart from dispersion.

## Warnings

### WR-01: `smart_sharpe` still persists a residue quotient of 4.6e15 on the round-1 test's own constant fixture

**File:** `analytics-service/services/metrics.py`: `compute_all_metrics`, the `smart_sharpe` site (the
`_smart_sharpe_divisor` guard).

**Issue:** The divisor is `float(_smart_r.std()) * _smart_penalty`, and the guard is `> 0.0`. On
250 days of a constant 0.001, the headline `sharpe` is now None, but
`metrics_json.metrics_json.smart_sharpe` is **4620826545062588.0**. On a constant -0.002 it is
-4.6e15. This is the same exact-zero-guard defect as HIGH-1, at a sibling site the fix did not touch.
The fix report and the D-10 rows present the constant-series class as closed. No test covers
`smart_sharpe` on a constant input. No renderer in `src/` reads the key today (measured:
`metric-labels.ts` holds a threshold entry only), which is why this is a WARNING and not a BLOCKER.
The fabricated value still sits in every affected `strategy_analytics.metrics_json` row.

**Fix:** guard the divisor with the helper, and assert on it in the constant-series test:
```python
_smart_sd = float(_smart_r.std())
metrics_json["smart_sharpe"] = (
    _safe_float((float(_smart_r.mean()) / (_smart_sd * _smart_penalty)) * math.sqrt(252))
    if _smart_sd * _smart_penalty > 0.0
    and not _dispersion_is_residue(_smart_sd, float(_smart_r.mean()))
    else None
)
```

### WR-02: `r_squared` over a constant non-zero benchmark persists about 1e-34 with status `ok`, which contradicts the INFO-2 contract the fix wrote

**File:** `analytics-service/services/metrics.py`: `_r_squared`, `_r_squared_pair_varies`,
`compute_qstats_scalars` (the r_squared block).

**Issue:** The INFO-2 fix says "a constant leg (legitimately undefined) stays status `error` with no log".
That is true only for an EXACT-zero benchmark, which is the only case
`test_q166r_r_squared_error_is_logged_only_when_both_legs_vary` uses (`flat = 0.0`). On a constant
0.001, 0.0005 or -0.002 benchmark, the variance is float residue. scipy `linregress` checks only
`ssxm == 0.0`, so it returns a residue correlation. Measured at n = 120, 250 and 1000: `r_squared`
is 4.5e-35, 6.4e-33 and 1.4e-34, each with `r_squared_status = "ok"`, while
`_r_squared_pair_varies` returns False for the same pair. The code's own predicate says R^2 is
undefined here, but the row is persisted as a measured zero. That breaks D-09 (undefined is None,
never a number). The HIGH-1 class is open here too.

**Fix:** in `compute_qstats_scalars`, compute `_r_squared_pair_varies` first. When the pair does
not vary, persist `r_squared = None` with status `error` and write no log. Add constant non-zero
benchmarks to the test. Benign pairs vary on both legs, so parity is unaffected.

### WR-03: Rule A' has at least six static bypasses, while the docstring claims one known limit

**File:** `analytics-service/tests/qstats_gate.py`: `scan_source` (the Rule A' block and B6), and the
module docstring's "KNOWN LIMIT, RECORDED".

**Issue:** The docstring says the only unresolved shape is "an attribute name computed at run time".
I passed each shape below to `scan_source("services/other.py", ..., frozenset({"qs"}))`. Each one
returned **`nodes=0`, `violations=[]`**, and every key in it is a constant:
- `importlib.import_module("services.metrics").qs.stats.sharpe(r)`: B6 fires only on a string
  naming quantstats, and A' `_dotted` returns None for a Call base.
- `sys.modules["services.metrics"].qs.stats.sharpe(r)`
- `vars(metrics)["qs"].stats.sharpe(r)`: B6's namespace-dict rule checks the local `qs_aliases`,
  which is empty in an uncovered module.
- `metrics.__dict__["qs"].stats.sharpe(r)`
- `compute_all_metrics.__globals__["qs"].stats.sharpe(r)`
- `m = services.metrics; m.qs.stats.sharpe(r)`, and `m2 = metrics; m2.qs...`: a module alias
  rebound by assignment is not tracked.

Each of these lets an uncovered module run `qs.stats.sharpe` with the guess on, while the census
prints clean. None of them exists in the tree today, so this is gate soundness, not a live defect. But
the gate's contract (D-14: "fail if a new module reaches quantstats without being covered") and its
recorded limit are both overstated.

**Fix:** fail closed in uncovered modules on:
- any string constant equal to a `COVERED_DOTTED` name used as a call's first argument or as a subscript key;
- `__dict__` / `__globals__` reached from a covered-module alias or from a name imported from a covered module;
- `vars(<covered alias>)`;
- a plain `Name = <covered module alias>` assignment, which should propagate the alias.

Add one RED needle per shape. Alternatively, keep the code and list every one of these shapes under
"KNOWN LIMIT" so the claim matches what the gate can do.

## Info

### IN-01: B6 turns two ordinary, harmless production lines RED

**File:** `analytics-service/tests/qstats_gate.py`: `scan_source`, the B6 block (`first_str is not None and _is_quantstats(first_str)`).

**Issue:** Any call whose first argument is the string `"quantstats"` or `"quantstats.<x>"` is a violation. Both
`importlib.metadata.version("quantstats")` (a health or version report) and
`logging.getLogger("quantstats.stats").setLevel(...)` (quieting a noisy library) went RED
("string-named access"). The real tree has neither, so the corpus stays clean. The rule fails closed,
so this is not unsafe, but a developer adding one of these lines gets a red gate with no way to
comply short of removing legitimate code.
**Fix:** limit the string rule to `DYNAMIC_IMPORTERS`, subscripts and `find_spec`, or allowlist
`getLogger` and `metadata.version` by name, with a GREEN needle for each.

### IN-02: the headline `volatility` still persists the residue that the primitive and the backbone now report as 0.0

**File:** `analytics-service/services/metrics.py`: `compute_all_metrics` (`volatility = _safe_float(qs.stats.volatility(...))`).

**Issue:** For a constant 0.001 series, `sharpe_vol_status_from_backbone` returns `(0.0, None,
"zero_volatility")` and `_annualized_vol_sharpe` returns vol `0.0`. The persisted headline
`volatility` is still `3.449e-18`, and `6.9e-18` for a constant -0.002. It renders as 0.00%, so no
user can see it. It does make the docstring claim "its vol is reported as the true 0.0" true for the
backbone only, and it leaves the headline and the backbone on two different answers for one input.
**Fix:** snap the headline vol through the same helper
(`0.0 if _dispersion_is_residue(stat_returns.std(), stat_returns.mean()) else ...`), or narrow the
docstring.

### IN-03: normalising the benchmark first turns a loud TypeError into a silent one-day shift for a naive strategy paired with a benchmark whose time zone is east of UTC

**File:** `analytics-service/services/metrics.py`: `_align_benchmark_like_qs` (the new leading `_tz_naive_like_qs`).

**Issue:** Before the fix, a naive strategy with a tz-aware benchmark raised a TypeError that
`compute_qstats_scalars` logged. Now the benchmark is converted to UTC and made naive. Midnight in
a zone east of UTC (for example Asia/Tokyo) becomes 15:00 on the previous day. The reindex branch
then back-fills each strategy midnight from that 15:00 stamp, which pairs every strategy day with
the next local benchmark day, and `r_squared_status` reads `ok`. The case is not reachable today:
the production benchmark is naive or UTC, and `compute_all_metrics`' inner `align` raises on mixed
tz before `_greeks_no_guess`. `test_q166r_benchmark_mirrors_accept_a_tz_aware_pair` covers only a
same-tz UTC pair.
**Fix:** at entry, assert that both legs are naive or both are aware. Or record the mixed-tz shift
in the docstring beside the SFH LOW-1 note.

---

_Reviewed: 2026-09-25_
_Reviewer: Claude (gsd-code-reviewer), round 2_
_Depth: standard_
