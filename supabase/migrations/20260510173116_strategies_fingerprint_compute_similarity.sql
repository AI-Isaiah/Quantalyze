-- Migration 105: Phase 19 / FINGERPRINT-01 + FINGERPRINT-02
-- strategies.fingerprint JSONB column + partial index + version=1 CHECK
-- (FINGERPRINT-01) and compute_similarity(JSONB, JSONB) IMMUTABLE PARALLEL
-- SAFE cosine function returning NUMERIC(5,4) (FINGERPRINT-02).
--
-- v0 plain plpgsql cosine over a 46-dim concatenated component vector.
-- pgvector explicitly deferred to v2 per UC-C.
--
-- Phase 19 Pitfall 9: this migration MUST NOT contain CREATE EXTENSION
-- vector or vector(N) type references — pgvector is deferred to v2 per UC-C.
--
-- M-3 — explicit NULL guard on the version CHECK. The naive
--   ((fingerprint->>'version')::INT = 1)
-- accepts a fingerprint with NULL version key because `NULL = 1` is NULL
-- (not FALSE), which Postgres treats as constraint-satisfied. Wrap in
-- IS NOT NULL guard.
--
-- M-4 — the partial index is retained for v0; PK column under partial
-- predicate has minimal benefit on its own, but supports future v2
-- similarity queries (compute_similarity over WHERE fingerprint IS NOT NULL).
-- Document rationale so future reviewers can drop in a follow-up if
-- benchmarks show zero benefit.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1 — strategies.fingerprint column + version CHECK + partial index
-- ==========================================================================
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS fingerprint JSONB;

-- M-3: Explicit NULL-guard. The original draft `(fingerprint->>'version')::INT = 1`
-- accepts a fingerprint with NULL version key because `NULL = 1` is NULL (not FALSE),
-- which Postgres treats as constraint-satisfied. Wrap in IS NOT NULL guard.
ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_fingerprint_version_check;
ALTER TABLE strategies
  ADD CONSTRAINT strategies_fingerprint_version_check
  CHECK (
    fingerprint IS NULL
    OR (
      (fingerprint->>'version') IS NOT NULL
      AND (fingerprint->>'version')::INT = 1
    )
  );

-- I-perf-2 — partial GIN index on the fingerprint JSONB. The pre-fix
-- partial index on `(id) WHERE fingerprint IS NOT NULL` indexed the PK
-- column under a partial predicate with minimal benefit (the PK already
-- has a unique btree). The replacement GIN index supports actual
-- containment / lookup queries on the JSONB body — which is what the
-- v2 similarity ranker will need. Partial WHERE keeps the index size
-- bounded to populated rows.
CREATE INDEX IF NOT EXISTS strategies_fingerprint_gin_idx
  ON strategies USING gin (fingerprint) WHERE fingerprint IS NOT NULL;
-- Drop the old btree-on-id partial that this replaces. Idempotent on
-- DBs that already had it dropped or never built it.
DROP INDEX IF EXISTS strategies_fingerprint_partial_idx;

COMMENT ON COLUMN strategies.fingerprint IS
  'Phase 19 / FINGERPRINT-01. v0 placeholder; pgvector explicitly deferred to v2 per UC-C. Shape: {version: 1, trade_size_buckets: [4 floats], hold_duration_buckets: [4 floats], asset_class_mix: [4 floats], instrument_concentration: [10 floats], temporal_pattern: [24 floats]}.';
COMMENT ON INDEX strategies_fingerprint_gin_idx IS
  'Phase 19 / FINGERPRINT-01 / I-perf-2. GIN over the JSONB fingerprint body, partial WHERE fingerprint IS NOT NULL. Replaces the prior btree-on-id partial which had minimal benefit (the PK already covers id).';

