-- Test: cutover_strategy_metrics_keys_atomic (migration 129).
--
-- audit-2026-05-07 round 2 Block E Task E.2.
--
-- Covers the new atomic cutover RPC + the drop of its unsafe predecessor.
-- The migration's self-verifying DO block asserts function presence,
-- search_path, prosrc string-grep, and predecessor absence. This test
-- file adds behavioral coverage that the DO block cannot reach: actually
-- exercise the cutover and prove the row contract holds.
--
-- Asserted invariants:
--   1. Function shape: SECURITY DEFINER, search_path=public,pg_temp,
--      service_role has EXECUTE; authenticated + anon do NOT.
--   2. The unsafe predecessor cutover_strategy_metrics_keys(uuid,jsonb)
--      is absent. The DO block assertion (b) in the migration already
--      covers this — we re-assert here so the test survives migration
--      replay.
--   3. Missing strategy_id raises ERRCODE P0002 (the SELECT ... FOR
--      UPDATE returned NULL).
--   4. P2046 — heavy keys present in metrics_json are MOVED to the
--      sibling table; non-allowlist keys (sharpe, cagr) are PRESERVED
--      in metrics_json. The metrics_json - allowlist invariant is the
--      core P2046 guarantee.
--   5. moved=0 when no heavy kinds are present (early-return path).
--   6. Idempotent: a second cutover call on the same strategy_id (after
--      heavy keys are already stripped) returns {moved: 0} and does not
--      mutate metrics_json again.
--
-- Pre-migration-129 FAIL state:
--   * Before mig 129, only cutover_strategy_metrics_keys(uuid,jsonb)
--     exists; the new _atomic variant returns NULL on lookup. Test 1
--     fails.
--
-- Run order: AFTER migration 129 has been applied.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: function shape + grants.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_proconfig TEXT[];
  v_search_path_ok BOOLEAN;
  v_svc_can BOOLEAN;
  v_auth_can BOOLEAN;
  v_anon_can BOOLEAN;
BEGIN
  SELECT prosecdef, proconfig INTO v_secdef, v_proconfig
    FROM pg_proc
   WHERE oid = 'public.cutover_strategy_metrics_keys_atomic(uuid)'::regprocedure;

  IF v_secdef IS NULL THEN
    RAISE EXCEPTION 'Test 1 failed: cutover_strategy_metrics_keys_atomic(uuid) not installed';
  END IF;
  IF v_secdef IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 1 failed: cutover_strategy_metrics_keys_atomic is not SECURITY DEFINER';
  END IF;

  v_search_path_ok := 'search_path=public, pg_temp' = ANY(v_proconfig);
  IF NOT v_search_path_ok THEN
    RAISE EXCEPTION
      'Test 1 failed: search_path=public, pg_temp not set (proconfig=%)',
      v_proconfig;
  END IF;

  SELECT has_function_privilege('service_role',
           'public.cutover_strategy_metrics_keys_atomic(uuid)', 'EXECUTE')
    INTO v_svc_can;
  SELECT has_function_privilege('authenticated',
           'public.cutover_strategy_metrics_keys_atomic(uuid)', 'EXECUTE')
    INTO v_auth_can;
  SELECT has_function_privilege('anon',
           'public.cutover_strategy_metrics_keys_atomic(uuid)', 'EXECUTE')
    INTO v_anon_can;

  IF v_svc_can IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 1 failed: service_role lacks EXECUTE on cutover_strategy_metrics_keys_atomic';
  END IF;
  IF v_auth_can IS TRUE THEN
    RAISE EXCEPTION 'Test 1 failed: authenticated has EXECUTE on cutover_strategy_metrics_keys_atomic — REVOKE regressed';
  END IF;
  IF v_anon_can IS TRUE THEN
    RAISE EXCEPTION 'Test 1 failed: anon has EXECUTE on cutover_strategy_metrics_keys_atomic — REVOKE regressed';
  END IF;

  RAISE NOTICE 'Test 1 passed: SECURITY DEFINER, search_path locked, service_role-only EXECUTE';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: unsafe predecessor is absent.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'cutover_strategy_metrics_keys'
  ) INTO v_present;
  IF v_present THEN
    RAISE EXCEPTION
      'Test 2 failed (P2046): unsafe cutover_strategy_metrics_keys(uuid, jsonb) still present — migration 129 STEP 2 DROP missing';
  END IF;
  RAISE NOTICE 'Test 2 passed: unsafe predecessor dropped';
END $$;

-- --------------------------------------------------------------------------
-- Test 3: missing strategy_id raises P0002.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  BEGIN
    PERFORM public.cutover_strategy_metrics_keys_atomic(gen_random_uuid());
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION 'Test 3 failed: missing strategy_id call SUCCEEDED — should raise P0002';
  END IF;
  IF err_state <> 'P0002' THEN
    RAISE EXCEPTION 'Test 3 failed: expected ERRCODE P0002 (no_data_found), got %', err_state;
  END IF;

  RAISE NOTICE 'Test 3 passed: missing strategy_id raised P0002';
