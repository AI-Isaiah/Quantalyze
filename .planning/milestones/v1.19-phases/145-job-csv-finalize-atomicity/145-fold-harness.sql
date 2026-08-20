-- 145-fold-harness.sql — LOCAL PROOF HARNESS for the Plan 03 fold migration
-- (20260819120000_csv_finalize_atomic_fold.sql) and its three SQL gates
-- =============================================================================
--
-- WARNING: THIS IS NOT A MIGRATION AND NOT A CI GATE. It never runs against
-- TEST or PROD. It extends .planning/phases/145-job-csv-finalize-atomicity/
-- 145-repro-harness.sql (Plan 01's committed harness, kept byte-stable — this
-- is a NEW file) so that the fold migration can be APPLIED and its gates
-- EXECUTED on a throwaway local Postgres cluster before anything is committed.
--
-- WHAT THIS FILE ADDS over the Plan 01 harness (each addition cited):
--   * csv_daily_returns replica in the 20260624120000 per-key-axis shape
--     (surrogate identity PK :32-33, NULLABLE strategy_id :28, XOR CHECK
--     :43-45, per-key allocator CHECK :48-50, both unique indexes :55-61, the
--     owner-coherence trigger :80-116) — the shape the fold's dailies INSERT
--     must satisfy (145-RESEARCH.md Pitfall 3 / plan blocker B3).
--   * Loader for the REAL persist_csv_daily_returns body
--     (20260522111839:111-186) + its grants (:198-210, incl. service_role) —
--     so the fold migration's STEP 0 both-parents-exist preflight passes and
--     the DROP has a real object to drop.
--   * Loader for the REAL create_wizard_strategy body (Migration B,
--     20260814120000:151-313) + its Migration-B grants (:439-450) + minimal
--     profiles/api_keys replicas + an auth.role() stub — NOT named by the
--     plan's harness spec, added as a Rule-3 deviation: Task 2(4) runs
--     test_csv_finalize_double_submit.sql (Part 4 calls the REAL API writer)
--     and test_wizard_session_idempotency.sql (reads that function's body,
--     canaries and grants) against this cluster; without these replicas the
--     four-gate run cannot execute at all.
--
-- FIDELITY LIMITS — read these before trusting any result obtained here
-- (carried from the Plan 01 harness, plus additions):
--   * NO row-level security. Nothing observed here may be read as evidence
--     about RLS on any table.
--   * NO real Supabase auth. auth.uid() / auth.role() below are STUBS that
--     read request.jwt.claims exactly the way the real GoTrue-installed
--     functions do (claims ->> 'sub' / ->> 'role', NULL when the GUC is
--     unset/empty) — the contract the repo's claims idiom drives via
--     set_config (test_csv_finalize_double_submit.sql:119/:230/:285).
--   * NO PostgREST. Grant assertions here prove ACL state, not the REST door.
--   * The three real triggers on strategies (strategies_reject_sentinel,
--     guard_strategies_publish_transition_trigger,
--     trg_strategies_team_review_mark_guard — 145-RESEARCH.md §2) are not
--     reproduced; none is on the fold's write path.
--   * Table shapes are MINIMAL replicas — only the columns the loaded
--     functions' statements name, plus every CHECK / index / FK those
--     statements must satisfy, each copied VERBATIM from the cited migration.
--   * api_keys omits its real CHECKs (attested_venue_matches_exchange,
--     venue_account_id_nonblank) — the gates never exercise them; the
--     create_wizard_strategy fixture call always satisfies both anyway.
--
-- CONSTRAINTS COPIED VERBATIM FROM THE REAL SCHEMA (do not "tidy" these — a
-- weakened copy silently makes a call pass here and fail in production):
--   * strategies status CHECK (5 values) ......... 20260716130000:58-61
--   * strategies.source NOT NULL DEFAULT 'legacy'  20260411103316:36
--   * strategies_user_wizard_session_source_uniq   20260728120000:167-169
--   * strategy_verifications columns + CHECKs ..... 20260501055202:77-99
--   * csv_daily_returns per-key-axis shape ........ 20260624120000:19-116
--
-- USAGE (PGBIN per the 143/144/145-01 tracer register; DISTINCT socket dir so
-- this cannot collide with the Plan 01 harness cluster):
--
--   PGBIN=/opt/homebrew/opt/postgresql@16/bin
--   SOCK="${TMPDIR:-/tmp}/145-tracer"
--   mkdir -p "$SOCK"
--   "$PGBIN/initdb" -D "$SOCK/data" -U postgres --no-locale -E UTF8
--   "$PGBIN/pg_ctl" -D "$SOCK/data" -o "-k $SOCK -c listen_addresses=''" -l "$SOCK/log" start
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d postgres -c "CREATE DATABASE q145f;"
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q145f -v ON_ERROR_STOP=1 \
--     -f .planning/phases/145-job-csv-finalize-atomicity/145-fold-harness.sql
--   "$PGBIN/psql" -h "$SOCK" -U postgres -d q145f -v ON_ERROR_STOP=1 \
--     -f supabase/migrations/20260819120000_csv_finalize_atomic_fold.sql
--   # then the four gates, each with -v ON_ERROR_STOP=1
--
-- WARNING: NEVER run this file against a Supabase project. It CREATEs an auth
-- schema stub and fabricates auth.users rows.
--
-- Reused by: 145-03 Task 1 (tracer), Task 2 (four-gate run), Task 3 (neuter
-- matrix — variants are CREATE OR REPLACEd on the throwaway cluster only;
-- repo files are never edited for a neuter).

