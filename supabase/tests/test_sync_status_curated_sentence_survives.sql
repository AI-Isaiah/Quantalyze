-- Test: a WRITER-CURATED computation_error sentence SURVIVES the compute_jobs
-- transition that resolves the failure it describes — and is overwritten by the
-- per-kind generic on every path where it does not describe that failure.
-- Guards migration 20260906120000_computation_error_provenance.sql
-- (Phase 164.2 / criterion 1 + criterion 2, CURATED-COPY).
--
-- What makes this gate worth having
-- ---------------------------------
-- Criterion 1 of this phase is stated as a MEASUREMENT: the curated sentence
-- must be "proven by a test that performs the transition and asserts the
-- sentence survives it. Inspection of the bridge is not evidence." There is no
-- trigger to poke: the bridge is PERFORMed INSIDE the RPCs —
-- mark_compute_job_failed (mig 20260515114555, the revision this gate applies)
-- and mark_compute_job_done (same file) both end in
-- `PERFORM sync_strategy_analytics_status(v_strategy_id)`. So the only way to
-- assert on what the bridge does is to drive the real RPC on a real cluster and
-- read strategy_analytics back. Every arm below does exactly that.
--
-- ⛔ WHY THIS FILE EXISTS BESIDE test_sync_status_marked_refresh_protected.sql,
-- which already has arms M2 and M3 making two of the claims below
-- ---------------------------------------------------------------------------
-- That file's 23 arms say `ARM x FAILED`. That spelling is INVISIBLE to the
-- mutation runner's first-failure identity regex (its own header states this at
-- :139-143 — "a mutation that reddens an arm scores NO-IDENTITY, not RED"), so
-- the single twinned section in that file is the applied-ness gate `0a` and the
-- 23 behavioural arms contribute NOTHING to ARMS_FLOOR. They are proof-shaped
-- and machine-unattributable.
--
-- This file is the same claims, plus four the other file does not make, in the
-- `TEST FAILED (X):` idiom the runner CAN attribute — so each of the seven arms
-- below carries a RED-UNDER-M twin that is EXECUTED on every push, mutating the
-- migration on a throwaway pg-lane cluster and requiring THIS arm to be the
-- FIRST failure. Two of the arms (S1, P1) restate M2 / M3; the other five are new
-- coverage. The overlap is deliberate and is stated here rather than hidden:
-- what it buys is machine attribution, not a second opinion.
--
-- Arms:
--   S1  the curated sentence SURVIVES  — a writer stamps a sentence and both
--                                        markers for job J; mark_compute_job_failed
--                                        (J, …, 'permanent', tok) resolves J
--                                        through branch (b); the sentence, the
--                                        status 'failed' and BOTH markers must
--                                        come back unchanged. This is criterion
--                                        1's headline. (Restates arm M2 of the
--                                        sibling gate, attributably.)
--   C1  the CONTROL, branch (b)       — byte-identical fixture with NO markers
--                                        and a stale sentence in the column. It
--                                        must be replaced by the per-kind
--                                        generic, spelled LITERALLY. Without C,
--                                        a bridge that keeps EVERY sentence
--                                        passes S1. Also the "no backfill" claim:
--                                        NULL markers behave exactly as before.
--   O1  an OLDER job's marker LOSES    — the case 20260826120000's header called
--                                        undecidable, and the reason the
--                                        predicate is an EQUALITY and not a
--                                        presence test. The row carries
--                                        ('writer', J_old) for a still-live
--                                        older failure; the branch resolves a
--                                        NEWER failure J. Generic, and BOTH
--                                        markers cleared. No other arm anywhere
--                                        distinguishes an equality from a
--                                        presence test.
--   D1  branch (c) clears the markers  — mark_compute_job_done drives the
--                                        all-done success write, which must
--                                        leave NO marker behind. ⚠️ Its fixture
--                                        is deliberate; see THE TRIGGER MASKS
--                                        TWO ARMS below.
--   P1  branch (b-prime) SURVIVES      — the D-15 recurring-refresh path, where
--                                        the row stays PUBLISHED and this
--                                        sentence is the entire explanation the
--                                        user gets. Separate statement, separate
--                                        CASE, separate variable from branch (b),
--                                        so S1 does not imply it. Also asserts
--                                        computed_at did not move. (Restates arm
--                                        M3 of the sibling gate, attributably.)
--   PC1 the CONTROL, branch (b-prime)  — same fixture without the markers: the
--                                        per-kind generic, and both markers NULL.
--                                        Without PC1, a b-prime that keeps EVERY
--                                        sentence passes P1.
--   R1  branch (a) clears the markers   — the RETRYABLE transition. A 'transient'
--                                        failure with attempts left lands on
--                                        failed_retry, which the bridge counts as
--                                        NON-terminal, so the row is re-entered at
--                                        'computing' and both markers must go.
--                                        ⚠️ Its fixture is deliberate too.
--
-- ⭐ W6 — WHY THIS ROSTER COVERS EVERY PATH ON WHICH A compute_jobs ROW
--         TRANSITIONS, BY BRANCH
-- ---------------------------------------------------------------------------
-- The bridge has exactly four write branches plus a no-op, and every caller
-- reaches it the same way (a PERFORM at the end of a mark RPC):
--   (a) any NON-TERMINAL job in flight → 'computing', markers cleared
--       unconditionally. Reached by mark_compute_job_failed with a RETRYABLE
--       kind ('transient'/'unknown' with attempts left, mig 20260515114555's
--       `ELSE v_new_status := 'failed_retry'`), because the bridge counts
--       failed_retry as non-terminal. → ARM R1.
--       ⚠️ It is ALSO the branch the DEFERRED Python path reaches:
--       services.job_worker.dispatch PERFORMs this same function directly while
--       the job is still non-terminal. The CALLER differs; the branch and its
--       write do not, so ARM R1 is that path's proof as well.
--   (b) all terminal, a non-superseded UNPROTECTED failed_final → 'failed' with
--       the per-kind sentence, conditionally preserved. Reached by
--       mark_compute_job_failed with 'permanent', or with attempts exhausted.
--       → ARMS S1 (keep), C1 (overwrite, no marker), O1 (overwrite, wrong job).
--   (b-prime) all live failures are PROTECTED marked refreshes over a healthy
--       published row → record the sentence, change nothing a subscriber sees.
--       → ARMS P1 (keep), PC1 (overwrite).
--   (c) all rows 'done' → terminal success, sentence and markers blanked.
--       Reached by mark_compute_job_done. → ARM D1.
--   (d) no compute_jobs rows at all → early RETURN, writes nothing. There is no
--       marker decision on a branch that does not write.
-- There is no fifth branch, and no other writer of compute_jobs.status PERFORMs
-- this bridge — see the writer census in 20260826120000's header (:73-160) and
-- the enumeration in 20260906120000's ⛔⛔ paragraph.
--
-- ⭐⭐ THE TRIGGER MASKS TWO ARMS, AND THAT IS WHY D AND R ARE FIXTURED THE WAY
--     THEY ARE. MEASURED, not assumed.
-- ---------------------------------------------------------------------------
-- 20260906120000 STEP 3 adds a BEFORE UPDATE trigger,
-- strategy_analytics_drop_stale_error_provenance_trigger, whose whole content
-- is: a statement that CHANGES computation_error WITHOUT RESTATING the two
-- markers drops them. That trigger is a SECOND mechanism producing the SAME
-- observable outcome as branches (a) and (c)'s own unconditional marker clears.
--
-- So the obvious fixture for D1 and R1 — a writer-curated sentence in the column,
-- then the RPC — CANNOT FAIL under the twin that deletes those clears: the
-- branch blanks the sentence, the twin has removed the marker assignments from
-- the SET list, the trigger's guard therefore holds, and the trigger clears the
-- markers instead. The arm goes green over a deleted fix. That is this phase's
-- own lesson (*the same row is a COUPLING guard in one place and a COPY guard in
-- another*, plans 05 and 09) and the founder rule it serves: a test that CANNOT
-- FAIL is worse than none.
--
-- Both arms are therefore fixtured on the ONE state the trigger cannot reach:
-- computation_error is ALREADY NULL while both markers stand. The trigger is
-- UPDATE-only by design (a fresh row's markers describe the sentence inserted
-- beside them), so that state is produced by an INSERT — which is exactly how a
-- PostgREST upsert creates a strategy_analytics row, and the pairing CHECK
-- admits it because both markers are present. On that row the branch writes
-- computation_error = NULL over a NULL, the trigger's first conjunct is FALSE,
-- and the branch's OWN unconditional clears are the only thing that can remove
-- the markers. That is the claim these two arms pin, and it is the residual the
-- trigger explicitly does not cover.
--
-- ⚠️ Each arm's sentence assertion is therefore stated where it can fail, and
-- NOT stated where it cannot: D1 and R1 assert their branch was reached (the
-- SETUP guards) and then assert the markers, never "the sentence is NULL" —
-- which is the value the fixture already held.
--
-- ⭐ WHY EVERY IDENTITY CARRIES A DIGIT — `S1`, NOT `S`. It is a mechanical
-- requirement, not a style choice, and it was found by the invariant rather
-- than assumed. `sectionOfIdentity` (scripts/mutation-runner/run.mjs:2548) is
-- `id.replace(/(\d)[a-z]*(-[A-Za-z]+)?$/, "$1")`: a trailing `-SUFFIX` collapses
-- into its parent SECTION only when a DIGIT precedes it. So `S1-SETUP` is a
-- SUB-ARM of section `S1` and is covered by S1's twin — exactly as the sibling
-- gate's `0b` and `0c` are sub-arms of its section `0` and are covered by twin
-- `0a`. Spelled `S-SETUP` it would be its OWN section, and the 164.4-02
-- section-coverage invariant (src/__tests__/mutation-annotation-parser.test.ts)
-- would demand a twin for it — correctly, on its own terms: it refuses a file
-- that raises for a section nothing has proven can fail. MEASURED here: the
-- first draft used `S-SETUP` and that test named all six guards.
--
-- ⚠️ The SETUP guards are deliberately NOT separately twinned. They are VACUITY
-- guards — "this fixture actually reached the branch this arm is about" — not
-- claims about the bridge, and a twin for one of them would have to break
-- PRODUCTION in order to break a FIXTURE, which inverts what the twin is for.
-- Grouping them into their arm's section is the repo's sanctioned shape for
-- exactly this, and it costs nothing: a SETUP guard firing still names itself
-- (`TEST FAILED (S1-SETUP)`), so a failing run says whether the FIXTURE or the
-- CLAIM broke without anyone reading the message.
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL DO block, RAISE EXCEPTION
-- on failure. No psql meta-commands. Under psql -v ON_ERROR_STOP=1 a failed
-- assertion exits non-zero. The whole test rolls back.
--
-- ⛔ THE APPLIED-NESS GATE RAISES. IT DOES NOT SKIP (WR-03). Arm 0 keys on
-- pg_attribute for strategy_analytics.computation_error_source, NOT on anything
-- inside the bridge body: a presence gate that is a substring of the thing under
-- test stops seeing it exactly when the thing is neutered, prints a skip and
-- exits 0 (MEASURED on the sibling gate, its :218-227). The column is written by
-- 20260906120000 and by nothing else, and is part of no branch.
--
-- ⚠️ ON SHARED TEST THIS IS EXPECTED TO FIRE, and it is not a coupling
-- regression. CI's `sql-tests` runs every supabase/tests/test_*.sql against
-- TEST_SUPABASE_DB_URL, and NO workflow applies migrations to TEST (TODOS
-- SKIP-01, CI-MIGRATE-01). From this PR's first CI run until someone
-- hand-applies 20260906120000_computation_error_provenance.sql to TEST, arm 0
-- fires here — and ONLY here: the three gates coupled to that migration never
-- read the new columns. Apply the migration to TEST; do NOT convert this to a
-- skip, and do NOT reword it to a phrasing CI's SKIP grep cannot see.
--
-- The final 'ALL 7 ARMS EXECUTED (S1, C1, O1, D1, P1, PC1, R1)' notice is the sentinel
-- CI's loop reads the arm count off. If you add or remove an arm, update BOTH
-- the integer and the roster on that line: `sql-tests` counts the roster's
-- entries and fails when they disagree with N, which is what makes deleting an
-- arm cost two edits in the same string instead of one silent decrement.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_sync_status_curated_sentence_survives.sql
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- `RED-UNDER-M` object that scripts/mutation-runner executes on every push: it
-- mutates COPIES on a throwaway pg-lane cluster, requires the FIRST
-- `TEST FAILED (…)` to name that arm, and restores GREEN. Schema:
-- scripts/mutation-runner/GRAMMAR.md.
-- ⚠️ EVERY twin that edits a branch of the bridge is LAYERED with an edit that
-- DISABLES the self-verify anchor 20260906120000 keeps over that branch. Without
-- the layer the migration's own DO $verify$ block RAISEs, the apply ABORTS, the
-- gate never runs and no arm can be the FIRST failure — the runner then scores a
-- defect rather than a bite (the lesson at
-- test_compute_jobs_error_kind_copy_parity.sql:252-271). The layer is spelled
-- `IF FALSE AND v_fn !~ …`, which is the smallest edit that leaves the anchor's
-- text in place so a reader can see exactly which assertion was stood down.
-- ⚠️ The apply list is byte-identical to
-- test_sync_status_marked_refresh_protected.sql:156, which already ends at
-- 20260906120000 (appended there by plan 06's three-reviewer fix pass, because
-- its own new arms read these columns). 20260510173005 is deliberately ABSENT —
-- it is one of the three booked [REDUNDER-SAVEPOINT] migrations and aborts any
-- lane; 20260510175507 is the repair migration and registers `process_key_long`
-- on its own.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/27-fixture-strategy-analytics-computation-error.sql","supabase/migrations/20260411144407_compute_jobs_queue.sql","scripts/pg-lane/fixtures/04-fixture-compute-jobs-targets.sql","supabase/migrations/20260510175507_process_key_long_compute_job_kinds_repair.sql","supabase/migrations/20260515114555_compute_jobs_claim_token_fencing.sql","supabase/migrations/20260522111858_compute_analytics_from_csv_kind.sql","supabase/migrations/20260614120000_derive_broker_dailies_kind.sql","supabase/migrations/20260708120000_sync_status_failed_final_bounce.sql","supabase/migrations/20260710120000_strategy_keys.sql","supabase/migrations/20260710130000_stitch_composite_kind.sql","supabase/migrations/20260825150000_sync_status_protect_marked_refresh.sql","supabase/migrations/20260826120000_computation_error_curated_copy.sql","supabase/migrations/20260906120000_computation_error_provenance.sql"]}

