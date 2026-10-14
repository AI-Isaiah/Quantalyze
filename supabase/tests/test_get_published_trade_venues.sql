-- Recurring CI regression gate for the Phase 170.6.1 DISCOVERYPHONE venue
-- primitive: 20261019120000_get_published_trade_venues.sql (SC-2, D-04, D-08).
--
-- Why this file exists
-- --------------------
-- Discovery is read by anon, and anon cannot read `api_keys` (owner-scoped, column
-- grants to `authenticated` only). The venue a published strategy's trades come
-- from therefore has to reach the public page through a SECURITY DEFINER function
-- shaped like get_published_trust_signals(uuid[]): RETURNS TABLE is the column
-- allow-list, `s.status = 'published'` is the gate. The migration proves its
-- catalogue ONCE at apply time; a migration DO block never runs again. This file is
-- the recurring gate, so a later CREATE OR REPLACE that widens the result shape
-- (a key id, label or encrypted field), drops the published gate or loses an
-- EXECUTE grant ships RED.
--
-- What this asserts, and why by CONTENT not by error
-- --------------------------------------------------
-- Every behavioural assertion is scoped to the gate's OWN fixture ids (never a
-- global count: shared TEST carries other strategies) and runs AS the anon role,
-- the real public path. The seed is ALSO the RED-guard on the migration: the
-- SELECT ... FROM get_published_trade_venues(...) throws undefined_function
-- (42883) if the migration is not applied, so this file cannot pass on a database
-- missing the function.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with RAISE
-- EXCEPTION on failure / RAISE NOTICE on pass. No psql backslash meta-commands.
-- Filename matches the `test_*.sql` glob so the sql-tests job auto-discovers it.
--
-- Hygiene: the seed runs inside an explicit transaction that ends in ROLLBACK, so
-- no fixture row is ever committed.
--
-- Usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_get_published_trade_venues.sql
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/26-fixture-strategies-api-key-fk.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20261019120000_get_published_trade_venues.sql"]}

-- Defensive pre-clean (a prior aborted run may have committed synthetic rows).
-- ON DELETE CASCADE chains auth.users -> profiles -> strategies / api_keys.
DELETE FROM auth.users
  WHERE email = 'test-tradevenues@quantalyze.test';

-- ==========================================================================
-- Part 1 — catalogue and grants (no seed, no role switch). Ordered FIRST, and in
-- this order, so every mutation of the function's shape or grants reddens ITS OWN
-- arm before any behavioural arm can die on a raw 42501 that names no arm: the
-- behavioural arms in Part 2 call the function AS anon, so they depend on the two
-- EXECUTE grants asserted here (the precedent's reason for ordering its anon
-- EXECUTE arm first). A shape or SECURITY DEFINER mutation never touches a grant.
-- ==========================================================================
DO $$
DECLARE
  v_secdef  BOOLEAN;
  v_config  TEXT[];
  v_result  TEXT;
