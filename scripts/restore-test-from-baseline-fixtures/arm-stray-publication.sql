-- ============================================================================
-- ARM OVERLAY 7 — a realtime publication row for a table the dump does NOT
-- re-create (W3).
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- `public.e2e_leftover` is the stray: `baseline-fixture.sql` carries no
-- `CREATE TABLE IF NOT EXISTS "public"."e2e_leftover"` line. So after the DROP
-- and the replay the table is gone, and re-ADDing it to the publication would
-- fail on a relation that no longer exists — aborting EVERY restore, for ever,
-- until a human removes the row.
--
-- The script refuses BEFORE the transaction and names the remedy. Removing a
-- publication row is a founder act (`ALTER PUBLICATION <pub> DROP TABLE
-- public.<table>`), never something this script does on a shared database.
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.e2e_leftover;
