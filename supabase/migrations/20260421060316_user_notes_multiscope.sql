-- Migration 071: user_notes multi-scope reshape
-- Phase 08 — Connection Management and Notes (Plan 01)
--
-- Why this migration exists
-- -------------------------
-- Sprint 3 (migration 037) shipped user_notes as a portfolio-only note
-- capability. Phase 08 extends notes to four scopes — portfolio, holding,
-- bridge_outcome, strategy — per D-07/D-08. Rather than carry two
-- coordinate systems, the table is reshaped to `(user_id, scope_kind,
-- scope_ref)` and the legacy `portfolio_id` column is dropped. `/api/notes`
-- is the sole consumer and is rewritten in the same commit per D-23.
--
-- Backfill
-- --------
-- Production has ZERO user_notes rows (verified 2026-04-20 via live REST
-- count — Research Finding #4). Preview/dev DBs may carry test rows, so
-- the backfill step is defensive: migrate existing `portfolio_id IS NOT
-- NULL` rows to scope_kind='portfolio', scope_ref=portfolio_id::text, then
-- DELETE any legacy "global" rows (portfolio_id IS NULL) — no
-- scope_ref='global' sentinel is introduced (Finding #4).
--
-- RLS
-- ---
-- Migration 037's four owner-only policies (SELECT/INSERT/UPDATE/DELETE
-- with `user_id = auth.uid()`) survive this reshape untouched — the
-- predicate still references the same column. Policies are re-DROP/CREATE'd
-- defensively to match the migration-037 convention; behaviour is identical.
-- No admin tier is added (D-14 institutional privacy).
--
-- Self-verify
-- -----------
-- The DO block at the bottom asserts: new columns present + NOT NULL,
-- legacy `portfolio_id` column absent, composite UNIQUE index present,
-- no NULL-scope rows remain after backfill, RLS still ENABLED, select
-- policy still in place.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: add new columns (NULLABLE initially so backfill can run)
-- --------------------------------------------------------------------------
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS scope_kind TEXT;
ALTER TABLE user_notes ADD COLUMN IF NOT EXISTS scope_ref  TEXT;

-- --------------------------------------------------------------------------
-- STEP 2: backfill existing rows (0 rows in production per Finding #4;
--         defensive for preview/dev DBs which may carry test rows).
-- --------------------------------------------------------------------------
UPDATE user_notes
SET scope_kind = 'portfolio',
    scope_ref  = portfolio_id::text
WHERE portfolio_id IS NOT NULL AND scope_kind IS NULL;

-- Drop any legacy "global" rows (portfolio_id IS NULL). Zero in prod,
-- but preview DBs may have them. No scope_ref='global' sentinel (Finding #4).
DELETE FROM user_notes WHERE portfolio_id IS NULL;

-- --------------------------------------------------------------------------
-- STEP 3: lock down new columns
-- --------------------------------------------------------------------------
ALTER TABLE user_notes ALTER COLUMN scope_kind SET NOT NULL;
ALTER TABLE user_notes ALTER COLUMN scope_ref  SET NOT NULL;

ALTER TABLE user_notes
  DROP CONSTRAINT IF EXISTS user_notes_scope_kind_check;
ALTER TABLE user_notes
  ADD CONSTRAINT user_notes_scope_kind_check
  CHECK (scope_kind IN ('portfolio','holding','bridge_outcome','strategy'));

COMMENT ON COLUMN user_notes.scope_kind IS
  'Scope discriminator: one of portfolio, holding, bridge_outcome, strategy. See ADR-0023 §4 user_note.*.update rows.';
COMMENT ON COLUMN user_notes.scope_ref IS
  'Stringified scope target: portfolio=UUID, holding={venue}:{symbol}:{holding_type}, bridge_outcome=UUID, strategy=UUID. Validated by parseHoldingScopeRef() for the holding scope; other scopes are UUID text. See src/lib/notes/scope-ref.ts + src/lib/notes/ownership.ts.';

-- --------------------------------------------------------------------------
-- STEP 4: drop old partial unique indexes (legacy names from migration 037)
-- --------------------------------------------------------------------------
DROP INDEX IF EXISTS user_notes_unique_per_portfolio;
DROP INDEX IF EXISTS user_notes_unique_global;

-- --------------------------------------------------------------------------
-- STEP 5: new composite UNIQUE index (anchor for ON CONFLICT upsert)
-- --------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS user_notes_unique_multiscope
  ON user_notes (user_id, scope_kind, scope_ref);

-- --------------------------------------------------------------------------
-- STEP 6: drop legacy portfolio_id column (no back-compat — /api/notes is
--         the sole consumer and is rewritten in this same commit per D-23).
-- --------------------------------------------------------------------------
ALTER TABLE user_notes DROP COLUMN IF EXISTS portfolio_id;

-- Trigger user_notes_set_updated_at_trigger + content CHECK constraint
-- (char_length <= 100000) survive the reshape untouched (migration 037
-- installed them, still correct).

-- Re-DROP/CREATE the four RLS policies defensively to match migration 037's
-- convention. Predicate unchanged — `user_id = auth.uid()` is still the
-- owner gate across all four ops.
ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notes_select_own ON user_notes;
CREATE POLICY user_notes_select_own ON user_notes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_insert_own ON user_notes;
CREATE POLICY user_notes_insert_own ON user_notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_update_own ON user_notes;
CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_delete_own ON user_notes;
CREATE POLICY user_notes_delete_own ON user_notes FOR DELETE
  USING (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- STEP 7: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_notes' AND column_name='scope_kind'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: scope_kind column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_notes' AND column_name='scope_ref'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: scope_ref column missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='user_notes' AND column_name='portfolio_id'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: portfolio_id column not dropped';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname='user_notes_unique_multiscope'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: user_notes_unique_multiscope index missing';
  END IF;

  IF EXISTS (
    SELECT 1 FROM user_notes WHERE scope_kind IS NULL OR scope_ref IS NULL
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: backfill left NULL scope_kind/scope_ref rows';
  END IF;

  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname='user_notes'
      AND relnamespace=(SELECT oid FROM pg_namespace WHERE nspname='public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 071 failed: RLS not enabled on user_notes';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='user_notes' AND policyname='user_notes_select_own'
  ) THEN
    RAISE EXCEPTION 'Migration 071 failed: user_notes_select_own policy missing';
  END IF;

  RAISE NOTICE 'Migration 071: user_notes multi-scope reshape verified.';
END
$$;

COMMIT;
