-- ============================================================================
-- Phase 225 ONEACCOUNTONCE, plan 04 (MT5D-08, founder ruling Q1 "Admit working
-- key", D-25): migration A2, the ONE function that moves an account's holder slot.
--
-- WHAT: public.swap_account_slot(p_new_key, p_old_holder, p_venue_account_id,
-- p_venue_server DEFAULT NULL) RETURNS void. A working key of the same owner takes
-- the account's slot from a same-owner key that is NOT working (D-18). In ONE
-- transaction it moves the stamp (venue_account_id and venue_server) onto the new key
-- and marks the old holder 'duplicate' against it, so the account is still counted
-- once, by a key that works. Nothing is disconnected or deleted (D-01, Q1).
--
-- WHY ONE FUNCTION: neither PostgREST client (the connect routes, the poll stamper)
-- can write the slot and the marker together. A run of separate calls leaves a window
-- in which a marked sibling's poll takes the freed slot. One transaction, and row
-- locks taken in id order, close that window and serialise two swaps, or a swap and a
-- stamp, on the same rows.
--
-- THE LOCK SET IS THE PAIR PLUS THE OLD HOLDER'S DEPENDENTS, TAKEN IN ONE id-ORDERED
-- PASS. Step (b) writes every 'duplicate' dependent of the old holder. If those rows
-- were locked only when step (b) reached them, two swaps on sibling duplicates of one
-- failing holder (N1 and N2 both marked against H) would take locks in opposite orders
-- and one of them would answer a raw 40P01. Locking them up front, in the same
-- ORDER BY id, makes both callers queue on the same first row instead. The function
-- also carries SET lock_timeout = '3s' like create_wizard_strategy, so a wait is
-- bounded. Residual: a dependent that points at the old holder only AFTER the lock
-- query's snapshot is not in the set; no gate drives two sessions, so that is argued
-- here and not tested.
--
-- THE CALLER PASSES THE LOGIN AND THE SERVER. The function does not read them off the
-- new row (an unstamped key carries neither). It re-checks EVERY fact itself on the
-- locked rows: same owner, both keys live, same exchange, the old holder really holds
-- this login, the old holder is not working and the new key is, and no composite
-- depends on the old holder. A refusal is a stable token in the message, a static
-- DETAIL with no login or server in it, and no write at all.
--
-- ⛔ WRITE ORDER IS FIXED BY THE MARKER TRIGGER AND THE UNIQUE INDEX
-- (20260925120000 enforce_api_keys_account_share_same_owner: a named holder must
-- exist, share the owner, be live, not be marked itself, and the marked row must not
-- itself hold another key; api_keys_user_exchange_venue_account_uniq: one live key per
-- (user, exchange, login)):
--   (a) a new key already marked against the old holder (the stamper's heal case) is
--       unmarked first, or the trigger refuses ACCOUNT_SHARE_HOLDER_IS_MARKED;
--   (b) every 'duplicate' dependent of the old holder is re-pointed at the new key
--       BEFORE the old holder is marked, or the trigger refuses
--       ACCOUNT_SHARE_KEY_IS_A_HOLDER;
--   (c) the old holder gives up its login AND its server and is marked in ONE UPDATE,
--       freeing the index slot (a server left beside a NULL login is an identity
--       fragment on a row that holds no account);
--   (d) only then is the new key stamped. NULL is a wildcard in the caller's server and
--       never erases a known one: when the caller passes none, the new key keeps the
--       old holder's captured server (COALESCE).
--
-- ⛔ A 'composite_member' DEPENDENT REFUSES THE SWAP (ACCOUNT_SLOT_COMPOSITE_DEPENDENT).
-- Composites are out of scope (F-2 / Q4). A failing holder inside a composite keeps its
-- slot and the working key stays marked 'duplicate', which is today's stable state.
--
-- NORMAL FORM OF THE LOGIN AND THE SERVER: btrim(x, E' \t\r\n'), so a tab-only or
-- newline-only value is blank and never a real identity; the server is then lower-cased
-- and blank-to-NULL. A server longer than 128 characters after that is refused with a
-- token BEFORE any lock or write, instead of reaching api_keys_venue_server_valid as a
-- raw 23514.
--
-- ⛔ THE D-18 TUPLE LIVES IN THIS BODY ONCE. The parity tests (src/lib/account-share-note.test.ts
-- and analytics-service/tests/test_derive_allocator_equity_job.py) read the one status
-- tuple from this file and require it to equal the TypeScript and Python sets. Do not
-- copy the tuple into a second place, and do not restate it in a comment.
--
-- ⛔ SECURITY: SECURITY DEFINER, search_path pinned, EXECUTE for service_role ONLY.
-- Supabase's pg_default_acl grants every function postgres creates in public to anon and
-- authenticated, so the REVOKE below is load-bearing: without it any signed-in browser
-- could move another tenant's slot. Same-owner is asserted INSIDE the function as well.
--
-- A NEW function name, so a plain CREATE FUNCTION (no OR REPLACE, no sibling overload).
-- NO DATA CENSUS RUNS INSIDE THIS MIGRATION: shared TEST holds PROD's catalogue and none
-- of its data, so the verify block below reads pg_catalog only and no table row.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer invariant
-- 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to that wrap.
--
-- Rollback (manual, off the auto-apply path): supabase/migrations/down/20261123180100-rollback.sql.
-- EXPECTED RED: node scripts/baseline-content-drift-check.mjs reports SNAPSHOT_MISSING for
-- swap_account_slot until supabase/schema/baseline.sql is re-dumped from PROD after this
-- applies; it is carried by a dated snapshot-only row in scripts/dump-sql-functions.ts.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

CREATE FUNCTION public.swap_account_slot(
  p_new_key          uuid,
  p_old_holder       uuid,
  p_venue_account_id text,
  p_venue_server     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_row            record;
  v_is_active      boolean;
  v_disconnected   timestamptz;
  v_sync_status    text;
  v_working        boolean;
  v_login          text := btrim(p_venue_account_id, E' \t\r\n');
  v_server         text := NULLIF(lower(btrim(p_venue_server, E' \t\r\n')), '');
  v_found_new      boolean := false;
  v_found_old      boolean := false;
  v_new_owner      uuid;
  v_old_owner      uuid;
  v_new_exchange   text;
  v_old_exchange   text;
  v_new_disc       timestamptz;
  v_old_disc       timestamptz;
  v_new_working    boolean;
  v_old_working    boolean;
  v_new_login      text;
  v_old_login      text;
  v_old_server     text;
  v_new_holder     uuid;
  v_old_holder_of  uuid;
BEGIN
  -- 1. The call must name two different keys and a non-blank login.
  IF p_new_key = p_old_holder OR v_login IS NULL OR v_login = '' THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The new key and the old holder must be two different keys and the login must not be blank.';
  END IF;

  IF char_length(v_server) > 128 THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The broker server is longer than 128 characters.';
  END IF;

  -- 2. Lock the two named rows AND every key marked against the old holder, in ONE
  --    id-ordered pass, so two swaps (or a swap and a stamp) that touch any of these rows
  --    queue on the same first row instead of deadlocking, and read the two named rows
  --    into the local variables (a dependent row is locked and otherwise ignored here).
  --    The working-ness expression is written ONCE, here (D-18, founder 2026-09-27):
  --    active, connected, and a last sync that is NULL or none of the failing statuses.
  --    The explicit NULL leg is required: a status test over NULL is NULL, IF treats NULL
  --    as false, and a key that has never synced would be read as failing.
  FOR v_row IN
    SELECT id, user_id, exchange, venue_account_id, venue_server,
           account_shared_with_api_key_id, is_active, disconnected_at, sync_status
      FROM public.api_keys
     WHERE id IN (p_new_key, p_old_holder)
        OR account_shared_with_api_key_id = p_old_holder
     ORDER BY id
       FOR UPDATE
  LOOP
    v_is_active    := v_row.is_active;
    v_disconnected := v_row.disconnected_at;
    v_sync_status  := v_row.sync_status;
    v_working      := false;
    IF v_is_active AND v_disconnected IS NULL AND (v_sync_status IS NULL OR v_sync_status NOT IN ('revoked', 'sign_in_failed', 'error')) THEN
      v_working := true;
    END IF;

    IF v_row.id = p_new_key THEN
      v_found_new    := true;
      v_new_owner    := v_row.user_id;
      v_new_exchange := v_row.exchange;
      v_new_disc     := v_disconnected;
      v_new_working  := v_working;
      v_new_login    := v_row.venue_account_id;
      v_new_holder   := v_row.account_shared_with_api_key_id;
    ELSIF v_row.id = p_old_holder THEN
      v_found_old     := true;
      v_old_owner     := v_row.user_id;
      v_old_exchange  := v_row.exchange;
      v_old_disc      := v_disconnected;
      v_old_working   := v_working;
      v_old_login     := v_row.venue_account_id;
      v_old_server    := NULLIF(lower(btrim(v_row.venue_server, E' \t\r\n')), '');
      v_old_holder_of := v_row.account_shared_with_api_key_id;
    END IF;
  END LOOP;

  -- 3. Refusals, in a fixed order. Each one writes nothing.
  IF NOT v_found_new OR NOT v_found_old THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_NOT_FOUND'
      USING ERRCODE = 'P0002',
            DETAIL  = 'One of the two named keys does not exist.';
  END IF;

  IF v_new_owner IS DISTINCT FROM v_old_owner THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_NOT_SAME_OWNER'
      USING ERRCODE = '42501',
            DETAIL  = 'The two keys must belong to the same user.';
  END IF;

  IF v_new_disc IS NOT NULL OR v_old_disc IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_NOT_LIVE'
      USING ERRCODE = '55000',
            DETAIL  = 'Both keys must be live (disconnected_at IS NULL).';
  END IF;

  IF v_new_exchange IS DISTINCT FROM v_old_exchange THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The two keys are on different exchanges.';
  END IF;

  IF v_old_login IS DISTINCT FROM v_login THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The old holder does not hold the account the caller named.';
  END IF;

  -- NULL on either side is the wildcard (Q2 / F-3): a server not captured yet matches any.
  IF v_old_server IS NOT NULL AND v_server IS NOT NULL AND v_old_server <> v_server THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The old holder sits on a different broker server than the one named.';
  END IF;

  IF v_old_holder_of IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The old holder is itself marked as sharing another key''s account, so it holds no slot.';
  END IF;

  IF v_new_login IS NOT NULL THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The new key already holds an account of its own.';
  END IF;

  IF v_new_holder IS NOT NULL AND v_new_holder <> p_old_holder THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_IDENTITY_MISMATCH'
      USING ERRCODE = '22023',
            DETAIL  = 'The new key is marked against a different key than the old holder.';
  END IF;

  IF v_old_working THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_HOLDER_WORKING'
      USING ERRCODE = '55000',
            DETAIL  = 'The old holder is still working (D-18), so it keeps the account.';
  END IF;

  IF NOT v_new_working THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_NEW_KEY_NOT_WORKING'
      USING ERRCODE = '55000',
            DETAIL  = 'The new key is not working (D-18), so it cannot take the account.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.api_keys d
     WHERE d.account_shared_with_api_key_id = p_old_holder
       AND d.account_share_kind = 'composite_member'
  ) THEN
    RAISE EXCEPTION 'ACCOUNT_SLOT_COMPOSITE_DEPENDENT'
      USING ERRCODE = '23000',
            DETAIL  = 'A composite depends on the old holder (out of scope, F-2), so the slot is not moved.';
  END IF;

  -- 4. Writes, in the order the marker trigger and the unique index require.
  -- (a) A new key that was marked against the old holder is unmarked first.
  IF v_new_holder IS NOT NULL THEN
    UPDATE public.api_keys
       SET account_shared_with_api_key_id = NULL,
           account_share_kind             = NULL
     WHERE id = p_new_key;
  END IF;

  -- (b) Every duplicate dependent of the old holder now points at the new key.
  UPDATE public.api_keys
     SET account_shared_with_api_key_id = p_new_key
   WHERE account_shared_with_api_key_id = p_old_holder
     AND account_share_kind = 'duplicate'
     AND id <> p_new_key;

  -- (c) The old holder gives up the login and the server and is marked, in ONE statement.
  UPDATE public.api_keys
     SET venue_account_id               = NULL,
         venue_server                   = NULL,
         account_shared_with_api_key_id = p_new_key,
         account_share_kind             = 'duplicate'
   WHERE id = p_old_holder;

  -- (d) The new key takes the account. A NULL caller server never erases the known one.
  UPDATE public.api_keys
     SET venue_account_id = v_login,
         venue_server     = COALESCE(v_server, v_old_server)
   WHERE id = p_new_key;
END;
$$;

COMMENT ON FUNCTION public.swap_account_slot(uuid, uuid, text, text) IS
  'Phase 225 ONEACCOUNTONCE (MT5D-08, Q1, D-25), migration 20261123180100: moves an account''s holder slot from a same-owner key that is NOT working (D-18) to a same-owner key that IS, in ONE transaction on the two rows and the old holder''s dependents locked FOR UPDATE in one id-ordered pass (function-level lock_timeout 3s): the new key is stamped with the login and the normalised server (the old holder''s captured server when the caller passes none), the old holder gives up its login and its server and is marked ''duplicate'' against the new key, and every ''duplicate'' dependent of the old holder is re-pointed at the new key. Nothing is disconnected or deleted. Returns void; the caller audits and enqueues the recompose. Refusals (message = token, static DETAIL, nothing written): ACCOUNT_SLOT_NOT_FOUND P0002; ACCOUNT_SLOT_NOT_SAME_OWNER 42501; ACCOUNT_SLOT_NOT_LIVE 55000; ACCOUNT_SLOT_IDENTITY_MISMATCH 22023; ACCOUNT_SLOT_HOLDER_WORKING 55000; ACCOUNT_SLOT_NEW_KEY_NOT_WORKING 55000; ACCOUNT_SLOT_COMPOSITE_DEPENDENT 23000 (a composite_member dependent is out of scope, F-2). Service-role only; callers are the connect routes and the analytics identity stamper.';

REVOKE ALL ON FUNCTION public.swap_account_slot(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.swap_account_slot(uuid, uuid, text, text) TO service_role;

-- Catalogue-only self-verify: reads pg_catalog, never a table row.
DO $verify$
DECLARE
  v_n      INT;
  v_fn_oid OID;
BEGIN
  SELECT count(*)
    INTO v_n
    FROM pg_proc p
   WHERE p.proname = 'swap_account_slot'
     AND p.pronamespace = 'public'::regnamespace;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'Migration 20261123180100: expected exactly one swap_account_slot overload, found %', v_n;
  END IF;

  SELECT p.oid
    INTO v_fn_oid
    FROM pg_proc p
   WHERE p.proname = 'swap_account_slot'
     AND p.pronamespace = 'public'::regnamespace;

  IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261123180100: swap_account_slot is NOT SECURITY DEFINER';
  END IF;

  IF NOT COALESCE((SELECT 'search_path=public, pg_catalog' = ANY(p.proconfig)
                     FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261123180100: swap_account_slot missing SET search_path = public, pg_catalog';
  END IF;

  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180100: service_role lacks EXECUTE on swap_account_slot (the routes and the stamper cannot call it)';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180100: anon can EXECUTE swap_account_slot (a cross-tenant slot writer exposed through PostgREST)';
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180100: authenticated can EXECUTE swap_account_slot (a cross-tenant slot writer exposed through PostgREST)';
  END IF;

  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180100: PUBLIC still holds EXECUTE on swap_account_slot';
  END IF;

  RAISE NOTICE 'Migration 20261123180100: swap_account_slot installed (catalogue verified: one overload, SECDEF, pinned search_path, service_role-only EXECUTE).';
END
$verify$;
