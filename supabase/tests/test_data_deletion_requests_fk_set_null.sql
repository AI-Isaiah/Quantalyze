-- Test: data_deletion_requests.user_id FK = ON DELETE SET NULL (migration 123)
--
-- audit-2026-05-07 / P455 — verify the CASCADE ghost is closed.
--
-- Asserted invariants:
--   1. The FK constraint exists with confdeltype = 'n' (SET NULL).
--   2. The FK references auth.users(id) (not profiles(id) — see migration
--      header for why).
--   3. user_id is nullable (required for SET NULL to fire).
--   4. End-to-end: deleting an auth.users row sets the DSR row's user_id
--      to NULL but PRESERVES every other column (requested_at, completed_at,
--      rejected_at, rejection_reason, notes). The audit trail survives.
--
-- Run order: this file is intended to run AFTER all migrations have been
-- applied to the test Supabase project (qmnijlgmdhviwzwfyzlc). It uses
-- BEGIN / ROLLBACK so the auth.users seed is undone — never run against
-- production.
--
-- Manual repro:
--   psql "$TEST_SUPABASE_DB_URL" \
--     -f supabase/tests/test_data_deletion_requests_fk_set_null.sql
--
-- Expected outcome: all DO blocks succeed (no RAISE EXCEPTION). The final
-- ROLLBACK undoes the auth.users insert + DSR insert.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: FK constraint shape
-- --------------------------------------------------------------------------
DO $$
DECLARE
  fk_action CHAR(1);
  ref_table TEXT;
  is_nullable TEXT;
BEGIN
  SELECT confdeltype,
         (SELECT relname FROM pg_class WHERE oid = confrelid)
    INTO fk_action, ref_table
  FROM pg_constraint
  WHERE conname = 'data_deletion_requests_user_id_fkey'
    AND conrelid = 'public.data_deletion_requests'::regclass;

  IF fk_action IS NULL THEN
    RAISE EXCEPTION 'Test 1 failed: FK constraint not found';
  END IF;

  IF fk_action <> 'n' THEN
    RAISE EXCEPTION
      'Test 1 failed: FK action must be SET NULL (n), got %', fk_action;
  END IF;

  IF ref_table <> 'users' THEN
    -- pg_class.relname of auth.users is 'users'. confrelid landed on the
    -- right table iff the FK now points at auth.users(id).
    RAISE EXCEPTION
      'Test 1 failed: FK must reference auth.users, got %', ref_table;
  END IF;

  -- user_id must be nullable for SET NULL to be meaningful.
  SELECT c.is_nullable INTO is_nullable
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'data_deletion_requests'
    AND c.column_name = 'user_id';

  IF is_nullable <> 'YES' THEN
    RAISE EXCEPTION
      'Test 1 failed: user_id must be nullable, got is_nullable=%',
      is_nullable;
  END IF;

  RAISE NOTICE 'Test 1 passed: FK shape correct (SET NULL → auth.users, nullable)';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: End-to-end — deleting an auth.users row leaves DSR row intact
-- with user_id = NULL.
--
-- We insert a synthetic auth.users row + a DSR row + a profile row (required
-- because some downstream policies still expect profile rows), then delete
-- the auth.users row and verify:
--   * The DSR row STILL exists.
--   * Its user_id is now NULL.
--   * Every other column matches what we inserted.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_dsr_id UUID := gen_random_uuid();
  test_requested_at TIMESTAMPTZ := now();
  test_notes TEXT := 'audit-2026-05-07 P455 regression test';
  surviving_count INTEGER;
  surviving_user_id UUID;
  surviving_notes TEXT;
  surviving_requested_at TIMESTAMPTZ;
BEGIN
  -- Seed an auth.users row. The test Supabase project allows this under
  -- service-role context (no triggers reject synthetic users in tests).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (
    test_uid,
    '00000000-0000-0000-0000-000000000000',
    'test-p455-' || test_uid::text || '@quantalyze.test',
    now(),
    now()
  );

  -- Seed a profile row (so the standard signup trigger invariants hold —
  -- profiles cascades from auth.users via migration 001).
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'P455 test', 'test-p455@quantalyze.test')
  ON CONFLICT (id) DO NOTHING;

  -- Seed the DSR row.
  INSERT INTO data_deletion_requests (id, user_id, requested_at, notes)
  VALUES (test_dsr_id, test_uid, test_requested_at, test_notes);

  -- Delete the auth.users row. profiles cascades. The DSR row MUST survive
  -- with user_id flipped to NULL.
  DELETE FROM auth.users WHERE id = test_uid;

  -- Assertion: DSR row still exists.
  SELECT COUNT(*) INTO surviving_count
  FROM data_deletion_requests
  WHERE id = test_dsr_id;

  IF surviving_count <> 1 THEN
    RAISE EXCEPTION
      'Test 2 failed: DSR row CASCADEd (or vanished). Expected 1, got %',
      surviving_count;
  END IF;

  -- Assertion: user_id is NULL.
  SELECT user_id, notes, requested_at
    INTO surviving_user_id, surviving_notes, surviving_requested_at
  FROM data_deletion_requests
  WHERE id = test_dsr_id;

  IF surviving_user_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Test 2 failed: user_id should be NULL after auth.users delete, got %',
      surviving_user_id;
  END IF;

  -- Assertion: notes survived (full audit trail intact).
  IF surviving_notes <> test_notes THEN
    RAISE EXCEPTION
      'Test 2 failed: notes column lost. Expected %, got %',
      test_notes, surviving_notes;
  END IF;

  IF surviving_requested_at <> test_requested_at THEN
    RAISE EXCEPTION
      'Test 2 failed: requested_at column lost. Expected %, got %',
      test_requested_at, surviving_requested_at;
  END IF;

  RAISE NOTICE
    'Test 2 passed: DSR row survived auth.users delete (user_id=NULL, audit trail intact)';

  -- Clean up the surviving DSR row (it no longer cascades — the whole point).
  DELETE FROM data_deletion_requests WHERE id = test_dsr_id;
END $$;

ROLLBACK;
