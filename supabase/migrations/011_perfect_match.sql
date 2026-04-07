-- Migration 011: Perfect Match Engine (founder-amplifier)
-- See docs/superpowers/plans/2026-04-07-perfect-match-engine.md for the plan + dual-voice review.
--
-- Schema for the founder-only Match Queue. Algorithm computes scores in Python; only the
-- founder admin sees them in /admin/match. Allocators receive matches via the existing
-- contact_requests intro flow ("Isaiah recommends these 3"), never via an algorithmic score.
--
-- Key design decisions baked in from the eng review:
--   - is_admin BOOLEAN backfilled from app.admin_email at migration time
--   - RLS uses auth.role() = 'service_role' pattern (mirrors migration 010)
--   - match_batches parent table carries engine_version + effective_thresholds for debugging
--   - send_intro_with_decision SECURITY DEFINER RPC handles the contact_requests UNIQUE
--     constraint and the match_decisions write atomically
--   - Partial UNIQUE indexes enforce DB-level idempotency for sent_as_intro and thumbs

------------------------------------------------------------------
-- 1. Profile extension (admin gate + preferences timestamp)
------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS preferences_updated_at TIMESTAMPTZ;

-- Backfill is_admin from current ADMIN_EMAIL pattern (founder is the only admin today).
-- Set the postgres setting before running this migration:
--   ALTER DATABASE postgres SET app.admin_email = 'founder@quantalyze.io';
-- Then run the migration. If app.admin_email is not set, leave is_admin = false and
-- run a manual UPDATE after the migration applies (documented in the runbook).
DO $$
DECLARE
  v_admin_email TEXT;
BEGIN
  v_admin_email := current_setting('app.admin_email', true);
  IF v_admin_email IS NOT NULL AND v_admin_email <> '' THEN
    UPDATE profiles
    SET is_admin = true
    WHERE id IN (
      SELECT id FROM auth.users WHERE lower(email) = lower(v_admin_email)
    );
  END IF;
END $$;

------------------------------------------------------------------
-- 2. system_flags (scoped, single boolean for kill switch)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES profiles(id)
);

INSERT INTO system_flags (key, enabled) VALUES ('match_engine_enabled', true)
ON CONFLICT (key) DO NOTHING;

------------------------------------------------------------------
-- 3. allocator_preferences (allocator self-edits OR admin edits)
-- Self-editable columns vs admin-only columns enforced at the API layer (Task 2).
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS allocator_preferences (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  -- Self-editable
  mandate_archetype TEXT,
  target_ticket_size_usd NUMERIC,
  excluded_exchanges TEXT[],
  -- Admin-only (founder fills these in over time from conversations)
  max_drawdown_tolerance NUMERIC,
  min_track_record_days INT,
  min_sharpe NUMERIC,
  max_aum_concentration NUMERIC,
  preferred_strategy_types TEXT[],
  preferred_markets TEXT[],
  founder_notes TEXT,
  -- Audit
  edited_by_user_id UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

------------------------------------------------------------------
-- 4. match_batches (parent — one row per recompute run per allocator)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode TEXT NOT NULL CHECK (mode IN ('personalized', 'screening')),
  filter_relaxed BOOLEAN NOT NULL DEFAULT false,
  candidate_count INT NOT NULL DEFAULT 0,
  excluded_count INT NOT NULL DEFAULT 0,
  -- Provenance for "why was X excluded?" debugging
  engine_version TEXT NOT NULL,
  weights_version TEXT NOT NULL,
  effective_preferences JSONB NOT NULL,
  effective_thresholds JSONB NOT NULL,
  source_strategy_count INT NOT NULL,
  latency_ms INT
);

CREATE INDEX idx_match_batches_allocator_recent ON match_batches (allocator_id, computed_at DESC);

------------------------------------------------------------------
-- 5. match_candidates (children — one row per scored candidate)
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES match_batches(id) ON DELETE CASCADE,
  allocator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  score NUMERIC NOT NULL,
  score_breakdown JSONB NOT NULL,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  rank INT, -- 1..30 for candidates; NULL for excluded
  exclusion_reason TEXT CHECK (exclusion_reason IN (
    'below_min_sharpe', 'below_min_track_record', 'excluded_exchange',
    'exceeds_max_dd', 'off_mandate_type', 'owned', 'thumbs_down'
  )),
  exclusion_provenance TEXT,
  CHECK (
    (rank IS NOT NULL AND exclusion_reason IS NULL) OR
    (rank IS NULL AND exclusion_reason IS NOT NULL)
  )
);

-- Hot-path index excludes excluded rows
CREATE INDEX idx_match_cand_batch_rank
  ON match_candidates (batch_id, rank)
  WHERE exclusion_reason IS NULL;

CREATE INDEX idx_match_cand_strategy ON match_candidates (strategy_id);

------------------------------------------------------------------
-- 6. match_decisions (founder thumbs-up / down / sent-as-intro / snoozed)
-- This IS the ground truth that future tuning + ML eventually trains on.
------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  allocator_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  candidate_id UUID REFERENCES match_candidates(id),
  decision TEXT NOT NULL CHECK (decision IN ('thumbs_up', 'thumbs_down', 'sent_as_intro', 'snoozed')),
  founder_note TEXT,
  contact_request_id UUID REFERENCES contact_requests(id),
  decided_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_match_dec_allocator_recent ON match_decisions (allocator_id, created_at DESC);
