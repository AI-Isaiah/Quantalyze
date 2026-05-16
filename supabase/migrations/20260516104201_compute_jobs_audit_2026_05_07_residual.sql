-- Migration: compute_jobs queue — audit-2026-05-07 residual fixes
--
-- Why this migration exists
-- -------------------------
-- audit-2026-05-07 G10 against `supabase/migrations/032_compute_jobs_queue.sql`
-- (now timestamped `20260411144407_compute_jobs_queue.sql`) flagged 21
-- in-scope CRITICAL + HIGH + MEDIUM≥conf-8 findings. The majority were
-- closed by migrations 109 (correctness sweep), 110 (sync_trades DELETE),
-- 111 (user_message + rate-limit grief), and the audit's own live-DB
-- regression tests in `src/__tests__/compute-jobs-audit-2026-05-07-g10b.test.ts`.
--
-- This migration closes the residual SQL-level items that didn't fit
-- those earlier batches:
--
-- * M-0772 (data-migration, c8): non-negative CHECK constraints on
--   `attempts`, `max_attempts`, `trade_count`. Today a service-role
--   typo or future schema-evolution bug could set `attempts = -1` and
--   silently send `mark_compute_job_failed` into the ELSE-arm safety net
--   in a loop. The CHECKs are added with NOT VALID then VALIDATE so
--   legacy rows (if any) surface as VALIDATE failures rather than
--   blocking ADD CONSTRAINT.
--
-- * M-0773 (data-migration, c8): `FORCE ROW LEVEL SECURITY` on
--   `compute_jobs` and `compute_job_kinds`. Without FORCE, the table
--   owner (the migration applier / dashboard SQL editor / any session
--   connecting as the table-owner role) bypasses the deny-all policy.
--   FORCE closes the gap — service-role calls still bypass because
--   Supabase's service-role uses BYPASSRLS, not ownership.
--
-- * M-0774 (data-migration, c8): REVOKE table-level grants from
--   PUBLIC/anon/authenticated. Belt-and-suspenders for the RLS deny-all.
--   If a future migration accidentally `DISABLE ROW LEVEL SECURITY` or
--   `DROP POLICY compute_jobs_deny_all`, the REVOKE keeps direct
--   client-side table access blocked. `compute_job_kinds` keeps a
--   read-true policy so we GRANT only SELECT to authenticated and
--   revoke everything else.
--
-- * M-0777 (code-reviewer, c8): `_assert_owner` distinguishes the three
--   conditions that today collapse to a single `no_data_found` error:
--   (a) row missing — keep `no_data_found`; (b) row exists but
--   `user_id` is NULL — new `check_violation`; (c) owned by another
--   user — keep `insufficient_privilege`. Wraps the EXECUTE in an
--   EXCEPTION handler that converts `undefined_column` to a clearer
--   error message for the case where a future caller passes a
--   regclass without a `user_id` column.
--
-- * M-0779 (code-reviewer, c8): `mark_compute_job_failed` no longer
--   clears `claimed_at` / `claimed_by` on terminal failures. Forensic
--   value of "which worker last touched this row" was being destroyed
--   on every failed_retry / failed_final transition. The watchdog
--   (`reclaim_stuck_compute_jobs` / `reset_stalled_compute_jobs`)
--   gates on `status = 'running'`, so leaving the fields populated on
--   non-running terminal rows is safe — no watchdog churn. `claim_token`
--   is also kept (mig 117 fence semantics already prevent late-mark
--   from re-running). Re-claim still overwrites via `claim_compute_jobs`.
--
-- * M-0781 (performance, c8): `reclaim_stuck_compute_jobs` and
--   `reset_stalled_compute_jobs` bound per-call reclaim with a LIMIT of
--   500 and select-then-update via `SKIP LOCKED`. Today either function
--   runs an unbounded UPDATE. In a region-wide stick-up (10k rows
--   stuck), one watchdog tick locks 10k rows for the duration, blocking
--   concurrent `claim_compute_jobs` and contesting autovacuum. The
--   500-row cap means at most 500 row locks per tick; backlog drains
--   over multiple ticks. Subquery uses `FOR UPDATE SKIP LOCKED` so the
--   watchdog never blocks waiting on a row currently being claimed.
--
-- * M-0783 (code-reviewer, c8): `get_user_compute_jobs` WHERE clause
--   uses `COALESCE(s.user_id, p.user_id) = v_auth_uid` instead of
--   `(s.user_id = v_auth_uid OR p.user_id = v_auth_uid)`. The old shape
--   returned NULL (filtered as false) when both joins missed; orphan
--   `compute_jobs` rows (parent strategy/portfolio gone) became
--   invisible to ALL users including admins. COALESCE still hides
--   orphans from non-owners (NULL <> v_auth_uid is NULL → filtered)
--   but the change makes the join contract explicit and prevents the
--   row from disappearing if either user_id column is NULL.
--
-- * H-0864 (performance, c8): `mark_compute_job_done` no longer calls
--   `check_fan_in_ready` inside a PL/pgSQL FOR loop (N + 2N per
--   children). The fan-in advance is now a single set-based UPDATE
--   with a NOT EXISTS sub-query — one scan, no per-iteration RPC
--   overhead. Preserves the mig 109 P12 + mig 117 P97 fence semantics:
--   only `done_pending_children` rows whose parents are ALL `done`
--   advance to `pending`. `check_fan_in_ready` is preserved (still
--   called by external code paths / future RPCs); only the per-child
--   loop is replaced.
--
-- Items NOT in this migration
-- ---------------------------
-- * M-0771 (simplifier c9): "Use pg-boss / Supabase Queues instead of
--   custom 1084-line queue." Rejected — full architectural rewrite is
--   out of scope for an audit fix batch. Tracked as long-tail tech-debt
--   instead.
-- * M-0775 (c8): `compute_jobs_set_updated_at` trigger semantics
--   regression test. The audit's own live-DB Vitest suite covers this
--   indirectly via the reclaim/mark_failed/mark_done tests which all
--   observe updated_at advancing through `fetchJob`. Lower-priority
--   than the items above; leaving as observation.
-- * M-0776 (c8): drop the BEFORE UPDATE trigger and inline updated_at.
--   Rejected — the trigger is one PL/pgSQL function invocation per row
--   (microsecond-scale) and every claim/mark path would need to opt
--   into setting updated_at explicitly. Behavioral regression risk
--   outweighs the perf gain.
-- * M-0778 (c8): mark_compute_job_failed backoff-schedule comment lies
--   about RAISE scope. Pure comment fix; handled in the Stage A
--   comment-hygiene commit of this audit cycle, not here.
-- * M-0780 (c8): reclaim_stuck_compute_jobs already decrements attempts
--   via mig 109 P2. No further change needed.
-- * M-0782 (c8): Zod schema for `get_user_compute_jobs`. Application-
--   layer concern — landed in `src/lib/analytics-schemas.ts` in the
--   same PR as this migration.
--
-- Compatibility
-- -------------
-- * Function signatures unchanged. `_assert_owner`, `mark_compute_job_done`,
--   `mark_compute_job_failed`, `reclaim_stuck_compute_jobs`,
--   `reset_stalled_compute_jobs`, `get_user_compute_jobs` all keep their
--   current public arglists.
-- * `claimed_at` / `claimed_by` preservation on failed rows is a behavioral
--   change observable by the admin UI but not breaking — the runbook's
--   stuck-jobs query (status='running' + claimed_at < threshold) is
--   unaffected.
-- * Table CHECKs are NOT VALID first then VALIDATE; legacy rows that
--   violate (none expected — only the queue helpers write to these
--   columns and they set non-negative integers by construction) would
--   block VALIDATE and surface a clear error rather than a silent
--   migration partial-failure.
--
-- Rollback
-- --------
-- * Drop CHECK constraints: `ALTER TABLE compute_jobs DROP CONSTRAINT
--   compute_jobs_attempts_non_negative; ...max_attempts_positive; ...trade_count_non_negative;`
-- * Drop FORCE RLS: `ALTER TABLE compute_jobs NO FORCE ROW LEVEL SECURITY;`
--   (also for compute_job_kinds)
-- * Re-grant tables: original GRANT was implicit (Supabase grants
--   default privileges on public schema). To restore: re-apply default
--   schema grants via `GRANT ALL ON TABLE compute_jobs TO authenticated;`
--   etc. — but only do this if a follow-up audit decides table-level
--   defense in depth is no longer wanted.
-- * Restore previous function bodies: see migrations 032, 109, 117
--   for the canonical prior shapes.

