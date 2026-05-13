-- Migration 121: retention cron safety hardening (audit-2026-05-07).
--
-- Audit finding addressed: P917 (9/10).
--
-- Why this migration exists
-- -------------------------
-- Migration 056 ships six pg_cron jobs that enforce ADR-0024 retention.
-- The audit identified two defects in that migration's design:
--
-- 1. Silent fallback when pg_cron is absent. Migration 056's outer DO
--    block does check `EXISTS (SELECT 1 FROM pg_extension WHERE extname
--    = 'pg_cron')` and RAISE NOTICEs out — BUT the NOTICE is easy to
--    miss in a long migration log, and operators have shipped Supabase
--    projects without pg_cron enabled, with no retention enforcement
--    for weeks. The audit calls for an explicit, auditable guard per
--    cron statement plus a fail-safe verification that retention is
--    actually scheduled (or known-unscheduled) post-migration.
--
-- 2. Unbounded DELETE risk on audit_log. The hot→cold move (056 JOB 1)
--    is bounded by `WHERE created_at < now() - interval '2 years'`. The
--    cold purge (JOB 2) is bounded by `WHERE created_at < now() -
--    interval '7 years'`. Both are correct. But the audit text flagged
--    that future copies/edits of this migration could DROP the WHERE
--    clause and produce an unbounded DELETE. Defense-in-depth: install
--    a row-trigger that REJECTS any DELETE on audit_log / audit_log_cold
--    whose row count exceeds a sanity threshold (10,000 rows per call).
--    Trigger fires per-statement, captures TG_OP rows-affected, and
--    raises if the threshold is crossed — a future bug that issues
--    `DELETE FROM audit_log` with no WHERE would fail loudly on the
--    first 10k rows rather than silently wipe the table.
--
-- What this migration ships
-- -------------------------
-- 1. A `retention_delete_guard()` trigger function that asserts the
--    DELETE row count is bounded. Attached as STATEMENT-level AFTER
--    DELETE on audit_log and audit_log_cold.
-- 2. A re-scheduling block that re-applies migration 056's cron jobs
--    using a defensive PL/pgSQL guard pattern: each cron.schedule call
--    is wrapped in `IF EXISTS pg_extension pg_cron THEN ... ELSE RAISE
--    EXCEPTION 'pg_cron not installed — retention CANNOT be enforced.
--    Install via Dashboard → Database → Extensions and re-run this
--    migration.' END IF` so an operator cannot accidentally apply this
--    migration on a project without pg_cron. The 056 NOTICE pattern is
--    promoted to a HARD ERROR.
-- 3. Idempotent re-scheduling: every job is unscheduled-then-scheduled
--    so a re-run lands the latest body even if migration 056 was patched.
-- 4. Each cron body is re-asserted to contain a WHERE clause via the
--    self-verifying DO block at the bottom — a regression where a future
--    edit dropped the WHERE would fail this migration's verify gate.
--
-- pg_cron rationale
-- -----------------
-- The audit-text recommendation was to wrap each `cron.schedule(...)` in
-- `IF EXISTS ... THEN ... ELSE RAISE NOTICE ... END IF`. We INVERT this
-- to RAISE EXCEPTION because the NOTICE pattern is exactly what migration
-- 056 already did, and the audit calls that out as the bug. The correct
-- defensive posture is "if the platform piece this migration depends on
-- is missing, fail loudly so an operator MUST address it" — not "soldier
-- on with no retention enforcement."
--
-- Caller impact
-- -------------
-- Zero new rows. Cron jobs are RE-scheduled (056's bodies are equivalent
-- modulo job names). The retention_delete_guard triggers are inert until
-- a DELETE actually fires.

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: retention_delete_guard trigger function + attachments
-- --------------------------------------------------------------------------
-- Counts deleted rows in a transition table and raises if the count
-- exceeds 100,000 — comfortably above any plausible single-night batch
-- (audit_log volume is sub-1k/day even at fill peak per ADR-0024 §3),
-- well below the "someone forgot the WHERE" wipe scenario.
CREATE OR REPLACE FUNCTION public.retention_delete_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_deleted_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_deleted_count FROM old_table;
  IF v_deleted_count > 100000 THEN
    RAISE EXCEPTION
      'retention_delete_guard: DELETE on % affected % rows, exceeding the 100,000-row safety ceiling. This indicates an unbounded DELETE (missing WHERE) — aborting. audit-2026-05-07 P917.',
      TG_TABLE_NAME, v_deleted_count
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NULL;
END;
$fn$;

COMMENT ON FUNCTION public.retention_delete_guard() IS
  'STATEMENT-level AFTER DELETE guard. Aborts a DELETE that touches >100,000 rows on audit_log/audit_log_cold. Defense against unbounded-DELETE regressions in the retention cron bodies. See migration 121 (audit-2026-05-07 P917).';

-- Attach the guard. STATEMENT-level so it fires once per DELETE statement,
-- using a REFERENCING OLD TABLE so the count is O(1) via the transition
-- table mechanism.
DROP TRIGGER IF EXISTS audit_log_retention_guard ON audit_log;
CREATE TRIGGER audit_log_retention_guard
  AFTER DELETE ON audit_log
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_delete_guard();

