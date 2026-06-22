-- ============================================================================
-- Migration: scenario_shares + get_shared_scenario read RPC (SHARE-02, SHARE-03)
-- Phase 25 / Plan 25-01
-- ============================================================================
-- The security foundation of read-only sharing. Adds:
--   (a) scenario_shares — a revocable, owner-scoped share record (token_hash at
--       rest, NEVER the raw token) keyed to a scenarios row;
--   (b) get_shared_scenario(p_token_hash) — the SINGLE, self-verifying
--       SECURITY DEFINER read path that resolves a share into ONLY the scenario
--       snapshot (name/draft/schema_version) + a strictly-scoped re-resolution
--       of the draft's addedStrategies[].id PUBLISHED series — and nothing else.
--
-- WHY THIS IS THE PHASE'S REASON TO EXIST: the share read path is the sole
-- anon/cross-tenant data path and runs SECURITY DEFINER, so RLS does NOT protect
-- its body — the scoping is hard-coded IN the function. RLS and a SECURITY
-- DEFINER body both FAIL SILENTLY: a loosened predicate (an extra join, a
-- SELECT *, a forgotten revoked_at filter) ships GREEN unless a test inspects
-- the returned CONTENT by field. The honesty proof is
-- supabase/tests/test_scenario_shares_rls.sql, which asserts sensitive fields
-- ABSENT (no api_key|allocated_amount|account_balance|value_usd), revoke
-- immediacy (0 rows after revoked_at = now()), and cross-tenant isolation — not
-- a 200 / row-count.
--
-- TOKEN MODEL — hash-in-Node, NOT hash-in-SQL. The repo enables no `pgcrypto
-- digest` extension anywhere (only gen_random_uuid(), pg13+ core), so the RPC
-- takes p_token_hash TEXT (a precomputed sha256 hex). src/lib/scenario-share-
-- token.ts (Plan 25-02) is the single digest source-of-truth; the route/page
-- hash the raw token before calling. This avoids an unverified pgcrypto landmine
-- and keeps ONE digest site. The raw token lives only in the URL.
--
-- Design notes (mirror the Phase 23 scenarios spine):
--   - NO set_updated_at() trigger function — a tracked function would trip the
--     dump-sql-functions.ts --check snapshot gate. created_at + revoked_at
--     suffice; revoke touches revoked_at via the route payload, never a trigger.
--   - "At most one active share per scenario" is a STRUCTURAL guarantee: a
--     partial unique index UNIQUE (scenario_id) WHERE revoked_at IS NULL. The
--     generate route also pre-revokes any active share; the index is the
--     backstop so a race cannot leave two active shares.
--   - Owner RLS mirrors scenarios_owner, keyed on created_by = auth.uid().
--     REVOKE ALL FROM anon — anon's ONLY path is the SECURITY DEFINER RPC.
--   - Read RPC search_path = public, pg_temp (read-path canon, mig 87 H-B /
--     mig 117 claim RPCs), NOT pg_catalog.
--   - Defense-in-depth: REVOKE ALL on the RPC FROM PUBLIC, anon; GRANT EXECUTE
--     to service_role ONLY (the page calls via createAdminClient = service_role
--     transport; anon must NEVER invoke it directly). Self-verify via the
--     existing public._assert_no_public_execute (mig 134) — CALL it, do not
--     redefine. A body-shape DO-block additionally asserts the function filters
--     revoked_at IS NULL + status='published' and does NOT reference api_keys /
--     portfolio_strategies / portfolios.
--
-- DO NOT push to prod from this plan. The migration applies at /ship-time to the
-- TEST project (the sql-tests CI prerequisite) and to PROD at /land via the
-- Supabase Migrate workflow on push-to-main (anon NO-EXEC verified). No
-- `supabase db push` here. Rollback: down/20260622120000-rollback.sql.
-- ============================================================================

BEGIN;
SET lock_timeout = '3s';

-- --------------------------------------------------------------------------
-- STEP 1: scenario_shares table + owner RLS + REVOKE anon + partial unique idx
-- --------------------------------------------------------------------------
CREATE TABLE scenario_shares (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id UUID NOT NULL REFERENCES scenarios ON DELETE CASCADE,
  created_by  UUID NOT NULL REFERENCES profiles  ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at  TIMESTAMPTZ
);

ALTER TABLE scenario_shares ENABLE ROW LEVEL SECURITY;

-- Owner-only access. Mirrors scenarios_owner (swap allocator_id -> created_by):
-- the authenticated allocator reads + writes only their own share rows; the
-- WITH CHECK blocks writing a row owned by another allocator (defence-in-depth
-- on top of the route always sourcing created_by from auth, never the body).
-- `TO authenticated` pins the policy to the role the request-scoped client
-- connects as; combined with the REVOKE below, anon is blocked at both layers.
CREATE POLICY scenario_shares_owner ON scenario_shares
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Defense-in-depth: a fresh table inherits Supabase's default GRANT ALL TO
-- anon. There is no public-read use case for the share table — the ONLY public
-- path is the get_shared_scenario SECURITY DEFINER RPC. Drop anon's grants
-- entirely so anon is blocked at BOTH the grant layer (42501) and RLS.
REVOKE ALL ON scenario_shares FROM anon;

