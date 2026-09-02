-- SELF-TEST FIXTURE — DELIBERATELY SHAPED. Never part of the green corpus.
--
-- Regression corpus entry, PRIMITIVE A (phase 164.3.1 plan 11, SC-1):
-- [MUT-I01], BOTH directions, kept closed by lane-driven arms that run on every
-- PR through `run.mjs --self-test`.
--
-- ⛔ THE MEASURED DEFECT (RESEARCH premises P4 and P5). `neuterArm`'s forward
-- scan and `statementEndLine` walked raw characters tracking ONE character —
-- `'` — with no notion of a comment. An apostrophe inside a `--` comment inside
-- a RAISE's own span flipped the scan's quote parity, and the two parities
-- failed DIFFERENTLY:
--
--   ODD  (P4) — the real terminator was swallowed and none was found. The arm
--               was refused `neuter-missed`: "could not find the end of the
--               RAISE statement". LOUD, and FALSE: the arm is fine.
--   EVEN (P5) — a second apostrophe restored parity AFTER the real terminator
--               had been swallowed, so the walk ran on to a LATER statement's
--               `;`. The neuter commented out a statement that had to survive
--               and reported success. SILENT, and it rewrote what the arm does.
--
-- Plan 164.3.1-01 deleted both walkers rather than repairing them: the end of
-- the RAISE is the end of the RAISE's STATEMENT, read from the tokenizer, which
-- is the one reader that knows what a comment is.
--
-- WHAT THIS FILE PINS, in ONE run (four raises, two annotated arms):
--
--   PARITY EVEN   — un-annotated. The P5 shape: the RAISE's argument list is
--                   split by a `-- don't worry` comment, a second apostrophe
--                   follows the terminator (`-- it isn't optional`), and then
--                   statements that MUST SURVIVE the neuter — the branch's own
--                   `END IF;` closer and the `PERFORM` after it. NEUTER
--                   TARGET of BEHIND EVEN.
--                   ⚠️ RESHAPED 2026-09-02 (WR-07, post-RAISE side): the
--                   survivor used to sit INSIDE the branch, after the RAISE.
--                   `neuterArm` now REFUSES any statement between a RAISE and
--                   its closer (in the original file it is unreachable; after
--                   a neuter it runs — `SET ROLE postgres;` there is the RESET
--                   ROLE leak from behind), so the survivor moved past the
--                   closer. With nothing left inside the branch to swallow,
--                   an over-neuter can only swallow the closer itself, which
--                   is a syntax error the lane reports as NO-IDENTITY — the
--                   silent direction is closed BY CONSTRUCTION, and the
--                   SURVIVOR LOST reader this file used to carry (a raise that
--                   could no longer fire) was removed rather than kept as a
--                   control that cannot fail.
--   BEHIND EVEN   — annotated, neuters PARITY EVEN. Must score `RED (identity
--                   ok)` with an EMPTY defect table: a swallowed closer would
--                   surface as `wrong-first-failure` (NO-IDENTITY) instead.
--   PARITY ODD    — un-annotated. The P4 shape: the same split argument list,
--                   and NO second apostrophe anywhere after it in this file.
--                   NEUTER TARGET of BEHIND ODD.
--   BEHIND ODD    — annotated, neuters PARITY ODD. Must score `RED (identity
--                   ok)` with NO `neuter-missed`: the loud direction.
--
-- Arm ORDER is load-bearing twice over. (1) PARITY EVEN / BEHIND EVEN come
-- first so BEHIND EVEN's mutation (GRANT UPDATE) is shadowed by PARITY EVEN
-- alone; PARITY ODD / BEHIND ODD come after, shadowed by PARITY ODD alone
-- (GRANT INSERT). (2) PARITY ODD is the LAST raise before BEHIND ODD and
-- nothing after its `-- don't worry` carries an odd apostrophe, so a
-- quote-only walker starting at its RAISE runs to END OF FILE and refuses —
-- the exact P4 failure, not some other over-neuter. That is what makes the
-- Task-3 neuter proof observe the measured defect rather than a cousin of it.
--
-- ⚠️ NO psql meta-commands anywhere in this file (CI pre-flights gate files).
-- ⚠️ No `;` inside any string literal, and every string literal's apostrophes
-- are PAIRED — the only unpaired apostrophes in executable regions are the two
-- comment lines the P4/P5 shapes require.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

