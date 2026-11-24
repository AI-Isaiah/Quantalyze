-- ============================================================================
-- Phase 227 JOBLEDGER, plan 03 (HEAL-02): renew_compute_job_claims
-- ============================================================================
-- A token-fenced lease renewal for compute_jobs.claimed_at.
--
-- THE TRACED ROOT CAUSE. The worker claims up to five jobs in one call
-- (claim_compute_jobs_with_priority stamps every claimed row with the same
-- claimed_at = now() and a fresh claim_token), then dispatches them ONE AFTER
-- ANOTHER. A job that sits in the worker's batch list behind slow batch-mates
-- keeps the claimed_at of the claim, so its age grows with its batch-mates'
-- runtime. reset_stalled_compute_jobs resets any running row older than its
-- kind's threshold (derive_allocator_equity: the worker's '20 minutes'
-- override) and NULLs its claim_token, while the worker still holds the row in
-- its list. The worker then dispatches the row it no longer owns: the job runs
-- a second time, and its terminal write is refused with 55006 because the
-- token no longer matches. The work ran twice and its result was thrown away.
--
-- THE FIX. This function moves claimed_at to now() for a set of (id, token)
-- pairs, but only for rows that are still running under the CALLER'S OWN token.
-- The worker (plan 08) calls it before each dispatch and from its heartbeat, so
-- a waiting row stays young for as long as its worker is alive and looping. A
-- frozen worker stops renewing, its rows age out, and the watchdog resets them
-- exactly as it does today.
--
-- DECISIONS.
--   DEC-03-A Fence on the token, not the worker id. A row renews only when
--     status = 'running' and its claim_token equals the caller's. The watchdog
--     NULLs the token in the same UPDATE that resets the row, so a row the
--     watchdog already took can never be renewed by its old worker.
--   DEC-03-B No row-skipping lock clause. A row being reset right now is locked
--     by the watchdog; this UPDATE waits for that one row, then sees the NULL
--     token and renews nothing. Skipping locked rows would let a renew report
--     success-by-omission for a row it never looked at. It touches at most five
--     rows, so the wait is bounded by one watchdog statement.
--   DEC-03-C Returns the renewed ids. The worker reads membership of the
--     returned set to decide whether it still owns a row (plan 08's pre-dispatch
--     fence).
--
-- REJECTED OPTIONS (RESEARCH, HEAL-02).
--   B  A started_at column: it moves the watchdog's clock for the running row
--      but not for a row that has not started, so it does not close the class.
--   C  Batch size 1: cuts throughput fivefold and leaves every other kind with
--      a batch behind a slow job open.
--   D  Raise the threshold: forbidden by the phase boundary. A larger number
--      is not a close; the row still ages through its batch-mates.
--
-- WHAT THIS DOES NOT TOUCH. reset_stalled_compute_jobs, the claim pair and every
-- watchdog threshold are unchanged. This function writes no column but
-- claimed_at: attempts, claimed_by, claim_token and next_attempt_at stay as they
-- are. Until plan 08 calls it, no production behaviour changes.
-- ============================================================================

