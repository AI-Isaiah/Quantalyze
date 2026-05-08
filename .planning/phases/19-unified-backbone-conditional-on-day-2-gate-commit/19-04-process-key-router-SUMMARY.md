---
phase: 19-unified-backbone-conditional-on-day-2-gate-commit
plan: 04
subsystem: api
tags: [fastapi, slowapi, structlog, pydantic, supabase, secrets-compare-digest, ingestion-adapter, feature-flags]

# Dependency graph
requires:
  - phase: 19-02-migrations-103-107
    provides: transition_strategy_verification RPC, wizard_session_id UNIQUE INDEX, feature_flags kill-switch table, process_key_long compute_jobs kind, log_audit_event_service RPC (migration 058 prerequisite)
  - phase: 19-03-ingestion-adapter-protocol
    provides: IngestionAdapter Protocol, get_adapter() registry, KeySubmissionRequest + VerificationResult dataclasses, 4 concrete adapters (okx/binance/bybit/csv)
provides:
  - "POST /process-key FastAPI router live at analytics-service/routers/process_key.py"
  - "services.feature_flags Python read seam (kill-switch + env var, 30s in-process cache, fail-soft on Supabase outage)"
  - "Wave-2 unified backbone request-response surface; P5 thin adapters in Wave 3 will HTTP-POST against this seam"
  - "H-2 audit_log denominator-is-non-zero invariant — flag-monitor cron in P7 has signal to compute errorRate"
  - "H-3 Supabase outage fail-soft documented and tested in feature_flags.py"
  - "H-11 per-flow_type source whitelist in pydantic body validator (DoS guard)"
  - "H-12 INTERNAL_API_TOKEN no-newline + 64-char regression smoke (regression catch for Day-2 hypothesis #12)"
  - "MC-4 type-aware MetricsSnapshot serializer (dataclasses.asdict + pydantic.model_dump fallback)"
affects: [19-05-thin-adapters, 19-06-worker-dispatch, 19-07-flag-monitor-cron, 19-08-equity-curve-builder, 19-09-fingerprint-v0]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Constant-time bearer-token compare via secrets.compare_digest (mirrors routers/internal.py:117)"
    - "structlog.contextvars.bind_contextvars for request-scoped correlation_id binding"
    - "Pydantic field_validator with cross-field discriminator (per-flow_type source whitelist)"
    - "Idempotent state-machine orchestration: SELECT pre-check + 23505 catch-and-return (Pitfall 2)"
    - "RPC-driven status advancement: transition_strategy_verification between every adapter step"
    - "30s in-process feature-flag cache with fail-soft on upstream outage"

key-files:
  created:
    - "analytics-service/routers/process_key.py"
    - "analytics-service/services/feature_flags.py"
    - "analytics-service/tests/test_process_key.py"
    - "analytics-service/tests/test_feature_flags.py"
  modified:
    - "analytics-service/main.py (registers process_key_router after csv.router)"

key-decisions:
  - "Use log_audit_event_service RPC (migration 058) instead of log_audit_event (migration 049) because the analytics-service writes via service-role and has no auth.uid()."
  - "Audit row written AFTER the flag gate, not before — denominator measures requests that actually traversed the unified backbone, not flag-off rejections."
  - "Slowapi parameter must be literally named `request: Request` (not `req`); the local KeySubmissionRequest is renamed to `submission` to avoid shadowing."
  - "MC-4 serializer falls back to json-roundtrip on non-dataclass / non-pydantic objects so non-encodable values surface as TypeError instead of corrupting the JSONB column."
  - "CSV path goes through the encrypted state transition (with empty metadata) rather than skipping it — keeps the state machine consistent across all flow types."

patterns-established:
  - "Cross-test sys.modules pollution recovery: pop fastapi/slowapi/etc unconditionally + drop cached router modules before re-importing; necessary because pre-existing tests stub these modules at module-load time."
  - "Phase 17 DESIGN-05 envelope shape returned with HTTP 200 + ok:false (not a 4xx) on validation failures — wizard renders error UI from envelope contents."