-- ---------------------------------------------------------------------------
-- PARITY EVEN — UPDATE must not be among authenticated's table privileges.
-- The abort branch is the P5 shape. The `-- it isn't optional` comment after
-- the closer restores a quote-only walker's parity, so that walker's next `;`
-- is the PERFORM's — swallowing `END IF;` on the way, which is exactly the
-- over-neuter the old walker committed (there, silently; here, a syntax error).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held LIKE '%UPDATE%' THEN
    RAISE EXCEPTION 'TEST FAILED (PARITY EVEN): authenticated holds % on mini_widget, UPDATE must not be granted.',
      -- don't worry
      held;
  END IF;
  -- it isn't optional
  PERFORM set_config('mut.survivor', 'ran', false);
  RAISE NOTICE 'PARITY EVEN ok';
END $$;

-- ---------------------------------------------------------------------------
-- BEHIND EVEN — UPDATE must not be among authenticated's table privileges,
-- read a second time.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: `GRANT UPDATE ON mini_widget TO authenticated` on the live
  --            database. ⚠️ PARITY EVEN fires first, so this arm is only
  --            reachable with PARITY EVEN neutered — and PARITY EVEN's raise is
  --            the P5 shape. The neuter must comment out the RAISE and ONLY the
  --            RAISE: if it swallows the `END IF;` after it, the gate is a
  --            syntax error and the runner reports `wrong-first-failure`
  --            (NO-IDENTITY) instead of RED (identity ok) here.
  -- RED-UNDER-M: {"arm":"BEHIND EVEN","apply":[{"kind":"sql","stmt":"GRANT UPDATE ON mini_widget TO authenticated"}],"neuter":[{"arm":"PARITY EVEN"}]}
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held LIKE '%UPDATE%' THEN
    RAISE EXCEPTION 'TEST FAILED (BEHIND EVEN): authenticated holds % on mini_widget, UPDATE must not be granted.', held;
  END IF;
  RAISE NOTICE 'BEHIND EVEN ok';
END $$;

-- ---------------------------------------------------------------------------
-- PARITY ODD — INSERT must not be among authenticated's table privileges.
-- The abort branch is the P4 shape. ⚠️ Keep this the last raise before BEHIND
-- ODD, and keep every apostrophe after it paired (see the header).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held LIKE '%INSERT%' THEN
    RAISE EXCEPTION 'TEST FAILED (PARITY ODD): authenticated holds % on mini_widget, INSERT must not be granted.',
      -- don't worry
      held;
  END IF;
  RAISE NOTICE 'PARITY ODD ok';
END $$;

-- ---------------------------------------------------------------------------
-- BEHIND ODD — INSERT must not be among the table privileges of authenticated,
-- read a second time. (No apostrophe may appear in prose from here to EOF —
-- see the header; a quote-only walker must run out of file, not find a `;`.)
-- ---------------------------------------------------------------------------
  -- RED-UNDER: `GRANT INSERT ON mini_widget TO authenticated` on the live
  --            database. ⚠️ PARITY ODD fires first, so this arm is only
  --            reachable with PARITY ODD neutered — and the raise of PARITY ODD
  --            is the P4 shape. A reader that tracks apostrophes alone refuses
  --            that neuter as `could not find the end of the RAISE statement`,
  --            the shipped reader accepts it and this arm scores RED (identity ok).
  -- RED-UNDER-M: {"arm":"BEHIND ODD","apply":[{"kind":"sql","stmt":"GRANT INSERT ON mini_widget TO authenticated"}],"neuter":[{"arm":"PARITY ODD"}]}
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held LIKE '%INSERT%' THEN
    RAISE EXCEPTION 'TEST FAILED (BEHIND ODD): authenticated holds % on mini_widget, INSERT must not be granted.', held;
  END IF;
  RAISE NOTICE 'BEHIND ODD ok';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'comment_parity_gate: ALL 4 ARMS EXECUTED (PARITY EVEN, BEHIND EVEN, PARITY ODD, BEHIND ODD)';
END $$;
