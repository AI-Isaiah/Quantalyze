-- Test: upsert_strategy_analytics_series_batch privilege posture.
--
-- audit-2026-05-07 H-0762 (PR-2 2026-05-28):
--   The MagicMock-backed Python test at
--   analytics-service/tests/test_analytics_runner.py:2774-2812 records
--   call shape but proves nothing about who is allowed to call the RPC.
--   A future migration flipping SECURITY DEFINER to SECURITY INVOKER, or
--   widening EXECUTE to authenticated/anon, would not be caught by any
--   existing test.
--
-- Asserted invariants (against the live database state, no mocks):
--   1. The function is SECURITY DEFINER (prosecdef = true).
--   2. service_role has EXECUTE.
--   3. PUBLIC, anon, and authenticated do NOT have EXECUTE.
--   4. search_path is locked to (public, pg_temp).
--
-- Run order: AFTER migration 20260428120919_strategy_analytics_series.sql
-- has been applied (which establishes the canonical GRANT/REVOKE posture
-- at lines 230-231).

BEGIN;

SELECT set_config(
  'request.jwt.claims',
  '{"role":"service_role"}',
  true
);

-- --------------------------------------------------------------------------
-- Test 1: SECURITY DEFINER posture
--
-- PR-2 reviewer #2 (2026-05-28): overload-drift defense — assert EXACTLY ONE
-- function matches the canonical (uuid, text[], jsonb) signature. A future
-- migration that adds a sibling overload would silently land a second pg_proc
-- row; without the count guard, Tests 2/3 would target the original signature
-- while production code might hit the new overload bypassing the privilege
-- posture.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  is_secdef BOOLEAN;
  match_count INT;
BEGIN
  SELECT COUNT(*),
         bool_and(p.prosecdef)
    INTO match_count, is_secdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'upsert_strategy_analytics_series_batch'
     AND pg_get_function_identity_arguments(p.oid) = 'uuid, text[], jsonb';

  IF match_count = 0 THEN
    RAISE EXCEPTION
      'H-0762 Test 1: upsert_strategy_analytics_series_batch(uuid, text[], jsonb) does not exist (overload drift?)';
  END IF;
  IF match_count > 1 THEN
    RAISE EXCEPTION
      'H-0762 Test 1: upsert_strategy_analytics_series_batch(uuid, text[], jsonb) matched % rows — schema corruption',
      match_count;
  END IF;
  IF is_secdef IS NOT TRUE THEN
    RAISE EXCEPTION
      'H-0762 Test 1: upsert_strategy_analytics_series_batch is NOT SECURITY DEFINER (prosecdef=%, expected true)',
      is_secdef;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 2: service_role has EXECUTE
-- --------------------------------------------------------------------------
DO $$
DECLARE
  service_can_execute BOOLEAN;
BEGIN
  SELECT has_function_privilege(
    'service_role',
    'public.upsert_strategy_analytics_series_batch(uuid, text[], jsonb)',
    'EXECUTE'
  ) INTO service_can_execute;

  IF service_can_execute IS NOT TRUE THEN
    RAISE EXCEPTION
      'H-0762 Test 2: service_role lacks EXECUTE on upsert_strategy_analytics_series_batch';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 3: PUBLIC, anon, authenticated do NOT have EXECUTE
--
-- PR-2 reviewer #7 (2026-05-28): the prior PUBLIC check was both a
-- tautological boolean expression AND never asserted on (computed
-- public_can_execute but never raised). Replaced with a direct proacl-token
-- scan: an entry like `=X/owner` (PUBLIC role) or `=/owner` shorthand
-- indicates GRANT EXECUTE TO PUBLIC. Combined with the role-specific
-- has_function_privilege checks below, this catches both direct GRANTs
-- and PUBLIC inheritance.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  anon_can_execute BOOLEAN;
  auth_can_execute BOOLEAN;
  proacl_has_public BOOLEAN;
BEGIN
  SELECT has_function_privilege(
    'anon',
    'public.upsert_strategy_analytics_series_batch(uuid, text[], jsonb)',
    'EXECUTE'
  ) INTO anon_can_execute;
  SELECT has_function_privilege(
    'authenticated',
    'public.upsert_strategy_analytics_series_batch(uuid, text[], jsonb)',
    'EXECUTE'
  ) INTO auth_can_execute;
  -- Scan proacl for a PUBLIC GRANT. PUBLIC is rendered as `=X/<owner>` (empty
  -- grantee = PUBLIC). Use unnest + LIKE so we don't depend on a single text
  -- representation of the array.
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace,
           unnest(p.proacl) AS acl_entry
     WHERE n.nspname = 'public'
       AND p.proname = 'upsert_strategy_analytics_series_batch'
       AND pg_get_function_identity_arguments(p.oid) = 'uuid, text[], jsonb'
       AND acl_entry::text LIKE '=X/%'
  ) INTO proacl_has_public;

  IF anon_can_execute THEN
    RAISE EXCEPTION
      'H-0762 Test 3a: anon has EXECUTE on upsert_strategy_analytics_series_batch (must be REVOKEd)';
  END IF;
  IF auth_can_execute THEN
    RAISE EXCEPTION
      'H-0762 Test 3b: authenticated has EXECUTE on upsert_strategy_analytics_series_batch (must be REVOKEd)';
  END IF;
  IF proacl_has_public THEN
    RAISE EXCEPTION
      'H-0762 Test 3c: PUBLIC has EXECUTE on upsert_strategy_analytics_series_batch (proacl entry =X/... found; must be REVOKEd)';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 4: search_path is locked to (public, pg_temp)
--
-- PR-2 reviewer #3 (2026-05-28): exact equality instead of ILIKE. The prior
-- ILIKE 'search_path=%public%pg_temp%' would falsely pass on
-- `search_path=public_user, pg_temp_evil_schema` (substring match). proconfig
-- entries are normalised by PostgreSQL to the literal form below, so equality
-- is both precise and stable.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_config TEXT[];
  has_search_path_lock BOOLEAN := FALSE;
BEGIN
  SELECT p.proconfig
    INTO fn_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'upsert_strategy_analytics_series_batch'
     AND pg_get_function_identity_arguments(p.oid) = 'uuid, text[], jsonb';

  IF fn_config IS NULL THEN
    RAISE EXCEPTION
      'H-0762 Test 4: upsert_strategy_analytics_series_batch has no proconfig (search_path lock missing)';
  END IF;

  has_search_path_lock := 'search_path=public, pg_temp' = ANY(fn_config);

  IF NOT has_search_path_lock THEN
    RAISE EXCEPTION
      'H-0762 Test 4: search_path lock missing or wrong on upsert_strategy_analytics_series_batch (proconfig=%, expected ''search_path=public, pg_temp'')',
      fn_config;
  END IF;
END $$;

ROLLBACK;
