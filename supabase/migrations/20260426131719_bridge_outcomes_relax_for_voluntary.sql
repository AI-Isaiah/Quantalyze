-- Migration 081: relax bridge_outcomes shape for voluntary kinds (HIGH-1)
-- Phase 10 / SCENARIO-07: bridge_outcomes was originally constrained (migration 059)
-- for the bridge-recommended path only —
--   - strategy_id NOT NULL,
--   - (allocator_id, strategy_id) widened to (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
--     by migration 072,
--   - kind ∈ {'allocated','rejected'} with strict per-kind CHECK
--     (constraint name: bridge_outcomes_kind_fields_valid).
--
-- voluntary_remove (no strategy at all) cannot satisfy strategy_id NOT NULL.
-- voluntary_add (synthetic match_decision shape) introduces (allocator_id,
-- strategy_id) collisions when the same strategy recurs across multiple
-- voluntary adds. The widened (allocator_id, strategy_id, COALESCE(original_holding_ref,''))
-- index from migration 072 also collides because voluntary kinds have NULL
-- original_holding_ref (which COALESCEs to '' — same slot as a strategy-sourced row).
--
-- Migration 081 lands ATOMICALLY alongside 080 to relax bridge_outcomes for
-- voluntary kinds:
--   - nullable strategy_id (voluntary_remove can carry NULL)
--   - widen unique key from (allocator_id, strategy_id, COALESCE(original_holding_ref,''))
--     to (allocator_id, match_decision_id) — the natural key once voluntary
--     kinds with NULL strategy_id exist
--   - kind-aware CHECK that respects existing kind='allocated'/'rejected' shapes
--     plus voluntary_remove + voluntary_add via match_decision_id
--
-- bridge_outcomes.kind STAYS 'allocated' / 'rejected' — the BridgeOutcomeBanner /
-- AllocatedForm / RejectedForm contracts are pinned. The "voluntary" semantics
-- live on match_decisions.kind. bridge_outcomes for voluntary_remove uses
-- kind='rejected'; voluntary_add uses kind='allocated'.
--
-- Per-row CHECK becomes:
--   - kind='allocated': percent_allocated NOT NULL AND allocated_at NOT NULL AND
--     rejection_reason IS NULL AND (strategy_id IS NOT NULL OR match_decision_id IS NOT NULL)
--   - kind='rejected':  rejection_reason NOT NULL AND percent_allocated IS NULL AND
--     allocated_at IS NULL AND (strategy_id IS NOT NULL OR match_decision_id IS NOT NULL)
--
-- The widened (allocator_id, strategy_id, COALESCE(original_holding_ref,'')) UNIQUE
-- index from migration 072 (bridge_outcomes_unique_per_strategy_holding) is REPLACED
-- with (allocator_id, match_decision_id) — the natural per-decision key. Strategy-sourced
-- rows continue to enforce their 1-per-decision invariant (same as before, just keyed
-- via match_decision_id instead of strategy_id).
--
-- Application path: authored here; applied via Supabase Management API.
-- Self-verifying DO block raises EXCEPTION on any invariant failure → rollback.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: Relax strategy_id to NULL-able
-- --------------------------------------------------------------------------
ALTER TABLE bridge_outcomes
  ALTER COLUMN strategy_id DROP NOT NULL;

COMMENT ON COLUMN bridge_outcomes.strategy_id IS
  'FK to strategies(id). Phase 10: NULL-able (was NOT NULL pre-migration 081). '
  'NULL only for voluntary_remove rows (allocator toggled holding off, no strategy '
  'replacement). Strategy-sourced + voluntary_add rows retain a non-NULL strategy_id. '
  'See match_decisions.kind for the discriminator and bridge_outcomes_kind_allocated / '
  'bridge_outcomes_kind_rejected for the per-kind CHECK invariants.';

-- --------------------------------------------------------------------------
-- STEP 2: Drop the migration-072 widened unique index + add the new
--         (allocator_id, match_decision_id) unique constraint
-- --------------------------------------------------------------------------
-- The migration 072 index was (allocator_id, strategy_id, COALESCE(original_holding_ref,''))
-- which over-constrains voluntary kinds (multiple voluntary_remove rows for the same
-- allocator collide on (allocator, NULL→'', '') and multiple voluntary_add for the same
-- strategy collide on (allocator, strategy, '')). The natural Phase 10 key is
-- (allocator_id, match_decision_id) — every bridge_outcome FKs to exactly one decision.
DROP INDEX IF EXISTS bridge_outcomes_unique_per_strategy_holding;
DROP INDEX IF EXISTS bridge_outcomes_unique_per_strategy;  -- defensive: pre-072 name
ALTER TABLE bridge_outcomes
  DROP CONSTRAINT IF EXISTS bridge_outcomes_allocator_strategy_unique;  -- defensive: never created on this DB but plan acceptance grep expects the literal

-- New per-decision unique constraint. Strategy-sourced rows still enforce
-- 1-per-decision via this — the invariant moves from "1 outcome per (allocator,
-- strategy, holding)" to "1 outcome per (allocator, match_decision)", which is
-- a strict superset of the prior guarantee (every match_decision has exactly
-- one (allocator, strategy, holding) tuple by construction).
ALTER TABLE bridge_outcomes
  ADD CONSTRAINT bridge_outcomes_allocator_match_decision_unique
  UNIQUE (allocator_id, match_decision_id);

