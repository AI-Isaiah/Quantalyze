-- Migration: widen the orphaned-`running` purge window 2h -> 4h (WORKER-04, RT-01)
--
-- Why this migration exists
-- -------------------------
-- The v1.13 milestone red team (RT-01) disproved the safety rationale of the
-- original purge (mig 20260719120000). That header argued the 2-hour window was
-- safe because the per-kind watchdog caps a stale row at ~40 min. That is WRONG
-- for a batch-tail row on a LIVE worker:
--   * main_worker.py claims a BATCH of 5 jobs per tick (p_batch_size=5) and
--     stamps `claimed_at` at CLAIM time for the whole batch.
--   * dispatch is SEQUENTIAL, and the longest per-kind timeout is
--     process_key_long / reconstruct_allocator_history = 30 min
--     (job_worker.py TIMEOUT_PER_KIND).
--   * so job #5 of a full batch can be legitimately in-flight on a HEALTHY
--     worker with a `claimed_at` up to 5 x 30 min = 2.5 HOURS old.
-- The 2h purge could therefore DELETE a row the worker is actively processing:
-- the handler's side effects then land with no job row, `mark_done` errors, and
-- the in-flight partition-dedupe no longer sees the row, so a DUPLICATE job can
-- be enqueued and run concurrently — the exact double-compute the claim fence
-- exists to prevent. The watchdog RPC is the only thing that would have reset it,
-- and its failure is silent (a logger.error every 60s while the worker stays
-- green) — so the window must NOT depend on the watchdog.
--
-- Corrected basis: max legitimate batch wall-clock = p_batch_size (5) x max
-- per-kind timeout (30 min) = 2.5h. A 4-hour window sits comfortably above that
-- (1.5h margin), so a `running` row older than 4h is genuinely orphaned (worker
-- down or the claim leaked) — NOT a live batch-tail job. This does NOT depend on
-- the watchdog firing. Daily-cron cleanup latency is unchanged (still one 04:15
-- sweep); only WHICH rows are eligible narrows to the truly-orphaned set.
--
-- Still DELETE, not reset-to-pending: the WR-02 DELETE-vs-reset tradeoff on a
-- sustained (>window) worker outage remains a FOUNDER decision for the FLIP-01
-- go-live (a genuinely-orphaned interactive one-shot is removed with no terminal
-- state). This migration ONLY corrects the window so the purge can never eat a
-- LIVE worker's in-flight batch-tail row — a distinct correctness bug from the
-- outage tradeoff.
--
-- Scope: reschedules ONLY retention_compute_jobs_orphaned_running. Touches no
-- other cron, no compute_jobs DDL/RLS/claim RPC. Idempotent
-- (unschedule-if-exists -> schedule).

BEGIN;
SET lock_timeout = '5s';

DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'WORKER-04/RT-01: pg_cron extension is NOT installed. The orphaned-running purge cron cannot be rescheduled. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running') THEN
    PERFORM cron.unschedule('retention_compute_jobs_orphaned_running');
  END IF;

  -- Same schedule (daily 04:15 UTC) and fixed, schema-qualified literal body as
  -- mig 20260719120000 — ONLY the window changes 2h -> 4h (see header for why).
  PERFORM cron.schedule(
    'retention_compute_jobs_orphaned_running',
    '15 4 * * *',
    $cron$
    DELETE FROM public.compute_jobs
     WHERE status = 'running'
       AND claimed_at IS NOT NULL
       AND claimed_at < now() - interval '4 hours';
    $cron$
  );

  RAISE NOTICE 'WORKER-04/RT-01: retention_compute_jobs_orphaned_running rescheduled (daily 04:15 UTC, 4h window).';
END $$;

-- Self-verify: the deployed body now uses the 4-hour window, still scoped.
DO $$
DECLARE
  v_command TEXT;
BEGIN
  SELECT command INTO v_command
    FROM cron.job WHERE jobname = 'retention_compute_jobs_orphaned_running';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: retention_compute_jobs_orphaned_running cron job missing after reschedule';
  END IF;
  IF v_command NOT ILIKE '%status = ''running''%' THEN
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: purge body does not scope to status = ''running''';
  END IF;
  IF v_command NOT ILIKE '%interval ''4 hours''%' THEN
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: purge body does not use the corrected 4-hour window';
  END IF;
  IF v_command ILIKE '%interval ''2 hours''%' THEN
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: purge body still carries the old 2-hour window';
  END IF;
  IF v_command NOT ILIKE '%public.compute_jobs%' THEN
    RAISE EXCEPTION 'WORKER-04/RT-01 verification failed: purge body is not schema-qualified to public.compute_jobs';
  END IF;

  RAISE NOTICE 'WORKER-04/RT-01: retention_compute_jobs_orphaned_running self-verify passed (4h window pinned).';
END $$;

COMMIT;
