-- Migration: scoring_weight_overrides HIGH hardening (audit-2026-05-07 H-pass on mig 062)
--
-- Audit findings addressed: H-0939, H-0941, H-0942, H-0944, H-0945.
--
-- Why this migration exists
-- -------------------------
-- The audit-2026-05-07 H-pass on supabase/migrations/062_scoring_weight_overrides.sql
-- identified three clusters of SQL-actionable HIGH defects (five
-- individual H-IDs) beyond what migrations 066 / 118 / 134 closed in
-- the prior remediation rounds:
--
--   * H-0939 (type-design-analyzer c9): allocator_preferences.scoring_weight_overrides
--     is JSONB with no DB-level shape contract. A buggy admin tool, a
--     hand-edit, or a future migration backfill can write
--     {"W_PORTFOLIO_FIT": "1.5"} (string), {"W_BOGUS": 1.0}, or an array
--     — the engine's `overrides.get('W_PORTFOLIO_FIT', 1.0)` silently
--     accepts the bad shape and poisons every scoring run for that
--     allocator until manual cleanup.
--   * H-0941 (data-migration c8) + H-0945 (red-team c7): migration 062
--     DROPped enqueue_compute_job + REVOKEd from PUBLIC/anon/authenticated
--     but never GRANTed EXECUTE TO service_role. Migration 066 extended
--     to the 9-param signature with the same pattern: DROP + REVOKE,
--     no service_role GRANT. SECURITY DEFINER means the function runs
--     as owner (postgres) so cron / pg_cron paths still work — but any
--     direct service-role rpc() call from analytics-service Python that
--     does NOT route through a SECURITY DEFINER wrapper would currently
--     fail with insufficient_privilege. The function owner happens to be
--     the same role across the migration set, so today this is dormant;
--     migration-118 already remediated the PRIVATE _enqueue_compute_job_internal
--     overload but NOT the PUBLIC enqueue_compute_job wrapper.
--   * H-0942 (data-migration c8) + H-0944 (red-team c7): the allocator-
--     scoped branch of enqueue_compute_job skips _assert_owner. Comment
--     justifies it as "the only caller is update_allocator_mandates RPC
--     body where p_allocator_id = auth.uid() by construction". This is
--     a comment-only invariant. A future SECURITY DEFINER caller can
--     forge a cross-allocator rescore enqueue without DB-enforced
--     ownership. Defense-in-depth: require p_allocator_id = auth.uid()
--     OR caller is service_role inside the allocator branch.
--
-- Items NOT in this migration
-- ---------------------------
--   * H-0936 / H-0937 (code-simplifier refactor of duplicated bodies):
--     Refactor proposals — not actionable as a forward migration; would
--     either touch immutable migration 062 (forbidden) or introduce a
--     net-new helper for a single caller (over-abstraction).
--   * H-0938 (FK retarget compute_jobs.allocator_id → profiles): a
--     CASCADE-modifying schema rewrite. Defer to a separate plan with
--     deploy + observability gates. Out of scope for the H-pass.
--   * H-0940 (sentinel UUID probe in mig 062 self-verify): historical —
--     the DO block ran once during migration 062 apply. Cannot be
--     "fixed" via a forward migration.
--   * H-0943 (3-way XOR polymorphic FK type design): type-design proposal
--     for a future schema rewrite, not a backward-compatible H-pass.
--
-- What this migration ships
-- -------------------------
-- 1. CHECK constraint on allocator_preferences.scoring_weight_overrides
--    enforcing: NULL, or JSONB object with all keys ∈ whitelist
--    {W_PORTFOLIO_FIT, W_PERFORMANCE, W_QUALITY, W_RISK_FIT, W_RELIABILITY,
--    W_EXCHANGE_FIT, W_LIQUIDITY_FIT} AND all values numeric within
--    [0.5, 1.5]. Matches the engine's clamp range. NOT VALID + VALIDATE
--    pattern so the migration is atomic.
-- 2. GRANT EXECUTE on enqueue_compute_job's current 9-param signature
--    (the migration-066 extension) TO service_role so direct
--    analytics-service rpc() calls do not hit insufficient_privilege if
--    the SECURITY DEFINER → owner-binding ever changes shape. Idempotent
--    re-application of REVOKE FROM PUBLIC/anon/authenticated is also
--    re-asserted as belt-and-braces against future GRANT-leak.
-- 3. CREATE OR REPLACE enqueue_compute_job with an allocator-branch
--    ownership check: `p_allocator_id = auth.uid() OR auth.role() =
--    'service_role'`. The strategy / portfolio / api_key branches are
--    preserved verbatim from migration 066 (they already enforce
--    _assert_owner via the strategies / portfolios / api_keys regclass).
--    The new gate raises 42501 (insufficient_privilege) on mismatch.
--
-- Idempotency
-- -----------
-- * CHECK uses NOT VALID + VALIDATE in same tx so re-apply skips the
--   ADD when the constraint already exists.
-- * GRANT / REVOKE are convergent.
-- * CREATE OR REPLACE preserves the migration-066 signature.
--
-- Rollback
-- --------
-- supabase/migrations/down/20260515210300-rollback.sql drops the new
-- CHECK and restores the migration-066 enqueue_compute_job body.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 0: H-0939 helper — shape validation function
-- --------------------------------------------------------------------------
-- PostgreSQL forbids subqueries inside CHECK expressions (raises
-- 0A000 cannot_use_subquery_in_check), so the NOT EXISTS predicates
-- that police the JSONB shape must live inside an IMMUTABLE function
-- the CHECK can call. Extracting the helper also collapses the
-- backfill predicate and the CHECK predicate to a single source of
-- truth — the H-0939 fixup commit demonstrated the cost of the
-- predicate-duplication (audit-A reuse #2 / efficiency #4).
CREATE OR REPLACE FUNCTION public._scoring_weight_overrides_is_valid(
  p_overrides jsonb
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $fn$
  SELECT
    p_overrides IS NULL
    OR (
      jsonb_typeof(p_overrides) = 'object'
      AND NOT EXISTS (
        SELECT 1
          FROM jsonb_object_keys(p_overrides) AS k
         WHERE k NOT IN (
           'W_PORTFOLIO_FIT', 'W_PERFORMANCE', 'W_QUALITY', 'W_RISK_FIT',
           'W_RELIABILITY', 'W_EXCHANGE_FIT', 'W_LIQUIDITY_FIT'
         )
      )
      AND NOT EXISTS (
        SELECT 1
          FROM jsonb_each(p_overrides) AS kv(key, value)
         WHERE jsonb_typeof(kv.value) <> 'number'
            OR CASE
                 WHEN jsonb_typeof(kv.value) = 'number'
                 THEN (kv.value::text)::numeric NOT BETWEEN 0.5 AND 1.5
                 ELSE false
               END
      )
    );
$fn$;

COMMENT ON FUNCTION public._scoring_weight_overrides_is_valid(jsonb) IS
  'audit-2026-05-07 H-0939. IMMUTABLE shape validator for '
  'allocator_preferences.scoring_weight_overrides. Returns TRUE iff the '
  'argument is NULL or a JSONB object whose keys are all in '
  '{W_PORTFOLIO_FIT, W_PERFORMANCE, W_QUALITY, W_RISK_FIT, W_RELIABILITY, '
  'W_EXCHANGE_FIT, W_LIQUIDITY_FIT} and whose values are all JSON numbers '
  'in [0.5, 1.5]. Called from both the backfill predicate and the table '
  'CHECK constraint — coordinate any amendment with both call sites and '
  'with match_engine.py.';

-- --------------------------------------------------------------------------
-- STEP 1: H-0939 — bound scoring_weight_overrides shape
-- --------------------------------------------------------------------------
-- The CHECK enforces three invariants via _scoring_weight_overrides_is_valid:
--   (a) JSONB type is 'object' (rejects arrays, scalars, NULL is OK).
--   (b) Every top-level key is in the whitelist of known weight slots.
--   (c) Every top-level value is a JSON number in [0.5, 1.5].
--
-- Weight whitelist mirrors the match_engine.py constants. If a future
-- weight is added, the helper above + this migration's header must be
-- amended in lockstep — surface the dependency in the function comment
-- so a missed update is caught by the runtime CHECK error rather than
-- silently mis-scoring.
--
-- Backfill: any existing row that violates the new CHECK gets its
-- scoring_weight_overrides coerced to NULL so VALIDATE CONSTRAINT can
-- succeed. NULL means "no overrides — use engine defaults" which is
-- the same shape as a fresh allocator_preferences row.
DO $$
DECLARE
  v_coerced INTEGER;
BEGIN
  WITH coerced AS (
    UPDATE allocator_preferences
       SET scoring_weight_overrides = NULL
     WHERE scoring_weight_overrides IS NOT NULL
       AND NOT public._scoring_weight_overrides_is_valid(scoring_weight_overrides)
    RETURNING user_id
  )
  SELECT count(*) INTO v_coerced FROM coerced;

  IF v_coerced > 0 THEN
    RAISE NOTICE 'audit-2026-05-07 H-0939: coerced % out-of-shape allocator_preferences.scoring_weight_overrides rows to NULL.', v_coerced;
  END IF;
END $$;

ALTER TABLE allocator_preferences
  DROP CONSTRAINT IF EXISTS allocator_preferences_scoring_weight_overrides_shape;

ALTER TABLE allocator_preferences
  ADD CONSTRAINT allocator_preferences_scoring_weight_overrides_shape
  CHECK (public._scoring_weight_overrides_is_valid(scoring_weight_overrides))
  NOT VALID;

ALTER TABLE allocator_preferences
  VALIDATE CONSTRAINT allocator_preferences_scoring_weight_overrides_shape;

COMMENT ON CONSTRAINT allocator_preferences_scoring_weight_overrides_shape ON allocator_preferences IS
  'audit-2026-05-07 H-0939. JSONB shape gate for scoring_weight_overrides: object-typed, '
  'keys ∈ {W_PORTFOLIO_FIT, W_PERFORMANCE, W_QUALITY, W_RISK_FIT, W_RELIABILITY, '
  'W_EXCHANGE_FIT, W_LIQUIDITY_FIT}, values numeric ∈ [0.5, 1.5]. Mirrors match_engine.py '
  'clamp range. Coordinate this CHECK with any future weight-slot addition.';

-- --------------------------------------------------------------------------
-- STEP 2: H-0941 + H-0945 — re-assert grants on enqueue_compute_job
-- --------------------------------------------------------------------------
-- Migration 066's 9-param enqueue_compute_job DROPped + CREATEd the
-- function. The companion REVOKE stripped PUBLIC/anon/authenticated
-- EXECUTE but no explicit GRANT TO service_role was issued. SECURITY
-- DEFINER + postgres-owner means the function runs as owner from any
-- caller, but service_role still needs EXECUTE to *invoke* the function
-- under the strict REVOKE posture. Today this works because service_role
-- inherits EXECUTE from default privileges in Supabase managed Postgres,
-- but the assumption is brittle (a platform upgrade changing default
-- privilege behavior leaves us stranded).
--
-- Defensive: REVOKE re-asserted and EXECUTE explicitly GRANTed to
-- service_role for both the 9-param signature (migration 066) and the
-- legacy 7-param (in case it was re-introduced by a future replay).
REVOKE ALL ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 3: H-0942 + H-0944 — DB-enforced ownership in the allocator branch
-- --------------------------------------------------------------------------
-- Replace the migration-066 body with an identical structure that adds
-- one new gate: the allocator-scoped branch checks
-- `p_allocator_id = auth.uid() OR auth.role() = 'service_role'`.
-- The strategy / portfolio / api_key branches already enforce
-- ownership via _assert_owner (mig 066 STEP 6).
--
-- Behavior:
--   * Authenticated caller with valid JWT: auth.uid() is the caller's
--     user id; the gate accepts iff p_allocator_id matches.
--   * service_role: auth.role() returns 'service_role'; the gate
--     accepts unconditionally (cross-allocator rescore is the service-
--     role contract).
--   * anon / unauthenticated: auth.uid() is NULL; auth.role() is 'anon';
--     the gate rejects with 42501. Matches the strategy branch's
--     _assert_owner failure mode.
CREATE OR REPLACE FUNCTION public.enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_allocator_id    UUID DEFAULT NULL,
  p_api_key_id      UUID DEFAULT NULL,
  p_run_at          TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_role        TEXT;
  v_caller_uid  UUID;
BEGIN
  -- Strategy-scoped (pre-062 + post-062 callers).
  IF p_strategy_id IS NOT NULL AND p_allocator_id IS NULL AND p_api_key_id IS NULL THEN
    PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');
    RETURN _enqueue_compute_job_internal(
      p_strategy_id, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, NULL, p_run_at
    );
  END IF;

  -- Allocator-scoped (post-062 caller: update_allocator_mandates).
  IF p_allocator_id IS NOT NULL AND p_strategy_id IS NULL AND p_api_key_id IS NULL THEN
    -- audit-2026-05-07 H-0942 + H-0944: defense-in-depth ownership
    -- check. auth.role() returns 'service_role' for the cron / Python
    -- worker path and 'authenticated' for end-user RPCs. Mismatch ⇒
    -- raise insufficient_privilege so a future SECURITY DEFINER
    -- caller that forgets to bind p_allocator_id = auth.uid() cannot
    -- forge a cross-allocator rescore enqueue.
    --
    -- Capture auth.role() AND auth.uid() once. The EXCEPTION trap is
    -- narrowed to the SQLSTATEs that actually fire when the auth
    -- schema is missing or unreadable (e.g., direct postgres role
    -- during migration apply); any other failure must propagate so
    -- schema-drift bugs surface loudly instead of silently downgrading
    -- to v_role=NULL/v_caller_uid=NULL and dying at the gate below.
    BEGIN
      v_role := auth.role();
      v_caller_uid := auth.uid();
    EXCEPTION
      WHEN undefined_function OR undefined_table OR insufficient_privilege THEN
        v_role := NULL;
        v_caller_uid := NULL;
    END;

    IF v_role IS DISTINCT FROM 'service_role' THEN
      IF v_caller_uid IS NULL OR v_caller_uid IS DISTINCT FROM p_allocator_id THEN
        RAISE EXCEPTION 'enqueue_compute_job: allocator-scoped enqueue requires p_allocator_id = auth.uid() (got p_allocator_id=%, auth.uid()=%). audit-2026-05-07 H-0942.',
          p_allocator_id, v_caller_uid
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, p_allocator_id, NULL, p_run_at
    );
  END IF;

  -- Api-key-scoped (Phase 06 caller: request_allocator_holdings_sync).
  IF p_api_key_id IS NOT NULL AND p_strategy_id IS NULL AND p_allocator_id IS NULL THEN
    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, p_api_key_id, p_run_at
    );
  END IF;

  RAISE EXCEPTION 'enqueue_compute_job: exactly one of p_strategy_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, allocator=%, api_key=%)',
    p_strategy_id, p_allocator_id, p_api_key_id
    USING ERRCODE = 'invalid_parameter_value';
