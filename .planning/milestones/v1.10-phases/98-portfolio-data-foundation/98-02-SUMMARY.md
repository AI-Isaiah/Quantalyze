---
phase: 98-portfolio-data-foundation
plan: 02
subsystem: api
tags: [portfolio-analytics, postgrest, 23505, unique-violation, concurrency, cron, fastapi]

# Dependency graph
requires:
  - phase: 98-portfolio-data-foundation (plan 01)
    provides: partial UNIQUE index portfolio_analytics_one_computing_per_portfolio (the fence that raises 23505 on the losing racer)
provides:
  - 23505 detection at the single computing-row INSERT choke point in _compute_portfolio_analytics -> HTTPException 409
  - cron _guarded_recompute 409 -> in_flight outcome bucket branch
  - failing-first pytest cases pinning the 23505->409/in_flight contract and the narrow-swallow (non-23505 propagates)
affects: [portfolio-analytics, cron-recompute, PI-07]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Absorb the DB-fence unique-violation (23505) at the single write choke point and map it to pre-existing 409/in_flight semantics — zero new statuses, zero broadened swallows"
    - "Reuse the repo's own APIError code/msg 23505 detection (getattr(exc,'code') + text fallback), never import psycopg error classes"

key-files:
  created: []
  modified:
    - analytics-service/routers/portfolio.py
    - analytics-service/routers/cron.py
    - analytics-service/tests/test_portfolio_compute_integration.py

key-decisions:
  - "Single choke point: 23505 caught AT the computing-row INSERT inside _compute_portfolio_analytics; the public POST route propagates the resulting 409 with zero route changes"
  - "409 detail string is byte-identical to the pre-existing in-flight 409 (portfolio.py in_flight pre-SELECT) — no new user-facing string"
  - "cron 409->in_flight branch placed BEFORE the 400-skip branch, reusing the existing in_flight bucket/counter; no new RecomputeStatus literal"
  - "Non-23505 insert errors re-raise bare (fail-loud); Test C pins this so the fix cannot silently broaden the swallow"

patterns-established:
  - "Pattern: fence working != error — a 23505 from a partial UNIQUE index is logged at info (not error) and mapped to graceful in-flight semantics"

requirements-completed: [PI-07]

# Metrics
duration: ~12min
completed: 2026-07-12
---

# Phase 98 Plan 02: PI-07 Losing-Racer 23505 -> 409/in_flight Summary

**The PI-07 partial-UNIQUE fence's losing racer is now absorbed into the pre-existing 409 (public) / in_flight (cron) semantics at the single computing-row INSERT choke point — never a 500 or a failed bucket.**

## Performance

- **Duration:** ~12 min
- **Tasks:** 2 (TDD: RED test task + implementation task)
- **Files modified:** 3

## Accomplishments
- Caught SQLSTATE 23505 at the sole `computing`-row INSERT in `_compute_portfolio_analytics`, mapping it to `HTTPException(409, "Analytics computation already in progress for this portfolio")` — byte-identical to the existing in-flight 409, so the public POST route needed zero changes.
- Added a `409 -> (pid, "in_flight", None)` branch to cron `_guarded_recompute`, placed before the 400-skip branch, reusing the existing `in_flight` bucket and counter (no new status literal).
- Pinned the full contract with four failing-first tests: code-attr 23505 -> 409, message-fallback 23505 -> 409, non-23505 propagates unchanged (narrow-swallow / fail-loud), and cron 409 -> in_flight bucket.

## Task Commits

1. **Task 1: Failing-first tests (RED)** - `0e782cf5` (test)
2. **Task 2: 23505->409 at INSERT + cron 409->in_flight** - `17eeafd6` (feat)

**Plan metadata:** committed separately with this SUMMARY.

## Files Created/Modified
- `analytics-service/routers/portfolio.py` - Wrapped ONLY the computing-row INSERT in try/except; on 23505 (repo's own `getattr(exc,"code")` + msg-fallback detection) log info + raise 409; non-23505 re-raised bare. `grep -n 23505 routers/portfolio.py` now shows the new detection at the INSERT (line 666) in addition to the pre-existing rebalance_drift site (line 1540).
- `analytics-service/routers/cron.py` - Added the `status_code == 409 -> in_flight` branch inside the existing `except HTTPException`, before the 400-skip check (line 944 -> returns in_flight at 950).
- `analytics-service/tests/test_portfolio_compute_integration.py` - Added `TestPi07LosingRacer23505` (Tests A/B/C) and `TestPi07CronLosingRacerInFlightBucket` (Test D); added `HTTPException`/`AsyncMock` imports and a `_StubApiError` mirroring the PostgREST APIError shape.

## RED -> GREEN Evidence

**RED (after Task 1, before Task 2):** `3 failed, 1 passed, 27 deselected`
- Test A (`test_23505_code_attr_maps_to_409`) — FAILED: raw `_StubApiError` propagated (no handling) instead of `HTTPException`.
- Test B (`test_23505_message_fallback_maps_to_409`) — FAILED: same raw-propagation reason.
- Test D (`test_cron_409_lands_in_in_flight_not_failed`) — FAILED: `assert pr["in_flight"] == 1` was `0 == 1`; the 409 landed in the `failed` bucket (`ERROR ... Portfolio recompute failed for p1 (HTTPException 409)`).
- Test C (`test_non_23505_insert_error_propagates_unchanged`) — PASSED (pre-fix baseline: non-23505 propagates unchanged).

**GREEN (after Task 2):** `71 passed in 2.07s` across `tests/test_portfolio_compute_integration.py tests/test_cron_router.py` — all four new tests pass; zero previously-passing tests regressed.

## Decisions Made
None beyond the planner-locked D-P6 design — implemented exactly as specified. One micro-choice: used `raise HTTPException(...) from exc` to chain the original PostgREST error as `__cause__` (server-side traceback only; does not affect the fixed 409 detail string or T-98-06 info-disclosure posture).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Test D is co-located in `test_portfolio_compute_integration.py` per the plan's `<files>` spec but exercises the cron path via `cron_sync()`; it reuses the sibling `tests.test_cron_router` helpers (`_make_mock_supabase_for_cron_sync`, `_stub_validation`) — a clean cross-import since `tests/` is a package (`tests/__init__.py`, `pythonpath = .`).

## Threat Model Coverage
- **T-98-04 (DoS, losing racer 500s):** mitigated — 23505 -> 409 at the single INSERT choke point.
- **T-98-05 (misclassification of real insert failures):** mitigated — narrow code/msg detection; non-23505 bare re-raise; Test C pins it.
- **T-98-06 (error detail leakage):** mitigated — 409 detail is the existing fixed string; raw DB error only logged server-side / chained as `__cause__`.
- No new security surface introduced (no new endpoints, auth paths, or schema changes on the code side).

## User Setup Required
None - no external service configuration required. (Migration side is plan 98-01, which auto-applies to prod on merge.)

## Next Phase Readiness
- The PI-07 code side is complete and green. It is a co-requisite of the 98-01 index migration: once that index is live in prod, the losing racer is gracefully absorbed. Both sides should ship together (or the migration first) so the code is ready the moment the fence exists.

## Self-Check: PASSED

- Files verified present: 98-02-SUMMARY.md, routers/portfolio.py, routers/cron.py, tests/test_portfolio_compute_integration.py
- Commits verified in git history: 0e782cf5 (test), 17eeafd6 (feat)

---
*Phase: 98-portfolio-data-foundation*
*Completed: 2026-07-12*
