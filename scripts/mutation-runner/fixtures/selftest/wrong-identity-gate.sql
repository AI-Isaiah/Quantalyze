-- SELF-TEST FIXTURE — DELIBERATELY DEFECTIVE. Never part of the green corpus.
--
-- Proves exit-1 mode (c): the mutation DOES turn the file red, but it reddens a
-- DIFFERENT arm than the one annotated. "The file went red" is satisfied by a
-- mutation that breaks something else entirely — a vacuous check inside the
-- vacuity detector. The runner must report `wrong-first-failure`.
--
-- The defect is a MISSING `neuter`: WRONGID PIN is an exact-set grant pin that
-- fires on ANY grant drift, so it shadows WRONGID 2b. The real corpus has this
-- exact structure (SHAPE 3b shadowing NONCE 1b), and there the prerequisite
-- neuter was recorded only in PROSE — which is why the grammar has a field for
-- it and the runner asserts on it.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

-- WRONGID PIN — un-annotated; it is the arm that (incorrectly) fires first.
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'TEST FAILED (WRONGID PIN): authenticated holds % on mini_widget, expected exactly SELECT.', held;
  END IF;
  RAISE NOTICE 'WRONGID PIN ok';
END $$;

  -- RED-UNDER: `GRANT UPDATE ON mini_widget TO authenticated` on the live
  --            database. (The prose omits — as the real corpus's prose did —
  --            that WRONGID PIN must be neutered first.)
  -- RED-UNDER-M: {"arm":"WRONGID 2b","apply":[{"kind":"sql","stmt":"GRANT UPDATE ON mini_widget TO authenticated"}]}
DO $$
DECLARE
  admitted BOOLEAN := FALSE;
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE mini_widget SET label = 'mutated' WHERE id = 1;
    admitted := TRUE;
  EXCEPTION WHEN insufficient_privilege THEN
    admitted := FALSE;
  END;
  RESET ROLE;

  IF admitted THEN
    RAISE EXCEPTION 'TEST FAILED (WRONGID 2b): authenticated was permitted to UPDATE mini_widget; the GRANT layer did not refuse.';
  END IF;
  RAISE NOTICE 'WRONGID 2b ok';
END $$;
