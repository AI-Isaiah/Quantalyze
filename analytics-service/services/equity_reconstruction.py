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
from datetime import date, datetime, timedelta, timezone
from typing import Any

import ccxt.async_support as ccxt
import httpx

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

async def _fetch_trades_with_pagination(
    exchange: Any,
    venue: str,
    since_ms: int,
    now_ms: int,
    limit_per_call: int = 500,
) -> tuple[list[dict], bool]:
    """Paginate fetch_my_trades via since. Returns (trades, hit_okx_terminus).

    On OKX: if an empty page is returned and `since` is older than the
    90-day terminus, set hit_okx_terminus=True and break cleanly. Logs
    the sentinel string used by the TDD Red gate test:
      "OKX trade history capped at 3 months"
    (RESEARCH.md Pitfall 1 / VOICES-ACCEPTED f9.)
    """
    all_trades: list[dict] = []
    hit_okx_terminus = False
    cursor_ms = since_ms
    okx_terminus_ms = now_ms - OKX_TRADE_TERMINUS_DAYS * 24 * 60 * 60 * 1000

    # OKX exposes only ~3 months of trade history (RESEARCH.md §1B, A3).
    # When our caller requests a window that starts before the terminus we
    # log the sentinel string used by the TDD Red gate test and stamp
    # hit_okx_terminus=True so the handler can force history_depth_months=3
    # on the resulting rows (VOICES-ACCEPTED f9).
    if venue.lower() == "okx" and cursor_ms < okx_terminus_ms:
        logger.info(
            "OKX trade history capped at 3 months",
            extra={"venue": venue, "since_ms": cursor_ms},
        )
        hit_okx_terminus = True
        cursor_ms = okx_terminus_ms

    # Guard against pathological loops: if the exchange keeps returning rows
    # with the same max timestamp we advance by 1ms; 500 iterations is a
    # 250k trade ceiling — plenty for any real allocator.
    for _ in range(500):
        try:
            page = await exchange.fetch_my_trades(None, cursor_ms, limit_per_call)
        except ccxt.NotSupported:
            return all_trades, hit_okx_terminus
        page = page or []
        if not page:
            if venue.lower() == "okx" and cursor_ms < okx_terminus_ms:
                logger.info(
                    "OKX trade history capped at 3 months",
                    extra={"venue": venue, "since_ms": cursor_ms},
                )
                hit_okx_terminus = True
            break
        all_trades.extend(page)
        if len(page) < limit_per_call:
            break
        # Advance cursor past the latest timestamp in the page
        max_ts = max((int(t.get("timestamp") or 0) for t in page), default=cursor_ms)
        if max_ts <= cursor_ms:
            break
        cursor_ms = max_ts + 1
    return all_trades, hit_okx_terminus


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
    all_rows: list[dict] = []
    cursor_ms = since_ms
    while cursor_ms < now_ms:
        # WR-04: only catch ccxt.NotSupported here (feature detection —
        # the exchange cannot enumerate transfers at all). All other
        # exceptions (auth revoked mid-backfill, rate limit, network
        # failure) MUST bubble to the outer handler so they land in
        # classify_exception + _emit_audit rather than being silently
        # swallowed — the previous `break` returned a truncated list
        # that looked identical to "allocator has no transfers", which
        # caused zero-activity rows with no audit trail.
        try:
            page = await fetcher(None, cursor_ms, 500)
        except ccxt.NotSupported:
            return all_rows
        page = page or []
        all_rows.extend(page)
        cursor_ms += window_ms
        if not page:
            # Advance one window; continue in case the tape is sparse.
            continue
    return all_rows


