---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 08
subsystem: analytics-worker
tags: [python, worker, compute-jobs, claim-fence, lease-renewal, heartbeat, attempt-ledger, sentry]
status: complete

requires:
  - phase: 227-03
    provides: "public.renew_compute_job_claims(uuid[], uuid[]) RETURNS SETOF uuid, service_role only"
  - phase: 227-01
    provides: "public.record_compute_job_attempt_error(uuid, uuid, text, text) RETURNS boolean, service_role only"
provides:
  - "main_worker._renew_claims / _is_missing_rpc: renew RPC call, missing-RPC (42883 / PGRST202) detection, once-per-process log"
  - "pre-dispatch claim fence in dispatch_tick (claim_fence_skip, claim_fence_renew_error)"
  - "heartbeat renewal of the still-waiting jobs, bounded and throttled, never the running job"
  - "main_worker._record_attempt_error on the 55P03 and late-55006 lost-mark paths"
  - "first-hop-sweep heal capture to Sentry, once per heal"
affects: [227-10 (census pins, runbook, TODOS deletion of 166.5.1-DERIVE-BATCH-RESET-RESIDUAL)]

plan_head_before: ea58d5f028a48b017d17b3c6546543fa4ff5ad78
plan_head_after: 7a4965562fe7ae5648f9bfb29b68624130ddff2e
commits: 4

actuals:
  tokens: 14500
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "renew-then-check-membership: the renew RPC returns the ids it renewed, so membership in the answer is ownership"
    - "fail closed on an unknown renew error, open on a missing RPC (DEC-08-A)"
    - "heartbeat side work is bounded (wait_for) and swallowed-with-log so it can never freeze the healthz stamp or end its task"

key-files:
  created: []
  modified:
    - analytics-service/main_worker.py
    - analytics-service/tests/test_main_worker.py
    - analytics-service/tests/test_compute_jobs_fencing.py
    - analytics-service/tests/test_derive_silent_failure_f1_f4_f7.py

key-decisions:
  - "DEC-08-A to DEC-08-D as recorded in the plan (fail closed on unknown renew error and open on missing RPC; never renew the running row; 120 s interval validated at import against the smallest watchdog threshold; RESIDUAL comment pointer moved with a dated line, lineage kept)"
  - "The renew goes through db_execute, not db_read_with_retry: that helper's docstring names the watchdog reset and the job claim as its only write consumers and says no other write gains a retry, and a retried ReadTimeout can cost about 6 minutes on the dispatch loop"
  - "The heartbeat's renew call is bounded by _CLAIM_RENEW_TIMEOUT_S (20 s), an addition beyond the plan, so a hung renew cannot hold the healthz stamp past STALE_THRESHOLD"

requirements-completed: [HEAL-02]

