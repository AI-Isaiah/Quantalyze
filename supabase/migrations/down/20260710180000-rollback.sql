-- ============================================================================
-- ROLLBACK for 20260710180000_wizard_composite.sql
-- Phase 88 / Plan 88-02 — composite-assembly RPCs reversal (ONB-03).
-- ============================================================================
-- Pure-additive up migration (two new SECURITY DEFINER functions + their
-- grants, nothing else). The reversal is a drop of exactly those two functions
-- with their exact signatures. NO table / column / index / trigger drops —
-- create_wizard_strategy, strategy_keys, strategies_user_wizard_session_uniq
-- and every pre-existing object were never touched by the up migration.
-- ============================================================================

DROP FUNCTION IF EXISTS public.add_wizard_composite_key(
  uuid, text, text, text, text, text, text, text, integer, text, uuid
);

DROP FUNCTION IF EXISTS public.set_wizard_composite_members(uuid, uuid, jsonb);
