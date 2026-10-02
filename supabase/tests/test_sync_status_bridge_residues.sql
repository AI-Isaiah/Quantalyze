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
--   W2            the A4 corner: a LATER-created unprotected sibling failure Y
--                 of another kind is also live at X's mark. Branch (b)'s
--                 sentence pick names Y, so the flag must clear on membership,
--                 not on "X is the latest". After Y is superseded, a sibling
--                 call must read computing. Pre-fix: the flag stays up and the
--                 row is later published as complete_with_warnings.
--   W3            a sibling IN FLIGHT at X's own mark (branch (a)): status
--                 computing, never complete_with_warnings.
--   W4            same scenario: computation_warned FALSE after the mark.
--   W5            same scenario: computing_started_at set after the mark, so
--                 the 16-hour reaper can see the row.
--   W6  (guard)   SI-02: an UNMARKED sibling's permanent failure on a row with
--                 no provenance keeps computation_warned TRUE. GREEN on the
--                 pre-fix AND the fixed body by design; only its twin (the fix
--                 widened to every loud failure) proves it can fail.
--   W7  (guard)   protected honour, never retracted, with a same-kind unmarked
--                 later successor in flight: X's mark keeps
--                 complete_with_warnings and computation_warned TRUE. GREEN on
--                 both bodies by design; only its twin (protected failures let
--                 into the id array) proves it can fail.
--
-- ⚠️ W1 alone is green under D-04 as first written (branch (b) only, keyed on
-- the latest failure). W2 is the arm that tells D-04 and D-04b apart, and
-- W3..W5 exist because a gate that marks X with nothing else in flight never
-- reaches branch (a).
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

  -- RED-UNDER: branch (b)'s warned assignment reverted to keep the old value (the
  --            pre-fix body never wrote computation_warned in branch (b)). ⚠️ LAYERED:
  --            anchor (ii) is stood down, and the two COUNT anchors (iii) and (iv) are
  --            re-baselined, because the edit removes one membership site and one
  --            warned CASE.
  -- RED-UNDER-M: {"arm":"W1","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n","replace":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = strategy_analytics.computation_warned,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 4 THEN","replace":"IF v_membership_sites <> 3 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_warned_case_sites <> 2 THEN","replace":"IF v_warned_case_sites <> 1 THEN","occurrences":1}]}
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

-- ===== ARM W2 — a LATER-created unprotected sibling failure (A4) ==========
-- branch (b) names the LATEST unprotected failure in its sentence pick, and
-- here that is Y, not X: the provenance is cleared at X's mark, so if the flag
-- were keyed on the latest failure alone nothing could ever clear it again,
-- and once Y is superseded the next sibling call publishes over X.
-- ⚠️ created_at is set EXPLICITLY on X, Y and Y's superseding done: now() is
-- fixed for the whole transaction, so without offsets the order would fall to
-- a random uuid. The W2-SETUP guards measure the order rather than trust it.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  j_y        UUID;
  j_done     UUID;
  tok        UUID;
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_jobstat  TEXT;
  v_x_at     TIMESTAMPTZ;
  v_y_at     TIMESTAMPTZ;
  v_done_at  TIMESTAMPTZ;
  v_y_kind   TEXT;
  v_y_src    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres W2') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete_with_warnings', TRUE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()),
          now() - INTERVAL '2 hours')
  RETURNING id INTO j;

  -- Y: an UNMARKED permanent failure of a DIFFERENT kind, created after X.
  INSERT INTO compute_jobs (strategy_id, kind, status, error_kind, last_error, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 'permanent',
          'a later, unrelated sibling failure', now() - INTERVAL '1 hour')
  RETURNING id INTO j_y;

  UPDATE strategy_analytics
     SET computation_error        = 'The MT5 gateway did not answer this account for 6 hours.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;

  UPDATE compute_jobs
     SET metadata = jsonb_build_object('refresh_marker_retracted', 'ledger-refresh')
   WHERE id = j;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT status, created_at INTO v_jobstat, v_x_at FROM compute_jobs WHERE id = j;
  SELECT created_at, kind, metadata ->> 'source' INTO v_y_at, v_y_kind, v_y_src FROM compute_jobs WHERE id = j_y;
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR NOT (v_y_at > v_x_at)
     OR v_y_kind = 'derive_broker_dailies' OR v_y_src IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W2-SETUP): X is % (created %), Y is % (created %, source %), so this is not the A4 corner (X failed_final, Y an unmarked failure of ANOTHER kind created strictly after X) and the assertions below would measure something else.', v_jobstat, v_x_at, v_y_kind, v_y_at, COALESCE(v_y_src, 'NULL');
  END IF;

  SELECT computation_status, computation_warned INTO v_status, v_warned
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (W2-SETUP): the row reads % rather than failed after X''s permanent mark with nothing in flight, so branch (b) is not the branch under test.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: branch (b)'s warned clear keyed on the LATEST unprotected failure
  --            (D-04 as first written) instead of membership. X is not the latest here
  --            (Y is), so the flag stays up; in W1 X is the latest, so W1 stays green.
  --            ⚠️ LAYERED: anchor (ii) stood down, count anchor (iii) re-baselined.
  -- RED-UNDER-M: {"arm":"W2","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n           computing_started_at = NULL,","replace":"computation_error_job_id = v_latest_job_id THEN FALSE ELSE strategy_analytics.computation_warned END,\n           computing_started_at = NULL,","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 4 THEN","replace":"IF v_membership_sites <> 3 THEN","occurrences":1}]}
  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (W2): with a later-created unprotected sibling failure Y also live, X''s permanent mark left computation_warned = %. The flag must clear whenever the writer''s job is AMONG the unprotected live failures, not only when it is the latest one: branch (b) clears X''s provenance here (its sentence pick names Y), so nothing can clear the flag on any later call.', COALESCE(v_warned::text, 'NULL');
  END IF;

  -- Y is superseded by a strictly-later done of its own kind; X stays live.
  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', now() - INTERVAL '30 minutes')
  RETURNING id INTO j_done;
  SELECT created_at INTO v_done_at FROM compute_jobs WHERE id = j_done;
  IF NOT (v_done_at > v_y_at) THEN
    RAISE EXCEPTION 'TEST FAILED (W2-SETUP): the superseding done (created %) is not strictly later than Y (created %), so Y is not superseded and the later call below is not the post-supersession state.', v_done_at, v_y_at;
  END IF;

  INSERT INTO compute_jobs (strategy_id, kind, status)
  VALUES (s, 'process_key_long', 'pending');
  PERFORM sync_strategy_analytics_status(s);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (W2): after Y was superseded, X is still a live permanent failure, and a sibling call wrote computation_status = %. complete_with_warnings here publishes a failed run as a warned success, and the A4 corner does not heal itself.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARMS W3 / W4 / W5 — a sibling IN FLIGHT at X's own mark ============
