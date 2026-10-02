-- SELF-TEST FIXTURE — DELIBERATELY DEFECTIVE. Never part of the green corpus.
--
-- Proves exit-1 mode (a): an annotation whose declared mutation does NOT redden
-- its arm. The mutation applies cleanly (it really does change the file), the
-- gate still passes, so the arm is unfailable and the runner must report
-- `no-red`.
--
-- This is mechanism 1/4/5's shape in miniature: a control that cannot fail is
-- indistinguishable from a passing one by every signal a reviewer reads.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

  -- RED-UNDER: change the label column's DEFAULT. (This is a LIE — the arm
  --            below asserts the generation column's TYPE, which the default
  --            change cannot possibly affect.)
  -- RED-UNDER-M: {"arm":"NONBITE 1","apply":[{"kind":"edit","file":"scripts/mutation-runner/fixtures/mini-migration.sql","find":"'unset'","replace":"'other'","occurrences":1}]}
DO $$
DECLARE
  gen_type TEXT;
BEGIN
  SELECT data_type INTO gen_type
    FROM information_schema.columns
   WHERE table_name = 'mini_widget' AND column_name = 'generation';

  IF gen_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'TEST FAILED (NONBITE 1): mini_widget.generation is %, expected bigint.', gen_type;
  END IF;
  RAISE NOTICE 'NONBITE 1 ok';
END $$;
