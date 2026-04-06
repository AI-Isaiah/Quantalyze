-- 010: Portfolio Intelligence Platform
-- New tables: allocation_events, portfolio_analytics, portfolio_alerts, audit_log, verification_requests
-- Extends: portfolio_strategies (allocation tracking), relationship_documents (portfolio_id)
-- Storage: portfolio-documents bucket with path-based RLS

-- ============================================================
-- 1. NEW TABLES
-- ============================================================

-- allocation_events: immutable ledger of capital movements
CREATE TABLE IF NOT EXISTS allocation_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  strategy_id     UUID        REFERENCES strategies(id) ON DELETE SET NULL,
  event_type      TEXT        NOT NULL CHECK (event_type IN ('deposit', 'withdrawal', 'rebalance')),
  amount_usdt     NUMERIC     NOT NULL,
  source          TEXT        NOT NULL CHECK (source IN ('auto', 'manual')) DEFAULT 'manual',
  notes           TEXT,
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- portfolio_analytics: append-only computed snapshots (NO unique constraint)
-- Dashboard queries: ORDER BY computed_at DESC LIMIT 1
CREATE TABLE IF NOT EXISTS portfolio_analytics (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id              UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  computed_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  computation_status        TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (computation_status IN ('pending', 'computing', 'complete', 'failed')),
  computation_error         TEXT,
  -- performance
  twr                       NUMERIC,
  mwr                       NUMERIC,
  cagr                      NUMERIC,
  volatility                NUMERIC,
  sharpe                    NUMERIC,
  sortino                   NUMERIC,
  calmar                    NUMERIC,
  max_drawdown              NUMERIC,
  max_drawdown_duration_days INTEGER,
  -- allocation snapshot
  total_aum_usdt            NUMERIC,
  strategy_weights          JSONB,
  -- time-series
  equity_curve              JSONB,
  drawdown_series           JSONB,
  monthly_returns           JSONB,
  -- risk
  correlation_matrix        JSONB,
  factor_exposures          JSONB,
  -- narrative
  narrative_md              TEXT,
  data_quality_flags        JSONB
);

-- portfolio_alerts: triggered conditions for a portfolio
CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_id    UUID        NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  alert_type      TEXT        NOT NULL CHECK (alert_type IN ('drawdown', 'rebalance', 'correlation', 'custom')),
  severity        TEXT        NOT NULL CHECK (severity IN ('info', 'warning', 'critical')) DEFAULT 'info',
  title           TEXT        NOT NULL,
  body            TEXT,
  is_read         BOOLEAN     NOT NULL DEFAULT false,
  triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- audit_log: service-written immutable record of significant actions
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  portfolio_id    UUID        REFERENCES portfolios(id) ON DELETE SET NULL,
  action          TEXT        NOT NULL,
  entity_type     TEXT,
  entity_id       UUID,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- verification_requests: allocator identity verification flow
CREATE TABLE IF NOT EXISTS verification_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
  -- public token for tokenized verification link (unauthenticated access)
  public_token    TEXT        UNIQUE,
  expires_at      TIMESTAMPTZ,
  -- submission data
  legal_name      TEXT,
  entity_type     TEXT        CHECK (entity_type IN ('individual', 'institution')),
  country         TEXT,
  submitted_docs  JSONB,
  reviewer_notes  TEXT,
  reviewed_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. EXTEND EXISTING TABLES
-- ============================================================

-- portfolio_strategies: add allocation tracking columns
ALTER TABLE portfolio_strategies
  ADD COLUMN IF NOT EXISTS target_weight    NUMERIC CHECK (target_weight >= 0 AND target_weight <= 1),
  ADD COLUMN IF NOT EXISTS current_weight   NUMERIC CHECK (current_weight >= 0 AND current_weight <= 1),
  ADD COLUMN IF NOT EXISTS allocated_usdt   NUMERIC,
  ADD COLUMN IF NOT EXISTS notes            TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT now();

-- relationship_documents: make contact_request_id nullable so portfolio docs don't require one
-- then add portfolio_id foreign key
ALTER TABLE relationship_documents
  ALTER COLUMN contact_request_id DROP NOT NULL;

ALTER TABLE relationship_documents
  ADD COLUMN IF NOT EXISTS portfolio_id UUID REFERENCES portfolios(id) ON DELETE CASCADE;

-- ============================================================
-- 3. INDEXES
-- ============================================================

