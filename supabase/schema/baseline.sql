


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
    RAISE EXCEPTION '_enqueue_compute_job_internal: exactly one of p_strategy_id or p_portfolio_id must be non-null (got strategy=%, portfolio=%)',
      p_strategy_id, p_portfolio_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_kind IS NULL THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: p_kind is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Phase 106 D3: the compute_analytics kind is retired. The registry + CHECKs
  -- still admit it (45 historical rows FK-reference it); this is an RPC-level
  -- admission reject only — no enqueue path remains.
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind compute_analytics is retired (Phase 106) — no enqueue path remains'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- P12: rows with unfulfilled parents start as done_pending_children
  -- so the fan-in advancement loop in mark_compute_job_done picks them
  -- up. Leaf rows (no parents) start as pending per the column DEFAULT.
  IF p_parent_job_ids IS NOT NULL
     AND array_length(p_parent_job_ids, 1) IS NOT NULL
     AND array_length(p_parent_job_ids, 1) > 0 THEN
    v_initial_status := 'done_pending_children';
  ELSE
    v_initial_status := 'pending';
  END IF;

  -- Optimistic path: existing in-flight job for this (target, kind).
  -- The optimistic SELECT covers all three in-flight statuses; the
  -- partial unique index agrees on this set so a winner inserted with
  -- done_pending_children is also caught here.
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

  -- Race-safe insert. The partial unique index catches any concurrent
  -- INSERT with the same (target, kind) and leaves v_new_id NULL.
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

  -- Lost the race. Re-read the winner's row. Plain SELECT INTO (NOT
  -- STRICT) because between the conflict and the re-read the winner
  -- may have advanced past the in-flight statuses (done / failed_*).
  -- That's a legitimate race outcome — the original SELECT INTO STRICT
  -- raised NO_DATA_FOUND with no domain-specific message and surfaced
  -- as an opaque 500 to the user-facing request. (P3)
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
    -- Winner already advanced past in-flight. Tell the caller this
    -- was a race loss with a recoverable error code so the app layer
    -- can retry the enqueue without surfacing a 500. ERRCODE
    -- 'serialization_failure' is the canonical Postgres class for
    -- "MVCC race, retry safe".
    RAISE EXCEPTION '_enqueue_compute_job_internal: enqueue race lost and winner already terminal (target strategy=%, portfolio=%, kind=%)',
      p_strategy_id, p_portfolio_id, p_kind
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$$;


ALTER FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid" DEFAULT NULL::"uuid", "p_api_key_id" "uuid" DEFAULT NULL::"uuid", "p_run_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $_$
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

  -- Phase 106 D3: the compute_analytics kind is retired. The registry + CHECKs
  -- still admit it (45 historical rows FK-reference it); this is an RPC-level
  -- admission reject only — no enqueue path remains.
  IF p_kind = 'compute_analytics' THEN
    RAISE EXCEPTION '_enqueue_compute_job_internal: kind compute_analytics is retired (Phase 106) — no enqueue path remains'
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

  -- Lost the race — re-read the winner's row. Plain SELECT INTO, because
  -- between the conflict and the re-read the winner may have advanced past
  -- the in-flight statuses (done / failed_*). That is a legitimate race
  -- outcome, but the strict re-read this replaced raised NO_DATA_FOUND with
  -- no domain-specific message and surfaced as an opaque 500 to the
  -- user-facing request. (Phase 163 OPS-08; the 7-param overload got the same
  -- treatment as mig 109 P3 — this is parity, not a new policy.)
  IF p_strategy_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE strategy_id = p_strategy_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_portfolio_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE portfolio_id = p_portfolio_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSIF p_allocator_id IS NOT NULL THEN
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE allocator_id = p_allocator_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  ELSE
    SELECT id INTO v_new_id
      FROM compute_jobs
     WHERE api_key_id = p_api_key_id
       AND kind = p_kind
       AND status IN ('pending', 'running', 'done_pending_children')
     LIMIT 1;
  END IF;

  IF v_new_id IS NULL THEN
    -- Winner already advanced past in-flight. Classify the outcome: ERRCODE
    -- serialization_failure (40001) is the canonical Postgres class for "MVCC
    -- race, retry safe", and the SQLSTATE is the WHOLE signal. A caller that
    -- wants to retry branches on the code, never on this string.
    --
    -- ⛔ THIS MESSAGE IS OPERATOR TEXT AND IT STILL REACHES A USER-VISIBLE
    -- COLUMN. An earlier version of this note said the remedy was to keep the
    -- message SHORT. That is the WRONG PROPERTY and the phase-163 review
    -- (WR-07) was right to say so: the property that matters is NOT OPERATOR
    -- JARGON, and shortness does not deliver it.
    --
    -- The path, re-measured at HEAD 2026-08-26 (the old note's :2012 was
    -- stale):
    --   src/app/api/strategies/csv-finalize/route.ts:2035 builds
    --     `compute job enqueue failed: ${enqueueErrMessage}`
    --   then writeFailedStrategyAnalyticsPlaceholder (:1868) writes it to
    --   strategy_analytics.computation_error (:1928), which renders VERBATIM
    --   to the strategy's OWNER in the wizard failure envelope.
    --
    -- ⚠️ AND THAT PREFIX IS BUILT ON THE TS SIDE, UNCONDITIONALLY, with no
    -- SQLSTATE branch in front of it. So NO message this function can raise
    -- keeps operator jargon out of that column: the user reads "compute job
    -- enqueue failed: ..." whatever follows the colon. SQL can choose WHICH
    -- jargon appears; it cannot remove jargon. Rewording this string into
    -- curated user copy would be cosmetic, and it would additionally push user
    -- copy into the operator log line for the allocator / portfolio / api_key
    -- callers, which are not user-facing at all. The fix is a TS change, and it
    -- HAS LANDED (2026-08-26): csv-finalize now branches on SQLSTATE 40001 and
    -- writes curated copy instead of prefixing this sentence. So this string
    -- stays operator-shaped ON PURPOSE and is now correct to do so — the user
    -- no longer reads it, while the allocator / portfolio / api_key callers
    -- still get the precise operator wording they need.
    --
    -- What the old note got RIGHT, and what therefore stays: naming the
    -- internal SECDEF function and the four internal UUIDs here would make the
    -- leak strictly worse, and nothing diagnostic is lost by omitting them —
    -- the caller already knows which target it asked for, and the server log's
    -- CONTEXT line still names this function for operators.
    RAISE EXCEPTION 'enqueue race lost: the winning job already advanced past the in-flight statuses'
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_new_id;
END;
$_$;


ALTER FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_enqueue_compute_job_internal"("p_strategy_id" "uuid", "p_portfolio_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) IS 'Private shared implementation of the idempotent enqueue pattern. Handles all four target scopes (strategy / portfolio / allocator / api_key) via 4-way XOR on the four id parameters. Extended in migration 066 for api_key scope + scheduled run_at. ACL re-asserted by migration 118. Rejects the retired compute_analytics kind with invalid_parameter_value (Phase 106 D3). Race-loser re-read uses a plain SELECT INTO on all four arms; if the winner already advanced past the in-flight statuses, raises serialization_failure so the caller can retry vs. surfacing a 500 (Phase 163 OPS-08, parity with the 7-param overload''s mig 109 P3 fix).';



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
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    -- audit-2026-05-07 B9 (NEW-C18-02/-03): canonical range [0, 100]
    -- matching bridge_outcomes_percent_allocated_range_check
    -- (mig 20260514045553) and route Zod in scenario/commit/route.ts.
    IF v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,100]', p_index, v_pct
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
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,100]', p_index, v_pct
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
    BEGIN
      v_pct := v_pct_text::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% is not a valid numeric', p_index, v_pct_text
        USING ERRCODE = '22023';
    END;
    IF v_pct < 0 OR v_pct > 100 THEN
      RAISE EXCEPTION 'commit_scenario_batch[index=%]: percent_allocated=% out of range [0,100]', p_index, v_pct
        USING ERRCODE = '22023';
    END IF;

  ELSE
    -- Defensive: enum cast above should have caught this.
    RAISE EXCEPTION 'commit_scenario_batch[index=%]: unhandled kind=%', p_index, v_kind
      USING ERRCODE = '22023';
  END IF;
END;
$$;


ALTER FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."_validate_scenario_diff"("p_diff" "jsonb", "p_index" integer) IS 'Per-diff validator for commit_scenario_batch. Raises 22023 with a commit_scenario_batch[index=N]: <reason> message. audit-2026-05-07 B9 (NEW-C18-02/-03) — percent ranges reconciled to [0, 100] matching bridge_outcomes_percent_allocated_range_check + route Zod. The prior [0, 1] guard was stale latent code that would have 500ed every legitimate request the moment the helper was wired into commit_scenario_batch.';



CREATE OR REPLACE FUNCTION "public"."add_wizard_composite_key"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_jwt_role TEXT;
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- See the single-key twin for the full rationale: fail-closed wrapper, the
  -- rejected width of the log_audit_event_service precedent, Trap B (why
  -- auth.uid() is ABSENT rather than relaxed — it is a permanent silent no-op
  -- under service_role) and Trap C (never current_user in a DEFINER body).
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'add_wizard_composite_key: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'add_wizard_composite_key: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Idempotency fence for the DRAFT only (ONB-03: the per-KEY add proceeds).
  -- DISTINCT 'wizcomposite:' lock space so the single-key 'wizdraft:' fence is
  -- untouched.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizcomposite:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- The composite draft is the (user, session) strategies row with a NULL
  -- api_key_id (the single-key link is NEVER set for a composite). If none
  -- exists yet, create it. A single-key draft for the same session (api_key_id
  -- set) does NOT match this predicate, so we fall through to INSERT and trip
  -- strategies_user_wizard_session_uniq (23505 → the route maps it loud).
  SELECT s.id
    INTO v_strategy_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NULL
   LIMIT 1;

  IF v_strategy_id IS NULL THEN
    -- Mirrors create_wizard_strategy's strategies INSERT column-for-column
    -- EXCEPT api_key_id, which is omitted so it stays NULL for the composite.
    INSERT INTO strategies (
      user_id, name, status, source,
      strategy_types, subtypes, markets, supported_exchanges,
      wizard_session_id
    )
    VALUES (
      p_user_id, p_placeholder_name, 'draft', 'wizard',
      '{}', '{}', '{}', ARRAY[p_exchange],
      p_wizard_session_id
    )
    RETURNING id INTO v_strategy_id;
  END IF;

  -- ALWAYS mint a fresh encrypted api_keys row (this IS the per-key add).
  -- 153.6 / PARITY-04: attested_venue stamped from the caller-supplied
  -- p_exchange, exactly as in the single-key twin — and from the SAME parameter
  -- as `exchange`, which api_keys_attested_venue_matches_exchange requires.
  -- The CR-01 status recorded in §1 applies here unchanged.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange
  )
  RETURNING id INTO v_key_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;


ALTER FUNCTION "public"."add_wizard_composite_key"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."add_wizard_composite_key"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") IS 'Wizard composite per-key writer. ⭐ 156/Migration B (20260814120000): SERVICE_ROLE ONLY, the single-key twin''s gate verbatim — authenticated EXECUTE is REVOKED, the in-body gate is auth.role() IS DISTINCT FROM ''service_role'', and there is NO auth.uid() check (it would be a permanent silent no-op under service_role). The two functions are ONE CONTRACT WITH TWO ENTRY POINTS and 153.6 exists because a fix landed on only one of them: change one, change both, in the same migration.';



