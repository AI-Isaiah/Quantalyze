-- ==========================================================================
-- Phase 227 JOBLEDGER, plan 07 (MT5D-01): a reaped orphan keeps its cause.
--
-- THE FOUNDER RULING (CONTEXT, 2026-11-23, MT5D-01): one append-only row per failed
-- attempt, so Phase 230 MT5NIGHTLY reads real nights of records. Plan 01 created
-- public.compute_job_attempt_failures and writes the `error` cause. Plan 02 writes
-- `watchdog_reset` and `stall_reclaim` in the two reset functions. This plan writes the
-- fourth attempt-ending path: `orphan_reaped`.
--
-- THE FOURTH PATH. The hourly terminalizer retention_compute_jobs_orphaned_running ends a
-- running job as failed_final with error_kind 'orphaned' in two arms: arm A, a claim stamp
-- older than 4 hours; arm B, no claim stamp at all and a row older than 48 hours (an
-- invariant violation). Either way an attempt ended and its cause (a worker died holding
-- the claim) lived only on a compute_jobs row that the 90-day failed-row prune then erases.
--
-- THIS FILE CHANGES NO CRON COMMAND AND REGISTERS NOTHING. Under the Phase 164.7 rule (D-02
-- in docs/runbooks/derivecron-go-live.md, D-10 in
-- src/__tests__/outagealert-migration-schedules-nothing.test.ts) a migration never schedules
-- or re-registers a job, and a re-registration would also re-point the terminalizer gate's
-- twins. The terminalizer's body therefore stays exactly as 20260826140000 left it, and the
-- record is written by a trigger on its transition instead.
--
-- DECISIONS THIS PLAN RECORDS.
--   DEC-07-A  A trigger, scoped by WHEN. AFTER UPDATE OF status ON public.compute_jobs FOR
--             EACH ROW WHEN (OLD.status = 'running' AND NEW.status = 'failed_final' AND
--             NEW.error_kind = 'orphaned'). Only the terminalizer writes error_kind
--             'orphaned' (mark_compute_job_failed admits transient, permanent and unknown
--             only), so the trigger fires for exactly its rows. Postgres evaluates the WHEN
--             before it calls the function, so every other compute_jobs update pays a
--             column check and nothing more. This is the one trigger-written cause class.
--             The other three are written in-function (plans 01 and 02), because those
--             functions can be re-based by a migration and the cron body cannot. Recorded
--             so the two mechanisms read as a decision and not as drift.
--   DEC-07-B  What the row carries. From OLD: claim_token, attempts and claimed_by. From
--             NEW: id, kind, strategy_id, api_key_id, exchange, created_at, error_kind and
--             last_error. ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING. Arm B's
--             rows have a NULL token. A NULL token never deduplicates, and the terminalizer
--             moves a row out of running only once, so each reaped attempt gives one row.
--   DEC-07-C  No catch-up sweep. A backfill of past reaps would double-write the NULL-token
--             arm, and the RESEARCH census (e) found no orphaned_running_reaped markers in
--             PROD's retained window anyway.
--
-- TRIGGER FUNCTION ACL. REVOKE ALL FROM PUBLIC, anon, authenticated and service_role. A
-- trigger function is checked for EXECUTE once, when CREATE TRIGGER runs (as the migration
-- owner), and not when the trigger fires, so the role that fires it (the pg_cron job role,
-- or any future writer of the transition) needs no grant, and no API role can call it
-- directly. If a later change ever makes a non-owner role fire this trigger, re-read this
-- paragraph before touching the REVOKE.
--
-- Rollback: supabase/migrations/down/20261124120600-rollback.sql (manual, never
-- auto-applied). Ledger rows already written stay.
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: the trigger function
-- ==========================================================================
CREATE FUNCTION public.record_orphan_reaped_attempt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  -- MT5D-01 (phase 227 plan 07): the terminalizer just ended a running attempt as an
  -- orphan. Record it in the same statement, from the row it transitioned.
  INSERT INTO public.compute_job_attempt_failures
    (job_id, kind, strategy_id, api_key_id, exchange, job_created_at,
     attempt, claim_token, cause_class, error_kind, error_text, worker_id)
  VALUES
    (NEW.id, NEW.kind, NEW.strategy_id, NEW.api_key_id, NEW.exchange, NEW.created_at,
     OLD.attempts, OLD.claim_token, 'orphan_reaped', NEW.error_kind, NEW.last_error, OLD.claimed_by)
  ON CONFLICT (job_id, claim_token, cause_class) DO NOTHING;

  RETURN NULL;
END
$$;

REVOKE ALL ON FUNCTION public.record_orphan_reaped_attempt() FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.record_orphan_reaped_attempt() IS
  'Phase 227 MT5D-01 (migration 20261124120600): trigger function of compute_jobs_record_orphan_reaped_attempt. Writes one cause_class orphan_reaped row to compute_job_attempt_failures when the orphan terminalizer moves a running job to failed_final with error_kind orphaned. SECURITY DEFINER, search_path pinned, executable by no API role (a trigger function needs no caller grant). Not a callable API.';

-- ==========================================================================
-- STEP 2: the trigger
-- ==========================================================================
-- Plain CREATE TRIGGER, not CREATE OR REPLACE: the name is new, so a collision must fail loud.
CREATE TRIGGER compute_jobs_record_orphan_reaped_attempt
  AFTER UPDATE OF status ON public.compute_jobs
  FOR EACH ROW
  WHEN (OLD.status = 'running' AND NEW.status = 'failed_final' AND NEW.error_kind = 'orphaned')
  EXECUTE FUNCTION public.record_orphan_reaped_attempt();
