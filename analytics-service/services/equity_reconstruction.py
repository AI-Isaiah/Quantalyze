"""Phase 07 historical equity reconstruction (D-01 / D-02).

Two job kinds (both KEY-SCOPED per VOICES-ACCEPTED f1):
  reconstruct_allocator_history — full backfill on first key connect.
  refresh_allocator_equity_daily — incremental one-day delta via cron, per-key.

Aggregation across an allocator's multiple keys happens at the UPSERT layer
via ON CONFLICT (allocator_id, asof) DO NOTHING — the first key to land for
a given (allocator, asof) wins; subsequent keys are benign no-ops (threat
T-07-V5b mitigation + f1 aggregate-at-UPSERT design).

Primary sources via ccxt: fetch_my_trades, fetch_deposits, fetch_withdrawals,
fetch_ohlcv. Fallback: CoinGecko free tier (30 req/min) cached in
token_price_history on (symbol, asof).

Per-venue history_depth_months (VOICES-ACCEPTED f9) is written into each
snapshot row so getMyAllocationDashboard can surface venue-specific warm-up
copy (e.g. "Only 3 months of history available on OKX").
"""
from __future__ import annotations

import asyncio
import json
import logging
from bisect import bisect_right
from datetime import date, datetime, timedelta, timezone
from typing import Any

import ccxt.async_support as ccxt
import httpx
import pandas as pd

from services.db import db_execute, get_supabase
from services.job_worker import (
    DispatchOutcome,
    DispatchResult,
    _allocator_key_preflight,
    _emit_audit,
    _stamp_429,
    classify_exception,
)

logger = logging.getLogger("quantalyze.analytics.equity_reconstruction")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STABLECOINS: set[str] = {"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"}
RAW_PAYLOAD_CAP_BYTES: int = 4096
OKX_TRADE_TERMINUS_DAYS: int = 90          # documented OKX cap (RESEARCH.md §1B, A3)
BACKFILL_CAP_DAYS: int = 730                # 2 years (RESEARCH.md §1E recommended cap)
COINGECKO_BASE: str = "https://api.coingecko.com/api/v3"
COINGECKO_MIN_SLEEP_SECS: float = 2.0       # stay below 30 RPM free tier

# OKX's /api/v5/trade/fills-history endpoint is partitioned by instType
# (SPOT, MARGIN, SWAP, FUTURES, OPTION). A vanilla fetch_my_trades(None)
# call only returns one type at a time — defaulting to SPOT — and silently
# drops every fill on the other four. Accounts that primarily trade
# perpetual swaps (the common case for crypto allocators) appeared to have
# zero history under the old single-pass call, which collapsed equity
# reconstruction to days_written=0. Fan-out across all five types is the
# only way to assemble the full trade book for an OKX account.
OKX_INSTRUMENT_TYPES: tuple[str, ...] = (
    "SPOT", "MARGIN", "SWAP", "FUTURES", "OPTION",
)

# Per VOICES-ACCEPTED f9: per-venue retained-history caps (months) written
# into snapshot rows. Drives venue-specific KpiStrip warm-up copy in 07-03.
VENUE_HISTORY_DEPTH_MONTHS: dict[str, int] = {
    "binance": 24,
    "okx": 3,      # Conservative: trades cap (3mo) is the binding constraint
    "bybit": 24,
}

# Common coingecko ID overrides. Phase 07 MVP uses symbol.lower() for any
# symbol not in this map; manual QA (f9/f4) catches mispricings.
COINGECKO_ID_OVERRIDES: dict[str, str] = {
    "BTC": "bitcoin",
    "ETH": "ethereum",
    "SOL": "solana",
    "USDT": "tether",
    "USDC": "usd-coin",
    "DAI": "dai",
    "BNB": "binancecoin",
    "XRP": "ripple",
    "ADA": "cardano",
    "DOGE": "dogecoin",
    "MATIC": "matic-network",
    "AVAX": "avalanche-2",
    "LINK": "chainlink",
    "DOT": "polkadot",
    "ATOM": "cosmos",
}

# /investigate 2026-04-24 (v0.15.4.2) — defensive contract-size table for
# OKX linear perpetuals. The v0.15.4.0 fix relied on ccxt's safe_trade
# populating `cost = amount × price × contractSize`. In practice that
# contract-aware multiplication happens ONLY when ccxt's okx.parse_trade
# sets cost=None (it does) AND the market object resolved inside
# safe_market carries a non-None contractSize. The latter depends on
# which ccxt version, which markets were pre-loaded, and which instType
# branch the fills-history endpoint returned — none of which we can
# assert at the replay layer. When contractSize is missing from the
# resolved market, safe_trade falls through with `cost = amount × price`
# (no multiplier) and `amt_base = cost / price = amount` — contracts,
# not base units. The 10x-100x position-size inflation returns under
# a fresh disguise.
#
# The defensive fix: resolve base units from an explicit per-symbol
# ctVal table when we recognise the perp. This is independent of ccxt's
# cost field and survives every flavour of the safe_trade path. When
# both `cost/price` and the explicit table agree (within 5%), we keep
# using cost/price so fixtures with contractSize=1 stay unaffected.
# When they diverge, we trust the table.
#
# ctVal values cross-checked against OKX's public `/api/v5/public/
# instruments?instType=SWAP` on 2026-04-24.
OKX_PERP_CONTRACT_SIZE: dict[str, float] = {
    "BTC/USDT:USDT": 0.01,
    "ETH/USDT:USDT": 0.1,
    "SOL/USDT:USDT": 1.0,
    "BNB/USDT:USDT": 0.01,
    "XRP/USDT:USDT": 100.0,
    "ADA/USDT:USDT": 100.0,
    "DOGE/USDT:USDT": 1000.0,
    "LINK/USDT:USDT": 1.0,
    "DOT/USDT:USDT": 1.0,
    "MATIC/USDT:USDT": 10.0,
    "AVAX/USDT:USDT": 1.0,
    "LTC/USDT:USDT": 1.0,
    "ATOM/USDT:USDT": 1.0,
    "SUI/USDT:USDT": 1.0,
}


def _resolve_perp_amt_base(
    raw_symbol: str, amount: float, price: float, cost: float,
    inst_type: str | None = None,
) -> float:
    """Recover base-unit trade size for a linear perp.

    Prefers `cost / price` when cost is trustworthy (i.e. ccxt's
    safe_trade did apply contractSize). Falls back to the explicit
    OKX_PERP_CONTRACT_SIZE table whenever the two disagree by more
    than 5% — that's the signal safe_trade didn't have a market with
    contractSize available and returned `cost = amount × price`, which
    would silently leak contract counts into the replay state.

    The defensive override only fires when the trade carries the real
    OKX `info.instType = "SWAP"` stamp. Synthetic test fixtures that
    treat amount as base units (implicit contractSize = 1) never carry
    that stamp, so they keep the legacy behaviour and aren't bitten by
    the symbol collision with the ctVal table.

    Backward-compatible for fixtures that pass cost = amount × price
    (contractSize = 1 implicit): cost/price == amount, inst_type is
    None, we return amount.
    """
    if price <= 0:
        return amount  # caller already skips this path
    amt_from_cost = (cost / price) if cost > 0 else amount
    # Only apply the defensive override for REAL OKX SWAP fills. Synthetic
    # fixtures without info.instType stay on the legacy cost/price path.
    if not inst_type or str(inst_type).upper() != "SWAP":
        return amt_from_cost
    ctval = OKX_PERP_CONTRACT_SIZE.get(raw_symbol)
    if ctval is None:
        return amt_from_cost
    amt_explicit = amount * ctval
    if amt_explicit <= 0:
        return amt_from_cost
    relative_err = abs(amt_from_cost - amt_explicit) / amt_explicit
    if relative_err > 0.05:
        return amt_explicit
    return amt_from_cost


# ---------------------------------------------------------------------------
# Exception classification (copy of allocator_positions.py pattern)
# ---------------------------------------------------------------------------

def _map_exception_to_sync_status(exc: Exception) -> str:
    if isinstance(exc, (ccxt.AuthenticationError, ccxt.PermissionDenied)):
        return "revoked"
    if isinstance(exc, ccxt.RateLimitExceeded):
        return "rate_limited"
    return "error"


class DeribitNotSupportedError(ccxt.NotSupported):
    """Reconstruction does not support Deribit (spot-less derivative-only venue).

    Mirrors allocator_positions.DeribitNotSupportedError — raised BEFORE any
    fetch so the handler can map to sync_status='error' without phantom-zero
    rows.
    """


# ---------------------------------------------------------------------------
# VENUE helper
# ---------------------------------------------------------------------------

def history_depth_months_for_venue(venue: str) -> int | None:
    """Return retained-history cap (months) for a venue, or None if unknown."""
    if not venue:
        return None
    return VENUE_HISTORY_DEPTH_MONTHS.get(venue.lower())


# ---------------------------------------------------------------------------
# Raw-payload cap (matches allocator_positions.py pattern)
# ---------------------------------------------------------------------------

