-- Migration: strategy_analytics.computation_error stops carrying operator text.
-- The SQL status bridge derives the user-visible sentence from the STRUCTURED
-- `compute_jobs.error_kind`, never from the free-text `compute_jobs.last_error`.
-- Phase 162 / plan 02 / HONEST-01 (D-162-4 strict). 2026-08-26.
--
-- ⚠️ OPS: merging supabase/migrations/** to main AUTO-APPLIES to PROD. This file
-- redefines a function that every terminal compute-job transition PERFORMs
-- in-RPC, so it is live on the next merge with no separate deploy step and no
-- flag in front of it. That cost is unavoidable for this fix (see "WHY NOT THE
-- WRITER-ONLY ROUTE" below) — it is not a reason to prefer a route that does
-- not work.
--
-- ⛔ THE DEFECT
-- ------------
-- `strategy_analytics.computation_error` is a USER-VISIBLE column. It renders
-- verbatim in the wizard failure envelope (SyncPreviewStep, GATE_ANALYTICS_
-- FAILED) and on the portfolio dashboard's stale warning. `compute_jobs
-- .last_error` is an OPERATOR column: it holds whatever `classify_exception`
-- returned, which for the bottom arms is `str(exc)[:500]` — a raw Python
-- exception string.
--
-- Branches (b) and (b-prime) of `sync_strategy_analytics_status` copied the
-- second into the first. So the sentence a user read on a failed sync was, in
-- the common case, something of the shape
-- `TypeError: '>' not supported between instances of 'str' and 'NoneType'`.
-- That is the whole of HONEST-01's first success criterion, and this bridge is
-- where it is decided.
--
-- ⛔ WHY NOT THE WRITER-ONLY ROUTE (a retraction, measured)
-- ---------------------------------------------------------
-- Plan 162-02 as written asserted that curating the PYTHON writers was enough
-- because "the bridge copies what it is given". It is not given the Python
-- stamp. `analytics-service/services/job_worker.py` stamps
-- `strategy_analytics.computation_error` with its curated typed sentence, the
-- handler returns FAILED, `main_worker` calls `mark_compute_job_failed`, and
-- THAT RPC — in the same transaction as the status flip — does
-- `PERFORM sync_strategy_analytics_status(...)`, whose branch (b) then
-- overwrites the column from the job row. The curated stamp was clobbered
-- one statement later, every time. Measured at both ends; see
-- `.planning/phases/162-honest-what-the-user-sees-is-true/162-02-DECISION.md`.
--
-- The rejected alternative was to curate `DispatchResult.error_message`, i.e.
-- the value that becomes `compute_jobs.last_error`. That is not a relocation of
-- this fix, it is a regression: it strips the diagnosis from the operator
-- surface where an engineer reads what actually happened. The standing
-- invariant this codebase already proved for `api_keys.sync_error`
-- (analytics-service/tests/test_allocator_positions.py) asserts THREE things,
-- and the third is that the diagnosis SURVIVES on the operator surfaces.
-- `compute_jobs.last_error` keeps raw text. Unchanged by this migration.
--
-- ⛔ THE SHAPE, AND WHY IT IS A GUARANTEE RATHER THAN A PROMISE
-- ------------------------------------------------------------
-- Mirrors `sync_error_copy` (analytics-service/services/allocator_positions.py),
-- whose guarantee is made BY THE SIGNATURE rather than by vetting what callers
-- pass: it takes a status and a venue, never an exception, so it cannot leak
-- one. The SQL analog is `computation_error_copy(p_error_kind TEXT)` below. Its
-- RANGE is three fixed literals. Whatever is passed in, only one of those three
-- can come out — so the free-text column is structurally incapable of reaching
-- the user column through it.
--
-- And the bridge goes one step further than "does not copy last_error": after
-- this migration the identifier `last_error` DOES NOT APPEAR ANYWHERE IN THE
-- FUNCTION BODY, not in code and not in a comment. The self-verify block
-- asserts exactly that, on `pg_get_functiondef`, which returns comments. A
-- reader who wants to know why the bridge does not read the operator column
-- will find the answer HERE, in the file header, which `pg_get_functiondef`
-- does not return. That is the deliberate trade: the prose moves out of the
-- body so the anchor can be absolute.
--
-- ⛔ IS `error_kind` ACTUALLY POPULATED? MEASURED, because a CASE over a column
-- that is always NULL is a three-arm structure that only ever takes its default
-- ------------------------------------------------------------------------
-- Every writer of `compute_jobs.status = 'failed_final'` at HEAD, and what each
-- writes into `error_kind`:
--
--   WRITER                                                    error_kind
--   mark_compute_job_failed (20260529180000)                  `error_kind = p_error_kind`, UNCONDITIONAL
--     — callers: analytics-service/main_worker.py, two sites, passing
--       `kind or "unknown"` and the literal `"unknown"`. Neither can pass NULL.
--   retention_compute_jobs_orphaned_running (20260817120000)  `error_kind = 'permanent'`, both arms
--
-- There is no third writer. So on the paths that reach branch (b), `error_kind`
-- is non-NULL by construction. The live PROD domain over `failed_final` rows,
-- measured 2026-08-26: permanent 64 / unknown 55 / transient 10.
--
-- ⚠️ BUT THE THREE KINDS DO NOT YIELD THREE HONEST SENTENCES, so this does not
-- ship three. Read `mark_compute_job_failed`: 'permanent' terminalises
-- IMMEDIATELY, while 'transient' and 'unknown' reach 'failed_final' on ONE
-- condition only — `v_attempts >= v_max_attempts`. A transient failure and an
-- unknown failure arriving here therefore share the same, and only, true
-- statement: the automatic retries were used up. Giving them different copy
-- would imply a distinction the data does not carry. They share an arm, and the
-- self-verify block pins the resulting cardinality at 3 (permanent / retries-
-- exhausted / unrecognised) so a later edit cannot quietly collapse it to one
-- sentence or inflate it back to a decorative four.
--
-- Per-exception specificity is LOST by this change, and that is the accepted
-- trade. It costs the user nothing they had: the Python stamp's typed sentences
-- never survived to a screen — branch (b) overwrote them, and on the
-- `failed_retry` path branch (a) writes computation_error = NULL. What the user
-- reads on a failed sync today is the raw exception string and nothing else.
--
-- THE DELTA against 20260825150000 (five prior definitions exist; this re-bases
-- on the LATEST, 20260825150000_sync_status_protect_marked_refresh.sql):
--   1. NEW `computation_error_copy(TEXT)` — IMMUTABLE, three literals, no
--      object references.
--   2. `live_failures` selects `f.error_kind` instead of `f.last_error`; the two
--      `array_agg` aggregates carry the kind; `v_latest_error` / `v_protected_
--      error` become `v_latest_kind` / `v_protected_kind`.
--   3. Branch (b) writes `computation_error_copy(v_latest_kind)`.
--   4. Branch (b-prime) writes `computation_error_copy(v_protected_kind)`.
--      ⚠️ Its COALESCE-over-the-existing-value is REMOVED, and that is a
--      deliberate consequence, not an oversight. That COALESCE guarded exactly
--      one hazard: a protected job whose free-text error was NULL would erase a
--      diagnostic the row already carried. `computation_error_copy` is TOTAL —
--      it returns a sentence for NULL and for any unrecognised kind — so the
--      hazard is structurally gone, and a COALESCE whose left arm cannot be
--      NULL is dead code that teaches the next reader that NULL is reachable.
--      It also has a second, wanted effect: rows still holding raw exception
--      text written before this migration are HEALED the next time the bridge
--      touches them, instead of being preserved by the COALESCE.
--   5. Nothing else. Every CR-01 / JOB-01 / F-3 / PUB-02 / SI-02 anchor in the
--      self-verify block is carried forward; the four that were keyed on the
--      old `v_protected_error` spelling are RE-ANCHORED rather than deleted
--      (keyed on a spelling that no longer exists, a negative anchor becomes an
--      anchor that CANNOT FIRE — the exact vacuity that block exists to remove,
--      and the block's own comments record it happening once already).
--
-- NOT CHANGED, on purpose: `compute_jobs.last_error` (operator surface, keeps
-- raw text); the reaper's own literal (20260803130000, already curated); the
-- portfolio bridge (there isn't one — `portfolio_analytics.computation_error`
-- is writer-local and is curated in the same plan, Python-side).


BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- computation_error_copy — the ONLY value the status bridge may write to
-- strategy_analytics.computation_error.
-- --------------------------------------------------------------------------
-- Takes an ERROR KIND. Never an error, and never a string derived from one.
-- Its range is the three literals below, so no input can travel through it —
-- that is the guarantee, and it is structural rather than a convention callers
-- have to keep. See the file header for the full argument and for why the
-- three compute_jobs error kinds collapse to two honest sentences plus a
-- cautious default.
--
-- NOT STRICT, deliberately: a NULL kind must resolve to the default sentence,
-- not to NULL. A NULL here would blank the column over a live failure, which is
-- the silent-failure mode the whole surface exists to avoid. (Measured: no
-- failed_final writer at HEAD can produce a NULL kind — this is the belt for a
-- future one.)
CREATE OR REPLACE FUNCTION computation_error_copy(p_error_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $copy$
  SELECT CASE p_error_kind
    -- 'permanent' terminalises on the FIRST failure (mark_compute_job_failed:
    -- `IF p_error_kind = 'permanent' THEN v_new_status := 'failed_final'`), so
    -- no automatic retry has happened and none is coming. Promising a retry
    -- here would be the thing that is false.
    WHEN 'permanent' THEN
      'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.'
    -- 'transient' and 'unknown' SHARE an arm, and the sameness is the honest
    -- part. Neither reaches 'failed_final' except through
    -- `v_attempts >= v_max_attempts`, so the one true statement about both is
    -- that the automatic retries were used up. Splitting them would spend two
    -- sentences implying a difference the user cannot act on.
    WHEN 'transient' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
    WHEN 'unknown' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
    -- Anything else: NULL, or a kind added after this migration. Says only what
    -- is true of every failure and claims nothing about retries.
    ELSE
      'Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.'
  END
$copy$;

COMMENT ON FUNCTION computation_error_copy(TEXT) IS
  'User-facing copy for strategy_analytics.computation_error, derived from compute_jobs.error_kind. Phase 162 / HONEST-01. Takes a KIND, never an error string: the range is three fixed literals, so nothing that goes in can come out. permanent -> will not resolve by retrying; transient/unknown -> automatic retries exhausted (they reach failed_final only via v_attempts >= v_max_attempts, so they share the one statement that is true of both); anything else, including NULL -> a cautious default that claims nothing about retries. The raw diagnosis stays on compute_jobs.last_error, which is operator-only and is NOT read by sync_strategy_analytics_status. Mirrors analytics-service/services/allocator_positions.py sync_error_copy.';

REVOKE ALL ON FUNCTION computation_error_copy(TEXT) FROM PUBLIC, anon, authenticated;

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
      -- NOT a closed namespace and `'source'` is NOT a private key: the single
      -- request-derived writer, analytics-service/routers/process_key.py:766
      -- and :1518, puts the caller's `body.source` straight into `p_metadata`.
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
    (array_agg(error_kind ORDER BY created_at DESC)
       FILTER (WHERE NOT is_protected))[1],
    (array_agg(error_kind ORDER BY created_at DESC)
       FILTER (WHERE is_protected))[1]
    INTO v_failed_count, v_protected_count, v_unresolved_count,
         v_latest_kind, v_protected_kind
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
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at)
    VALUES (p_strategy_id, 'computing', NULL, now())
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = CASE
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN 'complete_with_warnings'
             ELSE 'computing'
           END,
           computation_error  = EXCLUDED.computation_error,
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
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at)
    VALUES (p_strategy_id, 'failed', computation_error_copy(v_latest_kind), NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
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
       -- That COALESCE guarded exactly one hazard: on the no-Python-stamp paths
       -- this branch exists for — a preflight refusal, a circuit-break, a wedged
       -- venue gateway, a budget timeout — the job's diagnostic was NULL, so an
       -- unconditional assignment ERASED whatever the row already carried and
       -- left the column NULL over a live permanent failure. `computation_error
       -- _copy` is TOTAL: NULL in, a sentence out. The hazard cannot occur, and
       -- a COALESCE whose left arm is provably non-NULL is dead code that
       -- teaches the next reader that NULL is still reachable here.
       --
       -- ⚠️ The removal has a SECOND effect, and it is wanted: a row still
       -- carrying raw exception text written before this migration is HEALED the
       -- next time this branch touches it. Under the COALESCE that legacy text
       -- would have been preserved indefinitely, which is the defect.
       SET computation_error   = computation_error_copy(v_protected_kind),
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
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at)
  VALUES (p_strategy_id, 'complete', NULL, NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                OR strategy_analytics.computation_warned
           THEN 'complete_with_warnings'
           ELSE 'complete'
         END,
         computation_error  = NULL,
         computing_started_at = NULL,
         computed_at        = now();
END;
$$;

COMMENT ON FUNCTION sync_strategy_analytics_status IS
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any NON-SUPERSEDED UNPROTECTED failed_final → failed (with the CURATED sentence for the latest failure''s error_kind — never the job''s own diagnostic text), all done → complete; EXCEPT a row already at complete_with_warnings OR carrying the runner-owned computation_warned marker is preserved as complete_with_warnings in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears). SUPERSESSION (mig 20260710150000, F-3/PUB-02): a failed_final poisons the strategy ONLY when NOT superseded by a strictly-later done of the SAME (strategy_id, kind), keyed on the immutable created_at. Fresh-ledger re-onboard of a failed member key = RE-ENQUEUE a fresh compute job (enqueue dedup is in-flight-only, so a resubmit inserts a fresh generation while the stale failed_final is retained for audit); the bridge then ignores the same-kind-superseded failed_final. NEVER retry in place; NEVER delete queue history. Per-kind scoping keeps a real permanent failure poisoning across a later done of a DIFFERENT kind (cross-kind SAFETY). COMPUTING_STARTED_AT (mig 20260802120000, JOB-01): branch (a) maintains strategy_analytics.computing_started_at with a three-arm CASE keyed off the RESOLVED status — stamp now() only on a genuine transition INTO computing, KEEP the existing stamp when the row is already computing, and clear to NULL when the branch resolves to complete_with_warnings; branches (b) and (c) clear it to NULL as exit transitions. PROTECTED MARKED REFRESH (mig 20260825150000, Phase 161.1 CR-01): a non-superseded failed_final whose compute_jobs.metadata->>''source'' is a recurring ledger-refresh marker AND whose kind is one a refresh can reach (derive_broker_dailies, stitch_composite, or the forwarded chain hop compute_analytics_from_csv — the kind scope is the containment that survives a widening of the Pydantic Source Literal that request-derived writers put into the SAME metadata key; the enqueue_compute_job ACL is NOT that containment) AND whose strategy_analytics row still reads terminal-success (computation_status IN (complete, complete_with_warnings) — deliberately NOT widened with computation_warned, which survives both a computing entry-write and a failed bounce) is EXCLUDED from branch (b) and handled by branch (b-prime), which records computation_error (the curated sentence for the protected failure''s error_kind; the former COALESCE over the row''s existing value is RETIRED by mig 20260826120000 — computation_error_copy is total, so the NULL-erasure that COALESCE guarded cannot occur, and legacy raw text is healed rather than preserved) and clears computing_started_at but writes NO computation_status, NO computation_warned and NO computed_at — so a background maintenance refresh can never un-publish a funded account, while every user-initiated job still poisons loudly. The health conjunct is a coherence check with the worker-side D-15 guard: if that guard declined to protect it has already written failed, so this reads false and the loud path is taken. IDEMPOTENCE (same migration): the health read and the failure partition are evaluated BEFORE branch (a), and branch (a) stands down (v_protect_hold) when b-prime is the outcome it would otherwise reach — otherwise branch (a)''s transient computing write would make the next bridge call re-derive the protection as absent and poison the row it had already protected. A row that arrives ALREADY at computing with no protection previously granted is still LOUD. SCOPE OF THAT STAND-DOWN (same migration, CR-01 follow-up review): the hold is NOT per-strategy. It is released once EVERY protected failure already has a strictly-later, same-kind, UNMARKED job in flight — the only shape of job whose terminal outcome decides that failure without the health read (a done supersedes it per F-3/PUB-02; an unmarked failed_final is loud by design) — so an in-flight resync of the failure''s own kind advertises computing again instead of reading as a terminal success to the wizard poller. A MARKED successor is deliberately excluded: the recurring arm retrying against a still-wedged venue would otherwise release the hold, bounce the row to computing and go dark on its own retry. no rows → no-op (preserve existing). CURATED USER COPY (mig 20260826120000, Phase 162 HONEST-01): strategy_analytics.computation_error is a USER-VISIBLE column (wizard failure envelope, portfolio stale warning) and compute_jobs.last_error is an OPERATOR column holding raw classify_exception output, so branches (b) and (b-prime) no longer copy the second into the first — they write computation_error_copy(error_kind), whose range is three fixed literals. The identifier for the operator column does not appear anywhere in this function body, comments included, and the migration''s self-verify block asserts that on pg_get_functiondef. The raw diagnosis is unchanged on compute_jobs.last_error, which is where an engineer reads what actually happened. Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000 + 20260708120000 + 20260710150000 + 20260802120000 + 20260825150000 + 20260826120000.';

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- Self-verify — the CR-01 delta AND every anchor the re-base must not revert
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_secdef      BOOLEAN;
  v_search_path TEXT;
  v_fn          TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  SELECT COALESCE(
    (SELECT p.prosecdef FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
      LIMIT 1), FALSE)
  INTO v_secdef;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'CR-01 verification failed: sync_strategy_analytics_status lost SECURITY DEFINER in the re-base';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'CR-01 verification failed: sync_strategy_analytics_status lost its pinned search_path in the re-base';
  END IF;

  -- …and the EXECUTE ACL actually took (161.1 re-review, rls-policy-auditor).
  -- The REVOKE above was the ONE unasserted ACL in this phase — zero apply-time
  -- checks and zero durable arms — on the one object in the diff that is a
  -- cross-tenant SECURITY DEFINER *writer*: it upserts strategy_analytics for an
  -- arbitrary strategy_id with no ownership predicate anywhere in its body,
  -- because its only callers are service-role RPCs that have already
  -- established authority. Reachable by `authenticated`, that becomes a
  -- cross-tenant publish-state write primitive — set any strategy to
  -- 'computing' or 'failed' by id.
  --
  -- Mirrors check 1b of 20260825120000. `has_function_privilege` is used rather
  -- than an information_schema lookup for the two reasons recorded there:
  -- information_schema does not resolve grants held via PUBLIC or inherited
  -- through role membership, and this one does. A CREATE OR REPLACE preserves
  -- the pre-existing ACL, so a re-apply over a drifted grant would otherwise
  -- carry the drift forward silently.
  IF has_function_privilege('anon', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CR-01 verification failed: role anon can EXECUTE sync_strategy_analytics_status — the REVOKE above did not take, and this function writes strategy_analytics for ANY strategy_id with no ownership check';
  END IF;
  IF has_function_privilege('authenticated', 'public.sync_strategy_analytics_status(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'CR-01 verification failed: role authenticated can EXECUTE sync_strategy_analytics_status — the REVOKE above did not take, and this function writes strategy_analytics for ANY strategy_id with no ownership check';
  END IF;

  -- THIS migration's fail-without-fix anchors.
  --
  -- ⛔⛔ READ THIS BEFORE ADDING OR EDITING ONE. `pg_get_functiondef` RETURNS THE
  -- BODY'S COMMENTS. This function's prose quotes almost every identifier,
  -- literal and fragment it uses — that is what makes the prose good — so an
  -- anchor keyed on a bare identifier or a bare literal is satisfied by the very
  -- paragraph that describes the fix it claims to pin, and reports "verified"
  -- over a reverted fix. Two further ways an anchor goes vacuous here: a second
  -- CODE copy of the same construct elsewhere in the body (the marker literals
  -- and the metadata read are spelled twice; `OR strategy_analytics.
  -- computation_warned` three times), and a variable merely EXISTING (a DECLARE
  -- line plus an `INTO` satisfies any anchor that is just the variable's name).
  --
  -- SO, THE RULE FOR THIS BLOCK: anchor on a STATEMENT or an EXPRESSION. Where a
  -- construct has several legitimate code copies, either key on the specific one
  -- via its alias prefix (`f.`, `r.`, `d.`) or assert the COUNT.
  --
  -- ⚠️ MEASURED, not asserted. Round 4 of the 161.1 migration review reverted each
  -- fix in turn on a throwaway PG16 and re-applied: EIGHT assertions in this block
  -- were GREEN over their own reverted fix, including the whole fail-safe
  -- (`v_publish_healthy`), the marker test, the COALESCE, branch (b-prime)'s
  -- guard, and the per-kind supersession scope. Every anchor below has since been
  -- reddened against the mutation it claims to catch. If you add one, do the same
  -- — an anchor you cannot make fail is worse than no anchor, because it reads as
  -- coverage.

  -- (1) THE PROTECTION PREDICATE, asserted as ONE expression instead of four
  -- fragments. A single match pins all of: the marker test is present; it is read
  -- off the FAILING row (`f.`, so the has_live_successor copy cannot stand in for
  -- it); BOTH markers are spelled; the kind scope sits INSIDE the COALESCE; and
  -- the COALESCE carries its FALSE default.
  --
  -- What this replaces, and why each fragment was vacuous:
  --   * `metadata\s*->>\s*''source''` — satisfied by the SECOND code copy inside
  --     has_live_successor. MEASURED: replace the marker test with a bare TRUE and
  --     this stayed GREEN. That mutation makes EVERY permanent failure of the
  --     three in-scope kinds on a published strategy silently protected — the
  --     worst single regression in this file.
  --   * `'''ledger-refresh'''` / `'''ledger-refresh-composite'''` — same second
  --     copy, same result.
  --   * the COALESCE had NO anchor at all, despite this file calling it
  --     load-bearing three paragraphs up. Remove it and an unmarked failed_final
  --     with NULL metadata yields is_protected = NULL, which is excluded by BOTH
  --     `FILTER (WHERE is_protected)` and `FILTER (WHERE NOT is_protected)`; the
  --     failure vanishes from both classes and branch (c) publishes 'complete'
  --     with computation_error cleared over a real permanent failure.
  IF v_fn !~ 'COALESCE\s*\(\s*\(\s*f\.metadata\s*->>\s*''source''\s*\)\s*IN\s*\(\s*''ledger-refresh''\s*,\s*''ledger-refresh-composite''\s*\)\s*AND\s+f\.kind\s+IN\s*\([^)]*\)\s*,\s*FALSE\s*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the is_protected marker predicate is not the expected two-valued, kind-scoped, f-keyed expression. Either the metadata->>''source'' test is gone or no longer read off the failing row (every permanent failure of an in-scope kind on a published strategy would then be silently protected), or one of the two markers is missing (the arm whose marker is absent is unprotected), or the COALESCE(..., FALSE) is gone (is_protected turns NULL for unmarked failures with NULL metadata, they fall out of BOTH FILTERs, and branch (c) publishes over a live permanent failure)';
  END IF;

  -- (2) the health conjunct — THE whole fail-safe — anchored on the expression it
  -- terminates rather than on the variable's name. MEASURED vacuous before:
  -- `v_fn !~* 'v_publish_healthy'` was satisfied by the DECLARE line and by
  -- `INTO v_publish_healthy`, i.e. by the variable merely EXISTING, so deleting
  -- `AND v_publish_healthy` from is_protected — which is the difference between
  -- protecting a healthy funded account and laundering a genuinely broken
  -- strategy into a published-looking one — self-verified clean.
  IF v_fn !~* '\)\s*AND\s+v_publish_healthy\s+AS\s+is_protected' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the protection predicate does not terminate in `AND v_publish_healthy AS is_protected` — without that conjunct the exemption is granted on the marker alone, and it would launder a genuinely broken strategy into a published-looking one';
  END IF;
  -- NEGATIVE anchor: the health conjunct must not be widened with the
  -- runner-owned warning marker. `sa.` is this function's alias for the health
  -- read ONLY; branches (a)/(c) read the same column as
  -- `strategy_analytics.computation_warned`, so this cannot collide with them.
  IF v_fn ~* 'sa\.computation_warned' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the published-row health conjunct was widened with computation_warned; that marker survives a computing entry-write and a failed bounce, so the exemption would cover rows that are mid-computation or broken';
  END IF;
  -- 161.1 re-review (rls-policy-auditor): the marker is read out of a metadata
  -- key that a request-derived writer also writes. The kind scope is what stops
  -- a widened Pydantic Source Literal from reaching this predicate.
  IF v_fn !~ 'f\.kind\s+IN\s*\(' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the protection predicate is not kind-scoped — metadata->>''source'' is shared with routers/process_key.py''s request-derived body.source, and only the kind scope keeps a process_key_long job out of the exemption';
  END IF;
  -- …and EACH of the three kinds, pinned INSIDE the scope list. The old spelling
  -- was a bare `'''compute_analytics_from_csv'''`, which the comment above the
  -- predicate satisfies on its own — it names all three kinds in prose — so
  -- MEASURED, deleting the kind from the list stayed GREEN. The other two kinds
  -- had NO anchor at all: the list could have been narrowed to one kind and this
  -- block would have reported the re-base verified. Keyed on `f.kind IN (…)` with
  -- the literal INSIDE the parens, so a prose mention cannot satisfy it and a
  -- deletion from the list drops the match to zero.
  IF v_fn !~ 'f\.kind\s+IN\s*\([^)]*''derive_broker_dailies''[^)]*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped derive_broker_dailies — that is the kind the single-key fan-out (20260825130000) enqueues, so the ENTIRE single-key refresh arm becomes unprotected and its next permanent failure un-publishes a funded account through this bridge';
  END IF;
  IF v_fn !~ 'f\.kind\s+IN\s*\([^)]*''compute_analytics_from_csv''[^)]*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped compute_analytics_from_csv — that is the JOB_CHAIN_FOLLOW_ON hop the marker is forwarded onto, and it is the hop that compiles the factsheet, so CR-01 re-opens one hop later';
  END IF;
  IF v_fn !~ 'f\.kind\s+IN\s*\([^)]*''stitch_composite''[^)]*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped stitch_composite — that is the kind the composite fan-out (20260825140000) enqueues, so the ENTIRE composite refresh arm becomes unprotected and its next permanent failure un-publishes a live composite through this bridge';
  END IF;

  -- 161.1 re-review (idempotence): branch (a) must consult the hold, and the
  -- health read must be HOISTED ABOVE it. Ordering is the whole fix — the same
  -- two statements placed after branch (a)'s early return re-derive the
  -- protection from a status branch (a) has already overwritten.
  -- ⛔ ANCHORED ON THE WHOLE IF STATEMENT, not on the bare conjunct, and that is
  -- a VACUITY FIX (161.1 CR-01 follow-up review), MEASURED not suspected. This
  -- assertion used to read `v_fn !~* 'AND\s+NOT\s+v_protect_hold'`. That
  -- fragment is quoted VERBATIM by two prose comments inside this very function
  -- body, and pg_get_functiondef returns comments: measured against the deployed
  -- body it matched 3 times with the conjunct present and STILL 2 times with the
  -- conjunct deleted from branch (a)'s IF. So the headline falsification —
  -- delete the idempotence delta and watch this block go RED — came back GREEN,
  -- and the migration self-verified clean over the reverted fix. Keyed on the
  -- statement it guards, the same deletion drops the match count to 0.
  -- (Same class as the presence gate's own correction in the sibling .sql test:
  -- an anchor must not be a substring of the prose that describes it.)
  IF v_fn !~* 'IF\s+v_nonterminal_count\s*>\s*0\s+AND\s+NOT\s+v_protect_hold\s+THEN' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (a)''s guard does not consult v_protect_hold — a sibling job bounces a protected row to computing and the NEXT bridge call poisons the row this migration already protected. (Anchored on the whole IF statement on purpose: the bare conjunct is quoted by this function''s own comments, so a fragment anchor stayed green over the deleted fix.)';
  END IF;

  -- 161.1 CR-01 FOLLOW-UP: the hold must be SCOPED, not per-strategy. Without
  -- the successor conjunct one live protected failure suppresses branch (a) for
  -- every later bridge call on the strategy, so a user-initiated resync never
  -- advertises 'computing' and useStrategySyncPoller reads a terminal SUCCESS
  -- over a job that is still running.
  -- ⛔ Anchored on the CTE column's DEFINITION, not on the bare name. The name
  -- appears FOUR times in the deployed body and two of those are prose — this
  -- assertion and the CTE's own comment — so `v_fn !~* 'has_live_successor'` was
  -- satisfied by the comments ALONE. MEASURED: delete the whole successor column,
  -- its FILTER and the third conjunct (i.e. put the hold back to per-strategy) and
  -- this assertion stayed GREEN. It happened to be covered by the
  -- v_unresolved_count anchor below, so the regression was still caught — but an
  -- assertion that contributes nothing while READING as independent coverage is
  -- exactly how the next reader ends up trusting a gate that is not there. Keyed
  -- on `) AS has_live_successor`, which only the column definition can satisfy.
  IF v_fn !~* '\)\s*AS\s+has_live_successor' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the branch-(a) hold is not scoped by has_live_successor — one live protected failure would stand branch (a) down for EVERY later bridge call on the strategy, so an in-flight user-initiated resync reads as a terminal success to src/hooks/useStrategySyncPoller.ts and SyncPreviewStep materialises the pre-resync factsheet';
  END IF;
  IF v_fn !~* 'COALESCE\s*\(\s*v_unresolved_count\s*,\s*0\s*\)\s*>\s*0' THEN
    RAISE EXCEPTION 'CR-01 verification failed: v_protect_hold does not consult the unresolved-protected count with a NO-HOLD NULL default. Either the scope conjunct was dropped (the hold is per-strategy again) or its COALESCE default was changed so an unknown counter resolves toward SUPPRESSION — branch (a) would stand down on an unknown state and branch (c) would report an unfinished computation as a completed one';
  END IF;
  -- The successor must be UNMARKED. Drop that half and the recurring arm's own
  -- retry releases the hold, bounces the row to 'computing' and reopens CR-01
  -- through the very job that is failing. Asserted structurally rather than by
  -- name because the marker test is an expression, not an identifier.
  -- The successor must be of the failure's OWN KIND. That conjunct is what makes
  -- its terminal outcome DOMINATE — a same-kind 'done' supersedes the failure
  -- through F-3/PUB-02, so the protection branch (a) just destroyed is never
  -- needed. Drop it and any unrelated job releases the hold. (Arm I of the SQL
  -- gate is the behavioural falsification; this is the apply-time one, and it is
  -- keyed on `r.` so it cannot be satisfied by the supersession subquery's own
  -- `d.kind = f.kind` a few lines above.)
  IF v_fn !~* 'r\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the has_live_successor predicate is not scoped to the failure''s own kind. Any unrelated in-flight job would then release the branch-(a) hold, bounce the published row to computing and leave the protected failure unprotected on the next all-terminal call — a cron-enqueued sync_trades poll would take a funded account dark in three bridge calls';
  END IF;
  IF v_fn !~* 'AND\s+NOT\s+COALESCE\s*\(\s*\(\s*r\.metadata\s*->>\s*''source''\s*\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the has_live_successor predicate does not exclude MARKED successors. The recurring refresh arm re-attempting against a still-wedged venue would then release the branch-(a) hold, bounce the published row to computing, fail again and take branch (b) — CR-01 reopened by its own retry';
  END IF;
  -- ⛔ THE MARKER LITERALS ARE NOW SPELLED TWICE in this body (the protection
  -- predicate and the successor predicate), which is exactly what DEVIATION 1
  -- avoided for the supersession subquery and could not avoid here. Nothing in
  -- the language ties the two copies together, and a drift between them is
  -- SILENT: everything still compiles and the only symptom is a funded account
  -- going dark, or a retry silently releasing the hold. Assert that every marker
  -- list in the deployed body is spelled IDENTICALLY. (Measured against the
  -- pre-fix body, which contained exactly ONE such list; the fix adds the
  -- second, so the count is 2 and the distinct spelling must be 1.)
  IF (SELECT count(DISTINCT m[1])
        FROM regexp_matches(v_fn, '(\(\s*''ledger-refresh''[^)]*\))', 'g') AS m) <> 1 THEN
    RAISE EXCEPTION 'CR-01 verification failed: the recurring-refresh marker list is spelled more than one way in the deployed body. The protection predicate and the has_live_successor predicate must admit the SAME two markers; a drift between them either unprotects an arm or lets its own retry release the branch-(a) hold, and both are silent';
  END IF;
  -- ⛔ THE HOIST ANCHOR IS BRANCH (a)'S WRITE, NOT THE NON-TERMINAL COUNT — and
  -- it had to be re-anchored by the read-order fix below. This assertion used to
  -- compare the health read against `INTO v_nonterminal_count`, which stood in
  -- for "above branch (a)" only while that count sat immediately before branch
  -- (a)'s IF. The count now moves to the top of the function, so that comparison
  -- would be satisfied by a health read placed ANYWHERE after it — including
  -- back below branch (a), i.e. by the very regression it exists to catch.
  -- Anchor on the write itself: `INSERT INTO strategy_analytics` occurs three
  -- times (branches (a), (b), (c)) and position() returns the FIRST, which is
  -- branch (a)'s. So this now asserts the health read precedes EVERY write this
  -- function can perform — which is the fixed-point property stated directly,
  -- rather than a proxy for it that a later edit can quietly invalidate.
  IF position('INTO v_publish_healthy' IN v_fn) = 0
     OR position('INSERT INTO strategy_analytics' IN v_fn) = 0
     OR position('INTO v_publish_healthy' IN v_fn)
        > position('INSERT INTO strategy_analytics' IN v_fn) THEN
    RAISE EXCEPTION 'CR-01 verification failed: the published-row health read is not hoisted above branch (a). Read after it, the protection is re-derived from a column this function transiently overwrites, and v_protect_hold would be computed from a status branch (a) had already replaced';
  END IF;

  -- 161.1 re-review (READ ORDER, HIGH — data integrity). The SECOND, INDEPENDENT
  -- ordering constraint, and it is NOT implied by the hoist assertion above: the
  -- inclusive non-terminal count must be read BEFORE the failed_final partition.
  --
  -- Both statements read compute_jobs, at READ COMMITTED, with no per-strategy
  -- lock held by either mark RPC, so a concurrent running → failed_final commit
  -- can land between them. Job status is monotone toward terminal, which makes
  -- inclusive-first / failures-last safe (a job crossing the window is caught by
  -- the later read and merely double-counted). Reversed, the job is seen as
  -- RUNNING by the partition and TERMINAL by the count — invisible to both, so
  -- branch (c) publishes 'complete' over a live non-superseded permanent
  -- failure. The pre-fix draft of this file had exactly that inversion, so this
  -- assertion is a regression pin, not a hypothetical.
  --
  -- Keyed on `INTO v_failed_count` because that is the partition's INTO list; it
  -- and `INTO v_nonterminal_count` each occur EXACTLY ONCE in the deployed body
  -- (measured before this fix was written, against pg_get_functiondef, so the
  -- count is not read off the finished file).
  IF position('INTO v_nonterminal_count' IN v_fn) = 0
     OR position('INTO v_failed_count' IN v_fn) = 0
     OR position('INTO v_nonterminal_count' IN v_fn)
        > position('INTO v_failed_count' IN v_fn) THEN
    RAISE EXCEPTION 'CR-01 verification failed: the two compute_jobs reads are in the WRONG ORDER — the failed_final partition is evaluated before the non-terminal count. At READ COMMITTED, with no per-strategy advisory lock in mark_compute_job_done/failed, a job committing running -> failed_final between the two reads is then invisible to BOTH: branch (a) sees no in-flight job, branches (b)/(b-prime) see no failure, and branch (c) publishes computation_status = complete with computed_at = now() over a live non-superseded permanent failure. Read the INCLUSIVE set first and the failure set last; job status is monotone toward terminal, so that ordering makes the same window resolve to branch (a) instead';
  END IF;

  -- ⛔ Anchored on branch (b-prime)'s WHOLE guarded statement, not on the bare
  -- predicate. `v_protected_count > 0` is quoted VERBATIM by branch (a)'s comment
  -- ("v_protected_count > 0 is the other half"), and pg_get_functiondef returns
  -- comments: MEASURED, neutering branch (b-prime)'s guard to `IF FALSE THEN`
  -- left this assertion GREEN. That mutation is the one whose consequence this
  -- very error message states — protected failures fall through to branch (c),
  -- which clears computation_error and stamps computed_at = now() on a FAILED
  -- refresh. Keyed on `IF … THEN UPDATE strategy_analytics SET computation_error`,
  -- which no prose in this body spells.
  IF v_fn !~* 'IF\s+v_protected_count\s*>\s*0\s+THEN\s+UPDATE\s+strategy_analytics\s+(--[^\n]*\n\s*)*SET\s+computation_error' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) is missing or its guard no longer gates the UPDATE; protected failures would fall through to branch (c), which clears computation_error and stamps computed_at = now() on a FAILED refresh';
  END IF;
  -- …and that UPDATE must derive its value from the KIND (Phase 162 / HONEST-01).
  -- ⚠️ THIS ASSERTION REPLACES THE 161.1 ROUND-4 ADDITIVITY ANCHOR, which was
  -- keyed on `COALESCE(v_protected_error, strategy_analytics.computation_error)`.
  -- Left as it was, it would have matched NOTHING against this body and become a
  -- POSITIVE anchor that can never be satisfied — RED on every apply — while the
  -- property it actually protected (the column cannot be blanked over a live
  -- failure) is now carried by computation_error_copy's totality, pinned
  -- behaviourally further down. Keyed on the whole assignment expression, so
  -- swapping the argument back to a free-text variable drops the match to zero.
  IF v_fn !~* 'SET\s+computation_error\s*=\s*computation_error_copy\s*\(\s*v_protected_kind\s*\)' THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: branch (b-prime) does not write computation_error_copy(v_protected_kind). Either it is back to copying the failing job''s own diagnostic text into a user-visible column — the defect mig 20260826120000 closes — or it lost the write entirely, in which case a protected refresh failure is silent';
  END IF;

  -- NEGATIVE anchor: branch (b-prime) must not write the publish columns. The
  -- whole point is that a subscriber sees nothing change. Spelled as an
  -- UPDATE-with-status test rather than a bare column name, because
  -- `computation_status` legitimately appears all over branches (a)/(b)/(c).
  -- Both run from b-prime's SET to b-prime's OWN `WHERE strategy_id`, using a
  -- negative-lookahead bound rather than `(.|\n)*?`. Two properties matter:
  --   * ORDER-INDEPENDENT inside the SET list. The forbidden column is caught
  --     wherever in the list it is added, not only as the next assignment. The
  --     original anchor was `= v_protected_error\s*,\s*(comment)*computation_status`,
  --     i.e. next-assignment-only.
  --   * CANNOT RUN ON into branch (c), which legitimately writes both columns.
  --
  -- ⛔ The bound is the WHERE clause and NOT the statement's `;`, and that is a
  -- MEASURED correction, not a preference. Written as `[^;]*?` these anchors went
  -- vacuous instantly: the comment INSIDE this very UPDATE contains a semicolon
  -- ("…untouched on purpose; see the header…"), so the match could never reach the
  -- SET list at all. Both negative anchors were GREEN over a b-prime that wrote
  -- `computation_status = 'failed'`. A negative anchor bounded by a character that
  -- ordinary prose may contain is a negative anchor that any comment can disable.
  --
  -- ⚠️ These two were RE-ANCHORED once already, when b-prime's write became
  -- COALESCE(...): keyed on the older `= v_protected_error,` spelling they would
  -- have matched nothing at all and become a pair of negative anchors that CANNOT
  -- fire — the same vacuity this block exists to remove, arriving through a
  -- legitimate edit. Mig 20260826120000 is the SECOND such edit (the write is now
  -- `computation_error_copy(v_protected_kind)`) and they are re-keyed again for
  -- the same reason. If you change b-prime's SET expression a third time, come
  -- back here: a negative anchor whose prefix no longer exists is silently dead.
  IF v_fn ~* 'SET\s+computation_error\s*=\s*computation_error_copy\s*\(\s*v_protected_kind(?:(?!WHERE\s+strategy_id)(?:.|\n))*?computation_status\s*=' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) writes computation_status; a protected refresh failure must leave the publish state untouched';
  END IF;
  IF v_fn ~* 'SET\s+computation_error\s*=\s*computation_error_copy\s*\(\s*v_protected_kind(?:(?!WHERE\s+strategy_id)(?:.|\n))*?computed_at\s*=\s*now\(\)' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) stamps computed_at = now(); a FAILED refresh must never read as freshly computed';
  END IF;

  -- Retained anchors from the definitions this re-bases on. Dropping any of
  -- these silently reverts a closed defect.
  IF v_fn !~* 'computing_started_at\s*=\s*CASE' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (a) lost the conditional computing_started_at CASE (JOB-01, mig 20260802120000 — the reaper would never fire)';
  END IF;
  IF v_fn !~* 'computation_status\s+IS\s+DISTINCT\s+FROM\s+''computing''' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (a) lost the transition-in arm of the JOB-01 stamp CASE';
  END IF;
  -- ⛔ Anchored on the supersession SUBQUERY, not on the bare conjunct. The CTE's
  -- own comment spells `d.kind = f.kind` verbatim ("PER-KIND (d.kind = f.kind): a
  -- later done of a DIFFERENT kind can NEVER mask a real permanent failure"), so
  -- MEASURED, deleting the conjunct from the subquery left this GREEN — over the
  -- exact cross-kind-blind defect that killed held PR 229d80fa, which is what the
  -- comment two lines from the deletion says it exists to prevent.
  IF v_fn !~* 'FROM\s+compute_jobs\s+d\s+WHERE\s+d\.strategy_id\s*=\s*f\.strategy_id\s+AND\s+d\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (b) lost the per-kind supersession scope (d.kind = f.kind missing from the supersession subquery — F-3/PUB-02 reverted, and a later done of a DIFFERENT kind would mask a real permanent failure)';
  END IF;
  -- This one is keyed on the expression rather than the statement because
  -- `d.created_at > f.created_at` occurs EXACTLY ONCE in the deployed body, in
  -- code — no comment inside this function spells it (the file header does, and
  -- pg_get_functiondef does not return the file header). MEASURED RED on deletion.
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (b) lost the immutable created_at supersession key (F-3/PUB-02 reverted)';
  END IF;
  -- ⛔ A COUNT, not a presence test. The SI-02 marker read has THREE legitimate
  -- code copies and they are independent: branch (a)'s status CASE, branch (a)'s
  -- computing_started_at CASE (arm 1), and branch (c)'s status CASE. A presence
  -- anchor is satisfied by any ONE survivor, so MEASURED, deleting any single copy
  -- — each of which re-opens the SI-02 launder from a different side — left the
  -- old `v_fn !~* 'OR\s+strategy_analytics\.computation_warned'` GREEN. No comment
  -- in this body spells the fragment, so the count is exactly the code copies.
  -- Same idiom as the marker-list spelling assertion above.
  --
  -- ⚠️ If a future re-base legitimately changes how many copies exist, update the
  -- integer AND say which branch changed — do not relax this back to a presence
  -- test, which is what made it vacuous.
  IF (SELECT count(*)
        FROM regexp_matches(v_fn, 'OR\s+strategy_analytics\.computation_warned', 'g')) <> 3 THEN
    RAISE EXCEPTION 'CR-01 re-base failed: the runner-owned computation_warned marker read must appear in EXACTLY the three places 20260802120000 put it — branch (a)''s status CASE, branch (a)''s computing_started_at CASE, and branch (c)''s status CASE. Losing branch (a)''s status arm launders the warning into a plain ''computing''; losing branch (a)''s stamp arm leaves computing_started_at set on a row that is NOT computing, so the 16-hour reaper fires on a healthy warned row; losing branch (c)''s arm re-opens the SI-02 failed_final-bounce launder (mig 20260708120000). A presence test cannot tell these apart — any one survivor satisfies it';
  END IF;

  -- ======================================================================
  -- Phase 162 / HONEST-01 — THIS migration's own fail-without-fix anchors.
  -- ======================================================================

  -- (H1) THE ABSOLUTE ONE. The operator column's identifier must not appear in
  -- this function's definition AT ALL — not in a SELECT list, not in an
  -- aggregate, not in a comment. `pg_get_functiondef` returns comments, and the
  -- whole lesson of the block above is that a code reference and a prose one are
  -- indistinguishable to a regex. Rather than fight that, this anchor embraces
  -- it: forbid the token outright, and put the explanation in the FILE HEADER,
  -- which pg_get_functiondef does not return.
  --
  -- ⚠️ SO: DO NOT "improve" this body by explaining, in a comment here, why the
  -- bridge no longer reads the operator column. That comment is the regression
  -- this anchor detects, and it will RAISE on apply. Write it in the header.
  --
  -- This is stronger than asserting the two write sites individually, and that
  -- is the point: it holds over a THIRD write site someone adds later, which is
  -- exactly how this defect arrived in the first place.
  IF v_fn ~* 'last_error' THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: sync_strategy_analytics_status references compute_jobs.last_error. That column is the OPERATOR surface (raw classify_exception output) and this function writes strategy_analytics.computation_error, which renders verbatim to users in the wizard failure envelope and the portfolio stale warning. Copying one into the other is how a raw Python exception string became the sentence a user reads on a failed sync. Derive the copy from error_kind via computation_error_copy(). If this fired on a COMMENT rather than on code, the comment is still the defect: move the prose to the migration file header, which pg_get_functiondef does not return';
  END IF;

  -- (H2) branch (b) — the loud path, and the one that decides what the wizard
  -- shows for every user-initiated failure. Keyed on the whole VALUES tuple so a
  -- prose mention of the function name cannot satisfy it.
  IF v_fn !~* 'VALUES\s*\(\s*p_strategy_id\s*,\s*''failed''\s*,\s*computation_error_copy\s*\(\s*v_latest_kind\s*\)' THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: branch (b) does not write computation_error_copy(v_latest_kind) into the failed-status upsert. This is the branch every user-initiated permanent failure takes, so whatever it writes is what SyncPreviewStep renders';
  END IF;

  -- (H3) THE COPY FUNCTION CANNOT LEAK ITS INPUT — asserted BEHAVIOURALLY, by
  -- calling it, not by reading its text. This is the SQL port of the standing
  -- invariant analytics-service/tests/test_allocator_positions.py holds over
  -- api_keys.sync_error: feed the writer a canary and prove the canary is not on
  -- the user surface. A regex over the CASE could be satisfied by a body that
  -- also concatenates its argument; calling it cannot.
  IF computation_error_copy('TypeError: canary_e7b1 not supported between instances of str and NoneType') LIKE '%canary_e7b1%' THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: computation_error_copy returned its own argument. Its guarantee is that its RANGE is a fixed set of literals — the moment it interpolates the input, every caller that hands it a value derived from an exception is a leak, and the signature stops being a guarantee';
  END IF;

  -- (H4) TOTALITY. A NULL kind must yield a sentence, not NULL. Branch (b-prime)
  -- dropped its COALESCE-over-the-existing-value on the strength of this
  -- property; without it that branch would blank the column over a live
  -- permanent failure, which is the silent-failure mode 161.1 round 4 fixed.
  IF computation_error_copy(NULL) IS NULL THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: computation_error_copy(NULL) is NULL. Branch (b-prime) assigns this value unconditionally — it retired its COALESCE precisely because this function is total — so a NULL here silently blanks computation_error over a live protected failure. Either restore the ELSE arm or put b-prime''s COALESCE back; do not leave both gone';
  END IF;

  -- (H5) THE ARM CARDINALITY, asserted over the whole live domain plus NULL plus
  -- an unrecognised kind. THREE distinct sentences, and each of the three is a
  -- claim the data supports:
  --   permanent            — terminalises on the first failure, no retry happened
  --   transient / unknown  — SHARE a sentence, because both reach failed_final
  --                          only through v_attempts >= v_max_attempts
  --   NULL / future kind   — a default that claims nothing about retries
  -- Collapse it to one sentence and this goes RED; split transient from unknown
  -- to look more specific and it also goes RED, which is the direction that
  -- matters — the copy must not imply a distinction the data does not carry.
  IF (SELECT count(DISTINCT computation_error_copy(k))
        FROM (VALUES ('permanent'), ('transient'), ('unknown'),
                     (NULL), ('a_kind_added_after_20260826')) AS v(k)) <> 3 THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: computation_error_copy does not yield exactly 3 distinct sentences over {permanent, transient, unknown, NULL, unrecognised}. Fewer means the arms collapsed and the copy stopped distinguishing a failure that will not retry from one that exhausted its retries; more means transient and unknown were split apart, which implies a difference the user cannot act on and which mark_compute_job_failed does not make (both reach failed_final only via v_attempts >= v_max_attempts). If a future change to the retry rule makes them genuinely different, update this integer AND say which arm changed';
  END IF;

  -- (H6) the copy function's ACL. It is only ever called from inside a SECURITY
  -- DEFINER bridge; nothing user-facing needs to execute it, and a grant here
  -- would be an unnoticed widening rather than a feature.
  IF has_function_privilege('anon', 'public.computation_error_copy(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.computation_error_copy(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'HONEST-01 verification failed: computation_error_copy is EXECUTEable by anon/authenticated — the REVOKE above did not take';
  END IF;

  RAISE NOTICE 'Migration 20260826120000: sync_strategy_analytics_status re-base verified (HONEST-01 curated copy at both write branches, operator column unreferenced; CR-01 protected-refresh branch present and publish-column-free; JOB-01, F-3/PUB-02 and SI-02 anchors intact).';
END $verify$;

COMMIT;
