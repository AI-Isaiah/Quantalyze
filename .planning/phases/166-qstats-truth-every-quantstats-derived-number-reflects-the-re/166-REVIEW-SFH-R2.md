---
phase: 166
round: 2
reviewed_range: 2c5733bb7..c6f32f95f
date: 2026-09-24
reviewer: silent-failure-hunter
scope: round-1 fix commits (services/metrics.py, tests/qstats_gate.py, tests/conftest.py, tests/test_metrics.py, tests/test_qstats_gate.py), checked against 166-REVIEW-SFH.md and 166-REVIEW-FIX.md
counts:
  critical: 0
  high: 1
  medium: 2
  low: 4
  info: 3
---

# Phase 166 QSTATS-TRUTH: silent-failure review, round 2 (final)

## Method

I read `git diff 2c5733bb7..HEAD` in full. The drills ran in a throwaway copy of `analytics-service/`
outside the checkout. Each drill made one exact-string edit and ran `tests/test_metrics.py`,
`tests/test_qstats_gate.py` and `tests/test_metrics_parity.py`. The file was then restored from a
byte copy and checked with `cmp`. Before any drill the copy ran 331 passed. The branch checkout was
never edited: `git status --short` was empty before and after. I probed the mirrors and the gate
directly (`scan_source`, `compute_all_metrics`, `compute_qstats_scalars`,
`sharpe_vol_status_from_backbone`), and I ran no database command.

RED means at least one test failed, which is the result we want.

| drill | what it neuters | result |
|---|---|---|
| M1 | `_dispersion_is_residue` changed back to `sd == 0` | RED |
| M2 | `_annualized_vol_sharpe` residue branch returns the residue vol, not `0.0` | RED |
| M3 | `_greeks_no_guess` changed back to `matrix[1, 1] == 0` | RED |
| M4 | `_serenity_index` changed back to `sd == 0` | RED |
| N8 / N10 | `_serenity_index` sd arm / den arm return `0.0` | RED / RED |
| N11 / N12 | `_greeks_no_guess` raises on zero variance / on fewer than 2 rows | RED / RED |
| M5 | the `must_be_defined` WARNING in `_safe_qstats_scalar` removed | RED |
| M6 | `compute_qstats_scalars` passes `False` in place of the predicate | RED |
| M7 | predicate drops `p.quantile(0.05) < 0` | **GREEN (survives)** |
| M8 | predicate `returns.count() >= 4` changed to `>= 1` | **GREEN (survives)** |
| M9 | predicate drops `(p > 0).any()` | **GREEN (survives)** |
| M10 | predicate `except` sets `must_be_defined = True` | **GREEN (survives)** |
| M11 | `_r_squared_pair_varies` drops the benchmark-residue conjunct | RED |
| M12 | `_r_squared_pair_varies` drops `len(p) >= 3` | **GREEN (survives)** |
| M13 | the `r_squared` suspect WARNING removed | RED |
| M14 | `_probabilistic_sharpe_ratio` `n < 2` guard removed | RED |
| M15 | `_align_benchmark_like_qs` tz-first line removed | RED |
| M16a | `_DISPERSION_RESIDUE_REL` widened to `1e-3` | **GREEN (survives)** |
| M16b | `_DISPERSION_RESIDUE_REL` widened to `0.5` | RED, but only through an unrelated Fix-A conventions test |
| G1 | B6 `globals().get(...)` arm | **GREEN (survives)** |
| G2 | B6 `sys.modules[...]` subscript arm | RED |
| G3 | `_resolve_from` level > 1 handling | **GREEN (survives)** |
| G4 | Rule A' `getattr(module, "qs")` arm | RED |
| G5 | B6 computed `import_module` / `__import__` arm | RED |
| G6 | `safe_census_lines` returns `[]` on failure | RED |
| G7 | B5 "passed as a call argument" surface | RED |
| G8 | B5 skips `reports` / `plots` | RED |
| G9 | Rule A' relative-import resolution | RED |
| G10 | B6 namespace-dict key check | RED |

## Round-1 closure

