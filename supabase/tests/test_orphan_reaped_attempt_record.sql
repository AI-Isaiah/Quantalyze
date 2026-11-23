-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 07 (MT5D-01): a reaped orphan keeps its cause.
-- Guards migration 20261124120600_orphan_reaped_attempt_record.sql.
--
-- WHAT IS UNDER TEST. The hourly terminalizer retention_compute_jobs_orphaned_running ends
-- a running job as failed_final with error_kind 'orphaned' (arm A: a claim stamp past the
-- 4-hour window; arm B: no claim stamp and a row past 48 hours). That ends an attempt, and
-- its cause lived only on the compute_jobs row, which the 90-day failed-row prune erases.
-- The migration records it with a trigger on the transition, because under the Phase 164.7
-- rule a migration may not re-register the terminalizer's cron job, so the cron body is
-- untouched and this gate never edits it.
--
-- ORACLE DISCIPLINE (inherited from test_retention_orphaned_running.sql). Every arm that
-- needs the terminalizer reads the DEPLOYED command out of cron.job.command by jobname and
-- EXECUTEs it. It never re-types the predicate: a gate that re-implements the predicate
-- passes when the deployed predicate is wrong.
--
-- ARMS, in the order they EXECUTE. The order is LOAD-BEARING: a mutation twin must make ITS
-- OWN arm the first failure, so an arm may only depend on arms listed before it.
--   O1   (arm A) a job running with a claim stamp past the window, token t, attempts 2,
--        claimed_by w1: the real terminalizer ends it failed_final and exactly one ledger
--        row exists with cause_class orphan_reaped, claim_token t, attempt 2, worker_id w1
--        and the terminalizer's own last_error text.
--
-- ISOLATION. Seeds are backdated a CENTURY, which sorts ahead of any foreign candidate under
-- the terminalizer's ORDER BY, so a seed wins the 100-row budget without this file touching
-- a row it does not own. Every assertion reads only rows this arm seeded (never a global
-- count). One `BEGIN; DO; ROLLBACK;` block per arm, so the file leaves nothing behind and
-- runs on both lanes (the pg-lane under sql-mutation and the local stack under sql-tests).
-- Capture-then-assert (lint R1): the call that may raise sits in an inner BEGIN/EXCEPTION
-- block that ONLY captures SQLSTATE and SQLERRM, and every `TEST FAILED (<arm>)` raise sits
-- after it, DIRECTLY in the DO body (scripts/mutation-runner/GRAMMAR.md, rule 3c).
--
-- SETUP LIST. test_retention_orphaned_running.sql's list (pg_cron, the terminalizer and its
-- 20260826140000 re-registration) joined to test_compute_job_attempt_failures.sql's list (the
-- ledger table, the latest mark_compute_job_failed and the claim pair), de-duplicated, in
-- dependency order, ending with the ledger migration and then the migration this gate twins.
-- 20260515114555 (claim-token fencing) is excluded for the reason the ledger gate gives
-- (a second, 3-argument claim function); fixture 36 supplies claim_token instead.
-- ==========================================================================

-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260513094906_enable_pg_cron.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260516104201_compute_jobs_audit_2026_05_07_residual.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260719120000_retention_orphaned_running_compute_jobs.sql","supabase/migrations/20260720120000_retention_orphaned_running_window_4h.sql","supabase/migrations/20260817120000_retention_orphaned_running_terminalize.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826140000_compute_jobs_error_kind_orphaned.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261124120000_jobledger_attempt_failures.sql","supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql"]}

-- >>> ARM O1
BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  t          UUID := gen_random_uuid();
  v_command  TEXT;
  v_ancient  TIMESTAMPTZ := now() - interval '100 years';
  v_state    TEXT;
  v_msg      TEXT;
  v_status   TEXT;
  v_kind     TEXT;
  n          INTEGER;
  v_row      JSONB;
  v_ok       BOOLEAN;
BEGIN
  SELECT cj.command INTO v_command FROM cron.job cj WHERE cj.jobname = 'retention_compute_jobs_orphaned_running';
  IF v_command IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): the retention_compute_jobs_orphaned_running cron job is not registered while pg_cron is installed, so the real terminalizer cannot be executed. A missing terminalizer is a red gate, never a skip.';
  END IF;

  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'orp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'orp', 'orp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'orp o1', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'orp o1') RETURNING id INTO s;
  -- Arm A: a claim stamp far past the 4-hour window, attempt 2 of a worker that died.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at, next_attempt_at)
  VALUES (s, 'sync_trades', 'running', 2, 3, t, 'w1', v_ancient, v_ancient) RETURNING id INTO j;

  -- THE ORACLE: run the REAL deployed terminalizer body.
  v_state := NULL; v_msg := NULL;
  BEGIN
    EXECUTE v_command;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): executing the deployed terminalizer raised SQLSTATE % (message: %), so the reap this arm reads never completed.', v_state, v_msg;
  END IF;
  SELECT cj.status, cj.error_kind INTO v_status, v_kind FROM compute_jobs cj WHERE cj.id = j;
  IF v_status IS DISTINCT FROM 'failed_final' OR v_kind IS DISTINCT FROM 'orphaned' THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): the deployed terminalizer left the seeded orphan at status % and error_kind % (expected failed_final and orphaned), so there is no reaped attempt for this arm to read.', COALESCE(v_status, 'NULL'), COALESCE(v_kind, 'NULL');
  END IF;
  SELECT count(*) INTO n FROM compute_job_attempt_failures f WHERE f.job_id = j;
  SELECT to_jsonb(f) INTO v_row FROM compute_job_attempt_failures f WHERE f.job_id = j ORDER BY f.attempt, f.recorded_at, f.id LIMIT 1;

  -- ===== ARM O1 - a reaped orphan (arm A) keeps its cause =====
  v_ok := COALESCE(
        n = 1
    AND v_row->>'cause_class' = 'orphan_reaped'
    AND (v_row->>'claim_token')::uuid = t
    AND (v_row->>'attempt')::int = 2
    AND v_row->>'worker_id' = 'w1'
    AND v_row->>'error_kind' = 'orphaned'
    AND (v_row->>'error_text') LIKE 'orphaned_running_reaped:%'
    AND (v_row->>'strategy_id')::uuid = s
    AND v_row->>'kind' = 'sync_trades', FALSE);
  -- RED-UNDER: change the trigger's WHEN literal 'orphaned' to another value in migration 20261124120600, so the terminalizer's transition never fires the trigger and the reaped attempt is recorded nowhere.
  -- RED-UNDER-M: {"arm":"O1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120600_orphan_reaped_attempt_record.sql","find":"AND NEW.error_kind = 'orphaned')\n  EXECUTE FUNCTION","replace":"AND NEW.error_kind = 'orphaned_never')\n  EXECUTE FUNCTION","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (O1): after the real terminalizer reaped a running job (claim token %, attempts 2, worker w1) the ledger held % row(s), the first reading % (expected exactly one: cause_class orphan_reaped, that claim token, attempt 2, worker_id w1, error_kind orphaned, error_text starting orphaned_running_reaped:, the job''s strategy and kind). A worker death leaves no record once the job row is pruned, so Phase 230 reads a night in which nothing failed.', t, n, COALESCE(v_row::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM O1

DO $$ BEGIN RAISE NOTICE 'ALL 1 ARMS EXECUTED (O1) and passed - O1 a reaped orphan keeps its cause.'; END $$;
