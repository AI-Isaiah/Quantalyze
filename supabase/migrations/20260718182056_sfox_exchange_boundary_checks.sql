-- Phase 119 (SFOX-04) — widen the four KEY-SAVING boundary CHECK constraints to
-- admit 'sfox', in lockstep with the TS SUPPORTED_EXCHANGES allowlist
-- (src/lib/closed-sets.ts) and the pydantic Literals (schemas.py /
-- debug_key_flow.py / adapter.py). 2026-07-18.
--
-- Why this migration exists
-- -------------------------
-- Phase 119 admits 'sfox' at every key-saving boundary so a sFOX key can be
-- saved and validated (the phase-118 SfoxClient read adapter + the non-ccxt
-- worker validate branch build on this). This clones the deribit precedent
-- 20260704200446_deribit_exchange_boundary_checks.sql EXACTLY (CONTEXT locked
-- decision D — "follow the deribit precedent EXACTLY"): the SAME four columns,
-- appending 'sfox'. Each is re-based on its LATEST definition — grep of ALL
-- migrations (2026-07-18) confirmed no later ALTER re-based any of the four
-- after 20260704200446 (only 20260506211806 / 20260704200446 touch
-- strategies_source_check; no later migration re-bases the other three):
--   - api_keys.exchange              (widened by 20260704200446, 4 values)
--   - compute_jobs.exchange          (widened by 20260704200446, nullable form)
--   - strategies.source              (NAMED, 20260704200446 — 9 values)
--   - strategy_verifications.source  (widened by 20260704200446, 5 values)
--
-- Canonical auto-names are LOAD-BEARING: the parity contract test's
-- resolveColumnCheck (src/__tests__/contracts/check-zod-db-check-parity.test.ts)
-- resolves the named `<table>_<column>_check` first (newest-wins). These named
-- ADD CONSTRAINTs are the newest, so the parity matrix now compares against the
-- 5-value / 6-value / 10-value sets defined here.
--
-- WIDEN exactly these four. Deliberately NOT touched (parity-pinned exclusions,
-- same skip set as the deribit precedent — see 119-RESEARCH.md):
--   - the funding_fees exchange CHECK — sFOX is SPOT; no perp funding. The B9
--                                       spec pins funding_fees.exchange to the
--                                       3-value FUNDING_EXCHANGES + rejects sfox.
--   - the position_snapshots exchange CHECK — sFOX has no derivative positions;
--                                       the B9 spec pins it 3-value.
--   - the verification_requests VIEW + its frozen Phase-19 legacy table — a
--                                       DROP CONSTRAINT on a VIEW would error;
--                                       never touch either.
--   - finalize_terminal_status_param.sql:188 terminal-status allowlist — deribit
--                                       itself is absent there; the api_verified
--                                       verification-row write for sFOX is phase
--                                       120 (RESOLVED: NO — do not add here).
--
-- Safety: widening a CHECK only ADDS an admitted value, so no existing row can
-- violate the new constraint — no data backfill or pre-flight scan required.
-- Each table gets a self-verifying DO block that RAISEs if the new definition is
-- missing 'sfox' or any pre-existing value (fail-loud at apply, never a silent
-- no-op).
--
-- Forward-only: no DOWN shim (re-narrowing after a sfox row exists would fail
-- validation). Recovery is intentionally manual — mirrors the deribit precedent.

BEGIN;

-- Bound the apply-time blast radius if a table is locked or a validation scan is
-- slow. Mirrors 20260704200446 line 48.
SET lock_timeout = '3s';

-- ==========================================================================
-- 1. api_keys.exchange  (auto-named api_keys_exchange_check)
-- ==========================================================================
ALTER TABLE api_keys
  DROP CONSTRAINT IF EXISTS api_keys_exchange_check;
ALTER TABLE api_keys
  ADD CONSTRAINT api_keys_exchange_check
  CHECK (exchange IN ('binance', 'okx', 'bybit', 'deribit', 'sfox'));

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
    RAISE EXCEPTION 'Phase 119 self-verify failed: api_keys_exchange_check missing after apply';
  END IF;
  FOREACH expected_value IN ARRAY ARRAY['binance', 'okx', 'bybit', 'deribit', 'sfox'] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 119 self-verify failed: api_keys_exchange_check does not admit % (def=%)', expected_value, def;
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
  CHECK (exchange IS NULL OR exchange IN ('binance', 'okx', 'bybit', 'deribit', 'sfox'));

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
    RAISE EXCEPTION 'Phase 119 self-verify failed: compute_jobs_exchange_check missing after apply';
  END IF;
  IF position('IS NULL' IN def) = 0 THEN
    RAISE EXCEPTION 'Phase 119 self-verify failed: compute_jobs_exchange_check lost its nullable (IS NULL OR) form (def=%)', def;
  END IF;
  FOREACH expected_value IN ARRAY ARRAY['binance', 'okx', 'bybit', 'deribit', 'sfox'] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 119 self-verify failed: compute_jobs_exchange_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

-- ==========================================================================
-- 3. strategies.source  (NAMED strategies_source_check; 9 values -> 10)
--    Key-created strategies stamp source=exchange, so 'sfox' joins the existing
--    legacy/wizard/admin_import/allocator_connected/csv/okx/binance/bybit/deribit set.
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
    'deribit',
    'sfox'
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
    RAISE EXCEPTION 'Phase 119 self-verify failed: strategies_source_check missing after apply';
  END IF;
  FOREACH expected_value IN ARRAY ARRAY[
    'legacy', 'wizard', 'admin_import', 'allocator_connected',
    'csv', 'okx', 'binance', 'bybit', 'deribit', 'sfox'
  ] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 119 self-verify failed: strategies_source_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

-- ==========================================================================
-- 4. strategy_verifications.source  (auto-named strategy_verifications_source_check)
--    Widen the persisted verify-source vocabulary to admit 'sfox' at the
--    key-save/verify boundary. The api_verified sfox WRITE (via
--    finalize_terminal_status_param) is phase 120 — this only ADMITS the value.
--    The verification-requests projection is a VIEW (20260620120000) — this
--    ALTER targets the underlying TABLE only.
-- ==========================================================================
ALTER TABLE strategy_verifications
  DROP CONSTRAINT IF EXISTS strategy_verifications_source_check;
ALTER TABLE strategy_verifications
  ADD CONSTRAINT strategy_verifications_source_check
  CHECK (source IN ('okx', 'binance', 'bybit', 'csv', 'deribit', 'sfox'));

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
    RAISE EXCEPTION 'Phase 119 self-verify failed: strategy_verifications_source_check missing after apply';
  END IF;
  FOREACH expected_value IN ARRAY ARRAY['okx', 'binance', 'bybit', 'csv', 'deribit', 'sfox'] LOOP
    IF position('''' || expected_value || '''' IN def) = 0 THEN
      RAISE EXCEPTION 'Phase 119 self-verify failed: strategy_verifications_source_check does not admit % (def=%)', expected_value, def;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Refresh the strategy_verifications.source vocabulary comment (Phase 119 widen).
COMMENT ON COLUMN strategy_verifications.source IS
  'Phase 15 wrote source=''csv''. Phase 68 (DRB-02) widened the CHECK to admit ''deribit''. Phase 119 (SFOX-04) widened it to admit ''sfox'' at the key-save/verify boundary. Full vocabulary: okx/binance/bybit/csv/deribit/sfox — pinned in lockstep with TS SUPPORTED_EXCHANGES + the pydantic Literals.';
