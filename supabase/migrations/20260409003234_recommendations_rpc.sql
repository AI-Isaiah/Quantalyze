-- Migration 019: recommendations SECURITY DEFINER RPCs
--
-- Replaces the admin-client-from-the-page pattern in
-- src/app/(dashboard)/recommendations/page.tsx with SECURITY DEFINER
-- functions that enforce the allocator scope in SQL, not TypeScript.
--
-- Why: the current page uses createAdminClient() to bypass RLS on
-- match_batches + match_candidates and then filters by allocator_id /
-- batch.id. That's safe today -- but a future PR introducing shared
-- batches or a debug param could leak another allocator's
-- recommendations. Moving the scope check into SQL means the front-end
-- can't accidentally bypass it.
--
-- Two functions ship in this migration:
--
--   1. get_allocator_latest_batch_meta(p_allocator_id) -- returns one
--      row (or zero rows) with the latest match_batch id + computed_at +
--      candidate_count. The page uses this to distinguish "no batch yet"
--      from "batch with no ranked candidates".
--
--   2. get_allocator_recommendations(p_allocator_id) -- returns up to 3
--      ranked candidates for the latest batch, joined with strategy,
--      analytics, and discovery category metadata.
--
-- Both functions enforce the same access gate: auth.uid() must match
-- p_allocator_id OR profiles.is_admin must be true for the caller.
-- Non-matching callers get an empty result set, not an error.
--
-- Access: EXECUTE granted to authenticated only. REVOKE FROM PUBLIC and
-- anon so unauthenticated callers get a permission denied.
--
-- Pattern: mirrors latest_cron_success() from migration 013.
--
-- Post-merge manual verification (repeat for both RPCs):
--
--   1. As authenticated user matching the allocator_id:
--        SELECT * FROM get_allocator_recommendations('<your-user-id>'::uuid);
--        SELECT * FROM get_allocator_latest_batch_meta('<your-user-id>'::uuid);
--      Expected: returns up to 3 rows / 1 row.
--
--   2. As a different authenticated user (not the allocator, not admin):
--        SELECT * FROM get_allocator_recommendations('<other-user-id>'::uuid);
--        SELECT * FROM get_allocator_latest_batch_meta('<other-user-id>'::uuid);
--      Expected: returns 0 rows (not an error).
--
--   3. As admin:
--        SELECT * FROM get_allocator_recommendations('<any-user-id>'::uuid);
--        SELECT * FROM get_allocator_latest_batch_meta('<any-user-id>'::uuid);
--      Expected: returns up to 3 rows / 1 row for any allocator.
--
--   4. Unauthenticated (anon):
--      The GRANT is to authenticated only, so anon cannot even call the
--      functions (permission denied from REVOKE FROM anon).

------------------------------------------------------------------
-- 1. get_allocator_latest_batch_meta
------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_allocator_latest_batch_meta(p_allocator_id UUID)
RETURNS TABLE (
  batch_id UUID,
  computed_at TIMESTAMPTZ,
  candidate_count INT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION get_allocator_latest_batch_meta(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_allocator_latest_batch_meta(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_allocator_latest_batch_meta(UUID) TO authenticated;

COMMENT ON FUNCTION get_allocator_latest_batch_meta(UUID) IS
  'SECURITY DEFINER: returns latest match_batch metadata (id, computed_at, candidate_count) for the given allocator. Enforces "caller is the allocator OR caller is admin". Companion to get_allocator_recommendations (migration 019).';

------------------------------------------------------------------
-- 2. get_allocator_recommendations
------------------------------------------------------------------

CREATE OR REPLACE FUNCTION get_allocator_recommendations(p_allocator_id UUID)
RETURNS TABLE (
  id UUID,
  strategy_id UUID,
  rank INT,
  score NUMERIC,
  reasons TEXT[],
  strategy_name TEXT,
  strategy_description TEXT,
  discovery_category_slug TEXT,
  cagr NUMERIC,
  sharpe NUMERIC,
  max_drawdown NUMERIC,
  analytics_computed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION get_allocator_recommendations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_allocator_recommendations(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION get_allocator_recommendations(UUID) TO authenticated;

COMMENT ON FUNCTION get_allocator_recommendations(UUID) IS
  'SECURITY DEFINER: returns the top 3 match candidates for the given allocator. Enforces "caller is the allocator OR caller is admin". Replaces the admin-client path in recommendations/page.tsx (migration 019).';
