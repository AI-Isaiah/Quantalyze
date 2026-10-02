-- Additive stand-in for `portfolio_strategies`, the ALLOCATION table the Phase
-- 150 capital-ownership triggers fire on. 20260405061911_initial_schema.sql
-- creates it in production; that migration is not in the apply list (it seeds
-- a dozen unrelated subsystems and would pull the whole chain in). The objects
-- UNDER TEST are the REAL triggers and the REAL flip RPC from
-- 20260806120000_strategies_capital_ownership.sql — never this table.
--
-- Column set is exactly what the migration bodies and the gate's own
-- INSERT/UPDATE statements name: the two FK columns, the composite PRIMARY KEY
-- arm 6 asserts, `allocated_amount` and the `alias` column the INSERT-scope arms
-- (5, 7i) update. Never a second base: 01-fixture-core.sql stays the only
-- destructive fixture.
CREATE TABLE IF NOT EXISTS portfolio_strategies (
  portfolio_id     UUID NOT NULL REFERENCES portfolios ON DELETE CASCADE,
  strategy_id      UUID NOT NULL REFERENCES strategies ON DELETE CASCADE,
  added_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  allocated_amount NUMERIC,
  alias            TEXT,
  PRIMARY KEY (portfolio_id, strategy_id)
);

-- Grants + the owner RLS policy, mirrored from the production definitions so an
-- arm cannot pass merely because the stand-in is unguarded:
--   * GRANTs — 20260405061911_initial_schema.sql / Supabase bootstrap;
--   * portfolio_strategies_owner — 20260405061912_rls_policies.sql:67, verbatim.
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolio_strategies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON portfolios TO authenticated;
ALTER TABLE portfolio_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE portfolios ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'portfolio_strategies'
                    AND policyname = 'portfolio_strategies_owner') THEN
    CREATE POLICY portfolio_strategies_owner ON portfolio_strategies FOR ALL USING (
      portfolio_id IN (SELECT id FROM portfolios WHERE user_id = auth.uid())
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'portfolios'
                    AND policyname = 'portfolios_owner') THEN
    CREATE POLICY portfolios_owner ON portfolios FOR ALL USING (user_id = auth.uid());
  END IF;
END
$$;

-- strategies write grants. 01-fixture-core.sql grants only SELECT (its own gate
-- never writes as `authenticated`); production grants the full DML set, and the
-- flip RPC + the raw-UPDATE arms (7f, 7g) exercise it as the caller.
GRANT INSERT, UPDATE, DELETE ON strategies TO authenticated;

-- The strategies write POLICIES, mirrored verbatim from production so the flip
-- RPC's UPDATE (SECURITY INVOKER, so RLS applies to the caller) can match a row:
--   * strategies_update — 20260410225610_sec005_follow_ups.sql:103-106 (the live
--     definition; it replaced 20260405061912's);
--   * strategies_insert / strategies_delete — 20260405061912_rls_policies.sql:31,33.
-- 01-fixture-core.sql enables RLS on strategies but declares only strategies_read,
-- because its own gate never writes as `authenticated`. Without these, arm 7a
-- reads `flip returned (removed=1, updated=0)` — an RLS artefact of the STAND-IN,
-- not a property of the RPC.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'strategies' AND policyname = 'strategies_update') THEN
    CREATE POLICY strategies_update ON strategies
      FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'strategies' AND policyname = 'strategies_insert') THEN
    CREATE POLICY strategies_insert ON strategies FOR INSERT WITH CHECK (user_id = auth.uid());
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
                   AND tablename = 'strategies' AND policyname = 'strategies_delete') THEN
    CREATE POLICY strategies_delete ON strategies FOR DELETE USING (user_id = auth.uid());
  END IF;
END
$$;
