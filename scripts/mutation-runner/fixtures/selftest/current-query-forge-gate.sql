-- SELF-TEST FIXTURE — DELIBERATELY ADVERSARIAL. Never part of the green corpus.
--
-- Regression corpus entry, PRIMITIVE B (phase 164.3.1 plan 11, SC-1): the
-- [R4-C02] `current_query()` forgery, kept refused by a lane-driven arm that
-- runs on every PR through `run.mjs --self-test`. PROMOTED from the scratch
-- fixture recorded in full in 164.3.1-05-ATTRIBUTION.md § 3 (arms CTRL 1 and
-- FORGE 1, text unchanged), where its verdicts were first observed.
--
-- ⛔ THE MEASURED DEFECT. Until 2026-09-01 the runner identified an arm by an
-- in-query NONCE stamped into the scratch gate. That nonce was a secret
-- TRANSMITTED TO THE ATTACKER: it sat in the query text of the statement the
-- gate was running, and PostgreSQL hands query text to server-side code. A
-- trigger installed by an ordinary `sql` step — no file read, no superuser —
-- read it back with `current_query()` and re-raised it, and an arm whose own
-- raise was guarded by `IF FALSE` scored `RED (identity ok)` with `biting: 1`.
-- Plan 164.3.1-05 replaced the nonce with SOURCE-LOCATION attribution
-- (GRAMMAR.md § 3c, THE RULE): the raise's psql prefix must name this lane's
-- gate file, its CONTEXT chain must be EXACTLY ONE
-- `PL/pgSQL function inline_code_block line N at RAISE` frame, and N must
-- resolve to the arm's recorded raise line. The trigger's raise carries
-- `PL/pgSQL function forge_fn() line 1 at RAISE` as its FIRST frame, so it is
-- refused `synthesised-identity` and NOT counted as biting.
--
-- WHAT THIS FILE PINS, in ONE run (two arms, both annotated):
--
--   CTRL 1   — a genuine arm. ⭐ THE PASSING CONTROL (CONTEXT D-02). An
--              attribution that refuses everything also refuses every forgery,
--              so the refusal below means nothing unless this arm scores
--              `RED (identity ok)` in the SAME run.
--   FORGE 1  — [R4-C02] verbatim: a `sql` step installs an AFTER INSERT trigger
--              that reads the running query text and re-raises this arm's
--              identity. The arm's guard is `IF FALSE`, so the arm itself
--              never runs and the gate file is never touched. Must score
--              `SYNTHESISED(FORGE 1)`, exit 1, biting NOT incremented.
--
-- ⛔ THE FORGERY DOES NOT SPELL THE DETECTOR'S LITERAL. `TEST FA[I]LED` is a
-- POSIX character class that matches the literal at runtime while containing
-- it in neither its direct nor its concatenated form — so GRAMMAR rule 3a is
-- BLIND to it, by construction. A fixture rule 3a caught would prove nothing
-- about the class. What refuses it is WHERE the raise came from.
--
-- The `NEW.id <> 901` guard makes the trigger fire on THIS arm's own INSERT and
-- on no other; without it the trigger trips on the first INSERT in the file
-- and never reaches its target (164.3.1-05-SUMMARY, Issues 1: a forgery that
-- aborts early looks exactly like a forgery that was refused).

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
-- FORGE 1 — the [R4-C02] attack. The arm is a decoy that never fires.
-- ---------------------------------------------------------------------------
  -- RED-UNDER: [R4-C02] install an AFTER INSERT trigger that reads
  --            current_query() and re-raises this arm's identity out of the
  --            gate's own query text. The arm's guard is IF FALSE, so the arm
  --            itself never runs and the gate file is never touched.
  --            (The `NEW.id <> 901` guard makes the trigger fire on THIS arm's
  --            own INSERT and not on any other in the file.)
  -- RED-UNDER-M: {"arm":"FORGE 1","apply":[{"kind":"sql","stmt":"CREATE FUNCTION forge_fn() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN IF NEW.id <> 901 THEN RETURN NULL; END IF; RAISE EXCEPTION '%', substring(current_query() from 'TEST FA[I]LED .FORGE 1.[^'']*'); END $f$"},{"kind":"sql","stmt":"CREATE TRIGGER forge AFTER INSERT ON mini_widget FOR EACH ROW EXECUTE FUNCTION forge_fn()"}]}
DO $$
BEGIN
  INSERT INTO mini_widget (id, label) VALUES (901, 'trip the trigger');
  IF FALSE THEN
    RAISE EXCEPTION 'TEST FAILED (FORGE 1): the arm under test fired.';
  END IF;
  RAISE NOTICE 'FORGE 1 ok';
END $$;
