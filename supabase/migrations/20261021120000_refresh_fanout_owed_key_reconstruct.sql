-- ============================================================================
-- Phase 167.1.2.1 RECONMARKER, plan 04 (PR 2 of 2), decisions D-06, D-08, D-09,
-- D-12, D-17: the daily equity fan-out
-- `public.enqueue_refresh_allocator_equity_for_all()` enqueues a reconstruct for
-- EVERY key that still owes one, counts each try, and stops loudly at five.
-- ============================================================================
--
-- THE DEFECT (three symptoms, one class)
-- --------------------------------------
-- "Has this key's history been reconstructed?" was inferred from evidence that is
-- neither per key nor durable: whether the ALLOCATOR has any
-- allocator_equity_snapshots row at all, and whether the key has a `done`
-- compute_jobs row (which retention_compute_jobs_done reaps at 30 days). The
-- 20260928140000 fan-out therefore bootstrapped only a book with ZERO snapshots,
-- and three failures follow from that single inference:
--   * SC-2 (plan 12's R-12-1). A book that already has snapshots and adds a key
--     whose first sync collided with an in-flight poll never gets that key's
--     backfill: the book is not at zero, so the bootstrap never looks at it.
--   * SC-4. On a book with two keys, one key's reconstruct writes rows and
--     the allocator-wide count hides the sibling whose reconstruct ended
--     failed_final. The failed key is never retried.
--   * SC-7, SQL half. If a zero-snapshot book's reconstruct reaches failed_final
--     before that day's refresh is claimed, the refresh writes the book's first
--     row, the book leaves zero, and the bootstrap never retries the key.
-- PR 1 (migration 20261014120000) gave every key the state itself:
-- api_keys.history_reconstructed_at (NULL means the key OWES its reconstruct) and
-- api_keys.history_reconstruct_attempts. THIS migration switches the fan-out to
-- read them. The decider reads the marker and nothing else: no snapshot row and
-- no done job decides whether a key was reconstructed any more.
--
-- LINEAGE AND RE-BASE DISCIPLINE, re-measured at execution, 2026-10-14 UTC:
--   grep -l -iE "function[[:space:]]+(public\.)?enqueue_refresh_allocator_equity_for_all" \
--     supabase/migrations/*.sql | sort | tail -1
-- returned 20260928140000_refresh_fanout_bootstraps_zero_snapshot_books.sql, on
-- this branch and on origin/main (older: 20260422101911, 20260420213754). That
-- body is the one re-based here. FUTURE EDITORS: re-base on THIS file (or a newer
-- one).
--
-- D-12: THE BACKFILL RE-RUNS FIRST. The statement ahead of the CREATE calls
-- public.backfill_api_keys_history_reconstructed_at() again (idempotent: it never
-- overwrites a set marker). Keys whose reconstruct completed between the PR 1
-- apply and the deploy of PR 2's worker are marked before the re-based fan-out
-- can look at them. The PROD census of the keys that would still be owed
-- (counts only, plan 08) is brought to the founder before this PR merges,
-- because a sole-key reconstruct replaces that allocator's snapshot rows.
--
-- DEPLOY ORDER, walked (research Q6). Either order is safe.
--   * This migration applies before PR 2's worker deploys: the backfill covers
--     every retained done job; a key that completes under the OLD worker in the
--     gap leaves a done job and no marker, so the next run sees it owed and
--     enqueues one redundant reconstruct. The NEW worker's own completion then
--     marks it. Cost: at most one redundant enqueue, one counted attempt and one
--     redundant crawl per such key. The decider reads the marker only (revision
--     1, B1).
--   * The worker deploys first: it writes and reads the marker; the old fan-out
--     still keys on snapshots. Harmless.
--
-- WHY THE ATTEMPT IS COUNTED IN THIS SQL AND NOT IN PYTHON (D-17). Only the
-- enqueue sees every failure path: a preflight exception, a job the watchdog
-- reaped, an orphan-terminalized job. A worker-side hook misses all three, so a
-- cap counted there would never fire. The increment sits in the same inner block
-- as the enqueue, so a caught enqueue race (the handler rolls the block back)
-- burns no attempt. Only a key the fan-out actually enqueues is counted, with ONE
-- deliberate exception, the next paragraph. request_allocator_holdings_sync (the
-- user's "Sync now") never increments it (research A9).
--
-- A BOOK THAT KEEPS FAILING STILL REACHES THE CAP (round-1 review SFH F3). The
-- per-book handler rolls the whole book back, and with it the increment of every
-- key it had already enqueued. A book whose bootstrap raises every day would
-- therefore leave attempts at 0 for ever: the cap, the capped-key row, the Sentry
-- event and the Overview note would all be unreachable, and the key would stay
-- owed and invisible. The handler now counts the try itself, once, on the ONE key
-- that was being enqueued when the book failed (v_boot_key), in a nested guarded
-- block AFTER the rollback so the count survives it. Variants weighed against the
-- gate arms:
--   * count every key of the failed book: rejected. A sibling that enqueued
--     cleanly and was only rolled back with the book has not failed; five bad
--     days of one key would cap innocent keys (arm O11i).
--   * count inside the rolled-back block: rejected, it is the defect.
--   * count only the blamed key, after the rollback: CHOSEN. It cannot count
--     twice: the handler runs only when the inner increment was rolled back, and a
--     book that succeeds never reaches it. It keeps the lost-race rule intact: a
--     serialization_failure or unique_violation is caught by the PER-KEY handler,
--     which never reaches the book handler, so a lost race still burns nothing.
--     What changes is that an error that is NOT a lost race now counts one attempt
--     on the key that raised it, which is "an attempt without a job" by design:
--     the try happened and failed, exactly what a failed_final job counts today.
--     Once the key is at the cap the per-key query stops selecting it and its
--     healthy siblings proceed (arm O11).
-- The count is guarded in its own block: if the count itself raises, the book is
-- still skipped and its bootstrap_book_skipped row (written first, naming the key)
-- is the durable trace; the error never reaches the loop-level handler, which
-- would roll back every other book's bootstrap (arm O11g).
--
-- ROUND-2 REVIEW SFH R2-1: THE COUNT IS FOR THE KEY'S OWN FAILURE ONLY. The handler
-- first counted for ANY error that escaped the per-key handler, which catches only
-- serialization_failure and unique_violation. A deadlock, a lock timeout or an
-- error raised while the cursor advanced would then burn an attempt on a key whose
-- enqueue never ran, five such days would cap it, and a key capped without a job
-- has no worker-side Sentry event (both routes start from a compute job). The count
-- is now narrowed two ways, both in the handler's IF:
--   * ATTRIBUTION. v_boot_in_enqueue is set to TRUE directly after v_boot_key is
--     assigned and back to FALSE directly after the key's inner block ends, so it
--     is TRUE only while that key's own enqueue and attempt UPDATE run. An error
--     anywhere else in the book (the cursor advancing) is not counted. This
--     closes residual (iii) of the first fix, which blamed the last key reached.
--   * TRANSIENCE. An error that says nothing about the key is not counted even
--     inside its section: class 40 (deadlock_detected 40P01, serialization_failure
--     and the rest of transaction_rollback), class 53 (insufficient_resources) and
--     lock_not_available 55P03 (a lock_timeout). The key stays owed and the next
--     run tries it again, which is the right answer to a collision that is gone by
--     then. Arms O13, O13l, O13r. query_canceled 57014 (a statement_timeout) needs
--     no clause: WHEN OTHERS does not match it, so it is never caught by either
--     handler of the bootstrap loop, aborts the whole call and counts nothing.
--     A non-transient error (P0001 in the arms, a failed trigger, a CHECK) still
--     counts, which is what keeps a book that really fails on every day reaching
--     the cap (O11).
-- What the flag can NOT be gated by (recorded, not hidden): no gate arm can make an
-- error appear at a cursor advance AFTER a key was enqueued. The per-key query ends
-- in ORDER BY, a blocking Sort, so every predicate runs before the first row is
-- returned; once a row is returned the advance reads sorted memory and the only
-- errors it can raise are system ones (deadlock, lock timeout, out of memory or
-- disk), which the TRANSIENCE clause already excludes. The flag is therefore the
-- guard for an error class nobody can name today; the TRANSIENCE arms are its
-- gated twin. Residuals, recorded: (i) a failure before the first key (the per-key
-- query itself) has no key to blame and counts nothing; (ii) if the skipped-book
-- row is itself refused the error reaches the loop-level handler, which rolls the
-- run's bootstrap back and counts nothing, as before; (iii) a non-transient error
-- raised by a key's own enqueue that is really transient in kind but carries
-- another SQLSTATE (a custom trigger, say) is counted: the handler cannot tell.
--
-- THE CAP (D-09). Five attempts. A key at five with the marker still NULL is no
-- longer enqueued and still OWES its history. It is never given up silently:
-- every run that finds such a key writes one public.cron_runs row, cron_name
-- equity_refresh_fanout, status error, error history_reconstruct_capped, metadata
-- holding the function name, the cause and a COUNT, never an id. The Sentry event
-- is the worker's (plan 05) and the Overview note is plan 06's. A capped key
-- does NOT withhold its book's refresh.
--
-- SUPERSEDES the RESIDUALS block of 20260928140000, which recorded exactly the
-- three symptoms above as "no durable per-key history-reconstructed marker,
-- routed to Phase 167.1.2.1 RECONMARKER by founder decision D-20".
--
-- ⚠️ BOOKKEEPING FOR THE NEXT READER. The in-body comments below that still say
-- "zero-snapshot" are 20260928140000's text, kept byte-identical on purpose so
-- the gate that pins that body can be repointed by file name. Where such a
-- comment and this header disagree, this header is right: the book selection is
-- now per owed key and the zero-snapshot test is gone from it.
--
-- THE BODY IS 20260928140000's, VERBATIM, WITH EXACTLY THESE EDITS:
--   (1) The book-selection query (aliases bq, bqs, bqsk, bqks, bqj) drops its
--       zero-snapshot conjunct (alias bqe) and its job list drops 'done'. It gains
--       two conjuncts: the key's marker is NULL and its attempts are under the
--       declared cap.
--   (2) The per-key query (aliases rk, rks, rksk, rkks, rkj) gets the same two
--       edits ('done' out of the job list, the marker and cap conjuncts in).
--   (3) In the per-key enqueue's inner BEGIN ... EXCEPTION block, directly after
--       the enqueue call, ONE UPDATE adds one to the key's attempt count.
--   (4) The refresh loop's BOOTSTRAPPED subquery (aliases bk, bks, bksk, bkks,
--       bkj) replaces its test "has a reconstruct row in any of five statuses"
--       with "owed, under the cap and not in flight": the marker is NULL, the
--       attempts are under the cap and no reconstruct job is pending, running,
--       done_pending_children or failed_retry. A book now waits only while such a
--       key exists, so a capped key never withholds its book's refresh and a key
--       whose reconstruct is in flight (including the one this run just
--       enqueued) lets the book's refresh through in the same run.
--   (5) A declared constant for the cap, plus, after the bootstrap sub-block, one
--       count of qualifying keys that are owed AND at or above the cap, and one
--       cron_runs row when that count is above zero. The row is written inside
--       its own handler so a refusing sink cannot cancel the refresh loop.
--   (6) The per-book handler (round-1 review SFH F3) gains one guarded block AFTER
--       its existing durable row: an UPDATE adding one to the attempt count of the
--       key that was being enqueued (v_boot_key), so a book that keeps failing
--       advances toward the cap. See "A BOOK THAT KEEPS FAILING" above. Round 2
--       (SFH R2-1) adds a flag, v_boot_in_enqueue (declared, reset at the top of
--       each book, TRUE around each key's inner block), and the handler's IF
--       counts only inside it and only for a non-transient SQLSTATE.
--   (7) The capped-key count's handler (round-1 review SFH F2) gains a guarded
--       fallback: on any failure of the count or of its trace row it writes one
--       public.cron_runs row, error history_reconstruct_capped_trace_failed, with
--       the SQLSTATE and message, so the signal that makes a capped key loud is
--       never lost silently. Two DECLAREs (v_trace_state, v_trace_msg) carry them.
--   (8) NOTHING ELSE. The advisory lock, the per-run cap on keys, the whole-book
--       EXIT, the labels, the handlers, the two existing cron_runs sinks, the
--       refresh loop's eligible predicate and snapshot branch, the strategy-link
--       and Deribit copies, the aliases and every unchanged line stay
--       byte-identical.
--   Definitions used above, unchanged from 20260928140000. QUALIFYING: active, not
--   revoked, sync_status not sign_in_failed or error, not disconnected, not a
--   Deribit key, not linked to one of its owner's non-archived strategies
--   (strategies.api_key_id or strategy_keys). Attempts count QUALIFYING keys
--   only, which the reader of plan 06 relies on.
--
-- THREATS, as this file mitigates them:
--   T-167.1.2.1-11 (worker flood after apply): the per-run cap of 25 keys, soft
--     at book granularity, is kept; the five-attempt cap; the census before merge.
--   T-167.1.2.1-13 (silent give-up): the durable cron_runs row on every run.
--   T-167.1.2.1-14 (privilege): the ACL pair is re-issued and asserted.
--   T-167.1.2.1-15 (TEST apply refusing): the backfill is a plain statement, the
--     self-verify is catalogue-only, neither reads a row to decide to raise.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites
-- ══════════════════════════════════════════════════════════════════════════
-- The hash below is the `live` column (fifth TSV field) of
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/enqueue_refresh_allocator_equity_for_all.sql \
--     <origin/main's copy of that file>
-- measured 2026-10-14 UTC: the normalized body origin/main carries today, i.e.
-- 20260928140000's, standing in for PROD. It is EARNED only if VAC-04 on the PR
-- reports the SAME hash for PROD. If it differs, PROD drifted out of band: fold
-- the difference in and re-derive, never edit the pragma to match a gate log.
--   enqueue_refresh_allocator_equity_for_all/0
-- prod-body-ack: 63c911b68caa9c471b727376b31e45e6d5974dc546b11c7a46166a19aee12fad
--
-- GRANTS ARE RE-CONVERGED, NOT ASSUMED: EXECUTE is revoked from PUBLIC, anon and
-- authenticated and granted to service_role only, then asserted below.
--
-- LOCK AND MERGE WINDOW. The backfill statement updates api_keys rows, a table the
-- 04:00 UTC positions poll writes; `lock_timeout` is 3s. MERGE OUTSIDE 04:00-05:45
-- UTC (docs/runbooks/cron-sync-go-live.md P6). The first 05:00 run after the apply
-- enqueues reconstructs for every owed key, up to the per-run cap.
--
-- REVERSIBLE: supabase/migrations/down/20261021120000-rollback.sql restores
-- 20260928140000's body, grants and COMMENT. Reconstruct jobs that already ran and
-- attempt counts that were already incremented are not undone; the columns stay
-- (the PR 1 rollback drops them and must run after this one).
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's
-- catalogue and none of its data ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). The
-- backfill matches zero rows on an empty database and cannot raise; the only DO
-- block reads catalogues. Every RAISE format string is a single literal.
-- Execution proof is the SQL gate
-- supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- D-12: re-run the PR 1 backfill BEFORE the re-based fan-out can look at a key.
-- A plain statement, idempotent (a set marker is never overwritten). It matches
-- zero rows on an empty database and cannot raise.
SELECT public.backfill_api_keys_history_reconstructed_at();

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
  v_boot_key uuid;
  -- Round-2 review SFH R2-1: TRUE only while the key v_boot_key is inside its own
  -- enqueue section (the inner BEGIN ... END below). The per-book handler counts an
  -- attempt only when it is TRUE, so an error raised anywhere else in the book
  -- (the cursor advancing, for one) is not blamed on a key.
  v_boot_in_enqueue boolean := FALSE;
  v_loop_state text;
  v_loop_msg   text;
  -- Phase 167.1.2.1 D-09: a key is enqueued at most this many times while its
  -- marker is still NULL. At the cap it stays owed, is not enqueued again and
  -- leaves one public.cron_runs row per run (see the count below the bootstrap
  -- sub-block). D-17: the fan-out counts, in the same inner block as the enqueue.
  v_reconstruct_attempt_cap CONSTANT integer := 5;
  v_capped integer;
  -- Round-1 review SFH F2: the error a handler is about to trace, captured before
  -- a nested block overwrites SQLSTATE and SQLERRM.
  v_trace_state text;
  v_trace_msg   text;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    -- Phase 167.1.2.1 D-06: the comments below that say "zero-snapshot" are
    -- 20260928140000's text. The selection is now per OWED key (marker NULL,
    -- attempts under the cap, no reconstruct in flight) on any book, with or
    -- without snapshots; see the migration header.
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
          AND bq.history_reconstructed_at IS NULL
          AND bq.history_reconstruct_attempts < v_reconstruct_attempt_cap
          AND NOT EXISTS (SELECT 1 FROM compute_jobs bqj WHERE bqj.api_key_id = bq.id AND bqj.kind = 'reconstruct_allocator_history' AND bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry'))
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
        v_boot_in_enqueue := FALSE;
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
              AND rk.history_reconstructed_at IS NULL
              AND rk.history_reconstruct_attempts < v_reconstruct_attempt_cap
              AND NOT EXISTS (SELECT 1 FROM compute_jobs rkj WHERE rkj.api_key_id = rk.id AND rkj.kind = 'reconstruct_allocator_history' AND rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry'))
            ORDER BY rk.created_at DESC, rk.id
          LOOP
            v_boot_key := v_rkey.api_key_id;
            v_boot_in_enqueue := TRUE;
            BEGIN
              PERFORM enqueue_compute_job(
                p_strategy_id     := NULL,
                p_kind            := 'reconstruct_allocator_history',
                p_idempotency_key := 'reconstruct-alloc-' || v_rkey.api_key_id::text || '-initial',
                p_api_key_id      := v_rkey.api_key_id
              );
              -- Phase 167.1.2.1 D-17: count the try HERE, in the same inner block as
              -- the enqueue. The handler below rolls this block back, so a lost
              -- race burns no attempt. A book that is rolled back by the book-level
              -- handler is counted there instead, once, on the key that failed.
              UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_rkey.api_key_id;
            -- serialization_failure is the enqueue helper's lost-race signal
            -- (the winner already left the in-flight statuses). unique_violation
            -- cannot fire today (the helper inserts ON CONFLICT DO NOTHING) and
            -- is kept as belt. Either skips ONE key, never the run.
            EXCEPTION WHEN unique_violation OR serialization_failure THEN
              RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: reconstruct enqueue skipped for api_key % (SQLSTATE %)', v_rkey.api_key_id, SQLSTATE;
            END;
            v_boot_in_enqueue := FALSE;
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
          -- Phase 167.1.2.1 round-1 review SFH F3: the rollback above took the
          -- book's attempt increments with it, so count the failed try HERE, once,
          -- on the key that was being enqueued. Round-2 review SFH R2-1: only when
          -- the error is that key's own. NOT counted: an error raised while the
          -- cursor advances (v_boot_in_enqueue is FALSE there), and a transient
          -- error that says nothing about the key: class 40 (deadlock_detected
          -- 40P01, serialization_failure, transaction_rollback), class 53
          -- (insufficient_resources) and lock_not_available 55P03. query_canceled
          -- 57014 never reaches this handler (WHEN OTHERS does not match it), it
          -- aborts the whole call, which counts nothing. Guarded: a count that
          -- raises must not reach the loop-level handler (it would roll back every
          -- other book's bootstrap); the skipped-book row above is then the trace.
          BEGIN
            IF v_boot_key IS NOT NULL AND v_boot_in_enqueue
               AND SQLSTATE NOT LIKE '40%' AND SQLSTATE NOT LIKE '53%' AND SQLSTATE <> '55P03' THEN
              UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_boot_key;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the failed bootstrap try of one book could not be counted (SQLSTATE %)', SQLSTATE;
          END;
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

    -- Phase 167.1.2.1 D-09: a key that still owes its history and has used its
    -- attempts is never enqueued again, so it must not go quiet. One durable
    -- public.cron_runs row per run, a COUNT only (no key or owner id), in the
    -- ledger fan-outs' sink. Wrapped: this is the last step before the refresh
    -- loop, and a sink or a read that refuses must not cancel the daily refresh
    -- of every allocator.
    BEGIN
      SELECT count(*) INTO v_capped
      FROM api_keys ck
      WHERE ck.is_active = TRUE
        AND ck.sync_status IS DISTINCT FROM 'revoked'
        AND coalesce(ck.sync_status, '') NOT IN ('sign_in_failed', 'error')
        AND ck.disconnected_at IS NULL
        AND lower(ck.exchange) <> 'deribit'
        AND NOT EXISTS (SELECT 1 FROM strategies cks WHERE cks.api_key_id = ck.id AND cks.user_id = ck.user_id AND cks.status <> 'archived')
        AND NOT EXISTS (SELECT 1 FROM strategy_keys cksk JOIN strategies ckks ON ckks.id = cksk.strategy_id WHERE cksk.api_key_id = ck.id AND ckks.user_id = ck.user_id AND ckks.status <> 'archived')
        AND ck.history_reconstructed_at IS NULL
        AND ck.history_reconstruct_attempts >= v_reconstruct_attempt_cap;
      IF v_capped > 0 THEN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('equity_refresh_fanout', 'error', now(), 'history_reconstruct_capped',
                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                   'cause', 'history_reconstruct_capped',
                                   'count', v_capped));
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_trace_state := SQLSTATE;
      v_trace_msg   := SQLERRM;
      RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the capped-key count or its trace row failed; the refresh loop still runs (SQLSTATE %)', SQLSTATE;
      -- Round-1 review SFH F2: a WARNING lives only in the server log and pg_cron
      -- records the run as succeeded, so a count or a sink that fails every day
      -- would lose the capped-key signal silently. Leave a durable row of its own
      -- (a different error value, so a refused capped row does not refuse it),
      -- nested and guarded like the bootstrap loop's: the WARNING above stays the
      -- last resort, and a sink that refuses this row too must not cancel the
      -- daily refresh of every allocator.
      BEGIN
        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)
        VALUES ('equity_refresh_fanout', 'error', now(), 'history_reconstruct_capped_trace_failed',
                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',
                                   'cause', 'history_reconstruct_capped_trace_failed',
                                   'sqlstate', v_trace_state,
                                   'message', v_trace_msg));
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the capped-key failure row could not be written (SQLSTATE %)', SQLSTATE;
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
                AND bk.history_reconstructed_at IS NULL
                AND bk.history_reconstruct_attempts < v_reconstruct_attempt_cap
                AND NOT EXISTS (SELECT 1 FROM compute_jobs bkj WHERE bkj.api_key_id = bk.id AND bkj.kind = 'reconstruct_allocator_history' AND bkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry'))
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
  'Daily cron fan-out for the per-allocator legacy equity store. Two arms, inside one advisory lock. (1) Reconstruct, first, in its own sub-block, one book per inner block (an error enqueueing one book rolls back and skips that book only; an error outside any book rolls back every reconstruct enqueue of the run; neither cancels the refresh; both are logged as a WARNING and as one public.cron_runs row, cron_name equity_refresh_fanout, error bootstrap_book_skipped or bootstrap_loop_failed): for every OWED qualifying key, one reconstruct_allocator_history job, on a book with or without snapshots. OWED (Phase 167.1.2.1 D-06) = api_keys.history_reconstructed_at IS NULL, history_reconstruct_attempts under 5 (D-09) and no reconstruct job pending, running, done_pending_children or failed_retry; qualifying = active, not revoked, sync_status not sign_in_failed or error, not disconnected, not linked to one of its owner''s non-archived strategies (strategies.api_key_id or strategy_keys, mirroring deriveStrategyLinkedKeyIds) and not Deribit. Each enqueue adds one to history_reconstruct_attempts in the same inner block (D-17), so a lost race burns no attempt; a book whose bootstrap raises is rolled back and its handler adds one attempt to the key that was being enqueued, so a book that keeps failing still reaches the cap, except that an error raised outside that key''s enqueue or a transient one (class 40, class 53, 55P03) counts nothing; the user RPC never counts. The job carries idempotency key reconstruct-alloc-<key>-initial, the RPC''s correlation label; dedupe is the in-flight partial unique index plus the owed predicate, not that key. Whole books, newest key first, stopping before a new book once 25 keys (v_bootstrap_cap) were enqueued this call. A qualifying key that is owed and at the cap (v_reconstruct_attempt_cap, 5) is not enqueued again; each run that finds one writes one public.cron_runs row, error history_reconstruct_capped, metadata carrying a count only, and a failure of that count or row is itself traced as error history_reconstruct_capped_trace_failed. (2) Refresh: one refresh_allocator_equity_daily job per eligible key (active, not revoked, not disconnected) whose owner has a snapshot row, or which is unlinked on a book where no qualifying key is owed, under the cap and out of flight (a capped key never withholds its book). A lost enqueue race (serialization_failure) skips one key with a WARNING. Phase 167.1.2.1 D-06, D-09, D-17; re-based on migration 20260928140000.';

-- --------------------------------------------------------------------------
-- Self-verify. CATALOGUE-ONLY: to_regprocedure, pg_get_functiondef,
-- pg_proc.proconfig, to_regrole and has_function_privilege. No table data.
--
-- These are COPY-CHECKS on a comment-stripped body. They deliberately assert
-- only needles every mutation in the SQL gate leaves intact (SECDEF, the
-- search_path pin, the lock key, the two kind literals and the two cap
-- constants' declared NAMES), so a mutated apply survives and the gate's arm is
-- the first failure. The behaviour itself (the owed predicate, the in-flight
-- status lists, the attempt increment, the cap value, the capped-key trace, the
-- bootstrapped test) is pinned by the gate's arms, never here.
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
    RAISE EXCEPTION 'refresh-fanout-owed-key: public.enqueue_refresh_allocator_equity_for_all() not found';
  END IF;

  v_fn   := pg_get_functiondef(v_oid);
  v_body := regexp_replace(regexp_replace(v_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- NULL fails open through every match below.
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the comment-stripped function body came back NULL, so every check below would pass without reading anything';
  END IF;

  IF v_body !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: enqueue_refresh_allocator_equity_for_all lost SECURITY DEFINER';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT (c_search_path = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: enqueue_refresh_allocator_equity_for_all does not pin search_path to the exact declared value (pg_proc.proconfig=%)', v_cfg;
  END IF;

  IF position('daily_equity_refresh' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the daily_equity_refresh advisory lock key is gone, so two concurrent runs could both fan out';
  END IF;
  IF position('''reconstruct_allocator_history''' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the body names no reconstruct_allocator_history kind, so an owed key is never reconstructed';
  END IF;
  IF position('''refresh_allocator_equity_daily''' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the body names no refresh_allocator_equity_daily kind, so the daily refresh is gone';
  END IF;
  IF position('v_bootstrap_cap' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the body declares no v_bootstrap_cap, so the reconstruct loop runs unbounded';
  END IF;
  IF position('v_reconstruct_attempt_cap' in v_body) = 0 THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the body declares no v_reconstruct_attempt_cap, so a failing key is retried forever';
  END IF;

  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: the anon, authenticated or service_role role does not exist on this database, so the ACL check cannot be evaluated';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: anon holds EXECUTE on enqueue_refresh_allocator_equity_for_all, a cross-tenant SECURITY DEFINER enqueue';
  END IF;
  IF has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: authenticated holds EXECUTE on enqueue_refresh_allocator_equity_for_all, a cross-tenant SECURITY DEFINER enqueue';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'refresh-fanout-owed-key: service_role lost EXECUTE on enqueue_refresh_allocator_equity_for_all';
  END IF;

  RAISE NOTICE 'Migration 20261021120000: enqueue_refresh_allocator_equity_for_all reconstructs every owed key (marker NULL, attempts under the cap, nothing in flight), counts each try, traces a capped key; SECDEF, the exact search_path pin and the ACL (anon, authenticated refused; service_role granted) intact.';
END $selfverify$;

COMMIT;