def _cap_breakdown(breakdown: dict) -> dict:
    encoded = json.dumps(breakdown, default=str)
    if len(encoded) <= RAW_PAYLOAD_CAP_BYTES:
        return breakdown
    # Keep top-N by absolute USD value so the dashboard tooltip still shows
    # the biggest contributions.
    top_symbols = sorted(
        breakdown.items(), key=lambda kv: abs(float(kv[1] or 0)), reverse=True
    )[:20]
    truncated = dict(top_symbols)
    truncated["__truncated__"] = True
    return truncated


# ---------------------------------------------------------------------------
# ccxt fetch helpers
# ---------------------------------------------------------------------------

async def _rate_limit_sleep(exchange: Any) -> None:
    """Back-off between paginated calls to the same exchange.

    CCXT's enableRateLimit flag is not guaranteed on every instance we
    receive — reach for the advertised per-call rateLimit attribute and
    sleep for that many ms. Falls through silently on AsyncMock / test
    doubles that have no rateLimit attribute so pytest stays fast.
    """
    ms = getattr(exchange, "rateLimit", None)
    if not isinstance(ms, (int, float)) or ms <= 0:
        return
    try:
        await asyncio.sleep(float(ms) / 1000.0)
    except Exception:  # pragma: no cover
        pass


async def _fetch_trades_with_pagination(
    exchange: Any,
    venue: str,
    since_ms: int,
    now_ms: int,
    limit_per_call: int = 500,
) -> tuple[list[dict], bool]:
    """Paginate fetch_my_trades via since. Returns (trades, hit_okx_terminus).

    For OKX, fans out across every instrument type (SPOT/MARGIN/SWAP/
    FUTURES/OPTION). OKX's /api/v5/trade/fills-history endpoint requires
    a single instType per call — fetch_my_trades(None) only returns the
    default (SPOT), so derivative-only or swap-heavy accounts otherwise
    appear to have zero history. See OKX_INSTRUMENT_TYPES comment for
    the full reasoning. For other venues, a single pass without instType
    is correct (Binance/Bybit return the full book per call).

    On OKX: if `since` is older than the 90-day terminus, set
    hit_okx_terminus=True and clamp the effective since. Logs the
    sentinel string used by the TDD Red gate test:
      "OKX trade history capped at 3 months"
    (RESEARCH.md Pitfall 1 / VOICES-ACCEPTED f9.)
    """
    if venue.lower() != "okx":
        trades = await _fetch_trades_paginated_one_pass(
            exchange, since_ms, limit_per_call, params=None,
        )
        return trades, False

    okx_terminus_ms = now_ms - OKX_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000
    hit_okx_terminus = since_ms < okx_terminus_ms
    if hit_okx_terminus:
        logger.info(
            "OKX trade history capped at 3 months",
            extra={"venue": venue, "since_ms": since_ms},
        )
    effective_since_ms = max(since_ms, okx_terminus_ms)

    # Per-instType fan-out. We pass `params={"type": X}` rather than
    # `params={"instType": X}` because ccxt overwrites request['instType']
    # in okx.fetch_my_trades (line 4706 of ccxt/okx.py) using the value
    # resolved by handle_market_type_and_params, which reads `params.type`
    # → exchangeType map → final 'SPOT'/'SWAP'/etc. Pre-fix, no `type`
    # was passed, so the call defaulted to SPOT and dropped every other
    # instrument's fills.
    all_trades: list[dict] = []
    for inst_type in OKX_INSTRUMENT_TYPES:
        type_trades = await _fetch_trades_paginated_one_pass(
            exchange,
            effective_since_ms,
            limit_per_call,
            params={"type": inst_type.lower()},
        )
        all_trades.extend(type_trades)
    return all_trades, hit_okx_terminus


async def _fetch_trades_paginated_one_pass(
    exchange: Any,
    since_ms: int,
    limit_per_call: int,
    params: dict | None,
) -> list[dict]:
    """Inner pagination loop — one cursor walk against fetch_my_trades with
    a fixed params payload. Caller picks `params` (None for non-OKX, an
    instType selector for OKX). Returns the flat list of trade dicts.
    """
    all_trades: list[dict] = []
    cursor_ms = since_ms

    # 500 iterations × 500 trades/page = 250k trade ceiling per pass —
    # plenty for any real allocator's 90-day or 2-year window.
    for _ in range(500):
        try:
            page = await exchange.fetch_my_trades(
                None, cursor_ms, limit_per_call, params or {},
            )
        except ccxt.NotSupported:
            return all_trades
        page = page or []
        if not page:
            break
        all_trades.extend(page)
        if len(page) < limit_per_call:
            break
        max_ts = max(
            (int(t.get("timestamp") or 0) for t in page), default=cursor_ms,
        )
        if max_ts <= cursor_ms:
            break
        cursor_ms = max_ts + 1
        await _rate_limit_sleep(exchange)
    return all_trades


async def _fetch_transfers(
    exchange: Any, kind: str, since_ms: int, now_ms: int
) -> list[dict]:
    """Paginate fetch_deposits or fetch_withdrawals via 90-day windows.

    Binance/OKX both cap per-call windows at 90 days (RESEARCH.md §1A/§1B).
    We page forward through sliding 90-day windows and collect all rows.
    """
    fetcher_name = "fetch_deposits" if kind == "deposits" else "fetch_withdrawals"
    fetcher = getattr(exchange, fetcher_name, None)
    if fetcher is None:
        return []

    window_ms = 90 * 24 * 60 * 60 * 1000
    page_limit = 500
    all_rows: list[dict] = []
    window_start = since_ms
    while window_start < now_ms:
        window_end = min(window_start + window_ms, now_ms)
        # Paginate WITHIN each 90-day window so a bursty allocator with
        # >500 transfers per window doesn't lose rows past row 500.
        inner_cursor = window_start
        for _ in range(100):  # safety ceiling: 100 × 500 = 50k per window
            # WR-04: only catch ccxt.NotSupported here (feature detection —
            # the exchange cannot enumerate transfers at all). All other
            # exceptions (auth revoked mid-backfill, rate limit, network
            # failure) MUST bubble to the outer handler so they land in
            # classify_exception + _emit_audit rather than being silently
            # swallowed — the previous `break` returned a truncated list
            # that looked identical to "allocator has no transfers", which
            # caused zero-activity rows with no audit trail.
            try:
                page = await fetcher(None, inner_cursor, page_limit)
            except ccxt.NotSupported:
                return all_rows
            page = page or []
            if not page:
                break
            all_rows.extend(page)
            if len(page) < page_limit:
                break
            max_ts = max(
                (int(r.get("timestamp") or 0) for r in page), default=inner_cursor
            )
            if max_ts <= inner_cursor or max_ts >= window_end:
                break
            inner_cursor = max_ts + 1
            await _rate_limit_sleep(exchange)
        window_start += window_ms
        await _rate_limit_sleep(exchange)
    return all_rows


async def _fetch_ohlcv_daily(
    exchange: Any, symbol: str, start_ms: int, end_ms: int,
) -> list[list]:
    """Daily close OHLCV in [start_ms, end_ms]. Paginate until we reach
    end_ms or the venue stops returning new data.

    /investigate 2026-04-24 (v0.15.4.3): previously broke the loop on
    ``len(page) < 1000`` as an end-of-data heuristic. OKX's candles
    endpoint caps at 300 bars/page, so for any backfill window wider
    than 300 days (we fetch BACKFILL_CAP_DAYS=730 days on every
    reconstruct) the loop terminated after ONE page, 300 days deep,
    leaving the last ~430 days of daily closes unfetched. _price_on's
    bisect then returned the final bar's close (2025-02-17, $2744.46)
    for every modern date, marking the allocator's 21 ETH short to a
    stale price and reporting PERP=-$16,846 on an account whose real
    unrealised PnL was -$210. Remove the premature break — trust the
    cursor-advance and empty-page conditions instead.

    Raises ccxt.BadSymbol for symbols the venue does not list — caller
    uses this as the CoinGecko-fallback trigger.
    """
    all_rows: list[list] = []
    cursor_ms = start_ms
    day_ms = 24 * 60 * 60 * 1000
    # Safety ceiling: 10 pages × 1000 bars = 10000 candles, more than
    # any 2-year daily window needs. Prevents infinite loops on a
    # venue whose cursor-advance reports the wrong max_ts.
    for _ in range(10):
        if cursor_ms > end_ms:
            break
        page = await exchange.fetch_ohlcv(symbol, "1d", cursor_ms, 1000)
        page = page or []
        if not page:
            break
        all_rows.extend(page)
        max_ts = max((int(row[0]) for row in page), default=cursor_ms)
        if max_ts <= cursor_ms:
            # Cursor didn't advance — we've reached the end of the
            # venue's data for this window, or the venue returned
            # duplicates. Either way, stop.
            break
        if max_ts >= end_ms:
            # Reached the requested end — no need to fetch further.
            break
        cursor_ms = max_ts + day_ms
        await _rate_limit_sleep(exchange)
    return all_rows


# ---------------------------------------------------------------------------
# CoinGecko fallback
# ---------------------------------------------------------------------------

def _coingecko_id_for(symbol: str) -> str:
    return COINGECKO_ID_OVERRIDES.get(symbol.upper(), symbol.lower())


