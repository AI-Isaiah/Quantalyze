-- SELF-TEST FIXTURE — DELIBERATELY DEFECTIVE. Never part of the green corpus.
--
-- Proves the R3-C02 mode: a mutation that SYNTHESISES the identity the
-- first-failure detector reads must be refused as `synthesised-identity`, and
-- the arm must NOT be counted as biting.
--
-- ⛔ WHY THIS FIXTURE IS SPELLED THE WAY IT IS. Rule 3a refuses an injected
-- `TEST FAILED (` literal, and after R3-C02 it also collapses `'A' || 'B'`
-- concatenation. Both are rules about the annotation's SPELLING, and a rule
-- about spelling can always be re-spelled around. This annotation uses
-- `format('TEST FA%sED (…)', 'IL')`, which contains the needle in neither its
-- direct nor its concatenated form — so 3a is BLIND to it, by construction. If
-- this fixture were caught by the spelling rule it would prove nothing about
-- the class, exactly as the identity-rewrite fixture beside it is spelled so
-- that only the content invariant can catch it.
--
-- What catches it is the identity NONCE. Before the lane runs, the runner
-- stamps a fresh random token into every `TEST FAILED (` in the SCRATCH copy of
-- this file, and the detector reads only stamped identities. The annotation
-- cannot know the token, so the message it makes PostgreSQL print is unstamped
-- and is therefore, by construction, text the runner did not put in the gate.
--
-- The arm below passes on its own (its guard is `IF FALSE`). Without the nonce,
-- this annotation makes the lane emit `TEST FAILED (SYNTH 1)`, the runner reads
-- it as the first failure, reports `RED (identity ok)` and raises `biting` —
-- for an arm whose own logic never ran, against a gate file never touched.
-- `biting` is the quantity ARMS_FLOOR bounds, so that is a vacuous PASS in this
-- phase's headline number.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

  -- RED-UNDER: make the database print this arm's failure message without ever
  --            running the arm. The gate file is not touched at all.
  -- RED-UNDER-M: {"arm":"SYNTH 1","apply":[{"kind":"sql","stmt":"DO $x$ BEGIN RAISE EXCEPTION '%', format('TEST FA%sED (SYNTH 1): synthetic, the arm never ran.', 'IL'); END $x$"}]}
DO $$
BEGIN
  IF FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (SYNTH 1): the arm under test fired.';
  END IF;
  RAISE NOTICE 'arm under test ok';
END $$;
