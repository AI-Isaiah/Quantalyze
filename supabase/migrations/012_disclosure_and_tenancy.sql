-- Migration 012: Disclosure tier + tenancy pre-pay + compliance shell tables
-- See ~/.claude/plans/rosy-cuddling-teacup.md §5 Sprint 2 Track 4 (T4.1) + the
-- dual-voice eng review log for the schema rationale.
--
-- Prerequisites
--   * Migration 010 (portfolio intelligence) applied
--   * Migration 011 (perfect match) applied and `app.admin_email` is set
--   * pg_net extension enabled (required by the pg_cron job in migration 013)
--
-- Key decisions baked in
--   * Manager identity columns live on `profiles` (single source of truth).
--     Eng review flagged the v1 draft's `strategies.manager_contact_email` as
--     a single-source-of-truth violation.
--   * `disclosure_tier` is a CHECK-constrained TEXT column (not an enum type)
--     so we can broaden allowed values without ALTER TYPE gymnastics later.
--   * `tenant_id` is nullable everywhere — single-tenant in v1. Partner branding
--     becomes a config change, not a schema migration.
--   * `investor_attestations` is a dedicated table (not `profiles.attested_at`)
--     because `profiles` is globally selectable and Codex Eng flagged the column
--     approach as leaking PII.
--   * `data_deletion_requests` documents the manual GDPR Art. 17 flow — we
--     intake requests, the founder works them out of band within 30 days.

------------------------------------------------------------------
-- 1. Manager identity on profiles
--    Note: `linkedin` already exists from migration 001 — we reuse it rather
--    than adding a duplicate `linkedin_url` column.
--
--    Security: the `profiles` table has the legacy `profiles_read_public`
--    RLS policy from migration 002 (`USING (true)`) which allows ANY caller
--    (including unauthenticated anon clients) to SELECT every row. Adding
--    bio/years_trading/aum_range to that table without restriction would
--    leak the institutional manager identity to anyone who can guess a
--    user_id — defeating the disclosure_tier system.
--
--    Fix: column-level REVOKE on the new sensitive fields so neither anon
--    nor authenticated can read them directly. Service-role keeps access
--    so server-side code (queries.ts via createAdminClient) can still
--    fetch the manager identity for institutional-tier strategies.
--
--    Owners reading their own profile must use the admin client too — see
--    src/app/(dashboard)/profile/page.tsx + src/lib/queries.ts manager
--    fetches. The user.id check happens in app code via auth.getUser().
------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS years_trading INT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS aum_range TEXT;

REVOKE SELECT (bio, years_trading, aum_range) ON profiles FROM anon, authenticated;
GRANT  SELECT (bio, years_trading, aum_range) ON profiles TO service_role;

COMMENT ON COLUMN profiles.bio IS
  'Manager biography. Institutional lane only. Column SELECT revoked from anon/authenticated — read via service_role (createAdminClient).';
COMMENT ON COLUMN profiles.years_trading IS
  'Years of professional trading experience. Institutional lane only. SELECT revoked from anon/authenticated.';
COMMENT ON COLUMN profiles.aum_range IS
  'Self-reported AUM band (e.g. "$5M–$25M"). Institutional lane only. SELECT revoked from anon/authenticated.';

------------------------------------------------------------------
-- 2. Disclosure tier on strategies
------------------------------------------------------------------
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS disclosure_tier TEXT NOT NULL DEFAULT 'exploratory';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'strategies_disclosure_tier_check'
  ) THEN
    ALTER TABLE strategies
      ADD CONSTRAINT strategies_disclosure_tier_check
      CHECK (disclosure_tier IN ('institutional', 'exploratory'));
  END IF;
END $$;

ALTER TABLE strategies ADD COLUMN IF NOT EXISTS public_contact_email TEXT;

COMMENT ON COLUMN strategies.disclosure_tier IS
  'institutional = real name/bio/LinkedIn visible; exploratory = codename only. Discovery + match queue filter by tier.';
COMMENT ON COLUMN strategies.public_contact_email IS
  'Optional relay address for inbound messages. Falls back to profiles.email via join when null.';

-- Fast lane filter for discovery + match queue
CREATE INDEX IF NOT EXISTS idx_strategies_disclosure_tier
  ON strategies (disclosure_tier)
  WHERE status = 'published';

------------------------------------------------------------------
-- 3. Whitelabel pre-pay: nullable tenant_id on 5 tables
--    Default null means "Quantalyze tenant". Partner onboarding becomes a
--    single UPDATE + config change. Zero RLS changes in v1.
------------------------------------------------------------------
ALTER TABLE profiles            ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE strategies          ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE match_batches       ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE contact_requests    ADD COLUMN IF NOT EXISTS tenant_id UUID;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS tenant_id UUID;

