-- Migration 024: user_favorites table.
--
-- The allocator's watchlist of strategies they are considering but have
-- not put real capital into. Drives the Favorites panel in My Allocation
-- that lets allocators toggle strategies on/off to run a historical
-- backfill on their real portfolio curve ("what would my book have done
-- if this had been in it from the start?"). Saved toggle combinations
-- land in Test Portfolios via the Save-as-Test flow.
--
-- Schema is intentionally thin: composite PK on (user_id, strategy_id),
-- created_at for ordering, optional notes for the allocator's own memo.
-- Per-favorite priority, tags, or groupings are deferred until the v1
-- watchlist pattern proves out.
--
-- Referential integrity:
--   - user_id references auth.users(id) ON DELETE CASCADE (same pattern
--     as portfolios, strategies, etc.) so deleting an account cleans up
--     every favorite it owned.
--   - strategy_id references public.strategies(id) ON DELETE CASCADE so
--     deleting an unpublished / archived strategy doesn't leave orphaned
--     favorite rows pointing at a ghost.
--
-- RLS: allocators only ever touch their own favorites. Four policies
-- (SELECT / INSERT / UPDATE / DELETE) all keyed on auth.uid() = user_id.

-- Idempotent: every CREATE uses IF NOT EXISTS and CREATE POLICY is
-- wrapped in a DO block that catches duplicate_object. Matches the
-- convention in prior migrations.
CREATE TABLE IF NOT EXISTS public.user_favorites (
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  strategy_id UUID NOT NULL REFERENCES public.strategies(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes       TEXT,
  PRIMARY KEY (user_id, strategy_id)
);

COMMENT ON TABLE public.user_favorites IS
  'Allocator watchlist of strategies they are considering but have not allocated to. Table persists for future watchlist/discovery features; no UI ships against it in v0.4.0 after the Scenarios-replaces-Test-Portfolios pivot.';

ALTER TABLE public.user_favorites ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "users see own favorites"
    ON public.user_favorites FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "users insert own favorites"
    ON public.user_favorites FOR INSERT
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "users update own favorites"
    ON public.user_favorites FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "users delete own favorites"
    ON public.user_favorites FOR DELETE
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS user_favorites_user_id_created_at
  ON public.user_favorites (user_id, created_at DESC);

-- Self-verifying assertion: RLS enabled + all four policies present.
DO $$
DECLARE
  rls_enabled boolean;
  policy_count integer;
BEGIN
  SELECT relrowsecurity
    INTO rls_enabled
    FROM pg_class
   WHERE relname = 'user_favorites'
     AND relnamespace = 'public'::regnamespace;

  IF rls_enabled IS NULL OR NOT rls_enabled THEN
    RAISE EXCEPTION 'Migration 024 failed: RLS not enabled on public.user_favorites';
  END IF;

  SELECT COUNT(*)
    INTO policy_count
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename = 'user_favorites';

  IF policy_count < 4 THEN
    RAISE EXCEPTION
      'Migration 024 failed: expected 4 RLS policies on public.user_favorites, got %',
      policy_count;
  END IF;
END $$;
