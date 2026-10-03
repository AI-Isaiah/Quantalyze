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
-- Arms R* ([164.6.7-RETRY-PLAIN-COMPLETE], the D-05 keep). Every R arm starts
-- from a PLAIN 'complete' row with computation_warned FALSE and no provenance,
-- so the membership arms above never fire and every R arm reaches branch (a).
-- "Marked" means the job carries an in-scope refresh marker (ledger-refresh;
-- the composite arm uses ledger-refresh-composite on stitch_composite).
--   R1            a MARKED in-scope derive_broker_dailies job, failed
--                 transiently (left failed_retry): the row must still read
--                 complete. Pre-fix it is rewritten to computing.
--   R1-COMPOSITE  the same retry on stitch_composite. Folded into section R1.
--   R2  (guard)   R1's retry plus an UNMARKED out-of-scope sibling in flight:
--                 computing. Twin-only proof (unmarked-count conjunct dropped).
--   R3  (guard)   a MARKED process_key_long retry (kind out of scope):
--                 computing. Twin-only proof (kind test dropped from the FILTER).
--   R4  (guard)   an UNMARKED derive_broker_dailies retry: computing. Twin-only
--                 proof (marker test dropped from the FILTER).
--   R5            R1's scenario: the kept row's computing_started_at is NULL.
--                 Pre-fix (and with the status keep arm alone) it is stamped.
--   R6  (guard)   a live UNPROTECTED sibling failure (no provenance) beside a
--                 marked retry: computing. Twin-only proof (failed-count
--                 conjunct dropped). Derived at research (assumption A2),
--                 measured here.
--   INVARIANT     (named, NOT counted, no twin) a failed row with a marked
--                 retry goes computing: the keep holds a published row only.
--
-- Arms K* (FOUNDER DECISION 2026-10-03, "Hold the date for both", resolving
-- [164.5.2.1-02-KEPT-ROW-COMPUTED-AT]). When branch (a) KEEPS a row (it
-- already reads what branch (a) resolves it to), nothing was computed, so
-- computed_at, computation_error and both provenance markers are held.
--   K1            the plain keep (R1's scenario, with a sentence, writer
--                 provenance and an old computed_at): all four held. Pre-decision
--                 computed_at was re-stamped and the other three blanked.
--   K2            the warned keep (a complete_with_warnings row, an unmarked
--                 job in flight, a direct call): all four held. This changes
--                 PROD behaviour for the warned cohort, deliberately.
--   K3  (guard)   a FAILED row still carrying computation_warned, which branch
--                 (a) moves to complete_with_warnings, is a transition and holds
--                 nothing: its failure sentence is blanked. GREEN on both bodies
--                 by design; only its twin (the hold widened to branch (a)'s own
--                 warned test) proves it can fail.
--
-- The completion sentinel at the foot of the file counts the sixteen sections
-- W1..W7, R1..R6 and K1..K3, and ci.yml's sql-tests roster credits this file
-- with the same number.
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
-- ⚠️ LANE ASYMMETRY — W5 AND R5 CAN ONLY GO RED ON THE PG-LANE (review WR-02).
-- W5 and R5 measure the bridge's OWN stamp CASE (computing_started_at). The
-- schema of record also carries 20260803120000's BEFORE UPDATE row trigger
-- strategy_analytics_stamp_computing_started_trigger (it is in
-- supabase/schema/baseline.sql, so it is live on the sql-tests local stack and in
-- PROD). That trigger stamps now() on any update that leaves a computing row
-- unstamped, and clears the stamp on every row that is not computing. So on
-- sql-tests it produces W5's and R5's end states whatever the bridge's stamp CASE
-- writes, and both arms stay GREEN there over a deleted stamp arm. In PROD the
-- bridge's two stamp arms are defense-in-depth behind the trigger; a regression in
-- them is caught by sql-mutation on the pg-lane and by nothing on sql-tests.
-- 20260803120000 is deliberately kept OUT of the setup apply list below, and
-- adding it is not the fix: MEASURED 2026-10-03 on the pg-lane with only that
-- migration's trigger function and CREATE TRIGGER layered on via --post-apply
-- (its pg_cron reaper half is not needed to observe this), W5's twin edits leave
-- the gate exiting 0 with every arm executed, and so do R5's; without the trigger
-- each twin's first failure is its own arm. The trigger therefore makes both twins
-- unbiteable on BOTH lanes, and sql-mutation would score them as defects. Keeping
-- the trigger off this lane is what lets the two arms prove the bridge's own CASE.
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
  -- RED-UNDER-M: {"arm":"W1","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n","replace":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = strategy_analytics.computation_warned,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 8 THEN","replace":"IF v_membership_sites <> 7 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_warned_case_sites <> 2 THEN","replace":"IF v_warned_case_sites <> 1 THEN","occurrences":1}]}
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
  IF v_jobstat IS DISTINCT FROM 'failed_final' OR (v_y_at > v_x_at) IS NOT TRUE
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
  -- RED-UNDER-M: {"arm":"W2","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n           computing_started_at = NULL,","replace":"computation_error_job_id = v_latest_job_id THEN FALSE ELSE strategy_analytics.computation_warned END,\n           computing_started_at = NULL,","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 8 THEN","replace":"IF v_membership_sites <> 7 THEN","occurrences":1}]}
  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (W2): with a later-created unprotected sibling failure Y also live, X''s permanent mark left computation_warned = %. The flag must clear whenever the writer''s job is AMONG the unprotected live failures, not only when it is the latest one: branch (b) clears X''s provenance here (its sentence pick names Y), so nothing can clear the flag on any later call.', COALESCE(v_warned::text, 'NULL');
  END IF;

  -- Y is superseded by a strictly-later done of its own kind; X stays live.
  INSERT INTO compute_jobs (strategy_id, kind, status, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'done', now() - INTERVAL '30 minutes')
  RETURNING id INTO j_done;
  SELECT created_at INTO v_done_at FROM compute_jobs WHERE id = j_done;
  IF (v_done_at > v_y_at) IS NOT TRUE THEN
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
  -- RED-UNDER-M: {"arm":"W3","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)\n             THEN 'computing'\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_a_status_first_anchored THEN","replace":"IF FALSE AND NOT v_a_status_first_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 8 THEN","replace":"IF v_membership_sites <> 7 THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (W3): X''s own permanent mark, with a sibling still in flight, wrote computation_status = %. X is an unprotected live failure that its own writer reached, so this is the loud path: the row must read computing until the sibling finishes. complete_with_warnings here publishes a failed run as a warned success at the very call that recorded the failure.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: delete branch (a)'s new warned assignment. W3 asserts the status only,
  --            so it stays green. ⚠️ LAYERED: count anchors (iii) and (iv) re-baselined.
  -- RED-UNDER-M: {"arm":"W4","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n","replace":"","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 8 THEN","replace":"IF v_membership_sites <> 7 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_warned_case_sites <> 2 THEN","replace":"IF v_warned_case_sites <> 1 THEN","occurrences":1}]}
  IF v_warned IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (W4): X''s own permanent mark, with a sibling still in flight, left computation_warned = %. Branch (a) blanks the provenance in the same statement, so this is the ONLY call that can still tie the flag to X''s failure; left up, every later call publishes complete_with_warnings over the failed run.', COALESCE(v_warned::text, 'NULL');
  END IF;

  -- RED-UNDER: delete branch (a)'s membership stamp arm; the old warned flag then
  --            routes the stamp to its NULL arm. W3/W4 stay green. ⚠️ LAYERED: count
  --            anchor (iii) re-baselined.
  -- RED-UNDER-M: {"arm":"W5","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)\n             THEN CASE WHEN strategy_analytics.computation_status IS DISTINCT FROM 'computing' THEN now() ELSE strategy_analytics.computing_started_at END\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 8 THEN","replace":"IF v_membership_sites <> 7 THEN","occurrences":1}]}
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
  -- RED-UNDER-M: {"arm":"W6","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,\n","replace":"           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,\n           computation_warned = FALSE,\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_b_warned_anchored THEN","replace":"IF FALSE AND NOT v_b_warned_anchored THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_membership_sites <> 8 THEN","replace":"IF v_membership_sites <> 7 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_warned_case_sites <> 2 THEN","replace":"IF v_warned_case_sites <> 1 THEN","occurrences":1}]}
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
-- the branch the twin mutates. Asserts status and warned only: what branch (a)
-- does to the provenance differs by body (before the founder decision of
-- 2026-10-03 it cleared it; since, it HOLDS it on this kept warned row, which
-- arm K2 owns).
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

