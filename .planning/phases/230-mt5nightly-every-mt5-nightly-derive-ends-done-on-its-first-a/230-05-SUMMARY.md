---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 05
subsystem: analytics-service / MT5 terminal lease callers
tags: [mt5, lease, classify-exception, holdings-sync, process-key, mt5d-02]
requires:
  - phase: 230-mt5nightly
    provides: plan 02's Mt5TerminalLeaseUnavailableError (a Mt5TerminalBusyError subclass raised by the lease entry)
provides:
  - job_worker.classify_exception arm and MT5_LEASE_UNAVAILABLE_MESSAGE (transient, fixed text)
  - allocator_positions lease-entry arm raising AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE)
  - process_key validate-only and synchronous validate arms answering a busy or lease-unavailable raise with the retryable 424
key-files:
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/allocator_positions.py
    - analytics-service/routers/process_key.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_allocator_positions_non_ccxt.py
    - analytics-service/tests/test_process_key.py
key-decisions:
  - "classify_exception gets the SUBCLASS arm only; a plain Mt5TerminalBusyError keeps the catch-all ('unknown', str(exc)), pinned by a test so widening it later is a visible decision"
  - "the holdings entry arm consults _must_reach_handler_unwrapped first like every sibling arm (a census gate demands it)"
requirements-completed: [MT5D-02]
status: complete
plan_head_before: 319a5ea2afef3445961f85bfad08434917ffbf43
plan_head_after: 3bfb5b121b448a2edb2c9645b28379a2ed8b7eac
commits: 2
actuals:
  tokens: 14000
  tasks: 2
  commits: 2
---

# Phase 230 Plan 05: Lease call-site arms Summary

A fail-closed lease raise now reaches users only through answers that already exist: the queue retries it as a transient with a fixed message, the allocator-visible sync error stays the unreachable-terminal note, and both wizard validate sites answer the retryable 424 `NETWORK_UNAVAILABLE` instead of a bodyless 500.

## Tasks

| Task | Commit | Files |
|---|---|---|
| 1 (tracer) classify_exception arm and the derive propagation test | `bd1bdf0b6` | job_worker.py, test_job_worker.py |
| 2 holdings entry arm and the two validate arms | `3bfb5b121` | allocator_positions.py, process_key.py, test_allocator_positions_non_ccxt.py, test_process_key.py |

Tracer gate: the plan's automated verify re-ran green after Task 1 (`39 passed`; whole `test_job_worker.py` 133 passed, 1 skipped, the skip pre-existing) before Task 2 started. `verify-plan-anchors.mjs` on the plan: `OK: 1 plan file(s), no stale claims.`

## What changed

- `job_worker.py`: `Mt5TerminalLeaseUnavailableError` imported from `services.mt5_concurrency`; module constant `MT5_LEASE_UNAVAILABLE_MESSAGE = "MT5 terminal lease unavailable; the job will retry"`; arm directly after the `HandlerIOUnavailable` arm returning `("transient", MT5_LEASE_UNAVAILABLE_MESSAGE)`, no `str(exc)`.
- `allocator_positions.py`: the `async with mt5_terminal_lease(...)` block is wrapped in `try:` with one `except Mt5TerminalBusyError as exc:` arm raising `AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc`. The body is re-indented and otherwise byte-identical (`git diff -w` shows only the import, comment, `try:` and the arm). No terminal restart: the terminal was never touched.
- `process_key.py`: `Mt5TerminalBusyError` imported from `services.mt5_concurrency`; both `except Mt5SessionAbandoned:` arms are now `except (Mt5SessionAbandoned, Mt5TerminalBusyError) as exc:`, bodies kept, each log call gains `cause=type(exc).__name__` (a class name), a dated Phase 230 line added to each arm's comment. No new code or copy minted.
- `_PRODUCTION_LEASE_SITES` is unchanged and `test_no_production_function_holds_two_terminal_leases` stays green.

## Tests added

- `test_job_worker.py`: classify arm (fixed text, no leak), plain busy keeps `('unknown', 'busy')`, the raise propagates unswallowed out of `run_derive_broker_dailies_job` (no terminal read, no analytics write), `dispatch` files one transient with the fixed text.
- `test_allocator_positions_non_ccxt.py`: unit (text equals `MT5_UNREACHABLE_NOTE`, marker absent, `__cause__` is the lease error, terminal untouched) and end to end through the real poll handler (`sync_error == MT5_UNREACHABLE_NOTE`, status `error`, not `sign_in_failed`, `error_kind == transient`), each over the lease-unavailable and plain busy raise.
- `test_process_key.py`: validate-only and synchronous pipeline, each over both raises: 424, `NETWORK_UNAVAILABLE`, `recoverable` true, correlation id, verification id at site 2, lease text absent from the body, code outside `PERMANENT_VALIDATION_ERROR_CODES`.

## Verification (verbatim)

```
cd analytics-service && .venv/bin/python -m pytest tests/test_allocator_positions_non_ccxt.py tests/test_allocator_positions.py tests/test_process_key.py tests/test_mt5_concurrency.py tests/test_job_worker.py -q -p no:cacheprovider
502 passed, 1 skipped, 56 warnings in 30.78s
```

Wide run, the 99 test modules naming `mt5_terminal_lease`, `mt5_concurrency`, `_mt5_terminal_lock_for`, `allocator_positions`, `process_key` or `classify_exception`: `4602 passed, 9 skipped, 352 warnings in 195.68s`. The skips are not from this plan's files.

mypy strict (CI form): `Success: no issues found in 144 source files`.

