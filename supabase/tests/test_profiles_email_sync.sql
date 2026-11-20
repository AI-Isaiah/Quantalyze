-- Test: public.sync_profile_email_from_auth() and the column revoke on public.profiles.email
-- (Phase 219 ACCOUNTEMAIL, plan 01). Guards migration
-- 20261119120000_sync_profile_email_from_auth.sql.
--
-- Background
-- ----------
-- The signed-in account changes its sign-in email through Supabase Auth's confirm-by-email
-- flow. Auth writes the new address into auth.users.email once the user confirms it, and a
-- trigger on that table copies it into the derived public.profiles.email (D-06). The app
-- never writes auth.users (D-11). Seven transactional send routes, the admin pages and the
-- org_invites_* policies read the copy, so this gate proves the copy at the database
-- boundary, and proves a user session can no longer set it by hand (D-07).
--
-- Arms (LISTED and EXECUTED in this order; the order is LOAD-BEARING because each twin's
-- FIRST `TEST FAILED (N)` must name its own arm, so an arm can only depend on arms listed
-- before it; every arm seeds its own user):
--   1   a changed auth.users.email is copied into profiles.email in the same transaction.
--   1b  the copy still happens when the UPDATE that fires the trigger is run by a role that
--       holds NO EXECUTE on the trigger function (the A1 proof, see below).
--   2   an UPDATE that leaves the email unchanged writes nothing into profiles.email.
--   3a  with quantalyze.sanitize_in_progress on, the trigger writes nothing, so account
--       erasure (which NULLs auth.users.email) is never fought.
--   3b  the skip is conditional: with the setting explicitly off the copy happens.
--   4   authenticated holds no UPDATE on profiles.email, and an UPDATE of it is refused 42501.
--   5   the revoke is narrow: authenticated can still UPDATE profiles.display_name.
--   6   catalogue: the trigger is enabled, AFTER UPDATE, FOR EACH ROW (tgtype exactly 17),
--       runs the sync function and is limited to the email column (tgattr).
--   7   catalogue: the function is SECURITY DEFINER with the pinned search_path.
--   8   catalogue: neither anon nor authenticated may EXECUTE the function.
--
-- ⭐ A1 (RESEARCH, planner decision 1): is it safe to revoke EXECUTE on the trigger function?
-- PostgreSQL checks EXECUTE on a trigger function when CREATE TRIGGER runs, not when the
-- trigger fires (this repo's mt5 gate says the same in its arm 9d prose), but no existing arm
-- PROVED it, because that trigger only ever fires for roles that hold EXECUTE. Arm 1b proves
-- it here. GoTrue's role cannot be impersonated on the pg-lane, so the arm uses
-- `authenticated`, which holds no EXECUTE after the migration, and fires the function through
-- a transaction-local temp table instead of auth.users: that route is identical on the
-- pg-lane stub and on the local-stack lane (where auth.users is owned by Auth's own role).
-- request.jwt.claims is left unset, so a SECURITY INVOKER body could not match a profiles row
-- through row level security whether or not the column revoke was written, and the twin
-- bites either way.
--
-- ORDERING RULE for the twins. Arms 1, 1b and 2 run before anything sets
-- quantalyze.sanitize_in_progress, so the 3b twin (a widened skip set) leaves them green.
-- Arm 8's twin cannot trip arm 1b first because arm 1b never reads a grant.
--
-- ANTI-GREEN-SKIP CONTRACT. Absence of the function or the trigger is an EXCEPTION in arm 1,
-- never a skip. Merging supabase/migrations/** applies to PRODUCTION with no human stop, so
-- nothing in the merge path would make a missing object appear. Do not add a presence skip.
--
-- NO SENTINEL. No arm returns early or skips, so the corpus-wide arm-count census buys
-- nothing here, and the closing notice deliberately does not use that sentinel's form.
--
-- Every identity carries a digit. Every `TEST FAILED (N)` raise sits DIRECTLY in the DO body
-- (the mutation runner reads an identity only from a single-frame `inline_code_block` raise);
-- the helper below returns a value and never raises an identity.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on failure, no
-- psql meta-commands. The whole test rolls back. Seed data is synthetic: generated uuids and
-- @quantalyze.test addresses; no message names a uuid or an address.
--
-- ⭐ RED-UNDER ANNOTATIONS. Each arm below carries a prose annotation and a machine-readable
-- twin the mutation runner applies on a throwaway pg-lane cluster to PROVE the arm reds on its
-- own, then restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md. Every twin edits the
-- migration that DEFINES what it mutates, 20261119120000. The migration's own verify block is
-- catalogue-only and asserts only that the function and the trigger resolve by name, so each
-- edit leaves those standing and the mutated migration applies clean; the gate, not the apply,
-- is what speaks.
-- ⚠️ THE APPLY LIST BELOW IS THE LIST OF test_profiles_privileged_columns_locked.sql WITH THE NEW
-- MIGRATION LAST. 20260405061912 is the only thing that enables row level security on profiles
-- and creates the on_auth_user_created trigger that makes a profile per seeded user, and
-- 20260529150000 is what creates the column-level UPDATE grant the column revoke withdraws:
-- without it arm 4 would be vacuous. 07-fixture-supabase-default-privileges.sql is what makes
-- the EXECUTE revoke falsifiable: the function is created by a migration IN this list, so
-- Supabase's bootstrap default privileges hand anon and authenticated the EXECUTE they hold in
-- production, and arm 8 can only redden because that grant is there to be withdrawn or not.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql","supabase/migrations/20260405061912_rls_policies.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260512182319_profiles_rls_hardening.sql","supabase/migrations/20260529150000_lock_profile_privileged_columns.sql","supabase/migrations/20261119120000_sync_profile_email_from_auth.sql"]}

BEGIN;

-- Seeds one auth user; the on_auth_user_created trigger creates the profile row. pg_temp
-- functions live and die with this transaction and carry no arm.
CREATE FUNCTION pg_temp.pe_user() RETURNS uuid
LANGUAGE plpgsql AS $f$
DECLARE
  v_user uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
  VALUES (v_user, '00000000-0000-0000-0000-000000000000',
          'pe-' || v_user::text || '@quantalyze.test', now(), now(),
          '{"role":"manager"}'::jsonb);
  RETURN v_user;
END
$f$;

DO $$
DECLARE
  v_uid    uuid;
  v_new    text;
  v_old    text;
  v_marker text;
  v_got    text;
  v_state  text;
  v_n      integer;
  v_att    smallint;
  v_role   text;
  v_trg    RECORD;
BEGIN
  IF to_regprocedure('public.sync_profile_email_from_auth()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM pg_trigger
                     WHERE tgname = 'on_auth_user_email_updated'
                       AND tgrelid = 'auth.users'::regclass
                       AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'TEST FAILED (1): the email sync function or its trigger on auth.users does not exist - this gate has nothing to test and must not skip';
  END IF;

  -- ===== ARM 1 - a confirmed change reaches profiles.email (D-06) =============
  -- The session role here is the lane's own, which holds the rights Supabase Auth's role
  -- holds on auth.users for the purpose of this update. The seeded profile starts with the
  -- seed address; the update moves the auth address and the copy must follow in the same
  -- transaction.
  -- RED-UNDER: drop the one statement that writes the copy in 20261119120000, the "the trigger
  --            fires but nothing reaches profiles" drift. Every send route and the org invite
  --            policies then keep reading the OLD address after a confirmed change, and
  --            nothing else in the system notices.
-- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;","replace":"NULL;","occurrences":1}]}
  v_uid := pg_temp.pe_user();
  v_new := 'pe-new-' || v_uid::text || '@quantalyze.test';
  UPDATE auth.users SET email = v_new WHERE id = v_uid;
  SELECT email INTO v_got FROM public.profiles WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAILED (1): the seeded user has no profile row (on_auth_user_created did not fire), so the copy cannot be measured';
  END IF;
  IF v_got IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'TEST FAILED (1): profiles.email did not follow the confirmed auth.users.email change (got %)', CASE WHEN v_got IS NULL THEN 'NULL' ELSE 'the old address' END;
  END IF;

  -- ===== ARM 1b - the copy happens for a role with no EXECUTE (A1, T-219-03) ===
  -- A transaction-local temp table carries an AFTER UPDATE OF email row trigger that runs the
  -- sync function. The UPDATE of that table is made as authenticated, which holds no EXECUTE
  -- on the function after the migration, with no JWT claims. If the function ran with its
  -- caller's rights, profiles.email (revoked from authenticated, and invisible through row
  -- level security with no claims) would refuse it; because it runs as its owner, the copy
  -- lands. This is also the proof that revoking EXECUTE cannot break Auth's own write.
  -- RED-UNDER: make the function run with its caller's rights in 20261119120000, the "the
  --            trigger function does not need definer rights" drift. Auth's role cannot write
  --            profiles.email, so the copy would fail for it on a real confirmation, which no
  --            arm that runs as the table owner can see.
-- RED-UNDER-M: {"arm":"1b","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"LANGUAGE plpgsql\n  SECURITY DEFINER","replace":"LANGUAGE plpgsql\n  SECURITY INVOKER","occurrences":1}]}
  v_uid := pg_temp.pe_user();
  v_new := 'pe-1b-' || v_uid::text || '@quantalyze.test';
  CREATE TEMP TABLE pe_tmp_users (id uuid PRIMARY KEY, email text) ON COMMIT DROP;
  CREATE TRIGGER pe_tmp_email_sync
    AFTER UPDATE OF email ON pe_tmp_users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_profile_email_from_auth();
  INSERT INTO pe_tmp_users (id, email) VALUES (v_uid, 'pe-1b-seed@quantalyze.test');
  GRANT SELECT, UPDATE ON pe_tmp_users TO authenticated;
  PERFORM set_config('request.jwt.claims', NULL, true);
  v_state := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE pe_tmp_users SET email = v_new WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (1b): a role with no EXECUTE on the sync function fired it and got SQLSTATE %, expected the copy to run as the function owner', v_state;
  END IF;
  SELECT email INTO v_got FROM public.profiles WHERE id = v_uid;
  IF v_got IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'TEST FAILED (1b): the trigger fired for a role with no EXECUTE but profiles.email was not updated';
  END IF;

  -- ===== ARM 2 - an unchanged address writes nothing (D-06) ===================
  -- UPDATE ... SET email = email names the column in its SET list, so an UPDATE OF email
  -- trigger fires; the function must see that nothing changed and write nothing. profiles.email
  -- is first set to a marker that differs from the auth address, so a stray write is visible.
  -- RED-UNDER: make the distinct test in 20261119120000 always true, the "just write it every
  --            time" drift. An unrelated auth update that touches the column would then
  --            overwrite whatever profiles.email held, including a deliberate admin edit.
-- RED-UNDER-M: {"arm":"2","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"NEW.email IS DISTINCT FROM OLD.email","replace":"true","occurrences":1}]}
  v_uid := pg_temp.pe_user();
  v_marker := 'pe-marker-' || v_uid::text || '@quantalyze.test';
  UPDATE public.profiles SET email = v_marker WHERE id = v_uid;
  UPDATE auth.users SET email = email WHERE id = v_uid;
  SELECT email INTO v_got FROM public.profiles WHERE id = v_uid;
  IF v_got IS DISTINCT FROM v_marker THEN
    RAISE EXCEPTION 'TEST FAILED (2): an UPDATE that left auth.users.email unchanged still wrote profiles.email';
  END IF;

  -- ===== ARM 3a - the sanitize setting suppresses the copy (D-06, T-219-04) ===
  -- sanitize_user sets quantalyze.sanitize_in_progress for its transaction and then NULLs
  -- auth.users.email. The trigger must stand aside, or it would write that NULL into the
  -- derived copy and fight the erasure. The setting is put back to 'off' afterwards.
  -- RED-UNDER: remove the early return on the sanitize setting in 20261119120000, the
  --            "the trigger does not need to know about erasure" drift. profiles.email would
  --            then be re-populated by the very update that erases the account.
-- RED-UNDER-M: {"arm":"3a","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"current_setting('quantalyze.sanitize_in_progress', true) = 'on'","replace":"false","occurrences":1}]}
  v_uid := pg_temp.pe_user();
  SELECT email INTO v_old FROM public.profiles WHERE id = v_uid;
  v_new := 'pe-3a-' || v_uid::text || '@quantalyze.test';
  PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);
  UPDATE auth.users SET email = v_new WHERE id = v_uid;
  PERFORM set_config('quantalyze.sanitize_in_progress', 'off', true);
  SELECT email INTO v_got FROM public.profiles WHERE id = v_uid;
  IF v_got IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'TEST FAILED (3a): profiles.email changed while quantalyze.sanitize_in_progress was on';
  END IF;

  -- ===== ARM 3b - the skip is conditional (D-06) ==============================
  -- The positive control for arm 3a: with the setting explicitly off the copy must happen. A
  -- skip widened to any non-NULL value would pass arm 3a and silently stop every sync.
  -- RED-UNDER: widen the skip set in 20261119120000 so the setting being merely present (off
  --            as well as on) suppresses the copy. Arm 3a still passes; only a sync that is
  --            expected to run, with the setting explicitly off, sees the copy go missing.
-- RED-UNDER-M: {"arm":"3b","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"= 'on' THEN","replace":"IN ('on', 'off') THEN","occurrences":1}]}
  v_uid := pg_temp.pe_user();
  v_new := 'pe-3b-' || v_uid::text || '@quantalyze.test';
  PERFORM set_config('quantalyze.sanitize_in_progress', 'off', true);
  UPDATE auth.users SET email = v_new WHERE id = v_uid;
  SELECT email INTO v_got FROM public.profiles WHERE id = v_uid;
  IF v_got IS DISTINCT FROM v_new THEN
    RAISE EXCEPTION 'TEST FAILED (3b): profiles.email was not updated with quantalyze.sanitize_in_progress explicitly off';
  END IF;

  -- ===== ARM 4 - authenticated cannot write profiles.email (D-07, T-219-01) ===
  -- The column grant is withdrawn, and an UPDATE of the column as the owning user is refused
  -- with 42501 and leaves the value alone. Without this, a user could set the address the
  -- org_invites_* policies match against.
  -- RED-UNDER: drop the column revoke from 20261119120000. authenticated keeps the column-level
  --            UPDATE grant 20260529150000 gave it, so a user could point profiles.email at
  --            another organisation's invited address.
-- RED-UNDER-M: {"arm":"4","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"REVOKE UPDATE (email) ON public.profiles FROM authenticated;","replace":"SELECT 1;","occurrences":1}]}
  v_uid := pg_temp.pe_user();
  IF has_column_privilege('authenticated', 'public.profiles', 'email', 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (4): authenticated still holds UPDATE on public.profiles.email';
  END IF;
  SELECT email INTO v_old FROM public.profiles WHERE id = v_uid;
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);
  v_state := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET email = 'pe-self-set@quantalyze.test' WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'TEST FAILED (4): an authenticated UPDATE of profiles.email answered SQLSTATE %, expected 42501', coalesce(v_state, 'no error');
  END IF;
  SELECT email INTO v_got FROM public.profiles WHERE id = v_uid;
  IF v_got IS DISTINCT FROM v_old THEN
    RAISE EXCEPTION 'TEST FAILED (4): profiles.email changed although the authenticated UPDATE was refused';
  END IF;

  -- ===== ARM 5 - the revoke is narrow (D-07) ==================================
  -- display_name stays writable for the owning user: the revoke names email and nothing else.
  -- The UPDATE sits in a handler block so a too-broad revoke surfaces as this arm's identity
  -- and not as a bare permission error.
  -- RED-UNDER: widen the column revoke in 20261119120000 to also name display_name, the
  --            "revoke the whole editable set" drift. ProfileForm's save would start failing
  --            for every user while arm 4 still passes.
-- RED-UNDER-M: {"arm":"5","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"REVOKE UPDATE (email) ON","replace":"REVOKE UPDATE (email, display_name) ON","occurrences":1}]}
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);
  v_state := NULL;
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.profiles SET display_name = 'pe-edit' WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE;
  END;
  RESET ROLE;
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (5): an authenticated UPDATE of profiles.display_name was refused with SQLSTATE %, the revoke is too broad', v_state;
  END IF;
  SELECT display_name INTO v_got FROM public.profiles WHERE id = v_uid;
  IF v_got IS DISTINCT FROM 'pe-edit' THEN
    RAISE EXCEPTION 'TEST FAILED (5): the authenticated display_name edit was not stored';
  END IF;

  -- ===== ARM 6 - catalogue: the trigger's shape (D-06) ========================
  -- tgtype is compared for EQUALITY with 17 = ROW (1) + UPDATE (16); AFTER sets neither the
  -- BEFORE (2) nor the INSTEAD OF (64) bit. A trigger that gained INSERT or DELETE, became
  -- BEFORE or went statement-level fails it. tgattr must hold exactly the attnum of
  -- auth.users.email, looked up from pg_attribute so the arm is lane-independent: a trigger
  -- without the column list would fire on every auth update.
  -- RED-UNDER: drop the column list from the trigger in 20261119120000. The behaviour arms
  --            (1, 2, 3a, 3b) still pass, because the function's own distinct test makes an
  --            unrelated update harmless, and only the catalogue sees the trigger now runs
  --            for every auth.users update.
-- RED-UNDER-M: {"arm":"6","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"AFTER UPDATE OF email ON auth.users","replace":"AFTER UPDATE ON auth.users","occurrences":1}]}
  SELECT count(*) INTO v_n FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_email_updated' AND NOT t.tgisinternal;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (6): % trigger(s) named on_auth_user_email_updated on auth.users, expected exactly one', v_n;
  END IF;
  SELECT t.tgenabled, t.tgtype, t.tgfoid, t.tgattr::text AS tgcols INTO v_trg
    FROM pg_trigger t
   WHERE t.tgrelid = 'auth.users'::regclass AND t.tgname = 'on_auth_user_email_updated' AND NOT t.tgisinternal;
  IF v_trg.tgenabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'TEST FAILED (6): the email sync trigger is not enabled (tgenabled %)', v_trg.tgenabled;
  END IF;
  IF v_trg.tgtype IS DISTINCT FROM 17 THEN
    RAISE EXCEPTION 'TEST FAILED (6): the email sync trigger has tgtype %, expected 17 (AFTER UPDATE, FOR EACH ROW)', v_trg.tgtype;
  END IF;
  IF v_trg.tgfoid IS DISTINCT FROM 'public.sync_profile_email_from_auth()'::regprocedure::oid THEN
    RAISE EXCEPTION 'TEST FAILED (6): the email sync trigger does not run public.sync_profile_email_from_auth()';
  END IF;
  SELECT a.attnum INTO v_att FROM pg_attribute a
   WHERE a.attrelid = 'auth.users'::regclass AND a.attname = 'email' AND NOT a.attisdropped;
  IF v_trg.tgcols IS DISTINCT FROM v_att::text THEN
    RAISE EXCEPTION 'TEST FAILED (6): the email sync trigger is not limited to the email column of auth.users (tgattr %)', v_trg.tgcols;
  END IF;

  -- ===== ARM 7 - catalogue: definer rights and a pinned search_path (T-219-02) ====
  -- RED-UNDER: remove the search_path setting from the function in 20261119120000. The
  --            behaviour arms all pass, because the schema-qualified table name resolves
  --            either way, and only the catalogue sees a definer function that a hijacked
  --            search_path could redirect.
-- RED-UNDER-M: {"arm":"7","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"  SET search_path = public, pg_catalog\nAS $function$","replace":"AS $function$","occurrences":1}]}
  SELECT p.prosecdef, p.proconfig INTO v_trg
    FROM pg_proc p WHERE p.oid = 'public.sync_profile_email_from_auth()'::regprocedure;
  IF v_trg.prosecdef IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (7): public.sync_profile_email_from_auth() is not SECURITY DEFINER';
  END IF;
  IF v_trg.proconfig IS NULL OR NOT (v_trg.proconfig @> ARRAY['search_path=public, pg_catalog']) THEN
    RAISE EXCEPTION 'TEST FAILED (7): public.sync_profile_email_from_auth() does not pin search_path to public, pg_catalog (proconfig %)', v_trg.proconfig;
  END IF;

  -- ===== ARM 8 - catalogue: EXECUTE on the function (T-219-02) ================
  -- RED-UNDER: drop anon and authenticated from the function's REVOKE in 20261119120000. The
  --            bootstrap default privileges then leave both roles EXECUTE on a definer
  --            function. A trigger function is checked at CREATE TRIGGER, not when it fires,
  --            so no behaviour arm sees the grant.
-- RED-UNDER-M: {"arm":"8","apply":[{"kind":"edit","file":"supabase/migrations/20261119120000_sync_profile_email_from_auth.sql","find":"FROM PUBLIC, anon, authenticated;","replace":"FROM PUBLIC;","occurrences":1}]}
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_function_privilege(v_role, 'public.sync_profile_email_from_auth()', 'EXECUTE') THEN
      RAISE EXCEPTION 'TEST FAILED (8): % may EXECUTE public.sync_profile_email_from_auth(), expected it revoked', v_role;
    END IF;
  END LOOP;

  RAISE NOTICE 'profiles email sync gate passed: a changed auth email is copied (1), also for a role with no EXECUTE (1b), an unchanged address writes nothing (2), the sanitize setting suppresses the copy (3a) and only while on (3b), authenticated cannot write profiles.email (4) but can still write display_name (5), the trigger is AFTER UPDATE FOR EACH ROW limited to the email column (6), the function is SECURITY DEFINER with a pinned search_path (7) and not executable by anon or authenticated (8).';
END $$;

ROLLBACK;
