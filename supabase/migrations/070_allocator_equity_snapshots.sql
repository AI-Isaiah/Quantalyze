-- Migration 070: allocator_equity_snapshots + token_price_history + two new
-- compute kinds (reconstruct_allocator_history, refresh_allocator_equity_daily —
-- BOTH key-scoped per VOICES-ACCEPTED f1 BLOCKER fix) + request_allocator_
-- holdings_sync extension + enqueue_refresh_allocator_equity_for_all key-fanout
-- cron + 3-tier RLS + self-verifying DO block.
-- Phase 07 / Plan 01 — Demo-Mode Purge (PURGE-02).
--
-- What this migration does (10-step ordering, mirrors migration 066 shape)
-- -------------------------------------------------
-- 1. CREATE TABLE allocator_equity_snapshots — per-allocator per-day
--    reconstructed equity series. Includes `history_depth_months int` column
--    per VOICES-ACCEPTED f9 so the dashboard can surface venue-specific
--    warm-up copy ("Only 3 months of history available on OKX" vs generic).
-- 2. CREATE TABLE token_price_history — CoinGecko fallback price cache,
--    keyed on (symbol, asof). Service-role only (RLS enabled with no
--    authenticated policy so authenticated is denied by default).
-- 3. INSERT two new compute_job_kinds: reconstruct_allocator_history (first-
--    connect full backfill) + refresh_allocator_equity_daily (daily delta).
-- 4. DROP + ADD compute_jobs_kind_target_coherence CHECK. Both new kinds are
--    KEY-SCOPED (api_key_id IS NOT NULL). The f1 BLOCKER fix: in the original
--    plan the daily-refresh kind was allocator-scoped, but _allocator_key_
--    preflight in analytics-service/services/job_worker.py (lines 376–413)
--    hard-requires job['api_key_id']. Without api_key_id the dispatcher
--    raises ValueError and every cron job dies in failed state. Aggregation
--    across an allocator's keys happens at snapshot UPSERT on (allocator_id,
--    asof) at write time — not at job-scope time.
-- 5. Partial unique indexes for in-flight dedup — one per (api_key_id, kind)
--    for each new kind. BOTH key-scoped per f1.
-- 6. CREATE OR REPLACE FUNCTION request_allocator_holdings_sync — extend
--    the Phase 06 wrapper to ALSO enqueue reconstruct_allocator_history on
--    first connect (when the allocator has zero equity snapshots). Preserves
--    the existing poll_allocator_positions enqueue + sync_status='syncing'
--    side effects verbatim. Wrapping BEGIN/EXCEPTION WHEN unique_violation
--    means the reconstruct enqueue is idempotent; existing holdings-sync
--    semantics are untouched if reconstruct is already inflight.
-- 7. CREATE FUNCTION enqueue_refresh_allocator_equity_for_all — cron RPC.
--    Per VOICES-ACCEPTED f1 BLOCKER: fans out ONE JOB PER ACTIVE api_key,
--    not one per allocator. Mirrors enqueue_poll_allocator_positions_for_all_keys
--    from migration 066 lines 613–697 verbatim (advisory lock + per-key loop
--    + unique_violation swallow + per-key/per-day idempotency key).
-- 8. pg_cron schedule 'refresh-allocator-equity' at 0 5 * * * (05:00 UTC) —
--    one hour after the Phase 06 04:00 poll-allocator-positions cron per
--    RESEARCH.md §1 Pitfall 6 (today's holdings fresh before equity compute).
-- 9. 3-tier RLS on allocator_equity_snapshots — owner SELECT, admin SELECT,
--    service_role ALL. No authenticated INSERT/UPDATE/DELETE — worker is
--    sole producer via service-role.
-- 10. Self-verifying DO block — 12 assertions (a-l) covering:
--       (a) table + 7 expected columns (including history_depth_months)
--       (b) PK (allocator_id, asof)
--       (c) token_price_history table + PK
--       (d) both new kinds registered
--       (e) kind coherence CHECK references both new kinds AND the refresh
--           branch is key-scoped (api_key_id IS NOT NULL — f1 fix)
--       (f) both partial unique indexes present
--       (g) RLS enabled + 3 named policies on allocator_equity_snapshots
--       (h) request_allocator_holdings_sync body references reconstruct_allocator_history
--       (i) enqueue_refresh_allocator_equity_for_all body references api_key_id
--       (j) pg_cron schedule registered with safe hour (1-22)
--       (k) service_role INSERT probe + DELETE cleanup
--       (l) history_depth_months column exists with type integer
--
-- What this migration does NOT do
-- -------------------------------
-- - Does NOT register handlers in analytics-service/services/job_worker.py —
--   Plan 07-02 wires run_reconstruct_allocator_history_job +
--   run_refresh_allocator_equity_daily_job into dispatch().
-- - Does NOT write any allocator_equity_snapshots rows — worker does (Plan 07-02).
-- - Does NOT touch getMyAllocationDashboard — Plan 07-03.
--
-- Application path
-- ----------------
-- Authored here; applied to the linked Supabase project via `supabase db push`.
-- The self-verifying DO block at the tail raises EXCEPTION on any invariant
-- failure — if push returns non-zero, read the error and fix the migration.
-- Do NOT skip or --include-all past a failed self-verify.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- STEP 1: CREATE TABLE allocator_equity_snapshots (D-02 + VOICES-ACCEPTED f9)
-- ==========================================================================
-- D-02: one row per (allocator_id, asof). Schema lifted verbatim from the
-- plan file (07-01-PLAN.md STEP 1). `history_depth_months` added per f9 to
-- carry the per-venue retention cap so KpiStrip can render venue-specific
-- warm-up copy instead of a generic "need N more days" message.
CREATE TABLE IF NOT EXISTS allocator_equity_snapshots (
  allocator_id           UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asof                   DATE        NOT NULL,
  value_usd              NUMERIC     NOT NULL,
  breakdown              JSONB,
  reconstructed_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  source                 TEXT        NOT NULL DEFAULT 'exchange_primary',
  history_depth_months   INTEGER,   -- per VOICES-ACCEPTED f9: venue-specific
                                    -- cap in months. Binance=24 (~730d), OKX=3
                                    -- for trades / 24 for OHLCV, Bybit=24.
                                    -- NULL for CoinGecko-fallback rows.
                                    -- Nullable for backfill compatibility.
  PRIMARY KEY (allocator_id, asof),
  CONSTRAINT allocator_equity_snapshots_source_check
    CHECK (source IN ('exchange_primary', 'coingecko_fallback', 'mixed')),
  CONSTRAINT allocator_equity_snapshots_history_depth_check
    CHECK (history_depth_months IS NULL OR history_depth_months > 0)
);

CREATE INDEX IF NOT EXISTS allocator_equity_snapshots_allocator_asof_desc_idx
  ON allocator_equity_snapshots (allocator_id, asof DESC);

COMMENT ON TABLE allocator_equity_snapshots IS
  'Per-allocator per-day reconstructed equity series. Written by FastAPI worker (service_role). Phase 07 / D-02. history_depth_months added per VOICES-ACCEPTED f9 to surface venue-specific warm-up copy.';
COMMENT ON COLUMN allocator_equity_snapshots.history_depth_months IS
  'Per-venue retention cap in months at time of reconstruction. Binance=24, OKX=3 (trades) / 24 (OHLCV), Bybit=24. NULL for CoinGecko fallback. Used by getMyAllocationDashboard to compute minHistoryDepthMonths for venue-specific KpiStrip warm-up messaging.';

-- ==========================================================================
-- STEP 2: CREATE TABLE token_price_history (CoinGecko fallback cache)
-- ==========================================================================
-- RESEARCH.md §2: cache of (symbol, asof, price_usd) to stay inside
-- CoinGecko's free-tier rate limits. No PII; service-role writes only;
-- authenticated never reads (all reads go through the worker). Belt-and-
-- suspenders: enable RLS but add no authenticated policy so authenticated
-- access is denied by default.
CREATE TABLE IF NOT EXISTS token_price_history (
  symbol     TEXT        NOT NULL,
  asof       DATE        NOT NULL,
  price_usd  NUMERIC     NOT NULL,
  source     TEXT        NOT NULL DEFAULT 'coingecko',
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (symbol, asof)
);

COMMENT ON TABLE token_price_history IS
  'CoinGecko historical price cache keyed on (symbol, asof). Service-role writes only. Phase 07 / RESEARCH.md §2.';

ALTER TABLE token_price_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS token_price_history_service_all ON token_price_history;
CREATE POLICY token_price_history_service_all ON token_price_history FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ==========================================================================
-- STEP 3: Register two new compute_job_kinds (analog: migration 066 STEP 3)
-- ==========================================================================
INSERT INTO compute_job_kinds (name) VALUES ('reconstruct_allocator_history')
  ON CONFLICT (name) DO NOTHING;
INSERT INTO compute_job_kinds (name) VALUES ('refresh_allocator_equity_daily')
  ON CONFLICT (name) DO NOTHING;

-- ==========================================================================
-- STEP 4: Extend compute_jobs_kind_target_coherence (f1 BLOCKER fix)
-- ==========================================================================
-- DROP + ADD the CHECK (analog: migration 066 STEP 2, lines 258–271).
-- CRITICAL per VOICES-ACCEPTED f1: refresh_allocator_equity_daily is
-- KEY-SCOPED (api_key_id IS NOT NULL), NOT allocator-scoped. The
-- _allocator_key_preflight guard in analytics-service/services/job_worker.py
-- lines 376–413 hard-requires job['api_key_id']; without it the dispatcher
-- raises ValueError and the job dies in failed state. Aggregation across an
-- allocator's keys happens at snapshot UPSERT on (allocator_id, asof).
ALTER TABLE compute_jobs DROP CONSTRAINT IF EXISTS compute_jobs_kind_target_coherence;
ALTER TABLE compute_jobs ADD CONSTRAINT compute_jobs_kind_target_coherence CHECK (
  (kind = 'compute_portfolio'
      AND portfolio_id IS NOT NULL AND strategy_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'rescore_allocator'
      AND allocator_id IS NOT NULL AND strategy_id IS NULL AND portfolio_id IS NULL) OR
  (kind IN (
    'sync_trades','compute_analytics','poll_positions',
    'sync_funding','reconcile_strategy','compute_intro_snapshot'
  ) AND strategy_id IS NOT NULL AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'poll_allocator_positions'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  (kind = 'reconstruct_allocator_history'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL) OR
  -- per VOICES-ACCEPTED f1 BLOCKER: KEY-SCOPED (was allocator-scoped in an
  -- earlier plan revision). Handler operates per-key; aggregate UPSERT on
  -- (allocator_id, asof) happens at snapshot-write time.
  (kind = 'refresh_allocator_equity_daily'
      AND api_key_id IS NOT NULL AND strategy_id IS NULL
      AND portfolio_id IS NULL AND allocator_id IS NULL)
);

COMMENT ON CONSTRAINT compute_jobs_kind_target_coherence ON compute_jobs IS
  'Kind<->target-type coherence. Phase 07: reconstruct_allocator_history and refresh_allocator_equity_daily are BOTH api-key-scoped per VOICES-ACCEPTED f1. Aggregate across an allocator''s keys happens at snapshot UPSERT on (allocator_id, asof).';

-- ==========================================================================
-- STEP 5: Partial unique indexes for in-flight dedup (both key-scoped / f1)
-- ==========================================================================
-- analog: migration 066 STEP 4 (compute_jobs_one_inflight_per_kind_api_key).
-- One in-flight job per (api_key_id, kind) for each new kind.

-- One in-flight reconstruct_allocator_history per api_key
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_reconstruct_per_api_key
  ON compute_jobs (api_key_id, kind)
  WHERE api_key_id IS NOT NULL
    AND kind = 'reconstruct_allocator_history'
    AND status IN ('pending','running','done_pending_children');

COMMENT ON INDEX compute_jobs_one_inflight_reconstruct_per_api_key IS
  'Partial unique enforcing one in-flight reconstruct_allocator_history per api_key_id. Phase 07 / f1.';

-- One in-flight refresh_allocator_equity_daily per api_key (per f1 — NOT per allocator)
CREATE UNIQUE INDEX IF NOT EXISTS compute_jobs_one_inflight_refresh_equity_per_api_key
  ON compute_jobs (api_key_id, kind)
  WHERE api_key_id IS NOT NULL
    AND kind = 'refresh_allocator_equity_daily'
    AND status IN ('pending','running','done_pending_children');

COMMENT ON INDEX compute_jobs_one_inflight_refresh_equity_per_api_key IS
  'Partial unique enforcing one in-flight refresh_allocator_equity_daily per api_key_id. Phase 07 / f1 BLOCKER — key-scoped because _allocator_key_preflight requires job[api_key_id].';

-- ==========================================================================
-- STEP 6: Extend request_allocator_holdings_sync (first-connect reconstruction)
-- ==========================================================================
-- Phase 07 / D-01: on first connect (zero allocator_equity_snapshots rows for
-- this allocator), ALSO enqueue reconstruct_allocator_history after the
-- existing poll_allocator_positions enqueue. Best-effort + idempotent via the
-- partial unique index from STEP 5; on 23505 swallow silently (already
-- enqueued — benign). Wrap in its own BEGIN/EXCEPTION block so the existing
-- holdings-sync semantics are preserved no matter what.
--
-- Preserves SECURITY DEFINER + SET search_path + REVOKE + GRANT pattern from
-- Phase 06 (migration 066 STEP 7).
CREATE OR REPLACE FUNCTION request_allocator_holdings_sync(p_api_key_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_uid            UUID := auth.uid();
  v_owner          UUID;
  v_job_id         UUID;
  v_next_attempt   TIMESTAMPTZ;
  v_snapshot_count INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated'
      USING ERRCODE = '42501';
  END IF;

  SELECT user_id INTO v_owner
    FROM api_keys
    WHERE id = p_api_key_id;
  IF v_owner IS NULL OR v_owner <> v_uid THEN
    RAISE EXCEPTION 'api_key_not_found_or_not_owned'
      USING ERRCODE = '42501';
  END IF;

  -- Existing poll enqueue (preserve semantics exactly — Phase 06 / D-14).
  BEGIN
    v_job_id := enqueue_compute_job(
      p_strategy_id := NULL,
      p_kind        := 'poll_allocator_positions',
      p_api_key_id  := p_api_key_id
    );
  EXCEPTION WHEN unique_violation THEN
    -- f8: surface next_attempt_at so the UI can render deferred-cooldown
    -- state on a per-exchange rate-limit contagion event.
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

  -- Phase 07 / D-01: first-connect reconstruction (best-effort; idempotent
  -- via partial unique index compute_jobs_one_inflight_reconstruct_per_api_key).
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
      NULL; -- already enqueued for this key; benign
    END;
  END IF;

  UPDATE api_keys SET sync_status = 'syncing' WHERE id = p_api_key_id;
  RETURN jsonb_build_object('ok', true, 'job_id', v_job_id);
END;
$$;

COMMENT ON FUNCTION request_allocator_holdings_sync IS
  'Authenticated wrapper. Enqueues poll_allocator_positions; on first connect (zero allocator_equity_snapshots rows) also enqueues reconstruct_allocator_history. Phase 07 extends Phase 06 / D-14.';

REVOKE ALL ON FUNCTION request_allocator_holdings_sync(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION request_allocator_holdings_sync(uuid) TO authenticated;

-- ==========================================================================
-- STEP 7: enqueue_refresh_allocator_equity_for_all (cron key-fanout / f1)
-- ==========================================================================
-- CRITICAL per VOICES-ACCEPTED f1 BLOCKER: this function fans out ONE JOB
-- PER ACTIVE api_key, NOT ONE PER ALLOCATOR. Mirrors
-- enqueue_poll_allocator_positions_for_all_keys from migration 066 lines
-- 613–697 (advisory lock + per-key loop + unique_violation swallow).
--
-- Only enqueues for allocators that already have >= 1 row in
-- allocator_equity_snapshots (i.e. the initial reconstruction has completed).
-- First-connect reconstruction is enqueued separately by
-- request_allocator_holdings_sync (STEP 6).
CREATE OR REPLACE FUNCTION enqueue_refresh_allocator_equity_for_all()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_key   RECORD;
  v_today TEXT := to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD');
BEGIN
  -- Advisory lock to avoid concurrent cron fires stomping on each other.
  IF NOT pg_try_advisory_lock(hashtext('daily_equity_refresh')) THEN
    RAISE NOTICE 'enqueue_refresh_allocator_equity_for_all: another run holds the lock; skipping';
    RETURN;
  END IF;

  BEGIN
    FOR v_key IN
      SELECT ak.id AS api_key_id, ak.user_id
      FROM api_keys ak
      WHERE ak.is_active = TRUE
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
        NULL; -- already inflight for this key today; benign
      END;
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
    RAISE;
  END;

  PERFORM pg_advisory_unlock(hashtext('daily_equity_refresh'));
END;
$$;

COMMENT ON FUNCTION enqueue_refresh_allocator_equity_for_all IS
  'Cron entrypoint — fans out one refresh_allocator_equity_daily job per active api_key per allocator (key-scoped per VOICES-ACCEPTED f1). Idempotent per (api_key, UTC date). Mirrors enqueue_poll_allocator_positions_for_all_keys from migration 066.';

REVOKE ALL ON FUNCTION enqueue_refresh_allocator_equity_for_all() FROM PUBLIC, anon, authenticated;
-- pg_cron runs as superuser; no additional GRANT required.

-- ==========================================================================
-- STEP 8: pg_cron schedule — refresh-allocator-equity at 05:00 UTC
-- ==========================================================================
-- 05:00 UTC is one hour after the Phase 06 04:00 poll-allocator-positions
-- cron per RESEARCH.md Pitfall 6 — today's holdings are fresh before equity
-- compute runs. Idempotent re-scheduling pattern per migration 066 STEP 8.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-allocator-equity') THEN
      PERFORM cron.unschedule('refresh-allocator-equity');
    END IF;
    PERFORM cron.schedule(
      'refresh-allocator-equity',
      '0 5 * * *',
      $cron$SELECT enqueue_refresh_allocator_equity_for_all();$cron$
    );
    RAISE NOTICE 'Scheduled refresh-allocator-equity at 05:00 UTC';
  ELSE
    RAISE NOTICE 'pg_cron extension not present — skipping schedule (local dev)';
  END IF;
END$$;

-- ==========================================================================
-- STEP 9: 3-tier RLS on allocator_equity_snapshots (analog: migration 066 STEP 9)
-- ==========================================================================
ALTER TABLE allocator_equity_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allocator_equity_snapshots_owner_select ON allocator_equity_snapshots;
CREATE POLICY allocator_equity_snapshots_owner_select ON allocator_equity_snapshots FOR SELECT
  USING (allocator_id = auth.uid());

DROP POLICY IF EXISTS allocator_equity_snapshots_admin_select ON allocator_equity_snapshots;
CREATE POLICY allocator_equity_snapshots_admin_select ON allocator_equity_snapshots FOR SELECT
  USING (public.current_user_has_app_role(ARRAY['admin']::text[]));

-- Explicit service_role FOR ALL policy (belt-and-suspenders; service_role
-- also bypasses RLS by default per ADR-0003, but an explicit policy
-- documents intent and survives any future RLS-hardening that might flip
-- the bypass).
DROP POLICY IF EXISTS allocator_equity_snapshots_service_all ON allocator_equity_snapshots;
CREATE POLICY allocator_equity_snapshots_service_all ON allocator_equity_snapshots FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- NOTE: No INSERT/UPDATE/DELETE policy for authenticated — worker is sole
-- producer via service_role. Phase 09 Bridge reads never mutate.

-- ==========================================================================
-- STEP 10: Self-verifying DO block — 12 assertions (a-l)
-- ==========================================================================
-- Mirror migration 066 STEP 10 Category A structure. Landmine 6: no
-- transaction-control statements inside DO blocks.
DO $$
DECLARE
  v_column_count          INT;
  v_pk_def                TEXT;
  v_tph_pk_def            TEXT;
  v_tph_exists            BOOLEAN;
  v_kind_reconstruct      BOOLEAN;
  v_kind_refresh          BOOLEAN;
  v_coherence_def         TEXT;
  v_index_reconstruct     BOOLEAN;
  v_index_refresh         BOOLEAN;
  v_policy_count          INT;
  v_rls_enabled           BOOLEAN;
  v_rpc_src               TEXT;
  v_cron_fn_src           TEXT;
  v_cron_hour             INT;
  v_history_col_type      TEXT;
  v_probe_alloc           UUID := gen_random_uuid();
  v_insert_ok             BOOLEAN := false;
BEGIN
  -- ---- (a) allocator_equity_snapshots table + 7 expected columns ----
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'allocator_equity_snapshots'
  ) THEN
    RAISE EXCEPTION 'Migration 070 failed: allocator_equity_snapshots table missing';
  END IF;

  SELECT count(*) INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'allocator_equity_snapshots'
      AND column_name IN (
        'allocator_id','asof','value_usd','breakdown',
        'reconstructed_at','source','history_depth_months'
      );
  IF v_column_count <> 7 THEN
    RAISE EXCEPTION 'Migration 070 failed: allocator_equity_snapshots expected 7 named columns, found %', v_column_count;
  END IF;

  -- ---- (b) PK (allocator_id, asof) ----
  SELECT pg_get_constraintdef(c.oid) INTO v_pk_def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'allocator_equity_snapshots'
      AND c.contype = 'p';
  IF v_pk_def IS NULL
     OR v_pk_def NOT LIKE '%allocator_id%'
     OR v_pk_def NOT LIKE '%asof%' THEN
    RAISE EXCEPTION 'Migration 070 failed: allocator_equity_snapshots PK (allocator_id, asof) missing. Got: %',
      COALESCE(v_pk_def, '<null>');
  END IF;

  -- ---- (c) token_price_history table + PK (symbol, asof) ----
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'token_price_history'
  ) INTO v_tph_exists;
  IF NOT v_tph_exists THEN
    RAISE EXCEPTION 'Migration 070 failed: token_price_history table missing';
  END IF;

  SELECT pg_get_constraintdef(c.oid) INTO v_tph_pk_def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'token_price_history'
      AND c.contype = 'p';
  IF v_tph_pk_def IS NULL
     OR v_tph_pk_def NOT LIKE '%symbol%'
     OR v_tph_pk_def NOT LIKE '%asof%' THEN
    RAISE EXCEPTION 'Migration 070 failed: token_price_history PK (symbol, asof) missing. Got: %',
      COALESCE(v_tph_pk_def, '<null>');
  END IF;

  -- ---- (d) both new compute_job_kinds registered ----
  SELECT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'reconstruct_allocator_history'
  ) INTO v_kind_reconstruct;
  SELECT EXISTS (
    SELECT 1 FROM compute_job_kinds WHERE name = 'refresh_allocator_equity_daily'
  ) INTO v_kind_refresh;
  IF NOT v_kind_reconstruct THEN
    RAISE EXCEPTION 'Migration 070 failed: reconstruct_allocator_history not registered in compute_job_kinds';
  END IF;
  IF NOT v_kind_refresh THEN
    RAISE EXCEPTION 'Migration 070 failed: refresh_allocator_equity_daily not registered in compute_job_kinds';
  END IF;

  -- ---- (e) kind coherence CHECK references both new kinds AND refresh is key-scoped (f1) ----
  SELECT pg_get_constraintdef(oid) INTO v_coherence_def
    FROM pg_constraint WHERE conname = 'compute_jobs_kind_target_coherence';
  IF v_coherence_def IS NULL
     OR v_coherence_def NOT LIKE '%reconstruct_allocator_history%'
     OR v_coherence_def NOT LIKE '%refresh_allocator_equity_daily%' THEN
    RAISE EXCEPTION 'Migration 070 failed: compute_jobs_kind_target_coherence missing one of the new kinds. Got: %',
      COALESCE(v_coherence_def, '<null>');
  END IF;
  -- f1 BLOCKER: the refresh_allocator_equity_daily branch MUST require
  -- api_key_id IS NOT NULL (key-scoped), not allocator_id IS NOT NULL.
  -- Verify by string-matching the branch segment. The CHECK body is a single
  -- expression so the branch substring is stable across Postgres versions.
  IF v_coherence_def NOT LIKE '%kind = ''refresh_allocator_equity_daily''%api_key_id IS NOT NULL%' THEN
    RAISE EXCEPTION 'Migration 070 failed: compute_jobs_kind_target_coherence refresh_allocator_equity_daily branch must be api_key_id IS NOT NULL (f1 BLOCKER). Got: %',
      v_coherence_def;
  END IF;

  -- ---- (f) both partial unique indexes exist ----
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'compute_jobs'
      AND indexname = 'compute_jobs_one_inflight_reconstruct_per_api_key'
  ) INTO v_index_reconstruct;
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'compute_jobs'
      AND indexname = 'compute_jobs_one_inflight_refresh_equity_per_api_key'
  ) INTO v_index_refresh;
  IF NOT v_index_reconstruct THEN
    RAISE EXCEPTION 'Migration 070 failed: compute_jobs_one_inflight_reconstruct_per_api_key index missing';
  END IF;
  IF NOT v_index_refresh THEN
    RAISE EXCEPTION 'Migration 070 failed: compute_jobs_one_inflight_refresh_equity_per_api_key index missing (f1 — key-scoped, NOT per-allocator)';
  END IF;

  -- ---- (g) RLS enabled + 3 named policies on allocator_equity_snapshots ----
  SELECT relrowsecurity INTO v_rls_enabled
    FROM pg_class
    WHERE relname = 'allocator_equity_snapshots'
      AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  IF NOT COALESCE(v_rls_enabled, false) THEN
    RAISE EXCEPTION 'Migration 070 failed: RLS not enabled on allocator_equity_snapshots';
  END IF;
  SELECT count(*) INTO v_policy_count
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'allocator_equity_snapshots'
      AND policyname IN (
        'allocator_equity_snapshots_owner_select',
        'allocator_equity_snapshots_admin_select',
        'allocator_equity_snapshots_service_all'
      );
  IF v_policy_count <> 3 THEN
    RAISE EXCEPTION 'Migration 070 failed: expected 3 RLS policies on allocator_equity_snapshots, found %', v_policy_count;
  END IF;

  -- ---- (h) request_allocator_holdings_sync body references reconstruct_allocator_history ----
  SELECT prosrc INTO v_rpc_src
    FROM pg_proc WHERE proname = 'request_allocator_holdings_sync' AND pronargs = 1;
  IF v_rpc_src IS NULL OR v_rpc_src NOT LIKE '%reconstruct_allocator_history%' THEN
    RAISE EXCEPTION 'Migration 070 failed: request_allocator_holdings_sync body does not reference reconstruct_allocator_history (STEP 6 extension missing)';
  END IF;

  -- ---- (i) enqueue_refresh_allocator_equity_for_all body uses api_key_id (f1) ----
  SELECT prosrc INTO v_cron_fn_src
    FROM pg_proc WHERE proname = 'enqueue_refresh_allocator_equity_for_all';
  IF v_cron_fn_src IS NULL
     OR v_cron_fn_src NOT LIKE '%api_key_id%'
     OR v_cron_fn_src NOT LIKE '%p_api_key_id%' THEN
    RAISE EXCEPTION 'Migration 070 failed: enqueue_refresh_allocator_equity_for_all body does not reference api_key_id (f1 fan-out pattern missing). Got: %',
      COALESCE(left(v_cron_fn_src, 200), '<null>');
  END IF;

  -- ---- (j) pg_cron schedule registered with safe hour 1-22 ----
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job
      WHERE jobname = 'refresh-allocator-equity' AND schedule = '0 5 * * *'
    ) THEN
      RAISE EXCEPTION 'Migration 070 failed: cron.job refresh-allocator-equity @ 0 5 * * * not registered';
    END IF;
    SELECT (split_part(schedule, ' ', 2))::INT INTO v_cron_hour
      FROM cron.job WHERE jobname = 'refresh-allocator-equity';
    IF v_cron_hour IS NULL OR v_cron_hour < 1 OR v_cron_hour > 22 THEN
      RAISE EXCEPTION 'Migration 070 failed: refresh-allocator-equity cron hour must stay BETWEEN 1 AND 22 (got hour=%)',
        v_cron_hour;
    END IF;
  ELSE
    RAISE NOTICE 'pg_cron not present — skipping cron assertion (local dev)';
  END IF;

  -- ---- (k) service_role INSERT probe + DELETE cleanup ----
  -- The migration runs as a role with RLS bypass (Supavisor cli_login
  -- role), so the INSERT exercises the table's INSERT path end-to-end
  -- (including the source CHECK and history_depth_months CHECK).
  INSERT INTO auth.users (id, email)
    VALUES (v_probe_alloc, 'equity-probe-' || v_probe_alloc || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;
  BEGIN
    INSERT INTO allocator_equity_snapshots (
      allocator_id, asof, value_usd, source, history_depth_months
    ) VALUES (
      v_probe_alloc, CURRENT_DATE, 12345.67, 'exchange_primary', 24
    );
    v_insert_ok := true;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Migration 070 failed: service_role INSERT probe raised %: %', SQLSTATE, SQLERRM;
  END;
  IF NOT v_insert_ok THEN
    RAISE EXCEPTION 'Migration 070 failed: service_role INSERT probe did not complete';
  END IF;
  -- Explicit cleanup — transaction-control statements forbidden in DO blocks.
  DELETE FROM allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = CURRENT_DATE;
  DELETE FROM auth.users WHERE id = v_probe_alloc;

  -- ---- (l) history_depth_months column exists with type integer ----
  SELECT data_type INTO v_history_col_type
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'allocator_equity_snapshots'
      AND column_name = 'history_depth_months';
  IF v_history_col_type IS NULL THEN
    RAISE EXCEPTION 'Migration 070 failed: allocator_equity_snapshots.history_depth_months column missing (f9)';
  END IF;
  IF v_history_col_type <> 'integer' THEN
    RAISE EXCEPTION 'Migration 070 failed: allocator_equity_snapshots.history_depth_months must be integer (f9); got %',
      v_history_col_type;
  END IF;

  RAISE NOTICE 'Migration 070: all 12 self-verification assertions (a–l) passed.';
END
$$;

COMMIT;

-- ==========================================================================
-- END OF MIGRATION 070
-- ==========================================================================
-- Summary (one-line per step):
--   Step 1  — allocator_equity_snapshots table + index + history_depth_months (f9)
--   Step 2  — token_price_history table + RLS (service-role-only)
--   Step 3  — compute_job_kinds INSERTs: reconstruct_allocator_history + refresh_allocator_equity_daily
--   Step 4  — compute_jobs_kind_target_coherence CHECK extended; BOTH new kinds key-scoped (f1)
--   Step 5  — two partial unique indexes (per api_key_id) for in-flight dedup
--   Step 6  — request_allocator_holdings_sync extended to enqueue reconstruct on first connect
--   Step 7  — enqueue_refresh_allocator_equity_for_all cron RPC (per-key fan-out per f1)
--   Step 8  — pg_cron refresh-allocator-equity @ 05:00 UTC
--   Step 9  — 3-tier RLS on allocator_equity_snapshots
--   Step 10 — self-verifying DO block: 12 assertions (a–l)
-- ==========================================================================
--
-- ROLLBACK PLAN (Phase 07 Plan 01)
-- -------------------------------
-- If production apply regresses Phase 06 cron or request_allocator_holdings_sync,
-- author supabase/migrations/071_rollback_phase07_plan01.sql containing:
--
--   -- 1. Unschedule cron.
--   SELECT cron.unschedule('refresh-allocator-equity');
--   -- 2. Drop cron RPC.
--   DROP FUNCTION IF EXISTS enqueue_refresh_allocator_equity_for_all();
--   -- 3. Restore request_allocator_holdings_sync to the Phase 06 (migration 066
--   --    STEP 7) body verbatim (no reconstruct enqueue, no snapshot count).
--   -- 4. Drop partial unique indexes.
--   DROP INDEX IF EXISTS compute_jobs_one_inflight_reconstruct_per_api_key;
--   DROP INDEX IF EXISTS compute_jobs_one_inflight_refresh_equity_per_api_key;
--   -- 5. Revert compute_jobs_kind_target_coherence to the Phase 06 body (drop
--   --    the reconstruct_allocator_history + refresh_allocator_equity_daily
--   --    branches; restore migration 066 STEP 2 verbatim).
--   -- 6. DELETE FROM compute_job_kinds WHERE name IN
--   --    ('reconstruct_allocator_history','refresh_allocator_equity_daily').
--   -- 7. DROP TABLE allocator_equity_snapshots CASCADE.
--   -- 8. DROP TABLE token_price_history CASCADE.
