---
phase: 236-figuremath-every-engine-annualizes-one-way-cvar-is-historica
plan: 03
subsystem: stored-python-engine
tags: [cvar-floor, smart-ratios, cagr-span, golden, census, sd-ddof]
requires: [236-01]
provides:
  - "_historical_var_cvar returns (var, None) under CVAR_MIN_OBS = 60 non-NaN returns; VaR unfloored; n == 0 unchanged"
  - "smart_sharpe and smart_sortino scale by sqrt(periods_per_year) (CONTEXT A4)"
  - "metrics_json.cagr_start and cagr_end: ISO first and last day of the CAGR suffix, both None with the CAGR (and on the simple convention)"
  - "metrics.py, portfolio_optimizer.py and allocated_capital.py read the named constants; all three leave NOT_YET_MIGRATED"
  - "cvar_floor section in figure_parity_vectors.json (the TS-shared var_cvar section is untouched)"
  - "Python census CVaR-reader arm: the exact set of _historical_var_cvar callers"
affects: [236-04, 236-05, 236-06, 236-09, 236-10]
tech-stack:
  added: []
  patterns: ["hand oracle with math and plain loops (smart_* closed form)", "ast-derived exact caller set"]
key-files:
  modified:
    - analytics-service/services/metrics.py
    - analytics-service/services/portfolio_optimizer.py
    - analytics-service/services/allocated_capital.py
    - analytics-service/tests/test_metrics.py
    - analytics-service/tests/test_figure_parity.py
    - analytics-service/tests/test_annualization_census.py
    - analytics-service/tests/fixtures/figure_parity_vectors.json
    - analytics-service/tests/fixtures/golden_252d_expected.json
decisions:
  - "allocated_capital._ANNUALISATION_DAYS reads PERIODS_PER_YEAR_CRYPTO (not CALENDAR_DAYS_PER_YEAR): it is the sqrt risk clock its own comment names; value unchanged (365.0)"
  - "cagr_start / cagr_end are None on the simple (capital-reset) convention: that CAGR is mean * periods_per_year, a span-free figure, so no span can be stated"
  - "PERIODS_PER_YEAR_CRYPTO is re-exported from services.metrics with the explicit `X as X` form (mypy --strict no_implicit_reexport; job_worker imports it from there)"
metrics:
  duration: "about 1h30m"
  completed: 2026-11-25
status: complete
actuals:
  tokens: 5150
  tasks: 2
  commits: 2
plan_head_before: dcc17b66e2f12a71beece528d7196c4b1ffc869c
plan_head_after: f82431cd8fbb44209e29379fbf7092706cb94a23
---

# Phase 236 Plan 03: stored Python engine to F-5 / F-6 Summary

CVaR is null below 60 total observations, smart_sharpe and smart_sortino ride the frequency clock, every stored row states its CAGR span, and the Python engines read the named constants; every gate was neutered to RED and restored byte-exact.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | 83467a2c1 | CVaR floor in `_historical_var_cvar`, `cvar_floor` fixture section, constants in metrics.py wired to `services.figure_conventions` |
| 2 | f82431cd8 | smart_* on `periods_per_year`, `cagr_start` / `cagr_end` with the golden keys, `SD_DDOF` in the three engines, census shrink and CVaR-reader arm |

