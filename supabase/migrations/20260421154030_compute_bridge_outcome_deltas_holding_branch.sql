-- Migration 073: extend compute_bridge_outcome_deltas() with holding-ref branch + helpers
-- Phase 09 / D-12 + finding f3 — extends migration 060's compute_bridge_outcome_deltas()
-- with a holding-ref branch AND converts the strategy branch's INNER JOIN on match_decisions
-- to LEFT JOIN + OR-filter so legacy bridge_outcomes rows where match_decision_id IS NULL
-- (ON DELETE SET NULL cascade) are not silently dropped.
-- Cadence (pg_cron 0 3 * * *) unchanged. Idempotency guard (WHERE delta_30d IS NULL
-- OR needs_recompute = TRUE) preserved verbatim.
--
-- What this migration does:
--   STEP 1: Helper function extract_symbol_value_at — reads per-symbol USD value from
--           allocator_equity_snapshots.breakdown jsonb on a given asof date
--   STEP 2: Helper function parse_holding_ref — splits "holding:{venue}:{symbol}:{holding_type}"
--           into a (venue, symbol, holding_type) row; empty set on invalid input
--   STEP 3: CREATE OR REPLACE compute_bridge_outcome_deltas() with:
--           - strategy_candidates CTE: LEFT JOIN match_decisions + OR filter (finding f3)
--           - strategy_computed / strategy_updated CTEs: semantically identical to migration 060
--           - holding_candidates CTE: new, INNER JOIN match_decisions filtered on original_holding_ref IS NOT NULL
--           - holding_computed / holding_updated CTEs: new, reads per-symbol series from breakdown
--   STEP 4: GRANT re-apply (CREATE OR REPLACE strips existing GRANTs)
--   STEP 5: Self-verifying DO block (4 assertions) + greppable NOTICE strings (finding g3)
--
-- What this migration does NOT do:
--   - Re-schedule pg_cron (the existing '0 3 * * *' schedule targets whichever body is live)
--   - Modify the strategy-branch computation semantically (extract_delta / extract_estimated preserved)
--   - Touch the estimated_delta_bps / estimated_days columns on holding-branch rows (those
--     apply only to the strategy branch which has a cumulative returns_series)
--
-- Finding f3 applied: strategy branch changed from INNER JOIN to LEFT JOIN + OR filter
-- to preserve legacy bridge_outcomes rows where match_decision_id IS NULL (any row
-- where the linked match_decision was deleted via ON DELETE SET NULL).
--
-- Application path: authored here; applied via `supabase db push`.
-- Self-verifying DO block raises EXCEPTION on any invariant failure.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: Helper — extract_symbol_value_at
-- --------------------------------------------------------------------------
-- Reads the per-symbol USD value on a given asof from
-- allocator_equity_snapshots.breakdown jsonb. The breakdown column carries
-- a jsonb object keyed by symbol: { "BTC": 50000, "ETH": 30000, ... }.
-- Returns NULL when the symbol is absent OR when the value is zero (prevents
-- divide-by-zero in the holding delta computation).
CREATE OR REPLACE FUNCTION public.extract_symbol_value_at(
  p_allocator_id UUID,
  p_symbol       TEXT,
  p_asof         DATE
) RETURNS NUMERIC
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT NULLIF((breakdown ->> p_symbol)::NUMERIC, 0)
    FROM public.allocator_equity_snapshots
   WHERE allocator_id = p_allocator_id
     AND asof = p_asof
   LIMIT 1;
$$;

COMMENT ON FUNCTION public.extract_symbol_value_at IS
  'Phase 09 / D-12. Reads per-symbol USD value on a given asof from '
  'allocator_equity_snapshots.breakdown jsonb. Returns NULL when symbol is absent '
  'OR when value is 0 (prevents divide-by-zero in holding delta computation). '
  'breakdown format: { "BTC": 50000, "ETH": 30000, ... } (Phase 07 D-02).';

