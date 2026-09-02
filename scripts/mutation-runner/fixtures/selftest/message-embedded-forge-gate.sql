-- SELF-TEST FIXTURE — DELIBERATELY ADVERSARIAL. Never part of the green corpus.
--
-- Regression corpus entry, PRIMITIVE B (F1, 164.3.1 adversarial review,
-- 2026-09-02): the MESSAGE-EMBEDDED ATTRIBUTION FORGERY. Beside FORGE 2 / 3
-- (nested-execute-forge-gate.sql), which forge the innermost CONTEXT FRAME and
-- are refused by the chain's LENGTH, this one forges the whole CONTEXT +
-- LOCATION PAIR inside the RAISE's MESSAGE TEXT — and chain length does not
-- refuse it, because the forged chain IS one frame long.
--
-- ⛔ THE FINDING, MEASURED LIVE on PG 16 through the real lane. psql prints a
-- multi-line message raw, so a trigger raising
--
--     E'TEST FAILED (X)\nCONTEXT:  PL/pgSQL function inline_code_block line 8 at RAISE\nLOCATION:  exec_stmt_raise, pl_exec.c:3911'
--
-- from inside the gate's own DO block prints as
--
--     psql:<gate>:<DO end>: ERROR:  P0001: TEST FAILED (X)
--     CONTEXT:  PL/pgSQL function inline_code_block line 8 at RAISE   ← message text
--     LOCATION:  exec_stmt_raise, pl_exec.c:3911                      ← message text
--     CONTEXT:  PL/pgSQL function forge_fn() line 1 at RAISE          ← the real chain
--     SQL statement "INSERT INTO mini_widget …"
--     PL/pgSQL function inline_code_block line 5 at SQL statement
--     LOCATION:  exec_stmt_raise, pl_exec.c:3911
--
-- A reader taking the FIRST CONTEXT and the first LOCATION after it sees a
-- single `inline_code_block line 8 at RAISE` frame under the gate's own prefix
-- at the DO's end line: legs (a), (b) AND (c) all PASS. Pre-fix this scored
-- `RED (identity ok)` with biting 1 for an arm whose guard never ran.
--
-- What the attacker cannot do is stop libpq from printing the REAL fields after
-- the message. libpq emits each of DETAIL / HINT / QUERY / CONTEXT / the five
-- verbose NAME fields / LOCATION AT MOST ONCE per message, in a fixed order,
-- LOCATION last — so a forged prefix ALWAYS leaves a repeated field name, or a
-- field after LOCATION. `judgeBlock` refuses either shape by name
-- ("duplicated diagnostic field — message-embedded forgery"), and this file
-- keeps that refusal lane-driven on every PR.
--
-- WHAT THIS FILE PINS, in ONE run (two arms, both annotated):
--
--   CTRL 1   — a genuine arm. ⭐ THE PASSING CONTROL (CONTEXT D-02): must score
--              `RED (identity ok)` in the SAME run the forgery is refused.
--   FORGE 4  — the arm sets `ok := true` in its own body so its guard `IF NOT ok`
--              never raises; its `sql` step installs a trigger on the arm's
--              INSERT that raises the forged message above, with the CONTEXT
--              line AIMED at this arm's real RAISE (the 8th line of its DO
--              statement — recompute if the block is reshaped). Must score
--              `SYNTHESISED(FORGE 4)`, exit 1, biting NOT incremented, with a
--              refusal that names the duplicated field.
--
-- ⛔ THE FORGERY DOES NOT SPELL THE DETECTOR'S LITERAL. `TEST FA\x49LED` is an
-- E'' hex escape for `I`, so the annotation contains the literal in neither its
-- direct nor its concatenated form — GRAMMAR rule 3a is BLIND to it, by
-- construction, exactly as it is to FORGE 1-3's `TEST FA[I]LED`. What refuses
-- it is the SHAPE of what psql printed.
--
-- The `NEW.id <> 904` guard makes the trigger fire on THIS arm's own INSERT and
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
-- FORGE 4 — the message-embedded forgery. The arm's own guard never fires.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: F1 — install an AFTER INSERT trigger whose RAISE message EMBEDS
  --            a forged `CONTEXT:` + `LOCATION:` pair aimed at this arm's real
  --            raise line (line 8 of the DO statement below). The arm itself
  --            sets ok := true and never raises. Legs (a), (b) and (c) all
  --            pass on the forged pair; only the DUPLICATED FIELD refuses it.
  -- RED-UNDER-M: {"arm":"FORGE 4","apply":[{"kind":"sql","stmt":"CREATE FUNCTION forge_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.id <> 904 THEN RETURN NULL; END IF; RAISE EXCEPTION E'TEST FA\\x49LED (FORGE 4): forged\\nCONTEXT:  PL/pgSQL function inline_code_block line 8 at RAISE\\nLOCATION:  exec_stmt_raise, pl_exec.c:3911'; END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER forge AFTER INSERT ON mini_widget FOR EACH ROW EXECUTE FUNCTION forge_fn()"}]}
DO $$
DECLARE
  ok BOOLEAN := false;
BEGIN
  INSERT INTO mini_widget (id, label) VALUES (904, 'trip the trigger');
  ok := true;
  IF NOT ok THEN
    RAISE EXCEPTION 'TEST FAILED (FORGE 4): the arm under test fired.';
  END IF;
  RAISE NOTICE 'FORGE 4 ok';
END $$;
