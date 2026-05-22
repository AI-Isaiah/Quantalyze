-- ==========================================================================
-- Phase 19.1 / Task 1 — CSV daily-returns persistence.
--
-- Source-of-record for the `csv_daily_returns` table + the
-- `persist_csv_daily_returns(p_user_id, p_strategy_id, p_rows)` definer-rights
-- RPC that the Next.js `csv-finalize` route handler calls after a wizard upload.
--
-- Pre-hardened per PR #272:
--   * Collapsed 42501 probe-oracle close — missing-strategy and wrong-owner
--     are indistinguishable to authenticated callers, so they cannot enumerate
--     which strategy UUIDs exist by reading the error code distinction.
--   * Array-typeof guard returns 22023 BEFORE any jsonb_array_length() call
--     (otherwise the length call raises a generic 22023 with an opaque
--     message that does not tell the route handler what the caller did wrong).
--   * GRANT TO authenticated with inline justification comment — narrowing to
--     service_role would NULL `auth.uid()` and trigger 42501 on every
--     legitimate call. The probe-oracle is closed by the 42501 collapse, not
--     by the GRANT shape.
--
-- Pattern: migration 093 (strategy_verifications) — same 7-step structure.
-- ==========================================================================

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: csv_daily_returns table
--
-- (strategy_id, date) is the natural composite PRIMARY KEY. Its implicit
-- B-tree serves BOTH the worker SELECT (ORDER BY date) AND the ON CONFLICT
-- upsert in persist_csv_daily_returns. No redundant explicit index — the
-- migration-reviewer flagged + dropped the previous secondary index in
-- PR #272 (re-adding would double write I/O for zero planner benefit).
-- ==========================================================================
CREATE TABLE IF NOT EXISTS public.csv_daily_returns (
  strategy_id  UUID             NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  date         DATE             NOT NULL,
  daily_return DOUBLE PRECISION NOT NULL,
  created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
  CONSTRAINT csv_daily_returns_pkey PRIMARY KEY (strategy_id, date)
);

COMMENT ON TABLE public.csv_daily_returns IS
  'Persisted daily-return series for CSV-uploaded strategies. Decimal fraction
   returns (e.g. 0.0055 for +0.55%). Populated by persist_csv_daily_returns
   definer-rights RPC at csv-finalize time. Worker handler
   compute_analytics_from_csv reads this table to feed compute_all_metrics().
   PRIMARY KEY (strategy_id, date) — implicit B-tree serves both worker SELECT
   and ON CONFLICT upsert; no redundant explicit index per PR #272.';

-- ==========================================================================
-- STEP 2: Row-Level Security (3-tier, owner-only)
-- ==========================================================================
ALTER TABLE public.csv_daily_returns ENABLE ROW LEVEL SECURITY;

-- Service role: full access. Definer-rights RPC also bypasses RLS, but the
-- explicit policy documents intent (pattern from migration 093).
DROP POLICY IF EXISTS csv_daily_returns_service_role_all ON public.csv_daily_returns;
CREATE POLICY csv_daily_returns_service_role_all ON public.csv_daily_returns
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Owner SELECT: an authenticated user can read daily returns for strategies
-- they own.
DROP POLICY IF EXISTS csv_daily_returns_owner_select ON public.csv_daily_returns;
CREATE POLICY csv_daily_returns_owner_select ON public.csv_daily_returns
  FOR SELECT
  TO authenticated
  USING (
    strategy_id IN (SELECT id FROM public.strategies WHERE user_id = auth.uid())
  );

-- Admin SELECT: admin users can read all rows. profiles.id is the auth.uid()
-- (FK to auth.users) — the codebase convention is `id = auth.uid()`, not
-- `user_id = auth.uid()` (verified across 8 prior migrations; profiles has no
-- user_id column — it predates the standard `user_id` foreign-key pattern).
DROP POLICY IF EXISTS csv_daily_returns_admin_select ON public.csv_daily_returns;
CREATE POLICY csv_daily_returns_admin_select ON public.csv_daily_returns
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id = auth.uid() AND p.is_admin = true
    )
  );

-- NOTE: No INSERT/UPDATE/DELETE policy for authenticated — the
-- persist_csv_daily_returns RPC (STEP 3) writes rows via definer-rights,
-- which bypasses RLS while enforcing auth.uid() = p_user_id + strategy
-- ownership manually.

