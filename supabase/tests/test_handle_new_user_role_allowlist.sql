-- Test: handle_new_user role allowlist is the signup trust boundary (NEW-C15-05).
--
-- audit-2026-05-07 cluster CL8 (red-team finding NEW-C15-05).
--
-- Background
-- ----------
-- profiles.role is seeded at signup from auth.users.raw_user_meta_data->>'role'
-- (the SignupForm passes it via supabase.auth.signUp({ options: { data: { role }}})).
-- That metadata is ATTACKER-CONTROLLED: a scripted client can POST any string,
-- not just the SignupForm's "allocator" | "manager" TS union. The ONLY guard is
-- the `handle_new_user` allowlist `IN ('manager', 'allocator', 'both')`, which
-- fails closed to 'manager' (the least-privileged account type) for everything
-- else. The TS union is UI shaping, not a security boundary.
--
-- Asserted invariants:
--   1. Every metadata role OUTSIDE the three product roles — including
--      privilege-escalation attempts ('admin', 'service_role', 'superuser'),
--      garbage, empty string, JSON null, an absent role key, and empty
--      metadata — collapses to 'manager'. A migration that refactors
--      handle_new_user to trust metadata loosely (drops the allowlist) would
--      let 'admin' through and FAIL case set (1).
--   2. The three legitimate product roles pass through UNCHANGED
--      (manager->manager, allocator->allocator, both->both). A migration that
--      hardcodes role='manager' (a "fix" that throws away the user's real
--      choice) would FAIL the allocator/both cases — so this test cannot pass
--      as a no-op tautology; it pins the allowlist's exact membership.
--   3. Widening the allowlist to seed an elevated value from metadata (e.g.
--      adding 'admin'/'support') would require editing BOTH this test and the
--      function in the same change — surfacing the self-elevation risk in code
--      review rather than letting it land silently.
--
-- Run order: AFTER migration 20260520222848_lock_profile_role_at_signup.sql
-- (latest CREATE OR REPLACE of handle_new_user). The on_auth_user_created
-- AFTER INSERT trigger on auth.users (migration 20260405061912) fires the
-- function, so inserting an auth.users row exercises the real path end to end.
--
-- Isolation: the whole test runs inside a single transaction that ROLLBACKs,
-- so no auth.users / profiles rows persist on the shared test DB.

BEGIN;

-- --------------------------------------------------------------------------
-- Drive every case through the real trigger and assert the seeded role.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  r        RECORD;
  v_uid    uuid;
  v_actual text;
  v_count  int := 0;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- (1) hostile / invalid metadata -> fail-closed to 'manager'
      ('{"role":"admin"}'::jsonb,             'manager',   'hostile: admin'),
      ('{"role":"service_role"}'::jsonb,      'manager',   'hostile: service_role'),
      ('{"role":"superuser"}'::jsonb,         'manager',   'hostile: superuser'),
      ('{"role":"Allocator"}'::jsonb,         'manager',   'hostile: case-variant Allocator'),
      ('{"role":"garbage"}'::jsonb,           'manager',   'invalid: garbage string'),
      ('{"role":""}'::jsonb,                  'manager',   'invalid: empty string'),
      ('{"role":null}'::jsonb,                'manager',   'invalid: JSON null role'),
      ('{"display_name":"x"}'::jsonb,         'manager',   'invalid: role key absent'),
      ('{}'::jsonb,                           'manager',   'invalid: empty metadata'),
      -- (2) legitimate product roles -> pass through unchanged
      ('{"role":"manager"}'::jsonb,           'manager',   'valid: manager'),
      ('{"role":"allocator"}'::jsonb,         'allocator', 'valid: allocator'),
      ('{"role":"both"}'::jsonb,              'both',      'valid: both')
    ) AS t(meta, expected, label)
  LOOP
    v_uid := gen_random_uuid();
    INSERT INTO auth.users (id, instance_id, email, created_at, updated_at, raw_user_meta_data)
    VALUES (
      v_uid,
      '00000000-0000-0000-0000-000000000000',
      'cl8-' || v_uid::text || '@quantalyze.test',
      now(), now(),
      r.meta
    );

    SELECT role INTO v_actual FROM public.profiles WHERE id = v_uid;

    IF v_actual IS NULL THEN
      RAISE EXCEPTION
        'handle_new_user did not create a profile for case [%] (raw_user_meta_data=%)',
        r.label, r.meta;
    END IF;

    IF v_actual IS DISTINCT FROM r.expected THEN
      RAISE EXCEPTION
        'handle_new_user role allowlist FAILED [%]: raw_user_meta_data=% produced role=%, expected %',
        r.label, r.meta, v_actual, r.expected;
    END IF;

    v_count := v_count + 1;
  END LOOP;

  IF v_count <> 12 THEN
    RAISE EXCEPTION 'expected 12 allowlist cases, ran %', v_count;
  END IF;

  RAISE NOTICE 'handle_new_user role allowlist: all % cases passed', v_count;
END $$;

ROLLBACK;
