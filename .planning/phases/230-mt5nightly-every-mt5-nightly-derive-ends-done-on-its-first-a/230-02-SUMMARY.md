---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
plan: 02
subsystem: analytics-service / MT5 terminal concurrency
tags: [mt5, lease, cross-process, asyncio, postgrest, self-fence]
requires:
  - phase: 230-mt5nightly
    provides: plan 01's lease RPC contract (acquire/renew/release_mt5_terminal_lease, RETURNS boolean)
provides:
  - services.mt5_xlease leaf: digest, backend seam, acquire poll, renew task, self-fence, release
  - mt5_terminal_lease takes the database lease after the in-process lock
  - Mt5TerminalLeaseUnavailableError (a busy subclass)
  - suite default GrantingXLeaseBackend and FakeXLeaseBackend (SQL semantics, injectable clock)
  - XPROC-01 with PROOF-01 on production code
affects: [230-04 (missing-RPC fallback and error budget), 230-07 (live lane test), 230-09 (night counting)]
actuals:
  tokens: 18800
  tasks: 3
  commits: 5
plan_head_before: 7d19de0d1d5923f1cae67543c64a7e892f73812e
plan_head_after: d9724587150c2a0cd62b1b7d1aea0dbe23a1c369
tech-stack:
  added: []
  patterns:
    - "every acquire RPC is a future that outlives its awaiter; an abandoned one releases its token if granted late"
    - "self-fence as an on_lost callback so the leaf never imports the epoch registry"
key-files:
  created:
    - analytics-service/services/mt5_xlease.py
    - analytics-service/tests/xlease_fakes.py
    - analytics-service/tests/test_mt5_xlease.py
  modified:
    - analytics-service/services/mt5_concurrency.py
    - analytics-service/services/mt5_handover.py
    - analytics-service/tests/conftest.py
    - analytics-service/tests/test_mt5_concurrency.py
    - analytics-service/tests/test_mt5_terminal_scrub.py
key-decisions:
  - "DEC-02-A followed as the plan records it (database release inside the local hold, before lock.release()), not RESEARCH Pattern 1 / PATTERNS order"
  - "acquire uses asyncio.wait over the in-flight future instead of wait_for(shield(fut)): same outliving-future semantics, and no TimeoutError conflation with a backend that raises one"
  - "a floor on one acquire RPC's bound (_MT5_XLEASE_MIN_ATTEMPT_S = 0.5) so a spent bound still lets the RPC future run"
requirements-completed: [MT5D-02]
duration: 34min
completed: 2026-11-25
status: complete
---

# Phase 230 Plan 02: Cross-process MT5 terminal lease (client half) Summary

**`mt5_terminal_lease` now takes a database lease row after its in-process lock, so two processes with separate lock registries serialize on the one terminal; XPROC-01 goes RED under two neuters of production code and GREEN after byte restore.**

## Performance

- **Duration:** 34 min
- **Started:** 2026-11-25T19:15:06Z
- **Completed:** 2026-11-25T19:49:52Z
- **Tasks:** 3
- **Files modified:** 8 (3 created)

## Accomplishments

- New leaf `services/mt5_xlease.py`: digest (`sha256("mt5-terminal-lease/v1\x00" + key.strip().lower())`), `XLeaseBackend` seam with the PostgREST backend, poll with jitter, one deadline across the local and database stage, late-grant release callbacks, renew task, self-fence callback, never-raising release, import-time timing validation (DEC-02-E).
- `mt5_terminal_lease` wiring: acquire after the local lock, translate `XLeaseBoundExpired` to the existing `Mt5TerminalBusyError` and `XLeaseUnavailable` to the new `Mt5TerminalLeaseUnavailableError` (busy subclass, not `Mt5ClientError`); every failure arm releases the local lock and stamps, bumps and records nothing; finally in the DEC-02-A order.
- Suite safety (T-230-08): a session-scoped and a function-scoped autouse fixture install `GrantingXLeaseBackend` and make `mt5_xlease.get_supabase` refuse, landed before the wiring.
- 25 tests in `tests/test_mt5_xlease.py` (XPROC-01 and its control, bound, one deadline, spent bound, unavailable, two late-grant arms, cancel during release, in-process handover, wait event, digest, redaction, renew, lost on false, lost on silence, renew-task safety, stop on exit, holder cancel, five timing inequalities, reset); leaf and busy-lineage tests extended in `test_mt5_concurrency.py`.
- Dated `CORRECTED 2026-11-25 (Phase 230 ...)` lineage note on the SCOPE block above `_MT5_TERMINAL_LOCKS`.

