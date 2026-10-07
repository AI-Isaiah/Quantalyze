-- ============================================================================
-- ROLLBACK for 20261008120000_for_quants_leads_contact_source.sql
-- Phase 164.6.6.3.5 DOMAINONE, plan 03.
-- ============================================================================
-- Manual, off the auto-apply path. Restores, VERBATIM from
-- 20260604120000_for_quants_leads_email_day_unique.sql:
--   * the TOTAL for_quants_leads_email_day_uniq index (unique on lower(email) and
--     the UTC day, no WHERE clause), and its COMMENT;
-- then drops the three CHECK constraints and the three columns the migration
-- added (source, topic, reference).
--
-- ⛔ THIS ROLLBACK CAN FAIL, AND THAT IS BY DESIGN. Re-creating the TOTAL unique
-- index FAILS when two rows share a lower(email) and a UTC day, and after the
-- migration that is exactly what two contact_form messages from one person on one
-- day are. The CREATE UNIQUE INDEX below then raises 23505, the transaction rolls
-- back, and NOTHING is changed (the whole file is one transaction). This file does
-- not delete or merge any row to make the index build: a contact message is a
-- stored fact, and silently dropping one would be the defect this migration fixed.
--
-- If the rollback fails for that reason the operator has two honest options:
--   (a) leave the migration in place (the partial index is a strict superset of
--       what the route needs), or
--   (b) deliberately resolve the colliding contact_form rows by hand (keep one,
--       archive the others elsewhere first), then re-run this file. That is a
--       human decision about real messages and is not scripted here.
-- Find the collisions with:
--   SELECT lower(email), (created_at AT TIME ZONE 'UTC')::date, count(*)
--     FROM for_quants_leads GROUP BY 1, 2 HAVING count(*) > 1;
-- Dropping the `source` column discards the contact_form / request_call
-- distinction, so after this rollback a contact message is indistinguishable from
-- a call request in the CRM. Export first if that matters.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations. To re-apply the migration, delete that
-- ledger row in the same change (or `supabase migration repair --status reverted
-- 20261008120000` against the intended database, after the marker query in
-- CLAUDE.md names that database). Never run this file, or any `--linked`
-- command, from a checkout whose CLI is linked to PRODUCTION without running the
-- marker query first.

BEGIN;
SET lock_timeout = '5s';

-- The index first: its predicate reads `source`, which is dropped below.
DROP INDEX IF EXISTS for_quants_leads_email_day_uniq;
CREATE UNIQUE INDEX for_quants_leads_email_day_uniq
  ON for_quants_leads (lower(email), ((created_at AT TIME ZONE 'UTC')::date));

COMMENT ON INDEX for_quants_leads_email_day_uniq IS
  'M-0324: dedups same-email same-UTC-day lead submissions, collapsing network-retry / double-submit duplicate rows and duplicate founder emails. Day key uses AT TIME ZONE UTC for immutability; lower(email) is defensive.';

ALTER TABLE for_quants_leads DROP CONSTRAINT IF EXISTS for_quants_leads_reference_len_check;
ALTER TABLE for_quants_leads DROP CONSTRAINT IF EXISTS for_quants_leads_topic_check;
ALTER TABLE for_quants_leads DROP CONSTRAINT IF EXISTS for_quants_leads_source_check;

ALTER TABLE for_quants_leads
  DROP COLUMN IF EXISTS reference,
  DROP COLUMN IF EXISTS topic,
  DROP COLUMN IF EXISTS source;

COMMIT;
