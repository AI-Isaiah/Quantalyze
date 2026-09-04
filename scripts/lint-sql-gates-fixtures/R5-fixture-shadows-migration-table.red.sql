-- RED FIXTURE for R5-fixture-shadows-migration-table (mechanism 6).
--
-- ⭐ THIS IS A MEASURED INSTANCE, NOT AN INVENTED ONE. The apply list below is
-- the PRE-REPAIR shape of `supabase/tests/test_user_notes_dashboard_scope.sql`,
-- reduced to the two entries that carry the defect. Both files are the REAL
-- ones; nothing here is a mock.
--
--   `scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql:30` declares
--   `CREATE TABLE IF NOT EXISTS user_notes (user_id UUID)` — a one-column
--   stand-in whose only job is to give `sanitize_user` something to delete
--   from. `supabase/migrations/20260412094453_user_notes.sql` then creates the
--   REAL `user_notes`, also with IF NOT EXISTS, so its create is a silent
--   NO-OP. The scope_kind CHECK, the four owner policies and RLS itself are all
--   absent from a table that nonetheless EXISTS, and the gate's arms run
--   against the stand-in while the file prints PASS.
--
-- The repair, and the escape this rule honours, is the fixture-16 idiom:
-- `scripts/pg-lane/fixtures/16-fixture-user-notes-baseline.sql:18` carries
-- `DROP TABLE IF EXISTS public.user_notes;` between the two entries, which is
-- exactly the difference between this file and its green twin. Read that
-- fixture's header (:5-18) for the full write-up — it is the specification this
-- rule was written from.
--
-- ⚠️ The body below is deliberately inert. The subject of a mechanism-6 rule is
-- the APPLY LIST in the annotation, not the SQL: the shadowing happens while
-- the lane is being built, before the gate's first statement runs.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","supabase/migrations/20260412094453_user_notes.sql"]}

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_notes') THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R5): user_notes does not exist';
  END IF;
END $$;

COMMIT;
