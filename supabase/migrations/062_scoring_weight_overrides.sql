-- Migration 062: scoring_weight_overrides on allocator_preferences + compute_jobs
-- 3-way XOR (allocator-scoped kind) + rescore_allocator kind + enqueue_compute_job
-- allocator-aware signature + update_allocator_mandates PERFORM enqueue.
-- Sprint 8 / Phase 3 — Mandate-Aware Scoring Engine (D-12 Option B, D-14).
--
-- What this does
-- --------------
-- 1. Adds scoring_weight_overrides JSONB column to allocator_preferences
--    (nullable, no default). Multiplicative per-dimension weight scales
--    consumed by match_engine v2.0.0; populated by Phase 4 feedback engine.
--    App-layer clamps each value to [0.5, 1.5] then renormalizes so the four
--    top-level weights sum to 1.0 (D-08). No DB CHECK constraint — Q3 resolved
--    to app-layer validation.
-- 2. Adds allocator_id UUID column to compute_jobs (nullable, REFERENCES
--    auth.users(id) ON DELETE CASCADE — mirrors strategy_id/portfolio_id FK
--    pattern from migration 032). Required for the new rescore_allocator
--    kind which is allocator-scoped.
-- 3. DROPs + re-ADDs compute_jobs_target_xor CHECK as a 3-way XOR across
--    strategy_id, portfolio_id, allocator_id (D-12 Option B).
-- 4. DROPs + re-ADDs compute_jobs_kind_target_coherence CHECK adding a new
--    branch: kind='rescore_allocator' requires allocator_id IS NOT NULL and
--    strategy_id IS NULL and portfolio_id IS NULL. Follows 048's DROP+ADD
--    precedent (lines 124-141).
-- 5. Registers 'rescore_allocator' in compute_job_kinds registry (INSERT ...
--    ON CONFLICT DO NOTHING — follows 048's pattern for new kinds).
-- 6. Adds partial unique index compute_jobs_one_inflight_per_kind_allocator
--    mirroring the existing per-strategy/per-portfolio indexes. Dedupes
--    concurrent rescore_allocator enqueues at the DB layer.
-- 7. CREATE OR REPLACEs enqueue_compute_job() with a trailing p_allocator_id
--    UUID DEFAULT NULL param. Also extends _enqueue_compute_job_internal()
--    to accept p_allocator_id and route allocator-scoped calls through the
--    same optimistic-lookup + race-safe-INSERT pattern as strategy and
--    portfolio scopes. Service-role/authenticated REVOKE preserved per
--    migration 032:446 (ADR-0001 baseline).
-- 8. CREATE OR REPLACEs update_allocator_mandates() from migration 061 with
--    a trailing PERFORM enqueue_compute_job(kind:='rescore_allocator',
--    p_allocator_id := auth.uid()) appended after the UPSERT but before the
--    final END. Uses auth.uid() inline (reuses v_auth_uid local from 061).
--    No change detector — every mandate write enqueues; the partial unique
--    index dedupes.
-- 9. Self-verifying DO block asserts every schema object from steps 1-8 is
--    present AND runs a SAVEPOINTed full RPC wrapper test
--    (enqueue_compute_job → _enqueue_compute_job_internal → INSERT) to
--    prove the allocator-scoped path works end-to-end + the partial unique
--    index catches duplicate direct INSERTs.
--
-- What this does NOT do
-- ---------------------
-- - No data migration. scoring_weight_overrides defaults to NULL (engine
--   treats NULL as v1 behavior per D-08). Existing allocator_preferences
--   rows unchanged.
-- - No rebalance of top-level weight constants (W_PORTFOLIO_FIT=0.40,
--   W_PREFERENCE_FIT=0.30, W_TRACK_RECORD=0.15, W_CAPACITY_FIT=0.15 stays
--   at sum=1.0). D-02 composition 0.6*preference_fit + 0.4*mandate_fit_score
--   lives INSIDE the W_PREFERENCE_FIT term.
-- - No new RLS policies on compute_jobs. The deny-all policy from migration
--   032:234 (compute_jobs_deny_all) still applies — only SECURITY DEFINER
--   RPCs write to compute_jobs. ADR-0001 baseline preserved.
-- - No DB CHECK constraint on scoring_weight_overrides shape. App-layer
--   _clamp + renormalize in match_engine v2.0.0 is the validation point
--   (Q3 resolved). Defense in depth against adversarial overrides comes
--   from the engine, not the DB.

BEGIN;

SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: scoring_weight_overrides column on allocator_preferences
-- --------------------------------------------------------------------------
-- Multiplicative per-dimension weight scales, populated by Phase 4.
-- NULL = no override (v1 behavior). Engine reads with .get(key, 1.0) per key
-- and clamps to [0.5, 1.5] defensively.
ALTER TABLE allocator_preferences
  ADD COLUMN IF NOT EXISTS scoring_weight_overrides JSONB;

COMMENT ON COLUMN allocator_preferences.scoring_weight_overrides IS
  'Multiplicative per-dimension scoring weight scales. Shape: {"W_PORTFOLIO_FIT": 1.3, ...}. NULL = no override (v1 behavior). Written by Phase 4 feedback_engine; read by Phase 3 match_engine. App-layer clamps to [0.5, 1.5] + renormalizes (D-08). Phase 3 / SCORING-06.';

-- --------------------------------------------------------------------------
-- STEP 2: compute_jobs.allocator_id column
-- --------------------------------------------------------------------------
-- Mirrors strategy_id / portfolio_id FK pattern from migration 032:108-109.
-- Exactly one of the three target columns is non-null per the 3-way XOR
-- CHECK below.
ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS allocator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

COMMENT ON COLUMN compute_jobs.allocator_id IS
  'Allocator scope for the rescore_allocator kind. Mirrors the existing strategy_id/portfolio_id pattern — exactly one of the three target columns is non-null per compute_jobs_target_xor. Phase 3 / D-12 Option B.';

-- --------------------------------------------------------------------------
-- STEP 3: DROP + re-ADD compute_jobs_target_xor as 3-way XOR
-- --------------------------------------------------------------------------
-- Existing constraint from migration 032:138 enforces 2-way XOR between
-- strategy_id and portfolio_id. Extended to 3-way including allocator_id.
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_target_xor;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_target_xor CHECK (
    (strategy_id IS NOT NULL AND portfolio_id IS NULL     AND allocator_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NOT NULL AND allocator_id IS NULL) OR
    (strategy_id IS NULL     AND portfolio_id IS NULL     AND allocator_id IS NOT NULL)
  );

COMMENT ON CONSTRAINT compute_jobs_target_xor ON compute_jobs IS
  'Exactly one of strategy_id, portfolio_id, allocator_id is non-null. Extended to 3-way in migration 062 for rescore_allocator kind.';

-- --------------------------------------------------------------------------
-- STEP 4: DROP + re-ADD compute_jobs_kind_target_coherence with
--         rescore_allocator branch (follow 048:124-141 precedent)
-- --------------------------------------------------------------------------
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
    (kind = 'compute_portfolio'
        AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
    (kind = 'rescore_allocator'
        AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
    (kind IN (
      'sync_trades',
      'compute_analytics',
      'poll_positions',
      'sync_funding',
      'reconcile_strategy',
      'compute_intro_snapshot'
    ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL)
  );

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind <-> target-type coherence. compute_portfolio is portfolio-scoped; rescore_allocator is allocator-scoped (Phase 3); every other shipped kind is strategy-scoped. Extended in migration 062 for rescore_allocator.';

-- --------------------------------------------------------------------------
-- STEP 5: Register rescore_allocator kind
-- --------------------------------------------------------------------------
-- compute_job_kinds is a plain reference table (not a CHECK). INSERT with
-- ON CONFLICT DO NOTHING mirrors 048:110.
INSERT INTO compute_job_kinds (name) VALUES ('rescore_allocator')
  ON CONFLICT (name) DO NOTHING;

-- --------------------------------------------------------------------------
-- STEP 6: Partial unique index compute_jobs_one_inflight_per_kind_allocator
-- --------------------------------------------------------------------------
-- Mirrors compute_jobs_one_inflight_per_kind_strategy/_portfolio from
-- migration 032:179-187. Ensures one in-flight rescore per (allocator_id,
-- kind) so a tight-loop mandate UPSERT does not saturate the worker queue
-- (T-03-B DoS mitigation).
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_per_kind_allocator
  ON compute_jobs (allocator_id, kind)
  WHERE allocator_id IS NOT NULL
    AND status IN ('pending', 'running', 'done_pending_children');

COMMENT ON INDEX compute_jobs_one_inflight_per_kind_allocator IS
  'Partial unique enforcing one in-flight job per (allocator_id, kind) for allocator-scoped kinds (rescore_allocator). Mirrors compute_jobs_one_inflight_per_kind_strategy / _portfolio. Phase 3 / D-12 Option B.';

-- --------------------------------------------------------------------------
-- STEP 7: Redefine _enqueue_compute_job_internal + enqueue_compute_job with
--         trailing p_allocator_id parameter
-- --------------------------------------------------------------------------
-- CREATE OR REPLACE treats a different parameter count as a NEW function
-- (Postgres overload resolution is strict on count + types), so we must
-- DROP the existing signatures first to avoid an ambiguous overload. The
-- explicit arg list on DROP FUNCTION is the key — plain "DROP FUNCTION foo"
-- is ambiguous if multiple overloads exist.
DROP FUNCTION IF EXISTS _enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb);
DROP FUNCTION IF EXISTS enqueue_compute_job(uuid, text, text, uuid[], text, jsonb);

-- Redefine with new p_allocator_id trailing param. Internal function grows
-- a 3-way XOR dispatch; public wrapper gains a branch for allocator-scoped
-- calls. Backwards-compat preserved for existing strategy-scoped callers
-- (p_allocator_id defaults to NULL).
CREATE OR REPLACE FUNCTION _enqueue_compute_job_internal(
  p_strategy_id     UUID,
  p_portfolio_id    UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT,
  p_parent_job_ids  UUID[],
  p_exchange        TEXT,
  p_metadata        JSONB,
  p_allocator_id    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
  v_target_count INT;
BEGIN
  -- 3-way XOR guard. Matches compute_jobs_target_xor CHECK but fails earlier
  -- with a clearer error message.
  v_target_count :=
    (CASE WHEN p_strategy_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_portfolio_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_allocator_id IS NOT NULL THEN 1 ELSE 0 END);
  IF v_target_count <> 1 THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id, p_portfolio_id, p_allocator_id must be non-null (got strategy=%, portfolio=%, allocator=%)',
      p_strategy_id, p_portfolio_id, p_allocator_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Optimistic look-up per target type. Separate branches because the
  -- partial unique indexes are per-target-type.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe insert. Matches the canonical idempotent shape from migration
  -- 032:405. Lost races re-read the winner's row below.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, allocator_id, kind, parent_job_ids,
    idempotency_key, exchange, metadata
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_kind, p_parent_job_ids,
    p_idempotency_key, p_exchange, p_metadata
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race. Re-read the winner's row.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  RETURN v_new_id;
END;
$$;

COMMENT ON FUNCTION _enqueue_compute_job_internal IS
  'Private shared implementation of the idempotent enqueue pattern. Called by enqueue_compute_job and enqueue_compute_portfolio_job wrappers. Handles all three target scopes (strategy / portfolio / allocator) via 3-way XOR on the three id parameters. Does NOT perform auth.uid() ownership checks — wrappers do that before calling. Extended in migration 062 for allocator scope (D-12 Option B).';

REVOKE ALL ON FUNCTION _enqueue_compute_job_internal FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION enqueue_compute_job(
  p_strategy_id     UUID,
  p_kind            TEXT,
  p_idempotency_key TEXT DEFAULT NULL,
  p_parent_job_ids  UUID[] DEFAULT '{}',
  p_exchange        TEXT DEFAULT NULL,
  p_metadata        JSONB DEFAULT NULL,
  p_allocator_id    UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- Backwards-compat path: strategy-scoped call (existing callers).
  IF p_allocator_id IS NULL AND p_strategy_id IS NOT NULL THEN
    PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');
    RETURN _enqueue_compute_job_internal(
      p_strategy_id, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL
    );
  END IF;

  -- Allocator-scoped path (Phase 3 / D-12 Option B). No _assert_owner call:
  -- the only caller is update_allocator_mandates RPC body where
  -- p_allocator_id = auth.uid() by construction; service-role callers
  -- also skip _assert_owner (same as strategy path).
  IF p_allocator_id IS NOT NULL AND p_strategy_id IS NULL THEN
    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, p_allocator_id
    );
  END IF;

  RAISE EXCEPTION 'enqueue_compute_job: exactly one of p_strategy_id or p_allocator_id must be non-null (got strategy=%, allocator=%)',
    p_strategy_id, p_allocator_id
    USING ERRCODE = 'invalid_parameter_value';
END;
$$;

COMMENT ON FUNCTION enqueue_compute_job IS
  'Idempotent enqueue of a compute job. Two modes: strategy-scoped (p_strategy_id set, p_allocator_id NULL — existing callers) and allocator-scoped (p_strategy_id NULL, p_allocator_id set — Phase 3 rescore_allocator). Delegates to _enqueue_compute_job_internal. Service-role calls bypass ownership check. Extended in migration 062 (D-12 Option B).';

REVOKE ALL ON FUNCTION enqueue_compute_job FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 8: CREATE OR REPLACE update_allocator_mandates with PERFORM enqueue
-- --------------------------------------------------------------------------
-- Copies the body from migration 061:100-212 verbatim (preserves
-- p_clear_fields + COALESCE-UPSERT logic) and appends ONE new PERFORM
-- statement after the UPSERT. The PERFORM runs in the same transaction as
-- the UPSERT so a rollback leaves no phantom job row. Single-inflight dedup
-- handled by compute_jobs_one_inflight_per_kind_allocator partial unique
-- index.
CREATE OR REPLACE FUNCTION public.update_allocator_mandates(
  p_max_weight                NUMERIC DEFAULT NULL,
  p_preferred_strategy_types  TEXT[]  DEFAULT NULL,
  p_excluded_exchanges        TEXT[]  DEFAULT NULL,
  p_target_ticket_size_usd    NUMERIC DEFAULT NULL,
  p_mandate_archetype         TEXT    DEFAULT NULL,
  p_correlation_ceiling       NUMERIC DEFAULT NULL,
  p_max_drawdown_tolerance    NUMERIC DEFAULT NULL,
  p_liquidity_preference      TEXT    DEFAULT NULL,
  p_style_exclusions          TEXT[]  DEFAULT NULL,
  p_clear_fields              TEXT[]  DEFAULT '{}'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_allowed_clear_fields CONSTANT TEXT[] := ARRAY[
    'max_weight','preferred_strategy_types','excluded_exchanges',
    'target_ticket_size_usd','mandate_archetype','correlation_ceiling',
    'max_drawdown_tolerance','liquidity_preference','style_exclusions'
  ];
  v_bad_field TEXT;
BEGIN
  -- 1. Auth guard (SQLSTATE 28000 maps to HTTP 401 in route handler).
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'update_allocator_mandates: no auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Bounds validation (SQLSTATE 22023 maps to HTTP 400).
  IF p_max_weight IS NOT NULL AND (p_max_weight < 0.05 OR p_max_weight > 0.50) THEN
    RAISE EXCEPTION 'max_weight must be between 0.05 and 0.50'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_correlation_ceiling IS NOT NULL AND (p_correlation_ceiling < 0 OR p_correlation_ceiling > 1) THEN
    RAISE EXCEPTION 'correlation_ceiling must be between 0 and 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_max_drawdown_tolerance IS NOT NULL AND (p_max_drawdown_tolerance < 0 OR p_max_drawdown_tolerance > 1) THEN
    RAISE EXCEPTION 'max_drawdown_tolerance must be between 0 and 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_liquidity_preference IS NOT NULL AND p_liquidity_preference NOT IN ('high','medium','low') THEN
    RAISE EXCEPTION 'liquidity_preference must be high, medium, or low'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_mandate_archetype IS NOT NULL AND length(p_mandate_archetype) > 500 THEN
    RAISE EXCEPTION 'mandate_archetype must be 500 characters or less'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_target_ticket_size_usd IS NOT NULL AND (p_target_ticket_size_usd < 0 OR p_target_ticket_size_usd > 1000000000) THEN
    RAISE EXCEPTION 'target_ticket_size_usd must be between 0 and 1,000,000,000'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Whitelist p_clear_fields entries.
  IF array_length(p_clear_fields, 1) IS NOT NULL THEN
    SELECT f INTO v_bad_field
    FROM unnest(p_clear_fields) AS t(f)
    WHERE f <> ALL (v_allowed_clear_fields);
    IF v_bad_field IS NOT NULL THEN
      RAISE EXCEPTION 'p_clear_fields contains disallowed field: %', v_bad_field
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- 4. UPSERT with COALESCE — NULL params preserve existing value; p_clear_fields
  --    explicitly nulls out the listed columns. Matches migration 061:176-210.
  INSERT INTO allocator_preferences (
    user_id,
    max_weight, preferred_strategy_types, excluded_exchanges,
    target_ticket_size_usd, mandate_archetype,
    correlation_ceiling, max_drawdown_tolerance, liquidity_preference,
    style_exclusions, edited_by_user_id, mandate_edited_at, updated_at
  ) VALUES (
    v_auth_uid,
    p_max_weight, p_preferred_strategy_types, p_excluded_exchanges,
    p_target_ticket_size_usd, p_mandate_archetype,
    p_correlation_ceiling, p_max_drawdown_tolerance, p_liquidity_preference,
    p_style_exclusions, NULL, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    max_weight                = CASE WHEN 'max_weight' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.max_weight, allocator_preferences.max_weight) END,
    preferred_strategy_types  = CASE WHEN 'preferred_strategy_types' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.preferred_strategy_types, allocator_preferences.preferred_strategy_types) END,
    excluded_exchanges        = CASE WHEN 'excluded_exchanges' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.excluded_exchanges, allocator_preferences.excluded_exchanges) END,
    target_ticket_size_usd    = CASE WHEN 'target_ticket_size_usd' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.target_ticket_size_usd, allocator_preferences.target_ticket_size_usd) END,
    mandate_archetype         = CASE WHEN 'mandate_archetype' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.mandate_archetype, allocator_preferences.mandate_archetype) END,
    correlation_ceiling       = CASE WHEN 'correlation_ceiling' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.correlation_ceiling, allocator_preferences.correlation_ceiling) END,
    max_drawdown_tolerance    = CASE WHEN 'max_drawdown_tolerance' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.max_drawdown_tolerance, allocator_preferences.max_drawdown_tolerance) END,
    liquidity_preference      = CASE WHEN 'liquidity_preference' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.liquidity_preference, allocator_preferences.liquidity_preference) END,
    style_exclusions          = CASE WHEN 'style_exclusions' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.style_exclusions, allocator_preferences.style_exclusions) END,
    edited_by_user_id         = NULL,  -- allocator self-edit marker
    mandate_edited_at         = now(), -- allocator-initiated write
    updated_at                = now();

  -- 5. Proactive rescore enqueue (D-12 Option B). Runs in the same transaction
  --    as the UPSERT so a rollback leaves no phantom job row. Single-inflight
  --    dedup handled by compute_jobs_one_inflight_per_kind_allocator partial
  --    unique index. Fires on every mandate write; no change detector
  --    (CONTEXT Claude's Discretion — simplest, partial unique index dedupes).
  PERFORM enqueue_compute_job(
    p_strategy_id     := NULL,
    p_kind            := 'rescore_allocator',
    p_idempotency_key := NULL,
    p_parent_job_ids  := '{}',
    p_exchange        := NULL,
    p_metadata        := NULL,
    p_allocator_id    := v_auth_uid
  );
END;
$$;

COMMENT ON FUNCTION public.update_allocator_mandates IS
  'Allocator self-service mandate write path (MANDATE-05 / MANDATE-06). SECURITY DEFINER; derives user_id from auth.uid(). Named parameters; NULL = "preserve existing value" (COALESCE). p_clear_fields TEXT[] whitelisted. After the UPSERT, appends a PERFORM enqueue_compute_job(kind=rescore_allocator) for proactive Phase 3 cache invalidation (D-12 Option B). See migration 062.';

REVOKE ALL ON FUNCTION public.update_allocator_mandates FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_allocator_mandates TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 9: Self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts every schema object from steps 1-8 is present. The SAVEPOINTed
-- RPC wrapper probe at the end exercises the full
-- enqueue_compute_job → _enqueue_compute_job_internal → INSERT path and the
-- partial unique index at migration apply time (T-03-B defense-in-depth).
DO $$
DECLARE
  v_column_exists BOOLEAN;
  v_kind_exists BOOLEAN;
  v_index_exists BOOLEAN;
  v_target_xor_def TEXT;
  v_kind_coherence_def TEXT;
  v_enqueue_signature TEXT;
  v_uam_body TEXT;
  v_anon_can_execute BOOLEAN;
  v_probe_allocator UUID := '00000000-0000-0000-0000-000000000001';
  v_inserted_job_id UUID;
  v_grabbed_kind TEXT;
  v_grabbed_allocator UUID;
  v_second_call_id UUID;
BEGIN
  -- (a) allocator_preferences.scoring_weight_overrides column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'allocator_preferences'
      AND column_name = 'scoring_weight_overrides'
  ) INTO v_column_exists;
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'Migration 062 failed: allocator_preferences.scoring_weight_overrides missing';
  END IF;

  -- (b) compute_jobs.allocator_id column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'compute_jobs'
      AND column_name = 'allocator_id'
  ) INTO v_column_exists;
  IF NOT v_column_exists THEN
    RAISE EXCEPTION 'Migration 062 failed: compute_jobs.allocator_id missing';
  END IF;

  -- (c) compute_jobs_target_xor CHECK references allocator_id
  SELECT pg_get_constraintdef(oid) INTO v_target_xor_def
    FROM pg_constraint WHERE conname = 'compute_jobs_target_xor';
  IF v_target_xor_def IS NULL OR v_target_xor_def NOT LIKE '%allocator_id%' THEN
    RAISE EXCEPTION 'Migration 062 failed: compute_jobs_target_xor does not reference allocator_id. Got: %', COALESCE(v_target_xor_def, '<null>');
  END IF;

  -- (d) compute_jobs_kind_target_coherence CHECK references rescore_allocator
  SELECT pg_get_constraintdef(oid) INTO v_kind_coherence_def
    FROM pg_constraint WHERE conname = 'compute_jobs_kind_target_coherence';
  IF v_kind_coherence_def IS NULL OR v_kind_coherence_def NOT LIKE '%rescore_allocator%' THEN
    RAISE EXCEPTION 'Migration 062 failed: compute_jobs_kind_target_coherence does not reference rescore_allocator. Got: %', COALESCE(v_kind_coherence_def, '<null>');
  END IF;

  -- (e) compute_jobs_one_inflight_per_kind_allocator partial unique index exists
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'compute_jobs'
      AND indexname = 'compute_jobs_one_inflight_per_kind_allocator'
  ) INTO v_index_exists;
  IF NOT v_index_exists THEN
    RAISE EXCEPTION 'Migration 062 failed: compute_jobs_one_inflight_per_kind_allocator index missing';
  END IF;

  -- (f) rescore_allocator registered in compute_job_kinds
  SELECT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'rescore_allocator'
  ) INTO v_kind_exists;
  IF NOT v_kind_exists THEN
    RAISE EXCEPTION 'Migration 062 failed: rescore_allocator not registered in compute_job_kinds';
  END IF;

  -- (g) update_allocator_mandates body invokes enqueue_compute_job + auth.uid()
  SELECT pg_get_functiondef(oid) INTO v_uam_body
    FROM pg_proc WHERE proname = 'update_allocator_mandates';
  IF v_uam_body IS NULL OR v_uam_body NOT LIKE '%enqueue_compute_job%' THEN
    RAISE EXCEPTION 'Migration 062 failed: update_allocator_mandates body does not call enqueue_compute_job';
  END IF;
  IF v_uam_body NOT LIKE '%auth.uid()%' THEN
    RAISE EXCEPTION 'Migration 062 failed: update_allocator_mandates body does not reference auth.uid()';
  END IF;

  -- (h) enqueue_compute_job signature contains p_allocator_id
  SELECT pg_get_function_arguments(oid) INTO v_enqueue_signature
    FROM pg_proc WHERE proname = 'enqueue_compute_job' AND pronargs = 7;
  IF v_enqueue_signature IS NULL OR v_enqueue_signature NOT LIKE '%p_allocator_id%' THEN
    RAISE EXCEPTION 'Migration 062 failed: enqueue_compute_job signature does not contain p_allocator_id. Got: %', COALESCE(v_enqueue_signature, '<null>');
  END IF;

  -- (i) anon role does NOT have EXECUTE on the new enqueue_compute_job signature
  --     (ADR-0001 RLS baseline + T-03-A elevation-of-privilege mitigation).
  SELECT has_function_privilege('anon', 'public.enqueue_compute_job(uuid, text, text, uuid[], text, jsonb, uuid)', 'EXECUTE')
    INTO v_anon_can_execute;
  IF v_anon_can_execute THEN
    RAISE EXCEPTION 'Migration 062 failed: anon has EXECUTE on enqueue_compute_job — ADR-0001 violated';
  END IF;

  -- (j) Full RPC wrapper probe. Exercises enqueue_compute_job →
  --     _enqueue_compute_job_internal → INSERT path and the partial unique
  --     index end-to-end. Catches f2-class bugs (undeclared variable, wrong
  --     signature, missing GRANT) at migration-apply time. Probe state is
  --     cleaned up explicitly at the end because PL/pgSQL does NOT allow
  --     SAVEPOINT/ROLLBACK TO inside a DO block (transaction-control
  --     statements are reserved for the outer BEGIN/COMMIT brackets).

  -- Need an auth.users row for the FK on compute_jobs.allocator_id. Insert a
  -- sentinel user for the probe. Cleaned up at the end of the DO block.
  INSERT INTO auth.users (id, email) VALUES (v_probe_allocator, 'migration-062-probe@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  -- Call the RPC wrapper directly (what update_allocator_mandates calls in prod).
  v_inserted_job_id := enqueue_compute_job(
    p_strategy_id     := NULL,
    p_kind            := 'rescore_allocator',
    p_allocator_id    := v_probe_allocator
  );

  -- Verify the row landed with the right shape.
  SELECT kind, allocator_id INTO v_grabbed_kind, v_grabbed_allocator
  FROM compute_jobs WHERE id = v_inserted_job_id;

  IF v_grabbed_kind IS DISTINCT FROM 'rescore_allocator'
     OR v_grabbed_allocator IS DISTINCT FROM v_probe_allocator THEN
    RAISE EXCEPTION 'Migration 062 failed: RPC wrapper produced wrong row: kind=%, allocator_id=%', v_grabbed_kind, v_grabbed_allocator;
  END IF;

  -- Second wrapper call should return the same id (optimistic look-up).
  v_second_call_id := enqueue_compute_job(
    p_strategy_id     := NULL,
    p_kind            := 'rescore_allocator',
    p_allocator_id    := v_probe_allocator
  );
  IF v_second_call_id IS DISTINCT FROM v_inserted_job_id THEN
    RAISE EXCEPTION 'Migration 062 failed: second enqueue should return same job id (got % vs %)',
      v_second_call_id, v_inserted_job_id;
  END IF;

  -- Raw duplicate INSERT must trip the partial unique index. The BEGIN
  -- block below acts as a subtransaction so the caught unique_violation
  -- does not abort the outer DO block.
  BEGIN
    INSERT INTO compute_jobs (allocator_id, kind, status)
      VALUES (v_probe_allocator, 'rescore_allocator', 'pending');
    RAISE EXCEPTION 'Migration 062 failed: raw duplicate INSERT should have hit compute_jobs_one_inflight_per_kind_allocator unique violation';
  EXCEPTION
    WHEN unique_violation THEN
      -- Expected — partial unique index working as designed.
      NULL;
  END;

  -- Explicit cleanup: remove probe job rows + sentinel user. Order matters
  -- — compute_jobs.allocator_id FK ON DELETE CASCADE would also clean up
  -- the job rows when we delete the auth.users row, but deleting job rows
  -- first keeps intent explicit.
  DELETE FROM compute_jobs WHERE allocator_id = v_probe_allocator;
  DELETE FROM auth.users WHERE id = v_probe_allocator;

  RAISE NOTICE 'Migration 062: scoring_weight_overrides + compute_jobs allocator_id + rescore_allocator kind verified.';
END
$$;

COMMIT;