requirements-completed: [BACKBONE-01, BACKBONE-02, BACKBONE-04, BACKBONE-08]

# Metrics
duration: ~70min
completed: 2026-05-08
---

# Phase 19 Plan 04: POST /process-key Router + Python Feature-Flag Seam Summary

**Unified key-submission FastAPI RPC with INTERNAL_API_TOKEN auth, 5-method IngestionAdapter pipeline, state-machine RPC orchestration, sync vs queued dispatch, plus the Python feature-flag read seam with 30s in-process cache and fail-soft Supabase semantics.**

## Performance

- **Duration:** ~70 min
- **Started:** 2026-05-08T13:50Z
- **Completed:** 2026-05-08T15:00Z
- **Tasks:** 2 (both TDD)
- **Files created:** 4
- **Files modified:** 1

## Accomplishments

- Shipped `POST /process-key` — the Phase 19 unified backbone request-response surface. INTERNAL_API_TOKEN constant-time auth, structlog correlation_id binding, slowapi 100/hour rate limit, BACKBONE-08 idempotency (SELECT pre-check + 23505 catch), BACKBONE-09 sync-vs-queued dispatch, and full 5-method IngestionAdapter orchestration with `transition_strategy_verification` RPC between steps.
- Shipped `services.feature_flags.is_unified_backbone_active` — the Python read seam mirroring `src/lib/feature-flags.ts`. 30s in-process cache, fail-soft on Supabase outage (env decides), kill-switch row wins over env=on.
- Locked in the five 19-REVIEWS mitigations the plan called out: H-2 audit-row-on-entry (so flag-monitor cron has a denominator), H-3 Supabase-outage fail-soft (so transient flaps don't 503 the synchronous path), H-11 per-flow_type source whitelist (DoS guard in the pydantic validator), H-12 INTERNAL_API_TOKEN no-newline regression smoke, MC-4 type-aware MetricsSnapshot encoder.
- 21 new tests pass (8 feature_flags + 13 process_key); full analytics-service suite (797 tests) is green with no regressions.

## Task Commits

Each task followed RED → GREEN TDD discipline:

1. **Task P4-1: feature_flags read seam (RED)** — `b8f5e7b` (test)
2. **Task P4-1: feature_flags implementation (GREEN)** — `0b081c8` (feat)
3. **Task P4-2: process_key router tests (RED)** — `bce9f31` (test)
4. **Task P4-2: process_key router implementation (GREEN)** — `d32ca98` (feat)

## Files Created/Modified

- `analytics-service/routers/process_key.py` (CREATED, 416 lines) — POST /process-key router with auth, flag gate, audit-write, idempotency, sync/queued dispatch, and the 5-method adapter pipeline.
- `analytics-service/services/feature_flags.py` (CREATED, 86 lines) — `is_unified_backbone_active()` async read seam with 30s cache and fail-soft Supabase semantics.
- `analytics-service/tests/test_process_key.py` (CREATED, 540 lines) — 13 tests covering auth, validation, idempotency, dispatch, adapter pipeline, plus H-2 / H-11 / H-12 / MC-4 smoke tests.
- `analytics-service/tests/test_feature_flags.py` (CREATED, 155 lines) — 8 tests covering the kill-switch / env-var / cache / outage matrix.
- `analytics-service/main.py` (MODIFIED) — registers `process_key_router` after `csv.router` per CONTEXT.md L58.

## Decisions Made

- **Audit RPC choice:** Used `log_audit_event_service` (migration 058) rather than `log_audit_event` (migration 049). The latter requires `auth.uid()` — null on the service-role analytics-service caller, so the RPC would raise. The service variant accepts an explicit `p_user_id` and is granted to `service_role` only. This matches the existing `services/audit.py` wrapper convention.
- **Audit-write ordering:** The audit row is written AFTER the flag gate, not before. The flag-monitor cron (P7) computes `errorRate = errorCount / denominator`, where the denominator is requests that actually traversed the unified backbone. Writing on flag-off rejects would inflate the denominator and dilute the rollback signal.
- **Slowapi parameter naming:** Slowapi inspects function signatures for a parameter literally named `request` (or `websocket`). The closer-spelled `req` raised `Exception: No "request" or "websocket" argument on function`. Renamed the FastAPI Request parameter to `request` and the local `KeySubmissionRequest` to `submission` to avoid shadowing.
- **MC-4 serializer fallback:** When the input is neither a dataclass nor a pydantic BaseModel, the encoder falls back to a `__dict__` walk + json.dumps roundtrip. The roundtrip surfaces non-encodable values (datetime, Decimal, raw bytes) as `TypeError` rather than silently writing a corrupted dict to the JSONB column.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] Slowapi requires the FastAPI Request parameter to be named `request`**
- **Found during:** Task P4-2 (first test run)
- **Issue:** Plan blueprint had `async def process_key(req: Request, body: ...)`. Slowapi's `@limiter.limit(...)` decorator inspects the function signature for a parameter literally named `request` or `websocket` to attach the limiter context. The closer-spelled `req` raised `Exception: No "request" or "websocket" argument on function`.
- **Fix:** Renamed the FastAPI Request parameter from `req` to `request`. Renamed the local `KeySubmissionRequest` instance from `request` to `submission` to avoid shadowing.
- **Files modified:** `analytics-service/routers/process_key.py`
- **Verification:** All 13 process_key tests pass.
- **Committed in:** `d32ca98` (Task P4-2 GREEN commit)

