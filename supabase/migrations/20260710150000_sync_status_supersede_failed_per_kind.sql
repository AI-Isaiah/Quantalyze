-- Migration: close the mig-038 resubmit-poison (F-3) with a per-(strategy,kind)
-- created_at supersession in the shared status bridge (PUB-02, v1.9, 2026-07-10)
-- =============================================================================
-- Root cause (Phase 86 F-3, VERIFIED REAL)
-- ----------------------------------------
-- sync_strategy_analytics_status branch (b) counted ANY compute_jobs row at
-- status='failed_final' as poisoning the strategy → computation_status='failed',
-- unconditionally, before branch (c). But enqueue dedups on IN-FLIGHT statuses
-- only (pending / running / done_pending_children — _enqueue_compute_job_internal
-- + the partial unique indexes, 20260411144407:179-187,377-439). A resubmit AFTER
-- a permanent failure therefore inserts a FRESH job generation while the prior
-- failed_final row PERSISTS. The worker writes computation_status='complete', then
-- mark_compute_job_done's in-RPC PERFORM sync_strategy_analytics_status re-derives
-- 'failed' from the stale failed_final and OVERWRITES it. A successful fresh-ledger
-- re-onboard reads 'failed' FOREVER and the recovered composite can NEVER publish.
-- mig-038 (20260708120000 header lines ~46-48) documented this as a deliberately-
-- deferred hazard ("branch (b)'s 'any failed_final → failed' poisons retry-after-
-- failure … WATCHED … not touched here"). It affects ALL job kinds.
--
-- Fix (this migration) — PER-(strategy,kind) created_at supersession in branch (b)
-- --------------------------------------------------------------------------------
-- A failed_final poisons the strategy ONLY when it is NOT superseded by a
-- strictly-later 'done' job of the SAME (strategy_id, kind). Both of branch (b)'s
-- failed_final selects (the count(*) poison guard AND the last_error lookup) gain a
-- `NOT EXISTS (SELECT 1 FROM compute_jobs d WHERE d.strategy_id = f.strategy_id AND
-- d.kind = f.kind AND d.status = 'done' AND d.created_at > f.created_at)` guard, and
-- the last_error lookup re-orders `ORDER BY f.created_at DESC` (mig-038 used
-- updated_at DESC) to match the supersession key. Two load-bearing choices:
--   * PER-KIND (`d.kind = f.kind`): a later done of a DIFFERENT kind can NEVER mask
--     a real permanent failure and launder a broken strategy toward publish. This
--     is the cross-kind-blindness (migration-reviewer HIGH) that killed the held PR
--     fix/sync-status-superseded-failed (229d80fa) — this migration SUPERSEDES it.
--   * IMMUTABLE created_at (strict `>`): updated_at is trigger-stamped now() on
--     EVERY update (compute_jobs_set_updated_at, 20260411144407:254-269), so it is
--     NOT a stable generation key; created_at (insert time, no trigger) is.
--
-- The fresh-ledger re-onboard path (PUB-02, documentation-of-record — also on the
-- COMMENT ON FUNCTION below): to re-onboard a failed member key, RE-ENQUEUE a fresh
-- compute job (enqueue dedup is in-flight-only, so this inserts a fresh generation
-- while the stale failed_final is retained for audit). The bridge then IGNORES the
-- same-kind-superseded failed_final the moment the fresh generation completes.
-- NEVER retry a failed job in place; NEVER DELETE queue history (a Rule-6 bandaid,
-- DISALLOWED).
--
-- Re-based verbatim on the SOLE live CREATE OR REPLACE of this function
-- (20260708120000_sync_status_failed_final_bounce.sql / mig-038) — verified via
-- grep across ALL migrations that every later migration only CALLS it. Branches
-- (a), (c), (d), the SECURITY DEFINER posture, search_path, and REVOKE are
-- byte-identical to that definition — INCLUDING both `OR strategy_analytics.
-- computation_warned` marker reads in branches (a)/(c) (dropping either re-opens
-- the SI-02 failed_final-bounce launder). ONLY branch (b) diverges.
--
-- Files that do NOT change (SC-4 neutrality evidence): _enqueue_compute_job_internal,
-- the partial unique dedup indexes, the compute_jobs.status CHECK,
-- mark_compute_job_done/failed, analytics-service/services/job_worker.py,
-- src/lib/strategyGate.ts, src/app/api/admin/strategy-review/route.ts. A never-failed
-- strategy has zero failed_final rows ⇒ branch (b) never fires ⇒ output identical by
-- algebra to mig-038 (pinned by test Part 4). The failed-then-recovered-same-kind
-- single-key case CHANGES (stuck-'failed' → 'complete') — an INTENDED strict bugfix
-- (closes the P72 canary class), pinned safe by the cross-kind SAFETY test (Part 3).
--
-- PROD-AUTO-APPLY: this SECURITY-DEFINER bridge is in the PERFORM tail of
-- mark_compute_job_done/failed for EVERY kind and auto-applies to PROD on merge
-- (khslejtfbuezsmvmtsdn). PROD already holds real failed_final rows (P72 canary);
-- any strategy whose failure is superseded by a later same-kind done will lazily
-- FLIP from 'failed' to 'complete[_with_warnings]' on its next bridge call —
-- expected + desired (the bridge re-derives lazily; no data migration writes rows).

BEGIN;

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
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'computing', NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = CASE
             WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                  OR strategy_analytics.computation_warned
             THEN 'complete_with_warnings'
             ELSE 'computing'
           END,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b) all terminal, any NON-SUPERSEDED failed_final → 'failed' with latest error.
  -- PER-(strategy,kind) created_at SUPERSESSION (F-3 / PUB-02 close, this migration):
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

    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'failed', v_latest_error)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (c) all rows 'done' → terminal SUCCESS. PRESERVE an existing
  -- 'complete_with_warnings' OR a runner-owned computation_warned marker (a
  -- more-informative success the analytics worker already wrote — the marker
  -- read is what closes the failed_final-bounce launder, since branch (b) may
  -- have bounced computation_status to 'failed' in between); otherwise resolve
  -- to 'complete'. Clears any stale computation_error either way.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'complete', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = CASE
           WHEN strategy_analytics.computation_status = 'complete_with_warnings'
                OR strategy_analytics.computation_warned
           THEN 'complete_with_warnings'
           ELSE 'complete'
         END,
         computation_error  = NULL,
         computed_at        = now();
