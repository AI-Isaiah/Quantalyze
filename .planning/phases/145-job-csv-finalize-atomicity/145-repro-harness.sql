-- 145-repro-harness.sql — LOCAL PROOF HARNESS for the SC#1 arm-1 auth-guard
-- gate (JOB-06, Phase 145)
-- =============================================================================
--
-- WARNING: THIS IS NOT A MIGRATION AND NOT A CI GATE. It never runs against TEST
-- or PROD. It exists so that supabase/tests/test_csv_finalize_auth_guard.sql
-- can be EXECUTED against the REAL deployed body of finalize_csv_strategy on a
-- THROWAWAY local Postgres cluster before it is committed as a CI gate. The
-- 143 extraction-vacuity lesson applies: a gate that goes green against an
-- empty cluster (function absent, or a stub loaded in its place) proves
-- nothing. The anti-vacuity assertion at the tail of this file is what makes
-- "the REAL body loaded" an executed fact rather than an assumption.
--
-- Adapted from .planning/phases/144-job-wr-02-orphaned-running/
-- 144-throwaway-harness.sql (same throwaway-cluster mechanism; a different
-- table set, because finalize_csv_strategy touches strategies and
-- strategy_verifications only).
--
-- FIDELITY LIMITS — read these before trusting any result obtained here:
--   * NO row-level security. The gate's assertions are about the function's own
--     42501 guards, which run BEFORE any table write; nothing observed here may
--     be read as evidence about RLS on strategies or strategy_verifications.
--   * NO real Supabase auth. auth.uid() below is a STUB that reads
--     request.jwt.claims exactly the way the real GoTrue-installed function
--     does (current_setting('request.jwt.claims') ->> 'sub', NULL when the GUC
--     is unset/empty — the contract the repo's claims idiom drives via
--     set_config, see supabase/tests/test_csv_finalize_double_submit.sql:117-120).
--     The claims idiom works IDENTICALLY against the real TEST project, which is
--     where the gate runs in CI.
--   * NO PostgREST, no profiles table, no triggers. The three real triggers on
--     strategies (strategies_reject_sentinel, guard_strategies_publish_
--     transition_trigger, trg_strategies_team_review_mark_guard — see
--     145-RESEARCH.md section 2) are not reproduced; none is on the guard path.
--   * Table shapes are MINIMAL replicas — only the columns the function's two
--     INSERTs name, plus every CHECK / index / FK those inserts must satisfy,
--     each copied VERBATIM from the cited migration. They are NOT full replicas.
--
-- CONSTRAINTS COPIED VERBATIM FROM THE REAL SCHEMA (do not "tidy" these — a
-- weakened copy silently makes a call pass here and fail in production):
--   * strategies status CHECK (5 values) ........ 20260716130000:58-61
--   * strategies.source NOT NULL DEFAULT 'legacy' 20260411103316:36 (cited via
--     20260728120000:64-65 — the NULL-distinctness-hole rationale)
--   * strategies_user_wizard_session_source_uniq  20260728120000:167-169
--   * strategy_verifications columns + CHECKs .... 20260501055202:77-99
--     (FK ON DELETE CASCADE at :79)
--
-- USAGE (PGBIN per the 143/144 tracer register; DISTINCT data dir so this
-- cannot collide with any harness another checkout used):
--
--   PGBIN=/opt/homebrew/opt/postgresql@16/bin
--   SOCK="${TMPDIR:-/tmp}/145-tracer-wt"
--   mkdir -p "$SOCK"
--   "$PGBIN/initdb" -D "$SOCK/data" -U postgres --no-locale -E UTF8
--   "$PGBIN/pg_ctl" -D "$SOCK/data" -o "-k $SOCK -c listen_addresses=''" -l "$SOCK/log" start
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -c "CREATE DATABASE q145;"
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q145 -v ON_ERROR_STOP=1 -f .planning/phases/145-job-csv-finalize-atomicity/145-repro-harness.sql
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q145 -v ON_ERROR_STOP=1 -f supabase/tests/test_csv_finalize_auth_guard.sql
--
-- WARNING: NEVER run this file against a Supabase project. It CREATEs an auth
-- schema stub and fabricates auth.users rows.
--
-- Reused by: 145-01 Task 1 (tracer: run the gate GREEN against the real loaded
-- body, then the two neuter-RED variants). Plans 03+ may reuse it for local
-- iteration on the folded function's gate extension.

-- --------------------------------------------------------------------------
-- Extensions the stub schema needs
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --------------------------------------------------------------------------
-- Roles the VERBATIM grants (20260728120000:314-315) need. On a real Supabase
-- cluster these exist; a throwaway initdb cluster has neither.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- auth schema stub: auth.users (FK root) + auth.uid()
-- --------------------------------------------------------------------------
-- auth.uid() contract replicated: the real Supabase function resolves the
-- caller's uuid from the request.jwt.claims GUC's 'sub' claim and returns NULL
-- when no session is present. That is exactly the property the repo's claims
-- idiom drives with set_config('request.jwt.claims', <json with sub>, true)
-- and clears with set_config('request.jwt.claims', NULL, true)
-- (test_csv_finalize_double_submit.sql:119/:230/:285).
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id UUID,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$$;

