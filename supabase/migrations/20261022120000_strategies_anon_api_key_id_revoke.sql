-- Migration: anon can no longer read public.strategies.api_key_id, and anon loses
-- the INSERT, UPDATE and DELETE grants it never uses on public.strategies —
-- Phase 170.6.1.1 ANONKEYID (PR-B, plan 05).
--
-- Why this migration exists
-- -------------------------
-- A key id is the handle that targets an exchange key (167.1.2.1 D-18). Row-level
-- security decides WHICH strategies an anonymous visitor sees (the published ones)
-- but never WHICH COLUMNS of them, so the grant layer is the only column control.
-- Measured read-only on PROD on 2026-10-13, marker query first: anon held the table
-- level privileges DELETE, INSERT, REFERENCES, SELECT and UPDATE on public.strategies
-- (all five ACL entries granted by postgres, none to PUBLIC), could SELECT all 32
-- columns, api_key_id included, and the 3 published strategies all carried a key id.
-- Booked as TODOS [170.6.1-ANON-STRATEGIES-API-KEY-ID]. anon's write grants are the
-- same defect one verb over: RLS is then the single layer standing between a visitor
-- holding the publishable key and a write, and no code path writes strategies as anon.
--
-- O-1: THE READERS WERE NARROWED AND DEPLOYED FIRST (PR-A)
-- --------------------------------------------------------
-- After this migration any anon query that selects * or names api_key_id answers
-- 42501. PR-A narrowed every anonymous strategies reader to STRATEGY_PUBLIC_COLUMNS
-- (src/lib/constants.ts) and was confirmed live on production before PR-B was
-- opened. APPLYING THIS MIGRATION BEFORE THAT DEPLOY IS LIVE IS THE OUTAGE O-1
-- EXISTS TO PREVENT: a migration applies to PROD on the merge push in parallel with
-- the Vercel build, and an old select("*") reader would take /browse, /strategy/[id],
-- the tearsheet and / down with it.
--
-- The grant shape (D-03) and the SEC-005 precedent
-- ------------------------------------------------
--   1. REVOKE SELECT, INSERT, UPDATE and DELETE on the TABLE from anon.
--   2. GRANT SELECT (<every column except api_key_id>) on the table to anon.
-- A column-level REVOKE SELECT (api_key_id) alone is a SILENT NO-OP while the table
-- level SELECT stands, because a table-level privilege covers every column. This is
-- the shape migration 20260410225608 (SEC-005) took for api_keys, and it records the
-- same trap ("the same bug that broke migrations 012 and 017"). Revoking a
-- table-level privilege also revokes that privilege's column-level grants on every
-- column of the table, which is how D-04's "table and column level" is met; the
-- self-check proves it with has_any_column_privilege.
--
-- The 31 PROD columns anon keeps SELECT on (mirrors STRATEGY_PUBLIC_COLUMNS_ARR in
-- src/lib/constants.ts, in table order): id, user_id, category_id, name,
-- description, strategy_types, subtypes, markets, supported_exchanges,
-- leverage_range, avg_daily_turnover, aum, max_capacity, start_date, status,
-- is_example, benchmark, created_at, review_note, organization_id, disclosure_tier,
-- public_contact_email, tenant_id, codename, partner_tag, source, fingerprint,
-- wizard_session_id, returns_denominator_config, asset_class, capital_ownership.
-- The column list is NOT typed into the GRANT. It is DERIVED from pg_attribute at
-- apply time (attnum > 0, not dropped, not api_key_id): the sql-mutation pg-lane
-- builds strategies from fixtures with far fewer columns than PROD, so a typed
-- 31-column GRANT would fail there with `column does not exist`. The derivation
-- grants exactly the 31 columns above on TEST and PROD and the fixture's own columns
-- on the pg-lane.
--
-- DEFAULT-DENY (W5): from this migration on, a strategies column added by a LATER
-- migration is ANON-INVISIBLE until a migration grants it SELECT to anon. There is no
-- default ACL that carries a new column to anon any more (the table-level grant that
-- did is gone). The SQL gate supabase/tests/test_strategies_anon_grants.sql arm
-- GRANT 3 goes RED on such a column until its author does ONE of two things: (1) grant
-- the column to anon in the migration that added it, or (2) add it to that gate's
-- HIDDEN_COLUMN_EXEMPTIONS list with a reason, which records "anon must NOT see this"
-- as a decision instead of an accident. The list is empty today.
--
-- What is deliberately NOT changed
-- --------------------------------
--   * REFERENCES stays with anon: the phase boundary is two grant changes, and
--     REFERENCES neither reads nor writes a row.
--   * authenticated and service_role keep every grant they hold on strategies,
--     api_key_id included (the owner and admin readers select it, and the Python
--     service writes it). The self-check proves their SELECT, INSERT, UPDATE and
--     DELETE did not move.
--   * No RLS policy, no column and no published gate is touched.
--
-- Caller impact
-- -------------
-- Plan 01's census: census A (the four wildcard anon readers: getStrategiesByCategory,
-- getPublicStrategyDetail, getFactsheetDetail and the landing head-count) is narrowed
-- to STRATEGY_PUBLIC_COLUMNS or "id" in PR-A; census B (getStrategyDetailV2,
-- getPercentiles, getPopulatedCategorySlugs, the OG route, the factsheet v2
-- generateMetadata and Lane A, the tearsheet's readReturnsUnit) already names explicit
-- columns without api_key_id. Every one of them runs as a signed-out visitor in
-- src/lib/anon-strategies-live-probe.test.ts. Callers that are authenticated or use
-- the service role, and SECURITY DEFINER functions, are not affected by an anon grant.
--
-- ⛔ THE REVOKE IS SILENT WHEN IT DOES NOTHING. REVOKE removes only grants made by the
-- current user or by a role it is a member of, and on a grantor mismatch it prints
-- REVOKE, exits 0 and the privilege survives (MEASURED 2026-09-12 on PostgreSQL 16.13,
-- migration 20260911130000). Every anon ACL entry on strategies on PROD has grantor
-- postgres, so this is a guard and not a live fault, but a statement that cannot fail
-- loudly is not a proof. So the REVOKE, the GRANT and their proof live in ONE DO
-- block: after the statements, has_table_privilege, has_column_privilege and
-- has_any_column_privilege (which also count PUBLIC grants and role inheritance) are
-- asked, and each failure raises `migration 20261022120000 failed: ...` and aborts the
-- apply. One DO block is one statement, so it is atomic even under a lane that
-- replays each migration file in autocommit.
--
-- ⛔ DELIBERATELY NO DATA-READING STEP. The block reads pg_attribute and the
-- has_*_privilege functions and NOTHING else. No row of any table is read, so the
-- schema-only shared TEST database behaves exactly like PROD. A guard that counted
-- rows could refuse on an empty TEST and thereby block the PROD apply
-- ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]).
--
-- Rollback: supabase/migrations/down/20261022120000-rollback.sql restores the table
-- level grants anon held. It is a manual file, off the auto-apply path.

