---
phase: 191-refusalrace-the-derive-s-refusal-marker-and-a-sync-s-refresh
plan: 02
subsystem: database
tags: [migration, security-definer, jsonb-merge, compute_jobs, ratchet]
requires:
  - phase: 191-01
    provides: SC-1 read-only PROD baseline
provides:
  - "public.mark_compute_job_kept_figures(uuid) RETURNS boolean, one-statement refusal marker merge"
  - "public.retract_ledger_refresh_marker(uuid, text) RETURNS jsonb, one-UPDATE retraction with outcomes retracted | done | no_marker | no_row"
  - "generated function snapshots, two snapshot-only ratchet rows, COMPARED_FLOOR 134"
affects: [191-03, 191-04, 191-05, 191-06, 191-07, 191-08, 191-09]
tech-stack:
  added: []
  patterns: ["SECURITY DEFINER merge writer with catalogue-only verify block", "static ACL pin on migration text"]
key-files:
  created:
    - supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql
    - supabase/migrations/down/20261106120000-rollback.sql
    - analytics-service/tests/test_compute_job_metadata_merge_privilege.py
    - supabase/schema/functions/mark_compute_job_kept_figures.sql
    - supabase/schema/functions/retract_ledger_refresh_marker.sql
  modified:
    - scripts/dump-sql-functions.ts
    - scripts/baseline-content-drift-check.mjs
key-decisions:
  - "D-01 confirmed: small dedicated RPC, enqueue_compute_job untouched"
patterns-established:
  - "Marker list written in the exact text form the TS oracle regex parses, on exactly two lines"
requirements-completed: [SC-2, SC-4]  # SC-3 (no lost update under concurrency) is NOT met by PR 1: it waits for the live two-connection probe, plan 191-09
status: complete
completed: 2026-11-04
commits: 2
plan_head_before: 98f7ff77acfd8d0c0bee80671e3d7fccbb1dfadc
plan_head_after: 76ea1002988453452f46753bc6eaa6b8610c1c73
actuals:
  tokens: 14000
  tasks: 3
  commits: 2
---

# Phase 191 Plan 02: metadata merge RPCs Summary

Two service-role-only SQL functions that each do their whole write to `compute_jobs.metadata` in one UPDATE, applied and exercised in both write orders on a real PostgreSQL, with their snapshots and censuses.

d01: small-dedicated-rpc (founder 2026-11-04, "Small dedicated RPC (Recommended)")
migration: supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql (planned name, no collision: newest on this branch and on origin/main was 20261105120000)
rollback: supabase/migrations/down/20261106120000-rollback.sql

Plans 191-03 and 191-04 follow the name `20261106120000_refusalrace_metadata_merge_rpcs.sql`.

## Commits

- e4f39cc85 feat(191-02): metadata merge RPCs for the refusal marker and the retraction
- 76ea10029 chore(191-02): function snapshots, two snapshot-only ratchet rows, COMPARED_FLOOR 134

## What was built

- `mark_compute_job_kept_figures(p_job_id uuid) RETURNS boolean`: one UPDATE merging `read_refusal_kept_figures: true`; non-object metadata (the `jsonb_typeof` guard) becomes a fresh object; returns FOUND (D-03, D-07, D-09, unfenced).
- `retract_ledger_refresh_marker(p_job_id uuid, p_correlation_id text) RETURNS jsonb`: one UPDATE (`metadata - 'source'` merged with `refresh_marker_retracted` and `correlation_id`) matching no `done` row and only the two ledger-refresh markers; a classifying SELECT runs only on a miss and reports `done` (with the marker when the row carried one), `no_marker` or `no_row`.
- Both: SECURITY DEFINER, `SET search_path = public, pg_catalog`, plain CREATE FUNCTION, REVOKE ALL FROM PUBLIC, anon, authenticated, GRANT EXECUTE to service_role only, catalogue-only verify block (pg_proc, proconfig, has_function_privilege, aclexplode). The migration holds exactly two function-defining statements; the marker list text sits on exactly two lines.

## Verification

Smoke (`SMOKE 191-02 OK`, pg-lane, scratch file outside the repo): migration applied (its verify block passed); marker then retraction on row A and retraction then marker on row B end with identical metadata holding `read_refusal_kept_figures` true, `refresh_marker_retracted` `ledger-refresh`, `correlation_id` `new`, `member_progress`, no `source`. Extra arms in the same smoke: second retraction is `no_marker`; unknown id and NULL id are `no_row`; marker on an unknown id returns false; a `done` row with a composite marker reports `done` with the marker and is not mutated; array metadata becomes a fresh object after the marker.

Static test `analytics-service/tests/test_compute_job_metadata_merge_privilege.py`: 8 passed. RED proof: the marker function's GRANT widened to `service_role, authenticated` made `test_grant_execute_goes_to_service_role_and_nothing_else[mark_compute_job_kept_figures]` and `test_no_grant_anywhere_names_anon_or_authenticated` fail (2 failed, 6 passed); restored from a byte backup, `cmp -s` silent, rerun 8 passed.

CI's mypy line (strict, from `analytics-service/`): `Success: no issues found in 132 source files`. `verify-plan-anchors` on this plan: OK, 6 claims.

Drift readings (`node scripts/baseline-content-drift-check.mjs`):
- before (planning reading): `functions compared 132`, `findings 0`, floor 132.
- after: `functions compared 134 - MATCH 129, DRIFT 3, SNAPSHOT_MISSING 2, SNAPSHOT_ONLY 0, UNCOMPARABLE 0`, `findings 2`; `COMPARED_FLOOR` 132 -> 134. The two findings are `mark_compute_job_kept_figures/1` and `retract_ledger_refresh_marker/2`, expected until the post-apply re-dump; the three DRIFT rows are the existing allowlisted ones; no allowlist row was added.
- `npm run schema:functions:check`: current (132 functions), 2 ratcheted disagreements carried. Only the two new snapshot files differ under `supabase/schema/functions`.
- `src/__tests__/baseline-content-drift-allowlist.test.ts` and `drift-check-scripts.test.ts`: 927 passed.

## Deviations from Plan

None. One observation, not a deviation: the pg-lane prints `WARNING: SET LOCAL can only be used in transaction blocks` for the migration's first statement, because psql applies it outside a transaction. This is the form the latest house migration (`20261105120000`) uses, and Supabase wraps each migration in a transaction.

## Known Stubs

None.

## Threat Flags

None beyond the plan's threat model (T-191-03, -04, -05, -06, -07 mitigated as planned).

## Self-Check: PASSED

Files found: the migration, the rollback, the static test, both snapshots. Commits e4f39cc85 and 76ea10029 are ancestors of HEAD.
