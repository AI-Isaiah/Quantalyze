-- ===========================================================================
-- Migration 075: api_keys.disconnected_at — soft-disconnect state
-- ===========================================================================
-- BUG: "Disconnect" in AllocatorExchangeManager promised "We'll stop syncing
-- this key. Your historical holdings stay available for audit." But the
-- only backend path was migration 069's delete_allocator_api_key RPC, which
-- always DELETEs the api_keys row. With ≥1 allocator_holdings row still
-- referencing the key (api_key_id NOT NULL, ON DELETE RESTRICT per
-- migration 066), the DELETE rolled back with SQLSTATE 23503 and the UI
-- surfaced the raw Postgres error verbatim. The promise in the modal copy
-- was literally unimplementable in the old schema.
--
-- FIX: soft-disconnect via a nullable disconnected_at timestamp.
--   - UI "Disconnect" (cascadeHoldings=false) → UPDATE api_keys SET
--     disconnected_at = now(). Holdings keep their FK reference; audit
--     continuity preserved; worker crons skip the key on the next tick.
--   - UI "Disconnect + delete N holdings" (cascadeHoldings=true) → keeps
--     the existing hard-delete path (migration 069 RPC, unchanged).
--   - UI "Reconnect" → UPDATE api_keys SET disconnected_at = NULL,
--     sync_error = NULL, sync_status = 'idle'. Next cron tick picks it up.
--
-- Worker dispatch (both daily-poll and daily-equity-refresh) now filters
-- disconnected_at IS NULL. request_allocator_holdings_sync raises
-- `api_key_disconnected` when called on a disconnected key (defense in
-- depth — the UI won't render Sync now on a disconnected row).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- STEP 1: ADD COLUMN + index + grant
-- ---------------------------------------------------------------------------

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS disconnected_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.api_keys.disconnected_at IS
  'Migration 075: when set, key is soft-disconnected — worker crons skip it and the UI renders a Reconnect affordance. NULL = active. allocator_holdings keep their FK reference for audit continuity.';

-- Partial index: the hot path is "list my active keys" — e.g. the cron
-- enumerators and getUserApiKeys. NULL-filtered partial index keeps the
-- common case fast without paying for the disconnected rows.
CREATE INDEX IF NOT EXISTS api_keys_active_by_user_idx
  ON public.api_keys (user_id)
  WHERE disconnected_at IS NULL;

-- Owner must be able to SELECT disconnected_at to render connected vs
-- disconnected sections + the Reconnect button. Mirrors migration 066
-- STEP 5's sync_error grant pattern.
GRANT SELECT (disconnected_at) ON public.api_keys TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 2: disconnect_allocator_api_key RPC (soft-disconnect)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER + internal ownership check (same pattern as migration
-- 069's delete_allocator_api_key). Idempotent: re-calling on an already
-- disconnected key returns false without raising. Returns true iff the
-- row transitioned from connected → disconnected in this call.

CREATE OR REPLACE FUNCTION public.disconnect_allocator_api_key(
  p_api_key_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_already_disc
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'disconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: if already disconnected, NO-OP.
  IF v_already_disc IS NOT NULL THEN
    RETURN false;
  END IF;

  UPDATE api_keys
    SET disconnected_at = now()
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NULL;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.disconnect_allocator_api_key IS
  'Migration 075: soft-disconnect an api_keys row. Ownership enforced internally via auth.uid(). Idempotent — returns false if already disconnected. Workers + request_allocator_holdings_sync skip disconnected keys; holdings keep their FK reference.';

REVOKE ALL ON FUNCTION public.disconnect_allocator_api_key(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.disconnect_allocator_api_key(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 3: reconnect_allocator_api_key RPC (clear disconnected_at)
-- ---------------------------------------------------------------------------
-- Reset sync_error + sync_status = 'idle' so the next tick picks the key
-- up fresh. last_sync_at is preserved so "last successful sync" history
-- stays accurate across a disconnect/reconnect cycle.

CREATE OR REPLACE FUNCTION public.reconnect_allocator_api_key(
  p_api_key_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner        UUID;
  v_already_disc TIMESTAMPTZ;
  v_uid          UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_already_disc
    FROM api_keys WHERE id = p_api_key_id;

  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'reconnect_allocator_api_key: caller does not own api_key %', p_api_key_id
      USING ERRCODE = '42501';  -- insufficient_privilege
  END IF;

  -- Idempotent: not disconnected → NO-OP.
  IF v_already_disc IS NULL THEN
    RETURN false;
  END IF;

  UPDATE api_keys
    SET disconnected_at = NULL,
        sync_error      = NULL,
        sync_status     = 'idle'
    WHERE id = p_api_key_id
      AND user_id = v_uid
      AND disconnected_at IS NOT NULL;

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.reconnect_allocator_api_key IS
  'Migration 075: reverse of disconnect_allocator_api_key. Clears disconnected_at + resets sync_error and sync_status=idle so the next cron tick picks the key up fresh. Returns false if the key was not disconnected.';

REVOKE ALL ON FUNCTION public.reconnect_allocator_api_key(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconnect_allocator_api_key(uuid)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- STEP 4: worker dispatch — filter disconnected_at IS NULL
-- ---------------------------------------------------------------------------
-- enqueue_poll_allocator_positions_for_all_keys was defined in migration
-- 066 (lines 613–697). Re-create with the one-line filter added.
--
-- Advisory lock + f6 jitter key derivation + unique_violation swallow are
-- preserved verbatim — only the FROM api_keys WHERE clause changes.

CREATE OR REPLACE FUNCTION public.enqueue_poll_allocator_positions_for_all_keys()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_api_key_id      UUID;
  v_enqueued        INTEGER := 0;
  v_job_id          UUID;
  v_jitter          INTERVAL;
  v_run_at          TIMESTAMPTZ;
  v_idempotency_key TEXT;
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_allocator_polling')) THEN
    RETURN 0;
  END IF;

  FOR v_api_key_id IN
    SELECT id FROM api_keys
    WHERE is_active = true
      AND sync_status IS DISTINCT FROM 'revoked'
      AND disconnected_at IS NULL  -- migration 075: skip soft-disconnected
  LOOP
    BEGIN
      v_jitter := (random() * interval '600 seconds');
      v_run_at := now() + v_jitter;
      v_idempotency_key := 'daily-alloc-'
        || to_char(v_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
        || '-' || v_api_key_id::text;
      v_job_id := enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'poll_allocator_positions',
        p_api_key_id      := v_api_key_id,
        p_idempotency_key := v_idempotency_key,
        p_run_at          := v_run_at
      );
      v_enqueued := v_enqueued + 1;
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END LOOP;

  PERFORM pg_advisory_unlock(hashtext('daily_allocator_polling'));
  RETURN v_enqueued;
END;
$$;

COMMENT ON FUNCTION public.enqueue_poll_allocator_positions_for_all_keys IS
  'Daily cron fan-out. Migration 075 added disconnected_at IS NULL filter so soft-disconnected keys stop receiving poll jobs. Preserves the advisory lock + f6 jitter-first idempotency key + unique_violation swallow from migration 066.';

-- enqueue_refresh_allocator_equity_for_all was defined in migration 070
-- (STEP 7). Re-create with the disconnected_at filter.

CREATE OR REPLACE FUNCTION public.enqueue_refresh_allocator_equity_for_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    FOR v_key IN
      SELECT ak.id AS api_key_id, ak.user_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
        AND ak.disconnected_at IS NULL  -- migration 075
        AND EXISTS (
          SELECT 1 FROM allocator_equity_snapshots aes
          WHERE aes.allocator_id = ak.user_id
          LIMIT 1
        )
    LOOP
      BEGIN
        PERFORM enqueue_compute_job(
          p_strategy_id     := NULL,
          p_kind            := 'refresh_allocator_equity_daily',
          p_idempotency_key := 'daily-equity-' || v_key.api_key_id::text || '-' || v_today,
          p_api_key_id      := v_key.api_key_id
        );
      EXCEPTION WHEN unique_violation THEN
        NULL;
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
END;
$$;

COMMENT ON FUNCTION public.enqueue_refresh_allocator_equity_for_all IS
  'Daily cron fan-out for per-allocator equity refresh. Migration 075 added disconnected_at IS NULL filter so soft-disconnected keys stop receiving refresh jobs. Preserves advisory lock + per-key loop from migration 070.';

-- ---------------------------------------------------------------------------
-- STEP 5: request_allocator_holdings_sync — reject disconnected keys
-- ---------------------------------------------------------------------------
-- Defense in depth: even if the UI renders Sync now on a disconnected row
-- (it won't, post-075), the RPC must refuse. The existing ownership check
-- is preserved; disconnected_at is checked after ownership so a non-owner
-- gets insufficient_privilege, not api_key_disconnected.
--
-- This replaces migration 070's STEP 6 body, preserving the first-connect
-- reconstruction branch and the unique_violation handling.

CREATE OR REPLACE FUNCTION public.request_allocator_holdings_sync(
  p_api_key_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_owner          UUID;
  v_disconnected   TIMESTAMPTZ;
  v_job_id         UUID;
  v_next_attempt   TIMESTAMPTZ;
  v_snapshot_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id, disconnected_at INTO v_owner, v_disconnected
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- Migration 075: reject sync on soft-disconnected keys.
  IF v_disconnected IS NOT NULL THEN
    RAISE EXCEPTION 'api_key_disconnected'
      USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_job_id := enqueue_compute_job(
      p_strategy_id := NULL,
      p_kind        := 'poll_allocator_positions',
      p_api_key_id  := p_api_key_id
    );
  EXCEPTION WHEN unique_violation THEN
    SELECT next_attempt_at INTO v_next_attempt
      FROM compute_jobs
      WHERE api_key_id = p_api_key_id
        AND kind = 'poll_allocator_positions'
        AND status IN ('pending','running','done_pending_children')
      ORDER BY next_attempt_at DESC
      LIMIT 1;
    RETURN jsonb_build_object(
      'already_inflight', true,
      'next_attempt_at', v_next_attempt
    );
  END;

  SELECT COUNT(*) INTO v_snapshot_count
    FROM allocator_equity_snapshots
    WHERE allocator_id = v_uid;
  IF v_snapshot_count = 0 THEN
    BEGIN
      PERFORM enqueue_compute_job(
        p_strategy_id     := NULL,
        p_kind            := 'reconstruct_allocator_history',
        p_idempotency_key := 'reconstruct-alloc-' || p_api_key_id::text || '-initial',
        p_api_key_id      := p_api_key_id
      );
    EXCEPTION WHEN unique_violation THEN
      NULL;
    END;
  END IF;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

COMMENT ON FUNCTION public.request_allocator_holdings_sync IS
  'Migration 075: rejects calls on disconnected keys with SQLSTATE P0001 (api_key_disconnected). Preserves ownership check + first-connect reconstruction + unique_violation handling from migration 070 STEP 6.';

REVOKE ALL ON FUNCTION public.request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_allocator_holdings_sync(uuid) TO authenticated;

-- ===========================================================================
-- Self-verify
-- ===========================================================================
DO $$
DECLARE
  v_has_col      BOOLEAN;
  v_has_disc_fn  BOOLEAN;
  v_has_rec_fn   BOOLEAN;
  v_has_idx      BOOLEAN;
  v_auth_disc    BOOLEAN;
  v_anon_disc    BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'api_keys'
      AND column_name  = 'disconnected_at'
  ) INTO v_has_col;
  IF NOT v_has_col THEN
    RAISE EXCEPTION 'Migration 075 failed: api_keys.disconnected_at not added';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'disconnect_allocator_api_key' AND pronargs = 1
  ) INTO v_has_disc_fn;
  IF NOT v_has_disc_fn THEN
    RAISE EXCEPTION 'Migration 075 failed: disconnect_allocator_api_key RPC not installed';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'reconnect_allocator_api_key' AND pronargs = 1
  ) INTO v_has_rec_fn;
  IF NOT v_has_rec_fn THEN
    RAISE EXCEPTION 'Migration 075 failed: reconnect_allocator_api_key RPC not installed';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname  = 'api_keys_active_by_user_idx'
  ) INTO v_has_idx;
  IF NOT v_has_idx THEN
    RAISE EXCEPTION 'Migration 075 failed: api_keys_active_by_user_idx missing';
  END IF;

  SELECT has_function_privilege(
    'authenticated',
    'public.disconnect_allocator_api_key(uuid)',
    'EXECUTE'
  ) INTO v_auth_disc;
  IF NOT v_auth_disc THEN
    RAISE EXCEPTION 'Migration 075 failed: authenticated lacks EXECUTE on disconnect_allocator_api_key';
  END IF;

  SELECT has_function_privilege(
    'anon',
    'public.disconnect_allocator_api_key(uuid)',
    'EXECUTE'
  ) INTO v_anon_disc;
  IF v_anon_disc THEN
    RAISE EXCEPTION 'Migration 075 failed: anon unexpectedly has EXECUTE on disconnect_allocator_api_key';
  END IF;
END $$;
