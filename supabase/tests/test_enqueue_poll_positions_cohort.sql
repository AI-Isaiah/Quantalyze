-- Test: the daily positions poll covers private strategies kept current by the cron sync,
-- never polls a revoked key, and stays live and idempotent.
-- Phase 227 JOBLEDGER, plan 06 (ROADMAP SC-5, requirement HEAL-05).
-- Guards migration 20261124120500_poll_positions_cohort.sql and its venue-gate fix
-- 20261126180000_poll_positions_cohort_ccxt_venues.sql.
--
-- Why this gate exists (the WHY, not just the WHAT)
-- -------------------------------------------------
-- The daily enqueue polled only published and pending_review strategies that had a done
-- sync_trades compute job in the last 30 days. The cron sync path never writes that job, it
-- advances strategy_sync_cursors.last_sync_at instead, so a private strategy kept current by
-- the cron sync never had a position snapshot. HEAL-05 widens the cohort to private strategies
-- and reads "the key still works" from either path. The same change adds the liveness
-- conjuncts today's cohort lacks, so a deactivated or disconnected key stops being read.
--
-- ARMS (listed and executed in this order; each twin's FIRST `TEST FAILED` must name its own arm):
--   P1  a private strategy with an active, connected key and a cursor advanced 2 days ago gets
--       exactly one poll_positions job carrying the daily idempotency key.
--   P2  a published strategy with a done sync_trades job 3 days old and no cursor is still
--       polled (today's cohort is kept).
--   P3  a private strategy with a fresh cursor is NOT polled when its key is disconnected (P3),
--       nor when its key is deactivated (P3/active).
--   P4  a draft (P4) and an archived (P4/archived) strategy with fresh cursors are not polled.
--   P5  a private strategy whose cursor is 40 days old (P5), or whose only done sync_trades job
--       is 40 days old (P5/job), is not polled.
--   P6  a second call on the same day while the first poll job is pending returns 0 and
--       creates no second poll_positions job.
--   P7  the deployed body still enqueues kind poll_positions under the daily- idempotency
--       prefix with enqueued_by daily_loop (P7/body), and anon and authenticated cannot call it
--       (P7).
--   P8  a private MT5 strategy with an active, connected key and a done sync_trades job 1 day
--       old (the shape of the three PROD failures of 2026-11-25) is NOT polled (P8), nor is an
--       sFOX strategy of the same shape (P8/sfox). Neither client has the ccxt fetch_positions
--       run_poll_positions_job calls, so every such job fails 3/3. Nor is a Deribit strategy
--       (P8/deribit): position_snapshots_exchange_check admits no deribit row, so a Deribit
--       account holding a position fails the snapshot upsert.
--   P9  a binance (P9/binance) and bybit (P9/bybit) strategy of the same shape are each
--       polled: the venue gate admits every venue the poll serves end to end
--       (EXCHANGE_CLASSES intersected with position_snapshots_exchange_check). okx is covered by P1.
--
-- Every `TEST FAILED (...)` raise sits DIRECTLY in the DO body (the mutation runner reads an
-- identity only from a single-frame inline_code_block raise). pg_temp helpers return values and
-- never raise an identity. Every id is gen_random_uuid(), emails end in invalid.local, and every
-- assertion is scoped to this file's own strategy ids (TEST is shared with other people's CI).
-- The whole file is BEGIN ... ROLLBACK and no timing is slept: ages are seeded offsets.
--
-- pgTAP is NOT installed (CLAUDE.md), so assertions RAISE EXCEPTION and a clean run prints
-- NOTICEs only. No psql meta-commands anywhere in this file, comments included.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_enqueue_poll_positions_cohort.sql
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm carries a prose `RED-UNDER:` and a machine-readable
-- `RED-UNDER-M:` twin that scripts/mutation-runner applies to COPIES on a throwaway pg-lane
-- cluster. Schema: scripts/mutation-runner/GRAMMAR.md. The setup list is the enqueue chain of
-- test_enqueue_dedup_record_retract.sql (the newest definition of the enqueue RPCs), then the
-- per-strategy cursor table, then the Phase 227 cohort migration and the venue-gate fix
-- that re-bases it. Every twin edits the fix, the newest definition; P7 edits both, because
-- CREATE OR REPLACE keeps the ACL the first definition left.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/36-fixture-dblink.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260723172032_mt5_exchange_boundary_checks.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","supabase/migrations/20260919120000_strategy_sync_cursors.sql","supabase/migrations/20261124120500_poll_positions_cohort.sql","supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql"]}

BEGIN;
SET LOCAL lock_timeout = '5s';

-- Seeds one api key for the user. is_active and disconnected_at are the liveness columns.
CREATE FUNCTION pg_temp.pc_key(p_user uuid, p_active boolean, p_disconnected timestamptz) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
    VALUES (p_user, 'okx', 'pc-key', 'x', p_active, p_disconnected)
    RETURNING id INTO v_id;
  RETURN v_id;
END
$f$;

-- Seeds one active, connected api key on the given venue (P8, P9).
CREATE FUNCTION pg_temp.pc_venue_key(p_user uuid, p_exchange text) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.api_keys (user_id, exchange, label, api_key_encrypted, is_active, disconnected_at)
    VALUES (p_user, p_exchange, 'pc-key-' || p_exchange, 'x', true, NULL)
    RETURNING id INTO v_id;
  RETURN v_id;
END
$f$;

-- Seeds one strategy pointing at the key, at the given status.
CREATE FUNCTION pg_temp.pc_strategy(p_user uuid, p_name text, p_status text, p_key uuid) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_sid uuid;
BEGIN
  INSERT INTO public.strategies (user_id, name, status, api_key_id)
    VALUES (p_user, p_name, p_status, p_key) RETURNING id INTO v_sid;
  RETURN v_sid;
END
$f$;

-- Seeds the per-strategy cron cursor, last advanced p_age ago.
CREATE FUNCTION pg_temp.pc_cursor(p_sid uuid, p_age interval) RETURNS void
LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.strategy_sync_cursors (strategy_id, last_sync_at)
    VALUES (p_sid, now() - p_age);
END
$f$;

-- Counts the poll_positions jobs one strategy owns, across every status.
CREATE FUNCTION pg_temp.pc_polls(p_sid uuid) RETURNS integer
LANGUAGE sql AS $f$
  SELECT count(*)::integer FROM public.compute_jobs
   WHERE strategy_id = p_sid AND kind = 'poll_positions';
$f$;

DO $$
DECLARE
  v_user   uuid := gen_random_uuid();
  v_ret    integer;
  v_cnt    integer;
  v_idem   text;
  v_key    uuid;
  v_p1     uuid;
  v_p2     uuid;
  v_p3a    uuid;
  v_p3b    uuid;
  v_p4a    uuid;
  v_p4b    uuid;
  v_p5a    uuid;
  v_p5b    uuid;
  v_p6     uuid;
  v_body   text;
  v_fn     oid;
  v_anon   boolean;
  v_authd  boolean;
  v_pub    boolean;
  v_p8     uuid;
  v_p8s    uuid;
  v_p9b    uuid;
  v_p9y    uuid;
  v_p9d    uuid;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (v_user, 'pc-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name) VALUES (v_user, 'pc') ON CONFLICT (id) DO NOTHING;

  -- ===== ARM P1 - a private cron-synced strategy gets its daily poll ===============
  v_key := pg_temp.pc_key(v_user, true, NULL);
  v_p1  := pg_temp.pc_strategy(v_user, 'pc-p1', 'private', v_key);
  PERFORM pg_temp.pc_cursor(v_p1, interval '2 days');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p1);
  SELECT idempotency_key INTO v_idem FROM public.compute_jobs
   WHERE strategy_id = v_p1 AND kind = 'poll_positions';
  -- RED-UNDER: remove 'private' from the cohort's status list, so a private strategy kept
  --            current by the cron sync is never enqueued and never gets a position snapshot.
  -- RED-UNDER-M: {"arm":"P1","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND s.status IN ('published', 'pending_review', 'private')\n","replace":"        AND s.status IN ('published', 'pending_review')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%''private''%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%''private''%' THEN\n","occurrences":1}]}
  IF v_ret < 1 OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the daily enqueue returned % and left % poll_positions job(s) for a private strategy with an active, connected key and a cron cursor advanced 2 days ago, expected a count of at least 1 and exactly 1 job. Private strategies never get position snapshots.', v_ret, v_cnt;
  END IF;
  IF v_idem IS DISTINCT FROM 'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_p1::text THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the poll job carries idempotency key %, expected the daily key for today and this strategy. The daily key is what keeps a second tick from enqueueing a second poll.', v_idem;
  END IF;

  -- ===== ARM P2 - today's cohort is kept: a done sync_trades job and no cursor ======
  v_p2 := pg_temp.pc_strategy(v_user, 'pc-p2', 'published', pg_temp.pc_key(v_user, true, NULL));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p2, 'done', now() - interval '3 days');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p2);
  -- RED-UNDER: drop the done-job side of the cohort's OR, so only the cursor admits a strategy.
  --            A published strategy kept current by the user triggered sync, which writes a
  --            done sync_trades job and no cursor, is then never polled again.
  -- RED-UNDER-M: {"arm":"P2","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"          EXISTS (\n            SELECT 1 FROM compute_jobs cj\n","replace":"          FALSE AND EXISTS (\n            SELECT 1 FROM compute_jobs cj\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P2): a published strategy with a done sync_trades job 3 days old and no cursor has % poll_positions job(s), expected exactly 1. The widened cohort must keep what today''s cohort polls, or the strategies the user triggered sync keeps current lose their position snapshots.', v_cnt;
  END IF;

  -- ===== ARM P3 - a revoked key is never polled ======================================
  -- Both strategies are private and carry a fresh cursor, so the status and the sync history
  -- would admit them. Only the key's liveness says no.
  v_p3a := pg_temp.pc_strategy(v_user, 'pc-p3a', 'private', pg_temp.pc_key(v_user, true, now() - interval '1 day'));
  PERFORM pg_temp.pc_cursor(v_p3a, interval '1 day');
  v_p3b := pg_temp.pc_strategy(v_user, 'pc-p3b', 'private', pg_temp.pc_key(v_user, false, NULL));
  PERFORM pg_temp.pc_cursor(v_p3b, interval '1 day');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p3a);
  -- RED-UNDER: drop the disconnected-key filter, so a strategy whose key the owner disconnected
  --            is still read daily through the revoked connection (threat T-227-18).
  -- RED-UNDER-M: {"arm":"P3","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.disconnected_at IS NULL\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%disconnected_at IS NULL%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%disconnected_at IS NULL%' THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P3): a private strategy whose key is disconnected has % poll_positions job(s), expected 0. A revoked connection must stop all reads of that account.', v_cnt;
  END IF;

  v_cnt := pg_temp.pc_polls(v_p3b);
  -- RED-UNDER: drop the active-key filter, so a deactivated key is still read daily.
  -- RED-UNDER-M: {"arm":"P3/active","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.is_active\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%ak.is_active%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ak.is_active%' THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P3/active): a private strategy whose key is deactivated has % poll_positions job(s), expected 0. A deactivated key must stop all reads of that account.', v_cnt;
  END IF;

  -- ===== ARM P4 - draft and archived strategies are not polled =======================
  v_p4a := pg_temp.pc_strategy(v_user, 'pc-p4a', 'draft', pg_temp.pc_key(v_user, true, NULL));
  PERFORM pg_temp.pc_cursor(v_p4a, interval '1 day');
  v_p4b := pg_temp.pc_strategy(v_user, 'pc-p4b', 'archived', pg_temp.pc_key(v_user, true, NULL));
  PERFORM pg_temp.pc_cursor(v_p4b, interval '1 day');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p4a);
  -- RED-UNDER: add the draft status to the cohort's list, so an unfinished strategy is polled.
  -- RED-UNDER-M: {"arm":"P4","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND s.status IN ('published', 'pending_review', 'private')\n","replace":"        AND s.status IN ('published', 'pending_review', 'private', 'draft')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body LIKE '%''draft''%' THEN\n","replace":"  IF FALSE AND v_body LIKE '%''draft''%' THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P4): a draft strategy with a fresh cursor has % poll_positions job(s), expected 0. Unfinished strategies are not polled.', v_cnt;
  END IF;

  v_cnt := pg_temp.pc_polls(v_p4b);
  -- RED-UNDER: add the archived status to the cohort's list, so a retired strategy is polled.
  -- RED-UNDER-M: {"arm":"P4/archived","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND s.status IN ('published', 'pending_review', 'private')\n","replace":"        AND s.status IN ('published', 'pending_review', 'private', 'archived')\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P4/archived): an archived strategy with a fresh cursor has % poll_positions job(s), expected 0. Retired strategies are not polled.', v_cnt;
  END IF;

  -- ===== ARM P5 - a stale sync history admits nothing ================================
  -- p5a: cursor 40 days old and no job. p5b: a done sync_trades job 40 days old and no cursor.
  v_p5a := pg_temp.pc_strategy(v_user, 'pc-p5a', 'private', pg_temp.pc_key(v_user, true, NULL));
  PERFORM pg_temp.pc_cursor(v_p5a, interval '40 days');
  v_p5b := pg_temp.pc_strategy(v_user, 'pc-p5b', 'private', pg_temp.pc_key(v_user, true, NULL));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p5b, 'done', now() - interval '40 days');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p5a);
  -- RED-UNDER: widen the cursor side's window from 30 to 60 days, so a key that has not synced
  --            for 40 days still gets a daily poll against an account that stopped answering.
  -- RED-UNDER-M: {"arm":"P5","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"                AND ssc.last_sync_at > (now() - interval '30 days')\n","replace":"                AND ssc.last_sync_at > (now() - interval '60 days')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF (length(v_body) - length(replace(v_body, v_needle, ''))) / length(v_needle) <> 2 THEN\n","replace":"  IF FALSE AND (length(v_body) - length(replace(v_body, v_needle, ''))) / length(v_needle) <> 2 THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P5): a private strategy whose cursor is 40 days old and that has no recent done sync_trades job has % poll_positions job(s), expected 0. The cursor only says the key works inside the 30 day window.', v_cnt;
  END IF;

  v_cnt := pg_temp.pc_polls(v_p5b);
  -- RED-UNDER: widen the job side's window from 30 to 60 days.
  -- RED-UNDER-M: {"arm":"P5/job","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"                AND cj.updated_at > (now() - interval '30 days')\n","replace":"                AND cj.updated_at > (now() - interval '60 days')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF (length(v_body) - length(replace(v_body, v_needle, ''))) / length(v_needle) <> 2 THEN\n","replace":"  IF FALSE AND (length(v_body) - length(replace(v_body, v_needle, ''))) / length(v_needle) <> 2 THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P5/job): a private strategy whose only done sync_trades job is 40 days old has % poll_positions job(s), expected 0. The job side of the cohort is a 30 day window too.', v_cnt;
  END IF;

  -- ===== ARM P6 - the enqueue stays idempotent within a day ==========================
  -- The first call enqueues the strategy's poll, the second finds it still pending. It must
  -- return 0 and leave one job: a second tick the same day (a second worker replica, a retried
  -- loop) must not double the exchange traffic.
  v_p6 := pg_temp.pc_strategy(v_user, 'pc-p6', 'private', pg_temp.pc_key(v_user, true, NULL));
  PERFORM pg_temp.pc_cursor(v_p6, interval '1 day');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p6);
  -- RED-UNDER: drop the in-flight pre-count condition from the increment, so a call that only
  --            found an existing job still counts it as newly enqueued and the second call
  --            reports work it did not do.
  -- RED-UNDER-M: {"arm":"P6","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"    IF v_existing_count = 0 AND v_job_id IS NOT NULL THEN\n","replace":"    IF v_job_id IS NOT NULL THEN\n","occurrences":1}]}
  IF v_ret <> 0 OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P6): the second daily enqueue the same day returned % and left % poll_positions job(s) for the strategy, expected 0 and exactly 1. The enqueue must stay idempotent per day.', v_ret, v_cnt;
  END IF;

  -- ===== ARM P7 - the call is unchanged and stays closed to browser roles ============
  v_fn := to_regprocedure('public.enqueue_poll_positions_for_all_strategies()');
  v_body := regexp_replace(pg_get_functiondef(v_fn), '--[^\n]*', '', 'g');
  -- RED-UNDER: change the metadata marker the loop stamps on each job from daily_loop to another
  --            value. The worker's call is unchanged but the jobs it enqueues no longer carry
  --            the marker the admin views read to tell a daily poll from a manual one.
  -- RED-UNDER-M: {"arm":"P7/body","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"jsonb_build_object('enqueued_by', 'daily_loop', 'enqueued_at', now())","replace":"jsonb_build_object('enqueued_by', 'cohort_loop', 'enqueued_at', now())","occurrences":1}]}
  IF v_body NOT LIKE '%''poll_positions'',%' OR v_body NOT LIKE '%''daily-poll-'' ||%'
     OR v_body NOT LIKE '%''enqueued_by'', ''daily_loop''%' THEN
    RAISE EXCEPTION 'TEST FAILED (P7/body): the deployed body no longer enqueues kind poll_positions under the daily- idempotency prefix with enqueued_by daily_loop. The worker calls this function with no arguments and the jobs it creates must look as they always did.';
  END IF;

  v_anon  := has_function_privilege('anon', v_fn, 'EXECUTE');
  v_authd := has_function_privilege('authenticated', v_fn, 'EXECUTE');
  v_pub   := EXISTS (SELECT 1
                       FROM pg_proc p
                       CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                      WHERE p.oid = v_fn AND a.grantee = 0 AND a.privilege_type = 'EXECUTE');
  -- RED-UNDER: leave authenticated out of the REVOKE, so any signed-in browser session can call
  --            the daily fan-out and flood the exchanges with position polls (threat T-227-20).
  -- RED-UNDER-M: {"arm":"P7","apply":[{"kind":"edit","file":"supabase/migrations/20261124120500_poll_positions_cohort.sql","find":"REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon, authenticated;\n","replace":"REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon;\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120500_poll_positions_cohort.sql","find":"  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN\n","replace":"  IF FALSE AND (has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')) THEN\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon, authenticated;\n","replace":"REVOKE ALL ON FUNCTION enqueue_poll_positions_for_all_strategies FROM PUBLIC, anon;\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE') THEN\n","replace":"  IF FALSE AND (has_function_privilege('anon', v_fn, 'EXECUTE') OR has_function_privilege('authenticated', v_fn, 'EXECUTE')) THEN\n","occurrences":1}]}
  IF v_anon OR v_authd OR v_pub THEN
    RAISE EXCEPTION 'TEST FAILED (P7): EXECUTE on the daily poll fan-out is held by anon=%, authenticated=%, PUBLIC=%, expected none of them. Only the worker (service_role) may call it.', v_anon, v_authd, v_pub;
  END IF;

  -- ===== ARM P8 - a venue the poll cannot serve is never enqueued ====================
  -- The PROD shape of 2026-11-25: private, an active and connected key, a done sync_trades
  -- job 1 day old and no cursor, so the status, the liveness and the job side all admit it.
  -- Only the venue says no.
  v_p8 := pg_temp.pc_strategy(v_user, 'pc-p8', 'private', pg_temp.pc_venue_key(v_user, 'mt5'));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p8, 'done', now() - interval '1 day');
  v_p8s := pg_temp.pc_strategy(v_user, 'pc-p8s', 'private', pg_temp.pc_venue_key(v_user, 'sfox'));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p8s, 'done', now() - interval '1 day');
  v_p9b := pg_temp.pc_strategy(v_user, 'pc-p9b', 'private', pg_temp.pc_venue_key(v_user, 'binance'));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p9b, 'done', now() - interval '1 day');
  v_p9y := pg_temp.pc_strategy(v_user, 'pc-p9y', 'private', pg_temp.pc_venue_key(v_user, 'bybit'));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p9y, 'done', now() - interval '1 day');
  v_p9d := pg_temp.pc_strategy(v_user, 'pc-p9d', 'private', pg_temp.pc_venue_key(v_user, 'deribit'));
  INSERT INTO public.compute_jobs (kind, strategy_id, status, updated_at)
    VALUES ('sync_trades', v_p9d, 'done', now() - interval '1 day');

  SET LOCAL ROLE service_role;
  v_ret := public.enqueue_poll_positions_for_all_strategies();
  RESET ROLE;

  v_cnt := pg_temp.pc_polls(v_p8);
  -- RED-UNDER: drop the venue gate (the 20261124120500 body), so a private MT5 strategy is
  --            enqueued and its job fails 3/3 on an Mt5Session that has no fetch_positions.
  -- RED-UNDER-M: {"arm":"P8","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.exchange IN ('binance', 'bybit', 'okx')\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P8): a private MT5 strategy with an active key and a done sync_trades job 1 day old has % poll_positions job(s), expected 0. run_poll_positions_job calls the ccxt fetch_positions, which an Mt5Session does not have, so every such job fails 3/3.', v_cnt;
  END IF;

  v_cnt := pg_temp.pc_polls(v_p8s);
  -- RED-UNDER: add sfox to the venue gate, so an sFOX strategy is enqueued for a poll its
  --            SfoxClient cannot run.
  -- RED-UNDER-M: {"arm":"P8/sfox","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.exchange IN ('binance', 'bybit', 'okx')\n","replace":"        AND ak.exchange IN ('binance', 'bybit', 'okx', 'sfox')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P8/sfox): a private sFOX strategy with an active key and a done sync_trades job 1 day old has % poll_positions job(s), expected 0. An SfoxClient has no ccxt fetch_positions either.', v_cnt;
  END IF;

  -- ===== ARM P9 - every venue the poll serves is still polled =================
  v_cnt := pg_temp.pc_polls(v_p9b);
  -- RED-UNDER: drop binance from the venue gate, so binance strategies lose their position
  --            snapshots although the poll serves them.
  -- RED-UNDER-M: {"arm":"P9/binance","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.exchange IN ('binance', 'bybit', 'okx')\n","replace":"        AND ak.exchange IN ('bybit', 'okx')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P9/binance): a private binance strategy with an active key and a done sync_trades job 1 day old has % poll_positions job(s), expected exactly 1. The poll serves binance end to end.', v_cnt;
  END IF;

  v_cnt := pg_temp.pc_polls(v_p9y);
  -- RED-UNDER: drop bybit from the venue gate.
  -- RED-UNDER-M: {"arm":"P9/bybit","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.exchange IN ('binance', 'bybit', 'okx')\n","replace":"        AND ak.exchange IN ('binance', 'okx')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","occurrences":1}]}
  IF v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P9/bybit): a private bybit strategy with an active key and a done sync_trades job 1 day old has % poll_positions job(s), expected exactly 1. The poll serves bybit end to end.', v_cnt;
  END IF;

  v_cnt := pg_temp.pc_polls(v_p9d);
  -- RED-UNDER: add deribit back to the venue gate, so a Deribit strategy is enqueued and a
  --            held position fails position_snapshots_exchange_check on the upsert.
  -- RED-UNDER-M: {"arm":"P8/deribit","apply":[{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"        AND ak.exchange IN ('binance', 'bybit', 'okx')\n","replace":"        AND ak.exchange IN ('binance', 'bybit', 'deribit', 'okx')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261126180000_poll_positions_cohort_ccxt_venues.sql","find":"  IF v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%ak.exchange IN (''binance'', ''bybit'', ''okx'')%' THEN\n","occurrences":1}]}
  IF v_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P8/deribit): a private deribit strategy with an active key and a done sync_trades job 1 day old has % poll_positions job(s), expected 0. position_snapshots_exchange_check admits no deribit row, so a held Deribit position fails the snapshot upsert.', v_cnt;
  END IF;

  RAISE NOTICE 'ALL 9 ARMS EXECUTED (P1, P2, P3, P4, P5, P6, P7, P8, P9): a private cron-synced strategy is polled (P1), today''s job-synced cohort is kept (P2), a disconnected or deactivated key is never polled (P3), draft and archived strategies are not polled (P4), a 40 day old sync history admits nothing (P5), a second call the same day enqueues nothing (P6), the call and its ACL are unchanged (P7), MT5, sFOX and Deribit strategies are never polled (P8), and binance and bybit strategies still are (P9)';
END
$$;

ROLLBACK;