async def _fetch_coingecko_daily_closes(
    symbol: str, start_ts_secs: int, end_ts_secs: int
) -> list[tuple[str, float]]:
    """Hit /coins/{id}/market_chart/range. Returns [(isodate, price_usd), ...].

    Budget-aware: sleeps COINGECKO_MIN_SLEEP_SECS between calls to stay below
    30 RPM. Never logs the response body (threat T-07-V6) — only symbol +
    date + status.
    """
    cg_id = _coingecko_id_for(symbol)
    url = f"{COINGECKO_BASE}/coins/{cg_id}/market_chart/range"
    params = {
        "vs_currency": "usd",
        "from": start_ts_secs,
        "to": end_ts_secs,
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, params=params)
        try:
            resp.raise_for_status()
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "coingecko fetch failed symbol=%s status=%s",
                symbol, getattr(resp, "status_code", "?"),
            )
            return []
        data = resp.json() or {}

    # Rate-limit throttle to stay under CoinGecko's free-tier 30 RPM limit.
    # Tests monkeypatch COINGECKO_MIN_SLEEP_SECS=0 to keep pytest fast.
    try:
        await asyncio.sleep(COINGECKO_MIN_SLEEP_SECS)
    except Exception:  # pragma: no cover
        pass

    prices = data.get("prices") or []
    out: list[tuple[str, float]] = []
    seen_dates: set[str] = set()
    for row in prices:
        try:
            ts_ms, price = row[0], row[1]
        except (IndexError, TypeError):
            continue
        d = datetime.fromtimestamp(int(ts_ms) / 1000.0, tz=timezone.utc).date()
        iso = d.isoformat()
        if iso in seen_dates:
            continue
        seen_dates.add(iso)
        out.append((iso, float(price)))
    logger.info(
        "coingecko fetched symbol=%s days=%d",
        symbol, len(out),
    )
    return out


async def _cache_coingecko_prices(
    supabase: Any, symbol: str, prices: list[tuple[str, float]]
) -> None:
    """Batch-INSERT into token_price_history ON CONFLICT (symbol, asof) DO NOTHING."""
    if not prices:
        return
    rows = [
        {
            "symbol": symbol,
            "asof": iso,
            "price_usd": price,
            "source": "coingecko",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        }
        for iso, price in prices
    ]

    def _upsert():
        return supabase.table("token_price_history").upsert(
            rows,
            on_conflict="symbol,asof",
            ignore_duplicates=True,
        ).execute()

    try:
        await db_execute(_upsert)
    except Exception as exc:  # noqa: BLE001
        logger.warning("token_price_history upsert failed symbol=%s: %s", symbol, exc)


