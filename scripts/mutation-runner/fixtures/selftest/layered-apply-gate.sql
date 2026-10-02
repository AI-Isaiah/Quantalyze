-- SELF-TEST FIXTURE — DELIBERATELY SHAPED. Never part of the green corpus.
--
-- WR-02 (164.3.1 review): MODE IDENTITY for a LAYERED annotation (GRAMMAR
-- Shape 3). `runCorpus` applies a multi-step `apply` IN ORDER to the same
-- scratch copies, re-reading the file after each step, so step N sees step
-- N-1's output. `--parse-only` used to count EVERY step's needle against the
-- PRISTINE repo file — so an annotation whose second step only matches after
-- the first was `occurrence-mismatch` in the static mode and clean in the real
-- run, while run.mjs's header and GRAMMAR § 3b state mode identity as a
-- contract and `--parse-only` is what CI runs where no lane exists.
--
-- The annotation below is that shape, minimally: step 1 rewrites the `label`
-- default, and step 2's needle EXISTS ONLY in step 1's output — 0 occurrences
-- in the pristine migration, asserted by the pin in
-- src/__tests__/mutation-annotation-parser.test.ts BEFORE the parse is trusted.
-- Under the fixed static mode it parses clean; under the pre-fix one it
-- reports `occurrence-mismatch` for LAYERED 1 against a file the real run
-- mutates without complaint.
--
-- Not wired to a lane scenario: what it pins is decidable without a lane. The
-- arm's raise is still shaped to BITE (a `layered-step-2` default is not
-- `unset`) so a scenario can be added without reshaping the file.
--
-- ⚠️ NO psql meta-commands anywhere in this file (CI pre-flights gate files).

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

  -- RED-UNDER: change the `label` column default from `unset` to
  --            `layered-step-1`, then (LAYERED) from `layered-step-1` to
  --            `layered-step-2` — the second edit only exists after the first.
  -- RED-UNDER-M: {"arm":"LAYERED 1","apply":[{"kind":"edit","file":"scripts/mutation-runner/fixtures/mini-migration.sql","find":"DEFAULT 'unset'","replace":"DEFAULT 'layered-step-1'","occurrences":1},{"kind":"edit","file":"scripts/mutation-runner/fixtures/mini-migration.sql","find":"DEFAULT 'layered-step-1'","replace":"DEFAULT 'layered-step-2'","occurrences":1}]}
DO $$
DECLARE
  dflt TEXT;
BEGIN
  SELECT column_default INTO dflt
    FROM information_schema.columns
   WHERE table_name = 'mini_widget' AND column_name = 'label';

  IF dflt IS DISTINCT FROM '''unset''::text' THEN
    RAISE EXCEPTION 'TEST FAILED (LAYERED 1): mini_widget.label default is %, expected unset.', dflt;
  END IF;
  RAISE NOTICE 'LAYERED 1 ok';
END $$;
