-- Migration 010: Portfolio Intelligence Platform
-- Creates tables for portfolio analytics, allocation events, alerts, audit log, verification requests
-- Extends portfolio_strategies with allocation tracking and relationship fields
-- Extends relationship_documents with portfolio_id (instead of separate portfolio_documents table)

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

-- allocation_events: capital movements in/out of strategies
CREATE TABLE IF NOT EXISTS allocation_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('deposit', 'withdrawal')),
  amount NUMERIC NOT NULL CHECK (amount > 0),
  event_date TIMESTAMPTZ NOT NULL,
  notes TEXT,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual')) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- portfolio_analytics: append-only computed snapshots
-- NO UNIQUE(portfolio_id) — each recompute creates a new row
-- Dashboard queries: ORDER BY computed_at DESC LIMIT 1
CREATE TABLE IF NOT EXISTS portfolio_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  computation_status TEXT DEFAULT 'pending'
    CHECK (computation_status IN ('pending', 'computing', 'complete', 'failed')),
  computation_error TEXT,
  total_aum NUMERIC,
  total_return_twr NUMERIC,
  total_return_mwr NUMERIC,
  portfolio_sharpe NUMERIC,
  portfolio_volatility NUMERIC,
  portfolio_max_drawdown NUMERIC,
  avg_pairwise_correlation NUMERIC,
  return_24h NUMERIC,
  return_mtd NUMERIC,
  return_ytd NUMERIC,
  narrative_summary TEXT,
  correlation_matrix JSONB,
  attribution_breakdown JSONB,
  risk_decomposition JSONB,
  benchmark_comparison JSONB,
  optimizer_suggestions JSONB,
  portfolio_equity_curve JSONB,
  rolling_correlation JSONB
);

-- portfolio_alerts: triggered conditions for a portfolio
CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id UUID NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL CHECK (alert_type IN ('drawdown', 'correlation_spike', 'sync_failure', 'status_change', 'optimizer_suggestion')),
  severity TEXT NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
  message TEXT NOT NULL,
  metadata JSONB,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  emailed_at TIMESTAMPTZ
);

-- audit_log: service-written immutable record
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- verification_requests: landing page strategy verification via exchange API keys
CREATE TABLE IF NOT EXISTS verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  exchange TEXT NOT NULL CHECK (exchange IN ('binance', 'okx', 'bybit')),
  api_key_encrypted TEXT NOT NULL,
  api_secret_encrypted TEXT,
  passphrase_encrypted TEXT,
  dek_encrypted TEXT NOT NULL,
  nonce TEXT,
  kek_version INT DEFAULT 1,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'complete', 'failed')),
  error_message TEXT,
  results JSONB,
  matched_strategy_id UUID REFERENCES strategies(id),
  discovered_manager_id UUID,
  public_token TEXT UNIQUE,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

-- ============================================================
-- 2. EXTEND EXISTING TABLES
-- ============================================================

-- portfolio_strategies: add allocation tracking columns
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS allocated_amount NUMERIC;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS current_weight NUMERIC;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS relationship_status TEXT DEFAULT 'connected'
  CHECK (relationship_status IN ('connected', 'paused', 'exited'));
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS founder_notes JSONB DEFAULT '[]'::jsonb;
ALTER TABLE portfolio_strategies ADD COLUMN IF NOT EXISTS last_founder_contact TIMESTAMPTZ;

-- relationship_documents: make contact_request_id nullable (portfolio docs don't have one)
-- then add portfolio_id foreign key
ALTER TABLE relationship_documents
  ALTER COLUMN contact_request_id DROP NOT NULL;

ALTER TABLE relationship_documents
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE;

-- ============================================================
-- 3. INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_allocation_events_portfolio ON allocation_events(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_allocation_events_strategy ON allocation_events(strategy_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_portfolio ON portfolio_analytics(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_latest ON portfolio_analytics(portfolio_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_portfolio ON portfolio_alerts(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_unacked ON portfolio_alerts(portfolio_id) WHERE acknowledged_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_verification_requests_email ON verification_requests(email);
CREATE INDEX IF NOT EXISTS idx_verification_requests_status ON verification_requests(status);
CREATE INDEX IF NOT EXISTS idx_verification_requests_public_token ON verification_requests(public_token) WHERE public_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_relationship_documents_portfolio ON relationship_documents(portfolio_id) WHERE portfolio_id IS NOT NULL;

-- ============================================================
-- 4. RLS
-- ============================================================

ALTER TABLE allocation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_analytics ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

-- allocation_events: owner of portfolio can read/insert/delete
CREATE POLICY allocation_events_owner_read ON allocation_events FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY allocation_events_owner_insert ON allocation_events FOR INSERT
  WITH CHECK (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY allocation_events_owner_delete ON allocation_events FOR DELETE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));

-- portfolio_analytics: service-role writes, owner reads
CREATE POLICY portfolio_analytics_owner_read ON portfolio_analytics FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_analytics_service_insert ON portfolio_analytics FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY portfolio_analytics_service_update ON portfolio_analytics FOR UPDATE
  USING (auth.role() = 'service_role');

-- portfolio_alerts: owner read/update (acknowledge), service-role inserts
CREATE POLICY portfolio_alerts_owner_read ON portfolio_alerts FOR SELECT
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_alerts_owner_update ON portfolio_alerts FOR UPDATE
  USING (portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid()));
CREATE POLICY portfolio_alerts_service_insert ON portfolio_alerts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- audit_log: service-role writes, owner reads own
CREATE POLICY audit_log_owner_read ON audit_log FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY audit_log_service_insert ON audit_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- verification_requests: service-role only (anonymous users go through API)
CREATE POLICY verification_requests_service_all ON verification_requests FOR ALL
  USING (auth.role() = 'service_role');

-- ============================================================
-- 5. UPDATE relationship_documents POLICIES
-- ============================================================

-- Portfolio owner can view/insert portfolio documents
CREATE POLICY "Portfolio owner can view portfolio documents"
  ON relationship_documents FOR SELECT
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "Portfolio owner can insert portfolio documents"
  ON relationship_documents FOR INSERT
  WITH CHECK (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

-- ============================================================
-- 6. STORAGE BUCKET & PATH-BASED RLS
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('portfolio-documents', 'portfolio-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Upload: path must start with authenticated user's id
-- Pattern: {user_id}/{portfolio_id}/{filename}
CREATE POLICY portfolio_docs_owner_upload ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'portfolio-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY portfolio_docs_owner_read ON storage.objects FOR SELECT
  USING (
    bucket_id = 'portfolio-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY portfolio_docs_owner_delete ON storage.objects FOR DELETE
  USING (
    bucket_id = 'portfolio-documents'
    AND auth.uid() IS NOT NULL
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
