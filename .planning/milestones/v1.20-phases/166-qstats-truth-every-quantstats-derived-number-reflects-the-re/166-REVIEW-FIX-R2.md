---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
fixed_at: 2026-09-25T00:00:00Z
review_path: .planning/phases/166-qstats-truth-every-quantstats-derived-number-reflects-the-re/166-REVIEW-R2.md + 166-REVIEW-SFH-R2.md
iteration: 2
findings_in_scope: 17
fixed: 15
closed_without_code_change: 2
skipped: 0
status: all_fixed
---

# Phase 166: Code Review Fix Report, round 2 (final round)

**Fixed at:** 2026-09-25
**Source reviews:** `166-REVIEW-R2.md` (1 critical, 3 warning, 3 info) and `166-REVIEW-SFH-R2.md` (1 high, 2 medium, 4 low, 3 info)
**Iteration:** 2 of 2. Root fixes only, nothing deferred.

**Summary:**
- Findings in scope: 17, every severity in both reports. Three pairs name the same defect: CR-01 = SFH R2-HIGH-1, WR-03 = SFH R2-LOW-4, IN-01 = SFH INFO-2.
- Fixed: 15.
- Closed without a code change: 2. SFH INFO-1 is a verification note (nothing to fix). SFH INFO-3 is answered by design; see its section.
- Skipped: 0.
- Commits: 8 `fix(166)` commits, then the CHANGELOG fold `f99469ecb`. VERSION stays `0.91.0.0`.

**Where verification ran.** Everything ran in the pinned project checkout (`quantalyze-166`, branch
`feat/166-qstatstruth`), not in a separate `.claude/worktrees/` worktree. The orchestrator pinned
this checkout as the root for every command, and it is already a checkout separate from the main
one. No worktree was created, so there was no sentinel and no cleanup tail. Every number below can
be reproduced from this tree. The Python gates used the main checkout's `analytics-service/.venv`.
Each intermediate commit's tree was also assembled in a scratch directory from the round-1 head
plus that commit's hunks, and the metrics, gate and parity suites passed on each (346, 364, 365,
366, 384, 386 and 390 passed).

## Gates (run by the fixer)

| gate | result |
|---|---|
| Full pytest, CI's exact command (`pytest --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`), from `analytics-service/`, in the background under a 600 s `timeout` | **6293 passed, 90 skipped, exit 0**, 309.87 s, coverage 91.58% (floor 80). The 90 skips are the suite's own conditional skips; this round added none. Run on the final source, byte-equal to HEAD `f99469ecb`. |
| mypy, CI's exact command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`), at HEAD | `Success: no issues found in 100 source files` |
| `tests/test_metrics_parity.py` + `tests/test_qstats_gate.py` + `tests/test_metrics.py` at HEAD | 390 passed. Census: `13 quantstats node(s) in services/metrics.py, 11 mirror(s), 0 violation(s); arms kwarg-proven=12 exempt=1 inline=11` |
| `check-planning-hygiene.ts` after every `.planning` write | OK each time |
| Skip-token sweep on every commit message, on `git log --format=%B f94fc4035..HEAD`, and on CHANGELOG.md | 0 each time |

**Drills.** Every new guard went through the same drill: a `cp` byte backup, neuter the guard,
observe RED, restore, `cmp` against the backup. 30 drills on `services/metrics.py` and 19 on
`tests/qstats_gate.py`. All ended RED and every restore passed `cmp`. Three first came back GREEN
and were answered at the root, not waived:
- serenity's separate "a losing day" conjunct survived because it was redundant: a drawdown with
  real dispersion implies a loss. It was removed.
- the PSR "real dispersion of P(r)" conjunct survived on a repeated-float constant, whose garbage
  sample kurtosis already made the variance term negative. A NAV constant-yield case pins it now.
- the walrus-rebinding arm survived because `resolve` already follows `(m := metrics).qs` in
  place. The needle now uses `m` after the walrus, and the arm goes RED.

The review's surviving drills now go RED: M7 (`common_sense_q05_zero`), M8 (`psr_three_rows`,
carried by the PSR variance term), M9 (`kelly_no_win` / `cpc_no_win`), M10, M12, M16a, G1 and G3.

