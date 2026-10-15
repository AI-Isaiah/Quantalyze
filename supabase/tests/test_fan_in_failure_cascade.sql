-- ==========================================================================
-- Phase 164.9.3.1 FANINGRAPH — `[164.9.3.1-FANIN-GRAPH-RESIDUALS]` (1): a fan-in
-- child whose parent ends `failed_final` never strands in `done_pending_children`.
--
-- WHAT IS UNDER TEST. `mark_compute_job_failed` is the RPC the worker calls when
-- a job fails. When the failure is final (a `permanent` kind, or the last retry
-- is spent) the job becomes `failed_final`. A fan-in child waits in
-- `done_pending_children` for EVERY parent to reach `done`; once one parent is
-- `failed_final` that release can never happen. On today's bodies nothing moves
-- the child: it stays `done_pending_children` forever, no claim ever picks it up,
-- the admin compute-jobs view never shows it as a failure, and its strategy
-- reads `computing` in `strategy_analytics` for good.
--
-- THE CONTRACT THIS GATE PINS (founder 2026-10-11, D-01..D-03).
--   D-01  the child becomes `failed_final` itself, with an error naming the
--         failed parent's job. A child with ANY failed parent can never be
--         released, so it fails now, whatever its other parents are doing.
--   D-02  the release is EAGER, inside `mark_compute_job_failed`, in the same
--         transaction as the parent's own flip. There is no sweep, so every arm
--         reads the child in the SAME transaction as the mark call: nothing
--         commits between the call and the read.
--   D-03  the release is TRANSITIVE: each grandchild level fails naming its OWN
--         failed parent, not the root.
--   D-06  (ACL only) the lock-order helper `public._fan_in_lock_rows(uuid[],
--         boolean)` that the fix introduces is SECURITY DEFINER, pins its
--         search_path, and is callable by neither `anon` nor `authenticated`: a
--         callable row-lock helper is a queue-wide denial-of-service lever.
--
-- ERROR TEXT (planner decision, CONTEXT "Claude's Discretion"). The cascaded
-- child's `last_error` is `fan_in_parent_failed: <parent uuid> ended
-- failed_final; this job can never be released`: 22 prefix characters plus the
-- 36-character uuid, so the full uuid is inside the 60-character slice the admin
-- compute-jobs table renders. Its `error_kind` is INHERITED from the named
-- parent (all four kinds are admitted by the compute_jobs CHECK, and
-- `computation_error_copy` turns the kind into the user sentence; `last_error` is
-- the OPERATOR surface and the status bridge must never read it). With several
-- failed parents in one level the named parent is the lowest uuid. This gate
-- pins the prefix, the uuid position and the kind. It does NOT pin the tail words.
--
-- WHY ONE `BEGIN; DO; ROLLBACK;` BLOCK PER ARM. The cascade is one transaction
-- (D-02), so a single session proves it. A block per arm lets the mutation twins
-- (added by a later plan) and the per-arm red-first runs of this phase hit one
-- arm at a time: the gate stops at its first failing block, so later arms would
-- otherwise hide behind earlier ones. Each block rolls back, so the file leaves
-- no row behind and runs on BOTH lanes: the pg-lane under sql-mutation and the
-- local Supabase stack under sql-tests, where it shares one database with the
-- rest of the corpus. No second backend, no committed seeds, and every assertion is about
-- rows the arm itself seeded (never a global count: shared TEST rule).
--
-- ARM ORDER (file order is what makes each arm's first failure its own arm):
-- FC8, FC1, FC2, FC3, FC4, FC5, FC6, FC7. FC8 needs no seed rows, so it is the
-- cheapest proof that the helper exists and comes first. Arm delimiters are the
-- two comment lines `>>> ARM FCn` before the `BEGIN;` and `<<< ARM FCn` after the
-- `ROLLBACK;` (the per-arm scratch-copy procedure of the plan reads them).
--
-- SEEDS. Per arm: a fresh auth.users row, a `profiles` row, an `api_keys` row,
-- and one `strategies` row PER JOB, because the unique index
-- `compute_jobs_one_inflight_per_kind_strategy` refuses two in-flight jobs of one
-- kind on one strategy. Parents are inserted `running` with an explicit
-- claim_token; children are inserted `done_pending_children` with
-- `parent_job_ids` naming their parents. Capture-then-assert (lint R1): the one
-- call that may raise sits in an inner BEGIN/EXCEPTION block that ONLY captures
-- SQLSTATE and SQLERRM; every `TEST FAILED (<arm>)` raise sits after that block.
-- Each `<arm>-SETUP` identity checks only prerequisites no later twin touches
-- (the mark call returned; the parent reached the status the arm intends), so a
-- twin's first failure names the behaviour and never a setup identity.
--
-- GUARD ARMS. FC3 (a `failed_retry` parent may still succeed, so its child keeps
-- waiting) and FC6 (a child that already left `done_pending_children` is not
-- touched) pass on today's bodies by design. They exist so the cascade cannot be
-- over-broad; a later plan proves them able to fail by twinning them.
--
-- MUTATION TWINS (plan 08). Each arm carries a prose RED-UNDER line and an adjacent
-- machine-executable RED-UNDER-M twin against the phase migration (scripts/mutation-runner/
-- GRAMMAR.md). Every twin is LAYERED where the migration's own self-verify would abort
-- the apply: the production edit plus the matching `IF NOT v_<name> THEN` stood down
-- to `IF FALSE AND NOT v_<name> THEN`, so the arm's own observable is what goes red.
--
-- SETUP LIST (the migration is the last entry; the list is otherwise today's tree on
-- purpose, ending with the phase migration the twins edit). Fixtures 01,
-- 02, 03 are the core, sanitize tables and compute_jobs base; 07, 11, 15, 20, 21
-- and 23 are the privilege, api_keys, role-helper and contact_requests stand-ins
-- the enqueue chain's migrations need to replay; 24 is the enqueue-chain fixture;
-- 27 adds strategy_analytics.computation_error, which FC7 reads. The compute-jobs
-- queue migration then fixtures 04 and 37 (37 must follow the queue migration:
-- it needs compute_job_kinds), then the migrations that build the latest
-- `mark_compute_job_failed`, `mark_compute_job_done` and
-- `sync_strategy_analytics_status` in filename order. The second-backend fixture (36) is not
-- listed: this gate is single-session.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","scripts/pg-lane/fixtures/40-fixture-match-decisions-bridge-outcomes.sql","supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql"]}

-- >>> ARM FC8
BEGIN;

DO $$
DECLARE
  v_oid     OID;
  v_secdef  BOOLEAN;
  v_cfg     TEXT[];
  v_anon    BOOLEAN;
  v_auth    BOOLEAN;
  v_bad     TEXT;
BEGIN
  -- ===== ARM FC8 — the lock-order helper exists, is SECURITY DEFINER with a pinned search_path, and is callable by neither anon nor authenticated =====
  -- Catalog only: this arm never calls the helper and never reads its body.
  -- Supabase's default-privilege event trigger grants EXECUTE on every new public
  -- function to anon and authenticated, so the migration has to REVOKE it; a
  -- callable row-lock helper is a denial-of-service lever on the whole queue.
  v_oid := to_regprocedure('public._fan_in_lock_rows(uuid[], boolean)');
  IF v_oid IS NOT NULL THEN
    SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_oid;
    v_anon := has_function_privilege('anon', v_oid, 'EXECUTE');
    v_auth := has_function_privilege('authenticated', v_oid, 'EXECUTE');
  END IF;

  v_bad := CASE
    WHEN v_oid IS NULL THEN 'public._fan_in_lock_rows(uuid[], boolean) does not exist'
    WHEN v_secdef IS NOT TRUE THEN 'it is not SECURITY DEFINER'
    WHEN NOT (ARRAY['search_path=public, pg_catalog'] <@ COALESCE(v_cfg, ARRAY[]::TEXT[])) THEN 'its proconfig does not pin search_path=public, pg_catalog (proconfig: ' || COALESCE(v_cfg::text, 'NULL') || ')'
    WHEN v_anon THEN 'anon holds EXECUTE on it'
    WHEN v_auth THEN 'authenticated holds EXECUTE on it'
    ELSE NULL
  END;
  -- RED-UNDER: narrow the helper's REVOKE to PUBLIC only, so the default-privilege grant to anon and authenticated survives;
  --            LAYERED with v_helper_acl_anchored stood down (the apply-time _assert_no_public_execute still passes, PUBLIC is revoked).
  -- RED-UNDER-M: {"arm":"FC8","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"REVOKE ALL ON FUNCTION public._fan_in_lock_rows(uuid[], boolean) FROM PUBLIC, anon, authenticated;","replace":"REVOKE ALL ON FUNCTION public._fan_in_lock_rows(uuid[], boolean) FROM PUBLIC;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_helper_acl_anchored THEN","replace":"IF FALSE AND NOT v_helper_acl_anchored THEN","occurrences":1}]}
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FC8): the fan-in lock-order helper is not as the fix requires: %. The helper takes row locks on compute_jobs, so a caller who can execute it can stall the whole queue; it must be SECURITY DEFINER with search_path pinned and EXECUTE revoked from anon and authenticated.', v_bad;
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC8

-- >>> ARM FC1
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p      UUID;
  s_c      UUID;
  j_p      UUID;
  j_c      UUID;
  tok_p    UUID := gen_random_uuid();
  v_state  TEXT;
  v_msg    TEXT;
  v_p_stat TEXT;
  c_stat   TEXT;
  c_kind   TEXT;
  c_err    TEXT;
BEGIN
  -- ----- SEED ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC1: one parent P (running, one attempt of three) and one waiting child C
  -- whose ONLY parent is P, each on its own strategy.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc1 parent') RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc1 child') RETURNING id INTO s_c;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok_p, 1, 3) RETURNING id INTO j_p;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_p]) RETURNING id INTO j_c;

  -- ===== ARM FC1 — a child whose only parent ends failed_final fails with it =====
  -- A permanent failure is final at once, whatever the attempt count.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p, 'fc1 parent failure', 'permanent', tok_p);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p_stat FROM compute_jobs WHERE id = j_p;
  IF v_state IS NOT NULL OR v_p_stat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (FC1-SETUP): mark_compute_job_failed on the seeded parent raised SQLSTATE % (message: %) and left it % rather than failed_final, so the parent never reached the state whose cascade this arm observes.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p_stat, 'NULL');
  END IF;

  SELECT status, error_kind, last_error INTO c_stat, c_kind, c_err FROM compute_jobs WHERE id = j_c;
  -- RED-UNDER: change mark_compute_job_failed's cascade guard `IF v_new_status = 'failed_final' THEN` to `IF FALSE THEN`;
  --            LAYERED with v_failed_cascade_anchored stood down.
  -- RED-UNDER-M: {"arm":"FC1","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF v_new_status = 'failed_final' THEN","replace":"IF FALSE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_cascade_anchored THEN","replace":"IF FALSE AND NOT v_failed_cascade_anchored THEN","occurrences":1}]}
  IF c_stat IS DISTINCT FROM 'failed_final'
     OR c_kind IS DISTINCT FROM 'permanent'
     OR left(c_err, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR position(j_p::text IN left(COALESCE(c_err, ''), 60)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FC1): after its only parent ended failed_final the child reads status % with error_kind % and last_error % (expected failed_final, permanent, and a last_error that starts with the prefix fan_in_parent_failed: and carries the parent uuid inside its first 60 characters). A child that stays done_pending_children can never be released and its strategy reads computing forever, and the admin compute-jobs view never shows it as a failure.', COALESCE(c_stat, 'NULL'), COALESCE(c_kind, 'NULL'), COALESCE(c_err, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC1

-- >>> ARM FC2
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p      UUID;
  s_c      UUID;
  j_p      UUID;
  j_c      UUID;
  tok_p    UUID := gen_random_uuid();
  v_p_stat TEXT;
  c_stat   TEXT;
  c_kind   TEXT;
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC2: the parent is on its LAST attempt (3 of 3), so a transient failure is final.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc2 parent') RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc2 child') RETURNING id INTO s_c;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok_p, 3, 3) RETURNING id INTO j_p;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_p]) RETURNING id INTO j_c;

  -- ===== ARM FC2 — retry exhaustion releases the child in the SAME transaction =====
  -- D-02: no sweep exists. The child is read right after the call, in this very
  -- transaction, so nothing but the mark call itself can have failed it.
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p, 'fc2 retries spent', 'transient', tok_p);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p_stat FROM compute_jobs WHERE id = j_p;
  IF v_state IS NOT NULL OR v_p_stat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (FC2-SETUP): mark_compute_job_failed on the parent at attempts = max_attempts raised SQLSTATE % (message: %) and left it % rather than failed_final, so the retry-exhaustion path this arm observes was never reached.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p_stat, 'NULL');
  END IF;

  SELECT status, error_kind INTO c_stat, c_kind FROM compute_jobs WHERE id = j_c;
  -- RED-UNDER: replace the cascade's inherited `fp.error_kind` with the literal 'permanent' (FC1's parent is permanent, so FC1 stays green;
  --            FC2's parent is transient); LAYERED with v_failed_text_anchored stood down.
  -- RED-UNDER-M: {"arm":"FC2","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"error_kind      = fp.error_kind,","replace":"error_kind      = 'permanent',","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_text_anchored THEN","replace":"IF FALSE AND NOT v_failed_text_anchored THEN","occurrences":1}]}
  IF c_stat IS DISTINCT FROM 'failed_final' OR c_kind IS DISTINCT FROM 'transient' THEN
    RAISE EXCEPTION 'TEST FAILED (FC2): the parent spent its last retry and ended failed_final, but in the same transaction its child reads status % with error_kind % (expected failed_final and transient, the parent''s kind). The release is eager by decision D-02 and no sweep exists to do it later, so a child left waiting here is stranded for good.', COALESCE(c_stat, 'NULL'), COALESCE(c_kind, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC2

-- >>> ARM FC3
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p      UUID;
  s_c      UUID;
  j_p      UUID;
  j_c      UUID;
  tok_p    UUID := gen_random_uuid();
  v_p_stat TEXT;
  c_stat   TEXT;
  c_err    TEXT;
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC3: the parent has attempts left (1 of 3).
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc3 parent') RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc3 child') RETURNING id INTO s_c;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok_p, 1, 3) RETURNING id INTO j_p;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_p]) RETURNING id INTO j_c;

  -- ===== ARM FC3 — GUARD: a failed_retry parent may still succeed, so its child keeps waiting =====
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p, 'fc3 transient failure', 'transient', tok_p);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p_stat FROM compute_jobs WHERE id = j_p;
  IF v_state IS NOT NULL OR v_p_stat IS DISTINCT FROM 'failed_retry' THEN
    RAISE EXCEPTION 'TEST FAILED (FC3-SETUP): mark_compute_job_failed on a parent with attempts left raised SQLSTATE % (message: %) and left it % rather than failed_retry, so this arm''s non-final precondition was never reached.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p_stat, 'NULL');
  END IF;

  SELECT status, last_error INTO c_stat, c_err FROM compute_jobs WHERE id = j_c;
  -- RED-UNDER: widen the cascade guard to `IF v_new_status IN ('failed_final', 'failed_retry') THEN` so a failed_retry parent cascades;
  --            LAYERED with v_failed_cascade_anchored stood down. This is the guard arm: it passes on the pre-fix tree, and this twin is what proves it can fail.
  -- RED-UNDER-M: {"arm":"FC3","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF v_new_status = 'failed_final' THEN","replace":"IF v_new_status IN ('failed_final', 'failed_retry') THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_cascade_anchored THEN","replace":"IF FALSE AND NOT v_failed_cascade_anchored THEN","occurrences":1}]}
  IF c_stat IS DISTINCT FROM 'done_pending_children' OR c_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FC3): the parent is failed_retry (it has attempts left and may still succeed) yet its child reads status % with last_error % (expected done_pending_children and no error). A cascade that fires on a non-final failure kills work that could still have been released.', COALESCE(c_stat, 'NULL'), COALESCE(c_err, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC3

-- >>> ARM FC4
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p1     UUID;
  s_p2     UUID;
  s_c      UUID;
  j_p1     UUID;
  j_p2     UUID;
  j_c      UUID;
  tok_1    UUID := gen_random_uuid();
  tok_2    UUID := gen_random_uuid();
  v_p1     TEXT;
  v_p2     TEXT;
  c_stat   TEXT;
  c_err    TEXT;
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC4: the child waits on TWO parents; the second stays running throughout.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc4 parent one') RETURNING id INTO s_p1;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc4 parent two') RETURNING id INTO s_p2;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc4 child') RETURNING id INTO s_c;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p1, 'derive_broker_dailies', 'running', tok_1, 1, 3) RETURNING id INTO j_p1;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p2, 'derive_broker_dailies', 'running', tok_2, 1, 3) RETURNING id INTO j_p2;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_p1, j_p2]) RETURNING id INTO j_c;

  -- ===== ARM FC4 — a child with ANY failed parent can never be released, so it fails now =====
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p1, 'fc4 parent one failure', 'permanent', tok_1);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p1 FROM compute_jobs WHERE id = j_p1;
  SELECT status INTO v_p2 FROM compute_jobs WHERE id = j_p2;
  IF v_state IS NOT NULL OR v_p1 IS DISTINCT FROM 'failed_final' OR v_p2 IS DISTINCT FROM 'running' THEN
    RAISE EXCEPTION 'TEST FAILED (FC4-SETUP): after the mark call (SQLSTATE %, message %) parent one reads % and parent two reads %, not failed_final and running, so the one-failed-one-open shape this arm observes was not reached.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p1, 'NULL'), COALESCE(v_p2, 'NULL');
  END IF;

  SELECT status, last_error INTO c_stat, c_err FROM compute_jobs WHERE id = j_c;
  -- RED-UNDER: select each level's children by `c.parent_job_ids <@ v_frontier` (every parent in the frontier) instead of `&&` (any parent);
  --            single-parent arms stay green. LAYERED with v_failed_level_anchored stood down.
  -- RED-UNDER-M: {"arm":"FC4","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"AND c.parent_job_ids && v_frontier\n","replace":"AND c.parent_job_ids <@ v_frontier\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_level_anchored THEN","replace":"IF FALSE AND NOT v_failed_level_anchored THEN","occurrences":1}]}
  IF c_stat IS DISTINCT FROM 'failed_final'
     OR left(c_err, 22) IS DISTINCT FROM 'fan_in_parent_failed: '
     OR position(j_p1::text IN left(COALESCE(c_err, ''), 60)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FC4): one of the child''s two parents ended failed_final while the other is still running, and the child reads status % with last_error % (expected failed_final naming the failed parent inside the first 60 characters). Release needs EVERY parent done, so a child with one failed parent can never run; leaving it waiting on the open parent strands it.', COALESCE(c_stat, 'NULL'), COALESCE(c_err, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC4

-- >>> ARM FC5
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p      UUID;
  s_c      UUID;
  s_g      UUID;
  j_p      UUID;
  j_c      UUID;
  j_g      UUID;
  tok_p    UUID := gen_random_uuid();
  v_p_stat TEXT;
  c_stat   TEXT;
  c_kind   TEXT;
  c_err    TEXT;
  g_stat   TEXT;
  g_kind   TEXT;
  g_err    TEXT;
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC5: P -> C -> G. C waits on P and G waits on C (G's only parent is C).
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc5 parent') RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc5 child') RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc5 grandchild') RETURNING id INTO s_g;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok_p, 1, 3) RETURNING id INTO j_p;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_p]) RETURNING id INTO j_c;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_g, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_c]) RETURNING id INTO j_g;

  -- ===== ARM FC5 — the release is transitive: each level names ITS OWN failed parent (D-03) =====
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p, 'fc5 root failure', 'permanent', tok_p);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p_stat FROM compute_jobs WHERE id = j_p;
  IF v_state IS NOT NULL OR v_p_stat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (FC5-SETUP): mark_compute_job_failed on the root raised SQLSTATE % (message: %) and left it % rather than failed_final, so the root of the chain never failed.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p_stat, 'NULL');
  END IF;

  SELECT status, error_kind, last_error INTO c_stat, c_kind, c_err FROM compute_jobs WHERE id = j_c;
  SELECT status, error_kind, last_error INTO g_stat, g_kind, g_err FROM compute_jobs WHERE id = j_g;
  -- RED-UNDER: end the cascade after its first level: the level loop's `EXIT WHEN cardinality(v_frontier) = 0;` becomes `EXIT;`.
  --            (Before the round-2 fix an outer pass loop re-ran the levels and masked this edit, so a second edit stood it down; the cascade is
  --            now one lock phase and ONE level loop, and this single edit is enough.) No anchor reads that line, so there is no stand-down;
  --            single-level arms stay green.
  -- RED-UNDER-M: {"arm":"FC5","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"EXIT WHEN cardinality(v_frontier) = 0;","replace":"EXIT;","occurrences":1}]}
  IF c_stat IS DISTINCT FROM 'failed_final'
     OR c_kind IS DISTINCT FROM 'permanent'
     OR position(j_p::text IN left(COALESCE(c_err, ''), 60)) = 0
     OR g_stat IS DISTINCT FROM 'failed_final'
     OR g_kind IS DISTINCT FROM 'permanent'
     OR position(j_c::text IN left(COALESCE(g_err, ''), 60)) = 0
     OR position(j_p::text IN left(COALESCE(g_err, ''), 60)) > 0 THEN
    RAISE EXCEPTION 'TEST FAILED (FC5): in the chain root -> child -> grandchild, the root ended failed_final and the child reads status % (last_error %) while the grandchild reads status % with error_kind % (last_error %). Expected both failed_final and permanent, the child naming the root and the grandchild naming the CHILD (its own failed parent) and not the root, all inside the first 60 characters. A grandchild left waiting on a failed child is stranded for good.', COALESCE(c_stat, 'NULL'), COALESCE(c_err, 'NULL'), COALESCE(g_stat, 'NULL'), COALESCE(g_kind, 'NULL'), COALESCE(g_err, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC5

-- >>> ARM FC6
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p      UUID;
  s_c      UUID;
  j_p      UUID;
  j_c      UUID;
  tok_p    UUID := gen_random_uuid();
  v_p_stat TEXT;
  c_stat   TEXT;
  c_err    TEXT;
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC6: the child already left done_pending_children (it is seeded pending),
  -- though its parent_job_ids still name P.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc6 parent') RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc6 child') RETURNING id INTO s_c;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok_p, 1, 3) RETURNING id INTO j_p;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'pending', 0, 3, ARRAY[j_p]) RETURNING id INTO j_c;

  -- ===== ARM FC6 — GUARD: a child that already left done_pending_children is not touched =====
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p, 'fc6 parent failure', 'permanent', tok_p);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p_stat FROM compute_jobs WHERE id = j_p;
  IF v_state IS NOT NULL OR v_p_stat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (FC6-SETUP): mark_compute_job_failed on the parent raised SQLSTATE % (message: %) and left it % rather than failed_final, so the parent never failed.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p_stat, 'NULL');
  END IF;

  SELECT status, last_error INTO c_stat, c_err FROM compute_jobs WHERE id = j_c;
  -- RED-UNDER: drop the `done_pending_children` filter from BOTH the closure read (its seed branch) and the level UPDATE (either alone is masked by the other),
  --            so an already-released child joins the cascade. This is the guard arm. No anchor reads that filter, so there is no stand-down.
  -- RED-UNDER-M: {"arm":"FC6","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"WHERE c.status = 'done_pending_children'\n               AND c.parent_job_ids && v_fail_set","replace":"WHERE c.parent_job_ids && v_fail_set","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"WHERE c.id = ANY(v_held)\n             AND c.status = 'done_pending_children'\n             AND c.parent_job_ids","replace":"WHERE c.id = ANY(v_held)\n             AND c.parent_job_ids","occurrences":1}]}
  IF c_stat IS DISTINCT FROM 'pending' OR c_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FC6): a child that was already released (pending) reads status % with last_error % after its listed parent failed (expected pending and no error). The cascade is meant for children still waiting in done_pending_children; rewriting a job that is already queued or running would corrupt work in flight.', COALESCE(c_stat, 'NULL'), COALESCE(c_err, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC6

-- >>> ARM FC7
BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  k        UUID;
  s_p      UUID;
  s_c      UUID;
  j_p      UUID;
  j_c      UUID;
  tok_p    UUID := gen_random_uuid();
  v_p_stat TEXT;
  sp_stat  TEXT;
  sc_stat  TEXT;
  sc_err   TEXT;
  v_state  TEXT;
  v_msg    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'fcc-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'fcc', 'fcc-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'fcc mt5', 'x', TRUE) RETURNING id INTO k;

  -- FC7: parent and child sit on DIFFERENT strategies, and each strategy has its
  -- own strategy_analytics row, so the parent's bridge call cannot be what
  -- writes the child's strategy.
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc7 parent') RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'fcc fc7 child') RETURNING id INTO s_c;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s_p, 'computing', FALSE), (s_c, 'computing', FALSE);
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok_p, 1, 3) RETURNING id INTO j_p;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, parent_job_ids)
  VALUES (s_c, 'derive_broker_dailies', 'done_pending_children', 0, 3, ARRAY[j_p]) RETURNING id INTO j_c;

  -- ===== ARM FC7 — the child's strategy reads failed, not computing forever (user-facing) =====
  v_state := NULL; v_msg := NULL;
  BEGIN
    PERFORM mark_compute_job_failed(j_p, 'fc7 parent failure', 'permanent', tok_p);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;

  SELECT status INTO v_p_stat FROM compute_jobs WHERE id = j_p;
  SELECT computation_status INTO sp_stat FROM strategy_analytics WHERE strategy_id = s_p;
  IF v_state IS NOT NULL OR v_p_stat IS DISTINCT FROM 'failed_final' OR sp_stat IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (FC7-SETUP): after the mark call (SQLSTATE %, message %) the parent job reads % and its own strategy reads %, not failed_final and failed, so the parent-side bridge this arm builds on did not run.', COALESCE(v_state, 'none'), COALESCE(v_msg, 'none'), COALESCE(v_p_stat, 'NULL'), COALESCE(sp_stat, 'NULL');
  END IF;

  SELECT computation_status, computation_error INTO sc_stat, sc_err FROM strategy_analytics WHERE strategy_id = s_c;
  -- RED-UNDER: remove the cascade's `UNION ALL ... unnest(v_casc_strats, v_casc_jobs)` branch from the bridge loop, so only the job's own strategy is bridged;
  --            LAYERED with v_failed_bridge_anchored stood down.
  -- RED-UNDER-M: {"arm":"FC7","apply":[{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"\n                    UNION ALL\n                    SELECT t.strategy_id, t.job_id, 1\n                      FROM unnest(v_casc_strats, v_casc_jobs) AS t(strategy_id, job_id)","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql","find":"IF NOT v_failed_bridge_anchored THEN","replace":"IF FALSE AND NOT v_failed_bridge_anchored THEN","occurrences":1}]}
  IF sc_stat IS DISTINCT FROM 'failed' OR sc_err IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (FC7): the child sits on a different strategy from the failed parent, and that strategy reads computation_status % with computation_error % (expected failed and a non-NULL curated sentence). A stranded fan-in child makes the status bridge count the strategy as still computing, so the user sees a spinner that never resolves; failing the child is not enough, its strategy has to be bridged too.', COALESCE(sc_stat, 'NULL'), COALESCE(sc_err, 'NULL');
  END IF;
END $$;

ROLLBACK;
-- <<< ARM FC7

DO $$ BEGIN RAISE NOTICE 'ALL 8 ARMS EXECUTED (FC8, FC1, FC2, FC3, FC4, FC5, FC6, FC7) and passed — FC8 the lock-order helper exists, is SECURITY DEFINER with a pinned search_path and is callable by neither anon nor authenticated; FC1 a child whose only parent ends failed_final fails with it, naming the parent and inheriting its kind; FC2 retry exhaustion releases the child in the same transaction; FC3 a failed_retry parent leaves its child waiting; FC4 one failed parent fails a child that still has an open parent; FC5 the release is transitive and each level names its own failed parent; FC6 a child that already left done_pending_children is untouched; FC7 the child strategy reads failed with a curated sentence, not computing forever.'; END $$;
