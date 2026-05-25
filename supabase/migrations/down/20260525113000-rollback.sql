-- ROLLBACK for 20260525113000_phase19_soak_status_rpc.sql
-- Drops the read-only soak probe. Safe and idempotent.
BEGIN;
DROP FUNCTION IF EXISTS public.phase19_soak_status(timestamptz);
COMMIT;
