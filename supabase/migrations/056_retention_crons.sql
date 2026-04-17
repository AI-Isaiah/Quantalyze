-- Migration 056: data retention pg_cron jobs + audit_log cold archive.
--
-- Sprint 6 closeout Task 7.3 — Data retention + GDPR workflow (part 2 of 2).
--
-- Why this migration exists
-- -------------------------
-- The product accumulates ephemeral observability rows (notification
-- dispatches, compute job outcomes) and forensic rows (audit log) that must
-- be pruned on a regulatory-grounded schedule. Per ADR-0024 (data retention
-- policy) the thresholds are:
--
--   * audit_log (hot)               — 2y retention, moved to audit_log_cold
--   * audit_log_cold                — 5y retention (7y total from birth)
--   * notification_dispatches       — 180d
--   * compute_jobs status='done'    — 30d
--   * compute_jobs failed/cancelled — 90d
--
-- This migration:
--   1. Creates the `audit_log_cold` table with the SAME schema + indexes +
--      append-only invariant as the hot audit_log (migration 010 + 049).
--   2. Registers five pg_cron jobs that enforce those thresholds nightly.
--      Each job is idempotent via `DELETE WHERE created_at < now() -
--      interval '…'` — re-running when yesterday's run already purged the
--      crossover rows simply finds zero rows to delete.
--
-- Two-stage audit retention (the cold archive)
-- --------------------------------------------
-- audit_log has a two-stage retention. At 2y, rows are MOVED from the hot
-- table to `audit_log_cold` via a single `DELETE … RETURNING → INSERT …
-- ON CONFLICT (id) DO NOTHING` CTE. At 7y total (5y in cold), the cold
-- row is DELETEd. Both jobs run against the same UTC timestamp space
-- (`created_at` is preserved across the move), so the 7y cold-purge
-- threshold is measured from the row's original birth, not from when it
-- was archived.
--
-- Why the CTE (and not INSERT-SELECT + DELETE)
-- --------------------------------------------
-- The obvious formulation — `INSERT INTO cold SELECT ... FROM hot WHERE
-- age > 2y; DELETE FROM hot WHERE age > 2y;` — has a subtle race: a
-- backdated row inserted between the INSERT-SELECT and the DELETE with a
-- created_at older than 2y would be DELETEd without being archived.
-- The append-only deny policies block the scenario from PostgREST, but
-- service_role-or-superuser paths (e.g., a future manual recovery
-- import) could still produce it. The CTE fixes the race by making the
-- DELETE the source-of-truth: its RETURNING captures exactly the rows
-- removed, and the INSERT sees only those. Whatever the snapshot of
-- "rows older than 2y" was at DELETE time is the set that lands in cold.
--
-- The cold table inherits the hot table's append-only invariant: owner
-- SELECT + admin SELECT, with FOR UPDATE USING (false) + FOR DELETE
-- USING (false) deny policies + REVOKE UPDATE, DELETE at the grant level.
-- Superuser SQL (the cold-purge cron runs as postgres) retains the ability
-- to DELETE rows older than 7y — the deny policies bind PostgREST roles,
-- not the OWNER.
--
-- Scope decisions (locked)
-- ------------------------
--   * Cold archive lives in the same Postgres database, not in S3/Glacier.
--     S3 was considered but rejected for two reasons: (a) preserving RLS
--     means the existing owner-read path for audit_log keeps working for
--     rows old enough to have migrated; (b) the operational cost of two
--     storage surfaces exceeds the storage-cost delta at our volume for
--     the next 5+ years.
--   * Compute-job retention uses `created_at`, not `claimed_at` or
--     `updated_at`. created_at is the row's birth and is monotonic; using
--     a claim/update column would let a job with a long retry history
--     outlive its successful ancestor by minutes.
--
-- Numbering deviation
-- -------------------
-- The Sprint 6 closeout plan called this migration 052_retention_crons.sql.
-- Migrations 050-054 were consumed by Sprint 5 (050-053) and Task 7.2
-- (054), and Task 7.3's sanitize_user is in 055. 056 is the next free slot,
-- following the convention documented in 050's header.
--
-- What this migration ships
-- -------------------------
-- 1. `audit_log_cold` table + indexes + RLS policies + append-only grants.
-- 2. Six cron jobs, all scheduled daily UTC with distinct timeslots so they
--    don't contend for the same compute window or overlap the 01:00 match
--    engine cron (migration 015):
--
--      Name                              | Schedule       | Action
--      ----------------------------------|----------------|-----------------
--      audit_log_hot_to_cold             | 0 3 * * *      | CTE move to cold at 2y
--      audit_log_cold_purge              | 5 3 * * *      | DELETE cold at 7y
--      retention_notification_dispatches | 10 3 * * *     | 180 days
--      retention_compute_jobs_done       | 20 3 * * *     | 30 days
--      retention_compute_jobs_failed     | 30 3 * * *     | 90 days
--      api_key_rotation_reminder         | 0 4 * * *      | capture rotation-due signals
--                                                          (consumer wired in Sprint 7)
--
-- 3. Self-verifying DO block asserting the cold table + indexes + policies
--    + every cron job is registered.
--
-- Caller impact
-- -------------
-- Zero at apply time. The jobs' first run fires at 03:00 UTC on the next
-- cron tick. Before then, no row is moved or deleted. The cold table is
-- empty until the first hot→cold run has data to migrate.

