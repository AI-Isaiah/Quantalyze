-- Test: sync_strategy_analytics_status preserves 'complete_with_warnings'
-- (migration 20260707120000_sync_status_preserve_warnings.sql).
--
-- Root cause it guards: branch (c) ("all jobs done") used to UNCONDITIONALLY
-- overwrite computation_status = 'complete', laundering the warnings status the
-- analytics worker had just written. The whole complete_with_warnings channel
-- was dead platform-wide (migration 20260602120000 observed 0 such rows ever
-- persisted). This test FAILS against the pre-fix function body.
--
-- Part 2 drives the REAL worker RPC `mark_compute_job_done`, not the isolated
-- bridge — that is the actual production entry point: it flips the compute_jobs
-- row running→done and then PERFORMs sync_strategy_analytics_status (branch (c))
-- in one transaction. An earlier version of this test seeded jobs already
-- 'done' and called the bridge directly; that is a vacuum — it never reproduces
-- the worker sequence and stays green even while production launders the
-- warning (the exact miss a red-team pass caught). This version goes red
-- against the pre-fix branch (c).
--
-- Part 3 drives the CROSS-JOB vector: a warned analytics job with a sibling
-- job (poll_positions) still 'running', analytics marked done first, so
-- mark_compute_job_done's in-RPC bridge takes branch (a). The warning must
-- survive branch (a) too — else branch (c) later reads 'computing' → plain
-- 'complete'. This is the live-API (Deribit) leak the single-job Part 2 cannot
-- surface; it RAISES unless branch (a) preserves complete_with_warnings.
--
-- (A separate, now-redundant pre-mark launder — dispatch calling the bridge
-- while the job is still 'running' — is additionally removed on the Python side
-- in services/job_worker.py dispatch, DEFERRED-only, fenced by
-- tests/test_job_worker.py::TestDispatchStatusBridge. With branch (a) preserving,
-- that path is harmless regardless.)
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B), so assertions
-- RAISE EXCEPTION on failure; a clean run prints NOTICEs only. Run under
-- `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration 20260707120000.
--
-- Part 2 seeds gen_random_uuid() ids inside an explicit BEGIN/ROLLBACK so a
-- concurrent CI run against the shared test project cannot collide and no row
-- is left behind even on assertion failure.

-- ==========================================================================
-- Part 1 — structural: the live function body carries the preserve CASE and
-- still promotes non-warned states. Zero side effects; fails on any revert.
-- ==========================================================================
DO $$
DECLARE
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  -- Branch (c) must preserve complete_with_warnings via the CASE.
  IF v_fn !~* 'WHEN\s+strategy_analytics\.computation_status\s*=\s*''complete_with_warnings''' THEN
    RAISE EXCEPTION 'preserve-warnings: branch (c) does not preserve complete_with_warnings (CASE missing)';
  END IF;
  -- Pre-existing invariants survive the full-body CREATE OR REPLACE.
  IF v_fn !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'preserve-warnings: function lost SECURITY DEFINER';
  END IF;
  IF v_fn !~* 'search_path' THEN
    RAISE EXCEPTION 'preserve-warnings: function lost SET search_path';
  END IF;
  RAISE NOTICE 'Part 1 OK: branch (c) preserves complete_with_warnings; SECDEF + search_path intact.';
END $$;

-- ==========================================================================
-- Part 2 — integration: drive mark_compute_job_done (the real worker RPC) and
-- assert an existing complete_with_warnings is PRESERVED across the running→done
-- flip + in-RPC bridge, while a mid-run 'computing' is promoted to complete.
-- Isolated in a transaction that always rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user       uuid := gen_random_uuid();
  v_warn       uuid;  -- strategy that should keep complete_with_warnings
  v_clean      uuid;  -- strategy that should be promoted to complete
  v_job_warn   uuid := gen_random_uuid();
  v_job_clean  uuid := gen_random_uuid();
  v_token_warn  uuid := gen_random_uuid();
  v_token_clean uuid := gen_random_uuid();
  v_status TEXT;
BEGIN
  -- FK chain: compute_jobs/strategy_analytics.strategy_id -> strategies.id ->
  -- profiles.id -> auth.users.id. handle_new_user auto-creates the profile.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sync-warn-sql-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sync-warn-test') ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-warn-strat') RETURNING id INTO v_warn;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-clean-strat') RETURNING id INTO v_clean;

  -- The analytics runner has already written the authoritative terminal status
  -- for the warned strategy, and left 'computing' on the clean one (mid-run).
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_warn, 'complete_with_warnings');
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_clean, 'computing');

  -- Each strategy has exactly one job, still 'running' with a claim token — the
  -- exact state at the moment main_worker calls mark_compute_job_done.
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token)
  VALUES
    (v_job_warn,  'compute_analytics_from_csv', v_warn,  'running', 'normal', 1, now(), v_token_warn),
    (v_job_clean, 'compute_analytics_from_csv', v_clean, 'running', 'normal', 1, now(), v_token_clean);

  -- Drive the REAL RPC: flip running→done, then in-RPC bridge (branch (c)).
  PERFORM public.mark_compute_job_done(v_job_warn,  v_token_warn);
  PERFORM public.mark_compute_job_done(v_job_clean, v_token_clean);

  -- (1) warned strategy KEEPS complete_with_warnings (this is the regression).
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_warn;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'preserve-warnings: mark_compute_job_done laundered complete_with_warnings to % (the platform-wide bug)', v_status;
  END IF;

  -- (2) mid-run 'computing' strategy is promoted to complete (no over-preserve).
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_clean;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'preserve-warnings: computing→complete promotion broke (got %)', v_status;
  END IF;

  RAISE NOTICE 'Part 2 OK: mark_compute_job_done preserved complete_with_warnings; computing promoted to complete.';
END $$;
ROLLBACK;

-- ==========================================================================
-- Part 3 — multi-job (cross-job branch (a)) interleaving. A live-API strategy
-- has a warned analytics job PLUS a sibling job (poll_positions / sync_funding)
-- claimed in the same batch. The warned analytics job is marked done FIRST while
-- the sibling is still 'running', so mark_compute_job_done's in-RPC bridge takes
-- branch (a) ("any non-terminal job"). Then the sibling is marked done → branch
-- (c). The warning must survive branch (a) (else branch (c) reads 'computing' and
-- resolves to a plain 'complete'). This is the Deribit-population leak the
-- single-job Part 2 cannot surface; it FAILS unless branch (a) preserves.
-- Isolated in a transaction that always rolls back.
-- ==========================================================================
BEGIN;
DO $$
DECLARE
  v_user        uuid := gen_random_uuid();
  v_warn        uuid;
  v_job_ana     uuid := gen_random_uuid();  -- the warned analytics job
  v_job_sib     uuid := gen_random_uuid();  -- a sibling (e.g. poll_positions)
  v_token_ana   uuid := gen_random_uuid();
  v_token_sib   uuid := gen_random_uuid();
  v_status TEXT;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'sync-warn-multi-' || v_user || '@invalid.local');
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'sync-warn-multi') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.strategies (user_id, name)
    VALUES (v_user, 'sync-warn-multi-strat') RETURNING id INTO v_warn;

  -- The analytics runner already wrote the warning.
  INSERT INTO public.strategy_analytics (strategy_id, computation_status)
    VALUES (v_warn, 'complete_with_warnings');

  -- Two strategy-scoped jobs, both still 'running' (claimed in one batch).
  INSERT INTO public.compute_jobs
    (id, kind, strategy_id, status, priority, attempts, next_attempt_at, claim_token)
  VALUES
    (v_job_ana, 'compute_analytics', v_warn, 'running', 'normal', 1, now(), v_token_ana),
    (v_job_sib, 'poll_positions',    v_warn, 'running', 'normal', 1, now(), v_token_sib);

  -- Mark the WARNED analytics job first — sibling is still 'running' → branch (a).
  PERFORM public.mark_compute_job_done(v_job_ana, v_token_ana);

  -- After branch (a) the warning must still be intact (this is the cross-job
  -- regression: a bare 'computing' write here erases it).
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_warn;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'preserve-warnings: sibling-in-flight branch (a) laundered complete_with_warnings to % (cross-job leak)', v_status;
  END IF;

  -- Now the sibling finishes → all done → branch (c) → still preserved.
  PERFORM public.mark_compute_job_done(v_job_sib, v_token_sib);
  SELECT computation_status INTO v_status
    FROM public.strategy_analytics WHERE strategy_id = v_warn;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'preserve-warnings: branch (c) after sibling laundered complete_with_warnings to %', v_status;
  END IF;

  RAISE NOTICE 'Part 3 OK: complete_with_warnings survived cross-job branch (a) + branch (c).';
END $$;
ROLLBACK;
