-- ============================================================================
-- ROLLBACK for 20261110150000_intro_path_authz_hardening.sql
-- Phase 204 INTROAUTH, plan 01 (D-01, D-04).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It reverses the two statements of the migration: the ALTER POLICY
-- on public.contact_requests (policy contact_requests_insert) and the REVOKE on
-- public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid). It touches no
-- table, no other policy and no function body, because the migration changed none.
--
-- WHAT IT RESTORES. It returns the policy and the function grants to the
-- definitions in effect before 20261110150000: the policy check goes back to
-- allocator_id = auth.uid() alone (supabase/migrations/20260405061912_rls_policies.sql),
-- and EXECUTE goes back to anon, authenticated and service_role
-- (supabase/schema/baseline.sql). No data changes.
--
-- THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261110150000 as applied while the policy and the grants are
-- back to their earlier definitions. `supabase db push` will therefore NOT
-- re-apply the migration. To re-apply it, delete that ledger row in the same change
-- that re-applies it (or mark it reverted with
-- `supabase migration repair --status reverted 20261110150000` against the
-- intended database, after the marker query in CLAUDE.md names that database).
-- Until then VAC-08's ledger check reports the version as present, which is true
-- of the ledger and false of the policy and the grants.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

ALTER POLICY "contact_requests_insert" ON public.contact_requests WITH CHECK (allocator_id = auth.uid());

GRANT EXECUTE ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid)
  TO anon, authenticated, service_role;

-- Catalogue-only check: the policy is the earlier one and the three grants are back.
DO $$
DECLARE
  v_check  TEXT;
  v_fn_oid OID;
BEGIN
  SELECT pol.with_check
    INTO v_check
    FROM pg_policies pol
   WHERE pol.schemaname = 'public'
     AND pol.tablename = 'contact_requests'
     AND pol.policyname = 'contact_requests_insert';
  IF v_check IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261110150000: policy contact_requests_insert is missing after the ALTER';
  END IF;
  IF position('investor_attestations' IN v_check) > 0 OR position('profiles' IN v_check) > 0 THEN
    RAISE EXCEPTION 'Rollback 20261110150000: contact_requests_insert still carries the migration check after the ALTER';
  END IF;

  v_fn_oid := to_regprocedure('public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261110150000: public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) is missing';
  END IF;
  IF NOT (has_function_privilege('anon', v_fn_oid, 'EXECUTE')
          AND has_function_privilege('authenticated', v_fn_oid, 'EXECUTE')
          AND has_function_privilege('service_role', v_fn_oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Rollback 20261110150000: a client role still lacks EXECUTE on send_intro_with_decision after the GRANT';
  END IF;

  RAISE NOTICE 'Rollback 20261110150000: contact_requests_insert and the send_intro_with_decision grants are back to the definitions in effect before the migration.';
END $$;

COMMIT;