BEGIN;

-- --------------------------------------------------------------------------
-- STEP 1: audit_log_cold table
-- --------------------------------------------------------------------------
-- Mirrors the hot audit_log schema (migration 010) exactly. Same columns,
-- same nullability, same PK. The `id` PK carries across from hot to cold
-- so a row's identity is preserved; ON CONFLICT (id) DO NOTHING in the
-- move job makes re-runs a no-op.
CREATE TABLE IF NOT EXISTS audit_log_cold (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL
);

COMMENT ON TABLE audit_log_cold IS
  'Cold archive of audit_log rows older than 2y. Rows land here via the audit_log_hot_to_cold cron and are deleted at 7y by audit_log_cold_purge. Same append-only invariants as audit_log — see migration 056.';

-- Mirror the hot table's indexes. Queries against the cold archive follow
-- the same access patterns (by user, by entity).
CREATE INDEX IF NOT EXISTS idx_audit_log_cold_user   ON audit_log_cold (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_cold_entity ON audit_log_cold (entity_type, entity_id);

-- --------------------------------------------------------------------------
-- STEP 2: RLS + append-only invariant on audit_log_cold
-- --------------------------------------------------------------------------
-- Match the hot table's posture:
--   * Owner SELECTs own rows (user_id = auth.uid()).
--   * Admins SELECT all rows (via current_user_has_app_role, matching the
--     pattern used by the gdpr-exports bucket policy in migration 055).
--   * INSERT is service_role-only (used by the hot→cold cron, which runs
--     as postgres and bypasses RLS regardless — the policy is defense
--     against a future direct client-side insert slipping through).
--   * UPDATE + DELETE are denied at the RLS layer AND at the grant layer
--     (REVOKE UPDATE, DELETE from authenticated, service_role), per
--     migration 049's pattern for the hot table.
--
-- The cold-purge cron runs as the superuser postgres which is unaffected
-- by the DELETE grants/policies; that's the intentional escape hatch
-- documented in ADR-0023 §6.
ALTER TABLE audit_log_cold ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_cold_owner_read ON audit_log_cold;
CREATE POLICY audit_log_cold_owner_read ON audit_log_cold FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS audit_log_cold_admin_read ON audit_log_cold;
CREATE POLICY audit_log_cold_admin_read ON audit_log_cold FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']));

DROP POLICY IF EXISTS audit_log_cold_service_insert ON audit_log_cold;
CREATE POLICY audit_log_cold_service_insert ON audit_log_cold FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Deny policies — mirror migration 049 for the hot table.
DROP POLICY IF EXISTS audit_log_cold_no_updates ON audit_log_cold;
CREATE POLICY audit_log_cold_no_updates ON audit_log_cold
  FOR UPDATE USING (false);

DROP POLICY IF EXISTS audit_log_cold_no_deletes ON audit_log_cold;
CREATE POLICY audit_log_cold_no_deletes ON audit_log_cold
  FOR DELETE USING (false);

-- Grant-level defense-in-depth. Even if RLS is disabled in a future
-- migration (or by operator error), PostgREST cannot UPDATE/DELETE.
REVOKE UPDATE, DELETE ON audit_log_cold FROM authenticated, service_role;

-- --------------------------------------------------------------------------
-- STEP 3: cron jobs
-- --------------------------------------------------------------------------
-- Idempotent re-scheduling: each job's registration block unschedules any
-- prior version first, then schedules. The outer DO block handles the
-- pg_cron-missing case gracefully so local dev applies cleanly.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed — skipping retention crons. Enable in Supabase Dashboard → Database → Extensions and re-run this migration.';
    RETURN;
  END IF;

  ------------------------------------------------------------------
  -- JOB 1: audit_log_hot_to_cold — move rows >2y old from audit_log
  -- into audit_log_cold via a single CTE. The DELETE's RETURNING is
  -- the authoritative snapshot: only rows it removed feed the INSERT,
  -- so a concurrent backdated insert between the two ops cannot be
  -- deleted-without-archive.
  --
  -- ON CONFLICT (id) DO NOTHING makes the CTE idempotent on re-run:
  -- if a prior crash left a row in cold without removing it from hot,
  -- the next run's DELETE RETURNING re-emits the row, the INSERT
  -- no-ops on the existing cold id, and everything converges.
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_hot_to_cold') THEN
    PERFORM cron.unschedule('audit_log_hot_to_cold');
  END IF;
  -- Also unschedule the legacy single-stage job name from the pre-cold
  -- version of this migration, in case we're re-applying over a DB that
  -- had the earlier 7y DELETE registered.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_audit_log') THEN
    PERFORM cron.unschedule('retention_audit_log');
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

  ------------------------------------------------------------------
  -- JOB 2: audit_log_cold_purge — delete cold rows >7y old (5y in
  -- cold after 2y in hot). created_at is preserved through the move,
  -- so this threshold is measured from birth, not from archival.
  --
  -- This runs as the postgres superuser inside pg_cron, which bypasses
  -- the audit_log_cold_no_deletes RLS policy AND the REVOKE DELETE at
  -- the grant layer (superuser owns the table). Documented escape
  -- hatch per ADR-0023 §6.
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- JOB 3: notification_dispatches — 180-day retention.
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- JOB 4: compute_jobs status='done' — 30-day retention.
  -- Done-state queue rows are observability. 30 days is plenty for the
  -- admin compute-jobs dashboard retrospective queries.
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- JOB 5: compute_jobs failed_final / cancelled — 90-day retention.
  -- The plan text says "failed_final/cancelled" but the schema's
  -- status enum is ('pending','running','done','done_pending_children',
  -- 'failed_retry','failed_final'). There is no 'cancelled' state
  -- today (migration 032). We purge 'failed_final' rows at 90d and
  -- 'failed_retry' rows at 90d too — once a retry is 90d cold it is
  -- terminally dead (the backoff ladder tops out in hours, not months)
  -- and should not be resurrecting. A future 'cancelled' status would
  -- fall under the same window.
  ------------------------------------------------------------------
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

  ------------------------------------------------------------------
  -- JOB 6: 90-day API key rotation-due SIGNAL capture. Writes a
  -- notification_dispatches row (type='api_key_rotation_reminder',
  -- status='queued') for every user whose most recent api_keys row
  -- was created >90d ago AND they do NOT already have a recent
  -- reminder dispatch row in the last 60d.
  --
  -- IMPORTANT: This job CAPTURES signals but does NOT send mail. There
  -- is no consumer in Sprint 6 that reads these queued rows — the
  -- reminder pipeline is scheduled for Sprint 7. We ship the capture
  -- job now because (a) the rows accumulating today form the backlog
  -- the Sprint 7 consumer will drain, and (b) api_keys has no
  -- `rotated_at` column (rotation is DELETE+INSERT, the new row's
  -- `created_at` is the effective rotation timestamp), so anchoring
  -- the 90d clock today is important.
  --
  -- The 180-day notification_dispatches retention cron (JOB 3) gives
  -- us a comfortable ~6-month buffer before queued rows start aging
  -- out, which is more than enough time for the Sprint 7 consumer to
  -- land — see ADR-0024 "Open questions / Sprint 7" for the tracking
  -- item.
  ------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'api_key_rotation_reminder') THEN
    PERFORM cron.unschedule('api_key_rotation_reminder');
  END IF;

  PERFORM cron.schedule(
    'api_key_rotation_reminder',
    '0 4 * * *',
    $cron$
    INSERT INTO notification_dispatches (
      notification_type, recipient_email, subject, status, metadata
    )
    SELECT
      'api_key_rotation_reminder' AS notification_type,
      p.email,
      'Rotate your exchange API key' AS subject,
      'queued' AS status,
      jsonb_build_object(
        'user_id',     p.id,
        'api_key_id',  k.id,
        'exchange',    k.exchange,
        'created_at',  k.created_at
      ) AS metadata
    FROM api_keys k
    JOIN profiles p ON p.id = k.user_id
    WHERE k.is_active = TRUE
      AND k.created_at < now() - interval '90 days'
      AND p.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM notification_dispatches nd
        WHERE nd.notification_type = 'api_key_rotation_reminder'
          AND nd.recipient_email  = p.email
          AND nd.created_at > now() - interval '60 days'
      );
    $cron$
  );

  RAISE NOTICE 'Migration 056: 6 retention/reminder cron jobs scheduled (2x audit two-stage + 3x retention + 1x api_key_rotation_reminder).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 4: self-verifying DO block