-- --------------------------------------------------------------------------
-- Extensions the stub schema needs
-- --------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid()

-- --------------------------------------------------------------------------
-- Roles the VERBATIM grants need (20260728120000:314-315, 20260522111839:
-- 198-210, 20260814120000:439-450). On a real Supabase cluster these exist;
-- a throwaway initdb cluster has none.
-- --------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

-- --------------------------------------------------------------------------
-- auth schema stub: auth.users (FK root) + auth.uid() + auth.role()
-- --------------------------------------------------------------------------
-- Contracts replicated: auth.uid() resolves the caller's uuid from the
-- request.jwt.claims GUC's 'sub' claim; auth.role() resolves the 'role'
-- claim; both return NULL when the GUC is unset/empty. These are exactly the
-- properties the repo's claims idiom drives with set_config.
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

CREATE OR REPLACE FUNCTION auth.role()
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
$$;

-- --------------------------------------------------------------------------
-- public.profiles — MINIMAL replica: the columns
-- test_csv_finalize_double_submit.sql's seed INSERT names (:103-105).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id),
  display_name TEXT,
  email        TEXT,
  role         TEXT
);

-- --------------------------------------------------------------------------
-- public.api_keys — MINIMAL replica: the columns create_wizard_strategy's
-- INSERT (20260814120000:285-297) names.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_keys (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id),
  exchange              TEXT        NOT NULL,
  label                 TEXT,
  api_key_encrypted     TEXT,
  api_secret_encrypted  TEXT,
  passphrase_encrypted  TEXT,
  dek_encrypted         TEXT,
  nonce                 TEXT,
  kek_version           INTEGER,
  is_active             BOOLEAN     NOT NULL DEFAULT TRUE,
  attested_venue        TEXT,
  venue_account_id      TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- public.strategies — MINIMAL replica: the columns the finalize INSERT
-- (20260728120000:278-288) AND create_wizard_strategy's INSERT
-- (20260814120000:299-309) name, plus the real constraints those writes must
-- satisfy. api_key_id carries the real ON DELETE SET NULL semantics the
-- wizard replay fence relies on (20260814120000:235-241).
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.strategies (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES auth.users(id),
  api_key_id          UUID        REFERENCES public.api_keys(id) ON DELETE SET NULL,
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
  -- redefinition of strategies_status_check in the tree).
  CONSTRAINT strategies_status_check
    CHECK (status IN ('draft', 'pending_review', 'published', 'archived', 'private'))
);

-- Partial unique index copied VERBATIM from 20260728120000:167-169 — the
-- double-submit fence whose 23505 the fold's no-handler body rides.
CREATE UNIQUE INDEX IF NOT EXISTS strategies_user_wizard_session_source_uniq
  ON public.strategies (user_id, wizard_session_id, source)
  WHERE wizard_session_id IS NOT NULL;

