-- Migration 030: for_quants_leads table for the /for-quants Request-a-Call CTA.
--
-- Why this migration exists
-- -------------------------
-- The /for-quants marketing page exposes two paths for
-- interested quant teams:
--   1. Self-service: click "Start Wizard" and go through /signup → /onboarding
--   2. White-glove: click "Request a Call" and fill out a modal form
--
-- The white-glove path POSTs to a new public endpoint `/api/for-quants-lead`
-- (CSRF + IP-rate-limited), which inserts a row into `for_quants_leads` via
-- the service-role Supabase client and emails the founder. The table is
-- service-role-only — no anon, no authenticated access — because:
--
--   - anon reads would let anyone scrape the lead list (spam, competitor
--     intel, GDPR exposure).
--   - authenticated reads don't make sense: the lead table is an internal
--     CRM, not user-facing data.
--   - INSERT must go through the service-role path so the API route can
--     enforce rate limiting and CSRF before the row ever exists.
--
-- Fix pattern (template: migrations 018 + 024)
-- --------------------------------------------
-- 1. CREATE TABLE with RLS enabled.
-- 2. NO anon or authenticated policies. The only writer is the service-role
--    client from `/api/for-quants-lead`, which bypasses RLS. Absence of
--    policies on an RLS-enabled table means all non-service-role access is
--    blocked by default — exactly what we want.
-- 3. Self-verifying DO block that RAISES EXCEPTION if any anon/authenticated
--    privilege exists. Same defense-in-depth pattern as migration 027.
--
-- Schema rationale
-- ----------------
-- id               — UUID PK (gen_random_uuid)
-- name             — contact name (required)
-- firm             — firm / team name (required — quant teams are firm-first)
-- email            — contact email (required; validated by Zod at API layer)
-- preferred_time   — optional free-text scheduling hint (e.g., "Tue morning PT")
-- notes            — optional free-text notes
-- source_ip        — captured from x-forwarded-for for rate-limit debugging
-- user_agent       — captured from req headers for bot filtering
-- created_at       — TIMESTAMPTZ DEFAULT now()
-- processed_at     — NULL until a founder marks the lead as processed
-- processed_by     — FK to profiles(id) once processed
--
-- Indexes
-- -------
-- (created_at DESC) — founder CRM will list newest-first
-- (email)           — dedup lookup + audit trail reads
--
-- Caller impact
-- -------------
-- Only the Python analytics service and the `/api/for-quants-lead` Next.js
-- route use the service-role client. No existing code paths read or write
-- this table.

-- --------------------------------------------------------------------------
-- STEP 1: table
-- --------------------------------------------------------------------------
CREATE TABLE for_quants_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  firm TEXT NOT NULL,
  email TEXT NOT NULL,
  preferred_time TEXT,
  notes TEXT,
  source_ip INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  processed_by UUID REFERENCES profiles(id)
);

COMMENT ON TABLE for_quants_leads IS
  'Public /for-quants Request-a-Call leads. Service-role only. See migration 030.';
COMMENT ON COLUMN for_quants_leads.source_ip IS
  'Captured from x-forwarded-for by /api/for-quants-lead for rate-limit diagnostics.';
COMMENT ON COLUMN for_quants_leads.user_agent IS
  'Captured from user-agent header for bot filtering.';

-- --------------------------------------------------------------------------
-- STEP 2: RLS enabled, NO policies, table-level privileges revoked
-- --------------------------------------------------------------------------
ALTER TABLE for_quants_leads ENABLE ROW LEVEL SECURITY;

-- Intentionally no CREATE POLICY statements. An RLS-enabled table with zero
-- policies blocks all non-service-role access by default. The service-role
-- client bypasses RLS entirely, which is the only intended write/read path.
--
-- Supabase grants ALL on new public-schema tables to `anon` and
-- `authenticated` via role-level default privileges. RLS alone blocks reads
-- (no matching policy), but belt-and-suspenders: revoke the table-level
-- grants so `has_table_privilege()` also reports no access. Same defense-
-- in-depth pattern as migration 027.
REVOKE ALL ON TABLE for_quants_leads FROM anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: indexes
-- --------------------------------------------------------------------------
CREATE INDEX for_quants_leads_created_at_idx ON for_quants_leads (created_at DESC);
CREATE INDEX for_quants_leads_email_idx ON for_quants_leads (email);

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying assertion — no anon/authenticated privileges
-- --------------------------------------------------------------------------
-- If the CREATE TABLE above somehow inherited GRANT ALL from a role-level
-- default privilege (Supabase does this for `anon`/`authenticated` on the
-- public schema), the DO block below raises and rolls back. This is the
-- same defense-in-depth pattern as migration 027.
--
-- Uses has_table_privilege (ground-truth API) instead of
-- information_schema.table_privileges because the latter only reports
-- explicit grants, missing role-level defaults. Same lesson as migration 029.
DO $$
DECLARE
  leaks int := 0;
  role_name text;
  priv text;
BEGIN
  FOR role_name IN SELECT unnest(ARRAY['anon', 'authenticated']) LOOP
    FOR priv IN SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) LOOP
      IF has_table_privilege(role_name, 'public.for_quants_leads', priv) THEN
        leaks := leaks + 1;
        RAISE WARNING 'Migration 030: role % has % on for_quants_leads', role_name, priv;
      END IF;
    END LOOP;
  END LOOP;

  IF leaks > 0 THEN
    RAISE EXCEPTION
      'Migration 030 failed: % anon/authenticated privileges on for_quants_leads. Service-role only. Rolling back.',
      leaks;
  END IF;

  RAISE NOTICE 'Migration 030: for_quants_leads created, service-role only verified.';
END
$$;