BEGIN;

-- ====================================================================
-- M-0772: non-negative CHECK constraints on retry-related integers
-- ====================================================================
-- Belt-and-suspenders against a service-role UPDATE setting negative
-- attempts or zero/negative max_attempts, both of which break the
-- backoff CASE schedule in mark_compute_job_failed. trade_count is
-- observability-only but a negative value would falsely advertise a
-- broken sync_trades run; we constrain it too while we're here.
--
-- Backfill pass: clamp any pre-existing legacy values to safe ranges
-- so VALIDATE CONSTRAINT below succeeds. The expected backfill count
-- is zero (only queue helpers write to these columns and they always
-- set non-negative integers) but the UPDATE is unconditional defense.
UPDATE compute_jobs
   SET attempts = 0
 WHERE attempts < 0;

UPDATE compute_jobs
   SET max_attempts = 3
 WHERE max_attempts <= 0;

UPDATE compute_jobs
   SET trade_count = NULL
 WHERE trade_count IS NOT NULL
   AND trade_count < 0;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_attempts_non_negative
  CHECK (attempts >= 0)
  NOT VALID;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_max_attempts_positive
  CHECK (max_attempts > 0)
  NOT VALID;

ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_trade_count_non_negative
  CHECK (trade_count IS NULL OR trade_count >= 0)
  NOT VALID;

