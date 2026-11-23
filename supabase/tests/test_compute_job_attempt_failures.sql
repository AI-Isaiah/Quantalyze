-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 01 (MT5D-01): a failed compute-job attempt keeps its cause.
-- Guards migration 20261124120000_jobledger_attempt_failures.sql (and, from plan 02,
-- 20261124120100, which adds the watchdog_reset and stall_reclaim writers).
--
-- WHAT IS UNDER TEST. claim_compute_jobs_with_priority clears compute_jobs.last_error and
-- error_kind on every failed_retry -> running re-claim (M-1137/M-1138; that clear stays and
-- stays pinned). That clear was the ONLY place attempt 1's cause lived, so once attempt 2
-- was claimed the cause was gone, and once attempt 2 ended `done` nothing said attempt 1 had
-- ever failed. The migration adds public.compute_job_attempt_failures (append-only, no
-- foreign key to compute_jobs, owner cascades), makes mark_compute_job_failed write one
-- `error` row in the transaction that flips the job to failed, and adds
-- record_compute_job_attempt_error for the two paths where the worker holds the real error
-- but the mark could not land (SQLSTATE 55P03, and a 55006 late mark after the watchdog took
-- the claim).
--
-- ARMS, in the order they EXECUTE. The order is LOAD-BEARING: a mutation twin must make ITS
-- OWN arm the first failure, so an arm may only depend on arms listed before it, and no
-- twin may redden an earlier arm.
--   E1   (ROADMAP SC-1) the REAL claim and mark RPCs: attempt 1 fails through
--        mark_compute_job_failed, attempt 2 is claimed by claim_compute_jobs_with_priority
--        (which clears last_error and error_kind: the job row reads NULL for both) and ends
--        done through mark_compute_job_done. Attempt 1's cause (attempt number, cause_class
--        error, error_kind, error text, claim token) is still the one ledger row, unchanged.
--   E2   a job still `running` with its token (the 55P03 shape): the worker-lost RPC returns
--        true and writes one `error` row; the identical second call returns false and writes
--        nothing (UNIQUE (job_id, claim_token, cause_class)).
--   E4   a forged token on a running job, and any token on a job id that does not exist:
--        false, no row. (Listed before E3 on purpose: its twin makes the job-row attestation
--        accept ANY token on a running job, which would also redden E3's re-claimed job, so
--        E4 has to be the first arm that notices.)
--   E3   the late-55006 shape: the token was NULLed by a reset, a watchdog_reset ledger row
--        holds it, and the job has since been re-claimed by another worker. The call returns
--        true and the job holds BOTH a watchdog_reset and an error row for that token.
--        E3b: the late error is filed under the attempt that raised it (attempt and
--        worker_id of the reset row), never under the next attempt.
--   E5   (empty) a NULL p_error is stored as a NULL error_text, never a made-up string.
--   E6   (negative control) a fan-in child failed by its parent's cascade never ran and
--        writes no record; only the parent's row exists.
--   E7   (lifecycle and ordering) deleting the compute_jobs row leaves the records (no
--        foreign key), and the documented read order, attempt then recorded_at then id, is
--        the order an independent computation gives, for rows that share one recorded_at.
--   E8   (ACL and RLS, behavioural) anon and authenticated cannot SELECT the table or
--        EXECUTE the worker-lost RPC; service_role can SELECT and cannot INSERT.
--
-- ONE `BEGIN; DO; ROLLBACK;` BLOCK PER ARM. Each block rolls back, so the file leaves no row
-- behind and runs on BOTH lanes: the pg-lane under sql-mutation and the local Supabase stack
-- under sql-tests. Every assertion is about rows the arm itself seeded (never a global
-- count: on shared TEST others' rows exist). Capture-then-assert (lint R1): the one call
-- that may raise sits in an inner BEGIN/EXCEPTION block that ONLY captures SQLSTATE and
-- SQLERRM; every `TEST FAILED (<arm>)` raise sits after that block, DIRECTLY in the DO body
-- (scripts/mutation-runner/GRAMMAR.md, rule 3c). Each `<arm>-SETUP` identity checks only a
-- prerequisite no twin touches.
--
-- SEEDS. Per arm: a fresh auth.users row, a profiles row, an api_keys row and a strategies
-- row per job (the unique index compute_jobs_one_inflight_per_kind_strategy refuses two
-- in-flight jobs of one kind on one strategy). Seed rows only; this gate never CREATEs a
-- table a migration or fixture owns (sql-gate-lint R5-R7).
--
-- SETUP LIST. The union of test_fan_in_failure_cascade.sql's list (the latest
-- mark_compute_job_failed and the bridge it calls) and the claim pair's (fixtures 29 and 36
-- after 20260924230827, then 20260927120000, the claim RPC the worker calls), in dependency
-- order, ending with the migration the twins edit. Fixture 36 adds claim_token with
-- ADD COLUMN IF NOT EXISTS, so it is a no-op after 20260515114555.
--
-- LANE SUBSTITUTION (recorded, not hidden). The pg-lane has no Supabase auth schema beyond
-- the stand-ins and no PostgREST, so E8 proves the privilege model with SET ROLE, not with a
-- JWT. Plan 10 owns the proof on the local-stack lane.
-- ==========================================================================

-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261124120000_jobledger_attempt_failures.sql"]}

