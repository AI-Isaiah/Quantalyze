-- ==========================================================================
-- Migration 20261106120000: the two single-statement writers of compute_jobs.metadata.
-- Phase 191 REFUSALRACE, plan 02 (SC-2, SC-3, SC-4; decisions D-01, D-03, D-07, D-09).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Two callers change `compute_jobs.metadata` by reading the whole object, editing one
-- key and writing the whole object back. PostgREST replaces the column, so if the other
-- writer lands between that read and that write, its key is undone:
--   * the derive's refusal marker (`read_refusal_kept_figures`, Phase 186 D-11/D-13) is
--     lost, and the status bridge then stamps the strategy `failed` over figures the
--     refusal kept;
--   * a Sync's retraction of an inherited ledger-refresh marker (166.5 D-07) is lost,
--     and the user's Sync job stays protected as a refresh.
--
-- WHAT IT DOES
-- ------------
-- Two new service-role-only functions. Each does its whole job in ONE UPDATE that
-- merges into `metadata`:
--   1. public.mark_compute_job_kept_figures(p_job_id uuid) RETURNS boolean   (D-03, D-07)
--      Sets `read_refusal_kept_figures` to true. Non-object metadata (NULL, JSON null,
--      array, scalar) becomes a fresh object, as the Python writer does today: an array
--      merged with an object would otherwise yield an array. Returns FOUND, so the caller
--      can tell a write that landed from one that did not. No claim-token fence (D-09):
--      parity with today's unfenced write.
--   2. public.retract_ledger_refresh_marker(p_job_id uuid, p_correlation_id text)
--      RETURNS jsonb   (D-01)
--      Drops `source` only when it is a ledger-refresh marker, adds
--      `refresh_marker_retracted` (the old marker) and `correlation_id` (the caller's
--      id), keeps every other key, and matches no `done` row. It reports one of
--      `retracted` (with the marker), `done` (with the marker when the row carried one),
--      `no_marker` or `no_row`, so the callers keep their outcomes and log lines.
--
-- WHY ONE STATEMENT IS ENOUGH
-- ---------------------------
-- Under READ COMMITTED, an UPDATE that blocks on a row another transaction is changing
-- re-evaluates its WHERE clause and its SET expressions against the committed row it
-- waited for. So a `||` or a `-` inside the SET expression always applies to the latest
-- committed metadata: both orders of the two writes keep every key. There is no window
-- between a read and a write, because there is no separate read.
--
-- WHAT IT DOES NOT DO
-- -------------------
-- - `enqueue_compute_job` is not touched (D-01), and neither is the status bridge: it
--   keeps reading `metadata->>'source'`, so the retraction still removes `source` itself.
-- - The gap between `enqueue_compute_job` returning a deduped id and the retraction
--   running stays as it is today (D-02). It existed before this phase.
-- - No caller changes here. D-06: this migration ships alone as PR 1; the Python and
--   TypeScript writers switch in PR 2, after this migration has applied on PROD.
--
-- ACL. Supabase default privileges grant EXECUTE on new functions to anon and
-- authenticated directly, so `FROM PUBLIC` alone leaves them with it: the REVOKE names
-- all three. service_role is the only grantee.
--
-- Plain CREATE FUNCTION, not CREATE OR REPLACE: both names are new, so a collision must
-- fail loud instead of replacing someone else's body.
--
-- The verify block is CATALOGUE-ONLY (pg_proc, proconfig, has_function_privilege,
-- aclexplode). It reads no table, so it applies on schema-only TEST exactly as on PROD
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). The behavioural proof lives in
-- supabase/tests/test_compute_job_metadata_merge.sql.
--
-- Rollback: supabase/migrations/down/20261106120000-rollback.sql (manual, never
-- auto-applied).
-- ==========================================================================