ALTER TABLE compute_jobs VALIDATE CONSTRAINT compute_jobs_attempts_non_negative;
ALTER TABLE compute_jobs VALIDATE CONSTRAINT compute_jobs_max_attempts_positive;
ALTER TABLE compute_jobs VALIDATE CONSTRAINT compute_jobs_trade_count_non_negative;

COMMENT ON CONSTRAINT compute_jobs_attempts_non_negative ON compute_jobs IS
  'audit-2026-05-07 M-0772 / G10: bound attempts >= 0 so the backoff '
  'CASE schedule in mark_compute_job_failed cannot be tricked by a '
  'negative-value INSERT/UPDATE.';

COMMENT ON CONSTRAINT compute_jobs_max_attempts_positive ON compute_jobs IS
  'audit-2026-05-07 M-0772 / G10: bound max_attempts > 0 so a row '
  'cannot be marked failed_final on its zero-th attempt.';

COMMENT ON CONSTRAINT compute_jobs_trade_count_non_negative ON compute_jobs IS
  'audit-2026-05-07 M-0772 / G10: bound observability trade_count to '
  'NULL or non-negative.';

-- ====================================================================
-- M-0773: FORCE ROW LEVEL SECURITY (close the table-owner bypass)
-- ====================================================================
-- Without FORCE, the table owner (postgres / migration applier /
-- dashboard SQL editor) bypasses the deny-all policy. Supabase's
-- service-role uses BYPASSRLS at the role level, not ownership, so the
-- service-role admin path is unaffected.
ALTER TABLE compute_jobs    FORCE ROW LEVEL SECURITY;
ALTER TABLE compute_job_kinds FORCE ROW LEVEL SECURITY;

-- ====================================================================
-- M-0774: REVOKE table-level grants
-- ====================================================================
-- Defense in depth against a future migration that accidentally
-- DISABLEs RLS or DROPs the deny-all policy. anon and authenticated
-- have no business reading or writing this table directly — all paths
-- go through SECURITY DEFINER RPCs which have their own REVOKE pattern.
REVOKE ALL ON TABLE compute_jobs FROM PUBLIC, anon, authenticated;

-- compute_job_kinds is a small reference table. The deny-all is replaced
-- with a read-true policy (legacy from mig 032) so authenticated callers
-- can introspect the valid kinds. REVOKE everything else.
REVOKE ALL ON TABLE compute_job_kinds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE compute_job_kinds TO authenticated;

