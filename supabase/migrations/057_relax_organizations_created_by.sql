-- Migration 057: relax organizations.created_by NOT NULL + test-only
-- hot→cold RPC + audit_log_cold created_at index.
--
-- Sprint 6 closeout Task 7.3 code-review follow-ups (C1, I6, I7).
--
-- Why this migration exists
-- -------------------------
-- Three independent fixes are bundled here because each touches a prior
-- migration's artifact and a single atomic migration is cheaper than
-- three:
--
-- 1. (C1) `sanitize_user` (migration 055 STEP 3g) issues
--    `UPDATE organizations SET created_by = NULL WHERE created_by = p_user_id`
--    but migration 006 declared `organizations.created_by UUID NOT NULL`.
--    The UPDATE raises `not_null_violation` at the first sanitize against
--    a user who ever created an org, and the deletion request is stuck
--    in "pending" forever.
--
--    Fix: DROP NOT NULL on organizations.created_by. GDPR anonymize-
--    not-delete requires the org row to survive — the other members may
--    still rely on it. Keeping the attribution column but allowing NULL
--    is the minimal change.
--
-- 2. (I6) The live-DB cold-archive test (`audit-log-cold-archive.test.ts`)
--    proves the INSERT half of the hot→cold move but cannot exercise the
--    DELETE half — migration 049's deny policies + REVOKE block PostgREST
--    DELETE on audit_log. To prove the whole move end-to-end without
--    waiting two real years, ship a service_role-gated RPC that runs the
--    same CTE body the cron runs.
--
--    Contract: `test_force_hot_to_cold_move()` is SECURITY DEFINER,
--    returns the number of rows moved, and is marked volatile. It is
--    documented TEST-ONLY — production callers must go through the cron
--    job. A comment block + EXECUTE gate on service_role only keeps the
--    footprint small.
--
-- 3. (I7) The cold-archive purge cron (migration 056 JOB 2) runs
--    `DELETE FROM audit_log_cold WHERE created_at < now() - interval '7
--    years'` nightly. Without an index on `created_at`, the delete
--    sequentially scans the full cold table once per night. At the 5-year
--    fill horizon (≥500k rows) this is 500ms–2s of wasted IO. An index
--    drops the plan to an index range scan.
--
--    Fix: CREATE INDEX idx_audit_log_cold_created_at. Migration 056's
--    DO block already asserts the other two cold-table indexes — this
--    migration extends the assert set.
--
-- Also included: a minor matrix accuracy correction documented in the
-- migration-055 matrix (no code change). Tracked here for the
-- code-review audit trail (C2 cleanup, see migration 055 diff).
--
-- Numbering
-- ---------
-- 055 = sanitize_user + gdpr-exports bucket.
-- 056 = retention crons + audit_log_cold.
-- 057 = this file. Next free slot.
--
-- Caller impact
-- -------------
-- `ALTER TABLE ... DROP NOT NULL` on organizations is fast (metadata-
-- only; no row rewrite). The CREATE INDEX uses IF NOT EXISTS + runs
-- against an empty or small cold table, sub-second. The RPC creation
-- is schema-only. Migration is safely re-applyable.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: (C1) Relax organizations.created_by NOT NULL
-- --------------------------------------------------------------------------
-- sanitize_user sets created_by = NULL to sever authorship attribution
-- while preserving the org row for other members. The NOT NULL in 006
-- would raise on the UPDATE; drop it so the anonymize path works.
-- Existing rows are unaffected; the column retains its FK to profiles(id)
-- so the cross-table invariant is preserved.
ALTER TABLE organizations
  ALTER COLUMN created_by DROP NOT NULL;

COMMENT ON COLUMN organizations.created_by IS
  'Profile id of the user who created this organization. Nullable since migration 057 — sanitize_user sets this to NULL during GDPR Art. 17 anonymize while preserving the organization row for remaining members.';

-- --------------------------------------------------------------------------
-- STEP 2: (I7) Add created_at index on audit_log_cold
-- --------------------------------------------------------------------------
-- The audit_log_cold_purge cron (migration 056 JOB 2) filters by
-- `created_at < now() - interval '7 years'`. Without this index, the
-- nightly purge is a sequential scan. Index IS a candidate for the BRIN
-- flavor (time-series, strictly append-only), but BTREE is safer here:
-- the hot→cold move can re-insert rows out of temporal order if the
-- cron is paused and resumed (backfill scenarios), and BRIN degrades
-- under that shape. BTREE costs a small index page per row (~8 bytes),
-- acceptable at projected volumes (~700k rows over 5 years).
CREATE INDEX IF NOT EXISTS idx_audit_log_cold_created_at
  ON audit_log_cold (created_at);

