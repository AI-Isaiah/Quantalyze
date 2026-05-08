-- Rollback for migration 103: Phase 19 / BACKBONE-03 + BACKBONE-07
-- Reverses transition_strategy_verification RPC + 4 new columns + partial
-- unique index on public_token. Round-trip tested: apply 103 → verify
-- schema → apply this rollback → verify schema returns to pre-103 state.
--
-- C-8 — paired down-migration. A failed `supabase db push` mid-sequence
-- leaves the DB half-migrated; this rollback covers every forward DDL
-- in 103 so recovery is one well-known SQL run.

BEGIN;

DROP FUNCTION IF EXISTS transition_strategy_verification(UUID, TEXT, JSONB);

DROP INDEX IF EXISTS strategy_verifications_public_token_unique_idx;

ALTER TABLE strategy_verifications
  DROP COLUMN IF EXISTS transitioned_at,
  DROP COLUMN IF EXISTS encrypted_credentials,
  DROP COLUMN IF EXISTS public_token,
  DROP COLUMN IF EXISTS expires_at;

DO $$ BEGIN RAISE NOTICE 'Migration 103 rollback: completed.'; END $$;

COMMIT;
