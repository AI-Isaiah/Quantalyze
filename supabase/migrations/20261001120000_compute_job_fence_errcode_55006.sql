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
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On a function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma means "I read PROD's body and intend to
-- overwrite it". This migration changes THREE functions, so it carries THREE
-- pragmas, one per function; VAC-04 greps the changed files once per drifting
-- function, each matched by its own hash.
--
-- MEASURED 2026-10-01 UTC, reproduced LOCALLY with the gate's own normalizer,
-- aiming its `live` argument at origin/main's snapshot rather than at PROD
-- (origin/main = c110555e23edf11638c4f205a09e191ec0457e5c), once per function:
--
--   git show origin/main:supabase/schema/functions/<fn>.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/<fn>.sql <scratch>
--
-- ⭐ EACH ACKED HASH IS THE `live` COLUMN OF --diff-bodies FOR THAT FUNCTION'S
-- DRIFT ROW, NOT `--hash` OF THE SNAPSHOT FILE (a whole-file digest no gate
-- ever greps).
--
-- defer_compute_job (4 args), the DRIFT row's `live` column (hunks column 2):
-- prod-body-ack: ea6803fc52fd5d43e262ccb13673f564c7bd970896ad6c066f3934e37ccdcdfc
--
-- mark_compute_job_done (2 args), the DRIFT row's `live` column (hunks column 4):
-- prod-body-ack: 2315eb47d0f99344679d04cdab6c1b0df6762864d23021907e81dfc687f183e7
--
-- mark_compute_job_failed (4 args), the DRIFT row's `live` column (hunks column 2):
-- prod-body-ack: e40c6150ce7b53ecbf1aff6adaefafc2c2bb007de9961c29c487e7bd95adcaf1
--
-- ⚠️ EACH ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only if
-- VAC-04 on the PR reports that SAME hash for PROD for that function. If it
-- reports a different one, PROD drifted OUT OF BAND and the correct action is
-- to FOLD the difference into this migration and re-derive — never to edit a
-- pragma to match a gate log. It is EARNED, not pasted.
-- ⚠️ VAC-08 (repo-vs-TEST body pairing) goes RED on the PR by construction:
-- one DRIFT row per function (defer_compute_job/4, mark_compute_job_done/2 and
-- mark_compute_job_failed/4), whose TEST hash is the pre-change hash above,
-- until apply-on-merge brings TEST forward.
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

-- PD-02: re-issued from 20260529170000's COMMENT; only the errcode wording moved.
COMMENT ON FUNCTION defer_compute_job(UUID, INTEGER, TEXT, UUID) IS 'Defers a running job back to pending for circuit-breaker cooldowns. Decrements attempts by 1 to cancel claim_compute_jobs increment so the defer does not burn a retry. NEW-C12-06 (CL10): p_claim_token fences the running-row read (back-compat NULL arm for the deploy window) and a token mismatch on a still-running row raises SQLSTATE 55006 (object_in_use), which PostgREST answers once; the deferred row has claim_token NULLed so it drops the stale fence token. Worker is sole caller (services/job_worker._check_circuit_breaker). See migrations 033 + 117.';

-- --------------------------------------------------------------------------
-- mark_compute_job_done
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id     UUID,
  p_claim_token UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_current_token    UUID;
