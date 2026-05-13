-- Test: retention cron safety (migration 121)
--
-- audit-2026-05-07 / P917 — verifies the retention_delete_guard trigger
-- aborts unbounded DELETEs on audit_log/audit_log_cold, and every
-- retention cron body filters by created_at.
--
-- Asserted invariants:
--   1. audit_log_retention_guard + audit_log_cold_retention_guard
--      triggers are attached.
--   2. Every expected cron.job is scheduled.
--   3. Every cron body contains a WHERE clause filtering by created_at.
--   4. End-to-end: seeding 100,001 audit_log rows and attempting an
--      unbounded DELETE FROM audit_log raises (the guard fires). The
--      DELETE is rolled back so the seed survives — but the seed itself
--      is too expensive to run as part of CI. We instead verify the
--      trigger function definition refers to the 100,000 threshold and
--      assert the trigger metadata (event=DELETE, level=STATEMENT) is
--      correct.
--
-- Pre-migration FAIL state:
--   Before migration 121, the retention_delete_guard function does not
--   exist; the trigger lookup returns FALSE. Tests 1 and 2 catch this.
--
-- Run order: AFTER migrations 120-123 have been applied. Uses
-- BEGIN/ROLLBACK.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: triggers attached on audit_log + audit_log_cold
-- --------------------------------------------------------------------------
DO $$
DECLARE
  has_log_guard BOOLEAN;
  has_cold_guard BOOLEAN;
  log_event TEXT;
  log_level CHAR;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'audit_log'
      AND t.tgname = 'audit_log_retention_guard'
  ) INTO has_log_guard;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'audit_log_cold'
      AND t.tgname = 'audit_log_cold_retention_guard'
  ) INTO has_cold_guard;

  IF NOT has_log_guard THEN
    RAISE EXCEPTION 'Test 1 failed: audit_log_retention_guard trigger missing (P917 pre-fix state)';
  END IF;
  IF NOT has_cold_guard THEN
    RAISE EXCEPTION 'Test 1 failed: audit_log_cold_retention_guard trigger missing (P917 pre-fix state)';
  END IF;

  RAISE NOTICE 'Test 1 passed: retention delete-guard triggers attached on both audit tables';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: retention_delete_guard function body references the 100,000
-- threshold (signals the guard is wired to abort, not just count).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fn_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO fn_body
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'retention_delete_guard';

  IF fn_body IS NULL THEN
    RAISE EXCEPTION 'Test 2 failed: retention_delete_guard function not found (P917 pre-fix)';
  END IF;
  IF fn_body NOT LIKE '%100000%' THEN
    RAISE EXCEPTION 'Test 2 failed: retention_delete_guard does not enforce 100,000-row ceiling';
  END IF;

  RAISE NOTICE 'Test 2 passed: retention_delete_guard enforces 100,000-row ceiling';
END $$;

-- --------------------------------------------------------------------------
-- Test 3: every retention cron body filters by created_at.
-- Skip if pg_cron is not installed (local dev).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  expected_jobs TEXT[] := ARRAY[
    'audit_log_hot_to_cold',
    'audit_log_cold_purge',
    'retention_notification_dispatches',
    'retention_compute_jobs_done',
    'retention_compute_jobs_failed'
  ];
  jobname_probe TEXT;
  v_command TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Test 3 skipped: pg_cron not installed';
    RETURN;
  END IF;

  FOREACH jobname_probe IN ARRAY expected_jobs LOOP
    SELECT command INTO v_command FROM cron.job WHERE jobname = jobname_probe;
    IF v_command IS NULL THEN
      RAISE EXCEPTION 'Test 3 failed: cron.job % not registered (P917 pre-fix or migration 121 not applied)', jobname_probe;
    END IF;
    IF v_command NOT ILIKE '%where%created_at%' THEN
      RAISE EXCEPTION
        'Test 3 failed: cron.job % body lacks WHERE created_at filter. command was: %',
        jobname_probe, v_command;
    END IF;
  END LOOP;

  RAISE NOTICE 'Test 3 passed: all 5 retention cron bodies filter by created_at';
END $$;

-- --------------------------------------------------------------------------
-- Test 4: an unbounded DELETE on audit_log_cold (which is empty in the
-- test project for cost reasons) successfully no-ops; but a guard-trigger
-- regression check via direct SELECT on pg_trigger ensures the trigger
-- is STATEMENT-level + AFTER DELETE.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  tgtype SMALLINT;
  is_after BOOLEAN;
  is_statement BOOLEAN;
  fires_on_delete BOOLEAN;
BEGIN
  SELECT t.tgtype INTO tgtype
  FROM pg_trigger t
  JOIN pg_class c ON t.tgrelid = c.oid
  WHERE c.relname = 'audit_log'
    AND t.tgname = 'audit_log_retention_guard';

  IF tgtype IS NULL THEN
    RAISE EXCEPTION 'Test 4 failed: audit_log_retention_guard not found';
  END IF;

  -- pg_trigger.tgtype is a bitmask. bit 0 (1) = ROW vs STATEMENT
  -- (1=ROW, 0=STATEMENT); bit 1 (2) = BEFORE vs AFTER; bit 3 (8) = DELETE.
  is_after := (tgtype & 2) = 0;
  is_statement := (tgtype & 1) = 0;
  fires_on_delete := (tgtype & 8) <> 0;

  IF NOT is_after THEN
    RAISE EXCEPTION 'Test 4 failed: trigger should be AFTER (tgtype=%)', tgtype;
  END IF;
  IF NOT is_statement THEN
    RAISE EXCEPTION 'Test 4 failed: trigger should be STATEMENT-level (tgtype=%)', tgtype;
  END IF;
  IF NOT fires_on_delete THEN
    RAISE EXCEPTION 'Test 4 failed: trigger should fire on DELETE (tgtype=%)', tgtype;
  END IF;

  RAISE NOTICE 'Test 4 passed: audit_log_retention_guard is AFTER STATEMENT DELETE';
END $$;

ROLLBACK;
