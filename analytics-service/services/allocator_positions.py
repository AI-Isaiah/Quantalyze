"""Allocator-side holdings ingestion (Phase 06, INGEST-03 / INGEST-04 / INGEST-05).

Dual-path CCXT fetch: fetch_balance() for spot + fetch_positions() for derivatives
(D-01). Idempotent upsert into allocator_holdings via (allocator_id, venue, symbol,
asof) unique index (INGEST-04).

Key design decisions (from plan 06-02 + VOICES-ACCEPTED.md):

* Spot-only pricing: we make ONE bulk fetch_tickers() call with the list of
  non-stablecoin assets. Stablecoins (USDT/USDC/BUSD/DAI/TUSD/USD) skip the
  ticker entirely with mark_price = 1.0 — lower API cost, no rate-limit bleed
  onto the strategy-side poll_positions for shared exchanges (RESEARCH §1).

* Derivative rows reuse services.positions.fetch_positions — the same shape
  the strategy-side worker produces — so the two pipelines stay aligned.

* Deribit spot is deferred, derivatives render (Phase 71 / DRB-09). Deribit is
  a derivatives-first venue; fetch_balance() on a derivatives-only account
  returns {'total': {}} which would silently emit zero spot rows. So for
  Deribit the spot side returns [] (deferred — no spot path) WITHOUT erroring,
  and the derivative side syncs normally so the allocator sees their Deribit
  positions. (Phase 71 lifted the former f3 Path-B DeribitNotSupportedError,
  which raised before fetch_balance and failed the whole sync — hiding the
  derivatives too.) Deribit spot ingestion (Path A) stays deferred.

* raw_payload cap — JSONB rows in allocator_holdings are capped at ~4KB
  via json.dumps length check; over-cap payloads are replaced with a
  truncated preview so the table stays indexable and a runaway CCXT
  response (huge `info` blob) can't blow up row size.

* Exception → sync_status mapping lives HERE (not in job_worker.py) so the
  handler's error-UX logic is co-located with the worker concern it serves
  and can be unit-tested without importing the whole job_worker stack.
"""
from __future__ import annotations

import json
from typing import Any

import ccxt.async_support as ccxt
from supabase import Client

from services.closed_sets import STABLECOINS
from services.db import db_execute
from services.positions import fetch_positions


# B8b: STABLECOINS (the "treat as cash, mark at $1, skip the ticker fetch" set)
# is single-sourced from services.closed_sets so it can't fork from the equity-
# reconstruction copy. This unifies on the canonical set, which additionally
# treats FDUSD as cash here (the local copy historically omitted it) — FDUSD is
# a $1-pegged stablecoin, so marking it at 1.0 is strictly more correct than
# fetching an FDUSD/USDT ticker.
RAW_PAYLOAD_CAP_BYTES: int = 4096  # D-02 / ~4KB JSONB cap


def _extract_bybit_unified_walletbalances(info: dict[str, Any]) -> dict[str, float]:
    """Extract per-coin `walletBalance` from a Bybit V5 unified-account
    `info` payload.

    Bybit Unified Trading Account (UTA) quirk: when an allocator has
    funds locked as derivative collateral, the raw V5 response sets
    `availableToWithdraw: ""` (empty string) on each coin. CCXT's
    `parseBalance` for Bybit can map that empty string to 0 in the
    parsed `total` / `free` dicts — so a user with a $200k USDT margin
    backing their Bybit perp positions sees a zero spot balance after
    CCXT parsing, which silently drops their Bybit collateral from the
    Holdings panel even though the unified account is fully funded.

    The raw V5 payload at
    `info["result"]["list"][N]["coin"][*]["walletBalance"]` is the
    truthful number we want — it's the asset balance the allocator
    actually holds, before unrealised PnL. We extract it directly and
    let the existing pricing path (stablecoin shortcut + fetch_tickers
    for non-stables) value it.

    Returns `{}` on any parse failure (missing keys, non-iterable
    payload, unparseable floats) so the caller can fall through to
    CCXT's parsed `total` dict without crashing the whole sync.
    """
    try:
        accounts = info.get("result", {}).get("list", []) or []
        if not accounts:
            return {}
        # Prefer the UNIFIED account row when multiple are present
        # (sub-account API keys can surface CONTRACT / FUND rows too).
        unified = next(
            (row for row in accounts if row.get("accountType") == "UNIFIED"),
            accounts[0],
        )
        out: dict[str, float] = {}
        for c in unified.get("coin", []) or []:
            symbol = c.get("coin")
            raw_wb = c.get("walletBalance")
            if not symbol or raw_wb in (None, ""):
                continue
            try:
                qty = float(raw_wb)
            except (TypeError, ValueError):
                continue
            if qty > 0:
                out[symbol] = qty
        return out
    except Exception:  # noqa: BLE001
        return {}


