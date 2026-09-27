-- ==========================================================================
-- Phase 164.9.3 CLAIMPAIR — `[164.9.3-CLAIM-PAIR-23505]`: a due failed_retry
-- compute job and a pending twin of the same (kind, partition) must never make
-- a claim entry point raise 23505.
--
-- WHAT IS UNDER TEST. The three claim entry points, named by symbol AND arity:
--   * public.claim_compute_jobs(integer, text)
--   * public.claim_compute_jobs_with_priority, the 5-arg overload
--     (integer, text, boolean, text[], text[]), the one the worker calls
--   * public.claim_compute_jobs_with_priority, the 2-arg overload
--     (integer, text), which is shadowed by the 5-arg (every call form of it
--     resolves as ambiguous, SQLSTATE 42725, while both exist)
-- against the four partial unique indexes that allow one in-flight row per
-- (kind, partition): compute_jobs_one_inflight_per_kind_api_key,
-- compute_jobs_one_inflight_per_kind_portfolio,
-- compute_jobs_one_inflight_per_kind_strategy (which carves out
-- compute_intro_snapshot) and compute_jobs_one_inflight_per_kind_allocator.
-- failed_retry is outside every index predicate, so a failed_retry row can sit
-- beside a pending twin. On the pre-fix tree, once the retry is due and ranks
-- first in its partition, the claim's batch UPDATE flips it to running beside
-- the pending twin and the index raises 23505. The whole batch aborts, so an
-- unrelated due job on another partition id is not claimed either, and the
-- next tick raises again (the wedge never clears by itself).
--
-- ⛔ EVERY PARTITION ARM ASSERTS BOTH HALVES (RESEARCH Pitfall 1): no error
-- is raised AND the pending twin (due AFTER the retry) IS claimed AND the
-- unrelated due job on the second partition id IS claimed AND the retry is
-- NOT claimed in that tick. A fix that swaps the loud error for a silent
-- wedge (the rejected post-rank guard, CONTEXT D-08: neither the retry nor
-- the twin is ever claimed) still reads RED here.
--
-- HOW. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure. pgTAP is NOT
-- installed (CLAUDE.md). No psql meta-commands. Under psql -v ON_ERROR_STOP=1
-- (the sql-tests mode) the first failed arm exits non-zero; under
-- ON_ERROR_STOP=0 every arm reports (the red-first census mode). Every arm is
-- its own BEGIN ... ROLLBACK, so nothing it seeds or claims outlives it.
--   * Seeding runs under SET LOCAL session_replication_role = replica, so the
--     compute_jobs foreign keys (auth.users, api_keys, portfolios, strategies)
--     need no parent rows; CHECK constraints still apply, so every seed kind
--     satisfies compute_jobs_kind_target_coherence. The role is set back to
--     origin BEFORE any claim call, so the claim runs with every trigger live.
--     Measured permitted for the connection role on BOTH lanes (local-stack
--     and pg-lane) before this file was written (164.9.3-01-SUMMARY, A1).
--   * Every id is gen_random_uuid() at run time, and every count is scoped to
--     the arm's own job ids, never global: claims are queue-wide and the
--     sql-tests lane carries rows other gate files commit.
--   * The claim call sits inside an inner BEGIN ... EXCEPTION WHEN OTHERS
--     block that only captures the SQLSTATE and message; the arm's RAISE
--     comes AFTER that block (lint rule R1), with the trapped SQLSTATE first
--     in its message. An uncaught raw error would name no arm. OTHERS, not
--     only unique_violation, so an arm that fails for another reason (a
--     refused role, an ambiguous overload) still names itself and its
--     SQLSTATE.
--   * Batch size 1000, the cap every claim body's own input check accepts.
--   * Seed kinds per partition: api_key poll_allocator_positions, portfolio
--     compute_portfolio, strategy compute_analytics (never
--     compute_intro_snapshot for a partition arm), allocator
--     derive_allocator_equity.
--   * No completion sentinel is declared, and there is no LANE-ONLY marker:
--     the file uses no dblink and runs in sql-tests as well as on the pg-lane.
--
-- ARMS (file order is this order):
--   C-KEY, C-PF, C-ST, C-AL   claim_compute_jobs, one arm per partition
--                             (api_key, portfolio, strategy, allocator).
--   P5-KEY, P5-PF, P5-ST, P5-AL
--                             the 5-arg priority overload, same four arms,
--                             called in the 3-argument named-default form the
--                             dedupe gate uses.
--   W-LOST    5-arg, allocator partition, the booked repro shape: the twin is
--             due 10 minutes in the FUTURE. Tick 1 claims the unrelated job
--             and not the retry; the twin is made due and tick 2 claims it;
--             the twin is set done and tick 3 claims the retry. No work lost.
--   W-INTRO   5-arg, strategy partition: two pending and one due failed_retry
--             compute_intro_snapshot rows on one strategy are all claimed in
--             one tick. ⚠️ A REGRESSION ARM, NOT A RED-FIRST ARM: it is GREEN
--             on the pre-fix tree by design (CONTEXT D-02: an arm green on
--             today's tree is not a red-first arm). It exists to refuse a
--             post-rank guard that starves the intro carve-out (CONTEXT D-08,
--             measured 0 of 3 claimed under that guard).
--   P2-KEY, P2-PF, P2-ST, P2-AL
--                             the 2-arg priority overload, same four arms.
--   P2-C39    2-arg, api_key partition: tick 1 claims the twin; tick 2, with
--             the twin now running and the retry still due, raises nothing and
--             does NOT claim the retry (the 2-arg body has no C39 guard today).
--   The 2-arg arms are the LAST transactions in the file. Each one drops the
--   5-arg overload by its full signature inside its own transaction, which
--   ends in ROLLBACK, so the 2-arg body is reachable and no other arm ever
--   runs against a dropped overload. Without that drop the pre-fix result of
--   a 2-arg call is 42725, not 23505.
--
-- The twelve partition arms, W-LOST and P2-C39 are RED on the pre-fix tree,
-- each with SQLSTATE 23505; W-INTRO is GREEN there. That census is recorded
-- as verdict + count in 164.9.3-01-SUMMARY.md. The machine-executable mutation
-- twins are added once the migration they edit exists (plan 164.9.3-04).
-- ==========================================================================

-- --------------------------------------------------------------------------
-- C-KEY — claim_compute_jobs, api_key_id partition.
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_part   uuid := gen_random_uuid();
  v_part2  uuid := gen_random_uuid();
  v_retry  uuid := gen_random_uuid();
  v_twin   uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_err    text;
  v_msg    text;
  n_retry  int;
  n_twin   int;
  n_other  int;
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'poll_allocator_positions', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'poll_allocator_positions', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'poll_allocator_positions', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (C-KEY): SQLSTATE % from claim_compute_jobs on a due failed_retry job beside a pending twin of the same (kind, api_key_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another api_key_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C-KEY): claim_compute_jobs raised nothing but the api_key_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'C-KEY OK: claim_compute_jobs claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;
