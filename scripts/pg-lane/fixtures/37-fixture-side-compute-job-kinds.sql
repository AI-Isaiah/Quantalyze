-- Additive lane-only fixture: registers the four side kinds in compute_job_kinds. Phase 164.6.6.3.4 STATUSBRIDGE.
-- The lane's registry holds only the kinds its apply list registers, and the compute_jobs.kind FK refuses the rest with 23503; the coherence CHECK already admits all four, so only registry rows are missing.
INSERT INTO compute_job_kinds (name) VALUES
  ('sync_funding'),
  ('poll_positions'),
  ('reconcile_strategy'),
  ('compute_intro_snapshot')
  ON CONFLICT (name) DO NOTHING;
