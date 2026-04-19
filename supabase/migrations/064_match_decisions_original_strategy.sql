-- Migration 064: match_decisions.original_strategy_id
-- Sprint 8 Phase 5 (Outcomes Dashboard) — D-20a schema shape lock (REVISED).
--
-- Voice-C3 (2026-04-19): ships as NULL-allowed; follow-up migration 065
-- tightens to NOT NULL after admin UI has been confirmed shipping values.
-- This removes the empty-table precondition from prior passes and is
-- safe for branch DBs that may acquire rows before migration runs.
--
-- Voice-D3 (2026-04-19): FK uses ON DELETE RESTRICT. Precedent — migration
-- 059 A6 comment (line 111) shows bridge_outcomes.match_decision_id uses
-- ON DELETE SET NULL to preserve outcome history. Here we choose RESTRICT
-- because deleting a still-referenced underperformer strategy should be
-- BLOCKED (not silently erased or cascaded). CASCADE would destroy
-- decision attribution; SET NULL would break the D-20a invariant.
--
-- Adds the underperformer-naming column that every "sent_as_intro" decision
-- must carry, captured at intro-send time via send_intro_with_decision RPC.
-- The invariant (D-20a, revised): "every match_decisions row from intro-send
-- names the underperformer it replaced" — enforced via migration 065's
-- NOT NULL tightening in Wave 3 (after admin UI ships values).
--
-- Placement rationale: the underperformer identity is KNOWN at intro-send
-- time (admin side — SendIntroPanel / send-intro route). It is NOT known
-- at outcome-record time (allocator side). Placing the column on
-- bridge_outcomes would force the allocator UI to discover the
-- underperformer at record time, which it cannot. Correct placement is
-- on match_decisions, captured by send_intro_with_decision().
--
-- Consumers:
--   - POST /api/admin/match/send-intro -- accepts original_strategy_id in body
--   - getMyAllocationDashboard -- reads via bridge_outcomes.match_decision_id
--     -> match_decisions -> strategies (id, name) nested embed
--   - Phase 4 feedback_engine (future hook) -- may attribute "how did X
--     perform as a replacement for Y across all allocators"; index on
--     (allocator_id, original_strategy_id) supports this query path.

BEGIN;

------------------------------------------------------------------
-- 1. Add original_strategy_id column (NULL-allowed per Voice-C3,
--    FK uses ON DELETE RESTRICT per Voice-D3 citing migration 059 A6 precedent)
------------------------------------------------------------------
-- ON DELETE RESTRICT per migration 059 A6 precedent (match_decision_id FK
-- on bridge_outcomes uses SET NULL to preserve outcome history; here
-- RESTRICT because deleting a still-referenced underperformer should be
-- blocked, not silently erased — Voice-D3 2026-04-19).
ALTER TABLE match_decisions
  ADD COLUMN original_strategy_id UUID
    REFERENCES strategies(id) ON DELETE RESTRICT;

COMMENT ON COLUMN match_decisions.original_strategy_id IS
  'FK to strategies(id) naming the underperformer that this decision''s strategy_id (replacement) was introduced for. Ships as NULL-allowed in migration 064 (Voice-C3); tightened to NOT NULL in migration 065 after admin UI has shipped values. FK uses ON DELETE RESTRICT (Voice-D3, migration 059 A6 precedent). Captured at intro-send time via send_intro_with_decision RPC. See .planning/phases/05-outcomes-dashboard/05-CONTEXT.md D-20a (revised).';

------------------------------------------------------------------
-- 2. Index for Phase 4 feedback-engine attribution path
------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS match_decisions_allocator_original_strategy
  ON match_decisions (allocator_id, original_strategy_id);

