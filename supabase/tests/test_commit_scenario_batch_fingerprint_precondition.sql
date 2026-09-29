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
-- "symbol:venue:holding_type" (symbol-first), "|"-joined, no value filter, over
-- the rows the My Allocation reader shows (tests 10-14). Run order: AFTER
-- 20260929120000 has been applied (tests 1-9 need only 20260601120000). BEGIN/ROLLBACK
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

-- ==========================================================================
-- Phase 167.1.2 review C4 SFH-R2-01 (tests 10-14). Since D-16 the client
-- fingerprint is built from `holdingsSummary`, which `fetchLatestHoldingsPerKey`
-- (src/lib/latest-holdings-per-key.ts) reads PER KEY: each key's rows at that
-- key's own latest asof, keys grouped by exchange account (SFH-C4-01), and a
-- key dropped when its newest clean poll read it after its rows (SFH-C4-02).
-- The server recompute used the newest row per triple over EVERY date, so a
-- position closed on an earlier day stayed in the server set and every
-- book-mode commit of such an allocator returned 409 portfolio_fingerprint_stale,
-- which no refresh clears. Migration 20260929120000 makes the server compute
-- the reader's set. Each test below passes the fingerprint the reader's set
-- produces and asserts the verdict.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Test 10: a position closed on an EARLIER day is not in the current set.
--
-- One key. BTC-PERP (derivative) last appears on CURRENT_DATE - 2, and the
-- key's latest reading (CURRENT_DATE) holds ETHUSDT only. The reader shows
-- {ETHUSDT}; the fingerprint lists ETHUSDT alone and must MATCH. Under the
-- all-dates rule the server set also held BTC-PERP and this was a 409.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-r201-closed-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'r201-closed', 'test-r201-closed@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'r201-closed', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, test_kid, 'binance', 'BTC-PERP', CURRENT_DATE - 2, 'derivative', 'long', 1, 50000, 50000),
    (test_uid, test_kid, 'binance', 'ETHUSDT',  CURRENT_DATE - 2, 'spot',       'flat', 1, 1000,  1000),
    (test_uid, test_kid, 'binance', 'ETHUSDT',  CURRENT_DATE,     'spot',       'flat', 1, 1000,  1000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

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

  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 10 failed (SFH-R2-01): a triple closed on an earlier day must not be in the server set; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 10 passed: a position closed on an earlier day is out of the server set';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 11: a close is a REAL holdings change and is still detected.
--
-- The key held {ETH, SOL} on CURRENT_DATE - 1 and {ETH} on CURRENT_DATE. A
-- draft built yesterday lists ETH and SOL. The current set is {ETH}, so the
-- draft is stale and must be REJECTED. The all-dates rule kept SOL and let
-- this stale draft through; the fingerprint now sees a close as well as an
-- open (test 9).
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
          'test-r201-close-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'r201-close', 'test-r201-close@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'r201-close', 'encrypted-blob', TRUE) RETURNING id INTO test_kid;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, test_kid, 'binance', 'ETHUSDT', CURRENT_DATE - 1, 'spot', 'flat', 1, 1000, 1000),
    (test_uid, test_kid, 'binance', 'SOLUSDT', CURRENT_DATE - 1, 'spot', 'flat', 1, 1000, 1000),
    (test_uid, test_kid, 'binance', 'ETHUSDT', CURRENT_DATE,     'spot', 'flat', 1, 1000, 1000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:ETHUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'ETHUSDT:binance:spot|SOLUSDT:binance:spot'
  );

  IF (v_result->'errors'->0->>'code') IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 11 failed (SFH-R2-01): a draft listing a position closed since must be rejected; got %', v_result;
  END IF;
  SELECT COUNT(*) INTO v_md_count FROM match_decisions WHERE allocator_id = test_uid;
  IF v_md_count <> 0 THEN
    RAISE EXCEPTION 'Test 11 failed (SFH-R2-01): % match_decisions rows written despite the stale reject', v_md_count;
  END IF;
  RAISE NOTICE 'Test 11 passed: a close since the draft -> portfolio_fingerprint_stale';

  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 12: two quiet keys each keep their OWN latest reading (per key, not
-- allocator-wide), and a key's rows at its latest reading are all kept.
--
-- Key A (binance) last read on CURRENT_DATE - 3 with {ADA, XRP}. Key B (okx)
-- read on CURRENT_DATE with {ETH}. They are different accounts (no venue
-- account id, no marker), so both contribute: {ADA, XRP, ETH}. A fingerprint
-- missing XRP is stale (12a); the full set matches (12b).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  kid_a UUID;
  kid_b UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-r201-perkey-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'r201-perkey', 'test-r201-perkey@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'r201-perkey-a', 'encrypted-blob', TRUE) RETURNING id INTO kid_a;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'okx', 'r201-perkey-b', 'encrypted-blob', TRUE) RETURNING id INTO kid_b;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, kid_a, 'binance', 'ADAUSDT', CURRENT_DATE - 3, 'spot', 'flat', 1, 100, 100),
    (test_uid, kid_a, 'binance', 'XRPUSDT', CURRENT_DATE - 3, 'spot', 'flat', 1, 100, 100),
    (test_uid, kid_b, 'okx',     'ETHUSDT', CURRENT_DATE,     'spot', 'flat', 1, 1000, 1000);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- 12a: XRP missing -> stale.
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:okx:ETHUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'ADAUSDT:binance:spot|ETHUSDT:okx:spot'
  );
  IF (v_result->'errors'->0->>'code') IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 12a failed (SFH-R2-01): a quiet key''s latest reading must stay in the set; got %', v_result;
  END IF;

  -- 12b: the reader's full set -> match.
  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:okx:ETHUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'ADAUSDT:binance:spot|ETHUSDT:okx:spot|XRPUSDT:binance:spot'
  );
  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 12b failed (SFH-R2-01): per-key latest readings must match the reader''s set; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 12 passed: each key keeps its own latest reading';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE user_id = test_uid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 13: one exchange account, one reading (SFH-C4-01).
