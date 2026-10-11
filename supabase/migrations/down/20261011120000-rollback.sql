-- ============================================================================
-- ROLLBACK for 20261011120000_allocator_holdings_per_key_unique.sql
-- Phase 170.4 ALLOCHOLDINGS, plan 09 (D-08, D-10).
-- ============================================================================
-- Manual, off the auto-apply path: CI does not apply rollbacks, and nothing runs
-- this file unless a person does, after the marker query in CLAUDE.md has named
-- the database.
--
-- WHAT IT UNDOES. It re-creates the four-column unique index
-- allocator_holdings_owner_venue_symbol_asof_key on (allocator_id, venue, symbol,
-- asof) and only then drops the five-column one, so the table is never without a
-- uniqueness guard, and restores the pre-migration table comment.
--
-- ⛔ IT REFUSES WHILE TWO KEYS HOLD ROWS FOR ONE (allocator_id, venue, symbol,
-- asof). The four-column index cannot be built over them without choosing which
-- key's row to lose, and choosing silently would drop a key's position from the
-- book (T-170.4-25). The refusal names the count of colliding groups. Resolve
-- those rows deliberately (the keys' owner, or an operator, decides which row
-- stays) and re-run. Rows for one key are unaffected.
--
-- ⚠️ THE WRITER. After this runs, the analytics worker's first upsert attempt on
-- the five-column target answers 42P10 and plan 08's writer retries once on the
-- four-column target (HOLDINGS_CONFLICT_TARGET_PRE_D10), so ingestion keeps
-- working on either side. That fallback is the writer's own booked constant: if it
-- has been removed since, roll the writer back FIRST or every holdings poll fails
-- 42P10 the moment this file commits.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still
-- records version 20261011120000 as applied while the schema no longer carries
-- it. `supabase db push` will therefore NOT re-apply the migration. To re-apply
-- it, delete that ledger row in the same change that re-applies it (or mark it
-- reverted with `supabase migration repair --status reverted 20261011120000`
-- against the intended database, after the marker query in CLAUDE.md names that
-- database). Until then VAC-08's ledger check reports the version as present,
-- which is true of the ledger and false of the schema.
--
-- The DO block at the top is the PRECONDITION: it RAISEs, before anything is
-- changed, unless the migration's index exists and no (allocator_id, venue,
-- symbol, asof) group holds rows of more than one key. It reads allocator_holdings
-- on purpose: this file is manual and off the auto-apply path, so the
-- empty-TEST-database hazard that forbids a data-reading guard in the migration
-- does not apply. The DO block at the end is catalogue-only.
-- ============================================================================

BEGIN;

SET lock_timeout = '3s';

-- ───────────── precondition
DO $precondition$
DECLARE
  v_groups bigint;
BEGIN
  IF to_regclass('public.allocator_holdings_owner_venue_symbol_asof_api_key_key') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261011120000 refused: allocator_holdings_owner_venue_symbol_asof_api_key_key is missing, so this database does not carry 20261011120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;

  SELECT count(*) INTO v_groups FROM (
    SELECT 1 FROM public.allocator_holdings
     GROUP BY allocator_id, venue, symbol, asof
    HAVING count(*) > 1
  ) g;
  IF v_groups > 0 THEN
    RAISE EXCEPTION 'Rollback 20261011120000 refused: % (allocator_id, venue, symbol, asof) group(s) hold rows of more than one api_key_id. The four-column unique index cannot be rebuilt over them without losing a key''s row. Resolve those rows (decide which key''s row stays) and re-run. Nothing was changed.', v_groups;
  END IF;
END
$precondition$;

-- ───────────── the four-column index first, then the five-column one goes
CREATE UNIQUE INDEX allocator_holdings_owner_venue_symbol_asof_key
  ON public.allocator_holdings (allocator_id, venue, symbol, asof);

DROP INDEX public.allocator_holdings_owner_venue_symbol_asof_api_key_key;

-- The upsert anchor comment 20260420073003 gave the table, restored verbatim.
COMMENT ON TABLE public.allocator_holdings IS
  'Allocator-owned holdings stream — one row per (allocator_id, venue, symbol, asof). '
  'Produced by the FastAPI job worker via the poll_allocator_positions kind. '
  'Three-tier RLS (owner/admin/service) per D-03. Phase 06 / Plan 01. '
  'Schema mirrors position_snapshots on purpose so Phase 09 Bridge swap-the-source is cheap.';

-- ───────────── verify — CATALOGUE ONLY
DO $verify$
DECLARE
  v_cols text;
BEGIN
  IF to_regclass('public.allocator_holdings_owner_venue_symbol_asof_api_key_key') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261011120000 failed: the five-column index survives';
  END IF;

  SELECT string_agg(a.attname, ',' ORDER BY k.ord) INTO v_cols
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
   WHERE i.indrelid = 'public.allocator_holdings'::regclass
     AND c.relname = 'allocator_holdings_owner_venue_symbol_asof_key'
     AND i.indisunique AND i.indisvalid;
  IF v_cols IS DISTINCT FROM 'allocator_id,venue,symbol,asof' THEN
    RAISE EXCEPTION 'Rollback 20261011120000 failed: the four-column unique index is missing or covers (%)', v_cols;
  END IF;

  RAISE NOTICE 'Rollback 20261011120000: allocator_holdings is unique on (allocator_id, venue, symbol, asof) again. The migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