async def _read_cached_prices(
    supabase: Any, symbol: str, start_iso: str, end_iso: str
) -> dict[str, float]:
    """SELECT from token_price_history; return {asof_iso: price_usd}."""
    def _sel():
        return (
            supabase.table("token_price_history")
            .select("asof, price_usd")
            .eq("symbol", symbol)
            .gte("asof", start_iso)
            .lte("asof", end_iso)
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning("token_price_history read failed symbol=%s: %s", symbol, exc)
        return {}
    data = getattr(res, "data", None) or []
    return {r["asof"]: float(r["price_usd"]) for r in data if r.get("asof") is not None}


# ---------------------------------------------------------------------------
# Pure compute: replay trades + transfers forward through time
# ---------------------------------------------------------------------------

def _compute_daily_equity(
    trades: list[dict],
    deposits: list[dict],
    withdrawals: list[dict],
    ohlcv_by_symbol: dict[str, list[tuple[str, float]]],
    coingecko_by_symbol: dict[str, dict[str, float]],
    start_date: date,
    end_date: date,
) -> list[dict]:
    """Replay trades + transfers forward; mark each day by close × quantity.

    Returns rows with { asof, value_usd, breakdown, source }. `source` is
    'exchange_primary' if all symbols priced from exchange OHLCV;
    'coingecko_fallback' if ALL pricing came from CoinGecko;
    'mixed' if partial.

    Perpetual vs spot replay (M078):
        Spot trades mutate base/quote quantities the classical way — buying
        1 BTC with $50k USDT reduces cash by $50k and credits 1 BTC. That
        model is a disaster for linear perpetuals: opening a 2x ETH long
        does NOT drain cash by the full notional, nor does it credit real
        ETH to the wallet — it posts margin and issues a contract. Replay
        that opens as "spot buy at full notional" credits a phantom base
        balance that, when marked against a later day's close price,
        compounded across overlapping positions in an active perp
        allocator, dragged the equity curve to -224% at mid-window before
        every close zeroed it back to 100%.

        The fix tracks perp positions separately: signed size and weighted
        avg_entry per ccxt symbol (e.g. 'ETH/USDT:USDT'). Opens/increases
        update avg_entry. Reduces/closes realise PnL into the quote
        currency. Flips decompose into a full close plus a new open at
        trade price. At end of each day, OPEN perp positions mark-to-
        market using the base symbol's daily close, and the unrealised
        PnL feeds directly into that day's total_usd.
    """
    # Build event timeline keyed by date
    events_by_date: dict[str, list[dict]] = {}

    def _event_date(ts_ms: Any) -> str | None:
        if ts_ms is None:
            return None
        try:
            d = datetime.fromtimestamp(int(ts_ms) / 1000.0, tz=timezone.utc).date()
        except (TypeError, ValueError, OSError):
            return None
        return d.isoformat()

    for t in trades:
        iso = _event_date(t.get("timestamp"))
        if iso is None:
            continue
        events_by_date.setdefault(iso, []).append({"kind": "trade", **t})
    for d in deposits:
        iso = _event_date(d.get("timestamp"))
        if iso is None:
            continue
        events_by_date.setdefault(iso, []).append({"kind": "deposit", **d})
    for w in withdrawals:
        iso = _event_date(w.get("timestamp"))
        if iso is None:
            continue
        events_by_date.setdefault(iso, []).append({"kind": "withdrawal", **w})

    # Preserve chronological ordering within a single date. Opens must land
    # before closes so position state is correct when a round trip spans a
    # handful of minutes inside the same day.
    for iso_key in events_by_date:
        events_by_date[iso_key].sort(key=lambda e: int(e.get("timestamp") or 0))

    # Running per-symbol quantities (spot side + realised perp PnL in quote)
    quantities: dict[str, float] = {}
    # Perp positions keyed by full ccxt symbol ('ETH/USDT:USDT'). Size is
    # signed: +ve = long, -ve = short. avg_entry is the weighted avg fill
    # price of the currently-open lot; resets to 0 when size goes to 0.
    perp_positions: dict[str, dict[str, float]] = {}

    # Pre-sort pricing keys once so the inner hot loop does O(log n) lookups
    # instead of O(n log n) per (day, symbol) cell. ohlcv rows come back
    # already ordered ascending from ccxt, but we normalise anyway.
    ohlcv_keys: dict[str, list[str]] = {}
    ohlcv_closes: dict[str, list[float]] = {}
    for sym, series in ohlcv_by_symbol.items():
        ordered = sorted(series, key=lambda p: p[0])
        ohlcv_keys[sym] = [iso for iso, _ in ordered]
        ohlcv_closes[sym] = [c for _, c in ordered]

    cg_keys: dict[str, list[str]] = {
        sym: sorted(series.keys()) for sym, series in coingecko_by_symbol.items()
    }

    def _price_on(sym: str, iso_date: str) -> tuple[float | None, str | None]:
        """Return (price, source) for `sym` on `iso_date` using on-or-before
        lookup. Source is 'exchange_primary' / 'coingecko_fallback' / None."""
        keys = ohlcv_keys.get(sym)
        if keys:
            idx = bisect_right(keys, iso_date) - 1
            if idx >= 0:
                return ohlcv_closes[sym][idx], "exchange_primary"
        cg_series = coingecko_by_symbol.get(sym)
        if cg_series:
            if iso_date in cg_series:
                return cg_series[iso_date], "coingecko_fallback"
            cg_sorted = cg_keys.get(sym, [])
            idx = bisect_right(cg_sorted, iso_date) - 1
            if idx >= 0:
                return cg_series[cg_sorted[idx]], "coingecko_fallback"
        return None, None

    rows: list[dict] = []
    cur = start_date
    while cur <= end_date:
        iso = cur.isoformat()
        # Source flags are per-day. Initialising outside the loop caused
        # them to latch: once CoinGecko was used on ANY day, every
        # subsequent day stamped source="mixed" — which WR-05 then NULL-ed
        # out history_depth_months on, wiping the venue warm-up signal.
        used_exchange = False
        used_coingecko = False
        for ev in events_by_date.get(iso, []):
            kind = ev.get("kind")
            if kind == "trade":
                raw_symbol = ev.get("symbol") or ""
                sym = raw_symbol.split("/")[0].upper()
                side = (ev.get("side") or "").lower()
                amt = float(ev.get("amount") or 0.0)
                price = float(ev.get("price") or 0.0)
                cost = float(ev.get("cost") or 0.0)
                if not sym or amt <= 0:
                    continue
                # WR-03: CCXT normalises linear perpetuals as "BTC/USDT:USDT"
                # and inverse contracts as "BTC/USD:BTC". A naive split("/")[-1]
                # would yield "USDT:USDT" and leak non-existent symbols into
                # the quantities dict, producing unpriced base balances that
                # never offset the buy side. Strip the `:settle` suffix so
                # the quote side lands on the canonical currency code.
                if "/" in raw_symbol:
                    quote = raw_symbol.split("/")[-1].split(":")[0].upper()
                else:
                    quote = "USDT"
                # `:` in the ccxt symbol marks a derivative (linear or
                # inverse). Spot never has it.
                is_perp = ":" in raw_symbol
                if is_perp:
                    # Derive price from cost if the ccxt parser didn't fill
                    # it (older Bybit spot fixtures set only execValue/qty).
                    if price <= 0 and cost > 0:
                        price = cost / amt
                    if price <= 0:
                        continue
                    # /investigate 2026-04-24 (v0.15.4.2): defensive contract-
                    # size resolution. Previous v0.15.4.0 attempt relied on
                    # ccxt's safe_trade populating cost = amount × price ×
                    # contractSize, but that only fires when the market
                    # resolved inside safe_market carries a non-None
                    # contractSize. When it doesn't — a ccxt version quirk,
                    # a missing markets prefetch, a SWAP instType fill
                    # resolved against a SPOT market record — cost silently
                    # collapses to amount × price and we leak contract
                    # counts into the replay. Defensive: prefer cost/price
                    # when it agrees with an explicit OKX ctVal table, else
                    # fall back to amount × ctVal. See _resolve_perp_amt_base
                    # for the exact rule + fixture-compat carve-out.
                    inst_type = (ev.get("info") or {}).get("instType")
                    amt_base = _resolve_perp_amt_base(
                        raw_symbol, amt, price, cost, inst_type=inst_type,
                    )
                    signed = amt_base if side == "buy" else -amt_base
                    pos = perp_positions.get(raw_symbol, {"size": 0.0, "avg_entry": 0.0})
                    cur_size = pos["size"]
                    cur_avg = pos["avg_entry"]
                    if cur_size == 0.0 or (cur_size > 0) == (signed > 0):
                        # Open new or increase same-direction. Avg entry is
                        # weighted by contract size, not by notional value —
                        # that keeps avg_entry a true price independent of
                        # how leverage is recorded on the venue.
                        new_size = cur_size + signed
                        if new_size != 0.0:
                            pos["avg_entry"] = (
                                cur_size * cur_avg + signed * price
                            ) / new_size
                        else:
                            pos["avg_entry"] = 0.0
                        pos["size"] = new_size
                    else:
                        # Opposite-direction: reduce, full close, or flip.
                        close_size = min(abs(cur_size), abs(signed))
                        direction = 1.0 if cur_size > 0 else -1.0
                        realized = direction * close_size * (price - cur_avg)
                        quantities[quote] = quantities.get(quote, 0.0) + realized
                        if abs(signed) >= abs(cur_size):
                            remainder = abs(signed) - abs(cur_size)
                            if remainder > 0.0:
                                # Flip: old side fully closed, new side
                                # opens at trade price for the remainder.
                                pos["size"] = (1.0 if signed > 0 else -1.0) * remainder
                                pos["avg_entry"] = price
                            else:
                                pos["size"] = 0.0
                                pos["avg_entry"] = 0.0
                        else:
                            # Partial close: avg_entry is unchanged on the
                            # remaining lot (the fills that are still open
                            # were always filled at `cur_avg`).
                            pos["size"] = cur_size + signed
                    perp_positions[raw_symbol] = pos
                else:
                    if side == "buy":
                        quantities[sym] = quantities.get(sym, 0.0) + amt
                        quantities[quote] = quantities.get(quote, 0.0) - cost
                    elif side == "sell":
                        quantities[sym] = quantities.get(sym, 0.0) - amt
                        quantities[quote] = quantities.get(quote, 0.0) + cost
            elif kind == "deposit":
                sym = (ev.get("currency") or ev.get("code") or "").upper()
                amt = float(ev.get("amount") or 0.0)
                if sym:
                    quantities[sym] = quantities.get(sym, 0.0) + amt
            elif kind == "withdrawal":
                sym = (ev.get("currency") or ev.get("code") or "").upper()
                amt = float(ev.get("amount") or 0.0)
                if sym:
                    quantities[sym] = quantities.get(sym, 0.0) - amt

        breakdown: dict[str, float] = {}
        total = 0.0
        for sym, qty in quantities.items():
            if qty == 0:
                continue
            if sym in STABLECOINS:
                px = 1.0
                src = "exchange_primary"
            else:
                px, src = _price_on(sym, iso)
                if px is None:
                    # Skip symbols with no price — keeps the chart stable
                    continue
            usd = qty * px
            breakdown[sym] = round(usd, 2)
            total += usd
            if src == "exchange_primary":
                used_exchange = True
            elif src == "coingecko_fallback":
                used_coingecko = True

        # Mark open perp positions to the day's close. Unrealised PnL rolls
        # into total_usd and is attributed in the breakdown under a
        # distinct key (`{BASE}:{QUOTE}:PERP`) so it doesn't collide with a
        # spot holding of the same base currency.
        for perp_sym, pos in perp_positions.items():
            size = pos.get("size") or 0.0
            avg_entry = pos.get("avg_entry") or 0.0
            if size == 0.0 or avg_entry == 0.0:
                continue
            base = perp_sym.split("/")[0].upper()
            quote_sym = (
                perp_sym.split("/")[-1].split(":")[0].upper()
                if "/" in perp_sym else "USDT"
            )
            px, src = _price_on(base, iso)
            if px is None:
                continue
            unrealized = size * (px - avg_entry)
            if unrealized == 0.0:
                continue
            key = f"{base}:{quote_sym}:PERP"
            breakdown[key] = round(breakdown.get(key, 0.0) + unrealized, 2)
            total += unrealized
            if src == "exchange_primary":
                used_exchange = True
            elif src == "coingecko_fallback":
                used_coingecko = True

        if breakdown or total:
            if used_exchange and used_coingecko:
                source = "mixed"
            elif used_coingecko and not used_exchange:
                source = "coingecko_fallback"
            else:
                source = "exchange_primary"
            rows.append({
                "asof": iso,
                "value_usd": round(total, 2),
                "breakdown": _cap_breakdown(breakdown),
                "source": source,
            })
        cur = cur + timedelta(days=1)
    return rows


# ---------------------------------------------------------------------------
# Persistence
# ---------------------------------------------------------------------------

async def persist_equity_snapshots(
    supabase: Any,
    rows: list[dict],
    allocator_id: str,
    history_depth_months: int | None,
) -> int:
    """Mirror persist_allocator_holdings — on_conflict='allocator_id,asof',
    DO NOTHING semantics (reconstruction is deterministic; avoid rewriting
    reconstructed_at on idempotent re-runs — threat T-07-V5 mitigation).

    Each row carries the injected `history_depth_months` (per VOICES-ACCEPTED f9).
    """
    if not rows:
        return 0

    reconstructed_at = datetime.now(timezone.utc).isoformat()
    stamped = []
    for r in rows:
        # WR-05: attach history_depth_months ONLY for rows sourced purely
        # from exchange OHLCV. Both `coingecko_fallback` (retention doesn't
        # apply) and `mixed` (some symbols priced from CoinGecko, for which
        # the per-venue cap isn't the binding constraint) get NULL — the
        # dashboard's `minHistoryDepthMonths` then reflects the effective
        # limit from genuinely exchange-retained rows only, and the f9
        # warm-up copy ("Only N months of history available on {venue}")
        # isn't misapplied to rows whose limiting factor is CoinGecko.
        row_depth = (
            history_depth_months if r.get("source") == "exchange_primary"
            else None
        )
        stamped.append({
            **r,
            "allocator_id": allocator_id,
            "reconstructed_at": reconstructed_at,
            "history_depth_months": row_depth,
        })

    # Single atomic upsert — chunked batching would leave partial state if
    # an interior batch failed. The caller's `existing > 0` idempotency
    # short-circuit assumes "any rows exist ⇒ reconstruction completed";
    # splitting into multiple round-trips breaks that invariant because a
    # mid-run failure (network blip, SIGKILL) leaves row count above zero
    # with the history truncated, and retries short-circuit permanently.
    # 730 rows × ~150B is ≈110KB — well within PostgREST payload limits.
    def _upsert():
        return supabase.table("allocator_equity_snapshots").upsert(
            stamped,
            on_conflict="allocator_id,asof",
            ignore_duplicates=True,
        ).execute()

    # /investigate 2026-04-22: return the count Postgres ACTUALLY wrote,
    # not len(stamped). With ignore_duplicates=True, a collision on every
    # (allocator_id, asof) produces a no-op — pre-fix this returned 730
    # while 0 rows were written, so audit logs reported `days_written=730`
    # while the dashboard showed zero change. Callers now see the real
    # count and can surface "reconstruct_complete but no rows written"
    # as a user-actionable signal.
    res = await db_execute(_upsert)
    return len(getattr(res, "data", None) or [])


async def _allocator_has_other_api_keys(
    supabase: Any, allocator_id: str, api_key_id: str,
) -> bool:
    """Does this allocator own any CONNECTED api_keys OTHER than `api_key_id`?

    The reconstruction-upsert path uses ON CONFLICT DO NOTHING to protect
    multi-key aggregation (threat T-07-V5b) — the first key to land for a
    given (allocator, asof) wins; subsequent keys are benign no-ops. That
    invariant is load-bearing when multiple keys contribute, but it traps
    single-key users whose snapshots are stale (e.g. pre-v0.15.3.0 buggy
    perp replay, or orphans from a deleted key). When this key is the
    allocator's sole authoritative source, the fresh reconstruct should
    own the series outright.

    Soft-disconnected keys (migration 075: disconnected_at IS NOT NULL)
    MUST be excluded from the sibling count. Their rows persist in
    api_keys for audit continuity, but the worker stopped syncing them
    the moment they were disconnected, so they cannot produce new
    snapshots. Counting them as siblings re-opens the "I uploaded a
    fresh key but my stale V-shaped curve persists" trap that v0.15.3.3
    was meant to close. Mirrors the worker-dispatch filter in migrations
    075 (enqueue_poll_allocator_positions_for_all_keys, line 193-196;
    enqueue_refresh_allocator_equity_for_all, line 244-248).

    api_keys has FK cascade to compute_jobs (migration 066 STEP 2) — if a
    prior key was hard-deleted, its api_keys row is gone. So checking
    connected api_keys presence is a sufficient proxy for "are there
    OTHER keys whose data we must not clobber".

    Returns True when at least one connected sibling exists. Defaults to
    True on query failure (fail-safe: preserve DO NOTHING rather than
    risk wiping legitimate multi-key data on a transient read error).
    """
    def _sel():
        return (
            supabase.table("api_keys")
            .select("id", count="exact", head=True)
            .eq("user_id", allocator_id)
            .neq("id", api_key_id)
            .is_("disconnected_at", "null")
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "api_keys sibling lookup failed for allocator=%s (key=%s): %s — "
            "defaulting to multi-key safe (no snapshot wipe)",
            allocator_id, api_key_id, exc,
        )
        return True
    count = getattr(res, "count", None)
    if count is not None:
        return int(count) > 0
    data = getattr(res, "data", None) or []
    return len(data) > 0


async def _purge_allocator_equity_snapshots(
    supabase: Any, allocator_id: str,
) -> int:
    """Delete every allocator_equity_snapshots row for this allocator.

    Called only from the sole-key reconstruction path (see caller). Returns
    the number of rows deleted for audit-log surfacing. Failures bubble so
    the handler's outer except-block classifies + records them rather than
    silently proceeding with a polluted upsert.
    """
    def _del():
        return (
            supabase.table("allocator_equity_snapshots")
            .delete()
            .eq("allocator_id", allocator_id)
            .execute()
        )

    res = await db_execute(_del)
    data = getattr(res, "data", None) or []
    return len(data)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

async def _api_key_already_reconstructed(supabase: Any, api_key_id: str) -> bool:
    """Per-api_key idempotency check (replaces 070's allocator-scoped gate).

    Returns True when this api_key has previously produced a completed
    reconstruct_allocator_history job. Migration 076 — without this scope
    fix, an allocator's first reconstruct rows blocked every subsequent
    api_key (additional exchanges, re-keyed connections) from ever
    backfilling, because allocator_equity_snapshots intentionally
    aggregates across keys at UPSERT time and cannot answer the
    per-key question.

    The check is `status = 'done'` only — the partial unique index
    `compute_jobs_one_inflight_reconstruct_per_api_key` already prevents
    a second concurrent in-flight job for the same key, and the current
    job's own row is `running`/`pending`, never `done`, so excluding it
    is automatic.
    """
    def _sel():
        return (
            supabase.table("compute_jobs")
            .select("id", count="exact", head=True)
            .eq("api_key_id", api_key_id)
            .eq("kind", "reconstruct_allocator_history")
            .eq("status", "done")
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "compute_jobs done-reconstruct lookup failed for api_key=%s: %s",
            api_key_id, exc,
        )
        return False
    count = getattr(res, "count", None)
    if count is not None:
        return int(count) > 0
    data = getattr(res, "data", None) or []
    return len(data) > 0


async def _fetch_today_holdings(
    supabase: Any, allocator_id: str, today_iso: str
) -> list[dict]:
    def _sel():
        return (
            supabase.table("allocator_holdings")
            .select(
                "symbol, quantity, mark_price, value_usd, "
                "unrealized_pnl_usd, venue, holding_type, api_key_id"
            )
            .eq("allocator_id", allocator_id)
            .eq("asof", today_iso)
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning("allocator_holdings read failed: %s", exc)
        return []
    return list(getattr(res, "data", None) or [])


# ---------------------------------------------------------------------------
# Shared fetch-and-price block used by both handlers
# ---------------------------------------------------------------------------

async def _fetch_and_price_window(
    exchange: Any,
    venue: str,
    supabase: Any,
    start_date: date,
    end_date: date,
) -> tuple[list[dict], bool]:
    """Fetch trades + transfers + OHLCV in [start_date, end_date] and build
    the per-day equity rows. Returns (rows, hit_okx_terminus)."""
    start_ms = int(
        datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc).timestamp() * 1000
    )
    end_ms = int(
        datetime(end_date.year, end_date.month, end_date.day, tzinfo=timezone.utc).timestamp() * 1000
    )
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)

    trades, hit_terminus = await _fetch_trades_with_pagination(
        exchange, venue, start_ms, now_ms
    )
    # When the trade window was clamped to the OKX 90-day terminus, pre-
    # terminus deposits/withdrawals would arrive with no matching trades
    # to offset them — producing phantom quantities for assets long
    # since sold outside the recorded trade window. Clamp transfers to
    # the same terminus so the replay stays consistent.
    transfers_since_ms = start_ms
    if hit_terminus:
        okx_terminus_ms = now_ms - OKX_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000
        transfers_since_ms = max(start_ms, okx_terminus_ms)
    deposits = await _fetch_transfers(
        exchange, "deposits", transfers_since_ms, now_ms
    )
    withdrawals = await _fetch_transfers(
        exchange, "withdrawals", transfers_since_ms, now_ms
    )

    # Collect symbols from trades + transfers
    symbols: set[str] = set()
    for t in trades:
        s = (t.get("symbol") or "").split("/")[0].upper()
        if s:
            symbols.add(s)
    for lst in (deposits, withdrawals):
        for e in lst:
            s = (e.get("currency") or e.get("code") or "").upper()
            if s and s not in STABLECOINS:
                symbols.add(s)

    ohlcv_by_symbol: dict[str, list[tuple[str, float]]] = {}
    coingecko_by_symbol: dict[str, dict[str, float]] = {}

    # Pass 1 — concurrent OHLCV fetches on the primary venue. CCXT's
    # enableRateLimit throttles per-exchange so parallel calls stay polite.
    async def _fetch_primary(sym: str) -> tuple[str, list[tuple[str, float]] | None, str | None]:
        if sym in STABLECOINS:
            return sym, None, "skip"
        try:
            raw = await _fetch_ohlcv_daily(exchange, f"{sym}/USDT", start_ms, end_ms)
            return sym, [
                (
                    datetime.fromtimestamp(int(r[0]) / 1000.0, tz=timezone.utc).date().isoformat(),
                    float(r[4]),
                )
                for r in raw
            ], None
        except ccxt.BadSymbol:
            return sym, None, "bad_symbol"
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_ohlcv failed symbol=%s: %s", sym, exc)
            return sym, None, "error"

    primary_results = await asyncio.gather(*[_fetch_primary(s) for s in symbols])

    for sym, series, err in primary_results:
        if series is not None:
            ohlcv_by_symbol[sym] = series

    # Pass 2 — sequential CoinGecko fallback for BadSymbol results. Kept
    # sequential so the 2s inter-call throttle (COINGECKO_MIN_SLEEP_SECS)
    # can't be bypassed via parallel fan-out.
    for sym, _series, err in primary_results:
        if err != "bad_symbol":
            continue
        cached = await _read_cached_prices(supabase, sym, start_date.isoformat(), end_date.isoformat())
        needed = cached
        if not cached:
            closes = await _fetch_coingecko_daily_closes(
                sym,
                int(datetime(start_date.year, start_date.month, start_date.day, tzinfo=timezone.utc).timestamp()),
                int(datetime(end_date.year, end_date.month, end_date.day, tzinfo=timezone.utc).timestamp()) + 86400,
            )
            if closes:
                await _cache_coingecko_prices(supabase, sym, closes)
                needed = {iso: price for iso, price in closes}
        coingecko_by_symbol[sym] = needed

    rows = _compute_daily_equity(
        trades, deposits, withdrawals,
        ohlcv_by_symbol, coingecko_by_symbol,
        start_date, end_date,
    )

    # /investigate 2026-04-24 (v0.15.4.2): anchor the reconstructed series
    # to today's actual exchange equity. Pure trade-replay from genesis
    # starts with quantities={} (zero cash), so accounts whose USDT
    # margin pre-dates the OKX 90-day trade window show equity curves
    # that start near zero and drift into deep negative territory when
    # open perps mark against zero cash. A fully-collateralised $195k
    # OKX account came out of reconstruction at -$18k (equity pct
    # -1510% in the dashboard) even after the v0.15.4.0 contract-size
    # fix. The window boundary eats the initial balance.
    #
    # Fix: fetch today's true total equity from the exchange, compute
    # the offset needed so the final row matches reality, and apply
    # that offset uniformly. Historical *relative* day-to-day changes
    # are preserved; absolute levels are anchored to the exchange's
    # own number. Breakdown gets a "STARTING_BALANCE" entry so the
    # components still sum to value_usd.
    anchor = await _fetch_current_equity(exchange, venue)
    if rows and anchor is not None:
        last_value = float(rows[-1].get("value_usd") or 0.0)
        offset = anchor - last_value
        if abs(offset) > 0.005:
            for r in rows:
                r["value_usd"] = round(float(r["value_usd"] or 0.0) + offset, 2)
                bd = dict(r.get("breakdown") or {})
                bd["STARTING_BALANCE"] = round(
                    float(bd.get("STARTING_BALANCE", 0.0)) + offset, 2,
                )
                r["breakdown"] = _cap_breakdown(bd)

    return rows, hit_terminus


