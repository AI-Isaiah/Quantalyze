-- B9 (Boundary Validation Parity) — add the missing funding_fees.exchange CHECK.
-- 2026-06-02.
--
-- Why this migration exists
-- -------------------------
-- Every other exchange-name column in the schema pins its value space to the
-- three supported venues via a CHECK constraint:
--   - api_keys.exchange           (20260405061911_initial_schema.sql:22)
--   - position_snapshots.exchange (20260412094450_position_snapshots.sql:52)
--   - compute_jobs.exchange       (20260411144407_compute_jobs_queue.sql:132)
--   - portfolio_intelligence.*    (20260407075303_portfolio_intelligence.sql:81)
-- funding_fees (migration 044, 20260416081039) was the lone exception:
-- `exchange TEXT NOT NULL` with NO CHECK, while the TS side narrows
-- FundingFee.exchange to the three literals (src/lib/types.ts) and
-- SUPPORTED_EXCHANGES (src/lib/closed-sets.ts) is the single source of truth.
-- The only enforcement was Python producer code (the sync_funding worker +
-- scripts/backfill_funding.py route through exchange.py create_exchange, which
-- supports only binance/okx/bybit). That is exactly the NEW-C40-01 / B9
-- boundary-parity class: a DB column the TS type claims is closed but the DB
-- leaves open, so a backfill typo or a future-venue change can write a row the
-- TS type says is impossible.
--
-- Fix: add the CHECK mirroring the sibling columns. The TS<->CHECK parity is now
-- pinned by src/__tests__/contracts/check-zod-db-check-parity.test.ts
-- (funding_fees.exchange spec) so a future divergence fails CI before it can
-- become a 23514 at insert.
--
-- Safety: adding the CHECK is SAFE — producers can only emit the three values,
-- so no existing row can violate it. The pre-flight guard below RAISEs with the
-- offending values if that assumption is ever false on a given environment
-- (fail-loud at apply with a diagnostic, not a bare check_violation). funding_fees
-- is a small append table, so the brief validation scan is unproblematic.
--
-- DROP-then-ADD idiom (re-runnable no-op; ordering-independent).

BEGIN;

-- Pre-flight: fail loud (listing the offending values) if any existing row would
-- violate the new constraint, rather than letting ADD CONSTRAINT throw a bare
-- check_violation. Producers only emit binance/okx/bybit, so this never fires in
-- practice — it documents the safety check and hands ops a precise diagnostic.
DO $$
DECLARE
  bad TEXT;
BEGIN
  SELECT string_agg(DISTINCT exchange, ', ') INTO bad
  FROM funding_fees
  WHERE exchange NOT IN ('binance', 'okx', 'bybit');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION
      'B9 migration aborted: funding_fees has out-of-range exchange value(s): %', bad;
  END IF;
END $$;

ALTER TABLE funding_fees
  DROP CONSTRAINT IF EXISTS funding_fees_exchange_check;
ALTER TABLE funding_fees
  ADD CONSTRAINT funding_fees_exchange_check
  CHECK (exchange IN ('binance', 'okx', 'bybit'));

-- Self-verifying DO block: assert the constraint exists and admits exactly the
-- three supported venues (mirrors the sibling columns + SUPPORTED_EXCHANGES).
DO $$
DECLARE
  def TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'funding_fees_exchange_check'
    AND conrelid = 'public.funding_fees'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'B9 migration failed: funding_fees_exchange_check not found';
  END IF;
  IF position('binance' IN def) = 0
     OR position('okx' IN def) = 0
     OR position('bybit' IN def) = 0 THEN
    RAISE EXCEPTION 'B9 migration failed: CHECK missing a supported venue (def=%)', def;
  END IF;
END $$;

COMMIT;