-- --------------------------------------------------------------------------
-- public.strategy_verifications — MINIMAL replica (unchanged from the Plan 01
-- harness): columns the verification INSERT (20260728120000:299-305) names,
-- CHECKs + ON DELETE CASCADE FK from the real DDL (20260501055202:77-99).
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

-- --------------------------------------------------------------------------
-- public.csv_daily_returns — replica in the 20260624120000 PER-KEY-AXIS shape
-- (the shape the fold's dailies INSERT must satisfy — plan blocker B3).
-- Every structural element copied VERBATIM from the cited lines:
--   surrogate identity PK ................. 20260624120000:32-33
--   NULLABLE strategy_id .................. 20260624120000:28 (base FK shape
--                                           incl. ON DELETE CASCADE from
--                                           20260522111839:37)
--   per-key columns ....................... 20260624120000:38-40
--   XOR CHECK ............................. 20260624120000:43-45
--   per-key allocator CHECK ............... 20260624120000:48-50
--   (strategy_id, date) unique index ...... 20260624120000:55-56 (NON-partial
--                                           + NULLs-distinct, deliberately)
--   (api_key_id, date) unique index ....... 20260624120000:60-61
--   owner-coherence trigger + function .... 20260624120000:80-116 (gated
--                                           WHEN api_key_id IS NOT NULL — the
--                                           strategy-scoped fold INSERT never
--                                           fires it)
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.csv_daily_returns (
  id           BIGINT           GENERATED ALWAYS AS IDENTITY,
  strategy_id  UUID             REFERENCES public.strategies(id) ON DELETE CASCADE,
  date         DATE             NOT NULL,
  daily_return DOUBLE PRECISION NOT NULL,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  api_key_id   UUID             REFERENCES public.api_keys(id) ON DELETE CASCADE,
  allocator_id UUID             REFERENCES auth.users(id)      ON DELETE CASCADE,
  CONSTRAINT csv_daily_returns_pkey PRIMARY KEY (id),
  CONSTRAINT csv_daily_returns_source_xor
    CHECK (num_nonnulls(strategy_id, api_key_id) = 1),
  CONSTRAINT csv_daily_returns_per_key_allocator
    CHECK (api_key_id IS NULL OR allocator_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS csv_daily_returns_strategy_date_key
  ON public.csv_daily_returns (strategy_id, date);

CREATE UNIQUE INDEX IF NOT EXISTS csv_daily_returns_api_key_date_key
  ON public.csv_daily_returns (api_key_id, date);

CREATE OR REPLACE FUNCTION public.enforce_csv_daily_returns_owner_coherence()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public', 'pg_catalog'
AS $function$
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
$function$;

REVOKE ALL ON FUNCTION public.enforce_csv_daily_returns_owner_coherence() FROM PUBLIC;

DROP TRIGGER IF EXISTS csv_daily_returns_owner_coherence ON public.csv_daily_returns;
CREATE TRIGGER csv_daily_returns_owner_coherence
  BEFORE INSERT OR UPDATE ON public.csv_daily_returns
  FOR EACH ROW
  WHEN (NEW.api_key_id IS NOT NULL)
  EXECUTE FUNCTION public.enforce_csv_daily_returns_owner_coherence();

-- ==========================================================================
-- LOADER 1 — the REAL finalize_csv_strategy body (parent 1 of the fold)
-- ==========================================================================
-- Copied VERBATIM from supabase/migrations/
-- 20260728120000_csv_finalize_double_submit_idempotency.sql:196-309 (the
-- LATEST definition in the tree). Any drift between this copy and the
-- migration is a HARNESS bug — fix this copy, never the migration.
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
-- LOADER 2 — the REAL persist_csv_daily_returns body (parent 2 of the fold)
-- ==========================================================================
-- Copied VERBATIM from supabase/migrations/20260522111839_csv_daily_returns
-- .sql:111-186 (the ONLY definition in the tree — 20260624120000 and
-- 20260816140000 mention it in comments only). Any drift between this copy
-- and the migration is a HARNESS bug — fix this copy, never the migration.
CREATE OR REPLACE FUNCTION public.persist_csv_daily_returns(
  p_user_id     UUID,
  p_strategy_id UUID,
  p_rows        JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_auth_uid  UUID    := auth.uid();
  v_owner_id  UUID;
  v_row_count INTEGER;
BEGIN
  -- Guard 1: caller must have a session.
  IF v_auth_uid IS NULL THEN
    RAISE EXCEPTION 'persist_csv_daily_returns called without an auth session' USING ERRCODE = '42501';
  END IF;

  -- Guard 2: p_user_id must equal auth.uid() — defence-in-depth so a
  -- compromised route can't act on another user's behalf even if the RPC
  -- contract is misused.
  IF v_auth_uid <> p_user_id THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_user_id (%) does not match auth.uid (%)', p_user_id, v_auth_uid USING ERRCODE = '42501';
  END IF;

  -- Guard 3 — probe-oracle close (PR #272 mitigation, T-19.1-01):
  -- Collapse missing-strategy and wrong-owner into a single 42501. The two
  -- states must be indistinguishable to authenticated callers — otherwise
  -- they can enumerate which strategy_id UUIDs exist by reading the error
  -- code or message distinction. Legitimate callers only ever pass their
  -- own freshly-created strategy_id, so the collapse is information-free
  -- for them.
  SELECT user_id INTO v_owner_id
    FROM public.strategies WHERE id = p_strategy_id;
  IF v_owner_id IS NULL OR v_owner_id <> p_user_id THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: strategy % not accessible', p_strategy_id USING ERRCODE = '42501';
  END IF;

  -- Type guard (PR #272, T-19.1-06): p_rows MUST be an array before we
  -- call jsonb_array_length on it.
  IF jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows must be a JSONB array, got %', jsonb_typeof(p_rows) USING ERRCODE = '22023';
  END IF;

  -- Row-count cap: prevents a single call from inserting an unbounded
  -- series. The route validator also enforces ≤5000 upstream, so this is
  -- defence-in-depth.
  IF jsonb_array_length(p_rows) > 5000 THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows exceeds 5000 rows (got %)', jsonb_array_length(p_rows) USING ERRCODE = '22023';
  END IF;

  -- Empty-array guard: an empty p_rows is almost certainly a bug at the
  -- caller (the route validator should have rejected it).
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'persist_csv_daily_returns: p_rows is empty' USING ERRCODE = '22023';
  END IF;

  -- Set-based upsert. ON CONFLICT (strategy_id, date) makes the RPC
  -- idempotent — re-running with the same payload writes the same rows
  -- (with refreshed updated_at).
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

-- Grants copied VERBATIM from 20260522111839:198-210 (incl. the service_role
-- EXECUTE this function historically carried — the fold migration's DROP is
-- what retires it, and the harness must present the REAL pre-fold state).
REVOKE ALL ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) TO service_role;

-- ==========================================================================
-- LOADER 3 — the REAL create_wizard_strategy body (Migration B)
-- ==========================================================================
-- Copied VERBATIM from supabase/migrations/
-- 20260814120000_wizard_rpcs_revoke_authenticated.sql:151-313 (the LATEST
-- definition — Migration B, service_role-only gate, no v_auth_uid in code).
-- Needed so test_csv_finalize_double_submit.sql Part 4 (the cross-source
-- control, which calls the REAL API writer) and
-- test_wizard_session_idempotency.sql (body canaries + grant polarity) can
-- run against this cluster. Any drift is a HARNESS bug — fix this copy.
CREATE OR REPLACE FUNCTION create_wizard_strategy(
  p_user_id UUID,
  p_exchange TEXT,
  p_label TEXT,
  p_api_key_encrypted TEXT,
  p_api_secret_encrypted TEXT,
  p_passphrase_encrypted TEXT,
  p_dek_encrypted TEXT,
  p_nonce TEXT,
  p_kek_version INTEGER,
  p_placeholder_name TEXT,
  p_wizard_session_id UUID,
  p_venue_account_id TEXT DEFAULT NULL
)
RETURNS TABLE(strategy_id UUID, api_key_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
SET lock_timeout = '3s'
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

-- Grants copied VERBATIM from 20260814120000:439-450 (Migration B polarity:
-- service_role ONLY; anon and authenticated shut out).
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM anon;
REVOKE ALL ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_wizard_strategy(
  uuid, text, text, text, text, text, text, text, integer, text, uuid, text
) TO service_role;

-- ==========================================================================
-- ANTI-VACUITY ASSERTIONS — the REAL bodies loaded, not stubs
-- ==========================================================================
-- The 143 extraction-vacuity lesson: a gate green against an empty cluster
-- (or one loaded with stubs) proves nothing. Each loaded body is checked for
-- a fragment that is the signature of its LATEST source specifically.
DO $$
DECLARE
  v_fn_src    TEXT;
  v_code      TEXT;
  v_ins_start INT;
  v_ins_end   INT;
  v_ins_frag  TEXT;
BEGIN
  -- (1) finalize_csv_strategy: wizard_session_id inside the strategies-INSERT
  -- fragment — the signature of the 20260728120000 body (the superseded
  -- 20260716130500 body does NOT write it; 145-RESEARCH.md Pitfall 1).
  SELECT pg_get_functiondef('public.finalize_csv_strategy(uuid,uuid,text,text,text)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: finalize_csv_strategy(uuid,uuid,text,text,text) is missing - loader 1 did not run; every result against this cluster is meaningless';
  END IF;
  v_ins_start := strpos(v_fn_src, 'INSERT INTO strategies (');
  v_ins_end   := strpos(v_fn_src, 'RETURNING id INTO v_strategy_id');
  IF v_ins_start = 0 OR v_ins_end = 0 OR v_ins_end <= v_ins_start THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: could not locate the strategies INSERT in the loaded finalize_csv_strategy - anchors drifted or a stub was loaded; FIX THE LOADER, never this check';
  END IF;
  v_ins_frag := substr(v_fn_src, v_ins_start, v_ins_end - v_ins_start);
  IF v_ins_frag NOT LIKE '%p_wizard_session_id%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded finalize_csv_strategy does not write wizard_session_id in its strategies INSERT - a superseded or stub body was loaded, NOT the 20260728120000 body';
  END IF;

  -- (2) persist_csv_daily_returns: the ON CONFLICT upsert clause — the
  -- signature of the real 20260522111839 body (a stub INSERT would lack it).
  SELECT pg_get_functiondef('public.persist_csv_daily_returns(uuid,uuid,jsonb)'::regprocedure)
    INTO v_fn_src;
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: persist_csv_daily_returns(uuid,uuid,jsonb) is missing - loader 2 did not run; the fold migration''s STEP 0 preflight cannot be proven against this cluster';
  END IF;
  IF v_fn_src NOT LIKE '%ON CONFLICT (strategy_id, date) DO UPDATE%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded persist_csv_daily_returns lacks the ON CONFLICT (strategy_id, date) upsert - a stub body was loaded, NOT the 20260522111839 body';
  END IF;
  IF v_fn_src NOT LIKE '%5000%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded persist_csv_daily_returns lacks the 5000 cap - a stub body was loaded, NOT the 20260522111839 body';
  END IF;

  -- (3) create_wizard_strategy: Migration B signature — comment-stripped body
  -- carries NO v_auth_uid (the measured 3e detector from
  -- test_wizard_session_idempotency.sql:189-190) AND the wizdraft advisory
  -- lock fence is present.
  SELECT pg_get_functiondef(p.oid) INTO v_fn_src
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'create_wizard_strategy';
  IF v_fn_src IS NULL THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: create_wizard_strategy is missing - loader 3 did not run; the double-submit gate''s Part 4 cross-source control cannot run against this cluster';
  END IF;
  v_code := regexp_replace(v_fn_src, '--[^\n]*', '', 'g');
  IF v_code LIKE '%v_auth_uid%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded create_wizard_strategy still declares v_auth_uid in CODE - a Migration A (20260813150106) or older body was loaded, NOT the 20260814120000 Migration B body; test_wizard_session_idempotency.sql would mis-arm its section 4 against this cluster';
  END IF;
  IF v_fn_src NOT LIKE '%wizdraft:%' THEN
    RAISE EXCEPTION 'HARNESS VACUOUS: the loaded create_wizard_strategy lacks the wizdraft: advisory-lock fence - a stub body was loaded';
  END IF;

  RAISE NOTICE '145 fold-harness: REAL bodies loaded for finalize_csv_strategy (20260728120000), persist_csv_daily_returns (20260522111839) and create_wizard_strategy (20260814120000 Migration B); csv_daily_returns carries the 20260624120000 per-key-axis shape.';
END $$;