-- --------------------------------------------------------------------------
-- STEP 3: (I6) Test-only RPC: test_force_hot_to_cold_move
-- --------------------------------------------------------------------------
-- Wraps the same CTE body the cron job executes. Returns the number of
-- rows moved this call. service_role-only EXECUTE so no PostgREST path
-- from authenticated users can invoke it.
--
-- IMPORTANT: This RPC is TEST-ONLY. Production code paths MUST go
-- through the pg_cron job (audit_log_hot_to_cold in migration 056).
-- The RPC exists purely so live-DB integration tests can exercise the
-- DELETE half of the move without waiting two real years for rows to
-- age past the threshold.
--
-- Because migration 056's JOB 1 was rewritten to a single-statement
-- CTE (see I5 in this sprint's code-review fixes), the RPC body mirrors
-- the CTE exactly — a single DELETE ... RETURNING feeding an INSERT —
-- so "what the test exercises" and "what the cron executes" are the
-- same SQL.
CREATE OR REPLACE FUNCTION public.test_force_hot_to_cold_move()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_moved INT := 0;
BEGIN
  -- Mirror migration 056 JOB 1's body exactly. The CTE delete/insert
  -- pairing is atomic: a row captured by RETURNING is the set that
  -- gets inserted into cold — no gap window where a concurrent backdated
  -- insert could sneak in and be deleted unarchived.
  WITH archived AS (
    DELETE FROM audit_log
    WHERE created_at < now() - interval '2 years'
    RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
  )
  INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
  SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
  FROM archived
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;

COMMENT ON FUNCTION public.test_force_hot_to_cold_move() IS
  'TEST-ONLY. Executes the same CTE body as the audit_log_hot_to_cold cron (migration 056 JOB 1). service_role EXECUTE only. Do NOT call from production code — use the pg_cron schedule. Added in migration 057 for live-DB integration coverage of the DELETE half of the move.';

REVOKE ALL ON FUNCTION public.test_force_hot_to_cold_move() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.test_force_hot_to_cold_move() TO service_role;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  col_is_nullable TEXT;
  has_cold_created_at_idx BOOLEAN;
  has_test_fn BOOLEAN;
  authed_can_exec_test_fn BOOLEAN;
  svc_can_exec_test_fn BOOLEAN;
BEGIN
  -- 1. organizations.created_by is nullable
  SELECT is_nullable INTO col_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'organizations'
    AND column_name = 'created_by';
  IF col_is_nullable IS NULL THEN
    RAISE EXCEPTION 'Migration 057 failed: organizations.created_by column not found';
  END IF;
  IF col_is_nullable <> 'YES' THEN
    RAISE EXCEPTION 'Migration 057 failed: organizations.created_by is still NOT NULL (is_nullable=%)', col_is_nullable;
  END IF;

  -- 2. idx_audit_log_cold_created_at index present
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'audit_log_cold'
      AND indexname = 'idx_audit_log_cold_created_at'
  ) INTO has_cold_created_at_idx;
  IF NOT has_cold_created_at_idx THEN
    RAISE EXCEPTION 'Migration 057 failed: idx_audit_log_cold_created_at missing';
  END IF;

  -- 3. test_force_hot_to_cold_move function exists and is SECURITY DEFINER
  SELECT EXISTS(
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = 'test_force_hot_to_cold_move'
      AND p.prosecdef = TRUE
  ) INTO has_test_fn;
  IF NOT has_test_fn THEN
    RAISE EXCEPTION 'Migration 057 failed: test_force_hot_to_cold_move SECURITY DEFINER function missing';
  END IF;

  -- 4. EXECUTE on the test RPC is granted only to service_role
  SELECT has_function_privilege('authenticated', 'public.test_force_hot_to_cold_move()', 'EXECUTE')
    INTO authed_can_exec_test_fn;
  SELECT has_function_privilege('service_role', 'public.test_force_hot_to_cold_move()', 'EXECUTE')
    INTO svc_can_exec_test_fn;
  IF authed_can_exec_test_fn THEN
    RAISE EXCEPTION 'Migration 057 failed: test_force_hot_to_cold_move still EXECUTEable by authenticated';
  END IF;
  IF NOT svc_can_exec_test_fn THEN
    RAISE EXCEPTION 'Migration 057 failed: test_force_hot_to_cold_move EXECUTE not granted to service_role';
  END IF;

  RAISE NOTICE 'Migration 057: organizations.created_by nullable + audit_log_cold created_at idx + test_force_hot_to_cold_move RPC installed.';
END
$$;

COMMIT;
