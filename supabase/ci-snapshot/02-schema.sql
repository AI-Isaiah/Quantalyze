


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."match_decision_kind" AS ENUM (
    'bridge_recommended',
    'voluntary_remove',
    'voluntary_add',
    'voluntary_modify'
);


ALTER TYPE "public"."match_decision_kind" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_assert_no_public_execute"("p_function_signature" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_oid   OID;
  v_leaks INTEGER;
BEGIN
  -- Resolve the function signature to an OID. regprocedure rejects an
  -- ambiguous or missing signature with a clear error.
  v_oid := p_function_signature::regprocedure::oid;

  -- aclexplode returns one row per (grantor, grantee, privilege) tuple.
  -- grantee = 0 is the PUBLIC pseudo-grantee in pg_authid. privilege_type
  -- = 'EXECUTE' is the EXECUTE bit. If any such row exists, PUBLIC has
  -- the function — by definition the leak the audit C-0284 targets.
  SELECT COUNT(*) INTO v_leaks
    FROM pg_proc p,
         LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
   WHERE p.oid = v_oid
     AND a.grantee = 0
     AND a.privilege_type = 'EXECUTE';

  IF v_leaks > 0 THEN
    RAISE EXCEPTION
      '_assert_no_public_execute: PUBLIC has EXECUTE on % — SECURITY DEFINER leak detected via pg_proc.proacl (aclexplode grantee=0). audit-2026-05-07 C-0284.',
      p_function_signature
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;


ALTER FUNCTION "public"."_assert_no_public_execute"("p_function_signature" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_assert_no_public_execute"("p_function_signature" "text") IS 'Migration 134 / audit-2026-05-07 C-0284. Asserts a function has NO PUBLIC EXECUTE grant by inspecting pg_proc.proacl via aclexplode(grantee=0). Correct replacement for has_function_privilege(''public'', ...) which is brittle across PG versions. Migration-utility ONLY — REVOKE-d from PUBLIC/anon/authenticated/service_role below so neither the API layer nor a compromised service-role token can invoke it. Migrations run as postgres (superuser) and bypass the REVOKE.';



CREATE OR REPLACE FUNCTION "public"."_assert_owner"("p_table" "regclass", "p_row_id" "uuid", "p_context" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."_assert_owner"("p_table" "regclass", "p_row_id" "uuid", "p_context" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_assert_owner"("p_table" "regclass", "p_row_id" "uuid", "p_context" "text") IS 'Private shared ownership check. Service-role bypass (auth.uid() IS NULL). Distinguishes three failures (audit-2026-05-07 M-0777): row missing (no_data_found), row exists but user_id NULL (check_violation), row owned by another user (insufficient_privilege). Future caller passing a table without a user_id column gets a clearer undefined_column message via the wrapped EXECUTE. See migrations 032, 109+.';



CREATE OR REPLACE FUNCTION "public"."_assert_retention_columns"() RETURNS "void"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_missing TEXT[] := ARRAY[]::TEXT[];
  v_pair TEXT;
BEGIN
  -- Each row is "schema.table.column" — concise for error messages.
  FOREACH v_pair IN ARRAY ARRAY[
    'public.api_keys.is_active',
    'public.profiles.email',
    'public.notification_dispatches.recipient_email',
    'public.notification_dispatches.notification_type',
    'public.notification_dispatches.status',
    'public.notification_dispatches.created_at'
  ] LOOP
    PERFORM 1 FROM information_schema.columns
     WHERE table_schema = split_part(v_pair, '.', 1)
       AND table_name   = split_part(v_pair, '.', 2)
       AND column_name  = split_part(v_pair, '.', 3);
    IF NOT FOUND THEN
      v_missing := v_missing || v_pair;
    END IF;
  END LOOP;

  IF array_length(v_missing, 1) > 0 THEN
    RAISE EXCEPTION
      '_assert_retention_columns: schema drift detected — column(s) referenced by retention crons are missing: %. audit-2026-05-07 H-0923.',
      array_to_string(v_missing, ', ')
      USING ERRCODE = 'undefined_column';
  END IF;
END;
$$;


ALTER FUNCTION "public"."_assert_retention_columns"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_assert_retention_columns"() IS 'audit-2026-05-07 H-0923. Asserts the columns referenced by the retention crons (api_keys.is_active, profiles.email, notification_dispatches.recipient_email/notification_type/status/created_at) exist. Migration utility — invoked at apply time and intended to be re-callable from a future canary cron if/when one is built. REVOKEd from app roles since migrations run as postgres (superuser) and bypass.';



CREATE OR REPLACE FUNCTION "public"."_assert_strategy_visible_to_allocator"("p_strategy_id" "uuid", "p_allocator_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_org_id UUID;
  v_is_member BOOLEAN;
BEGIN
  IF p_strategy_id IS NULL THEN
    -- voluntary_remove / voluntary_modify have NULL strategy_id by
    -- CHECK; treat as visible (the visibility gate is for strategy-
    -- bearing kinds only).
    RETURN TRUE;
  END IF;

  -- Look up the strategy's organization scope. If organization_id is
  -- NULL, the strategy is owner-scoped (no org gate) and globally
  -- visible while published — return TRUE.
  SELECT organization_id INTO v_org_id
    FROM strategies
   WHERE id = p_strategy_id;

  IF v_org_id IS NULL THEN
    RETURN TRUE;
  END IF;

  -- Strategy is org-scoped. Allocator must be in organization_members.
  -- audit-2026-05-07 MED-3: orphan-org (zero members) no longer
  -- returns TRUE. The prior fast-path silently flipped sanitize-orphan
  -- strategies to globally allocator-visible. Failing closed is safer;
  -- legitimate post-sanitize unblock is via manual admin override.
  SELECT EXISTS (
    SELECT 1 FROM organization_members
     WHERE organization_id = v_org_id
       AND user_id = p_allocator_id
  ) INTO v_is_member;

  RETURN COALESCE(v_is_member, FALSE);
END;
$$;


ALTER FUNCTION "public"."_assert_strategy_visible_to_allocator"("p_strategy_id" "uuid", "p_allocator_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_assert_strategy_visible_to_allocator"("p_strategy_id" "uuid", "p_allocator_id" "uuid") IS 'audit-2026-05-07 M-0825 + specialist-review take 2 (MED-3 fail-closed) + PR #182 retro audit (Task #57) REVOKE authenticated to close SECDEF probe-oracle. Returns TRUE iff a strategy is visible to an allocator. Org-scoped strategies require allocator to be a member of the owning organization. Orphaned orgs (no members) return FALSE (fail-closed; prior orphan-org fast-path was a visibility regression). SECURITY DEFINER + STABLE so callers can invoke in CHECK / trigger / cron contexts. EXECUTE restricted to service_role only (the INSERT-originating role for the BEFORE INSERT trigger on match_decisions); authenticated callers go through SECDEF RPC commit_scenario_batch which has EXECUTE via DEFINER ownership, not via role-level ACL.';



CREATE OR REPLACE FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_existing_id UUID;
  v_new_id      UUID;
  v_initial_status TEXT;
BEGIN
  IF (p_strategy_id IS NULL AND p_portfolio_id IS NULL)
     OR (p_strategy_id IS NOT NULL AND p_portfolio_id IS NOT NULL) THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id or p_portfolio_id must be non-null'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    v_initial_status := 'done_pending_children';
  ELSE
    v_initial_status := 'pending';
  END IF;

  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, kind, parent_job_ids,
    idempotency_key, exchange, metadata, status
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_kind, p_parent_job_ids,
    p_idempotency_key, p_exchange, p_metadata, v_initial_status
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE strategy_id = p_strategy_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
      WHERE portfolio_id = p_portfolio_id
        AND kind = p_kind
        AND status IN ('pending', 'running', 'done_pending_children')
      LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$$;


ALTER FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid" DEFAULT NULL::"uuid", "p_api_key_id" "uuid" DEFAULT NULL::"uuid", "p_run_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_existing_id UUID;
  v_new_id UUID;
  v_target_count INT;
BEGIN
  -- 4-way XOR guard (CHECK mirrors this; the function raises earlier with a
  -- clearer error message — defense in depth).
  v_target_count :=
    (CASE WHEN p_strategy_id  IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_portfolio_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_allocator_id IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN p_api_key_id   IS NOT NULL THEN 1 ELSE 0 END);
  IF v_target_count <> 1 THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, portfolio=%, allocator=%, api_key=%)',
      p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Optimistic look-up per target type.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_existing_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    RETURN v_existing_id;
  END IF;

  -- Race-safe INSERT — the partial unique index is the final arbiter.
  INSERT INTO compute_jobs (
    strategy_id, portfolio_id, allocator_id, api_key_id,
    kind, parent_job_ids, idempotency_key, exchange, metadata,
    next_attempt_at
  )
  VALUES (
    p_strategy_id, p_portfolio_id, p_allocator_id, p_api_key_id,
    p_kind, COALESCE(p_parent_job_ids, '{}'::uuid[]), p_idempotency_key,
    p_exchange, p_metadata,
    COALESCE(p_run_at, now())
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_new_id;

  IF v_new_id IS NOT NULL THEN
    RETURN v_new_id;
  END IF;

  -- Lost the race — re-read the winner's row.
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO STRICT v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  RETURN v_new_id;
END;
$$;


ALTER FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) IS 'Private shared implementation of the idempotent enqueue pattern. Handles all four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR on the four id parameters. Extended in migration 066 for api_key scope + scheduled run_at.';



CREATE OR REPLACE FUNCTION "public"."_match_decisions_visibility_check"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Only gate kinds that carry a strategy_id. voluntary_remove and
  -- voluntary_modify INSERT with strategy_id IS NULL per CHECK; the
  -- helper would short-circuit on NULL anyway.
  IF NEW.kind IN ('voluntary_add', 'bridge_recommended')
     AND NEW.strategy_id IS NOT NULL
     AND NEW.allocator_id IS NOT NULL THEN
    IF NOT public._assert_strategy_visible_to_allocator(NEW.strategy_id, NEW.allocator_id) THEN
      RAISE EXCEPTION
        'match_decisions visibility check: strategy % is not visible to allocator % (org-scoped, allocator not a member). audit-2026-05-07 M-0825.',
        NEW.strategy_id, NEW.allocator_id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."_match_decisions_visibility_check"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_match_decisions_visibility_check"() IS 'audit-2026-05-07 M-0825 + specialist-review take 2 (MED-2 search_path). BEFORE INSERT trigger function for match_decisions. Gates voluntary_add / bridge_recommended INSERTs on _assert_strategy_visible_to_allocator. Raises 42501 with strategy_id + allocator_id in the message on visibility failure. SET search_path = public, pg_catalog locks lookups.';



CREATE OR REPLACE FUNCTION "public"."_scoring_weight_overrides_is_valid"("p_overrides" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'pg_catalog'
    AS $$
  -- audit-2026-05-07 Phase C red-team #1 (CRITICAL): the whitelist
  -- MUST mirror analytics-service/services/feedback_engine.py's
  -- ALL_DIMENSIONS (lines 60-63) and match_engine.py's weight
  -- constants (lines 59-62 + score-blend at lines 773-795). The
  -- previous list was wrong (7 invented keys vs the engine's 4
  -- real keys) which would have (a) silently nulled every
  -- legitimate allocator_preferences row during backfill and
  -- (b) raised check_violation on every feedback engine UPDATE
  -- after apply, permanently breaking mandate adaptation.
  SELECT
    p_overrides IS NULL
    OR (
      jsonb_typeof(p_overrides) = 'object'
      AND NOT EXISTS (
        SELECT 1
          FROM jsonb_object_keys(p_overrides) AS k
         WHERE k NOT IN (
           'W_PORTFOLIO_FIT', 'W_PREFERENCE_FIT',
           'W_TRACK_RECORD',  'W_CAPACITY_FIT'
         )
      )
      AND NOT EXISTS (
        SELECT 1
          FROM jsonb_each(p_overrides) AS kv(key, value)
         WHERE jsonb_typeof(kv.value) <> 'number'
            OR CASE
                 WHEN jsonb_typeof(kv.value) = 'number'
                 THEN (kv.value::text)::numeric NOT BETWEEN 0.5 AND 1.5
                 ELSE false
               END
      )
    );
$$;


ALTER FUNCTION "public"."_scoring_weight_overrides_is_valid"("p_overrides" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_scoring_weight_overrides_is_valid"("p_overrides" "jsonb") IS 'audit-2026-05-07 H-0939 + Phase C red-team #1. IMMUTABLE shape validator for allocator_preferences.scoring_weight_overrides. Returns TRUE iff the argument is NULL or a JSONB object whose keys are all in {W_PORTFOLIO_FIT, W_PREFERENCE_FIT, W_TRACK_RECORD, W_CAPACITY_FIT} (matching analytics-service/services/feedback_engine.py ALL_DIMENSIONS and match_engine.py weight constants) and whose values are all JSON numbers in [0.5, 1.5] (matching the engine''s _clamp range). Coordinate any amendment with feedback_engine.py + match_engine.py + the backfill predicate + the table CHECK constraint.';



CREATE OR REPLACE FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) RETURNS "void"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_kind   text;
  v_pct    numeric;
  v_strat  text;
  v_pct_text text;
BEGIN
  -- (a) kind must be present and cast cleanly to the enum.
  v_kind := p_diff->>'kind';
  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: missing required field "kind"', p_index
      USING ERRCODE = '22023';
  END IF;

  BEGIN
    PERFORM v_kind::public.match_decision_kind;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: kind=% is not a valid match_decision_kind', p_index, v_kind
      USING ERRCODE = '22023';
  END;

  -- (b) per-kind required-field validation.
  IF v_kind = 'voluntary_remove' THEN
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_remove requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    IF p_diff->>'rejection_reason' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_remove requires "rejection_reason"', p_index
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'voluntary_add' THEN
    v_strat := p_diff->>'strategy_id';
    IF v_strat IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_add requires "strategy_id"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM v_strat::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy_id=% is not a valid UUID', p_index, v_strat
        USING ERRCODE = '22023';
    END;
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_add requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    -- audit-2026-05-07 MED-1: structured 22023 on non-numeric input.
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'voluntary_modify' THEN
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_modify requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: voluntary_modify requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    -- audit-2026-05-07 MED-1: structured 22023 on non-numeric input.
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSIF v_kind = 'bridge_recommended' THEN
    v_strat := p_diff->>'strategy_id';
    IF v_strat IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "strategy_id"', p_index
        USING ERRCODE = '22023';
    END IF;
    BEGIN
      PERFORM v_strat::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy_id=% is not a valid UUID', p_index, v_strat
        USING ERRCODE = '22023';
    END;
    IF p_diff->>'holding_ref' IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "holding_ref"', p_index
        USING ERRCODE = '22023';
    END IF;
    v_pct_text := p_diff->>'percent_allocated';
    IF v_pct_text IS NULL THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: bridge_recommended requires "percent_allocated"', p_index
        USING ERRCODE = '22023';
    END IF;
    -- audit-2026-05-07 MED-1: structured 22023 on non-numeric input.
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 1 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,1]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSE
    -- Defensive: enum cast above should have caught this.
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: unhandled kind=% (helper needs update)', p_index, v_kind
      USING ERRCODE = '22023';
  END IF;
END;
$$;


ALTER FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) IS 'audit-2026-05-07 M-0826 + specialist-review take 2 (MED-1 numeric cast hardening + MED-2 search_path). Per-diff schema validation helper for commit_scenario_batch. Validates kind against match_decision_kind enum and per-kind required fields. ALL numeric casts wrapped in BEGIN/EXCEPTION so non-numeric input raises structured 22023 with per-diff index — preserves the DX contract end-to-end.';



CREATE OR REPLACE FUNCTION "public"."bridge_outcomes_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'UPDATE' AND (
       NEW.allocated_at       IS DISTINCT FROM OLD.allocated_at
       OR NEW.percent_allocated IS DISTINCT FROM OLD.percent_allocated
       OR NEW.kind              IS DISTINCT FROM OLD.kind
     ) THEN
    NEW.needs_recompute       := TRUE;
    NEW.delta_30d             := NULL;
    NEW.delta_90d             := NULL;
    NEW.delta_180d            := NULL;
    NEW.estimated_delta_bps   := NULL;
    NEW.estimated_days        := NULL;
    NEW.deltas_computed_at    := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bridge_outcomes_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bridge_outcomes_sync_holding_ref"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.match_decision_id IS NOT NULL THEN
    SELECT original_holding_ref
      INTO NEW.original_holding_ref
      FROM match_decisions
     WHERE id = NEW.match_decision_id;
  ELSE
    NEW.original_holding_ref := NULL;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."bridge_outcomes_sync_holding_ref"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."bridge_outcomes_sync_holding_ref"() IS 'Phase 09 / finding f4. BEFORE INSERT OR UPDATE OF match_decision_id trigger function that denormalizes match_decisions.original_holding_ref into bridge_outcomes. SECURITY DEFINER + locked search_path; reads match_decisions by PK only (parameterized). Returns NEW with original_holding_ref populated or NULL when match_decision_id is NULL.';



CREATE OR REPLACE FUNCTION "public"."check_fan_in_ready"("p_child_job_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_parent_ids    UUID[];
  v_unready_count INTEGER;
BEGIN
  SELECT parent_job_ids
    INTO v_parent_ids
    FROM compute_jobs
    WHERE id = p_child_job_id;

  IF NOT FOUND THEN
    RAISE NOTICE 'check_fan_in_ready: child job % missing — possible orphan parent_job_ids reference', p_child_job_id;
    RETURN false;
  END IF;

  IF v_parent_ids IS NULL THEN
    RETURN false;
  END IF;

  IF array_length(v_parent_ids, 1) IS NULL OR array_length(v_parent_ids, 1) = 0 THEN
    RETURN true;
  END IF;

  SELECT count(*) INTO v_unready_count
    FROM compute_jobs
    WHERE id = ANY(v_parent_ids)
      AND status <> 'done';

  RETURN v_unready_count = 0;
END;
$$;


ALTER FUNCTION "public"."check_fan_in_ready"("p_child_job_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_fan_in_ready"("p_child_job_id" "uuid") IS 'Returns true when every parent job of the child is status=done. Used by fan-in advancement. See migration 032.';



CREATE OR REPLACE FUNCTION "public"."check_strategy_api_key_ownership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
BEGIN
  -- Skip the check when the strategy has no linked key (draft + CSV paths).
  IF NEW.api_key_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Short-circuit when an UPDATE doesn't actually change api_key_id. Saves
  -- a round-trip to api_keys on every form round-trip write, and prevents
  -- pointless trigger fires on bulk updates that touch other columns.
  IF TG_OP = 'UPDATE'
    AND NEW.api_key_id IS NOT DISTINCT FROM OLD.api_key_id
    AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
  THEN
    RETURN NEW;
  END IF;

  -- Assert the linked key belongs to the same user as the strategy.
  -- SECURITY DEFINER bypasses RLS so the EXISTS sees the raw ownership
  -- truth. Schema-qualified `public.api_keys` + restricted search_path
  -- prevent any session-level manipulation from redirecting the lookup.
  -- `FOR SHARE` locks the api_keys row for the duration of the transaction
  -- so a concurrent DELETE cannot race between check and commit.
  IF NOT EXISTS (
    SELECT 1
    FROM public.api_keys
    WHERE id = NEW.api_key_id
      AND user_id = NEW.user_id
    FOR SHARE
  ) THEN
    RAISE EXCEPTION
      'api_key_id % does not belong to user % (cross-tenant linkage blocked by migration 028/029)',
      NEW.api_key_id, NEW.user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_strategy_api_key_ownership"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."check_strategy_api_key_ownership"() IS 'Enforces api_keys.user_id = strategies.user_id on strategies INSERT/UPDATE. Hardened in migration 029 (short-circuit, FOR SHARE, schema-qualified).';


SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."compute_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid",
    "portfolio_id" "uuid",
    "kind" "text" NOT NULL,
    "parent_job_ids" "uuid"[] DEFAULT '{}'::"uuid"[] NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "next_attempt_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claimed_at" timestamp with time zone,
    "claimed_by" "text",
    "last_error" "text",
    "error_kind" "text",
    "idempotency_key" "text",
    "exchange" "text",
    "trade_count" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "metadata" "jsonb",
    "allocator_id" "uuid",
    "api_key_id" "uuid",
    "priority" "text" DEFAULT 'normal'::"text" NOT NULL,
    "reclaim_count" integer DEFAULT 0 NOT NULL,
    "claim_token" "uuid",
    CONSTRAINT "compute_jobs_attempts_non_negative" CHECK (("attempts" >= 0)),
    CONSTRAINT "compute_jobs_claimed_by_safe" CHECK ((("claimed_by" IS NULL) OR (("length"("claimed_by") <= 128) AND ("claimed_by" ~ '^[A-Za-z0-9_:./-]+$'::"text")))),
    CONSTRAINT "compute_jobs_error_kind_check" CHECK (("error_kind" = ANY (ARRAY['transient'::"text", 'permanent'::"text", 'unknown'::"text"]))),
    CONSTRAINT "compute_jobs_exchange_check" CHECK ((("exchange" IS NULL) OR ("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text"])))),
    CONSTRAINT "compute_jobs_idempotency_key_safe" CHECK ((("idempotency_key" IS NULL) OR (("length"("idempotency_key") <= 128) AND ("idempotency_key" ~ '^[A-Za-z0-9_:.-]+$'::"text")))),
    CONSTRAINT "compute_jobs_kind_check" CHECK (("kind" = ANY (ARRAY['sync_trades'::"text", 'compute_analytics'::"text", 'compute_portfolio'::"text", 'poll_positions'::"text", 'sync_funding'::"text", 'reconcile_strategy'::"text", 'compute_intro_snapshot'::"text", 'rescore_allocator'::"text", 'poll_allocator_positions'::"text", 'reconstruct_allocator_history'::"text", 'refresh_allocator_equity_daily'::"text", 'process_key_long'::"text", 'compute_analytics_from_csv'::"text"]))),
    CONSTRAINT "compute_jobs_kind_target_coherence" CHECK (((("kind" = 'compute_portfolio'::"text") AND ("portfolio_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'rescore_allocator'::"text") AND ("allocator_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL)) OR (("kind" = ANY (ARRAY['sync_trades'::"text", 'compute_analytics'::"text", 'poll_positions'::"text", 'sync_funding'::"text", 'reconcile_strategy'::"text", 'compute_intro_snapshot'::"text", 'compute_analytics_from_csv'::"text"])) AND ("strategy_id" IS NOT NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'poll_allocator_positions'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'reconstruct_allocator_history'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'refresh_allocator_equity_daily'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'process_key_long'::"text") AND ("strategy_id" IS NOT NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL) AND ("api_key_id" IS NULL)))),
    CONSTRAINT "compute_jobs_max_attempts_positive" CHECK (("max_attempts" > 0)),
    CONSTRAINT "compute_jobs_metadata_size_bounded" CHECK ((("metadata" IS NULL) OR ("octet_length"(("metadata")::"text") <= 8192))),
    CONSTRAINT "compute_jobs_priority_check" CHECK (("priority" = ANY (ARRAY['low'::"text", 'normal'::"text", 'high'::"text"]))),
    CONSTRAINT "compute_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'done_pending_children'::"text", 'failed_retry'::"text", 'failed_final'::"text"]))),
    CONSTRAINT "compute_jobs_target_xor" CHECK (((("strategy_id" IS NOT NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL) AND ("api_key_id" IS NULL)) OR (("strategy_id" IS NULL) AND ("portfolio_id" IS NOT NULL) AND ("allocator_id" IS NULL) AND ("api_key_id" IS NULL)) OR (("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NOT NULL) AND ("api_key_id" IS NULL)) OR (("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL) AND ("api_key_id" IS NOT NULL)))),
    CONSTRAINT "compute_jobs_trade_count_non_negative" CHECK ((("trade_count" IS NULL) OR ("trade_count" >= 0)))
);

ALTER TABLE ONLY "public"."compute_jobs" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."compute_jobs" OWNER TO "postgres";


COMMENT ON TABLE "public"."compute_jobs" IS 'Durable compute job queue. Shared across sync_trades, compute_analytics, compute_portfolio kinds. Fan-in via parent_job_ids. Service-role only (RLS deny-all + SECURITY DEFINER helpers). See migration 032.';



COMMENT ON COLUMN "public"."compute_jobs"."parent_job_ids" IS 'UUIDs of parent jobs this child waits on. Empty for leaf jobs (e.g. a single sync_trades for a single-exchange strategy). Populated for compute_analytics children waiting on multiple sync_trades parents in multi-exchange strategies. See check_fan_in_ready().';



COMMENT ON COLUMN "public"."compute_jobs"."error_kind" IS 'Classification used by mark_compute_job_failed to decide retry vs final. transient = retry per backoff schedule. permanent = skip retries, go directly to failed_final. unknown = retry (default for uncategorized errors).';



COMMENT ON COLUMN "public"."compute_jobs"."idempotency_key" IS 'Optional caller-supplied correlation key (e.g. wizard-submit-<ulid>). NOT enforced at the DB level at all. Real idempotency is provided by the partial unique indexes on (strategy_id, kind) and (portfolio_id, kind), which guarantee only one in-flight row per target+kind. idempotency_key is purely for client-side correlation and appears in logs and admin UI.';



COMMENT ON COLUMN "public"."compute_jobs"."exchange" IS 'Exchange name for sync_trades kind (binance/okx/bybit). NULL for compute_analytics and compute_portfolio. Used by observability queries and the per-exchange circuit breaker. Value space is enforced by the CHECK constraint on the column.';



COMMENT ON COLUMN "public"."compute_jobs"."trade_count" IS 'Populated by sync_trades workers after a successful fetch. NULL for pending/running jobs and for non-sync_trades kinds. Observability only — not referenced by any state-machine logic.';



COMMENT ON COLUMN "public"."compute_jobs"."allocator_id" IS 'Allocator scope for the rescore_allocator kind. Mirrors the existing strategy_id/portfolio_id pattern — exactly one of the three target columns is non-null per compute_jobs_target_xor. Phase 3 / D-12 Option B.';



COMMENT ON COLUMN "public"."compute_jobs"."api_key_id" IS 'API key scope for the poll_allocator_positions kind (INGEST-02). One allocator can have N keys; each key gets its own polling cadence + circuit-breaker state. Phase 06.';



COMMENT ON COLUMN "public"."compute_jobs"."priority" IS 'Dispatch priority. low = post-deploy backfill (throttled to 5/min when normal/high pending). normal = live sync_trades + first-class compute_analytics. high = manual force-recompute. Read by claim_compute_jobs_with_priority(). See migration 086.';



COMMENT ON COLUMN "public"."compute_jobs"."claim_token" IS 'audit-2026-05-07 P97 / G12.A.2 — fencing token written by claim_compute_jobs[_with_priority] on every claim and NULLed by reset_stalled_compute_jobs on every reclaim. mark_compute_job_done and mark_compute_job_failed verify p_claim_token matches before flipping. See migration 117.';



COMMENT ON CONSTRAINT "compute_jobs_attempts_non_negative" ON "public"."compute_jobs" IS 'audit-2026-05-07 M-0772 / G10: bound attempts >= 0 so the backoff CASE schedule in mark_compute_job_failed cannot be tricked by a negative-value INSERT/UPDATE.';



COMMENT ON CONSTRAINT "compute_jobs_claimed_by_safe" ON "public"."compute_jobs" IS 'audit-2026-05-07 H-0857. Bound claimed_by to <=128 chars and a safe charset. Defense-in-depth against a future REVOKE relaxation that would let any caller impersonate any worker_id via claim_compute_jobs[_with_priority].';



COMMENT ON CONSTRAINT "compute_jobs_kind_check" ON "public"."compute_jobs" IS 'Simple list-form kind admission check. 2026-05-25: extended with compute_analytics_from_csv to close the 19.1/02 lockstep gap (the sibling compute_jobs_kind_target_coherence already had the kind since 20260522120100).';



COMMENT ON CONSTRAINT "compute_jobs_kind_target_coherence" ON "public"."compute_jobs" IS 'Kind<->target-type coherence. Phase 19.1 / Task 2: compute_analytics_from_csv branch added (strategy-scoped).';



COMMENT ON CONSTRAINT "compute_jobs_max_attempts_positive" ON "public"."compute_jobs" IS 'audit-2026-05-07 M-0772 / G10: bound max_attempts > 0 so a row cannot be marked failed_final on its zero-th attempt.';



COMMENT ON CONSTRAINT "compute_jobs_metadata_size_bounded" ON "public"."compute_jobs" IS 'audit-2026-05-07 H-0849. Bounds compute_jobs.metadata pg_column_size at 8 KB so a compromised service-role token cannot DoS the heap by writing megabyte-sized JSONB blobs. Generous ceiling: current writers stay below 512 B.';



COMMENT ON CONSTRAINT "compute_jobs_target_xor" ON "public"."compute_jobs" IS '4-way XOR — exactly one of strategy_id, portfolio_id, allocator_id, api_key_id is non-null. Extended from migration 062 3-way in migration 066 for poll_allocator_positions.';



COMMENT ON CONSTRAINT "compute_jobs_trade_count_non_negative" ON "public"."compute_jobs" IS 'audit-2026-05-07 M-0772 / G10: bound observability trade_count to NULL or non-negative.';



CREATE OR REPLACE FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") RETURNS SETOF "public"."compute_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, portfolio_id, strategy_id, allocator_id, api_key_id, next_attempt_at,
           row_number() OVER (PARTITION BY kind, portfolio_id ORDER BY next_attempt_at) AS rn_p,
           row_number() OVER (PARTITION BY kind, strategy_id  ORDER BY next_attempt_at) AS rn_s,
           row_number() OVER (PARTITION BY kind, allocator_id ORDER BY next_attempt_at) AS rn_a,
           row_number() OVER (PARTITION BY kind, api_key_id   ORDER BY next_attempt_at) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id  IS NULL OR rn_p = 1)
      AND (strategy_id   IS NULL OR rn_s = 1)
      AND (allocator_id  IS NULL OR rn_a = 1)
      AND (api_key_id    IS NULL OR rn_k = 1)
      -- C39 / NEW-C39-01: exclude candidates whose partition already has
      -- an inflight (running or done_pending_children) row. Without this
      -- guard a failed_retry row can coexist with a done_pending_children
      -- row for the same (kind, partition_col) and the batch UPDATE that
      -- flips failed_retry → running violates the partial unique index
      -- (23505). The guard is per-partition-column; NULL partition columns
      -- are skipped (they are excluded from the relevant index predicate).
      AND (portfolio_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.portfolio_id = ranked.portfolio_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (strategy_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind        = ranked.kind
           AND x.strategy_id = ranked.strategy_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (allocator_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind         = ranked.kind
           AND x.allocator_id = ranked.allocator_id
           AND x.status IN ('running', 'done_pending_children')
      ))
      AND (api_key_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM compute_jobs x
         WHERE x.kind       = ranked.kind
           AND x.api_key_id = ranked.api_key_id
           AND x.status IN ('running', 'done_pending_children')
      ))
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid()    -- mig 117: P97 fence
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
        AND cj.status IN ('pending', 'failed_retry')  -- H-1/M-1: re-check status after CTE snapshot+lock to guard against concurrent status transitions
      ORDER BY cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") IS 'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition keys; migration 117 adds claim_token = gen_random_uuid() (P97 fence). Migration C39 / NEW-C39-01: the deduped CTE now excludes candidates whose (kind, partition_col) already has a running or done_pending_children row, closing the 23505 collision vector between failed_retry and done_pending_children that migrations 090 and 117 left open. FOR UPDATE SKIP LOCKED concurrency preserved. See migrations 032, 089, 090, 117, C39.';