| round-1 finding | verdict | evidence |
|---|---|---|
| HIGH-1 residue Sharpe | **PARTIALLY CLOSED.** Closed for bit-identical constants, open for a NAV-derived constant yield. See R2-HIGH-1. | M1, M2 RED |
| HIGH-2 gate blind to non-stats surfaces | CLOSED. Two reachable arms have no needle (R2-LOW-3), and some bypass shapes are not in the recorded limit (R2-LOW-4). | G2, G4, G5, G7 to G10 RED. An `extend_pandas` injected into the copy printed a VIOLATION, and `test_qstats_gate.py` went 2 failed. |
| MED-1 undefined-beta test passed on a crashed fan-out | CLOSED | N11, N12 RED |
| MED-2 serenity arms untested | CLOSED | N8, N10, M4 RED |
| LOW-1 tz-aware benchmark TypeError | CLOSED | M15 RED |
| LOW-2 rolling gap-day convention | CLOSED (recorded in the `_rolling_greeks` docstring) | read |
| LOW-3 recovery-factor sign loss | CLOSED (recorded in the `_recovery_factor` docstring) | read |
| LOW-4 broken mirror indistinguishable from undefined | **PARTIALLY CLOSED.** See R2-MED-1. | M5, M6 RED; M7, M8, M9, M10 survive |
| INFO-1 payoff unreachable arm | CLOSED (documented) | read |
| INFO-2 `r_squared_status = "error"` with no log | CLOSED. One conjunct is unpinned (R2-LOW-2). | M11, M13 RED; M12 survives |

---

## HIGH

### R2-HIGH-1: `_dispersion_is_residue` scales the residue by `|mean|`, so a constant yield derived from a compounding NAV still persists a Sharpe of about 1e11 to 1e13

**Location:** `services/metrics.py`, `_dispersion_is_residue` and `_DISPERSION_RESIDUE_REL`. Consumers:
`_annualized_vol_sharpe` (headline `sharpe`, `sharpe_vol_status_from_backbone`, `info_ratio`,
`_probabilistic_sharpe_ratio`), `_greeks_no_guess` and `_serenity_index`.

