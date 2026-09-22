-- Test for migration 20260922120000_api_keys_sync_status_sign_in_failed.sql
-- — api_keys_sync_status_check ADMITS 'sign_in_failed' (Phase 167 CREDTRUST,
-- D-11 arm B, ratified checkpoint) AND still ADMITS every prior value.
--
-- Root cause it guards: a DROP+ADD that re-types a stale value list silently
-- REMOVES whatever was added since — the named hazard of the DROP+ADD
-- widening pattern this migration copies from
-- supabase/migrations/20260420073003_allocator_holdings.sql STEP 5
-- (167-PATTERNS.md Pattern Assignment 8). This file asserts BOTH halves in
-- one gate: the new value is admitted, and no prior value was lost.
--
-- pgTAP is not set up in this project (CLAUDE.md / Lane B audit), so
-- assertions RAISE EXCEPTION on failure; a clean run prints NOTICEs only.
-- Run under `psql -v ON_ERROR_STOP=1`. Run order: AFTER migration
-- 20260922120000_api_keys_sync_status_sign_in_failed.sql.
--
-- Structural only — reads pg_get_constraintdef, seeds no rows, has zero side
-- effects, and is revert-proof (fails on any re-base back to a narrower
-- constraint definition).
--
-- ⭐ MACHINE-EXECUTABLE TWINS (mutation runner). Each prose RED-UNDER below an
-- arm carries an adjacent RED-UNDER-M object that scripts/mutation-runner
-- executes against a throwaway pg-lane clone of this corpus.
--
-- RED-UNDER-SETUP: {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/02-fixture-sanitize-tables.sql","scripts/pg-lane/fixtures/03-fixture-compute-jobs.sql","supabase/migrations/20260922120000_api_keys_sync_status_sign_in_failed.sql"]}

-- ==========================================================================
-- Part 1 — the widened constraint admits the new value AND every prior one.
-- ==========================================================================
DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'public.api_keys'::regclass
     AND conname = 'api_keys_sync_status_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'sign_in_failed-check: api_keys_sync_status_check not found';
  END IF;

  -- (a) The new value is admitted. This is the fail-without-fix anchor: a
  -- pre-migration re-base has no such text.
  --
  -- RED-UNDER: revert the LIVE constraint to the pre-migration 8-value list
  -- (drop 'sign_in_failed') — the constraint the phase's own migration
  -- exists to widen.
  -- RED-UNDER-M: {"arm":"1","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_sync_status_check; ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_sync_status_check CHECK (sync_status IN ('idle','syncing','computing','complete','complete_with_warnings','error','revoked','rate_limited'))"}]}
  IF position('sign_in_failed' IN v_def) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): api_keys_sync_status_check does not admit sign_in_failed (D-11 arm B widening missing or reverted). Got: %',
      v_def;
  END IF;

  -- (b) Every prior value survived the DROP+ADD — the guard against a
  -- DROP+ADD that re-types a stale list and silently removes a value added
  -- since (167-PATTERNS.md Pattern Assignment 8's named hazard).
  --
  -- RED-UNDER: re-type the LIVE constraint from a STALE list that lost one
  -- prior value ('revoked') while still admitting sign_in_failed — the
  -- exact shape of the hazard this check exists to catch.
  -- RED-UNDER-M: {"arm":"2","apply":[{"kind":"sql","stmt":"ALTER TABLE public.api_keys DROP CONSTRAINT api_keys_sync_status_check; ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_sync_status_check CHECK (sync_status IN ('idle','syncing','computing','complete','complete_with_warnings','error','rate_limited','sign_in_failed'))"}]}
  IF position('idle' IN v_def) = 0
     OR position('syncing' IN v_def) = 0
     OR position('computing' IN v_def) = 0
     OR position('complete_with_warnings' IN v_def) = 0
     OR position('complete' IN v_def) = 0
     OR position('error' IN v_def) = 0
     OR position('revoked' IN v_def) = 0
     OR position('rate_limited' IN v_def) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (2): api_keys_sync_status_check lost a prior value (stale DROP+ADD re-type). Got: %',
      v_def;
  END IF;

  RAISE NOTICE 'Part 1 OK: api_keys_sync_status_check admits sign_in_failed and every prior value.';
END $$;
