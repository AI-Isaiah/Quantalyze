-- Migration: retention purge of orphaned `running` compute_jobs (WORKER-04)
--
-- Why this migration exists
-- -------------------------
-- The `derive-allocator-key-dailies` cron (mig 20260717233529) enqueues
-- api_key-scoped `derive_broker_dailies` jobs every day. On the WORKERLESS
-- TEST project nothing ever advances them past claim, so they accumulate as
-- orphaned `running` rows. Those rows collide with the `python` fence-test
-- seeds through the claim RPC's partition-dedupe arms (mig 20260719073701
-- lines 156-179 — the NOT-EXISTS guards keyed on
-- `x.status IN ('running','done_pending_children')`), reddening CI
-- intermittently. The derive cron CANNOT be unscheduled
-- (`test_derive_allocator_keys_fanout.sql` assertion 6 requires it registered),
-- so the only root-cause fix is a recurring purge.
--
-- DELETE, never reset-to-pending: a row reset to `pending` is re-claimed to
-- `running` by the next CI run and the collision returns. Only removal ends the
-- daily re-pollution.
--
-- Window rationale (why 2 hours is prod-safe)
-- -------------------------------------------
-- analytics-service/main_worker.py WATCHDOG_PER_KIND_OVERRIDES (line 206) caps
-- the max per-kind stale threshold at process_key_long = 40 minutes. On prod
-- the interactive worker's watchdog resets a stalled running->pending at each
-- threshold, so a `running` row older than 2 hours is definitively orphaned
-- (worker down) — never a live in-flight job. The 2h window carries a ~3x
-- margin over the 40-minute max threshold.
--
-- Safety backstop
-- ---------------
-- The `retention_delete_guard` trigger (mig 121) caps every retention cron
-- body at a 100k-row per-statement DELETE ceiling. This cron INHERITS that
-- backstop — it is NOT disabled, bypassed, or re-implemented here (no
-- session_replication_role, no ALTER TABLE DISABLE TRIGGER).
--
-- Scope discipline
-- ----------------
-- This migration touches ONLY the new purge cron. It MUST NOT reschedule
-- `derive-allocator-key-dailies` — that is a founder LIVE op (WORKER-03); a
-- reschedule sneaking into an auto-applied migration would re-wedge prod per
-- the runbook. It alters NO compute_jobs DDL, RLS, or claim RPC.
--
-- Idempotency
-- -----------
-- cron.unschedule + cron.schedule is the canonical re-apply pattern (matches
-- mig 20260515210200 STEP 3). Re-apply is a no-op.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: schedule the orphaned-running purge cron
-- --------------------------------------------------------------------------
-- Wrap in a DO block that fails loud if pg_cron isn't installed (matching the
-- mig 20260515210200 / mig 121 posture — fail-loud is mandatory in a
-- migration, never a silent skip).
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'WORKER-04: pg_cron extension is NOT installed. The orphaned-running purge cron cannot be scheduled. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  -- Schedule: daily at 04:15 UTC. Hour 4 is inside the safe 1-22 band and
  -- runs BEFORE the 05:30 `derive-allocator-key-dailies` cron so each CI day
  -- starts from a clean slate (prior day's orphans already purged).
  --
  -- Body is a FIXED LITERAL (no interpolation, no dynamic SQL) and
  -- schema-qualified to public.compute_jobs so resolution is independent of
  -- the cron session search_path. Scoped to status='running' AND
  -- claimed_at IS NOT NULL AND claimed_at older than the 2h window — it can
  -- NEVER touch a non-running row or a row younger than 2h. The
  -- retention_delete_guard trigger (mig 121) backstops the volume.
  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '15 4 * * *',
    $cron$
    DELETE FROM public.compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '2 hours';
    $cron$
  );

  RAISE NOTICE 'WORKER-04: retention_compute_jobs_orphaned_running scheduled (daily 04:15 UTC, 2h window).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 2: self-verifying DO block
-- --------------------------------------------------------------------------
-- Re-select the deployed command and assert the predicate shape. A
-- deliberately-broken body would fail the migration itself.
DO $$
DECLARE
  v_command TEXT;
BEGIN
  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: retention_compute_jobs_orphaned_running cron job missing after schedule';
  END IF;
  IF v_command NOT ILIKE '%status = ''running''%' THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: purge body does not scope to status = ''running''';
  END IF;
  IF v_command NOT ILIKE '%interval ''2 hours''%' THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: purge body does not use the 2-hour window';
  END IF;
  IF v_command NOT ILIKE '%public.compute_jobs%' THEN
    RAISE EXCEPTION 'WORKER-04 verification failed: purge body is not schema-qualified to public.compute_jobs';
  END IF;

  RAISE NOTICE 'WORKER-04: retention_compute_jobs_orphaned_running self-verify passed (predicate pinned).';
END $$;

COMMIT;
