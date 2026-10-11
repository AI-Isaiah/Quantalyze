-- ============================================================================
-- allocator_holdings: the unique key gains api_key_id, so every key keeps its
-- own row (2026-10-11, Phase 170.4 ALLOCHOLDINGS, plan 09; D-08, D-10)
-- ============================================================================
--
-- What this is for
-- ----------------
-- allocator_holdings carried ONE unique index, allocator_holdings_owner_venue_
-- symbol_asof_key on (allocator_id, venue, symbol, asof), and the analytics
-- worker's persist_allocator_holdings upserted on that same four columns. Two
-- live keys of one allocator on one venue that hold one symbol on one day
-- therefore collapsed into ONE row at ingestion: whichever key polled last
-- overwrote the other's position.
--
-- D-10 (founder 2026-10-11), quoted from the phase CONTEXT: "The index and the
-- upsert's conflict target gain `api_key_id`, so every key keeps its own row.
-- Keys that share one exchange account stay de-duplicated by the existing
-- same-account grouping (167.1.2). This is a migration that auto-applies to PROD
-- on merge, so migration-reviewer and rls-policy-auditor must be clean BEFORE
-- the merge. ... This supersedes the Phase Boundary's 'any change to how
-- holdings are ingested' exclusion for this one key change only."
-- D-08 ("One Key is One Strategy"): holdings from different API keys are never
-- merged. This migration is the database half; the writer half is
-- analytics-service/services/allocator_positions.py (HOLDINGS_CONFLICT_TARGET,
-- plan 08, already deployed), and the one-key-per-account-day rule that keeps
-- one exchange account counted once when two of its keys hold same-day rows is
-- plan 11 (TypeScript and Python twins), also already deployed.
--
-- What it does
-- ------------
--   1. CREATE UNIQUE INDEX allocator_holdings_owner_venue_symbol_asof_api_key_key
--      ON public.allocator_holdings (allocator_id, venue, symbol, asof, api_key_id);
--   2. DROP INDEX public.allocator_holdings_owner_venue_symbol_asof_key;
--   3. COMMENT ON INDEX for the new index, and COMMENT ON TABLE rewritten to say
--      "one row per (allocator_id, venue, symbol, asof, api_key_id)".
-- No policy, grant, trigger, column or function is touched; a catalogue-only
-- snapshot taken at the top is compared at the bottom to prove it.
--
-- Why this cannot fail on existing rows
-- -------------------------------------
-- A unique key extended by a column is unique wherever the narrower key was.
-- If no two rows share (allocator_id, venue, symbol, asof), then no two rows
-- share those four columns PLUS api_key_id either, so CREATE UNIQUE INDEX cannot
-- raise 23505 on data the old index already admitted. api_key_id is NOT NULL (the
-- table definition in 20260420073003), so the extra column adds no NULL-is-
-- distinct hole: the new key is exactly as strict as the old one for any one key
-- and strictly looser only across keys, which is the intent.
-- Measured read-only on PROD on 2026-10-11 as reviewer evidence: 18,301 rows, 0
-- groups holding more than one row under the five-column key, 0 NULL api_key_id.
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION, and no DO block here reads a row.
-- Shared TEST holds PROD's catalogue and none of its data, and a failed TEST
-- apply blocks the PROD apply ([164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]). Every
-- check below is DDL or catalogue-only (scripts/lint-migration-data-dependence.mjs).
--
-- Why the build is NOT concurrent, and why the order is create-then-drop
-- ----------------------------------------------------------------------
-- `supabase db push` wraps each migration in one transaction, and CREATE INDEX
-- CONCURRENTLY cannot run inside a transaction block. A plain build takes a SHARE
-- lock, which blocks writers for the length of the build. At 18,301 rows that is
-- well under a second; SET lock_timeout = '3s' bounds the WAIT for the lock (the
-- build itself is not interrupted by it), so a busy table fails the apply cleanly
-- instead of queueing writers behind an ACCESS EXCLUSIVE request. The new index is
-- created BEFORE the old one is dropped, inside the same transaction, and its four
-- leading columns are the old index's, so no plan is left without an index and the
-- table is never without a uniqueness guard at any instant.
--
-- ⛔⛔ DEPLOY ORDER — THIS IS PR 2 OF THE PHASE. PR 1 carried plan 08's tolerant
-- writer (it upserts on the five-column target and retries once on the old
-- four-column target ONLY when Postgres answers 42P10) and plan 11's one-key-per-
-- account-day rule. PR 1 must be MERGED AND DEPLOYED on Railway before this file
-- merges: merging the index first, with the old writer still deployed, makes every
-- holdings poll answer 42P10 until the new writer is live. Merging
-- supabase/migrations/** to `main` applies to shared TEST and then to PROD with NO
-- human stop, so the order is the control and care at the keyboard is not.
-- Task 1 of plan 09 binds PR 1's merge commit to Railway's /health sha and main CI.
--
-- ROLLBACK (manual, off the auto-apply path):
-- supabase/migrations/down/20261011120000-rollback.sql. It refuses while two keys
-- hold rows for one (allocator_id, venue, symbol, asof), because the four-column
-- index cannot be rebuilt over them without choosing which key's row to lose.
-- Roll the writer back to the four-column target (or leave plan 08's fallback in
-- place, which does exactly that on 42P10) BEFORE or together with the rollback.
--
-- No function is added or redefined, so no SECURITY DEFINER / search_path rule
-- applies and there is no CREATE OR REPLACE to re-base.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────── 0. snapshot — CATALOGUE ONLY, reads no row
-- Policies, table ACL, RLS flags and triggers as they stand before any change,
-- held in a transaction-local setting (set_config(..., true): it dies with this
-- transaction) so the verify block can prove they are byte-unchanged on whatever
-- database this runs on (TEST, PROD, a local lane), with no expectation typed in
-- that a different database could disagree with. A temp table would hold the same
-- text, but a guard reading any table that is not a catalogue is what
-- scripts/lint-migration-data-dependence.mjs refuses.
SELECT set_config('allocator_holdings_per_key.snapshot', (
  SELECT string_agg(kind || ':' || detail, E'\n' ORDER BY kind, detail)
    FROM (
      SELECT 'policy' AS kind,
             p.polname::text || '|' || p.polcmd::text || '|'
               || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|'
               || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || '|'
               || p.polroles::text AS detail
        FROM pg_policy p
       WHERE p.polrelid = 'public.allocator_holdings'::regclass
      UNION ALL
      SELECT 'acl', coalesce(c.relacl::text, '<null>')
        FROM pg_class c WHERE c.oid = 'public.allocator_holdings'::regclass
      UNION ALL
      SELECT 'rls', c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
        FROM pg_class c WHERE c.oid = 'public.allocator_holdings'::regclass
      UNION ALL
      SELECT 'trigger', t.tgname::text || '|' || t.tgtype::text || '|' || t.tgfoid::regproc::text || '|' || t.tgenabled::text
        FROM pg_trigger t
       WHERE t.tgrelid = 'public.allocator_holdings'::regclass AND NOT t.tgisinternal
    ) s
), true);

-- ───────────── 1. the per-key unique index, created BEFORE the old one goes
CREATE UNIQUE INDEX allocator_holdings_owner_venue_symbol_asof_api_key_key
  ON public.allocator_holdings (allocator_id, venue, symbol, asof, api_key_id);

-- ───────────── 2. the four-column index goes (its columns are the new one's leading four)
DROP INDEX public.allocator_holdings_owner_venue_symbol_asof_key;

-- ───────────── 3. COMMENTs
COMMENT ON INDEX public.allocator_holdings_owner_venue_symbol_asof_api_key_key IS
  'Phase 170.4 D-10 (replaces allocator_holdings_owner_venue_symbol_asof_key). The '
  'idempotent-upsert anchor: one row per (allocator_id, venue, symbol, asof, '
  'api_key_id), so two live keys of one allocator on one venue each keep their own '
  'row for one symbol and day (D-08). The analytics worker upserts on exactly these '
  'five columns (services/allocator_positions.py HOLDINGS_CONFLICT_TARGET, pinned '
  'by tests/test_persist_holdings_conflict_target.py). Keys that share one '
  'exchange account are de-duplicated at READ time by the one-key-per-account-day '
  'rule, never here.';

COMMENT ON TABLE public.allocator_holdings IS
  'Allocator-owned holdings stream — one row per (allocator_id, venue, symbol, asof, api_key_id). '
  'Produced by the FastAPI job worker via the poll_allocator_positions kind. '
  'Three-tier RLS (owner/admin/service) per D-03. Phase 06 / Plan 01. '
  'Schema mirrors position_snapshots on purpose so Phase 09 Bridge swap-the-source is cheap. '
  'Phase 170.4 D-10: the key gained api_key_id, so each key keeps its own row.';

-- ───────────── 4. self-verify — CATALOGUE ONLY, passes on an empty database
DO $verify$
DECLARE
  v_unique_count int;
  v_name         text;
  v_cols         text;
  v_pred         boolean;
  v_valid        boolean;
  v_before       text;
  v_after        text;
BEGIN
  SELECT count(*) INTO v_unique_count
    FROM pg_index i
   WHERE i.indrelid = 'public.allocator_holdings'::regclass
     AND i.indisunique AND NOT i.indisprimary;
  IF v_unique_count <> 1 THEN
    RAISE EXCEPTION 'Migration 20261011120000 failed: allocator_holdings carries % non-primary unique indexes, expected exactly 1', v_unique_count;
  END IF;

  SELECT c.relname,
         (SELECT string_agg(a.attname, ',' ORDER BY k.ord)
            FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum),
         i.indpred IS NOT NULL,
         i.indisvalid
    INTO v_name, v_cols, v_pred, v_valid
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE i.indrelid = 'public.allocator_holdings'::regclass
     AND i.indisunique AND NOT i.indisprimary;
  IF v_name IS DISTINCT FROM 'allocator_holdings_owner_venue_symbol_asof_api_key_key'
     OR v_cols IS DISTINCT FROM 'allocator_id,venue,symbol,asof,api_key_id'
     OR v_pred OR NOT v_valid THEN
    RAISE EXCEPTION 'Migration 20261011120000 failed: the unique index is % over (%), partial %, valid %', v_name, v_cols, v_pred, v_valid;
  END IF;

  IF to_regclass('public.allocator_holdings_owner_venue_symbol_asof_key') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261011120000 failed: the four-column index allocator_holdings_owner_venue_symbol_asof_key survives';
  END IF;

  IF obj_description('public.allocator_holdings'::regclass, 'pg_class') NOT LIKE '%(allocator_id, venue, symbol, asof, api_key_id)%' THEN
    RAISE EXCEPTION 'Migration 20261011120000 failed: the table comment does not name the per-key row';
  END IF;

  -- Policies, ACL, RLS flags and triggers must equal the snapshot taken at the top.
  v_before := current_setting('allocator_holdings_per_key.snapshot', true);
  IF v_before IS NULL OR v_before = '' THEN
    RAISE EXCEPTION 'Migration 20261011120000 failed: the pre-change snapshot of the allocator_holdings policies, ACL and triggers is missing';
  END IF;
  SELECT string_agg(kind || ':' || detail, E'\n' ORDER BY kind, detail) INTO v_after
    FROM (
      SELECT 'policy' AS kind,
             p.polname::text || '|' || p.polcmd::text || '|'
               || coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|'
               || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || '|'
               || p.polroles::text AS detail
        FROM pg_policy p
       WHERE p.polrelid = 'public.allocator_holdings'::regclass
      UNION ALL
      SELECT 'acl', coalesce(c.relacl::text, '<null>')
        FROM pg_class c WHERE c.oid = 'public.allocator_holdings'::regclass
      UNION ALL
      SELECT 'rls', c.relrowsecurity::text || '/' || c.relforcerowsecurity::text
        FROM pg_class c WHERE c.oid = 'public.allocator_holdings'::regclass
      UNION ALL
      SELECT 'trigger', t.tgname::text || '|' || t.tgtype::text || '|' || t.tgfoid::regproc::text || '|' || t.tgenabled::text
        FROM pg_trigger t
       WHERE t.tgrelid = 'public.allocator_holdings'::regclass AND NOT t.tgisinternal
    ) s;
  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'Migration 20261011120000 failed: a policy, the table ACL, an RLS flag or a trigger on allocator_holdings changed. Before: % After: %', v_before, v_after;
  END IF;

  RAISE NOTICE 'Migration 20261011120000: allocator_holdings is unique on (allocator_id, venue, symbol, asof, api_key_id); the four-column index is gone; policies, ACL, RLS flags and triggers are unchanged.';
END
$verify$;

COMMIT;
