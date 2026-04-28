-- Migration 087: strategy_analytics_series sibling table + fetch RPC + atomic batch upsert RPC
-- Phase 12 / METRICS-17 (D-01..04): heavy-series storage to avoid 1MB JSONB TOAST ceiling.
--
-- Why this migration exists
-- -------------------------
-- `strategy_analytics.metrics_json` is JSONB; Postgres compresses to TOAST
-- once the row exceeds the page-size threshold. Heavy series (12mo daily
-- returns grid, rolling Sortino/Vol/Greeks at 252 trading days, exposure
-- and turnover series) push 5y strategies past the 1MB decompression
-- ceiling. Once decompression starts failing, ALL reads of that row fail
-- — including the above-the-fold scalars the discovery page needs.
--
-- This migration ships the sibling table that holds heavy series in
-- single-row units (one row per (strategy_id, kind)) so reads scale
-- per-panel instead of per-strategy. Above-the-fold scalars stay in
-- `metrics_json` (path-extracted via JSONB operators); panels 4–7 read
-- via `fetch_strategy_lazy_metrics(strategy_id, panel_id)` RPC.
--
-- What this migration does
-- ------------------------
-- 1. Creates `strategy_analytics_series` table per D-02 — composite PK
--    on (strategy_id, kind), JSONB payload column, computed_at, FK to
--    strategies(id) with ON DELETE CASCADE.
-- 2. Adds partial index `idx_strategy_analytics_series_payload_present`
--    on (strategy_id, kind) WHERE payload IS NOT NULL.
-- 3. Enables RLS with deny-all policy (mirroring compute_jobs in 032).
--    Operational data; allocator reads route through the SECURITY DEFINER
--    RPC below which performs the visibility check internally.
-- 4. Creates `fetch_strategy_lazy_metrics(p_strategy_id, p_panel_id)`
--    SECURITY DEFINER STABLE RPC per D-04. Visibility check via
--    `auth.uid()`; panel-id → kinds via CASE; aggregates {kind: payload}
--    via jsonb_object_agg. Granted to authenticated + anon (anon needed
--    for public-strategy reads on /discovery and /for-quants surfaces).
-- 5. Creates `upsert_strategy_analytics_series_batch(p_strategy_id,
--    p_kinds)` SECURITY DEFINER RPC per M-Grok-1 (12-REVIEWS.md). Atomic
--    batch upsert: caller passes a JSONB object {kind: payload, ...} and
--    all rows upsert in a single implicit transaction. Replaces the
--    per-kind round-trip loop in Plan 12-06's analytics_runner. Granted
--    to service_role only (analytics_runner uses service-role client).
-- 6. Self-verifying DO block asserts table + index + both RPCs + H-B
--    search_path hardening on both + RLS deny-all policy.
--
-- H-D from 12-REVIEWS.md
-- ----------------------
-- `equity_series_1y` lives in `metrics_json` per D-01, NOT in the sibling
-- table. The 'equity' panel mapping in fetch_strategy_lazy_metrics is
-- ARRAY['log_returns_series'] only. Phase 14b path-extracts
-- equity_series_1y from `metrics_json -> 'equity_series_1y'` directly,
-- not via this RPC.
--
-- H-B from 12-REVIEWS.md
-- ----------------------
-- Both RPCs use `SET search_path = public, pg_temp` (NOT pg_catalog) to
-- block the privilege-escalation pattern where an attacker plants
-- malicious functions in pg_temp/pg_catalog and waits for a SECURITY
-- DEFINER call to resolve to them. The DO block asserts proconfig.
--
-- M-Grok-1 from 12-REVIEWS.md
-- ---------------------------
-- The atomic batch upsert RPC replaces a per-kind upsert loop that would
-- have made each Phase 12 analytics run produce N round-trips (one per
-- sibling kind, ~12 kinds = 12 round-trips per strategy). With the batch
-- RPC, it's a single round-trip per strategy with the whole batch
-- atomic via the function's implicit transaction.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: strategy_analytics_series sibling table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS strategy_analytics_series (
    strategy_id  UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
    kind         TEXT NOT NULL,
    payload      JSONB NOT NULL,
    computed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (strategy_id, kind)
);

COMMENT ON TABLE strategy_analytics_series IS
  'Sibling table to strategy_analytics for heavy time-series payloads. One row per (strategy_id, kind). Kinds: daily_returns_grid, rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, exposure_series, turnover_series, log_returns_series. Avoids the 1MB TOAST decompression ceiling on strategy_analytics.metrics_json. See migration 087.';

COMMENT ON COLUMN strategy_analytics_series.kind IS
  'Snake-case identifier matching the metrics_json key naming convention (D-03). Add a new kind = INSERT a new row; no ALTER TABLE.';

