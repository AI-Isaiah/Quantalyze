-- Migration 20260626120000: get_verified_cohort_rank SECURITY DEFINER RPC +
-- REVOKE/GRANT + self-verifying DO block.
-- Phase 42 / PEER-03 (milestone v1.2.2) — the security backbone for the
-- Scenario composer's hypothetical-blend Peer-Percentile panel.
--
-- Why this migration exists
-- -------------------------
-- ADR-0025 surfaces a Peer-Percentile on the Scenario composer's hypothetical
-- blend, ranked against the platform's REAL verified-strategy universe (not the
-- seed=42 demo cohort). That cohort cannot be read from a normal authed client:
--   * strategy_verifications RLS (migration 093 / 20260501055202) grants an
--     allocator SELECT only on THEIR OWN strategies' verification rows
--     (strategy_verifications_owner_select: strategy_id IN (SELECT id FROM
--     strategies WHERE user_id = auth.uid())). A cross-tenant verified aggregate
--     is therefore impossible under the tenant boundary.
--   * strategy_analytics RLS (analytics_read, migration 20260405061912) is also
--     owner/published-scoped.
-- The only safe construction is a privileged SECURITY DEFINER function that
-- returns ONLY an aggregated rank + cohort count — never any per-strategy id,
-- name, returns, or PII — suppressed below a min-N cell-size floor.
--
-- What this RPC returns (T-42-01 / T-42-02 mitigations)
-- -----------------------------------------------------
-- get_verified_cohort_rank(p_sharpe, p_sortino, p_max_dd) RETURNS TABLE
--   (cohort_n INT, sharpe_pct INT, sortino_pct INT, max_dd_pct INT)
-- — exactly four aggregate scalars. The body SELECTs ONLY count(*) /
-- count(*) FILTER aggregates; it NEVER selects or returns any strategy id /
-- name / daily_returns / metric value. The RETURNS TABLE is provably PII-free.
--
-- Cohort definition (D-02 locked)
-- -------------------------------
-- Verified AND published strategies:
--   FROM strategies s JOIN strategy_analytics a ON a.strategy_id = s.id
--   WHERE s.status = 'published'                       -- defense-in-depth
--     AND EXISTS (SELECT 1 FROM strategy_verifications v
--                 WHERE v.strategy_id = s.id AND v.trust_tier IS NOT NULL)
-- The explicit s.status = 'published' predicate is defense-in-depth: it
-- excludes the caller's own drafts/pending_review rows (the DEFINER fn runs as
-- owner and bypasses RLS, so without this the caller's unpublished strategies
-- could pollute the cohort). "Verified" = any strategy_verifications.trust_tier
-- present (any tier — api_verified / csv_uploaded / self_reported).
--
-- Min-N floor (T-42-02 — cell-size inference)
-- -------------------------------------------
-- v_min_n = 20. Below it the RPC returns a single row carrying the honest
-- cohort_n with the three percentiles NULL. With a thin cohort a percentile
-- would pin a near-individual rank (e.g. with n=3, "you beat exactly 2 of 3"
-- near-identifies a strategy). The floor means no single strategy's metric is
-- recoverable from the returned rank.
--
-- Ranking convention
-- ------------------
-- strategy_analytics.sharpe / sortino are higher=better → percentile = % of
-- cohort whose stored value is <= the blend's. max_drawdown is stored NEGATIVE
-- (quantstats convention: -0.30 = 30% drop; queries.ts getPercentiles takes
-- Math.abs at :162-168). "shallower drawdown = better"; the caller passes
-- p_max_dd as the MAGNITUDE (abs) of the blend's max_dd, and the RPC counts
-- cohort strategies whose magnitude abs(a.max_drawdown) >= p_max_dd (i.e. that
-- drew down at least as deep) — a higher percentile means the blend is
-- shallower than more of the cohort. This matches getPercentiles' Math.abs +
-- LOWER_IS_BETTER inversion direction.
--
-- Hardening (T-42-03 — elevation of privilege)
-- --------------------------------------------
-- SECURITY DEFINER + SET search_path = public, pg_catalog (no search-path
-- hijack) + REVOKE ALL FROM PUBLIC, anon + GRANT EXECUTE TO authenticated,
-- service_role + an in-function auth.role()='anon' / auth.uid() IS NULL guard
-- raising SQLSTATE 42501. The route layer (plan 02: withAuth + assertProfile
-- Approved + checkLimit + NO_STORE) is the primary gate; the in-fn guard is
-- defense-in-depth so the DEFINER fn can't be abused by anon.
--
-- Application path
-- ----------------
-- Authored here; applied to the linked Supabase TEST project
-- (qmnijlgmdhviwzwfyzlc) via the Supabase MCP apply_migration tool. The
-- self-verifying DO block at the tail RAISEs EXCEPTION on any invariant
-- failure — if apply returns non-zero, read the error and fix the migration.
-- Production deployment is a separate gate handled at /ship time
-- (Supabase Migrate auto-applies on merge to main).

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: get_verified_cohort_rank SECURITY DEFINER RPC
-- ==========================================================================
-- Pattern mirrors finalize_csv_strategy (migration 093 STEP 5): SECURITY
-- DEFINER, SET search_path, manual auth guard, RAISE EXCEPTION with ERRCODE.
CREATE OR REPLACE FUNCTION public.get_verified_cohort_rank(
  p_sharpe   DOUBLE PRECISION,
  p_sortino  DOUBLE PRECISION,
  p_max_dd   DOUBLE PRECISION   -- the MAGNITUDE (abs) of the blend's max_dd
)
RETURNS TABLE (
  cohort_n     INT,
  sharpe_pct   INT,
  sortino_pct  INT,
  max_dd_pct   INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
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

  -- Cohort size = verified AND published strategies. The explicit
  -- status='published' predicate is defense-in-depth (D-02): the DEFINER fn
  -- bypasses RLS, so without it the caller's own drafts/pending_review rows
  -- could pollute the cohort. "Verified" = any trust_tier present.
  SELECT count(*) INTO v_n
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND EXISTS (
      SELECT 1 FROM strategy_verifications v
      WHERE v.strategy_id = s.id AND v.trust_tier IS NOT NULL
    );

  -- Min-N gate (T-42-02): below the floor, return a single honest-empty row
  -- carrying the real cohort_n but NULL percentiles. Never rank against a
  -- thin/illustrative set — prevents cell-size inference.
  IF v_n < v_min_n THEN
    RETURN QUERY SELECT v_n, NULL::INT, NULL::INT, NULL::INT;
    RETURN;
  END IF;

  -- Rank = % of cohort whose value is <= the blend's, for sharpe/sortino
  -- (higher=better). For max_dd use magnitude inversion: count cohort
  -- strategies that drew down at least as deep (abs(a.max_drawdown) >=
  -- p_max_dd) so a SHALLOWER blend earns a HIGHER percentile — matching
  -- getPercentiles' Math.abs + LOWER_IS_BETTER direction (queries.ts:162-181).
  --
  -- IDENTITY STRIP (T-42-01): every projected expression below is an
  -- aggregate (v_n is the count from above; the three columns are
  -- count(*) FILTER ratios). No strategy id / name / returns / metric value
  -- ever appears in the SELECT list or the RETURNS TABLE.
  RETURN QUERY
  SELECT
    v_n,
    round(100.0 * count(*) FILTER (WHERE a.sharpe  <= p_sharpe)  / v_n)::INT,
    round(100.0 * count(*) FILTER (WHERE a.sortino <= p_sortino) / v_n)::INT,
    round(100.0 * count(*) FILTER (WHERE abs(a.max_drawdown) >= p_max_dd) / v_n)::INT
  FROM strategies s
  JOIN strategy_analytics a ON a.strategy_id = s.id
  WHERE s.status = 'published'
    AND EXISTS (
      SELECT 1 FROM strategy_verifications v
      WHERE v.strategy_id = s.id AND v.trust_tier IS NOT NULL
    );
END;
$$;

-- ==========================================================================
-- STEP 2: REVOKE / GRANT EXECUTE (mirror migration 093 STEP 6)
-- ==========================================================================
-- PUBLIC and anon get nothing; authenticated callers (the Next.js route under
-- withAuth, plan 02) get EXECUTE; service_role also gets EXECUTE so worker /
-- integration tooling can call it on behalf of a user.
REVOKE ALL ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_verified_cohort_rank(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO service_role;

COMMENT ON FUNCTION public.get_verified_cohort_rank IS
  'Phase 42 / PEER-03 (v1.2.2): aggregate-only rank of a hypothetical blend''s Sharpe/Sortino/max_dd against the REAL verified+published strategy universe (strategy_verifications.trust_tier present AND strategies.status=''published''). Returns ONLY (cohort_n, sharpe_pct, sortino_pct, max_dd_pct) — never any per-strategy id/name/returns/PII. Suppressed below min-N=20 (returns the cohort_n with NULL percentiles) to prevent cell-size inference. SECURITY DEFINER because strategy_verifications RLS (migration 093) forbids the cross-tenant verified read from an authed client. p_max_dd is the MAGNITUDE (abs) of the blend''s max_dd; max_drawdown is stored negative.';

-- ==========================================================================
-- STEP 3: Self-verifying DO block (mirror migration 093 STEP 7)
-- ==========================================================================
-- Each RAISE EXCEPTION names the migration so apply-time failures are
-- unambiguous. The migration is wrapped in BEGIN ... COMMIT; if any assertion
-- fires the whole transaction rolls back — no partial migration state.
DO $$
DECLARE
  v_fn_oid     OID;
  v_secdef     BOOLEAN;
  v_pub_exec   BOOLEAN;
  v_anon_exec  BOOLEAN;
  v_auth_exec  BOOLEAN;
BEGIN
  -- (a) the function is registered under public with the 3-arg signature
  SELECT p.oid INTO v_fn_oid
    FROM pg_proc p
    WHERE p.proname = 'get_verified_cohort_rank'
      AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND pg_get_function_identity_arguments(p.oid) =
          'p_sharpe double precision, p_sortino double precision, p_max_dd double precision';
  IF v_fn_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20260626120000 failed: get_verified_cohort_rank(double precision, double precision, double precision) not registered';
  END IF;

  -- (b) it is SECURITY DEFINER (pg_proc.prosecdef = true)
  SELECT prosecdef INTO v_secdef FROM pg_proc WHERE oid = v_fn_oid;
  IF NOT COALESCE(v_secdef, false) THEN
    RAISE EXCEPTION 'Migration 20260626120000 failed: get_verified_cohort_rank is not SECURITY DEFINER';
  END IF;

  -- (c) EXECUTE is NOT granted to PUBLIC and NOT to anon
  v_pub_exec  := has_function_privilege('public', v_fn_oid, 'EXECUTE');
  v_anon_exec := has_function_privilege('anon',   v_fn_oid, 'EXECUTE');
  IF v_pub_exec THEN
    RAISE EXCEPTION 'Migration 20260626120000 failed: EXECUTE still granted to PUBLIC';
  END IF;
  IF v_anon_exec THEN
    RAISE EXCEPTION 'Migration 20260626120000 failed: EXECUTE still granted to anon';
  END IF;

  -- (d) EXECUTE IS granted to authenticated (the route caller)
  v_auth_exec := has_function_privilege('authenticated', v_fn_oid, 'EXECUTE');
  IF NOT v_auth_exec THEN
    RAISE EXCEPTION 'Migration 20260626120000 failed: EXECUTE not granted to authenticated';
  END IF;

  RAISE NOTICE 'Migration 20260626120000: all assertions passed (get_verified_cohort_rank registered, SECURITY DEFINER, EXECUTE revoked from PUBLIC/anon, granted to authenticated).';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 20260626120000
-- ==========================================================================
-- Summary (one-line per step):
--   Step 1 — get_verified_cohort_rank SECURITY DEFINER RPC (aggregate-only
--            rank vs verified+published cohort; min-N=20 floor; identity-strip)
--   Step 2 — REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated,
--            service_role; COMMENT ON FUNCTION
--   Step 3 — self-verifying DO block: fn registered, SECURITY DEFINER,
--            EXECUTE revoked from PUBLIC/anon, granted to authenticated
--
-- Downstream consumers
-- --------------------
-- - Plan 42-02: POST /api/scenario/peer-rank route — calls this RPC via
--   supabase.rpc('get_verified_cohort_rank', { p_sharpe, p_sortino, p_max_dd })
--   under withAuth + assertProfileApproved + checkLimit + NO_STORE_HEADERS, and
--   returns ONLY the 4 scalar columns (the cohort distribution never leaves SQL).
-- - src/__tests__/verified-cohort-rank-rls.test.ts: HAS_LIVE_DB integration
--   test pinning the no-identity-leak / min-N / owner-scope / anon-reject
--   boundaries.
