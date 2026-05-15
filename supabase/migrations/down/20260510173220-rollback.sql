-- Rollback for migration 106: Phase 19 / BACKBONE-04 step (a) sentinel.
-- The sentinel migration is no-op forward; rollback is also no-op.
-- The actual change in commit (a) is the route.ts repoint, which is
-- reverted by reverting that commit — not by a SQL rollback.
--
-- C-8 — paired down-migration (no-op for symmetry).

DO $$ BEGIN RAISE NOTICE 'Migration 106 rollback: sentinel — no-op (route.ts repoint reverted by git revert of commit (a))'; END $$;
