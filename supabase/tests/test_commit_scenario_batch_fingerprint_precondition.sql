-- Test: commit_scenario_batch B11 / NEW-C18-10 portfolio-fingerprint precondition
--
-- audit-2026-05-07 B11. Migration
-- 20260601120000_commit_scenario_batch_fingerprint_precondition.sql adds a 5th
-- param p_portfolio_fingerprint TEXT: when supplied, the RPC recomputes the
-- CURRENT holdings token set and rejects (ok:false code='portfolio_fingerprint_stale',
-- route -> 409) if it diverges from the draft's fingerprint — the server-side
-- optimistic-concurrency fence for the stale-draft lost-update.
--
-- Asserted invariants:
--   1. MATCHING fingerprint  -> the precondition passes, commit succeeds (ok:true).
--   2. DIVERGENT fingerprint -> ok:false code=portfolio_fingerprint_stale, NO rows written.
--   3. DIVERGENT + Idempotency-Key -> ok:false AND the fresh in-flight reservation
--      is rolled back (DELETEd), so a retry with the same key is not wedged.
--   4. NULL fingerprint (2-arg/4-arg call) -> precondition SKIPPED (backward compat).
--   5. ORDER-INVARIANT / COLLATION-INDEPENDENT match: a fingerprint whose token
--      order differs from Postgres C-collation order still MATCHES (we compare the
--      token SET, re-sorting both sides with COLLATE "C") — proves we do NOT depend
--      on reproducing the client's JS localeCompare sort.
--   6. value_usd <= 0 latest holding's token is INCLUDED in the server fingerprint
--      (NO value_usd filter) — a fingerprint listing a divested-but-latest holding
--      MATCHES, so a valid commit is NOT false-rejected. (Guards the #1 false-reject
--      risk: copying the ownership-probe's value_usd>0 into the fingerprint recompute.)
--   7. EMPTY holdings + EMPTY ("") fingerprint -> match (allocator with no spot
--      holdings committing a voluntary_add).
--
-- The fingerprint token format mirrors computeHoldingsFingerprint (scenario-state.ts):
-- "symbol:venue:holding_type" (symbol-first), "|"-joined, latest-asof-per-triple,
-- no value filter. Run order: AFTER 20260601120000 has been applied. BEGIN/ROLLBACK
-- so seed data does not leak. JWT-claims scaffolding (forge request.jwt.claims.sub)
-- as in test_commit_scenario_batch_p1957_divested.sql.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: matching fingerprint -> commit succeeds (ok:true).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-match-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-match', 'test-b11-match@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-match', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot', 'flat', 0.5, 5000, 10000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- Fingerprint matches the single live holding exactly.
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:BTCUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'BTCUSDT:binance:spot'
  );

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 1 failed (B11): matching fingerprint should commit; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 1 passed: matching fingerprint -> ok:true';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 2: divergent fingerprint (no idempotency key) -> ok:false stale, NO rows.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
  v_md_count INT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-div-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-div', 'test-b11-div@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-div', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot', 'flat', 0.5, 5000, 10000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- Fingerprint claims a DIFFERENT holding set (ETHUSDT) than what is live (BTCUSDT).
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:BTCUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'ETHUSDT:binance:spot'
  );

  IF (v_result->>'ok')::bool IS NOT FALSE THEN
    RAISE EXCEPTION 'Test 2 failed (B11): divergent fingerprint should be rejected; got %', v_result;
  END IF;
  IF (v_result->'errors'->0->>'code') <> 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 2 failed (B11): expected code=portfolio_fingerprint_stale, got %', v_result;
  END IF;
  -- NOTHING committed (the divergence short-circuits before the loop).
  SELECT COUNT(*) INTO v_md_count FROM match_decisions WHERE allocator_id = test_uid;
  IF v_md_count <> 0 THEN
    RAISE EXCEPTION 'Test 2 failed (B11): % match_decisions rows written despite stale-fingerprint reject', v_md_count;
  END IF;
  RAISE NOTICE 'Test 2 passed: divergent fingerprint -> ok:false portfolio_fingerprint_stale, 0 rows';

  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 3: divergent fingerprint WITH Idempotency-Key -> reservation rolled back.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
  v_resv_count INT;
  v_key TEXT := 'b11-fingerprint-stale-key-0001';   -- 30 chars, satisfies 16..128 CHECK
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-resv-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-resv', 'test-b11-resv@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-resv', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot', 'flat', 0.5, 5000, 10000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:BTCUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    v_key, repeat('a', 64),
    'ETHUSDT:binance:spot'   -- divergent
  );

  IF (v_result->'errors'->0->>'code') <> 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 3 failed (B11): expected portfolio_fingerprint_stale, got %', v_result;
  END IF;
  -- The fresh in-flight reservation must have been DELETEd (not left wedged).
  SELECT COUNT(*) INTO v_resv_count
    FROM scenario_commit_idempotency
   WHERE allocator_id = test_uid AND idempotency_key = v_key;
  IF v_resv_count <> 0 THEN
    RAISE EXCEPTION 'Test 3 failed (B11): in-flight reservation NOT rolled back on stale-fingerprint (% rows)', v_resv_count;
  END IF;
  RAISE NOTICE 'Test 3 passed: stale fingerprint with Idempotency-Key rolls back the reservation';

  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 4: NULL fingerprint (2-arg call) -> precondition SKIPPED (backward compat).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-null-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-null', 'test-b11-null@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-null', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  -- Live holdings deliberately DIFFER from any fingerprint — but with NULL
  -- fingerprint the precondition is skipped, so the commit still succeeds.
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot', 'flat', 0.5, 5000, 10000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- 2-arg positional call: p_idempotency_key/p_request_hash/p_portfolio_fingerprint
  -- all default NULL -> the fingerprint precondition is skipped entirely.
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:BTCUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    ))
  );

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 4 failed (B11): NULL fingerprint must skip the precondition; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 4 passed: NULL fingerprint -> precondition skipped (backward compatible)';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 5: order-invariant / collation-independent match.
--
-- Two holdings whose tokens sort DIFFERENTLY under C-collation ("Z..." < "a...")
-- than the client's localeCompare ("a..." < "Z..."). The fingerprint is passed in
-- the NON-C (localeCompare) order; the precondition must still MATCH because it
-- compares the token SET (re-sorting both sides with COLLATE "C"), not the
-- client's sort order.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-order-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-order', 'test-b11-order@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-order', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, test_kid, 'binance', 'Z', CURRENT_DATE, 'spot', 'flat', 1, 5000, 5000),
    (test_uid, test_kid, 'binance', 'a', CURRENT_DATE, 'spot', 'flat', 1, 5000, 5000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- Tokens in localeCompare order ("a:..." before "Z:..."), which is the REVERSE
  -- of C-collation order. A naive string_agg ORDER BY recompute would mismatch;
  -- set-equality must still pass.
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:a:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'a:binance:spot|Z:binance:spot'
  );

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 5 failed (B11): order-invariant fingerprint should match (set equality); got %', v_result;
  END IF;
  RAISE NOTICE 'Test 5 passed: collation-independent SET match (non-C token order still matches)';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 6: value_usd <= 0 latest holding's token is INCLUDED (no value filter).
