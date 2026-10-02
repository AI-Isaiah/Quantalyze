-- Test: privileged profiles columns are not client-writable (CL-SEC privesc).
--
-- audit-2026-05-07 cluster CL-SEC. Guards migration
-- 20260529150000_lock_profile_privileged_columns.sql.
--
-- Background
-- ----------
-- profiles is exposed to PostgREST; `authenticated` had table-wide column UPDATE
-- grants and the `profiles_self_update` RLS policy constrains the ROW (auth.uid()
-- = id), not the COLUMNS. Two confirmed client-side escalations followed:
--   - CRITICAL: a user could `PATCH /rest/v1/profiles {is_admin:true}` and become
--     a back-office admin (is_admin gates admin RLS + the admin route).
--   - The role lock (prevent_profile_role_change) was a SECURITY DEFINER no-op
--     (current_user evaluated as the owner), so role was client-mutable too.
-- The fix REVOKEs UPDATE on the privileged columns from authenticated/anon
-- (primary gate) and adds a SECURITY INVOKER trigger (defense-in-depth).
--
-- Asserted invariants:
--   1. POSITIVE (always active): an ordinary profile edit (display_name, company)
--      by `authenticated` on their OWN row still succeeds. This catches an
--      over-broad REVOKE that would break ProfileForm / OnboardingWizard.
--   2. NEGATIVE (active once the fix is applied here): `authenticated` cannot
--      change ANY privileged column (is_admin, role, tenant_id, allocator_status,
--      manager_status, partner_tag) on their own row — each attempt is rejected.
--
-- Test DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the migration may not be applied yet (the exploit is still live there). The
-- negative block is therefore gated on the fix being present (detected via the
-- existence of the profiles_lock_privileged_cols trigger — NOT a column
-- privilege bit, which does not flip reliably) and emits a loud NOTICE skip
-- otherwise; it becomes a hard regression guard once the test DB catches up. The
-- migration itself is independently validated (impersonate authenticated, all
-- columns blocked, legit edit works, service_role unaffected, trigger blocks a
-- re-granted column) and re-verified against prod after merge. We deliberately
-- do NOT apply REVOKE/GRANT inside this test — DDL on the shared profiles table
-- risks lock contention with concurrent CI runs.
--
-- Run order: AFTER 20260529150000. Impersonation uses the same forged-JWT
-- technique as test_funding_fees_rls.sql. Whole test rolls back.
--
-- ⭐ MACHINE-EXECUTABLE TWINS (phase 164.4, REDUNDER-BACKFILL). The prose
-- RED-UNDER below carries an adjacent `RED-UNDER-M` object that
-- scripts/mutation-runner executes on every push: it mutates COPIES on a
-- throwaway pg-lane cluster, requires the FIRST `TEST FAILED (…)` to name that
-- arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ ONE SECTION, AND NOTHING IS NEUTERED HERE. Assertion 2's seven raises say
-- `PRIVESC (2)`, not `TEST FAILED (…)`, so they are not identities; they also
-- sit on COMPOUND heads (`IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION …`)
-- which the runner's neuter tokenizer refuses by design (R4-C01, 164.3.1): a
-- neuter there would have to drop the `RESET ROLE` with the raise and leave the
-- rest of the file running as `authenticated`. The twin does not need one —
-- assertion 1 is the FIRST thing this file asserts.
-- ⚠️ THE APPLY LIST CLEARS THE `:88` SKIP. It carries 20260529150000, so
-- `profiles_lock_privileged_cols` exists and assertion 2 runs instead of
-- skipping (MEASURED 2026-09-04: baseline prints both OK notices, no SKIP).
-- ⚠️ 20260405061912 IS IN THE LIST AND IT IS LOAD-BEARING, NOT SCAFFOLD. It is
-- the ONLY thing that runs `ALTER TABLE profiles ENABLE ROW LEVEL SECURITY`
-- (:2). MEASURED 2026-09-04: without it the baseline is still green and
-- assertion 2 still passes on the column REVOKE — but `profiles_self_update` is
-- INERT, so narrowing it changes nothing and the twin below came back NO-RED.
-- A lane where the policy under test cannot bite is exactly the stand-in defect
-- this phase refuses; the fix is the real migration, not a different mutation.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","scripts/pg-lane/fixtures/12-fixture-profiles-is-admin.sql","scripts/pg-lane/fixtures/28-fixture-profiles-privileged-columns.sql","supabase/migrations/20260405061912_rls_policies.sql","scripts/pg-lane/fixtures/13-fixture-csv-finalize-fold.sql","supabase/migrations/20260512182319_profiles_rls_hardening.sql","supabase/migrations/20260529150000_lock_profile_privileged_columns.sql"]}

BEGIN;

DO $$
DECLARE
  v_uid       uuid := gen_random_uuid();
  v_fix_live  boolean;
  v_dn        text;
  v_raised    boolean;
