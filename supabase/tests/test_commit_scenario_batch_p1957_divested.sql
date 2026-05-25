-- Test: commit_scenario_batch P1957 — divested-allocator ownership probe
--
-- audit-2026-05-07 round 2 Block E Task E.1 (migration 128).
--
-- Asserted invariants:
--   1. prosrc of commit_scenario_batch contains the value_usd > 0 guard
--      (string-grep — three branches must all carry it).
--   2. End-to-end: an allocator who divested last week (latest asof has
--      value_usd = 0) cannot manufacture a voluntary_remove diff against
--      the now-zero holding — the call raises ERRCODE 42501.
--   3. End-to-end: an allocator who currently owns the holding (latest
--      asof has value_usd > 0) can commit voluntary_remove successfully.
--
-- Pre-migration-128 FAIL state:
--   * Before mig 128, the ownership probe lacked the
--     `asof = (SELECT MAX(asof) ...) AND value_usd > 0` filter — Test 2
--     would have succeeded (bypass).
--
-- Run order: AFTER migration 128 has been applied. BEGIN/ROLLBACK so seed
-- data does not leak.
--
-- JWT-claims scaffolding: commit_scenario_batch's first guard is
-- `auth.uid() = p_allocator_id`. service_role bypasses auth so auth.uid()
-- returns NULL → the guard raises 42501 before any of the P1957 logic
-- runs. Forge `request.jwt.claims.sub` to the seeded allocator id so the
-- function reaches the ownership-probe branches.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: prosrc value_usd > 0 guard present.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_prosrc TEXT;
  v_occurrences INT;
BEGIN
  SELECT prosrc INTO v_prosrc
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb,text,text)'::regprocedure;
  IF v_prosrc IS NULL THEN
    RAISE EXCEPTION 'Test 1 failed: commit_scenario_batch(uuid,jsonb,text,text) not installed';
  END IF;

  -- The guard appears in voluntary_remove, voluntary_modify, and
  -- bridge_recommended branches. Count must be >= 3.
  SELECT (
    char_length(v_prosrc) - char_length(replace(v_prosrc, 'value_usd > 0', ''))
  ) / char_length('value_usd > 0') INTO v_occurrences;
  IF v_occurrences < 3 THEN
    RAISE EXCEPTION
      'Test 1 failed (P1957): value_usd > 0 guard appears % times in prosrc (expected >= 3 — one per ownership-probe branch)', v_occurrences;
  END IF;

  RAISE NOTICE 'Test 1 passed: value_usd > 0 guard present in all three ownership-probe branches';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: divested allocator's voluntary_remove call raises 42501.
--
-- Seed:
--   * auth.users + profiles for the allocator.
--   * api_keys + strategies (FK chain).
--   * allocator_holdings — TWO rows for the same (allocator, venue, symbol,
--     holding_type):
--       row 1: asof = today-7, value_usd = 1000 (had it last week)
--       row 2: asof = today,   value_usd = 0    (divested today)
--     The function's LATERAL probe must pick row 2 (latest asof) and
--     reject because value_usd = 0.
--
-- Then forge the JWT sub and call commit_scenario_batch with a
-- voluntary_remove diff for `holding:binance:BTCUSDT:spot`. Expect
-- ERRCODE 42501.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p1957-div-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p1957-div', 'test-p1957-div@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'p1957-div', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  -- Stale row (last week — had it).
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type,
    side, quantity, value_usd, mark_price
  ) VALUES (
    test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE - 7, 'spot',
    'flat', 0.1, 1000, 10000
  );

  -- Latest row (today — divested).
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type,
    side, quantity, value_usd, mark_price
  ) VALUES (
    test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot',
    'flat', 0, 0, 10000
  );

  -- Forge JWT sub so auth.uid() = test_uid inside the SECURITY DEFINER fn.
  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text,
    true
  );

  BEGIN
    PERFORM public.commit_scenario_batch(
      test_uid,
      jsonb_build_array(
        jsonb_build_object(
          'kind', 'voluntary_remove',
          'holding_ref', 'holding:binance:BTCUSDT:spot',
          'rejection_reason', 'mandate_conflict'
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION
      'Test 2 failed (P1957): divested allocator voluntary_remove call SUCCEEDED — ownership probe bypassed';
  END IF;
  IF err_state <> '42501' THEN
    RAISE EXCEPTION
      'Test 2 failed (P1957): expected ERRCODE 42501 (insufficient_privilege), got %', err_state;
  END IF;

  RAISE NOTICE 'Test 2 passed: divested allocator voluntary_remove rejected with ERRCODE 42501';

  -- Cleanup
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 3: currently-owning allocator's voluntary_remove succeeds.
--
-- Same shape as Test 2 but the latest-asof row has value_usd > 0. The
-- call should return {ok: true, recorded: [...]} and a match_decisions +
-- bridge_outcomes pair should land.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
  v_recorded_count INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p1957-own-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p1957-own', 'test-p1957-own@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'p1957-own', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  -- Current (still owning) holding.
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type,
    side, quantity, value_usd, mark_price
  ) VALUES (
    test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot',
    'flat', 0.5, 5000, 10000
  );

  PERFORM set_config(
    'request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text,
    true
  );

  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(
      jsonb_build_object(
        'kind', 'voluntary_remove',
        'holding_ref', 'holding:binance:BTCUSDT:spot',
        'rejection_reason', 'mandate_conflict'
      )
    )
  );

  IF v_result IS NULL THEN
    RAISE EXCEPTION 'Test 3 failed: commit_scenario_batch returned NULL';
  END IF;
  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 3 failed (P1957): commit_scenario_batch returned ok=% (expected true). Full result: %', v_result->>'ok', v_result;
  END IF;
  SELECT jsonb_array_length(v_result->'recorded') INTO v_recorded_count;
  IF v_recorded_count <> 1 THEN
    RAISE EXCEPTION 'Test 3 failed (P1957): expected 1 recorded entry, got %', v_recorded_count;
  END IF;

  RAISE NOTICE 'Test 3 passed: owning allocator voluntary_remove succeeded; recorded=1';

  -- Cleanup. Order matches FK dependencies: bridge_outcomes →
  -- match_decisions → ... Delete by allocator filter so we catch the
  -- function-inserted rows.
  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

ROLLBACK;
