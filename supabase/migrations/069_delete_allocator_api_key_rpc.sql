-- ===========================================================================
-- Migration 069: delete_allocator_api_key RPC — cascade-aware key removal
-- ===========================================================================
-- BUG: clients can't delete api_keys rows via the user-scoped supabase
-- client once allocator_holdings have been imported, because the
-- allocator_holdings.api_key_id FK is NOT NULL with ON DELETE RESTRICT
-- (migration 066 STEP 2). Adding ON DELETE CASCADE is wrong — we want
-- holdings removal to be an explicit user choice, not an invisible side
-- effect of removing a key.
--
-- Also: allocator_holdings RLS (migration 066 STEP 3) grants owners
-- SELECT only — service_role is the only path for INSERT/UPDATE/DELETE.
-- So the UI can't pre-delete holdings client-side either.
--
-- FIX: a SECURITY DEFINER RPC that (a) verifies the caller owns the key,
-- (b) optionally cascade-deletes the matching holdings rows, (c) deletes
-- the key. Atomic (single transaction). Returns the holdings count
-- actually removed so the UI can report "Removed N holdings" accurately.
--
-- The RPC enforces ownership internally via auth.uid() rather than
-- relying on RLS (which is bypassed for SECURITY DEFINER). A non-owner
-- attempting to remove another user's key raises `insufficient_privilege`.
-- ===========================================================================

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
  v_owner uuid;
  v_holdings_deleted integer := 0;
BEGIN
  -- Step 1: verify caller owns the key (also covers the "key does not
  -- exist" case — returns NULL which fails the equality check below).
  SELECT user_id INTO v_owner FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> auth.uid() THEN
    RAISE EXCEPTION 'delete_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Step 2: cascade-delete holdings if requested. If the user opted out
  -- and holdings exist, the subsequent api_keys delete will fail on the
  -- FK restrict — we let it — the client handles the 23503 error as
  -- "refresh holdings count and re-prompt".
  IF p_cascade_holdings THEN
    DELETE FROM allocator_holdings
    WHERE api_key_id = p_api_key_id
      AND allocator_id = auth.uid();  -- defensive: same as user_id check
    GET DIAGNOSTICS v_holdings_deleted = ROW_COUNT;
  END IF;

  -- Step 3: delete the key. If RESTRICT-FK still fires (cascade=false +
  -- holdings present), this RAISES 23503 and the whole txn rolls back,
  -- which is what we want.
  DELETE FROM api_keys WHERE id = p_api_key_id AND user_id = auth.uid();

  RETURN v_holdings_deleted;
END;
$$;

-- Lock down callers. Only authenticated users can invoke; function
-- enforces per-row ownership internally. (Follow migration 066 pattern:
-- REVOKE must explicitly list `anon` — Postgres CREATE defaults grant
-- EXECUTE to PUBLIC, but `anon` can carry a separate grant path in the
-- Supabase default schema setup that survives `REVOKE FROM PUBLIC`.)
REVOKE ALL ON FUNCTION public.delete_allocator_api_key(uuid, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_allocator_api_key(uuid, boolean)
  TO authenticated;

-- ===========================================================================
-- Self-verify
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'delete_allocator_api_key'
      AND pronargs = 2
  ) THEN
    RAISE EXCEPTION 'Migration 069 failed: delete_allocator_api_key RPC not installed';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.delete_allocator_api_key(uuid, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 069 failed: authenticated lacks EXECUTE on delete_allocator_api_key';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.delete_allocator_api_key(uuid, boolean)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Migration 069 failed: anon unexpectedly has EXECUTE on delete_allocator_api_key';
  END IF;
END $$;