--
-- The only live holding has latest-asof value_usd = 0 (divested today). Its
-- token is still in the client fingerprint (computeHoldingsFingerprint ignores
-- value_usd). Commit a voluntary_add (which does not touch that holding) with a
-- fingerprint that LISTS the zero-value holding: it must MATCH (the server
-- fingerprint includes value_usd<=0 latest rows). If the server wrongly copied
-- the ownership-probe's value_usd>0 filter, the server set would be empty and
-- this valid commit would be FALSE-REJECTED.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-zero-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-zero', 'test-b11-zero@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-zero', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes, markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'b11-zero strategy', 'published', '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;
  -- Latest-asof holding has value_usd = 0 (divested).
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE, 'spot', 'flat', 0, 0, 10000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_add',
      'strategy_id', test_sid::text,
      'percent_allocated', 25
    )),
    NULL, NULL,
    'BTCUSDT:binance:spot'   -- the zero-value holding IS in the fingerprint
  );

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 6 failed (B11): value_usd<=0 token must be INCLUDED in the fingerprint (no value filter); got %', v_result;
  END IF;
  RAISE NOTICE 'Test 6 passed: value_usd<=0 latest holding token included -> no false reject';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 7: empty holdings + empty ("") fingerprint -> match.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-empty-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-empty', 'test-b11-empty@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-empty', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes, markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'b11-empty strategy', 'published', '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;
  -- No allocator_holdings rows for this allocator.

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_add',
      'strategy_id', test_sid::text,
      'percent_allocated', 25
    )),
    NULL, NULL,
    ''   -- empty fingerprint matches the empty holdings set
  );

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 7 failed (B11): empty fingerprint must match empty holdings; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 7 passed: empty fingerprint matches empty holdings set';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 8: multi-asof per triple — the latest-asof DISTINCT ON collapse.
--
-- allocator_holdings carries one row PER DAY per holding (the position cron
-- appends a new asof daily). The recompute MUST collapse those to ONE token
-- per (venue,symbol,holding_type) via DISTINCT ON ... asof DESC, matching the
-- client's latest-asof-per-triple dedup, so a single-token client fingerprint
-- still MATCHES. A regression that drops/mis-orders the DISTINCT ON would make
-- array_agg emit duplicate tokens (e.g. [BTC,BTC,BTC]) for any allocator with
-- >1 daily snapshot, diverging from the client's single [BTC] -> false-reject
-- 409 on EVERY commit. This case (3 asof rows, one triple) pins it.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-multiasof-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-multiasof', 'test-b11-multiasof@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-multiasof', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  -- Same (binance, BTCUSDT, spot) triple at THREE asof dates, differing value_usd.
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE - 2, 'spot', 'flat', 0.1, 1000, 10000),
    (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE - 1, 'spot', 'flat', 0.2, 2000, 10000),
    (test_uid, test_kid, 'binance', 'BTCUSDT', CURRENT_DATE,     'spot', 'flat', 0.3, 3000, 10000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- The client deduped to ONE token; the server must collapse the 3 asof rows
  -- to the same one token.
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:BTCUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'BTCUSDT:binance:spot'
  );

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 8 failed (B11): multi-asof triple must collapse to one token and MATCH a single-token fingerprint (DISTINCT ON regression?); got %', v_result;
  END IF;
  RAISE NOTICE 'Test 8 passed: latest-asof DISTINCT ON collapses multi-asof triple to one token';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 9: the latest asof introduced a NEW symbol the stale draft never saw.