-- allocation_events
CREATE INDEX IF NOT EXISTS idx_allocation_events_portfolio
  ON allocation_events(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_allocation_events_occurred
  ON allocation_events(portfolio_id, occurred_at DESC);

-- portfolio_analytics (covering index for "latest snapshot" query)
CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_latest
  ON portfolio_analytics(portfolio_id, computed_at DESC);

-- portfolio_alerts
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_portfolio
  ON portfolio_alerts(portfolio_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_unread
  ON portfolio_alerts(portfolio_id) WHERE is_read = false;

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_user
  ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_portfolio
  ON audit_log(portfolio_id, created_at DESC);

-- verification_requests
CREATE INDEX IF NOT EXISTS idx_verification_requests_user
  ON verification_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_verification_requests_public_token
  ON verification_requests(public_token) WHERE public_token IS NOT NULL;

-- relationship_documents: portfolio lookup
CREATE INDEX IF NOT EXISTS idx_relationship_documents_portfolio
  ON relationship_documents(portfolio_id) WHERE portfolio_id IS NOT NULL;

-- ============================================================
-- 4. RLS: NEW TABLES
-- ============================================================

ALTER TABLE allocation_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_analytics  ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolio_alerts     ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_requests ENABLE ROW LEVEL SECURITY;

-- allocation_events: portfolio owner full access; service-role writes
CREATE POLICY "allocation_events_owner_select"
  ON allocation_events FOR SELECT
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "allocation_events_owner_insert"
  ON allocation_events FOR INSERT
  WITH CHECK (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "allocation_events_owner_update"
  ON allocation_events FOR UPDATE
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "allocation_events_owner_delete"
  ON allocation_events FOR DELETE
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

-- portfolio_analytics: owner reads; service-role-only writes
CREATE POLICY "portfolio_analytics_owner_select"
  ON portfolio_analytics FOR SELECT
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "portfolio_analytics_insert_deny"
  ON portfolio_analytics FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "portfolio_analytics_update_deny"
  ON portfolio_analytics FOR UPDATE
  USING (auth.role() = 'service_role');

-- portfolio_alerts: owner reads/manages; service-role writes
CREATE POLICY "portfolio_alerts_owner_select"
  ON portfolio_alerts FOR SELECT
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "portfolio_alerts_owner_update"
  ON portfolio_alerts FOR UPDATE
  USING (
    portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
  );

CREATE POLICY "portfolio_alerts_insert_deny"
  ON portfolio_alerts FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- audit_log: users read own entries; service-role-only writes
CREATE POLICY "audit_log_owner_select"
  ON audit_log FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "audit_log_insert_deny"
  ON audit_log FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "audit_log_update_deny"
  ON audit_log FOR UPDATE
  USING (false);

-- verification_requests: users manage own request; unauthenticated read via public_token
CREATE POLICY "verification_requests_owner_select"
  ON verification_requests FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "verification_requests_owner_insert"
  ON verification_requests FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "verification_requests_owner_update"
  ON verification_requests FOR UPDATE
  USING (user_id = auth.uid());

-- Allow anyone with a valid public_token to read that specific row (for email verification links)
CREATE POLICY "verification_requests_public_token_select"
  ON verification_requests FOR SELECT
  USING (
    public_token IS NOT NULL
    AND public_token = current_setting('request.jwt.claims', true)::jsonb->>'public_token'
  );

-- Reviewers (service_role) can update status
CREATE POLICY "verification_requests_service_update"
  ON verification_requests FOR UPDATE
  USING (auth.role() = 'service_role');

-- ============================================================
-- 5. RLS: UPDATE relationship_documents POLICIES
-- ============================================================

-- Add portfolio-aware SELECT policies (portfolio owner can view their docs)
CREATE POLICY "Portfolio owner can view portfolio documents"
  ON relationship_documents FOR SELECT
  USING (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Portfolio owner can insert portfolio documents"
  ON relationship_documents FOR INSERT
  WITH CHECK (
    portfolio_id IN (
      SELECT id FROM portfolios WHERE user_id = auth.uid()
    )
  );

-- ============================================================
-- 6. STORAGE BUCKET & PATH-BASED RLS
-- ============================================================

-- Create the portfolio-documents bucket (private by default)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'portfolio-documents',
  'portfolio-documents',
  false,
  52428800,  -- 50 MB per file
  ARRAY['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel', 'text/csv']
)
ON CONFLICT (id) DO NOTHING;

-- Upload: path must start with the authenticated user's id
-- Pattern: {user_id}/{portfolio_id}/{filename}
CREATE POLICY "portfolio_docs_upload"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'portfolio-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Select: path must start with the authenticated user's id
CREATE POLICY "portfolio_docs_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'portfolio-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Update: owner only
CREATE POLICY "portfolio_docs_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'portfolio-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Delete: owner only
CREATE POLICY "portfolio_docs_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'portfolio-documents'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