## Fixed Issues

### CR-01 / SFH R2-HIGH-1: the residue floor scaled by `|mean|` let a NAV-derived constant yield persist a Sharpe of about 1e13

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `bf47b6e4c`. Disclosed under D-10 in `3bdc59ff6`.
**Applied fix:** `_residue_floor(mean) = 1e-12 * max(1, |mean|)`. The docstring says why `max` was
chosen over the SFH's `1 + |mean|`: the two differ by at most a factor of 2 and agree on every
measured input, and `max` keeps the round-1 floor exactly wherever `|mean| >= 1`. So the only
inputs it reclassifies are the small-mean residues round 1 missed. `_dispersion_is_residue` uses the
floor. A new `_dispersion_is_real` is its NaN-safe complement: False on NaN.

The floor is applied at every site that divides by a standard deviation:
- `_annualized_vol_sharpe`, which covers the headline `sharpe`, the backbone, `info_ratio` and the PSR base;
- `_greeks_no_guess` on the benchmark leg. A strategy leg with no real dispersion now gets the TRUE
  beta `0.0`, because its covariance with anything is exactly 0. Before, a residue beta of about
  4e-16 passed treynor's `beta != 0` and persisted a treynor of about 1e15;
- `_serenity_index`;
- `_rolling_sharpe`, which was `> 0`;
- `_rolling_greeks`, which was `.replace(0, nan)`;
- `_rolling_correlation`, and the headline `correlation` over the pairwise-complete rows (not named
  in the review; same class, measured at 0.10 and 0.28 on noise);
- the outlier ratios, which were `> 0` (same class, measured at 0.0027);
- `smart_sharpe` (WR-01) and the headline `volatility` (IN-02).

**Tests:**
- `test_q166r2_compounding_constant_yield_defines_no_dispersion_ratio`, parametrized over daily
  1e-5, 1e-4 and 1e-3 and APY 0.01%, 0.1%, 1%, 3%, 5%, 10%, 50% and 100%. Every fixture is
  `pct_change` over a compounding NAV. It asserts every site above.
- `test_q166r2_compounding_constant_benchmark_defines_no_beta`, the benchmark leg.

**One instruction could not be met literally, and is recorded here.** The brief asked that each
fixture go RED under the old guard. Measured with round 1's floor restored, **7 of the 11 go RED**:
daily 1e-5 and 1e-4, and APY 0.01% through 5%. **Daily 1e-3 and APY 10%, 50% and 100% stay GREEN**,
because round 1's floor already caught them. A larger mean lifts `1e-12 * |mean|` above the
~1.2e-16 residue, and no float fixture of this shape can make the residue larger: it is bounded by
the rounding of `1 + r`. Those four stay in the suite as the pin that the new floor keeps covering
that end of the scale. Every other site guard, neutered one at a time, turns the daily-1e-5 case RED
(drills D3 to D10, D18).

**Status:** fixed: requires human verification. This is a logic change: the floor's scale, and
reporting a constant strategy's beta as exactly 0.0.

### SFH R2-MED-2: nothing pinned the over-reach side of the floor

