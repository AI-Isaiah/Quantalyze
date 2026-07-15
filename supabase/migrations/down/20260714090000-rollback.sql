-- ============================================================================
-- ROLLBACK for 20260714090000_portfolio_recompute_inflight_unique.sql
-- Phase 98 / Plan 98-01 — PI-07 in-flight UNIQUE fence reversal.
-- ============================================================================
-- Reverses the index swap: drop the partial UNIQUE fence and recreate the
-- prior non-unique lookup index idx_portfolio_analytics_computing with its
-- original (portfolio_id, computed_at DESC) WHERE computation_status =
-- 'computing' definition (mig 20260516170400). A plain build is acceptable in
-- a rollback (manual, off the auto-apply path).
--
-- NOTE: the up migration's dedupe flipped superseded duplicate `computing`
-- rows to `failed`. Those rows are intentionally NOT restored — the flip is
-- irreversible data hygiene identical to what the reaper
-- (reset_stalled_portfolio_analytics) would have done to a stale in-flight
-- row, and a stranded duplicate `computing` row carries no recoverable state.
-- ============================================================================

DROP INDEX IF EXISTS public.portfolio_analytics_one_computing_per_portfolio;

CREATE INDEX IF NOT EXISTS idx_portfolio_analytics_computing
  ON public.portfolio_analytics (portfolio_id, computed_at DESC)
  WHERE computation_status = 'computing';
