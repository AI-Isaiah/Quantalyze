-- Migration: persist pre_terminus_balance_unknown on allocator_equity_snapshots
-- ===========================================================================
-- CL9 / NEW-C01-11 (audit-2026-05-07 cluster, red-team MED8)
-- ---------------------------------------------------------------------------
-- PROBLEM
-- -------
-- When OKX's 90-day trade-history terminus is hit during equity
-- reconstruction, the replay starts from quantities={} (zero cash) because
-- the funding deposit that opened the still-open positions falls OUTSIDE the
-- fetch window. Every reconstructed row is then built against that missing
-- baseline, so the absolute equity level (and the drawdown / TWR derived from
-- it) is garbage for the whole clamped window — the −1510% / −$18k pathology
-- the anchor comment in equity_reconstruction.py describes. The analytics
-- worker already (a) skips the anchor entirely on terminus so it can't corrupt
-- the curve further, and (b) stamps `pre_terminus_balance_unknown=True` in the
-- compute-job audit metadata. But that flag never reached the snapshot ROWS,
-- so getMyAllocationDashboard had no signal and the user dashboard still
-- rendered the garbage absolute-level curve + drawdown.
--
-- FIX
-- ---
-- Persist the flag per-row so the frontend can suppress the untrustworthy
-- level-derived surfaces (equity curve, drawdown, TWR) for the affected rows
-- while the trustworthy daily-refresh rows (flag=false, today's live mark)
-- render normally as they accrue.
--
--   1. ADD COLUMN pre_terminus_balance_unknown BOOLEAN NOT NULL DEFAULT false.
--      A constant DEFAULT is a catalogue-only change in PostgreSQL (no table
--      rewrite), so this is safe on the production table. Existing rows
--      backfill to false = "baseline known / render normally", which exactly
--      preserves today's behaviour for all historical data.
--   2. CREATE OR REPLACE the atomic replace_allocator_equity_snapshots RPC to
--      read + persist the new column. The flag rides INSIDE the existing
--      p_rows JSONB, so the function SIGNATURE is unchanged (uuid, jsonb,
--      integer) — this is a pure CREATE OR REPLACE, not a new overload.
--      jsonb_to_recordset gains a pre_terminus_balance_unknown boolean field
--      and the INSERT uses COALESCE(r.pre_terminus_balance_unknown, false) so
--      a pre-deploy worker (whose payload omits the field) still inserts false
--      rather than tripping the NOT NULL. The other persist path
--      (persist_equity_snapshots, a PostgREST upsert in Python) writes the
--      column directly from the stamped row dict — no SQL change needed there.
--
-- Everything else about the RPC (DELETE scope, WR-05 per-row history_depth
-- CASE, ON CONFLICT DO NOTHING, SECURITY DEFINER, search_path, grants) is
-- reproduced verbatim from migration 20260527102050 — the ONLY delta is the
-- single new column in the projection + INSERT.
--
-- APPLICATION PATH
-- ----------------
-- Authored here; auto-applied to the linked Supabase project on merge to main
-- (supabase-migrate workflow). The self-verifying DO block at the tail raises
-- EXCEPTION on any invariant failure.

BEGIN;

SET lock_timeout = '3s';

-- ==========================================================================
-- 1. New column — NOT NULL DEFAULT false (catalogue-only, no rewrite)
-- ==========================================================================
ALTER TABLE public.allocator_equity_snapshots
  ADD COLUMN IF NOT EXISTS pre_terminus_balance_unknown BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.allocator_equity_snapshots.pre_terminus_balance_unknown IS
  'CL9 / NEW-C01-11: true when this row was reconstructed against an unknown '
  'absolute baseline (OKX 90-day terminus clamped the funding deposit out of '
  'the fetch window), so its absolute equity level — and any drawdown / TWR '
  'derived from it — is unreliable. getMyAllocationDashboard excludes flagged '
  'rows from level-derived surfaces. Daily-refresh rows (today''s live mark) '
  'and all pre-existing rows are false. Written by the analytics worker '
  '(service_role) only.';

-- ==========================================================================
-- 2. replace_allocator_equity_snapshots — persist the new column
-- ==========================================================================
-- Signature UNCHANGED (uuid, jsonb, integer): the flag rides inside p_rows.
CREATE OR REPLACE FUNCTION replace_allocator_equity_snapshots(
  p_allocator_id UUID,
  p_rows         JSONB,    -- array of {asof, value_usd, breakdown, source, pre_terminus_balance_unknown}
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
  'Atomic sole-key equity-history replacement: DELETE all rows for p_allocator_id then INSERT p_rows in ONE transaction. Replaces the non-transactional _purge + persist round-trips so a crash between them can no longer wipe history (red-team E4 / HIGH8). Per-row history_depth_months mirrors persist_equity_snapshots WR-05 (exchange_primary rows get p_depth_months, others NULL). CL9 / NEW-C01-11: also persists pre_terminus_balance_unknown (COALESCE to false for pre-deploy callers). service_role only.';

REVOKE ALL ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION replace_allocator_equity_snapshots(uuid, jsonb, integer)
  TO service_role;

-- ==========================================================================
-- Self-verifying DO block
-- ==========================================================================
DO $$
DECLARE
  v_col_type     TEXT;
  v_col_nullable TEXT;
  v_col_default  TEXT;
  v_probe_alloc  UUID := gen_random_uuid();
  v_flag_true    BOOLEAN;
  v_flag_false   BOOLEAN;
  v_flag_omitted BOOLEAN;
  v_count        INTEGER;
BEGIN
  -- (a) column exists, boolean, NOT NULL, default false
  SELECT data_type, is_nullable, column_default
    INTO v_col_type, v_col_nullable, v_col_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'allocator_equity_snapshots'
      AND column_name = 'pre_terminus_balance_unknown';
  IF v_col_type IS NULL THEN
    RAISE EXCEPTION 'CL9 migration failed: pre_terminus_balance_unknown column missing';
  END IF;
  IF v_col_type <> 'boolean' THEN
    RAISE EXCEPTION 'CL9 migration failed: pre_terminus_balance_unknown must be boolean, got %', v_col_type;
  END IF;
  IF v_col_nullable <> 'NO' THEN
    RAISE EXCEPTION 'CL9 migration failed: pre_terminus_balance_unknown must be NOT NULL, got is_nullable=%', v_col_nullable;
  END IF;
  IF v_col_default IS NULL OR position('false' in lower(v_col_default)) = 0 THEN
    RAISE EXCEPTION 'CL9 migration failed: pre_terminus_balance_unknown default must be false, got %',
      COALESCE(v_col_default, '<null>');
  END IF;

  -- (b) functional probe: the RPC must persist the per-row flag, defaulting a
  --     row that OMITS the field to false (COALESCE backstop).
  INSERT INTO auth.users (id, email)
    VALUES (v_probe_alloc, 'cl9-probe-' || v_probe_alloc || '@invalid.local')
    ON CONFLICT (id) DO NOTHING;

  SELECT replace_allocator_equity_snapshots(
    v_probe_alloc,
    '[{"asof":"2026-02-01","value_usd":100.0,"breakdown":{"USDT":100.0},"source":"exchange_primary","pre_terminus_balance_unknown":true},
      {"asof":"2026-02-02","value_usd":200.0,"breakdown":{"USDT":200.0},"source":"exchange_primary","pre_terminus_balance_unknown":false},
      {"asof":"2026-02-03","value_usd":300.0,"breakdown":{"USDT":300.0},"source":"exchange_primary"}]'::jsonb,
    3
  ) INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'CL9 migration failed: expected 3 inserted rows, got %', v_count;
  END IF;

  SELECT pre_terminus_balance_unknown INTO v_flag_true
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-02-01';
  SELECT pre_terminus_balance_unknown INTO v_flag_false
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-02-02';
  SELECT pre_terminus_balance_unknown INTO v_flag_omitted
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-02-03';

  IF v_flag_true IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'CL9 migration failed: flagged row should persist pre_terminus_balance_unknown=true, got %',
      COALESCE(v_flag_true::text, '<null>');
  END IF;
  IF v_flag_false IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CL9 migration failed: unflagged row should persist pre_terminus_balance_unknown=false, got %',
      COALESCE(v_flag_false::text, '<null>');
  END IF;
  IF v_flag_omitted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'CL9 migration failed: row omitting the field should COALESCE to false, got %',
      COALESCE(v_flag_omitted::text, '<null>');
  END IF;

  -- Cleanup (transaction-control statements forbidden in DO blocks).
  DELETE FROM public.allocator_equity_snapshots WHERE allocator_id = v_probe_alloc;
  DELETE FROM auth.users WHERE id = v_probe_alloc;

  RAISE NOTICE 'CL9 migration: all self-verification assertions (a-b) passed.';
END
$$;

COMMIT;