-- ===== ARM R1 — a marked in-scope retry keeps a plain complete row ========
-- [164.6.7-RETRY-PLAIN-COMPLETE]. The row is a plain published 'complete'
-- (warning cleared, no provenance), and its only in-flight job is the
-- recurring refresh arm's own derive_broker_dailies job, which fails
-- TRANSIENTLY and lands on failed_retry. Nothing is broken and nothing a user
-- started is running, so the published factsheet must stay published. Before
-- 20261003120000 branch (a) rewrote it to 'computing' on every marked retry,
-- and the wizard poller then read a published strategy as a running job.
-- Asserts status ONLY: R5 owns the reaper stamp.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
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
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R1') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (R1-SETUP): the refresh job is % with source %, not a MARKED failed_retry, so the bridge never decided a marked in-scope retry and the assertion below would pass vacuously.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: delete branch (a)'s status keep arm, so a plain complete row falls
  --            through to the ELSE and is rewritten to computing (the pre-fix
  --            behaviour). ⚠️ LAYERED: the keep-arm count anchor is re-baselined.
  -- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"             WHEN v_refresh_keep AND strategy_analytics.computation_status = 'complete'\n             THEN 'complete'\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_keep_arms <> 2 THEN","replace":"IF v_keep_arms <> 1 THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (R1): a plain complete row whose only in-flight job is a MARKED in-scope refresh retry now reads %. The recurring refresh arm retrying a transient venue error is not new work a user started; rewriting the published factsheet to computing on every such retry is [164.6.7-RETRY-PLAIN-COMPLETE].', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM R1-COMPOSITE — the same retry on stitch_composite ==============
