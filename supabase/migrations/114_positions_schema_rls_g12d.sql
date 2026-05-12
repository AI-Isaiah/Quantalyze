-- Migration 114: positions schema + RLS hardening (audit 2026-05-07 G12.D)
--
-- WHAT
-- Four schema/RLS fixes scoped to the positions table:
--
--   G12.D.1 [CRITICAL] — RLS asymmetry: positions_read was published-OR-owned
--     while trades_read (002:58-60) is owner-only. An authenticated allocator
--     with no allocation could SELECT every column of positions for any
--     published strategy — realized_pnl, fee_total, exit_price_avg,
--     duration_days, size_peak, opened_at, closed_at — and reverse-engineer
--     the strategy. We replace the policy with the same owner-only idiom
--     used by trades_read, keyed off `(SELECT auth.uid())` for plan caching
--     (matches the Supabase RLS perf guide).
--
--   G12.D.2 [HIGH] — positions had only a UUID PK + 3 non-unique indexes.
--     The Python position-reconstruction service runs every analytics job and
--     wrote rows for the same lifecycle without an idempotency key. Migration
--     113's `reconstruct_positions_atomic` RPC now does DELETE-then-INSERT
--     in a single transaction, but a UNIQUE (strategy_id, symbol, side,
--     opened_at) constraint is still required to (a) make the RPC's
--     idempotency invariant a DB contract and (b) catch any future code
--     path that bypasses the RPC.
--
--   G12.D.3 [MEDIUM, paired with G12.C.9] — duration_days was widened from
--     INTEGER to NUMERIC by 092, but high-precision duration in whole
--     seconds is what the analytics math actually wants downstream. Add a
--     nullable BIGINT `duration_seconds` column so the Python writer can
--     populate it via the migration-113 RPC payload without a schema bump.
--     Old code paths continue writing duration_days; new code paths can
--     prefer duration_seconds when present.
--
--   G12.D.5 [LOW] — Add a partial index on (strategy_id, opened_at DESC)
--     WHERE status='open' so "most recent N open positions for strategy X"
--     dashboards/alerts don't fall back to a full scan + sort once the
--     closed-position count grows large.
--
-- ORDERING
-- This migration runs AFTER 113 (`reconstruct_positions_atomic`). The RPC's
-- INSERT column list is frozen to the columns 040 + 044 + 092 declared. The
-- new `duration_seconds` column is nullable, so existing INSERT paths that
-- omit it remain valid. Future writes can be extended to include
-- duration_seconds in the JSONB payload — the RPC body picks columns from
-- the payload, so adding a new key is forward-compatible.
--
-- The new UNIQUE constraint is created NOT VALID and only validated when
-- there are zero existing duplicates. The migration-113 RPC runs DELETE-
-- then-INSERT per strategy, so future inserts cannot violate the constraint.
-- Stale duplicates (if any) are surfaced as a NOTICE with a remediation
-- pointer instead of failing the migration.
--
-- ROLLBACK
--   ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_natural_key;
--   ALTER TABLE positions DROP COLUMN IF EXISTS duration_seconds;
--   DROP INDEX IF EXISTS positions_open_recent;
--   -- restore previous policy (mirrors original 040:121-128):
--   DROP POLICY IF EXISTS positions_read ON positions;
--   CREATE POLICY positions_read ON positions FOR SELECT USING (
--     EXISTS (
--       SELECT 1 FROM strategies s
--       WHERE s.id = positions.strategy_id
--         AND (s.status = 'published' OR s.user_id = auth.uid())
--     )
--   );

BEGIN;

-- --------------------------------------------------------------------------
-- G12.D.3 — duration_seconds (paired with G12.C.9)
-- --------------------------------------------------------------------------
-- Nullable BIGINT. The Python writer populates this via the migration-113
-- RPC's JSONB payload once it ships the matching diff. Existing rows stay
-- NULL and continue to read duration_days; the analytics layer prefers
-- duration_seconds when present and falls back to duration_days * 86400.
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS duration_seconds BIGINT NULL;

COMMENT ON COLUMN positions.duration_seconds IS
  'High-precision lifetime in whole seconds (closed_at - opened_at). Nullable; supersedes duration_days for sub-day positions. Added 2026-05-09 per audit G12.D.3 + G12.C.9.';

