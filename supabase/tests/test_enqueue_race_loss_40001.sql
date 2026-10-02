-- ==========================================================================
-- Phase 164.9.3.2.1 ENQ40001 — the enqueue race-loss raise answers SQLSTATE
-- 40001, and the re-run converges once the winning job is terminal.
--
-- WHAT IS UNDER TEST. The lost-race branch of the 10-param
-- `_enqueue_compute_job_internal`, latest definition
-- 20260924230827_fanin_initial_status_10param.sql. When the INSERT loses to
-- the partial unique index and the re-read then finds no in-flight row (the
-- winner already advanced to a terminal status), the function raises
-- `enqueue race lost: the winning job already advanced past the in-flight
-- statuses` with ERRCODE `serialization_failure` (40001).
--
-- WHY IT MATTERS. PostgREST 14.x runs every RPC inside a retrying transaction
-- that re-runs the call on SQLSTATE 40001. For this raise that retry is the
-- RIGHT answer: on the re-run the winner is terminal, so the optimistic
-- look-up misses it and the INSERT succeeds. Phase 164.9.3.2.1 plan 01
-- measured it on the lane's PostgREST v14.7: with the race induced once (K=1)
-- the call answered HTTP 200 in 12 ms with shots=2 flips=1; induced three
-- times (K=3) it answered HTTP 200 in 14 ms with shots=4 flips=3; both times
-- the returned id was the single in-flight row. Two DB-side facts carry that
-- convergence, and this file pins both: the raise's code is 40001 (the code
-- PostgREST retries; any other code is returned to the caller once, as an
-- error), and the strategy look-up skips a `done` row (if it matched one, the
-- re-run would hand back a finished job instead of enqueueing a new one).
--
-- WHAT THIS FILE CAN AND CANNOT SEE. psql calls the RPC with no retrying
-- transaction around it, so psql sees ONE raise and no retry. The arms read
-- the SQLSTATE and the re-run's outcome, which is what the gateway's retry
-- rests on, not the retry itself. The PostgREST convergence is recorded in
-- 164.9.3.2.1-01-SUMMARY.md and is deliberately NOT a CI step: it depends on
-- the version of the lane's `rest` image (PostgREST 16 or later returns a
-- 40001 to the client as HTTP 500 instead of retrying it).
--
-- HOW. One in-transaction `BEGIN; DO $$ … $$; ROLLBACK;`, no dblink, no psql
-- meta-commands, so the file runs on BOTH lanes: the pg-lane under
-- sql-mutation and the local Supabase stack under sql-tests. A BEFORE INSERT
-- row trigger, bound by its WHEN clause to this file's own fresh strategy and
-- kind, inserts a competing in-flight row once, so the RPC's INSERT loses to
-- the partial unique index; an AFTER INSERT statement trigger then moves that
-- competitor to `done`, so the RPC's re-read finds nothing in flight and
-- raises. The once-only arming and both counters are SEQUENCES, because a
-- sequence is not rolled back with the inner exception block that captures
-- the raise, so the counts survive for the assertions after it. Every
-- induction object (a schema, two sequences, two trigger functions, two
-- triggers) is created inside this file's own transaction and dies with its
-- ROLLBACK; no table is created. Each call runs in an inner BEGIN/EXCEPTION
-- block that ONLY captures SQLSTATE and SQLERRM; every assertion sits after
-- that block (lint R1).
--
-- ARMS.
--   R1  the induced race raises SQLSTATE 40001, message starting `enqueue
--       race lost`, with exactly one shot fired and one competitor flipped.
--   R2  after the winner is terminal (`done`, seeded AFTER R1 so R2's twin
--       cannot make R1 fail first), the disarmed re-run returns a new,
--       non-NULL id that is not the done row's, the row is `pending`, exactly
--       one row is in flight for the strategy and kind, and shots reads 2.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes: it mutates
-- COPIES on a throwaway pg-lane cluster, requires the FIRST failure identity
-- to name that arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- R1's twin is LAYERED, two steps: (1) the race raise in 20260924230827
-- moved to `55006`, and (2) that migration's self-verify guard (d) for the
-- 10-param body stood down with `IF FALSE THEN`, because the guard refuses a
-- body without the `serialization_failure` raise and would abort the apply
-- before this file ran. Step 2 touches the runner's scratch copy only.
-- R2's twin is one step: the strategy look-up widened to include `done`.
--
-- ⚠️ SETUP. The apply list below is copied byte for byte from
-- supabase/tests/test_enqueue_compute_job_dedupe_non_terminal.sql, which
-- exercises the same RPC; its header carries the reasoning (why
-- 20260924230827 is last, why 20260510173005 is absent).
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","scripts/pg-lane/fixtures/11-fixture-api-keys-created-at.sql","scripts/pg-lane/fixtures/15-fixture-auth-role.sql","scripts/pg-lane/fixtures/20-fixture-app-role-helper.sql","scripts/pg-lane/fixtures/21-fixture-api-keys-credential-columns.sql","scripts/pg-lane/fixtures/23-fixture-contact-requests.sql","scripts/pg-lane/fixtures/24-fixture-enqueue-compute-job-chain.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260416125430_contact_request_metadata.sql","supabase/migrations/20260418194206_scoring_weight_overrides.sql","supabase/migrations/20260420073003_allocator_holdings.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515210300_scoring_weight_overrides_high_hardening.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260525074649_compute_jobs_kind_check_extend_csv.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260716090000_retire_compute_analytics_kind_rpc_guard.sql","supabase/migrations/20260717233529_allocator_equity_derived_surface.sql","supabase/migrations/20260826150000_destrict_enqueue_internal_10param.sql","supabase/migrations/20260924230827_fanin_initial_status_10param.sql"]}

