---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
fixed_at: 2026-09-24T23:59:00Z
review_path: .planning/phases/166-qstats-truth-every-quantstats-derived-number-reflects-the-re/166-REVIEW.md + 166-REVIEW-SFH.md
iteration: 1
findings_in_scope: 17
fixed: 17
skipped: 0
status: all_fixed
---

# Phase 166: Code Review Fix Report

**Fixed at:** 2026-09-24
**Source reviews:** `166-REVIEW.md` (1 warning, 6 info) and `166-REVIEW-SFH.md` (2 high, 2 medium, 4 low, 2 info)
**Iteration:** 1 of at most 2

**Summary:**
- Findings in scope: 17 (every severity in both reports). Three pairs name the same defect, and each pair got one fix: WR-01 = HIGH-2, IN-02 = LOW-1, and LOW-4 is fixed together with INFO-2.
- Fixed: 17
- Skipped: 0
- Commits: 15 `fix(166)` commits, plus the CHANGELOG fold `f94fc4035`. VERSION stays `0.91.0.0`.

**Where verification ran.** Everything ran in the pinned project checkout (`quantalyze-166`, branch
`feat/166-qstatstruth`), not in a separate `.claude/worktrees/` worktree. The orchestrator pinned this
checkout as the root for every command, and it is already a checkout separate from the main one. Every
number below can be reproduced from this tree. The Python gates used the main checkout's
`analytics-service/.venv`. The TypeScript gates used `node_modules` symlinked from the main checkout
(D-19), and the link was removed before the commit. `node_modules` is absent now.

## Gates (run by the fixer, at `562a6d139` or later)

| gate | result |
|---|---|
| Full pytest, CI's exact command (`pytest --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`), run from `analytics-service/` in the background | **6234 passed, 90 skipped, exit 0**, coverage 91.54% (floor 80). I did not check the 90 skips one by one. They are the suite's own conditional skips, and this round added no skip. |
| mypy, CI's exact command (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`) | `Success: no issues found in 100 source files` |
| `tests/test_metrics_parity.py` + `tests/test_qstats_gate.py` at HEAD `f94fc4035` | 90 passed. Census: `13 quantstats node(s) in services/metrics.py, 11 mirror(s), 0 violation(s); arms kwarg-proven=12 exempt=1 inline=11` |
| TS (IN-05): vitest on `csv-finalize-cross-submission-merge.test.ts` + `queries.percentile-columns.test.ts` | 2 files, 62 tests passed |
| TS: `tsc --noEmit -p tsconfig.json` | exit 0 |
| TS: eslint on `src/app/api/strategies/csv-finalize/route.ts` | exit 0 |
| `check-planning-hygiene.ts`, after every `.planning` write | OK each time |
| Skip-token sweep on every commit message and on CHANGELOG.md | 0 each time |

Every new guard went through the same drill: a `cp` byte backup, neuter the guard, observe RED,
restore, then `cmp` against the backup. All drills went RED and every restore passed `cmp`.

## Fixed Issues

### SFH HIGH-1: `_annualized_vol_sharpe` guarded only an exact zero vol

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commits:** `7c75e5ea7`. The same class was closed in `979ae5bb4` (greeks) and `a6bd778d9` (serenity), and the values were disclosed under D-10 in `09cd04bd1`.
**Applied fix:** A new `_dispersion_is_residue(sd, mean)` treats `sd <= 1e-12 * |mean|` as no dispersion.
The residue measured on a constant series is about `1e-16 * |mean|`. In `_annualized_vol_sharpe` the
helper returns `(0.0, nan)`: vol is the true 0, and Sharpe is undefined and becomes None. The
backbone therefore reports `zero_volatility`, and `info_ratio`'s `te > 0` guard sees the zero. The
guard follows the "no invented data" rule, so the panel is hidden rather than showing a 0. I closed
the same class in two more places, both measured as fabricating values:
- `_greeks_no_guess`: beta over a constant benchmark was -1.92.
- `_serenity_index`: a constant losing series gave -2.2e-18.

