-- Migration 118: retroactive ACL hardening on _enqueue_compute_job_internal overloads
--
-- Why this migration exists
-- -------------------------
-- Migration 109 (audit-2026-05-07 G10.B batch 3) extended
-- _enqueue_compute_job_internal via CREATE OR REPLACE FUNCTION over the
-- original 7-param signature. At that point migration 066 had already
-- replaced the original 7-param body with a 10-param signature
-- (allocator + api_key + run_at). The CREATE OR REPLACE in mig 109
-- therefore did not "replace" the existing function — it created a
-- second overload alongside the 10-param one.
--
-- Mig 109's follow-up `COMMENT ON FUNCTION _enqueue_compute_job_internal`
-- and `REVOKE ALL ON FUNCTION _enqueue_compute_job_internal` were
-- written without an argument list. With two overloads coexisting,
-- those statements bind ambiguously and PostgreSQL raises SQLSTATE
-- 42725 (ambiguous_function). Under `supabase db push` the failure
-- was silently swallowed: the migration row was inserted into
-- supabase_migrations.schema_migrations, but the COMMENT and REVOKE
-- never ran.
--
-- Result on production (`khslejtfbuezsmvmtsdn`) after 109 landed:
--   * 10-param overload — ACL inherited from prior REVOKE in mig 066
--     (locked down to postgres + service_role).
--   * 7-param overload — COMMENT missing, ACL drift varies by project.
--     On test (`qmnijlgmdhviwzwfyzlc`) the 7-param overload picked up
--     Supabase's default `GRANT EXECUTE ... TO anon, authenticated`
--     event-trigger and is currently EXECUTE-grantable to anon and
--     authenticated. That is an ACL hardening gap on a SECURITY DEFINER
--     queue-internals function.
--
-- This migration closes the gap idempotently. It applies the COMMENT
-- and REVOKE that should have run as part of mig 109 to BOTH overloads
-- with explicit argument lists, so the binding is unambiguous on any
-- database that has 109 recorded.
--
-- Idempotent design
-- -----------------
-- * `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`
--   is safe to re-run regardless of current ACL — it always converges
--   on "no PUBLIC/anon/authenticated EXECUTE".
-- * `COMMENT ON FUNCTION ... IS '...'` overwrites the existing comment
--   so re-running is a no-op when the comment already matches.
-- * `GRANT EXECUTE ... TO service_role` is additive but redundant —
--   service_role already retains EXECUTE from the postgres-owned
--   default. Including it explicitly defends against any future
--   default-privilege drift that might strip it.
--
-- Safe to run on:
--   * a database with both overloads + default ACL (current test):
--     tightens ACL, sets COMMENT.
--   * a database where 109's edited (arg-qualified) form ran cleanly:
--     no-op for ACL, COMMENT idempotent.
--   * a future fresh database after the edit to 109: all assertions
--     pass.

BEGIN;

-- --------------------------------------------------------------------
-- 7-param overload (original signature, re-introduced by mig 109)
-- --------------------------------------------------------------------
REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) TO service_role;

COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb
) IS
  'Private shared idempotent enqueue (7-param overload re-introduced by mig 109). '
  'Inserts new rows with status=''done_pending_children'' when parent_job_ids is '
  'non-empty (mig 109 P12), else status=''pending''. Race-loser re-read uses plain '
  'SELECT INTO; if the winner already advanced past in-flight statuses, raises '
  'serialization_failure so the caller can retry vs. surfacing a 500 (mig 109 P3). '
  'ACL re-asserted by migration 118 because the unqualified COMMENT/REVOKE in '
  'mig 109 silently failed under two coexisting overloads. See migrations 109, 118.';

-- --------------------------------------------------------------------
-- 10-param overload (extended signature from mig 066)
-- --------------------------------------------------------------------
-- The 10-param overload was already correctly REVOKE'd in mig 066, but
-- we re-assert here so a single migration covers both overloads
-- atomically. COMMENT is preserved verbatim from the mig 066 wording so
-- a fresh-database trace shows the same description on both projects.
REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) TO service_role;

COMMENT ON FUNCTION public._enqueue_compute_job_internal(
  uuid, uuid, text, text, uuid[], text, jsonb,
  uuid, uuid, timestamptz
) IS
  'Private shared implementation of the idempotent enqueue pattern. Handles all '
  'four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR '
  'on the four id parameters. Extended in migration 066 for api_key scope + '
  'scheduled run_at. ACL re-asserted by migration 118.';

-- --------------------------------------------------------------------
-- Self-verifying assertions
-- --------------------------------------------------------------------
DO $$
DECLARE
  v_overload_count INTEGER;
  v_proc_record    RECORD;
  v_anon_can_exec  BOOLEAN;
  v_auth_can_exec  BOOLEAN;
  v_description    TEXT;
BEGIN
  -- Both overloads must exist.
  SELECT count(*) INTO v_overload_count
    FROM pg_proc
    WHERE proname = '_enqueue_compute_job_internal'
      AND pronamespace = 'public'::regnamespace;

  IF v_overload_count <> 2 THEN
    RAISE EXCEPTION
      'Migration 118 verification failed: expected exactly 2 overloads of public._enqueue_compute_job_internal (got %)',
      v_overload_count;
  END IF;

  -- For each overload: anon/authenticated must NOT have EXECUTE, and
  -- a non-NULL COMMENT must be set.
  FOR v_proc_record IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p
      WHERE p.proname = '_enqueue_compute_job_internal'
        AND p.pronamespace = 'public'::regnamespace
  LOOP
    v_anon_can_exec := has_function_privilege('anon', v_proc_record.oid, 'EXECUTE');
    v_auth_can_exec := has_function_privilege('authenticated', v_proc_record.oid, 'EXECUTE');

    IF v_anon_can_exec THEN
      RAISE EXCEPTION
        'Migration 118 verification failed: anon retains EXECUTE on public._enqueue_compute_job_internal(%)',
        v_proc_record.args;
    END IF;
    IF v_auth_can_exec THEN
      RAISE EXCEPTION
        'Migration 118 verification failed: authenticated retains EXECUTE on public._enqueue_compute_job_internal(%)',
        v_proc_record.args;
    END IF;

    SELECT d.description INTO v_description
      FROM pg_description d
      WHERE d.objoid = v_proc_record.oid
        AND d.classoid = 'pg_proc'::regclass
        AND d.objsubid = 0;

    IF v_description IS NULL OR length(trim(v_description)) = 0 THEN
      RAISE EXCEPTION
        'Migration 118 verification failed: COMMENT missing on public._enqueue_compute_job_internal(%)',
        v_proc_record.args;
    END IF;
  END LOOP;
END $$;

COMMIT;
