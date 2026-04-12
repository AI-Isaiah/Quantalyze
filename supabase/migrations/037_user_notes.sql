-- Migration 037: user_notes table
-- Sprint 3 Task 3.4: Functional Notes widget (widget #38)
--
-- Why this migration exists
-- -------------------------
-- Widget #38 NotesWidget currently uses an in-memory textarea — data is
-- lost on page refresh. Sprint 3 makes it functional with a per-user
-- per-portfolio notes table + /api/notes PATCH endpoint + 1s debounced save.
--
-- Scope decision (CEO review D.5 RESOLVED): plain text, per-portfolio
-- (nullable portfolio_id allows a user-global fallback), no markdown, no
-- rich text, no tags, no attachments. If allocators ask for more later,
-- add it in a follow-up sprint. The textarea IS the widget.
--
-- Schema is intentionally minimal:
-- * user_id = auth.uid() gate via RLS
-- * Nullable portfolio_id so a user can have a global note (portfolio_id NULL)
--   plus one note per portfolio they own
-- * content TEXT with CHECK constraint capping at 100KB to prevent abuse
-- * updated_at + created_at timestamps
--
-- Partial unique index on (user_id, portfolio_id) ensures each user has
-- at most one note per portfolio plus one global. The ON CONFLICT path
-- in /api/notes PATCH uses this index for idempotent upserts.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: user_notes table
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_notes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  portfolio_id UUID REFERENCES portfolios ON DELETE CASCADE,
  content      TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 100000),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE user_notes IS
  'Per-user per-portfolio plain text notes pinned to the Notes widget. Nullable portfolio_id allows a global fallback note. 100KB content cap. See migration 037.';

COMMENT ON COLUMN user_notes.content IS
  'Plain text. No markdown rendering, no rich text. CHECK constraint caps at 100KB to prevent abuse.';

COMMENT ON COLUMN user_notes.portfolio_id IS
  'Nullable. NULL means a user-global note. Non-null means a per-portfolio note. Partial unique index enforces one note per (user, portfolio) and one per (user, global).';

-- --------------------------------------------------------------------------
-- STEP 2: partial unique indexes
-- --------------------------------------------------------------------------
-- One note per (user_id, portfolio_id) when portfolio_id is set.
-- Partial unique because NULL values don't coalesce under UNIQUE in Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS user_notes_unique_per_portfolio
  ON user_notes (user_id, portfolio_id)
  WHERE portfolio_id IS NOT NULL;

-- One global note per user (portfolio_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS user_notes_unique_global
  ON user_notes (user_id)
  WHERE portfolio_id IS NULL;

-- --------------------------------------------------------------------------
-- STEP 3: touch-updated_at trigger
-- --------------------------------------------------------------------------
-- Mirrors the pattern from 032's compute_jobs_set_updated_at trigger. The
-- /api/notes PATCH path relies on updated_at for the save-state indicator
-- ("Saved 3s ago") so the trigger enforces freshness even if the caller
-- forgets to set it.
CREATE OR REPLACE FUNCTION user_notes_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_notes_set_updated_at_trigger ON user_notes;
CREATE TRIGGER user_notes_set_updated_at_trigger
  BEFORE UPDATE ON user_notes
  FOR EACH ROW
  EXECUTE FUNCTION user_notes_set_updated_at();

-- --------------------------------------------------------------------------
-- STEP 4: RLS
-- --------------------------------------------------------------------------
-- Strict user-scoped: auth.uid() must match the row's user_id for every
-- operation. No published-OR-owned exception — notes are private, never
-- shared. Service-role bypasses these policies by default.
ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_notes_select_own ON user_notes;
CREATE POLICY user_notes_select_own ON user_notes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_insert_own ON user_notes;
CREATE POLICY user_notes_insert_own ON user_notes FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_update_own ON user_notes;
CREATE POLICY user_notes_update_own ON user_notes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS user_notes_delete_own ON user_notes;
CREATE POLICY user_notes_delete_own ON user_notes FOR DELETE
  USING (user_id = auth.uid());

-- --------------------------------------------------------------------------
-- STEP 5: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_rls_enabled BOOLEAN;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_notes'
  ) THEN
    RAISE EXCEPTION 'Migration 037 failed: user_notes table missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'user_notes_unique_per_portfolio') THEN
    RAISE EXCEPTION 'Migration 037 failed: user_notes_unique_per_portfolio index missing';
  END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE relname = 'user_notes_unique_global') THEN
    RAISE EXCEPTION 'Migration 037 failed: user_notes_unique_global index missing';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'user_notes'
      AND t.tgname = 'user_notes_set_updated_at_trigger'
      AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'Migration 037 failed: user_notes_set_updated_at_trigger missing';
  END IF;

  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'user_notes'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT v_rls_enabled THEN
    RAISE EXCEPTION 'Migration 037 failed: RLS not enabled on user_notes';
  END IF;

  IF NOT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_notes'
      AND policyname = 'user_notes_select_own'
  ) THEN
    RAISE EXCEPTION 'Migration 037 failed: user_notes_select_own policy missing';
  END IF;

  RAISE NOTICE 'Migration 037: user_notes table + 2 unique indexes + trigger + 4 RLS policies installed and verified.';
END
$$;

COMMIT;
