-- Test: the daily positions poll covers private strategies kept current by the cron sync,
-- never polls a revoked key, and stays live and idempotent.
-- Phase 227 JOBLEDGER, plan 06 (ROADMAP SC-5, requirement HEAL-05).
-- Guards migration 20261124120500_poll_positions_cohort.sql.
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
-- per-strategy cursor table, then the migration under test.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","scripts/pg-lane/fixtures/36-fixture-dblink.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql","supabase/migrations/20261114130000_enqueue_dedup_record_retract.sql","supabase/migrations/20260919120000_strategy_sync_cursors.sql","supabase/migrations/20261124120500_poll_positions_cohort.sql"]}

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
  -- RED-UNDER-M: {"arm":"P1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120500_poll_positions_cohort.sql","find":"        AND s.status IN ('published', 'pending_review', 'private')\n","replace":"        AND s.status IN ('published', 'pending_review')\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261124120500_poll_positions_cohort.sql","find":"  IF v_body NOT LIKE '%''private''%' THEN\n","replace":"  IF FALSE AND v_body NOT LIKE '%''private''%' THEN\n","occurrences":1}]}
  IF v_ret < 1 OR v_cnt <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the daily enqueue returned % and left % poll_positions job(s) for a private strategy with an active, connected key and a cron cursor advanced 2 days ago, expected a count of at least 1 and exactly 1 job. Private strategies never get position snapshots.', v_ret, v_cnt;
  END IF;
  IF v_idem IS DISTINCT FROM 'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_p1::text THEN
    RAISE EXCEPTION 'TEST FAILED (P1): the poll job carries idempotency key %, expected the daily key for today and this strategy. The daily key is what keeps a second tick from enqueueing a second poll.', v_idem;
  END IF;

  RAISE NOTICE 'ALL 1 ARMS EXECUTED (P1): a private strategy kept current by the cron sync is enqueued once with the daily idempotency key';
END
$$;

ROLLBACK;
