---
phase: 166-qstats-truth-every-quantstats-derived-number-reflects-the-re
verified: 2026-09-25T01:25:00Z
status: human_needed
score: 5/5 roadmap success criteria verified (plus D-15, D-16, D-17, D-11, D-12, D-13 and TODOS 0f verified)
verified_at_sha: 36c528b9788d512092247b1f7ab1ee27fe87fc0e
drift_subjects:
  - analytics-service/services/metrics.py
  - analytics-service/tests/qstats_gate.py
  - analytics-service/tests/test_qstats_gate.py
  - analytics-service/tests/test_metrics.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/fixtures/golden_252d_expected.json
  - src/lib/percentile-core.ts
  - src/lib/queries.ts
  - src/lib/closed-sets.ts
  - src/app/api/strategies/csv-finalize/route.ts
  - src/lib/queries.percentile-columns.test.ts
  - src/__tests__/csv-finalize-cross-submission-merge.test.ts
behavior_unverified: 0
overrides_applied: 0
human_verification:
  - test: "After the merge, run the five read-only census SELECTs in 166-09-SUMMARY.md, section 'Census SQL for the founder (D-11, read-only)', and then queue a recompute of the affected PRODUCTION rows through the normal job path (OPEN-2, founder answer 2026-09-24)."
    expected: "The census names the affected population: guess-trigger strategies, the BTC benchmark-leg check, alpha and beta both exactly 0, strategies with rolling_alpha, and rows carrying PSR. After the recompute, the persisted metrics_json and rolling_alpha / rolling_beta for those strategies carry the post-fix values. Ledger venues need an explicit enqueue because they never re-compute on their own."
    why_human: "It is a production read and then a production write. This phase is code-only by decision D-11. The recompute belongs to its own phase, which is not in scope here. Measured at this SHA, ROADMAP.md has no phase entry for it yet."
  - test: "After a benchmarked strategy is recomputed on the merged code, open its factsheet and look at the rolling alpha / beta chart (RollingAlphaBetaChart) and the Benchmark greeks table."
    expected: "Rolling alpha is the windowed intercept (D-17). It is no longer a linear transform of rolling beta, and it stays unannualized. Rolling beta is unchanged for a strategy whose benchmark never tripped the guess. A strategy whose persisted alpha and beta were a fabricated 0.000 / 0.000 now shows the pairwise-complete values, or an em-dash where beta is undefined (D-15)."
    why_human: "Rendered chart and table values on real PRODUCTION rows exist only after the recompute. The tests pin the series the code writes, but not the pixels the chart draws from those rows."
---

# Phase 166: QSTATS-TRUTH Verification Report

**Phase Goal:** No metric persisted to `metrics_json` or rendered in a chart is the output of
quantstats' price-detection heuristic misreading a return series as prices. The phase closes the
surface that RANK-05 left open, and it settles whether the library stays.
**Verified:** 2026-09-25, at `36c528b9788d512092247b1f7ab1ee27fe87fc0e` (branch head, the round-2 fix report commit)
**Status:** human_needed. Every code-side truth is VERIFIED. The two remaining items are post-merge and need a human: the PROD census plus recompute, and the rendered chart values.
**Re-verification:** No. This is the initial verification.