**Tests:** `test_q166r_constant_series_sharpe_is_undefined_not_a_residue_quotient` and
`test_q166r_residue_guard_leaves_real_dispersion_bit_identical`. The first is RED with the old
exact-zero guard restored, and it also turns drill N15 RED. `test_q166r_constant_benchmark_beta_is_undefined_not_a_residue_slope`
is RED with `matrix[1, 1] == 0` restored.
**Status:** fixed: requires human verification. This is a logic change: the threshold choice
`1e-12` and the decision to report vol as 0.0.

### WR-01 / SFH HIGH-2: the AST gate was blind to every quantstats shape except `<alias>.stats`

**Files modified:** `analytics-service/tests/qstats_gate.py`, `analytics-service/tests/test_qstats_gate.py`
**Commit:** `dbefdca56`
**Applied fix:** Three new rules, all fail-closed:
- **B5:** any quantstats alias use other than `<qs>.stats` is RED. That covers `reports`, `plots`,
  `extend_pandas` (named as monkeypatching), `vars(qs)`, `qs.__dict__`, and passing `qs` as a
  value. Every import form other than the three green ones is also RED: a star import,
  `from quantstats import <non-stats>`, `from quantstats.<sub> import`, and
  `import quantstats.<sub> as X`.
- **B6:** string-named access is RED: `import_module("quantstats")`, `__import__`,
  `sys.modules[...]`, and `globals()/vars()/locals()["qs"]`. So is `import_module` / `__import__`
  with a computed name. No production module imports dynamically (measured).
- **A':** a module outside `COVERED_MODULES` that reaches a quantstats name bound in a covered
  module is RED. The bound names are read from the covered module by `quantstats_bindings`, not
  hard-coded. The rule covers `from services.metrics import qs`, `from services.metrics import *`,
  `metrics.qs`, `services.metrics.qs`, `m.qs`, `getattr(metrics, "qs")`, and the relative forms.

Import-only shapes join `IMPORT_SHAPES`, and every use shape is counted as a scanned node. The
census and the zero-node anti-vacuity checks therefore stay honest: the real corpus is still
13 nodes, and `census + node violations == nodes` still holds. One limit is recorded in both
docstrings: an attribute name computed at run time.

**Tests:** 14 new RED needles and 8 re-export RED needles, each its own case. There is also a
`scan_tree` re-export case, which proves the bound name is read from the covered module (an alias
`Q` is flagged and `qs` is not), and a GREEN re-export needle for legitimate `services.metrics` use.
All 22 new needles returned `violations=[]` and `nodes=0` against the pre-fix gate (measured). Eight
neuter drills (B5, B6, A', star, the from-import else branch, import-as, namespace dict, computed
dynamic import) each went RED on exactly their own needles.
**Status:** fixed

### SFH MEDIUM-1: the undefined-beta test passed on a crashed fan-out

**Files modified:** `analytics-service/tests/test_metrics.py`
**Commit:** `1c9fb0c04`
**Applied fix:** The test now requires `"alpha" in mj and mj["alpha"] is None`, and the same for
beta. On the flat-benchmark case, `info_ratio` must be present and non-None, because tracking error
is positive there. `correlation` must be present. caplog must show no
`benchmark_metrics fan-out failed` record.
**Tests:** drills N11 and N12 (`_greeks_no_guess` raising on each undefined path) are now RED. Both
survived before.
**Status:** fixed