-- --------------------------------------------------------------------------
-- public.strategies — MINIMAL replica: the columns the finalize INSERT
-- (20260728120000:278-288) names, plus the real constraints those writes must
-- satisfy.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategies (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id),
  name                TEXT        NOT NULL,
  status              TEXT        NOT NULL,
  -- source shape per 20260411103316:36 (NOT NULL DEFAULT 'legacy'): the
  -- NOT NULL is load-bearing for the partial unique index below — a nullable
  -- third column would make every row mutually distinct and the index inert
  -- (20260728120000:64-69).
  source              TEXT        NOT NULL DEFAULT 'legacy',
  strategy_types      TEXT[]      NOT NULL DEFAULT '{}',
  subtypes            TEXT[]      NOT NULL DEFAULT '{}',
  markets             TEXT[]      NOT NULL DEFAULT '{}',
  supported_exchanges TEXT[]      NOT NULL DEFAULT '{}',
  wizard_session_id   UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Status CHECK copied VERBATIM from 20260716130000:58-61 (the ONLY
  -- redefinition of strategies_status_check in the tree; original inline at
  -- 20260405061911:63).
  CONSTRAINT strategies_status_check
    CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'))
);

-- Partial unique index copied VERBATIM from 20260728120000:167-169 — the
-- double-submit fence the function's wizard_session_id write exists to arm.
CREATE UNIQUE INDEX IF NOT EXISTS strategies_user_wizard_session_source_uniq
  ON public.strategies (user_id, wizard_session_id, source)
  WHERE wizard_session_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- public.strategy_verifications — MINIMAL replica: the columns the
-- verification INSERT (20260728120000:299-305) names, with the CHECKs and the
-- ON DELETE CASCADE FK copied from the real DDL (20260501055202:77-99).
-- metrics_snapshot is omitted (never named by the INSERT, nullable in the
-- real table).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategy_verifications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id        UUID        NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  wizard_session_id  UUID        NOT NULL,
  status             TEXT        NOT NULL CHECK (status IN (
                       'draft','validated','metrics_captured',
                       'encrypted','report_queued','published'
                     )),
  trust_tier         TEXT        NOT NULL CHECK (trust_tier IN (
                       'api_verified','csv_uploaded','self_reported'
                     )),
  flow_type          TEXT        NOT NULL CHECK (flow_type IN (
                       'teaser','onboard','internal_report','csv','resync'
                     )),
  source             TEXT        NOT NULL CHECK (source IN (
                       'okx','binance','bybit','csv'
                     )),
  errors             JSONB,
  correlation_id     UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ==========================================================================
