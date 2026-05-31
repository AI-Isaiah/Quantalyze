-- Migration: get_latest_portfolio_analytics_for_user RPC (B19 — Internal Query Bounding)
--
-- src/lib/queries.ts getAllocatorAggregates previously fetched portfolio_analytics
-- with an UNBOUNDED `.in_("portfolio_id", portfolioIds).order("computed_at", desc).limit(500)`
-- plus an app-side Map dedup to keep the latest row per portfolio. This RPC fixes
-- three problems of that shape by construction:
--   1. limit(500) could truncate (one data-heavy portfolio with many historical
--      analytics rows starving others) — DISTINCT ON returns exactly ONE (the
--      latest) row per portfolio, so the cap is gone and truncation is impossible;
--   2. the app-side latest-per-portfolio dedup was hand-rolled logic — now a single
--      DISTINCT ON in the DB;
--   3. scope was enforced only by the two-query shape — now enforced in SQL
--      (portfolios.user_id = p_user_id), so the frontend cannot widen it.
--
-- portfolio_analytics has NO user_id column (migration 20260407075303): ownership
-- is via the FK portfolio_id -> portfolios.id, portfolios.user_id. The DISTINCT ON
-- rides the existing idx_portfolio_analytics_latest (portfolio_id, computed_at DESC)
-- from that same migration.
--
-- SECURITY DEFINER + explicit auth.uid() gate (NOT current_user): auth.uid() is the
-- real JWT subject and is UNCHANGED under SECURITY DEFINER, so the current_user=owner
-- privesc trap behind the profiles is_admin self-grant (lock_profile_privileged_columns)
-- does NOT apply here. Mirrors get_allocator_latest_batch_meta (migration 20260409003234):
-- the caller must be the user OR an admin; otherwise an EMPTY set (not an error),
-- matching that exemplar's posture.
--
-- Read RPC drift note: RETURNS SETOF portfolio_analytics binds to the live column
-- list, so a future column add needs a CREATE OR REPLACE of this function to surface
-- it (acceptable for a read path).

CREATE OR REPLACE FUNCTION public.get_latest_portfolio_analytics_for_user(p_user_id UUID)
RETURNS SETOF portfolio_analytics
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
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

REVOKE ALL ON FUNCTION public.get_latest_portfolio_analytics_for_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_latest_portfolio_analytics_for_user(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_latest_portfolio_analytics_for_user(UUID) TO authenticated;

-- Belt-and-suspenders: fail the migration if PUBLIC somehow retained EXECUTE
-- (the SECURITY DEFINER public-execute guard from migration 20260515205431).
DO $$
BEGIN
  PERFORM public._assert_no_public_execute('public.get_latest_portfolio_analytics_for_user(uuid)');
END $$;

COMMENT ON FUNCTION public.get_latest_portfolio_analytics_for_user(UUID) IS
  'SECURITY DEFINER (B19): latest portfolio_analytics row per portfolio owned by p_user_id (DISTINCT ON portfolio_id, computed_at DESC). Enforces caller-is-user-OR-admin via auth.uid(); empty set otherwise. Replaces getAllocatorAggregates'' unbounded .in_ + limit(500) + app-dedup (src/lib/queries.ts). EXECUTE: authenticated only.';