--
-- 13a (shared venue account id): key OLD (departed) and key NEW both read
-- binance account 'r201-acct-1'. OLD's last reading (CURRENT_DATE - 3) held
-- SOL; NEW read the account on CURRENT_DATE and holds ETH only. The account's
-- newest reading is NEW's, so SOL is not current: the set is {ETH}.
--
-- 13b (duplicate marker, no venue account id): key DUP is marked as a
-- duplicate of key HOLDER. DUP last read on CURRENT_DATE - 2 with LTC; HOLDER
-- read on CURRENT_DATE - 1 with DOT. One account, newest reading HOLDER's:
-- the set is {DOT}. Together with 13a: {ETH, DOT}.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  kid_old UUID;
  kid_new UUID;
  kid_holder UUID;
  kid_dup UUID;
  v_result JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-r201-acct-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'r201-acct', 'test-r201-acct@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  -- OLD is departed (disconnected), so the live-slot unique index admits NEW.
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active,
                        venue_account_id, disconnected_at)
  VALUES (test_uid, 'binance', 'r201-acct-old', 'encrypted-blob', FALSE,
          'r201-acct-1', now()) RETURNING id INTO kid_old;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active, venue_account_id)
  VALUES (test_uid, 'binance', 'r201-acct-new', 'encrypted-blob', TRUE,
          ' r201-acct-1') RETURNING id INTO kid_new;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'okx', 'r201-acct-holder', 'encrypted-blob', TRUE) RETURNING id INTO kid_holder;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active,
                        account_shared_with_api_key_id, account_share_kind)
  VALUES (test_uid, 'okx', 'r201-acct-dup', 'encrypted-blob', TRUE,
          kid_holder, 'duplicate') RETURNING id INTO kid_dup;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, kid_old,    'binance', 'SOLUSDT', CURRENT_DATE - 3, 'spot', 'flat', 1, 100,  100),
    (test_uid, kid_new,    'binance', 'ETHUSDT', CURRENT_DATE,     'spot', 'flat', 1, 1000, 1000),
    (test_uid, kid_dup,    'okx',     'LTCUSDT', CURRENT_DATE - 2, 'spot', 'flat', 1, 100,  100),
    (test_uid, kid_holder, 'okx',     'DOTUSDT', CURRENT_DATE - 1, 'spot', 'flat', 1, 100,  100);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  v_result := public.commit_scenario_batch(
    test_uid,
    jsonb_build_array(jsonb_build_object(
      'kind', 'voluntary_remove',
      'holding_ref', 'holding:binance:ETHUSDT:spot',
      'rejection_reason', 'mandate_conflict'
    )),
    NULL, NULL,
    'DOTUSDT:okx:spot|ETHUSDT:binance:spot'
  );
  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 13 failed (SFH-R2-01): a reading an account''s newer reading superseded must not be in the set; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 13 passed: one exchange account, one reading (venue id and duplicate marker)';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE id = kid_dup;
  DELETE FROM api_keys WHERE user_id = test_uid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 14: a key's newest CLEAN poll newer than its rows drops the key