-- The commoner corner. With any sibling non-terminal at X's mark, the bridge
-- takes branch (a), not (b): before this fix branch (a) wrote
-- complete_with_warnings at that very call and blanked the provenance, so a
-- branch-(b)-only fix could never reach it. One scenario, three arms, each
-- asserting ONE column so each twin reddens its own arm first: W3 the status,
-- W4 the warning flag, W5 the reaper stamp.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  j_sib      UUID;
  tok        UUID;
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_stamp    TIMESTAMPTZ;
  v_jobstat  TEXT;
  v_jobsrc   TEXT;
  v_sibstat  TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres W3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computing_started_at)
  VALUES (s, 'complete_with_warnings', TRUE, NULL);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  -- The unmarked sibling, in flight BEFORE X's mark.
  INSERT INTO compute_jobs (strategy_id, kind, status)
  VALUES (s, 'process_key_long', 'pending')
  RETURNING id INTO j_sib;

  UPDATE strategy_analytics
     SET computation_error        = 'The MT5 gateway did not answer this account for 6 hours.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;

  UPDATE compute_jobs
     SET metadata = jsonb_build_object('refresh_marker_retracted', 'ledger-refresh')
   WHERE id = j;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  SELECT status INTO v_sibstat FROM compute_jobs WHERE id = j_sib;
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR v_jobsrc IS NOT NULL
     OR v_sibstat IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (W3-SETUP): X is % with source % and the sibling is %, so X''s mark did not reach branch (a) with a retracted, unprotected X and a sibling still in flight.', v_jobstat, COALESCE(v_jobsrc, 'NULL'), v_sibstat;
  END IF;

  SELECT computation_status, computation_warned, computing_started_at
    INTO v_status, v_warned, v_stamp
    FROM strategy_analytics WHERE strategy_id = s;

  -- RED-UNDER: delete branch (a)'s membership status arm, so the complete_with_warnings
  --            arm wins again at X's mark. ⚠️ LAYERED: order anchor (v) stood down,
  --            count anchor (iii) re-baselined.
  -- RED-UNDER-M: {"arm":"W3","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)\n             THEN 'computing'\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_a_status_first_anchored THEN","replace":"IF FALSE AND NOT v_a_status_first_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 4 THEN","replace":"IF v_membership_sites <> 3 THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (W3): X''s own permanent mark, with a sibling still in flight, wrote computation_status = %. X is an unprotected live failure that its own writer reached, so this is the loud path: the row must read computing until the sibling finishes. complete_with_warnings here publishes a failed run as a warned success at the very call that recorded the failure.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: delete branch (a)'s new warned assignment. W3 asserts the status only,
  --            so it stays green. ⚠️ LAYERED: count anchors (iii) and (iv) re-baselined.
  -- RED-UNDER-M: {"arm":"W4","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n           computation_error  = EXCLUDED.computation_error,\n","replace":"           computation_error  = EXCLUDED.computation_error,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 4 THEN","replace":"IF v_membership_sites <> 3 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_warned_case_sites <> 2 THEN","replace":"IF v_warned_case_sites <> 1 THEN","occurrences":1}]}
  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (W4): X''s own permanent mark, with a sibling still in flight, left computation_warned = %. Branch (a) blanks the provenance in the same statement, so this is the ONLY call that can still tie the flag to X''s failure; left up, every later call publishes complete_with_warnings over the failed run.', COALESCE(v_warned::text, 'NULL');
  END IF;

  -- RED-UNDER: delete branch (a)'s membership stamp arm; the old warned flag then
  --            routes the stamp to its NULL arm. W3/W4 stay green. ⚠️ LAYERED: count
  --            anchor (iii) re-baselined.
  -- RED-UNDER-M: {"arm":"W5","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)\n             THEN CASE WHEN strategy_analytics.computation_status IS DISTINCT FROM 'computing' THEN now() ELSE strategy_analytics.computing_started_at END\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 4 THEN","replace":"IF v_membership_sites <> 3 THEN","occurrences":1}]}
  IF v_stamp IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (W5): after X''s mark, with a sibling still in flight, computing_started_at is NULL. The row must be stamped as it enters computing; the 16-hour reaper keys on that stamp, so a row parked at computing with no stamp is never reaped if the sibling wedges.';
  END IF;
