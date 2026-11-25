-- ============================================================================
-- Phase 225 ONEACCOUNTONCE, plan 10 (CONN-03, founder ruling Q2 "Separate server
-- column", decision D-01): migration B, the index step of the rollout.
--
-- WHAT: (1) the unique index api_keys_user_exchange_venue_account_uniq is rebuilt UNDER
-- THE SAME NAME with a fourth key member, (COALESCE(venue_server, '')), so the same MT5
-- login on two different broker servers is two different accounts and no longer
-- collides; (2) reconnect_allocator_api_key gains the matching wildcard in its
-- live-sibling EXISTS, so a reconnect refuses exactly what the index and the app fences
-- call the same account.
--
-- ROLLOUT ORDER (CONTEXT Q2): column first (20261123180000), then the writers and the
-- backfill (PR-2), then THIS index change. It merges only after the gate-A5 census on
-- PROD passed: no live active MT5 key with a null server, and at least one daily poll
-- after the PR-2 deploy. A half-finished backfill errs toward refusing, never toward a
-- silent duplicate, because a null server is NOT a wildcard at the index (see below).
--
-- WHY THE SAME NAME (D-01): one index, so pgConstraintName stays unambiguous for every
-- app mapping that reads it. The predicate is unchanged:
-- venue_account_id IS NOT NULL AND disconnected_at IS NULL.
--
-- WHY THE DROP AND THE CREATE ARE ONE MIGRATION: the DROP's ACCESS EXCLUSIVE lock on
-- api_keys is held until this migration's transaction ends, so no row can be written
-- through the gap between the two statements. The new key is STRICTLY FINER than the
-- old one (it adds a member), so no stored row can violate it; the build cannot fail on
-- existing data.
--
-- ⛔ NULL IS NOT A WILDCARD AT THE INDEX. COALESCE(venue_server, '') makes two null
-- servers EQUAL, so two live keys on one login that both lack a server are still
-- refused, and a null server beside a set one is ADMITTED. The wildcard (null matches
-- any server) lives in the application fences and in reconnect below. The index could
-- not express a wildcard, and refusing the null-null pair keeps today's guarantee for
-- every key the backfill has not stamped yet.
--
-- RECONNECT, RE-BASED. reconnect_allocator_api_key is re-based on its LATEST definition,
-- 20260925120000_api_keys_account_identity.sql (snapshot
-- supabase/schema/functions/reconnect_allocator_api_key.sql before this file; no later
-- migration redefines it, re-grepped on this tree). The ONLY changes are the
-- v_venue_server declaration, its addition to the SELECT, and one EXISTS line:
--   AND (s.venue_server IS NULL OR v_venue_server IS NULL OR s.venue_server = v_venue_server)
-- Every other line is byte-identical so the RECON gate twins keep their find strings.
-- CREATE OR REPLACE on the same signature keeps one overload, but the REVOKE/GRANT pair
-- of 20260925120000 is RE-ISSUED here verbatim anyway: this repo re-asserts an ACL
-- whenever it re-creates a function (the hazard class of 20260814120000).
--
-- ⛔ THIS MIGRATION READS NO TABLE ROW. The self-verify at the foot reads pg_catalog
-- only. Shared TEST holds PROD's catalogue and none of its data, and a failed TEST
-- apply blocks the PROD apply; scripts/lint-migration-data-dependence.mjs refuses a
-- data-reading DO guard. It also asserts nothing a gate twin mutates (the reconnect
-- body text, the index expression text beyond its member).
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- VAC-04 ACKNOWLEDGEMENT. This migration changes ONE existing function body. The pragma
-- below is the `live` column of the row of
--   git show origin/main:supabase/schema/functions/reconnect_allocator_api_key.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/reconnect_allocator_api_key.sql <scratch>
-- derived LOCALLY, aiming `live` at the committed snapshot origin/main carries. It is
-- ORIGIN/MAIN'S BODY STANDING IN FOR PROD: the ack is EARNED only if VAC-04 on the PR
-- reports that SAME hash for PROD. If it reports another, fold the difference into this
-- migration and re-derive; never edit a pragma to match a gate log.
--
-- prod-body-ack: d5ef374c79d00b10c303bdbde81030602b35da67798dc2b1eb63a624fb593159
--
-- Rollback: supabase/migrations/down/20261125083433-rollback.sql (manual, never
-- auto-applied; it restores the login-only index and the 20260925120000 body).
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the index, same name, one more member.
-- --------------------------------------------------------------------------
DROP INDEX public.api_keys_user_exchange_venue_account_uniq;

CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq
  ON public.api_keys (user_id, exchange, venue_account_id, (COALESCE(venue_server, '')))
  WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL;

COMMENT ON INDEX public.api_keys_user_exchange_venue_account_uniq IS
  'One LIVE key per (owner, exchange, account, server). Phase 225 / CONN-03 added the fourth member COALESCE(venue_server, ''''): the same MT5 login on two different broker servers is two accounts and both may be live. A NULL server is NOT a wildcard here (two null servers are equal, a null beside a set server is admitted); the wildcard that treats an unstamped server as matching any server lives in the application fences and in reconnect_allocator_api_key. Partial on venue_account_id IS NOT NULL AND disconnected_at IS NULL, so a retained disconnected key never squats the slot. CONTRACT (Phase 154 / WIZCONT-02, unchanged): it FAILS TOWARD THE EXISTING ROW, so a duplicate INSERT raises 23505 and the route resolves onto the row already there; it is never resolved by overwriting. user_id LEADS, so uniqueness is per tenant. api_keys_venue_account_id_nonblank keeps blank out of the key.';

-- --------------------------------------------------------------------------
-- STEP 2 - reconnect_allocator_api_key, re-based on 20260925120000, + the wildcard.
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reconnect_allocator_api_key(
  p_api_key_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_exchange     TEXT;
  v_venue_acct   TEXT;
  v_venue_server TEXT;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at, exchange, venue_account_id, venue_server
    INTO v_owner, v_already_disc, v_exchange, v_venue_acct, v_venue_server
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'reconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: not disconnected → NO-OP.
  IF v_already_disc IS NULL THEN
    RETURN false;
  END IF;

  -- Phase 167.1.2 Pitfall 5: a LIVE sibling already holds this account. Refuse
  -- by name before the UPDATE reaches api_keys_user_exchange_venue_account_uniq.
  -- A concurrent race past this check still hits the index and raises the SAME
  -- SQLSTATE, so one client mapping covers both.
  -- Phase 225 / CONN-03: "the same account" now means the same login AND, when both
  -- keys carry a server, the same server. A key whose server is not captured yet
  -- (NULL) reads as a wildcard and still counts as the same account.
  IF v_venue_acct IS NOT NULL AND EXISTS (
    SELECT 1
      FROM api_keys s
     WHERE s.user_id = v_uid
       AND s.exchange = v_exchange
       AND s.venue_account_id = v_venue_acct
       AND s.disconnected_at IS NULL
       AND s.id <> p_api_key_id
       AND (s.venue_server IS NULL OR v_venue_server IS NULL OR s.venue_server = v_venue_server)
  ) THEN
    RAISE EXCEPTION 'KEY_VENUE_ALREADY_CONNECTED'
      USING ERRCODE = 'unique_violation',
            DETAIL  = 'Another connected key of this user already reads the same exchange account.';
  END IF;

  UPDATE api_keys
    SET disconnected_at = NULL,
        sync_error      = NULL,
        sync_status     = 'idle',
        history_inclusion = NULL
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NOT NULL;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.reconnect_allocator_api_key IS
  'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected. Phase 167.1.2: refuses with SQLSTATE 23505 and message KEY_VENUE_ALREADY_CONNECTED, leaving the key disconnected, when a LIVE key of the same user, exchange and venue_account_id exists; a race that reaches api_keys_user_exchange_venue_account_uniq raises the same SQLSTATE. Phase 225: a live sibling on a DIFFERENT server no longer blocks it; a sibling whose server or this key''s server is NULL (not captured yet) is a wildcard and still blocks it. A successful reconnect also resets history_inclusion to NULL, so an include/exclude choice made for a past departure never applies to a later one.';

-- The ACL pair of 20260925120000, re-issued verbatim.
REVOKE ALL ON FUNCTION public.reconnect_allocator_api_key(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconnect_allocator_api_key(uuid)
  TO authenticated;

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: the index exists under its name, is UNIQUE, keys on four
-- attributes, its expression member and predicate mention the columns they must, and
-- reconnect has one overload that is SECURITY DEFINER with a pinned search_path and the
-- re-issued ACL. Deliberately NOT asserted: the reconnect body text and the exact
-- expression text. The RECON gate twins edit the body and the index gate's twins
-- rebuild the expression, so a verify block that read them would abort the apply of a
-- mutated copy before the gate could go RED on the behaviour.
DO $verify$
DECLARE
  v_idx_oid  oid;
  v_fn_oid   oid;
  v_count    int;
  v_natts    int;
  v_unique   boolean;
  v_exprs    text;
  v_pred     text;
BEGIN
  SELECT c.oid INTO v_idx_oid
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'api_keys_user_exchange_venue_account_uniq' AND c.relkind = 'i';
  IF v_idx_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: api_keys_user_exchange_venue_account_uniq does not exist';
  END IF;

  SELECT i.indisunique, i.indnkeyatts, pg_get_expr(i.indexprs, i.indrelid), pg_get_expr(i.indpred, i.indrelid)
    INTO v_unique, v_natts, v_exprs, v_pred
    FROM pg_index i WHERE i.indexrelid = v_idx_oid;
  IF NOT v_unique THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: api_keys_user_exchange_venue_account_uniq is not UNIQUE';
  END IF;
  IF v_natts <> 4 THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: api_keys_user_exchange_venue_account_uniq keys on % attributes, expected 4', v_natts;
  END IF;
  IF v_exprs IS NULL OR v_exprs NOT ILIKE '%venue_server%' THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: the index has no expression member over venue_server (got %)', v_exprs;
  END IF;
  IF v_pred IS NULL OR v_pred NOT ILIKE '%venue_account_id IS NOT NULL%' OR v_pred NOT ILIKE '%disconnected_at IS NULL%' THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: the index predicate lost a live-key conjunct (got %)', v_pred;
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reconnect_allocator_api_key';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: expected exactly 1 reconnect_allocator_api_key overload in public, found %', v_count;
  END IF;

  v_fn_oid := to_regprocedure('public.reconnect_allocator_api_key(uuid)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: reconnect_allocator_api_key(uuid) does not resolve';
  END IF;

  IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: reconnect_allocator_api_key is not SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS cfg
                  WHERE p.oid = v_fn_oid AND cfg LIKE 'search_path=%') THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: reconnect_allocator_api_key has no pinned search_path';
  END IF;

  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: authenticated holds no EXECUTE on reconnect_allocator_api_key, so every reconnect would answer 42501';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: anon holds EXECUTE on reconnect_allocator_api_key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261125083433 failed: PUBLIC holds EXECUTE on reconnect_allocator_api_key';
  END IF;

  RAISE NOTICE 'Migration 20261125083433: api_keys_user_exchange_venue_account_uniq is UNIQUE on 4 attributes with the venue_server member; reconnect_allocator_api_key has one SECURITY DEFINER overload with the re-issued ACL.';
END
$verify$;
