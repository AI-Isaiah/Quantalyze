---
phase: 125-worker-dedicated-backfill-worker-retention-hygiene
plan: 01
subsystem: retention/compute-jobs
tags: [pg_cron, retention, compute_jobs, ci-flake-root-cause, worker-04]
requires:
  - "cron.job registry (pg_cron) — mig 121 retention_delete_guard backstop"
  - "compute_jobs table + coherence CHECK (mig 20260717233529)"
  - "derive-allocator-key-dailies cron (mig 20260717233529) — the flake source"
provides:
  - "retention_compute_jobs_orphaned_running pg_cron job (daily 04:15 UTC, 2h window)"
  - "RED-guarded behavioral SQL test asserting the DEPLOYED cron body"
affects:
  - "TEST project CI stability (kills the python fence-test flake at its source)"
  - "PROD (new cron auto-applies on merge; zero behavior change beyond the purge)"
tech-stack:
  added: []
  patterns:
    - "House-style retention cron: BEGIN/lock_timeout, fail-loud pg_cron guard, idempotent unschedule-then-schedule, fixed-literal $cron$ body, terminal self-verify DO block (analog mig 20260515210200)"
    - "Presence-gated PL/pgSQL SQL guard test (NOTICE-skip on pg_cron/cron-row absence — test-DB lag house style)"
    - "Oracle = EXECUTE of the deployed cron.job.command, not a re-typed predicate"
key-files:
  created:
    - "supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql"
    - "supabase/tests/test_retention_orphaned_running.sql"
  modified: []
decisions:
  - "DELETE, never reset-to-pending: a reset row is re-claimed to running by the next CI run → the collision returns"
  - "2h window (not tighter) — 3x margin over the 40-min process_key_long max watchdog threshold, so a live in-flight prod job can never be purged"
  - "Schedule 04:15 UTC — safe 1-22 hour band, BEFORE the 05:30 derive cron so each CI day starts from a clean slate"
metrics:
  duration: "~15 min"
  completed: "2026-07-19"
  tasks: 2
  files: 2
---

# Phase 125 Plan 01: Orphaned-Running Compute-Jobs Retention Purge Summary

Recurring pg_cron purge of orphaned `running` compute_jobs (2h window, prod-safe) plus a RED-guarded behavioral SQL test — the WORKER-04 root-cause fix for the recurring `python` fence-test CI flake.

## What Was Built

**Task 1 — SQL guard test** (`supabase/tests/test_retention_orphaned_running.sql`, commit `5fda9b86`)
- Plain PL/pgSQL under `psql -v ON_ERROR_STOP=1`, wrapped `BEGIN; … ROLLBACK;` (no pgTAP).
- Two presence gates FIRST (both NOTICE-skip + RETURN): pg_cron extension absent (local dev), and the `retention_compute_jobs_orphaned_running` cron row absent (test-DB lag).
- Registration + predicate assertions via ILIKE against `cron.job.command`: `status = 'running'`, `interval '2 hours'`, `claimed_at`, `public.compute_jobs`; plus a safe 1-22 schedule-hour band check (split_part idiom, mirrors `test_derive_allocator_keys_fanout.sql` assertion 6).
- Behavioral section seeds three rows on three distinct api_keys (avoids the `compute_jobs_one_inflight_per_kind_api_key` partial-unique collision on the two running rows): (a) running claimed 3h ago, (b) running claimed now, (c) done aged 3h. It EXECUTEs the REAL deployed `cron.job.command` (the oracle is the shipped body, not a transcription) and asserts (a) is gone while (b) and (c) survive.
- Header encodes the WHY (Rule 9): the flake mechanism is partition-dedupe collision on `status IN ('running','done_pending_children')`; DELETE not reset because a reset row is re-claimed to running next CI run.

**Task 2 — retention purge migration** (`supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql`, commit `ee79d5f4`)
- Follows the `20260515210200` house style verbatim: `BEGIN; SET lock_timeout='5s'; … COMMIT;`; fail-loud pg_cron presence guard (`RAISE EXCEPTION … USING ERRCODE = 'feature_not_supported'`); idempotent unschedule-then-schedule; fixed-literal `$cron$` body; terminal self-verifying DO block.
- Jobname `retention_compute_jobs_orphaned_running`, schedule `'15 4 * * *'`.
- Cron body (fixed literal, schema-qualified): `DELETE FROM public.compute_jobs WHERE status = 'running' AND claimed_at IS NOT NULL AND claimed_at < now() - interval '2 hours';`
- Header cites the `retention_delete_guard` trigger (mig 121, 100k-row backstop — inherited, never disabled/bypassed) and the 40-min `process_key_long` watchdog rationale for the 2h window.
- Scope discipline: zero non-comment occurrences of `derive-allocator-key-dailies` (WORKER-03 anti-smuggling — the reschedule is a founder LIVE op); no compute_jobs DDL/RLS/RPC changes.

## Verification

- Task 1 automated gate: PASS (grep counts, `interval '2 hours'`, `ROLLBACK;`, `RAISE NOTICE`; zero pgTAP; two distinct skip NOTICEs).
- Task 2 automated gate: PASS (predicate fragments, `'15 4 * * *'`, `feature_not_supported`, `COMMIT;`, zero non-comment `derive-allocator-key-dailies`).
- Anti-smuggling: `grep -v '^[[:space:]]*--' <migration> | grep -c derive-allocator-key-dailies` = 0. No non-comment DDL on compute_jobs (the sole `DISABLE TRIGGER`/`session_replication_role` match is a comment stating what the migration does NOT do).
- Migration sorts last: `20260719120000_…` > `20260719073701_…`. CI `sql-tests` glob auto-discovers the new test (no wiring).
- `psql "$TEST_SUPABASE_DB_URL"` NOTICE-skip leg: DEFERRED — `TEST_SUPABASE_DB_URL` is unset in this local session. Runs post-apply in plan 125-03 Task 1.

## Deviations from Plan

None — plan executed exactly as written. No Rule 1-4 deviations, no auth gates.

## Known Stubs

None.

## Threat Flags

None — the migration introduces only the scoped, self-verifying purge cron; no new endpoints, auth paths, or schema changes at trust boundaries beyond the modeled `<threat_model>` (T-125-01…04 all mitigated as designed).

## Follow-ups (not this plan)

- Plan 125-03 [BLOCKING]: MCP-apply the migration to the TEST project (`qmnijlgmdhviwzwfyzlc`), then run the guard test post-apply so its assertions flip from NOTICE-skip to enforced.
- Merge to main auto-applies the migration to PROD — watch the run and verify the cron registers.

## Self-Check: PASSED

- FOUND: supabase/tests/test_retention_orphaned_running.sql
- FOUND: supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql
- FOUND commit: 5fda9b86 (test)
- FOUND commit: ee79d5f4 (migration)
