-- ============================================================================
-- ROLLBACK for 20260620120000_verification_requests_view_shim_apply.sql
-- Phase 19 / BACKBONE-04 step (d) reversal — Stage D recovery.
-- ============================================================================
-- Mirrors the transactional recovery in .planning/phase-19/rollback-runbook.md
-- (Stage D), PLUS restores sanitize_user's GDPR delete to the un-shimmed table.
--
-- Order matters: drop the VIEW + its triggers FIRST, rename the base table
-- back, and ONLY THEN repoint sanitize_user — otherwise sanitize_user would
-- briefly target a table name that does not exist as a base table.
--
-- Idempotency: guarded so a partial/re-run does not error. Safe to run only
-- when verification_requests is currently a VIEW (i.e. the forward migration
-- is applied). If it is already a BASE TABLE this is a no-op with a NOTICE.
--
-- NOTE (grants): the forward migration REVOKEd SELECT from anon/authenticated
-- on the legacy table. This rollback does NOT re-GRANT them — the
-- /api/verify-strategy/[id]/status route reads via the admin client (RLS
-- bypass) and never depended on anon/authenticated direct SELECT, so the
-- pre-shim feature behaviour is preserved. Re-grant manually only if a
-- direct anon/authenticated read path is reintroduced.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

DO $$
DECLARE
  v_is_view BOOLEAN;
  v_legacy_exists BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM information_schema.views
    WHERE table_schema='public' AND table_name='verification_requests') INTO v_is_view;
  SELECT EXISTS(SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='verification_requests_legacy' AND table_type='BASE TABLE')
    INTO v_legacy_exists;

  IF NOT v_is_view THEN
    RAISE NOTICE 'rollback: verification_requests is not a VIEW; forward migration not applied — nothing to undo.';
    RETURN;
  END IF;
  IF NOT v_legacy_exists THEN
    RAISE EXCEPTION 'rollback: verification_requests is a VIEW but verification_requests_legacy is missing — inconsistent state, manual intervention required.';
  END IF;

  -- 1. Drop INSTEAD OF triggers on the view.
  DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
  DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
  DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;

  -- 2. Drop the VIEW.
  DROP VIEW IF EXISTS verification_requests;

  -- 3. Drop the two ADDED policies on the legacy table (the original
  --    pre-shim policies travelled with the rename and are restored in step 4).
  DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests_legacy;
  DROP POLICY IF EXISTS verification_requests_legacy_public_token_select ON verification_requests_legacy;

  -- 4. Rename the base table back.
  EXECUTE 'ALTER TABLE verification_requests_legacy RENAME TO verification_requests';

  -- 5. Drop the now-orphaned INSTEAD OF trigger function.
  DROP FUNCTION IF EXISTS verification_requests_view_readonly_trigger();

  RAISE NOTICE 'rollback: VIEW + triggers dropped, legacy table renamed back to verification_requests.';
END $$;

-- 6. Repoint sanitize_user's GDPR delete back to verification_requests
--    (in-place, mirrors STEP 5.5 of the forward migration in reverse).
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'sanitize_user';

  IF v_def IS NULL THEN
    RAISE NOTICE 'rollback: sanitize_user not found; skipping repoint.';
    RETURN;
  END IF;

  IF position('DELETE FROM verification_requests_legacy WHERE email' IN v_def) > 0 THEN
    v_def := replace(
      v_def,
      'DELETE FROM verification_requests_legacy WHERE email',
      'DELETE FROM verification_requests WHERE email'
    );
    EXECUTE v_def;
    RAISE NOTICE 'rollback: sanitize_user repointed back to verification_requests.';
  ELSE
    RAISE NOTICE 'rollback: sanitize_user does not target verification_requests_legacy; leaving as-is.';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- END ROLLBACK
-- ============================================================================
