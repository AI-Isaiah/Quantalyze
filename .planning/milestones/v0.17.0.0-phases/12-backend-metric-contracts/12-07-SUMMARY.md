---
phase: 12-backend-metric-contracts
plan: 07
subsystem: infra
tags: [analytics-service, compute_jobs, supabase-rpc, priority-queue, throttle, asyncio]

# Dependency graph
requires:
  - phase: 12-backend-metric-contracts
    provides: "Plan 12-02 shipped migration 086 (claim_compute_jobs_with_priority RPC + priority enum + partial index) — this plan wires the worker call site to that RPC."
provides:
  - "analytics-service/main_worker.py.dispatch_tick now calls claim_compute_jobs_with_priority (migration 086) — backfill (priority='low') is automatically deferred when any normal/high pending job exists, atomically via FOR UPDATE SKIP LOCKED inside the SQL claim path."
  - "Phase 12 SC#4 met: live sync_trades will not queue behind backfill on Phase 12 deploy."
  - "Two new regression tests in tests/test_main_worker.py asserting the exact RPC name and parameter shape — wrong RPC name fails the suite."
affects: [12-08-METRICS-14-enqueuer, 12-10-deploy, 14a-strategy-page-eager, 14b-strategy-page-lazy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Throttle in claim path, not dispatch path (12-RESEARCH.md §5d): the SQL RPC decides which rows can be claimed this tick; by the time dispatch() runs, the row is already locked. Worker-side throttling primitives are not needed."
    - "Same FOR UPDATE SKIP LOCKED concurrency primitive across legacy and priority-aware claim — disjoint result sets across replicas are preserved."

key-files:
  created: []
  modified:
    - "analytics-service/main_worker.py — dispatch_tick swapped to claim_compute_jobs_with_priority + module docstring updated."
    - "analytics-service/tests/test_main_worker.py — two new tests (test_dispatch_tick_calls_priority_rpc, test_dispatch_tick_priority_rpc_param_shape); three existing TestDispatchTick side-effect dispatchers updated to recognise the new RPC name."

key-decisions:
  - "Mirror existing TestDispatchTick conventions over the plan's draft test snippet. The plan illustrated using monkeypatch + mocking db_execute; the existing test class uses patch('main_worker.get_supabase', ...) and lets the real db_execute run the lambda. Tests follow the established pattern; semantics are identical."
  - "Add a second test (test_dispatch_tick_priority_rpc_param_shape) verifying the parameter shape is preserved (p_batch_size=5, p_worker_id). Migration 086 keeps the same signature as legacy, but a wrong shape would surface as a PostgREST runtime error even with the correct RPC name — explicitly asserting it makes that failure mode catchable in the unit suite."
  - "Update existing tests' side_effect dispatchers (3 of them) to recognise the new RPC name as a Rule 3 fix. After the swap the legacy name no longer reaches them, so without the update they would fall through to the mark_chain branch and break."
  - "Update the module docstring at main_worker.py:5-8 to reference claim_compute_jobs_with_priority instead of claim_compute_jobs (Rule 1 alignment — narrative drifted from the new behaviour)."

patterns-established:
  - "Pattern: claim-path throttling. RPC ORDER BY priority precedence + a CASE-driven exclusion of priority='low' rows when any normal/high pending row exists. Atomic in SQL; no Python-side rate limiting required. Rollback = revert the one-line RPC name change."
  - "Pattern: narrow grep acceptance gate (per H-04 from 12-REVIEWS.md). Acceptance check uses grep 'supabase.rpc(\"claim_compute_jobs\",' — won't false-positive on docstrings, comments, or log strings; only matches an actual call site."

requirements-completed: [METRICS-14]

# Metrics
duration: ~7min
completed: 2026-04-28
---

# Phase 12 Plan 07: Priority-aware claim throttle — switch dispatch_tick to claim_compute_jobs_with_priority Summary

**dispatch_tick now claims jobs via migration 086's claim_compute_jobs_with_priority RPC, atomically deferring priority='low' backfill rows whenever any normal/high pending row exists — Phase 12 SC#4 (live sync_trades does not queue behind backfill on deploy) is now satisfied without any Python-side rate limiter.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-28T12:34:51Z
- **Completed:** 2026-04-28T12:38:05Z
- **Tasks:** 1 (TDD: RED → GREEN; no REFACTOR needed)
- **Files modified:** 2

## Accomplishments

- `dispatch_tick` swapped to `claim_compute_jobs_with_priority` RPC (migration 086).
- Throttle policy (D-06: 5 backfill jobs/min when normal/high pending) now delivered atomically in the claim path via the RPC's `(v_high_pending = 0 OR priority IN ('normal','high'))` guard + ORDER BY priority precedence; no Python-side rate limiter required.
- Module docstring updated so the dispatch loop's narrative reflects the new RPC.
- Two new regression tests assert the new RPC is called with the correct parameter shape and the legacy RPC is not called.

## Task Commits

Each step committed atomically:

1. **Task 1 (RED): failing test for priority-aware dispatch_tick** — `4504133` (test)
2. **Task 1 (GREEN): switch dispatch_tick to priority-aware claim RPC** — `b47ca61` (feat)

_REFACTOR was not needed — the swap is a single-line semantic change with no follow-up cleanup beyond the docstring update folded into GREEN._

## Files Created/Modified

- `analytics-service/main_worker.py` — `dispatch_tick` now calls `supabase.rpc("claim_compute_jobs_with_priority", {"p_batch_size": 5, "p_worker_id": worker_id})`. Inline comment cites Phase 12 / METRICS-14 / D-06 + the 12-RESEARCH.md §5d throttle-location correction. Module docstring (lines 5-10) reflects the new RPC name.
- `analytics-service/tests/test_main_worker.py` — appended `test_dispatch_tick_calls_priority_rpc` (asserts new name is called and legacy name is not) and `test_dispatch_tick_priority_rpc_param_shape` (asserts `{"p_batch_size": 5, "p_worker_id": ...}` shape is preserved). Three existing TestDispatchTick side-effect dispatchers (`test_three_jobs_all_done`, `test_dispatch_raising_exception_marks_failed`, `test_dispatch_deferred_no_mark`) updated to recognise the new RPC name; without that change they would fall through to the `mark_chain` branch and break.

## Decisions Made

- **Test patterning:** Follow existing `TestDispatchTick` conventions (`patch("main_worker.get_supabase", ...)` + real `db_execute`) rather than the plan's draft snippet (`monkeypatch` + mocked `db_execute`). The plan's snippet was illustrative; the existing pattern is the codebase convention and produces the same coverage.
- **Second test for parameter shape:** Added beyond the plan's specified test because the new RPC keeps the same signature as the legacy one — a future regression that called the right name with the wrong shape would surface as a PostgREST runtime error today. Pinning the shape in a unit test catches the regression immediately.
- **Atomicity argument:** The claim_compute_jobs_with_priority RPC uses `FOR UPDATE SKIP LOCKED` (migration 086 STEP 3) — the same primitive as legacy claim_compute_jobs (032). Two worker replicas hitting it concurrently still get disjoint result sets. No new concurrency surface introduced.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated three existing TestDispatchTick side-effect dispatchers**
- **Found during:** Task 1 GREEN (running pytest after the production swap)
- **Issue:** `test_three_jobs_all_done`, `test_dispatch_raising_exception_marks_failed`, and `test_dispatch_deferred_no_mark` each have a `_rpc_side_effect(name, params)` mini-dispatcher that branches on `name == "claim_compute_jobs"`. After swapping production code to `claim_compute_jobs_with_priority`, the legacy branch never matches — the claim falls through to `mark_chain` (which returns `data=None` instead of `data=jobs`), causing all three tests to fail.
- **Fix:** Updated each dispatcher to branch on the new RPC name `"claim_compute_jobs_with_priority"`. Semantics preserved.
- **Files modified:** `analytics-service/tests/test_main_worker.py`
- **Verification:** pytest 11/11 passing.
- **Committed in:** `b47ca61` (folded into GREEN commit; Rule 3 fix is part of the "make the production swap land cleanly" delta).

**2. [Rule 1 - Bug] Updated module docstring narrative**
- **Found during:** Task 1 GREEN (post-swap audit of comments/docstrings for narrative drift)
- **Issue:** The module docstring at `main_worker.py:5-8` described the dispatch loop as "claims pending jobs via claim_compute_jobs(batch=5, worker_id)" — after the swap, this is no longer the actual behaviour. Stale docstrings are a documented bug class (next reader is misled about which RPC fires).
- **Fix:** Rewrote lines 5-10 to name `claim_compute_jobs_with_priority`, cite migration 086, and reference Phase 12 / METRICS-14 for traceability.
- **Files modified:** `analytics-service/main_worker.py`
- **Verification:** Read by inspection.
- **Committed in:** `b47ca61` (folded into GREEN commit).

**3. [Rule 2 - Missing Critical] Added parameter-shape regression test**
- **Found during:** Task 1 RED (drafting tests; reviewing the migration 086 RPC signature).
- **Issue:** The plan spec required a test that asserts the new RPC name is called and the legacy name is not. That catches the obvious regression (wrong name) but not the subtle one (right name, wrong shape). Migration 086 keeps the same `(p_batch_size, p_worker_id)` signature as legacy, but if a future change altered batch_size in production code without updating the migration, the bug would surface only at PostgREST runtime — not in CI.
- **Fix:** Added `test_dispatch_tick_priority_rpc_param_shape` asserting `{"p_batch_size": 5, "p_worker_id": "worker-test-shape"}` exactly.
- **Files modified:** `analytics-service/tests/test_main_worker.py`
- **Verification:** Test passes. Forms a contract: any future change to the RPC signature must be reflected in production code AND the test, in the same commit.
- **Committed in:** `4504133` (RED) + `b47ca61` (GREEN).

---

**Total deviations:** 3 auto-fixed (1 blocking, 1 bug, 1 missing critical)
**Impact on plan:** All three are necessary corrections — Rule 3 prevents three pre-existing tests from breaking, Rule 1 keeps the docstring honest about runtime behaviour, Rule 2 adds a regression test that pins shape parity. No scope creep beyond the plan boundary (`analytics-service/main_worker.py` + `analytics-service/tests/test_main_worker.py`).

## Issues Encountered

None — TDD cycle was clean. RED reproduced as expected (got `claim_compute_jobs`, expected `claim_compute_jobs_with_priority`); GREEN landed in one swap.

## User Setup Required

None — no external service configuration required. The migration 086 RPC was shipped to remote in Plan 12-02 with H-B `search_path=public, pg_temp` hardening; this plan only changes which RPC the worker calls.

## Next Phase Readiness

- Plan 12-08 (METRICS-14 throttled enqueuer) is unblocked: the worker is now priority-aware. The enqueuer just needs to mark backfill jobs as `priority='low'` and the claim path automatically defers them when sync_trades is queued.
- Plan 12-10 (deploy script) is unblocked for the throttle dimension: the worker call-site is in place; deploy script can re-enqueue published strategies as `priority='low'` without risking sync_trades starvation.
- No concerns for Phase 14a/14b — those phases consume sibling-table data (Plan 12-02) and metric scalars (Plans 12-04..06); they don't touch the worker claim path.

## Self-Check: PASSED

- Files claimed created/modified — verified on disk:
  - `analytics-service/main_worker.py` — exists, contains `claim_compute_jobs_with_priority` (line 111).
  - `analytics-service/tests/test_main_worker.py` — exists, contains both new tests.
- Commit hashes claimed — verified in git log:
  - `4504133` — present (RED).
  - `b47ca61` — present (GREEN).
- Acceptance criteria — verified:
  - `grep -q "claim_compute_jobs_with_priority" analytics-service/main_worker.py` → match.
  - `grep -q 'supabase.rpc("claim_compute_jobs",' analytics-service/main_worker.py` → no match (M-04 narrow grep satisfied).
  - `pytest tests/test_main_worker.py::TestDispatchTick::test_dispatch_tick_calls_priority_rpc -x` → 1 passed.
  - Full file suite: `pytest tests/test_main_worker.py` → 11 passed.

---
*Phase: 12-backend-metric-contracts*
*Completed: 2026-04-28*
