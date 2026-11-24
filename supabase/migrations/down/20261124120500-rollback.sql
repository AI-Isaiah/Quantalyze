-- ============================================================================
-- ROLLBACK for 20261124120500_poll_positions_cohort.sql
-- Phase 227 JOBLEDGER, plan 06 (HEAL-05).
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
--   1. Re-issues public.enqueue_poll_positions_for_all_strategies() with the body of
--      20260412094449_compute_jobs_admin_and_defer.sql (STEP 4): published and pending_review
--      strategies only, no key liveness filter, and a done sync_trades job in the last 30
--      days as the only key-health signal. The loop body below the cohort is the same in both
--      versions.
--   2. Restores that migration's function COMMENT.
-- It does NOT touch the ACL (the migration's REVOKE restates what 20260412094449 already
-- issued, so there is nothing to undo) and it leaves strategy_sync_cursors alone, which the
-- migration only reads.
--
-- ⚠️ ROLLING BACK RE-OPENS TWO THINGS: private strategies stop getting position snapshots
-- again, and a strategy whose key is deactivated or disconnected is polled again as long as it
-- has a done sync_trades job inside the window.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records version
-- 20261124120500 as applied while the function carries the old body, and `supabase db push`
-- will not re-apply the migration. To re-apply it, delete that ledger row in the same change
-- (or mark it reverted with `supabase migration repair --status reverted 20261124120500`
-- against the intended database, after the marker query above names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before anything
-- changes, on a database whose function does not carry the new cohort. The DO block after the
-- change is catalogue-only too and aborts the whole rollback if the old body is not what is
-- deployed. Neither reads a row.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_fn oid;
BEGIN
  v_fn := to_regprocedure('public.enqueue_poll_positions_for_all_strategies()');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120500 refused: public.enqueue_poll_positions_for_all_strategies() is not present. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF pg_get_functiondef(v_fn) NOT LIKE '%strategy_sync_cursors%' THEN
    RAISE EXCEPTION 'Rollback 20261124120500 refused: the deployed enqueue_poll_positions_for_all_strategies() does not read strategy_sync_cursors, so this database does not carry 20261124120500. Nothing was changed.';
  END IF;
END
$precondition$;

-- ───────────── the 20260412094449 body
CREATE OR REPLACE FUNCTION enqueue_poll_positions_for_all_strategies()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id UUID;
  v_exchange TEXT;
  v_enqueued INTEGER := 0;
  v_job_id UUID;
  v_existing_count INTEGER;
BEGIN
  FOR v_strategy_id, v_exchange IN
    SELECT DISTINCT s.id, ak.exchange
      FROM strategies s
      JOIN api_keys ak ON ak.id = s.api_key_id
      WHERE s.api_key_id IS NOT NULL
        AND s.status IN ('published', 'pending_review')
        AND EXISTS (
          SELECT 1 FROM compute_jobs cj
            WHERE cj.strategy_id = s.id
              AND cj.kind = 'sync_trades'
              AND cj.status = 'done'
              AND cj.updated_at > (now() - interval '30 days')
        )
  LOOP
    -- Count pre-existing in-flight poll_positions jobs for this strategy
    -- BEFORE the enqueue call, so we can detect whether enqueue_compute_job
    -- returned an existing id (no new row) vs created a new one.
    SELECT count(*) INTO v_existing_count
      FROM compute_jobs
      WHERE strategy_id = v_strategy_id
        AND kind = 'poll_positions'
        AND status IN ('pending', 'running', 'done_pending_children');

    v_job_id := enqueue_compute_job(
      v_strategy_id,
      'poll_positions',
      'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_strategy_id::text,
      '{}'::UUID[],
      v_exchange,
      jsonb_build_object('enqueued_by', 'daily_loop', 'enqueued_at', now())
    );

    IF v_existing_count = 0 AND v_job_id IS NOT NULL THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION enqueue_poll_positions_for_all_strategies IS
  'Daily fanout: enqueues a poll_positions job per qualifying strategy. Idempotent via enqueue_compute_job partial unique index. Returns count of newly-enqueued jobs. Called by worker daily loop under advisory lock to prevent multi-replica duplication. See migration 033.';

-- ───────────── postcondition — CATALOGUE ONLY, reads no row
DO $postcondition$
DECLARE
  v_fn oid;
BEGIN
  v_fn := to_regprocedure('public.enqueue_poll_positions_for_all_strategies()');
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261124120500 failed: public.enqueue_poll_positions_for_all_strategies() does not resolve after the change';
  END IF;
  IF pg_get_functiondef(v_fn) LIKE '%strategy_sync_cursors%' THEN
    RAISE EXCEPTION 'Rollback 20261124120500 failed: the deployed body still reads strategy_sync_cursors';
  END IF;
  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261124120500 failed: anon or authenticated holds EXECUTE on the daily poll fan-out';
  END IF;
END
$postcondition$;
