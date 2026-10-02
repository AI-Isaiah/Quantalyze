-- ============================================================================
-- ARM OVERLAY 13 (B2) — a FOURTH survivor class no hand-listed census knows.
--
-- Applied ON TOP OF old-test.sql by the self-test's `fresh_db <name>`.
--
-- A view in a non-public schema over a public table. It is not a trigger, not a
-- policy and not a publication row, so the three hand-listed census classes
-- cannot see it; `DROP SCHEMA public CASCADE` removes it; the dump, which is
-- `--schema public`, does not put it back; and the post-replay key-set
-- comparison still passes because the view was never in the key set.
--
-- ⛔ MEASURED as a SILENT COMMIT in Phase 164.8 plan 01's NEUTER 2: the restore
-- went green, `analytics.v_leftover` was gone (count=0) and the `analytics`
-- schema itself survived, so nothing looked broken from outside.
--
-- The derived `pg_depend` closure names it (`rule _RETURN on view
-- analytics.v_leftover`) and ABORTS. This overlay is what makes that permanent.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE VIEW analytics.v_leftover AS SELECT * FROM public.fx_keep;
