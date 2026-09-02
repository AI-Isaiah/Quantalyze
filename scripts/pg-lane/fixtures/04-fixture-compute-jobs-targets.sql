-- Additive stand-in for the compute_jobs TARGET columns that the coherence
-- constraint under test references but that no migration in this apply list
-- creates. Only the columns the constraint text and the gate's assertions name.
-- ⚠️ ORDER: this fixture is applied AFTER 20260411144407_compute_jobs_queue.sql,
-- not before it — the table it patches is created by a migration, so the
-- "stand-ins first, then migrations" ordering of P2.1 cannot hold for it.
ALTER TABLE compute_jobs
  ADD COLUMN IF NOT EXISTS allocator_id UUID,
  ADD COLUMN IF NOT EXISTS api_key_id   UUID;
