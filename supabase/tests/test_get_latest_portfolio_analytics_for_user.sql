-- Test: get_latest_portfolio_analytics_for_user privilege posture + ownership behavior.
--
-- B19 (Internal Query Bounding): this SECURITY DEFINER RPC replaced
-- getAllocatorAggregates' unbounded .in_ + limit(500) + app-side dedup
-- (src/lib/queries.ts) with a single DISTINCT ON scoped in SQL. Because it is
-- SECURITY DEFINER and authenticated-callable, two regression classes must be
-- guarded against (against the LIVE deployed function, no mocks):
--
--   POSTURE — a future migration flipping it to SECURITY INVOKER, widening
--     EXECUTE to anon/PUBLIC, or dropping the search_path lock. (Tests 1-4.)
--   BEHAVIOR — a future edit removing the auth.uid() ownership gate (the exact
--     class behind the profiles is_admin self-grant privesc): a caller could
--     then read another user's portfolio analytics. (Test 5.)
--
-- Run order: AFTER migration 20260531120000_get_latest_portfolio_analytics_for_user.sql
-- has been applied to the target DB (the function must already exist).
--
-- All seeding is wrapped in BEGIN/ROLLBACK and keyed by gen_random_uuid(), so
-- nothing persists and concurrent CI runs cannot collide.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: SECURITY DEFINER posture + exactly one overload (p_user_id uuid)
--
-- Overload-drift defense: a future migration adding a sibling overload would
-- land a second pg_proc row; Tests 2-4 would target the original signature
-- while production might hit the new overload bypassing the posture.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  is_secdef BOOLEAN;
  match_count INT;
BEGIN
  SELECT COUNT(*), bool_and(p.prosecdef)
    INTO match_count, is_secdef
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_latest_portfolio_analytics_for_user'
     AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

  IF match_count = 0 THEN
    RAISE EXCEPTION
      'B19 Test 1: get_latest_portfolio_analytics_for_user(p_user_id uuid) does not exist (overload drift / migration not applied?)';
  END IF;
  IF match_count > 1 THEN
    RAISE EXCEPTION
      'B19 Test 1: get_latest_portfolio_analytics_for_user(p_user_id uuid) matched % rows — overload drift', match_count;
  END IF;
  IF is_secdef IS NOT TRUE THEN
    RAISE EXCEPTION
      'B19 Test 1: get_latest_portfolio_analytics_for_user is NOT SECURITY DEFINER (prosecdef=%, expected true) — the SQL-side ownership scope would be lost', is_secdef;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 2: authenticated HAS EXECUTE (the frontend user client calls it)
-- --------------------------------------------------------------------------
DO $$
DECLARE auth_can_execute BOOLEAN;
BEGIN
  SELECT has_function_privilege(
    'authenticated',
    'public.get_latest_portfolio_analytics_for_user(uuid)',
    'EXECUTE'
  ) INTO auth_can_execute;
  IF auth_can_execute IS NOT TRUE THEN
    RAISE EXCEPTION
      'B19 Test 2: authenticated lacks EXECUTE on get_latest_portfolio_analytics_for_user (getAllocatorAggregates would 403)';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 3: anon and PUBLIC do NOT have EXECUTE
-- --------------------------------------------------------------------------
DO $$
DECLARE
  anon_can_execute BOOLEAN;
  proacl_has_public BOOLEAN;