BEGIN;

DO $$
DECLARE
  uid      UUID := gen_random_uuid();
  s_r1     UUID;
  c_kind   CONSTANT TEXT := 'compute_analytics_from_csv';
  v_state  TEXT;
  v_msg    TEXT;
  v_shots  BIGINT;
  v_flips  BIGINT;
  v_done_id  UUID;
  v_new_id   UUID;
  v_status   TEXT;
  v_inflight BIGINT;
BEGIN
  -- ----- SEED (as postgres, before any role switch) ----------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'enq40001-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'enq40001', 'enq40001-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO strategies
    (user_id, name, status, strategy_types, subtypes, markets, supported_exchanges)
  VALUES
    (uid, 'enq40001 race-loss fixture', 'draft', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO s_r1;

  -- ----- INDUCTION (in this transaction only; keyed on s_r1) --------------
  CREATE SCHEMA enq40001_gate;
  CREATE SEQUENCE enq40001_gate.shots;
  CREATE SEQUENCE enq40001_gate.flips;

  -- BEFORE INSERT row trigger: on the FIRST matching insert only, insert a
  -- competing in-flight row, so the RPC's own INSERT hits the partial unique
  -- index and `ON CONFLICT DO NOTHING` returns no id. The depth guard comes
  -- before nextval, so the competitor's own nested insert never fires a shot.
  CREATE FUNCTION enq40001_gate.before_ins() RETURNS trigger
    LANGUAGE plpgsql AS $f$
  BEGIN
    IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
    IF nextval('enq40001_gate.shots') > 1 THEN RETURN NEW; END IF;
    INSERT INTO public.compute_jobs (strategy_id, kind, status, metadata)
    VALUES (NEW.strategy_id, NEW.kind, 'pending',
            jsonb_build_object('enq40001_gate', 'competitor'));
    RETURN NEW;
  END $f$;

  -- AFTER INSERT statement trigger: move this file's competitor (and only it)
  -- to `done`, so the RPC's re-read finds no in-flight row and raises.
  EXECUTE format($ddl$
    CREATE FUNCTION enq40001_gate.after_stmt() RETURNS trigger
      LANGUAGE plpgsql AS $f$
    DECLARE n INT;
    BEGIN
      IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;
      UPDATE public.compute_jobs SET status = 'done'
       WHERE strategy_id = %L::uuid
         AND metadata->>'enq40001_gate' = 'competitor'
         AND status IN ('pending', 'running', 'done_pending_children');
      GET DIAGNOSTICS n = ROW_COUNT;
      IF n > 0 THEN PERFORM nextval('enq40001_gate.flips'); END IF;
      RETURN NULL;
    END $f$
  $ddl$, s_r1);

  EXECUTE format(
    'CREATE TRIGGER enq40001_gate_bi BEFORE INSERT ON public.compute_jobs '
    'FOR EACH ROW WHEN (NEW.strategy_id = %L::uuid AND NEW.kind = %L AND NEW.status <> %L) '
    'EXECUTE FUNCTION enq40001_gate.before_ins()',
    s_r1, c_kind, 'done');
  CREATE TRIGGER enq40001_gate_ai AFTER INSERT ON public.compute_jobs
    FOR EACH STATEMENT EXECUTE FUNCTION enq40001_gate.after_stmt();

  -- ===== ARM R1 — the induced race raises SQLSTATE 40001 =================
  -- Called as csv-finalize calls it: enqueue_compute_job as service_role.
  v_state := NULL; v_msg := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    PERFORM enqueue_compute_job(
      p_strategy_id => s_r1,
      p_kind        => c_kind,
      p_metadata    => jsonb_build_object('fixture', 'enq40001-r1'));
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  RESET ROLE;

  -- A fresh sequence reads last_value 1 before its first nextval, so the
  -- count is 0 unless is_called: "shots = 1" cannot pass on an idle trigger.
  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO v_shots FROM enq40001_gate.shots;
  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO v_flips FROM enq40001_gate.flips;

  -- RED-UNDER: move the race raise in 20260924230827 from
  --            `serialization_failure` to `55006`; LAYERED with the 10-param
  --            self-verify guard (d) stood down. PostgREST 14 retries only
  --            40001, so a lost race would reach csv-finalize as an error
  --            instead of converging on the gateway's re-run.
  -- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"edit","file":"supabase/migrations/20260924230827_fanin_initial_status_10param.sql","find":"    RAISE EXCEPTION 'enqueue race lost: the winning job already advanced past the in-flight statuses'\n      USING ERRCODE = 'serialization_failure';","replace":"    RAISE EXCEPTION 'enqueue race lost: the winning job already advanced past the in-flight statuses'\n      USING ERRCODE = '55006';","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260924230827_fanin_initial_status_10param.sql","find":"  IF v_body10 !~ c_serfail_re THEN","replace":"  IF FALSE THEN","occurrences":1}]}
  IF v_state IS DISTINCT FROM '40001' THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the induced enqueue race raised SQLSTATE % (message: %), expected 40001. PostgREST 14 re-runs a 40001 transaction and the re-run converges; any other code reaches the caller as an error, so a lost race would fail a csv-finalize instead of converging.', v_state, v_msg;
  END IF;
  IF position('enqueue race lost' IN coalesce(v_msg, '')) <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the 40001 raised by the induced race carries message %, expected it to start with "enqueue race lost". A 40001 from anywhere else would mean the induction never reached the lost-race branch.', v_msg;
  END IF;
  IF v_shots <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the race trigger fired % shot(s), expected exactly 1. The arm must lose the race exactly once, or the 40001 above is not the race-loss raise this file pins.', v_shots;
  END IF;
  IF v_flips <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R1): the competitor was moved to done % time(s), expected exactly 1. Without that flip the re-read finds the competitor in flight and returns its id, so the raise is never reached.', v_flips;
  END IF;

  -- ===== ARM R2 — the re-run converges once the winner is terminal ======
  -- The winner's final state, seeded only now: seeded before R1, R2's twin
  -- (look-up widened to `done`) would make R1's call return this row and R1
  -- would fail first. The BEFORE trigger's WHEN excludes status `done`, so
  -- this seed fires no shot and spawns no competitor.
  INSERT INTO compute_jobs (strategy_id, kind, status, metadata)
  VALUES (s_r1, c_kind, 'done', jsonb_build_object('fixture', 'enq40001-r2-winner'))
  RETURNING id INTO v_done_id;
  -- Precondition: without a done row the `v_new_id = v_done_id` check below
  -- compares against NULL and is skipped silently, so R2 would pass with its
  -- premise (the winner is terminal) never set up.
  IF v_done_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2-precondition): the done winner seed inserted no row, so R2 cannot test that the re-run skips a done job.';
  END IF;

  -- The re-run PostgREST 14 makes after the 40001, here made by hand. The
  -- single shot was spent in R1, so this call runs disarmed.
  v_state := NULL; v_msg := NULL; v_new_id := NULL;
  SET LOCAL ROLE service_role;
  BEGIN
    v_new_id := enqueue_compute_job(
      p_strategy_id => s_r1,
      p_kind        => c_kind,
      p_metadata    => jsonb_build_object('fixture', 'enq40001-r2'));
  EXCEPTION WHEN OTHERS THEN
    v_state := SQLSTATE; v_msg := SQLERRM;
  END;
  RESET ROLE;

  SELECT status INTO v_status FROM compute_jobs WHERE id = v_new_id;
  SELECT count(*) INTO v_inflight
    FROM compute_jobs
   WHERE strategy_id = s_r1
     AND kind = c_kind
     AND status IN ('pending', 'running', 'done_pending_children');
  SELECT CASE WHEN is_called THEN last_value ELSE 0 END INTO v_shots FROM enq40001_gate.shots;

  -- RED-UNDER: widen the strategy-scoped optimistic look-up in 20260924230827
  --            to `status IN ('pending', 'running', 'done_pending_children',
  --            'done')`. The re-run then matches the finished winner and hands
  --            back its id, so the call PostgREST 14 retries "converges" on a
  --            job that will never run and no analytics are computed.
  -- RED-UNDER-M: {"arm":"R2","apply":[{"kind":"edit","file":"supabase/migrations/20260924230827_fanin_initial_status_10param.sql","find":"    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children')","replace":"    SELECT id INTO v_existing_id\n      FROM compute_jobs\n     WHERE strategy_id = p_strategy_id\n       AND kind = p_kind\n       AND status IN ('pending', 'running', 'done_pending_children', 'done')","occurrences":1}]}
  IF v_state IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the re-run after the winner reached done raised SQLSTATE % (message: %), expected it to enqueue. PostgREST 14''s retry of the race-loss 40001 converges only if this call succeeds.', v_state, v_msg;
  END IF;
  IF v_new_id IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the re-run after the winner reached done returned a NULL job id, expected a new one. csv-finalize reads that id back; NULL means no job was enqueued.';
  END IF;
  IF v_new_id = v_done_id THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the re-run returned the finished winner''s id %, expected a new job. The look-up matched a done row, so the converged call points at a job that will never run.', v_new_id;
  END IF;
  IF v_status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the job the re-run returned has status %, expected pending. A strategy-scoped job with no parent must start pending, or the worker never claims it.', v_status;
  END IF;
  IF v_inflight <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (R2): % in-flight compute_analytics_from_csv row(s) exist for the fixture strategy after the re-run, expected exactly 1. The convergence must leave one live job, not none and not a duplicate.', v_inflight;
  END IF;
  IF v_shots <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (R2): the race trigger counted % shot(s) after the re-run, expected 2 (R1''s armed shot plus this disarmed call). Any other count means the re-run did not go through the INSERT this arm reads.', v_shots;
  END IF;

  RAISE NOTICE 'ALL 2 ARMS EXECUTED (R1, R2) and passed — R1: the induced enqueue race raises SQLSTATE 40001 with the race-lost message, the code PostgREST 14 re-runs; R2: once the winner is done, the re-run enqueues a new pending job (not the done one), leaving exactly one in flight, so that retry converges.';
END $$;

ROLLBACK;
