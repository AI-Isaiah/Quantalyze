-- ============================================================================
-- ROLLBACK for 20261114120000_get_published_trade_venues_open_windows.sql
-- Phase 210 PUBLICTRUTH, plan 01 (D-05; TODOS 170.6.1-VENUES-CLOSED-KEY-WINDOWS).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It re-applies the 20261019120000 definition of
-- public.get_published_trade_venues, its grants and its COMMENT, with CREATE OR
-- REPLACE (STEP 1 to STEP 3 below are that migration's body, including its
-- catalogue-only self-verify). That drops the open-window predicate from the
-- strategy_keys arm, so a member whose window has closed is read again and its old
-- venue can once more raise a false mismatch cue on Discovery. There is no DROP
-- here: the function keeps its identity, so the reader and every grant stay in
-- place throughout.
--
-- WHAT ROLLING BACK COSTS. No data changes; only the function body and its COMMENT
-- move. Callers see the same two columns. The committed function snapshot
-- supabase/schema/functions/get_published_trade_venues.sql names the migration it
-- was replayed from, so re-dump it (npm run schema:functions) in the same change.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261114120000 as applied while the function no longer carries its body.
-- `supabase db push` will therefore NOT re-apply the migration. To re-apply it,
-- delete that ledger row in the same change that re-applies it (or mark it reverted
-- with `supabase migration repair --status reverted 20261114120000` against the
-- intended database, after the marker query in CLAUDE.md names that database).
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: get_published_trade_venues — the 20261019120000 body (no window predicate)
-- ==========================================================================
CREATE OR REPLACE FUNCTION public.get_published_trade_venues(p_strategy_ids uuid[])
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
    RAISE EXCEPTION 'Rollback 20261114120000: get_published_trade_venues function missing';
  END IF;

  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'Rollback 20261114120000: get_published_trade_venues is NOT SECURITY DEFINER';
  END IF;

  IF NOT COALESCE((SELECT 'search_path=public, pg_temp' = ANY(proconfig)
                     FROM pg_proc WHERE oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Rollback 20261114120000: get_published_trade_venues missing SET search_path = public, pg_temp';
  END IF;

  IF v_result IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text)' THEN
    RAISE EXCEPTION 'Rollback 20261114120000: get_published_trade_venues result shape is "%", expected "TABLE(strategy_id uuid, exchange text)" (column allow-list: no key id, label or encrypted field)', v_result;
  END IF;

  IF NOT has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261114120000: anon lacks EXECUTE on get_published_trade_venues (public venue unreadable)';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261114120000: authenticated lacks EXECUTE on get_published_trade_venues';
  END IF;

  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261114120000: PUBLIC still holds EXECUTE on get_published_trade_venues';
  END IF;

  RAISE NOTICE 'Rollback 20261114120000: get_published_trade_venues restored to the 20261019120000 body (catalogue verified: SECDEF, pinned search_path, allow-listed shape, explicit grants).';
END $$;

COMMIT;
