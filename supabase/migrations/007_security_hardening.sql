-- Phase 1: Security + Data Correctness

-- 1.1 Enable RLS on benchmark_prices (was the only table without it)
ALTER TABLE benchmark_prices ENABLE ROW LEVEL SECURITY;

-- Public read: anyone authenticated can read benchmark prices
CREATE POLICY benchmark_prices_select ON benchmark_prices
  FOR SELECT USING (true);

-- Service-role write only: only the analytics service (via service_role key) can insert/update
-- No INSERT/UPDATE/DELETE policies for authenticated users = they can't write
CREATE POLICY benchmark_prices_insert ON benchmark_prices
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

CREATE POLICY benchmark_prices_update ON benchmark_prices
  FOR UPDATE USING (auth.role() = 'service_role');

CREATE POLICY benchmark_prices_delete ON benchmark_prices
  FOR DELETE USING (auth.role() = 'service_role');

-- 1.6 Add account_balance column to api_keys for accurate capital estimation
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS account_balance_usdt DECIMAL;

-- 1.5 Atomic trade sync: advisory-lock-protected delete+insert
-- This function acquires an advisory lock on the strategy_id hash,
-- deletes existing trades, and inserts new ones atomically.
CREATE OR REPLACE FUNCTION sync_trades(
  p_strategy_id UUID,
  p_trades JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trade_count INTEGER;
BEGIN
  -- Acquire advisory lock scoped to this transaction (auto-released on commit/rollback)
  PERFORM pg_advisory_xact_lock(hashtext(p_strategy_id::text));

  -- Delete existing trades for this strategy
  DELETE FROM trades WHERE strategy_id = p_strategy_id;

  -- Insert new trades from JSONB array
  INSERT INTO trades (strategy_id, exchange, symbol, side, price, quantity, fee, fee_currency, timestamp, order_type)
  SELECT
    p_strategy_id,
    (t->>'exchange')::text,
    (t->>'symbol')::text,
    (t->>'side')::text,
    (t->>'price')::decimal,
    (t->>'quantity')::decimal,
    COALESCE((t->>'fee')::decimal, 0),
    COALESCE(t->>'fee_currency', 'USDT'),
    (t->>'timestamp')::timestamptz,
    COALESCE(t->>'order_type', 'market')
  FROM jsonb_array_elements(p_trades) AS t;

  GET DIAGNOSTICS trade_count = ROW_COUNT;
  RETURN trade_count;
END;
$$;

-- Add sync_status tracking for Phase 3 sync progress indicator
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'idle'
  CHECK (sync_status IN ('idle', 'syncing', 'computing', 'complete', 'complete_with_warnings', 'error'));
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sync_started_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS sync_error TEXT;
