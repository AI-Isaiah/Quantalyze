-- Migration 123: data_deletion_requests.user_id FK — drop CASCADE, switch to
-- ON DELETE SET NULL referencing auth.users(id).
--
-- audit-2026-05-07 / P455 (CRITICAL / S9a.14) — CASCADE ghost on the audit trail.
--
-- Problem
-- -------
-- Migration 012 declared:
--
--   user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
--
-- The `profiles` table itself is `REFERENCES auth.users ON DELETE CASCADE`
-- (migration 001), so the deletion chain is:
--
--     auth.users  →  profiles  →  data_deletion_requests
--           ON DELETE CASCADE      ON DELETE CASCADE
--
-- When a user is deleted (via Supabase auth admin delete, or sanitize_user
-- finalizing the deletion request), the DSR row CASCADEs and disappears —
-- orphaning the audit trail for the very deletion request that finalized
-- the deletion. This violates GDPR Art. 17's documentation requirement
-- (the manager-side review trail MUST survive the deletion event) and
-- audit-2026-05-07 finding P455 graded it CRITICAL.
--
-- Decision: SET NULL over RESTRICT
-- ---------------------------------
-- Three options were considered:
--   1. ON DELETE CASCADE   — current (broken). DSR row vanishes.
--   2. ON DELETE RESTRICT  — blocks user delete. Would break sanitize_user
--                            and Supabase auth admin delete (operators
--                            cannot remove the user without first deleting
--                            the DSR — backwards for a GDPR pipeline).
--   3. ON DELETE SET NULL  — chosen. The DSR row SURVIVES the user delete;
--                            the user_id becomes NULL but every other
--                            column (requested_at, completed_at, rejected_at,
--                            rejection_reason, notes) persists. Manager-side
--                            review trail intact, GDPR documentation intact.
--
-- SET NULL also matches the precedent established in 055_sanitize_user.sql
-- L99: `data_deletion_requests | PRESERVE | The intake rows ARE the audit trail
-- for the deletion`. That migration noted the preserve intent in a comment but
-- did NOT actually re-wire the FK — this migration completes the loop.
--
-- Reference change: profiles(id) → auth.users(id)
-- ------------------------------------------------
-- The FK is re-pointed at `auth.users(id)` directly (not `profiles(id)`)
-- because:
--   * `profiles` itself CASCADEs from `auth.users`, so a chain reference
--     would still need an intermediate row to survive the cascade — that's
--     architecturally wrong.
--   * The DSR `user_id` is conceptually a record of the auth subject who
--     requested deletion. The auth.users id is the canonical handle.
--   * `auth.users(id)` is the standard Supabase pattern for tombstone-style
--     audit references (see audit_log.user_id, migration 058).
--
-- Schema change
-- -------------
-- NOT NULL must be dropped on user_id because SET NULL implies the column
-- can hold NULL after a referenced row is deleted. Existing rows are
-- unaffected — they retain their user_id until the corresponding auth user
-- is deleted, at which point the row's user_id flips to NULL while every
-- other field persists.

BEGIN;

-- Drop the existing CASCADE FK. The constraint name follows the PostgreSQL
-- default naming convention (table_column_fkey) — migration 012 didn't name
-- it explicitly, so PostgreSQL generated `data_deletion_requests_user_id_fkey`.
ALTER TABLE data_deletion_requests
  DROP CONSTRAINT IF EXISTS data_deletion_requests_user_id_fkey;

-- Drop NOT NULL so SET NULL can fire when an auth.users row is deleted.
-- The DSR row's user_id becomes NULL but the row itself survives.
ALTER TABLE data_deletion_requests
  ALTER COLUMN user_id DROP NOT NULL;

-- Re-create the FK pointing at auth.users(id) with ON DELETE SET NULL.
ALTER TABLE data_deletion_requests
  ADD CONSTRAINT data_deletion_requests_user_id_fkey
  FOREIGN KEY (user_id)
  REFERENCES auth.users(id)
  ON DELETE SET NULL;

COMMENT ON CONSTRAINT data_deletion_requests_user_id_fkey
  ON data_deletion_requests IS
  'audit-2026-05-07 P455 — ON DELETE SET NULL (not CASCADE). The DSR row '
  'is the audit trail for the deletion event and MUST survive deletion of '
  'the auth user it references. Migration 123.';

COMMENT ON COLUMN data_deletion_requests.user_id IS
  'Nullable after migration 123 (audit-2026-05-07 P455). Becomes NULL when '
  'the referenced auth.users row is deleted (via sanitize_user or auth '
  'admin delete). The rest of the DSR row persists for manager-side audit.';

-- Preflight verification: the FK must now be SET NULL.
DO $$
DECLARE
  fk_action CHAR(1);
BEGIN
  SELECT confdeltype INTO fk_action
  FROM pg_constraint
  WHERE conname = 'data_deletion_requests_user_id_fkey'
    AND conrelid = 'public.data_deletion_requests'::regclass;

  IF fk_action IS NULL THEN
    RAISE EXCEPTION
      'Migration 123 failed: data_deletion_requests_user_id_fkey not found';
  END IF;

  IF fk_action <> 'n' THEN
    -- pg_constraint.confdeltype: 'n' = SET NULL, 'c' = CASCADE,
    -- 'r' = RESTRICT, 'a' = NO ACTION, 'd' = SET DEFAULT.
    RAISE EXCEPTION
      'Migration 123 failed: expected SET NULL (n), got %', fk_action;
  END IF;
END $$;

COMMIT;

-- Down migration (manual rollback only — DO NOT run in production):
--
--   BEGIN;
--   ALTER TABLE data_deletion_requests
--     DROP CONSTRAINT IF EXISTS data_deletion_requests_user_id_fkey;
--   -- Re-introducing NOT NULL requires backfilling any NULLs first.
--   UPDATE data_deletion_requests SET user_id = '00000000-0000-0000-0000-000000000000'
--     WHERE user_id IS NULL;  -- WARN: data loss equivalence.
--   ALTER TABLE data_deletion_requests
--     ALTER COLUMN user_id SET NOT NULL;
--   ALTER TABLE data_deletion_requests
--     ADD CONSTRAINT data_deletion_requests_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
--   COMMIT;
