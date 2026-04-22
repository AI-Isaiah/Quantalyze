-- ===========================================================================
-- Migration 077: delete_allocator_api_key — cascade allocator_equity_snapshots
--                on last-key deletion
-- ===========================================================================
-- BUG: delete_allocator_api_key (migration 069) does NOT cascade to
-- allocator_equity_snapshots. The snapshot FK is to auth.users(id), not
-- api_keys(id), so deleting a key (even with p_cascade_holdings=true) leaves
-- a full stale equity series behind.
--
-- Combined with the reconstruct-upsert path in equity_reconstruction.py
-- (ON CONFLICT (allocator_id, asof) DO NOTHING — intentional per threat
-- T-07-V5b to keep first-writer-wins multi-key aggregation), a user who
-- deletes their only key, re-uploads it, and syncs gets:
--   1. A fresh api_keys row (new UUID) that passes the per-key reconstruct
--      gate in migration 076.
--   2. A reconstruct job that runs to completion and tries to UPSERT every
--      day's snapshot.
--   3. Zero rows written because every UPSERT collides with stale rows
--      that were never cleaned up.
--   4. Dashboard forever serving pre-fix (V-shape) numbers with no user-
--      actionable recovery path.
--
-- FIX: when p_cascade_holdings=true AND this delete drops the user's key
-- count to zero, ALSO delete the user's allocator_equity_snapshots rows.
-- Semantics:
--   - Multi-key users deleting one of N keys → snapshots untouched. The
--     remaining N-1 keys' history is still accurate to the first-writer-
--     wins UPSERT and the user isn't asking for a clean slate anyway.
--   - Last-key users asking for hard delete (p_cascade_holdings=true) →
--     full wipe of holdings AND equity series. This is what "remove this
--     key and all data that depends on it" means when there's nothing
--     else. Next connect kicks off a fresh reconstruct against the new
--     key on an empty snapshot table.
--   - Soft-disconnect path (migration 075) is unchanged — that path never
--     calls this RPC.
--
-- The count check happens AFTER the api_keys DELETE, not before — so we
-- query the post-delete state inside the same transaction. If the
-- api_keys DELETE rolls back (FK violation on holdings with cascade=false),
-- the snapshot DELETE never runs either.
-- ===========================================================================

BEGIN;

SET lock_timeout = '3s';

CREATE OR REPLACE FUNCTION public.delete_allocator_api_key(
  p_api_key_id uuid,
  p_cascade_holdings boolean DEFAULT false
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner              uuid;
  v_holdings_deleted   integer := 0;
  v_remaining_keys     integer;
BEGIN
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

  -- Step 4: last-key equity cascade (migration 077).
  -- Only wipe the equity series when the user explicitly asked for hard
  -- delete (cascade=true) AND they have no other keys left. Multi-key
  -- users keep their aggregated series intact.
  IF p_cascade_holdings THEN
    SELECT count(*) INTO v_remaining_keys
      FROM api_keys
      WHERE user_id = auth.uid();

    IF v_remaining_keys = 0 THEN
      DELETE FROM allocator_equity_snapshots
        WHERE allocator_id = auth.uid();
    END IF;
  END IF;

  RETURN v_holdings_deleted;
END;
$$;

-- Re-apply grants verbatim from migration 069 (CREATE OR REPLACE preserves
-- existing grants, but we restate them so the file is self-contained and
-- survives future DROP FUNCTION / CREATE FUNCTION rewrites).
REVOKE ALL ON FUNCTION public.delete_allocator_api_key(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_allocator_api_key(uuid, boolean)
  TO authenticated;

-- ===========================================================================
-- Self-verify: function body references the new cascade branch.
-- ===========================================================================
DO $$
DECLARE
  v_src text;
BEGIN
  SELECT prosrc INTO v_src
    FROM pg_proc
    WHERE proname = 'delete_allocator_api_key' AND pronargs = 2;

  IF v_src IS NULL THEN
    RAISE EXCEPTION 'Migration 077 failed: delete_allocator_api_key RPC missing';
  END IF;

  IF v_src NOT LIKE '%allocator_equity_snapshots%' THEN
    RAISE EXCEPTION 'Migration 077 failed: delete_allocator_api_key body does not reference allocator_equity_snapshots (cascade branch missing)';
  END IF;

  IF v_src NOT LIKE '%v_remaining_keys%' THEN
    RAISE EXCEPTION 'Migration 077 failed: delete_allocator_api_key body does not reference v_remaining_keys (last-key gate missing)';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.delete_allocator_api_key(uuid, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 077 failed: authenticated lacks EXECUTE on delete_allocator_api_key';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.delete_allocator_api_key(uuid, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 077 failed: anon unexpectedly has EXECUTE on delete_allocator_api_key';
  END IF;
END $$;

COMMIT;
