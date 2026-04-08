-- Migration 016: partner_tag column for partner pilot flow
--
-- T-1.3 from the 2026-04-09 cap-intro demo sprint. Nullable TEXT column on
-- 4 tables lets us scope a pilot partnership to a subset of profiles,
-- strategies, contact_requests, and match_batches without a full tenant
-- model. NULL = native Quantalyze user; any string = member of that pilot.
--
-- This is a sketch for the first partner meeting, not production-grade.
-- Add a partial index and RLS scoping when the first partner actually uses
-- it in anger. For now, keeping it simple — column adds cascade through
-- Supabase-generated types on the next `supabase gen types` run.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_tag TEXT;
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS partner_tag TEXT;
ALTER TABLE contact_requests ADD COLUMN IF NOT EXISTS partner_tag TEXT;
ALTER TABLE match_batches ADD COLUMN IF NOT EXISTS partner_tag TEXT;

COMMENT ON COLUMN profiles.partner_tag IS
  'Optional tag scoping this profile to a partner pilot. NULL = native Quantalyze user. Set by /api/admin/partner-import.';
COMMENT ON COLUMN strategies.partner_tag IS
  'Optional tag scoping this strategy to a partner pilot.';
COMMENT ON COLUMN contact_requests.partner_tag IS
  'Optional tag scoping this contact request to a partner pilot.';
COMMENT ON COLUMN match_batches.partner_tag IS
  'Optional tag scoping this match batch to a partner pilot.';
