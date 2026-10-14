-- ============================================================================
-- ROLLBACK for 20261021120000_refresh_fanout_owed_key_reconstruct.sql
-- Phase 167.1.2.1 RECONMARKER, plan 04 (PR 2), decisions D-06, D-09, D-17.
-- ============================================================================
-- ⚠️ JOBS ALREADY RUN AND ATTEMPTS ALREADY COUNTED ARE NOT UNDONE. Every
-- reconstruct_allocator_history job the owed-key fan-out enqueued, and that the
-- worker already ran, has written allocator_equity_snapshots rows (a sole key's
-- reconstruct REPLACES the allocator's rows), and every enqueue added one to
-- api_keys.history_reconstruct_attempts. This file restores the function only; it
-- deletes no row and no job and resets no count. The two columns STAY: the PR 1
-- rollback (20261014120000-rollback.sql) drops them and must run AFTER this one.
--
-- Manual, off the auto-apply path, applied by its own migration PR. What it
-- restores, VERBATIM from 20260928140000_refresh_fanout_bootstraps_zero_snapshot_books.sql
-- (copied from that file, never from memory):
--   * public.enqueue_refresh_allocator_equity_for_all()'s body (the bootstrap of a
--     book with ZERO snapshots, whole books under the per-run cap, then the refresh);
--   * its COMMENT;
--   * its grants: REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT ALL TO
--     service_role.
-- The signature does not change, so nothing that calls the function (the pg_cron
-- job only) needs to move with it. The backfill statement of the forward
-- migration is idempotent and is not reversed.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261021120000 as applied while the function body is
-- 20260928140000's. To re-apply the migration, delete that ledger row in the same
-- change (or `supabase migration repair --status reverted 20261021120000` against
-- the intended database, after the marker query in CLAUDE.md names that database).
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if the restored body is unreadable, lacks the bootstrap cap, still
-- declares the attempt cap, or if anon or authenticated can EXECUTE the function
-- or service_role cannot.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.enqueue_refresh_allocator_equity_for_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   RECORD;
  v_book  RECORD;
  v_rkey  RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
  -- A reconstruct runs up to 30 minutes, and the first run after this
  -- migration applies must not flood the worker. The cap is soft at book
  -- granularity: splitting a book lets a sibling's first snapshot row strand
  -- the rest. Books beyond it drain on later runs (the cap is per call, and
  -- pg_cron calls once a day).
  v_bootstrap_cap CONSTANT integer := 25;
  v_bootstrap_enqueued integer := 0;
  v_boot_key uuid;
  v_loop_state text;
  v_loop_msg   text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    -- Phase 167.1.2 D-17: bootstrap a zero-snapshot book. Whole books, newest
    -- qualifying key first; never split a book across runs.
    -- ISOLATED (167.1.2-12 review SFH-02): this loop runs in its own
    -- sub-block. An error that escapes the per-book block below (the
    -- book-selection query itself, for one) rolls back every bootstrap
    -- enqueue of this run, logs a WARNING and falls through to the refresh
    -- loop, so a failure here never cancels the daily refresh of every
    -- allocator. That is safe by construction: a book whose reconstructs were
    -- rolled back is not bootstrapped, so the refresh loop still withholds its
    -- refresh.
    BEGIN
      FOR v_book IN
        SELECT bq.user_id AS owner_id
        FROM api_keys bq
        WHERE bq.is_active = TRUE
          AND bq.sync_status IS DISTINCT FROM 'revoked'
          AND coalesce(bq.sync_status, '') NOT IN ('sign_in_failed', 'error')
          AND bq.disconnected_at IS NULL
          AND lower(bq.exchange) <> 'deribit'
          AND NOT EXISTS (SELECT 1 FROM strategies bqs WHERE bqs.api_key_id = bq.id AND bqs.user_id = bq.user_id AND bqs.status <> 'archived')
          AND NOT EXISTS (SELECT 1 FROM strategy_keys bqsk JOIN strategies bqks ON bqks.id = bqsk.strategy_id WHERE bqsk.api_key_id = bq.id AND bqks.user_id = bq.user_id AND bqks.status <> 'archived')
          AND NOT EXISTS (SELECT 1 FROM compute_jobs bqj WHERE bqj.api_key_id = bq.id AND bqj.kind = 'reconstruct_allocator_history' AND bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done'))
          AND NOT EXISTS (SELECT 1 FROM allocator_equity_snapshots bqe WHERE bqe.allocator_id = bq.user_id)
        GROUP BY bq.user_id
        ORDER BY max(bq.created_at) DESC, bq.user_id
      LOOP
        EXIT WHEN v_bootstrap_enqueued >= v_bootstrap_cap;
        -- ONE BOOK AT A TIME (167.1.2-12 review SFH-R2-03): any other error
        -- while enqueueing this book rolls back THIS book's enqueues only and
        -- the loop moves on to the next book, so one key whose enqueue fails
        -- every day cannot cancel every other book's bootstrap. The skipped
        -- book has no in-flight-or-done reconstruct row, so the refresh loop
        -- still withholds its refresh, and the next run takes it again.
        v_boot_key := NULL;
        BEGIN
          FOR v_rkey IN
            SELECT rk.id AS api_key_id
            FROM api_keys rk
            WHERE rk.user_id = v_book.owner_id
              AND rk.is_active = TRUE
              AND rk.sync_status IS DISTINCT FROM 'revoked'
              AND coalesce(rk.sync_status, '') NOT IN ('sign_in_failed', 'error')
              AND rk.disconnected_at IS NULL
              AND lower(rk.exchange) <> 'deribit'
              AND NOT EXISTS (SELECT 1 FROM strategies rks WHERE rks.api_key_id = rk.id AND rks.user_id = rk.user_id AND rks.status <> 'archived')
              AND NOT EXISTS (SELECT 1 FROM strategy_keys rksk JOIN strategies rkks ON rkks.id = rksk.strategy_id WHERE rksk.api_key_id = rk.id AND rkks.user_id = rk.user_id AND rkks.status <> 'archived')
              AND NOT EXISTS (SELECT 1 FROM compute_jobs rkj WHERE rkj.api_key_id = rk.id AND rkj.kind = 'reconstruct_allocator_history' AND rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done'))
            ORDER BY rk.created_at DESC, rk.id
          LOOP
            v_boot_key := v_rkey.api_key_id;
            BEGIN
              PERFORM enqueue_compute_job(
                p_strategy_id     := NULL,
                p_kind            := 'reconstruct_allocator_history',
                p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial',
                p_api_key_id      := v_rkey.api_key_id
              );
            -- serialization_failure is the enqueue helper's lost-race signal
            -- (the winner already left the in-flight statuses). unique_violation
            -- cannot fire today (the helper inserts ON CONFLICT DO NOTHING) and
            -- is kept as belt. Either skips ONE key, never the run.
            EXCEPTION WHEN unique_violation OR serialization_failure THEN
              RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: reconstruct enqueue skipped for api_key % (SQLSTATE %)', v_rkey.api_key_id, SQLSTATE;
            END;
            v_bootstrap_enqueued := v_bootstrap_enqueued + 1;
          END LOOP;
        EXCEPTION WHEN OTHERS THEN
          -- v_boot_key is the key being enqueued, or NULL when the per-key
          -- query itself failed before the first key.
          RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap of one book was rolled back and skipped; the other books continue (api_key %, SQLSTATE %)', v_boot_key, SQLSTATE;
          -- DURABLE TRACE (review SFH-R2-02, MIG-R2-01): a WARNING lives only
          -- in the server log, and pg_cron records the run as succeeded. One
          -- public.cron_runs row per skipped book, the sink the ledger fan-outs
          -- write their candidate_enqueue_failed rows to; row security lets
          -- only platform admins and service_role read it. Deliberately NOT
          -- wrapped: if the sink refuses this row, the error reaches the
          -- sub-block below, which rolls this run's bootstrap back and writes
          -- its own row, so a skip is never left with no trace at all.
          INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
          VALUES ('equity_refresh_fanout', 'error', now(), 'bootstrap_book_skipped',
                  jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                     'cause', 'bootstrap_book_skipped',
                                     'owner_id', v_book.owner_id,
                                     'api_key_id', v_boot_key,
                                     'sqlstate', SQLSTATE,
                                     'message', SQLERRM));
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      v_loop_state := SQLSTATE;
      v_loop_msg   := SQLERRM;
      RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap loop failed and was rolled back; the refresh loop still runs (SQLSTATE %: %)', v_loop_state, v_loop_msg;
      -- DURABLE TRACE (review SFH-R2-02, MIG-R2-01), the same sink as the
      -- per-book row. Wrapped, unlike that row: this is the last handler
      -- before the refresh loop, and a sink that refuses this row too must
      -- not cancel the daily refresh of every allocator.
      BEGIN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('equity_refresh_fanout', 'error', now(), 'bootstrap_loop_failed',
                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                   'cause', 'bootstrap_loop_failed',
                                   'sqlstate', v_loop_state,
                                   'message', v_loop_msg));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap failure row could not be written (SQLSTATE %)', SQLSTATE;
      END;
    END;

    -- The refresh loop runs AFTER the bootstrap loop on purpose: its
    -- bootstrapped test reads the reconstruct rows the loop above just
    -- enqueued in this transaction, so a book taken this run is refreshed this
    -- run, and a book beyond the cap is refreshed only once a later run has
    -- enqueued its reconstructs. A reconstruct row counts only while it is in
    -- flight or done: a book whose only reconstruct ended failed_final is not
    -- bootstrapped, so no refresh row closes its zero-snapshot gate before the
    -- retry the loop above enqueues.
    FOR v_key IN
      SELECT ak.id AS api_key_id, ak.user_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.sync_status IS DISTINCT FROM 'revoked'
        AND ak.disconnected_at IS NULL  -- migration 075
        AND (
          EXISTS (SELECT 1 FROM allocator_equity_snapshots aes WHERE aes.allocator_id = ak.user_id)
          OR (
            NOT EXISTS (SELECT 1 FROM strategies aks WHERE aks.api_key_id = ak.id AND aks.user_id = ak.user_id AND aks.status <> 'archived')
            AND NOT EXISTS (SELECT 1 FROM strategy_keys aksk JOIN strategies akks ON akks.id = aksk.strategy_id WHERE aksk.api_key_id = ak.id AND akks.user_id = ak.user_id AND akks.status <> 'archived')
            AND NOT EXISTS (
              SELECT 1
              FROM api_keys bk
              WHERE bk.user_id = ak.user_id
                AND bk.is_active = TRUE
                AND bk.sync_status IS DISTINCT FROM 'revoked'
                AND coalesce(bk.sync_status, '') NOT IN ('sign_in_failed', 'error')
                AND bk.disconnected_at IS NULL
                AND lower(bk.exchange) <> 'deribit'
                AND NOT EXISTS (SELECT 1 FROM strategies bks WHERE bks.api_key_id = bk.id AND bks.user_id = bk.user_id AND bks.status <> 'archived')
                AND NOT EXISTS (SELECT 1 FROM strategy_keys bksk JOIN strategies bkks ON bkks.id = bksk.strategy_id WHERE bksk.api_key_id = bk.id AND bkks.user_id = bk.user_id AND bkks.status <> 'archived')
                AND NOT EXISTS (SELECT 1 FROM compute_jobs bkj WHERE bkj.api_key_id = bk.id AND bkj.kind = 'reconstruct_allocator_history' AND bkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done'))
            )
          )
        )
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'refresh_allocator_equity_daily',
          p_idempotency_key := 'daily-equity-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation OR serialization_failure THEN
        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: refresh enqueue skipped for api_key % (SQLSTATE %)', v_key.api_key_id, SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() TO service_role;

COMMENT ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() IS
  'Daily cron fan-out for the per-allocator legacy equity store. Two arms, inside one advisory lock. (1) Bootstrap, first, in its own sub-block, one book per inner block (an error enqueueing one book rolls back and skips that book only; an error outside any book rolls back every bootstrap enqueue of the run; neither cancels the refresh; both are logged as a WARNING and as one public.cron_runs row, cron_name equity_refresh_fanout, error bootstrap_book_skipped or bootstrap_loop_failed): for an owner with ZERO allocator_equity_snapshots rows, one reconstruct_allocator_history job for every qualifying key with no reconstruct job in flight (pending, running, done_pending_children, failed_retry) or done, so a failed_final reconstruct is retried; qualifying = active, not revoked, sync_status not sign_in_failed or error, not disconnected, not linked to one of its owner''s non-archived strategies (strategies.api_key_id or strategy_keys, mirroring deriveStrategyLinkedKeyIds) and not Deribit. The job carries idempotency key reconstruct-alloc-<key>-initial, the RPC''s correlation label; dedupe is the in-flight partial unique index plus the in-flight-or-done gate, not that key. Whole books, newest key first, stopping before a new book once 25 keys (v_bootstrap_cap) were enqueued this call. (2) Refresh: one refresh_allocator_equity_daily job per eligible key (active, not revoked, not disconnected) whose owner has a snapshot row, or which is unlinked on a book where every qualifying key has a reconstruct job in flight or done. A lost enqueue race (serialization_failure) skips one key with a WARNING. Phase 167.1.2 D-17; re-based on migration 075.';

-- ───────────── post-verify — CATALOGUE ONLY, reads no row
DO $postverify$
DECLARE
  v_oid  oid := to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()');
  v_body text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261021120000: public.enqueue_refresh_allocator_equity_for_all() is missing after the restore';
  END IF;
  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL OR position('v_bootstrap_cap' in v_body) = 0 THEN
    RAISE EXCEPTION 'Rollback 20261021120000: the restored body is unreadable or lacks the bootstrap cap, so 20260928140000''s body was not restored';
  END IF;
  IF position('v_reconstruct_attempt_cap' in v_body) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261021120000: the restored body still declares the attempt cap, so the owed-key fan-out was not rolled back';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261021120000: anon or authenticated can EXECUTE enqueue_refresh_allocator_equity_for_all after the restore';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261021120000: service_role lost EXECUTE on enqueue_refresh_allocator_equity_for_all after the restore';
  END IF;
  RAISE NOTICE 'Rollback 20261021120000: 20260928140000''s body, COMMENT and grants restored.';
END
$postverify$;

COMMIT;
