-- ============================================================================
-- ROLLBACK for 20261127200000_strategy_analytics_unit_segments.sql
-- Phase 256 OKXUNITSWITCH, plan 02.
-- ============================================================================
-- Manual, never auto-applied, off the supabase-migrate.yml path.
--
-- ⛔ NEVER RUN THIS ONCE THE READER OR THE WRITER IS DEPLOYED. The factsheet
-- select and the derive's write both name unit_segments, and a PostgREST request
-- that names a missing column fails whole. Before those PRs this file is safe:
-- nothing reads or writes the column.
--
-- ⚠️ DROPPING THE COLUMN DESTROYS ANY STORED SEGMENTS. The next derive of a
-- unit-switched strategy would rebuild them, but a rolled-back column cannot hold
-- them until the migration is applied again.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations.
--
-- ⛔ WHICH DATABASE? Run the marker query FIRST, every time, before this file or any
-- `--linked` command. `current_database()` is `postgres` on both projects and proves
-- nothing:
--   SELECT shobj_description(oid, 'pg_database') AS which_database
--     FROM pg_database WHERE datname = current_database();
-- A NULL answer means the marker was lost: re-set it, do not proceed on a guess.

ALTER TABLE public.strategy_analytics
  DROP CONSTRAINT IF EXISTS strategy_analytics_unit_segments_object_chk;
ALTER TABLE public.strategy_analytics
  DROP COLUMN IF EXISTS unit_segments;