------------------------------------------------------------------
-- 3. CREATE OR REPLACE send_intro_with_decision RPC
--    with the new p_original_strategy_id parameter (position 3).
--
--    Signature change is BREAKING: old callers will hit
--    "too few arguments" — this is the DESIRED fail-loud behavior
--    so the admin route + this RPC agree atomically.
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION send_intro_with_decision(
  p_allocator_id UUID,
  p_strategy_id UUID,
  p_original_strategy_id UUID,   -- NEW: position 3 for call-site clarity
  p_candidate_id UUID,
  p_admin_note TEXT,
  p_decided_by UUID
) RETURNS TABLE (
  contact_request_id UUID,
  match_decision_id UUID,
  was_already_sent BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_cr_id UUID;
  v_new_cr_id UUID;
  v_decision_id UUID;
  v_was_already_sent BOOLEAN := false;
BEGIN
  -- Check if contact_requests already has a row for this pair.
  -- (Idempotent match: allocator_id + strategy_id + "sent_as_intro".)
  SELECT id INTO v_existing_cr_id
  FROM contact_requests
  WHERE allocator_id = p_allocator_id AND strategy_id = p_strategy_id;

  IF v_existing_cr_id IS NOT NULL THEN
    v_was_already_sent := true;
    v_new_cr_id := v_existing_cr_id;
  ELSE
    INSERT INTO contact_requests (allocator_id, strategy_id, status, message)
    VALUES (p_allocator_id, p_strategy_id, 'pending', p_admin_note)
    RETURNING id INTO v_new_cr_id;
  END IF;

  -- Insert decision (idempotent via uniq_match_dec_sent_per_pair).
  -- NEW: persist p_original_strategy_id into the new column (NULL-allowed
  -- at this migration level; migration 065 tightens to NOT NULL).
  INSERT INTO match_decisions (
    allocator_id, strategy_id, original_strategy_id, candidate_id, decision,
    founder_note, contact_request_id, decided_by
  ) VALUES (
    p_allocator_id, p_strategy_id, p_original_strategy_id, p_candidate_id, 'sent_as_intro',
    p_admin_note, v_new_cr_id, p_decided_by
  )
  ON CONFLICT (allocator_id, strategy_id) WHERE decision = 'sent_as_intro' DO NOTHING
  RETURNING id INTO v_decision_id;

  -- If we hit ON CONFLICT, fetch the existing decision id.
  IF v_decision_id IS NULL THEN
    SELECT id INTO v_decision_id
    FROM match_decisions
    WHERE allocator_id = p_allocator_id
      AND strategy_id = p_strategy_id
      AND decision = 'sent_as_intro';
  END IF;

  RETURN QUERY SELECT v_new_cr_id, v_decision_id, v_was_already_sent;
END;
$$;

-- Re-apply REVOKE + GRANT to the replaced function (Postgres does not
-- preserve these across CREATE OR REPLACE for changed signatures).
REVOKE ALL ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_intro_with_decision(UUID, UUID, UUID, UUID, TEXT, UUID) TO authenticated;

-- Drop the old 5-arg overload so callers using stale signatures fail loud.
-- The old function was (UUID, UUID, UUID, TEXT, UUID) = (alloc, strat,
-- candidate, note, decided_by). CREATE OR REPLACE with a different
-- argument list creates a NEW overload rather than replacing — we must
-- drop the old explicitly.
DROP FUNCTION IF EXISTS send_intro_with_decision(UUID, UUID, UUID, TEXT, UUID);

------------------------------------------------------------------
-- 4. Self-verifying DO block
------------------------------------------------------------------
DO $$
BEGIN
  -- Column exists + UUID (is_nullable='YES' at this migration level per Voice-C3)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'match_decisions'
       AND column_name = 'original_strategy_id'
       AND data_type = 'uuid'
  ) THEN
    RAISE EXCEPTION 'Migration 064 failed: match_decisions.original_strategy_id missing or not UUID';
  END IF;

  -- FK constraint exists and uses ON DELETE RESTRICT (Voice-D3)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = rc.constraint_name
     WHERE kcu.table_name = 'match_decisions'
       AND kcu.column_name = 'original_strategy_id'
       AND rc.delete_rule = 'RESTRICT'
  ) THEN
    RAISE EXCEPTION 'Migration 064 failed: FK on match_decisions.original_strategy_id must use ON DELETE RESTRICT (Voice-D3)';
  END IF;

  -- Index exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = 'match_decisions'
       AND indexname = 'match_decisions_allocator_original_strategy'
  ) THEN
    RAISE EXCEPTION 'Migration 064 failed: match_decisions_allocator_original_strategy index missing';
  END IF;

  -- New 6-arg RPC exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'send_intro_with_decision'
       AND p.pronargs = 6
  ) THEN
    RAISE EXCEPTION 'Migration 064 failed: send_intro_with_decision 6-arg overload missing';
  END IF;

  -- Old 5-arg RPC was dropped
  IF EXISTS (
    SELECT 1 FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'send_intro_with_decision'
       AND p.pronargs = 5
  ) THEN
    RAISE EXCEPTION 'Migration 064 failed: old 5-arg send_intro_with_decision still exists (fail-loud guarantee violated)';
  END IF;

  RAISE NOTICE 'Migration 064: match_decisions.original_strategy_id (NULL, RESTRICT) + updated RPC installed and verified.';
END
$$;

COMMIT;
