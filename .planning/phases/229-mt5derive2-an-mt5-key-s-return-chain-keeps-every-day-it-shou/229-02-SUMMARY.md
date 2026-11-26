---
phase: 229-mt5derive2-an-mt5-key-s-return-chain-keeps-every-day-it-shou
plan: 02
subsystem: analytics-service
tags: [nav-twr, inception-day, data-quality-flags, annotation, mt5, deribit]
requires: [229-01, 229-03]
provides:
  - "inception_day_pnl_dropped (bool) and inception_day_pnl_dropped_days (in-process int): a no-timing inception day's P&L is counted by name instead of vanishing into the NaN"
  - "_INCEPTION_PNL_NOISE_REL = 1e-9, the relative float-noise floor for a day-0 residue"
  - "the present-only bool carry through _build_nav_meta, transforms._merge_status_meta, the job_worker strategy pre-stamp and run_csv_strategy_analytics"
affects: [strategy_analytics.data_quality_flags]
tech-stack:
  added: []
  patterns: ["annotation key (declared on NavTWRMeta, listed in NAV_TWR_ANNOTATION_KEYS, never a guard key), carried present-only and strictly is True"]
key-files:
  created: []
  modified:
    - analytics-service/services/nav_twr.py
    - analytics-service/services/transforms.py
    - analytics-service/services/job_worker.py
    - analytics-service/services/analytics_runner.py
    - analytics-service/tests/test_nav_twr.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_transforms.py
    - analytics-service/tests/test_csv_analytics_runner.py
key-decisions:
  - "Floor is relative (1e-9 x max(|NAV_0|, |flow_0|)), not floors.residual_abs_tol: the absolute tolerance is a whole currency unit and would let a sub-dollar day-0 P&L drop unflagged"
  - "Only the bool leaves nav_twr; the day count stays in-process and the amount is never stored or logged (T-73-02)"
  - "Tracer path: binance _flow_harness reached the inception branch directly, no MT5 fallback needed"
requirements-completed: [MT5D-05]
duration: 40min
completed: 2026-11-24
status: complete
actuals:
  tokens: 6700
  tasks: 2
  commits: 2
commits: 2
plan_head_before: 728296d9924a8c60b485cb33436d090b7be1890a
plan_head_after: 466f0027bea68444cb7c885cbd3fdb975376305f
---

# Phase 229 Plan 02: an inception day's P&L is flagged by name, never dropped as a silent NaN (MT5D-05)

`chain_linked_twr` now counts a no-timing day 0 whose P&L clears a 1e-9 relative noise floor as the annotation `inception_day_pnl_dropped`, and the bool rides the same present-only chain as the D-15 `flow_timing_day_level_large` annotation all the way to `strategy_analytics.data_quality_flags`, without ever promoting computation status.

## Tasks

| Task | Name | Commit |
|---|---|---|
| 1 (tracer) | end to end, an inception day 0 carrying P&L is counted in nav_twr and pre-stamped as a bool on the strategy | `c0330388d` feat(229-02): flag an inception day's P&L by name instead of dropping it as a silent NaN |
| 2 | the runner carry, the ccxt carry unit pin, and the native and MT5 day-0 paths | `466f0027b` feat(229-02): carry the inception-day annotation through the runner and pin every hop |

## What changed

