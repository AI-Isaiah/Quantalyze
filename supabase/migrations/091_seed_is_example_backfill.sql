-- 091_seed_is_example_backfill.sql
--
-- DISCO-05 (Phase 13 / v0.17.0.0) — Data-only backfill of `is_example=true`
-- on the 8 canonical seed strategy UUIDs.
--
-- Why a migration: production audit on 2026-04-28 returned
--   SELECT COUNT(*) FROM strategies WHERE is_example=true AND status='published'
--   = 0
-- meaning the seed strategies in production were inserted before the seeder
-- started writing is_example=true consistently (or with the column missing).
-- The default Customize "Hide examples = ON" lock in Plan 13-02
-- (src/lib/discovery-prefs.ts:DEFAULTS.hide_examples=true) only filters rows
-- whose is_example=true — so without this backfill a fresh allocator's first
-- /discovery/[slug] visit would still show all 8 demo strategies.
--
-- Source of truth for the UUID list: scripts/seed-demo-data.ts:STRATEGY_UUIDS
-- (lines 44-53 — 8 elements). All 8 are inserted with is_example=true by the
-- seeder at line 904; this migration is a defensive backfill, idempotent
-- (set-to-true twice is the same as once), no DDL.
--
-- Reference: 13-CONTEXT.md Audit Gate decision; 13-RESEARCH.md Don't Hand-Roll.

UPDATE public.strategies
SET is_example = true
WHERE id IN (
  'cccccccc-0001-4000-8000-000000000001',
  'cccccccc-0001-4000-8000-000000000002',
  'cccccccc-0001-4000-8000-000000000003',
  'cccccccc-0001-4000-8000-000000000004',
  'cccccccc-0001-4000-8000-000000000005',
  'cccccccc-0001-4000-8000-000000000006',
  'cccccccc-0001-4000-8000-000000000007',
  'cccccccc-0001-4000-8000-000000000008'
);

-- Post-update sanity probe — emit a NOTICE with the resulting count so
-- the supabase db push log carries observable evidence of effect.
DO $$
DECLARE
  flagged_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO flagged_count
  FROM public.strategies
  WHERE id IN (
    'cccccccc-0001-4000-8000-000000000001',
    'cccccccc-0001-4000-8000-000000000002',
    'cccccccc-0001-4000-8000-000000000003',
    'cccccccc-0001-4000-8000-000000000004',
    'cccccccc-0001-4000-8000-000000000005',
    'cccccccc-0001-4000-8000-000000000006',
    'cccccccc-0001-4000-8000-000000000007',
    'cccccccc-0001-4000-8000-000000000008'
  )
  AND is_example = true;

  RAISE NOTICE '[091_seed_is_example_backfill] flagged % seed rows with is_example=true (expected 8 if all seeds present in this DB; lower in fresh test DBs where some seeds may not exist)', flagged_count;
END $$;
