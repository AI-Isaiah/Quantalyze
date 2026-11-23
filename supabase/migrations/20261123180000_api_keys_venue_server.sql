-- ============================================================================
-- Phase 225 ONEACCOUNTONCE, plan 01 (CONN-03, founder ruling Q2 "Separate server
-- column"): migration A1 of the column-and-function step.
--
-- WHAT: (1) api_keys gains a nullable plaintext column venue_server, with one named
-- CHECK; (2) create_wizard_strategy gains a 13th parameter p_venue_server TEXT DEFAULT
-- NULL and stores it, normalised, in the SAME INSERT that stamps venue_account_id.
--
-- WHY A SEPARATE COLUMN: venue_account_id stays the BARE MT5 login, because the 155.2
-- account check hashes that exact value. The broker server travels beside it so the
-- unique index can later tell login 1001 on one broker from login 1001 on another.
--
-- ⛔ THE UNIQUE INDEX api_keys_user_exchange_venue_account_uniq IS NOT TOUCHED HERE.
-- Rollout order is column first, then the writers and the backfill, then the index
-- (plan 10). This migration changes no stored identity and no index, so it cannot move
-- any account's venue_account_id.
--
-- ⛔ NULL IS A WILDCARD IN EVERY APP FENCE. NULL means "the server has not been
-- captured yet" (every key stored before this migration, and every key written by a
-- caller that omits the parameter). The column carries no default and no backfill here:
-- the server exists only inside the encrypted credential, so a backfill is the
-- analytics poll's job, never SQL.
--
-- ⛔ THE COLUMN IS NOT GRANTED. api_keys has had no table-level SELECT for the browser
-- roles since 20260410225608 (a per-column allowlist replaced it), so a new column is
-- readable by nobody but the owner and service_role until a migration grants it, and
-- this one does not and must not. It is also not in API_KEY_USER_COLUMNS_ARR.
-- The server is plaintext by founder ruling Q2 (a broker server name is not a
-- credential), but the browser still never reads it.
--
-- ⛔ WHY DROP THEN CREATE, NOT CREATE OR REPLACE. A parameter cannot be added by
-- CREATE OR REPLACE: it mints a SIBLING OVERLOAD, and PostgREST (which resolves rpc()
-- by named parameters) then answers PGRST203 to every connect. So the 12-parameter
-- function is dropped and the 13-parameter one created, leaving exactly one overload.
-- The trailing DEFAULT NULL keeps today's 12-argument callers resolving, which is what
-- lets this migration merge ahead of the code that sends the parameter.
--
-- ⛔ THE ACL PAIR IS RE-ISSUED IN THIS SAME MIGRATION. Supabase's pg_default_acl grants
-- every function postgres creates in public to anon and authenticated, so a DROP and
-- CREATE silently re-opens a writer of attested_venue and venue_account_id to the
-- browser. The full account of that class is the header of
-- 20260814120000_wizard_rpcs_revoke_authenticated.sql, point (vi).
--
-- RE-BASED on the LATEST body of create_wizard_strategy, the one in
-- 20260814120000_wizard_rpcs_revoke_authenticated.sql (supabase/schema/functions/
-- create_wizard_strategy.sql before this file): the service_role-only auth.role() gate
-- with no auth.uid(), the wizdraft advisory lock and same-session fence, the
-- attested_venue stamp. The ONLY changes are the 13th parameter and the one added
-- INSERT column.
--
-- NORMAL FORM OF THE SERVER: trim, then lower-case. The route normalises first; the
-- SQL expression is defence in depth. btrim trims spaces only, and lower() on non-ASCII
-- text depends on the database collation, so the column carries a blank and length
-- CHECK and NO normal-form CHECK. MT5 server names are ASCII identifiers in practice.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, and a failed TEST apply blocks the PROD apply, so the verify block
-- below reads pg_catalog only. It reads no table row.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer
-- invariant 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to
-- that wrap.
--
-- Rollback (manual, off the auto-apply path; it KEEPS the column):
-- supabase/migrations/down/20261123180000-rollback.sql.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the column and its named CHECK (mirrors api_keys_venue_account_id_nonblank).
-- Every existing row is NULL, so the CHECK is valid at once and needs no NOT VALID.
-- --------------------------------------------------------------------------
ALTER TABLE public.api_keys ADD COLUMN venue_server text NULL;