END $$;

-- --------------------------------------------------------------------------
-- Test 4: P2046 — heavy keys move; non-allowlist keys preserved.
--
-- Seed strategy + strategy_analytics with metrics_json containing:
--   - A heavy key (daily_returns_grid) — must be MOVED to sibling.
--   - A non-allowlist key (sharpe) — must be PRESERVED in metrics_json.
--
-- After the cutover, verify:
--   * sibling row exists for daily_returns_grid.
--   * metrics_json no longer has daily_returns_grid.
--   * metrics_json STILL has sharpe.
--   * moved = 1.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  v_result JSONB;
  v_moved INT;
  v_metrics JSONB;
  v_sibling_payload JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p2046-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p2046', 'test-p2046@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'p2046', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes,
    markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'p2046 strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;

  INSERT INTO strategy_analytics (
    strategy_id, computation_status, metrics_json
  ) VALUES (
    test_sid, 'complete',
    jsonb_build_object(
      'daily_returns_grid', jsonb_build_array(jsonb_build_object('d', '2026-01-01', 'r', 0.01)),
      'sharpe', 1.5,
      'cagr', 0.2
    )
  );

  v_result := public.cutover_strategy_metrics_keys_atomic(test_sid);
  v_moved := (v_result->>'moved')::int;

  IF v_moved <> 1 THEN
    RAISE EXCEPTION 'Test 4 failed (P2046): expected moved=1, got %', v_moved;
  END IF;

  -- Heavy key moved to sibling.
  SELECT payload INTO v_sibling_payload
    FROM strategy_analytics_series
   WHERE strategy_id = test_sid AND kind = 'daily_returns_grid';
  IF v_sibling_payload IS NULL THEN
    RAISE EXCEPTION 'Test 4 failed (P2046): sibling row for daily_returns_grid missing';
  END IF;

  -- Heavy key stripped from metrics_json.
  SELECT metrics_json INTO v_metrics
    FROM strategy_analytics WHERE strategy_id = test_sid;
  IF v_metrics ? 'daily_returns_grid' THEN
    RAISE EXCEPTION 'Test 4 failed (P2046): daily_returns_grid NOT stripped from metrics_json';
  END IF;

  -- Non-allowlist keys preserved.
  IF NOT (v_metrics ? 'sharpe') THEN
    RAISE EXCEPTION 'Test 4 failed (P2046): sharpe (non-allowlist) was STRIPPED — caller-driven key set leaked through';
  END IF;
  IF NOT (v_metrics ? 'cagr') THEN
    RAISE EXCEPTION 'Test 4 failed (P2046): cagr (non-allowlist) was STRIPPED';
  END IF;

  RAISE NOTICE 'Test 4 passed: heavy key moved, non-allowlist keys preserved (P2046 holds)';

  -- Cleanup. strategies cascade drops strategy_analytics +
  -- strategy_analytics_series + api_keys-strategies link.
  DELETE FROM strategy_analytics_series WHERE strategy_id = test_sid;
  DELETE FROM strategy_analytics WHERE strategy_id = test_sid;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 5: moved=0 when metrics_json has no heavy keys; idempotent replay.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  v_result JSONB;
  v_metrics_before JSONB;
  v_metrics_after JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p2046-zero-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p2046-zero', 'test-p2046-zero@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'p2046-zero', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes,
    markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'p2046-zero strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;

  -- metrics_json contains ONLY non-allowlist keys.
  INSERT INTO strategy_analytics (
    strategy_id, computation_status, metrics_json
  ) VALUES (
    test_sid, 'complete',
    jsonb_build_object('sharpe', 1.5, 'cagr', 0.2)
  );

  SELECT metrics_json INTO v_metrics_before
    FROM strategy_analytics WHERE strategy_id = test_sid;

  v_result := public.cutover_strategy_metrics_keys_atomic(test_sid);

  IF (v_result->>'moved')::int <> 0 THEN
    RAISE EXCEPTION
      'Test 5 failed: expected moved=0, got %', v_result->>'moved';
  END IF;

  -- metrics_json must be byte-for-byte unchanged when moved=0 (early
  -- return before the UPDATE).
  SELECT metrics_json INTO v_metrics_after
    FROM strategy_analytics WHERE strategy_id = test_sid;
  IF v_metrics_before <> v_metrics_after THEN
    RAISE EXCEPTION
      'Test 5 failed: metrics_json mutated when moved=0; before=%, after=%',
      v_metrics_before, v_metrics_after;
  END IF;

  -- Idempotent replay returns same result.
  v_result := public.cutover_strategy_metrics_keys_atomic(test_sid);
  IF (v_result->>'moved')::int <> 0 THEN
    RAISE EXCEPTION
      'Test 5 failed: idempotent replay expected moved=0, got %', v_result->>'moved';
  END IF;

  RAISE NOTICE 'Test 5 passed: moved=0 path preserves metrics_json + replay-safe';

  DELETE FROM strategy_analytics WHERE strategy_id = test_sid;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 6: idempotent replay AFTER a successful move=1 cutover.