BEGIN
  SELECT has_function_privilege(
    'anon',
    'public.get_latest_portfolio_analytics_for_user(uuid)',
    'EXECUTE'
  ) INTO anon_can_execute;
  SELECT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace,
           unnest(p.proacl) AS acl_entry
     WHERE n.nspname = 'public'
       AND p.proname = 'get_latest_portfolio_analytics_for_user'
       AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid'
       AND acl_entry::text LIKE '=X/%'
  ) INTO proacl_has_public;

  IF anon_can_execute THEN
    RAISE EXCEPTION
      'B19 Test 3a: anon has EXECUTE on get_latest_portfolio_analytics_for_user (must be REVOKEd)';
  END IF;
  IF proacl_has_public THEN
    RAISE EXCEPTION
      'B19 Test 3b: PUBLIC has EXECUTE on get_latest_portfolio_analytics_for_user (proacl =X/... found; must be REVOKEd)';
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 4: search_path is locked to (public, pg_catalog)
-- --------------------------------------------------------------------------
DO $$
DECLARE fn_config TEXT[];
BEGIN
  SELECT p.proconfig
    INTO fn_config
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_latest_portfolio_analytics_for_user'
     AND pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid';

  IF fn_config IS NULL THEN
    RAISE EXCEPTION
      'B19 Test 4: get_latest_portfolio_analytics_for_user has no proconfig (search_path lock missing)';
  END IF;
  IF NOT ('search_path=public, pg_catalog' = ANY(fn_config)) THEN
    RAISE EXCEPTION
      'B19 Test 4: search_path lock missing/wrong (proconfig=%, expected ''search_path=public, pg_catalog'')', fn_config;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- Test 5: ownership behavior — the security-critical regression guard.
--   owner (non-admin)  → only their own portfolios, DISTINCT ON latest row
--   owner querying another user → 0 rows (the gate that, if removed, is a
--                                 cross-tenant analytics leak)
--   admin querying another user → that user's rows
--   no auth.uid() (no sub)      → 0 rows
-- --------------------------------------------------------------------------
DO $$
DECLARE
  u_a UUID := gen_random_uuid();
  u_b UUID := gen_random_uuid();
  u_admin UUID := gen_random_uuid();
  p_a UUID := gen_random_uuid();
  p_b UUID := gen_random_uuid();
  c INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at) VALUES
    (u_a,'00000000-0000-0000-0000-000000000000','b19-a-'||u_a||'@quantalyze.test',now(),now()),
    (u_b,'00000000-0000-0000-0000-000000000000','b19-b-'||u_b||'@quantalyze.test',now(),now()),
    (u_admin,'00000000-0000-0000-0000-000000000000','b19-adm-'||u_admin||'@quantalyze.test',now(),now());
  INSERT INTO profiles (id, display_name, is_admin) VALUES
    (u_a,'b19a',false),(u_b,'b19b',false),(u_admin,'b19admin',true)
  ON CONFLICT (id) DO UPDATE SET display_name=EXCLUDED.display_name, is_admin=EXCLUDED.is_admin;
  INSERT INTO portfolios (id, user_id, name) VALUES (p_a,u_a,'B19 A'),(p_b,u_b,'B19 B');
  -- Two analytics rows for p_a (older + newer) prove DISTINCT ON returns one.
  INSERT INTO portfolio_analytics (portfolio_id, computed_at, computation_status) VALUES
    (p_a, now()-interval '2 days','complete'),
    (p_a, now()-interval '1 day','complete'),
    (p_b, now()-interval '1 day','complete');

  -- owner A (non-admin)
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_a::text,'role','authenticated')::text, true);
  SELECT count(*) INTO c FROM public.get_latest_portfolio_analytics_for_user(u_a);
  IF c <> 1 THEN
    RAISE EXCEPTION 'B19 Test 5a: owner expected 1 row (DISTINCT ON latest of 2), got %', c;
  END IF;
  SELECT count(*) INTO c FROM public.get_latest_portfolio_analytics_for_user(u_b);
  IF c <> 0 THEN
    RAISE EXCEPTION 'B19 Test 5b: cross-user expected 0 (ownership gate REMOVED = cross-tenant leak), got %', c;
  END IF;

  -- admin
  PERFORM set_config('request.jwt.claims', json_build_object('sub',u_admin::text,'role','authenticated')::text, true);
  SELECT count(*) INTO c FROM public.get_latest_portfolio_analytics_for_user(u_b);
  IF c <> 1 THEN
    RAISE EXCEPTION 'B19 Test 5c: admin expected 1 row for another user, got %', c;
  END IF;

  -- no sub (e.g. service_role / unauthenticated)
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated')::text, true);
  SELECT count(*) INTO c FROM public.get_latest_portfolio_analytics_for_user(u_a);
  IF c <> 0 THEN
    RAISE EXCEPTION 'B19 Test 5d: no-auth.uid() expected 0, got %', c;
  END IF;

  RAISE NOTICE 'B19 ownership behavior tests passed';
END $$;

ROLLBACK;
