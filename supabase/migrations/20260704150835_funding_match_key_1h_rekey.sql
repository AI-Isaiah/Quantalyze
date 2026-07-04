-- BYB-02: re-key bybit/okx funding_fees match_keys from the 8h bucket to
-- the 1h bucket, matching the app-side _FUNDING_BUCKET_HOURS change
-- (binance was already 1h — H-1099).
--
-- Why: Bybit runs dynamic 1h/4h/8h funding cadences per symbol. The 8h
-- match_key bucket collapsed distinct settlements onto one key, and the
-- ON CONFLICT upsert silently dropped all but one row per bucket (>50% of
-- funding rows lost for the live Bybit strategy; prod reconcile run 4,
-- 2026-07-04). OKX supports the same sub-8h cadences (latent).
--
-- Collision safety (within the legacy rows): the old 8h uniqueness
-- guarantees at most ONE stored row per (strategy, exchange, symbol,
-- 8h window), so flooring each row's own timestamp to 1h produces
-- distinct new keys. Old-format keys only carry hours 0/8/16, and rows
-- AT those hours keep byte-identical keys, so no new key can collide
-- with a not-yet-updated old key.
--
-- Deploy-gap safety (data-migration review, 2026-07-04): the same
-- settlement can exist under BOTH formats when a worker writes across
-- the migration/deploy boundary (new code inserts a 1h-keyed row before
-- this migration runs, or old code re-inserts an 8h-keyed row after it).
-- UNIQUE(match_key) cannot prevent that, and a plain UPDATE would abort
-- with 23505 when the 1h target key is already occupied. So: DELETE the
-- legacy-keyed duplicate first (the occupying 1h row is the same
-- settlement — same strategy/exchange/symbol/hour; sub-1h cadences do
-- not exist — fetched fresh by the new code), THEN re-key the rest.
-- Idempotent end-to-end; safe to re-run after the worker deploy to
-- sweep any strays written during the gap (post-deploy runbook step).
--
-- The rows the 8h bucket already discarded cannot be reconstructed here —
-- they are restored by the post-deploy funding re-backfill (365d, upsert
-- on match_key).
--
-- Format authority: the key shape below must stay byte-identical to
-- _build_match_key in analytics-service/services/funding_fetch.py
-- (strftime '%Y-%m-%dT%H:%M:%S+00:00' on a UTC hour-floored datetime).
-- test_funding_match_key_sql_parity.py pins both sides.
--
-- Forward-only: no meaningful down-migration exists. Reversing 1h -> 8h
-- would re-collapse distinct settlements onto one key (the very bug) and
-- itself hit UNIQUE violations. See down/20260704150835-rollback.sql.

-- Step 1: drop legacy-keyed rows whose 1h target key is already occupied
-- (deploy-gap duplicates — the occupying row is the same settlement).
DELETE FROM funding_fees f
WHERE f.exchange IN ('bybit', 'okx')
  AND f.match_key <> f.strategy_id::text || ':' || f.exchange || ':' || f.symbol || ':'
    || to_char(
         date_trunc('hour', f.timestamp AT TIME ZONE 'UTC'),
         'YYYY-MM-DD"T"HH24:MI:SS+00:00'
       )
  AND EXISTS (
    SELECT 1 FROM funding_fees g
    WHERE g.match_key = f.strategy_id::text || ':' || f.exchange || ':' || f.symbol || ':'
      || to_char(
           date_trunc('hour', f.timestamp AT TIME ZONE 'UTC'),
           'YYYY-MM-DD"T"HH24:MI:SS+00:00'
         )
  );

-- Step 2: re-key the remaining legacy rows to the 1h form.
UPDATE funding_fees
SET match_key = strategy_id::text || ':' || exchange || ':' || symbol || ':'
    || to_char(
         date_trunc('hour', timestamp AT TIME ZONE 'UTC'),
         'YYYY-MM-DD"T"HH24:MI:SS+00:00'
       )
WHERE exchange IN ('bybit', 'okx')
  AND match_key <> strategy_id::text || ':' || exchange || ':' || symbol || ':'
    || to_char(
         date_trunc('hour', timestamp AT TIME ZONE 'UTC'),
         'YYYY-MM-DD"T"HH24:MI:SS+00:00'
       );