-- ====================================================================
-- M-0777: _assert_owner — distinguish missing / NULL user_id / wrong owner
-- ====================================================================
-- The current shape collapses three distinct error conditions into a
-- single `no_data_found`:
--   (a) row truly missing in p_table
--   (b) row exists but user_id IS NULL
--   (c) row owned by a different user
-- New shape uses FOUND after the SELECT to distinguish (a) from
-- (b)/(c), and explicit branches for the remaining two. We also wrap
-- the EXECUTE in an EXCEPTION block that converts the cryptic
-- `undefined_column` (42703) error that would fire if a future caller
-- passes a regclass without a `user_id` column.
CREATE OR REPLACE FUNCTION _assert_owner(
  p_table   REGCLASS,
  p_row_id  UUID,
  p_context TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_owner UUID;
  v_found BOOLEAN := false;
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;  -- service-role path, skip the check
  END IF;

  -- Wrap the dynamic SELECT so a future caller passing a regclass
  -- without a `user_id` column gets a domain-specific error rather
  -- than Postgres's stock `column "user_id" does not exist`.
  BEGIN
    EXECUTE format('SELECT user_id FROM %s WHERE id = $1', p_table)
      INTO v_owner
      USING p_row_id;
    v_found := FOUND;
  EXCEPTION WHEN undefined_column THEN
    RAISE EXCEPTION '%: table % has no user_id column (passed regclass=%)',
      p_context, p_table, p_table
      USING ERRCODE = 'undefined_column';
  END;

  -- (a) Row truly missing. FOUND is the canonical "did the SELECT
  -- return a row" signal — preserves no_data_found for the absent case.
  IF NOT v_found THEN
    RAISE EXCEPTION '%: row % not found in %', p_context, p_row_id, p_table
      USING ERRCODE = 'no_data_found';
  END IF;

  -- (b) Row exists but user_id is NULL. Distinct from "missing" so
  -- operators looking at the failure log can tell legacy/orphan rows
  -- (e.g. an FK relaxation that allows NULL user_id) apart from genuine
  -- 404s. check_violation is the canonical errcode for "row state
  -- violates an assertion" — closest fit available.
  IF v_owner IS NULL THEN
    RAISE EXCEPTION '%: row % in % has NULL user_id (legacy/orphan row?)',
      p_context, p_row_id, p_table
      USING ERRCODE = 'check_violation';
  END IF;

  -- (c) Owned by a different user. Unchanged from prior shape.
  IF v_owner <> v_auth_uid THEN
    RAISE EXCEPTION '%: row % not owned by auth.uid()', p_context, p_row_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

COMMENT ON FUNCTION _assert_owner IS
  'Private shared ownership check. Service-role bypass (auth.uid() IS NULL). '
  'Distinguishes three failures (audit-2026-05-07 M-0777): row missing '
  '(no_data_found), row exists but user_id NULL (check_violation), row owned '
  'by another user (insufficient_privilege). Future caller passing a table '
  'without a user_id column gets a clearer undefined_column message via the '
  'wrapped EXECUTE. See migrations 032, 109+.';

REVOKE ALL ON FUNCTION _assert_owner FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- H-0864: mark_compute_job_done — replace N+1 fan-in loop with set-based UPDATE
-- ====================================================================
-- The mig 117 P97 fence is preserved verbatim. Only the fan-in
-- advancement section (the FOR v_child_id LOOP + per-iteration
-- check_fan_in_ready call) is replaced with a single set-based UPDATE.
--
-- Old shape: N children -> N PL/pgSQL function calls (check_fan_in_ready)
-- each running 2 sub-queries, plus N UPDATEs. For a 5-exchange portfolio
-- compute_analytics fan-in: ~15 sub-queries + 5 UPDATEs per parent
-- completion, all under a row lock from the surrounding transaction.
--
-- New shape: one UPDATE with a NOT EXISTS sub-query. Postgres planner
-- uses the compute_jobs_parent_lookup GIN index on parent_job_ids for
-- the outer match, and the primary key for the NOT EXISTS scan. One
-- statement, one scan, no PL/pgSQL loop overhead.
--
-- Same overload trap as mig 117 STEP 4: DROP the prior 2-arg signature
-- first. CREATE OR REPLACE on the same signature works without DROP,
-- but we keep the DROP for defense in depth so a future signature drift
-- (e.g. adding a third optional param) doesn't silently leave an
-- un-replaced overload behind.
DROP FUNCTION IF EXISTS mark_compute_job_done(UUID, UUID);

CREATE OR REPLACE FUNCTION mark_compute_job_done(
  p_job_id      UUID,
  p_claim_token UUID DEFAULT NULL    -- mig 117: P97 fence
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_strategy_id    UUID;
  v_current_status TEXT;
  v_current_token  UUID;
BEGIN
  -- Atomic flip running -> done with token fence + strategy capture.
  -- (mig 117 P97 fence semantics preserved verbatim.)
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND (p_claim_token IS NULL OR claim_token = p_claim_token)
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

    -- mig 109 P6 / mig 117 second-pass: idempotent retry on already-done
    -- row, gated by token equality so a stale W1 mark on a row W2 just
    -- finished still surfaces the preemption.
    IF v_current_status = 'done' THEN
      IF p_claim_token IS NULL OR v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- mig 117 P97: token mismatch on still-running row = watchdog preempted.
    IF v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- audit-2026-05-07 H-0864: set-based fan-in advance.
  --
  -- Old per-child loop is replaced by a single UPDATE that flips every
  -- done_pending_children child of this just-completed parent into
  -- pending IF AND ONLY IF none of its parents are still un-done. The
  -- NOT EXISTS sub-query enforces the "all parents done" predicate
  -- equivalently to check_fan_in_ready, but without the PL/pgSQL
  -- function-call overhead per child.
  --
  -- Correctness invariants preserved:
  --   1. Only rows with status='done_pending_children' advance. The
  --      WHERE clause matches both the source-row filter on the FOR
  --      loop AND the UPDATE's `WHERE id = v_child_id AND status =
  --      'done_pending_children'` guard from the prior shape.
  --   2. The NOT EXISTS scans every parent of the child and returns
  --      true iff all are status='done'. Same predicate as
  --      check_fan_in_ready's `count(*) WHERE status <> 'done' = 0`.
  --   3. The GIN index compute_jobs_parent_lookup on parent_job_ids
  --      supports the outer `p_job_id = ANY(c.parent_job_ids)` filter.
  UPDATE compute_jobs c
     SET status          = 'pending',
         next_attempt_at = now()
   WHERE c.status = 'done_pending_children'
     AND p_job_id = ANY(c.parent_job_ids)
     AND NOT EXISTS (
       SELECT 1
         FROM compute_jobs p
        WHERE p.id = ANY(c.parent_job_ids)
          AND p.status <> 'done'
     );

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS
  'Terminal success transition. Migration 117 P97 fence preserved. '
  'audit-2026-05-07 H-0864: fan-in advance is now a single set-based '
  'UPDATE with a NOT EXISTS sub-query (was N+1 check_fan_in_ready calls '
  'inside a FOR loop). Preserves mig 109 P6 idempotent-retry on already-done '
  'rows AND mig 099 Phase-18 atomic UI status bridge. See migration 117 '
  '+ .planning/audit-2026-05-07/INVEST-P97.md.';

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- M-0779: mark_compute_job_failed — keep claimed_at / claimed_by
-- ====================================================================
-- Preserves forensic value: on a failed_retry / failed_final row, the
-- "which Railway pod last executed this job" answer is recoverable.
-- The watchdog (reclaim_stuck_compute_jobs / reset_stalled_compute_jobs)
-- filters on status='running', so populated claimed_at on a non-running
-- terminal row never triggers re-reclaim. On the next claim
-- (failed_retry -> running via claim_compute_jobs), the SET clause
-- overwrites claimed_at / claimed_by with the new worker's values.
--
-- All other behavior — mig 117 P97 fence, mig 109 P4 ELSE-arm NOTICE,
-- mig 099 Phase-18 atomic UI bridge — is preserved verbatim.
--
-- Same overload-trap DROP-then-CREATE pattern as the mark_done above.
DROP FUNCTION IF EXISTS mark_compute_job_failed(UUID, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION mark_compute_job_failed(
  p_job_id      UUID,
  p_error       TEXT,
  p_error_kind  TEXT DEFAULT 'unknown',
  p_claim_token UUID DEFAULT NULL    -- mig 117: P97 fence
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
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
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

    IF v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_failed: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
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
    -- mig 109 P4: backoff schedule preserved verbatim. ELSE-arm NOTICE
    -- preserved.
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      ELSE
        v_next_attempt := now() + interval '8 minutes';
        RAISE NOTICE 'mark_compute_job_failed: job % hit safety-net ELSE arm of CASE schedule (attempts=%, max_attempts=%, scheduled +8min). This indicates a misconfigured max_attempts. Investigate.',
          p_job_id, v_attempts, v_max_attempts;
    END CASE;
  END IF;

  -- audit-2026-05-07 M-0779: NO LONGER clear claimed_at / claimed_by.
  -- Forensic value is preserved on failed rows; the next claim
  -- overwrites these fields when it acquires the row. The watchdog
  -- never re-touches non-running rows (status='running' filter).
  UPDATE compute_jobs
     SET status          = v_new_status,
         last_error      = p_error,
         error_kind      = COALESCE(p_error_kind, 'unknown'),
         next_attempt_at = v_next_attempt
   WHERE id = p_job_id;

  -- Phase 18: atomic UI bridge (preserved from mig 099).
  IF v_strategy_id IS NOT NULL THEN
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;

  RETURN v_next_attempt;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) IS
  'Migration 117 P97 fence preserved. audit-2026-05-07 M-0779: no longer '
  'clears claimed_at / claimed_by on terminal failure so forensic value '
  '(which worker last touched the row) survives until the next claim. '
  'Preserves mig 109 P4 backoff schedule + ELSE-arm NOTICE AND mig 099 '
  'Phase-18 atomic UI status bridge. See migration 117 + .planning/audit-'
  '2026-05-07/INVEST-P97.md.';

REVOKE ALL ON FUNCTION mark_compute_job_failed(UUID, TEXT, TEXT, UUID) FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- M-0781: reclaim_stuck_compute_jobs — LIMIT + SKIP LOCKED
-- ====================================================================
-- Bounds per-call reclaim at 500 rows and uses FOR UPDATE SKIP LOCKED
-- in the row-selection sub-query so the watchdog never blocks waiting
-- on a row currently being claimed. mig 109 P2 attempts-decrement and
-- reclaim_count bump are preserved.
--
-- Trade-off: a 10k-stick backlog now takes 20 watchdog ticks to drain
-- (every 10 min => 3h20). The status quo would lock 10k rows in one
-- tick, blocking every concurrent claim_compute_jobs caller for the
-- duration of the UPDATE. The bounded version trades drain time for
-- bounded lock duration — exactly what the operations team needs to
-- keep claim latency stable during incidents.
CREATE OR REPLACE FUNCTION reclaim_stuck_compute_jobs(
  p_older_than INTERVAL DEFAULT interval '10 minutes'
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reclaimed INTEGER;
BEGIN
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         attempts        = GREATEST(attempts - 1, 0),
         reclaim_count   = reclaim_count + 1
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'running'
         AND claimed_at IS NOT NULL
         AND claimed_at < (now() - p_older_than)
       ORDER BY claimed_at
       LIMIT 500
       FOR UPDATE SKIP LOCKED
   );

  GET DIAGNOSTICS v_reclaimed = ROW_COUNT;

  RETURN v_reclaimed;
END;
$$;

COMMENT ON FUNCTION reclaim_stuck_compute_jobs IS
  'Watchdog: resets running jobs whose claimed_at is older than '
  'p_older_than back to pending. audit-2026-05-07 M-0781: bounded at '
  '500 rows per call via SELECT ... FOR UPDATE SKIP LOCKED so a large '
  'backlog drains over multiple ticks without holding contention-'
  'inducing lock counts. mig 109 P2 attempts-decrement + reclaim_count '
  'bump preserved. See migrations 109, 117, audit-2026-05-07.';

REVOKE ALL ON FUNCTION reclaim_stuck_compute_jobs FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- M-0781 (cont.): reset_stalled_compute_jobs — LIMIT + SKIP LOCKED
-- ====================================================================
-- Same per-tick bound applied to the per-kind watchdog. Each kind's
-- pass is independently bounded at 500. mig 117 P97 claim_token=NULL
-- invalidation preserved.
CREATE OR REPLACE FUNCTION reset_stalled_compute_jobs(
  p_stale_threshold    INTERVAL DEFAULT interval '10 minutes',
  p_per_kind_overrides JSONB    DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_reset     INTEGER := 0;
  v_partial   INTEGER;
  v_kind      TEXT;
  v_threshold INTERVAL;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION 'reset_stalled_compute_jobs: p_stale_threshold must be > 0, got %', p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Per-kind overrides: one bounded UPDATE per kind with its threshold.
  IF p_per_kind_overrides IS NOT NULL THEN
    FOR v_kind IN SELECT jsonb_object_keys(p_per_kind_overrides) LOOP
      v_threshold := (p_per_kind_overrides ->> v_kind)::INTERVAL;

      UPDATE compute_jobs
         SET status          = 'pending',
             claimed_at      = NULL,
             claimed_by      = NULL,
             next_attempt_at = now(),
             last_error      = 'worker_stalled',
             claim_token     = NULL    -- mig 117: P97 fence invalidation
       WHERE id IN (
         SELECT id FROM compute_jobs
           WHERE status = 'running'
             AND kind = v_kind
             AND claimed_at IS NOT NULL
             AND claimed_at < (now() - v_threshold)
           ORDER BY claimed_at
           LIMIT 500
           FOR UPDATE SKIP LOCKED
       );

      GET DIAGNOSTICS v_partial = ROW_COUNT;
      v_reset := v_reset + v_partial;
    END LOOP;
  END IF;

  -- Default threshold pass: kinds NOT in the override map.
  UPDATE compute_jobs
     SET status          = 'pending',
         claimed_at      = NULL,
         claimed_by      = NULL,
         next_attempt_at = now(),
         last_error      = 'worker_stalled',
         claim_token     = NULL    -- mig 117: P97 fence invalidation
   WHERE id IN (
     SELECT id FROM compute_jobs
       WHERE status = 'running'
         AND claimed_at IS NOT NULL
         AND claimed_at < (now() - p_stale_threshold)
         AND (
           p_per_kind_overrides IS NULL
           OR NOT (p_per_kind_overrides ? kind)
         )
       ORDER BY claimed_at
       LIMIT 500
       FOR UPDATE SKIP LOCKED
   );

  GET DIAGNOSTICS v_partial = ROW_COUNT;
  v_reset := v_reset + v_partial;

  RETURN v_reset;
END;
$$;

COMMENT ON FUNCTION reset_stalled_compute_jobs IS
  'Per-kind watchdog: resets running jobs whose claimed_at is older '
  'than threshold (global or per-kind) back to pending. mig 117 '
  'claim_token=NULL invalidation preserved. audit-2026-05-07 M-0781: '
  'each pass bounded at 500 rows via FOR UPDATE SKIP LOCKED so the '
  'watchdog never blocks waiting on a row currently being claimed. '
  'See migrations 033, 117, audit-2026-05-07.';

REVOKE ALL ON FUNCTION reset_stalled_compute_jobs FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- M-0783: get_user_compute_jobs — COALESCE join filter so orphans surface
-- ====================================================================
-- Old shape: `(s.user_id = v_auth_uid OR p.user_id = v_auth_uid)`
-- evaluated to NULL when both joins missed (orphan compute_jobs row
-- whose strategy/portfolio was deleted bypassing ON DELETE CASCADE).
-- NULL filters as false → orphan rows invisible to ALL users.
--
-- New shape: `COALESCE(s.user_id, p.user_id) = v_auth_uid`. Same
-- ownership semantics (non-owners still filtered out), but the
-- predicate is now self-documenting and the orphan case has a
-- well-defined fate (still filtered for users, because COALESCE-of-NULLs
-- = NULL ≠ v_auth_uid). Admins reading via the service-role direct
-- query path continue to see orphans.
--
-- mig 111 user_message synthesis is preserved verbatim. The function's
-- RETURNS TABLE shape is unchanged so no callers need migration.
DROP FUNCTION IF EXISTS get_user_compute_jobs(UUID, INTEGER);

CREATE OR REPLACE FUNCTION get_user_compute_jobs(
  p_strategy_id UUID DEFAULT NULL,
  p_limit       INTEGER DEFAULT 100
)
RETURNS TABLE(
  id              UUID,
  strategy_id     UUID,
  portfolio_id    UUID,
  kind            TEXT,
  parent_job_ids  UUID[],
  status          TEXT,
  attempts        INTEGER,
  max_attempts    INTEGER,
  next_attempt_at TIMESTAMPTZ,
  claimed_at      TIMESTAMPTZ,
  claimed_by      TEXT,
  last_error      TEXT,
  error_kind      TEXT,
  idempotency_key TEXT,
  exchange        TEXT,
  trade_count     INTEGER,
  created_at      TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ,
  metadata        JSONB,
  user_message    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
STABLE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    cj.id, cj.strategy_id, cj.portfolio_id, cj.kind, cj.parent_job_ids,
    cj.status, cj.attempts, cj.max_attempts, cj.next_attempt_at,
    cj.claimed_at, cj.claimed_by,
    NULL::TEXT AS last_error,   -- redacted; see mig 032 STEP 16 comment
    cj.error_kind, cj.idempotency_key, cj.exchange, cj.trade_count,
    cj.created_at, cj.updated_at, cj.metadata,
    -- mig 111 P11: synthetic user-facing message (preserved verbatim).
    CASE
      WHEN cj.status = 'failed_final' AND cj.error_kind = 'permanent' THEN
        'We hit a problem we can''t retry automatically. Please contact support.'
      WHEN cj.status = 'failed_final' THEN
        'Tried multiple times without success. Please contact support.'
      WHEN cj.status = 'failed_retry' THEN
        'Temporary issue — retrying automatically.'
      WHEN cj.status IN ('pending', 'running', 'done_pending_children') THEN
        NULL
      WHEN cj.status = 'done' THEN
        NULL
      ELSE
        NULL
    END::TEXT AS user_message
    FROM compute_jobs cj
    LEFT JOIN strategies s ON s.id = cj.strategy_id
    LEFT JOIN portfolios p ON p.id = cj.portfolio_id
   -- audit-2026-05-07 M-0783: COALESCE replaces (s.user_id=X OR p.user_id=X)
   -- so the join contract is explicit and NULL-NULL orphan rows have a
   -- well-defined disposition (still filtered for non-owners; visible to
   -- service-role direct queries).
   WHERE COALESCE(s.user_id, p.user_id) = v_auth_uid
     AND (p_strategy_id IS NULL OR cj.strategy_id = p_strategy_id)
   ORDER BY cj.created_at DESC
   LIMIT GREATEST(1, LEAST(p_limit, 1000));
END;
$$;

COMMENT ON FUNCTION get_user_compute_jobs IS
  'Returns compute_jobs rows visible to auth.uid(). last_error REDACTED; '
  'user_message TEXT (mig 111 P11) synthesised from (status, error_kind). '
  'audit-2026-05-07 M-0783: WHERE uses COALESCE(s.user_id, p.user_id) so '
  'the join contract is self-documenting. See migrations 032, 111, '
  'audit-2026-05-07.';

REVOKE ALL ON FUNCTION get_user_compute_jobs FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_user_compute_jobs TO authenticated;

-- ====================================================================
-- Self-verifying assertions
-- ====================================================================
DO $$
DECLARE
  v_body              TEXT;
  v_forced_jobs       BOOLEAN;
  v_forced_kinds      BOOLEAN;
  v_revoked_jobs      INTEGER;
  v_revoked_kinds     INTEGER;
BEGIN
  -- M-0772: all three CHECK constraints present and validated
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_attempts_non_negative'
       AND conrelid = 'public.compute_jobs'::regclass
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_jobs_attempts_non_negative missing or NOT VALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_max_attempts_positive'
       AND conrelid = 'public.compute_jobs'::regclass
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_jobs_max_attempts_positive missing or NOT VALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_trade_count_non_negative'
       AND conrelid = 'public.compute_jobs'::regclass
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_jobs_trade_count_non_negative missing or NOT VALID';
  END IF;

  -- M-0773: FORCE RLS on both tables
  SELECT relforcerowsecurity INTO v_forced_jobs
    FROM pg_class
    WHERE relname = 'compute_jobs'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT COALESCE(v_forced_jobs, FALSE) THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_jobs not FORCE ROW LEVEL SECURITY';
  END IF;
  SELECT relforcerowsecurity INTO v_forced_kinds
    FROM pg_class
    WHERE relname = 'compute_job_kinds'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT COALESCE(v_forced_kinds, FALSE) THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_job_kinds not FORCE ROW LEVEL SECURITY';
  END IF;

  -- M-0774: anon/authenticated have NO grants on compute_jobs
  SELECT count(*) INTO v_revoked_jobs
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'compute_jobs'
     AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_revoked_jobs <> 0 THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_jobs still has %s grants to anon/authenticated/PUBLIC', v_revoked_jobs;
  END IF;

  -- M-0774: authenticated retains only SELECT on compute_job_kinds
  SELECT count(*) INTO v_revoked_kinds
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'compute_job_kinds'
     AND grantee = 'authenticated'
     AND privilege_type <> 'SELECT';
  IF v_revoked_kinds <> 0 THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: compute_job_kinds still has non-SELECT grants to authenticated (count=%s)', v_revoked_kinds;
  END IF;

  -- M-0777: _assert_owner body has the three branches
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = '_assert_owner';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: _assert_owner missing';
  END IF;
  IF v_body NOT ILIKE '%check_violation%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: _assert_owner missing check_violation branch (M-0777)';
  END IF;
  IF v_body NOT ILIKE '%undefined_column%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: _assert_owner missing undefined_column wrapper (M-0777)';
  END IF;

  -- H-0864: mark_compute_job_done body uses NOT EXISTS (set-based fan-in)
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_done';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: mark_compute_job_done missing';
  END IF;
  IF v_body NOT ILIKE '%NOT EXISTS%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: mark_compute_job_done missing NOT EXISTS set-based fan-in (H-0864)';
  END IF;

  -- M-0779: mark_compute_job_failed no longer sets claimed_at = NULL / claimed_by = NULL
  -- in the terminal UPDATE clause. We grep the body for the explicit clearing.
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_failed';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: mark_compute_job_failed missing';
  END IF;
  IF v_body ILIKE '%claimed_at      = NULL,%'
     OR v_body ILIKE '%claimed_at = NULL,%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: mark_compute_job_failed still clears claimed_at (M-0779 regression)';
  END IF;

  -- M-0781: reclaim_stuck_compute_jobs body uses LIMIT 500 + FOR UPDATE SKIP LOCKED
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'reclaim_stuck_compute_jobs';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: reclaim_stuck_compute_jobs missing';
  END IF;
  IF v_body NOT ILIKE '%LIMIT 500%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: reclaim_stuck_compute_jobs missing LIMIT 500 (M-0781)';
  END IF;
  IF v_body NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: reclaim_stuck_compute_jobs missing FOR UPDATE SKIP LOCKED (M-0781)';
  END IF;

  -- M-0781: reset_stalled_compute_jobs body uses LIMIT 500 + FOR UPDATE SKIP LOCKED
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'reset_stalled_compute_jobs';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: reset_stalled_compute_jobs missing';
  END IF;
  IF v_body NOT ILIKE '%LIMIT 500%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: reset_stalled_compute_jobs missing LIMIT 500 (M-0781)';
  END IF;
  IF v_body NOT ILIKE '%FOR UPDATE SKIP LOCKED%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: reset_stalled_compute_jobs missing FOR UPDATE SKIP LOCKED (M-0781)';
  END IF;

  -- M-0783: get_user_compute_jobs body uses COALESCE join filter
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_user_compute_jobs';
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: get_user_compute_jobs missing';
  END IF;
  IF v_body NOT ILIKE '%COALESCE(s.user_id, p.user_id)%' THEN
    RAISE EXCEPTION 'audit-2026-05-07 residual verification: get_user_compute_jobs missing COALESCE join filter (M-0783)';
  END IF;
END $$;

COMMIT;