-- The composite fan-out enqueues stitch_composite with the
-- ledger-refresh-composite marker. Folded into section R1 by the runner.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
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
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R1C') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'stitch_composite', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh-composite', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'composite leg not ready, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS DISTINCT FROM 'ledger-refresh-composite' THEN
    RAISE EXCEPTION 'TEST FAILED (R1-SETUP): the composite refresh job is % with source %, not a MARKED failed_retry, so the bridge never decided a marked in-scope retry.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (R1-COMPOSITE): a plain complete composite row whose only in-flight job is a MARKED stitch_composite retry now reads %. The composite refresh arm is a different enqueue path from the single-key one, and the residue holds on both ([164.6.7-RETRY-PLAIN-COMPLETE]).', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM R2 (guard) — an UNMARKED sibling in flight beside the retry ===
-- R1's retry plus an UNMARKED process_key_long sibling, pending. That sibling
-- is work a user is waiting on, so the row must read computing. GREEN on both
-- bodies by design; only its twin (the unmarked-count conjunct dropped from the
-- keep flag) proves it can fail. ⚠️ S is deliberately OUT of the refresh kind
-- scope: R4's twin drops the marker test from the FILTER, which would stop
-- counting an IN-scope unmarked sibling and redden this arm before R4.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
  v_jobstat  TEXT;
  v_jobsrc   TEXT;
  j_s        UUID;
  v_s_kind   TEXT;
  v_s_src    TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R2') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s, 'process_key_long', 'pending', 0, 3)
  RETURNING id INTO j_s;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (R2-SETUP): the retried job is % with source %, not a failed_retry carrying source ledger-refresh, so the bridge never decided the retry this arm is about.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT kind, metadata ->> 'source', status INTO v_s_kind, v_s_src, v_jobstat FROM compute_jobs WHERE id = j_s;
  IF v_s_kind IS DISTINCT FROM 'process_key_long' OR v_s_src IS NOT NULL OR v_jobstat IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (R2-SETUP): the sibling is % / % with source %, not an UNMARKED, OUT-of-scope process_key_long in flight, so this arm does not measure the unmarked-count conjunct.', v_s_kind, v_jobstat, COALESCE(v_s_src, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: drop the unmarked-count conjunct from v_refresh_keep, so an unmarked
  --            sibling in flight no longer stops the keep. ⚠️ LAYERED: the keep-flag
  --            anchor is stood down.
  -- RED-UNDER-M: {"arm":"R2","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n                    AND COALESCE(v_nonterminal_unmarked_count, 1) = 0","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_refresh_keep_anchored THEN","replace":"IF FALSE AND NOT v_refresh_keep_anchored THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (R2): with an UNMARKED sibling job in flight beside the refresh retry, the bridge wrote computation_status = %. That sibling is work a user started; keeping the row complete hides it from the wizard poller, which then reads a terminal success over a running job.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM R3 (guard) — a marker on an OUT-of-scope kind keeps nothing ===
-- process_key_long carrying the ledger-refresh source. No refresh arm enqueues
-- that kind, and its metadata source is request-derived (routers/process_key.py),
-- so the marker must not be trusted there. GREEN on both bodies by design; its
-- twin drops the kind test from the FILTER.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
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
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R3') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'process_key_long', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (R3-SETUP): the retried job is % with source %, not a failed_retry carrying source ledger-refresh, so the bridge never decided the retry this arm is about.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: drop the kind test from the unmarked FILTER, so a marked job of ANY kind
  --            counts as a refresh retry. ⚠️ LAYERED: the FILTER anchor is stood down.
  -- RED-UNDER-M: {"arm":"R3","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n           AND kind IN ('derive_broker_dailies',\n                        'compute_analytics_from_csv',\n                        'stitch_composite'),","replace":",","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_unmarked_filter_anchored THEN","replace":"IF FALSE AND NOT v_unmarked_filter_anchored THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (R3): a process_key_long job carrying a refresh marker kept the row at %. That kind is outside the refresh scope and its source value is request-derived; trusting it lets any request that spells the marker hold a published row over new work.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM R4 (guard) — an UNMARKED in-scope retry keeps nothing ==========
-- derive_broker_dailies with NO marker: a user-initiated resync failing
-- transiently. It is new work, so the row must read computing. GREEN on both
-- bodies by design; its twin drops the marker test from the FILTER.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
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
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R4') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R4-SETUP): the retried job is % with source %, not a failed_retry carrying no source, so the bridge never decided the retry this arm is about.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: drop the marker test from the unmarked FILTER, so every in-scope job
  --            counts as a refresh retry. ⚠️ LAYERED: the FILTER anchor is stood down.
  -- RED-UNDER-M: {"arm":"R4","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"           (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')\n           AND kind IN (","replace":"           kind IN (","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_unmarked_filter_anchored THEN","replace":"IF FALSE AND NOT v_unmarked_filter_anchored THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (R4): an UNMARKED derive_broker_dailies retry kept the row at %. Without a refresh marker the job is a user-initiated resync, and the poller must see it as computing.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM R5 — a kept row carries no reaper stamp ========================
-- R1's scenario on its own strategy. The kept row is not computing, so the
-- 16-hour stuck-computing reaper key must stay NULL; a stamp on a complete row
-- would make the reaper's view disagree with the status.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
  v_jobstat  TEXT;
  v_jobsrc   TEXT;
  v_anchor   TIMESTAMPTZ;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R5') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (R5-SETUP): the retried job is % with source %, not a failed_retry carrying source ledger-refresh, so the bridge never decided the retry this arm is about.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT computation_status, computing_started_at INTO v_status, v_anchor
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (R5-SETUP): the row reads % rather than complete, so the keep did not fire and the stamp assertion below would measure another arm.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: delete branch (a)'s stamp keep arm; the transition-in arm below it then
  --            stamps now() on the kept row. ⚠️ LAYERED: the keep-arm count anchor is
  --            re-baselined.
  -- RED-UNDER-M: {"arm":"R5","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"             WHEN v_refresh_keep AND strategy_analytics.computation_status = 'complete'\n             THEN NULL\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_keep_arms <> 2 THEN","replace":"IF v_keep_arms <> 1 THEN","occurrences":1}]}
  IF v_anchor IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R5): a row kept at complete carries computing_started_at = %. The stamp is the stuck-computing reaper key and means "entered computing at"; on a complete row it is a false transition the reaper and every operator query would read.', v_anchor;
  END IF;
END $$;

-- ===== ARM R6 (guard) — a live UNPROTECTED failure blocks the keep =======
-- A plain complete row with no provenance, an UNMARKED compute_analytics_from_csv
-- failed_final with no later done of its kind (a live, unprotected permanent
-- failure), and R1's marked retry. The row is broken, so it must not stay
-- published: computing now, and branch (b) once the retry terminates. GREEN on
-- both bodies (research assumption A2 derived it; this arm MEASURES it); its
-- twin drops the failed-count conjunct from the keep flag.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
  v_jobstat  TEXT;
  v_jobsrc   TEXT;
  j_f        UUID;
  v_f_stat   TEXT;
  v_f_src    TEXT;
  v_later    INTEGER;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres R6') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'complete', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'compute_analytics_from_csv', 'failed_final', 3, 3, now() - INTERVAL '1 hour')
  RETURNING id INTO j_f;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status, metadata ->> 'source' INTO v_jobstat, v_jobsrc FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_jobsrc IS DISTINCT FROM 'ledger-refresh' THEN
    RAISE EXCEPTION 'TEST FAILED (R6-SETUP): the retried job is % with source %, not a failed_retry carrying source ledger-refresh, so the bridge never decided the retry this arm is about.', v_jobstat, COALESCE(v_jobsrc, 'NULL');
  END IF;

  SELECT status, metadata ->> 'source' INTO v_f_stat, v_f_src FROM compute_jobs WHERE id = j_f;
  SELECT count(*) INTO v_later FROM compute_jobs
   WHERE strategy_id = s AND kind = 'compute_analytics_from_csv' AND status = 'done';
  IF v_f_stat IS DISTINCT FROM 'failed_final' OR v_f_src IS NOT NULL OR v_later IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'TEST FAILED (R6-SETUP): the sibling failure is % with source % and % done job(s) of its kind, so it is not a live UNPROTECTED failure and this arm does not measure the failed-count conjunct.', v_f_stat, COALESCE(v_f_src, 'NULL'), v_later;
  END IF;

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  -- RED-UNDER: drop the failed-count conjunct from v_refresh_keep, so a live unprotected
  --            failure no longer stops the keep. ⚠️ LAYERED: the keep-flag anchor is
  --            stood down.
  -- RED-UNDER-M: {"arm":"R6","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n                    AND COALESCE(v_failed_count, 1) = 0;","replace":";","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF NOT v_refresh_keep_anchored THEN","replace":"IF FALSE AND NOT v_refresh_keep_anchored THEN","occurrences":1}]}
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (R6): with a live UNPROTECTED permanent failure on the strategy, a marked refresh retry kept the row at %. The strategy is broken; the keep would publish it as healthy until the retry terminates.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== ARM K1 — the plain keep holds the vintage, the sentence, the markers =
-- FOUNDER DECISION 2026-10-03 ("Hold the date for both"), resolving
-- [164.5.2.1-02-KEPT-ROW-COMPUTED-AT]. R1's scenario on a row that also carries
-- a sentence and writer provenance (the honour path's write for the refresh
-- job X) and a computed_at three days old. The keep is not a computation, so
-- nothing it did may read as one: computed_at (the FreshnessChip and the PDF
-- vintage), computation_error and both provenance markers come back exactly as
-- seeded. Before this decision branch (a) stamped computed_at = now() and
-- blanked the other three on every marked retry, so a refresh that kept
-- failing transiently showed a fresher date than the last real compute.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_seed_at  TIMESTAMPTZ := now() - INTERVAL '3 days';
  v_status   TEXT;
  v_at       TIMESTAMPTZ;
  v_err      TEXT;
  v_src      TEXT;
  v_jid      UUID;
  v_jobstat  TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres K1') RETURNING id INTO s;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  -- INSERTed, not UPDATEd: the provenance trigger is UPDATE-only, so the seed
  -- is exactly what is written here.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at,
                                  computation_error, computation_error_source, computation_error_job_id)
  VALUES (s, 'complete', FALSE, v_seed_at,
          'The MT5 gateway did not answer this account for 6 hours.', 'writer', j);

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  SELECT computation_status, computed_at, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_at, v_err, v_src, v_jid
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' OR v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (K1-SETUP): the refresh job is % and the row reads %, not a marked failed_retry over a KEPT complete row, so the plain keep never fired and the assertion below would measure some other branch.', v_jobstat, COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: drop the plain-keep disjunct from all four hold CASEs in branch (a), so
  --            a kept complete row is re-stamped and blanked again (the pre-decision
  --            behaviour). ⚠️ LAYERED: the hold-CASE count anchor is re-baselined.
  -- RED-UNDER-M: {"arm":"K1","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)","replace":"","occurrences":4,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)","replace":"","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)","replace":"","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"\n                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_hold_cases <> 4 THEN","replace":"IF v_hold_cases <> 0 THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_seed_at OR v_err IS DISTINCT FROM 'The MT5 gateway did not answer this account for 6 hours.'
     OR v_src IS DISTINCT FROM 'writer' OR v_jid IS DISTINCT FROM j THEN
    RAISE EXCEPTION 'TEST FAILED (K1): a plain complete row KEPT over a marked refresh retry was rewritten: computed_at % (seeded %), computation_error %, source %, job %. Nothing was recomputed, so the FreshnessChip and the PDF vintage now show a date fresher than the last real compute, and the honour sentence that explains the failing refresh is gone (founder decision 2026-10-03).', v_at, v_seed_at, COALESCE(v_err, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_jid::text, 'NULL');
  END IF;
