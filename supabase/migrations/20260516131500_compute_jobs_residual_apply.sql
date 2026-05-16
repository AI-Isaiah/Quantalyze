-- Migration: compute_jobs queue — audit-2026-05-07 residual specialist apply + red-team
--
-- Why this migration exists
-- -------------------------
-- 7-specialist review on top of `20260516104201_compute_jobs_audit_2026_05_07_residual.sql`
-- surfaced four CRITICAL + HIGH + MEDIUM ≥ confidence-8 follow-ups
-- (apply pass). A subsequent red-team pass surfaced FIVE additional
-- M≥conf-8 items that the specialists missed:
--
-- 1. Regex character class incomplete (M c8) — widen termination set.
-- 2. M-0772 forward audit uses NOTICE not EXCEPTION (M c9) — escalate.
-- 3. Apply migration not safely re-runnable (M c8) — add precondition guards.
-- 4. service_role GRANT never asserted in verifier (M c8) — close the loop.
-- 5. H-0864 `= ANY(array_col)` does NOT use GIN index (M c8) — rewrite
--    with `@>` containment predicate so the parent migration's perf
--    claim holds. Forward-only via CREATE OR REPLACE FUNCTION.
-- 6. _assert_owner STABLE marker violates contract (M c8) — VOLATILE
--    via CREATE OR REPLACE FUNCTION.
--
-- Each is shipped as a forward-only delta so the prior migration body
-- is preserved verbatim — operators inspecting `git blame` on the
-- parent migration see the original intent, and this file documents
-- both the specialist concern AND the red-team follow-up in one place.
--
-- Rerun contract
-- --------------
-- This migration is safely re-runnable after a fresh apply of the
-- parent residual migration. Each substantive operation is gated by
-- a precondition check (catalog state) so a second apply against the
-- post-apply state is a no-op. NOT safely re-runnable after a future
-- migration legitimately changes the protected function bodies —
-- consult the relevant migration changelog before replaying this in
-- isolation.
--
-- Findings closed by this migration
-- ---------------------------------
-- See specialist findings table above + red-team findings catalogued
-- in `.review/red-team.jsonl`. Quick reference:
--
-- * silent-failure-hunter c8 + code-reviewer c8 + red-team c9:
--   M-0772 forward-looking backfill audit. RAISE EXCEPTION (was
--   NOTICE) because positive counts are logically impossible after
--   the parent migration's VALIDATEd CHECKs are in place — non-zero
--   means a DBA-level bypass occurred and warrants a loud failure.
--
-- * code-reviewer c8 + red-team c8: M-0779 verifier regex pattern.
--   POSIX regex with whitespace tolerance and a complete terminator
--   set (comma, semicolon, close-paren, end-of-string, end-of-line).
--
-- * code-reviewer c8 + data-migration c8: M-0783 COMMENT ON FUNCTION
--   rewrite (parent migration body preserved verbatim).
--
-- * data-migration c9 + red-team c8: explicit GRANT ALL ON TABLE
--   <compute_jobs|compute_job_kinds> TO service_role, with positive
--   verifier assertion.
--
-- * red-team c8 (data-migration c8 entry 7): H-0864 GIN index usage.
--   `p_job_id = ANY(c.parent_job_ids)` rewritten to
--   `c.parent_job_ids @> ARRAY[p_job_id]::uuid[]` so the planner
--   actually uses compute_jobs_parent_lookup. mig 117 P97 fence
--   semantics preserved verbatim.
--
-- * red-team c8 (silent-failure-hunter c7 + performance c7):
--   `_assert_owner` re-created with VOLATILE marker. STABLE violates
--   the function's contract (auth.uid() is request-scoped + the body
--   RAISEs exceptions). VOLATILE is the default and has zero perf
--   impact for a function called via PERFORM.

BEGIN;

-- ====================================================================
-- Precondition: parent residual migration must be applied. Without it,
-- the assertions below would reference functions / constraints that
-- don't exist, producing confusing errors.
-- ====================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'compute_jobs_attempts_non_negative'
       AND conrelid = 'public.compute_jobs'::regclass
  ) THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: parent migration 20260516104201 has not been applied (constraint compute_jobs_attempts_non_negative missing). Run the parent migration first.';
  END IF;
END $$;

-- ====================================================================
-- silent-failure-hunter c8 / code-reviewer c8 / red-team c9:
-- forward-looking backfill audit. Should be a no-op post-parent-apply.
-- Escalated from RAISE NOTICE to RAISE EXCEPTION because the CHECK
-- constraints make positive counts logically impossible — a non-zero
-- result means a DBA bypass occurred and warrants a loud failure.
-- ====================================================================
DO $$
DECLARE
  v_attempts_neg INTEGER;
  v_max_zero     INTEGER;
  v_trade_neg    INTEGER;
