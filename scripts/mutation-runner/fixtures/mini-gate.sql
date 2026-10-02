-- Synthetic gate for the mutation runner's own fixture corpus (`--fixture-corpus`).
--
-- Four arms, three of them annotated, covering every capability the grammar
-- has to express for the real corpus:
--
--   MINI 1   — annotated with an `edit` (byte-exact find/replace on a file)
--   MINI 2a  — DELIBERATELY UN-ANNOTATED. It is the exact-set grant pin, and it
--              exists to be MINI 2b's neuter target. Leaving it un-annotated is
--              also honest about the real corpus: 30 of 103 arms carry a
--              RED-UNDER, and parity is per-annotation, not per-arm.
--   MINI 2b  — annotated with a `sql` step plus a `neuter` prerequisite
--   MINI 3   — annotated with a `waiver`
--
-- Arm order matters. MINI 1 is first so its own mutation makes it the FIRST
-- failure; MINI 2a precedes MINI 2b so that it genuinely shadows it, which is
-- what makes the neuter load-bearing rather than decorative.
--
-- Failure idiom is the real corpus's, verbatim in shape:
--   RAISE EXCEPTION 'TEST FAILED (<ARM ID>): <content-by-field explanation>'

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

-- ⚠️ NO psql meta-commands (`\echo`, `\copy`, …) anywhere in this file. CI
-- pre-flights gate files and refuses them, and the real corpus contains zero.
-- Progress and the completion line use RAISE NOTICE, matching
-- test_strategy_shares_rls.sql:2560.

-- ---------------------------------------------------------------------------
-- MINI 1 — the generation column must be bigint, not integer.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: change `generation  BIGINT` to `generation  INTEGER` in the
  --            mini-migration CREATE TABLE.
  -- RED-UNDER-M: {"arm":"MINI 1","apply":[{"kind":"edit","file":"scripts/mutation-runner/fixtures/mini-migration.sql","find":"generation  BIGINT","replace":"generation  INTEGER","occurrences":1,"nth":1}]}
DO $$
DECLARE
  gen_type TEXT;
BEGIN
  SELECT data_type INTO gen_type
    FROM information_schema.columns
   WHERE table_name = 'mini_widget' AND column_name = 'generation';

  IF gen_type IS DISTINCT FROM 'bigint' THEN
    RAISE EXCEPTION 'TEST FAILED (MINI 1): mini_widget.generation is %, expected bigint.', gen_type;
  END IF;
  RAISE NOTICE 'MINI 1 ok';
END $$;

-- ---------------------------------------------------------------------------
-- MINI 2a — exact-set grant pin. Fires on ANY table-grant drift, which is
-- precisely why it shadows MINI 2b.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'TEST FAILED (MINI 2a): authenticated holds % on mini_widget, expected exactly SELECT.', held;
  END IF;
  RAISE NOTICE 'MINI 2a ok';
END $$;

-- ---------------------------------------------------------------------------
-- MINI 2b — an UPDATE by `authenticated` must be refused by the GRANT layer.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: `GRANT UPDATE ON mini_widget TO authenticated` on the live
  --            database. ⚠️ MINI 2a's exact-set pin fires first on ANY grant
  --            drift, so this arm is only reachable with MINI 2a neutered.
  -- RED-UNDER-M: {"arm":"MINI 2b","apply":[{"kind":"sql","stmt":"GRANT UPDATE ON mini_widget TO authenticated"}],"neuter":[{"arm":"MINI 2a"}]}
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

  -- The probe reads only the flag set above; it does NOT re-query the table
  -- inside the handler. (Mechanism 1 on this phase's defect list is exactly
  -- that shape — an implicit subtransaction reading its own rollback.)
  IF admitted THEN
    RAISE EXCEPTION 'TEST FAILED (MINI 2b): authenticated was permitted to UPDATE mini_widget; the GRANT layer did not refuse.';
  END IF;
  RAISE NOTICE 'MINI 2b ok';
END $$;

-- ---------------------------------------------------------------------------
-- MINI 3 — the table exists. WAIVED: no mutation can make this the FIRST
-- failure, because removing the table aborts the apply and the gate never runs.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: none. Dropping mini_widget aborts the apply (later statements in
  --            the migration reference it), so the gate never executes and this
  --            arm can never be observed as the FIRST failure.
  -- RED-UNDER-M: {"arm":"MINI 3","waiver":"removing mini_widget aborts the apply, so no mutation makes this arm the first failure"}
DO $$
BEGIN
  IF to_regclass('public.mini_widget') IS NULL THEN
    RAISE EXCEPTION 'TEST FAILED (MINI 3): mini_widget does not exist.';
  END IF;
  RAISE NOTICE 'MINI 3 ok';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'mini_gate: ALL 4 ARMS EXECUTED (MINI 1, MINI 2a, MINI 2b, MINI 3)';
END $$;