CREATE OR REPLACE FUNCTION "public"."admin_role_mutate"("p_actor_id" "uuid", "p_target_id" "uuid", "p_role" "text", "p_action" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_actor_is_admin   BOOLEAN;
  v_target_exists    BOOLEAN;
  v_role_is_admin    BOOLEAN := (p_role = 'admin');
  v_was_new_grant    BOOLEAN := FALSE;
  v_removed_rows     INT     := 0;
  v_was_is_admin     BOOLEAN := FALSE;
  v_is_admin_changed BOOLEAN := FALSE;
  v_surviving_admins INT;
  v_outcome          TEXT;
  v_holds_role       BOOLEAN;
  v_took_effect      BOOLEAN;
  v_roles            TEXT[];
BEGIN
  -- ── Parameter validation (22023 → 400; defensive — body is Zod-validated) ──
  IF p_actor_id IS NULL OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'admin_role_mutate: p_actor_id and p_target_id are required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_action NOT IN ('grant', 'revoke') THEN
    RAISE EXCEPTION 'admin_role_mutate: p_action must be grant|revoke, got %', p_action
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  -- Keep this CHECK list in lockstep with user_app_roles.role (migration 054)
  -- and APP_ROLES (src/lib/auth.ts).
  IF p_role NOT IN ('admin', 'allocator', 'quant_manager', 'analyst') THEN
    RAISE EXCEPTION 'admin_role_mutate: p_role % is not a known app role', p_role
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── Serialize every mutation on this target (closes the JS TOCTOU window).
  -- A xact-scoped advisory lock (auto-released at COMMIT/ROLLBACK) namespaced to
  -- this function so it never collides with another advisory-lock user. The
  -- last-admin count + the dual-store write below are now race-free against a
  -- concurrent grant/revoke on the same target. ──────────────────────────────
  PERFORM pg_advisory_xact_lock(hashtext('admin_role_mutate'), hashtext(p_target_id::text));

  -- ── Fresh actor authz — the SAME union isAdminUser uses (is_admin OR a
  -- user_app_roles 'admin' row). Re-checked inside the locked txn so an actor
  -- demoted after withRole('admin') ran is rejected here (defense-in-depth that
  -- also makes the JS fresh-client re-check redundant). ──────────────────────
  SELECT (
    EXISTS (SELECT 1 FROM profiles       WHERE id      = p_actor_id AND is_admin = TRUE)
    OR
    EXISTS (SELECT 1 FROM user_app_roles WHERE user_id = p_actor_id AND role    = 'admin')
  ) INTO v_actor_is_admin;
  IF NOT v_actor_is_admin THEN
    RAISE EXCEPTION 'admin_role_mutate: actor % is not an admin', p_actor_id
      USING ERRCODE = 'insufficient_privilege';  -- 42501 → 403
  END IF;

  -- ── Self-revoke of admin is forbidden — another admin must act. Matches the
  -- route's prior hard rail; hint lets the route pick the specific 403 message. ─
  IF p_action = 'revoke' AND v_role_is_admin AND p_actor_id = p_target_id THEN
    RAISE EXCEPTION 'admin_role_mutate: an admin cannot revoke their own admin role'
      USING ERRCODE = 'insufficient_privilege',  -- 42501 → 403
            HINT    = 'self_revoke_forbidden';
  END IF;

  -- ── Target must exist (mirror GET's 404 user_not_found contract). ──────────
  SELECT EXISTS (SELECT 1 FROM profiles WHERE id = p_target_id) INTO v_target_exists;
  IF NOT v_target_exists THEN
    RAISE EXCEPTION 'admin_role_mutate: target user % does not exist', p_target_id
      USING ERRCODE = 'no_data_found';  -- P0002 → 404
  END IF;

  -- Capture the primary-flag pre-state for the admin path (ghost-admin clear).
  IF v_role_is_admin THEN
    SELECT COALESCE(is_admin, FALSE) INTO v_was_is_admin FROM profiles WHERE id = p_target_id;
  END IF;

  IF p_action = 'grant' THEN
    -- Idempotent row insert. ROW_COUNT after ON CONFLICT DO NOTHING is 1 iff a
    -- row was actually inserted → that IS "was_new_grant" (no separate pre-read,
    -- and no TOCTOU on it — we hold the advisory lock).
    INSERT INTO user_app_roles (user_id, role, granted_by, granted_at)
    VALUES (p_target_id, p_role, p_actor_id, now())
    ON CONFLICT (user_id, role) DO NOTHING;
    GET DIAGNOSTICS v_removed_rows = ROW_COUNT;
    v_was_new_grant := (v_removed_rows = 1);

    -- Dual-store lockstep: an admin grant also asserts the primary flag, so a
    -- granted admin can never be a row-only admin. Non-admin grants leave
    -- is_admin alone (there is no profile flag for those roles).
    IF v_role_is_admin AND NOT v_was_is_admin THEN
      UPDATE profiles SET is_admin = TRUE WHERE id = p_target_id;
      v_is_admin_changed := TRUE;
    END IF;

    v_outcome := 'granted';

  ELSE  -- p_action = 'revoke'
    IF v_role_is_admin THEN
      -- Last-admin guard: count the DEDUP'd UNION of surviving admins across
      -- BOTH stores, excluding the target. UNION (not two summed counts) so a
      -- single survivor holding both signals counts once — the exact H-02 bug.
      SELECT COUNT(*) INTO v_surviving_admins FROM (
        SELECT id      AS uid FROM profiles       WHERE is_admin = TRUE  AND id      <> p_target_id
        UNION
        SELECT user_id AS uid FROM user_app_roles WHERE role     = 'admin' AND user_id <> p_target_id
      ) survivors;
      IF v_surviving_admins = 0 THEN
        RAISE EXCEPTION 'admin_role_mutate: refusing to revoke the last admin account'
          USING ERRCODE = 'check_violation',  -- 23514 → 409
                HINT    = 'would_orphan_last_admin';
      END IF;
    END IF;

    DELETE FROM user_app_roles WHERE user_id = p_target_id AND role = p_role;
    GET DIAGNOSTICS v_removed_rows = ROW_COUNT;

    -- Admin revoke also clears the primary flag — so a ghost-admin (is_admin
    -- TRUE, no row) is fully demoted even though the DELETE removed 0 rows.
    IF v_role_is_admin AND v_was_is_admin THEN
      UPDATE profiles SET is_admin = FALSE WHERE id = p_target_id;
      v_is_admin_changed := TRUE;
    END IF;

    -- No-op ⇔ nothing changed in EITHER store. For admin, clearing is_admin
    -- counts as a real revoke even with 0 rows removed.
    IF v_removed_rows = 0 AND NOT v_is_admin_changed THEN
      v_outcome := 'revoke_noop';  -- → 404 role_not_held (caller does NOT emit role.revoke)
    ELSE
      v_outcome := 'revoked';
    END IF;
  END IF;

  -- ── Took-effect verify: re-read inside the same txn (post-mutation reality). ─
  SELECT EXISTS (
    SELECT 1 FROM user_app_roles WHERE user_id = p_target_id AND role = p_role
  ) INTO v_holds_role;
  -- For admin the held-state must also reflect the primary flag.
  IF v_role_is_admin THEN
    v_holds_role := v_holds_role OR EXISTS (
      SELECT 1 FROM profiles WHERE id = p_target_id AND is_admin = TRUE
    );
  END IF;

  IF p_action = 'grant' THEN
    v_took_effect := v_holds_role;        -- after a grant the role should be held
  ELSIF v_outcome = 'revoked' THEN
    v_took_effect := NOT v_holds_role;    -- after a revoke the role should be gone
  ELSE
    v_took_effect := TRUE;                -- revoke_noop: nothing to take effect
  END IF;

  -- Post-mutation full role set — same shape the route's fetchUserRoles returned
  -- (user_app_roles only; the CHECK constraint already bounds role to AppRole).
  SELECT COALESCE(array_agg(role ORDER BY role), ARRAY[]::TEXT[])
    INTO v_roles
  FROM user_app_roles WHERE user_id = p_target_id;

  RETURN jsonb_build_object(
    'outcome',          v_outcome,
    'was_new_grant',    v_was_new_grant,
    'removed_rows',     v_removed_rows,
    'is_admin_changed', v_is_admin_changed,
    'holds_role',       v_holds_role,
    'took_effect',      v_took_effect,
    'roles',            to_jsonb(v_roles)
  );
END;
$$;


ALTER FUNCTION "public"."admin_role_mutate"("p_actor_id" "uuid", "p_target_id" "uuid", "p_role" "text", "p_action" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."admin_role_mutate"("p_actor_id" "uuid", "p_target_id" "uuid", "p_role" "text", "p_action" "text") IS 'Atomic admin RBAC mutation (B4). SECURITY DEFINER, service_role-only EXECUTE. Does the dual-store (profiles.is_admin + user_app_roles) write under a per-target pg_advisory_xact_lock with fresh actor authz, dedup-UNION last-admin guard, and took-effect verify — all in one transaction. Returns jsonb (see migration header). The ONLY sanctioned admin-mutation path; a future admin route must call this.';



CREATE OR REPLACE FUNCTION "public"."advance_sync_cursor"("p_api_key_id" "uuid", "p_job_id" "uuid", "p_claim_token" "uuid" DEFAULT NULL::"uuid", "p_last_fetched_ts" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_last_sync_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_account_balance" numeric DEFAULT NULL::numeric) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'advance_sync_cursor: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- NEW-C12-05 ownership fence. Only active when a token is supplied; the
  -- NULL arm preserves the legacy unconditional-write path (see header).
  IF p_claim_token IS NOT NULL THEN
    IF p_job_id IS NULL THEN
      RAISE EXCEPTION 'advance_sync_cursor: p_job_id is required when p_claim_token is supplied'
        USING ERRCODE = 'invalid_parameter_value';
    END IF;

    IF NOT EXISTS (
      SELECT 1
        FROM compute_jobs
       WHERE id = p_job_id
         AND status = 'running'
         AND claim_token = p_claim_token
    ) THEN
      -- Orphan: the watchdog reclaimed this job (status no longer 'running'
      -- or token rotated to W2). Drop the epilogue write rather than race the
      -- owner. Caller distinguishes FALSE (owned-check failed) from an
      -- exception (DB error) and logs the orphan-blocked signal.
      RETURN FALSE;
    END IF;
  END IF;

  -- Owned (or back-compat NULL arm): apply the monotonic-guarded write in a
  -- single atomic UPDATE. Each timestamp advances only when strictly newer
  -- (defence-in-depth that survives even when the fence is inert); the
  -- balance has no ordering so it is overwritten when supplied.
  UPDATE api_keys
     SET last_fetched_trade_timestamp = CASE
           WHEN p_last_fetched_ts IS NOT NULL
                AND (last_fetched_trade_timestamp IS NULL
                     OR last_fetched_trade_timestamp < p_last_fetched_ts)
             THEN p_last_fetched_ts
             ELSE last_fetched_trade_timestamp
           END,
         last_sync_at = CASE
           WHEN p_last_sync_at IS NOT NULL
                AND (last_sync_at IS NULL OR last_sync_at < p_last_sync_at)
             THEN p_last_sync_at
             ELSE last_sync_at
           END,
         account_balance_usdt = COALESCE(p_account_balance, account_balance_usdt)
   WHERE id = p_api_key_id;

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."advance_sync_cursor"("p_api_key_id" "uuid", "p_job_id" "uuid", "p_claim_token" "uuid", "p_last_fetched_ts" timestamp with time zone, "p_last_sync_at" timestamp with time zone, "p_account_balance" numeric) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."advance_sync_cursor"("p_api_key_id" "uuid", "p_job_id" "uuid", "p_claim_token" "uuid", "p_last_fetched_ts" timestamp with time zone, "p_last_sync_at" timestamp with time zone, "p_account_balance" numeric) IS 'Fenced sync_trades epilogue cursor/balance write. NEW-C12-05 (CL12): when p_claim_token is supplied, verifies the caller still owns the compute_job (status=running AND claim_token match) and RETURNS FALSE writing nothing if a watchdog reclaim handed the job to another worker; the NULL arm preserves the legacy unconditional write for the deploy window / WORKER_FENCE_V2 off. Monotonic guards re-applied inside one atomic UPDATE. Worker is sole caller (services/job_worker.run_sync_trades_job). See migrations 117 + 20260529170000.';



CREATE OR REPLACE FUNCTION "public"."api_key_cooldown_remaining"("p_api_key_id" "uuid", "p_cooldown_seconds" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_last_429_at TIMESTAMPTZ;
  v_remaining   NUMERIC;
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'api_key_cooldown_remaining: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_cooldown_seconds IS NULL OR p_cooldown_seconds < 0 THEN
    RAISE EXCEPTION 'api_key_cooldown_remaining: p_cooldown_seconds must be >= 0, got %', p_cooldown_seconds
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT last_429_at
    INTO v_last_429_at
    FROM api_keys
    WHERE id = p_api_key_id;

  -- No stamp (or key gone) → no active cooldown.
  IF NOT FOUND OR v_last_429_at IS NULL THEN
    RETURN 0;
  END IF;

  -- Both now() and last_429_at are DB-clock values → no cross-container
  -- wall-clock skew. CEIL so we never under-report and release the breaker a
  -- fraction early.
  v_remaining := p_cooldown_seconds - EXTRACT(EPOCH FROM (now() - v_last_429_at));
  IF v_remaining <= 0 THEN
    RETURN 0;
  END IF;
  RETURN CEIL(v_remaining)::INTEGER;
END;
$$;


ALTER FUNCTION "public"."api_key_cooldown_remaining"("p_api_key_id" "uuid", "p_cooldown_seconds" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."api_key_cooldown_remaining"("p_api_key_id" "uuid", "p_cooldown_seconds" integer) IS 'NEW-C12-10 (CL10): returns remaining circuit-breaker cooldown seconds (0 if expired / no stamp / key missing) computed ENTIRELY with the DB clock (now() - last_429_at), so a stamp written by one Railway replica and a check run on another are compared against one clock — eliminating the wall-clock-skew window where the breaker released early into a 429 storm. Paired with stamp_api_key_429. Service-role worker only.';



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
    CONSTRAINT "compute_jobs_error_kind_check" CHECK (("error_kind" = ANY (ARRAY['transient'::"text", 'permanent'::"text", 'unknown'::"text", 'orphaned'::"text"]))),
    CONSTRAINT "compute_jobs_exchange_check" CHECK ((("exchange" IS NULL) OR ("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text", 'deribit'::"text", 'sfox'::"text", 'mt5'::"text"])))),
    CONSTRAINT "compute_jobs_idempotency_key_safe" CHECK ((("idempotency_key" IS NULL) OR (("length"("idempotency_key") <= 128) AND ("idempotency_key" ~ '^[A-Za-z0-9_:.-]+$'::"text")))),
    CONSTRAINT "compute_jobs_kind_check" CHECK (("kind" = ANY (ARRAY['sync_trades'::"text", 'compute_analytics'::"text", 'compute_portfolio'::"text", 'poll_positions'::"text", 'sync_funding'::"text", 'reconcile_strategy'::"text", 'compute_intro_snapshot'::"text", 'rescore_allocator'::"text", 'poll_allocator_positions'::"text", 'reconstruct_allocator_history'::"text", 'refresh_allocator_equity_daily'::"text", 'process_key_long'::"text", 'compute_analytics_from_csv'::"text", 'derive_broker_dailies'::"text", 'stitch_composite'::"text", 'derive_allocator_equity'::"text"]))),
    CONSTRAINT "compute_jobs_kind_target_coherence" CHECK (((("kind" = 'compute_portfolio'::"text") AND ("portfolio_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'rescore_allocator'::"text") AND ("allocator_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL)) OR (("kind" = ANY (ARRAY['sync_trades'::"text", 'compute_analytics'::"text", 'poll_positions'::"text", 'sync_funding'::"text", 'reconcile_strategy'::"text", 'compute_intro_snapshot'::"text", 'compute_analytics_from_csv'::"text", 'derive_broker_dailies'::"text", 'stitch_composite'::"text"])) AND ("strategy_id" IS NOT NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'poll_allocator_positions'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'reconstruct_allocator_history'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'refresh_allocator_equity_daily'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'derive_broker_dailies'::"text") AND ("api_key_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL)) OR (("kind" = 'process_key_long'::"text") AND ("strategy_id" IS NOT NULL) AND ("portfolio_id" IS NULL) AND ("allocator_id" IS NULL) AND ("api_key_id" IS NULL)) OR (("kind" = 'derive_allocator_equity'::"text") AND ("allocator_id" IS NOT NULL) AND ("strategy_id" IS NULL) AND ("portfolio_id" IS NULL) AND ("api_key_id" IS NULL)))),
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



COMMENT ON COLUMN "public"."compute_jobs"."error_kind" IS 'Structured failure classification, and the ONLY thing user-facing copy may be derived from (the free-text diagnosis lives in last_error, which is operator-only). transient = retryable, retried automatically up to max_attempts. permanent = do not retry, terminalise immediately. unknown = unclassified; retried like transient. orphaned = the WORKER DIED holding the claim, so the job never reached a verdict — written ONLY by the retention_compute_jobs_orphaned_running reaper''s direct UPDATE, never by mark_compute_job_failed, which still refuses any kind outside the first three so a handler can never classify its own failure as a worker death. orphaned is RETRYABLE: nothing readmits these jobs on the live-API path (the 20260819130500 sweep is csv-only and is additionally blocked once computation_status reads failed), so the user retrying is the only mechanism, and both computation_error_copy and get_user_compute_jobs.user_message tell them so. Before mig 20260826140000 the reaper wrote permanent and both surfaces told those users that retrying would not help. See migrations 20260411144407 + 20260817120000 + 20260826120000 + 20260826140000.';



COMMENT ON COLUMN "public"."compute_jobs"."idempotency_key" IS 'Optional caller-supplied correlation key (e.g. wizard-submit-<ulid>). NOT enforced at the DB level at all. Real idempotency is provided by the partial unique indexes on (strategy_id, kind) and (portfolio_id, kind), which guarantee only one in-flight row per target+kind. idempotency_key is purely for client-side correlation and appears in logs and admin UI.';



COMMENT ON COLUMN "public"."compute_jobs"."exchange" IS 'Exchange name for sync_trades kind (binance/okx/bybit). NULL for compute_analytics and compute_portfolio. Used by observability queries and the per-exchange circuit breaker. Value space is enforced by the CHECK constraint on the column.';



COMMENT ON COLUMN "public"."compute_jobs"."trade_count" IS 'Populated by sync_trades workers after a successful fetch. NULL for pending/running jobs and for non-sync_trades kinds. Observability only — not referenced by any state-machine logic.';



COMMENT ON COLUMN "public"."compute_jobs"."allocator_id" IS 'Allocator scope for the rescore_allocator kind. Mirrors the existing strategy_id/portfolio_id pattern — exactly one of the three target columns is non-null per compute_jobs_target_xor. Phase 3 / D-12 Option B.';



COMMENT ON COLUMN "public"."compute_jobs"."api_key_id" IS 'API key scope for the poll_allocator_positions kind (INGEST-02). One allocator can have N keys; each key gets its own polling cadence + circuit-breaker state. Phase 06.';



COMMENT ON COLUMN "public"."compute_jobs"."priority" IS 'Dispatch priority. low = post-deploy backfill (throttled to 5/min when normal/high pending). normal = live sync_trades + first-class compute_analytics. high = manual force-recompute. Read by claim_compute_jobs_with_priority(). See migration 086.';



COMMENT ON COLUMN "public"."compute_jobs"."claim_token" IS 'audit-2026-05-07 P97 / G12.A.2 — fencing token written by claim_compute_jobs[_with_priority] on every claim and NULLed by reset_stalled_compute_jobs on every reclaim. mark_compute_job_done and mark_compute_job_failed verify p_claim_token matches before flipping. See migration 117.';



COMMENT ON CONSTRAINT "compute_jobs_attempts_non_negative" ON "public"."compute_jobs" IS 'audit-2026-05-07 M-0772 / G10: bound attempts >= 0 so the backoff CASE schedule in mark_compute_job_failed cannot be tricked by a negative-value INSERT/UPDATE.';



COMMENT ON CONSTRAINT "compute_jobs_claimed_by_safe" ON "public"."compute_jobs" IS 'audit-2026-05-07 H-0857. Bound claimed_by to <=128 chars and a safe charset. Defense-in-depth against a future REVOKE relaxation that would let any caller impersonate any worker_id via claim_compute_jobs[_with_priority].';



COMMENT ON CONSTRAINT "compute_jobs_kind_check" ON "public"."compute_jobs" IS 'Simple list-form kind admission check. 2026-07-18: extended with derive_allocator_equity (allocator-scoped compose of the P115 derivation core onto allocator_equity_derived). Re-based on 20260710130000.';



COMMENT ON CONSTRAINT "compute_jobs_kind_target_coherence" ON "public"."compute_jobs" IS 'Kind<->target-type coherence. 2026-07-18: derive_allocator_equity added to a new allocator-scoped arm (allocator_id NOT NULL). Preserves the 20260624120100/20260710130000 dual-target derive_broker_dailies api_key arm — copying an older def would silently drop it and break key-mode allocator derives.';



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
           -- H-1238: append `, id` to every row_number() ORDER BY for a
           -- deterministic tie-break when two rows share next_attempt_at.
           row_number() OVER (PARTITION BY kind, portfolio_id ORDER BY next_attempt_at, id) AS rn_p,
           row_number() OVER (PARTITION BY kind, strategy_id  ORDER BY next_attempt_at, id) AS rn_s,
           row_number() OVER (PARTITION BY kind, allocator_id ORDER BY next_attempt_at, id) AS rn_a,
           row_number() OVER (PARTITION BY kind, api_key_id   ORDER BY next_attempt_at, id) AS rn_k
    FROM compute_jobs
    WHERE status IN ('pending', 'failed_retry')
      AND next_attempt_at <= now()
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id  IS NULL OR rn_p = 1)
      -- H-1235: carve-out for compute_intro_snapshot. The partial unique
      -- index `compute_jobs_one_inflight_per_kind_strategy` (mig 048)
      -- excludes this kind via `kind <> 'compute_intro_snapshot'`, so
      -- multiple intro_snapshot rows sharing a strategy_id (different
      -- allocators) can legitimately coexist. Without this carve-out the
      -- dedupe forces sequential drain — slowing the queue with no
      -- 23505 risk to prevent.
      AND (strategy_id   IS NULL OR kind = 'compute_intro_snapshot' OR rn_s = 1)
      AND (allocator_id  IS NULL OR rn_a = 1)
      AND (api_key_id    IS NULL OR rn_k = 1)
      -- C39 / NEW-C39-01 (preserved verbatim from
      -- 20260526100000_claim_dedupe_done_pending_children_guard.sql):
      -- exclude candidates whose partition already has an inflight (running
      -- or done_pending_children) row. Without this guard a failed_retry
      -- row can coexist with a done_pending_children row for the same
      -- (kind, partition_col) and the batch UPDATE that flips failed_retry
      -- → running violates the partial unique index (23505). Per-partition
      -- column; NULL partition columns are skipped.
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
         claim_token = gen_random_uuid(),   -- mig 117: P97 fence
         last_error  = NULL,                -- M-1137/M-1138: clear the prior attempt's
         error_kind  = NULL                 -- error on a failed_retry -> running re-claim
   WHERE id IN (
     SELECT cj.id FROM compute_jobs cj
      WHERE cj.id IN (SELECT id FROM deduped)
        AND cj.status IN ('pending', 'failed_retry')  -- H-1/M-1: re-check status after CTE snapshot+lock to guard against concurrent status transitions
      -- F-2: append `, cj.id` so the inner ordering is fully deterministic
      -- at the LIMIT boundary. The row_number() windows above already
      -- tie-break on id (H-1238); without this clause two candidates that
      -- tie on next_attempt_at could swap which one survives the
      -- LIMIT p_batch_size cut across pg restarts/vacuums.
      ORDER BY cj.next_attempt_at, cj.id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_compute_jobs"("p_batch_size" integer, "p_worker_id" "text") IS 'Atomically claims up to N ready-to-run jobs (status IN pending/failed_retry, next_attempt_at <= now()) for a worker. Migration 090 dedupes by partition keys; migration 117 adds claim_token = gen_random_uuid() (P97 fence); C39 (20260526100000) added the done_pending_children NOT-EXISTS guard; H-1235/H-1238 + F-2 added the compute_intro_snapshot carve-out and the `, id` tie-break. THIS migration (M-1137/M-1138): clears last_error/error_kind on a failed_retry -> running re-claim so a re-claimed row no longer carries the prior attempt error. See migrations 032, 089, 090, 117, C39.';



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



CREATE OR REPLACE FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean DEFAULT NULL::boolean, "p_kind_include" "text"[] DEFAULT NULL::"text"[], "p_kind_exclude" "text"[] DEFAULT NULL::"text"[]) RETURNS SETOF "public"."compute_jobs"
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

  -- M-1133: throttle probe as a `CASE WHEN EXISTS (...) THEN 1 ELSE 0 END`
  -- short-circuit (EXISTS returns boolean, never NULL, so the 0/1 semantics
  -- for `v_high_pending = 0` are preserved by construction). 2026-06-01:
  -- the status set now mirrors the base RPC — a high/normal-priority job
  -- sitting in `failed_retry` (due) is still pending work and MUST trip the
  -- throttle, otherwise the throttle under-counts the priority backlog and
  -- lets low-priority backfill through while priority retries wait.
  --
  -- FLIPRETRY-02: the SAME kind filter that scopes the claim SELECT is
  -- applied here so a filtered worker only throttles on kinds it can claim.
  v_high_pending := CASE WHEN EXISTS (
    SELECT 1
      FROM compute_jobs
     WHERE priority IN ('normal','high')
       AND status IN ('pending', 'failed_retry')
       AND next_attempt_at <= now()
       AND (p_kind_include IS NULL OR kind = ANY(p_kind_include))
       AND (p_kind_exclude IS NULL OR NOT (kind = ANY(p_kind_exclude)))
  ) THEN 1 ELSE 0 END;

  -- Partition-key dedupe preserved from mig 117 (which restored mig 090's
  -- shape after mig 104 silently dropped it). H-1238: every row_number()
  -- ORDER BY now ends with `, id` for a deterministic tie-break when
  -- priority + next_attempt_at both tie.
  RETURN QUERY
  WITH ranked AS (
    SELECT id, kind, priority, portfolio_id, strategy_id, allocator_id, api_key_id,
           next_attempt_at,
           row_number() OVER (
             PARTITION BY kind, portfolio_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_p,
           row_number() OVER (
             PARTITION BY kind, strategy_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_s,
           row_number() OVER (
             PARTITION BY kind, allocator_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_a,
           row_number() OVER (
             PARTITION BY kind, api_key_id
             ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                      next_attempt_at,
                      id
           ) AS rn_k
    FROM compute_jobs
    -- 2026-06-01: restore failed_retry candidacy (regressed by mig
    -- 20260528061155 STEP 2; base claim_compute_jobs always had it).
    WHERE status IN ('pending', 'failed_retry')
      AND (next_attempt_at IS NULL OR next_attempt_at <= now())
      AND (v_high_pending = 0 OR priority IN ('normal','high'))
      -- FLIPRETRY-02: kind filter. NULL/NULL => byte-identical to prod today.
      AND (p_kind_include IS NULL OR kind = ANY(p_kind_include))
      AND (p_kind_exclude IS NULL OR NOT (kind = ANY(p_kind_exclude)))
  ),
  deduped AS (
    SELECT id FROM ranked
    WHERE (portfolio_id IS NULL OR rn_p = 1)
      -- H-1235: compute_intro_snapshot carve-out — the partial unique index
      -- `compute_jobs_one_inflight_per_kind_strategy` (mig 048) excludes
      -- that kind, so per-allocator intro_snapshot rows sharing a strategy
      -- can co-claim without violating the inflight index.
      AND (strategy_id  IS NULL OR kind = 'compute_intro_snapshot' OR rn_s = 1)
      AND (allocator_id IS NULL OR rn_a = 1)
      AND (api_key_id   IS NULL OR rn_k = 1)
      -- C39 / NEW-C39-01 (ported verbatim from `claim_compute_jobs`, which
      -- inherited it from 20260526100000_claim_dedupe_done_pending_children_guard.sql):
      -- exclude candidates whose partition already has an inflight (running
      -- or done_pending_children) row. Now that failed_retry is claimable
      -- again (above), without this guard a failed_retry row can coexist
      -- with a done_pending_children / running row for the same
      -- (kind, partition_col) and the batch UPDATE that flips failed_retry
      -- -> running violates the partial unique index (23505). Per-partition
      -- column; NULL partition columns are skipped.
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
         claim_token = gen_random_uuid(),   -- mig 117: P97 fence
         last_error  = NULL,                -- M-1137/M-1138: clear the prior attempt's
         error_kind  = NULL,                -- error on a failed_retry -> running re-claim
         -- Phase 19 / mig 104 D-1: preserve unified_backbone_at_claim on
         -- watchdog re-claim. COALESCE keeps the original snapshot if it
         -- was set on a prior claim, otherwise stamps the live flag.
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
        -- H-1/M-1: re-check status after CTE snapshot+lock to guard against
        -- concurrent status transitions between candidate selection and the
        -- FOR UPDATE (ported from claim_compute_jobs).
        AND cj.status IN ('pending', 'failed_retry')
      -- F-2: append `, cj.id` so the inner ordering is fully deterministic
      -- at the LIMIT boundary (matches the row_number() OVER tie-break above).
      ORDER BY
        CASE cj.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        cj.next_attempt_at,
        cj.id
      LIMIT p_batch_size
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END;
$$;


ALTER FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean, "p_kind_include" "text"[], "p_kind_exclude" "text"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean, "p_kind_include" "text"[], "p_kind_exclude" "text"[]) IS 'Migration 117 P97 fence + Phase-19 metadata snapshot + H-1235 carve-out + H-1238 `, id` tie-break + M-1133 CASE/EXISTS throttle + 2026-06-01 restored failed_retry candidacy and C39 done_pending_children guard + M-1137/M-1138 last_error/error_kind clear on re-claim. FLIPRETRY-02 (Phase 123): adds p_kind_include / p_kind_exclude (both DEFAULT NULL => byte-identical to the 3-arg prod behavior) applied to BOTH the v_high_pending throttle probe AND the claim SELECT so a dedicated backfill worker claims ONLY backfill kinds and the interactive prod worker excludes them. All pre-existing guarantees preserved verbatim (asserted by the two signature-pinned CI SQL gates).';



CREATE OR REPLACE FUNCTION "public"."cleanup_abandoned_wizard_drafts"() RETURNS TABLE("deleted_drafts" integer, "swept_keys" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE v_candidate_keys uuid[];
BEGIN
  -- 1. Capture composite member key ids BEFORE the CASCADE removes strategy_keys.
  SELECT array_agg(DISTINCT sk.api_key_id)
    INTO v_candidate_keys
    FROM strategy_keys sk
    JOIN strategies s ON s.id = sk.strategy_id
   WHERE s.source='wizard' AND s.status='draft' AND s.review_note IS NULL
     AND s.created_at < now() - interval '7 days';

  -- 2. Atomic single DELETE of the drafts; RETURNING adds single-key api_key_ids.
  WITH doomed AS (
    DELETE FROM strategies
     WHERE source='wizard' AND status='draft' AND review_note IS NULL
       AND created_at < now() - interval '7 days'
     RETURNING id, api_key_id
  )
  SELECT count(*)::int,
         COALESCE(v_candidate_keys, '{}') || COALESCE(array_remove(array_agg(api_key_id), NULL), '{}')
    INTO deleted_drafts, v_candidate_keys
    FROM doomed;

  -- 3. Reference-complete, RESTRICT-safe sweep (published-composite guard never fires:
  --    the NOT EXISTS strategy_keys clause is a strict superset of the guard's
  --    published-only protected set).
  WITH swept AS (
    DELETE FROM api_keys k
     WHERE k.id = ANY(v_candidate_keys)
       AND NOT EXISTS (SELECT 1 FROM strategies        s  WHERE s.api_key_id  = k.id)
       AND NOT EXISTS (SELECT 1 FROM strategy_keys     sk WHERE sk.api_key_id = k.id)
       AND NOT EXISTS (SELECT 1 FROM allocator_holdings h WHERE h.api_key_id = k.id)
     RETURNING 1
  )
  SELECT count(*)::int INTO swept_keys FROM swept;
  RETURN NEXT;
END $$;


ALTER FUNCTION "public"."cleanup_abandoned_wizard_drafts"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."cleanup_abandoned_wizard_drafts"() IS 'CLEAN-01 + CLEAN-02: atomically DELETE abandoned wizard drafts (source=wizard, status=draft, review_note IS NULL, created_at < now() - 7 days — LOCKED 7d policy reconciling the 24h ROADMAP text with Phase-94 resumability, 96-VALIDATION decision 1) and sweep their now-orphaned api_keys in ONE transaction. Member keys are captured BEFORE the strategy_keys CASCADE; the sweep spares any key still referenced by strategies.api_key_id, strategy_keys, or allocator_holdings (the last avoids a 23503 RESTRICT abort). Never sets the sanitize GUC; never reuses the composite-blind single-axis orphan-revoke RPC. service_role only (cron).';



CREATE OR REPLACE FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_request_hash" "text" DEFAULT NULL::"text", "p_portfolio_fingerprint" "text" DEFAULT NULL::"text") RETURNS "jsonb"
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
  -- B11 / NEW-C18-10: server- and client-side holdings fingerprint token sets.
  v_server_fp_tokens  text[];
  v_client_fp_tokens  text[];
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

  -- (3b) audit-2026-05-07 B11 / NEW-C18-10 — optimistic-concurrency
  -- precondition. When the caller supplies p_portfolio_fingerprint (the
  -- init_holdings_fingerprint the client built the scenario draft against),
  -- recompute the CURRENT holdings fingerprint server-side and reject if the
  -- SET of holding tokens diverges — the portfolio changed under the draft
  -- (position cron refreshed a snapshot, another tab/device edited) → the
  -- frozen diffs would write outcomes against a stale shape (lost-update).
  --
  -- The token format MIRRORS computeHoldingsFingerprint (scenario-state.ts):
  -- symbol-first "symbol:venue:holding_type", latest-asof-per-(venue,symbol,
  -- holding_type) to match the client dedup, and NO value_usd filter (the
  -- client fingerprint includes value_usd<=0 latest rows; the ownership
  -- probe's value_usd>0 is WRONG here). We do NOT reproduce the client's JS
  -- localeCompare sort (no Postgres collation is byte-identical to it):
  -- instead we compare the order-invariant token SET, sorting BOTH sides with
  -- the SAME COLLATE "C" so equality is set equality, collation-independent.
  -- Runs on the fresh path only (a cached replay short-circuits at (2) before
  -- here, so a network retry of an already-committed batch is not re-checked
  -- against now-changed holdings).
  IF p_portfolio_fingerprint IS NOT NULL THEN
    SELECT COALESCE(array_agg(tok ORDER BY tok COLLATE "C"), ARRAY[]::text[])
      INTO v_server_fp_tokens
      FROM (
        SELECT DISTINCT ON (ah.venue, ah.symbol, ah.holding_type)
               ah.symbol || ':' || ah.venue || ':' || ah.holding_type AS tok
          FROM allocator_holdings ah
         WHERE ah.allocator_id = p_allocator_id
         ORDER BY ah.venue, ah.symbol, ah.holding_type, ah.asof DESC
      ) latest;

    v_client_fp_tokens := COALESCE(
      (SELECT array_agg(t ORDER BY t COLLATE "C")
         FROM unnest(string_to_array(p_portfolio_fingerprint, '|')) AS t
        WHERE t <> ''),
      ARRAY[]::text[]
    );

    IF v_server_fp_tokens IS DISTINCT FROM v_client_fp_tokens THEN
      -- Roll back the fresh in-flight reservation (if any) so a retry with
      -- the same Idempotency-Key isn't wedged 'in_flight'; the commit never
      -- happened. Return an ok:false envelope the route maps to 409 (reload),
      -- mirroring the IDEM_CODES contract.
      IF p_idempotency_key IS NOT NULL THEN
        DELETE FROM scenario_commit_idempotency
         WHERE allocator_id    = p_allocator_id
           AND idempotency_key = p_idempotency_key;
      END IF;
      RETURN jsonb_build_object(
        'ok', false,
        'errors', jsonb_build_array(jsonb_build_object(
          'index', -1,
          'error', 'Portfolio holdings changed since this scenario draft was created',
          'code', 'portfolio_fingerprint_stale'
        ))
      );
    END IF;
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

  -- (5) mig 131 idempotency-cache UPDATE — replace placeholder with
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


ALTER FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text", "p_portfolio_fingerprint" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text", "p_portfolio_fingerprint" "text") IS 'audit-2026-05-07 H-0974 / H-0976 / H-0977 + mig 131 idempotency dedup + B11 NEW-C18-10 portfolio-fingerprint precondition. SECURITY DEFINER RPC that commits a batch of <=50 scenario diffs in a single Postgres transaction. auth.uid() = p_allocator_id guard. Per-row ownership probe with asof + value_usd > 0 filter (mig 128 P1957). voluntary_modify uses single canonical percent_allocated encoding (mig 128 P1956). Idempotency-Key reservation lives in the same tx as the data inserts (mig 131). When p_portfolio_fingerprint is supplied, the CURRENT latest-asof holdings token set is recompared against it (order-invariant, COLLATE "C", no value_usd filter) and a divergence returns ok:false code=portfolio_fingerprint_stale (route -> 409). On success, emits one scenario.commit audit_log row attributed to the allocator (fail-soft).';



CREATE OR REPLACE FUNCTION "public"."computation_error_copy"("p_error_kind" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO 'pg_catalog'
    AS $$
  -- CANARY_162_F3_PROSE_ONLY — this token appears ONLY here, in a comment, and
  -- nowhere in this function's code. supabase/tests/
  -- test_compute_jobs_error_kind_copy_parity.sql strips comments out of
  -- pg_get_functiondef before matching the CASE arms below, and uses this token
  -- to prove the stripper actually ran — otherwise "the stripper worked" and
  -- "there was nothing to strip" are the same observation, and a prose mention
  -- of WHEN 'somekind' THEN could stand in for a real arm. ⛔ Do not delete it
  -- to tidy up: that gate goes RED, on purpose (the F-5 lesson from the sibling
  -- migration 20260826130000, where deleting the canary silently DISARMED the
  -- check that depended on it).
  SELECT CASE p_error_kind
    -- 'permanent' terminalises on the FIRST failure (mark_compute_job_failed:
    -- `IF p_error_kind = 'permanent' THEN v_new_status := 'failed_final'`), so
    -- no automatic retry has happened and none is coming. Promising a retry
    -- here would be the thing that is false.
    WHEN 'permanent' THEN
      'Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed.'
    -- 'transient' and 'unknown' SHARE an arm, and the sameness is the honest
    -- part. Neither reaches 'failed_final' except through
    -- `v_attempts >= v_max_attempts`, so the one true statement about both is
    -- that the automatic retries were used up. Splitting them would spend two
    -- sentences implying a difference the user cannot act on.
    WHEN 'transient' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
    WHEN 'unknown' THEN
      'Analytics could not complete after several automatic retries. Retry the sync, or contact support if it keeps failing.'
    -- 'orphaned' — the WORKER DIED holding the claim; the job itself never
    -- reached a verdict. Written ONLY by the hourly reaper
    -- (retention_compute_jobs_orphaned_running, re-registered by mig
    -- 20260826140000), never by mark_compute_job_failed, which still refuses
    -- any kind outside transient/permanent/unknown — so this arm is reachable
    -- from exactly one writer.
    --
    -- ⛔ THIS ARM IS RETRY-POSITIVE AND THAT IS THE WHOLE POINT. An orphan is
    -- retryable BY DEFINITION: nothing about the strategy failed, a process
    -- went away. Before 20260826140000 the reaper wrote 'permanent', so these
    -- users were told "retrying alone will not resolve it" — affirmatively
    -- false, and not self-healing either: the dropped-enqueue readmit sweep
    -- (20260819130500) only covers strategies with csv_daily_returns rows, so
    -- live-API strategies are outside it entirely, and once the bridge writes
    -- computation_status = 'failed' that sweep's own
    -- NOT EXISTS (... computation_status IN (...,'failed')) conjunct blocks
    -- readmit permanently. Telling the user to retry is the ONLY thing that
    -- gets the work done.
    WHEN 'orphaned' THEN
      'Analytics stopped before it finished because the process running it went away. Nothing is wrong with this strategy — retry the sync.'
    -- Anything else: NULL, or a kind added after this migration. Says only what
    -- is true of every failure and claims nothing about retries.
    ELSE
      'Analytics could not complete for this strategy. Retry the sync, or contact support if this persists.'
  END
$$;


ALTER FUNCTION "public"."computation_error_copy"("p_error_kind" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."computation_error_copy"("p_error_kind" "text") IS 'User-facing copy for strategy_analytics.computation_error, derived from compute_jobs.error_kind. Phase 162 / HONEST-01. Takes a KIND, never an error string: the range is four fixed literals, so nothing that goes in can come out. permanent -> will not resolve by retrying; transient/unknown -> automatic retries exhausted (they reach failed_final only via v_attempts >= v_max_attempts, so they share the one statement that is true of both); orphaned -> the worker died holding the claim, so the job never reached a verdict and the failure IS retryable (retry-positive copy, added with mig 20260826140000 which widens compute_jobs_error_kind_check and re-registers the hourly reaper to write it; before that the reaper wrote permanent and told those users that retrying would not help, which was false); anything else, including NULL -> a cautious default that claims nothing about retries. The raw diagnosis stays on compute_jobs.last_error, which is operator-only and is NOT read by sync_strategy_analytics_status. Mirrors analytics-service/services/allocator_positions.py sync_error_copy.';



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



CREATE OR REPLACE FUNCTION "public"."create_scenario_share"("p_scenario_id" "uuid", "p_token_hash" "text") RETURNS "uuid"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_share_id UUID;
BEGIN
  -- Revoke any prior active share for this scenario. RLS scopes this to the
  -- caller's own rows (created_by = auth.uid()); a scenario the caller does not
  -- own matches 0 rows. This and the INSERT below are in ONE transaction.
  UPDATE scenario_shares
     SET revoked_at = now()
   WHERE scenario_id = p_scenario_id
     AND revoked_at IS NULL;

  -- Insert the new active share. created_by is auth.uid() (never a param), so
  -- the RLS WITH CHECK (created_by = auth.uid() AND the caller owns the
  -- scenario) gates it; a non-owned scenario raises here and rolls back the
  -- revoke above — the prior link is NOT left dead with no replacement.
  INSERT INTO scenario_shares (scenario_id, created_by, token_hash)
  VALUES (p_scenario_id, auth.uid(), p_token_hash)
  RETURNING id INTO v_share_id;

  RETURN v_share_id;
END;
$$;


ALTER FUNCTION "public"."create_scenario_share"("p_scenario_id" "uuid", "p_token_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_scenario_share"("p_scenario_id" "uuid", "p_token_hash" "text") IS 'Phase 25 / SHARE-01 (WR-02). ATOMIC revoke-prior + insert-new share for a scenario in ONE transaction so a failed insert never leaves the scenario with zero active shares. SECURITY INVOKER — RLS gates it as the caller; created_by is auth.uid() inside the body (never a parameter). Returns the new share row id. The route hashes the token in Node (Plan 25-02) and passes the precomputed sha256 hex.';



CREATE OR REPLACE FUNCTION "public"."create_strategy_share"("p_strategy_id" "uuid") RETURNS TABLE("generation" bigint, "nonce" "uuid")
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- ⛔ FAIL LOUD for a caller with no authenticated identity (founder ruling
  -- 2026-08-27). SECURITY INVOKER + RLS is the ownership wall here, and RLS
  -- DOES NOT APPLY to a BYPASSRLS role — `service_role`, which is exactly what
  -- `createAdminClient()` connects as, and the recipient lane already uses an
  -- admin client against this table (STEP 2).
  --
  -- MEASURED (PostgreSQL 16), so the rationale is not guesswork: without this
  -- guard a service_role call raises `23502 null value in column "created_by"`
  -- — ExecConstraints checks NOT NULL on the proposed tuple BEFORE speculative
  -- insertion, so the ON CONFLICT DO UPDATE path is never reached and an
  -- existing revoked row is NOT reactivated. The NOT NULL column therefore
  -- happens to block the cross-tenant resurrection today. ⚠️ That is an
  -- INCIDENTAL save, not a designed one: it evaporates the moment `created_by`
  -- becomes nullable or a future overload accepts it as a parameter. And 23502
  -- reads as "some database hiccup", not "you called this wrong" — the route
  -- would log a constraint error and nobody would learn that an admin client
  -- must never take this path. The guard converts an accident into a contract.
  -- (Contrast revoke_strategy_share, where the missing guard was NOT
  -- incidental: it revoked another tenant's live share and returned 1.)
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'create_strategy_share: no authenticated user — not callable by a service-role/admin client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_strategy_id IS NULL THEN
    RAISE EXCEPTION 'create_strategy_share: p_strategy_id must not be NULL'
      USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Atomic reactivate-or-insert. ⛔ generation is deliberately ABSENT from the
  -- DO UPDATE SET list: reactivation must NOT rewind the counter, or every
  -- previously revoked link would come back to life. created_by/created_at are
  -- likewise never rewritten — the row keeps its original provenance.
  --
  -- ⛔⛔ `nonce` MUST NOT APPEAR IN THE COLUMN LIST OR THE DO UPDATE SET LIST,
  -- and this is a HARD constraint rather than a style note. STEP 2 grants
  -- `authenticated` INSERT on (strategy_id, created_by) only; PostgreSQL checks
  -- column privilege against the columns a statement NAMES, so the instant this
  -- statement names `nonce` this SECURITY INVOKER function starts failing 42501
  -- for every ordinary owner — and the "obvious fix" is to widen the grant,
  -- which re-opens the resurrection family. The nonce is populated by its column
  -- DEFAULT and read back through RETURNING (which needs only SELECT). STEP 6
  -- arm (ii-d) fails the apply if this ever changes.
  INSERT INTO public.strategy_shares (strategy_id, created_by)
  VALUES (p_strategy_id, auth.uid())
  ON CONFLICT (strategy_id) DO UPDATE
    SET revoked_at = NULL
  RETURNING strategy_shares.generation, strategy_shares.nonce
       INTO create_strategy_share.generation, create_strategy_share.nonce;

  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."create_strategy_share"("p_strategy_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_strategy_share"("p_strategy_id" "uuid") IS 'Phase 164 / SHARE-01. Atomic mint-or-reuse of a strategy share. Returns (generation, nonce); the caller derives the token as HMAC(SHARE_TOKEN_SECRET, over the tag "qz.strategy-share.v1" then strategy_id then nonce then generation) in Node — nothing token-derived is ever stored. ⛔ The body must never NAME `nonce` in the INSERT column list or the DO UPDATE SET list: STEP 2 grants authenticated INSERT on (strategy_id, created_by) only, and naming the column would make this SECURITY INVOKER function fail 42501 for every owner. It is DEFAULT-populated and read back via RETURNING. Idempotent while the share is live (the same generation AND the same nonce return the same url, which is what makes Copy Link reuse work). Reactivating a revoked share clears revoked_at WITHOUT rewinding generation, created_by or created_at, so revoked links stay dead. SECURITY INVOKER — RLS gates it as the caller and created_by is auth.uid() inside the body. ⛔ RAISES insufficient_privilege when auth.uid() IS NULL. RLS does not apply to a BYPASSRLS role; without the guard such a caller gets an opaque 23502 on created_by (measured — the NOT NULL blocks the ON CONFLICT reactivation incidentally, and would stop doing so if created_by ever became nullable). Not callable by a service-role/admin client, by design.';



CREATE OR REPLACE FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid", "p_venue_account_id" "text" DEFAULT NULL::"text") RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_jwt_role TEXT;
  v_key_id UUID;
  v_strategy_id UUID;
BEGIN
  -- ⭐ FINAL GATE (Phase 156 Migration B). Migration A's `authenticated` arm is
  -- DELETED. Only service_role may write a wizard draft.
  --
  -- Fail-closed wrapper carried from
  -- `20260515113753_log_audit_event_service_hardened.sql:130-160`: a malformed
  -- request.jwt.claims makes auth.role() RAISE rather than return NULL. NULL
  -- then fails the IS DISTINCT FROM test and is REFUSED.
  --
  -- ⛔ THE WIDTH OF THAT PRECEDENT IS REJECTED. log_audit_event_service admits
  -- `auth.role() IN ('authenticated','service_role')` at 20260515113753:148.
  -- `authenticated` is THE EXACT CALLER THIS PHASE EXISTS TO LOCK OUT; admitting
  -- it here would make this layer a permanent no-op, so that a future GRANT leak
  -- would pass BOTH layers. Carry that file's auth.role() choice, its fail-closed
  -- wrapper, its self-contained REVOKE/GRANT and its body canary. Reject its
  -- width. (156-PATTERNS.md §1; Rule 7 — pick one, say why, never average.)
  --
  -- ⛔ TRAP B — WHY auth.uid() IS ABSENT RATHER THAN RELAXED. `156-MEASUREMENTS.md`
  -- § A2 MEASURED auth.uid() IS NULL for a service_role client. So a "relaxed"
  -- comparison kept for safety — `IF v_auth_uid IS NOT NULL AND v_auth_uid <>
  -- p_user_id` — would be a PERMANENT SILENT NO-OP: the ownership check vanishes
  -- with no error, no 42501, and no test failure. Deleting it is HONEST; keeping
  -- a decorative one is the `_assert_owner` shape at 20260411144407:300-302 that
  -- this phase must not reproduce. Post-verify (e) below aborts the apply if the
  -- literal `auth.uid()` reappears in either body.
  --
  -- ⛔ TRAP C — NEVER current_user / session_user. Inside a SECURITY DEFINER body
  -- current_user is the OWNER, so a gate written on it ALWAYS PASSES — the bug
  -- that made `prevent_profile_role_change` a no-op (20260811210000:518-523,
  -- 20260411103316:313-321). session_user is `authenticator` for every PostgREST
  -- request. auth.role() reads the JWT claim, which is the thing we mean.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- auth.uid() is NULL under service_role, so p_user_id is the ONLY carrier of
  -- the owning identity and a NULL would silently mint an ownerless draft.
  -- Refuse it explicitly rather than let the FK or a later read decide.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy: p_user_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- F6 (H-0304/H-0311/H-0186): idempotency fence. Serialize concurrent calls
  -- carrying the same wizard_session_id on a transaction-scoped advisory lock
  -- (auto-released on commit/rollback; advisory locks are not subject to
  -- lock_timeout), then return any draft already created for this
  -- (user, session) instead of minting a duplicate strategies + api_keys pair.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizdraft:' || p_user_id::text || ':' || p_wizard_session_id::text)
  );

  -- Only replay a COMPLETE draft (api_key_id present). If an orphaned draft
  -- exists for this session with a NULL api_key_id (its api_keys row was deleted
  -- out from under it via the ON DELETE SET NULL FK), do NOT hand back a NULL
  -- key — fall through so the INSERT trips strategies_user_wizard_session_uniq
  -- (23505 → the route's recoverable DRAFT_ALREADY_EXISTS 409) instead of
  -- returning a NULL api_key_id the route would reject with a permanent 500
  -- (red-team MEDIUM-1: route fence requires api_key_id; the two must agree).
  SELECT s.id, s.api_key_id
    INTO v_strategy_id, v_key_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.wizard_session_id = p_wizard_session_id
     AND s.api_key_id IS NOT NULL
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    RETURN QUERY SELECT v_strategy_id, v_key_id;
    RETURN;
  END IF;

  -- 153.6 / PARITY-04: attested_venue is stamped HERE, inside the SECURITY
  -- DEFINER body, which is the only kind of writer whose value survives the
  -- api_keys_scrub_attested_venue trigger.
  -- ⛔ p_exchange IS STILL CALLER-SUPPLIED AND STILL NOT VALIDATED HERE. Both
  -- columns are written from that ONE parameter deliberately: the CHECK
  -- api_keys_attested_venue_matches_exchange requires it, so this INSERT cannot
  -- mint an attestation that disagrees with the routing label.
  --
  -- ⭐ CR-01 STATUS UNDER MIGRATION B: CLOSED for the browser, BOUNDED for us.
  -- `authenticated` no longer holds EXECUTE (§3), so the direct-RPC path is shut
  -- and the only callers are our two routes, which pass the venue the server
  -- observed a successful read-only authentication at. The residual that REMAINS
  -- is the service_role trust boundary itself — see header ⛔ (iii). Do not read
  -- this as "the venue cannot be forged".
  --
  -- 154 / WIZCONT-02: venue_account_id is stamped here for the same structural
  -- reason. ⛔ It is NOT coupled to p_exchange and must not be: it identifies an
  -- ACCOUNT WITHIN a venue, not the venue. It is NULL for every venue that
  -- exposes no stable non-secret account id, which is every ccxt venue today,
  -- and the partial index excludes those rows.
  -- ⛔ Do not "fix" it by adding validation here — the value has no in-database
  -- oracle to check against, and a plausible-looking check would hide the residual.
  --
  -- ⭐ NORMALISED AT THE STAMP SITE: btrim, then blank → NULL. (1) Without btrim,
  -- ' 5551234' and '5551234' are DIFFERENT index keys, so a stray space from the
  -- form makes the dedup MISS entirely. (2) Without the NULLIF, an unset field
  -- arriving as '' would be stored as a non-NULL value the partial index governs,
  -- colliding two GENUINELY DIFFERENT accounts — api_keys_venue_account_id_nonblank
  -- would REFUSE that INSERT with 23514, which the wizard route has no handler
  -- for. Keep this expression and the CHECK in agreement.
  INSERT INTO api_keys (
    user_id, exchange, label,
    api_key_encrypted, api_secret_encrypted, passphrase_encrypted,
    dek_encrypted, nonce, kek_version, is_active,
    attested_venue, venue_account_id
  )
  VALUES (
    p_user_id, p_exchange, p_label,
    p_api_key_encrypted, p_api_secret_encrypted, p_passphrase_encrypted,
    p_dek_encrypted, p_nonce, COALESCE(p_kek_version, 1), TRUE,
    p_exchange, NULLIF(btrim(p_venue_account_id), '')
  )
  RETURNING id INTO v_key_id;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, v_key_id, p_placeholder_name, 'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[p_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, v_key_id;
END;
$$;


ALTER FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid", "p_venue_account_id" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid", "p_venue_account_id" "text") IS 'Atomic, idempotent api_keys + strategies (source=wizard, status=draft) insert. SECURITY DEFINER — guard_wizard_draft_updates allows the write via the current_user shift, and both api_keys scrub triggers admit the owner. F6: a per-(user, wizard_session_id) advisory lock + select-existing fence dedups double-submits to one draft (audit H-0304/H-0311/H-0186); strategies_user_wizard_session_source_uniq is the backstop. 153.6/PARITY-04: stamps attested_venue from p_exchange (the coupling CHECK api_keys_attested_venue_matches_exchange requires the two to agree). 154/WIZCONT-02: stamps venue_account_id from p_venue_account_id, NORMALISED as NULLIF(btrim(...), '''') so a stray space cannot make the dedup miss and a blank field cannot become an identity. ⭐ 156/Migration B (20260814120000): SERVICE_ROLE ONLY — authenticated EXECUTE is REVOKED and the in-body gate is auth.role() IS DISTINCT FROM ''service_role''. There is NO auth.uid() check and its absence is deliberate: auth.uid() IS NULL under service_role, so a retained comparison would be a permanent silent no-op. Ownership is bound at the route (p_user_id is withAuth''s getUser()-verified user.id, ADR-0022). ⛔ p_venue_account_id is STILL NOT VALIDATED here — only the server can pass it now, but the value has no in-database oracle, so it remains "what the server passed", not "what the venue confirmed". ⛔ EXACTLY ONE OVERLOAD OF THIS FUNCTION MAY EXIST: PostgREST resolves rpc() by named parameters and answers PGRST203 if a second candidate appears, which breaks connect-a-key for every user. Add parameters by DROP + CREATE (WITH RE-ISSUED GRANTS — see the migration header, pg_default_acl re-grants anon and authenticated on DROP), never by CREATE OR REPLACE. See migrations 031, 126, 127, 20260602190000, 20260811210000, 20260812083206, 20260813150106.';



CREATE OR REPLACE FUNCTION "public"."create_wizard_strategy_for_key"("p_user_id" "uuid", "p_api_key_id" "uuid", "p_placeholder_name" "text", "p_wizard_session_id" "uuid") RETURNS TABLE("strategy_id" "uuid", "api_key_id" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_jwt_role TEXT;
  v_exchange TEXT;
  v_strategy_id UUID;
BEGIN
  -- CANARY_162_05_PROSE_ONLY — see header (vii). This token lives in a comment
  -- and nowhere else in this body; the gate's arm D requires it to be GONE from
  -- the comment-stripped definition, which is what proves the stripper ran.

  -- ── gate 1: service_role only. Fail-closed wrapper carried from
  -- 20260515113753 and from the twin at 20260814120000: a malformed
  -- request.jwt.claims makes auth.role() RAISE rather than return NULL, and
  -- NULL then fails the IS DISTINCT FROM test and is REFUSED.
  BEGIN
    v_jwt_role := auth.role();
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'create_wizard_strategy_for_key: caller role (%) may not write wizard drafts',
      COALESCE(v_jwt_role, '<none>')
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── gate 2: auth.uid() is NULL under service_role, so p_user_id is the ONLY
  -- carrier of the owning identity and a NULL would make the ownership
  -- assertion below compare against nothing. Refuse it explicitly.
  IF p_user_id IS NULL OR p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'create_wizard_strategy_for_key: p_user_id and p_api_key_id must not be NULL'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- ── the idempotency fence, copied from create_wizard_strategy's discipline
  -- but keyed on the KEY rather than on the wizard session, and that difference
  -- is the point. The population this path serves LOST its localStorage session
  -- token (that is how the key was orphaned in the first place), so a
  -- session-keyed fence would let every retry mint another draft over the same
  -- key. A transaction-scoped advisory lock is auto-released on commit/rollback
  -- and is not subject to lock_timeout. DISTINCT 'wizreuse:' lock space so the
  -- 'wizdraft:' and 'wizcomposite:' fences are untouched.
  PERFORM pg_advisory_xact_lock(
    hashtext('wizreuse:' || p_user_id::text || ':' || p_api_key_id::text)
  );

  -- ── gate 3: THE OWNERSHIP ASSERTION. This is the in-database half of the
  -- T-162-05-A mitigation; the route's session-uid `.eq("user_id", …)` filter on
  -- the admin client and its user-scoped RLS re-read are the other two layers.
  -- Cross-tenant reuse requires all three to fail at once.
  --
  -- ⭐ `disconnected_at IS NULL` IS PART OF THE ASSERTION, NOT A NICETY.
  -- api_keys rows are RETAINED on disconnect (20260422101911) and every cron
  -- dispatcher deliberately SKIPS a soft-disconnected key, so a draft minted
  -- over one would be a strategy that silently never syncs — the exact defect
  -- the venue-identity fence's mirrored predicate exists to prevent.
  --
  -- ⭐ AND THE VENUE COMES OUT OF THE ROW, NOT OFF THE WIRE. create_wizard_strategy
  -- takes p_exchange from the caller because it is minting the api_keys row and
  -- has nowhere else to get it. Here the row already exists and carries the
  -- venue this server observed a successful read-only authentication at, so this
  -- function has NO venue parameter at all and cannot be handed a forged one.
  -- That is a strictly narrower surface than the twin's, by construction.
  SELECT k.exchange
    INTO v_exchange
    FROM api_keys k
   WHERE k.id = p_api_key_id
     AND k.user_id = p_user_id
     AND k.disconnected_at IS NULL;

  IF NOT FOUND THEN
    -- ⛔ ONE ANSWER FOR "not yours", "does not exist" and "disconnected",
    -- deliberately: three distinguishable refusals would be an ownership oracle
    -- for anyone holding the service key, and the route maps this SQLSTATE to a
    -- single refusal for the same reason.
    RAISE EXCEPTION 'create_wizard_strategy_for_key: no live api_keys row for this owner'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- ── replay: an existing wizard draft over this key IS the answer. Returned
  -- before the connected check below, because a draft is a strategy and would
  -- otherwise be refused as "already connected" on the second call.
  SELECT s.id
    INTO v_strategy_id
    FROM strategies s
   WHERE s.user_id = p_user_id
     AND s.api_key_id = p_api_key_id
     AND s.source = 'wizard'
     AND s.status = 'draft'
   ORDER BY s.created_at ASC
   LIMIT 1;

  IF v_strategy_id IS NOT NULL THEN
    RETURN QUERY SELECT v_strategy_id, p_api_key_id;
    RETURN;
  END IF;

  -- ── gate 4: the CONNECTED refusal. Something already uses this key, so it is
  -- not an orphan and minting a second strategy over it would duplicate the
  -- user's own account across two strategies — the defect WIZCONT-02's fence
  -- exists to prevent, arriving through a different door.
  --
  -- ⭐ `strategy_keys` IS CHECKED TOO, AND THE ROUTE'S TWO-READ RESOLVER CANNOT
  -- SEE IT. A composite member key is linked through `strategy_keys`, while
  -- `strategies.api_key_id` stays NULL on the composite draft — so the route's
  -- `orphaned` measurement (both strategies reads empty) reports a live
  -- composite member as an orphan. That is a pre-existing property of that
  -- resolver, and it is why this assertion is here rather than only there: this
  -- is the last line before the INSERT.
  --
  -- ⛔ NEITHER EXISTS IS SCOPED TO p_user_id, deliberately. The key is already
  -- proven to belong to p_user_id above, so a row referencing it from any owner
  -- is either the same tenant's or a data fault — and in both cases the honest
  -- answer is "something holds this key", not "nothing does".
  IF EXISTS (SELECT 1 FROM strategies s WHERE s.api_key_id = p_api_key_id)
     OR EXISTS (SELECT 1 FROM strategy_keys sk WHERE sk.api_key_id = p_api_key_id)
  THEN
    RAISE EXCEPTION 'create_wizard_strategy_for_key: api key % is already held by a strategy', p_api_key_id
      USING ERRCODE = 'object_in_use';
  END IF;

  -- ── the write. Mirrors create_wizard_strategy's `strategies` INSERT
  -- column-for-column; the api_keys INSERT that sits above it there has no
  -- counterpart here and must never gain one (header ⛔ (i)).
  INSERT INTO strategies (
    user_id, api_key_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, p_api_key_id,
    COALESCE(NULLIF(btrim(p_placeholder_name), ''), 'Untitled strategy'),
    'draft', 'wizard',
    '{}', '{}', '{}', ARRAY[v_exchange],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  RETURN QUERY SELECT v_strategy_id, p_api_key_id;
END;
$$;


ALTER FUNCTION "public"."create_wizard_strategy_for_key"("p_user_id" "uuid", "p_api_key_id" "uuid", "p_placeholder_name" "text", "p_wizard_session_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."create_wizard_strategy_for_key"("p_user_id" "uuid", "p_api_key_id" "uuid", "p_placeholder_name" "text", "p_wizard_session_id" "uuid") IS 'Phase 162 / D-162-3. Mints a wizard DRAFT strategy over an EXISTING api_keys row the caller already owns, so an orphaned key can be finished instead of being refused forever. ⛔ It NEVER writes api_keys — that is a property of this body''s text, not of a branch, and re-INSERTing there would reproduce the orphan it exists to resolve. service_role-only EXECUTE plus an in-body auth.role() gate plus an in-body ownership assertion joining api_keys.user_id to p_user_id and requiring disconnected_at IS NULL. ⛔ THE CEILING: p_user_id is a parameter, so this verifies that the key belongs to the uid the server passed — NOT that the uid is the real caller. That is the standing service_role trust boundary (ADR-0001/ADR-0003), accepted as T-162-05-E, not a defect this function can close. Recurring enforcement lives in supabase/tests/test_create_wizard_strategy_for_key.sql, which strips comments from pg_get_functiondef before every token match because that function returns comments and a prose-satisfied anchor would pass with the code gone.';



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



CREATE OR REPLACE FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text" DEFAULT NULL::"text", "p_claim_token" "uuid" DEFAULT NULL::"uuid") RETURNS timestamp with time zone
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_current_attempts INTEGER;
  v_next_attempt     TIMESTAMPTZ;
  v_current_status   TEXT;
  v_current_token    UUID;
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

  -- NEW-C12-06 claim-token fence (mirrors mark_compute_job_done, mig 117).
  -- Lock and read the running row, requiring the token to match when one is
  -- supplied. Deferring a non-running job doesn't make sense and would
  -- silently corrupt state if we let it through.
  SELECT attempts
    INTO v_current_attempts
    FROM compute_jobs
    WHERE id = p_job_id
      AND status = 'running'
      AND (p_claim_token IS NULL OR claim_token = p_claim_token)
    FOR UPDATE;

  IF NOT FOUND THEN
    -- Distinguish a token mismatch on a still-running row (W1 lost the race
    -- to W2's watchdog re-claim) from a genuine not-found / not-running,
    -- mirroring mark_compute_job_done's P97 serialization_failure branch.
    SELECT status, claim_token
      INTO v_current_status, v_current_token
      FROM compute_jobs
      WHERE id = p_job_id;

    IF FOUND
       AND v_current_status = 'running'
       AND p_claim_token IS NOT NULL
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'defer_compute_job: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

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
         claim_token     = NULL,  -- NEW-C12-06: drop the stale fence token
         last_error      = p_reason
   WHERE id = p_job_id;

  RETURN v_next_attempt;
END;
$$;


ALTER FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text", "p_claim_token" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text", "p_claim_token" "uuid") IS 'Defers a running job back to pending for circuit-breaker cooldowns. Decrements attempts by 1 to cancel claim_compute_jobs increment so the defer does not burn a retry. NEW-C12-06 (CL10): p_claim_token fences the running-row read (back-compat NULL arm for the deploy window) and a token mismatch on a still-running row raises serialization_failure; the deferred row has claim_token NULLed so it drops the stale fence token. Worker is sole caller (services/job_worker._check_circuit_breaker). See migrations 033 + 117.';



CREATE OR REPLACE FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean DEFAULT false) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_owner              uuid;
  v_holdings_deleted   integer := 0;
BEGIN
  -- H-1186: serialize all per-allocator key-deletion + equity-replace work on
  -- one transaction-scoped advisory lock (auto-released on commit/rollback).
  -- replace_allocator_equity_snapshots takes the SAME key, so the worker's
  -- sole-key replace cannot interleave with this cascade. auth.uid() is the
  -- allocator id; follows the same pg_advisory_xact_lock(hashtext(...))
  -- convention as sync_trades (migration 20260406065011), keyed here on the
  -- allocator to match the worker's p_allocator_id key below.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || auth.uid()::text));

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

  -- Step 4: last-key equity cascade (migration 077 semantics, M-1020 fix).
  -- Only wipe the equity series when the user explicitly asked for hard
  -- delete (cascade=true) AND they have no other keys left. Multi-key users
  -- keep their aggregated series intact.
  --
  -- M-1020: this is ONE statement — the NOT EXISTS key-presence check and the
  -- snapshot DELETE share a single statement snapshot, eliminating the TOCTOU
  -- window the prior `SELECT count(*); IF 0 THEN DELETE` had. A concurrent
  -- "Add Key" INSERT committing here is either visible to the NOT EXISTS
  -- (=> a sibling exists => no wipe) or not yet committed (=> this statement
  -- already ran, and the new key's reconstruct repopulates) — never a stale
  -- count=0 followed by a wipe of a now-multi-key series.
  IF p_cascade_holdings THEN
    DELETE FROM allocator_equity_snapshots
      WHERE allocator_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );
  END IF;

  RETURN v_holdings_deleted;
END;
$$;


ALTER FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_api_key_if_unreferenced"("p_api_key_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.api_keys
   WHERE id = p_api_key_id
     -- Dual-mode owner gate (M-0347): the caller owns the key, OR the caller is
     -- a trusted non-end-user service context. auth.uid() IS NULL identifies a
     -- no-`sub` JWT (service_role, whether its claims are populated or bare).
     -- The `auth.role() IS DISTINCT FROM 'anon'` clause is defense-in-depth
     -- (rls-auditor MED-8): even if a future migration regressed EXECUTE to
     -- anon, an anon caller (role='anon', auth.uid() NULL) still could NOT reach
     -- the cross-user arm. It is TRUE for both claimed ('service_role') and bare
     -- (NULL role) service callers, so the cleanup-wizard-drafts cron is
     -- unaffected. The primary gate remains the REVOKE FROM anon below.
     AND (
       user_id = auth.uid()
       OR (auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'anon')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.strategies WHERE api_key_id = p_api_key_id
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;


ALTER FUNCTION "public"."delete_api_key_if_unreferenced"("p_api_key_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_api_key_if_unreferenced"("p_api_key_id" "uuid") IS 'Atomic orphan-key revoke (audit M-0347): DELETE the api_key IFF no strategy references it, in one statement (no count-then-delete TOCTOU). Dual-mode owner gate — authenticated deletes only its own key (user_id=auth.uid()); a service caller (auth.uid() NULL, role<>anon) sweeps any unreferenced key for the cleanup-wizard-drafts cron. anon is REVOKEd and also blocked at the gate (defense-in-depth).';



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



CREATE OR REPLACE FUNCTION "public"."enforce_api_keys_published_composite_integrity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- GDPR / account-decommission exemption: sanitize_user (the Art. 17
  -- anonymize-not-delete RPC) DELETEs api_keys BEFORE it archives the tenant's
  -- strategies, so at key-delete time the composite is still status='published'
  -- and this guard would abort the entire sanitize transaction (account /
  -- data-deletion-request approval fails). sanitize_user signals its path via
  -- `SET LOCAL quantalyze.sanitize_in_progress = 'on'` (transaction-local); the
  -- reject_sentinel_writes trigger (20260513073518_sanitize_user_hardening.sql:161)
  -- already exempts that same session var. Mirror that convention: allow the
  -- delete when the flag is on. This does NOT leave a live holed published
  -- composite — sanitize archives the strategies in the SAME transaction, so no
  -- published composite persists past commit. Scoped to the session var ONLY
  -- (NOT service_role/BYPASSRLS): the normal user key-delete paths (ApiKeyManager,
  -- delete-allocator-api-key-rpc) also run as service_role and MUST still be
  -- blocked when they would hole a LIVE published composite — that is M-3's point.
  IF current_setting('quantalyze.sanitize_in_progress', true) = 'on' THEN
    RETURN OLD;
  END IF;

  -- M-3: a PUBLISHED composite must never be silently holed by a member-key
  -- delete. RAISE only when OLD.id is a strategy_keys member of a published
  -- strategy — draft/pending_review/archived members and single-key links (which
  -- go through strategies.api_key_id, not strategy_keys) never match.
  IF EXISTS (
    SELECT 1
      FROM public.strategy_keys sk
      JOIN public.strategies s ON s.id = sk.strategy_id
     WHERE sk.api_key_id = OLD.id
       AND s.status = 'published'
  ) THEN
    -- Least-disclosure (ADR-0020): this fn is SECURITY DEFINER and reads
    -- strategy_keys / strategies past their owner-only RLS, so the client-facing
    -- error MUST NOT echo any owner id or leak the existence of another tenant's
    -- strategy — that would turn a failed DELETE into an ownership/existence
    -- oracle. The message is a single constant literal (no interpolation); the
    -- foreign_key_violation ERRCODE gives callers a stable arm.
    RAISE EXCEPTION 'api_keys: cannot delete a key that is a member of a published composite — detach the key or archive the strategy first'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."enforce_api_keys_published_composite_integrity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_expected_owner UUID;
BEGIN
  -- Defensive (the trigger WHEN clause already gates on this): strategy rows are exempt.
  IF NEW.api_key_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT user_id INTO v_expected_owner
    FROM api_keys
    WHERE id = NEW.api_key_id;
  IF v_expected_owner IS NULL THEN
    RAISE EXCEPTION
      'csv_daily_returns.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF NEW.allocator_id IS DISTINCT FROM v_expected_owner THEN
    RAISE EXCEPTION
      'csv_daily_returns.allocator_id (%) must match api_keys.user_id (%) for api_key_id %',
      NEW.allocator_id, v_expected_owner, NEW.api_key_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_strategy_keys_owner_coherence"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_key_owner      UUID;
  v_strategy_owner UUID;
BEGIN
  SELECT user_id INTO v_key_owner      FROM api_keys   WHERE id = NEW.api_key_id;
  SELECT user_id INTO v_strategy_owner FROM strategies WHERE id = NEW.strategy_id;
  IF v_key_owner IS NULL THEN
    RAISE EXCEPTION
      'strategy_keys.api_key_id (%) does not reference an existing api_keys row',
      NEW.api_key_id;
  END IF;
  IF v_strategy_owner IS NULL THEN
    RAISE EXCEPTION
      'strategy_keys.strategy_id (%) does not reference an existing strategies row',
      NEW.strategy_id;
  END IF;
  -- Least-disclosure (ADR-0020): this fn is SECURITY DEFINER and reads api_keys /
  -- strategies past their owner-only RLS, so it MUST NOT echo the resolved owner
  -- ids (v_key_owner / v_strategy_owner) into the client-facing error — that would
  -- turn a failed INSERT into a per-tenant ownership-disclosure + existence oracle.
  -- Only caller-supplied NEW.* values may appear; keep the '%must match%' and
  -- '%cross-tenant%' arms distinct (pinned by test_strategy_keys_rls.sql).
  IF NEW.owner_id IS DISTINCT FROM v_key_owner THEN
    RAISE EXCEPTION
      'strategy_keys.owner_id (%) must match the owner of api_key_id %',
      NEW.owner_id, NEW.api_key_id;
  END IF;
  IF v_strategy_owner IS DISTINCT FROM v_key_owner THEN
    RAISE EXCEPTION
      'strategy_keys: strategy owner must match api_key owner — cross-tenant attach blocked';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enforce_strategy_keys_owner_coherence"() OWNER TO "postgres";


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



CREATE OR REPLACE FUNCTION "public"."enqueue_derive_broker_dailies_for_allocator_keys"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_key   RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  -- Advisory lock so concurrent cron fires do not stomp on each other.
  IF NOT pg_try_advisory_lock(hashtext('derive_broker_dailies_key_fanout')) THEN
    RAISE NOTICE 'enqueue_derive_broker_dailies_for_allocator_keys: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    FOR v_key IN
      SELECT ak.id AS api_key_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.sync_status IS DISTINCT FROM 'revoked'
        AND ak.disconnected_at IS NULL
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'derive_broker_dailies',
          p_idempotency_key := 'derive-dailies-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation THEN
        NULL; -- already in-flight for this key (per (api_key_id, kind) index); benign
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('derive_broker_dailies_key_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('derive_broker_dailies_key_fanout'));
END;
$$;


ALTER FUNCTION "public"."enqueue_derive_broker_dailies_for_allocator_keys"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_derive_broker_dailies_for_allocator_keys"() IS 'Cron entrypoint — fans out one derive_broker_dailies job per ELIGIBLE api_key (is_active AND sync_status IS DISTINCT FROM ''revoked'' AND disconnected_at IS NULL — the role-agnostic eligible_key_predicate / phase35 filter). api_key-scoped; dedup via compute_jobs_one_inflight_per_kind_api_key + per-(key,UTC-date) idempotency key. Phase 115.1 — closes the P115 recurring key-mode enqueue gap. Mirrors enqueue_refresh_allocator_equity_for_all (does NOT touch the legacy per-day equity-snapshots path).';



CREATE OR REPLACE FUNCTION "public"."enqueue_ledger_composite_refresh"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_enabled  TEXT;
  v_row      RECORD;
  v_job_id   UUID;
  v_existing INTEGER;
  v_enqueued INTEGER := 0;
BEGIN
  -- ---- the fail-closed activation switch --------------------------------
  -- FIRST statement in the body, deliberately, and it reads the SAME setting the
  -- single-key arm reads so ONE reset kills BOTH arms on the next tick. The
  -- missing-ok form of current_setting returns NULL when the setting was never
  -- set; COALESCE makes that an empty string, and the comparison is EXACT
  -- EQUALITY against the lowercase word. Anything else — unset, empty, '1', 'on',
  -- 'TRUE', or 'true ' with a trailing space — is dormant. A truthiness test or a
  -- boolean cast would open the flag on every one of them.
  v_enabled := COALESCE(current_setting('app.ledger_refresh_enabled', TRUE), '');
  IF v_enabled <> 'true' THEN
    RAISE NOTICE 'enqueue_ledger_composite_refresh: dormant (activation setting not exactly true); enqueued 0';
    RETURN 0;
  END IF;

  -- ---- concurrency: one composite fan-out at a time ----------------------
  -- ⛔ Its OWN key, distinct from the single-key arm's. Sharing a key would make
  -- either arm's tick silently skip whenever the other held it, which reads in
  -- the logs exactly like "there was nothing to do".
  IF NOT pg_try_advisory_lock(hashtext('ledger_refresh_composite_fanout')) THEN
    RAISE NOTICE 'enqueue_ledger_composite_refresh: another run holds the lock; skipping';
    RETURN 0;
  END IF;

  BEGIN
    FOR v_row IN
      WITH candidates AS (
        SELECT
          lrs.strategy_id,
          lrs.last_return_date
        FROM public.ledger_refresh_staleness lrs
        JOIN public.strategies s
          ON s.id = lrs.strategy_id
        WHERE lrs.is_stale
          -- ⛔ THE PARTITIONING CONJUNCT, BY NAME. This single line is what
          -- separates this arm's cohort from the single-key arm's, and it is the
          -- only line in this predicate that is allowed to do so. See the header
          -- section "WHAT PARTITIONS THIS ARM'S COHORT" before touching anything
          -- below it: a second conjunct that also excludes single-key rows makes
          -- this one impossible to falsify.
          AND lrs.is_composite = TRUE
          -- D-01 / D-13, the membership-level deferral. The full founder quote,
          -- its scope, and why this conjunct ships even though nothing matches it
          -- today are in the "D-01 / D-13" section of this file's header (the
          -- venue cannot be named here — the static gate scans this body). This
          -- conjunct is SAFE to write directly: the flag is FALSE for a single-key
          -- strategy on any other ledger venue, so it does not partition.
          AND lrs.has_mt5_member = FALSE
          -- Lifecycle: the same pair the single-key arm uses — ALLOWED_STRATEGY_
          -- STATUSES (routers/cron.py:148) MINUS 'draft'. A draft strategy has no
          -- factsheet to refresh. Cannot partition: a single-key strategy can hold
          -- either of these values.
          AND s.status IN ('published', 'pending_review')
          -- ---- MEMBER HEALTH, written so it CANNOT partition ----------------
          -- ⛔ The obvious spelling — a bare `EXISTS (SELECT 1 FROM strategy_keys
          -- sk … WHERE <eligible>)` — is FORBIDDEN here. A single-key strategy has
          -- ZERO strategy_keys rows, so that spelling would be a SECOND
          -- is-composite test, and the is-composite neutering the matched-pair
          -- gate mandates could then not redden. Written instead as two halves,
          -- the first of which is vacuously TRUE on a member-less row:
          AND (
                -- half 1: a member-less row PASSES here. It is excluded by
                -- `is_composite` one screen up, by name — never by this conjunct.
                NOT EXISTS (
                  SELECT 1
                    FROM public.strategy_keys sk
                   WHERE sk.strategy_id = lrs.strategy_id
                )
                -- half 2: ANY eligible member is enough, deliberately, and not
                -- "all members eligible". A composite whose members are PARTLY
                -- disconnected is still refreshable over its remaining declared
                -- windows; an all-members-eligible rule would silently drop a live
                -- composite the day ONE member is revoked, which is a
                -- fail-toward-silence this phase exists to remove. The three key
                -- predicates are the same role-agnostic eligible-key set the
                -- single-key arm uses.
                OR EXISTS (
                  SELECT 1
                    FROM public.strategy_keys sk2
                    JOIN public.api_keys ak ON ak.id = sk2.api_key_id
                   WHERE sk2.strategy_id = lrs.strategy_id
                     AND COALESCE(ak.is_active, TRUE)
                     AND ak.sync_status IS DISTINCT FROM 'revoked'
                     AND ak.disconnected_at IS NULL
                )
              )
          -- Attempt cooldown — THE BINDING BOUND on recurrence (see the header).
          -- Keyed on the prior ATTEMPT, not the prior success, so a permanently
          -- failing composite costs ~1 job/day instead of 24. Only this kind is
          -- counted: unlike the single-key arm there is no follow-on hop to also
          -- look for, because this kind is chain-terminal. `compute_jobs` terminal
          -- retention is 30 days (20260515113853:198), comfortably longer than the
          -- cooldown, so the cooldown cannot silently void by losing the row it
          -- reads. Cannot partition: a single-key strategy with no recent attempt
          -- passes this too.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj
                 WHERE cj.strategy_id = lrs.strategy_id
                   AND cj.kind = 'stitch_composite'
                   AND cj.created_at > now() - INTERVAL '20 hours'
              )
          -- Non-terminal in-flight guard, the same shape and the same widened
          -- status set as the single-key arm. 'failed_retry' is INCLUDED
          -- deliberately: `CLAIMABLE_STATUSES = ("pending", "failed_retry")`
          -- (job_worker.py:200), so such a row is scheduled to be claimed again and
          -- is in-flight in every sense that matters here. Any kind counts, not
          -- just this one — a composite already busy with another kind must not
          -- also be stitched. Cannot partition.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj2
                 WHERE cj2.strategy_id = lrs.strategy_id
                   AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
              )
      )
      -- ---- THE ONE INTEGER: a BURST CAP, not a safety bound ---------------
      --  (a) One enqueue costs exactly ONE 1200 s handler ceiling. This kind is
      --      CHAIN-TERMINAL (job_worker.py:528), so there is no follow-on hop to
      --      add — the honest per-strategy chain cost, and the one respect in
      --      which this arm is cheaper than the single-key one.
      --  (b) ⛔ THE BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN ABOVE, NOT
      --      THIS LIMIT. This LIMIT bounds what ONE TICK adds to a SHARED queue.
      --      Overhang past the tick is EXPECTED; the in-flight guard and the
      --      cooldown are what absorb it.
      --  (c) ⛔ Do NOT re-derive this from "n × 1200 s fits in an hourly tick".
      --      That formula assumes this arm owns the tick (it does not — the same
      --      worker is draining the single-key arm's 1500 s chains) and at n = 3 it
      --      lands on an EQUALITY, which is not a bound. Full derivation, as blast
      --      radius against a measured cohort of one, is in this file's header.
      SELECT c.strategy_id
        FROM candidates c
       ORDER BY c.last_return_date ASC NULLS FIRST, c.strategy_id
       LIMIT 2
    LOOP
      BEGIN
        -- ⛔ COUNT INSERTIONS, NOT CALLS. _enqueue_compute_job_internal
        -- (20260716090000:229-300) RETURNS the id of an existing in-flight job
        -- when it finds one (:259-261) and inserts ON CONFLICT DO NOTHING (:276) —
        -- so it never raises, a per-row `unique_violation` handler can never fire,
        -- and a naive `counter := counter + 1` per iteration would report the
        -- number of CALLS. The founder reads this integer back at activation
        -- (docs/runbooks/ledger-refresh-go-live.md), so it must mean what it says.
        -- REACHABILITY (IN-01, ported from 20260825130000): this pre-count is a
        -- race-window backstop, NOT the in-flight guard. The guard is the
        -- in-flight conjunct in the candidate CTE above; this re-reads because the
        -- advisory lock serialises fan-out TICKS, not the API — an externally
        -- committed enqueue can land between the CTE's snapshot and this loop's
        -- fresh READ COMMITTED snapshot. It can therefore only UNDERCOUNT, never
        -- over-report.
        --
        -- ⚠️ NO TEST DRIVES THIS NON-ZERO. A green suite is not evidence it fired.
        -- The one other path that would — the same strategy iterated twice in one
        -- tick — is ruled out structurally: strategy_analytics.strategy_id is
        -- UNIQUE and strategy_analytics_series is PRIMARY KEY (strategy_id, kind),
        -- so the view emits exactly one row per strategy.
        SELECT count(*) INTO v_existing
          FROM public.compute_jobs
         WHERE strategy_id = v_row.strategy_id
           AND kind = 'stitch_composite'
           AND status IN ('pending', 'running', 'done_pending_children');

        -- ⛔ p_strategy_id ALONE. enqueue_compute_job enforces exactly-one-of
        -- {p_strategy_id, p_allocator_id, p_api_key_id} and raises 22023 otherwise
        -- (20260515210300:330-332; measured on PROD during the A7 tracer). This
        -- kind is registered strategy-scoped in BOTH compute_jobs CHECKs
        -- (20260710130000), so strategy-only is also the only target shape the
        -- coherence CHECK admits.
        --
        -- ⚠️ The 'source' value is DISTINCT from the single-key arm's on purpose,
        -- so the two mechanisms are told apart in the queue — and it is a CONTRACT
        -- rather than a label: the non-destructive failure guard in
        -- analytics-service/services/job_worker.py reads it back off this job row
        -- and declines to un-publish a live composite when it matches. If the two
        -- spellings drift, this still enqueues and the guard still compiles, and
        -- the only symptom is that the next failed refresh silently un-publishes a
        -- funded account. The static gate pins the pair.
        v_job_id := enqueue_compute_job(
          p_strategy_id := v_row.strategy_id,
          p_kind        := 'stitch_composite',
          p_metadata    := jsonb_build_object(
                             'source', 'ledger-refresh-composite',
                             'enqueued_at', now()
                           )
        );

        IF v_existing = 0 AND v_job_id IS NOT NULL THEN
          v_enqueued := v_enqueued + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- ⛔ Deliberately NOT `WHEN unique_violation`: that condition cannot fire
        -- here (see the counter comment above), and an exception block that cannot
        -- fire is indistinguishable from one that is protecting something — the
        -- next reader preserves it and reasons from it. Catching OTHERS keeps one
        -- poisoned row from aborting the whole tick. The SQLSTATE is carried; no
        -- identifier is (T-161.1-19).
        RAISE WARNING 'enqueue_ledger_composite_refresh: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Release before re-raising, or the session holds the lock until it ends and
    -- every later tick on that session skips. This arm is the part authors drop.
    PERFORM pg_advisory_unlock(hashtext('ledger_refresh_composite_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_composite_fanout'));

  RAISE NOTICE 'enqueue_ledger_composite_refresh: enqueued % composite refresh job(s) this tick', v_enqueued;
  RETURN v_enqueued;
END;
$$;


ALTER FUNCTION "public"."enqueue_ledger_composite_refresh"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_ledger_composite_refresh"() IS 'Phase 161.1 / LEDGER-01: the recurring COMPOSITE refresh arm for ledger-backed venues. Parameterless SECURITY DEFINER; returns the number of jobs ACTUALLY INSERTED this tick. DORMANT until the app.ledger_refresh_enabled database setting is exactly ''true'' (fail-closed) — the SAME switch the single-key arm reads, so one reset kills both. Selects stale COMPOSITE strategies from public.ledger_refresh_staleness — declaring no venue of its own — excludes any composite with a member on the deferred venue (D-01/D-13), and enqueues stitch_composite, which is chain-terminal and writes the headline strategy_analytics row directly. Bounded by a 20-hour ATTEMPT cooldown (the binding constraint), a non-terminal in-flight guard, and a per-tick BURST cap. Registers no schedule; activation is a founder LIVE op per docs/runbooks/ledger-refresh-go-live.md.';



CREATE OR REPLACE FUNCTION "public"."enqueue_ledger_refresh_for_strategies"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_enabled  TEXT;
  v_row      RECORD;
  v_job_id   UUID;
  v_existing INTEGER;
  v_enqueued INTEGER := 0;
BEGIN
  -- ---- Lock B (D-08): the fail-closed activation switch ------------------
  -- FIRST statement in the body, deliberately. The missing-ok form of
  -- current_setting returns NULL when the setting was never set; COALESCE makes
  -- that an empty string, and the comparison is EXACT EQUALITY against the
  -- lowercase word. Anything else — unset, empty, '1', 'on', 'TRUE', 'true '
  -- with a trailing space — is dormant. A truthiness test would open the flag on
  -- half of that list.
  --
  -- Resetting this setting is the incident-pressure kill switch: the next tick
  -- returns 0 with no schedule operation, no deploy, no migration.
  v_enabled := COALESCE(current_setting('app.ledger_refresh_enabled', TRUE), '');
  IF v_enabled <> 'true' THEN
    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: dormant (activation setting not exactly true); enqueued 0';
    RETURN 0;
  END IF;

  -- ---- concurrency: one fan-out at a time -------------------------------
  IF NOT pg_try_advisory_lock(hashtext('ledger_refresh_fanout')) THEN
    RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: another run holds the lock; skipping';
    RETURN 0;
  END IF;

  BEGIN
    FOR v_row IN
      WITH candidates AS (
        SELECT
          lrs.strategy_id,
          lrs.last_return_date,
          -- Per-venue partition for the cap. A non-composite row in this view
          -- has exactly one element in `exchanges` (its venue is reached only
          -- through strategies.api_key_id), and the view's WHERE clause makes an
          -- empty array impossible, so element 1 is the venue. No venue literal
          -- is declared here or anywhere else in this file (D-05).
          row_number() OVER (
            PARTITION BY lrs.exchanges[1]
            ORDER BY lrs.last_return_date ASC NULLS FIRST, lrs.strategy_id
          ) AS venue_rank
        FROM public.ledger_refresh_staleness lrs
        JOIN public.strategies s
          ON s.id = lrs.strategy_id
        -- ⛔ LEFT, not INNER, and this is load-bearing. See the header section
        -- "Why the api_keys join is LEFT": under INNER, a composite is dropped by
        -- the join and never reaches the exclusion conjunct below, which would
        -- make that conjunct unfalsifiable.
        LEFT JOIN public.api_keys ak
          ON ak.id = s.api_key_id
        WHERE lrs.is_stale
          -- D-01: composites are excluded, DELIBERATELY and by name. ⛔ This
          -- conjunct is the ONLY exclusion — it is NOT redundant. Every
          -- key-eligibility conjunct above is NULL-TOLERANT, so a composite
          -- (all-NULL `ak.*` under the LEFT join) passes all of them and is
          -- excluded HERE, nowhere else. Deleting it admits every composite.
          -- See the "D-01" section of this file's header. Do not tidy it away.
          AND lrs.is_composite = FALSE
          -- Lifecycle: mirrors ALLOWED_STRATEGY_STATUSES (routers/cron.py:148)
          -- MINUS 'draft'. A draft strategy has no factsheet to refresh, so the
          -- narrower pair is correct here; it is the same pair
          -- enqueue_poll_positions_for_all_strategies already uses
          -- (20260412094449:233-245), so the two recurring strategy fan-outs
          -- agree on what "live enough to re-run" means.
          AND s.status IN ('published', 'pending_review')
          -- Key eligibility — the role-agnostic eligible-key predicate, written
          -- NULL-TOLERANTLY on purpose (header: "Why the api_keys join is LEFT").
          -- These two are already NULL-true.
          AND ak.sync_status IS DISTINCT FROM 'revoked'
          AND ak.disconnected_at IS NULL
          -- This one is not, so it is coalesced. A row with no key at all is not
          -- excluded HERE — it is excluded above, by name, as a composite.
          AND COALESCE(ak.is_active, TRUE)
          -- Attempt cooldown (D-09) — the BINDING bound. Keyed on the prior
          -- ATTEMPT, not the prior success, so a permanently-failing strategy
          -- costs ~1 job/day instead of 24. Both chain hops count: the tail
          -- follows the head automatically, so an analytics job inside the window
          -- means this strategy was already refreshed inside the window.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj
                 WHERE cj.strategy_id = lrs.strategy_id
                   AND cj.kind IN ('derive_broker_dailies', 'compute_analytics_from_csv')
                   AND cj.created_at > now() - INTERVAL '20 hours'
              )
          -- In-flight guard. Belt-and-braces over enqueue_compute_job's own
          -- optimistic in-flight lookup and over the partial unique index: this
          -- one also covers a strategy busy with a DIFFERENT kind, which the
          -- per-(strategy,kind) index does not.
          --
          -- ⚠️ 'failed_retry' is INCLUDED deliberately, and this set is therefore
          -- WIDER than the three-status set the RPC's dedupe (20260716090000:259-261)
          -- and the compute_jobs_one_inflight_per_kind_strategy index both use.
          -- `CLAIMABLE_STATUSES = ("pending", "failed_retry")` (job_worker.py:200)
          -- — a failed_retry row is scheduled to be claimed again, so it is
          -- in-flight in every sense that matters here. Neither the RPC nor the
          -- index would stop a second derive landing beside it, and two
          -- concurrent derives for one strategy is exactly what the venue that
          -- serialises on a single shared terminal registry cannot absorb.
          AND NOT EXISTS (
                SELECT 1
                  FROM public.compute_jobs cj2
                 WHERE cj2.strategy_id = lrs.strategy_id
                   AND cj2.status IN ('pending', 'running', 'done_pending_children', 'failed_retry')
              )
      )
      -- ---- the two integers (D-09, CORRECTED). Derivation, in order: ------
      --  (a) One refreshed strategy costs up to 1500 s of worker time, NOT
      --      900 s: derive_broker_dailies (900 s) auto-chains to
      --      compute_analytics_from_csv (600 s) on the same
      --      sequentially-dispatching worker (job_worker.py:488-504, :526).
      --  (b) ⛔ THE BINDING CONSTRAINT IS THE 20-HOUR ATTEMPT COOLDOWN ABOVE,
      --      NOT THIS LIMIT. The cooldown plus the in-flight conjunct cap the
      --      outstanding backlog at the COHORT SIZE, whatever the tick rate.
      --  (c) This LIMIT is a burst / smoothing cap only. It is not what keeps
      --      the worker from saturating; (b) is.
      --  (d) ⛔ The LIMIT must stay STRICTLY GREATER than the per-venue cap, or
      --      the behavioural gate's arm G stops discriminating the cap from the
      --      limit and the cap's own neutering goes green.
      -- Full narrative, including why "n × 900 s < 3600 s ⇒ n = 4" is retracted
      -- on BOTH the cost and the model, is in this file's D-09 header section.
      SELECT c.strategy_id
        FROM candidates c
       WHERE c.venue_rank <= 2
       ORDER BY c.last_return_date ASC NULLS FIRST, c.strategy_id
       LIMIT 4
    LOOP
      BEGIN
        -- ⛔ COUNT INSERTIONS, NOT CALLS. _enqueue_compute_job_internal
        -- (20260716090000:229-300) RETURNS the id of an existing in-flight job
        -- when it finds one (:259-261) and inserts ON CONFLICT DO NOTHING
        -- (:276) — so it never raises, a per-row `unique_violation` handler can
        -- never fire, and a naive `counter := counter + 1` per iteration would
        -- report the number of CALLS. The founder reads this integer back at
        -- activation (docs/runbooks/ledger-refresh-go-live.md), so it must mean
        -- what it says. Same idiom as enqueue_poll_positions_for_all_strategies
        -- (20260412094449:249-268).
        --
        -- ⚠️ [161.1-REVIEW IN-01] What this pre-count actually is, stated
        -- honestly so the next reader does not over-trust it: it is a
        -- RACE-WINDOW BACKSTOP, not the mechanism. The mechanism is the
        -- in-flight conjunct in the candidate CTE above, which excludes any
        -- strategy holding a job in ('pending','running','done_pending_children',
        -- 'failed_retry') for ANY kind — a strict superset of the three statuses
        -- and the one kind queried here. So on the normal path v_existing is 0
        -- for every candidate, and this SELECT changes nothing.
        --
        -- It is still not dead code. The advisory lock serialises fan-out TICKS,
        -- not the API: an externally-committed enqueue for this strategy can
        -- land between the CTE's snapshot and this iteration's fresh READ
        -- COMMITTED snapshot, and then the RPC returns that row's id rather than
        -- inserting. Only in that window does v_existing go non-zero. It can
        -- therefore only UNDERCOUNT, which is the fail-safe direction for a
        -- number a human reads back as "jobs created".
        --
        -- ⛔ No test drives this non-zero deterministically — the window needs a
        -- concurrent committed writer. Do not read a green suite as evidence
        -- that this branch has ever fired.
        SELECT count(*) INTO v_existing
          FROM public.compute_jobs
         WHERE strategy_id = v_row.strategy_id
           AND kind = 'derive_broker_dailies'
           AND status IN ('pending', 'running', 'done_pending_children');

        -- ⛔ p_strategy_id ALONE. enqueue_compute_job enforces exactly-one-of
        -- {p_strategy_id, p_allocator_id, p_api_key_id} and raises 22023
        -- otherwise (20260515210300:330-332; measured on PROD during the A7
        -- tracer). Strategy-mode is also the only mode that stamps
        -- strategy_analytics — see the D-07 header section.
        --
        -- ⚠️ The 'source' value is a CONTRACT, not a label: the non-destructive
        -- failure guard in analytics-service/services/job_worker.py reads it back
        -- off this job row and skips the publish-state downgrade when it matches.
        -- If the two spellings drift, the fan-out still enqueues and the guard
        -- still compiles, and the only symptom is that the next failed refresh
        -- silently un-publishes a funded account. Plan 05 gate 8 pins them.
        v_job_id := enqueue_compute_job(
          p_strategy_id := v_row.strategy_id,
          p_kind        := 'derive_broker_dailies',
          p_metadata    := jsonb_build_object(
                             'source', 'ledger-refresh',
                             'enqueued_at', now()
                           )
        );

        IF v_existing = 0 AND v_job_id IS NOT NULL THEN
          v_enqueued := v_enqueued + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- ⛔ Deliberately NOT `WHEN unique_violation`: that condition cannot fire
        -- here (see the counter comment above), and an exception block that
        -- cannot fire is indistinguishable from one that is protecting
        -- something — the next reader preserves it and reasons from it.
        -- Catching OTHERS keeps one poisoned row from aborting the whole tick.
        -- The SQLSTATE is carried; no identifier is (T-161.1-10).
        RAISE WARNING 'enqueue_ledger_refresh_for_strategies: one candidate failed to enqueue (SQLSTATE %); continuing', SQLSTATE;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    -- Release before re-raising, or the session holds the lock until it ends and
    -- every later tick on that session skips. This arm is the part authors drop.
    PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('ledger_refresh_fanout'));

  RAISE NOTICE 'enqueue_ledger_refresh_for_strategies: enqueued % refresh job(s) this tick', v_enqueued;
  RETURN v_enqueued;
END;
$$;


ALTER FUNCTION "public"."enqueue_ledger_refresh_for_strategies"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."enqueue_ledger_refresh_for_strategies"() IS 'Phase 161.1 / LEDGER-01,-02,-04: the recurring single-key refresh fan-out for ledger-backed venues. Parameterless SECURITY DEFINER; returns the number of jobs ACTUALLY INSERTED this tick. DORMANT until the app.ledger_refresh_enabled database setting is exactly ''true'' (fail-closed). Selects stale, non-composite, key-eligible strategies from public.ledger_refresh_staleness — declaring no venue of its own — and enqueues derive_broker_dailies in strategy-mode (the chain TAIL, which auto-chains to compute_analytics_from_csv; the chain HEAD is a provable no-op on a published strategy). Bounded by a 20-hour ATTEMPT cooldown (the binding constraint), an in-flight conjunct, a per-venue rank cap and a per-tick burst LIMIT. Registers no schedule; activation is a founder LIVE op per docs/runbooks/ledger-refresh-go-live.md.';



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



CREATE OR REPLACE FUNCTION "public"."finalize_csv_strategy_with_returns"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text", "p_rows" "jsonb", "p_terminal_status" "text" DEFAULT 'pending_review'::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_auth_uid     UUID := auth.uid();
  v_strategy_id  UUID;
BEGIN
  -- GUARD 1 — CONTRIB-02 guard (T-110-02, D-08): restrict the terminal status;
  -- 'published' is unreachable from any finalize caller. FIRST statement so it
  -- RAISEs before any write (parent: 20260819120000:225-231).
  -- Gated behaviorally by test_csv_finalize_atomic_fold.sql Part 3d.
  --
  -- CHANGED here (146.2 review R5) to be NULL-explicit, in the SAME shape
  -- GUARD 4 and GUARD 5 already use. p_terminal_status NOT IN (...) evaluates
  -- to NULL for a NULL argument and plpgsql takes the ELSE branch on a NULL IF
  -- condition, so a NULL terminal status used to walk past this whitelist
  -- entirely — and past everything else, because nothing below refuses it
  -- either. It surfaced as a 23502 NOT NULL violation from strategies.status:
  -- an error naming a COLUMN rather than the offending input, and one the
  -- route's classifier has no arm for, while the COMMENT ERRCODE map below
  -- promised 22023 for an invalid terminal status. The message literal, its
  -- argument and ERRCODE '22023' are UNCHANGED so no existing gate anchor
  -- moves; a NULL renders as <NULL> in the "% is not allowed" slot.
  IF p_terminal_status IS NULL OR p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 2 — Caller-identity guards (parent: 20260819120000:233-251). The
  -- route layer calls with the authenticated user's id; we assert it matches
  -- the JWT so a SECURITY DEFINER RPC can't be abused via service_role to
  -- write rows under another user. This pair is also what confines finding
  -- A1's blast radius to the caller's OWN tenant. The message literals below
  -- are pinned by supabase/tests/test_csv_finalize_auth_guard.sql Parts A and
  -- B — change both together or not at all.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  -- CHANGED here (146.2 review-of-05) to be NULL-safe. This was the SOLE
  -- remaining violator of the law this same file states at GUARD 8: ⛔ IS
  -- DISTINCT FROM, never <>. p_user_id is caller-controlled and carries no
  -- DEFAULT, so an authenticated direct-RPC caller can pass an explicit JSON
  -- null; `v_auth_uid <> p_user_id` then evaluated to NULL, plpgsql took the
  -- ELSE branch on a NULL IF condition, and the identity guard SILENTLY
  -- PASSED. Nothing below refused it either — GUARDS 3-10 touch only
  -- p_rows / p_fmt / p_strategy_name — so it reached the strategies INSERT
  -- and surfaced as a 23502 NOT NULL violation from strategies.user_id. That
  -- is R5's pathology verbatim: an error naming a COLUMN instead of the
  -- offending input, while this function's own COMMENT ERRCODE map (STEP 3)
  -- promises 42501 for "no session or identity mismatch" — and a NULL
  -- p_user_id IS an identity mismatch. The message literal, both its
  -- arguments and ERRCODE '42501' are UNCHANGED so no existing gate anchor
  -- moves; a NULL renders as <NULL> in the "p_user_id (%)" slot.
  -- ⚠️ THE SHAPE RULE, so the two spellings in this file do not read as
  -- drift: an `x NOT IN (...)` whitelist takes `x IS NULL OR ...`
  -- (GUARDS 1, 4, 5); a BINARY comparison takes IS DISTINCT FROM
  -- (GUARDS 2 and 8). Both are NULL-safe; neither is usable at the other's
  -- site — `IS DISTINCT FROM` cannot express a set membership, and
  -- `p_user_id IS NULL OR v_auth_uid <> p_user_id` is the same predicate
  -- spelled with a redundant arm.
  IF v_auth_uid IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- GUARD 3 — (new, v1.19 review A1) p_rows NULL. Every rows guard below this
  -- point is a three-valued-logic comparison that a NULL argument PASSES:
  -- jsonb_typeof(NULL) is NULL, NULL <> 'array' is NULL, and plpgsql takes the
  -- ELSE branch on a NULL IF condition. MEASURED on a throwaway
  -- postgres:16-alpine (146.1-RESEARCH.md §1.2): before this guard,
  -- p_rows := NULL returned a UUID for a strategy with zero dailies that the
  -- Phase 143 sweep cannot heal. This guard sits ABOVE the jsonb_typeof guard
  -- so the NULL case gets its own distinguishing message.
  IF p_rows IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows is required (got NULL)'
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 4 — Format whitelist (parent: 20260819120000:254-257), CHANGED to be
  -- NULL-explicit: p_fmt NOT IN (...) is NULL when p_fmt is NULL, and plpgsql
  -- then takes the ELSE branch, so a NULL fmt used to pass the whitelist
  -- entirely. The 'invalid fmt' distinguishing substring is preserved verbatim
  -- so no existing gate moves.
  IF p_fmt IS NULL OR p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 5 — Strategy-name guards (parent: 20260819120000:262-272, verbatim):
  -- 1-80 chars, two raises with distinguishing substrings so tests can pin each
  -- separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 6 — Rows type guard (parent: 20260819120000:275-278, verbatim):
  -- p_rows MUST be an array before jsonb_array_length is called on it.
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows must be a JSONB array, got %', jsonb_typeof(p_rows)
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 7 — Row-count cap (parent: 20260819120000:283-286, verbatim): the
  -- route validator also enforces <=5000 upstream; this is defense-in-depth so
  -- a direct RPC caller cannot insert an unbounded series. ⛔ The spelling of
  -- this line is pinned by a word-bounded regex in STEP 4 below and in the
  -- parent's STEP 3(d) — a widened literal is the exact false-PASS class this
  -- phase exists to close.
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows exceeds 5000 rows (got %)', jsonb_array_length(p_rows)
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 8 — (new, v1.19 review A1) empty array, NARROWED to fmt='trades'.
  -- 20260819120000:288-290 recorded that the parents' empty-array raise is
  -- deliberately ABSENT because an empty array is the legitimate fmt='trades'
  -- no-series case. That reasoning is preserved, not reverted: 'trades' still
  -- finalizes with zero dailies (pinned unwrapped by Part 4 of the fold gate).
  -- Every OTHER fmt asking to persist a daily series with no rows in it is
  -- refused. ⛔ IS DISTINCT FROM, never <>: p_fmt <> 'trades' is NULL when
  -- p_fmt is NULL and the guard would not fire (MEASURED). Today GUARD 4
  -- already refuses a NULL fmt, so this is defense in depth behind it — it
  -- exists so a future edit to GUARD 4 cannot silently re-open the hole.
  -- Placed AFTER GUARD 4 so a bogus fmt still reports 'invalid fmt'.
  IF jsonb_array_length(p_rows) = 0 AND p_fmt IS DISTINCT FROM 'trades' THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows is empty and fmt % accepts no empty series (only fmt=trades finalizes with zero dailies)',
      p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 9 — (new, v1.19 review A1) the value scan, evaluated BEFORE the
  -- strategies INSERT so a poisoned element costs the caller an error, never a
  -- committed row. See "READ THIS BEFORE SIMPLIFYING" (iii) and (iv) in the
  -- header for why this is ONE BETWEEN rather than three predicates, and why
  -- the date fence is spelled in explicit UTC.
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_rows) elem
     WHERE elem->>'daily_return' IS NULL
        OR elem->>'date' IS NULL
        OR NOT ((elem->>'daily_return')::DOUBLE PRECISION BETWEEN -10 AND 10)
        OR (elem->>'date')::DATE > (now() AT TIME ZONE 'UTC')::date
        OR (elem->>'date')::DATE < DATE '1900-01-01'
  ) THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows contains an unusable element (a missing date or daily_return, a daily_return that is NaN/Infinity or outside +/-10, or a date in the future or before 1900) - refused before any write'
      USING ERRCODE = '22023';
  END IF;

  -- GUARD 10 — (new, v1.19 review A1) duplicate dates within one payload. See
  -- "READ THIS BEFORE SIMPLIFYING" (v): without this the dailies INSERT raises
  -- 23505 on csv_daily_returns_strategy_date_key, which the route's resolve arm
  -- mistakes for the double-submit fence.
  IF (SELECT count(*) <> count(DISTINCT elem->>'date')
        FROM jsonb_array_elements(p_rows) elem) THEN
    RAISE EXCEPTION 'finalize_csv_strategy_with_returns: p_rows contains duplicate dates - a track record cannot carry two returns for one day, and persisting it would raise 23505 from the dailies unique index instead of a legible input error'
      USING ERRCODE = '22023';
  END IF;

  -- Insert the strategies row (parent: 20260819120000:299-310, column list
  -- EXACT). source='csv' marks the ingestion path; status=p_terminal_status
  -- ('pending_review' manager flow, 'private' CONTRIB-02 contribution flow).
  -- wizard_session_id is WRITTEN here (Phase 140.4 / SEAMRIM-03): this single
  -- column write is what makes the partial index
  -- strategies_user_wizard_session_source_uniq bite. A double submit raises
  -- 23505 on this INSERT, and because this body has no handler clause the
  -- raise aborts the function: NOTHING below (or above) survives.
  INSERT INTO strategies (
    user_id, name, status, source,
    strategy_types, subtypes, markets, supported_exchanges,
    wizard_session_id
  )
  VALUES (
    p_user_id, p_strategy_name, p_terminal_status, 'csv',
    '{}', '{}', '{}', '{}'::text[],
    p_wizard_session_id
  )
  RETURNING id INTO v_strategy_id;

  -- Insert the verification row (parent: 20260819120000:317-324, verbatim).
  -- FK ordering note preserved from the parent: PostgreSQL allows the
  -- strategy_verifications.strategy_id FK to reference the just-inserted
  -- strategy because both inserts run in the same transaction (the SECURITY
  -- DEFINER function body is implicitly transactional). The FK check happens
  -- at COMMIT, not at the second INSERT.
  INSERT INTO strategy_verifications (
    strategy_id, wizard_session_id, status, trust_tier, flow_type, source,
    errors, correlation_id
  ) VALUES (
    v_strategy_id, p_wizard_session_id, 'validated', 'csv_uploaded', 'csv', 'csv',
    NULL, NULL
  );

  -- The dailies write (parent: 20260819120000:335-343, verbatim):
  -- length-gated (trades no-series case), plain INSERT (a fresh strategy id
  -- cannot conflict; duplicate dates are now refused by GUARD 10 above and at
  -- the route boundary), and written against the 20260624120000 shape — naming
  -- exactly (strategy_id, date, daily_return) leaves api_key_id/allocator_id
  -- NULL, which satisfies the csv_daily_returns_source_xor CHECK; the
  -- owner-coherence trigger is gated WHEN api_key_id IS NOT NULL and never
  -- fires for these rows. A malformed element that survived GUARD 9 (a
  -- non-numeric daily_return string, say) raises here and rolls back ALL THREE
  -- inserts — that rollback IS the SC#2 mechanism.
  IF jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO csv_daily_returns (strategy_id, date, daily_return)
    SELECT
      v_strategy_id,
      (elem->>'date')::DATE,
      (elem->>'daily_return')::DOUBLE PRECISION
    FROM jsonb_array_elements(p_rows) elem;
  END IF;

  RETURN v_strategy_id;
END;
$$;


ALTER FUNCTION "public"."finalize_csv_strategy_with_returns"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text", "p_rows" "jsonb", "p_terminal_status" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finalize_csv_strategy_with_returns"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text", "p_rows" "jsonb", "p_terminal_status" "text") IS 'Phase 145 / JOB-06 / SC#2 (D-07), input guards hardened by Phase 146.1 (v1.19
   review A1/C4). Atomically creates the strategies row, the
   strategy_verifications row AND the csv_daily_returns series for a CSV-wizard
   finalize in ONE transaction. The body deliberately carries NO handler clause:
   any error - the 23505 double-submit fence included - rolls back all three
   writes, which is the whole point; do not add one. Empty p_rows is the
   legitimate fmt=trades no-series case and succeeds with zero dailies; for
   every other fmt an empty p_rows is refused. ERRCODE map: 22023 invalid
   terminal status (incl. NULL) / fmt (incl. NULL) / name / rows shape / NULL rows / >5000
   rows / empty rows for a non-trades fmt / an element with a missing date or
   daily_return, a daily_return that is NaN, +/-Infinity or outside +/-10, a
   date after today (UTC) or before 1900, or two elements sharing a date; 42501
   no session or identity mismatch; 23505 double submit (all three writes rolled
   back) - note this code has TWO possible sources,
   strategies_user_wizard_session_source_uniq AND
   csv_daily_returns_strategy_date_key (20260624120000:55-56), correcting the
   sole attribution in the superseded comment; the dailies one is unreachable
   from a conforming payload since the duplicate-date guard; 22007/22P02
   malformed row element (all three writes rolled back). Grants: authenticated
   ONLY - anon and service_role are REVOKEd and asserted so; service_role would
   NULL auth.uid() and 42501 every call (20260522111839:200-208). Gates:
   test_csv_finalize_atomic_fold.sql (Parts 1-7 incl. 3d and 3e; Part 1 also
   carries the STANDING comment-stripped prosrc no-handler pin and the
   service_role EXECUTE pin added by 146.2 W3, so a future CREATE OR REPLACE
   that adds a handler clause or re-grants service_role reddens CI on every
   run rather than only at apply time), test_csv_finalize_double_submit.sql,
   test_csv_finalize_auth_guard.sql.';



CREATE OR REPLACE FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric, "p_terminal_status" "text" DEFAULT 'pending_review'::"text") RETURNS "uuid"
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
  -- CONTRIB-02 guard (T-110-02): the terminal status is restricted to an
  -- owner-only or review-candidate value. 'published' is deliberately
  -- unreachable from any finalize caller — a strategy becomes published ONLY
  -- via the admin review promotion path. FIRST statement so it RAISEs before
  -- any strategies read/write.
  IF p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_wizard_strategy called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_wizard_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the row FOR UPDATE while we assert + promote. Matches the
  -- pattern used in migration 020 for RLS-scoped PII revokes.
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
      status = p_terminal_status
    WHERE id = p_strategy_id;

  -- Insert the API-tier verification row so the OWNER's /strategy/[id]
  -- disclaimer reads "Data verified from exchange API" instead of the
  -- self_reported fallback.
  --
  -- CONTRIB-02 note: this insert is KEPT on BOTH terminal statuses (including
  -- 'private'). trust_tier ('api_verified') is a data-quality label the owner's
  -- own surfaces read, NOT a publish signal — the admin publish queue keys on
  -- strategies.status='pending_review', so a 'private' row carrying a
  -- verification row is still never publishable.
  --
  -- Only insert when:
  --  (a) the strategy is API-tier (api_key_id IS NOT NULL), AND
  --  (b) the api_keys row resolves to a known exchange admitted by the
  --      strategy_verifications.source check constraint.
  -- A future wizard variant with NULL api_key_id (e.g. paper-trading
  -- onboarding) would NOT get an api_verified row — that's the desired
  -- safety property. The CSV branch is the parallel path; it stays in
  -- finalize_csv_strategy.
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


ALTER FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric, "p_terminal_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."flip_capital_ownership_to_team_review"("p_strategy_id" "uuid") RETURNS TABLE("removed_positions" integer, "updated_strategies" integer)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_removed INTEGER := 0;
  v_updated INTEGER := 0;
  v_owner   UUID;
BEGIN
  -- OWNER PRECHECK — MUST COME BEFORE THE DELETE (rev-2, review finding F1).
  -- Without it, a NON-OWNER call is not a no-op at all: the DELETE below is
  -- scoped to the CALLER's portfolios, so caller B invoking flip() on owner A's
  -- strategy DELETES B's own position in it while the UPDATE no-ops — returning
  -- (1, 0) and silently destroying a position B never asked to remove. The
  -- auth.uid() predicates on the two statements make the flip safe for the
  -- VICTIM; they do nothing for the caller. Only this precheck makes the
  -- documented "total no-op returning (0, 0)" contract true.
  --
  -- SECURITY INVOKER + RLS is fine here: `strategies_read` is
  -- `status='published' OR user_id=auth.uid()`, so a caller can ALWAYS read
  -- their OWN strategy — an owner's precheck read never returns NULL. A
  -- non-owner reading a private strategy gets NULL, which lands on the same
  -- no-op arm as reading someone else's user_id. Both outcomes are correct.
  SELECT user_id INTO v_owner FROM public.strategies WHERE id = p_strategy_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    removed_positions := 0;
    updated_strategies := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  -- Remove the caller's OWN positions in this strategy first. Scoped to
  -- portfolios the caller owns: a flip must never touch another allocator's
  -- book, even though the mark itself is strategy-global (header (g)).
  --
  -- DELETE-BEFORE-UPDATE IS LOAD-BEARING, NOT STYLE: the mark-transition guard
  -- (part 3b) refuses an UPDATE into 'team_review' while an owner-scoped
  -- position is live. The precheck above has established auth.uid() = the
  -- strategy's owner, so this DELETE clears exactly the set that guard counts.
  -- Reorder these two statements and the sanctioned path starts raising 23514
  -- against itself.
  DELETE FROM public.portfolio_strategies
   WHERE strategy_id = p_strategy_id
     AND portfolio_id IN (
       SELECT id FROM portfolios WHERE user_id = auth.uid()
     );
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- Then set the mark. The auth.uid() predicate is retained as defence in depth
  -- even though the precheck already established ownership — it is what keeps
  -- the statement correct on its own terms if this function is ever made
  -- SECURITY DEFINER or called from a service-role context, where RLS stops
  -- helping (guard-test case 7c pins all three occurrences).
  UPDATE public.strategies
     SET capital_ownership = 'team_review'
   WHERE id = p_strategy_id
     AND user_id = auth.uid();
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  removed_positions := v_removed;
  updated_strategies := v_updated;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."flip_capital_ownership_to_team_review"("p_strategy_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."flip_capital_ownership_to_team_review"("p_strategy_id" "uuid") IS 'OWN-03: flips a strategy''s capital_ownership mark to team_review AND removes the OWNER''s positions in it, in ONE transaction. Closes the stranded-position hole that two sequential PostgREST calls would open. SECURITY INVOKER. A non-owner call is a total no-op returning (0, 0) BECAUSE OF THE OWNER PRECHECK, not because of the statements'' auth.uid() predicates — those are scoped to the CALLER, so without the precheck a non-owner call would delete the CALLER''s own position in the target strategy and return (1, 0). Third-party positions are never touched (migration header (g)); the DELETE runs before the UPDATE so the part-3b mark-transition guard admits the sanctioned flip.';



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



CREATE OR REPLACE FUNCTION "public"."get_latest_portfolio_analytics_for_user"("p_user_id" "uuid") RETURNS SETOF "public"."portfolio_analytics"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_is_admin BOOLEAN;
BEGIN
  -- No auth session (e.g. service_role, which has no auth.uid()) → no rows.
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  -- Caller may read ONLY their own portfolios' analytics, unless they are admin.
  IF auth.uid() <> p_user_id THEN
    SELECT COALESCE(p.is_admin, false) INTO v_is_admin
    FROM profiles p
    WHERE p.id = auth.uid();
    IF NOT COALESCE(v_is_admin, false) THEN
      RETURN;  -- empty set, not an error (matches get_allocator_latest_batch_meta)
    END IF;
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (pa.portfolio_id) pa.*
  FROM portfolio_analytics pa
  JOIN portfolios po ON po.id = pa.portfolio_id
  WHERE po.user_id = p_user_id
  ORDER BY pa.portfolio_id, pa.computed_at DESC;  -- rides idx_portfolio_analytics_latest
END;
$$;


ALTER FUNCTION "public"."get_latest_portfolio_analytics_for_user"("p_user_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_latest_portfolio_analytics_for_user"("p_user_id" "uuid") IS 'SECURITY DEFINER (B19): latest portfolio_analytics row per portfolio owned by p_user_id (DISTINCT ON portfolio_id, computed_at DESC). Enforces caller-is-user-OR-admin via auth.uid(); empty set otherwise. Replaces getAllocatorAggregates'' unbounded .in_ + limit(500) + app-dedup (src/lib/queries.ts). EXECUTE: authenticated only.';



CREATE OR REPLACE FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) RETURNS TABLE("strategy_id" "uuid", "trust_tier" "text", "status" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT DISTINCT ON (sv.strategy_id)
         sv.strategy_id,
         sv.trust_tier,
         sv.status
    FROM public.strategy_verifications sv
    JOIN public.strategies s ON s.id = sv.strategy_id
   WHERE s.status = 'published'
     AND sv.strategy_id = ANY(p_strategy_ids)
   ORDER BY sv.strategy_id, sv.created_at DESC;
$$;


ALTER FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) IS 'Phase 126 / FACTSHEET-01 (mig 135): the PUBLIC verification signal (trust_tier + status) for PUBLISHED strategies, keyed by strategy_id (most-recent verification per strategy). Correct-by-construction public exposure: SECURITY DEFINER + pinned search_path lets anon read WITHOUT widening strategy_verifications RLS (that table stays owner-locked, mig 093). RETURNS TABLE is the column allow-list — verification internals (wizard_session_id/flow_type/source/…) are structurally unreachable. WHERE strategies.status=''published'' is the published-gate. Sole reader in app code: readPublicVerificationSignals (src/lib/queries.ts).';



CREATE OR REPLACE FUNCTION "public"."get_shared_scenario"("p_token_hash" "text") RETURNS TABLE("name" "text", "draft" "jsonb", "schema_version" integer, "series" "jsonb")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_scenario  scenarios%ROWTYPE;
  v_added_ids UUID[];
BEGIN
  -- Defensive input guard: a NULL/empty hash can never match.
  IF p_token_hash IS NULL OR length(p_token_hash) = 0 THEN
    RETURN;
  END IF;

  -- Gate: active (non-revoked) share only. Not found → RETURN (0 rows) → the
  -- page notFound()s. An unknown, a revoked, and a cross-tenant token all take
  -- this same exit — no oracle distinguishing "revoked" from "never existed".
  --
  -- CR-01 OWNER-COHERENCE (read-time backstop): the join also requires the
  -- share's creator to OWN the referenced scenario (s.allocator_id =
  -- sh.created_by). This is layer 3 of the defence-in-depth — even a share row
  -- that somehow bypassed the table WITH CHECK (a future RLS loosening, a
  -- service-role mis-insert, a data migration) can NEVER resolve another
  -- tenant's scenario content through this SECURITY DEFINER path, because the
  -- creator-owns-the-scenario invariant is re-checked here at read time. A row
  -- whose created_by is not the scenario owner falls through to 0 rows (→ 404),
  -- exactly like an unknown/revoked token — no oracle.
  SELECT s.* INTO v_scenario
    FROM scenario_shares sh
    JOIN scenarios s
      ON s.id = sh.scenario_id
     AND s.allocator_id = sh.created_by
   WHERE sh.token_hash = p_token_hash
     AND sh.revoked_at IS NULL;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Extract ONLY the added-strategy UUIDs from the draft snapshot. Holdings
  -- refs ("holding:{venue}:{symbol}:{type}") are deliberately NOT resolved —
  -- they are the allocator's LIVE BOOK. The UUID-shape filter keeps only
  -- strategies.id-shaped values and drops poison/holdings/unknown ref classes.
  SELECT array_agg((elem->>'id')::uuid)
    INTO v_added_ids
    FROM jsonb_array_elements(COALESCE(v_scenario.draft->'addedStrategies', '[]'::jsonb)) elem
   WHERE (elem->>'id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  RETURN QUERY
  SELECT v_scenario.name,
         v_scenario.draft,
         v_scenario.schema_version,
         COALESCE(
           (SELECT jsonb_agg(jsonb_build_object(
                     'strategy_id', sa.strategy_id,
                     'daily_returns', sa.daily_returns))
              FROM strategy_analytics sa
              JOIN strategies st ON st.id = sa.strategy_id
             WHERE sa.strategy_id = ANY(COALESCE(v_added_ids, '{}'::uuid[]))
               AND st.status = 'published'),   -- published-only; never owned-but-unpublished
           '[]'::jsonb);
END;
$_$;


ALTER FUNCTION "public"."get_shared_scenario"("p_token_hash" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_shared_scenario"("p_token_hash" "text") IS 'Phase 25 / SHARE-02. The SOLE anon/cross-tenant read path for a shared scenario. SECURITY DEFINER (bypasses RLS) so it self-scopes: gates on token_hash + revoked_at IS NULL, returns ONLY name/draft/schema_version + the draft addedStrategies[].id PUBLISHED strategy_analytics series. NEVER reads holdings/AUM/api_keys/portfolios. Token is hashed in Node (Plan 25-02); this takes the precomputed sha256 hex. GRANTed to service_role only.';



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
    -- mig 111 P11: synthetic user-facing message.
    CASE
      -- F-3 (mig 20260826140000). FIRST, ahead of both failed_final arms: a
      -- reaped orphan is retryable, and it is the only failed_final class that
      -- is. Below the bare fallback it would read "Tried multiple times without
      -- success", which is false in a second way — it was never retried.
      WHEN cj.status = 'failed_final' AND cj.error_kind = 'orphaned' THEN
        'This run stopped before it finished because the process running it went away. Please try again.'
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


COMMENT ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) IS 'Returns compute_jobs rows visible to auth.uid(). last_error REDACTED; user_message TEXT (mig 111 P11) synthesised from (status, error_kind). FAILURE ARMS, in evaluation order (mig 20260826140000, Phase 162 F-3): failed_final + orphaned -> the worker died holding the claim, so the run never reached a verdict and the user is asked to TRY AGAIN; failed_final + permanent -> not automatically retryable, contact support; bare failed_final -> automatic retries exhausted. The orphaned arm must stay FIRST: below the bare fallback a worker death reads as "tried multiple times without success", which it never was. Before 20260826140000 the reaper classified orphans as permanent and this RPC told those users their failure could not be retried at all. audit-2026-05-07 M-0783: WHERE uses COALESCE(s.user_id, p.user_id) — this is a self-documenting refactor with NO observable behavior delta from the prior `(s.user_id = X OR p.user_id = X)` shape. Both forms return NULL (filtered as false) for orphan rows where both joins miss. Orphans remain invisible to ALL callers of this RPC. Admins read orphans through the service-role direct query path, never through this function (auth.uid() IS NULL returns early at the top of the body). See migrations 032, 111, audit-2026-05-07, 20260826140000.';



CREATE OR REPLACE FUNCTION "public"."get_verified_cohort_rank"("p_sharpe" double precision, "p_sortino" double precision, "p_max_dd" double precision) RETURNS TABLE("cohort_n" integer, "sharpe_pct" integer, "sortino_pct" integer, "max_dd_pct" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  -- Cell-size floor (T-42-02). Below this the cohort is too thin to rank a
  -- hypothetical without near-identifying an individual strategy.
  v_min_n CONSTANT INT := 20;
  v_n     INT;
BEGIN
  -- Caller-identity guard (T-42-03): the route layer (withAuth +
  -- assertProfileApproved) is the primary gate; this is defense-in-depth so
  -- the SECURITY DEFINER fn cannot be abused by an anon/unauthenticated
  -- session even though EXECUTE is also REVOKEd from anon below.
  IF auth.role() = 'anon' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'get_verified_cohort_rank requires an authenticated session'
      USING ERRCODE = '42501';
  END IF;

  -- Cohort size = verified AND published strategies whose three rankable
  -- metrics are all non-null AND whose analytics computation reached a
  -- terminal success. The explicit status='published' predicate is
  -- defense-in-depth (D-02): the DEFINER fn bypasses RLS, so without it the
  -- caller's own drafts/pending_review rows could pollute the cohort.
  -- "Verified" = a strategy_verifications row at status='published' (terminal
  -- state). NOT `trust_tier IS NOT NULL` — that column is NOT NULL (migration
  -- 093 CHECK) so the IS NOT NULL form is a tautology matching every draft.
  --
  -- RANK-01 (phase 159): the terminal-success gate below is the SQL twin of
  -- isRankableAnalyticsRow / isComputedAnalytics in src/lib/closed-sets.ts. It
  -- MUST appear identically in the rank query further down — this is the
  -- denominator, that is the numerator, and a gate on only one of them makes
  -- min-N count rows the percentiles do not. A status gate is required because
  -- a failed computation can retain KPI values, so the IS NOT NULL predicates
  -- alone admit dead rows (159-CENSUS.md: 17 of 18 published PROD strategies).
  SELECT count(*) INTO v_n
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND a.computation_status IN ('complete', 'complete_with_warnings')
    AND a.sharpe IS NOT NULL
    AND a.sortino IS NOT NULL
    AND a.max_drawdown IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM strategy_verifications v
      WHERE v.strategy_id = s.id AND v.status = 'published'
    );

  -- Min-N gate (T-42-02): below the floor, return a single honest-empty row
  -- carrying the real cohort_n but NULL percentiles. Never rank against a
  -- thin/illustrative set — prevents cell-size inference.
  IF v_n < v_min_n THEN
    RETURN QUERY SELECT v_n, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  -- Rank = % of cohort whose value is <= the blend's, for sharpe/sortino
  -- (higher=better). For max_dd MIRROR getPercentiles EXACTLY: count cohort
  -- strategies whose magnitude is <= the blend's (abs(a.max_drawdown) <=
  -- p_max_dd) then invert via `100 - that`. This is parity-by-construction at
  -- ties/boundary, unlike a direct `>=` count.
  --
  -- DECILE QUANTIZATION (probe-resistance, auditor HIGH): each raw percentile
  -- is coarsened to the nearest 10 — round(raw_pct / 10) * 10 — applied AFTER
  -- the max_dd `100 - (<=)` inversion. Adjacent probe inputs collide into one
  -- decile bucket, so a single percentile step reveals only a 10-point bucket,
  -- never an individual peer's value. This + the plan 42-02 route rate-limit
  -- are the load-bearing probe-resistance controls (see header).
  --
  -- IDENTITY STRIP (T-42-01): every projected expression below is an
  -- aggregate (v_n is the count from above; the three columns are
  -- count(*) FILTER ratios). No strategy id / name / returns / metric value
  -- ever appears in the SELECT list or the RETURNS TABLE.
  --
  -- RANK-01: this WHERE clause is character-identical to the count query's
  -- above, INCLUDING the terminal-success gate. They are one cohort definition
  -- written twice; keep them in lockstep.
  RETURN QUERY
  SELECT
    v_n,
    (round( round(100.0 * count(*) FILTER (WHERE a.sharpe  <= p_sharpe)  / v_n) / 10.0 ) * 10)::INT,
    (round( round(100.0 * count(*) FILTER (WHERE a.sortino <= p_sortino) / v_n) / 10.0 ) * 10)::INT,
    (round( (100 - round(100.0 * count(*) FILTER (WHERE abs(a.max_drawdown) <= p_max_dd) / v_n)) / 10.0 ) * 10)::INT
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND a.computation_status IN ('complete', 'complete_with_warnings')
    AND a.sharpe IS NOT NULL
    AND a.sortino IS NOT NULL
    AND a.max_drawdown IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM strategy_verifications v
      WHERE v.strategy_id = s.id AND v.status = 'published'
    );
END;
$$;


ALTER FUNCTION "public"."get_verified_cohort_rank"("p_sharpe" double precision, "p_sortino" double precision, "p_max_dd" double precision) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_verified_cohort_rank"("p_sharpe" double precision, "p_sortino" double precision, "p_max_dd" double precision) IS 'Phase 42 / PEER-03 (v1.2.2), re-based by phase 159 / RANK-01 (v1.20): aggregate-only rank of a hypothetical blend''s Sharpe/Sortino/max_dd against the REAL verified+published strategy universe. Cohort = strategies.status=''published'' AND a strategy_verifications row at status=''published'' (the terminal verified state — NOT trust_tier IS NOT NULL, which is a tautology since trust_tier is NOT NULL) AND all three rankable metrics non-null AND strategy_analytics.computation_status in the two-value terminal-success set. RANK-01: that computation gate is the SQL twin of isRankableAnalyticsRow -> isComputedAnalytics in src/lib/closed-sets.ts, the ONE helper getPercentiles and getOwnRowPercentiles both apply — the two-value list mirrors it member for member, which is what makes this parity-by-construction rather than a coincidence; a single-value ''complete'' gate here would unrank every warned-but-valid strategy. The gate sits in BOTH the count query and the rank query so the min-N denominator cannot diverge from the rank numerator (the same reason the nullable-metric exclusion is in both). It exists because a failed computation can RETAIN KPI values, so the IS NOT NULL predicates alone admitted dead rows — 159-CENSUS.md measured 17 of 18 published PROD strategies in exactly that state. Returns ONLY (cohort_n, sharpe_pct, sortino_pct, max_dd_pct) — never any per-strategy id/name/returns/PII. Percentiles are DECILE-QUANTIZED (nearest 10) for probe-resistance — that quantization plus the route rate-limit are the load-bearing controls against a per-peer binary-search probe oracle. Suppressed below min-N=20 (returns the cohort_n with NULL percentiles) to prevent cell-size inference. max_dd mirrors getPercentiles'' direction exactly (count abs<=p_max_dd then 100-that, before quantization). SECURITY DEFINER because strategy_verifications RLS (migration 093) forbids the cross-tenant verified read from an authed client. p_max_dd is the MAGNITUDE (abs) of the blend''s max_dd; max_drawdown is stored negative.';



CREATE OR REPLACE FUNCTION "public"."guard_allocation_requires_own_capital"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_mark            TEXT;
  v_strategy_owner  UUID;
  v_portfolio_owner UUID;
BEGIN
  -- SECURITY DEFINER (see header d.2): these two lookups must NOT be
  -- RLS-filtered by the inserting session, or the unconditional team_review arm
  -- goes blind on rows the caller cannot read.
  SELECT s.capital_ownership, s.user_id
    INTO v_mark, v_strategy_owner
    FROM public.strategies s
   WHERE s.id = NEW.strategy_id;

  -- Unqualified relation names are deterministic here: `SET search_path =
  -- public, pg_catalog` is pinned on the function above.
  SELECT p.user_id
    INTO v_portfolio_owner
    FROM portfolios p
   WHERE p.id = NEW.portfolio_id;

  -- D-03-A, two arms:
  --   ARM 1 (unconditional, SC 2b literally): a team_review mark blocks a
  --     position for ANYONE — owner or third party. "A team-review strategy can
  --     never become a position" means never.
  --   ARM 2 (owner-scoped): a SELF-OWNED strategy must be affirmatively marked
  --     own_capital. NULL (never asked) is non-allocatable — the owner is the
  --     one person who can answer the question, so silence is not consent.
  -- The owner-equality conjunct on ARM 2 is what preserves the FOUR SHIPPED
  -- third-party allocation paths — AddToPortfolio.tsx:54,
  -- MigrationWizard.tsx:72, seed-demo-data.ts:1069 (⭐ the seed CI actually
  -- runs, ci.yml:1600) and seed-full-app-demo.ts:1697,1929 (manual-only) —
  -- which insert positions for OTHER owners' strategies that the allocator has
  -- no authority to mark. A blanket not-own_capital predicate would break all
  -- four. seed-demo-data clears BOTH arms only because its fixture ownership
  -- sets are disjoint (manager-owned strategies, allocator-owned portfolios)
  -- and no seed writes `capital_ownership`; see header (d) for why that is a
  -- CI-reddening landmine and which vitest pins now defend it.
  IF v_mark = 'team_review'
     OR (v_strategy_owner = v_portfolio_owner AND v_mark IS DISTINCT FROM 'own_capital') THEN
    RAISE EXCEPTION
      'strategy % cannot become a position: capital_ownership=% (required: own_capital)',
      NEW.strategy_id, COALESCE(v_mark, 'unmarked')
      USING ERRCODE = 'check_violation',
            HINT = 'Mark the strategy as your own capital in My Strategies before allocating to it.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_allocation_requires_own_capital"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_allocation_requires_own_capital"() IS 'OWN-03 / D-03-A: blocks a portfolio_strategies row from POINTING AT a strategy that is marked team_review (unconditional, SC 2b) or that is SELF-OWNED and not marked own_capital. Attached to TWO narrow triggers that share this body: trg_portfolio_strategies_own_capital_only (BEFORE INSERT — creation) and trg_portfolio_strategies_own_capital_on_repoint (BEFORE UPDATE OF strategy_id — repoint, rev-3 finding F4). It reads only NEW.strategy_id and NEW.portfolio_id, so the same predicate is correct on both events. Third-party rows with a NULL or own_capital mark pass, preserving the shipped AddToPortfolio / MigrationWizard / demo-seed paths. SECURITY DEFINER so the mark lookup is not RLS-filtered by the writing session.';



CREATE OR REPLACE FUNCTION "public"."guard_strategies_publish_transition"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Only guard the transition INTO 'published'. On UPDATE, an already-published
  -- row being edited (OLD.status = 'published') is untouched, so owners/admins
  -- can still update other columns on a published strategy. On INSERT there is
  -- no OLD row, so any inserted 'published' row is a fresh transition.
  IF NEW.status = 'published'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'published') THEN
    IF current_user = 'authenticated' THEN
      RAISE EXCEPTION
        'Direct publish of strategy % blocked. Strategies reach status=published '
        'only through the admin review route.', NEW.id
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_strategies_publish_transition"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_strategies_publish_transition"() IS 'Blocks a direct authenticated-role transition into strategies.status=published (INSERT or UPDATE). Gated on current_user=authenticated; the admin review route (service_role) and SECURITY DEFINER RPCs pass. Enforces SC-1 "admin route is the sole publisher" at the table layer. See Phase 110 red-team Finding 1 and migration 20260515114310 (current_user idiom).';



CREATE OR REPLACE FUNCTION "public"."guard_team_review_mark_no_stranded_positions"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_positions INTEGER;
BEGIN
  -- Only the TRANSITION INTO 'team_review' is guarded. IS [NOT] DISTINCT FROM
  -- rather than `=` so a mark of NULL (the retro un-mark path, and this
  -- migration's own guard-test seed step) is unambiguously not a match rather
  -- than a NULL that happens to fall through the IF.
  IF NEW.capital_ownership IS NOT DISTINCT FROM 'team_review'
     AND OLD.capital_ownership IS DISTINCT FROM 'team_review' THEN

    -- OWNER-SCOPED, and this scope is load-bearing twice over (header (d.3)):
    --   * it is EXACTLY the set part 4's RPC deletes, and the RPC deletes
    --     BEFORE it updates — so by the time the sanctioned path reaches this
    --     guard the count is 0 and the flip is admitted; and
    --   * a THIRD-PARTY position therefore does not block an owner's flip,
    --     which is the accepted narrowing in header (g). Widening this count to
    --     every position in the strategy would make a flip impossible whenever
    --     anyone else holds it — hostage-taking by an unrelated allocator.
    -- SECURITY DEFINER (header (d.3)) so this count is not RLS-filtered by the
    -- updating session. Unqualified names are deterministic: search_path is
    -- pinned on the function above.
    SELECT count(*)
      INTO v_positions
      FROM portfolio_strategies ps
      JOIN portfolios p ON p.id = ps.portfolio_id
     WHERE ps.strategy_id = NEW.id
       AND p.user_id = NEW.user_id;

    IF v_positions > 0 THEN
      RAISE EXCEPTION
        'strategy % cannot be marked team_review: % of the owner''s position(s) are still live',
        NEW.id, v_positions
        USING ERRCODE = 'check_violation',
              HINT = 'Use flip_capital_ownership_to_team_review(strategy_id), which removes your positions and sets the mark in ONE transaction.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."guard_team_review_mark_no_stranded_positions"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."guard_team_review_mark_no_stranded_positions"() IS 'OWN-03 / SC 2b, UPDATE side: blocks a transition of strategies.capital_ownership INTO ''team_review'' while a position owned by the strategy''s owner is live, closing the raw-PostgREST-PATCH route into a stranded position that the INSERT-scoped D-03-A trigger cannot see. Owner-scoped ON PURPOSE — it is the same set flip_capital_ownership_to_team_review() deletes FIRST, so the sanctioned RPC still passes, and a third-party position never holds an owner''s flip hostage (migration header (g)). SECURITY DEFINER so the count is not RLS-filtered by the updating session.';



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


CREATE OR REPLACE FUNCTION "public"."ledger_refresh_parse_series_date"("p_text" "text") RETURNS "date"
    LANGUAGE "plpgsql" STABLE STRICT
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  RETURN p_text::date;
EXCEPTION
  WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."ledger_refresh_parse_series_date"("p_text" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."ledger_refresh_parse_series_date"("p_text" "text") IS 'Phase 161.1 / LEDGER-03: parses one returns_series element date, returning NULL instead of raising on malformed input (22007) or an impossible calendar date such as 2026-02-31 (22008). A regex pre-filter alone does NOT cover the second case. NULL drops the element from the max(), so corruption can only make a strategy read STALER, never fresher. Used only by public.ledger_refresh_staleness.';



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
  v_strategy_id      UUID;
  v_current_status   TEXT;
  v_current_token    UUID;
BEGIN
  -- audit-2026-05-07 B5: token is now mandatory. NULL was a documented
  -- pre-mig-117 back-compat path; the only production caller (main_worker)
  -- threads the token uniformly post-PR-#347.
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_done: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Atomic flip running → done with token fence + strategy capture.
  UPDATE compute_jobs
     SET status = 'done'
   WHERE id = p_job_id
     AND status = 'running'
     AND claim_token = p_claim_token
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

    -- mig 109 P6 / mig 117 second-pass fix #2: idempotent retry on
    -- already-done row ONLY when the caller's token matches the recorded
    -- one. The pre-B5 path also accepted NULL — removed now that NULL is
    -- rejected at the entrypoint above.
    IF v_current_status = 'done' THEN
      IF v_current_token IS NOT DISTINCT FROM p_claim_token THEN
        RETURN;
      END IF;
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (late mark on already-done row, caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
       AND v_current_token IS DISTINCT FROM p_claim_token THEN
      RAISE EXCEPTION 'mark_compute_job_done: job % preempted by watchdog reclaim (caller token=%, current token=%)',
        p_job_id, p_claim_token, v_current_token
        USING ERRCODE = 'serialization_failure';
    END IF;

    -- Row in some other state (failed_retry, failed_final, pending,
    -- done_pending_children). Surface loudly.
    RAISE EXCEPTION 'mark_compute_job_done: job % in unexpected status % (expected running)',
      p_job_id, v_current_status
      USING ERRCODE = 'no_data_found';
  END IF;

  -- audit-2026-05-07 G23-187-mig-01/03 RE-APPLY: set-based fan-in advance
  -- with the GIN-supported containment predicate. The strict-token rewrite
  -- (20260528183100) had copied a pre-20260516131500 body and silently
  -- reverted this to a per-child `p_job_id = ANY(parent_job_ids)` FOR-loop,
  -- which the planner CANNOT push to the GIN index compute_jobs_parent_lookup
  -- (only `@>` containment is GIN-supported) -- re-introducing the H-0864
  -- seq-scan + N+1 check_fan_in_ready overhead. The NOT EXISTS sub-query
  -- enforces "all parents done" identically to check_fan_in_ready
  -- (count(parents WHERE status <> 'done') = 0). This form was live in prod
  -- 2026-05-16..2026-05-28 (mig 20260516131500) before the silent revert.
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


COMMENT ON FUNCTION "public"."mark_compute_job_done"("p_job_id" "uuid", "p_claim_token" "uuid") IS 'Terminal success transition. Migration 117 P97 fence + B5 strict-token gate (20260528183100): p_claim_token MUST be non-NULL (NULL raises 22023); mismatch raises serialization_failure. THIS migration (G23-187-mig-01/03): re-applies the GIN-supported set-based `parent_job_ids @> ARRAY[p_job_id]` fan-in advance (the strict-token rewrite had reverted it to a `= ANY(...)` FOR-loop). Preserves the mig 099 Phase-18 atomic UI status bridge.';



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
  -- audit-2026-05-07 B5: token mandatory (see mark_compute_job_done above).
  IF p_claim_token IS NULL THEN
    RAISE EXCEPTION 'mark_compute_job_failed: p_claim_token is required (post-mig-117 strict fence)'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

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
      AND claim_token = p_claim_token
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

    -- mig 117 P97: token mismatch on a still-running row.
    IF v_current_status = 'running'
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
    CASE
      WHEN v_attempts <= 1 THEN v_next_attempt := now() + interval '30 seconds';
      WHEN v_attempts = 2 THEN v_next_attempt := now() + interval '2 minutes';
      WHEN v_attempts = 3 THEN v_next_attempt := now() + interval '10 minutes';
      WHEN v_attempts = 4 THEN v_next_attempt := now() + interval '1 hour';
      ELSE                     v_next_attempt := now() + interval '6 hours';
    END CASE;
  END IF;

  -- HOTFIX 2026-05-29: write `error_kind` (the real column + CHECK target),
  -- NOT the non-existent `last_error_kind` that mig 20260528183100 introduced.
  UPDATE compute_jobs
     SET status = v_new_status,
         last_error = p_error,
         error_kind = p_error_kind,
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


COMMENT ON FUNCTION "public"."mark_compute_job_failed"("p_job_id" "uuid", "p_error" "text", "p_error_kind" "text", "p_claim_token" "uuid") IS 'Terminal failure transition. Mig 117 / P97 fence + B5 strict-token follow-up: p_claim_token MUST be non-NULL (NULL raises 22023 invalid_parameter_value); mismatch raises serialization_failure. Backoff schedule preserved verbatim from mig 109 P4. HOTFIX 20260529180000: writes error_kind (not the non-existent last_error_kind that mig 20260528183100 typo-introduced, which 42703-errored every failed mark).';



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



CREATE OR REPLACE FUNCTION "public"."phase19_soak_record_day"("p_date_utc" "date", "p_day_index" smallint, "p_error_rate" numeric, "p_total_events" integer, "p_error_events" integer, "p_notes" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_is_service_role BOOLEAN := FALSE;
  v_caller_role TEXT;
BEGIN
  -- Defense in depth: service_role only. SECDEF bypasses RLS, so this gate
  -- is what prevents a future ACL relaxation from letting a compromised
  -- authenticated session forge daily rollup rows.
  --
  -- Use auth.role() (reads JWT claim) NOT current_user — current_user inside
  -- a SECURITY DEFINER body equals the function owner (typically postgres),
  -- not the caller. Wrap in BEGIN/EXCEPTION mirroring 20260515113910 so a
  -- direct-psql call (no JWT context) raises a clean error instead of crashing.
  BEGIN
    v_caller_role := auth.role();
    v_is_service_role := (v_caller_role = 'service_role');
  EXCEPTION WHEN OTHERS THEN
    v_is_service_role := FALSE;
    v_caller_role := 'unknown';
  END;

  IF NOT v_is_service_role THEN
    RAISE EXCEPTION 'phase19_soak_record_day: only service_role may write rollup rows (auth.role()=%)', v_caller_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.phase19_soak_daily (
    date_utc, day_index, error_rate, total_events, error_events, notes, recorded_at
  ) VALUES (
    p_date_utc, p_day_index, p_error_rate, p_total_events, p_error_events, p_notes, now()
  )
  ON CONFLICT (date_utc) DO UPDATE SET
    day_index    = EXCLUDED.day_index,
    error_rate   = EXCLUDED.error_rate,
    total_events = EXCLUDED.total_events,
    error_events = EXCLUDED.error_events,
    notes        = EXCLUDED.notes,
    recorded_at  = now();

  RETURN jsonb_build_object(
    'ok',         true,
    'date_utc',   p_date_utc,
    'day_index',  p_day_index,
    'error_rate', p_error_rate
  );
END;
$$;


ALTER FUNCTION "public"."phase19_soak_record_day"("p_date_utc" "date", "p_day_index" smallint, "p_error_rate" numeric, "p_total_events" integer, "p_error_events" integer, "p_notes" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase19_soak_record_day"("p_date_utc" "date", "p_day_index" smallint, "p_error_rate" numeric, "p_total_events" integer, "p_error_events" integer, "p_notes" "text") IS 'Phase 19 BACKBONE-04 upsert RPC for daily rollup. Idempotent on (date_utc) so a cron retry or manual backfill replaces the prior row. service_role only.';



CREATE OR REPLACE FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone DEFAULT "now"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_flag             TEXT;
  v_is_view          BOOLEAN;
  v_legacy_writes    BIGINT  := 0;
  v_daily_rows       INTEGER := 0;
  v_max_error_rate   NUMERIC := 0;
  v_breach_count     INTEGER := 0;
BEGIN
  SELECT value INTO v_flag
    FROM feature_flags
   WHERE flag_key = 'process_key_unified_backbone';

  SELECT EXISTS(
    SELECT 1 FROM information_schema.views
     WHERE table_schema = 'public' AND table_name = 'verification_requests'
  ) INTO v_is_view;

  -- Pre-view-shim: count direct writes to the legacy base table.
  -- Post-view-shim: gate is retired and value is meaningless, so report 0.
  IF NOT v_is_view THEN
    SELECT count(*) INTO v_legacy_writes
      FROM verification_requests
     WHERE created_at > p_since
        OR (completed_at IS NOT NULL AND completed_at > p_since);
  END IF;

  -- Daily rollup state — count rows with date >= p_since's date so a soak
  -- that started mid-day still picks up day 1's row written by the cron.
  SELECT count(*),
         COALESCE(max(error_rate), 0),
         count(*) FILTER (WHERE error_rate >= 0.005)
    INTO v_daily_rows, v_max_error_rate, v_breach_count
    FROM public.phase19_soak_daily
   WHERE date_utc >= (p_since AT TIME ZONE 'UTC')::date;

  RETURN jsonb_build_object(
    'flag_value',         COALESCE(v_flag, 'unset'),
    'vr_is_view',         v_is_view,
    'legacy_write_count', v_legacy_writes,
    'daily_rows',         v_daily_rows,
    'max_error_rate',     v_max_error_rate,
    'breach_count',       v_breach_count,
    'since',              p_since,
    'checked_at',         now()
  );
END;
$$;


ALTER FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) IS 'Phase 19 soak probe. SECURITY DEFINER; returns ONLY scalars. Extended 2026-05-27 to also report phase19_soak_daily rollup counts (daily_rows, max_error_rate, breach_count) so the phase-19-stability.yml workflow can verify both legacy-write absence AND daily-row presence in one round-trip. No row data / PII.';



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


CREATE OR REPLACE FUNCTION "public"."prevent_api_key_venue_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Privileged callers may rewrite the venue: the analytics worker and the
  -- support/admin routes run as service_role; migrations, backfills and every
  -- SECURITY DEFINER RPC run as the table owner.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NEW.exchange IS DISTINCT FROM OLD.exchange THEN
    RAISE EXCEPTION
      'api_keys.exchange is server-attested and cannot be changed from the client; it is the input to the submit-time scope-broadening check and to the asset_class annualization stamp.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_api_key_venue_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_api_key_venue_change"() IS 'Defense-in-depth lock on api_keys.exchange (2026-08-10, review CR-01). SECURITY INVOKER so current_user is the real caller — a DEFINER form would be a no-op. Primary gate is the table-level UPDATE REVOKE in the same migration; this trigger backstops a future re-grant. exchange is the input to the finalize-wizard scope-broadening probe gate, so a client-writable value let a key owner switch an ASVS V4 control off for their own key.';



CREATE OR REPLACE FUNCTION "public"."prevent_profile_privileged_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Privileged callers may write these columns: service_role (admin support
  -- routes, the role-revoke flow, the analytics worker), and postgres /
  -- supabase_admin (the handle_new_user signup trigger, migrations, backfills).
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A non-privileged self-INSERT (should be impossible now — INSERT is
    -- revoked — but backstops a re-grant) must not seed an elevated profile.
    IF NEW.is_admin IS TRUE OR NEW.tenant_id IS NOT NULL THEN
      RAISE EXCEPTION
        'profiles: a client cannot create a row with elevated is_admin / tenant_id; use a service-role path.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: block any change to a privileged column (backstops a column re-grant).
  IF NEW.is_admin         IS DISTINCT FROM OLD.is_admin
     OR NEW.role          IS DISTINCT FROM OLD.role
     OR NEW.tenant_id     IS DISTINCT FROM OLD.tenant_id
     OR NEW.allocator_status IS DISTINCT FROM OLD.allocator_status
     OR NEW.manager_status   IS DISTINCT FROM OLD.manager_status
     OR NEW.partner_tag   IS DISTINCT FROM OLD.partner_tag
  THEN
    RAISE EXCEPTION
      'profiles privileged columns (is_admin, role, tenant_id, allocator_status, manager_status, partner_tag) cannot be changed from the client; use an admin / service-role path.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_profile_privileged_change"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."prevent_profile_privileged_change"() IS 'Defense-in-depth lock on privileged profiles columns (is_admin, role, tenant_id, allocator_status, manager_status, partner_tag) (2026-05-29). SECURITY INVOKER so current_user is the real caller — supersedes the no-op SECURITY DEFINER prevent_profile_role_change. Primary gate is the per-column UPDATE GRANT allowlist (privileged columns ungranted) + the INSERT/DELETE REVOKE; this trigger backstops a re-grant.';



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



CREATE OR REPLACE FUNCTION "public"."replace_allocator_equity_snapshots"("p_allocator_id" "uuid", "p_rows" "jsonb", "p_depth_months" integer) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  -- H-1186: serialize against delete_allocator_api_key on the same per-allocator
  -- key so a concurrent last-key cascade cannot interleave with this replace.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || p_allocator_id::text));

  -- 1. Purge — strictly scoped to this allocator.
  DELETE FROM public.allocator_equity_snapshots
    WHERE allocator_id = p_allocator_id;

  -- 2. Insert the freshly replayed rows. jsonb_to_recordset projects the
  --    array; reconstructed_at uses the column DEFAULT (now()). The CASE on
  --    source mirrors persist_equity_snapshots' WR-05 per-row depth rule.
  --    CL9: pre_terminus_balance_unknown is projected too; COALESCE to false
  --    keeps a pre-deploy worker (payload omits the field) NOT-NULL-safe.
  WITH ins AS (
    INSERT INTO public.allocator_equity_snapshots (
      allocator_id, asof, value_usd, breakdown, source, history_depth_months,
      pre_terminus_balance_unknown
    )
    SELECT
      p_allocator_id,
      r.asof,
      r.value_usd,
      r.breakdown,
      r.source,
      CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END,
      COALESCE(r.pre_terminus_balance_unknown, false)
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
      asof                          DATE,
      value_usd                     NUMERIC,
      breakdown                     JSONB,
      source                        TEXT,
      pre_terminus_balance_unknown  BOOLEAN
    )
    ON CONFLICT (allocator_id, asof) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;


ALTER FUNCTION "public"."replace_allocator_equity_snapshots"("p_allocator_id" "uuid", "p_rows" "jsonb", "p_depth_months" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."replace_allocator_equity_snapshots"("p_allocator_id" "uuid", "p_rows" "jsonb", "p_depth_months" integer) IS 'Atomic sole-key equity-history replacement: per-allocator advisory-lock (H-1186) then DELETE all rows for p_allocator_id then INSERT p_rows in ONE transaction (E4/HIGH8). Serializes with delete_allocator_api_key on hashtext(''alloc:''||allocator). Per-row history_depth_months mirrors persist_equity_snapshots WR-05; persists pre_terminus_balance_unknown (CL9/NEW-C01-11, COALESCE to false). service_role only.';



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



CREATE OR REPLACE FUNCTION "public"."revoke_strategy_share"("p_strategy_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_rows INTEGER;
BEGIN
  -- ⛔ FAIL LOUD for a caller with no authenticated identity (founder ruling
  -- 2026-08-27), and BEFORE the p_strategy_id convergence exit below — an
  -- admin client passing NULL must not receive the indistinguishable 0.
  -- Without this guard a `service_role` caller (BYPASSRLS — and STEP 2 records
  -- that this feature's recipient lane already reads this table through
  -- `createAdminClient()`) reaches the UPDATE with NO policy applied, revokes
  -- ANY tenant's live share and gets `1` back: a silent cross-tenant kill
  -- switch that reports success. The ownership predicate below closes the same
  -- hole from the other side; a 0-row return would not be enough on its own,
  -- because the route maps 0 to a 404 the client reads as SUCCESS.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'revoke_strategy_share: no authenticated user — not callable by a service-role/admin client'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_strategy_id IS NULL THEN
    RETURN 0;   -- nothing to revoke; converges like any other miss
  END IF;

  -- ⭐ `created_by = auth.uid()` is LOAD-BEARING, not a restatement of the
  -- policy. For an ordinary `authenticated` caller the strategy_shares_owner
  -- USING clause already scopes this UPDATE; for a BYPASSRLS role it does not,
  -- and this predicate is then the ONLY thing standing between the caller and
  -- another tenant's counter. Defense-in-depth behind the guard above.
  UPDATE public.strategy_shares
     SET revoked_at = now(),
         generation = generation + 1
   WHERE strategy_id = p_strategy_id
     AND created_by = auth.uid()
     AND revoked_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;


ALTER FUNCTION "public"."revoke_strategy_share"("p_strategy_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."revoke_strategy_share"("p_strategy_id" "uuid") IS 'Phase 164 / SHARE-03. Revokes a strategy share in ONE atomic statement: stamps revoked_at AND increments generation together, so every previously-copied link dies at the same instant and no read-modify-write race can leave the counter short. Returns the affected row count: 1 = just revoked, 0 = already revoked or never shared (CONVERGENCE — the route maps it to 404 and the client treats it as success). Soft-revoke only; rows are never deleted. SECURITY INVOKER — RLS scopes it to the caller''s own rows, and the UPDATE carries an independent `created_by = auth.uid()` predicate for the case where RLS does NOT apply. ⛔ RAISES insufficient_privilege when auth.uid() IS NULL: without that, a BYPASSRLS service-role caller was an unauthenticated cross-tenant kill switch that returned 1 and read as success. Not callable by a service-role/admin client, by design.';



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

  -- Phase 164 / B1 (2026-08-27) — kill every share link the subject minted.
  -- `strategy_shares` (migration 20260827120000) holds a `generation` counter
  -- from which an anonymous capability URL to an UNPUBLISHED factsheet is
  -- derived in Node. The anonymize above does NOT empty the factsheet, and
  -- neither FK cascade fires here because this function deletes neither
  -- `profiles` nor `auth.users` — so without this statement every link the
  -- subject ever handed out keeps working forever after their Art. 17 erasure,
  -- and the `banned_until = 'infinity'` below means they can never log back in
  -- to revoke it themselves.
  --
  -- Bumping `generation` is what actually kills the links: the token is
  -- HMAC(secret, strategy_id || generation), so +1 invalidates every url ever
  -- copied, at once. Stamping `revoked_at` alone would be COSMETIC.
  --
  -- REVOKE, NEVER DELETE. A delete discards the counter; the next mint for that
  -- strategy would restart at generation 1 and RESURRECT every token minted at
  -- generation 1, including ones already revoked. The row holds no PII, so
  -- retaining it costs the subject nothing.
  UPDATE strategy_shares
     SET revoked_at = now(),
         generation = generation + 1
   WHERE created_by = p_user_id
     AND revoked_at IS NULL;

  IF v_target_email IS NOT NULL THEN
    -- ⛔ verification_requests_legacy IS THE TABLE. `verification_requests` is a
    -- VIEW (relkind 'v', 13 cols) that 20260620120000_verification_requests_view_shim_apply.sql
    -- repointed this DELETE away from — MANDATORY, because erasure aimed at the
    -- view hits its INSTEAD OF trigger instead of the rows. That shim was a
    -- SURGICAL in-place patch, so it matches no grep for this function and the
    -- repo held no copy of it; re-basing on the newest FULL body in the repo
    -- (20260517013100) therefore silently REVERTED it. See DRIFT-02 in root
    -- TODOS.md. Corrected 2026-08-27 against PROD's live pg_get_functiondef
    -- (md5 2f4ccf13db95b93464e028e5bce1e0f4) — the diff proved this identifier
    -- was the ONLY substantive drift in the whole 193-line body.
    DELETE FROM verification_requests_legacy WHERE email = v_target_email;

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


COMMENT ON FUNCTION "public"."sanitize_user"("p_user_id" "uuid") IS 'GDPR Art. 17 anonymize-not-delete RPC. SECURITY DEFINER. Idempotent. service_role-only EXECUTE. Migration 120 added sentinel-rejection trigger signaling, partner_tag NULLing, defensive organizations predicate, auth.users anonymize + session purge. audit-2026-05-07 H-0899/H-0900/H-0905/H-0908/H-0909 additions: pg_advisory_xact_lock serializes concurrent admin invocations, sole-admin organization detection emits orphan audit_log rows, the sanitize itself emits one audit_log row per successful run. audit-2026-05-07 M-0796: purges notification_dispatches keyed to the target email (GDPR Art. 17 immediate erasure of recipient PII). PR #182 retro audit (Task #57): recipient_email match uses LOWER(...) case-insensitivity per RFC 5321 to avoid silently missing rows when profiles.email and notification_dispatches.recipient_email differ only in casing. Phase 164 / B1: REVOKES every live strategy_shares row the subject created (revoked_at stamped + generation bumped), because this function deletes neither profiles nor auth.users, so NO FK cascade fires and every anonymous capability URL to the subject''s unpublished factsheet would otherwise outlive the erasure — with no way for the subject to revoke it themselves, since this same body bans them and purges their sessions. The share row is retained, never deleted: it holds no token (D-02), and deleting it would rewind the generation counter and resurrect the links this arm just killed.';



CREATE OR REPLACE FUNCTION "public"."scrub_client_supplied_attested_venue"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Privileged writers keep whatever they supplied: the two SECURITY DEFINER
  -- wizard RPCs run as the table owner, the analytics worker and the
  -- support/admin routes run as service_role, and migrations/backfills run as
  -- postgres. Everyone else — every browser session, on every client INSERT
  -- path including a DELETE-then-re-INSERT round trip — lands NULL.
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- Scrub, do not refuse. Raising here would break the two live client INSERT
  -- paths (ApiKeyManager, StrategyForm) for a value they have no business
  -- setting, and D-02/D-03 keep those paths open on purpose. NULL is the
  -- honest answer: "no server attestation", which the probe gate reads as
  -- PROBE.
  NEW.attested_venue := NULL;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."scrub_client_supplied_attested_venue"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."scrub_client_supplied_attested_venue"() IS 'Phase 153.6 / PARITY-04. NULLs a client-supplied api_keys.attested_venue on INSERT so the finalize-wizard scope-broadening probe gate reads only values written by the two SECURITY DEFINER wizard RPCs. SECURITY INVOKER so current_user is the REAL caller — a DEFINER form would be a no-op. It scrubs rather than raises, because the client INSERT path stays open by design (153.6 D-02/D-03).';



CREATE OR REPLACE FUNCTION "public"."scrub_client_supplied_venue_account_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  NEW.venue_account_id := NULL;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."scrub_client_supplied_venue_account_id"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."scrub_client_supplied_venue_account_id"() IS 'Phase 154 / WIZCONT-02. NULLs a client-supplied api_keys.venue_account_id on INSERT. SECURITY INVOKER so current_user is the REAL caller — a DEFINER form would be a silent no-op. Sibling of scrub_client_supplied_attested_venue (20260811210000).';



CREATE OR REPLACE FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


COMMENT ON FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() IS 'Seeds the NULL-weight companion weight_snapshots row for a new portfolio_strategies position (migration 20260416125431). SECURITY DEFINER since 20260806130000: weight_snapshots denies ALL client writes by policy, so under SECURITY INVOKER this trigger aborted every authenticated-role INSERT into portfolio_strategies with 42501 — breaking AddToPortfolio.tsx and MigrationWizard.tsx in production from 2026-04-16. The deny policies are the design and are unchanged; the DEFINER context is what separates the database''s own bookkeeping write from a client write.';



CREATE OR REPLACE FUNCTION "public"."seed_weight_snapshots_for_portfolio"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
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


COMMENT ON FUNCTION "public"."seed_weight_snapshots_for_portfolio"() IS 'Fan-out sibling of seed_weight_snapshot_for_portfolio_strategy: seeds NULL-weight weight_snapshots rows for every existing child of a newly inserted portfolio (migration 20260416125431). SECURITY DEFINER since 20260806130000 for the same reason as its sibling — weight_snapshots denies all client writes, so an INVOKER fan-out that finds any child row aborts the parent INSERT with 42501.';



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


CREATE OR REPLACE FUNCTION "public"."set_compute_job_progress"("p_job_id" "uuid", "p_claim_token" "uuid", "p_progress" "jsonb") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- Fenced JSONB merge: `||` replaces ONLY the member_progress /
  -- member_progress_at keys and preserves every other metadata key
  -- (source, correlation_id, unified_backbone_at_claim). member_progress_at
  -- is stamped SERVER-SIDE via now() so the 95-03 stall heartbeat cannot be
  -- back-dated by a lagging worker clock.
  UPDATE compute_jobs
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                 || jsonb_build_object(
                      'member_progress',    p_progress,
                      'member_progress_at', to_jsonb(now())
                    )
   WHERE id = p_job_id
     AND claim_token IS NOT DISTINCT FROM p_claim_token
     AND claim_token IS NOT NULL
     AND status = 'running';
  RETURN FOUND;
END;
$$;


ALTER FUNCTION "public"."set_compute_job_progress"("p_job_id" "uuid", "p_claim_token" "uuid", "p_progress" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_compute_job_progress"("p_job_id" "uuid", "p_claim_token" "uuid", "p_progress" "jsonb") IS 'Phase 95 / PROG-02: claim-token-fenced JSONB-merge of per-member stitch progress (member_progress array) + a server-stamped member_progress_at heartbeat into compute_jobs.metadata. Merges (||) so source / correlation_id / unified_backbone_at_claim survive. Fence mirrors the P97 mark/defer RPCs (claim_token IS NOT DISTINCT FROM p_claim_token AND claim_token IS NOT NULL AND status=running): a stale/NULLed token or a non-running row no-ops. Best-effort — RETURN FOUND, never raises; the worker treats false as lost ownership and never fails the stitch. service_role only. See migration 20260712130000 + .planning/phases/95-stitch-progress-transparency/.';



CREATE OR REPLACE FUNCTION "public"."set_wizard_composite_members"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_members" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    SET "lock_timeout" TO '3s'
    AS $$
DECLARE
  v_auth_uid UUID := auth.uid();
  v_api_key_id UUID;
  v_count INTEGER;
  v_existing_sig TEXT[];
  v_incoming_sig TEXT[];
BEGIN
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'set_wizard_composite_members called without an auth session'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'set_wizard_composite_members: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Ownership + composite-DRAFT guard in ONE least-disclosure lookup: filtering
  -- by user_id AND status='draft' means "not found", "not owned", and
  -- "not a draft (already published/pending_review/archived)" are ALL
  -- indistinguishable to the caller (no existence oracle, uniform 42501).
  -- A single-key strategy (api_key_id NOT NULL) can NEVER acquire members
  -- through this fn (protects composite-detection).
  --
  -- RT2-FINDING-1: the status='draft' predicate is LOAD-BEARING, not cosmetic.
  -- The fn's name/comments/error all say "composite DRAFT", but a PUBLISHED
  -- composite ALSO keeps api_key_id NULL, so without this predicate an owner
  -- POSTing /api/strategies/composite/set-members for their OWN published
  -- composite would wholesale-rewrite strategy_keys AND (via the RT-FINDING-1
  -- invalidation below) flip the published strategy_analytics.computation_status
  -- complete -> pending, degrading the live public factsheet to the computing
  -- placeholder until a re-stitch re-attests over the post-review member set —
  -- with zero admin visibility. The wizard set-members flow ONLY ever targets a
  -- draft (the "Continue" handoff runs strictly before finalize_wizard_strategy
  -- moves the row off 'draft'), so gating to draft breaks no legitimate caller.
  SELECT api_key_id
    INTO v_api_key_id
    FROM strategies
   WHERE id = p_strategy_id
     AND user_id = p_user_id
     AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'set_wizard_composite_members: no composite draft for the caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_api_key_id IS NOT NULL THEN
    RAISE EXCEPTION 'set_wizard_composite_members: target is a single-key strategy, not a composite draft';
  END IF;

  -- RT-FINDING-1: capture the EXISTING member signature BEFORE the wholesale
  -- delete so a genuine change vs a no-op re-Continue can be distinguished. The
  -- signature is order-independent over the stitch-determining tuple
  -- (api_key_id, window_start, window_end) — seq is derived, not an input, so a
  -- pure reorder that yields the same tuple SET is NOT a stitch-affecting change.
  -- window_end NULL (open-ended/live) normalizes to '' on both sides.
  SELECT array_agg(sig ORDER BY sig)
    INTO v_existing_sig
    FROM (
      SELECT sk.api_key_id::text || '|' || sk.window_start::text || '|'
             || COALESCE(sk.window_end::text, '')
        FROM strategy_keys sk
       WHERE sk.strategy_id = p_strategy_id
    ) AS e(sig);

  SELECT array_agg(sig ORDER BY sig)
    INTO v_incoming_sig
    FROM (
      -- Normalize the incoming api_key_id via ::uuid::text so it is CANONICAL
      -- (lowercase, brace-free) and symmetric with the existing side's
      -- sk.api_key_id::text. A non-canonical client UUID (uppercase/braces)
      -- would otherwise produce a mismatched signature → a false "changed" →
      -- an unnecessary re-stitch, defeating the WIZ-05 no-op latency win.
      SELECT (elem->>'api_key_id')::uuid::text || '|'
             || (elem->>'window_start')::date::text || '|'
             || COALESCE((elem->>'window_end')::date::text, '')
        FROM jsonb_array_elements(p_members) AS elem
    ) AS i(sig);

  -- WHOLESALE rewrite: DELETE all members, then INSERT with seq derived from
  -- window_start ASC order (1-indexed). No in-place seq UPDATE ⇒ no transient
  -- (strategy_id, seq) 23505 on reorder (L-4 dissolved). The existing
  -- strategy_keys_owner_coherence trigger enforces cross-tenant coherence on
  -- each INSERT — no app-layer duplicate. Deterministic tiebreak on api_key_id
  -- keeps seq stable if two members share a window_start.
  DELETE FROM strategy_keys WHERE strategy_id = p_strategy_id;

  INSERT INTO strategy_keys (
    strategy_id, api_key_id, owner_id, window_start, window_end, seq
  )
  SELECT
    p_strategy_id,
    (elem->>'api_key_id')::uuid,
    p_user_id,
    (elem->>'window_start')::date,
    (elem->>'window_end')::date,
    (row_number() OVER (
       ORDER BY (elem->>'window_start')::date ASC, (elem->>'api_key_id')
     ))::int
  FROM jsonb_array_elements(p_members) AS elem;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- RT-FINDING-1: when the member set ACTUALLY changed, invalidate a stale
  -- COMPLETED composite analytics row so the wizard re-stitches instead of
  -- short-circuiting to the old metrics. Scoped to completed/idle rows only
  -- (never a 'computing' row the worker owns) — see the writer-discipline
  -- justification in the migration header. An identical re-Continue skips this
  -- (WIZ-05 no-op latency invariant). IS DISTINCT FROM handles the NULL
  -- (no prior members) case as "changed" — harmless (no completed row to reset
  -- on a first write, and the kickoff derives it fresh anyway).
  IF v_existing_sig IS DISTINCT FROM v_incoming_sig THEN
    UPDATE strategy_analytics
       SET computation_status = 'pending',
           computation_error = NULL
     WHERE strategy_id = p_strategy_id
       AND computation_status IN ('complete', 'complete_with_warnings');
  END IF;

  RETURN v_count;
END;
$$;


ALTER FUNCTION "public"."set_wizard_composite_members"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_members" "jsonb") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_wizard_composite_members"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_members" "jsonb") IS 'ONB-03/L-4 + RT-FINDING-1: wholesale delete-then-insert of a composite draft''s strategy_keys members (seq derived server-side from window_start ASC). When the incoming member set DIFFERS from the persisted one (order-independent signature over api_key_id+window_start+window_end), invalidates a stale COMPLETED strategy_analytics row (computation_status complete/complete_with_warnings -> pending) so the wizard verify step re-stitches instead of short-circuiting to the old metrics; an identical re-Continue leaves analytics untouched (WIZ-05 no-op invariant). Only touches completed/idle rows, never a computing row the worker owns. Guards: auth.uid()=p_user_id, strategy owned by caller, status=''draft'' (a published/pending_review/archived composite is rejected with the SAME uniform not-owned 42501 so an owner cannot rewrite an attested member set or invalidate published analytics), api_key_id IS NULL. Returns the member count written.';



CREATE OR REPLACE FUNCTION "public"."stamp_api_key_429"("p_api_key_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  IF p_api_key_id IS NULL THEN
    RAISE EXCEPTION 'stamp_api_key_429: p_api_key_id is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Defense-in-depth ownership gate, mirroring the sibling user-facing stamp
  -- update_api_key_rate_limit (mig 111). _assert_owner is a NO-OP under the
  -- service role (auth.uid() IS NULL → returns early), so the worker — the
  -- sole intended caller — pays nothing. Its only effect is to block a
  -- cross-tenant write (stamping ANY user's last_429_at to force-trip their
  -- breaker / DoS their syncs) should EXECUTE ever be re-granted to
  -- authenticated by a future migration. Without it the cross-tenant write
  -- path would be gated by the REVOKE alone — a single line, in a table with
  -- a documented history of REVOKEs silently no-opping (mig 027).
  PERFORM _assert_owner('api_keys'::regclass, p_api_key_id, 'stamp_api_key_429');

  -- Always stamp the latest 429 from the DB clock. A missing row (key
  -- deleted between claim and stamp) is a no-op: the breaker stamp is
  -- best-effort and must never convert a 429 into a hard error that would
  -- fail the job.
  UPDATE api_keys
     SET last_429_at = now()
   WHERE id = p_api_key_id;
END;
$$;


ALTER FUNCTION "public"."stamp_api_key_429"("p_api_key_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."stamp_api_key_429"("p_api_key_id" "uuid") IS 'NEW-C12-10 (CL10): stamps api_keys.last_429_at = now() using the DB clock so the worker circuit breaker (see api_key_cooldown_remaining) compares a single clock across Railway replicas. No per-key dedup/audit/owner-assert (distinct from update_api_key_rate_limit, mig 111, which serves the user-facing rate-limit grief path). Service-role worker only.';



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


CREATE OR REPLACE FUNCTION "public"."strategy_analytics_stamp_computing_started"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
BEGIN
  -- TG_OP is always 'UPDATE' here (see the trigger definition in STEP 2); the
  -- arms below are written to be read alongside the four cases named in the
  -- header.
  IF NEW.computation_status = 'computing' THEN

    IF OLD.computation_status = 'computing'
       AND OLD.computing_started_at IS NOT NULL THEN
      -- ARM (a) -- NEVER ADVANCE. The row was already computing and already had
      -- a clock; whatever this writer supplied is discarded and the original
      -- start time is restored. This is D-01 closed at the table: it binds the
      -- Python upsert's conflict path, the SQL bridge, pg_cron, and every writer
      -- not yet written.
      --
      -- ⚠️ The `OLD.computing_started_at IS NOT NULL` conjunct is LOAD-BEARING.
      -- Without it, the companion clock-start arm in STEP 4 (an UPDATE of a
      -- ('computing', NULL) row) would be coerced straight back to NULL and D-11
      -- would stay open with a green gate over it.
      NEW.computing_started_at := OLD.computing_started_at;

    ELSIF NEW.computing_started_at IS NULL THEN
      -- ARM (b) -- a computing row must never sit unstamped after an UPDATE.
      -- Closes the NULL-stamp hole at the writer boundary for the UPDATE path.
      -- The rows that ALREADY exist, or that arrive via the insert path this
      -- trigger does not see, are the companion arm's job -- not this arm's.
      NEW.computing_started_at := now();

    -- ARM (c) -- fall through, deliberately. A genuine transition IN
    -- (OLD.computation_status IS DISTINCT FROM 'computing') that supplies its
    -- own non-NULL stamp is RESPECTED as written: the one-shot backfill anchor
    -- in 20260802120000 STEP 2 and the bridge's transition-in now() both depend
    -- on that.
    END IF;

  ELSE
    -- ARM (d) -- every exit clears the reaper key, unconditionally. A stale
    -- stamp left on a terminal row is exactly what the reaper could later
    -- re-fire on.
    NEW.computing_started_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."strategy_analytics_stamp_computing_started"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."strategy_analytics_stamp_computing_started"() IS 'JOB-01 / Phase 142.1 D-17: enforces the computing_started_at invariant at the table for EVERY writer. On an update of an already-computing row that already carries a stamp it COERCES the new value back to the old one (never advance), silently -- raising would kill the live analytics_runner _mark_computing call, burn its retries and strand the strategy. A computing row left unstamped by an update is stamped now(); a genuine transition in that supplies its own stamp is respected; any row leaving computing has the stamp cleared. Self-contained: reads only NEW/OLD/TG_OP, calls only now(), invokes no helper (see migration 20260516170000:3-11 for the incident class that rule exists to avoid).';



CREATE OR REPLACE FUNCTION "public"."strategy_shares_enforce_monotonic_generation"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  -- (I) INSERT: the starting counter is not EXPRESSIBLE by any caller.
  -- ⛔ Must be the first statement and must RETURN. On an INSERT `OLD` is
  -- unassigned, and PL/pgSQL raises "record old is not assigned yet" on the
  -- very first comparison below — so every rule after this point is
  -- UPDATE-only by construction, not by convention.
  -- FORCE rather than reject: a rejection lets the caller learn which starting
  -- values are legal, and every legal value other than 1 is a bug. Overwriting
  -- means no caller — not `authenticated`, not `service_role`, not a future
  -- BYPASSRLS maintenance script — can express a starting generation at all.
  -- ⛔⛔ `nonce` IS RE-ROLLED HERE, AND LEAVING IT TO THE COLUMN DEFAULT WAS A
  -- MEASURED HOLE (2026-08-28 three-reviewer gate, F-3). A DEFAULT only applies
  -- when the statement does not NAME the column; a caller that names it supplies
  -- its own value, and rule (0c) below is UPDATE-only by construction. STEP 2's
  -- column grant closes the naming for `authenticated` — and for nobody else.
  -- MEASURED on a throwaway PostgreSQL 16 cluster, with this line absent:
  --   1. owner mints                       -> generation 1, nonce N
  --   2. owner revokes                     -> generation 2; the token derived
  --                                           from (N, 1) is now DEAD
  --   3. `SET ROLE service_role; DELETE FROM strategy_shares ...`
  --   4. `SET ROLE service_role; INSERT INTO strategy_shares
  --       (strategy_id, created_by, nonce) VALUES (..., N)`
  --   -> stored row came back as generation 1 (this branch FORCED it back down),
  --      nonce N, revoked_at NULL. The (nonce, generation, live) triple is
  --      byte-identical to the pre-revoke one, so HMAC over it re-derives the
  --      REVOKED token exactly. Step 3+4 also fully reverses an Art. 17 erasure.
  -- ⭐ Forcing rather than rejecting, for the same reason `generation` is forced:
  -- a rejection teaches the caller which values are legal. Overwriting means no
  -- caller — not `authenticated`, not `service_role`, not a future BYPASSRLS
  -- maintenance script — can express a nonce at all, so a destroyed-and-
  -- recreated row ALWAYS lands in a token space disjoint from every token that
  -- row ever issued. That is the property the nonce exists to provide, and
  -- before this line it held only against callers who obey column grants.
  -- ⚠️ It does not disturb the mint lane: `create_strategy_share` never NAMES
  -- `nonce` (STEP 3, pinned by STEP 6 arm (ii-d) and by SHAPE 4d), and it reads
  -- the value back through `RETURNING`, which observes the post-trigger tuple —
  -- MEASURED clean on both the INSERT and the ON CONFLICT path.
  -- ⚠️ AND IT DOES NOT TOUCH REUSE OR REACTIVATION. `INSERT ... ON CONFLICT DO
  -- UPDATE` fires this branch on the PROPOSED tuple, which is then DISCARDED on
  -- conflict; the surviving row keeps its own nonce, so OWNER 2d (live reuse
  -- returns the SAME nonce) and REACTIVATE 1g (revoke -> re-share returns the
  -- SAME nonce) both stay green — measured, not assumed.
  --
  -- ⚠️ RULE (0b) HAS NO INSERT HALF AND DELIBERATELY GAINS NONE. A service_role
  -- INSERT can still choose `id` and `created_at`. That is NOT closed here and
  -- the COMMENT on this function is worded accordingly: (0b) is a claim about
  -- never REWRITING provenance on a surviving row, not about establishing it.
  -- Provenance on INSERT is caller-supplied by design — `created_by` IS the
  -- mint RPC's `auth.uid()`, so forcing it is not available — and neither `id`
  -- nor `created_at` is an input to the MAC, so neither buys a token. The nonce
  -- is forced because it IS a MAC input; the rest is documented, not guarded.
  IF TG_OP = 'INSERT' THEN
    NEW.generation := 1;
    NEW.nonce := gen_random_uuid();
    RETURN NEW;
  END IF;

  -- (0a) the counter is bound to ONE strategy, permanently.
  IF NEW.strategy_id IS DISTINCT FROM OLD.strategy_id THEN
    RAISE EXCEPTION 'strategy_shares: strategy_id is immutable — refusing to re-point the share row for strategy % at strategy %. The generation counter is only meaningful RELATIVE to the strategy it counts for. Moving it leaves the original strategy with NO share row, so the very next create_strategy_share() inserts a fresh one at generation 1 and re-issues every token that strategy ever had at generation 1 — including the ones that were explicitly REVOKED. Two requests, both legitimate for the row owner, same end state as rewinding the counter.',
      OLD.strategy_id, NEW.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (0b) row identity and provenance are write-once.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'strategy_shares: identity and provenance are immutable — refusing to rewrite id, created_by or created_at on strategy %. STEP 3 of this migration tells every future reader that reactivation never rewrites provenance; without this rule a raw PATCH falsifies that claim and forges who minted a live anonymous capability link, and when.',
      OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- (0c) the MAC witness is write-once. Deliberately its OWN rule and its OWN
  -- message rather than a fourth column bolted onto (0b): (0b) is a provenance
  -- claim (who/when), this is a CRYPTOGRAPHIC one, and the arms that pin them
  -- need distinguishable messages or one deletion hides behind the other's text.
  IF NEW.nonce IS DISTINCT FROM OLD.nonce THEN
    RAISE EXCEPTION 'strategy_shares: nonce is immutable — refusing to rewrite the MAC witness on strategy %. The nonce is what makes a destroyed-and-recreated row land in a token space DISJOINT from every token ever issued; letting it be written back restores a recorded value and resurrects those tokens. STEP 2''s column grant already denies this to `authenticated`, so a write that reaches this rule came from a role that BYPASSES grants — service_role, which holds GRANT ALL and is on this feature''s hot path. A trigger is the only control on this table that binds it.',
      OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.generation < OLD.generation THEN
    RAISE EXCEPTION 'strategy_shares: generation is monotonic — refusing to rewind it from % to % on strategy %. A rewind re-issues every share token minted at the lower generation, including ones that were explicitly REVOKED, as anonymous access to an unpublished factsheet.',
      OLD.generation, NEW.generation, OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.revoked_at IS NULL
     AND NEW.revoked_at IS NOT NULL
     AND NEW.generation <= OLD.generation THEN
    RAISE EXCEPTION 'strategy_shares: a revocation must ADVANCE generation — refusing to stamp revoked_at on strategy % while generation stays at %. A tombstone without a bump is COSMETIC: the link merely disappears from the active scan, and the next create_strategy_share() clears the tombstone at the SAME generation and brings the supposedly-revoked token back to life.',
      OLD.strategy_id, OLD.generation
      USING ERRCODE = 'check_violation';
  END IF;

  -- (6) an UPDATE may advance generation by AT MOST ONE. Ordered last on
  -- purpose: rule (1) has already refused every decrease, so by the time
  -- control reaches here NEW.generation >= OLD.generation and the two rules
  -- together pin the counter to "stay, or advance by exactly one". Nothing
  -- else is expressible.
  IF NEW.generation > OLD.generation + 1 THEN
    RAISE EXCEPTION 'strategy_shares: generation may advance by AT MOST ONE per statement — refusing to move it from % to % on strategy %. An unbounded jump does not merely skip numbers: it drives the counter to the BIGINT ceiling in ONE request from an ordinary owner token (they hold the STEP 2 UPDATE(generation) column grant, and rule (1) forbids only a DECREASE). After that, revoke_strategy_share and the GDPR Art. 17 erasure arm in migration 20260827130000 are the SAME generation + 1 statement, so both raise 22003 numeric_value_out_of_range and the data subject has WEDGED THEIR OWN ERASURE with one PATCH (MEASURED 2026-08-27). Bounding every advance to +1 is what makes that overflow unreachable by construction.',
      OLD.generation, NEW.generation, OLD.strategy_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."strategy_shares_enforce_monotonic_generation"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."strategy_shares_enforce_monotonic_generation"() IS 'Phase 164 / SHARE-03 and 164-06. BEFORE INSERT OR UPDATE guard. On INSERT it FORCES generation to 1 AND re-rolls nonce, then returns — not "rejects a wrong value", overwrites both — so no caller can express EITHER MAC input on a fresh row, including the BYPASSRLS roles that STEP 2''s column grant cannot bind (R3). The nonce half is what stops a service_role DELETE plus a re-INSERT naming a recorded nonce from rebuilding the pre-revoke (nonce, generation, live) triple byte-for-byte, which re-derives every token that row ever issued and reverses an Art. 17 erasure (MEASURED 2026-08-28). On UPDATE it enforces SIX rules (the name predates all but one and is kept because STEP 6, the table COMMENT and test_strategy_shares_rls.sql all pin it): (0c) nonce is IMMUTABLE — the MAC witness must not be written back from a recorded value, and since STEP 2''s column grant already denies this to `authenticated`, the rule exists for the role that bypasses grants entirely (service_role, GRANT ALL + BYPASSRLS, on this feature''s hot path); (0a) strategy_id is IMMUTABLE — re-pointing the row at another strategy the same owner holds leaves the original with no row, and the next create_strategy_share() re-issues it at generation 1, resurrecting every token revoked at generation 1 in TWO requests; (0b) id, created_by and created_at cannot be REWRITTEN on a surviving row, so the provenance STEP 3 promises about reactivation cannot be forged by a raw PATCH — this rule is UPDATE-only, and a caller that bypasses grants can still choose id and created_at on a FRESH row, which is accepted because neither is a MAC input and created_by is caller-supplied by design; (1) generation is monotonic; (2) every revocation advances it; (6) an UPDATE advances it by AT MOST ONE. Closes the owner self-rewind: the FOR ALL policy plus a column-unrestricted UPDATE grant let an owner PATCH their own row back to a revoked generation and clear revoked_at, resurrecting every link they had revoked (MEASURED). ⭐ Rule (6) closes the opposite direction, N1: the same PATCH could set generation to 2^63-1, after which revoke_strategy_share and the GDPR Art. 17 arm in migration 20260827130000 — the same generation + 1 statement — both raise 22003 and the data subject has ABORTED THEIR OWN ERASURE (MEASURED). With (1) and (6) the counter may only stay or advance by exactly one, so the BIGINT ceiling is unreachable by construction and no overflow handler is needed anywhere on this surface. ⛔ Triggers are NOT bypassed by BYPASSRLS, so this covers service_role as well — the only control on this table that does.';



CREATE OR REPLACE FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_job_count          INTEGER;
  v_nonterminal_count  INTEGER;
  v_failed_count       INTEGER;
  v_protected_count    INTEGER;
  v_unresolved_count   INTEGER;
  -- Phase 162 / HONEST-01: the STRUCTURED kind, not the free-text diagnostic.
  -- This function no longer reads the operator column at all; the file header
  -- carries the reasoning, because the self-verify block asserts the identifier
  -- is absent from this body INCLUDING its comments.
  v_latest_kind        TEXT;
  v_protected_kind     TEXT;
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

  -- ---- the NON-TERMINAL count — FIRST of this function's two compute_jobs ---
  -- ---- reads, and the ORDER IS THE CORRECTNESS ------------------------------
  -- Consumed by branch (a) far below. It is read HERE, and that placement is a
  -- data-integrity fix (161.1 migration re-review, HIGH), not tidiness.
  --
  -- ⛔ WHY THE ORDER OF THE TWO compute_jobs READS IS LOAD-BEARING
  -- This function reads compute_jobs twice for its verdict: the INCLUSIVE
  -- non-terminal set (here) and the non-superseded failed_final partition (the
  -- live_failures CTE below). Nothing runs them atomically. There is no
  -- isolation override anywhere in this repo, so this executes at READ
  -- COMMITTED, where every statement takes its OWN fresh snapshot and a
  -- concurrent transaction can commit a job's status flip BETWEEN them. Nor are
  -- the callers serialized per strategy: mark_compute_job_failed takes FOR
  -- UPDATE on the JOB row only, and neither it nor mark_compute_job_done takes
  -- pg_advisory_xact_lock(hashtext(strategy_id)) before its PERFORM of this
  -- function -- unlike positions_atomic_rebuild and sync_trades, which do. Two
  -- sibling jobs of one live-API strategy, claimed in the same batch, therefore
  -- run this concurrently as a matter of course.
  --
  -- The saving property is that a job's status is MONOTONE TOWARD TERMINAL.
  -- Every write that produces a non-terminal status is itself gated on a
  -- non-terminal status -- the claim RPCs move pending/failed_retry to running,
  -- defer_compute_job and reset_stalled_compute_jobs carry WHERE status =
  -- 'running', the fan-in release carries WHERE status = 'done_pending_children'
  -- -- and NOTHING in this schema moves a 'done' or 'failed_final' row back out
  -- of terminal. (The dropped-enqueue sweep of 20260819130500 "readmits" by
  -- INSERTING a fresh job, never by reviving the terminal one; the orphan
  -- terminalizer of 20260817120000 only moves running -> failed_final.)
  --
  -- Given monotonicity, reading the INCLUSIVE set FIRST and the failure set LAST
  -- is safe by construction: a job that crosses running -> failed_final between
  -- the two reads is caught by the LATER read, so the worst case is that it is
  -- counted twice -- which resolves to branch (a), or to the v_protect_hold
  -- stand-down, and never to a publish.
  --
  -- INVERTED, the same window has NO safe side. The failure read would see the
  -- job as still 'running' (not yet a failure) and this read would then see it
  -- as terminal (no longer in flight), so the job is invisible to BOTH counters:
  -- branch (a) is skipped (count 0), branch (b) is skipped (v_failed_count 0),
  -- branch (b-prime) is skipped (v_protected_count 0), and branch (c) fires and
  -- writes computation_status = 'complete', computation_error = NULL and
  -- computed_at = now() OVER A LIVE NON-SUPERSEDED PERMANENT FAILURE. That is a
  -- funded account published as healthy on top of a broken one -- the exact
  -- outcome branch (b-prime)'s own placement note declares must never happen.
  --
  -- 20260802120000 STEP 4 -- the definition this file re-bases -- read the two
  -- sets in this order, which is why it was never exposed. The first draft of
  -- THIS file inverted them by accident: the idempotence hoist lifted the
  -- partition above branch (a) and left this read below it. The self-verify
  -- block at the foot of this migration now PINS the order, so a future re-base
  -- cannot re-invert it silently.
  --
  -- ⚠️ WHAT THIS DOES NOT FIX, stated so the next reader does not over-trust it.
  -- Ordering makes the window's OUTCOME fail-safe; it does not close the window.
  -- A concurrent sibling can still leave a published row parked at 'computing'
  -- (branch (a) firing on a snapshot in which the marked job had not yet
  -- failed), which the 16-hour reaper of 20260802120000 then resolves. That is
  -- an unpublish that self-heals and is visible, versus a publish-over-failure
  -- that does neither. The real closure is a per-strategy
  -- pg_advisory_xact_lock in the two mark RPCs, matching the one
  -- positions_atomic_rebuild and sync_trades already take. Those RPCs are
  -- defined in other migrations, so it is deliberately NOT attempted here — a
  -- half-applied lock discipline is worse than a documented window.
  SELECT count(*) INTO v_nonterminal_count
    FROM compute_jobs
   WHERE strategy_id = p_strategy_id
     AND status IN ('pending', 'running', 'done_pending_children', 'failed_retry');

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
  -- state this function has not yet WRITTEN (branch (a) was the only writer that
  -- could precede them, and it returned), and neither writes anything itself.
  -- The ONLY behaviour delta is the v_protect_hold guard on branch (a) below.
  --
  -- ⚠️ The hoist constrains this read and the partition to sit above branch
  -- (a)'s WRITE; it says nothing about where the non-terminal count sits. That
  -- is a SECOND, independent ordering constraint and it is satisfied above, not
  -- here: the non-terminal count must precede the PARTITION (monotonicity), and
  -- the health read must precede branch (a)'s write (idempotence). Both hold in
  -- the order as written, and the self-verify block pins each one separately —
  -- one assertion cannot stand in for the other.
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
      f.error_kind,
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
      ) AND v_publish_healthy AS is_protected,
      -- ⛔ 161.1 CR-01 FOLLOW-UP: "v_protect_hold leaks the refresh protection
      -- onto unrelated jobs" (migration re-review). TRUE when a job that will
      -- itself RESOLVE this failure is already in flight. The hold below stands
      -- down only when EVERY protected failure has one — that is what scopes the
      -- branch-(a) suppression to the jobs the protection is actually about,
      -- instead of to every bridge call on the strategy until a superseding
      -- 'done' lands.
      --
      -- ⛔ WHY SAME-KIND + LATER + UNMARKED, AND NOT "ANY IN-FLIGHT JOB".
      -- Releasing the hold lets branch (a) write 'computing', and that write
      -- DESTROYS the protection: conjunct (ii) is re-derived from the very
      -- column branch (a) overwrites, so once the row is bounced this failure is
      -- not protected on any later call. Releasing is therefore safe ONLY when
      -- the in-flight job's terminal outcome DOMINATES the failure — decides it
      -- correctly without the health read being consulted at all. Each conjunct
      -- buys exactly one half of that:
      --   * SAME KIND, strictly LATER — a 'done' SUPERSEDES this failure through
      --     the F-3/PUB-02 subquery below, so branch (c) resolves the row
      --     cleanly and the protection is never needed again.
      --   * UNMARKED — a 'failed_final' is then a user-initiated permanent
      --     failure, which is LOUD by design (arms C/D). Also a correct outcome.
      --   A MARKED successor has NEITHER property, and admitting one would
      --   reopen CR-01 through its own retry: the recurring arm re-attempting
      --   against a still-wedged gateway would release the hold, bounce the row
      --   to 'computing', fail again and take branch (b). Arm I4 pins that.
      --
      -- ⛔ MEASURED, not argued. Widen this to "any in-flight job" and a routine
      -- UNMARKED 'sync_trades' poller — cron-enqueued on every live-API strategy
      -- — walks a protected row from 'complete' to 'computing' to 'failed' in
      -- three bridge calls, on a job the user never initiated. That is arm I's
      -- scenario, and arm I is RED without this scoping.
      --
      -- ⚠️ The status list is spelled INCLUSIVELY (the same four branch (a)
      -- counts) rather than as NOT IN ('done','failed_final'), so an unrecognised
      -- future status is NOT a successor: it leaves the hold ON, i.e. at today's
      -- behaviour. Suppression is the direction an unknown must resolve to HERE,
      -- because here the unknown decides whether to give the protection UP.
      --
      -- ⚠️ This is the SECOND spelling of the marker literals in this body — the
      -- one thing DEVIATION 1 avoided for the supersession subquery. It cannot
      -- be folded into `is_protected`: that column is about the FAILURE, this one
      -- is about a different row. The self-verify block therefore asserts every
      -- marker list in the deployed body is spelled IDENTICALLY, so the two
      -- copies cannot drift from each other.
      EXISTS (
        SELECT 1
          FROM compute_jobs r
         WHERE r.strategy_id = f.strategy_id
           AND r.kind = f.kind
           AND r.created_at > f.created_at
           AND r.status IN ('pending', 'running',
                            'done_pending_children', 'failed_retry')
           AND NOT COALESCE(
                 (r.metadata ->> 'source')
                   IN ('ledger-refresh', 'ledger-refresh-composite'),
                 FALSE)
      ) AS has_live_successor
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
    -- Protected failures that NOTHING in flight will resolve. A strict SUBSET of
    -- the protected class — it removes no row from either class, so the two-way
    -- partition above is untouched and every live failure still lands in exactly
    -- one of `is_protected` / `NOT is_protected`. Consumed ONLY by the
    -- branch-(a) hold below.
    count(*) FILTER (WHERE is_protected AND NOT has_live_successor),
    -- Phase 162 / HONEST-01: the MOST RECENT failure's structured kind, per
    -- class. Same ordering, same FILTERs, same partition as before — only the
    -- column changed, from the operator diagnostic to the enum that decides
    -- which curated sentence the user reads.
    (array_agg(error_kind ORDER BY created_at DESC)
       FILTER (WHERE NOT is_protected))[1],
    (array_agg(error_kind ORDER BY created_at DESC)
       FILTER (WHERE is_protected))[1]
    INTO v_failed_count, v_protected_count, v_unresolved_count,
         v_latest_kind, v_protected_kind
    FROM live_failures;

  -- ---- the branch-(a) EXEMPTION (161.1 re-review MEDIUM: idempotence) -------
  -- TRUE when branch (b-prime) is the outcome this call would reach if every job
  -- were terminal — a protected failure and NO unprotected one — AND at least
  -- one of those protected failures has nothing in flight that would resolve it.
  -- Under that and only that condition branch (a) stands down, so the published
  -- status it would have bounced to 'computing' stays put and the NEXT call
  -- re-derives the SAME protection.
  --
  -- ⛔ THE THIRD CONJUNCT IS THE SCOPE, added by the 161.1 CR-01 follow-up
  -- review ("v_protect_hold leaks the refresh protection onto unrelated,
  -- user-initiated jobs"). The first two are per-STRATEGY: with them alone, one
  -- live protected failed_final stood branch (a) down for EVERY later bridge
  -- call on that strategy until a same-kind 'done' superseded it. MEASURED
  -- consequence on a plain-'complete' row: a user-initiated resync never
  -- advertised 'computing', so `useStrategySyncPoller` — whose terminal test is
  -- `nextStatus === 'failed' || isComputedAnalytics(nextStatus)` — read a
  -- TERMINAL SUCCESS while the job was still running and SyncPreviewStep
  -- materialised the pre-resync factsheet. The third conjunct releases the hold
  -- once every protected failure has a live successor that will decide it
  -- (`has_live_successor` in the CTE above carries the whole safety argument for
  -- why only a same-kind, strictly-later, UNMARKED job counts).
  --
  -- ⛔ COALESCE all three ways, and note the defaults DIFFER on purpose. A NULL
  -- in any counter must resolve to NO HOLD, i.e. to today's behaviour, because
  -- standing branch (a) down on an unknown state would drop through to branches
  -- (b)/(c) with jobs still in flight — and branch (c) would report an
  -- unfinished computation as a completed one. Suppression is never the
  -- direction an unknown resolves to HERE. (Inside `has_live_successor` the
  -- unknown decides whether to GIVE UP the protection, so it resolves the other
  -- way; the invariant is "unknown ⇒ today's behaviour", not a fixed literal.)
  -- `count(*)` cannot return NULL, so these are belt-and-braces; they are also
  -- what keeps this predicate TWO-VALUED, which `IF ... AND NOT v_protect_hold`
  -- requires (a NULL there reads as false and would skip branch (a) — the exact
  -- inversion).
  --
  -- ⚠️ The third conjunct STRICTLY IMPLIES the first (an unresolved protected
  -- failure is a protected failure). The first is kept anyway, unaltered,
  -- because it is the half that states the tie to branch (b-prime) — delete it
  -- and the next reader has to re-derive that tie from the CTE's FILTER list.
  v_protect_hold := COALESCE(v_protected_count, 0) > 0
                    AND COALESCE(v_failed_count, 1) = 0
                    AND COALESCE(v_unresolved_count, 0) > 0;

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
  --
  -- ⚠️ v_nonterminal_count is deliberately NOT read here. It is read at the TOP
  -- of this function, BEFORE the failure partition — see the read-order note
  -- there for why that is correctness and not tidiness. Moving the read back to
  -- this spot, i.e. AFTER the partition, is the inversion that lets branch (c)
  -- publish a live permanent failure as a clean success.
  --
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
  -- failure is live AND NOTHING IN FLIGHT WOULD RESOLVE IT. That trailing
  -- clause is the 161.1 CR-01 follow-up scope; without it the suppression was
  -- per-strategy and swallowed the 'computing' advertisement of unrelated,
  -- user-initiated work (see v_protect_hold above). What remains suppressed is
  -- not a new shape for this branch: it ALREADY declines to show 'computing'
  -- over a sticky terminal success (the complete_with_warnings /
  -- computation_warned arm right below), which is the state of every strategy in
  -- the production ledger cohort today.
  --
  -- Three arms of supabase/tests/test_sync_status_marked_refresh_protected.sql
  -- pin this branch from three sides, and no one of them implies another:
  --   I2 — the exemption is an exemption, not a disablement. With NO protected
  --        failure live, an in-flight job must still read 'computing' and stamp.
  --   I3 — the exemption is SCOPED. With a protected failure live AND a
  --        same-kind unmarked successor in flight, the row must read 'computing'
  --        again, and the successor's 'done' must then resolve it through
  --        branch (c) — error cleared, computed_at advanced.
  --   I4 — the scope does not admit a MARKED successor. The recurring arm
  --        retrying against a still-wedged venue must NOT release the hold.
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
  -- with the CURATED sentence for the latest failure's kind (Phase 162 /
  -- HONEST-01 — this used to write the job's own diagnostic text, which is how
  -- a raw Python exception string became the thing a user read on a failed
  -- sync). The supersession and partition rules that decide
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
    VALUES (p_strategy_id, 'failed', computation_error_copy(v_latest_kind), NULL)
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
       -- ⛔ ASSIGNED, and the COALESCE-over-the-existing-value that stood here
       -- from 161.1 review round 4 is GONE ON PURPOSE (Phase 162 / HONEST-01).
       -- ⚠️ TWO EARLIER DRAFTS OF THIS COMMENT DESCRIBED THAT COALESCE WRONGLY,
       -- in opposite directions, and both are corrected here by measurement
       -- (Phase 162 review F-4a/F-4b). What stood here was
       -- `COALESCE(<the failing job's own free-text diagnostic>, <this column>)`.
       -- Its LEFT arm is the OPERATOR column, and that column is non-NULL on
       -- EVERY reachable failed_final row: the file header's writer census shows
       -- exactly two writers of that status and both stamp it unconditionally
       -- (the RPC assigns it straight from its argument, whose two callers pass
       -- `kind or "unknown"`-style non-NULL strings; the reaper writes a fixed
       -- audit literal). So the left arm ALWAYS won. This branch was writing
       -- OPERATOR TEXT into a user-visible column on every protected failure,
       -- and the right arm was unreachable in practice.
       --
       -- That settles what the removal does and does not cost:
       --   * It does NOT cost the worker's curated per-failure sentence. An
       --     earlier draft claimed it did. Measured, that sentence was ALREADY
       --     being overwritten here — by the raw diagnostic, which is strictly
       --     worse than the per-kind copy that replaces it. This branch is a
       --     STRICT IMPROVEMENT over what it replaced, not a regression.
       --   * It does NOT lose a NULL-erasure guard either, which is what the
       --     other draft claimed. `computation_error_copy` is TOTAL — NULL in, a
       --     sentence out — so the hazard round 4 guarded cannot occur, and a
       --     COALESCE whose left arm is provably non-NULL is dead code that
       --     teaches the next reader that NULL is reachable here.
       --   * It DOES heal a row still carrying operator text written by the
       --     pre-migration form of this very branch, the next time it is touched.
       --
       -- ⛔ WHAT IS STILL LOST HERE, and is NOT closed by this migration: the
       -- worker writes a CURATED per-failure sentence into this column on this
       -- exact path moments before the RPC that runs this bridge, and this
       -- statement then replaces it with the per-KIND sentence. That loss is
       -- REAL and it is what a user reads on the portfolio stale warning. It
       -- PRE-DATES this migration (see above: it was previously a loss to the
       -- raw diagnostic), so it is not something to revert to. Fixing it needs
       -- PROVENANCE on this column — a writer/generation marker the Python
       -- writers set and this branch reads — because preferring the value
       -- already present cannot tell this failure's sentence from an older
       -- unrelated one, and would also freeze the pre-migration operator text
       -- this branch now heals. That is an architectural change, out of this
       -- plan's scope, and the file header records it as owed work rather than
       -- as an accepted trade.
       SET computation_error   = computation_error_copy(v_protected_kind),
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


ALTER FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."sync_strategy_analytics_status"("p_strategy_id" "uuid") IS 'Atomic UI status bridge. Derives strategy_analytics.computation_status from the compute_jobs aggregate for the given strategy in a single SQL statement (no read-then-write race). Mapping: any non-terminal row → computing, any NON-SUPERSEDED UNPROTECTED failed_final → failed (with the CURATED sentence for the latest failure''s error_kind — never the job''s own diagnostic text), all done → complete; EXCEPT a row already at complete_with_warnings OR carrying the runner-owned computation_warned marker is preserved as complete_with_warnings in BOTH the non-terminal (a) and all-done (c) branches (a sticky, more-informative terminal success the analytics runner wrote and only the runner clears). SUPERSESSION (mig 20260710150000, F-3/PUB-02): a failed_final poisons the strategy ONLY when NOT superseded by a strictly-later done of the SAME (strategy_id, kind), keyed on the immutable created_at. Fresh-ledger re-onboard of a failed member key = RE-ENQUEUE a fresh compute job (enqueue dedup is in-flight-only, so a resubmit inserts a fresh generation while the stale failed_final is retained for audit); the bridge then ignores the same-kind-superseded failed_final. NEVER retry in place; NEVER delete queue history. Per-kind scoping keeps a real permanent failure poisoning across a later done of a DIFFERENT kind (cross-kind SAFETY). COMPUTING_STARTED_AT (mig 20260802120000, JOB-01): branch (a) maintains strategy_analytics.computing_started_at with a three-arm CASE keyed off the RESOLVED status — stamp now() only on a genuine transition INTO computing, KEEP the existing stamp when the row is already computing, and clear to NULL when the branch resolves to complete_with_warnings; branches (b) and (c) clear it to NULL as exit transitions. PROTECTED MARKED REFRESH (mig 20260825150000, Phase 161.1 CR-01): a non-superseded failed_final whose compute_jobs.metadata->>''source'' is a recurring ledger-refresh marker AND whose kind is one a refresh can reach (derive_broker_dailies, stitch_composite, or the forwarded chain hop compute_analytics_from_csv — the kind scope is the containment that survives a widening of the Pydantic Source Literal that request-derived writers put into the SAME metadata key; the enqueue_compute_job ACL is NOT that containment) AND whose strategy_analytics row still reads terminal-success (computation_status IN (complete, complete_with_warnings) — deliberately NOT widened with computation_warned, which survives both a computing entry-write and a failed bounce) is EXCLUDED from branch (b) and handled by branch (b-prime), which records computation_error (the curated sentence for the protected failure''s error_kind; the former COALESCE over the row''s existing value is RETIRED by mig 20260826120000 — computation_error_copy is total, so the NULL-erasure that COALESCE guarded cannot occur, and operator text written by the pre-migration form of this branch is healed rather than preserved. ⚠️ THE RETIREMENT IS A STRICT IMPROVEMENT ON THIS BRANCH, and an earlier draft of this comment claimed the opposite (Phase 162 review F-4a). MEASURED: that COALESCE had the failing job''s OPERATOR-column diagnostic as its LEFT arm, and that column is non-NULL on every reachable failed_final row (exactly two writers of that status; the RPC assigns it straight from a non-NULL argument and the reaper writes a fixed audit literal), so the left arm always won and this branch always wrote raw operator text to a user-visible column. What IS lost, on this branch and on (b) alike, PRE-DATES this migration: job_worker.py _upsert_error_only writes a CURATED per-failure sentence to this column on exactly the D-15 protected path and the bridge then overwrites it — previously with the raw diagnostic, now with the per-KIND sentence. That is OWED WORK, not an accepted trade: closing it needs PROVENANCE on the column (a writer/generation marker the Python writers set and this bridge reads), because preferring the value already present cannot distinguish this failure''s sentence from one left by an older unresolved protected failure, would freeze the pre-migration operator text this branch now heals, and would suppress the retry-positive orphaned copy that mig 20260826140000 exists to deliver) and clears computing_started_at but writes NO computation_status, NO computation_warned and NO computed_at — so a background maintenance refresh can never un-publish a funded account, while every user-initiated job still poisons loudly. The health conjunct is a coherence check with the worker-side D-15 guard: if that guard declined to protect it has already written failed, so this reads false and the loud path is taken. IDEMPOTENCE (same migration): the health read and the failure partition are evaluated BEFORE branch (a), and branch (a) stands down (v_protect_hold) when b-prime is the outcome it would otherwise reach — otherwise branch (a)''s transient computing write would make the next bridge call re-derive the protection as absent and poison the row it had already protected. A row that arrives ALREADY at computing with no protection previously granted is still LOUD. SCOPE OF THAT STAND-DOWN (same migration, CR-01 follow-up review): the hold is NOT per-strategy. It is released once EVERY protected failure already has a strictly-later, same-kind, UNMARKED job in flight — the only shape of job whose terminal outcome decides that failure without the health read (a done supersedes it per F-3/PUB-02; an unmarked failed_final is loud by design) — so an in-flight resync of the failure''s own kind advertises computing again instead of reading as a terminal success to the wizard poller. A MARKED successor is deliberately excluded: the recurring arm retrying against a still-wedged venue would otherwise release the hold, bounce the row to computing and go dark on its own retry. no rows → no-op (preserve existing). CURATED USER COPY (mig 20260826120000, Phase 162 HONEST-01): strategy_analytics.computation_error is a USER-VISIBLE column (wizard failure envelope, portfolio stale warning) and compute_jobs.last_error is an OPERATOR column holding raw classify_exception output, so branches (b) and (b-prime) no longer copy the second into the first — they write computation_error_copy(error_kind), whose range is four fixed literals (permanent / retries-exhausted / orphaned / cautious default — the ''orphaned'' arm is Phase 162 review F-3, read here and WRITTEN by mig 20260826140000, which widens compute_jobs_error_kind_check and re-registers the hourly orphaned-running reaper to stop mislabelling worker deaths as permanent failures). The identifier for the operator column does not appear anywhere in this function body, comments included, and the migration''s self-verify block asserts that on pg_get_functiondef. The raw diagnosis is unchanged on compute_jobs.last_error, which is where an engineer reads what actually happened. Called post-flip by mark_compute_job_done / mark_compute_job_failed (in-RPC PERFORM) and, for the DEFERRED outcome only, by services.job_worker.dispatch. Service-role only. See migrations 038 + 20260707120000 + 20260708120000 + 20260710150000 + 20260802120000 + 20260825150000 + 20260826120000.';



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


CREATE OR REPLACE FUNCTION "public"."verification_requests_view_readonly_trigger"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  RAISE EXCEPTION 'verification_requests is now a read-only VIEW (Phase 19 / BACKBONE-04 step d). Writes go to strategy_verifications via POST /process-key. See .planning/phase-19/migration-plan.md slot 107.'
    USING ERRCODE = '42501',
          HINT = 'Operation rejected on the verification_requests VIEW. The legacy BASE TABLE was renamed to verification_requests_legacy. GDPR erasure deletes from verification_requests_legacy (see sanitize_user STEP 5.5).';
END;
$$;


ALTER FUNCTION "public"."verification_requests_view_readonly_trigger"() OWNER TO "postgres";


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


CREATE TABLE IF NOT EXISTS "public"."allocator_equity_derived" (
    "allocator_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "computed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."allocator_equity_derived" FORCE ROW LEVEL SECURITY;


ALTER TABLE "public"."allocator_equity_derived" OWNER TO "postgres";


COMMENT ON TABLE "public"."allocator_equity_derived" IS 'Phase 115.1 derived allocator $-equity surface. One JSONB row per (allocator_id, kind); atomic replace-on-upsert (strategy_analytics_series precedent 20260428120919). SEPARATE from the legacy per-day equity-snapshots store (BACKBONE-03 else-branch: never a second writer to the legacy table). Written by the analytics worker via service_role; read by the SSR dashboard via the authenticated owner client.';



COMMENT ON COLUMN "public"."allocator_equity_derived"."allocator_id" IS 'Owning allocator (= api_keys.user_id at derive time). ON DELETE CASCADE from auth.users IS the GDPR sanitize path — do NOT add a delete-guard trigger. If one is ever added it MUST exempt current_setting(''quantalyze.sanitize_in_progress'', true) = ''on'' (reference_sanitize_user_delete_guard_exemption) or it aborts account-deletion cascade.';



COMMENT ON COLUMN "public"."allocator_equity_derived"."kind" IS 'Row family. ''equity_curve'' = the display curve row (payload.curve = [{date:''YYYY-MM-DD'', equity_usd}], flags, degrade_reasons, is_trustworthy, scalars). ''key_inputs:<api_key_id>'' = Option-B per-key persisted real flows + terminal anchor, consumed crawl-free by the derive_allocator_equity compose job. Add a new family = INSERT a new row; no ALTER TABLE.';



CREATE TABLE IF NOT EXISTS "public"."allocator_equity_snapshots" (
    "allocator_id" "uuid" NOT NULL,
    "asof" "date" NOT NULL,
    "value_usd" numeric NOT NULL,
    "breakdown" "jsonb",
    "reconstructed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source" "text" DEFAULT 'exchange_primary'::"text" NOT NULL,
    "history_depth_months" integer,
    "pre_terminus_balance_unknown" boolean DEFAULT false NOT NULL,
    CONSTRAINT "allocator_equity_snapshots_history_depth_check" CHECK ((("history_depth_months" IS NULL) OR ("history_depth_months" > 0))),
    CONSTRAINT "allocator_equity_snapshots_source_check" CHECK (("source" = ANY (ARRAY['exchange_primary'::"text", 'coingecko_fallback'::"text", 'mixed'::"text"])))
);


ALTER TABLE "public"."allocator_equity_snapshots" OWNER TO "postgres";


COMMENT ON TABLE "public"."allocator_equity_snapshots" IS 'Per-allocator per-day reconstructed equity series. Written by FastAPI worker (service_role). Phase 07 / D-02. history_depth_months added per VOICES-ACCEPTED f9 to surface venue-specific warm-up copy.';



COMMENT ON COLUMN "public"."allocator_equity_snapshots"."history_depth_months" IS 'Per-venue retention cap in months at time of reconstruction. Binance=24, OKX=3 (trades) / 24 (OHLCV), Bybit=24. NULL for CoinGecko fallback. Used by getMyAllocationDashboard to compute minHistoryDepthMonths for venue-specific KpiStrip warm-up messaging.';



COMMENT ON COLUMN "public"."allocator_equity_snapshots"."pre_terminus_balance_unknown" IS 'CL9 / NEW-C01-11: true when this row was reconstructed against an unknown absolute baseline (OKX 90-day terminus clamped the funding deposit out of the fetch window), so its absolute equity level — and any drawdown / TWR derived from it — is unreliable. getMyAllocationDashboard excludes flagged rows from level-derived surfaces. Daily-refresh rows (today''s live mark) and all pre-existing rows are false. Written by the analytics worker (service_role) only.';



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
    "attested_venue" "text",
    "venue_account_id" "text",
    CONSTRAINT "api_keys_attested_venue_matches_exchange" CHECK ((("attested_venue" IS NULL) OR ("attested_venue" = "exchange"))),
    CONSTRAINT "api_keys_exchange_check" CHECK (("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text", 'deribit'::"text", 'sfox'::"text", 'mt5'::"text"]))),
    CONSTRAINT "api_keys_sync_status_check" CHECK (("sync_status" = ANY (ARRAY['idle'::"text", 'syncing'::"text", 'computing'::"text", 'complete'::"text", 'complete_with_warnings'::"text", 'error'::"text", 'revoked'::"text", 'rate_limited'::"text"]))),
    CONSTRAINT "api_keys_venue_account_id_nonblank" CHECK ((("venue_account_id" IS NULL) OR ("btrim"("venue_account_id") <> ''::"text")))
);


ALTER TABLE "public"."api_keys" OWNER TO "postgres";


COMMENT ON COLUMN "public"."api_keys"."exchange" IS 'Venue LABEL, not an attestation. Client UPDATE was withdrawn at the table level by migration 20260810120000 and a SECURITY INVOKER trigger backstops it, and as of migration 20260823120000_revoke_api_keys_insert the browser holds no INSERT on this table at all, so the value is now server-written on every path. NO LONGER the input to the strategies.asset_class annualization stamp: since Phase 160 (RANK-04) that stamp reads api_keys.attested_venue, and a NULL attestation SKIPS the write rather than defaulting to traditional/√252. NO LONGER the input to the finalize-wizard scope-broadening probe gate: since migration 20260811210000 that gate reads api_keys.attested_venue. Do not re-open client UPDATE on this column. Client INSERT was withdrawn at the table level by migration 20260823120000_revoke_api_keys_insert (Phase 160 / RANK-03); the server-side persist arm in validate-and-encrypt is the only writer. Do not re-open client INSERT on this table.';



COMMENT ON COLUMN "public"."api_keys"."api_key_encrypted" IS 'Encrypted credential payload (Fernet ciphertext). Table-level SELECT revoked from anon/authenticated per migration 027. Access via service-role client only.';



COMMENT ON COLUMN "public"."api_keys"."api_secret_encrypted" IS 'Encrypted. Revoked per migration 027. Currently NULL for all rows (payload bundled into api_key_encrypted).';



COMMENT ON COLUMN "public"."api_keys"."passphrase_encrypted" IS 'Encrypted. Revoked per migration 027. Currently NULL for all rows.';



COMMENT ON COLUMN "public"."api_keys"."dek_encrypted" IS 'KEK-wrapped per-row DEK (Fernet). Revoked per migration 027. Service-role only.';



COMMENT ON COLUMN "public"."api_keys"."nonce" IS 'Legacy wrapper metadata. Revoked per migration 027. Currently NULL (Fernet handles nonce internally).';



COMMENT ON COLUMN "public"."api_keys"."last_429_at" IS 'Timestamp of the most recent 429 (rate limit) response from the exchange for this key. Populated by update_api_key_rate_limit(). Read by the Python job runner to skip retries within the per-exchange cooldown window. See migration 032.';



COMMENT ON COLUMN "public"."api_keys"."last_fetched_trade_timestamp" IS 'Partial-success checkpoint for sync_trades: stamped immediately after raw fills are durably upserted (Phase 2), distinct from last_sync_at which represents full-pipeline success. NULL = never checkpointed (callers fall back to last_sync_at). Prefer this over last_sync_at when resuming since_ms. See migration 045.';



COMMENT ON COLUMN "public"."api_keys"."disconnected_at" IS 'Migration 075: when set, key is soft-disconnected — worker crons skip it and the UI renders a Reconnect affordance. NULL = active. allocator_holdings keep their FK reference for audit continuity.';



COMMENT ON COLUMN "public"."api_keys"."attested_venue" IS 'RPC-WRITTEN venue (migration 20260811210000; guarantee STRENGTHENED by 20260814120000, Phase 156 Migration B). ⛔ READ THE GUARANTEE PRECISELY. What holds NOW: (1) this column is written ONLY by the two SECURITY DEFINER wizard RPCs — create_wizard_strategy and add_wizard_composite_key — (2) each writes THIS column and exchange from ONE parameter, so the two cannot disagree, pinned for every writer present and future by CHECK constraint api_keys_attested_venue_matches_exchange, and (3) since 20260814120000 those RPCs are invokable ONLY by service_role over PostgREST: authenticated and anon hold no EXECUTE, so a browser session can no longer POST /rest/v1/rpc/ directly and mint an attestation. The value is therefore THE VENUE THIS SERVER OBSERVED A SUCCESSFUL READ-ONLY AUTHENTICATION AT. ⛔ It is NOT "unforgeable": any server route holding a service-role client can still pass any value, which is the standing service_role trust boundary (ADR-0001/ADR-0003), not a defect this column can close — and note specifically that the scrub trigger allowlist INCLUDES service_role, so a service-role client doing a plain INSERT INTO api_keys writes this column UNSCRUBBED, which is why clause (1) is a statement about the BROWSER TIER and not a database-level invariant. ⛔ THE REVOKE IS NOT SELF-ENFORCING — Supabase pg_default_acl re-grants anon and authenticated on any DROP + CREATE of either function (it bit 20260812083206 for anon); assertion 5h in test_api_keys_exchange_not_user_writable.sql is what fails CI if a later migration reopens it. A client-supplied value on a direct INSERT is scrubbed to NULL by the api_keys_scrub_attested_venue BEFORE INSERT trigger FOR anon AND authenticated CALLERS, so a DELETE + re-INSERT round trip cannot forge one from the browser tier; it does NOT stop a service-role direct INSERT. Read by /api/strategies/finalize-wizard as the SOLE input to the ASVS V4 scope-broadening probe gate: NULL means PROBE (fail-toward). Never fall back to api_keys.exchange — that fallback re-opens the bypass this column exists to close. Rows created before 2026-08-11T00:00Z were backfilled from exchange under a hand-typed census pin — the cutoff is a dated bound, NOT "everything older than the apply", so a row created between that instant and the apply lands NULL and is PROBED.';



COMMENT ON COLUMN "public"."api_keys"."venue_account_id" IS 'Phase 154 / WIZCONT-02. NON-SECRET account identity for the credential in this row — the MT5 broker login today. ⛔ TRUST BOUNDARY, STATED HONESTLY — DO NOT CALL THIS VALUE VENUE-CONFIRMED. What is enforced: a DIRECT client INSERT cannot persist it, because the api_keys_scrub_venue_account_id BEFORE INSERT trigger NULLs it for every current_user outside the postgres/service_role/supabase_admin allowlist. What is NOT enforced: `authenticated` holds EXECUTE on the SECURITY DEFINER create_wizard_strategy, which stamps this column verbatim from a caller-supplied parameter WITHOUT VALIDATION — so a browser session calling /rest/v1/rpc/create_wizard_strategy directly can persist an identity of its choosing and evade the dedup. The trigger closes the table-INSERT path, not the RPC path. Remedy is PHASE 156 (CONNECT-REFACTOR). NULL is the NORMAL value and means "this venue exposes no stable non-secret account id at validation" — every ccxt venue today. That is why api_keys_user_exchange_venue_account_uniq is PARTIAL. api_keys_venue_account_id_nonblank forbids '''' and whitespace-only. ⛔ Never echo this value to the browser (UI-SPEC).';



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
    "wizard_session_id" "uuid",
    "returns_denominator_config" "jsonb",
    "asset_class" "text" DEFAULT 'traditional'::"text" NOT NULL,
    "capital_ownership" "text",
    CONSTRAINT "strategies_asset_class_check" CHECK (("asset_class" = ANY (ARRAY['crypto'::"text", 'traditional'::"text"]))),
    CONSTRAINT "strategies_capital_ownership_check" CHECK (("capital_ownership" = ANY (ARRAY['own_capital'::"text", 'team_review'::"text"]))),
    CONSTRAINT "strategies_disclosure_tier_check" CHECK (("disclosure_tier" = ANY (ARRAY['institutional'::"text", 'exploratory'::"text"]))),
    CONSTRAINT "strategies_fingerprint_version_check" CHECK ((("fingerprint" IS NULL) OR ((("fingerprint" ->> 'version'::"text") IS NOT NULL) AND ((("fingerprint" ->> 'version'::"text"))::integer = 1)))),
    CONSTRAINT "strategies_partner_tag_format_check" CHECK ((("partner_tag" IS NULL) OR ("partner_tag" ~ '^[a-z0-9-]+$'::"text"))),
    CONSTRAINT "strategies_source_check" CHECK (("source" = ANY (ARRAY['legacy'::"text", 'wizard'::"text", 'admin_import'::"text", 'allocator_connected'::"text", 'csv'::"text", 'okx'::"text", 'binance'::"text", 'bybit'::"text", 'deribit'::"text", 'sfox'::"text", 'mt5'::"text"]))),
    CONSTRAINT "strategies_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'pending_review'::"text", 'published'::"text", 'archived'::"text", 'private'::"text"])))
);


ALTER TABLE "public"."strategies" OWNER TO "postgres";


COMMENT ON COLUMN "public"."strategies"."disclosure_tier" IS 'institutional = real name/bio/LinkedIn visible; exploratory = codename only. Discovery + match queue filter by tier.';



COMMENT ON COLUMN "public"."strategies"."public_contact_email" IS 'Optional relay address for inbound messages. Falls back to profiles.email via join when null.';



COMMENT ON COLUMN "public"."strategies"."codename" IS 'Pseudonym shown in place of name when disclosure_tier = exploratory. NULL for institutional.';



COMMENT ON COLUMN "public"."strategies"."partner_tag" IS 'Optional tag scoping this strategy to a partner pilot.';



COMMENT ON COLUMN "public"."strategies"."source" IS 'Origin of the strategies row. ''legacy'' = original StrategyForm / CSV flow, ''wizard'' = Task 1.2 onboarding wizard, ''admin_import'' = partner CSV import. Used to discriminate draft lifetimes: wizard drafts auto-expire after 24h, legacy/admin drafts persist. See migration 031.';



COMMENT ON COLUMN "public"."strategies"."fingerprint" IS 'Phase 19 / FINGERPRINT-01. v0 placeholder; pgvector explicitly deferred to v2 per UC-C.';



COMMENT ON COLUMN "public"."strategies"."wizard_session_id" IS 'Per-submission idempotency token (client localStorage, stable across retries) for the onboarding wizards. Written by create_wizard_strategy and add_wizard_composite_key (source=''wizard'') AND, since Phase 140.4 / SEAMRIM-03, by finalize_csv_strategy (source=''csv''). NULL for legacy/admin strategies ONLY — a CSV strategy created through the wizard now carries its session id, and that is load-bearing: the partial index strategies_user_wizard_session_source_uniq is predicated on `wizard_session_id IS NOT NULL`, so a NULL here silently removes the row from the double-submit fence (that omission WAS review finding C-2). Partial-unique with user_id AND source so a double-submit of POST /api/strategies/create-with-key or POST /api/strategies/csv-finalize dedups to one row instead of minting duplicate strategies + api_keys + Railway validate/encrypt charges (audit H-0304/H-0311/H-0186; review C-2).';



COMMENT ON COLUMN "public"."strategies"."returns_denominator_config" IS 'NULLABLE per-strategy returns override. When set, daily returns = daily_pnl_usd / allocated_capital(date) (bypasses NAV/§5). Shape validated in services/allocated_capital.py:parse_returns_denominator_config. NULL (default) = normal NAV backward-roll path.';



COMMENT ON COLUMN "public"."strategies"."asset_class" IS 'Annualization basis: crypto (7-day markets, √365) vs traditional (weekday markets, √252). Backfilled crypto for api_key-sourced strategies; CSV/paper default traditional, user-settable at upload. Read by the analytics factsheet path and the OG card / ScenarioComposer / allocator portfolio frontend surfaces.';



COMMENT ON COLUMN "public"."strategies"."capital_ownership" IS 'OWN-03 capital-ownership mark, STRATEGY-level (D-04). NULL = never asked: renders no tag, and is NON-ALLOCATABLE for a self-owned strategy — the remedy is the retro Mark dialog on /my-strategies (D-09/D-11), never a backfill. ''own_capital'' = the allocator''s own capital, allocatable. ''team_review'' = a trading team''s key under verification: never NEWLY allocatable by anyone (SC 2b) — no INSERT can mint a position from it, and the owner cannot mark one while their own position is live. Pre-existing THIRD-PARTY positions are RETAINED: a flip never touches another allocator''s book (see the migration header (g) for why that narrowing is accepted rather than closed with a cross-tenant delete). Deliberately nullable with no default: defaulting would fabricate a claim about pre-existing strategies.';



COMMENT ON CONSTRAINT "strategies_partner_tag_format_check" ON "public"."strategies" IS 'partner_tag must match `^[a-z0-9-]+$` (mirrors src/lib/partner.ts isValidPartnerTag). Audit-2026-05-07 #28.';



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
    "strategy_id" "uuid",
    "date" "date" NOT NULL,
    "daily_return" double precision NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "id" bigint NOT NULL,
    "api_key_id" "uuid",
    "allocator_id" "uuid",
    CONSTRAINT "csv_daily_returns_per_key_allocator" CHECK ((("api_key_id" IS NULL) OR ("allocator_id" IS NOT NULL))),
    CONSTRAINT "csv_daily_returns_source_xor" CHECK (("num_nonnulls"("strategy_id", "api_key_id") = 1))
);


ALTER TABLE "public"."csv_daily_returns" OWNER TO "postgres";


COMMENT ON TABLE "public"."csv_daily_returns" IS 'Persisted daily-return series for CSV-uploaded strategies. Decimal fraction returns (e.g. 0.0055 for +0.55%). Populated by persist_csv_daily_returns definer-rights RPC at csv-finalize time. Worker handler compute_analytics_from_csv reads this table to feed compute_all_metrics(). PRIMARY KEY (strategy_id, date) — implicit B-tree serves both worker SELECT and ON CONFLICT upsert; no redundant explicit index per PR #272.';



ALTER TABLE "public"."csv_daily_returns" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."csv_daily_returns_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



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
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "funding_fees_exchange_check" CHECK (("exchange" = ANY (ARRAY['binance'::"text", 'okx'::"text", 'bybit'::"text"])))
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
    "computation_warned" boolean DEFAULT false NOT NULL,
    "metrics_json_by_basis" "jsonb",
    "computing_started_at" timestamp with time zone,
    "series_completeness" "text",
    CONSTRAINT "strategy_analytics_computation_status_check" CHECK (("computation_status" = ANY (ARRAY['pending'::"text", 'computing'::"text", 'complete'::"text", 'complete_with_warnings'::"text", 'failed'::"text"]))),
    CONSTRAINT "strategy_analytics_metrics_by_basis_shape" CHECK ((("metrics_json_by_basis" IS NULL) OR ("jsonb_typeof"("metrics_json_by_basis") = 'object'::"text")))
);


ALTER TABLE "public"."strategy_analytics" OWNER TO "postgres";


COMMENT ON COLUMN "public"."strategy_analytics"."volume_metrics" IS 'Aggregated trading volume data from raw fills: total_volume_usd, avg_daily_volume_usd, maker_ratio, volume_by_symbol, volume_by_month. Populated by compute_analytics worker. See migration 041.';



COMMENT ON COLUMN "public"."strategy_analytics"."exposure_metrics" IS 'Position and risk exposure data from reconstructed positions: avg_position_count, max_position_count, avg_leverage, long_short_ratio, concentration_top3. Populated by compute_analytics worker. See migration 041.';



COMMENT ON COLUMN "public"."strategy_analytics"."metrics_json_by_basis" IS 'NULLABLE stub for COMP-04 (Phase 86): per-basis metrics object keyed cash_settlement / mark_to_market. NULL for all existing rows (no backfill). Populated at derive time in Phase 86.';



COMMENT ON COLUMN "public"."strategy_analytics"."computing_started_at" IS 'JOB-01 (Phase 142): when the CURRENT computation entered computation_status = ''computing''. NULL means "not currently computing" -- it is cleared on every exit from computing (to complete, complete_with_warnings, or failed). Every writer that sets computation_status = ''computing'' MUST set this in the SAME statement; that co-location is enforced by a static CI invariant, not a CHECK constraint (a missed writer must be a red build, not a 23514 on the live money path). computed_at is NOT a substitute: the status bridge re-stamps computed_at = now() on every job transition (never reap) and the Python runner omits it on the computing entry-write so it holds the prior run''s value (reap instantly). Read by the reap_strategy_analytics_stuck_computing pg_cron job. A ''computing'' row with a NULL stamp is a writer bug and is SKIPPED by the reaper, never reaped.';



COMMENT ON COLUMN "public"."strategy_analytics"."series_completeness" IS 'MT5-12 (Phase 142.2): the completeness verdict for this strategy''s daily series. Values: ledger_complete | sampled_gapped (a SAMPLED NAV series with interior holes -- combine_sfox_balance_history only, when nav_gap_days > 0; NOT the gapped-perp case) | fill_derived_unproven (every ccxt fills+funding series, ALWAYS and unconditionally -- the normal case for that path, not a per-account judgement) | user_supplied | composite_stitched. The PRODUCER decides: the verdict is assigned by the code that builds the series, from a single producer registry in Python (analytics-service/services/broker_dailies.py). TypeScript holds a SEPARATE admissibility policy -- a hand-typed subset in src/lib/strategyGate.ts, deliberately never imported -- which answers which verdicts the gate may trust, not which verdicts exist; that independence is intentional and is not a second copy of the producer set. NULL means the series'' inputs were never examined, and the gate refuses NULL (fail-closed). Deliberately NO CHECK constraint on the values: a CHECK would be a second hand-maintained copy of the producer set -- the drift class this column deletes -- and would fail a live money-path write instead of reddening a build; the fail-loud assert at the derive seam is the enforcement. Backfilling this column is FORBIDDEN: a backfill fabricates a trust claim about series whose inputs no longer exist to examine.';



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



CREATE TABLE IF NOT EXISTS "public"."strategy_keys" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "api_key_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "window_start" "date" NOT NULL,
    "window_end" "date",
    "seq" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "strategy_keys_seq_nonneg" CHECK (("seq" >= 0)),
    CONSTRAINT "strategy_keys_window_order" CHECK ((("window_end" IS NULL) OR ("window_end" > "window_start")))
);


ALTER TABLE "public"."strategy_keys" OWNER TO "postgres";


COMMENT ON COLUMN "public"."strategy_keys"."window_end" IS 'EXCLUSIVE end of the half-open [window_start, window_end) active window (COMP-02). NULL = open-ended / still-active window with no declared end.';



COMMENT ON COLUMN "public"."strategy_keys"."seq" IS 'Member ordinal within the strategy. Precedence-by-seq ordering drives Phase 86 overlap resolution — overlaps are resolved by seq, never silently averaged.';



CREATE OR REPLACE VIEW "public"."ledger_refresh_staleness" WITH ("security_invoker"='true') AS
 WITH "ledger_venue_set" AS (
         SELECT ARRAY['deribit'::"text", 'sfox'::"text", 'mt5'::"text"] AS "venues",
            ARRAY['mt5'::"text"] AS "deferred_venues"
        ), "strategy_venue" AS (
         SELECT "s"."id" AS "strategy_id",
            (EXISTS ( SELECT 1
                   FROM "public"."strategy_keys" "sk"
                  WHERE ("sk"."strategy_id" = "s"."id"))) AS "is_composite",
            ARRAY( SELECT DISTINCT "v"."exchange"
                   FROM ( SELECT "ak"."exchange"
                           FROM "public"."api_keys" "ak"
                          WHERE ("ak"."id" = "s"."api_key_id")
                        UNION ALL
                         SELECT "ak_m"."exchange"
                           FROM ("public"."strategy_keys" "sk_m"
                             JOIN "public"."api_keys" "ak_m" ON (("ak_m"."id" = "sk_m"."api_key_id")))
                          WHERE ("sk_m"."strategy_id" = "s"."id")) "v"
                  WHERE ("v"."exchange" IS NOT NULL)
                  ORDER BY "v"."exchange") AS "exchanges"
           FROM "public"."strategies" "s"
        )
 SELECT "sv"."strategy_id",
    "sv"."is_composite",
    "sv"."exchanges",
    ("sv"."exchanges" && "lv"."deferred_venues") AS "has_mt5_member",
    "sa"."computation_status",
    "sa"."computed_at" AS "analytics_computed_at",
    "sas"."computed_at" AS "series_written_at",
    "lr"."last_return_date",
    (CURRENT_DATE - "lr"."last_return_date") AS "days_since_last_return",
    (("sa"."strategy_id" IS NULL) OR ("sa"."computation_status" IS NULL) OR ("sa"."computation_status" <> ALL (ARRAY['complete'::"text", 'complete_with_warnings'::"text"])) OR ("lr"."last_return_date" IS NULL) OR ((CURRENT_DATE - "lr"."last_return_date") > 4)) AS "is_stale",
        CASE
            WHEN ("sa"."strategy_id" IS NULL) THEN 'no_analytics_row'::"text"
            WHEN (("sa"."computation_status" IS NULL) OR ("sa"."computation_status" <> ALL (ARRAY['complete'::"text", 'complete_with_warnings'::"text"]))) THEN 'status_not_success'::"text"
            WHEN ("lr"."last_return_date" IS NULL) THEN 'no_return_date'::"text"
            WHEN ((CURRENT_DATE - "lr"."last_return_date") > 4) THEN 'series_behind'::"text"
            ELSE NULL::"text"
        END AS "stale_reason"
   FROM (((("strategy_venue" "sv"
     CROSS JOIN "ledger_venue_set" "lv")
     LEFT JOIN "public"."strategy_analytics" "sa" ON (("sa"."strategy_id" = "sv"."strategy_id")))
     LEFT JOIN "public"."strategy_analytics_series" "sas" ON ((("sas"."strategy_id" = "sv"."strategy_id") AND ("sas"."kind" = 'daily_returns_grid'::"text"))))
     CROSS JOIN LATERAL ( SELECT "max"("public"."ledger_refresh_parse_series_date"(("e"."elem" ->> 'date'::"text"))) AS "last_return_date"
           FROM "jsonb_array_elements"(
                CASE
                    WHEN ("jsonb_typeof"("sa"."returns_series") = 'array'::"text") THEN "sa"."returns_series"
                    ELSE '[]'::"jsonb"
                END) "e"("elem")
          WHERE (("jsonb_typeof"("e"."elem") = 'object'::"text") AND (("e"."elem" ->> 'date'::"text") ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'::"text"))) "lr")
  WHERE ("sv"."exchanges" && "lv"."venues");


ALTER VIEW "public"."ledger_refresh_staleness" OWNER TO "postgres";


COMMENT ON VIEW "public"."ledger_refresh_staleness" IS 'Phase 161.1 / LEDGER-03: one row per ledger-backed strategy (deribit/sfox/mt5, single-key AND composite) with a freshness verdict that a job status transition cannot fake. Read-only; service_role only; security_invoker. The venue array in its body is the single SQL home of the ledger venue set (D-05) and mirrors _LEDGER_BACKED_SOURCES in long_fetch.py.';



COMMENT ON COLUMN "public"."ledger_refresh_staleness"."exchanges" IS 'Sorted distinct venues of this strategy, resolved through BOTH strategies.api_key_id (single-key) and strategy_keys (composite). D-06: the two links are mutually exclusive, so resolving only one of them makes every composite invisible.';



COMMENT ON COLUMN "public"."ledger_refresh_staleness"."analytics_computed_at" IS 'INFORMATIONAL ONLY — NOT the freshness verdict. sync_strategy_analytics_status re-stamps strategy_analytics.computed_at = now() on EVERY job transition, including the failed arm, so it advances while the analytics rot. Keying staleness on this column is the Phase 106 janitor bug. See is_stale.';



COMMENT ON COLUMN "public"."ledger_refresh_staleness"."series_written_at" IS 'INFORMATIONAL ONLY — NOT the freshness verdict. The write timestamp of this strategy''s daily_returns_grid sibling row. No status transition moves it, but it advances whenever a run COMPLETES even if that run produced no new day. This is the attempt-recency signal plan 02 uses for its refresh cooldown.';



COMMENT ON COLUMN "public"."ledger_refresh_staleness"."last_return_date" IS 'THE freshness key (D-03): max date across strategy_analytics.returns_series. Written only by real analytics runs — the single-key/CSV runner and run_stitch_composite_job — and never by a status transition, so it advances if and only if a run persisted a later day. NULL when the series is absent, empty, or entirely malformed, which reads as stale.';



COMMENT ON COLUMN "public"."ledger_refresh_staleness"."is_stale" IS 'TRUE when ANY of: no strategy_analytics row; computation_status outside the success PAIR (complete, complete_with_warnings — D-04, all 5 live ledger rows are the latter); last_return_date NULL; last_return_date older than 4 days (the largest legitimate age given MT5 weekend + holiday gaps). stale_reason names which one fired, so a fresh-but-failed row is visibly distinct from a healthy one.';



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



CREATE TABLE IF NOT EXISTS "public"."phase19_soak_daily" (
    "date_utc" "date" NOT NULL,
    "day_index" smallint NOT NULL,
    "error_rate" numeric(6,5) NOT NULL,
    "total_events" integer NOT NULL,
    "error_events" integer NOT NULL,
    "recorded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "notes" "text",
    CONSTRAINT "phase19_soak_daily_check" CHECK ((("error_events" >= 0) AND ("error_events" <= "total_events"))),
    CONSTRAINT "phase19_soak_daily_day_index_check" CHECK ((("day_index" >= 1) AND ("day_index" <= 14))),
    CONSTRAINT "phase19_soak_daily_error_rate_check" CHECK ((("error_rate" >= (0)::numeric) AND ("error_rate" <= (1)::numeric))),
    CONSTRAINT "phase19_soak_daily_total_events_check" CHECK (("total_events" >= 0))
);


ALTER TABLE "public"."phase19_soak_daily" OWNER TO "postgres";


COMMENT ON TABLE "public"."phase19_soak_daily" IS 'Phase 19 / BACKBONE-04 daily rollup of /api/process-key error envelope rate during the 168h soak. Populated by /api/cron/phase19-error-rollup (Vercel daily cron). Read by .github/workflows/phase-19-stability.yml + go/no-go review. day_index = 1..7 relative to flag_flipped_at; allows 1..14 for over-extended soaks.';



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



CREATE TABLE IF NOT EXISTS "public"."scenario_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scenario_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone
);


ALTER TABLE "public"."scenario_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scenarios" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "allocator_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "draft" "jsonb" NOT NULL,
    "schema_version" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "scenarios_name_check" CHECK ((("length"("btrim"("name")) >= 1) AND ("length"("btrim"("name")) <= 120)))
);


ALTER TABLE "public"."scenarios" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."strategy_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "strategy_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "generation" bigint DEFAULT 1 NOT NULL,
    "nonce" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    CONSTRAINT "strategy_shares_generation_check" CHECK (("generation" >= 1))
);


ALTER TABLE "public"."strategy_shares" OWNER TO "postgres";


COMMENT ON TABLE "public"."strategy_shares" IS 'Phase 164 / SHARE-01, SHARE-03. ONE row per strategy carrying the share generation counter AND an immutable per-row nonce. ⛔ Stores NO token, raw or hashed (D-02): the link is the HMAC, under SHARE_TOKEN_SECRET, over the tag "qz.strategy-share.v1" then strategy_id then nonce then generation, derived in Node — so a leak of this table yields only uuids, an int and timestamps. ⚠️ The nonce is a MAC INPUT, not a token: it derives nothing without the secret, which is not in this database. STATE MACHINE: (1) no row -> the strategy has never been shared; (2) row with revoked_at IS NULL -> a live link exists, and it is re-derivable from (nonce, generation), so Copy Link returns the SAME url every time (SHARE-01 reuse); (3) row with revoked_at NOT NULL -> revoked, and generation has ALREADY been advanced past every link ever handed out, so all of them are dead (SHARE-03). Re-sharing clears revoked_at WITHOUT resetting generation, so the new link differs from every old one. ⛔ generation is monotonic AND BOUNDED by ENFORCEMENT: the owner holds UPDATE on this column (STEP 2 must grant it — revoke_strategy_share is SECURITY INVOKER and writes it AS THE CALLER) and the FOR ALL policy admits their own-row writes, so the raw PATCH reaches the row. What constrains it is the BEFORE INSERT OR UPDATE trigger strategy_shares_monotonic_generation (STEP 1b): it FORCES generation to 1 on every INSERT, refuses every rewind, and admits an advance of AT MOST +1 — so the counter can neither go backwards (link resurrection) nor be driven to the BIGINT ceiling (which wedged revoke and ABORTED the GDPR Art. 17 erasure in migration 20260827130000, both being the same generation + 1 statement). Being a trigger, it binds service_role too, which the column grants cannot.';



COMMENT ON COLUMN "public"."strategy_shares"."generation" IS 'Monotonic share generation, BIGINT. Feeds the Node-side HMAC as the third input; incrementing it is what makes revocation instantaneous for every previously-copied link. NEVER reset, NEVER decremented, and NEVER advanced by more than 1 in one statement.⚠️ BIGINT is HEADROOM, NOT the overflow fix: a client that can WRITE this column reaches 2^63-1 as easily as 2^31-1, and the resulting wedge (revoke, and the GDPR Art. 17 arm in migration 20260827130000, are the same generation + 1 statement) aborts the erasure of the very data subject who caused it. The FIX is STEP 1b, not the width: the trigger FORCES this column to 1 on every INSERT (covering the BYPASSRLS roles the INSERT grant cannot bind) and its rule (6) admits an advance of AT MOST +1, so reaching the ceiling would take on the order of 9.2e18 separately committed statements. Overflow is therefore unreachable BY CONSTRUCTION, which is why nothing on this surface carries a numeric_value_out_of_range handler — and why nothing should: swallowing that error would turn a loud, complete erasure failure into a silent, incomplete one. STEP 2 closes the INSERT half at the grant layer for `authenticated` by omitting this column from the INSERT grant; the trigger closes it for every other role, and bounds the UPDATE half besides.';



COMMENT ON COLUMN "public"."strategy_shares"."nonce" IS 'Phase 164, founder ruling 2026-08-27. Immutable per-row MAC witness. Feeds the Node-side HMAC as the THIRD input, so a row that is destroyed and re-created — via the strategies ON DELETE CASCADE, an admin DELETE, or a cascade route that does not exist yet — draws a FRESH nonce and lands in a token space DISJOINT from anything ever issued. That is what closes the delete-and-recreate resurrection family wholesale, where a per-column pin closed it one enumerated path at a time and kept missing one. ⛔ NOT a credential: holding it derives nothing without SHARE_TOKEN_SECRET, which is why it does not reopen the disclosure surface D-02 closed. ⛔ NOT client-writable, and that is load-bearing rather than tidy: STEP 2 grants authenticated INSERT on (strategy_id, created_by) and UPDATE on (revoked_at, generation) ONLY. MEASURED — with the nonce writable, an owner reads it under RLS, cascades the row away and re-inserts it verbatim, and the attack reproduces with the nonce in hand. Neither RPC NAMES this column, which is precisely why the restriction is compatible with SECURITY INVOKER (PostgreSQL requires column privilege only on columns a statement names). The trigger rule (0c) binds service_role, which grants cannot.';



COMMENT ON COLUMN "public"."strategy_shares"."revoked_at" IS 'Soft-revoke tombstone. NULL = live. Rows are never DELETEd (a delete would reset generation to 1 on re-share and RESURRECT already-revoked links — see the REVOKE DELETE in STEP 2).';



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
    CONSTRAINT "strategy_verifications_source_check" CHECK (("source" = ANY (ARRAY['okx'::"text", 'binance'::"text", 'bybit'::"text", 'csv'::"text", 'deribit'::"text", 'sfox'::"text", 'mt5'::"text"]))),
    CONSTRAINT "strategy_verifications_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'validated'::"text", 'metrics_captured'::"text", 'encrypted'::"text", 'report_queued'::"text", 'published'::"text"]))),
    CONSTRAINT "strategy_verifications_trust_tier_check" CHECK (("trust_tier" = ANY (ARRAY['api_verified'::"text", 'csv_uploaded'::"text", 'self_reported'::"text"])))
);


ALTER TABLE "public"."strategy_verifications" OWNER TO "postgres";


COMMENT ON TABLE "public"."strategy_verifications" IS 'Per-strategy verification tracking row. Phase 15 / CSV-01..CSV-03 — migration 093. Status state machine + trust-tier label; flow_type discriminates teaser/onboard/csv/internal_report/resync. Phase 19 / BACKBONE-07 will add UNIQUE INDEX on wizard_session_id (idempotency).';



COMMENT ON COLUMN "public"."strategy_verifications"."wizard_session_id" IS 'Phase 19 / BACKBONE-07 will add a UNIQUE INDEX here for cross-flow idempotency. Phase 15 leaves it un-uniqued so reruns of the CSV path during early-customer onboarding do not collide.';



COMMENT ON COLUMN "public"."strategy_verifications"."trust_tier" IS 'csv_uploaded variant ships in Phase 15 (the only value finalize_csv_strategy writes). api_verified + self_reported are reserved for Phase 17 / DESIGN-01 trust-tier polish + Phase 19 unified backbone consumers.';



COMMENT ON COLUMN "public"."strategy_verifications"."flow_type" IS 'Phase 15 only writes flow_type=''csv''. The full vocabulary (teaser/onboard/internal_report/csv/resync) is admitted by the CHECK so Phase 19 BACKBONE PRs do not have to ALTER the constraint when the unified flow lights up.';



COMMENT ON COLUMN "public"."strategy_verifications"."source" IS 'Phase 15 wrote source=''csv''. Phase 68 (DRB-02) widened the CHECK to admit ''deribit''. Phase 119 (SFOX-04) widened it to admit ''sfox''. Phase 135 (MT5SRC-03) widened it to admit ''mt5'' at the key-save/verify boundary. Full vocabulary: okx/binance/bybit/csv/deribit/sfox/mt5 — pinned in lockstep with TS SUPPORTED_EXCHANGES + the pydantic Literals.';



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
    CONSTRAINT "user_notes_scope_kind_check" CHECK (("scope_kind" = ANY (ARRAY['portfolio'::"text", 'holding'::"text", 'bridge_outcome'::"text", 'strategy'::"text", 'dashboard'::"text"])))
);


ALTER TABLE "public"."user_notes" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_notes" IS 'Per-user per-portfolio plain text notes pinned to the Notes widget. Nullable portfolio_id allows a global fallback note. 100KB content cap. See migration 037.';



COMMENT ON COLUMN "public"."user_notes"."content" IS 'Plain text. No markdown rendering, no rich text. CHECK constraint caps at 100KB to prevent abuse.';



COMMENT ON COLUMN "public"."user_notes"."scope_kind" IS 'Scope discriminator: one of portfolio, holding, bridge_outcome, strategy, dashboard. See ADR-0023 §4 user_note.*.update rows.';



COMMENT ON COLUMN "public"."user_notes"."scope_ref" IS 'Stringified scope target: portfolio=UUID, holding={venue}:{symbol}:{holding_type}, bridge_outcome=UUID, strategy=UUID, dashboard=literal ''allocations''. Validated by parseHoldingScopeRef() for the holding scope; portfolio/bridge_outcome/strategy are UUID text; dashboard is the fixed literal ''allocations'' (user-scoped book note). See src/lib/notes/scope-ref.ts + src/lib/notes/ownership.ts.';



CREATE OR REPLACE VIEW "public"."verification_requests" WITH ("security_invoker"='true') AS
 SELECT "id",
    NULL::"text" AS "email",
    "source" AS "exchange",
    NULL::"text" AS "api_key_encrypted",
    NULL::"text" AS "api_secret_encrypted",
    NULL::"text" AS "passphrase_encrypted",
    NULL::"text" AS "dek_encrypted",
    "status",
    "public_token",
    "expires_at",
    "metrics_snapshot" AS "results",
    "created_at",
    "transitioned_at" AS "completed_at"
   FROM "public"."strategy_verifications" "sv"
  WHERE ("flow_type" = 'teaser'::"text");


ALTER VIEW "public"."verification_requests" OWNER TO "postgres";


COMMENT ON VIEW "public"."verification_requests" IS 'Phase 19 / BACKBONE-04 step (d). Read-only VIEW over strategy_verifications WHERE flow_type=teaser. Writes rejected by INSTEAD OF triggers; new code writes strategy_verifications directly. SEC-1: security_invoker=true.';



CREATE TABLE IF NOT EXISTS "public"."verification_requests_legacy" (
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


ALTER TABLE "public"."verification_requests_legacy" OWNER TO "postgres";


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



ALTER TABLE ONLY "public"."allocator_equity_derived"
    ADD CONSTRAINT "allocator_equity_derived_pkey" PRIMARY KEY ("allocator_id", "kind");



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
    ADD CONSTRAINT "csv_daily_returns_pkey" PRIMARY KEY ("id");



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



ALTER TABLE ONLY "public"."phase19_soak_daily"
    ADD CONSTRAINT "phase19_soak_daily_pkey" PRIMARY KEY ("date_utc");



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



ALTER TABLE ONLY "public"."scenario_shares"
    ADD CONSTRAINT "scenario_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scenarios"
    ADD CONSTRAINT "scenarios_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategies"
    ADD CONSTRAINT "strategies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_analytics"
    ADD CONSTRAINT "strategy_analytics_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_analytics_series"
    ADD CONSTRAINT "strategy_analytics_series_pkey" PRIMARY KEY ("strategy_id", "kind");



ALTER TABLE ONLY "public"."strategy_analytics"
    ADD CONSTRAINT "strategy_analytics_strategy_id_key" UNIQUE ("strategy_id");



ALTER TABLE ONLY "public"."strategy_keys"
    ADD CONSTRAINT "strategy_keys_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_shares"
    ADD CONSTRAINT "strategy_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."strategy_shares"
    ADD CONSTRAINT "strategy_shares_strategy_id_key" UNIQUE ("strategy_id");



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



ALTER TABLE ONLY "public"."verification_requests_legacy"
    ADD CONSTRAINT "verification_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."verification_requests_legacy"
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



CREATE UNIQUE INDEX "api_keys_user_exchange_venue_account_uniq" ON "public"."api_keys" USING "btree" ("user_id", "exchange", "venue_account_id") WHERE (("venue_account_id" IS NOT NULL) AND ("disconnected_at" IS NULL));



COMMENT ON INDEX "public"."api_keys_user_exchange_venue_account_uniq" IS 'Phase 154 / WIZCONT-02: at most one LIVE api_keys row per (user, venue, account id). FAILS TOWARD THE EXISTING ROW — the duplicate INSERT raises 23505 and the route resolves to the row already there; never overwrite. ⭐ SCOPED TO LIVE ROWS (disconnected_at IS NULL): api_keys rows are RETAINED on soft-disconnect (20260422101911), so without that conjunct a DEAD row squats the slot forever and a re-connecting user gets a key every cron dispatcher skips — a strategy that silently never syncs. sync_status = ''revoked'' is deliberately NOT in the predicate. PARTIAL because NULL is the majority value; api_keys_venue_account_id_nonblank keeps '''' out. user_id LEADS deliberately — a non-tenant-leading unique index is the C-08 cross-tenant leak. Gate: supabase/tests/test_api_keys_venue_identity_uniq.sql.';



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



CREATE INDEX "csv_daily_returns_allocator_date_idx" ON "public"."csv_daily_returns" USING "btree" ("allocator_id", "date") WHERE ("allocator_id" IS NOT NULL);



CREATE UNIQUE INDEX "csv_daily_returns_api_key_date_key" ON "public"."csv_daily_returns" USING "btree" ("api_key_id", "date");



CREATE UNIQUE INDEX "csv_daily_returns_strategy_date_key" ON "public"."csv_daily_returns" USING "btree" ("strategy_id", "date");



CREATE INDEX "for_quants_leads_created_at_idx" ON "public"."for_quants_leads" USING "btree" ("created_at" DESC);



CREATE UNIQUE INDEX "for_quants_leads_email_day_uniq" ON "public"."for_quants_leads" USING "btree" ("lower"("email"), ((("created_at" AT TIME ZONE 'UTC'::"text"))::"date"));



COMMENT ON INDEX "public"."for_quants_leads_email_day_uniq" IS 'M-0324: dedups same-email same-UTC-day lead submissions, collapsing network-retry / double-submit duplicate rows and duplicate founder emails. Day key uses AT TIME ZONE UTC for immutability; lower(email) is defensive.';



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



CREATE INDEX "idx_strategies_user_id" ON "public"."strategies" USING "btree" ("user_id");



COMMENT ON INDEX "public"."idx_strategies_user_id" IS 'Phase 151 review F3. Owner-scoped reads (getOwnCapitalStrategies, hasAnyOwnStrategies, the composite-members / trades-upload / wizard owner guards) all filter strategies.user_id with an equality and had NO usable index: strategies_user_wizard_session_source_uniq leads on user_id but is PARTIAL on wizard_session_id IS NOT NULL, which no owner-scoped read can satisfy, so every one of them sequentially scanned the whole catalog. Deliberately single-column: the callers pair user_id with status <> ''archived'', and <> is not an indexable btree search key, so a trailing status column would narrow nothing and no caller selects only (user_id, status) so it cannot serve an index-only scan either.';



CREATE INDEX "idx_strategy_analytics_computing_started" ON "public"."strategy_analytics" USING "btree" ("computing_started_at") WHERE ("computation_status" = 'computing'::"text");



CREATE INDEX "idx_strategy_analytics_series_payload_present" ON "public"."strategy_analytics_series" USING "btree" ("strategy_id", "kind") WHERE ("payload" IS NOT NULL);



CREATE INDEX "idx_trades_strategy_timestamp" ON "public"."trades" USING "btree" ("strategy_id", "timestamp");



CREATE INDEX "idx_used_ack_tokens_used_at" ON "public"."used_ack_tokens" USING "btree" ("used_at");



CREATE INDEX "idx_user_app_roles_role" ON "public"."user_app_roles" USING "btree" ("role");



CREATE INDEX "idx_verification_requests_email" ON "public"."verification_requests_legacy" USING "btree" ("email");



CREATE INDEX "idx_verification_requests_public_token" ON "public"."verification_requests_legacy" USING "btree" ("public_token") WHERE ("public_token" IS NOT NULL);



CREATE INDEX "idx_verification_requests_status" ON "public"."verification_requests_legacy" USING "btree" ("status");



CREATE INDEX "match_decisions_allocator_original_strategy" ON "public"."match_decisions" USING "btree" ("allocator_id", "original_strategy_id");



CREATE INDEX "match_decisions_original_holding_ref" ON "public"."match_decisions" USING "btree" ("original_holding_ref") WHERE ("original_holding_ref" IS NOT NULL);



CREATE UNIQUE INDEX "portfolio_alerts_dedup_unacked" ON "public"."portfolio_alerts" USING "btree" ("portfolio_id", "alert_type") WHERE (("acknowledged_at" IS NULL) AND ("alert_type" <> 'rebalance_drift'::"text"));



CREATE UNIQUE INDEX "portfolio_alerts_rebalance_drift_weekly" ON "public"."portfolio_alerts" USING "btree" ("portfolio_id", "strategy_id", "alert_type", "date_trunc"('week'::"text", "triggered_at", 'UTC'::"text")) WHERE (("acknowledged_at" IS NULL) AND ("alert_type" = 'rebalance_drift'::"text"));



CREATE UNIQUE INDEX "portfolio_analytics_one_computing_per_portfolio" ON "public"."portfolio_analytics" USING "btree" ("portfolio_id") WHERE ("computation_status" = 'computing'::"text");



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



CREATE UNIQUE INDEX "scenario_shares_one_active_idx" ON "public"."scenario_shares" USING "btree" ("scenario_id") WHERE ("revoked_at" IS NULL);



CREATE INDEX "scenario_shares_scenario_idx" ON "public"."scenario_shares" USING "btree" ("scenario_id");



CREATE INDEX "scenario_shares_token_hash_idx" ON "public"."scenario_shares" USING "btree" ("token_hash");



CREATE INDEX "scenarios_allocator_updated_idx" ON "public"."scenarios" USING "btree" ("allocator_id", "updated_at" DESC);



CREATE INDEX "strategies_fingerprint_gin_idx" ON "public"."strategies" USING "gin" ("fingerprint") WHERE ("fingerprint" IS NOT NULL);



COMMENT ON INDEX "public"."strategies_fingerprint_gin_idx" IS 'Phase 19 / FINGERPRINT-01 / I-perf-2. GIN over the JSONB fingerprint body.';



CREATE UNIQUE INDEX "strategies_user_wizard_session_source_uniq" ON "public"."strategies" USING "btree" ("user_id", "wizard_session_id", "source") WHERE ("wizard_session_id" IS NOT NULL);



COMMENT ON INDEX "public"."strategies_user_wizard_session_source_uniq" IS 'Phase 140.4 / SEAMRIM-03 (review finding C-2). At most one strategies row per (user, wizard_session_id, source) — the double-submit fence for BOTH wizard paths. GUARANTEES: a repeat POST /api/strategies/csv-finalize for the same wizard session raises 23505 and rolls back both the strategies row and the strategy_verifications row (finalize_csv_strategy has no EXCEPTION block), and the pre-existing API-path guarantee is preserved EXACTLY because every API writer sets source=''wizard'' (create_wizard_strategy, add_wizard_composite_key). WHY `source` IS IN THE KEY: src/lib/wizard/localStorage.ts:379-381 restores wizardSessionId UNCONDITIONALLY on source from ONE shared storage key (STORAGE_KEY quantalyze_wizard_state_v1, :51), so an ABANDONED API draft carrying session S is later replayed into the CSV wizard; a two-column (user_id, wizard_session_id) key would make that user''s FIRST legitimate CSV submit collide and — because every retry reuses S — fail PERMANENTLY. Scoping by source removes the cross-source collision at zero cost to the API guarantee. Do NOT "simplify" this back to two columns; strategies.source is NOT NULL so there is no NULL-distinctness hole. user_id LEADS deliberately: wizard_session_id is caller-supplied and a non-tenant-leading unique index is the C-08 cross-tenant leak (see 20260726000225). SUPERSEDES strategies_user_wizard_session_uniq (20260602190000:52-54). Gate: supabase/tests/test_csv_finalize_double_submit.sql.';



CREATE INDEX "strategy_keys_owner_idx" ON "public"."strategy_keys" USING "btree" ("owner_id");



CREATE INDEX "strategy_keys_strategy_idx" ON "public"."strategy_keys" USING "btree" ("strategy_id", "seq");



CREATE UNIQUE INDEX "strategy_keys_strategy_seq_key" ON "public"."strategy_keys" USING "btree" ("strategy_id", "seq");



CREATE INDEX "strategy_shares_active_idx" ON "public"."strategy_shares" USING "btree" ("strategy_id", "generation") INCLUDE ("nonce") WHERE ("revoked_at" IS NULL);



CREATE UNIQUE INDEX "strategy_verifications_public_token_unique_idx" ON "public"."strategy_verifications" USING "btree" ("public_token") WHERE ("public_token" IS NOT NULL);



CREATE INDEX "strategy_verifications_status_idx" ON "public"."strategy_verifications" USING "btree" ("status");



CREATE INDEX "strategy_verifications_strategy_id_idx" ON "public"."strategy_verifications" USING "btree" ("strategy_id");



CREATE UNIQUE INDEX "strategy_verifications_strategy_wizard_session_uniq" ON "public"."strategy_verifications" USING "btree" ("strategy_id", "wizard_session_id");



COMMENT ON INDEX "public"."strategy_verifications_strategy_wizard_session_uniq" IS 'Phase 140.1 / PYAPI-01 (C-08). Tenant-scoped wizard double-submit prevention. SUPERSEDES the single-column strategy_verifications_wizard_session_id_unique_idx and the reasoning at migration 20260510173005:72-73: wizard_session_id is caller-supplied, so a single-column unique index makes it unique platform-wide and lets one tenant''s id reject - and then leak - another tenant''s verification row. strategy_verifications has no user_id column; strategy_id is the tenant key (strategies.user_id, per the owner RLS policy at 20260501055202:118-124). Gate: supabase/tests/test_strategy_verifications_wizard_session_tenant_scope.sql.';



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



CREATE OR REPLACE TRIGGER "api_keys_lock_exchange" BEFORE UPDATE OF "exchange" ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_api_key_venue_change"();



COMMENT ON TRIGGER "api_keys_lock_exchange" ON "public"."api_keys" IS 'Fires only on UPDATE OF exchange, so ordinary worker writes (sync_status, last_sync_at, cursors) never hit it. Companion to the table-level UPDATE REVOKE in migration 20260810120000.';



CREATE OR REPLACE TRIGGER "api_keys_published_composite_delete_guard" BEFORE DELETE ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_api_keys_published_composite_integrity"();



CREATE OR REPLACE TRIGGER "api_keys_scrub_attested_venue" BEFORE INSERT ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."scrub_client_supplied_attested_venue"();



COMMENT ON TRIGGER "api_keys_scrub_attested_venue" ON "public"."api_keys" IS 'Fires on every api_keys INSERT. Non-privileged callers cannot persist an attested_venue; NULL then means "unattested", which the probe gate treats as PROBE (fail-toward). Companion to migration 20260811210000.';



CREATE OR REPLACE TRIGGER "api_keys_scrub_venue_account_id" BEFORE INSERT ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."scrub_client_supplied_venue_account_id"();



COMMENT ON TRIGGER "api_keys_scrub_venue_account_id" ON "public"."api_keys" IS 'Fires on every api_keys INSERT. Non-privileged callers cannot persist a venue_account_id. Companion to migration 20260812120000.';



CREATE OR REPLACE TRIGGER "api_keys_stamp_first_added" AFTER INSERT ON "public"."api_keys" FOR EACH ROW EXECUTE FUNCTION "public"."stamp_first_api_key_added"();



CREATE OR REPLACE TRIGGER "audit_log_cold_retention_guard" AFTER DELETE ON "public"."audit_log_cold" REFERENCING OLD TABLE AS "old_table" FOR EACH STATEMENT EXECUTE FUNCTION "public"."retention_delete_guard"();



CREATE OR REPLACE TRIGGER "audit_log_retention_guard" AFTER DELETE ON "public"."audit_log" REFERENCING OLD TABLE AS "old_table" FOR EACH STATEMENT EXECUTE FUNCTION "public"."retention_delete_guard"();



CREATE OR REPLACE TRIGGER "bridge_outcomes_set_updated_at_trigger" BEFORE UPDATE ON "public"."bridge_outcomes" FOR EACH ROW EXECUTE FUNCTION "public"."bridge_outcomes_set_updated_at"();



CREATE OR REPLACE TRIGGER "bridge_outcomes_sync_holding_ref_trigger" BEFORE INSERT OR UPDATE OF "match_decision_id" ON "public"."bridge_outcomes" FOR EACH ROW EXECUTE FUNCTION "public"."bridge_outcomes_sync_holding_ref"();



CREATE OR REPLACE TRIGGER "check_strategy_api_key_ownership_trigger" BEFORE INSERT OR UPDATE OF "api_key_id" ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."check_strategy_api_key_ownership"();



COMMENT ON TRIGGER "check_strategy_api_key_ownership_trigger" ON "public"."strategies" IS 'Blocks cross-tenant api_key_id assignment. See migration 028.';



CREATE OR REPLACE TRIGGER "compute_jobs_set_updated_at_trigger" BEFORE UPDATE ON "public"."compute_jobs" FOR EACH ROW EXECUTE FUNCTION "public"."compute_jobs_set_updated_at"();



CREATE OR REPLACE TRIGGER "csv_daily_returns_owner_coherence" BEFORE INSERT OR UPDATE ON "public"."csv_daily_returns" FOR EACH ROW WHEN (("new"."api_key_id" IS NOT NULL)) EXECUTE FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"();



CREATE OR REPLACE TRIGGER "guard_strategies_publish_transition_trigger" BEFORE INSERT OR UPDATE ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."guard_strategies_publish_transition"();



COMMENT ON TRIGGER "guard_strategies_publish_transition_trigger" ON "public"."strategies" IS 'CONTRIB / SC-1: authenticated clients cannot INSERT or UPDATE a strategy to status=published directly; only the admin review route (service_role) may.';



CREATE OR REPLACE TRIGGER "guard_wizard_draft_updates_trigger" BEFORE UPDATE ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."guard_wizard_draft_updates"();



CREATE OR REPLACE TRIGGER "match_decisions_visibility_check" BEFORE INSERT ON "public"."match_decisions" FOR EACH ROW EXECUTE FUNCTION "public"."_match_decisions_visibility_check"();



CREATE OR REPLACE TRIGGER "portfolio_strategies_seed_weight_snapshot_trigger" AFTER INSERT ON "public"."portfolio_strategies" FOR EACH ROW EXECUTE FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"();



CREATE OR REPLACE TRIGGER "portfolios_reject_sentinel" BEFORE INSERT OR UPDATE ON "public"."portfolios" FOR EACH ROW EXECUTE FUNCTION "public"."reject_sentinel_writes"();



CREATE OR REPLACE TRIGGER "portfolios_seed_weight_snapshots_trigger" AFTER INSERT ON "public"."portfolios" FOR EACH ROW EXECUTE FUNCTION "public"."seed_weight_snapshots_for_portfolio"();



CREATE OR REPLACE TRIGGER "positions_set_updated_at_trigger" BEFORE UPDATE ON "public"."positions" FOR EACH ROW EXECUTE FUNCTION "public"."positions_set_updated_at"();



CREATE OR REPLACE TRIGGER "profiles_lock_privileged_cols" BEFORE INSERT OR UPDATE OF "is_admin", "role", "tenant_id", "allocator_status", "manager_status", "partner_tag" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_profile_privileged_change"();



COMMENT ON TRIGGER "profiles_lock_privileged_cols" ON "public"."profiles" IS 'Backstops client writes to privileged profiles columns. Fires on INSERT and on UPDATE OF the six privileged columns only, so ordinary profile edits (display_name, bio, company, …) never hit it. Companion to the column GRANT allowlist + INSERT/DELETE REVOKE in this migration.';



CREATE OR REPLACE TRIGGER "profiles_reject_sentinel" BEFORE INSERT OR UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."reject_sentinel_writes"();



CREATE OR REPLACE TRIGGER "strategies_reject_sentinel" BEFORE INSERT OR UPDATE ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."reject_sentinel_writes"();



CREATE OR REPLACE TRIGGER "strategy_analytics_stamp_computing_started_trigger" BEFORE UPDATE ON "public"."strategy_analytics" FOR EACH ROW EXECUTE FUNCTION "public"."strategy_analytics_stamp_computing_started"();



COMMENT ON TRIGGER "strategy_analytics_stamp_computing_started_trigger" ON "public"."strategy_analytics" IS 'JOB-01 / D-17 / D-18: fires on UPDATE only -- not on insert, not on delete. Coerces computing_started_at so no writer can advance the clock on a row that is already computing, stamps a computing row an update left unstamped, and clears the stamp on every exit from computing. Scope note for schema readers: the insert path is a genuine first transition (nothing to advance) and an inserted (computing, NULL) row is the D-11 population, whose remedy is the reap_strategy_analytics_stuck_computing clock-start arm, not this trigger. Widening to delete would require the sanitize_user erasure exemption (20260710160000:67).';



CREATE OR REPLACE TRIGGER "strategy_keys_owner_coherence" BEFORE INSERT OR UPDATE ON "public"."strategy_keys" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_strategy_keys_owner_coherence"();



CREATE OR REPLACE TRIGGER "strategy_shares_monotonic_generation" BEFORE INSERT OR UPDATE ON "public"."strategy_shares" FOR EACH ROW EXECUTE FUNCTION "public"."strategy_shares_enforce_monotonic_generation"();



CREATE OR REPLACE TRIGGER "trg_portfolio_strategies_own_capital_on_repoint" BEFORE UPDATE OF "strategy_id" ON "public"."portfolio_strategies" FOR EACH ROW EXECUTE FUNCTION "public"."guard_allocation_requires_own_capital"();



COMMENT ON TRIGGER "trg_portfolio_strategies_own_capital_on_repoint" ON "public"."portfolio_strategies" IS 'OWN-03 / D-03-A hard invariant at the table layer, REPOINT side (rev-3, finding F4). Fires on UPDATE OF strategy_id ONLY. Without it, an owner could PATCH an existing position''s strategy_id to a team_review or self-owned unmarked strategy and reach the forbidden state without an INSERT and without a mark change — invisible to both the INSERT trigger and the mark-transition guard. The column target is load-bearing: the shipped alias UPDATE sets only `alias`, so this trigger never evaluates for it (150-RESEARCH § Pitfall 2).';



CREATE OR REPLACE TRIGGER "trg_portfolio_strategies_own_capital_only" BEFORE INSERT ON "public"."portfolio_strategies" FOR EACH ROW EXECUTE FUNCTION "public"."guard_allocation_requires_own_capital"();



COMMENT ON TRIGGER "trg_portfolio_strategies_own_capital_only" ON "public"."portfolio_strategies" IS 'OWN-03 / D-03-A hard invariant at the table layer, CREATE side. Fires on the INSERT event ONLY — a blanket UPDATE arm breaks the shipped alias UPDATE on every legacy row whose strategy is unmarked (150-RESEARCH § Pitfall 2). The repoint side is the companion trigger trg_portfolio_strategies_own_capital_on_repoint.';



CREATE OR REPLACE TRIGGER "trg_strategies_team_review_mark_guard" BEFORE UPDATE OF "capital_ownership" ON "public"."strategies" FOR EACH ROW EXECUTE FUNCTION "public"."guard_team_review_mark_no_stranded_positions"();



COMMENT ON TRIGGER "trg_strategies_team_review_mark_guard" ON "public"."strategies" IS 'OWN-03 / SC 2b UPDATE side. Fires on UPDATE OF capital_ownership ONLY. Without it, an owner''s raw PostgREST PATCH to team_review strands every live position — the exact hole flip_capital_ownership_to_team_review() exists to close, reachable without ever calling it.';



CREATE OR REPLACE TRIGGER "user_notes_set_updated_at_trigger" BEFORE UPDATE ON "public"."user_notes" FOR EACH ROW EXECUTE FUNCTION "public"."user_notes_set_updated_at"();



CREATE OR REPLACE TRIGGER "verification_requests_view_readonly_delete" INSTEAD OF DELETE ON "public"."verification_requests" FOR EACH ROW EXECUTE FUNCTION "public"."verification_requests_view_readonly_trigger"();



CREATE OR REPLACE TRIGGER "verification_requests_view_readonly_insert" INSTEAD OF INSERT ON "public"."verification_requests" FOR EACH ROW EXECUTE FUNCTION "public"."verification_requests_view_readonly_trigger"();



CREATE OR REPLACE TRIGGER "verification_requests_view_readonly_update" INSTEAD OF UPDATE ON "public"."verification_requests" FOR EACH ROW EXECUTE FUNCTION "public"."verification_requests_view_readonly_trigger"();



ALTER TABLE ONLY "public"."allocation_events"
    ADD CONSTRAINT "allocation_events_portfolio_id_fkey" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."allocation_events"
    ADD CONSTRAINT "allocation_events_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id");



ALTER TABLE ONLY "public"."allocator_equity_derived"
    ADD CONSTRAINT "allocator_equity_derived_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



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
    ADD CONSTRAINT "csv_daily_returns_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."csv_daily_returns"
    ADD CONSTRAINT "csv_daily_returns_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."scenario_shares"
    ADD CONSTRAINT "scenario_shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scenario_shares"
    ADD CONSTRAINT "scenario_shares_scenario_id_fkey" FOREIGN KEY ("scenario_id") REFERENCES "public"."scenarios"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scenarios"
    ADD CONSTRAINT "scenarios_allocator_id_fkey" FOREIGN KEY ("allocator_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."strategy_keys"
    ADD CONSTRAINT "strategy_keys_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_keys"
    ADD CONSTRAINT "strategy_keys_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_keys"
    ADD CONSTRAINT "strategy_keys_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_shares"
    ADD CONSTRAINT "strategy_shares_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."strategy_shares"
    ADD CONSTRAINT "strategy_shares_strategy_id_fkey" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE CASCADE;



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



ALTER TABLE ONLY "public"."verification_requests_legacy"
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



ALTER TABLE "public"."allocator_equity_derived" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "allocator_equity_derived_owner_select" ON "public"."allocator_equity_derived" FOR SELECT TO "authenticated" USING (("allocator_id" = "auth"."uid"()));



COMMENT ON POLICY "allocator_equity_derived_owner_select" ON "public"."allocator_equity_derived" IS 'Owner-only SELECT: an authenticated user reads only their own derived-equity rows. No INSERT/UPDATE/DELETE for authenticated — the worker is the sole producer via service_role. Anon has no policy and is denied. Phase 115.1 / T-115.1-04.';



CREATE POLICY "allocator_equity_derived_service_all" ON "public"."allocator_equity_derived" USING (("auth"."role"() = 'service_role'::"text")) WITH CHECK (("auth"."role"() = 'service_role'::"text"));



COMMENT ON POLICY "allocator_equity_derived_service_all" ON "public"."allocator_equity_derived" IS 'Service-role writer policy. The analytics worker (service key) is the sole producer of derived-equity rows. Phase 115.1.';



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



CREATE POLICY "csv_daily_returns_allocator_owner_select" ON "public"."csv_daily_returns" FOR SELECT TO "authenticated" USING (("allocator_id" = "auth"."uid"()));



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


ALTER TABLE "public"."phase19_soak_daily" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "phase19_soak_daily_anon_select" ON "public"."phase19_soak_daily" FOR SELECT TO "authenticated", "anon", "service_role" USING (true);



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



CREATE POLICY "profiles_self_update" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id")) WITH CHECK (("auth"."uid"() = "id"));



COMMENT ON POLICY "profiles_self_update" ON "public"."profiles" IS 'Audit-2026-05-07 P337. USING + WITH CHECK both require auth.uid() = id. No OR-true escape allowed.';



ALTER TABLE "public"."reconciliation_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."relationship_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."resend_message_correlation" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scenario_commit_idem_self" ON "public"."scenario_commit_idempotency" FOR SELECT USING (("allocator_id" = "auth"."uid"()));



COMMENT ON POLICY "scenario_commit_idem_self" ON "public"."scenario_commit_idempotency" IS 'Defense-in-depth: an allocator can SELECT only their own dedup rows. The route uses the service-role admin client (bypasses RLS) for both the SELECT lookup and the post-commit INSERT; this policy guards a future re-route through the user-scoped client.';



ALTER TABLE "public"."scenario_commit_idempotency" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scenario_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scenario_shares_owner" ON "public"."scenario_shares" TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."scenarios" "s"
  WHERE (("s"."id" = "scenario_shares"."scenario_id") AND ("s"."allocator_id" = "auth"."uid"()))))));



ALTER TABLE "public"."scenarios" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "scenarios_owner" ON "public"."scenarios" TO "authenticated" USING (("allocator_id" = "auth"."uid"())) WITH CHECK (("allocator_id" = "auth"."uid"()));



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



ALTER TABLE "public"."strategy_keys" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_keys_owner" ON "public"."strategy_keys" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."strategy_shares" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "strategy_shares_owner" ON "public"."strategy_shares" TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK ((("created_by" = "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."strategies" "s"
  WHERE (("s"."id" = "strategy_shares"."strategy_id") AND ("s"."user_id" = "auth"."uid"()))))));



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



ALTER TABLE "public"."verification_requests_legacy" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "verification_requests_legacy_admin_select" ON "public"."verification_requests_legacy" FOR SELECT USING ("public"."current_user_has_app_role"(ARRAY['admin'::"text"]));



CREATE POLICY "verification_requests_legacy_public_token_select" ON "public"."verification_requests_legacy" FOR SELECT USING ((("public_token" IS NOT NULL) AND ("expires_at" > "now"()) AND ("created_at" > ("now"() - '90 days'::interval))));



COMMENT ON POLICY "verification_requests_legacy_public_token_select" ON "public"."verification_requests_legacy" IS 'M-6 — 90-day public-token reachability window. WARNING: this USING clause has NO token-equality predicate; it is safe ONLY because (a) SELECT is REVOKEd from anon + authenticated below, and (b) the /api/verify-strategy/[id]/status route reads via the admin client (RLS bypass) and matches the token in app code with a constant-time safeCompare. If a future migration re-GRANTs base SELECT to anon/authenticated, this policy alone would let that role enumerate every non-expired teaser row — re-add an explicit public_token match before any such GRANT.';



CREATE POLICY "verification_requests_service_all" ON "public"."verification_requests_legacy" USING (("auth"."role"() = 'service_role'::"text"));



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



REVOKE ALL ON FUNCTION "public"."add_wizard_composite_key"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."add_wizard_composite_key"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."admin_role_mutate"("p_actor_id" "uuid", "p_target_id" "uuid", "p_role" "text", "p_action" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."admin_role_mutate"("p_actor_id" "uuid", "p_target_id" "uuid", "p_role" "text", "p_action" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."advance_sync_cursor"("p_api_key_id" "uuid", "p_job_id" "uuid", "p_claim_token" "uuid", "p_last_fetched_ts" timestamp with time zone, "p_last_sync_at" timestamp with time zone, "p_account_balance" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."advance_sync_cursor"("p_api_key_id" "uuid", "p_job_id" "uuid", "p_claim_token" "uuid", "p_last_fetched_ts" timestamp with time zone, "p_last_sync_at" timestamp with time zone, "p_account_balance" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."api_key_cooldown_remaining"("p_api_key_id" "uuid", "p_cooldown_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."api_key_cooldown_remaining"("p_api_key_id" "uuid", "p_cooldown_seconds" integer) TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean, "p_kind_include" "text"[], "p_kind_exclude" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_compute_jobs_with_priority"("p_batch_size" integer, "p_worker_id" "text", "p_unified_backbone_active" boolean, "p_kind_include" "text"[], "p_kind_exclude" "text"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_abandoned_wizard_drafts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_abandoned_wizard_drafts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text", "p_portfolio_fingerprint" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text", "p_portfolio_fingerprint" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."commit_scenario_batch"("p_allocator_id" "uuid", "p_diffs" "jsonb", "p_idempotency_key" "text", "p_request_hash" "text", "p_portfolio_fingerprint" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."computation_error_copy"("p_error_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."computation_error_copy"("p_error_kind" "text") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."create_scenario_share"("p_scenario_id" "uuid", "p_token_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_scenario_share"("p_scenario_id" "uuid", "p_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_scenario_share"("p_scenario_id" "uuid", "p_token_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_strategy_share"("p_strategy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_strategy_share"("p_strategy_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid", "p_venue_account_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_wizard_strategy"("p_user_id" "uuid", "p_exchange" "text", "p_label" "text", "p_api_key_encrypted" "text", "p_api_secret_encrypted" "text", "p_passphrase_encrypted" "text", "p_dek_encrypted" "text", "p_nonce" "text", "p_kek_version" integer, "p_placeholder_name" "text", "p_wizard_session_id" "uuid", "p_venue_account_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_wizard_strategy_for_key"("p_user_id" "uuid", "p_api_key_id" "uuid", "p_placeholder_name" "text", "p_wizard_session_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_wizard_strategy_for_key"("p_user_id" "uuid", "p_api_key_id" "uuid", "p_placeholder_name" "text", "p_wizard_session_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) TO "service_role";
GRANT ALL ON FUNCTION "public"."current_user_has_app_role"("p_roles" "text"[]) TO "anon";



REVOKE ALL ON FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cutover_strategy_metrics_keys_atomic"("p_strategy_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text", "p_claim_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."defer_compute_job"("p_job_id" "uuid", "p_defer_seconds" integer, "p_reason" "text", "p_claim_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_allocator_api_key"("p_api_key_id" "uuid", "p_cascade_holdings" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_api_key_if_unreferenced"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_api_key_if_unreferenced"("p_api_key_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_api_key_if_unreferenced"("p_api_key_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."disconnect_allocator_api_key"("p_api_key_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_allocator_holdings_owner_coherence"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_api_keys_published_composite_integrity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_api_keys_published_composite_integrity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_csv_daily_returns_owner_coherence"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_strategy_keys_owner_coherence"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_strategy_keys_owner_coherence"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_compute_job"("p_strategy_id" "uuid", "p_kind" "text", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_exchange" "text", "p_metadata" "jsonb", "p_allocator_id" "uuid", "p_api_key_id" "uuid", "p_run_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_compute_portfolio_job"("p_portfolio_id" "uuid", "p_idempotency_key" "text", "p_parent_job_ids" "uuid"[], "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_derive_broker_dailies_for_allocator_keys"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_derive_broker_dailies_for_allocator_keys"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_ledger_composite_refresh"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_ledger_composite_refresh"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_ledger_refresh_for_strategies"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_ledger_refresh_for_strategies"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."finalize_csv_strategy_with_returns"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text", "p_rows" "jsonb", "p_terminal_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_csv_strategy_with_returns"("p_user_id" "uuid", "p_wizard_session_id" "uuid", "p_fmt" "text", "p_strategy_name" "text", "p_rows" "jsonb", "p_terminal_status" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric, "p_terminal_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric, "p_terminal_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finalize_wizard_strategy"("p_strategy_id" "uuid", "p_user_id" "uuid", "p_name" "text", "p_description" "text", "p_category_id" "uuid", "p_strategy_types" "text"[], "p_subtypes" "text"[], "p_markets" "text"[], "p_supported_exchanges" "text"[], "p_leverage_range" "text", "p_aum" numeric, "p_max_capacity" numeric, "p_terminal_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."flip_capital_ownership_to_team_review"("p_strategy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."flip_capital_ownership_to_team_review"("p_strategy_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."flip_capital_ownership_to_team_review"("p_strategy_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_admin_compute_jobs"("p_limit" integer, "p_offset" integer, "p_status" "text", "p_kind" "text", "p_exchange" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_allocator_latest_batch_meta"("p_allocator_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_allocator_recommendations"("p_allocator_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_analytics" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_analytics" TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_latest_portfolio_analytics_for_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_latest_portfolio_analytics_for_user"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_latest_portfolio_analytics_for_user"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_published_trust_signals"("p_strategy_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_shared_scenario"("p_token_hash" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_shared_scenario"("p_token_hash" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_shared_scenario"("p_token_hash" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_compute_jobs"("p_strategy_id" "uuid", "p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_verified_cohort_rank"("p_sharpe" double precision, "p_sortino" double precision, "p_max_dd" double precision) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_verified_cohort_rank"("p_sharpe" double precision, "p_sortino" double precision, "p_max_dd" double precision) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_verified_cohort_rank"("p_sharpe" double precision, "p_sortino" double precision, "p_max_dd" double precision) TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_allocation_requires_own_capital"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_allocation_requires_own_capital"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_strategies_publish_transition"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_strategies_publish_transition"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."guard_team_review_mark_no_stranded_positions"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."guard_team_review_mark_no_stranded_positions"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."ledger_refresh_parse_series_date"("p_text" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ledger_refresh_parse_series_date"("p_text" "text") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."phase19_soak_record_day"("p_date_utc" "date", "p_day_index" smallint, "p_error_rate" numeric, "p_total_events" integer, "p_error_events" integer, "p_notes" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase19_soak_record_day"("p_date_utc" "date", "p_day_index" smallint, "p_error_rate" numeric, "p_total_events" integer, "p_error_events" integer, "p_notes" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."phase19_soak_status"("p_since" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."positions_set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."positions_set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."positions_set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_api_key_venue_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_api_key_venue_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_api_key_venue_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prevent_profile_privileged_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."prevent_profile_privileged_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."prevent_profile_privileged_change"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."replace_allocator_equity_snapshots"("p_allocator_id" "uuid", "p_rows" "jsonb", "p_depth_months" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."replace_allocator_equity_snapshots"("p_allocator_id" "uuid", "p_rows" "jsonb", "p_depth_months" integer) TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."revoke_strategy_share"("p_strategy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revoke_strategy_share"("p_strategy_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."sanitize_user"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sanitize_user"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."scrub_client_supplied_attested_venue"() TO "anon";
GRANT ALL ON FUNCTION "public"."scrub_client_supplied_attested_venue"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."scrub_client_supplied_attested_venue"() TO "service_role";



GRANT ALL ON FUNCTION "public"."scrub_client_supplied_venue_account_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."scrub_client_supplied_venue_account_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."scrub_client_supplied_venue_account_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_weight_snapshot_for_portfolio_strategy"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."seed_weight_snapshots_for_portfolio"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."seed_weight_snapshots_for_portfolio"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."send_intro_with_decision"("p_allocator_id" "uuid", "p_strategy_id" "uuid", "p_original_strategy_id" "uuid", "p_candidate_id" "uuid", "p_admin_note" "text", "p_decided_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_allocator_holdings_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_allocator_holdings_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_allocator_holdings_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_compute_job_progress"("p_job_id" "uuid", "p_claim_token" "uuid", "p_progress" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_compute_job_progress"("p_job_id" "uuid", "p_claim_token" "uuid", "p_progress" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_wizard_composite_members"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_members" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_wizard_composite_members"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_members" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_wizard_composite_members"("p_user_id" "uuid", "p_strategy_id" "uuid", "p_members" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."stamp_api_key_429"("p_api_key_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."stamp_api_key_429"("p_api_key_id" "uuid") TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."strategy_analytics_stamp_computing_started"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."strategy_analytics_stamp_computing_started"() TO "service_role";



GRANT ALL ON FUNCTION "public"."strategy_shares_enforce_monotonic_generation"() TO "anon";
GRANT ALL ON FUNCTION "public"."strategy_shares_enforce_monotonic_generation"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."strategy_shares_enforce_monotonic_generation"() TO "service_role";



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



GRANT ALL ON FUNCTION "public"."verification_requests_view_readonly_trigger"() TO "anon";
GRANT ALL ON FUNCTION "public"."verification_requests_view_readonly_trigger"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."verification_requests_view_readonly_trigger"() TO "service_role";
























GRANT ALL ON TABLE "public"."allocation_events" TO "anon";
GRANT ALL ON TABLE "public"."allocation_events" TO "authenticated";
GRANT ALL ON TABLE "public"."allocation_events" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_equity_derived" TO "anon";
GRANT ALL ON TABLE "public"."allocator_equity_derived" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_equity_derived" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_equity_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_holdings" TO "anon";
GRANT ALL ON TABLE "public"."allocator_holdings" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_holdings" TO "service_role";



GRANT ALL ON TABLE "public"."allocator_preferences" TO "anon";
GRANT ALL ON TABLE "public"."allocator_preferences" TO "authenticated";
GRANT ALL ON TABLE "public"."allocator_preferences" TO "service_role";



GRANT REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."api_keys" TO "anon";
GRANT REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."api_keys" TO "authenticated";
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
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("id"),UPDATE("id") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("display_name") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("display_name"),UPDATE("display_name") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("company") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("company"),UPDATE("company") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("description") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("description"),UPDATE("description") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("email") ON TABLE "public"."profiles" TO "service_role";
GRANT UPDATE("email") ON TABLE "public"."profiles" TO "authenticated";



GRANT UPDATE("telegram") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("website") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("website"),UPDATE("website") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("linkedin") ON TABLE "public"."profiles" TO "service_role";
GRANT UPDATE("linkedin") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("avatar_url") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("avatar_url"),UPDATE("avatar_url") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("role") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("role") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("manager_status") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("manager_status") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("allocator_status") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("allocator_status") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("created_at"),UPDATE("created_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("is_admin") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("is_admin") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("preferences_updated_at") ON TABLE "public"."profiles" TO "anon";
GRANT SELECT("preferences_updated_at"),UPDATE("preferences_updated_at") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("bio") ON TABLE "public"."profiles" TO "service_role";
GRANT UPDATE("bio") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("years_trading") ON TABLE "public"."profiles" TO "service_role";
GRANT UPDATE("years_trading") ON TABLE "public"."profiles" TO "authenticated";



GRANT SELECT("aum_range") ON TABLE "public"."profiles" TO "service_role";
GRANT UPDATE("aum_range") ON TABLE "public"."profiles" TO "authenticated";



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



GRANT ALL ON SEQUENCE "public"."csv_daily_returns_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."csv_daily_returns_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."csv_daily_returns_id_seq" TO "service_role";



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



GRANT ALL ON TABLE "public"."strategy_analytics" TO "anon";
GRANT ALL ON TABLE "public"."strategy_analytics" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_analytics" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_analytics_series" TO "anon";
GRANT ALL ON TABLE "public"."strategy_analytics_series" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_analytics_series" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_keys" TO "authenticated";
GRANT ALL ON TABLE "public"."strategy_keys" TO "service_role";



GRANT ALL ON TABLE "public"."ledger_refresh_staleness" TO "service_role";



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



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."phase19_soak_daily" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."phase19_soak_daily" TO "authenticated";
GRANT ALL ON TABLE "public"."phase19_soak_daily" TO "service_role";



GRANT ALL ON TABLE "public"."portfolio_alerts" TO "anon";
GRANT ALL ON TABLE "public"."portfolio_alerts" TO "authenticated";
GRANT ALL ON TABLE "public"."portfolio_alerts" TO "service_role";



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



GRANT ALL ON TABLE "public"."scenario_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."scenario_shares" TO "service_role";



GRANT ALL ON TABLE "public"."scenarios" TO "authenticated";
GRANT ALL ON TABLE "public"."scenarios" TO "service_role";



GRANT ALL ON TABLE "public"."strategy_shares" TO "service_role";
GRANT SELECT ON TABLE "public"."strategy_shares" TO "authenticated";



GRANT INSERT("strategy_id") ON TABLE "public"."strategy_shares" TO "authenticated";



GRANT INSERT("created_by") ON TABLE "public"."strategy_shares" TO "authenticated";



GRANT UPDATE("generation") ON TABLE "public"."strategy_shares" TO "authenticated";



GRANT UPDATE("revoked_at") ON TABLE "public"."strategy_shares" TO "authenticated";



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



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."verification_requests" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."verification_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_requests" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."verification_requests_legacy" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."verification_requests_legacy" TO "authenticated";
GRANT ALL ON TABLE "public"."verification_requests_legacy" TO "service_role";



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































