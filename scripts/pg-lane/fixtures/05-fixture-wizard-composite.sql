-- Additive stand-ins for the columns the wizard-composite gate family names on
-- relations that 01-fixture-core.sql / 02-fixture-sanitize-tables.sql create as
-- stand-ins, and that no migration in those gates' apply lists adds. Column sets
-- are only what the gate bodies actually reference — nothing else. Never a
-- second base: 01-fixture-core.sql remains the only destructive fixture.

-- strategies.source — 20260411103316_wizard_source_column.sql adds it in
-- production. That migration is NOT in the apply list: nothing under test here
-- is defined by it, and it self-verifies a large slice of the Phase-031 schema.
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS source TEXT;

-- strategy_analytics columns the wizard-composite gate's own seed INSERT names
-- (03-fixture-compute-jobs.sql carries only the ones the ledger-refresh view
-- reads). The table itself is a stand-in there; these are two more of its
-- columns, not an object under test.
ALTER TABLE strategy_analytics
  ADD COLUMN IF NOT EXISTS data_quality_flags JSONB,
  ADD COLUMN IF NOT EXISTS computation_error  TEXT;
