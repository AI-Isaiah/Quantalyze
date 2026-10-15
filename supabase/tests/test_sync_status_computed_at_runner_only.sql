-- Test: strategy_analytics.computed_at is written by the analytics runner and by
-- NOTHING in the status bridge. Every branch of sync_strategy_analytics_status
-- that used to assign the date (a, a's membership arm, b, c) leaves it alone, and
-- a runner-shaped write is the one thing that moves it.
-- Guards migration 20261023120000_sync_status_runner_stamps_computed_at.sql
-- (Phase 166.5 COMPUTEDATSTAMP; decisions D-01, D-03, D-04, R-01, R-03).
--
-- What makes this gate worth having
-- ---------------------------------
-- The failure the founder named: a nightly side job (funding sync, position
-- poll, reconcile, intro snapshot) made stale analytics look freshly updated,
-- because the bridge stamped now() on branches that are not a recompute. The
-- freshness chip, the factsheet cache key, the tearsheet badge and the PDF ETag
-- all read that date. Nothing inside one function call shows the defect: it is
-- visible only by driving the real mark RPC on a real cluster and reading the
-- date back against a seed that is TEN DAYS OLD, so that "equals the seed" can
-- hold only if the bridge wrote nothing. Every arm seeds its own strategy and
-- its own jobs by INSERT. No arm UPDATEs strategy_analytics (the row is seeded by
-- INSERT and changed by the mark RPC, a direct bridge call or an INSERT ... ON
-- CONFLICT), so analytics-service/tests/test_sql_gate_scoped_updates.py does not
-- move.
--
-- ⚠️ now() IS CONSTANT FOR THE WHOLE TRANSACTION. This file runs in one
-- BEGIN ... ROLLBACK, so a bridge write and a runner write that both resolve to
-- the transaction start cannot be told apart in-transaction, and no arm pretends
-- to. The arms compare against a seed ten days in the past, which any write of
-- the DB clock moves. Arm N7 is the control that proves the runner-shaped write
-- DOES move it; N2 .. N4 and N8 prove the bridge does not.
--
-- Arms, one per bridge branch that used to write the date. "old" is the
-- 20261009120000 body, "new" the body of 20261023120000. A guard reads the SAME
-- value on both bodies by design, so only its twin proves it can fail.
--   N2            branch (c), counting success: a complete row seeded ten days old,
--                 one compute_analytics_from_csv driven DONE, nothing else in
--                 flight. old moved the date, new leaves it.
--   N3            branch (b), counting failure: the same row, a
--                 compute_analytics_from_csv driven failed PERMANENTLY. The row
--                 reads failed; old moved the date, new leaves it (D-04).
--   N4            branch (a), three strategies each with a pending counting job and
--                 a direct bridge call: a plain complete row (-> computing), a
--                 warned row (-> complete_with_warnings) and a failed row whose
--                 writer sentence names a live failed_final (the membership arm,
--                 -> computing). old moved the plain and the membership dates, the
--                 warned arm held them (a guard); new leaves all three.
--   N7  (control) R-01: the runner-shaped statement PostgREST emits for an upsert
--                 of a JSON body carrying the database-clock literal `now` moves a
--                 ten-day-old date to the transaction time, and the same statement
--                 with the key absent leaves it. Independent of the bridge: the
--                 proof that the date CAN move, so N2, N3, N4 and N8 are not green
--                 on a column nothing can write.
--   N8  (guard)   branch (b-prime), a protected ledger-refresh failure over a
--                 healthy published row: the sentence is recorded, the date stays.
--                 b-prime never wrote the date, so old and new agree; the twin
--                 proves the arm can fail.
--   N1            D-03's exception: a `failed` row with a writer sentence and both
--                 markers, a poll_positions pending, a sync_funding driven DONE.
--                 Status, sentence, markers and date stay as seeded. Plan 02's body
--                 moved the row to computing and blanked the sentence.
--   N5            D-06 alternative: a side job that is the last in flight, driven
--                 DONE on one strategy and failed PERMANENTLY on another, never
--                 moves the date of a complete row.
--   N6            replaces scope arm D15: a warned row, a counting job done, then
--                 the queued side job failed. The date stays ten days old.
--   N9            D-08, R-05: a failed row carrying a sentence (the reaper shape) is
--                 not healed to complete by a side job that is the last in flight
--                 and succeeded. The 20261009120000 body healed it.
--   N10           R-01 end to end: the runner's stamp survives a counting job's
--                 branch (a) mark with a sibling side job in flight.
--
-- ⭐ WHY THE APPLY LIST OMITS THE 166.3.1 TRIGGER MIGRATION. The list is the
-- scope gate's (test_sync_status_analytics_scope.sql), copied from that file, with
-- 20261023120000 appended LAST. It deliberately does NOT carry
-- 20261013120000_strategy_analytics_hold_computed_at_until_success.sql. That
-- trigger restores the old date on any write whose new status is failed or
-- computing, so with it in the lane a twin that re-adds a date write to branch
-- (a) or (b) is HELD by the trigger and cannot bite: the arm would stay green
-- under the defect it exists to catch. This gate isolates the BRIDGE layer. The
-- full local-stack replay in `sql-tests` still applies both layers together.
--
-- ⭐ WHY EVERY IDENTITY CARRIES A DIGIT (N2, not N). `sectionOfIdentity` in
-- scripts/mutation-runner/run.mjs collapses a trailing `-SUFFIX` into its parent
-- section only when a DIGIT precedes it, so `N2-SETUP` is a sub-arm of section N2
-- and is covered by N2's twin.
--
-- ⚠️ The SETUP guards are VACUITY guards ("this fixture actually reached the
-- branch this arm is about"), not claims about the bridge, and are deliberately
-- NOT twinned: a twin for one would have to break PRODUCTION to break a FIXTURE.
-- A SETUP guard firing still names itself, so a failing run says whether the
-- fixture or the claim broke.
--
-- ⚠️ EVERY twin that edits the bridge is LAYERED with an edit that stands down
-- the self-verify anchor the migration keeps over that edit. Without the layer
-- the migration's own DO $verify$ block RAISEs, the apply ABORTS, the gate never
-- runs and no arm can be the first failure: the runner then scores a defect, not
-- a bite. A positive anchor is stood down as `IF FALSE AND NOT <boolean> THEN`.
--
-- pgTAP is NOT installed. Plain PL/pgSQL DO blocks, RAISE EXCEPTION on failure,
-- no psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed assertion exits
-- non-zero. The whole test rolls back.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_sync_status_computed_at_runner_only.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose red-under claim below carries an
-- adjacent twin object that scripts/mutation-runner executes: it mutates COPIES
-- on a throwaway pg-lane cluster, requires the FIRST failure the gate raises to
-- name that arm, and restores GREEN. Schema: scripts/mutation-runner/GRAMMAR.md.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","scripts/pg-lane/fixtures/37-fixture-side-compute-job-kinds.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql","supabase/migrations/20261009120000_sync_status_analytics_scope.sql","supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql"]}

BEGIN;

-- ===== ARM N1 — a successful side job with a sibling in flight leaves the row alone ====
-- D-03's exception. A `failed` row carries a writer sentence and both provenance
-- markers; a poll_positions job is still pending and a sync_funding job finishes
-- DONE. The call was caused by a side-kind job that computed nothing, and a side
-- job is still in flight, so the bridge says nothing about a stored analytic:
-- status, sentence, both markers and the date stay exactly as seeded. On the
-- 20261023120000 body as plan 02 left it, the success is not a failure, so the
-- early return stood down and branch (a) moved the row to `computing` and blanked
-- the sentence.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  fj         UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence of a real earlier compute failure';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N1') RETURNING id INTO s;

  -- A real analytics failure and the writer sentence it left on a `failed` row.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at, updated_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', v_old_at, v_old_at)
  RETURNING id INTO fj;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s, 'failed', FALSE, v_err, 'writer', fj, v_old_at);

  -- The sibling side job in flight, and the side job that finishes done.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'poll_positions', 'pending', 0, 3, now());
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (N1-SETUP): the driven sync_funding is % rather than done, so the bridge was never asked to decide a successful side job with a sibling in flight and the row read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (N1-SETUP): the seeded strategy_analytics row is gone after the side job''s mark, so the row read below would pass vacuously.';
  END IF;
  -- RED-UNDER: a status test restored in the trigger flag (`t.status <> 'done' AND`
  --            before `t.kind`), i.e. the pre-phase not-done flag: a SUCCESSFUL side
  --            job no longer counts as a side trigger, so with a sibling side job in
  --            flight the early return stands down and branch (a) moves the failed
  --            row to computing and blanks its sentence.
  --            ⚠️ LAYERED: v_side_trigger_ok (the flag as one whole expression) and
  --            (xv-b)'s v_side_sites_ok (its trigger-test conjunct is `SELECT t.kind`
  --            with no leading AND) are stood down, otherwise the apply RAISES
  --            before the gate runs.
  -- RED-UNDER-M: {"arm":"N1","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"COALESCE((SELECT t.kind = ANY (v_side_kinds)","replace":"COALESCE((SELECT t.status <> 'done' AND t.kind = ANY (v_side_kinds)","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_side_trigger_ok THEN","replace":"IF FALSE AND NOT v_side_trigger_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' OR v_at IS DISTINCT FROM v_old_at
     OR v_msg IS DISTINCT FROM v_err OR v_src IS DISTINCT FROM 'writer' OR v_mjob IS DISTINCT FROM fj THEN
    RAISE EXCEPTION 'TEST FAILED (N1): after a SUCCESSFUL side-kind job with a sibling side job still in flight the failed row reads status % (expected failed), computed_at % (seeded %), sentence %, source %, job %. A side job computes nothing, so a call it causes must leave status, sentence, both markers and the date exactly as they were while any side job is in flight (D-03).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== ARM N2 — a counting job's success mark never moves the freshness date ====
-- Branch (c), the all-jobs-done success transition. A genuine compute finishes
-- done and nothing else is in flight. Only the analytics runner's own success
-- write may move the date (D-01/D-03); the bridge resolves the status and writes
-- nothing else here.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N2') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s, 'complete', FALSE, v_old_at);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (N2-SETUP): the driven compute_analytics_from_csv is % rather than done, so the bridge was never asked to decide a counting success and the date read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (N2-SETUP): the row reads % rather than complete after the counting success, so the bridge did not reach branch (c) and the date read below would pass vacuously.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: branch (c)'s date assignment restored at the end of its SET list,
  --            keyed on the D-09 flag (held on a side-only failure, now() on every
  --            other path), i.e. the pre-phase body: a counting job's success mark
  --            moves the date although the runner, not the bridge, owns it.
  -- RED-UNDER-M: {"arm":"N2","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"         computing_started_at = NULL;\nEND;","replace":"         computing_started_at = NULL,\n         computed_at        = CASE WHEN v_side_trigger THEN strategy_analytics.computed_at ELSE now() END;\nEND;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_no_date_write_ok THEN","replace":"IF FALSE AND NOT v_no_date_write_ok THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N2): computed_at is % after a counting job''s success mark, seeded % (ten days old). The analytics runner is the only writer of the freshness date and stamps it in the same write as the metrics; a bridge write moves freshness without a recompute (D-01/D-03).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N3 — a counting job's FAILURE never moves the freshness date =========
-- Branch (b), all terminal with a live unprotected failed_final. The row reads
-- `failed` and carries the curated sentence; the date stays at the last good
-- compute (D-04). The failure shows through computation_status, never the date.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s, 'complete', FALSE, v_old_at);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded permanent failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (N3-SETUP): the driven compute_analytics_from_csv is % rather than failed_final, so the bridge was never asked to decide a counting failure and the date read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (N3-SETUP): the row reads % rather than failed after a permanent counting failure, so the bridge did not reach branch (b) and the date read below would pass vacuously.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: branch (b)'s date assignment restored at the end of its SET list,
  --            i.e. the pre-phase body: a failed recompute moves the date to the
  --            failure time and a stale analytic reads as freshly computed.
  --            ⚠️ LAYERED: the new anchor v_no_date_write_ok is stood down,
  --            otherwise the apply RAISES before the gate runs.
  -- RED-UNDER-M: {"arm":"N3","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"           computing_started_at = NULL;\n    RETURN;","replace":"           computing_started_at = NULL,\n           computed_at        = now();\n    RETURN;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_no_date_write_ok THEN","replace":"IF FALSE AND NOT v_no_date_write_ok THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N3): computed_at is % after a permanent counting failure, seeded % (ten days old). A failed recompute leaves the date at the last good compute; the failure shows through computation_status and its sentence, never by moving the date (D-04).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N4 — branch (a) never moves the freshness date =========================
-- Branch (a): a counting job is in flight, so the row goes (or stays) computing.
-- Three strategies, one per way into the branch: a plain complete row, a warned
-- row, and a failed row whose writer-provenance job is among the live
-- unprotected failures (the membership arm). The bridge is called directly, the
-- way the Python DEFERRED path calls it; a pending counting job is the in-flight
-- work. All three dates stay ten days old.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s_plain    UUID;
  s_warned   UUID;
  s_member   UUID;
  fj         UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N4 plain') RETURNING id INTO s_plain;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N4 warned') RETURNING id INTO s_warned;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N4 member') RETURNING id INTO s_member;

  -- plain: a complete, unwarned row with a pending counting job.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_plain, 'complete', FALSE, v_old_at);
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s_plain, 'compute_analytics_from_csv', 'pending', 0, 3, now());

  -- warned: a complete_with_warnings row with a pending counting job.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_warned, 'complete_with_warnings', TRUE, v_old_at);
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s_warned, 'compute_analytics_from_csv', 'pending', 0, 3, now());

  -- membership: a failed row whose writer sentence names a live unprotected
  -- failed_final counting job, plus a pending retry in flight.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, last_error, error_kind, created_at)
  VALUES (s_member, 'compute_analytics_from_csv', 'failed_final', 3, 3, 'seeded failure', 'permanent', now() - interval '2 hours')
  RETURNING id INTO fj;
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error,
                                  computation_error_source, computation_error_job_id, computed_at)
  VALUES (s_member, 'failed', FALSE, 'seeded sentence of a real earlier compute failure', 'writer', fj, v_old_at);
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s_member, 'compute_analytics_from_csv', 'pending', 0, 3, now());

  PERFORM sync_strategy_analytics_status(s_plain);
  PERFORM sync_strategy_analytics_status(s_warned);
  PERFORM sync_strategy_analytics_status(s_member);

  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s_plain;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (N4-SETUP): the plain complete row reads % rather than computing with a counting job in flight, so branch (a) was not reached and the date read below would pass vacuously.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: branch (a)'s date CASE restored after the computing_started_at
  --            CASE, i.e. the pre-phase body: the writer-provenance arm and the
  --            ELSE arm stamp the transaction time on a row that only STARTED a
  --            recompute. ⚠️ LAYERED: v_no_date_write_ok and the membership-site
  --            count are stood down, otherwise the apply RAISES before the gate
  --            runs.
  -- RED-UNDER-M: {"arm":"N4","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"           ELSE strategy_analytics.computing_started_at\n           END;\n    RETURN;","replace":"           ELSE strategy_analytics.computing_started_at\n           END,\n           computed_at = CASE\n             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)\n             THEN now()\n             WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)\n             THEN strategy_analytics.computed_at\n             ELSE now()\n           END;\n    RETURN;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_no_date_write_ok THEN","replace":"IF FALSE AND NOT v_no_date_write_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF v_membership_sites <> 7 THEN","replace":"IF FALSE AND v_membership_sites <> 7 THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N4): a plain complete row going computing carries computed_at % after the bridge, seeded % (ten days old). Queueing work computes nothing, so branch (a) must not stamp the date (D-03).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s_warned;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'TEST FAILED (N4-SETUP): the warned row reads % rather than complete_with_warnings, so the warned hold of branch (a) was not exercised.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N4): a warned row carries computed_at % after the bridge, seeded % (ten days old). Branch (a) must leave the date alone on a warned row (D-03).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s_member;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (N4-SETUP): the failed row whose writer job is a live failure reads % rather than computing, so the membership arm of branch (a) was not exercised.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N4): a failed row going computing through the membership arm carries computed_at % after the bridge, seeded % (ten days old). The membership arm rewrites the sentence and the markers, and writes no date (D-03).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N5 — a side-only finish never moves the freshness date ================
