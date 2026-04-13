-- Migration 043: Add 'allocator_connected' to strategies.source CHECK constraint
-- + SECURITY DEFINER RPC for atomic allocator account connection.
--
-- Why this migration exists
-- -------------------------
-- Allocators need to connect their own read-only exchange API keys to track
-- investments they've made with strategy managers. The existing wizard flow
-- (source='wizard') is for quant teams listing strategies on Discovery.
-- Allocator-connected strategies are private tracking entries that should
-- NOT appear on Discovery. A new source discriminator 'allocator_connected'
-- separates them from wizard/legacy/admin_import rows.
--
-- What this migration does
-- ------------------------
-- 1. Relaxes the strategies_source_check constraint to include
--    'allocator_connected' alongside the existing values.
-- 2. Creates a SECURITY DEFINER RPC `create_allocator_connected_strategy`
--    that atomically inserts an api_keys row + a strategies row
--    (source='allocator_connected', status='published') + a
--    portfolio_strategies row linking it to the allocator's portfolio.
-- 3. Self-verifying DO block.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: Relax source CHECK constraint
-- --------------------------------------------------------------------------
ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_source_check;

ALTER TABLE strategies
  ADD CONSTRAINT strategies_source_check
    CHECK (source IN ('legacy', 'wizard', 'admin_import', 'allocator_connected'));

-- --------------------------------------------------------------------------
-- STEP 2: create_allocator_connected_strategy RPC (SECURITY DEFINER)
-- --------------------------------------------------------------------------
-- Called from /api/allocator/connect-account after validate+encrypt succeeds.
-- Inserts an api_keys row + a published strategies row + a portfolio_strategies
-- row in a single transaction. Returns the new strategy_id and api_key_id.
CREATE OR REPLACE FUNCTION create_allocator_connected_strategy(
  p_user_id UUID,
  p_portfolio_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_strategy_name TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
  v_portfolio_owner UUID;
BEGIN
  -- Verify the caller is writing for themselves.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify portfolio ownership.
  SELECT user_id INTO v_portfolio_owner
    FROM portfolios
    WHERE id = p_portfolio_id;

  IF v_portfolio_owner IS NULL THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy: portfolio % not found',
      p_portfolio_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_portfolio_owner <> p_user_id THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy: portfolio % not owned by user %',
      p_portfolio_id, p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert the encrypted key row.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE
  )
  RETURNING id INTO v_key_id;

  -- Insert the strategy row. source='allocator_connected' means it won't
  -- appear on Discovery. status='published' so it's immediately visible
  -- in the allocator's portfolio.
  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, v_key_id, p_strategy_name, 'published', 'allocator_connected',
    '{}', '{}', '{}', ARRAY[p_exchange]
  )
  RETURNING id INTO v_strategy_id;

  -- Link to the allocator's portfolio.
  INSERT INTO portfolio_strategies (
    portfolio_id, strategy_id, current_weight, allocated_amount
  )
  VALUES (
    p_portfolio_id, v_strategy_id, 0, 0
  );

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;

COMMENT ON FUNCTION create_allocator_connected_strategy IS
  'Atomic api_keys + strategies (source=allocator_connected, status=published) + portfolio_strategies insert for allocator account connection. See migration 043.';

REVOKE ALL ON FUNCTION create_allocator_connected_strategy FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_allocator_connected_strategy TO authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  source_check_expr TEXT;
  fn_exists BOOLEAN;
  fn_secdef BOOLEAN;
BEGIN
  -- 1. Verify the CHECK constraint includes 'allocator_connected'
  SELECT pg_get_constraintdef(c.oid)
    INTO source_check_expr
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'strategies'
      AND c.conname = 'strategies_source_check'
      AND c.contype = 'c';

  IF source_check_expr IS NULL THEN
    RAISE EXCEPTION 'Migration 043 failed: strategies_source_check constraint missing';
  END IF;

  IF source_check_expr NOT LIKE '%allocator_connected%' THEN
    RAISE EXCEPTION 'Migration 043 failed: strategies_source_check does not include allocator_connected. Got: %',
      source_check_expr;
  END IF;

  -- 2. Verify the RPC exists and is SECURITY DEFINER
  SELECT
    EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'create_allocator_connected_strategy'),
    COALESCE(
      (SELECT p.prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.proname = 'create_allocator_connected_strategy'),
      FALSE)
  INTO fn_exists, fn_secdef;

  IF NOT fn_exists THEN
    RAISE EXCEPTION 'Migration 043 failed: create_allocator_connected_strategy function missing';
  END IF;

  IF NOT fn_secdef THEN
    RAISE EXCEPTION 'Migration 043 failed: create_allocator_connected_strategy is not SECURITY DEFINER';
  END IF;

  RAISE NOTICE 'Migration 043: allocator_connected source + RPC installed and verified.';
END
$$;

COMMIT;
