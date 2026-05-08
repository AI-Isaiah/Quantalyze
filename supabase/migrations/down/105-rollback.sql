-- Rollback for migration 105: Phase 19 / FINGERPRINT-01 + FINGERPRINT-02
-- Reverses strategies.fingerprint JSONB column, partial index, version CHECK,
-- and compute_similarity function.
--
-- C-8 — paired down-migration.

BEGIN;

DROP FUNCTION IF EXISTS compute_similarity(JSONB, JSONB);

DROP INDEX IF EXISTS strategies_fingerprint_partial_idx;

ALTER TABLE strategies DROP CONSTRAINT IF EXISTS strategies_fingerprint_version_check;

ALTER TABLE strategies DROP COLUMN IF EXISTS fingerprint;

DO $$ BEGIN RAISE NOTICE 'Migration 105 rollback: completed.'; END $$;

COMMIT;
