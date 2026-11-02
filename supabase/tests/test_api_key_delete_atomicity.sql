-- Test: api_keys deletion atomicity after the legacy equity table is dropped
-- (B5b migration 20260602183000, re-based by Phase 176 LEGACYRETIRE plan 13,
-- migration 20261104120000, D-02).
--
-- Audit cluster M-1020 / M-1021 / H-1186 / M-0347. The B5b migration closed a
-- concurrent-user TOCTOU class by collapsing "count then conditionally DELETE"
-- into single-statement / advisory-locked SECURITY DEFINER functions. pgTAP is
-- not set up in this project (CLAUDE.md / Lane B) so assertions RAISE EXCEPTION
-- on failure; a clean run prints NOTICEs only. `psql -v ON_ERROR_STOP=1`.
--
-- SUBJECT NOW (Phase 176 D-02, D-09): the delete RPC with the legacy table GONE.
-- The last-key cascade of delete_allocator_api_key used to wipe the allocator's
-- allocator_equity_snapshots rows; the drop migration re-bases it onto the derived
-- rows (D-09: the allocator's equity_curve row and the deleted key's key_inputs
-- row go with the last key) and then drops the table and the four functions that
-- wrote or read it. A last-key cascade delete that still named the table would
-- fail with 42P01 on every account's last key, so Part 3 is the proof that it
-- does not, and that the history the UI promises to remove is removed.
--
-- This SQL test pins what the migration DO block and the mocked TS route/cron
-- tests CANNOT: the real auth.uid() ownership gate of
-- delete_api_key_if_unreferenced (authenticated owner arm + cross-user denial)
-- and the last-key cascade delete under a real session uid, which removes the
-- derived equity_curve row and that key's key_inputs row, only that allocator's.
--
-- Run order: AFTER migration 20261104120000_drop_allocator_equity_snapshots.sql.
-- Seeds use gen_random_uuid() ids cleaned up by id at the end, so concurrent
-- CI runs against the shared test project cannot collide.

-- ==========================================================================
-- Part 1 — structural / privilege posture (no seed)
-- ==========================================================================
DO $$
DECLARE
  v_src   text;
  v_code  text;
  v_cfg   text[];
  v_n     integer;
