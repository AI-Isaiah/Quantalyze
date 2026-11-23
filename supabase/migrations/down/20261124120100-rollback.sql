-- ============================================================================
-- ROLLBACK for 20261124120100_jobledger_reset_ledger_and_bridge.sql
-- Phase 227 JOBLEDGER, plan 02 (HEAL-04, MT5D-01 reset half).
-- ============================================================================
-- Manual, off the auto-apply path. Run it as ONE transaction, so it either happens
-- whole or not at all (this file carries no transaction statements, like a migration):
--
--   psql --single-transaction -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here. What this file undoes:
--   1. RESTORES reset_stalled_compute_jobs(interval, jsonb) to the 20260516104201 body
--      (no ledger row, no bridge call).
--   2. RESTORES reclaim_stuck_compute_jobs(interval) to the 20260516104201 body.
-- CREATE OR REPLACE keeps each function's ACL and COMMENT, so nothing is re-granted.
--
-- ⚠️ DATA IS KEPT (the keep-data rule). The watchdog_reset and stall_reclaim rows already
-- written stay in public.compute_job_attempt_failures. Plan 01's rollback
-- (down/20261124120000-rollback.sql) owns the table and runs AFTER this one: it sets the
-- table aside, and this file's functions are the ones that write to it.
--
-- ⚠️ WHAT ROLLING BACK COSTS, stated. With the bodies restored, a watchdog reset or reclaim
-- calls no bridge again, so the defect this phase closed (TODOS [164.2-RECLAIM-PROVENANCE]:
-- a re-stamped curated sentence under the same job id loses its markers) is back, and a stall
-- leaves no record that reads as a reset.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261124120100 as applied while the schema no longer carries it, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same change
-- (or mark it reverted with `supabase migration repair --status reverted 20261124120100`
-- against the intended database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database whose two functions do not carry the migration. The DO
-- block after the change is catalogue-only too and aborts the whole rollback if either
-- restored body still writes the ledger or calls the bridge, or lost LIMIT 500 or
-- FOR UPDATE SKIP LOCKED. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.reset_stalled_compute_jobs(interval, jsonb)') IS NULL
     OR to_regprocedure('public.reclaim_stuck_compute_jobs(interval)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120100 refused: reset_stalled_compute_jobs or reclaim_stuck_compute_jobs does not exist. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF strpos(pg_get_functiondef(to_regprocedure('public.reset_stalled_compute_jobs(interval, jsonb)')), 'compute_job_attempt_failures') = 0
     AND strpos(pg_get_functiondef(to_regprocedure('public.reclaim_stuck_compute_jobs(interval)')), 'compute_job_attempt_failures') = 0 THEN
    RAISE EXCEPTION 'Rollback 20261124120100 refused: neither function writes compute_job_attempt_failures, so this database does not carry 20261124120100 (or it was already rolled back). Nothing was changed.';
  END IF;
END
$precondition$;

-- 1. reset_stalled_compute_jobs back to the 20260516104201 body, byte for byte.
-- ====================================================================
-- M-0781 (cont.): reset_stalled_compute_jobs — LIMIT + SKIP LOCKED
-- ====================================================================
-- Same per-tick bound applied to the per-kind watchdog. Each kind's
-- pass is independently bounded at 500. mig 117 P97 claim_token=NULL
-- invalidation preserved.
CREATE OR REPLACE FUNCTION reset_stalled_compute_jobs(
  p_stale_threshold    INTERVAL DEFAULT interval '10 minutes',
  p_per_kind_overrides JSONB    DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reset     INTEGER := 0;
  v_partial   INTEGER;
  v_kind      TEXT;
  v_threshold INTERVAL;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION 'reset_stalled_compute_jobs: p_stale_threshold must be > 0, got %', p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per-kind overrides: one bounded UPDATE per kind with its threshold.
  IF p_per_kind_overrides IS NOT NULL THEN
    FOR v_kind IN SELECT jsonb_object_keys(p_per_kind_overrides) LOOP
      v_threshold := (p_per_kind_overrides ->> v_kind)::INTERVAL;

      UPDATE compute_jobs
         SET status          = 'pending',
             claimed_at      = NULL,
             claimed_by      = NULL,
             next_attempt_at = now(),
             last_error      = 'worker_stalled',
             claim_token     = NULL    -- mig 117: P97 fence invalidation
       WHERE id IN (
         SELECT id FROM compute_jobs
           WHERE status = 'running'
             AND kind = v_kind
             AND claimed_at IS NOT NULL
             AND claimed_at < (now() - v_threshold)
           ORDER BY claimed_at
           LIMIT 500
           FOR UPDATE SKIP LOCKED
       );

      GET DIAGNOSTICS v_partial = ROW_COUNT;
      v_reset := v_reset + v_partial;
    END LOOP;
  END IF;

  -- Default threshold pass: kinds NOT in the override map.
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         last_error      = 'worker_stalled',
         claim_token     = NULL    -- mig 117: P97 fence invalidation
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'running'
         AND claimed_at IS NOT NULL
         AND claimed_at < (now() - p_stale_threshold)
         AND (
           p_per_kind_overrides IS NULL
           OR NOT (p_per_kind_overrides ? kind)
         )
       ORDER BY claimed_at
       LIMIT 500
       FOR UPDATE SKIP LOCKED
   );

  GET DIAGNOSTICS v_partial = ROW_COUNT;
  v_reset := v_reset + v_partial;

  RETURN v_reset;
END;
$$;

-- 2. reclaim_stuck_compute_jobs back to the 20260516104201 body, byte for byte.
-- ====================================================================
-- M-0781: reclaim_stuck_compute_jobs — LIMIT + SKIP LOCKED
-- ====================================================================
-- Bounds per-call reclaim at 500 rows and uses FOR UPDATE SKIP LOCKED
-- in the row-selection sub-query so the watchdog never blocks waiting
-- on a row currently being claimed. mig 109 P2 attempts-decrement and
-- reclaim_count bump are preserved.
--
-- Trade-off: a 10k-stick backlog now takes 20 watchdog ticks to drain
-- (every 10 min => 3h20). The status quo would lock 10k rows in one
-- tick, blocking every concurrent claim_compute_jobs caller for the
-- duration of the UPDATE. The bounded version trades drain time for
-- bounded lock duration — exactly what the operations team needs to
-- keep claim latency stable during incidents.
CREATE OR REPLACE FUNCTION reclaim_stuck_compute_jobs(
  p_older_than INTERVAL DEFAULT interval '10 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reclaimed INTEGER;
BEGIN
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         attempts        = GREATEST(attempts - 1, 0),
         reclaim_count   = reclaim_count + 1
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'running'
         AND claimed_at IS NOT NULL
         AND claimed_at < (now() - p_older_than)
       ORDER BY claimed_at
       LIMIT 500
       FOR UPDATE SKIP LOCKED
   );

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;

  RETURN v_reclaimed;
END;
$$;

-- ───────────── postcondition — CATALOGUE ONLY, reads no row
DO $postcondition$
DECLARE
  v_rs text := pg_get_functiondef(to_regprocedure('public.reset_stalled_compute_jobs(interval, jsonb)'));
  v_rc text := pg_get_functiondef(to_regprocedure('public.reclaim_stuck_compute_jobs(interval)'));
BEGIN
  IF strpos(v_rs, 'compute_job_attempt_failures') > 0 OR strpos(v_rs, 'sync_strategy_analytics_status') > 0 THEN
    RAISE EXCEPTION 'Rollback 20261124120100 failed: reset_stalled_compute_jobs still writes the ledger or calls the bridge';
  END IF;
  IF strpos(v_rc, 'compute_job_attempt_failures') > 0 OR strpos(v_rc, 'sync_strategy_analytics_status') > 0 THEN
    RAISE EXCEPTION 'Rollback 20261124120100 failed: reclaim_stuck_compute_jobs still writes the ledger or calls the bridge';
  END IF;
  IF strpos(v_rs, 'LIMIT 500') = 0 OR strpos(v_rs, 'FOR UPDATE SKIP LOCKED') = 0
     OR strpos(v_rc, 'LIMIT 500') = 0 OR strpos(v_rc, 'FOR UPDATE SKIP LOCKED') = 0 THEN
    RAISE EXCEPTION 'Rollback 20261124120100 failed: a restored body lost LIMIT 500 or FOR UPDATE SKIP LOCKED (M-0781)';
  END IF;
END
$postcondition$;
