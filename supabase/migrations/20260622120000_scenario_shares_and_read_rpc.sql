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
--
-- CR-01 OWNER-COHERENCE (the leak-chain fix): `created_by = auth.uid()` alone
-- is NOT enough — it lets an authenticated allocator mint a share for ANY
-- scenario_id (incl. another tenant's), because the FK only checks the scenario
-- EXISTS, not that the caller owns it. The EXISTS clause binds the share to a
-- scenario the CALLER owns (scenarios.allocator_id = auth.uid()), so the DB
-- itself rejects a cross-tenant share at WITH CHECK time. This is layer 2 of 3
-- (route ownership probe + this RLS clause + the RPC owner-coherence predicate);
-- since the read RPC is SECURITY DEFINER (RLS does not protect its body), the
-- table policy and the route are the only places this can be enforced at write
-- time, and the RPC predicate is the read-time backstop for any mis-created row.
CREATE POLICY scenario_shares_owner ON scenario_shares
  FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.scenarios s
      WHERE s.id = scenario_shares.scenario_id
        AND s.allocator_id = auth.uid()
    )
  );

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
$$;

COMMENT ON FUNCTION public.get_shared_scenario(TEXT) IS
  'Phase 25 / SHARE-02. The SOLE anon/cross-tenant read path for a shared '
  'scenario. SECURITY DEFINER (bypasses RLS) so it self-scopes: gates on '
  'token_hash + revoked_at IS NULL, returns ONLY name/draft/schema_version + '
  'the draft addedStrategies[].id PUBLISHED strategy_analytics series. NEVER '
  'reads holdings/AUM/api_keys/portfolios. Token is hashed in Node (Plan 25-02); '
  'this takes the precomputed sha256 hex. GRANTed to service_role only.';

-- --------------------------------------------------------------------------
-- STEP 2b: create_scenario_share(p_scenario_id, p_token_hash) — ATOMIC mint
-- --------------------------------------------------------------------------
-- WR-02 ATOMICITY: the generate route previously did a pre-revoke UPDATE and a
-- separate INSERT as two non-atomic statements. If the pre-revoke succeeded but
-- the INSERT failed (transient 5xx, a 23505 race against the partial unique
-- index), the scenario was left with NO active share even though one existed a
-- moment earlier — the prior link was dead with no replacement. This function
-- folds revoke-then-insert into ONE transaction: a PL/pgSQL function runs in a
-- single (sub)transaction, so any error inside it rolls back BOTH writes. The
-- "one active share per scenario" invariant is therefore never violated by a
-- partial write — either the new share replaces the old atomically, or nothing
-- changes.
--
-- SECURITY INVOKER (the default; stated explicitly): unlike get_shared_scenario
-- (the anon read path, DEFINER), this runs AS THE CALLER so RLS still gates it.
-- The scenario_shares_owner policy enforces created_by = auth.uid() AND the
-- CR-01 owner-coherence EXISTS clause, so a caller cannot mint a share for a
-- scenario they do not own through this RPC either — the WITH CHECK rejects the
-- INSERT (raising, which rolls the function back). created_by is sourced from
-- auth.uid() INSIDE the function, never a parameter, so a forged created_by is
-- impossible.
--
-- search_path = public, pg_temp matches the read-path canon. STABLE is wrong
-- here (this writes) — VOLATILE (the default) is correct and omitted.
CREATE FUNCTION public.create_scenario_share(
  p_scenario_id UUID,
  p_token_hash  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
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

COMMENT ON FUNCTION public.create_scenario_share(UUID, TEXT) IS
  'Phase 25 / SHARE-01 (WR-02). ATOMIC revoke-prior + insert-new share for a '
  'scenario in ONE transaction so a failed insert never leaves the scenario '
  'with zero active shares. SECURITY INVOKER — RLS gates it as the caller; '
  'created_by is auth.uid() inside the body (never a parameter). Returns the '
  'new share row id. The route hashes the token in Node (Plan 25-02) and passes '
  'the precomputed sha256 hex.';

-- create_scenario_share runs SECURITY INVOKER (RLS-gated as the caller) and is
-- invoked by the authenticated owner route. anon must never reach it (the
-- generate route is allocator-auth gated); REVOKE from anon + PUBLIC as
-- defense-in-depth and GRANT EXECUTE to authenticated.
REVOKE ALL ON FUNCTION public.create_scenario_share(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_scenario_share(UUID, TEXT) TO authenticated;

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
