-- Migration: strategy_analytics stuck-'computing' reaper + computing_started_at
-- DDL (JOB-01 / JOB-02 / JOB-03, Phase 142, v1.16, 2026-08-02)
-- =============================================================================
--
-- Why this migration exists
-- -------------------------
-- A strategy_analytics row can be stranded at computation_status='computing'
-- forever. Nothing in the system ever terminalizes it: the compute_jobs
-- watchdog resets stalled JOBS, and the daily orphaned-running purge
-- (20260720120000) DELETEs orphaned job rows -- but neither writes
-- strategy_analytics. After that purge the strategy holds
-- computation_status='computing' with ZERO compute_jobs rows, which is exactly
-- the stranded condition and, today, a permanent one. The status bridge cannot
-- heal it either: branch (d) returns early when the strategy has no
-- compute_jobs rows at all, deliberately preserving the existing row.
--
-- Phase 106's janitor attempted this and was REVERTED because it keyed on
-- computed_at, which is not a "when did computing start" timestamp (see
-- "Backfill anchor" below). This migration adds the dedicated
-- computing_started_at column that revert said was required, and keys the
-- reaper on it.
--
-- WHERE THE VALUE LANDS (do not overclaim). The reaped row renders through
-- useStrategySyncPoller -> SyncPreviewStep -> wizardErrors GATE_ANALYTICS_FAILED,
-- which already ships a non-destructive clear_and_retry affordance. The value is
-- the PAGE-REFRESH / RETURN-LATER path and the factsheet surface, which gate on
-- computation_status. It is NOT a live-wizard rescue: SyncPreviewStep.tsx line
-- 112 sets RETRY_THRESHOLD_MS = 900_000, so an open wizard session already
-- self-escalates a frozen status after 15 minutes, long before an hours-scale
-- reaper threshold elapses.
--
-- CADENCE HONESTY. The '*/15 * * * *' schedule is POST-THRESHOLD DETECTION
-- LATENCY: a stranded row is terminalized within ~15 minutes of CROSSING the
-- threshold, so the worst case end-to-end is ~= threshold + 15 min (~16h15m).
-- The cadence does NOT bound user-visible spinner time and nothing in this file
-- should be read as claiming it does.
--
-- Threshold rationale
-- -------------------
-- TWO numbers, both from plan 142-01's derivation:
--   * CHAIN-INCLUSIVE CEILING = 43,920 s (12.2 h). Computed by
--     analytics-service/tests/test_main_worker.py::TestReaperThresholdInvariant
--     over the worst simple path through JOB_CHAIN_FOLLOW_ON
--     (process_key_long -> sync_trades -> derive_broker_dailies ->
--     compute_analytics_from_csv), each hop costing batch-tail exposure +
--     retried handler timeout + retry backoff.
--   * DEPLOYED INTERVAL = 16 hours (57,600 s), the smallest whole 4-hour
--     multiple >= 1.25x that ceiling (ratio 1.31x).
--
-- CANONICAL SOURCE is the Python constant
-- analytics-service/services/job_worker.py STRATEGY_ANALYTICS_REAP_THRESHOLD
-- (line ~540). The literal embedded in the cron body below MUST equal it;
-- tests/test_main_worker.py::TestReaperThresholdDriftGate fails CI if the two
-- diverge. Change the Python constant FIRST, then this file.
--
-- This is NOT batch_size x max_per_kind_timeout. That formula is the
-- compute_jobs formula (verbatim from 20260720120000 lines 24-25); it bounds how
-- long ONE CLAIMED JOB may sit 'running'. A strategy_analytics row is
-- 'computing' for a WHOLE multi-hop chain, a strictly larger quantity, and
-- re-applying the formula under-counts it by ~4x (it yields 2.5 h, which would
-- reap healthy in-flight chains).
--
-- SAFETY vs DEBOUNCE. The safety is carried by the NOT EXISTS (active
-- compute_jobs) conjunct: a healthy in-flight chain ALWAYS has a non-terminal
-- compute_jobs row, because each follow-on is enqueued INSIDE the parent handler
-- before it returns DONE. The interval is defense-in-depth debounce over the
-- maximum legitimate gap in which a row can be 'computing' with zero active
-- jobs. Do not shrink it without re-deriving the invariant.
--
-- CLOCK SKEW. The Python writer stamps computing_started_at client-side
-- (datetime.now(timezone.utc)); this cron compares against the DB's now().
-- Skew between the worker host and Postgres is bounded by NTP at the
-- seconds-to-minutes scale and is dwarfed by an hours-scale threshold. It
-- cannot flip a healthy row into scope.
--
-- Backfill anchor
-- ---------------
-- The one-shot backfill anchors computing_started_at to computed_at for rows
-- ALREADY at 'computing' when this migration applies. computed_at is acceptable
-- as that ONE-SHOT anchor and is NEVER acceptable as the ongoing key, because it
-- is wrong in BOTH directions:
--   * The SQL bridge re-stamps computed_at = now() on EVERY job transition
--     (20260710150000 lines 125, 179, 199), so a multi-hop chain would refresh
--     it on every hop and the row would NEVER be reaped.
--   * The Python runner's entry upsert OMITS computed_at, and PostgREST
--     merge-duplicates writes only the supplied columns, so computed_at retains
--     the PRIOR 'complete' run's value and the row would be reaped IMMEDIATELY.
-- Both failure modes are live today, which is what makes the SC#2 directional
-- tests falsifiable rather than hypothetical. computed_at is NOT NULL DEFAULT
-- now() (20260405061911 line 73), so every backfilled row gets a non-NULL stamp.
--
-- CENSUS AT AUTHORING TIME (read-only, 2026-08-02, via PostgREST):
--   TEST (qmnijlgmdhviwzwfyzlc): 0 rows at computation_status='computing'
--                               (of 7,371 strategy_analytics rows).
--   PROD (khslejtfbuezsmvmtsdn): 0 rows at computation_status='computing'
--                               (of 39 strategy_analytics rows).
-- So the backfill is expected to touch ZERO rows on both projects. It is
-- retained deliberately and is NOT dead code: it is the correct one-shot for any
-- row that enters 'computing' between authoring and apply, and its absence is
-- what would strand that row forever with a NULL stamp. Re-run the census before
-- merge; the number above is a snapshot, not a guarantee.
--
-- NULL-stamp rows are SKIPPED, never reaped. A 'computing' row with a NULL
-- computing_started_at is a WRITER bug, not a stranded job, and destructively
-- terminalizing it would convert a bug into user-visible data loss. Detection of
-- that writer bug is the STATIC CI stamp invariant (plans 142-03 / 142-05), not
-- a runtime alert -- see "Operator observability".
--
-- Scope discipline
-- ----------------
-- This migration adds ONE column, ONE partial index, ONE cron job, and re-bases
-- ONE existing function. It does NOT touch: compute_jobs DDL or RLS, the claim
-- RPC, mark_compute_job_done/_failed, the computation_status CHECK constraint,
-- the retention_compute_jobs_orphaned_running cron (Phase 144 owns that), or any
-- RLS policy. It creates NO new callable SQL surface -- the reaper is an INLINE
-- cron body, not a function, so there is no SECURITY DEFINER surface, no EXECUTE
-- grant, and no caller-suppliable threshold parameter. That is deliberate: a
-- caller-supplied INTERVAL on a cross-tenant reaping SECDEF function is the
-- 20260516170100 incident class (any caller could pass interval '1 second' and
-- flip every tenant's in-flight rows). The parameter IS the attack surface.
--
-- The reaper TERMINALIZES ONLY -- it never re-enqueues. Re-enqueue is JOB-04,
-- Phase 143. Keeping it out avoids two mechanisms racing the same row.
--
-- Idempotency
-- -----------
-- ADD COLUMN IF NOT EXISTS; the backfill is guarded by
-- `computing_started_at IS NULL` so re-apply is a no-op; CREATE INDEX IF NOT
-- EXISTS; CREATE OR REPLACE FUNCTION; cron.unschedule-then-cron.schedule is the
-- canonical re-apply pattern (matches 20260515210200 STEP 3 and 20260719120000).
-- Re-applying this whole file is a no-op.
--
-- Convention deviation (pre-documented so review does not re-litigate)
-- -------------------------------------------------------------------
-- .claude/agents/migration-reviewer.md invariant #14 forbids BEGIN/COMMIT in a
-- migration and rates session-level SET as HIGH. This file uses BOTH
-- deliberately: 150 of 231 migrations in this repo use BEGIN/COMMIT, including
-- the repo tip (20260728120000) and both pg_cron janitor analogs
-- (20260719120000, 20260720120000), and those analogs set
-- `lock_timeout = '5s'` at session level. Per project Rule 11 (conformance over
-- taste inside the codebase) and Rule 7 (pick one side, never blend), the repo
-- convention wins and the reviewer doc is stale. That staleness is logged as a
-- backlog item, not fixed here. EVERY OTHER migration-reviewer invariant applies
-- and was checked: #1 timestamp filename, #3 SECDEF search_path =
-- public, pg_catalog, #5 no CONCURRENTLY inside the transaction, #6 no 23502
-- timebomb (nullable, no DEFAULT, no SET NOT NULL), #16 template-artifact scan,
-- #20 ACLs preserved with no new GRANT, #21 every RAISE format string a single
-- literal. No transaction-abort statement appears anywhere in this file (that
-- token is legal only under supabase/tests/).
--
-- Operator observability
-- ----------------------
-- There is NO cron -> Sentry bridge in this repo and this migration does not
-- build one; claiming an alert that does not exist is the defect class this
-- milestone spent two phases closing. The honest operator surface is pg_cron's
-- own run log. To inspect reaper activity:
--
--   SELECT d.start_time, d.status, d.return_message
--     FROM cron.job_run_details d
--     JOIN cron.job j ON j.jobid = d.jobid
--    WHERE j.jobname = 'reap_strategy_analytics_stuck_computing'
--    ORDER BY d.start_time DESC
--    LIMIT 50;
--
-- To find NULL-stamp writer bugs (rows the reaper deliberately skips):
--
--   SELECT strategy_id, computed_at FROM public.strategy_analytics
--    WHERE computation_status = 'computing' AND computing_started_at IS NULL;
--
-- PROD-AUTO-APPLY WARNING
-- -----------------------
-- Merging supabase/migrations/** to main AUTO-APPLIES to PROD
-- (khslejtfbuezsmvmtsdn); there is no separate deploy step. This file re-bases a
-- SECURITY DEFINER function that sits in the PERFORM tail of
-- mark_compute_job_done / mark_compute_job_failed for EVERY job kind. Apply to
-- TEST (qmnijlgmdhviwzwfyzlc) via the Supabase MCP and run
-- supabase/tests/test_strategy_analytics_stuck_computing_reaper.sql BEFORE merge.
--
-- Re-base contract for sync_strategy_analytics_status
-- ---------------------------------------------------
-- Re-based verbatim on the LATEST live CREATE OR REPLACE of this function
-- (20260710150000_sync_status_supersede_failed_per_kind.sql) -- verified via grep
-- across ALL migrations that 20260710150000 is the last of the four defining
-- migrations (20260412094454, 20260707120000, 20260708120000, 20260710150000)
-- and that every later migration only CALLS or comments on it. Byte-identical to
-- that definition: the signature, SECURITY DEFINER, SET search_path =
-- public, pg_catalog, branch (d)'s early return, branch (b)'s PER-KIND
-- `d.kind = f.kind` + immutable `d.created_at > f.created_at` supersession (F-3 /
-- PUB-02 -- dropping either re-opens the resubmit-poison), BOTH
-- `OR strategy_analytics.computation_warned` marker reads in branches (a) and (c)
-- (dropping either re-opens the SI-02 failed_final-bounce launder), and the
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated. NO new GRANT is added.
--
-- THE ONLY SEMANTIC DELTA is computing_started_at maintenance:
--   * branch (a) stamps it CONDITIONALLY, via a three-arm CASE keyed off the
--     RESOLVED status (branch (a) can resolve to complete_with_warnings, so the
--     branch is NOT the key);
--   * branches (b) and (c) -- the two SQL exit transitions -- clear it to NULL.
--
-- Assigning now() to the stamp UNCONDITIONALLY in branch (a) would be the Phase
-- 106 bug re-implemented in a new column: the bridge is PERFORMed in-RPC on
-- EVERY job transition, so the stamp would reset on every hop of a multi-hop
-- chain and the reaper would NEVER fire -- while still passing a naive "the
-- writer sets the stamp" gate. STEP 7 below carries a NEGATIVE anchor against
-- exactly that byte sequence. This paragraph deliberately does NOT spell the
-- sequence out: prose must never satisfy or trip a mechanical gate, and the
-- shape greps that guard this file scan the whole text, comments included.

BEGIN;
SET lock_timeout = '5s';

-- --------------------------------------------------------------------------
-- STEP 1: JOB-01 DDL -- the dedicated stamp column
-- --------------------------------------------------------------------------
-- Nullable, NO DEFAULT, NO SET NOT NULL. A `NOT NULL DEFAULT now()` here would
-- be a 23502 timebomb against every existing writer that upserts
-- strategy_analytics without the column (migration-reviewer #6), and a DEFAULT
-- now() would silently stamp rows that are not computing at all.
ALTER TABLE public.strategy_analytics
  ADD COLUMN IF NOT EXISTS computing_started_at timestamptz;

COMMENT ON COLUMN public.strategy_analytics.computing_started_at IS
  'JOB-01 (Phase 142): when the CURRENT computation entered '
  'computation_status = ''computing''. NULL means "not currently computing" -- '
  'it is cleared on every exit from computing (to complete, '
  'complete_with_warnings, or failed). Every writer that sets '
  'computation_status = ''computing'' MUST set this in the SAME statement; that '
  'co-location is enforced by a static CI invariant, not a CHECK constraint (a '
  'missed writer must be a red build, not a 23514 on the live money path). '
  'computed_at is NOT a substitute: the status bridge re-stamps computed_at = '
  'now() on every job transition (never reap) and the Python runner omits it on '
  'the computing entry-write so it holds the prior run''s value (reap '
  'instantly). Read by the reap_strategy_analytics_stuck_computing pg_cron job. '
  'A ''computing'' row with a NULL stamp is a writer bug and is SKIPPED by the '
  'reaper, never reaped.';

-- --------------------------------------------------------------------------
-- STEP 2: one-shot backfill -- MUST precede cron.schedule below
-- --------------------------------------------------------------------------
-- Ordering is load-bearing. Any row already at 'computing' when this applies has
-- a NULL stamp and would be skipped by the reaper FOREVER. Anchor it to
-- computed_at (the ONE-SHOT anchor only -- see the header for why it is wrong as
-- the ongoing key). The IS NULL guard makes re-apply a no-op, mirroring the
-- IS DISTINCT FROM idiom at 20260708120000 lines 60-63. Expected to touch 0 rows
-- given the authoring-time census in the header.
UPDATE public.strategy_analytics
   SET computing_started_at = computed_at
 WHERE computation_status = 'computing'
   AND computing_started_at IS NULL;

-- --------------------------------------------------------------------------
-- STEP 3: partial index supporting the reaper's predicate + ordering
-- --------------------------------------------------------------------------
-- Plain (NON-CONCURRENT) on purpose: CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block (migration-reviewer #5) and this file is transactional per
-- repo convention. Safe here -- strategy_analytics holds one row per strategy
-- (39 rows on PROD at authoring time) and the partial predicate keeps the index
-- to the 'computing' subset only, so the ACCESS EXCLUSIVE window is brief.
CREATE INDEX IF NOT EXISTS idx_strategy_analytics_computing_started
  ON public.strategy_analytics (computing_started_at)
  WHERE computation_status = 'computing';

-- --------------------------------------------------------------------------
-- STEP 4: re-base sync_strategy_analytics_status (see header re-base contract)
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
  v_latest_error       TEXT;
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

  IF v_nonterminal_count > 0 THEN
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

  -- (b) all terminal, any NON-SUPERSEDED failed_final → 'failed' with latest error.
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
  -- This write does NOT touch computation_warned — the runner-owned marker survives
  -- the 'failed' bounce in its own column, so branch (c) can recover the warning
  -- after a sibling failed_final→done recovery WITHOUT an analytics re-run (SI-02,
  -- closed by mig 20260708120000).
  SELECT count(*) INTO v_failed_count
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
     );

  IF v_failed_count > 0 THEN
    SELECT f.last_error
      INTO v_latest_error
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
     ORDER BY f.created_at DESC
     LIMIT 1;

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
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any NON-SUPERSEDED failed_final → failed (with latest error), all done → complete; EXCEPT a row already at complete_with_warnings OR carrying the runner-owned computation_warned marker is preserved as complete_with_warnings in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears). SUPERSESSION (mig 20260710150000, F-3/PUB-02): a failed_final poisons the strategy ONLY when NOT superseded by a strictly-later done of the SAME (strategy_id, kind), keyed on the immutable created_at. Fresh-ledger re-onboard of a failed member key = RE-ENQUEUE a fresh compute job (enqueue dedup is in-flight-only, so a resubmit inserts a fresh generation while the stale failed_final is retained for audit); the bridge then ignores the same-kind-superseded failed_final. NEVER retry in place; NEVER delete queue history. Per-kind scoping keeps a real permanent failure poisoning across a later done of a DIFFERENT kind (cross-kind SAFETY). Supersedes held PR fix/sync-status-superseded-failed (229d80fa), which was cross-kind-blind and updated_at-keyed. COMPUTING_STARTED_AT (mig 20260802120000, JOB-01): branch (a) maintains strategy_analytics.computing_started_at with a three-arm CASE keyed off the RESOLVED status — stamp now() only on a genuine transition INTO computing, KEEP the existing stamp when the row is already computing (so repeated bridge calls on a multi-hop chain cannot defer the reap), and clear to NULL when the branch resolves to complete_with_warnings; branches (b) and (c) clear it to NULL as exit transitions. An unconditional stamp would re-implement the Phase 106 janitor bug in a new column. no rows → no-op (preserve existing). Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000 + 20260708120000 + 20260710150000 + 20260802120000.';

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- --------------------------------------------------------------------------
-- STEP 5: JOB-02 -- schedule the stuck-'computing' reaper
-- --------------------------------------------------------------------------
-- Fail loud if pg_cron is absent (never a silent skip -- a migration RAISEs).
DO $$
DECLARE
  v_has_pg_cron BOOLEAN;
BEGIN
  SELECT EXISTS(SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
    INTO v_has_pg_cron;

  IF NOT v_has_pg_cron THEN
    RAISE EXCEPTION
      'JOB-02: pg_cron extension is NOT installed. The strategy_analytics stuck-computing reaper cannot be scheduled. Install pg_cron via Supabase Dashboard -> Database -> Extensions and re-run.'
      USING ERRCODE = 'feature_not_supported';
  END IF;

  -- Idempotent unschedule-then-schedule.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing') THEN
    PERFORM cron.unschedule('reap_strategy_analytics_stuck_computing');
  END IF;

  -- Body is an INLINE FIXED LITERAL: no function, no interpolation, no dynamic
  -- SQL, and schema-qualified to public.* so resolution is independent of the
  -- cron session search_path. No function means no SECURITY DEFINER surface, no
  -- EXECUTE grant to revoke, and no caller-suppliable threshold.
  --
  -- The SET list is FOUR columns, and all four are load-bearing:
  --   computation_status   -- JOB-02's named terminal state (no new enum value).
  --   computation_warned   -- SI-02: every other terminal-'failed' writer clears
  --                           this. Omitting it lets the status bridge launder
  --                           the reap into complete_with_warnings on the next
  --                           call -- a FALSE SUCCESS on a money surface, which
  --                           is strictly worse than the spinner being fixed.
  --   computation_error    -- fixed literal (below). It must not re-attribute
  --                           fault: it renders as a `Details:` line UNDER the
  --                           already-shipped GATE_ANALYTICS_FAILED copy, which
  --                           already says the fault is ours. It makes no claim
  --                           about how much prior work completed and names no
  --                           identifier, row data, or internal component.
  --   computing_started_at -- the reaper is itself an exit transition, so it
  --                           obeys the same clear-on-exit rule as the bridge.
  --
  -- Predicate safety, in order:
  --   computation_status = 'computing'  -- only stranded rows are in scope.
  --   computing_started_at IS NOT NULL  -- a NULL stamp is a WRITER bug, not a
  --                                        stranded job. SKIP it; never reap it.
  --   computing_started_at < now() - interval '16 hours'  -- debounce (see header).
  --   NOT EXISTS (active compute_jobs)  -- THE safety conjunct. A healthy
  --                                        in-flight chain always has a
  --                                        non-terminal row. The status list is
  --                                        byte-identical to the bridge's branch
  --                                        (a) list above, which is the
  --                                        definition of "active" everywhere else.
  --
  -- Bounded run (no in-repo precedent for a bounded reaping UPDATE -- the other
  -- six pg_cron janitors are unbounded DELETEs, so this shape is written from
  -- first principles and deserves extra review weight):
  --   ORDER BY computing_started_at ASC  -- deterministic, oldest-stranded first.
  --   LIMIT 25                           -- drains 100 rows/hour at */15, so a
  --                                         backlog cannot blow the cron slot or
  --                                         hold locks for an unbounded window.
  --   FOR UPDATE SKIP LOCKED             -- never block a live writer holding the
  --                                         row; skip and take it next tick.
  -- The outer `AND sa.computation_status = 'computing'` is a compare-and-set
  -- fence: if a real writer terminalizes the row between the subselect and the
  -- UPDATE, the reaper writes nothing.
  --
  -- The body NEVER references computed_at or updated_at (both are wrong keys --
  -- see header; strategy_analytics has no updated_at column at all) and NEVER
  -- re-enqueues (that is JOB-04, Phase 143). Terminalize only.
  PERFORM cron.schedule(
    'reap_strategy_analytics_stuck_computing',
    '*/15 * * * *',
    $cron$
    UPDATE public.strategy_analytics sa
       SET computation_status   = 'failed',
           computation_warned   = FALSE,
           computation_error    = 'Analytics was interrupted before it could finish and did not recover. Retry the sync.',
           computing_started_at = NULL
     WHERE sa.strategy_id IN (
             SELECT s.strategy_id
               FROM public.strategy_analytics s
              WHERE s.computation_status = 'computing'
                AND s.computing_started_at IS NOT NULL
                AND s.computing_started_at < now() - interval '16 hours'
                AND NOT EXISTS (
                      SELECT 1
                        FROM public.compute_jobs cj
                       WHERE cj.strategy_id = s.strategy_id
                         AND cj.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
                    )
              ORDER BY s.computing_started_at ASC
              LIMIT 25
              FOR UPDATE SKIP LOCKED
           )
       AND sa.computation_status = 'computing';
    $cron$
  );

  RAISE NOTICE 'JOB-02: reap_strategy_analytics_stuck_computing scheduled (every 15 minutes, 16-hour staleness threshold, LIMIT 25 per tick).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 6: self-verify -- column shape (JOB-01)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_atttypid   OID;
  v_attnotnull BOOLEAN;
  v_atthasdef  BOOLEAN;
BEGIN
  SELECT a.atttypid, a.attnotnull, a.atthasdef
    INTO v_atttypid, v_attnotnull, v_atthasdef
    FROM pg_attribute a
   WHERE a.attrelid = 'public.strategy_analytics'::regclass
     AND a.attname = 'computing_started_at'
     AND NOT a.attisdropped;

  IF v_atttypid IS NULL THEN
    RAISE EXCEPTION 'JOB-01 verification failed: strategy_analytics.computing_started_at column missing after ADD COLUMN';
  END IF;
  IF v_atttypid <> 'timestamptz'::regtype THEN
    RAISE EXCEPTION 'JOB-01 verification failed: strategy_analytics.computing_started_at is not timestamptz';
  END IF;
  IF v_attnotnull THEN
    RAISE EXCEPTION 'JOB-01 verification failed: strategy_analytics.computing_started_at is NOT NULL (a 23502 timebomb against existing writers); it must be nullable';
  END IF;
  IF v_atthasdef THEN
    RAISE EXCEPTION 'JOB-01 verification failed: strategy_analytics.computing_started_at carries a DEFAULT; it must have none, or rows that are not computing get stamped';
  END IF;

  -- The supporting partial index must exist (the reaper orders on this column).
  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'idx_strategy_analytics_computing_started'
  ) THEN
    RAISE EXCEPTION 'JOB-01 verification failed: idx_strategy_analytics_computing_started missing';
  END IF;

  RAISE NOTICE 'JOB-01: computing_started_at column shape verified (timestamptz, nullable, no default) and partial index present.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 7: self-verify -- bridge body (JOB-01 stamp + retained re-base anchors)