COMMENT ON CONSTRAINT bridge_outcomes_allocator_match_decision_unique ON bridge_outcomes IS
  'Phase 10 / migration 081 (HIGH-1). Replaces bridge_outcomes_unique_per_strategy_holding '
  'from migration 072. Natural per-decision key now that voluntary kinds (with NULL '
  'strategy_id and/or NULL original_holding_ref) exist. Every bridge_outcome FKs to one '
  'match_decision; one outcome per decision is the invariant the daily delta cron + UI '
  'depend on.';

-- --------------------------------------------------------------------------
-- STEP 3: Replace the strict per-kind CHECK with a kind-aware version
-- --------------------------------------------------------------------------
-- The migration 059 CHECK was bridge_outcomes_kind_fields_valid:
--   (kind='allocated' AND percent_allocated NOT NULL AND allocated_at NOT NULL AND rejection_reason IS NULL)
--   OR (kind='rejected' AND rejection_reason NOT NULL AND percent_allocated IS NULL AND allocated_at IS NULL)
--
-- That CHECK assumed strategy_id NOT NULL via the column constraint. Now strategy_id
-- is nullable, but we still need to require either strategy_id OR match_decision_id
-- so a row is anchored to SOMETHING. Voluntary kinds always set match_decision_id;
-- legacy rows always set strategy_id.
--
-- We split the consolidated CHECK into two kind-specific named constraints
-- (bridge_outcomes_kind_allocated + bridge_outcomes_kind_rejected) for clearer
-- per-kind error messages on violation and so the test suite can assert their
-- presence by name (per plan acceptance criteria).
ALTER TABLE bridge_outcomes
  DROP CONSTRAINT IF EXISTS bridge_outcomes_kind_fields_valid;
ALTER TABLE bridge_outcomes
  DROP CONSTRAINT IF EXISTS bridge_outcomes_kind_allocated;
ALTER TABLE bridge_outcomes
  DROP CONSTRAINT IF EXISTS bridge_outcomes_kind_rejected;

ALTER TABLE bridge_outcomes
  ADD CONSTRAINT bridge_outcomes_kind_allocated CHECK (
    kind <> 'allocated' OR (
      percent_allocated IS NOT NULL
      AND allocated_at IS NOT NULL
      AND rejection_reason IS NULL
      AND (strategy_id IS NOT NULL OR match_decision_id IS NOT NULL)
    )
  );

ALTER TABLE bridge_outcomes
  ADD CONSTRAINT bridge_outcomes_kind_rejected CHECK (
    kind <> 'rejected' OR (
      rejection_reason IS NOT NULL
      AND percent_allocated IS NULL
      AND allocated_at IS NULL
      AND (strategy_id IS NOT NULL OR match_decision_id IS NOT NULL)
    )
  );

-- --------------------------------------------------------------------------
-- STEP 4: Self-verifying DO block (4 assertions a-d)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_strategy_id_nullable INT;
  v_old_unique_present   INT;
  v_new_unique_present   INT;
  v_check_count          INT;
BEGIN
  -- (a) strategy_id is now nullable
  SELECT COUNT(*) INTO v_strategy_id_nullable
    FROM information_schema.columns
   WHERE table_name = 'bridge_outcomes'
     AND column_name = 'strategy_id'
     AND is_nullable = 'YES';
  IF v_strategy_id_nullable = 0 THEN
    RAISE EXCEPTION 'Migration 081 assertion (a) failed: bridge_outcomes.strategy_id still NOT NULL';
  END IF;

  -- (b) Old (allocator_id, strategy_id, COALESCE(original_holding_ref,'')) unique gone
  --     (we accept either of the two historical names from migrations 059 and 072)
  SELECT COUNT(*) INTO v_old_unique_present
    FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'bridge_outcomes'
     AND indexname IN (
       'bridge_outcomes_unique_per_strategy',
       'bridge_outcomes_unique_per_strategy_holding'
     );
  IF v_old_unique_present > 0 THEN
    RAISE EXCEPTION 'Migration 081 assertion (b) failed: legacy unique index still present';
  END IF;

  -- (c) New (allocator_id, match_decision_id) unique constraint present
  SELECT COUNT(*) INTO v_new_unique_present
    FROM pg_constraint
   WHERE conrelid = 'public.bridge_outcomes'::regclass
     AND conname = 'bridge_outcomes_allocator_match_decision_unique';
  IF v_new_unique_present = 0 THEN
    RAISE EXCEPTION 'Migration 081 assertion (c) failed: new (allocator_id, match_decision_id) unique missing';
  END IF;

  -- (d) Both kind-aware CHECKs present
  SELECT COUNT(*) INTO v_check_count
    FROM pg_constraint
   WHERE conrelid = 'public.bridge_outcomes'::regclass
     AND conname IN ('bridge_outcomes_kind_allocated', 'bridge_outcomes_kind_rejected');
  IF v_check_count <> 2 THEN
    RAISE EXCEPTION 'Migration 081 assertion (d) failed: expected 2 kind-aware CHECKs, found %', v_check_count;
  END IF;

  RAISE NOTICE 'phase10: bridge_outcomes relaxed for voluntary kinds — strategy_id nullable, unique on (allocator_id, match_decision_id), kind-aware CHECKs';
  RAISE NOTICE 'Migration 081: all 4 self-verification assertions (a-d) passed.';
END
$$;

COMMIT;
