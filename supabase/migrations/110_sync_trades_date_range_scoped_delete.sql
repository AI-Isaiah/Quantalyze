-- Migration 110: sync_trades DELETE scoped to incoming JSONB date range
-- (audit-2026-05-07 P1 / G10.B.1, CRITICAL)
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 P1 (G10.B.1) — sync_trades RPC retry under the queue
-- path will DELETE+INSERT trade history twice, opening a data-loss
-- window every retry. Concrete sequence:
--
--   1. Worker claims sync_trades job, attempts=1.
--   2. Python fetches 60 days of daily_pnl rows from exchange.
--   3. RPC runs DELETE FROM trades + INSERT 60 rows, COMMIT.
--   4. Worker process is OOM-killed before mark_compute_job_done fires.
--   5. Watchdog reclaims at +10min, attempts=2 (or +1 after mig 109's
--      reclaim fix).
--   6. Python re-fetches from exchange — but if the exchange has
--      trimmed the user's window (binance: 90 days, okx: 365 days),
--      the new fetch returns only 30 days (e.g. days 30-60).
--   7. RPC's unconditional DELETE wipes the existing 60 daily_pnl
--      rows; the new INSERT re-creates only 30. Net silent loss of 30
--      summary rows for days 1-29.
--
-- Migration 102 protected raw fills (is_fill=true) by scoping DELETE
-- to is_fill=false. But the daily_pnl summary rows (is_fill=false) —
-- the entire population the RPC owns — are still wiped wholesale on
-- every call.
--
-- Fix
-- ---
-- Scope the DELETE to the date range of the incoming JSONB payload.
-- Computing MIN(timestamp) and MAX(timestamp) over the array gives the
-- exact window the new fetch is about to replace. Rows OUTSIDE that
-- window (e.g. older daily_pnl rows from a prior fetch that the
-- exchange has since trimmed) survive.
--
-- Edge cases:
--   * Empty payload (jsonb_array_length = 0): MIN/MAX are NULL, the
--     date-range predicates evaluate to UNKNOWN, and the DELETE
--     removes zero rows. Better than the current behavior which would
--     wipe everything for the strategy.
--   * Single-day payload: MIN = MAX, DELETE replaces only that day.
--   * Multi-day payload: DELETE replaces the contiguous window.
--   * Sparse payload (e.g. days 30, 45, 60): DELETE removes anything
--     in [30, 60] — including legitimate intermediate rows the new
--     fetch chose not to repopulate. This is the same wipe-and-replace
--     contract the legacy code had, just narrowed to the window the
--     payload covers.
--
-- This is the audit's "option 3" (checkpoint-scoped delete) variant.
-- The audit's preferred "option 1" (UPSERT-by-natural-key) requires
-- a unique constraint on daily_pnl rows, which they don't currently
-- have a defined natural key for (multiple summary rows per day per
-- exchange/symbol/side). Option 3 closes the data-loss window with
-- the smallest compatible diff and no schema change to the trades
-- table.
--
-- Compatibility
-- -------------
-- * Function signature: unchanged. Returns INTEGER row count of new
--   summary rows inserted (same semantic as before).
-- * Phase 2 raw fills (is_fill=true): protected by the COALESCE
--   filter from migration 102, preserved here.
-- * Advisory transaction lock: preserved. Per-strategy serialization
--   invariant from migration 007 still holds.
-- * Callers (analytics-service Phase 1 path, admin scripts, future
--   queue path): no changes required.
--
-- Rollback
-- --------
-- Restoring migration 102's body (unconditional date-range DELETE
-- scoped only by is_fill) re-opens the data-loss window but does NOT
-- destroy any data. Safe rollback by CREATE OR REPLACE with the prior
-- function body.

CREATE OR REPLACE FUNCTION sync_trades(
  p_strategy_id UUID,
  p_trades JSONB
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  trade_count INTEGER;
  v_min_ts    TIMESTAMPTZ;
  v_max_ts    TIMESTAMPTZ;
BEGIN
  -- Per-strategy serialization (auto-released at txn end). Mig 007.
  PERFORM pg_advisory_xact_lock(hashtext(p_strategy_id::text));

  -- Compute the date range of the incoming payload. NULL when the
  -- array is empty — the DELETE below then removes nothing, which
  -- preserves existing data. (mig 110 P1 / G10.B.1)
  SELECT
      MIN((t->>'timestamp')::timestamptz),
      MAX((t->>'timestamp')::timestamptz)
    INTO v_min_ts, v_max_ts
    FROM jsonb_array_elements(p_trades) AS t;

  -- Scoped DELETE: only legacy summary rows whose timestamp falls
  -- inside the incoming payload's window. Rows outside the window
  -- (older fetches the exchange has since trimmed) survive. Phase 2
  -- raw fills (is_fill=true) are still protected by the COALESCE
  -- filter inherited from migration 102.
  IF v_min_ts IS NOT NULL AND v_max_ts IS NOT NULL THEN
    DELETE FROM trades
     WHERE strategy_id = p_strategy_id
       AND COALESCE(is_fill, false) = false
       AND timestamp >= v_min_ts
       AND timestamp <= v_max_ts;
  END IF;

  -- Insert new daily_pnl summary rows from JSONB array.
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

COMMENT ON FUNCTION sync_trades(UUID, JSONB) IS
  'Phase-1 daily_pnl replacement for a strategy. DELETEs only is_fill=false rows '
  'whose timestamp falls inside the incoming payload''s [MIN,MAX] window so older '
  'rows that the exchange has trimmed survive the retry (mig 110 P1 / G10.B.1). '
  'Phase 2 raw fills (is_fill=true) are preserved per migration 102.';

-- Self-verification: the function body must include both the
-- date-range scoping AND the is_fill protection from mig 102. A
-- future migration that drops either guard fails loudly here.
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid)
    INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'sync_trades'
     AND pg_get_function_arguments(p.oid) ILIKE '%uuid%jsonb%';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 110 verification failed: sync_trades(UUID, JSONB) not found after CREATE OR REPLACE';
  END IF;

  IF v_body NOT ILIKE '%COALESCE(is_fill, false) = false%' THEN
    RAISE EXCEPTION
      'Migration 110 verification failed: sync_trades body lost the COALESCE(is_fill, false) = false guard from migration 102';
  END IF;

  IF v_body NOT ILIKE '%timestamp >= v_min_ts%'
     OR v_body NOT ILIKE '%timestamp <= v_max_ts%' THEN
    RAISE EXCEPTION
      'Migration 110 verification failed: sync_trades body does not include date-range scoped DELETE (mig 110 P1)';
  END IF;
END $$;
