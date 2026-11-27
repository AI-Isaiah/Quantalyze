-- Migration: anon can no longer read public.strategy_analytics.metrics_json_by_basis,
-- and anon loses the INSERT, UPDATE and DELETE grants it never uses on
-- public.strategy_analytics -- Phase 243 DBBACKSTOP, plan 09 (PR-B), DBACC-01 half (b).
--
-- Why this migration exists
-- -------------------------
-- metrics_json_by_basis holds one object per return basis, and a basis object carries
-- whole series and the writer-shaped per-basis keys the analytics stage emits (see
-- src/lib/factsheet/by-basis-projection.ts). Row-level security decides WHICH
-- strategy_analytics rows an anonymous visitor sees (those of published strategies)
-- but never WHICH COLUMNS of them, so the grant layer is the only column control.
-- Whatever the analytics stage writes into the column was readable by an anonymous
-- visitor of a published strategy with no review step. Booked as TODOS RANK-SPLAT-01
-- (DBACC-01). A column privilege covers EVERY expression over the column, so this
-- grant layer refuses a whole-column read, a `metrics_json_by_basis->'k'` path read
-- and an alias projection of it alike. The payload builder reads the column through
-- its 21 pinned `->` aliases (BY_BASIS_ALIASES) as the service role, which this
-- migration does not touch.
-- anon's write grants are the same defect one verb over: RLS is then the single
-- layer between a visitor holding the publishable key and a write, and no code path
-- writes strategy_analytics as anon (plan 09's census).
--
-- O-1: THE READER WAS MOVED AND DEPLOYED FIRST (PR-A)
-- ---------------------------------------------------
-- After this migration any anon query that selects * from strategy_analytics or names
-- metrics_json_by_basis answers 42501. The one anon reader the census found, the OG
-- route (src/app/api/og/factsheet/[id]/route.tsx), was moved by PR-A onto an admin
-- read of the named aliases, and PR-A was confirmed live on production before this
-- file was written. APPLYING THIS MIGRATION BEFORE THAT DEPLOY IS LIVE IS THE OUTAGE
-- O-1 EXISTS TO PREVENT: a migration applies to PROD on the merge push in parallel
-- with the Vercel build.
--
-- The grant shape and the precedent
-- ---------------------------------
--   1. REVOKE SELECT, INSERT, UPDATE and DELETE on the TABLE from anon.
--   2. GRANT SELECT (<every column except metrics_json_by_basis>) on the table to anon.
-- A column-level REVOKE SELECT (metrics_json_by_basis) alone is a SILENT NO-OP while
-- the table-level SELECT stands, because a table-level privilege covers every column.
-- This is the shape migration 20261022120000 (strategies.api_key_id) took, and
-- 20260410225608 (SEC-005) before it. Revoking a table-level privilege also revokes
-- that privilege's column-level grants on every column of the table; the self-check
-- proves it with has_any_column_privilege.
-- The column list is NOT typed into the GRANT. It is DERIVED from pg_attribute
-- (attnum > 0, not dropped, not metrics_json_by_basis) at apply time, so it grants
-- exactly PROD's other columns on TEST and PROD and the fixture's own columns on the
-- pg-lane.
--
-- DEFAULT-DENY: from this migration on, a strategy_analytics column added by a LATER
-- migration is ANON-INVISIBLE until a migration grants it SELECT to anon. There is no
-- default ACL that carries a new column to anon any more (the table-level grant that
-- did is gone). The SQL gate supabase/tests/test_strategy_analytics_anon_grants.sql
-- arm GRANT 3 goes RED on such a column until its author does ONE of two things:
-- (1) grant the column to anon in the migration that added it, or (2) add it to that
-- gate's HIDDEN_COLUMN_EXEMPTIONS list with a reason, which records "anon must NOT see
-- this" as a decision instead of an accident. The list is empty today. Reversibility
-- is therefore costly, and CONTEXT `### DBACC-01` decided it.
--
-- What is deliberately NOT changed
-- --------------------------------
--   * REFERENCES stays with anon: the phase boundary is two grant changes, and
--     REFERENCES neither reads nor writes a row.
--   * authenticated and service_role keep every grant they hold on strategy_analytics
--     (the owner pages read the whole column through the user client, and the Python
--     service writes it as service_role). The self-check proves their SELECT, INSERT,
--     UPDATE and DELETE did not move, and that authenticated can still read the column.
--   * No RLS policy, no column and no published gate is touched.
--
-- KNOWN LIMIT: authenticated keeps table-level SELECT, so a signed-in NON-owner can
-- still read the whole column of a published strategy through the user client. Closing
-- that is deferred in CONTEXT (`## Deferred Ideas`); it is not done here.
--
-- Caller impact
-- -------------
-- Plan 09's census at HEAD: no anon-client code path selects metrics_json_by_basis or
-- strategy_analytics (*): the payload builder and the OG route read it as the
-- service role; the owner pages (getMyStrategies, /strategies, the
-- wizard's SyncPreviewStep) read it as authenticated. No SECURITY INVOKER function
-- that writes strategy_analytics is executable by anon. Callers that are authenticated
-- or use the service role, and SECURITY DEFINER functions, are not affected by an anon
-- grant.
--
-- ⛔ THE REVOKE IS SILENT WHEN IT DOES NOTHING. REVOKE removes only grants made by the
-- current user or by a role it is a member of, and on a grantor mismatch it prints
-- REVOKE, exits 0 and the privilege survives (MEASURED 2026-09-12 on PostgreSQL 16.13,
-- migration 20260911130000). A statement that cannot fail loudly is not a proof. So
-- the REVOKE, the GRANT and their proof live in ONE DO block: after the statements,
-- has_table_privilege, has_column_privilege and has_any_column_privilege (which also
-- count PUBLIC grants and role inheritance) are asked, and each failure raises
-- `migration 20261127220000 failed: ...` and aborts the apply. One DO block is one
-- statement, so it is atomic even under a lane that replays each migration file in
-- autocommit.
--
-- ⛔ DELIBERATELY NO DATA-READING STEP. The block reads pg_attribute and the
-- has_*_privilege functions and NOTHING else. No row of any table is read, so the
-- schema-only shared TEST database behaves exactly like PROD
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] class).
--
-- Rollback: supabase/migrations/down/20261127220000-rollback.sql restores the table
-- level grants anon held. It is a manual file, off the auto-apply path.