-- "At most one active share per scenario" — structural guarantee. A partial
-- unique index over (scenario_id) WHERE revoked_at IS NULL means a second
-- active share for the same scenario raises 23505; revoked rows are excluded so
-- re-sharing (revoke old + mint new) is always permitted.
CREATE UNIQUE INDEX scenario_shares_one_active_idx
  ON scenario_shares (scenario_id)
  WHERE revoked_at IS NULL;

-- Lookup index for the (less common) owner-side listing by scenario.
CREATE INDEX scenario_shares_scenario_idx
  ON scenario_shares (scenario_id);

-- --------------------------------------------------------------------------
-- STEP 2: get_shared_scenario(p_token_hash) — the leak-scoped read RPC
-- --------------------------------------------------------------------------
-- Returns ONLY name/draft/schema_version + the addedStrategies[].id-scoped
-- PUBLISHED strategy series. EXPLICIT 4-column list (never SELECT *). Never
-- joins api_keys / portfolios / portfolio_strategies; never resolves holdings
-- refs ("holding:..."). The UUID-shape filter drops holdings refs and poison.
CREATE FUNCTION public.get_shared_scenario(p_token_hash TEXT)
RETURNS TABLE (
  name           TEXT,
  draft          JSONB,
  schema_version INT,
  series         JSONB           -- [{ "strategy_id": uuid, "daily_returns": [...] }]
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp     -- read-path canon (mig 87 H-B), NOT pg_catalog
AS $$
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
  SELECT s.* INTO v_scenario
    FROM scenario_shares sh
    JOIN scenarios s ON s.id = sh.scenario_id
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
$$;

COMMENT ON FUNCTION public.get_shared_scenario(TEXT) IS
  'Phase 25 / SHARE-02. The SOLE anon/cross-tenant read path for a shared '
  'scenario. SECURITY DEFINER (bypasses RLS) so it self-scopes: gates on '
  'token_hash + revoked_at IS NULL, returns ONLY name/draft/schema_version + '
  'the draft addedStrategies[].id PUBLISHED strategy_analytics series. NEVER '
  'reads holdings/AUM/api_keys/portfolios. Token is hashed in Node (Plan 25-02); '
  'this takes the precomputed sha256 hex. GRANTed to service_role only.';

-- --------------------------------------------------------------------------
-- STEP 3: strip PUBLIC/anon grants, grant service_role only, self-verify
-- --------------------------------------------------------------------------
-- The page invokes via createAdminClient (service_role transport). REVOKE
-- PUBLIC/anon (so anon can never invoke directly), GRANT service_role only.
REVOKE ALL ON FUNCTION public.get_shared_scenario(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_shared_scenario(TEXT) TO service_role;

-- Self-verify with the mig-134 canon (CALL it; do NOT redefine the helper).
-- Aborts the apply if PUBLIC retained EXECUTE — a leak we cannot revoke is a
-- real CRITICAL and the apply MUST fail.
DO $$
BEGIN
  PERFORM public._assert_no_public_execute('public.get_shared_scenario(text)');
  RAISE NOTICE 'Migration 25-01: PUBLIC EXECUTE absence verified for get_shared_scenario.';
END $$;

-- --------------------------------------------------------------------------
-- STEP 4: body-shape self-assert (defense-in-depth; mirrors mig 117 STEP 7)
-- --------------------------------------------------------------------------
-- Reads pg_get_functiondef and asserts the body (i) filters revoked_at IS NULL,
-- (ii) filters status = 'published', and (iii) does NOT reference api_keys /
-- portfolio_strategies / portfolios. A future CREATE OR REPLACE that loosens the
-- scope (drops the revoke gate, or joins a forbidden tenant table) fails the
-- apply here — closing the silent-fail leak before it ships (RESEARCH Pitfall 1).
DO $$
DECLARE
  v_body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_body
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'get_shared_scenario'
     AND pg_get_function_identity_arguments(p.oid) = 'p_token_hash text';

  IF v_body IS NULL THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario(text) not found post-create';
  END IF;

  -- (i) revoke gate present
  IF v_body !~* 'revoked_at\s+IS\s+NULL' THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario body lost the revoked_at IS NULL gate — revoke would not be immediate';
  END IF;

  -- (ii) published-only filter present
  IF v_body !~* 'status\s*=\s*''published''' THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario body lost the status = ''published'' filter — could resolve unpublished series';
  END IF;

  -- (iii) forbidden live-book tables absent
  IF v_body ~* '\mapi_keys\M' THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario body references api_keys — OVER-RETURN LEAK';
  END IF;
  IF v_body ~* '\mportfolio_strategies\M' THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario body references portfolio_strategies — OVER-RETURN LEAK';
  END IF;
  IF v_body ~* '\mportfolios\M' THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario body references portfolios — OVER-RETURN LEAK';
  END IF;

  -- search-path hardening present (read-path canon, not pg_catalog).
  -- pg_get_functiondef emits `SET search_path TO public, pg_temp`; accept TO or =.
  IF v_body !~* 'search_path\s*(=|TO)\s*''?public''?,\s*''?pg_temp''?' THEN
    RAISE EXCEPTION 'Migration 25-01 verification failed: get_shared_scenario missing SET search_path = public, pg_temp';
  END IF;

  RAISE NOTICE 'Migration 25-01: get_shared_scenario body-shape verified (revoke gate + published filter + no live-book tables + search_path).';
END $$;

COMMIT;
