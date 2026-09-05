-- Additive stand-in for `strategies.status`'s NOT NULL / DEFAULT 'draft' /
-- CHECK shape, which 01-fixture-core.sql declares only as a bare nullable
-- `status TEXT` (01-fixture-core.sql:27).
--
-- Production declares it in
-- 20260405061911_initial_schema.sql:63 as
-- `status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft',
-- 'pending_review', 'published', 'archived'))`, reproduced below.
--
-- ⛔ WHY THIS IS LOAD-BEARING AND NOT COSMETIC. MEASURED on the lane
-- 2026-09-05: without it, `test_reconcile_dropped_enqueue_sweep.sql` Part 2
-- arm A REDs with
--   `TEST FAILED (2/arm A/JOB-04/SC#1): … got 0 compute_jobs rows from one
--    tick, expected exactly 1`
-- and the deployed body's own NOTICE reads `healed 0 dropped-enqueue
-- strategies this tick`. The cause is three-valued logic, not the sweep: the
-- deployed body's FIRST conjunct is `s.status <> 'archived'`
-- (20260816140000_reconcile_dropped_enqueue_sweep.sql:719), every seed in
-- Parts 2/3/4 is INSERTed as `(user_id, name)` without a status, and
-- `NULL <> 'archived'` is NULL — so on a lane carrying the bare nullable
-- column EVERY seed silently drops out of the batch CTE and every heal arm
-- fails for a reason that has nothing to do with the predicate under test.
-- The stand-in restores production's DEFAULT so the seeds land at 'draft',
-- which is the status the migration's own header calls DELIBERATELY included.
--
-- ⛔ WHY THE REAL MIGRATION IS NOT APPLIED INSTEAD. 20260405061911 is the
-- INITIAL SCHEMA: it CREATEs `strategies`, `profiles` and the rest of the base
-- that 01-fixture-core.sql already stands in for, so the two cannot both be in
-- one apply list (01-fixture-core.sql is the lane's only destructive base).
-- Same shape as 29-fixture-compute-jobs-priority.sql.
--
-- ⚠️ STAND-IN, NOT THE SCHEMA. Only the NOT NULL, the DEFAULT and the CHECK are
-- production's; nothing else about the column is asserted structurally and no
-- twin in the corpus targets this file (GRAMMAR rule 4 refuses twins on
-- stand-ins). Apply AFTER 01-fixture-core.sql. Never a second base.
ALTER TABLE public.strategies
  ALTER COLUMN status SET DEFAULT 'draft';

UPDATE public.strategies SET status = 'draft' WHERE status IS NULL;

ALTER TABLE public.strategies
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.strategies
  DROP CONSTRAINT IF EXISTS strategies_status_check;

ALTER TABLE public.strategies
  ADD CONSTRAINT strategies_status_check
    CHECK (status IN ('draft', 'pending_review', 'published', 'archived'));