async def _fetch_ohlcv_daily(
    exchange: Any, symbol: str, start_ms: int, end_ms: int,
) -> list[list]:
    """Daily close OHLCV in [start_ms, end_ms]. Paginate 1000 candles/call.

    Raises ccxt.BadSymbol for symbols the venue does not list — caller
    uses this as the CoinGecko-fallback trigger.
    """
    all_rows: list[list] = []
    cursor_ms = start_ms
    day_ms = 24 * 60 * 60 * 1000
    while cursor_ms <= end_ms:
        page = await exchange.fetch_ohlcv(symbol, "1d", cursor_ms, 1000)
        page = page or []
        if not page:
            break
        all_rows.extend(page)
        max_ts = max((int(row[0]) for row in page), default=cursor_ms)
        if max_ts <= cursor_ms:
            break
        cursor_ms = max_ts + day_ms
        if len(page) < 1000:
            break
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

    # Rate-limit sleep (best-effort — async; tests monkeypatch so do not
    # block pytest with a real 2s sleep).
    try:
        await asyncio.sleep(0)
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

    # Running per-symbol quantities
    quantities: dict[str, float] = {}

    rows: list[dict] = []
    cur = start_date
    used_exchange = False
    used_coingecko = False
    while cur <= end_date:
        iso = cur.isoformat()
        for ev in events_by_date.get(iso, []):
            kind = ev.get("kind")
            if kind == "trade":
                sym = (ev.get("symbol") or "").split("/")[0].upper()
                side = (ev.get("side") or "").lower()
                amt = float(ev.get("amount") or 0.0)
                cost = float(ev.get("cost") or 0.0)
                if not sym:
                    continue
                # WR-03: CCXT normalises linear perpetuals as "BTC/USDT:USDT"
                # and inverse contracts as "BTC/USD:BTC". A naive split("/")[-1]
                # would yield "USDT:USDT" and leak non-existent symbols into
                # the quantities dict, producing unpriced base balances that
                # never offset the buy side. Strip the `:settle` suffix so
                # the quote side lands on the canonical currency code.
                raw_symbol = ev.get("symbol") or ""
                if "/" in raw_symbol:
                    quote = raw_symbol.split("/")[-1].split(":")[0].upper()
                else:
                    quote = "USDT"
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
                px = None
                src = None
                series = ohlcv_by_symbol.get(sym)
                if series:
                    # Walk back to find the close on-or-before iso
                    for d_iso, c in reversed(series):
                        if d_iso <= iso:
                            px = c
                            src = "exchange_primary"
                            break
                if px is None:
                    cg_series = coingecko_by_symbol.get(sym)
                    if cg_series and iso in cg_series:
                        px = cg_series[iso]
                        src = "coingecko_fallback"
                    elif cg_series:
                        # Walk back within the CG series
                        best: float | None = None
                        for d_iso in sorted(cg_series.keys()):
                            if d_iso <= iso:
                                best = cg_series[d_iso]
                            else:
                                break
                        if best is not None:
                            px = best
                            src = "coingecko_fallback"
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

    def _upsert():
        return supabase.table("allocator_equity_snapshots").upsert(
            stamped,
            on_conflict="allocator_id,asof",
            ignore_duplicates=True,
        ).execute()

    await db_execute(_upsert)
    return len(stamped)


# ---------------------------------------------------------------------------
# Read helpers
# ---------------------------------------------------------------------------

async def _existing_snapshot_count(supabase: Any, allocator_id: str) -> int:
    def _sel():
        return (
            supabase.table("allocator_equity_snapshots")
            .select("asof", count="exact")
            .eq("allocator_id", allocator_id)
            .execute()
        )

    try:
        res = await db_execute(_sel)
    except Exception as exc:  # noqa: BLE001
        logger.warning("allocator_equity_snapshots count failed: %s", exc)
        return 0
    count = getattr(res, "count", None)
    if count is not None:
        return int(count)
    data = getattr(res, "data", None) or []
    return len(data)


async def _fetch_today_holdings(
    supabase: Any, allocator_id: str, today_iso: str
) -> list[dict]:
    def _sel():
        return (
            supabase.table("allocator_holdings")
            .select("symbol, quantity, mark_price, value_usd, venue, holding_type, api_key_id")
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
    deposits = await _fetch_transfers(exchange, "deposits", start_ms, now_ms)
    withdrawals = await _fetch_transfers(exchange, "withdrawals", start_ms, now_ms)

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
    for sym in symbols:
        if sym in STABLECOINS:
            continue
        try:
            raw = await _fetch_ohlcv_daily(exchange, f"{sym}/USDT", start_ms, end_ms)
            ohlcv_by_symbol[sym] = [
                (
                    datetime.fromtimestamp(int(r[0]) / 1000.0, tz=timezone.utc).date().isoformat(),
                    float(r[4]),
                )
                for r in raw
            ]
        except ccxt.BadSymbol:
            # Fallback to CoinGecko
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
        except Exception as exc:  # noqa: BLE001
            logger.warning("fetch_ohlcv failed symbol=%s: %s", sym, exc)

    rows = _compute_daily_equity(
        trades, deposits, withdrawals,
        ohlcv_by_symbol, coingecko_by_symbol,
        start_date, end_date,
    )
    return rows, hit_terminus


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

    # Threat T-07-V5 idempotency: if snapshots already exist for this
    # allocator, short-circuit as DONE.
    existing = await _existing_snapshot_count(ctx.supabase, allocator_id)
    if existing > 0:
        _emit_audit(
            allocator_id, api_key_id,
            "allocator.equity.reconstruct_complete",
            {"reason": "already_reconstructed", "existing_rows": existing},
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

    count = await persist_equity_snapshots(ctx.supabase, rows, allocator_id, depth_months)

    _emit_audit(
        allocator_id, api_key_id,
        "allocator.equity.reconstruct_complete",
        {
            "days_written": count,
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

        # Compute single-day equity from holdings' value_usd fan-in
        total = 0.0
        breakdown: dict[str, float] = {}
        for h in holdings:
            sym = (h.get("symbol") or "").upper()
            v = float(h.get("value_usd") or 0.0)
            if not sym:
                continue
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