coverage:
  - id: D1
    description: "A job whose claim the watchdog took is skipped before dispatch and logged claim_fence_skip; a missing renew RPC (42883 or PGRST202) dispatches as before and logs once; an unknown renew error skips that one job and the loop continues; a tokenless job dispatches as before"
    requirement: "HEAL-02"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestClaimFence (5 tests collected)"
        status: pass
    human_judgment: false
  - id: D2
    description: "While a job runs the heartbeat renews only the waiting jobs, throttled to _CLAIM_RENEW_INTERVAL_S, bounded, and a failing renew never escapes; the interval is validated at import"
    requirement: "HEAL-02"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestHeartbeatClaimRenewal (5 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A real error whose mark could not land (55P03, late 55006 on mark_failed or its fallback) is recorded through record_compute_job_attempt_error, never on mark_done, never raising into the loop; a first-hop-sweep claim alerts once"
    requirement: "MT5D-01"
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_main_worker.py::TestAttemptErrorRecording (7 tests) and ::TestFirstHopHealAlert"
        status: pass
    human_judgment: false
  - id: D4
    description: "Worker half against the real RPCs (a live batch whose waiting job is renewed past 20 minutes and is not reset; a stale-token renew refused by the database)"
    requirement: "HEAL-02"
    verification: []
    human_judgment: true
    rationale: "The database half is proven by plan 03's SQL gate arms R1 and R2 on the pg-lane; no live-DB worker test ran here (Docker unavailable). CI's live-DB lane runs test_compute_jobs_fencing.py."

duration: 115min
completed: 2026-11-23
---

# Phase 227 Plan 08: Worker claim fence, heartbeat renewal, lost-mark error record Summary

**dispatch_tick renews the claims of the job it is about to run and of every job waiting behind it, skips a job the watchdog already took, keeps the waiting claims fresh from its heartbeat, and records the real error through `record_compute_job_attempt_error` when the failed mark could not land.**

## Accomplishments

- **Fence (Task 1, tracer).** `_renew_claims` calls `renew_compute_job_claims` with `p_job_ids` and `p_claim_tokens` and returns the set of renewed ids, or `None` when the RPC is missing (42883 structured, or PGRST202 on `.code` or `.details["code"]`, logged once per process as `claim_renew_unavailable`). Before each tokened dispatch the loop renews the current job plus every later tokened job; a current job absent from the answer is skipped with `claim_fence_skip` (WARNING, job_id, kind, worker_id), an exception skips that one job with `claim_fence_renew_error` (ERROR). A tokenless job dispatches as before. Every line of the loop below the fence is unchanged except `for index, job in enumerate(jobs)`.
- **Heartbeat (Task 2).** `_CLAIM_RENEW_INTERVAL_S = 120.0`, validated at import by `_validate_claim_renew_interval` against `_SMALLEST_WATCHDOG_THRESHOLD_S` (300 s today, `poll_positions`), raising `ValueError` on 0 or a value at or above it. The existing `_heartbeat` keeps the healthz stamp first and unchanged, then every interval renews the waiting list (bound at creation through default arguments), never the running job. A failure logs `claim_renew_heartbeat_failed` (WARNING) and never raises. The RESIDUAL comment on `WATCHDOG_PER_KIND_OVERRIDES["derive_allocator_equity"]` and the docstring in `test_main_worker.py` each gained a dated line saying Phase 227 HEAL-02 closed `[166.5.1-DERIVE-BATCH-RESET-RESIDUAL]`; the original text stays as lineage.
- **Lost-mark record (Task 3).** `_record_attempt_error(job_id, claim_token, error, error_kind)` calls `record_compute_job_attempt_error` through `db_execute`, returns at once without a token, and logs and swallows every exception as `attempt_error_record_failed`. It is called after the `MARK_FAILED_LOCK_BOUND` log (55P03), where `_safe_mark` returns True for the `mark_failed` label (read at the call site, `_safe_mark`'s contract untouched), and for the `mark_failed (fallback)` label. Not on `mark_done`.
- **First hop.** The claim-time heal capture now also fires for metadata source `first-hop-sweep` (surface tag `first-hop-sweep`, message "Dropped first sync_trades enqueue healed by first-hop sweep"), de-duped on the same `_reconcile_heal_key`, same try/except and loud log. The reconcile-sweep message and tag are byte-identical and the `== "reconcile-sweep"` comparison pin in `TestReconcileSweepMarkerContract` still passes.

## Task Commits

1. **Task 1 (tracer): pre-dispatch claim fence** - `0c916ed7d`
2. **Task 2: heartbeat renewal** - `70150a6e1`
3. **Task 3: lost-mark attempt-error record, first-hop capture** - `cbce476cb`
4. **Fixtures in two other suites answer the renew RPC** - `7a4965562`

Measured from the ledger: `git rev-list --count ea58d5f028a48b017d17b3c6546543fa4ff5ad78..HEAD` = 4 at `7a4965562fe7ae5648f9bfb29b68624130ddff2e` (before this SUMMARY's own commit). Tracked changes: 1012 insertions, 10 deletions over 4 files.

**Seam choice (the plan asked to say which):** `db_execute`, not `db_read_with_retry`. `db_read_with_retry`'s docstring names the watchdog reset and the job claim as its only write consumers and says no other write gains a retry; a retried ReadTimeout costs about 6 minutes, which the dispatch loop must not spend on the renew. The renew is idempotent, so the choice is about time, not safety. A transient renew failure costs one skipped job and latency.

## PROOF-01 transcripts

Every gate: new tests written first and seen RED, then implementation, then the production line neutered from a byte backup (`cp` to a scratch file, `cmp -s` ok), the named test seen RED, restore by `cp`, `cmp` exit 0, then GREEN. Commands run from `analytics-service/` with `.venv/bin/python -m pytest tests/test_main_worker.py -q -p no:cacheprovider -k <class>`.

**Task 1 RED, symbol absent** (the new autouse fixture reads `main_worker._RENEW_UNAVAILABLE_LOGGED`):

```
E       AttributeError: module 'main_worker' has no attribute '_RENEW_UNAVAILABLE_LOGGED'
79 deselected, 5 errors in 35.42s
```

**Task 1 RED, behaviour absent** (flag and `_renew_claims` added, fence not wired):

```
FAILED TestClaimFence::test_claim_fence_skips_job_the_watchdog_took
FAILED TestClaimFence::test_claim_fence_dispatches_when_renew_rpc_missing[42883]
FAILED TestClaimFence::test_claim_fence_dispatches_when_renew_rpc_missing[PGRST202]
FAILED TestClaimFence::test_claim_fence_skips_on_renew_error
4 failed, 1 passed
```

(the passing one is `..._dispatches_tokenless_job`, the positive control.) GREEN after wiring: `5 passed`. Neuters, each restored with `cmp exit=0`:

```
N1 skip arm disabled (`if False and _renewed is not None ...`)
  FAILED TestClaimFence::test_claim_fence_skips_job_the_watchdog_took            1 failed, 4 passed
N2 missing RPC returns set() instead of None
  FAILED TestClaimFence::test_claim_fence_dispatches_when_renew_rpc_missing[42883]
  FAILED TestClaimFence::test_claim_fence_dispatches_when_renew_rpc_missing[PGRST202]   2 failed, 3 passed
```

**Task 2 RED:** 5 failed (all of `TestHeartbeatClaimRenewal`) before the implementation, `89 passed` after the whole file. Neuters:

```
N1 heartbeat also renews the running job          FAILED test_heartbeat_renews_waiting_rows_only            1 failed, 4 passed
N2 throttle removed (`and True`)                  FAILED test_heartbeat_renew_is_throttled                  1 failed, 4 passed
N3 renew exception escapes the heartbeat          FAILED test_heartbeat_renew_error_never_escapes, test_heartbeat_renew_hang_does_not_freeze_healthz   2 failed, 3 passed
N4 no wait_for bound                              FAILED test_heartbeat_renew_hang_does_not_freeze_healthz  1 failed, 4 passed
N5 import-time validator accepts anything         FAILED test_claim_renew_interval_bound                    1 failed, 4 passed
restored: cmp exit=0 after each; three consecutive GREEN runs: 5 passed, 5 passed, 5 passed
```

**Task 3 RED:** 7 failed (`TestAttemptErrorRecording` x6 incl. parametrisation, `TestFirstHopHealAlert` x1) before the implementation, `96 passed` after. Neuters:

```
N1 lock-bound path does not record                FAILED test_lock_bound_failure_records_attempt_error, test_record_attempt_error_never_raises[missing-rpc], [runtime]   3 failed, 4 passed
N2 late 55006 mark_failed does not record         FAILED test_late_mark_failed_records_attempt_error        1 failed, 6 passed
N3 mark_done label also records (wrong label)     FAILED test_late_mark_failed_records_attempt_error        1 failed, 6 passed
N4 record failure escapes into the loop           FAILED test_record_attempt_error_never_raises[missing-rpc], [runtime]   2 failed, 5 passed
N5 first-hop heal not captured                    FAILED test_first_hop_heal_claim_emits_sentry             1 failed, 6 passed
N6 fallback late mark does not record             FAILED test_late_fallback_mark_records_attempt_error      1 failed, 6 passed
restored: cmp exit=0 after each; GREEN: 7 passed
```

## Verification run

| Command | Result |
|---|---|
| `node scripts/verify-plan-anchors.mjs .../227-08-PLAN.md` | OK, 4 claims, exit 0 |
| `pytest tests/test_main_worker.py -q` | 96 passed (79 before this plan) |
| `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (the CI invocation) | Success: no issues found in 142 source files |
| `pytest tests/test_compute_jobs_fencing.py tests/test_derive_silent_failure_f1_f4_f7.py` | 30 passed, 28 skipped (live-DB, see below) |
| `pytest tests/test_job07_reaper_off_worker_loop.py tests/test_worker_load.py tests/test_ledger_refresh_gates.py tests/test_computation_error_provenance_census.py tests/test_legacy_table_not_named.py tests/test_local_worker_prod_guard.py` | 61 passed |
| `pytest tests/test_job_worker.py tests/test_derive_broker_dailies_dualmode.py` | passed (242 passed with the silent-failure file, before its fixture fix) |
| `npx tsx scripts/check-planning-hygiene.ts` | OK |
| acceptance greps on `main_worker.py` | renew_compute_job_claims 4, claim_fence_skip 1, PGRST202 3, _CLAIM_RENEW_INTERVAL_S 6, "Phase 227" 7, record_compute_job_attempt_error 2, first-hop-sweep 2 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two other suites' dispatch_tick fakes read the new fence as "the watchdog took it"**
- **Found during:** final verification across every test file that drives `dispatch_tick`.
- **Issue:** `tests/test_compute_jobs_fencing.py` (six mocked tests) and `tests/test_derive_silent_failure_f1_f4_f7.py` (three) answered every non-claim RPC with empty data. The new fence reads empty data as "no claim is ours" and skipped the job, so the marks never happened. The plan's `files_modified` names only `main_worker.py` and `test_main_worker.py`.
- **Fix:** each fake answers `renew_compute_job_claims` with the ids it was asked about, the realistic "all still ours". Same edit to the two fakes inside `test_main_worker.py` (`_mock_supabase_for` and the contract test's fake).
- **Files modified:** analytics-service/tests/test_compute_jobs_fencing.py, analytics-service/tests/test_derive_silent_failure_f1_f4_f7.py, analytics-service/tests/test_main_worker.py
- **Commit:** `7a4965562` (the two other suites), `0c916ed7d` (the two fakes in test_main_worker.py)

**2. [Rule 2 - Missing critical functionality] The heartbeat's renew call is time-bounded**
- **Found during:** Task 2 design.
- **Issue:** the heartbeat also stamps healthz. An unbounded renew awaited inside it would hold the stamp for as long as the database hung (the PostgREST client read timeout is 120 s, healthz goes stale at 90 s), restarting the worker mid-crawl, the exact failure FLIPRETRY-04 added the heartbeat to prevent.
- **Fix:** `asyncio.wait_for(..., timeout=_CLAIM_RENEW_TIMEOUT_S)` with `_CLAIM_RENEW_TIMEOUT_S = 20.0`; a timeout is an exception the existing swallow-and-log catches. Test: `test_heartbeat_renew_hang_does_not_freeze_healthz`; neuter N4 above proves it bites.
- **Files modified:** analytics-service/main_worker.py, analytics-service/tests/test_main_worker.py
- **Commit:** `70150a6e1`

**3. [Reporting] Renew answer shape and one extra test**
- `_renew_claims` reads the SETOF uuid answer as a JSON array of strings and, defensively, takes the single value of a one-column object so a shape surprise cannot read as "no claim is ours" for every job. Not exercised by a test (the real shape is the array).
- Added `test_late_fallback_mark_records_attempt_error` and `test_record_attempt_error_without_token_is_a_noop` beyond the four named Task 3 tests, covering the fallback-label call site and the tokenless early return the plan specifies.

**Total deviations:** 3 (1 bug, 1 missing critical functionality, 1 reporting). **Impact:** none on scope beyond two extra test-fixture files.

## Left to CI (Docker unavailable on this host)

No live-DB suite ran. The skipped tests are the live-DB parts of `analytics-service/tests/test_compute_jobs_fencing.py` (28 skipped here) and `tests/test_worker_isolation_e2e.py`, which need the local Supabase stack that `scripts/local-stack/run.sh up` boots. The database half of this plan's contract (renew moves only rows under the caller's own token, a stale token renews nothing, the lane arm R1 reproduces a 25-minute batch wait without a reset) is proven by plan 03's SQL gate on the pg-lane; the worker half is proven here against fakes of the RPC's documented contract. Census pins were not touched (plan 10).

## Known Stubs

None.

## Threat Flags

None. The two new RPC calls are the surfaces the plan's threat model names (T-227-23 fail-open on a missing RPC and fail-closed on an unknown error, T-227-24 skip of a job not in the renewed set, T-227-25 error text to a service_role-only ledger and a Sentry event carrying strategy_id and detected_at only).

## Notes for the orchestrator

- `requirements-completed` lists HEAL-02 only (worker and database halves now both exist: plans 03 and 08). MT5D-01 is not marked: plans 02 and 07 and the verifier still own parts of it.
- Recorded, not closed (as the plan flags): a run-twice is still possible if the worker's own loop freezes, without yielding, between the fence and the dispatch call. That window is a few statements long.
- `[166.5.1-DERIVE-BATCH-RESET-RESIDUAL]` is now closed in code; the ship deletes the `TODOS.md` entry and names it in the CHANGELOG (plan 10 / ship, per the project's TODOS rule (b)). The comment pointers in `main_worker.py` and `test_main_worker.py` already say so.
- STATE.md and ROADMAP.md were not touched.

## Self-Check: PASSED

Files found: analytics-service/main_worker.py, analytics-service/tests/test_main_worker.py, analytics-service/tests/test_compute_jobs_fencing.py, analytics-service/tests/test_derive_silent_failure_f1_f4_f7.py. Commits `0c916ed7d`, `70150a6e1`, `cbce476cb`, `7a4965562` are ancestors of HEAD.
