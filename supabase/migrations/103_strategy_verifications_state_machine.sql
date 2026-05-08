-- Migration 103: Phase 19 / BACKBONE-03 + BACKBONE-07
-- strategy_verifications state-machine completion via
-- transition_strategy_verification SECURITY DEFINER RPC + 4 new columns.
--
-- Why this migration exists
-- -------------------------
-- Phase 19 unifies the API-key + CSV ingestion paths into a single backbone.
-- Adapter code MUST stop direct-UPDATE'ing strategy_verifications.status —
-- every status transition flows through this RPC, which:
--   - Locks the row (FOR UPDATE) so concurrent callers serialize
--   - Validates against a hard-coded legal-pair table
--   - Stamps transitioned_at = now() on every successful transition
--   - Merges metadata into respective columns (metrics_snapshot, errors,
--     encrypted_credentials, correlation_id)
--   - Returns the post-update row as JSONB
--
-- New columns (Pitfall 7 mitigation):
--   transitioned_at        — single source of truth for status changes
--   encrypted_credentials  — Phase 19 unified backbone holds API keys here
--   public_token           — first-class column (NOT JSONB-nested) so
--                            verify-strategy/[id]/status keeps reading by name
--   expires_at             — first-class column for the same reason
--
-- The VIEW shim ships in migration 107; this migration's columns are what
-- the VIEW maps to so the route handler at /api/verify-strategy/[id]/status
-- (line 18-22) keeps surfacing public_token + expires_at as plain columns.
--
-- Hardened against C-1/C-2/C-3 (mirrors migration 086 H-B pattern).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: Add new columns (idempotent, IF NOT EXISTS)
-- ==========================================================================
ALTER TABLE strategy_verifications
  ADD COLUMN IF NOT EXISTS transitioned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS encrypted_credentials JSONB,
  ADD COLUMN IF NOT EXISTS public_token TEXT,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Public token uniqueness (only when populated) — VIEW shim relies on this
-- being globally unique so a token lookup returns the unambiguous row.
CREATE UNIQUE INDEX IF NOT EXISTS strategy_verifications_public_token_unique_idx
  ON strategy_verifications (public_token)
  WHERE public_token IS NOT NULL;

COMMENT ON COLUMN strategy_verifications.transitioned_at IS
  'Phase 19 / BACKBONE-03 — updated by transition_strategy_verification RPC; single source of truth for status changes. Adapter code MUST NOT direct-UPDATE status.';
COMMENT ON COLUMN strategy_verifications.encrypted_credentials IS
  'Phase 19 / BACKBONE-03 — Phase 19 unified backbone stores per-verification encrypted credentials JSONB blob (merged in via RPC metadata->>encrypted_credentials).';
COMMENT ON COLUMN strategy_verifications.public_token IS
  'Phase 19 / Pitfall 7 — first-class column (NOT JSONB nested). The verify-strategy/[id]/status route reads this by column name; the migration 107 VIEW maps it as a column too.';
COMMENT ON COLUMN strategy_verifications.expires_at IS
  'Phase 19 / Pitfall 7 — first-class column for token expiry. See public_token.';

