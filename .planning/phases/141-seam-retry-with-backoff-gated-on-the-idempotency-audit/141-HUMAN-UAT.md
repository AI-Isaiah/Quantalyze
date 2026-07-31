---
status: partial
phase: 141-seam-retry-with-backoff-gated-on-the-idempotency-audit
source: [141-VERIFICATION.md]
started: 2026-07-31T14:00:00Z
updated: 2026-07-31T14:00:00Z
---

## Current Test

[awaiting CI confirmation]

## Tests

### 1. CI `sql-tests` lane executes `supabase/tests/test_resync_retry_single_job.sql` against the TEST project (qmnijlgmdhviwzwfyzlc)
expected: double enqueue → 1 non-terminal `compute_jobs` row; distinct-session SV rows admitted (2); same-session reinsert 23505s. Exit 0 under `psql -v ON_ERROR_STOP=1`
why_human: No local TEST-DB credentials in the sandbox; the file must never be run against PROD. Structure is grep-verified (5 RAISE EXCEPTION, process_key_long ×2, SET LOCAL ROLE service_role, ROLLBACK, 23505). The idempotency behavior it re-proves at the REAL index is already proven at the app level by the local pytest (5 passed).
result: [pending]

### 2. CI real-Redis lane `npm run test:redis` (docker-compose.redis-test.yml) re-runs the SC-4 breaker cases under a real Upstash-compatible Redis
expected: SC-4a (open at entry → zero fetch) and SC-4b (opens between attempts → CircuitOpenError, one fetch) green under real Redis
why_human: Requires a Docker Redis container unavailable in the execution sandbox. SC-4 is already proven at the unit level (mocked Upstash) — 288 seam tests pass locally, both breaker gates present in source and mutation-observed.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
