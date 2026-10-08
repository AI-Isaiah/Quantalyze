-- ============================================================================
-- ROLLBACK for 20261009120000_sync_status_analytics_scope.sql
-- Phase 164.6.6.3.4 STATUSBRIDGE, plan 02 (D-05, D-06).
-- ============================================================================
-- Manual, off the auto-apply path. It undoes everything the migration did:
--   * sync_strategy_analytics_status goes back to its ONE-argument signature
--     (uuid). The two-argument form (uuid, uuid DEFAULT NULL) is DROPPED, its
--     COMMENT is carried across, and the one-argument function is created as
--     20261003120000_sync_status_bridge_residues.sql defined it: the block from
--     the CREATE OR REPLACE through its closing delimiter, and the REVOKE and
--     GRANT, are copied from that file byte for byte.
--   * mark_compute_job_done and mark_compute_job_failed are replaced by their
--     20261001120000 definitions, byte for byte, which call the bridge with one
--     argument. (They must be replaced: left as they are, they would call a
--     two-argument bridge that no longer exists.) Their signatures, COMMENTs and
--     ACLs never moved.
--
-- WHAT IT RESTORES. The D-05 side-kind exclusion, the D-06 process_key_long
-- supersession and the D-09 trigger-keyed freshness hold are removed. After this
-- runs, a failed sync_funding, poll_positions, reconcile_strategy or
-- compute_intro_snapshot job pins strategy_analytics.computation_status 'failed'
-- again, a failed process_key_long is cleared only by a later done job of its own
-- kind, and a failing side job re-stamps computed_at again.
--
-- NO DATA IS TOUCHED. Only function bodies are replaced. But the status of a
-- strategy is a function of its jobs, so each strategy re-derives its status
-- under the OLD rule at its next terminal compute-job mark (or its next direct
-- call of the function). A row that read 'complete' because of the new rule can
-- therefore read 'failed' again after that next mark. Nothing rewrites those
-- rows eagerly.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261009120000 as applied while the function bodies no longer
-- carry it. `supabase db push` will therefore NOT re-apply the migration. To
-- re-apply it, mark the version reverted with
-- `supabase migration repair --status reverted 20261009120000`, and only after
-- the marker query in CLAUDE.md names the database you intend to repair. Until
-- then VAC-08's ledger check reports the version as present, which is true of the
-- ledger and false of the functions.
--
-- The DO block at the top is a catalogue-only PRECONDITION: it RAISEs, before
-- anything is replaced, unless the live two-argument bridge exists and its
-- comment-stripped body carries the `v_side_kinds` constant the migration added.
-- CREATE OR REPLACE succeeds on any database, so without it this file run against
-- a database that never had 20261009120000 would replace a body with an identical
-- one and still report success.
--
-- The DO block at the end is catalogue-only: it RAISEs, and so aborts the whole
-- rollback, if the side list, the D-06 derive clause or the trigger argument
-- survives, if more than one bridge overload exists, if the bridge's COMMENT was
-- lost, or if a function's ACL is not the one the old migrations declared. It
-- reads function bodies and the privilege catalogue and never a table.
-- ============================================================================

BEGIN;

SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
DECLARE
  v_body TEXT;
BEGIN
  v_body := regexp_replace(
              regexp_replace(
                pg_get_functiondef('public.sync_strategy_analytics_status(uuid, uuid)'::regprocedure),
                '/\*.*?\*/', '', 'gs'),
              '--.*', '', 'gn');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261009120000 refused: the body of sync_strategy_analytics_status could not be read. Nothing was replaced.';
  END IF;
  IF v_body !~ '\mv_side_kinds\s+CONSTANT' THEN
    RAISE EXCEPTION 'Rollback 20261009120000 refused: the live body of sync_strategy_analytics_status carries no v_side_kinds side list, so this database does not carry 20261009120000. Nothing was replaced. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- --------------------------------------------------------------------------
-- the bridge's signature moves back: (uuid, uuid DEFAULT NULL) -> (uuid)
-- --------------------------------------------------------------------------
-- The two-argument function is DROPPED (left in place it would make every
-- one-argument call, including the one-argument bridge's own callers, fail with
-- "function is not unique"). Its COMMENT is carried through a temp table to the
-- one-argument function, exactly as the migration carried the other direction.
CREATE TEMP TABLE statusbridge_new_comment (c TEXT);
INSERT INTO statusbridge_new_comment
  SELECT obj_description(to_regprocedure('public.sync_strategy_analytics_status(uuid, uuid)'), 'pg_proc');
DROP FUNCTION IF EXISTS public.sync_strategy_analytics_status(uuid, uuid);