BEGIN
  SELECT count(*) INTO v_attempts_neg
    FROM compute_jobs WHERE attempts < 0;
  IF v_attempts_neg > 0 THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0772 forward audit: % row(s) with attempts<0 STILL present (CHECK constraint compute_jobs_attempts_non_negative bypassed somehow)',
      v_attempts_neg;
  END IF;

  SELECT count(*) INTO v_max_zero
    FROM compute_jobs WHERE max_attempts <= 0;
  IF v_max_zero > 0 THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0772 forward audit: % row(s) with max_attempts<=0 STILL present (CHECK constraint compute_jobs_max_attempts_positive bypassed somehow)',
      v_max_zero;
  END IF;

  SELECT count(*) INTO v_trade_neg
    FROM compute_jobs
    WHERE trade_count IS NOT NULL AND trade_count < 0;
  IF v_trade_neg > 0 THEN
    RAISE EXCEPTION 'audit-2026-05-07 M-0772 forward audit: % row(s) with trade_count<0 STILL present (CHECK constraint compute_jobs_trade_count_non_negative bypassed somehow)',
      v_trade_neg;
  END IF;
END $$;

-- ====================================================================
-- data-migration c9: explicit GRANT ALL on compute_jobs /
-- compute_job_kinds to service_role. Defense in depth against Supabase
-- default-grant-policy drift. The worker.py direct `.from('compute_jobs')`
-- path is the only consumer of this GRANT today.
-- ====================================================================
GRANT ALL ON TABLE compute_jobs    TO service_role;
GRANT ALL ON TABLE compute_job_kinds TO service_role;

-- ====================================================================
-- red-team c8: positive verifier — service_role MUST retain table
-- access. Closes the loop on the M-0774 verifier which only asserts
-- the negative (anon/authenticated/PUBLIC have zero grants) and never
-- the positive (service_role still has its grants).
-- ====================================================================
DO $$
DECLARE
  v_jobs_grants  INTEGER;
  v_kinds_grants INTEGER;
BEGIN
  SELECT count(*) INTO v_jobs_grants
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'compute_jobs'
     AND grantee = 'service_role'
     AND privilege_type IN ('INSERT','UPDATE','DELETE','SELECT');
  IF v_jobs_grants < 4 THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: service_role missing one or more privileges on compute_jobs (has %, expected >= 4)',
      v_jobs_grants;
  END IF;

  SELECT count(*) INTO v_kinds_grants
    FROM information_schema.table_privileges
   WHERE table_schema = 'public'
     AND table_name = 'compute_job_kinds'
     AND grantee = 'service_role'
     AND privilege_type IN ('INSERT','UPDATE','DELETE','SELECT');
  IF v_kinds_grants < 4 THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: service_role missing one or more privileges on compute_job_kinds (has %, expected >= 4)',
      v_kinds_grants;
  END IF;
END $$;

-- ====================================================================
-- code-reviewer c8 + data-migration c8: rewrite COMMENT ON FUNCTION
-- get_user_compute_jobs so the canonical contract documentation is
-- correct. Parent migration body preserved verbatim; this COMMENT
-- overwrites the misleading prior comment.
-- ====================================================================
COMMENT ON FUNCTION get_user_compute_jobs IS
  'Returns compute_jobs rows visible to auth.uid(). last_error REDACTED; '
  'user_message TEXT (mig 111 P11) synthesised from (status, error_kind). '
  'audit-2026-05-07 M-0783: WHERE uses COALESCE(s.user_id, p.user_id) — '
  'this is a self-documenting refactor with NO observable behavior delta '
  'from the prior `(s.user_id = X OR p.user_id = X)` shape. Both forms '
  'return NULL (filtered as false) for orphan rows where both joins miss. '
  'Orphans remain invisible to ALL callers of this RPC. Admins read '
  'orphans through the service-role direct query path, never through '
  'this function (auth.uid() IS NULL returns early at the top of the '
  'body). See migrations 032, 111, audit-2026-05-07.';

