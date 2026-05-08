-- Migration 101: CHECK constraint on partner_tag (audit-2026-05-07 #28)
--
-- Why this migration exists
-- -------------------------
-- partner_tag was added in migration 016 as a nullable TEXT column on
-- profiles / strategies / contact_requests / match_batches. The shape
-- contract (`^[a-z0-9-]+$`, see `src/lib/partner.ts`'s isValidPartnerTag)
-- only lives at the API layer. A future seed script, manual SQL backfill,
-- or any code path that bypasses /api/admin/partner-import can write
-- typo'd values like `'../'` or platform reserved values like `'admin'`,
-- and the row will silently scope to a partner that does not exist —
-- making it invisible to the partner-pilot dashboard but still visible
-- to PostgREST queries that don't filter by partner.
--
-- This migration enforces the same regex at the DB level so any future
-- non-API writer (psql, pg_admin, scripts/*) gets the same validation.
--
-- We do NOT add a `partners(tag PRIMARY KEY)` lookup + FK in this
-- migration — that is a larger structural change that needs its own
-- decision (lifecycle of partners, who creates them, how rotations are
-- handled). Adding the regex CHECK gets us 80% of the safety with
-- minimal blast radius.
--
-- The `^[a-z0-9-]+$` pattern matches `isValidPartnerTag` in
-- `src/lib/partner.ts`. If that regex changes, update this CHECK in a
-- follow-up migration.

DO $$
DECLARE
  bad_count int;
BEGIN
  -- Belt-and-suspenders: scrub any pre-existing rows that violate the
  -- CHECK regex before adding the constraint, otherwise the ADD
  -- CONSTRAINT step rolls back. Bad rows shouldn't exist in production
  -- (the API has been validating since migration 016 landed) but a stale
  -- staging copy could carry one.
  SELECT count(*) INTO bad_count
  FROM (
    SELECT partner_tag FROM profiles         WHERE partner_tag IS NOT NULL AND partner_tag !~ '^[a-z0-9-]+$'
    UNION ALL
    SELECT partner_tag FROM strategies       WHERE partner_tag IS NOT NULL AND partner_tag !~ '^[a-z0-9-]+$'
    UNION ALL
    SELECT partner_tag FROM contact_requests WHERE partner_tag IS NOT NULL AND partner_tag !~ '^[a-z0-9-]+$'
    UNION ALL
    SELECT partner_tag FROM match_batches    WHERE partner_tag IS NOT NULL AND partner_tag !~ '^[a-z0-9-]+$'
  ) bad;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Migration 101 cannot apply: % partner_tag rows fail the regex `^[a-z0-9-]+$`. Inspect and fix manually before re-running.',
      bad_count;
  END IF;
END $$;

ALTER TABLE profiles
  ADD CONSTRAINT profiles_partner_tag_format_check
  CHECK (partner_tag IS NULL OR partner_tag ~ '^[a-z0-9-]+$');

ALTER TABLE strategies
  ADD CONSTRAINT strategies_partner_tag_format_check
  CHECK (partner_tag IS NULL OR partner_tag ~ '^[a-z0-9-]+$');

ALTER TABLE contact_requests
  ADD CONSTRAINT contact_requests_partner_tag_format_check
  CHECK (partner_tag IS NULL OR partner_tag ~ '^[a-z0-9-]+$');

ALTER TABLE match_batches
  ADD CONSTRAINT match_batches_partner_tag_format_check
  CHECK (partner_tag IS NULL OR partner_tag ~ '^[a-z0-9-]+$');

COMMENT ON CONSTRAINT profiles_partner_tag_format_check         ON profiles
  IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';
COMMENT ON CONSTRAINT strategies_partner_tag_format_check       ON strategies
  IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';
COMMENT ON CONSTRAINT contact_requests_partner_tag_format_check ON contact_requests
  IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';
COMMENT ON CONSTRAINT match_batches_partner_tag_format_check    ON match_batches
  IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying assertion
-- --------------------------------------------------------------------------
-- Confirm all four CHECK constraints landed before declaring success. The
-- pg_constraint catalog returns one row per constraint; if any of them is
-- missing the migration was a no-op and we want to fail loudly rather
-- than land a soft no-op the way migration 017 did before 020 caught it.
DO $$
DECLARE
  expected_constraints text[] := ARRAY[
    'profiles_partner_tag_format_check',
    'strategies_partner_tag_format_check',
    'contact_requests_partner_tag_format_check',
    'match_batches_partner_tag_format_check'
  ];
  found int;
BEGIN
  SELECT count(*) INTO found
  FROM pg_constraint
  WHERE conname = ANY(expected_constraints) AND contype = 'c';

  IF found <> array_length(expected_constraints, 1) THEN
    RAISE EXCEPTION
      'Migration 101 failed: expected % CHECK constraints, found %. Rolling back.',
      array_length(expected_constraints, 1), found;
  END IF;
END $$;
