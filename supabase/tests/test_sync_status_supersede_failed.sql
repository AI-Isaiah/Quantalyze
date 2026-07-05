-- Test: sync_strategy_analytics_status discounts a SUPERSEDED failed_final
-- (migration 20260705130000_sync_status_supersede_failed.sql).
--
-- Bug: step (b) mapped "ANY failed_final -> failed", so a strategy that failed
-- once and then re-ran cleanly (a newer generation, all 'done') stayed poisoned
-- to 'failed' forever (retry-after-failure showed red despite a valid factsheet).
-- Fix: a failed_final marks 'failed' ONLY when NOT superseded by a strictly
-- later 'done' job (`NOT EXISTS (... d.status='done' AND d.updated_at > f.updated_at)`).
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B): assertions
-- RAISE EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`, AFTER migration 20260705130000.
--
-- Structural pins on the live function body (matches the Part-1 convention in
-- test_compute_jobs_rpc_error_clear_and_fanin.sql). A behavioral seed was
-- deliberately NOT added: the compute_jobs_set_updated_at trigger clobbers any
-- explicit updated_at on write, so a test cannot deterministically order the
-- failed_final BEFORE the superseding 'done' without disabling the trigger —
-- the structural pin below fails on any revert of the guard, which is the
-- invariant that matters. Zero side effects.

DO $$
DECLARE
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  -- The failed-branch count MUST be guarded by a NOT EXISTS supersession clause
  -- keyed on a strictly-later 'done' job. A revert to the bare
  -- "status = 'failed_final'" count (no NOT EXISTS) reddens here.
  IF v_fn !~* 'NOT\s+EXISTS' THEN
    RAISE EXCEPTION 'supersede: failed-branch lost its NOT EXISTS supersession guard';
  END IF;
  IF v_fn !~* 'd\.updated_at\s*>\s*f\.updated_at' THEN
    RAISE EXCEPTION 'supersede: guard does not compare a later done job by updated_at';
  END IF;
  -- The supersession compares specifically against a 'done' job.
  IF v_fn !~* 'd\.status\s*=\s*''done''' THEN
    RAISE EXCEPTION 'supersede: guard does not key supersession on a done job';
  END IF;

  -- Pre-existing branches must survive the full-body CREATE OR REPLACE.
  IF v_fn !~* '''computing''' THEN
    RAISE EXCEPTION 'supersede: lost the (a) non-terminal -> computing branch';
  END IF;
  IF v_fn !~* '''complete''' THEN
    RAISE EXCEPTION 'supersede: lost the (c) all-terminal -> complete branch';
  END IF;
  -- Still SECURITY DEFINER with a baked search_path (038 invariant).
  IF v_fn !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'supersede: function is no longer SECURITY DEFINER';
  END IF;
  IF v_fn !~* 'search_path' THEN
    RAISE EXCEPTION 'supersede: function no longer SETs search_path';
  END IF;

  RAISE NOTICE 'sync_status_supersede: all structural pins hold';
END $$;
