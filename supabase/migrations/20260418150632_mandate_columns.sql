-- Migration 061: mandate columns on allocator_preferences + update_allocator_mandates RPC
-- + drop allocator_prefs_self_update RLS policy (MANDATE-06 enforcement Option A).
-- Sprint 8 / Phase 2 — Mandate Profile Builder.
--
-- What this does
-- --------------
-- 1. Adds 5 nullable columns to allocator_preferences: max_weight,
--    correlation_ceiling, liquidity_preference, style_exclusions,
--    mandate_edited_at. All default NULL. No backfill (D-09).
-- 2. Adds CHECK (liquidity_preference IS NULL OR IN ('high','medium','low')) with
--    DROP IF EXISTS idempotency guard.
-- 3. DROPS the existing allocator_prefs_self_update RLS policy from migration 011.
--    ROADMAP Phase 2 SC4 Option A: "Direct SQL UPDATE by a non-admin fails; only
--    update_allocator_mandates(...) succeeds for auth.uid()." This becomes true
--    at the DB level once the self-update policy is removed. Admin direct UPDATE
--    continues to work via allocator_prefs_admin_all (FOR ALL, USING/WITH CHECK
--    is_admin). The SECURITY DEFINER RPC runs as function-owner and bypasses
--    RLS for its UPSERT body — removing the self-update policy does not affect
--    it. The existing allocator_prefs_self_insert policy remains so first-visit
--    upserts via the RPC still succeed on the INSERT path.
-- 4. Creates public.update_allocator_mandates(...) SECURITY DEFINER RPC
--    — the exclusive allocator write path (MANDATE-05, MANDATE-06).
--    Named parameters (matches finalize_wizard_strategy / log_audit_event
--    convention). p_clear_fields TEXT[] DEFAULT '{}' is the Reset escape
--    hatch for D-11 — field names listed here are UPDATEd to NULL
--    regardless of their corresponding parameter value.
-- 5. Self-verifying DO block asserts columns, CHECK, RPC presence,
--    prosecdef = TRUE, AND that allocator_prefs_self_update no longer
--    exists in pg_policies.
--
-- What this does NOT do
-- ---------------------
-- - No changes to allocator_prefs_self_read / allocator_prefs_self_insert /
--   allocator_prefs_admin_read / allocator_prefs_admin_all / allocator_prefs_service_all
--   RLS policies. Only allocator_prefs_self_update is dropped.
-- - No new preferred_strategy_types column — already exists from 011.
-- - No new max_drawdown_tolerance column — already exists; D-06 reuses it.
-- - No log_audit_event PERFORM inside the RPC — emission stays in the
--   route handler via logAuditEvent() per RESEARCH.md Audit Integration.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: Add five mandate columns on allocator_preferences
-- --------------------------------------------------------------------------
-- All nullable with no default (D-09 first-visit renders blank).
ALTER TABLE allocator_preferences
  ADD COLUMN IF NOT EXISTS max_weight NUMERIC,
  ADD COLUMN IF NOT EXISTS correlation_ceiling NUMERIC,
  ADD COLUMN IF NOT EXISTS liquidity_preference TEXT,
  ADD COLUMN IF NOT EXISTS style_exclusions TEXT[],
  ADD COLUMN IF NOT EXISTS mandate_edited_at TIMESTAMPTZ;

COMMENT ON COLUMN allocator_preferences.max_weight IS
  'Largest share of portfolio any single strategy can hold. Fraction 0-1 (0.25 = 25%). NULL = no constraint. Bounds enforced at app layer (0.05-0.50 per D-17) + RPC guard. Phase 2 / MANDATE-01.';
COMMENT ON COLUMN allocator_preferences.correlation_ceiling IS
  'Max pairwise correlation across allocations. 0-1 (0.6 default UI hint; column NULL = no constraint). Phase 2 / MANDATE-03.';
COMMENT ON COLUMN allocator_preferences.liquidity_preference IS
  'Minimum strategy AUM tier: high (>$10M), medium ($1M-$10M), low (<$1M). NULL = no constraint. Phase 3 compute_mandate_fit_score() owns the AUM threshold mapping. Phase 2 / MANDATE-03.';
COMMENT ON COLUMN allocator_preferences.style_exclusions IS
  'Sub-strategies to filter out at scoring time. TEXT[] of SUBTYPES values from src/lib/constants.ts. NULL = no filter. Phase 2 / MANDATE-03.';
COMMENT ON COLUMN allocator_preferences.mandate_edited_at IS
  'Last allocator-initiated mandate write (RPC). Separate from updated_at so admin edits do not bump the allocator-facing "Last saved" UI. Phase 2 / MANDATE-04.';

-- --------------------------------------------------------------------------
-- STEP 2: CHECK constraint on liquidity_preference (idempotent)
-- --------------------------------------------------------------------------
ALTER TABLE allocator_preferences
  DROP CONSTRAINT IF EXISTS allocator_preferences_liquidity_preference_check;

ALTER TABLE allocator_preferences
  ADD CONSTRAINT allocator_preferences_liquidity_preference_check
    CHECK (liquidity_preference IS NULL OR liquidity_preference IN ('high', 'medium', 'low'));