Method: goal-backward. Every gate below was run by this verifier in its own process at the SHA
above. No SUMMARY number was taken on trust. Where a SUMMARY claim could be re-measured
independently, it was, and the rows say so.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | The upgrade-vs-mirror decision is made on evidence, not assumption | VERIFIED | `166-RESEARCH.md` §Q1 found PyPI's latest release is 0.0.81, upstream `main` identical to tag `v0.0.81`, and the only maintained fork carrying both heuristics. D-01 therefore routes nothing to Phase 165, and OPEN-1 is moot. `166-09-SUMMARY.md` "Library decision" re-read PyPI at execution. At HEAD, `test_rank05_quantstats_pin_is_still_0_0_81` holds the pin, and no dependency file changed (the changed-file list below has no `requirements*`). Answer to "does it stay": yes, as 12 kwarg-proven leaf calls plus 1 exemption. |
| 2 | Every one of the "30" `qs.stats.*` call sites is closed or recorded out of scope with a reason | VERIFIED | The census is printed by `pytest_terminal_summary` on this verifier's own full run: `qstats-gate census: 13 quantstats node(s) in services/metrics.py, 11 mirror(s), 0 violation(s); arms kwarg-proven=12 exempt=1 inline=11`. There is one row per node, and each carries an arm and a reason. `drawdown_details` is the one `exempt` row, with its reason. The reconciliation line answers the "30": `33 text occurrence(s) of 'qs.stats.' vs 13 AST quantstats node(s) ... (phase start: 30 vs 9)`. |
| 3 | The region gate AST-walks `qs.stats.*`, sees the `getattr` dispatch and `_rolling_alpha_beta`, and is proven able to fail | VERIFIED | `tests/qstats_gate.py` (`scan_source` / `scan_tree`, Rules A, A', B1 to B6) replaces the line gate. `test_rank05_no_unclosed_quantstats_call_survives_in_compute_all_metrics` is gone and survives only as lineage prose. **An independent neuter drill by this verifier** fed mutated in-memory copies of `services/metrics.py` to the production `scan_source`, with no file written. Each copy went RED and named its site: a direct `qs.stats.ulcer_index(returns)` in `compute_qstats_scalars` (shape `call`), `getattr(qs.stats, k)` over a tuple (shape `attribute dispatch`), `qs.stats.rolling_greeks(..., prepare_returns=False)` in `_rolling_alpha_beta` (shape `call`, rejected because it is not a kwarg-proven leaf), an alias `f = qs.stats.greeks` (shape `aliased reference`), and `qs.stats.recovery_factor(returns, prepare_returns=False)` (a keyword on a non-honouring function). The unmutated source gave 0 violations over 13 nodes. `tests/test_qstats_gate.py` gave `79 passed`. |
| 4 | The measured wrong values are gone on the same fixture that produced them, asserted against economic invariants | VERIFIED | **Re-measured independently** in two separate processes over `git archive` trees of the phase base `73cbf2995` and of HEAD, on the `_rank05_trigger_series` recipe. BEFORE: `recovery_factor 2.0737188382869305, ulcer_index 0.9947130555497081, upi 2.9998728744771372, common_sense_ratio 0.0, serenity_index 0.3204442673452879, PSR 0.1531252134903383`, while `max_drawdown` read 0.0. AFTER, from `compute_qstats_scalars` and from the persisted `compute_all_metrics(...)["metrics_json"]`: `ulcer_index 0.0`, `recovery_factor / upi / serenity_index / common_sense_ratio None`, `PSR 0.9998517975825096 (> 0.5)`. The tests assert economics, never implementation output: `test_q166_all_winning_series_has_no_drawdown_derived_ratios`, `test_q166_all_winning_drawdown_values_reach_metrics_json`, `test_q166_all_winning_series_has_no_loss_derived_ratios`, `test_q166_all_winning_loss_values_reach_metrics_json` and their non-monotone siblings. All of them passed in the full run. |
| 5 | No metric silently changes without being recorded | VERIFIED | The `166-09-SUMMARY.md` D-10 tables carry the trigger fixtures, the golden, the parity fixtures, the round-1 constant-series rows and the round-2 constant-yield rows. **Golden diff re-measured independently**: a flattened compare of `golden_252d_expected.json` at `73cbf2995` against HEAD moved exactly `['metrics_json.metrics_json.probabilistic_sharpe_ratio', 'sibling.rolling_alpha']`, and both are disclosed rows (D-16, D-17). The key-order-only regeneration also has its own row (IN-04). **Round-2 disclosure spot-checked**: on the NAV constant-yield fixture (daily 1e-4, 366 returns, seeded benchmark), HEAD gives backbone `(0.0, None, 'zero_volatility')`, sharpe `None`, beta `0.0` and r_squared `None`. That matches the disclosed "after" column. |

**Score:** 5/5 roadmap truths verified (0 present-but-behavior-unverified).

### Decision-level truths (166-CONTEXT.md, founder-approved)

| Decision | Status | Evidence |
|---|---|---|
| D-15: alpha and beta are computed pairwise-complete, and `None` is returned, never a fabricated `0.0`, when beta is undefined | VERIFIED | `_greeks_no_guess` inner-joins, runs `dropna()`, returns `(None, None)` when there are fewer than 2 pairs or the benchmark dispersion is only residue, and has no `fillna(0)`. It is wired at the `compute_all_metrics` greeks site. The golden 3-NaN-day row moved from 0.0/0.0 to -0.0594/-0.0204. The D-13 reader chain (`getStrategyDetailV2` → `BenchmarkGreeksTable` `fmt()` → `MetricCell` `value ?? "—"`) renders null as an em-dash. |
| D-16: PSR uses the non-excess fourth moment | VERIFIED | `_probabilistic_sharpe_ratio` sets `gamma4 = r.kurtosis() + 3` inside 0.0.81's `1 + 0.5·SR² − γ3·SR + ((γ4−3)/4)·SR²`, which is algebraically `1 − γ3·SR + ((γ4−1)/4)·SR²`, the published Bailey and López de Prado form. The golden PSR row is disclosed. |
| D-17: rolling alpha is the windowed intercept, unannualized | VERIFIED | `_rolling_greeks` computes `alpha = means["returns"] - beta * means["benchmark"]` over `df.rolling(window)`, with no `periods` factor. `_rolling_alpha_beta` calls it, and it feeds `sibling_kinds["rolling_alpha"/"rolling_beta"]`. In the golden, `sibling.rolling_alpha` moved and `rolling_beta` did not. |
| D-04 / TODOS 0f: primitives are extracted before any third hand-copy | VERIFIED | `_annualized_vol_sharpe` (4 call sites), `_downside_rms` (2), `_max_drawdown_from_wealth`, `_drawdown_series_from_wealth` and `_cvar_of_tail` are module-level, and the mirrors are built on them. TODOS 0f carries a dated CLOSED note. |
| D-12 / D-18: one KPI array | VERIFIED | `PERCENTILE_ANALYTICS_COLUMNS = PERCENTILE_METRICS.join(", ")` and `CLOCK_SAFETY_KPI_COLUMNS = PERCENTILE_METRICS`. The byte pin in `queries.percentile-columns.test.ts` passed. |
| D-11: no production write | VERIFIED | No remote command appears in any plan, and none was run by this verifier. The census SQL is `SELECT`-only. |
| WINDOWS.md entries 5 and 9 | VERIFIED | Both rows read `fixed` at HEAD. |

### Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `analytics-service/services/metrics.py` mirrors (`_recovery_factor`, `_ulcer_index`, `_ulcer_performance_index`, `_serenity_index`, `_kelly_criterion`, `_probabilistic_sharpe_ratio`, `_common_sense_ratio`, `_cpc_index`, `_r_squared`, `_greeks_no_guess`, `_rolling_greeks`) | VERIFIED | These are substantive, not stubs, and every one is wired. The eight scalars go through `_QSTATS_SINGLE_ARG_SCALARS` → `compute_qstats_scalars` → `metrics_json.update`. `_greeks_no_guess` and `_rolling_alpha_beta` are called from `compute_all_metrics`. |
| `analytics-service/tests/qstats_gate.py` plus `tests/test_qstats_gate.py` | VERIFIED | The gate plus RED/GREEN needles, importer and re-export needles, preparer-spy pins over `sorted(KWARG_PROVEN)`, and calibration rows. |
| `analytics-service/tests/conftest.py` `pytest_terminal_summary` | VERIFIED | The census was printed on this verifier's full run. |
| `src/lib/percentile-core.ts` / `queries.ts` / `csv-finalize/route.ts` | VERIFIED | Derived, with the byte pin green. |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `compute_qstats_scalars` | 8 inline mirrors | `_QSTATS_SINGLE_ARG_SCALARS` tuple of callables, no `getattr(qs.stats, …)` | WIRED |
| `compute_all_metrics` | `strategy_analytics.metrics_json` | `metrics_json.update(compute_qstats_scalars(...))`. The persisted dict was re-measured above | WIRED |
| `compute_all_metrics` | `RollingAlphaBetaChart` | `_rolling_alpha_beta` → `_rolling_greeks` → `sibling_kinds` → `strategy_analytics_series` | WIRED in code. Rendered values are a human item |
| `compute_all_metrics` greeks site | `_greeks_no_guess` | direct call with `periods_per_year` | WIRED |
| CI python job | AST gate | `tests/test_qstats_gate.py` under `analytics-service/tests/`, collected by the plain `pytest` job | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full Python suite | `<venv>/bin/python -m pytest -q -n auto` from `analytics-service/`, backgrounded under `timeout` | `6293 passed, 90 skipped, 479 warnings in 47.27s`, `EXIT 0` | PASS |
| mypy, CI's exact command | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` | `Success: no issues found in 100 source files` | PASS |
| AST gate and census | `pytest tests/test_qstats_gate.py -q` | `79 passed`, census `13 quantstats node(s) ... 0 violation(s)` | PASS |
| Gate can fail (5 shapes) | in-memory mutations → `scan_source` | 1 named violation each; 0 on the real source | PASS |
| Trigger fixture before/after | two `git archive` trees, separate processes | values quoted in truths 4 and 5 | PASS |
| TS touched tests | vitest over `queries.percentile-columns`, `csv-finalize-cross-submission-merge`, `critical-regressions`, `metrics-parity`, `metrics-parity-helper`, run through a symlinked `node_modules` that was removed afterwards | `Test Files 5 passed (5)` / `Tests 261 passed (261)` | PASS |
| TS types | `tsc --noEmit -p .` | exit 0, 0 `error TS` lines | PASS |

### Probe Execution

Step 7c: no probe is declared by any 166 PLAN or SUMMARY, and the phase is not a migration or
tooling phase. SKIPPED.

### Requirements Coverage

| Requirement | Source | Status | Evidence |
|---|---|---|---|
| SC-1 to SC-5 | ROADMAP | SATISFIED | truths 1 to 5 |
| TODOS-0f `[159-SIMPLIFY-DEFER]` | plans 01, 02, 07 and 09 | SATISFIED | the D-04 and D-12 rows |
| WINDOWS-5, WINDOWS-9 | plan 09 | SATISFIED | both `fixed` |

### Anti-Patterns Found

No `TBD`, `FIXME` or `XXX` appears in any line this phase added to a non-planning file. Scanned
files: `metrics.py`, `qstats_gate.py`, `test_qstats_gate.py`, `test_metrics.py`, `conftest.py`,
the golden, and the six TS files.

| File | Pattern | Severity | Impact |
|---|---|---|---|
| `tests/qstats_gate.py` docstring "KNOWN LIMITS" | the gate cannot see `eval`/`exec`, a module object passed through function parameters, `operator.attrgetter`, and similar shapes | Info | Recorded honestly. None of these shapes exists in the tree today (measured by the fixer). A static walk cannot follow them. |
| `_rolling_greeks` `fillna(0)` vs the pairwise-complete `_greeks_no_guess` | two NaN conventions on one page | Info | Recorded under D-08 in `166-CONTEXT.md` (SFH LOW-2). It is kept for parity and not changed. |
| `_recovery_factor` `abs(total)` | a net-losing strategy reads positive | Info | Recorded under D-08 (SFH LOW-3). It reproduces 0.0.81 and reaches the UI. It was NOT changed by founder-approved scope. |

### Human Verification Required

#### 1. PROD census and recompute (OPEN-2, post-merge)

**Test:** After the merge, run the five `SELECT`s in `166-09-SUMMARY.md` "Census SQL for the
founder". Then enqueue recomputes of the affected rows through the normal job path.
**Expected:** The census names the affected population. After the recompute, the persisted values
match the post-fix code. Ledger venues need an explicit enqueue.
**Why human:** It is a production read and then a production write. D-11 keeps this phase
code-only. The owning phase does NOT exist in `ROADMAP.md` at this SHA. Add it with `/gsd-phase`
so the deferral has a queue position.

#### 2. Rendered rolling alpha/beta chart and Benchmark greeks table

**Test:** After a benchmarked strategy is recomputed, view its factsheet.
**Expected:** Rolling alpha is the windowed intercept (D-17). A fabricated 0.000/0.000 greeks
pair becomes real values, or an em-dash (D-15).
**Why human:** Rendered values on real rows exist only after the recompute.

### Gaps Summary

There are no code gaps. All five roadmap success criteria hold in the code, and each rests on
evidence this verifier produced itself. Three pieces of that evidence were independent of the
SUMMARYs: a two-tree re-measurement of the trigger fixture, a golden key-path diff, and an
in-memory neuter drill of the AST gate across five call shapes. Both review rounds report
`skipped: 0`, and a spot-check of the round-2 CR-01 fix reproduced its disclosed "after" values.
The phase stays `human_needed`, not `passed`, for one reason: the founder-approved OPEN-2 recompute
and the rendered chart values happen after merge and in production. One follow-up needs attention:
the phase that will own the recompute is not yet in `ROADMAP.md`.

---

_Verified: 2026-09-25_
_Verifier: Claude (gsd-verifier)_