-- D-06's alternative, pinned: with the release clause gone, the thing that stops a
-- nightly side job from making stale analytics look fresh is that the bridge stamps
-- nothing when a side job is the last job in flight. Two strategies, each a complete
-- row seeded ten days old with ONE side job: (i) a sync_funding driven DONE, (ii) a
-- sync_funding driven failed PERMANENTLY. Branch (c) runs for both (a side failure
-- is not an analytics failure); the date stays ten days old.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s_done     UUID;
  s_fail     UUID;
  j_done     UUID;
  j_fail     UUID;
  tok_done   UUID := gen_random_uuid();
  tok_fail   UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N5 done') RETURNING id INTO s_done;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N5 fail') RETURNING id INTO s_fail;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_done, 'complete', FALSE, v_old_at),
         (s_fail, 'complete', FALSE, v_old_at);

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s_done, 'sync_funding', 'running', tok_done, 1, 3, now())
  RETURNING id INTO j_done;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s_fail, 'sync_funding', 'running', tok_fail, 1, 3, now())
  RETURNING id INTO j_fail;
  PERFORM mark_compute_job_done(j_done, tok_done);
  PERFORM mark_compute_job_failed(j_fail, 'seeded permanent failure', 'permanent', tok_fail);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j_done;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (N5-SETUP): the driven sync_funding of the success leg is % rather than done, so the bridge was never asked to decide a last-in-flight side success and the date read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;
  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j_fail;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (N5-SETUP): the driven sync_funding of the failure leg is % rather than failed_final, so the bridge was never asked to decide a last-in-flight side failure and the date read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s_done;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (N5-SETUP): the row of the success leg reads % rather than complete, so branch (c) was not reached and the date read below would pass vacuously.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: a date assignment added to branch (c)'s SET list keyed on the side
  --            trigger (`CASE WHEN v_side_trigger THEN now() ELSE <held> END`): a
  --            nightly side job that is the last job in flight then makes ten-day-old
  --            analytics read as freshly computed, the failure the founder named.
  --            ⚠️ LAYERED: v_no_date_write_ok is stood down, otherwise the apply
  --            RAISES before the gate runs.
  -- RED-UNDER-M: {"arm":"N5","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"         computing_started_at = NULL;\nEND;","replace":"         computing_started_at = NULL,\n         computed_at        = CASE WHEN v_side_trigger THEN now() ELSE strategy_analytics.computed_at END;\nEND;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_no_date_write_ok THEN","replace":"IF FALSE AND NOT v_no_date_write_ok THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N5): computed_at is % after a sync_funding finished DONE as the last job in flight, seeded % (ten days old). A side job computes nothing, so its finish must never move the freshness date (D-06 alternative, D-03).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s_fail;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (N5-SETUP): the row of the failure leg reads % rather than complete after a side-only failure, so branch (c) was not reached and the date read below would pass vacuously.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N5): computed_at is % after a sync_funding FAILED permanently as the last job in flight, seeded % (ten days old). A side job computes nothing, so its failure must never move the freshness date (D-06 alternative, D-03).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N6 — a side failure after a counting success never re-dates a warned row ====