-- --------------------------------------------------------------------------
-- STEP 2: Helper — parse_holding_ref
-- --------------------------------------------------------------------------
-- Splits "holding:{venue}:{symbol}:{holding_type}" into a typed row.
-- Strips the "holding:" prefix (8 chars; substring starts at position 9).
-- Returns EMPTY (no RETURN NEXT) when:
--   - p_ref IS NULL
--   - p_ref does not start with 'holding:'
--   - the remainder does not split into exactly 3 colon-delimited parts
-- RETURNS NEXT only on valid 3-part holding refs.
CREATE OR REPLACE FUNCTION public.parse_holding_ref(
  p_ref TEXT
) RETURNS TABLE(venue TEXT, symbol TEXT, holding_type TEXT)
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  v_parts TEXT[];
BEGIN
  -- Reject NULL or missing prefix
  IF p_ref IS NULL OR p_ref NOT LIKE 'holding:%' THEN
    RETURN;
  END IF;

  -- Strip 'holding:' prefix (8 chars) and split on ':'
  v_parts := string_to_array(substring(p_ref FROM 9), ':');

  -- Require exactly 3 parts: venue, symbol, holding_type
  IF array_length(v_parts, 1) != 3 THEN
    RETURN;
  END IF;

  venue        := v_parts[1];
  symbol       := v_parts[2];
  holding_type := v_parts[3];
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.parse_holding_ref IS
  'Phase 09 / D-12. Parses "holding:{venue}:{symbol}:{holding_type}" into a typed row. '
  'Returns empty result set for NULL, non-holding: prefixed strings, or refs that do not '
  'split into exactly 3 colon-delimited parts after stripping the prefix. '
  'IMMUTABLE — safe for use in index expressions and planner optimization.';