-- ==========================================================================
-- STEP 3: persist_csv_daily_returns definer-rights RPC
--
-- Called from the Next.js csv-finalize route after applyCsvMetadataUpdate.
-- p_rows is a JSONB array of {date: 'YYYY-MM-DD', daily_return: number}.
-- Returns the count of rows upserted.
--
-- ERRCODE map (canonical interface for downstream TS code):
--   22023 — p_rows not an array, or empty, or > 5000 rows
--   42501 — caller not authenticated, or p_user_id mismatch, or strategy not
--           accessible (probe-oracle closed: missing OR not-owned both → 42501)
--   23505 — UNIQUE (strategy_id, date) violation (guarded upstream by route
--           validator's duplicate-date check)
-- ==========================================================================
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

COMMENT ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) IS
  'Phase 19.1 / Task 1 — Bulk-upserts a daily-return series into
   csv_daily_returns. Asserts auth.uid() = p_user_id AND strategy.user_id =
   p_user_id before inserting (probe-oracle closed via collapsed 42501).
   Idempotent via ON CONFLICT DO UPDATE. Row limit 5000. Returns count of
   rows affected.';

-- ==========================================================================
-- STEP 4: REVOKE + GRANT
-- ==========================================================================
REVOKE ALL ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) FROM PUBLIC, anon;

-- GRANT to authenticated is intentional and matches the sibling
-- finalize_csv_strategy pattern (migration 093). The Next.js route handler
-- calls this RPC via a per-request Supabase client that runs as the
-- `authenticated` role (not service_role) so the inline auth.uid() guard at
-- the top of the function can verify caller identity. Narrowing to
-- service_role would make auth.uid() NULL and trigger the 42501 raise on
-- every legitimate call. The probe-oracle (enumerating arbitrary
-- strategy_ids) is closed by the collapsed "not accessible" branch above,
-- not by the GRANT shape.
GRANT EXECUTE ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_csv_daily_returns(UUID, UUID, JSONB) TO service_role;

-- ==========================================================================
-- STEP 5: Self-verifying DO block (migration 093 pattern)
--
-- Asserts the expected post-migration state. Any failure raises and rolls
-- back the whole transaction.
-- ==========================================================================
DO $$
DECLARE
  v_rls_enabled  BOOLEAN;
  v_policy_count INT;
  v_fn_secdef    BOOLEAN;
  v_grant_count  INT;
BEGIN
  -- (a) table exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'csv_daily_returns'
  ) THEN
    RAISE EXCEPTION 'Migration 19.1/01: csv_daily_returns table missing';
  END IF;

  -- (b) RLS enabled
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
   WHERE relname = 'csv_daily_returns'
     AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT COALESCE(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'Migration 19.1/01: csv_daily_returns RLS not enabled';
  END IF;

  -- (c) exactly three named policies present
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename  = 'csv_daily_returns'
     AND policyname IN (
       'csv_daily_returns_service_role_all',
       'csv_daily_returns_owner_select',
       'csv_daily_returns_admin_select'
     );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'Migration 19.1/01: expected 3 RLS policies, found %', v_policy_count;
  END IF;

  -- (d) persist_csv_daily_returns exists with definer rights (prosecdef=true)
  SELECT prosecdef INTO v_fn_secdef
    FROM pg_proc
   WHERE proname     = 'persist_csv_daily_returns'
     AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF v_fn_secdef IS NULL THEN
    RAISE EXCEPTION 'Migration 19.1/01: persist_csv_daily_returns RPC missing';
  END IF;
  IF NOT v_fn_secdef THEN
    RAISE EXCEPTION 'Migration 19.1/01: persist_csv_daily_returns prosecdef is false (must be definer-rights)';
  END IF;

  -- (e) GRANT TO authenticated present (PR #272 anti-regression — narrowing
  --     to service_role would NULL auth.uid() and break the function).
  SELECT count(*) INTO v_grant_count
    FROM information_schema.routine_privileges
   WHERE routine_schema = 'public'
     AND routine_name   = 'persist_csv_daily_returns'
     AND grantee        = 'authenticated'
     AND privilege_type = 'EXECUTE';
  IF v_grant_count < 1 THEN
    RAISE EXCEPTION 'Migration 19.1/01: GRANT EXECUTE TO authenticated missing on persist_csv_daily_returns';
  END IF;

  RAISE NOTICE 'Migration 19.1/01: all assertions passed (csv_daily_returns + persist_csv_daily_returns).';
END
$$;

COMMIT;
