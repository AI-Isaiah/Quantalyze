-- SELF-TEST FIXTURE — DELIBERATELY SHAPED. Never part of the green corpus.
--
-- Regression corpus entry, PRIMITIVE A (phase 164.3.1 plan 11, SC-1): the
-- [R4-C01] COMPOUND-HEAD hole, kept closed by a lane-driven arm that runs on
-- every PR through `run.mjs --self-test`.
--
-- ⛔ THE MEASURED DEFECT (RESEARCH premise P3; ROADMAP [R4-C01]). `isBranchHead`
-- used to be asked of a LINE, with an unanchored `/\b(THEN|LOOP)$/` arm, so
--
--     SET ROLE postgres; IF NOT ok THEN
--
-- was accepted WHOLE as a branch head. The backward scan terminated on it,
-- `neuterArm` returned `found: true`, and `SET ROLE postgres;` stayed LIVE in
-- the neutered gate: a superuser session handed to every later arm, with no
-- signal. Plan 164.3.1-01 closed it BY CONSTRUCTION — the tokenizer decomposes
-- the line into `SET ROLE postgres;` plus an open `IF NOT ok THEN`; the head
-- is real but does not BEGIN its line, so the statement sharing the line before
-- it is REFUSED, by name (`run.mjs` neuterArm, "a branch head must begin its
-- line"). Plan 01 pinned that refusal in vitest; this file pins it through a
-- REAL lane, where the refusal is a `neuter-missed` defect in the runner's own
-- verdict table.
--
-- WHAT THIS FILE PINS, in ONE run (four arms, two annotated):
--
--   P1 SEVEN      — un-annotated. Carries the seven-line P1 shape from
--                   supabase/tests/test_profiles_privileged_columns_locked.sql
--                   (96/101/106/111/116/121/132) VERBATIM:
--                       EXCEPTION WHEN OTHERS THEN v_raised := true; END;
--                   directly above the corpus's one-line head+cleanup+raise+
--                   terminator. It is the NEUTER TARGET of BEHIND P1.
--   BEHIND P1     — annotated, neuters P1 SEVEN. ⭐ THE PASSING CONTROL. The P1
--                   line decomposes into a head plus two statements, the walk
--                   terminates on the NEXT line's head (which begins its line),
--                   the neuter is ACCEPTED through the sub-line splice, the lane
--                   runs, and BEHIND P1 scores `RED (identity ok)`. A classifier
--                   that refused every compound line would refuse this one too,
--                   so the scenario cannot pass by refusing everything.
--   COMPOUND HEAD — un-annotated. The exact-set grant pin, carrying the P3
--                   compound-HEAD line directly above its raise. It is the
--                   NEUTER TARGET of BEHIND HEAD.
--   BEHIND HEAD   — annotated, neuters COMPOUND HEAD. The shipped rule REFUSES
--                   that neuter: the runner reports `neuter-missed` for
--                   BEHIND HEAD, its detail names `SET ROLE postgres;`, and the
--                   arm never reaches a lane. That refusal IS the observable —
--                   the loud outcome plan 01 chose over an accepted neuter that
--                   leaves a superuser session live.
--
-- ⚠️ P1 and P3 are DIFFERENT shapes — do not conflate them (164.3.1-01-SUMMARY
-- § 7). The seven real lines are EXCEPTION-compound: a head plus TWO trailing
-- statements, correctly decomposed and correctly ACCEPTED when a proper head
-- follows on its own line. The P3 compound HEAD is `SET ROLE postgres; IF NOT
-- ok THEN`: a statement BEFORE a head on the same line, correctly REFUSED.
--
-- Arm ORDER is load-bearing. P1 SEVEN and BEHIND P1 come first so that BEHIND
-- P1's mutation (GRANT UPDATE) is shadowed by P1 SEVEN alone and never reaches
-- COMPOUND HEAD; COMPOUND HEAD and BEHIND HEAD come after, so BEHIND HEAD's
-- mutation (GRANT INSERT) is shadowed by the exact-set pin alone.
--
-- `SET ROLE postgres;` sits inside a branch that is FALSE on a pristine
-- database, so the baseline and restore legs never execute it. The lane's
-- superuser IS `postgres` (scripts/pg-lane/run.sh: `initdb -U postgres`), so
-- the statement would succeed if reached; the point is that no ACCEPTED neuter
-- may ever leave it reachable.
--
-- ⚠️ NO psql meta-commands anywhere in this file (CI pre-flights gate files).
-- ⚠️ No `;` inside any string literal, and no apostrophe inside any literal
-- except through `%` substitution — the Task-3 neuter proofs re-introduce a
-- quote-only forward walk, and this file must not accidentally rescue it.

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

-- ---------------------------------------------------------------------------
-- P1 SEVEN — an UPDATE by `authenticated` must be refused by the GRANT layer.
-- The EXCEPTION line and the IF line below are the real corpus's two lines
-- (test_profiles_privileged_columns_locked.sql:96-97), in shape and in
-- compound-ness: head + two statements, then head + cleanup + raise + END IF.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_raised BOOLEAN := false;
BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    UPDATE mini_widget SET label = 'p1-seven' WHERE id = 1;
  EXCEPTION WHEN OTHERS THEN v_raised := true; END;
  IF NOT v_raised THEN RESET ROLE; RAISE EXCEPTION 'TEST FAILED (P1 SEVEN): authenticated was permitted to UPDATE mini_widget, the GRANT layer did not refuse.'; END IF;
  RESET ROLE;
  RAISE NOTICE 'P1 SEVEN ok';
END $$;

-- ---------------------------------------------------------------------------
-- BEHIND P1 — UPDATE must not be among authenticated's table privileges.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: `GRANT UPDATE ON mini_widget TO authenticated` on the live
  --            database. ⚠️ P1 SEVEN fires first (authenticated can then
  --            UPDATE), so this arm is only reachable with P1 SEVEN neutered,
  --            and P1 SEVEN's raise sits under the P1 compound line. THE
  --            PASSING CONTROL: that neuter must be ACCEPTED and this arm must
  --            score RED (identity ok).
  -- RED-UNDER-M: {"arm":"BEHIND P1","apply":[{"kind":"sql","stmt":"GRANT UPDATE ON mini_widget TO authenticated"}],"neuter":[{"arm":"P1 SEVEN"}]}
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held LIKE '%UPDATE%' THEN
    RAISE EXCEPTION 'TEST FAILED (BEHIND P1): authenticated holds % on mini_widget, UPDATE must not be granted.', held;
  END IF;
  RAISE NOTICE 'BEHIND P1 ok';
END $$;

-- ---------------------------------------------------------------------------
-- COMPOUND HEAD — exact-set grant pin. Fires on ANY table-grant drift, which is
-- why it shadows BEHIND HEAD. Its abort branch carries the P3 compound HEAD,
-- verbatim: a privileged statement and an open IF … THEN on ONE line, directly
-- above the raise. `ok` is recomputed nowhere between the two IFs, so the inner
-- IF is a pure duplicate of the outer one — the SHAPE is the whole point.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  held TEXT;
  ok   BOOLEAN;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';
  ok := (held = 'SELECT');

  IF NOT ok THEN
    SET ROLE postgres; IF NOT ok THEN
      RAISE EXCEPTION 'TEST FAILED (COMPOUND HEAD): authenticated holds % on mini_widget, expected exactly SELECT.', held;
    END IF;
  END IF;
  RAISE NOTICE 'COMPOUND HEAD ok';
END $$;

-- ---------------------------------------------------------------------------
-- BEHIND HEAD — INSERT must not be among authenticated's table privileges.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: `GRANT INSERT ON mini_widget TO authenticated` on the live
  --            database. ⚠️ COMPOUND HEAD's exact-set pin fires first on ANY
  --            grant drift, so this arm declares a neuter of COMPOUND HEAD —
  --            and the shipped classifier REFUSES that neuter by name, because
  --            `SET ROLE postgres;` shares the line of the head it would
  --            terminate on. The self-test asserts the `neuter-missed` defect,
  --            its `SET ROLE postgres;` naming, and that this arm never lanes.
  -- RED-UNDER-M: {"arm":"BEHIND HEAD","apply":[{"kind":"sql","stmt":"GRANT INSERT ON mini_widget TO authenticated"}],"neuter":[{"arm":"COMPOUND HEAD"}]}
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held LIKE '%INSERT%' THEN
    RAISE EXCEPTION 'TEST FAILED (BEHIND HEAD): authenticated holds % on mini_widget, INSERT must not be granted.', held;
  END IF;
  RAISE NOTICE 'BEHIND HEAD ok';
END $$;

DO $$
BEGIN
  RAISE NOTICE 'compound_head_gate: ALL 4 ARMS EXECUTED (P1 SEVEN, BEHIND P1, COMPOUND HEAD, BEHIND HEAD)';
END $$;
