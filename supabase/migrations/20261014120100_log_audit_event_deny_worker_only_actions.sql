-- ============================================================================
-- Phase 167.1.2.1 RECONMARKER, plan 01 (PR 1, second migration), decision D-18
-- (founder, 2026-10-13) and its extension O-1 (orchestrator, under D-18):
-- `public.log_audit_event` refuses the WORKER-ONLY audit actions, and the
-- WORKER-ONLY audit ENTITY TYPES, to every caller that is not service_role.
-- ============================================================================
--
-- THE DEFECT
-- ----------
-- `public.log_audit_event(p_action, p_entity_type, p_entity_id, p_metadata)` is
-- SECURITY DEFINER, granted to `authenticated`, and takes any action,
-- entity_type and entity_id from the caller (user_id comes from auth.uid()).
-- A direct INSERT into audit_log is refused by RLS (`audit_log_service_insert`,
-- service_role only), but this RPC is a second door with no allow-list. MEASURED
-- on the local stack as `authenticated`: it wrote an
-- `allocator.equity.reconstruct_complete` row for an arbitrary key id. The
-- reconstruct-marker backfill of the previous migration (20261014120000) reads
-- those rows as evidence, so a user could forge "my key is reconstructed" and skip
-- their own reconstruct. Cross-tenant forgery is already closed there (the row's
-- user_id must be the key owner's, arm B8); this migration closes the own-key
-- case at the source.
--
-- THE INVENTORY OF WORKER-ONLY ACTIONS (grep, 2026-10-13)
-- -------------------------------------------------------
-- Every `allocator.*` action the analytics worker writes through
-- log_audit_event_service (AllocatorHoldingsAction / AllocatorEquityAction in
-- analytics-service/services/job_worker.py, mirrored in services/audit.py and
-- src/lib/audit.ts):
--   allocator.equity.*    reconstruct_started, reconstruct_complete,
--                         reconstruct_failed, reconstruct_no_data,
--                         reconstruct_partial_unsupported,
--                         reconstruct_unexpected_noop, refresh_complete,
--                         refresh_failed, sibling_lookup_failed,
--                         perp_upnl_missing, refresh_held_for_reconstruct
--   allocator.holdings.*  sync_requested, sync_completed, sync_failed,
--                         persist_failed
-- A prefix is denied only when NO signed-in client path writes it today. Every
-- TS caller of log_audit_event was checked (git grep of src/): the single
-- allocator.* action a client session writes is `allocator.holdings.sync_requested`
-- (src/app/api/allocator/holdings/sync/route.ts, a user-scoped client).
--   DENIED, the PREFIX allocator.equity.        no client path writes any of it.
--   DENIED, by EXACT NAME: allocator.holdings.sync_completed, sync_failed,
--     persist_failed. The prefix allocator.holdings. is NOT denied, because
--     sync_requested is a real client action; denying the prefix would break
--     "Sync now" auditing. sync_completed is also the evidence latest-holdings
--     reads as the poll's completion, so it is as forgeable as the reconstruct rows.
--   NOT DENIED: every other action (the whole non-allocator vocabulary).
--
-- O-1: THE WORKER-ONLY ENTITY TYPES (grep, 2026-10-13)
-- ---------------------------------------------------
-- Two entity types are COUNTED by a reader as if only the platform could write them,
-- and log_audit_event takes the entity type from the caller:
--   process_key                         written by analytics-service/routers/
--       process_key.py through log_audit_event_service (action process_key.entry).
--       src/app/api/cron/flag-monitor/route.ts counts every row of this entity type
--       as the denominator of the error-rate alert, so a signed-in user writing
--       rows of it could inflate the denominator and silence the founder's alert.
--   verification_requests_legacy_write  written only by the Phase 19 trigger
--       function, as a direct INSERT. phase19_soak_status counts its rows.
-- MEASURED: no TS or SQL path writes either through log_audit_event. The single TS
-- dispatcher (emit in src/lib/audit.ts) takes its entity_type from the closed
-- AUDIT_ACTION_ENTITY_TYPE_MAP, which names neither, and no SQL caller passes
-- either. Both are therefore denied for any non-service_role caller, whatever the
-- action. Same SQLSTATE 22023.
--
-- WHAT CHANGES
-- ------------
-- RE-BASE DISCIPLINE, re-measured at execution, 2026-10-13 UTC:
--   git grep -n "FUNCTION public.log_audit_event(" -- supabase/migrations
-- returns two CREATEs, 20260416201929_audit_log_hardening.sql and
-- 20260526095850_log_audit_event_null_auth_errcode.sql, on this branch and on
-- origin/main. The newest is 20260526095850, and its body is the one re-based
-- here, VERBATIM, WITH EXACTLY ONE EDIT: after the p_action presence check, the
-- deny branch below. The signature, RETURNS UUID, SECURITY DEFINER and
-- `SET search_path = public, pg_catalog` are unchanged; the 28000 and 22023
-- guards keep their order and codes.
--
-- WHO IS REFUSED: any caller whose auth.role() is not 'service_role', for a denied
-- action or a denied entity type. The refusal is SQLSTATE 22023
-- (invalid_parameter_value), the same code the function already uses for a bad
-- argument. It is deliberately NOT 42501: src/lib/audit.ts treats
-- 42501 as the fatal EXECUTE-grant-drift alarm.
--
-- ACL: the pair 20260416201929 issued is re-issued, schema-qualified, then
-- asserted: REVOKE ALL FROM PUBLIC, anon; EXECUTE to authenticated and
-- service_role. Nothing about who may CALL the function changes.
--
-- VAC-04 ACKNOWLEDGEMENT. MEASURED 2026-10-13 UTC with the gate's own normalizer
-- against origin/main's snapshot (standing in for PROD, assumption A1):
--   git show origin/main:supabase/schema/functions/log_audit_event.sql > <scratch>
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/schema/functions/log_audit_event.sql <scratch>
-- The acked hash is the `live` column.
--
-- prod-body-ack: 44a0687ab262bf5c0e96fb9110198cb0a1e0634d69be0131a7f4b06aa4d0b9fc
--
-- ⚠️ THE ACK IS EARNED only if VAC-04 on the PR reports that SAME hash for PROD.
-- Otherwise PROD drifted OUT OF BAND: FOLD the difference into this migration and
-- re-derive. Never edit the pragma to match a gate log.
--
-- DEPLOY ORDER: safe in any order. No Python or TypeScript changes; no client path
-- writes a denied action, so no caller breaks. MERGE OUTSIDE 04:00-05:45 UTC.
-- NO DATA CENSUS RUNS INSIDE THIS MIGRATION: the only DO block reads catalogues.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261014120100-rollback.sql
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- Schema-qualified deliberately (see 20260924233749's note on unqualified
-- CREATE OR REPLACE under a session search_path that does not put public first).
CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action      TEXT,
  p_entity_type TEXT,
  p_entity_id   UUID,
  p_metadata    JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_user_id UUID;
  v_row_id  UUID;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    -- NEW-C10-04: changed from ERRCODE 'insufficient_privilege' (42501) to
    -- 'invalid_authorization_specification' (28000). 42501 is reserved for
    -- the fatal EXECUTE-grant-drift signal; 28000 is the standard code for
    -- "caller is not authenticated", matching the sibling RPCs' convention.
    RAISE EXCEPTION 'log_audit_event: auth.uid() is NULL — caller must be authenticated'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF p_action IS NULL OR length(p_action) = 0 THEN
    RAISE EXCEPTION 'log_audit_event: p_action is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 167.1.2.1 D-18: the worker-only actions are refused to every caller
  -- that is not service_role. This function is SECURITY DEFINER and granted to
  -- `authenticated`, so without this a signed-in user could write
  -- an outcome-shaped row (for example allocator.equity.reconstruct_complete)
  -- about their own key and forge the evidence the reconstruct marker backfill
  -- reads. The worker writes through log_audit_event_service, which is
  -- service_role only and is unaffected. allocator.holdings.sync_requested is
  -- NOT denied: /api/allocator/holdings/sync writes it with the user's session.
  -- O-1: the same holds for the two worker-only ENTITY TYPES a reader counts as
  -- platform evidence (the flag-monitor error-rate denominator and the Phase 19
  -- soak count), whatever the action.
  IF (p_action LIKE 'allocator.equity.%'
      OR p_action IN ('allocator.holdings.sync_completed',
                      'allocator.holdings.sync_failed',
                      'allocator.holdings.persist_failed')
      OR p_entity_type IN ('process_key', 'verification_requests_legacy_write'))
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'log_audit_event: action % on entity type % is written only by the platform (log_audit_event_service), not by a client session', p_action, p_entity_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_type IS NULL OR length(p_entity_type) = 0 THEN
    RAISE EXCEPTION 'log_audit_event: p_entity_type is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'log_audit_event: p_entity_id is required (audit_log.entity_id is NOT NULL)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (v_user_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) TO service_role;

COMMENT ON FUNCTION public.log_audit_event(TEXT, TEXT, UUID, JSONB) IS
  'Fire-and-forget audit event emitter. SECURITY DEFINER; derives user_id from auth.uid() so the caller cannot spoof attribution. Raises SQLSTATE 28000 if unauthenticated (auth.uid() IS NULL), SQLSTATE 42501 if EXECUTE-grant drifted. See migrations 049 + NEW-C10-04 and ADR-0023. Phase 167.1.2.1 D-18: refuses the worker-only actions (the allocator.equity. prefix and allocator.holdings.sync_completed, sync_failed, persist_failed) and the worker-only entity types process_key and verification_requests_legacy_write (O-1) to any caller that is not service_role, SQLSTATE 22023; the worker writes them through log_audit_event_service.';

-- ───────────── self-verify — CATALOGUE ONLY (pg_get_functiondef, pg_proc,
-- has_function_privilege). Copy-checks against a COMMENT-STRIPPED body, so a
-- comment cannot satisfy an arm. Execution proof is arms D1-D5 of
-- supabase/tests/test_api_keys_history_reconstruct_marker.sql.
DO $verify_lae$
DECLARE
  v_oid     oid := to_regprocedure('public.log_audit_event(text,text,uuid,jsonb)');
  v_fn      text;
  v_body    text;
  v_cfg     text[];
  v_pos_act int;
  v_pos_deny int;
  v_pos_ins int;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: public.log_audit_event(text,text,uuid,jsonb) not found';
  END IF;
  v_fn   := pg_get_functiondef(v_oid);
  v_body := regexp_replace(regexp_replace(v_fn, '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn');
  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: the comment-stripped body came back NULL, so every arm would pass without reading anything';
  END IF;

  IF v_body !~* 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: log_audit_event lost SECURITY DEFINER';
  END IF;
  SELECT p.proconfig INTO v_cfg FROM pg_proc p WHERE p.oid = v_oid;
  IF v_cfg IS NULL OR NOT ('search_path=public, pg_catalog' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: log_audit_event does not pin search_path to the exact value (pg_proc.proconfig=%)', v_cfg;
  END IF;

  -- The deny branch: the prefix, the three exact names, the two entity types, the
  -- service_role test.
  IF v_body !~ 'allocator\.equity\.%'
     OR v_body !~ 'allocator\.holdings\.sync_completed'
     OR v_body !~ 'allocator\.holdings\.sync_failed'
     OR v_body !~ 'allocator\.holdings\.persist_failed'
     OR v_body !~ 'process_key'
     OR v_body !~ 'verification_requests_legacy_write'
     OR v_body !~ 'auth\.role\(\)' THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: the worker-only deny branch is not intact in log_audit_event';
  END IF;
  -- Its place: after the p_action presence check, before the INSERT.
  v_pos_act  := regexp_instr(v_body, 'p_action[[:space:]]+IS[[:space:]]+NULL');
  v_pos_deny := regexp_instr(v_body, 'allocator\.equity\.%');
  v_pos_ins  := regexp_instr(v_body, 'INSERT[[:space:]]+INTO[[:space:]]+audit_log');
  IF v_pos_act = 0 OR v_pos_ins = 0 OR NOT (v_pos_act < v_pos_deny AND v_pos_deny < v_pos_ins) THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: the deny branch is not between the p_action check and the INSERT (positions %, %, %)', v_pos_act, v_pos_deny, v_pos_ins;
  END IF;
  -- The earlier guards are intact.
  IF v_body !~ 'ERRCODE = ''invalid_authorization_specification''' THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: the NULL-auth 28000 guard of NEW-C10-04 is gone';
  END IF;

  -- ACL.
  PERFORM public._assert_no_public_execute('public.log_audit_event(text,text,uuid,jsonb)');
  IF has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261014120100 failed: the log_audit_event ACL did not converge (anon must not, authenticated and service_role must hold EXECUTE)';
  END IF;

  RAISE NOTICE 'Migration 20261014120100: log_audit_event refuses the allocator.equity. prefix and allocator.holdings sync_completed, sync_failed and persist_failed, and the process_key and verification_requests_legacy_write entity types, to a non-service_role caller; SECDEF, the search_path pin and the ACL intact.';
END
$verify_lae$;

COMMIT;
