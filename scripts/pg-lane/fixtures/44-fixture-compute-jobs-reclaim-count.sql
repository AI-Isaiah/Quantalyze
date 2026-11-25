-- Stand-in for `compute_jobs.reclaim_count`, which reclaim_stuck_compute_jobs
-- (re-based by migration 20261124120100) bumps on every row it reclaims. The
-- column's sole source is 20260510180226_compute_jobs_audit_2026_05_07_g10b.sql
-- (step 564), a large migration that also re-bases the claim and mark RPCs and
-- carries its own verify block; a gate that exercises only the reclaim needs the
-- column and nothing else. Apply AFTER a compute_jobs base
-- (20260411144407_compute_jobs_queue.sql). Never a second base.
--
-- STAND-IN, NOT THE SCHEMA. The type, NOT NULL and DEFAULT 0 are production's
-- (20260510180226). Nothing else about that migration is reproduced.
ALTER TABLE public.compute_jobs
  ADD COLUMN IF NOT EXISTS reclaim_count INTEGER NOT NULL DEFAULT 0;
