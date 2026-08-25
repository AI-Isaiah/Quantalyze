-- Migration: sync_strategy_analytics_status — a MARKED ledger refresh may not
-- un-publish a healthy funded account THROUGH THE SQL STATUS BRIDGE.
-- Phase 161.1 / CR-01 (161.1-REVIEW). 2026-08-25.
--
-- ⛔ WHAT THIS FIXES, AND WHY THE PYTHON GUARD ALONE WAS NOT A FIX
-- ----------------------------------------------------------------
-- Phase 161.1 plans 02 and 04 added a non-destructive failure guard (D-15) to
-- the two Python terminal-failure stamps a recurring ledger refresh can reach
-- (`_stamp_strategy_analytics_failed` on the single-key derive path and
-- `_stamp_failed` on the composite stitch path). Both guards skip the
-- `computation_status = 'failed'` upsert and return. The HANDLER then returns
-- a PERMANENT failure, `main_worker` calls `mark_compute_job_failed`, and that
-- RPC — in the SAME transaction as the status flip — does
-- `PERFORM sync_strategy_analytics_status(v_strategy_id)`.
--
-- Branch (b) of THIS function fires on ANY non-superseded `failed_final` and
-- writes `computation_status = 'failed'`. So the publish state was decided
-- downstream of the guard, by SQL, and the guard's entire promise was undone
-- one statement later. `src/lib/strategyGate.ts` maps `failed` to
-- ANALYTICS_FAILED, so the funded account's factsheet goes dark anyway — the
-- exact harm D-15 exists to prevent.
--
-- ⚠️ This also corrects the record in `161.1-04-SUMMARY.md`: the PROD composite
-- tracer's observed AFTER state (`complete_with_warnings` → `failed`, with
-- `returns_series`, `metrics_json_by_basis` and all 11 basis-series rows
-- SURVIVING) is the signature of THIS bridge acting alone, not of "the guard is
-- not merged yet". Merging the guard would not have changed that outcome. The
-- surviving series rows are the tell: the Python destructive path deletes them.
--
-- THE DELTA (one exemption + one new branch)
-- ------------------------------------------
-- A `failed_final` job is PROTECTED when BOTH hold:
--
--   (i)  the job carries a recurring-refresh marker —
--        `metadata ->> 'source' IN ('ledger-refresh', 'ledger-refresh-composite')`
--        — AND its `kind` is one a refresh can actually reach:
--        'derive_broker_dailies' (20260825130000), 'stitch_composite'
--        (20260825140000), or 'compute_analytics_from_csv', the
--        JOB_CHAIN_FOLLOW_ON hop services/job_worker.py forwards the marker
--        onto; AND
--   (ii) the strategy's `strategy_analytics` row is STILL PUBLISHED at bridge
--        time — `computation_status IN ('complete','complete_with_warnings')`,
--        the same pair as `STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES` in
--        analytics-service/services/job_worker.py and the same pair the
--        staleness view's success predicate uses (20260825120000, D-04).
--
-- ⛔ WHAT ACTUALLY CONTAINS CONJUNCT (i) — corrected 2026-08-25 (161.1 migration
-- re-review, rls-policy-auditor MEDIUM). An earlier draft of this header said
-- the marker was unforgeable because `enqueue_compute_job` is service_role-only
-- (REVOKEd from PUBLIC/anon/authenticated at 20260515210300). That ACL is real,
-- and it is NOT the containment. MEASURED write surface for
-- `compute_jobs.metadata`: `set_compute_job_progress` writes only
-- `member_progress*`; the claim RPC writes only `unified_backbone_at_claim`; the
-- Python chain hop forwards only values already in `LEDGER_REFRESH_JOB_SOURCES`;
-- every TS call site passes fixed literals. But
-- analytics-service/routers/process_key.py:766 and :1518 put the REQUEST's
-- `body.source` straight into `p_metadata` — a service_role-only RPC called with
-- a user-supplied value is still a user-influenced write. The ACL bounds WHO may
-- call, never WHAT is written.
--
-- The two things that actually contain it:
--   1. VALUE — the Pydantic `Source` Literal at
--      analytics-service/services/ingestion/adapter.py:59 admits venue names
--      only (okx|binance|bybit|csv|deribit|sfox|mt5). Disjoint from the two
--      markers, and one enum widening away from not being.
--   2. KIND — both request-derived sites enqueue 'process_key_long', which is
--      outside conjunct (i)'s kind list and cannot be added to it by anything
--      short of editing this file. This is the half that survives (1) changing,
--      which is exactly why the kind scope is here.
-- Stating the ACL as the reason taught the next reader a rule they would have
-- correctly discovered was false, and discarded along with the real constraint.
-- (Same correction class as WR-01 and W-4 earlier in this phase.)
--
-- ⛔ THE PROTECTION MUST BE IDEMPOTENT ACROSS BRIDGE CALLS — added 2026-08-25
-- (161.1 migration re-review, MEDIUM). Conjunct (ii) is re-derived from
-- `computation_status`, and branch (a) of this very function transiently
-- overwrites that column with 'computing'. In the first draft the health read
-- sat AFTER branch (a)'s early return, so: grant the protection on a plain
-- 'complete' row (b-prime leaves the status alone — that IS the protection),
-- let ANY sibling job go non-terminal so branch (a) bounces the row to
-- 'computing', and the NEXT bridge call re-read (ii) as FALSE and sent the SAME
-- still-live failed_final to the loud branch. The protection un-did itself.
-- Only plain-'complete' rows are exposed — branch (a) preserves
-- complete_with_warnings and any warned row — and a plain 'complete' is what
-- every clean recompute leaves behind.
--
-- The remedy is ORDERING, not persistence: the health read and the failure
-- partition are HOISTED above branch (a), and branch (a) stands down
-- (`v_protect_hold`) exactly when branch (b-prime) is the outcome it would
-- otherwise reach. The published status is then never perturbed, so every later
-- call re-derives the SAME answer — a fixed point rather than a marker that has
-- to be kept in sync with the thing it shadows.
--
-- ⚠️ The rejected alternative was a durable `refresh_protected_at` column
-- written by b-prime and read by conjunct (ii). It does not close the harm: by
-- the time such a marker is consulted the row is ALREADY at 'computing' (branch
-- (a) wrote it), and b-prime writes NO status — so the row would be parked at
-- 'computing' with `computing_started_at` cleared, i.e. unpublished AND
-- invisible to the 16-hour reaper, forever. It also costs `ADD COLUMN` on
-- strategy_analytics, which auto-applies to PROD, to buy a second source of
-- truth that can drift from the first. Ordering is body-only and has neither
-- failure mode.
--
-- ⛔ What did NOT change: a row that reaches this function ALREADY at
-- 'computing' with no protection previously granted is still LOUD. That is the
-- documented, intended behaviour (see conjunct (ii)'s note below) and arm E of
-- the SQL gate pins it. The hold requires `v_protect_hold`, which requires
-- `v_publish_healthy`, so it can never rescue such a row.
--
-- ⛔ Conjunct (ii) is deliberately NOT widened with `OR computation_warned`.
-- `computation_warned` survives a 'computing' entry-write and a branch-(b)
-- 'failed' bounce, so a warned row can be mid-computation or outright broken;
-- exempting on the marker alone would leave a row parked at 'computing'
-- forever if the worker-side guard never ran (nothing else would move it until
-- the 16-hour reaper). Keyed on the status pair, that case takes the LOUD path.
--
-- Protected failures are excluded from branch (b)'s count and from its
-- latest-error pick, and are handled by a new branch (b-prime) that records the
-- error WITHOUT touching publish state.
--
-- ⛔ FAIL-SAFE DIRECTION, non-negotiable and identical to the Python guards'.
-- Conjunct (ii) is what makes this safe, and it is deliberately a COHERENCE
-- CHECK against the Python guard rather than an independent re-derivation:
--
--   * Python guard fired (row still terminal-success)  -> (ii) true  -> protected.
--   * Python guard DECLINED to fire — unreadable status, no prior row, a row
--     that was not terminal-success, a non-dict metadata — so it took the LOUD
--     path and wrote `failed`  -> (ii) FALSE -> branch (b) fires and the
--     strategy is poisoned loudly, exactly as today.
--   * No Python stamp ran at all (preflight refusal, circuit breaker, wedged
--     venue gateway, budget timeout) and the row is untouched-healthy ->
--     (ii) true -> protected, which is the CR-01 scenario-1 case this exists
--     for: a wedged MT5 gateway must not darken four live funded accounts.
--   * A user-initiated derive/stitch/analytics job -> no marker -> (i) FALSE ->
--     LOUD. The wizard's SyncPreviewStep poller keeps its terminal gate.
--
-- Any disagreement between the two ends therefore resolves TOWARD the loud
-- path. There is no input that resolves toward suppression.
--
-- WHAT BRANCH (b-prime) DELIBERATELY DOES NOT WRITE
-- --------------------------------------------------
--   * NO `computation_status` — the publish state is preserved verbatim,
--     including a `complete_with_warnings` that branch (c) would otherwise have
--     had to reconstruct from the marker.
--   * NO `computation_warned` — the runner owns that column (SI-02).
--   * NO `computed_at` — a FAILED refresh must never read as freshly computed.
--     Every other exit in this function stamps `computed_at = now()`; this one
--     must not, or an operator reading `computed_at` would see a lie. (The
--     freshness verdict in `public.ledger_refresh_staleness` keys on the max
--     date inside `returns_series`, not on this column, so a protected failure
--     keeps the strategy reading STALE — loudly — until a refresh succeeds.)
--   * It is an UPDATE, never an INSERT/upsert: conjunct (ii) already proved a
--     row exists, and inserting one here could only mean the coherence check
--     was wrong.
--
-- It DOES write `computation_error` (the failing job's `last_error`) and clears
-- `computing_started_at`. That keeps the failure visible in all four places the
-- D-15 comment promises — `compute_jobs`, the worker log line,
-- `computation_error`, and the staleness view — on EVERY protected path,
-- including the ones where no Python stamp ran to write the error itself.
--
-- Re-base contract for sync_strategy_analytics_status
-- ---------------------------------------------------
-- Re-based on the LATEST live CREATE OR REPLACE of this function
-- (20260802120000_strategy_analytics_stuck_computing_reaper.sql STEP 4) --
-- verified via grep across ALL migrations that 20260802120000 is the last of
-- the five defining migrations (20260412094454, 20260707120000, 20260708120000,
-- 20260710150000, 20260802120000) and that every later migration only CALLS or
-- comments on it. Preserved verbatim (branch (a)'s BODY included — only its
-- guard condition gains a conjunct, see DEVIATION 2): the signature, SECURITY
-- DEFINER, SET search_path = public, pg_catalog, branch (d)'s early return, branch (a)'s
-- three-arm conditional `computing_started_at` CASE (JOB-01 -- an unconditional
-- now() there is the Phase 106 janitor bug in a new column), branch (b)'s
-- PER-KIND `d.kind = f.kind` + immutable `d.created_at > f.created_at`
-- supersession (F-3 / PUB-02), BOTH `OR strategy_analytics.computation_warned`
-- marker reads in branches (a) and (c) (SI-02), branches (b)/(c) clearing the
-- stamp to NULL, and the REVOKE ALL ... FROM PUBLIC, anon, authenticated. NO
-- new GRANT is added.
--
-- TWO DELIBERATE STRUCTURAL DEVIATIONS from a byte-for-byte re-base.
--
-- DEVIATION 2 (the idempotence fix, above): the health read and the failure
-- partition are evaluated BEFORE branch (a) instead of after it, and branch
-- (a)'s condition gains `AND NOT v_protect_hold`. Branch (a)'s BODY is
-- untouched — same three-arm stamp CASE, same warned preservation, same
-- `computed_at = now()`. The hoist is inert for every pre-existing path: both
-- hoisted statements read state no earlier statement in this function has
-- written (branch (a) was the only possible earlier writer, and it returned),
-- and neither touches compute_jobs. It costs one extra aggregate over this
-- strategy's compute_jobs rows on the non-terminal path.
--
-- DEVIATION 1: branch (b)'s
-- two statements (the `count(*)` and the `ORDER BY created_at DESC LIMIT 1`
-- error pick) are folded into ONE statement over a `live_failures` CTE. The
-- original spelled the four-line non-supersession subquery TWICE; splitting the
-- failures into protected and unprotected classes would have made that FOUR
-- copies of the single most safety-critical predicate in the file. One copy in
-- a CTE cannot drift from itself. Semantics are unchanged: `count(*) FILTER`
-- reproduces the counts, and `(array_agg(last_error ORDER BY created_at DESC)
-- FILTER (...))[1]` reproduces `ORDER BY created_at DESC LIMIT 1` exactly,
-- including its arbitrary tie-break.
--
-- PROD-AUTO-APPLY WARNING
-- -----------------------
-- Merging supabase/migrations/** to main AUTO-APPLIES to PROD; there is no
-- separate deploy step. This file re-bases a SECURITY DEFINER function that
-- sits in the PERFORM tail of mark_compute_job_done / mark_compute_job_failed
-- for EVERY job kind. Apply to TEST via the Supabase MCP and run
-- supabase/tests/test_sync_status_marked_refresh_protected.sql BEFORE merge --
-- that file's presence gate makes it SKIP (asserting nothing) until this
-- migration is applied there.
--
-- No behaviour changes for any strategy that has no marked-refresh job, which
-- today is every strategy in production: both fan-outs are dormant.

BEGIN;
SET lock_timeout = '5s';

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
  v_latest_error       TEXT;
  v_protected_error    TEXT;
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
  -- state this function has not yet written (branch (a) was the only writer that
  -- could precede them, and it returned), and neither touches compute_jobs. The
  -- ONLY behaviour delta is the v_protect_hold guard on branch (a) below.
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
      f.last_error,
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
      ) AND v_publish_healthy AS is_protected
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
    (array_agg(last_error ORDER BY created_at DESC)
       FILTER (WHERE NOT is_protected))[1],
    (array_agg(last_error ORDER BY created_at DESC)
       FILTER (WHERE is_protected))[1]
    INTO v_failed_count, v_protected_count, v_latest_error, v_protected_error
    FROM live_failures;

  -- ---- the branch-(a) EXEMPTION (161.1 re-review MEDIUM: idempotence) -------
  -- TRUE exactly when branch (b-prime) is the outcome this call would reach if
  -- every job were terminal: a protected failure and NO unprotected one. Under
  -- that and only that condition branch (a) stands down, so the published
  -- status it would have bounced to 'computing' stays put and the NEXT call
  -- re-derives the SAME protection. The two conditions are deliberately the
  -- exact firing condition of (b-prime) rather than anything looser — branch
  -- (a) must preserve precisely what (b-prime) preserves, never more.
  --
  -- ⛔ COALESCE both ways, and note the two defaults are DIFFERENT on purpose.
  -- A NULL in either counter must resolve to NO HOLD, i.e. to today's
  -- behaviour, because standing branch (a) down on an unknown state would drop
  -- through to branches (b)/(c) with jobs still in flight — and branch (c)
  -- would report an unfinished computation as a completed one. Suppression is
  -- never the direction an unknown resolves to. `count(*)` cannot return NULL,
  -- so these are belt-and-braces; they are also what keeps this predicate
  -- TWO-VALUED, which `IF ... AND NOT v_protect_hold` requires (a NULL there
  -- reads as false and would skip branch (a) — the exact inversion).
  v_protect_hold := COALESCE(v_protected_count, 0) > 0
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
  -- Preserve it. Only the analytics runner clears the warning, via its own
  -- 'computing' entry-write + clean terminal write when it actually recomputes;
  -- the bridge must never downgrade it.
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

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
  -- failure is live. That is not a new shape for this branch: it ALREADY
  -- declines to show 'computing' over a sticky terminal success (the
  -- complete_with_warnings / computation_warned arm right below), which is the
  -- state of every strategy in the production ledger cohort today. Arm I2 of
  -- supabase/tests/test_sync_status_marked_refresh_protected.sql pins that the
  -- exemption is an exemption and not a disablement: with no protected failure
  -- live, an in-flight job must still read 'computing' and must still stamp.
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
  -- with the latest error. The supersession and partition rules that decide
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
    VALUES (p_strategy_id, 'failed', v_latest_error, NULL)
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
       SET computation_error   = v_protected_error,
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
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any NON-SUPERSEDED UNPROTECTED failed_final → failed (with latest error), all done → complete; EXCEPT a row already at complete_with_warnings OR carrying the runner-owned computation_warned marker is preserved as complete_with_warnings in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears). SUPERSESSION (mig 20260710150000, F-3/PUB-02): a failed_final poisons the strategy ONLY when NOT superseded by a strictly-later done of the SAME (strategy_id, kind), keyed on the immutable created_at. Fresh-ledger re-onboard of a failed member key = RE-ENQUEUE a fresh compute job (enqueue dedup is in-flight-only, so a resubmit inserts a fresh generation while the stale failed_final is retained for audit); the bridge then ignores the same-kind-superseded failed_final. NEVER retry in place; NEVER delete queue history. Per-kind scoping keeps a real permanent failure poisoning across a later done of a DIFFERENT kind (cross-kind SAFETY). COMPUTING_STARTED_AT (mig 20260802120000, JOB-01): branch (a) maintains strategy_analytics.computing_started_at with a three-arm CASE keyed off the RESOLVED status — stamp now() only on a genuine transition INTO computing, KEEP the existing stamp when the row is already computing, and clear to NULL when the branch resolves to complete_with_warnings; branches (b) and (c) clear it to NULL as exit transitions. PROTECTED MARKED REFRESH (mig 20260825150000, Phase 161.1 CR-01): a non-superseded failed_final whose compute_jobs.metadata->>''source'' is a recurring ledger-refresh marker AND whose kind is one a refresh can reach (derive_broker_dailies, stitch_composite, or the forwarded chain hop compute_analytics_from_csv — the kind scope is the containment that survives a widening of the Pydantic Source Literal that request-derived writers put into the SAME metadata key; the enqueue_compute_job ACL is NOT that containment) AND whose strategy_analytics row still reads terminal-success (computation_status IN (complete, complete_with_warnings) — deliberately NOT widened with computation_warned, which survives both a computing entry-write and a failed bounce) is EXCLUDED from branch (b) and handled by branch (b-prime), which records computation_error and clears computing_started_at but writes NO computation_status, NO computation_warned and NO computed_at — so a background maintenance refresh can never un-publish a funded account, while every user-initiated job still poisons loudly. The health conjunct is a coherence check with the worker-side D-15 guard: if that guard declined to protect it has already written failed, so this reads false and the loud path is taken. IDEMPOTENCE (same migration): the health read and the failure partition are evaluated BEFORE branch (a), and branch (a) stands down (v_protect_hold) exactly when b-prime is the outcome it would otherwise reach — otherwise branch (a)''s transient computing write would make the next bridge call re-derive the protection as absent and poison the row it had already protected. A row that arrives ALREADY at computing with no protection previously granted is still LOUD. no rows → no-op (preserve existing). Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000 + 20260708120000 + 20260710150000 + 20260802120000 + 20260825150000.';

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

  -- THIS migration's fail-without-fix anchors.
  IF v_fn !~ 'metadata\s*->>\s*''source''' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b) does not read compute_jobs.metadata->>''source'' — a marked refresh still un-publishes a funded account through the bridge';
  END IF;
  IF v_fn !~ '''ledger-refresh''' OR v_fn !~ '''ledger-refresh-composite''' THEN
    RAISE EXCEPTION 'CR-01 verification failed: one of the two refresh markers is missing from the protection predicate; the arm whose marker is absent is unprotected';
  END IF;
  IF v_fn !~* 'v_publish_healthy' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the protection predicate does not consult the published-row health conjunct — the exemption would launder a genuinely broken strategy';
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
  IF v_fn !~ '''compute_analytics_from_csv''' THEN
    RAISE EXCEPTION 'CR-01 verification failed: the kind scope dropped compute_analytics_from_csv — that is the JOB_CHAIN_FOLLOW_ON hop the marker is forwarded onto, and it is the hop that compiles the factsheet, so CR-01 re-opens one hop later';
  END IF;

  -- 161.1 re-review (idempotence): branch (a) must consult the hold, and the
  -- health read must be HOISTED ABOVE it. Ordering is the whole fix — the same
  -- two statements placed after branch (a)'s early return re-derive the
  -- protection from a status branch (a) has already overwritten.
  IF v_fn !~* 'AND\s+NOT\s+v_protect_hold' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (a) does not consult v_protect_hold — a sibling job bounces a protected row to computing and the NEXT bridge call poisons the row this migration already protected';
  END IF;
  IF position('INTO v_publish_healthy' IN v_fn) = 0
     OR position('INTO v_nonterminal_count' IN v_fn) = 0
     OR position('INTO v_publish_healthy' IN v_fn)
        > position('INTO v_nonterminal_count' IN v_fn) THEN
    RAISE EXCEPTION 'CR-01 verification failed: the published-row health read is not hoisted above branch (a). Read after it, the protection is re-derived from a column this function transiently overwrites, and v_protect_hold would be computed from a status branch (a) had already replaced';
  END IF;

  IF v_fn !~* 'v_protected_count\s*>\s*0' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) is missing; protected failures would fall through to branch (c), which clears computation_error and stamps computed_at = now() on a FAILED refresh';
  END IF;

  -- NEGATIVE anchor: branch (b-prime) must not write the publish columns. The
  -- whole point is that a subscriber sees nothing change. Spelled as an
  -- UPDATE-with-status test rather than a bare column name, because
  -- `computation_status` legitimately appears all over branches (a)/(b)/(c).
  IF v_fn ~* 'SET\s+computation_error\s*=\s*v_protected_error\s*,\s*(--[^\n]*\n\s*)*computation_status' THEN
    RAISE EXCEPTION 'CR-01 verification failed: branch (b-prime) writes computation_status; a protected refresh failure must leave the publish state untouched';
  END IF;
  IF v_fn ~* 'SET\s+computation_error\s*=\s*v_protected_error(.|\n)*?computed_at\s*=\s*now\(\)(.|\n)*?WHERE\s+strategy_id\s*=\s*p_strategy_id' THEN
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
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (b) lost the per-kind supersession scope (d.kind = f.kind missing — F-3/PUB-02 reverted)';
  END IF;
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branch (b) lost the immutable created_at supersession key (F-3/PUB-02 reverted)';
  END IF;
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'CR-01 re-base failed: branches (a)/(c) lost the computation_warned marker read (the SI-02 failed_final-bounce launder re-opens)';
  END IF;

  RAISE NOTICE 'Migration 20260825150000: sync_strategy_analytics_status re-base verified (CR-01 protected-refresh branch present and publish-column-free; JOB-01, F-3/PUB-02 and SI-02 anchors intact).';
END $verify$;

COMMIT;