-- --------------------------------------------------------------------------
-- STEP 3: DROP allocator_prefs_self_update RLS policy (MANDATE-06 Option A)
-- --------------------------------------------------------------------------
-- MANDATE-06 enforcement (ROADMAP Phase 2 Success Criterion 4, Option A):
-- The authenticated allocator role can no longer direct-UPDATE allocator_preferences.
-- All allocator writes must go through public.update_allocator_mandates() which
-- runs SECURITY DEFINER and bypasses RLS via function-owner privileges.
--
-- Admin direct UPDATE is unaffected: allocator_prefs_admin_all (migration 011
-- line 249) uses FOR ALL with USING/WITH CHECK is_admin, which still matches
-- for admin users.
--
-- First-visit UPSERT path: the SECURITY DEFINER RPC issues an INSERT; RLS is
-- bypassed by function-owner privileges so allocator_prefs_self_insert is not
-- required for the RPC path. We keep allocator_prefs_self_insert anyway so
-- future direct INSERTs (none currently) remain constrained to owner.
DROP POLICY IF EXISTS allocator_prefs_self_update ON allocator_preferences;

-- --------------------------------------------------------------------------
-- STEP 4: update_allocator_mandates SECURITY DEFINER RPC
-- --------------------------------------------------------------------------
-- Named parameters (finalize_wizard_strategy / log_audit_event convention).
-- p_clear_fields TEXT[] is the Reset escape hatch (D-11) — whitelisted to
-- mandate fields only; listed fields get NULL regardless of their parameter
-- value. All other NULL params preserve the existing column value (COALESCE).
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
  -- 1. Auth guard (SQLSTATE 28000 maps to HTTP 401 in route handler)
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'update_allocator_mandates: no auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Bounds validation (SQLSTATE 22023 maps to HTTP 400).
  --    Mirrors TypeScript validateSelfEditableInput (D-18 double-check).
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

  -- 3. Whitelist p_clear_fields entries so a caller cannot set arbitrary
  --    columns (e.g. 'founder_notes') to NULL.
  IF array_length(p_clear_fields, 1) IS NOT NULL THEN
    SELECT f INTO v_bad_field
    FROM unnest(p_clear_fields) AS t(f)
    WHERE f <> ALL (v_allowed_clear_fields);
    IF v_bad_field IS NOT NULL THEN
      RAISE EXCEPTION 'p_clear_fields contains disallowed field: %', v_bad_field
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- 4. UPSERT with COALESCE — a NULL parameter preserves the existing value
  --    (silent no-op). The Reset path uses p_clear_fields to explicitly
  --    null out a column regardless of the parameter value (Pitfall 1).
  --    edited_by_user_id = NULL tags this as an allocator self-edit;
  --    admin direct UPDATE sets it to the acting admin's id.
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
    edited_by_user_id         = NULL,  -- allocator self-edit marker (D-14)
    mandate_edited_at         = now(), -- D-08: allocator-initiated write
    updated_at                = now();
END;
$$;

COMMENT ON FUNCTION public.update_allocator_mandates IS
  'Allocator self-service mandate write path (MANDATE-05 / MANDATE-06). SECURITY DEFINER; derives user_id from auth.uid(). Named parameters; NULL = "preserve existing value" (COALESCE). p_clear_fields TEXT[] whitelisted to mandate columns only — listed fields get UPDATE ... = NULL regardless of parameter value (D-11 Reset). Raises SQLSTATE 28000 on missing auth, 22023 on out-of-range input. Companion to migration 061 which drops allocator_prefs_self_update so this RPC is literally the only write path for allocators. See ADR-0023.';

REVOKE ALL ON FUNCTION public.update_allocator_mandates FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_allocator_mandates TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 5: Self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  col_count INTEGER;
  fn_exists BOOLEAN;
  fn_secdef BOOLEAN;
  check_exists BOOLEAN;
  self_update_policy_exists BOOLEAN;
BEGIN
  -- 1. All 5 new columns exist on allocator_preferences
  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'allocator_preferences'
    AND column_name IN ('max_weight','correlation_ceiling','liquidity_preference','style_exclusions','mandate_edited_at');
  IF col_count < 5 THEN
    RAISE EXCEPTION 'Migration 061 failed: expected 5 new columns on allocator_preferences, found %', col_count;
  END IF;

  -- 2. CHECK constraint on liquidity_preference exists
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'allocator_preferences_liquidity_preference_check'
  ) INTO check_exists;
  IF NOT check_exists THEN
    RAISE EXCEPTION 'Migration 061 failed: liquidity_preference CHECK constraint missing';
  END IF;

  -- 3. update_allocator_mandates RPC exists and is SECURITY DEFINER
  SELECT
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
             WHERE n.nspname = 'public' AND p.proname = 'update_allocator_mandates'),
    COALESCE(
      (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
         WHERE n.nspname = 'public' AND p.proname = 'update_allocator_mandates'),
      FALSE)
  INTO fn_exists, fn_secdef;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'Migration 061 failed: update_allocator_mandates function missing';
  END IF;
  IF NOT fn_secdef THEN
    RAISE EXCEPTION 'Migration 061 failed: update_allocator_mandates is not SECURITY DEFINER';
  END IF;

  -- 4. allocator_prefs_self_update policy must NO LONGER exist (MANDATE-06 Option A)
  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'allocator_preferences'
      AND policyname = 'allocator_prefs_self_update'
  ) INTO self_update_policy_exists;
  IF self_update_policy_exists THEN
    RAISE EXCEPTION 'Migration 061 failed: allocator_prefs_self_update policy still exists — MANDATE-06 not enforced';
  END IF;

  RAISE NOTICE 'Migration 061: mandate columns + update_allocator_mandates RPC + self-update RLS removed verified.';
END
$$;

COMMIT;
