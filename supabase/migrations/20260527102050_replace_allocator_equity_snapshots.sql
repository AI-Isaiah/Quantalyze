-- Migration: atomic replace_allocator_equity_snapshots RPC (red-team E4 / HIGH8)
-- ===========================================================================
-- PROBLEM (red-team E4, HIGH8)
-- ---------------------------
-- The sole-key stale-snapshot recovery path in
-- analytics-service/services/equity_reconstruction.py executed two SEPARATE
-- PostgREST round-trips:
--   1. _purge_allocator_equity_snapshots(...)  -> DELETE every row for allocator
--   2. persist_equity_snapshots(...)           -> UPSERT the freshly replayed rows
-- A SIGKILL / OOM / redeploy BETWEEN those two calls leaves the allocator with
-- ZERO equity-history rows (the DELETE committed, the UPSERT never ran). The
-- dashboard then shows an empty curve with no recovery path until the next
-- reconstruct, which only fires on key (re)connect.
--
-- FIX
-- ---
-- Collapse DELETE + INSERT into ONE SECURITY DEFINER function body. A plpgsql
-- function runs inside a single implicit transaction, so either both the purge
-- and the insert commit, or neither does — a crash can no longer wipe history.
-- equity_reconstruction.py's sole-key path now calls this RPC via
-- supabase.rpc(...) instead of the separate purge + persist round-trips.
--
-- COLUMN PARITY (must match migration 070 / 20260420213754 EXACTLY)
-- ----------------------------------------------------------------
-- public.allocator_equity_snapshots columns the worker writes:
--   allocator_id          UUID        NOT NULL
--   asof                  DATE        NOT NULL
--   value_usd             NUMERIC     NOT NULL
--   breakdown             JSONB       (nullable)
--   reconstructed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
--   source                TEXT        NOT NULL DEFAULT 'exchange_primary'
--   history_depth_months  INTEGER     (nullable; CHECK NULL OR > 0)
-- PK (allocator_id, asof); source CHECK in ('exchange_primary',
-- 'coingecko_fallback','mixed').
--
-- The INSERT below mirrors persist_equity_snapshots' per-row history_depth
-- rule (WR-05): attach p_depth_months ONLY to rows whose source is
-- 'exchange_primary'; all other sources (coingecko_fallback / mixed) get NULL.
-- This keeps the RPC byte-for-byte equivalent to the Python persist path it
-- replaces, so reconciliation and the dashboard's minHistoryDepthMonths logic
-- are unchanged.
--
-- SCOPING / SECURITY
-- ------------------
-- - SECURITY DEFINER with SET search_path = public, pg_temp (matches sibling
--   upsert_strategy_analytics_series_batch, migration 087).
-- - DELETE strictly scoped to p_allocator_id (no cross-allocator wipe).
-- - All table names fully-qualified (public.allocator_equity_snapshots).
-- - REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT EXECUTE TO service_role
--   ONLY — the analytics worker connects as service_role and is the sole
--   producer of these rows (mirrors upsert_strategy_analytics_series_batch).
-- - CREATE OR REPLACE FUNCTION — idempotent-safe re-apply.
--
-- APPLICATION PATH
-- ----------------
-- Authored here; auto-applied to the linked Supabase project on merge to main
-- (supabase-migrate workflow). The self-verifying DO block at the tail raises
-- EXCEPTION on any invariant failure.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- replace_allocator_equity_snapshots: atomic DELETE + INSERT for one allocator
-- ==========================================================================
CREATE OR REPLACE FUNCTION replace_allocator_equity_snapshots(
  p_allocator_id UUID,
  p_rows         JSONB,    -- array of {asof, value_usd, breakdown, source}
  p_depth_months INTEGER   -- per WR-05: applied only to source='exchange_primary' rows
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_inserted INTEGER;
BEGIN
  -- Single implicit transaction: the purge and the insert commit together or
  -- not at all. A crash mid-function rolls back the DELETE, so the allocator's
  -- existing history survives intact (E4 / HIGH8 fix).

  -- 1. Purge — strictly scoped to this allocator.
  DELETE FROM public.allocator_equity_snapshots
    WHERE allocator_id = p_allocator_id;

  -- 2. Insert the freshly replayed rows. jsonb_to_recordset projects the
  --    array; reconstructed_at uses the column DEFAULT (now()). The CASE on
  --    source mirrors persist_equity_snapshots' WR-05 per-row depth rule.
  WITH ins AS (
    INSERT INTO public.allocator_equity_snapshots (
      allocator_id, asof, value_usd, breakdown, source, history_depth_months
    )
    SELECT
      p_allocator_id,
      r.asof,
      r.value_usd,
      r.breakdown,
      r.source,
      CASE WHEN r.source = 'exchange_primary' THEN p_depth_months ELSE NULL END
    FROM jsonb_to_recordset(COALESCE(p_rows, '[]'::jsonb)) AS r(
      asof       DATE,
      value_usd  NUMERIC,
      breakdown  JSONB,
      source     TEXT
    )
    -- Defensive: the worker dedupes by asof, but guard against a duplicate
    -- asof inside p_rows so the INSERT can't fail the (allocator_id, asof) PK
    -- and roll back the whole replace. First row for an asof wins.
    ON CONFLICT (allocator_id, asof) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_inserted FROM ins;

  RETURN v_inserted;
END;
$$;

COMMENT ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer) IS
  'Atomic sole-key equity-history replacement: DELETE all rows for p_allocator_id then INSERT p_rows in ONE transaction. Replaces the non-transactional _purge + persist round-trips so a crash between them can no longer wipe history (red-team E4 / HIGH8). Per-row history_depth_months mirrors persist_equity_snapshots WR-05 (exchange_primary rows get p_depth_months, others NULL). service_role only.';

REVOKE ALL ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer)
  TO service_role;