BEGIN
  -- The legacy table and the four functions that wrote or read it are gone.
  IF to_regclass('public.allocator_equity_snapshots') IS NOT NULL THEN
    RAISE EXCEPTION 'B5b Part 1: public.allocator_equity_snapshots still exists (Phase 176 D-02)';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'B5b Part 1: replace_allocator_equity_snapshots(uuid,jsonb,integer) still exists (Phase 176 D-02)';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'B5b Part 1: replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date) still exists (Phase 176 D-02)';
  END IF;
  IF to_regprocedure('public.extract_symbol_value_at(uuid,text,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'B5b Part 1: extract_symbol_value_at(uuid,text,date) still exists (Phase 176 D-02)';
  END IF;
  IF to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()') IS NOT NULL THEN
    RAISE EXCEPTION 'B5b Part 1: enqueue_refresh_allocator_equity_for_all() still exists (Phase 176 D-02)';
  END IF;

  -- delete_allocator_api_key: exactly one, SECDEF, per-allocator advisory lock,
  -- lock_timeout attr, no leftover racy count var, no mention of the dropped
  -- table or of the seam row (comments stripped: a body that only DISCUSSES the
  -- table in a comment is fine, one that executes against it is not),
  -- authenticated EXECUTE, anon denied.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_allocator_api_key';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B5b Part 1: expected exactly one public.delete_allocator_api_key, found %', v_n;
  END IF;
  SELECT prosrc, proconfig INTO v_src, v_cfg
    FROM pg_proc WHERE proname = 'delete_allocator_api_key' AND pronargs = 2;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key(uuid,boolean) missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'delete_allocator_api_key'
      AND pronargs = 2 AND prosecdef = true
  ) THEN
    RAISE EXCEPTION 'B5b Part 1: delete_allocator_api_key must be SECURITY DEFINER';
  END IF;
  v_code := regexp_replace(regexp_replace(v_src, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g');
  IF v_code NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key missing advisory lock (H-1186)';
  END IF;
  IF v_code NOT LIKE '%hashtext(''alloc:'' ||%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key lock key is not the expected alloc-scoped hashtext prefix';
  END IF;
  IF v_code LIKE '%allocator_equity_snapshots%' THEN
    RAISE EXCEPTION 'B5b Part 1: delete_allocator_api_key still executes against allocator_equity_snapshots (42P01 on every last-key cascade)';
  END IF;
  IF v_code LIKE '%snapshot_rebuild_boundary%' THEN
    RAISE EXCEPTION 'B5b Part 1: delete_allocator_api_key still names the snapshot_rebuild_boundary seam row (Phase 176 D-02)';
  END IF;
  IF v_src LIKE '%v_remaining_keys%' THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key still has racy v_remaining_keys count (M-1020)';
  END IF;
  IF v_cfg IS NULL OR NOT ('lock_timeout=3s' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'B5b: delete_allocator_api_key lock_timeout not a function attribute (M-1021)';
  END IF;
  IF v_cfg IS NULL OR NOT ('search_path=public, pg_temp' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'B5b Part 1: delete_allocator_api_key search_path not locked; proconfig=%',
      COALESCE(array_to_string(v_cfg, ','), '<null>');
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
-- Part 3 — delete_allocator_api_key last-key cascade, with the legacy table gone
-- ==========================================================================
-- Phase 176 D-02. The old Part 3 proved the M-1020 wipe of the allocator's
-- snapshot rows and the CL9 persistence of the replace RPC; both subjects are
-- dropped. What matters now: deleting an allocator's LAST key with the cascade
-- still works end to end (it used to run a DELETE against a table that no longer
-- exists), and it removes the allocator's derived equity_curve row and the deleted
-- key's key_inputs row (D-09), and nothing of any other allocator. A delete that
-- leaves a key behind, or a soft disconnect, removes neither.
DO $$
DECLARE
  v_alloc    uuid := gen_random_uuid();
  v_other    uuid := gen_random_uuid();
  v_key1     uuid := gen_random_uuid();
  v_key2     uuid := gen_random_uuid();
  v_deleted  integer;
  v_n        integer;
BEGIN
  INSERT INTO auth.users (id, email)
    VALUES (v_alloc, 'b5b-sql-alloc-' || v_alloc || '@invalid.local');
  -- handle_new_user trigger already created the profile; absorb it (the
  -- delete_allocator_api_key logic does not read the profile role).
  INSERT INTO public.profiles (id, display_name, role)
    VALUES (v_alloc, 'b5b-alloc', 'allocator')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO auth.users (id, email)
    VALUES (v_other, 'b5b-sql-alloc-other-' || v_other || '@invalid.local');
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
    VALUES (v_alloc, 'equity_curve', '{"marker":"b5b-part3"}'::jsonb),
           (v_alloc, 'key_inputs:' || v_key1, '{"marker":"b5b-part3-inputs"}'::jsonb),
           (v_other, 'equity_curve', '{"marker":"b5b-part3-other"}'::jsonb),
           (v_other, 'key_inputs:' || v_key1, '{"marker":"b5b-part3-other-inputs"}'::jsonb);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_alloc::text, 'role', 'authenticated')::text, true);

  -- (a) Sole key, cascade true, called as its owner: the holdings count comes
  --     back, no key and no holdings row remain, nothing is raised, the
  --     allocator's derived equity_curve row and the deleted key's key_inputs row
  --     are gone (D-09), and another allocator's rows are exactly as they were.
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key1, v_alloc, 'binance', 'k1', 'x');
  INSERT INTO public.allocator_holdings (allocator_id, api_key_id, venue, symbol, asof,
                                         holding_type, side, quantity, value_usd, mark_price)
    VALUES (v_alloc, v_key1, 'binance', 'BTC', DATE '2026-01-01', 'spot', 'flat', 1, 100, 100);

  SELECT public.delete_allocator_api_key(v_key1, true) INTO v_deleted;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(a): sole-key cascade did not report the one deleted holding (got %)', v_deleted;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_key1;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B5b Part 3(a): sole key survived its own delete (count=%)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_holdings WHERE allocator_id = v_alloc;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B5b Part 3(a): holdings survived the cascade (count=%)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.allocator_equity_derived
   WHERE allocator_id = v_alloc
     AND (kind = 'equity_curve' OR kind = 'key_inputs:' || v_key1);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B5b Part 3(a): the derived equity_curve or key_inputs row survived the last-key hard delete (count=%)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.allocator_equity_derived
   WHERE allocator_id = v_other
     AND payload IN ('{"marker":"b5b-part3-other"}'::jsonb, '{"marker":"b5b-part3-other-inputs"}'::jsonb);
  IF v_n <> 2 THEN
    RAISE EXCEPTION 'B5b Part 3(a): the last-key hard delete touched another allocator''s derived rows (count=%)', v_n;
  END IF;

  -- (b) Two keys, cascade true on one: the sibling and its holdings stay, and
  --     the derived equity_curve row is untouched (re-seeded: (a) removed it).
  INSERT INTO public.allocator_equity_derived (allocator_id, kind, payload)
    VALUES (v_alloc, 'equity_curve', '{"marker":"b5b-part3"}'::jsonb);
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key1, v_alloc, 'binance', 'k1b', 'x'),
           (v_key2, v_alloc, 'okx', 'k2', 'x');
  INSERT INTO public.allocator_holdings (allocator_id, api_key_id, venue, symbol, asof,
                                         holding_type, side, quantity, value_usd, mark_price)
    VALUES (v_alloc, v_key1, 'binance', 'BTC', DATE '2026-02-01', 'spot', 'flat', 1, 100, 100),
           (v_alloc, v_key2, 'okx',     'ETH', DATE '2026-02-01', 'spot', 'flat', 2, 200, 100);

  SELECT public.delete_allocator_api_key(v_key1, true) INTO v_deleted;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(b): multi-key delete reported % holdings deleted, expected 1', v_deleted;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_key2;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(b): the sibling key vanished (count=%)', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.allocator_holdings WHERE api_key_id = v_key2;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(b): the sibling key''s holdings were deleted (count=%)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.allocator_equity_derived
   WHERE allocator_id = v_alloc AND kind = 'equity_curve'
     AND payload = '{"marker":"b5b-part3"}'::jsonb;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(b): the derived equity_curve row changed under a multi-key delete (count=%)', v_n;
  END IF;

  -- (c) Soft-disconnect path: cascade false never deletes holdings. With
  --     holdings present the FK restrict refuses the key delete (23503), the key
  --     and its holdings stay; with the holdings gone it deletes the key and
  --     reports 0 holdings. The derived row is untouched either way.
  BEGIN
    PERFORM public.delete_allocator_api_key(v_key2, false);
    RAISE EXCEPTION 'B5b Part 3(c): cascade=false deleted a key that still has holdings';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_key2;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(c): the key vanished although its holdings blocked the delete (count=%)', v_n;
  END IF;
  DELETE FROM public.allocator_holdings WHERE api_key_id = v_key2;
  SELECT public.delete_allocator_api_key(v_key2, false) INTO v_deleted;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'B5b Part 3(c): cascade=false reported % holdings deleted, expected 0', v_deleted;
  END IF;
  SELECT count(*) INTO v_n FROM public.api_keys WHERE id = v_key2;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'B5b Part 3(c): the last key survived a cascade=false delete (count=%)', v_n;
  END IF;
  SELECT count(*) INTO v_n
    FROM public.allocator_equity_derived
   WHERE allocator_id = v_alloc AND kind = 'equity_curve'
     AND payload = '{"marker":"b5b-part3"}'::jsonb;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'B5b Part 3(c): the derived equity_curve row changed under a soft-disconnect (count=%)', v_n;
  END IF;

  PERFORM set_config('request.jwt.claims', NULL, true);

  -- Cleanup.
  DELETE FROM public.allocator_equity_derived WHERE allocator_id IN (v_alloc, v_other);
  DELETE FROM public.allocator_holdings WHERE allocator_id = v_alloc;
  DELETE FROM public.api_keys WHERE user_id = v_alloc;
  DELETE FROM public.profiles WHERE id IN (v_alloc, v_other);
  DELETE FROM auth.users WHERE id IN (v_alloc, v_other);

  RAISE NOTICE 'B5b Part 3: delete_allocator_api_key last-key cascade (true/false) works with the legacy table gone; a last-key hard delete removes that allocator''s derived curve and the key''s inputs row, a multi-key delete and a soft disconnect remove neither.';
END $$;
