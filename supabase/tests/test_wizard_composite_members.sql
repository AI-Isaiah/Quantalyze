-- Test for migration 20260710180000_wizard_composite.sql — the wholesale
-- membership writer set_wizard_composite_members. Phase 88 (ONB-03 / L-4).
--
-- set_wizard_composite_members(p_user_id, p_strategy_id, p_members jsonb)
-- rewrites a composite draft's strategy_keys membership WHOLESALE: DELETE all
-- members for the strategy, then INSERT one row per p_members element with
-- seq derived SERVER-SIDE from window_start ASC order (1-indexed) and
-- owner_id = p_user_id. The client NEVER sends seq. Because the write is
-- delete-then-insert (not an in-place UPDATE), no transient
-- (strategy_id, seq) 23505 can occur when members are reordered — this is the
-- deliberate dissolution of L-4 (assemble-then-write, no DEFERRABLE, no
-- persisted seq swap; RESEARCH Pillar C). Cross-tenant coherence is enforced by
-- the EXISTING strategy_keys_owner_coherence trigger (no new trigger added).
--
-- This file asserts:
--   Part 1 — wholesale + seq-by-window: 3 members submitted OUT of window order
--            → seq assigned 1..3 by window_start ASC, all 3 rows present, the
--            function returns 3.
--   Part 2 — idempotent re-submit: the SAME 3 members again succeed (no 23505)
--            and leave exactly the same final set (delete-then-insert proven).
--   Part 3 — reorder without the L-4 trap: re-submit with two members' windows
--            swapped → seq follows the NEW window order, NO transient unique
--            violation.
--   Part 4 — owner-coherence: a member whose api_key_id belongs to ANOTHER
--            tenant RAISEs via the existing trigger ('%must match%' arm), and
--            the prior membership survives the aborted call.
--   Part 5 — composite-only guard: targeting a SINGLE-KEY strategy (api_key_id
--            IS NOT NULL) RAISEs — members can never be attached to a
--            single-key row (protects the composite-detection invariant).
--
-- pgTAP is NOT installed (CLAUDE.md). Plain PL/pgSQL `DO $$ ... $$` with
-- RAISE EXCEPTION on failure / RAISE NOTICE on pass, mirroring the other
-- supabase/tests/test_*.sql files. No psql backslash meta-commands. Under
-- `psql -v ON_ERROR_STOP=1` (what .github/workflows/ci.yml `sql-tests` runs) a
-- failed assertion exits non-zero and fails the job. Filename matches the
-- `test_*.sql` glob so the job auto-discovers it (with migration 20260710180000
-- applied). Pre-migration (RED): the first call errors (function absent) and
-- ON_ERROR_STOP aborts.
--
-- Hygiene: all fixture work runs inside an explicit transaction that ends in
-- ROLLBACK; all ids are gen_random_uuid() and emails are uuid-derived, so a
-- concurrent CI run cannot collide and no pre-clean is needed. auth.uid() is
-- driven by set_config on request.jwt.claims; the outer block stays in the
-- service-role role so verification SELECTs bypass RLS.
--
-- Usage:
--   psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f \
--     supabase/tests/test_wizard_composite_members.sql

BEGIN;

DO $$
DECLARE
  uid_a        UUID := gen_random_uuid();  -- composite owner
  uid_b        UUID := gen_random_uuid();  -- foreign tenant (cross-tenant arm)
  key1         UUID;
  key2         UUID;
  key3         UUID;
  key_single   UUID;
  key_b        UUID;
  strat_comp   UUID;
  strat_single UUID;
  v_count      INTEGER;
  v_seq1       INTEGER;
  v_seq2       INTEGER;
  v_seq3       INTEGER;
  row_cnt      INTEGER;
  raised       BOOLEAN;
  err_msg      TEXT;
  v_status     TEXT;   -- RT-FINDING-1: strategy_analytics.computation_status probe