BEGIN
  SELECT p.prosecdef, p.proconfig, pg_get_function_result(p.oid)
    INTO v_secdef, v_config, v_result
    FROM pg_proc p
   WHERE p.proname = 'get_published_trade_venues'
     AND p.pronamespace = 'public'::regnamespace;

  -- ----- TV-secdef: the function runs as its owner ---------------------------
  -- Without SECURITY DEFINER, anon runs the body as itself, cannot read api_keys,
  -- and every public venue goes dark.
  -- RED-UNDER: ALTER FUNCTION public.get_published_trade_venues(uuid[]) SECURITY
  --            INVOKER on the live database. A `sql` step, never a migration
  --            edit: the migration's own catalogue self-verify aborts the apply
  --            on a missing SECURITY DEFINER, so the gate would never run.
  -- RED-UNDER-M: {"arm":"TV-secdef","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.get_published_trade_venues(uuid[]) SECURITY INVOKER"}]}
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'TEST FAILED (TV-secdef): get_published_trade_venues is not SECURITY DEFINER — anon would run the body as itself and read no api_keys row';
  END IF;

  -- ----- TV-searchpath: the SECURITY DEFINER search_path is pinned -----------
  -- A SECURITY DEFINER body with a mutable search_path is the pg_temp /
  -- function-planting privilege-escalation pattern (T-170.6.1-03).
  -- RED-UNDER: ALTER FUNCTION public.get_published_trade_venues(uuid[]) RESET
  --            search_path on the live database (a `sql` step, for the same
  --            reason as TV-secdef).
  -- RED-UNDER-M: {"arm":"TV-searchpath","apply":[{"kind":"sql","stmt":"ALTER FUNCTION public.get_published_trade_venues(uuid[]) RESET search_path"}]}
  IF NOT COALESCE('search_path=public, pg_temp' = ANY(v_config), false) THEN
    RAISE EXCEPTION 'TEST FAILED (TV-searchpath): get_published_trade_venues is missing SET search_path = public, pg_temp (config=%) — SECURITY DEFINER search_path hijack', v_config;
  END IF;

  -- ----- TV-shape: the column allow-list (D-04, D-08) ------------------------
  -- RETURNS TABLE is the allow-list: the ONLY columns that can leave the function
  -- are (strategy_id, exchange). A key id, label or encrypted field widens it.
  -- RED-UNDER: widen the allow-list — add `api_key_id uuid` to RETURNS TABLE and
  --            `k.id` to both SELECT lists. LAYERED: the body and its RETURNS
  --            TABLE must agree, and the migration's own catalogue self-verify
  --            pins the same shape and would abort the apply, so its expected
  --            string is re-baselined in the same mutation (fourth step); that is
  --            what makes the arm reachable, not a way around the self-verify.
  -- RED-UNDER-M: {"arm":"TV-shape","apply":[{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"RETURNS TABLE (strategy_id uuid, exchange text)","replace":"RETURNS TABLE (strategy_id uuid, exchange text, api_key_id uuid)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"         lower(k.exchange)\n    FROM public.strategies s\n    JOIN public.api_keys k ON k.id = s.api_key_id","replace":"         lower(k.exchange),\n         k.id\n    FROM public.strategies s\n    JOIN public.api_keys k ON k.id = s.api_key_id","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"         lower(k.exchange)\n    FROM public.strategies s\n    JOIN public.strategy_keys sk","replace":"         lower(k.exchange),\n         k.id\n    FROM public.strategies s\n    JOIN public.strategy_keys sk","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text)'","replace":"IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text, api_key_id uuid)'","occurrences":1}]}
  IF v_result IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text)' THEN
    RAISE EXCEPTION 'TEST FAILED (TV-shape): get_published_trade_venues result shape is "%", expected "TABLE(strategy_id uuid, exchange text)" — column allow-list widened (possible key id, label or encrypted-field leak)', v_result;
  END IF;

  -- ----- TV-anon-exec: anon can call it (D-08) -------------------------------
  -- has_function_privilege takes the role as an argument, so no SET ROLE is
  -- needed and no role can leak past an aborted arm.
  -- RED-UNDER: REVOKE EXECUTE ON FUNCTION public.get_published_trade_venues(uuid[])
  --            FROM anon on the live database — the anon-EXECUTE revoke footgun:
  --            Discovery would silently lose every venue for a signed-out
  --            visitor. A `sql` step (the migration's self-verify pins the grant).
  -- RED-UNDER-M: {"arm":"TV-anon-exec","apply":[{"kind":"sql","stmt":"REVOKE EXECUTE ON FUNCTION public.get_published_trade_venues(uuid[]) FROM anon"}]}
  IF NOT has_function_privilege('anon', 'public.get_published_trade_venues(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (TV-anon-exec): anon lacks EXECUTE on get_published_trade_venues — the public venue is unreadable';
  END IF;

  -- ----- TV-auth-exec: authenticated can call it (D-04, plan-check W9) -------
  -- RED-UNDER: REVOKE EXECUTE ON FUNCTION public.get_published_trade_venues(uuid[])
  --            FROM authenticated on the live database. A signed-in allocator
  --            would lose every venue on Discovery.
  -- RED-UNDER-M: {"arm":"TV-auth-exec","apply":[{"kind":"sql","stmt":"REVOKE EXECUTE ON FUNCTION public.get_published_trade_venues(uuid[]) FROM authenticated"}]}
  IF NOT has_function_privilege('authenticated', 'public.get_published_trade_venues(uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (TV-auth-exec): authenticated lacks EXECUTE on get_published_trade_venues — a signed-in allocator would lose the venue';
  END IF;
END
$$;

-- ==========================================================================
-- Part 2 — behaviour, AS anon (the real public path). Every fixture id is this
-- block's own; no assertion reads a global count.
-- ==========================================================================
BEGIN;

DO $$
DECLARE
  uid            UUID := gen_random_uuid();
  key_okx        UUID;
  key_priv_a     UUID;
  key_priv_b     UUID;
  key_bybit      UUID;
  key_dual       UUID;
  strat_pub      UUID;  -- published, api_key_id -> okx, listed on bybit (the SC-2 shape)
  strat_priv     UUID;  -- private, api_key_id -> key_priv_a
  strat_priv_c   UUID;  -- private, strategy_keys member -> key_priv_b
  strat_sk       UUID;  -- published, api_key_id NULL, strategy_keys member -> bybit
  strat_dual     UUID;  -- published, reached through BOTH paths, same okx key
  venue_rows     INTEGER;
  venue          TEXT;
BEGIN
  -- ----- SEED (service context, bypasses RLS) ------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'test-tradevenues@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'tradevenues owner', 'test-tradevenues@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid, 'okx', 'tradevenues okx key', 'x') RETURNING id INTO key_okx;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid, 'okx', 'tradevenues private key a', 'x') RETURNING id INTO key_priv_a;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid, 'okx', 'tradevenues private key b', 'x') RETURNING id INTO key_priv_b;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid, 'bybit', 'tradevenues bybit key', 'x') RETURNING id INTO key_bybit;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid, 'okx', 'tradevenues dual key', 'x') RETURNING id INTO key_dual;

  INSERT INTO strategies (user_id, name, status, api_key_id, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'tradevenues published', 'published', key_okx, '{}', '{}', '{}', ARRAY['bybit'])
  RETURNING id INTO strat_pub;
  INSERT INTO strategies (user_id, name, status, api_key_id, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'tradevenues private', 'private', key_priv_a, '{}', '{}', '{}', ARRAY['bybit'])
  RETURNING id INTO strat_priv;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'tradevenues private composite', 'private', '{}', '{}', '{}', ARRAY['bybit'])
  RETURNING id INTO strat_priv_c;
  INSERT INTO strategies (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'tradevenues published composite', 'published', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_sk;
  INSERT INTO strategies (user_id, name, status, api_key_id, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid, 'tradevenues published dual', 'published', key_dual, '{}', '{}', '{}', ARRAY['okx'])
  RETURNING id INTO strat_dual;

  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_priv_c, key_priv_b, uid, '2025-08-01', NULL, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_sk, key_bybit, uid, '2025-08-01', NULL, 0);
  INSERT INTO strategy_keys (strategy_id, api_key_id, owner_id, window_start, window_end, seq)
  VALUES (strat_dual, key_dual, uid, '2025-08-01', NULL, 0);

  -- ----- TV-1: a published strategy's KEY venue is returned to anon ---------
  -- The key's exchange (okx) wins over supported_exchanges (bybit): D-04. This is
  -- the positive control that gives the zeros below their meaning.
  -- RED-UNDER: point the published predicate in the migration's body at a status
  --            no row carries (`s.status = 'published'` becomes
  --            `'published_never'` in BOTH arms), so the function returns nothing
  --            at all and the positive control goes dark.
  -- RED-UNDER-M: {"arm":"TV-1","apply":[{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"s.status = 'published'","replace":"s.status = 'published_never'","occurrences":2}]}
  SET LOCAL ROLE anon;
  SELECT count(*), min(v.exchange) INTO venue_rows, venue
    FROM get_published_trade_venues(ARRAY[strat_pub]) v;
  RESET ROLE;
  IF venue_rows IS DISTINCT FROM 1 OR venue IS DISTINCT FROM 'okx' THEN
    RAISE EXCEPTION 'TEST FAILED (TV-1): anon got % venue row(s) (venue=%) for the PUBLISHED strategy, expected exactly one row naming okx — the key venue is unreadable or the function is broken', venue_rows, venue;
  END IF;

  -- ----- TV-unpublished: a non-published strategy's venue is NOT returned ----
  -- The private strategy carries an identical key; the ONLY difference from the
  -- TV-1 strategy is strategies.status, so any difference in output is the
  -- published-gate (T-170.6.1-02).
  -- RED-UNDER: drop the published predicate from the single-key arm only —
  --            `WHERE s.status = 'published' AND s.id = ANY(...)` becomes
  --            `WHERE s.id = ANY(...)` before the UNION. TV-1 still passes, so
  --            this arm alone stands between that edit and every unpublished
  --            strategy's venue going public.
  -- RED-UNDER-M: {"arm":"TV-unpublished","apply":[{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"   WHERE s.status = 'published'\n     AND s.id = ANY(p_strategy_ids)\n  UNION","replace":"   WHERE s.id = ANY(p_strategy_ids)\n  UNION","occurrences":1}]}
  SET LOCAL ROLE anon;
  SELECT count(*) INTO venue_rows
    FROM get_published_trade_venues(ARRAY[strat_priv]) v;
  RESET ROLE;
  IF venue_rows IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (TV-unpublished): PUBLISHED-GATE BREACH — anon got % venue row(s) for the PRIVATE (unpublished) strategy, expected 0. A non-published venue leaked.', venue_rows;
  END IF;

  -- ----- TV-unpublished-composite: the same gate on the strategy_keys path ---
  -- RED-UNDER: drop the published predicate from the strategy_keys arm only
  --            (the second SELECT's `WHERE s.status = 'published'`). TV-unpublished
  --            still passes because its strategy has no strategy_keys member.
  -- RED-UNDER-M: {"arm":"TV-unpublished-composite","apply":[{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"    JOIN public.api_keys k ON k.id = sk.api_key_id\n   WHERE s.status = 'published'\n     AND s.id = ANY(p_strategy_ids);","replace":"    JOIN public.api_keys k ON k.id = sk.api_key_id\n   WHERE s.id = ANY(p_strategy_ids);","occurrences":1}]}
  SET LOCAL ROLE anon;
  SELECT count(*) INTO venue_rows
    FROM get_published_trade_venues(ARRAY[strat_priv_c]) v;
  RESET ROLE;
  IF venue_rows IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (TV-unpublished-composite): PUBLISHED-GATE BREACH — anon got % venue row(s) for the PRIVATE composite (strategy_keys member), expected 0. A non-published venue leaked through strategy_keys.', venue_rows;
  END IF;

  -- ----- TV-strategy-keys: D-04's second path --------------------------------
  -- A published composite has api_key_id NULL and its key through strategy_keys.
  -- RED-UNDER: drop the strategy_keys arm — the second SELECT and its UNION are
  --            removed, leaving only the single-key path.
  -- RED-UNDER-M: {"arm":"TV-strategy-keys","apply":[{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"\n  UNION\n  SELECT s.id,\n         lower(k.exchange)\n    FROM public.strategies s\n    JOIN public.strategy_keys sk ON sk.strategy_id = s.id\n    JOIN public.api_keys k ON k.id = sk.api_key_id\n   WHERE s.status = 'published'\n     AND s.id = ANY(p_strategy_ids);","replace":";","occurrences":1}]}
  SET LOCAL ROLE anon;
  SELECT count(*), min(v.exchange) INTO venue_rows, venue
    FROM get_published_trade_venues(ARRAY[strat_sk]) v;
  RESET ROLE;
  IF venue_rows IS DISTINCT FROM 1 OR venue IS DISTINCT FROM 'bybit' THEN
    RAISE EXCEPTION 'TEST FAILED (TV-strategy-keys): anon got % venue row(s) (venue=%) for the published composite, expected exactly one row naming bybit — the strategy_keys path is not read', venue_rows, venue;
  END IF;

  -- ----- TV-distinct-lower: one lowercase row per distinct venue -------------
  -- A key reached through BOTH paths must yield exactly one row. (The lowercasing
  -- is belt-and-braces over api_keys_exchange_check, which already forbids upper
  -- case on the real schema, so a mixed-case fixture cannot be seeded here.)
  -- RED-UNDER: replace the UNION with UNION ALL, so the two arms' duplicate
  --            (strategy, okx) rows are both returned.
  -- RED-UNDER-M: {"arm":"TV-distinct-lower","apply":[{"kind":"edit","file":"supabase/migrations/20261019120000_get_published_trade_venues.sql","find":"\n  UNION\n","replace":"\n  UNION ALL\n","occurrences":1}]}
  SET LOCAL ROLE anon;
  SELECT count(*), min(v.exchange) INTO venue_rows, venue
    FROM get_published_trade_venues(ARRAY[strat_dual]) v;
  RESET ROLE;
  IF venue_rows IS DISTINCT FROM 1 OR venue IS DISTINCT FROM 'okx' THEN
    RAISE EXCEPTION 'TEST FAILED (TV-distinct-lower): anon got % venue row(s) (venue=%) for a strategy reaching okx through both paths, expected exactly one lowercase okx row', venue_rows, venue;
  END IF;

  RAISE NOTICE 'test_get_published_trade_venues: ALL PASS (catalogue pinned, grants held, key venue wins, published-gate holds on both paths).';
END
$$;

ROLLBACK;
