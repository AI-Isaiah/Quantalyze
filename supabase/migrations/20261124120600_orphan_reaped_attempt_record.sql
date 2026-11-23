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

-- ==========================================================================
-- STEP 3: self-verify, CATALOGUE ONLY (reads no table row)
-- ==========================================================================
-- pg_trigger, pg_get_triggerdef, pg_proc, pg_constraint and has_function_privilege only, so
-- scripts/lint-migration-data-dependence.mjs passes and the apply cannot refuse on a
-- database whose tables are empty. Each condition is computed into a named boolean and
-- tested in its own IF, so a mutation twin of the gate
-- (supabase/tests/test_orphan_reaped_attempt_record.sql) can stand one IF down and let the
-- arm's OWN observable go red. Every RAISE is one literal naming the consequence.
DO $verify$
DECLARE
  v_fn            oid := to_regprocedure('public.record_orphan_reaped_attempt()');
  v_tbl           oid := to_regclass('public.compute_jobs');
  v_n             integer;
  v_enabled       "char";
  v_def           text;
  v_secdef        boolean;
  v_cfg           text[];
  v_cause_def     text;
  v_fn_ok         boolean;
  v_one_ok        boolean;
  v_enabled_ok    boolean;
  v_after_ok      boolean;
  v_row_ok        boolean;
  v_running_ok    boolean;
  v_final_ok      boolean;
  v_orphaned_ok   boolean;
  v_secdef_ok     boolean;
  v_pin_ok        boolean;
  v_acl_ok        boolean;
  v_cause_ok      boolean;
BEGIN
  v_fn_ok := v_fn IS NOT NULL;
  IF NOT v_fn_ok THEN
    RAISE EXCEPTION 'orphan_reaped: public.record_orphan_reaped_attempt() does not exist, so a reaped orphan keeps no record of its cause';
  END IF;

  SELECT count(*) INTO v_n
    FROM pg_trigger t
   WHERE t.tgrelid = v_tbl AND t.tgfoid = v_fn AND NOT t.tgisinternal;
  v_one_ok := v_n = 1;
  IF NOT v_one_ok THEN
    RAISE EXCEPTION 'orphan_reaped: exactly one trigger on public.compute_jobs must call record_orphan_reaped_attempt(), otherwise a reaped orphan is recorded twice or not at all';
  END IF;

  SELECT t.tgenabled, pg_get_triggerdef(t.oid) INTO v_enabled, v_def
    FROM pg_trigger t
   WHERE t.tgrelid = v_tbl AND t.tgfoid = v_fn AND NOT t.tgisinternal;

  v_enabled_ok := v_enabled = 'O';
  IF NOT v_enabled_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the compute_jobs_record_orphan_reaped_attempt trigger must be enabled, otherwise the terminalizer reaps orphans without a record';
  END IF;

  v_after_ok := position('AFTER UPDATE OF status ON' IN v_def) > 0;
  IF NOT v_after_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the trigger must be AFTER UPDATE OF status, otherwise it fires on every compute_jobs update (a hot table) instead of only on a status change';
  END IF;

  v_row_ok := position('FOR EACH ROW' IN v_def) > 0;
  IF NOT v_row_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the trigger must be row level, otherwise it cannot read the claim token and attempt count of each reaped job';
  END IF;

  v_running_ok := position('''running''' IN v_def) > 0;
  IF NOT v_running_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the trigger WHEN must name the running status, otherwise a job that never ran is recorded as a reaped attempt';
  END IF;

  v_final_ok := position('''failed_final''' IN v_def) > 0;
  IF NOT v_final_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the trigger WHEN must name the failed_final status, otherwise a retried or finished job is recorded as a reaped attempt';
  END IF;

  v_orphaned_ok := position('''orphaned''' IN v_def) > 0;
  IF NOT v_orphaned_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the trigger WHEN must name error_kind orphaned, otherwise a failure written by mark_compute_job_failed is recorded a second time under a cause it did not have';
  END IF;

  SELECT p.prosecdef, p.proconfig INTO v_secdef, v_cfg FROM pg_proc p WHERE p.oid = v_fn;
  v_secdef_ok := v_secdef IS TRUE;
  IF NOT v_secdef_ok THEN
    RAISE EXCEPTION 'orphan_reaped: record_orphan_reaped_attempt() must be SECURITY DEFINER, otherwise the role that fires the trigger needs INSERT on the ledger, which no role holds';
  END IF;

  v_pin_ok := COALESCE(v_cfg, ARRAY[]::text[]) @> ARRAY['search_path=public, pg_catalog'];
  IF NOT v_pin_ok THEN
    RAISE EXCEPTION 'orphan_reaped: record_orphan_reaped_attempt() must pin search_path=public, pg_catalog, otherwise a SECURITY DEFINER function resolves names through the caller''s path';
  END IF;

  v_acl_ok := NOT has_function_privilege('public', v_fn, 'EXECUTE')
          AND NOT has_function_privilege('anon', v_fn, 'EXECUTE')
          AND NOT has_function_privilege('authenticated', v_fn, 'EXECUTE');
  IF NOT v_acl_ok THEN
    RAISE EXCEPTION 'orphan_reaped: record_orphan_reaped_attempt() must be executable by no API role, otherwise any signed-in caller can invoke a SECURITY DEFINER writer of the ledger';
  END IF;

  SELECT pg_get_constraintdef(k.oid) INTO v_cause_def
    FROM pg_constraint k
   WHERE k.conrelid = to_regclass('public.compute_job_attempt_failures')
     AND k.conname = 'compute_job_attempt_failures_cause_class_chk';
  v_cause_ok := COALESCE(position('''orphan_reaped''' IN v_cause_def), 0) > 0;
  IF NOT v_cause_ok THEN
    RAISE EXCEPTION 'orphan_reaped: the ledger cause_class CHECK from migration 20261124120000 must admit orphan_reaped, otherwise the trigger''s INSERT is refused and aborts the terminalizer''s whole UPDATE';
  END IF;

  RAISE NOTICE 'orphan_reaped: compute_jobs_record_orphan_reaped_attempt verified (one enabled row-level AFTER UPDATE OF status trigger, WHEN running to failed_final with error_kind orphaned); the function is SECURITY DEFINER, search_path pinned, executable by no API role; the ledger CHECK admits orphan_reaped.';
END
$verify$;