-- --------------------------------------------------------------------------
-- STEP 3: CREATE OR REPLACE compute_bridge_outcome_deltas
-- --------------------------------------------------------------------------
-- Full replacement of the migration 060 function body. Signature preserved
-- verbatim: RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ).
-- Security posture preserved: SECURITY DEFINER + locked search_path.
--
-- Changes from migration 060:
--   1. strategy_candidates CTE: INNER JOIN → LEFT JOIN + OR filter (finding f3)
--      so legacy rows with match_decision_id IS NULL are still processed.
--   2. strategy_computed/strategy_updated: semantically identical to migration 060
--      (COALESCE + idempotency guard preserved verbatim).
--   3. holding_candidates CTE: NEW — INNER JOIN match_decisions filtered on
--      original_holding_ref IS NOT NULL + LATERAL parse_holding_ref.
--   4. holding_computed CTE: NEW — per-symbol value ratio from extract_symbol_value_at.
--   5. holding_updated CTE: NEW — writes delta_30d/90d/180d only (no estimated_delta_bps).
--   6. Final SELECT: sums strategy_updated + holding_updated row counts.
CREATE OR REPLACE FUNCTION public.compute_bridge_outcome_deltas()
RETURNS TABLE(updated_count INT, failed_count INT, batch_started_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
BEGIN
  WITH
  -- -----------------------------------------------------------------------
  -- strategy_candidates: LEFT JOIN on match_decisions (finding f3)
  -- -----------------------------------------------------------------------
  -- Changed from INNER JOIN (migration 060) to LEFT JOIN + OR filter.
  -- This preserves two classes of rows:
  --   (a) Legacy rows: bridge_outcomes.match_decision_id IS NULL (the match
  --       decision was deleted via ON DELETE SET NULL, or was never set for
  --       early-access pre-link rows). These rows have a real strategy_id and
  --       a valid strategy_analytics.returns_series — they should still be
  --       processed by the cron.
  --   (b) Post-Phase-09 strategy-sourced rows: match_decision_id IS NOT NULL,
  --       md.original_strategy_id IS NOT NULL, md.original_holding_ref IS NULL.
  -- Holding-sourced rows are explicitly excluded here (original_holding_ref IS NULL
  -- in the filter) — they are handled by holding_candidates below.
  strategy_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    LEFT JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND (
        -- (a) legacy rows with no linked match_decision
        bo.match_decision_id IS NULL
        -- (b) post-Phase-09 strategy-sourced rows
        OR (md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL)
      )
  ),
  -- strategy_computed: same as migration 060 semantics
  strategy_computed AS (
    SELECT
      c.id,
      public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
      public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
      public.extract_delta(c.series, c.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM strategy_candidates c
    LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  -- strategy_updated: idempotent COALESCE write — same as migration 060
  strategy_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM strategy_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- -----------------------------------------------------------------------
  -- holding_candidates: NEW — holding-sourced rows
  -- -----------------------------------------------------------------------
  -- INNER JOIN (holding-sourced rows always have a non-null match_decision_id
  -- by construction per VOICES-ACCEPTED f3 — the Phase 09 engine path in
  -- Plan 09-02 always writes a match_decision before creating a bridge_outcome).
  -- LATERAL parse_holding_ref extracts (venue, symbol, holding_type).
  -- Rows where parse_holding_ref returns empty (malformed ref) are excluded
  -- by the WHERE hp.symbol IS NOT NULL guard.
  holding_candidates AS (
    SELECT
      bo.id,
      bo.allocator_id,
      bo.allocated_at,
      hp.symbol
    FROM public.bridge_outcomes bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    LEFT JOIN LATERAL public.parse_holding_ref(md.original_holding_ref) hp ON TRUE
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND md.original_strategy_id IS NULL
      AND md.original_holding_ref IS NOT NULL
      AND hp.symbol IS NOT NULL
  ),
  -- holding_computed: per-symbol value ratio from allocator_equity_snapshots.breakdown
  -- (value_at(allocated_at + N) / value_at(allocated_at)) - 1
  -- NULL when either endpoint is absent or zero (extract_symbol_value_at returns NULL for zero).
  holding_computed AS (
    SELECT
      hc.id,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d30,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d90,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d180
    FROM holding_candidates hc
  ),
  -- holding_updated: write delta_30d/90d/180d ONLY
  -- DO NOT write estimated_delta_bps / estimated_days — those apply only to
  -- the strategy branch which has a cumulative returns_series for in-window
  -- partial estimates. Holdings use point-in-time spot values; no partial estimate.
  holding_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d          = COALESCE(hc.d30,  bo.delta_30d),
      delta_90d          = COALESCE(hc.d90,  bo.delta_90d),
      delta_180d         = COALESCE(hc.d180, bo.delta_180d),
      needs_recompute    = FALSE,
      deltas_computed_at = v_started
    FROM holding_computed hc
    WHERE bo.id = hc.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT
    (SELECT COUNT(*)::INT FROM strategy_updated) +
    (SELECT COUNT(*)::INT FROM holding_updated)
  INTO v_updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;

COMMENT ON FUNCTION public.compute_bridge_outcome_deltas IS
  'Daily batch: compute realized 30/90/180-day deltas for bridge_outcomes where '
  'kind=''allocated'' AND (delta_30d IS NULL OR needs_recompute=TRUE). '
  'Phase 09 extension (migration 073): strategy branch uses LEFT JOIN + OR filter '
  '(finding f3) to preserve legacy rows where match_decision_id IS NULL; new holding '
  'branch reads per-symbol USD series from allocator_equity_snapshots.breakdown. '
  'Idempotent — re-run produces no changes once windows populate. '
  'Observability via cron.job_run_details (NOT log_audit_event — pg_cron sessions have NULL auth.uid()).';

-- --------------------------------------------------------------------------
-- STEP 4: GRANT re-apply
-- --------------------------------------------------------------------------
-- CREATE OR REPLACE strips existing GRANTs — must re-apply explicitly.
-- Same policy as migration 060: restrict to service_role, revoke from PUBLIC.
REVOKE ALL ON FUNCTION public.compute_bridge_outcome_deltas FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_bridge_outcome_deltas TO service_role;

-- --------------------------------------------------------------------------
-- STEP 5: Self-verifying DO block (4 assertions)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_main_src   TEXT;
  v_helper_src TEXT;
BEGIN

  -- (a) compute_bridge_outcome_deltas body contains the holding branch marker
  SELECT prosrc INTO v_main_src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'compute_bridge_outcome_deltas';

  IF v_main_src IS NULL THEN
    RAISE EXCEPTION 'Migration 073 assertion (a) failed: compute_bridge_outcome_deltas not found in pg_proc';
  END IF;

  IF v_main_src NOT LIKE '%original_holding_ref IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 073 assertion (a) failed: compute_bridge_outcome_deltas body missing "original_holding_ref IS NOT NULL" — holding branch not deployed';
  END IF;

  -- (b) extract_symbol_value_at helper exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'extract_symbol_value_at'
  ) THEN
    RAISE EXCEPTION 'Migration 073 assertion (b) failed: extract_symbol_value_at not found in pg_proc';
  END IF;

  -- (c) parse_holding_ref helper exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'parse_holding_ref'
  ) THEN
    RAISE EXCEPTION 'Migration 073 assertion (c) failed: parse_holding_ref not found in pg_proc';
  END IF;

  -- (d) compute_bridge_outcome_deltas body contains LEFT JOIN (finding f3 applied)
  IF v_main_src NOT LIKE '%LEFT JOIN%match_decisions%' AND v_main_src NOT LIKE '%match_decisions%LEFT JOIN%' THEN
    -- Check the main src for LEFT JOIN match_decisions pattern
    IF position('LEFT JOIN public.match_decisions' IN v_main_src) = 0 THEN
      RAISE EXCEPTION 'Migration 073 assertion (d) failed: compute_bridge_outcome_deltas body missing LEFT JOIN match_decisions — finding f3 not applied';
    END IF;
  END IF;

  -- All assertions passed — emit greppable NOTICE strings per finding g3
  RAISE NOTICE 'phase09: compute_bridge_outcome_deltas holding branch deployed ✓';
  RAISE NOTICE 'Migration 073: compute_bridge_outcome_deltas holding branch installed (LEFT JOIN legacy-null-safe strategy branch preserved).';

END
$$;

COMMIT;
