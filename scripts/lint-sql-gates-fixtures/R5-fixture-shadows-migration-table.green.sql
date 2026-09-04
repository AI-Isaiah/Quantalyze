-- GREEN FIXTURE for R5-fixture-shadows-migration-table — the repaired idiom,
-- quoted VERBATIM from `supabase/tests/test_user_notes_dashboard_scope.sql:45`.
--
-- The one difference from the red twin is
-- `scripts/pg-lane/fixtures/16-fixture-user-notes-baseline.sql`, which sits
-- between 02's one-column stand-in and the real migration and carries
-- `DROP TABLE IF EXISTS public.user_notes;` (:18). The stand-in is gone by the
-- time 20260412094453 runs, so the REAL migration defines the table, the CHECK,
-- the policies and RLS — the objects this gate's arms actually name.
--
-- ⚠️ This list is the real one and is NOT reduced: it must stay clean under
-- every rule, including the two later user_notes migrations, or the "repaired
-- idiom" claim would only hold for a trimmed version of it.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/16-fixture-user-notes-baseline.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260412094453_user_notes.sql","supabase/migrations/20260421060316_user_notes_multiscope.sql","supabase/migrations/20260715090000_user_notes_dashboard_scope.sql"]}

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'user_notes') THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTURE R5): user_notes does not exist';
  END IF;
END $$;

COMMIT;