-- --------------------------------------------------------------------------
-- STEP 1: revoke, column grant and catalogue self-check, one DO block
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_rel     regclass := 'public.strategy_analytics'::regclass;
  v_verbs   text[]   := ARRAY['SELECT','INSERT','UPDATE','DELETE'];
  v_roles   text[]   := ARRAY['authenticated','service_role'];
  v_before  text;
  v_after   text;
  v_cols    text;
  v_missing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attname = 'metrics_json_by_basis' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: public.strategy_analytics has no metrics_json_by_basis column; this migration is running against the wrong shape';
  END IF;

  -- (1) What authenticated and service_role hold before any change. A sorted
  -- role/verb string, so the comparison below is one equality.
  SELECT string_agg(r.rolname || '/' || v.verb, ',' ORDER BY r.rolname, v.verb) INTO v_before
    FROM unnest(v_roles) AS r(rolname) CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE has_table_privilege(r.rolname, v_rel, v.verb);

  -- (2) anon loses the table-level privileges (and, with them, every column-level
  -- grant of the same verbs). REFERENCES is not named, so it stays.
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.strategy_analytics FROM anon;

  -- (3) anon gets column SELECT on every column but metrics_json_by_basis, derived
  -- from the catalogue so the column set is whatever the table holds at apply time.
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'metrics_json_by_basis';
  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: public.strategy_analytics has no column other than metrics_json_by_basis to grant anon';
  END IF;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.strategy_analytics TO anon', v_cols);

  -- (4) Self-check. Each test reads the effective privilege, PUBLIC grants and role
  -- inheritance included.
  IF has_column_privilege('anon', v_rel, 'metrics_json_by_basis', 'SELECT') THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: anon can still SELECT public.strategy_analytics.metrics_json_by_basis. REVOKE removes only grants made by the current user or a role it is a member of and prints nothing on a grantor mismatch (MEASURED, 20260911130000); find the grantor with aclexplode(relacl) and re-run the REVOKE under SET ROLE <grantor>, or look for a PUBLIC grant';
  END IF;

  IF has_table_privilege('anon', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: anon still holds table-level SELECT on public.strategy_analytics (a table-level privilege covers every column, metrics_json_by_basis included)';
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO v_missing
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'metrics_json_by_basis'
     AND NOT has_column_privilege('anon', v_rel, a.attnum, 'SELECT');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: anon lost SELECT on public.strategy_analytics column(s): %', v_missing;
  END IF;

  IF has_table_privilege('anon', v_rel, 'INSERT')
     OR has_table_privilege('anon', v_rel, 'UPDATE')
     OR has_table_privilege('anon', v_rel, 'DELETE') THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: anon still holds a table-level INSERT, UPDATE or DELETE on public.strategy_analytics';
  END IF;

  IF has_any_column_privilege('anon', v_rel, 'INSERT') OR has_any_column_privilege('anon', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: anon still holds a column-level INSERT or UPDATE on public.strategy_analytics';
  END IF;

  -- authenticated and service_role: not a single table-level privilege moved, and
  -- authenticated still reads the column (the owner pages select it as authenticated).
  SELECT string_agg(r.rolname || '/' || v.verb, ',' ORDER BY r.rolname, v.verb) INTO v_after
    FROM unnest(v_roles) AS r(rolname) CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE has_table_privilege(r.rolname, v_rel, v.verb);
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: authenticated/service_role table privileges on public.strategy_analytics moved (before: %, after: %)', v_before, v_after;
  END IF;

  IF NOT has_column_privilege('authenticated', v_rel, 'metrics_json_by_basis', 'SELECT') THEN
    RAISE EXCEPTION 'migration 20261127220000 failed: authenticated can no longer SELECT public.strategy_analytics.metrics_json_by_basis; the owner pages read it as authenticated';
  END IF;
END
$verify$;