BEGIN
  -- Seed a normal (manager) user; the on_auth_user_created trigger creates the
  -- profile (is_admin=false default).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
  VALUES (v_uid, '00000000-0000-0000-0000-000000000000',
          'clsec-' || v_uid::text || '@quantalyze.test', now(), now(),
          '{"role":"manager"}'::jsonb);

  -- Forge the JWT sub so auth.uid() = v_uid (RLS row predicate passes), then
  -- act as the authenticated role.
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', v_uid::text, 'role', 'authenticated')::text,
                     true);

  -- ---- (1) POSITIVE: an ordinary self-edit still works (always active) -------
  -- RED-UNDER: narrow the `profiles_self_update` USING clause in migration
  --            20260512182319 so the caller's own row stops matching, and the
  --            ordinary self-edit silently writes nothing. ⚠️ It must be the
  --            ROW filter, not the column GRANT this arm is written about: the
  --            UPDATE below is unwrapped, so an over-broad REVOKE aborts it with
  --            a bare `permission denied for table profiles`, which carries no
  --            `TEST FAILED (…)` and scores NO-IDENTITY (MEASURED 2026-09-04).
  --            RLS filters instead of raising, so the same broken ProfileForm
  --            reaches this assertion as a value mismatch. ⚠️ `AND false` rather
  --            than `USING (false)`: 20260512182319's own post-verify requires
  --            the qual to still name `auth.uid()` and to carry no OR-true
  --            escape, and both hold here.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"edit","file":"supabase/migrations/20260512182319_profiles_rls_hardening.sql","find":"CREATE POLICY profiles_self_update ON profiles\n  FOR UPDATE\n  USING (auth.uid() = id)\n  WITH CHECK (auth.uid() = id);","replace":"CREATE POLICY profiles_self_update ON profiles\n  FOR UPDATE\n  USING (auth.uid() = id AND false)\n  WITH CHECK (auth.uid() = id);","occurrences":1}]}
  SET LOCAL ROLE authenticated;
  UPDATE public.profiles SET display_name = 'clsec-edit', company = 'acme' WHERE id = v_uid;
  RESET ROLE;
  SELECT display_name INTO v_dn FROM public.profiles WHERE id = v_uid;
  IF v_dn IS DISTINCT FROM 'clsec-edit' THEN
    RAISE EXCEPTION 'TEST FAILED (1): authenticated could not edit own display_name/company (over-broad REVOKE?) — got %', v_dn;
  END IF;
  RAISE NOTICE 'Assertion 1 OK: ordinary profile self-edit still permitted.';

  -- ---- (2) NEGATIVE: privileged columns reject client self-write -------------
  -- Gate on the fix being present on THIS DB (test DB lags main). Detect the
  -- TRIGGER the migration installs — NOT has_column_privilege, which is a no-op
  -- signal here: authenticated holds a table-level UPDATE grant, so a
  -- column-level privilege bit on is_admin does not flip until the migration's
  -- table-REVOKE + per-column-GRANT runs, and keying on it risked never
  -- enforcing. The trigger's existence is the unambiguous "migration applied"
  -- signal.
  SELECT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profiles_lock_privileged_cols'
      AND tgrelid = 'public.profiles'::regclass
      AND NOT tgisinternal
  ) INTO v_fix_live;
  IF NOT v_fix_live THEN
    RAISE NOTICE 'SKIP (2): privesc-lock migration 20260529150000 not yet applied here (trigger profiles_lock_privileged_cols absent). Negative assertions enforce once the test DB catches up to prod.';
    RETURN;
  END IF;

  SET LOCAL ROLE authenticated;

  v_raised := false;
  BEGIN UPDATE public.profiles SET is_admin = true WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated self-granted is_admin'; END IF;

  v_raised := false;
  BEGIN UPDATE public.profiles SET role = 'allocator' WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated changed own role'; END IF;

  v_raised := false;
  BEGIN UPDATE public.profiles SET tenant_id = gen_random_uuid() WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated changed own tenant_id (cross-tenant)'; END IF;

  v_raised := false;
  BEGIN UPDATE public.profiles SET allocator_status = 'verified' WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated self-approved allocator_status'; END IF;

  v_raised := false;
  BEGIN UPDATE public.profiles SET manager_status = 'verified' WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated self-approved manager_status'; END IF;

  v_raised := false;
  BEGIN UPDATE public.profiles SET partner_tag = 'self-assigned' WHERE id = v_uid;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated set own partner_tag'; END IF;

  -- DELETE + re-INSERT escalation: deleting one's own profile and inserting a
  -- replacement with is_admin=true must be rejected (the table INSERT REVOKE
  -- closes this; the trigger backstops it). Without the fix this self-grants admin.
  v_raised := false;
  BEGIN
    DELETE FROM public.profiles WHERE id = v_uid;
    INSERT INTO public.profiles (id, email, display_name, role, is_admin)
    VALUES (v_uid, 'clsec-' || v_uid::text || '@quantalyze.test', 'x', 'manager', true);
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'PRIVESC (2): authenticated DELETE+re-INSERT self-granted is_admin'; END IF;

  RESET ROLE;
  RAISE NOTICE 'Assertion 2 OK: privileged columns reject client self-write (UPDATE + DELETE/re-INSERT).';
END $$;

ROLLBACK;