END $$;

-- ===== ARM K2 — the warned keep holds the vintage, the sentence, the markers =
-- The same founder decision on the PRE-EXISTING keep: a complete_with_warnings
-- row (the live ledger cohort's shape) with a sentence, writer provenance and a
-- three-day-old computed_at, and an UNMARKED job in flight. Branch (a) keeps
-- complete_with_warnings (its warned arm), and must now hold the other four
-- columns too. This deliberately changes PROD behaviour for the warned cohort:
-- before 2026-10-03 every sibling bridge call on such a row advanced
-- computed_at and blanked the sentence and both markers.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j_old      UUID;
  v_seed_at  TIMESTAMPTZ := now() - INTERVAL '3 days';
  v_status   TEXT;
  v_warned   BOOLEAN;
  v_at       TIMESTAMPTZ;
  v_err      TEXT;
  v_src      TEXT;
  v_jid      UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres K2') RETURNING id INTO s;

  -- The job the sentence is about, long finished; then the unrelated work.
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts, created_at)
  VALUES (s, 'derive_broker_dailies', 'done', 1, 3, now() - INTERVAL '3 days')
  RETURNING id INTO j_old;
  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s, 'process_key_long', 'pending', 0, 3);

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at,
                                  computation_error, computation_error_source, computation_error_job_id)
  VALUES (s, 'complete_with_warnings', TRUE, v_seed_at,
          'The MT5 gateway did not answer this account for 6 hours.', 'writer', j_old);

  -- The DEFERRED shape: a direct bridge call while the unrelated job is pending.
  PERFORM sync_strategy_analytics_status(s);

  SELECT computation_status, computation_warned, computed_at, computation_error,
         computation_error_source, computation_error_job_id
    INTO v_status, v_warned, v_at, v_err, v_src, v_jid
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' OR v_warned IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'TEST FAILED (K2-SETUP): the row reads % with computation_warned = %, not a KEPT complete_with_warnings row, so the warned keep never fired and the assertion below would measure some other branch.', COALESCE(v_status, 'NULL'), COALESCE(v_warned::text, 'NULL');
  END IF;
  -- RED-UNDER: drop the complete_with_warnings disjunct from all four hold CASEs in
  --            branch (a) (replaced by FALSE), so a kept warned row is re-stamped and
  --            blanked again. K1's plain keep is untouched. ⚠️ LAYERED: the
  --            hold-CASE count anchor is re-baselined.
  -- RED-UNDER-M: {"arm":"K2","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN FALSE\n                  OR (v_refresh_keep","occurrences":4,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN FALSE\n                  OR (v_refresh_keep","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN FALSE\n                  OR (v_refresh_keep","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN FALSE\n                  OR (v_refresh_keep","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_hold_cases <> 4 THEN","replace":"IF v_hold_cases <> 0 THEN","occurrences":1}]}
  IF v_at IS DISTINCT FROM v_seed_at OR v_err IS DISTINCT FROM 'The MT5 gateway did not answer this account for 6 hours.'
     OR v_src IS DISTINCT FROM 'writer' OR v_jid IS DISTINCT FROM j_old THEN
    RAISE EXCEPTION 'TEST FAILED (K2): a complete_with_warnings row KEPT by branch (a) while unrelated work was in flight was rewritten: computed_at % (seeded %), computation_error %, source %, job %. Nothing was recomputed, so the warned cohort''s FreshnessChip and PDF vintage advance on every sibling job (founder decision 2026-10-03).', v_at, v_seed_at, COALESCE(v_err, 'NULL'), COALESCE(v_src, 'NULL'), COALESCE(v_jid::text, 'NULL');
  END IF;
END $$;

-- ===== ARM K3 (guard) — a failed row bounced to complete_with_warnings holds NOTHING
-- The interpretation the founder decision rests on: the hold is for a KEEP (the
-- row already reads what branch (a) resolves it to), never for a TRANSITION.
-- Branch (a)'s warned arm also fires on a `failed` row that still carries
-- computation_warned (the SI-02 bounce state: a sibling's failure, no
-- provenance) and moves it to complete_with_warnings. Holding there would leave
-- the curated FAILURE sentence on a published factsheet. The sentence must be
-- blanked, as before. GREEN on both bodies by design; its twin widens the
-- hold's warned disjunct to branch (a)'s own warned test.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  v_status   TEXT;
  v_err      TEXT;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'bres-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'bres', 'bres-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'bres mt5', 'x', TRUE) RETURNING id INTO k;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres K3') RETURNING id INTO s;

  INSERT INTO compute_jobs (strategy_id, kind, status, attempts, max_attempts)
  VALUES (s, 'process_key_long', 'pending', 0, 3);

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at,
                                  computation_error)
  VALUES (s, 'failed', TRUE, now() - INTERVAL '3 days', computation_error_copy('compute_analytics_from_csv'));

  PERFORM sync_strategy_analytics_status(s);

  SELECT computation_status, computation_error INTO v_status, v_err
    FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'TEST FAILED (K3-SETUP): the failed+warned row reads %, not complete_with_warnings, so branch (a)''s warned arm did not move it and this guard measures nothing.', COALESCE(v_status, 'NULL');
  END IF;
  -- RED-UNDER: widen the hold's complete_with_warnings disjunct to branch (a)'s own
  --            warned test (status complete_with_warnings OR computation_warned), so a
  --            failed+warned row bounced to complete_with_warnings keeps its failure
  --            sentence. ⚠️ LAYERED: the SI-02 count anchor gains the four new
  --            spellings and is re-baselined; the hold-CASE count anchor is too.
  -- RED-UNDER-M: {"arm":"K3","apply":[{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN strategy_analytics.computation_status = 'complete_with_warnings' OR strategy_analytics.computation_warned\n                  OR (v_refresh_keep","occurrences":4,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN strategy_analytics.computation_status = 'complete_with_warnings' OR strategy_analytics.computation_warned\n                  OR (v_refresh_keep","occurrences":3,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN strategy_analytics.computation_status = 'complete_with_warnings' OR strategy_analytics.computation_warned\n                  OR (v_refresh_keep","occurrences":2,"nth":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"WHEN strategy_analytics.computation_status = 'complete_with_warnings'\n                  OR (v_refresh_keep","replace":"WHEN strategy_analytics.computation_status = 'complete_with_warnings' OR strategy_analytics.computation_warned\n                  OR (v_refresh_keep","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"FROM regexp_matches(v_fn, 'OR\\s+strategy_analytics\\.computation_warned', 'g')) <> 3 THEN","replace":"FROM regexp_matches(v_fn, 'OR\\s+strategy_analytics\\.computation_warned', 'g')) <> 7 THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20261003120000_sync_status_bridge_residues.sql","find":"IF v_hold_cases <> 4 THEN","replace":"IF v_hold_cases <> 0 THEN","occurrences":1}]}
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (K3): a failed row that branch (a) moved to complete_with_warnings kept its failure sentence (%). The hold is for a row that already reads what branch (a) resolves it to; a failed row is not a published factsheet, and its failure copy must not ride onto one.', v_err;
  END IF;
END $$;

-- ===== INVARIANT (named, NOT counted) — a failed row is never kept ========
-- A row at 'failed' with R1's marked retry must still go computing: the keep
-- protects a PUBLISHED row only. Uncounted and untwinned on purpose: the health
-- read and the keep arm's own `= 'complete'` test are mutually redundant, so no
-- single production mutation reddens it. It raises INVARIANT, never a section
-- identity, and stays outside the sentinel roster.
DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k          UUID;
  s          UUID;
  j          UUID;
  tok        UUID;
  v_status   TEXT;
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
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k, 'bres INV') RETURNING id INTO s;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s, 'failed', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s, 'derive_broker_dailies', 'running', tok, 0, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT computation_status INTO v_status FROM strategy_analytics WHERE strategy_id = s;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'INVARIANT (failed row with a marked retry): a failed row with a marked in-scope retry reads % instead of computing. The keep must only ever hold a published row; a failed row kept, or bounced to anything but computing, hides the retry from the poller.', COALESCE(v_status, 'NULL');
  END IF;
END $$;

-- ===== COMPLETION SENTINEL ==================================================
-- Reached only if every arm above passed. Counts the sixteen sections the
-- mutation runner counts: the -COMPOSITE and -SETUP sub-arms fold into their
-- parent section, and the INVARIANT is outside the roster by design.
DO $$
BEGIN
  RAISE NOTICE 'ALL 16 ARMS EXECUTED (W1, W2, W3, W4, W5, W6, W7, R1, R2, R3, R4, R5, R6, K1, K2, K3): [164.6.7-COMPOSITE-REREAD-RESIDUE] the bridge clears computation_warned and never publishes complete_with_warnings once the row''s writer-provenance job is an unprotected live failure, on both loud branches and on both refresh arms (W1..W5), while SI-02 and the protected honour path stay untouched (W6, W7); [164.6.7-RETRY-PLAIN-COMPLETE] a plain complete row keeps complete with no reaper stamp over a marked in-scope refresh retry (R1, R5), and an unmarked sibling, an out-of-scope marked kind, an unmarked retry or a live unprotected failure still moves it to computing (R2, R3, R4, R6); a KEPT row, plain or warned, holds computed_at, its sentence and both provenance markers, while a failed row moved to complete_with_warnings holds nothing (K1, K2, K3; founder decision 2026-10-03). Phase 164.5.2.1, mig 20261003120000.';
END $$;

ROLLBACK;
