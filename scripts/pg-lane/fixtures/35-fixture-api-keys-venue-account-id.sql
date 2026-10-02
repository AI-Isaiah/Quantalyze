-- Stand-in for `api_keys.venue_account_id`, which this lane needs to gate
-- migration 20260920120000 (GRANT SELECT (venue_account_id) ON api_keys TO
-- authenticated). Apply AFTER 03-fixture-compute-jobs.sql, which gives
-- `api_keys` its primary key.
--
-- WHY THIS AND NOT MORE. The real migration that creates this column,
-- 20260812083206 (Phase 154/WIZCONT-02), is far too large and
-- RPC/trigger-heavy to replay in a throwaway lane for THIS gate — it adds a
-- CHECK constraint, a partial UNIQUE index, a BEFORE INSERT scrub trigger,
-- and re-bases create_wizard_strategy with a 12th parameter. None of that
-- machinery is under test by 20260920120000, which only extends a
-- column-level GRANT and self-verifies via has_column_privilege(). The gate
-- needs the column to exist and nothing else — a plain nullable TEXT column
-- is the widest stand-in that lets the GRANT statement parse and run.
ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS venue_account_id TEXT;
