-- Rollback for migration 134 / 20260515205431_sec_def_public_execute_guard.sql
-- audit-2026-05-07 C-0284.
--
-- Drops the migration-utility helper installed by the forward
-- migration. Does NOT re-grant PUBLIC EXECUTE on the audit-slice
-- functions — restoring a known-bad ACL state is not a rollback,
-- it is a regression. If a downstream consumer depends on
-- PUBLIC EXECUTE for one of these functions, that consumer must
-- be re-routed through service_role / authenticated explicitly.

BEGIN;
SET lock_timeout = '3s';

DROP FUNCTION IF EXISTS public._assert_no_public_execute(TEXT);

COMMIT;
