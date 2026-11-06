---
phase: 175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving
plan: 03
subsystem: analytics-service
tags: [mt5, dst, server-clock, derive, nav-marks, fail-loud]
status: complete

requires:
  - phase: 175-01
    provides: Mt5ServerClock, resolve_mt5_server_clock, Mt5ServerClockConfigError, MT5_SERVER_CLOCK_CONFIG_MESSAGES, the widened deal seam
provides:
  - "run_derive_broker_dailies_job resolves the broker clock once per MT5 derive and threads it to all six offset sites"
  - "a clock configuration fault ends the derive FAILED permanent, unstamped, with zero terminal calls"
  - "five broker_dailies fold signatures widened to int | Mt5ServerClock"
  - "suite-wide autouse default: the fixed form 0 (pre-175 arithmetic)"
affects: [175-04 dry-run script, 175-05 backfill wiring and single-reader pin, 175-06 post-deploy switch]

actuals:
  tokens: 7000
  tasks: 3
  commits: 3
plan_head_before: 564d4154fa9722740dcf56f00d0028b46ce8083d
plan_head_after: 138aecfbd4bfd94c0260fea9109470b894ec3cea

tech-stack:
  added: []
  patterns:
    - "one resolver call per derive, bound before the first terminal read, shared by every offset site (D-01)"
    - "operator fault vs user fault: a separate error class gets a permanent result and no analytics stamp"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/broker_dailies.py
    - analytics-service/tests/conftest.py
    - analytics-service/tests/test_mt5_derive_branch.py
    - analytics-service/tests/test_mt5_deal_reconstruction.py

key-decisions:
  - "The clock is resolved right after the mt5_enabled_server() gate and before the call-time imports of the MT5 modules, so a fault costs no terminal call and no import work (D-01, Pitfall 3)"
  - "Fold signatures keep their names and their `= 0` defaults and only widen the annotation (RESEARCH Open Question 2)"
  - "The suite default is the fixed form 0, not a rule: it reproduces the pre-175 arithmetic of the tests that never set the variable"

requirements-completed: [SC-2, D-01]
---

# Phase 175 Plan 03: The derive resolves one broker clock Summary

One `resolve_mt5_server_clock()` call per MT5 derive now feeds the combine, both day-P&L calls, the native-key levels, the flow day and the flow instant, so a winter deposit made after a mark's read reaches `apply_marks` on its true day with its true instant, and a worker clock misconfiguration is a loud permanent operator failure that never reaches a user's strategy.

## What was built

- `services/job_worker.py` (`run_derive_broker_dailies_job`, MT5 branch): after the kill-switch gate and before the call-time imports, `_mt5_clock = resolve_mt5_server_clock()`. `Mt5ServerClockConfigError` returns `DispatchResult(FAILED, "derive_broker_dailies: <resolver text>", error_kind="permanent")`, with no `_stamp_strategy_analytics_failed`, no persisted row and no terminal call. All six inline `int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0"))` reads are replaced by `_mt5_clock` (`grep -a -c MT5_SERVER_UTC_OFFSET_S services/job_worker.py` prints 0, `_mt5_clock` appears 7 times: one binding and the six sites). The step "(e) THE combine" comment now says the offset is the broker clock resolved once for this derive.
- `services/broker_dailies.py`: `Mt5ServerClock` imported; `_mt5_flow_day_timing`, `_fold_mt5_deals`, `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels` and `mt5_day_pnl` take `int | Mt5ServerClock` (names and `= 0` defaults kept); each docstring says the argument is the broker clock, a DST rule or the fixed integer.
- `tests/conftest.py`: autouse `_mt5_server_clock_defaults_to_the_fixed_zero_form` (sets `MT5_SERVER_UTC_OFFSET_S=0`, deletes `MT5_SERVER_TIME_RULE`), with the reason in a comment; tests of a rule or of the fault table override it.
- `tests/test_mt5_derive_branch.py`: the job-level rule test and its fixed-10800 control, the parametrized configuration-fault test (three environments) and the extended blame-free census.
- `tests/test_mt5_deal_reconstruction.py`: the DST-straddling fold test for `mt5_day_pnl`, `reconstruct_mt5_nav_levels` and `combine_mt5_deal_ledger`.

## Test-env census (RESEARCH Pitfall 2)