**Issue.** The guard is `sd <= 1e-12 * |mean|`. That bound is right for a series of bit-identical
constants, where the residue is about `1e-16 * |mean|`. I measured a worst ratio of 4.35e-16 over
n = 3 to 5000 and magnitudes 1e-8 to 0.7, and every one was caught. It is the wrong scale for the
way this codebase actually produces a constant yield: `pct_change` over an equity or NAV curve
(`services/equity_reconstruction.py`, `services/csv_validator.py`'s NAV path, `services/nav_twr.py`).
Each return there is `p[t] / p[t-1] - 1`. The rounding error is relative to `1 + r`, not to `r`, so
the residue is about 1e-16 in absolute terms whatever the yield. Measured on 366 days of a compounding
NAV starting at 1,000,000, with no rounding:

| APY | `sd / mean` | guard fires | persisted headline `sharpe` | backbone |
|---|---|---|---|---|
| 0.1% | 4.45e-11 | no | 4.29e+11 | not measured |
| 1% | 4.31e-12 | no | **4.43e+12** | `(2.2e-15, 4.43e+12, "ok")` |
| 3% | 1.43e-12 | no | **1.34e+13** | `ok` |
| 5% | 9.04e-13 | yes | None | not measured |

At 1% and 3%, `compute_qstats_scalars` also returns `probabilistic_sharpe_ratio = 1.0`, a certainty
computed over float noise. The guard switches between about 3% and 5% APY, so two stablecoin-lending
strategies that differ only in rate get opposite answers. This is the exact "constant-yield or
stablecoin-lending" input that round-1 HIGH-1 named. The fix's constant comment ("It only reclassifies
a series whose per-period mean/std exceeds 1e12, which no real return series reaches") describes the
over-reach direction. The leak is in the other direction: residue that the relative bound does not
recognise as residue. Sharpe is a ranked KPI, so this is the same data-integrity defect as round-1
HIGH-1, still reachable.

**Hidden errors:** any exact-compounding NAV or equity curve turned into returns by `pct_change` or
`(cur - prev) / prev`. That covers vault share prices, lending balances, and ledger reconstructions
with a constant rate.

**Recommendation:** use the scale of `1 + r`, not of `r`:

```python
return bool(sd <= _DISPERSION_RESIDUE_REL * (1.0 + abs(mean)))
```

Measured on the copy, not applied: across APY 0.01% to 100%, starting NAV 1 to 1e9 and 10 years of
days, the largest NAV-derived residue `sd` was 1.34e-16, and every case was caught with four orders of
margin. A cent-rounded compounding NAV (real rounding dispersion, `sd` 3.4e-9) was not flagged, and
the benign fixtures keep their values because their `sd` is many orders above 1e-12. Add a test that
builds the returns with `pct_change` over a compounding NAV at 1% APY and asserts headline
`sharpe is None`, backbone `zero_volatility` and PSR `None`. M1 goes RED on today's fixture, but that
fixture uses bit-identical constants and cannot see this producer. Fix the constant comment (`1e-16 *
|mean|`) to name both residue scales. The same bound also covers `_greeks_no_guess` for a benchmark
derived from a compounding index. I did not measure whether such a benchmark is offered today.

---

## MEDIUM

### R2-MED-1: the LOW-4 predicate is all-or-nothing and stricter than the mirrors need, so a high-win-rate strategy gets no broken-mirror signal at all

**Location:** `services/metrics.py`, `_every_mirror_ratio_is_defined` (its `p.quantile(0.05) < 0`
conjunct in particular) and its one call site in `compute_qstats_scalars`.

**Issue.** One boolean gates the WARNING for all eight mirrors, so failing any conjunct silences all
eight. The `p.quantile(0.05) < 0` conjunct is stricter than its own docstring's reason. `tail_ratio`
needs a NON-ZERO 5% quantile, not a negative one. Measured on 365 days with 2.2% losing days (a carry,
market-making or option-selling shape): the 5% quantile is positive, and all eight mirrors are finite
(recovery 17.3, upi 82.1, kelly 0.742, PSR 0.9994, common_sense 18.4, cpc 0.375, serenity 13.9). The
predicate still returns **False**. I replaced `kelly_criterion` with a mirror that returns NaN.
`kelly_criterion` persisted `None`, and **no** "mirror is suspect" line was logged. So the LOW-4 signal
is off for every strategy that loses on fewer than 5% of days, which is the population where an
undefined-looking ratio is most plausible and a broken one is hardest to spot. A second problem: M7,
M8 and M9 each survive. The one negative fixture (`_rank05_trigger_series`, all-winning) fails only
the loss conjunct, so the other three conjuncts are not pinned. Widening any of them would log false
"suspect" lines, and no test would notice.

**Hidden errors:** any bug in any of the eight mirrors on a high-win-rate series, persisted as a D-09
None.

**Recommendation:** define it per mirror. Make the predicate return the SET of mirror keys that the
input defines (for example: loss present gives the drawdown family, loss and gain give kelly and cpc,
a non-zero 5% quantile gives common_sense, n >= 4 gives PSR). Pass `key in defined` as
`must_be_defined`. At minimum, change `p.quantile(0.05) < 0` to `!= 0`, and correct the docstring. Add
one negative fixture per conjunct, so that M7, M8 and M9 go RED, and one high-win-rate positive
fixture.

### R2-MED-2: nothing pins the over-reach side of the residue threshold, so widening it would silently null real Sharpes

**Location:** `_DISPERSION_RESIDUE_REL`; the test
`test_q166r_residue_guard_leaves_real_dispersion_bit_identical`.

**Issue.** The review brief asks whether `_dispersion_is_residue` returns None where a real metric
exists. At today's 1e-12 it does not, as measured. A cent-rounded compounding NAV (`sd / mean` about
1.5e-4, a genuinely low-vol series) keeps a finite Sharpe (1.27e5 at 1% APY). A NaN `sd` returns False,
and each caller handles NaN before the guard. But drill M16a (threshold widened to `1e-3`) survives the
whole suite. Nothing fails between 1e-12 and 0.5, and 0.5 is caught only by an unrelated Fix-A
conventions test. The "bit-identical" test uses `_rank05_benign_mixed`, whose `sd / |mean|` is many
orders of magnitude from any plausible threshold, so it cannot fail when the threshold creeps. A
widened threshold would turn real Sharpe, beta and serenity values on low-vol, high-mean strategies
into None with no log. That is exactly the silent failure the guard was written to avoid, in the other
direction. If the R2-HIGH-1 fix lands, the boundary also moves to an absolute scale, which makes a pin
more necessary.

**Recommendation:** add a boundary test on a real low-vol series near the guard, for example the
cent-rounded compounding NAV (`sd` about 3.4e-9). Assert that `_annualized_vol_sharpe` equals the
unguarded arithmetic exactly and that headline `sharpe` is finite. M16a then goes RED.

---

## LOW

### R2-LOW-1: the predicate's `except Exception` disables the LOW-4 signal with no log line

**Location:** `compute_qstats_scalars`, the `try: must_be_defined = _every_mirror_ratio_is_defined(returns)
except Exception: must_be_defined = False` block.

