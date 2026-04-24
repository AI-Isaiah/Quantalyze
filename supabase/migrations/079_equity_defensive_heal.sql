-- ===========================================================================
-- Migration 079: re-heal equity snapshots under v0.15.4.2 defensive code.
-- ===========================================================================
-- Context: migration 078 purged every allocator_equity_snapshots row and
-- reset the per-api_key reconstruct idempotency gate, expecting the
-- v0.15.4.0 contract-size fix (amt_base = cost/price) to rebuild a clean
-- series. It did not. The v0.15.4.0 fix relied on ccxt's safe_trade
-- populating cost = amount × price × contractSize, which only fires when
-- the market resolved inside safe_market carries a non-None contractSize.
-- On production that path silently failed and cost = amount × price
-- collapsed to cost/price = amount = raw CONTRACT COUNT. An OKX ETH
-- perpetual position of 21.464 ETH came back in at 214.64 (ctVal=0.1) and
-- every ETH price tick marked the position 10x too hard. Demo allocator
-- snapshots on 2026-04-24 01:28 — rebuilt AFTER migration 078 ran —
-- landed at -$18,447 on an account whose true equity was ~$195,493 (the
-- dashboard rendered this as -1510%).
--
-- v0.15.4.2 fix in equity_reconstruction.py:
--   1. Explicit OKX_PERP_CONTRACT_SIZE table (ETH/USDT:USDT=0.1,
--      BTC/USDT:USDT=0.01, etc.). _resolve_perp_amt_base prefers
--      cost/price when it agrees with the table; when they diverge by
--      >5% (the production bug signature) falls back to amount × ctVal.
--      The override is gated on info.instType == "SWAP" so synthetic
--      test fixtures without the stamp stay on the legacy path.
--   2. _fetch_current_equity anchors the reconstructed series to the
--      exchange's own total-equity number. Pure trade-replay from
--      genesis cannot recover USDT margin that pre-dates the OKX 90-day
--      trade cut-off; the curve starts near zero and drifts negative.
--      The anchor computes offset = today_exchange_equity -
--      last_replay_row.value_usd and applies it uniformly so the right-
--      hand edge of the curve matches the exchange's own number.
--      Historical day-to-day deltas are preserved. A STARTING_BALANCE
--      key is stamped into each breakdown so components still sum to
--      value_usd.
--
-- HEALING (this migration): every row currently in
-- allocator_equity_snapshots was produced by v0.15.3.x or v0.15.4.0
-- code, either of which carries at least one of the two bugs above.
-- Purge the whole table and re-enqueue reconstruction under v0.15.4.2.
-- Migration 078 shape repeated verbatim because the remediation is
-- identical; the code path it triggers has changed.
--
-- SAFETY:
--   - allocator_equity_snapshots is purely derived state. Recomputable
--     from trades + deposits + withdrawals + OHLCV + today's
--     fetch_balance/fetch_positions.
--   - compute_jobs reconstruct-done rows are only consumed by
--     _api_key_already_reconstructed. Losing them triggers a fresh
--     reconstruct on the next worker claim cycle.
--   - Scope (2026-04-24 18:00 UTC): 3 allocators, 14 snapshot rows per
--     allocator, single-digit compute_jobs rows. Within seconds under
--     lock_timeout.
-- ===========================================================================

BEGIN;

SET lock_timeout = '10s';

-- STEP 1: purge every allocator_equity_snapshots row. All produced by
-- pre-v0.15.4.2 code, either the v0.15.3.x replay without any contract-
-- size handling OR the v0.15.4.0 cost/price path that silently degraded
-- to contract counts when safe_trade couldn't resolve contractSize.
DELETE FROM public.allocator_equity_snapshots;

-- STEP 2: drop the per-api_key reconstruct idempotency gate for `done`
-- rows only. The partial unique index on (api_key_id) WHERE status IN
-- ('pending','running') is NOT touched, so in-flight jobs remain safe.
DELETE FROM public.compute_jobs
WHERE kind = 'reconstruct_allocator_history'
  AND status = 'done';

-- STEP 3: enqueue a fresh reconstruct job for every connected, active
-- api_key. The NOT EXISTS guard handles the (rare) race where a
-- reconstruct gets enqueued between STEP 2 and STEP 3; the partial
-- unique index compute_jobs_one_inflight_reconstruct_per_api_key
-- (migration 076) also backstops this, but the explicit guard produces
-- a clearer conflict message than a raw 23505.
INSERT INTO public.compute_jobs (kind, api_key_id, exchange)
SELECT 'reconstruct_allocator_history', k.id, k.exchange
FROM public.api_keys k
WHERE k.disconnected_at IS NULL
  AND k.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM public.compute_jobs cj
    WHERE cj.api_key_id = k.id
      AND cj.kind = 'reconstruct_allocator_history'
      AND cj.status IN ('pending', 'running')
  );

COMMIT;

-- Post-deploy: the worker loop (analytics-service/services/job_worker.py)
-- claims pending compute_jobs every 30s. Each reconstruct pulls fresh
-- trades/deposits/withdrawals/OHLCV from ccxt + a today-anchor from
-- fetch_balance/fetch_positions and writes a clean series under
-- v0.15.4.2 rules. Allocators see the corrected curve on the next
-- dashboard load after the first claim cycle.
