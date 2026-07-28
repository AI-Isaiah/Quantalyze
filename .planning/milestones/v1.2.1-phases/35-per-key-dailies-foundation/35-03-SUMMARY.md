---
phase: 35-per-key-dailies-foundation
plan: 03
subsystem: infra
tags: [python, backfill, compute-jobs, derive-broker-dailies, supabase, idempotent, pytest]

requires:
  - phase: 35-per-key-dailies-foundation
    provides: dual-mode derive job + derive_broker_dailies api_key coherence arm (Plan 02)
provides:
  - scripts/phase35_backfill_enqueue.py — one api_key-scoped derive_broker_dailies job per active connected exchange key
  - idempotent, 23505-safe, fail-loud enqueue (mirror of phase12_backfill_enqueue)
affects: [36 per-key reads — this populates the dark store for historical keys]

tech-stack:
  added: []
  patterns:
    - "Enqueue-based idempotent backfill: pre-check guard + ONE atomic bulk INSERT + (api_key_id, kind) in-flight partial unique index (23505 abort) + non-zero exit on any skip"
    - "PostgREST IS DISTINCT FROM via .or_('sync_status.is.null,sync_status.neq.revoked') so NULL-sync_status active keys are included (plain .neq drops NULLs)"

key-files:
  created:
    - analytics-service/scripts/phase35_backfill_enqueue.py
    - analytics-service/tests/test_phase35_backfill_enqueue.py
  modified: []

key-decisions:
  - "Role-agnostic predicate (no profiles.role filter) per A1 — the per-key axis is key-identity, not role-identity"
  - "Use .or_() (not bare .neq) for sync_status so never-synced active keys (NULL) are included — this is load-bearing and test-pinned"
  - "Pre-check scopes to api_key_id NOT NULL via .not_.is_('api_key_id','null') so strategy-scoped derive jobs don't suppress the per-key backfill"

patterns-established:
  - "Faithful adaptation of phase12_backfill_enqueue (same fail-loud invariants: count-None RuntimeError, data-None RuntimeError, defensive id extraction, atomic bulk INSERT, 23505 catch, exit-union)"

requirements-completed: [DAILIES-03]

duration: ~5min
completed: 2026-06-24
---

# Phase 35 Plan 03: Per-key dailies backfill Summary

**scripts/phase35_backfill_enqueue.py enqueues exactly one api_key-scoped derive_broker_dailies job per active connected exchange key — idempotent (pre-check + atomic bulk INSERT + (api_key_id, kind) in-flight unique index), 23505-safe, and fail-loud (non-zero exit on any skip/race/partial).**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-06-24T14:40:19Z (phase window)
- **Completed:** 2026-06-24T14:54:51Z (phase total)
- **Tasks:** 1 (script + unit test)
- **Files modified:** 2 (both created)

## Accomplishments
- Wrote `phase35_backfill_enqueue.py` mirroring the proven `phase12_backfill_enqueue.py` shape, swapping: pre-check counts pending `derive_broker_dailies` with `api_key_id NOT NULL`; the source select is `api_keys` with the active-connected predicate; the bulk rows carry `api_key_id + kind='derive_broker_dailies'` and never set `strategy_id`.
- Encoded `sync_status IS DISTINCT FROM 'revoked'` faithfully via `.or_("sync_status.is.null,sync_status.neq.revoked")` so NULL-sync_status (never-synced) active keys are INCLUDED — a plain `.neq` would drop them.
- Added `test_phase35_backfill_enqueue.py` (10 tests): per-key payload shape + no strategy_id, the NULL-sync_status inclusion filter (load-bearing), api_key-scoped pre-check, idempotent skip, count-None/data-None RuntimeError, malformed-row skip + non-zero exit, 23505 atomic rollback, non-race failure.

## Task Commits

1. **Task 1 (backfill script + unit test):** `84d3d52e` (feat).

## Files Created/Modified
- `analytics-service/scripts/phase35_backfill_enqueue.py` - operator-run per-key derive backfill (run via `railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"`).
- `analytics-service/tests/test_phase35_backfill_enqueue.py` - DAILIES-03 unit proofs.

## Decisions Made
- Role-agnostic key predicate (A1); `.or_()` for NULL-inclusive sync_status filter; pre-check scoped to api_key_id NOT NULL.
- mypy posture matches the phase12 precedent EXACTLY (both have the single `payload: list[dict]` type-arg nit; scripts are not in the CI mypy gate — Rule 11, do not diverge from precedent).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test bug] Corrected a skip-count assertion in my own test**
- **Found during:** Task 1 (test authoring)
- **Issue:** `test_malformed_rows_skipped_valid_rows_enqueued` asserted "2 api_key rows skipped" but the malformed fixture has 3 invalid rows (missing-id, empty-id, not-a-dict). The SCRIPT correctly reported "3 ... skipped".
- **Fix:** Updated the assertion to "3 api_key rows skipped" (the script was correct; the test expectation was wrong).
- **Files modified:** analytics-service/tests/test_phase35_backfill_enqueue.py
- **Verification:** 10/10 backfill tests green.
- **Committed in:** 84d3d52e (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (test-expectation bug in my own new test; the script logic was correct).
**Impact on plan:** None — fix-loud behavior of the script is preserved and tested.

## Issues Encountered
- `.or_` / `.not_` are not used elsewhere in `services/`, so I verified they exist on the pinned postgrest 1.0.2 filter builder (`.or_` method, `.not_` property → chainable `.is_`) and mocked them faithfully in the unit test (the chain records emitted filters so the predicate is pinned).

## User Setup Required
None for code. Operator action (non-blocking, post-merge): run `railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"` against prod to backfill historical keys; confirm per-key rows appear after the worker drains (recorded in 35-VALIDATION.md Manual-Only).

## Next Phase Readiness
- The dark per-key store will be populated for historical keys after the operator runs the backfill. Phase 36 begins reading per-key series into Overview.

---
*Phase: 35-per-key-dailies-foundation*
*Completed: 2026-06-24*

## Self-Check: PASSED

All created files exist on disk; all task commits (37cc14c7, 17f6f425, 84d3d52e) found in git log.