--
-- The mig-129 contract claims the RPC is replay-safe. Test 5 covered
-- replay-from-empty (metrics_json never had a heavy key). This test covers
-- replay-from-stripped: first call moves daily_returns_grid into
-- strategy_analytics_series + strips from metrics_json. Second call (against
-- the same strategy, now-stripped state) MUST return moved=0, leave
-- metrics_json byte-for-byte unchanged, and not duplicate the sibling row.
-- Without this test, a future regression that inserts a sibling row on
-- every replay would silently grow strategy_analytics_series row count.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  v_result JSONB;
  v_metrics_after_first JSONB;
  v_metrics_after_second JSONB;
  v_sibling_count_after_first INT;
  v_sibling_count_after_second INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-replay-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'replay-user', 'test-replay@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'replay-test', 'encrypted-blob', TRUE)
  RETURNING id INTO test_kid;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes,
    markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'replay strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;

  -- metrics_json has ONE allowlist key (daily_returns_grid) + a non-allowlist
  -- key (sharpe). First cutover moves 1, second should see nothing to move.
  INSERT INTO strategy_analytics (
    strategy_id, computation_status, metrics_json
  ) VALUES (
    test_sid, 'complete',
    jsonb_build_object(
      'daily_returns_grid', jsonb_build_object('2024-01-01', 0.01),
      'sharpe', 1.7
    )
  );

  -- First call: must report moved=1, strip daily_returns_grid, preserve
  -- sharpe, and insert exactly one sibling row.
  v_result := public.cutover_strategy_metrics_keys_atomic(test_sid);
  IF (v_result->>'moved')::int <> 1 THEN
    RAISE EXCEPTION
      'Test 6 failed: first call expected moved=1, got %', v_result->>'moved';
  END IF;

  SELECT metrics_json INTO v_metrics_after_first
    FROM strategy_analytics WHERE strategy_id = test_sid;
  IF v_metrics_after_first ? 'daily_returns_grid' THEN
    RAISE EXCEPTION
      'Test 6 failed: daily_returns_grid still in metrics_json after first call: %',
      v_metrics_after_first;
  END IF;
  IF NOT (v_metrics_after_first ? 'sharpe') THEN
    RAISE EXCEPTION
      'Test 6 failed: non-allowlist key sharpe stripped during first call: %',
      v_metrics_after_first;
  END IF;

  SELECT COUNT(*) INTO v_sibling_count_after_first
    FROM strategy_analytics_series
   WHERE strategy_id = test_sid AND kind = 'daily_returns_grid';
  IF v_sibling_count_after_first <> 1 THEN
    RAISE EXCEPTION
      'Test 6 failed: expected 1 sibling row after first call, got %',
      v_sibling_count_after_first;
  END IF;

  -- Second call: REPLAY. Must report moved=0, metrics_json unchanged,
  -- sibling row count unchanged.
  v_result := public.cutover_strategy_metrics_keys_atomic(test_sid);
  IF (v_result->>'moved')::int <> 0 THEN
    RAISE EXCEPTION
      'Test 6 failed: replay expected moved=0, got %', v_result->>'moved';
  END IF;

  SELECT metrics_json INTO v_metrics_after_second
    FROM strategy_analytics WHERE strategy_id = test_sid;
  IF v_metrics_after_first <> v_metrics_after_second THEN
    RAISE EXCEPTION
      'Test 6 failed: metrics_json mutated during idempotent replay; before=%, after=%',
      v_metrics_after_first, v_metrics_after_second;
  END IF;

  SELECT COUNT(*) INTO v_sibling_count_after_second
    FROM strategy_analytics_series
   WHERE strategy_id = test_sid AND kind = 'daily_returns_grid';
  IF v_sibling_count_after_second <> 1 THEN
    RAISE EXCEPTION
      'Test 6 failed: sibling row count changed on replay (expected 1, got %)',
      v_sibling_count_after_second;
  END IF;

  RAISE NOTICE 'Test 6 passed: replay after successful move=1 is idempotent';

  DELETE FROM strategy_analytics_series WHERE strategy_id = test_sid;
  DELETE FROM strategy_analytics WHERE strategy_id = test_sid;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

ROLLBACK;
