-- Phase 68 (DRB-02) — widen the four KEY-SAVING boundary CHECK constraints to
-- admit 'deribit', in lockstep with the TS SUPPORTED_EXCHANGES allowlist
-- (src/lib/closed-sets.ts) and the pydantic Literals (schemas.py /
-- debug_key_flow.py / adapter.py). 2026-07-04.
--
-- Why this migration exists
-- -------------------------
-- Phase 68 admits 'deribit' at every key-saving boundary so a deribit key can
-- be saved and verified (Phase 69 wizard UX / Phase 72 verification build on
-- this). The four columns below are the SQL last-line-of-defense on the
-- key/strategy-bearing tables. Each is re-based on its LATEST definition (grep
-- of ALL migrations, 2026-07-04, confirmed no later ALTER re-based any):
--   - api_keys.exchange              (inline, 20260405061911_initial_schema.sql:22)
--   - compute_jobs.exchange          (inline, 20260411144407_compute_jobs_queue.sql:132 — nullable form)
--   - strategies.source              (NAMED, 20260506211806_strategies_source_csv.sql:48-58 — 8 values)
--   - strategy_verifications.source  (inline, 20260501055202_strategy_verifications.sql:91)
--
-- Canonical auto-names are LOAD-BEARING: the parity contract test's
-- resolveColumnCheck (src/__tests__/contracts/check-zod-db-check-parity.test.ts)
-- resolves the named `<table>_<column>_check` first. The inline CHECKs above are
-- auto-named `<table>_<column>_check` by Postgres, so DROP CONSTRAINT IF EXISTS
-- on that name is correct.
--
-- OQ3 (live prod schema verified via Supabase MCP 2026-07-04): WIDEN exactly
-- these four. Deliberately NOT touched (parity-pinned exclusions, Plan 68-03):
--   - the funding-fees exchange CHECK — BYB-02 / Phase 70 (continuous Deribit
--                                       funding needs a native-id/exact-ts dedup
--                                       axis; a floor bucket would collapse
--                                       distinct events)
--   - the position-snapshots exchange CHECK — Phase 71 (derivative positions)
--   - the verification-requests VIEW + its frozen Phase-19 legacy table — a
--                                       DROP CONSTRAINT on a VIEW would error;
--                                       never touch either.
--
-- Safety: widening a CHECK only ADDS an admitted value, so no existing row can
-- violate the new constraint — no data backfill or pre-flight scan required.
-- Each table gets a self-verifying DO block that RAISEs if the new definition is
-- missing 'deribit' or any pre-existing value (fail-loud at apply, never a
-- silent no-op).
--
-- Forward-only: no DOWN shim (re-narrowing after a deribit row exists would fail
-- validation). Recovery is intentionally manual — mirrors migration 100.

BEGIN;

-- Bound the apply-time blast radius if a table is locked or a validation scan is
-- slow. Mirrors 20260506211806 line 42 / migration 093 line 66.
SET lock_timeout = '3s';

-- ==========================================================================
-- 1. api_keys.exchange  (auto-named api_keys_exchange_check)
-- ==========================================================================
ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_exchange_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_exchange_check
  CHECK (exchange IN ('binance', 'okx', 'bybit', 'deribit'));

DO $$
DECLARE
  def TEXT;
  expected_value TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'api_keys_exchange_check'
    AND conrelid = 'public.api_keys'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'Phase 68 self-verify failed: api_keys_exchange_check missing after apply';
  END IF;
  FOREACH expected_value IN ARRAY ARRAY['binance', 'okx', 'bybit', 'deribit'] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 68 self-verify failed: api_keys_exchange_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

-- ==========================================================================
-- 2. compute_jobs.exchange  (auto-named compute_jobs_exchange_check; nullable)
--    PRESERVE the `exchange IS NULL OR` form — this column is nullable.
-- ==========================================================================
ALTER TABLE compute_jobs
  DROP CONSTRAINT IF EXISTS compute_jobs_exchange_check;
ALTER TABLE compute_jobs
  ADD CONSTRAINT compute_jobs_exchange_check
  CHECK (exchange IS NULL OR exchange IN ('binance', 'okx', 'bybit', 'deribit'));

DO $$
DECLARE
  def TEXT;
  expected_value TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'compute_jobs_exchange_check'
    AND conrelid = 'public.compute_jobs'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'Phase 68 self-verify failed: compute_jobs_exchange_check missing after apply';
  END IF;
  IF position('IS NULL' IN def) = 0 THEN
    RAISE EXCEPTION 'Phase 68 self-verify failed: compute_jobs_exchange_check lost its nullable (IS NULL OR) form (def=%)', def;
  END IF;
  FOREACH expected_value IN ARRAY ARRAY['binance', 'okx', 'bybit', 'deribit'] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 68 self-verify failed: compute_jobs_exchange_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

-- ==========================================================================
-- 3. strategies.source  (NAMED strategies_source_check; 8 values -> 9)
--    Key-created strategies stamp source=exchange (OQ3), so 'deribit' joins the
--    existing legacy/wizard/admin_import/allocator_connected/csv/okx/binance/bybit set.
-- ==========================================================================
ALTER TABLE strategies
  DROP CONSTRAINT IF EXISTS strategies_source_check;
ALTER TABLE strategies
  ADD CONSTRAINT strategies_source_check
  CHECK (source IN (
    'legacy',
    'wizard',
    'admin_import',
    'allocator_connected',
    'csv',
    'okx',
    'binance',
    'bybit',
    'deribit'
  ));

DO $$
DECLARE
  def TEXT;
  expected_value TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'strategies_source_check'
    AND conrelid = 'public.strategies'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'Phase 68 self-verify failed: strategies_source_check missing after apply';
  END IF;
  FOREACH expected_value IN ARRAY ARRAY[
    'legacy', 'wizard', 'admin_import', 'allocator_connected',
    'csv', 'okx', 'binance', 'bybit', 'deribit'
  ] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 68 self-verify failed: strategies_source_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

-- ==========================================================================
-- 4. strategy_verifications.source  (auto-named strategy_verifications_source_check)
--    OQ3 lockstep-bias decision: WIDEN — the LIVE verify write path; Phase 72
--    verification acceptance needs it. The verification-requests projection is
--    now a VIEW (20260620120000) — this ALTER targets the underlying TABLE only.
-- ==========================================================================
ALTER TABLE strategy_verifications
  DROP CONSTRAINT IF EXISTS strategy_verifications_source_check;
ALTER TABLE strategy_verifications
  ADD CONSTRAINT strategy_verifications_source_check
  CHECK (source IN ('okx', 'binance', 'bybit', 'csv', 'deribit'));

DO $$
DECLARE
  def TEXT;
  expected_value TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def
  FROM pg_constraint
  WHERE conname = 'strategy_verifications_source_check'
    AND conrelid = 'public.strategy_verifications'::regclass;
  IF def IS NULL THEN
    RAISE EXCEPTION 'Phase 68 self-verify failed: strategy_verifications_source_check missing after apply';
  END IF;
  FOREACH expected_value IN ARRAY ARRAY['okx', 'binance', 'bybit', 'csv', 'deribit'] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 68 self-verify failed: strategy_verifications_source_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Refresh the strategy_verifications.source vocabulary comment (Phase 68 widen).
COMMENT ON COLUMN strategy_verifications.source IS
  'Phase 15 wrote source=''csv''. Phase 68 (DRB-02) widened the CHECK to admit ''deribit'' at the key-save/verify boundary. Full vocabulary: okx/binance/bybit/csv/deribit — pinned in lockstep with TS SUPPORTED_EXCHANGES + the pydantic Literals.';