CREATE FUNCTION public.renew_compute_job_claims(
  p_job_ids      uuid[],
  p_claim_tokens uuid[]
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF p_job_ids IS NULL
     OR p_claim_tokens IS NULL
     OR cardinality(p_job_ids) <> cardinality(p_claim_tokens) THEN
    RAISE EXCEPTION 'renew_compute_job_claims: p_job_ids and p_claim_tokens must be non-null arrays of equal length'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH renewed AS (
    UPDATE compute_jobs c
       SET claimed_at = now()
      FROM unnest(p_job_ids, p_claim_tokens) AS r(id, tok)
     WHERE c.id = r.id
       AND c.claim_token = r.tok
       AND c.status = 'running'
    RETURNING c.id
  )
  SELECT renewed.id FROM renewed;
END
$function$;

COMMENT ON FUNCTION public.renew_compute_job_claims(uuid[], uuid[]) IS
  'Phase 227 JOBLEDGER HEAL-02. Moves claimed_at to now() for each (id, claim_token) pair whose row is still status running under exactly that token, and returns the ids it renewed. A row the watchdog already reset (token NULLed), a row not running, and a token that does not match renew nothing and are absent from the result, so the caller reads membership of the result as "I still own this row". Mismatched or NULL arrays raise invalid_parameter_value. Writes no column but claimed_at. Never call it for the row currently executing: that row''s staleness stays governed by its own per-kind watchdog override. service_role only.';

REVOKE ALL ON FUNCTION public.renew_compute_job_claims(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_compute_job_claims(uuid[], uuid[]) TO service_role;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No compute_jobs row is read or written. Asserted: the function resolves under
-- that exact signature and RETURNS SETOF uuid; it is SECURITY DEFINER with the
-- exact search_path pin; its comment-stripped body compares claim_token and keys on
-- status = 'running' and carries no row-skipping lock clause (DEC-03-B); EXECUTE
-- is held by neither PUBLIC, anon nor authenticated and is held by service_role.
-- The cardinality guard is deliberately NOT asserted here: the gate's arm R4 owns
-- it behaviourally. Each clause that a mutated copy of this file would trip has
-- its own `IF v_... THEN` line so the gate's mutation twins can stand exactly that
-- clause down and let the apply succeed, which is what lets the gate, not the
-- apply, go RED with the arm named.
DO $verify$
DECLARE
  v_oid         oid := to_regprocedure('public.renew_compute_job_claims(uuid[],uuid[])');
  v_secdef      boolean;
  v_retset      boolean;
  v_rettype     oid;
  v_cfg         text[];
  v_body        text;
  v_public_exec boolean;
  v_open_exec   boolean;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: public.renew_compute_job_claims(uuid[], uuid[]) is missing';
  END IF;

  SELECT p.prosecdef, p.proretset, p.prorettype, p.proconfig
    INTO v_secdef, v_retset, v_rettype, v_cfg
    FROM pg_proc p WHERE p.oid = v_oid;

  IF v_retset IS DISTINCT FROM TRUE OR v_rettype IS DISTINCT FROM 'uuid'::regtype::oid THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: renew_compute_job_claims does not RETURN SETOF uuid, so the worker cannot read which ids it still owns';
  END IF;
  IF v_secdef IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: renew_compute_job_claims is not SECURITY DEFINER, so the worker role could not reach compute_jobs through it';
  END IF;
  IF v_cfg IS NULL OR NOT ('search_path=public, pg_catalog' = ANY (v_cfg)) THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: renew_compute_job_claims does not pin search_path to public, pg_catalog (proconfig=%), so a SECURITY DEFINER body is search-path-hijackable', v_cfg;
  END IF;

  v_body := regexp_replace(regexp_replace(pg_get_functiondef(v_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: the comment-stripped body came back NULL, so every body check below would pass without reading anything';
  END IF;
  IF v_body !~* '\yclaim_token\s*=' THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: renew_compute_job_claims no longer keys on claim_token, so a stale worker could renew a row the watchdog already took';
  END IF;
  IF v_body !~* 'status\s*=\s*''running''' THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: renew_compute_job_claims no longer restricts to status running, so it could re-lease a finished or pending row';
  END IF;
  IF v_body ~* 'skip\s+locked' THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: renew_compute_job_claims skips locked rows, so it could report success by omission for a row it never looked at (DEC-03-B)';
  END IF;

  v_public_exec := EXISTS (
    SELECT 1
      FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
     WHERE p.oid = v_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE');
  IF v_public_exec THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: PUBLIC holds EXECUTE on renew_compute_job_claims';
  END IF;
  v_open_exec := has_function_privilege('anon', v_oid, 'EXECUTE')
              OR has_function_privilege('authenticated', v_oid, 'EXECUTE');
  IF v_open_exec THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: anon or authenticated holds EXECUTE on renew_compute_job_claims, so a browser role could extend a lease';
  END IF;
  IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261124120200 failed: service_role does not hold EXECUTE on renew_compute_job_claims, so the worker cannot renew';
  END IF;

  RAISE NOTICE 'Migration 20261124120200: renew_compute_job_claims exists (SETOF uuid, SECURITY DEFINER, pinned search_path, keyed on claim_token and status running, no row skipping) with EXECUTE for service_role only.';
END
$verify$;
