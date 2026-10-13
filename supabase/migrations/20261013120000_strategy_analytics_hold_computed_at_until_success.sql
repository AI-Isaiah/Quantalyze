-- Migration: strategy_analytics.computed_at HOLD-UNTIL-SUCCESS TRIGGER.
-- Phase 166.3.1 NAVBREACH, plan 02. Founder decisions D-04 and D-05, 2026-10-07.
-- =============================================================================
--
-- WHAT THIS FIXES
-- ---------------
-- D-04. A failed stitch_composite re-stamped strategy_analytics.computed_at as if
-- the row had just been recomputed. Python never writes that column on a failure
-- (the runner's failure stamp carries no computed_at); the SQL status bridge does.
-- sync_strategy_analytics_status branch (b) assigns computed_at = now() when a job
-- resolves to failed, and it is reached from mark_compute_job_failed. The PROD
-- signature, measured read-only on 2026-10-07: the failed composite's
-- computed_at equalled the failed job's updated_at to the microsecond.
-- Analytics freshness is read from computed_at (the factsheet FreshnessChip and
-- the portfolio PDF vintage), so a failed recompute made a stale composite look
-- current.
--
-- D-05. The founder widened it the same day: computed_at moves ONLY on a
-- successful write. Branch (a) of the same bridge stamps it when a job starts and
-- the row moves to computing, which is the same lie one step earlier: queueing a
-- retry made a failed row look freshly computed before anything ran.
--
-- THE RULE, AND WHAT IT BINDS
-- ---------------------------
-- A BEFORE UPDATE row trigger restores the old computed_at whenever the new
-- computation_status is failed or computing. A successful write (complete,
-- complete_with_warnings) is untouched and still stamps.
--
-- It binds the TABLE rather than the bridge, so it holds for every writer of a
-- failed or computing row: the bridge's branches (a) and (b), the stuck-computing
-- reaper, the Python entry upsert, and any writer not yet written. That is the
-- same reasoning that put the computing_started_at stamp invariant on the table
-- (20260803120000, D-17) instead of in per-writer code.
--
-- WHY A TRIGGER AND NOT AN EDIT OF THE BRIDGE
-- -------------------------------------------
-- Phase 164.6.6.3.4 STATUSBRIDGE re-bases sync_strategy_analytics_status in
-- parallel, and the 31 RED-UNDER-M twins that edit the bridge's migration text
-- would stop biting if this phase re-issued it. A trigger leaves the bridge and
-- those twins exactly as they are, and needs no re-base against either.
--
-- BACKWARDS COMPATIBILITY
-- -----------------------
-- UPDATE only, deliberately, like the stamp trigger it follows. A first-ever row
-- for a strategy, inserted by the bridge's INSERT arm as failed or computing,
-- still takes the column default (computed_at is NOT NULL DEFAULT now()): there
-- is no prior stamp to restore on an INSERT, and a trigger that fired there would
-- have to invent one. The trigger does not fire on DELETE, so it imports no
-- sanitize_user erasure-exemption obligation (20260710160000).
--
-- CALLER IMPACT, stated here so a reader of the migration sees it
-- ---------------------------------------------------------------
-- Two readers depended on the job-start stamp or the failure stamp and are
-- changed in the SAME PR as this migration; it does not ship without them:
--   * the factsheet unstable_cache key carried computed_at as the thing that
--     moved when a status changed. With the date held, a computing or failed row
--     would be served a cached complete payload for up to the TTL. Plan 06 adds
--     computation_status to the cache key.
--   * the key-card Sync panel (Phase 167.2 KCS-02) admitted a terminal read when
--     computed_at moved from its pre-enqueue baseline. A fast-failing retry moved
--     it; now it does not. Plan 07 adds a change in computation_status or in the
--     computation_error_job_id as a second admissible piece of evidence.
-- The remaining readers (the reaper keys on computing_started_at; the staleness
-- view and the recommendations RPC carry the date for information only; the
-- dropped-enqueue sweep is forbidden to read it; the wizard reads it for computed
-- statuses only) are re-verified one by one in the plan's SUMMARY.
--
-- WHAT THIS DELIBERATELY DOES NOT FIX, and who owns it
-- ----------------------------------------------------
-- Phase 166.5 COMPUTEDATSTAMP owns three residues, all of them on the SUCCESS side
-- of the rule, where this trigger by design does nothing:
--   (i)   branch (c) of the bridge still stamps now() when an UNRELATED job (a
--         cron sync_trades poll, say) is the last in flight and finishes all-done,
--         although nothing was recomputed.
--   (ii)  branch (a) moves a failed row that still carries computation_warned to
--         complete_with_warnings and stamps now() with nothing recomputed. The new
--         status is a success status, so it is not held.
--   (iii) the runner-side stamp 166.5 introduces MUST land on the success write.
--         A stamp written while the row is computing is held by this trigger, so
--         a runner that stamps at the start of a run, or on a failure, is silently
--         discarded.
--
-- SELF-CONTAINMENT
-- ----------------
-- The body reads only NEW and OLD, calls nothing and never raises: a raising
-- trigger here would kill the live bridge call on a money path. SECURITY INVOKER
-- (the default); the pinned search_path follows the 89-prior-migration convention.
--
-- No explicit BEGIN/COMMIT: Supabase wraps each migration in one implicit
-- transaction. No data is read: the closing check reads the catalog only (the
-- house rule after [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE], since shared TEST
-- holds none of PROD's rows).

-- Fail loud rather than queue behind a long reader: CREATE TRIGGER takes an
-- ACCESS EXCLUSIVE lock on strategy_analytics.
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: the trigger function
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.strategy_analytics_hold_computed_at_until_success()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.computation_status IN ('failed', 'computing') THEN
    NEW.computed_at := OLD.computed_at;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.strategy_analytics_hold_computed_at_until_success() IS
  'Phase 166.3.1 D-04 / D-05: computed_at moves only on a successful write. On an '
  'update whose new computation_status is failed or computing the old computed_at '
  'is restored, silently. That binds sync_strategy_analytics_status branch (b) '
  '(a failure no longer stamps) and branch (a) (a job start no longer stamps), '
  'the reaper, the Python entry upsert and any future writer, without editing the '
  'bridge. A write to complete or complete_with_warnings is untouched. Residue '
  'owned by Phase 166.5 COMPUTEDATSTAMP: branch (c) still stamps on an unrelated '
  'all-done mark, branch (a) stamps when it moves a failed+warned row to '
  'complete_with_warnings, and 166.5''s runner stamp must land on the success '
  'write because a stamp written while the row is computing is held here. '
  'Self-contained: reads only NEW/OLD, calls nothing, never raises.';

-- Trigger function: never invocable via PostgREST RPC. Revoke from the API roles
-- too, not just PUBLIC, as the sibling strategy_analytics trigger functions do.
REVOKE ALL ON FUNCTION public.strategy_analytics_hold_computed_at_until_success() FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 2: bind it, UPDATE only
-- --------------------------------------------------------------------------
-- BEFORE triggers fire in name order. The two siblings on this table
-- (drop_stale_error_provenance, stamp_computing_started) neither read nor write
-- computed_at, so none of the three can fight over the column.
DROP TRIGGER IF EXISTS strategy_analytics_hold_computed_at_until_success_trigger ON public.strategy_analytics;
CREATE TRIGGER strategy_analytics_hold_computed_at_until_success_trigger
  BEFORE UPDATE ON public.strategy_analytics
  FOR EACH ROW
  EXECUTE FUNCTION public.strategy_analytics_hold_computed_at_until_success();

COMMENT ON TRIGGER strategy_analytics_hold_computed_at_until_success_trigger ON public.strategy_analytics IS
  'Phase 166.3.1 D-04 / D-05: UPDATE only. Holds computed_at through a write to '
  'failed (bridge branch (b), D-04) and through entry into computing (bridge '
  'branch (a), D-05); a successful write still stamps it. An INSERT keeps the '
  'column default for a first-ever row. Needs the factsheet cache key to carry '
  'computation_status (plan 06) and the Sync panel to read a status change as '
  'evidence (plan 07). Owner of the success-side residue: Phase 166.5.';

-- --------------------------------------------------------------------------
-- STEP 3: self-verify, catalog only: the trigger landed, with the right shape
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_tgtype    INT2;
  v_tgenabled "char";
  v_fn        TEXT;
BEGIN
  SELECT tgtype, tgenabled INTO v_tgtype, v_tgenabled
    FROM pg_trigger
   WHERE tgname = 'strategy_analytics_hold_computed_at_until_success_trigger'
     AND tgrelid = 'public.strategy_analytics'::regclass
     AND NOT tgisinternal;

  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'D-04/D-05 verification failed: strategy_analytics_hold_computed_at_until_success_trigger missing after migration';
  END IF;
  IF v_tgenabled IS DISTINCT FROM 'O' THEN
    RAISE EXCEPTION 'D-04/D-05 verification failed: the hold trigger is not enabled (tgenabled=%)', v_tgenabled;
  END IF;
  -- pg_trigger.tgtype bits: 1 = FOR EACH ROW, 2 = BEFORE, 4 = insert, 8 = delete,
  -- 16 = update. Asserted as bits so the check does not depend on the formatting
  -- of pg_get_triggerdef.
  IF (v_tgtype & 1) = 0 OR (v_tgtype & 2) = 0 OR (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION 'D-04/D-05 verification failed: the hold trigger is not BEFORE UPDATE FOR EACH ROW (tgtype=%); an AFTER trigger cannot restore NEW.computed_at', v_tgtype;
  END IF;
  IF (v_tgtype & 4) <> 0 OR (v_tgtype & 8) <> 0 THEN
    RAISE EXCEPTION 'D-04/D-05 verification failed: the hold trigger also fires on insert or delete (tgtype=%). It is UPDATE-only by design: an INSERT has no prior stamp to restore, and a delete trigger would import the sanitize_user erasure-exemption obligation.', v_tgtype;
  END IF;

  -- The DEPLOYED body, not this file's text. The two patterns are lower-case on
  -- purpose: ~* is case-insensitive, so the check is as strong either way.
  v_fn := pg_get_functiondef('public.strategy_analytics_hold_computed_at_until_success()'::regprocedure);
  IF v_fn !~* 'new\.computation_status\s+in\s*\(\s*''failed''\s*,\s*''computing''\s*\)' THEN
    RAISE EXCEPTION 'D-04/D-05 verification failed: the deployed trigger body does not test for both failed and computing, so one of the two stamps (the failure or the job start) is no longer held.';
  END IF;
  IF v_fn !~* 'new\.computed_at\s*:=\s*old\.computed_at' THEN
    RAISE EXCEPTION 'D-04/D-05 verification failed: the deployed trigger body never restores OLD.computed_at, so it holds nothing.';
  END IF;

  RAISE NOTICE 'D-04/D-05: strategy_analytics_hold_computed_at_until_success_trigger verified (row-level, before, update-only, enabled, body holds on failed and computing).';
END $$;
