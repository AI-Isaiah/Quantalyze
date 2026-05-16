-- Migration: compute_jobs queue — audit-2026-05-07 residual specialist apply
--
-- Why this migration exists
-- -------------------------
-- 7-specialist review on top of `20260516104201_compute_jobs_audit_2026_05_07_residual.sql`
-- surfaced four CRITICAL + HIGH + MEDIUM ≥ confidence-8 follow-ups
-- (apply pass). Each is shipped as a forward-only delta so the prior
-- migration body is preserved verbatim — operators inspecting `git
-- blame` on the parent migration see the original intent, and the
-- follow-up file documents the specialist concern in one place.
--
-- Findings closed by this migration
-- ---------------------------------
-- * silent-failure-hunter c8 + code-reviewer c8 ("M-0772 backfill
--   silent clamp"): the three UPDATE statements in the parent migration
--   already ran at apply time. The "expected count is zero" comment is
--   not observable post-apply. We add a forward-looking belt-and-
--   suspenders DO block that runs the same predicate against the table
--   and RAISE NOTICE if any row matches. Future operators who replay
--   the migration on a stale DB get a loud signal that the parent
--   migration silently clamped data.
--
-- * code-reviewer c8 ("M-0779 verifier ILIKE pattern is fragile"): the
--   parent migration's verifier hard-coded two exact spacings of
--   `claimed_at = NULL,`. A re-introduction with any other whitespace
--   (no-space, tabbed, line-split) would bypass the gate. We replace
--   the assertion with a whitespace-tolerant POSIX regex match against
--   BOTH `claimed_at` AND `claimed_by`, matching the pattern mig 117 P97
--   already uses, and re-run the assertion against the LIVE function
--   bodies. Forward-only — pgsql DO blocks are stateless. If a future
--   migration regresses, the next time this file is replayed (or the
--   reset_db / dev refresh script runs) the assertion fires.
--
-- * code-reviewer c8 + data-migration c8 ("M-0783 comment misrepresents
--   the fix"): both the parent migration's header comment and its
--   `COMMENT ON FUNCTION get_user_compute_jobs` claim the COALESCE
--   change "makes orphan compute_jobs rows visible". This is wrong on
--   two counts (see specialist note): the COALESCE shape and the
--   prior OR shape return the same NULL for orphans (filtered as
--   false), AND the service-role / admin paths use direct queries not
--   this RPC. The parent file is preserved verbatim per project
--   policy; we OVERWRITE the function comment via `COMMENT ON FUNCTION`
--   so the canonical contract reads correctly. The SQL function body
--   is unchanged (no observable behavior delta).
--
-- * data-migration c9 ("REVOKE assumes default service_role grant"):
--   the parent migration's `REVOKE ALL ON TABLE compute_jobs FROM PUBLIC,
--   anon, authenticated` intentionally omits service_role. Today this
--   relies on Supabase's default grant policy. We add explicit
--   `GRANT ALL ON TABLE compute_jobs TO service_role` (and same for
--   compute_job_kinds) so the migration is self-documenting and
--   immune to default-grant-policy drift. The analytics worker's
--   direct `.from('compute_jobs')` calls continue to work; the GRANT
--   is a no-op against the current default but pins the contract.
--
-- Items NOT in this migration
-- ---------------------------
-- All other specialist findings are severity LOW/INFO or
-- MEDIUM-confidence < 8. Tracked as long-tail tech-debt rather than
-- expanded here. See `.review/specialist.*.jsonl` and the apply-pass
-- report in `FIX-REPORT.md` for the full triage.

BEGIN;

-- ====================================================================
-- silent-failure-hunter c8 / code-reviewer c8: forward-looking backfill
-- audit. Should be a no-op (the parent migration already clamped any
-- violators), but we leave a loud trail if the predicate fires on a
-- future replay.
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
    RAISE NOTICE 'audit-2026-05-07 M-0772 forward audit: % row(s) with attempts<0 STILL present (parent backfill missed this)',
      v_attempts_neg;
  END IF;

  SELECT count(*) INTO v_max_zero
    FROM compute_jobs WHERE max_attempts <= 0;
  IF v_max_zero > 0 THEN
    RAISE NOTICE 'audit-2026-05-07 M-0772 forward audit: % row(s) with max_attempts<=0 STILL present (parent backfill missed this)',
      v_max_zero;
  END IF;

  SELECT count(*) INTO v_trade_neg
    FROM compute_jobs
    WHERE trade_count IS NOT NULL AND trade_count < 0;
  IF v_trade_neg > 0 THEN
    RAISE NOTICE 'audit-2026-05-07 M-0772 forward audit: % row(s) with trade_count<0 STILL present (parent backfill missed this)',
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
-- code-reviewer c8 + data-migration c8: rewrite COMMENT ON FUNCTION
-- get_user_compute_jobs so the canonical contract documentation is
-- correct. The parent migration's body is preserved verbatim; this
-- COMMENT overwrites the misleading prior comment.
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
-- code-reviewer c8: whitespace-tolerant regex re-assertion that
-- mark_compute_job_failed does NOT clear claimed_at / claimed_by.
-- Parent migration used hard-coded ILIKE literals that miss any spacing
-- other than one-space / six-space. Match the pattern used by mig 117
-- P97 STEP 7.
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

  -- Whitespace-tolerant predicate: matches any amount of whitespace
  -- (spaces, tabs, newlines) around the `=` sign and after `NULL`, so a
  -- future patch using any spacing or line-split is caught.
  IF v_body ~* 'claimed_at\s*=\s*NULL\s*[,\n]' THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: mark_compute_job_failed regression — claimed_at = NULL re-introduced (M-0779)';
  END IF;
  IF v_body ~* 'claimed_by\s*=\s*NULL\s*[,\n]' THEN
    RAISE EXCEPTION 'audit-2026-05-07 apply: mark_compute_job_failed regression — claimed_by = NULL re-introduced (M-0779)';
  END IF;
END $$;

COMMIT;