BEGIN;

DO $$
DECLARE
  uid        UUID := gen_random_uuid();
  k_mt5      UUID;
  s_s        UUID;  -- Arm S1:  the writer's sentence survives branch (b)
  s_c        UUID;  -- Arm C1:  the unmarked control on branch (b)
  s_o        UUID;  -- Arm O1:  a marker naming an OLDER job must lose
  s_d        UUID;  -- Arm D1:  branch (c) leaves no marker behind
  s_p        UUID;  -- Arm P1:  the writer's sentence survives branch (b-prime)
  s_pc       UUID;  -- Arm PC1: the unmarked control on branch (b-prime)
  s_r        UUID;  -- Arm R1:  branch (a) leaves no marker behind
  j          UUID;
  j_old      UUID;
  tok        UUID;
  v_status   TEXT;
  v_error    TEXT;
  v_src      TEXT;
  v_jobid    UUID;
  v_jobstat  TEXT;
  v_computed TIMESTAMPTZ;
  v_before   TIMESTAMPTZ;
  v_old_at   TIMESTAMPTZ;
  v_new_at   TIMESTAMPTZ;
  -- ⛔ SPELLED LITERALLY, never as `computation_error_copy('permanent')`.
  -- Asserting equality against the function would pass against a copy function
  -- that leaks its argument or returns its input — i.e. it would be an
  -- assertion that cannot fail for the reason we care about. Copied from
  -- 20260826120000_computation_error_curated_copy.sql:285.
  c_perm     TEXT := 'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.';
