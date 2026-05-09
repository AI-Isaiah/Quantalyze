-- Migration 112: trades.side must be one of {'buy','sell'}
-- (audit-2026-05-07 G12.A.3, HIGH)
--
-- Why this migration exists
-- -------------------------
-- migration 001 created the `trades` table with `side TEXT NOT NULL` and
-- no CHECK constraint. migration 039 added is_fill rows but did NOT add a
-- CHECK on the side column. Meanwhile worker code (analytics_runner.py
-- L110, position_reconstruction.py L823, equity_reconstruction.py, and
-- job_worker.py downstream) branches on `side == 'buy' | 'sell' |
-- 'long' | 'short'` interchangeably:
--
--   * Fill-side values from CCXT normalizers are 'buy' / 'sell'.
--   * Position-side values (positions.side, migration 040 L3512) are
--     'long' / 'short' and DO have a CHECK constraint.
--
-- Without a DB-level CHECK on trades.side, a typo / future-exchange
-- normalizer change / admin fixup script could land an unrecognized
-- value (e.g. 'long', 'BUY', 'short_close') and silently break every
-- downstream metric that bucket-counts by exact-string side. Worse:
-- _compute_volume_metrics historically aliased `long_volume_pct =
-- buy_pct` (the exact bug that motivated this audit row) — adding the
-- DB-level CHECK locks the contract that side is a fill-side, never a
-- position-direction.
--
-- Compounding risk: positions.side has a CHECK constraint
-- (`CHECK (side IN ('long','short'))`), so the schema asymmetry alone
-- is a code smell — a future contributor who reads positions.side and
-- assumes trades.side has the same shape gets a silent type-conflation
-- bug.
--
-- Fix
-- ---
-- Add a CHECK constraint on trades.side admitting only {'buy','sell'}.
-- Use NOT VALID + VALIDATE so the lock window is short on an existing
-- table — but only VALIDATE if no rows violate the contract today. If
-- non-{buy,sell} rows exist (e.g. legacy 'long'/'short' summary rows
-- or a typo'd batch), the migration RAISEs with a clear message so the
-- admin must clean the data first. We do NOT silently delete or coerce
-- — the audit trail of the bad data is more valuable than a silent
-- "passing" migration.
--
-- Idempotency
-- -----------
-- The DO block guards against re-applying the constraint (skips if it
-- already exists). The VALIDATE step is also re-runnable.
--
-- Rollback
-- --------
-- `ALTER TABLE trades DROP CONSTRAINT trades_side_check;` reverts the
-- contract. No data is altered — drop is safe at any point.
--
-- Tests: src/__tests__/trades-side-check-constraint-2026-05-07-g12a.test.ts
-- asserts this file's text shape so future migrations don't silently
-- drop the constraint without re-adding it.

DO $$
DECLARE
  v_bad_count BIGINT;
  v_distinct_sides TEXT;
  v_constraint_exists BOOLEAN;
BEGIN
  -- Skip if already applied (idempotent re-run).
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint c
      JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public'
       AND t.relname = 'trades'
       AND c.conname = 'trades_side_check'
  ) INTO v_constraint_exists;

  IF v_constraint_exists THEN
    RAISE NOTICE 'Migration 112: trades_side_check already exists — skipping ADD';
  ELSE
    -- Survey existing distinct side values. If any are outside
    -- {'buy','sell'}, RAISE with a clear message so an admin cleans
    -- first. Better than NOT VALID forever-pending or silent breakage.
    SELECT count(*),
           string_agg(DISTINCT side, ',' ORDER BY side)
      INTO v_bad_count, v_distinct_sides
      FROM public.trades
     WHERE side IS NOT NULL
       AND side NOT IN ('buy', 'sell');

    IF v_bad_count > 0 THEN
      RAISE EXCEPTION
        'Migration 112 cannot apply trades_side_check: % existing rows have side outside {buy,sell}. '
        'Distinct violator values: [%]. '
        'Clean these rows first (UPDATE to ''buy''/''sell'' or DELETE), then re-run migration 112. '
        'Audit reference: G12.A.3 (audit-2026-05-07). '
        'Suggested triage: SELECT side, count(*) FROM public.trades WHERE side NOT IN (''buy'',''sell'') GROUP BY side;',
        v_bad_count, v_distinct_sides;
    END IF;

    -- Existing data is clean — add the constraint with NOT VALID first
    -- (cheap metadata-only ALTER, no scan), then VALIDATE in a separate
    -- statement so reads aren't blocked.
    ALTER TABLE public.trades
      ADD CONSTRAINT trades_side_check CHECK (side IN ('buy', 'sell')) NOT VALID;

    ALTER TABLE public.trades
      VALIDATE CONSTRAINT trades_side_check;

    RAISE NOTICE 'Migration 112: trades_side_check added + validated (% existing rows scanned).',
      (SELECT count(*) FROM public.trades);
  END IF;
END $$;

COMMENT ON CONSTRAINT trades_side_check ON public.trades IS
  'audit-2026-05-07 G12.A.3 — trades.side must be a fill-side ("buy"/"sell"), '
  'never a position-direction ("long"/"short"). positions.side carries '
  'long/short via its own CHECK; conflating the two surfaces silent metric '
  'bugs (e.g. long_volume_pct = buy_pct).';

-- Self-verification: the constraint must exist + be VALIDated before
-- the migration is considered applied. A future migration that drops
-- the constraint silently (or replaces it with a permissive variant)
-- fails loudly here on replay.
DO $$
DECLARE
  v_def TEXT;
  v_validated BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(c.oid), c.convalidated
    INTO v_def, v_validated
    FROM pg_catalog.pg_constraint c
    JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'trades'
     AND c.conname = 'trades_side_check';

  IF v_def IS NULL THEN
    RAISE EXCEPTION
      'Migration 112 verification failed: trades_side_check constraint does not exist on public.trades '
      'after ALTER TABLE ADD CONSTRAINT. Audit ref G12.A.3.';
  END IF;

  IF v_def NOT ILIKE '%side%IN%(%''buy''%''sell''%' THEN
    RAISE EXCEPTION
      'Migration 112 verification failed: trades_side_check definition does not constrain side to {buy,sell}. '
      'Got definition: %. Audit ref G12.A.3.', v_def;
  END IF;

  IF NOT v_validated THEN
    RAISE EXCEPTION
      'Migration 112 verification failed: trades_side_check exists but is NOT VALID (not yet validated). '
      'Existing data must satisfy the constraint before VALIDATE; check rows where '
      'side NOT IN (buy, sell). Audit ref G12.A.3.';
  END IF;
END $$;
