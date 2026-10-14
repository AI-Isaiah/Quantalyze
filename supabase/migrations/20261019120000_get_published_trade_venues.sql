-- Migration 20261019120000: get_published_trade_venues — the public primitive that
-- names the venue a published strategy's trades come from.
-- Phase 170.6.1 DISCOVERYPHONE, plan 01 (SC-2; locked decisions D-04 and D-08).
--
-- Why this migration exists
-- -------------------------
-- A Discovery row labels its exchange from `strategies.supported_exchanges[1]`, the
-- exchange the manager LISTED. The trades, though, come from the exchange of the API
-- key the strategy reads (`api_keys.exchange`), and the two can disagree: the
-- TRADESYNC plan 21 measurement found a published strategy listed on bybit whose key
-- trades on okx. SC-2 makes the row name the venue the trades come from.
--
-- Discovery is read by anon, and anon cannot read `api_keys` (owner-scoped; column
-- grants go to `authenticated` only). So the key's venue has to cross the boundary
-- through a function that is correct BY CONSTRUCTION, in the shape of
-- get_published_trust_signals(uuid[]) (migration 20260719140000):
--   * The RETURNS TABLE signature is the column allow-list. Only (strategy_id,
--     exchange) can ever leave the function. A key id, a label and every encrypted
--     field are structurally unreachable (D-04).
--   * The status gate on strategies is the published-gate. An unpublished
--     strategy's venue is never returned to anyone.
--   * SECURITY DEFINER with a PINNED search_path lets anon read the venue WITHOUT
--     any RLS or grant change on api_keys or strategy_keys.
--
-- What this migration does
-- ------------------------
-- 1. CREATE FUNCTION public.get_published_trade_venues(uuid[]) — LANGUAGE sql,
--    STABLE, SECURITY DEFINER, SET search_path = public, pg_temp. Returns one row
--    per (strategy, distinct lowercased api_keys.exchange), reached through BOTH
--    paths a strategy can hold a key: `strategies.api_key_id` (single key) and
--    `strategy_keys` (composite members). The two arms are UNION-ed, so a key
--    reached through both paths yields one row.
--    Plain CREATE FUNCTION, not CREATE OR REPLACE: the name is new on PROD
--    (measured at planning), so a collision must fail loud instead of replacing
--    someone else's body.
-- 2. REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon, authenticated, service_role.
-- 3. A CATALOGUE-ONLY self-verify. It reads pg_proc and the privilege functions and
--    nothing else: no table is read, so it applies on TEST's empty tables exactly
--    as on PROD ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). The behavioural proof
--    lives in supabase/tests/test_get_published_trade_venues.sql.
--
-- What this migration does NOT do
-- -------------------------------
-- - No RLS change and no grant change on api_keys or strategy_keys.
-- - Nothing about `strategies.api_key_id`'s existing anon read. That is a separate
--   finding owned by Phase 170.6.1.1 ANONKEYID. This function adds nothing to it:
--   its result shape carries no key id.
-- - No reader. The app-layer reader (readPublishedTradeVenues) ships after this
--   migration has applied (readers-first order, PR-A then PR-B), and it degrades to
--   the listed exchange if this function is missing.
--
-- Rollback: supabase/migrations/down/20261019120000-rollback.sql (manual, never
-- auto-applied).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: get_published_trade_venues — the published-only venue primitive
-- ==========================================================================
-- All source columns are alias-qualified (s. / sk. / k.) so the OUT-parameter
-- names (strategy_id, exchange) never shadow a source column.
CREATE FUNCTION public.get_published_trade_venues(p_strategy_ids uuid[])
RETURNS TABLE (strategy_id uuid, exchange text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT s.id,
         lower(k.exchange)
    FROM public.strategies s
    JOIN public.api_keys k ON k.id = s.api_key_id
   WHERE s.status = 'published'
     AND s.id = ANY(p_strategy_ids)
  UNION
  SELECT s.id,
         lower(k.exchange)
    FROM public.strategies s
    JOIN public.strategy_keys sk ON sk.strategy_id = s.id
    JOIN public.api_keys k ON k.id = sk.api_key_id
   WHERE s.status = 'published'
     AND s.id = ANY(p_strategy_ids);
$$;

COMMENT ON FUNCTION public.get_published_trade_venues(uuid[]) IS
  'Phase 170.6.1 DISCOVERYPHONE (SC-2, D-04): the venue a PUBLISHED strategy''s trades come from — the distinct lowercased api_keys.exchange reached through strategies.api_key_id and strategy_keys. Correct-by-construction public exposure: SECURITY DEFINER + pinned search_path lets anon read WITHOUT widening api_keys or strategy_keys access. RETURNS TABLE (strategy_id, exchange) is the column allow-list: a key id, label or encrypted field is structurally unreachable. The status gate on strategies is the published-gate. Sole reader in app code: readPublishedTradeVenues (plan 04).';

-- ==========================================================================
-- STEP 2: REVOKE / GRANT EXECUTE (least privilege, explicit grantees)
-- ==========================================================================
REVOKE ALL ON FUNCTION public.get_published_trade_venues(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_published_trade_venues(uuid[]) TO anon, authenticated, service_role;

-- ==========================================================================
-- STEP 3: self-verify — CATALOGUE ONLY (no table is read)
-- ==========================================================================
DO $$
DECLARE
  v_fn_oid  OID;
  v_secdef  BOOLEAN;
  v_result  TEXT;
BEGIN
  SELECT p.oid, p.prosecdef, pg_get_function_result(p.oid)
    INTO v_fn_oid, v_secdef, v_result
    FROM pg_proc p
   WHERE p.proname = 'get_published_trade_venues'
     AND p.pronamespace = 'public'::regnamespace;
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261019120000: get_published_trade_venues function missing';
  END IF;

  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'Migration 20261019120000: get_published_trade_venues is NOT SECURITY DEFINER';
  END IF;

  IF NOT COALESCE((SELECT 'search_path=public, pg_temp' = ANY(proconfig)
                     FROM pg_proc WHERE oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261019120000: get_published_trade_venues missing SET search_path = public, pg_temp';
  END IF;

  IF v_result IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text)' THEN
    RAISE EXCEPTION 'Migration 20261019120000: get_published_trade_venues result shape is "%", expected "TABLE(strategy_id uuid, exchange text)" (column allow-list: no key id, label or encrypted field)', v_result;
  END IF;

  IF NOT has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261019120000: anon lacks EXECUTE on get_published_trade_venues (public venue unreadable)';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261019120000: authenticated lacks EXECUTE on get_published_trade_venues';
  END IF;

  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261019120000: PUBLIC still holds EXECUTE on get_published_trade_venues';
  END IF;

  RAISE NOTICE 'Migration 20261019120000: get_published_trade_venues installed (catalogue verified: SECDEF, pinned search_path, allow-listed shape, explicit grants).';
END $$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 20261019120000
-- ==========================================================================
-- Downstream consumer (plan 04, after this migration has applied):
--   * src/lib/queries.ts readPublishedTradeVenues — the single typed reader,
--     batched in getStrategiesByCategory beside readPublicVerificationSignals.