-- ==========================================================================
-- STEP 2: transition_strategy_verification RPC
-- ==========================================================================
-- Legal transitions (hard-coded inside the RPC body):
--   draft            → validated
--   validated        → metrics_captured
--   metrics_captured → encrypted
--   encrypted        → report_queued
--   report_queued    → published
--   *                → draft  (when metadata->>'errors' IS NOT NULL — restart path)
--
-- SECURITY DEFINER + SET search_path = public, pg_temp matches migration
-- 086 H-B hardening (prevents privilege-escalation via search_path pollution).
-- REVOKE ALL FROM PUBLIC, anon — service_role and authenticated only.
CREATE OR REPLACE FUNCTION transition_strategy_verification(
  p_verification_id UUID,
  p_new_status      TEXT,
  p_metadata        JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row strategy_verifications%ROWTYPE;
  v_legal BOOLEAN;
  v_legal_pairs CONSTANT TEXT[][] := ARRAY[
    ARRAY['draft','validated'],
    ARRAY['validated','metrics_captured'],
    ARRAY['metrics_captured','encrypted'],
    ARRAY['encrypted','report_queued'],
    ARRAY['report_queued','published']
  ];
  v_pair TEXT[];
  v_metrics_snapshot JSONB;
  v_errors JSONB;
  v_encrypted JSONB;
  v_correlation_id UUID;
  v_result JSONB;
BEGIN
  -- Acquire row lock (FOR UPDATE serializes concurrent transitions)
  SELECT * INTO v_row
    FROM strategy_verifications
   WHERE id = p_verification_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'strategy_verification % not found', p_verification_id
      USING ERRCODE = '22023';
  END IF;

  -- Legal-transition check
  v_legal := FALSE;
  FOREACH v_pair SLICE 1 IN ARRAY v_legal_pairs LOOP
    IF v_row.status = v_pair[1] AND p_new_status = v_pair[2] THEN
      v_legal := TRUE;
      EXIT;
    END IF;
  END LOOP;

  -- Restart path: any → draft when metadata has errors (idempotent;
  -- supports the synchronous /process-key router validate-failure path
  -- where draft → draft re-records the error without changing status).
  IF NOT v_legal AND p_new_status = 'draft' AND p_metadata IS NOT NULL AND p_metadata ? 'errors' THEN
    v_legal := TRUE;
  END IF;

  IF NOT v_legal THEN
    RAISE EXCEPTION 'illegal transition % → % for verification %',
      v_row.status, p_new_status, p_verification_id
      USING ERRCODE = '22023';
  END IF;

  -- Merge metadata into respective columns (COALESCE preserves prior values
  -- when the caller does not supply that key).
  v_metrics_snapshot := COALESCE(p_metadata->'metrics_snapshot', v_row.metrics_snapshot);
  v_errors           := COALESCE(p_metadata->'errors', v_row.errors);
  v_encrypted        := COALESCE(p_metadata->'encrypted_credentials', v_row.encrypted_credentials);
  -- correlation_id is UUID — cast text-from-JSONB safely
  IF p_metadata IS NOT NULL AND p_metadata ? 'correlation_id' THEN
    v_correlation_id := (p_metadata->>'correlation_id')::UUID;
  ELSE
    v_correlation_id := v_row.correlation_id;
  END IF;

  UPDATE strategy_verifications
     SET status                 = p_new_status,
         transitioned_at        = now(),
         metrics_snapshot       = v_metrics_snapshot,
         errors                 = v_errors,
         encrypted_credentials  = v_encrypted,
         correlation_id         = v_correlation_id,
         updated_at             = now()
   WHERE id = p_verification_id
   RETURNING to_jsonb(strategy_verifications.*) INTO v_result;

  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION transition_strategy_verification IS
  'Phase 19 / BACKBONE-03. Single source of truth for strategy_verifications status changes. Adapter MUST NOT direct-UPDATE status. SECURITY DEFINER + SET search_path = public, pg_temp (mirrors migration 086 H-B).';

REVOKE EXECUTE ON FUNCTION transition_strategy_verification(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION transition_strategy_verification(UUID, TEXT, JSONB) TO authenticated, service_role;

-- ==========================================================================
-- STEP 3: Self-verifying DO block (mirror migration 093 STEP 7)
-- ==========================================================================
DO $$
DECLARE
  v_col_count INT;
  v_idx_exists BOOLEAN;
  v_fn_exists BOOLEAN;
  v_secdef BOOLEAN;
  v_search_path_ok BOOLEAN;
BEGIN
  -- (a) 4 new columns present
  SELECT count(*) INTO v_col_count
    FROM information_schema.columns
   WHERE table_schema='public'
     AND table_name='strategy_verifications'
     AND column_name IN ('transitioned_at','encrypted_credentials','public_token','expires_at');
  IF v_col_count <> 4 THEN
    RAISE EXCEPTION 'Migration 103 failed: expected 4 new columns, found %', v_col_count;
  END IF;

  -- (b) public_token unique partial index present
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
     WHERE schemaname='public'
       AND tablename='strategy_verifications'
       AND indexname='strategy_verifications_public_token_unique_idx'
  ) INTO v_idx_exists;
  IF NOT v_idx_exists THEN
    RAISE EXCEPTION 'Migration 103 failed: strategy_verifications_public_token_unique_idx missing';
  END IF;

  -- (c) RPC registered with 3 args returning JSONB
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname='public'
       AND p.proname='transition_strategy_verification'
       AND p.pronargs = 3
  ) INTO v_fn_exists;
  IF NOT v_fn_exists THEN
    RAISE EXCEPTION 'Migration 103 failed: transition_strategy_verification RPC not 3-arg';
  END IF;

  -- (d) SECURITY DEFINER on the function
  SELECT p.prosecdef INTO v_secdef
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname='public' AND p.proname='transition_strategy_verification';
  IF NOT COALESCE(v_secdef, FALSE) THEN
    RAISE EXCEPTION 'Migration 103 failed: transition_strategy_verification not SECURITY DEFINER';
  END IF;

  -- (e) search_path hardened (H-B parity with migration 086)
  SELECT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname='public'
       AND p.proname='transition_strategy_verification'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) INTO v_search_path_ok;
  IF NOT v_search_path_ok THEN
    RAISE EXCEPTION 'Migration 103 failed: transition_strategy_verification missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  RAISE NOTICE 'Migration 103: all assertions passed.';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 103
-- ==========================================================================