async def _fetch_current_equity(exchange: Any, venue: str) -> float | None:
    """Return today's total account equity in USD, or None if we can't
    determine it. Sums spot USDT equivalents + perp unrealised PnL.

    Keeps the semantics of the daily refresh job (v0.15.4.0 fix 2): spot
    rows contribute their marked value, derivative rows contribute
    unrealized PnL only — on unified-margin venues the USDT collateral
    backing perps already sits in the spot row and summing notional on
    top double-counts.

    Wrapped in a blanket try/except: the anchor is advisory, not load-
    bearing. Any exchange error — including mocked exchanges in tests
    that don't stub fetch_balance/fetch_positions — returns None so the
    reconstruction still ships an unanchored series rather than failing
    the whole job.
    """
    try:
        balance = await exchange.fetch_balance()
        if not isinstance(balance, dict):
            return None
        totals = balance.get("total") or {}
        if not isinstance(totals, dict):
            return None
        total = 0.0
        for asset, qty in totals.items():
            if qty is None:
                continue
            try:
                q = float(qty)
            except (TypeError, ValueError):
                continue
            if q <= 0:
                continue
            asset_upper = str(asset).upper()
            if asset_upper in STABLECOINS:
                total += q
                continue
            # Price non-stablecoin spot via a single ticker call. Best-
            # effort — a missing ticker is treated as zero rather than
            # aborting the anchor.
            try:
                t = await exchange.fetch_ticker(f"{asset_upper}/USDT")
                px = float((t or {}).get("last") or 0.0) if isinstance(t, dict) else 0.0
            except Exception:  # noqa: BLE001
                px = 0.0
            total += q * px

        try:
            positions = await exchange.fetch_positions()
        except Exception:  # noqa: BLE001
            positions = []
        if not isinstance(positions, list):
            positions = []
        for p in positions:
            if not isinstance(p, dict):
                continue
            upnl = p.get("unrealizedPnl")
            if upnl is None:
                continue
            try:
                total += float(upnl)
            except (TypeError, ValueError):
                continue
        return total
    except Exception as exc:  # noqa: BLE001
        logger.warning("anchor: _fetch_current_equity failed venue=%s: %s", venue, exc)
        return None


