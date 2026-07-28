---
phase: 106-cutover-flip-delete-legacy-janitor
plan: 06
subsystem: database
tags: [postgres, compute_jobs, security-definer, migration, rpc-guard, backbone-unification]

# Dependency graph
requires:
  - phase: 106-05
    provides: E2E approval + empirical prod re-check (compute_analytics 30d enqueue count == 0)
provides:
  - RPC admission guard rejecting kind='compute_analytics' in BOTH live _enqueue_compute_job_internal overloads (7-param + 10-param)
  - Self-verifying migration DO block (both overloads carry the guard; kind CHECK still admits the historical kind)
  - SQL structural gate test asserting the guard survives in both overloads
affects: [106-cutover, backbone-unification, compute-jobs-queue, v1.10-stage-b]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RPC-level kind retirement (admission guard) instead of CHECK/registry drop — preserves FK-referencing historical rows"
    - "Verbatim re-base of a SECDEF fn body on its LATEST def, inserting ONLY the new guard block"

key-files:
  created:
    - supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql
    - supabase/tests/test_compute_analytics_kind_retired.sql
  modified: []

key-decisions:
  - "Retire compute_analytics as an RPC admission guard, NOT a CHECK/registry drop — 45 historical prod rows FK-reference the kind and a drop would fail the auto-apply mid-deploy"
  - "Guard inserted in BOTH overloads (7-param 20260510180226:164, 10-param 20260420073003:330) — a caller reaching the un-guarded overload would otherwise still enqueue the retired kind"
  - "No grants touched (CREATE OR REPLACE preserves ACLs); no COMMENT/REVOKE added to avoid 42725 ambiguity and keep the migration minimal"

patterns-established:
  - "Retired-kind reject: IF p_kind = '<kind>' THEN RAISE EXCEPTION ... USING ERRCODE = 'invalid_parameter_value', placed immediately after the p_kind NULL guard in every live overload"

requirements-completed: [BB-03]

# Metrics
duration: 12 min
completed: 2026-07-15
---

# Phase 106 Plan 06: Retire compute_analytics kind via RPC admission guard (D3) Summary

**Fail-loud RPC admission guard rejecting `kind='compute_analytics'` (ERRCODE invalid_parameter_value) in BOTH live `_enqueue_compute_job_internal` overloads, re-based verbatim on their latest bodies, with the registry + kind CHECK left intact for the 45 historical FK-referencing prod rows.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-15
- **Completed:** 2026-07-15
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments
- Reversible migration `20260716090000_retire_compute_analytics_kind_rpc_guard.sql` inserting the retired-kind reject into the 7-param and 10-param overloads of `_enqueue_compute_job_internal`, each body copied byte-identical from its re-base source (only the guard block added).
- Self-verifying DO block that fails the deploy if either overload loses the guard, loses SECDEF/search_path, or if `compute_jobs_kind_check` stops admitting `compute_analytics` (regression guard against a "helpful" registry/CHECK drop).
- SQL structural gate `test_compute_analytics_kind_retired.sql` asserting both overloads reject via `invalid_parameter_value` and the CHECK still admits the historical kind.

## Task Commits

Each task was committed atomically:

1. **Task 1: Guard migration (both overloads) + self-verifying DO block** — `3de917e5` (feat, breaking)
2. **Task 2: SQL gate test** — `11c5c94c` (test)

**Plan metadata:** committed with this SUMMARY (docs).

## Files Created/Modified
- `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql` — CREATE OR REPLACE of both `_enqueue_compute_job_internal` overloads with the retired-kind guard + self-verifying DO block; `SET LOCAL lock_timeout = '3s'`, no BEGIN/COMMIT.
- `supabase/tests/test_compute_analytics_kind_retired.sql` — structural SQL gate reading `pg_get_functiondef` for both overloads and `pg_get_constraintdef` for the kind CHECK.

## Verification
- **Task 1 (GUARD-SHAPE-OK):** `grep -c 'compute_analytics is retired' >= 4` (2 guard blocks + 2 DO-block assertions), `lock_timeout` present, exactly 2 `CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal`. PASS.
- **Task 2 (SQLTEST-OK):** test file non-empty and contains `compute_analytics is retired`. PASS.
- **Re-base discipline:** both bodies diffed byte-identical against their re-base sources (`20260510180226:164-282`, `20260420073003:330-457`) after stripping the two exact guard blocks — `7-PARAM-VERBATIM-OK` / `10-PARAM-VERBATIM-OK`. SECURITY DEFINER + `SET search_path = public, pg_catalog` preserved. Grants untouched.
- **Filename ordering:** `20260716090000` sorts after the current latest migration `20260715120000_grant_anon_execute_current_user_has_app_role.sql` (re-checked at execution; no newer-than-20260716 file exists).
- **Branch discipline:** stayed on `feat/106-stage-b-cutover-delete-legacy` for both commits; no branch operations; no PR/push; no file deletions.

## Decisions Made
- RPC admission guard over CHECK/registry drop (45 historical prod rows FK-reference the kind; auto-apply-to-prod would fail a drop mid-deploy).
- Guard placed in BOTH overloads immediately after each p_kind NULL guard, using the same RAISE idiom (`ERRCODE = 'invalid_parameter_value'`).
- No COMMENT/REVOKE emitted — `CREATE OR REPLACE` preserves the existing ACLs (hardened by `20260515130001`), and skipping avoids the 42725 arg-list-ambiguity discipline entirely.

## Deviations from Plan

None - plan executed exactly as written.

## MERGE GATES (orchestrator / human — executor has no Supabase MCP)

These are NOT executor tasks. Surface them loudly before merge:

- **(a) migration-reviewer pass** — verify the SECDEF re-base is verbatim, guard is fail-loud, no grant/ACL drift, DO block single-literal RAISEs.
- **(b) rls-policy-auditor pass** — confirm no privilege/exposure change (guard is a pure additive reject on a SECDEF fn).
- **(c) test-project catch-up BEFORE merge** — apply `20260716090000` to the TEST project (`qmnijlgmdhviwzwfyzlc`) via Supabase MCP so `test_compute_analytics_kind_retired.sql` goes GREEN in CI. The test is RED-GUARDED until then by design ([[project_test_project_catchup_unmasks_stale_tests]]).
- **After merge:** watch the supabase-migrate auto-apply run on PROD; verify BOTH function bodies via a `pg_get_functiondef` query and confirm `compute_jobs_kind_check` still admits `compute_analytics`.

## Known Stubs
None.

## Threat Flags
None — no new network endpoint, auth path, file access, or schema change at a trust boundary. The migration only tightens the existing SECDEF enqueue RPC (mitigates T-106-12/T-106-13/T-106-15; T-106-14 accepted residual documented in the plan).

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Stage B D3 complete: retired-kind enqueue is impossible via RPC in both overloads; registry/CHECKs untouched; migration reversible by re-running the prior bodies.
- Blocked on the three MERGE GATES above (test-project catch-up in particular) before this can go green in CI and auto-apply to prod.

## Self-Check: PASSED
- Files present: `supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql`, `supabase/tests/test_compute_analytics_kind_retired.sql`.
- Commits present: `3de917e5` (Task 1), `11c5c94c` (Task 2).

---
*Phase: 106-cutover-flip-delete-legacy-janitor*
*Completed: 2026-07-15*