COMMENT ON COLUMN strategy_analytics_series.payload IS
  'JSONB payload for this kind. Series shapes are kind-specific; the TS contract in src/lib/types.ts (StrategyAnalyticsSeriesKind) is the single source of truth for downstream consumers.';

-- --------------------------------------------------------------------------
-- STEP 2: partial index on present payloads
-- --------------------------------------------------------------------------
-- Used by readers that filter on rows with non-null payload (the common
-- case once a strategy's analytics run has populated the sibling table).
-- Partial keeps the index size bounded as the table grows.
CREATE INDEX IF NOT EXISTS idx_strategy_analytics_series_payload_present
  ON strategy_analytics_series (strategy_id, kind)
  WHERE payload IS NOT NULL;

-- --------------------------------------------------------------------------
-- STEP 3: RLS — deny-all (allocator reads go through fetch RPC)
-- --------------------------------------------------------------------------
-- Mirrors compute_jobs_deny_all from 032 STEP 5. The sibling table is
-- operational data; the only allocator-facing access path is the
-- SECURITY DEFINER fetch RPC below, which checks visibility internally.
-- Service-role writers (analytics_runner via upsert_strategy_analytics_series_batch)
-- bypass RLS by default in Supabase.
ALTER TABLE strategy_analytics_series ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS strategy_analytics_series_deny_all ON strategy_analytics_series;
CREATE POLICY strategy_analytics_series_deny_all ON strategy_analytics_series
    FOR ALL
    USING (false)
    WITH CHECK (false);

COMMENT ON POLICY strategy_analytics_series_deny_all ON strategy_analytics_series IS
  'Service-role-only at the policy layer. Non-service callers get zero rows on direct read. Allocator-side access goes through fetch_strategy_lazy_metrics SECURITY DEFINER RPC. See migration 087.';

-- --------------------------------------------------------------------------
-- STEP 4: fetch_strategy_lazy_metrics RPC (D-04)
-- --------------------------------------------------------------------------
-- Returns {kind: payload} JSONB object for the requested panel. Visibility
-- check matches getStrategyDetail / getPublicStrategyDetail semantics:
-- published strategies are visible to all; private strategies are visible
-- to the owner. On a failed visibility check, returns an empty JSONB
-- object (jsonb_build_object()) — never reveals whether a private
-- strategy exists by varying the error vs. empty response.
--
-- H-D: 'equity' panel maps to ARRAY['log_returns_series'] only.
-- equity_series_1y stays in metrics_json (D-01); Phase 14b path-extracts
-- it directly via `metrics_json -> 'equity_series_1y'`.
--
-- H-B: SECURITY DEFINER + SET search_path = public, pg_temp.
CREATE OR REPLACE FUNCTION fetch_strategy_lazy_metrics(
  p_strategy_id UUID,
  p_panel_id    TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
STABLE
AS $$
DECLARE
  v_kinds   TEXT[];
  v_visible BOOLEAN;
BEGIN
  -- Visibility check: matches getStrategyDetail / getPublicStrategyDetail
  -- — published strategies visible to all; private strategies to owner.
  SELECT EXISTS(
    SELECT 1 FROM strategies
     WHERE id = p_strategy_id
       AND (status = 'published' OR user_id = auth.uid())
  ) INTO v_visible;

  IF NOT v_visible THEN
    -- Empty object (NOT an error); never leaks private-strategy
    -- existence by error-vs-empty signal.
    RETURN jsonb_build_object();
  END IF;

  -- Panel-id → applicable sibling kinds (D-04 panel mapping).
  -- 'overview', 'drawdown', 'trades' resolve to empty arrays — those
  -- panels read scalars from metrics_json directly, no sibling rows.
  v_kinds := CASE p_panel_id
    WHEN 'overview'     THEN ARRAY[]::TEXT[]
    WHEN 'equity'       THEN ARRAY['log_returns_series']
    WHEN 'drawdown'     THEN ARRAY[]::TEXT[]
    WHEN 'returns_dist' THEN ARRAY['daily_returns_grid']
    WHEN 'rolling'      THEN ARRAY[
      'rolling_sortino_3m', 'rolling_sortino_6m', 'rolling_sortino_12m',
      'rolling_volatility_3m', 'rolling_volatility_6m', 'rolling_volatility_12m',
      'rolling_alpha', 'rolling_beta'
    ]
    WHEN 'trades'       THEN ARRAY[]::TEXT[]
    WHEN 'exposure'     THEN ARRAY['exposure_series', 'turnover_series']
    ELSE ARRAY[]::TEXT[]
  END;

  -- Aggregate matching rows into {kind: payload}. COALESCE protects
  -- against jsonb_object_agg returning NULL on zero matched rows.
  RETURN COALESCE((
    SELECT jsonb_object_agg(kind, payload)
      FROM strategy_analytics_series
     WHERE strategy_id = p_strategy_id
       AND kind = ANY(v_kinds)
  ), jsonb_build_object());
END;
$$;

COMMENT ON FUNCTION fetch_strategy_lazy_metrics IS
  'Lazy-fetch heavy series from strategy_analytics_series, scoped per panel. Visibility check inside (published OR owner); returns empty {} on miss. equity panel returns log_returns_series only — equity_series_1y stays in metrics_json (H-D). H-B: SET search_path = public, pg_temp. See migration 087.';

GRANT EXECUTE ON FUNCTION fetch_strategy_lazy_metrics TO authenticated, anon;

-- --------------------------------------------------------------------------
-- STEP 5: upsert_strategy_analytics_series_batch RPC (M-Grok-1)
-- --------------------------------------------------------------------------
-- Atomic batch upsert. Caller (analytics_runner) passes a JSONB object
-- {kind: payload, kind: payload, ...}; all rows upsert in a single
-- implicit transaction (the function body runs as one statement-tree
-- inside its own snapshot). Replaces the per-kind round-trip loop that
-- Plan 12-06 would otherwise need.
--
-- Why service_role only: analytics_runner is the only writer. Allocator
-- code never writes to the sibling table. The fetch_strategy_lazy_metrics
-- RPC above handles read access. Granting to authenticated would open a
-- privilege-escalation surface (no RLS on the table, so anyone with
-- EXECUTE on this RPC can write any (strategy_id, kind) row).
CREATE OR REPLACE FUNCTION upsert_strategy_analytics_series_batch(
  p_strategy_id UUID,
  p_kinds       JSONB  -- {kind: payload, ...}
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO strategy_analytics_series (strategy_id, kind, payload, computed_at)
  SELECT p_strategy_id, key, value, now()
    FROM jsonb_each(p_kinds)
   ON CONFLICT (strategy_id, kind) DO UPDATE
      SET payload     = EXCLUDED.payload,
          computed_at = EXCLUDED.computed_at;
END;
$$;

COMMENT ON FUNCTION upsert_strategy_analytics_series_batch IS
  'Phase 12 / M-Grok-1: atomic batch upsert of sibling-table rows. Caller (analytics_runner) passes a JSONB object {kind: payload, ...}; all rows upsert in a single implicit transaction. Replaces the per-kind round-trip loop. service_role only. See migration 087.';

REVOKE ALL ON FUNCTION upsert_strategy_analytics_series_batch FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION upsert_strategy_analytics_series_batch TO service_role;

-- --------------------------------------------------------------------------
-- STEP 6: self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts every component lands. Each RAISE EXCEPTION includes the
-- migration number so apply-time failures are unambiguous.
DO $$
BEGIN
  -- 1. table
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'strategy_analytics_series'
  ) THEN
    RAISE EXCEPTION 'Migration 087: strategy_analytics_series table missing';
  END IF;

  -- 2. partial index
  IF NOT EXISTS(
    SELECT 1 FROM pg_class
     WHERE relname = 'idx_strategy_analytics_series_payload_present'
  ) THEN
    RAISE EXCEPTION 'Migration 087: idx_strategy_analytics_series_payload_present missing';
  END IF;

  -- 3. fetch RPC present
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'fetch_strategy_lazy_metrics'
  ) THEN
    RAISE EXCEPTION 'Migration 087: fetch_strategy_lazy_metrics RPC missing';
  END IF;

  -- 4. H-B: fetch RPC has hardened search_path
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'fetch_strategy_lazy_metrics'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 087: fetch_strategy_lazy_metrics missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  -- 5. M-Grok-1: atomic batch upsert RPC present
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'upsert_strategy_analytics_series_batch'
  ) THEN
    RAISE EXCEPTION 'Migration 087: upsert_strategy_analytics_series_batch RPC missing (M-Grok-1 atomicity fix)';
  END IF;

  -- 6. H-B: batch RPC has hardened search_path
  IF NOT EXISTS(
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON p.pronamespace = n.oid
     WHERE n.nspname = 'public'
       AND p.proname = 'upsert_strategy_analytics_series_batch'
       AND 'search_path=public, pg_temp' = ANY(p.proconfig)
  ) THEN
    RAISE EXCEPTION 'Migration 087: upsert_strategy_analytics_series_batch missing SET search_path = public, pg_temp (H-B hardening)';
  END IF;

  -- 7. RLS deny-all policy present
  IF NOT EXISTS(
    SELECT 1 FROM pg_policy WHERE polname = 'strategy_analytics_series_deny_all'
  ) THEN
    RAISE EXCEPTION 'Migration 087: RLS deny-all policy missing';
  END IF;

  RAISE NOTICE 'Migration 087: strategy_analytics_series + fetch_strategy_lazy_metrics + upsert_strategy_analytics_series_batch RPCs installed.';
END $$;

COMMIT;
