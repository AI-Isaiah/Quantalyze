-- Test for migration 20261021120000 — Phase 167.1.2.1 RECONMARKER, plan 04
-- (PR 2), success criteria SC-1, SC-2, SC-4 and SC-7 (SQL half), decisions D-06,
-- D-09 and D-17.
--
-- WHAT THE MIGRATION DOES. public.enqueue_refresh_allocator_equity_for_all()
-- used to bootstrap a reconstruct only for a book with ZERO equity snapshots and
-- inferred "reconstructed" from snapshot rows and from done jobs. It now:
--   * enqueues one reconstruct_allocator_history job (label
--     reconstruct-alloc-<key>-initial) for every QUALIFYING key that OWES one
--     (api_keys.history_reconstructed_at IS NULL, history_reconstruct_attempts
--     under 5, no reconstruct job pending, running, done_pending_children or
--     failed_retry), on a book with snapshots as well as without;
--   * adds one to history_reconstruct_attempts in the SAME inner block as the
--     enqueue, for a key it actually enqueues and for no other;
--   * never enqueues a marked key, and never a key at 5 attempts, and leaves one
--     public.cron_runs row (error history_reconstruct_capped, a count only) for a
--     run that finds a capped key;
--   * enqueues the refresh of a zero-snapshot book in the same run once no
--     qualifying key of that book is owed, under the cap and out of flight.
-- Qualifying = active, not revoked, sync_status not sign_in_failed or error, not
-- disconnected, not Deribit, not strategy-linked.
--
-- 20 arms, file order: O1, O2, O3, O4, O5, O6, O6t, O7, O8, O9, O10, O11, O11i, O11g,
-- O12, O12g, O13, O13l, O13r, G.
--   O1 -> SC-2 (a key on a book that already has history gets its reconstruct)
--   O2 -> D-17 (the attempt is counted at the enqueue)
--   O3 -> D-17 (an in-flight key is neither enqueued again nor counted)
--   O4 -> SC-1 (a marked key is never enqueued; no snapshot or job decides)
--   O5 -> a key awaiting its retry (failed_retry) is in flight
--   O6, O6t -> D-09 (the cap, and its durable trace)
--   O7 -> SC-4 (a sibling's marker does not hide a failed key)
--   O8 -> SC-7, SQL half (a failed_final reconstruct on a zero-snapshot book is
--         re-enqueued AND the book's refresh is enqueued in the same run)
--   O9 -> a capped key does not withhold its book's refresh
--   O10 -> attempts are counted for qualifying keys only
--   O11, O11i, O11g -> round-1 review SFH F3 (a book whose bootstrap keeps raising
--         still advances its failing key toward the cap; its innocent sibling is
--         not charged; a count that itself raises is contained to its own book)
--   O12, O12g -> round-1 review SFH F2 (a refused capped-key row leaves a durable
--         failure row; a sink that refuses that row too never cancels the refresh)
--   O13, O13l, O13r -> round-2 review SFH R2-1 (a transient error in a book, a
--         deadlock, a lock timeout or a resource shortage, burns no attempt on the
--         key; the skip is still traced)
--   G -> the grants
--
-- pgTAP is not set up in this project, so every assertion RAISEs
-- `TEST FAILED (<arm>)` on failure and a clean run prints NOTICEs only.
-- ⚠️ supabase/tests/test_*.sql is the ONLY DB assertion form that runs in CI.
--
-- ISOLATION BY CONSTRUCTION (the precedent is
-- test_refresh_fanout_zero_snapshot_bootstrap.sql).
--   (i) The whole file is ONE transaction: it opens with BEGIN and closes with
--       ROLLBACK, so no row it seeds and no job its calls enqueue, for its own
--       keys or for any foreign key on the database, outlives it. A RAISE aborts
--       the transaction with the same effect.
--   (ii) CI runs every supabase/tests file on ONE database with no per-file
--       reset, so foreign owed keys can exist while this runs. Every api_keys row
--       this file seeds carries an explicit created_at a CENTURY AHEAD of now(),
--       and each group's base is strictly later than every earlier group's. The
--       fan-out takes books newest key first, so each group's books outrank every
--       foreign book for the cap slots.
--   (iii) Every assertion reads only this file's own key ids, never a global
--       count. The one exception is O6t, which clears the capped-key rows this
--       transaction itself wrote before the call it reads (completed_at = now()
--       is the transaction's own time), so a foreign capped key cannot satisfy it.
-- Several calls in one transaction are the same UTC day by construction, and the
-- function's session-level pg_try_advisory_lock is re-entrant and released at the
-- end of each call. The api-key branch of enqueue_compute_job performs no
-- auth.role() check, so this file calls the fan-out directly as the database
-- owner, as pg_cron does.
--
-- SERIAL execution: a concurrent holder of the daily_equity_refresh lock would
-- make a call skip and redden the positive arms for the wrong reason. The repo
-- runs supabase/tests/*.sql one file at a time; keep it that way.
--
-- THE TRACER (group O) and the contract against the previous body. SETUP O and its
-- call sit OUTSIDE every arm marker, seed the key WITHOUT naming the history
-- columns (so the column defaults apply: marker NULL, attempts 0), and nothing
-- that can RAISE precedes arm O1. With migration 20261021120000 left out of the
-- apply list (20260928140000's body live, the columns present) this file must
-- fail with arm O1: that body bootstraps only a book with ZERO snapshots, and
-- group O's book has one. With O1's marked block deleted it must then fail with
-- arm O2: that body counts nothing. Keep O1 and O2 the FIRST TWO assertions.
--
-- ⭐ ORDER IS LOAD-BEARING. Each arm must be the FIRST failure under its own
-- mutation (scripts/mutation-runner). File order, fixed:
--   O1, O2, O3, O4, O5, O6, O6t, O7, O8, O9, O10, O11, O11i, O11g, O12, O12g,
--   O13, O13l, O13r, G.
--
-- MATCHED PAIRS: every control key differs from an enqueued key in exactly the ONE
-- attribute its arm's mutation removes, and is otherwise active, not revoked,
-- sync_status idle, not disconnected, not Deribit, unlinked, on a book with a
-- snapshot row (O8 and O9 are the zero-snapshot pair):
--   O4  marker set                      vs O1's key  (marker NULL)
--   O5  a failed_retry job              vs O1's key  (no job)
--   O6  attempts 5                      vs O1's key  (attempts 0)
--   O7  A: marker set; B: a failed_final job and attempts 1 (B is the O1 key plus
--       exactly one dead job)
--   O8  attempts 1 and a failed_final job, zero-snapshot book   vs O9
--   O9  attempts 5, no job, zero-snapshot book                  vs O8
--   O10 Deribit key and strategy-linked key vs the qualifying key beside them
-- A control that also differed in a second attribute would leave its mutation
-- inert: the other attribute would still exclude it.
--
-- APPLY SURVIVAL (the 167.1.2-12 precedent). The migration's self-verify asserts
-- only needles every mutation below leaves intact (SECURITY DEFINER, the
-- search_path pin, the lock key, the two kind literals, the two declared cap
-- NAMES, the ACL). No mutation edits a declared name or a kind literal, so every
-- mutated apply survives and the arm is the first failure. G is an insert-after
-- anchored AFTER the self-verify block.
--
-- Interference walk, each mutation against every EARLIER arm's fixture:
--   O1   none earlier; the first assertion. The re-added zero-snapshot term only
--        removes books that have snapshots from the selection.
--   O2   O1: O1 does not read attempts.
--   O3   O1, O2: the first call enqueues k_o under either list (it has no job
--        yet). Dropping pending from the per-key list changes only the SECOND
--        call, which only O3 asserts on.
--   O4   O1-O3: every earlier key has a NULL marker, so dropping the marker term
--        changes none of their answers.
--   O5   O1-O4: no earlier key has a failed_retry job.
--   O6   O1-O5: every earlier attempts value is 0 or 1 or 2, under both caps.
--   O6t  O1-O6: no earlier arm reads public.cron_runs; the deleted INSERT is the
--        only writer.
--   O7   O1-O6t: no earlier key has a failed_final job, so counting that status
--        as in flight changes none of their answers.
--   O8   O1-O7: every earlier book HAS a snapshot row, so the refresh loop takes
--        the snapshot branch and never reads the bootstrapped subquery.
--   O9   O1-O8: O8's key has a pending job, which keeps its book bootstrapped
--        with or without the cap term; earlier books have snapshots.
--   O10  O1-O9: no earlier key is Deribit.
--   O11  O1-O10: no earlier fixture makes an enqueue raise, so the per-book handler
--        never runs before it; deleting its UPDATE changes no earlier answer.
--   O11i O1-O11: the widened UPDATE runs only in the same handler, first reached
--        by O11's fixture, which O11 passes (the refused key is charged either way).
--   O11g O1-O11i: narrowing the guard changes the handler only when its UPDATE
--        raises; O11 and O11i never refuse the UPDATE.
--   O12  O1-O11g: no earlier arm refuses a cron_runs row, so the capped handler
--        never runs before it; the deleted fallback INSERT is its only writer.
--   O12g O1-O12: O12 refuses only the capped row, so the fallback row succeeds
--        and the nested handler the mutation re-raises in never runs.
--   O13  O1-O12g: every earlier refusal raises P0001, which stays counted under the
--        deleted class-40 term; no earlier key is refused with 40P01.
--   O13l O1-O13: the deleted 55P03 term changes only a 55P03 refusal, which only
--        O13l's key raises (O13's deletion is a different needle).
--   O13r O1-O13l: the deleted class-53 term changes only a 53xxx refusal, which only
--        O13r's key raises.
--   G    all: changes a grant only; no arm but G reads grants.
-- A reviewer fix that adds an arm or changes a fixture adds its row here and
-- re-walks the table before re-running.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_refresh_fanout_owed_key_reconstruct.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/05-fixture-wizard-composite.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/39-fixture-audit-log.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260420213754_allocator_equity_snapshots.sql","supabase/migrations/20260422101911_api_keys_disconnected_at.sql","supabase/migrations/20260527102050_replace_allocator_equity_snapshots.sql","supabase/migrations/20260529160000_allocator_equity_pre_terminus_flag.sql","supabase/migrations/20260602183000_b5b_api_key_delete_atomicity.sql","supabase/migrations/20260602190000_f6_wizard_session_idempotency.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710180000_wizard_composite.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260811210000_api_keys_attested_venue.sql","supabase/migrations/20260812083206_api_keys_venue_account_id.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql","supabase/migrations/20260925120000_api_keys_account_identity.sql","supabase/migrations/20260526095850_log_audit_event_null_auth_errcode.sql","supabase/migrations/20260924233749_allocator_sync_restore_inflight_prefetch.sql","scripts/pg-lane/fixtures/33-fixture-cron-runs.sql","supabase/migrations/20260928140000_refresh_fanout_bootstraps_zero_snapshot_books.sql","supabase/migrations/20261014120000_api_keys_history_reconstruct_marker.sql","supabase/migrations/20261014120100_log_audit_event_deny_worker_only_actions.sql","supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql"]}

BEGIN;

-- ==========================================================================
-- GROUP O — the tracer: one qualifying key on a book that ALREADY has history,
-- then (O3) a second call after a sibling joins.
-- ==========================================================================
DO $grpo$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years';
  uid_o  uuid := gen_random_uuid();
  k_o    uuid := gen_random_uuid();
  k_o3   uuid := gen_random_uuid();
  v_n    int;
  v_att  int;
  v_n3   int;
  v_att3 int;
BEGIN
  -- SETUP O BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_o, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_o, 'fanout owed O', 'test-fanout-owed-o-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_o, uid_o, 'okx', 'fanout owed O', 'enc', true, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid_o, DATE '2026-01-01', 100, 'exchange_primary');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();
  -- SETUP O END

  -- ARM O1 BEGIN
  -- ----- O1 (SC-2): an owed key on a book that already has snapshots gets its
  --                  reconstruct, keyed reconstruct-alloc-<key>-initial ---------
  -- RED-UNDER: re-add the zero-snapshot conjunct to the book-selection copy (bq)
  --            of migration 20261021120000, as 20260928140000 had it. A book that
  --            already holds a snapshot row is then never taken, so the key whose
  --            first sync collided never gets its backfill.
  -- RED-UNDER-M: {"arm":"O1","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"bq.history_reconstructed_at IS NULL","replace":"bq.history_reconstructed_at IS NULL\n          AND NOT EXISTS (SELECT 1 FROM allocator_equity_snapshots bqe WHERE bqe.allocator_id = bq.user_id)","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs
   WHERE api_key_id = k_o
     AND kind = 'reconstruct_allocator_history'
     AND idempotency_key = 'reconstruct-alloc-' || k_o::text || '-initial';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O1): an owed, qualifying key on a book that ALREADY has an equity snapshot got % reconstruct_allocator_history job(s) keyed reconstruct-alloc-<key>-initial, expected exactly 1. The fan-out still reads the allocator-wide snapshot count to decide whether a key was reconstructed.', v_n;
  END IF;
  -- ARM O1 END

  -- ARM O2 BEGIN
  -- ----- O2 (D-17): the enqueue counts exactly one attempt for that key ---------
  -- RED-UNDER: delete the attempt UPDATE in the per-key enqueue's inner block of
  --            migration 20261021120000. The reconstruct is still enqueued, but
  --            the key's history_reconstruct_attempts stays 0, so the cap can
  --            never fire.
  -- RED-UNDER-M: {"arm":"O2","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_rkey.api_key_id;","replace":"","occurrences":1}]}
  SELECT history_reconstruct_attempts INTO v_att FROM api_keys WHERE id = k_o;
  IF v_att IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O2): a key the fan-out enqueued one reconstruct for has history_reconstruct_attempts %, expected exactly 1. The attempt must be counted by the fan-out, in the same inner block as the enqueue, or the 5-attempt cap never fires.', v_att;
  END IF;
  -- ARM O2 END

  -- SETUP O3 BEGIN
  -- A sibling joins the book; k_o keeps its pending job. The second call takes
  -- the book (the sibling is owed) and must leave k_o alone.
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_o3, uid_o, 'okx', 'fanout owed O3 sibling', 'enc', true, v_base + INTERVAL '1 hour');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();
  -- SETUP O3 END

  -- ARM O3 BEGIN
  -- ----- O3 (D-17): a key whose reconstruct is in flight is not enqueued again
  --                  and not counted again; the sibling beside it is ------------
  -- RED-UNDER: remove 'pending' from the per-key selection's job list (rkj) of
  --            migration 20261021120000. The key is selected again, the enqueue
  --            helper's own in-flight pre-check returns the existing row (so no
  --            second job appears), and only the attempt count moves to 2.
  -- RED-UNDER-M: {"arm":"O3","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"rkj.status IN ('running', 'done_pending_children', 'failed_retry')","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs WHERE api_key_id = k_o AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_att FROM api_keys WHERE id = k_o;
  SELECT count(*) INTO v_n3
    FROM compute_jobs WHERE api_key_id = k_o3 AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_att3 FROM api_keys WHERE id = k_o3;
  IF v_n <> 1 OR v_att IS DISTINCT FROM 1 OR v_n3 <> 1 OR v_att3 IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O3): after a second fan-out call the key whose reconstruct is pending has % job(s) and % attempt(s) (expected 1 and 1), and its new sibling has % job(s) and % attempt(s) (expected 1 and 1). An in-flight key must be neither enqueued nor counted again.', v_n, v_att, v_n3, v_att3;
  END IF;
  -- ARM O3 END

  RAISE NOTICE 'group O: an owed key on a book with history got one reconstruct and one counted attempt; a second call left it alone';
END $grpo$;

-- ==========================================================================
-- GROUP O4 — SC-1: a MARKED key is never enqueued.
-- ==========================================================================
DO $grpo4$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '1 day';
  uid    uuid := gen_random_uuid();
  k_4    uuid := gen_random_uuid();
  v_n    int;
  v_att  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o4-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O4', 'test-fanout-owed-o4-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstructed_at, created_at)
  VALUES (k_4, uid, 'okx', 'fanout owed O4', 'enc', true, now(), v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O4 BEGIN
  -- ----- O4 (SC-1): a key whose marker is set gets no reconstruct and no
  --                  attempt, with no job and no snapshot standing in for it ----
  -- RED-UNDER: drop the marker conjunct from BOTH the book-selection (bq) and the
  --            per-key (rk) copies of migration 20261021120000. An edit of one
  --            copy alone is inert while the other still filters the key. The
  --            marked key is then selected and enqueued again.
  -- RED-UNDER-M: {"arm":"O4","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"bq.history_reconstructed_at IS NULL","replace":"TRUE","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"rk.history_reconstructed_at IS NULL","replace":"TRUE","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs WHERE api_key_id = k_4 AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_att FROM api_keys WHERE id = k_4;
  IF v_n <> 0 OR v_att IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O4): a key whose history_reconstructed_at is set got % reconstruct job(s) and has % attempt(s), expected 0 and 0. A marked key must never be enqueued: the marker, not a snapshot row or a done job, says it was reconstructed.', v_n, v_att;
  END IF;
  -- ARM O4 END
END $grpo4$;

-- ==========================================================================
-- GROUP O5 — a key whose reconstruct awaits its retry (failed_retry) is in
-- flight: no second job, no attempt.
-- ==========================================================================
DO $grpo5$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '2 days';
  uid    uuid := gen_random_uuid();
  k_5    uuid := gen_random_uuid();
  v_n    int;
  v_att  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o5-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O5', 'test-fanout-owed-o5-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_5, uid, 'okx', 'fanout owed O5', 'enc', true, 1, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');
  -- failed_retry is outside the in-flight partial unique index and outside the
  -- enqueue helper's pre-check, so a fan-out that ignored it would really insert
  -- a second reconstruct while the first is scheduled for its retry.
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('reconstruct_allocator_history', k_5, 'failed_retry');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O5 BEGIN
  -- ----- O5: a reconstruct scheduled for retry is in flight ---------------------
  -- RED-UNDER: remove 'failed_retry' from BOTH the book-selection (bqj) and the
  --            per-key (rkj) job lists of migration 20261021120000. The key is
  --            selected, a second pending reconstruct is inserted next to the one
  --            awaiting its retry, and the attempt is counted.
  -- RED-UNDER-M: {"arm":"O5","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"bqj.status IN ('pending', 'running', 'done_pending_children')","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"rkj.status IN ('pending', 'running', 'done_pending_children')","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs WHERE api_key_id = k_5 AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_att FROM api_keys WHERE id = k_5;
  IF v_n <> 1 OR v_att IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O5): a key whose only reconstruct job is failed_retry has % reconstruct job(s) and % attempt(s) after the fan-out, expected the 1 seeded job and the 1 seeded attempt. A job awaiting its retry is in flight: a second reconstruct would run a second crawl.', v_n, v_att;
  END IF;
  -- ARM O5 END
END $grpo5$;

-- ==========================================================================
-- GROUP O6 — D-09: a key at 5 attempts with the marker NULL is not enqueued
-- again, stays owed, and leaves one durable cron_runs row (a count only).
-- ==========================================================================
DO $grpo6$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '3 days';
  uid    uuid := gen_random_uuid();
  k_6    uuid := gen_random_uuid();
  v_n    int;
  v_att  int;
  v_mark timestamptz;
  v_rows int;
  v_cnt  int;
  v_ids  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o6-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O6', 'test-fanout-owed-o6-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_6, uid, 'okx', 'fanout owed O6', 'enc', true, 5, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');
  -- O6t reads rows THIS call wrote: clear the capped-key rows this transaction
  -- already wrote (completed_at = now() is this transaction's own time), so a
  -- foreign capped key on the database cannot satisfy the trace arm.
  DELETE FROM public.cron_runs
   WHERE cron_name = 'equity_refresh_fanout' AND error = 'history_reconstruct_capped' AND completed_at = now();

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O6 BEGIN
  -- ----- O6 (D-09): a key at the cap is not enqueued again and stays owed -------
  -- RED-UNDER: raise the declared v_reconstruct_attempt_cap of migration
  --            20261021120000 by one. A key sitting at exactly 5 attempts is then
  --            under the cap, gets another reconstruct and a sixth attempt.
  -- RED-UNDER-M: {"arm":"O6","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"v_reconstruct_attempt_cap CONSTANT integer := 5;","replace":"v_reconstruct_attempt_cap CONSTANT integer := 6;","occurrences":1}]}
  SELECT count(*) INTO v_n
    FROM compute_jobs WHERE api_key_id = k_6 AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts, history_reconstructed_at INTO v_att, v_mark
    FROM api_keys WHERE id = k_6;
  IF v_n <> 0 OR v_att IS DISTINCT FROM 5 OR v_mark IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O6): a key at 5 attempts with no marker got % reconstruct job(s), now has % attempt(s) and marker %, expected 0 jobs, 5 attempts and a NULL marker. The cap must stop the retries and leave the key owed.', v_n, v_att, v_mark;
  END IF;
  -- ARM O6 END

  -- ARM O6t BEGIN
  -- ----- O6t (D-09): the run that found a capped key left a durable trace: one
  --                   cron_runs row, a count, and no api key or owner id ---------
  -- RED-UNDER: delete the capped-key public.cron_runs INSERT in migration
  --            20261021120000. A key stuck at the cap then leaves nothing but its
  --            own row, and pg_cron records every run as a success.
  -- RED-UNDER-M: {"arm":"O6t","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)\n        VALUES ('equity_refresh_fanout', 'error', now(), 'history_reconstruct_capped',\n                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',\n                                   'cause', 'history_reconstruct_capped',\n                                   'count', v_capped));","replace":"NULL;","occurrences":1}]}
  SELECT count(*),
         coalesce(max((metadata->>'count')::int), 0),
         count(*) FILTER (WHERE metadata ? 'api_key_id' OR metadata ? 'owner_id' OR metadata::text LIKE '%' || k_6::text || '%' OR metadata::text LIKE '%' || uid::text || '%')
    INTO v_rows, v_cnt, v_ids
    FROM public.cron_runs
   WHERE cron_name = 'equity_refresh_fanout'
     AND status = 'error'
     AND error = 'history_reconstruct_capped'
     AND completed_at = now();
  IF v_rows <> 1 OR v_cnt < 1 OR v_ids <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O6t): the fan-out call that met a capped key wrote % cron_runs row(s) with error history_reconstruct_capped (expected exactly 1), a count of % (expected at least 1), and % row(s) carrying an api key or owner id (expected 0). A capped key must leave a durable, id-free trace on every run.', v_rows, v_cnt, v_ids;
  END IF;
  -- ARM O6t END
END $grpo6$;

-- ==========================================================================
-- GROUP O7 — SC-4: on a book where key A is marked and sibling B's reconstruct
-- ended failed_final, B is enqueued again and A is not.
-- ==========================================================================
DO $grpo7$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '4 days';
  uid    uuid := gen_random_uuid();
  k_a    uuid := gen_random_uuid();
  k_b    uuid := gen_random_uuid();
  v_b_new int;
  v_b_att int;
  v_a_n   int;
  v_a_att int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o7-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O7', 'test-fanout-owed-o7-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstructed_at, created_at)
  VALUES (k_a, uid, 'okx', 'fanout owed O7 A', 'enc', true, now(), v_base + INTERVAL '1 hour');
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_b, uid, 'okx', 'fanout owed O7 B', 'enc', true, 1, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');
  -- A failed_final row is outside the in-flight index and the enqueue helper's
  -- pre-check, so the retry really inserts a second row.
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('reconstruct_allocator_history', k_b, 'failed_final');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O7 BEGIN
  -- ----- O7 (SC-4): a sibling's marker does not hide a failed key ---------------
  -- RED-UNDER: add 'failed_final' to BOTH the book-selection (bqj) and the
  --            per-key (rkj) job lists of migration 20261021120000, i.e. treat a
  --            reconstruct that ended failed_final as in flight. Key B is then
  --            stranded: never selected, never retried.
  -- RED-UNDER-M: {"arm":"O7","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"bqj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'failed_final')","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"rkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry', 'failed_final')","occurrences":1}]}
  SELECT count(*) FILTER (WHERE status <> 'failed_final') INTO v_b_new
    FROM compute_jobs WHERE api_key_id = k_b AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_b_att FROM api_keys WHERE id = k_b;
  SELECT count(*) INTO v_a_n
    FROM compute_jobs WHERE api_key_id = k_a AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_a_att FROM api_keys WHERE id = k_a;
  IF v_b_new <> 1 OR v_b_att IS DISTINCT FROM 2 OR v_a_n <> 0 OR v_a_att IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O7): on a book with a marked key A and a sibling B whose reconstruct ended failed_final, B got % new reconstruct job(s) and has % attempt(s) (expected 1 and 2) and A got % job(s) and has % attempt(s) (expected 0 and 0). One key''s marker must not hide the other key''s failure.', v_b_new, v_b_att, v_a_n, v_a_att;
  END IF;
  -- ARM O7 END
END $grpo7$;

-- ==========================================================================
-- GROUP O8 — SC-7, SQL half: a ZERO-snapshot book whose only qualifying key's
-- reconstruct ended failed_final is re-enqueued, and its refresh is enqueued
-- in the same run once the key is in flight again.
-- ==========================================================================
DO $grpo8$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '5 days';
  uid    uuid := gen_random_uuid();
  k_8    uuid := gen_random_uuid();
  v_new  int;
  v_att  int;
  v_ref  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o8-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O8', 'test-fanout-owed-o8-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_8, uid, 'okx', 'fanout owed O8', 'enc', true, 1, v_base);
  INSERT INTO compute_jobs (kind, api_key_id, status)
  VALUES ('reconstruct_allocator_history', k_8, 'failed_final');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O8 BEGIN
  -- ----- O8 (SC-7): the retry and the book's refresh happen in the SAME run -----
  -- RED-UNDER: remove 'pending' from the bootstrapped subquery's job list (bkj) of
  --            migration 20261021120000. The reconstruct this run just enqueued
  --            no longer counts as in flight, so the key still looks owed and
  --            the zero-snapshot book's refresh is withheld.
  -- RED-UNDER-M: {"arm":"O8","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"bkj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')","replace":"bkj.status IN ('running', 'done_pending_children', 'failed_retry')","occurrences":1}]}
  SELECT count(*) FILTER (WHERE kind = 'reconstruct_allocator_history' AND status <> 'failed_final'),
         count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily')
    INTO v_new, v_ref
    FROM compute_jobs WHERE api_key_id = k_8;
  SELECT history_reconstruct_attempts INTO v_att FROM api_keys WHERE id = k_8;
  IF v_new <> 1 OR v_att IS DISTINCT FROM 2 OR v_ref <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O8): a zero-snapshot book whose only qualifying key''s reconstruct ended failed_final got % new reconstruct job(s) (expected 1), the key has % attempt(s) (expected 2), and the key got % refresh job(s) (expected 1). The retry must be enqueued and the refresh must follow in the same run.', v_new, v_att, v_ref;
  END IF;
  -- ARM O8 END
END $grpo8$;

-- ==========================================================================
-- GROUP O9 — a capped key on a ZERO-snapshot book does not withhold the book's
-- refresh.
-- ==========================================================================
DO $grpo9$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '6 days';
  uid    uuid := gen_random_uuid();
  k_9    uuid := gen_random_uuid();
  v_rec  int;
  v_att  int;
  v_ref  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o9-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O9', 'test-fanout-owed-o9-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_9, uid, 'okx', 'fanout owed O9', 'enc', true, 5, v_base);

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O9 BEGIN
  -- ----- O9: a capped key neither gets a reconstruct nor holds its book back ----
  -- RED-UNDER: drop the cap conjunct from the bootstrapped subquery (bk) of
  --            migration 20261021120000. The capped key then still counts as
  --            owed and out of flight, so the zero-snapshot book waits for a
  --            reconstruct that will never be enqueued and is never refreshed.
  -- RED-UNDER-M: {"arm":"O9","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"bk.history_reconstruct_attempts < v_reconstruct_attempt_cap","replace":"TRUE","occurrences":1}]}
  SELECT count(*) FILTER (WHERE kind = 'reconstruct_allocator_history'),
         count(*) FILTER (WHERE kind = 'refresh_allocator_equity_daily')
    INTO v_rec, v_ref
    FROM compute_jobs WHERE api_key_id = k_9;
  SELECT history_reconstruct_attempts INTO v_att FROM api_keys WHERE id = k_9;
  IF v_rec <> 0 OR v_att IS DISTINCT FROM 5 OR v_ref <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O9): a zero-snapshot book whose only qualifying key is at the attempt cap got % reconstruct job(s) (expected 0), the key has % attempt(s) (expected 5), and % refresh job(s) were enqueued for it (expected 1). A capped key must not withhold its book''s refresh.', v_rec, v_att, v_ref;
  END IF;
  -- ARM O9 END
END $grpo9$;

-- ==========================================================================
-- GROUP O10 — attempts are counted for QUALIFYING keys only: a Deribit key and a
-- strategy-linked key, both owed, on a book the fan-out takes, get no job and no
-- attempt (the reader of plan 06 relies on this).
-- ==========================================================================
DO $grpo10$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '7 days';
  uid    uuid := gen_random_uuid();
  k_q    uuid := gen_random_uuid();
  k_d    uuid := gen_random_uuid();
  k_l    uuid := gen_random_uuid();
  v_q_n  int;
  v_q_att int;
  v_x_n  int;
  v_x_att int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o10-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O10', 'test-fanout-owed-o10-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_q, uid, 'okx',     'fanout owed O10 qualifying', 'enc', true, v_base + INTERVAL '3 minutes'),
         (k_d, uid, 'deribit', 'fanout owed O10 deribit',    'enc', true, v_base + INTERVAL '2 minutes'),
         (k_l, uid, 'okx',     'fanout owed O10 linked',     'enc', true, v_base + INTERVAL '1 minute');
  INSERT INTO strategies (user_id, api_key_id, name, status)
  VALUES (uid, k_l, 'fanout owed O10', 'draft');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');

  PERFORM public.enqueue_refresh_allocator_equity_for_all();

  -- ARM O10 BEGIN
  -- ----- O10: only the qualifying key is enqueued and counted -------------------
  -- RED-UNDER: drop the Deribit conjunct from the per-key copy (rk) ONLY of
  --            migration 20261021120000. The book-selection copy still takes the
  --            book (the qualifying key makes it eligible), and the per-key
  --            query then admits the Deribit key, which the worker refuses
  --            permanently, and counts an attempt for it.
  -- RED-UNDER-M: {"arm":"O10","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"lower(rk.exchange) <> 'deribit'","replace":"TRUE","occurrences":1}]}
  SELECT count(*) INTO v_q_n
    FROM compute_jobs WHERE api_key_id = k_q AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_q_att FROM api_keys WHERE id = k_q;
  SELECT (SELECT count(*) FROM compute_jobs WHERE api_key_id IN (k_d, k_l) AND kind = 'reconstruct_allocator_history'),
         (SELECT coalesce(sum(history_reconstruct_attempts), 0) FROM api_keys WHERE id IN (k_d, k_l))
    INTO v_x_n, v_x_att;
  IF v_q_n <> 1 OR v_q_att IS DISTINCT FROM 1 OR v_x_n <> 0 OR v_x_att IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O10): on a book the fan-out takes, the qualifying key got % reconstruct job(s) and % attempt(s) (expected 1 and 1), while its Deribit and strategy-linked siblings got % job(s) and % attempt(s) between them (expected 0 and 0). Only a qualifying key is enqueued and counted.', v_q_n, v_q_att, v_x_n, v_x_att;
  END IF;
  -- ARM O10 END
END $grpo10$;

-- ==========================================================================
-- GROUP O11 — round-1 review SFH F3: a book whose bootstrap keeps raising still
-- advances toward the cap. A fixture trigger refuses one key's reconstruct
-- (P0001). The book's NEWER key is enqueued first, then the refused key raises,
-- so the per-book handler rolls both back. The refused key (seeded at 4
-- attempts) must come out at 5; its innocent sibling, which enqueued cleanly and
-- was only rolled back with the book, must keep 0 attempts and have no job.
-- ==========================================================================
DO $grpo11$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '8 days';
  uid    uuid := gen_random_uuid();
  k_ok   uuid := gen_random_uuid();
  k_bad  uuid := gen_random_uuid();
  v_err  text;
  v_bad_att int;
  v_bad_n   int;
  v_ok_att  int;
  v_ok_n    int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o11-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O11', 'test-fanout-owed-o11-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_ok,  uid, 'okx',   'fanout owed O11 sibling', 'enc', true, 0, v_base + INTERVAL '2 minutes'),
         (k_bad, uid, 'bybit', 'fanout owed O11 refused', 'enc', true, 4, v_base + INTERVAL '1 minute');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_owed_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_owed_key_reconstruct: fixture refusal ' || TG_ARGV[1];
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', k_bad, 'reconstruct_allocator_history', 'P0001', 'enqueue-' || v_run);

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_owed_refuse ON public.compute_jobs;
  DROP FUNCTION public._fanout_owed_refuse();

  SELECT history_reconstruct_attempts INTO v_bad_att FROM api_keys WHERE id = k_bad;
  SELECT history_reconstruct_attempts INTO v_ok_att  FROM api_keys WHERE id = k_ok;
  SELECT count(*) FILTER (WHERE api_key_id = k_bad), count(*) FILTER (WHERE api_key_id = k_ok)
    INTO v_bad_n, v_ok_n
    FROM compute_jobs
   WHERE api_key_id IN (k_bad, k_ok) AND kind = 'reconstruct_allocator_history';

  -- ARM O11 BEGIN
  -- ----- O11 (SFH F3): the key whose enqueue raised is counted, once, by the
  --                     per-book handler, after the rollback took its increment ---
  -- RED-UNDER: delete the UPDATE in the per-book handler of migration
  --            20261021120000. The book is rolled back every day with its
  --            increments, the refused key stays at 4 for ever, and the cap, the
  --            capped-key row and the Overview note are unreachable.
  -- RED-UNDER-M: {"arm":"O11","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_boot_key;","replace":"NULL;","occurrences":1}]}
  IF v_err IS NOT NULL OR v_bad_att IS DISTINCT FROM 5 OR v_bad_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O11): a key whose reconstruct enqueue raised (P0001) on a book the per-book handler rolled back has % attempt(s) after the call (seeded 4, expected 5), % reconstruct job(s) (expected 0), and the call raised SQLSTATE % (expected none). A book that keeps failing must still advance toward the cap.', v_bad_att, v_bad_n, v_err;
  END IF;
  -- ARM O11 END

  -- ARM O11i BEGIN
  -- ----- O11i (SFH F3): the innocent sibling is not counted ----------------------
  -- RED-UNDER: widen the per-book handler's UPDATE in migration
  --            20261021120000 from the failing key to every key of the book. The
  --            sibling that enqueued cleanly and was only rolled back with the
  --            book is then charged an attempt, and five bad days of one key cap
  --            keys that never failed.
  -- RED-UNDER-M: {"arm":"O11i","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE id = v_boot_key;","replace":"UPDATE public.api_keys SET history_reconstruct_attempts = history_reconstruct_attempts + 1 WHERE user_id = v_book.owner_id;","occurrences":1}]}
  IF v_ok_att IS DISTINCT FROM 0 OR v_ok_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O11i): the sibling of a refused key, enqueued cleanly and rolled back with its book, has % attempt(s) and % reconstruct job(s) (expected 0 and 0). Only the key that failed is counted; a lost race and a rolled-back sibling burn nothing.', v_ok_att, v_ok_n;
  END IF;
  -- ARM O11i END
END $grpo11$;

-- ==========================================================================
-- GROUP O11g — round-1 review SFH F3: a count that cannot be written must not
-- cancel the other books. The refused key's attempt UPDATE is refused too (a
-- second fixture trigger, P0001), so the per-book handler's own count raises.
-- An OLDER healthy book must still get its reconstruct and its attempt.
-- ==========================================================================
DO $grpo11g$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '9 days';
  uid_a  uuid := gen_random_uuid();
  uid_b  uuid := gen_random_uuid();
  k_bad  uuid := gen_random_uuid();
  k_b    uuid := gen_random_uuid();
  v_err  text;
  v_b_n  int;
  v_b_att int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o11ga-' || v_run || '@quantalyze.test', now(), now()),
         (uid_b, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o11gb-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_a, 'fanout owed O11g refused', 'test-fanout-owed-o11ga-' || v_run || '@quantalyze.test'),
         (uid_b, 'fanout owed O11g older',   'test-fanout-owed-o11gb-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, created_at)
  VALUES (k_bad, uid_a, 'okx', 'fanout owed O11g refused', 'enc', true, v_base + INTERVAL '2 hours'),
         (k_b,   uid_b, 'okx', 'fanout owed O11g older',   'enc', true, v_base + INTERVAL '1 hour');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid_a, DATE '2026-01-01', 100, 'exchange_primary'),
         (uid_b, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_owed_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_owed_key_reconstruct: fixture refusal ' || TG_ARGV[1];
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', k_bad, 'reconstruct_allocator_history', 'P0001', 'enqueue-' || v_run);
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse_count BEFORE UPDATE OF history_reconstruct_attempts ON public.api_keys FOR EACH ROW WHEN (NEW.id = %L::uuid) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', k_bad, 'P0001', 'count-' || v_run);

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_owed_refuse ON public.compute_jobs;
  DROP TRIGGER _fanout_owed_refuse_count ON public.api_keys;
  DROP FUNCTION public._fanout_owed_refuse();

  SELECT count(*) INTO v_b_n
    FROM compute_jobs WHERE api_key_id = k_b AND kind = 'reconstruct_allocator_history';
  SELECT history_reconstruct_attempts INTO v_b_att FROM api_keys WHERE id = k_b;

  -- ARM O11g BEGIN
  -- ----- O11g (SFH F3): a failing count is contained to its own book ------------
  -- RED-UNDER: narrow the guard around the per-book handler's UPDATE in migration
  --            20261021120000 so it no longer catches the refusal. The error
  --            then reaches the bootstrap loop's handler, which rolls back every
  --            book of the run, so one key whose count cannot be written costs
  --            every older book its reconstruct and its attempt.
  -- RED-UNDER-M: {"arm":"O11g","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"EXCEPTION WHEN OTHERS THEN\n            RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the failed bootstrap try","replace":"EXCEPTION WHEN no_data_found THEN\n            RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the failed bootstrap try","occurrences":1}]}
  IF v_err IS NOT NULL OR v_b_n <> 1 OR v_b_att IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O11g): with one book failing and its failed-try count refused too (P0001), the call raised SQLSTATE % (expected none), an older healthy book''s key got % reconstruct job(s) and % attempt(s) (expected 1 and 1). A count that raises must be contained to its own book, never cancel the others.', v_err, v_b_n, v_b_att;
  END IF;
  -- ARM O11g END
END $grpo11g$;

-- ==========================================================================
-- GROUP O12 — round-1 review SFH F2: when the capped-key trace row cannot be
-- written, the failure itself leaves a durable row. A fixture trigger refuses
-- the history_reconstruct_capped row (P0001); the call must not raise, and one
-- history_reconstruct_capped_trace_failed row must carry the SQLSTATE and the
-- message, and no api key or owner id.
-- ==========================================================================
DO $grpo12$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '10 days';
  uid    uuid := gen_random_uuid();
  k_c    uuid := gen_random_uuid();
  v_err  text;
  v_rows int;
  v_ids  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o12-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O12', 'test-fanout-owed-o12-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_c, uid, 'okx', 'fanout owed O12', 'enc', true, 5, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_owed_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_owed_key_reconstruct: fixture refusal ' || TG_ARGV[1];
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse_trace BEFORE INSERT ON public.cron_runs FOR EACH ROW WHEN (NEW.error = %L) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', 'history_reconstruct_capped', 'P0001', 'capped-' || v_run);

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_owed_refuse_trace ON public.cron_runs;
  DROP FUNCTION public._fanout_owed_refuse();

  SELECT count(*),
         count(*) FILTER (WHERE metadata ? 'api_key_id' OR metadata ? 'owner_id' OR metadata::text LIKE '%' || k_c::text || '%' OR metadata::text LIKE '%' || uid::text || '%')
    INTO v_rows, v_ids
    FROM public.cron_runs
   WHERE cron_name = 'equity_refresh_fanout'
     AND status = 'error'
     AND error = 'history_reconstruct_capped_trace_failed'
     AND metadata->>'sqlstate' = 'P0001'
     AND metadata->>'message' LIKE '%capped-' || v_run || '%';

  -- ARM O12 BEGIN
  -- ----- O12 (SFH F2): a refused capped-key row leaves a durable failure row ----
  -- RED-UNDER: delete the fallback public.cron_runs INSERT in the capped-key
  --            handler of migration 20261021120000. A capped-key signal that fails
  --            every day is then a server-log WARNING only, and pg_cron records
  --            each run as a success.
  -- RED-UNDER-M: {"arm":"O12","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"        INSERT INTO public.cron_runs (cron_name, status, completed_at, error, metadata)\n        VALUES ('equity_refresh_fanout', 'error', now(), 'history_reconstruct_capped_trace_failed',\n                jsonb_build_object('function', 'enqueue_refresh_allocator_equity_for_all',\n                                   'cause', 'history_reconstruct_capped_trace_failed',\n                                   'sqlstate', v_trace_state,\n                                   'message', v_trace_msg));","replace":"NULL;","occurrences":1}]}
  IF v_err IS NOT NULL OR v_rows <> 1 OR v_ids <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (O12): with the history_reconstruct_capped row refused (P0001), the call raised SQLSTATE % (expected none), and % cron_runs row(s) with error history_reconstruct_capped_trace_failed carried the SQLSTATE and the message (expected exactly 1), % of them carrying an api key or owner id (expected 0). The loss of the capped-key signal must itself leave a durable row.', v_err, v_rows, v_ids;
  END IF;
  -- ARM O12 END
END $grpo12$;

-- ==========================================================================
-- GROUP O12g — round-1 review SFH F2: the failure row is itself guarded. Both
-- the capped row and the failure row are refused (P0001); the call must still
-- not raise and the refresh loop must still enqueue the capped key's refresh.
-- ==========================================================================
DO $grpo12g$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '11 days';
  uid    uuid := gen_random_uuid();
  k_c    uuid := gen_random_uuid();
  v_err  text;
  v_ref  int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o12g-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid, 'fanout owed O12g', 'test-fanout-owed-o12g-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_c, uid, 'okx', 'fanout owed O12g', 'enc', true, 5, v_base);
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_owed_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_owed_key_reconstruct: fixture refusal ' || TG_ARGV[1];
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse_trace BEFORE INSERT ON public.cron_runs FOR EACH ROW WHEN (NEW.error IN (%L, %L)) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', 'history_reconstruct_capped', 'history_reconstruct_capped_trace_failed', 'P0001', 'both-' || v_run);

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_owed_refuse_trace ON public.cron_runs;
  DROP FUNCTION public._fanout_owed_refuse();

  SELECT count(*) INTO v_ref
    FROM compute_jobs WHERE api_key_id = k_c AND kind = 'refresh_allocator_equity_daily';

  -- ARM O12g BEGIN
  -- ----- O12g (SFH F2): a sink that refuses both rows never cancels the refresh --
  -- RED-UNDER: make the nested guard around the failure row re-raise in migration
  --            20261021120000. The refused failure row then escapes the capped-key
  --            handler, the whole call fails, and a sink outage cancels the daily
  --            refresh of every allocator.
  -- RED-UNDER-M: {"arm":"O12g","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"RAISE WARNING 'enqueue_refresh_allocator_equity_for_all: the capped-key failure row could not be written (SQLSTATE %)', SQLSTATE;","replace":"RAISE;","occurrences":1}]}
  IF v_err IS NOT NULL OR v_ref <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O12g): with both the capped-key row and its failure row refused (P0001), the call raised SQLSTATE % (expected none) and the capped key got % refresh job(s) (expected 1). The last-resort handler must swallow a refusing sink, never cancel the daily refresh.', v_err, v_ref;
  END IF;
  -- ARM O12g END
END $grpo12g$;

-- ==========================================================================
-- GROUP O13 — round-2 review SFH R2-1: a transient error in a book counts NO
-- attempt. Three books, each with one key seeded at 4 attempts whose reconstruct
-- enqueue is refused by a fixture trigger with a transient SQLSTATE: deadlock_detected
-- (40P01), lock_not_available (55P03) and out_of_memory (53200, class 53). The
-- per-book handler rolls each book back and traces it, but a collision or a
-- resource shortage says nothing about the key, so each key must stay at 4. If it
-- were charged, five such days would cap a key that never had a job, and a key
-- capped without a job has no Sentry event.
-- ==========================================================================
DO $grpo13$
DECLARE
  v_run  text := replace(gen_random_uuid()::text, '-', '');
  v_base timestamptz := now() + INTERVAL '100 years' + INTERVAL '12 days';
  uid_d  uuid := gen_random_uuid();
  uid_l  uuid := gen_random_uuid();
  uid_r  uuid := gen_random_uuid();
  k_d    uuid := gen_random_uuid();
  k_l    uuid := gen_random_uuid();
  k_r    uuid := gen_random_uuid();
  v_err  text;
  v_d_att int; v_d_n int; v_d_tr int;
  v_l_att int; v_l_n int; v_l_tr int;
  v_r_att int; v_r_n int; v_r_tr int;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_d, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o13d-' || v_run || '@quantalyze.test', now(), now()),
         (uid_l, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o13l-' || v_run || '@quantalyze.test', now(), now()),
         (uid_r, '00000000-0000-0000-0000-000000000000', 'test-fanout-owed-o13r-' || v_run || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (uid_d, 'fanout owed O13 deadlock', 'test-fanout-owed-o13d-' || v_run || '@quantalyze.test'),
         (uid_l, 'fanout owed O13 lock',     'test-fanout-owed-o13l-' || v_run || '@quantalyze.test'),
         (uid_r, 'fanout owed O13 resource', 'test-fanout-owed-o13r-' || v_run || '@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO api_keys (id, user_id, exchange, label, api_key_encrypted, is_active, history_reconstruct_attempts, created_at)
  VALUES (k_d, uid_d, 'okx', 'fanout owed O13 deadlock', 'enc', true, 4, v_base + INTERVAL '3 hours'),
         (k_l, uid_l, 'okx', 'fanout owed O13 lock',     'enc', true, 4, v_base + INTERVAL '2 hours'),
         (k_r, uid_r, 'okx', 'fanout owed O13 resource', 'enc', true, 4, v_base + INTERVAL '1 hour');
  INSERT INTO allocator_equity_snapshots (allocator_id, asof, value_usd, source)
  VALUES (uid_d, DATE '2026-01-01', 100, 'exchange_primary'),
         (uid_l, DATE '2026-01-01', 100, 'exchange_primary'),
         (uid_r, DATE '2026-01-01', 100, 'exchange_primary');
  CREATE FUNCTION public._fanout_owed_refuse() RETURNS trigger
  LANGUAGE plpgsql AS $f$
  BEGIN
    RAISE EXCEPTION USING ERRCODE = TG_ARGV[0], MESSAGE = 'test_refresh_fanout_owed_key_reconstruct: fixture refusal ' || TG_ARGV[1];
  END $f$;
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse_d BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', k_d, 'reconstruct_allocator_history', '40P01', 'deadlock-' || v_run);
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse_l BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', k_l, 'reconstruct_allocator_history', '55P03', 'lock-' || v_run);
  EXECUTE format('CREATE TRIGGER _fanout_owed_refuse_r BEFORE INSERT ON public.compute_jobs FOR EACH ROW WHEN (NEW.api_key_id = %L::uuid AND NEW.kind = %L) EXECUTE FUNCTION public._fanout_owed_refuse(%L, %L)', k_r, 'reconstruct_allocator_history', '53200', 'resource-' || v_run);

  v_err := NULL;
  BEGIN
    PERFORM public.enqueue_refresh_allocator_equity_for_all();
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLSTATE;
  END;

  DROP TRIGGER _fanout_owed_refuse_d ON public.compute_jobs;
  DROP TRIGGER _fanout_owed_refuse_l ON public.compute_jobs;
  DROP TRIGGER _fanout_owed_refuse_r ON public.compute_jobs;
  DROP FUNCTION public._fanout_owed_refuse();

  SELECT history_reconstruct_attempts INTO v_d_att FROM api_keys WHERE id = k_d;
  SELECT history_reconstruct_attempts INTO v_l_att FROM api_keys WHERE id = k_l;
  SELECT history_reconstruct_attempts INTO v_r_att FROM api_keys WHERE id = k_r;
  SELECT count(*) FILTER (WHERE api_key_id = k_d), count(*) FILTER (WHERE api_key_id = k_l), count(*) FILTER (WHERE api_key_id = k_r)
    INTO v_d_n, v_l_n, v_r_n
    FROM compute_jobs
   WHERE api_key_id IN (k_d, k_l, k_r) AND kind = 'reconstruct_allocator_history';
  -- The skip must still be TRACED: not counting is not the same as not saying.
  SELECT count(*) FILTER (WHERE metadata->>'api_key_id' = k_d::text AND metadata->>'sqlstate' = '40P01'),
         count(*) FILTER (WHERE metadata->>'api_key_id' = k_l::text AND metadata->>'sqlstate' = '55P03'),
         count(*) FILTER (WHERE metadata->>'api_key_id' = k_r::text AND metadata->>'sqlstate' = '53200')
    INTO v_d_tr, v_l_tr, v_r_tr
    FROM public.cron_runs
   WHERE cron_name = 'equity_refresh_fanout' AND error = 'bootstrap_book_skipped';

  -- ARM O13 BEGIN
  -- ----- O13 (SFH R2-1): a deadlock in a book burns no attempt -------------------
  -- RED-UNDER: delete the class-40 exclusion from the per-book handler's IF in
  --            migration 20261021120000. A deadlock_detected (40P01) on the key's
  --            enqueue is then charged to the key, five such days cap a key that
  --            never had a job, and that route has no Sentry event.
  -- RED-UNDER-M: {"arm":"O13","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"AND SQLSTATE NOT LIKE '40%' ","replace":"","occurrences":1}]}
  IF v_err IS NOT NULL OR v_d_att IS DISTINCT FROM 4 OR v_d_n <> 0 OR v_d_tr <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O13): a key whose reconstruct enqueue raised deadlock_detected (40P01) has % attempt(s) after the call (seeded 4, expected 4), % reconstruct job(s) (expected 0), % skipped-book trace row(s) naming it with that SQLSTATE (expected 1), and the call raised SQLSTATE % (expected none). A transient error says nothing about the key and must burn no attempt.', v_d_att, v_d_n, v_d_tr, v_err;
  END IF;
  -- ARM O13 END

  -- ARM O13l BEGIN
  -- ----- O13l (SFH R2-1): a lock timeout in a book burns no attempt --------------
  -- RED-UNDER: delete the lock_not_available (55P03) exclusion from the per-book
  --            handler's IF in migration 20261021120000, so a lock_timeout on the
  --            key's enqueue is charged to the key.
  -- RED-UNDER-M: {"arm":"O13l","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":" AND SQLSTATE <> '55P03' THEN","replace":" THEN","occurrences":1}]}
  IF v_l_att IS DISTINCT FROM 4 OR v_l_n <> 0 OR v_l_tr <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O13l): a key whose reconstruct enqueue raised lock_not_available (55P03) has % attempt(s) after the call (seeded 4, expected 4), % reconstruct job(s) (expected 0), % skipped-book trace row(s) naming it with that SQLSTATE (expected 1). A lock timeout says nothing about the key and must burn no attempt.', v_l_att, v_l_n, v_l_tr;
  END IF;
  -- ARM O13l END

  -- ARM O13r BEGIN
  -- ----- O13r (SFH R2-1): a resource shortage in a book burns no attempt ---------
  -- RED-UNDER: delete the class-53 exclusion from the per-book handler's IF in
  --            migration 20261021120000, so an out_of_memory (53200) on the key's
  --            enqueue is charged to the key.
  -- RED-UNDER-M: {"arm":"O13r","apply":[{"kind":"edit","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","find":"AND SQLSTATE NOT LIKE '53%' ","replace":"","occurrences":1}]}
  IF v_r_att IS DISTINCT FROM 4 OR v_r_n <> 0 OR v_r_tr <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (O13r): a key whose reconstruct enqueue raised out_of_memory (53200, class 53) has % attempt(s) after the call (seeded 4, expected 4), % reconstruct job(s) (expected 0), % skipped-book trace row(s) naming it with that SQLSTATE (expected 1). A resource shortage says nothing about the key and must burn no attempt.', v_r_att, v_r_n, v_r_tr;
  END IF;
  -- ARM O13r END
END $grpo13$;

-- ==========================================================================
-- GROUP G — the grants: anon and authenticated cannot EXECUTE the fan-out;
-- service_role can. The apply-time self-verify runs once and can be undone
-- afterwards; this arm re-checks it on every corpus run.
-- ==========================================================================
DO $grpg$
DECLARE
  v_oid oid := to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()');
BEGIN
  -- ARM G BEGIN
  -- ----- G: a cross-tenant SECURITY DEFINER enqueue is service_role only --------
  -- RED-UNDER: grant EXECUTE to authenticated AFTER the self-verify block in
  --            migration 20261021120000, so the apply survives and any signed-in
  --            user could fan out reconstructs for every book.
  -- RED-UNDER-M: {"arm":"G","apply":[{"kind":"insert-after","file":"supabase/migrations/20261021120000_refresh_fanout_owed_key_reconstruct.sql","anchor":"END $selfverify$;","text":"\nGRANT EXECUTE ON FUNCTION public.enqueue_refresh_allocator_equity_for_all() TO authenticated;","occurrences":1}]}
  IF v_oid IS NULL
     OR has_function_privilege('anon', v_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (G): enqueue_refresh_allocator_equity_for_all() is missing (oid %), or anon / authenticated can EXECUTE it, or service_role cannot. It is a cross-tenant SECURITY DEFINER enqueue that only pg_cron may call.', v_oid;
  END IF;
  -- ARM G END

  RAISE NOTICE 'test_refresh_fanout_owed_key_reconstruct: every arm passed, O1 through G';
END $grpg$;

ROLLBACK;
