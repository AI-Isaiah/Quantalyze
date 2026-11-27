-- Test: anon cannot read public.strategy_analytics.metrics_json_by_basis and holds no
-- write privilege on public.strategy_analytics (Phase 243 DBBACKSTOP, plan 09, DBACC-01
-- half (b)).
--
-- WHY THIS FILE EXISTS. Row-level security decides WHICH strategy_analytics rows an
-- anonymous visitor sees (those of published strategies) and never WHICH COLUMNS of
-- them, so the grant layer is the only column control. Migration 20261127220000 takes
-- anon's table-level SELECT, INSERT, UPDATE and DELETE on public.strategy_analytics and
-- grants anon column SELECT on every column but metrics_json_by_basis. Its own DO block
-- proves that state once, at apply. This gate re-reads it on every run, so a later
-- migration that hands the column or a write back to anon, or that adds a column
-- without deciding whether anon may read it, goes RED here instead of shipping.
--
-- THE SEVEN ARMS, and why each needs the others:
--   GRANT 1  anon cannot SELECT metrics_json_by_basis (has_column_privilege, so a
--            table-level grant, a PUBLIC grant and role inheritance all count).
--   GRANT 2  anon holds no table-level SELECT. A table-level SELECT reaches
--            metrics_json_by_basis (GRANT 1 sees that) and also every column a later
--            migration adds; this arm names the table-level grant itself.
--   GRANT 3  every non-dropped column other than metrics_json_by_basis and the
--            HIDDEN_COLUMN_EXEMPTIONS entries lets anon SELECT, and at least one such
--            column exists (GRANT 3-SETUP), so the arm cannot pass on an empty set.
--   GRANT 4  behavioural: as anon, `metrics_json_by_basis -> 'cash_settlement'` is
--            refused with SQLSTATE 42501 naming strategy_analytics (a column privilege
--            covers every expression over the column, so a path read is refused too),
--            and a read of strategy_id, computed_at is not refused. The catalogue arms
--            and the real statement must agree.
--   WRITE 1  anon holds no table-level INSERT, UPDATE or DELETE.
--   WRITE 2  anon holds no column-level INSERT or UPDATE (has_any_column_privilege).
--   KEEP 1   authenticated holds table-level SELECT (the owner pages read the whole
--            column through the user client) and service_role holds SELECT, INSERT,
--            UPDATE and DELETE (the analytics writer). authenticated's write grants are
--            deliberately NOT pinned, so a later phase may narrow them without editing
--            this gate. The revoke removed exactly anon's grants, not "everything".
--
-- ⛔ NO SKIP-WHEN-UNAPPLIED BRANCH. If migration 20261127220000 is absent anon still
-- holds the table SELECT and GRANT 1 fails. That is the right reading: a gate that
-- skipped when its migration was missing would pass on exactly the database it exists
-- to catch.
--
-- DEFAULT-DENY AND HIDDEN_COLUMN_EXEMPTIONS. Since migration 20261127220000 a
-- strategy_analytics column added by a LATER migration is anon-invisible until a
-- migration grants it SELECT to anon. GRANT 3 goes RED on such a column. Its author has
-- two remedies: grant the column to anon in the migration that added it, or add it to
-- the HIDDEN_COLUMN_EXEMPTIONS array below with a reason beside it, which records "anon
-- must NOT see this" as a decision instead of an accident. The list is EMPTY today.
--
-- ⛔ FIXTURES. The sql-mutation pg-lane builds strategy_analytics from fixtures, and
-- which fixture grants what decides whether this gate reproduces today's PROD grants.
-- 03-fixture-compute-jobs.sql creates the fixture-sized table (no
-- metrics_json_by_basis, no grants); 45-fixture-strategy-analytics-by-basis.sql adds the
-- column and PROD's table-level client grants, which is what makes "RED without the
-- migration" real: with it and without the migration anon holds the table SELECT, so
-- GRANT 1 fails. The gate reads "every non-dropped column other than
-- metrics_json_by_basis", never a typed column list, so it reads the same on the
-- pg-lane, the local-stack lane and any other catalogue.
--
-- This file reads only the catalogue plus one behavioural probe, because the lanes
-- that run it carry different catalogues. It runs inside BEGIN ... ROLLBACK.
--
-- ⭐ MACHINE-EXECUTABLE TWINS. Each prose RED-UNDER below carries an adjacent
-- RED-UNDER-M object that scripts/mutation-runner executes (schema in
-- scripts/mutation-runner/GRAMMAR.md). Every twin is a `sql` step: a grant change on
-- the live lane after the setup list, so no file is edited. The setup list is what the
-- lane applies before this gate, in order: 01 core fixture, 02 sanitize tables, 03
-- compute-jobs fixture (strategy_analytics), 45 the by-basis column and PROD's grants,
-- then the migration LAST, so scripts/sql-gate-subset.mjs selects this gate on a push
-- that changes the migration.
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","scripts/pg-lane/fixtures/45-fixture-strategy-analytics-by-basis.sql","supabase/migrations/20261127220000_strategy_analytics_anon_column_revoke.sql"]}
--
-- Usage:
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_strategy_analytics_anon_grants.sql

