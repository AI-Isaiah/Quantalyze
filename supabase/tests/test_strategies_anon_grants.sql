-- Test: anon cannot read public.strategies.api_key_id and holds no write privilege on
-- public.strategies (Phase 170.6.1.1 ANONKEYID, plan 06, O-1 / D-05).
--
-- WHY THIS FILE EXISTS. Row-level security decides WHICH strategies an anonymous
-- visitor sees (the published ones) and never WHICH COLUMNS of them, so the grant
-- layer is the only column control. Migration 20261022120000 takes anon's table-level
-- SELECT, INSERT, UPDATE and DELETE on public.strategies and grants anon column SELECT
-- on every column but api_key_id. Its own DO block proves that state once, at apply.
-- This gate re-reads it on every run, so a later migration that hands api_key_id or a
-- write back to anon, or that adds a column without deciding whether anon may read
-- it, goes RED here instead of shipping.
--
-- THE SEVEN ARMS, and why each needs the others:
--   GRANT 1  anon cannot SELECT api_key_id (has_column_privilege, so a table-level
--            grant, a PUBLIC grant and role inheritance all count).
--   GRANT 2  anon holds no table-level SELECT. A table-level SELECT reaches
--            api_key_id (GRANT 1 sees that) and also every column a later migration
--            adds; this arm names the table-level grant itself.
--   GRANT 3  every non-dropped column other than api_key_id and the
--            HIDDEN_COLUMN_EXEMPTIONS entries lets anon SELECT, and at least one such
--            column exists, so the arm cannot pass on an empty set.
--   GRANT 4  behavioural: as anon, `SELECT api_key_id` is refused with SQLSTATE 42501
--            naming strategies, and a read of id, name, status is not refused. The
--            catalogue arms and the real statement must agree.
--   WRITE 1  anon holds no table-level INSERT, UPDATE or DELETE.
--   WRITE 2  anon holds no column-level INSERT or UPDATE (has_any_column_privilege).
--   KEEP 1   authenticated holds table-level SELECT, INSERT, UPDATE and DELETE and
--            SELECT on api_key_id; service_role holds the four table privileges. The
--            revoke removed exactly anon's grants, not "everything".
--
-- DEFAULT-DENY AND HIDDEN_COLUMN_EXEMPTIONS (W5). Since migration 20261022120000 a
-- strategies column added by a LATER migration is anon-invisible until a migration
-- grants it SELECT to anon: the table-level grant that used to carry new columns to
-- anon is gone. GRANT 3 goes RED on such a column. Its author has two remedies:
-- grant the column to anon in the migration that added it, or add it to the
-- HIDDEN_COLUMN_EXEMPTIONS array below with a reason beside it, which records "anon
-- must NOT see this" as a decision instead of an accident. The list is EMPTY today.
--
-- ⛔ FIXTURES (W3). The sql-mutation pg-lane builds strategies from fixtures, and
-- which fixture grants what decides whether this gate reproduces today's PROD grants.
-- 01-fixture-core.sql creates strategies and grants only SELECT to authenticated
-- (anon gets nothing there); 03-fixture-compute-jobs.sql adds api_key_id;
-- 10-fixture-strategies-rls-baseline.sql runs GRANT ALL ON strategies TO anon,
-- authenticated, service_role, which is what Supabase's bootstrap default privileges
-- gave PROD's table and what 07-fixture-supabase-default-privileges.sql does not
-- retroactively reproduce. Fixture 10 is therefore the one that makes "RED without the
-- migration" real: with it and without the migration anon holds the table SELECT, so
-- GRANT 1 fails. Fixture 10 also gives authenticated and service_role the four table
-- privileges KEEP 1 asserts. Fixture 13 also runs GRANT ALL on strategies, but brings
-- a csv-fold scaffold this gate does not need, so it is not listed. GRANT ALL also
-- hands anon TRUNCATE and TRIGGER on the lane, which PROD no longer holds (Phases
-- TRUNCATEREVOKE and TRIGGERREVOKE); this gate asserts only the four privileges this
-- phase moves, so neither affects an arm. The gate reads "every non-dropped column
-- other than api_key_id", never a typed column list, so it reads the same on the
-- pg-lane, the local-stack lane and any other catalogue.
--
-- ⛔ NO SKIP-WHEN-UNAPPLIED BRANCH. If migration 20261022120000 is absent anon still
-- holds the table SELECT and GRANT 1 fails. That is the right reading: a gate that
-- skipped when its migration was missing would pass on exactly the database it exists
-- to catch.
--
-- This file reads only the catalogue plus one behavioural probe, because the lanes
-- that run it carry different catalogues. It runs inside BEGIN ... ROLLBACK.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- RED-UNDER-M object that scripts/mutation-runner executes (schema in
-- scripts/mutation-runner/GRAMMAR.md). Every twin is a `sql` step: a grant change on
-- the live lane after the setup list, so no file is edited. The setup list is what the
-- lane applies before this gate, in order: 01 core fixture, 02 sanitize tables, 03
-- compute-jobs fixture (api_key_id), 10 strategies RLS baseline (today's grants), then
-- the migration LAST, so scripts/sql-gate-subset.mjs selects this gate on a push that
-- changes the migration.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/10-fixture-strategies-rls-baseline.sql","supabase/migrations/20261022120000_strategies_anon_api_key_id_revoke.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_strategies_anon_grants.sql

BEGIN;

DO $$
DECLARE
  v_rel         regclass := 'public.strategies'::regclass;
  -- HIDDEN_COLUMN_EXEMPTIONS: strategies columns deliberately hidden from anon. EMPTY
  -- today. Each entry must carry a reason beside it, as a comment on its own line
  -- (for example: 'internal_notes', -- reason: staff-only, never shown to a visitor).
  v_hidden_column_exemptions TEXT[] := ARRAY[]::TEXT[];
  v_ungranted   TEXT;
  v_total       INTEGER;
  v_state_key   TEXT;
  v_sqlstate_key TEXT;
  v_msg_key     TEXT;
  v_state_ok    TEXT;
  v_sqlstate_ok TEXT;
  v_write_tbl   TEXT;
  v_missing     TEXT;
BEGIN
  -- ===== ARM GRANT 1 — anon cannot SELECT api_key_id ====================
  -- RED-UNDER: hand the column back to anon on the live lane —
  --            `GRANT SELECT (api_key_id) ON public.strategies TO anon`. That is
  --            what a later migration re-granting the key id would look like, and
  --            the catalogue read must name it as the first failure.
  -- RED-UNDER-M: {"arm":"GRANT 1","apply":[{"kind":"sql","stmt":"GRANT SELECT (api_key_id) ON public.strategies TO anon"}]}
  IF has_column_privilege('anon', v_rel, 'api_key_id', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 1): anon can SELECT public.strategies.api_key_id. A key id is the handle that targets an exchange key, and row-level security never restricts columns, so the grant layer is the only control. Revoke the table-level SELECT and grant anon SELECT on every column but api_key_id (migration 20261022120000 is the model); if a REVOKE printed nothing and changed nothing, the grantor is another role, so find it with aclexplode(relacl).';
  END IF;

  -- ===== ARM GRANT 2 — anon holds no table-level SELECT =================
  -- RED-UNDER: hand the table-level privilege back —
  --            `GRANT SELECT ON public.strategies TO anon`. GRANT 1 fires first on
  --            that grant, because a table-level SELECT covers api_key_id, so this
  --            arm is observed with GRANT 1 neutered (GRAMMAR Shape 2).
  -- RED-UNDER-M: {"arm":"GRANT 2","apply":[{"kind":"sql","stmt":"GRANT SELECT ON public.strategies TO anon"}],"neuter":[{"arm":"GRANT 1"}]}
  IF has_table_privilege('anon', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 2): anon holds table-level SELECT on public.strategies. A table-level privilege covers every column, including every column a later migration adds. Revoke it and grant anon column-level SELECT instead.';
  END IF;

  -- ===== ARM GRANT 3 — anon can SELECT every column it should ===========
  SELECT count(*) INTO v_total
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'api_key_id' AND NOT (a.attname = ANY (v_hidden_column_exemptions));
  IF v_total = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 3-SETUP): public.strategies shows no column other than api_key_id and the HIDDEN_COLUMN_EXEMPTIONS entries, so a sweep for columns anon cannot read would pass without having looked at any column. Check this gate''s apply list.';
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO v_ungranted
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'api_key_id' AND NOT (a.attname = ANY (v_hidden_column_exemptions))
     AND NOT has_column_privilege('anon', v_rel, a.attnum, 'SELECT');
  -- RED-UNDER: take one public column away from anon —
  --            `REVOKE SELECT (name) ON public.strategies FROM anon` — the shape of
  --            a column added later and never granted: anon cannot read it.
  -- RED-UNDER-M: {"arm":"GRANT 3","apply":[{"kind":"sql","stmt":"REVOKE SELECT (name) ON public.strategies FROM anon"}]}
  IF v_ungranted IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 3): anon cannot SELECT public.strategies column(s): %. Since migration 20261022120000 every strategies column is anon-invisible until it is granted. Decide for each: either grant it to anon in the migration that added it (GRANT SELECT (<column>) ON public.strategies TO anon), or add it to HIDDEN_COLUMN_EXEMPTIONS in this gate with a reason, which records that anon must not see it.', v_ungranted;
  END IF;

  -- ===== ARM GRANT 4 — the grant layer refuses a real anon read =========
  -- ⛔ The handlers record state and the SQLSTATE and nothing else. The assertions are
  -- read AFTER RESET ROLE: probing inside an exception handler is lint rule R1, and a
  -- probe that runs as the denied role measures the wrong thing.
  SET LOCAL ROLE anon;
  v_state_key := NULL;
  v_sqlstate_key := NULL;
  v_msg_key := NULL;
  BEGIN
    PERFORM api_key_id FROM public.strategies LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_state_key := 'denied';
    v_sqlstate_key := SQLSTATE;
    v_msg_key := SQLERRM;
  END;
  v_state_ok := NULL;
  v_sqlstate_ok := NULL;
  BEGIN
    PERFORM id, name, status FROM public.strategies LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_state_ok := 'denied';
    v_sqlstate_ok := SQLSTATE;
  END;
  RESET ROLE;

  -- RED-UNDER: hand the column back on the live lane —
  --            `GRANT SELECT (api_key_id) ON public.strategies TO anon`. GRANT 1
  --            fires first on that grant, so this arm is observed with GRANT 1
  --            neutered (GRAMMAR Shape 2): the read then SUCCEEDS and the
  --            behavioural arm is what names it, which proves the catalogue read
  --            and the real statement agree.
  -- RED-UNDER-M: {"arm":"GRANT 4","apply":[{"kind":"sql","stmt":"GRANT SELECT (api_key_id) ON public.strategies TO anon"}],"neuter":[{"arm":"GRANT 1"}]}
  IF v_state_key IS DISTINCT FROM 'denied' OR v_sqlstate_key IS DISTINCT FROM '42501' OR v_msg_key NOT LIKE '%strategies%' THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 4): an anon read of public.strategies.api_key_id was % (SQLSTATE %, message %), expected a 42501 refusal naming strategies. Row security was never consulted for the column: it is refused or allowed at the grant layer alone, and this is the statement a visitor holding the publishable key would issue.', COALESCE(v_state_key, 'permitted'), COALESCE(v_sqlstate_key, 'none'), COALESCE(v_msg_key, 'none');
  END IF;
  IF v_state_ok IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 4): an anon read of public.strategies (id, name, status) was refused (SQLSTATE %), expected it to succeed. The revoke went further than api_key_id and every anonymous reader of the published columns is down.', v_sqlstate_ok;
  END IF;

  -- ===== ARM WRITE 1 — anon holds no table-level INSERT, UPDATE or DELETE
  SELECT string_agg(vb.verb, ', ' ORDER BY vb.verb) INTO v_write_tbl
    FROM unnest(ARRAY['INSERT','UPDATE','DELETE']) AS vb(verb)
   WHERE has_table_privilege('anon', v_rel, vb.verb);
  -- RED-UNDER: hand one write back on the live lane —
  --            `GRANT DELETE ON public.strategies TO anon` — RLS is then the single
  --            layer between a visitor holding the publishable key and a write.
  -- RED-UNDER-M: {"arm":"WRITE 1","apply":[{"kind":"sql","stmt":"GRANT DELETE ON public.strategies TO anon"}]}
  IF v_write_tbl IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (WRITE 1): anon holds table-level (verbs) % on public.strategies. No code path writes strategies as anon; with the grant standing, row-level security is the only layer between a visitor holding the publishable key and a write. Revoke it at the grant layer.', v_write_tbl;
  END IF;

  -- ===== ARM WRITE 2 — anon holds no column-level INSERT or UPDATE ======
  -- RED-UNDER: hand a column-level write back —
  --            `GRANT UPDATE (name) ON public.strategies TO anon`. A table-level
  --            sweep (WRITE 1) cannot see a column grant, which is why this arm
  --            reads has_any_column_privilege.
  -- RED-UNDER-M: {"arm":"WRITE 2","apply":[{"kind":"sql","stmt":"GRANT UPDATE (name) ON public.strategies TO anon"}]}
  IF has_any_column_privilege('anon', v_rel, 'INSERT') OR has_any_column_privilege('anon', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (WRITE 2): anon holds a column-level INSERT or UPDATE on public.strategies (insert=% update=%). A column-level write grant is invisible to a table-level check. Revoke it at the grant layer.', has_any_column_privilege('anon', v_rel, 'INSERT'), has_any_column_privilege('anon', v_rel, 'UPDATE');
  END IF;

  -- ===== ARM KEEP 1 — the revoke removed anon's grants and nobody else's =
  SELECT string_agg(r.rolname || '/' || vb.verb, ', ' ORDER BY r.rolname, vb.verb) INTO v_missing
    FROM (VALUES ('authenticated'), ('service_role')) AS r(rolname)
         CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS vb(verb)
   WHERE NOT has_table_privilege(r.rolname, v_rel, vb.verb);
  -- RED-UNDER: take a verb from authenticated —
  --            `REVOKE UPDATE ON public.strategies FROM authenticated` — the shape of
  --            a REVOKE widened to a role it was not written for.
  -- RED-UNDER-M: {"arm":"KEEP 1","apply":[{"kind":"sql","stmt":"REVOKE UPDATE ON public.strategies FROM authenticated"}]}
  IF v_missing IS NOT NULL OR NOT has_column_privilege('authenticated', v_rel, 'api_key_id', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (KEEP 1): a role lost a privilege it must keep on public.strategies (missing role/verb: %; authenticated SELECT on api_key_id: %). The owner and admin readers select api_key_id as authenticated and the Python service writes it as service_role; the revoke removes anon''s grants and nobody else''s.', COALESCE(v_missing, 'none'), has_column_privilege('authenticated', v_rel, 'api_key_id', 'SELECT');
  END IF;

  RAISE NOTICE 'strategies anon grants OK: anon cannot SELECT api_key_id (GRANT 1, GRANT 4) or hold table-level SELECT (GRANT 2), can SELECT every other column outside HIDDEN_COLUMN_EXEMPTIONS (GRANT 3), holds no table-level (WRITE 1) or column-level (WRITE 2) INSERT, UPDATE or DELETE, and authenticated and service_role keep their privileges (KEEP 1).';
END $$;

ROLLBACK;
