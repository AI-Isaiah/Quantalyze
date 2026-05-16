-- Adds data_quality JSONB to portfolio_analytics so partial-data
-- computations surface in the row instead of being silently degraded.
--
-- Project memory: v0.17.1 KPI-17 saga (PRs #95-#100) — analytics columns
-- silently dropping to zero/null because upstream data drifted. Operators
-- need a queryable signal that distinguishes:
--   "computed from N of M strategies" (renormalized to subset)
--   "insufficient history → identity-cov fallback skipped"
--   "benchmark fetch failed"
--   "sharpe is None because vol==0 vs nan-mean vs <2 days history"
--
-- The column is nullable to keep existing rows valid; new computations
-- write the full struct via routers/portfolio.py:_compute_portfolio_analytics.
--
-- Shape (documented; not enforced by JSONB):
--   {
--     "partial_data": bool,
--     "expected_strategy_count": int,
--     "computed_strategy_count": int,
--     "missing_analytics_sids": [uuid, ...],
--     "missing_returns_sids":   [uuid, ...],
--     "missing_equity_sids":    [uuid, ...],
--     "dropped_weight_total":   float,
--     "vol_status":             "ok"|"insufficient_history"|"zero_volatility"|"nan",
--     "sharpe_status":          same enumeration plus "nan_mean",
--     "cov_history_sufficient": bool,
--     "benchmark_error":        text | null,
--     "matching_status":        null  // populated only on verify_strategy path
--   }

ALTER TABLE portfolio_analytics
  ADD COLUMN IF NOT EXISTS data_quality JSONB;

COMMENT ON COLUMN portfolio_analytics.data_quality IS
  'Partial-data telemetry: missing strategies, sharpe/vol status codes, '
  'benchmark/cov fallbacks. Populated by routers/portfolio.py. See '
  'audit-2026-05-07 portfolio.py fix-implementation.';
