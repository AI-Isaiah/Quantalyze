-- Rollback for migration 20260622120000_scenario_shares_and_read_rpc.sql
-- Phase 25 / Plan 25-01 (SHARE-02, SHARE-03).
--
-- Drops the leak-scoped read RPC and the share table installed by the forward
-- migration. DROP TABLE ... CASCADE also drops the partial unique index, the
-- scenario_idx, and the owner RLS policy on the table. Does NOT touch the
-- shared public._assert_no_public_execute helper (owned by mig 134) — that is
-- not this migration's to drop.

BEGIN;
SET lock_timeout = '3s';

DROP FUNCTION IF EXISTS public.get_shared_scenario(TEXT);
-- create_scenario_share is NOT dropped by DROP TABLE ... CASCADE (a function body
-- referencing a table is not a tracked dependency), so drop it explicitly — else
-- it survives as an orphan referencing the dropped table and a forward re-apply
-- would hit CREATE FUNCTION on an existing function and abort.
DROP FUNCTION IF EXISTS public.create_scenario_share(UUID, TEXT);
DROP TABLE IF EXISTS scenario_shares CASCADE;

COMMIT;