-- Replaces scope arm D15, which asserted the OPPOSITE under the deleted release
-- clause (a side failure after a counting `done` advanced the date). A warned row
-- seeded ten days old; a sync_funding queued; a genuine stitch_composite driven DONE
-- (branch (a) holds the warned row with the side job still in flight); then the
-- sync_funding is claimed and driven failed PERMANENTLY (branch (c), a side trigger).
-- The date is still ten days old: the analytics runner, not the bridge, owns it.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  c          UUID;
  sj         UUID;
  ctok       UUID := gen_random_uuid();
  stok       UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N6') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s, 'complete_with_warnings', TRUE, v_old_at);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'pending', 0, 3, now() - interval '30 minutes')
  RETURNING id INTO sj;
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'stitch_composite', 'running', ctok, 1, 3, now() - interval '1 hour')
  RETURNING id INTO c;

  PERFORM mark_compute_job_done(c, ctok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = c;
  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s;
  IF v_jobstat IS DISTINCT FROM 'done' OR v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'TEST FAILED (N6-SETUP): after the counting job''s own mark (job %) with the sync_funding queued the row reads %, not complete_with_warnings. Branch (a) was expected to hold the warned row, which is the state the side failure below acts on.', COALESCE(v_jobstat, 'NULL'), COALESCE(v_status, 'NULL');
  END IF;

  -- The claim RPC's effect, reproduced, then the side job fails.
  UPDATE compute_jobs SET status = 'running', claim_token = stok, attempts = 1 WHERE id = sj;
  PERFORM mark_compute_job_failed(sj, 'handler timeout', 'permanent', stok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = sj;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (N6-SETUP): the driven sync_funding is % rather than failed_final, so the terminal call this arm is about was never made.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: the deleted release reborn: branch (c) stamps the transaction time
  --            when a side trigger follows a counting `done`, i.e. the pre-phase
  --            CR-R3-01 behaviour scope arm D15 asserted. A bridge write then moves
  --            the date although the runner, not the bridge, owns it.
  --            ⚠️ LAYERED: v_no_date_write_ok and (xv-b)'s v_side_sites_ok (the
  --            restored text reads the side-kind constant a fourth time) are stood
  --            down, otherwise the apply RAISES before the gate runs.
  -- RED-UNDER-M: {"arm":"N6","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"         computing_started_at = NULL;\nEND;","replace":"         computing_started_at = NULL,\n         computed_at        = CASE WHEN v_side_trigger AND EXISTS (SELECT 1 FROM compute_jobs d WHERE d.strategy_id = p_strategy_id AND d.status = 'done' AND NOT d.kind = ANY (v_side_kinds)) THEN now() ELSE strategy_analytics.computed_at END;\nEND;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_no_date_write_ok THEN","replace":"IF FALSE AND NOT v_no_date_write_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_side_sites_ok THEN","replace":"IF FALSE AND NOT v_side_sites_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete_with_warnings' OR v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N6): after a counting job finished done with a sync_funding queued, and that sync_funding then failed, the warned row reads status % (expected complete_with_warnings), computed_at % (seeded % ten days old). The runner stamps the date in the same write as the metrics; a side failure that follows must never re-date the row (D-06 alternative, D-03; replaces scope arm D15).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N7 — the runner-shaped write is the ONE thing that moves the date ======
-- R-01 control. Arms N2, N3, N4 and N8 prove the bridge writes no date; this arm
-- proves the date CAN move, so they are not green on a column nothing can write.
-- The statement is the shape PostgREST emits for an upsert of a JSON body:
-- INSERT ... SELECT <named columns> FROM json_populate_record(NULL::<table>, ...)
-- ON CONFLICT DO UPDATE. The runner sends the special input `now`, which Postgres
-- resolves to the transaction start, on the DATABASE clock (D-02). Named columns,
-- never SELECT *: SELECT * would project the NOT NULL columns the JSON leaves NULL
-- and raise 23502 before the conflict is even considered. A body WITHOUT the key
-- leaves the date alone: the second leg.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s_stamp    UUID;
  s_omit     UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N7 stamp') RETURNING id INTO s_stamp;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N7 omit') RETURNING id INTO s_omit;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_stamp, 'computing', FALSE, v_old_at),
         (s_omit,  'computing', FALSE, v_old_at);

  -- Leg 1: the success write carries the key.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  SELECT strategy_id, computation_status, computation_warned, computed_at
    FROM json_populate_record(NULL::strategy_analytics,
           json_build_object('strategy_id', s_stamp, 'computation_status', 'complete', 'computation_warned', FALSE,
                             'computed_at', 'now'))
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status,
         computed_at        = EXCLUDED.computed_at;

  SELECT computed_at INTO v_at FROM strategy_analytics WHERE strategy_id = s_stamp;
  -- RED-UNDER: a writer that sends a FIXED OLD timestamp instead of the database
  --            clock (the gate's own literal edited): the date lands in 2001 and
  --            does not equal the transaction time, so a stamp that is not the DB
  --            clock cannot pass for a real one (D-02).
  -- RED-UNDER-M: {"arm":"N7","apply":[{"kind":"edit","file":"supabase/tests/test_sync_status_computed_at_runner_only.sql","find":"FALSE,\n                             'computed_at', 'now'","replace":"FALSE,\n                             'computed_at', '2001-01-01 00:00:00+00'","occurrences":1}]}
  IF v_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'TEST FAILED (N7): a runner-shaped success write carrying the database-clock literal left computed_at at %, not the transaction time %. The control that proves the date CAN move is broken, so a green N2, N3, N4 or N8 would prove nothing (R-01, D-02).', COALESCE(v_at::text, 'NULL'), now();
  END IF;

  -- Leg 2: the same shape with the key absent from the body and from both column
  -- lists leaves the date where it was.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  SELECT strategy_id, computation_status, computation_warned
    FROM json_populate_record(NULL::strategy_analytics,
           json_build_object('strategy_id', s_omit, 'computation_status', 'complete', 'computation_warned', FALSE))
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status;

  SELECT computed_at INTO v_at FROM strategy_analytics WHERE strategy_id = s_omit;
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N7): a runner-shaped write WITHOUT the computed_at key moved the date to %, seeded % (ten days old). Omitting the key must leave the stored date alone (R-01).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N8 — a protected failure records the error and moves no date ==========
-- Branch (b-prime): a published, healthy row, a ledger-refresh-marked
-- derive_broker_dailies that fails permanently. The bridge records the curated
-- sentence and changes nothing a subscriber can see; the date stays at the last
-- good compute.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_error    TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N8') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s, 'complete', FALSE, v_old_at);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;
  PERFORM mark_compute_job_failed(j, 'seeded protected failure', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (N8-SETUP): the driven derive_broker_dailies is % rather than failed_final, so the bridge was never asked to decide a protected failure and the date read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computation_error, computed_at INTO v_status, v_error, v_at
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' OR v_error IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (N8-SETUP): the row reads status % with sentence %; branch (b-prime) keeps the published status and records a sentence, so the protected branch was not reached and the date read below would pass vacuously.', COALESCE(v_status, 'NULL'), COALESCE(v_error, 'NULL');
  END IF;
  -- RED-UNDER: a date assignment added to branch (b-prime)'s SET list: a FAILED
  --            marked refresh then reads as freshly computed over the healthy
  --            published analytics. ⚠️ LAYERED: v_no_date_write_ok and the carried
  --            b-prime negative anchor on the date are stood down, otherwise the
  --            apply RAISES before the gate runs.
  -- RED-UNDER-M: {"arm":"N8","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"           computing_started_at = NULL\n     WHERE strategy_id = p_strategy_id;","replace":"           computing_started_at = NULL,\n           computed_at = now()\n     WHERE strategy_id = p_strategy_id;","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_no_date_write_ok THEN","replace":"IF FALSE AND NOT v_no_date_write_ok THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF v_fn ~* 'SET\\s+computation_error\\s*=\\s*CASE(?:(?!WHERE\\s+strategy_id)(?:.|\\n))*?computed_at","replace":"IF FALSE AND v_fn ~* 'SET\\s+computation_error\\s*=\\s*CASE(?:(?!WHERE\\s+strategy_id)(?:.|\\n))*?computed_at","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N8): computed_at is % after a protected marked-refresh failure, seeded % (ten days old). A failed refresh must never read as freshly computed over a healthy published row (D-04).', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;
END $$;

-- ===== ARM N9 — a successful last-in-flight side job never heals a failed row ====
-- D-08, R-05. The reaper-failed shape: a `failed` row carrying a sentence (markers
-- NULL, as the reaper leaves them), ten days old. A sync_funding, the only job in
-- flight, finishes DONE. Branch (c) runs under a side trigger; the status hold keeps
-- a failed row that carries a sentence failed whatever the side job's outcome, so
-- the row is not healed to `complete` by a job that computed nothing. (A `failed`
-- row with NO sentence still resolves to complete under a side trigger: scope arm
-- S1 in test_sync_status_analytics_scope.sql keeps that green.)
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_err      TEXT := 'seeded sentence left by the stuck-computing reaper';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_msg      TEXT;
  v_src      TEXT;
  v_mjob     UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N9') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error, computed_at)
  VALUES (s, 'failed', FALSE, v_err, v_old_at);

  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'running', tok, 1, 3, now())
  RETURNING id INTO j;
  PERFORM mark_compute_job_done(j, tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (N9-SETUP): the driven sync_funding is % rather than done, so the bridge was never asked to decide a last-in-flight side success and the row read below would pass vacuously.', COALESCE(v_jobstat, 'NULL');
  END IF;

  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_msg, v_src, v_mjob
    FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: branch (c)'s failed-row hold keyed on a FAILED side trigger again (an
  --            added status test on the trigger job): a SUCCESSFUL side job then
  --            falls through to the ELSE arm and heals the failed row to complete
  --            over its held sentence, the pre-phase behaviour.
  --            ⚠️ LAYERED: v_c_status_hold_ok is stood down, otherwise the apply
  --            RAISES before the gate runs.
  -- RED-UNDER-M: {"arm":"N9","apply":[{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"           WHEN v_side_trigger\n                AND strategy_analytics.computation_status = 'failed'","replace":"           WHEN v_side_trigger\n                AND (SELECT t.status IN ('failed_retry', 'failed_final') FROM compute_jobs t WHERE t.id = p_trigger_job_id)\n                AND strategy_analytics.computation_status = 'failed'","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261023120000_sync_status_runner_stamps_computed_at.sql","find":"IF NOT v_c_status_hold_ok THEN","replace":"IF FALSE AND NOT v_c_status_hold_ok THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'failed' OR v_at IS DISTINCT FROM v_old_at
     OR v_msg IS DISTINCT FROM v_err OR v_src IS NOT NULL OR v_mjob IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (N9): after a SUCCESSFUL sync_funding finished as the last job in flight the failed row reads status % (expected failed), computed_at % (seeded %), sentence %, source %, job %. A side job computes nothing, so it must not heal a failed row that carries a failure sentence nor touch its sentence, markers or date (D-08, R-05).', COALESCE(v_status, 'NULL'), COALESCE(v_at::text, 'NULL'), v_old_at, COALESCE(v_msg, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_mjob::text, 'NULL');
  END IF;
END $$;

-- ===== ARM N10 — the runner's stamp survives a sibling side job in flight =========
-- R-01 end to end, TODOS [164.5.2.1-COMPUTED-AT-RUNNER-STAMP] clause 1. A
-- complete_with_warnings row seeded ten days old; a sync_funding queued; a counting
-- compute_analytics_from_csv running. The runner-shaped success write (N7's
-- json_populate_record statement, named columns, the database-clock literal `now`)
-- lands first, then the counting job's mark reaches branch (a) with the side job
-- still in flight (the warned hold). Before this phase that mark re-held the OLD date
-- over the runner's fresh one; the date now stays AT the runner's stamp. Python half:
-- plan 01's RED leg. The in-transaction `now()` is the same constant for the runner
-- write and for any bridge write, so the arm compares against the ten-day-old seed:
-- "moved off the seed" can only be the runner's write.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  c          UUID;
  ctok       UUID := gen_random_uuid();
  v_old_at   TIMESTAMPTZ := now() - interval '10 days';
  v_jobstat  TEXT;
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'cstamp-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'cstamp', 'cstamp-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'cstamp mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'cstamp N10') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s, 'complete_with_warnings', TRUE, v_old_at);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'sync_funding', 'pending', 0, 3, now() - interval '30 minutes');
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'running', ctok, 1, 3, now() - interval '1 hour')
  RETURNING id INTO c;

  -- The runner's success write, on the database clock.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  SELECT strategy_id, computation_status, computation_warned, computed_at
    FROM json_populate_record(NULL::strategy_analytics,
           json_build_object('strategy_id', s, 'computation_status', 'complete_with_warnings', 'computation_warned',
                             TRUE,
                             'computed_at', 'now'))
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status,
         computation_warned = EXCLUDED.computation_warned,
         computed_at        = EXCLUDED.computed_at;

  SELECT computed_at INTO v_at FROM strategy_analytics WHERE strategy_id = s;
  IF v_at IS NULL OR v_at = v_old_at THEN
    RAISE EXCEPTION 'TEST FAILED (N10-SETUP): the runner-shaped success write left computed_at at % (seeded %), so the stamp this arm checks the bridge against was never written.', COALESCE(v_at::text, 'NULL'), v_old_at;
  END IF;

  -- The counting job's mark, with the side job still in flight.
  PERFORM mark_compute_job_done(c, ctok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = c;
  SELECT computation_status, computed_at INTO v_status, v_at FROM strategy_analytics WHERE strategy_id = s;
  IF v_jobstat IS DISTINCT FROM 'done' OR v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'TEST FAILED (N10-SETUP): after the counting job''s mark (job %) with the sync_funding queued the row reads %, not complete_with_warnings, so branch (a) with the warned hold was not exercised.', COALESCE(v_jobstat, 'NULL'), COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: a runner that does not stamp the database clock (the gate's own
  --            `now` literal edited to a fixed 2001 timestamp): the runner's write
  --            lands in 2001 and the date can no longer equal the transaction time.
  -- RED-UNDER-M: {"arm":"N10","apply":[{"kind":"edit","file":"supabase/tests/test_sync_status_computed_at_runner_only.sql","find":"TRUE,\n                             'computed_at', 'now'","replace":"TRUE,\n                             'computed_at', '2001-01-01 00:00:00+00'","occurrences":1}]}
  IF v_at IS DISTINCT FROM now() THEN
    RAISE EXCEPTION 'TEST FAILED (N10): computed_at is % after the counting job''s mark, not the runner''s stamp %. The runner stamped the database clock first and the bridge must leave that date alone (seeded % ten days old): the 164.5.2.1 defect was a mark re-holding the old date over the runner''s fresh one (R-01).', COALESCE(v_at::text, 'NULL'), now(), v_old_at;
  END IF;
END $$;

-- ===== COMPLETION SENTINEL ==================================================
-- Reached only if every arm above passed. Counts the ten sections the mutation
-- runner counts: the -SETUP sub-arms fold into their parent section.
DO $$
BEGIN
  RAISE NOTICE 'ALL 10 ARMS EXECUTED (N1, N2, N3, N4, N5, N6, N7, N8, N9, N10): [166.5 COMPUTEDATSTAMP] a successful side-kind job with a sibling side job in flight leaves status, sentence, markers and date exactly as seeded (N1); a counting job''s success (N2) and permanent failure (N3) and branch (a), plain, warned and membership (N4), never move computed_at; neither does a side job that is the last in flight, successful or failed (N5), nor a side failure that follows a counting success on a warned row (N6, replacing scope arm D15); the runner-shaped upsert is the one write that moves the date, and omitting the key leaves it (N7); a protected marked-refresh failure moves no date (N8); a successful last-in-flight side job does not heal a failed row that carries a sentence (N9); and the runner''s own stamp survives a sibling side job in flight and a counting mark in branch (a) (N10).';
END $$;

ROLLBACK;
