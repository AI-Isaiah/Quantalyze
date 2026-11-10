-- ==========================================================================
-- Migration 20261110150000: harden the intro path's database-side authorization.
-- Phase 204 INTROAUTH, plan 01 (decisions D-01 to D-06).
--
-- WHAT IT DOES
-- ------------
-- Aligns the database-side authorization of the intro path with `/api/intro`,
-- so the table policy and the function ACL hold the same rule as the route:
--   1. The INSERT policy on public.contact_requests admits a row only for a caller
--      who is the row's allocator, holds the allocator or both role, is approved
--      (admin, a verified allocator, or a both account with both statuses
--      verified) and has an investor attestation on file. This is the predicate
--      `/api/intro` applies (src/lib/approval.ts, src/app/api/intro/route.ts).
--   2. public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) is
--      callable by service_role only. The admin match path reaches it through the
--      service-role client; its body is not touched here.
--
-- The route stays the UX-facing gate with its named codes. The policy and the ACL
-- hold the same rule on the database side.
--
-- DESIGN NOTES
-- ------------
-- - ALTER POLICY keeps the policy name, so there is no DROP/CREATE window.
-- - The check is inline EXISTS subqueries, no helper function: the subqueries read
--   the caller's own rows (id, role, allocator_status, manager_status, is_admin on
--   profiles; user_id and attested_at on investor_attestations), which are all
--   columns the client roles may read.
-- - No CREATE FUNCTION: the function body is unchanged.
--
-- The verification block is CATALOGUE-ONLY (pg_policies, pg_proc,
-- has_function_privilege, aclexplode). It reads no table, so it applies on
-- schema-only TEST exactly as on PROD ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). The
-- behavioural proof is supabase/tests/test_contact_requests_insert_intro_authz.sql.
-- Manual rollback: supabase/migrations/down/20261110150000-rollback.sql.
-- ==========================================================================

-- ==========================================================================
-- STEP 1: the INSERT policy matches /api/intro
-- ==========================================================================
ALTER POLICY "contact_requests_insert" ON public.contact_requests WITH CHECK (
  allocator_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role IN ('allocator', 'both')
      AND (p.is_admin
           OR (p.role = 'allocator' AND p.allocator_status = 'verified')
           OR (p.role = 'both' AND p.allocator_status = 'verified' AND p.manager_status = 'verified')))
  AND EXISTS (
    SELECT 1 FROM public.investor_attestations a
    WHERE a.user_id = auth.uid() AND a.attested_at IS NOT NULL));

-- ==========================================================================
-- STEP 2: the six-argument function is service_role only
-- ==========================================================================
REVOKE ALL ON FUNCTION public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated;

-- ==========================================================================
-- STEP 3: self-verify, CATALOGUE ONLY (no table is read)
-- ==========================================================================
DO $$
DECLARE
  v_cmd    TEXT;
  v_roles  TEXT[];
  v_check  TEXT;
  v_fn_oid OID;
  v_needle TEXT;
BEGIN
  SELECT pol.cmd, pol.roles, pol.with_check
    INTO v_cmd, v_roles, v_check
    FROM pg_policies pol
   WHERE pol.schemaname = 'public'
     AND pol.tablename = 'contact_requests'
     AND pol.policyname = 'contact_requests_insert';
  IF v_cmd IS NULL THEN
    RAISE EXCEPTION 'Migration 20261110150000: policy contact_requests_insert is missing';
  END IF;
  IF v_cmd <> 'INSERT' THEN
    RAISE EXCEPTION 'Migration 20261110150000: contact_requests_insert has cmd %, expected INSERT', v_cmd;
  END IF;
  IF v_roles IS DISTINCT FROM ARRAY['public']::TEXT[] THEN
    RAISE EXCEPTION 'Migration 20261110150000: contact_requests_insert roles are %, expected {public}', v_roles;
  END IF;
  FOREACH v_needle IN ARRAY ARRAY['allocator_id', 'profiles', 'investor_attestations', 'attested_at'] LOOP
    IF v_check IS NULL OR position(v_needle IN v_check) = 0 THEN
      RAISE EXCEPTION 'Migration 20261110150000: contact_requests_insert WITH CHECK does not mention %', v_needle;
    END IF;
  END LOOP;

  v_fn_oid := to_regprocedure('public.send_intro_with_decision(uuid,uuid,uuid,uuid,text,uuid)');
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261110150000: public.send_intro_with_decision(uuid, uuid, uuid, uuid, text, uuid) is missing';
  END IF;
  IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261110150000: service_role lacks EXECUTE on send_intro_with_decision (the admin match path cannot call it)';
  END IF;
  IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261110150000: anon can still EXECUTE send_intro_with_decision';
  END IF;
  IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261110150000: authenticated can still EXECUTE send_intro_with_decision';
  END IF;
  -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
  IF EXISTS (SELECT 1
               FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
              WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261110150000: PUBLIC still holds EXECUTE on send_intro_with_decision';
  END IF;

  RAISE NOTICE 'Migration 20261110150000: contact_requests_insert matches the /api/intro predicate and send_intro_with_decision is service_role only (catalogue verified).';
END $$;

-- ==========================================================================
-- END OF MIGRATION 20261110150000
-- ==========================================================================