-- --------------------------------------------------------------------------
DO $$
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
    RAISE EXCEPTION 'JOB-01 verification failed: sync_strategy_analytics_status lost SECURITY DEFINER in the re-base';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'JOB-01 verification failed: sync_strategy_analytics_status lost its pinned search_path in the re-base';
  END IF;

  -- THIS migration's fail-without-fix anchors: the stamp must be CONDITIONAL.
  IF v_fn !~* 'computing_started_at\s*=\s*CASE' THEN
    RAISE EXCEPTION 'JOB-01 verification failed: branch (a) does not maintain computing_started_at with a conditional CASE';
  END IF;
  IF v_fn !~* 'computation_status\s+IS\s+DISTINCT\s+FROM\s+''computing''' THEN
    RAISE EXCEPTION 'JOB-01 verification failed: branch (a) stamp does not test the prior status with IS DISTINCT FROM (the transition-in arm is missing)';
  END IF;

  -- NEGATIVE anchor: the C-3 trap. An unconditional stamp resets on every hop of
  -- a multi-hop chain, so the reaper never fires while a naive writer-sets-the-
  -- stamp gate stays green. The conditional form never emits this byte sequence.
  IF v_fn ~* 'computing_started_at\s*=\s*now\(\)' THEN
    RAISE EXCEPTION 'JOB-01 verification failed: branch (a) stamps computing_started_at UNCONDITIONALLY (= now()); that is the Phase 106 janitor bug in a new column — the reaper would never fire';
  END IF;

  -- Retained 20260710150000 anchors: the re-base must not silently revert F-3 /
  -- PUB-02 (per-kind, immutable created_at) or the SI-02 marker reads.
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'JOB-01 re-base failed: branch (b) lost the per-kind supersession scope (d.kind = f.kind missing — F-3/PUB-02 reverted)';
  END IF;
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'JOB-01 re-base failed: branch (b) lost the immutable created_at supersession key (F-3/PUB-02 reverted)';
  END IF;
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'JOB-01 re-base failed: branches (a)/(c) lost the computation_warned marker read (the SI-02 failed_final-bounce launder re-opens)';
  END IF;

  RAISE NOTICE 'JOB-01: sync_strategy_analytics_status re-base verified (conditional stamp, no unconditional now(), F-3/PUB-02 and SI-02 anchors intact).';