ALTER TABLE public.api_keys
  ADD CONSTRAINT api_keys_venue_server_valid
  CHECK (venue_server IS NULL OR (btrim(venue_server) <> '' AND char_length(venue_server) <= 128));

COMMENT ON COLUMN public.api_keys.venue_server IS
  'Phase 225 ONEACCOUNTONCE (CONN-03, founder ruling Q2). The normalised broker server of an MT5 key (trimmed, lower-cased), stored beside the bare login in venue_account_id so the same login on two different brokers is two different accounts. PLAINTEXT by founder ruling: a broker server name is not a credential. NULL means "not captured yet" and every app fence treats NULL as a wildcard that matches any server; a blank or over-128-character value is refused by api_keys_venue_server_valid. MT5 only. NOT granted to anon or authenticated, and not part of the browser column allowlist.';

-- --------------------------------------------------------------------------
-- STEP 2 - create_wizard_strategy: drop the 12-parameter function, create the
-- 13-parameter one. See the header for why this is not CREATE OR REPLACE.
-- --------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
);

CREATE FUNCTION public.create_wizard_strategy(
  p_user_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID,
  p_venue_account_id TEXT DEFAULT NULL,
  p_venue_server TEXT DEFAULT NULL
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $$
DECLARE
  v_jwt_role TEXT;
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- FINAL GATE (Phase 156 Migration B, carried unchanged). Only service_role may
  -- write a wizard draft. The fail-closed wrapper makes a malformed
  -- request.jwt.claims REFUSE rather than pass. There is NO auth.uid() here and its
  -- absence is deliberate: auth.uid() IS NULL under service_role, so a retained
  -- comparison would be a permanent silent no-op. Ownership is bound at the route.
  -- Never current_user or session_user: inside a SECURITY DEFINER body the first is
  -- the owner and always passes.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- p_user_id is the ONLY carrier of the owning identity under service_role, and a
  -- NULL would silently mint an ownerless draft.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- F6 idempotency fence: serialise concurrent calls carrying the same
  -- wizard_session_id on a transaction-scoped advisory lock, then return any
  -- COMPLETE draft already created for this (user, session) instead of minting a
  -- duplicate strategies + api_keys pair.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- Only replay a COMPLETE draft (api_key_id present). An orphaned draft whose
  -- api_keys row was deleted (ON DELETE SET NULL) falls through, so the INSERT trips
  -- strategies_user_wizard_session_uniq (23505, the route's recoverable
  -- DRAFT_ALREADY_EXISTS 409) rather than returning a NULL key.
  SELECT s.id, s.api_key_id
    INTO v_strategy_id, v_key_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NOT NULL
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    RETURN QUERY SELECT v_strategy_id, v_key_id;
    RETURN;
  END IF;

  -- 153.6 / PARITY-04: attested_venue is stamped HERE, inside the SECURITY DEFINER
  -- body, the only kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger. Both columns come from the ONE parameter
  -- p_exchange so the CHECK api_keys_attested_venue_matches_exchange holds. p_exchange
  -- is caller-supplied and not validated here: that residual is the service_role
  -- trust boundary, not something this body can close.
  --
  -- 154 / WIZCONT-02: venue_account_id is stamped here for the same structural
  -- reason, NORMALISED as NULLIF(btrim(...), ''): without btrim a stray space makes
  -- the dedup miss, and without the NULLIF an unset field would arrive as a non-NULL
  -- blank that api_keys_venue_account_id_nonblank refuses with a 23514 the wizard
  -- route has no handler for.
  --
  -- 225 / CONN-03: venue_server is stamped in the same INSERT, trimmed, lower-cased
  -- and blank-to-NULL. An omitted parameter stores NULL (the wildcard).
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue, venue_account_id, venue_server
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange, NULLIF(btrim(p_venue_account_id), ''), NULLIF(lower(btrim(p_venue_server)), '')
  )
  RETURNING id INTO v_key_id;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

