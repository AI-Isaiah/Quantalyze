---
status: resolved
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
source: [141-VERIFICATION.md]
started: 2026-07-31T14:00:00Z
updated: 2026-07-31T14:15:00Z
---

## Current Test

[complete — both lanes executed locally 2026-07-31]

## Tests

### 1. CI `sql-tests` lane executes `supabase/tests/test_resync_retry_single_job.sql` against the TEST project (qmnijlgmdhviwzwfyzlc)
expected: double enqueue → 1 non-terminal `compute_jobs` row; distinct-session SV rows admitted (2); same-session reinsert 23505s. Exit 0 under `psql -v ON_ERROR_STOP=1`
why_human: No local TEST-DB credentials in the sandbox; the file must never be run against PROD. Structure is grep-verified (5 RAISE EXCEPTION, process_key_long ×2, SET LOCAL ROLE service_role, ROLLBACK, 23505). The idempotency behavior it re-proves at the REAL index is already proven at the app level by the local pytest (5 passed).
result: PASSED (2026-07-31) — executed against TEST `qmnijlgmdhviwzwfyzlc` (quantalyze-test, NOT prod `khslejtfbuezsmvmtsdn`) via Supabase MCP after auth. All three assertions passed: (a) two `enqueue_compute_job` calls → exactly 1 non-terminal `compute_jobs` row, both returning the SAME id; (b) two distinct-session draft SV rows admitted; (c) same-session reinsert raised 23505. Zero rows raised no exception. **Falsifiability proven**: a negative-control `RAISE EXCEPTION` through the same MCP path surfaced as a hard error (`P0001`), so the clean run is a real pass, not a swallowed one. **No pollution**: post-run fixture counts all 0 (strategies/compute_jobs/strategy_verifications/auth.users) — the `ROLLBACK` held.

### 2. CI real-Redis lane `npm run test:redis` (docker-compose.redis-test.yml) re-runs the SC-4 breaker cases under a real Upstash-compatible Redis
expected: SC-4a (open at entry → zero fetch) and SC-4b (opens between attempts → CircuitOpenError, one fetch) green under real Redis
why_human: Requires a Docker Redis container unavailable in the execution sandbox. SC-4 is already proven at the unit level (mocked Upstash) — 288 seam tests pass locally, both breaker gates present in source and mutation-observed.
result: PASSED (2026-07-31) — `docker compose -f docker-compose.redis-test.yml up -d` (redis + srh healthy, REST probe 200), then `UPSTASH_REDIS_REST_URL=http://localhost:8079 UPSTASH_REDIS_REST_TOKEN=ci-seam-breaker-token npm run test:redis` → **7 passed / 1 file**, 140s. Note: the first attempt with the store DOWN correctly FAILED loud (`SeamRedisLaneUnavailableError: this lane is a GATE and must never skip`) rather than skipping — the lane's own anti-silent-green guard is itself confirmed working.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