END;
$$;

COMMENT ON FUNCTION sync_strategy_analytics_status IS
  'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any NON-SUPERSEDED failed_final → failed (with latest error), all done → complete; EXCEPT a row already at complete_with_warnings OR carrying the runner-owned computation_warned marker is preserved as complete_with_warnings in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears). SUPERSESSION (mig 20260710150000, F-3/PUB-02): a failed_final poisons the strategy ONLY when NOT superseded by a strictly-later done of the SAME (strategy_id, kind), keyed on the immutable created_at. Fresh-ledger re-onboard of a failed member key = RE-ENQUEUE a fresh compute job (enqueue dedup is in-flight-only, so a resubmit inserts a fresh generation while the stale failed_final is retained for audit); the bridge then ignores the same-kind-superseded failed_final. NEVER retry in place; NEVER delete queue history. Per-kind scoping keeps a real permanent failure poisoning across a later done of a DIFFERENT kind (cross-kind SAFETY). Supersedes held PR fix/sync-status-superseded-failed (229d80fa), which was cross-kind-blind and updated_at-keyed. no rows → no-op (preserve existing). Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000 + 20260708120000 + 20260710150000.';

REVOKE ALL ON FUNCTION sync_strategy_analytics_status FROM PUBLIC, anon, authenticated;

-- Self-verifying DO block: structure + the marker-read behavior + THIS migration's
-- per-kind + created_at supersession anchors. Every RAISE format string a single
-- literal (Phase 85 invariant #21).
DO $$
DECLARE
  v_secdef BOOLEAN;
  v_search_path TEXT;
  v_fn TEXT := pg_get_functiondef('sync_strategy_analytics_status(uuid)'::regprocedure);
BEGIN
  SELECT COALESCE(
    (SELECT p.prosecdef FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
      LIMIT 1), FALSE)
  INTO v_secdef;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'supersede-failed migration failed: sync_strategy_analytics_status is not SECURITY DEFINER';
  END IF;

  SELECT array_to_string(p.proconfig, ',')
    INTO v_search_path
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'sync_strategy_analytics_status'
   LIMIT 1;
  IF v_search_path IS NULL OR v_search_path NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'supersede-failed migration failed: search_path not set';
  END IF;

  -- THIS migration's fail-without-fix anchors: branch (b) must scope supersession
  -- PER-KIND and key it on the immutable created_at (else cross-kind failures are
  -- masked / generation ordering is non-deterministic).
  IF v_fn !~* 'd\.kind\s*=\s*f\.kind' THEN
    RAISE EXCEPTION 'supersede-failed migration failed: branch (b) does not scope supersession per-kind (d.kind = f.kind missing)';
  END IF;
  IF v_fn !~* 'd\.created_at\s*>\s*f\.created_at' THEN
    RAISE EXCEPTION 'supersede-failed migration failed: branch (b) does not key supersession on the immutable created_at (d.created_at > f.created_at missing)';
  END IF;

  -- The marker read must be present in BOTH preserving branches (else the
  -- failed_final-bounce launder re-opens — Pitfall 3).
  IF v_fn !~* 'OR\s+strategy_analytics\.computation_warned' THEN
    RAISE EXCEPTION 'supersede-failed migration failed: branches (a)/(c) do not read computation_warned (marker CASE missing)';
  END IF;

  -- The marker column must exist (the bridge reads it).
  IF NOT EXISTS(
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.strategy_analytics'::regclass
       AND attname = 'computation_warned'
       AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'supersede-failed migration failed: strategy_analytics.computation_warned column missing';
  END IF;

  -- strategy_analytics still has the UNIQUE/PK constraint on strategy_id.
  IF NOT EXISTS(
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'strategy_analytics'
      AND c.contype IN ('u', 'p')
      AND c.conkey = (
        SELECT array_agg(attnum)
          FROM pg_attribute
         WHERE attrelid = t.oid
           AND attname = 'strategy_id'
      )
  ) THEN
    RAISE EXCEPTION 'supersede-failed migration failed: strategy_analytics.strategy_id has no UNIQUE/PK constraint — ON CONFLICT clauses will break';
  END IF;

  RAISE NOTICE 'sync_strategy_analytics_status now supersedes a stale failed_final per-(strategy,kind) on the immutable created_at; F-3 resubmit-poison closed (PUB-02), cross-kind SAFETY preserved, computation_warned marker intact.';
END
$$;

COMMIT;