- `nav_twr.py`: `_INCEPTION_PNL_NOISE_REL = 1e-9` beside `FLOW_TIMING_LARGE_RATIO`; a counter `inception_pnl_dropped_days` beside `large_flow_days`; the bare inception `continue` now counts the day when `abs(cur - prev - flow_t) > _INCEPTION_PNL_NOISE_REL * max(abs(cur), abs(flow_t))` (the loop's own expression, never `daily_pnl.iloc[0]`), then continues. After the loop the two flags are set when the count is non-zero. Both keys are declared on `NavTWRMeta`, appended to `NAV_TWR_ANNOTATION_KEYS` and never added to `NAV_TWR_GUARD_KEYS`; `_build_nav_meta` carries them present-only; the `chain_linked_twr` docstring names the annotation.
- `transforms.py` `_merge_status_meta`: bool-only `is True` carry after the D-15 carry (ccxt path).
- `job_worker.py` strategy pre-stamp: bool-only `is True` carry after the D-15 lines (statements added, no neighbouring line moved).
- `analytics_runner.py`: `inception_day_pnl_dropped: bool` on `DataQualityFlags` and the present-only `is True` carry outside both `_warned` loops.

## Tracer path used

The binance `_flow_harness` path (no MT5 fallback). The fixture is a deposit of 5,000 USDT on the first realized day plus realized P&L [+40, +50, +60] and an anchor equity of 5,150, so the day-0 base reconstructs to exactly zero and the inception predicate holds for binance (full history always true). The same test asserts the stored return rows are exactly days 1 and 2, which proves day 0 reached the inception branch. Because the ccxt path crosses `_merge_status_meta` only on its own derive (the pre-stamp reads the combiner meta), the transforms carry is additionally pinned alone by its unit test (Task 2).

## HEAD RED readings (unedited production code, tests written first)

```
FAILED tests/test_nav_twr.py::test_inception_day_zero_pnl_is_flagged_by_name_never_dropped_silently[6e-06-True]
FAILED tests/test_nav_twr.py::test_inception_day_zero_pnl_is_flagged_by_name_never_dropped_silently[0.01-True]
FAILED tests/test_nav_twr.py::test_a_single_inception_day_with_pnl_is_flagged
FAILED tests/test_nav_twr.py::test_inception_day_pnl_dropped_is_a_complete_annotation_through_build_nav_meta
FAILED tests/test_job_worker.py::TestDeriveBrokerDailies::test_a_day_zero_pnl_on_an_inception_day_prestamps_the_bool
5 failed, 4 passed, 299 deselected, 5 warnings in 5.21s
E           KeyError: 'inception_day_pnl_dropped'   (nav_twr unit, flagged cases)
E       AssertionError: assert 'complete_with_warnings' == 'complete'   (_build_nav_meta: the unknown key warned)
>       assert all(f.get("inception_day_pnl_dropped") is True for f in prestamp_flags)   -> assert False   (tracer)
```

The four unflagged parametrizations (p = 0.0, 1e-12, 4e-6, plus `small_base_is_an_annotation`) were GREEN at HEAD, as expected: they pin the quiet side of the floor. Task 2's runner, transforms and native/MT5 tests were authored after the Task 1 production edits (the runner carry was added before its tests were run), so their RED evidence is the PROOF-01 neuters (b) and (d) below, not a HEAD reading.

## PROOF-01 (neuter, RED, restore by cp and cmp from a byte backup outside the repo, GREEN)

(a) nav_twr counter increment neutered (`inception_pnl_dropped_days += 1` -> `pass`):

```
--- (a) NEUTERED counter increment
FAILED tests/test_nav_twr.py::test_inception_day_zero_pnl_is_flagged_by_name_never_dropped_silently[6e-06-True]
FAILED tests/test_nav_twr.py::test_inception_day_zero_pnl_is_flagged_by_name_never_dropped_silently[0.01-True]
FAILED tests/test_nav_twr.py::test_a_single_inception_day_with_pnl_is_flagged
3 failed, 3 passed, 173 deselected in 4.97s
(a) restored cmp OK
6 passed, 173 deselected in 4.95s
```

(c) job_worker pre-stamp carry neutered (`_prestamp_flags["inception_day_pnl_dropped"] = True` -> `pass`; the grep for the literal then counted 0):

```
--- (c) NEUTERED pre-stamp carry
FAILED tests/test_job_worker.py::TestDeriveBrokerDailies::test_a_day_zero_pnl_on_an_inception_day_prestamps_the_bool
1 failed, 128 deselected, 5 warnings in 5.25s
(c) restored cmp OK
1 passed, 128 deselected, 5 warnings in 5.06s
```

(b) transforms carry neutered (`meta["inception_day_pnl_dropped"] = True` -> `pass`):

```
--- (b) NEUTERED transforms carry
FAILED tests/test_transforms.py::TestTradesToDailyReturnsWithStatus::test_inception_day_pnl_dropped_carried_as_a_bool_and_never_promotes
1 failed, 42 deselected in 6.77s
(b) restored cmp OK
1 passed, 42 deselected in 5.16s
```

(d) runner carry neutered (`data_quality_flags["inception_day_pnl_dropped"] = True` -> `pass`):

```
--- (d) NEUTERED runner carry
FAILED tests/test_csv_analytics_runner.py::test_inception_day_pnl_dropped_is_carried_and_never_promotes
FAILED tests/test_csv_analytics_runner.py::test_inception_day_pnl_dropped_beside_a_real_guard_still_warns
2 failed, 6 passed, 76 deselected in 5.25s
(d) restored cmp OK
8 passed, 76 deselected in 6.50s
```

Backups lived in the session scratchpad, outside the repository; every restore was `cp` from the backup followed by `cmp` (no output on success, then the OK line).

## Verification

- Neighbour suites (`test_nav_twr`, `test_transforms`, `test_csv_analytics_runner`, `test_job_worker`, `test_derive_broker_dailies_dualmode`, `test_native_nav`, `test_broker_dailies`, `test_mt5_deal_reconstruction`): `910 passed, 1 skipped`. The one skip is `tests/test_job_worker.py:4278`, a pre-existing local-stack test that needs `LANE_DB_URL` (unset in local dev), unrelated to this plan. No test outside this plan's own moved.
- `mypy --strict` (the 229-VALIDATION command): `Success: no issues found in 142 source files`.
- The three vitest literal pins (`tiny-base-literal-pin`, `options-cash-basis-literal-pin`, `nav-marks-start-literal-pin`): `3 passed (3)`, `30 passed (30)`.
- The soak test `test_one_checked_day_among_knife_edge_sweep_days_is_not_green[10000.0-10050.0]` (owned by plan 229-04) was not run and not touched.

## Reach statement (A-02-3), for the ship's CHANGELOG

The annotation is not MT5-specific. At their next derive it can appear on any full-history key whose day 0 passes the inception predicate and carries P&L without a `DayTiming`: MT5 keys (`combine_mt5_deal_ledger`, shown by `test_native_and_mt5_day_zero_pnl_raise_the_flag`), Deribit keys and strategies (`reconstruct_native_nav_and_twr`, same test), and ccxt strategies whose full-history verdict is true (binance, shown by the tracer). No published number moves: day 0 stays NaN exactly as before, computation status stays `complete`, and no frontend copy, payload key reader or payload cache version changes (an unknown `data_quality_flags` key is ignored by `src/lib/factsheet`).

## Edge decisions pinned

- Deposit-only day (P&L exactly 0.0, or 1e-12) raises no flag (D-12 "no return, no warning"); a single-day series whose day 0 carries P&L raises it with count 1.
- Floor sides on a 5,000 deposit: 4e-6 quiet, 6e-6 flagged (floor 5e-6); 0.0, 1e-12 quiet and 0.01 flagged.
- A non-finite day-0 level compares False and is not counted (A-02-2).

## Deviations from Plan

None - plan executed exactly as written. (One process note, not a deviation: the plan's "tests first, keep the RED output" was followed for Task 1 and recorded above; for Task 2 the runner carry was added before its tests, so those tests' RED evidence is the PROOF-01 neuters.)

## Known Stubs

None.

## Threat Flags

None. The new surface is one bool in `data_quality_flags`, covered by T-229-03 (only the bool is carried; tests assert the count is not carried by transforms or the pre-stamp, and the runner reads only the bool key) and T-229-04 (annotation, never a guard key; tests assert status `complete` and `computation_warned` False on a flag-only set).

## Self-Check: PASSED

- Commits `c0330388d` and `466f0027b` are ancestors of HEAD.
- `grep -a -c` acceptance counts: nav_twr.py 14 (>= 6), `^_INCEPTION_PNL_NOISE_REL = 1e-9$` 1, transforms.py 2 (>= 2), job_worker pre-stamp literal 1, analytics_runner.py 3 (>= 3), test_csv_analytics_runner.py 10 (>= 3), test_transforms.py 9 (>= 2).
- STATE.md and ROADMAP.md untouched.
