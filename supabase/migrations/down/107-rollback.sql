-- Rollback for migration 107: Phase 19 / BACKBONE-04 step (d).
-- Reverses the rename + VIEW + INSTEAD OF triggers + RLS policy adds.
-- Mirrors the rollback runbook Stage D recovery procedure.
--
-- IMPORTANT — asymmetry: the C-7 backfill rows in strategy_verifications
-- are NOT removed by rollback. They are real strategy_verifications rows
-- now and removing them would lose data. If you need a strict round-trip,
-- snapshot strategy_verifications.id values before applying 107 and
-- DELETE WHERE id IN (snapshot) after this rollback.
--
-- C-8 — paired down-migration.

BEGIN;

-- Drop INSTEAD OF triggers + helper function on the VIEW.
DROP TRIGGER IF EXISTS verification_requests_view_readonly_insert ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_update ON verification_requests;
DROP TRIGGER IF EXISTS verification_requests_view_readonly_delete ON verification_requests;

-- Drop the VIEW so we can rename the legacy table back into its slot.
DROP VIEW IF EXISTS verification_requests;

-- The trigger function is shared by all 3 triggers; drop after triggers gone.
DROP FUNCTION IF EXISTS verification_requests_view_readonly_trigger();

-- Drop the M-6 + admin RLS policies BEFORE rename (policies live on the
-- legacy table name — after rename they would be on `verification_requests`
-- and the original RLS policies on the pre-107 table become re-active by
-- name match).
DROP POLICY IF EXISTS verification_requests_legacy_public_token_select ON verification_requests_legacy;
DROP POLICY IF EXISTS verification_requests_legacy_admin_select ON verification_requests_legacy;

-- Rename the legacy table back into its original slot.
ALTER TABLE verification_requests_legacy RENAME TO verification_requests;

DO $$ BEGIN RAISE NOTICE 'Migration 107 rollback: completed (note: C-7 backfill rows in strategy_verifications NOT removed — see rollback header).'; END $$;

COMMIT;