BEGIN
  -- ----- SEED (service-role context — bypasses RLS, fires triggers) ----------
  -- Tenant A: 4 api_keys + one composite DRAFT (api_key_id defaults NULL) + one
  -- single-key strategy (api_key_id set) for the Part 5 guard.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_a, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-mem-' || uid_a || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_a, 'wizcomp mem a', 'test-wizcomp-mem-' || uid_a || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;

  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'mem k1', 'x') RETURNING id INTO key1;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'mem k2', 'x') RETURNING id INTO key2;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'mem k3', 'x') RETURNING id INTO key3;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_a, 'binance', 'mem single', 'x') RETURNING id INTO key_single;

  -- Composite draft: api_key_id NULL (defaulted), status draft, wizard source.
  INSERT INTO strategies (user_id, name, status, source, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'wizcomp mem composite', 'draft', 'wizard', '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_comp;

  -- Single-key strategy: api_key_id set (the composite-only guard must reject).
  INSERT INTO strategies (user_id, name, status, api_key_id, strategy_types, subtypes, markets, supported_exchanges)
  VALUES (uid_a, 'wizcomp mem single-key', 'draft', key_single, '{}', '{}', '{}', ARRAY['binance'])
  RETURNING id INTO strat_single;

  -- Tenant B: one foreign api_key for the cross-tenant coherence arm.
  INSERT INTO auth.users (id, instance_id, email, created_at, updated_at)
  VALUES (uid_b, '00000000-0000-0000-0000-000000000000',
          'test-wizcomp-mem-' || uid_b || '@quantalyze.test', now(), now());
  INSERT INTO profiles (id, display_name, email, role)
  VALUES (uid_b, 'wizcomp mem b', 'test-wizcomp-mem-' || uid_b || '@quantalyze.test', 'manager')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, display_name = EXCLUDED.display_name;
  INSERT INTO api_keys (user_id, exchange, label, api_key_encrypted)
  VALUES (uid_b, 'binance', 'mem b key', 'x') RETURNING id INTO key_b;

  -- Drive auth.uid() = uid_a for every set_wizard_composite_members call.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', uid_a::text, 'role', 'authenticated')::text, true);

  -- ======================================================================
  -- Part 1 — wholesale write + seq-by-window (submitted OUT of order)
  -- ======================================================================
  -- Submission order key2, key1, key3; window_starts 2025-06 / 2025-01 / 2025-09.
  -- Expected seq by window_start ASC: key1 -> 1, key2 -> 2, key3 -> 3.
  SELECT public.set_wizard_composite_members(
    uid_a, strat_comp,
    jsonb_build_array(
      jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01'),
      jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
      jsonb_build_object('api_key_id', key3::text, 'window_start', '2025-09-01', 'window_end', NULL)
    )
  ) INTO v_count;

  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): set_wizard_composite_members returned %, expected 3 (member count)', v_count;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE strategy_id = strat_comp;
  IF row_cnt <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): % strategy_keys rows after wholesale write, expected 3', row_cnt;
  END IF;
  SELECT seq INTO v_seq1 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key1;
  SELECT seq INTO v_seq2 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key2;
  SELECT seq INTO v_seq3 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key3;
  IF v_seq1 <> 1 OR v_seq2 <> 2 OR v_seq3 <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 1): seq not assigned by window_start ASC (key1=%, key2=%, key3=%; expected 1,2,3)', v_seq1, v_seq2, v_seq3;
  END IF;

  -- ======================================================================
  -- Part 2 — idempotent re-submit (same members, no 23505)
  -- ======================================================================
  raised := FALSE;
  BEGIN
    SELECT public.set_wizard_composite_members(
      uid_a, strat_comp,
      jsonb_build_array(
        jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01'),
        jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
        jsonb_build_object('api_key_id', key3::text, 'window_start', '2025-09-01', 'window_end', NULL)
      )
    ) INTO v_count;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): idempotent re-submit RAISED (%) — delete-then-insert should never trip a unique violation', err_msg;
  END IF;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): re-submit returned %, expected 3', v_count;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE strategy_id = strat_comp;
  IF row_cnt <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): % rows after idempotent re-submit, expected exactly 3 (no duplicates accumulated)', row_cnt;
  END IF;
  SELECT seq INTO v_seq1 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key1;
  IF v_seq1 <> 1 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 2): final set drifted after re-submit (key1 seq=%, expected 1)', v_seq1;
  END IF;

  -- ======================================================================
  -- Part 3 — reorder without the L-4 seq-swap trap
  -- ======================================================================
  -- Swap key1 <-> key2 window_starts. New window_start ASC order: key2 (01) ->
  -- 1, key1 (06) -> 2, key3 (09) -> 3. An in-place UPDATE would transiently
  -- collide on (strategy_id, seq); delete-then-insert cannot.
  raised := FALSE;
  BEGIN
    SELECT public.set_wizard_composite_members(
      uid_a, strat_comp,
      jsonb_build_array(
        jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01'),
        jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
        jsonb_build_object('api_key_id', key3::text, 'window_start', '2025-09-01', 'window_end', NULL)
      )
    ) INTO v_count;
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3): reorder RAISED (%) — a transient (strategy_id, seq) collision means the write is not wholesale (L-4 not dissolved)', err_msg;
  END IF;
  SELECT seq INTO v_seq1 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key1;
  SELECT seq INTO v_seq2 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key2;
  SELECT seq INTO v_seq3 FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key3;
  IF v_seq2 <> 1 OR v_seq1 <> 2 OR v_seq3 <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 3): seq did not follow the NEW window order (key2=%, key1=%, key3=%; expected 1,2,3)', v_seq2, v_seq1, v_seq3;
  END IF;

  -- ======================================================================
  -- Part 4 — owner-coherence: cross-tenant api_key attach RAISEs
  -- ======================================================================
  -- key_b belongs to tenant B; owner_id would be uid_a. The existing
  -- strategy_keys_owner_coherence trigger fires the '%must match%' arm.
  raised := FALSE;
  BEGIN
    PERFORM public.set_wizard_composite_members(
      uid_a, strat_comp,
      jsonb_build_array(
        jsonb_build_object('api_key_id', key_b::text, 'window_start', '2025-01-01', 'window_end', NULL)
      )
    );
  EXCEPTION WHEN raise_exception THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): a cross-tenant api_key member was ACCEPTED — owner-coherence trigger not firing for the SECDEF wholesale write (T-88-04)';
  END IF;
  IF err_msg NOT LIKE '%must match%' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): cross-tenant attach raised the WRONG arm (expected owner-mismatch, got: %)', err_msg;
  END IF;
  -- The aborted call must have rolled back — the Part 3 membership survives.
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE strategy_id = strat_comp;
  IF row_cnt <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): membership was not restored after the aborted cross-tenant write (count=%, expected 3)', row_cnt;
  END IF;
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE strategy_id = strat_comp AND api_key_id = key_b;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 4): a cross-tenant member leaked into the membership (count=%)', row_cnt;
  END IF;

  -- ======================================================================
  -- Part 5 — composite-only guard: a SINGLE-KEY strategy is rejected
  -- ======================================================================
  -- strat_single has api_key_id set; members must never attach to it.
  raised := FALSE;
  BEGIN
    PERFORM public.set_wizard_composite_members(
      uid_a, strat_single,
      jsonb_build_array(
        jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', NULL)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    raised := TRUE; err_msg := SQLERRM;
  END;
  IF NOT raised THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5): set_wizard_composite_members wrote members to a SINGLE-KEY strategy (api_key_id NOT NULL) — the composite-only guard is missing (T-88-06)';
  END IF;
  SELECT count(*) INTO row_cnt FROM public.strategy_keys WHERE strategy_id = strat_single;
  IF row_cnt <> 0 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 5): the single-key strategy gained % strategy_keys rows despite the guard', row_cnt;
  END IF;

  -- ======================================================================
  -- Part 6/7/8 — RT-FINDING-1: stale composite analytics invalidation.
  -- ======================================================================
  -- A member-set CHANGE must invalidate a COMPLETED strategy_analytics row
  -- (complete/complete_with_warnings -> pending) so the wizard verify step
  -- re-stitches instead of short-circuiting to the OLD set's metrics; a NO-OP
  -- re-Continue (identical set) must leave the row 'complete' (WIZ-05 latency
  -- invariant). Establish a known 2-member baseline, then stamp a 'complete'
  -- composite analytics row and exercise the three cases.
  SELECT public.set_wizard_composite_members(
    uid_a, strat_comp,
    jsonb_build_array(
      jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
      jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01')
    )
  ) INTO v_count;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6 setup): baseline write returned %, expected 2', v_count;
  END IF;

  -- Stamp a COMPLETED composite analytics row (mirrors a finished stitch).
  INSERT INTO strategy_analytics (strategy_id, computation_status, data_quality_flags)
  VALUES (strat_comp, 'complete', jsonb_build_object('composite', true))
  ON CONFLICT (strategy_id) DO UPDATE
    SET computation_status = 'complete', computation_error = NULL;

  -- Part 6 — NO-OP re-Continue (identical set): analytics stays 'complete'.
  PERFORM public.set_wizard_composite_members(
    uid_a, strat_comp,
    jsonb_build_array(
      jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
      jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01')
    )
  );
  SELECT computation_status INTO v_status FROM public.strategy_analytics WHERE strategy_id = strat_comp;
  IF v_status <> 'complete' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 6): an IDENTICAL re-Continue invalidated analytics (status=%, expected complete) — WIZ-05 no-op latency invariant broken', v_status;
  END IF;

  -- Part 7 — CHANGED set (add key3): analytics invalidated to 'pending'.
  PERFORM public.set_wizard_composite_members(
    uid_a, strat_comp,
    jsonb_build_array(
      jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
      jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01'),
      jsonb_build_object('api_key_id', key3::text, 'window_start', '2025-09-01', 'window_end', NULL)
    )
  );
  SELECT computation_status INTO v_status FROM public.strategy_analytics WHERE strategy_id = strat_comp;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 7): adding a key did NOT invalidate the stale composite analytics (status=%, expected pending) — the verify step would show 3 keys beside 2-key metrics', v_status;
  END IF;

  -- Part 8 — CHANGED window at the SAME count (edit key3 window_end): still
  -- invalidated. Proves the signature catches window edits, not just add/remove.
  UPDATE public.strategy_analytics
     SET computation_status = 'complete', computation_error = NULL
   WHERE strategy_id = strat_comp;
  PERFORM public.set_wizard_composite_members(
    uid_a, strat_comp,
    jsonb_build_array(
      jsonb_build_object('api_key_id', key1::text, 'window_start', '2025-01-01', 'window_end', '2025-06-01'),
      jsonb_build_object('api_key_id', key2::text, 'window_start', '2025-06-01', 'window_end', '2025-09-01'),
      jsonb_build_object('api_key_id', key3::text, 'window_start', '2025-09-01', 'window_end', '2025-12-01')
    )
  );
  SELECT computation_status INTO v_status FROM public.strategy_analytics WHERE strategy_id = strat_comp;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'TEST FAILED (Part 8): a window-end edit at the same member count did NOT invalidate analytics (status=%, expected pending)', v_status;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);
  RAISE NOTICE 'test_wizard_composite_members: ALL PASS (wholesale seq-by-window, idempotent re-submit, reorder without L-4, owner-coherence, composite-only guard, RT-1 stale-analytics invalidation on change + no-op preservation).';
END
$$;

ROLLBACK;
