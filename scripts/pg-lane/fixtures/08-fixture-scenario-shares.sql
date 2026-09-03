-- Additive stand-in columns the scenario-share gate's own seed INSERTs name on
-- relations that earlier fixtures create as stand-ins. The objects UNDER TEST —
-- scenario_shares, its RLS policies and the get_shared_scenario SECURITY DEFINER
-- reader — are the REAL ones from 20260622120000_scenario_shares_and_read_rpc.sql.
-- Never a second base: 01-fixture-core.sql stays the only destructive fixture.

-- strategy_analytics.daily_returns — the PUBLISHED series get_shared_scenario
-- returns per addedStrategies[].id. 03-fixture-compute-jobs.sql carries only the
-- columns the ledger-refresh staleness view reads.
ALTER TABLE strategy_analytics ADD COLUMN IF NOT EXISTS daily_returns JSONB;
