-- ============================================================================
-- ROLLBACK for 20260710120000_strategy_keys.sql
-- Phase 85 / Plan 85-01 — strategy_keys composite-membership spine reversal.
-- ============================================================================
-- DROP TABLE ... CASCADE drops the table together with its RLS policy
-- (strategy_keys_owner), its indexes, and the owner-coherence trigger object in
-- one shot. The trigger FUNCTION is a separate object — dropped explicitly. The
-- COMP-04 stub column is dropped last (dropping the column also drops its
-- strategy_analytics_metrics_by_basis_shape CHECK).
-- ============================================================================

DROP TABLE IF EXISTS public.strategy_keys CASCADE;

DROP FUNCTION IF EXISTS public.enforce_strategy_keys_owner_coherence();

ALTER TABLE public.strategy_analytics DROP COLUMN IF EXISTS metrics_json_by_basis;