## Task Commits

1. **Task 1 (tracer): end to end two processes never share the terminal** - `aeabe117b` (feat)
2. **Task 2 (tdd): bound, late grant, cancellation, wait event, redaction** - `08664a706` (test, RED), `6ffd0e3d0` (feat, GREEN)
3. **Task 3 (tdd): renewal, self-fence, timing validation, reset hook** - `9f03fda14` (test, RED), `d97245871` (feat, GREEN)

Tracer gate: re-ran the plan's `<verify>` after Task 1 (80 passed) before expanding.

## RED evidence (tdd tasks)

Both RED records passed `gsd_run check tdd-red-evidence` (`RED_EVIDENCE_OK`, `target_test_failed`, JUnit format).

- Task 2 target `test_late_grant_after_bound_expiry_is_released`: `AssertionError: the late grant was never released (calls=['acquire'])`. Also RED: `test_late_grant_after_a_normal_hold_is_released_again`, `test_waited_event_is_one_info_record_with_counts_only` (`expected exactly one wait record, got 0`). Semantic assessment: each ran and failed on its own planned assertion; Task 1 treated a client-side timeout as `XLeaseUnavailable` and had no wait event.
- Task 3 target `test_renew_a_long_body_keeps_its_lease_by_renewing_with_its_own_token`: failed because no renew was ever called (also RED: both `lost` arms and the renew-task arm). Semantic assessment: Task 2 had no renew task. The stop-on-exit, holder-cancel, timing and reset tests were already satisfied by earlier code and are guards, not RED targets.

## PROOF-01 (recorded at final code HEAD `d9724587150c2a0cd62b1b7d1aea0dbe23a1c369`, clean `git status`)

Command: `cd analytics-service && "${PY:?}" -m pytest tests/test_mt5_xlease.py -q -p no:cacheprovider -k xproc_01_two`

**Neuter (a)** in `services/mt5_xlease.py`: the poll loop counts the first poll as granted without reading the backend's answer (`cp -p` backup in scratch first).

```
        """XPROC-01 — two holders that share NO in-process lock registry but share one
            f"XPROC-01 the second process entered before the first left (events={events}) "
E       AssertionError: XPROC-01 the second process entered before the first left (events=['a-enter', 'b-enter', 'a-exit', 'b-exit']) - the cross-process lease is not serializing the terminal
1 failed, 24 deselected in 19.14s
```
Restore: `cp` from the backup, then `cmp -s` printed `cmp_exit=0`. GREEN re-run: `1 passed, 24 deselected in 26.47s`.

**Neuter (b)** in `services/mt5_concurrency.py`: the `acquire_terminal_xlease(...)` await replaced by a stand-in hold whose `stop_renewing` and `release` do nothing.

```
        """XPROC-01 — two holders that share NO in-process lock registry but share one
            f"XPROC-01 the second process entered before the first left (events={events}) "
E       AssertionError: XPROC-01 the second process entered before the first left (events=['a-enter', 'b-enter', 'a-exit', 'b-exit']) - the cross-process lease is not serializing the terminal
1 failed, 24 deselected in 32.29s
```
Restore: `cp` from the backup, then `cmp -s` printed `cmp_exit=0`. GREEN re-run: `1 passed, 24 deselected in 26.47s` (the same final run covers both restores; `git status --short` was empty after each restore). No `git checkout`, `git restore` or `git stash` was used.

## Verification

- Lease-related modules (31 `tests/test_*.py` files that name `mt5_terminal_lease`, `_mt5_terminal_lock_for` or `mt5_concurrency`, including roster, fence, handover, derive, relogin, scrub, liveness, validate): `2173 passed, 1 skipped` at the final code state. The one skip was already present in the first run at Task 1 (before any test of this plan had a skip) and is not from this plan's files.
- Source-scanning gates (`test_live_db_reach_roster`, `test_live_db_transport`, `test_structlog_frozen_proxy`, `test_stamp_io_exhaustive`, `test_app_factory_parity`, `test_limiter_identity`, `test_e1_delete_gate`): `261 passed`.
- mypy strict (CI command): `Success: no issues found in 144 source files`, run after each task.
- Acceptance greps: `acquire_terminal_xlease` in `mt5_concurrency.py` 2 lines; `class Mt5TerminalLeaseUnavailableError` 1; `xlease` in `conftest.py` 17; `XPROC-01` in `test_mt5_xlease.py` 3+; `def normalize_mt5_site` 1; `services.mt5_xlease` in `test_mt5_concurrency.py` 1; `mt5_xlease_waited` 3; `_validate_xlease_timing` 3; `mt5_xlease_lost` 1; `CORRECTED 2026-11-25 (Phase 230` 1; `-k "late_grant or cancel or handover"` 4 passed.
- `verify-plan-anchors.mjs` on this plan: OK, exit 0.