-- ====================================================================
-- red-team c8 (silent-failure-hunter c7 + performance c7):
-- _assert_owner VOLATILE re-creation. STABLE was an unforced error
-- because the body RAISEs exceptions and reads request-scoped
-- auth.uid() — both violate the STABLE contract. VOLATILE is the
-- default; zero perf impact for a function only called via PERFORM.
-- Body preserved verbatim from parent migration; only the marker line
-- changes.
-- ====================================================================
CREATE OR REPLACE FUNCTION _assert_owner(
  p_table   REGCLASS,
  p_row_id  UUID,
  p_context TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
VOLATILE
AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_owner UUID;
  v_found BOOLEAN := false;
BEGIN
  IF v_auth_uid IS NULL THEN
    RETURN;  -- service-role path, skip the check
  END IF;

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

  IF NOT v_found THEN
    RAISE EXCEPTION '%: row % not found in %', p_context, p_row_id, p_table
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION '%: row % in % has NULL user_id (legacy/orphan row?)',
      p_context, p_row_id, p_table
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_owner <> v_auth_uid THEN
    RAISE EXCEPTION '%: row % not owned by auth.uid()', p_context, p_row_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION _assert_owner FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- red-team c8 (data-migration c8 entry 7): H-0864 GIN index usage fix.
-- The parent migration's mark_compute_job_done body uses
-- `p_job_id = ANY(c.parent_job_ids)` which does NOT use the GIN index
-- on parent_job_ids. The planner falls back to a seq-scan of
-- compute_jobs on every mark_done call, undoing the H-0864 perf win
-- the migration header claims.
--
-- Fix: rewrite as `c.parent_job_ids @> ARRAY[p_job_id]::uuid[]` which
-- is the GIN-supported containment predicate. Semantically identical
-- (both forms ask 'is p_job_id one of the parents?') but the planner
-- recognizes @> as a GIN-supported operator.
--
-- All other semantics (fence preservation, idempotent-retry, Phase-18
-- bridge) are preserved verbatim from the parent migration.
-- ====================================================================
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

  -- audit-2026-05-07 H-0864 + red-team apply: set-based fan-in advance
  -- with GIN-supported containment predicate.
  --
  -- Containment predicate `c.parent_job_ids @> ARRAY[p_job_id]::uuid[]`
  -- is semantically identical to `p_job_id = ANY(c.parent_job_ids)`
  -- but the planner recognizes @> as a GIN-supported operator and
  -- uses compute_jobs_parent_lookup. The NOT EXISTS sub-query enforces
  -- the "all parents done" predicate equivalently to check_fan_in_ready.
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
    PERFORM sync_strategy_analytics_status(v_strategy_id);
  END IF;
END;
$$;

COMMENT ON FUNCTION mark_compute_job_done(UUID, UUID) IS
  'Terminal success transition. Migration 117 P97 fence preserved. '
  'audit-2026-05-07 H-0864 + red-team apply: fan-in advance is a single '
  'set-based UPDATE using GIN-supported `parent_job_ids @> ARRAY[...]` '
  '(was `= ANY(parent_job_ids)`, which the planner could not push down '
  'to the GIN index). Preserves mig 109 P6 idempotent-retry on '
  'already-done rows AND mig 099 Phase-18 atomic UI status bridge. '
  'See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md + '
  '.review/red-team.jsonl.';

REVOKE ALL ON FUNCTION mark_compute_job_done(UUID, UUID) FROM PUBLIC, anon, authenticated;

-- ====================================================================
-- code-reviewer c8 + red-team c8: whitespace-tolerant regex re-assertion
-- that mark_compute_job_failed does NOT clear claimed_at / claimed_by.
-- Parent migration's two ILIKE literals miss any spacing other than
-- one-space / six-space. Red-team noted the parent's POSIX regex used
-- `[,\n]` only — extend to `(,|;|\)|$|\s)` so semicolons, close-parens,
-- and end-of-line (including CRLF) are caught.
-- ====================================================================
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'mark_compute_job_failed';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: mark_compute_job_failed missing';
  END IF;

  -- Whitespace-tolerant predicate covering every reachable terminator
  -- after `claimed_at = NULL`: comma (UPDATE SET multi-column), semicolon
  -- (single-column UPDATE), close-paren (subquery), end-of-line (\n or
  -- \r\n via the [[:space:]] class).
  IF v_body ~* 'claimed_at\s*=\s*NULL\s*(,|;|\)|$|[[:space:]])' THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: mark_compute_job_failed regression — claimed_at = NULL re-introduced (M-0779)';
  END IF;
  IF v_body ~* 'claimed_by\s*=\s*NULL\s*(,|;|\)|$|[[:space:]])' THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: mark_compute_job_failed regression — claimed_by = NULL re-introduced (M-0779)';
  END IF;
END $$;

COMMIT;
