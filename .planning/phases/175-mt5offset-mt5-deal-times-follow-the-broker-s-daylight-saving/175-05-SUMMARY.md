---
phase: 175-mt5offset-mt5-deal-times-follow-the-broker-s-daylight-saving
plan: 05
subsystem: analytics-service
tags: [mt5, dst, server-clock, allocator-backfill, ast-pin, fail-loud]
status: complete

requires:
  - phase: 175-01
    provides: resolve_mt5_server_clock, server_clock_for_rule, Mt5ServerClockConfigError
  - phase: 175-03
    provides: job_worker's _mt5_clock, the suite default fixture
provides:
  - "the allocator-history backfill (_mt5_fetch_window) resolves the broker clock once and threads it to the levels fold; the seventh and last inline read of the offset variable is gone"
  - "_MT5_BACKFILL_MESSAGES['server_clock_config']: a clock configuration fault is a transient, fixed-text, nothing-persisted verdict"
  - "AST pins: single reader of the two settings across the CI mypy file set, one clock per consumer"
affects: [175-06 post-deploy switch]

actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: 4a6de94a2f5a7e57af0ced10654d856f6e047745
plan_head_after: b9313b768d0e0894855890dbb5783c940c1693c6

key-files:
  created: []
  modified:
    - analytics-service/services/equity_reconstruction.py
    - analytics-service/tests/test_equity_reconstruction.py
    - analytics-service/tests/test_reconstruct_whole_account.py
    - analytics-service/tests/test_mt5_server_clock.py

key-decisions:
  - "A clock fault in the backfill is TRANSIENT (RESEARCH A8): the rebuild is one-time and must retry once the operator fixes the variable; the derive's fault stays permanent (plan 03) because the next nightly derive is a new job"
  - "The clock is resolved right after the kill-switch gate and before the terminal lease and the session cast, so a fault costs no lease, no terminal read and persists nothing"
  - "The fixed message carries no configured value; the resolver's closed-set text goes only to the audit sanitized_message and one WARNING naming allocator, key and arm=server_clock_config"

requirements-completed: [SC-2, D-01]
---

# Phase 175 Plan 05: The backfill follows the same clock and the readers are pinned Summary

The allocator-history backfill now resolves the broker clock once (after its own kill-switch gate, before the terminal lease) and hands it to `reconstruct_mt5_nav_levels`, a misconfigured worker returns a retrying, fixed-text `server_clock_config` failure that touches nothing, and three AST pins keep the scattered reads and any second clock out of the worker.

## What was built

- `services/equity_reconstruction.py`: new `_MT5_BACKFILL_MESSAGES["server_clock_config"]` (comment in the `history_unsettled` style, fixed text, no variable value). In `_mt5_fetch_window`: call-time import of `Mt5ServerClockConfigError` and `resolve_mt5_server_clock`; `mt5_clock = resolve_mt5_server_clock()` right after the `mt5_enabled_server()` gate; on the error one WARNING (`allocator=... key=... arm=server_clock_config`, resolver text) and `_fail("server_clock_config", "transient", detail=str(exc))`; `server_utc_offset_s=mt5_clock` replaces the inline `int(os.getenv(...))`.
- `tests/test_equity_reconstruction.py`: `test_mt5_backfill_under_the_us_rule_reconstructs_with_the_resolved_clock` (rule `us`, integer deleted; persisted levels equal the hand literals; a `wraps`-style spy on `services.broker_dailies.reconstruct_mt5_nav_levels` sees `server_utc_offset_s == server_clock_for_rule("us")`) and `test_mt5_backfill_clock_configuration_fault_is_transient_and_touches_nothing` (neither variable set; rule `us` with the integer set): FAILED, transient, fixed message, no terminal call but the shared teardown, nothing persisted, one `reconstruct_failed` audit for venue mt5.
- `tests/test_reconstruct_whole_account.py`: `("server_clock_config", "transient")` added to the member-warning parametrization (arm named, transient keeps its own kind and text).
- `tests/test_mt5_server_clock.py`: `test_single_reader` (every `.py` under services/, routers/, models/ plus the four top-level modules; no string constant equal to either setting name outside `services/mt5_server_clock.py`; hand-typed floor of 120 files, positive control that the clock module itself holds each name), `test_one_clock_per_derive` (one resolve bound to `_mt5_clock`, exactly 6 offset-carrying calls each passing it) and `test_one_clock_per_backfill` (one resolve bound to `mt5_clock`, one levels call passing it).

