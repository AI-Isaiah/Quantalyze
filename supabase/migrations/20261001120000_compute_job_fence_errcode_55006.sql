-- ==========================================================================
-- Phase 164.9.3.2 (DEFER40001), `[164.9.4-DEFER-40001-RETRY-HANG]`: the four
-- claim-token fence raises in the compute-job RPCs answer SQLSTATE 55006
-- (object_in_use) instead of SQLSTATE 40001 (serialization_failure).
--
-- WHAT IT CLOSES. PostgREST 14.x runs every RPC inside hasql-transaction's
-- retrying transaction, and that transaction re-runs the call WITHOUT BOUND
-- when the server answers SQLSTATE 40001 (or 40P01). Upstream fixed this in
-- PostgREST 16.0 (#3673); no 14.x release carries the fix. A claim-token
-- mismatch never changes on retry, so each of these raises busy-loops through
-- PostgREST instead of failing once (164.9.4 measured ~27k re-runs in ~9 s on
-- v14.5; plan 164.9.3.2-01 measured all four sites hanging through v14.7, the
-- loop outliving the client disconnect). The four sites:
--   1. defer_compute_job: token mismatch on a still-running row;
--   2. mark_compute_job_done: late mark on an already-done row;
--   3. mark_compute_job_done: token mismatch on a still-running row;
--   4. mark_compute_job_failed: token mismatch on a still-running row.
-- Each now raises USING ERRCODE '55006', which PostgREST answers once.
--
-- WHAT IS UNCHANGED. Every message text is byte-identical, so the classifier
-- literal ("preempted by watchdog reclaim") survives at every site. That is
-- what makes the deploy window safe in BOTH directions: a worker still on the
-- old classifier recognises a 55006 by the literal, and a new worker meeting an
-- old body sees exactly the old behaviour. No predicate, lock, fan-in, backoff,
-- error_kind write, no_data_found raise or invalid_parameter_value raise moves.
--
-- WHAT IT DOES NOT CLOSE. The enqueue race-loss raise in
-- `_enqueue_compute_job_internal` (also SQLSTATE 40001) is not touched here;
-- its routing is the founder's ENQ-SCOPE decision, recorded by plan
-- 164.9.3.2-01.
--
-- THE RULE (RESEARCH Pitfall 8): never raise 40001 or 40P01 from a
-- PostgREST-callable function on PostgREST < 16. hasql-transaction retries both
-- without bound. A condition that cannot change on retry must use a code
-- PostgREST returns once.
--
-- WHY 55006. Repo precedent: 20260925120000_api_keys_account_identity.sql
-- translates an enqueue serialization_failure into 55006 so no raw 40001
-- reaches the client. 55006 is not retried by PostgREST and is unique among
-- these RPCs' raise sites. Rejected: P0001 (not distinct from any plain RAISE),
-- PT409 (PostgREST-only), 55P03 (a real lock_timeout signal other gates read as
-- flake), a custom class (no precedent).
--
-- RE-BASE. Each CREATE OR REPLACE below is the LATEST definition, byte-for-byte,
-- re-grepped across every file in supabase/migrations/ on this tree, origin/main
-- and both in-flight sibling branches (no later definition, no ALTER FUNCTION):
--   defer_compute_job(uuid, integer, text, uuid)  from 20260529170000
--   mark_compute_job_done(uuid, uuid)             from 20260926120000
--   mark_compute_job_failed(uuid, text, text, uuid) from 20260926120000
-- The only body changes are the four errcode tokens, plus ONE comment line in
-- defer_compute_job that named the old errcode. 20260529170000's DROP of the
-- 3-arg defer overload is NOT carried: that overload is already gone. Each
-- REVOKE is restated exactly as its source issued it.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD bodies these CREATE OR REPLACEs overwrite
-- ══════════════════════════════════════════════════════════════════════════
--
-- Transaction style: NO explicit BEGIN/COMMIT — Supabase wraps each migration
-- in an implicit transaction. SET LOCAL lock_timeout applies to that wrap. This
-- migration writes ZERO table data and validates no existing rows; its DO block
-- reads catalogs and runs random-uuid behavioural probes only
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Every RAISE format string below is
-- a SINGLE literal (Phase 85 invariant #21 — no '||' concatenation inside a
-- RAISE format slot).
--
-- Execution proof is NOT this file's DO block (a copy-and-token check). It is
-- the gate supabase/tests/test_compute_job_fence_errcode.sql, which drives each
-- fence on a seeded row and reads the SQLSTATE it raises.
-- ==========================================================================

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- defer_compute_job
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION defer_compute_job(
  p_job_id        UUID,
  p_defer_seconds INTEGER,
  p_reason        TEXT DEFAULT NULL,
  p_claim_token   UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_current_attempts INTEGER;
  v_next_attempt     TIMESTAMPTZ;
  v_current_status   TEXT;
  v_current_token    UUID;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'defer_compute_job: p_job_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_defer_seconds IS NULL OR p_defer_seconds < 0 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds must be >= 0, got %', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cap defer at 1 hour to prevent a misconfigured caller from parking a
  -- job for days and silently breaking downstream widgets that expect
  -- recent data. The longest legitimate cooldown today is Bybit at
  -- 10 minutes.
  IF p_defer_seconds > 3600 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds % exceeds cap of 3600 (1 hour)', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- NEW-C12-06 claim-token fence (mirrors mark_compute_job_done, mig 117).
  -- Lock and read the running row, requiring the token to match when one is
  -- supplied. Deferring a non-running job doesn't make sense and would
  -- silently corrupt state if we let it through.
  SELECT attempts
    INTO v_current_attempts
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Distinguish a token mismatch on a still-running row (W1 lost the race
    -- to W2's watchdog re-claim) from a genuine not-found / not-running,
    -- mirroring mark_compute_job_done's P97 preempted branch (SQLSTATE 55006).
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF FOUND
       AND v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'defer_compute_job: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    RAISE EXCEPTION 'defer_compute_job: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_next_attempt := now() + (p_defer_seconds * interval '1 second');

  -- GREATEST(0, ...) defense: if attempts somehow landed at 0 before this
  -- call (shouldn't happen under the normal claim path but migrations
  -- or manual INSERTs could), don't let us go negative.
  UPDATE compute_jobs
     SET status          = 'pending',
         attempts        = GREATEST(0, v_current_attempts - 1),
         next_attempt_at = v_next_attempt,
         claimed_at      = NULL,
         claimed_by      = NULL,
         claim_token     = NULL,  -- NEW-C12-06: drop the stale fence token
         last_error      = p_reason
   WHERE id = p_job_id;

  RETURN v_next_attempt;
END;
$$;

REVOKE ALL ON FUNCTION defer_compute_job(UUID, INTEGER, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Self-verify: catalog reads and random-uuid probes only. Every body check runs
-- on the COMMENT-STRIPPED `pg_get_functiondef`, so prose can neither satisfy a
-- positive anchor nor trip a negative one.
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_defer_oid           oid := to_regprocedure('public.defer_compute_job(uuid, integer, text, uuid)');
  v_defer_fn            text;
  v_defer_body          text;
  v_defer_cfg           text[];
  v_defer_secdef        boolean;
  v_defer_raised_cap    boolean := false;
  v_defer_raised_nf     boolean := false;
  v_defer_dummy_job     uuid := gen_random_uuid();
  c_defer_sig           CONSTANT text := 'public.defer_compute_job(uuid, integer, text, uuid)';
  c_search_path         CONSTANT text := 'search_path=public, pg_catalog';
BEGIN
  -- Role-existence guard first: every ACL arm below depends on it.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arms cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;

  -- ===== defer_compute_job =====
  IF v_defer_oid IS NULL THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: public.defer_compute_job(uuid, integer, text, uuid) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_defer_fn := pg_get_functiondef(v_defer_oid);
  -- Strip BOTH plpgsql comment syntaxes, block first (T-163-16).
  v_defer_body := regexp_replace(regexp_replace(v_defer_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_defer_body IS NULL THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: the comment-stripped defer_compute_job body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (D) ONE combined guard: no old errcode name, exactly one 55006, and the
  -- classifier literal present. Kept on ONE line so a mutation twin can stand
  -- it down whole.
  IF v_defer_body ~* 'serialization_failure' OR regexp_count(v_defer_body, '''55006''') <> 1 OR position('preempted by watchdog reclaim' IN v_defer_body) = 0 THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: defer_compute_job still names serialization_failure, or does not raise 55006 exactly once, or lost the classifier literal. SQLSTATE 40001 is retried without bound by PostgREST 14, so the fence would loop instead of failing once.';
  END IF;

  -- SECURITY DEFINER, and the search_path pin is the VALUE, not the word.
  SELECT p.prosecdef, p.proconfig INTO v_defer_secdef, v_defer_cfg
    FROM pg_proc p WHERE p.oid = v_defer_oid;
  IF v_defer_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: defer_compute_job is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_defer_cfg IS NULL OR NOT (c_search_path = ANY(v_defer_cfg)) THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: defer_compute_job does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_defer_cfg;
  END IF;

  -- ACL: the REVOKE above re-converged. The PUBLIC probe runs first so a
  -- PUBLIC leak is named as a PUBLIC leak.
  PERFORM public._assert_no_public_execute(c_defer_sig);
  IF has_function_privilege('anon', v_defer_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_defer_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: anon or authenticated holds EXECUTE on the SECURITY DEFINER defer_compute_job — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;

  -- Carried forward from 20260529170000 (probes A and B): RANDOM uuids only,
  -- nothing seeded, no row content read.
  BEGIN
    PERFORM defer_compute_job(v_defer_dummy_job, 99999, 'probe', gen_random_uuid());
  EXCEPTION
    WHEN invalid_parameter_value THEN
      v_defer_raised_cap := true;
  END;
  IF NOT v_defer_raised_cap THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: defer_compute_job(...,99999,...) did not raise invalid_parameter_value (the defer cap validation regressed)';
  END IF;

  BEGIN
    PERFORM defer_compute_job(v_defer_dummy_job, 60, 'probe', gen_random_uuid());
  EXCEPTION
    WHEN no_data_found THEN
      v_defer_raised_nf := true;
  END;
  IF NOT v_defer_raised_nf THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: defer_compute_job on a missing job did not raise no_data_found';
  END IF;

  RAISE NOTICE 'compute-job-fence-errcode: defer_compute_job raises 55006 (not 40001) exactly once with the classifier literal intact; carried-forward probes, SECURITY DEFINER, the exact search_path pin and the ACL all intact.';
END
$verify$;