END $$;

-- --------------------------------------------------------------------------
-- STEP 8: self-verify -- the deployed cron job (JOB-02 / JOB-03)
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_command  TEXT;
  v_schedule TEXT;
BEGIN
  SELECT command, schedule
    INTO v_command, v_schedule
    FROM cron.job WHERE jobname = 'reap_strategy_analytics_stuck_computing';

  IF v_command IS NULL THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reap_strategy_analytics_stuck_computing cron job missing after schedule';
  END IF;

  -- STRING equality, never a ::INT cast on a schedule field: the hour field here
  -- is '*' and casting it would error.
  IF v_schedule IS DISTINCT FROM '*/15 * * * *' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper cron schedule is not the expected */15 * * * * cadence';
  END IF;

  -- Positive anchors on the DEPLOYED body.
  IF v_command NOT ILIKE '%public.strategy_analytics%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body is not schema-qualified to public.strategy_analytics';
  END IF;
  IF v_command NOT ILIKE '%computing_started_at%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body does not key on computing_started_at';
  END IF;
  IF v_command NOT ILIKE '%computation_warned%' THEN
    RAISE EXCEPTION 'JOB-02/SI-02 verification failed: reaper body does not clear computation_warned; the status bridge would launder the reap into complete_with_warnings (a false success on a money surface)';
  END IF;
  IF v_command NOT ILIKE '%done_pending_children%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body does not carry the full non-terminal compute_jobs status list (the active-job safety conjunct is wrong)';
  END IF;
  IF v_command NOT ILIKE '%skip locked%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body is not bounded with FOR UPDATE SKIP LOCKED';
  END IF;
  IF v_command NOT ILIKE '%limit%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body has no LIMIT; an unbounded reaping UPDATE can hold locks across the table during a backlog';
  END IF;
  IF v_command NOT ILIKE '%interval ''16 hours''%' THEN
    RAISE EXCEPTION 'JOB-03 verification failed: reaper body does not carry the 16-hour threshold from services/job_worker.py STRATEGY_ANALYTICS_REAP_THRESHOLD';
  END IF;

  -- NEGATIVE anchors.
  IF v_command ILIKE '%computed_at%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body references computed_at, which the status bridge re-stamps on every job transition — the row would never be reaped (the Phase 106 janitor bug)';
  END IF;
  IF v_command ILIKE '%updated_at%' THEN
    RAISE EXCEPTION 'JOB-02 verification failed: reaper body references updated_at, a column strategy_analytics does not have (the deleted one-off script raised 42703 on exactly this)';
  END IF;
  IF v_command ILIKE '%interval ''4 hours''%' THEN
    RAISE EXCEPTION 'JOB-03 verification failed: reaper body carries the compute_jobs orphaned-running 4-hour window; that is a different mechanism on a different table and must not be copied here';
  END IF;

  RAISE NOTICE 'JOB-02/JOB-03: reap_strategy_analytics_stuck_computing self-verify passed (cadence, bounded predicate, four-column SET, 16-hour threshold pinned).';
END $$;

COMMIT;
