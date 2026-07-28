# Phase 06: Allocator API Ingestion - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 06-allocator-api-ingestion
**Areas discussed:** Coverage, Schema, Error UX, Cron, First-run UX, Cost basis

---

## Coverage (CCXT surface)

| Option | Description | Selected |
|--------|-------------|----------|
| Spot balance + derivatives (Recommended) | Call BOTH `fetch_balance()` (spot) and `fetch_positions()` (futures/perps) per key, then UNION into `allocator_holdings` as one normalized row stream. Distinguish via a `holding_type` column. Captures USDT cash + spot tokens + open futures positions — the realistic institutional crypto portfolio shape. Cost: two API calls per sync, slightly more normalization. | ✓ |
| Derivatives only (`fetch_positions`) | Only poll open positions. Simplest path — reuses existing `services/positions.py` verbatim. But misses spot tokens (BTC/ETH held outright) and stablecoin cash, which is most of an institutional crypto allocator's actual portfolio. The dashboard would show "empty" for an LP whose entire book is spot. | |
| Spot balance only (`fetch_balance`) | Only poll account balances. Captures cash + spot tokens (the bulk of most allocator books). But misses futures/perp positions entirely — and that's where strategy-level alpha tends to live for crypto allocators. Bridge later wouldn't see leveraged exposure. | |

**User's choice:** Spot balance + derivatives (Recommended)
**Notes:** Drives D-01. Worker calls both CCXT methods per sync; one normalized row stream into `allocator_holdings`; `holding_type` discriminator.

---

## Schema (`allocator_holdings`)

| Option | Description | Selected |
|--------|-------------|----------|
| Standard parity with `position_snapshots` + `cost_basis NULL` (Recommended) | Identity tuple + `api_key_id` FK + `holding_type` + `side` + `quantity` + `value_usd` + `entry_price` (NULL for spot) + `mark_price` + `unrealized_pnl_usd` + `cost_basis_usd` NULLABLE + `raw_payload` JSONB. Mirrors `position_snapshots` so Phase 09 Bridge integration can reuse query patterns. | ✓ |
| Minimal — identity + size + value_usd only | Just allocator_id, api_key_id, venue, symbol, asof, quantity, value_usd. Tiny migration; Bridge in Phase 9 has less signal. Risks needing a follow-up ALTER. | |
| Full + `weight_pct` denormalized | Standard parity PLUS computed `weight_pct`. Saves a runtime SUM but introduces partial-upsert inconsistency window. | |

**User's choice:** Standard parity with `position_snapshots` + `cost_basis NULL` (Recommended)
**Notes:** Drives D-02. `cost_basis_usd` stays NULL for spot (no exchange-reported basis); D-06 governs the derivative-side populate.

---

## Error UX (`api_keys.sync_status` surfacing)

| Option | Description | Selected |
|--------|-------------|----------|
| Extend enum + inline status pill + `sync_error` text (Recommended) | Extend the `sync_status` CHECK to add `revoked` + `rate_limited`. Per-row inline pill (color-coded) + `sync_error` text rendered as 12px muted helper line beneath the pill (mirrors `MandateSaveStatus` aria-live pattern from Phase 2). No toast lib. | ✓ |
| Single `error` status + structured `sync_error` JSONB | Don't extend the enum. Reuse `error` value and put structured `{kind, message}` in a new JSONB column. More flexible; loses SQL-level distinguishability. | |
| Toast on first sight + persistent banner | One-shot toast + persistent yellow banner. Introduces a new toast dependency (currently zero in v0.14). | |

**User's choice:** Extend enum + inline status pill + `sync_error` text (Recommended)
**Notes:** Drives D-07 + D-08. Pill copy table is locked in CONTEXT.md.

---

## Cron orchestration

| Option | Description | Selected |
|--------|-------------|----------|
| pg_cron + new RPC, daily 04:00 UTC, 0–600s jitter (Recommended) | Mirror `enqueue_poll_positions_for_all_strategies` pattern: new SECURITY DEFINER RPC, scans `api_keys WHERE is_active AND sync_status NOT IN ('revoked','error')` (revised in CONTEXT.md to retry `error`), enqueues with random jitter. Daily cadence matches Sprint 9 acceptance gate. | ✓ |
| Hourly cron, no jitter, idempotent dedup via in-flight unique index | Run hourly. ~24× the API-call volume. | |
| Vercel Cron route → FastAPI internal endpoint, daily | Add Vercel cron entry. Hits Hobby-plan 2-cron cap (already used). Forces Pro upgrade or moving an existing cron. | |