# ---------------------------------------------------------------------------
# Entrypoints
# ---------------------------------------------------------------------------

async def run_reconstruct_allocator_history_job(job: dict) -> DispatchResult:
    """Full backfill on first key connect. One-time per (allocator, api_key).

    KEY-SCOPED per VOICES-ACCEPTED f1 — reads job['api_key_id'], derives
    allocator_id from ctx.key_row['user_id'].
    """
    ctx = await _allocator_key_preflight(job, "run_reconstruct_allocator_history_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    api_key_id = job["api_key_id"]
    allocator_id = ctx.key_row["user_id"]
    venue = (ctx.key_row.get("exchange") or "").lower()

    if venue == "deribit":
        # Reconstruction does not support Deribit (derivatives-only spot gap).
        _emit_audit(
            allocator_id, api_key_id,
            "allocator.equity.reconstruct_failed",
            {"error_kind": "permanent", "sanitized_message": "Deribit reconstruction deferred"},
        )
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover
            pass
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message="Deribit reconstruction not supported",
            error_kind="permanent",
        )

    # Per-api_key idempotency (Migration 076): short-circuit as DONE
    # only when THIS key has previously completed a reconstruct.
    # Allocator-scoped snapshot count was the wrong gate — it locked
    # out every subsequent api_key (additional exchanges or re-key)
    # from ever backfilling, because allocator_equity_snapshots
    # intentionally aggregates across keys via UPSERT on (allocator_id,
    # asof). The compute_jobs table is the per-key source of truth.
    if await _api_key_already_reconstructed(ctx.supabase, api_key_id):
        _emit_audit(
            allocator_id, api_key_id,
            "allocator.equity.reconstruct_complete",
            {"reason": "already_reconstructed_for_api_key"},
        )
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover
            pass
        return DispatchResult(outcome=DispatchOutcome.DONE)

    _emit_audit(
        allocator_id, api_key_id,
        "allocator.equity.reconstruct_started",
        {"venue": venue, "backfill_cap_days": BACKFILL_CAP_DAYS},
    )

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=BACKFILL_CAP_DAYS)

    try:
        try:
            rows, hit_terminus = await _fetch_and_price_window(
                ctx.exchange, venue, ctx.supabase, start_date, end_date,
            )
        except ccxt.RateLimitExceeded as exc:
            await _stamp_429(ctx.supabase, ctx.key_row)
            error_kind, msg = classify_exception(exc)
            sanitized = msg[:500]
            _emit_audit(
                allocator_id, api_key_id,
                "allocator.equity.reconstruct_failed",
                {"error_kind": error_kind, "sanitized_message": sanitized},
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=sanitized,
                error_kind=error_kind,
            )
        except Exception as exc:  # noqa: BLE001
            error_kind, msg = classify_exception(exc)
            sanitized = msg[:500]
            _emit_audit(
                allocator_id, api_key_id,
                "allocator.equity.reconstruct_failed",
                {"error_kind": error_kind, "sanitized_message": sanitized},
            )
            return DispatchResult(
                outcome=DispatchOutcome.FAILED,
                error_message=sanitized,
                error_kind=error_kind,
            )
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass

    # Resolve per-venue history_depth_months (f9).
    # If OKX terminus was hit, force to 3 regardless of lookup.
    depth_months = history_depth_months_for_venue(venue)
    if hit_terminus:
        depth_months = 3

    # /investigate 2026-04-22: sole-key stale-snapshot replacement.
    # When this api_key is the allocator's only key, any existing snapshots
    # are either orphans from a previously deleted key OR stale rows from
    # a pre-fix engine version (e.g. v0.15.3.0 perpetual MTM). The
    # first-writer-wins UPSERT silently drops our fresh rows in that case,
    # so the dashboard serves the wrong curve indefinitely with no
    # user-actionable recovery path (migration 077 only covers the
    # hard-delete+cascade last-key path, leaving the "add new key" door
    # wide open). Purge-then-upsert breaks the deadlock cleanly without
    # regressing the T-07-V5b multi-key aggregation invariant — any
    # allocator with sibling keys keeps DO NOTHING semantics below.
    purged = 0
    if not await _allocator_has_other_api_keys(ctx.supabase, allocator_id, api_key_id):
        purged = await _purge_allocator_equity_snapshots(ctx.supabase, allocator_id)

    count = await persist_equity_snapshots(ctx.supabase, rows, allocator_id, depth_months)

    _emit_audit(
        allocator_id, api_key_id,
        "allocator.equity.reconstruct_complete",
        {
            "days_written": count,
            "stale_snapshots_purged": purged,
            "history_depth_months": depth_months,
            "okx_terminus_hit": hit_terminus,
            "venue": venue,
        },
    )
    logger.info(
        "reconstruct_allocator_history: persisted %d rows for allocator %s (venue=%s, depth=%s)",
        count, allocator_id, venue, depth_months,
    )
    return DispatchResult(outcome=DispatchOutcome.DONE)