def _cap_raw_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Truncate a raw_payload JSON dict to fit the ~4KB JSONB cap.

    If the serialized payload exceeds RAW_PAYLOAD_CAP_BYTES, return a
    replacement dict {'truncated': True, 'preview': str[:3900]} so the
    row still persists and the operator can see the first ~4KB of the
    original in the admin UI. default=str handles Decimal/datetime.
    """
    encoded = json.dumps(payload, default=str)
    if len(encoded) <= RAW_PAYLOAD_CAP_BYTES:
        return payload
    return {"truncated": True, "preview": encoded[:3900]}


def _map_exception_to_sync_status(exc: Exception) -> str:
    """INGEST-05 / D-07: map a CCXT exception to the api_keys.sync_status value.

    Table:
      AuthenticationError / PermissionDenied  → 'revoked'
      RateLimitExceeded                       → 'rate_limited'
      everything else (Network, ExchangeNotAvailable,
        generic Exception, ...)               → 'error'
    """
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"


async def _fetch_spot_rows(exchange_name: str, exchange: Any) -> list[dict[str, Any]]:
    """Build spot allocator_holdings rows from fetch_balance() + bulk fetch_tickers().

    Deribit: spot is deferred (Phase 71). Return [] BEFORE any network call —
    the Unified CCXT shape for Deribit derivatives-only accounts returns
    {'total': {}}, which would silently emit zero spot rows, and Deribit spot
    ingestion (Path A) is out of scope. The derivative side still syncs, so the
    allocator sees their Deribit positions.

    Stablecoin optimization: USDT/USDC/BUSD/DAI/TUSD/USD get mark_price=1.0
    without a ticker call.
    """
    # Deribit — spot deferred (no spot path). Skip gracefully; derivatives sync.
    if getattr(exchange, "id", None) == "deribit":
        return []

    balance = await exchange.fetch_balance()
    totals = balance.get("total") or {}

    # Bybit Unified Trading Account fallback (2026-05-20): for UTA users
    # whose funds are locked as derivative collateral, CCXT's parsed
    # `total` dict can be empty/zero because the V5 payload sets
    # `availableToWithdraw: ""`. Read the raw `walletBalance` per coin
    # from `info` and merge it OVER CCXT's parsed totals so the actual
    # collateral surfaces as a spot holding. Without this, an allocator
    # with $200k USDT backing their Bybit perp positions sees zero
    # Bybit spot rows in the Holdings panel even though the unified
    # account is fully funded.
    if getattr(exchange, "id", None) == "bybit":
        raw_wbs = _extract_bybit_unified_walletbalances(balance.get("info") or {})
        if raw_wbs:
            # Merge: raw walletBalance wins when CCXT's parsed total is
            # 0 / missing, but never drops a non-zero CCXT total (defensive
            # against shape drift in either direction).
            merged = dict(totals)
            for asset, qty in raw_wbs.items():
                existing = merged.get(asset)
                if existing is None or float(existing or 0) <= 0:
                    merged[asset] = qty
            totals = merged

    non_zero = {
        asset: float(qty)
        for asset, qty in totals.items()
        if qty is not None and float(qty) > 0
    }
    if not non_zero:
        return []

    # Bulk ticker fetch for non-stablecoin assets only.
    need_tickers = [
        f"{asset}/USDT" for asset in non_zero
        if asset.upper() not in STABLECOINS
    ]
    tickers: dict[str, dict[str, Any]] = {}
    if need_tickers:
        try:
            tickers = await exchange.fetch_tickers(need_tickers) or {}
        except Exception:
            # Per-symbol fallback if bulk fails (some exchanges don't
            # accept a symbol list). Best effort — if a single ticker
            # still fails, we mark the price 0 rather than abort spot.
            tickers = {}
            for sym in need_tickers:
                try:
                    tickers[sym] = await exchange.fetch_ticker(sym)
                except Exception:
                    tickers[sym] = {"last": 0.0}

    rows: list[dict[str, Any]] = []
    for asset, qty in non_zero.items():
        asset_upper = asset.upper()
        if asset_upper in STABLECOINS:
            mark_price = 1.0
        else:
            t = tickers.get(f"{asset}/USDT") or {}
            mark_price = float(t.get("last") or 0.0)
        rows.append({
            "venue": exchange_name,
            "symbol": asset,              # D-16: raw currency code, no suffix
            "holding_type": "spot",
            "side": "flat",
            "quantity": float(qty),
            "value_usd": float(qty) * mark_price,
            "entry_price": None,           # D-06: spot has no basis from the worker
            "mark_price": mark_price,
            "unrealized_pnl_usd": None,
            "cost_basis_usd": None,
            "raw_payload": _cap_raw_payload({
                "asset": asset,
                "total": float(qty),
                "mark_price": mark_price,
            }),
        })
    return rows


async def _fetch_derivative_rows(exchange_name: str, exchange: Any) -> list[dict[str, Any]]:
    """Build derivative allocator_holdings rows by reusing positions.fetch_positions.

    Remaps the strategy-side snapshot shape to the allocator_holdings
    column list (D-01 / D-05). Deribit derivative path IS supported (Phase 71,
    inverse contracts normalized in positions._normalize_deribit_position);
    only the spot side is deferred.
    """
    snapshots = await fetch_positions(exchange_name, exchange)
    rows: list[dict[str, Any]] = []
    for s in snapshots:
        qty = float(s.get("size_base") or 0)
        entry_raw = s.get("entry_price")
        entry = float(entry_raw) if entry_raw is not None else None
        if entry == 0:
            entry = None
        cost_basis = (entry * abs(qty)) if entry is not None else None
        rows.append({
            "venue": exchange_name,
            "symbol": s["symbol"],          # already stripped by _normalize_ccxt_position (D-16)
            "holding_type": "derivative",
            "side": s["side"],
            "quantity": qty,
            "value_usd": float(s.get("size_usd") or 0),
            "entry_price": entry,
            "mark_price": float(s.get("mark_price") or 0),
            "unrealized_pnl_usd": float(s.get("unrealized_pnl") or 0),
            "cost_basis_usd": cost_basis,
            "raw_payload": _cap_raw_payload(s),
        })
    return rows


async def fetch_allocator_holdings(
    exchange_name: str, exchange: Any
) -> tuple[list[dict[str, Any]], str | None]:
    """D-01: fetch BOTH spot and derivatives in a single sync.

    Returns ``(rows, warning)`` where ``warning`` is None on full success
    and a sanitized string when the derivative side failed with a
    non-auth / non-rate-limit exception but spot succeeded (partial
    success → the handler writes sync_status='complete_with_warnings').

    On auth / rate-limit failures the method re-raises so the handler can map
    to sync_status ('revoked' / 'rate_limited' / 'error') per D-07. Deribit
    completes normally: spot returns [] (deferred) and derivatives render
    (Phase 71).
    """
    spot_rows: list[dict[str, Any]] = []
    deriv_rows: list[dict[str, Any]] = []
    warning: str | None = None

    # Spot side — any failure (including Deribit Path B) re-raises to
    # the handler; partial success only applies to the derivative side.
    spot_rows = await _fetch_spot_rows(exchange_name, exchange)

    try:
        deriv_rows = await _fetch_derivative_rows(exchange_name, exchange)
    except (
        ccxt.AuthenticationError,
        ccxt.PermissionDenied,
        ccxt.RateLimitExceeded,
    ):
        raise
    except Exception as exc:  # noqa: BLE001
        # Partial success: persist spot, surface the derivative-side error
        # as sync_status='complete_with_warnings' via the handler.
        warning = str(exc)[:500]

    return (spot_rows + deriv_rows, warning)


async def persist_allocator_holdings(
    supabase_client: Client,
    holdings: list[dict[str, Any]],
    allocator_id: str,
    api_key_id: str,
    asof_date: str,
) -> int:
    """INGEST-04: idempotent upsert on (allocator_id, venue, symbol, asof).

    Stamps allocator_id / api_key_id / asof onto every row before the
    upsert so a caller can pass either the raw fetch_allocator_holdings
    output or a pre-stamped list. Re-running with identical input
    produces identical rows because the DB unique index + ON CONFLICT
    DO UPDATE converges.
    """
    if not holdings:
        return 0

    rows = [
        {
            **h,
            "allocator_id": allocator_id,
            "api_key_id": api_key_id,
            "asof": asof_date,
        }
        for h in holdings
    ]

    def _upsert() -> None:
        supabase_client.table("allocator_holdings").upsert(
            rows,
            on_conflict="allocator_id,venue,symbol,asof",
        ).execute()

    await db_execute(_upsert)
    return len(rows)
