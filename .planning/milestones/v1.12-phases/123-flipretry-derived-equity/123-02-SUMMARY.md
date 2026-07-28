---
phase: 123-flipretry-derived-equity
plan: 02
subsystem: analytics-worker
tags: [worker, pg-cron, claim-rpc, healthz, railway, migration]
requires: []
provides:
  - "claim_compute_jobs_with_priority 5-arg kind-filtered form (p_kind_include/p_kind_exclude, NULL=byte-identical)"
  - "WORKER_CLAIM_ROLE (all|interactive|backfill) + BACKFILL_KINDS on main_worker"
  - "per-job LAST_TICK_AT healthz refresh"
affects:
  - "analytics-service worker claim path"
  - "compute_jobs claim RPC signature (3-arg -> 5-arg)"
tech-stack:
  added: []
  patterns: ["structural isolation of backfill blast radius via kind filter", "byte-identical default merge (SFOX_ENABLED discipline)"]
key-files:
  created:
    - supabase/migrations/20260719073701_claim_kind_filter.sql
    - supabase/tests/test_claim_kind_filter.sql
  modified:
    - analytics-service/main_worker.py
    - analytics-service/tests/test_main_worker.py
    - supabase/tests/test_claim_compute_jobs_dedupe_partition.sql
    - supabase/tests/test_compute_jobs_rpc_error_clear_and_fanin.sql
decisions:
  - "role='all' adds NO claim-payload keys so merge is byte-identical until founder cutover (plan 03)"
  - "backfill role REFUSES the unfilterable legacy 42883 fallback (claims nothing) rather than claim out-of-role"
metrics:
  duration: ~35m
  completed: 2026-07-19
---

# Phase 123 Plan 02: Kind-Filtered Claim RPC + Dedicated-Worker Role + Per-Job Healthz Summary

FLIPRETRY-02/04 mechanism landed in code+SQL: the claim RPC gained an optional kind filter so a dedicated backfill worker claims ONLY backfill kinds and the interactive prod worker excludes them (structural isolation of the v1.11 wedge blast radius), plus a per-job healthz refresh; defaults change nothing until the founder cuts over both workers in plan 03.

## What Was Built

### Task 1 — kind-filtered claim RPC migration + SQL gates (commit 2e1a1b2c)
- `supabase/migrations/20260719073701_claim_kind_filter.sql`: DROPs the exact 3-arg `claim_compute_jobs_with_priority(INTEGER, TEXT, BOOLEAN)` then CREATEs the 5-arg form (+`p_kind_include TEXT[] DEFAULT NULL, p_kind_exclude TEXT[] DEFAULT NULL`), re-based verbatim on the LATEST full body (20260603120000). The filter predicate `(p_kind_include IS NULL OR kind = ANY(...)) AND (p_kind_exclude IS NULL OR NOT (kind = ANY(...)))` is applied to BOTH the `v_high_pending` throttle probe AND the `ranked` claim SELECT. COMMENT + REVOKE re-stated for the 5-arg signature; SECURITY DEFINER + `search_path = public, pg_temp` preserved. Both NULL => byte-identical.
- `supabase/tests/test_claim_kind_filter.sql`: structural (filter present on both probe + claim SELECT), functional include/exclude/NULL-passthrough, and FLIPRETRY-04 double-fan-out-single-inflight idempotency. All scoped in BEGIN/ROLLBACK.
- BLOCKER FIX: updated the two signature-pinned CI gates (`test_claim_compute_jobs_dedupe_partition.sql:39`, `test_compute_jobs_rpc_error_clear_and_fanin.sql:28`) `::regprocedure` cast from `(integer,text,boolean)` to `(integer,text,boolean,text[],text[])`; body assertions unchanged. Grep confirmed no other file pins the 3-arg signature.

### Task 2 — role-aware worker claim + per-job healthz refresh (TDD: test d33305bd → feat 5db48be3)
- `WORKER_CLAIM_ROLE` env read once at import, validated loud (`_validate_claim_role` raises ValueError on any non-{all,interactive,backfill}). Default "all".
- `BACKFILL_KINDS = ("derive_broker_dailies", "derive_allocator_equity")`.
- `_claim_kind_args(role)`: "all" → `{}` (byte-identical payload), "interactive" → `p_kind_exclude`, "backfill" → `p_kind_include`.
- Fallback safety: on a 42883 legacy fallback, role="backfill" REFUSES (logs error, returns empty — never claims out-of-role via the unfilterable 2-arg claim); role="interactive" still falls back with a degraded-exclusion warning.
- Per-job `LAST_TICK_AT = time.time()` at the top of the for-job loop (keeps the at-claim write too).

## Verification
- `cd analytics-service && .venv/bin/python -m pytest tests/test_main_worker.py tests/test_health.py -q` → 49 passed.
- Full analytics-service suite → 4047 passed, 96 skipped.
- Migration Task 1 automated verify (DROP/p_kind_include/REVOKE/test file) → PASS.
- tsc/lint N/A (no TS touched).

## Deviations from Plan
None — plan executed as written.

## Left to the Orchestrator (NOT done here, by design)
- MCP-apply `20260719073701_claim_kind_filter.sql` to the TEST project `qmnijlgmdhviwzwfyzlc`, then fix the `schema_migrations` stamped timestamp to the file timestamp (apply_migration drift rule).
- Run the two test scenarios' SQL (`test_claim_kind_filter.sql`) against TEST via Supabase MCP to confirm filter + idempotency behavior (the *_live SQL never runs locally in CI).
- Re-verify the two updated signature-pinned CI tests GREEN against TEST after apply.
- Prod (`khslejtfbuezsmvmtsdn`) untouched — merge auto-applies. Railway deploy + cron re-schedule are founder ops in plan 03.

## Notes
- sFOX-F5 active-account crawl rides this worker for free (same `derive_broker_dailies` kind) — nothing sFOX-specific was built here.
- TDD gate compliance: `test(123-02)` (d33305bd) precedes `feat(123-02)` (5db48be3). No refactor commit needed.

## Self-Check: PASSED
- supabase/migrations/20260719073701_claim_kind_filter.sql — FOUND
- supabase/tests/test_claim_kind_filter.sql — FOUND
- commits 2e1a1b2c, d33305bd, 5db48be3 — present on gsd/v1.12-sfox-verified-integration
