-- F10 ephemeral-CI snapshot — PRE-LOAD step (run AFTER `supabase start`, BEFORE 02-schema.sql).
--
-- WHY THIS EXISTS (do not delete — 4 SQL self-tests fail silently without it):
--
-- Supabase's local bootstrap configures ALTER DEFAULT PRIVILEGES that GRANT
-- EXECUTE on public FUNCTIONS (and ALL on TABLES/SEQUENCES) to anon,
-- authenticated, and service_role. So every CREATE FUNCTION run while loading
-- 02-schema.sql is auto-granted EXECUTE to anon + authenticated.
--
-- pg_dump (which produced 02-schema.sql) encodes ACLs as deltas from the
-- *built-in* function default (PUBLIC = EXECUTE). In the source DB the
-- service_role-only functions had anon/authenticated absent — but that absence
-- came from this very default-privilege setup, NOT from an explicit migration
-- REVOKE. pg_dump therefore emits only `REVOKE ALL ... FROM PUBLIC` and never an
-- explicit `REVOKE ... FROM anon, authenticated`. Loading that into a bootstrap
-- that re-applies the default GRANTs RESURRECTS anon/authenticated EXECUTE on
-- functions that must be service_role-only — silently undoing the REVOKE
-- hardening that supabase/tests/test_*.sql assert (commit_scenario_batch,
-- cutover_strategy_metrics_keys_atomic, guard_wizard_draft_updates,
-- log_audit_event_service ceiling, …).
--
-- Neutralizing the default privileges here makes 02-schema.sql's ~393 explicit
-- GRANT statements the single source of truth, so the loaded ACLs match the
-- source database exactly. Verified: with this step the full
-- supabase/tests/test_*.sql suite passes against the snapshot-loaded stack;
-- without it, the four EXECUTE-hardening tests fail.
--
-- Owner is `postgres` because the local bootstrap's default privileges and the
-- snapshot loader both act as the `postgres` role (see `\ddp`).

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon, authenticated, service_role;