**Issue.** The inline comment says "the mirrors below log their own failure". That holds only when
the mirrors fail on the same cause. Measured with an object-dtype `Decimal` series: the predicate
raised, 7 of 8 mirrors raised (logged), and `kelly_criterion` returned a value. Today the claim holds
by coincidence, and M10 survives. A predicate-only defect (a pandas `quantile` behaviour change, for
example) would switch off the broken-mirror WARNING for every strategy with no trace.

**Recommendation:** log the exception at WARNING, with `_should_emit_traceback("mirror_predicate", exc)`
dedup, before falling back to False.

### R2-LOW-2: `_r_squared_pair_varies` rests on an unpinned `len(p) >= 3`, because `_dispersion_is_residue(nan, ...)` is False

**Location:** `_r_squared_pair_varies`.

**Issue.** A 1-row pair gives `r_squared` NaN (status `error`). Its `std()` is NaN, and
`_dispersion_is_residue` returns False on NaN by design. So both `not _dispersion_is_residue(...)`
conjuncts read "varies", and only `len(p) >= 3` keeps a false "mirror is suspect" line out of the log.
M12 removes that conjunct and survives. The failure direction is a false alarm, not silence, but the
predicate's correctness hangs on an unpinned conjunct and on an implicit NaN convention.

**Recommendation:** add a 1-row benchmark case to
`test_q166r_r_squared_error_is_logged_only_when_both_legs_vary` (no suspect line), or state the NaN
exclusion explicitly (`not math.isnan(sd)`).

### R2-LOW-3: two reachable gate arms have no needle (B6 `globals().get`, Rule A' level > 1)

**Location:** `tests/qstats_gate.py`, `scan_source`: the B6 `NAMESPACE_DICTS` branch's
`par.attr == "get"` arm, and `_resolve_from`'s `node.level > 1` slice.

**Issue.** G1 and G3 survive. Both arms are reachable. `globals().get("qs").stats.sharpe(r)` in a
covered module is flagged today (1 violation, 1 node) and would be 0/0 with the arm gone.
`from ..metrics import qs` from a nested package (`services/ingestion/`, `services/equity/` exist) is
flagged today and would resolve to the wrong module with the slice gone. Neither arm is unreachable.
Both are untested.

**Recommendation:** add `needle_globals_get_of_the_alias` to the red-needle set, and add a
`reexport_relative_from_import_two_levels` needle scanned as a module under `services/ingestion/`.

### R2-LOW-4: bypass shapes that name the alias by a CONSTANT and are not in the recorded known limit

**Location:** `tests/qstats_gate.py` module docstring, "KNOWN LIMIT, RECORDED".

**Issue.** The recorded limit covers only `getattr(metrics, name)` with a computed name. Each of these
measured 0 violations and 0 nodes:

- `getattr(sys.modules[__name__], "qs").stats.sharpe(r)` inside `services/metrics.py`, which uses a
  constant name;
- `globals()["q" + "s"]` inside a covered module;
- `importlib.import_module("services.metrics").qs.stats.sharpe(...)` from an uncovered module.

All three are contrived, and no production module does any of them.

**Recommendation:** either widen the KNOWN LIMIT sentence to name these, or add two cheap arms:
flag `sys.modules[__name__]` in a covered module, and flag `import_module` of a covered dotted name
from an uncovered module.

---

## INFO

- **INFO-1: `safe_census_lines` does not swallow a real gate failure (verified).** `census_lines`
  never raises on a violation, it prints it. I injected `qs.extend_pandas()` into the copy's
  `services/metrics.py`. The census header read `1 violation(s)` with a named `VIOLATION ... non-stats
  namespace` line, and `tests/test_qstats_gate.py` went 2 failed. The `except` catches only a census
  that cannot be built, and that becomes a named `FAILED TO BUILD` line (G6 RED). The one residual:
  a session that deselects `test_qstats_gate.py` shows that line on a green run. That is visible, not
  silent.
- **INFO-2: the B5/B6 arms have no unreachable arm.** `assert isinstance(node, ast.Name)` in B5 is an
  invariant (`is_qs` requires a Name), not a branch. `fname or 'a call'` in B6 is reachable through
  `f()("quantstats")`. Every other arm is reachable, and all are RED under their drill except the two
  in R2-LOW-3. The first-string-argument arm also fires on non-loading calls such as
  `importlib.metadata.version("quantstats")`. That fails closed, and the census shows no such call
  today.
- **INFO-3: a raising `_r_squared_pair_varies` is logged as `qstats scalar r_squared failed`.** It is
  called inside the `r_squared` `try`, so its own exception is attributed to the mirror. The status is
  already `error` and the line is loud, so this is only misattribution.
