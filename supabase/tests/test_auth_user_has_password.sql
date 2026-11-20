-- Test: public.auth_user_has_password(uuid) (Phase 219 ACCOUNTEMAIL, gap closure plan 04, GD-05a).
-- Guards migration 20261120120000_auth_user_has_password.sql.
--
-- Background
-- ----------
-- The change-email route re-checks the caller's current password. GoTrue answers "Invalid login
-- credentials" for a wrong password AND for an account that was never given one (the admin
-- partner-import path creates such accounts), and nothing on the GoTrue user object tells the two
-- apart. Only auth.users.encrypted_password knows, so the route asks this function, through the
-- service-role client, passing the id of the caller's OWN getUser(). The function answers one boolean
-- about one id. This gate proves the four answer cases, that the answer is about the asked id only,
-- the grant set, and the definer hardening.
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each twin's FIRST
-- `TEST FAILED (N)` must name its own arm, so an arm can only depend on arms listed before it):
--   1   a user whose password hash is a non-empty string gives true.
--   2   the answer is about the asked id only: an unknown id gives exactly false (not NULL) even
--       while a user with a password exists in the same transaction.
--   3   a user whose hash is the empty string gives false (the shape GoTrue writes for a user
--       created without a password).
--   4   a user whose hash is NULL gives false.
--   5a  catalogue: the function is SECURITY DEFINER.
--   5b  catalogue: the function pins search_path to public, pg_catalog.
--   6   service_role holds EXECUTE and a call made as service_role answers true.
--   7a  anon holds no EXECUTE and a call made as anon is refused 42501.
--   7b  authenticated holds no EXECUTE and a call made as authenticated is refused 42501.
--
-- ORDERING RULE for the twins. The catalogue arms 5a and 5b run BEFORE the service_role arm 6,
-- because a SECURITY INVOKER twin may make service_role's call fail on a stub's auth.users grants
-- before a catalogue arm could speak. Arms 1 to 5b all run as the session role, so the grant twins
-- of arms 6, 7a and 7b leave them green, and 7a's twin cannot trip 7b first.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the function is an EXCEPTION in arm 1, never a skip. Merging
-- supabase/migrations/** applies to PRODUCTION with no human stop, so nothing in the merge path would
-- make a missing object appear. Do not add a presence skip.
--
-- NO SENTINEL. No arm returns early or skips, so the corpus-wide arm-count census buys nothing here,
-- and the closing notice deliberately does not use that sentinel's form.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in the DO body (the
-- mutation runner reads an identity only from a single-frame `inline_code_block` raise); the helper
-- below returns a value and never raises an identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on failure, no
-- psql meta-commands. The whole test rolls back. Seed data is synthetic: generated uuids,
-- @quantalyze.test addresses and made-up hash strings; no message names a uuid or an address.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose annotation and a machine-readable twin the
-- mutation runner applies on a throwaway pg-lane cluster to PROVE the arm reds on its own, then
-- restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. Every twin edits the migration that
-- DEFINES what it mutates, 20261120120000. Its verify block is catalogue-only and asserts only that
-- the function resolves, so each edit leaves that standing and the mutated migration applies clean;
-- the gate, not the apply, is what speaks.
-- ⚠️ THE APPLY LIST BELOW IS THE LIST OF test_profiles_email_sync.sql WITHOUT ITS PROFILES CHAIN AND
-- WITHOUT ITS OWN MIGRATION, WITH THE NEW MIGRATION LAST. This function reads only auth.users, so the
-- profiles fixtures and migrations that file needs to make a profile per seeded user are not applied
-- here. 02-fixture-sanitize-tables.sql is what adds auth.users.encrypted_password to the lane's stub
-- (a sql function body is validated at CREATE time, so the column must exist before the migration),
-- and 07-fixture-supabase-default-privileges.sql is what makes the REVOKE arms falsifiable: the
-- function is created by a migration IN this list, so Supabase's bootstrap default privileges hand
-- anon, authenticated and service_role the EXECUTE they hold in production.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20261120120000_auth_user_has_password.sql"]}

BEGIN;

-- Seeds one auth user with the given password hash (NULL or '' included) and returns its id.
-- pg_temp functions live and die with this transaction and carry no arm.
CREATE FUNCTION pg_temp.hp_user(p_password text) RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data, encrypted_password)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'hp-' || v_user::text || '@quantalyze.test', now(), now(),
          '{"role":"manager"}'::jsonb, p_password);
  RETURN v_user;
END
$f$;

DO $$
DECLARE
  v_pw_uid uuid;
  v_uid    uuid;
  v_got    boolean;
  v_state  text;
  v_def    RECORD;
BEGIN
  IF to_regprocedure('public.auth_user_has_password(uuid)') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1): public.auth_user_has_password(uuid) does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - a user with a password gives true (GD-05a) ===================
  -- RED-UNDER: flip the empty-string test in 20261120120000 so only an EMPTY hash counts as set.
  --            Every account that has a password would then be told to set one first, so no
  --            one could change their email.
-- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"u.encrypted_password <> ''","replace":"u.encrypted_password = ''","occurrences":1}]}
  v_pw_uid := pg_temp.hp_user('hp-synthetic-bcrypt-hash');
  v_got := public.auth_user_has_password(v_pw_uid);
  IF v_got IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (1): auth_user_has_password answered % for a user with a non-empty password hash, expected true', coalesce(v_got::text, 'NULL');
  END IF;

  -- ===== ARM 2 - the answer is about the asked id only (T-219-15) =============
  -- Arm 1's user, who HAS a password, is still present. Asking about an id that matches no row
  -- must give exactly false: not NULL, and not the answer for some other user.
  -- RED-UNDER: drop the id filter from 20261120120000, the "forgot to scope it to the caller"
  --            drift. Any user's password would then answer for every id, so the route could
  --            no longer tell a password-less account from one with a password.
-- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"u.id = p_user_id","replace":"p_user_id IS NOT NULL","occurrences":1}]}
  v_got := public.auth_user_has_password(gen_random_uuid());
  IF v_got IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (2): auth_user_has_password answered % for an id that matches no user while another user with a password exists, expected false', coalesce(v_got::text, 'NULL');
  END IF;

  -- ===== ARM 3 - an empty hash gives false (GD-05a) ===========================
  -- The shape GoTrue writes for a user created without a password, which is how the admin
  -- partner-import path (src/lib/supabase/admin-users.ts ensureAuthUser) creates its accounts.
  -- RED-UNDER: drop the empty-string test from 20261120120000, leaving only the NULL test. A
  --            partner-imported account would be told its password is wrong instead of being
  --            told to set one, with no way out.
-- RED-UNDER-M: {"arm":"3","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":" AND u.encrypted_password <> ''","replace":"","occurrences":1}]}
  v_uid := pg_temp.hp_user('');
  v_got := public.auth_user_has_password(v_uid);
  IF v_got IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (3): auth_user_has_password answered % for a user whose password hash is the empty string, expected false', coalesce(v_got::text, 'NULL');
  END IF;

  -- ===== ARM 4 - a NULL hash gives false (GD-05a) =============================
  -- RED-UNDER: treat a missing hash as set in 20261120120000 by folding NULL into a non-empty
  --            value. Arms 1 to 3 stay green; a user with no stored hash at all would be told
  --            their password is wrong instead of being told to set one.
-- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"u.encrypted_password IS NOT NULL AND u.encrypted_password <> ''","replace":"COALESCE(u.encrypted_password, 'unset') <> ''","occurrences":1}]}
  v_uid := pg_temp.hp_user(NULL);
  v_got := public.auth_user_has_password(v_uid);
  IF v_got IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (4): auth_user_has_password answered % for a user whose password hash is NULL, expected false', coalesce(v_got::text, 'NULL');
  END IF;

  -- ===== ARM 5a - catalogue: definer rights (T-219-16) ========================
  -- service_role has no SELECT on auth.users, so the function must run with its owner's rights.
  -- RED-UNDER: make the function SECURITY INVOKER in 20261120120000. The behaviour arms all pass
  --            because the session role here can read auth.users, and only the catalogue sees
  --            that the route's service_role call would be refused on a real database.
-- RED-UNDER-M: {"arm":"5a","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"STABLE\n  SECURITY DEFINER","replace":"STABLE\n  SECURITY INVOKER","occurrences":1}]}
  SELECT p.prosecdef, p.proconfig INTO v_def
    FROM pg_proc p WHERE p.oid = 'public.auth_user_has_password(uuid)'::regprocedure;
  IF v_def.prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (5a): public.auth_user_has_password(uuid) is not SECURITY DEFINER';
  END IF;

  -- ===== ARM 5b - catalogue: a pinned search_path (T-219-16) ==================
  -- RED-UNDER: remove the search_path setting from the function in 20261120120000. The behaviour
  --            arms all pass, because the schema-qualified table name resolves either way, and
  --            only the catalogue sees a definer function that a hijacked search_path could
  --            redirect.
-- RED-UNDER-M: {"arm":"5b","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"  SET search_path = public, pg_catalog\nAS $function$","replace":"AS $function$","occurrences":1}]}
  IF v_def.proconfig IS NULL OR NOT (v_def.proconfig @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'TEST FAILED (5b): public.auth_user_has_password(uuid) does not pin search_path to public, pg_catalog (proconfig %)', v_def.proconfig;
  END IF;

  -- ===== ARM 6 - service_role may call it (GD-05a) ============================
  -- The route calls the function through the service-role client. The catalogue says EXECUTE is
  -- held, and a real call made as service_role, with the answer asserted after RESET ROLE, proves
  -- it. The call sits in a handler block that only captures the SQLSTATE; nothing is probed inside
  -- the handler.
  -- RED-UNDER: withdraw EXECUTE from service_role in 20261120120000, both the explicit grant and
  --            the bootstrap default. The change-email route's every failed password check would
  --            become a 502.
-- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"FROM PUBLIC, anon, authenticated;","replace":"FROM PUBLIC, anon, authenticated, service_role;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"GRANT EXECUTE ON FUNCTION public.auth_user_has_password(uuid) TO service_role;","replace":"SELECT 1;","occurrences":1}]}
  IF NOT has_function_privilege('service_role', 'public.auth_user_has_password(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (6): service_role may not EXECUTE public.auth_user_has_password(uuid), expected it granted';
  END IF;
  v_state := NULL;
  v_got := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_got := public.auth_user_has_password(v_pw_uid);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (6): a call made as service_role was refused with SQLSTATE %, expected it to run', v_state;
  END IF;
  IF v_got IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (6): a call made as service_role answered % for a user with a password, expected true', coalesce(v_got::text, 'NULL');
  END IF;

  -- ===== ARM 7a - anon is refused (T-219-14) ==================================
  -- A caller that could execute this could probe any user id for whether it has a password.
  -- RED-UNDER: drop anon from the function's REVOKE in 20261120120000. The bootstrap default
  --            privileges then leave anon EXECUTE, so an unauthenticated caller could ask the
  --            public RPC endpoint whether a given user id has a password.
-- RED-UNDER-M: {"arm":"7a","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"FROM PUBLIC, anon, authenticated;","replace":"FROM PUBLIC, authenticated;","occurrences":1}]}
  IF has_function_privilege('anon', 'public.auth_user_has_password(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (7a): anon may EXECUTE public.auth_user_has_password(uuid), expected it revoked';
  END IF;
  v_state := NULL;
  SET LOCAL ROLE anon;
  BEGIN
    v_got := public.auth_user_has_password(v_pw_uid);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (7a): a call made as anon answered SQLSTATE %, expected 42501', coalesce(v_state, 'no error');
  END IF;

  -- ===== ARM 7b - authenticated is refused (T-219-14) =========================
  -- RED-UNDER: drop authenticated from the function's REVOKE in 20261120120000. Any signed-in
  --            user could then ask the RPC endpoint whether another user id has a password.
-- RED-UNDER-M: {"arm":"7b","apply":[{"kind":"edit","file":"supabase/migrations/20261120120000_auth_user_has_password.sql","find":"FROM PUBLIC, anon, authenticated;","replace":"FROM PUBLIC, anon;","occurrences":1}]}
  IF has_function_privilege('authenticated', 'public.auth_user_has_password(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAILED (7b): authenticated may EXECUTE public.auth_user_has_password(uuid), expected it revoked';
  END IF;
  v_state := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    v_got := public.auth_user_has_password(v_pw_uid);
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (7b): a call made as authenticated answered SQLSTATE %, expected 42501', coalesce(v_state, 'no error');
  END IF;

  RAISE NOTICE 'has-password gate passed: a user with a password gives true (1), an unknown id gives false while another user has a password (2), an empty hash gives false (3), a NULL hash gives false (4), the function is SECURITY DEFINER (5a) with a pinned search_path (5b), service_role can call it (6), and anon (7a) and authenticated (7b) are refused 42501.';
END $$;

ROLLBACK;