-- ==========================================================================
-- Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_probe_alloc  UUID := gen_random_uuid();
  v_other_alloc  UUID := gen_random_uuid();
  v_count        INTEGER;
  v_depth        INTEGER;
  v_other_survives INTEGER;
BEGIN
  -- (a) function exists with the expected 3-arg signature
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'replace_allocator_equity_snapshots'
      AND pronargs = 3
  ) THEN
    RAISE EXCEPTION 'E4 migration failed: replace_allocator_equity_snapshots(uuid,jsonb,integer) missing';
  END IF;

  -- (b) SECURITY DEFINER + search_path set
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'replace_allocator_equity_snapshots'
      AND pronargs = 3
      AND prosecdef = true
  ) THEN
    RAISE EXCEPTION 'E4 migration failed: replace_allocator_equity_snapshots must be SECURITY DEFINER';
  END IF;

  -- (c) GRANT EXECUTE to service_role only (anon/authenticated/public denied).
  -- Use has_function_privilege (repo convention — migration 20260409133655 /
  -- function_execute_hardening) rather than parsing the proacl ACL string.
  IF NOT has_function_privilege(
       'service_role',
       'public.replace_allocator_equity_snapshots(uuid, jsonb, integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'E4 migration failed: service_role must have EXECUTE on replace_allocator_equity_snapshots';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.replace_allocator_equity_snapshots(uuid, jsonb, integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'E4 migration failed: anon must NOT have EXECUTE on replace_allocator_equity_snapshots';
  END IF;
  IF has_function_privilege(
       'authenticated',
       'public.replace_allocator_equity_snapshots(uuid, jsonb, integer)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'E4 migration failed: authenticated must NOT have EXECUTE on replace_allocator_equity_snapshots';
  END IF;

  -- (d) functional probe: seed stale rows for two allocators, then replace
  --     ONLY the probe allocator's rows. The other allocator must be untouched
  --     (scope check) and the probe's rows must be exactly the new set.
  INSERT INTO auth.users (id, email)
    VALUES (v_probe_alloc, 'e4-probe-' || v_probe_alloc || '@invalid.local'),
           (v_other_alloc, 'e4-other-' || v_other_alloc || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.allocator_equity_snapshots (allocator_id, asof, value_usd, source)
    VALUES (v_probe_alloc, DATE '2026-01-01', 111.11, 'exchange_primary'),
           (v_probe_alloc, DATE '2026-01-02', 222.22, 'exchange_primary'),
           (v_other_alloc, DATE '2026-01-01', 999.99, 'exchange_primary');

  SELECT replace_allocator_equity_snapshots(
    v_probe_alloc,
    '[{"asof":"2026-02-01","value_usd":500.5,"breakdown":{"USDT":500.5},"source":"exchange_primary"},
      {"asof":"2026-02-02","value_usd":600.6,"breakdown":{"USDT":600.6},"source":"coingecko_fallback"}]'::jsonb,
    24
  ) INTO v_count;

  IF v_count <> 2 THEN
    RAISE EXCEPTION 'E4 migration failed: expected 2 inserted rows, got %', v_count;
  END IF;

  -- Probe allocator must hold EXACTLY the 2 new rows (old 2 purged).
  SELECT count(*) INTO v_count
    FROM public.allocator_equity_snapshots WHERE allocator_id = v_probe_alloc;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'E4 migration failed: probe allocator expected 2 rows post-replace, got %', v_count;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-01-01'
  ) THEN
    RAISE EXCEPTION 'E4 migration failed: stale probe row 2026-01-01 not purged';
  END IF;

  -- WR-05 per-row depth: exchange_primary row gets depth, coingecko gets NULL.
  SELECT history_depth_months INTO v_depth
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-02-01';
  IF v_depth IS DISTINCT FROM 24 THEN
    RAISE EXCEPTION 'E4 migration failed: exchange_primary row history_depth_months expected 24, got %',
      COALESCE(v_depth::text, '<null>');
  END IF;
  SELECT history_depth_months INTO v_depth
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-02-02';
  IF v_depth IS NOT NULL THEN
    RAISE EXCEPTION 'E4 migration failed: coingecko_fallback row history_depth_months expected NULL, got %', v_depth;
  END IF;

  -- Scope check: the OTHER allocator's row must survive untouched.
  SELECT count(*) INTO v_other_survives
    FROM public.allocator_equity_snapshots WHERE allocator_id = v_other_alloc;
  IF v_other_survives <> 1 THEN
    RAISE EXCEPTION 'E4 migration failed: cross-allocator wipe — other allocator expected 1 row, got %', v_other_survives;
  END IF;

  -- Cleanup (transaction-control statements forbidden in DO blocks).
  DELETE FROM public.allocator_equity_snapshots
    WHERE allocator_id IN (v_probe_alloc, v_other_alloc);
  DELETE FROM auth.users WHERE id IN (v_probe_alloc, v_other_alloc);

  RAISE NOTICE 'E4 migration: all self-verification assertions (a-d) passed.';
END
$$;

COMMIT;
