-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 02 (HEAL-04): a watchdog reset re-derives the strategy's
-- analytics status through the bridge, so the next attempt's curated sentence survives.
-- Guards migration 20261124120100_jobledger_reset_ledger_and_bridge.sql.
--
-- WHAT IS UNDER TEST. reset_stalled_compute_jobs (the live watchdog) and
-- reclaim_stuck_compute_jobs flip a `running` row back to `pending`. Until this migration
-- neither called the status bridge. The stalled attempt may already have stamped its curated
-- sentence S1 and the markers ('writer', J) on strategy_analytics. After a reset the row
-- still read 'failed' with S1 and both markers, so when attempt 2 of the SAME job J wrote a
-- DIFFERENT curated sentence S2 restating ('writer', J), the BEFORE UPDATE trigger
-- strategy_analytics_drop_stale_error_provenance saw the sentence change under unchanged
-- markers and NULLed them. S2 lost its provenance and the next bridge run replaced it with
-- the per-kind generic (TODOS [164.2-RECLAIM-PROVENANCE], ROADMAP SC-4, HEAL-04).
--
-- ARMS, in the order they EXECUTE. The order is LOAD-BEARING: a mutation twin must make ITS
-- OWN arm the first failure, so an arm may only depend on arms listed before it, and no twin
-- may redden an earlier arm.
--   B1   (ROADMAP SC-4, tracer) a job running 30 minutes with S1 and the markers stamped is
--        reset. The job is pending, the strategy reads 'computing' with the sentence and both
--        markers NULL; then attempt 2 re-stamps a DIFFERENT sentence S2 under the SAME job id
--        and S2, 'writer' and J read back unchanged.
--   B2   (negative control) a strategy whose only reset job is a position poll (a side kind)
--        keeps its 'complete' status: the bridge's own side-kind early return decides, and
--        the reset spells no kind list of its own.
--   B3   a strategy with one reset trade-sync job and one reset position-poll job reads
--        'computing' (one bridge call per distinct strategy AND kind; the side-kind job has
--        the lowest id on purpose).
--   B4   reclaim_stuck_compute_jobs on the B1 shape gives the same SC-4 result.
--   B5   two strategies reset in one call both read 'computing'.
--   B5b  a reset key-mode job (NULL strategy_id) makes no bridge call and does not raise.
--
-- ONE `BEGIN; DO; ROLLBACK;` BLOCK PER ARM. Each block rolls back, so the file leaves no row
-- behind and runs on BOTH lanes: the pg-lane under sql-mutation and the local Supabase stack
-- under sql-tests. Every assertion is about rows the arm itself seeded (never a global count:
-- on shared TEST others' rows exist). Capture-then-assert (lint R1): the one call that may
-- raise sits in an inner BEGIN/EXCEPTION block that ONLY captures SQLSTATE and SQLERRM; every
-- `TEST FAILED (<arm>)` raise sits after that block, DIRECTLY in the DO body
-- (scripts/mutation-runner/GRAMMAR.md, rule 3c). Each `<arm>-SETUP` identity checks only a
-- prerequisite no twin touches.
--
-- SEEDS. Per arm: a fresh auth.users row, a profiles row, an api_keys row and a strategies
-- row per job (the unique index compute_jobs_one_inflight_per_kind_strategy refuses two
-- in-flight jobs of one kind on one strategy). Seed rows only; this gate never CREATEs a
-- table a migration or fixture owns (sql-gate-lint R5-R7).
--
-- SETUP LIST. test_compute_job_attempt_failures.sql's list (the latest mark_compute_job_failed
-- and mark_compute_job_done, the ledger, and the claim pair the plan 01 self-verify needs;
-- 20260515114555 is EXCLUDED there for the 3-argument claim overload clash it would add), plus
-- the two bridge migrations the latest bridge needs (20261023120000, 20261105120000), ending
-- with the migration the twins edit. PLAN DEVIATION recorded, not hidden: the plan also named
-- 20260516104201 (the previous bodies of the two re-based functions) and "the curated-sentence
-- gate's list". Neither works here. Plan 01's STEP 5 refuses without the 5-argument claim pair,
-- so the plan 01 list is the base; and 20260516104201 aborts on its own verify block ("missing
-- NOT EXISTS set-based fan-in") on any list that omits 20260515114555, which this one must.
-- The migration under test therefore CREATEs both functions itself (CREATE OR REPLACE) and
-- restates their ACL with a REVOKE, so the lane has the same shape PROD has.
--
-- LANE SUBSTITUTION (recorded, not hidden). Docker is not available on the machine this was
-- written on, so the proof here is the pg-lane (scripts/mutation-runner/run.mjs --file). The
-- local-stack lane proof belongs to plan 10.
-- ==========================================================================

-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","scripts/pg-lane/fixtures/44-fixture-compute-jobs-reclaim-count.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","supabase/migrations/20261105120000_sync_status_protect_refused_derive.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","supabase/migrations/20261124120000_jobledger_attempt_failures.sql","supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql"]}

-- >>> ARM B1
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  k         UUID;
  s         UUID;
  j         UUID;
  tok       UUID := gen_random_uuid();
  s1        TEXT := 'B1 sentence one: the account login was refused, reconnect the key.';
  s2        TEXT := 'B1 sentence two: the broker gateway was unreachable, nothing is wrong with your key.';
  v_state   TEXT;
  v_msg     TEXT;
  n_reset   INTEGER;
  v_jstat   TEXT;
  v_jtok    UUID;
  v_status  TEXT;
  v_err     TEXT;
  v_src     TEXT;
  v_jid     UUID;
  v_err2    TEXT;
  v_src2    TEXT;
  v_jid2    UUID;
  v_ok      BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'rs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'rs', 'rs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'rs b1', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'rs b1') RETURNING id INTO s;

  -- Attempt 1 stalled: running for 30 minutes under its token.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s, 'sync_trades', 'running', 1, 3, tok, 'b1-worker', now() - interval '30 minutes')
  RETURNING id INTO j;
  -- ... and had already stamped its curated sentence and both markers, as the writer does.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computation_error_source, computation_error_job_id)
  VALUES (s, 'failed', s1, 'writer', j);

  v_state := NULL; v_msg := NULL;
  BEGIN
    n_reset := reset_stalled_compute_jobs(interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B1-SETUP): reset_stalled_compute_jobs raised SQLSTATE % (message: %) on a job running for 30 minutes, so no reset happened for this arm to observe.', v_state, v_msg;
  END IF;

  SELECT cj.status, cj.claim_token INTO v_jstat, v_jtok FROM compute_jobs cj WHERE cj.id = j;
  SELECT sa.computation_status, sa.computation_error, sa.computation_error_source, sa.computation_error_job_id
    INTO v_status, v_err, v_src, v_jid
    FROM strategy_analytics sa WHERE sa.strategy_id = s;

  -- Attempt 2 of the SAME job writes a DIFFERENT curated sentence restating ('writer', J).
  UPDATE strategy_analytics
     SET computation_error        = s2,
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;
  SELECT sa.computation_error, sa.computation_error_source, sa.computation_error_job_id
    INTO v_err2, v_src2, v_jid2
    FROM strategy_analytics sa WHERE sa.strategy_id = s;

  -- ===== ARM B1 — a reset strategy keeps the next attempt's curated sentence =====
  v_ok := COALESCE(
        v_jstat = 'pending' AND v_jtok IS NULL
    AND v_status = 'computing'
    AND v_err IS NULL AND v_src IS NULL AND v_jid IS NULL
    AND v_err2 = s2 AND v_src2 = 'writer' AND v_jid2 = j, FALSE);
  -- RED-UNDER: remove the bridge call from reset_stalled_compute_jobs (the PERFORM becomes a no-op), so the stale 'failed' row, S1 and both markers stay, attempt 2's re-stamp changes the sentence under unchanged markers and the provenance trigger NULLs them.
  -- RED-UNDER-M: {"arm":"B1","apply":[{"kind":"edit","file":"supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql","find":"    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","replace":"    NULL;\n  END LOOP;\n\n  RETURN v_reset;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (B1): after the watchdog reset a job whose attempt had stamped a curated sentence and the markers (writer, job), the job reads status % with claim token % (expected pending, NULL), the strategy reads status %, sentence %, source %, job id % (expected computing and all three NULL), and after attempt 2 re-stamped a different sentence under the same job id the row reads sentence %, source %, job id % (expected the new sentence, writer, and the job id). The curated sentence the writer produced was replaced by the generic one: a user sees a wrong reason for a failure and an old status.', COALESCE(v_jstat, 'NULL'), COALESCE(v_jtok::text, 'NULL'), COALESCE(v_status, 'NULL'), COALESCE(v_err, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_jid::text, 'NULL'), COALESCE(v_err2, 'NULL'), COALESCE(v_src2, 'NULL'), COALESCE(v_jid2::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM B1

-- >>> ARM B2
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  k         UUID;
  s         UUID;
  j         UUID;
  tok       UUID := gen_random_uuid();
  v_state   TEXT;
  v_msg     TEXT;
  v_jstat   TEXT;
  v_status  TEXT;
  v_ok      BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'rs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'rs', 'rs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'rs b2', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'rs b2') RETURNING id INTO s;

  -- A published strategy whose ONLY stalled job is a side kind (the position poller).
  INSERT INTO strategy_analytics (strategy_id, computation_status) VALUES (s, 'complete');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s, 'poll_positions', 'running', 1, 3, tok, 'b2-worker', now() - interval '30 minutes')
  RETURNING id INTO j;

  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM reset_stalled_compute_jobs(interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B2-SETUP): reset_stalled_compute_jobs raised SQLSTATE % (message: %) on a position-poll job running for 30 minutes, so no reset happened for this arm to observe.', v_state, v_msg;
  END IF;

  SELECT cj.status INTO v_jstat FROM compute_jobs cj WHERE cj.id = j;
  SELECT sa.computation_status INTO v_status FROM strategy_analytics sa WHERE sa.strategy_id = s;

  -- ===== ARM B2 — (negative control, DEC-02-B) a reset side-kind job does not move the status =====
  v_ok := COALESCE(v_jstat = 'pending' AND v_status = 'complete', FALSE);
  -- RED-UNDER: hand the bridge no trigger job id in the reset's loop, so it cannot see that the only reset job is a side kind and bounces a published strategy to 'computing'.
  -- RED-UNDER-M: {"arm":"B2","apply":[{"kind":"edit","file":"supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql","find":"    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","replace":"    PERFORM sync_strategy_analytics_status(r_b.strategy_id, NULL);\n  END LOOP;\n\n  RETURN v_reset;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (B2): after the watchdog reset a stalled position-poll job (a side kind) on a published strategy, the job reads % (expected pending) and the strategy reads status % (expected complete). A background position poll that stalls must not flip a published strategy back to computing: users would see a healthy strategy spin every time the poller hiccups.', COALESCE(v_jstat, 'NULL'), COALESCE(v_status, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM B2

-- >>> ARM B3
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  k         UUID;
  s         UUID;
  j_side    UUID;
  j_main    UUID;
  v_state   TEXT;
  v_msg     TEXT;
  v_side_st TEXT;
  v_main_st TEXT;
  v_status  TEXT;
  v_ok      BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'rs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'rs', 'rs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'rs b3', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'rs b3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status) VALUES (s, 'complete');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s, 'poll_positions', 'running', 1, 3, gen_random_uuid(), 'b3-worker', now() - interval '30 minutes')
  RETURNING id INTO j_side;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s, 'sync_trades', 'running', 1, 3, gen_random_uuid(), 'b3-worker', now() - interval '30 minutes')
  RETURNING id INTO j_main;

  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM reset_stalled_compute_jobs(interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B3-SETUP): reset_stalled_compute_jobs raised SQLSTATE % (message: %) on two stalled jobs of one strategy, so no reset happened for this arm to observe.', v_state, v_msg;
  END IF;

  SELECT cj.status INTO v_side_st FROM compute_jobs cj WHERE cj.id = j_side;
  SELECT cj.status INTO v_main_st FROM compute_jobs cj WHERE cj.id = j_main;
  SELECT sa.computation_status INTO v_status FROM strategy_analytics sa WHERE sa.strategy_id = s;

  -- ===== ARM B3 — (DEC-02-B) a side-kind reset beside a main-kind reset still bounces the status =====
  v_ok := COALESCE(v_side_st = 'pending' AND v_main_st = 'pending' AND v_status = 'computing', FALSE);
  -- RED-UNDER: skip the bridge for every strategy that has a reset position-poll job (a strategy-level instead of a per-kind decision about side kinds), so the trade-sync reset on the same strategy never re-derives it.
  -- RED-UNDER-M: {"arm":"B3","apply":[{"kind":"edit","file":"supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql","find":"       AND cj.strategy_id IS NOT NULL\n     GROUP BY cj.strategy_id, cj.kind\n     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));\n    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","replace":"       AND cj.strategy_id IS NOT NULL\n       AND NOT EXISTS (SELECT 1 FROM compute_jobs sj WHERE sj.strategy_id = cj.strategy_id AND sj.id = ANY (v_ids) AND sj.kind = 'poll_positions')\n     GROUP BY cj.strategy_id, cj.kind\n     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));\n    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (B3): after the watchdog reset a stalled position-poll job AND a stalled trade-sync job of one published strategy, the jobs read % and % (expected pending and pending) and the strategy reads status % (expected computing). The trade sync restarts, so the strategy is computing again; a bridge call keyed only to the side-kind job returns early and leaves a stale complete status over a job that is about to rewrite the figures.', COALESCE(v_side_st, 'NULL'), COALESCE(v_main_st, 'NULL'), COALESCE(v_status, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM B3

-- >>> ARM B4
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  k         UUID;
  s         UUID;
  j         UUID;
  tok       UUID := gen_random_uuid();
  s1        TEXT := 'B4 sentence one: the account login was refused, reconnect the key.';
  s2        TEXT := 'B4 sentence two: the broker gateway was unreachable, nothing is wrong with your key.';
  v_state   TEXT;
  v_msg     TEXT;
  v_jstat   TEXT;
  v_status  TEXT;
  v_err     TEXT;
  v_src     TEXT;
  v_jid     UUID;
  v_err2    TEXT;
  v_src2    TEXT;
  v_jid2    UUID;
  v_ok      BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'rs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'rs', 'rs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'rs b4', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'rs b4') RETURNING id INTO s;

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s, 'sync_trades', 'running', 1, 3, tok, 'b4-worker', now() - interval '30 minutes')
  RETURNING id INTO j;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computation_error_source, computation_error_job_id)
  VALUES (s, 'failed', s1, 'writer', j);

  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM reclaim_stuck_compute_jobs(interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B4-SETUP): reclaim_stuck_compute_jobs raised SQLSTATE % (message: %) on a job running for 30 minutes, so no reclaim happened for this arm to observe.', v_state, v_msg;
  END IF;

  SELECT cj.status INTO v_jstat FROM compute_jobs cj WHERE cj.id = j;
  SELECT sa.computation_status, sa.computation_error, sa.computation_error_source, sa.computation_error_job_id
    INTO v_status, v_err, v_src, v_jid
    FROM strategy_analytics sa WHERE sa.strategy_id = s;

  UPDATE strategy_analytics
     SET computation_error        = s2,
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;
  SELECT sa.computation_error, sa.computation_error_source, sa.computation_error_job_id
    INTO v_err2, v_src2, v_jid2
    FROM strategy_analytics sa WHERE sa.strategy_id = s;

  -- ===== ARM B4 — reclaim gives the same SC-4 result as reset: the next curated sentence survives =====
  v_ok := COALESCE(
        v_jstat = 'pending'
    AND v_status = 'computing'
    AND v_err IS NULL AND v_src IS NULL AND v_jid IS NULL
    AND v_err2 = s2 AND v_src2 = 'writer' AND v_jid2 = j, FALSE);
  -- RED-UNDER: remove the bridge call from reclaim_stuck_compute_jobs (the PERFORM becomes a no-op), so the stale 'failed' row, S1 and both markers stay and attempt 2's re-stamp loses its markers.
  -- RED-UNDER-M: {"arm":"B4","apply":[{"kind":"edit","file":"supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql","find":"    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reclaimed;","replace":"    NULL;\n  END LOOP;\n\n  RETURN v_reclaimed;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (B4): after reclaim_stuck_compute_jobs took a job whose attempt had stamped a curated sentence and the markers (writer, job), the job reads % (expected pending), the strategy reads status %, sentence %, source %, job id % (expected computing and all three NULL), and after attempt 2 re-stamped a different sentence under the same job id the row reads sentence %, source %, job id % (expected the new sentence, writer, and the job id). The second watchdog path would silently lose the curated sentence the way the first one did.', COALESCE(v_jstat, 'NULL'), COALESCE(v_status, 'NULL'), COALESCE(v_err, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_jid::text, 'NULL'), COALESCE(v_err2, 'NULL'), COALESCE(v_src2, 'NULL'), COALESCE(v_jid2::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM B4

-- >>> ARM B5
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  k         UUID;
  s_a       UUID;
  s_b       UUID;
  j_a       UUID;
  j_b       UUID;
  v_state   TEXT;
  v_msg     TEXT;
  v_st_a    TEXT;
  v_st_b    TEXT;
  v_ok      BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'rs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'rs', 'rs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'rs b5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'rs b5 a') RETURNING id INTO s_a;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'rs b5 b') RETURNING id INTO s_b;

  INSERT INTO strategy_analytics (strategy_id, computation_status) VALUES (s_a, 'complete');
  INSERT INTO strategy_analytics (strategy_id, computation_status) VALUES (s_b, 'complete');
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s_a, 'sync_trades', 'running', 1, 3, gen_random_uuid(), 'b5-worker', now() - interval '30 minutes')
  RETURNING id INTO j_a;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (s_b, 'sync_trades', 'running', 1, 3, gen_random_uuid(), 'b5-worker', now() - interval '30 minutes')
  RETURNING id INTO j_b;

  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM reset_stalled_compute_jobs(interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (B5-SETUP): reset_stalled_compute_jobs raised SQLSTATE % (message: %) on stalled jobs of two strategies, so no reset happened for this arm to observe.', v_state, v_msg;
  END IF;

  SELECT sa.computation_status INTO v_st_a FROM strategy_analytics sa WHERE sa.strategy_id = s_a;
  SELECT sa.computation_status INTO v_st_b FROM strategy_analytics sa WHERE sa.strategy_id = s_b;

  -- ===== ARM B5 — two strategies reset in one call are both re-derived =====
  v_ok := COALESCE(v_st_a = 'computing' AND v_st_b = 'computing', FALSE);
  -- RED-UNDER: bound the reset's bridge loop to its first (strategy, kind) group (LIMIT 1), so only one of the two strategies is re-derived.
  -- RED-UNDER-M: {"arm":"B5","apply":[{"kind":"edit","file":"supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql","find":"     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));\n    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","replace":"     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind\n     LIMIT 1\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));\n    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (B5): after one watchdog reset call took stalled jobs of two published strategies, the strategies read status % and % (expected computing for both). A reset that re-derives only the first strategy it meets leaves the others showing a stale status over jobs that will rewrite their figures.', COALESCE(v_st_a, 'NULL'), COALESCE(v_st_b, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM B5

-- >>> ARM B5b
BEGIN;

DO $$
DECLARE
  uid       UUID := gen_random_uuid();
  k         UUID;
  j_key     UUID;
  v_state   TEXT;
  v_msg     TEXT;
  v_jstat   TEXT;
  v_ok      BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000', 'rs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'rs', 'rs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'rs b5b', 'x', TRUE) RETURNING id INTO k;

  -- A key-mode job: keyed by api_key_id, NULL strategy_id (MT5 derive nights).
  INSERT INTO compute_jobs (api_key_id, kind, status, attempts, max_attempts, claim_token, claimed_by, claimed_at)
  VALUES (k, 'derive_broker_dailies', 'running', 1, 3, gen_random_uuid(), 'b5b-worker', now() - interval '30 minutes')
  RETURNING id INTO j_key;

  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM reset_stalled_compute_jobs(interval '10 minutes');
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  SELECT cj.status INTO v_jstat FROM compute_jobs cj WHERE cj.id = j_key;

  -- ===== ARM B5b — a reset key-mode job (NULL strategy_id) makes no bridge call and does not raise =====
  v_ok := COALESCE(v_state IS NULL AND v_jstat = 'pending', FALSE);
  -- RED-UNDER: drop the `strategy_id IS NOT NULL` filter from the reset's bridge loop, so a key-mode row reaches the bridge with a NULL strategy id and the bridge raises.
  -- RED-UNDER-M: {"arm":"B5b","apply":[{"kind":"edit","file":"supabase/migrations/20261124120100_jobledger_reset_ledger_and_bridge.sql","find":"       AND cj.strategy_id IS NOT NULL\n     GROUP BY cj.strategy_id, cj.kind\n     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));\n    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","replace":"     GROUP BY cj.strategy_id, cj.kind\n     ORDER BY hashtext(cj.strategy_id::text), cj.strategy_id, cj.kind\n  LOOP\n    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(r_b.strategy_id::text));\n    PERFORM sync_strategy_analytics_status(r_b.strategy_id, r_b.job_id);\n  END LOOP;\n\n  RETURN v_reset;","occurrences":1}]}
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAILED (B5b): resetting a stalled job keyed by api_key_id (NULL strategy_id) raised SQLSTATE % (message: %) and left the job % (expected no error and pending). A key-mode derive job that stalls would abort the whole watchdog tick and every other stalled job in it would stay stuck.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_jstat, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM B5b

DO $$ BEGIN RAISE NOTICE 'ALL 6 ARMS EXECUTED (B1, B2, B3, B4, B5, B5b) and passed - B1 a watchdog reset re-derives the strategy status through the bridge so the next attempt''s curated sentence survives; B2 a reset side-kind job does not move a published status; B3 a side kind beside a main kind still bounces it; B4 reclaim does the same as reset; B5 two strategies are both re-derived; B5b a key-mode job makes no bridge call.'; END $$;
