-- SELF-TEST FIXTURE — DELIBERATELY DEFECTIVE. Never part of the green corpus.
--
-- Proves the R2-W04 mode: a mutation that REWRITES an arm identity must be
-- refused as `identity-rewrite`, and must NOT reach a lane.
--
-- GRAMMAR rule 3 originally refused only mutations that WRITE a
-- first-failure literal. That is one spelling. The general shape carries no
-- such literal anywhere — it RE-POINTS an existing raise so a DIFFERENT arm
-- reports under the arm-under-test's ID. Measured against the real gate file
-- at HEAD, `{"find":"ANON 1a): ","replace":"N1 1a): ","occurrences":1}` parsed
-- clean, and applying it moved `ANON 1a` from 1 occurrence to 0 and `N1 1a`
-- from 1 to 2. `firstFailureArm` would then read `N1 1a`, the runner would
-- report `RED (identity ok)`, and `biting` would rise for an arm whose own
-- logic never ran.
--
-- The refusal is stated over the FILE, not over the annotation's spelling: the
-- multiset of arm identities the first-failure regex can read must survive
-- a mutation unchanged. A rule about how the annotation is written can be
-- re-written around; an invariant about what it does to the file cannot.
--
-- ⚠️ The annotation below contains no failure-literal text of its own, and
-- its needle names no failure literal — that is the point. If this fixture
-- were caught by the parse-time spelling rule it would prove nothing about
-- the class.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

  -- RED-UNDER: re-point the victim arm's raise so it reports under this arm's ID.
  -- RED-UNDER-M: {"arm":"IDREWRITE 1","apply":[{"kind":"edit","file":"scripts/mutation-runner/fixtures/selftest/identity-rewrite-gate.sql","find":"IDREWRITE VICTIM): ","replace":"IDREWRITE 1): ","occurrences":2,"nth":2}]}
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM mini_widget) THEN
    RAISE EXCEPTION 'TEST FAILED (IDREWRITE VICTIM): the victim arm fired.';
  END IF;
  RAISE NOTICE 'victim ok';
END $$;

DO $$
BEGIN
  IF FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (IDREWRITE 1): the arm under test fired.';
  END IF;
  RAISE NOTICE 'arm under test ok';
END $$;