BEGIN
  -- ===== ARM 0 — applied-ness. ABSENCE IS A FAILURE, NOT A SKIP ===========
  -- RED-UNDER: drop the column on the live lane AFTER the apply list has run,
  --            so the gate meets a database on which 20260906120000 is not in
  --            force. ⚠️ A `sql` step and NOT an `edit` that typos the
  --            ADD COLUMN: that migration's own pg_attribute self-verify would
  --            RAISE, abort the apply, and no arm could be the FIRST failure —
  --            the runner scores a defect, not a bite (the LAYERING lesson,
  --            test_compute_jobs_error_kind_copy_parity.sql:252-271). The
  --            lane's --post-apply hook exists for exactly this shape.
  -- RED-UNDER-M: {"arm":"0","apply":[{"kind":"sql","stmt":"ALTER TABLE public.strategy_analytics DROP COLUMN computation_error_source"}]}
  IF NOT EXISTS (
       SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = 'public.strategy_analytics'::regclass
          AND a.attname = 'computation_error_source'
          AND NOT a.attisdropped
     ) THEN
    RAISE EXCEPTION 'TEST FAILED (0): public.strategy_analytics has no computation_error_source column on this database, so arms S1, C1, O1, D1, P1, PC1 and R1 would have died on a raw 42703 naming no arm — or, worse, been deleted by a future reader who read that 42703 as "these arms are broken". TWO causes fit and this assertion cannot distinguish them, so check both: (i) this database has not received 20260906120000_computation_error_provenance.sql — apply it and re-run; expect this exactly once on the PR that introduces it, because NO workflow applies migrations to TEST; (ii) the columns were dropped by a later migration, which reverts criterion 2 outright — the bridge would then abort with 42703 on the live money path, on EVERY terminal compute-job transition. ⛔ Do NOT "fix" this by turning it into a RAISE NOTICE skip, and do not reword it to any phrasing CI''s SKIP grep cannot see: that is what made a sibling gate assert nothing while reading green.';
  END IF;

  -- ----- SEED ------------------------------------------------------------
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid, '00000000-0000-0000-0000-000000000000',
          'ccs-' || uid::text || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid, 'ccs', 'ccs-' || uid::text || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (uid, 'mt5', 'ccs mt5', 'x', TRUE) RETURNING id INTO k_mt5;

  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs S')  RETURNING id INTO s_s;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs C')  RETURNING id INTO s_c;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs O')  RETURNING id INTO s_o;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs D')  RETURNING id INTO s_d;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs P')  RETURNING id INTO s_p;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs PC') RETURNING id INTO s_pc;
  INSERT INTO strategies (user_id, api_key_id, name) VALUES (uid, k_mt5, 'ccs R')  RETURNING id INTO s_r;

  v_before := now() - INTERVAL '3 days';

  -- ===== ARM S1 — the curated sentence SURVIVES the transition ============
  -- The headline of criterion 1. Note the ORDER: the writer stamps the sentence
  -- and BOTH markers in ONE statement (which is what the pairing CHECK requires
  -- and what the writer plan will send), and only THEN is the job resolved. The
  -- assertion is read back out of the table AFTER the RPC, never inspected in
  -- the bridge's body.
  --
  -- The row is seeded at 'computing' rather than published, so
  -- v_publish_healthy is FALSE, the failure is UNPROTECTED and branch (b) — not
  -- (b-prime) — is the branch under test. Arms P/PC are the published half.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s_s, 'computing', FALSE);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_s, 'derive_broker_dailies', 'running', tok, 1, 3)
  RETURNING id INTO j;

  -- The Python writer's stamp, as the writer plan will send it: sentence and
  -- both markers, one statement.
  UPDATE strategy_analytics
     SET computation_error        = 'Insufficient CSV history. At least 2 data points required.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s_s;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_final' THEN
    RAISE EXCEPTION 'TEST FAILED (S1-SETUP): the job is %, not failed_final, so nothing was ever asked of the bridge and every assertion below would pass vacuously. Either the claim token was rejected (the mig-117 P97 fence needs status = ''running'' AND a matching claim_token) or the RPC signature moved.', v_jobstat;
  END IF;

  SELECT computation_error, computation_error_source, computation_error_job_id, computation_status
    INTO v_error, v_src, v_jobid, v_status
    FROM strategy_analytics WHERE strategy_id = s_s;

  -- RED-UNDER: revert branch (b)'s sentence CASE to the pre-fix unconditional
  --            overwrite, `computation_error = EXCLUDED.computation_error` —
  --            which IS the defect 20260826120000 recorded as owed work.
  --            ⚠️ LAYERED: 20260906120000's own (P2b) anchor asserts that whole
  --            CASE and would abort the apply, so it is stood down in the same
  --            mutation.
  -- RED-UNDER-M: {"arm":"S1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"computation_error  = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error ELSE EXCLUDED.computation_error END,","replace":"computation_error  = EXCLUDED.computation_error,","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"IF v_fn !~ 'computation_error\\s*=\\s*CASE","replace":"IF FALSE AND v_fn !~ 'computation_error\\s*=\\s*CASE","occurrences":1}]}
  IF v_error IS DISTINCT FROM 'Insufficient CSV history. At least 2 data points required.' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the writer-curated sentence did NOT survive the transition that resolved its own job — computation_error reads %. This is criterion 2''s headline defect: the worker writes a per-failure curated sentence moments before the RPC, and branch (b) overwrote it with the per-kind generic. The user reads a message that does not describe what actually failed.', COALESCE(v_error, 'NULL');
  END IF;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (S1): the row reads computation_status = % rather than ''failed'' after an UNPROTECTED permanent failure, so branch (b) is not the branch that ran and the sentence assertion above was measuring something else.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_src IS DISTINCT FROM 'writer' OR v_jobid IS DISTINCT FROM j THEN
    RAISE EXCEPTION 'TEST FAILED (S1): branch (b) kept the sentence but not its provenance (source %, job %). The markers must travel WITH the sentence: dropped here, the NEXT bridge call reads a curated sentence as bridge-provenanced and overwrites it with the generic — the defect returns one call later, which is the version of it nobody reproduces.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;

  -- ===== ARM C1 — the CONTROL: no markers means the generic wins ==========
  -- Byte-identical to S except that the sentence in the column carries no
  -- provenance. Two things rest on this arm. (1) It is S's discriminator: a
  -- bridge that preserved EVERY existing sentence would pass S and is exactly
  -- what the "prefer the value already in the column" repair would have been.
  -- (2) It is the "no backfill" claim, made behaviourally: NULL markers — the
  -- ~103 legacy PROD rows, and every row this bridge itself last touched — must
  -- behave EXACTLY as they did before this migration.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computation_error)
  VALUES (s_c, 'computing', FALSE, 'a stale unprovenanced sentence on control C');

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_c, 'derive_broker_dailies', 'running', tok, 1, 3)
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'user resync failed', 'permanent', tok);

  SELECT computation_error, computation_error_source, computation_error_job_id, computation_status
    INTO v_error, v_src, v_jobid, v_status
    FROM strategy_analytics WHERE strategy_id = s_c;

  -- RED-UNDER: weaken branch (b)'s CASE predicate to `WHEN TRUE`, i.e. keep
  --            whatever sentence the row already carries. ⚠️ LAYERED with the
  --            same (P2b) anchor stand-down as arm S1.
  -- RED-UNDER-M: {"arm":"C1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"computation_error  = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN","replace":"computation_error  = CASE WHEN TRUE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"IF v_fn !~ 'computation_error\\s*=\\s*CASE","replace":"IF FALSE AND v_fn !~ 'computation_error\\s*=\\s*CASE","occurrences":1}]}
  IF v_error IS DISTINCT FROM c_perm THEN
    RAISE EXCEPTION 'TEST FAILED (C1): an UNPROVENANCED sentence was preserved across the transition — computation_error reads % where the per-kind generic for a permanent failure was required. The preference is a presence test on nothing, or an unconditional keep: either way an OLDER unresolved failure''s sentence, and pre-migration operator text, are now frozen over a live newer failure, and the ~103 legacy rows stop behaving as they did before this migration (which is what "no backfill" was decided to mean).', COALESCE(v_error, 'NULL');
  END IF;
  IF v_status IS DISTINCT FROM 'failed' THEN
    RAISE EXCEPTION 'TEST FAILED (C1): the row reads computation_status = % rather than ''failed'', so branch (b) is not the branch under test here either.', COALESCE(v_status, 'NULL');
  END IF;
  IF v_src IS NOT NULL OR v_jobid IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (C1): the bridge''s own generic write left a provenance marker behind (source %, job %). A marker standing over this bridge''s per-kind generic makes that generic read as writer-curated to the NEXT call, which then freezes it — strictly worse than having no provenance at all.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;

  -- ===== ARM O1 — a marker naming an OLDER job must LOSE ==================
  -- Case (ii) of 20260826120000's owed-work paragraph, and the whole reason the
  -- predicate is an EQUALITY against the job the branch itself resolved rather
  -- than a presence test on the marker. No other arm in this repository can tell
  -- those two apart: S passes under a presence test, C passes under a presence
  -- test, and only a row whose marker names a DIFFERENT live failure separates
  -- them.
  --
  -- ⚠️ The older job's created_at is set EXPLICITLY. Both jobs are inserted in
  -- one transaction, so `now()` is identical for both and the picks'
  -- `ORDER BY created_at DESC, id DESC` would fall through to a RANDOM uuid —
  -- the arm would then be a coin flip. The O-SETUP guard below measures the
  -- ordering rather than trusting it.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned)
  VALUES (s_o, 'computing', FALSE);

  INSERT INTO compute_jobs (strategy_id, kind, status, error_kind, last_error, created_at)
  VALUES (s_o, 'derive_broker_dailies', 'failed_final', 'permanent',
          'the older, still-unresolved failure', now() - INTERVAL '2 hours')
  RETURNING id INTO j_old;

  UPDATE strategy_analytics
     SET computation_error        = 'the curated sentence the OLDER failure left behind',
         computation_error_source = 'writer',
         computation_error_job_id = j_old
   WHERE strategy_id = s_o;

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_o, 'derive_broker_dailies', 'running', tok, 1, 3)
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'the newer failure', 'permanent', tok);

  SELECT created_at INTO v_old_at FROM compute_jobs WHERE id = j_old;
  SELECT created_at INTO v_new_at FROM compute_jobs WHERE id = j;
  IF NOT (v_new_at > v_old_at) THEN
    RAISE EXCEPTION 'TEST FAILED (O1-SETUP): the two failures are not strictly ordered (older %, newer %), so `array_agg(id ORDER BY created_at DESC, id DESC)` falls through to a random uuid and this arm is a coin flip rather than a test.', v_old_at, v_new_at;
  END IF;

  SELECT computation_error, computation_error_source, computation_error_job_id
    INTO v_error, v_src, v_jobid
    FROM strategy_analytics WHERE strategy_id = s_o;

  -- RED-UNDER: drop the `computation_error_job_id = v_latest_job_id` conjunct
  --            from branch (b)'s sentence CASE, leaving a PRESENCE test on the
  --            source marker — the repair 20260826120000's header explicitly
  --            rejected as undecidable. ⚠️ LAYERED with the (P2b) anchor
  --            stand-down.
  -- RED-UNDER-M: {"arm":"O1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"computation_error  = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN","replace":"computation_error  = CASE WHEN strategy_analytics.computation_error_source = 'writer' THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"IF v_fn !~ 'computation_error\\s*=\\s*CASE","replace":"IF FALSE AND v_fn !~ 'computation_error\\s*=\\s*CASE","occurrences":1}]}
  IF v_error IS DISTINCT FROM c_perm THEN
    RAISE EXCEPTION 'TEST FAILED (O1): a writer sentence stamped for an OLDER, still-unresolved failure was preserved over the NEWER failure this transition resolved — computation_error reads %. The preference has become a presence test on the source marker, which 20260826120000''s header names as the reason the fix could not be done there: it cannot tell THIS failure''s sentence from one an older unresolved failure left, and it freezes the older text in place on the live money path.', COALESCE(v_error, 'NULL');
  END IF;
  IF v_src IS NOT NULL OR v_jobid IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (O1): the overwrite left the stale provenance standing (source %, job %). The markers must be cleared on the SAME predicate that overwrites the sentence — a job id beside a sentence that job never wrote is a claim about text that is gone.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;

  -- ===== ARM D1 — branch (c) leaves NO marker behind ======================
  -- ⚠️ FIXTURE IS DELIBERATE — see THE TRIGGER MASKS TWO ARMS in the header.
  -- The row is INSERTed with both markers over a NULL sentence. The provenance
  -- trigger is UPDATE-only, so it never saw this row; branch (c) then writes
  -- computation_error = NULL over a NULL, which leaves the trigger's first
  -- conjunct FALSE. Branch (c)'s OWN unconditional marker clears are therefore
  -- the only thing that can remove them, and this arm can fail when they are
  -- deleted. With a non-NULL sentence in the fixture the trigger would clear the
  -- markers instead and the arm would be green over a deleted fix.
  --
  -- The state is reachable: a PostgREST upsert that CREATES the row can carry
  -- both markers with no sentence, and the pairing CHECK admits it (both
  -- present). It is exactly the residual the trigger's UPDATE-only scope
  -- documents.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_d, 'derive_broker_dailies', 'running', tok, 1, 3)
  RETURNING id INTO j;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned,
                                  computation_error, computation_error_source, computation_error_job_id)
  VALUES (s_d, 'computing', FALSE, NULL, 'writer', j);

  PERFORM mark_compute_job_done(j, tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'done' THEN
    RAISE EXCEPTION 'TEST FAILED (D1-SETUP): the job is %, not done, so branch (c) never ran and the marker assertion below would pass vacuously.', v_jobstat;
  END IF;

  SELECT computation_status, computation_error_source, computation_error_job_id
    INTO v_status, v_src, v_jobid
    FROM strategy_analytics WHERE strategy_id = s_d;
  IF v_status IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (D1-SETUP): the row reads computation_status = % rather than ''complete'', so branch (c) — the all-done terminal success write — is not the branch under test.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: delete branch (c)'s two unconditional marker clears. ⚠️ LAYERED
  --            twice: 20260906120000's (P2d) COUNT anchors require EXACTLY two
  --            unconditional clears of each marker across the body, so both
  --            counts must be re-baselined to 1 in the same mutation or the
  --            apply aborts.
  -- RED-UNDER-M: {"arm":"D1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"         computation_error_source = NULL,\n         computation_error_job_id = NULL,\n         computing_started_at = NULL,\n         computed_at        = now();\n","replace":"         computing_started_at = NULL,\n         computed_at        = now();\n","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"'computation_error_source\\s*=\\s*NULL', 'g')) <> 2","replace":"'computation_error_source\\s*=\\s*NULL', 'g')) <> 1","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"'computation_error_job_id\\s*=\\s*NULL', 'g')) <> 2","replace":"'computation_error_job_id\\s*=\\s*NULL', 'g')) <> 1","occurrences":1}]}
  IF v_src IS NOT NULL OR v_jobid IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (D1): branch (c) resolved the strategy to a terminal SUCCESS and left provenance standing (source %, job %). Every live failure is gone, so there is nothing left for a marker to describe — and the NEXT failure''s write branch reads it as a writer''s claim over a sentence that no longer exists and keeps a NULL. The provenance trigger cannot cover this row: it is UPDATE-only and the sentence was already NULL, so branch (c)''s own unconditional clears are the only thing standing here.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;

  -- ===== ARM P1 — the sentence SURVIVES branch (b-prime) ==================
  -- The D-15 recurring-refresh path. S does not imply this: branch (b-prime) is
  -- a separate UPDATE with its own CASE keyed on its own variable
  -- (v_protected_job_id, off the PROTECTED half of the same aggregate), and it
  -- is the branch where the sentence matters MOST — the row stays PUBLISHED, so
  -- this sentence is the entire explanation a user gets for a maintenance
  -- failure on a funded account.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at)
  VALUES (s_p, 'complete_with_warnings', TRUE, v_before);

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_p, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  UPDATE strategy_analytics
     SET computation_error        = 'The MT5 gateway did not answer this account for 6 hours.',
         computation_error_source = 'writer',
         computation_error_job_id = j
   WHERE strategy_id = s_p;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT computation_status, computation_error, computation_error_source,
         computation_error_job_id, computed_at
    INTO v_status, v_error, v_src, v_jobid, v_computed
    FROM strategy_analytics WHERE strategy_id = s_p;

  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'TEST FAILED (P1-SETUP): the row reads % rather than the protected ''complete_with_warnings'', so branch (b-prime) is not the branch under test and the sentence assertion below would be measuring branch (b) instead.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: revert branch (b-prime)'s SET to the bare
  --            `computation_error_copy(v_protected_kind)` it carried before this
  --            migration — the unconditional overwrite on the protected path.
  --            ⚠️ LAYERED: the (P2c) anchor asserts that whole CASE and would
  --            abort the apply.
  -- RED-UNDER-M: {"arm":"P1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"SET computation_error   = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_protected_job_id THEN strategy_analytics.computation_error ELSE computation_error_copy(v_protected_kind) END,","replace":"SET computation_error   = computation_error_copy(v_protected_kind),","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"IF v_fn !~ 'SET\\s+computation_error\\s*=\\s*CASE","replace":"IF FALSE AND v_fn !~ 'SET\\s+computation_error\\s*=\\s*CASE","occurrences":1}]}
  IF v_error IS DISTINCT FROM 'The MT5 gateway did not answer this account for 6 hours.' THEN
    RAISE EXCEPTION 'TEST FAILED (P1): branch (b-prime) overwrote the writer''s sentence for the job it just resolved — computation_error reads %. This is the recurring-refresh path: the row STAYS PUBLISHED, so this sentence is the whole of what the portfolio stale warning tells the user about a maintenance failure, and replacing it with the per-kind generic is precisely the loss 20260826120000 recorded as owed work.', COALESCE(v_error, 'NULL');
  END IF;
  IF v_src IS DISTINCT FROM 'writer' OR v_jobid IS DISTINCT FROM j THEN
    RAISE EXCEPTION 'TEST FAILED (P1): branch (b-prime) kept the sentence but not its provenance (source %, job %). Dropped here, the next recurring refresh reads a curated sentence as bridge-provenanced and overwrites it — the defect returns 20 hours later, on a row nobody is watching.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;
  IF v_computed IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'TEST FAILED (P1): computed_at moved from % to % on a FAILED protected refresh. Branch (b-prime) must write no publish column at all; a moved computed_at reports a failure as a fresh successful computation, which is branch (c)''s laundering (CR-01).', v_before, v_computed;
  END IF;

  -- ===== ARM PC1 — the CONTROL on branch (b-prime) =======================
  -- PC1's discriminator note: P1's control, and it is not implied by C1: the two branches are separate
  -- statements with separate CASEs, so a b-prime that keeps EVERY sentence
  -- passes P1 while C1 stays green on the other branch entirely.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned, computed_at, computation_error)
  VALUES (s_pc, 'complete_with_warnings', TRUE, v_before,
          'a stale unprovenanced sentence on control PC');

  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts, metadata)
  VALUES (s_pc, 'derive_broker_dailies', 'running', tok, 1, 3,
          jsonb_build_object('source', 'ledger-refresh', 'enqueued_at', now()))
  RETURNING id INTO j;

  PERFORM mark_compute_job_failed(j, 'mt5 gateway IPC timeout (-10005)', 'permanent', tok);

  SELECT computation_status, computation_error, computation_error_source, computation_error_job_id
    INTO v_status, v_error, v_src, v_jobid
    FROM strategy_analytics WHERE strategy_id = s_pc;

  IF v_status IS DISTINCT FROM 'complete_with_warnings' THEN
    RAISE EXCEPTION 'TEST FAILED (PC1-SETUP): the row reads % rather than the protected ''complete_with_warnings'', so branch (b-prime) is not the branch under test.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: weaken branch (b-prime)'s CASE predicate to `WHEN TRUE`, i.e.
  --            keep whatever sentence the row already carries. ⚠️ LAYERED with
  --            the same (P2c) anchor stand-down as arm P1.
  -- RED-UNDER-M: {"arm":"PC1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"SET computation_error   = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_protected_job_id THEN","replace":"SET computation_error   = CASE WHEN TRUE THEN","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"IF v_fn !~ 'SET\\s+computation_error\\s*=\\s*CASE","replace":"IF FALSE AND v_fn !~ 'SET\\s+computation_error\\s*=\\s*CASE","occurrences":1}]}
  IF v_error IS DISTINCT FROM c_perm THEN
    RAISE EXCEPTION 'TEST FAILED (PC1): an UNPROVENANCED sentence was preserved on the protected branch — computation_error reads % where the per-kind generic was required. Two regressions fit and both are silent: the conditional has become an unconditional keep, or the predicate was weakened to a presence test. Either freezes operator text written by the PRE-migration form of this very branch, which the per-kind copy was added to heal.', COALESCE(v_error, 'NULL');
  END IF;
  IF v_src IS NOT NULL OR v_jobid IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (PC1): branch (b-prime)''s generic write left a provenance marker behind (source %, job %). On a row that STAYS PUBLISHED, a marker over this bridge''s own generic makes it read as writer-curated to every later refresh, which then keeps it forever.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;

  -- ===== ARM R1 — branch (a) leaves NO marker behind =====================
  -- The RETRYABLE transition, and the only arm anywhere that reaches branch (a)
  -- with provenance on the row. `mark_compute_job_failed(..., 'transient', ...)`
  -- with attempts left lands the job on failed_retry (mig 20260515114555's
  -- `ELSE v_new_status := 'failed_retry'`), which this bridge counts as
  -- NON-TERMINAL, so the row is re-entered at 'computing' and the sentence is
  -- blanked. It is ALSO the branch the DEFERRED Python path reaches by PERFORMing
  -- this function directly while the job is still non-terminal — same branch,
  -- same write, different caller — so this arm is that path's proof too.
  --
  -- ⚠️ FIXTURE IS DELIBERATE, for arm D1's reason: the row is INSERTed with both
  -- markers over a NULL sentence, so the UPDATE-only provenance trigger cannot
  -- mask branch (a)'s own unconditional clears. With a sentence in the column
  -- the trigger would clear the markers and this arm could not fail.
  tok := gen_random_uuid();
  INSERT INTO compute_jobs (strategy_id, kind, status, claim_token, attempts, max_attempts)
  VALUES (s_r, 'derive_broker_dailies', 'running', tok, 0, 3)
  RETURNING id INTO j;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_warned,
                                  computation_error, computation_error_source, computation_error_job_id)
  VALUES (s_r, 'failed', FALSE, NULL, 'writer', j);

  PERFORM mark_compute_job_failed(j, 'venue returned 503, retry scheduled', 'transient', tok);

  SELECT status INTO v_jobstat FROM compute_jobs WHERE id = j;
  IF v_jobstat IS DISTINCT FROM 'failed_retry' THEN
    RAISE EXCEPTION 'TEST FAILED (R1-SETUP): the job is %, not failed_retry, so branch (a) is not the branch under test and this arm is a duplicate of S rather than the non-terminal proof. Either the kind was terminalising (''permanent'' goes straight to failed_final) or attempts were already exhausted (attempts >= max_attempts terminalises any kind).', v_jobstat;
  END IF;

  SELECT computation_status, computation_error_source, computation_error_job_id
    INTO v_status, v_src, v_jobid
    FROM strategy_analytics WHERE strategy_id = s_r;
  IF v_status IS DISTINCT FROM 'computing' THEN
    RAISE EXCEPTION 'TEST FAILED (R1-SETUP): the row reads computation_status = % rather than ''computing''. Branch (a) is the branch this arm is about — a failed_retry job is IN FLIGHT, and if the bridge does not re-enter the row at ''computing'' then the non-terminal count no longer sees failed_retry and the marker assertion below is measuring some other branch.', COALESCE(v_status, 'NULL');
  END IF;

  -- RED-UNDER: delete branch (a)'s two unconditional marker clears. ⚠️ LAYERED
  --            twice with the (P2d) COUNT anchors, exactly as arm D1's twin.
  -- RED-UNDER-M: {"arm":"R1","apply":[{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"           computation_error_source = NULL,\n           computation_error_job_id = NULL,\n","replace":"","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"'computation_error_source\\s*=\\s*NULL', 'g')) <> 2","replace":"'computation_error_source\\s*=\\s*NULL', 'g')) <> 1","occurrences":1},{"kind":"edit","file":"supabase/migrations/20260906120000_computation_error_provenance.sql","find":"'computation_error_job_id\\s*=\\s*NULL', 'g')) <> 2","replace":"'computation_error_job_id\\s*=\\s*NULL', 'g')) <> 1","occurrences":1}]}
  IF v_src IS NOT NULL OR v_jobid IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R1): branch (a) re-entered the row at ''computing'' and left provenance standing (source %, job %). When a job starts, any sentence on the row is stale by construction and the branch blanks it — a marker left behind then makes the NEXT generic write look writer-curated and freezes it there, and the 16-hour reaper''s own sentence is judged against it too. The provenance trigger cannot cover this row: it is UPDATE-only and the sentence was already NULL, so branch (a)''s own unconditional clears are the only thing standing here.', COALESCE(v_src, 'NULL'), COALESCE(v_jobid::text, 'NULL');
  END IF;

  RAISE NOTICE 'ALL 7 ARMS EXECUTED (S1, C1, O1, D1, P1, PC1, R1): a writer-curated computation_error sentence SURVIVES the compute_jobs transition that resolves its own job, on BOTH write branches (S1 branch (b), P1 branch (b-prime), each read back out of strategy_analytics after the real RPC and never inspected in the bridge body), and is REPLACED by the per-kind generic on every path where it does not describe that failure — no marker at all (C1 branch (b), PC1 branch (b-prime)) and a marker naming an OLDER still-unresolved failure (O1, the case a presence test cannot decide). Provenance is cleared unconditionally on the two branches that blank the sentence: the all-done success write (D1 branch (c)) and the non-terminal re-entry a RETRYABLE failure produces (R1 branch (a), which is also the DEFERRED Python direct-call path). Phase 164.2 / criteria 1 and 2, mig 20260906120000.';
END $$;

ROLLBACK;
