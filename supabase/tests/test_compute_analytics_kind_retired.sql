-- Test: the compute_analytics compute-job kind is retired at the RPC in BOTH
-- live _enqueue_compute_job_internal overloads
-- (migration 20260716090000_retire_compute_analytics_kind_rpc_guard.sql).
--
-- Root cause it guards (Phase 106 v1.10 backbone unification, Stage B / D3):
-- after the Stage-B deletions no code enqueues kind='compute_analytics'. A stray
-- enqueue of the retired kind must fail LOUD at the sole sanctioned insert path —
-- the SECURITY DEFINER _enqueue_compute_job_internal RPC — rather than land a
-- poison row the worker can only dead-letter (job_worker.py:5870-5882). The kind
-- has TWO live overloads (7-param 20260510180226:164, 10-param
-- 20260420073003:330); the guard must be in BOTH, or a caller reaching the
-- un-guarded overload would still enqueue the retired kind.
--
-- Deliberately NOT a CHECK/registry drop: 45 historical prod compute_jobs rows
-- FK-reference the kind, so the registry row + compute_jobs_kind_check STAY and
-- keep admitting it. This test therefore also asserts the CHECK still admits the
-- kind — a "helpful" drop of the kind would fail the deploy on those rows, and
-- this catches a regression that re-introduces such a drop.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions RAISE
-- EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260716090000.
--
-- RED-GUARDED until the TEST project (qmnijlgmdhviwzwfyzlc) catches up to prod:
-- the assertions read the LIVE function bodies, so on a test DB that has not yet
-- had this migration applied the file reddens and ON_ERROR_STOP aborts here —
-- that is expected and by design ([[project_test_project_catchup_unmasks_stale_tests]]).
-- Apply the migration to the test project via Supabase MCP BEFORE merge so CI
-- goes green (see the merge-gate note in the plan SUMMARY).
--
-- Structural only — reads pg_get_functiondef / pg_get_constraintdef, seeds no
-- rows, has zero side effects, and is revert-proof (fails on any re-base back to
-- an un-guarded body).

-- ==========================================================================
-- Part 1 — BOTH overloads carry the retired-kind reject with the
-- invalid_parameter_value ERRCODE, preserve SECDEF + search_path, and the
-- compute_jobs kind CHECK still ADMITS compute_analytics.
-- ==========================================================================
DO $$
DECLARE
  v_oid7   oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb)'
  );
  v_oid10  oid := to_regprocedure(
    'public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz)'
  );
  v_fn7          text;
  v_fn10         text;
  v_check_clause text;
BEGIN
  -- Both overloads must still exist (neither was dropped by the guard migration).
  IF v_oid7 IS NULL THEN
    RAISE EXCEPTION 'retired-kind: 7-param _enqueue_compute_job_internal overload not found';
  END IF;
  IF v_oid10 IS NULL THEN
    RAISE EXCEPTION 'retired-kind: 10-param _enqueue_compute_job_internal overload not found';
  END IF;

  v_fn7  := pg_get_functiondef(v_oid7);
  v_fn10 := pg_get_functiondef(v_oid10);

  -- (a) The retired-kind reject message is present in BOTH bodies. This is the
  -- fail-without-fix anchor: the pre-migration re-base sources have no such text.
  IF position('compute_analytics is retired' IN v_fn7) = 0 THEN
    RAISE EXCEPTION 'retired-kind: 7-param overload does not reject compute_analytics (guard missing — stray enqueue could poison the queue)';
  END IF;
  IF position('compute_analytics is retired' IN v_fn10) = 0 THEN
    RAISE EXCEPTION 'retired-kind: 10-param overload does not reject compute_analytics (guard missing — stray enqueue could poison the queue)';
  END IF;

  -- (b) The reject uses ERRCODE invalid_parameter_value in BOTH bodies (fail-loud
  -- domain error, distinguishable from an opaque 500).
  IF v_fn7 !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'retired-kind: 7-param overload guard is not raised with ERRCODE invalid_parameter_value';
  END IF;
  IF v_fn10 !~* 'invalid_parameter_value' THEN
    RAISE EXCEPTION 'retired-kind: 10-param overload guard is not raised with ERRCODE invalid_parameter_value';
  END IF;

  -- (c) SECDEF posture survives the full-body CREATE OR REPLACE in BOTH overloads.
  IF v_fn7 !~* 'SECURITY DEFINER' OR v_fn10 !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'retired-kind: an overload lost SECURITY DEFINER in the re-base';
  END IF;
  IF v_fn7 !~* 'search_path' OR v_fn10 !~* 'search_path' THEN
    RAISE EXCEPTION 'retired-kind: an overload lost SET search_path in the re-base';
  END IF;

  -- (d) Regression guard: the kind CHECK MUST STILL admit compute_analytics. The
  -- 45 historical prod rows FK-reference it — a "helpful" registry/CHECK drop
  -- would fail the deploy on those rows. This reddens if anyone narrows it.
  SELECT pg_get_constraintdef(oid) INTO v_check_clause
    FROM pg_constraint
   WHERE conrelid = 'public.compute_jobs'::regclass
     AND conname = 'compute_jobs_kind_check';
  IF v_check_clause IS NULL OR position('compute_analytics' IN v_check_clause) = 0 THEN
    RAISE EXCEPTION 'retired-kind: compute_jobs_kind_check no longer admits compute_analytics (registry/CHECK must STAY — historical rows FK-reference it; retirement is RPC-level only)';
  END IF;

  RAISE NOTICE 'Part 1 OK: both overloads reject compute_analytics via invalid_parameter_value; SECDEF + search_path intact; kind CHECK still admits the historical kind.';
END $$;