END;
$$;

COMMENT ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) IS
  'Idempotent enqueue of a compute job. Three modes: strategy / allocator / api_key '
  'scope. Delegates to _enqueue_compute_job_internal. Extended in migration 066 for '
  'api_key + run_at. audit-2026-05-07 H-0942 / H-0944: allocator-scoped branch now '
  'enforces p_allocator_id = auth.uid() unless caller is service_role.';

-- Reassert grants to the new body. CREATE OR REPLACE preserves ACL,
-- but the explicit grants survive any future ALTER FUNCTION OWNER TO
-- that might reset privileges.
REVOKE ALL ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_compute_job(
  uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz
) TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_body  TEXT;
  v_exists BOOLEAN;
  v_service_can BOOLEAN;
BEGIN
  -- H-0939 CHECK present + validated
  SELECT EXISTS(
    SELECT 1 FROM pg_constraint
     WHERE conname = 'allocator_preferences_scoring_weight_overrides_shape'
       AND conrelid = 'public.allocator_preferences'::regclass
       AND convalidated = true
  ) INTO v_exists;
  IF NOT v_exists THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0939 verification failed: shape CHECK missing or not VALIDATED';
  END IF;

  -- H-0941 / H-0945: service_role can EXECUTE the 9-param signature.
  -- has_function_privilege(role_name, fn, 'EXECUTE') is reliable for
  -- named roles. The PUBLIC pseudo-grantee is unreliable (cf. C-0284 /
  -- mig 134) — for PUBLIC absence use _assert_no_public_execute below.
  SELECT has_function_privilege(
    'service_role',
    'public.enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)',
    'EXECUTE'
  ) INTO v_service_can;
  IF v_service_can IS NOT TRUE THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0941/H-0945 verification failed: service_role lacks EXECUTE on enqueue_compute_job(9-param)';
  END IF;

  -- audit-2026-05-07 H-0941 / H-0945 / C-0284: assert PUBLIC absence on the
  -- 9-param signature via the mig 134 helper (aclexplode grantee=0 probe).
  -- Mirrors the C-0284 acceptance shape; the STEP 3 REVOKE above strips any
  -- leak, this PERFORM raises insufficient_privilege if a future migration
  -- ever re-grants PUBLIC EXECUTE.
  PERFORM public._assert_no_public_execute(
    'public.enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );

  -- H-0942 / H-0944: allocator-branch ownership gate in body
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'enqueue_compute_job'
     AND pg_get_function_identity_arguments(p.oid) = 'p_strategy_id uuid, p_kind text, p_idempotency_key text, p_parent_job_ids uuid[], p_exchange text, p_metadata jsonb, p_allocator_id uuid, p_api_key_id uuid, p_run_at timestamp with time zone';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07: enqueue_compute_job(9-param) signature not installed';
  END IF;
  IF v_body NOT LIKE '%audit-2026-05-07 H-0942%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 H-0942/H-0944 verification failed: enqueue_compute_job body lacks allocator-branch ownership gate';
  END IF;
END $$;

COMMIT;
