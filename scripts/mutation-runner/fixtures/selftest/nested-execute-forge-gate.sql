-- SELF-TEST FIXTURE — DELIBERATELY ADVERSARIAL. Never part of the green corpus.
--
-- Regression corpus entry, PRIMITIVE B (phase 164.3.1 plan 11, SC-1): the
-- nested-EXECUTE DO forgery — the STRONGEST KNOWN ATTACK on source-location
-- attribution, and the reason GRAMMAR.md § 3c carries its single-frame
-- AUTHORING RULE ("an arm's TEST FAILED raise MUST sit DIRECTLY in a DO body;
-- a raise nested inside EXECUTE, a helper function or a trigger is refused
-- NO-IDENTITY by design"). ⚠️ THIS FILE IS THAT ATTACK. Kept refused by
-- lane-driven arms that run on every PR through `run.mjs --self-test`.
-- PROMOTED from the scratch fixture recorded in full in
-- 164.3.1-05-ATTRIBUTION.md § 3 (arms CTRL 1, FORGE 2 and FORGE 3, text
-- unchanged), where its verdicts were first observed.
--
-- ⛔ THE ADVERSARIAL FINDING (164.3.1-RESEARCH, 2026-09-01; measured live in
-- plan 05). The innermost CONTEXT frame ALONE is forgeable: a trigger running
--
--     EXECUTE 'DO $d$' || repeat(E'\n', k) || 'BEGIN RAISE EXCEPTION … END $d$'
--
-- produces an `inline_code_block line N at RAISE` frame whose name AND line are
-- attacker-chosen, under the gate file's own `psql:` prefix. With k = 4 the
-- forgery landed on the genuine arm's EXACT resolved line: legs (a) and (c) of
-- the attribution BOTH pass. What an attacker cannot REMOVE is the rest of the
-- chain — the trigger frame and the `SQL statement` frame above the forged
-- one — so the chain's LENGTH is the control. 164.3.1-05-ATTRIBUTION.md § 6
-- records it flipping to a false `RED (identity ok)` when neutered to
-- first-frame-only; plan 11's CORPUS-PROOFS record re-observes it here.
--
-- WHAT THIS FILE PINS, in ONE run (three arms, all annotated):
--
--   CTRL 1   — a genuine arm. ⭐ THE PASSING CONTROL (CONTEXT D-02): must score
--              `RED (identity ok)` in the SAME run the forgeries are refused.
--   FORGE 2  — RESEARCH's recipe verbatim: the trigger EXECUTEs a padded DO
--              string that spells the identity INSIDE it. ⛔ MEASURED
--              (ATTRIBUTION § 5): psql echoes that string back as a
--              `SQL statement "…"` CONTEXT frame, so the identity is ALSO
--              sighted in a FIELD — unattributable on its own, independent of
--              chain length. FORGE 2 is refused by TWO controls, and neutering
--              the chain rule alone does NOT flip it. Kept because it is the
--              documented recipe; its `(+1 further unattributable sighting)`
--              suffix is asserted so the double guard stays visible.
--   FORGE 3  — FORGE 2 with its ECHO REMOVED: the trigger stashes the identity
--              in a GUC and the EXECUTEd DO reads it back with
--              current_setting(), so the forged statement text names no
--              identity anywhere. The ONLY sighting left is the ERROR block's
--              own message, carrying a forged single first frame that resolves
--              to this arm's real raise line. The CHAIN LENGTH is then the only
--              thing refusing it — which is what makes the Task-3 neuter proof
--              mean anything. Its detail must carry NO `further … sighting`
--              suffix (single sighting) and must name the forged frame
--              `inline_code_block line 5 at RAISE` (the forgery is AIMED).
--
-- ⚠️ THE PADDING IS DERIVED, NOT ARBITRARY (ATTRIBUTION § 8, carry-forward 2).
-- Each forgery pads its EXECUTEd DO with `raiseFileLine − stmtStartLine`
-- newlines so the forged CONTEXT line lands EXACTLY on the genuine arm's
-- resolved line. In both FORGE blocks below the RAISE is the 5th line of its
-- DO statement, so k = 4 and the forged frame reads `line 5`. If either block's
-- shape changes, recompute k — otherwise the forgery stops being aimed, leg (c)
-- refuses it, and the chain-length proof silently weakens to a leg-(c) refusal
-- that proves nothing about the rule this file exists for. The self-test
-- asserts the `line 5` frame for exactly that reason.
--
-- ⛔ NEITHER FORGERY SPELLS THE DETECTOR'S LITERAL. `TEST FA[I]LED` is a POSIX
-- character class that matches the literal at runtime while containing it in
-- neither its direct nor its concatenated form — GRAMMAR rule 3a is BLIND to
-- both, by construction. What refuses them is WHERE the raise came from.
--
-- The `NEW.id <> 90N` guards make each trigger fire on ITS arm's own INSERT and
-- on no other (164.3.1-05-SUMMARY, Issues 1).

-- RED-UNDER-SETUP: {"apply":["scripts/mutation-runner/fixtures/mini-migration.sql"]}

-- ---------------------------------------------------------------------------
-- CTRL 1 — exact-set grant pin. The genuine arm; the passing control.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: `GRANT UPDATE ON mini_widget TO authenticated` on the live
  --            database breaks the exact-set grant pin.
  -- RED-UNDER-M: {"arm":"CTRL 1","apply":[{"kind":"sql","stmt":"GRANT UPDATE ON mini_widget TO authenticated"}]}
DO $$
DECLARE
  held TEXT;
BEGIN
  SELECT COALESCE(string_agg(DISTINCT privilege_type, ',' ORDER BY privilege_type), '(none)')
    INTO held
    FROM information_schema.role_table_grants
   WHERE table_name = 'mini_widget' AND grantee = 'authenticated';

  IF held IS DISTINCT FROM 'SELECT' THEN
    RAISE EXCEPTION 'TEST FAILED (CTRL 1): authenticated holds % on mini_widget, expected exactly SELECT.', held;
  END IF;
  RAISE NOTICE 'CTRL 1 ok';
END $$;

-- ---------------------------------------------------------------------------
-- FORGE 2 — the nested-EXECUTE DO forgery, RESEARCH's recipe verbatim (echoing).
-- ---------------------------------------------------------------------------
  -- RED-UNDER: the nested-EXECUTE DO forgery. The trigger EXECUTEs a DO string
  --            padded with 4 newlines so the innermost frame reports
  --            exactly the line this arm's own RAISE sits on — legs (a) and (c)
  --            of the attribution BOTH pass. Only the chain LENGTH refuses it
  --            (and, for THIS spelling, the echoed identity in the
  --            `SQL statement` field — see FORGE 3).
  -- RED-UNDER-M: {"arm":"FORGE 2","apply":[{"kind":"sql","stmt":"CREATE FUNCTION forge_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ DECLARE m TEXT; BEGIN IF NEW.id <> 902 THEN RETURN NULL; END IF; m := substring(current_query() from 'TEST FA[I]LED .FORGE 2.[^'']*'); EXECUTE 'DO $d$' || repeat(E'\\n', 4) || 'BEGIN RAISE EXCEPTION ' || quote_literal(m) || '; END $d$'; END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER forge AFTER INSERT ON mini_widget FOR EACH ROW EXECUTE FUNCTION forge_fn()"}]}
DO $$
BEGIN
  INSERT INTO mini_widget (id, label) VALUES (902, 'trip the trigger');
  IF FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (FORGE 2): the arm under test fired.';
  END IF;
  RAISE NOTICE 'FORGE 2 ok';
END $$;

-- ---------------------------------------------------------------------------
-- FORGE 3 — the same forgery with its ECHO REMOVED. The chain rule stands alone.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: FORGE 3 — the nested-EXECUTE forgery with its ECHO REMOVED.
  --
  --            ⛔ MEASURED 2026-09-01: FORGE 2 above is refused by TWO
  --            independent controls, not one. Its EXECUTEd DO string contains
  --            the identity literally, and psql PRINTS that string as a
  --            `SQL statement "…"` frame of the CONTEXT chain — so the identity
  --            is ALSO sighted in a FIELD rather than a message, which is
  --            unattributable on its own. Neutering the chain-length rule while
  --            that echo is present therefore does NOT flip FORGE 2 to RED, and
  --            a "proof" run on FORGE 2 alone would have proven nothing about
  --            leg (b).
  --
  --            This arm removes the echo: the trigger stashes the identity in a
  --            GUC and the EXECUTEd DO reads it back with current_setting(), so
  --            the forged statement text names no identity anywhere. The ONLY
  --            sighting left is the ERROR block's own message, carrying a
  --            forged single first frame that resolves to this arm's real raise
  --            line. The CHAIN LENGTH is then the only thing refusing it —
  --            which is what makes the neuter proof mean anything.
  -- RED-UNDER-M: {"arm":"FORGE 3","apply":[{"kind":"sql","stmt":"CREATE FUNCTION forge_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ DECLARE m TEXT; BEGIN IF NEW.id <> 903 THEN RETURN NULL; END IF; m := substring(current_query() from 'TEST FA[I]LED .FORGE 3.[^'']*'); PERFORM set_config('mut.m', m, false); EXECUTE 'DO $d$' || repeat(E'\\n', 4) || 'BEGIN RAISE EXCEPTION ''%'', current_setting(''mut.m''); END $d$'; END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER forge AFTER INSERT ON mini_widget FOR EACH ROW EXECUTE FUNCTION forge_fn()"}]}
DO $$
BEGIN
  INSERT INTO mini_widget (id, label) VALUES (903, 'trip the trigger');
  IF FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (FORGE 3): the arm under test fired.';
  END IF;
  RAISE NOTICE 'FORGE 3 ok';
END $$;
