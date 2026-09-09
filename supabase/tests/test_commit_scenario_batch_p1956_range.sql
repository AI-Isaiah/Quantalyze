-- Test: commit_scenario_batch P1956 — single percent encoding + range CHECK
--
-- audit-2026-05-07 round 2 Block E Task E.1 (migration 128).
--
-- Asserted invariants:
--   1. The bridge_outcomes_percent_allocated_range_check CHECK constraint
--      exists, is VALIDATED, and lives on public.bridge_outcomes.
--   2. The commit_scenario_batch source code (prosrc) no longer contains
--      the legacy "new_weight" fallback expression (P1956 — dual encoding
--      eliminated). The migration's self-verifying DO block asserts (f)
--      this at apply time; we re-assert here so any future CREATE OR
--      REPLACE that re-introduces new_weight is caught.
--   3. A direct INSERT into bridge_outcomes with percent_allocated = 500
--      (the value previously produced by dual-encoding 50 → 50 * 100) is
--      REJECTED with ERRCODE 23514 (check_violation). This proves the
--      defense-in-depth backstop actually fires — the migration's DO
--      block only proves the constraint EXISTS, not that it REJECTS.
--   4. A direct INSERT with percent_allocated = 25 (legal range) is
--      ACCEPTED. ⛔ RE-BASED 2026-09-09: this line used to read "Pre-existing
--      mig-059 CHECK already gates 50.0 as the ceiling, so we test a value that
--      satisfies BOTH constraints". That inline CHECK was DROPPED by
--      20260528223200_drop_stale_bridge_outcomes_percent_inline_check.sql:53,
--      which calls it stale in its own filename. Only mig-128's named range
--      CHECK [0, 100] survives, so 25 is legal under ONE constraint, not two.
--   5. NULL percent_allocated (kind='rejected' rows per mig 081) is
--      ACCEPTED — the new CHECK explicitly allows NULL.
--
-- Pre-migration-128 FAIL state:
--   * Before mig 128, the bridge_outcomes_percent_allocated_range_check
--     constraint does not exist; Test 1 fails.
--   * Before mig 128, prosrc contains the "new_weight" fallback; Test 2
--     fails.
--
-- Run order: AFTER migration 128 has been applied. BEGIN/ROLLBACK so seed
-- data does not leak.

BEGIN;

-- --------------------------------------------------------------------------
-- Test 1: CHECK constraint shape + VALIDATED state.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_present BOOLEAN;
  v_validated BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'bridge_outcomes'
       AND c.conname = 'bridge_outcomes_percent_allocated_range_check'
  ) INTO v_present;
  IF NOT v_present THEN
    RAISE EXCEPTION
      'Test 1 failed (P1956): bridge_outcomes_percent_allocated_range_check missing — migration 128 not applied';
  END IF;

  SELECT c.convalidated INTO v_validated
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'bridge_outcomes'
     AND c.conname = 'bridge_outcomes_percent_allocated_range_check';

  IF v_validated IS NOT TRUE THEN
    RAISE EXCEPTION
      'Test 1 failed (P1956): CHECK exists but is NOT VALIDATED (convalidated=%); migration 128 STEP 1 phase 2 must run', v_validated;
  END IF;

  RAISE NOTICE 'Test 1 passed: bridge_outcomes_percent_allocated_range_check present and validated';
END $$;

-- --------------------------------------------------------------------------
-- Test 2: prosrc no longer references the legacy "new_weight" fallback.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  v_prosrc TEXT;
BEGIN
  SELECT prosrc INTO v_prosrc
    FROM pg_proc
   WHERE oid = 'public.commit_scenario_batch(uuid,jsonb,text,text,text)'::regprocedure;

  IF v_prosrc IS NULL THEN
    RAISE EXCEPTION 'Test 2 failed: commit_scenario_batch(uuid,jsonb,text,text,text) not installed';
  END IF;
  IF v_prosrc LIKE '%new_weight%' THEN
    RAISE EXCEPTION
      'Test 2 failed (P1956): commit_scenario_batch prosrc still references the legacy new_weight fallback — dual encoding regressed';
  END IF;

  RAISE NOTICE 'Test 2 passed: prosrc free of legacy new_weight fallback';