-- (SFH-C4-02), and nothing weaker does.
--
-- Key P (binance) has ADA on CURRENT_DATE - 2. Key Q (okx) has ETH on
-- CURRENT_DATE. The newest poll event for P decides:
--   14a: `complete`, asof CURRENT_DATE - 1 (after P's rows) -> P contributes
--        nothing; the set is {ETH}.
--   14b: a newer `complete_with_warnings` event does not count (the filter is
--        final_status = 'complete'), and the newest COMPLETE event is the one
--        from 14a: still {ETH}. Then that complete event is replaced by one
--        whose asof EQUALS P's row day (strict >, as the reader) -> P's rows
--        stand: {ADA, ETH}, and an {ETH} fingerprint is stale.
--   14c: a complete event with a malformed asof is no evidence -> {ADA, ETH}.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  kid_p UUID;
  kid_q UUID;
  v_result JSONB;
  v_diff JSONB;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-r201-poll-' || test_uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'r201-poll', 'test-r201-poll@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name, email = EXCLUDED.email;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'r201-poll-p', 'encrypted-blob', TRUE) RETURNING id INTO kid_p;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'okx', 'r201-poll-q', 'encrypted-blob', TRUE) RETURNING id INTO kid_q;
  INSERT INTO allocator_holdings (
    allocator_id, api_key_id, venue, symbol, asof, holding_type, side, quantity, value_usd, mark_price
  ) VALUES
    (test_uid, kid_p, 'binance', 'ADAUSDT', CURRENT_DATE - 2, 'spot', 'flat', 1, 100,  100),
    (test_uid, kid_q, 'okx',     'ETHUSDT', CURRENT_DATE,     'spot', 'flat', 1, 1000, 1000);

  v_diff := jsonb_build_array(jsonb_build_object(
    'kind', 'voluntary_remove',
    'holding_ref', 'holding:okx:ETHUSDT:spot',
    'rejection_reason', 'mandate_conflict'
  ));

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', test_uid::text, 'role', 'authenticated')::text, true);

  -- 14a
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (test_uid, 'allocator.holdings.sync_completed', 'api_key', kid_p,
          jsonb_build_object('final_status', 'complete', 'row_count', 0,
                             'asof', to_char(CURRENT_DATE - 1, 'YYYY-MM-DD')),
          now() - interval '2 hours');
  v_result := public.commit_scenario_batch(test_uid, v_diff, NULL, NULL, 'ETHUSDT:okx:spot');
  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 14a failed (SFH-R2-01): a key whose clean poll read it after its rows must not contribute; got %', v_result;
  END IF;
  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;

  -- 14b: a newer poll with warnings is not a clean poll.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (test_uid, 'allocator.holdings.sync_completed', 'api_key', kid_p,
          jsonb_build_object('final_status', 'complete_with_warnings', 'row_count', 0,
                             'asof', to_char(CURRENT_DATE, 'YYYY-MM-DD')),
          now() - interval '1 hour');
  v_result := public.commit_scenario_batch(test_uid, v_diff, NULL, NULL, 'ETHUSDT:okx:spot');
  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 14b failed (SFH-R2-01): a newer warnings poll must not displace the newest clean poll; got %', v_result;
  END IF;
  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;

  --      newest clean poll on the SAME day as P's rows -> P's rows stand.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (test_uid, 'allocator.holdings.sync_completed', 'api_key', kid_p,
          jsonb_build_object('final_status', 'complete', 'row_count', 1,
                             'asof', to_char(CURRENT_DATE - 2, 'YYYY-MM-DD')),
          now() - interval '30 minutes');
  v_result := public.commit_scenario_batch(test_uid, v_diff, NULL, NULL, 'ETHUSDT:okx:spot');
  IF (v_result->'errors'->0->>'code') IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 14b failed (SFH-R2-01): a same-day clean poll must leave the key''s rows in the set; got %', v_result;
  END IF;
  v_result := public.commit_scenario_batch(test_uid, v_diff, NULL, NULL,
                                           'ADAUSDT:binance:spot|ETHUSDT:okx:spot');
  IF (v_result->>'ok')::bool IS NOT TRUE THEN
    RAISE EXCEPTION 'Test 14b failed (SFH-R2-01): same-day poll, full set must match; got %', v_result;
  END IF;
  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;

  -- 14c: the newest clean event has a malformed asof -> no evidence.
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (test_uid, 'allocator.holdings.sync_completed', 'api_key', kid_p,
          jsonb_build_object('final_status', 'complete', 'row_count', 0,
                             'asof', 'not-a-day'),
          now() - interval '10 minutes');
  v_result := public.commit_scenario_batch(test_uid, v_diff, NULL, NULL, 'ETHUSDT:okx:spot');
  IF (v_result->'errors'->0->>'code') IS DISTINCT FROM 'portfolio_fingerprint_stale' THEN
    RAISE EXCEPTION 'Test 14c failed (SFH-R2-01): a clean poll event with a malformed asof is no evidence; got %', v_result;
  END IF;
  RAISE NOTICE 'Test 14 passed: only a clean poll newer than the key''s rows drops the key';

  DELETE FROM bridge_outcomes WHERE allocator_id = test_uid;
  DELETE FROM match_decisions WHERE allocator_id = test_uid;
  DELETE FROM allocator_holdings WHERE allocator_id = test_uid;
  DELETE FROM api_keys WHERE user_id = test_uid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

ROLLBACK;