**2. [Rule 3 — Blocking] Cross-test sys.modules pollution recovery in test_process_key.py**
- **Found during:** Task P4-2 (after isolated tests passed; full-suite run had 11 failures)
- **Issue:** Three pre-existing test files (`test_routers_audit_emission.py`, `test_routers_audit_emission_structure.py`, `test_portfolio_router_logic.py`) install MagicMock stubs into `sys.modules["fastapi"]`, `sys.modules["slowapi"]`, etc. at module-import time. Two of them go further and mutate the REAL fastapi module's attributes (`sys.modules["fastapi"].APIRouter = MagicMock(...)`). When pytest collects test_process_key.py after these, my router's `@router.post("")` decorator binds against a MagicMock APIRouter and the route is never registered (every request returns 404).
- **Fix:** Added `_ensure_real_third_party()` cleanup at module-import time. Pops every `fastapi/slowapi/starlette/pydantic/supabase` entry from `sys.modules` unconditionally (the `__spec__-is-None` heuristic from the planning blueprint missed the attribute-mutation case), then drops the cached `routers.process_key`/`routers.csv`/`routers.internal`/`routers.portfolio` modules. Subsequent `from fastapi import FastAPI` and `importlib.import_module("routers.process_key")` re-import cleanly.
- **Files modified:** `analytics-service/tests/test_process_key.py`
- **Verification:** Full analytics-service suite (797 tests) is green; 11 failures from cross-test pollution all resolved.
- **Committed in:** `d32ca98` (Task P4-2 GREEN commit)

**3. [Rule 1 — Bug fix] Audit-row write moved AFTER flag gate**
- **Found during:** Task P4-2 (test_process_key_flag_off_503 failed because audit-write requires Supabase mock)
- **Issue:** Plan wording was "audit row at /process-key entry". Initial implementation wrote BEFORE the flag check, but the test for flag-off path doesn't mock Supabase (it's not relevant when the flag is off). More importantly, writing on flag-off rejections inflates the cron's denominator and dilutes the rollback signal — flag-off requests didn't actually traverse the unified backbone.
- **Fix:** Reordered to flag-check → audit-write → adapter pipeline. Documented the rationale in the source comment.
- **Files modified:** `analytics-service/routers/process_key.py`
- **Verification:** test_process_key_flag_off_503 passes; cron's denominator now measures only served requests.
- **Committed in:** `d32ca98` (Task P4-2 GREEN commit)

