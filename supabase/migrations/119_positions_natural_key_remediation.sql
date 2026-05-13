-- Migration 119: positions_natural_key remediation
--
-- Why this migration exists
-- -------------------------
-- Migration 114 (audit-2026-05-07 G12.D) attempted to install a UNIQUE
-- (strategy_id, symbol, side, opened_at) constraint on positions using
-- the pattern:
--
--     ALTER TABLE positions
--       ADD CONSTRAINT positions_natural_key
--       UNIQUE (strategy_id, symbol, side, opened_at)
--       NOT VALID;
--     -- ... duplicate-count gate ...
--     ALTER TABLE positions VALIDATE CONSTRAINT positions_natural_key;
--
-- That syntax is invalid PostgreSQL: UNIQUE constraints CANNOT be marked
-- NOT VALID (SQLSTATE 0A000 — "feature_not_supported"; only CHECK and
-- FOREIGN KEY support deferred validation). The 114 migration body
-- therefore raised on the ADD CONSTRAINT statement and never installed
-- the constraint — yet supabase_migrations.schema_migrations recorded
-- 114 as applied (the rest of 114's intent — duration_seconds column,
-- positions_open_recent index, owner-only positions_read policy — DID
-- land, suggesting the failing statement was swallowed or split out by
-- the migration runner's transactional behavior).
--
-- Result observed 2026-05-12 across both projects:
--   * test (qmnijlgmdhviwzwfyzlc): positions_natural_key MISSING; 0
--     existing duplicates → can install cleanly.
--   * production (khslejtfbuezsmvmtsdn): positions_natural_key MISSING;
--     8 duplicate (strategy_id, symbol, side, opened_at) groups exist
--     → cannot install without operator-driven cleanup.
--
-- Currently only the reconstruct_positions_atomic RPC (mig 113) prevents
-- duplicates via DELETE-then-INSERT-per-strategy. Any caller bypassing
-- that RPC has no DB-level safety net.
--
-- This migration
-- --------------
-- 1. If positions_natural_key already exists: no-op (idempotent).
-- 2. Else, count duplicate groups.
--    a. Zero duplicates → ADD CONSTRAINT positions_natural_key UNIQUE
--       (strategy_id, symbol, side, opened_at). PostgreSQL builds the
--       backing unique index in one step, validating existing rows
--       inline (which is fine because we just verified zero dups).
--    b. Non-zero duplicates → RAISE NOTICE listing the duplicate count
--       and an operator runbook (re-run reconstruct_positions_atomic
--       per affected strategy_id, then re-apply this migration). The
--       migration is recorded as applied so the train can advance, but
--       the constraint remains MISSING and the self-verification at the
--       end converts to a softer NOTICE rather than EXCEPTION so prod
--       isn't blocked. A separate operator workflow then drives cleanup
--       + a follow-up migration.
--
-- Idempotent: re-running this on a database where the constraint is
-- already installed is a no-op (the IF EXISTS branch returns first).
-- Re-running on a duplicate-laden database also no-ops without raising.
--
-- See: migration 114 (the broken attempt), migration 113
-- (reconstruct_positions_atomic — the only writer that respects the
-- natural key), audit-2026-05-07 G12.D.2.

BEGIN;

DO $$
DECLARE
  v_constraint_exists BOOLEAN;
  v_dup_groups        INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
      WHERE conname = 'positions_natural_key'
        AND conrelid = 'public.positions'::regclass
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE 'Migration 119: positions_natural_key already installed — no-op.';
    RETURN;
  END IF;

  SELECT COUNT(*)
    INTO v_dup_groups
    FROM (
      SELECT strategy_id, symbol, side, opened_at
        FROM positions
        GROUP BY strategy_id, symbol, side, opened_at
        HAVING COUNT(*) > 1
    ) AS d;

  IF v_dup_groups = 0 THEN
    -- Safe to install in one step. UNIQUE in PG always validates inline;
    -- because we just confirmed zero duplicates, this won't raise.
    EXECUTE 'ALTER TABLE public.positions
               ADD CONSTRAINT positions_natural_key
               UNIQUE (strategy_id, symbol, side, opened_at)';
    RAISE NOTICE 'Migration 119: positions_natural_key installed (zero pre-existing duplicates).';
  ELSE
    RAISE NOTICE 'Migration 119: positions has % duplicate (strategy_id,symbol,side,opened_at) group(s); positions_natural_key NOT installed. Operator action required: re-run reconstruct_positions_atomic(strategy_id) for each affected strategy, then re-apply this migration to close the gap.', v_dup_groups;
  END IF;
END
$$;

-- Install the comment only if the constraint actually exists. On the
-- duplicate-laden path, the constraint isn't installed yet — the
-- COMMENT ON CONSTRAINT would raise 'constraint does not exist' and
-- block the migration. Run inside its own DO so the conditional is
-- explicit and the migration always commits cleanly.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
      WHERE conname = 'positions_natural_key'
        AND conrelid = 'public.positions'::regclass
  ) THEN
    EXECUTE
      $cmt$COMMENT ON CONSTRAINT positions_natural_key ON public.positions IS
        'UNIQUE(strategy_id, symbol, side, opened_at). Installed by migration 119 '
        'after migration 114 attempted UNIQUE NOT VALID syntax (unsupported in PG, '
        'SQLSTATE 0A000) and silently failed to install the constraint on both '
        'production and test. See migration 119, migration 114, audit-2026-05-07 G12.D.2.'$cmt$;
  END IF;
END
$$;

COMMIT;
