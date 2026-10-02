-- ============================================================================
-- ROLLBACK for 20260928140000_refresh_fanout_bootstraps_zero_snapshot_books.sql
-- Phase 167.1.2 ACCOUNTTRUTH, plan 12 (PR C), decision D-17.
-- ============================================================================
-- ⚠️ JOBS ALREADY RUN ARE NOT UNDONE. Every reconstruct_allocator_history and
-- refresh_allocator_equity_daily job the bootstrapped fan-out enqueued, and
-- that the worker already ran, has written allocator_equity_snapshots rows.
-- This file restores the function only; it deletes no row and no job.
--
-- Manual, off the auto-apply path, applied by its own migration PR. What it
-- restores, VERBATIM from 20260422101911_api_keys_disconnected_at.sql (075):
--   * public.enqueue_refresh_allocator_equity_for_all()'s body (the refresh
--     for active, non-disconnected keys whose owner already has a snapshot row;
--     no bootstrap reconstruct);
--   * its COMMENT;
--   * the grants supabase/schema/baseline.sql carries for it: REVOKE ALL FROM
--     PUBLIC, GRANT ALL TO service_role.
-- The signature does not change, so nothing that calls the function (the
-- pg_cron job only) needs to move with it.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20260928140000 as applied while the function body is 075's.
-- To re-apply the migration, delete that ledger row in the same change that
-- re-applies it (or mark it reverted with `supabase migration repair --status
-- reverted 20260928140000` against the intended database, after the marker
-- query in CLAUDE.md names that database).
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the
-- whole rollback, if the restored body still declares the bootstrap cap or if
-- anon or authenticated can EXECUTE the function.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.enqueue_refresh_allocator_equity_for_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    FOR v_key IN
      SELECT ak.id AS api_key_id, ak.user_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.disconnected_at IS NULL  -- migration 075
        AND EXISTS (
          SELECT 1 FROM allocator_equity_snapshots aes
          WHERE aes.allocator_id = ak.user_id
          LIMIT 1
        )
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'refresh_allocator_equity_daily',
          p_idempotency_key := 'daily-equity-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
END;
$$;

COMMENT ON FUNCTION public.enqueue_refresh_allocator_equity_for_all IS
  'Daily cron fan-out for per-allocator equity refresh. Migration 075 added disconnected_at IS NULL filter so soft-disconnected keys stop receiving refresh jobs. Preserves advisory lock + per-key loop from migration 070.';

REVOKE ALL ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() TO service_role;

-- ───────────── post-verify — CATALOGUE ONLY, reads no row
DO $postverify$
DECLARE
  v_oid  oid := to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()');
  v_body text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20260928140000: public.enqueue_refresh_allocator_equity_for_all() is missing after the restore';
  END IF;
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR position('v_bootstrap_cap' in v_body) > 0 THEN
    RAISE EXCEPTION 'Rollback 20260928140000: the restored body is unreadable or still declares the bootstrap cap, so 075''s body was not restored';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20260928140000: anon or authenticated can EXECUTE enqueue_refresh_allocator_equity_for_all after the restore';
  END IF;
  RAISE NOTICE 'Rollback 20260928140000: migration 075''s body, COMMENT and grants restored.';
END
$postverify$;

COMMIT;
