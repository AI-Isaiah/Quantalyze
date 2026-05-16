-- audit-2026-05-07 mitigation
-- Closes: M-0795 (type-design-analyzer c9)
-- Source file: supabase/migrations/20260417110538_sanitize_user.sql (was 055)
-- Issue: data_deletion_requests state machine encoded as three nullable
--   timestamps with NO CHECK that completed_at and rejected_at are mutually
--   exclusive. Application-layer convention only.
-- Mitigation: add `data_deletion_requests_state_exclusive` CHECK that
--   forbids both completed_at and rejected_at being non-NULL at the same
--   time. Forward-only; idempotent via DO block.
--
-- Pre-flight: pre-existing violator count via SELECT — emits NOTICE if
-- any rows would violate the new CHECK (operator can backfill). The
-- constraint is added with NOT VALID so apply does NOT take a table-
-- wide validation lock; existing rows continue to satisfy at write time
-- via the CHECK on new rows only. A separate VALIDATE step is omitted
-- intentionally — once operator has cleaned violators they can run
-- `ALTER TABLE ... VALIDATE CONSTRAINT data_deletion_requests_state_exclusive`
-- as a single-statement runbook step.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: pre-flight count of existing violators
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_violators INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_violators
    FROM data_deletion_requests
   WHERE completed_at IS NOT NULL
     AND rejected_at IS NOT NULL;

  IF v_violators > 0 THEN
    RAISE NOTICE
      'audit-2026-05-07 M-0795: % data_deletion_requests row(s) have BOTH completed_at AND rejected_at set. The new state-exclusive CHECK is added NOT VALID so apply does not abort — backfill these rows and run ALTER TABLE data_deletion_requests VALIDATE CONSTRAINT data_deletion_requests_state_exclusive to enforce on the full table.',
      v_violators;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: add the NOT-VALID state-exclusivity CHECK
-- --------------------------------------------------------------------------
-- NOT VALID skips the full-table scan that a validating CHECK would
-- otherwise require; the constraint applies to new INSERTs and UPDATEs
-- immediately. The DO block makes the ADD idempotent (re-apply is a no-op).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'public'
       AND r.relname = 'data_deletion_requests'
       AND c.conname = 'data_deletion_requests_state_exclusive'
  ) THEN
    ALTER TABLE public.data_deletion_requests
      ADD CONSTRAINT data_deletion_requests_state_exclusive
      CHECK (NOT (completed_at IS NOT NULL AND rejected_at IS NOT NULL))
      NOT VALID;
  END IF;
END $$;

COMMENT ON CONSTRAINT data_deletion_requests_state_exclusive
  ON public.data_deletion_requests IS
  'audit-2026-05-07 M-0795. State-machine invariant: a deletion request is '
  'either pending (both NULL), completed (completed_at NOT NULL, rejected_at '
  'NULL), or rejected (rejected_at NOT NULL, completed_at NULL) — never both '
  'terminal states. NOT VALID at install; operator validates after backfill.';

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_present BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint c
      JOIN pg_class r ON r.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = r.relnamespace
     WHERE n.nspname = 'public'
       AND r.relname = 'data_deletion_requests'
       AND c.conname = 'data_deletion_requests_state_exclusive'
  ) INTO v_present;
  IF NOT v_present THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0795 verification failed: data_deletion_requests_state_exclusive CHECK missing';
  END IF;
END $$;

COMMIT;
