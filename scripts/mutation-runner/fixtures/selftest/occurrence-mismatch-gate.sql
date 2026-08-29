-- SELF-TEST FIXTURE — DELIBERATELY DEFECTIVE. Never part of the green corpus.
--
-- Proves the MEASURE_FAIL mode: the annotation's `occurrences` does not match
-- what is actually in the file, so the runner CANNOT KNOW it is mutating the
-- thing the annotation names. It must report `occurrence-mismatch` and must NOT
-- report `no-red` — "could not locate the bytes" and "measured, and the arm did
-- not redden" are different facts and must never share a code path.
--
-- This is the defect plan 164.3-01 hit on the very first real arm. SHAPE 1c's
-- prose says "change `generation BIGINT` … in the STEP 1 CREATE TABLE"; that
-- single-space string occurs exactly once in the migration and it is NOT the
-- CREATE TABLE — it is `RETURNS TABLE (generation BIGINT, nonce UUID)` at line
-- 828. Mutating it aborts the apply, so the gate never runs and no arm can be
-- the first failure. Without an occurrence assertion the runner would have
-- reported a FALSE `no-red` defect against a perfectly good arm.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

  -- RED-UNDER: change `generation  BIGINT` to `generation  INTEGER`.
  -- RED-UNDER-M: {"arm":"OCCMISS 1","apply":[{"kind":"edit","file":"scripts/mutation-runner/fixtures/mini-migration.sql","find":"generation  BIGINT","replace":"generation  INTEGER","occurrences":3,"nth":3}]}
DO $$
DECLARE
  gen_type TEXT;
BEGIN
  SELECT data_type INTO gen_type
    FROM information_schema.columns
   WHERE table_name = 'mini_widget' AND column_name = 'generation';

  IF gen_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'TEST FAILED (OCCMISS 1): mini_widget.generation is %, expected bigint.', gen_type;
  END IF;
  RAISE NOTICE 'OCCMISS 1 ok';
END $$;