-- --------------------------------------------------------------------------
-- STEP 1: revoke, column grant and catalogue self-check, one DO block
-- --------------------------------------------------------------------------
DO $verify$
DECLARE
  v_rel     regclass := 'public.strategies'::regclass;
  v_verbs   text[]   := ARRAY['SELECT','INSERT','UPDATE','DELETE'];
  v_roles   text[]   := ARRAY['authenticated','service_role'];
  v_before  text;
  v_after   text;
  v_cols    text;
  v_missing text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = v_rel AND a.attname = 'api_key_id' AND a.attnum > 0 AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: public.strategies has no api_key_id column; this migration is running against the wrong shape';
  END IF;

  -- (1) What authenticated and service_role hold before any change. A sorted
  -- role/verb string, so the comparison below is one equality.
  SELECT string_agg(r.rolname || '/' || v.verb, ',' ORDER BY r.rolname, v.verb) INTO v_before
    FROM unnest(v_roles) AS r(rolname) CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE has_table_privilege(r.rolname, v_rel, v.verb);

  -- (2) anon loses the table-level privileges (and, with them, every column-level
  -- grant of the same verbs). REFERENCES is not named, so it stays.
  REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLE public.strategies FROM anon;

  -- (3) anon gets column SELECT on every column but api_key_id, derived from the
  -- catalogue so the column set is whatever the table holds at apply time.
  SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY a.attnum) INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'api_key_id';
  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: public.strategies has no column other than api_key_id to grant anon';
  END IF;
  EXECUTE format('GRANT SELECT (%s) ON TABLE public.strategies TO anon', v_cols);

  -- (4) Self-check. Each test reads the effective privilege, PUBLIC grants and role
  -- inheritance included.
  IF has_column_privilege('anon', v_rel, 'api_key_id', 'SELECT') THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: anon can still SELECT public.strategies.api_key_id. REVOKE removes only grants made by the current user or a role it is a member of and prints nothing on a grantor mismatch (MEASURED, 20260911130000); find the grantor with aclexplode(relacl) and re-run the REVOKE under SET ROLE <grantor>, or look for a PUBLIC grant';
  END IF;

  IF has_table_privilege('anon', v_rel, 'SELECT') THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: anon still holds table-level SELECT on public.strategies (a table-level privilege covers every column, api_key_id included)';
  END IF;

  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO v_missing
    FROM pg_attribute a
   WHERE a.attrelid = v_rel AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'api_key_id'
     AND NOT has_column_privilege('anon', v_rel, a.attnum, 'SELECT');
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: anon lost SELECT on public.strategies column(s): %', v_missing;
  END IF;

  IF has_table_privilege('anon', v_rel, 'INSERT')
     OR has_table_privilege('anon', v_rel, 'UPDATE')
     OR has_table_privilege('anon', v_rel, 'DELETE') THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: anon still holds a table-level INSERT, UPDATE or DELETE on public.strategies';
  END IF;

  IF has_any_column_privilege('anon', v_rel, 'INSERT') OR has_any_column_privilege('anon', v_rel, 'UPDATE') THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: anon still holds a column-level INSERT or UPDATE on public.strategies';
  END IF;

  -- authenticated and service_role: not a single table-level privilege moved.
  SELECT string_agg(r.rolname || '/' || v.verb, ',' ORDER BY r.rolname, v.verb) INTO v_after
    FROM unnest(v_roles) AS r(rolname) CROSS JOIN unnest(v_verbs) AS v(verb)
   WHERE has_table_privilege(r.rolname, v_rel, v.verb);
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'migration 20261022120000 failed: authenticated/service_role table privileges on public.strategies moved (before: %, after: %)', v_before, v_after;
  END IF;
END
$verify$;
