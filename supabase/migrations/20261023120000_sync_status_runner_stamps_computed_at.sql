-- ==========================================================================
-- Phase 166.5 (COMPUTEDATSTAMP): strategy_analytics.computed_at means "when
-- these metrics were really computed", and the analytics runner is the only
-- writer of it.
--
-- WHAT THIS FIXES
-- ---------------
-- The status bridge `public.sync_strategy_analytics_status` was, until this
-- file, the only writer of strategy_analytics.computed_at, and it assigned the
-- column on branches that are not a recompute:
--   * branch (a), on a successful side-kind job with a sibling in flight (the
--     ELSE arm), and on the writer-provenance membership arm;
--   * branch (b), on a FAILURE;
--   * branch (c), whenever every job was done, even when only side jobs
--     (funding sync, position poll, reconcile, intro snapshot) had run since
--     the last real compute.
-- Freshness is read from that column (the factsheet FreshnessChip, the
-- factsheet cache key, the tearsheet badge, the PDF ETag), so a nightly side
-- job made stale analytics read as freshly updated. That is the failure the
-- founder named for this phase.
--
-- THE RULE
-- --------
-- D-01. The analytics runner stamps the column, in the same write that stores
--       the metrics (phase 166.5 plan 01: the CSV path and the composite path
--       send the database-clock literal `now` on their success payloads).
-- D-03. The bridge writes the column on NO branch: (a), (a)'s membership arm,
--       (b) and (c) lose the assignment. Every status, sentence and marker rule
--       the bridge had is kept as it was, with the one exception below. This
--       CORRECTS the header sentence of 20261009120000, which called the bridge
--       the only writer of the column: the analytics runner is, and the bridge is
--       the only thing that must not be.
--       The exception: a SUCCESSFUL side-kind job that finishes while a sibling
--       side job is still in flight no longer reaches branch (a). Branch (a) moved
--       the row to `computing` and blanked a held failure sentence over work no
--       analytic depended on. The early return ahead of branch (a) now keys on a
--       side-kind trigger of any outcome (see E5 below).
-- D-04. A failed recompute leaves the date at the last good compute. The failure
--       shows through computation_status and its sentence, never by moving the
--       date. This retires the 164.5.2.1 "hold the date" arms and the 164.6.6.3.4
--       D-09 hold as DATE mechanisms (nothing else writes the date any more);
--       their status and sentence rules stay.
-- D-08. A successful side-kind job never moves a `failed` row to `complete`; only
--       a real recompute (a runner finish) can. Branch (c)'s status hold keeps
--       its existing predicate (R-05): `failed` AND a failure sentence present.
--       It now applies to a side-kind trigger of ANY outcome. A `failed` row with
--       NO sentence (the Eclipse shape, 164.6.6.3.4 scope arm S1) still resolves
--       to `complete` under a side trigger: that row is `failed` only because
--       excluded side kinds once failed it, and resolving it corrects a false
--       failure rather than hiding a real one. Every real analytics failure
--       writes a sentence, and D-08 protects exactly those. Gate arm N9.
-- R-06. The same flag stops a successful last-in-flight side job from INSERTING a
--       first `complete` row for a strategy that has none (it used to insert one
--       with the column default date, fresh-looking analytics from a job that
--       computed nothing). The existing row guard of branch (c) now keys on the
--       trigger flag in every outcome.
-- R-03. The D-09 release clause (a counting job `done` after the row's date
--       releases the side-failure hold) is DELETED. With the runner stamping
--       first, "updated_at is later than computed_at" holds after every normal
--       compute and would defeat the hold; with no bridge write to hold, the
--       clause has nothing left to release.
--       WHY THE EQUAL-BOUNDARY ARM D-06 ASKED FOR IS MOOT. D-06 asked for an arm
--       at the boundary where a counting job's updated_at equals the row's date.
--       No comparison remains, so there is no boundary to test. D-06's own
--       alternative is what this phase pins instead: a side-only finish never
--       moves the date. N5 covers a side job that is the last in flight, done and
--       failed_final; N6 covers a side failure after a counting `done` on a warned
--       row (it replaces scope arm D15, which asserted the opposite under the
--       deleted clause).
-- IN-R4-02 (cross-transaction clock comparison) is moot: the bridge neither reads
--       nor compares the column, so no comparison between the runner's
--       transaction and the bridge's remains.
-- IN-R4-03 (a Python call after a rollback of the 2-arg bridge answers 42883) is
--       RECORDED ONLY. The signature is unchanged, so the Python two-argument call
--       stays valid against this body.
--
-- HOW IT IS BUILT
-- ---------------
-- One `CREATE OR REPLACE FUNCTION` with the UNCHANGED signature
-- (uuid, uuid DEFAULT NULL), re-based byte for byte on its latest definition,
-- 20261009120000_sync_status_analytics_scope.sql, with these deletions: the
-- date assignment of branch (a) (and the membership arm inside it), of branch
-- (b) and of branch (c), the release clause, and one flag change (E5): the
-- failed-only flag and the not-done flag collapse into ONE side-kind trigger flag,
-- `v_side_trigger`. The oid, the ACL and the
-- load-bearing function COMMENT (arms 0a/0b of
-- test_sync_status_marked_refresh_protected.sql key on it) survive, which is why
-- there is no DROP, no COMMENT ON FUNCTION and no re-create of either mark RPC.
-- The REVOKE and GRANT are re-issued as proof.
--
-- The closing DO block carries the 20261009120000 anchors, re-keyed:
--   * the writer-provenance membership predicate is counted 7 times, not 8 (one
--     site lived in the deleted branch-(a) date CASE);
--   * branch (a) carries 3 hold CASEs, not 4 (sentence and the two markers);
--   * the side-kind constant is read at 3 sites, not 5 (the release clause read
--     it, and the two flag assignments became one), and the release anchor is
--     deleted;
--   * the two flag anchors (failed-only, not-done) become one, `v_side_trigger_ok`,
--     and the early-return, status-hold, row-guard and marker-clear anchors are
--     re-keyed on it;
--   * branch (c)'s hold anchor now pins the sentence CASE only;
--   * a NEW anchor refuses the apply if the comment-stripped body names the
--     date column at all.
--
-- BACKWARDS COMPATIBILITY
-- -----------------------
-- A first-ever strategy_analytics row inserted by the bridge still takes the
-- column default (the column is NOT NULL DEFAULT now()): an INSERT that does not
-- name the column cannot carry a prior value to hold, and the runner's own
-- success write replaces it. Recorded as a known limit (R-04).
-- The 166.3.1 trigger (20261013120000) still holds the date on any `failed` or
-- `computing` write; it stays as defence in depth, no longer as the only guard
-- for the bridge.
--
-- WHAT THIS DELIBERATELY DOES NOT FIX
-- -----------------------------------
-- * A first-ever strategy_analytics row inserted by the bridge (a counting job in
--   flight for a strategy with no row) still takes the column default date (R-04).
-- * A counting job's own mark with only a side job still in flight runs branch (a)
--   (its trigger is a counting kind, so the early return does not apply) and moves a
--   plain complete row to `computing` until the side job finishes. That is the
--   pre-phase behaviour and not a date write; the runner's stamp is untouched.
-- * IN-R4-03 (a Python call after a rollback of the 2-arg bridge answers
--   42883) is recorded, not fixed (CONTEXT, deferred).
-- * portfolio_analytics.computed_at (the portfolio PDF vintage) is untouched.
-- * A row whose date was inflated BEFORE this ships keeps it until the forced
--   recompute of the consolidated PROD recompute (D-05), which this migration
--   does not run.
-- THREE COMMENTS CORRECTED
-- ------------------------
-- The comment on strategy_analytics.computing_started_at said the status bridge
-- re-stamps the date on every job transition; 166.3.1's trigger-function comment
-- and trigger comment named this phase as the owner of a residue it closes. A
-- guarded block after the REVOKE/GRANT pair re-issues each with only the stale
-- clause replaced. Each re-issue runs only when the object exists and still carries
-- the clause, and says so with a NOTICE otherwise, so a database without the 166.3.1
-- objects applies cleanly.
-- (Plan 05 appends the VAC-04 body acknowledgement and the snapshot source line;
-- the rollback pointer is plan 08's.)
--
-- ==========================================================================
-- VAC-04 ACKNOWLEDGEMENT -- the PROD body this CREATE OR REPLACE overwrites
-- ==========================================================================
-- The gate compares the COMMITTED SNAPSHOT (supabase/schema/functions/) against
-- PROD's live body. On a function-changing migration PR the two necessarily
-- disagree: the snapshot must carry the body the MIGRATIONS produce (the new
-- one), while VAC-04 requires it to match what PROD has TODAY. The pragma means
-- "I read PROD's body and intend to overwrite it". This migration changes ONE
-- function, so it carries ONE pragma. The two mark RPCs are not re-created here.
--
-- MEASURED 2026-10-15 UTC, reproduced LOCALLY with the gate's own normalizer,
-- aiming its `live` argument at origin/main's snapshot rather than at PROD
-- (origin/main = dff342b2788d101190b7bc5e86fbf36b824919a2, the sha this branch
-- was cut from; its snapshot of this function was last written for the
-- 20261009120000 body):
--
--   git show origin/main:supabase/schema/functions/sync_strategy_analytics_status.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/sync_strategy_analytics_status.sql <scratch>
--
-- The row reads DRIFT, nargs 2, 43 differing hunks (the removed date writes, the
-- removed release clause, the single side-trigger flag and its holds).
--
-- THE ACKED HASH IS THE `live` COLUMN OF --diff-bodies FOR THE DRIFT ROW (the
-- fifth tab-separated field), NOT `--hash` OF THE SNAPSHOT FILE (a whole-file
-- digest no gate ever greps).
--
-- sync_strategy_analytics_status (2 args), the DRIFT row's `live` column:
-- prod-body-ack: fa9dd2f628fda2982f932557380f9702e6b0d46aba62fd35872fd3707db05950
--
-- THE ACK IS OF origin/main, WHICH STANDS IN FOR PROD. It is EARNED only if
-- VAC-04 on the PR reports that SAME hash for PROD. If it reports a different
-- one, PROD drifted OUT OF BAND and the correct action is to FOLD the
-- difference into this migration and re-derive, never to edit the pragma to
-- match a gate log. It is EARNED, not pasted.
-- EXPECTED RED until merge: VAC-08 (repo-vs-TEST body pairing, in
-- `test-db-drift`) carries one DRIFT row for this function until apply-on-merge
-- brings TEST forward, and `baseline-content-drift` carries the same row until
-- the post-apply re-dump of supabase/schema/baseline.sql. Neither is allowlisted.
--
-- VERIFY SCOPE. The DO block at the foot reads the catalogue and the function
-- body only (pg_get_functiondef and friends). It never selects from compute_jobs
-- or strategy_analytics, so it cannot refuse on the schema-only shared TEST
-- database ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Its anchors run on the
-- comment-stripped body, so this header can never satisfy one.
--
-- No explicit BEGIN/COMMIT: Supabase wraps each migration in one implicit
-- transaction.
-- ==========================================================================

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- the bridge, re-based on 20261009120000 with the date writes and the release
-- clause removed
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_strategy_analytics_status(
  p_strategy_id    UUID,
  p_trigger_job_id UUID DEFAULT NULL
)
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
  v_unprotected_job_ids UUID[];
  v_nonterminal_unmarked_count INTEGER;
  v_refresh_keep       BOOLEAN;
  -- D-09 (founder 2026-10-07), keyed on the TRIGGER, widened by Phase 166.5 (D-03,
  -- D-08): TRUE when the job whose transition caused THIS call is a side-kind job of
  -- this strategy, whatever its outcome (done, failed, or deferred back to pending).
  -- One flag keys the early return ahead of branch (a) and every hold in branch (c).
  v_side_trigger       BOOLEAN;
  v_nonterminal_counting_count INTEGER;
  -- D-05, the closed side-kind list, spelled ONCE. Every use below reads this
  -- constant (the live_failures CTE, the trigger test, the in-flight count), so
  -- the list cannot drift between them, and the verify block asserts it is the
  -- four kinds D-05 names and that no other spelling of it exists.
  v_side_kinds         CONSTANT TEXT[] := ARRAY['sync_funding', 'poll_positions', 'reconcile_strategy', 'compute_intro_snapshot'];
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'sync_strategy_analytics_status: p_strategy_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(p_strategy_id::text));

  -- (d) no rows → preserve existing strategy_analytics row (unchanged).
  SELECT count(*) INTO v_job_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id;

  IF v_job_count = 0 THEN
    RETURN;
  END IF;

  -- ---- the NON-TERMINAL counts — FIRST of this function's two compute_jobs --
  -- ---- reads, and the ORDER IS THE CORRECTNESS ------------------------------
  -- One statement, one snapshot, three counts: every in-flight job, the in-flight
  -- jobs that do NOT carry an in-scope refresh marker (the second feeds the keep
  -- flag; see RETRY-PLAIN-COMPLETE in the file header), and the in-flight jobs
  -- that are NOT side kinds (the third feeds the D-09 early return below).
  -- Consumed by branch (a) far below. They are read HERE, and that placement is a
  -- data-integrity fix (161.1 migration re-review, HIGH), not tidiness.
  --
  -- ⛔ WHY THE ORDER OF THE TWO compute_jobs READS IS LOAD-BEARING
  -- This function reads compute_jobs twice for its verdict: the INCLUSIVE
  -- non-terminal set (here) and the non-superseded failed_final partition (the
  -- live_failures CTE below). Nothing runs them atomically. There is no
  -- isolation override anywhere in this repo, so this executes at READ
  -- COMMITTED, where every statement takes its OWN fresh snapshot and a
  -- concurrent transaction can commit a job's status flip BETWEEN them.
  --
  -- The CALLERS of this function are serialized per strategy (Phase 164.5.2
  -- for the two terminal mark RPCs, Phase 164.5.2.1 for this function itself).
  -- Both mark RPCs take the two-integer, transaction-scoped advisory lock in the
  -- mark_compute_job_bridge namespace, keyed on the strategy, before they call
  -- this function, and this function takes that same lock as its first
  -- statement after the NULL guard. A mark RPC re-enters the lock it already
  -- holds; a direct caller (the Python DEFERRED path) waits behind any mark or
  -- direct call in progress on the same strategy. So no other caller can COMMIT
  -- a job transition on this strategy while this function is between its reads.
  -- The NON-caller writers are NOT serialized: the claim RPCs,
  -- reset_stalled_compute_jobs, the orphan terminalizer, the enqueue inserts,
  -- the cross-strategy fan-in release and the refresh-marker retraction never
  -- call this function and take no such lock. A job's status can therefore
  -- still change between the two reads, and the read order below stays
  -- load-bearing.
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
  -- writes computation_status = 'complete' and computation_error = NULL
  -- OVER A LIVE NON-SUPERSEDED PERMANENT FAILURE. That is a
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
  -- that does neither. The callers' per-strategy lock (above) narrows the
  -- window to the NON-caller writers named there. Closing it fully would need
  -- those writers to take the same lock; they are other phases' functions (the
  -- claim RPCs belong to Phase 164.9.3), so that is not attempted here.
  SELECT count(*),
         count(*) FILTER (WHERE NOT COALESCE(
           (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
           AND kind IN ('derive_broker_dailies',
                        'compute_analytics_from_csv',
                        'stitch_composite'),
           FALSE)),
         count(*) FILTER (WHERE NOT COALESCE(kind = ANY (v_side_kinds), FALSE))
    INTO v_nonterminal_count, v_nonterminal_unmarked_count, v_nonterminal_counting_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

  -- ---- D-09 / D-03 / D-08: did a SIDE-KIND job cause this call? -------------
  -- The decision is keyed on the job that TRIGGERED the call, never on recency.
  -- The mark RPCs pass the job they just terminalised and the Python DEFERRED
  -- path the job it just deferred; every other caller (a status re-sync) passes
  -- NULL and gets today's behaviour. TRUE for a side-kind job of THIS strategy in
  -- ANY outcome (done, failed_retry, failed_final, a deferral back to pending): a
  -- counting job in any state, a NULL id and a job of another strategy all read
  -- FALSE. A side job computes nothing, so a call it causes has nothing to say
  -- about a stored analytic: it never blanks a sentence while a sibling side job
  -- is in flight (D-03's exception) and never heals a `failed` row that carries a
  -- sentence when it is the last job in flight (D-08). (A recency key, "the
  -- latest-created terminal job is a failed_final", held a failed row's sentence
  -- after a genuine counting success whenever a side job created later had failed
  -- fast; Phase 166.5 R-03 also deleted the release clause that stood here, "no
  -- COUNTING job reached done after the row's date": the analytics runner stamps
  -- the date in the same write as the metrics, so the bridge has no date to hold
  -- or release.)
  v_side_trigger := COALESCE((SELECT t.kind = ANY (v_side_kinds)
                                FROM compute_jobs t
                               WHERE t.id = p_trigger_job_id
                                 AND t.strategy_id = p_strategy_id), FALSE);

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
       AND NOT COALESCE(f.kind = ANY (v_side_kinds), FALSE)
       AND NOT (
         f.kind = 'process_key_long'
         AND EXISTS (
           SELECT 1
             FROM compute_jobs c1
            WHERE c1.strategy_id = f.strategy_id
              AND c1.kind = 'derive_broker_dailies'
              AND c1.status = 'done'
              AND c1.created_at > f.created_at
         )
         AND EXISTS (
           SELECT 1
             FROM compute_jobs c2
            WHERE c2.strategy_id = f.strategy_id
              AND c2.kind = 'compute_analytics_from_csv'
              AND c2.status = 'done'
              AND c2.created_at > f.created_at
         )
       )
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
       FILTER (WHERE is_protected))[1],
    array_agg(id) FILTER (WHERE NOT is_protected)
    INTO v_failed_count, v_protected_count, v_unresolved_count,
         v_latest_kind, v_protected_kind,
         v_latest_job_id, v_protected_job_id, v_unprotected_job_ids
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

  v_refresh_keep := v_publish_healthy
                    AND COALESCE(v_nonterminal_unmarked_count, 1) = 0
                    AND COALESCE(v_failed_count, 1) = 0;

  -- (a-hold) D-09 / D-03: a side-kind job FAILED, SUCCEEDED or was DEFERRED
  -- (WR-R3-01), and nothing that counts is in flight.
  -- A transient side failure (a sync_funding timeout is the founder's example)
  -- retries through failed_retry, and each retry mark reaches branch (a), which
  -- blanks the sentence while the side job is
  -- merely in flight. A side job that finished DONE while a sibling side job is
  -- still in flight is the same shape (Phase 166.5 D-03's exception): without this
  -- its success moved the row to `computing` and blanked the sentence. A deferred
  -- side job (the Python DEFERRED path, which now
  -- passes its job id) is in flight in the same way. Nothing that produces analytics is running, so the call has
  -- nothing to say about a stored analytic: it leaves the row exactly as it is,
  -- computation_status, the sentence and both markers included, and
  -- writes no row when none exists. The terminal hop (failed_final) reaches
  -- branch (c) with nothing in flight and holds there. When a counting job IS in
  -- flight, branch (a) below runs as it always did, because that job, not the
  -- side failure, is why the row moves.
  IF v_side_trigger
     AND COALESCE(v_nonterminal_count, 0) > 0
     AND COALESCE(v_nonterminal_counting_count, 1) = 0 THEN
    RETURN;
  END IF;

  -- (a) any non-terminal row → 'computing', UNLESS the runner has already
  -- written 'complete_with_warnings' OR set its runner-owned computation_warned
  -- marker. That warning is a runner-owned terminal sub-state the compute_jobs
  -- aggregate cannot see; this branch fires whenever ANY sibling job for the
  -- strategy is still in flight (e.g. a poll_positions / sync_funding job claimed
  -- in the same batch as the warned analytics job, or a pre-mark bridge call while
  -- this job's own row is still 'running'). Writing a bare 'computing' here would
  -- launder the warning, which branch (c) would then resolve to a plain 'complete'
  -- — ordering-dependent, so it leaked on multi-job (live-API) strategies.
  -- Preserve it. The analytics runner clears the warning, via its own
  -- 'computing' entry-write + clean terminal write when it actually recomputes.
  -- The bridge clears it in ONE case only, the membership arm FIRST in each
  -- CASE below (D-04b, the file header): when the row's writer-provenance job
  -- is among this call's unprotected live failures, the warning sits over a
  -- failed run and is not a warning to preserve. A plain 'complete' row is
  -- kept the same way by the refresh keep arm (D-05) when every in-flight job
  -- carries an in-scope refresh marker (in any non-terminal status, not only
  -- a retry) and no unprotected failure is live.
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
  --        branch (c) — error cleared.
  --   I4 — the scope does not admit a MARKED successor. The recurring arm
  --        retrying against a still-wedged venue must NOT release the hold.
  IF v_nonterminal_count > 0 AND NOT v_protect_hold THEN
    -- JOB-01 (Phase 142): a FRESH INSERT at 'computing' IS the transition in, so
    -- the VALUES arm stamps now() unconditionally. The ON CONFLICT arm must NOT.
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id)
    VALUES (p_strategy_id, 'computing', NULL, now(), NULL, NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = CASE
             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)
             THEN 'computing'
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN 'complete_with_warnings'
             WHEN v_refresh_keep AND strategy_analytics.computation_status = 'complete'
             THEN 'complete'
             ELSE 'computing'
           END,
           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,
           -- FOUNDER DECISION 2026-10-03 ("Hold the date for both"): on a KEEP
           -- (the row already reads what this branch resolves it to, and the
           -- membership arm does not fire) the sentence and both provenance markers
           -- are HELD, because nothing was computed. On every other path they are
           -- written exactly as before. The three CASEs share one predicate, so the
           -- markers still travel with the sentence. The date is not written here at
           -- all (Phase 166.5 D-03): the analytics runner is its only writer.
           computation_error = CASE
             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)
             THEN EXCLUDED.computation_error
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)
             THEN strategy_analytics.computation_error
             ELSE EXCLUDED.computation_error
           END,
           -- Phase 164.2 / criterion 2: when the sentence above is blanked, the
           -- provenance that described it goes with it. A marker left standing
           -- over a blanked sentence would make the NEXT generic write look like
           -- a curated one and freeze it there. This branch is also the reason
           -- the four TypeScript pre-enqueue writers need no marker at all: they
           -- always write 'failed', so a job starting on their row is a
           -- TRANSITION (never a keep), their sentence is stale by construction
           -- and superseding it is the correct outcome. A held sentence keeps
           -- its markers on the same predicate.
           computation_error_source = CASE
             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)
             THEN NULL
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)
             THEN strategy_analytics.computation_error_source
             ELSE NULL
           END,
           computation_error_job_id = CASE
             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)
             THEN NULL
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)
             THEN strategy_analytics.computation_error_job_id
             ELSE NULL
           END,
           -- JOB-01 (Phase 142): stamp on the TRANSITION INTO computing only,
           -- keyed off the RESOLVED status above — never off the branch. This
           -- bridge is PERFORMed in-RPC on EVERY job transition, so an
           -- unconditional now() here would reset the stamp on every hop of a
           -- multi-hop chain and the reaper would never fire (the Phase 106
           -- janitor bug, re-implemented in a new column).
           computing_started_at = CASE
             -- Membership arm (D-04b): the row is resolving to 'computing' over
             -- a failed run. Stamp the transition in, keep an existing stamp.
             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)
             THEN CASE WHEN strategy_analytics.computation_status IS DISTINCT FROM 'computing' THEN now() ELSE strategy_analytics.computing_started_at END
             -- Arm 1: this branch RESOLVED to complete_with_warnings, i.e. the
             -- row is NOT computing. That is an exit — clear the stamp.
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN NULL
             -- Refresh keep arm (D-05): the row stays 'complete', i.e. NOT
             -- computing. Same exit as Arm 1 — no stamp.
             WHEN v_refresh_keep AND strategy_analytics.computation_status = 'complete'
             THEN NULL
             -- Arm 2: resolved to 'computing' from some OTHER prior status —
             -- a genuine transition in. Stamp it.
             WHEN strategy_analytics.computation_status IS DISTINCT FROM 'computing'
             THEN now()
             -- Arm 3: already 'computing' — KEEP the original stamp, so a second
             -- bridge call cannot advance it and defer the reap indefinitely.
             ELSE strategy_analytics.computing_started_at
           END;
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
  -- This write clears computation_warned in ONE case only: when the row's
  -- writer-provenance job is among this call's unprotected live failures
  -- (D-04b, the file header), because the warning then sits over a failed run.
  -- Otherwise the runner-owned marker survives the 'failed' bounce in its own
  -- column, so branch (c) can recover the warning after a sibling
  -- failed_final→done recovery WITHOUT an analytics re-run (SI-02, closed by
  -- mig 20260708120000); a sibling's failure carries no provenance for its id.
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
           computation_warned = CASE WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids) THEN FALSE ELSE strategy_analytics.computation_warned END,
           computing_started_at = NULL;
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
  -- and resolve the status to complete, i.e. report a FAILED refresh as a
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

  -- D-09 (Phase 164.6.6.3.4) widened by Phase 166.5 (D-03, D-08), branch (c) when
  -- v_side_trigger is TRUE: this call was caused by a side-kind job of this strategy
  -- (finished done, failed, or deferred), no counting failure is live and nothing is
  -- in flight. Nothing was computed and the bridge wrote none of the sentence, so the
  -- branch HOLDS computation_error and both provenance markers; it still clears
  -- computing_started_at and still resolves computing to complete (or
  -- complete_with_warnings for a warned row). It writes no freshness date on ANY path
  -- (Phase 166.5 D-03): the analytics runner is the only writer of that column. Two
  -- more holds, both for a row the call has no business improving:
  --   * a `failed` row that carries a sentence stays `failed` (it would
  --     otherwise read `complete` over a held failure sentence), whether the side
  --     job failed or succeeded (D-08: a reaper-failed row must not be healed by an
  --     unrelated nightly job); a `failed` row with no sentence is the stale
  --     Eclipse shape D-05 exists for and resolves to complete as it always did;
  --   * no strategy_analytics row is written when none exists (the held columns
  --     have nothing to hold, and a fresh complete row would be the fresh-looking
  --     analytics D-09 forbids; Phase 166.5 R-06 extends this to a last-in-flight
  --     side job that SUCCEEDED).
  IF v_side_trigger
     AND NOT EXISTS (SELECT 1 FROM strategy_analytics WHERE strategy_id = p_strategy_id) THEN
    RETURN;
  END IF;

  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at, computation_error_source, computation_error_job_id)
  VALUES (p_strategy_id, 'complete', NULL, NULL, NULL, NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN v_side_trigger
                AND strategy_analytics.computation_status = 'failed'
                AND strategy_analytics.computation_error IS NOT NULL
           THEN 'failed'
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                OR strategy_analytics.computation_warned
           THEN 'complete_with_warnings'
           ELSE 'complete'
         END,
         computation_error  = CASE WHEN v_side_trigger THEN strategy_analytics.computation_error ELSE NULL END,
         -- Phase 164.2 / criterion 2: the markers go with the sentence, exactly
         -- like the blank on the line above and for the same reason. Every live
         -- failure is gone; there is nothing left for a marker to describe, and
         -- one left standing here would be read by the NEXT failure's write
         -- branch as a writer's claim over a sentence that no longer exists.
         -- D-09: a HELD sentence keeps its markers on the same predicate.
         computation_error_source = CASE WHEN v_side_trigger THEN strategy_analytics.computation_error_source ELSE NULL END,
         computation_error_job_id = CASE WHEN v_side_trigger THEN strategy_analytics.computation_error_job_id ELSE NULL END,
         computing_started_at = NULL;
END;
$$;

-- ACL, re-issued as proof (CREATE OR REPLACE with an unchanged signature keeps it).
REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_strategy_analytics_status(uuid, uuid) TO service_role;

-- --------------------------------------------------------------------------
-- three database comments that stopped being true, corrected
-- --------------------------------------------------------------------------
-- Each re-issue is built from the CURRENT catalogue text with only the stale
-- clause replaced, and is issued only when the object exists and still carries
-- that clause. Otherwise the block says so with a NOTICE and moves on: a
-- database without the 166.3.1 objects (a lane that does not load them) or a
-- text that was already corrected must never fail an apply that auto-deploys.
-- Catalogue reads only; no table is selected from.
DO $comments$
DECLARE
  v_attnum  SMALLINT;
  v_proc    REGPROCEDURE;
  v_trg     OID;
  v_cur     TEXT;
  v_new     TEXT;
  -- The clause each comment carries today, and the sentence that replaces it.
  v_col_stale  CONSTANT TEXT := 'the status bridge re-stamps computed_at = now() on every job transition (never reap) and the Python runner omits it on the computing entry-write so it holds the prior run''s value (reap instantly)';
  v_col_new    CONSTANT TEXT := 'the date moves only when the analytics runner writes a finished result (Phase 166.5), so it says nothing about when the current computation started';
  v_fn_stale   CONSTANT TEXT := 'Residue owned by Phase 166.5 COMPUTEDATSTAMP: branch (c) still stamps on an unrelated all-done mark, branch (a) stamps when it moves a failed+warned row to complete_with_warnings, and 166.5''s runner stamp must land on the success write because a stamp written while the row is computing is held here.';
  v_trg_stale  CONSTANT TEXT := 'Owner of the success-side residue: Phase 166.5.';
  v_since      CONSTANT TEXT := 'Since Phase 166.5 the bridge writes no date and the analytics runner stamps only on its success write; this trigger remains as defence in depth.';
BEGIN
  -- (1) the computing_started_at column comment
  SELECT a.attnum INTO v_attnum
    FROM pg_attribute a
   WHERE a.attrelid = to_regclass('public.strategy_analytics')
     AND a.attname = 'computing_started_at'
     AND NOT a.attisdropped;
  IF v_attnum IS NULL THEN
    RAISE NOTICE 'comment fix 1 skipped: public.strategy_analytics.computing_started_at is absent';
  ELSE
    v_cur := col_description('public.strategy_analytics'::regclass, v_attnum);
    IF v_cur IS NULL OR position(v_col_stale IN v_cur) = 0 THEN
      RAISE NOTICE 'comment fix 1 skipped: the computing_started_at comment is absent or no longer carries the stale clause';
    ELSE
      v_new := replace(v_cur, v_col_stale, v_col_new);
      EXECUTE format('COMMENT ON COLUMN public.strategy_analytics.computing_started_at IS %L', v_new);
    END IF;
  END IF;

  -- (2) 166.3.1's trigger function comment
  v_proc := to_regprocedure('public.strategy_analytics_hold_computed_at_until_success()');
  IF v_proc IS NULL THEN
    RAISE NOTICE 'comment fix 2 skipped: public.strategy_analytics_hold_computed_at_until_success() is absent';
  ELSE
    v_cur := obj_description(v_proc::oid, 'pg_proc');
    IF v_cur IS NULL OR position(v_fn_stale IN v_cur) = 0 THEN
      RAISE NOTICE 'comment fix 2 skipped: the trigger function comment is absent or no longer carries the stale sentence';
    ELSE
      v_new := replace(v_cur, v_fn_stale, v_since);
      EXECUTE format('COMMENT ON FUNCTION public.strategy_analytics_hold_computed_at_until_success() IS %L', v_new);
    END IF;
  END IF;

  -- (3) 166.3.1's trigger comment
  SELECT t.oid INTO v_trg
    FROM pg_trigger t
   WHERE t.tgname = 'strategy_analytics_hold_computed_at_until_success_trigger'
     AND t.tgrelid = to_regclass('public.strategy_analytics')
     AND NOT t.tgisinternal;
  IF v_trg IS NULL THEN
    RAISE NOTICE 'comment fix 3 skipped: strategy_analytics_hold_computed_at_until_success_trigger is absent';
  ELSE
    v_cur := obj_description(v_trg, 'pg_trigger');
    IF v_cur IS NULL OR position(v_trg_stale IN v_cur) = 0 THEN
      RAISE NOTICE 'comment fix 3 skipped: the trigger comment is absent or no longer carries the stale sentence';
    ELSE
      v_new := replace(v_cur, v_trg_stale, v_since);
      EXECUTE format('COMMENT ON TRIGGER strategy_analytics_hold_computed_at_until_success_trigger ON public.strategy_analytics IS %L', v_new);
    END IF;
  END IF;
END $comments$;

-- --------------------------------------------------------------------------
-- self-verify: the 20261009120000 block carried, with its anchors re-keyed
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_secdef      BOOLEAN;
  v_search_path TEXT;
  v_atttypid    OID;
  v_attnotnull  BOOLEAN;
  v_atthasdef   BOOLEAN;
  v_condef      TEXT;
  v_comment     TEXT;
  v_fn          TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid, uuid)'::regprocedure);
  -- STEP 3's trigger. Read into its own variable rather than reusing v_fn: the
  -- two bodies share almost every identifier, and one anchor accidentally run
  -- against the other body is an anchor that reports on the wrong object.
  v_fn_trg      TEXT;
  v_tgtype      SMALLINT;
  v_tgenabled   "char";
  v_trg_secdef  BOOLEAN;
  v_trg_config  TEXT;
  -- Phase 164.5.2.1 (BRIDGERESIDUE): this file's own anchors, below the
  -- carried ones. They run on v_body, a COMMENT-STRIPPED copy of the body (and
  -- so, since the rebind at the top of the block, do the carried ones), so no
  -- prose can satisfy them. Each positive anchor has its own boolean and is
  -- tested by exactly one IF, so a mutation twin stands it down with a
  -- one-token edit.
  v_body                       TEXT;
  v_unprotected_agg_anchored   BOOLEAN;
  v_b_warned_anchored          BOOLEAN;
  v_membership_sites           INTEGER;
  v_warned_case_sites          INTEGER;
  v_a_status_first_anchored    BOOLEAN;
  v_read1_fold_anchored        BOOLEAN;
  v_unmarked_filter_anchored   BOOLEAN;
  v_kind_lists                 INTEGER;
  v_refresh_keep_anchored      BOOLEAN;
  v_keep_arms                  INTEGER;
  v_bridge_lock_anchored       BOOLEAN;
  v_hold_cases                 INTEGER;
  -- The comment-BEARING body, kept for the one anchor whose job is to catch a
  -- comment (HONEST-01 H1). See the rebind as the first statement below.
  v_fn_raw                     TEXT;
  -- Phase 164.6.6.3.4 (STATUSBRIDGE): this file's own anchors, below the carried
  -- ones. Each positive anchor has its own boolean and is tested by exactly one
  -- IF, so a mutation twin stands it down with a one-token edit.
  v_side_lists                 INTEGER;
  v_side_kinds                 TEXT[];
  v_counting_in_side           BOOLEAN;
  v_side_list_ok               BOOLEAN;
  v_d06_clause_ok              BOOLEAN;
  v_pkl_sites                  INTEGER;
  v_side_trigger_ok            BOOLEAN;
  v_side_hold_ok               BOOLEAN;
  v_side_uses                  INTEGER;
  v_side_lit_sites             INTEGER;
  v_side_sites_ok              BOOLEAN;
  v_a_hold_ok                  BOOLEAN;
  v_c_status_hold_ok           BOOLEAN;
  v_c_row_guard_ok             BOOLEAN;
  v_no_date_write_ok           BOOLEAN;
  v_bridge_overloads           INTEGER;
  v_bridge_ndefaults           SMALLINT;
  v_bridge_argtypes            TEXT;
  v_mark_done                  TEXT;
  v_mark_failed                TEXT;