### SFH MEDIUM-2: `_serenity_index` `sd == 0` and `den == 0` arms were untested

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `a6bd778d9`
**Applied fix:** `test_q166r_serenity_undefined_arms_are_none_not_zero` reaches the `sd` arm two
ways: with an all-zero series (exact 0) and with a constant losing series (residue, which now goes
through `_dispersion_is_residue`). No natural input reaches the `den == 0` arm. When ulcer is 0,
the drawdown VaR is NaN, so the denominator is NaN rather than 0. When a drawdown exists, CVaR is
strictly negative. The mirror's docstring now records that reasoning. The test reaches the arm by
forcing ulcer to 0 on a series that has losses, and asserts NaN, not 0.0 and not the bare-division
inf. The review's suggestion that a constant series reaches `den == 0` was measured as not true.
**Tests:** three drills went RED: the sd arm returning 0.0 (N8), the den arm returning 0.0 (N10),
and the exact `sd == 0` test restored.
**Status:** fixed

### SFH LOW-1 / IN-02: benchmark mirrors raised TypeError on a tz-aware pair

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `7c1e8863c`
**Applied fix:** `_align_benchmark_like_qs` now tz-normalises the benchmark before the set
comparison, the same way every caller already normalises the strategy leg. The later no-op tz step
was removed. A naive benchmark is untouched, so parity and golden are bit-identical. The
`_greeks_no_guess` docstring now describes both legs.
**Tests:** `test_q166r_benchmark_mirrors_accept_a_tz_aware_pair` checks that a UTC pair equals the
naive pair across `_greeks_no_guess`, `_r_squared` and `_rolling_greeks`. It is RED (the TypeError)
with the new line removed.
**Status:** fixed

### SFH LOW-2: rolling vs scalar gap-day convention not recorded

**Files modified:** `analytics-service/services/metrics.py`, `166-CONTEXT.md`
**Commit:** `5183ca295`
**Applied fix:** A dated note in the `_rolling_greeks` docstring and a dated section in
`166-CONTEXT.md`. The rolling `fillna(0)` is kept for D-08 parity, and its divergence from D-15 is
recorded. Behaviour is unchanged, and no founder decision was needed (per the brief).
**Status:** fixed

### SFH LOW-3: `_recovery_factor`'s `abs()` sign loss not recorded

**Files modified:** `analytics-service/services/metrics.py`, `166-CONTEXT.md`
**Commit:** `5183ca295`
**Applied fix:** The same dated note, in the `_recovery_factor` docstring and in `166-CONTEXT.md`.
It records that a -30% total over a -40% drawdown reads 0.75, the same as +30%. Behaviour is
unchanged.
**Status:** fixed

### SFH LOW-4 / INFO-2: a broken mirror looked like an undefined ratio

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `7bd93b80c`
**Applied fix:** `_every_mirror_ratio_is_defined` returns True when the series has a loss, a gain,
a negative 5% quantile, and at least 4 real observations. On such an input all eight mirrors are
defined. Measured: every mirror was finite on all 11,843 random series that satisfy it. At n < 4,
PSR can legitimately be NaN, which is why the threshold is 4.

`_safe_qstats_scalar` gains `must_be_defined`, and on such an input a non-finite result logs
`qstats scalar <name> returned non-finite ... the mirror is suspect`. That message is distinct from
the existing `... failed` message for an exception, and a D-09 None stays silent.

INFO-2 is handled the same way. `r_squared_status = "error"` now logs the named warning only when
both prepared legs vary (`_r_squared_pair_varies`). A constant leg (legitimately undefined) stays
status `error` with no log. The `error` status still covers both cases, because the status enum is
read downstream and was left alone.

**Tests:** `test_q166r_broken_mirror_logs_a_named_warning_an_undefined_ratio_does_not` and
`test_q166r_r_squared_error_is_logged_only_when_both_legs_vary`. Four drills went RED: either
warning removed, and either predicate forced True.
**Status:** fixed: requires human verification. This adds a new operator log signal, and its
predicate is a measured claim.

### SFH INFO-1: `_payoff_ratio_no_guess` unreachable arm

**Files modified:** `analytics-service/services/metrics.py`
**Commit:** `6ed841c11`
**Applied fix:** The arm is kept and documented. The docstring explains why it cannot be reached
(a mean of strictly negative values is never 0), why drill N14 survives, and why the arm stays: it
is part of the 0.0.81 body (D-08), and it gives the correct undefined answer.
**Status:** fixed