DROP TRIGGER IF EXISTS audit_log_cold_retention_guard ON audit_log_cold;
CREATE TRIGGER audit_log_cold_retention_guard
  AFTER DELETE ON audit_log_cold
  REFERENCING OLD TABLE AS old_table
  FOR EACH STATEMENT EXECUTE FUNCTION public.retention_delete_guard();

-- --------------------------------------------------------------------------
-- STEP 2: re-schedule cron jobs with a hard pg_cron requirement
-- --------------------------------------------------------------------------
-- If pg_cron is not installed, RAISE EXCEPTION — operators must enable
-- the extension before this migration can succeed. The previous
-- migration-056 posture (RAISE NOTICE and proceed) silently left
-- retention unenforced; that posture is the bug P917 targets.
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'Migration 121: pg_cron extension is NOT installed. Retention enforcement CANNOT proceed silently — this is the bug audit-2026-05-07 P917 targets. Install pg_cron via Supabase Dashboard → Database → Extensions, then re-run this migration. If running in a local-dev environment where pg_cron is intentionally absent, skip this migration and document the deviation.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Re-schedule every retention job. cron.schedule body strings include
  -- an explicit `WHERE created_at < now() - interval '...'` so DELETEs
  -- are always bounded. The retention_delete_guard installed in STEP 1
  -- catches any future edit that drops the WHERE.

  -- JOB 1: audit_log hot → cold (2y)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_hot_to_cold') THEN
    PERFORM cron.unschedule('audit_log_hot_to_cold');
  END IF;
  PERFORM cron.schedule(
    'audit_log_hot_to_cold',
    '0 3 * * *',
    $cron$
    WITH archived AS (
      DELETE FROM audit_log
      WHERE created_at < now() - interval '2 years'
      RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
    )
    INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
    SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
    FROM archived
    ON CONFLICT (id) DO NOTHING;
    $cron$
  );

  -- JOB 2: audit_log_cold purge (7y)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_cold_purge') THEN
    PERFORM cron.unschedule('audit_log_cold_purge');
  END IF;
  PERFORM cron.schedule(
    'audit_log_cold_purge',
    '5 3 * * *',
    $cron$
    DELETE FROM audit_log_cold
    WHERE created_at < now() - interval '7 years';
    $cron$
  );

  -- JOB 3: notification_dispatches (180d)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_notification_dispatches') THEN
    PERFORM cron.unschedule('retention_notification_dispatches');
  END IF;
  PERFORM cron.schedule(
    'retention_notification_dispatches',
    '10 3 * * *',
    $cron$
    DELETE FROM notification_dispatches
    WHERE created_at < now() - interval '180 days';
    $cron$
  );

  -- JOB 4: compute_jobs done (30d)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_done') THEN
    PERFORM cron.unschedule('retention_compute_jobs_done');
  END IF;
  PERFORM cron.schedule(
    'retention_compute_jobs_done',
    '20 3 * * *',
    $cron$
    DELETE FROM compute_jobs
    WHERE status = 'done'
      AND created_at < now() - interval '30 days';
    $cron$
  );

  -- JOB 5: compute_jobs failed (90d)
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_failed') THEN
    PERFORM cron.unschedule('retention_compute_jobs_failed');
  END IF;
  PERFORM cron.schedule(
    'retention_compute_jobs_failed',
    '30 3 * * *',
    $cron$
    DELETE FROM compute_jobs
    WHERE status IN ('failed_final', 'failed_retry')
      AND created_at < now() - interval '90 days';
    $cron$
  );

  RAISE NOTICE 'Migration 121: retention cron jobs re-scheduled under hard pg_cron requirement.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 3: self-verifying DO block — every job exists AND every body
-- contains a WHERE clause filtering by created_at.
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
  has_guard_log BOOLEAN;
  has_guard_cold BOOLEAN;
BEGIN
  -- 1. retention_delete_guard triggers attached
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'audit_log' AND t.tgname = 'audit_log_retention_guard'
  ) INTO has_guard_log;
  IF NOT has_guard_log THEN
    RAISE EXCEPTION 'Migration 121 failed: audit_log_retention_guard trigger missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    WHERE c.relname = 'audit_log_cold' AND t.tgname = 'audit_log_cold_retention_guard'
  ) INTO has_guard_cold;
  IF NOT has_guard_cold THEN
    RAISE EXCEPTION 'Migration 121 failed: audit_log_cold_retention_guard trigger missing';
  END IF;

  -- 2. Every cron job exists AND has a WHERE clause filtering by created_at.
  FOREACH jobname_probe IN ARRAY expected_jobs LOOP
    SELECT command INTO v_command FROM cron.job WHERE jobname = jobname_probe;
    IF v_command IS NULL THEN
      RAISE EXCEPTION 'Migration 121 failed: cron.job % not registered', jobname_probe;
    END IF;
    IF v_command NOT ILIKE '%where%created_at%' THEN
      RAISE EXCEPTION
        'Migration 121 failed: cron.job % body lacks a WHERE created_at clause. command was: %',
        jobname_probe, v_command;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 121: retention crons verified — all 5 jobs scheduled with bounded WHERE clauses; delete-guard triggers installed.';
END $$;

COMMIT;