CREATE INDEX IF NOT EXISTS idx_profiles_tenant_id           ON profiles (tenant_id)            WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_strategies_tenant_id         ON strategies (tenant_id)          WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_match_batches_tenant_id      ON match_batches (tenant_id)       WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contact_requests_tenant_id   ON contact_requests (tenant_id)    WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_portfolio_strategies_tenant  ON portfolio_strategies (tenant_id) WHERE tenant_id IS NOT NULL;

------------------------------------------------------------------
-- 4. investor_attestations — accredited-investor self-attestation
--    Keyed by user. RLS: user can read + insert own row. Admin + service role
--    can read all. No update/delete path — revoking accreditation is handled
--    by the deletion_request flow.
------------------------------------------------------------------
-- NOTE on retention: in v1 the founder processes data_deletion_requests
-- manually and does NOT hard-DELETE the profiles row, so the CASCADE here
-- never fires in practice. If an automatic deletion flow ships in Sprint 7+,
-- this CASCADE will need to be replaced by an archive-then-delete pattern
-- (insert into investor_attestations_archive, then DELETE) so the
-- compliance audit trail (date + version + IP) survives account removal.
-- Tracked as P1 tech debt — see TODOS.md.
CREATE TABLE IF NOT EXISTS investor_attestations (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  attested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version TEXT NOT NULL,
  ip_address TEXT
);

ALTER TABLE investor_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "attestations_self_read"   ON investor_attestations;
DROP POLICY IF EXISTS "attestations_self_insert" ON investor_attestations;
DROP POLICY IF EXISTS "attestations_admin_read"  ON investor_attestations;
DROP POLICY IF EXISTS "attestations_service_role" ON investor_attestations;

CREATE POLICY "attestations_self_read" ON investor_attestations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "attestations_self_insert" ON investor_attestations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "attestations_admin_read" ON investor_attestations
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

CREATE POLICY "attestations_service_role" ON investor_attestations
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Backfill: admins skip the gate. Their own account should not hit the gate
-- during demos. Uses the current attestation version string.
INSERT INTO investor_attestations (user_id, attested_at, version, ip_address)
SELECT id, now(), '2026-04-07', 'backfill'
FROM profiles
WHERE is_admin = true
ON CONFLICT (user_id) DO NOTHING;

------------------------------------------------------------------
-- 5. data_deletion_requests — manual GDPR Art. 17 intake
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_user
  ON data_deletion_requests (user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_deletion_requests_pending
  ON data_deletion_requests (requested_at DESC)
  WHERE completed_at IS NULL;

ALTER TABLE data_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deletion_self_insert" ON data_deletion_requests;
DROP POLICY IF EXISTS "deletion_self_read"   ON data_deletion_requests;
DROP POLICY IF EXISTS "deletion_admin_all"   ON data_deletion_requests;
DROP POLICY IF EXISTS "deletion_service_role" ON data_deletion_requests;

CREATE POLICY "deletion_self_insert" ON data_deletion_requests
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "deletion_self_read" ON data_deletion_requests
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "deletion_admin_all" ON data_deletion_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

CREATE POLICY "deletion_service_role" ON data_deletion_requests
  FOR ALL USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

------------------------------------------------------------------
-- ROLLBACK (for operational use — not auto-applied)
------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS data_deletion_requests;
--   DROP TABLE IF EXISTS investor_attestations;
--   DROP INDEX IF EXISTS idx_strategies_disclosure_tier;
--   DROP INDEX IF EXISTS idx_portfolio_strategies_tenant;
--   DROP INDEX IF EXISTS idx_contact_requests_tenant_id;
--   DROP INDEX IF EXISTS idx_match_batches_tenant_id;
--   DROP INDEX IF EXISTS idx_strategies_tenant_id;
--   DROP INDEX IF EXISTS idx_profiles_tenant_id;
--   ALTER TABLE portfolio_strategies DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE contact_requests     DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE match_batches        DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE strategies           DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE profiles             DROP COLUMN IF EXISTS tenant_id;
--   ALTER TABLE strategies           DROP COLUMN IF EXISTS public_contact_email;
--   ALTER TABLE strategies           DROP CONSTRAINT IF EXISTS strategies_disclosure_tier_check;
--   ALTER TABLE strategies           DROP COLUMN IF EXISTS disclosure_tier;
--   ALTER TABLE profiles             DROP COLUMN IF EXISTS aum_range;
--   ALTER TABLE profiles             DROP COLUMN IF EXISTS years_trading;
--   ALTER TABLE profiles             DROP COLUMN IF EXISTS bio;
-- COMMIT;
