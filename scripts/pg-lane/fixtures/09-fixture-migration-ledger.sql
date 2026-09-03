-- Stand-in for `supabase_migrations.schema_migrations`, the migration ledger a
-- Supabase-managed project carries and a vanilla `initdb` cluster does not. Gates
-- that refuse to SKIP on an absent object use it as their applied-ness oracle:
-- with the ledger present, "the function is missing" can be attributed either to
-- an unapplied migration or to a later DROP, and the gate says so instead of
-- exiting 0 having asserted nothing.
--
-- ⚠️ IT IS CREATED EMPTY, DELIBERATELY. Every arm that consults it today branches
-- ONLY on the table's EXISTENCE (`to_regclass(...) IS NULL`); the row is read into
-- a variable that is interpolated into a failure MESSAGE, never into a condition.
-- A gate that ever branches on a ROW must stamp its own version from its own
-- fixture — do not guess a version set here, because a ledger claiming a
-- migration was applied when the apply list does not carry it is a lie the lane
-- would then report as coverage.
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version    TEXT PRIMARY KEY,
  statements TEXT[],
  name       TEXT
);
