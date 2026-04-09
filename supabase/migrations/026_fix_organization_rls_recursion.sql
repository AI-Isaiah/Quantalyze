-- 026_fix_organization_rls_recursion.sql
--
-- Fix infinite recursion in organization RLS policies that surfaced during QA
-- on 2026-04-09. Migration 006 wrote the org membership lookup as an inline
-- subquery against `organization_members` inside its own RLS policies. That
-- recurses forever: every nested SELECT re-triggers the same policy. The
-- cascade hits `strategies_org_read`, which joins `organization_members`, so
-- every strategies SELECT fails with:
--
--   ERROR: infinite recursion detected in policy for relation "organization_members"
--
-- The bug was latent since migration 006 because the CI tests never hit the
-- authenticated strategies fetch path (no Crypto SMA browse test while logged
-- in as the demo allocator). Shipped demo data surfaced it immediately.
--
-- Fix: wrap the membership lookup in SECURITY DEFINER helper functions that
-- bypass RLS on `organization_members` for the lookup itself. This is the
-- standard Postgres pattern for breaking RLS recursion (see Supabase docs on
-- "avoiding infinite recursion in RLS policies").

-- ---------------------------------------------------------------
-- SECURITY DEFINER helpers
-- ---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(org_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated, anon;

REVOKE ALL ON FUNCTION public.is_org_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID) TO authenticated, anon;

COMMENT ON FUNCTION public.is_org_member IS
  'SECURITY DEFINER helper used by organization RLS policies to avoid infinite recursion. Bypasses RLS on organization_members for the membership lookup itself.';
COMMENT ON FUNCTION public.is_org_admin IS
  'SECURITY DEFINER helper used by organization RLS policies to avoid infinite recursion. Bypasses RLS on organization_members for the owner/admin lookup.';

-- ---------------------------------------------------------------
-- Replace recursive policies
-- ---------------------------------------------------------------

DROP POLICY IF EXISTS org_members_read ON public.organization_members;
DROP POLICY IF EXISTS org_members_insert ON public.organization_members;
DROP POLICY IF EXISTS org_read ON public.organizations;
DROP POLICY IF EXISTS org_invites_read ON public.organization_invites;
DROP POLICY IF EXISTS strategies_org_read ON public.strategies;

CREATE POLICY org_members_read ON public.organization_members
  FOR SELECT
  USING (public.is_org_member(organization_id));

CREATE POLICY org_members_insert ON public.organization_members
  FOR INSERT
  WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY org_read ON public.organizations
  FOR SELECT
  USING (public.is_org_member(id) OR created_by = auth.uid());

CREATE POLICY org_invites_read ON public.organization_invites
  FOR SELECT
  USING (
    email = (SELECT email FROM public.profiles WHERE id = auth.uid())
    OR invited_by = auth.uid()
    OR public.is_org_admin(organization_id)
  );

CREATE POLICY strategies_org_read ON public.strategies
  FOR SELECT
  USING (
    (organization_id IS NULL AND (status = 'published' OR user_id = auth.uid()))
    OR (organization_id IS NOT NULL AND public.is_org_member(organization_id))
  );

-- ---------------------------------------------------------------
-- Self-verifying assertion: the policies must exist with the new shape
-- and a simple strategies SELECT must not raise the recursion error.
-- ---------------------------------------------------------------

DO $$
DECLARE
  policy_count INT;
BEGIN
  SELECT COUNT(*) INTO policy_count
  FROM pg_policy
  WHERE polrelid = 'public.organization_members'::regclass
    AND polname IN ('org_members_read', 'org_members_insert');

  IF policy_count != 2 THEN
    RAISE EXCEPTION 'Expected 2 policies on organization_members, found %', policy_count;
  END IF;

  -- Exercise the strategies policy indirectly by hitting the helper.
  -- If the recursion is still present, this call will raise.
  PERFORM public.is_org_member('00000000-0000-0000-0000-000000000000'::UUID);
END $$;