CREATE OR REPLACE FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text") RETURNS SETOF "public"."compute_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_high_pending INTEGER;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status IN ('pending', 'failed_retry')
     AND next_attempt_at <= now();

  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END AS pri_rank,
           row_number() OVER (
             PARTITION BY kind, portfolio_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_p,
           row_number() OVER (
             PARTITION BY kind, strategy_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_s,
           row_number() OVER (
             PARTITION BY kind, allocator_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_a,
           row_number() OVER (
             PARTITION BY kind, api_key_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      AND (strategy_id  IS NULL OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
  )
  UPDATE compute_jobs
     SET status     = 'running',
         claimed_at = now(),
         claimed_by = p_worker_id,
         attempts   = attempts + 1
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
      ORDER BY
        CASE cj.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text") IS 'Priority-aware claim: prefers high then normal, throttles low when any normal/high pending. Migration 090 dedupes by partition keys (portfolio_id, strategy_id, allocator_id, api_key_id) so two failed_retry rows sharing a partition cannot 23505 on the partial inflight indices inside a single batch UPDATE. SECURITY DEFINER + SET search_path = public, pg_temp (H-B). See migrations 086, 089, 090.';



CREATE OR REPLACE FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean DEFAULT NULL::boolean) RETURNS SETOF "public"."compute_jobs"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_high_pending INTEGER;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size must be > 0, got %', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_batch_size > 1000 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_batch_size % exceeds cap of 1000', p_batch_size
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_worker_id IS NULL OR length(p_worker_id) = 0 THEN
    RAISE EXCEPTION 'claim_compute_jobs_with_priority: p_worker_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT count(*) INTO v_high_pending
    FROM compute_jobs
   WHERE priority IN ('normal','high')
     AND status = 'pending'
     AND next_attempt_at <= now();

  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           row_number() OVER (
             PARTITION BY kind, portfolio_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_p,
           row_number() OVER (
             PARTITION BY kind, strategy_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_s,
           row_number() OVER (
             PARTITION BY kind, allocator_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_a,
           row_number() OVER (
             PARTITION BY kind, api_key_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at
           ) AS rn_k
    FROM compute_jobs
    WHERE status = 'pending'
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      AND (strategy_id  IS NULL OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
  )
  UPDATE compute_jobs
     SET status      = 'running',
         claimed_at  = now(),
         claimed_by  = p_worker_id,
         attempts    = attempts + 1,
         claim_token = gen_random_uuid(),
         metadata    = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
           'unified_backbone_at_claim',
           COALESCE(metadata->>'unified_backbone_at_claim',
                    CASE WHEN p_unified_backbone_active IS NULL THEN NULL
                         ELSE p_unified_backbone_active::text
                    END)
         )
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
      ORDER BY
        CASE cj.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        cj.next_attempt_at
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean) IS 'Migration 117: P97 / G12.A.2 fence — claim_token = gen_random_uuid() on every claim. Preserves Phase 19 unified_backbone_at_claim metadata. See migration 117.';



CREATE OR REPLACE FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_request_hash" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_caller            uuid := auth.uid();
  v_diff              jsonb;
  v_index             int := 0;
  v_kind              text;
  v_md_id             uuid;
  v_bo_id             uuid;
  v_recorded          jsonb := '[]'::jsonb;
  v_holding_owner_ct  int;
  v_strategy_status   text;
  v_inserted_count    int;
  v_cached_hash       text;
  v_cached_response   jsonb;
  v_cached_version    smallint;
  v_batch_length      int;
BEGIN
  -- (1) Defence-in-depth: caller must match the p_allocator_id arg.
  IF v_caller IS NULL OR v_caller <> p_allocator_id THEN
    RAISE EXCEPTION 'commit_scenario_batch: unauthorized — auth.uid() <> p_allocator_id'
      USING ERRCODE = '42501';
  END IF;

  -- (2) Idempotency reservation (mig 131 / Block D F.2).
  -- audit-2026-05-07 Q#6 audit-A: the (3) 50-diff cap below runs AFTER
  -- this block so a retry with the same Idempotency-Key returns the
  -- cached envelope (or idempotency_body_mismatch on hash mismatch)
  -- instead of being intercepted with a 22023 cap error. First-ever
  -- calls with oversized bodies still hit the cap and roll back the
  -- 'in_flight' reservation atomically since the cap raises before any
  -- mutating work runs.
  IF p_idempotency_key IS NOT NULL THEN
    IF p_request_hash IS NULL OR length(p_request_hash) <> 64 THEN
      RAISE EXCEPTION 'commit_scenario_batch: p_idempotency_key requires a 64-char p_request_hash'
        USING ERRCODE = '22023';
    END IF;

    INSERT INTO scenario_commit_idempotency (
      allocator_id, idempotency_key, request_hash, response, schema_version
    ) VALUES (
      p_allocator_id, p_idempotency_key, p_request_hash,
      jsonb_build_object('_status', 'in_flight'),
      0
    )
    ON CONFLICT (allocator_id, idempotency_key) DO NOTHING;

    GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

    IF v_inserted_count = 0 THEN
      SELECT request_hash, response, schema_version
        INTO v_cached_hash, v_cached_response, v_cached_version
        FROM scenario_commit_idempotency
       WHERE allocator_id    = p_allocator_id
         AND idempotency_key = p_idempotency_key;

      IF v_cached_hash <> p_request_hash THEN
        RETURN jsonb_build_object(
          'ok', false,
          'errors', jsonb_build_array(jsonb_build_object(
            'index', -1,
            'error', 'Idempotency-Key reuse with different body',
            'code', 'idempotency_body_mismatch'
          ))
        );
      END IF;

      IF v_cached_version = 0 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'errors', jsonb_build_array(jsonb_build_object(
            'index', -1,
            'error', 'Idempotent commit is already in flight; retry shortly',
            'code', 'idempotency_in_flight'
          ))
        );
      END IF;

      IF v_cached_version = 1 THEN
        RETURN jsonb_build_object(
          'ok', true,
          'cached', true,
          'recorded', COALESCE(v_cached_response->'results', '[]'::jsonb)
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array(jsonb_build_object(
          'index', -1,
          'error', 'Cached response has an unknown schema_version',
          'code', 'idempotency_schema_drift'
        ))
      );
    END IF;
  END IF;

  -- (3) audit-2026-05-07 H-0976 + H-0977: 50-diff cap inside the RPC
  -- mirroring the route layer's zod-enforced cap. A direct
  -- supabase.rpc('commit_scenario_batch', ...) call from an authenticated
  -- session that bypasses the Next.js route cannot DoS the RPC by
  -- pushing a 100k-element array. Fires AFTER (2) so retries can be
  -- served from the idempotency cache before payload validation can
  -- mask the cached state (audit-A Q#6).
  IF jsonb_typeof(p_diffs) <> 'array' THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a jsonb array'
      USING ERRCODE = '22023';
  END IF;
  v_batch_length := jsonb_array_length(p_diffs);
  IF v_batch_length = 0 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs must be a non-empty jsonb array'
      USING ERRCODE = '22023';
  END IF;
  IF v_batch_length > 50 THEN
    RAISE EXCEPTION 'commit_scenario_batch: p_diffs exceeds the 50-diff per-batch cap (got %). audit-2026-05-07 H-0976.', v_batch_length
      USING ERRCODE = '22023';
  END IF;

  -- (4) Iterate diffs.
  FOR v_diff IN SELECT * FROM jsonb_array_elements(p_diffs) LOOP
    v_kind := v_diff->>'kind';

    IF v_kind = 'voluntary_remove' THEN
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue        = hp.venue
         AND ah.symbol       = hp.symbol
         AND ah.holding_type = hp.holding_type
         AND ah.asof = (
           SELECT MAX(asof) FROM allocator_holdings ah2
            WHERE ah2.allocator_id = p_allocator_id
              AND ah2.venue        = hp.venue
              AND ah2.symbol       = hp.symbol
              AND ah2.holding_type = hp.holding_type
         )
         AND ah.value_usd > 0;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, NULL, 'snoozed', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'voluntary_remove'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, rejection_reason
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'rejected', v_diff->>'rejection_reason'
      )
      RETURNING id INTO v_bo_id;

    ELSIF v_kind = 'voluntary_add' THEN
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, (v_diff->>'strategy_id')::uuid, 'snoozed', p_allocator_id,
        NULL, NULL, 'voluntary_add'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, (v_diff->>'strategy_id')::uuid,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    ELSIF v_kind = 'voluntary_modify' THEN
      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue        = hp.venue
         AND ah.symbol       = hp.symbol
         AND ah.holding_type = hp.holding_type
         AND ah.asof = (
           SELECT MAX(asof) FROM allocator_holdings ah2
            WHERE ah2.allocator_id = p_allocator_id
              AND ah2.venue        = hp.venue
              AND ah2.symbol       = hp.symbol
              AND ah2.holding_type = hp.holding_type
         )
         AND ah.value_usd > 0;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, NULL, 'snoozed', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'voluntary_modify'
      )
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, NULL,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    ELSIF v_kind = 'bridge_recommended' THEN
      SELECT status INTO v_strategy_status
        FROM strategies WHERE id = (v_diff->>'strategy_id')::uuid;
      IF v_strategy_status IS NULL OR v_strategy_status <> 'published' THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: strategy % not found or not published',
                        v_index, v_diff->>'strategy_id'
          USING ERRCODE = '23514';
      END IF;

      SELECT COUNT(*) INTO v_holding_owner_ct
        FROM allocator_holdings ah
        JOIN LATERAL public.parse_holding_ref(v_diff->>'holding_ref') hp ON TRUE
       WHERE ah.allocator_id = p_allocator_id
         AND ah.venue        = hp.venue
         AND ah.symbol       = hp.symbol
         AND ah.holding_type = hp.holding_type
         AND ah.asof = (
           SELECT MAX(asof) FROM allocator_holdings ah2
            WHERE ah2.allocator_id = p_allocator_id
              AND ah2.venue        = hp.venue
              AND ah2.symbol       = hp.symbol
              AND ah2.holding_type = hp.holding_type
         )
         AND ah.value_usd > 0;
      IF v_holding_owner_ct = 0 THEN
        RAISE EXCEPTION 'commit_scenario_batch[index=%]: holding_ref % not owned by allocator',
                        v_index, v_diff->>'holding_ref'
          USING ERRCODE = '42501';
      END IF;

      INSERT INTO match_decisions (
        allocator_id, strategy_id, decision, decided_by,
        original_strategy_id, original_holding_ref, kind
      )
      VALUES (
        p_allocator_id, (v_diff->>'strategy_id')::uuid,
        'thumbs_up', p_allocator_id,
        NULL, v_diff->>'holding_ref', 'bridge_recommended'
      )
      ON CONFLICT (allocator_id, strategy_id, COALESCE(original_holding_ref, ''))
        WHERE decision = 'thumbs_up'
        DO UPDATE SET decided_by = EXCLUDED.decided_by
      RETURNING id INTO v_md_id;

      INSERT INTO bridge_outcomes (
        allocator_id, match_decision_id, strategy_id,
        kind, percent_allocated, allocated_at
      )
      VALUES (
        p_allocator_id, v_md_id, (v_diff->>'strategy_id')::uuid,
        'allocated',
        (v_diff->>'percent_allocated')::numeric,
        COALESCE((v_diff->>'effective_date')::date, CURRENT_DATE)
      )
      RETURNING id INTO v_bo_id;

    ELSE
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: unknown kind %',
                      v_index, v_kind
        USING ERRCODE = '22023';
    END IF;

    v_recorded := v_recorded || jsonb_build_object(
      'index', v_index,
      'match_decision_id', v_md_id,
      'bridge_outcome_id', v_bo_id,
      'kind', v_kind
    );
    v_index := v_index + 1;
  END LOOP;

  -- (4) mig 131 idempotency-cache UPDATE — replace placeholder with
  -- final response so the next retry short-circuits to the cached
  -- envelope.
  IF p_idempotency_key IS NOT NULL THEN
    UPDATE scenario_commit_idempotency
       SET response = jsonb_build_object(
             'recorded', jsonb_array_length(v_recorded),
             'results', v_recorded,
             'errors', '[]'::jsonb
           ),
           schema_version = 1
     WHERE allocator_id    = p_allocator_id
       AND idempotency_key = p_idempotency_key;
  END IF;

  -- audit-2026-05-07 H-0974: emit one scenario.commit audit_log row
  -- per successful batch. Attribute to the allocator. Metadata carries
  -- the recorded count + idempotency_key (when supplied) so the
  -- forensic trail joins the route-layer audit on the same key.
  --
  -- Fail-soft: a log_audit_event_service failure (e.g., mig 123 32 KB
  -- ceiling, role-gate denial, partial replay) emits RAISE NOTICE but
  -- does NOT roll back the commit. The commit is the durable user-
  -- visible action; missing audit is a follow-up to investigate, not
  -- a reason to fail the allocator's scenario commit.
  --
  -- NOTE: log_audit_event_service is bound to (UUID, TEXT, TEXT, UUID,
  -- JSONB). We pass p_allocator_id as both subject (user_id) and
  -- entity_id (the scenario commit is allocator-scoped). entity_type
  -- 'allocator' matches the audit_log readers' convention for
  -- allocator-scoped actions.
  BEGIN
    PERFORM public.log_audit_event_service(
      p_allocator_id,
      'scenario.commit',
      'allocator',
      p_allocator_id,
      jsonb_build_object(
        'recorded',         jsonb_array_length(v_recorded),
        'idempotency_key',  p_idempotency_key,
        'request_hash',     p_request_hash,
        'kinds',            (
          SELECT jsonb_agg(elem->>'kind' ORDER BY (elem->>'index')::int)
            FROM jsonb_array_elements(v_recorded) AS elem
        )
      )
    );
  EXCEPTION
    WHEN unique_violation
      OR check_violation
      OR string_data_right_truncation
      OR numeric_value_out_of_range
      OR insufficient_privilege THEN
      -- Narrow trap (see Q#3 audit-A finding): swallow only audit-shape /
      -- size / role-gate failures so the scenario commit completes;
      -- schema-drift errors (42703 undefined_column / 42P01 undefined_table /
      -- 42883 undefined_function) propagate so they surface loudly instead
      -- of silently dropping the scenario.commit audit_log row.
      RAISE NOTICE 'audit-2026-05-07 H-0974: scenario.commit audit emission failed for allocator % (sqlstate=%, msg=%); commit succeeded',
        p_allocator_id, SQLSTATE, SQLERRM;
  END;

  RETURN jsonb_build_object('ok', true, 'recorded', v_recorded);
END;
$$;


ALTER FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text") IS 'audit-2026-05-07 H-0974 / H-0976 / H-0977 + mig 131 idempotency dedup. SECURITY DEFINER RPC that commits a batch of <=50 scenario diffs in a single Postgres transaction. auth.uid() = p_allocator_id guard. Per-row ownership probe with asof + value_usd > 0 filter (mig 128 P1957). voluntary_modify uses single canonical percent_allocated encoding (mig 128 P1956). Idempotency-Key reservation lives in the same tx as the data inserts (mig 131). On success, emits one scenario.commit audit_log row attributed to the allocator (fail-soft).';



CREATE OR REPLACE FUNCTION "public"."compute_bridge_outcome_deltas"() RETURNS TABLE("updated_count" integer, "failed_count" integer, "batch_started_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_updated INT := 0;
  v_failed  INT := 0;
  v_started TIMESTAMPTZ := NOW();
BEGIN
  WITH
  -- ---------------- strategy branch (verbatim from migration 073) ----------------
  strategy_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    LEFT JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND (
        bo.match_decision_id IS NULL
        OR (md.original_strategy_id IS NOT NULL AND md.original_holding_ref IS NULL)
      )
  ),
  strategy_computed AS (
    SELECT
      c.id,
      public.extract_delta(c.series, c.allocated_at, 30)  AS d30,
      public.extract_delta(c.series, c.allocated_at, 90)  AS d90,
      public.extract_delta(c.series, c.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM strategy_candidates c
    LEFT JOIN LATERAL public.extract_estimated(c.series, c.allocated_at) AS est ON TRUE
  ),
  strategy_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM strategy_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- ---------------- holding branch (verbatim from migration 073) ----------------
  holding_candidates AS (
    SELECT
      bo.id,
      bo.allocator_id,
      bo.allocated_at,
      hp.symbol
    FROM public.bridge_outcomes bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    LEFT JOIN LATERAL public.parse_holding_ref(md.original_holding_ref) hp ON TRUE
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND md.original_strategy_id IS NULL
      AND md.original_holding_ref IS NOT NULL
      AND hp.symbol IS NOT NULL
  ),
  holding_computed AS (
    SELECT
      hc.id,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 30) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d30,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 90) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d90,
      CASE
        WHEN public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at) IS NULL
          OR public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) IS NULL
        THEN NULL
        ELSE (
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at + 180) /
          public.extract_symbol_value_at(hc.allocator_id, hc.symbol, hc.allocated_at)
        ) - 1
      END AS d180
    FROM holding_candidates hc
  ),
  holding_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d          = COALESCE(hc.d30,  bo.delta_30d),
      delta_90d          = COALESCE(hc.d90,  bo.delta_90d),
      delta_180d         = COALESCE(hc.d180, bo.delta_180d),
      needs_recompute    = FALSE,
      deltas_computed_at = v_started
    FROM holding_computed hc
    WHERE bo.id = hc.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  ),
  -- ---------------- voluntary_add branch (NEW — Phase 10 / H2) ----------------
  -- voluntary_add rows: md.kind='voluntary_add', original_* both NULL,
  -- strategy_id (the suggested strategy) NOT NULL. Match against
  -- strategy_analytics.returns_series the same way the strategy branch does — but
  -- gate on md.kind='voluntary_add' to be unambiguous and avoid double-counting
  -- bridge_recommended rows that the strategy branch already covers.
  voluntary_add_candidates AS (
    SELECT
      bo.id,
      bo.allocated_at,
      sa.returns_series AS series
    FROM public.bridge_outcomes AS bo
    JOIN public.match_decisions md ON md.id = bo.match_decision_id
    JOIN public.strategy_analytics sa ON sa.strategy_id = bo.strategy_id
    WHERE bo.kind = 'allocated'
      AND bo.allocated_at IS NOT NULL
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
      AND md.kind = 'voluntary_add'
      AND md.strategy_id IS NOT NULL
      AND md.original_holding_ref IS NULL
      AND md.original_strategy_id IS NULL
  ),
  voluntary_add_computed AS (
    SELECT
      vc.id,
      public.extract_delta(vc.series, vc.allocated_at, 30)  AS d30,
      public.extract_delta(vc.series, vc.allocated_at, 90)  AS d90,
      public.extract_delta(vc.series, vc.allocated_at, 180) AS d180,
      est.bps  AS est_bps,
      est.days AS est_days
    FROM voluntary_add_candidates vc
    LEFT JOIN LATERAL public.extract_estimated(vc.series, vc.allocated_at) AS est ON TRUE
  ),
  voluntary_add_updated AS (
    UPDATE public.bridge_outcomes AS bo
    SET
      delta_30d           = COALESCE(c.d30,      bo.delta_30d),
      delta_90d           = COALESCE(c.d90,      bo.delta_90d),
      delta_180d          = COALESCE(c.d180,     bo.delta_180d),
      estimated_delta_bps = COALESCE(c.est_bps,  bo.estimated_delta_bps),
      estimated_days      = COALESCE(c.est_days, bo.estimated_days),
      needs_recompute     = FALSE,
      deltas_computed_at  = v_started
    FROM voluntary_add_computed c
    WHERE bo.id = c.id
      AND bo.kind = 'allocated'
      AND (bo.delta_30d IS NULL OR bo.needs_recompute = TRUE)
    RETURNING bo.id
  )
  SELECT
    (SELECT COUNT(*)::INT FROM strategy_updated) +
    (SELECT COUNT(*)::INT FROM holding_updated) +
    (SELECT COUNT(*)::INT FROM voluntary_add_updated)
  INTO v_updated;

  RETURN QUERY SELECT v_updated, v_failed, v_started;
END;
$$;


ALTER FUNCTION "public"."compute_bridge_outcome_deltas"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."compute_bridge_outcome_deltas"() IS 'Daily batch: realized 30/90/180-day deltas for bridge_outcomes where kind=''allocated'' AND (delta_30d IS NULL OR needs_recompute=TRUE). Phase 10 extension (migration 080): adds voluntary_add CTE branch matching md.kind=''voluntary_add'' so browse-added strategies accrue deltas once strategy_analytics.returns_series catches up. Strategy + holding branches preserved verbatim from migration 073. Idempotent — re-run produces no changes once windows populate.';



CREATE OR REPLACE FUNCTION "public"."compute_jobs_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."compute_jobs_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_similarity"("a" "jsonb", "b" "jsonb") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_a_vec NUMERIC[];
  v_b_vec NUMERIC[];
  v_dot   NUMERIC := 0;
  v_norm_a NUMERIC := 0;
  v_norm_b NUMERIC := 0;
  i INT;
BEGIN
  IF a IS NULL OR b IS NULL THEN RETURN 0.0; END IF;
  IF (a->>'version')::INT IS DISTINCT FROM 1 THEN RETURN 0.0; END IF;
  IF (b->>'version')::INT IS DISTINCT FROM 1 THEN RETURN 0.0; END IF;

  WITH parts AS (
    SELECT
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'trade_size_buckets')        AS e) AS a1,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'hold_duration_buckets')     AS e) AS a2,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'asset_class_mix')           AS e) AS a3,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'instrument_concentration')  AS e) AS a4,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(a->'temporal_pattern')          AS e) AS a5,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'trade_size_buckets')        AS e) AS b1,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'hold_duration_buckets')     AS e) AS b2,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'asset_class_mix')           AS e) AS b3,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'instrument_concentration')  AS e) AS b4,
      ARRAY(SELECT (e)::NUMERIC FROM jsonb_array_elements_text(b->'temporal_pattern')          AS e) AS b5
  )
  SELECT a1 || a2 || a3 || a4 || a5, b1 || b2 || b3 || b4 || b5
    INTO v_a_vec, v_b_vec
    FROM parts;

  IF v_a_vec IS NULL OR v_b_vec IS NULL THEN RETURN 0.0; END IF;
  IF array_length(v_a_vec, 1) <> 46 OR array_length(v_b_vec, 1) <> 46 THEN RETURN 0.0; END IF;

  FOR i IN 1..46 LOOP
    v_dot    := v_dot    + v_a_vec[i] * v_b_vec[i];
    v_norm_a := v_norm_a + v_a_vec[i] * v_a_vec[i];
    v_norm_b := v_norm_b + v_b_vec[i] * v_b_vec[i];
  END LOOP;

  IF v_norm_a = 0 OR v_norm_b = 0 THEN RETURN 0.0; END IF;

  RETURN GREATEST(0.0, LEAST(1.0, v_dot / (sqrt(v_norm_a) * sqrt(v_norm_b))))::NUMERIC(5,4);
EXCEPTION
  WHEN OTHERS THEN
    RETURN 0.0;
END;
$$;


ALTER FUNCTION "public"."compute_similarity"("a" "jsonb", "b" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."compute_similarity"("a" "jsonb", "b" "jsonb") IS 'Phase 19 / FINGERPRINT-02. v0 plain plpgsql cosine on 46-dim vector.';



CREATE OR REPLACE FUNCTION "public"."create_allocator_connected_strategy"("p_user_id" "uuid", "p_portfolio_id" "uuid", "p_exchange" "text", "p_label" "text", "p_strategy_name" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer) RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
  v_portfolio_owner UUID;
BEGIN
  -- Verify the caller is writing for themselves.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Verify portfolio ownership.
  SELECT user_id INTO v_portfolio_owner
    FROM portfolios
    WHERE id = p_portfolio_id;

  IF v_portfolio_owner IS NULL THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy: portfolio % not found',
      p_portfolio_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_portfolio_owner <> p_user_id THEN
    RAISE EXCEPTION 'create_allocator_connected_strategy: portfolio % not owned by user %',
      p_portfolio_id, p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert the encrypted key row.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE
  )
  RETURNING id INTO v_key_id;

  -- Insert the strategy row. source='allocator_connected' means it won't
  -- appear on Discovery. status='published' so it's immediately visible
  -- in the allocator's portfolio.
  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, v_key_id, p_strategy_name, 'published', 'allocator_connected',
    '{}', '{}', '{}', ARRAY[p_exchange]
  )
  RETURNING id INTO v_strategy_id;

  -- Link to the allocator's portfolio.
  INSERT INTO portfolio_strategies (
    portfolio_id, strategy_id, current_weight, allocated_amount
  )
  VALUES (
    p_portfolio_id, v_strategy_id, 0, 0
  );

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;


ALTER FUNCTION "public"."create_allocator_connected_strategy"("p_user_id" "uuid", "p_portfolio_id" "uuid", "p_exchange" "text", "p_label" "text", "p_strategy_name" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_allocator_connected_strategy"("p_user_id" "uuid", "p_portfolio_id" "uuid", "p_exchange" "text", "p_label" "text", "p_strategy_name" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer) IS 'Atomic api_keys + strategies (source=allocator_connected, status=published) + portfolio_strategies insert for allocator account connection. See migration 043.';



CREATE OR REPLACE FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- Verify the caller is writing for themselves. RLS would normally
  -- enforce this, but SECURITY DEFINER bypasses RLS so we enforce
  -- manually. This is the single most important assertion in the RPC.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Insert the encrypted key row. All SEC-005-protected columns are
  -- populated here; migration 027's REVOKE pattern allows INSERT but
  -- blocks SELECT on the encrypted columns for end clients.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE
  )
  RETURNING id INTO v_key_id;

  -- Insert the draft strategies row with the new key linked. Migration
  -- 028's tenant-check trigger fires here and asserts the api_key_id
  -- belongs to p_user_id; since we just inserted that key with the same
  -- user_id, the check passes. The source discriminator marks this row
  -- as a wizard in-progress draft so queries can exclude it.
  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange]
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;


ALTER FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") IS 'Atomic api_keys + strategies (source=wizard, status=draft) insert for Task 1.2. See migration 031.';



CREATE OR REPLACE FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM user_app_roles
    WHERE user_id = v_user_id
      AND role = ANY(p_roles)
  );
END;
$$;


ALTER FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) IS 'Returns TRUE if auth.uid() has any role in p_roles. SECURITY DEFINER so RLS policies calling this function can read user_app_roles without tripping the owner-read constraint. See migration 054 and ADR-0005.';



CREATE OR REPLACE FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_snapshot         JSONB;
  v_payload          JSONB := '{}'::jsonb;
  v_kind             text;
  v_moved            int := 0;
  v_row_count        int;
  v_allowlist        text[] := ARRAY[
    'daily_returns_grid',
    'rolling_sortino_3m','rolling_sortino_6m','rolling_sortino_12m',
    'rolling_volatility_3m','rolling_volatility_6m','rolling_volatility_12m',
    'rolling_alpha','rolling_beta',
    'exposure_series','turnover_series','log_returns_series'
  ];
BEGIN
  SELECT metrics_json INTO v_snapshot
    FROM strategy_analytics
   WHERE strategy_id = p_strategy_id
   FOR UPDATE;
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'cutover_strategy_metrics_keys_atomic: strategy_id % not found', p_strategy_id
      USING ERRCODE = 'P0002';
  END IF;

  FOREACH v_kind IN ARRAY v_allowlist LOOP
    IF v_snapshot ? v_kind THEN
      v_payload := v_payload || jsonb_build_object(v_kind, v_snapshot -> v_kind);
      v_moved := v_moved + 1;
    END IF;
  END LOOP;

  IF v_moved = 0 THEN
    RETURN jsonb_build_object('moved', 0);
  END IF;

  INSERT INTO strategy_analytics_series (strategy_id, kind, payload, computed_at)
  SELECT p_strategy_id, key, value, now()
    FROM jsonb_each(v_payload)
   ON CONFLICT (strategy_id, kind) DO UPDATE
      SET payload     = EXCLUDED.payload,
          computed_at = EXCLUDED.computed_at;

  UPDATE strategy_analytics
     SET metrics_json = metrics_json - ARRAY(SELECT jsonb_object_keys(v_payload))
   WHERE strategy_id = p_strategy_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'cutover_strategy_metrics_keys_atomic: UPDATE affected % rows (expected 1)', v_row_count
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('moved', v_moved);
END;
$$;


ALTER FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") IS 'P2046 P2047 audit-2026-05-07 round 2 (migration 129). SECURITY DEFINER atomic cutover RPC. Reads metrics_json INSIDE function body under SELECT ... FOR UPDATE, projects against internal 12-key HEAVY_KINDS allowlist, upserts sibling-table rows + strips same keys atomically. service_role only. Returns { moved: N }.';



CREATE OR REPLACE FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text" DEFAULT NULL::"text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_current_attempts INTEGER;
  v_next_attempt TIMESTAMPTZ;
BEGIN
  IF p_job_id IS NULL THEN
    RAISE EXCEPTION 'defer_compute_job: p_job_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_defer_seconds IS NULL OR p_defer_seconds < 0 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds must be >= 0, got %', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Cap defer at 1 hour to prevent a misconfigured caller from parking a
  -- job for days and silently breaking downstream widgets that expect
  -- recent data. The longest legitimate cooldown today is Bybit at
  -- 10 minutes.
  IF p_defer_seconds > 3600 THEN
    RAISE EXCEPTION 'defer_compute_job: p_defer_seconds % exceeds cap of 3600 (1 hour)', p_defer_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Lock and read the current attempts value. Must be running + claimed
  -- or we raise — deferring a non-running job doesn't make sense and
  -- would silently corrupt state if we let it through.
  SELECT attempts
    INTO v_current_attempts
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'defer_compute_job: job % not found or not running', p_job_id
      USING ERRCODE = 'no_data_found';
  END IF;

  v_next_attempt := now() + (p_defer_seconds * interval '1 second');

  -- GREATEST(0, ...) defense: if attempts somehow landed at 0 before this
  -- call (shouldn't happen under the normal claim path but migrations
  -- or manual INSERTs could), don't let us go negative.
  UPDATE compute_jobs
     SET status          = 'pending',
         attempts        = GREATEST(0, v_current_attempts - 1),
         next_attempt_at = v_next_attempt,
         claimed_at      = NULL,
         claimed_by      = NULL,
         last_error      = p_reason
   WHERE id = p_job_id;

  RETURN v_next_attempt;
END;
$$;


ALTER FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text") IS 'Defers a running job back to pending for circuit-breaker cooldowns. Decrements attempts by 1 to cancel claim_compute_jobs increment so the defer does not burn a retry. Used by worker when api_keys.last_429_at indicates a cooldown is active. See migration 033.';



CREATE OR REPLACE FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_owner              uuid;
  v_holdings_deleted   integer := 0;
  v_remaining_keys     integer;
BEGIN
  -- Step 1: verify caller owns the key (also covers "key does not exist"
  -- — SELECT returns NULL which fails the equality check below).
  SELECT user_id INTO v_owner FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'delete_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';
  END IF;

  -- Step 2: cascade-delete holdings if requested. Without this, the
  -- api_keys DELETE below fails on the 23503 FK restrict from
  -- allocator_holdings (migration 066 STEP 1). Client handles that error.
  IF p_cascade_holdings THEN
    DELETE FROM allocator_holdings
    WHERE api_key_id = p_api_key_id
      AND allocator_id = auth.uid();
    GET DIAGNOSTICS v_holdings_deleted = ROW_COUNT;
  END IF;

  -- Step 3: delete the key.
  DELETE FROM api_keys WHERE id = p_api_key_id AND user_id = auth.uid();

  -- Step 4: last-key equity cascade (migration 077).
  -- Only wipe the equity series when the user explicitly asked for hard
  -- delete (cascade=true) AND they have no other keys left. Multi-key
  -- users keep their aggregated series intact.
  IF p_cascade_holdings THEN
    SELECT count(*) INTO v_remaining_keys
      FROM api_keys
      WHERE user_id = auth.uid();

    IF v_remaining_keys = 0 THEN
      DELETE FROM allocator_equity_snapshots
        WHERE allocator_id = auth.uid();
    END IF;
  END IF;

  RETURN v_holdings_deleted;
END;
$$;


ALTER FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_already_disc
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'disconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: if already disconnected, NO-OP.
  IF v_already_disc IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE api_keys
    SET disconnected_at = now()
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NULL;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") IS 'Migration 075: soft-disconnect an api_keys row. Ownership enforced internally via auth.uid(). Idempotent — returns false if already disconnected. Workers + request_allocator_holdings_sync skip disconnected keys; holdings keep their FK reference.';



CREATE OR REPLACE FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_expected_owner UUID;
BEGIN
  SELECT user_id INTO v_expected_owner
    FROM api_keys
    WHERE id = NEW.api_key_id;
  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION
      'allocator_holdings.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF NEW.allocator_id IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION
      'allocator_holdings.allocator_id (%) must match api_keys.user_id (%) for api_key_id %',
      NEW.allocator_id, v_expected_owner, NEW.api_key_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() IS 'f5: asserts allocator_holdings.allocator_id matches api_keys.user_id for the linked api_key_id. Prevents silent ownership fork if api_keys.user_id is reassigned. SECURITY DEFINER so the owner lookup bypasses RLS on api_keys.';



CREATE OR REPLACE FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_parent_job_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_exchange" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT NULL::"jsonb", "p_allocator_id" "uuid" DEFAULT NULL::"uuid", "p_api_key_id" "uuid" DEFAULT NULL::"uuid", "p_run_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_role        TEXT;
  v_caller_uid  UUID;
BEGIN
  -- Strategy-scoped (pre-062 + post-062 callers).
  IF p_strategy_id IS NOT NULL AND p_allocator_id IS NULL AND p_api_key_id IS NULL THEN
    PERFORM _assert_owner('strategies'::regclass, p_strategy_id, 'enqueue_compute_job');
    RETURN _enqueue_compute_job_internal(
      p_strategy_id, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, NULL, p_run_at
    );
  END IF;

  -- Allocator-scoped (post-062 caller: update_allocator_mandates).
  IF p_allocator_id IS NOT NULL AND p_strategy_id IS NULL AND p_api_key_id IS NULL THEN
    -- audit-2026-05-07 H-0942 + H-0944: defense-in-depth ownership
    -- check. auth.role() returns 'service_role' for the cron / Python
    -- worker path and 'authenticated' for end-user RPCs. Mismatch ⇒
    -- raise insufficient_privilege so a future SECURITY DEFINER
    -- caller that forgets to bind p_allocator_id = auth.uid() cannot
    -- forge a cross-allocator rescore enqueue.
    --
    -- Capture auth.role() AND auth.uid() once. The EXCEPTION trap is
    -- narrowed to the SQLSTATEs that actually fire when the auth
    -- schema is missing or unreadable (e.g., direct postgres role
    -- during migration apply); any other failure must propagate so
    -- schema-drift bugs surface loudly instead of silently downgrading
    -- to v_role=NULL/v_caller_uid=NULL and dying at the gate below.
    BEGIN
      v_role := auth.role();
      v_caller_uid := auth.uid();
    EXCEPTION
      WHEN undefined_function OR undefined_table OR insufficient_privilege THEN
        v_role := NULL;
        v_caller_uid := NULL;
    END;

    IF v_role IS DISTINCT FROM 'service_role' THEN
      IF v_caller_uid IS NULL OR v_caller_uid IS DISTINCT FROM p_allocator_id THEN
        RAISE EXCEPTION 'enqueue_compute_job: allocator-scoped enqueue requires p_allocator_id = auth.uid() (got p_allocator_id=%, auth.uid()=%). audit-2026-05-07 H-0942.',
          p_allocator_id, v_caller_uid
          USING ERRCODE = 'insufficient_privilege';
      END IF;
    END IF;

    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, p_allocator_id, NULL, p_run_at
    );
  END IF;

  -- Api-key-scoped (Phase 06 caller: request_allocator_holdings_sync).
  IF p_api_key_id IS NOT NULL AND p_strategy_id IS NULL AND p_allocator_id IS NULL THEN
    RETURN _enqueue_compute_job_internal(
      NULL, NULL, p_kind, p_idempotency_key,
      p_parent_job_ids, p_exchange, p_metadata, NULL, p_api_key_id, p_run_at
    );
  END IF;

  RAISE EXCEPTION 'enqueue_compute_job: exactly one of p_strategy_id, p_allocator_id, p_api_key_id must be non-null (got strategy=%, allocator=%, api_key=%)',
    p_strategy_id, p_allocator_id, p_api_key_id
    USING ERRCODE = 'invalid_parameter_value';
END;
$$;


ALTER FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) IS 'Idempotent enqueue of a compute job. Three modes: strategy / allocator / api_key scope. Delegates to _enqueue_compute_job_internal. Extended in migration 066 for api_key + run_at. audit-2026-05-07 H-0942 / H-0944: allocator-scoped branch now enforces p_allocator_id = auth.uid() unless caller is service_role.';



CREATE OR REPLACE FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_parent_job_ids" "uuid"[] DEFAULT '{}'::"uuid"[], "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF p_portfolio_id IS NULL THEN
    RAISE EXCEPTION 'enqueue_compute_portfolio_job: p_portfolio_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('portfolios'::regclass, p_portfolio_id, 'enqueue_compute_portfolio_job');

  RETURN _enqueue_compute_job_internal(
    NULL, p_portfolio_id, 'compute_portfolio', p_idempotency_key,
    p_parent_job_ids, NULL, p_metadata
  );
END;
$$;


ALTER FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_metadata" "jsonb") IS 'Idempotent enqueue of a portfolio-scoped compute job. Defense-in-depth ownership check via _assert_owner. Service-role calls bypass the check. See migration 032.';



CREATE OR REPLACE FUNCTION "public"."enqueue_poll_allocator_positions_for_all_keys"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_api_key_id      UUID;
  v_enqueued        INTEGER := 0;
  v_job_id          UUID;
  v_jitter          INTERVAL;
  v_run_at          TIMESTAMPTZ;
  v_idempotency_key TEXT;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_allocator_polling')) THEN
    RETURN 0;
  END IF;

  FOR v_api_key_id IN
    SELECT id FROM api_keys
    WHERE is_active = true
      AND sync_status IS DISTINCT FROM 'revoked'
      AND disconnected_at IS NULL  -- migration 075: skip soft-disconnected
  LOOP
    BEGIN
      v_jitter := (random() * interval '600 seconds');
      v_run_at := now() + v_jitter;
      v_idempotency_key := 'daily-alloc-'
        || to_char(v_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        || '-' || v_api_key_id::text;
      v_job_id := enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'poll_allocator_positions',
        p_api_key_id      := v_api_key_id,
        p_idempotency_key := v_idempotency_key,
        p_run_at          := v_run_at
      );
      v_enqueued := v_enqueued + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('daily_allocator_polling'));
  RETURN v_enqueued;
END;
$$;


ALTER FUNCTION "public"."enqueue_poll_allocator_positions_for_all_keys"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_poll_allocator_positions_for_all_keys"() IS 'Daily cron fan-out. Migration 075 added disconnected_at IS NULL filter so soft-disconnected keys stop receiving poll jobs. Preserves the advisory lock + f6 jitter-first idempotency key + unique_violation swallow from migration 066.';



CREATE OR REPLACE FUNCTION "public"."enqueue_poll_positions_for_all_strategies"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_strategy_id UUID;
  v_exchange TEXT;
  v_enqueued INTEGER := 0;
  v_job_id UUID;
  v_existing_count INTEGER;
BEGIN
  FOR v_strategy_id, v_exchange IN
    SELECT DISTINCT s.id, ak.exchange
      FROM strategies s
      JOIN api_keys ak ON ak.id = s.api_key_id
      WHERE s.api_key_id IS NOT NULL
        AND s.status IN ('published', 'pending_review')
        AND EXISTS (
          SELECT 1 FROM compute_jobs cj
            WHERE cj.strategy_id = s.id
              AND cj.kind = 'sync_trades'
              AND cj.status = 'done'
              AND cj.updated_at > (now() - interval '30 days')
        )
  LOOP
    -- Count pre-existing in-flight poll_positions jobs for this strategy
    -- BEFORE the enqueue call, so we can detect whether enqueue_compute_job
    -- returned an existing id (no new row) vs created a new one.
    SELECT count(*) INTO v_existing_count
      FROM compute_jobs
      WHERE strategy_id = v_strategy_id
        AND kind = 'poll_positions'
        AND status IN ('pending', 'running', 'done_pending_children');

    v_job_id := enqueue_compute_job(
      v_strategy_id,
      'poll_positions',
      'daily-poll-' || to_char(now(), 'YYYY-MM-DD') || '-' || v_strategy_id::text,
      '{}'::UUID[],
      v_exchange,
      jsonb_build_object('enqueued_by', 'daily_loop', 'enqueued_at', now())
    );

    IF v_existing_count = 0 AND v_job_id IS NOT NULL THEN
      v_enqueued := v_enqueued + 1;
    END IF;
  END LOOP;

  RETURN v_enqueued;
END;
$$;


ALTER FUNCTION "public"."enqueue_poll_positions_for_all_strategies"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_poll_positions_for_all_strategies"() IS 'Daily fanout: enqueues a poll_positions job per qualifying strategy. Idempotent via enqueue_compute_job partial unique index. Returns count of newly-enqueued jobs. Called by worker daily loop under advisory lock to prevent multi-replica duplication. See migration 033.';



CREATE OR REPLACE FUNCTION "public"."enqueue_refresh_allocator_equity_for_all"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_key   RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    FOR v_key IN
      SELECT ak.id AS api_key_id, ak.user_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.disconnected_at IS NULL  -- migration 075
        AND EXISTS (
          SELECT 1 FROM allocator_equity_snapshots aes
          WHERE aes.allocator_id = ak.user_id
          LIMIT 1
        )
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'refresh_allocator_equity_daily',
          p_idempotency_key := 'daily-equity-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
END;
$$;


ALTER FUNCTION "public"."enqueue_refresh_allocator_equity_for_all"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_refresh_allocator_equity_for_all"() IS 'Daily cron fan-out for per-allocator equity refresh. Migration 075 added disconnected_at IS NULL filter so soft-disconnected keys stop receiving refresh jobs. Preserves advisory lock + per-key loop from migration 070.';



