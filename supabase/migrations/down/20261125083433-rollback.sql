-- ============================================================================
-- ROLLBACK for 20261125083433_api_keys_venue_server_index.sql
-- Phase 225 ONEACCOUNTONCE, plan 10 (CONN-03, founder ruling Q2, decision D-01).
-- ============================================================================
-- Manual, off the auto-apply path. This file is ONE transaction of its own (BEGIN ... COMMIT
-- below), so it either happens whole or not at all however it is invoked; do not add
-- --single-transaction, which would nest a second BEGIN:
--
--   psql -v ON_ERROR_STOP=1 -f <this file>
--
-- against the database the marker query in CLAUDE.md names. Run that query FIRST:
--
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
--
-- current_database() is `postgres` on BOTH projects and proves nothing; if the marker is
-- NULL, re-set it before running anything here. What this file undoes:
--   1. Rebuilds api_keys_user_exchange_venue_account_uniq as the LOGIN-ONLY index it was
--      (user_id, exchange, venue_account_id) WHERE venue_account_id IS NOT NULL AND
--      disconnected_at IS NULL, under the same name.
--   2. Restores reconnect_allocator_api_key to its 20260925120000 body and ACL (the
--      login-only EXISTS, without the server wildcard).
--
-- ⚠️ THE INDEX REBUILD CAN REFUSE. The login-only key is COARSER than the one it replaces,
-- so if the same owner now holds two LIVE keys on one MT5 login on two different servers
-- (the very state this migration admitted), CREATE UNIQUE INDEX fails with 23505 and the
-- whole rollback aborts with nothing changed. Disconnect one of each such pair first, by the
-- product's own control (never delete a key), then run this file.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261125083433 as applied and `supabase db push` will not re-apply the
-- migration. To re-apply it, mark it reverted with
-- `supabase migration repair --status reverted 20261125083433` against the intended
-- database, after the marker query above names that database.
--
-- The DO block before the change is a catalogue-only PRECONDITION and the DO block after
-- it is a catalogue-only verify. Neither reads a row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_natts int;
BEGIN
  SELECT i.indnkeyatts INTO v_natts
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'api_keys_user_exchange_venue_account_uniq';
  IF v_natts IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261125083433 refused: api_keys_user_exchange_venue_account_uniq does not exist. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
  IF v_natts <> 4 THEN
    RAISE EXCEPTION 'Rollback 20261125083433 refused: the index keys on % attributes, not the 4 this migration created, so this rollback already ran or the database is in another state. Nothing was changed.', v_natts;
  END IF;
END
$precondition$;

-- 1. The login-only index, same name.
DROP INDEX public.api_keys_user_exchange_venue_account_uniq;

CREATE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq
  ON public.api_keys (user_id, exchange, venue_account_id)
  WHERE venue_account_id IS NOT NULL AND disconnected_at IS NULL;

COMMENT ON INDEX public.api_keys_user_exchange_venue_account_uniq IS
  'One LIVE key per (owner, exchange, account). Login-only, as before Phase 225 / CONN-03 (restored by the rollback of 20261125083433). Partial on venue_account_id IS NOT NULL AND disconnected_at IS NULL, so a retained disconnected key never squats the slot. CONTRACT (Phase 154 / WIZCONT-02): it FAILS TOWARD THE EXISTING ROW, so a duplicate INSERT raises 23505 and the route resolves onto the row already there; it is never resolved by overwriting. user_id LEADS, so uniqueness is per tenant.';

-- 2. reconnect_allocator_api_key, body as of 20260925120000.
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
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at, exchange, venue_account_id
    INTO v_owner, v_already_disc, v_exchange, v_venue_acct
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
  IF v_venue_acct IS NOT NULL AND EXISTS (
    SELECT 1
      FROM api_keys s
     WHERE s.user_id = v_uid
       AND s.exchange = v_exchange
       AND s.venue_account_id = v_venue_acct
       AND s.disconnected_at IS NULL
       AND s.id <> p_api_key_id
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
  'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected. Phase 167.1.2: refuses with SQLSTATE 23505 and message KEY_VENUE_ALREADY_CONNECTED, leaving the key disconnected, when a LIVE key of the same user, exchange and venue_account_id exists; a race that reaches api_keys_user_exchange_venue_account_uniq raises the same SQLSTATE. A successful reconnect also resets history_inclusion to NULL, so an include/exclude choice made for a past departure never applies to a later one.';

REVOKE ALL ON FUNCTION public.reconnect_allocator_api_key(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconnect_allocator_api_key(uuid)
  TO authenticated;

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
DECLARE
  v_fn_oid oid;
  v_count  int;
  v_natts  int;
BEGIN
  SELECT i.indnkeyatts INTO v_natts
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relname = 'api_keys_user_exchange_venue_account_uniq' AND i.indisunique;
  IF v_natts IS DISTINCT FROM 3 THEN
    RAISE EXCEPTION 'Rollback 20261125083433 failed: expected a UNIQUE index on 3 attributes, found %', v_natts;
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'reconnect_allocator_api_key';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Rollback 20261125083433 failed: expected exactly 1 reconnect_allocator_api_key overload in public, found %', v_count;
  END IF;

  v_fn_oid := to_regprocedure('public.reconnect_allocator_api_key(uuid)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261125083433 failed: reconnect_allocator_api_key(uuid) does not resolve';
  END IF;
  IF NOT has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261125083433 failed: authenticated holds no EXECUTE on reconnect_allocator_api_key';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261125083433 failed: anon holds EXECUTE on reconnect_allocator_api_key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261125083433 failed: PUBLIC holds EXECUTE on reconnect_allocator_api_key';
  END IF;

  RAISE NOTICE 'Rollback 20261125083433: the login-only api_keys_user_exchange_venue_account_uniq and the 20260925120000 reconnect_allocator_api_key are restored. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