RED at HEAD, Task 1: `test_cvar_floor_vectors[n59_below_floor]` and `test_stored_cvar_is_null_below_the_total_record_floor` (plus the three short `var_cvar` vectors the adapted test now expects as None). Task 2: `test_smart_sharpe_and_sortino_annualize_on_the_frequency_clock[365]` (`assert 1.7053428583962433 == 2.0523804477771503`; the `[252]` case passed at HEAD, which validates the hand oracle against the engine's old behaviour), the four `cagr_span` tests (`KeyError: 'cagr_start'`), and `test_metrics_parity_full` (`missing keys in actual: ['cagr_end', 'cagr_start']`) once the golden gained the keys.

## Golden decision note (T-236-23)

`golden_252d_expected.json` was hand-edited, 2 lines added under `metrics_json.metrics_json` (`git diff`: `+ "cagr_end": "2025-12-18"`, `+ "cagr_start": "2025-01-01"`, nothing else). `regen_golden.py` was not run.
- Values come from the committed fixture, not engine output: first and last `date` of the golden's own committed `returns_series` (2025-01-01 and 2025-12-18, 252 rows). They also equal the first and last `date` of the committed `golden_252d_input.json` `returns`.
- Independent cross-check, plain arithmetic: span = 351 whole days; `(1 + cumulative_return) ** (365 / 351) - 1` with the committed `cumulative_return` 0.021583583443333776 gives 0.022454062113715922, the committed `cagr`, difference 0.0 (tolerance 1e-12). So the suffix is the whole series and no interior break applies.
- The golden was computed at periods 252 (`regen_golden.py` calls `compute_all_metrics(returns, benchmark)` with the default), so smart_sharpe and smart_sortino do not move there. No other golden key moved (`test_metrics_parity.py` and `src/__tests__/metrics-parity.test.ts` GREEN with only the two additions).

## Moved pins

None. No existing smart_* pin moved: the existing ones are computed at periods 252 (the default). The only existing expectation that changed is the three short vectors of the `var_cvar` section under `test_historical_var_cvar_matches_hand_derived_vector` (n = 37, 12, 40): the test now expects `cvar is None` for any vector under 60 and keeps checking VaR. Their `expected_cvar` in the JSON stays the unfloored tail mean (hand-derived in the fixture) because the TS helper `historicalVarCvar` reads the same section and has no floor; the Python floor is pinned by the new `cvar_floor` section. (The `max(1, k)` tail slice of `_historical_var_cvar` is now unreachable in Python for n < 20, since the floor returns first; it was left as is.)

## Figures that move at re-derive

- `cvar` becomes null for every strategy whose TOTAL record has fewer than 60 non-NaN returns (`var_1d_95` unchanged).
- `smart_sharpe` and `smart_sortino` move by sqrt(365/252) (about x1.2034) for every crypto strategy (periods_per_year 365); traditional strategies (252) do not move.
- Old rows lack `cagr_start` / `cagr_end` until the fleet re-derive (additive keys, no schema or migration); readers added by later plans must tolerate an absent key.

## PROOF-01 (byte backups in the scratchpad, restored with cp, verified with cmp)

Task 1 (a). Neuter in `services/metrics.py`: deleted the floor branch
`    if n < CVAR_MIN_OBS:` / `        return ordered[min(k, n - 1)], None` from `_historical_var_cvar`.
- `pytest tests/test_figure_parity.py -k cvar_floor_vectors` RED: `E  assert -0.055 is None` / `FAILED tests/test_figure_parity.py::test_cvar_floor_vectors[n59_below_floor]` / `1 failed, 2 passed, 17 deselected`. (The full selection also reddens `test_stored_cvar_is_null_below_the_total_record_floor` and the three short `var_cvar` vectors: `5 failed, 3 passed`.)
- `cp` restore, `cmp OK a2`; GREEN: `498 passed` over the Task 1 verify files.

Task 1 (b). Neuter in `services/metrics.py`: `_CALENDAR_DAYS_PER_YEAR = float(CALENDAR_DAYS_PER_YEAR)` -> `_CALENDAR_DAYS_PER_YEAR = 366.0`.
- `pytest tests/test_metrics.py tests/test_metrics_parity.py tests/test_constit_blend_parity.py tests/test_annualization_census.py` RED: first `FAILED tests/test_metrics.py::TestSegmentedCumulativeMetrics::test_cagr_window_consistent_multi_break`, then `test_clean_path_bit_identical`, `TestInsufficientWindowFlag::test_insufficient_window_geometric_short_flagged_value_unchanged`, `test_metrics_parity_full`, `test_twr05_annualization_split` / `5 failed, 324 passed`.
- `cp` restore, `cmp OK b`. The census positive arm was not live yet (metrics.py was still in `NOT_YET_MIGRATED`), so it is proven in Task 2 (d).

Task 2 (a). Neuter in `services/metrics.py`: `... / _smart_sharpe_divisor) * math.sqrt(periods_per_year))` -> `... * math.sqrt(252))` at smart_sharpe.
- `pytest tests/test_metrics.py -k smart_sharpe_and_sortino_annualize` RED: `E  assert 1.7053428583962433 == 2.0523804477771503 ± 2.1e-09` / `FAILED tests/test_metrics.py::test_smart_sharpe_and_sortino_annualize_on_the_frequency_clock[365]` / `1 failed, 1 passed`.
- `cp` restore, `cmp OK a`.

Task 2 (b). Neuter in `services/metrics.py`: deleted the line `    metrics_json["cagr_start"] = _cagr_start_iso`.
- `pytest tests/test_metrics_parity.py` RED: `E  AssertionError: metrics_json.metrics_json: missing keys in actual: ['cagr_start']` / `FAILED tests/test_metrics_parity.py::test_metrics_parity_full` / `1 failed, 34 passed`.
- `cp` restore, `cmp OK b`.

Task 2 (c). Neuter in `services/portfolio_optimizer.py`: `sd = float(returns.std(ddof=SD_DDOF))` -> `sd = float(returns.std(ddof=1))`.
- `pytest tests/test_annualization_census.py` RED, naming the file in all three arms: `'analytics-service/services/portfolio_optimizer.py: token ddof1 recorded 0, measured 1'` (`test_per_file_counts_equal_recorded`), `'analytics-service/services/portfolio_optimizer.py: literal ddof1 x1'` (`TestEngineArms::test_negative_arm`), `'analytics-service/services/portfolio_optimizer.py: never uses SD_DDOF'` (`test_positive_arm`).
- `cp` restore, `cmp OK c`.

Extra, Task 2 (d). Neuter in `services/metrics.py`: `_CALENDAR_DAYS_PER_YEAR = 366.0` (the alias no longer reads the constant).
- `pytest tests/test_annualization_census.py` RED: `Left contains one more item: 'analytics-service/services/metrics.py: never uses CALENDAR_DAYS_PER_YEAR'` / `FAILED tests/test_annualization_census.py::TestEngineArms::test_positive_arm` / `1 failed, 7 passed`.
- `cp` restore, `cmp OK d`.

Extra, Task 2 (e) (T-236-06 CVaR-reader arm). Neuter: appended `def _zoomed(r): return _historical_var_cvar(r)` to `services/metrics.py`.
- `pytest tests/test_annualization_census.py -k Cvar` RED: `FAILED tests/test_annualization_census.py::TestCvarReaders::test_the_only_stored_caller_is_compute_all_metrics_on_the_total_record` / `1 failed, 1 passed`.
- `cp` restore, `cmp OK e`; GREEN: `16 passed`.

`git status --short` showed only the intended edits after each restore.

## Verification

- Task 1 verify (`test_figure_parity`, `test_metrics`, `test_metrics_parity`, `test_benchalign`, `test_composite_headline_parity`, `test_stitch_composite_job`, `test_mt5_golden_fixtures`, `test_annualization_census`): 498 passed. `npx vitest run src/lib/figure-parity.test.ts src/lib/figure-gate.test.ts src/__tests__/metrics-parity.test.ts`: 3 files, 83 tests passed (the TS twin stays green on the untouched `var_cvar` section).
- Task 2 verify (`test_metrics`, `test_metrics_parity`, `test_annualization_census`, `test_figure_conventions`, `test_allocated_capital`, `test_portfolio_optimizer`, `test_match_engine`, `test_figure_parity`): 524 passed; the same vitest set 83 passed.
- Whole analytics suite from `analytics-service/` (`pytest tests --ignore=tests/test_e2e`, run on the final tree): 16665 passed, 93 skipped, 0 failed. This plan added no skip marker; the skip count was not compared against a HEAD baseline.
- CI mypy strict (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 144 source files`.
- Acceptance greps: `math.sqrt(252)` in metrics.py 0 (was 2); `metrics_json["cagr_start"]` 1; `"cagr_start"` in the golden 1; `"cvar_floor"` in the fixture 1.

## Deviations from Plan

**1. [Rule 1 - test broken by the change] Existing `var_cvar` Python test.** `test_historical_var_cvar_matches_hand_derived_vector` asserted an unfloored CVaR for the n = 37, 12 and 40 vectors, which the floor now nulls. The test now expects `cvar is None` under 60 and still asserts VaR for every vector. The shared JSON section was not touched, so the TS twin is unaffected. The plan did not name this test.

**2. [Rule 3 - mypy] Explicit re-export.** Making `PERIODS_PER_YEAR_CRYPTO` an import broke `job_worker.py`'s `from services.metrics import PERIODS_PER_YEAR_CRYPTO` under `mypy --strict` (`does not explicitly export`). The import uses `PERIODS_PER_YEAR_CRYPTO as PERIODS_PER_YEAR_CRYPTO`, which keeps every importer unchanged.

**3. [Premise gap, decision recorded] Simple convention has no span.** The plan's `cagr_start` / `cagr_end` come from `_cagr_index`, which exists only in the geometric branch; the simple branch's CAGR is `mean * periods_per_year`. Both keys are present and `None` there (test `test_cagr_span_keys_are_none_on_the_simple_convention`). No decision in CONTEXT covers the simple branch; stating a span for a span-free figure would be false, so None is the conservative reading. Say so if the founder wants otherwise.

**4. [Plan wording] Task 1 PROOF-01 (b) census arm.** metrics.py was still in `NOT_YET_MIGRATED` after Task 1, so the census positive arm could not go RED there; it is proven in Task 2 (d).

**5. [Scope note] Not migrated to `ddof=SD_DDOF`, by plan.** Residue and dispersion checks (`_dispersion_is_real` / `_residue` operands), serenity's raw `std()`, the outlier-ratio sd and the rolling-greeks beta `std` stay bare `.std()`; their count (std_call 17 in metrics.py) is unchanged because the census token matches `.std(` with or without `ddof=`. The census reason for metrics.py states this.

## Known Stubs

None.

## Threat Flags

None. `cagr_start` / `cagr_end` are derived from dates already published in `returns_series` (T-236-08, accepted). T-236-06 (CVaR on a too-short record) is mitigated and proven by PROOF-01 Task 1 (a) and Task 2 (e); T-236-07 (TS twin floored) by the separate `cvar_floor` section and the TS twin run; T-236-23 (golden pasted from engine output) by the decision note above.

## Self-Check: PASSED

Modified files exist; commits 83467a2c1 and f82431cd8 are ancestors of HEAD; `commits: 2` is measured from the plan ledger (`dcc17b66e..f82431cd8`).
