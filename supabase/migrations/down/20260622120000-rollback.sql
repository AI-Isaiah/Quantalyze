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
DROP TABLE IF EXISTS scenario_shares CASCADE;

COMMIT;
