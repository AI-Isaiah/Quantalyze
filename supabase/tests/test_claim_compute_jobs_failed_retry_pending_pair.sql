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
--   * Seeding runs under SET LOCAL session_replication_role = replica
--     (measured permitted for the connection role on BOTH lanes, local-stack
--     and pg-lane, before this file was written: 164.9.3-01-SUMMARY, A1), and
--     the role is set back to origin BEFORE any claim call, so the claim runs
--     with every compute_jobs trigger live. Each arm seeds a real PARENT row
--     for every partition id it uses (auth.users for allocator, api_keys,
--     portfolios, strategies), with only the parent's NOT NULL columns. The
--     parents are needed although the replica role skips the seed's own
--     foreign-key checks: PostgreSQL re-checks a foreign key on an UPDATE of a
--     row inserted in the same transaction even when the key is unchanged, so
--     the claim's own UPDATE would raise 23503 against a missing parent
--     (measured on the local-stack lane, 164.9.3-01-SUMMARY). Seeding the
--     parents under the replica role fires none of their own triggers, so no
--     parent insert enqueues a job onto an arm's partition. CHECK constraints
--     still apply, so every seed kind satisfies
--     compute_jobs_kind_target_coherence.
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
-- ARMS (file order is this order). Every arm carries a LAYERED RED-UNDER-M
-- twin in its own section banner: a production edit to ONE body of the phase
-- migration plus the stand-down (`IF FALSE AND NOT ...`) of the migration's
-- own self-verify anchor that edit breaks, or its DO block would abort the
-- apply. One body and one partition per twin is what keeps every arm above
-- a twin's own arm green, so its first raise is its own.
--   C-KEY, C-PF, C-ST, C-AL   claim_compute_jobs, one arm per partition
--                             (api_key, portfolio, strategy, allocator).
--                             Twin: that partition's pre-rank clause made
--                             always true (`OR TRUE`) in claim_compute_jobs
--                             (match 1 of 3) + v_ccj_<partition>_anchored.
--   P5-KEY, P5-PF, P5-ST, P5-AL
--                             the 5-arg priority overload, same four arms,
--                             called in the 3-argument named-default form the
--                             dedupe gate uses. Twin: the same `OR TRUE` edit
--                             in the 5-arg body (match 2 of 3) +
--                             v_p5_<partition>_anchored.
--   W-LOST    5-arg, allocator partition, the booked repro shape: the twin is
--             due 10 minutes in the FUTURE. Tick 1 claims the unrelated job
--             and not the retry; the twin is made due and tick 2 claims it;
--             the twin is set done and tick 3 claims the retry. No work lost.
--             Twin: the 5-arg allocator clause's sibling test widened to
--             IN ('pending', 'done'), so tick 3 never claims the retry.
--   W-INTRO   5-arg, strategy partition: two pending and one due failed_retry
--             compute_intro_snapshot rows on one strategy are all claimed in
--             one tick. ⚠️ A REGRESSION ARM, NOT A RED-FIRST ARM: it is GREEN
--             on the pre-fix tree by design (CONTEXT D-02: an arm green on
--             today's tree is not a red-first arm). It exists to refuse a
--             post-rank guard that starves the intro carve-out (CONTEXT D-08,
--             measured 0 of 3 claimed under that guard). Twin: the
--             `OR kind = 'compute_intro_snapshot'` carve-out deleted from
--             the 5-arg strategy clause (2 of 3 claimed).
--   W-LOWTWIN 5-arg, allocator partition, priority mix: a due `normal`
--             failed_retry beside a due `low` pending twin, plus an unrelated
--             due `low` job on another allocator. The twin and the unrelated
--             job must be claimed and the retry held back. Added in review
--             round 1 (164.9.3-REVIEW.md WR-01): the throttle probe counted
--             the retry the pre-rank clause holds back, so neither row was
--             ever claimed and every due `low` job queue-wide was throttled,
--             with no error (a silent permanent wedge).
--   P2-KEY, P2-PF, P2-ST, P2-AL
--                             the 2-arg priority overload, same four arms.
--                             Twin: the `OR TRUE` edit in the 2-arg body
--                             (match 3 of 3) + v_p2_<partition>_anchored.
--   P2-C39    2-arg, api_key partition: tick 1 claims the twin; tick 2, with
--             the twin now running and the retry still due, raises nothing and
--             does NOT claim the retry (the pre-fix 2-arg body had no C39
--             guard). Twin: the ported api_key_id C39 clause deleted from the
--             2-arg `deduped` + v_p2_c39_anchored.
--   The 2-arg arms are the LAST transactions in the file. Each one drops the
--   5-arg overload by its full signature inside its own transaction, which
--   ends in ROLLBACK, so the 2-arg body is reachable and no other arm ever
--   runs against a dropped overload. Without that drop the pre-fix result of
--   a 2-arg call is 42725, not 23505.
--
-- The twelve partition arms, W-LOST and P2-C39 are RED on the pre-fix tree,
-- each with SQLSTATE 23505; W-INTRO is GREEN there. That census is recorded
-- as verdict + count in 164.9.3-01-SUMMARY.md. W-LOWTWIN came later: it is
-- RED against the migration as plan 02 shipped it (no error; the twin, the
-- unrelated job and the retry each claimed 0 times), recorded as verdict +
-- count in 164.9.3-REVIEW-FIX.md. The machine-executable mutation
-- twins were added once the migration they edit existed (plan 164.9.3-04);
-- scripts/mutation-runner executes each on a throwaway pg-lane, mutating
-- COPIES, and requires the FIRST `TEST FAILED` to name that twin's arm.
--
-- PG-LANE SUBSTRATE (the apply list below, read by scripts/pg-lane/run.sh and
-- the mutation runner). It is test_enqueue_compute_job_dedupe_non_terminal.sql's
-- list (the compute_jobs base 20260411144407, fixture 04, the
-- one-in-flight index sources, the kind CHECK and coherence CHECK sources),
-- plus fixture 29 (compute_jobs.priority, read by both priority overloads) and
-- fixture 36-fixture-compute-jobs-claim-token.sql (compute_jobs.claim_token,
-- written by claim_compute_jobs and the 5-arg), with the phase migration LAST: it
-- CREATE OR REPLACEs all three claim bodies, so no older claim migration is
-- applied, and every twin mutates the body this file then calls.
-- ⛔ 20260515114555_compute_jobs_claim_token_fencing.sql is deliberately
-- ABSENT: its bare COMMENT ON FUNCTION claim_compute_jobs_with_priority aborts
-- with 42725 wherever two overloads exist (fixture 29's header).
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql","scripts/pg-lane/fixtures/29-fixture-compute-jobs-priority.sql","scripts/pg-lane/fixtures/36-fixture-compute-jobs-claim-token.sql","supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql"]}
-- ==========================================================================

-- --------------------------------------------------------------------------
-- C-KEY — claim_compute_jobs, api_key_id partition.
-- RED-UNDER: make the api_key_id pre-rank clause of claim_compute_jobs always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 1 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, api_key_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_ccj_api_key_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"C-KEY","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (api_key_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (api_key_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_ccj_api_key_anchored THEN","replace":"IF FALSE AND NOT v_ccj_api_key_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_part, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc'),
           (v_part2, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc');
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'poll_allocator_positions', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'poll_allocator_positions', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'poll_allocator_positions', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
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

-- --------------------------------------------------------------------------
-- C-PF — claim_compute_jobs, portfolio partition.
-- RED-UNDER: make the portfolio_id pre-rank clause of claim_compute_jobs always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 1 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, portfolio_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_ccj_portfolio_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"C-PF","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (portfolio_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (portfolio_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_ccj_portfolio_anchored THEN","replace":"IF FALSE AND NOT v_ccj_portfolio_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.portfolios (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate'),
           (v_part2, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, portfolio_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'compute_portfolio', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'compute_portfolio', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'compute_portfolio', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
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
    RAISE EXCEPTION 'TEST FAILED (C-PF): SQLSTATE % from claim_compute_jobs on a due failed_retry job beside a pending twin of the same (kind, portfolio_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another portfolio_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C-PF): claim_compute_jobs raised nothing but the portfolio_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'C-PF OK: claim_compute_jobs claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- C-ST — claim_compute_jobs, strategy partition.
-- RED-UNDER: make the strategy_id pre-rank clause of claim_compute_jobs always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 1 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, strategy_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_ccj_strategy_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"C-ST","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR NOT EXISTS (","replace":"AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_ccj_strategy_anchored THEN","replace":"IF FALSE AND NOT v_ccj_strategy_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.strategies (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate'),
           (v_part2, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'compute_analytics', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'compute_analytics', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'compute_analytics', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
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
    RAISE EXCEPTION 'TEST FAILED (C-ST): SQLSTATE % from claim_compute_jobs on a due failed_retry job beside a pending twin of the same (kind, strategy_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another strategy_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C-ST): claim_compute_jobs raised nothing but the strategy_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'C-ST OK: claim_compute_jobs claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- C-AL — claim_compute_jobs, allocator partition.
-- RED-UNDER: make the allocator_id pre-rank clause of claim_compute_jobs always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 1 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, allocator_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_ccj_allocator_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"C-AL","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (allocator_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (allocator_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_ccj_allocator_anchored THEN","replace":"IF FALSE AND NOT v_ccj_allocator_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO auth.users (id)
    VALUES (v_part), (v_part2);
  INSERT INTO public.compute_jobs (id, kind, allocator_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'derive_allocator_equity', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'derive_allocator_equity', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'derive_allocator_equity', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
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
    RAISE EXCEPTION 'TEST FAILED (C-AL): SQLSTATE % from claim_compute_jobs on a due failed_retry job beside a pending twin of the same (kind, allocator_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another allocator_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (C-AL): claim_compute_jobs raised nothing but the allocator_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'C-AL OK: claim_compute_jobs claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P5-KEY — the 5-arg claim_compute_jobs_with_priority, api_key_id partition.
-- RED-UNDER: make the api_key_id pre-rank clause of the 5-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 2 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, api_key_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p5_api_key_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P5-KEY","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (api_key_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (api_key_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":2},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p5_api_key_anchored THEN","replace":"IF FALSE AND NOT v_p5_api_key_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_part, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc'),
           (v_part2, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc');
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'poll_allocator_positions', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'poll_allocator_positions', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'poll_allocator_positions', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P5-KEY): SQLSTATE % from the 5-arg claim_compute_jobs_with_priority on a due failed_retry job beside a pending twin of the same (kind, api_key_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another api_key_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P5-KEY): the 5-arg claim_compute_jobs_with_priority raised nothing but the api_key_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P5-KEY OK: the 5-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P5-PF — the 5-arg claim_compute_jobs_with_priority, portfolio partition.
-- RED-UNDER: make the portfolio_id pre-rank clause of the 5-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 2 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, portfolio_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p5_portfolio_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P5-PF","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (portfolio_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (portfolio_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":2},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p5_portfolio_anchored THEN","replace":"IF FALSE AND NOT v_p5_portfolio_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.portfolios (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate'),
           (v_part2, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, portfolio_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'compute_portfolio', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'compute_portfolio', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'compute_portfolio', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P5-PF): SQLSTATE % from the 5-arg claim_compute_jobs_with_priority on a due failed_retry job beside a pending twin of the same (kind, portfolio_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another portfolio_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P5-PF): the 5-arg claim_compute_jobs_with_priority raised nothing but the portfolio_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P5-PF OK: the 5-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P5-ST — the 5-arg claim_compute_jobs_with_priority, strategy partition.
-- RED-UNDER: make the strategy_id pre-rank clause of the 5-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 2 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, strategy_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p5_strategy_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P5-ST","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR NOT EXISTS (","replace":"AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":2},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p5_strategy_anchored THEN","replace":"IF FALSE AND NOT v_p5_strategy_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.strategies (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate'),
           (v_part2, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'compute_analytics', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'compute_analytics', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'compute_analytics', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P5-ST): SQLSTATE % from the 5-arg claim_compute_jobs_with_priority on a due failed_retry job beside a pending twin of the same (kind, strategy_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another strategy_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P5-ST): the 5-arg claim_compute_jobs_with_priority raised nothing but the strategy_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P5-ST OK: the 5-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P5-AL — the 5-arg claim_compute_jobs_with_priority, allocator partition.
-- RED-UNDER: make the allocator_id pre-rank clause of the 5-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 2 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, allocator_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p5_allocator_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P5-AL","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (allocator_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (allocator_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":2},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p5_allocator_anchored THEN","replace":"IF FALSE AND NOT v_p5_allocator_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO auth.users (id)
    VALUES (v_part), (v_part2);
  INSERT INTO public.compute_jobs (id, kind, allocator_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'derive_allocator_equity', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'derive_allocator_equity', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'derive_allocator_equity', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P5-AL): SQLSTATE % from the 5-arg claim_compute_jobs_with_priority on a due failed_retry job beside a pending twin of the same (kind, allocator_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another allocator_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P5-AL): the 5-arg claim_compute_jobs_with_priority raised nothing but the allocator_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P5-AL OK: the 5-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- W-LOST — the 5-arg claim_compute_jobs_with_priority, allocator partition: the booked repro shape (the twin
-- is due in the FUTURE), then the twin runs, then the retry runs. No work is
-- lost: every seeded job is claimed exactly once, in that order.
-- RED-UNDER: widen the sibling test of the 5-arg allocator_id pre-rank clause
--            in 20260927120000_claim_pair_pre_rank_exclusion.sql from `= 'pending'` to
--            `IN ('pending', 'done')` (match 2 of 3). Ticks 1 and 2 behave
--            as before (the twin is pending, then running), but at tick 3 the
--            finished twin still counts as a sibling, so the retry is never
--            claimed: the work is lost and tick 3's count is this arm's first
--            raise. P5-AL has no finished row, so it stays green. ⚠️ LAYERED:
--            v_p5_allocator_anchored is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"W-LOST","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND x.allocator_id = compute_jobs.allocator_id\n           AND x.status       = 'pending'))","replace":"AND x.allocator_id = compute_jobs.allocator_id\n           AND x.status       IN ('pending', 'done')))","occurrences":3,"nth":2},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p5_allocator_anchored THEN","replace":"IF FALSE AND NOT v_p5_allocator_anchored THEN","occurrences":1}]}
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO auth.users (id)
    VALUES (v_part), (v_part2);
  INSERT INTO public.compute_jobs (id, kind, allocator_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'derive_allocator_equity', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'derive_allocator_equity', v_part,  'pending',      0, now() + interval '10 minutes'),
           (v_other, 'derive_allocator_equity', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  -- Tick 1: only the retry and the unrelated job are due.
  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOST): SQLSTATE % at tick 1 from the 5-arg claim_compute_jobs_with_priority on a due failed_retry job beside a not-yet-due pending twin of the same (kind, allocator_id) (%). The whole batch aborted, so the unrelated due job on another allocator_id was not claimed.', v_err, v_msg;
  END IF;
  IF n_other <> 1 OR n_retry <> 0 OR n_twin <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOST): tick 1 claimed the unrelated due job % time(s), the failed_retry % time(s) and the not-yet-due twin % time(s); expected 1, 0 and 0.', n_other, n_retry, n_twin;
  END IF;

  -- Tick 2: the twin falls due and must be claimed; the retry still waits.
  UPDATE public.compute_jobs SET next_attempt_at = now() - interval '1 minute' WHERE id = v_twin;
  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOST): SQLSTATE % at tick 2 from the 5-arg claim_compute_jobs_with_priority once the pending twin fell due (%).', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOST): tick 2 claimed the now-due pending twin % time(s) and the failed_retry % time(s); expected 1 and 0. The twin was lost or the retry jumped it.', n_twin, n_retry;
  END IF;

  -- Tick 3: the twin finished; the retry must now run.
  UPDATE public.compute_jobs SET status = 'done' WHERE id = v_twin;
  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOST): SQLSTATE % at tick 3 from the 5-arg claim_compute_jobs_with_priority after the twin finished (%).', v_err, v_msg;
  END IF;
  IF n_retry <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOST): tick 3 claimed the failed_retry % time(s) after its twin finished; expected 1. The retry was lost.', n_retry;
  END IF;
  RAISE NOTICE 'W-LOST OK: tick 1 claimed the unrelated job, tick 2 the twin, tick 3 the retry; nothing raised, nothing lost.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- W-INTRO — the 5-arg claim_compute_jobs_with_priority, strategy partition, compute_intro_snapshot.
-- ⚠️ REGRESSION ARM: GREEN on the pre-fix tree by design (see the header).
-- compute_jobs_one_inflight_per_kind_strategy does not cover this kind, so
-- two pending intro rows and a due failed_retry intro row may share a
-- strategy and must all be claimed in one tick. A post-rank guard that also
-- skips on a pending sibling starves all three (CONTEXT D-08).
-- RED-UNDER: delete `OR kind = 'compute_intro_snapshot'` from the 5-arg
--            strategy_id pre-rank clause in 20260927120000_claim_pair_pre_rank_exclusion.sql
--            (match 2 of 3). The due failed_retry intro row now sees
--            its pending intro siblings and is held back, so 2 of the 3 rows
--            are claimed and this arm's count is its first raise. P5-ST seeds
--            compute_analytics, which the carve-out never covered, so it stays
--            green. ⚠️ LAYERED: v_p5_strategy_anchored (its regex pins the
--            carve-out) is stood down in the same mutation.
-- RED-UNDER-M: {"arm":"W-INTRO","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"OR kind = 'compute_intro_snapshot' OR NOT EXISTS (","replace":"OR NOT EXISTS (","occurrences":3,"nth":2},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p5_strategy_anchored THEN","replace":"IF FALSE AND NOT v_p5_strategy_anchored THEN","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DO $$
DECLARE
  v_part   uuid := gen_random_uuid();
  v_i1     uuid := gen_random_uuid();
  v_i2     uuid := gen_random_uuid();
  v_iretry uuid := gen_random_uuid();
  v_err    text;
  v_msg    text;
  n_claim  int;
BEGIN
  SET LOCAL session_replication_role = replica;
  -- Parent row: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.strategies (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, attempts, next_attempt_at)
    VALUES (v_iretry, 'compute_intro_snapshot', v_part, 'failed_retry', 1, now() - interval '10 minutes'),
           (v_i1,     'compute_intro_snapshot', v_part, 'pending',      0, now() - interval '5 minutes'),
           (v_i2,     'compute_intro_snapshot', v_part, 'pending',      0, now() - interval '3 minutes');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id IN (v_i1, v_i2, v_iretry))
      INTO n_claim
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W-INTRO): SQLSTATE % from the 5-arg claim_compute_jobs_with_priority on two pending and one due failed_retry compute_intro_snapshot rows of one strategy (%).', v_err, v_msg;
  END IF;
  IF n_claim <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (W-INTRO): the 5-arg claim_compute_jobs_with_priority claimed % of the 3 compute_intro_snapshot rows sharing one strategy; expected 3. The intro carve-out is starved.', n_claim;
  END IF;
  RAISE NOTICE 'W-INTRO OK: all 3 compute_intro_snapshot rows sharing one strategy were claimed in one tick.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- W-LOWTWIN — the 5-arg claim_compute_jobs_with_priority, allocator partition,
-- priority mix. R is a due `normal` failed_retry and T a due `low` pending
-- twin of the same (kind, allocator_id); U is an unrelated due `low` pending
-- job on another allocator. The pre-rank clause holds R back, so R must not
-- trip the `normal`/`high` throttle either: T and U are claimed, R is not.
-- The throttle probe is queue-wide and the sql-tests lane carries rows other
-- gate files commit, so any foreign due `normal`/`high` row is pushed a
-- century out first, inside this arm's own transaction (it ends in
-- ROLLBACK), so the probe sees only this arm's rows.
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
  UPDATE public.compute_jobs
     SET next_attempt_at = now() + interval '100 years'
   WHERE priority IN ('normal', 'high')
     AND status IN ('pending', 'failed_retry')
     AND next_attempt_at <= now();
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO auth.users (id)
    VALUES (v_part), (v_part2);
  INSERT INTO public.compute_jobs (id, kind, allocator_id, status, priority, attempts, next_attempt_at)
    VALUES (v_retry, 'derive_allocator_equity', v_part,  'failed_retry', 'normal', 1, now() - interval '10 minutes'),
           (v_twin,  'derive_allocator_equity', v_part,  'pending',      'low',    0, now() - interval '5 minutes'),
           (v_other, 'derive_allocator_equity', v_part2, 'pending',      'low',    0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate', NULL) c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOWTWIN): SQLSTATE % from the 5-arg claim_compute_jobs_with_priority (%); the batch aborted.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (W-LOWTWIN): the 5-arg claim_compute_jobs_with_priority raised nothing but claimed the low pending twin % time(s), the unrelated low job % time(s) and the normal failed_retry % time(s); expected 1, 1 and 0. The throttle counted a retry the pre-rank clause holds back, so the partition and every due low job are wedged silently.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'W-LOWTWIN OK: the 5-arg claim_compute_jobs_with_priority claimed the low pending twin and the unrelated low job, held the normal failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P2-KEY — the 2-arg claim_compute_jobs_with_priority, api_key_id partition.
-- RED-UNDER: make the api_key_id pre-rank clause of the 2-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 3 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, api_key_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p2_api_key_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P2-KEY","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (api_key_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (api_key_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":3},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p2_api_key_anchored THEN","replace":"IF FALSE AND NOT v_p2_api_key_anchored THEN","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DROP FUNCTION public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]);
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_part, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc'),
           (v_part2, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc');
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'poll_allocator_positions', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'poll_allocator_positions', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'poll_allocator_positions', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P2-KEY): SQLSTATE % from the 2-arg claim_compute_jobs_with_priority (the 5-arg overload dropped inside this transaction) on a due failed_retry job beside a pending twin of the same (kind, api_key_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another api_key_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P2-KEY): the 2-arg claim_compute_jobs_with_priority raised nothing but the api_key_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P2-KEY OK: the 2-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P2-PF — the 2-arg claim_compute_jobs_with_priority, portfolio partition.
-- RED-UNDER: make the portfolio_id pre-rank clause of the 2-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 3 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, portfolio_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p2_portfolio_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P2-PF","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (portfolio_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (portfolio_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":3},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p2_portfolio_anchored THEN","replace":"IF FALSE AND NOT v_p2_portfolio_anchored THEN","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DROP FUNCTION public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]);
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.portfolios (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate'),
           (v_part2, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, portfolio_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'compute_portfolio', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'compute_portfolio', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'compute_portfolio', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P2-PF): SQLSTATE % from the 2-arg claim_compute_jobs_with_priority (the 5-arg overload dropped inside this transaction) on a due failed_retry job beside a pending twin of the same (kind, portfolio_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another portfolio_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P2-PF): the 2-arg claim_compute_jobs_with_priority raised nothing but the portfolio_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P2-PF OK: the 2-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P2-ST — the 2-arg claim_compute_jobs_with_priority, strategy partition.
-- RED-UNDER: make the strategy_id pre-rank clause of the 2-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 3 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, strategy_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p2_strategy_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P2-ST","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR NOT EXISTS (","replace":"AND (strategy_id IS NULL OR status <> 'failed_retry' OR kind = 'compute_intro_snapshot' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":3},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p2_strategy_anchored THEN","replace":"IF FALSE AND NOT v_p2_strategy_anchored THEN","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DROP FUNCTION public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]);
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.strategies (id, user_id, name)
    VALUES (v_part, gen_random_uuid(), 'claimpair-gate'),
           (v_part2, gen_random_uuid(), 'claimpair-gate');
  INSERT INTO public.compute_jobs (id, kind, strategy_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'compute_analytics', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'compute_analytics', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'compute_analytics', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P2-ST): SQLSTATE % from the 2-arg claim_compute_jobs_with_priority (the 5-arg overload dropped inside this transaction) on a due failed_retry job beside a pending twin of the same (kind, strategy_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another strategy_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P2-ST): the 2-arg claim_compute_jobs_with_priority raised nothing but the strategy_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P2-ST OK: the 2-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P2-AL — the 2-arg claim_compute_jobs_with_priority, allocator partition.
-- RED-UNDER: make the allocator_id pre-rank clause of the 2-arg claim_compute_jobs_with_priority always
--            true (`OR TRUE` before its NOT EXISTS) in 20260927120000_claim_pair_pre_rank_exclusion.sql,
--            match 3 of 3 (body order claim_compute_jobs, 5-arg, 2-arg).
--            The due failed_retry is a candidate again, ranks first in its
--            (kind, allocator_id) partition, is flipped to running beside its
--            pending twin and the batch raises 23505: this arm's first raise.
--            Only this body and this partition change, so every arm above
--            stays green. ⚠️ LAYERED: the migration's own
--            v_p2_allocator_anchored check would abort the apply, so it is
--            stood down (`IF FALSE AND NOT ...`) in the same mutation.
-- RED-UNDER-M: {"arm":"P2-AL","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"AND (allocator_id IS NULL OR status <> 'failed_retry' OR NOT EXISTS (","replace":"AND (allocator_id IS NULL OR status <> 'failed_retry' OR TRUE OR NOT EXISTS (","occurrences":3,"nth":3},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p2_allocator_anchored THEN","replace":"IF FALSE AND NOT v_p2_allocator_anchored THEN","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DROP FUNCTION public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]);
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO auth.users (id)
    VALUES (v_part), (v_part2);
  INSERT INTO public.compute_jobs (id, kind, allocator_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'derive_allocator_equity', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'derive_allocator_equity', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'derive_allocator_equity', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P2-AL): SQLSTATE % from the 2-arg claim_compute_jobs_with_priority (the 5-arg overload dropped inside this transaction) on a due failed_retry job beside a pending twin of the same (kind, allocator_id) (%). The whole batch aborted, so neither the twin nor an unrelated due job on another allocator_id was claimed.', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_other <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P2-AL): the 2-arg claim_compute_jobs_with_priority raised nothing but the allocator_id partition is wedged silently: pending twin claimed % time(s), unrelated due job % time(s), failed_retry % time(s); expected 1, 1 and 0.', n_twin, n_other, n_retry;
  END IF;
  RAISE NOTICE 'P2-AL OK: the 2-arg claim_compute_jobs_with_priority claimed the pending twin and the unrelated job, held the failed_retry back, raised nothing.';
END $$;
ROLLBACK;

-- --------------------------------------------------------------------------
-- P2-C39 — the 2-arg claim_compute_jobs_with_priority, api_key_id partition, second tick: once the twin is
-- running, the still-due retry must neither raise nor be claimed (the C39
-- running / done_pending_children guard, which the 2-arg body lacks today).
-- RED-UNDER: delete the api_key_id clause of the C39 guard ported into the
--            2-arg `deduped` CTE in 20260927120000_claim_pair_pre_rank_exclusion.sql (the needle
--            ends at the CLAIMPAIR C39 PORT END marker, so it matches 1).
--            Tick 1 is unchanged (no running row yet); at tick 2 the twin is
--            running, the pre-rank clause no longer sees a pending sibling, and
--            the still-due retry is flipped to running beside it: 23505 is
--            this arm's first raise. P2-KEY is one tick with no running row,
--            so it stays green. ⚠️ LAYERED: v_p2_c39_anchored is stood down in
--            the same mutation.
-- RED-UNDER-M: {"arm":"P2-C39","apply":[{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"      AND (api_key_id IS NULL OR NOT EXISTS (\n        SELECT 1 FROM compute_jobs x\n         WHERE x.kind       = ranked.kind\n           AND x.api_key_id = ranked.api_key_id\n           AND x.status IN ('running', 'done_pending_children')\n      ))\n      -- CLAIMPAIR C39 PORT END","replace":"      -- CLAIMPAIR C39 PORT END","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260927120000_claim_pair_pre_rank_exclusion.sql","find":"IF NOT v_p2_c39_anchored THEN","replace":"IF FALSE AND NOT v_p2_c39_anchored THEN","occurrences":1}]}
-- --------------------------------------------------------------------------
BEGIN;
DROP FUNCTION public.claim_compute_jobs_with_priority(integer, text, boolean, text[], text[]);
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
  -- Parent rows: the claim's UPDATE re-checks the foreign key of a row
  -- inserted in this transaction (see the header).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_part, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc'),
           (v_part2, gen_random_uuid(), 'okx', 'claimpair-gate', 'enc');
  INSERT INTO public.compute_jobs (id, kind, api_key_id, status, attempts, next_attempt_at)
    VALUES (v_retry, 'poll_allocator_positions', v_part,  'failed_retry', 1, now() - interval '10 minutes'),
           (v_twin,  'poll_allocator_positions', v_part,  'pending',      0, now() - interval '5 minutes'),
           (v_other, 'poll_allocator_positions', v_part2, 'pending',      0, now() - interval '1 minute');
  SET LOCAL session_replication_role = origin;

  -- Tick 1: the twin is claimed, the retry held back.
  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P2-C39): SQLSTATE % at tick 1 from the 2-arg claim_compute_jobs_with_priority (the 5-arg overload dropped inside this transaction) on a due failed_retry job beside a pending twin of the same (kind, api_key_id) (%).', v_err, v_msg;
  END IF;
  IF n_twin <> 1 OR n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P2-C39): tick 1 claimed the pending twin % time(s) and the failed_retry % time(s); expected 1 and 0.', n_twin, n_retry;
  END IF;

  -- Tick 2: the twin is running and the retry is still due.
  v_err := NULL; v_msg := NULL;
  BEGIN
    SELECT count(*) FILTER (WHERE c.id = v_retry),
           count(*) FILTER (WHERE c.id = v_twin),
           count(*) FILTER (WHERE c.id = v_other)
      INTO n_retry, n_twin, n_other
      FROM public.claim_compute_jobs_with_priority(1000, 'claimpair-gate') c;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (P2-C39): SQLSTATE % at tick 2 from the 2-arg claim_compute_jobs_with_priority with the twin running and the failed_retry still due (%).', v_err, v_msg;
  END IF;
  IF n_retry <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (P2-C39): tick 2 claimed the failed_retry % time(s) beside its running twin; expected 0.', n_retry;
  END IF;
  RAISE NOTICE 'P2-C39 OK: tick 1 claimed the twin, tick 2 held the retry back beside the running twin, nothing raised.';
END $$;
ROLLBACK;
