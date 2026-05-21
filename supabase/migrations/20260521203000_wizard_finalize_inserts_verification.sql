-- Wizard finalize writes strategy_verifications (QA report 2026-05-21, ISSUE-007).
--
-- BEFORE this migration: finalize_wizard_strategy (migration
-- 20260411103316) only UPDATEs the strategies row from draft to
-- pending_review. The sibling finalize_csv_strategy (migration
-- 20260501055202) atomically inserts BOTH the strategies row AND a
-- strategy_verifications row with trust_tier='csv_uploaded'. The wizard
-- API path was missing the second insert, so /strategy/[id] read
-- strategy.trust_tier as undefined (Locked D-04: trust_tier lives ONLY
-- on strategy_verifications) and the public Disclaimer fell back to
-- the 'self_reported' copy — contradicting the green "Verified" badge
-- the page renders for API-tier strategies. Allocators saw a strategy
-- card claiming "Verified" alongside footer text reading "Performance
-- data is self-reported by the manager and not independently verified
-- by Quantalyze." Manifestly wrong for a strategy whose factsheet was
-- computed from a read-only exchange API key.
--
-- AFTER: finalize_wizard_strategy inserts a strategy_verifications row
-- at status='validated' / trust_tier='api_verified' / flow_type='onboard'
-- in the same transaction as the strategies UPDATE. The source column is
-- derived from api_keys.exchange via the strategy's api_key_id —
-- {bybit, okx, binance} are admitted by the existing check constraint.
-- wizard_session_id is generated internally with gen_random_uuid()
-- because the RPC's signature is locked (no client-supplied value
-- threading without a coordinated route change). Telemetry that wants
-- the client-supplied wizard_session_id should read it from
-- /api/strategies/finalize-wizard's body, not from the verification row.
--
-- Backfill: the three CURRENT strategies (Momentum Sphinx, Alpha
-- Centauri, Phoenix Protocol) created via the wizard with api_key_id
-- IS NOT NULL and status IN ('pending_review','published') have no
-- verification row. Backfill them so the disclaimer flips for already-
-- published strategies on the next page load. Future inserts go through
-- the RPC; this is one-time.
--
-- Locked decision D-04 reaffirmed: trust_tier lives ONLY on
-- strategy_verifications. Do not add a strategy.trust_tier column.

CREATE OR REPLACE FUNCTION finalize_wizard_strategy(
  p_strategy_id UUID,
  p_user_id UUID,
  p_name TEXT,
  p_description TEXT,
  p_category_id UUID,
  p_strategy_types TEXT[],
  p_subtypes TEXT[],
  p_markets TEXT[],
  p_supported_exchanges TEXT[],
  p_leverage_range TEXT,
  p_aum NUMERIC,
  p_max_capacity NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_current_status TEXT;
  v_current_source TEXT;
  v_current_owner UUID;
  v_api_key_id UUID;
  v_exchange TEXT;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the row FOR UPDATE while we assert + promote. Matches the
  -- pattern used in migration 020 for RLS-scoped PII revokes.
  SELECT status, source, user_id, api_key_id
    INTO v_current_status, v_current_source, v_current_owner, v_api_key_id
    FROM strategies
    WHERE id = p_strategy_id
    FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % not found', p_strategy_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_owner <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % is not owned by user %',
      p_strategy_id, p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_current_source <> 'wizard' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has source=% (expected wizard)',
      p_strategy_id, v_current_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has status=% (expected draft)',
      p_strategy_id, v_current_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE strategies
    SET
      name = p_name,
      description = p_description,
      category_id = p_category_id,
      strategy_types = COALESCE(p_strategy_types, '{}'),
      subtypes = COALESCE(p_subtypes, '{}'),
      markets = COALESCE(p_markets, '{}'),
      supported_exchanges = COALESCE(p_supported_exchanges, '{}'),
      leverage_range = p_leverage_range,
      aum = p_aum,
      max_capacity = p_max_capacity,
      status = 'pending_review'
    WHERE id = p_strategy_id;

  -- Insert the API-tier verification row so the public /strategy/[id]
  -- disclaimer reads "Data verified from exchange API" instead of the
  -- self_reported fallback.
  --
  -- Only insert when:
  --  (a) the strategy is API-tier (api_key_id IS NOT NULL), AND
  --  (b) the api_keys row resolves to a known exchange admitted by the
  --      strategy_verifications.source check constraint.
  -- A future wizard variant with NULL api_key_id (e.g. paper-trading
  -- onboarding) would NOT get an api_verified row — that's the desired
  -- safety property. The CSV branch is the parallel path; it stays in
  -- finalize_csv_strategy.
  IF v_api_key_id IS NOT NULL THEN
    SELECT exchange
      INTO v_exchange
      FROM api_keys
      WHERE id = v_api_key_id;

    IF v_exchange IN ('bybit', 'okx', 'binance') THEN
      INSERT INTO strategy_verifications (
        strategy_id,
        wizard_session_id,
        status,
        trust_tier,
        flow_type,
        source
      ) VALUES (
        p_strategy_id,
        gen_random_uuid(),
        'validated',
        'api_verified',
        'onboard',
        v_exchange
      );
    END IF;
  END IF;

  RETURN p_strategy_id;
END;
$$;

COMMENT ON FUNCTION finalize_wizard_strategy IS
  'Promotes a wizard draft (source=wizard, status=draft) to status=pending_review after asserting ownership. Inserts strategy_verifications(trust_tier=api_verified) for API-tier drafts (api_key_id IS NOT NULL) so the public-sheet disclaimer reflects the verified provenance. Mirrors finalize_csv_strategy. See migration 031 (original) + QA report 2026-05-21.';

REVOKE ALL ON FUNCTION finalize_wizard_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalize_wizard_strategy TO authenticated;

-- Backfill: insert verification rows for already-finalized API-tier
-- strategies that landed before this migration. Idempotent guard: skip
-- any strategy_id that already has a verification row (the unique-row
-- constraint on the CSV path doesn't exist here, but a duplicate would
-- still leave the trust_tier read sane — pick the most-recent —
-- so the guard is for cleanliness, not correctness).
INSERT INTO strategy_verifications (
  strategy_id,
  wizard_session_id,
  status,
  trust_tier,
  flow_type,
  source,
  created_at
)
SELECT
  s.id,
  gen_random_uuid(),
  CASE
    WHEN s.status = 'published' THEN 'published'
    ELSE 'validated'
  END,
  'api_verified',
  'onboard',
  ak.exchange,
  s.created_at
FROM strategies s
JOIN api_keys ak ON ak.id = s.api_key_id
WHERE s.source = 'wizard'
  AND s.api_key_id IS NOT NULL
  AND s.status IN ('pending_review', 'published')
  AND ak.exchange IN ('bybit', 'okx', 'binance')
  AND NOT EXISTS (
    SELECT 1
    FROM strategy_verifications sv
    WHERE sv.strategy_id = s.id
  );
