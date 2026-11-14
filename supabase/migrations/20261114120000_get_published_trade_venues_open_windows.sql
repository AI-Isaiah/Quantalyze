-- Migration 20261114120000: get_published_trade_venues — read only the strategy_keys members whose
-- window is still open, so a key rotation stops raising a false venue-mismatch cue on Discovery.
-- Phase 210 PUBLICTRUTH, plan 01 (SC-1; locked decisions D-01 to D-05;
-- TODOS 170.6.1-VENUES-CLOSED-KEY-WINDOWS).
--
-- Why this migration exists
-- -------------------------
-- A composite strategy reads its trades through `strategy_keys`, one row per key and per
-- half-open window [window_start, window_end). When a manager rotates a key from one venue to
-- another, the old member is NOT deleted: its window is closed and a new member opens. The
-- function this migration replaces joined every member, open or closed, so the closed member's
-- venue kept reaching the public Discovery row. SyncBadge then compared the venue the manager
-- LISTED against the venues the trades come from, saw a venue that no longer supplies a single
-- trade, and raised a "Listed as X; trades come from ..." cue that named a venue the strategy had
-- already left. The cue is a public claim; it has to come only from a key that currently feeds
-- the strategy.
--
-- FULL-BODY RE-BASE of 20261019120000_get_published_trade_venues.sql, the only definition of this
-- function (no later migration touches it). CREATE OR REPLACE swaps the WHOLE body, so this file
-- carries the entire 20261019120000 body verbatim plus the one change below, and re-asserts the
-- grants, the pinned search_path, the result shape and the catalogue self-verify. A partial
-- re-base would silently drop whichever guard it failed to restate.
--
-- THE ONE SEMANTIC CHANGE (D-01)
-- ------------------------------
-- The strategy_keys arm gains one predicate: a member counts when its window has no end (NULL
-- means still active) or when its end falls after today. The window is half-open, so the end date
-- itself is already outside it: a member whose window ends today, or earlier, has closed and is
-- not returned. A published composite whose every member has closed therefore gets zero rows, and
-- the reader leaves that row's venue fields unset, so no cue is raised and the listed exchange
-- stands (D-06).
--   * The single-key arm (strategies.api_key_id) is byte-identical to 20261019120000 (D-02). A
--     strategies.api_key_id has no window. A member whose window opens in the future is NOT
--     filtered either: only the end of the window is judged here, because a future-dated member is
--     a scheduled hand-over and the deferred idea of treating it as not-yet-active is out of scope.
--   * The UNION is unchanged, so a key reached through both arms still yields one row.
--   * Today is the database's current_date, the same clock the window CHECK and the readers use.
--
-- What this migration does
-- ------------------------
-- 1. CREATE OR REPLACE public.get_published_trade_venues(uuid[]) with the same signature, the same
--    result table, LANGUAGE sql, STABLE, SECURITY DEFINER and SET search_path = public, pg_temp
--    (D-03). The two ACL statements below are restated in full.
-- 2. REVOKE ALL FROM PUBLIC; GRANT EXECUTE TO anon, authenticated, service_role (D-03).
-- 3. A CATALOGUE-ONLY self-verify (D-04). It reads pg_proc, the privilege functions and the stored
--    body text, and nothing else: no table is read, so it applies on TEST's empty tables exactly as
--    on PROD ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). It also fails the apply when the window
--    predicate is missing from the stored body. The behavioural proof is
--    supabase/tests/test_get_published_trade_venues.sql.
--
-- What this migration does NOT do
-- -------------------------------
-- - No RLS change and no grant change on api_keys or strategy_keys.
-- - No data change, no cron, no schedule.
-- - No change to the reader: readPublishedTradeVenues already treats a strategy with no row as
--   "no venue known" and leaves its listed exchange alone.
--
-- Rollback: supabase/migrations/down/20261114120000-rollback.sql (manual, never auto-applied; it
-- restores the 20261019120000 body with CREATE OR REPLACE and contains no DROP, D-05).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: get_published_trade_venues — the published-only venue primitive, open windows only
-- ==========================================================================
-- All source columns are alias-qualified (s. / sk. / k.) so the OUT-parameter
-- names (strategy_id, exchange) never shadow a source column.
-- VAC-04: PROD's live body before this migration equals the committed baseline snapshot
-- (the same hash sql-gate-lint reports for supabase/schema/baseline.sql), so this replace
-- overwrites no out-of-band patch.
--   get_published_trade_venues/1
-- prod-body-ack: 1dd7db89ef0e3df11e878f2ab68bfb79c8e91dc31ad6ec0cac06965ab90e2d48
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
     AND s.id = ANY(p_strategy_ids)
     AND (sk.window_end IS NULL OR sk.window_end > current_date);
$$;

COMMENT ON FUNCTION public.get_published_trade_venues(uuid[]) IS
  'Phase 170.6.1 DISCOVERYPHONE (SC-2, D-04), re-based by Phase 210 PUBLICTRUTH (D-01): the venue a PUBLISHED strategy''s trades come from — the distinct lowercased api_keys.exchange reached through strategies.api_key_id and through strategy_keys members whose window is still open (a member whose window has closed is not returned). Correct-by-construction public exposure: SECURITY DEFINER + pinned search_path lets anon read WITHOUT widening api_keys or strategy_keys access. The result table (strategy_id, exchange) is the column allow-list: a key id, label or encrypted field is structurally unreachable. The status gate on strategies is the published-gate. Sole reader in app code: readPublishedTradeVenues.';

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
  v_src     TEXT;
BEGIN
  SELECT p.oid, p.prosecdef, pg_get_function_result(p.oid), p.prosrc
    INTO v_fn_oid, v_secdef, v_result, v_src
    FROM pg_proc p
   WHERE p.proname = 'get_published_trade_venues'
     AND p.pronamespace = 'public'::regnamespace;
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261114120000: get_published_trade_venues function missing';
  END IF;

  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'Migration 20261114120000: get_published_trade_venues is NOT SECURITY DEFINER';
  END IF;

  IF NOT COALESCE((SELECT 'search_path=public, pg_temp' = ANY(proconfig)
                     FROM pg_proc WHERE oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261114120000: get_published_trade_venues missing SET search_path = public, pg_temp';
  END IF;

  IF v_result IS DISTINCT FROM 'TABLE(strategy_id uuid, exchange text)' THEN
    RAISE EXCEPTION 'Migration 20261114120000: get_published_trade_venues result shape is "%", expected "TABLE(strategy_id uuid, exchange text)" (column allow-list: no key id, label or encrypted field)', v_result;
  END IF;

  -- D-01: the open-window predicate is in the stored body. Presence, read from the catalogue.
  IF position('sk.window_end > current_date' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Migration 20261114120000: get_published_trade_venues body is missing the open-window predicate on strategy_keys (D-01); a closed key window would still name its venue';
  END IF;

  IF NOT has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261114120000: anon lacks EXECUTE on get_published_trade_venues (public venue unreadable)';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261114120000: authenticated lacks EXECUTE on get_published_trade_venues';
  END IF;

  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261114120000: PUBLIC still holds EXECUTE on get_published_trade_venues';
  END IF;

  RAISE NOTICE 'Migration 20261114120000: get_published_trade_venues re-based (catalogue verified: SECDEF, pinned search_path, allow-listed shape, open-window predicate present, explicit grants).';
END $$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 20261114120000
-- ==========================================================================
-- Rollback: supabase/migrations/down/20261114120000-rollback.sql (manual only).
-- Downstream reader (unchanged): src/lib/queries.ts readPublishedTradeVenues.