## Census (CLAUDE.md "grep them all")

`grep -a -rn '_MT5_BACKFILL_MESSAGES\|history_unsettled' analytics-service/tests analytics-service/services` before the change: `tests/test_reconstruct_whole_account.py` lines 1127, 1131, 1797, 1840 (the parametrized list), 1853, 1883; `tests/test_equity_reconstruction.py` lines 6616, 6636, 7093, 7104, 7118, 7126, 7166, 7172, 7176-7180 (the exhaustive classifier proof, which iterates the whole dict and so covers the new key automatically); `tests/test_mt5_derive_branch.py` (the `_history_unsettled_transport` helper, derive branch only, unrelated to the dict); `services/equity_reconstruction.py` lines 4452, 4484, 4753-4760, 4873, 5355-5359 (the unmapped-arm lookup that builds the arm name from the dict key, so the new key needed no change there). Only the one parametrized list needed a new row.

## Verification (measured)

- RED before GREEN (Task 1): with the tests written and the implementation absent, `pytest tests/test_equity_reconstruction.py tests/test_reconstruct_whole_account.py -k "resolved_clock or clock_configuration_fault or named_in_one_warning"` gave `4 failed, 7 passed`: the rule test (the fold still received the integer read from the environment), both fault cases and `test_a_failed_mt5_member_is_named_in_one_warning[server_clock_config-transient]` (the key did not exist).
- GREEN (Task 1): the two files `203 passed`; the plan's `-k "resolved_clock or clock_configuration_fault or named_in_one_warning or classifier_matchable"` gave `12 passed, 191 deselected` (plan floor 11; the extra case is another test whose name contains `named_in_one_warning`).
- Pin drills (Task 2), each from a byte backup in the scratchpad, restored with `cp` and proved with `cmp` exit 0:
  - one `job_worker.py` offset site changed to the literal `0`: `test_one_clock_per_derive` FAILED (`1 failed, 2 passed`);
  - the backfill's levels call changed to the literal `0`: `test_one_clock_per_backfill` FAILED (`1 failed, 2 passed`);
  - a new string constant naming the offset variable appended to `job_worker.py`: `test_single_reader` FAILED (`1 failed, 2 passed`).
  After each restore, `3 passed, 56 deselected`, and `git status` showed only the intended test file modified.
- Offline subset (13 files: the plan's 14 minus `tests/test_mt5offset_dry_run.py`, which plan 04 creates in another worktree and is absent here): `1054 passed`, no skip (`-rs` printed none).
- mypy (CI line verbatim from `analytics-service/`): `Success: no issues found in 124 source files`. CI runs no ruff on analytics-service (no `ruff` in `.github/workflows/ci.yml`).

## Deviations from Plan

None - plan executed as written. Notes that are not deviations:

- `tests/test_mt5offset_dry_run.py` is absent in this worktree (plan 04 runs concurrently elsewhere); dropped from the offline subset as the plan allows. The orchestrator should re-run the subset with it once plan 04 is merged.
- The plan wording "wraps spy" is implemented as a def-wrapper that records the keyword and delegates to the real function (equivalent, and it lets the real fold still run).
- The pre-commit branch allow-list in the executor protocol expects an `agent-*` branch; the work ran on the caller-assigned `wt/175-p05` in a linked worktree (not a protected branch), as instructed.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change; the only new surface is a fixed log line and an audit `sanitized_message` holding the resolver's value-free closed-set text.

## Self-Check: PASSED

- `analytics-service/services/equity_reconstruction.py` contains `"server_clock_config"` (2 quoted hits: the dict entry and the `_fail` call) and `mt5_clock = resolve_mt5_server_clock()` (1 hit); `analytics-service/tests/test_mt5_server_clock.py` contains `def test_single_reader`.
- Commits `edffecea9` and `b9313b768` are ancestors of HEAD.