-- --------------------------------------------------------------------------
-- STEP 3 - the ACL pair, re-issued because the DROP destroyed it (see the header).
-- --------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text, text
) TO service_role;

COMMENT ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text, text
) IS
  'Atomic, idempotent api_keys + strategies (source=wizard, status=draft) insert. SECURITY DEFINER; guard_wizard_draft_updates allows the write via the current_user shift, and both api_keys scrub triggers admit the owner. F6: a per-(user, wizard_session_id) advisory lock + select-existing fence dedups double-submits to one draft; strategies_user_wizard_session_source_uniq is the backstop. 153.6/PARITY-04: stamps attested_venue from p_exchange. 154/WIZCONT-02: stamps venue_account_id from p_venue_account_id, NORMALISED so a stray space cannot make the dedup miss and a blank field cannot become an identity. 156/Migration B (20260814120000): SERVICE_ROLE ONLY; authenticated EXECUTE is REVOKED and the in-body gate is auth.role() IS DISTINCT FROM ''service_role''. There is NO auth.uid() check and its absence is deliberate. p_venue_account_id is STILL NOT VALIDATED here; the value has no in-database oracle. 225/CONN-03: the trailing p_venue_server TEXT DEFAULT NULL is stored trimmed and lower-cased in the same INSERT (NULL when omitted or blank, which every app fence reads as a wildcard), so a caller that omits it keeps working. EXACTLY ONE OVERLOAD OF THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named parameters and answers PGRST203 if a second candidate appears. Add parameters by DROP + CREATE WITH RE-ISSUED GRANTS (pg_default_acl re-grants anon and authenticated on DROP), never by CREATE OR REPLACE.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: the column exists as nullable text, exactly one
-- create_wizard_strategy overload exists and is SECURITY DEFINER, service_role holds
-- EXECUTE, anon and authenticated do not, and PUBLIC holds none. Deliberately NOT
-- asserted here: the CHECK body, the INSERT text and the column privileges. A verify
-- block that checked what a gate mutates would abort the apply of a mutated copy of
-- this file, and the SQL gate that mutates those lines needs that apply to succeed in
-- order to go RED on the behaviour instead.
DO $verify$
DECLARE
  v_fn_oid oid;
  v_count  int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'api_keys'
                    AND column_name = 'venue_server'
                    AND data_type = 'text' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: public.api_keys.venue_server is missing, not text, or not nullable';
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: expected exactly 1 create_wizard_strategy overload in public, found %', v_count;
  END IF;

  v_fn_oid := to_regprocedure(
    'public.create_wizard_strategy(uuid,text,text,text,text,text,text,text,integer,text,uuid,text,text)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: the 13-parameter create_wizard_strategy does not resolve';
  END IF;

  IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: create_wizard_strategy is not SECURITY DEFINER';
  END IF;

  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: service_role holds no EXECUTE on create_wizard_strategy, so every connect would answer 42501';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: anon holds EXECUTE on create_wizard_strategy. The DROP destroyed the ACL and the REVOKE did not take';
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: authenticated holds EXECUTE on create_wizard_strategy. The DROP destroyed the ACL and the REVOKE did not take';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261123180000 failed: PUBLIC holds EXECUTE on create_wizard_strategy';
  END IF;

  RAISE NOTICE 'Migration 20261123180000: api_keys.venue_server exists; create_wizard_strategy has one 13-parameter overload, SECURITY DEFINER, service_role-only.';
END
$verify$;
