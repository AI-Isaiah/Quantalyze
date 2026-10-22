-- ============================================================================
-- ROLLBACK for 20261028120000_replace_allocator_equity_snapshots_window.sql
-- Phase 167.2.1.1.2 ACCTREBUILD, plan 01 (SC-1, SC-2, SC-4).
-- ============================================================================
-- Manual, off the auto-apply path. What it undoes:
--   1. DROPs public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date).
--      Run it only after the analytics worker that calls it (the forced reconstruct of
--      plans 06-08 of this phase) has been rolled back, or every forced rebuild fails
--      with "function does not exist".
--   2. Re-creates public.replace_allocator_equity_snapshots(uuid, jsonb, integer) and
--      public.delete_allocator_api_key(uuid, boolean) as their latest earlier
--      definition, migration 20260602183000_b5b_api_key_delete_atomicity.sql, i.e.
--      without the snapshot_rebuild_boundary DELETE the migration added to each (review
--      WR-01). Signature, SECURITY DEFINER, search_path, lock_timeout and grants are
--      the same in both versions, and CREATE OR REPLACE keeps the grants, so none is
--      re-issued. The two function comments are restored too: delete_allocator_api_key
--      has none, and replace_allocator_equity_snapshots gets its 20260602183000 text.
--
-- ⚠️ DATA IS KEPT. The allocator_equity_snapshots rows the function rebuilt and every
-- snapshot_rebuild_boundary row it wrote to allocator_equity_derived stay where they
-- are. A rebuilt day may already count in what an allocator sees, so removing them is a
-- founder decision, not part of this file.
--
-- ⚠️ THE MIGRATION LEDGER ROW IS LEFT IN PLACE. This file does not touch
-- supabase_migrations.schema_migrations, so after it runs the ledger still records
-- version 20261028120000 as applied while the schema no longer carries it, and
-- `supabase db push` will not re-apply the migration. To re-apply it, delete that
-- ledger row in the same change (or mark it reverted with
-- `supabase migration repair --status reverted 20261028120000` against the intended
-- database, after the marker query in CLAUDE.md names that database).
--
-- The DO block before the change is a catalogue-only PRECONDITION: it refuses, before
-- anything changes, on a database that does not carry the migration. The DO block
-- after it is catalogue-only too and aborts the whole rollback if the window function
-- survives, either re-created function is gone, or either still names the boundary kind.
-- Neither reads a row.
-- ============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- ───────────── precondition — CATALOGUE ONLY, reads no row
DO $precondition$
BEGIN
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 refused: public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date) is not present, so this database does not carry 20261028120000. Nothing was changed. Run the marker query in CLAUDE.md to see which database this is.';
  END IF;
END
$precondition$;

-- 1. The window function: nothing else depends on it.
DROP FUNCTION IF EXISTS public.replace_allocator_equity_snapshots_window(uuid, jsonb, integer, date);

-- 2a. replace_allocator_equity_snapshots as 20260602183000 defined it (no boundary DELETE).
CREATE OR REPLACE FUNCTION public.replace_allocator_equity_snapshots(
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

COMMENT ON FUNCTION public.replace_allocator_equity_snapshots(uuid, jsonb, integer) IS
  'Atomic sole-key equity-history replacement: per-allocator advisory-lock (H-1186) then DELETE all rows for p_allocator_id then INSERT p_rows in ONE transaction (E4/HIGH8). Serializes with delete_allocator_api_key on hashtext(''alloc:''||allocator). Per-row history_depth_months mirrors persist_equity_snapshots WR-05; persists pre_terminus_balance_unknown (CL9/NEW-C01-11, COALESCE to false). service_role only.';

-- 2b. delete_allocator_api_key as 20260602183000 defined it (no boundary DELETE).
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

-- ───────────── verify — CATALOGUE ONLY, reads no row
DO $verify$
BEGIN
  IF to_regprocedure('public.replace_allocator_equity_snapshots_window(uuid,jsonb,integer,date)') IS NOT NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 failed: replace_allocator_equity_snapshots_window survives';
  END IF;
  IF to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 failed: public.replace_allocator_equity_snapshots(uuid, jsonb, integer) is gone';
  END IF;
  IF to_regprocedure('public.delete_allocator_api_key(uuid,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Rollback 20261028120000 failed: public.delete_allocator_api_key(uuid, boolean) is gone';
  END IF;
  IF (SELECT position('snapshot_rebuild_boundary' IN p.prosrc) FROM pg_proc p
       WHERE p.oid = to_regprocedure('public.replace_allocator_equity_snapshots(uuid,jsonb,integer)')) <> 0
     OR (SELECT position('snapshot_rebuild_boundary' IN p.prosrc) FROM pg_proc p
          WHERE p.oid = to_regprocedure('public.delete_allocator_api_key(uuid,boolean)')) <> 0 THEN
    RAISE EXCEPTION 'Rollback 20261028120000 failed: replace_allocator_equity_snapshots or delete_allocator_api_key still deletes the snapshot_rebuild_boundary row';
  END IF;

  RAISE NOTICE 'Rollback 20261028120000: replace_allocator_equity_snapshots_window is gone, replace_allocator_equity_snapshots and delete_allocator_api_key are back to their 20260602183000 definitions. Rebuilt snapshot rows and snapshot_rebuild_boundary rows are kept, and the migration ledger row is left in place (see the header).';
END
$verify$;

COMMIT;