-- LOADER — the REAL finalize_csv_strategy body
-- ==========================================================================
-- Copied VERBATIM from supabase/migrations/
-- 20260728120000_csv_finalize_double_submit_idempotency.sql:196-309 (the
-- LATEST definition in the tree — 20260501055202 and 20260716130500 are
-- superseded; no later migration redefines it). Any drift between this copy
-- and the migration is a HARNESS bug — fix this copy, never the migration.
CREATE OR REPLACE FUNCTION public.finalize_csv_strategy(
  p_user_id            UUID,
  p_wizard_session_id  UUID,
  p_fmt                TEXT,
  p_strategy_name      TEXT,
  p_terminal_status    TEXT DEFAULT 'pending_review'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid     UUID := auth.uid();
  v_strategy_id  UUID;
BEGIN
  -- CONTRIB-02 guard (T-110-02): restrict the terminal status; 'published' is
  -- unreachable from any finalize caller. FIRST statement so it RAISEs before
  -- the strategies INSERT.
  IF p_terminal_status NOT IN ('pending_review', 'private') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_terminal_status % is not allowed (expected pending_review or private)',
      p_terminal_status
      USING ERRCODE = '22023';
  END IF;

  -- Caller-identity guard (mirrors create_wizard_strategy:140-153):
  -- the route layer calls with the authenticated user's id; we assert
  -- it matches the JWT so a SECURITY DEFINER RPC can't be abused via
  -- service_role to write rows under another user.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'finalize_csv_strategy called without an auth session'
      USING ERRCODE = '42501';
  END IF;

  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_user_id (%) does not match auth.uid (%)',
      p_user_id, v_auth_uid
      USING ERRCODE = '42501';
  END IF;

  -- Format whitelist (mirrors the analytics service envelope contract).
  IF p_fmt NOT IN ('daily_returns','daily_nav','trades') THEN
    RAISE EXCEPTION 'finalize_csv_strategy: invalid fmt %', p_fmt
      USING ERRCODE = '22023';
  END IF;

  -- Strategy-name guard — the user typed it on the Upload step. We
  -- enforce 1–80 chars matching the UI-SPEC contract; the route layer
  -- also validates, but defense-in-depth lives here so a service-role
  -- caller cannot bypass the limit. Empty / oversize / NULL all reject
  -- under SQLSTATE 22023 with a distinguishing message substring so
  -- plan 15-06 tests can pin the guard separately from the fmt guard.
  IF p_strategy_name IS NULL OR length(p_strategy_name) = 0 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name is required'
      USING ERRCODE = '22023';
  END IF;

  IF length(p_strategy_name) > 80 THEN
    RAISE EXCEPTION 'finalize_csv_strategy: p_strategy_name exceeds 80 characters'
      USING ERRCODE = '22023';
  END IF;

  -- Insert the strategies row. source='csv' marks the row's ingestion
  -- path; status=p_terminal_status ('pending_review' for the manager flow,
  -- 'private' for the CONTRIB-02 contribution flow) matches
  -- finalize_wizard_strategy's post-promotion state so downstream queries
  -- (strategy_grid, /strategies/[id]) treat CSV strategies the same as API
  -- strategies once they reach this terminal state. supported_exchanges is
  -- empty because CSV strategies have no broker linkage. strategy_types /
  -- subtypes / markets default empty per Phase 15 v0; Phase 17 metadata
  -- step (deferred) will populate.
  --
  -- Phase 140.4 / SEAMRIM-03: wizard_session_id is WRITTEN here. This single
  -- column write is what makes the partial index
  -- strategies_user_wizard_session_source_uniq bite — the index predicate is
  -- `WHERE wizard_session_id IS NOT NULL`, so omitting the column (the
  -- pre-140.4 body) left every CSV row outside it and a double-submit minted a
  -- second strategy + a second verification row, silently, at 200 OK. The
  -- function deliberately has NO `EXCEPTION` block: the resulting 23505 aborts
  -- the function and rolls BOTH inserts back, and routers/process_key.py's
  -- csv-finalize arm turns that into an idempotent 200 carrying the EXISTING
  -- strategy id.
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

  -- Insert the verification row at status='validated', trust_tier='csv_uploaded'.
  -- CONTRIB-02 note: KEPT on both terminal statuses — trust_tier is an
  -- owner-facing data-quality label, not a publish signal (the admin queue keys
  -- on strategies.status='pending_review').
  -- Phase 16 / OBSERV-06 will populate correlation_id; we leave NULL.
  -- FK ordering note: PostgreSQL allows the strategy_verifications.strategy_id
  -- FK to reference the just-inserted strategy because both inserts run in
  -- the same transaction (the SECURITY DEFINER function body is implicitly
  -- transactional). The FK check happens at COMMIT, not at the second INSERT.
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

-- Grants copied VERBATIM from 20260728120000:314-315.
REVOKE ALL ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_csv_strategy(UUID, UUID, TEXT, TEXT, TEXT) TO authenticated;

-- ==========================================================================
-- ANTI-VACUITY ASSERTION — the REAL body loaded, not a stub
-- ==========================================================================
-- Fragment-scoped on purpose, copying the 20260728120000 STEP-4 idiom
-- (:399-422): a whole-body ILIKE would be satisfied by the parameter
-- declaration alone, i.e. it would pass on a stub that never writes the
-- column. The wizard_session_id-inside-the-INSERT check is the signature of
-- the LATEST (20260728120000) body specifically — the superseded 20260716130500
-- body does NOT write it, so this assertion also proves the copy above was not
-- re-based on a superseded parent (145-RESEARCH.md Pitfall 1).
DO $$
DECLARE
  v_fn_src    TEXT;
  v_ins_start INT;
  v_ins_end   INT;
  v_ins_frag  TEXT;
BEGIN
  SELECT pg_get_functiondef('public.finalize_csv_strategy(uuid,uuid,text,text,text)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: finalize_csv_strategy(uuid,uuid,text,text,text) is missing - the loader did not run; every gate result against this cluster is meaningless';
  END IF;

  v_ins_start := strpos(v_fn_src, 'INSERT INTO strategies (');
  v_ins_end   := strpos(v_fn_src, 'RETURNING id INTO v_strategy_id');
  IF v_ins_start = 0 OR v_ins_end = 0 OR v_ins_end <= v_ins_start THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: could not locate the strategies INSERT in the loaded finalize_csv_strategy - the anchors have drifted or a stub was loaded; FIX THE ANCHORS or the loader, never this check';
  END IF;
  v_ins_frag := substr(v_fn_src, v_ins_start, v_ins_end - v_ins_start);

  IF v_ins_frag NOT LIKE '%wizard_session_id%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded finalize_csv_strategy does not write wizard_session_id in its strategies INSERT - a superseded or stub body was loaded, NOT the 20260728120000 body; every gate result against this cluster is meaningless';
  END IF;
  IF v_ins_frag NOT LIKE '%p_wizard_session_id%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded body names the wizard_session_id column but does not pass p_wizard_session_id as its value - drift from the 20260728120000 body';
  END IF;

  RAISE NOTICE '145 harness: REAL 20260728120000 finalize_csv_strategy body loaded (wizard_session_id write verified inside the INSERT fragment).';
END $$;
