-- ============================================================================
-- ROLLBACK for 20260621120000_scenarios_table_and_rls.sql
-- Phase 23 / Plan 23-01 — scenarios persistence spine reversal.
-- ============================================================================
-- DROP TABLE ... CASCADE drops the table together with its RLS policy
-- (scenarios_owner) and its index (scenarios_allocator_updated_idx). No trigger
-- function was created by the forward migration, so there is nothing further to
-- drop. CASCADE also removes any FK references later phases may have added to
-- scenarios — intended for a full teardown.
-- ============================================================================

DROP TABLE scenarios CASCADE;
