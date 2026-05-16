-- Migration 092: convert trades_dedup_fill from partial to full UNIQUE index.
--
-- The previous partial index `trades_dedup_fill UNIQUE (strategy_id, exchange,
-- exchange_fill_id) WHERE is_fill = true` could not be targeted by PostgREST's
-- `on_conflict=...` query parameter (PostgREST does not forward partial-index
-- predicates), so the worker's Phase 2 raw-fill upsert at
-- analytics-service/services/job_worker.py:561 hit
-- "42P10 there is no unique or exclusion constraint matching the ON CONFLICT
-- specification" and lost all fetched fills.
--
-- Switching to a non-partial unique index lets PostgREST match the constraint
-- via column list alone. NULL exchange_fill_id rows (Phase 1 daily_pnl rows
-- that never carry a fill id) coexist freely because PostgreSQL treats NULLs
-- as distinct in unique indexes by default. Verified pre-migration:
--   - 134 trades rows total, 134 with NULL exchange_fill_id, 0 with empty string
--   - Pairwise check via GROUP BY shows no real-id collisions

DROP INDEX IF EXISTS public.trades_dedup_fill;

CREATE UNIQUE INDEX trades_dedup_fill
  ON public.trades USING btree (strategy_id, exchange, exchange_fill_id);

COMMENT ON INDEX public.trades_dedup_fill IS
  'Phase 2 raw-fill dedup. Full (non-partial) UNIQUE so PostgREST `on_conflict` '
  'in services/job_worker.py:run_sync_trades_job can target it via column list. '
  'Daily-PnL rows (is_fill=false, NULL exchange_fill_id) coexist because NULLs '
  'are distinct in PostgreSQL UNIQUE indexes. Migration 092.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'trades'
      AND indexname = 'trades_dedup_fill'
  ) THEN
    RAISE EXCEPTION 'Migration 092 failed: trades_dedup_fill index missing after recreate';
  END IF;
  RAISE NOTICE 'Migration 092: trades_dedup_fill recreated as full UNIQUE.';
END
$$;