## Deviations from Plan

**1. [Rule 3 - Blocking] `tests/test_mt5_terminal_scrub.py` queue-order test snapshots its scheduled task**
- **Found during:** Task 1 wide run.
- **Issue:** `test_TERMINAL_SCRUB_the_scheduled_scrub_takes_the_lock_BEFORE_a_later_lease` drained the live `_SCRUB_TASKS` set after the competitor finished. The lease's release now awaits one bounded RPC before freeing the lock, which moves the scrub's completion ahead of the competitor's, so the set was already empty (`no scrub task was scheduled`).
- **Fix:** snapshot the scheduled tasks right after `schedule_validation_terminal_scrub` and gather the snapshot. The ordering assertion (`seen_by_competitor == [1]`) is unchanged.
- **Files modified:** `analytics-service/tests/test_mt5_terminal_scrub.py` (not in the plan's file list). **Commit:** `aeabe117b`.

**2. [Rule 2 - Missing critical] Session-scoped autouse default in `conftest.py` in addition to the function-scoped one**
- **Found during:** pre-wiring grep. Module- and session-scoped fixtures (for example `measured_payload` in `test_allocator_equity_writer_basis.py`) run a whole MT5 derive before any function-scoped patch exists, so a function-scoped fixture alone would leave T-230-08 open for them.
- **Fix:** a session fixture installs the granting backend and the refusing `get_supabase`; the function fixture gives each test a fresh recording backend. **Commit:** `aeabe117b`.

**3. Implementation choices that differ from the plan's wording (behaviour as specified)**
- Acquire awaits the in-flight future with `asyncio.wait({fut}, timeout=...)` instead of `wait_for(shield(fut), ...)`. Same guarantee (the call outlives its awaiter, timeout and cancellation do not cancel it) without conflating a backend-raised `TimeoutError` with the bound.
- One constant beyond DEC-02-E: `_MT5_XLEASE_MIN_ATTEMPT_S = 0.5`, the least a single acquire RPC is given when the remaining bound is nearly spent (advisor-flagged risk: `wait_for` with about 0 s left can time out before the RPC future runs and turn a free lease into busy). Proven by `test_a_spent_bound_makes_exactly_one_attempt_and_a_free_lease_is_granted` at the client level.
- `normalize_mt5_site` was added in Task 1 (Task 2 lists it) because the client needed a public name from the start.
- "Exactly one database attempt when the local wait consumed the whole `wait_s`" is proven at the client (`bound_s <= 0`), not through `mt5_terminal_lease(wait_s=0.0)`: the existing local stage uses `wait_for(lock.acquire(), 0.0)`, which raises busy even for a free local lock on Python 3.12. That behaviour predates this plan and was left alone. The one-deadline arm through the lease uses a 1.0 s bound with the local lock freed at 0.6 s.
- RESEARCH Pattern 1 and PATTERNS order the database release after `lock.release()`; this plan's DEC-02-A overrides that and was followed (reason in the `finally` comment).

## Known Stubs

None.

## Threat Flags

None. The RPC surface is the one plan 01 declares and the plan's threat model covers.

## Open issues

- The full analytics suite was not run end to end (an estimated 40 minutes on the shared machine). The 31 lease-related modules and the source-scanning gates above were.
- `pytest -n 4` in this checkout reported `no tests ran` for the lease module list; the runs above are serial. Not investigated (outside this plan).
- Plan 04 owns the missing-RPC fallback and the error budget; this plan fails closed on every backend exception.

## Self-Check: PASSED

- Files exist: `services/mt5_xlease.py`, `tests/xlease_fakes.py`, `tests/test_mt5_xlease.py`, this SUMMARY.
- Commits present on `gsd/phase-230-plan-02`: `aeabe117b`, `08664a706`, `6ffd0e3d0`, `9f03fda14`, `d97245871` (`rev-list --count` from the ledger base: 5).
- `STATE.md` and `ROADMAP.md` untouched.