END $$;

-- ===== ARM W6 — SI-02 guard: a sibling's failure keeps the warning ========
-- GREEN on both the pre-fix and the fixed body BY DESIGN; only its twin proves
-- it can fail. The row carries NO provenance (no writer reached it for this
-- failure), and an UNMARKED sibling Z fails permanently. The flag is the
-- runner's record of an earlier warned success, and branch (c) restores it
-- once Z is superseded (SI-02, mig 20260708120000). Clearing it here would be
-- the fix widened past its own predicate.
-- ⚠️ Z must be UNMARKED: a marked Z on a healthy row is PROTECTED, which skips
-- branch (b) entirely and leaves the twin nothing to bite. W6-SETUP checks it.
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
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres W6') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete_with_warnings', TRUE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s, 'process_key_long', 'running', tok, 1, 3)
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue rejected the key', 'permanent', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  SELECT computation_status, computation_warned INTO v_status, v_warned
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR v_jobsrc IS NOT NULL
     OR v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (W6-SETUP): Z is % with source %, and the row reads %, so Z''s mark did not reach branch (b) as an UNMARKED unprotected failure and the warned assertion below would measure some other branch.', v_jobstat, COALESCE(v_jobsrc, 'NULL'), COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: branch (b)'s warned CASE replaced by an unconditional FALSE, i.e. the
  --            fix widened to every loud failure. W1/W2 expect FALSE anyway and
  --            W3..W5 reach branch (a), so W6 is the first to fail. ⚠️ LAYERED: anchor
  --            (ii) stood down, count anchors (iii) and (iv) re-baselined.
  -- RED-UNDER-M: {"arm":"W6","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n","replace":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = FALSE,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 4 THEN","replace":"IF v_membership_sites <> 3 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_warned_case_sites <> 2 THEN","replace":"IF v_warned_case_sites <> 1 THEN","occurrences":1}]}
  IF v_warned IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (W6): a sibling''s permanent failure, on a row no writer stamped for it, cleared computation_warned (now %). The flag records an earlier warned success that branch (c) restores once the sibling is superseded (SI-02); the residue fix may clear it ONLY when the row''s own writer-provenance job is the unprotected failure.', COALESCE(v_warned::text, 'NULL');
  END IF;
END $$;

-- ===== ARM W7 — protected honour guard: no retraction, nothing changes ====
-- GREEN on both bodies BY DESIGN; only its twin proves it can fail. X keeps its
-- ledger-refresh marker (in scope, row healthy), so X is PROTECTED and the new
-- id array holds only UNPROTECTED failures: here it is NULL and every new arm
-- falls through. A same-kind, unmarked, later-created successor Y is in flight,
-- so the protected-hold stands down and X's mark takes branch (a), which is
-- the branch the twin mutates. Asserts status and warned only: branch (a)
-- clears the provenance on every body (the Phase 164.2 contract).
-- ⚠️ Y is failed_retry, NOT pending: the partial unique index
-- compute_jobs_one_inflight_per_kind_strategy forbids a second pending or
-- running row of the same kind beside X, while the bridge's in-flight count and
-- the live-successor test both count failed_retry as in flight.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  j_y        UUID;
  tok        UUID;
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_jobstat  TEXT;
  v_x_at     TIMESTAMPTZ;
  v_x_src    TEXT;
  v_y_at     TIMESTAMPTZ;
  v_y_kind   TEXT;
  v_y_src    TEXT;
  v_y_stat   TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres W7') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete_with_warnings', TRUE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata, created_at)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()),
          now() - INTERVAL '2 hours')
  RETURNING id INTO j;

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'derive_broker_dailies', 'failed_retry', 1, 3, now() - INTERVAL '1 hour')
  RETURNING id INTO j_y;

  UPDATE strategy_analytics
     SET computation_error        = 'The MT5 gateway did not answer this account for 6 hours.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s;

  SELECT created_at, metadata ->> 'source' INTO v_x_at, v_x_src FROM compute_jobs WHERE id = j;
  SELECT created_at, kind, metadata ->> 'source', status
    INTO v_y_at, v_y_kind, v_y_src, v_y_stat
    FROM compute_jobs WHERE id = j_y;
  IF v_x_src IS DISTINCT FROM 'ledger-refresh' OR v_y_kind IS DISTINCT FROM 'derive_broker_dailies'
     OR v_y_src IS NOT NULL OR v_y_stat IS DISTINCT FROM 'failed_retry' OR NOT (v_y_at > v_x_at) THEN
    RAISE EXCEPTION 'TEST FAILED (W7-SETUP): X carries source % (created %), Y is % / % / source % (created %), so X is not a protected honour with a same-kind, unmarked, later-created successor in flight, and X''s mark would not reach branch (a) with a protected-only failure set.', COALESCE(v_x_src, 'NULL'), v_x_at, v_y_kind, v_y_stat, COALESCE(v_y_src, 'NULL'), v_y_at;
  END IF;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (W7-SETUP): X is %, not failed_final, so the bridge was never asked to decide X''s failure.', v_jobstat;
  END IF;

  SELECT computation_status, computation_warned INTO v_status, v_warned
    FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: drop the FILTER from the new id pick, so PROTECTED failures enter the
  --            membership array and branch (a)'s new arms fire on X. W1..W6 hold no
  --            protected live failure, so their arrays are unchanged. ⚠️ LAYERED:
  --            anchor (i) spans the pick and its FILTER, so it is stood down.
  -- RED-UNDER-M: {"arm":"W7","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"    array_agg(id) FILTER (WHERE NOT is_protected)\n    INTO v_failed_count","replace":"    array_agg(id)\n    INTO v_failed_count","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_unprotected_agg_anchored THEN","replace":"IF FALSE AND NOT v_unprotected_agg_anchored THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete_with_warnings' OR v_warned IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (W7): a PROTECTED refresh failure (marker never retracted, row healthy) changed the published state to % with computation_warned = %. Only an UNPROTECTED failure may enter the membership array; a protected one must leave the row exactly as the honour path left it.', COALESCE(v_status, 'NULL'), COALESCE(v_warned::text, 'NULL');
  END IF;
END $$;

ROLLBACK;