-- --------------------------------------------------------------------------
-- Asserts:
--   * audit_log_cold table + indexes + append-only policies exist.
--   * All six cron jobs are registered (when pg_cron is installed).
-- If pg_cron is missing (local dev), cron.job assertions are skipped so
-- `supabase db reset` works cleanly. The cold-table assertions always run.
DO $$
DECLARE
  has_cold_idx_user        BOOLEAN;
  has_cold_idx_entity      BOOLEAN;
  has_cold_no_updates      BOOLEAN;
  has_cold_no_deletes      BOOLEAN;
  authed_can_update_cold   BOOLEAN;
  authed_can_delete_cold   BOOLEAN;
  svc_can_update_cold      BOOLEAN;
  svc_can_delete_cold      BOOLEAN;
  expected_jobs TEXT[] := ARRAY[
    'audit_log_hot_to_cold',
    'audit_log_cold_purge',
    'retention_notification_dispatches',
    'retention_compute_jobs_done',
    'retention_compute_jobs_failed',
    'api_key_rotation_reminder'
  ];
  jobname_probe TEXT;
  missing_count INT := 0;
BEGIN
  -- Table existence is tautological: the CREATE TABLE IF NOT EXISTS at
  -- STEP 1 either succeeds or the whole migration rolls back. We skip
  -- the information_schema probe and jump straight to the non-
  -- tautological checks (indexes, policies, grants, crons) below.

  -- Indexes exist
  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'audit_log_cold'
      AND indexname = 'idx_audit_log_cold_user'
  ) INTO has_cold_idx_user;
  IF NOT has_cold_idx_user THEN
    RAISE EXCEPTION 'Migration 056 failed: idx_audit_log_cold_user missing';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'audit_log_cold'
      AND indexname = 'idx_audit_log_cold_entity'
  ) INTO has_cold_idx_entity;
  IF NOT has_cold_idx_entity THEN
    RAISE EXCEPTION 'Migration 056 failed: idx_audit_log_cold_entity missing';
  END IF;

  -- 3. Deny policies exist and have USING(false)
  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log_cold'
      AND policyname = 'audit_log_cold_no_updates'
      AND cmd = 'UPDATE'
      AND qual = 'false'
  ) INTO has_cold_no_updates;
  IF NOT has_cold_no_updates THEN
    RAISE EXCEPTION 'Migration 056 failed: audit_log_cold_no_updates policy missing or does not deny (qual != false)';
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_log_cold'
      AND policyname = 'audit_log_cold_no_deletes'
      AND cmd = 'DELETE'
      AND qual = 'false'
  ) INTO has_cold_no_deletes;
  IF NOT has_cold_no_deletes THEN
    RAISE EXCEPTION 'Migration 056 failed: audit_log_cold_no_deletes policy missing or does not deny (qual != false)';
  END IF;

  -- 4. UPDATE/DELETE grants revoked from authenticated + service_role
  SELECT has_table_privilege('authenticated', 'public.audit_log_cold', 'UPDATE')
    INTO authed_can_update_cold;
  SELECT has_table_privilege('authenticated', 'public.audit_log_cold', 'DELETE')
    INTO authed_can_delete_cold;
  SELECT has_table_privilege('service_role', 'public.audit_log_cold', 'UPDATE')
    INTO svc_can_update_cold;
  SELECT has_table_privilege('service_role', 'public.audit_log_cold', 'DELETE')
    INTO svc_can_delete_cold;
  IF authed_can_update_cold OR authed_can_delete_cold OR svc_can_update_cold OR svc_can_delete_cold THEN
    RAISE EXCEPTION
      'Migration 056 failed: audit_log_cold UPDATE/DELETE still granted — authed=%/% svc=%/%',
      authed_can_update_cold, authed_can_delete_cold, svc_can_update_cold, svc_can_delete_cold;
  END IF;

  -- 5. Cron jobs (skipped if pg_cron missing)
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'Migration 056 self-verify: pg_cron not installed, skipping cron.job assertions.';
  ELSE
    FOREACH jobname_probe IN ARRAY expected_jobs LOOP
      IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = jobname_probe) THEN
        RAISE WARNING 'Migration 056 self-verify: cron.job % not registered', jobname_probe;
        missing_count := missing_count + 1;
      END IF;
    END LOOP;

    IF missing_count > 0 THEN
      RAISE EXCEPTION 'Migration 056 failed: % expected cron.job rows missing', missing_count;
    END IF;
  END IF;

  RAISE NOTICE 'Migration 056 self-verify: audit_log_cold + 6 retention/reminder cron jobs present.';
END $$;

COMMIT;
