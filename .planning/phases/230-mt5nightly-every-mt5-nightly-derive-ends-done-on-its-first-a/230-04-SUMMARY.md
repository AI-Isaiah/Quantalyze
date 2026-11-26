---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 04
subsystem: analytics-service / MT5 terminal concurrency
tags: [mt5, lease, cross-process, postgrest, missing-rpc, fail-closed, error-budget]
requires:
  - phase: 230-mt5nightly
    provides: plan 02's lease client (acquire poll, renew task, release, local lock wiring)
provides:
  - services.db.is_missing_rpc, a structured-codes-only twin of main_worker._is_missing_rpc, pinned by a parity matrix
  - missing-RPC fallback in services.mt5_xlease (local-only hold, ERROR event mt5_xlease_unavailable re-logged every 900 s, never latched)
  - error budget for unbounded callers (_MT5_XLEASE_ERROR_BUDGET_S = 60.0) and the mt5_xlease_rpc_error WARNING
  - missing-RPC handling in the renew loop and the release path
affects: [230-05 (classification of Mt5TerminalLeaseUnavailableError), 230-08 (read both services' logs for the event after deploy), 230-09 (night counting reads mt5_xlease_unavailable)]
actuals:
  tokens: 10500
  tasks: 2
  commits: 3
plan_head_before: 319a5ea2afef3445961f85bfad08434917ffbf43
plan_head_after: 53d6e0094ea75d2c15ac5ad362e1e7ce2bab7d49
tech-stack:
  added: []
  patterns:
    - "duplicated predicate pinned by a parity matrix that asserts both the expected value and the twin's answer"
    - "relog clock as a patchable module seam, shared by acquire, renew and release"
key-files:
  created:
    - analytics-service/tests/test_db_is_missing_rpc.py
  modified:
    - analytics-service/services/db.py
    - analytics-service/services/mt5_xlease.py
    - analytics-service/tests/test_mt5_xlease.py
key-decisions:
  - "DEC-04-A: the fallback hold is an XLeaseHold with cross_process=False (no renew task, release is a no-op), so mt5_terminal_lease needed no new branch"
  - "DEC-04-B: relog every 900 s on one shared clock, never latched"
  - "DEC-04-C: 60 s error budget for unbounded callers; an answer (True or False) resets the window; a bounded caller ignores it"
  - "DEC-04-D: predicate lives in services/db.py, main_worker untouched"
  - "A client-side RPC timeout is neither an error nor an answer: it neither opens nor clears the error window (see Open issues)"
requirements-completed: [MT5D-02]
duration: ~60min wall clock (about 15 of them PROOF-01 and gate runs)
completed: 2026-11-25
status: complete
---

# Phase 230 Plan 04: Missing-RPC fallback and fail-closed error budget Summary

**A lease RPC that does not exist degrades to the in-process lock with a loud, re-logged, never-latched ERROR event; every other lease database error fails closed after a 60 s budget (unbounded callers) or at the caller's own deadline (bounded callers).**

## Accomplishments

- `services.db.is_missing_rpc(exc)`: `.code` or `.details["code"]` equal to `42883` or `PGRST202`, structured codes only. Parity with `main_worker._is_missing_rpc` is pinned over an 18-shape matrix (6 True, 12 False) that asserts each shape against its expected value and against the twin.
- `acquire_terminal_xlease` on a missing RPC: `_note_unavailable`, release of any earlier poll's late grant, then a `cross_process=False` hold. `mt5_terminal_lease` is unchanged.
- `_note_unavailable(rpc_name, site)`: ERROR, `event_type=mt5_xlease_unavailable`, extra `rpc` and `site`, at most once per 900 s on the `_relog_clock` seam; `_UNAVAILABLE_LAST_LOGGED` is cleared by `_reset_xlease_state_for_tests`. The comment names the event as plan 09's contract.
- Fail closed for every other error: one WARNING per acquisition (`mt5_xlease_rpc_error`, rpc name, site and exception class), an unbounded caller raises `XLeaseUnavailable` after `_MT5_XLEASE_ERROR_BUDGET_S` of consecutive errors, a bounded caller reaches `XLeaseBoundExpired` (Busy) at its deadline. Local lock released, nothing stamped, epoch unchanged.
- Renew loop: a missing renew RPC calls `_note_unavailable` and stops renewing without `on_lost`. Release: a missing RPC calls `_note_unavailable`; other errors keep the plan-02 WARNING.
- `_validate_xlease_timing` takes a fifth argument and refuses `rpc_timeout >= error_budget`.

## Task Commits

1. **Task 1 (tracer): a missing lease RPC degrades loudly** - `4bddfb8ad` (feat). Tracer gate: the plan's `<verify>` re-run before Task 2 (48 passed in the two files, then 297 passed across `test_mt5_concurrency.py` and the source-scanning gates).
2. **Task 2 (tdd): every other error fails closed** - `cc4a54176` (test, RED), `53d6e0094` (feat, GREEN)

## RED evidence (Task 2)

The RED record passed `gsd_run check tdd-red-evidence`: `RED_EVIDENCE_OK`, reason `target_test_failed`, format `junit`, 3 of 3 failing in the targeted run.

- Target `test_renew_missing_rpc_stops_renewing_without_declaring_the_lease_lost`: `AssertionError: a missing renew RPC fenced a holder that still owns the terminal` (`assert 1 == 0`, the epoch).
- Semantic assessment: the target ran and failed on its planned assertion. Plan 02 treats a missing renew as any failure and fences the holder after LOST_AFTER. Of the 15 RED tests in the full run, the budget tests failed on `AttributeError` for the not-yet-existing `_MT5_XLEASE_ERROR_BUDGET_S` (the planned absent constant, patched inside the test body so it is a test failure, not a fixture error), the bounded and reset tests failed on behaviour. `test_release_error_never_masks_the_bodys_exception` was already GREEN (plan 02's release warning) and is a guard, not a RED target.

## PROOF-01 (recorded at code HEAD `53d6e0094ea75d2c15ac5ad362e1e7ce2bab7d49`, clean `git status` before and after)

Each neuter patched production code after a byte backup (`cp -p` to scratch), ran the named tests, restored by `cp` and checked `cmp -s`. No `git checkout`, `git restore` or `git stash` was used. Every restore printed `cmp_exit=0`.

**A. Every error falls back** (`db.py` `is_missing_rpc` returns True first). Matrix arm first:
```
E       AssertionError: services.db.is_missing_rpc(_Shaped('ERROR: 42883 function does not exist')) should be False
FAILED tests/test_db_is_missing_rpc.py::test_is_missing_rpc_matches_its_expectation_and_the_main_worker_twin[message mentions 42883, no code]
```
The fail-closed tests under the same neuter (T-230-12, run without `-x`):
```
FAILED tests/test_mt5_xlease.py::test_lease_unavailable_releases_the_local_lock_and_stamps_nothing
FAILED tests/test_mt5_xlease.py::test_budget_unbounded_caller_fails_closed_only_after_the_budget
FAILED tests/test_mt5_xlease.py::test_budget_one_rpc_error_per_acquisition_is_a_warning_with_the_class_only
FAILED tests/test_mt5_xlease.py::test_bounded_caller_keeps_polling_through_errors_and_gets_busy_at_its_bound
4 failed, 34 deselected in 57.69s
```

**B. A missing RPC fails closed** (`is_missing_rpc` returns False first):
```
E       AssertionError: services.db.is_missing_rpc(_Shaped('')) should be True
FAILED tests/test_db_is_missing_rpc.py::test_is_missing_rpc_matches_its_expectation_and_the_main_worker_twin[code 42883]
```

**C. Drop the PGRST202 arm:**
```
E       AssertionError: services.db.is_missing_rpc(_Shaped('')) should be True
FAILED tests/test_db_is_missing_rpc.py::test_is_missing_rpc_matches_its_expectation_and_the_main_worker_twin[code PGRST202]
```

**D. No error budget** (`bound_s is None and ...` becomes `False and ...`): `FAILED tests/test_mt5_xlease.py::test_budget_unbounded_caller_fails_closed_only_after_the_budget` (the deadman timeout fires, since the caller never gives up).

**E. An answer does not reset the error window:**
```
E       AssertionError: gave up at 0.40s: an answered call did not reset the 0.4s error budget (without a reset it would give up at about 0.4s)
FAILED tests/test_mt5_xlease.py::test_budget_a_database_answer_resets_the_error_window
```

**F. Latched fallback** (relog never re-logs):
```
E       AssertionError: 901 s after the first line the fault must be told again (never one line per process)
FAILED tests/test_mt5_xlease.py::test_missing_rpc_falls_back_to_the_local_lock_and_relogs_every_900s
```

**G. A missing renew RPC counted as a lost lease:**
```
E           AssertionError: a missing renew RPC fenced a holder that still owns the terminal
```

**GREEN after all restores:** `30 passed, 27 deselected in 138.72s (0:02:18)` over `tests/test_db_is_missing_rpc.py` and the `is_missing_rpc or budget or bounded or missing_rpc or fallback or never_latched or one_rpc_error or relogs` selection of `tests/test_mt5_xlease.py`.

## Verification

- `tests/test_mt5_xlease.py tests/test_mt5_concurrency.py tests/test_db_is_missing_rpc.py`: `93 passed` at the GREEN state.
- Source-scanning gates (`test_live_db_reach_roster`, `test_live_db_transport`, `test_structlog_frozen_proxy`, `test_stamp_io_exhaustive`, `test_app_factory_parity`, `test_limiter_identity`, `test_e1_delete_gate`) plus `test_db_is_missing_rpc`: `280 passed, 48 warnings`.
- Plan acceptance selection `-k "unavailable or budget or bounded"`: `6 passed`.
- mypy strict (CI command): `Success: no issues found in 144 source files`, run after Task 1 and after Task 2.
- Acceptance greps: `def is_missing_rpc` in `db.py` 1; `mt5_xlease_unavailable` in `mt5_xlease.py` 2; `_MT5_XLEASE_ERROR_BUDGET_S` 5; `mt5_xlease_rpc_error` 1.
- `verify-plan-anchors.mjs` on this plan before the first edit: OK, exit 0.

## Deviations from Plan

**1. [Rule 3 - Blocking] Two existing plan-02 tests now patch the error budget**
- **Found during:** Task 2 design. `test_lease_unavailable_releases_the_local_lock_and_stamps_nothing` and the third leg of `test_redaction_nothing_a_full_hold_writes_carries_the_terminal_key` drive an unbounded caller against an always-raising acquire. Plan 02 failed closed at once; with the budget they would each wait 60 s.
- **Fix:** both patch `_MT5_XLEASE_ERROR_BUDGET_S` to 0.2 s (and the first takes `fast_poll`). Their assertions are unchanged. **Commit:** `cc4a54176`.

**2. [Rule 3 - Blocking] `_validate_xlease_timing` signature gained a fifth argument**
- The parametrized timing test and the import-time call pass it positionally; the plan asks for the new inequality without naming the signature. **Commit:** `53d6e0094` (test side in `cc4a54176`).

**3. Choices that go beyond the plan's wording (behaviour as specified)**
- The fallback also calls `_release_late_grants(pending, ...)` before returning the local-only hold: an earlier poll still in flight could be granted after a later poll learns the RPC is missing, which would hold the row for a TTL. Pinned by `test_a_late_grant_from_an_earlier_poll_is_released_when_the_fallback_is_taken`.
- `mt5_xlease_rpc_error` is logged once per acquisition (a flag), not once per error window, so the volume stays bounded when answers and errors alternate.
- Tests use a small `_ScriptedBackend` (per-call script) beside `FakeXLeaseBackend`, defined in `tests/test_mt5_xlease.py`; `tests/xlease_fakes.py` is untouched.

## Known Stubs

None.

## Threat Flags

None. No new network surface: the same three RPCs, and log lines that carry the RPC name, the site and the exception class only (T-230-14 is pinned by `test_redaction_no_record_from_the_failure_paths_carries_the_exception_text`, which also asserts `exc_info is None`).

## Open issues

- **A hung database never ends an unbounded caller.** A client-side RPC timeout (the call outlived `_MT5_XLEASE_RPC_TIMEOUT_S`) is not an exception from the backend, so it neither opens nor clears the error window; an unbounded caller facing a database that hangs rather than errors keeps polling. It never proceeds unserialized (fail closed), but it also never raises. The plan specifies the budget over "consecutive errors" only and the timing inequality `rpc_timeout < error_budget` would also fit counting timeouts; left as specified. Worth a decision before plan 09's night counting if a hang is a realistic mode.
- A missing release RPC while the acquire RPC exists (a partial migration) leaves the row to expire on its TTL; the shared relog clock means one line covers all three RPCs, so a persistent fault in only one of them is told by the first RPC that notices it.
- The full analytics suite was not run end to end; the lease modules, the source-scanning gates and mypy strict were.

## Self-Check: PASSED

- Files exist: `analytics-service/tests/test_db_is_missing_rpc.py`, `analytics-service/services/db.py`, `analytics-service/services/mt5_xlease.py`, `analytics-service/tests/test_mt5_xlease.py`, this SUMMARY.
- Commits present on `gsd/phase-230-mt5nightly`: `4bddfb8ad`, `cc4a54176`, `53d6e0094` (`rev-list --count` from the ledger base: 3).
- `STATE.md` and `ROADMAP.md` untouched.
