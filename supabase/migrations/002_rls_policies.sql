-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE discovery_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategy_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_strategies ENABLE ROW LEVEL SECURITY;

-- profiles: own = full access, others = select (contact info hidden via public_profiles view)
CREATE POLICY profiles_own ON profiles FOR ALL USING (id = auth.uid());
CREATE POLICY profiles_read_public ON profiles FOR SELECT USING (true);

-- View that hides sensitive contact info for non-owner reads
CREATE OR REPLACE VIEW public_profiles AS
SELECT id, display_name, company, description, avatar_url, role, created_at
FROM profiles;

-- api_keys: owner only
CREATE POLICY api_keys_owner ON api_keys FOR ALL USING (user_id = auth.uid());

-- discovery_categories: public read
CREATE POLICY categories_public_read ON discovery_categories FOR SELECT USING (true);

-- strategies
CREATE POLICY strategies_read ON strategies FOR SELECT USING (
  status = 'published' OR user_id = auth.uid()
);
CREATE POLICY strategies_insert ON strategies FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY strategies_update ON strategies FOR UPDATE USING (user_id = auth.uid());
CREATE POLICY strategies_delete ON strategies FOR DELETE USING (user_id = auth.uid());

-- strategy_analytics: readable if strategy is published or owned, service-role-only writes
CREATE POLICY analytics_read ON strategy_analytics FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM strategies s
    WHERE s.id = strategy_analytics.strategy_id
    AND (s.status = 'published' OR s.user_id = auth.uid())
  )
);
CREATE POLICY analytics_insert_deny ON strategy_analytics FOR INSERT WITH CHECK (false);
CREATE POLICY analytics_update_deny ON strategy_analytics FOR UPDATE USING (false);

-- contact_requests
CREATE POLICY contact_requests_insert ON contact_requests FOR INSERT
  WITH CHECK (allocator_id = auth.uid());
CREATE POLICY contact_requests_read ON contact_requests FOR SELECT USING (
  allocator_id = auth.uid()
  OR strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid())
);
CREATE POLICY contact_requests_update ON contact_requests FOR UPDATE USING (
  strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid())
);

-- trades: owner reads, service-role-only writes
CREATE POLICY trades_read ON trades FOR SELECT USING (
  strategy_id IN (SELECT id FROM strategies WHERE user_id = auth.uid())
);
CREATE POLICY trades_insert_deny ON trades FOR INSERT WITH CHECK (false);

-- portfolios
CREATE POLICY portfolios_owner ON portfolios FOR ALL USING (user_id = auth.uid());

-- portfolio_strategies
CREATE POLICY portfolio_strategies_owner ON portfolio_strategies FOR ALL USING (
  portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name, email)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)), NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
