-- Phase 243 DBBACKSTOP, plan 09: the pg-lane's strategy_analytics carries the column the
-- DBACC-01 revoke names, and starts from PROD's table-level client grants.
--
-- WHY THIS FIXTURE EXISTS. 03-fixture-compute-jobs.sql creates a fixture-sized
-- strategy_analytics (strategy_id, computation_status, computed_at,
-- computing_started_at, returns_series, data_quality_flags) and no
-- metrics_json_by_basis. Migration 20261127220000 names that column, and its gate
-- reads it as anon, so the lane needs it to exist. The grant line mirrors PROD's
-- table-level client grants (supabase/schema/baseline.sql, the GRANT lines on
-- "public"."strategy_analytics"), so the lane starts from PROD's grant shape
-- whatever the apply order is: 07-fixture-supabase-default-privileges.sql only
-- reaches tables created AFTER it, and 03 may run before it.
--
-- Without the migration, anon then holds the table-level SELECT on the lane, which
-- is what makes "RED without the migration" real for the gate's GRANT 1 arm.
ALTER TABLE public.strategy_analytics ADD COLUMN IF NOT EXISTS metrics_json_by_basis JSONB;
GRANT SELECT, INSERT, UPDATE, DELETE, REFERENCES ON public.strategy_analytics TO anon, authenticated;
GRANT ALL ON public.strategy_analytics TO service_role;
