-- ============================================================================
-- Migration: scenarios — durable per-allocator ScenarioDraft store (PERSIST-01)
-- Phase 23 / Plan 23-01
-- ============================================================================
-- The persistence spine for Phase 23 (save / reopen / list / rename / delete +
-- compare) and the foundation every later Phase 23+ plan builds on. Stores the
-- ScenarioDraft JSONB (the working composition + overrides), NEVER the raw
-- equity series — series are recomputed on reopen from live inputs.
--
-- RLS is the SOLE tenant gate (authenticated client → Postgres). The owner
-- policy mirrors api_keys_owner (20260405061912_rls_policies.sql:22): FOR ALL
-- with BOTH USING and WITH CHECK keyed on the owner column. profiles.id IS the
-- auth user id (profiles_own keys on id = auth.uid()), so
-- `allocator_id = auth.uid()` is the correct owner predicate.
--
-- RLS fails silently, so its behaviour is proven by supabase/tests/
-- test_scenarios_rls.sql asserting cross-tenant CONTENT by row id (read +
-- negative write path), not policy presence.
--
-- schema_version is present from this FIRST migration so Phases 26/27/28 can
-- add forward-compatible fields without a column migration.
--
-- Design notes:
--   - The name column carries no uniqueness constraint — allocators routinely
--     save same-titled variants; enforcing distinct titles would be a 23505
--     timebomb on the save path.
--   - NO set_updated_at() trigger function — a tracked function would trip the
--     dump-sql-functions.ts --check snapshot gate. The UPDATE route (Plan 02)
--     touches `updated_at = now()` in its payload instead. A plain table +
--     policy + index defines no tracked function.
--   - Index on (allocator_id, updated_at DESC) backs the list ordering
--     (most-recently-updated first, scoped to the owner).
--
-- DO NOT push to prod from this plan. The migration applies at /land-and-deploy
-- (anon NO-EXEC verified). No `supabase db push` here.
-- ============================================================================

CREATE TABLE scenarios (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id  UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  draft         JSONB NOT NULL,
  schema_version INT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE scenarios ENABLE ROW LEVEL SECURITY;

-- Owner-only access. Mirrors api_keys_owner: the authenticated allocator sees
-- and writes only their own rows; the WITH CHECK blocks writing a row owned by
-- another allocator (defence-in-depth on top of the route always sourcing
-- allocator_id from auth, never the request body).
--
-- `TO authenticated` scopes the policy to the role the request-scoped client
-- actually connects as. Without it the policy applies to ALL roles incl. anon;
-- `allocator_id = auth.uid()` already evaluates false for anon (auth.uid() is
-- NULL), but pinning the role makes the intent explicit and keeps the policy
-- from being the only thing standing between anon and the rows.
CREATE POLICY scenarios_owner ON scenarios
  FOR ALL
  TO authenticated
  USING (allocator_id = auth.uid())
  WITH CHECK (allocator_id = auth.uid());

-- Defense-in-depth: REVOKE all default grants from anon. Follows the api_keys
-- anon-hardening precedent (20260410225608_api_keys_column_revoke.sql) — a fresh table inherits
-- Supabase's default `GRANT ALL ON TABLE scenarios TO anon, authenticated`, so
-- anon retains table-level privileges even though the RLS predicate denies every
-- row. There is no public-read use case for a private per-allocator scenario
-- store; drop anon's grants entirely so anon is blocked at BOTH the grant layer
-- and the RLS layer. `authenticated` keeps its default grants — the
-- request-scoped client connects as `authenticated`, and the scenarios_owner
-- policy (above) scopes its rows.
REVOKE ALL ON scenarios FROM anon;

-- List ordering: most-recently-updated first, scoped to the owning allocator.
CREATE INDEX scenarios_allocator_updated_idx
  ON scenarios (allocator_id, updated_at DESC);