BEGIN
  -- audit-2026-05-07 B5: token is now mandatory. NULL was a documented
  -- pre-mig-117 back-compat path; the only production caller (main_worker)
  -- threads the token uniformly post-PR-#347.
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_done: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Atomic flip running → done with token fence + strategy capture.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND claim_token = p_claim_token
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row may exist but isn't running, OR row missing, OR token mismatch.
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 109 P6 / mig 117 second-pass fix #2: idempotent retry on
    -- already-done row ONLY when the caller's token matches the recorded
    -- one. The pre-B5 path also accepted NULL — removed now that NULL is
    -- rejected at the entrypoint above.
    IF v_current_status = 'done' THEN
      IF v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    -- Row in some other state (failed_retry, failed_final, pending,
    -- done_pending_children). Surface loudly.
    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- audit-2026-05-07 G23-187-mig-01/03 RE-APPLY: set-based fan-in advance
  -- with the GIN-supported containment predicate. The strict-token rewrite
  -- (20260528183100) had copied a pre-20260516131500 body and silently
  -- reverted this to a per-child `p_job_id = ANY(parent_job_ids)` FOR-loop,
  -- which the planner CANNOT push to the GIN index compute_jobs_parent_lookup
  -- (only `@>` containment is GIN-supported) -- re-introducing the H-0864
  -- seq-scan + N+1 check_fan_in_ready overhead. The NOT EXISTS sub-query
  -- enforces "all parents done" identically to check_fan_in_ready
  -- (count(parents WHERE status <> 'done') = 0). This form was live in prod
  -- 2026-05-16..2026-05-28 (mig 20260516131500) before the silent revert.
  UPDATE compute_jobs c
     SET status          = 'pending',
         next_attempt_at = now()
   WHERE c.status = 'done_pending_children'
     AND c.parent_job_ids @> ARRAY[p_job_id]::uuid[]
     AND NOT EXISTS (
       SELECT 1
         FROM compute_jobs p
        WHERE p.id = ANY(c.parent_job_ids)
          AND p.status <> 'done'
     );

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- PD-02: re-issued from 20260603120000's COMMENT; only the errcode wording
-- moved. "THIS migration" below still names 20260603120000's own change, kept
-- verbatim.
COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS 'Terminal success transition. Migration 117 P97 fence + B5 strict-token gate (20260528183100): p_claim_token MUST be non-NULL (NULL raises 22023); mismatch raises SQLSTATE 55006 (object_in_use), which PostgREST answers once. THIS migration (G23-187-mig-01/03): re-applies the GIN-supported set-based `parent_job_ids @> ARRAY[p_job_id]` fan-in advance (the strict-token rewrite had reverted it to a `= ANY(...)` FOR-loop). Preserves the mig 099 Phase-18 atomic UI status bridge.';

-- --------------------------------------------------------------------------
-- mark_compute_job_failed
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id      UUID,
  p_error       TEXT,
  p_error_kind  TEXT DEFAULT 'unknown',
  p_claim_token UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts      INTEGER;
  v_max_attempts  INTEGER;
  v_next_attempt  TIMESTAMPTZ;
  v_new_status    TEXT;
  v_strategy_id   UUID;
  v_current_token UUID;
  v_current_status TEXT;
BEGIN
  -- audit-2026-05-07 B5: token mandatory (see mark_compute_job_done above).
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_error_kind IS NOT NULL
     AND p_error_kind NOT IN ('transient', 'permanent', 'unknown') THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_error_kind must be transient/permanent/unknown, got %', p_error_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT attempts, max_attempts, strategy_id
    INTO v_attempts, v_max_attempts, v_strategy_id
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
      AND claim_token = p_claim_token
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_failed: job % not running (status=%)', p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_error_kind = 'permanent' THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSIF v_attempts >= v_max_attempts THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSE
    v_new_status := 'failed_retry';
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      WHEN v_attempts = 3 THEN v_next_attempt := now() + interval '10 minutes';
      WHEN v_attempts = 4 THEN v_next_attempt := now() + interval '1 hour';
      ELSE                     v_next_attempt := now() + interval '6 hours';
    END CASE;
  END IF;

  -- HOTFIX 2026-05-29: write `error_kind` (the real column + CHECK target),
  -- NOT the non-existent `last_error_kind` that mig 20260528183100 introduced.
  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = p_error_kind,
         next_attempt_at = v_next_attempt
   WHERE id = p_job_id;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- PD-02: re-issued from 20260529180000's COMMENT; only the errcode wording moved.