async def run_refresh_allocator_equity_daily_job(job: dict) -> DispatchResult:
    """Incremental one-day delta. KEY-SCOPED per VOICES-ACCEPTED f1.

    Reads job['api_key_id'] via _allocator_key_preflight; derives allocator_id
    from ctx.key_row['user_id']. Persists ONE row for today via UPSERT ON
    CONFLICT (allocator_id, asof) DO NOTHING — multiple keys for the same
    allocator coalesce at this layer (threat T-07-V5b mitigation).
    """
    ctx = await _allocator_key_preflight(job, "run_refresh_allocator_equity_daily_job")
    if isinstance(ctx, DispatchResult):
        return ctx

    api_key_id = job["api_key_id"]
    allocator_id = ctx.key_row["user_id"]
    venue = (ctx.key_row.get("exchange") or "").lower()
    today = datetime.now(timezone.utc).date()
    today_iso = today.isoformat()

    try:
        # Read today's holdings (populated by Phase 06 poll_allocator_positions)
        holdings = await _fetch_today_holdings(ctx.supabase, allocator_id, today_iso)

        # Compute single-day equity from holdings' value_usd fan-in.
        #
        # /investigate 2026-04-24: perp derivative rows must contribute
        # unrealized_pnl_usd, NOT value_usd. allocator_positions.py:191
        # stores value_usd = size_usd (full notional, e.g. 21.464 ETH ×
        # $2336 = $50,172) because the positions table is the source of
        # truth for BOTH the strategy engine (which wants notional) and
        # the allocator dashboard (which wants equity contribution). On
        # unified-margin venues like OKX the perp's USDT margin is
        # already counted in the spot USDT balance — summing notional on
        # top double-counts. Demo 2026-04-23 snapshot: $195,493 USDT +
        # $50,172 ETH perp notional = $245,665 reported, when actual
        # equity was ~$195,493 + a few hundred of unrealised PnL. Use
        # unrealized_pnl_usd and tag the breakdown key with ":PERP" so
        # it can't collide with a spot symbol of the same base currency.
        total = 0.0
        breakdown: dict[str, float] = {}
        for h in holdings:
            sym = (h.get("symbol") or "").upper()
            if not sym:
                continue
            htype = (h.get("holding_type") or "").lower()
            if htype == "derivative":
                upnl = float(h.get("unrealized_pnl_usd") or 0.0)
                if upnl == 0.0:
                    continue
                key = f"{sym}:PERP"
                breakdown[key] = round(breakdown.get(key, 0.0) + upnl, 2)
                total += upnl
            else:
                v = float(h.get("value_usd") or 0.0)
                breakdown[sym] = round(breakdown.get(sym, 0.0) + v, 2)
                total += v

        if not breakdown:
            logger.info(
                "refresh_allocator_equity_daily: no holdings today for allocator=%s venue=%s",
                allocator_id, venue,
            )
            _emit_audit(
                allocator_id, api_key_id,
                "allocator.equity.refresh_complete",
                {"reason": "no_holdings_today", "venue": venue},
            )
            return DispatchResult(outcome=DispatchOutcome.DONE)

        row = {
            "asof": today_iso,
            "value_usd": round(total, 2),
            "breakdown": _cap_breakdown(breakdown),
            "source": "exchange_primary",
        }
        depth_months = history_depth_months_for_venue(venue)
        count = await persist_equity_snapshots(
            ctx.supabase, [row], allocator_id, depth_months,
        )
        _emit_audit(
            allocator_id, api_key_id,
            "allocator.equity.refresh_complete",
            {
                "days_written": count,
                "history_depth_months": depth_months,
                "venue": venue,
            },
        )
        logger.info(
            "refresh_allocator_equity_daily: upserted %d row for allocator=%s (key=%s, venue=%s)",
            count, allocator_id, api_key_id, venue,
        )
        return DispatchResult(outcome=DispatchOutcome.DONE)
    except ccxt.RateLimitExceeded as exc:
        await _stamp_429(ctx.supabase, ctx.key_row)
        error_kind, msg = classify_exception(exc)
        sanitized = msg[:500]
        _emit_audit(
            allocator_id, api_key_id,
            "allocator.equity.refresh_failed",
            {"error_kind": error_kind, "sanitized_message": sanitized},
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=sanitized,
            error_kind=error_kind,
        )
    except Exception as exc:  # noqa: BLE001
        error_kind, msg = classify_exception(exc)
        sanitized = msg[:500]
        _emit_audit(
            allocator_id, api_key_id,
            "allocator.equity.refresh_failed",
            {"error_kind": error_kind, "sanitized_message": sanitized},
        )
        return DispatchResult(
            outcome=DispatchOutcome.FAILED,
            error_message=sanitized,
            error_kind=error_kind,
        )
    finally:
        try:
            await ctx.exchange.close()
        except Exception:  # pragma: no cover - defensive cleanup
            pass


# ---------------------------------------------------------------------------
# Phase 09 / D-01 + LIVE-01: per-symbol returns reconstruction helper
# ---------------------------------------------------------------------------


def reconstruct_symbol_returns(
    snapshots: list[dict],
    symbol: str,
) -> "pd.Series | None":
    """Phase 09 / D-01 + D-02. Reconstruct a per-symbol daily-return Series
    from allocator_equity_snapshots rows.

    Algorithm:
    - Extract (asof, breakdown.get(symbol)) from each snapshot (ordered ASC by asof).
    - Drop entries where the symbol is absent OR zero (matches migration 073's
      extract_symbol_value_at NULLIF + (breakdown IS NULL OR value = 0) semantics).
      Rationale per RESEARCH Pitfall 2: partial days are treated as missing, NOT
      forward-filled — a deposit arriving on day N means the symbol's series
      legitimately starts at day N.
    - pct_change().dropna() over the remaining values.
    - Return None if fewer than 2 symbol-present data points exist (cannot compute
      any return).

    Callers apply a further >= 30-day warm-up gate on the returned series per
    Phase 07 D-03 analog (see _load_holding_portfolio_context in routers/match.py).

    Args:
        snapshots: List of allocator_equity_snapshots rows, each with
                   ``asof`` (DATE string, ISO format) and
                   ``breakdown`` (dict mapping symbol -> value_usd float).
                   Must already be ordered ascending by asof.
        symbol: The CCXT-stripped uppercase symbol to extract (e.g. "BTC").

    Returns:
        pd.Series of daily percentage returns indexed by asof strings,
        or None if insufficient data exists for the symbol.
    """
    pairs: list[tuple[str, float]] = []
    for snap in snapshots:
        bd = snap.get("breakdown") or {}
        raw = bd.get(symbol)
        if raw is None:
            continue
        try:
            val = float(raw)
        except (TypeError, ValueError):
            continue
        if val == 0:
            continue
        pairs.append((snap["asof"], val))

    if len(pairs) < 2:
        return None

    asofs = [p[0] for p in pairs]
    values = [p[1] for p in pairs]
    series = pd.Series(values, index=asofs, name=symbol)
    returns = series.pct_change().dropna()
    if len(returns) == 0:
        return None
    return returns


# ---------------------------------------------------------------------------
# Phase 19 / BACKBONE-06 + BACKBONE-07 — EquityCurveBuilder
# ---------------------------------------------------------------------------
#
# Wraps existing primitives (position_reconstruction.py, funding_fetch.py)
# per ROADMAP REUSE flag. Open perps valued at mark-price; YTD = window-
# filtered TWR; Sharpe matches an independently-computed quantstats
# reference within ±0.05 per source.
#
# Design notes (verified against the actual primitives 2026-05-08):
# - services.position_reconstruction._match_positions_fifo returns dicts
#   keyed by entry_price_avg / exit_price_avg / size_base / realized_pnl
#   and emits side as "long"/"short" plus opened_at/closed_at as string
#   timestamps. EquityCurveBuilder maps that shape into the
#   services.ingestion.adapter.Position dataclass (entry_price /
#   exit_price / quantity / pnl, datetime fields).
# - Trade.timestamp is a datetime; _match_positions_fifo expects a string
#   timestamp on each fill, so we serialize on the way in.
# - We import _match_positions_fifo via its underscore-prefixed name on
#   purpose (Phase 19 / MC-2 decision: leave private to avoid touching
#   the DB-side tested primitive).

from collections import defaultdict as _phase19_defaultdict

import math as _phase19_math