**User's choice:** pg_cron + new RPC, daily 04:00 UTC, 0–600s jitter (Recommended)
**Notes:** Drives D-12 + D-13. Off-peak time chosen to not collide with `warm-analytics` (00:00) / `alert-digest` (09:00) Vercel crons. Stays inside Postgres so it bypasses the Hobby-plan 2-Vercel-cron cap.

---

## First-run UX

| Option | Description | Selected |
|--------|-------------|----------|
| Inline `syncing` pill + button disabled while in-flight (Recommended) | On key-add: server enqueues a `poll_allocator_positions` job, sets `sync_status='syncing'`, returns the inserted row immediately. Allocator sees `Syncing…` pill. Worker writes holdings + flips status. For "Sync now": same flow + button disabled while syncing. Page does NOT block. Status polled via `router.refresh()` every 5s. No background promise dropping. | ✓ |
| Block the page until first-run completes (with timeout) | Key-add response holds open until first poll completes or 60s timeout. Burns a Vercel function-instance and breaks the existing `withAuth` route shape. | |
| Optimistic empty state → Realtime push update | `supabase.channel().on('postgres_changes', …)`. Cleaner UX but introduces a new realtime pattern not used anywhere else in v0.15. | |

**User's choice:** Inline `syncing` pill + button disabled while in-flight (Recommended)
**Notes:** Drives D-09 + D-10 + D-11. Polling chosen over realtime to avoid introducing a new pattern in v0.15; can be swapped in Phase 11 polish if poll cost shows up.

---

## Cost basis

| Option | Description | Selected |
|--------|-------------|----------|
| Worker writes `cost_basis_usd = entry_price × abs(quantity)` for derivatives; spot stays NULL (Recommended) | In the new `services/allocator_positions.py`, the normalizer computes cost basis for any derivative row with a non-null `entry_price`. Spot rows keep `cost_basis_usd` NULL — Phase 8 manual override or future trades-derived will populate. Bridge in Phase 9 gates spot-row P&L on `cost_basis_usd IS NOT NULL`. | ✓ |
| Always NULL in Phase 06; defer to Phase 08 | Cleaner phase boundary. Bridge in Phase 9 has nothing to anchor P&L against — pushes scope into Phase 9. | |
| Reuse `sync_trades` pipeline alongside positions poll | Most accurate (both spot + derivatives) but pulls 90-day raw fill ingestion (15-min timeout, USE_RAW_TRADE_INGESTION flag) into Phase 06 — doubles scope. | |

**User's choice:** Worker writes `cost_basis_usd = entry_price × abs(quantity)` for derivatives; spot stays NULL (Recommended)
**Notes:** Drives D-06. Spot cost basis explicitly deferred to Phase 8; Phase 9 planner must gate spot-row P&L on `cost_basis_usd IS NOT NULL`.

---

## Wrap-up gate

| Option | Description | Selected |
|--------|-------------|----------|
| Write CONTEXT.md | Lock the six decisions and proceed. Remaining implementation choices (worker handler file shape, RLS test framework, exact endpoint paths) are planner discretion. | ✓ |
| Explore more gray areas | Surface 2–3 more decisions (worker file shape, revoke semantics overlap with Phase 08, exchange coverage scope, symbol normalization). | |

**User's choice:** Write CONTEXT.md

---

## Claude's Discretion

Captured in CONTEXT.md `### Claude's Discretion` subsection:
- Exact CCXT call shape for spot pricing (`fetch_tickers` bulk vs `fetch_ticker` per-asset)
- Worker internal helper layout inside `services/allocator_positions.py`
- New route path (likely `src/app/api/allocator/holdings/sync/route.ts`)
- Vitest harness file location for the application-layer RLS spec
- `raw_payload` JSONB column max size cap (~4KB suggested)
- Spinner glyph / animation for the `syncing` pill
- Mark-price source for spot `value_usd` (direct ticker vs Phase 07 price oracle if it lands first)
- Whether `complete_with_warnings` is exercised in v0.15 or left forward-compatible-only

## Deferred Ideas

Captured in CONTEXT.md `<deferred>` block:
- `/connections` rework + revoke/delete UX → Phase 08
- Spot cost-basis backfill → Phase 08 / future trades-derived
- Worker file shape merge debate (resurface during planning if planner sees strong reason)
- `api_keys.is_active` revoke semantics → Phase 08
- Symbol normalization edge cases (perpetual-vs-quarterly Deribit etc.)
- Vercel-cron path for alloc syncs → re-evaluate post-Pro-plan upgrade
- Realtime push for sync_status → re-evaluate in Phase 11 polish
- `weight_pct` denormalized on `allocator_holdings` → explicitly rejected