COMMENT ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) IS 'Terminal failure transition. Mig 117 / P97 fence + B5 strict-token follow-up: p_claim_token MUST be non-NULL (NULL raises 22023 invalid_parameter_value); mismatch raises SQLSTATE 55006 (object_in_use), which PostgREST answers once. Backoff schedule preserved verbatim from mig 109 P4. HOTFIX 20260529180000: writes error_kind (not the non-existent last_error_kind that mig 20260528183100 typo-introduced, which 42703-errored every failed mark).';

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
  v_done_oid            oid := to_regprocedure('public.mark_compute_job_done(uuid, uuid)');
  v_done_fn             text;
  v_done_body           text;
  v_done_cfg            text[];
  v_done_secdef         boolean;
  v_done_lock_anchored  boolean;
  v_failed_oid          oid := to_regprocedure('public.mark_compute_job_failed(uuid, text, text, uuid)');
  v_failed_fn           text;
  v_failed_body         text;
  v_failed_cfg          text[];
  v_failed_secdef       boolean;
  v_failed_lock_anchored boolean;
  v_raised_null_token   boolean := false;
  v_raised_bad_kind     boolean := false;
  v_raised_not_found    boolean := false;
  c_done_sig            CONSTANT text := 'public.mark_compute_job_done(uuid, uuid)';
  c_failed_sig          CONSTANT text := 'public.mark_compute_job_failed(uuid, text, text, uuid)';
  -- The guard, then the lock (two-integer form, this namespace, the strategy
  -- id as the second key), then the bridge call, as consecutive STATEMENTS.
  -- One regex pins presence, form, namespace, guard and placement together.
  c_lock_re             CONSTANT text :=
    'IF\s+v_strategy_id\s+IS\s+NOT\s+NULL\s+THEN\s+PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*v_strategy_id::text\s*\)\s*\)\s*;\s*PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*\)';
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

  -- ===== mark_compute_job_done and mark_compute_job_failed: carried forward
  -- verbatim from 20260926120000's self-verify, plus one combined guard each.
  -- (0) the namespace cannot collide with the only other two-integer
  -- namespace in any migration. Recomputed here, never trusted from prose.
  IF hashtext('mark_compute_job_bridge') = hashtext('admin_role_mutate') THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: hashtext(mark_compute_job_bridge) equals hashtext(admin_role_mutate) on this server, so a terminal mark and an admin role mutation on colliding ids would serialize against each other. Choose a different namespace string.';
  END IF;

  IF v_done_oid IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: public.mark_compute_job_done(uuid, uuid) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_done_fn := pg_get_functiondef(v_done_oid);
  -- Strip BOTH plpgsql comment syntaxes, block first (T-163-16).
  v_done_body := regexp_replace(regexp_replace(v_done_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_done_body IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: the comment-stripped mark_compute_job_done body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (M) ONE combined guard (Phase 164.9.3.2): no old errcode name, exactly
  -- two 55006 raises (late mark on a done row; running-row mismatch), and the
  -- classifier literal at both. Kept on ONE line so a mutation twin can stand
  -- it down whole.
  IF v_done_body ~* 'serialization_failure' OR regexp_count(v_done_body, '''55006''') <> 2 OR regexp_count(v_done_body, 'preempted by watchdog reclaim') <> 2 THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: mark_compute_job_done still names serialization_failure, or does not raise 55006 exactly twice, or lost the classifier literal at either fence raise. SQLSTATE 40001 is retried without bound by PostgREST 14, so the fence would loop instead of failing once.';
  END IF;

  -- (1) the lock, statement-shaped, first inside the strategy guard.
  v_done_lock_anchored := v_done_body ~ c_lock_re;
  IF NOT v_done_lock_anchored THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done does not take the two-integer mark_compute_job_bridge advisory lock on the strategy id as the first statement inside its non-NULL strategy guard, directly before the bridge call. Two concurrent terminal marks on one strategy would interleave inside the bridge again (161.1-D1).';
  END IF;

  -- (2) carried forward from 20260603120000 STEP 3, so this full-body re-base
  -- cannot silently revert the fixes that migration pinned.
  IF v_done_body !~* 'parent_job_ids\s*@>\s*ARRAY\[\s*p_job_id' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done lost the GIN @> set-based fan-in (G23-187-mig-01/03)';
  END IF;
  IF v_done_body ~* 'FOR\s+v_child_id\s+IN' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done carries the regressed per-child FOR-loop fan-in';
  END IF;
  IF v_done_body !~* 'p_claim_token IS NULL' OR v_done_body !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done lost the B5 strict-token NULL gate (20260528183100)';
  END IF;
  IF v_done_body !~* 'sync_strategy_analytics_status' THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done lost the Phase-18 atomic UI status bridge';
  END IF;

  -- (3) SECURITY DEFINER, and the search_path pin is the VALUE, not the word.
  SELECT p.prosecdef, p.proconfig INTO v_done_secdef, v_done_cfg
    FROM pg_proc p WHERE p.oid = v_done_oid;
  IF v_done_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_done_cfg IS NULL OR NOT (c_search_path = ANY(v_done_cfg)) THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_done does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_done_cfg;
  END IF;

  -- (4) ACL: the REVOKE above re-converged.
  IF to_regrole('anon') IS NULL
     OR to_regrole('authenticated') IS NULL
     OR to_regrole('service_role') IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: one of the roles anon / authenticated / service_role does not exist on this database, so the ACL arm cannot be evaluated. These are Supabase-standard roles; their absence means this migration is running somewhere it was not written for.';
  END IF;
  -- The PUBLIC probe runs first so a PUBLIC leak is named as a PUBLIC leak.
  PERFORM public._assert_no_public_execute(c_done_sig);
  IF has_function_privilege('anon', v_done_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_done_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: anon or authenticated holds EXECUTE on the SECURITY DEFINER mark_compute_job_done — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;

  -- ===== mark_compute_job_failed =====
  IF v_failed_oid IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: public.mark_compute_job_failed(uuid, text, text, uuid) does not resolve after its CREATE OR REPLACE';
  END IF;

  v_failed_fn := pg_get_functiondef(v_failed_oid);
  v_failed_body := regexp_replace(regexp_replace(v_failed_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW.
  IF v_failed_body IS NULL THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: the comment-stripped mark_compute_job_failed body came back NULL, so every regex arm below would pass without reading anything. Refusing to report compliance on an unread body.';
  END IF;

  -- (F) ONE combined guard (Phase 164.9.3.2): no old errcode name, exactly
  -- one 55006, and the classifier literal present. ONE line, as above.
  IF v_failed_body ~* 'serialization_failure' OR regexp_count(v_failed_body, '''55006''') <> 1 OR position('preempted by watchdog reclaim' IN v_failed_body) = 0 THEN
    RAISE EXCEPTION 'compute-job-fence-errcode: mark_compute_job_failed still names serialization_failure, or does not raise 55006 exactly once, or lost the classifier literal. SQLSTATE 40001 is retried without bound by PostgREST 14, so the fence would loop instead of failing once.';
  END IF;

  -- (5) the lock, statement-shaped, first inside the strategy guard. Both
  -- RPCs must carry it: a half-applied lock discipline reads as protection
  -- while providing none (D-01).
  v_failed_lock_anchored := v_failed_body ~ c_lock_re;
  IF NOT v_failed_lock_anchored THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed does not take the two-integer mark_compute_job_bridge advisory lock on the strategy id as the first statement inside its non-NULL strategy guard, directly before the bridge call. A failure mark and a second terminal mark on one strategy would interleave inside the bridge again (161.1-D1).';
  END IF;

  -- (6) carried forward from 20260529180000: behavioural probes on RANDOM
  -- uuids. They seed nothing and read no row content.
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'permanent', NULL);
  EXCEPTION WHEN invalid_parameter_value THEN v_raised_null_token := true;
  END;
  IF NOT v_raised_null_token THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed with a NULL claim token did not raise invalid_parameter_value (the B5 strict fence regressed)';
  END IF;
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'bogus_kind', gen_random_uuid());
  EXCEPTION WHEN invalid_parameter_value THEN v_raised_bad_kind := true;
  END;
  IF NOT v_raised_bad_kind THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed with an out-of-vocabulary error_kind did not raise invalid_parameter_value';
  END IF;
  BEGIN
    PERFORM mark_compute_job_failed(gen_random_uuid(), 'probe', 'permanent', gen_random_uuid());
  EXCEPTION WHEN no_data_found THEN v_raised_not_found := true;
  END;
  IF NOT v_raised_not_found THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed on an unknown job did not raise no_data_found';
  END IF;

  -- (7) SECURITY DEFINER, and the search_path pin is the VALUE.
  SELECT p.prosecdef, p.proconfig INTO v_failed_secdef, v_failed_cfg
    FROM pg_proc p WHERE p.oid = v_failed_oid;
  IF v_failed_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed is no longer SECURITY DEFINER, so the worker (service_role) could not reach compute_jobs through it';
  END IF;
  IF v_failed_cfg IS NULL OR NOT (c_search_path = ANY(v_failed_cfg)) THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: mark_compute_job_failed does not pin search_path to the exact declared value (pg_proc.proconfig=%). A SECURITY DEFINER function whose pin is missing, empty or reordered is search-path-hijackable.', v_failed_cfg;
  END IF;

  -- (8) ACL re-convergence (the role-existence guard above already ran).
  PERFORM public._assert_no_public_execute(c_failed_sig);
  IF has_function_privilege('anon', v_failed_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_failed_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'mark-compute-job-bridge-lock: anon or authenticated holds EXECUTE on the SECURITY DEFINER mark_compute_job_failed — ACL drifted open. The PUBLIC probe above already passed, so this is a grant held by the named role directly.';
  END IF;
  RAISE NOTICE 'compute-job-fence-errcode: all four claim-token fence raises answer 55006 (not 40001) with the classifier literal intact — defer_compute_job once, mark_compute_job_done twice, mark_compute_job_failed once; every anchor carried forward from 20260529170000 and 20260926120000 (lock placement, namespace, GIN fan-in, B5 NULL gate, bridge call, probes) and SECURITY DEFINER, the exact search_path pin and the ACL intact for all three.';
END
$verify$;