class EquityCurveBuilder:
    """Phase 19 / BACKBONE-06 + BACKBONE-07.

    Builds an equity curve from raw trades, with mark-price valuation for
    open perpetual positions and funding-rate accumulation. YTD = window-
    filtered TWR; TWR = full-history.

    Wraps existing primitives (RESEARCH gotcha L1720 — Option B chosen):
      - position_reconstruction._match_positions_fifo (private; imported
        directly because we don't touch the existing tested DB primitive)
      - services.funding_fetch primitives (8h bucket dedup)
      - services.exchange.fetch_mark_prices(instruments) (60s in-process
        cache)

    Sharpe matches an independently-computed quantstats reference
    (qs.stats.sharpe(returns, periods=252)) within ±0.05.
    """

    def __init__(
        self,
        trades: list,  # list[Trade] — annotation kept loose to avoid circular import
        mark_prices: dict[str, float] | None = None,
    ) -> None:
        self.trades = sorted(trades, key=lambda t: t.timestamp)
        self.mark_prices = mark_prices or {}
        self._funding_pnl_by_day: dict[date, float] = {}
        self._curve_cache: pd.DataFrame | None = None

    # ------------------------------------------------------------------
    # Position reconstruction (in-memory, not persisted)
    # ------------------------------------------------------------------

    def reconstruct_positions(self) -> list:
        """In-memory FIFO matching (NOT persisted to DB).

        Calls existing services.position_reconstruction._match_positions_fifo
        (private — Phase 19 / MC-2 Option B).
        """
        from services.ingestion.adapter import Position
        from services.position_reconstruction import _match_positions_fifo

        positions_by_symbol: dict[str, list[dict]] = _phase19_defaultdict(list)
        for trade in self.trades:
            ts = trade.timestamp
            if isinstance(ts, datetime):
                ts_str = ts.isoformat().replace("+00:00", "Z")
            else:
                ts_str = str(ts)
            positions_by_symbol[trade.symbol].append(
                {
                    "side": trade.side,
                    "price": float(trade.price),
                    "quantity": float(trade.quantity),
                    "fee": float(trade.fee or 0.0),
                    "timestamp": ts_str,
                }
            )

        all_positions: list[dict] = []
        for symbol, fills in positions_by_symbol.items():
            matched = _match_positions_fifo(
                symbol, fills, strategy_id="<in-memory>"
            )
            all_positions.extend(matched)

        # Attach mark prices to open positions (BACKBONE-06).
        for pos in all_positions:
            if pos.get("status") == "open":
                mark = self.mark_prices.get(pos.get("symbol", ""))
                if mark is not None:
                    pos["mark_price"] = float(mark)
                    entry = float(pos.get("entry_price_avg") or 0.0)
                    qty = float(pos.get("size_base") or 0.0)
                    side = pos.get("side")
                    if side == "long":
                        pos["unrealized_pnl"] = (mark - entry) * qty
                    else:
                        pos["unrealized_pnl"] = (entry - mark) * qty

        return [Position(**_phase19_position_dict_to_kwargs(p)) for p in all_positions]

    # ------------------------------------------------------------------
    # Funding-rate accumulation
    # ------------------------------------------------------------------

    def attach_funding(self, funding_rows: list[dict]) -> None:
        """Sum signed funding payments into self._funding_pnl_by_day.

        Each ``funding_row`` shape: ``{timestamp, symbol, payment, ...}``.
        Bucketed by UTC date; 8h cycles (per services/funding_fetch.py)
        are aggregated up to a daily slot for the equity-curve consumer.
        """
        for row in funding_rows or []:
            ts = row.get("timestamp")
            if isinstance(ts, str):
                try:
                    ts = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                except ValueError:
                    continue
            if not isinstance(ts, datetime):
                continue
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            d = ts.astimezone(timezone.utc).date()
            payment = row.get("payment", row.get("amount", 0.0))
            try:
                amount = float(payment)
            except (TypeError, ValueError):
                continue
            self._funding_pnl_by_day[d] = (
                self._funding_pnl_by_day.get(d, 0.0) + amount
            )
        self._curve_cache = None  # invalidate

    # ------------------------------------------------------------------
    # Daily equity DataFrame
    # ------------------------------------------------------------------

    def to_equity_curve_daily(self) -> "pd.DataFrame":
        """Return a daily equity DataFrame.

        Columns: ``[date, realized_pnl, unrealized_pnl, funding_pnl,
        equity, daily_return]``.
        """
        if self._curve_cache is not None:
            return self._curve_cache

        if not self.trades:
            self._curve_cache = pd.DataFrame(
                columns=[
                    "date",
                    "realized_pnl",
                    "unrealized_pnl",
                    "funding_pnl",
                    "equity",
                    "daily_return",
                ]
            )
            return self._curve_cache

        positions = self.reconstruct_positions()

        realized_by_date: dict[date, float] = _phase19_defaultdict(float)
        for pos in positions:
            if pos.status == "closed" and pos.closed_at and pos.pnl is not None:
                closed_at = pos.closed_at
                if isinstance(closed_at, datetime):
                    if closed_at.tzinfo is None:
                        closed_at = closed_at.replace(tzinfo=timezone.utc)
                    d = closed_at.astimezone(timezone.utc).date()
                else:
                    continue
                realized_by_date[d] += float(pos.pnl)

        first = min(t.timestamp for t in self.trades)
        last = max(t.timestamp for t in self.trades)
        if first.tzinfo is None:
            first = first.replace(tzinfo=timezone.utc)
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        first_d = first.astimezone(timezone.utc).date()
        last_d = last.astimezone(timezone.utc).date()
        idx = pd.date_range(first_d, last_d, freq="D")

        df = pd.DataFrame({"date": idx})
        df["realized_pnl"] = df["date"].map(
            lambda d: realized_by_date.get(d.date(), 0.0)
        )
        df["funding_pnl"] = df["date"].map(
            lambda d: self._funding_pnl_by_day.get(d.date(), 0.0)
        )
        df["unrealized_pnl"] = 0.0
        # Open-position unrealized pnl is realised on the last bar (BACKBONE-06).
        if not df.empty:
            open_unrealized = sum(
                float(getattr(p, "pnl", None) or 0.0)
                for p in positions
                if p.status == "open"
            )
            df.loc[df.index[-1], "unrealized_pnl"] = open_unrealized

        df["daily_pnl"] = (
            df["realized_pnl"] + df["funding_pnl"] + df["unrealized_pnl"]
        )
        df["equity"] = df["daily_pnl"].cumsum()
        # Avoid division-by-zero on day 1: shift to a 1.0 starting basis.
        equity_basis = df["equity"] + 1.0
        df["daily_return"] = equity_basis.pct_change().fillna(0.0)
        df = df.drop(columns=["daily_pnl"])
        self._curve_cache = df
        return df

    # ------------------------------------------------------------------
    # Metrics (TWR / YTD / Sharpe / max drawdown)
    # ------------------------------------------------------------------

    def compute_twr(self) -> float | None:
        """Time-Weighted Return over the full history."""
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        return float((1 + df["daily_return"]).prod() - 1)

    def compute_ytd(self) -> float | None:
        """YTD = TWR computed over the year-to-date window.

        BACKBONE-07: differs from full-history TWR when the strategy has
        history outside the current calendar year.
        """
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        year_start = pd.Timestamp(date(date.today().year, 1, 1))
        ytd_df = df[df["date"] >= year_start]
        if ytd_df.empty:
            return None
        return float((1 + ytd_df["daily_return"]).prod() - 1)

    def compute_sharpe(
        self, risk_free_rate: float = 0.0, periods: int = 252
    ) -> float | None:
        """Annualized Sharpe ratio.

        Matches ``qs.stats.sharpe(returns, periods=252)`` within ±0.05
        (Assumption A2 verified by ``scripts/probe-quantstats-version.sh``).
        """
        df = self.to_equity_curve_daily()
        if df.empty or len(df) < 2:
            return None
        returns = df["daily_return"]
        excess = returns - (risk_free_rate / periods)
        std = excess.std()
        if std == 0 or _phase19_math.isnan(std):
            return None
        return float((excess.mean() / std) * (periods ** 0.5))

    def compute_max_drawdown(self) -> float | None:
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        equity = df["equity"]
        running_max = equity.cummax()
        # Replace zero peaks with 1.0 to avoid divide-by-zero on day 1.
        denom = running_max.replace(0, 1.0)
        dd = (equity - running_max) / denom
        return float(dd.min())

    # ------------------------------------------------------------------
    # MetricsSnapshot composition
    # ------------------------------------------------------------------

    def to_metrics_snapshot(self):
        """Compose into a services.ingestion.adapter.MetricsSnapshot."""
        from services.ingestion.adapter import MetricsSnapshot

        positions = self.reconstruct_positions()
        closed = [p for p in positions if p.status == "closed"]
        wins = [
            p for p in closed if p.pnl is not None and p.pnl > 0
        ]
        win_rate = (len(wins) / len(closed)) if closed else None
        total_pnl = sum(
            float(p.pnl or 0.0) for p in closed
        ) + sum(self._funding_pnl_by_day.values())

        return MetricsSnapshot(
            sharpe=self.compute_sharpe(),
            twr=self.compute_twr(),
            ytd=self.compute_ytd(),
            max_drawdown=self.compute_max_drawdown(),
            total_pnl=float(total_pnl),
            trade_count=len(self.trades),
            win_rate=win_rate,
        )


def _phase19_position_dict_to_kwargs(p: dict) -> dict:
    """Map ``_match_positions_fifo`` output dict → ``Position`` dataclass kwargs.

    ``_match_positions_fifo`` keys (verified):
      strategy_id, symbol, side ("long"/"short"), status ("open"/"closed"),
      entry_price_avg, exit_price_avg, size_base, size_peak, realized_pnl,
      fee_total, roi, duration_days, opened_at (str|None),
      closed_at (str|None), fill_count, funding_pnl, [unrealized_pnl, mark_price]

    ``Position`` fields:
      strategy_id, symbol, side, opened_at (datetime), closed_at (datetime|None),
      entry_price, exit_price, quantity, pnl, funding_pnl, status, roi,
      duration_days
    """
    def _parse_dt(value):
        if value is None:
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except (ValueError, TypeError):
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    opened_at_dt = _parse_dt(p.get("opened_at")) or datetime.now(timezone.utc)
    closed_at_dt = _parse_dt(p.get("closed_at"))

    pnl_value: float | None
    if p.get("status") == "open":
        pnl_value = p.get("unrealized_pnl")
        if pnl_value is not None:
            pnl_value = float(pnl_value)
    else:
        rp = p.get("realized_pnl")
        pnl_value = float(rp) if rp is not None else None

    return {
        "strategy_id": p.get("strategy_id", "<in-memory>"),
        "symbol": p.get("symbol", ""),
        "side": p.get("side", ""),
        "opened_at": opened_at_dt,
        "closed_at": closed_at_dt,
        "entry_price": float(p.get("entry_price_avg") or 0.0),
        "exit_price": (
            float(p["exit_price_avg"])
            if p.get("exit_price_avg") is not None
            else None
        ),
        "quantity": float(p.get("size_base") or 0.0),
        "pnl": pnl_value,
        "funding_pnl": (
            float(p["funding_pnl"])
            if p.get("funding_pnl") is not None
            else None
        ),
        "status": p.get("status", "closed"),
        "roi": (
            float(p["roi"]) if p.get("roi") is not None else None
        ),
        "duration_days": (
            float(p["duration_days"])
            if p.get("duration_days") is not None
            else None
        ),
    }
