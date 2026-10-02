-- Additive stand-in for Supabase's `auth.role()`, shaped exactly like
-- 01-fixture-core.sql's `auth.uid()`: it reads the `role` claim out of the
-- request.jwt.claims GUC the gates already drive with set_config. Apply AFTER
-- 01-fixture-core.sql. Never a second base.
--
-- ⚠️ NULLIF BEFORE the cast, for the reason 01-fixture-core.sql records at its
-- own auth.uid(): a `set_config('request.jwt.claims', NULL, true)` leaves the
-- EMPTY STRING behind, not NULL, and ''::jsonb raises 22P02.
--
-- WHY IT IS NEEDED: policies of the `*_service_all` family
-- (20260420213754:407-410 and every migration that copies that precedent) spell
-- their predicate `auth.role() = 'service_role'`, so the function must exist for
-- the CREATE POLICY to parse at all. It is scaffold, not an object under test:
-- the arms that read it assert what the POLICY does with its result.
CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT
  LANGUAGE sql STABLE AS $$
    SELECT COALESCE(
             NULLIF(current_setting('request.jwt.claim.role', true), ''),
             NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
           )
  $$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;
