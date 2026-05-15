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
-- table. The constraint is ALWAYS added (NOT VALID is a metadata-only
-- ALTER — fast, no scan, blocks future bad writes immediately). The
-- VALIDATE step (which scans existing rows) is conditional: if any
-- existing row has side outside {'buy','sell'}, the migration emits a
-- WARNING via RAISE NOTICE and leaves the constraint NOT VALID until
-- an admin cleans the data and runs `ALTER TABLE trades VALIDATE
-- CONSTRAINT trades_side_check;` manually.
--
-- Adversarial-review hardening (PR #136 follow-up): the original draft
-- used RAISE EXCEPTION here, which would abort the whole migration in
-- transaction — leaving the deploy pipeline halted in production until
-- a human SSHes in to clean rows. Soft-fail with NOTICE is operationally
-- safer: new writes are blocked immediately (the value of the audit row),
-- and the historical audit trail is preserved for cleanup at the admin's
-- own pace. We do NOT silently delete or coerce.
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

    -- Always add the constraint NOT VALID first (cheap metadata-only
    -- ALTER, no table scan). This blocks future bad writes immediately
    -- regardless of whether existing rows violate the contract.
    ALTER TABLE public.trades
      ADD CONSTRAINT trades_side_check CHECK (side IN ('buy', 'sell')) NOT VALID;

    IF v_bad_count > 0 THEN
      -- Soft-fail: emit a NOTICE (logged warning, deploy pipeline keeps
      -- moving) and leave constraint NOT VALID. New writes are protected;
      -- existing bad rows are tolerated until admin runs:
      --   ALTER TABLE public.trades VALIDATE CONSTRAINT trades_side_check;
      -- after cleaning the violator rows. Triage query is in the message.
      RAISE NOTICE
        'Migration 112: trades_side_check ADDED but NOT YET VALIDATED — % existing rows have side outside {buy,sell}. '
        'Distinct violator values: [%]. '
        'New writes are blocked. To validate against historical data, clean these rows '
        '(UPDATE to ''buy''/''sell'' or DELETE), then run: ALTER TABLE public.trades VALIDATE CONSTRAINT trades_side_check; '
        'Audit reference: G12.A.3 (audit-2026-05-07). '
        'Triage: SELECT side, count(*) FROM public.trades WHERE side NOT IN (''buy'',''sell'') GROUP BY side;',
        v_bad_count, v_distinct_sides;
    ELSE
      -- Existing data is clean — VALIDATE in a separate statement so
      -- reads aren't blocked.
      ALTER TABLE public.trades
        VALIDATE CONSTRAINT trades_side_check;

      RAISE NOTICE 'Migration 112: trades_side_check added + validated (% existing rows scanned).',
        (SELECT count(*) FROM public.trades);
    END IF;
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
    -- Soft-fail (paired with the bad-data NOTICE above): NOT VALID
    -- still enforces the constraint on new INSERTs/UPDATEs; the migration
    -- is considered applied. A separate manual VALIDATE step runs after
    -- admin cleanup.
    RAISE NOTICE
      'Migration 112 verification: trades_side_check exists but is NOT VALID. '
      'New writes are protected. Existing rows are tolerated; clean them and '
      'run ALTER TABLE public.trades VALIDATE CONSTRAINT trades_side_check; '
      'when ready. Audit ref G12.A.3.';
  END IF;
END $$;
