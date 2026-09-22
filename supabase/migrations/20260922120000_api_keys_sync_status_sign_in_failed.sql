-- ===========================================================================
-- Migration: api_keys_sync_status_check — add 'sign_in_failed' (D-11 arm B)
-- ===========================================================================
--
-- Phase 167 CREDTRUST. D-11 arm B — a ninth `sync_status` value, ratified at
-- the phase's `checkpoint:decision` (167-03-PLAN.md) rather than reusing
-- `revoked` (SELF-LATCHES: `enqueue_poll_allocator_positions_for_all_keys`
-- excludes `sync_status = 'revoked'`, so routing here would stop the very
-- daily poll that writes the signal this phase is about) or adding a second
-- column (forces a `src/lib/database.types.ts` hand edit with no safe
-- regeneration path from this checkout, whose Supabase CLI is linked to
-- PRODUCTION).
--
-- ⛔ THE STYLE MAP LANDS IN THE SAME COMMIT AS THIS MIGRATION.
-- `src/components/exchanges/AllocatorSyncStatus.tsx`'s `PILL_STYLES`
-- normalises an unknown `sync_status` to `idle` — a NEUTRAL pill. Without
-- the style row landing together with this constraint, a partial rollout
-- would render a BROKEN key as HEALTHY (T-167-08, mitigate, critical).
--
-- Pattern analog: `supabase/migrations/20260420073003_allocator_holdings.sql`
-- STEP 5 (the DROP+ADD widening) + its self-verifying DO block arm (h),
-- same shape.
--
-- ⛔ Re-run of the analog's own grep, recorded rather than assumed:
--   grep -rln "api_keys_sync_status_check" supabase/migrations/
-- returns exactly ONE file at HEAD — 20260420073003_allocator_holdings.sql
-- STEP 5, which shipped the 8-value list re-typed below. No migration in
-- between has touched this CHECK, so a DROP+ADD that re-types the full list
-- is safe here.
--
-- ⛔⛔ THIS DO BLOCK READS THE SCHEMA ONLY, NEVER THE DATA. A data-reading DO
-- block can apply cleanly on PROD (rows already exist there) and REFUSE on
-- shared TEST (whose `public` tables are a schema-only restore, per
-- CLAUDE.md), and a failed TEST apply blocks the PROD apply — the recorded
-- [164.8-DATA-DEPENDENT-MIGRATION-ESCAPE] class. The interim remedy for that
-- class is to REVERT THE MERGE, never to edit `supabase-migrate.yml`.
-- ===========================================================================

ALTER TABLE api_keys DROP CONSTRAINT IF EXISTS api_keys_sync_status_check;
ALTER TABLE api_keys ADD CONSTRAINT api_keys_sync_status_check
  CHECK (sync_status IN (
    'idle','syncing','computing','complete','complete_with_warnings',
    'error','revoked','rate_limited','sign_in_failed'
  ));

-- ===========================================================================
-- Self-verifying DO block — SCHEMA-reading only, per the rule above.
-- ===========================================================================
DO $$
DECLARE
  v_sync_status_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_sync_status_def
    FROM pg_constraint WHERE conname = 'api_keys_sync_status_check';

  IF v_sync_status_def IS NULL THEN
    RAISE EXCEPTION 'Migration 20260922120000 failed: api_keys_sync_status_check not found';
  END IF;

  -- (a) the new value is admitted.
  IF v_sync_status_def NOT LIKE '%sign_in_failed%' THEN
    RAISE EXCEPTION 'Migration 20260922120000 failed: api_keys_sync_status_check missing sign_in_failed. Got: %',
      v_sync_status_def;
  END IF;

  -- (b) every prior value survived the DROP+ADD — the guard against a
  -- DROP+ADD that re-types a stale list and silently removes a value added
  -- since (Pattern Assignment 8's named hazard, 167-PATTERNS.md).
  IF v_sync_status_def NOT LIKE '%idle%'
     OR v_sync_status_def NOT LIKE '%syncing%'
     OR v_sync_status_def NOT LIKE '%computing%'
     OR v_sync_status_def NOT LIKE '%complete_with_warnings%'
     OR v_sync_status_def NOT LIKE '%complete%'
     OR v_sync_status_def NOT LIKE '%error%'
     OR v_sync_status_def NOT LIKE '%revoked%'
     OR v_sync_status_def NOT LIKE '%rate_limited%' THEN
    RAISE EXCEPTION 'Migration 20260922120000 failed: api_keys_sync_status_check lost a prior value. Got: %',
      v_sync_status_def;
  END IF;
END $$;
