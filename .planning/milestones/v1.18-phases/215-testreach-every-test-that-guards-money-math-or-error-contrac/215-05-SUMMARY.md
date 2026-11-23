---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
plan: 05
subsystem: testing
tags: [sentry, slowapi, rate-limit, observability, pytest, process-key]
requires: ["215-03"]
provides:
  - "services/rate_limit.py: anon_bucket_key(scope), the one spelling of the anonymous bucket key"
  - "services/app_error_handlers.py: _alert_anon_bucket_saturated, called from rate_limit_exceeded_handler after the 429 is built"
  - "tests/test_anon_bucket_alert.py: 7 literal-oracle tests of capture count, dedupe, silence on tenant and ceiling refusals, never-fatal, identical 429"
affects: [analytics-service/services, analytics-service/routers/process_key.py, analytics-service/tests]
tech-stack:
  added: []
  patterns: ["per-process monotonic dedupe dict (main._secret_capture_last_at shape) with the window read from the refusing limit's expiry", "refusing bucket read from request.state.view_rate_limit, never by re-running the key function"]
key-files:
  created:
    - analytics-service/tests/test_anon_bucket_alert.py
  modified:
    - analytics-service/services/rate_limit.py
    - analytics-service/routers/process_key.py
    - analytics-service/services/app_error_handlers.py
key-decisions:
  - "The alert is observability only: it runs after the JSONResponse is built, reads nothing the response depends on, and swallows every failure; status, body and Retry-After are untouched and the limit stays 30/hour"
  - "Dedupe is per process (one event per replica per window); the dedupe stamp is written before the emit so a raising capture still dedupes"
  - "Event carries a fixed message, fingerprint [anon-bucket-saturated, process_key] and tags anon_bucket_saturated and limit; no IP, header, claim or correlation id"
status: complete
completed: 2026-11-15
actuals:
  tokens: 9000
  tasks: 2
  commits: 2
plan_head_before: d60517b5c7d179044f96e2dcf59b59e690fa8ea1
plan_head_after: 4b5f74f9474f1c85e7450f3f5351e2f30eb41621
---

# Phase 215 Plan 05: Anonymous teaser bucket saturation raises an alert Summary

When the shared anonymous `/process-key` bucket (`process_key:anon`, 30/hour) refuses a request, production's 429 handler now emits one de-duplicated Sentry `capture_message` (fingerprint `anon-bucket-saturated`, tag `anon_bucket_saturated=process_key`), with the response byte-for-byte unchanged.

## Tasks

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | SC-7c tracer: a real anonymous refusal through production's 429 handler emits one event | f30b0837c | rate_limit.py, process_key.py, app_error_handlers.py, test_anon_bucket_alert.py |
| 2 | SC-7c expansion: dedupe window, silence on tenant and ceiling refusals, never fatal, identical 429 | 4b5f74f94 | test_anon_bucket_alert.py |

## What changed

- `anon_bucket_key(scope)` in `services/rate_limit.py` replaces the two `f"{scope}:anon"` constructions and the literal in `_process_key_limit_for`. The string is unchanged, so no limiter behaviour moves.
- `_alert_anon_bucket_saturated(request, throttle)` reads the refusing key from `request.state.view_rate_limit[1][0]` (any failure means "not anonymous"), logs a structured warning on every anonymous refusal, and emits at most once per window per process. Window = the refusing limit's `get_expiry()`, falling back to 3600 s.
- Task 2 found no defect in the Task 1 hook; `app_error_handlers.py` changed only in Task 1 (plus a mypy-strict fix of `throttle.limit` being Optional, done before the Task 1 commit).

## Verification

- `tests/test_anon_bucket_alert.py`: 7 passed. Each run alone and green: `test_process_key.py` (114), `test_rate_limit_contract.py` (7), `test_app_factory_parity.py` (6), `test_raw_5xx_census.py` (19), `test_correlation_middleware.py`, `test_limiter_route_coverage.py`, `test_tenant_claim_parsing.py`, `test_boundary_literals_parity.py`, `test_limiter_identity.py`, `test_sentry_transaction_redaction_170_1.py`, `test_process_key_auth_order.py`, `test_validation_error_contract.py`, `test_envelope_recoverable.py`, `test_simulator_router.py`.
- mypy strict (CI invocation): `Success: no issues found in 140 source files`.
- vitest (6 TS guards that read `routers/process_key.py` / `services/rate_limit.py`): 6 files, 256 tests passed, none needed re-pointing.
- Acceptance greps: `_PROCESS_KEY_ANON_LIMIT = "30/hour"` = 1; `"process_key:anon"` in process_key.py = 0; `def anon_bucket_key` = 1.
- SC-8: `git diff --stat origin/main -- supabase/migrations` prints nothing.

## RED proofs (SC-9), each restored from a byte backup and `cmp`-verified

1. Task 1: deleted the `_alert_anon_bucket_saturated(request, throttle)` call. Tracer test FAILED: `assert 0 == 1` on `len(sentry_spy.captures)`.
2. Task 2, dedupe removed (emit on every refusal): `test_repeat_refusals_inside_the_window_emit_nothing_more` FAILED: `assert 3 == 1`.
3. Task 2, detection matches any bucket key: `test_a_tenant_bucket_refusal_emits_nothing` and `test_a_platform_ceiling_refusal_emits_nothing` both FAILED (one unexpected capture each).
4. Extra: swallow-all `except Exception` narrowed so a raising capture escapes: `test_a_raising_capture_still_returns_the_identical_429` FAILED with `assert 500 == 429`.

## Deviations from Plan

None - plan executed as written. One in-flight correction: mypy strict flagged `throttle.limit.limit` (Optional `limit`), fixed with an explicit `is not None` guard before the first commit.

## Founder follow-up (no repo work; T-215-16)

A Sentry event pages nobody until a Sentry issue-alert rule routes it. Create an issue-alert rule in Sentry on fingerprint `anon-bucket-saturated` (or tag `anon_bucket_saturated:process_key`) routed to a human. Per-process dedupe means up to one event per replica per window.

## Known Stubs

None.

## Threat Flags

None - the only new outbound surface is the Sentry event the plan's threat model (T-215-13..16) already covers; the tracer test asserts no correlation id, IP or claim rides on it.

## Self-Check: PASSED

- `analytics-service/tests/test_anon_bucket_alert.py`: found
- commits f30b0837c and 4b5f74f94: ancestors of HEAD