SET LOCAL lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: mark_compute_job_kept_figures — the refusal marker, one merge statement
-- ==========================================================================
CREATE FUNCTION public.mark_compute_job_kept_figures(p_job_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  UPDATE public.compute_jobs
     SET metadata = CASE WHEN jsonb_typeof(metadata) = 'object'
                         THEN metadata
                         ELSE '{}'::jsonb
                    END
                    || jsonb_build_object('read_refusal_kept_figures', true)
   WHERE id = p_job_id;
  RETURN FOUND;
END;
$$;

COMMENT ON FUNCTION public.mark_compute_job_kept_figures(uuid) IS
  'Phase 191 REFUSALRACE (D-03, D-07, D-09), migration 20261106120000: writes the derive''s refusal marker (read_refusal_kept_figures = true) into compute_jobs.metadata as ONE merge statement, so a concurrent write to another key of the same blob is never undone. Non-object metadata becomes a fresh object. Returns FOUND: true only when a row changed. Unfenced by claim_token (parity with the write it replaces). Service-role only; sole caller is the analytics worker refusal path.';

-- ==========================================================================
-- STEP 2: retract_ledger_refresh_marker — the retraction, one UPDATE
-- ==========================================================================
-- The classifying SELECT runs only when the UPDATE matched nothing, to say why.
CREATE FUNCTION public.retract_ledger_refresh_marker(p_job_id uuid, p_correlation_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_marker      text;
  v_status      text;
  v_done_marker text;
BEGIN
  -- In RETURNING, `metadata` is the NEW row, so the old marker is read back from the
  -- key just written.
  UPDATE public.compute_jobs
     SET metadata = (metadata - 'source')
                    || jsonb_build_object('refresh_marker_retracted', metadata ->> 'source',
                                          'correlation_id', p_correlation_id)
   WHERE id = p_job_id
     AND status <> 'done'
     AND (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
  RETURNING metadata ->> 'refresh_marker_retracted' INTO v_marker;

  IF FOUND THEN
    RETURN jsonb_build_object('outcome', 'retracted', 'marker', v_marker);
  END IF;

  SELECT status,
         CASE WHEN (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
              THEN metadata ->> 'source'
         END
    INTO v_status, v_done_marker
    FROM public.compute_jobs
   WHERE id = p_job_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'no_row');
  END IF;

  IF v_status = 'done' THEN
    RETURN jsonb_build_object('outcome', 'done', 'status', v_status, 'marker', v_done_marker);
  END IF;

  RETURN jsonb_build_object('outcome', 'no_marker', 'status', v_status);
END;
$$;

COMMENT ON FUNCTION public.retract_ledger_refresh_marker(uuid, text) IS
  'Phase 191 REFUSALRACE (D-01), migration 20261106120000: retracts an inherited ledger-refresh marker from compute_jobs.metadata in ONE UPDATE (drops source only when it is ledger-refresh or ledger-refresh-composite, adds refresh_marker_retracted and correlation_id, keeps every other key, never touches a done row). Returns jsonb {outcome: retracted | done | no_marker | no_row, ...} so the callers keep their outcomes and log lines. Service-role only; callers are the Python long-fetch tail and the TypeScript keys/sync and finalize-wizard routes.';

-- ==========================================================================
-- STEP 3: REVOKE / GRANT EXECUTE (service_role only, grantees named)
-- ==========================================================================
REVOKE ALL ON FUNCTION public.mark_compute_job_kept_figures(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_compute_job_kept_figures(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.retract_ledger_refresh_marker(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.retract_ledger_refresh_marker(uuid, text) TO service_role;

-- ==========================================================================
-- STEP 4: self-verify — CATALOGUE ONLY (no table is read)
-- ==========================================================================
DO $$
DECLARE
  v_fn_oid OID;
  v_name   TEXT;
  v_names  TEXT[] := ARRAY['mark_compute_job_kept_figures', 'retract_ledger_refresh_marker'];
BEGIN
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT p.oid
      INTO v_fn_oid
      FROM pg_proc p
     WHERE p.proname = v_name
       AND p.pronamespace = 'public'::regnamespace;
    IF v_fn_oid IS NULL THEN
      RAISE EXCEPTION 'Migration 20261106120000: % function missing', v_name;
    END IF;

    IF NOT COALESCE((SELECT p.prosecdef FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
      RAISE EXCEPTION 'Migration 20261106120000: % is NOT SECURITY DEFINER', v_name;
    END IF;

    IF NOT COALESCE((SELECT 'search_path=public, pg_catalog' = ANY(p.proconfig)
                       FROM pg_proc p WHERE p.oid = v_fn_oid), false) THEN
      RAISE EXCEPTION 'Migration 20261106120000: % missing SET search_path = public, pg_catalog', v_name;
    END IF;

    IF NOT has_function_privilege('service_role', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261106120000: service_role lacks EXECUTE on % (the worker and the routes cannot call it)', v_name;
    END IF;
    IF has_function_privilege('anon', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261106120000: anon can EXECUTE % (a SECURITY DEFINER writer exposed through PostgREST)', v_name;
    END IF;
    IF has_function_privilege('authenticated', v_fn_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261106120000: authenticated can EXECUTE % (a SECURITY DEFINER writer exposed through PostgREST)', v_name;
    END IF;

    -- PUBLIC (grantee 0) must hold no EXECUTE: the grant list is explicit.
    IF EXISTS (SELECT 1
                 FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                WHERE p.oid = v_fn_oid AND a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
      RAISE EXCEPTION 'Migration 20261106120000: PUBLIC still holds EXECUTE on %', v_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'Migration 20261106120000: mark_compute_job_kept_figures and retract_ledger_refresh_marker installed (catalogue verified: SECDEF, pinned search_path, service_role-only EXECUTE).';
END $$;

-- ==========================================================================
-- END OF MIGRATION 20261106120000
-- ==========================================================================
-- Downstream consumers (PR 2, after this migration has applied on PROD, D-06):
--   * analytics-service/services/job_worker.py _mark_job_kept_figures
--   * analytics-service/services/ingestion/long_fetch.py _retract_refresh_marker_on_reuse
--   * src/lib/ledger-refresh-marker.ts retractInheritedRefreshMarker