-- >>> ARM E1
BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  t1         UUID;
  t2         UUID;
  v_state    TEXT;
  v_msg      TEXT;
  r_fail     JSONB;
  r_claim    JSONB;
  r_done     JSONB;
  n_fail     INTEGER;
  n_claim    INTEGER;
  n_done     INTEGER;
  v_last_err TEXT;
  v_err_kind TEXT;
  v_status   TEXT;
  v_attempts INTEGER;
  v_ok       BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'jl-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'jl', 'jl-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'jl e1', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'jl e1') RETURNING id INTO s;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s, 'sync_trades', 'pending', 0, 3) RETURNING id INTO j;

  -- Attempt 1: the REAL claim, then the REAL failure mark.
  v_state := NULL; v_msg := NULL;
  BEGIN
    SELECT c.claim_token INTO t1
      FROM public.claim_compute_jobs_with_priority(1000, 'e1-worker', NULL) c WHERE c.id = j;
    PERFORM mark_compute_job_failed(j, 'E1 attempt one failed', 'transient', t1);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL OR t1 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (E1-SETUP): claiming and failing the seeded job raised SQLSTATE % (message: %) with claim token %, so attempt one never ended in a failure whose cause this arm reads.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(t1::text, 'NULL');
  END IF;
  SELECT count(*) INTO n_fail FROM compute_job_attempt_failures f WHERE f.job_id = j;
  SELECT to_jsonb(f) INTO r_fail FROM compute_job_attempt_failures f WHERE f.job_id = j ORDER BY f.attempt, f.recorded_at, f.id LIMIT 1;

  -- Attempt 2: make the retry due, claim it for real (this clears last_error and error_kind).
  UPDATE compute_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = j;
  v_state := NULL; v_msg := NULL;
  BEGIN
    SELECT c.claim_token INTO t2
      FROM public.claim_compute_jobs_with_priority(1000, 'e1-worker', NULL) c WHERE c.id = j;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL OR t2 IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (E1-SETUP): re-claiming the failed_retry job raised SQLSTATE % (message: %) with claim token %, so attempt two never started.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(t2::text, 'NULL');
  END IF;
  SELECT cj.last_error, cj.error_kind, cj.status, cj.attempts
    INTO v_last_err, v_err_kind, v_status, v_attempts FROM compute_jobs cj WHERE cj.id = j;
  SELECT count(*) INTO n_claim FROM compute_job_attempt_failures f WHERE f.job_id = j;
  SELECT to_jsonb(f) INTO r_claim FROM compute_job_attempt_failures f WHERE f.job_id = j ORDER BY f.attempt, f.recorded_at, f.id LIMIT 1;

  -- Attempt 2 succeeds.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_done(j, t2);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (E1-SETUP): mark_compute_job_done on attempt two raised SQLSTATE % (message: %), so the job never ended done.', v_state, v_msg;
  END IF;
  SELECT count(*) INTO n_done FROM compute_job_attempt_failures f WHERE f.job_id = j;
  SELECT to_jsonb(f) INTO r_done FROM compute_job_attempt_failures f WHERE f.job_id = j ORDER BY f.attempt, f.recorded_at, f.id LIMIT 1;

  -- ===== ARM E1 — attempt 1's cause survives attempt 2's claim and attempt 2's success =====
  v_ok := COALESCE(
        n_fail = 1
    AND (r_fail->>'attempt')::int = 1
    AND r_fail->>'cause_class' = 'error'
    AND r_fail->>'error_kind' = 'transient'
    AND r_fail->>'error_text' = 'E1 attempt one failed'
    AND (r_fail->>'claim_token')::uuid = t1
    AND t2 IS DISTINCT FROM t1
    AND v_status = 'running' AND v_attempts = 2
    AND v_last_err IS NULL AND v_err_kind IS NULL
    AND n_claim = 1 AND r_claim = r_fail
    AND n_done = 1 AND r_done = r_fail, FALSE);
  -- RED-UNDER: replace mark_compute_job_failed's MT5D-01 INSERT with a statement that writes nothing (its SELECT reads `WHERE FALSE`), so a failed attempt keeps no record.
  -- RED-UNDER-M: {"arm":"E1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120000_jobledger_attempt_failures.sql","find":"p_error, cj.claimed_by\n    FROM compute_jobs cj\n   WHERE cj.id = p_job_id\n  ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;","replace":"p_error, cj.claimed_by\n    FROM compute_jobs cj\n   WHERE FALSE\n  ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (E1): after attempt 1 failed through mark_compute_job_failed and attempt 2 was claimed and ended done, the ledger held % row(s) after the failure, % after the re-claim and % after done, the first row reading % (expected exactly one row, unchanged throughout: attempt 1, cause_class error, error_kind transient, error_text ''E1 attempt one failed'', claim_token %); the job row reads status %, attempts %, last_error %, error_kind % after the re-claim (expected running, 2, NULL, NULL because the M-1137 clear stays). A failed attempt whose cause is gone once the retry is claimed cannot be investigated, and Phase 230 reads these records.', n_fail, n_claim, n_done, COALESCE(r_fail::text, 'NULL'), COALESCE(t1::text, 'NULL'), COALESCE(v_status, 'NULL'), COALESCE(v_attempts::text, 'NULL'), COALESCE(v_last_err, 'NULL'), COALESCE(v_err_kind, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM E1

DO $$ BEGIN RAISE NOTICE 'ALL 1 ARMS EXECUTED (E1) and passed - E1 attempt 1''s cause survives attempt 2''s re-claim and success.'; END $$;