END $$;

-- --------------------------------------------------------------------------
-- Test 3: out-of-range percent_allocated INSERT is rejected with 23514.
--
-- The point of P1956's defense-in-depth backstop is that even if some
-- future code path BYPASSES commit_scenario_batch and writes directly to
-- bridge_outcomes (a service_role migration, a backfill script), a value
-- of 500 (above-range but inside NUMERIC(5,2) capacity) is rejected by the
-- CHECK rather than a numeric_value_out_of_range. We can NOT use 5000 here:
-- the column is NUMERIC(5,2) (max 999.99), so 5000 trips ERRCODE 22003
-- before any CHECK fires. 500 is the cleanest test — fits the column,
-- exceeds mig-128's new [0,100] CHECK AND mig-059's [0.1,50] inline CHECK,
-- so we get a clean 23514 from whichever fires first.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  test_md_id UUID;
  raised BOOLEAN := FALSE;
  err_state TEXT;
BEGIN
  -- Seed user + profile (FK chain).
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p1956-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p1956 test', 'test-p1956@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  -- Seed api_keys + strategies (bridge_outcomes.strategy_id is NOT NULL).
  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'p1956-test', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes,
    markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'p1956 strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;

  -- Seed a match_decisions row so the FK chain is satisfied. kind defaults
  -- to 'bridge_recommended' which would require original_strategy_id OR
  -- original_holding_ref NOT NULL per migration 080's per-kind CHECK; use
  -- kind='voluntary_add' explicitly (strategy_id NOT NULL, originals NULL —
  -- matches what we're inserting) so the seed passes that constraint.
  INSERT INTO match_decisions (
    allocator_id, strategy_id, decision, decided_by, kind
  ) VALUES (
    test_uid, test_sid, 'snoozed', test_uid, 'voluntary_add'
  ) RETURNING id INTO test_md_id;

  -- Attempt the out-of-range INSERT.
  BEGIN
    INSERT INTO bridge_outcomes (
      allocator_id, strategy_id, match_decision_id, kind,
      percent_allocated, allocated_at
    ) VALUES (
      test_uid, test_sid, test_md_id, 'allocated',
      500, CURRENT_DATE
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE;
    err_state := SQLSTATE;
  END;

  IF NOT raised THEN
    RAISE EXCEPTION
      'Test 3 failed (P1956): bridge_outcomes INSERT with percent_allocated=500 was ACCEPTED — defense-in-depth CHECK not enforced';
  END IF;

  -- Either mig-059 (>=0.1 AND <=50) OR mig-128 (>=0 AND <=100) catches it;
  -- both raise ERRCODE 23514. We only assert the error code, not which
  -- constraint fired, because the audit-fix invariant is "value rejected
  -- before hitting disk".
  IF err_state <> '23514' THEN
    RAISE EXCEPTION
      'Test 3 failed (P1956): expected ERRCODE 23514 (check_violation), got %', err_state;
  END IF;

  RAISE NOTICE 'Test 3 passed: percent_allocated=500 rejected with ERRCODE 23514';

  -- Cleanup
  DELETE FROM match_decisions WHERE id = test_md_id;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 4: NULL percent_allocated (rejected outcomes) is accepted.
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  test_md_id UUID;
  v_bo_id UUID;
BEGIN
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p1956-null-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p1956-null', 'test-p1956-null@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    email        = EXCLUDED.email;

  INSERT INTO api_keys (
    user_id, exchange, label, api_key_encrypted, is_active
  ) VALUES (
    test_uid, 'binance', 'p1956-null-test', 'encrypted-blob', TRUE
  ) RETURNING id INTO test_kid;

  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes,
    markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'p1956-null strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;

  -- Seed a match_decisions row so the FK chain is satisfied.
  -- See voluntary_add note in Test 3 about the explicit kind.
  INSERT INTO match_decisions (
    allocator_id, strategy_id, decision, decided_by, kind
  ) VALUES (
    test_uid, test_sid, 'snoozed', test_uid, 'voluntary_add'
  ) RETURNING id INTO test_md_id;

  -- kind='rejected' rows carry NULL percent_allocated (mig 081).
  INSERT INTO bridge_outcomes (
    allocator_id, strategy_id, match_decision_id, kind,
    percent_allocated, rejection_reason
  ) VALUES (
    test_uid, test_sid, test_md_id, 'rejected',
    NULL, 'mandate_conflict'
  ) RETURNING id INTO v_bo_id;

  IF v_bo_id IS NULL THEN
    RAISE EXCEPTION
      'Test 4 failed (P1956): NULL percent_allocated INSERT did not return an id';
  END IF;

  RAISE NOTICE 'Test 4 passed: NULL percent_allocated accepted for kind=rejected';

  DELETE FROM bridge_outcomes WHERE id = v_bo_id;
  DELETE FROM match_decisions WHERE id = test_md_id;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

-- --------------------------------------------------------------------------
-- Test 5: boundary disambiguation — prove mig-128's CHECK [0, 100] is the
-- constraint that fires by isolating it from mig-059's stricter
-- inline CHECK [0.1, 50]. Inside a SAVEPOINT we DROP the mig-128 CHECK,
-- attempt percent_allocated = 75 (passes mig-128 [0,100], fails mig-059
-- [0.1,50]) — both still reject. Then we ATTEMPT to drop mig-059's inline
-- CHECK (it's an unnamed column-level check, so we use information_schema
-- to find it). If both can be dropped, percent_allocated=75 must succeed
-- (proves neither mig-059 nor mig-128 is the only line of defense; both
-- contribute). The SAVEPOINT rolls back any constraint manipulation so the
-- outer transaction state is unchanged.
--
-- Plus boundary values for mig-128's CHECK explicitly: 100 (upper, valid
-- per mig-128 but rejected by mig-059), 0 (lower, valid per mig-128 but
-- rejected by mig-059 minimum 0.1), and -1 (rejected by mig-128 and mig-059).
-- --------------------------------------------------------------------------
DO $$
DECLARE
  test_uid UUID := gen_random_uuid();
  test_kid UUID;
  test_sid UUID;
  test_md_id UUID;
  mig128_check_exists BOOLEAN;
  mig128_check_valid BOOLEAN;
  err_state TEXT;
  raised BOOLEAN;
  n_rows INTEGER;
BEGIN
  -- (a) Confirm mig-128's named CHECK is present + validated.
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'bridge_outcomes_percent_allocated_range_check'
       AND conrelid = 'public.bridge_outcomes'::regclass
  ) INTO mig128_check_exists;
  IF NOT mig128_check_exists THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956): bridge_outcomes_percent_allocated_range_check '
      'CHECK is missing — mig-128 STEP 1 did not land';
  END IF;

  SELECT c.convalidated INTO mig128_check_valid
    FROM pg_constraint c
   WHERE c.conname = 'bridge_outcomes_percent_allocated_range_check'
     AND c.conrelid = 'public.bridge_outcomes'::regclass;
  IF mig128_check_valid IS NOT TRUE THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956): bridge_outcomes_percent_allocated_range_check '
      'exists but is NOT VALIDATED — mig-128 STEP 1 VALIDATE step did not land';
  END IF;

  -- (b) Boundary set — seed minimal FK chain.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (test_uid, '00000000-0000-0000-0000-000000000000',
          'test-p1956-boundary-' || test_uid::text || '@quantalyze.test',
          now(), now());
  INSERT INTO profiles (id, display_name, email)
  VALUES (test_uid, 'p1956-bdry', 'test-p1956-bdry@quantalyze.test')
  ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted, is_active)
  VALUES (test_uid, 'binance', 'p1956-bdry-test', 'encrypted-blob', TRUE)
  RETURNING id INTO test_kid;
  INSERT INTO strategies (
    user_id, api_key_id, name, status, strategy_types, subtypes,
    markets, supported_exchanges
  ) VALUES (
    test_uid, test_kid, 'p1956-bdry strategy', 'published',
    '{}', '{}', '{}', ARRAY['binance']
  ) RETURNING id INTO test_sid;
  INSERT INTO match_decisions (allocator_id, strategy_id, decision, decided_by, kind)
  VALUES (test_uid, test_sid, 'snoozed', test_uid, 'voluntary_add')
  RETURNING id INTO test_md_id;

  -- ⛔ RESET BOTH per leg. `raised` was reset and `err_state` was NOT, so a leg
  -- that did not raise reported the PREVIOUS leg's SQLSTATE. Measured 2026-09-09:
  -- leg (d) failed with `raised=f, state=23514` — a message that reads as a
  -- contradiction and names a code this run never produced. A diagnostic that
  -- misidentifies the cause is worse than a bare failure.

  -- (c) percent_allocated = -1 → below the range CHECK's lower bound. MUST raise.
  raised := FALSE; err_state := NULL;
  BEGIN
    INSERT INTO bridge_outcomes (
      allocator_id, strategy_id, match_decision_id, kind,
      percent_allocated, allocated_at
    ) VALUES (test_uid, test_sid, test_md_id, 'allocated', -1, CURRENT_DATE);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE; err_state := SQLSTATE;
  END;
  IF NOT raised OR err_state <> '23514' THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956 boundary): percent_allocated=-1 should raise 23514, raised=%, state=%',
      raised, err_state;
  END IF;

  -- ⛔ RE-BASED 2026-09-09. Legs (d) and (e) asserted mig-059's INLINE column
  -- CHECK (`percent_allocated >= 0.1 AND <= 50`, 20260418060747_bridge_outcomes.sql:57).
  -- `20260528223200_drop_stale_bridge_outcomes_percent_inline_check.sql:53` DROPS
  -- that constraint — its own filename calls it stale (NEW-C18-02). So the chain's
  -- END STATE is mig-128's named range CHECK alone, `[0, 100]` inclusive, and 100
  -- and 0 are LEGAL. The old expectation stood green only because shared TEST was
  -- STALE and still carried the dropped constraint; the 2026-09-09 restore brought
  -- TEST to the schema the chain actually renders and the assertion fell over.
  -- ⚠️ That is the finding, not the damage: a boundary test cannot be evidence
  -- about a constraint that no longer exists.
  --
  -- ⛔ EACH ACCEPTED ROW IS DELETED AGAIN. `bridge_outcomes_allocator_match_decision_unique`
  -- is UNIQUE (allocator_id, match_decision_id), and every leg reuses one
  -- match_decision. While all three legs REJECTED, the collision could not occur;
  -- the moment two legs accept, the second would fail 23505 and be read as a
  -- range-CHECK verdict.

  -- (d) percent_allocated = 100 → the range CHECK's upper bound, INCLUSIVE. MUST be accepted.
  raised := FALSE; err_state := NULL;
  BEGIN
    INSERT INTO bridge_outcomes (
      allocator_id, strategy_id, match_decision_id, kind,
      percent_allocated, allocated_at
    ) VALUES (test_uid, test_sid, test_md_id, 'allocated', 100, CURRENT_DATE);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE; err_state := SQLSTATE;
  END;
  IF raised THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956 boundary): percent_allocated=100 is the range CHECK''s INCLUSIVE upper bound and must be ACCEPTED, but a check_violation was raised (state=%). Either the range CHECK was narrowed, or mig-059''s dropped inline CHECK is back.',
      err_state;
  END IF;
  DELETE FROM bridge_outcomes
   WHERE allocator_id = test_uid AND match_decision_id = test_md_id;
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  IF n_rows <> 1 THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956 boundary): percent_allocated=100 raised nothing but left % row(s), expected exactly 1. The INSERT did not land, so "accepted" was not measured.',
      n_rows;
  END IF;

  -- (e) percent_allocated = 0 → the range CHECK's lower bound, INCLUSIVE. MUST be accepted.
  raised := FALSE; err_state := NULL;
  BEGIN
    INSERT INTO bridge_outcomes (
      allocator_id, strategy_id, match_decision_id, kind,
      percent_allocated, allocated_at
    ) VALUES (test_uid, test_sid, test_md_id, 'allocated', 0, CURRENT_DATE);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE; err_state := SQLSTATE;
  END;
  IF raised THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956 boundary): percent_allocated=0 is the range CHECK''s INCLUSIVE lower bound and must be ACCEPTED, but a check_violation was raised (state=%).',
      err_state;
  END IF;
  DELETE FROM bridge_outcomes
   WHERE allocator_id = test_uid AND match_decision_id = test_md_id;
  GET DIAGNOSTICS n_rows = ROW_COUNT;
  IF n_rows <> 1 THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956 boundary): percent_allocated=0 raised nothing but left % row(s), expected exactly 1.',
      n_rows;
  END IF;

  -- (f) percent_allocated = 100.01 → JUST above the upper bound. MUST raise 23514.
  -- ⛔ THIS LEG IS WHY THE RE-BASE IS NOT A WEAKENING. Flipping (d) and (e) to
  -- ACCEPT would otherwise leave `-1` as the only rejecting arm, and a one-sided
  -- boundary test cannot tell a correct `[0, 100]` from a CHECK that lost its
  -- ceiling entirely — the exact defect this file exists to catch. 100.01 fits
  -- NUMERIC(5,2), so a 22003 overflow cannot masquerade as the verdict.
  raised := FALSE; err_state := NULL;
  BEGIN
    INSERT INTO bridge_outcomes (
      allocator_id, strategy_id, match_decision_id, kind,
      percent_allocated, allocated_at
    ) VALUES (test_uid, test_sid, test_md_id, 'allocated', 100.01, CURRENT_DATE);
  EXCEPTION WHEN check_violation THEN
    raised := TRUE; err_state := SQLSTATE;
  END;
  IF NOT raised OR err_state <> '23514' THEN
    RAISE EXCEPTION
      'Test 5 failed (P1956 boundary): percent_allocated=100.01 is ABOVE the range CHECK''s upper bound and must raise 23514, raised=%, state=%. The ceiling is gone.',
      raised, err_state;
  END IF;

  -- Note: an earlier draft attempted to DROP mig-128's CHECK in a
  -- SAVEPOINT to prove mig-059's inline CHECK is still the proximate
  -- cause for percent_allocated=75 — but ROLLBACK TO SAVEPOINT is a
  -- transaction-control statement that plpgsql DO blocks cannot execute.
  -- The boundary tests at -1 / 0 / 100 above already prove the CHECK
  -- shape works; the assertion-(g) in mig 128's own STEP-3 DO block
  -- already proves the new CHECK is named, present, and validated.

  RAISE NOTICE 'Test 5 passed: P1956 range CHECK boundaries verified — -1 and 100.01 REJECTED, 0 and 100 ACCEPTED (inclusive [0,100]; mig-059''s inline CHECK is dropped, see 20260528223200)';

  DELETE FROM match_decisions WHERE id = test_md_id;
  DELETE FROM strategies WHERE id = test_sid;
  DELETE FROM api_keys WHERE id = test_kid;
  DELETE FROM profiles WHERE id = test_uid;
  DELETE FROM auth.users WHERE id = test_uid;
END $$;

ROLLBACK;
