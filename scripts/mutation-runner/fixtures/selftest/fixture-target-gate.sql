-- SELF-TEST FIXTURE — DELIBERATELY DEFECTIVE. Never part of the green corpus.
--
-- Proves the phase-164.4 authoring rule (threat T-164.4-01): NO TWIN MAY TARGET
-- A pg-lane STAND-IN FIXTURE.
--
-- A `RED-UNDER-M` proves an arm can fail by mutating the thing under test. The
-- twin below mutates `scripts/pg-lane/fixtures/01-fixture-core.sql` instead —
-- the lane's stand-in schema, which `scripts/pg-lane/run.sh:43-50` states
-- carries only the columns the real migrations name. Breaking it reddens the
-- gate, so the arm would be counted as biting; but what was proven is that the
-- FIXTURE AUTHOR'S GUESS can be broken, not that the production object the arm
-- defends is load-bearing. A vacuous pass manufactured inside the vacuity
-- detector — the one class this gate family exists to refuse.
--
-- ⭐ THE FIXTURE IS DELIBERATELY LISTED IN `RED-UNDER-SETUP` BELOW, and that is
-- the whole point of its construction: applying a stand-in is legitimate and
-- every annotated gate does it, so `bad-file-ref` (which refuses a step naming
-- a file OUTSIDE the apply list) cannot be what fires here. The only thing
-- wrong with this file is WHAT THE TWIN MUTATES, and the self-test asserts that
-- no `bad-file-ref` is reported — otherwise the scenario would pass on the
-- wrong rule.
--
-- The refusal is at PARSE time, like rule 3a, so the annotation is never
-- counted as a twin: this file's prose/twin parity reds too (1 prose / 0 twins),
-- and the refusal fires in `--parse-only` on a database-less platform.

-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/mutation-runner/fixtures/mini-migration.sql"]}

  -- RED-UNDER: drop the public schema grant out of the lane's stand-in core
  --            fixture. (This is the DEFECT — the mutation names a stand-in,
  --            not a migration, not this gate, and not a live `sql` step.)
  -- RED-UNDER-M: {"arm":"FIXTGT 1","apply":[{"kind":"edit","file":"scripts/pg-lane/fixtures/01-fixture-core.sql","find":"GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;","replace":"","occurrences":1}]}
DO $$
DECLARE
  gen_type TEXT;
BEGIN
  SELECT data_type INTO gen_type
    FROM information_schema.columns
   WHERE table_name = 'mini_widget' AND column_name = 'generation';

  IF gen_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'TEST FAILED (FIXTGT 1): mini_widget.generation is %, expected bigint.', gen_type;
  END IF;
  RAISE NOTICE 'FIXTGT 1 ok';
END $$;
