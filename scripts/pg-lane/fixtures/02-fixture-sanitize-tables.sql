-- Additive stand-ins for every relation sanitize_user names. Column sets are
-- the ones the function actually writes — nothing else. Empty tables: the
-- SANITIZE arms assert on strategy_shares, not on these.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS company TEXT, ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS telegram TEXT, ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS linkedin TEXT, ADD COLUMN IF NOT EXISTS avatar_url TEXT,
  ADD COLUMN IF NOT EXISTS bio TEXT, ADD COLUMN IF NOT EXISTS years_trading TEXT,
  ADD COLUMN IF NOT EXISTS aum_range TEXT, ADD COLUMN IF NOT EXISTS partner_tag TEXT;
ALTER TABLE strategies
  ADD COLUMN IF NOT EXISTS description TEXT, ADD COLUMN IF NOT EXISTS codename TEXT,
  ADD COLUMN IF NOT EXISTS public_contact_email TEXT, ADD COLUMN IF NOT EXISTS partner_tag TEXT,
  ADD COLUMN IF NOT EXISTS review_note TEXT;
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS encrypted_password TEXT,
  ADD COLUMN IF NOT EXISTS raw_user_meta_data JSONB, ADD COLUMN IF NOT EXISTS raw_app_meta_data JSONB,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS phone TEXT, ADD COLUMN IF NOT EXISTS phone_confirmed_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS auth.refresh_tokens (user_id TEXT);
CREATE TABLE IF NOT EXISTS auth.sessions       (user_id UUID);
CREATE TABLE IF NOT EXISTS api_keys            (user_id UUID);
CREATE TABLE IF NOT EXISTS trades              (strategy_id UUID, raw_data JSONB,
                                                exchange_order_id TEXT, exchange_fill_id TEXT);
CREATE TABLE IF NOT EXISTS verification_requests_legacy (email TEXT);
CREATE TABLE IF NOT EXISTS notification_dispatches      (recipient_email TEXT);
CREATE TABLE IF NOT EXISTS portfolios          (user_id UUID, name TEXT, description TEXT);
CREATE TABLE IF NOT EXISTS allocator_preferences (user_id UUID);
CREATE TABLE IF NOT EXISTS user_favorites        (user_id UUID);
CREATE TABLE IF NOT EXISTS user_notes            (user_id UUID);
CREATE TABLE IF NOT EXISTS investor_attestations (user_id UUID);
CREATE TABLE IF NOT EXISTS user_app_roles        (user_id UUID);
CREATE TABLE IF NOT EXISTS organizations         (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                                                  created_by UUID);
CREATE TABLE IF NOT EXISTS organization_members  (organization_id UUID, user_id UUID, role TEXT);
CREATE TABLE IF NOT EXISTS organization_invites  (invited_by UUID);
CREATE TABLE IF NOT EXISTS match_batches         (allocator_id UUID);

CREATE OR REPLACE FUNCTION public.log_audit_event_service(
  p_user_id UUID, p_action TEXT, p_entity_type TEXT, p_entity_id UUID, p_metadata JSONB)
 RETURNS void LANGUAGE plpgsql AS $f$ BEGIN RETURN; END $f$;
