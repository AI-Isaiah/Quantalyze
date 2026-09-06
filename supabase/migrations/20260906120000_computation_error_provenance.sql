-- Migration: strategy_analytics.computation_error gets PROVENANCE, and the SQL
-- status bridge stops overwriting a curated sentence that belongs to the very
-- failure it is resolving.
-- Phase 164.2 / plan 06 / criterion 2 (CURATED-COPY). 2026-09-06.
--
-- ══════════════════════════════════════════════════════════════════════════
-- VAC-04 ACKNOWLEDGEMENT — the PROD body this CREATE OR REPLACE overwrites.
--
-- prod-body-ack: cb4353d7a356e647445d2e331ff2104ac4e356cfdb4ae4f4f4578e918bfcb995
--
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On any function-changing migration PR the two necessarily
-- disagree: `snapshot-drift` requires the snapshot to carry the body the
-- MIGRATIONS produce (the new one), while VAC-04 requires it to match what PROD
-- has TODAY (the old one). The pragma is the designed resolution, and it means
-- "I read PROD's body and intend to overwrite it" -- so it was earned, not
-- pasted:
--
--   MEASURED 2026-09-06, workflow run 34056186575 at e7a9d828:
--     PROD live sha256                  cb4353d7...fcb995   (38 differing lines)
--     committed snapshot at HEAD        67a36c4e...09eee1
--   and, reproduced LOCALLY with the gate's own normalizer,
--   `node scripts/sql-body-normalize.mjs --diff-bodies <origin/main snapshot> <HEAD snapshot>`:
--     origin/main snapshot sha256       cb4353d7...fcb995   <-- IDENTICAL to PROD
--     HEAD snapshot sha256              67a36c4e...09eee1
--
-- ⭐ PROD's live body is therefore EXACTLY the repository's last-known committed
-- snapshot on main. There is NO out-of-band patch -- DRIFT-02's shape is ABSENT.
-- The 38 lines are this phase's own six provenance deltas plus the `id DESC`
-- tie-break, and nothing else: no guard, scope or ownership predicate is
-- removed (verified independently by the phase's security audit, which also
-- proved the REVOKE grantee set byte-identical to the definition this file
-- re-bases on).
--
-- ⛔ Had the two hashes NOT matched, the correct action was to FOLD the
-- difference into this migration, never to record the pragma anyway. The ack is
-- evidence that PROD was read, not a way to silence the gate.
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ OPS: merging supabase/migrations/** to main AUTO-APPLIES to PROD. This file
-- redefines a function that every terminal compute-job transition PERFORMs
-- in-RPC, so it is live on the next merge with no separate deploy step and no
-- flag in front of it.
--
-- ⚠️ DEPLOY ORDER, and it is one-directional. This migration must reach PROD
-- BEFORE any worker starts sending the two new keys on its strategy_analytics
-- upsert: PostgREST answers a schema-cache miss on an unknown column, so a
-- writer that runs ahead of the DDL fails its failure-write. The Python half is
-- a SEPARATE plan and carries its own minimal-key fallback and precondition.
-- The reverse order is SAFE and is the whole point of the NULL semantic below:
-- with this file applied and no writer stamping yet, every row has NULL markers
-- and this bridge behaves EXACTLY as it did before.
--
-- ⛔ THE DEFECT — quoted from 20260826120000's own header, where it is recorded
-- as OWED WORK rather than as an accepted trade
-- --------------------------------------------------------------------------
-- "job_worker.py's `_stamp_strategy_analytics_failed` -> `_upsert_error_only`
--  (and the composite handler's twin) writes a CURATED sentence into
--  `strategy_analytics.computation_error` -- the D-162-4 message/detail split,
--  where `message` is curated copy and the scrubbed exception goes to `detail`
--  and never to this column -- and the bridge then overwrites it, on branch (b)
--  and on branch (b-prime) alike, whenever the same failure reaches a
--  compute_jobs transition. Before that migration it was overwritten with the
--  raw diagnostic; after it, with the per-kind sentence. The user-visible
--  effect is that the worker's per-failure curation does not reach the
--  portfolio stale warning on those paths."
--
-- And the same header states precisely why the obvious repair does not work:
--
-- "It cannot be done by preferring the value already in the column: the column
--  carries NO PROVENANCE, so that cannot distinguish (i) the curated sentence
--  this failure just wrote, from (ii) a curated sentence left by an OLDER,
--  unresolved protected failure, from (iii) operator text written by the
--  pre-migration form of b-prime. ... Doing it properly means giving the column
--  a writer/generation marker that the Python writers set and this bridge
--  reads."
--
-- THIS FILE IS THAT MARKER, and the bridge half of reading it. It pays the debt
-- in the terms the debt was recorded in.
--
-- ⛔ THE DESIGN, AND WHY THE JOB ID IS THE LOAD-BEARING HALF
-- --------------------------------------------------------------------------
-- Two columns on strategy_analytics, NOT an envelope inside the sentence.
-- computation_error renders VERBATIM to users (the wizard failure envelope and
-- the portfolio stale warning; analytics-service/tests/test_stitch_composite_
-- job.py:558 pins the verbatim render), so any JSON envelope smuggled into the
-- column leaks to a user the moment one reader forgets to unwrap it. Provenance
-- goes in its own columns or it does not go in at all.
--
--   computation_error_source  TEXT, CHECK (... IN ('writer')), NULLABLE
--   computation_error_job_id  UUID,                            NULLABLE
--
-- NULL on either means BRIDGE-OR-LEGACY provenance, which reproduces today's
-- behaviour exactly. That is what makes "no backfill" a decision rather than an
-- omission: the ~103 legacy PROD rows keep behaving as they do today, and
-- migrating them would be ASSERTING provenance nobody recorded.
--
-- ⛔ A PRESENCE TEST WOULD NOT HAVE WORKED. "Keep the sentence when a marker is
-- set" answers case (i) and gets (ii) and (iii) wrong: an older unresolved
-- protected failure's curated sentence, and pre-migration operator text, would
-- both be frozen in place over a live newer failure. The condition on both
-- write branches is therefore an EQUALITY against the id of the job THIS CALL
-- resolved -- v_latest_job_id on branch (b), v_protected_job_id on (b-prime),
-- both picked off the same aggregate, same FILTER and same ordering that
-- already yield v_latest_kind and v_protected_kind. Case (i) matches. Cases
-- (ii) and (iii) do not. The distinction 20260826120000 called undecidable is
-- decided by a primary key.
--
-- ⛔ AND THE MARKERS ARE CLEARED WHENEVER THE SENTENCE IS. Branches (a) and (c)
-- write computation_error to NULL; both now null BOTH markers in the same
-- statement, and branches (b)/(b-prime) null them on the ELSE arm that writes
-- the generic. A marker standing over a sentence it does not describe is the
-- one way this design can produce a WORSE outcome than no design at all -- the
-- next generic write would read as curated and freeze.
--
-- ⛔⛔ AND THAT PROPERTY IS ENFORCED AT THE TABLE, NOT BY THIS BODY. An earlier
-- draft of this header closed the paragraph above with "there is no path in
-- this body that writes computation_error without deciding both markers
-- alongside it". That sentence is TRUE of this body and was FALSE of the
-- repository, which is the only scope that matters for an invariant about a
-- column. The silent-failure review of 2026-09-06 enumerated the writers that
-- change computation_error (or the status gating it) and would have left a
-- marker standing:
--   * analytics-service/services/analytics_runner.py `_mark_complete` --
--     upserts "computation_error": None on the CSV success path.
--   * analytics-service/services/job_worker.py `headline_payload` -- the
--     composite success write, same key, same None.
--   * analytics-service/services/job_worker.py `_upsert_error_only` -- writes a
--     NEW curated sentence over an older one on the terminal-success-preserving
--     failure path.
--   * 20260712120000_wizard_composite_members_invalidate_analytics.sql
--     `set_wizard_composite_members` -- NULLs computation_error when the member
--     signature changes.
--   * 20260802120000's 16-hour reaper -- writes a fixed sentence (its own row
--     scope makes it safe on its own; see the census below).
-- The MEASURED consequence of the first of those, spelled out because it is the
-- exact scenario this trigger exists for: job J fails, the writer stamps
-- sentence S with markers ('writer', J), branch (b) keeps both. `_mark_complete`
-- then blanks the sentence and leaves the markers. A later, DIFFERENT-KIND job's
-- terminal RPC PERFORMs this bridge; J is a different kind, so the per-kind
-- supersession does not clear it; branch (b) fires with v_latest_job_id = J; the
-- markers match; the CASE takes its "keep the existing sentence" arm -- and the
-- existing sentence is NULL. The row renders computation_status = 'failed' with
-- NO sentence at all, where the pre-164.2 bridge wrote
-- computation_error_copy(v_latest_kind). The CONDITIONAL introduces that
-- regression; it does not inherit it.
--
-- Fixing that at the writers would mean six edits today in two languages and an
-- unbounded number tomorrow, each of them a place where the next author has no
-- reason to know this column has provenance. STEP 3 below fixes it AT THE TABLE
-- with a BEFORE UPDATE trigger whose whole content is: a statement that CHANGES
-- the sentence WITHOUT RESTATING the provenance drops the provenance. Every
-- writer above becomes correct without being edited, and so does the next one.
-- The invariant is now a property of the SCHEMA rather than of one function
-- body -- which is the only form in which the paragraph above can be true.
--
-- ⚠️ WHAT THE TRIGGER CANNOT SEE, stated rather than glossed. PL/pgSQL cannot
-- distinguish "this column was omitted from the SET list" from "this column was
-- set to the value it already had": both arrive as NEW.<col> = OLD.<col>. So a
-- writer that re-stamps the SAME job id with a DIFFERENT sentence has its
-- marker dropped, and the bridge then writes the per-kind generic for that row.
-- That is a loss of the fix in one corner, never a corruption: the outcome is
-- exactly the pre-164.2 behaviour, which is the direction every unknown in this
-- file resolves to. It is booked for the Python writer plan rather than worked
-- around here, because the alternative -- keeping a marker across a sentence
-- change -- is the one failure mode this whole design exists to prevent.
--
-- ⛔ AND THE TWO MARKERS ARE SET TOGETHER OR NOT AT ALL, by a second CHECK.
-- Without it, a writer that sets source = 'writer' and forgets the job id
-- yields `'writer' AND NULL = <uuid>` -- NULL, so the CASE falls to ELSE and the
-- generic wins. Safe, but SILENT: a half-stamped row is indistinguishable from
-- an unstamped one, so a writer bug degrades every curated sentence on that
-- path with no signal anywhere. The pairing CHECK turns that into a 23514 at
-- the writer, which is a bug report instead of a slow leak.
--
-- ⛔ WHO DOES *NOT* NEED A MARKER, stated because "every writer stamps it" is
-- the version of this decision that is wrong in two places
-- --------------------------------------------------------------------------
-- ⚠️ READ THIS LIST AS "does not need to be EDITED", not as "cannot leave a
-- stale marker". Every entry below is safe because STEP 3's trigger makes it
-- safe -- the entries state why an entry does not need a marker of its OWN,
-- which is a different claim and was the only one the first draft made. The
-- 2026-09-06 rls-policy-auditor review found the census incomplete on exactly
-- that boundary (`set_wizard_composite_members` was missing), and the
-- silent-failure review found that its missing member was not the last one.
--   * `set_wizard_composite_members`
--     (20260712120000_wizard_composite_members_invalidate_analytics.sql:185-189).
--     When a composite's member signature changes it UPDATEs the published row
--     to computation_status = 'pending' and computation_error = NULL. It writes
--     no marker and must not: the blanking is an INVALIDATION, not a verdict on
--     any job, and there is no job whose id it could name. It leaves no stale
--     marker because it changes the sentence and restates no provenance, which
--     is precisely the trigger's firing condition.
--   * THE ANALYTICS-SERVICE SUCCESS WRITERS (`_mark_complete`,
--     `headline_payload`). Same shape: they blank the sentence on a successful
--     computation and name no job. Same reason they are safe.
--   * `_mark_computing` (analytics_runner.py). It changes computation_status
--     and computing_started_at and does NOT touch computation_error, so the
--     marker in the column still describes the sentence in the column and
--     nothing is stale. The trigger correctly does not fire. Listed because the
--     review flagged it, and because "it writes the status the sentence is
--     gated on" is not the same hazard as "it writes the sentence".
--   * THE 16-HOUR REAPER (cron job reap_strategy_analytics_stuck_computing,
--     mig 20260802120000:502-520). It writes a fixed sentence, and its WHERE
--     clause selects ONLY rows at computation_status = 'computing'. The sole
--     writer of that status through this bridge is branch (a), which has just
--     nulled both markers. So the reaper's sentence always sits over NULL
--     provenance, is correctly classified as bridge-provenanced, and is
--     correctly superseded by the next real failure. Stamping it would ADD a
--     claim -- that a writer curated this for a specific job -- which is false:
--     no job reached a verdict at all.
--   * THE FOUR TYPESCRIPT PRE-ENQUEUE WRITERS (finalize-wizard x2, csv-finalize,
--     keys/sync). Every one of them writes its sentence BEFORE a compute job
--     exists. When the job starts, branch (a) blanks the column -- and that is
--     CORRECT, not a loss: their sentence describes a state the newly started
--     computation supersedes. Marking them would make branch (a)'s blank
--     conditional on a job id that had not been issued when they wrote.
--   * routers/portfolio.py. It writes portfolio_analytics, which HAS NO BRIDGE
--     (20260826120000:240 records that there isn't one). A marker there would be
--     read by nobody.
--
-- ⛔ NO FOREIGN KEY ON computation_error_job_id, deliberately. compute_jobs rows
-- are RETAINED for audit and are subject to their own retention policy; an FK
-- would couple that retention to this column and turn a routine purge into a
-- constraint violation or a cascade that silently rewrites provenance. The
-- column is a claim about a job id, not a live reference, and the bridge's own
-- equality test is total: an id that no longer resolves simply fails to match
-- and the generic wins -- the safe direction.
--
-- ⛔ NO DEFAULT AND NO NOT NULL on either column, for the reason
-- 20260802120000:215-221 records for computing_started_at: a NOT NULL here
-- would be a 23502 timebomb against every existing writer that upserts
-- strategy_analytics without the column, and a DEFAULT would assert provenance
-- for rows nobody stamped. ADD COLUMN IF NOT EXISTS is metadata-only on a
-- nullable, defaultless column, so this is not a table rewrite.
--
-- THE DELTA against 20260826120000 (seven prior definitions of the bridge
-- exist; this re-bases on the LATEST, 20260826120000_computation_error_curated_
-- copy.sql:336-905 -- 20260826140000 does NOT define it):
--   1. Two ADD COLUMNs on strategy_analytics with a guarded CHECK constraint and
--      a COMMENT ON COLUMN each.
--   2. `f.id` projected in the live_failures CTE; `v_latest_job_id` and
--      `v_protected_job_id` added to DECLARE; two more array_agg terms and the
--      extended INTO list on the existing aggregate. Same ordering, same
--      FILTERs, same partition -- nothing about WHO is protected moves.
--   3. Branch (b)'s DO UPDATE arm becomes a CASE on the two markers and
--      v_latest_job_id. Its VALUES arm KEEPS the generic: a fresh row has no
--      earlier writer sentence to preserve.
--   4. Branch (b-prime)'s SET becomes the same CASE keyed on
--      v_protected_job_id, with computation_error_copy(v_protected_kind) on the
--      ELSE arm.
--   5. Both markers cleared in branches (a) and (c), and on the ELSE arm of the
--      CASEs in (b) and (b-prime). The in-body owed-work paragraph in (b-prime)
--      is REWRITTEN to record that the debt is paid here.
--   6a. A SECOND CHECK constraint, `..._markers_together_check`, asserting
--      `(source IS NULL) = (job_id IS NULL)`. See the pairing paragraph above.
--   6b. The four `array_agg` picks in that aggregate order by
--      `created_at DESC, id DESC`, not by `created_at DESC` alone. The
--      pairing claim in delta 2 -- that v_latest_job_id names the job whose kind
--      became v_latest_kind -- is a claim about TWO separate aggregates agreeing
--      on which row is first. Postgres guarantees no tie-break between them, and
--      TIES ARE PRODUCIBLE HERE: `now()` is transaction-scoped, so a fan-out
--      inserting several jobs in ONE statement stamps them with an identical
--      created_at. On a tie the kind could come from job X and the id from job
--      Y, and the bridge would then compare a marker against the wrong job --
--      failing on exactly the row it should match. `id` is compute_jobs' primary
--      key, so appending it makes the order TOTAL and the pairing exact. All
--      FOUR picks carry the same ORDER BY; a tie-break added to only two of them
--      would fix nothing, which is why the self-verify counts them.
--      ⚠️ MEASURED, and the measurement is the reason this delta is pinned by
--      TEXT and not by a gate arm. On the pg-lane (PostgreSQL 16, this schema,
--      this plan) the UNTIED aggregate already returns the tied rows in exact
--      `id DESC` order, so the kind pick and the id pick AGREE with and without
--      the trailing key: 8 tied failures inserted in scrambled id order came
--      back id-descending, and a probe reading both picks reported AGREE=t.
--      Two behavioural arms were written for this delta and BOTH passed against
--      the unfixed aggregate, in either insert order -- i.e. they were tests
--      that could not fail, which is worse than no test. They were DELETED
--      rather than shipped. What remains is three self-verify anchors, each
--      observed RED under its own neuter, pinning the four ORDER BY clauses in
--      the deployed body. The fix stands on the guarantee Postgres does NOT
--      make -- there is no defined tie-break BETWEEN two aggregates -- not on
--      an accident of today's plan, and the accident is exactly what a row
--      count, an index or a major version can change without warning.
--   6c. STEP 3: the `strategy_analytics_drop_stale_error_provenance` BEFORE
--      UPDATE trigger. See the enforcement paragraph above for why the invariant
--      belongs to the table.
--   7. Nothing else, and two of the "nothing else"s are load-bearing:
--      * COMMENT ON FUNCTION is NOT REISSUED. CREATE OR REPLACE keeps the
--        function's oid, so the pg_description row survives untouched. That
--        matters because that comment is the applied-ness KEY for arms 0a and
--        0b of supabase/tests/test_sync_status_marked_refresh_protected.sql,
--        and arm 0a's mutation twin EDITS the 20260825150000 ids inside
--        20260826120000's comment text. Reissuing the comment here would
--        overwrite that mutation later in the same apply list and the arm would
--        stop biting. The survival is ASSERTED at apply time in the self-verify
--        block below (assumption A1), keyed on '20260826120000' ONLY -- never on
--        '20260825150000', which is exactly what twin 0a strips, and which
--        would therefore abort this migration's own apply under the twin and
--        score a runner defect instead of the intended TEST FAILED (0a).
--      * computation_error_copy IS NOT REDEFINED. Twins 2/A-3 and 3/F-3 of
--        supabase/tests/test_compute_jobs_error_kind_copy_parity.sql mutate that
--        function's body inside 20260826120000; a redefinition here would
--        overwrite those mutations in-list and score no-red.
--
-- ⛔ THE OPERATOR COLUMN'S IDENTIFIER MUST NOT APPEAR IN THE FUNCTION BODY,
-- comments included. That is 20260826120000's H1 anchor and it is carried
-- forward verbatim below. pg_get_functiondef returns comments, so prose about
-- why the bridge does not read that column belongs HERE, in the file header,
-- which pg_get_functiondef does not return. The column in question is
-- compute_jobs.last_error, it is the OPERATOR surface, it still holds raw
-- classify_exception output, and NOTHING in this migration changes it.
--
-- NOT CHANGED, on purpose: computation_error_copy and its ACL; the bridge's
-- COMMENT ON FUNCTION; the protection predicate, the kind scope, the
-- has_live_successor scope and the two-read order (every anchor over them is
-- carried forward below); compute_jobs.last_error.


BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: the provenance columns
-- --------------------------------------------------------------------------
-- Nullable, NO DEFAULT, NO SET NOT NULL, NO FK. See the header for each.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS computation_error_source TEXT;

ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS computation_error_job_id UUID;

-- The CHECK is a separate, guarded statement so a re-run over an existing
-- column does not trip (the idiom at 20260416125430:65-88).
--
-- ⛔ ONE admissible value, deliberately. The column is not a free-text
-- attribution field: its only job is to say "a strategy_analytics failure
-- writer set this sentence". A widened domain would let a forged or careless
-- value read as provenance the bridge honours, and the mitigation for
-- T-164.2-11 is exactly this narrowness plus the job-id equality -- a marker
-- with a stale id never matches the job the bridge resolved, whatever its
-- source string says.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'strategy_analytics_computation_error_source_check'
       AND conrelid = 'public.strategy_analytics'::regclass
  ) THEN
    ALTER TABLE public.strategy_analytics
      ADD CONSTRAINT strategy_analytics_computation_error_source_check
      CHECK (computation_error_source IN ('writer'));
  END IF;
END
$$;

-- ⛔ THE PAIRING CONSTRAINT. The two markers are ONE fact spelled in two
-- columns, and this is what says so. Without it a writer that sets the source
-- and forgets the job id produces `'writer' AND NULL = <uuid>` -> NULL -> the
-- CASE's ELSE arm -> the per-kind generic. That direction is SAFE, and that is
-- exactly the problem: a half-stamped row is byte-indistinguishable from an
-- unstamped one at the reader, so a writer bug silently degrades every curated
-- sentence on that path and nothing anywhere reports it. Loud at the writer
-- (23514, naming this constraint) beats quiet at the reader.
--
-- ⚠️ The failure it makes loud sits on the FAILURE-RECORDING path, so the Python
-- writer must catch a constraint violation on the marker keys and retry WITHOUT
-- them -- otherwise a provenance bug costs the whole failure record rather than
-- just its provenance. That applies to the ('writer') CHECK above too, and is
-- booked for the writer plan in TODOS.md; it is a property of the WRITER, which
-- is why it cannot be fixed in this file.
--
-- Spelled as an equality between two IS NULL tests rather than as two implications:
-- it is total on both directions in one expression and has no NULL result.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'strategy_analytics_computation_error_markers_together_check'
       AND conrelid = 'public.strategy_analytics'::regclass
  ) THEN
    ALTER TABLE public.strategy_analytics
      ADD CONSTRAINT strategy_analytics_computation_error_markers_together_check
      CHECK ((computation_error_source IS NULL) = (computation_error_job_id IS NULL));
  END IF;
END
$$;

COMMENT ON COLUMN public.strategy_analytics.computation_error_source IS
  'Phase 164.2 / criterion 2: PROVENANCE for computation_error. NULL means '
  'BRIDGE-OR-LEGACY -- the sentence was written by sync_strategy_analytics_'
  'status, by the 16-hour stuck-computing reaper, by a pre-enqueue TypeScript '
  'writer, or before this column existed -- and reproduces the pre-164.2 '
  'behaviour exactly (no backfill was performed, deliberately: migrating '
  'historical rows would assert provenance nobody recorded). The single '
  'admissible non-NULL value is ''writer'', set by the analytics-service '
  'strategy_analytics failure writers IN THE SAME STATEMENT as the sentence '
  'itself, alongside computation_error_job_id. READ by '
  'sync_strategy_analytics_status, which keeps the existing sentence on '
  'branches (b) and (b-prime) only when this is ''writer'' AND '
  'computation_error_job_id equals the job that branch just resolved. The '
  'bridge NULLs this column on every overwrite and on every blank, so it can '
  'never stand over a sentence it does not describe.';

COMMENT ON COLUMN public.strategy_analytics.computation_error_job_id IS
  'Phase 164.2 / criterion 2: the compute_jobs.id whose failure the '
  'computation_error sentence describes. NULL means BRIDGE-OR-LEGACY '
  'provenance (see computation_error_source). Deliberately NOT a foreign key: '
  'compute_jobs rows are retained for audit under their own retention policy, '
  'and an FK would couple that retention to this column; the bridge''s test is '
  'an equality, so an id that no longer resolves simply fails to match and the '
  'per-kind generic wins. This id is what makes the preference DECIDABLE -- a '
  'presence test on the source column alone cannot tell THIS failure''s '
  'sentence from one left by an OLDER unresolved failure, which is the reason '
  '20260826120000''s header gave for recording the fix as owed work rather '
  'than doing it there. Written by the analytics-service strategy_analytics '
  'failure writers in the same statement as the sentence; NULLed by the bridge '
  'on every overwrite and every blank.';

-- --------------------------------------------------------------------------
-- STEP 2: the bridge, re-based on 20260826120000:336-905
-- --------------------------------------------------------------------------
-- Body copied VERBATIM from that file and edited ONLY at the six points listed
-- in THE DELTA above. COMMENT ON FUNCTION is deliberately not reissued; see the
-- header, and see assumption A1 in the self-verify block.
CREATE OR REPLACE FUNCTION sync_strategy_analytics_status(p_strategy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_job_count          INTEGER;
  v_nonterminal_count  INTEGER;
  v_failed_count       INTEGER;
  v_protected_count    INTEGER;
  v_unresolved_count   INTEGER;
  -- Phase 162 / HONEST-01: the STRUCTURED kind, not the free-text diagnostic.
  -- This function no longer reads the operator column at all; the file header
  -- carries the reasoning, because the self-verify block asserts the identifier
  -- is absent from this body INCLUDING its comments.
  v_latest_kind        TEXT;
  v_protected_kind     TEXT;
  -- Phase 164.2 / criterion 2: the IDENTITY of the failure each write branch is
  -- resolving, alongside its kind. The provenance markers on
  -- strategy_analytics are only honoured when they name THIS job, so the
  -- decision needs the id and not just the kind. Same aggregate, same FILTERs,
  -- same ordering as the two kinds above -- see the file header for why an id
  -- match rather than a bare "the column is non-NULL" test is what makes cases
  -- (ii) and (iii) of 20260826120000's owed-work paragraph decidable.
  v_latest_job_id      UUID;
  v_protected_job_id   UUID;
  v_publish_healthy    BOOLEAN;
  v_protect_hold       BOOLEAN;
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'sync_strategy_analytics_status: p_strategy_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- (d) no rows → preserve existing strategy_analytics row (unchanged).
  SELECT count(*) INTO v_job_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id;

  IF v_job_count = 0 THEN
    RETURN;
  END IF;

  -- ---- the NON-TERMINAL count — FIRST of this function's two compute_jobs ---
  -- ---- reads, and the ORDER IS THE CORRECTNESS ------------------------------
  -- Consumed by branch (a) far below. It is read HERE, and that placement is a
  -- data-integrity fix (161.1 migration re-review, HIGH), not tidiness.
  --
  -- ⛔ WHY THE ORDER OF THE TWO compute_jobs READS IS LOAD-BEARING
  -- This function reads compute_jobs twice for its verdict: the INCLUSIVE
  -- non-terminal set (here) and the non-superseded failed_final partition (the
  -- live_failures CTE below). Nothing runs them atomically. There is no
  -- isolation override anywhere in this repo, so this executes at READ
  -- COMMITTED, where every statement takes its OWN fresh snapshot and a
  -- concurrent transaction can commit a job's status flip BETWEEN them. Nor are
  -- the callers serialized per strategy: mark_compute_job_failed takes FOR
  -- UPDATE on the JOB row only, and neither it nor mark_compute_job_done takes
  -- pg_advisory_xact_lock(hashtext(strategy_id)) before its PERFORM of this
  -- function -- unlike positions_atomic_rebuild and sync_trades, which do. Two
  -- sibling jobs of one live-API strategy, claimed in the same batch, therefore
  -- run this concurrently as a matter of course.
  --
  -- The saving property is that a job's status is MONOTONE TOWARD TERMINAL.
  -- Every write that produces a non-terminal status is itself gated on a
  -- non-terminal status -- the claim RPCs move pending/failed_retry to running,
  -- defer_compute_job and reset_stalled_compute_jobs carry WHERE status =
  -- 'running', the fan-in release carries WHERE status = 'done_pending_children'
  -- -- and NOTHING in this schema moves a 'done' or 'failed_final' row back out
  -- of terminal. (The dropped-enqueue sweep of 20260819130500 "readmits" by
  -- INSERTING a fresh job, never by reviving the terminal one; the orphan
  -- terminalizer of 20260817120000 only moves running -> failed_final.)
  --
  -- Given monotonicity, reading the INCLUSIVE set FIRST and the failure set LAST
  -- is safe by construction: a job that crosses running -> failed_final between
  -- the two reads is caught by the LATER read, so the worst case is that it is
  -- counted twice -- which resolves to branch (a), or to the v_protect_hold
  -- stand-down, and never to a publish.
  --
  -- INVERTED, the same window has NO safe side. The failure read would see the
  -- job as still 'running' (not yet a failure) and this read would then see it
  -- as terminal (no longer in flight), so the job is invisible to BOTH counters:
  -- branch (a) is skipped (count 0), branch (b) is skipped (v_failed_count 0),
  -- branch (b-prime) is skipped (v_protected_count 0), and branch (c) fires and
  -- writes computation_status = 'complete', computation_error = NULL and
  -- computed_at = now() OVER A LIVE NON-SUPERSEDED PERMANENT FAILURE. That is a
  -- funded account published as healthy on top of a broken one -- the exact
  -- outcome branch (b-prime)'s own placement note declares must never happen.
  --
  -- 20260802120000 STEP 4 -- the definition this file re-bases -- read the two
  -- sets in this order, which is why it was never exposed. The first draft of
  -- THIS file inverted them by accident: the idempotence hoist lifted the
  -- partition above branch (a) and left this read below it. The self-verify
  -- block at the foot of this migration now PINS the order, so a future re-base
  -- cannot re-invert it silently.
  --
  -- ⚠️ WHAT THIS DOES NOT FIX, stated so the next reader does not over-trust it.
  -- Ordering makes the window's OUTCOME fail-safe; it does not close the window.
  -- A concurrent sibling can still leave a published row parked at 'computing'
  -- (branch (a) firing on a snapshot in which the marked job had not yet
  -- failed), which the 16-hour reaper of 20260802120000 then resolves. That is
  -- an unpublish that self-heals and is visible, versus a publish-over-failure
  -- that does neither. The real closure is a per-strategy
  -- pg_advisory_xact_lock in the two mark RPCs, matching the one
  -- positions_atomic_rebuild and sync_trades already take. Those RPCs are
  -- defined in other migrations, so it is deliberately NOT attempted here — a
  -- half-applied lock discipline is worse than a documented window.
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

  -- ---- Phase 161.1 / CR-01: is the published row still HEALTHY? -------------
  -- Conjunct (ii) of the protection predicate — see this file's header. Read
  -- ONCE, here, so branch (b)'s FILTER and branch (b-prime)'s FILTER cannot
  -- disagree about it within a single call.
  --
  -- ⛔ HOISTED ABOVE BRANCH (a), and that placement is the IDEMPOTENCE fix
  -- (161.1 migration re-review, MEDIUM). This read and the partition below used
  -- to sit AFTER branch (a)'s early return, which made them unreachable on the
  -- non-terminal path — and branch (a) writes 'computing' over exactly the
  -- status this reads. The protection was therefore re-derived, on every call,
  -- from a column this same function had transiently overwritten: grant the
  -- protection on a plain-'complete' row, let ANY sibling job bounce it to
  -- 'computing', and the NEXT bridge call read the row as unhealthy and routed
  -- the SAME still-live failure to the loud branch. Reading both facts BEFORE
  -- any write in this call makes the derivation a FIXED POINT instead: nothing
  -- this function does can change the answer the next call computes.
  --
  -- The hoist is semantically inert for every pre-existing path. Both reads see
  -- state this function has not yet WRITTEN (branch (a) was the only writer that
  -- could precede them, and it returned), and neither writes anything itself.
  -- The ONLY behaviour delta is the v_protect_hold guard on branch (a) below.
  --
  -- ⚠️ The hoist constrains this read and the partition to sit above branch
  -- (a)'s WRITE; it says nothing about where the non-terminal count sits. That
  -- is a SECOND, independent ordering constraint and it is satisfied above, not
  -- here: the non-terminal count must precede the PARTITION (monotonicity), and
  -- the health read must precede branch (a)'s write (idempotence). Both hold in
  -- the order as written, and the self-verify block pins each one separately —
  -- one assertion cannot stand in for the other.
  --
  -- ⛔ This is the whole fail-safe. It is a COHERENCE CHECK with the Python
  -- guard, not a second opinion: if the Python guard declined to protect, it
  -- has ALREADY written 'failed' + computation_warned = FALSE by the time this
  -- runs, so this reads FALSE and the loud path is taken. Never invert it, and
  -- never widen it to "a row exists" or to `OR computation_warned` — a row at
  -- 'failed' or 'computing' is NOT a published factsheet, and exempting one
  -- would launder a genuinely broken strategy into a published-looking one (or,
  -- for 'computing', park it there until the 16-hour reaper).
  --
  -- The status pair is the SAME pair as
  -- STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES in
  -- analytics-service/services/job_worker.py and the same pair the staleness
  -- view's success predicate uses (20260825120000, D-04). It is a PAIR: on the
  -- production ledger cohort `complete` is 0 and `complete_with_warnings` is 5,
  -- so a set narrowed to {'complete'} would protect NOTHING while still looking
  -- like a guard in review.
  SELECT EXISTS (
    SELECT 1
      FROM strategy_analytics sa
     WHERE sa.strategy_id = p_strategy_id
       AND sa.computation_status IN ('complete', 'complete_with_warnings')
  ) INTO v_publish_healthy;

  -- ---- the live-failure PARTITION (consumed by branches (b) and (b-prime)) ---
  -- PER-(strategy,kind) created_at SUPERSESSION (F-3 / PUB-02 close, mig 20260710150000):
  -- a failed_final poisons the strategy ONLY when it is NOT superseded by a
  -- strictly-later 'done' job of the SAME (strategy_id, kind). A fresh ledger
  -- generation (a re-enqueued job — enqueue dedup is in-flight-only, so a resubmit
  -- inserts a fresh generation while the stale failed_final is RETAINED for audit)
  -- clears the poison the moment it completes, WITHOUT deleting queue history.
  -- PER-KIND (d.kind = f.kind): a later done of a DIFFERENT kind can NEVER mask a
  -- real permanent failure (the cross-kind-blind defect that killed held PR
  -- 229d80fa). Keyed on the IMMUTABLE created_at (updated_at is trigger-stamped
  -- now() on every touch — non-deterministic generation ordering).
  --
  -- Phase 161.1 / CR-01: the non-superseded failures are PARTITIONED into
  -- protected (a marked recurring refresh over a still-healthy published row)
  -- and unprotected (everything else). See the header for why this is one
  -- statement over a CTE rather than the original's two: the non-supersession
  -- subquery is the most safety-critical predicate here and it is consulted
  -- four ways, so it is spelled ONCE.
  WITH live_failures AS (
    SELECT
      -- Phase 164.2 / criterion 2: the failing job's own id. Projected here so
      -- the aggregate below can carry it into v_latest_job_id /
      -- v_protected_job_id; the provenance decision on both write branches is
      -- an EQUALITY against this value, never a presence test.
      f.id,
      f.error_kind,
      f.created_at,
      -- ⛔ The two marker literals are a CROSS-LANGUAGE CONTRACT with no
      -- compiler between their ends: the other ends are
      -- `jsonb_build_object('source', …)` in the two fan-out migrations
      -- (20260825130000, 20260825140000) and the two inline comparisons in
      -- analytics-service/services/job_worker.py. If they drift, everything
      -- still compiles and the only symptom is a funded account going dark on
      -- the next failed refresh. A python drift gate pins all of them.
      --
      -- ⛔ THE KIND SCOPE IS THE SECOND HALF OF THE CONTAINMENT, not decoration
      -- (161.1 migration re-review, rls-policy-auditor MEDIUM). `metadata` is
      -- NOT a closed namespace and `'source'` is NOT a private key: the
      -- request-derived writers in analytics-service/routers/process_key.py put
      -- the caller's `body.source` straight into `p_metadata`.
      -- That value cannot collide with a refresh marker TODAY only because the
      -- Pydantic `Source` Literal at
      -- analytics-service/services/ingestion/adapter.py:59 admits venue names
      -- alone (okx|binance|bybit|csv|deribit|sfox|mt5) — one enum widening from
      -- a collision, in a file whose author has no reason to know this
      -- predicate exists. The kind scope is what survives that widening: both
      -- of those call sites enqueue kind 'process_key_long', which is not in
      -- this list and can never be. The three kinds here are exactly the kinds
      -- that can legitimately CARRY a marker — 'derive_broker_dailies'
      -- (20260825130000), 'stitch_composite' (20260825140000), and
      -- 'compute_analytics_from_csv', the JOB_CHAIN_FOLLOW_ON hop that
      -- services/job_worker.py forwards the marker onto. It is a
      -- hand-maintained list, so it is pinned against all three of those ends
      -- by the drift gate in
      -- analytics-service/tests/test_ledger_refresh_kind_scope_drift.py; add a
      -- fan-out arm without adding its kind here and that gate goes RED.
      --
      -- ⚠️ CITE CORRECTED 2026-09-06 (prose only, nothing executable moved).
      -- The `p_metadata` sentence above is inherited VERBATIM from migrations
      -- 20260825150000 and 20260826120000, where it read "the single
      -- request-derived writer, analytics-service/routers/process_key.py:766
      -- and :1518". BOTH halves were stale at this date: :766 is a BLANK line,
      -- and there are FOUR such sites rather than one -- `"source":
      -- body.source` occurs at :810 (the `p_metadata` dict spans :806-812),
      -- :1173, :1519 and :1597. The two earlier migrations are ALREADY APPLIED
      -- and are deliberately NOT edited, so the same stale cite still lives in
      -- both of them; this note is the correction of record. The containment
      -- argument is UNCHANGED -- four request-derived sites widen the surface,
      -- they do not remove the kind scope's need.
      --
      -- ⛔ It belongs to `is_protected`, NEVER to this CTE's WHERE clause.
      -- Moved into the WHERE it would drop out-of-scope failures from the
      -- source set entirely, so a REAL permanent failure of any other kind
      -- would vanish from branch (b) as well and fall through to branch (c) as
      -- a reported success. It narrows who may be PROTECTED; it must never
      -- narrow who may FAIL.
      --
      -- ⛔ COALESCE(..., FALSE) IS LOAD-BEARING, and it was MEASURED, not
      -- added defensively. `compute_jobs.metadata` is NULL on every job the
      -- worker and the wizard enqueue, so `NULL ->> 'source'` is NULL and
      -- `NULL IN (...)` is NULL — not FALSE. A NULL `is_protected` is excluded
      -- by BOTH `FILTER (WHERE is_protected)` AND `FILTER (WHERE NOT
      -- is_protected)`, so the failure would vanish from both classes and fall
      -- through to branch (c): every UNMARKED permanent failure would be
      -- silently reported as a successful computation. Arm C of
      -- supabase/tests/test_sync_status_marked_refresh_protected.sql caught
      -- exactly that and is RED without this COALESCE. The kind test is INSIDE
      -- the same COALESCE for the same reason, so a NULL kind resolves FALSE
      -- (unprotected → loud) rather than NULL (invisible to both classes).
      -- `v_publish_healthy` comes from a `SELECT EXISTS`, which is never NULL,
      -- so the COALESCE around the marker test is enough to make the whole
      -- conjunction two-valued.
      COALESCE(
        (f.metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
        AND f.kind IN ('derive_broker_dailies',
                       'compute_analytics_from_csv',
                       'stitch_composite'),
        FALSE
      ) AND v_publish_healthy AS is_protected,
      -- ⛔ 161.1 CR-01 FOLLOW-UP: "v_protect_hold leaks the refresh protection
      -- onto unrelated jobs" (migration re-review). TRUE when a job that will
      -- itself RESOLVE this failure is already in flight. The hold below stands
      -- down only when EVERY protected failure has one — that is what scopes the
      -- branch-(a) suppression to the jobs the protection is actually about,
      -- instead of to every bridge call on the strategy until a superseding
      -- 'done' lands.
      --
      -- ⛔ WHY SAME-KIND + LATER + UNMARKED, AND NOT "ANY IN-FLIGHT JOB".
      -- Releasing the hold lets branch (a) write 'computing', and that write
      -- DESTROYS the protection: conjunct (ii) is re-derived from the very
      -- column branch (a) overwrites, so once the row is bounced this failure is
      -- not protected on any later call. Releasing is therefore safe ONLY when
      -- the in-flight job's terminal outcome DOMINATES the failure — decides it
      -- correctly without the health read being consulted at all. Each conjunct
      -- buys exactly one half of that:
      --   * SAME KIND, strictly LATER — a 'done' SUPERSEDES this failure through
      --     the F-3/PUB-02 subquery below, so branch (c) resolves the row
      --     cleanly and the protection is never needed again.
      --   * UNMARKED — a 'failed_final' is then a user-initiated permanent
      --     failure, which is LOUD by design (arms C/D). Also a correct outcome.
      --   A MARKED successor has NEITHER property, and admitting one would
      --   reopen CR-01 through its own retry: the recurring arm re-attempting
      --   against a still-wedged gateway would release the hold, bounce the row
      --   to 'computing', fail again and take branch (b). Arm I4 pins that.
      --
      -- ⛔ MEASURED, not argued. Widen this to "any in-flight job" and a routine
      -- UNMARKED 'sync_trades' poller — cron-enqueued on every live-API strategy
      -- — walks a protected row from 'complete' to 'computing' to 'failed' in
      -- three bridge calls, on a job the user never initiated. That is arm I's
      -- scenario, and arm I is RED without this scoping.
      --
      -- ⚠️ The status list is spelled INCLUSIVELY (the same four branch (a)
      -- counts) rather than as NOT IN ('done','failed_final'), so an unrecognised
      -- future status is NOT a successor: it leaves the hold ON, i.e. at today's
      -- behaviour. Suppression is the direction an unknown must resolve to HERE,
      -- because here the unknown decides whether to give the protection UP.
      --
      -- ⚠️ This is the SECOND spelling of the marker literals in this body — the
      -- one thing DEVIATION 1 avoided for the supersession subquery. It cannot
      -- be folded into `is_protected`: that column is about the FAILURE, this one
      -- is about a different row. The self-verify block therefore asserts every
      -- marker list in the deployed body is spelled IDENTICALLY, so the two
      -- copies cannot drift from each other.
      EXISTS (
        SELECT 1
          FROM compute_jobs r
         WHERE r.strategy_id = f.strategy_id
           AND r.kind = f.kind
           AND r.created_at > f.created_at
           AND r.status IN ('pending', 'running',
                            'done_pending_children', 'failed_retry')
           AND NOT COALESCE(
                 (r.metadata ->> 'source')
                   IN ('ledger-refresh', 'ledger-refresh-composite'),
                 FALSE)
      ) AS has_live_successor
      FROM compute_jobs f
     WHERE f.strategy_id = p_strategy_id
       AND f.status = 'failed_final'
       AND NOT EXISTS (
         SELECT 1
           FROM compute_jobs d
          WHERE d.strategy_id = f.strategy_id
            AND d.kind = f.kind
            AND d.status = 'done'
            AND d.created_at > f.created_at
       )
  )
  SELECT
    count(*) FILTER (WHERE NOT is_protected),
    count(*) FILTER (WHERE is_protected),
    -- Protected failures that NOTHING in flight will resolve. A strict SUBSET of
    -- the protected class — it removes no row from either class, so the two-way
    -- partition above is untouched and every live failure still lands in exactly
    -- one of `is_protected` / `NOT is_protected`. Consumed ONLY by the
    -- branch-(a) hold below.
    count(*) FILTER (WHERE is_protected AND NOT has_live_successor),
    -- Phase 162 / HONEST-01: the MOST RECENT failure's structured kind, per
    -- class. Same ordering, same FILTERs, same partition as before — only the
    -- column changed, from the operator diagnostic to the enum that decides
    -- which curated sentence the user reads.
    --
    -- ⛔ THE ORDER IS TOTAL, and the trailing key is not tidiness. Four picks
    -- below choose "the first row" from four independent aggregate states, and
    -- the pairing this migration rests on -- that the kind and the id below
    -- describe the SAME failure -- is a claim that all four agree on which row
    -- that is. An ordering with ties leaves that to the executor. Ties are
    -- REACHABLE: the timestamp key is transaction-scoped, so a fan-out inserting
    -- several jobs in one statement stamps them identically. The primary key
    -- breaks every tie and it is spelled on ALL FOUR picks -- a tie-break on two
    -- of them would leave exactly the disagreement it was added to remove. The
    -- self-verify below COUNTS the four rather than testing for presence.
    (array_agg(error_kind ORDER BY created_at DESC, id DESC)
       FILTER (WHERE NOT is_protected))[1],
    (array_agg(error_kind ORDER BY created_at DESC, id DESC)
       FILTER (WHERE is_protected))[1],
    -- Phase 164.2 / criterion 2: the same two picks by IDENTITY. Same ordering,
    -- same FILTERs, same partition -- so v_latest_job_id names exactly the job
    -- whose kind became v_latest_kind, and v_protected_job_id exactly the job
    -- whose kind became v_protected_kind. That pairing is what lets a write
    -- branch ask "is the sentence already in the column the one THIS failure's
    -- writer just wrote?" instead of the unanswerable "is this sentence
    -- curated?" -- the distinction 20260826120000's header records as the
    -- reason the debt could not be paid there. Both are non-NULL whenever the
    -- branch that reads them fires: the branch's own guard is a count over the
    -- same FILTER, and compute_jobs.id is the primary key.
    (array_agg(id ORDER BY created_at DESC, id DESC)
       FILTER (WHERE NOT is_protected))[1],
    (array_agg(id ORDER BY created_at DESC, id DESC)
       FILTER (WHERE is_protected))[1]
    INTO v_failed_count, v_protected_count, v_unresolved_count,
         v_latest_kind, v_protected_kind,
         v_latest_job_id, v_protected_job_id
    FROM live_failures;

  -- ---- the branch-(a) EXEMPTION (161.1 re-review MEDIUM: idempotence) -------
  -- TRUE when branch (b-prime) is the outcome this call would reach if every job
  -- were terminal — a protected failure and NO unprotected one — AND at least
  -- one of those protected failures has nothing in flight that would resolve it.
  -- Under that and only that condition branch (a) stands down, so the published
  -- status it would have bounced to 'computing' stays put and the NEXT call
  -- re-derives the SAME protection.
  --
  -- ⛔ THE THIRD CONJUNCT IS THE SCOPE, added by the 161.1 CR-01 follow-up
  -- review ("v_protect_hold leaks the refresh protection onto unrelated,
  -- user-initiated jobs"). The first two are per-STRATEGY: with them alone, one
  -- live protected failed_final stood branch (a) down for EVERY later bridge
  -- call on that strategy until a same-kind 'done' superseded it. MEASURED
  -- consequence on a plain-'complete' row: a user-initiated resync never
  -- advertised 'computing', so `useStrategySyncPoller` — whose terminal test is
  -- `nextStatus === 'failed' || isComputedAnalytics(nextStatus)` — read a
  -- TERMINAL SUCCESS while the job was still running and SyncPreviewStep
  -- materialised the pre-resync factsheet. The third conjunct releases the hold
  -- once every protected failure has a live successor that will decide it
  -- (`has_live_successor` in the CTE above carries the whole safety argument for
  -- why only a same-kind, strictly-later, UNMARKED job counts).
  --
  -- ⛔ COALESCE all three ways, and note the defaults DIFFER on purpose. A NULL
  -- in any counter must resolve to NO HOLD, i.e. to today's behaviour, because
  -- standing branch (a) down on an unknown state would drop through to branches
  -- (b)/(c) with jobs still in flight — and branch (c) would report an
  -- unfinished computation as a completed one. Suppression is never the
  -- direction an unknown resolves to HERE. (Inside `has_live_successor` the
  -- unknown decides whether to GIVE UP the protection, so it resolves the other
  -- way; the invariant is "unknown ⇒ today's behaviour", not a fixed literal.)
  -- `count(*)` cannot return NULL, so these are belt-and-braces; they are also
  -- what keeps this predicate TWO-VALUED, which `IF ... AND NOT v_protect_hold`
  -- requires (a NULL there reads as false and would skip branch (a) — the exact
  -- inversion).
  --
  -- ⚠️ The third conjunct STRICTLY IMPLIES the first (an unresolved protected
  -- failure is a protected failure). The first is kept anyway, unaltered,
  -- because it is the half that states the tie to branch (b-prime) — delete it
  -- and the next reader has to re-derive that tie from the CTE's FILTER list.
  v_protect_hold := COALESCE(v_protected_count, 0) > 0
                    AND COALESCE(v_failed_count, 1) = 0
                    AND COALESCE(v_unresolved_count, 0) > 0;

  -- (a) any non-terminal row → 'computing', UNLESS the runner has already
  -- written 'complete_with_warnings' OR set its runner-owned computation_warned
  -- marker. That warning is a runner-owned terminal sub-state the compute_jobs
  -- aggregate cannot see; this branch fires whenever ANY sibling job for the
  -- strategy is still in flight (e.g. a poll_positions / sync_funding job claimed
  -- in the same batch as the warned analytics job, or a pre-mark bridge call while
  -- this job's own row is still 'running'). Writing a bare 'computing' here would
  -- launder the warning, which branch (c) would then resolve to a plain 'complete'
  -- — ordering-dependent, so it leaked on multi-job (live-API) strategies.
  -- Preserve it. Only the analytics runner clears the warning, via its own
  -- 'computing' entry-write + clean terminal write when it actually recomputes;
  -- the bridge must never downgrade it.
  --
  -- ⚠️ v_nonterminal_count is deliberately NOT read here. It is read at the TOP
  -- of this function, BEFORE the failure partition — see the read-order note
  -- there for why that is correctness and not tidiness. Moving the read back to
  -- this spot, i.e. AFTER the partition, is the inversion that lets branch (c)
  -- publish a live permanent failure as a clean success.
  --
  -- ⛔ `AND NOT v_protect_hold` is the CR-01 idempotence delta and the ONLY
  -- change to this branch; its body below is byte-identical to
  -- 20260802120000. When it stands down, control falls through to branch
  -- (b-prime) — never to (b) (v_failed_count = 0 is half of the hold) and never
  -- to (c) (v_protected_count > 0 is the other half), so the outcome is
  -- deterministic: record the error, clear the reaper key, touch no publish
  -- column. That is the same "a subscriber sees nothing change" contract the
  -- protection already had, now extended across the in-flight window.
  --
  -- A published row therefore stops advertising 'computing' while a protected
  -- failure is live AND NOTHING IN FLIGHT WOULD RESOLVE IT. That trailing
  -- clause is the 161.1 CR-01 follow-up scope; without it the suppression was
  -- per-strategy and swallowed the 'computing' advertisement of unrelated,
  -- user-initiated work (see v_protect_hold above). What remains suppressed is
  -- not a new shape for this branch: it ALREADY declines to show 'computing'
  -- over a sticky terminal success (the complete_with_warnings /
  -- computation_warned arm right below), which is the state of every strategy in
  -- the production ledger cohort today.
  --
  -- Three arms of supabase/tests/test_sync_status_marked_refresh_protected.sql
  -- pin this branch from three sides, and no one of them implies another:
  --   I2 — the exemption is an exemption, not a disablement. With NO protected
  --        failure live, an in-flight job must still read 'computing' and stamp.
  --   I3 — the exemption is SCOPED. With a protected failure live AND a
  --        same-kind unmarked successor in flight, the row must read 'computing'
  --        again, and the successor's 'done' must then resolve it through
  --        branch (c) — error cleared, computed_at advanced.
  --   I4 — the scope does not admit a MARKED successor. The recurring arm
  --        retrying against a still-wedged venue must NOT release the hold.
  IF v_nonterminal_count > 0 AND NOT v_protect_hold THEN
    -- JOB-01 (Phase 142): a FRESH INSERT at 'computing' IS the transition in, so
    -- the VALUES arm stamps now() unconditionally. The ON CONFLICT arm must NOT.
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id)
    VALUES (p_strategy_id, 'computing', NULL, now(), NULL, NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = CASE
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN 'complete_with_warnings'
             ELSE 'computing'
           END,
           computation_error  = EXCLUDED.computation_error,
           -- Phase 164.2 / criterion 2: the sentence on the line above is being
           -- blanked, so the provenance that described it must go with it. A
           -- marker left standing over a blanked sentence would make the NEXT
           -- generic write look like a curated one and freeze it there. This
           -- branch is also the reason the four TypeScript pre-enqueue writers
           -- need no marker at all: when a job starts, their sentence is stale
           -- by construction and superseding it is the correct outcome.
           computation_error_source = NULL,
           computation_error_job_id = NULL,
           -- JOB-01 (Phase 142): stamp on the TRANSITION INTO computing only,
           -- keyed off the RESOLVED status above — never off the branch. This
           -- bridge is PERFORMed in-RPC on EVERY job transition, so an
           -- unconditional now() here would reset the stamp on every hop of a
           -- multi-hop chain and the reaper would never fire (the Phase 106
           -- janitor bug, re-implemented in a new column).
           computing_started_at = CASE
             -- Arm 1: this branch RESOLVED to complete_with_warnings, i.e. the
             -- row is NOT computing. That is an exit — clear the stamp.
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN NULL
             -- Arm 2: resolved to 'computing' from some OTHER prior status —
             -- a genuine transition in. Stamp it.
             WHEN strategy_analytics.computation_status IS DISTINCT FROM 'computing'
             THEN now()
             -- Arm 3: already 'computing' — KEEP the original stamp, so a second
             -- bridge call cannot advance it and defer the reap indefinitely.
             ELSE strategy_analytics.computing_started_at
           END,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b) all terminal, any NON-SUPERSEDED UNPROTECTED failed_final → 'failed'
  -- with the CURATED sentence for the latest failure's kind (Phase 162 /
  -- HONEST-01 — this used to write the job's own diagnostic text, which is how
  -- a raw Python exception string became the thing a user read on a failed
  -- sync). The supersession and partition rules that decide
  -- v_failed_count are documented at the CTE above, which is now read before
  -- branch (a) rather than here (the idempotence hoist). Reaching this
  -- statement still means every job is terminal: branch (a) returns otherwise,
  -- and its one stand-down condition requires v_failed_count = 0.
  -- This write does NOT touch computation_warned — the runner-owned marker survives
  -- the 'failed' bounce in its own column, so branch (c) can recover the warning
  -- after a sibling failed_final→done recovery WITHOUT an analytics re-run (SI-02,
  -- closed by mig 20260708120000).
  IF v_failed_count > 0 THEN
    -- JOB-01 (Phase 142): SQL exit transition #1 — clear the stamp.
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id)
    VALUES (p_strategy_id, 'failed', computation_error_copy(v_latest_kind), NULL, NULL, NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           -- ⛔ Phase 164.2 / criterion 2 — THE CONDITIONAL. The generic
           -- per-kind sentence in the VALUES tuple above is what a FRESH row
           -- gets, always: there is no earlier writer sentence on a row that
           -- did not exist. On CONFLICT the row may already carry one, and this
           -- CASE is the only place that decides.
           --
           -- The predicate is an EQUALITY on the job, not a presence test on
           -- the marker, and that is the whole design. 20260826120000's header
           -- names three things a bare "the column is non-NULL" test cannot
           -- tell apart: (i) the sentence THIS failure's writer just wrote,
           -- (ii) a sentence left by an OLDER, still-unresolved failure, and
           -- (iii) operator text written by the pre-migration form of the
           -- protected branch. Keyed on the id of the job this branch itself
           -- resolved, (i) matches and (ii)/(iii) do not.
           --
           -- ⚠️ Plain `=`, deliberately NOT `IS NOT DISTINCT FROM`. Both
           -- markers are NULL on the ~103 legacy rows and on every row the
           -- bridge itself last touched, and a NULL on either side makes the
           -- WHEN neither true nor false, so control falls to ELSE and the
           -- generic wins. That is exactly today's behaviour, which is what
           -- "no backfill" is required to mean.
           computation_error  = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error ELSE EXCLUDED.computation_error END,
           -- The markers travel WITH the sentence they describe, on the same
           -- predicate. Kept when the sentence is kept; cleared when the
           -- generic overwrites it, so the next call cannot read this bridge's
           -- own generic as a writer's curated sentence.
           computation_error_source = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_source ELSE NULL END,
           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_latest_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,
           computing_started_at = NULL,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b-prime) Phase 161.1 / CR-01 — every live failure is a PROTECTED marked
  -- refresh over a still-healthy published row. Record the error; change
  -- nothing that a subscriber can see.
  --
  -- ⛔ Placement is load-bearing: strictly AFTER branch (b). An unprotected
  -- failure alongside a protected one must still poison the strategy, so the
  -- protected class is only ever consulted once the unprotected class is empty.
  --
  -- ⛔ And this must NOT fall through to branch (c). Branch (c) is the
  -- all-jobs-done success transition: it would clear computation_error to NULL
  -- and stamp computed_at = now(), i.e. report a FAILED refresh as a fresh
  -- successful computation. Reaching (c) with a live failed_final present is
  -- precisely the laundering this branch exists to avoid.
  IF v_protected_count > 0 THEN
    UPDATE strategy_analytics
       -- ⛔ ASSIGNED, and the COALESCE-over-the-existing-value that stood here
       -- from 161.1 review round 4 is GONE ON PURPOSE (Phase 162 / HONEST-01).
       -- ⚠️ TWO EARLIER DRAFTS OF THIS COMMENT DESCRIBED THAT COALESCE WRONGLY,
       -- in opposite directions, and both are corrected here by measurement
       -- (Phase 162 review F-4a/F-4b). What stood here was
       -- `COALESCE(<the failing job's own free-text diagnostic>, <this column>)`.
       -- Its LEFT arm is the OPERATOR column, and that column is non-NULL on
       -- EVERY reachable failed_final row: the file header's writer census shows
       -- exactly two writers of that status and both stamp it unconditionally
       -- (the RPC assigns it straight from its argument, whose two callers pass
       -- `kind or "unknown"`-style non-NULL strings; the reaper writes a fixed
       -- audit literal). So the left arm ALWAYS won. This branch was writing
       -- OPERATOR TEXT into a user-visible column on every protected failure,
       -- and the right arm was unreachable in practice.
       --
       -- That settles what the removal does and does not cost:
       --   * It does NOT cost the worker's curated per-failure sentence. An
       --     earlier draft claimed it did. Measured, that sentence was ALREADY
       --     being overwritten here — by the raw diagnostic, which is strictly
       --     worse than the per-kind copy that replaces it. This branch is a
       --     STRICT IMPROVEMENT over what it replaced, not a regression.
       --   * It does NOT lose a NULL-erasure guard either, which is what the
       --     other draft claimed. `computation_error_copy` is TOTAL — NULL in, a
       --     sentence out — so the hazard round 4 guarded cannot occur, and a
       --     COALESCE whose left arm is provably non-NULL is dead code that
       --     teaches the next reader that NULL is reachable here.
       --   * It DOES heal a row still carrying operator text written by the
       --     pre-migration form of this very branch, the next time it is touched.
       --
       -- ✅ WHAT WAS STILL LOST HERE IS NOW PAID (Phase 164.2 / criterion 2).
       -- 20260826120000 recorded, as OWED WORK rather than as an accepted
       -- trade, that the worker writes a CURATED per-failure sentence into this
       -- column moments before the RPC that runs this bridge and that this
       -- statement then replaced it with the per-KIND sentence — the loss a
       -- user reads on the portfolio stale warning. It also stated the exact
       -- reason the fix could not be "prefer the value already present": with
       -- no provenance, that cannot tell this failure's sentence from one left
       -- by an older unresolved failure, and it would freeze the operator text
       -- this branch heals.
       --
       -- The two marker columns are that provenance, and the CASE below is the
       -- preference made DECIDABLE: the existing sentence is kept only when a
       -- writer stamped it FOR THE JOB THIS BRANCH JUST RESOLVED. An older
       -- unresolved failure's sentence has a different job id and loses; text
       -- with no marker at all has no id and loses, so the healing property
       -- 20260826120000 added is untouched; and the retry-positive 'orphaned'
       -- copy still reaches the user, because the reaper stamps no marker.
       -- ⚠️ THE PYTHON HALF IS A SEPARATE PLAN. Until the writers set the
       -- markers, every row on this path has NULL markers, the CASE takes its
       -- ELSE arm, and this branch behaves EXACTLY as it did before. That is
       -- the intended deploy order, not an oversight.
       SET computation_error   = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_protected_job_id THEN strategy_analytics.computation_error ELSE computation_error_copy(v_protected_kind) END,
           -- The markers travel WITH the sentence, on the same predicate: kept
           -- when it is kept, cleared when the per-kind copy overwrites it.
           computation_error_source = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_protected_job_id THEN strategy_analytics.computation_error_source ELSE NULL END,
           computation_error_job_id = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = v_protected_job_id THEN strategy_analytics.computation_error_job_id ELSE NULL END,
           -- JOB-01: this is still an exit from computing. The publish columns
           -- are untouched on purpose; see the header for the full list of what
           -- is deliberately NOT written here (status, warned, computed_at).
           computing_started_at = NULL
     WHERE strategy_id = p_strategy_id;
    RETURN;
  END IF;

  -- (c) all rows 'done' → terminal SUCCESS. PRESERVE an existing
  -- 'complete_with_warnings' OR a runner-owned computation_warned marker (a
  -- more-informative success the analytics worker already wrote — the marker
  -- read is what closes the failed_final-bounce launder, since branch (b) may
  -- have bounced computation_status to 'failed' in between); otherwise resolve
  -- to 'complete'. Clears any stale computation_error either way.
  -- JOB-01 (Phase 142): SQL exit transition #2 — clear the stamp. Both arms of
  -- the status CASE are terminal, so the clear is unconditional here.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id)
  VALUES (p_strategy_id, 'complete', NULL, NULL, NULL, NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                OR strategy_analytics.computation_warned
           THEN 'complete_with_warnings'
           ELSE 'complete'
         END,
         computation_error  = NULL,
         -- Phase 164.2 / criterion 2: UNCONDITIONAL, exactly like the blank on
         -- the line above and for the same reason. Every live failure is gone;
         -- there is nothing left for a marker to describe, and one left
         -- standing here would be read by the NEXT failure's write branch as a
         -- writer's claim over a sentence that no longer exists.
         computation_error_source = NULL,
         computation_error_job_id = NULL,
         computing_started_at = NULL,
         computed_at        = now();
END;
$$;


-- ACL. Carried forward VERBATIM from 20260826120000:909 -- a bare REVOKE with
-- no matching GRANT, because this function is SECURITY DEFINER and owned and
-- its only callers are service-role RPCs (mark_compute_job_failed,
-- mark_compute_job_done) that reach it by in-RPC PERFORM. There is no GRANT to
-- preserve here; the symmetric REVOKE+GRANT pair in that file belongs to
-- computation_error_copy, which this migration does not touch.
REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 3: the invariant, moved from this file's prose to the table
-- --------------------------------------------------------------------------
-- See the header's ⛔⛔ paragraph for the enumerated writers and the measured
-- NULL-sentence scenario this closes. In one line: a statement that CHANGES the
-- sentence WITHOUT RESTATING the provenance drops the provenance.
--
-- SHAPE COPIED FROM `strategy_analytics_stamp_computing_started` (mig
-- 20260803120000:116-186), which enforces the neighbouring
-- computing_started_at invariant on this same table from the same event:
-- SECURITY INVOKER (the default -- the body touches only its own NEW/OLD tuples
-- and needs no privilege the firing statement does not already hold), pinned
-- search_path, self-contained (no helper call -- see 20260516170000:3-11 for the
-- incident class that rule exists to avoid), REVOKEd from the API roles so it is
-- never reachable as a PostgREST RPC, and BEFORE UPDATE FOR EACH ROW.
--
-- ⚠️ IT COEXISTS WITH THAT TRIGGER AND CANNOT FIGHT IT. Two BEFORE ROW triggers
-- on one table fire in name order, each handed the previous one's NEW tuple.
-- This one assigns ONLY the two marker columns; that one assigns ONLY
-- computing_started_at. The column sets are disjoint, so the composition is
-- order-independent and the alphabetical precedence of this name is not a fact
-- anything depends on.
--
-- ⚠️ UPDATE ONLY, deliberately, matching 20260803120000's D-18 scope. An INSERT
-- has no OLD tuple, so there is no prior provenance to invalidate: a fresh row's
-- markers describe the sentence inserted beside them by construction. A DELETE
-- would additionally require the sanitize_user erasure exemption
-- (20260710160000:67), and there is nothing here to enforce on one.
--
-- ⛔ IT NEVER RAISES. It coerces, silently, exactly as the stamp trigger does
-- and for the same reason recorded there: raising would kill a live
-- analytics-service write, burn its retries and strand the strategy. The
-- coercion is toward the pre-164.2 behaviour (no provenance -> the per-kind
-- generic), which is the direction every unknown in this file resolves to.
--
-- ⛔ THE BODY CARRIES NO COMMENTS, AND THAT IS THIS FILE'S H1 RULE APPLIED HERE
-- RATHER THAN AN OVERSIGHT. pg_get_functiondef returns comments, and the
-- self-verify block below anchors on this body's ONE conditional. A comment
-- restating the predicate would satisfy those anchors over a deleted predicate,
-- which is the failure mode the whole self-verify convention exists to avoid.
-- The prose lives here and in the COMMENT ON FUNCTION, neither of which
-- pg_get_functiondef returns.
CREATE OR REPLACE FUNCTION public.strategy_analytics_drop_stale_error_provenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_catalog
AS $$
BEGIN
  IF NEW.computation_error IS DISTINCT FROM OLD.computation_error
     AND NEW.computation_error_source IS NOT DISTINCT FROM OLD.computation_error_source
     AND NEW.computation_error_job_id IS NOT DISTINCT FROM OLD.computation_error_job_id
  THEN
    NEW.computation_error_source := NULL;
    NEW.computation_error_job_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.strategy_analytics_drop_stale_error_provenance() IS
  'Phase 164.2 / criterion 2: enforces the computation_error PROVENANCE '
  'invariant at the table, for EVERY writer. Any UPDATE that CHANGES '
  'computation_error while leaving computation_error_source and '
  'computation_error_job_id at the values they already held has both markers '
  'coerced to NULL, because a marker that outlives the sentence it describes is '
  'read by sync_strategy_analytics_status as a writer''s claim over text that is '
  'gone -- which is strictly worse than having no provenance at all. This '
  'closes it for the analytics-service success writers (_mark_complete, '
  'headline_payload), the failure re-write path (_upsert_error_only) and '
  'set_wizard_composite_members (mig 20260712120000) WITHOUT editing any of '
  'them, and for every writer added after this date. Cost, stated: PL/pgSQL '
  'cannot tell "column omitted from the SET list" from "column set to its '
  'current value", so a writer re-stamping the SAME job id with a DIFFERENT '
  'sentence also loses its marker and falls back to the per-kind generic -- the '
  'pre-164.2 behaviour, never a corruption. Does NOT fire on the bridge''s own '
  'writes: branches (b)/(b-prime) keep the sentence UNCHANGED when they keep the '
  'markers (first condition false), and change the sentence while NULLing the '
  'markers explicitly when they do not (second and third false). '
  'Self-contained: reads only NEW/OLD, calls nothing (mig 20260516170000:3-11).';

REVOKE ALL ON FUNCTION public.strategy_analytics_drop_stale_error_provenance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS strategy_analytics_drop_stale_error_provenance_trigger ON public.strategy_analytics;
CREATE TRIGGER strategy_analytics_drop_stale_error_provenance_trigger
  BEFORE UPDATE ON public.strategy_analytics
  FOR EACH ROW
  EXECUTE FUNCTION public.strategy_analytics_drop_stale_error_provenance();

COMMENT ON TRIGGER strategy_analytics_drop_stale_error_provenance_trigger ON public.strategy_analytics IS
  'Phase 164.2 / criterion 2: fires on UPDATE only -- not insert (a fresh row''s '
  'markers describe the sentence inserted beside them), not delete (nothing to '
  'enforce, and it would need the sanitize_user erasure exemption of '
  '20260710160000:67). Drops computation_error_source / computation_error_job_id '
  'whenever a statement changes computation_error without restating them. Fires '
  'alongside strategy_analytics_stamp_computing_started_trigger; the two assign '
  'DISJOINT column sets, so their relative order is immaterial.';

-- --------------------------------------------------------------------------
-- Self-verify -- this migration's own deltas AND every anchor the re-base must
-- not silently revert
-- --------------------------------------------------------------------------
-- ⛔⛔ THE RULE FOR THIS BLOCK, inherited from 20260826120000:967-988 and still
-- the whole reason it is worth writing: `pg_get_functiondef` RETURNS THE BODY'S
-- COMMENTS, and this function's prose quotes almost every identifier and
-- literal it uses. An anchor keyed on a bare identifier or a bare literal is
-- satisfied by the very paragraph that describes the fix it claims to pin, and
-- reports "verified" over a reverted fix. Anchor on a STATEMENT or an
-- EXPRESSION; where a construct has several legitimate code copies, key on the
-- specific one or assert the COUNT.
--
-- Every anchor that existed at 20260826120000 is carried forward here, because
-- a re-base is exactly the event that reverts one silently (that file's own
-- delta note, :237-240, states the rule and records it having happened). Two of
-- them had to be RE-ANCHORED rather than copied: branch (b-prime)'s SET is no
-- longer a bare assignment, so the positive anchor keyed on
-- `SET computation_error = computation_error_copy(v_protected_kind)` and the two
-- negative anchors keyed on that same prefix would all have matched NOTHING --
-- a positive anchor that can never be satisfied is RED on every apply, and a
-- negative anchor whose prefix no longer exists is SILENTLY DEAD. That file's
-- comment at :1213-1223 predicted this exact edit and asked the next author to
-- come back here. This is that author doing so.
DO $verify$
DECLARE
  v_secdef      BOOLEAN;
  v_search_path TEXT;
  v_atttypid    OID;
  v_attnotnull  BOOLEAN;
  v_atthasdef   BOOLEAN;
  v_condef      TEXT;
  v_comment     TEXT;
  v_fn          TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
  -- STEP 3's trigger. Read into its own variable rather than reusing v_fn: the
  -- two bodies share almost every identifier, and one anchor accidentally run
  -- against the other body is an anchor that reports on the wrong object.
  v_fn_trg      TEXT;
  v_tgtype      SMALLINT;
  v_tgenabled   "char";
  v_trg_secdef  BOOLEAN;
  v_trg_config  TEXT;
BEGIN
  -- ======================================================================
  -- (P0) THE COLUMN SHAPE. Type, nullability and defaultlessness are ASSERTED,
  -- not assumed: 20260803150000:92-94 records why -- `ADD COLUMN IF NOT EXISTS`
  -- silently no-ops on a pre-existing column of ANY type, so a column that
  -- already existed with the wrong type would leave this migration reporting
  -- success over a bridge that cannot read it.
  -- ======================================================================
  SELECT a.atttypid, a.attnotnull, a.atthasdef
    INTO v_atttypid, v_attnotnull, v_atthasdef
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_analytics'::regclass
     AND a.attname = 'computation_error_source'
     AND NOT a.attisdropped;
  IF v_atttypid IS NULL THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_source is missing after ADD COLUMN. The bridge below reads it on both write branches; without the column every call would abort with 42703 on the live money path';
  END IF;
  IF v_atttypid <> 'text'::regtype THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_source is not text. ADD COLUMN IF NOT EXISTS no-ops on a pre-existing column of ANY type, so this is what stands between a wrong-typed column and a green migration';
  END IF;
  IF v_attnotnull THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_source is NOT NULL. NULL is the BRIDGE-OR-LEGACY provenance value and it is the value every existing row and every unstamped writer produces; NOT NULL here is a 23502 timebomb against them';
  END IF;
  IF v_atthasdef THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_source carries a DEFAULT. A default would assert writer provenance for rows nobody stamped, and the bridge would then honour a sentence it wrote itself';
  END IF;

  SELECT a.atttypid, a.attnotnull, a.atthasdef
    INTO v_atttypid, v_attnotnull, v_atthasdef
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_analytics'::regclass
     AND a.attname = 'computation_error_job_id'
     AND NOT a.attisdropped;
  IF v_atttypid IS NULL THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_job_id is missing after ADD COLUMN. It is the half of the provenance that makes the preference decidable; without it the bridge cannot tell THIS failure''s sentence from an older one''s';
  END IF;
  IF v_atttypid <> 'uuid'::regtype THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_job_id is not uuid. compute_jobs.id is uuid, and a type mismatch makes the equality on both write branches a cast error rather than a comparison';
  END IF;
  IF v_attnotnull THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_job_id is NOT NULL. NULL is the BRIDGE-OR-LEGACY value; NOT NULL is a 23502 timebomb against every existing writer';
  END IF;
  IF v_atthasdef THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics.computation_error_job_id carries a DEFAULT; it must have none';
  END IF;

  -- (P0b) The CHECK, asserted BY ITS DEFINITION rather than by its name. A
  -- constraint of the right name that admitted any string would be the
  -- T-164.2-11 mitigation reading as present while restricting nothing.
  SELECT pg_get_constraintdef(c.oid)
    INTO v_condef
    FROM pg_constraint c
   WHERE c.conname = 'strategy_analytics_computation_error_source_check'
     AND c.conrelid = 'public.strategy_analytics'::regclass;
  IF v_condef IS NULL THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics_computation_error_source_check is missing. It is the T-164.2-11 mitigation -- the column''s domain is one value, so a marker cannot carry an arbitrary attribution string';
  END IF;
  IF v_condef !~ '''writer''' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics_computation_error_source_check exists but does not restrict the column to ''writer''. A constraint of the right name that admits anything is the mitigation reading as present while restricting nothing';
  END IF;

  -- (P0d) THE PAIRING CHECK, asserted by its DEFINITION for the same reason.
  -- It is what turns a half-stamped marker into a 23514 at the writer instead
  -- of a silent fall to the per-kind generic at the reader, and a constraint of
  -- the right name over the wrong expression is that mitigation reading as
  -- present while permitting the half-stamp.
  SELECT pg_get_constraintdef(c.oid)
    INTO v_condef
    FROM pg_constraint c
   WHERE c.conname = 'strategy_analytics_computation_error_markers_together_check'
     AND c.conrelid = 'public.strategy_analytics'::regclass;
  IF v_condef IS NULL THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics_computation_error_markers_together_check is missing. Without it a writer that sets the source and omits the job id produces ''writer'' AND NULL = <uuid>, i.e. NULL, so the bridge falls to its ELSE arm and writes the generic -- SAFE, and therefore SILENT: a half-stamped row is indistinguishable from an unstamped one at the reader, and a writer bug degrades every curated sentence on that path with no signal anywhere';
  END IF;
  IF v_condef !~ 'computation_error_source\s+IS\s+NULL'
     OR v_condef !~ 'computation_error_job_id\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics_computation_error_markers_together_check does not test BOTH marker columns for NULL. A one-sided constraint permits exactly the half-stamp it is named for';
  END IF;

  -- ======================================================================
  -- (P0c) ASSUMPTION A1 -- MEASURED HERE, at apply time, on every database this
  -- migration touches.
  -- ======================================================================
  -- This migration deliberately does NOT reissue COMMENT ON FUNCTION, on the
  -- premise that CREATE OR REPLACE keeps the function's oid and therefore its
  -- pg_description row. If that premise is wrong, arms 0a and 0b of
  -- supabase/tests/test_sync_status_marked_refresh_protected.sql lose their
  -- applied-ness key and stop biting -- silently, because a missing comment
  -- makes those arms RAISE for a reason that reads like a missing migration.
  --
  -- ⛔ KEYED ON '20260826120000' AND NOTHING ELSE. Do NOT add an assertion on
  -- '20260825150000': that is precisely the id arm 0a's mutation twin STRIPS
  -- from 20260826120000's comment text. Under the twin, an assertion on it here
  -- would RAISE inside this block, abort the apply BEFORE the gate runs, and the
  -- mutation runner would score a defect instead of the intended
  -- `TEST FAILED (0a)`. Twin 0a leaves '20260826120000' intact, so keying A1 on
  -- that id alone keeps A1 measured AND leaves the twin biting.
  v_comment := COALESCE(
    obj_description('sync_strategy_analytics_status(uuid)'::regprocedure, 'pg_proc'),
    ''
  );
  IF v_comment !~ '20260826120000' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed (assumption A1): the sync_strategy_analytics_status COMMENT does not carry 20260826120000 after this CREATE OR REPLACE, so the premise this migration rests on -- that CREATE OR REPLACE preserves the function''s pg_description row -- is FALSE on this database. Consequence: arms 0a and 0b of supabase/tests/test_sync_status_marked_refresh_protected.sql have lost their applied-ness key and every one of that gate''s 16 arms would stop running. FIX: take option (ii) -- reissue COMMENT ON FUNCTION here with the full migration roll-call plus this id, AND re-point arm 0a''s RED-UNDER-M twin at this file in the same commit. Do NOT paper over this by deleting the assertion';
  END IF;

  -- ======================================================================
  -- (P1) FUNCTION-LEVEL SHAPE AND ACL -- carried forward from 20260826120000.
  -- ======================================================================
  SELECT COALESCE(
    (SELECT p.prosecdef FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
      LIMIT 1), FALSE)
  INTO v_secdef;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Criterion 2 re-base failed: sync_strategy_analytics_status lost SECURITY DEFINER in the re-base';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'Criterion 2 re-base failed: sync_strategy_analytics_status lost its pinned search_path in the re-base';
  END IF;

  -- The EXECUTE ACL actually took. A CREATE OR REPLACE preserves the
  -- pre-existing ACL, so a re-apply over a drifted grant would carry the drift
  -- forward silently. This is a cross-tenant SECURITY DEFINER *writer* with no
  -- ownership predicate anywhere in its body.
  IF has_function_privilege('anon', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Criterion 2 re-base failed: role anon can EXECUTE sync_strategy_analytics_status -- the REVOKE above did not take, and this function writes strategy_analytics for ANY strategy_id with no ownership check';
  END IF;
  IF has_function_privilege('authenticated', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Criterion 2 re-base failed: role authenticated can EXECUTE sync_strategy_analytics_status -- the REVOKE above did not take, and this function writes strategy_analytics for ANY strategy_id with no ownership check';
  END IF;

  -- ======================================================================
  -- (P2) THIS MIGRATION'S OWN FAIL-WITHOUT-FIX ANCHORS.
  -- ======================================================================

  -- (P2a) The two job-id picks exist, on the SAME aggregate, with the SAME
  -- FILTERs as the two kind picks. Keyed on the whole subscripted expression:
  -- no comment in this body spells `array_agg(id ORDER BY created_at DESC)`,
  -- and a FILTER swapped between the two would hand a branch the OTHER class's
  -- job id -- which is worse than no provenance, because the equality would
  -- then fail on exactly the row it should match and pass on one it should not.
  IF v_fn !~ '\(\s*array_agg\s*\(\s*id\s+ORDER\s+BY\s+created_at\s+DESC\s*,\s*id\s+DESC\s*\)\s*FILTER\s*\(\s*WHERE\s+NOT\s+is_protected\s*\)\s*\)\s*\[\s*1\s*\]' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the UNPROTECTED job-id pick is missing, is not FILTERed to `NOT is_protected`, or lost its `, id DESC` tie-break. Branch (b) would then compare the row''s marker against the wrong job (or against NULL), and every writer-curated sentence on the loud path would be overwritten by the per-kind generic -- i.e. criterion 2 reverted while the columns still exist and read as a fix';
  END IF;
  IF v_fn !~ '\(\s*array_agg\s*\(\s*id\s+ORDER\s+BY\s+created_at\s+DESC\s*,\s*id\s+DESC\s*\)\s*FILTER\s*\(\s*WHERE\s+is_protected\s*\)\s*\)\s*\[\s*1\s*\]' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the PROTECTED job-id pick is missing, is not FILTERed to `is_protected`, or lost its `, id DESC` tie-break. Branch (b-prime) -- the D-15 recurring-refresh path, which is where the curated sentence matters most because the row stays published -- would compare against the wrong job and always fall to the generic';
  END IF;

  -- (P2a-tie) THE ORDER IS TOTAL ON ALL FOUR PICKS. A COUNT, not a presence
  -- test, and the count is what makes this arm able to fail at all: a tie-break
  -- added to the two id picks alone leaves the two KIND picks free to choose a
  -- different first row on a tie, which is the exact disagreement the tie-break
  -- was added to remove -- and both spellings would satisfy any presence test.
  -- Ties are reachable: created_at is stamped from a transaction-scoped clock,
  -- so a fan-out inserting several jobs in ONE statement stamps them equal.
  -- ⚠️ Keyed on the executable `array_agg(` spelling. No comment in this body
  -- spells it (the prose at the aggregate says "the four picks", deliberately),
  -- so this count is over code. If a future comment does spell it, this arm goes
  -- RED and the fix is to reword the comment -- never to raise the integer.
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'array_agg\s*\([^)]*ORDER\s+BY\s+created_at\s+DESC\s*,\s*id\s+DESC\s*\)', 'g')) <> 4 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the live-failure aggregate does not carry `ORDER BY created_at DESC, id DESC` on EXACTLY the four picks (two error_kind, two id). Postgres guarantees no tie-break BETWEEN two aggregates, so with a non-total order the kind can be taken from one job and the id from another -- and the bridge then compares the row''s marker against a job that is not the one whose sentence it is reading, failing on exactly the row it should match. A partial fix (two of four) is indistinguishable from none';
  END IF;
  IF v_fn !~ 'INTO\s+v_failed_count\s*,\s*v_protected_count\s*,\s*v_unresolved_count\s*,\s*v_latest_kind\s*,\s*v_protected_kind\s*,\s*v_latest_job_id\s*,\s*v_protected_job_id' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the aggregate''s INTO list does not end in v_latest_job_id, v_protected_job_id in that order. The INTO list is positional -- a reordering silently assigns a kind to a job-id variable or swaps the two classes'' ids, and both compile';
  END IF;

  -- (P2a-neg) NEGATIVE: the marker comparison must stay NULL-INTOLERANT.
  -- Written as a ban on the NULL-equating spelling, because that is the one edit
  -- that looks like a tidy-up and silently changes the semantic "no backfill"
  -- depends on: `IS NOT DISTINCT FROM` makes NULL = NULL TRUE, so every legacy
  -- row -- both markers NULL -- would match a branch whose own job id is NULL
  -- and have its stale sentence preserved.
  -- ⛔ IT SITS HERE, ABOVE THE SIX POSITIVE CASE ANCHORS, AND THAT PLACEMENT IS
  -- WHAT MAKES IT ABLE TO FIRE AT ALL. Every positive anchor below spells
  -- `computation_error_job_id\s*=\s*v_..._job_id`, so an edit to
  -- `IS NOT DISTINCT FROM` breaks one of THEM first and this ban would never be
  -- reached -- an assertion that can only fire in a state where an earlier one
  -- already fired contributes nothing while READING as independent coverage.
  -- ⚠️ The FIRST draft of this block sat below them and was moved here before
  -- anything was measured; what IS measured is this position -- the swap raises
  -- THIS message, which is the one that names the actual regression. Do not
  -- move it back down.
  IF v_fn ~* 'computation_error_job_id\s+IS\s+NOT\s+DISTINCT\s+FROM' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the job-id marker is compared with IS NOT DISTINCT FROM. That makes NULL = NULL TRUE, so the ~103 legacy rows and every bridge-written row -- all of which carry NULL markers -- would be treated as writer-provenanced whenever the branch''s own job id is NULL, and their stale sentences would be frozen in place. Plain `=` is required: a NULL on either side must fall to the ELSE arm, which IS today''s behaviour and is exactly what "no backfill" was decided to mean';
  END IF;

  -- (P2b) BRANCH (b) -- the loud path. Three anchors, one per assigned column,
  -- each keyed on the WHOLE CASE expression. A fragment anchor would be
  -- satisfied by this branch's own comments, which quote the predicate.
  IF v_fn !~ 'computation_error\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_latest_job_id\s+THEN\s+strategy_analytics\.computation_error\s+ELSE\s+EXCLUDED\.computation_error\s+END' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: branch (b) does not keep a writer-provenanced sentence for the job it just resolved. Either the CASE is gone (the unconditional overwrite is back and criterion 2 is reverted), or its predicate no longer requires BOTH source = ''writer'' AND the job-id equality -- and a presence-only test freezes an OLDER unresolved failure''s sentence, and pre-migration operator text, over a live newer failure';
  END IF;
  IF v_fn !~ 'computation_error_source\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_latest_job_id\s+THEN\s+strategy_analytics\.computation_error_source\s+ELSE\s+NULL\s+END' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: branch (b) does not carry the source marker on the SAME predicate as the sentence. If the marker survives an overwrite, this bridge''s own per-kind generic is left looking writer-curated and the NEXT failure''s generic is frozen out by it -- strictly worse than having no provenance at all';
  END IF;
  IF v_fn !~ 'computation_error_job_id\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_latest_job_id\s+THEN\s+strategy_analytics\.computation_error_job_id\s+ELSE\s+NULL\s+END' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: branch (b) does not carry the job-id marker on the SAME predicate as the sentence. A stale id left beside an overwritten sentence is a claim about a job whose text is gone';
  END IF;

  -- (P2c) BRANCH (b-prime) -- the D-15 protected refresh. The first of these
  -- three RE-ANCHORS 20260826120000:1187-1190, which asserted
  -- `SET computation_error = computation_error_copy(v_protected_kind)` as a bare
  -- assignment. That is now the ELSE arm of a CASE, so the old anchor would have
  -- matched nothing and become a positive anchor that can never be satisfied.
  -- Its claim -- that this branch still writes the per-kind copy, and has not
  -- gone back to copying the failing job's own diagnostic into a user-visible
  -- column -- is preserved here, on the arm that now carries it.
  IF v_fn !~ 'SET\s+computation_error\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_protected_job_id\s+THEN\s+strategy_analytics\.computation_error\s+ELSE\s+computation_error_copy\s*\(\s*v_protected_kind\s*\)\s+END' THEN
    RAISE EXCEPTION 'HONEST-01 + criterion 2 verification failed: branch (b-prime)''s SET is not the expected CASE. Three regressions fit and all are silent: (1) the conditional is gone and the curated sentence is unconditionally overwritten again (criterion 2 reverted); (2) the ELSE arm no longer writes computation_error_copy(v_protected_kind) -- either the branch is back to putting the failing job''s own diagnostic text into a user-visible column, which is the HONEST-01 defect, or it lost the write entirely and a protected refresh failure is silent; (3) the predicate was weakened to a presence test, which freezes an older unresolved protected failure''s sentence over a live newer one on the ONE branch where the row stays published';
  END IF;
  IF v_fn !~ 'computation_error_source\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_protected_job_id\s+THEN\s+strategy_analytics\.computation_error_source\s+ELSE\s+NULL\s+END' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: branch (b-prime) does not carry the source marker on the SAME predicate as the sentence. A marker surviving the per-kind overwrite on the protected path would make the bridge''s own generic read as curated on a row that stays published';
  END IF;
  IF v_fn !~ 'computation_error_job_id\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_protected_job_id\s+THEN\s+strategy_analytics\.computation_error_job_id\s+ELSE\s+NULL\s+END' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: branch (b-prime) does not carry the job-id marker on the SAME predicate as the sentence';
  END IF;

  -- (P2d) BRANCHES (a) AND (c) CLEAR BOTH MARKERS. A COUNT, not a presence test
  -- -- the same idiom, and for the same reason, as the SI-02 count below: each
  -- of the two branches blanks computation_error, and a marker left standing
  -- over a blanked sentence is read by the NEXT write as a writer's claim.
  -- Losing EITHER copy re-opens that from a different side, and a presence test
  -- is satisfied by whichever survives. Counted at 2 because the unconditional
  -- clear appears in exactly those two branches; the ELSE NULL arms in (b) and
  -- (b-prime) are conditional and are spelled differently, so they do not count
  -- here and are anchored above.
  -- ⚠️ If a future re-base legitimately changes how many unconditional clears
  -- exist, update the integer AND say which branch changed -- do not relax this
  -- to a presence test, which is what makes an anchor like this vacuous.
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'computation_error_source\s*=\s*NULL', 'g')) <> 2 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the UNCONDITIONAL source-marker clear must appear in EXACTLY the two branches that blank computation_error -- (a) the computing entry-write and (c) the all-done success write. Losing (a)''s copy leaves a stale writer claim over the NULL a starting job wrote, so the reaper''s later sentence and the next failure''s generic are both judged against it; losing (c)''s leaves one over a resolved strategy, where the next failure''s generic is frozen out by a job that no longer has a failure';
  END IF;
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'computation_error_job_id\s*=\s*NULL', 'g')) <> 2 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the UNCONDITIONAL job-id-marker clear must appear in EXACTLY the two branches that blank computation_error -- (a) and (c). A job id left standing over a blanked sentence is a claim about text that no longer exists, and the next equality test will honour it';
  END IF;

  -- ======================================================================
  -- (P3) STEP 3's TRIGGER -- the invariant that no longer lives in prose.
  -- ======================================================================
  -- Every arm here is about the ONE claim the header's ⛔⛔ paragraph makes:
  -- that a marker cannot outlive the sentence it describes NO MATTER WHICH
  -- WRITER changed it. That claim is worth nothing if the trigger is absent,
  -- bound to the wrong event, or coerces the wrong way -- and each of those
  -- three is silent, because the bridge keeps compiling and the columns keep
  -- existing either way.

  -- (P3a) The trigger EXISTS and is bound to the right function. Read first, so
  -- a missing trigger reddens by NAME rather than through a NULL tgtype three
  -- lines down (arm K's rule in the template gate, applied here).
  SELECT t.tgtype, t.tgenabled
    INTO v_tgtype, v_tgenabled
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.strategy_analytics'::regclass
     AND t.tgname = 'strategy_analytics_drop_stale_error_provenance_trigger'
     AND NOT t.tgisinternal
     AND t.tgfoid = 'public.strategy_analytics_drop_stale_error_provenance()'::regprocedure;
  IF v_tgtype IS NULL THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the trigger strategy_analytics_drop_stale_error_provenance_trigger is absent from strategy_analytics, or does not call strategy_analytics_drop_stale_error_provenance(). Without it the provenance invariant is a claim in a file header again: _mark_complete blanks the sentence and leaves the markers, and the NEXT branch-(b) call for that same job id keeps the "existing sentence" -- which is NULL. The row then renders computation_status = ''failed'' with no sentence at all, where the pre-164.2 bridge wrote the per-kind copy';
  END IF;

  -- (P3b) BOUND TO BEFORE UPDATE FOR EACH ROW, all three bits asserted.
  -- Bits: ROW=1, BEFORE=2, INSERT=4, DELETE=8, UPDATE=16, TRUNCATE=32.
  -- ⛔ Each of the three is asserted SEPARATELY because each failure is
  -- different and all three are silent. AFTER instead of BEFORE: the assignment
  -- to NEW is discarded and the trigger does nothing at all. STATEMENT instead
  -- of ROW: NEW/OLD do not exist and the body aborts on every update of this
  -- table, i.e. the whole publish path. Not UPDATE: it never fires.
  IF (v_tgtype & 2) = 0 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger is not a BEFORE trigger. An AFTER trigger''s assignment to NEW is DISCARDED, so it would run on every update, report nothing, and enforce nothing -- a green migration over an invariant that does not exist';
  END IF;
  IF (v_tgtype & 1) = 0 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger is not FOR EACH ROW. A statement-level trigger has no NEW/OLD, so this body would abort on every UPDATE of strategy_analytics -- the entire publish path';
  END IF;
  IF (v_tgtype & 16) = 0 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger does not fire on UPDATE. UPDATE is the ONLY event it is about -- every stale-marker path in the header''s writer census is an UPDATE (or the ON CONFLICT arm of an upsert, which is one)';
  END IF;
  IF (v_tgtype & (4 | 8 | 32)) <> 0 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger was WIDENED beyond UPDATE. On INSERT there is no OLD tuple and this body aborts with `record "old" is not assigned yet`, taking every strategy_analytics INSERT with it; a DELETE arm would additionally need the sanitize_user erasure exemption (20260710160000:67). Narrow it back to BEFORE UPDATE';
  END IF;
  IF v_tgenabled <> 'O' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger exists but tgenabled is %, not ''O''. A DISABLED trigger satisfies every catalog presence test in this block while enforcing nothing', v_tgenabled;
  END IF;

  -- (P3c) The trigger FUNCTION's shape. SECURITY INVOKER (the body needs no
  -- privilege the firing statement lacks, and a needless definer-rights trigger
  -- on a cross-tenant table is a standing escalation surface), pinned
  -- search_path, and unreachable as a PostgREST RPC.
  SELECT p.prosecdef, array_to_string(p.proconfig, ',')
    INTO v_trg_secdef, v_trg_config
    FROM pg_proc p
   WHERE p.oid = 'public.strategy_analytics_drop_stale_error_provenance()'::regprocedure;
  IF v_trg_secdef THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics_drop_stale_error_provenance is SECURITY DEFINER. It touches only its own NEW/OLD tuples and needs no privilege the firing statement does not already hold; definer rights here add a bypass of RLS on a cross-tenant table for no gain';
  END IF;
  IF v_trg_config IS NULL OR v_trg_config NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: strategy_analytics_drop_stale_error_provenance has no pinned search_path (the 89-prior-migration convention, and 20260803120000''s shape)';
  END IF;
  IF has_function_privilege('anon', 'public.strategy_analytics_drop_stale_error_provenance()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.strategy_analytics_drop_stale_error_provenance()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: an API role can EXECUTE strategy_analytics_drop_stale_error_provenance -- the REVOKE did not take. A trigger function is never a legitimate PostgREST RPC (20260716131000:74)';
  END IF;

  v_fn_trg := pg_get_functiondef('public.strategy_analytics_drop_stale_error_provenance()'::regprocedure);

  -- (P3d-neg) NEGATIVE, AND IT SITS ABOVE THE POSITIVE ANCHOR DELIBERATELY --
  -- the same placement rule as (P2a-neg) above. THE INVERSION is the one edit
  -- that reads as a tidy-up and reverses the whole meaning: fire when the
  -- sentence is UNCHANGED, and the trigger strips the markers off the bridge's
  -- own KEEP arm on branches (b)/(b-prime) -- criterion 2 reverted by the very
  -- object added to protect it, with no other symptom. Placed below the positive
  -- anchor it could never be reached, because the inversion breaks that one too.
  -- ⚠️ The lookahead is load-bearing: without it this pattern also matches the
  -- two `computation_error_source` / `computation_error_job_id` conjuncts, which
  -- are CORRECTLY `IS NOT DISTINCT FROM`, and the arm would be RED on the fixed
  -- body -- a positive anchor that can never be satisfied, wearing a negative's
  -- clothes.
  IF v_fn_trg ~* 'NEW\.computation_error(?![_[:alnum:]])\s+IS\s+NOT\s+DISTINCT\s+FROM' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger''s sentence test is INVERTED (`NEW.computation_error IS NOT DISTINCT FROM OLD.computation_error`). That fires when the sentence is UNCHANGED, which is exactly the state in which branches (b) and (b-prime) KEEP a writer-curated sentence -- so the trigger would strip the markers off the one write that is entitled to them, and every curated sentence would fall to the per-kind generic on the following call. The sentence test must be IS DISTINCT FROM; the two marker tests must be IS NOT DISTINCT FROM';
  END IF;

  -- (P3e) The guard itself, keyed on the WHOLE three-conjunct condition. A
  -- fragment anchor is not available to be got wrong here (the body carries no
  -- comments, by design -- see STEP 3's header note), but the conjuncts are
  -- anchored together anyway because DROPPING ONE is the silent edit:
  --   * drop the sentence test  -> the markers are cleared on EVERY update that
  --     does not restate them, including the bridge's own keep arm.
  --   * drop either marker test -> the trigger fires on the bridge's and the
  --     writer's own marker-carrying writes and clears what they just set.
  IF v_fn_trg !~ 'IF\s+NEW\.computation_error\s+IS\s+DISTINCT\s+FROM\s+OLD\.computation_error\s+AND\s+NEW\.computation_error_source\s+IS\s+NOT\s+DISTINCT\s+FROM\s+OLD\.computation_error_source\s+AND\s+NEW\.computation_error_job_id\s+IS\s+NOT\s+DISTINCT\s+FROM\s+OLD\.computation_error_job_id\s+THEN' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger''s guard is not the expected three-conjunct condition (sentence CHANGED, and BOTH markers left exactly as they were). Dropping the sentence conjunct clears the markers on every update that does not restate them -- including the bridge''s own keep arm; dropping either marker conjunct makes the trigger fire on the writes that legitimately carry provenance and erase it in the same statement';
  END IF;

  -- (P3f) Both clears, asserted SEPARATELY. One survivor leaves a half-stamped
  -- row -- which the pairing CHECK of (P0d) then rejects with a 23514 raised
  -- from inside a BEFORE trigger, i.e. this defect would surface as an
  -- unexplained constraint violation on a live analytics write rather than as
  -- anything naming the trigger.
  IF v_fn_trg !~ 'NEW\.computation_error_source\s*:=\s*NULL' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger does not clear computation_error_source. A source marker left over a changed sentence is read by branches (b)/(b-prime) as a writer''s claim -- and half a marker also violates the pairing CHECK, so the symptom is a 23514 on the failure-write path';
  END IF;
  IF v_fn_trg !~ 'NEW\.computation_error_job_id\s*:=\s*NULL' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger does not clear computation_error_job_id. The id is the half that makes the bridge''s equality match, so leaving it is the half that actually causes the wrong sentence to be kept';
  END IF;

  -- (P3g) It COERCES, it does not RAISE. 20260803120000 records the reason for
  -- the neighbouring stamp trigger and it holds identically here: raising would
  -- kill a live analytics-service write mid-failure-report, burn its retries and
  -- strand the strategy -- turning a lost sentence into a lost failure record.
  IF v_fn_trg ~* 'RAISE\s+(EXCEPTION|WARNING)' THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the provenance trigger RAISEs. It must coerce silently toward the pre-164.2 behaviour: it fires on the analytics-service FAILURE-recording path, where an exception costs the whole failure record rather than just its provenance';
  END IF;

  -- ======================================================================
  -- CARRIED FORWARD from 20260826120000 -- CR-01 / JOB-01 / F-3 / PUB-02 /
  -- SI-02 / HONEST-01. Dropping any of these silently reverts a closed defect,
  -- and a re-base is the event that drops them.
  -- ======================================================================

  -- CR-01 (1): the protection predicate as ONE expression.
  IF v_fn !~ 'COALESCE\s*\(\s*\(\s*f\.metadata\s*->>\s*''source''\s*\)\s*IN\s*\(\s*''ledger-refresh''\s*,\s*''ledger-refresh-composite''\s*\)\s*AND\s+f\.kind\s+IN\s*\([^)]*\)\s*,\s*FALSE\s*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the is_protected marker predicate is not the expected two-valued, kind-scoped, f-keyed expression. Either the metadata->>''source'' test is gone or no longer read off the failing row (every permanent failure of an in-scope kind on a published strategy would then be silently protected), or one of the two markers is missing, or the COALESCE(..., FALSE) is gone (is_protected turns NULL for unmarked failures with NULL metadata, they fall out of BOTH FILTERs, and branch (c) publishes over a live permanent failure)';
  END IF;

  -- CR-01 (2): the health conjunct -- THE whole fail-safe.
  IF v_fn !~* '\)\s*AND\s+v_publish_healthy\s+AS\s+is_protected' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the protection predicate does not terminate in `AND v_publish_healthy AS is_protected` -- without that conjunct the exemption is granted on the marker alone, and it would launder a genuinely broken strategy into a published-looking one';
  END IF;
  IF v_fn ~* 'sa\.computation_warned' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the published-row health conjunct was widened with computation_warned; that marker survives a computing entry-write and a failed bounce, so the exemption would cover rows that are mid-computation or broken';
  END IF;
  IF v_fn !~ 'f\.kind\s+IN\s*\(' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the protection predicate is not kind-scoped -- metadata->>''source'' is shared with routers/process_key.py''s request-derived body.source, and only the kind scope keeps a process_key_long job out of the exemption';
  END IF;
  IF v_fn !~ 'f\.kind\s+IN\s*\([^)]*''derive_broker_dailies''[^)]*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped derive_broker_dailies -- that is the kind the single-key fan-out (20260825130000) enqueues, so the ENTIRE single-key refresh arm becomes unprotected and its next permanent failure un-publishes a funded account through this bridge';
  END IF;
  IF v_fn !~ 'f\.kind\s+IN\s*\([^)]*''compute_analytics_from_csv''[^)]*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped compute_analytics_from_csv -- that is the JOB_CHAIN_FOLLOW_ON hop the marker is forwarded onto, and it is the hop that compiles the factsheet, so CR-01 re-opens one hop later';
  END IF;
  IF v_fn !~ 'f\.kind\s+IN\s*\([^)]*''stitch_composite''[^)]*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped stitch_composite -- that is the kind the composite fan-out (20260825140000) enqueues, so the ENTIRE composite refresh arm becomes unprotected and its next permanent failure un-publishes a live composite through this bridge';
  END IF;

  -- CR-01 (idempotence): branch (a) consults the hold, anchored on the WHOLE IF.
  IF v_fn !~* 'IF\s+v_nonterminal_count\s*>\s*0\s+AND\s+NOT\s+v_protect_hold\s+THEN' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (a)''s guard does not consult v_protect_hold -- a sibling job bounces a protected row to computing and the NEXT bridge call poisons the row this migration already protected. (Anchored on the whole IF statement on purpose: the bare conjunct is quoted by this function''s own comments, so a fragment anchor stayed green over the deleted fix.)';
  END IF;

  -- CR-01 FOLLOW-UP: the hold is SCOPED, not per-strategy.
  IF v_fn !~* '\)\s*AS\s+has_live_successor' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the branch-(a) hold is not scoped by has_live_successor -- one live protected failure would stand branch (a) down for EVERY later bridge call on the strategy, so an in-flight user-initiated resync reads as a terminal success to src/hooks/useStrategySyncPoller.ts and SyncPreviewStep materialises the pre-resync factsheet';
  END IF;
  IF v_fn !~* 'COALESCE\s*\(\s*v_unresolved_count\s*,\s*0\s*\)\s*>\s*0' THEN
    RAISE EXCEPTION 'CR-01 verification failed: v_protect_hold does not consult the unresolved-protected count with a NO-HOLD NULL default. Either the scope conjunct was dropped (the hold is per-strategy again) or its COALESCE default was changed so an unknown counter resolves toward SUPPRESSION -- branch (a) would stand down on an unknown state and branch (c) would report an unfinished computation as a completed one';
  END IF;
  IF v_fn !~* 'r\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the has_live_successor predicate is not scoped to the failure''s own kind. Any unrelated in-flight job would then release the branch-(a) hold, bounce the published row to computing and leave the protected failure unprotected on the next all-terminal call -- a cron-enqueued sync_trades poll would take a funded account dark in three bridge calls';
  END IF;
  IF v_fn !~* 'AND\s+NOT\s+COALESCE\s*\(\s*\(\s*r\.metadata\s*->>\s*''source''\s*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the has_live_successor predicate does not exclude MARKED successors. The recurring refresh arm re-attempting against a still-wedged venue would then release the branch-(a) hold, bounce the published row to computing, fail again and take branch (b) -- CR-01 reopened by its own retry';
  END IF;
  IF (SELECT count(DISTINCT m[1])
        FROM regexp_matches(v_fn, '(\(\s*''ledger-refresh''[^)]*\))', 'g') AS m) <> 1 THEN
    RAISE EXCEPTION 'CR-01 verification failed: the recurring-refresh marker list is spelled more than one way in the deployed body. The protection predicate and the has_live_successor predicate must admit the SAME two markers; a drift between them either unprotects an arm or lets its own retry release the branch-(a) hold, and both are silent';
  END IF;

  -- CR-01 (hoist): the health read precedes EVERY write this function performs.
  IF position('INTO v_publish_healthy' IN v_fn) = 0
     OR position('INSERT INTO strategy_analytics' IN v_fn) = 0
     OR position('INTO v_publish_healthy' IN v_fn)
        > position('INSERT INTO strategy_analytics' IN v_fn) THEN
    RAISE EXCEPTION 'CR-01 verification failed: the published-row health read is not hoisted above branch (a). Read after it, the protection is re-derived from a column this function transiently overwrites, and v_protect_hold would be computed from a status branch (a) had already replaced';
  END IF;

  -- READ ORDER (HIGH, data integrity): inclusive count BEFORE the partition.
  IF position('INTO v_nonterminal_count' IN v_fn) = 0
     OR position('INTO v_failed_count' IN v_fn) = 0
     OR position('INTO v_nonterminal_count' IN v_fn)
        > position('INTO v_failed_count' IN v_fn) THEN
    RAISE EXCEPTION 'CR-01 verification failed: the two compute_jobs reads are in the WRONG ORDER -- the failed_final partition is evaluated before the non-terminal count. At READ COMMITTED, with no per-strategy advisory lock in mark_compute_job_done/failed, a job committing running -> failed_final between the two reads is then invisible to BOTH: branch (a) sees no in-flight job, branches (b)/(b-prime) see no failure, and branch (c) publishes computation_status = complete with computed_at = now() over a live non-superseded permanent failure';
  END IF;

  -- CR-01: branch (b-prime) exists and its guard gates the UPDATE.
  IF v_fn !~* 'IF\s+v_protected_count\s*>\s*0\s+THEN\s+UPDATE\s+strategy_analytics\s+(--[^\n]*\n\s*)*SET\s+computation_error' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) is missing or its guard no longer gates the UPDATE; protected failures would fall through to branch (c), which clears computation_error and stamps computed_at = now() on a FAILED refresh';
  END IF;

  -- CR-01 NEGATIVE anchors on branch (b-prime): it must write NO publish column.
  -- ⛔ BOTH RE-ANCHORED. They were keyed on
  -- `SET computation_error = computation_error_copy(v_protected_kind` -- a prefix
  -- this migration's CASE no longer contains, which would have made them
  -- negative anchors that CANNOT FIRE: silently dead, reading as coverage.
  -- 20260826120000:1218-1223 asked the next author to come back here on exactly
  -- the third edit to this SET expression. Re-keyed on `SET computation_error =
  -- CASE`, which occurs ONLY in branch (b-prime) (branches (a) and (c) open
  -- their SET lists with computation_status), and still bounded by b-prime's own
  -- WHERE clause rather than by a `;` -- a semicolon inside a comment in this
  -- very UPDATE is what made an earlier form of these two vacuous.
  IF v_fn ~* 'SET\s+computation_error\s*=\s*CASE(?:(?!WHERE\s+strategy_id)(?:.|\n))*?computation_status\s*=' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) writes computation_status; a protected refresh failure must leave the publish state untouched';
  END IF;
  IF v_fn ~* 'SET\s+computation_error\s*=\s*CASE(?:(?!WHERE\s+strategy_id)(?:.|\n))*?computed_at\s*=\s*now\(\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) stamps computed_at = now(); a FAILED refresh must never read as freshly computed';
  END IF;

  -- JOB-01 (mig 20260802120000).
  IF v_fn !~* 'computing_started_at\s*=\s*CASE' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (a) lost the conditional computing_started_at CASE (JOB-01, mig 20260802120000 -- the reaper would never fire)';
  END IF;
  IF v_fn !~* 'computation_status\s+IS\s+DISTINCT\s+FROM\s+''computing''' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (a) lost the transition-in arm of the JOB-01 stamp CASE';
  END IF;

  -- F-3 / PUB-02 (mig 20260710150000): per-kind, created_at-keyed supersession.
  IF v_fn !~* 'FROM\s+compute_jobs\s+d\s+WHERE\s+d\.strategy_id\s*=\s*f\.strategy_id\s+AND\s+d\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (b) lost the per-kind supersession scope (d.kind = f.kind missing from the supersession subquery -- F-3/PUB-02 reverted, and a later done of a DIFFERENT kind would mask a real permanent failure)';
  END IF;
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (b) lost the immutable created_at supersession key (F-3/PUB-02 reverted)';
  END IF;

  -- SI-02 (mig 20260708120000): a COUNT, not a presence test.
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'OR\s+strategy_analytics\.computation_warned', 'g')) <> 3 THEN
    RAISE EXCEPTION 'CR-01 re-base failed: the runner-owned computation_warned marker read must appear in EXACTLY the three places 20260802120000 put it -- branch (a)''s status CASE, branch (a)''s computing_started_at CASE, and branch (c)''s status CASE. Losing branch (a)''s status arm launders the warning into a plain ''computing''; losing branch (a)''s stamp arm leaves computing_started_at set on a row that is NOT computing, so the 16-hour reaper fires on a healthy warned row; losing branch (c)''s arm re-opens the SI-02 failed_final-bounce launder (mig 20260708120000). A presence test cannot tell these apart -- any one survivor satisfies it';
  END IF;

  -- HONEST-01 (H1): THE ABSOLUTE ONE. Carried forward verbatim.
  -- ⚠️ DO NOT "improve" the function body by explaining, in a comment there, why
  -- the bridge no longer reads the operator column. That comment IS the
  -- regression this anchor detects, and it will RAISE on apply. Write it in the
  -- file header, which pg_get_functiondef does not return.
  IF v_fn ~* 'last_error' THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: sync_strategy_analytics_status references compute_jobs.last_error. That column is the OPERATOR surface (raw classify_exception output) and this function writes strategy_analytics.computation_error, which renders verbatim to users in the wizard failure envelope and the portfolio stale warning. Derive the copy from error_kind via computation_error_copy(). If this fired on a COMMENT rather than on code, the comment is still the defect: move the prose to the migration file header, which pg_get_functiondef does not return';
  END IF;

  -- HONEST-01 (H2): branch (b)'s VALUES arm still writes the per-kind generic.
  -- ⚠️ This one is UNCHANGED by criterion 2 and that is deliberate: a FRESH row
  -- has no earlier writer sentence to preserve, so the conditional belongs on
  -- the DO UPDATE arm only. If this ever became a CASE too, it would be
  -- preferring a value that does not exist.
  IF v_fn !~* 'VALUES\s*\(\s*p_strategy_id\s*,\s*''failed''\s*,\s*computation_error_copy\s*\(\s*v_latest_kind\s*\)' THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: branch (b) does not write computation_error_copy(v_latest_kind) into the failed-status upsert''s VALUES arm. This is the branch every user-initiated permanent failure takes on a row that does not yet exist, so whatever it writes is what SyncPreviewStep renders';
  END IF;

  -- HONEST-01 (H4): TOTALITY of the copy function, asserted BEHAVIOURALLY.
  -- Criterion 2 inherits this dependency rather than removing it: branch
  -- (b-prime)'s ELSE arm still assigns computation_error_copy(v_protected_kind)
  -- unconditionally, so a NULL return would blank the column over a live
  -- protected failure. computation_error_copy is NOT redefined by this
  -- migration (see the header, delta 6) -- this asserts the object it depends on
  -- is intact on the database it is being applied to, which is not the same
  -- claim as "20260826120000 defined it correctly".
  IF computation_error_copy(NULL) IS NULL THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: computation_error_copy(NULL) is NULL on this database. Branch (b-prime)''s ELSE arm assigns this value unconditionally, so a NULL here silently blanks computation_error over a live protected failure. ⛔ Do NOT "fix" this by putting b-prime''s retired COALESCE back: its left arm was the operator column and always won, so it never guarded this';
  END IF;

  RAISE NOTICE 'Migration 20260906120000: strategy_analytics.computation_error PROVENANCE applied and sync_strategy_analytics_status re-based (criterion 2 -- both markers present, nullable and constrained TWICE: the domain CHECK on the source and the pairing CHECK that makes a half-stamp a 23514 at the writer instead of a silent generic at the reader; the live-failure aggregate orders all FOUR picks totally (created_at DESC, id DESC) so the kind and the id name the SAME failure under a tie; branches (b)/(b-prime) keep a writer sentence only for the job they resolved and clear the markers otherwise; branches (a)/(c) clear both; and the BEFORE UPDATE trigger strategy_analytics_drop_stale_error_provenance_trigger moves the "a marker never outlives its sentence" invariant from this file''s prose to the TABLE, so the six repo-wide writers that change the sentence without restating provenance are correct without being edited; COMMENT ON FUNCTION survived CREATE OR REPLACE (A1 MEASURED); CR-01, JOB-01, F-3/PUB-02, SI-02 and HONEST-01 anchors carried forward, two of them re-anchored).';
END $verify$;

COMMIT;