`grep -a -rn 'MT5_SERVER_UTC_OFFSET_S\|MT5_SERVER_TIME_RULE' analytics-service/tests` before the change: `tests/test_mt5_server_clock.py:350-351` (the plan-01 module constants `_RULE`, `_OFFSET`) and 13 `monkeypatch.setenv("MT5_SERVER_UTC_OFFSET_S", "0")` lines in `tests/test_equity_reconstruction.py` (6128, 6211, 6249, 6670, 6714, 6746, 6783, 6935, 7219, 7269, 7314, 7347, 7388). No test deletes the variable or depends on it being absent, so the autouse "0" default cannot change what any existing test asserts. (A stray `.pyc` of a planner probe also matched the grep; it is not source.)

## Verification (measured)

- RED before GREEN (Task 1): with `services/job_worker.py` restored to HEAD (byte backup of the wired file kept, restored with `cp`, `cmp` exit 0), `pytest tests/test_mt5_derive_branch.py -k "true_day_under_the_us_rule or filed_on_the_mark_day"` gave `1 failed, 1 passed`: the rule test failed on `flow_instants` (`at_ms=1762828200000`, the wall time 02:30Z, against the true `1762821000000`, 00:30Z; the day agreed, which is why the instant is asserted) and the fixed-10800 control passed.
- GREEN: the derive-branch file `53 passed` (51 at planning time plus the two job-level tests; with the fault test and census extension it is now 56 collected, and `-k "configuration_fault or blame_free"` shows `4 passed`).
- Deliberate RED of the fault test (Task 2): in `services/job_worker.py` the fault return's `error_kind` was changed to `"transient"` after a byte backup in the scratch directory. All three parametrized cases failed with `assert 'transient' == 'permanent'` (`3 failed, 1 passed`). The file was restored with `cp`, `cmp` exit 0, and the re-run showed `4 passed`.
- Fold-test drill (Task 3, extra): `_fold_mt5_deals` was forced to a fixed 10800 after a byte backup; the straddling test failed on the day set (`{'2025-10-30', '2025-11-03'}` against the rule's `{'2025-10-30', '2025-11-04'}`); restored with `cp`, `cmp` exit 0, re-run `1 passed`.
- Offline subset (the plan's 12 files, no skip): `1033 passed`. Wider run `-k "mt5 or job_worker or derive or broker_dailies or nav_marks or flow"` over `tests/`: `3606 passed, 10 skipped` (the skips are outside the 12-file subset and pre-existing).
- mypy (CI line verbatim from `analytics-service/`): `Success: no issues found in 124 source files`.

## Deviations from Plan

None - plan executed as written. Notes that are not deviations:

- The plan's RED step was driven by restoring `job_worker.py` to its HEAD bytes after the wiring was written (with a byte backup of the wired file, restored by `cp` and proved by `cmp`), rather than by writing the tests first; the observed RED is the one the plan names (the instant, not the day).
- The `.venv` was absent from the linked worktree, so `analytics-service/.venv` was symlinked to the primary checkout's (git-excluded) and is removed before finishing.
- The commit guard's per-agent branch allow-list was skipped by design: this is a sequential executor on the phase branch `feat/175-mt5offset` (SEQUENTIAL=true, #4799), which is not a protected branch.

## Known Stubs

None.

## Threat Flags

None. T-175-09 (one clock per derive, asserted by day, instant and day P&L together) and T-175-10 (operator fault never stamped, permanent, zero terminal calls) are mitigated and pinned by the tests above. T-175-11 stays with plans 02 and 06: the integer-only fixed form keeps production byte-identical, and nothing here changes the Railway variables.

## Open items for later plans

- Plan 05 owns the seventh read (`equity_reconstruction._mt5_fetch_window`) and the single-reader AST pin; after this plan `job_worker.py` carries no read of the offset variable, which that pin will assert.
- Plan 06 checks the first derive after the rule switch; a derive under a misconfigured worker now fails permanent with the resolver's closed-set text in `compute_jobs.error_message`.

## Self-Check: PASSED

- FOUND: analytics-service/services/job_worker.py, analytics-service/services/broker_dailies.py, analytics-service/tests/conftest.py, analytics-service/tests/test_mt5_derive_branch.py, analytics-service/tests/test_mt5_deal_reconstruction.py (all modified)
- FOUND commits: cfacfb4b4, 4175eeff2, 138aecfbd (all ancestors of HEAD)
