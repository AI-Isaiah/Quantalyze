-- Test: B5b api_keys deletion atomicity (migration 20260602183000).
--
-- Audit cluster M-1020 / M-1021 / H-1186 / M-0347. The migration closes a
-- concurrent-user TOCTOU class by collapsing "count then conditionally DELETE"
-- into single-statement / advisory-locked SECURITY DEFINER functions. pgTAP is
-- not set up in this project (CLAUDE.md / Lane B) so assertions RAISE EXCEPTION
-- on failure; a clean run prints NOTICEs only. `psql -v ON_ERROR_STOP=1`.
--
-- This SQL test pins what the migration DO block and the mocked TS route/cron
-- tests CANNOT: the real auth.uid() ownership gate of
-- delete_api_key_if_unreferenced (authenticated owner arm + cross-user denial)
-- and the M-1020 single-statement last-key cascade under a real session uid.
--
-- Run order: AFTER migration 20260602183000_b5b_api_key_delete_atomicity.sql.
-- Seeds use gen_random_uuid() ids cleaned up by id at the end, so concurrent
-- CI runs against the shared test project cannot collide.

-- ==========================================================================
-- Part 1 — structural / privilege posture (no seed)
-- ==========================================================================
DO $$
DECLARE
  v_src  text;
  v_cfg  text[];
