-- ==========================================================================
-- Phase 164.9.3.2 DEFER40001 — `[164.9.4-DEFER-40001-RETRY-HANG]`: every
-- claim-token fence raise in the compute-job RPCs answers SQLSTATE 55006, never
-- SQLSTATE 40001, and keeps the classifier literal.
--
-- WHAT IS UNDER TEST. Migration
-- 20261001120000_compute_job_fence_errcode_55006.sql re-bases
-- `defer_compute_job`, `mark_compute_job_done` and `mark_compute_job_failed`
-- and moves their four fence raises from `serialization_failure` (40001) to
-- `55006` (object_in_use), message text unchanged.
--
-- WHY IT MATTERS. PostgREST 14.x runs every RPC inside hasql-transaction's
-- retrying transaction, which re-runs the call WITHOUT BOUND on SQLSTATE 40001
-- (and 40P01). A claim-token mismatch never changes on retry, so a 40001 fence
-- raise busy-loops through PostgREST instead of failing once: the worker's
-- call never returns, a pool slot and a CPU stay pinned, and the loop outlives
-- the client disconnect (164.9.3.2-01 measured all four sites on v14.7). 55006
-- is answered once.
--
-- WHAT THIS FILE CAN AND CANNOT SEE. psql calls the function directly, with no
-- retrying transaction around it, so psql sees ONE raise either way. This file
-- therefore reads the SQLSTATE itself — the value PostgREST keys its retry on —
-- not the loop. The loop is observed through PostgREST by the live-DB vitest in
-- src/__tests__/ (plan 164.9.3.2-03).
--
-- HOW. One in-transaction `BEGIN; DO $$ … $$; ROLLBACK;`, no dblink, so the
-- file runs on BOTH lanes: the pg-lane under sql-mutation and the local
-- Supabase stack under sql-tests. Plain PL/pgSQL, RAISE EXCEPTION on failure,
-- no pgTAP, no psql meta-commands. Each call runs in an inner BEGIN/EXCEPTION
-- block that ONLY captures SQLSTATE and SQLERRM; every assertion sits after
-- that block (lint R1). Every seed is a fresh row under a fresh user, one
-- strategy per fence site, so no arm reads another arm's row and the
-- one-in-flight-per-kind index can never refuse a seed.
--
-- ARMS. Each errcode arm asserts SQLSTATE 55006; each literal arm (suffix L)
-- asserts the message still carries the classifier literal, which is what keeps
-- the deploy window safe in both directions (an old worker classifies a 55006
-- by the literal). The file order D1, D1L, … is what makes each twin's FIRST
-- failure its own arm: every twin leaves the arms above it green.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes: it mutates COPIES
-- on a throwaway pg-lane cluster, requires the FIRST failure identity to name
-- that arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- Every twin is LAYERED, two steps: (1) the production edit to the matching
-- raise in the new migration, and (2) that function's ONE combined self-verify
-- guard in the same migration stood down with `IF FALSE THEN`, because the
-- guard refuses the edited body and would abort the apply before this file
-- ran. Step 2 touches the runner's scratch copy only, so the real replay still
-- enforces the guard.
--
-- ⚠️ SETUP (A7, measured on the pg-lane): the apply list of
-- supabase/tests/test_mark_rpc_bridge_advisory_lock.sql WITHOUT fixture 36
-- (dblink, which this file does not use), with
-- 20260529170000_defer_compute_job_claim_token_fence.sql added in filename
-- order (it creates the 4-arg defer_compute_job the new migration re-bases;
-- 20260412094449, which created the 3-arg form, is not needed: the new
-- migration replaces the 4-arg signature only), and the new migration LAST,
-- because its CREATE OR REPLACEs must be the definitions the arms run against.
-- The bridge chain stays in the list because the new migration's self-verify
-- carries 20260926120000's anchors forward, and those anchors read the mark
-- bodies that name the bridge.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260529170000_defer_compute_job_claim_token_fence.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260926120000_mark_compute_job_bridge_advisory_lock.sql","supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql"]}

BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_defer  UUID;
  j_defer  UUID;
  s_mdone  UUID;
  j_mdone  UUID;
  s_mrun   UUID;
  j_mrun   UUID;
  s_frun   UUID;
  j_frun   UUID;
  tok_a    UUID := gen_random_uuid();
  tok_b    UUID := gen_random_uuid();
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  -- ----- SEED ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cfe-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cfe', 'cfe-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cfe mt5', 'x', TRUE) RETURNING id INTO k;

  -- D: a RUNNING row held by claim token A.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cfe defer') RETURNING id INTO s_defer;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_defer, 'derive_broker_dailies', 'running', tok_a, 1, 3) RETURNING id INTO j_defer;

  -- M1: an already-DONE row whose recorded token is A (seeded directly, never
  -- through a prior mark call, so this arm depends on no other RPC).
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cfe done-late') RETURNING id INTO s_mdone;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_mdone, 'derive_broker_dailies', 'done', tok_a, 1, 3) RETURNING id INTO j_mdone;

  -- M2: a RUNNING row held by token A, for mark_compute_job_done.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cfe done-running') RETURNING id INTO s_mrun;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_mrun, 'derive_broker_dailies', 'running', tok_a, 1, 3) RETURNING id INTO j_mrun;

  -- F1: a RUNNING row held by token A, for mark_compute_job_failed.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cfe failed-running') RETURNING id INTO s_frun;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_frun, 'derive_broker_dailies', 'running', tok_a, 1, 3) RETURNING id INTO j_frun;
  -- ===== ARM D1 / D1L — defer_compute_job, token mismatch on a running row ==
  -- A worker holding token B defers a job that token A now holds.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM defer_compute_job(j_defer, 60, 'cfe fence probe', tok_b);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: put defer_compute_job's fence raise in 20261001120000 back on
  --            `serialization_failure`; LAYERED with the defer combined
  --            self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"D1","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'defer_compute_job: job % preempted by watchdog reclaim (caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = '55006';","replace":"'defer_compute_job: job % preempted by watchdog reclaim (caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = 'serialization_failure';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_defer_body ~* 'serialization_failure' OR regexp_count(v_defer_body, '''55006''') <> 1 OR position('preempted by watchdog reclaim' IN v_defer_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '55006' THEN
    RAISE EXCEPTION 'TEST FAILED (D1): defer_compute_job with a stale claim token on a running row raised SQLSTATE % (message: %), expected 55006. SQLSTATE 40001 is retried without bound by PostgREST 14, so the worker''s defer call would loop instead of failing once.', v_state, v_msg;
  END IF;

  -- RED-UNDER: reword the classifier literal in defer_compute_job's fence
  --            message in 20261001120000; LAYERED with the defer combined
  --            self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"D1L","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'defer_compute_job: job % preempted by watchdog reclaim (caller token=","replace":"'defer_compute_job: job % preempted by watchdog requeue (caller token=","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_defer_body ~* 'serialization_failure' OR regexp_count(v_defer_body, '''55006''') <> 1 OR position('preempted by watchdog reclaim' IN v_defer_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_msg IS NULL OR position('preempted by watchdog reclaim' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (D1L): defer_compute_job''s fence message (%) lost the classifier literal. A worker still on the old classifier recognises the new code only by that literal, so the deploy window would misclassify a lost claim as a real failure.', v_msg;
  END IF;

  -- ===== ARM M1 / M1L — mark_compute_job_done, late mark on an already-done row ==
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_done(j_mdone, tok_b);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: put mark_compute_job_done's late-mark raise (already-done row) in
  --            20261001120000 back on `serialization_failure`; LAYERED with the
  --            mark_compute_job_done combined self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"M1","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = '55006';","replace":"'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = 'serialization_failure';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_done_body ~* 'serialization_failure' OR regexp_count(v_done_body, '''55006''') <> 2 OR regexp_count(v_done_body, 'preempted by watchdog reclaim') <> 2 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '55006' THEN
    RAISE EXCEPTION 'TEST FAILED (M1): a late mark_compute_job_done with a stale token on an already-done row raised SQLSTATE % (message: %), expected 55006. SQLSTATE 40001 is retried without bound by PostgREST 14, so the worker''s mark call would loop instead of failing once.', v_state, v_msg;
  END IF;

  -- RED-UNDER: reword the classifier literal in mark_compute_job_done's late-mark
  --            message in 20261001120000; LAYERED with the mark_compute_job_done
  --            combined self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"M1L","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row","replace":"'mark_compute_job_done: job % preempted by watchdog requeue (late mark on already-done row","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_done_body ~* 'serialization_failure' OR regexp_count(v_done_body, '''55006''') <> 2 OR regexp_count(v_done_body, 'preempted by watchdog reclaim') <> 2 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_msg IS NULL OR position('preempted by watchdog reclaim' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (M1L): the fence message of a late mark_compute_job_done with a stale token on an already-done row (%) lost the classifier literal. A worker still on the old classifier recognises the new code only by that literal, so the deploy window would misclassify a lost claim as a real failure.', v_msg;
  END IF;

  -- ===== ARM M2 / M2L — mark_compute_job_done, token mismatch on a running row ==
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_done(j_mrun, tok_b);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: put mark_compute_job_done's running-row mismatch raise in
  --            20261001120000 back on `serialization_failure`; LAYERED with the
  --            mark_compute_job_done combined self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"M2","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = '55006';","replace":"'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = 'serialization_failure';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_done_body ~* 'serialization_failure' OR regexp_count(v_done_body, '''55006''') <> 2 OR regexp_count(v_done_body, 'preempted by watchdog reclaim') <> 2 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '55006' THEN
    RAISE EXCEPTION 'TEST FAILED (M2): mark_compute_job_done with a stale token on a running row raised SQLSTATE % (message: %), expected 55006. SQLSTATE 40001 is retried without bound by PostgREST 14, so the worker''s mark call would loop instead of failing once.', v_state, v_msg;
  END IF;

  -- RED-UNDER: reword the classifier literal in mark_compute_job_done's running-row
  --            mismatch message in 20261001120000; LAYERED with the
  --            mark_compute_job_done combined self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"M2L","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=","replace":"'mark_compute_job_done: job % preempted by watchdog requeue (caller token=","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_done_body ~* 'serialization_failure' OR regexp_count(v_done_body, '''55006''') <> 2 OR regexp_count(v_done_body, 'preempted by watchdog reclaim') <> 2 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_msg IS NULL OR position('preempted by watchdog reclaim' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (M2L): the fence message of mark_compute_job_done with a stale token on a running row (%) lost the classifier literal. A worker still on the old classifier recognises the new code only by that literal, so the deploy window would misclassify a lost claim as a real failure.', v_msg;
  END IF;

  -- ===== ARM F1 / F1L — mark_compute_job_failed, token mismatch on a running row ==
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_frun, 'cfe fence probe', 'transient', tok_b);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  -- RED-UNDER: put mark_compute_job_failed's running-row mismatch raise in
  --            20261001120000 back on `serialization_failure`; LAYERED with the
  --            mark_compute_job_failed combined self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"F1","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = '55006';","replace":"'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',\n        p_job_id, p_claim_token, v_current_token\n        USING ERRCODE = 'serialization_failure';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_failed_body ~* 'serialization_failure' OR regexp_count(v_failed_body, '''55006''') <> 1 OR position('preempted by watchdog reclaim' IN v_failed_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '55006' THEN
    RAISE EXCEPTION 'TEST FAILED (F1): mark_compute_job_failed with a stale token on a running row raised SQLSTATE % (message: %), expected 55006. SQLSTATE 40001 is retried without bound by PostgREST 14, so the worker''s mark call would loop instead of failing once.', v_state, v_msg;
  END IF;

  -- RED-UNDER: reword the classifier literal in mark_compute_job_failed's fence
  --            message in 20261001120000; LAYERED with the mark_compute_job_failed
  --            combined self-verify guard stood down.
  -- RED-UNDER-M: {"arm":"F1L","apply":[{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=","replace":"'mark_compute_job_failed: job % preempted by watchdog requeue (caller token=","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261001120000_compute_job_fence_errcode_55006.sql","find":"IF v_failed_body ~* 'serialization_failure' OR regexp_count(v_failed_body, '''55006''') <> 1 OR position('preempted by watchdog reclaim' IN v_failed_body) = 0 THEN","replace":"IF FALSE THEN","occurrences":1}]}
  IF v_msg IS NULL OR position('preempted by watchdog reclaim' IN v_msg) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (F1L): the fence message of mark_compute_job_failed with a stale token on a running row (%) lost the classifier literal. A worker still on the old classifier recognises the new code only by that literal, so the deploy window would misclassify a lost claim as a real failure.', v_msg;
  END IF;
  RAISE NOTICE 'ALL 8 ARMS EXECUTED (D1, D1L, M1, M1L, M2, M2L, F1, F1L) and passed — every claim-token fence raise answers SQLSTATE 55006, never 40001, so PostgREST 14 returns it once instead of retrying it without bound: D1 defer_compute_job on a running row held by another token, M1 mark_compute_job_done late on an already-done row, M2 mark_compute_job_done on a running row held by another token, F1 mark_compute_job_failed on a running row held by another token; and each message keeps the classifier literal (D1L, M1L, M2L, F1L), which keeps the deploy window safe in both directions.';
END $$;

ROLLBACK;
