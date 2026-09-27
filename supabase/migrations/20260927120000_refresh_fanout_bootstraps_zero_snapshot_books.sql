-- ==========================================================================
-- Phase 167.1.2 (ACCOUNTTRUTH), plan 12, success criterion 7 (a) and (d),
-- decision D-17: the daily equity fan-out
-- `public.enqueue_refresh_allocator_equity_for_all()` bootstraps a book that
-- has ZERO legacy equity snapshots.
--
-- THE DEFECT. The fan-out enqueued `refresh_allocator_equity_daily` only for a
-- key whose owner already had an `allocator_equity_snapshots` row, and the only
-- job that writes a book's FIRST rows is `reconstruct_allocator_history`, which
-- only a user-initiated sync enqueues. A key connected any other way, or whose
-- first sync collided with an in-flight poll, left its book at zero, and the
-- daily refresh then skipped it every day. MEASURED 2026-09-27 on PROD (the
-- ROADMAP's item 7, counts only): since 2026-09-24 there had been 0
-- reconstruct_allocator_history jobs platform-wide; the 05:00 refresh ran 22
-- jobs a day, all done; a key connected on 2026-09-24 never had its history
-- reconstructed, so its book held zero snapshots from its first day.
--
-- LINEAGE, MEASURED FROM THE FILES:
--   070 (20260420213754_allocator_equity_snapshots, STEP 7) created the
--       function: advisory lock, one refresh job per active key whose owner
--       already has a snapshot row, unique_violation swallow.
--   075 (20260422101911_api_keys_disconnected_at) re-created it with the
--       disconnected_at filter. Its body is the one PROD runs (the committed
--       dump and the committed snapshot agree).
--   THIS FILE re-bases on 075.
--
-- RE-BASE DISCIPLINE, re-measured at execution, 2026-09-27 UTC:
--   grep -n -iE "create (or replace )?function[[:space:]]+(public\.)?enqueue_refresh_allocator_equity_for_all" \
--     supabase/migrations/*.sql
-- returned TWO CREATE statements: 20260420213754 (070) and 20260422101911
-- (075). The newest is 075, the body re-based here. Later files name the
-- function in comments only. FUTURE EDITORS: re-base on THIS file (or a newer
-- one).
--
-- WHICH CONNECT PATH STARTS A KEY'S HISTORY (D-17 (a) to (d), measured in code):
--   (a) The ONLY code path that enqueues a key's first reconstruct is the
--       allocator Exchanges page (add key, reconnect) ->
--       /api/allocator/holdings/sync -> public.request_allocator_holdings_sync.
--       The manager wizard, the key manager and the composite add route
--       enqueue none.
--   (b) Since 20260924233749 that RPC returns {already_inflight} BEFORE its
--       reconstruct gate whenever a poll job for the key is pending, running or
--       done_pending_children, so a connect that collides with an in-flight
--       poll enqueues no reconstruct.
--   (c) The RPC's gate and the worker's own "already reconstructed" check read
--       compute_jobs, and the retention_compute_jobs_done cron deletes done
--       rows after 30 days (retention_compute_jobs_failed deletes failed rows
--       after 90), so "this key was reconstructed" is not a durable fact
--       anywhere. A cron arm gated on "no reconstruct job for this key" alone
--       would re-reconstruct every allocator key each month. That is why the
--       bootstrap below fires ONLY for a book with zero snapshots: that is the
--       durable form of the defect.
--   (d) The measured PROD case cannot be attributed from code: PROD then ran
--       migration 076's body, which has no early return, so an Exchanges-page
--       connect would have enqueued one. Either another connect path was used or
--       the sync request did not reach the RPC. The fix does not depend on which.
--   The RPC is DELIBERATELY NOT re-based: its early return was deliberate
--   (migration 067's shape, Phase 164.9.1 D-09), and the zero-snapshot arm
--   below covers the collision case whatever the connect path.
--   ⚠️ RESIDUAL, recorded and not fixed (plan 12's R-12-1, unrouted): a book
--   that ALREADY has snapshots and adds a key whose first sync collided gets no
--   backfill for that key. It touches only the legacy
--   allocator_equity_snapshots store.
--
-- THE STRATEGY-LINK DISCRIMINATOR mirrors deriveStrategyLinkedKeyIds in
-- src/lib/queries.ts: a key is STRATEGY-LINKED when one of its OWNER's
-- strategies that is not archived names it, either directly through
-- strategies.api_key_id or through a strategy_keys row. A key whose only link
-- is an archived strategy counts as unlinked (the W-4 rule).
-- ⚠️ RESIDUAL, accepted: a manager's key that was never linked to a strategy
-- (a wizard draft that never completed, for one) is not strategy-linked, so on
-- a zero-snapshot book it gets the daily refresh and one capped reconstruct.
-- The per-run cap and the one-shot reconstruct gate bound it, and the refresh
-- writes no row for a book with no holdings (reason no_holdings_today), so a
-- bootstrap refresh can never write a $0 day.
--
-- WHY THE CAP SELECTS WHOLE BOOKS, AND WHY THE REFRESH WAITS (revision 1). A
-- per-key cap with an uncapped refresh strands keys: a sibling's first snapshot
-- row closes the zero-snapshot gate before the capped-out key's reconstruct is
-- ever enqueued, and that key's history then stays at zero forever. So the
-- reconstruct loop runs FIRST, takes whole books and never splits one, and the
-- refresh for a zero-snapshot book is withheld until every qualifying key on it
-- has a reconstruct job in flight or done. The cap is therefore soft at book
-- granularity: one book with N qualifying keys enqueues all N in one run.
-- Books beyond the cap drain on later runs (the cap is per call, and pg_cron
-- calls the function once a day).
--
-- WHICH RECONSTRUCT ROW COUNTS (167.1.2-12 review SFH-01). A key counts as
-- reconstructed only while its reconstruct_allocator_history row is IN FLIGHT
-- (pending, running, done_pending_children, failed_retry) or DONE. That is
-- request_allocator_holdings_sync's rule (done, pending, running,
-- done_pending_children) plus failed_retry: the worker claims a failed_retry
-- row again, so it is in flight, and enqueue_ledger_composite_refresh and
-- enqueue_ledger_refresh_for_strategies count it in flight for the same
-- reason. ⚠️ The RPC omits failed_retry, so a user sync during a scheduled
-- retry enqueues a second reconstruct; that is outside this file and is
-- flagged for cleanup, not fixed here. A failed_final row does NOT count: an
-- earlier version counted a reconstruct row in any status, so a failed
-- reconstruct made the book bootstrapped, the refresh wrote the book's first
-- row, and the key's backfill was lost for good.
--
-- REPEAT BEHAVIOUR, stated (T-167.1.2-42):
--   * A zero-snapshot book whose qualifying key's reconstruct ended
--     failed_final is re-enqueued on the next run, under the per-run cap. A
--     key that fails every time retries once a day while its book stays at
--     zero snapshots (the refresh writes no row for a book with no holdings).
--   * A zero-snapshot book whose done reconstruct wrote no rows is
--     re-enqueued once that done row is reaped (after 30 days), under the cap.
-- ⚠️ RESIDUAL, recorded (T-167.1.2-58): the refresh is enqueued in the SAME
-- run as the reconstruct it waits for, because an in-flight row counts. If
-- holdings exist, the refresh writes today's row before the 30-minute
-- reconstruct ends, and a reconstruct that then ends failed_final leaves a
-- book WITH snapshots, which this function never bootstraps again (D-17 (c)).
-- The key's next sync through request_allocator_holdings_sync recovers it,
-- because that RPC's gate ignores failed rows. Closing it here would mean
-- withholding the refresh until every reconstruct is DONE, which re-decides
-- D-17's same-run refresh; that is not this file's call.
--
-- THREATS, as this file mitigates them:
--   T-167.1.2-42 (worker flood): the per-run cap, soft at book granularity;
--     the zero-snapshot gate; the in-flight-or-done job gate; Deribit keys
--     excluded.
--   T-167.1.2-58 (a qualifying key stranded at zero): the reconstruct loop
--     runs first and never splits a book, and the refresh waits until every
--     qualifying key has a reconstruct row in flight or done, so no first
--     snapshot row closes the gate before every key's reconstruct is
--     enqueued. A failed reconstruct no longer counts. Residual above.
--
-- DEPLOY NOTE (D-17, amends D-12's PR C list). This migration adds no column,
-- no table, no type and no signature change, and nothing in PR C reads anything
-- it creates. The function it replaces is called only by pg_cron. It is correct
-- whether it applies before or after the Vercel and Railway deploys. The three
-- migration reviewers (migration-reviewer, rls-policy-auditor,
-- silent-failure-hunter) run on PR C before it merges, because a merge
-- auto-applies to TEST and then PROD with no human stop (plan 12 Task 4).
--
-- THE BODY IS 075's, VERBATIM, WITH EXACTLY THESE EDITS:
--   (1) The refresh loop's key predicate becomes the canonical eligible
--       predicate: active, sync_status not revoked, not disconnected.
--   Definitions used by (2) and (3). STRATEGY-LINKED: see the discriminator
--   above. QUALIFYING: eligible per (1), not strategy-linked, and not a
--   Deribit key (the worker refuses Deribit reconstruction permanently).
--   BOOTSTRAPPED book: no qualifying key of its owner lacks a compute_jobs row
--   of kind reconstruct_allocator_history in flight or done (a book whose only
--   unlinked keys are Deribit is bootstrapped vacuously).
--   (3) A NEW reconstruct loop, placed BEFORE the refresh loop inside the same
--       lock and the same exception wrapper. It iterates zero-snapshot books
--       (owners with no allocator_equity_snapshots row and at least one
--       qualifying key with no reconstruct row in flight or done), newest such
--       key first, then owner id. Before each book it stops once the per-run
--       count has reached the declared cap. For every qualifying key of the
--       book with no such row it enqueues one reconstruct_allocator_history
--       job with the idempotency key 'reconstruct-alloc-<key>-initial', the one
--       request_allocator_holdings_sync uses, so the cron path and the user
--       path name one job; a unique_violation is swallowed as the RPC does.
--   (2) The refresh loop's snapshot conjunct becomes: the owner has a snapshot
--       row, OR the key is not strategy-linked and its book is BOOTSTRAPPED.
--       It runs after (3) on purpose: its bootstrapped test reads the
--       reconstruct rows (3) just enqueued in the same transaction.
--   (4) Loop (3) runs in its own sub-block (review SFH-02). Its WHEN OTHERS
--       logs a WARNING and falls through to the refresh loop, and the
--       savepoint rolls back every bootstrap enqueue of the run, so no book is
--       left half-bootstrapped. The refresh loop stays inside 075's
--       unlock-and-re-raise wrapper.
--   (5) Each enqueue call in BOTH loops catches unique_violation OR
--       serialization_failure and RAISEs a WARNING naming the api_key and the
--       SQLSTATE, then continues. 075 swallowed unique_violation silently,
--       which cannot fire (the helper inserts ON CONFLICT DO NOTHING), while
--       the helper's real lost-race signal, serialization_failure (40001),
--       aborted the whole run.
--   Every copy of the eligible predicate, the discriminator and the
--   qualifying test uses table aliases unique to that copy (book selection,
--   per-key selection, refresh loop, bootstrapped subquery), so a mutation can
--   name one copy exactly. Every copy of the QUALIFYING test carries the
--   same in-flight-or-done status list.
-- The lock key, the refresh idempotency key, RETURNS VOID, SECURITY DEFINER and
-- the search_path pin are 075's. The CREATE is now schema-qualified.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- The hash below is the `live` column (fifth TSV field) of
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/enqueue_refresh_allocator_equity_for_all.sql \
--     <origin/main's copy of that file>
-- measured 2026-09-27 UTC, i.e. the normalized body origin/main carries today,
-- standing in for PROD. It is EARNED only if VAC-04 on the PR reports the SAME
-- hash for PROD. If it differs, PROD drifted out of band: fold the difference
-- in and re-derive, never edit the pragma to match a gate log.
--   enqueue_refresh_allocator_equity_for_all/0
-- prod-body-ack: 158422dc6b4acbf83e109baa6d162352daef1a04c0c498fe7f2d20c737fa94e8
--
-- GRANTS ARE RE-CONVERGED, NOT ASSUMED: EXECUTE is revoked from PUBLIC, anon
-- and authenticated and granted to service_role only, then asserted below.
--
-- REVERSIBLE: supabase/migrations/down/20260927120000-rollback.sql restores
-- 075's body, grants and COMMENT. Reconstruct and refresh jobs that already ran
-- are not undone.
--
-- Transaction style: NO explicit BEGIN/COMMIT. This migration writes ZERO table
-- data and its DO block reads catalogues only, so it applies on the empty TEST
-- database ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Every RAISE format string
-- is a single literal. Execution proof is the SQL gate
-- supabase/tests/test_refresh_fanout_zero_snapshot_bootstrap.sql.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ⚠️ SCHEMA-QUALIFIED DELIBERATELY. An unqualified CREATE OR REPLACE resolves
-- against the SESSION search_path and could create a second function in
-- another schema, with default privileges.
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
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    -- Phase 167.1.2 D-17: bootstrap a zero-snapshot book. Whole books, newest
    -- qualifying key first; never split a book across runs.
    -- ISOLATED (167.1.2-12 review SFH-02): this loop runs in its own
    -- sub-block. Any error in it rolls back every bootstrap enqueue of this
    -- run, logs a WARNING and falls through to the refresh loop, so a failure
    -- here never cancels the daily refresh of every allocator. That is safe by
    -- construction: a book whose reconstructs were rolled back is not
    -- bootstrapped, so the refresh loop still withholds its refresh.
    BEGIN
      FOR v_book IN
        SELECT bq.user_id AS owner_id
        FROM api_keys bq
        WHERE bq.is_active = TRUE
          AND bq.sync_status IS DISTINCT FROM 'revoked'
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
        FOR v_rkey IN
          SELECT rk.id AS api_key_id
          FROM api_keys rk
          WHERE rk.user_id = v_book.owner_id
            AND rk.is_active = TRUE
            AND rk.sync_status IS DISTINCT FROM 'revoked'
            AND rk.disconnected_at IS NULL
            AND lower(rk.exchange) <> 'deribit'
            AND NOT EXISTS (SELECT 1 FROM strategies rks WHERE rks.api_key_id = rk.id AND rks.user_id = rk.user_id AND rks.status <> 'archived')
            AND NOT EXISTS (SELECT 1 FROM strategy_keys rksk JOIN strategies rkks ON rkks.id = rksk.strategy_id WHERE rksk.api_key_id = rk.id AND rkks.user_id = rk.user_id AND rkks.status <> 'archived')
            AND NOT EXISTS (SELECT 1 FROM compute_jobs rkj WHERE rkj.api_key_id = rk.id AND rkj.kind = 'reconstruct_allocator_history' AND rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'done'))
          ORDER BY rk.created_at DESC, rk.id
        LOOP
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
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the bootstrap loop failed and was rolled back; the refresh loop still runs (SQLSTATE %: %)', SQLSTATE, SQLERRM;
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
  'Daily cron fan-out for the per-allocator legacy equity store. Two arms, inside one advisory lock. (1) Bootstrap, first, in its own sub-block (an error there is logged as a WARNING, rolls back every bootstrap enqueue of the run and never cancels the refresh): for an owner with ZERO allocator_equity_snapshots rows, one reconstruct_allocator_history job (idempotency key reconstruct-alloc-<key>-initial, the one request_allocator_holdings_sync uses) for every qualifying key with no reconstruct job in flight (pending, running, done_pending_children, failed_retry) or done, so a failed_final reconstruct is retried; qualifying = active, not revoked, not disconnected, not linked to one of its owner''s non-archived strategies (strategies.api_key_id or strategy_keys, mirroring deriveStrategyLinkedKeyIds) and not Deribit. Whole books, newest key first, stopping before a new book once 25 keys (v_bootstrap_cap) were enqueued this call. (2) Refresh: one refresh_allocator_equity_daily job per eligible key (active, not revoked, not disconnected) whose owner has a snapshot row, or which is unlinked on a book where every qualifying key has a reconstruct job in flight or done. A lost enqueue race (serialization_failure) skips one key with a WARNING. Phase 167.1.2 D-17; re-based on migration 075.';

-- --------------------------------------------------------------------------
-- Self-verify. CATALOGUE-ONLY: to_regprocedure, pg_get_functiondef,
-- pg_proc.proconfig, to_regrole and has_function_privilege. No table data.
--
-- These are COPY-CHECKS on a comment-stripped body. They deliberately assert
-- only needles every mutation in the SQL gate leaves intact (SECDEF, the
-- search_path pin, the lock key, the two kind literals and the cap's declared
-- NAME), so a mutated apply survives and the gate's arm is the first failure.
-- The behaviour itself (the revoked, disconnected, Deribit and archived terms,
-- the bootstrapped conjunct, the idempotency key, the cap value and where the
-- cap check sits) is pinned by the gate's arms, never here.
-- --------------------------------------------------------------------------
DO $selfverify$
DECLARE
  v_oid  oid := to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()');
  v_fn   text;
  v_body text;
  v_cfg  text[];
  c_search_path CONSTANT text := 'search_path=public, pg_catalog';
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: public.enqueue_refresh_allocator_equity_for_all() not found';
  END IF;

  v_fn   := pg_get_functiondef(v_oid);
  v_body := regexp_replace(regexp_replace(v_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- NULL fails open through every match below.
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: the comment-stripped function body came back NULL, so every check below would pass without reading anything';
  END IF;

  IF v_body !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: enqueue_refresh_allocator_equity_for_all lost SECURITY DEFINER';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT (c_search_path = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: enqueue_refresh_allocator_equity_for_all does not pin search_path to the exact declared value (pg_proc.proconfig=%)', v_cfg;
  END IF;

  IF position('daily_equity_refresh' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: the daily_equity_refresh advisory lock key is gone, so two concurrent runs could both fan out';
  END IF;
  IF position('''reconstruct_allocator_history''' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: the body names no reconstruct_allocator_history kind, so a zero-snapshot book is never bootstrapped';
  END IF;
  IF position('''refresh_allocator_equity_daily''' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: the body names no refresh_allocator_equity_daily kind, so the daily refresh is gone';
  END IF;
  IF position('v_bootstrap_cap' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: the body declares no v_bootstrap_cap, so the bootstrap loop runs unbounded';
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: the anon, authenticated or service_role role does not exist on this database, so the ACL check cannot be evaluated';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: anon holds EXECUTE on enqueue_refresh_allocator_equity_for_all, a cross-tenant SECURITY DEFINER enqueue';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: authenticated holds EXECUTE on enqueue_refresh_allocator_equity_for_all, a cross-tenant SECURITY DEFINER enqueue';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh-fanout-bootstrap: service_role lost EXECUTE on enqueue_refresh_allocator_equity_for_all';
  END IF;

  RAISE NOTICE 'Migration 20260927120000: enqueue_refresh_allocator_equity_for_all bootstraps a zero-snapshot book (capped whole-book reconstruct, then the refresh); SECDEF, the exact search_path pin and the ACL (anon, authenticated refused; service_role granted) intact.';
END $selfverify$;