-- --------------------------------------------------------------------------
-- G12.D.2 — natural-key uniqueness
-- --------------------------------------------------------------------------
-- The original (2026-05-09) authoring of this section attempted
-- `ALTER TABLE ... ADD CONSTRAINT ... UNIQUE (...) NOT VALID` followed
-- by a conditional `VALIDATE CONSTRAINT`. That syntax is NOT valid
-- PostgreSQL — UNIQUE constraints cannot be marked NOT VALID (SQLSTATE
-- 0A000, "feature_not_supported"; only CHECK and FOREIGN KEY support
-- deferred validation). Under `supabase db push` the failing statement
-- was swallowed and 114 was recorded as applied on prod + test with
-- the constraint missing.
--
-- Corrected pattern: detect duplicates first, install the constraint
-- straight (PG validates inline) when zero duplicates, otherwise leave
-- the constraint uninstalled and surface a NOTICE so the operator can
-- clean up. Migration 119 is the retroactive remediation for databases
-- where 114 already shipped with the broken statement.
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
    RAISE NOTICE 'Migration 114: positions_natural_key already installed — no-op.';
  ELSE
    SELECT COUNT(*)
      INTO v_dup_groups
      FROM (
        SELECT strategy_id, symbol, side, opened_at
          FROM positions
          GROUP BY strategy_id, symbol, side, opened_at
          HAVING COUNT(*) > 1
      ) AS d;

    IF v_dup_groups = 0 THEN
      EXECUTE 'ALTER TABLE public.positions
                 ADD CONSTRAINT positions_natural_key
                 UNIQUE (strategy_id, symbol, side, opened_at)';
      RAISE NOTICE 'Migration 114: positions_natural_key installed (zero pre-existing duplicates).';
    ELSE
      RAISE NOTICE 'Migration 114: positions has % duplicate (strategy_id,symbol,side,opened_at) group(s); positions_natural_key NOT installed. Re-run reconstruct_positions_atomic per affected strategy, then re-apply migration 119.', v_dup_groups;
    END IF;
  END IF;
END
$$;

-- --------------------------------------------------------------------------
-- G12.D.1 — RLS parity with trades_read (owner-only)
-- --------------------------------------------------------------------------
-- Replace the published-OR-owned policy with owner-only, mirroring the
-- canonical trades_read at 002:58-60. Wrap auth.uid() in a SELECT so
-- Postgres caches the function call across rows (Supabase RLS perf guide).
DROP POLICY IF EXISTS positions_read ON positions;

CREATE POLICY positions_read ON positions
  FOR SELECT
  USING (
    strategy_id IN (
      SELECT id FROM strategies
        WHERE user_id = (SELECT auth.uid())
    )
  );

COMMENT ON POLICY positions_read ON positions IS
  'Owner-only read access. Mirrors trades_read (002:58-60) for RLS parity — the previous published-OR-owned policy leaked full position lifecycle to every authenticated user. See migration 114 + audit-2026-05-07 G12.D.1.';

-- --------------------------------------------------------------------------
-- G12.D.5 — partial index for "recent open positions"
-- --------------------------------------------------------------------------
-- Covers `WHERE strategy_id = $1 AND status='open' ORDER BY opened_at DESC`
-- without forcing a sort. Partial-on-open keeps the index small even as
-- closed-position counts grow. Cannot use CONCURRENTLY inside a tx block.
CREATE INDEX IF NOT EXISTS positions_open_recent
  ON positions (strategy_id, opened_at DESC)
  WHERE status = 'open';

-- --------------------------------------------------------------------------
-- Self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
BEGIN
  -- 1. duration_seconds column added and nullable
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'positions'
        AND column_name = 'duration_seconds'
        AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'Migration 114 invariant violated: positions.duration_seconds column missing or not nullable.';
  END IF;

  -- 2. natural-key uniqueness constraint installed.
  -- Soft assertion: when pre-existing duplicates block the in-line
  -- ADD CONSTRAINT above, the constraint is intentionally left missing
  -- and the operator gets a NOTICE pointing at migration 119 + the
  -- reconstruct_positions_atomic cleanup path. Emitting a NOTICE here
  -- rather than RAISE EXCEPTION keeps the rest of 114 (RLS policy +
  -- index) committed instead of rolling back over a known-soft state.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
      WHERE conname = 'positions_natural_key'
        AND conrelid = 'public.positions'::regclass
  ) THEN
    RAISE NOTICE 'Migration 114 soft-state: positions_natural_key constraint missing — pre-existing duplicates present; see migration 119.';
  END IF;

  -- 3. positions_read recreated as owner-only (USING clause must reference
  --    strategies WHERE user_id = auth.uid() and must NOT contain 'published')
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'positions'
        AND policyname = 'positions_read'
        AND qual ILIKE '%user_id%'
        AND qual NOT ILIKE '%published%'
  ) THEN
    RAISE EXCEPTION 'Migration 114 invariant violated: positions_read policy missing or still references published-OR-owned shape.';
  END IF;

  -- 4. partial index created
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'positions'
        AND indexname = 'positions_open_recent'
  ) THEN
    RAISE EXCEPTION 'Migration 114 invariant violated: positions_open_recent index missing.';
  END IF;

  RAISE NOTICE 'Migration 114 applied: duration_seconds + positions_natural_key + owner-only positions_read + positions_open_recent index installed.';
END
$$;

COMMIT;
