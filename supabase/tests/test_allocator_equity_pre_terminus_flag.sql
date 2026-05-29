-- Test: allocator_equity_snapshots.pre_terminus_balance_unknown is persisted
-- (CL9 / NEW-C01-11). Guards migration
-- 20260529160000_allocator_equity_pre_terminus_flag.sql.
--
-- Background
-- ----------
-- On OKX 90-day terminus the equity replay starts from a zero baseline (the
-- funding deposit is outside the fetch window), so reconstructed rows carry
-- garbage absolute levels. The analytics worker stamps pre_terminus_balance_
-- unknown=true on those rows; the dashboard excludes flagged rows from
-- level-derived surfaces (equity curve / drawdown / TWR). This test pins the
-- column shape and the replace_allocator_equity_snapshots RPC's per-row
-- persistence (including the COALESCE-to-false backstop for a pre-deploy
-- worker whose payload omits the field).
--
-- Asserted invariants:
--   1. Column pre_terminus_balance_unknown exists, is boolean, NOT NULL,
--      default false.
--   2. The atomic replace RPC persists the per-row flag: true stays true,
--      false stays false, and a row OMITTING the field becomes false.
--
-- Test DB lag: the shared test DB tracks prod but lags main, so on a PR branch
-- the migration may not be applied yet. The assertions are gated on the column
-- being present (NOTICE skip otherwise) so the test becomes a hard regression
-- guard once the test DB catches up, without red-failing pre-apply. The
-- migration itself self-verifies on apply. Whole test rolls back.

BEGIN;

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
  SELECT data_type, is_nullable, column_default
    INTO v_col_type, v_col_nullable, v_col_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'allocator_equity_snapshots'
      AND column_name = 'pre_terminus_balance_unknown';

  IF v_col_type IS NULL THEN
    RAISE NOTICE 'SKIP: migration 20260529160000 not yet applied here (pre_terminus_balance_unknown column absent). Assertions enforce once the test DB catches up to prod.';
    RETURN;
  END IF;

  -- ---- (1) column shape ------------------------------------------------------
  IF v_col_type <> 'boolean' THEN
    RAISE EXCEPTION 'TEST FAILED (1): pre_terminus_balance_unknown must be boolean, got %', v_col_type;
  END IF;
  IF v_col_nullable <> 'NO' THEN
    RAISE EXCEPTION 'TEST FAILED (1): pre_terminus_balance_unknown must be NOT NULL, got is_nullable=%', v_col_nullable;
  END IF;
  IF v_col_default IS NULL OR position('false' in lower(v_col_default)) = 0 THEN
    RAISE EXCEPTION 'TEST FAILED (1): pre_terminus_balance_unknown default must be false, got %',
      COALESCE(v_col_default, '<null>');
  END IF;
  RAISE NOTICE 'Assertion 1 OK: column boolean NOT NULL DEFAULT false.';

  -- ---- (2) RPC persists the per-row flag (true / false / omitted->false) ------
  INSERT INTO auth.users (id, email)
    VALUES (v_probe_alloc, 'cl9t-' || v_probe_alloc::text || '@quantalyze.test')
    ON CONFLICT (id) DO NOTHING;

  SELECT replace_allocator_equity_snapshots(
    v_probe_alloc,
    '[{"asof":"2026-03-01","value_usd":10.0,"breakdown":{"USDT":10.0},"source":"exchange_primary","pre_terminus_balance_unknown":true},
      {"asof":"2026-03-02","value_usd":20.0,"breakdown":{"USDT":20.0},"source":"exchange_primary","pre_terminus_balance_unknown":false},
      {"asof":"2026-03-03","value_usd":30.0,"breakdown":{"USDT":30.0},"source":"exchange_primary"}]'::jsonb,
    3
  ) INTO v_count;
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'TEST FAILED (2): expected 3 inserted rows, got %', v_count;
  END IF;

  SELECT pre_terminus_balance_unknown INTO v_flag_true
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-03-01';
  SELECT pre_terminus_balance_unknown INTO v_flag_false
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-03-02';
  SELECT pre_terminus_balance_unknown INTO v_flag_omitted
    FROM public.allocator_equity_snapshots
    WHERE allocator_id = v_probe_alloc AND asof = DATE '2026-03-03';

  IF v_flag_true IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'TEST FAILED (2): flagged row should persist true, got %', COALESCE(v_flag_true::text, '<null>');
  END IF;
  IF v_flag_false IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (2): unflagged row should persist false, got %', COALESCE(v_flag_false::text, '<null>');
  END IF;
  IF v_flag_omitted IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'TEST FAILED (2): row omitting the field should COALESCE to false, got %', COALESCE(v_flag_omitted::text, '<null>');
  END IF;

  RAISE NOTICE 'Assertion 2 OK: replace RPC persists per-row flag (true / false / omitted->false).';
END $$;

ROLLBACK;
