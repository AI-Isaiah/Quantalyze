-- ===========================================================================
-- Migration 078: purge pre-v0.15.4.0 equity snapshots + reset per-key
--                reconstruct idempotency gates so fixed code re-runs.
-- ===========================================================================
-- BUG: v0.15.3.0 introduced perpetual-replay with position tracking, but
-- the replay treated ccxt's trade['amount'] as base units. CCXT's
-- safe_trade (base/exchange.py:4412) never multiplies amount by
-- contractSize, so OKX perps (ctVal=0.01 ETH for ETH-USDT-SWAP) land in
-- the replay at 100x the real position size. A 21.464 ETH short on OKX
-- got tracked as size=2146.4 and every $1 ETH move marked the position
-- 100x too hard. Demo allocator's 2026-04-12 snapshot landed at
-- value_usd=-$152,771 on a fully-collateralised account — the V-shaped
-- curve the user kept reporting. The reconstruct-upsert + per-key
-- idempotency gate (migration 076) then locked those broken rows in
-- place forever, because re-syncing the same api_key short-circuits
-- through _api_key_already_reconstructed without re-running the fix.
--
-- The v0.15.3.2 / v0.15.3.3 / v0.15.3.4 fixes were all chasing a
-- downstream symptom ("stale rows block fresh reconstruct") rather
-- than the computation bug. They didn't change the replay math, so
-- any snapshots produced by the v0.15.3.x line are just as broken as
-- the v0.15.3.0 originals.
--
-- FIX (code-side, shipped with this migration in v0.15.4.0):
--   - equity_reconstruction.py:608 perp branch derives base-unit size
--     from cost/price (cost is in quote units = amount × price × ctVal,
--     so cost/price recovers base units independent of contractSize).
--   - equity_reconstruction.py:1247 refresh loop uses unrealized_pnl_usd
--     for holding_type='derivative' instead of value_usd (which stores
--     notional and on unified-margin venues like OKX double-counts the
--     USDT margin that already sits in the spot row).
--
-- HEALING (this migration): every snapshot row this system has ever
-- written was produced by broken code (v0.15.3.0 was the first version
-- to persist allocator_equity_snapshots at all). They're not
-- recoverable, so delete them wholesale and let the worker rebuild
-- from scratch under v0.15.4.0.
--
-- Per-api_key idempotency rows (compute_jobs where kind =
-- 'reconstruct_allocator_history' AND status = 'done') MUST also be
-- reset — migration 076's _api_key_already_reconstructed check would
-- otherwise short-circuit the next dispatch and leave allocators
-- permanently pinned to the broken series.
--
-- SAFETY:
--   - allocator_equity_snapshots is purely derived state. Recomputable
--     from trades + deposits + withdrawals + OHLCV, all of which live
--     upstream (exchange APIs + token_price_history).
--   - compute_jobs reconstruct-done rows are only consumed by
--     _api_key_already_reconstructed. Losing them triggers a fresh
--     reconstruct on next cron tick, which is exactly what we want.
--   - Scope: 3 allocators, ~13 snapshot rows, single-digit compute_jobs
--     rows (as of 2026-04-24). Within seconds under lock_timeout.
-- ===========================================================================

BEGIN;

SET lock_timeout = '10s';

-- STEP 1: purge every allocator_equity_snapshots row. All of these were
-- produced by pre-v0.15.4.0 reconstruct or refresh code, either of which
-- carries one of the two bugs described above. Re-running under fixed
-- code reconstructs the full series deterministically.
DELETE FROM public.allocator_equity_snapshots;

-- STEP 2: drop the per-api_key idempotency gate for reconstruct. The
-- partial unique index on (api_key_id) WHERE status IN ('pending',
-- 'running') is NOT touched — no in-flight jobs get clobbered. Only
-- `done` rows are removed so the next enqueue goes through.
DELETE FROM public.compute_jobs
WHERE kind = 'reconstruct_allocator_history'
  AND status = 'done';

-- STEP 3: enqueue a fresh reconstruct job for every connected api_key
-- whose allocator had snapshots wiped. The scheduled cron would also
-- pick these up on its next tick, but an immediate enqueue means
-- affected users see the fix land within the next compute_jobs claim
-- cycle (currently 30s), not when the daily cron fires.
--
-- Filter api_keys to connected rows only (migration 075: disconnected_at
-- IS NOT NULL keys skipped by enqueue_poll_allocator_positions_for_all_keys
-- and enqueue_refresh_allocator_equity_for_all for the same reason — the
-- worker would refuse to sync them anyway).
INSERT INTO public.compute_jobs (kind, api_key_id, exchange)
SELECT 'reconstruct_allocator_history', k.id, k.exchange
FROM public.api_keys k
WHERE k.disconnected_at IS NULL
  AND k.is_active = true
  -- Guard against the (rare) race where a reconstruct was enqueued
  -- between STEP 2 and STEP 3. The partial unique index
  -- compute_jobs_one_inflight_reconstruct_per_api_key (migration 076)
  -- already enforces this, but an explicit NOT EXISTS gives a clearer
  -- conflict-on-insert message than a 23505 if it ever fires.
  AND NOT EXISTS (
    SELECT 1 FROM public.compute_jobs cj
    WHERE cj.api_key_id = k.id
      AND cj.kind = 'reconstruct_allocator_history'
      AND cj.status IN ('pending', 'running')
  );

COMMIT;

-- Post-deploy: the worker loop (analytics-service/services/job_worker.py)
-- claims pending compute_jobs via claim_compute_jobs every 30s. Each
-- reconstruct pulls fresh trades/deposits/withdrawals from ccxt and
-- writes a clean series under v0.15.4.0 rules. Allocators will see the
-- corrected curve on next dashboard load after the first claim cycle.
