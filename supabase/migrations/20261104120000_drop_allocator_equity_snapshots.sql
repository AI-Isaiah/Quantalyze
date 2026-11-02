-- ============================================================================
-- VAC-04 ACKNOWLEDGEMENT: the PROD body this CREATE OR REPLACE overwrites is
-- the 20261028120000 definition of public.delete_allocator_api_key(uuid, boolean)
-- (step 1 below replaces its Step 4, the last-key cascade). It equals the committed
-- baseline snapshot (PROD-dumped, the post-PR-2 re-dump), so overwriting it is
-- intended. MEASURED 2026-11-02 with the gate's own normalizer:
--   node scripts/sql-body-normalize.mjs --diff-bodies \
--     supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql \
--     supabase/schema/baseline.sql
-- reports MATCH for delete_allocator_api_key/2 at the hash below.
--
-- prod-body-ack: 1b0c406b84d7bda52d1bcc6144835f818253db996d56d36d05ae8d41fb0070e3
--
-- ============================================================================
-- Drop public.allocator_equity_snapshots and every function that writes or reads
-- it (2026-11-04, Phase 176 LEGACYRETIRE, plan 13, PR 3; D-02)
-- ============================================================================
--
-- ⚠️ OPS: merging supabase/migrations/** to main applies to TEST and then to PROD
-- with no human stop. This file destroys a table and its rows on PROD. It is a
-- ONE-WAY production DDL event.
--
-- WHAT D-02 SAYS, quoted from the phase CONTEXT (founder 2026-10-31): "Drop the
-- table, last, in its own migration." This file is that migration.
--
-- Why last and alone. Phase 176 ships in three PRs and the order is the safety.
-- PR 1 moved every reader onto the derived series (allocator_equity_derived,
-- kind equity_curve) and read it live. PR 2 stopped every writer of the legacy
-- table, unscheduled its nightly refresh cron by hand, and was read the next day
-- with zero legacy rows written since the new worker went live. Only then is the
-- table unreachable by anything that still runs, and only then is dropping it a
-- statement about the past rather than a gamble about the present. This is PR 3.
--
-- What this file does, in order
-- -----------------------------
--   1. Re-bases public.delete_allocator_api_key(uuid, boolean) on its latest
--      definition (20261028120000, measured across every migration with grep -l)
--      with its Step 4, the last-key cascade, moved off the legacy table. The old
--      Step 4 held the only two statements that still named the table (the
--      legacy rows) and the snapshot_rebuild_boundary seam row. Plpgsql bodies
--      are not dependency-tracked: leaving that step in place would let the DROP
--      TABLE below succeed and then fail every last-key hard delete with 42P01 at
--      run time. So the re-base comes BEFORE the drop, in the same migration.
--      The new Step 4 is ONE statement under the same key-presence test: it
--      deletes the allocator's allocator_equity_derived equity_curve row and the
--      deleted key's key_inputs:<id> row (founder decision D-09, 2026-11-02: the
--      UI promises that a hard delete removes the account's history, and the
--      derived rows are all of the history there is).
--   2. Drops the four functions whose only subject is the table, each at its exact
--      signature:
--        public.replace_allocator_equity_snapshots(uuid, jsonb, integer)
--        public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date)
--        public.extract_symbol_value_at(uuid, text, date)
--        public.enqueue_refresh_allocator_equity_for_all()
--   3. Deletes every allocator_equity_derived row of kind snapshot_rebuild_boundary.
--      The seam row recorded where a rebuilt window met the days kept from before
--      it, in the legacy table. With the table gone it names nothing.
--   4. Drops the table.
--   5. Verifies the outcome from the catalogue.
--
-- Why the re-base keeps the advisory lock and the search_path pin byte-identical.
-- The per-allocator lock key (hashtext('alloc:' || auth.uid()::text)) was shared
-- with the two replace functions dropped here. After this migration it has no other
-- taker, and it still does a job: it serializes two deletes by one allocator, so a
-- delete of the last key cannot interleave with a delete of its sibling. It stays,
-- and its comment inside the body now says so. The `SET search_path = public,
-- pg_temp` and `SET lock_timeout = '3s'` attributes, the signature, SECURITY
-- DEFINER, Steps 1 to 3 and the return value are copied verbatim from
-- 20261028120000; the only differences are Step 4 re-homed on the derived rows
-- and the lock comment reworded. CREATE OR REPLACE keeps the existing ACL, but the REVOKE and GRANT
-- are re-issued below at the full signature so the ACL is stated here and the
-- verify block can assert it.
--
-- Why no CASCADE and no IF EXISTS. Neither modifier appears in this file, on
-- purpose.
--   The existence-tolerant form turns a signature mismatch into a vacuous pass:
--   aimed at a signature the database does not hold, the statement removes nothing
--   and succeeds. Without it the same mismatch is an error that names the object.
--   The dependent-removing form takes out objects nobody listed, silently, in a
--   production transaction. Without it, a dependent the census missed (a view, a
--   foreign key, a function with a real dependency) aborts the DROP and names
--   itself. The apply goes to shared TEST first, and a failed TEST apply blocks
--   the PROD apply, so a missed dependent fails on TEST and PROD never sees it.
--
-- ⛔ NO DATA CENSUS RUNS INSIDE THIS MIGRATION. Shared TEST holds PROD's catalogue
-- and none of its data, so a check that reads rows would pass on PROD and refuse on
-- TEST (or the reverse), and a failed TEST apply blocks the PROD apply. The verify
-- block reads the catalogue only (pg_class through to_regclass, pg_proc,
-- pg_namespace, has_function_privilege, aclexplode). The DELETEs here carry
-- no row-conditioned RAISE.
--
-- Transaction control. NO explicit BEGIN/COMMIT: Supabase wraps each migration in
-- an implicit transaction (migration-reviewer invariant #14), so a RAISE in the
-- verify block rolls the whole file back. The first statement is SET LOCAL
-- lock_timeout, because the DDL here needs locks an in-flight call may hold, and
-- queueing behind one would block every new call behind this statement.
--
-- No cron statement. The refresh cron (refresh-allocator-equity) was unscheduled
-- by hand on PROD in plan 12, and TEST holds none; this file neither schedules nor
-- unschedules anything.
--
-- ============================================================================
-- BLAST RADIUS AND REVERSIBILITY
-- ============================================================================
-- Rows of public.allocator_equity_snapshots on PROD are destroyed. The count and
-- the date range are recorded by plan 16 before the merge, as counts only. The
-- derived series that replaced them (allocator_equity_derived, kind equity_curve)
-- is not touched by this file's DDL; only a later last-key hard delete removes it,
-- through the re-based RPC.
--
-- The rollback file, supabase/migrations/down/20261104120000-rollback.sql, is
-- reversibility of the DEFINITION and nothing more: it re-creates the table EMPTY,
-- with its indexes, RLS, policies and grants, re-creates the four functions at
-- their latest definitions, and restores the 20261028120000 body of
-- delete_allocator_api_key. It restores no row, and a git revert does not either.
-- It is manual, off the auto-apply path.
--
-- ============================================================================
-- WHAT PLAN 16 CHECKS BEFORE THIS MERGES (the R5 expectations)
-- ============================================================================
-- Run read-only on PROD, names and counts only:
--   R5a  SELECT n.nspname, p.proname FROM pg_proc p
--          JOIN pg_namespace n ON n.oid = p.pronamespace
--         WHERE p.prosrc ILIKE '%allocator_equity_snapshots%' ORDER BY 1, 2;
--        Expected: delete_allocator_api_key, enqueue_refresh_allocator_equity_for_all,
--        extract_symbol_value_at, replace_allocator_equity_snapshots,
--        replace_allocator_equity_snapshots_window (all five handled here), and
--        backfill_api_keys_history_reconstructed_at, which names the table in a
--        COMMENT only. That ILIKE does not strip comments and the verify block
--        below does, so the backfill function is in R5a and is not a dependent.
--        Any other name is a stop: it is a function this file does not handle.
--   R5b  pg_depend rows for the table other than its own columns, constraints,
--        indexes, policies and rowtype: expected none (no view, no foreign key into
--        it, no trigger function).
--   R5c  cron.job rows whose command names the table or the fan-out function:
--        expected 0.
-- The ACL after the apply: delete_allocator_api_key executable by authenticated and
-- service_role, not by anon or PUBLIC.
--
-- ⚠️ NAME_SET_RATCHET in scripts/dump-sql-functions.ts carries dated baseline-only
-- rows for the four dropped functions. They clear only when the baseline is
-- re-dumped after the PROD apply of this file, a separate reviewed act. They are
-- NOT deleted here.
--
-- Rollback (manual, off the auto-apply path):
-- supabase/migrations/down/20261104120000-rollback.sql
-- ============================================================================

SET LOCAL lock_timeout = '3s';

-- ───────────── 1. Re-base delete_allocator_api_key: Step 4 moves off the snapshot statements.
-- Schema-qualified CREATE: an unqualified CREATE OR REPLACE resolves against the
-- SESSION search_path and can mint a second function with default privileges.
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
  -- H-1186: serialize all per-allocator key-deletion work on one
  -- transaction-scoped advisory lock (auto-released on commit/rollback).
  -- Phase 176 D-02: the equity-replace functions that shared this key are gone, so
  -- the lock now serializes two deletes by the SAME allocator (a delete of the
  -- last key cannot interleave with a delete of its sibling), and that is why it
  -- stays. auth.uid() is the allocator id; follows the same
  -- pg_advisory_xact_lock(hashtext(...)) convention as sync_trades (migration
  -- 20260406065011).
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

  -- Step 4: last-key derived-history cascade (Phase 176 D-09; migration 077 /
  -- M-1020 semantics, re-homed from the dropped legacy table onto the derived
  -- rows). Only when the user explicitly asked for hard delete (cascade=true)
  -- AND no key is left: the allocator's equity_curve row and this key's
  -- key_inputs row go. Multi-key users keep their series.
  --
  -- M-1020: ONE statement, so the NOT EXISTS key-presence check and the DELETE
  -- share one statement snapshot (no count-then-delete TOCTOU window).
  IF p_cascade_holdings THEN
    DELETE FROM allocator_equity_derived d
      WHERE d.allocator_id = auth.uid()
        AND (d.kind = 'equity_curve' OR d.kind = 'key_inputs:' || p_api_key_id::text)
        AND NOT EXISTS (
          SELECT 1 FROM api_keys WHERE user_id = auth.uid()
        );
  END IF;

  RETURN v_holdings_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_allocator_api_key(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_allocator_api_key(uuid, boolean) TO authenticated, service_role;

-- ───────────── 2. Drop the four functions, each at its exact signature.
DROP FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer);
DROP FUNCTION public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date);
DROP FUNCTION public.extract_symbol_value_at(uuid, text, date);
DROP FUNCTION public.enqueue_refresh_allocator_equity_for_all();

-- ───────────── 3. The seam rows named days of the table dropped below.
DELETE FROM public.allocator_equity_derived WHERE kind = 'snapshot_rebuild_boundary';

-- ───────────── 4. The table. RESTRICT by construction.
DROP TABLE public.allocator_equity_snapshots;

-- ───────────── 5. Self-verify: CATALOGUE ONLY, passes on an empty database.
-- Every variable is DECLAREd up front (plpgsql compiles a DO block whole), and each
-- RAISE is a single literal so the migration reviewer's single-literal invariant
-- holds. A RAISE here rolls the whole file back with the implicit transaction.
DO $verify$
DECLARE
  v_oid     oid := to_regprocedure('public.delete_allocator_api_key(uuid,boolean)');
  v_n       integer;
  v_secdef  boolean;
  v_cfg     text[];
  v_src     text;
  v_acl     aclitem[];
BEGIN
  IF to_regclass('public.allocator_equity_snapshots') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: public.allocator_equity_snapshots still exists after the drop';
  END IF;

  IF to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: public.replace_allocator_equity_snapshots(uuid, jsonb, integer) still exists';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) still exists';
  END IF;
  IF to_regprocedure('public.extract_symbol_value_at(uuid,text,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: public.extract_symbol_value_at(uuid, text, date) still exists';
  END IF;
  IF to_regprocedure('public.enqueue_refresh_allocator_equity_for_all()') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: public.enqueue_refresh_allocator_equity_for_all() still exists';
  END IF;

  -- The delete RPC: exactly one, SECURITY DEFINER, the pins unchanged, the lock
  -- key still the alloc-scoped hashtext prefix, no mention of the dropped table or
  -- of the seam row in its executable text.
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_allocator_api_key';
  IF v_n <> 1 OR v_oid IS NULL THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: expected exactly one public.delete_allocator_api_key(uuid, boolean)';
  END IF;

  SELECT p.prosecdef, p.proconfig, p.prosrc, p.proacl
    INTO v_secdef, v_cfg, v_src, v_acl
    FROM pg_proc p WHERE p.oid = v_oid;
  IF NOT v_secdef THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: delete_allocator_api_key must be SECURITY DEFINER';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'search_path=public,pg_temp') THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: delete_allocator_api_key does not pin search_path to public, pg_temp';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM unnest(COALESCE(v_cfg, ARRAY[]::text[])) c
                  WHERE regexp_replace(c, '\s', '', 'g') = 'lock_timeout=3s') THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: delete_allocator_api_key does not carry lock_timeout = 3s';
  END IF;
  IF position('hashtext(''alloc:'' ||' IN v_src) = 0 THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: delete_allocator_api_key lost its per-allocator advisory lock key';
  END IF;

  -- ACL: PUBLIC and anon cannot execute; authenticated and service_role can.
  IF v_acl IS NULL OR EXISTS (SELECT 1 FROM aclexplode(v_acl) a WHERE a.grantee = 0) THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: delete_allocator_api_key is executable by PUBLIC';
  END IF;
  IF has_function_privilege('anon', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: anon can EXECUTE delete_allocator_api_key';
  END IF;
  IF NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: authenticated or service_role cannot EXECUTE delete_allocator_api_key';
  END IF;

  -- No function in schema public names the dropped table or a dropped function in
  -- its executable text. `--` and block comments are stripped first, so a body that
  -- only DISCUSSES one of them in a comment (backfill_api_keys_history_reconstructed_at
  -- does) is not a dependent. This is the only check that catches a missed plpgsql
  -- or SQL-language dependent: those are not tracked in pg_depend.
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND regexp_replace(regexp_replace(p.prosrc, '/\*.*?\*/', '', 'g'), '--[^\n]*', '', 'g')
         ~* '(allocator_equity_snapshots|extract_symbol_value_at|enqueue_refresh_allocator_equity_for_all)';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'Migration 20261104120000 failed: a function in schema public still names the dropped table or a dropped function';
  END IF;

  RAISE NOTICE 'Migration 20261104120000: allocator_equity_snapshots and its four functions are gone, delete_allocator_api_key is SECURITY DEFINER with search_path, lock_timeout and the per-allocator lock intact and its ACL for authenticated and service_role only, and no public function names the table or a dropped function.';
END
$verify$;