--
-- The realistic OCC case: the draft was built against {ETH} but the cron's
-- newest snapshot added SOL -> current set {ETH, SOL}. The client's stale
-- single-symbol fingerprint must be REJECTED (the recompute keys on the latest
-- asof, not the union across history).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-b11-newsym-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'b11-newsym', 'test-b11-newsym@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'b11-newsym', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  -- Older snapshot: ETH only. Latest snapshot (today): ETH + a NEW SOL.
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, test_kid, 'binance', 'ETHUSDT', CURRENT_DATE - 1, 'spot', 'flat', 1, 1000, 1000),
    (test_uid, test_kid, 'binance', 'ETHUSDT', CURRENT_DATE,     'spot', 'flat', 1, 1000, 1000),
    (test_uid, test_kid, 'binance', 'SOLUSDT', CURRENT_DATE,     'spot', 'flat', 1, 1000, 1000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- Stale draft fingerprint lists ONLY ETH (built before SOL appeared).
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:ETHUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'ETHUSDT:binance:spot'
  );

  IF (v_result->'errors'->0->>'code') <> 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 9 failed (B11): a stale fingerprint missing a newly-added latest-asof symbol must be rejected; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 9 passed: latest-asof new symbol -> stale single-symbol fingerprint rejected';

  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

ROLLBACK;