---

**Total deviations:** 3 auto-fixed (2 Rule 3 blocking, 1 Rule 1 bug)
**Impact on plan:** All three fixes were necessary to land working code. No scope creep — every change was a direct response to a failing test or a code-review observation. The blueprint's `req` parameter name was a red-team-discoverable bug; the cross-test pollution recovery is a deferred fix the test infrastructure has been carrying since `test_portfolio_router_logic.py` shipped.

## Issues Encountered

- **Sys.modules pollution debug took ~10 minutes** — the failing combination (`test_equity_reconstruction.py + test_portfolio_router_logic.py + test_process_key.py`) didn't reproduce in standalone scripts, only under pytest collection ordering. The diagnostic path was: bisect the failing pair → trace which sibling test stubs → discover the attribute-mutation pattern (`sys.modules["fastapi"].APIRouter = MagicMock`) → switch from `__spec__-is-None` filter to unconditional pop. Worth documenting because the next router test file will hit the same trap.

## User Setup Required

None — no external service configuration. The `INTERNAL_API_TOKEN`, `PROCESS_KEY_UNIFIED_BACKBONE`, and `KEK` env vars are already required by the analytics-service and are provisioned in Railway.

## Next Phase Readiness

- **Wave 3 (P5 thin adapters):** Ready. The `POST /process-key` contract is locked: `{ flow_type, source, context }` body shape with `Authorization: Bearer ${INTERNAL_API_TOKEN}` header. P5 thin adapters HTTP-POST against this seam.
- **Wave 2 P6 (worker dispatch):** Ready. The `_is_long_fetch` heuristic in `routers/process_key.py` enqueues `compute_jobs.kind='process_key_long'` with `metadata.correlation_id`, `verification_id`, `flow_type`, `source`. P6 extends `services/job_worker.py` to handle this kind.
- **Wave 2 P9 (fingerprint v0):** Ready. The router calls `adapter.compute_fingerprint(trades, metrics)` and persists `fp.to_jsonb()` to `strategies.fingerprint`. Fingerprint shape is the locked 5-component schema from CONTEXT.md L66-72.
- **Open follow-ups for P7:**
  - The `log_audit_event_service` call in process_key.py uses entity_type="process_key", action="process_key.entry" — P7 cron must filter on these exact values for the denominator query.
  - P7 must also alert when the audit-log denominator stays at 0 for >2 windows (catches H-2 silent-failure regression where the audit-write side of the contract breaks but the cron continues no-tripping).

## TDD Gate Compliance

Both tasks followed full RED → GREEN TDD:

- **Task P4-1:** RED `b8f5e7b` (test fails on missing module) → GREEN `0b081c8` (8/8 tests pass).
- **Task P4-2:** RED `bce9f31` (12/13 tests fail on missing module) → GREEN `d32ca98` (13/13 tests pass).

REFACTOR not needed for either task — implementation matched the spec directly.

## Self-Check: PASSED

All claimed files exist on disk:
- `analytics-service/routers/process_key.py` FOUND
- `analytics-service/services/feature_flags.py` FOUND
- `analytics-service/tests/test_process_key.py` FOUND
- `analytics-service/tests/test_feature_flags.py` FOUND
- `.planning/phases/19-unified-backbone-conditional-on-day-2-gate-commit/19-04-process-key-router-SUMMARY.md` FOUND

All claimed commits exist in git log:
- `b8f5e7b` (test P4-1 RED) FOUND
- `0b081c8` (feat P4-1 GREEN) FOUND
- `bce9f31` (test P4-2 RED) FOUND
- `d32ca98` (feat P4-2 GREEN) FOUND

main.py registration FOUND (`process_key_router` import + `app.include_router`).

---
*Phase: 19-unified-backbone-conditional-on-day-2-gate-commit*
*Plan: 04 (process-key-router)*
*Completed: 2026-05-08*
