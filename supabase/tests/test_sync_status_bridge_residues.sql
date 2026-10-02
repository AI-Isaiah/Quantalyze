-- Test: the SQL bridge never leaves computation_warned set over a failed run
-- whose writer's job is an UNPROTECTED live failure, and never publishes
-- complete_with_warnings over one afterwards.
-- Guards migration 20261003120000_sync_status_bridge_residues.sql
-- (Phase 164.5.2.1 BRIDGERESIDUE, [164.6.7-COMPOSITE-REREAD-RESIDUE]).
--
-- What makes this gate worth having
-- ---------------------------------
-- The residue is a RACE between two writers that never see each other: the
-- Python honour path writes the sentence plus writer provenance for its own job
-- X and leaves computation_warned alone (X carried a refresh marker, so the
-- failure was protected), and then the marker is RETRACTED before X's
-- mark_compute_job_failed runs the bridge. The bridge then sees an UNPROTECTED
-- failure and takes a loud branch, which before 20261003120000 never touched
-- computation_warned. Nothing inside one function call shows the defect; it is
-- only visible by driving the real mark RPC on a real cluster and reading
-- strategy_analytics back, which every arm below does.
--
-- Every arm seeds its own strategy, starts from the live ledger cohort's shape
-- (computation_status = 'complete_with_warnings', computation_warned = TRUE),
-- and reproduces the scenario in a fixed order: the honour write, the
-- retraction (X's metadata replaced so it carries no 'source'), then X's
-- permanent mark. Sibling jobs are UNMARKED unless an arm says otherwise.
-- Sibling kinds are drawn ONLY from process_key_long,
-- compute_analytics_from_csv, derive_broker_dailies and stitch_composite: those
-- are the kinds this lane's apply list registers, and any other kind raises a
-- 23503 on compute_jobs.kind.
--
-- Arms:
--   W1            all terminal at X's mark (derive_broker_dailies): the row
--                 must read failed with computation_warned FALSE, and a later
--                 bridge call with an unmarked sibling in flight must read
--                 computing, never complete_with_warnings. On the pre-fix body
--                 the flag survives the mark and the later call publishes
--                 complete_with_warnings over the live permanent failure.
--   W1-COMPOSITE  the same scenario on stitch_composite with the
--                 ledger-refresh-composite marker: the composite honour arm is a
--                 different Python writer, and the residue was measured on both.
--                 Folded into section W1 by the runner (see the digit rule).
--
-- ⭐ ARM 0 (APPLIED-NESS) IS DELIBERATELY OMITTED. The sibling gates key their
-- applied-ness arm on a catalog fact OUTSIDE the body under test (a column the
-- migration adds), because a presence gate that is a substring of the thing
-- under test stops seeing it exactly when the thing is neutered. This migration
-- adds no catalog object outside the function body: no column, no constraint,
-- and no COMMENT ON FUNCTION (D-03). There is therefore nothing for an arm 0 to
-- key on. It is also not needed: on a database where 20261003120000 is not in
-- force, arm W1 RAISES (the pre-fix body leaves computation_warned TRUE), so an
-- unapplied migration reads as a named failure, never as a skip.
--
-- ⭐ WHY EVERY IDENTITY CARRIES A DIGIT — `W1`, NOT `W`. `sectionOfIdentity`
-- in scripts/mutation-runner/run.mjs is
-- `id.replace(/(\d)[a-z]*(-[A-Za-z]+)?$/, "$1")`: a trailing `-SUFFIX`
-- collapses into its parent section only when a DIGIT precedes it. So
-- `W1-SETUP` and `W1-COMPOSITE` are sub-arms of section W1 and are covered by
-- W1's twin. Spelled without the digit they would be sections of their own, and
-- the section-coverage invariant would demand a twin for each.
--
-- ⚠️ The SETUP guards are deliberately NOT separately twinned. They are VACUITY
-- guards ("this fixture actually reached the branch this arm is about"), not
-- claims about the bridge, and a twin for one of them would have to break
-- PRODUCTION in order to break a FIXTURE. A SETUP guard firing still names
-- itself, so a failing run says whether the fixture or the claim broke.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO blocks, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_sync_status_bridge_residues.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST failure the
-- gate raises to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ EVERY twin that edits the bridge is LAYERED with an edit that stands down
-- the self-verify anchor 20261003120000 keeps over that edit. Without the layer
-- the migration's own DO $verify$ block RAISEs, the apply ABORTS, the gate never
-- runs and no arm can be the first failure: the runner then scores a defect, not
-- a bite. A positive anchor is stood down as `IF FALSE AND NOT <boolean> THEN`;
-- a count anchor is re-baselined to the post-edit count.
-- ⚠️ The apply list is the curated-sentence gate's list
-- (test_sync_status_curated_sentence_survives.sql), copied from that file, with
-- 20261003120000 appended LAST. 20260926120000 (the Phase 164.5.2 mark-RPC lock)
-- is deliberately ABSENT, as it is from that list: this gate drives the mark RPC
-- of 20260515114555, and this migration's DO block asserts nothing about the
-- mark RPC bodies.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql","supabase/migrations/20261003120000_sync_status_bridge_residues.sql"]}

BEGIN;

-- ===== ARM W1 — all terminal at X's mark, single-key ======================
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_jobstat  TEXT;
  v_jobsrc   TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres W1') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete_with_warnings', TRUE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  -- The Python honour write: sentence and both markers for X, status and
  -- warned untouched.
  UPDATE strategy_analytics
     SET computation_error        = 'The MT5 gateway did not answer this account for 6 hours.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;

  -- The retraction, landing after the honour write and before the mark.
  UPDATE compute_jobs
     SET metadata = jsonb_build_object('refresh_marker_retracted', 'ledger-refresh')
   WHERE id = j;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR v_jobsrc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W1-SETUP): X is % with source %, not a retracted failed_final, so the bridge was never asked to decide an UNPROTECTED failure and every assertion below would pass vacuously.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status, computation_warned INTO v_status, v_warned
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (W1-SETUP): the row reads % rather than failed after X''s permanent mark with nothing in flight, so branch (b) is not the branch under test.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: branch (b)'s warned assignment reverted to keep the old value
  --            (the pre-fix body never wrote computation_warned in branch (b)).
  --            ⚠️ LAYERED: the migration's anchor (ii) asserts that
  --            assignment and would abort the apply, so it is stood down in
  --            the same mutation.
  -- RED-UNDER-M: {"arm":"W1","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n","replace":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = strategy_analytics.computation_warned,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1}]}
  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (W1): the row reads failed with computation_warned = % after X''s permanent mark. X''s own writer reached the row (the provenance names X) and X is an UNPROTECTED live failure, so the warning flag describes nothing any more. Left up, the next bridge call with any sibling in flight publishes complete_with_warnings over a live permanent failure, which is [164.6.7-COMPOSITE-REREAD-RESIDUE].', COALESCE(v_warned::text, 'NULL');
  END IF;

  -- A later sibling enters flight, and its bridge call must not publish.
  INSERT INTO compute_jobs (strategy_id, kind, status)
  VALUES (s, 'process_key_long', 'pending');
  PERFORM sync_strategy_analytics_status(s);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (W1): with X still a live permanent failure and an unmarked sibling in flight, the bridge wrote computation_status = %. complete_with_warnings here is a funded account published as a warned success over a failed run.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM W1-COMPOSITE — the same scenario on stitch_composite ============
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_jobstat  TEXT;
  v_jobsrc   TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres W1C') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete_with_warnings', TRUE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'stitch_composite', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh-composite', 'enqueued_at', now()))
  RETURNING id INTO j;

  UPDATE strategy_analytics
     SET computation_error        = 'The composite could not be stitched from its legs.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;

  UPDATE compute_jobs
     SET metadata = jsonb_build_object('refresh_marker_retracted', 'ledger-refresh-composite')
   WHERE id = j;

  PERFORM mark_compute_job_failed(j, 'composite stitch failed', 'permanent', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR v_jobsrc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W1-COMPOSITE): SETUP: X is % with source %, not a retracted failed_final, so the composite scenario never reached the bridge as an UNPROTECTED failure.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status, computation_warned INTO v_status, v_warned
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (W1-COMPOSITE): SETUP: the row reads % rather than failed after X''s permanent mark with nothing in flight, so branch (b) is not the branch under test.', COALESCE(v_status, 'NULL');
  END IF;

  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (W1-COMPOSITE): the composite row reads failed with computation_warned = % after X''s permanent mark. The composite honour arm is a different Python writer from the single-key one; the residue was measured on both, and the flag left up publishes complete_with_warnings over the failed stitch on the next sibling call.', COALESCE(v_warned::text, 'NULL');
  END IF;

  INSERT INTO compute_jobs (strategy_id, kind, status)
  VALUES (s, 'process_key_long', 'pending');
  PERFORM sync_strategy_analytics_status(s);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (W1-COMPOSITE): with the failed stitch still live and an unmarked sibling in flight, the bridge wrote computation_status = % over a failed composite.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

ROLLBACK;