-- ==========================================================================
-- STEP 2 — compute_similarity cosine function (FINGERPRINT-02)
-- ==========================================================================
-- v0 plain plpgsql cosine over the 46-dim concatenated component vector
-- (4 + 4 + 4 + 10 + 24). IMMUTABLE PARALLEL SAFE so the planner can fold
-- it into queries safely. Returns 0.0 on NULL or shape mismatch — never
-- raises (defense-in-depth for the public-facing similarity ranker).
CREATE OR REPLACE FUNCTION compute_similarity(a JSONB, b JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE PARALLEL SAFE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_a_vec NUMERIC[];
  v_b_vec NUMERIC[];
  v_dot   NUMERIC := 0;
  v_norm_a NUMERIC := 0;
  v_norm_b NUMERIC := 0;
  i INT;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0.0; END IF;
  IF (a->>'version')::INT IS DISTINCT FROM 1 THEN RETURN 0.0; END IF;
  IF (b->>'version')::INT IS DISTINCT FROM 1 THEN RETURN 0.0; END IF;

  -- Build 46-dim vector by concatenation of 5 components (4+4+4+10+24).
  WITH parts AS (
    SELECT
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'trade_size_buckets')        AS e) AS a1,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'hold_duration_buckets')     AS e) AS a2,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'asset_class_mix')           AS e) AS a3,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'instrument_concentration')  AS e) AS a4,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'temporal_pattern')          AS e) AS a5,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'trade_size_buckets')        AS e) AS b1,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'hold_duration_buckets')     AS e) AS b2,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'asset_class_mix')           AS e) AS b3,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'instrument_concentration')  AS e) AS b4,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'temporal_pattern')          AS e) AS b5
  )
  SELECT a1 || a2 || a3 || a4 || a5, b1 || b2 || b3 || b4 || b5
    INTO v_a_vec, v_b_vec
    FROM parts;

  IF v_a_vec IS NULL OR v_b_vec IS NULL THEN RETURN 0.0; END IF;
  IF array_length(v_a_vec, 1) <> 46 OR array_length(v_b_vec, 1) <> 46 THEN RETURN 0.0; END IF;

  FOR i IN 1..46 LOOP
    v_dot    := v_dot    + v_a_vec[i] * v_b_vec[i];
    v_norm_a := v_norm_a + v_a_vec[i] * v_a_vec[i];
    v_norm_b := v_norm_b + v_b_vec[i] * v_b_vec[i];
  END LOOP;

  IF v_norm_a = 0 OR v_norm_b = 0 THEN RETURN 0.0; END IF;

  RETURN GREATEST(0.0, LEAST(1.0, v_dot / (sqrt(v_norm_a) * sqrt(v_norm_b))))::NUMERIC(5,4);
EXCEPTION
  WHEN OTHERS THEN
    RETURN 0.0;
END;
$$;

COMMENT ON FUNCTION compute_similarity IS
  'Phase 19 / FINGERPRINT-02. v0 plain plpgsql cosine on 46-dim concatenated component vector. pgvector explicitly deferred to v2 per UC-C. Returns 0.0 on NULL or version mismatch — never errors.';

REVOKE EXECUTE ON FUNCTION compute_similarity(JSONB, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION compute_similarity(JSONB, JSONB) TO authenticated, service_role;

-- ==========================================================================
-- STEP 3 — Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_col_exists BOOLEAN;
  v_idx_exists BOOLEAN;
  v_idx_is_gin BOOLEAN;
  v_check_exists BOOLEAN;
  v_func_volatile CHAR(1);
  v_func_parallel CHAR(1);
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='strategies' AND column_name='fingerprint'
  ) INTO v_col_exists;
  IF NOT v_col_exists THEN RAISE EXCEPTION 'Migration 105: fingerprint column missing'; END IF;

  -- CT-1 (army2): the self-verify originally checked the dropped
  -- partial-btree index name, but I-perf-2 (this same migration) renamed
  -- the index to strategies_fingerprint_gin_idx. Fresh applies would
  -- always raise. Lock both the rename AND the index type (USING gin)
  -- so a future regression cannot silently revert to a btree.
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND indexname='strategies_fingerprint_gin_idx'
       AND indexdef LIKE '%USING gin%'
  ) INTO v_idx_is_gin;
  IF NOT v_idx_is_gin THEN
    RAISE EXCEPTION 'Migration 105: strategies_fingerprint_gin_idx missing or not USING gin';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM information_schema.check_constraints
     WHERE constraint_name='strategies_fingerprint_version_check'
  ) INTO v_check_exists;
  IF NOT v_check_exists THEN RAISE EXCEPTION 'Migration 105: version CHECK missing'; END IF;

  SELECT p.provolatile, p.proparallel INTO v_func_volatile, v_func_parallel
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname='public' AND p.proname='compute_similarity';
  IF v_func_volatile <> 'i' THEN RAISE EXCEPTION 'Migration 105: compute_similarity is not IMMUTABLE (got %)', v_func_volatile; END IF;
  IF v_func_parallel <> 's' THEN RAISE EXCEPTION 'Migration 105: compute_similarity is not PARALLEL SAFE (got %)', v_func_parallel; END IF;

  RAISE NOTICE 'Migration 105: all assertions passed.';
END $$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 105
-- ==========================================================================