BEGIN
  -- ======================================================================
  -- ⭐ COMMENT-STRIP FIRST (Phase 164.5.2.1 review, SFH L-1). Every anchor in
  -- this block reads v_fn, so v_fn is REBOUND here to the comment-stripped body
  -- before any of them runs. A carried anchor that matched on comment-bearing
  -- text could stay green after its statement was deleted, as long as the same
  -- text survived in a `--` comment inside the function. Rebinding the variable
  -- rather than renaming it in each anchor keeps every RED-UNDER-M twin's find
  -- string valid. HONEST-01 (H1) alone reads v_fn_raw: a comment naming the
  -- operator column IS the defect it exists to catch.
  -- Strip BOTH plpgsql comment syntaxes, block first (T-163-16), so an anchor
  -- can only be satisfied by a STATEMENT. Measured: the body carries no string
  -- literal containing either comment opener, so the strip removes comments
  -- only.
  -- ======================================================================
  v_fn_raw := v_fn;
  v_body := regexp_replace(regexp_replace(v_fn_raw, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');

  -- ⛔ NULL FAILS OPEN THROUGH EVERY REGEX ARM BELOW (a NULL `!~` is NULL, and
  -- IF NULL does not raise), carried ones included.
  IF v_fn_raw IS NULL OR v_body IS NULL THEN
    RAISE EXCEPTION 'bridge-residue: the body of sync_strategy_analytics_status (or its comment-stripped copy) is NULL, so every anchor below would pass on nothing. Refusing to report compliance on an unread body.';
  END IF;
  v_fn := v_body;

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
    obj_description('sync_strategy_analytics_status(uuid, uuid)'::regprocedure, 'pg_proc'),
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
  IF has_function_privilege('anon', 'public.sync_strategy_analytics_status(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Criterion 2 re-base failed: role anon can EXECUTE sync_strategy_analytics_status -- the REVOKE above did not take, and this function writes strategy_analytics for ANY strategy_id with no ownership check';
  END IF;
  IF has_function_privilege('authenticated', 'public.sync_strategy_analytics_status(uuid, uuid)', 'EXECUTE') THEN
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
  -- (Since 20261003120000 v_fn is the comment-stripped body, so a comment can
  -- no longer move this count at all; the integer rule stands.)
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
  -- ⚠️ CHANGED 2026-10-03 (Phase 164.5.2.1, FOUNDER DECISION "Hold the date for
  -- both"): 2 -> 1. Branch (a)'s clear is no longer unconditional: on a KEEP it
  -- holds the sentence and both markers together, and clears both otherwise
  -- (the hold CASEs, anchored as a count at (xiii) below). Branch (c)'s copy is
  -- the one unconditional clear left, and this count still pins it.
  -- ⚠️ CHANGED 2026-10-07 (Phase 164.6.6.3.4, FOUNDER D-09): branch (c)'s clear is
  -- no longer unconditional either. It is `CASE WHEN v_side_trigger THEN
  -- <the held value> ELSE NULL END`, so a failed side-kind job holds the sentence
  -- and both markers together (item (3) of the file header) and every other call
  -- clears both exactly as before. The count is re-keyed on that whole CASE and
  -- stays 1: the clear still appears in exactly branch (c), with ELSE NULL.
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'computation_error_source\s*=\s*CASE\s+WHEN\s+v_side_trigger\s+THEN\s+strategy_analytics\.computation_error_source\s+ELSE\s+NULL\s+END', 'g')) <> 1 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the source-marker clear must appear in EXACTLY one branch -- (c) the all-done success write, as `CASE WHEN v_side_trigger THEN <held> ELSE NULL END` (branch (a) clears conditionally since 2026-10-03, anchored at (xiii)). Losing (c)''s copy leaves a stale writer claim over a resolved strategy, where the next failure''s generic is frozen out by a job that no longer has a failure';
  END IF;
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'computation_error_job_id\s*=\s*CASE\s+WHEN\s+v_side_trigger\s+THEN\s+strategy_analytics\.computation_error_job_id\s+ELSE\s+NULL\s+END', 'g')) <> 1 THEN
    RAISE EXCEPTION 'Criterion 2 verification failed: the job-id-marker clear must appear in EXACTLY one branch -- (c), as `CASE WHEN v_side_trigger THEN <held> ELSE NULL END` (branch (a) clears conditionally since 2026-10-03, anchored at (xiii)). A job id left standing over a blanked sentence is a claim about text that no longer exists, and the next equality test will honour it';
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
    RAISE EXCEPTION 'CR-01 verification failed: the two compute_jobs reads are in the WRONG ORDER -- the failed_final partition is evaluated before the non-terminal count. At READ COMMITTED, with the non-caller writers (claims, the stalled-job reset, the orphan terminalizer, the marker retraction) taking no per-strategy lock, a job committing running -> failed_final between the two reads is then invisible to BOTH: branch (a) sees no in-flight job, branches (b)/(b-prime) see no failure, and branch (c) publishes computation_status = complete over a live non-superseded permanent failure';
  END IF;

  -- CR-01: branch (b-prime) exists and its guard gates the UPDATE.
  IF v_fn !~* 'IF\s+v_protected_count\s*>\s*0\s+THEN\s+UPDATE\s+strategy_analytics\s+(--[^\n]*\n\s*)*SET\s+computation_error' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) is missing or its guard no longer gates the UPDATE; protected failures would fall through to branch (c), which clears computation_error and resolves the status to complete on a FAILED refresh';
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
  -- ⚠️ Reads v_fn_raw, the comment-BEARING body (Phase 164.5.2.1 review, L-1):
  -- this is the one anchor that must see comments.
  IF v_fn_raw ~* 'last_error' THEN
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

  -- ======================================================================
  -- Phase 164.5.2.1 (BRIDGERESIDUE) — this file's own anchors. They read
  -- v_body, the comment-stripped body computed (and NULL-checked) as the first
  -- statement of this block; v_fn holds the same text since the rebind there.
  -- ======================================================================

  -- (i) The unprotected-failure id array: an UNORDERED pick over the same
  -- partition, collected in the SAME statement as the existing live-failure
  -- aggregate (no new read-order window), as its eighth INTO target.
  v_unprotected_agg_anchored := v_body ~ 'array_agg\s*\(\s*id\s*\)\s*FILTER\s*\(\s*WHERE\s+NOT\s+is_protected\s*\)\s+INTO\s+v_failed_count\s*,[^;]*v_protected_job_id\s*,\s*v_unprotected_job_ids\s+FROM\s+live_failures';
  IF NOT v_unprotected_agg_anchored THEN
    RAISE EXCEPTION 'bridge-residue: the live-failure aggregate does not collect the unprotected failure ids (an unordered array_agg of id filtered to NOT is_protected) as the eighth INTO target of the same statement. Without it no branch can tell whether the row''s writer-provenance job is an unprotected live failure, and a failed run keeps computation_warned and is later published as complete_with_warnings.';
  END IF;

  -- (ii) Branch (b) clears computation_warned when the writer-provenance job is
  -- an unprotected live failure, directly after its own provenance CASEs (which
  -- are keyed on v_latest_job_id, so this anchor cannot match branch (a)).
  v_b_warned_anchored := v_body ~ 'computation_error_job_id\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*v_latest_job_id\s+THEN\s+strategy_analytics\.computation_error_job_id\s+ELSE\s+NULL\s+END\s*,\s*computation_warned\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*ANY\s*\(\s*v_unprotected_job_ids\s*\)\s+THEN\s+FALSE\s+ELSE\s+strategy_analytics\.computation_warned\s+END';
  IF NOT v_b_warned_anchored THEN
    RAISE EXCEPTION 'bridge-residue: branch (b) does not clear computation_warned when the row''s writer-provenance job is among the unprotected live failures. A marker retraction between the Python live re-read and the permanent mark then leaves the warning flag up over a failed run ([164.6.7-COMPOSITE-REREAD-RESIDUE]).';
  END IF;

  -- (iii) The membership predicate appears in EXACTLY seven places: branch
  -- (a)'s status arm, warned assignment and stamp arm, branch (b)'s warned
  -- assignment, and (founder decision 2026-10-03) the first arm of branch (a)'s
  -- three hold CASEs (sentence and both markers). Phase 166.5 removed the eighth
  -- site with the date CASE it lived in. A COUNT, not a presence test: any one
  -- survivor would satisfy a presence test.
  SELECT count(*) INTO v_membership_sites
    FROM regexp_matches(v_body, 'strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*ANY\s*\(\s*v_unprotected_job_ids\s*\)', 'g');
  IF v_membership_sites <> 7 THEN
    RAISE EXCEPTION 'bridge-residue: the writer-provenance membership predicate appears % time(s) in the body, not 7. Each of the first four sites (branch (a) status, warned and stamp arms; branch (b) warned) closes a distinct corner of [164.6.7-COMPOSITE-REREAD-RESIDUE]: losing a branch-(a) site publishes complete_with_warnings over a failed run whenever a sibling is in flight at the mark, or leaves the row computing with no reaper stamp. The other three lead branch (a)''s hold CASEs: losing one holds a failure sentence or its markers on a row going computing over a failed run.', v_membership_sites;
  END IF;

  -- (iv) computation_warned is assigned by a CASE in exactly two places
  -- (branches (a) and (b)). Branches (b-prime) and (c) never write it.
  SELECT count(*) INTO v_warned_case_sites
    FROM regexp_matches(v_body, 'computation_warned\s*=\s*CASE', 'g');
  IF v_warned_case_sites <> 2 THEN
    RAISE EXCEPTION 'bridge-residue: computation_warned is assigned by a CASE % time(s) in the body, not 2 (branches (a) and (b)). Fewer leaves the warning flag over a failed run on one of the two loud branches; more means another branch now writes the runner-owned flag.', v_warned_case_sites;
  END IF;

  -- (v) Branch (a)'s status CASE tests membership FIRST, ahead of the
  -- complete_with_warnings arm; in the other order the warned arm wins on
  -- exactly the rows this fix exists for.
  v_a_status_first_anchored := v_body ~ 'SET\s+computation_status\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*ANY\s*\(\s*v_unprotected_job_ids\s*\)\s+THEN\s+''computing''\s+WHEN\s+strategy_analytics\.computation_status\s*=\s*''complete_with_warnings''';
  IF NOT v_a_status_first_anchored THEN
    RAISE EXCEPTION 'bridge-residue: branch (a)''s status CASE does not test the writer-provenance membership predicate FIRST, ahead of the complete_with_warnings arm. A sibling in flight at the mark of an unprotected, writer-reached failure then publishes complete_with_warnings over the failed run.';
  END IF;

  -- (vi) Branch (b-prime) must not write computation_warned: a protected
  -- failure leaves every publish column alone. Bounded by b-prime's own WHERE,
  -- the same bound the carried b-prime negatives use.
  IF v_body ~* 'SET\s+computation_error\s*=\s*CASE(?:(?!WHERE\s+strategy_id)(?:.|\n))*?computation_warned\s*=' THEN
    RAISE EXCEPTION 'bridge-residue: branch (b-prime) writes computation_warned. A protected refresh failure over a healthy published row must leave the publish state, including the runner-owned warning flag, untouched.';
  END IF;

  -- (vii) [164.6.7-RETRY-PLAIN-COMPLETE]: the unmarked non-terminal count is
  -- read in the SAME statement as the non-terminal count (same snapshot, so
  -- the carried READ ORDER pin above still sees read 1 ahead of the partition).
  v_read1_fold_anchored := v_body ~ 'INTO\s+v_nonterminal_count\s*,\s*v_nonterminal_unmarked_count';
  IF NOT v_read1_fold_anchored THEN
    RAISE EXCEPTION 'bridge-residue: the unmarked non-terminal count is not read INTO v_nonterminal_unmarked_count by the same statement as v_nonterminal_count. Read in its own statement it takes its own snapshot, and a job crossing between the two reads is counted marked by one and absent from the other, so a plain complete row can be kept over unmarked work in flight.';
  END IF;

  -- (viii) the count excludes ONLY a job carrying an in-scope refresh marker:
  -- the marker test and the kind test sit inside one COALESCE, so a NULL
  -- marker or kind counts as UNMARKED (fail toward today's behaviour).
  v_unmarked_filter_anchored := v_body ~ 'count\s*\(\s*\*\s*\)\s*FILTER\s*\(\s*WHERE\s+NOT\s+COALESCE\s*\(\s*\(\s*metadata\s*->>\s*''source''\s*\)\s*IN\s*\(\s*''ledger-refresh''\s*,\s*''ledger-refresh-composite''\s*\)\s*AND\s+kind\s+IN\s*\([^)]*\)\s*,\s*FALSE\s*\)\s*\)';
  IF NOT v_unmarked_filter_anchored THEN
    RAISE EXCEPTION 'bridge-residue: the unmarked non-terminal FILTER is not NOT COALESCE(<marker in the two refresh markers> AND <kind in scope>, FALSE). Without the marker test an unmarked user-started job is treated as a refresh retry; without the kind test a request-derived process_key_long source keeps a published row; without the COALESCE a NULL marker drops the job from the count. Each keeps a plain complete row over work a user is waiting on.';
  END IF;

  -- (ix) every kind list in the body spells the SAME scope (whitespace
  -- normalised): the protection predicate and the unmarked FILTER must agree.
  SELECT count(DISTINCT regexp_replace(m[1], '\s+', '', 'g')) INTO v_kind_lists
    FROM regexp_matches(v_body, '\mkind\s+IN\s*\(([^)]*)\)', 'g') AS m;
  IF v_kind_lists <> 1 THEN
    RAISE EXCEPTION 'bridge-residue: the body spells % distinct refresh kind scopes, not 1. The protection predicate and the unmarked non-terminal FILTER must name the same kinds, or a kind protected at its failure bounces the row to computing on its retry (or the reverse).', v_kind_lists;
  END IF;

  -- (x) the keep flag, with both counts defaulting to the NOT-keep side.
  v_refresh_keep_anchored := v_body ~ 'v_refresh_keep\s*:=\s*v_publish_healthy\s+AND\s+COALESCE\s*\(\s*v_nonterminal_unmarked_count\s*,\s*1\s*\)\s*=\s*0\s+AND\s+COALESCE\s*\(\s*v_failed_count\s*,\s*1\s*\)\s*=\s*0';
  IF NOT v_refresh_keep_anchored THEN
    RAISE EXCEPTION 'bridge-residue: v_refresh_keep is not v_publish_healthy AND COALESCE(<unmarked count>, 1) = 0 AND COALESCE(<failed count>, 1) = 0. Dropping a conjunct keeps a plain complete row while unmarked work is in flight, while an unprotected failure is live, or on a row that is not published; a 0 default would keep it on an unknown count.';
  END IF;

  -- (xi) the keep arms in branch (a), one in the status CASE and one in the
  -- stamp CASE: a COUNT, so a lost arm cannot hide behind a surviving one.
  SELECT count(*) INTO v_keep_arms
    FROM regexp_matches(v_body, 'WHEN\s+v_refresh_keep\s+AND\s+strategy_analytics\.computation_status\s*=\s*''complete''', 'g');
  IF v_keep_arms <> 2 THEN
    RAISE EXCEPTION 'bridge-residue: branch (a) carries % refresh keep arm(s), not 2 (the status arm and the stamp arm). Without the status arm a plain complete row is rewritten to computing on every marked in-scope refresh retry ([164.6.7-RETRY-PLAIN-COMPLETE]); without the stamp arm a kept complete row carries a stuck-computing reaper stamp.', v_keep_arms;
  END IF;

  -- (xii) D-06: the per-strategy lock, as the FIRST statement after the NULL
  -- guard and before the first compute_jobs read. One statement-shaped regex
  -- pins presence, namespace, key, two-integer form and both placements.
  v_bridge_lock_anchored := v_body ~ 'END\s+IF\s*;\s*PERFORM\s+pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*p_strategy_id::text\s*\)\s*\)\s*;\s*SELECT\s+count\s*\(\s*\*\s*\)\s+INTO\s+v_job_count';
  IF NOT v_bridge_lock_anchored THEN
    RAISE EXCEPTION 'bridge-residue: sync_strategy_analytics_status does not take the two-integer mark_compute_job_bridge advisory lock on the strategy id as its first statement after the NULL-strategy guard. A direct caller (the Python DEFERRED path) then reads compute_jobs while an uncommitted terminal mark on the same strategy is changing it; above the guard, a NULL strategy would make the lock a silent no-op.';
  END IF;

  -- (xiii) FOUNDER DECISION 2026-10-03 ("Hold the date for both"): branch (a)'s
  -- sentence and both provenance markers are each assigned by a
  -- CASE whose FIRST arm is the membership predicate (today's write), whose
  -- second arm HOLDS the column on a keep (a complete_with_warnings row, or a
  -- plain complete row under the refresh keep with no warning to resurface),
  -- and whose ELSE is today's write. One regex per CASE shape, the column
  -- back-referenced into the hold arm, counted: exactly three (Phase 166.5 removed
  -- the date CASE, the fourth).
  -- ⭐ VALUE-PINNED (Phase 164.5.2.1 review, SFH L-3). The ELSE back-reference
  -- only makes the THEN and the ELSE agree with EACH OTHER; on its own the
  -- regex accepts any of the three values for any column, so rewriting both
  -- arms of one column to NULL still counted 3 and every row going computing
  -- lost its sentence. A match counts only when its (column, value) pair
  -- is the one that column must write, so that edit, or one column's value
  -- swapped for another's, counts 2 and raises.
  SELECT count(*) INTO v_hold_cases
    FROM regexp_matches(v_body, '(computation_error|computation_error_source|computation_error_job_id)\s*=\s*CASE\s+WHEN\s+strategy_analytics\.computation_error_source\s*=\s*''writer''\s+AND\s+strategy_analytics\.computation_error_job_id\s*=\s*ANY\s*\(\s*v_unprotected_job_ids\s*\)\s+THEN\s+(EXCLUDED\.computation_error|NULL)\s+WHEN\s+strategy_analytics\.computation_status\s*=\s*''complete_with_warnings''\s+OR\s+\(\s*v_refresh_keep\s+AND\s+strategy_analytics\.computation_status\s*=\s*''complete''\s+AND\s+strategy_analytics\.computation_warned\s+IS\s+NOT\s+TRUE\s*\)\s+THEN\s+strategy_analytics\.\1\s+ELSE\s+\2\s+END', 'g') AS m
   WHERE (m[1], m[2]) IN (('computation_error',        'EXCLUDED.computation_error'),
                          ('computation_error_source', 'NULL'),
                          ('computation_error_job_id', 'NULL'));
  IF v_hold_cases <> 3 THEN
    RAISE EXCEPTION 'bridge-residue: branch (a) carries % hold CASE(s) of the founder-decided shape with the value each column must write, not 3 (computation_error -> EXCLUDED.computation_error, computation_error_source -> NULL, computation_error_job_id -> NULL, in both the membership THEN and the ELSE). A missing one splits a held sentence from its provenance markers (founder decision 2026-10-03); a wrong value writes it on every non-kept transition, e.g. a NULL sentence blanks the failure a user is meant to read.', v_hold_cases;
  END IF;

  -- The NULL-strategy refusal is behavioural: a NULL id must raise
  -- invalid_parameter_value, the guard the lock line sits after. It reads no
  -- table (the raise is the function's first statement). On its own it does
  -- not prove the ORDER (the STRICT lock is a no-op on NULL either way); the
  -- placement anchor above does.
  BEGIN
    PERFORM sync_strategy_analytics_status(NULL);
    RAISE EXCEPTION 'bridge-residue: sync_strategy_analytics_status(NULL) returned without raising. The NULL-strategy guard is gone, so a NULL id reaches the per-strategy lock (a silent no-op on NULL) and every read below it.'
      USING ERRCODE = 'P0001';
  EXCEPTION
    WHEN invalid_parameter_value THEN
      NULL;
  END;

  -- The namespace must not collide with the other two-integer advisory
  -- namespace in this schema (the same check 20260926120000 makes).
  IF hashtext('mark_compute_job_bridge') = hashtext('admin_role_mutate') THEN
    RAISE EXCEPTION 'bridge-residue: hashtext(mark_compute_job_bridge) equals hashtext(admin_role_mutate) on this server, so a bridge call and an admin role mutation on colliding ids would serialize against each other.';
  END IF;

  -- (xiv) RLS-LOW-01: the Python DEFERRED path calls this function DIRECTLY
  -- over PostgREST as service_role, so service_role must hold EXECUTE. The
  -- carried ACL arms above prove only that anon and authenticated do NOT.
  IF NOT has_function_privilege('service_role', 'public.sync_strategy_analytics_status(uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'bridge-residue: service_role cannot EXECUTE sync_strategy_analytics_status(uuid, uuid). The Python DEFERRED path (analytics-service/services/analytics_status.py) calls it directly over PostgREST as service_role; without the grant that call answers 42501, the caller logs a warning, and strategy_analytics keeps its pre-DEFER status.';
  END IF;

  -- ======================================================================
  -- Phase 164.6.6.3.4 (STATUSBRIDGE) -- this file's own anchors. They read
  -- v_body, the comment-stripped body computed (and NULL-checked) as the first
  -- statements of this block, so no prose can satisfy them. They read the
  -- function body only and never a table ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).
  -- ======================================================================

  -- The ONE side-kind list: a CONSTANT TEXT[] declared in the function and read by
  -- every site that needs the closed list. How many declarations exist, and the
  -- literals of the first. The carried kind-scope anchor (ix) counts only the
  -- `kind IN (...)` spelling, so this list is invisible to it by construction.
  SELECT count(*) INTO v_side_lists
    FROM regexp_matches(v_body, '\mv_side_kinds\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\s*\[([^\]]*)\]', 'g');
  SELECT array_agg(m[1] ORDER BY m[1]) INTO v_side_kinds
    FROM regexp_matches(
           (SELECT l[1] FROM regexp_matches(v_body, '\mv_side_kinds\s+CONSTANT\s+TEXT\[\]\s*:=\s*ARRAY\s*\[([^\]]*)\]') AS l LIMIT 1),
           '''([a-z_]+)''', 'g') AS m;

  -- (xvi) NEGATIVE, placed above its positive: no kind that COUNTS toward failed
  -- is on the side list. A side list that swallowed a chain kind would hide a
  -- genuine analytics failure.
  v_counting_in_side := COALESCE(v_side_kinds && ARRAY['process_key_long', 'sync_trades', 'derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite', 'compute_analytics'], FALSE);
  IF v_counting_in_side THEN
    RAISE EXCEPTION 'status-bridge: the side-kind list names a kind that counts toward failed. The counting kinds are process_key_long, sync_trades, derive_broker_dailies, compute_analytics_from_csv, stitch_composite and the retired compute_analytics; the list found is %. A failure of any of them is a live analytics failure, and dropping it from the failure set reports a failed run as healthy.', v_side_kinds;
  END IF;

  -- (xv) the side list is CLOSED, EXACT and spelled ONCE: a count of spellings
  -- and a SET compare on the sorted literals, never four presence tests, so an
  -- extra, a missing or a re-spelled literal all raise.
  v_side_list_ok := COALESCE(v_side_lists = 1 AND v_side_kinds = ARRAY['compute_intro_snapshot', 'poll_positions', 'reconcile_strategy', 'sync_funding'], FALSE);
  IF NOT v_side_list_ok THEN
    RAISE EXCEPTION 'status-bridge: the side-kind list is not the four kinds D-05 names, spelled once. Found % spelling(s) with literals %; expected exactly one list of compute_intro_snapshot, poll_positions, reconcile_strategy and sync_funding. A list that gains a literal hides a failure, one that loses a literal pins an analytics status failed over a job that wrote no analytic, and a second spelling is how two lists drift apart.', v_side_lists, v_side_kinds;
  END IF;

  -- (xv-b) the constant is READ at exactly the three sites that need it, each as
  -- a whole expression (the live_failures CTE, the in-flight counting count, the
  -- single trigger test that keys the early return and branch (c)'s holds), and no
  -- side kind is spelled anywhere else in the body (Phase 166.5 R-03 removed the
  -- release clause's read, and E5 collapsed the two flag assignments, the failed
  -- one and the not-done one, into the one trigger test: 5 -> 4 -> 3). A
  -- second NOT-IN or IN list, or a respelled literal, is how two copies of the
  -- list drift apart; that is the defect the single declaration removes.
  SELECT count(*) INTO v_side_uses
    FROM regexp_matches(v_body, 'ANY\s*\(\s*v_side_kinds\s*\)', 'g');
  SELECT count(*) INTO v_side_lit_sites
    FROM regexp_matches(v_body, '''(sync_funding|poll_positions|reconcile_strategy|compute_intro_snapshot)''', 'g');
  v_side_sites_ok := v_side_uses = 3
    AND v_side_lit_sites = 4
    AND v_body !~ '\mkind\s+NOT\s+IN\s*\('
    AND v_body ~ 'AND\s+NOT\s+COALESCE\s*\(\s*f\.kind\s*=\s*ANY\s*\(\s*v_side_kinds\s*\)\s*,\s*FALSE\s*\)'
    AND v_body ~ 'SELECT\s+t\.kind\s*=\s*ANY\s*\(\s*v_side_kinds\s*\)\s+FROM\s+compute_jobs\s+t'
    AND v_body ~ 'count\s*\(\s*\*\s*\)\s*FILTER\s*\(\s*WHERE\s+NOT\s+COALESCE\s*\(\s*kind\s*=\s*ANY\s*\(\s*v_side_kinds\s*\)\s*,\s*FALSE\s*\)\s*\)\s+INTO\s+v_nonterminal_count\s*,\s*v_nonterminal_unmarked_count\s*,\s*v_nonterminal_counting_count';
  IF NOT v_side_sites_ok THEN
    RAISE EXCEPTION 'status-bridge: the side-kind constant is not read at exactly the three D-05/D-09 sites (the live_failures CTE, the in-flight counting count, the trigger test) as whole expressions, or a side kind is spelled outside its one declaration (found % read(s) of the constant and % literal(s) of the four kinds, expected 3 and 4, and no NOT-IN list). A second spelling is how the failure filter and the freshness hold come to disagree about what a side kind is.', v_side_uses, v_side_lit_sites;
  END IF;

  -- (xvii) D-06, the supersession as ONE whole expression: a failed
  -- process_key_long is dropped only when BOTH a later done derive AND a later done
  -- compute exist for the same strategy, each compared strictly on created_at. One
  -- regex over the entire clause, never a fragment: a fragment anchor is satisfied
  -- by this file's own header prose. The clause reads no job metadata, so the
  -- request-derived source marker cannot influence supersession.
  v_d06_clause_ok := v_body ~ 'NOT\s*\(\s*f\.kind\s*=\s*''process_key_long''\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+c1\s+WHERE\s+c1\.strategy_id\s*=\s*f\.strategy_id\s+AND\s+c1\.kind\s*=\s*''derive_broker_dailies''\s+AND\s+c1\.status\s*=\s*''done''\s+AND\s+c1\.created_at\s*>\s*f\.created_at\s*\)\s+AND\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+compute_jobs\s+c2\s+WHERE\s+c2\.strategy_id\s*=\s*f\.strategy_id\s+AND\s+c2\.kind\s*=\s*''compute_analytics_from_csv''\s+AND\s+c2\.status\s*=\s*''done''\s+AND\s+c2\.created_at\s*>\s*f\.created_at\s*\)\s*\)';
  IF NOT v_d06_clause_ok THEN
    RAISE EXCEPTION 'status-bridge: the live_failures CTE does not carry the D-06 supersession as one whole expression. A failed process_key_long may be dropped from the failure set only when BOTH a derive_broker_dailies job AND a compute_analytics_from_csv job for the same strategy are done with created_at strictly later than the failure (and nothing else). Weakening it either leaves a recovered strategy failed (the AI-FX-35 defect) or, worse, hides a genuine failure behind a half-finished chain.';
  END IF;

  -- (xviii) the process_key_long literal occurs at exactly ONE code site. Measured
  -- on the comment-stripped body of the file this one re-bases: zero sites, so
  -- exactly one after this migration. A second site is how the exemption gets
  -- copied onto another kind by a copy edit.
  SELECT count(*) INTO v_pkl_sites
    FROM regexp_matches(v_body, '''process_key_long''', 'g');
  IF v_pkl_sites <> 1 THEN
    RAISE EXCEPTION 'status-bridge: the body names the process_key_long literal at % code site(s), not 1. The chain supersession is scoped to that one kind (D-04: a later done of a different kind never masks a real analytics failure); a second site extends it to another kind.', v_pkl_sites;
  END IF;

  -- (xix) D-09 / D-03 / D-08, a side-kind job never disturbs a row it did not
  -- compute. Each piece is its own whole-expression regex over the comment-stripped
  -- body, so no prose can satisfy it. (a) the TRIGGER flag: the job that caused this
  -- call is a side-kind job of THIS strategy, in ANY outcome, NULL read as FALSE,
  -- never a recency pick and with no status test (Phase 166.5 E5: one flag replaces
  -- the failed-only flag and the not-done flag); (b) the early return for a side
  -- trigger with only side kinds in flight, directly ahead of branch (a); (c)
  -- branch (c) holds the sentence (the marker clears are anchored at the re-keyed
  -- (P2d) counts above), keeps a failed row that carries a sentence failed, and
  -- writes no row when none exists.
  v_side_trigger_ok := v_body ~ 'v_side_trigger\s*:=\s*COALESCE\s*\(\s*\(\s*SELECT\s+t\.kind\s*=\s*ANY\s*\(\s*v_side_kinds\s*\)\s+FROM\s+compute_jobs\s+t\s+WHERE\s+t\.id\s*=\s*p_trigger_job_id\s+AND\s+t\.strategy_id\s*=\s*p_strategy_id\s*\)\s*,\s*FALSE\s*\)\s*;';
  IF NOT v_side_trigger_ok THEN
    RAISE EXCEPTION 'status-bridge: v_side_trigger is not "the trigger job (p_trigger_job_id, of THIS strategy) is a side-kind job, in any outcome, NULL read as FALSE". A flag keyed on recency (the latest-created terminal job) holds a sentence after a genuine counting success; one that tests the job''s status lets a SUCCESSFUL side job with a sibling in flight blank a sentence (D-03) or heal a failed row that carries one (D-08); one that is FALSE too often lets a nightly side job blank the sentence of a real earlier failure (D-09).';
  END IF;
  -- (xix-c) DELETED by Phase 166.5 (R-03): the D-09 release clause, "no COUNTING job
  -- reached done after the row's date", is gone from the body, and its anchor with
  -- it. The new anchor (xxi) below pins the stronger statement that the body names
  -- the date column nowhere.
  -- (xix-d) The early return (WR-R3-01 / D-03), keyed on the one flag, directly ahead
  -- of branch (a). The former separate not-done trigger test and its anchor are gone
  -- with the flag they tested.
  v_a_hold_ok := v_body ~ 'IF\s+v_side_trigger\s+AND\s+COALESCE\s*\(\s*v_nonterminal_count\s*,\s*0\s*\)\s*>\s*0\s+AND\s+COALESCE\s*\(\s*v_nonterminal_counting_count\s*,\s*1\s*\)\s*=\s*0\s+THEN\s+RETURN\s*;\s*END\s+IF\s*;\s*IF\s+v_nonterminal_count\s*>\s*0\s+AND\s+NOT\s+v_protect_hold\s+THEN';
  IF NOT v_a_hold_ok THEN
    RAISE EXCEPTION 'status-bridge: the early return for a side-kind trigger (v_side_trigger) with only side kinds in flight is missing, keyed on another flag, or not directly ahead of branch (a). Without it every retry hop of a timing-out sync_funding, and a side job that succeeds while a sibling is in flight, runs branch (a), which moves the row to computing and blanks the sentence of a real earlier failure (D-03, D-09: a nightly side job must never disturb analytics it did not compute).';
  END IF;
  v_side_hold_ok := v_body ~ 'computation_error\s*=\s*CASE\s+WHEN\s+v_side_trigger\s+THEN\s+strategy_analytics\.computation_error\s+ELSE\s+NULL\s+END';
  IF NOT v_side_hold_ok THEN
    RAISE EXCEPTION 'status-bridge: branch (c) does not hold computation_error when v_side_trigger is TRUE (CASE WHEN v_side_trigger THEN <the stored value> ELSE NULL END). Without it a side-kind job blanks the sentence of a real earlier failure (D-09).';
  END IF;
  -- (xix-b) no BARE marker clear anywhere in the body (review 164.6.6.3.4 round 2,
  -- IN-R2-01). The re-keyed (P2d) counts pin the clear that exists in branch (c) as
  -- its held-or-cleared CASE; they cannot see an unconditional `... = NULL` added in
  -- a NEW write path, which would blank a held writer sentence's markers.
  IF v_body ~ 'computation_error_(source|job_id)\s*=\s*NULL' THEN
    RAISE EXCEPTION 'status-bridge: the body carries an unconditional computation_error_source or computation_error_job_id = NULL. Every marker clear must travel with its sentence on the same predicate (a CASE), or a write path added later blanks the markers of a sentence the bridge holds (D-09).';
  END IF;
  v_c_status_hold_ok := v_body ~ 'SET\s+computation_status\s*=\s*CASE\s+WHEN\s+v_side_trigger\s+AND\s+strategy_analytics\.computation_status\s*=\s*''failed''\s+AND\s+strategy_analytics\.computation_error\s+IS\s+NOT\s+NULL\s+THEN\s+''failed''\s+WHEN\s+strategy_analytics\.computation_status\s*=\s*''complete_with_warnings''';
  IF NOT v_c_status_hold_ok THEN
    RAISE EXCEPTION 'status-bridge: branch (c) does not keep a failed row that carries a sentence failed when v_side_trigger is TRUE. Without it a side-kind job flips a failed row to complete while its failure sentence is held (D-08, D-09).';
  END IF;
  v_c_row_guard_ok := v_body ~ 'IF\s+v_side_trigger\s+AND\s+NOT\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+strategy_analytics\s+WHERE\s+strategy_id\s*=\s*p_strategy_id\s*\)\s+THEN\s+RETURN\s*;\s*END\s+IF\s*;\s*INSERT\s+INTO\s+strategy_analytics';
  IF NOT v_c_row_guard_ok THEN
    RAISE EXCEPTION 'status-bridge: branch (c) does not refuse to INSERT a strategy_analytics row when v_side_trigger is TRUE and none exists. Without it a side-kind job writes a fresh complete row (D-09, R-06).';
  END IF;

  -- (xxi) Phase 166.5 (COMPUTEDATSTAMP, D-01/D-03): the body names the date column
  -- NOWHERE. The analytics runner is the only writer of strategy_analytics.computed_at,
  -- and it stamps it in the same write as the metrics; a bridge write moves freshness
  -- without a recompute (a nightly side job making stale analytics look freshly
  -- updated is the defect this phase exists to remove). One token test over the
  -- comment-stripped body covers every branch, the membership arm and any branch
  -- added later, which is why it is a negative over the whole body rather than one
  -- anchor per branch. The first-ever-row INSERT takes the column default (R-04), so
  -- it never needs to name the column either.
  v_no_date_write_ok := v_body !~* '\mcomputed_at\M';
  IF NOT v_no_date_write_ok THEN
    RAISE EXCEPTION 'status-bridge: the body of sync_strategy_analytics_status names computed_at. The analytics runner is the only writer of strategy_analytics.computed_at (D-01/D-03): it stamps the database clock in the same write as the metrics, and a bridge write moves freshness without a recompute, which is how a nightly side job made stale analytics look freshly updated. No branch of the bridge may assign, hold, compare or read the column.';
  END IF;

  -- (xx) the signature move and the two mark RPCs, catalogue and body reads only.
  -- (a) exactly ONE function of that name exists in public and it is
  -- (uuid, uuid) with ONE defaulted argument: a surviving one-argument overload
  -- would make every one-argument call fail with "function is not unique", and a
  -- second argument without its default would break the Python DEFERRED path and
  -- every caller that passes only p_strategy_id.
  SELECT count(*) INTO v_bridge_overloads
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'sync_strategy_analytics_status';
  SELECT p.pronargdefaults, pg_get_function_identity_arguments(p.oid)
    INTO v_bridge_ndefaults, v_bridge_argtypes
    FROM pg_proc p
   WHERE p.oid = 'public.sync_strategy_analytics_status(uuid, uuid)'::regprocedure;
  IF v_bridge_overloads <> 1 OR v_bridge_ndefaults IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'status-bridge: sync_strategy_analytics_status has % overload(s) in public (expected exactly 1) and % defaulted argument(s) on (uuid, uuid) (expected 1; arguments %). The old one-argument signature must be dropped, not left beside the new one, and p_trigger_job_id must default to NULL so every existing caller keeps working.', v_bridge_overloads, COALESCE(v_bridge_ndefaults::text, 'NULL'), COALESCE(v_bridge_argtypes, 'NULL');
  END IF;
  -- (b) both mark RPCs pass the job they just terminalised as the trigger, and are
  -- still SECURITY DEFINER with a pinned search_path and no EXECUTE for anon or
  -- authenticated (CREATE OR REPLACE kept the ACL; this proves it did).
  v_mark_done   := regexp_replace(regexp_replace(pg_get_functiondef('public.mark_compute_job_done(uuid, uuid)'::regprocedure), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_mark_failed := regexp_replace(regexp_replace(pg_get_functiondef('public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_mark_done IS NULL OR v_mark_failed IS NULL
     OR v_mark_done   !~ 'PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*,\s*p_job_id\s*\)\s*;'
     OR v_mark_failed !~ 'PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*,\s*p_job_id\s*\)\s*;' THEN
    RAISE EXCEPTION 'status-bridge: mark_compute_job_done or mark_compute_job_failed does not call sync_strategy_analytics_status(v_strategy_id, p_job_id). Without the trigger the bridge cannot tell a side-kind failure from a counting success and D-09 falls back to guessing from creation order.';
  END IF;
  IF v_mark_done !~ 'pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*v_strategy_id::text\s*\)\s*\)'
     OR v_mark_failed !~ 'pg_advisory_xact_lock\s*\(\s*hashtext\s*\(\s*''mark_compute_job_bridge''\s*\)\s*,\s*hashtext\s*\(\s*v_strategy_id::text\s*\)\s*\)'
     OR v_mark_done !~ '55006' OR v_mark_failed !~ '55006' THEN
    RAISE EXCEPTION 'status-bridge: a mark RPC lost the per-strategy bridge lock or the 55006 fence errcode in the re-base (both were carried from 20261001120000).';
  END IF;
  IF NOT (SELECT bool_and(p.prosecdef AND array_to_string(p.proconfig, ',') LIKE '%search_path=public%')
            FROM pg_proc p
           WHERE p.oid IN ('public.mark_compute_job_done(uuid, uuid)'::regprocedure,
                           'public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure)) THEN
    RAISE EXCEPTION 'status-bridge: a mark RPC lost SECURITY DEFINER or its pinned search_path in the re-base.';
  END IF;
  IF has_function_privilege('anon', 'public.mark_compute_job_done(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_compute_job_done(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_compute_job_failed(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_compute_job_failed(uuid, text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'status-bridge: anon or authenticated can EXECUTE a mark RPC. Both are SECURITY DEFINER writers keyed on a job id with no ownership check; the REVOKE above did not take.';
  END IF;

  RAISE NOTICE 'Migration 20261023120000: sync_strategy_analytics_status re-based on 20261009120000 with the computed_at writes and the D-09 release clause removed (COMPUTEDATSTAMP, Phase 166.5); every carried anchor passed on the new comment-stripped body, and this file''s own anchors passed after them.';
END $verify$;