BEGIN
  -- delete_allocator_api_key: advisory lock + NOT EXISTS + lock_timeout attr,
  -- no leftover racy count var, authenticated EXECUTE, anon denied.
  SELECT prosrc, proconfig INTO v_src, v_cfg
    FROM pg_proc WHERE proname = 'delete_allocator_api_key' AND pronargs = 2;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key(uuid,boolean) missing';
  END IF;
  IF v_src NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key missing advisory lock (H-1186)';
  END IF;
  IF v_src NOT LIKE '%NOT EXISTS%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key not collapsed to NOT EXISTS (M-1020)';
  END IF;
  IF v_src LIKE '%v_remaining_keys%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key still has racy v_remaining_keys count (M-1020)';
  END IF;
  IF v_cfg IS NULL OR NOT ('lock_timeout=3s' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key lock_timeout not a function attribute (M-1021)';
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.delete_allocator_api_key(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b: authenticated lacks EXECUTE on delete_allocator_api_key';
  END IF;
  IF has_function_privilege('anon',
       'public.delete_allocator_api_key(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b: anon has EXECUTE on delete_allocator_api_key';
  END IF;

  -- delete_api_key_if_unreferenced: SECDEF, search_path locked, dual grants,
  -- anon denied, single-statement NOT EXISTS body.
  SELECT prosrc, proconfig INTO v_src, v_cfg
    FROM pg_proc WHERE proname = 'delete_api_key_if_unreferenced' AND pronargs = 1;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'B5b: delete_api_key_if_unreferenced(uuid) missing';
  END IF;
  IF v_src NOT LIKE '%NOT EXISTS%' THEN
    RAISE EXCEPTION 'B5b: delete_api_key_if_unreferenced not single-statement NOT EXISTS (M-0347)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'delete_api_key_if_unreferenced'
      AND pronargs = 1 AND prosecdef = true
  ) THEN
    RAISE EXCEPTION 'B5b: delete_api_key_if_unreferenced must be SECURITY DEFINER';
  END IF;
  IF v_cfg IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'B5b: delete_api_key_if_unreferenced search_path not locked; proconfig=%',
      COALESCE(array_to_string(v_cfg, ','), '<null>');
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.delete_api_key_if_unreferenced(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b: authenticated lacks EXECUTE on delete_api_key_if_unreferenced';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.delete_api_key_if_unreferenced(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b: service_role lacks EXECUTE on delete_api_key_if_unreferenced';
  END IF;
  IF has_function_privilege('anon',
       'public.delete_api_key_if_unreferenced(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b: anon has EXECUTE on delete_api_key_if_unreferenced';
  END IF;

  -- replace_allocator_equity_snapshots: matching advisory lock, service_role only,
  -- and CL9 / NEW-C01-11 pre_terminus_balance_unknown persistence preserved.
  SELECT prosrc INTO v_src
    FROM pg_proc WHERE proname = 'replace_allocator_equity_snapshots' AND pronargs = 3;
  IF v_src IS NULL OR v_src NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'B5b: replace_allocator_equity_snapshots missing matching advisory lock (H-1186 worker half)';
  END IF;
  IF v_src NOT LIKE '%pre_terminus_balance_unknown%' THEN
    RAISE EXCEPTION 'B5b: replace_allocator_equity_snapshots dropped CL9 pre_terminus_balance_unknown persistence (NEW-C01-11 reverted)';
  END IF;
  IF has_function_privilege('authenticated',
       'public.replace_allocator_equity_snapshots(uuid, jsonb, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b: authenticated unexpectedly has EXECUTE on replace_allocator_equity_snapshots';
  END IF;

  -- Gap-1 (pr-test-analyzer): H-1186 serialization works only if BOTH functions
  -- hash the IDENTICAL lock-key string. A typo in either prefix would pass the
  -- "has a lock" checks yet silently defeat serialization. Assert both derive
  -- the key from the same hashtext('alloc:' || ...) expression.
  IF v_src NOT LIKE '%hashtext(''alloc:'' ||%' THEN
    RAISE EXCEPTION 'B5b: replace_allocator_equity_snapshots lock key is not the expected alloc-scoped hashtext prefix — would not match delete_allocator_api_key';
  END IF;
  SELECT prosrc INTO v_src
    FROM pg_proc WHERE proname = 'delete_allocator_api_key' AND pronargs = 2;
  IF v_src NOT LIKE '%hashtext(''alloc:'' ||%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key lock key is not the expected alloc-scoped hashtext prefix — would not match the worker half';
  END IF;

  RAISE NOTICE 'B5b Part 1: structural/privilege posture OK.';
END $$;

-- ==========================================================================
-- Part 2 — delete_api_key_if_unreferenced functional gate (real auth.uid())
-- ==========================================================================
DO $$
DECLARE
  v_owner   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_key_ref uuid := gen_random_uuid();
  v_key_orf uuid := gen_random_uuid();
  v_deleted integer;
  v_count   integer;
BEGIN
  -- Seed owner + a second user, owner with two keys (one referenced).
  INSERT INTO auth.users (id, email) VALUES
    (v_owner, 'b5b-sql-owner-' || v_owner || '@invalid.local'),
    (v_other, 'b5b-sql-other-' || v_other || '@invalid.local');
  -- A handle_new_user trigger auto-creates a profiles row on the auth.users
  -- insert above, so absorb that with ON CONFLICT (the function logic reads
  -- api_keys.user_id / auth.uid(), not the profile, so the trigger's defaults
  -- are fine).
  INSERT INTO public.profiles (id, display_name) VALUES
    (v_owner, 'b5b-owner'), (v_other, 'b5b-other')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted) VALUES
    (v_key_ref, v_owner, 'binance', 'ref', 'x'),
    (v_key_orf, v_owner, 'binance', 'orf', 'x');
  INSERT INTO public.strategies (user_id, name, api_key_id)
    VALUES (v_owner, 'refs', v_key_ref);

  -- (a) Authenticated owner: referenced key is NOT deleted (NOT EXISTS guard).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SELECT public.delete_api_key_if_unreferenced(v_key_ref) INTO v_deleted;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'B5b Part 2(a): referenced key wrongly deleted (got %)', v_deleted;
  END IF;

  -- (b) Cross-user denial: a DIFFERENT user cannot delete the owner's orphan
  --     key (owner gate user_id = auth.uid()).
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_other::text, 'role', 'authenticated')::text, true);
  SELECT public.delete_api_key_if_unreferenced(v_key_orf) INTO v_deleted;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'B5b Part 2(b): cross-user delete succeeded — ownership gate breached (got %)', v_deleted;
  END IF;
  SELECT count(*) INTO v_count FROM public.api_keys WHERE id = v_key_orf;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B5b Part 2(b): orphan key vanished under cross-user call (count=%)', v_count;
  END IF;

  -- (c) Defense-in-depth (rls-auditor MED-8): an `anon`-role caller must NOT
  --     reach the cross-user arm even on the owner's orphan key. The gate's
  --     `auth.role() IS DISTINCT FROM 'anon'` blocks it (belt to the REVOKE).
  PERFORM set_config('request.jwt.claims', '{"role":"anon"}', true);
  SELECT public.delete_api_key_if_unreferenced(v_key_orf) INTO v_deleted;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'B5b Part 2(c): anon-role call reached the cross-user arm (deleted %) — gate breached', v_deleted;
  END IF;

  -- (d) Authenticated owner: orphan key IS deleted.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated')::text, true);
  SELECT public.delete_api_key_if_unreferenced(v_key_orf) INTO v_deleted;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'B5b Part 2(d): owner did not delete its orphan key (got %)', v_deleted;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Cleanup (cascades: api_keys/strategies hang off profiles → auth.users).
  DELETE FROM public.strategies WHERE user_id IN (v_owner, v_other);
  DELETE FROM public.api_keys WHERE user_id IN (v_owner, v_other);
  DELETE FROM public.profiles WHERE id IN (v_owner, v_other);
  DELETE FROM auth.users WHERE id IN (v_owner, v_other);

  RAISE NOTICE 'B5b Part 2: delete_api_key_if_unreferenced owner/cross-user gate OK.';
END $$;

-- ==========================================================================
-- Part 3 — delete_allocator_api_key M-1020 single-statement last-key cascade
-- ==========================================================================
DO $$
DECLARE
  v_alloc   uuid := gen_random_uuid();
  v_key1    uuid := gen_random_uuid();
  v_key2    uuid := gen_random_uuid();
  v_snaps   integer;
BEGIN
  -- Sole-key allocator: one key + two equity snapshots.
  INSERT INTO auth.users (id, email)
    VALUES (v_alloc, 'b5b-sql-alloc-' || v_alloc || '@invalid.local');
  -- handle_new_user trigger already created the profile; absorb it (the
  -- delete_allocator_api_key logic does not read the profile role).
  INSERT INTO public.profiles (id, display_name, role)
    VALUES (v_alloc, 'b5b-alloc', 'allocator')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key1, v_alloc, 'binance', 'k1', 'x');
  INSERT INTO public.allocator_equity_snapshots (allocator_id, asof, value_usd, source)
    VALUES (v_alloc, DATE '2026-01-01', 100, 'exchange_primary'),
           (v_alloc, DATE '2026-01-02', 200, 'exchange_primary');

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_alloc::text, 'role', 'authenticated')::text, true);

  -- Hard-delete the sole key with cascade → last-key, NOT EXISTS true → wipe.
  PERFORM public.delete_allocator_api_key(v_key1, true);
  SELECT count(*) INTO v_snaps
    FROM public.allocator_equity_snapshots WHERE allocator_id = v_alloc;
  IF v_snaps <> 0 THEN
    RAISE EXCEPTION 'B5b Part 3(a): sole-key cascade did not wipe snapshots (count=%)', v_snaps;
  END IF;

  -- Multi-key allocator: two keys + snapshots; delete ONE with cascade.
  -- A sibling key remains, so NOT EXISTS is false → snapshots KEPT (M-1020:
  -- the wipe must not fire when another key still exists).
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key1, v_alloc, 'binance', 'k1b', 'x'),
           (v_key2, v_alloc, 'okx', 'k2', 'x');
  INSERT INTO public.allocator_equity_snapshots (allocator_id, asof, value_usd, source)
    VALUES (v_alloc, DATE '2026-02-01', 300, 'exchange_primary');

  PERFORM public.delete_allocator_api_key(v_key1, true);
  SELECT count(*) INTO v_snaps
    FROM public.allocator_equity_snapshots WHERE allocator_id = v_alloc;
  IF v_snaps <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(b): multi-key delete wiped a still-shared series (count=%)', v_snaps;
  END IF;

  -- (c) Gap-2 (pr-test-analyzer): soft-disconnect (cascade=false) must NEVER
  --     wipe the equity series, even on the last key. v_key2 is now the sole
  --     remaining key; deleting it with cascade=false leaves the 1 snapshot
  --     intact (the Step-4 wipe is gated behind p_cascade_holdings).
  PERFORM public.delete_allocator_api_key(v_key2, false);
  SELECT count(*) INTO v_snaps
    FROM public.allocator_equity_snapshots WHERE allocator_id = v_alloc;
  IF v_snaps <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(c): cascade=false (soft-disconnect) wiped the equity series (count=%)', v_snaps;
  END IF;

  -- (d) CL9 / NEW-C01-11 functional parity: replace_allocator_equity_snapshots
  --     must PERSIST a pre_terminus_balance_unknown=true row (the column this
  --     migration's CREATE OR REPLACE must not drop). Service-role-shaped call.
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM public.replace_allocator_equity_snapshots(
    v_alloc,
    '[{"asof":"2026-04-01","value_usd":42,"source":"exchange_primary","pre_terminus_balance_unknown":true}]'::jsonb,
    12);
  IF NOT EXISTS (
    SELECT 1 FROM public.allocator_equity_snapshots
     WHERE allocator_id = v_alloc AND asof = DATE '2026-04-01'
       AND pre_terminus_balance_unknown = true
  ) THEN
    RAISE EXCEPTION 'B5b Part 3(d): replace_allocator_equity_snapshots did not persist pre_terminus_balance_unknown=true (CL9 reverted)';
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Cleanup.
  DELETE FROM public.allocator_equity_snapshots WHERE allocator_id = v_alloc;
  DELETE FROM public.api_keys WHERE user_id = v_alloc;
  DELETE FROM public.profiles WHERE id = v_alloc;
  DELETE FROM auth.users WHERE id = v_alloc;

  RAISE NOTICE 'B5b Part 3: delete_allocator_api_key cascade (true/false) + CL9 persistence OK.';
END $$;