**Files modified:** `analytics-service/tests/test_metrics.py`
**Commit:** `bf47b6e4c`, the same root fix as CR-01.
**Applied fix:** `test_q166r2_residue_floor_keeps_real_quantisation_dispersion` builds a
cent-rounded compounding NAV at 1% APY. On a 1e6 start its sd is 4.1e-9; on a 1e8 start it is
4.0e-11, which is 40 times the floor. The test asserts that `_annualized_vol_sharpe` equals the
unguarded arithmetic exactly, and that the headline `sharpe` and `smart_sharpe` are finite. Widening
the floor to 1e-3 (the review's drill M16a) or to 1e-10 goes RED. The largest residue measured on
NAV-derived returns is 1.33e-16, so the floor sits orders of magnitude from each side.
**Status:** fixed

### WR-01: `smart_sharpe` persisted 4.6e15 on the round-1 constant fixture

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `bf47b6e4c`
**Applied fix:** The divisor must pass both `> 0.0` and `_dispersion_is_real(sd, mean)`.
`test_q166r2_constant_series_smart_sharpe_and_vol_are_not_residue` covers constants 0.001 and
-0.002, and the constant-yield test covers the NAV shape.
**Status:** fixed

### WR-02: `r_squared` over a constant non-zero benchmark persisted about 1e-34 with status `ok`

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `bf47b6e4c`
**Applied fix:** `compute_qstats_scalars` asks `_r_squared_pair_varies` FIRST. A pair that does not
define an R^2 persists `None` with status `error` and no log. Only a pair that defines one is
regressed, and a non-finite result on such a pair still logs the named "mirror is suspect" line.
`test_q166r2_r_squared_over_a_pair_that_defines_none_is_none_not_residue` covers constant
benchmarks 0.001, 0.0005 and -0.002 at n = 120, 250 and 1000.

A consequence is disclosed under D-10. A two-row pair used to persist `r_squared = 0.9999999999999996`
with status `ok`. With two rows the line passes through both points, so R^2 is 1 whatever the data.
It now persists `None` with status `error`.
**Status:** fixed: requires human verification. The two-row case is a value change by definition.

### SFH R2-LOW-2: `_r_squared_pair_varies` rested on an unpinned `len(p) >= 3` and an implicit NaN convention

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `bf47b6e4c`. It is the same predicate WR-02 re-roles.
**Applied fix:** Each leg's test is now `_dispersion_is_real`, which is False on a NaN `sd`. So a
one-row pair reads "does not vary" and can never log a false warning. The docstring states why each
conjunct is necessary. The same test pins `len(p) >= 3` through the two-row pair: drill D13 goes RED
with 0.9999999999999996. It also asserts `_dispersion_is_real(nan, 0.0) is False` directly (drill
D14 RED), and that no suspect line comes from a one-row pair.
**Status:** fixed

### IN-02: the headline `volatility` persisted the residue while the backbone said 0.0

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `bf47b6e4c`
**Applied fix:** `volatility` is `0.0` when `_dispersion_is_residue(stat_returns.std(),
stat_returns.mean())`. Otherwise it is the unchanged kwarg-proven `qs.stats.volatility` call, and the
census still counts 13 nodes. The fix is asserted in the smart_sharpe/vol test and in the
constant-yield test.
**Status:** fixed

### SFH R2-MED-1: the LOW-4 predicate was all-or-nothing and stricter than the mirrors need

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `3c2562c5e`
**Applied fix:** `_every_mirror_ratio_is_defined` is replaced by `_mirror_keys_defined_by`. It
returns the set of keys the input defines, each on its own mirror's precondition, and the call site
passes `result_key in defined_keys`. The strict all-or-nothing `quantile(0.05) < 0` is gone:
`common_sense_ratio` needs only a NON-ZERO 5% quantile. PSR needs a positive estimated variance of
the Sharpe estimator, computed in the published form. That term is NaN below four real observations,
so it carries the old count rule, and it also covers short steady series like
`[0.01, 0.01, 0.02, 0.02]`, where the variance comes out negative. Each conjunct is written only
where it is necessary.

Sufficiency was measured by fuzzing: **164,357 key-and-series checks, 0 non-finite**. The fuzz used
eleven random shapes (NaN gaps, an inf day, a +150% day, cent-rounded values, compounding constant
yields) plus every series of length 1 to 5 over a 7-value grid.

**Tests:**
- `test_q166r2_each_mirror_precondition_is_necessary`: 16 cases, one per conjunct. On each the
  mirror really is non-finite, the key is absent, and no suspect line is logged. Every conjunct,
  neutered, goes RED (drills D15a to D15m).
- `test_q166r2_high_win_rate_strategy_keeps_the_broken_mirror_signal`: 2.2% losing days and a
  positive 5% quantile. All eight keys are defined, and a broken kelly is named.
- `test_q166r2_every_mirror_is_finite_wherever_its_precondition_holds`: a deterministic sample of
  the fuzz.

The round-1 test was re-pointed at the new function.
**Status:** fixed: requires human verification. The predicate is a measured claim.

### SFH R2-LOW-1: the predicate's `except` disabled the signal with no log

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `9366a512f`
**Applied fix:** The `except` now logs `qstats mirror predicate failed ...` at WARNING, deduped with
`_should_emit_traceback("mirror_predicate", exc)`, and then falls back to an empty set.
`test_q166r2_a_failing_mirror_predicate_is_logged` covers it, and drill D16 goes RED.
**Status:** fixed

### IN-03: a naive strategy with a tz-aware benchmark east of UTC was silently paired one day apart

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `5f75633a4`
**Applied fix:** This takes the "refuse the pair loudly" option. Converting to UTC first is what
already caused the shift. `_refuse_mismatched_day_labels` raises a named `ValueError` in
`_r_squared`, `_r_squared_pair_varies`, `_greeks_no_guess` and `_rolling_greeks`, unless one of these
holds:
- both legs are naive;
- both legs carry the same zone;
- every tz-aware leg's wall clock equals UTC at every stamp.

The last condition reads a naive leg as UTC, the convention `_tz_naive_like_qs` already applies. In
`compute_qstats_scalars` the refusal is logged as `r_squared failed ... different time zones`, with
status `error`. `test_q166r2_a_pair_labelled_in_different_zones_is_refused_not_shifted` covers
Tokyo against naive (refused everywhere). It also checks that UTC against naive and Tokyo against
Tokyo give exactly the naive pair's values. Drill D17 goes RED.
**Status:** fixed: requires human verification. This is a refusal policy.

### WR-03 / SFH R2-LOW-4: Rule A' had constant-keyed bypasses and an overstated known limit

**Files modified:** `analytics-service/tests/qstats_gate.py`, `analytics-service/tests/test_qstats_gate.py`
**Commit:** `577bd8582`
**Applied fix:** `scan_source` now has a module-object resolver. `resolve` follows:
- imports;
- module-level defs;
- `import_module` / `__import__` with a constant or `__name__`;
- `sys.modules[<constant or __name__>]`;
- `vars()`, `__dict__`, `.get` and `f.__globals__`;
- a constant `getattr`;
- plain `name = <expr>` / tuple / walrus rebinding, followed to a fixpoint.

Rule A' now runs in covered modules too, which catches a self-reference such as
`getattr(sys.modules[__name__], "qs")`. A covered module's namespace read with a computed name, or
handed on as a value, is RED. That closes round 1's one recorded limit (`getattr(metrics, name)`). In
a module that binds quantstats, `globals()` / `vars()` / `locals()` read with a computed key or
passed on is RED.

Every shape the review listed is closed, each with a RED needle:
- `import_module("services.metrics").qs`
- `__import__`
- `sys.modules[...]`
- `vars(metrics)["qs"]`
- `metrics.__dict__["qs"]` and `.get`
- `getattr(metrics, "__dict__")`
- `f.__globals__["qs"]` from an importer and inside the covered module
- `getattr(sys.modules[__name__], "qs")`
- `globals()["q"+"s"]`
- `ns = globals()`
- rebinding at function level, module level and by walrus
- computed `getattr` / `vars()[name]`
- namespace escape

The shapes a static walk still cannot follow are listed EXACTLY under the docstring's
"KNOWN LIMITS, RECORDED":
1. a module object passed through a parameter, return value, container, attribute, loop or `with`
   target, starred or augmented assignment, or default argument;
2. `operator.attrgetter`, `__getattribute__`, `inspect.getmembers` / `getattr_static`;
3. relative `import_module`, `pkgutil.resolve_name`, `runpy`, or an `importlib.util` spec;
4. `eval` / `exec` / `compile`, in any module.

None exists in the tree (measured). The green legitimate-use needle gained the long-way forms. All 14
resolution-arm drills went RED, the walrus arm after its needle was sharpened. The real corpus still
reads 13 nodes and 0 violations.
**Status:** fixed

### SFH R2-LOW-3: two reachable gate arms had no needle

**Files modified:** `analytics-service/tests/test_qstats_gate.py`
**Commit:** `863c8d04e`
**Applied fix:** `needle_globals_get_of_the_alias` goes RED under G1.
`test_qstats_gate_reexport_two_level_relative_import_is_named` scans `from ..metrics import qs` as
`services/ingestion/feeder.py` and goes RED under G3.
**Status:** fixed

### IN-01 / SFH INFO-2: B6 turned `importlib.metadata.version("quantstats")` and `logging.getLogger("quantstats.stats")` RED

**Files modified:** `analytics-service/tests/qstats_gate.py`, `analytics-service/tests/test_qstats_gate.py`
**Commit:** `6300e2646`
**Applied fix:** `NON_LOADING_CALLEES` holds `logging.getLogger` and the `importlib.metadata`
readers. It is matched on the callee's RESOLVED dotted path, so it fails closed on anything it cannot
resolve. There are three GREEN needles: the metadata call, its from-import form, and the logger
level. `needle_lookalike_of_a_non_loading_callee` is RED: a local `version` imported from elsewhere
stays RED. Drills G-a (the allowlist removed) and G-b (the allowlist widened to any resolved callee)
both go RED.
**Status:** fixed

## Closed without a code change

### SFH INFO-1: `safe_census_lines` does not swallow a real gate failure

This is a verification note that confirms the round-1 behaviour, and there is nothing to fix. The
census still reports clean at HEAD.

### SFH INFO-3: a raising `_r_squared_pair_varies` is logged as `qstats scalar r_squared failed`

This is answered by design. Since WR-02 the predicate is step one of computing `r_squared`: it
decides whether an R^2 exists. A raise there IS an r_squared failure, with status `error`, and the
exception text names the cause. The IN-03 test asserts that the `r_squared failed` line carries
"different time zones".

## Additional commits

- `3bdc59ff6`: D-10 rows in `166-09-SUMMARY.md` for every persisted value round 2 moves. They were
  measured with the two-tree method, `dcbd1749f` against the fix tree:
  - five NAV constant-yield fixtures;
  - the constant 0.001 and -0.002 series;
  - a constant-yield benchmark;
  - three constant non-zero benchmarks;
  - a two-row pair;
  - a naive-vs-Tokyo pair.

  No golden, parity or trigger fixture moves, and the cent-rounded NAV moved on no key.
- `f99469ecb`: the CHANGELOG fold into 0.91.0.0 (Fixed, Changed, Added, Tests, Notes). Each commit
  since the round-1 fold is cited in a bullet: the 8 fixes and the 2 planning commits `c6f32f95f`
  and `dcbd1749f`. There is no version bump.

## Notes for the orchestrator

- **Value changes, all disclosed under D-10.** Only constant-yield, constant-series and
  constant-benchmark inputs move, plus two-row R^2 pairs and mixed-zone pairs. The CR-01 class
  touches `sharpe`, backbone status, PSR, `smart_sharpe`, `volatility`, the rolling Sharpe series,
  `correlation`, `btc_rolling_correlation_90d`, `beta` (and 16th-digit `alpha`), `treynor`, the
  outlier ratios, `r_squared` / `r_squared_status`, and rolling alpha/beta over a constant
  benchmark. Rolling Sharpe, rolling correlation and rolling beta are RENDERED.
- **Observed outside this phase's files, and not changed.** Five other modules guard a std with an
  exact `== 0` or `> 0`: `services/portfolio_optimizer.py`, `services/csv_validator.py`,
  `services/allocated_capital.py`, `services/equity_reconstruction.py` and `services/optimizer.py`.
  They are not quantstats-derived, and no review finding names them. This is recorded in the
  CHANGELOG notes so it is not lost. Whether they deserve the same floor is a routing decision for
  the orchestrator.
- **How the commits were made.** Commits were made with plain `git commit`, not `gsd_run query
  commit`. Each commit stages only its own hunks, which were assembled from the round-1 head, and
  `gsd_run query commit` stages whole files. Each commit's tree passed the metrics, gate and parity
  suites.
- **What was not touched.** `.planning/milestone.lock` and `.planning/state.json` were neither
  touched nor staged. No database command was run and no server was started. No `git checkout --`,
  `git restore` or `git stash` was used. Every drill restore was a `cp` from a byte backup, then
  `cmp`.
- `166-REVIEW-FIX-R2.md` (this file) is NOT committed.

---

_Fixed: 2026-09-25_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