Acceptance greps: `Mt5TerminalLeaseUnavailableError` in job_worker.py 3, in test_job_worker.py 6; `except Mt5TerminalBusyError` in allocator_positions.py 1; `Mt5TerminalBusyError` in process_key.py 5; either name in test_process_key.py 6.

## PROOF-01 (byte backup `cp -p` to scratch, neuter, RED, `cp` back, `cmp -s`, GREEN)

Edit 1, classify arm removed from `job_worker.py` (`-k "lease or classify"`):

```
FAILED tests/test_job_worker.py::TestClassifyException::test_a_lease_unavailable_raise_is_transient_with_a_fixed_text
FAILED tests/test_job_worker.py::TestMt5LeaseUnavailableOnTheDerive::test_dispatch_files_it_as_one_transient_retry_with_the_fixed_text
2 failed, 37 passed, 95 deselected in 9.18s
cmp_exit=0
39 passed, 95 deselected in 8.78s
```

Edit 2, holdings arm neutered at the final code (`except Mt5TerminalBusyError` changed to catch `KeyboardInterrupt`, so it can never match):

```
FAILED tests/test_allocator_positions_non_ccxt.py::test_mt5_holdings_lease_entry_failure_is_the_user_safe_transient[lease-unavailable]
FAILED tests/test_allocator_positions_non_ccxt.py::test_mt5_holdings_lease_entry_failure_is_the_user_safe_transient[plain-busy]
FAILED tests/test_allocator_positions_non_ccxt.py::test_mt5_holdings_lease_entry_failure_stamps_the_safe_note_end_to_end[lease-unavailable]
FAILED tests/test_allocator_positions_non_ccxt.py::test_mt5_holdings_lease_entry_failure_stamps_the_safe_note_end_to_end[plain-busy]
4 failed, 1 passed, 78 deselected in 13.09s
cmp_exit=0
```

Edit 3, `Mt5TerminalBusyError` removed from the validate-only tuple (`-k lease_failure`):

```
FAILED tests/test_process_key.py::test_validate_only_lease_failure_is_a_coded_transient_never_a_500[lease-unavailable]
FAILED tests/test_process_key.py::test_validate_only_lease_failure_is_a_coded_transient_never_a_500[plain-busy]
2 failed, 2 passed, 114 deselected in 10.11s
cmp_exit=0
```

Edit 4, the same removal at the synchronous pipeline arm:

```
FAILED tests/test_process_key.py::test_sync_pipeline_lease_failure_is_a_coded_transient_never_a_500[lease-unavailable]
FAILED tests/test_process_key.py::test_sync_pipeline_lease_failure_is_a_coded_transient_never_a_500[plain-busy]
2 failed, 2 passed, 114 deselected in 9.87s
cmp_exit=0
```

Each restore was followed by a GREEN re-run (the 237-test and 502-test runs above). No `git checkout`, `git restore` or `git stash` was used.

RED before implementation (first run of each new test): the two classify and dispatch tests failed `assert 'unknown' == 'transient'`; the four holdings tests failed with the raw lease error escaping and with the end-to-end `sync_error` reading the generic "Couldn't sync holdings from MT5" copy instead of `MT5_UNREACHABLE_NOTE`; the four process_key tests failed on the unhandled lease raise.

## Deviations from Plan

**1. [Rule 1 - Bug, found by the full run] The holdings entry arm needs the classifier guard first.** `tests/test_allocator_positions.py::test_every_retry_promising_raise_is_guarded_by_the_classifier` (an AST census) failed `['Mt5TerminalBusyError (line 1171)']`: every except arm that raises a retry-promising note must begin with `if _must_reach_handler_unwrapped(exc): raise`. The arm now starts with that guard, like its siblings. Both lease raises classify transient or unknown, so it never re-raises. The plan's arm text omitted the guard. Commit `3bfb5b121`.

**2. Plan's premise about the leak is narrower than written.** Without the arm the handler's catch-all did not stamp the lease error's text into `sync_error`; it stamped the generic status copy ("Couldn't sync holdings from MT5 ..."), with a non-transient classification path for the raise. The arm still does what the plan wants (the fixed unreachable-terminal note, `transient` disposition, lease text absent), and the end-to-end test asserts exactly that, but the claim "infrastructure text reached sync_error" was not reproduced.

**3. TDD commits.** Task 2 is one commit, not a RED commit then a GREEN commit. The RED run of every new test against the unmodified source is recorded above, and PROOF-01 re-demonstrates each by neutering.

**4. Two guards already green.** In Task 1 the propagation test and the plain-busy classification pin passed on first run (the derive already lets the raise propagate, and the catch-all already classifies busy). They are regression guards, not RED targets; the classify and dispatch tests are the RED ones.

## Known Stubs

None.

## Threat Flags

None. T-230-15 and T-230-16 are mitigated by the tests above (lease text absent from `sync_error` and from both response bodies); T-230-SC accepted, no package installed.

## Open issues

- The full analytics suite was not run end to end; the 99 modules naming the touched symbols were (4602 passed, 9 skipped).
- Upstream `origin/main` has moved `job_worker.py` and `allocator_positions.py` by a few lines (the plan's flagged assumption); the orchestrator merge may see small textual offsets, not conflicts in the edited regions of the plan-04 files.

## Self-Check: PASSED

- Files modified exist: the six listed under key-files.
- Commits present on `gsd/phase-230-plan-05`: `bd1bdf0b6`, `3bfb5b121` (`rev-list --count` from the ledger base: 2).
- `STATE.md` and `ROADMAP.md` untouched.