BEGIN;

DO $$
DECLARE
  v_rel         regclass := 'public.strategy_analytics'::regclass;
  -- HIDDEN_COLUMN_EXEMPTIONS: strategy_analytics columns deliberately hidden from anon
  -- besides metrics_json_by_basis. EMPTY today. Each entry must carry a reason beside it,
  -- as a comment on its own line (for example: 'internal_notes', -- reason: staff-only).
  v_hidden_column_exemptions TEXT[] := ARRAY[]::TEXT[];
  v_ungranted   TEXT;
  v_total       INTEGER;
  v_write_tbl   TEXT;
  v_missing     TEXT;
  v_state_key   TEXT;
  v_sqlstate_key TEXT;
  v_msg_key     TEXT;
  v_state_ok    TEXT;
  v_sqlstate_ok TEXT;
BEGIN
  -- ===== ARM GRANT 1 — anon cannot SELECT metrics_json_by_basis =========
  -- RED-UNDER: hand the column back to anon on the live lane —
  --            `GRANT SELECT (metrics_json_by_basis) ON public.strategy_analytics TO anon`.
  --            That is what a later migration re-granting the column would look like,
  --            and the catalogue read must name it as the first failure.
  -- RED-UNDER-M: {"arm":"GRANT 1","apply":[{"kind":"sql","stmt":"GRANT SELECT (metrics_json_by_basis) ON public.strategy_analytics TO anon"}]}
  IF has_column_privilege('anon', v_rel, 'metrics_json_by_basis', 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 1): anon can SELECT public.strategy_analytics.metrics_json_by_basis. The column carries whole per-basis series and writer-shaped keys, and row-level security never restricts columns, so the grant layer is the only control. Revoke the table-level SELECT and grant anon SELECT on every column but metrics_json_by_basis (migration 20261127220000 is the model); if a REVOKE printed nothing and changed nothing, the grantor is another role, so find it with aclexplode(relacl).';
  END IF;

  -- ===== ARM GRANT 2 — anon holds no table-level SELECT =================
  -- RED-UNDER: hand the table-level privilege back —
  --            `GRANT SELECT ON public.strategy_analytics TO anon`. GRANT 1 fires first
  --            on that grant, because a table-level SELECT covers
  --            metrics_json_by_basis, so this arm is observed with GRANT 1 neutered
  --            (GRAMMAR Shape 2).
  -- RED-UNDER-M: {"arm":"GRANT 2","apply":[{"kind":"sql","stmt":"GRANT SELECT ON public.strategy_analytics TO anon"}],"neuter":[{"arm":"GRANT 1"}]}
  IF has_table_privilege('anon', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 2): anon holds table-level SELECT on public.strategy_analytics. A table-level privilege covers every column, including every column a later migration adds. Revoke it and grant anon column-level SELECT instead.';
  END IF;

  -- ===== ARM GRANT 3 — anon can SELECT every column it should ===========
  SELECT count(*) INTO v_total
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'metrics_json_by_basis' AND NOT (a.attname = ANY (v_hidden_column_exemptions));
  IF v_total = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 3-SETUP): public.strategy_analytics shows no column other than metrics_json_by_basis and the HIDDEN_COLUMN_EXEMPTIONS entries, so a sweep for columns anon cannot read would pass without having looked at any column. Check this gate''s apply list.';
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO v_ungranted
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname <> 'metrics_json_by_basis' AND NOT (a.attname = ANY (v_hidden_column_exemptions))
     AND NOT has_column_privilege('anon', v_rel, a.attnum, 'SELECT');
  -- RED-UNDER: take one public column away from anon —
  --            `REVOKE SELECT (computed_at) ON public.strategy_analytics FROM anon` — the
  --            shape of a column added later and never granted: anon cannot read it.
  -- RED-UNDER-M: {"arm":"GRANT 3","apply":[{"kind":"sql","stmt":"REVOKE SELECT (computed_at) ON public.strategy_analytics FROM anon"}]}
  IF v_ungranted IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 3): anon cannot SELECT public.strategy_analytics column(s): %. Since migration 20261127220000 every strategy_analytics column is anon-invisible until it is granted. Decide for each: either grant it to anon in the migration that added it (GRANT SELECT (<column>) ON public.strategy_analytics TO anon), or add it to HIDDEN_COLUMN_EXEMPTIONS in this gate with a reason, which records that anon must not see it.', v_ungranted;
  END IF;

  -- ===== ARM GRANT 4 — the grant layer refuses a real anon read =========
  -- ⛔ The handlers record state, SQLSTATE and message and nothing else. The assertions
  -- are read AFTER RESET ROLE: probing inside an exception handler is lint rule R1, and
  -- a probe that runs as the denied role measures the wrong thing.
  SET LOCAL ROLE anon;
  v_state_key := NULL;
  v_sqlstate_key := NULL;
  v_msg_key := NULL;
  BEGIN
    PERFORM metrics_json_by_basis -> 'cash_settlement' FROM public.strategy_analytics LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_state_key := 'denied';
    v_sqlstate_key := SQLSTATE;
    v_msg_key := SQLERRM;
  END;
  v_state_ok := NULL;
  v_sqlstate_ok := NULL;
  BEGIN
    PERFORM strategy_id, computed_at FROM public.strategy_analytics LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_state_ok := 'denied';
    v_sqlstate_ok := SQLSTATE;
  END;
  RESET ROLE;

  -- RED-UNDER: hand the column back on the live lane —
  --            `GRANT SELECT (metrics_json_by_basis) ON public.strategy_analytics TO anon`.
  --            GRANT 1 fires first on that grant, so this arm is observed with GRANT 1
  --            neutered (GRAMMAR Shape 2): the path read then SUCCEEDS and the
  --            behavioural arm is what names it, which proves the catalogue read and
  --            the real statement agree.
  -- RED-UNDER-M: {"arm":"GRANT 4","apply":[{"kind":"sql","stmt":"GRANT SELECT (metrics_json_by_basis) ON public.strategy_analytics TO anon"}],"neuter":[{"arm":"GRANT 1"}]}
  IF v_state_key IS DISTINCT FROM 'denied' OR v_sqlstate_key IS DISTINCT FROM '42501' OR v_msg_key NOT LIKE '%strategy_analytics%' THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 4): an anon read of public.strategy_analytics.metrics_json_by_basis -> ''cash_settlement'' was % (SQLSTATE %, message %), expected a 42501 refusal naming strategy_analytics. Row security was never consulted for the column: it is refused or allowed at the grant layer alone, and this is the statement a visitor holding the publishable key would issue.', COALESCE(v_state_key, 'permitted'), COALESCE(v_sqlstate_key, 'none'), COALESCE(v_msg_key, 'none');
  END IF;
  IF v_state_ok IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (GRANT 4): an anon read of public.strategy_analytics (strategy_id, computed_at) was refused (SQLSTATE %), expected it to succeed. The revoke went further than metrics_json_by_basis and every anonymous reader of the other columns is down.', v_sqlstate_ok;
  END IF;

  -- ===== ARM WRITE 1 — anon holds no table-level INSERT, UPDATE or DELETE
  SELECT string_agg(vb.verb, ', ' ORDER BY vb.verb) INTO v_write_tbl
    FROM unnest(ARRAY['INSERT','UPDATE','DELETE']) AS vb(verb)
   WHERE has_table_privilege('anon', v_rel, vb.verb);
  -- RED-UNDER: hand one write back on the live lane —
  --            `GRANT DELETE ON public.strategy_analytics TO anon` — RLS is then the
  --            single layer between a visitor holding the publishable key and a write.
  -- RED-UNDER-M: {"arm":"WRITE 1","apply":[{"kind":"sql","stmt":"GRANT DELETE ON public.strategy_analytics TO anon"}]}
  IF v_write_tbl IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (WRITE 1): anon holds table-level (verbs) % on public.strategy_analytics. No code path writes strategy_analytics as anon; with the grant standing, row-level security is the only layer between a visitor holding the publishable key and a write. Revoke it at the grant layer.', v_write_tbl;
  END IF;

  -- ===== ARM WRITE 2 — anon holds no column-level INSERT or UPDATE ======
  -- RED-UNDER: hand a column-level write back —
  --            `GRANT UPDATE (computed_at) ON public.strategy_analytics TO anon`. A
  --            table-level sweep (WRITE 1) cannot see a column grant, which is why this
  --            arm reads has_any_column_privilege.
  -- RED-UNDER-M: {"arm":"WRITE 2","apply":[{"kind":"sql","stmt":"GRANT UPDATE (computed_at) ON public.strategy_analytics TO anon"}]}
  IF has_any_column_privilege('anon', v_rel, 'INSERT') OR has_any_column_privilege('anon', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'TEST FAILED (WRITE 2): anon holds a column-level INSERT or UPDATE on public.strategy_analytics (insert=% update=%). A column-level write grant is invisible to a table-level check. Revoke it at the grant layer.', has_any_column_privilege('anon', v_rel, 'INSERT'), has_any_column_privilege('anon', v_rel, 'UPDATE');
  END IF;

  -- ===== ARM KEEP 1 — the revoke removed anon's grants and nobody else's =
  SELECT string_agg(r.rolname || '/' || r.verb, ', ' ORDER BY r.rolname, r.verb) INTO v_missing
    FROM (VALUES ('authenticated', 'SELECT'),
                 ('service_role', 'SELECT'), ('service_role', 'INSERT'),
                 ('service_role', 'UPDATE'), ('service_role', 'DELETE')) AS r(rolname, verb)
   WHERE NOT has_table_privilege(r.rolname, v_rel, r.verb);
  -- RED-UNDER: take table-level SELECT from authenticated —
  --            `REVOKE SELECT ON public.strategy_analytics FROM authenticated` — the shape
  --            of a REVOKE widened to a role it was not written for; the owner pages
  --            would then lose their whole-column read.
  -- RED-UNDER-M: {"arm":"KEEP 1","apply":[{"kind":"sql","stmt":"REVOKE SELECT ON public.strategy_analytics FROM authenticated"}]}
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (KEEP 1): a role lost a table-level privilege it must keep on public.strategy_analytics (missing role/verb: %). The owner pages read the whole column as authenticated and the analytics service writes it as service_role; the revoke removes anon''s grants and nobody else''s.', v_missing;
  END IF;

  RAISE NOTICE 'ALL 7 ARMS EXECUTED (GRANT 1, GRANT 2, GRANT 3, GRANT 4, WRITE 1, WRITE 2, KEEP 1): anon cannot SELECT metrics_json_by_basis (GRANT 1, GRANT 4) or hold table-level SELECT (GRANT 2), can SELECT every other column outside HIDDEN_COLUMN_EXEMPTIONS (GRANT 3), holds no table-level (WRITE 1) or column-level (WRITE 2) INSERT, UPDATE or DELETE, and authenticated keeps table-level SELECT and service_role its four write-path privileges (KEEP 1).';
  RAISE NOTICE 'strategy_analytics anon grants OK.';
END $$;

ROLLBACK;