-- --------------------------------------------------------------------------
-- the bridge, re-based on 20260906120000 STEP 2
-- --------------------------------------------------------------------------
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
  v_unprotected_job_ids UUID[];
  v_nonterminal_unmarked_count INTEGER;
  v_refresh_keep       BOOLEAN;
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
  -- One statement, one snapshot, two counts: every in-flight job, and the
  -- in-flight jobs that do NOT carry an in-scope refresh marker (the second
  -- feeds the keep flag; see RETRY-PLAIN-COMPLETE in the file header).
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
           FALSE))
    INTO v_nonterminal_count, v_nonterminal_unmarked_count
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
           -- membership arm does not fire) the sentence, both provenance markers
           -- and computed_at are HELD, because nothing was computed. On every
           -- other path they are written exactly as before. The four CASEs share
           -- one predicate, so the markers still travel with the sentence.
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
           END,
           computed_at = CASE
             WHEN strategy_analytics.computation_error_source = 'writer' AND strategy_analytics.computation_error_job_id = ANY (v_unprotected_job_ids)
             THEN now()
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR (v_refresh_keep AND strategy_analytics.computation_status = 'complete' AND strategy_analytics.computation_warned IS NOT TRUE)
             THEN strategy_analytics.computed_at
             ELSE now()
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

-- ACL. The REVOKE is carried forward VERBATIM from 20260826120000:909. This
-- function is SECURITY DEFINER and owned, and it has THREE callers: the two
-- service-role mark RPCs (mark_compute_job_failed, mark_compute_job_done), which
-- reach it by in-RPC PERFORM under their own definer rights, and the Python
-- DEFERRED path (analytics-service/services/analytics_status.py), which calls it
-- DIRECTLY over PostgREST as `service_role`. That third caller needs EXECUTE for
-- service_role itself, so the GRANT below is load-bearing.
-- ⚠️ ADDED 2026-10-03 (Phase 164.5.2.1 review, RLS-LOW-01). Before this file
-- that grant was never declared by any migration: PROD and TEST hold it only
-- through Supabase's bootstrap default privileges (the PROD baseline dump reads
-- `GRANT ALL ... TO "service_role"`), and a bare cluster without those defaults
-- (the pg-lane, measured: proacl {postgres=X/postgres}) has none. On PROD and
-- TEST the GRANT is a no-op, since EXECUTE is the only privilege a function
-- carries. The verify block asserts it held.
REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_strategy_analytics_status(uuid) TO service_role;

DO $comment$
DECLARE
  v_c TEXT;
BEGIN
  SELECT c INTO v_c FROM statusbridge_new_comment LIMIT 1;
  IF v_c IS NOT NULL THEN
    EXECUTE format('COMMENT ON FUNCTION public.sync_strategy_analytics_status(uuid) IS %L', v_c);
  END IF;
END
$comment$;
DROP TABLE statusbridge_new_comment;

-- --------------------------------------------------------------------------
-- the two mark RPCs, back to their 20261001120000 definitions (one-argument bridge call)
-- --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id     UUID,
  p_claim_token UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_current_token    UUID;
BEGIN
  -- audit-2026-05-07 B5: token is now mandatory. NULL was a documented
  -- pre-mig-117 back-compat path; the only production caller (main_worker)
  -- threads the token uniformly post-PR-#347.
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_done: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Atomic flip running → done with token fence + strategy capture.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND claim_token = p_claim_token
  RETURNING strategy_id INTO v_strategy_id;

  IF NOT FOUND THEN
    -- Row may exist but isn't running, OR row missing, OR token mismatch.
    SELECT status, strategy_id, claim_token
      INTO v_current_status, v_strategy_id, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 109 P6 / mig 117 second-pass fix #2: idempotent retry on
    -- already-done row ONLY when the caller's token matches the recorded
    -- one. The pre-B5 path also accepted NULL — removed now that NULL is
    -- rejected at the entrypoint above.
    IF v_current_status = 'done' THEN
      IF v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    -- Row in some other state (failed_retry, failed_final, pending,
    -- done_pending_children). Surface loudly.
    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- audit-2026-05-07 G23-187-mig-01/03 RE-APPLY: set-based fan-in advance
  -- with the GIN-supported containment predicate. The strict-token rewrite
  -- (20260528183100) had copied a pre-20260516131500 body and silently
  -- reverted this to a per-child `p_job_id = ANY(parent_job_ids)` FOR-loop,
  -- which the planner CANNOT push to the GIN index compute_jobs_parent_lookup
  -- (only `@>` containment is GIN-supported) -- re-introducing the H-0864
  -- seq-scan + N+1 check_fan_in_ready overhead. The NOT EXISTS sub-query
  -- enforces "all parents done" identically to check_fan_in_ready
  -- (count(parents WHERE status <> 'done') = 0). This form was live in prod
  -- 2026-05-16..2026-05-28 (mig 20260516131500) before the silent revert.
  UPDATE compute_jobs c
     SET status          = 'pending',
         next_attempt_at = now()
   WHERE c.status = 'done_pending_children'
     AND c.parent_job_ids @> ARRAY[p_job_id]::uuid[]
     AND NOT EXISTS (
       SELECT 1
         FROM compute_jobs p
        WHERE p.id = ANY(c.parent_job_ids)
          AND p.status <> 'done'
     );

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;


REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id      UUID,
  p_error       TEXT,
  p_error_kind  TEXT DEFAULT 'unknown',
  p_claim_token UUID DEFAULT NULL
)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_attempts      INTEGER;
  v_max_attempts  INTEGER;
  v_next_attempt  TIMESTAMPTZ;
  v_new_status    TEXT;
  v_strategy_id   UUID;
  v_current_token UUID;
  v_current_status TEXT;
BEGIN
  -- audit-2026-05-07 B5: token mandatory (see mark_compute_job_done above).
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_error_kind IS NOT NULL
     AND p_error_kind NOT IN ('transient', 'permanent', 'unknown') THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_error_kind must be transient/permanent/unknown, got %', p_error_kind
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT attempts, max_attempts, strategy_id
    INTO v_attempts, v_max_attempts, v_strategy_id
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
      AND claim_token = p_claim_token
    FOR UPDATE;

  IF NOT FOUND THEN
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % not found', p_job_id
        USING ERRCODE = 'no_data_found';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = '55006';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_failed: job % not running (status=%)', p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  IF p_error_kind = 'permanent' THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSIF v_attempts >= v_max_attempts THEN
    v_new_status := 'failed_final';
    v_next_attempt := now();
  ELSE
    v_new_status := 'failed_retry';
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      WHEN v_attempts = 3 THEN v_next_attempt := now() + interval '10 minutes';
      WHEN v_attempts = 4 THEN v_next_attempt := now() + interval '1 hour';
      ELSE                     v_next_attempt := now() + interval '6 hours';
    END CASE;
  END IF;

  -- HOTFIX 2026-05-29: write `error_kind` (the real column + CHECK target),
  -- NOT the non-existent `last_error_kind` that mig 20260528183100 introduced.
  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = p_error_kind,
         next_attempt_at = v_next_attempt
   WHERE id = p_job_id;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('mark_compute_job_bridge'), hashtext(v_strategy_id::text));
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ───────────── verify — CATALOGUE ONLY
DO $verify$
DECLARE
  v_body        TEXT;
  v_done        TEXT;
  v_failed      TEXT;
  v_overloads   INTEGER;
  v_comment     TEXT;
BEGIN
  v_body := regexp_replace(
              regexp_replace(
                pg_get_functiondef('public.sync_strategy_analytics_status(uuid)'::regprocedure),
                '/\*.*?\*/', '', 'gs'),
              '--.*', '', 'gn');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: the replaced body could not be read';
  END IF;
  IF v_body ~ '\mkind\s+NOT\s+IN\s*\(' OR v_body ~ '\mv_side_kinds\M' THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: the side-kind list survives in sync_strategy_analytics_status';
  END IF;
  IF v_body ~ '\mp_trigger_job_id\M' OR v_body ~ '\mv_side_failed_only\M' THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: the D-09 trigger survives in sync_strategy_analytics_status';
  END IF;
  IF v_body ~ '\mc1\.kind\s*=' THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: the D-06 derive supersession (alias c1) survives in sync_strategy_analytics_status';
  END IF;
  SELECT count(*) INTO v_overloads
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'sync_strategy_analytics_status';
  IF v_overloads <> 1 THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: % overload(s) of sync_strategy_analytics_status exist, not exactly the one-argument function', v_overloads;
  END IF;
  v_comment := COALESCE(obj_description('public.sync_strategy_analytics_status(uuid)'::regprocedure, 'pg_proc'), '');
  IF v_comment !~ '20260826120000' THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: the one-argument bridge lost its COMMENT in the signature move (it must carry 20260826120000)';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: service_role cannot EXECUTE sync_strategy_analytics_status(uuid)';
  END IF;
  IF has_function_privilege('anon', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: anon or authenticated can EXECUTE sync_strategy_analytics_status(uuid)';
  END IF;

  v_done   := regexp_replace(regexp_replace(pg_get_functiondef('public.mark_compute_job_done(uuid, uuid)'::regprocedure), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  v_failed := regexp_replace(regexp_replace(pg_get_functiondef('public.mark_compute_job_failed(uuid, text, text, uuid)'::regprocedure), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_done IS NULL OR v_failed IS NULL
     OR v_done   !~ 'PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*\)\s*;'
     OR v_failed !~ 'PERFORM\s+sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*\)\s*;'
     OR v_done ~ 'sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*,' OR v_failed ~ 'sync_strategy_analytics_status\s*\(\s*v_strategy_id\s*,' THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: a mark RPC does not call the bridge with exactly one argument again';
  END IF;
  IF has_function_privilege('anon', 'public.mark_compute_job_done(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_compute_job_done(uuid, uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.mark_compute_job_failed(uuid, text, text, uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.mark_compute_job_failed(uuid, text, text, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Rollback 20261009120000 failed: anon or authenticated can EXECUTE a mark RPC';
  END IF;

  RAISE NOTICE 'Rollback 20261009120000: sync_strategy_analytics_status is the one-argument 20261003120000 body again (comment and ACL intact, no other overload), and the mark RPCs call it with one argument; the side list, the D-06 clause and the D-09 trigger are gone. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
