-- ⚠️ NOT YET REFERENCED BY ANY `RED-UNDER-SETUP` LINE. It was derived for
-- supabase/tests/test_resync_retry_single_job.sql, whose apply list is PROVEN
-- GREEN with it (exit 0, 2026-09-04) but whose annotation is BLOCKED on a
-- founder decision about assertion (b) — see 164.4-09-SUMMARY.md § Blockers.
-- Committed rather than discarded because the list it belongs to is measured,
-- and because every branch of that decision keeps the file. Delete it in the
-- same commit if the decision is to drop that gate from the phase.
--
-- Additive stand-in for `contact_requests`. Apply AFTER 01-fixture-core.sql and
-- BEFORE the migrations under test. Never a second base.
--
-- WHY IT EXISTS — a RULE-2 requirement, not padding.
-- `20260416125430_contact_request_metadata.sql` is the LAST migration that
-- defines `compute_jobs_one_inflight_per_kind_strategy`: it DROPs the
-- 20260411144407 version and recreates it with the `kind <>
-- 'compute_intro_snapshot'` carve-out. That index is the object under test in
-- test_resync_retry_single_job.sql assertion (a), and phase 164.4's authoring
-- rule 2 requires a twin to mutate the LAST-defining migration — a twin pointed
-- at 20260411144407 would mutate text the running database never sees, which is
-- the `CREATE OR REPLACE` re-basing trap.
--
-- But that migration's STEPs 1-2 first extend `contact_requests`, a table
-- created back in the Phase-031 initial schema and unrelated to anything the
-- resync gate asserts. MEASURED on the lane 2026-09-04: without this file the
-- lane dies at `20260416125430_contact_request_metadata.sql:57 ERROR 42P01
-- relation "contact_requests" does not exist`. The column set below is exactly
-- what that migration's own ALTER / ADD CONSTRAINT statements name, read off
-- the failure rather than guessed:
--   * `source`, `snapshot_status` — the two CHECK constraints it adds
--   * `strategy_id`, `allocator_id` — the FKs the intro-snapshot arm names
--   * `mandate_context`, `portfolio_snapshot`, `replacement_for` — added by the
--     migration itself, so declared here only as the pre-existing shape allows
--     `ADD COLUMN IF NOT EXISTS` to be the thing that adds them
--
-- ⚠️ STAND-IN, NOT THE SCHEMA. No arm in any gate using this file asserts
-- anything about `contact_requests`; it is scaffold that lets STEPs 1-2 apply so
-- STEP 3's index recreation — which IS under test — is reached.
CREATE TABLE IF NOT EXISTS contact_requests (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  strategy_id  UUID,
  allocator_id UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
