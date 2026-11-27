-- ============================================================================
-- Phase 243 DBBACKSTOP, plan 05 (DBACC-02, founder decision 2026-11-26, candidate 1):
-- the audited writer public.insert_api_key, and an api_keys.user_id that no role can
-- change. PR-A of three; this one is ADDITIVE.
--
-- WHAT: (1) public.insert_api_key, a postgres-owned SECURITY DEFINER function that is
-- the one sanctioned way for service_role to insert an api_keys row. It mirrors the
-- validate-and-encrypt route's insert column for column, stamps attested_venue from the
-- exchange and normalises the venue login and server exactly as create_wizard_strategy
-- does, and returns the new key's uuid. (2) A BEFORE UPDATE trigger that refuses every
-- change of api_keys.user_id, for every role: the table owner postgres and BYPASSRLS
-- service_role included.
--
-- WHY: a service_role request carries no sub, so the database has no verified caller
-- identity to compare user_id against, and an RLS policy cannot bind a BYPASSRLS role.
-- The founder accepted the narrowing from "the caller's user_id" to "only the audited
-- writer path can insert, and user_id can never be repointed". This file is the first
-- half of that: the writer exists, and a key can never move to another tenant.
--
-- DELIVERY ORDER (CONTEXT, DBACC-02): PR-A (this file) is additive and nothing in it
-- calls the RPC. PR-B moves the validate-and-encrypt route, the seeds and the e2e
-- helpers onto insert_api_key; its preconditions require this migration in the PROD
-- ledger, because a deploy that calls a function the database lacks answers PGRST202.
-- PR-C adds the insert fence (a current_user allow-list on a BEFORE INSERT trigger).
-- Nothing legitimate updates user_id (RESEARCH census: no UPDATE payload or SET clause
-- assigns it anywhere), so the freeze cannot break a caller, and the RPC is unused until
-- PR-B, so this migration is safe in either order against the Vercel deploy that fires
-- on the same merge.
--
-- ⛔ NO auth.uid() CHECK IN THE RPC, AND THE ABSENCE IS DELIBERATE. auth.uid() IS NULL
-- under service_role (the request has no sub), so a retained comparison would be a
-- permanent silent no-op. Ownership stays bound at the route, which takes user_id from
-- the withAuth session and never from a body: that is the narrowing the founder
-- accepted. The gate is the JWT role, read through auth.role() and never current_user or
-- session_user, because inside a SECURITY DEFINER body current_user is the owner and
-- always passes. The read is wrapped so a malformed request.jwt.claims REFUSES rather
-- than passes.
--
-- ⛔ NO HANDLER AROUND THE INSERT. A duplicate venue identity must reach PostgREST as a
-- 23505 whose message names api_keys_user_exchange_venue_account_uniq: the route maps
-- that constraint name to its KEY_VENUE_ALREADY_CONNECTED answer (pgConstraintName.ts
-- parses `message`, never `details`). A handler that re-raised would drop the name.
--
-- ⛔ p_id IS FOR SEEDS ONLY. scripts/seed-full-app-demo.ts and the scenario-commit live
-- tests key later rows on a caller-chosen key id, and an UPDATE cannot give a row its id
-- afterwards. The signature is frozen once this applies (one-overload rule below), so it
-- is decided now. The route never passes it. A colliding id is a primary-key 23505,
-- never an overwrite.
--
-- ⛔ THE FREEZE TRIGGER CARRIES NO COLUMN LIST. A column list is checked against the
-- statement's own SET list only, so an earlier BEFORE trigger that rewrote NEW.user_id
-- while the statement set some other column would slip past it. Without the list, and
-- named so that it sorts after every existing api_keys BEFORE UPDATE trigger
-- (api_keys_account_share_same_owner, api_keys_lock_exchange), it judges the FINAL row.
-- The WHEN clause keeps a same-value assignment, and so an upsert that re-asserts the
-- same owner, passing (RESEARCH pitfall 5). The function itself raises unconditionally,
-- so deleting the WHEN fails CLOSED (every update would be refused), never open.
--
-- ⛔ NO sanitize_in_progress EXEMPTION. Neither object fires on DELETE, and sanitize_user
-- only DELETEs api_keys, so the project rule that a deletion-path guard exempts
-- quantalyze.sanitize_in_progress='on' has nothing to apply to. The local-stack run of
-- supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql (its CLEAN-02 Part 3 sanitize
-- arm) is the proof that sanitize completes with the trigger present.
--
-- ⛔ WHY NEW FUNCTIONS, NOT CREATE OR REPLACE. insert_api_key and the trigger function
-- are new names, so there is no earlier body to re-base on. The INSERT's two
-- normalisation expressions are copied from the LATEST create_wizard_strategy, the one
-- in 20261123180000_api_keys_venue_server.sql (no later migration redefines it).
-- EXACTLY ONE OVERLOAD may exist: PostgREST resolves rpc() by named parameters and
-- answers PGRST203 when a second candidate appears. A new parameter later means DROP
-- plus CREATE with the ACL pair re-issued (pg_default_acl re-grants anon and
-- authenticated on every function postgres creates in public).
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue and
-- none of its data, and a failed TEST apply blocks the PROD apply, so the verify block
-- below reads pg_catalog only. It reads no table row.
--
-- Transaction style: NO explicit transaction statements (migration-reviewer invariant
-- 14; Supabase wraps each migration). SET LOCAL lock_timeout applies to that wrap.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261127120100-rollback.sql. Never run it once PR-B's route
-- is deployed: the route then calls insert_api_key and every connect would answer PGRST202.
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1 - the audited writer. SECURITY DEFINER, service_role only, one overload.
-- --------------------------------------------------------------------------
CREATE FUNCTION public.insert_api_key(
  p_user_id uuid,
  p_exchange text,
  p_label text,
  p_api_key_encrypted text,
  p_api_secret_encrypted text DEFAULT NULL,
  p_passphrase_encrypted text DEFAULT NULL,
  p_dek_encrypted text DEFAULT NULL,
  p_nonce text DEFAULT NULL,
  p_kek_version integer DEFAULT NULL,
  p_venue_account_id text DEFAULT NULL,
  p_venue_server text DEFAULT NULL,
  p_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
AS $function$
DECLARE
  v_jwt_role text;
  v_id uuid;
BEGIN
  -- Only service_role may write an api_keys row through this function. The fail-closed
  -- wrapper makes a malformed request.jwt.claims REFUSE rather than pass. There is NO
  -- auth.uid() here; see the header for why its absence is deliberate.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'insert_api_key: caller role (%) may not write api_keys',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- p_user_id is the ONLY carrier of the owning identity under service_role, and a NULL
  -- would otherwise surface as a raw not-null violation with no diagnosis.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'insert_api_key: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- attested_venue is stamped HERE, inside the SECURITY DEFINER body, the only kind of
  -- writer whose value survives the api_keys_scrub_attested_venue trigger. Both columns
  -- come from the ONE parameter p_exchange so api_keys_attested_venue_matches_exchange
  -- holds. p_exchange is caller-supplied and not validated here beyond the table's own
  -- exchange CHECK: that residual is the service_role trust boundary.
  --
  -- venue_account_id and venue_server are normalised exactly as create_wizard_strategy
  -- does: trim of space, tab, carriage return and newline, blank to NULL, and the server
  -- lower-cased. The route normalises first; this expression is idempotent on its output.
  -- is_active is omitted (table default true), as the route omits it.
  INSERT INTO api_keys (
    id, user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version,
    attested_venue, venue_account_id, venue_server
  )
  VALUES (
    COALESCE(p_id, gen_random_uuid()), p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1),
    p_exchange, NULLIF(btrim(p_venue_account_id, E' \t\r\n'), ''), NULLIF(lower(btrim(p_venue_server, E' \t\r\n')), '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.insert_api_key(
  uuid, text, text, text, text, text, text, text, integer, text, text, uuid
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.insert_api_key(
  uuid, text, text, text, text, text, text, text, integer, text, text, uuid
) TO service_role;

COMMENT ON FUNCTION public.insert_api_key(
  uuid, text, text, text, text, text, text, text, integer, text, text, uuid
) IS
  'Phase 243 DBACC-02. The audited api_keys writer: inserts one row and returns its id. SECURITY DEFINER; SERVICE_ROLE ONLY (authenticated, anon and PUBLIC EXECUTE are REVOKED and the in-body gate is auth.role() IS DISTINCT FROM ''service_role''). There is NO auth.uid() check and its absence is deliberate: a service_role request carries no sub, so ownership is bound at the route, which is the narrowing the founder accepted. Stamps attested_venue = p_exchange. p_venue_account_id and p_venue_server are trimmed (space, tab, CR, LF) with blank to NULL, and the server is lower-cased, exactly as create_wizard_strategy stores them. p_id is for seeds only (a caller-chosen row id; the route never passes it). A duplicate venue identity raises 23505 naming api_keys_user_exchange_venue_account_uniq: there is NO handler around the INSERT, so the route''s constraint mapping keeps working. EXACTLY ONE OVERLOAD OF THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named parameters and answers PGRST203 if a second candidate appears. Add parameters by DROP + CREATE WITH RE-ISSUED GRANTS (pg_default_acl re-grants anon and authenticated on DROP), never by CREATE OR REPLACE.';

-- --------------------------------------------------------------------------
-- STEP 2 - api_keys.user_id is immutable for every role.
-- The function raises unconditionally; the trigger's WHEN clause is what lets a
-- same-value assignment through. SECURITY INVOKER: it reads no table.
-- --------------------------------------------------------------------------
CREATE FUNCTION public.enforce_api_keys_user_id_immutable()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY INVOKER
  SET search_path = public, pg_catalog
AS $function$
BEGIN
  RAISE EXCEPTION 'api_keys.user_id is immutable: a key never changes owner'
    USING ERRCODE = 'insufficient_privilege';
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_api_keys_user_id_immutable() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER api_keys_user_id_immutable
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW
  WHEN (OLD.user_id IS DISTINCT FROM NEW.user_id)
  EXECUTE FUNCTION public.enforce_api_keys_user_id_immutable();

COMMENT ON FUNCTION public.enforce_api_keys_user_id_immutable() IS
  'Phase 243 DBACC-02. Raises unconditionally (42501, no row value in the message); the trigger api_keys_user_id_immutable only fires it when OLD.user_id differs from NEW.user_id, so a same-value assignment and every other-column update pass. SECURITY INVOKER: it reads no table.';

COMMENT ON TRIGGER api_keys_user_id_immutable ON public.api_keys IS
  'Phase 243 DBACC-02 (founder decision 2026-11-26). A key never changes owner: refuses an UPDATE that changes user_id from ANY role, the table owner and BYPASSRLS service_role included. No column list on purpose, and named to sort after the other BEFORE UPDATE triggers on api_keys, so it judges the final row even when an earlier trigger rewrote NEW.user_id.';

-- ───────────── self-verify: CATALOGUE ONLY, passes on an empty database.
-- No row is read. Asserted: exactly one insert_api_key overload that is SECURITY DEFINER
-- with the pinned search_path, service_role holds EXECUTE while anon, authenticated and
-- PUBLIC do not, the trigger function exists and is not SECURITY DEFINER, and exactly one
-- trigger of that name exists on public.api_keys. Deliberately NOT asserted here: the
-- function bodies, the trigger's WHEN text and tgenabled. A verify block that checked
-- what a gate mutates would abort the apply of a mutated copy of this file, and the SQL
-- gate that mutates those lines needs that apply to succeed in order to go RED on the
-- behaviour instead (the same reasoning as the verify comment in 20261123180000).
DO $verify$
DECLARE
  v_fn_oid oid;
  v_count  int;
BEGIN
  SELECT count(*) INTO v_count
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'insert_api_key';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: expected exactly 1 insert_api_key overload in public, found %', v_count;
  END IF;

  v_fn_oid := to_regprocedure(
    'public.insert_api_key(uuid,text,text,text,text,text,text,text,integer,text,text,uuid)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: the 12-parameter insert_api_key does not resolve';
  END IF;

  IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: insert_api_key is not SECURITY DEFINER';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc p, unnest(p.proconfig) AS c(setting)
                  WHERE p.oid = v_fn_oid AND c.setting = 'search_path=public, pg_catalog') THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: insert_api_key does not pin search_path to public, pg_catalog';
  END IF;

  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: service_role holds no EXECUTE on insert_api_key';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: anon holds EXECUTE on insert_api_key';
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: authenticated holds EXECUTE on insert_api_key';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: PUBLIC holds EXECUTE on insert_api_key';
  END IF;

  v_fn_oid := to_regprocedure('public.enforce_api_keys_user_id_immutable()');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: public.enforce_api_keys_user_id_immutable() is missing';
  END IF;
  IF COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), true) THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: enforce_api_keys_user_id_immutable is SECURITY DEFINER; it must be SECURITY INVOKER';
  END IF;

  SELECT count(*) INTO v_count
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.api_keys'::regclass
     AND t.tgname = 'api_keys_user_id_immutable'
     AND NOT t.tgisinternal;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Migration 20261127120100 failed: expected exactly 1 trigger api_keys_user_id_immutable on public.api_keys, found %', v_count;
  END IF;

  RAISE NOTICE 'Migration 20261127120100: insert_api_key has one 12-parameter overload, SECURITY DEFINER, service_role-only; api_keys_user_id_immutable exists.';
END
$verify$;
