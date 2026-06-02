-- ===========================================================================
-- B5b: api_keys deletion atomicity — close the concurrent-user TOCTOU class
-- ===========================================================================
-- Audit cluster (audit-2026-05-07): four findings, ONE class — "count the
-- references, then conditionally DELETE" executed as TWO statements (or two
-- round-trips) so a concurrent user session (parallel browser tabs) can slip
-- an INSERT between the read and the write and either wipe legitimate data or
-- orphan a freshly-attached row. These are CONCURRENT-USER races (not
-- multi-worker), so the single-worker analytics deploy does NOT protect them.
-- All four cause SILENT data loss with no log trail.
--
--   M-1020 (silent-failure c8) · delete_allocator_api_key last-key cascade:
--     `SELECT count(*) api_keys; IF 0 THEN DELETE allocator_equity_snapshots`
--     — a concurrent "Add Key" committing between the count and the wipe lets
--     count read 0 while a sibling key exists, wiping the multi-key series.
--     FIX: collapse to ONE statement — `DELETE ... WHERE NOT EXISTS(api_keys)`.
--     The NOT EXISTS subquery and the DELETE evaluate against a single
--     statement snapshot, so there is no read→write window to race.
--
--   M-1021 (code-review c8) · delete_allocator_api_key lock_timeout scope:
--     `SET lock_timeout='3s'` (migration 077) sits at the migration-transaction
--     level — it bounds the CREATE FUNCTION's catalog locks, NOT the runtime
--     lock waits of future callers. FIX: attach `SET lock_timeout='3s'` as a
--     FUNCTION attribute so every invocation inherits the 3s table/row-lock
--     ceiling.
--
--   H-1186 (red-team c9, chain) · two independent racy "count + delete"
--     patterns — the delete_allocator_api_key cascade (above) AND the worker's
--     sole-key equity replace — can interleave on the same allocator. FIX:
--     a per-allocator transaction advisory lock keyed on
--     hashtext('alloc:' || <allocator_uuid>) taken at the top of BOTH
--     delete_allocator_api_key (caller = the user, auth.uid()) and
--     replace_allocator_equity_snapshots (caller = the worker, p_allocator_id).
--     For one allocator auth.uid() == p_allocator_id, so the two SECDEF paths
--     serialize on the SAME lock key and can no longer interleave their
--     snapshot mutations. (The worker's wipe-then-crash zero-history window was
--     already closed by E4 / migration 20260527102050 making the replace one
--     transaction; this lock closes the remaining cross-path interleave.)
--
--   M-0347 (code-review c9) · strategies/draft/[id] + cron/cleanup-wizard-drafts
--     both do `SELECT count(*) strategies WHERE api_key_id=X; IF 0 THEN
--     DELETE api_keys` — a concurrent wizard session re-attaching the key
--     between the count and the delete gets its fresh strategy's key revoked
--     (FK ON DELETE SET NULL). FIX: one dual-mode SECDEF RPC
--     delete_api_key_if_unreferenced(p_api_key_id) doing a single-statement
--     `DELETE FROM api_keys WHERE id=X AND <owner-gate> AND NOT EXISTS(
--     SELECT 1 FROM strategies WHERE api_key_id=X)`. Used by BOTH the
--     user-driven route (authenticated, owner-scoped via auth.uid()) and the
--     service-role cron (auth.uid() IS NULL arm, cross-user orphan sweep).
--
-- APPLICATION PATH
-- ----------------
-- Authored here; auto-applied to the linked Supabase project on merge to main
-- (supabase-migrate workflow). The self-verifying DO block at the tail raises
-- EXCEPTION on any invariant failure. CREATE OR REPLACE throughout —
-- idempotent-safe re-apply; grants restated so each function is self-contained.
-- ===========================================================================

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- 1. delete_allocator_api_key — advisory lock + single-statement last-key
--    cascade + function-scoped lock_timeout (M-1020 + M-1021 + H-1186 RPC half)
-- ==========================================================================
-- Rewrites migration 077 (20260422182451). Behaviour preserved EXACTLY except:
--   (a) per-allocator advisory xact lock at entry (H-1186),
--   (b) Step-4 count-then-delete collapsed to one NOT EXISTS statement (M-1020),
--   (c) lock_timeout pinned as a function attribute (M-1021).
-- The v_remaining_keys local is removed — its only use was the racy count.
CREATE OR REPLACE FUNCTION public.delete_allocator_api_key(
  p_api_key_id uuid,
  p_cascade_holdings boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'                       -- M-1021: now applies to callers
AS $$
DECLARE
  v_owner              uuid;
  v_holdings_deleted   integer := 0;
BEGIN
  -- H-1186: serialize all per-allocator key-deletion + equity-replace work on
  -- one transaction-scoped advisory lock (auto-released on commit/rollback).
  -- replace_allocator_equity_snapshots takes the SAME key, so the worker's
  -- sole-key replace cannot interleave with this cascade. auth.uid() is the
  -- allocator id; follows the same pg_advisory_xact_lock(hashtext(...))
  -- convention as sync_trades (migration 20260406065011), keyed here on the
  -- allocator to match the worker's p_allocator_id key below.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || auth.uid()::text));

  -- Step 1: verify caller owns the key (also covers "key does not exist"
  -- — SELECT returns NULL which fails the equality check below).
  SELECT user_id INTO v_owner FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'delete_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';
  END IF;

  -- Step 2: cascade-delete holdings if requested. Without this, the
  -- api_keys DELETE below fails on the 23503 FK restrict from
  -- allocator_holdings (migration 066 STEP 1). Client handles that error.
  IF p_cascade_holdings THEN
    DELETE FROM allocator_holdings
    WHERE api_key_id = p_api_key_id
      AND allocator_id = auth.uid();
    GET DIAGNOSTICS v_holdings_deleted = ROW_COUNT;
  END IF;

  -- Step 3: delete the key.
  DELETE FROM api_keys WHERE id = p_api_key_id AND user_id = auth.uid();

  -- Step 4: last-key equity cascade (migration 077 semantics, M-1020 fix).
  -- Only wipe the equity series when the user explicitly asked for hard
  -- delete (cascade=true) AND they have no other keys left. Multi-key users
  -- keep their aggregated series intact.
  --
  -- M-1020: this is ONE statement — the NOT EXISTS key-presence check and the
  -- snapshot DELETE share a single statement snapshot, eliminating the TOCTOU
  -- window the prior `SELECT count(*); IF 0 THEN DELETE` had. A concurrent
  -- "Add Key" INSERT committing here is either visible to the NOT EXISTS
  -- (=> a sibling exists => no wipe) or not yet committed (=> this statement
  -- already ran, and the new key's reconstruct repopulates) — never a stale
  -- count=0 followed by a wipe of a now-multi-key series.
  IF p_cascade_holdings THEN
    DELETE FROM allocator_equity_snapshots
      WHERE allocator_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );
  END IF;

  RETURN v_holdings_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_allocator_api_key(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_allocator_api_key(uuid, boolean)
  TO authenticated;

-- ==========================================================================
-- 2. delete_api_key_if_unreferenced — atomic orphan-key revoke (M-0347)
-- ==========================================================================
-- Single-statement check+delete shared by the user-driven draft DELETE route
-- (authenticated) and the service-role cleanup-wizard-drafts cron. Dual-mode
-- owner gate:
--   * authenticated caller  → auth.uid() is the user id → may delete only
--     their OWN unreferenced key (user_id = auth.uid()).
--   * service caller        → auth.uid() IS NULL AND role <> 'anon' → the cron
--     orphan sweep may delete ANY unreferenced key. An authenticated request
--     always carries a JWT `sub` (auth.uid() non-null), so it can only ever hit
--     the owner arm; anon is REVOKEd AND blocked at the gate (role='anon') as
--     defense-in-depth against a future grant regression.
-- The NOT EXISTS makes the reference check + delete atomic so a concurrent
-- wizard re-attaching the key cannot have its strategy's key revoked.
CREATE OR REPLACE FUNCTION public.delete_api_key_if_unreferenced(
  p_api_key_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.api_keys
   WHERE id = p_api_key_id
     -- Dual-mode owner gate (M-0347): the caller owns the key, OR the caller is
     -- a trusted non-end-user service context. auth.uid() IS NULL identifies a
     -- no-`sub` JWT (service_role, whether its claims are populated or bare).
     -- The `auth.role() IS DISTINCT FROM 'anon'` clause is defense-in-depth
     -- (rls-auditor MED-8): even if a future migration regressed EXECUTE to
     -- anon, an anon caller (role='anon', auth.uid() NULL) still could NOT reach
     -- the cross-user arm. It is TRUE for both claimed ('service_role') and bare
     -- (NULL role) service callers, so the cleanup-wizard-drafts cron is
     -- unaffected. The primary gate remains the REVOKE FROM anon below.
     AND (
       user_id = auth.uid()
       OR (auth.uid() IS NULL AND auth.role() IS DISTINCT FROM 'anon')
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.strategies WHERE api_key_id = p_api_key_id
     );
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.delete_api_key_if_unreferenced(uuid) IS
  'Atomic orphan-key revoke (audit M-0347): DELETE the api_key IFF no strategy references it, in one statement (no count-then-delete TOCTOU). Dual-mode owner gate — authenticated deletes only its own key (user_id=auth.uid()); a service caller (auth.uid() NULL, role<>anon) sweeps any unreferenced key for the cleanup-wizard-drafts cron. anon is REVOKEd and also blocked at the gate (defense-in-depth).';

REVOKE ALL ON FUNCTION public.delete_api_key_if_unreferenced(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_api_key_if_unreferenced(uuid)
  TO authenticated, service_role;

-- ==========================================================================
-- 3. replace_allocator_equity_snapshots — same per-allocator advisory lock
--    (H-1186 worker half)
-- ==========================================================================
-- ⚠️ This function was LAST defined by migration 20260529160000 (CL9 /
-- NEW-C01-11), NOT 20260527102050 (E4). CL9 added the 7th column
-- `pre_terminus_balance_unknown` to the INSERT + jsonb_to_recordset. This
-- CREATE OR REPLACE re-applies the CL9 body VERBATIM (all 7 columns) and adds
-- ONLY the per-allocator advisory lock + function-scoped lock_timeout. Dropping
-- the CL9 column here would silently revert NEW-C01-11 and re-expose the
-- OKX-terminus garbage equity curve — the exact silent-data-loss class this
-- migration closes. The DO block below asserts the column persists.
--
-- The advisory lock keys on hashtext('alloc:' || p_allocator_id) — the SAME
-- key delete_allocator_api_key uses (auth.uid() == p_allocator_id for one
-- allocator) so the worker's sole-key replace serializes with a concurrent
-- last-key cascade. Signature, SECURITY DEFINER, search_path, WR-05 depth,
-- scoping, and grants are otherwise unchanged from CL9.
CREATE OR REPLACE FUNCTION replace_allocator_equity_snapshots(
  p_allocator_id UUID,
  p_rows         JSONB,    -- array of {asof, value_usd, breakdown, source, pre_terminus_balance_unknown}
  p_depth_months INTEGER   -- per WR-05: applied only to source='exchange_primary' rows
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET lock_timeout = '3s'
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  -- H-1186: serialize against delete_allocator_api_key on the same per-allocator
  -- key so a concurrent last-key cascade cannot interleave with this replace.
  PERFORM pg_advisory_xact_lock(hashtext('alloc:' || p_allocator_id::text));

  -- 1. Purge — strictly scoped to this allocator.
  DELETE FROM public.allocator_equity_snapshots
    WHERE allocator_id = p_allocator_id;

  -- 2. Insert the freshly replayed rows. jsonb_to_recordset projects the
  --    array; reconstructed_at uses the column DEFAULT (now()). The CASE on
  --    source mirrors persist_equity_snapshots' WR-05 per-row depth rule.
  --    CL9: pre_terminus_balance_unknown is projected too; COALESCE to false
  --    keeps a pre-deploy worker (payload omits the field) NOT-NULL-safe.
  WITH ins AS (
    INSERT INTO public.allocator_equity_snapshots (
      allocator_id, asof, value_usd, breakdown, source, history_depth_months,
      pre_terminus_balance_unknown
    )
    SELECT
      p_allocator_id,
      r.asof,
      r.value_usd,
      r.breakdown,
      r.source,
      CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END,
      COALESCE(r.pre_terminus_balance_unknown, false)
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
      asof                          DATE,
      value_usd                     NUMERIC,
      breakdown                     JSONB,
      source                        TEXT,
      pre_terminus_balance_unknown  BOOLEAN
    )
    ON CONFLICT (allocator_id, asof) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer) IS
  'Atomic sole-key equity-history replacement: per-allocator advisory-lock (H-1186) then DELETE all rows for p_allocator_id then INSERT p_rows in ONE transaction (E4/HIGH8). Serializes with delete_allocator_api_key on hashtext(''alloc:''||allocator). Per-row history_depth_months mirrors persist_equity_snapshots WR-05; persists pre_terminus_balance_unknown (CL9/NEW-C01-11, COALESCE to false). service_role only.';

REVOKE ALL ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer)
  TO service_role;

-- ==========================================================================
-- Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_user        uuid := gen_random_uuid();
  v_key_ref     uuid := gen_random_uuid();   -- key WITH a referencing strategy
  v_key_orphan  uuid := gen_random_uuid();   -- key WITHOUT one
  v_src         text;
  v_cfg         text[];
  v_deleted     integer;
  v_count       integer;
BEGIN
  -- ---- (a) delete_allocator_api_key structural invariants ----
  SELECT prosrc, proconfig INTO v_src, v_cfg
    FROM pg_proc WHERE proname = 'delete_allocator_api_key' AND pronargs = 2;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'B5b failed: delete_allocator_api_key(uuid,boolean) missing';
  END IF;
  IF v_src NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'B5b failed: delete_allocator_api_key missing advisory lock (H-1186)';
  END IF;
  IF v_src NOT LIKE '%NOT EXISTS%' THEN
    RAISE EXCEPTION 'B5b failed: delete_allocator_api_key Step-4 not collapsed to NOT EXISTS (M-1020)';
  END IF;
  IF v_src LIKE '%v_remaining_keys%' THEN
    RAISE EXCEPTION 'B5b failed: delete_allocator_api_key still references the racy v_remaining_keys count (M-1020)';
  END IF;
  IF v_cfg IS NULL OR NOT ('lock_timeout=3s' = ANY(v_cfg)) THEN
    RAISE EXCEPTION 'B5b failed: delete_allocator_api_key lock_timeout not pinned as a function attribute (M-1021); proconfig=%',
      COALESCE(array_to_string(v_cfg, ','), '<null>');
  END IF;
  IF NOT has_function_privilege('authenticated',
       'public.delete_allocator_api_key(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b failed: authenticated lacks EXECUTE on delete_allocator_api_key';
  END IF;
  IF has_function_privilege('anon',
       'public.delete_allocator_api_key(uuid, boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b failed: anon unexpectedly has EXECUTE on delete_allocator_api_key';
  END IF;

  -- ---- (b) replace_allocator_equity_snapshots: matching lock + CL9 parity ----
  SELECT prosrc INTO v_src
    FROM pg_proc WHERE proname = 'replace_allocator_equity_snapshots' AND pronargs = 3;
  IF v_src IS NULL OR v_src NOT LIKE '%pg_advisory_xact_lock%' THEN
    RAISE EXCEPTION 'B5b failed: replace_allocator_equity_snapshots missing matching advisory lock (H-1186 worker half)';
  END IF;
  -- CL9 / NEW-C01-11 regression guard: this CREATE OR REPLACE must NOT drop the
  -- pre_terminus_balance_unknown column persistence that migration 20260529160000
  -- added (dropping it silently re-exposes the OKX-terminus garbage curve).
  IF v_src NOT LIKE '%pre_terminus_balance_unknown%' THEN
    RAISE EXCEPTION 'B5b failed: replace_allocator_equity_snapshots dropped CL9 pre_terminus_balance_unknown persistence (NEW-C01-11 reverted)';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.replace_allocator_equity_snapshots(uuid, jsonb, integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b failed: service_role lacks EXECUTE on replace_allocator_equity_snapshots';
  END IF;
  -- Gap-1 (pr-test-analyzer): the H-1186 serialization only works if BOTH
  -- functions hash the IDENTICAL lock-key string. A typo in either prefix would
  -- pass the "has a lock" checks yet silently defeat serialization. Assert both
  -- derive the key from the same hashtext('alloc:' || ...) expression.
  IF v_src NOT LIKE '%hashtext(''alloc:'' ||%' THEN
    RAISE EXCEPTION 'B5b failed: replace_allocator_equity_snapshots lock key is not the expected alloc-scoped hashtext prefix — H-1186 serialization would not match delete_allocator_api_key';
  END IF;
  SELECT prosrc INTO v_src
    FROM pg_proc WHERE proname = 'delete_allocator_api_key' AND pronargs = 2;
  IF v_src NOT LIKE '%hashtext(''alloc:'' ||%' THEN
    RAISE EXCEPTION 'B5b failed: delete_allocator_api_key lock key is not the expected alloc-scoped hashtext prefix — H-1186 serialization would not match the worker half';
  END IF;

  -- ---- (c) delete_api_key_if_unreferenced grants ----
  IF NOT has_function_privilege('authenticated',
       'public.delete_api_key_if_unreferenced(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b failed: authenticated lacks EXECUTE on delete_api_key_if_unreferenced';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.delete_api_key_if_unreferenced(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b failed: service_role lacks EXECUTE on delete_api_key_if_unreferenced';
  END IF;
  IF has_function_privilege('anon',
       'public.delete_api_key_if_unreferenced(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'B5b failed: anon unexpectedly has EXECUTE on delete_api_key_if_unreferenced';
  END IF;

  -- ---- (d) delete_api_key_if_unreferenced FUNCTIONAL probe ----
  -- auth.uid() is NULL during migration (no JWT) => the service-role arm is
  -- exercised, which isolates the NOT EXISTS reference guard. Seed a user with
  -- two keys: one referenced by a strategy, one orphaned.
  INSERT INTO auth.users (id, email)
    VALUES (v_user, 'b5b-probe-' || v_user || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, display_name)
    VALUES (v_user, 'b5b-probe') ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.api_keys (id, user_id, exchange, label, api_key_encrypted)
    VALUES (v_key_ref,    v_user, 'binance', 'ref',    'x'),
           (v_key_orphan, v_user, 'binance', 'orphan', 'x');
  INSERT INTO public.strategies (user_id, name, api_key_id)
    VALUES (v_user, 'refs-the-key', v_key_ref);

  -- Referenced key must NOT be deleted.
  SELECT public.delete_api_key_if_unreferenced(v_key_ref) INTO v_deleted;
  IF v_deleted <> 0 THEN
    RAISE EXCEPTION 'B5b failed: delete_api_key_if_unreferenced wrongly deleted a REFERENCED key (got %)', v_deleted;
  END IF;
  SELECT count(*) INTO v_count FROM public.api_keys WHERE id = v_key_ref;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'B5b failed: referenced key vanished post-call (count=%)', v_count;
  END IF;

  -- Orphan key must BE deleted.
  SELECT public.delete_api_key_if_unreferenced(v_key_orphan) INTO v_deleted;
  IF v_deleted <> 1 THEN
    RAISE EXCEPTION 'B5b failed: delete_api_key_if_unreferenced did NOT delete an orphan key (got %)', v_deleted;
  END IF;
  SELECT count(*) INTO v_count FROM public.api_keys WHERE id = v_key_orphan;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'B5b failed: orphan key survived deletion (count=%)', v_count;
  END IF;

  -- Cleanup (FK cascades from profiles/auth.users handle children).
  DELETE FROM public.strategies WHERE user_id = v_user;
  DELETE FROM public.api_keys WHERE user_id = v_user;
  DELETE FROM public.profiles WHERE id = v_user;
  DELETE FROM auth.users WHERE id = v_user;

  RAISE NOTICE 'B5b migration: all self-verification assertions (a-d) passed.';
END
$$;

COMMIT;