### IN-01: PSR raised ZeroDivisionError on a one-row series

**Files modified:** `analytics-service/services/metrics.py`, `analytics-service/tests/test_metrics.py`
**Commit:** `c1d343022`
**Applied fix:** `_probabilistic_sharpe_ratio` returns NaN for `n < 2` before the division.
**Tests:** `test_q166r_psr_one_observation_is_undefined_without_a_failure_warning` checks that PSR
is None and that no "failed" record is logged. It is RED with the guard disabled.
**Status:** fixed

### IN-03: stale docstring and type on `_safe_qstats_scalar`

**Files modified:** `analytics-service/services/metrics.py`
**Commit:** `41317e64f`
**Applied fix:** `fn` is now `Callable[[pd.Series], float]`. The docstring says the function runs
one single-arg scalar mirror, and the dedup rationale is reworded. mypy --strict passes.
**Status:** fixed

### IN-04: golden fixture key reorder with no D-10 row

**Files modified:** `166-09-SUMMARY.md`
**Commit:** `b6e914c05`
**Applied fix:** A dated D-10 row covers the `mean_*_usd` key order inside
`metrics_json.trade_metrics` and `metrics_json.volume_metrics`. The paths and orders were measured
from the fixture. The reorder is cosmetic, comes from the serialiser, and was kept rather than
reverted.
**Status:** fixed

### IN-05: csv-finalize projection and check used two names for one array

**Files modified:** `src/app/api/strategies/csv-finalize/route.ts`
**Commit:** `edaf8ad33`
**Applied fix:** The `.select()` now joins `CLOCK_SAFETY_KPI_COLUMNS`, the same name as the
presence check. The bytes are unchanged, and the hand-written BYTE PIN is green.
**Status:** fixed

### IN-06: census hook unguarded (INTERNALERROR on a parse failure)

**Files modified:** `analytics-service/tests/qstats_gate.py`, `analytics-service/tests/conftest.py`, `analytics-service/tests/test_qstats_gate.py`
**Commit:** `562a6d139`
**Applied fix:** `safe_census_lines` wraps `census_lines`. On failure it writes one named line,
`qstats-gate census: FAILED TO BUILD (<exc>); the gate tests ... fail on the same cause`, and
`pytest_terminal_summary` calls it. The gate tests still fail loudly on the same cause.
**Tests:** `test_qstats_gate_census_that_cannot_be_built_is_a_named_line` exercises the helper (a
SyntaxError in a tmp tree) and the real hook (a UnicodeDecodeError). Both drills went RED: the
helper unguarded, and the hook reverted to `census_lines`.
**Status:** fixed

## Additional commits

- `09cd04bd1`: D-10 rows for the round-1 value corrections on constant-series inputs, measured with
  the two-tree method (`2c5733bb7` against the fix tree):
  - Sharpe: 3.645e+16 -> None, and the backbone `ok` -> `zero_volatility`;
  - PSR: 1.29e-110 -> None;
  - serenity: -2.2e-18 -> None;
  - beta: -1.92 -> None, alpha: 0.339 -> None, and treynor -> absent.

  No golden, parity or trigger fixture moves.
- `f94fc4035`: the CHANGELOG fold into 0.91.0.0. Every one of the 15 hashes is cited in a bullet and
  in the commit list. There is no version bump.

## Notes for the orchestrator

- Two fixes change persisted values: HIGH-1 and its class (constant-series inputs only, disclosed
  under D-10). The rest are logging, tests, tz robustness and documentation.
- The review's claim that a constant series reaches serenity's `den == 0` arm is refuted by
  measurement. The arm has no natural input, and the test forces it.
- Not staged or touched: `.planning/milestone.lock` and `.planning/state.json`. No database command
  was run and no server was started. No `git checkout --`, `git restore` or `git stash` was used,
  and every rollback was a `cp` from a byte backup, then `cmp`.

---

_Fixed: 2026-09-24_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
