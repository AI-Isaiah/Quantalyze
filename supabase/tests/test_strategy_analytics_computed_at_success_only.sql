-- Test: strategy_analytics.computed_at moves ONLY on a successful write. A job
-- START and a FAILURE both leave it where it was. A real finish still stamps it.
-- Guards migration 20261013120000_strategy_analytics_hold_computed_at_until_success.sql
-- (Phase 166.3.1 NAVBREACH, plan 02; founder decisions D-04 and D-05, 2026-10-07).
--
-- What this gate is for
-- ---------------------
-- Analytics freshness is read from computed_at (the factsheet FreshnessChip and
-- the portfolio PDF vintage). Python never writes that column on a failure; the
-- SQL status bridge does. Its branch (b) stamps computed_at = now() when a job
-- resolves to failed (D-04: a failed stitch_composite made a stale composite read
-- as just recomputed), and its branch (a) stamps it when a job starts and the
-- row moves to computing (D-05). The migration binds the TABLE instead of the
-- bridge: a BEFORE UPDATE trigger restores OLD.computed_at whenever the new
-- status is failed or computing. So this gate drives the REAL RPCs and the real
-- bridge on a real cluster and reads strategy_analytics back; inspecting the
-- trigger body would prove nothing about what the bridge writes through it.
--
-- Arms (the order is load-bearing: each RED-UNDER-M twin must leave every
-- EARLIER arm green, so its own arm is the first failure):
--   0   applied-ness   the trigger is in the catalog, enabled, BEFORE UPDATE ROW
--                      only, calls the function, and the function is not
--                      executable by anon or authenticated.
--   C1  success control a `complete` row with a 30-day-old computed_at and a
--                      RUNNER-SHAPED success write (INSERT ... ON CONFLICT DO UPDATE
--                      with computed_at = the database clock and status complete,
--                      the statement the analytics runner emits since Phase 166.5):
--                      computed_at MOVES. Without C1 a trigger that holds on EVERY
--                      update passes every arm below. C1 passes on a tree without the
--                      migration BY DESIGN (it asserts behaviour that must not change);
--                      its RED is its twin. It used to drive mark_compute_job_done,
--                      back when the bridge stamped the date; the bridge writes none now
--                      (a write and its author look the same inside one transaction,
--                      where now() is constant, so C1 proves "a success write moves the
--                      date", never "who wrote it").
--   F1  D-04 headline  a complete_with_warnings row, same fixture, resolved by
--                      mark_compute_job_failed(..., 'permanent', ...) through
--                      branch (b): the row reads failed and computed_at equals
--                      the seed to the microsecond. Its EDGE block: a strategy
--                      with no analytics row gets one from the bridge's INSERT
--                      arm, and that first row still takes the column default.
--   A1  D-05, complete origin  a plain complete row and a PENDING stitch_composite
--                      job; PERFORM sync_strategy_analytics_status drives branch
--                      (a) to computing: computed_at equals the seed. The job is
--                      then claimed and failed: failed, still the seed.
--   A2  D-05, failed origin   the same from a failed row.
--
-- ⛔ No `UPDATE strategy_analytics` anywhere in this file: every state change is
-- an INSERT of block-local rows or a real RPC. That keeps
-- analytics-service/tests/test_sql_gate_scoped_updates.py unmoved, and it means
-- the trigger under test is exercised only by the writers it exists to bind.
--
-- ⚠️ THE pg-lane STAND-IN TABLE has computed_at as a plain nullable column with no
-- default; the real table is NOT NULL DEFAULT now(). The F1 EDGE assertion
-- therefore derives its expectation from the catalog on the database it runs on
-- (default present: the transaction timestamp; absent: NULL) instead of
-- hard-coding either, so it asserts the same thing on both lanes and still runs.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION on
-- failure, no psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⛔ THE APPLIED-NESS ARM RAISES. IT DOES NOT SKIP. Arm 0 keys on the catalog,
-- not on anything inside the function under test, so a neutered body cannot make
-- it stop seeing the thing it guards.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_strategy_analytics_computed_at_success_only.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push; the
-- schema is scripts/mutation-runner/GRAMMAR.md. Every twin that edits the
-- migration's predicate ALSO disables the migration's own deployed-body regex
-- check in the same mutation (spelled `IF FALSE AND v_fn !~* ...`, the smallest
-- edit that leaves the anchor's text in place), because that check would
-- otherwise RAISE at apply time, the gate would never run, and no arm could be
-- the first failure. The apply list ends with the new migration, so a twin's edit
-- lands on a definition nothing later replaces.
-- ⭐ THE LIST DELIBERATELY STOPS AT 20261013120000 (Phase 166.5, plan 06; a deviation from
-- the pattern map, which proposed appending 20261023120000_sync_status_runner_stamps_computed_at.sql).
-- With that migration last, no bridge write names computed_at, so the F1, A1 and A2 twins
-- (which weaken THIS trigger) no longer change any outcome: the bridge never asked the trigger
-- to hold a date, and a twin that cannot change an outcome stops biting, a defect the runner
-- exits 1 on. Keeping the list means the mutation lane still exercises the trigger against a
-- bridge that writes the date, which is the layer this gate guards. The `sql-tests` lane
-- replays EVERY migration, so there the bridge writes no date and the trigger is
-- defence in depth: F1, A1 and A2 hold for two reasons at once. Only C1 changed. The bridge
-- layer's own date arms live in test_sync_status_computed_at_runner_only.sql, which leaves the
-- trigger out for the mirror-image reason.
-- RE-BASED 2026-10-13 (merge with origin/main): the migration moved from 20261009140000 to
-- 20261013120000 (past PROD's tip), so it now applies AFTER Phase 164.6.6.3.4 STATUSBRIDGE's
-- 20261009120000_sync_status_analytics_scope.sql, the latest definition of
-- sync_strategy_analytics_status. The apply list therefore loads that migration and its
-- fixture 37 too, so every arm drives the bridge that production runs, not a superseded one.
-- 20260510173005 is deliberately ABSENT from the list, as in the sibling gates:
-- it is a booked [REDUNDER-SAVEPOINT] migration that aborts any lane.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql"]}

BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k_mt5      UUID;
  s_c        UUID;  -- Arm C1: the success control
  s_f        UUID;  -- Arm F1: complete_with_warnings origin, fails through branch (b)
  s_e        UUID;  -- Arm F1 EDGE: no analytics row yet, the bridge INSERTs one
  s_a1       UUID;  -- Arm A1: complete origin, job start then failure
  s_a2       UUID;  -- Arm A2: failed origin, job start then failure
  j          UUID;
  tok        UUID;
  v_seed     TIMESTAMPTZ;
  v_at       TIMESTAMPTZ;
  v_status   TEXT;
  v_jobstat  TEXT;
  v_rows     INTEGER;
  v_has_def  BOOLEAN;
  v_expect   TIMESTAMPTZ;
BEGIN
  -- ===== ARM 0 — applied-ness. ABSENCE IS A FAILURE, NOT A SKIP ===========
  -- RED-UNDER: drop the trigger on the live lane AFTER the apply list has run.
  --            ⚠️ A `sql` step and NOT an edit that mistypes the CREATE TRIGGER:
  --            the migration's own catalog self-check would RAISE, abort the
  --            apply, and no arm could be the FIRST failure.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"DROP TRIGGER strategy_analytics_hold_computed_at_until_success_trigger ON public.strategy_analytics"}]}
  IF NOT EXISTS (
       SELECT 1 FROM pg_trigger t
        WHERE t.tgrelid = 'public.strategy_analytics'::regclass
          AND t.tgname = 'strategy_analytics_hold_computed_at_until_success_trigger'
          AND NOT t.tgisinternal
          AND t.tgenabled = 'O'
          AND t.tgtype = 19
          AND t.tgfoid = to_regprocedure('public.strategy_analytics_hold_computed_at_until_success()')::oid
     ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.strategy_analytics carries no enabled strategy_analytics_hold_computed_at_until_success_trigger that is FOR EACH ROW + BEFORE + UPDATE-only and calls public.strategy_analytics_hold_computed_at_until_success() on this database, so arms C1, F1, A1 and A2 would have measured a table nothing holds. Two causes fit and this assertion cannot tell them apart, so check both: (i) this database has not received 20261013120000_strategy_analytics_hold_computed_at_until_success.sql, apply it and re-run; (ii) a later migration dropped, disabled or re-shaped the trigger, which re-opens D-04 and D-05 outright (a failed or started job makes a stale strategy read as freshly computed). Do NOT turn this into a notice-and-continue skip.';
  END IF;
  IF COALESCE(has_function_privilege('anon', to_regprocedure('public.strategy_analytics_hold_computed_at_until_success()'), 'EXECUTE'), TRUE)
     OR COALESCE(has_function_privilege('authenticated', to_regprocedure('public.strategy_analytics_hold_computed_at_until_success()'), 'EXECUTE'), TRUE) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.strategy_analytics_hold_computed_at_until_success() is executable by anon or authenticated (or is absent). A trigger function is never an API surface; the REVOKE ALL ... FROM PUBLIC, anon, authenticated that the sibling strategy_analytics trigger functions carry is part of this migration''s contract.';
  END IF;

  -- ----- SEED ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cas-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cas', 'cas-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cas mt5', 'x', TRUE) RETURNING id INTO k_mt5;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'cas C')  RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'cas F')  RETURNING id INTO s_f;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'cas E')  RETURNING id INTO s_e;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'cas A1') RETURNING id INTO s_a1;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'cas A2') RETURNING id INTO s_a2;

  -- Thirty days is far outside any clock the bridge could land near by accident:
  -- an assertion "computed_at equals the seed" can only hold if the writer's
  -- now() was discarded, and "is later than the seed" only if it was kept.
  v_seed := now() - INTERVAL '30 days';

  -- ===== ARM C1 — the SUCCESS CONTROL: a real finish still stamps =========
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_c, 'complete', FALSE, v_seed);

  -- Phase 166.5 (COMPUTEDATSTAMP, R-02, D-03): the control is a RUNNER-SHAPED write now,
  -- not a mark RPC. The bridge writes no date any more (a finished job's mark leaves
  -- computed_at where it was), so driving mark_compute_job_done would assert a move that
  -- no longer happens. The analytics runner stamps the date itself, in the same write as
  -- the metrics: an upsert of the status and computed_at = the database clock ('now',
  -- the statement PostgREST emits for the runner's write: INSERT ... ON CONFLICT
  -- (strategy_id) DO UPDATE SET computation_status, computed_at from EXCLUDED). It
  -- reaches the row as an UPDATE, so the BEFORE UPDATE trigger under test sees it. No
  -- UPDATE statement appears in this file: the conflict arm is the runner's own path.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  SELECT strategy_id, computation_status, computation_warned, computed_at
    FROM json_populate_record(NULL::strategy_analytics,
           json_build_object('strategy_id', s_c, 'computation_status', 'complete',
                             'computation_warned', FALSE, 'computed_at', 'now'))
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status,
         computed_at        = EXCLUDED.computed_at;

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_c;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (C1-SETUP): the row reads %, not complete, so the runner-shaped success write did not reach the row and the assertion below would pass or fail for the wrong reason.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: make the trigger's predicate unconditional (`IF TRUE THEN`), i.e.
  --            hold computed_at on EVERY update including the success write.
  --            ⚠️ LAYERED: the migration's deployed-body regex check would abort
  --            the apply, so it is stood down in the same mutation.
  -- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql","find":"IF NEW.computation_status IN ('failed', 'computing') THEN","replace":"IF TRUE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql","find":"IF v_fn !~* 'new\\.computation_status","replace":"IF FALSE AND v_fn !~* 'new\\.computation_status","occurrences":1}]}
  IF v_at IS NULL OR v_at <= v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (C1): a SUCCESSFUL mark_compute_job_done left computed_at at % (the seed was %). The column must still move on a real finish: it is the freshness date the FreshnessChip and the PDF vintage read, and a trigger that holds it on every update freezes every strategy at its first stamp while all four hold arms below still pass.', COALESCE(v_at::text, 'NULL'), v_seed;
  END IF;

  -- ===== ARM F1 — D-04: a FAILURE does not stamp (branch (b)) =============
  -- The row is a complete_with_warnings one, the state a published Deribit
  -- composite sits in. The job is unmarked, so the failure is UNPROTECTED and
  -- branch (b), not (b-prime), is the branch under test.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_f, 'complete_with_warnings', TRUE, v_seed);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_f, 'stitch_composite', 'running', tok, 1, 3)
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'member ledger unrecoverable (fixture)', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_f;
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (F1-SETUP): the job reads % and the row reads %, not failed_final and failed, so branch (b) of the bridge is not the branch under test and the computed_at assertion would measure some other path. Either the claim token was rejected or the kind was retryable.', COALESCE(v_jobstat, 'NULL'), COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: narrow the trigger's predicate to the `computing` status alone, so
  --            a write to `failed` is no longer held (the pre-fix behaviour for
  --            D-04). ⚠️ LAYERED with the deployed-body regex stand-down.
  -- RED-UNDER-M: {"arm":"F1","apply":[{"kind":"edit","file":"supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql","find":"IF NEW.computation_status IN ('failed', 'computing') THEN","replace":"IF NEW.computation_status = 'computing' THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql","find":"IF v_fn !~* 'new\\.computation_status","replace":"IF FALSE AND v_fn !~* 'new\\.computation_status","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (F1): a failed stitch_composite resolved through the bridge moved computed_at from % to %. This is D-04: the row reads failed, but its freshness date now says the analytics were just recomputed, so a stale composite looks current on the FreshnessChip and the PDF vintage.', v_seed, COALESCE(v_at::text, 'NULL');
  END IF;

  -- EDGE — a first-ever row. A strategy with NO analytics row whose job fails
  -- gets one from the bridge's INSERT arm. The trigger is UPDATE-only, so that row
  -- still takes the column default instead of a value restored from nothing.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_e, 'stitch_composite', 'running', tok, 1, 3)
  RETURNING id INTO j;

  SELECT count(*) INTO v_rows FROM strategy_analytics WHERE strategy_id = s_e;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (F1-SETUP): strategy % already has % analytics row(s) before its job fails, so the bridge would take its UPDATE path and the edge below would not be a first-ever row. Something on this database creates the row on strategy insert.', s_e, v_rows;
  END IF;

  PERFORM mark_compute_job_failed(j, 'member ledger unrecoverable (fixture)', 'permanent', tok);

  SELECT a.atthasdef INTO v_has_def
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_analytics'::regclass
     AND a.attname = 'computed_at'
     AND NOT a.attisdropped;
  v_expect := CASE WHEN v_has_def THEN now() ELSE NULL END;
  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_e;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (F1-EDGE): the first-ever row reads computation_status = % rather than failed, so the bridge''s INSERT arm did not run for a strategy with no analytics row.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_at IS DISTINCT FROM v_expect THEN
    RAISE EXCEPTION 'TEST FAILED (F1-EDGE): the first-ever row reads computed_at = % where the column default gives % (default present on this database: %). The hold is UPDATE-only by design: an INSERT has no prior stamp to restore, and a trigger that fired there would either error on the unassigned OLD record or blank the default.', COALESCE(v_at::text, 'NULL'), COALESCE(v_expect::text, 'NULL'), v_has_def;
  END IF;

  -- ===== ARM A1 — D-05: a JOB START does not stamp (complete origin) ======
  -- A plain complete row (not warned, no refresh marker) and one PENDING job.
  -- sync_strategy_analytics_status sees a non-terminal job in flight and, with
  -- no marked refresh to keep the row published, moves it to computing: branch
  -- (a), which wrote computed_at = now() before this migration.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_a1, 'complete', FALSE, v_seed);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s_a1, 'stitch_composite', 'pending', 0, 3)
  RETURNING id INTO j;

  PERFORM sync_strategy_analytics_status(s_a1);

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_a1;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (A1-SETUP): the row reads % rather than computing after a pending job was seen by the bridge, so branch (a) is not the branch under test and the entry assertion below would measure nothing.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: add `AND NOT (NEW.computation_status = 'computing' AND OLD.computation_status = 'complete')`
  --            to the predicate, so entry into computing from a complete row is
  --            no longer held while every write to failed still is. The failed
  --            half of F1 and the failure half of this arm stay green; the ENTRY
  --            assertion is the first failure.
  -- RED-UNDER-M: {"arm":"A1","apply":[{"kind":"edit","file":"supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql","find":"IF NEW.computation_status IN ('failed', 'computing') THEN","replace":"IF NEW.computation_status IN ('failed', 'computing') AND NOT (NEW.computation_status = 'computing' AND OLD.computation_status = 'complete') THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (A1): a job START moved computed_at from % to % on a row that was complete. This is D-05: entering computing is not a computation, so the date must not claim one. Left stamped, the Sync panel and the factsheet cache cannot tell a fast-failing retry from a fresh result.', v_seed, COALESCE(v_at::text, 'NULL');
  END IF;

  -- The same job, now claimed and failed: computing -> failed holds too.
  tok := gen_random_uuid();
  UPDATE compute_jobs SET status = 'running', claim_token = tok, attempts = 1 WHERE id = j;
  PERFORM mark_compute_job_failed(j, 'member ledger unrecoverable (fixture)', 'permanent', tok);

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_a1;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (A1-SETUP): after the claimed job failed, the row reads % rather than failed, so the failure half of this arm did not reach branch (b).', COALESCE(v_status, 'NULL');
  END IF;
  IF v_at IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (A1): a job that started and then FAILED left computed_at at % where the seed was %. Entry into computing was held but the failure stamped, or the reverse: the column must come out of a start-then-fail run exactly where it went in.', COALESCE(v_at::text, 'NULL'), v_seed;
  END IF;

  -- ===== ARM A2 — D-05: a JOB START does not stamp (failed origin) ========
  -- The same run from a row that was already failed. A trigger written as
  -- "hold only when leaving a published state" passes A1 and fails here.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_a2, 'failed', FALSE, v_seed);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s_a2, 'stitch_composite', 'pending', 0, 3)
  RETURNING id INTO j;

  PERFORM sync_strategy_analytics_status(s_a2);

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_a2;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (A2-SETUP): the row reads % rather than computing after a pending job was seen by the bridge from a failed origin, so branch (a) is not the branch under test.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: add `AND NOT (NEW.computation_status = 'computing' AND OLD.computation_status = 'failed')`
  --            to the predicate, so entry into computing from a FAILED row is
  --            no longer held. Arm A1 (complete origin) stays green; this ENTRY
  --            assertion is the first failure.
  -- RED-UNDER-M: {"arm":"A2","apply":[{"kind":"edit","file":"supabase/migrations/20261013120000_strategy_analytics_hold_computed_at_until_success.sql","find":"IF NEW.computation_status IN ('failed', 'computing') THEN","replace":"IF NEW.computation_status IN ('failed', 'computing') AND NOT (NEW.computation_status = 'computing' AND OLD.computation_status = 'failed') THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (A2): a job START moved computed_at from % to % on a row that was already failed. A retry of a failed strategy is the commonest start there is, and stamping it makes the failed row look freshly computed the moment the retry is queued.', v_seed, COALESCE(v_at::text, 'NULL');
  END IF;

  tok := gen_random_uuid();
  UPDATE compute_jobs SET status = 'running', claim_token = tok, attempts = 1 WHERE id = j;
  PERFORM mark_compute_job_failed(j, 'member ledger unrecoverable (fixture)', 'permanent', tok);

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s_a2;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (A2-SETUP): after the claimed job failed, the row reads % rather than failed.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_at IS DISTINCT FROM v_seed THEN
    RAISE EXCEPTION 'TEST FAILED (A2): a start-then-fail run from a failed origin left computed_at at % where the seed was %.', COALESCE(v_at::text, 'NULL'), v_seed;
  END IF;

  RAISE NOTICE 'computed_at success-only gate: arms 0, C1, F1, A1, A2 executed. computed_at is held through a failure (branch (b), D-04) and through a job start (branch (a), D-05) from complete, complete_with_warnings and failed origins, still stamps on a real mark_compute_job_done, and a first-ever row takes the column default.';
END $$;

ROLLBACK;