CREATE OR REPLACE FUNCTION "public"."extract_delta"("series" "jsonb", "anchor" "date", "days" integer) RETURNS numeric
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  -- Cumulative equity curve: (value_at(anchor + days) / value_at(anchor)) - 1.
  -- Returns NULL if either anchor or anchor+days is missing from the series.
  SELECT
    CASE
      WHEN public.extract_equity_at(series, anchor) IS NULL THEN NULL
      WHEN public.extract_equity_at(series, anchor + days) IS NULL THEN NULL
      ELSE (public.extract_equity_at(series, anchor + days) /
            public.extract_equity_at(series, anchor)) - 1
    END;
$$;


ALTER FUNCTION "public"."extract_delta"("series" "jsonb", "anchor" "date", "days" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."extract_delta"("series" "jsonb", "anchor" "date", "days" integer) IS 'Realized delta across N days from the anchor, using cumulative equity math. Formula: (equity_at(anchor + days) / equity_at(anchor)) - 1. NEVER implement as SUM of daily returns — returns_series is cumulative.';



CREATE OR REPLACE FUNCTION "public"."extract_equity_at"("series" "jsonb", "target_date" "date") RETURNS numeric
    LANGUAGE "sql" IMMUTABLE PARALLEL SAFE
    AS $$
  SELECT NULLIF((entry->>'value')::NUMERIC, 0)
  FROM jsonb_array_elements(series) AS entry
  WHERE (entry->>'date')::DATE = target_date
  LIMIT 1;
$$;


ALTER FUNCTION "public"."extract_equity_at"("series" "jsonb", "target_date" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."extract_equity_at"("series" "jsonb", "target_date" "date") IS 'Returns the cumulative equity value on target_date from a returns_series JSONB array [{date:"YYYY-MM-DD", value:NUMERIC}, ...], or NULL when the date is not in the series. Values of 0 are treated as NULL to prevent divide-by-zero in extract_delta.';



CREATE OR REPLACE FUNCTION "public"."extract_estimated"("series" "jsonb", "anchor" "date") RETURNS TABLE("bps" numeric, "days" integer)
    LANGUAGE "plpgsql" STABLE
    AS $$
DECLARE
  last_entry RECORD;
  last_date DATE;
  last_value NUMERIC;
  anchor_value NUMERIC;
  days_elapsed INT;
BEGIN
  IF series IS NULL OR jsonb_array_length(series) = 0 THEN
    RETURN;
  END IF;

  anchor_value := public.extract_equity_at(series, anchor);
  IF anchor_value IS NULL THEN
    RETURN;
  END IF;

  -- Most recent entry in the series
  SELECT
    (entry->>'date')::DATE AS d,
    (entry->>'value')::NUMERIC AS v
  INTO last_entry
  FROM jsonb_array_elements(series) AS entry
  ORDER BY (entry->>'date')::DATE DESC
  LIMIT 1;

  last_date := last_entry.d;
  last_value := last_entry.v;
  days_elapsed := (last_date - anchor);

  -- Only return an estimate when we have between 1 and 29 days of data since
  -- anchor. Realized windows (30/90/180) take over via extract_delta.
  IF days_elapsed < 1 OR days_elapsed > 29 THEN
    RETURN;
  END IF;

  IF last_value IS NULL OR last_value = 0 THEN
    RETURN;
  END IF;

  bps := ((last_value / anchor_value) - 1) * 10000;
  days := days_elapsed;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."extract_estimated"("series" "jsonb", "anchor" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."extract_estimated"("series" "jsonb", "anchor" "date") IS 'Estimated delta in basis points + days elapsed for an anchor-to-most-recent window. Returns 0 rows when outside the 1..29 day range or when anchor is missing from the series. Used for the D-12 "Estimated: +X.X% (Nd)" label before the 30-day realized window populates.';



CREATE OR REPLACE FUNCTION "public"."extract_symbol_value_at"("p_allocator_id" "uuid", "p_symbol" "text", "p_asof" "date") RETURNS numeric
    LANGUAGE "sql" STABLE PARALLEL SAFE
    AS $$
  SELECT NULLIF((breakdown ->> p_symbol)::NUMERIC, 0)
    FROM public.allocator_equity_snapshots
   WHERE allocator_id = p_allocator_id
     AND asof = p_asof
   LIMIT 1;
$$;


ALTER FUNCTION "public"."extract_symbol_value_at"("p_allocator_id" "uuid", "p_symbol" "text", "p_asof" "date") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."extract_symbol_value_at"("p_allocator_id" "uuid", "p_symbol" "text", "p_asof" "date") IS 'Phase 09 / D-12. Reads per-symbol USD value on a given asof from allocator_equity_snapshots.breakdown jsonb. Returns NULL when symbol is absent OR when value is 0 (prevents divide-by-zero in holding delta computation). breakdown format: { "BTC": 50000, "ETH": 30000, ... } (Phase 07 D-02).';



CREATE OR REPLACE FUNCTION "public"."fetch_strategy_lazy_metrics"("p_strategy_id" "uuid", "p_panel_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_kinds   TEXT[];
  v_visible BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM strategies
     WHERE id = p_strategy_id
       AND (status = 'published' OR user_id = auth.uid())
  ) INTO v_visible;

  IF NOT v_visible THEN
    RETURN jsonb_build_object();
  END IF;

  v_kinds := CASE p_panel_id
    WHEN 'overview'     THEN ARRAY[]::TEXT[]
    WHEN 'equity'       THEN ARRAY['log_returns_series']
    WHEN 'drawdown'     THEN ARRAY[]::TEXT[]
    WHEN 'returns_dist' THEN ARRAY['daily_returns_grid']
    WHEN 'rolling'      THEN ARRAY[
      'rolling_sortino_3m', 'rolling_sortino_6m', 'rolling_sortino_12m',
      'rolling_volatility_3m', 'rolling_volatility_6m', 'rolling_volatility_12m',
      'rolling_alpha', 'rolling_beta'
    ]
    WHEN 'trades'       THEN ARRAY[]::TEXT[]
    WHEN 'exposure'     THEN ARRAY['exposure_series', 'turnover_series']
    ELSE ARRAY[]::TEXT[]
  END;

  RETURN COALESCE((
    SELECT jsonb_object_agg(kind, payload)
      FROM strategy_analytics_series
     WHERE strategy_id = p_strategy_id
       AND kind = ANY(v_kinds)
  ), jsonb_build_object());
END;
$$;


ALTER FUNCTION "public"."fetch_strategy_lazy_metrics"("p_strategy_id" "uuid", "p_panel_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."fetch_strategy_lazy_metrics"("p_strategy_id" "uuid", "p_panel_id" "text") IS 'Lazy-fetch heavy series from strategy_analytics_series, scoped per panel. Visibility check inside (published OR owner); returns empty {} on miss. equity panel returns log_returns_series only — equity_series_1y stays in metrics_json (H-D). H-B: SET search_path = public, pg_temp. See migration 087.';



CREATE OR REPLACE FUNCTION "public"."finalize_csv_strategy"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid     UUID := auth.uid();
  v_strategy_id  UUID;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO strategies (
    user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges
  )
  VALUES (
    p_user_id, p_strategy_name, 'pending_review', 'csv',
    '{}', '{}', '{}', '{}'::text[]
  )
  RETURNING id INTO v_strategy_id;

  INSERT INTO strategy_verifications (
    strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
    errors, correlation_id
  ) VALUES (
    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',
    NULL, NULL
  );

  RETURN v_strategy_id;
END;
$$;


ALTER FUNCTION "public"."finalize_csv_strategy"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_csv_strategy"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text") IS 'Phase 15 / CSV-01: sibling to finalize_wizard_strategy. Atomically creates a strategies row (source=csv, status=pending_review, name=p_strategy_name) AND a strategy_verifications row (status=validated, trust_tier=csv_uploaded) for the CSV ingestion path. p_strategy_name is the user-typed name from the Upload step (1-80 chars). Phase 19 / BACKBONE-04 will absorb this into the unified backbone via VIEW-shim sequence.';



CREATE OR REPLACE FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_current_status TEXT;
  v_current_source TEXT;
  v_current_owner UUID;
  v_api_key_id UUID;
  v_exchange TEXT;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status, source, user_id, api_key_id
    INTO v_current_status, v_current_source, v_current_owner, v_api_key_id
    FROM strategies
    WHERE id = p_strategy_id
    FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % not found', p_strategy_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_current_owner <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % is not owned by user %',
      p_strategy_id, p_user_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_current_source <> 'wizard' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has source=% (expected wizard)',
      p_strategy_id, v_current_source
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_current_status <> 'draft' THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: strategy % has status=% (expected draft)',
      p_strategy_id, v_current_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE strategies
    SET
      name = p_name,
      description = p_description,
      category_id = p_category_id,
      strategy_types = COALESCE(p_strategy_types, '{}'),
      subtypes = COALESCE(p_subtypes, '{}'),
      markets = COALESCE(p_markets, '{}'),
      supported_exchanges = COALESCE(p_supported_exchanges, '{}'),
      leverage_range = p_leverage_range,
      aum = p_aum,
      max_capacity = p_max_capacity,
      status = 'pending_review'
    WHERE id = p_strategy_id;

  IF v_api_key_id IS NOT NULL THEN
    SELECT exchange
      INTO v_exchange
      FROM api_keys
      WHERE id = v_api_key_id;

    IF v_exchange IN ('bybit', 'okx', 'binance') THEN
      INSERT INTO strategy_verifications (
        strategy_id,
        wizard_session_id,
        status,
        trust_tier,
        flow_type,
        source
      ) VALUES (
        p_strategy_id,
        gen_random_uuid(),
        'validated',
        'api_verified',
        'onboard',
        v_exchange
      );
    END IF;
  END IF;

  RETURN p_strategy_id;
END;
$$;


ALTER FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric) IS 'Promotes a wizard draft (source=wizard, status=draft) to status=pending_review after asserting ownership. Inserts strategy_verifications(trust_tier=api_verified) for API-tier drafts (api_key_id IS NOT NULL) so the public-sheet disclaimer reflects the verified provenance. Mirrors finalize_csv_strategy. See migration 031 (original) + QA report 2026-05-21.';



CREATE OR REPLACE FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer DEFAULT 50, "p_offset" integer DEFAULT 0, "p_status" "text" DEFAULT NULL::"text", "p_kind" "text" DEFAULT NULL::"text", "p_exchange" "text" DEFAULT NULL::"text") RETURNS TABLE("id" "uuid", "strategy_id" "uuid", "portfolio_id" "uuid", "kind" "text", "status" "text", "attempts" integer, "max_attempts" integer, "next_attempt_at" timestamp with time zone, "claimed_at" timestamp with time zone, "claimed_by" "text", "last_error" "text", "error_kind" "text", "idempotency_key" "text", "exchange" "text", "trade_count" integer, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "metadata" "jsonb", "strategy_name" "text", "portfolio_name" "text", "user_email" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_effective_limit INTEGER;
  v_effective_offset INTEGER;
BEGIN
  -- Admin gate: EXISTS check on profiles.is_admin, matches migration 011
  -- pattern verbatim.
  SELECT COALESCE(
    (SELECT is_admin FROM profiles WHERE id = auth.uid() LIMIT 1),
    false
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RETURN;
  END IF;

  -- Clamp limit + offset to safe ranges.
  v_effective_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 500));
  v_effective_offset := GREATEST(0, COALESCE(p_offset, 0));

  RETURN QUERY
  SELECT
    v.id, v.strategy_id, v.portfolio_id, v.kind, v.status,
    v.attempts, v.max_attempts, v.next_attempt_at,
    v.claimed_at, v.claimed_by,
    v.last_error, v.error_kind, v.idempotency_key,
    v.exchange, v.trade_count, v.created_at, v.updated_at, v.metadata,
    v.strategy_name, v.portfolio_name, v.user_email
  FROM compute_jobs_admin v
  WHERE (p_status IS NULL OR v.status = p_status)
    AND (p_kind IS NULL OR v.kind = p_kind)
    AND (p_exchange IS NULL OR v.exchange = p_exchange)
  ORDER BY v.created_at DESC
  LIMIT v_effective_limit
  OFFSET v_effective_offset;
END;
$$;


ALTER FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") IS 'Admin-gated read over compute_jobs_admin. Gates on profiles.is_admin. Returns un-redacted last_error for debugging. Non-admin callers get an empty result set. See migration 033.';



CREATE OR REPLACE FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") RETURNS TABLE("batch_id" "uuid", "computed_at" timestamp with time zone, "candidate_count" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() <> p_allocator_id THEN
    SELECT COALESCE(p.is_admin, false) INTO v_is_admin
    FROM profiles p
    WHERE p.id = auth.uid();
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
  SELECT
    mb.id AS batch_id,
    mb.computed_at,
    mb.candidate_count
  FROM match_batches mb
  WHERE mb.allocator_id = p_allocator_id
  ORDER BY mb.computed_at DESC
  LIMIT 1;
END;
$$;


ALTER FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") IS 'SECURITY DEFINER: returns latest match_batch metadata (id, computed_at, candidate_count) for the given allocator. Enforces "caller is the allocator OR caller is admin". Companion to get_allocator_recommendations (migration 019).';



CREATE OR REPLACE FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") RETURNS TABLE("id" "uuid", "strategy_id" "uuid", "rank" integer, "score" numeric, "reasons" "text"[], "strategy_name" "text", "strategy_description" "text", "discovery_category_slug" "text", "cagr" numeric, "sharpe" numeric, "max_drawdown" numeric, "analytics_computed_at" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
  v_batch_id UUID;
BEGIN
  -- Require authenticated caller.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Allow: caller is the allocator, OR caller is an admin.
  IF auth.uid() <> p_allocator_id THEN
    SELECT COALESCE(p.is_admin, false) INTO v_is_admin
    FROM profiles p
    WHERE p.id = auth.uid();
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN;
    END IF;
  END IF;

  -- Find the latest match_batch for this allocator.
  SELECT mb.id INTO v_batch_id
  FROM match_batches mb
  WHERE mb.allocator_id = p_allocator_id
  ORDER BY mb.computed_at DESC
  LIMIT 1;

  IF v_batch_id IS NULL THEN
    RETURN;
  END IF;

  -- Return the top 3 candidates joined with strategy + analytics data.
  -- strategy_analytics columns are declared DECIMAL in 001_initial_schema,
  -- which is an alias for NUMERIC so they implicitly match the return
  -- table. Cast rank to INT explicitly for type safety against future
  -- schema drift.
  RETURN QUERY
  SELECT
    mc.id,
    mc.strategy_id,
    mc.rank::INT,
    mc.score,
    mc.reasons,
    s.name AS strategy_name,
    s.description AS strategy_description,
    dc.slug AS discovery_category_slug,
    sa.cagr,
    sa.sharpe,
    sa.max_drawdown,
    sa.computed_at AS analytics_computed_at
  FROM match_candidates mc
  JOIN strategies s ON s.id = mc.strategy_id
  LEFT JOIN discovery_categories dc ON dc.id = s.category_id
  LEFT JOIN strategy_analytics sa ON sa.strategy_id = s.id
  WHERE mc.batch_id = v_batch_id
    AND mc.rank IS NOT NULL
  ORDER BY mc.rank ASC
  LIMIT 3;
END;
$$;


ALTER FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") IS 'SECURITY DEFINER: returns the top 3 match candidates for the given allocator. Enforces "caller is the allocator OR caller is admin". Replaces the admin-client path in recommendations/page.tsx (migration 019).';



CREATE OR REPLACE FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid" DEFAULT NULL::"uuid", "p_limit" integer DEFAULT 100) RETURNS TABLE("id" "uuid", "strategy_id" "uuid", "portfolio_id" "uuid", "kind" "text", "parent_job_ids" "uuid"[], "status" "text", "attempts" integer, "max_attempts" integer, "next_attempt_at" timestamp with time zone, "claimed_at" timestamp with time zone, "claimed_by" "text", "last_error" "text", "error_kind" "text", "idempotency_key" "text", "exchange" "text", "trade_count" integer, "created_at" timestamp with time zone, "updated_at" timestamp with time zone, "metadata" "jsonb", "user_message" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) IS 'Returns compute_jobs rows visible to auth.uid(). last_error REDACTED; user_message TEXT (mig 111 P11) synthesised from (status, error_kind). audit-2026-05-07 M-0783: WHERE uses COALESCE(s.user_id, p.user_id) — this is a self-documenting refactor with NO observable behavior delta from the prior `(s.user_id = X OR p.user_id = X)` shape. Both forms return NULL (filtered as false) for orphan rows where both joins miss. Orphans remain invisible to ALL callers of this RPC. Admins read orphans through the service-role direct query path, never through this function (auth.uid() IS NULL returns early at the top of the body). See migrations 032, 111, audit-2026-05-07.';



CREATE OR REPLACE FUNCTION "public"."guard_wizard_draft_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF OLD.source <> 'wizard' OR OLD.status <> 'draft' THEN
    RETURN NEW;
  END IF;
  IF NEW.source = 'wizard' AND NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;
  IF current_user = 'authenticated' THEN
    RAISE EXCEPTION
      'Direct update on wizard draft % blocked. Use finalize_wizard_strategy or delete the draft.',
      OLD.id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_wizard_draft_updates"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_wizard_draft_updates"() IS 'Blocks direct authenticated-role updates that would flip a wizard draft out of (source=wizard, status=draft). Gated on current_user=authenticated. See migrations 031, 125, 126, 127.';



CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_role     text;
  v_raw_role text;
BEGIN
  v_raw_role := NEW.raw_user_meta_data->>'role';
  IF v_raw_role IN ('manager', 'allocator', 'both') THEN
    v_role := v_raw_role;
  ELSE
    v_role := 'manager';
  END IF;

  INSERT INTO public.profiles (id, display_name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    v_role
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."increment_user_session_count"("p_user_id" "uuid", "p_debounce_seconds" integer DEFAULT 1800) RETURNS TABLE("session_count" integer, "debounced" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_meta JSONB;
  v_current_count INTEGER;
  v_last_start TIMESTAMPTZ;
  v_now TIMESTAMPTZ := now();
  v_next_count INTEGER;
BEGIN
  -- Lock the auth.users row so concurrent callers serialize. The lock
  -- is released at COMMIT (statement-end for this function).
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id USING ERRCODE = 'P0002';
  END IF;

  v_meta := COALESCE(v_meta, '{}'::JSONB);

  v_current_count := COALESCE((v_meta->>'session_count')::INTEGER, 0);
  v_last_start := NULLIF(v_meta->>'last_session_start_at', '')::TIMESTAMPTZ;

  -- Debounce: within p_debounce_seconds of the previous start, return
  -- the existing count and don't bump.
  IF v_last_start IS NOT NULL
     AND v_now - v_last_start < make_interval(secs => p_debounce_seconds) THEN
    session_count := v_current_count;
    debounced := TRUE;
    RETURN NEXT;
    RETURN;
  END IF;

  v_next_count := v_current_count + 1;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'session_count', v_next_count,
                                   'last_session_start_at',
                                     to_char(v_now AT TIME ZONE 'UTC',
                                             'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = p_user_id;

  session_count := v_next_count;
  debounced := FALSE;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."increment_user_session_count"("p_user_id" "uuid", "p_debounce_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;


ALTER FUNCTION "public"."is_org_admin"("org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_org_admin"("org_id" "uuid") IS 'SECURITY DEFINER helper used by organization RLS policies to avoid infinite recursion. Bypasses RLS on organization_members for the owner/admin lookup.';



CREATE OR REPLACE FUNCTION "public"."is_org_member"("org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = org_id
      AND user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."is_org_member"("org_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."is_org_member"("org_id" "uuid") IS 'SECURITY DEFINER helper used by organization RLS policies to avoid infinite recursion. Bypasses RLS on organization_members for the membership lookup itself.';



CREATE OR REPLACE FUNCTION "public"."latest_cron_success"("p_cron_name" "text") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  IF auth.role() <> 'service_role' THEN
    SELECT COALESCE(p.is_admin, false) INTO v_is_admin
    FROM profiles p WHERE p.id = auth.uid();
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN NULL;
    END IF;
  END IF;

  RETURN (
    SELECT MAX(completed_at)
    FROM cron_runs
    WHERE cron_name = p_cron_name AND status = 'ok'
  );
END;
$$;


ALTER FUNCTION "public"."latest_cron_success"("p_cron_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"("p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."log_audit_event"("p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_audit_event"("p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") IS 'Fire-and-forget audit event emitter. SECURITY DEFINER; derives user_id from auth.uid() so the caller cannot spoof attribution. Raises SQLSTATE 28000 if unauthenticated (auth.uid() IS NULL), SQLSTATE 42501 if EXECUTE-grant drifted. See migrations 049 + NEW-C10-04 and ADR-0023.';



CREATE OR REPLACE FUNCTION "public"."log_audit_event_service"("p_user_id" "uuid", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_row_id UUID;
  v_role TEXT;
  v_metadata_size INT;
BEGIN
  BEGIN
    v_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_role := NULL;
  END;

  IF v_role IS NULL OR v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION
      'log_audit_event_service: auth.role() must be authenticated or service_role (got %). audit-2026-05-07 P919.', v_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'log_audit_event_service: p_user_id is required (this RPC does not derive user_id from auth.uid())'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_action IS NULL OR length(p_action) = 0 THEN
    RAISE EXCEPTION 'log_audit_event_service: p_action is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_type IS NULL OR length(p_entity_type) = 0 THEN
    RAISE EXCEPTION 'log_audit_event_service: p_entity_type is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_entity_id IS NULL THEN
    RAISE EXCEPTION 'log_audit_event_service: p_entity_id is required (audit_log.entity_id is NOT NULL)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_metadata IS NOT NULL THEN
    v_metadata_size := octet_length(p_metadata::text);
    IF v_metadata_size > 32768 THEN
      RAISE EXCEPTION
        'log_audit_event_service: p_metadata exceeds 32 KB ceiling (octet_length=% bytes, max=32768). audit-2026-05-07 P920.', v_metadata_size
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (p_user_id, p_action, p_entity_type, p_entity_id, p_metadata)
  RETURNING id INTO v_row_id;

  RETURN v_row_id;
END;
$$;


ALTER FUNCTION "public"."log_audit_event_service"("p_user_id" "uuid", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."log_audit_event_service"("p_user_id" "uuid", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") IS 'Service-role-only audit emitter. Hardened in migration 123: (a) in-body role gate (authenticated OR service_role), (b) 32 KB JSONB metadata ceiling, (c) audit_log.user_id now has FK to auth.users(id) ON DELETE SET NULL. audit-2026-05-07 P919, P920.';



CREATE OR REPLACE FUNCTION "public"."mark_compute_job_done"("p_job_id" "uuid", "p_claim_token" "uuid" DEFAULT NULL::"uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."mark_compute_job_done"("p_job_id" "uuid", "p_claim_token" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_compute_job_done"("p_job_id" "uuid", "p_claim_token" "uuid") IS 'Terminal success transition. Migration 117 P97 fence preserved. audit-2026-05-07 H-0864 + red-team apply: fan-in advance is a single set-based UPDATE using GIN-supported `parent_job_ids @> ARRAY[...]` (was `= ANY(parent_job_ids)`, which the planner could not push down to the GIN index). Preserves mig 109 P6 idempotent-retry on already-done rows AND mig 099 Phase-18 atomic UI status bridge. See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md + .review/red-team.jsonl.';



CREATE OR REPLACE FUNCTION "public"."mark_compute_job_failed"("p_job_id" "uuid", "p_error" "text", "p_error_kind" "text" DEFAULT 'unknown'::"text", "p_claim_token" "uuid" DEFAULT NULL::"uuid") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."mark_compute_job_failed"("p_job_id" "uuid", "p_error" "text", "p_error_kind" "text", "p_claim_token" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."mark_compute_job_failed"("p_job_id" "uuid", "p_error" "text", "p_error_kind" "text", "p_claim_token" "uuid") IS 'Migration 117 P97 fence preserved. audit-2026-05-07 M-0779: no longer clears claimed_at / claimed_by on terminal failure so forensic value (which worker last touched the row) survives until the next claim. Preserves mig 109 P4 backoff schedule + ELSE-arm NOTICE AND mig 099 Phase-18 atomic UI status bridge. See migration 117 + .planning/audit-2026-05-07/INVEST-P97.md.';



CREATE OR REPLACE FUNCTION "public"."parse_holding_ref"("p_ref" "text") RETURNS TABLE("venue" "text", "symbol" "text", "holding_type" "text")
    LANGUAGE "plpgsql" IMMUTABLE PARALLEL SAFE
    AS $$
DECLARE
  v_parts TEXT[];
BEGIN
  -- Reject NULL or missing prefix
  IF p_ref IS NULL OR p_ref NOT LIKE 'holding:%' THEN
    RETURN;
  END IF;

  -- Strip 'holding:' prefix (8 chars) and split on ':'
  v_parts := string_to_array(substring(p_ref FROM 9), ':');

  -- Require exactly 3 parts: venue, symbol, holding_type
  IF array_length(v_parts, 1) != 3 THEN
    RETURN;
  END IF;

  venue        := v_parts[1];
  symbol       := v_parts[2];
  holding_type := v_parts[3];
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."parse_holding_ref"("p_ref" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."parse_holding_ref"("p_ref" "text") IS 'Phase 09 / D-12. Parses "holding:{venue}:{symbol}:{holding_type}" into a typed row. Returns empty result set for NULL, non-holding: prefixed strings, or refs that do not split into exactly 3 colon-delimited parts after stripping the prefix. IMMUTABLE — safe for use in index expressions and planner optimization.';



CREATE OR REPLACE FUNCTION "public"."persist_csv_daily_returns"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_rows" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid  UUID    := auth.uid();
  v_owner_id  UUID;
  v_row_count INTEGER;
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'persist_csv_daily_returns called without an auth session' USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_user_id (%) does not match auth.uid (%)', p_user_id, v_auth_uid USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner_id
    FROM public.strategies WHERE id = p_strategy_id;
  IF v_owner_id IS NULL OR v_owner_id <> p_user_id THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: strategy % not accessible', p_strategy_id USING ERRCODE = '42501';
  END IF;

  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows must be a JSONB array, got %', jsonb_typeof(p_rows) USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows exceeds 5000 rows (got %)', jsonb_array_length(p_rows) USING ERRCODE = '22023';
  END IF;

  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows is empty' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.csv_daily_returns (strategy_id, date, daily_return)
  SELECT
    p_strategy_id,
    (elem->>'date')::DATE,
    (elem->>'daily_return')::DOUBLE PRECISION
  FROM jsonb_array_elements(p_rows) elem
  ON CONFLICT (strategy_id, date) DO UPDATE
    SET daily_return = EXCLUDED.daily_return,
        updated_at   = now();

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  RETURN v_row_count;
END;
$$;


ALTER FUNCTION "public"."persist_csv_daily_returns"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_rows" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."persist_csv_daily_returns"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_rows" "jsonb") IS 'Phase 19.1 / Task 1 — Bulk-upserts a daily-return series into csv_daily_returns. Asserts auth.uid() = p_user_id AND strategy.user_id = p_user_id before inserting (probe-oracle closed via collapsed 42501). Idempotent via ON CONFLICT DO UPDATE. Row limit 5000. Returns count of rows affected.';



CREATE OR REPLACE FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_flag          TEXT;
  v_is_view       BOOLEAN;
  v_legacy_writes BIGINT := 0;
BEGIN
  SELECT value INTO v_flag
    FROM feature_flags
   WHERE flag_key = 'process_key_unified_backbone';

  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'verification_requests'
  ) INTO v_is_view;

  -- Robust write detection: count the audit-log rows the trigger above emits
  -- on EVERY write (INSERT/UPDATE/DELETE). Works whether verification_requests
  -- is still a BASE TABLE (pre view-shim) or has been renamed to
  -- verification_requests_legacy (the trigger travels with the table on rename).
  SELECT count(*) INTO v_legacy_writes
    FROM audit_log
   WHERE entity_type = 'verification_requests_legacy_write'
     AND created_at > p_since;

  RETURN jsonb_build_object(
    'flag_value',         COALESCE(v_flag, 'unset'),
    'vr_is_view',         v_is_view,
    'legacy_write_count', v_legacy_writes,
    'since',              p_since,
    'checked_at',         now()
  );
END;
$$;


ALTER FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) IS 'Phase 19 soak probe. SECURITY DEFINER; returns ONLY scalars (kill-switch flag value, whether verification_requests is a VIEW, and the count of verification_requests_legacy_write audit rows since p_since). No row data / PII. GRANTed to anon so the hourly stability workflow can measure prod without a service_role key.';



CREATE OR REPLACE FUNCTION "public"."positions_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."positions_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_profile_role_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- Privileged session roles can change role for admin / support cases.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'profiles.role is set at signup and cannot be changed from the client. '
    'Contact support to switch between allocator and manager accounts.'
    USING ERRCODE = 'check_violation';
END;
$$;


ALTER FUNCTION "public"."prevent_profile_role_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_profile_role_change"() IS 'Locks profiles.role after signup (2026-05-20). The signup form is now the only place a regular user picks their role. Admin support paths through service_role still work; the trigger no-ops when role is unchanged so stale UI payloads that re-send the same value do not break.';



CREATE OR REPLACE FUNCTION "public"."reclaim_stuck_compute_jobs"("p_older_than" interval DEFAULT '00:10:00'::interval) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."reclaim_stuck_compute_jobs"("p_older_than" interval) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reclaim_stuck_compute_jobs"("p_older_than" interval) IS 'Watchdog: resets running jobs whose claimed_at is older than p_older_than back to pending. audit-2026-05-07 M-0781: bounded at 500 rows per call via SELECT ... FOR UPDATE SKIP LOCKED so a large backlog drains over multiple ticks without holding contention-inducing lock counts. mig 109 P2 attempts-decrement + reclaim_count bump preserved. See migrations 109, 117, audit-2026-05-07.';



CREATE OR REPLACE FUNCTION "public"."reconnect_allocator_api_key"("p_api_key_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_already_disc
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'reconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: not disconnected → NO-OP.
  IF v_already_disc IS NULL THEN
    RETURN false;
  END IF;

  UPDATE api_keys
    SET disconnected_at = NULL,
        sync_error      = NULL,
        sync_status     = 'idle'
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NOT NULL;

  RETURN true;
END;
$$;


ALTER FUNCTION "public"."reconnect_allocator_api_key"("p_api_key_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconnect_allocator_api_key"("p_api_key_id" "uuid") IS 'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected.';



CREATE OR REPLACE FUNCTION "public"."reconstruct_positions_atomic"("p_strategy_id" "uuid", "p_positions" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'reconstruct_positions_atomic: p_strategy_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_strategy_id::text));

  DELETE FROM positions WHERE strategy_id = p_strategy_id;

  IF p_positions IS NOT NULL AND jsonb_typeof(p_positions) = 'array' THEN
    INSERT INTO positions (
      strategy_id,
      symbol,
      side,
      status,
      entry_price_avg,
      exit_price_avg,
      size_base,
      size_peak,
      realized_pnl,
      fee_total,
      roi,
      duration_days,
      opened_at,
      closed_at,
      fill_count,
      funding_pnl
    )
    SELECT
      (elem->>'strategy_id')::UUID,
      elem->>'symbol',
      elem->>'side',
      elem->>'status',
      (elem->>'entry_price_avg')::NUMERIC,
      NULLIF(elem->>'exit_price_avg', '')::NUMERIC,
      (elem->>'size_base')::NUMERIC,
      (elem->>'size_peak')::NUMERIC,
      NULLIF(elem->>'realized_pnl', '')::NUMERIC,
      NULLIF(elem->>'fee_total', '')::NUMERIC,
      NULLIF(elem->>'roi', '')::NUMERIC,
      NULLIF(elem->>'duration_days', '')::NUMERIC,
      (elem->>'opened_at')::TIMESTAMPTZ,
      NULLIF(elem->>'closed_at', '')::TIMESTAMPTZ,
      COALESCE((elem->>'fill_count')::INTEGER, 0),
      COALESCE((elem->>'funding_pnl')::NUMERIC, 0)
    FROM jsonb_array_elements(p_positions) AS elem;

    GET DIAGNOSTICS v_inserted = ROW_COUNT;
  ELSE
    v_inserted := 0;
  END IF;

  RAISE NOTICE 'reconstruct_positions_atomic: strategy=% inserted=%', p_strategy_id, v_inserted;
END;
$$;


ALTER FUNCTION "public"."reconstruct_positions_atomic"("p_strategy_id" "uuid", "p_positions" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconstruct_positions_atomic"("p_strategy_id" "uuid", "p_positions" "jsonb") IS 'Atomic DELETE-then-INSERT of positions for a single strategy. See mig 113.';



CREATE OR REPLACE FUNCTION "public"."reject_sentinel_writes"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'profiles' THEN
    IF lower(trim(coalesce(NEW.display_name, ''))) LIKE '[deleted%' THEN
      RAISE EXCEPTION 'reject_sentinel_writes: profiles.display_name cannot be set to [deleted] sentinel. audit-2026-05-07 P911.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF TG_TABLE_NAME = 'strategies' THEN
    IF lower(trim(coalesce(NEW.name, ''))) LIKE '[deleted%' THEN
      RAISE EXCEPTION 'reject_sentinel_writes: strategies.name cannot be set to [deleted strategy] sentinel. audit-2026-05-07 P911.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  ELSIF TG_TABLE_NAME = 'portfolios' THEN
    IF lower(trim(coalesce(NEW.name, ''))) LIKE '[deleted%' THEN
      RAISE EXCEPTION 'reject_sentinel_writes: portfolios.name cannot be set to [deleted portfolio] sentinel. audit-2026-05-07 P911.'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."reject_sentinel_writes"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reject_sentinel_writes"() IS 'Rejects user-originated writes that land the sanitize_user sentinel into profiles/strategies/portfolios. Gated on current_user IN (authenticated, anon). See migrations 120, 127.';



CREATE OR REPLACE FUNCTION "public"."request_allocator_holdings_sync"("p_api_key_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_uid                UUID := auth.uid();
  v_owner              UUID;
  v_job_id             UUID;
  v_next_attempt       TIMESTAMPTZ;
  v_prior_reconstruct  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- Existing poll enqueue (preserve semantics exactly — Phase 06 / D-14).
  BEGIN
    v_job_id := enqueue_compute_job(
      p_strategy_id := NULL,
      p_kind        := 'poll_allocator_positions',
      p_api_key_id  := p_api_key_id
    );
  EXCEPTION WHEN unique_violation THEN
    -- f8: surface next_attempt_at so the UI can render deferred-cooldown
    -- state on a per-exchange rate-limit contagion event.
    SELECT next_attempt_at INTO v_next_attempt
      FROM compute_jobs
      WHERE api_key_id = p_api_key_id
        AND kind = 'poll_allocator_positions'
        AND status IN ('pending','running','done_pending_children')
      ORDER BY next_attempt_at DESC
      LIMIT 1;
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END;

  -- Per-api_key reconstruction gate (replaces migration 070's allocator-
  -- scoped snapshot-count check). Skip enqueue ONLY if THIS key has
  -- previously completed a reconstruct OR is currently in-flight.
  SELECT EXISTS (
    SELECT 1 FROM compute_jobs
    WHERE api_key_id = p_api_key_id
      AND kind = 'reconstruct_allocator_history'
      AND status IN ('done','pending','running','done_pending_children')
  ) INTO v_prior_reconstruct;

  IF NOT v_prior_reconstruct THEN
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'reconstruct_allocator_history',
        p_idempotency_key := 'reconstruct-alloc-' || p_api_key_id::text || '-initial',
        p_api_key_id      := p_api_key_id
      );
    EXCEPTION WHEN unique_violation THEN
      NULL; -- racing first-connect call landed first; benign
    END;
  END IF;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;


ALTER FUNCTION "public"."request_allocator_holdings_sync"("p_api_key_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."request_allocator_holdings_sync"("p_api_key_id" "uuid") IS 'Authenticated wrapper. Enqueues poll_allocator_positions; for any api_key with no prior reconstruct_allocator_history job (done or in-flight) also enqueues that. Phase 07 / Migration 076 — replaces 070''s allocator-scoped snapshot-count gate which prevented adding a second exchange.';



CREATE OR REPLACE FUNCTION "public"."reset_stalled_compute_jobs"("p_stale_threshold" interval DEFAULT '00:10:00'::interval, "p_per_kind_overrides" "jsonb" DEFAULT NULL::"jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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


ALTER FUNCTION "public"."reset_stalled_compute_jobs"("p_stale_threshold" interval, "p_per_kind_overrides" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reset_stalled_compute_jobs"("p_stale_threshold" interval, "p_per_kind_overrides" "jsonb") IS 'Per-kind watchdog: resets running jobs whose claimed_at is older than threshold (global or per-kind) back to pending. mig 117 claim_token=NULL invalidation preserved. audit-2026-05-07 M-0781: each pass bounded at 500 rows via FOR UPDATE SKIP LOCKED so the watchdog never blocks waiting on a row currently being claimed. See migrations 033, 117, audit-2026-05-07.';



CREATE OR REPLACE FUNCTION "public"."reset_stalled_portfolio_analytics"("p_stale_threshold" interval DEFAULT '00:30:00'::interval) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_reset INTEGER := 0;
BEGIN
  IF p_stale_threshold IS NULL OR p_stale_threshold <= interval '0' THEN
    RAISE EXCEPTION
      'reset_stalled_portfolio_analytics: p_stale_threshold must be > 0, got %',
      p_stale_threshold
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE portfolio_analytics
     SET computation_status = 'failed',
         computation_error  = COALESCE(
           computation_error,
           'watchdog: stale ''computing'' row reaped after stale_threshold'
         )
   WHERE computation_status = 'computing'
     AND computed_at < (now() - p_stale_threshold);

  GET DIAGNOSTICS v_reset = ROW_COUNT;

  RETURN v_reset;
END;
$$;


ALTER FUNCTION "public"."reset_stalled_portfolio_analytics"("p_stale_threshold" interval) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reset_stalled_portfolio_analytics"("p_stale_threshold" interval) IS 'audit-2026-05-07 C-0213/H-0572 — reap portfolio_analytics rows stuck in computation_status=computing past the stale_threshold. Call from the Railway worker cron tick / pod startup.';



CREATE OR REPLACE FUNCTION "public"."retention_delete_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_deleted_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_deleted_count FROM old_table;
  IF v_deleted_count > 100000 THEN
    RAISE EXCEPTION
      'retention_delete_guard: DELETE on % affected % rows, exceeding the 100,000-row safety ceiling. audit-2026-05-07 P917.',
      TG_TABLE_NAME, v_deleted_count
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."retention_delete_guard"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."retention_delete_guard"() IS 'STATEMENT-level AFTER DELETE guard. Aborts a DELETE that touches >100,000 rows on audit_log/audit_log_cold. See migration 121 (audit-2026-05-07 P917).';



CREATE OR REPLACE FUNCTION "public"."sanitize_user"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_already_sanitized BOOLEAN;
  v_target_email      TEXT;
  v_orphan_count      INTEGER := 0;
  v_orphan_org_id     UUID;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'sanitize_user: p_user_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- audit-2026-05-07 H-0900 (preserved): advisory lock so concurrent admin
  -- clicks serialize on the same user.
  PERFORM pg_advisory_xact_lock(hashtext('sanitize_user:' || p_user_id::text));

  -- mig 120 P911 (preserved): signal the sentinel-rejection triggers.
  PERFORM set_config('quantalyze.sanitize_in_progress', 'on', true);

  SELECT (display_name = '[deleted]') INTO v_already_sanitized
  FROM profiles WHERE id = p_user_id;

  IF v_already_sanitized IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_already_sanitized THEN
    RETURN FALSE;
  END IF;

  SELECT email INTO v_target_email FROM profiles WHERE id = p_user_id;

  -- audit-2026-05-07 H-0908 + H-0909 (preserved): sole-admin organization
  -- detection with audit emission.
  BEGIN
    FOR v_orphan_org_id IN
      SELECT om1.organization_id
        FROM organization_members om1
       WHERE om1.user_id = p_user_id
         AND om1.role IN ('owner', 'admin')
         AND NOT EXISTS (
           SELECT 1 FROM organization_members om2
            WHERE om2.organization_id = om1.organization_id
              AND om2.user_id <> p_user_id
              AND om2.role IN ('owner', 'admin')
         )
    LOOP
      PERFORM public.log_audit_event_service(
        p_user_id,
        'organization.orphaned_by_sanitize',
        'organization',
        v_orphan_org_id,
        jsonb_build_object(
          'reason',           'sole_admin_sanitized',
          'organization_id',  v_orphan_org_id,
          'sanitized_user_id', p_user_id
        )
      );
      v_orphan_count := v_orphan_count + 1;
    END LOOP;
  EXCEPTION
    WHEN unique_violation
      OR check_violation
      OR string_data_right_truncation
      OR numeric_value_out_of_range
      OR insufficient_privilege THEN
      RAISE NOTICE 'audit-2026-05-07 H-0908/H-0909: orphan-organization audit emission failed for user % (sqlstate=%, msg=%); sanitize continues',
        p_user_id, SQLSTATE, SQLERRM;
  END;

  UPDATE profiles SET
    display_name  = '[deleted]',
    company       = NULL,
    description   = NULL,
    email         = NULL,
    telegram      = NULL,
    website       = NULL,
    linkedin      = NULL,
    avatar_url    = NULL,
    bio           = NULL,
    years_trading = NULL,
    aum_range     = NULL,
    partner_tag   = NULL
  WHERE id = p_user_id
    AND display_name IS DISTINCT FROM '[deleted]';

  DELETE FROM api_keys WHERE user_id = p_user_id;

  UPDATE strategies SET
    name                 = '[deleted strategy]',
    description          = NULL,
    codename             = NULL,
    public_contact_email = NULL,
    partner_tag          = NULL,
    review_note          = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted strategy]';

  UPDATE trades SET
    raw_data          = NULL,
    exchange_order_id = NULL,
    exchange_fill_id  = NULL
  WHERE strategy_id IN (SELECT id FROM strategies WHERE user_id = p_user_id)
    AND (raw_data IS NOT NULL OR exchange_order_id IS NOT NULL OR exchange_fill_id IS NOT NULL);

  IF v_target_email IS NOT NULL THEN
    DELETE FROM verification_requests WHERE email = v_target_email;

    -- audit-2026-05-07 M-0796 + PR #182 retro audit (Task #57): purge
    -- notification_dispatches rows keyed to the target user's email. The
    -- retention cron's 180d wall is too slow for GDPR Art. 17 — explicit
    -- erasure must remove recipient PII immediately. Filter by
    -- recipient_email (the only PII surface on notification_dispatches)
    -- instead of user_id (the table has no user_id column per mig
    -- 20260409002118). v_target_email is captured before the profiles
    -- UPDATE that nulls profiles.email.
    --
    -- Retro fix: case-insensitive LOWER(...) match. Per RFC 5321 email
    -- domain is always case-insensitive, and the local-part is case-
    -- insensitive in mainstream MTAs. A case-sensitive match could miss
    -- rows where profiles.email and notification_dispatches.recipient_email
    -- differ only in casing — silently breaching the GDPR Art. 17
    -- invariant this DELETE upholds.
    DELETE FROM notification_dispatches
     WHERE LOWER(recipient_email) = LOWER(v_target_email);
  END IF;

  UPDATE portfolios SET
    name        = '[deleted portfolio]',
    description = NULL
  WHERE user_id = p_user_id
    AND name IS DISTINCT FROM '[deleted portfolio]';

  DELETE FROM allocator_preferences WHERE user_id = p_user_id;
  DELETE FROM user_favorites        WHERE user_id = p_user_id;
  DELETE FROM user_notes            WHERE user_id = p_user_id;
  DELETE FROM investor_attestations WHERE user_id = p_user_id;
  DELETE FROM user_app_roles        WHERE user_id = p_user_id;
  DELETE FROM organization_members  WHERE user_id = p_user_id;

  DELETE FROM match_batches WHERE allocator_id = p_user_id;
  DELETE FROM organization_invites WHERE invited_by = p_user_id;

  UPDATE organizations
    SET created_by = NULL
    WHERE created_by = p_user_id
      AND created_by IS NOT NULL;

  DELETE FROM auth.refresh_tokens WHERE user_id::text = p_user_id::text;
  DELETE FROM auth.sessions       WHERE user_id = p_user_id;

  UPDATE auth.users SET
    email               = NULL,
    encrypted_password  = NULL,
    raw_user_meta_data  = '{}'::jsonb,
    raw_app_meta_data   = '{}'::jsonb,
    banned_until        = 'infinity'::timestamptz,
    email_confirmed_at  = NULL,
    phone               = NULL,
    phone_confirmed_at  = NULL
  WHERE id = p_user_id;

  -- audit-2026-05-07 H-0899 + H-0905 (preserved): emit the audit-of-the-sanitize.
  BEGIN
    PERFORM public.log_audit_event_service(
      p_user_id,
      'gdpr.sanitize_user',
      'profile',
      p_user_id,
      jsonb_build_object(
        'orphaned_organizations', v_orphan_count,
        'sanitize_path',          'sanitize_user_rpc',
        'completed_at',           now()
      )
    );
  EXCEPTION
    WHEN unique_violation
      OR check_violation
      OR string_data_right_truncation
      OR numeric_value_out_of_range
      OR insufficient_privilege THEN
      RAISE NOTICE 'audit-2026-05-07 H-0899/H-0905: sanitize audit emission failed for user % (sqlstate=%, msg=%); sanitize succeeded',
        p_user_id, SQLSTATE, SQLERRM;
  END;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."sanitize_user"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sanitize_user"("p_user_id" "uuid") IS 'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. Migration 120 added sentinel-rejection trigger signaling, partner_tag NULLing, defensive organizations predicate, auth.users anonymize + session purge. audit-2026-05-07 H-0899/H-0900/H-0905/H-0908/H-0909 additions: pg_advisory_xact_lock serializes concurrent admin invocations, sole-admin organization detection emits orphan audit_log rows, the sanitize itself emits one audit_log row per successful run. audit-2026-05-07 M-0796: purges notification_dispatches keyed to the target email (GDPR Art. 17 immediate erasure of recipient PII). PR #182 retro audit (Task #57): recipient_email match uses LOWER(...) case-insensitivity per RFC 5321 to avoid silently missing rows when profiles.email and notification_dispatches.recipient_email differ only in casing.';



CREATE OR REPLACE FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  INSERT INTO weight_snapshots (
    portfolio_id, strategy_id, snapshot_date, target_weight, actual_weight
  )
  VALUES (
    NEW.portfolio_id, NEW.strategy_id, CURRENT_DATE, NULL, NULL
  )
  ON CONFLICT (portfolio_id, strategy_id, snapshot_date) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_weight_snapshots_for_portfolio"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  INSERT INTO weight_snapshots (
    portfolio_id, strategy_id, snapshot_date, target_weight, actual_weight
  )
  SELECT NEW.id, ps.strategy_id, CURRENT_DATE, NULL, NULL
  FROM portfolio_strategies ps
  WHERE ps.portfolio_id = NEW.id
  ON CONFLICT (portfolio_id, strategy_id, snapshot_date) DO NOTHING;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."seed_weight_snapshots_for_portfolio"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") RETURNS TABLE("contact_request_id" "uuid", "match_decision_id" "uuid", "was_already_sent" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_existing_cr_id UUID;
  v_new_cr_id UUID;
  v_decision_id UUID;
  v_was_already_sent BOOLEAN := false;
BEGIN
  SELECT id INTO v_existing_cr_id
  FROM contact_requests
  WHERE allocator_id = p_allocator_id AND strategy_id = p_strategy_id;

  IF v_existing_cr_id IS NOT NULL THEN
    v_was_already_sent := true;
    v_new_cr_id := v_existing_cr_id;
  ELSE
    INSERT INTO contact_requests (allocator_id, strategy_id, status, message)
    VALUES (p_allocator_id, p_strategy_id, 'pending', p_admin_note)
    RETURNING id INTO v_new_cr_id;
  END IF;

  INSERT INTO match_decisions (
    allocator_id, strategy_id, original_strategy_id, candidate_id, decision,
    founder_note, contact_request_id, decided_by
  ) VALUES (
    p_allocator_id, p_strategy_id, p_original_strategy_id, p_candidate_id, 'sent_as_intro',
    p_admin_note, v_new_cr_id, p_decided_by
  )
  ON CONFLICT (allocator_id, strategy_id) WHERE decision = 'sent_as_intro' DO NOTHING
  RETURNING id INTO v_decision_id;

  IF v_decision_id IS NULL THEN
    SELECT id INTO v_decision_id
    FROM match_decisions
    WHERE allocator_id = p_allocator_id
      AND strategy_id = p_strategy_id
      AND decision = 'sent_as_intro';
  END IF;

  RETURN QUERY SELECT v_new_cr_id, v_decision_id, v_was_already_sent;
END;
$$;


ALTER FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_allocator_holdings_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_allocator_holdings_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_first_api_key_added"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
BEGIN
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = NEW.user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing := NULLIF(v_meta->>'first_api_key_added_at', '')::TIMESTAMPTZ;

  IF v_existing IS NOT NULL THEN
    RETURN NEW;
  END IF;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_api_key_added_at',
                                   to_char(now() AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = NEW.user_id;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."stamp_first_api_key_added"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_first_bridge_surfaced"("p_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
  v_existing_text TEXT;
  v_new_stamp TEXT;
BEGIN
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('stamped', false, 'stamped_at', NULL);
  END IF;

  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing_text := NULLIF(v_meta->>'first_bridge_surfaced_at', '');
  v_existing := v_existing_text::TIMESTAMPTZ;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'stamped', false,
      'stamped_at', v_existing_text
    );
  END IF;

  v_new_stamp := to_char(now() AT TIME ZONE 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_bridge_surfaced_at', v_new_stamp
                                 )
   WHERE id = p_user_id;

  RETURN jsonb_build_object(
    'stamped', true,
    'stamped_at', v_new_stamp
  );
END;
$$;


ALTER FUNCTION "public"."stamp_first_bridge_surfaced"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."stamp_first_sync_success"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public'
    AS $$
DECLARE
  v_meta JSONB;
  v_existing TIMESTAMPTZ;
BEGIN
  SELECT raw_user_meta_data
    INTO v_meta
    FROM auth.users
    WHERE id = p_user_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_meta := COALESCE(v_meta, '{}'::JSONB);
  v_existing := NULLIF(v_meta->>'first_sync_success_at', '')::TIMESTAMPTZ;

  IF v_existing IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE auth.users
     SET raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::JSONB)
                              || jsonb_build_object(
                                   'first_sync_success_at',
                                   to_char(now() AT TIME ZONE 'UTC',
                                           'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                                 )
   WHERE id = p_user_id;
END;
$$;


ALTER FUNCTION "public"."stamp_first_sync_success"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
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

  -- (d) no rows → preserve existing strategy_analytics row. Bail out
  -- before any write. Protects brand-new strategies with a default
  -- 'pending' row, and legacy strategies whose analytics landed through
  -- the pre-Sprint-3 after() path without ever going through compute_jobs.
  SELECT count(*) INTO v_job_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id;

  IF v_job_count = 0 THEN
    RETURN;
  END IF;

  -- (a) any non-terminal row → UI shows 'computing'. Terminal states are
  -- 'done' and 'failed_final' only; everything else is still in motion.
  -- failed_retry is non-terminal because the worker will pick it up again
  -- after the backoff window.
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

  IF v_nonterminal_count > 0 THEN
    -- Upsert with on-conflict update. strategy_analytics has UNIQUE
    -- constraint on strategy_id (migration 001:72).
    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'computing', NULL)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (b) all terminal, any failed_final → UI shows 'failed'. Pull the
  -- latest failed_final row's last_error so the UI can render a meaningful
  -- diagnostic. `updated_at` is stamped by the compute_jobs_set_updated_at
  -- trigger (032:254), so ORDER BY updated_at DESC is the canonical way
  -- to pick the most recent terminal failure.
  SELECT count(*) INTO v_failed_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status = 'failed_final';

  IF v_failed_count > 0 THEN
    SELECT last_error
      INTO v_latest_error
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND status = 'failed_final'
     ORDER BY updated_at DESC
     LIMIT 1;

    INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
    VALUES (p_strategy_id, 'failed', v_latest_error)
    ON CONFLICT (strategy_id) DO UPDATE
       SET computation_status = EXCLUDED.computation_status,
           computation_error  = EXCLUDED.computation_error,
           computed_at        = now();
    RETURN;
  END IF;

  -- (c) all rows 'done' → UI shows 'complete'. Clear any stale
  -- computation_error from a previous failed run so the UI doesn't show
  -- "complete with error X" contradictory state.
  INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error)
  VALUES (p_strategy_id, 'complete', NULL)
  ON CONFLICT (strategy_id) DO UPDATE
     SET computation_status = EXCLUDED.computation_status,
         computation_error  = EXCLUDED.computation_error,
         computed_at        = now();
END;
$$;


ALTER FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") IS 'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any failed_final → failed (with latest error), all done → complete, no rows → no-op (preserve existing). Called by services.job_worker.dispatch after every strategy-scoped job. Service-role only. See migration 038.';



CREATE OR REPLACE FUNCTION "public"."sync_trades"("p_strategy_id" "uuid", "p_trades" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  trade_count INTEGER;
  v_min_ts    TIMESTAMPTZ;
  v_max_ts    TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_strategy_id::text));

  SELECT
      MIN((t->>'timestamp')::timestamptz),
      MAX((t->>'timestamp')::timestamptz)
    INTO v_min_ts, v_max_ts
    FROM jsonb_array_elements(p_trades) AS t;

  IF v_min_ts IS NOT NULL AND v_max_ts IS NOT NULL THEN
    DELETE FROM trades
     WHERE strategy_id = p_strategy_id
       AND COALESCE(is_fill, false) = false
       AND timestamp >= v_min_ts
       AND timestamp <= v_max_ts;
  END IF;

  INSERT INTO trades (strategy_id, exchange, symbol, side, price, quantity, fee, fee_currency, timestamp, order_type)
  SELECT
    p_strategy_id,
    (t->>'exchange')::text,
    (t->>'symbol')::text,
    (t->>'side')::text,
    (t->>'price')::decimal,
    (t->>'quantity')::decimal,
    COALESCE((t->>'fee')::decimal, 0),
    COALESCE(t->>'fee_currency', 'USDT'),
    (t->>'timestamp')::timestamptz,
    COALESCE(t->>'order_type', 'market')
  FROM jsonb_array_elements(p_trades) AS t;

  GET DIAGNOSTICS trade_count = ROW_COUNT;
  RETURN trade_count;
END;
$$;


ALTER FUNCTION "public"."sync_trades"("p_strategy_id" "uuid", "p_trades" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_trades"("p_strategy_id" "uuid", "p_trades" "jsonb") IS 'Phase-1 daily_pnl replacement for a strategy. DELETEs only is_fill=false rows whose timestamp falls inside the incoming payload window so older rows the exchange has trimmed survive the retry. Phase 2 raw fills preserved per mig 102.';



CREATE OR REPLACE FUNCTION "public"."test_force_cold_purge"("p_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_purged INT := 0;
  v_is_service_role BOOLEAN := FALSE;
  v_caller_uid UUID;
BEGIN
  -- H-0010: service_role-only gate. This is a test-cleanup RPC with no
  -- production caller, so we do NOT permit admin users (unlike migration
  -- 122). auth.role() can raise when no JWT is present (→ EXCEPTION
  -- handler) OR return NULL when the role claim is simply absent (e.g. a
  -- direct DB connection). `(NULL = 'service_role')` is NULL, NOT FALSE,
  -- so we MUST use `IS NOT TRUE` below — a plain `IF NOT v_is_service_role`
  -- would be `IF NULL` and silently SKIP the gate, letting a no-role
  -- caller through. `IS NOT TRUE` raises on both NULL and FALSE.
  BEGIN
    v_is_service_role := (auth.role() = 'service_role');
  EXCEPTION WHEN OTHERS THEN
    v_is_service_role := FALSE;
  END;

  IF v_is_service_role IS NOT TRUE THEN
    RAISE EXCEPTION
      'test_force_cold_purge: service_role JWT required (test-only RPC, no production caller). audit-2026-05-07 H-0010.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  BEGIN
    v_caller_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_caller_uid := NULL;
  END;

  -- Emit an audit_log row BEFORE the destructive delete so the use of
  -- this append-only bypass is itself traceable (mirrors migration 122).
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_caller_uid, '00000000-0000-0000-0000-000000000000'::uuid),
    'test_force_cold_purge',
    'audit_log_cold',
    p_id,
    jsonb_build_object('invoked_via', 'service_role', 'caller_uid', v_caller_uid)
  );

  -- Scoped DELETE: ONLY test-probe rows. The doubled guard
  -- (entity_type = 'test_probe' AND the literal `__cold_test_` action
  -- prefix) makes it impossible to purge a genuine compliance row even
  -- with the service-role key. The underscores are LIKE wildcards, so we
  -- ESCAPE them to match the literal prefix.
  DELETE FROM audit_log_cold
   WHERE id = p_id
     AND entity_type = 'test_probe'
     AND action LIKE '\_\_cold\_test\_%' ESCAPE '\';

  GET DIAGNOSTICS v_purged = ROW_COUNT;
  RETURN v_purged;
END;
$$;


ALTER FUNCTION "public"."test_force_cold_purge"("p_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_force_cold_purge"("p_id" "uuid") IS 'TEST-ONLY RPC. service_role EXECUTE only + in-body auth.role() gate. DELETEs a single audit_log_cold row ONLY when it is a test probe (entity_type=test_probe AND action LIKE ''__cold_test_%'') — cannot purge genuine compliance rows. Emits an audit_log row before the delete. Mirrors test_force_hot_to_cold_move (migrations 057/122). audit-2026-05-07 H-0010.';



CREATE OR REPLACE FUNCTION "public"."test_force_hot_to_cold_move"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_moved INT := 0;
  v_is_service_role BOOLEAN := FALSE;
  v_is_admin BOOLEAN := FALSE;
  v_caller_uid UUID;
BEGIN
  BEGIN
    v_is_service_role := (auth.role() = 'service_role');
  EXCEPTION WHEN OTHERS THEN
    v_is_service_role := FALSE;
  END;

  BEGIN
    v_caller_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_caller_uid := NULL;
  END;

  IF v_caller_uid IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM user_app_roles
      WHERE user_id = v_caller_uid AND role = 'admin'
    ) INTO v_is_admin;
  END IF;

  IF NOT v_is_service_role AND NOT v_is_admin THEN
    RAISE EXCEPTION
      'test_force_hot_to_cold_move: not authorized. Requires service_role JWT OR authenticated caller with role=admin in user_app_roles. audit-2026-05-07 P918.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    COALESCE(v_caller_uid, '00000000-0000-0000-0000-000000000000'::uuid),
    'test_force_hot_to_cold_move',
    'audit_log',
    'a0a0a0a0-0000-0000-0000-000000000056'::uuid,
    jsonb_build_object(
      'invoked_via', CASE WHEN v_is_service_role THEN 'service_role' ELSE 'admin_user' END,
      'caller_uid', v_caller_uid
    )
  );

  WITH archived AS (
    DELETE FROM audit_log
    WHERE created_at < now() - interval '2 years'
    RETURNING id, user_id, action, entity_type, entity_id, metadata, created_at
  )
  INSERT INTO audit_log_cold (id, user_id, action, entity_type, entity_id, metadata, created_at)
  SELECT id, user_id, action, entity_type, entity_id, metadata, created_at
  FROM archived
  ON CONFLICT (id) DO NOTHING;

  GET DIAGNOSTICS v_moved = ROW_COUNT;
  RETURN v_moved;
END;
$$;


ALTER FUNCTION "public"."test_force_hot_to_cold_move"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."test_force_hot_to_cold_move"() IS 'TEST-ONLY / admin-recovery RPC. Now gated by role check (service_role OR admin in user_app_roles) AND emits an audit_log row before the move. service_role EXECUTE only. audit-2026-05-07 P918. See migrations 057 + 122.';



CREATE OR REPLACE FUNCTION "public"."transition_strategy_verification"("p_verification_id" "uuid", "p_new_status" "text", "p_metadata" "jsonb" DEFAULT NULL::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_row strategy_verifications%ROWTYPE;
  v_legal BOOLEAN;
  v_legal_pairs CONSTANT TEXT[][] := ARRAY[
    ARRAY['draft','validated'],
    ARRAY['validated','metrics_captured'],
    ARRAY['metrics_captured','encrypted'],
    ARRAY['encrypted','report_queued'],
    ARRAY['report_queued','published']
  ];
  v_pair TEXT[];
  v_metrics_snapshot JSONB;
  v_errors JSONB;
  v_encrypted JSONB;
  v_correlation_id UUID;
  v_result JSONB;
BEGIN
  SELECT * INTO v_row
    FROM strategy_verifications
   WHERE id = p_verification_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'strategy_verification % not found', p_verification_id
      USING ERRCODE = '22023';
  END IF;

  v_legal := FALSE;
  FOREACH v_pair SLICE 1 IN ARRAY v_legal_pairs LOOP
    IF v_row.status = v_pair[1] AND p_new_status = v_pair[2] THEN
      v_legal := TRUE;
      EXIT;
    END IF;
  END LOOP;

  IF NOT v_legal AND p_new_status = 'draft' AND p_metadata IS NOT NULL AND p_metadata ? 'errors' THEN
    v_legal := TRUE;
  END IF;

  IF NOT v_legal THEN
    RAISE EXCEPTION 'illegal transition % → % for verification %',
      v_row.status, p_new_status, p_verification_id
      USING ERRCODE = '22023';
  END IF;

  v_metrics_snapshot := COALESCE(p_metadata->'metrics_snapshot', v_row.metrics_snapshot);
  v_errors           := COALESCE(p_metadata->'errors', v_row.errors);
  v_encrypted        := COALESCE(p_metadata->'encrypted_credentials', v_row.encrypted_credentials);
  IF p_metadata IS NOT NULL AND p_metadata ? 'correlation_id' THEN
    v_correlation_id := (p_metadata->>'correlation_id')::UUID;
  ELSE
    v_correlation_id := v_row.correlation_id;
  END IF;

  UPDATE strategy_verifications
     SET status                 = p_new_status,
         transitioned_at        = now(),
         metrics_snapshot       = v_metrics_snapshot,
         errors                 = v_errors,
         encrypted_credentials  = v_encrypted,
         correlation_id         = v_correlation_id,
         updated_at             = now()
   WHERE id = p_verification_id
   RETURNING to_jsonb(strategy_verifications.*) INTO v_result;

  RETURN v_result;
END;
$$;


ALTER FUNCTION "public"."transition_strategy_verification"("p_verification_id" "uuid", "p_new_status" "text", "p_metadata" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."transition_strategy_verification"("p_verification_id" "uuid", "p_new_status" "text", "p_metadata" "jsonb") IS 'Phase 19 / BACKBONE-03. Single source of truth for strategy_verifications status changes. Adapter MUST NOT direct-UPDATE status. SECURITY DEFINER + SET search_path = public, pg_temp (mirrors migration 086 H-B).';



CREATE OR REPLACE FUNCTION "public"."update_allocator_mandates"("p_max_weight" numeric DEFAULT NULL::numeric, "p_preferred_strategy_types" "text"[] DEFAULT NULL::"text"[], "p_excluded_exchanges" "text"[] DEFAULT NULL::"text"[], "p_target_ticket_size_usd" numeric DEFAULT NULL::numeric, "p_mandate_archetype" "text" DEFAULT NULL::"text", "p_correlation_ceiling" numeric DEFAULT NULL::numeric, "p_max_drawdown_tolerance" numeric DEFAULT NULL::numeric, "p_liquidity_preference" "text" DEFAULT NULL::"text", "p_style_exclusions" "text"[] DEFAULT NULL::"text"[], "p_clear_fields" "text"[] DEFAULT '{}'::"text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_allowed_clear_fields CONSTANT TEXT[] := ARRAY[
    'max_weight','preferred_strategy_types','excluded_exchanges',
    'target_ticket_size_usd','mandate_archetype','correlation_ceiling',
    'max_drawdown_tolerance','liquidity_preference','style_exclusions'
  ];
  v_bad_field TEXT;
BEGIN
  -- 1. Auth guard (SQLSTATE 28000 maps to HTTP 401 in route handler).
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'update_allocator_mandates: no auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 2. Bounds validation (SQLSTATE 22023 maps to HTTP 400).
  IF p_max_weight IS NOT NULL AND (p_max_weight < 0.05 OR p_max_weight > 0.50) THEN
    RAISE EXCEPTION 'max_weight must be between 0.05 and 0.50'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_correlation_ceiling IS NOT NULL AND (p_correlation_ceiling < 0 OR p_correlation_ceiling > 1) THEN
    RAISE EXCEPTION 'correlation_ceiling must be between 0 and 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_max_drawdown_tolerance IS NOT NULL AND (p_max_drawdown_tolerance < 0 OR p_max_drawdown_tolerance > 1) THEN
    RAISE EXCEPTION 'max_drawdown_tolerance must be between 0 and 1'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_liquidity_preference IS NOT NULL AND p_liquidity_preference NOT IN ('high','medium','low') THEN
    RAISE EXCEPTION 'liquidity_preference must be high, medium, or low'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_mandate_archetype IS NOT NULL AND length(p_mandate_archetype) > 500 THEN
    RAISE EXCEPTION 'mandate_archetype must be 500 characters or less'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_target_ticket_size_usd IS NOT NULL AND (p_target_ticket_size_usd < 0 OR p_target_ticket_size_usd > 1000000000) THEN
    RAISE EXCEPTION 'target_ticket_size_usd must be between 0 and 1,000,000,000'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Whitelist p_clear_fields entries.
  IF array_length(p_clear_fields, 1) IS NOT NULL THEN
    SELECT f INTO v_bad_field
    FROM unnest(p_clear_fields) AS t(f)
    WHERE f <> ALL (v_allowed_clear_fields);
    IF v_bad_field IS NOT NULL THEN
      RAISE EXCEPTION 'p_clear_fields contains disallowed field: %', v_bad_field
        USING ERRCODE = 'invalid_parameter_value';
    END IF;
  END IF;

  -- 4. UPSERT with COALESCE — NULL params preserve existing value; p_clear_fields
  --    explicitly nulls out the listed columns. Matches migration 061:176-210.
  INSERT INTO allocator_preferences (
    user_id,
    max_weight, preferred_strategy_types, excluded_exchanges,
    target_ticket_size_usd, mandate_archetype,
    correlation_ceiling, max_drawdown_tolerance, liquidity_preference,
    style_exclusions, edited_by_user_id, mandate_edited_at, updated_at
  ) VALUES (
    v_auth_uid,
    p_max_weight, p_preferred_strategy_types, p_excluded_exchanges,
    p_target_ticket_size_usd, p_mandate_archetype,
    p_correlation_ceiling, p_max_drawdown_tolerance, p_liquidity_preference,
    p_style_exclusions, NULL, now(), now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    max_weight                = CASE WHEN 'max_weight' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.max_weight, allocator_preferences.max_weight) END,
    preferred_strategy_types  = CASE WHEN 'preferred_strategy_types' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.preferred_strategy_types, allocator_preferences.preferred_strategy_types) END,
    excluded_exchanges        = CASE WHEN 'excluded_exchanges' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.excluded_exchanges, allocator_preferences.excluded_exchanges) END,
    target_ticket_size_usd    = CASE WHEN 'target_ticket_size_usd' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.target_ticket_size_usd, allocator_preferences.target_ticket_size_usd) END,
    mandate_archetype         = CASE WHEN 'mandate_archetype' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.mandate_archetype, allocator_preferences.mandate_archetype) END,
    correlation_ceiling       = CASE WHEN 'correlation_ceiling' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.correlation_ceiling, allocator_preferences.correlation_ceiling) END,
    max_drawdown_tolerance    = CASE WHEN 'max_drawdown_tolerance' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.max_drawdown_tolerance, allocator_preferences.max_drawdown_tolerance) END,
    liquidity_preference      = CASE WHEN 'liquidity_preference' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.liquidity_preference, allocator_preferences.liquidity_preference) END,
    style_exclusions          = CASE WHEN 'style_exclusions' = ANY (p_clear_fields) THEN NULL
                                     ELSE COALESCE(EXCLUDED.style_exclusions, allocator_preferences.style_exclusions) END,
    edited_by_user_id         = NULL,  -- allocator self-edit marker
    mandate_edited_at         = now(), -- allocator-initiated write
    updated_at                = now();

  -- 5. Proactive rescore enqueue (D-12 Option B). Runs in the same transaction
  --    as the UPSERT so a rollback leaves no phantom job row. Single-inflight
  --    dedup handled by compute_jobs_one_inflight_per_kind_allocator partial
  --    unique index. Fires on every mandate write; no change detector
  --    (CONTEXT Claude's Discretion — simplest, partial unique index dedupes).
  PERFORM enqueue_compute_job(
    p_strategy_id     := NULL,
    p_kind            := 'rescore_allocator',
    p_idempotency_key := NULL,
    p_parent_job_ids  := '{}',
    p_exchange        := NULL,
    p_metadata        := NULL,
    p_allocator_id    := v_auth_uid
  );
END;
$$;


ALTER FUNCTION "public"."update_allocator_mandates"("p_max_weight" numeric, "p_preferred_strategy_types" "text"[], "p_excluded_exchanges" "text"[], "p_target_ticket_size_usd" numeric, "p_mandate_archetype" "text", "p_correlation_ceiling" numeric, "p_max_drawdown_tolerance" numeric, "p_liquidity_preference" "text", "p_style_exclusions" "text"[], "p_clear_fields" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_allocator_mandates"("p_max_weight" numeric, "p_preferred_strategy_types" "text"[], "p_excluded_exchanges" "text"[], "p_target_ticket_size_usd" numeric, "p_mandate_archetype" "text", "p_correlation_ceiling" numeric, "p_max_drawdown_tolerance" numeric, "p_liquidity_preference" "text", "p_style_exclusions" "text"[], "p_clear_fields" "text"[]) IS 'Allocator self-service mandate write path (MANDATE-05 / MANDATE-06). SECURITY DEFINER; derives user_id from auth.uid(). Named parameters; NULL = "preserve existing value" (COALESCE). p_clear_fields TEXT[] whitelisted. After the UPSERT, appends a PERFORM enqueue_compute_job(kind=rescore_allocator) for proactive Phase 3 cache invalidation (D-12 Option B). See migration 062.';



CREATE OR REPLACE FUNCTION "public"."update_api_key_rate_limit"("p_api_key_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_user_id        UUID;
  v_last_429_at    TIMESTAMPTZ;
  v_now            TIMESTAMPTZ := now();
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'update_api_key_rate_limit: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM _assert_owner('api_keys'::regclass, p_api_key_id, 'update_api_key_rate_limit');

  SELECT user_id, last_429_at
    INTO v_user_id, v_last_429_at
    FROM api_keys
    WHERE id = p_api_key_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'update_api_key_rate_limit: api_key % not found', p_api_key_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_last_429_at IS NOT NULL
     AND v_last_429_at >= v_now - interval '60 seconds' THEN
    RETURN;
  END IF;

  UPDATE api_keys
     SET last_429_at = v_now
   WHERE id = p_api_key_id;

  BEGIN
    PERFORM log_audit_event_service(
      v_user_id,
      'api_key.rate_limit_stamped',
      'api_key',
      p_api_key_id,
      jsonb_build_object(
        'previous_last_429_at', v_last_429_at,
        'stamped_at',           v_now,
        'source',               'update_api_key_rate_limit'
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'update_api_key_rate_limit: audit_log write failed for api_key % (sqlstate=%, msg=%); rate-limit stamp succeeded',
      p_api_key_id, SQLSTATE, SQLERRM;
  END;
END;
$$;


ALTER FUNCTION "public"."update_api_key_rate_limit"("p_api_key_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."update_api_key_rate_limit"("p_api_key_id" "uuid") IS 'Stamps api_keys.last_429_at = now() for the given key. Read by the Python job runner to decide circuit-breaker backoff. See migration 032.';



CREATE OR REPLACE FUNCTION "public"."upsert_strategy_analytics_series_batch"("p_strategy_id" "uuid", "p_kinds" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  INSERT INTO strategy_analytics_series (strategy_id, kind, payload, computed_at)
  SELECT p_strategy_id, key, value, now()
    FROM jsonb_each(p_kinds)
   ON CONFLICT (strategy_id, kind) DO UPDATE
      SET payload     = EXCLUDED.payload,
          computed_at = EXCLUDED.computed_at;
END;
$$;


ALTER FUNCTION "public"."upsert_strategy_analytics_series_batch"("p_strategy_id" "uuid", "p_kinds" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."upsert_strategy_analytics_series_batch"("p_strategy_id" "uuid", "p_kinds" "jsonb") IS 'Phase 12 / M-Grok-1: atomic batch upsert of sibling-table rows. Caller (analytics_runner) passes a JSONB object {kind: payload, ...}; all rows upsert in a single implicit transaction. Replaces the per-kind round-trip loop. service_role only. See migration 087.';



CREATE OR REPLACE FUNCTION "public"."user_notes_set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."user_notes_set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verification_requests_legacy_write_audit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  INSERT INTO audit_log (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    NULL,
    lower(TG_OP),                              -- 'insert' | 'update' | 'delete'
    'verification_requests_legacy_write',
    COALESCE(NEW.id, OLD.id),                  -- verification_requests.id (PK, NOT NULL)
    jsonb_build_object('tg_op', TG_OP, 'writer', session_user)
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."verification_requests_legacy_write_audit"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."verification_requests_legacy_write_audit"() IS 'Phase 19 soak detector trigger fn. Logs every direct write to verification_requests into audit_log (entity_type=verification_requests_legacy_write) so phase19_soak_status can count post-flip writes. SECURITY DEFINER; direct INSERT (audit_log.user_id is nullable, no log_audit_event_service which requires user_id).';



CREATE TABLE IF NOT EXISTS "public"."allocation_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "event_date" timestamp with time zone NOT NULL,
    "notes" "text",
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "allocation_events_amount_check" CHECK (("amount" > (0)::numeric)),
    CONSTRAINT "allocation_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['deposit'::"text", 'withdrawal'::"text"]))),
    CONSTRAINT "allocation_events_source_check" CHECK (("source" = ANY (ARRAY['auto'::"text", 'manual'::"text"])))
);


ALTER TABLE "public"."allocation_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."allocator_equity_snapshots" (
    "allocator_id" "uuid" NOT NULL,
    "asof" "date" NOT NULL,
    "value_usd" numeric NOT NULL,
    "breakdown" "jsonb",
    "reconstructed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'exchange_primary'::"text" NOT NULL,
    "history_depth_months" integer,
    CONSTRAINT "allocator_equity_snapshots_history_depth_check" CHECK ((("history_depth_months" IS NULL) OR ("history_depth_months" > 0))),
    CONSTRAINT "allocator_equity_snapshots_source_check" CHECK (("source" = ANY (ARRAY['exchange_primary'::"text", 'coingecko_fallback'::"text", 'mixed'::"text"])))
);


ALTER TABLE "public"."allocator_equity_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."allocator_equity_snapshots" IS 'Per-allocator per-day reconstructed equity series. Written by FastAPI worker (service_role). Phase 07 / D-02. history_depth_months added per VOICES-ACCEPTED f9 to surface venue-specific warm-up copy.';



COMMENT ON COLUMN "public"."allocator_equity_snapshots"."history_depth_months" IS 'Per-venue retention cap in months at time of reconstruction. Binance=24, OKX=3 (trades) / 24 (OHLCV), Bybit=24. NULL for CoinGecko fallback. Used by getMyAllocationDashboard to compute minHistoryDepthMonths for venue-specific KpiStrip warm-up messaging.';



CREATE TABLE IF NOT EXISTS "public"."allocator_holdings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "api_key_id" "uuid" NOT NULL,
    "venue" "text" NOT NULL,
    "symbol" "text" NOT NULL,
    "asof" "date" NOT NULL,
    "holding_type" "text" NOT NULL,
    "side" "text" NOT NULL,
    "quantity" numeric NOT NULL,
    "value_usd" numeric NOT NULL,
    "entry_price" numeric,
    "mark_price" numeric NOT NULL,
    "unrealized_pnl_usd" numeric,
    "cost_basis_usd" numeric,
    "raw_payload" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "allocator_holdings_holding_type_check" CHECK (("holding_type" = ANY (ARRAY['spot'::"text", 'derivative'::"text"]))),
    CONSTRAINT "allocator_holdings_side_check" CHECK (("side" = ANY (ARRAY['long'::"text", 'short'::"text", 'flat'::"text"])))
);


ALTER TABLE "public"."allocator_holdings" OWNER TO "postgres";


COMMENT ON TABLE "public"."allocator_holdings" IS 'Allocator-owned holdings stream — one row per (allocator_id, venue, symbol, asof). Produced by the FastAPI job worker via the poll_allocator_positions kind. Three-tier RLS (owner/admin/service) per D-03. Phase 06 / Plan 01. Schema mirrors position_snapshots on purpose so Phase 09 Bridge swap-the-source is cheap.';



COMMENT ON COLUMN "public"."allocator_holdings"."holding_type" IS 'Discriminator: spot (from fetch_balance) vs derivative (from fetch_positions). Phase 09 Bridge join keys on (symbol, holding_type) — not symbol alone (D-16).';



COMMENT ON COLUMN "public"."allocator_holdings"."cost_basis_usd" IS 'Derivative rows only (entry_price * abs(quantity)). Spot rows are NULL until Phase 08 notes / manual override backfills. Phase 9 Bridge logic gates spot P&L on NOT NULL (D-06).';



CREATE TABLE IF NOT EXISTS "public"."allocator_preferences" (
    "user_id" "uuid" NOT NULL,
    "mandate_archetype" "text",
    "target_ticket_size_usd" numeric,
    "excluded_exchanges" "text"[],
    "max_drawdown_tolerance" numeric,
    "min_track_record_days" integer,
    "min_sharpe" numeric,
    "max_aum_concentration" numeric,
    "preferred_strategy_types" "text"[],
    "preferred_markets" "text"[],
    "founder_notes" "text",
    "edited_by_user_id" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "max_weight" numeric,
    "correlation_ceiling" numeric,
    "liquidity_preference" "text",
    "style_exclusions" "text"[],
    "mandate_edited_at" timestamp with time zone,
    "scoring_weight_overrides" "jsonb",
    CONSTRAINT "allocator_preferences_liquidity_preference_check" CHECK ((("liquidity_preference" IS NULL) OR ("liquidity_preference" = ANY (ARRAY['high'::"text", 'medium'::"text", 'low'::"text"])))),
    CONSTRAINT "allocator_preferences_scoring_weight_overrides_shape" CHECK ("public"."_scoring_weight_overrides_is_valid"("scoring_weight_overrides"))
);


ALTER TABLE "public"."allocator_preferences" OWNER TO "postgres";


COMMENT ON COLUMN "public"."allocator_preferences"."max_weight" IS 'Largest share of portfolio any single strategy can hold. Fraction 0-1 (0.25 = 25%). NULL = no constraint. Bounds enforced at app layer (0.05-0.50 per D-17) + RPC guard. Phase 2 / MANDATE-01.';



COMMENT ON COLUMN "public"."allocator_preferences"."correlation_ceiling" IS 'Max pairwise correlation across allocations. 0-1 (0.6 default UI hint; column NULL = no constraint). Phase 2 / MANDATE-03.';



COMMENT ON COLUMN "public"."allocator_preferences"."liquidity_preference" IS 'Minimum strategy AUM tier: high (>$10M), medium ($1M-$10M), low (<$1M). NULL = no constraint. Phase 3 compute_mandate_fit_score() owns the AUM threshold mapping. Phase 2 / MANDATE-03.';



COMMENT ON COLUMN "public"."allocator_preferences"."style_exclusions" IS 'Sub-strategies to filter out at scoring time. TEXT[] of SUBTYPES values from src/lib/constants.ts. NULL = no filter. Phase 2 / MANDATE-03.';



COMMENT ON COLUMN "public"."allocator_preferences"."mandate_edited_at" IS 'Last allocator-initiated mandate write (RPC). Separate from updated_at so admin edits do not bump the allocator-facing "Last saved" UI. Phase 2 / MANDATE-04.';



COMMENT ON COLUMN "public"."allocator_preferences"."scoring_weight_overrides" IS 'Multiplicative per-dimension scoring weight scales. Shape: {"W_PORTFOLIO_FIT": 1.3, ...}. NULL = no override (v1 behavior). Written by Phase 4 feedback_engine; read by Phase 3 match_engine. App-layer clamps to [0.5, 1.5] + renormalizes (D-08). Phase 3 / SCORING-06.';



COMMENT ON CONSTRAINT "allocator_preferences_scoring_weight_overrides_shape" ON "public"."allocator_preferences" IS 'audit-2026-05-07 H-0939 + Phase C red-team #1. JSONB shape gate for scoring_weight_overrides: object-typed, keys ∈ {W_PORTFOLIO_FIT, W_PREFERENCE_FIT, W_TRACK_RECORD, W_CAPACITY_FIT} (matching feedback_engine.py:60-63 ALL_DIMENSIONS and match_engine.py:59-62 weight constants), values numeric ∈ [0.5, 1.5] (matching match_engine.py:773-779 _clamp range). Coordinate this CHECK with any future weight-slot addition in feedback_engine.py.';



CREATE TABLE IF NOT EXISTS "public"."api_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "exchange" "text" NOT NULL,
    "label" "text" NOT NULL,
    "api_key_encrypted" "text" NOT NULL,
    "api_secret_encrypted" "text",
    "passphrase_encrypted" "text",
    "dek_encrypted" "text",
    "nonce" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "last_sync_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "kek_version" integer DEFAULT 1 NOT NULL,
    "account_balance_usdt" numeric,
    "sync_status" "text" DEFAULT 'idle'::"text",
    "sync_started_at" timestamp with time zone,
    "sync_error" "text",
    "last_429_at" timestamp with time zone,
    "last_fetched_trade_timestamp" timestamp with time zone,
    "disconnected_at" timestamp with time zone,
    CONSTRAINT "api_keys_exchange_check" CHECK (("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text"]))),
    CONSTRAINT "api_keys_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['idle'::"text", 'syncing'::"text", 'computing'::"text", 'complete'::"text", 'complete_with_warnings'::"text", 'error'::"text", 'revoked'::"text", 'rate_limited'::"text"])))
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


COMMENT ON COLUMN "public"."api_keys"."api_key_encrypted" IS 'Encrypted credential payload (Fernet ciphertext). Table-level SELECT revoked from anon/authenticated per migration 027. Access via service-role client only.';



COMMENT ON COLUMN "public"."api_keys"."api_secret_encrypted" IS 'Encrypted. Revoked per migration 027. Currently NULL for all rows (payload bundled into api_key_encrypted).';



COMMENT ON COLUMN "public"."api_keys"."passphrase_encrypted" IS 'Encrypted. Revoked per migration 027. Currently NULL for all rows.';



COMMENT ON COLUMN "public"."api_keys"."dek_encrypted" IS 'KEK-wrapped per-row DEK (Fernet). Revoked per migration 027. Service-role only.';



COMMENT ON COLUMN "public"."api_keys"."nonce" IS 'Legacy wrapper metadata. Revoked per migration 027. Currently NULL (Fernet handles nonce internally).';



COMMENT ON COLUMN "public"."api_keys"."last_429_at" IS 'Timestamp of the most recent 429 (rate limit) response from the exchange for this key. Populated by update_api_key_rate_limit(). Read by the Python job runner to skip retries within the per-exchange cooldown window. See migration 032.';



COMMENT ON COLUMN "public"."api_keys"."last_fetched_trade_timestamp" IS 'Partial-success checkpoint for sync_trades: stamped immediately after raw fills are durably upserted (Phase 2), distinct from last_sync_at which represents full-pipeline success. NULL = never checkpointed (callers fall back to last_sync_at). Prefer this over last_sync_at when resuming since_ms. See migration 045.';



COMMENT ON COLUMN "public"."api_keys"."disconnected_at" IS 'Migration 075: when set, key is soft-disconnected — worker crons skip it and the UI renders a Reconnect affordance. NULL = active. allocator_holdings keep their FK reference for audit continuity.';



CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


COMMENT ON COLUMN "public"."audit_log"."user_id" IS 'Subject of the audit event. Nullable since migration 123 — the audit_log_user_id_fkey FK uses ON DELETE SET NULL so audit rows survive auth.users hard-delete with the subject attribution preserved as NULL. See migrations 010 + 123.';



CREATE TABLE IF NOT EXISTS "public"."audit_log_cold" (
    "id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "metadata" "jsonb",
    "created_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."audit_log_cold" OWNER TO "postgres";


COMMENT ON TABLE "public"."audit_log_cold" IS 'Cold archive of audit_log rows older than 2y. Rows land here via the audit_log_hot_to_cold cron and are deleted at 7y by audit_log_cold_purge. Same append-only invariants as audit_log — see migration 056.';



CREATE TABLE IF NOT EXISTS "public"."benchmark_prices" (
    "date" "date" NOT NULL,
    "symbol" "text" NOT NULL,
    "close_price" numeric NOT NULL
);


ALTER TABLE "public"."benchmark_prices" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."bridge_outcome_dismissals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "dismissed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    CONSTRAINT "bridge_outcome_dismissals_ttl_valid" CHECK (("expires_at" > "dismissed_at"))
);


ALTER TABLE "public"."bridge_outcome_dismissals" OWNER TO "postgres";


COMMENT ON TABLE "public"."bridge_outcome_dismissals" IS 'Server-side TTL dismissals for the Bridge outcome banner. One row per (allocator_id, strategy_id) — unique index enforces this (D-18). expires_at = dismissed_at + 24h (D-07). Banner eligibility query uses WHERE expires_at > now() to skip active dismissals; no purge cron needed.';



COMMENT ON COLUMN "public"."bridge_outcome_dismissals"."strategy_id" IS 'Dedupe key per D-18: one dismissal per (allocator, strategy). FK to strategies(id), not match_candidate_id.';



COMMENT ON COLUMN "public"."bridge_outcome_dismissals"."expires_at" IS '24h TTL from dismissed_at (D-07). Banner query filter: WHERE expires_at > now().';



CREATE TABLE IF NOT EXISTS "public"."bridge_outcomes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "strategy_id" "uuid",
    "match_decision_id" "uuid",
    "kind" "text" NOT NULL,
    "percent_allocated" numeric(5,2),
    "allocated_at" "date",
    "rejection_reason" "text",
    "note" "text",
    "delta_30d" numeric,
    "delta_90d" numeric,
    "delta_180d" numeric,
    "estimated_delta_bps" numeric,
    "estimated_days" integer,
    "deltas_computed_at" timestamp with time zone,
    "needs_recompute" boolean DEFAULT true NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "original_holding_ref" "text",
    CONSTRAINT "bridge_outcomes_allocated_at_check" CHECK ((("allocated_at" IS NULL) OR (("allocated_at" <= CURRENT_DATE) AND ("allocated_at" >= (CURRENT_DATE - '365 days'::interval))))),
    CONSTRAINT "bridge_outcomes_estimated_days_check" CHECK ((("estimated_days" IS NULL) OR (("estimated_days" >= 0) AND ("estimated_days" <= 180)))),
    CONSTRAINT "bridge_outcomes_kind_allocated" CHECK ((("kind" <> 'allocated'::"text") OR (("percent_allocated" IS NOT NULL) AND ("allocated_at" IS NOT NULL) AND ("rejection_reason" IS NULL) AND (("strategy_id" IS NOT NULL) OR ("match_decision_id" IS NOT NULL))))),
    CONSTRAINT "bridge_outcomes_kind_check" CHECK (("kind" = ANY (ARRAY['allocated'::"text", 'rejected'::"text"]))),
    CONSTRAINT "bridge_outcomes_kind_rejected" CHECK ((("kind" <> 'rejected'::"text") OR (("rejection_reason" IS NOT NULL) AND ("percent_allocated" IS NULL) AND ("allocated_at" IS NULL) AND (("strategy_id" IS NOT NULL) OR ("match_decision_id" IS NOT NULL))))),
    CONSTRAINT "bridge_outcomes_note_check" CHECK ((("note" IS NULL) OR ("char_length"("note") <= 2000))),
    CONSTRAINT "bridge_outcomes_percent_allocated_check" CHECK ((("percent_allocated" IS NULL) OR (("percent_allocated" >= 0.1) AND ("percent_allocated" <= (50)::numeric)))),
    CONSTRAINT "bridge_outcomes_percent_allocated_range_check" CHECK ((("percent_allocated" IS NULL) OR (("percent_allocated" >= (0)::numeric) AND ("percent_allocated" <= (100)::numeric)))),
    CONSTRAINT "bridge_outcomes_rejection_reason_check" CHECK ((("rejection_reason" IS NULL) OR ("rejection_reason" = ANY (ARRAY['mandate_conflict'::"text", 'already_owned'::"text", 'timing_wrong'::"text", 'underperforming_peers'::"text", 'other'::"text"]))))
);


ALTER TABLE "public"."bridge_outcomes" OWNER TO "postgres";


COMMENT ON TABLE "public"."bridge_outcomes" IS 'Allocator self-reported post-intro outcome for a Bridge-recommended strategy. One row per (allocator_id, strategy_id) enforced by unique index. Outcomes are editable by owner (D-17) and append-only from an audit perspective (no DELETE policy — corrective edits via UPSERT). Scope: D-08 through D-19, OUTCOME-01 through OUTCOME-08.';



COMMENT ON COLUMN "public"."bridge_outcomes"."allocator_id" IS 'UUID matching profiles.id — the allocator who recorded this outcome. Never auth.users directly (migration 011 convention).';



COMMENT ON COLUMN "public"."bridge_outcomes"."strategy_id" IS 'FK to strategies(id). Phase 10: NULL-able (was NOT NULL pre-migration 081). NULL only for voluntary_remove rows (allocator toggled holding off, no strategy replacement). Strategy-sourced + voluntary_add rows retain a non-NULL strategy_id. See match_decisions.kind for the discriminator and bridge_outcomes_kind_allocated / bridge_outcomes_kind_rejected for the per-kind CHECK invariants.';



COMMENT ON COLUMN "public"."bridge_outcomes"."match_decision_id" IS 'Nullable FK to match_decisions(id) (sent_as_intro row). ON DELETE SET NULL so deleting the intro record does not cascade-delete the outcome (A6).';



COMMENT ON COLUMN "public"."bridge_outcomes"."kind" IS 'Discriminator: ''allocated'' or ''rejected''. Controls which other fields are required per bridge_outcomes_kind_fields_valid CHECK (D-08).';



COMMENT ON COLUMN "public"."bridge_outcomes"."percent_allocated" IS 'Required when kind=''allocated''. Percentage of portfolio allocated to this strategy (0.1–50%, D-09). NULL when kind=''rejected''.';



COMMENT ON COLUMN "public"."bridge_outcomes"."allocated_at" IS 'Required when kind=''allocated''. DATE (not TIMESTAMPTZ) to match returns_series[].date text keys and avoid timezone drift in delta math (RESEARCH Pitfall 2, D-09).';



COMMENT ON COLUMN "public"."bridge_outcomes"."rejection_reason" IS 'Required when kind=''rejected''. Structured enum via TEXT CHECK for Phase 4 feedback engine attribution (D-10).';



COMMENT ON COLUMN "public"."bridge_outcomes"."note" IS 'Optional allocator note. Max 2000 chars matching intro.message convention. Visible to admin via admin-read policy.';



COMMENT ON COLUMN "public"."bridge_outcomes"."delta_30d" IS 'Realized 30-day performance delta vs allocated_at equity. NULL until cron computes (D-12, OUTCOME-06).';



COMMENT ON COLUMN "public"."bridge_outcomes"."delta_90d" IS 'Realized 90-day performance delta. NULL until cron computes.';



COMMENT ON COLUMN "public"."bridge_outcomes"."delta_180d" IS 'Realized 180-day performance delta. NULL until cron computes.';



COMMENT ON COLUMN "public"."bridge_outcomes"."estimated_delta_bps" IS 'Estimated partial-window delta in basis points for the D-12 "Estimated: +X.X% (Nd)" label. NULL until cron computes.';



COMMENT ON COLUMN "public"."bridge_outcomes"."estimated_days" IS 'Number of days of returns data available since allocated_at (0–180). Determines label tier in D-12 progression.';



COMMENT ON COLUMN "public"."bridge_outcomes"."deltas_computed_at" IS 'Timestamp when compute_bridge_outcome_deltas() last successfully wrote deltas for this row.';



COMMENT ON COLUMN "public"."bridge_outcomes"."needs_recompute" IS 'Flag set TRUE on INSERT and on UPDATE when allocated_at, percent_allocated, or kind changes (D-16/D-17). Cron guard: WHERE delta_30d IS NULL OR needs_recompute = TRUE (D-15, OUTCOME-07). Cron resets to FALSE after successful per-row compute.';



COMMENT ON COLUMN "public"."bridge_outcomes"."original_holding_ref" IS 'Phase 09 / finding f4. Denormalized mirror of match_decisions.original_holding_ref populated by bridge_outcomes_sync_holding_ref_trigger on INSERT/UPDATE OF match_decision_id. Enables the widened bridge_outcomes_unique_per_strategy_holding index. NULL for strategy-sourced rows (original_strategy_id path). NULL when match_decision_id IS NULL (legacy rows without a linked decision).';



COMMENT ON CONSTRAINT "bridge_outcomes_percent_allocated_range_check" ON "public"."bridge_outcomes" IS 'Migration 128 / audit-2026-05-07 round 2 (P1956). Defense-in-depth range check on percent_allocated. The canonical write site is commit_scenario_batch, which encodes the value once (no dual COALESCE) after this migration. NULL permitted because kind=''rejected'' rows have NULL percent_allocated per migration 081.';



CREATE TABLE IF NOT EXISTS "public"."compute_job_kinds" (
    "name" "text" NOT NULL
);

ALTER TABLE ONLY "public"."compute_job_kinds" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."compute_job_kinds" OWNER TO "postgres";


COMMENT ON TABLE "public"."compute_job_kinds" IS 'Registry of valid compute_jobs.kind values. Referenced by compute_jobs.kind via FK. Add new kinds via INSERT; no ALTER TABLE needed. See migration 032.';



CREATE TABLE IF NOT EXISTS "public"."portfolios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_test" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."portfolios" OWNER TO "postgres";


COMMENT ON COLUMN "public"."portfolios"."is_test" IS 'Kept for future use. v0.4.0 pivoted away from a Test Portfolios surface (Scenarios replaces what-if exploration), but the partial unique index portfolios_one_real_per_user is still valuable: it enforces at most one real portfolio per user_id at the DB level, which is the My Allocation invariant.';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "display_name" "text" NOT NULL,
    "company" "text",
    "description" "text",
    "email" "text",
    "telegram" "text",
    "website" "text",
    "linkedin" "text",
    "avatar_url" "text",
    "role" "text" DEFAULT 'manager'::"text" NOT NULL,
    "manager_status" "text" DEFAULT 'newbie'::"text" NOT NULL,
    "allocator_status" "text" DEFAULT 'newbie'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_admin" boolean DEFAULT false NOT NULL,
    "preferences_updated_at" timestamp with time zone,
    "bio" "text",
    "years_trading" integer,
    "aum_range" "text",
    "tenant_id" "uuid",
    "partner_tag" "text",
    CONSTRAINT "profiles_allocator_status_check" CHECK (("allocator_status" = ANY (ARRAY['newbie'::"text", 'pending'::"text", 'verified'::"text"]))),
    CONSTRAINT "profiles_manager_status_check" CHECK (("manager_status" = ANY (ARRAY['newbie'::"text", 'pending'::"text", 'verified'::"text"]))),
    CONSTRAINT "profiles_partner_tag_format_check" CHECK ((("partner_tag" IS NULL) OR ("partner_tag" ~ '^[a-z0-9-]+$'::"text"))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['manager'::"text", 'allocator'::"text", 'both'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


COMMENT ON COLUMN "public"."profiles"."email" IS 'PII. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';



COMMENT ON COLUMN "public"."profiles"."telegram" IS 'PII. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';



COMMENT ON COLUMN "public"."profiles"."linkedin" IS 'PII. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';



COMMENT ON COLUMN "public"."profiles"."bio" IS 'Sensitive. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';



COMMENT ON COLUMN "public"."profiles"."years_trading" IS 'Sensitive. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';



COMMENT ON COLUMN "public"."profiles"."aum_range" IS 'Sensitive. Table-level SELECT revoked from anon/authenticated per migration 020. Access via createAdminClient() only.';



COMMENT ON COLUMN "public"."profiles"."partner_tag" IS 'Optional tag scoping this profile to a partner pilot. NULL = native Quantalyze user. Set by /api/admin/partner-import.';



COMMENT ON CONSTRAINT "profiles_partner_tag_format_check" ON "public"."profiles" IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';



CREATE TABLE IF NOT EXISTS "public"."strategies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "api_key_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "strategy_types" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "subtypes" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "markets" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "supported_exchanges" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "leverage_range" "text",
    "avg_daily_turnover" numeric,
    "aum" numeric,
    "max_capacity" numeric,
    "start_date" "date",
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_example" boolean DEFAULT false NOT NULL,
    "benchmark" "text" DEFAULT 'BTC'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "review_note" "text",
    "organization_id" "uuid",
    "disclosure_tier" "text" DEFAULT 'exploratory'::"text" NOT NULL,
    "public_contact_email" "text",
    "tenant_id" "uuid",
    "codename" "text",
    "partner_tag" "text",
    "source" "text" DEFAULT 'legacy'::"text" NOT NULL,
    "fingerprint" "jsonb",
    CONSTRAINT "strategies_disclosure_tier_check" CHECK (("disclosure_tier" = ANY (ARRAY['institutional'::"text", 'exploratory'::"text"]))),
    CONSTRAINT "strategies_fingerprint_version_check" CHECK ((("fingerprint" IS NULL) OR ((("fingerprint" ->> 'version'::"text") IS NOT NULL) AND ((("fingerprint" ->> 'version'::"text"))::integer = 1)))),
    CONSTRAINT "strategies_partner_tag_format_check" CHECK ((("partner_tag" IS NULL) OR ("partner_tag" ~ '^[a-z0-9-]+$'::"text"))),
    CONSTRAINT "strategies_source_check" CHECK (("source" = ANY (ARRAY['legacy'::"text", 'wizard'::"text", 'admin_import'::"text", 'allocator_connected'::"text", 'csv'::"text", 'okx'::"text", 'binance'::"text", 'bybit'::"text"]))),
    CONSTRAINT "strategies_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."strategies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."strategies"."disclosure_tier" IS 'institutional = real name/bio/LinkedIn visible; exploratory = codename only. Discovery + match queue filter by tier.';



COMMENT ON COLUMN "public"."strategies"."public_contact_email" IS 'Optional relay address for inbound messages. Falls back to profiles.email via join when null.';



COMMENT ON COLUMN "public"."strategies"."codename" IS 'Pseudonym shown in place of name when disclosure_tier = exploratory. NULL for institutional.';



COMMENT ON COLUMN "public"."strategies"."partner_tag" IS 'Optional tag scoping this strategy to a partner pilot.';



COMMENT ON COLUMN "public"."strategies"."source" IS 'Origin of the strategies row. ''legacy'' = original StrategyForm / CSV flow, ''wizard'' = Task 1.2 onboarding wizard, ''admin_import'' = partner CSV import. Used to discriminate draft lifetimes: wizard drafts auto-expire after 24h, legacy/admin drafts persist. See migration 031.';



COMMENT ON COLUMN "public"."strategies"."fingerprint" IS 'Phase 19 / FINGERPRINT-01. v0 placeholder; pgvector explicitly deferred to v2 per UC-C.';



COMMENT ON CONSTRAINT "strategies_partner_tag_format_check" ON "public"."strategies" IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';



COMMENT ON CONSTRAINT "strategies_source_check" ON "public"."strategies" IS 'Phase 18 / FIX-03 (2026-05-06): admits ''csv'' so Phase 15 finalize_csv_strategy RPC (migration 093) succeeds. Also pre-admits {okx,binance,bybit} for Phase 19 BACKBONE-04 forward-compat. Original constraint only admitted {legacy,wizard,admin_import,allocator_connected}.';



CREATE OR REPLACE VIEW "public"."compute_jobs_admin" WITH ("security_invoker"='true') AS
 SELECT "cj"."id",
    "cj"."strategy_id",
    "cj"."portfolio_id",
    "cj"."kind",
    "cj"."status",
    "cj"."attempts",
    "cj"."max_attempts",
    "cj"."next_attempt_at",
    "cj"."claimed_at",
    "cj"."claimed_by",
    "cj"."last_error",
    "cj"."error_kind",
    "cj"."idempotency_key",
    "cj"."exchange",
    "cj"."trade_count",
    "cj"."created_at",
    "cj"."updated_at",
    "cj"."metadata",
    "s"."name" AS "strategy_name",
    "s"."user_id" AS "strategy_user_id",
    "p"."name" AS "portfolio_name",
    "p"."user_id" AS "portfolio_user_id",
    COALESCE("sp"."email", "pp"."email") AS "user_email"
   FROM (((("public"."compute_jobs" "cj"
     LEFT JOIN "public"."strategies" "s" ON (("s"."id" = "cj"."strategy_id")))
     LEFT JOIN "public"."portfolios" "p" ON (("p"."id" = "cj"."portfolio_id")))
     LEFT JOIN "public"."profiles" "sp" ON (("sp"."id" = "s"."user_id")))
     LEFT JOIN "public"."profiles" "pp" ON (("pp"."id" = "p"."user_id")));


ALTER VIEW "public"."compute_jobs_admin" OWNER TO "postgres";


COMMENT ON VIEW "public"."compute_jobs_admin" IS 'Admin-only join view over compute_jobs. Exposes un-redacted last_error. Accessed via get_admin_compute_jobs RPC which enforces the is_admin gate. See migration 033.';



CREATE TABLE IF NOT EXISTS "public"."contact_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "message" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    "admin_note" "text",
    "founder_notes" "text",
    "allocation_amount" numeric,
    "tenant_id" "uuid",
    "partner_tag" "text",
    "mandate_context" "jsonb",
    "portfolio_snapshot" "jsonb",
    "source" "text" DEFAULT 'direct'::"text" NOT NULL,
    "replacement_for" "uuid",
    "snapshot_status" "text" DEFAULT 'ready'::"text" NOT NULL,
    CONSTRAINT "contact_requests_partner_tag_format_check" CHECK ((("partner_tag" IS NULL) OR ("partner_tag" ~ '^[a-z0-9-]+$'::"text"))),
    CONSTRAINT "contact_requests_snapshot_status_check" CHECK (("snapshot_status" = ANY (ARRAY['pending'::"text", 'ready'::"text", 'failed'::"text"]))),
    CONSTRAINT "contact_requests_source_check" CHECK (("source" = ANY (ARRAY['direct'::"text", 'bridge'::"text"]))),
    CONSTRAINT "contact_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'intro_made'::"text", 'completed'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."contact_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."contact_requests"."partner_tag" IS 'Optional tag scoping this contact request to a partner pilot.';



COMMENT ON COLUMN "public"."contact_requests"."mandate_context" IS 'Optional allocator-supplied mandate hints: {freeform, preferred_asset_class, preferred_exchange[], aum_range}. Validated by Zod at the /api/intro route. See migration 048.';



COMMENT ON COLUMN "public"."contact_requests"."portfolio_snapshot" IS 'Snapshot of the allocator portfolio at intro time: {sharpe, max_drawdown, concentration, top_3_strategies, bottom_3_strategies, alerts_last_7d}. Computed inline by /api/intro (<2s budget) or asynchronously via compute_intro_snapshot job (snapshot_status=pending). See migration 048.';



COMMENT ON COLUMN "public"."contact_requests"."source" IS 'Origin of the intro request: direct (strategy page / RequestIntroButton) or bridge (Bridge replacement panel / ReplacementCard). See migration 048.';



COMMENT ON COLUMN "public"."contact_requests"."replacement_for" IS 'When source=bridge, the strategy_id this intro was proposed as a replacement for. Helps managers see the broader rebalance context. Nullable FK; ON DELETE SET NULL so retired strategies dont orphan intro history. See migration 048.';



COMMENT ON COLUMN "public"."contact_requests"."snapshot_status" IS 'Lifecycle of portfolio_snapshot: pending (worker job enqueued), ready (column populated), failed (permanent compute error). Reflects the 2s synchronous budget + async fallback pattern of /api/intro. See migration 048.';



COMMENT ON CONSTRAINT "contact_requests_partner_tag_format_check" ON "public"."contact_requests" IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';



CREATE TABLE IF NOT EXISTS "public"."cron_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "cron_name" "text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "error" "text",
    "metadata" "jsonb",
    CONSTRAINT "cron_runs_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'ok'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."cron_runs" OWNER TO "postgres";


COMMENT ON TABLE "public"."cron_runs" IS 'Heartbeat rows written by cron jobs at start + completion. Monitored by latest_cron_success() for the 36h stale alert.';



CREATE TABLE IF NOT EXISTS "public"."csv_daily_returns" (
    "strategy_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "daily_return" double precision NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."csv_daily_returns" OWNER TO "postgres";


COMMENT ON TABLE "public"."csv_daily_returns" IS 'Persisted daily-return series for CSV-uploaded strategies. Decimal fraction returns (e.g. 0.0055 for +0.55%). Populated by persist_csv_daily_returns definer-rights RPC at csv-finalize time. Worker handler compute_analytics_from_csv reads this table to feed compute_all_metrics(). PRIMARY KEY (strategy_id, date) — implicit B-tree serves both worker SELECT and ON CONFLICT upsert; no redundant explicit index per PR #272.';



CREATE TABLE IF NOT EXISTS "public"."data_deletion_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completed_at" timestamp with time zone,
    "notes" "text",
    "rejected_at" timestamp with time zone,
    "rejection_reason" "text"
);


ALTER TABLE "public"."data_deletion_requests" OWNER TO "postgres";


COMMENT ON COLUMN "public"."data_deletion_requests"."user_id" IS 'Nullable after migration 124 (audit-2026-05-07 P455). Becomes NULL when the referenced auth.users row is deleted (via sanitize_user or auth admin delete). The rest of the DSR row persists for manager-side audit.';



COMMENT ON COLUMN "public"."data_deletion_requests"."rejected_at" IS 'Set by an admin-reject event (Task 7.3). Mutually exclusive with completed_at at the application layer; both NULL means "pending".';



COMMENT ON COLUMN "public"."data_deletion_requests"."rejection_reason" IS 'Optional admin rationale shown in the requester''s audit trail. Free-form TEXT.';



CREATE TABLE IF NOT EXISTS "public"."deck_strategies" (
    "deck_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."deck_strategies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."decks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "slug" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."decks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."discovery_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "icon" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "access_level" "text" DEFAULT 'public'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "discovery_categories_access_level_check" CHECK (("access_level" = ANY (ARRAY['public'::"text", 'qualified_only'::"text"])))
);


ALTER TABLE "public"."discovery_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."feature_flags" (
    "flag_key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "text",
    CONSTRAINT "feature_flags_value_check" CHECK (("value" = ANY (ARRAY['on'::"text", 'off'::"text"])))
);


ALTER TABLE "public"."feature_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."for_quants_leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "firm" "text" NOT NULL,
    "email" "text" NOT NULL,
    "preferred_time" "text",
    "notes" "text",
    "source_ip" "inet",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "processed_by" "uuid",
    "wizard_context" "jsonb",
    "notify_attempted_at" timestamp with time zone,
    "notify_succeeded_at" timestamp with time zone,
    "notify_error" "text"
);


ALTER TABLE "public"."for_quants_leads" OWNER TO "postgres";


COMMENT ON TABLE "public"."for_quants_leads" IS 'Public /for-quants Request-a-Call leads. Service-role only. See migration 030.';



COMMENT ON COLUMN "public"."for_quants_leads"."source_ip" IS 'Captured from x-forwarded-for by /api/for-quants-lead for rate-limit diagnostics.';



COMMENT ON COLUMN "public"."for_quants_leads"."user_agent" IS 'Captured from user-agent header for bot filtering.';



COMMENT ON COLUMN "public"."for_quants_leads"."wizard_context" IS 'Optional wizard context blob: {strategy_id, step}. NULL for landing-page leads. See migration 031.';



COMMENT ON COLUMN "public"."for_quants_leads"."notify_attempted_at" IS 'Timestamp when /api/for-quants-lead after() began the founder-notify path. NULL pre-attempt or for legacy rows. audit-2026-05-07 G9.B.7.';



COMMENT ON COLUMN "public"."for_quants_leads"."notify_succeeded_at" IS 'Timestamp when notifyFounderGeneric returned without throwing.';



COMMENT ON COLUMN "public"."for_quants_leads"."notify_error" IS 'Sanitized error message (max 500 chars) when notifyFounderGeneric threw OR ADMIN_EMAIL was unset. NULL on clean sends.';



CREATE TABLE IF NOT EXISTS "public"."funding_fees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "exchange" "text" NOT NULL,
    "symbol" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "currency" "text" NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    "match_key" "text" NOT NULL,
    "raw_data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."funding_fees" OWNER TO "postgres";


COMMENT ON TABLE "public"."funding_fees" IS 'Perpetual-futures funding payments, one row per 8-hour funding window per (strategy, exchange, symbol). Signed amount: positive = received, negative = paid. Populated by the sync_funding worker kind + scripts/backfill_funding.py. See migration 044.';



COMMENT ON COLUMN "public"."funding_fees"."amount" IS 'Signed funding amount in `currency` units. Positive = strategy received funding (short perp in contango, long perp in backwardation). Negative = strategy paid.';



COMMENT ON COLUMN "public"."funding_fees"."match_key" IS 'Deterministic dedup key: strategy_id:exchange:symbol:8h-bucket(timestamp). UNIQUE so re-running the backfill on the same window is idempotent. Addresses Bybit fill_id rotation.';



COMMENT ON COLUMN "public"."funding_fees"."raw_data" IS 'Original exchange response row, preserved for audit and debugging.';



CREATE TABLE IF NOT EXISTS "public"."investor_attestations" (
    "user_id" "uuid" NOT NULL,
    "attested_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "version" "text" NOT NULL,
    "ip_address" "text"
);


ALTER TABLE "public"."investor_attestations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."key_permission_audit" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "api_key_id" "uuid" NOT NULL,
    "caller_ip" "text",
    "requested_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."key_permission_audit" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_batches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "mode" "text" NOT NULL,
    "filter_relaxed" boolean DEFAULT false NOT NULL,
    "candidate_count" integer DEFAULT 0 NOT NULL,
    "excluded_count" integer DEFAULT 0 NOT NULL,
    "engine_version" "text" NOT NULL,
    "weights_version" "text" NOT NULL,
    "effective_preferences" "jsonb" NOT NULL,
    "effective_thresholds" "jsonb" NOT NULL,
    "source_strategy_count" integer NOT NULL,
    "latency_ms" integer,
    "tenant_id" "uuid",
    "partner_tag" "text",
    "holding_flags" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    CONSTRAINT "match_batches_mode_check" CHECK (("mode" = ANY (ARRAY['personalized'::"text", 'screening'::"text"]))),
    CONSTRAINT "match_batches_partner_tag_format_check" CHECK ((("partner_tag" IS NULL) OR ("partner_tag" ~ '^[a-z0-9-]+$'::"text")))
);


ALTER TABLE "public"."match_batches" OWNER TO "postgres";


COMMENT ON COLUMN "public"."match_batches"."partner_tag" IS 'Optional tag scoping this match batch to a partner pilot.';



COMMENT ON COLUMN "public"."match_batches"."holding_flags" IS 'Phase 09 / finding f5. Per-holding flag rows written by _load_allocator_context in Plan 09-02 and read by getMyAllocationDashboard in Plan 09-03. Each array entry: { holding_ref, value_usd, weight, breach_reasons[], top_candidate_strategy_id, top_candidate_composite, flagged }. Empty array when allocator has no holdings or no mandate breaches.';



COMMENT ON CONSTRAINT "match_batches_partner_tag_format_check" ON "public"."match_batches" IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';



CREATE TABLE IF NOT EXISTS "public"."match_candidates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "batch_id" "uuid" NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "score" numeric NOT NULL,
    "score_breakdown" "jsonb" NOT NULL,
    "reasons" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "rank" integer,
    "exclusion_reason" "text",
    "exclusion_provenance" "text",
    CONSTRAINT "match_candidates_check" CHECK (((("rank" IS NOT NULL) AND ("exclusion_reason" IS NULL)) OR (("rank" IS NULL) AND ("exclusion_reason" IS NOT NULL)))),
    CONSTRAINT "match_candidates_exclusion_reason_check" CHECK (("exclusion_reason" = ANY (ARRAY['below_min_sharpe'::"text", 'below_min_track_record'::"text", 'excluded_exchange'::"text", 'exceeds_max_dd'::"text", 'off_mandate_type'::"text", 'owned'::"text", 'thumbs_down'::"text"])))
);


ALTER TABLE "public"."match_candidates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."match_decisions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "strategy_id" "uuid",
    "candidate_id" "uuid",
    "decision" "text" NOT NULL,
    "founder_note" "text",
    "contact_request_id" "uuid",
    "decided_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "original_strategy_id" "uuid",
    "original_holding_ref" "text",
    "kind" "public"."match_decision_kind" NOT NULL,
    CONSTRAINT "match_decisions_decision_check" CHECK (("decision" = ANY (ARRAY['thumbs_up'::"text", 'thumbs_down'::"text", 'sent_as_intro'::"text", 'snoozed'::"text"]))),
    CONSTRAINT "match_decisions_kind_bridge_recommended_v2" CHECK ((("kind" <> 'bridge_recommended'::"public"."match_decision_kind") OR (("strategy_id" IS NOT NULL) AND (("original_strategy_id" IS NOT NULL) <> ("original_holding_ref" IS NOT NULL))))),
    CONSTRAINT "match_decisions_kind_voluntary_add" CHECK ((("kind" <> 'voluntary_add'::"public"."match_decision_kind") OR (("strategy_id" IS NOT NULL) AND ("original_holding_ref" IS NULL) AND ("original_strategy_id" IS NULL)))),
    CONSTRAINT "match_decisions_kind_voluntary_modify_v2" CHECK ((("kind" <> 'voluntary_modify'::"public"."match_decision_kind") OR (("original_holding_ref" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("original_strategy_id" IS NULL)))),
    CONSTRAINT "match_decisions_kind_voluntary_remove" CHECK ((("kind" <> 'voluntary_remove'::"public"."match_decision_kind") OR (("original_holding_ref" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("original_strategy_id" IS NULL))))
);


ALTER TABLE "public"."match_decisions" OWNER TO "postgres";


COMMENT ON COLUMN "public"."match_decisions"."original_strategy_id" IS 'FK to strategies(id) naming the underperformer that this decision''s strategy_id (replacement) was introduced for. Ships as NULL-allowed in migration 064 (Voice-C3); tightened to NOT NULL in migration 065 after admin UI has shipped values. FK uses ON DELETE RESTRICT (Voice-D3, migration 059 A6 precedent). Captured at intro-send time via send_intro_with_decision RPC. See .planning/phases/05-outcomes-dashboard/05-CONTEXT.md D-20a (revised).';



COMMENT ON COLUMN "public"."match_decisions"."original_holding_ref" IS 'Phase 09 / D-13. scope_ref = "holding:{venue}:{symbol}:{holding_type}" for holdings-sourced Bridge decisions. Mutually exclusive with original_strategy_id via match_decisions_original_xor CHECK. No FK — scope_ref is text by design (Phase 08 D-08). See .planning/phases/09-bridge-live-against-real-holdings/09-CONTEXT.md §D-13.';



COMMENT ON COLUMN "public"."match_decisions"."kind" IS 'Phase 10 / SCENARIO-07 (D-10/D-11/D-17). Discriminator gating per-kind CHECK constraints. bridge_recommended: pre-Phase-10 + Bridge-recommended path (strategy_id NOT NULL AND one of original_* NOT NULL — strategy_id is the suggested/recommended strategy in the live schema; the plan refers to it as suggested_strategy_id). voluntary_remove: allocator-toggled-off holding (original_holding_ref NOT NULL, both strategy fields NULL). voluntary_add: browse-added strategy with no original holding (strategy_id NOT NULL, both original_* NULL). voluntary_modify: weight-change-only on existing holding (original_holding_ref NOT NULL, strategy_id NULL). Pre-Phase-10 rows backfilled to bridge_recommended in migration 080 STEP 4.';



COMMENT ON CONSTRAINT "match_decisions_kind_bridge_recommended_v2" ON "public"."match_decisions" IS 'audit-2026-05-07 H-0956/H-0962. Tightens mig 080 bridge_recommended CHECK from OR to true XOR: bridge_recommended requires strategy_id NOT NULL AND EXACTLY ONE of (original_strategy_id, original_holding_ref) NOT NULL. Closes the cron-coverage gap where both-set rows fell out of every CTE branch in compute_bridge_outcome_deltas(). NOT VALID at install; operator validates after backfilling pre-existing both-set / both-null rows.';



COMMENT ON CONSTRAINT "match_decisions_kind_voluntary_modify_v2" ON "public"."match_decisions" IS 'audit-2026-05-07 H-0957/H-0961/H-0963. Tightens mig 080 voluntary_modify CHECK to require original_strategy_id IS NULL (was deliberately unconstrained). Pure weight-change-on-existing-holding shape only. Closes the silent cron mis-attribution path where voluntary_modify with NULL original_strategy_id was picked up by compute_bridge_outcome_deltas() holding branch. NOT VALID at install; operator validates after backfill.';



CREATE TABLE IF NOT EXISTS "public"."notification_dispatches" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_type" "text" NOT NULL,
    "recipient_email" "text" NOT NULL,
    "subject" "text",
    "status" "text" NOT NULL,
    "error" "text",
    "metadata" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "sent_at" timestamp with time zone,
    CONSTRAINT "notification_dispatches_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'sent'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."notification_dispatches" OWNER TO "postgres";


COMMENT ON TABLE "public"."notification_dispatches" IS 'Audit trail for every notification send attempt. Written by src/lib/email.ts::send(). RLS: admin-read + service_role-all.';



CREATE TABLE IF NOT EXISTS "public"."organization_invites" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "organization_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone,
    CONSTRAINT "organization_invites_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'accepted'::"text", 'declined'::"text"])))
);


ALTER TABLE "public"."organization_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organization_members" (
    "organization_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "organization_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."organization_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organizations"."created_by" IS 'Profile id of the user who created this organization. Nullable since migration 057 — sanitize_user sets this to NULL during GDPR Art. 17 anonymize while preserving the organization row for remaining members.';



CREATE TABLE IF NOT EXISTS "public"."portfolio_alerts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "alert_type" "text" NOT NULL,
    "severity" "text" NOT NULL,
    "message" "text" NOT NULL,
    "metadata" "jsonb",
    "triggered_at" timestamp with time zone DEFAULT "now"(),
    "acknowledged_at" timestamp with time zone,
    "emailed_at" timestamp with time zone,
    "strategy_id" "uuid",
    CONSTRAINT "portfolio_alerts_alert_type_check" CHECK (("alert_type" = ANY (ARRAY['drawdown'::"text", 'correlation_spike'::"text", 'sync_failure'::"text", 'status_change'::"text", 'optimizer_suggestion'::"text", 'regime_shift'::"text", 'underperformance'::"text", 'concentration_creep'::"text", 'rebalance_drift'::"text"]))),
    CONSTRAINT "portfolio_alerts_severity_check" CHECK (("severity" = ANY (ARRAY['critical'::"text", 'high'::"text", 'medium'::"text", 'low'::"text"])))
);


ALTER TABLE "public"."portfolio_alerts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."portfolio_alerts"."strategy_id" IS 'Pinned source strategy for per-strategy alert types (rebalance_drift). NULL for portfolio-wide alerts. See migration 050.';



CREATE TABLE IF NOT EXISTS "public"."portfolio_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"(),
    "computation_status" "text" DEFAULT 'pending'::"text",
    "computation_error" "text",
    "total_aum" numeric,
    "total_return_twr" numeric,
    "total_return_mwr" numeric,
    "portfolio_sharpe" numeric,
    "portfolio_volatility" numeric,
    "portfolio_max_drawdown" numeric,
    "avg_pairwise_correlation" numeric,
    "return_24h" numeric,
    "return_mtd" numeric,
    "return_ytd" numeric,
    "narrative_summary" "text",
    "correlation_matrix" "jsonb",
    "attribution_breakdown" "jsonb",
    "risk_decomposition" "jsonb",
    "benchmark_comparison" "jsonb",
    "optimizer_suggestions" "jsonb",
    "portfolio_equity_curve" "jsonb",
    "rolling_correlation" "jsonb",
    "data_quality" "jsonb",
    CONSTRAINT "portfolio_analytics_computation_status_check" CHECK (("computation_status" = ANY (ARRAY['pending'::"text", 'computing'::"text", 'complete'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."portfolio_analytics" OWNER TO "postgres";


COMMENT ON COLUMN "public"."portfolio_analytics"."data_quality" IS 'Partial-data telemetry: missing strategies, sharpe/vol status codes, benchmark/cov fallbacks. Populated by routers/portfolio.py. See audit-2026-05-07 portfolio.py fix-implementation.';



CREATE TABLE IF NOT EXISTS "public"."portfolio_strategies" (
    "portfolio_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "allocated_amount" numeric,
    "allocated_at" timestamp with time zone DEFAULT "now"(),
    "current_weight" numeric,
    "relationship_status" "text" DEFAULT 'connected'::"text",
    "founder_notes" "jsonb" DEFAULT '[]'::"jsonb",
    "last_founder_contact" timestamp with time zone,
    "tenant_id" "uuid",
    "alias" "text",
    CONSTRAINT "portfolio_strategies_relationship_status_check" CHECK (("relationship_status" = ANY (ARRAY['connected'::"text", 'paused'::"text", 'exited'::"text"])))
);


ALTER TABLE "public"."portfolio_strategies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."portfolio_strategies"."alias" IS 'Allocator-provided display name override for this investment row. NULL means fall back to the strategy''s canonical display name. Scoped per portfolio_strategies row so two allocators can label the same strategy differently.';



CREATE TABLE IF NOT EXISTS "public"."position_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "symbol" "text" NOT NULL,
    "side" "text" NOT NULL,
    "size_base" numeric,
    "size_usd" numeric,
    "entry_price" numeric,
    "mark_price" numeric,
    "unrealized_pnl" numeric,
    "exchange" "text",
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "position_snapshots_exchange_check" CHECK ((("exchange" IS NULL) OR ("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text"])))),
    CONSTRAINT "position_snapshots_side_check" CHECK (("side" = ANY (ARRAY['long'::"text", 'short'::"text", 'flat'::"text"])))
);


ALTER TABLE "public"."position_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."position_snapshots" IS 'Daily position snapshots per strategy. One row per (strategy, symbol, side) per day. Populated forward-going by the worker poll_positions handler. Existing strategies start with empty history; no historical reconstruction. See migration 034.';



COMMENT ON COLUMN "public"."position_snapshots"."side" IS 'long = positive size, short = negative size, flat = zero (usually not stored). Dual-side accounts (OKX hedge mode) produce two rows per symbol per day.';



COMMENT ON COLUMN "public"."position_snapshots"."computed_at" IS 'When the worker wrote the row. Widgets read MAX(computed_at) per strategy to render "updated Xh ago" or "stale" badges.';



CREATE TABLE IF NOT EXISTS "public"."positions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "symbol" "text" NOT NULL,
    "side" "text" NOT NULL,
    "status" "text" NOT NULL,
    "entry_price_avg" numeric NOT NULL,
    "exit_price_avg" numeric,
    "size_base" numeric NOT NULL,
    "size_peak" numeric NOT NULL,
    "realized_pnl" numeric,
    "unrealized_pnl" numeric,
    "fee_total" numeric,
    "fill_count" integer DEFAULT 0 NOT NULL,
    "opened_at" timestamp with time zone NOT NULL,
    "closed_at" timestamp with time zone,
    "duration_days" numeric,
    "roi" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "funding_pnl" numeric DEFAULT 0 NOT NULL,
    "duration_seconds" bigint,
    CONSTRAINT "positions_side_check" CHECK (("side" = ANY (ARRAY['long'::"text", 'short'::"text"]))),
    CONSTRAINT "positions_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'closed'::"text"])))
);


ALTER TABLE "public"."positions" OWNER TO "postgres";


COMMENT ON TABLE "public"."positions" IS 'Reconstructed position lifecycles derived from raw fills in the trades table. One row per (strategy, symbol, side) lifecycle from open to close. Populated by the worker position-reconstruction service. See migration 040.';



COMMENT ON COLUMN "public"."positions"."side" IS 'long = net-long entry, short = net-short entry. Derived from the first fill direction.';



COMMENT ON COLUMN "public"."positions"."status" IS 'open = position still held (unrealized_pnl updated by worker), closed = fully exited (realized_pnl final).';



COMMENT ON COLUMN "public"."positions"."entry_price_avg" IS 'Volume-weighted average entry price across all opening fills.';



COMMENT ON COLUMN "public"."positions"."exit_price_avg" IS 'Volume-weighted average exit price across all closing fills. NULL while position is open.';



COMMENT ON COLUMN "public"."positions"."size_base" IS 'Current position size in base asset. Zero when closed.';



COMMENT ON COLUMN "public"."positions"."size_peak" IS 'Maximum position size reached during the lifecycle. Used for position sizing analysis.';



COMMENT ON COLUMN "public"."positions"."fill_count" IS 'Number of individual fills attributed to this position lifecycle.';



COMMENT ON COLUMN "public"."positions"."duration_days" IS 'Days from opened_at to closed_at as NUMERIC (fractional days for sub-day holds). NULL while open. Computed on close.';



COMMENT ON COLUMN "public"."positions"."roi" IS 'Return on investment: realized_pnl / (entry_price_avg * size_peak). NULL while open.';



COMMENT ON COLUMN "public"."positions"."funding_pnl" IS 'Sum of funding_fees.amount over [opened_at, closed_at] for (strategy_id, symbol). Populated by reconstruct_positions after funding_fees ingestion. Additive to realized_pnl (price-only ROI). Total economic P&L = realized_pnl + funding_pnl (computed client-side). See migration 044.';



COMMENT ON COLUMN "public"."positions"."duration_seconds" IS 'High-precision lifetime in whole seconds (closed_at - opened_at). Audit G12.D.3.';



CREATE OR REPLACE VIEW "public"."public_profiles" WITH ("security_invoker"='on') AS
 SELECT "id",
    "display_name",
    "company",
    "description",
    "avatar_url",
    "role",
    "created_at"
   FROM "public"."profiles";


ALTER VIEW "public"."public_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reconciliation_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "report_date" "date" NOT NULL,
    "status" "text" NOT NULL,
    "discrepancy_count" integer DEFAULT 0 NOT NULL,
    "discrepancies" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "reconciliation_reports_status_check" CHECK (("status" = ANY (ARRAY['clean'::"text", 'discrepancies'::"text", 'needs_manual_review'::"text"])))
);


ALTER TABLE "public"."reconciliation_reports" OWNER TO "postgres";


COMMENT ON TABLE "public"."reconciliation_reports" IS 'Nightly reconciliation output: one row per (strategy, date). Populated by run_reconcile_strategy_job (analytics-service). Admin-read-only in v1 — no public RLS policy; service-role client bypasses. See migration 046.';



COMMENT ON COLUMN "public"."reconciliation_reports"."status" IS 'Roll-up: clean (no discrepancies), discrepancies (at least one mismatch), needs_manual_review (N:M ambiguous tuple match — escalated).';



COMMENT ON COLUMN "public"."reconciliation_reports"."discrepancies" IS 'JSONB list of {kind, exchange_fill_id, details}. Kinds: missing_in_db, id_drift, mismatch_quantity, mismatch_price, unknown_in_exchange, needs_manual_review, stale_sync. See services/reconciliation.py.';



CREATE TABLE IF NOT EXISTS "public"."relationship_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "contact_request_id" "uuid",
    "file_url" "text" NOT NULL,
    "file_type" "text" DEFAULT 'factsheet'::"text" NOT NULL,
    "file_name" "text",
    "uploaded_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "portfolio_id" "uuid",
    "strategy_id" "uuid",
    "title" "text",
    "doc_type" "text",
    "file_path" "text",
    "content" "text",
    CONSTRAINT "relationship_documents_doc_type_check" CHECK (("doc_type" = ANY (ARRAY['contract'::"text", 'note'::"text", 'factsheet'::"text", 'founder_update'::"text", 'other'::"text"])))
);


ALTER TABLE "public"."relationship_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resend_message_correlation" (
    "id" bigint NOT NULL,
    "correlation_id" "uuid" NOT NULL,
    "resend_message_id" "text" NOT NULL,
    "sent_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."resend_message_correlation" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."resend_message_correlation_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."resend_message_correlation_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."resend_message_correlation_id_seq" OWNED BY "public"."resend_message_correlation"."id";



CREATE TABLE IF NOT EXISTS "public"."scenario_commit_idempotency" (
    "allocator_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "request_hash" "text" NOT NULL,
    "response" "jsonb" NOT NULL,
    "schema_version" smallint DEFAULT 1 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scenario_commit_idem_request_hash_len_chk" CHECK (("length"("request_hash") = 64)),
    CONSTRAINT "scenario_commit_idempotency_idempotency_key_check" CHECK ((("length"("idempotency_key") >= 16) AND ("length"("idempotency_key") <= 128))),
    CONSTRAINT "scenario_commit_idempotency_request_hash_check" CHECK (("length"("request_hash") = 64))
);


ALTER TABLE "public"."scenario_commit_idempotency" OWNER TO "postgres";


COMMENT ON TABLE "public"."scenario_commit_idempotency" IS 'Per-allocator Idempotency-Key dedup cache for POST /api/allocator/scenario/commit. Row inserted after a successful commit; lookups short-circuit retries with the cached response. See migration 130 + audit-2026-05-07 round-2 Block D.';



CREATE TABLE IF NOT EXISTS "public"."strategy_analytics" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "computation_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "computation_error" "text",
    "benchmark" "text",
    "cumulative_return" numeric,
    "cagr" numeric,
    "volatility" numeric,
    "sharpe" numeric,
    "sortino" numeric,
    "calmar" numeric,
    "max_drawdown" numeric,
    "max_drawdown_duration_days" integer,
    "six_month_return" numeric,
    "sparkline_returns" "jsonb",
    "sparkline_drawdown" "jsonb",
    "metrics_json" "jsonb",
    "returns_series" "jsonb",
    "drawdown_series" "jsonb",
    "monthly_returns" "jsonb",
    "daily_returns" "jsonb",
    "rolling_metrics" "jsonb",
    "return_quantiles" "jsonb",
    "trade_metrics" "jsonb",
    "data_quality_flags" "jsonb",
    "volume_metrics" "jsonb",
    "exposure_metrics" "jsonb",
    CONSTRAINT "strategy_analytics_computation_status_check" CHECK (("computation_status" = ANY (ARRAY['pending'::"text", 'computing'::"text", 'complete'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."strategy_analytics" OWNER TO "postgres";


COMMENT ON COLUMN "public"."strategy_analytics"."volume_metrics" IS 'Aggregated trading volume data from raw fills: total_volume_usd, avg_daily_volume_usd, maker_ratio, volume_by_symbol, volume_by_month. Populated by compute_analytics worker. See migration 041.';



COMMENT ON COLUMN "public"."strategy_analytics"."exposure_metrics" IS 'Position and risk exposure data from reconstructed positions: avg_position_count, max_position_count, avg_leverage, long_short_ratio, concentration_top3. Populated by compute_analytics worker. See migration 041.';



CREATE TABLE IF NOT EXISTS "public"."strategy_analytics_series" (
    "strategy_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."strategy_analytics_series" OWNER TO "postgres";


COMMENT ON TABLE "public"."strategy_analytics_series" IS 'Sibling table to strategy_analytics for heavy time-series payloads. One row per (strategy_id, kind). Kinds: daily_returns_grid, rolling_sortino_3m/6m/12m, rolling_volatility_3m/6m/12m, rolling_alpha, rolling_beta, exposure_series, turnover_series, log_returns_series. Avoids the 1MB TOAST decompression ceiling on strategy_analytics.metrics_json. See migration 087.';



COMMENT ON COLUMN "public"."strategy_analytics_series"."kind" IS 'Snake-case identifier matching the metrics_json key naming convention (D-03). Add a new kind = INSERT a new row; no ALTER TABLE.';



COMMENT ON COLUMN "public"."strategy_analytics_series"."payload" IS 'JSONB payload for this kind. Series shapes are kind-specific; the TS contract in src/lib/types.ts (StrategyAnalyticsSeriesKind) is the single source of truth for downstream consumers.';



CREATE TABLE IF NOT EXISTS "public"."strategy_verifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "wizard_session_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "trust_tier" "text" NOT NULL,
    "flow_type" "text" NOT NULL,
    "source" "text" NOT NULL,
    "metrics_snapshot" "jsonb",
    "errors" "jsonb",
    "correlation_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "transitioned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "encrypted_credentials" "jsonb",
    "public_token" "text",
    "expires_at" timestamp with time zone,
    CONSTRAINT "strategy_verifications_flow_type_check" CHECK (("flow_type" = ANY (ARRAY['teaser'::"text", 'onboard'::"text", 'internal_report'::"text", 'csv'::"text", 'resync'::"text"]))),
    CONSTRAINT "strategy_verifications_source_check" CHECK (("source" = ANY (ARRAY['okx'::"text", 'binance'::"text", 'bybit'::"text", 'csv'::"text"]))),
    CONSTRAINT "strategy_verifications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'validated'::"text", 'metrics_captured'::"text", 'encrypted'::"text", 'report_queued'::"text", 'published'::"text"]))),
    CONSTRAINT "strategy_verifications_trust_tier_check" CHECK (("trust_tier" = ANY (ARRAY['api_verified'::"text", 'csv_uploaded'::"text", 'self_reported'::"text"])))
);


ALTER TABLE "public"."strategy_verifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."strategy_verifications" IS 'Per-strategy verification tracking row. Phase 15 / CSV-01..CSV-03 — migration 093. Status state machine + trust-tier label; flow_type discriminates teaser/onboard/csv/internal_report/resync. Phase 19 / BACKBONE-07 will add UNIQUE INDEX on wizard_session_id (idempotency).';



COMMENT ON COLUMN "public"."strategy_verifications"."wizard_session_id" IS 'Phase 19 / BACKBONE-07 will add a UNIQUE INDEX here for cross-flow idempotency. Phase 15 leaves it un-uniqued so reruns of the CSV path during early-customer onboarding do not collide.';



COMMENT ON COLUMN "public"."strategy_verifications"."trust_tier" IS 'csv_uploaded variant ships in Phase 15 (the only value finalize_csv_strategy writes). api_verified + self_reported are reserved for Phase 17 / DESIGN-01 trust-tier polish + Phase 19 unified backbone consumers.';



COMMENT ON COLUMN "public"."strategy_verifications"."flow_type" IS 'Phase 15 only writes flow_type=''csv''. The full vocabulary (teaser/onboard/internal_report/csv/resync) is admitted by the CHECK so Phase 19 BACKBONE PRs do not have to ALTER the constraint when the unified flow lights up.';



COMMENT ON COLUMN "public"."strategy_verifications"."source" IS 'Phase 15 only writes source=''csv''. The full vocabulary (okx/binance/bybit/csv) is admitted by the CHECK so Phase 19 BACKBONE PRs unifying API + CSV paths do not have to ALTER the constraint.';



COMMENT ON COLUMN "public"."strategy_verifications"."correlation_id" IS 'Phase 16 / OBSERV-06 will populate this with the request correlation_id from analytics-client.ts:66. Phase 15 leaves NULL — the column is reserved so 094 does not have to ALTER TABLE.';



COMMENT ON COLUMN "public"."strategy_verifications"."transitioned_at" IS 'Phase 19 / BACKBONE-03 — updated by transition_strategy_verification RPC; single source of truth for status changes. Adapter code MUST NOT direct-UPDATE status.';



COMMENT ON COLUMN "public"."strategy_verifications"."encrypted_credentials" IS 'Phase 19 / BACKBONE-03 — Phase 19 unified backbone stores per-verification encrypted credentials JSONB blob (merged in via RPC metadata->>encrypted_credentials).';



COMMENT ON COLUMN "public"."strategy_verifications"."public_token" IS 'Phase 19 / Pitfall 7 — first-class column (NOT JSONB nested). The verify-strategy/[id]/status route reads this by column name; the migration 107 VIEW maps it as a column too.';



COMMENT ON COLUMN "public"."strategy_verifications"."expires_at" IS 'Phase 19 / Pitfall 7 — first-class column for token expiry. See public_token.';



CREATE TABLE IF NOT EXISTS "public"."system_flags" (
    "key" "text" NOT NULL,
    "enabled" boolean NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid"
);


ALTER TABLE "public"."system_flags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."token_price_history" (
    "symbol" "text" NOT NULL,
    "asof" "date" NOT NULL,
    "price_usd" numeric NOT NULL,
    "source" "text" DEFAULT 'coingecko'::"text" NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."token_price_history" OWNER TO "postgres";


COMMENT ON TABLE "public"."token_price_history" IS 'CoinGecko historical price cache keyed on (symbol, asof). Service-role writes only. Phase 07 / RESEARCH.md §2.';



CREATE TABLE IF NOT EXISTS "public"."trades" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "exchange" "text" NOT NULL,
    "symbol" "text" NOT NULL,
    "side" "text" NOT NULL,
    "price" numeric NOT NULL,
    "quantity" numeric NOT NULL,
    "fee" numeric,
    "fee_currency" "text",
    "timestamp" timestamp with time zone NOT NULL,
    "order_type" "text",
    "exchange_order_id" "text",
    "exchange_fill_id" "text",
    "is_fill" boolean DEFAULT false NOT NULL,
    "is_maker" boolean,
    "cost" numeric,
    "raw_data" "jsonb",
    CONSTRAINT "trades_side_check" CHECK (("side" = ANY (ARRAY['buy'::"text", 'sell'::"text"])))
);


ALTER TABLE "public"."trades" OWNER TO "postgres";


COMMENT ON COLUMN "public"."trades"."exchange_order_id" IS 'Exchange-side order identifier. Populated for raw fills, NULL for legacy daily_pnl rows. See migration 039.';



COMMENT ON COLUMN "public"."trades"."exchange_fill_id" IS 'Exchange-side fill/execution identifier. Unique per (strategy, exchange) for dedup. See migration 039.';



COMMENT ON COLUMN "public"."trades"."is_fill" IS 'true = raw fill from CCXT fetch_my_trades; false = legacy daily_pnl summary row. Partial indexes filter on this. See migration 039.';



COMMENT ON COLUMN "public"."trades"."is_maker" IS 'true = maker fill (rebate-eligible on most exchanges), false = taker. NULL for legacy rows. Used for fee analysis. See migration 039.';



COMMENT ON COLUMN "public"."trades"."cost" IS 'Notional value of the fill (price * quantity). Pre-computed for volume aggregation without re-multiplying. See migration 039.';



COMMENT ON COLUMN "public"."trades"."raw_data" IS 'Original exchange response JSON from CCXT. Preserved for audit trail and debugging. See migration 039.';



COMMENT ON CONSTRAINT "trades_side_check" ON "public"."trades" IS 'audit-2026-05-07 G12.A.3 — trades.side must be a fill-side ("buy"/"sell"), never a position-direction.';



CREATE TABLE IF NOT EXISTS "public"."used_ack_tokens" (
    "token_hash" "text" NOT NULL,
    "alert_id" "uuid",
    "used_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."used_ack_tokens" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_app_roles" (
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "granted_by" "uuid",
    "granted_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_app_roles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'allocator'::"text", 'quant_manager'::"text", 'analyst'::"text"])))
);


ALTER TABLE "public"."user_app_roles" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_app_roles" IS 'Join table mapping auth.users → app role (admin|allocator|quant_manager|analyst). See migration 054 and ADR-0005. Supersedes profiles.is_admin for new code; is_admin remains for back-compat until Sprint 7.';



COMMENT ON COLUMN "public"."user_app_roles"."granted_by" IS 'The admin (auth.users.id) who granted this role. NULL for backfilled rows and system grants. ON DELETE SET NULL so deleting the granter does not cascade-delete the grant.';



COMMENT ON COLUMN "public"."user_app_roles"."granted_at" IS 'Grant timestamp. Immutable by convention — revoke + re-grant produces a new row rather than updating this column.';



CREATE TABLE IF NOT EXISTS "public"."user_favorites" (
    "user_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text"
);


ALTER TABLE "public"."user_favorites" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_favorites" IS 'Allocator watchlist of strategies they are considering but have not allocated to. Table persists for future watchlist/discovery features; no UI ships against it in v0.4.0 after the Scenarios-replaces-Test-Portfolios pivot.';



CREATE TABLE IF NOT EXISTS "public"."user_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "scope_kind" "text" NOT NULL,
    "scope_ref" "text" NOT NULL,
    CONSTRAINT "user_notes_content_check" CHECK (("char_length"("content") <= 100000)),
    CONSTRAINT "user_notes_scope_kind_check" CHECK (("scope_kind" = ANY (ARRAY['portfolio'::"text", 'holding'::"text", 'bridge_outcome'::"text", 'strategy'::"text"])))
);


ALTER TABLE "public"."user_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_notes" IS 'Per-user per-portfolio plain text notes pinned to the Notes widget. Nullable portfolio_id allows a global fallback note. 100KB content cap. See migration 037.';



COMMENT ON COLUMN "public"."user_notes"."content" IS 'Plain text. No markdown rendering, no rich text. CHECK constraint caps at 100KB to prevent abuse.';



COMMENT ON COLUMN "public"."user_notes"."scope_kind" IS 'Scope discriminator: one of portfolio, holding, bridge_outcome, strategy. See ADR-0023 §4 user_note.*.update rows.';



COMMENT ON COLUMN "public"."user_notes"."scope_ref" IS 'Stringified scope target: portfolio=UUID, holding={venue}:{symbol}:{holding_type}, bridge_outcome=UUID, strategy=UUID. Validated by parseHoldingScopeRef() for the holding scope; other scopes are UUID text. See src/lib/notes/scope-ref.ts + src/lib/notes/ownership.ts.';



CREATE TABLE IF NOT EXISTS "public"."verification_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "email" "text" NOT NULL,
    "exchange" "text" NOT NULL,
    "api_key_encrypted" "text" NOT NULL,
    "api_secret_encrypted" "text",
    "passphrase_encrypted" "text",
    "dek_encrypted" "text" NOT NULL,
    "nonce" "text",
    "kek_version" integer DEFAULT 1,
    "status" "text" DEFAULT 'pending'::"text",
    "error_message" "text",
    "results" "jsonb",
    "matched_strategy_id" "uuid",
    "discovered_manager_id" "uuid",
    "public_token" "text",
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "verification_requests_exchange_check" CHECK (("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text"]))),
    CONSTRAINT "verification_requests_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'processing'::"text", 'complete'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."verification_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."weight_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "portfolio_id" "uuid" NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "snapshot_date" "date" NOT NULL,
    "target_weight" numeric,
    "actual_weight" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."weight_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."weight_snapshots" IS 'Daily weight snapshots per (portfolio, strategy). Written on portfolio update or by worker daily. Feeds widget #18 Allocation Over Time. See migration 035.';



COMMENT ON COLUMN "public"."weight_snapshots"."target_weight" IS 'User-set target weight for this strategy in this portfolio. Sum of target_weights across strategies in a portfolio should equal 1.0 (not enforced here).';



COMMENT ON COLUMN "public"."weight_snapshots"."actual_weight" IS 'Realized weight after position moves and PnL. Computed from strategy NAV / portfolio NAV at snapshot time. May drift from target_weight between rebalances.';



ALTER TABLE ONLY "public"."resend_message_correlation" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."resend_message_correlation_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."allocation_events"
    ADD CONSTRAINT "allocation_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."allocator_equity_snapshots"
    ADD CONSTRAINT "allocator_equity_snapshots_pkey" PRIMARY KEY ("allocator_id", "asof");



ALTER TABLE ONLY "public"."allocator_holdings"
    ADD CONSTRAINT "allocator_holdings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."allocator_preferences"
    ADD CONSTRAINT "allocator_preferences_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log_cold"
    ADD CONSTRAINT "audit_log_cold_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."benchmark_prices"
    ADD CONSTRAINT "benchmark_prices_pkey" PRIMARY KEY ("date", "symbol");



ALTER TABLE ONLY "public"."bridge_outcome_dismissals"
    ADD CONSTRAINT "bridge_outcome_dismissals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."bridge_outcomes"
    ADD CONSTRAINT "bridge_outcomes_allocator_match_decision_unique" UNIQUE ("allocator_id", "match_decision_id");



COMMENT ON CONSTRAINT "bridge_outcomes_allocator_match_decision_unique" ON "public"."bridge_outcomes" IS 'Phase 10 / migration 081 (HIGH-1). Replaces bridge_outcomes_unique_per_strategy_holding from migration 072. Natural per-decision key now that voluntary kinds (with NULL strategy_id and/or NULL original_holding_ref) exist. Every bridge_outcome FKs to one match_decision; one outcome per decision is the invariant the daily delta cron + UI depend on.';



ALTER TABLE ONLY "public"."bridge_outcomes"
    ADD CONSTRAINT "bridge_outcomes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."compute_job_kinds"
    ADD CONSTRAINT "compute_job_kinds_pkey" PRIMARY KEY ("name");



ALTER TABLE ONLY "public"."compute_jobs"
    ADD CONSTRAINT "compute_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_allocator_id_strategy_id_key" UNIQUE ("allocator_id", "strategy_id");



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."cron_runs"
    ADD CONSTRAINT "cron_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."csv_daily_returns"
    ADD CONSTRAINT "csv_daily_returns_pkey" PRIMARY KEY ("strategy_id", "date");



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_state_exclusive" CHECK ((NOT (("completed_at" IS NOT NULL) AND ("rejected_at" IS NOT NULL)))) NOT VALID;



COMMENT ON CONSTRAINT "data_deletion_requests_state_exclusive" ON "public"."data_deletion_requests" IS 'audit-2026-05-07 M-0795. State-machine invariant: a deletion request is either pending (both NULL), completed (completed_at NOT NULL, rejected_at NULL), or rejected (rejected_at NOT NULL, completed_at NULL) — never both terminal states. NOT VALID at install; operator validates after backfill.';



ALTER TABLE ONLY "public"."deck_strategies"
    ADD CONSTRAINT "deck_strategies_pkey" PRIMARY KEY ("deck_id", "strategy_id");



ALTER TABLE ONLY "public"."decks"
    ADD CONSTRAINT "decks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."decks"
    ADD CONSTRAINT "decks_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."discovery_categories"
    ADD CONSTRAINT "discovery_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."discovery_categories"
    ADD CONSTRAINT "discovery_categories_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."feature_flags"
    ADD CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("flag_key");



ALTER TABLE ONLY "public"."for_quants_leads"
    ADD CONSTRAINT "for_quants_leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."funding_fees"
    ADD CONSTRAINT "funding_fees_match_key_key" UNIQUE ("match_key");



ALTER TABLE ONLY "public"."funding_fees"
    ADD CONSTRAINT "funding_fees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."investor_attestations"
    ADD CONSTRAINT "investor_attestations_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."key_permission_audit"
    ADD CONSTRAINT "key_permission_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_batches"
    ADD CONSTRAINT "match_batches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_candidates"
    ADD CONSTRAINT "match_candidates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_dispatches"
    ADD CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id", "user_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."portfolio_alerts"
    ADD CONSTRAINT "portfolio_alerts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_analytics"
    ADD CONSTRAINT "portfolio_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."portfolio_strategies"
    ADD CONSTRAINT "portfolio_strategies_pkey" PRIMARY KEY ("portfolio_id", "strategy_id");



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."position_snapshots"
    ADD CONSTRAINT "position_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reconciliation_reports"
    ADD CONSTRAINT "reconciliation_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reconciliation_reports"
    ADD CONSTRAINT "reconciliation_reports_strategy_id_report_date_key" UNIQUE ("strategy_id", "report_date");



ALTER TABLE ONLY "public"."relationship_documents"
    ADD CONSTRAINT "relationship_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resend_message_correlation"
    ADD CONSTRAINT "resend_message_correlation_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resend_message_correlation"
    ADD CONSTRAINT "resend_message_correlation_unique_msg" UNIQUE ("resend_message_id");



ALTER TABLE ONLY "public"."scenario_commit_idempotency"
    ADD CONSTRAINT "scenario_commit_idempotency_pkey" PRIMARY KEY ("allocator_id", "idempotency_key");



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_analytics"
    ADD CONSTRAINT "strategy_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_analytics_series"
    ADD CONSTRAINT "strategy_analytics_series_pkey" PRIMARY KEY ("strategy_id", "kind");



ALTER TABLE ONLY "public"."strategy_analytics"
    ADD CONSTRAINT "strategy_analytics_strategy_id_key" UNIQUE ("strategy_id");



ALTER TABLE ONLY "public"."strategy_verifications"
    ADD CONSTRAINT "strategy_verifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_flags"
    ADD CONSTRAINT "system_flags_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."token_price_history"
    ADD CONSTRAINT "token_price_history_pkey" PRIMARY KEY ("symbol", "asof");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."used_ack_tokens"
    ADD CONSTRAINT "used_ack_tokens_pkey" PRIMARY KEY ("token_hash");



ALTER TABLE ONLY "public"."user_app_roles"
    ADD CONSTRAINT "user_app_roles_pkey" PRIMARY KEY ("user_id", "role");



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_pkey" PRIMARY KEY ("user_id", "strategy_id");



ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_requests"
    ADD CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_requests"
    ADD CONSTRAINT "verification_requests_public_token_key" UNIQUE ("public_token");



ALTER TABLE ONLY "public"."weight_snapshots"
    ADD CONSTRAINT "weight_snapshots_pkey" PRIMARY KEY ("id");



CREATE INDEX "allocator_equity_snapshots_allocator_asof_desc_idx" ON "public"."allocator_equity_snapshots" USING "btree" ("allocator_id", "asof" DESC);



CREATE INDEX "allocator_holdings_allocator_asof_desc_idx" ON "public"."allocator_holdings" USING "btree" ("allocator_id", "asof" DESC);



CREATE INDEX "allocator_holdings_api_key_id_idx" ON "public"."allocator_holdings" USING "btree" ("api_key_id");



CREATE UNIQUE INDEX "allocator_holdings_owner_venue_symbol_asof_key" ON "public"."allocator_holdings" USING "btree" ("allocator_id", "venue", "symbol", "asof");



CREATE INDEX "allocator_holdings_ownership_probe_idx" ON "public"."allocator_holdings" USING "btree" ("allocator_id", "venue", "symbol", "holding_type", "asof" DESC);



COMMENT ON INDEX "public"."allocator_holdings_ownership_probe_idx" IS 'audit-2026-05-07 H-0984. Covering index for commit_scenario_batch ownership probe (mig 128 P1957). Leading 4-column equality matches the probe predicate; trailing asof DESC matches the latest-asof subquery scan direction.';



CREATE INDEX "api_keys_active_by_user_idx" ON "public"."api_keys" USING "btree" ("user_id") WHERE ("disconnected_at" IS NULL);



CREATE INDEX "bridge_outcome_dismissals_expires_at" ON "public"."bridge_outcome_dismissals" USING "btree" ("expires_at");



CREATE UNIQUE INDEX "bridge_outcome_dismissals_unique_per_strategy" ON "public"."bridge_outcome_dismissals" USING "btree" ("allocator_id", "strategy_id");



CREATE INDEX "bridge_outcomes_allocator_recent" ON "public"."bridge_outcomes" USING "btree" ("allocator_id", "created_at" DESC);



CREATE UNIQUE INDEX "bridge_outcomes_legacy_per_strategy_holding_when_md_null" ON "public"."bridge_outcomes" USING "btree" ("allocator_id", "strategy_id", COALESCE("original_holding_ref", ''::"text")) WHERE ("match_decision_id" IS NULL);



COMMENT ON INDEX "public"."bridge_outcomes_legacy_per_strategy_holding_when_md_null" IS 'Phase 10 / migration 083 (P2). Partial UNIQUE that restores the migration-072 (allocator_id, strategy_id, original_holding_ref) per-strategy invariant for any bridge_outcomes row whose match_decision_id was nulled out (e.g., via the ON DELETE SET NULL cascade when a match_decision is deleted). Migration 081 replaced 072''s unconditional unique with (allocator_id, match_decision_id), which over Postgres''s NULL-distinct semantics no longer blocks duplicate legacy-shape rows. This partial index restores that block strictly for the NULL-md case; rows with a real match_decision_id continue to use the bridge_outcomes_allocator_match_decision_unique constraint.';



CREATE INDEX "bridge_outcomes_needs_recompute" ON "public"."bridge_outcomes" USING "btree" ("needs_recompute") WHERE ("needs_recompute" = true);



CREATE INDEX "bridge_outcomes_strategy_id" ON "public"."bridge_outcomes" USING "btree" ("strategy_id");



CREATE INDEX "compute_jobs_claim_ready" ON "public"."compute_jobs" USING "btree" ("next_attempt_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "compute_jobs_exchange_status" ON "public"."compute_jobs" USING "btree" ("exchange", "status") WHERE ("exchange" IS NOT NULL);



CREATE UNIQUE INDEX "compute_jobs_one_inflight_per_kind_allocator" ON "public"."compute_jobs" USING "btree" ("allocator_id", "kind") WHERE (("allocator_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"])));



COMMENT ON INDEX "public"."compute_jobs_one_inflight_per_kind_allocator" IS 'Partial unique enforcing one in-flight job per (allocator_id, kind) for allocator-scoped kinds (rescore_allocator). Mirrors compute_jobs_one_inflight_per_kind_strategy / _portfolio. Phase 3 / D-12 Option B.';



CREATE UNIQUE INDEX "compute_jobs_one_inflight_per_kind_api_key" ON "public"."compute_jobs" USING "btree" ("api_key_id", "kind") WHERE (("api_key_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"])));



COMMENT ON INDEX "public"."compute_jobs_one_inflight_per_kind_api_key" IS 'Partial unique enforcing one in-flight job per (api_key_id, kind=poll_allocator_positions). Mirrors compute_jobs_one_inflight_per_kind_strategy / _portfolio / _allocator. Phase 06 / D-04.';



CREATE UNIQUE INDEX "compute_jobs_one_inflight_per_kind_portfolio" ON "public"."compute_jobs" USING "btree" ("portfolio_id", "kind") WHERE (("portfolio_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"])));



CREATE UNIQUE INDEX "compute_jobs_one_inflight_per_kind_strategy" ON "public"."compute_jobs" USING "btree" ("strategy_id", "kind") WHERE (("strategy_id" IS NOT NULL) AND ("kind" <> 'compute_intro_snapshot'::"text") AND ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"])));



COMMENT ON INDEX "public"."compute_jobs_one_inflight_per_kind_strategy" IS 'Partial unique enforcing one in-flight job per (strategy_id, kind) for strategy-scoped kinds. Excludes compute_intro_snapshot because those are per-(allocator, strategy), not per-strategy. See migration 048.';



CREATE UNIQUE INDEX "compute_jobs_one_inflight_reconstruct_per_api_key" ON "public"."compute_jobs" USING "btree" ("api_key_id", "kind") WHERE (("api_key_id" IS NOT NULL) AND ("kind" = 'reconstruct_allocator_history'::"text") AND ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"])));



COMMENT ON INDEX "public"."compute_jobs_one_inflight_reconstruct_per_api_key" IS 'Partial unique enforcing one in-flight reconstruct_allocator_history per api_key_id. Phase 07 / f1.';



CREATE UNIQUE INDEX "compute_jobs_one_inflight_refresh_equity_per_api_key" ON "public"."compute_jobs" USING "btree" ("api_key_id", "kind") WHERE (("api_key_id" IS NOT NULL) AND ("kind" = 'refresh_allocator_equity_daily'::"text") AND ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"])));



COMMENT ON INDEX "public"."compute_jobs_one_inflight_refresh_equity_per_api_key" IS 'Partial unique enforcing one in-flight refresh_allocator_equity_daily per api_key_id. Phase 07 / f1 BLOCKER — key-scoped because _allocator_key_preflight requires job[api_key_id].';



CREATE INDEX "compute_jobs_parent_lookup" ON "public"."compute_jobs" USING "gin" ("parent_job_ids") WHERE ("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done_pending_children'::"text"]));



COMMENT ON INDEX "public"."compute_jobs_parent_lookup" IS 'audit-2026-05-07 H-0851 + H-0865. Partial GIN on parent_job_ids limited to live (non-terminal) rows. Serves mark_compute_job_done''s child-advance loop via `parent_job_ids @> ARRAY[p_job_id]::uuid[]` containment. Drops index bloat across terminal rows and lifts the fan-in path off the sequential scan.';



CREATE INDEX "compute_jobs_status_created" ON "public"."compute_jobs" USING "btree" ("status", "created_at" DESC);



CREATE INDEX "compute_jobs_strategy_id" ON "public"."compute_jobs" USING "btree" ("strategy_id") WHERE ("strategy_id" IS NOT NULL);



CREATE INDEX "compute_jobs_stuck_running" ON "public"."compute_jobs" USING "btree" ("claimed_at") WHERE ("status" = 'running'::"text");



CREATE INDEX "for_quants_leads_created_at_idx" ON "public"."for_quants_leads" USING "btree" ("created_at" DESC);



CREATE INDEX "for_quants_leads_email_idx" ON "public"."for_quants_leads" USING "btree" ("email");



CREATE INDEX "funding_fees_exchange_symbol_timestamp" ON "public"."funding_fees" USING "btree" ("exchange", "symbol", "timestamp");



CREATE INDEX "funding_fees_strategy_timestamp" ON "public"."funding_fees" USING "btree" ("strategy_id", "timestamp" DESC);



CREATE INDEX "idx_allocation_events_portfolio" ON "public"."allocation_events" USING "btree" ("portfolio_id");



CREATE INDEX "idx_allocation_events_strategy" ON "public"."allocation_events" USING "btree" ("strategy_id");



CREATE INDEX "idx_audit_log_cold_created_at" ON "public"."audit_log_cold" USING "btree" ("created_at");



CREATE INDEX "idx_audit_log_cold_entity" ON "public"."audit_log_cold" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_log_cold_user" ON "public"."audit_log_cold" USING "btree" ("user_id");



CREATE INDEX "idx_audit_log_created_at" ON "public"."audit_log" USING "btree" ("created_at");



COMMENT ON INDEX "public"."idx_audit_log_created_at" IS 'audit-2026-05-07 H-0917. Range-scan support for the audit_log_hot_to_cold cron (DELETE WHERE created_at < now() - interval ''2 years''). Mirrors the cold-side idx_audit_log_cold_created_at added by migration 057.';



CREATE INDEX "idx_audit_log_entity" ON "public"."audit_log" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_log_user" ON "public"."audit_log" USING "btree" ("user_id");



CREATE INDEX "idx_compute_jobs_priority_pending" ON "public"."compute_jobs" USING "btree" ("priority", "next_attempt_at") WHERE (("priority" = ANY (ARRAY['normal'::"text", 'high'::"text"])) AND ("status" = ANY (ARRAY['pending'::"text", 'failed_retry'::"text"])));



CREATE INDEX "idx_contact_requests_status_created" ON "public"."contact_requests" USING "btree" ("status", "created_at");



CREATE INDEX "idx_contact_requests_tenant_id" ON "public"."contact_requests" USING "btree" ("tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "idx_cron_runs_name_recent" ON "public"."cron_runs" USING "btree" ("cron_name", "completed_at" DESC NULLS LAST);



CREATE INDEX "idx_cron_runs_running" ON "public"."cron_runs" USING "btree" ("cron_name", "started_at" DESC) WHERE ("status" = 'running'::"text");



CREATE INDEX "idx_deletion_requests_pending_v2" ON "public"."data_deletion_requests" USING "btree" ("requested_at" DESC) WHERE (("completed_at" IS NULL) AND ("rejected_at" IS NULL));



CREATE INDEX "idx_deletion_requests_user" ON "public"."data_deletion_requests" USING "btree" ("user_id", "requested_at" DESC);



CREATE INDEX "idx_for_quants_leads_stuck_notify" ON "public"."for_quants_leads" USING "btree" ("notify_attempted_at" DESC) WHERE (("notify_attempted_at" IS NOT NULL) AND ("notify_succeeded_at" IS NULL) AND ("processed_at" IS NULL));



CREATE INDEX "idx_key_permission_audit_key_time" ON "public"."key_permission_audit" USING "btree" ("api_key_id", "requested_at" DESC);



CREATE INDEX "idx_match_batches_allocator_recent" ON "public"."match_batches" USING "btree" ("allocator_id", "computed_at" DESC);



CREATE INDEX "idx_match_batches_tenant_id" ON "public"."match_batches" USING "btree" ("tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "idx_match_cand_batch_rank" ON "public"."match_candidates" USING "btree" ("batch_id", "rank") WHERE ("exclusion_reason" IS NULL);



CREATE INDEX "idx_match_cand_strategy" ON "public"."match_candidates" USING "btree" ("strategy_id");



CREATE INDEX "idx_match_dec_allocator_recent" ON "public"."match_decisions" USING "btree" ("allocator_id", "created_at" DESC);



CREATE INDEX "idx_match_dec_strategy" ON "public"."match_decisions" USING "btree" ("strategy_id");



CREATE INDEX "idx_notification_dispatches_failed" ON "public"."notification_dispatches" USING "btree" ("status", "created_at" DESC) WHERE ("status" = 'failed'::"text");



CREATE INDEX "idx_notification_dispatches_recipient_email" ON "public"."notification_dispatches" USING "btree" ("recipient_email");



CREATE INDEX "idx_notification_dispatches_recipient_email_lower" ON "public"."notification_dispatches" USING "btree" ("lower"("recipient_email"));



CREATE INDEX "idx_notification_dispatches_reminder_lookup" ON "public"."notification_dispatches" USING "btree" ("notification_type", "recipient_email", "created_at" DESC);



COMMENT ON INDEX "public"."idx_notification_dispatches_reminder_lookup" IS 'audit-2026-05-07 H-0913. Composite index for the api_key_rotation_reminder cron''s NOT EXISTS subquery: leading equality on notification_type + recipient_email, trailing range on created_at DESC. Pushes the dedup probe from O(N×M) to O(log N) per profile.';



CREATE INDEX "idx_notification_dispatches_type_created" ON "public"."notification_dispatches" USING "btree" ("notification_type", "created_at" DESC);



CREATE INDEX "idx_org_invites_email" ON "public"."organization_invites" USING "btree" ("email");



CREATE INDEX "idx_org_members_org" ON "public"."organization_members" USING "btree" ("organization_id");



CREATE INDEX "idx_org_members_user" ON "public"."organization_members" USING "btree" ("user_id");



CREATE INDEX "idx_portfolio_alerts_portfolio" ON "public"."portfolio_alerts" USING "btree" ("portfolio_id");



CREATE INDEX "idx_portfolio_alerts_unacked" ON "public"."portfolio_alerts" USING "btree" ("portfolio_id") WHERE ("acknowledged_at" IS NULL);



CREATE INDEX "idx_portfolio_analytics_computing" ON "public"."portfolio_analytics" USING "btree" ("portfolio_id", "computed_at" DESC) WHERE ("computation_status" = 'computing'::"text");



CREATE INDEX "idx_portfolio_analytics_latest" ON "public"."portfolio_analytics" USING "btree" ("portfolio_id", "computed_at" DESC);



CREATE INDEX "idx_portfolio_analytics_portfolio" ON "public"."portfolio_analytics" USING "btree" ("portfolio_id");



CREATE INDEX "idx_portfolio_strategies_tenant" ON "public"."portfolio_strategies" USING "btree" ("tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "idx_profiles_allocator_status" ON "public"."profiles" USING "btree" ("allocator_status");



CREATE INDEX "idx_profiles_tenant_id" ON "public"."profiles" USING "btree" ("tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "idx_relationship_documents_contact_request" ON "public"."relationship_documents" USING "btree" ("contact_request_id");



CREATE INDEX "idx_relationship_documents_portfolio" ON "public"."relationship_documents" USING "btree" ("portfolio_id") WHERE ("portfolio_id" IS NOT NULL);



CREATE INDEX "idx_strategies_disclosure_tier" ON "public"."strategies" USING "btree" ("disclosure_tier") WHERE ("status" = 'published'::"text");



CREATE INDEX "idx_strategies_org" ON "public"."strategies" USING "btree" ("organization_id");



CREATE INDEX "idx_strategies_source_status_created" ON "public"."strategies" USING "btree" ("source", "status", "created_at") WHERE (("source" = 'wizard'::"text") AND ("status" = 'draft'::"text"));



CREATE INDEX "idx_strategies_status" ON "public"."strategies" USING "btree" ("status");



CREATE INDEX "idx_strategies_tenant_id" ON "public"."strategies" USING "btree" ("tenant_id") WHERE ("tenant_id" IS NOT NULL);



CREATE INDEX "idx_strategy_analytics_series_payload_present" ON "public"."strategy_analytics_series" USING "btree" ("strategy_id", "kind") WHERE ("payload" IS NOT NULL);



CREATE INDEX "idx_trades_strategy_timestamp" ON "public"."trades" USING "btree" ("strategy_id", "timestamp");



CREATE INDEX "idx_used_ack_tokens_used_at" ON "public"."used_ack_tokens" USING "btree" ("used_at");



CREATE INDEX "idx_user_app_roles_role" ON "public"."user_app_roles" USING "btree" ("role");



CREATE INDEX "idx_verification_requests_email" ON "public"."verification_requests" USING "btree" ("email");



CREATE INDEX "idx_verification_requests_public_token" ON "public"."verification_requests" USING "btree" ("public_token") WHERE ("public_token" IS NOT NULL);



CREATE INDEX "idx_verification_requests_status" ON "public"."verification_requests" USING "btree" ("status");



CREATE INDEX "match_decisions_allocator_original_strategy" ON "public"."match_decisions" USING "btree" ("allocator_id", "original_strategy_id");



CREATE INDEX "match_decisions_original_holding_ref" ON "public"."match_decisions" USING "btree" ("original_holding_ref") WHERE ("original_holding_ref" IS NOT NULL);



CREATE UNIQUE INDEX "portfolio_alerts_dedup_unacked" ON "public"."portfolio_alerts" USING "btree" ("portfolio_id", "alert_type") WHERE (("acknowledged_at" IS NULL) AND ("alert_type" <> 'rebalance_drift'::"text"));



CREATE UNIQUE INDEX "portfolio_alerts_rebalance_drift_weekly" ON "public"."portfolio_alerts" USING "btree" ("portfolio_id", "strategy_id", "alert_type", "date_trunc"('week'::"text", "triggered_at", 'UTC'::"text")) WHERE (("acknowledged_at" IS NULL) AND ("alert_type" = 'rebalance_drift'::"text"));



CREATE UNIQUE INDEX "portfolios_one_real_per_user" ON "public"."portfolios" USING "btree" ("user_id") WHERE ("is_test" = false);



CREATE INDEX "position_snapshots_strategy_date" ON "public"."position_snapshots" USING "btree" ("strategy_id", "snapshot_date" DESC);



CREATE UNIQUE INDEX "position_snapshots_unique_per_day" ON "public"."position_snapshots" USING "btree" ("strategy_id", "snapshot_date", "symbol", "side");



CREATE INDEX "positions_open_recent" ON "public"."positions" USING "btree" ("strategy_id", "opened_at" DESC) WHERE ("status" = 'open'::"text");



CREATE INDEX "positions_strategy_roi" ON "public"."positions" USING "btree" ("strategy_id", "roi" DESC) WHERE ("status" = 'closed'::"text");



CREATE INDEX "positions_strategy_status" ON "public"."positions" USING "btree" ("strategy_id", "status");



CREATE INDEX "positions_strategy_symbol_opened" ON "public"."positions" USING "btree" ("strategy_id", "symbol", "opened_at" DESC);



CREATE INDEX "reconciliation_reports_strategy_date" ON "public"."reconciliation_reports" USING "btree" ("strategy_id", "report_date" DESC);



CREATE INDEX "resend_message_correlation_correlation_id_idx" ON "public"."resend_message_correlation" USING "btree" ("correlation_id");



CREATE INDEX "resend_message_correlation_sent_at_idx" ON "public"."resend_message_correlation" USING "btree" ("sent_at");



CREATE INDEX "strategies_fingerprint_gin_idx" ON "public"."strategies" USING "gin" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



COMMENT ON INDEX "public"."strategies_fingerprint_gin_idx" IS 'Phase 19 / FINGERPRINT-01 / I-perf-2. GIN over the JSONB fingerprint body.';



CREATE UNIQUE INDEX "strategy_verifications_public_token_unique_idx" ON "public"."strategy_verifications" USING "btree" ("public_token") WHERE ("public_token" IS NOT NULL);



CREATE INDEX "strategy_verifications_status_idx" ON "public"."strategy_verifications" USING "btree" ("status");



CREATE INDEX "strategy_verifications_strategy_id_idx" ON "public"."strategy_verifications" USING "btree" ("strategy_id");



CREATE UNIQUE INDEX "strategy_verifications_wizard_session_id_unique_idx" ON "public"."strategy_verifications" USING "btree" ("wizard_session_id");



COMMENT ON INDEX "public"."strategy_verifications_wizard_session_id_unique_idx" IS 'Phase 19 / BACKBONE-08. Wizard double-submit prevention; route catches 23505 and returns existing row.';



CREATE UNIQUE INDEX "trades_dedup_fill" ON "public"."trades" USING "btree" ("strategy_id", "exchange", "exchange_fill_id");



COMMENT ON INDEX "public"."trades_dedup_fill" IS 'Phase 2 raw-fill dedup. Full (non-partial) UNIQUE so PostgREST `on_conflict` in services/job_worker.py:run_sync_trades_job can target it via column list. Daily-PnL rows (is_fill=false, NULL exchange_fill_id) coexist because NULLs are distinct in PostgreSQL UNIQUE indexes. Migration 092.';



CREATE INDEX "trades_strategy_side_ts" ON "public"."trades" USING "btree" ("strategy_id", "side", "timestamp") WHERE ("is_fill" = true);



CREATE INDEX "trades_strategy_symbol_ts" ON "public"."trades" USING "btree" ("strategy_id", "symbol", "timestamp") WHERE ("is_fill" = true);



CREATE UNIQUE INDEX "uniq_match_dec_sent_per_pair" ON "public"."match_decisions" USING "btree" ("allocator_id", "strategy_id") WHERE ("decision" = 'sent_as_intro'::"text");



CREATE UNIQUE INDEX "uniq_match_dec_thumbdown_per_pair_holding" ON "public"."match_decisions" USING "btree" ("allocator_id", "strategy_id", COALESCE("original_holding_ref", ''::"text")) WHERE ("decision" = 'thumbs_down'::"text");



COMMENT ON INDEX "public"."uniq_match_dec_thumbdown_per_pair_holding" IS 'Phase 09 / migration 074. Widened from uniq_match_dec_thumbdown_per_pair (dropped). Same semantics as uniq_match_dec_thumbup_per_pair_holding — see above.';



CREATE UNIQUE INDEX "uniq_match_dec_thumbup_per_pair_holding" ON "public"."match_decisions" USING "btree" ("allocator_id", "strategy_id", COALESCE("original_holding_ref", ''::"text")) WHERE ("decision" = 'thumbs_up'::"text");



COMMENT ON INDEX "public"."uniq_match_dec_thumbup_per_pair_holding" IS 'Phase 09 / migration 074. Widened from uniq_match_dec_thumbup_per_pair (dropped). Allows multiple thumbs_up decisions on the same (allocator, strategy) when they originate from different holdings. COALESCE(original_holding_ref, '''') normalizes NULL→'''' so strategy-sourced rows (original_holding_ref IS NULL) still get a single slot per pair (migration 011 guarantee preserved).';



CREATE INDEX "user_favorites_user_id_created_at" ON "public"."user_favorites" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "user_notes_unique_multiscope" ON "public"."user_notes" USING "btree" ("user_id", "scope_kind", "scope_ref");



CREATE INDEX "weight_snapshots_portfolio_date" ON "public"."weight_snapshots" USING "btree" ("portfolio_id", "snapshot_date" DESC);



CREATE UNIQUE INDEX "weight_snapshots_unique_per_day" ON "public"."weight_snapshots" USING "btree" ("portfolio_id", "strategy_id", "snapshot_date");



CREATE OR REPLACE TRIGGER "allocator_holdings_enforce_owner_coherence" BEFORE INSERT OR UPDATE ON "public"."allocator_holdings" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_allocator_holdings_owner_coherence"();



CREATE OR REPLACE TRIGGER "allocator_holdings_set_updated_at" BEFORE UPDATE ON "public"."allocator_holdings" FOR EACH ROW EXECUTE FUNCTION "public"."set_allocator_holdings_updated_at"();



CREATE OR REPLACE TRIGGER "api_keys_stamp_first_added" AFTER INSERT ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_first_api_key_added"();



CREATE OR REPLACE TRIGGER "audit_log_cold_retention_guard" AFTER DELETE ON "public"."audit_log_cold" REFERENCING OLD TABLE AS "old_table" FOR EACH STATEMENT EXECUTE FUNCTION "public"."retention_delete_guard"();



CREATE OR REPLACE TRIGGER "audit_log_retention_guard" AFTER DELETE ON "public"."audit_log" REFERENCING OLD TABLE AS "old_table" FOR EACH STATEMENT EXECUTE FUNCTION "public"."retention_delete_guard"();



CREATE OR REPLACE TRIGGER "bridge_outcomes_set_updated_at_trigger" BEFORE UPDATE ON "public"."bridge_outcomes" FOR EACH ROW EXECUTE FUNCTION "public"."bridge_outcomes_set_updated_at"();



CREATE OR REPLACE TRIGGER "bridge_outcomes_sync_holding_ref_trigger" BEFORE INSERT OR UPDATE OF "match_decision_id" ON "public"."bridge_outcomes" FOR EACH ROW EXECUTE FUNCTION "public"."bridge_outcomes_sync_holding_ref"();



CREATE OR REPLACE TRIGGER "check_strategy_api_key_ownership_trigger" BEFORE INSERT OR UPDATE OF "api_key_id" ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."check_strategy_api_key_ownership"();



COMMENT ON TRIGGER "check_strategy_api_key_ownership_trigger" ON "public"."strategies" IS 'Blocks cross-tenant api_key_id assignment. See migration 028.';



CREATE OR REPLACE TRIGGER "compute_jobs_set_updated_at_trigger" BEFORE UPDATE ON "public"."compute_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."compute_jobs_set_updated_at"();



CREATE OR REPLACE TRIGGER "guard_wizard_draft_updates_trigger" BEFORE UPDATE ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."guard_wizard_draft_updates"();



CREATE OR REPLACE TRIGGER "match_decisions_visibility_check" BEFORE INSERT ON "public"."match_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."_match_decisions_visibility_check"();



CREATE OR REPLACE TRIGGER "portfolio_strategies_seed_weight_snapshot_trigger" AFTER INSERT ON "public"."portfolio_strategies" FOR EACH ROW EXECUTE FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"();



CREATE OR REPLACE TRIGGER "portfolios_reject_sentinel" BEFORE INSERT OR UPDATE ON "public"."portfolios" FOR EACH ROW EXECUTE FUNCTION "public"."reject_sentinel_writes"();



CREATE OR REPLACE TRIGGER "portfolios_seed_weight_snapshots_trigger" AFTER INSERT ON "public"."portfolios" FOR EACH ROW EXECUTE FUNCTION "public"."seed_weight_snapshots_for_portfolio"();



CREATE OR REPLACE TRIGGER "positions_set_updated_at_trigger" BEFORE UPDATE ON "public"."positions" FOR EACH ROW EXECUTE FUNCTION "public"."positions_set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_lock_role" BEFORE UPDATE OF "role" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_profile_role_change"();



COMMENT ON TRIGGER "profiles_lock_role" ON "public"."profiles" IS 'Companion to prevent_profile_role_change(). Fires only on UPDATE OF role so other profile column updates (display_name, company, telegram, etc.) have zero overhead.';



CREATE OR REPLACE TRIGGER "profiles_reject_sentinel" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."reject_sentinel_writes"();



CREATE OR REPLACE TRIGGER "strategies_reject_sentinel" BEFORE INSERT OR UPDATE ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."reject_sentinel_writes"();



CREATE OR REPLACE TRIGGER "user_notes_set_updated_at_trigger" BEFORE UPDATE ON "public"."user_notes" FOR EACH ROW EXECUTE FUNCTION "public"."user_notes_set_updated_at"();



CREATE OR REPLACE TRIGGER "verification_requests_post_phase19_audit" AFTER INSERT OR DELETE OR UPDATE ON "public"."verification_requests" FOR EACH ROW EXECUTE FUNCTION "public"."verification_requests_legacy_write_audit"();



ALTER TABLE ONLY "public"."allocation_events"
    ADD CONSTRAINT "allocation_events_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."allocation_events"
    ADD CONSTRAINT "allocation_events_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id");



ALTER TABLE ONLY "public"."allocator_equity_snapshots"
    ADD CONSTRAINT "allocator_equity_snapshots_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."allocator_holdings"
    ADD CONSTRAINT "allocator_holdings_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."allocator_holdings"
    ADD CONSTRAINT "allocator_holdings_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."allocator_preferences"
    ADD CONSTRAINT "allocator_preferences_edited_by_user_id_fkey" FOREIGN KEY ("edited_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."allocator_preferences"
    ADD CONSTRAINT "allocator_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."api_keys"
    ADD CONSTRAINT "api_keys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bridge_outcome_dismissals"
    ADD CONSTRAINT "bridge_outcome_dismissals_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bridge_outcome_dismissals"
    ADD CONSTRAINT "bridge_outcome_dismissals_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bridge_outcomes"
    ADD CONSTRAINT "bridge_outcomes_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."bridge_outcomes"
    ADD CONSTRAINT "bridge_outcomes_match_decision_id_fkey" FOREIGN KEY ("match_decision_id") REFERENCES "public"."match_decisions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."bridge_outcomes"
    ADD CONSTRAINT "bridge_outcomes_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compute_jobs"
    ADD CONSTRAINT "compute_jobs_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compute_jobs"
    ADD CONSTRAINT "compute_jobs_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compute_jobs"
    ADD CONSTRAINT "compute_jobs_kind_fkey" FOREIGN KEY ("kind") REFERENCES "public"."compute_job_kinds"("name");



ALTER TABLE ONLY "public"."compute_jobs"
    ADD CONSTRAINT "compute_jobs_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."compute_jobs"
    ADD CONSTRAINT "compute_jobs_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_replacement_for_fkey" FOREIGN KEY ("replacement_for") REFERENCES "public"."strategies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."contact_requests"
    ADD CONSTRAINT "contact_requests_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."csv_daily_returns"
    ADD CONSTRAINT "csv_daily_returns_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."data_deletion_requests"
    ADD CONSTRAINT "data_deletion_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



COMMENT ON CONSTRAINT "data_deletion_requests_user_id_fkey" ON "public"."data_deletion_requests" IS 'audit-2026-05-07 P455 — ON DELETE SET NULL (not CASCADE). The DSR row is the audit trail for the deletion event and MUST survive deletion of the auth user it references. Migration 124.';



ALTER TABLE ONLY "public"."deck_strategies"
    ADD CONSTRAINT "deck_strategies_deck_id_fkey" FOREIGN KEY ("deck_id") REFERENCES "public"."decks"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."deck_strategies"
    ADD CONSTRAINT "deck_strategies_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."for_quants_leads"
    ADD CONSTRAINT "for_quants_leads_processed_by_fkey" FOREIGN KEY ("processed_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."funding_fees"
    ADD CONSTRAINT "funding_fees_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."investor_attestations"
    ADD CONSTRAINT "investor_attestations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."key_permission_audit"
    ADD CONSTRAINT "key_permission_audit_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_batches"
    ADD CONSTRAINT "match_batches_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_candidates"
    ADD CONSTRAINT "match_candidates_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_candidates"
    ADD CONSTRAINT "match_candidates_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "public"."match_batches"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_candidates"
    ADD CONSTRAINT "match_candidates_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "public"."match_candidates"("id");



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_contact_request_id_fkey" FOREIGN KEY ("contact_request_id") REFERENCES "public"."contact_requests"("id");



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_original_strategy_id_fkey" FOREIGN KEY ("original_strategy_id") REFERENCES "public"."strategies"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."match_decisions"
    ADD CONSTRAINT "match_decisions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."organization_invites"
    ADD CONSTRAINT "organization_invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organization_members"
    ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."portfolio_alerts"
    ADD CONSTRAINT "portfolio_alerts_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio_alerts"
    ADD CONSTRAINT "portfolio_alerts_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."portfolio_analytics"
    ADD CONSTRAINT "portfolio_analytics_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio_strategies"
    ADD CONSTRAINT "portfolio_strategies_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolio_strategies"
    ADD CONSTRAINT "portfolio_strategies_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."portfolios"
    ADD CONSTRAINT "portfolios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."position_snapshots"
    ADD CONSTRAINT "position_snapshots_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."positions"
    ADD CONSTRAINT "positions_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reconciliation_reports"
    ADD CONSTRAINT "reconciliation_reports_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."relationship_documents"
    ADD CONSTRAINT "relationship_documents_contact_request_id_fkey" FOREIGN KEY ("contact_request_id") REFERENCES "public"."contact_requests"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."relationship_documents"
    ADD CONSTRAINT "relationship_documents_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."relationship_documents"
    ADD CONSTRAINT "relationship_documents_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."relationship_documents"
    ADD CONSTRAINT "relationship_documents_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."scenario_commit_idempotency"
    ADD CONSTRAINT "scenario_commit_idempotency_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."discovery_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id");



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_analytics_series"
    ADD CONSTRAINT "strategy_analytics_series_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_analytics"
    ADD CONSTRAINT "strategy_analytics_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_verifications"
    ADD CONSTRAINT "strategy_verifications_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_flags"
    ADD CONSTRAINT "system_flags_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."trades"
    ADD CONSTRAINT "trades_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."used_ack_tokens"
    ADD CONSTRAINT "used_ack_tokens_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "public"."portfolio_alerts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_app_roles"
    ADD CONSTRAINT "user_app_roles_granted_by_fkey" FOREIGN KEY ("granted_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."user_app_roles"
    ADD CONSTRAINT "user_app_roles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_favorites"
    ADD CONSTRAINT "user_favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_notes"
    ADD CONSTRAINT "user_notes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."verification_requests"
    ADD CONSTRAINT "verification_requests_matched_strategy_id_fkey" FOREIGN KEY ("matched_strategy_id") REFERENCES "public"."strategies"("id");



ALTER TABLE ONLY "public"."weight_snapshots"
    ADD CONSTRAINT "weight_snapshots_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."weight_snapshots"
    ADD CONSTRAINT "weight_snapshots_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



CREATE POLICY "Allocator can view own documents" ON "public"."relationship_documents" FOR SELECT USING (("contact_request_id" IN ( SELECT "contact_requests"."id"
   FROM "public"."contact_requests"
  WHERE ("contact_requests"."allocator_id" = "auth"."uid"()))));



CREATE POLICY "Manager can view documents for their strategies" ON "public"."relationship_documents" FOR SELECT USING (("contact_request_id" IN ( SELECT "cr"."id"
   FROM ("public"."contact_requests" "cr"
     JOIN "public"."strategies" "s" ON (("cr"."strategy_id" = "s"."id")))
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Parties can insert documents" ON "public"."relationship_documents" FOR INSERT WITH CHECK (("contact_request_id" IN ( SELECT "contact_requests"."id"
   FROM "public"."contact_requests"
  WHERE ("contact_requests"."allocator_id" = "auth"."uid"())
UNION
 SELECT "cr"."id"
   FROM ("public"."contact_requests" "cr"
     JOIN "public"."strategies" "s" ON (("cr"."strategy_id" = "s"."id")))
  WHERE ("s"."user_id" = "auth"."uid"()))));



CREATE POLICY "Portfolio owner can insert portfolio documents" ON "public"."relationship_documents" FOR INSERT WITH CHECK (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



CREATE POLICY "Portfolio owner can view portfolio documents" ON "public"."relationship_documents" FOR SELECT USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."allocation_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allocation_events_owner_delete" ON "public"."allocation_events" FOR DELETE USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



CREATE POLICY "allocation_events_owner_insert" ON "public"."allocation_events" FOR INSERT WITH CHECK (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



CREATE POLICY "allocation_events_owner_read" ON "public"."allocation_events" FOR SELECT USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."allocator_equity_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allocator_equity_snapshots_admin_select" ON "public"."allocator_equity_snapshots" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "allocator_equity_snapshots_owner_select" ON "public"."allocator_equity_snapshots" FOR SELECT USING (("allocator_id" = "auth"."uid"()));



CREATE POLICY "allocator_equity_snapshots_service_all" ON "public"."allocator_equity_snapshots" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."allocator_holdings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allocator_holdings_admin_select" ON "public"."allocator_holdings" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "allocator_holdings_owner_select" ON "public"."allocator_holdings" FOR SELECT USING (("allocator_id" = "auth"."uid"()));



CREATE POLICY "allocator_holdings_service_all" ON "public"."allocator_holdings" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."allocator_preferences" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allocator_prefs_admin_all" ON "public"."allocator_preferences" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "allocator_prefs_admin_read" ON "public"."allocator_preferences" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "allocator_prefs_self_insert" ON "public"."allocator_preferences" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "allocator_prefs_self_read" ON "public"."allocator_preferences" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "allocator_prefs_service_all" ON "public"."allocator_preferences" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "analytics_insert_deny" ON "public"."strategy_analytics" FOR INSERT WITH CHECK (false);



CREATE POLICY "analytics_read" ON "public"."strategy_analytics" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."strategies" "s"
  WHERE (("s"."id" = "strategy_analytics"."strategy_id") AND (("s"."status" = 'published'::"text") OR ("s"."user_id" = "auth"."uid"()))))));



CREATE POLICY "analytics_update_deny" ON "public"."strategy_analytics" FOR UPDATE USING (false);



ALTER TABLE "public"."api_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "api_keys_owner" ON "public"."api_keys" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "attestations_admin_read" ON "public"."investor_attestations" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "attestations_self_insert" ON "public"."investor_attestations" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "attestations_self_read" ON "public"."investor_attestations" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "attestations_service_role" ON "public"."investor_attestations" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_log_cold" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_log_cold_admin_read" ON "public"."audit_log_cold" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "audit_log_cold_no_deletes" ON "public"."audit_log_cold" FOR DELETE USING (false);



CREATE POLICY "audit_log_cold_no_updates" ON "public"."audit_log_cold" FOR UPDATE USING (false);



CREATE POLICY "audit_log_cold_owner_read" ON "public"."audit_log_cold" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "audit_log_cold_service_insert" ON "public"."audit_log_cold" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "audit_log_no_deletes" ON "public"."audit_log" FOR DELETE USING (false);



CREATE POLICY "audit_log_no_updates" ON "public"."audit_log" FOR UPDATE USING (false);



CREATE POLICY "audit_log_owner_read" ON "public"."audit_log" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "audit_log_service_insert" ON "public"."audit_log" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."benchmark_prices" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "benchmark_prices_delete" ON "public"."benchmark_prices" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "benchmark_prices_insert" ON "public"."benchmark_prices" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "benchmark_prices_read" ON "public"."benchmark_prices" FOR SELECT USING (true);



CREATE POLICY "benchmark_prices_select" ON "public"."benchmark_prices" FOR SELECT USING (true);



CREATE POLICY "benchmark_prices_update" ON "public"."benchmark_prices" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "benchmark_prices_write_deny" ON "public"."benchmark_prices" FOR INSERT WITH CHECK (false);



ALTER TABLE "public"."bridge_outcome_dismissals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bridge_outcome_dismissals_admin_read" ON "public"."bridge_outcome_dismissals" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "bridge_outcome_dismissals_delete_own" ON "public"."bridge_outcome_dismissals" FOR DELETE USING (("allocator_id" = "auth"."uid"()));



CREATE POLICY "bridge_outcome_dismissals_insert_own" ON "public"."bridge_outcome_dismissals" FOR INSERT WITH CHECK (("allocator_id" = "auth"."uid"()));



CREATE POLICY "bridge_outcome_dismissals_select_own" ON "public"."bridge_outcome_dismissals" FOR SELECT USING (("allocator_id" = "auth"."uid"()));



ALTER TABLE "public"."bridge_outcomes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "bridge_outcomes_admin_read" ON "public"."bridge_outcomes" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "bridge_outcomes_insert_own" ON "public"."bridge_outcomes" FOR INSERT WITH CHECK (("allocator_id" = "auth"."uid"()));



CREATE POLICY "bridge_outcomes_select_own" ON "public"."bridge_outcomes" FOR SELECT USING (("allocator_id" = "auth"."uid"()));



CREATE POLICY "bridge_outcomes_update_own" ON "public"."bridge_outcomes" FOR UPDATE USING (("allocator_id" = "auth"."uid"())) WITH CHECK (("allocator_id" = "auth"."uid"()));



CREATE POLICY "categories_public_read" ON "public"."discovery_categories" FOR SELECT USING (true);



ALTER TABLE "public"."compute_job_kinds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compute_job_kinds_read" ON "public"."compute_job_kinds" FOR SELECT USING (true);



ALTER TABLE "public"."compute_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "compute_jobs_deny_all" ON "public"."compute_jobs" USING (false) WITH CHECK (false);



COMMENT ON POLICY "compute_jobs_deny_all" ON "public"."compute_jobs" IS 'Service-role-only. Non-service callers get zero rows. User-scoped reads go through get_user_compute_jobs() SECURITY DEFINER. See migration 032.';



ALTER TABLE "public"."contact_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contact_requests_insert" ON "public"."contact_requests" FOR INSERT WITH CHECK (("allocator_id" = "auth"."uid"()));



CREATE POLICY "contact_requests_read" ON "public"."contact_requests" FOR SELECT USING ((("allocator_id" = "auth"."uid"()) OR ("strategy_id" IN ( SELECT "strategies"."id"
   FROM "public"."strategies"
  WHERE ("strategies"."user_id" = "auth"."uid"())))));



CREATE POLICY "contact_requests_update" ON "public"."contact_requests" FOR UPDATE USING (("strategy_id" IN ( SELECT "strategies"."id"
   FROM "public"."strategies"
  WHERE ("strategies"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."cron_runs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cron_runs_admin_read" ON "public"."cron_runs" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "cron_runs_service_role" ON "public"."cron_runs" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."csv_daily_returns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "csv_daily_returns_admin_select" ON "public"."csv_daily_returns" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "csv_daily_returns_owner_select" ON "public"."csv_daily_returns" FOR SELECT TO "authenticated" USING (("strategy_id" IN ( SELECT "strategies"."id"
   FROM "public"."strategies"
  WHERE ("strategies"."user_id" = "auth"."uid"()))));



CREATE POLICY "csv_daily_returns_service_role_all" ON "public"."csv_daily_returns" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."data_deletion_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."deck_strategies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "deck_strategies_read" ON "public"."deck_strategies" FOR SELECT USING (true);



ALTER TABLE "public"."decks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "decks_read" ON "public"."decks" FOR SELECT USING (true);



CREATE POLICY "deletion_admin_all" ON "public"."data_deletion_requests" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "deletion_self_insert" ON "public"."data_deletion_requests" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "deletion_self_read" ON "public"."data_deletion_requests" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "deletion_service_role" ON "public"."data_deletion_requests" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."discovery_categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."feature_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feature_flags_public_select" ON "public"."feature_flags" FOR SELECT USING (true);



CREATE POLICY "feature_flags_service_all" ON "public"."feature_flags" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."for_quants_leads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."funding_fees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "funding_fees_delete_deny" ON "public"."funding_fees" FOR DELETE USING (false);



CREATE POLICY "funding_fees_insert_deny" ON "public"."funding_fees" FOR INSERT WITH CHECK (false);



CREATE POLICY "funding_fees_read" ON "public"."funding_fees" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."strategies" "s"
  WHERE (("s"."id" = "funding_fees"."strategy_id") AND ("s"."user_id" = "auth"."uid"())))));



COMMENT ON POLICY "funding_fees_read" ON "public"."funding_fees" IS 'Manager-only: only the owning strategy manager can read their funding rows. Allocator aggregation goes via service-role (bypasses RLS). Cross-tenant leak prevention.';



CREATE POLICY "funding_fees_update_deny" ON "public"."funding_fees" FOR UPDATE USING (false);



ALTER TABLE "public"."investor_attestations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."key_permission_audit" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."match_batches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "match_batches_admin_delete" ON "public"."match_batches" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "match_batches_admin_select" ON "public"."match_batches" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "match_batches_service_delete" ON "public"."match_batches" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "match_batches_service_insert" ON "public"."match_batches" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "match_cand_admin_delete" ON "public"."match_candidates" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "match_cand_admin_select" ON "public"."match_candidates" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "match_cand_service_delete" ON "public"."match_candidates" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "match_cand_service_insert" ON "public"."match_candidates" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."match_candidates" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "match_dec_admin_all" ON "public"."match_decisions" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "match_dec_service_all" ON "public"."match_decisions" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."match_decisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notification_dispatches" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_dispatches_admin_read" ON "public"."notification_dispatches" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."is_admin" = true)))));



CREATE POLICY "notification_dispatches_service_role" ON "public"."notification_dispatches" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "org_invites_read" ON "public"."organization_invites" FOR SELECT USING ((("email" = ( SELECT "profiles"."email"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))) OR ("invited_by" = "auth"."uid"()) OR "public"."is_org_admin"("organization_id")));



CREATE POLICY "org_invites_update" ON "public"."organization_invites" FOR UPDATE USING (("email" = ( SELECT "profiles"."email"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))));



CREATE POLICY "org_members_insert" ON "public"."organization_members" FOR INSERT WITH CHECK ("public"."is_org_admin"("organization_id"));



CREATE POLICY "org_members_read" ON "public"."organization_members" FOR SELECT USING ("public"."is_org_member"("organization_id"));



CREATE POLICY "org_read" ON "public"."organizations" FOR SELECT USING (("public"."is_org_member"("id") OR ("created_by" = "auth"."uid"())));



ALTER TABLE "public"."organization_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organization_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."portfolio_alerts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portfolio_alerts_owner_read" ON "public"."portfolio_alerts" FOR SELECT USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



CREATE POLICY "portfolio_alerts_owner_update" ON "public"."portfolio_alerts" FOR UPDATE USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



CREATE POLICY "portfolio_alerts_service_insert" ON "public"."portfolio_alerts" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."portfolio_analytics" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portfolio_analytics_owner_read" ON "public"."portfolio_analytics" FOR SELECT USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



CREATE POLICY "portfolio_analytics_service_insert" ON "public"."portfolio_analytics" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "portfolio_analytics_service_update" ON "public"."portfolio_analytics" FOR UPDATE USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."portfolio_strategies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portfolio_strategies_owner" ON "public"."portfolio_strategies" USING (("portfolio_id" IN ( SELECT "portfolios"."id"
   FROM "public"."portfolios"
  WHERE ("portfolios"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."portfolios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "portfolios_admin_read" ON "public"."portfolios" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "portfolios_owner" ON "public"."portfolios" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."position_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "position_snapshots_delete_deny" ON "public"."position_snapshots" FOR DELETE USING (false);



CREATE POLICY "position_snapshots_insert_deny" ON "public"."position_snapshots" FOR INSERT WITH CHECK (false);



CREATE POLICY "position_snapshots_read" ON "public"."position_snapshots" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."strategies" "s"
  WHERE (("s"."id" = "position_snapshots"."strategy_id") AND (("s"."status" = 'published'::"text") OR ("s"."user_id" = "auth"."uid"()))))));



COMMENT ON POLICY "position_snapshots_read" ON "public"."position_snapshots" IS 'Allocators reading published strategies they hold AND managers reading their own. Mirrors 002_rls_policies.sql:35-42 strategy_analytics pattern. See migration 034.';



CREATE POLICY "position_snapshots_update_deny" ON "public"."position_snapshots" FOR UPDATE USING (false);



ALTER TABLE "public"."positions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "positions_delete_deny" ON "public"."positions" FOR DELETE USING (false);



CREATE POLICY "positions_insert_deny" ON "public"."positions" FOR INSERT WITH CHECK (false);



CREATE POLICY "positions_read" ON "public"."positions" FOR SELECT USING (("strategy_id" IN ( SELECT "strategies"."id"
   FROM "public"."strategies"
  WHERE ("strategies"."user_id" = ( SELECT "auth"."uid"() AS "uid")))));



COMMENT ON POLICY "positions_read" ON "public"."positions" IS 'Owner-only read. Audit G12.D.1.';



CREATE POLICY "positions_update_deny" ON "public"."positions" FOR UPDATE USING (false);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_read_public" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR true));



CREATE POLICY "profiles_self_delete" ON "public"."profiles" FOR DELETE USING (("auth"."uid"() = "id"));



COMMENT ON POLICY "profiles_self_delete" ON "public"."profiles" IS 'Audit-2026-05-07 P337. USING requires auth.uid() = id. DELETE has no WITH CHECK semantics.';



CREATE POLICY "profiles_self_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("auth"."uid"() = "id"));



COMMENT ON POLICY "profiles_self_insert" ON "public"."profiles" IS 'Audit-2026-05-07 P337. Replaces ALL-policy with explicit per-verb. WITH CHECK pins target row to caller.';



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



COMMENT ON POLICY "profiles_self_update" ON "public"."profiles" IS 'Audit-2026-05-07 P337. USING + WITH CHECK both require auth.uid() = id. No OR-true escape allowed.';



ALTER TABLE "public"."reconciliation_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."relationship_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resend_message_correlation" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scenario_commit_idem_self" ON "public"."scenario_commit_idempotency" FOR SELECT USING (("allocator_id" = "auth"."uid"()));



COMMENT ON POLICY "scenario_commit_idem_self" ON "public"."scenario_commit_idempotency" IS 'Defense-in-depth: an allocator can SELECT only their own dedup rows. The route uses the service-role admin client (bypasses RLS) for both the SELECT lookup and the post-commit INSERT; this policy guards a future re-route through the user-scoped client.';



ALTER TABLE "public"."scenario_commit_idempotency" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."strategies" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategies_delete" ON "public"."strategies" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "strategies_insert" ON "public"."strategies" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "strategies_org_read" ON "public"."strategies" FOR SELECT USING (((("organization_id" IS NULL) AND (("status" = 'published'::"text") OR ("user_id" = "auth"."uid"()))) OR (("organization_id" IS NOT NULL) AND "public"."is_org_member"("organization_id"))));



CREATE POLICY "strategies_read" ON "public"."strategies" FOR SELECT USING ((("status" = 'published'::"text") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "strategies_update" ON "public"."strategies" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."strategy_analytics" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."strategy_analytics_series" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_analytics_series_deny_all" ON "public"."strategy_analytics_series" USING (false) WITH CHECK (false);



COMMENT ON POLICY "strategy_analytics_series_deny_all" ON "public"."strategy_analytics_series" IS 'Service-role-only at the policy layer. Non-service callers get zero rows on direct read. Allocator-side access goes through fetch_strategy_lazy_metrics SECURITY DEFINER RPC. See migration 087.';



ALTER TABLE "public"."strategy_verifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_verifications_admin_select" ON "public"."strategy_verifications" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "strategy_verifications_owner_select" ON "public"."strategy_verifications" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."strategies" "s"
  WHERE (("s"."id" = "strategy_verifications"."strategy_id") AND ("s"."user_id" = "auth"."uid"())))));



CREATE POLICY "strategy_verifications_service_all" ON "public"."strategy_verifications" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."system_flags" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_flags_admin_all" ON "public"."system_flags" USING ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."profiles"
  WHERE (("profiles"."id" = "auth"."uid"()) AND ("profiles"."is_admin" = true)))));



CREATE POLICY "system_flags_match_engine_public_read" ON "public"."system_flags" FOR SELECT USING (("key" = 'match_engine_enabled'::"text"));



CREATE POLICY "system_flags_service_all" ON "public"."system_flags" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."token_price_history" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "token_price_history_service_all" ON "public"."token_price_history" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."trades" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "trades_insert_deny" ON "public"."trades" FOR INSERT WITH CHECK (false);



CREATE POLICY "trades_read" ON "public"."trades" FOR SELECT USING (("strategy_id" IN ( SELECT "strategies"."id"
   FROM "public"."strategies"
  WHERE ("strategies"."user_id" = "auth"."uid"()))));



ALTER TABLE "public"."used_ack_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_app_roles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_app_roles_admin_read" ON "public"."user_app_roles" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "user_app_roles_owner_read" ON "public"."user_app_roles" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_app_roles_service_delete" ON "public"."user_app_roles" FOR DELETE USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "user_app_roles_service_insert" ON "public"."user_app_roles" FOR INSERT WITH CHECK (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."user_favorites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_notes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_notes_delete_own" ON "public"."user_notes" FOR DELETE USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_notes_insert_own" ON "public"."user_notes" FOR INSERT WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "user_notes_select_own" ON "public"."user_notes" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "user_notes_update_own" ON "public"."user_notes" FOR UPDATE USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "users delete own favorites" ON "public"."user_favorites" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "users insert own favorites" ON "public"."user_favorites" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users see own favorites" ON "public"."user_favorites" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "users update own favorites" ON "public"."user_favorites" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."verification_requests" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "verification_requests_service_all" ON "public"."verification_requests" USING (("auth"."role"() = 'service_role'::"text"));



ALTER TABLE "public"."weight_snapshots" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "weight_snapshots_delete_deny" ON "public"."weight_snapshots" FOR DELETE USING (false);



CREATE POLICY "weight_snapshots_insert_deny" ON "public"."weight_snapshots" FOR INSERT WITH CHECK (false);



CREATE POLICY "weight_snapshots_read" ON "public"."weight_snapshots" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."portfolios" "p"
  WHERE (("p"."id" = "weight_snapshots"."portfolio_id") AND ("p"."user_id" = "auth"."uid"())))));



COMMENT ON POLICY "weight_snapshots_read" ON "public"."weight_snapshots" IS 'Portfolio owner only. Weight history is private to the allocator, never visible to other users. See migration 035.';



CREATE POLICY "weight_snapshots_update_deny" ON "public"."weight_snapshots" FOR UPDATE USING (false);





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";








GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "public"."_assert_no_public_execute"("p_function_signature" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_assert_owner"("p_table" "regclass", "p_row_id" "uuid", "p_context" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_assert_owner"("p_table" "regclass", "p_row_id" "uuid", "p_context" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_assert_retention_columns"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."_assert_strategy_visible_to_allocator"("p_strategy_id" "uuid", "p_allocator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_assert_strategy_visible_to_allocator"("p_strategy_id" "uuid", "p_allocator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."_match_decisions_visibility_check"() TO "anon";
GRANT ALL ON FUNCTION "public"."_match_decisions_visibility_check"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."_match_decisions_visibility_check"() TO "service_role";



GRANT ALL ON FUNCTION "public"."_scoring_weight_overrides_is_valid"("p_overrides" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."_scoring_weight_overrides_is_valid"("p_overrides" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."_scoring_weight_overrides_is_valid"("p_overrides" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."bridge_outcomes_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."bridge_outcomes_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bridge_outcomes_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."bridge_outcomes_sync_holding_ref"() TO "anon";
GRANT ALL ON FUNCTION "public"."bridge_outcomes_sync_holding_ref"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."bridge_outcomes_sync_holding_ref"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_fan_in_ready"("p_child_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_fan_in_ready"("p_child_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_strategy_api_key_ownership"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_strategy_api_key_ownership"() TO "service_role";



GRANT ALL ON TABLE "public"."compute_jobs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_bridge_outcome_deltas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_bridge_outcome_deltas"() TO "service_role";



GRANT ALL ON FUNCTION "public"."compute_jobs_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."compute_jobs_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_jobs_set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_similarity"("a" "jsonb", "b" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_similarity"("a" "jsonb", "b" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."compute_similarity"("a" "jsonb", "b" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_allocator_connected_strategy"("p_user_id" "uuid", "p_portfolio_id" "uuid", "p_exchange" "text", "p_label" "text", "p_strategy_name" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_allocator_connected_strategy"("p_user_id" "uuid", "p_portfolio_id" "uuid", "p_exchange" "text", "p_label" "text", "p_strategy_name" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_allocator_connected_strategy"("p_user_id" "uuid", "p_portfolio_id" "uuid", "p_exchange" "text", "p_label" "text", "p_strategy_name" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_poll_allocator_positions_for_all_keys"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_poll_allocator_positions_for_all_keys"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_poll_positions_for_all_strategies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_poll_positions_for_all_strategies"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_refresh_allocator_equity_for_all"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_refresh_allocator_equity_for_all"() TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_delta"("series" "jsonb", "anchor" "date", "days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."extract_delta"("series" "jsonb", "anchor" "date", "days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_delta"("series" "jsonb", "anchor" "date", "days" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_equity_at"("series" "jsonb", "target_date" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_equity_at"("series" "jsonb", "target_date" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_equity_at"("series" "jsonb", "target_date" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_estimated"("series" "jsonb", "anchor" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_estimated"("series" "jsonb", "anchor" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_estimated"("series" "jsonb", "anchor" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."extract_symbol_value_at"("p_allocator_id" "uuid", "p_symbol" "text", "p_asof" "date") TO "anon";
GRANT ALL ON FUNCTION "public"."extract_symbol_value_at"("p_allocator_id" "uuid", "p_symbol" "text", "p_asof" "date") TO "authenticated";
GRANT ALL ON FUNCTION "public"."extract_symbol_value_at"("p_allocator_id" "uuid", "p_symbol" "text", "p_asof" "date") TO "service_role";



GRANT ALL ON FUNCTION "public"."fetch_strategy_lazy_metrics"("p_strategy_id" "uuid", "p_panel_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."fetch_strategy_lazy_metrics"("p_strategy_id" "uuid", "p_panel_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."fetch_strategy_lazy_metrics"("p_strategy_id" "uuid", "p_panel_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_csv_strategy"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_csv_strategy"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_csv_strategy"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_wizard_draft_updates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_wizard_draft_updates"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."increment_user_session_count"("p_user_id" "uuid", "p_debounce_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."increment_user_session_count"("p_user_id" "uuid", "p_debounce_seconds" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."increment_user_session_count"("p_user_id" "uuid", "p_debounce_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."increment_user_session_count"("p_user_id" "uuid", "p_debounce_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_admin"("org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_admin"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_admin"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_org_member"("org_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_org_member"("org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_member"("org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("org_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."latest_cron_success"("p_cron_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."latest_cron_success"("p_cron_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_audit_event"("p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."log_audit_event_service"("p_user_id" "uuid", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_audit_event_service"("p_user_id" "uuid", "p_action" "text", "p_entity_type" "text", "p_entity_id" "uuid", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_compute_job_done"("p_job_id" "uuid", "p_claim_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_compute_job_done"("p_job_id" "uuid", "p_claim_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."mark_compute_job_failed"("p_job_id" "uuid", "p_error" "text", "p_error_kind" "text", "p_claim_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."mark_compute_job_failed"("p_job_id" "uuid", "p_error" "text", "p_error_kind" "text", "p_claim_token" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."parse_holding_ref"("p_ref" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."parse_holding_ref"("p_ref" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."parse_holding_ref"("p_ref" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."persist_csv_daily_returns"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_rows" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."persist_csv_daily_returns"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_rows" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."persist_csv_daily_returns"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_rows" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."positions_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."positions_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."positions_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_profile_role_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reclaim_stuck_compute_jobs"("p_older_than" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reclaim_stuck_compute_jobs"("p_older_than" interval) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconnect_allocator_api_key"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconnect_allocator_api_key"("p_api_key_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconnect_allocator_api_key"("p_api_key_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconstruct_positions_atomic"("p_strategy_id" "uuid", "p_positions" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconstruct_positions_atomic"("p_strategy_id" "uuid", "p_positions" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."reject_sentinel_writes"() TO "anon";
GRANT ALL ON FUNCTION "public"."reject_sentinel_writes"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."reject_sentinel_writes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."request_allocator_holdings_sync"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."request_allocator_holdings_sync"("p_api_key_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."request_allocator_holdings_sync"("p_api_key_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_stalled_compute_jobs"("p_stale_threshold" interval, "p_per_kind_overrides" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_stalled_compute_jobs"("p_stale_threshold" interval, "p_per_kind_overrides" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reset_stalled_portfolio_analytics"("p_stale_threshold" interval) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reset_stalled_portfolio_analytics"("p_stale_threshold" interval) TO "service_role";



GRANT ALL ON FUNCTION "public"."retention_delete_guard"() TO "anon";
GRANT ALL ON FUNCTION "public"."retention_delete_guard"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."retention_delete_guard"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sanitize_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sanitize_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_weight_snapshots_for_portfolio"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_weight_snapshots_for_portfolio"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_weight_snapshots_for_portfolio"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_allocator_holdings_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_allocator_holdings_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_allocator_holdings_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_first_api_key_added"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_first_api_key_added"() TO "anon";
GRANT ALL ON FUNCTION "public"."stamp_first_api_key_added"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."stamp_first_api_key_added"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_first_bridge_surfaced"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_first_bridge_surfaced"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."stamp_first_bridge_surfaced"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stamp_first_bridge_surfaced"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_first_sync_success"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_first_sync_success"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."stamp_first_sync_success"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."stamp_first_sync_success"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_trades"("p_strategy_id" "uuid", "p_trades" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_trades"("p_strategy_id" "uuid", "p_trades" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."test_force_cold_purge"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."test_force_cold_purge"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."test_force_hot_to_cold_move"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."test_force_hot_to_cold_move"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."transition_strategy_verification"("p_verification_id" "uuid", "p_new_status" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."transition_strategy_verification"("p_verification_id" "uuid", "p_new_status" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."transition_strategy_verification"("p_verification_id" "uuid", "p_new_status" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_allocator_mandates"("p_max_weight" numeric, "p_preferred_strategy_types" "text"[], "p_excluded_exchanges" "text"[], "p_target_ticket_size_usd" numeric, "p_mandate_archetype" "text", "p_correlation_ceiling" numeric, "p_max_drawdown_tolerance" numeric, "p_liquidity_preference" "text", "p_style_exclusions" "text"[], "p_clear_fields" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_allocator_mandates"("p_max_weight" numeric, "p_preferred_strategy_types" "text"[], "p_excluded_exchanges" "text"[], "p_target_ticket_size_usd" numeric, "p_mandate_archetype" "text", "p_correlation_ceiling" numeric, "p_max_drawdown_tolerance" numeric, "p_liquidity_preference" "text", "p_style_exclusions" "text"[], "p_clear_fields" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_allocator_mandates"("p_max_weight" numeric, "p_preferred_strategy_types" "text"[], "p_excluded_exchanges" "text"[], "p_target_ticket_size_usd" numeric, "p_mandate_archetype" "text", "p_correlation_ceiling" numeric, "p_max_drawdown_tolerance" numeric, "p_liquidity_preference" "text", "p_style_exclusions" "text"[], "p_clear_fields" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_api_key_rate_limit"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_api_key_rate_limit"("p_api_key_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."upsert_strategy_analytics_series_batch"("p_strategy_id" "uuid", "p_kinds" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_strategy_analytics_series_batch"("p_strategy_id" "uuid", "p_kinds" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_notes_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."user_notes_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_notes_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."verification_requests_legacy_write_audit"() TO "anon";
GRANT ALL ON FUNCTION "public"."verification_requests_legacy_write_audit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verification_requests_legacy_write_audit"() TO "service_role";
























GRANT ALL ON TABLE "public"."allocation_events" TO "anon";
GRANT ALL ON TABLE "public"."allocation_events" TO "authenticated";
GRANT ALL ON TABLE "public"."allocation_events" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_holdings" TO "anon";
GRANT ALL ON TABLE "public"."allocator_holdings" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_holdings" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_preferences" TO "anon";
GRANT ALL ON TABLE "public"."allocator_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_preferences" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."api_keys" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."api_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."api_keys" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("user_id") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("exchange") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("label") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("is_active") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("last_sync_at") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("account_balance_usdt") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("sync_status") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("sync_error") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("last_429_at") ON TABLE "public"."api_keys" TO "authenticated";



GRANT SELECT("disconnected_at") ON TABLE "public"."api_keys" TO "authenticated";



GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."audit_log_cold" TO "anon";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log_cold" TO "authenticated";
GRANT SELECT,INSERT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."audit_log_cold" TO "service_role";



GRANT ALL ON TABLE "public"."benchmark_prices" TO "anon";
GRANT ALL ON TABLE "public"."benchmark_prices" TO "authenticated";
GRANT ALL ON TABLE "public"."benchmark_prices" TO "service_role";



GRANT ALL ON TABLE "public"."bridge_outcome_dismissals" TO "anon";
GRANT ALL ON TABLE "public"."bridge_outcome_dismissals" TO "authenticated";
GRANT ALL ON TABLE "public"."bridge_outcome_dismissals" TO "service_role";



GRANT ALL ON TABLE "public"."bridge_outcomes" TO "anon";
GRANT ALL ON TABLE "public"."bridge_outcomes" TO "authenticated";
GRANT ALL ON TABLE "public"."bridge_outcomes" TO "service_role";



GRANT ALL ON TABLE "public"."compute_job_kinds" TO "service_role";
GRANT SELECT ON TABLE "public"."compute_job_kinds" TO "authenticated";



GRANT ALL ON TABLE "public"."portfolios" TO "anon";
GRANT ALL ON TABLE "public"."portfolios" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolios" TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("display_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("company") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("company") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("description") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("description") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("email") ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("website") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("website") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("linkedin") ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("avatar_url") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("role") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("role") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("manager_status") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("manager_status") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("allocator_status") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("allocator_status") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("is_admin") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("is_admin") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("preferences_updated_at") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("preferences_updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("bio") ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("years_trading") ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("aum_range") ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("tenant_id") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("tenant_id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("partner_tag") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("partner_tag") ON TABLE "public"."profiles" TO "authenticated";



GRANT ALL ON TABLE "public"."strategies" TO "anon";
GRANT ALL ON TABLE "public"."strategies" TO "authenticated";
GRANT ALL ON TABLE "public"."strategies" TO "service_role";



GRANT ALL ON TABLE "public"."compute_jobs_admin" TO "anon";
GRANT ALL ON TABLE "public"."compute_jobs_admin" TO "authenticated";
GRANT ALL ON TABLE "public"."compute_jobs_admin" TO "service_role";



GRANT ALL ON TABLE "public"."contact_requests" TO "anon";
GRANT ALL ON TABLE "public"."contact_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."contact_requests" TO "service_role";



GRANT ALL ON TABLE "public"."cron_runs" TO "anon";
GRANT ALL ON TABLE "public"."cron_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."cron_runs" TO "service_role";



GRANT ALL ON TABLE "public"."csv_daily_returns" TO "anon";
GRANT ALL ON TABLE "public"."csv_daily_returns" TO "authenticated";
GRANT ALL ON TABLE "public"."csv_daily_returns" TO "service_role";



GRANT ALL ON TABLE "public"."data_deletion_requests" TO "anon";
GRANT ALL ON TABLE "public"."data_deletion_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."data_deletion_requests" TO "service_role";



GRANT ALL ON TABLE "public"."deck_strategies" TO "anon";
GRANT ALL ON TABLE "public"."deck_strategies" TO "authenticated";
GRANT ALL ON TABLE "public"."deck_strategies" TO "service_role";



GRANT ALL ON TABLE "public"."decks" TO "anon";
GRANT ALL ON TABLE "public"."decks" TO "authenticated";
GRANT ALL ON TABLE "public"."decks" TO "service_role";



GRANT ALL ON TABLE "public"."discovery_categories" TO "anon";
GRANT ALL ON TABLE "public"."discovery_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."discovery_categories" TO "service_role";



GRANT ALL ON TABLE "public"."feature_flags" TO "anon";
GRANT ALL ON TABLE "public"."feature_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."feature_flags" TO "service_role";



GRANT ALL ON TABLE "public"."for_quants_leads" TO "service_role";



GRANT ALL ON TABLE "public"."funding_fees" TO "anon";
GRANT ALL ON TABLE "public"."funding_fees" TO "authenticated";
GRANT ALL ON TABLE "public"."funding_fees" TO "service_role";



GRANT ALL ON TABLE "public"."investor_attestations" TO "anon";
GRANT ALL ON TABLE "public"."investor_attestations" TO "authenticated";
GRANT ALL ON TABLE "public"."investor_attestations" TO "service_role";



GRANT ALL ON TABLE "public"."key_permission_audit" TO "anon";
GRANT ALL ON TABLE "public"."key_permission_audit" TO "authenticated";
GRANT ALL ON TABLE "public"."key_permission_audit" TO "service_role";



GRANT ALL ON TABLE "public"."match_batches" TO "anon";
GRANT ALL ON TABLE "public"."match_batches" TO "authenticated";
GRANT ALL ON TABLE "public"."match_batches" TO "service_role";



GRANT ALL ON TABLE "public"."match_candidates" TO "anon";
GRANT ALL ON TABLE "public"."match_candidates" TO "authenticated";
GRANT ALL ON TABLE "public"."match_candidates" TO "service_role";



GRANT ALL ON TABLE "public"."match_decisions" TO "anon";
GRANT ALL ON TABLE "public"."match_decisions" TO "authenticated";
GRANT ALL ON TABLE "public"."match_decisions" TO "service_role";



GRANT ALL ON TABLE "public"."notification_dispatches" TO "anon";
GRANT ALL ON TABLE "public"."notification_dispatches" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_dispatches" TO "service_role";



GRANT ALL ON TABLE "public"."organization_invites" TO "anon";
GRANT ALL ON TABLE "public"."organization_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_invites" TO "service_role";



GRANT ALL ON TABLE "public"."organization_members" TO "anon";
GRANT ALL ON TABLE "public"."organization_members" TO "authenticated";
GRANT ALL ON TABLE "public"."organization_members" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_alerts" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_alerts" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_analytics" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_strategies" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_strategies" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_strategies" TO "service_role";



GRANT ALL ON TABLE "public"."position_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."position_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."position_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."positions" TO "anon";
GRANT ALL ON TABLE "public"."positions" TO "authenticated";
GRANT ALL ON TABLE "public"."positions" TO "service_role";



GRANT ALL ON TABLE "public"."public_profiles" TO "anon";
GRANT ALL ON TABLE "public"."public_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."public_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."reconciliation_reports" TO "anon";
GRANT ALL ON TABLE "public"."reconciliation_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reconciliation_reports" TO "service_role";



GRANT ALL ON TABLE "public"."relationship_documents" TO "anon";
GRANT ALL ON TABLE "public"."relationship_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."relationship_documents" TO "service_role";



GRANT ALL ON TABLE "public"."resend_message_correlation" TO "anon";
GRANT ALL ON TABLE "public"."resend_message_correlation" TO "authenticated";
GRANT ALL ON TABLE "public"."resend_message_correlation" TO "service_role";



GRANT ALL ON SEQUENCE "public"."resend_message_correlation_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."resend_message_correlation_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."resend_message_correlation_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."scenario_commit_idempotency" TO "anon";
GRANT ALL ON TABLE "public"."scenario_commit_idempotency" TO "authenticated";
GRANT ALL ON TABLE "public"."scenario_commit_idempotency" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_analytics" TO "anon";
GRANT ALL ON TABLE "public"."strategy_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_analytics_series" TO "anon";
GRANT ALL ON TABLE "public"."strategy_analytics_series" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_analytics_series" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_verifications" TO "anon";
GRANT ALL ON TABLE "public"."strategy_verifications" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_verifications" TO "service_role";



GRANT ALL ON TABLE "public"."system_flags" TO "anon";
GRANT ALL ON TABLE "public"."system_flags" TO "authenticated";
GRANT ALL ON TABLE "public"."system_flags" TO "service_role";



GRANT ALL ON TABLE "public"."token_price_history" TO "anon";
GRANT ALL ON TABLE "public"."token_price_history" TO "authenticated";
GRANT ALL ON TABLE "public"."token_price_history" TO "service_role";



GRANT ALL ON TABLE "public"."trades" TO "anon";
GRANT ALL ON TABLE "public"."trades" TO "authenticated";
GRANT ALL ON TABLE "public"."trades" TO "service_role";



GRANT ALL ON TABLE "public"."used_ack_tokens" TO "anon";
GRANT ALL ON TABLE "public"."used_ack_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."used_ack_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."user_app_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_app_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_app_roles" TO "service_role";



GRANT ALL ON TABLE "public"."user_favorites" TO "anon";
GRANT ALL ON TABLE "public"."user_favorites" TO "authenticated";
GRANT ALL ON TABLE "public"."user_favorites" TO "service_role";



GRANT ALL ON TABLE "public"."user_notes" TO "anon";
GRANT ALL ON TABLE "public"."user_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."user_notes" TO "service_role";



GRANT ALL ON TABLE "public"."verification_requests" TO "anon";
GRANT ALL ON TABLE "public"."verification_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_requests" TO "service_role";



GRANT ALL ON TABLE "public"."weight_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."weight_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."weight_snapshots" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