CREATE INDEX idx_match_dec_strategy ON match_decisions (strategy_id);

-- DB-level idempotency: at most one sent_as_intro / thumbs_up / thumbs_down per (allocator, strategy)
CREATE UNIQUE INDEX uniq_match_dec_sent_per_pair
  ON match_decisions (allocator_id, strategy_id)
  WHERE decision = 'sent_as_intro';

CREATE UNIQUE INDEX uniq_match_dec_thumbup_per_pair
  ON match_decisions (allocator_id, strategy_id)
  WHERE decision = 'thumbs_up';

CREATE UNIQUE INDEX uniq_match_dec_thumbdown_per_pair
  ON match_decisions (allocator_id, strategy_id)
  WHERE decision = 'thumbs_down';

------------------------------------------------------------------
-- 7. SECURITY DEFINER RPC for atomic Send Intro
-- Wraps contact_requests upsert + match_decisions insert in one transaction.
-- Returns existing contact_request if one already exists for the pair.
-- Caller (Next.js admin handler) MUST verify is_admin before calling.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_intro_with_decision(
  p_allocator_id UUID,
  p_strategy_id UUID,
  p_candidate_id UUID,
  p_admin_note TEXT,
  p_decided_by UUID
) RETURNS TABLE (
  contact_request_id UUID,
  match_decision_id UUID,
  was_already_sent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_cr_id UUID;
  v_new_cr_id UUID;
  v_decision_id UUID;
  v_was_already_sent BOOLEAN := false;
BEGIN
  -- Check if contact_requests already has a row for this pair
  SELECT id INTO v_existing_cr_id
  FROM contact_requests
  WHERE allocator_id = p_allocator_id AND strategy_id = p_strategy_id;

  IF v_existing_cr_id IS NOT NULL THEN
    v_was_already_sent := true;
    v_new_cr_id := v_existing_cr_id;
  ELSE
    INSERT INTO contact_requests (allocator_id, strategy_id, status, message)
    VALUES (p_allocator_id, p_strategy_id, 'pending', p_admin_note)
    RETURNING id INTO v_new_cr_id;
  END IF;

  -- Insert decision (idempotent via uniq_match_dec_sent_per_pair)
  INSERT INTO match_decisions (
    allocator_id, strategy_id, candidate_id, decision,
    founder_note, contact_request_id, decided_by
  ) VALUES (
    p_allocator_id, p_strategy_id, p_candidate_id, 'sent_as_intro',
    p_admin_note, v_new_cr_id, p_decided_by
  )
  ON CONFLICT (allocator_id, strategy_id) WHERE decision = 'sent_as_intro' DO NOTHING
  RETURNING id INTO v_decision_id;

  -- If we hit ON CONFLICT, fetch the existing decision id
  IF v_decision_id IS NULL THEN
    SELECT id INTO v_decision_id
    FROM match_decisions
    WHERE allocator_id = p_allocator_id
      AND strategy_id = p_strategy_id
      AND decision = 'sent_as_intro';
  END IF;

  RETURN QUERY SELECT v_new_cr_id, v_decision_id, v_was_already_sent;
END;
$$;

REVOKE ALL ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID) TO authenticated;

------------------------------------------------------------------
-- 8. RLS — separate service-role + admin policies (mirrors migration 010 pattern)
------------------------------------------------------------------
ALTER TABLE allocator_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_flags ENABLE ROW LEVEL SECURITY;

-- allocator_preferences: allocator reads/writes own (column whitelist enforced at API);
-- admin reads/writes all
CREATE POLICY allocator_prefs_self_read ON allocator_preferences FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY allocator_prefs_admin_read ON allocator_preferences FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY allocator_prefs_self_insert ON allocator_preferences FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY allocator_prefs_self_update ON allocator_preferences FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY allocator_prefs_admin_all ON allocator_preferences FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY allocator_prefs_service_all ON allocator_preferences FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- match_batches: admin SELECT/DELETE only (no allocator access). Service role inserts.
CREATE POLICY match_batches_service_insert ON match_batches FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY match_batches_service_delete ON match_batches FOR DELETE
  USING (auth.role() = 'service_role');
CREATE POLICY match_batches_admin_select ON match_batches FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY match_batches_admin_delete ON match_batches FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- match_candidates: same shape
CREATE POLICY match_cand_service_insert ON match_candidates FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY match_cand_service_delete ON match_candidates FOR DELETE
  USING (auth.role() = 'service_role');
CREATE POLICY match_cand_admin_select ON match_candidates FOR SELECT
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY match_cand_admin_delete ON match_candidates FOR DELETE
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- match_decisions: admin reads/writes; service role can also insert/update for cron eval
CREATE POLICY match_dec_admin_all ON match_decisions FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY match_dec_service_all ON match_decisions FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- system_flags: scoped public-read for the kill switch only; admin and service role write
CREATE POLICY system_flags_match_engine_public_read ON system_flags FOR SELECT
  USING (key = 'match_engine_enabled');
CREATE POLICY system_flags_admin_all ON system_flags FOR ALL
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));
CREATE POLICY system_flags_service_all ON system_flags FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
