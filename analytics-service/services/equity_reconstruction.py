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
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

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

if TYPE_CHECKING:
    from services.ingestion.adapter import MetricsSnapshot, Position

logger = logging.getLogger("quantalyze.analytics.equity_reconstruction")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

STABLECOINS: set[str] = {"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"}
# Pre-sorted longest-first so the holdings.symbol splitter picks
# USDC/BUSD/etc before USD, avoiding false-positive substring matches.
_STABLECOINS_LONGEST_FIRST: tuple[str, ...] = tuple(
    sorted(STABLECOINS, key=len, reverse=True)
)
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
# instruments?instType=SWAP` on 2026-04-24. Stamp the verification date
# in a module-level constant so a future drift audit can spot the table
# going stale (see M-1024).
OKX_CTVAL_LAST_VERIFIED_AT: str = "2026-04-24"

# Magic-number → named constant. 5% disagreement between cost/price and
# the explicit ctVal table is the threshold for "ccxt's safe_trade
# silently dropped contractSize." Below 5% the two paths agree closely
# enough that the cost/price branch wins (fixture compat). Above the
# threshold we trust the table. See M-1024 / M-1031 / M-1032.
PERP_AMT_CTVAL_DIVERGENCE_THRESHOLD: float = 0.05
# Soft-warn band: between 1% and the hard threshold we still pick
# cost/price but emit an audit signal so table-drift surfaces before
# the curve goes visibly wrong.
PERP_AMT_CTVAL_DRIFT_WARN_THRESHOLD: float = 0.01

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


# Per-symbol ctVal map for OKX expiring FUTURES (instType=FUTURES). OKX
# quarterly futures use the same ctVal as their SWAP counterparts (BTC
# 0.01, ETH 0.1, etc — verified against OKX public instruments endpoint
# 2026-04-24). The original v0.15.4.x defensive override gated on
# instType=='SWAP' ONLY, so FUTURES fills silently reverted to the
# cost/price path and re-opened the v0.15.4.0 100x inflation bug for
# any user trading dated futures. See C-0327 / H-1158.
OKX_FUTURES_CONTRACT_SIZE: dict[str, float] = dict(OKX_PERP_CONTRACT_SIZE)

# Linear-perp instTypes that participate in the defensive ctVal override.
# Both SWAP (perpetual) and FUTURES (expiring) use the same ctVal scale
# on OKX, and ccxt's symbol shape catches both via `:`-in-raw_symbol.
_OKX_LINEAR_INST_TYPES: frozenset[str] = frozenset({"SWAP", "FUTURES"})


class _PerpAmtSource:
    """String enum for _resolve_perp_amt_base provenance.

    Kept as a plain class with string class-vars so it stays cheap to
    log/serialise into audit metadata, while giving callers a typed
    constant to compare against (vs raw string literals). See M-1032.
    """

    COST_DIV_PRICE: str = "cost_div_price"
    CTVAL_TABLE: str = "ctval_table"
    FALLBACK_AMOUNT: str = "fallback_amount"
    INVERSE_UNSUPPORTED: str = "inverse_unsupported"


@dataclass(frozen=True)
class PerpPosition:
    """Signed perp position state during the equity replay (H-1167).

    Replaces the prior anemic ``dict[str, dict[str, float]]`` model whose
    load-bearing invariant — ``size == 0`` MUST imply ``avg_entry == 0`` and
    vice versa — was enforced only by prose comments and a defensive runtime
    guard at the mark-to-market loop. ``size`` is signed (+ve long, -ve short);
    ``avg_entry`` is the weighted-avg fill price of the currently-open lot.

    ``frozen=True`` forbids in-place mutation, so the only way to change a
    position is to construct a NEW instance — which re-runs ``__post_init__``.
    Together they make the flat-position invariant truly unrepresentable: a
    refactor that tried to set ``size`` to 0 without zeroing ``avg_entry`` (or
    vice versa) raises — ``FrozenInstanceError`` on the attempted mutation, or
    ``ValueError`` from ``__post_init__`` on construction — instead of silently
    leaving a ghost mark on a closed position. ``mark`` centralises the
    "return 0.0 when flat" rule the mark loop previously open-coded.

    NOTE: this changes NO persisted output — the replay rows
    (``_compute_daily_equity`` return value) are byte-for-byte identical.
    The class is local to this module's replay; nothing in production imports
    it (only the unit test does).
    """

    size: float = 0.0
    avg_entry: float = 0.0

    def __post_init__(self) -> None:
        # Float equality against 0.0 is intentional: every branch in the
        # replay assigns an exact 0.0 (not a computed near-zero) when it
        # means "flat", so this catches the invariant violation without
        # tripping on legitimate tiny-but-open positions.
        if (self.size == 0.0) != (self.avg_entry == 0.0):
            raise ValueError(
                "PerpPosition invariant violated: size and avg_entry must be "
                f"zero together (got size={self.size!r}, "
                f"avg_entry={self.avg_entry!r})"
            )

    def mark(self, price: float) -> float:
        """Unrealised PnL of this position marked at ``price``.

        Returns ``0.0`` when flat (size == 0 ⇒ avg_entry == 0 by invariant),
        so the caller no longer needs the ``if size == 0.0 or avg_entry ==
        0.0: continue`` guard to suppress a ghost mark.
        """
        if self.size == 0.0:
            return 0.0
        return self.size * (price - self.avg_entry)


def _is_inverse_perp(raw_symbol: str) -> bool:
    """OKX/Bybit inverse perps use BTC/USD:BTC (settle ccy == base ccy).

    Linear perps settle in the quote currency (USDT), so the suffix
    after `:` is the quote, e.g. BTC/USDT:USDT. Inverse contracts
    settle in the base currency (the coin itself), so the suffix is
    the base — BTC/USD:BTC, ETH/USD:ETH. See C-0326.
    """
    if "/" not in raw_symbol or ":" not in raw_symbol:
        return False
    head, settle = raw_symbol.split(":", 1)
    base = head.split("/")[0].upper()
    return settle.split("-")[0].upper() == base  # tolerate FUTURES suffix


def breakdown_key_for_perp(base: str, quote: str) -> str:
    """Single source of truth for the perp breakdown key shape.

    Both production paths (reconstruct + refresh) write derivative
    contributions into ``allocator_equity_snapshots.breakdown`` under
    this canonical 3-part key. Pre-fix the refresh path emitted
    ``{symbol}:PERP`` while reconstruct emitted ``{BASE}:{QUOTE}:PERP``,
    so the same logical position appeared under TWO different keys
    depending on which path produced the row (H-1157 / H-1165 / H-1169).
    Centralising the format eliminates the schema fork.
    """
    return f"{base.upper()}:{quote.upper()}:PERP"


def split_holdings_symbol_to_base_quote(symbol: str) -> tuple[str, str]:
    """Best-effort split of a raw ``allocator_holdings.symbol`` value
    (e.g. ``"ETHUSDT"``) into its base + quote components.

    The refresh job receives un-normalised symbols from the positions
    poller (allocator_positions.py stores them stripped — no ``/``).
    For the canonical PERP breakdown key we need both pieces. We match
    against the same stablecoin set used elsewhere, scanning longest-
    first so ``USDC`` doesn't accidentally swallow ``USDCETH`` shape
    inputs. Returns ``(symbol_upper, "USDT")`` as a safe fallback when
    no known stablecoin suffix is found, matching the legacy assumption
    that perp settle ccy defaults to USDT.
    """
    s = (symbol or "").upper()
    if not s:
        return "", "USDT"
    for q in _STABLECOINS_LONGEST_FIRST:
        if s.endswith(q) and len(s) > len(q):
            return s[: -len(q)], q
    return s, "USDT"


def _resolve_perp_amt_base(
    raw_symbol: str, amount: float, price: float, cost: float,
    inst_type: str | None = None,
    venue: str | None = None,
) -> tuple[float, str, float | None]:
    """Recover base-unit trade size for a perpetual or expiring future.

    Returns ``(amt_base, source, relative_err)``. ``source`` records
    which branch produced the value (see ``_PerpAmtSource``).
    ``relative_err`` is the cost/price-vs-ctval_table disagreement when
    both are known, else None. Inverse contracts short-circuit with
    source=``INVERSE_UNSUPPORTED`` and ``amt_base=0`` so the caller can
    audit-and-skip rather than corrupting state with a wrong amt.

    Prefers ``cost / price`` when cost is trustworthy (i.e. ccxt's
    safe_trade did apply contractSize). Falls back to the explicit
    OKX_PERP_CONTRACT_SIZE / OKX_FUTURES_CONTRACT_SIZE table whenever
    the two disagree by more than 5% — that's the signal safe_trade
    didn't have a market with contractSize available and returned
    ``cost = amount × price``, which would silently leak contract
    counts into the replay state.

    The defensive override fires for real OKX SWAP **and** FUTURES
    fills (both stamp ``info.instType``). Earlier revisions gated on
    SWAP only and re-opened the 100x inflation bug for any user
    trading expiring futures — see C-0327. Synthetic test fixtures
    without ``info.instType`` keep the legacy cost/price path
    (contractSize=1 implicit), so they aren't bitten by the symbol
    collision with the ctVal table.

    Inverse contracts (BTC/USD:BTC) settle in the base currency, so
    ccxt reports ``cost`` in BASE units, not quote. ``cost / price``
    is meaningless for inverse — see C-0326. We refuse to guess and
    raise/return a sentinel source so the caller surfaces the missing
    coverage rather than letting a silently-wrong amt_base poison the
    replay.

    Venue gating (H-1158 / M-1022): the OKX_PERP_CONTRACT_SIZE table
    is OKX-specific. Bybit V5 unified-margin payloads also stamp
    instType=SWAP, so the lookup must be gated on venue=='okx' to
    avoid applying OKX ctVal values to a Bybit trade where the
    contract scale may differ.

    Backward-compatible for fixtures that pass cost = amount × price
    (contractSize = 1 implicit): cost/price == amount, inst_type is
    None, we return ``(amount, COST_DIV_PRICE, None)``.
    """
    if price <= 0:
        # Caller already skips this path; return amount with no
        # provenance signal.
        return amount, _PerpAmtSource.FALLBACK_AMOUNT, None

    # Inverse perps need a separate cost-handling rule. Return the
    # INVERSE_UNSUPPORTED sentinel so the replay loop can audit the
    # skip rather than silently corrupting position state with cost/price
    # values denominated in the wrong currency.
    if _is_inverse_perp(raw_symbol):
        return 0.0, _PerpAmtSource.INVERSE_UNSUPPORTED, None

    amt_from_cost = (cost / price) if cost > 0 else amount

    # Only apply the defensive override for REAL OKX SWAP/FUTURES fills.
    # Synthetic fixtures without info.instType stay on the legacy
    # cost/price path. Bybit fills (venue!='okx') also bypass the table
    # even when instType reads SWAP — OKX's ctVal table doesn't generalise.
    if not inst_type or str(inst_type).upper() not in _OKX_LINEAR_INST_TYPES:
        return amt_from_cost, _PerpAmtSource.COST_DIV_PRICE, None
    if venue is not None and str(venue).lower() != "okx":
        return amt_from_cost, _PerpAmtSource.COST_DIV_PRICE, None

    if str(inst_type).upper() == "FUTURES":
        ctval = OKX_FUTURES_CONTRACT_SIZE.get(raw_symbol)
        if ctval is None:
            # Strip optional `-YYMMDD` suffix that ccxt appends to dated
            # futures (BTC/USDT:USDT-251226) before lookup.
            base_key = raw_symbol.split("-", 1)[0]
            ctval = OKX_FUTURES_CONTRACT_SIZE.get(base_key)
    else:
        ctval = OKX_PERP_CONTRACT_SIZE.get(raw_symbol)

    if ctval is None:
        # No defensive cover — caller should audit this as an unknown
        # perp. See C-0329.
        return amt_from_cost, _PerpAmtSource.COST_DIV_PRICE, None
    amt_explicit = amount * ctval
    if amt_explicit <= 0:
        return amt_from_cost, _PerpAmtSource.COST_DIV_PRICE, None
    relative_err = abs(amt_from_cost - amt_explicit) / amt_explicit
    if relative_err > PERP_AMT_CTVAL_DIVERGENCE_THRESHOLD:
        return amt_explicit, _PerpAmtSource.CTVAL_TABLE, relative_err
    return amt_from_cost, _PerpAmtSource.COST_DIV_PRICE, relative_err


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

    M-1030: narrow the swallow to ``TypeError``/``ValueError`` so
    ``asyncio.CancelledError`` (which subclasses ``BaseException`` on
    3.8+, but inherits from ``Exception`` on older interpreters) is
    NOT caught — workers that hit SIGTERM mid-sleep must propagate
    the cancellation so kubectl rollouts don't stall on a stuck loop.
    """
    ms = getattr(exchange, "rateLimit", None)
    if not isinstance(ms, (int, float)) or ms <= 0:
        return
    try:
        await asyncio.sleep(float(ms) / 1000.0)
    except (TypeError, ValueError) as exc:  # pragma: no cover
        logger.warning("_rate_limit_sleep skipped: %s", exc)


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
    # Narrow swallow (M-1030 sibling): CancelledError must propagate so
    # workers honour SIGTERM mid-throttle.
    try:
        await asyncio.sleep(COINGECKO_MIN_SLEEP_SECS)
    except (TypeError, ValueError) as exc:  # pragma: no cover
        # SPEC-SFH-2 (specialist apply 2026-05-16): match the
        # symmetric handler in ``_rate_limit_sleep`` — both narrowed
        # swallows should log so a future reader can grep the same
        # signal, rather than one path silently dropping.
        logger.warning("coingecko throttle sleep skipped: %s", exc)

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
    venue: str | None = None,
    skipped_symbols: set[str] | None = None,
    unknown_perp_symbols: set[str] | None = None,
    inverse_perp_symbols: set[str] | None = None,
    ctval_drift_warnings: list[dict] | None = None,
) -> list[dict]:
    """Replay trades + transfers forward; mark each day by close × quantity.

    Returns rows with { asof, value_usd, breakdown, source }. `source` is
    'exchange_primary' if all symbols priced from exchange OHLCV;
    'coingecko_fallback' if ALL pricing came from CoinGecko;
    'mixed' if partial.

    Optional out-parameter sets/lists (``skipped_symbols``,
    ``unknown_perp_symbols``, ``inverse_perp_symbols``,
    ``ctval_drift_warnings``) collect observability signals across the
    replay so the caller can surface them in ``reconstruct_complete``
    audit metadata — closing the silent-skip gaps C-0330, C-0329,
    C-0326, and M-1024.

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
    # H-1167: PerpPosition enforces the size==0 ⟺ avg_entry==0 invariant.
    perp_positions: dict[str, PerpPosition] = {}

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
                    amt_base, amt_src, drift = _resolve_perp_amt_base(
                        raw_symbol, amt, price, cost,
                        inst_type=inst_type, venue=venue,
                    )
                    # Surface observability for the silent-fallback edge cases
                    # the v0.15.4.x audit chain identified as load-bearing.
                    if amt_src == _PerpAmtSource.INVERSE_UNSUPPORTED:
                        # C-0326: inverse perp cost field is BASE-denominated;
                        # cost/price returns a wrong number. Skip the fill
                        # and let the audit surface the unsupported coverage
                        # rather than silently corrupting position state.
                        if inverse_perp_symbols is not None:
                            inverse_perp_symbols.add(raw_symbol)
                        logger.warning(
                            "equity_reconstruction: skipping inverse perp fill "
                            "(unsupported cost shape) venue=%s symbol=%s amount=%s",
                            venue, raw_symbol, amt,
                        )
                        continue
                    if (
                        amt_src == _PerpAmtSource.COST_DIV_PRICE
                        and inst_type
                        and str(inst_type).upper() in _OKX_LINEAR_INST_TYPES
                        and (venue is None or str(venue).lower() == "okx")
                        and drift is None
                    ):
                        # C-0329: OKX SWAP/FUTURES fill that DIDN'T match
                        # the ctVal table at all. The v0.15.4.2 narrative
                        # explicitly flags this as the silent-inflation
                        # path. Record it so the audit log surfaces the
                        # coverage gap.
                        if unknown_perp_symbols is not None:
                            unknown_perp_symbols.add(raw_symbol)
                        logger.warning(
                            "equity_reconstruction: OKX %s symbol %s missing from "
                            "OKX_PERP/FUTURES_CONTRACT_SIZE — falling back to "
                            "cost/price, which can leak contract counts if "
                            "ccxt failed to apply contractSize",
                            inst_type, raw_symbol,
                        )
                    if (
                        drift is not None
                        and drift > PERP_AMT_CTVAL_DRIFT_WARN_THRESHOLD
                        and drift <= PERP_AMT_CTVAL_DIVERGENCE_THRESHOLD
                        and ctval_drift_warnings is not None
                    ):
                        # M-1024 / M-1031: cost/price and table agree
                        # closely but not exactly. Surface the divergence
                        # before it crosses the hard 5% threshold so a
                        # stale ctVal entry shows up before the curve does.
                        ctval_drift_warnings.append({
                            "raw_symbol": raw_symbol,
                            "venue": venue,
                            "inst_type": inst_type,
                            "relative_err": round(drift, 4),
                            "amt_source": amt_src,
                        })
                    signed = amt_base if side == "buy" else -amt_base
                    pos = perp_positions.get(raw_symbol) or PerpPosition()
                    cur_size = pos.size
                    cur_avg = pos.avg_entry
                    # H-1167: each branch computes the FINAL (size, avg_entry)
                    # pair and constructs a fresh PerpPosition so the
                    # __post_init__ invariant check fires on every transition,
                    # rather than mutating attributes in place (which would
                    # skip validation). Arithmetic is unchanged from the prior
                    # dict-mutation version.
                    if cur_size == 0.0 or (cur_size > 0) == (signed > 0):
                        # Open new or increase same-direction. Avg entry is
                        # weighted by contract size, not by notional value —
                        # that keeps avg_entry a true price independent of
                        # how leverage is recorded on the venue.
                        new_size = cur_size + signed
                        if new_size != 0.0:
                            new_avg = (cur_size * cur_avg + signed * price) / new_size
                        else:
                            new_avg = 0.0
                        pos = PerpPosition(size=new_size, avg_entry=new_avg)
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
                                pos = PerpPosition(
                                    size=(1.0 if signed > 0 else -1.0) * remainder,
                                    avg_entry=price,
                                )
                            else:
                                pos = PerpPosition()
                        else:
                            # Partial close: avg_entry is unchanged on the
                            # remaining lot (the fills that are still open
                            # were always filled at `cur_avg`).
                            pos = PerpPosition(
                                size=cur_size + signed, avg_entry=cur_avg
                            )
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
                    # C-0330: skipping a symbol because of an OHLCV gap is
                    # NOT the same as the symbol having no position. Surface
                    # the skip via the caller-supplied set so the audit log
                    # can distinguish "every symbol had a price gap" from
                    # "truly empty replay" — without the signal a missing
                    # OHLCV day silently mimics the v0.15.3.x V-shape bug.
                    if skipped_symbols is not None:
                        skipped_symbols.add(sym)
                    continue
            usd = qty * px
            breakdown[sym] = round(usd, 2)
            total += usd
            if src == "exchange_primary":
                used_exchange = True
            elif src == "coingecko_fallback":
                used_coingecko = True

        # Mark open perp positions to the day's close. Unrealised PnL rolls
        # into total_usd and is attributed in the breakdown under the
        # canonical ``BASE:QUOTE:PERP`` key (see ``breakdown_key_for_perp``)
        # so it doesn't collide with a spot holding of the same base
        # currency and matches the refresh-path key shape (H-1157 / H-1165).
        for perp_sym, pos in perp_positions.items():
            # H-1167: invariant guarantees size==0 ⟺ avg_entry==0, so the
            # single flat-check below subsumes the prior two-field guard.
            # Keep it BEFORE _price_on so a flat position doesn't pollute
            # skipped_symbols on an OHLCV gap.
            if pos.size == 0.0:
                continue
            base = perp_sym.split("/")[0].upper()
            quote_sym = (
                perp_sym.split("/")[-1].split(":")[0].upper()
                if "/" in perp_sym else "USDT"
            )
            px, src = _price_on(base, iso)
            if px is None:
                # C-0330: same symbol-skip surfacing applies to perp marks.
                if skipped_symbols is not None:
                    skipped_symbols.add(base)
                continue
            unrealized = pos.mark(px)
            if unrealized == 0.0:
                continue
            key = breakdown_key_for_perp(base, quote_sym)
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


def _result_row_count(res: Any) -> int:
    """Return the row count from a supabase-py upsert/delete result.

    Prefers ``res.count`` when present (postgrest returns it when the
    request asked for ``count='exact'`` or ``Prefer: count=exact``).
    Falls back to ``len(res.data)`` for backwards compat with code
    paths that don't request an explicit count (the supabase-py
    upsert builder doesn't currently expose ``count=`` kwargs, and
    delete builders only return data under
    ``Prefer: return=representation``).

    Either signal collapses to zero on a clean DO-NOTHING upsert or a
    no-row delete, which is what the audit-log contract demands —
    pre-fix code returned ``len(stamped)`` unconditionally and made
    the audit log lie about ``days_written`` (PR #68 / H-1159).
    """
    count = getattr(res, "count", None)
    # ``isinstance(False, int)`` is True in Python; explicitly exclude
    # bool so a stray False from a mock doesn't masquerade as count=0.
    if isinstance(count, int) and not isinstance(count, bool):
        return max(0, count)
    data = getattr(res, "data", None) or []
    return len(data)


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
    #
    # /investigate 2026-05-15 (H-1159 / M-1025): prefer `res.count` when
    # PostgREST returns it (we'd ideally request count='exact' but
    # supabase-py doesn't accept that on the upsert builder, so we
    # opportunistically use `count` if present and fall back to
    # `len(data)`). Either signal collapses to zero on a clean DO-NOTHING
    # so the audit-log contract holds.
    res = await db_execute(_upsert)
    return _result_row_count(res)


class SiblingCheckResult:
    """Tri-state result of ``_allocator_has_other_api_keys`` (M-1027).

    The boolean ``has_siblings`` is what the caller's purge gate
    actually reads, so existing call sites continue to work via
    ``bool(result)``. ``lookup_failed`` distinguishes the fail-safe
    'pretend has siblings' state from a confirmed empty sibling set,
    which we surface to the audit log so a transient DB outage doesn't
    look like a healthy multi-key allocator.
    """

    __slots__ = ("has_siblings", "lookup_failed", "error_message")

    def __init__(
        self,
        has_siblings: bool,
        lookup_failed: bool = False,
        error_message: str | None = None,
    ) -> None:
        self.has_siblings = has_siblings
        self.lookup_failed = lookup_failed
        self.error_message = error_message

    def __bool__(self) -> bool:
        return self.has_siblings


async def _allocator_has_other_api_keys(
    supabase: Any, allocator_id: str, api_key_id: str,
) -> SiblingCheckResult:
    """Does this allocator own any CONNECTED, ACTIVE api_keys OTHER than
    `api_key_id`?

    The reconstruction-upsert path uses ON CONFLICT DO NOTHING to protect
    multi-key aggregation (threat T-07-V5b) — the first key to land for a
    given (allocator, asof) wins; subsequent keys are benign no-ops. That
    invariant is load-bearing when multiple keys contribute, but it traps
    single-key users whose snapshots are stale (e.g. pre-v0.15.3.0 buggy
    perp replay, or orphans from a deleted key). When this key is the
    allocator's sole authoritative source, the fresh reconstruct should
    own the series outright.

    Soft-disconnected keys (migration 075: disconnected_at IS NOT NULL),
    deactivated keys (is_active = false), and revoked keys
    (sync_status = 'revoked') MUST be excluded from the sibling count.
    Their rows persist in api_keys for audit continuity, but the worker
    stopped syncing them, so they cannot produce new snapshots. Counting
    them as siblings re-opens the "I uploaded a fresh key but my stale
    V-shaped curve persists" trap that v0.15.3.3 was meant to close.
    Mirrors the worker-dispatch filter in migration 075 byte-for-byte —
    enqueue_poll_allocator_positions_for_all_keys (line 193-196) and
    enqueue_refresh_allocator_equity_for_all (line 244-248) both filter
    ``WHERE is_active = true AND sync_status IS DISTINCT FROM 'revoked'
    AND disconnected_at IS NULL``. See H-1162 / H-1164.

    api_keys has FK cascade to compute_jobs (migration 066 STEP 2) — if a
    prior key was hard-deleted, its api_keys row is gone. So checking
    connected api_keys presence is a sufficient proxy for "are there
    OTHER keys whose data we must not clobber".

    Returns ``SiblingCheckResult``. ``bool(result)`` is True when at
    least one connected sibling exists OR when the lookup raised
    (fail-safe: preserve DO NOTHING rather than risk wiping legitimate
    multi-key data on a transient read error). ``.lookup_failed`` is
    True in the second case so the caller can audit the latch.
    """
    def _sel():
        return (
            supabase.table("api_keys")
            .select("id", count="exact", head=True)
            .eq("user_id", allocator_id)
            .neq("id", api_key_id)
            .eq("is_active", True)
            .neq("sync_status", "revoked")
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
        return SiblingCheckResult(
            has_siblings=True,
            lookup_failed=True,
            error_message=str(exc)[:300],
        )
    count = getattr(res, "count", None)
    if count is not None:
        return SiblingCheckResult(has_siblings=int(count) > 0)
    data = getattr(res, "data", None) or []
    return SiblingCheckResult(has_siblings=len(data) > 0)


async def _purge_allocator_equity_snapshots(
    supabase: Any, allocator_id: str,
) -> int:
    """Delete every allocator_equity_snapshots row for this allocator.

    Called only from the sole-key reconstruction path (see caller). Returns
    the number of rows deleted for audit-log surfacing. Failures bubble so
    the handler's outer except-block classifies + records them rather than
    silently proceeding with a polluted upsert.

    /investigate 2026-05-15 (H-1166 / M-1033): supabase-py's
    ``.delete().execute()`` defaults to ``Prefer: return=representation``
    so ``data`` lists the deleted rows under normal operation, but the
    list is bounded by PostgREST's response-size limits and can flip to
    empty on older client versions. Use ``_result_row_count`` so the
    audit log doesn't silently report ``stale_snapshots_purged=0`` when
    a real purge ran (the exact gap PR #68 already closed for
    ``persist_equity_snapshots``).
    """
    def _del():
        return (
            supabase.table("allocator_equity_snapshots")
            .delete()
            .eq("allocator_id", allocator_id)
            .execute()
        )

    res = await db_execute(_del)
    return _result_row_count(res)


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
) -> tuple[list[dict], bool, dict]:
    """Fetch trades + transfers + OHLCV in [start_date, end_date] and build
    the per-day equity rows. Returns ``(rows, hit_okx_terminus, telemetry)``.

    ``telemetry`` is a dict of observability signals collected during the
    replay so the caller can include them in ``reconstruct_complete``
    audit metadata. Keys (all best-effort, may be missing):

    - ``skipped_symbols``: list[str] — symbols dropped from at least one
      day because their price lookup returned None.
    - ``unknown_perp_symbols``: list[str] — OKX SWAP/FUTURES symbols not
      covered by the defensive ctVal table (silent-inflation risk).
    - ``inverse_perp_symbols``: list[str] — inverse perps that landed
      under an unsupported cost shape.
    - ``ctval_drift_warnings``: list[dict] — soft drift signals where
      cost/price disagrees with the table by 1-5%.
    """
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

    skipped_symbols: set[str] = set()
    unknown_perp_symbols: set[str] = set()
    inverse_perp_symbols: set[str] = set()
    ctval_drift_warnings: list[dict] = []
    rows = _compute_daily_equity(
        trades, deposits, withdrawals,
        ohlcv_by_symbol, coingecko_by_symbol,
        start_date, end_date,
        venue=venue,
        skipped_symbols=skipped_symbols,
        unknown_perp_symbols=unknown_perp_symbols,
        inverse_perp_symbols=inverse_perp_symbols,
        ctval_drift_warnings=ctval_drift_warnings,
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
    anchor, anchor_partial_symbols = await _fetch_current_equity(exchange, venue)
    if rows and anchor is not None:
        last_value = float(rows[-1].get("value_usd") or 0.0)
        offset = anchor - last_value
        # NEW-C01-02 / NEW-C01-03: skip anchor when any held asset priced
        # to zero (ticker failure on a positive-qty asset → partial anchor).
        # Also bound the offset to 5× the last reconstructed value to reject
        # implausible offsets caused by phantom perps or ticker outages.
        # Both conditions ship an unanchored series per the documented fallback
        # and stamp a DQ flag so operators can see why anchoring was skipped.
        _implausible_anchor = (
            last_value > 0
            and abs(offset) > 5.0 * abs(last_value)
        )
        if anchor_partial_symbols:
            logger.warning(
                "anchor: skipping — %d asset(s) priced to zero (ticker "
                "failure with qty>0): %s",
                len(anchor_partial_symbols),
                sorted(anchor_partial_symbols),
            )
        elif _implausible_anchor:
            logger.warning(
                "anchor: offset=%.2f exceeds 5× last_value=%.2f — "
                "skipping anchor (anchor_offset_implausible)",
                offset, last_value,
            )
        elif abs(offset) > 0.005:
            for r in rows:
                r["value_usd"] = round(float(r["value_usd"] or 0.0) + offset, 2)
                bd = dict(r.get("breakdown") or {})
                bd["STARTING_BALANCE"] = round(
                    float(bd.get("STARTING_BALANCE", 0.0)) + offset, 2,
                )
                r["breakdown"] = _cap_breakdown(bd)

    telemetry = {
        "skipped_symbols": sorted(skipped_symbols),
        "unknown_perp_symbols": sorted(unknown_perp_symbols),
        "inverse_perp_symbols": sorted(inverse_perp_symbols),
        "ctval_drift_warnings": ctval_drift_warnings,
    }
    return rows, hit_terminus, telemetry


async def _fetch_current_equity(
    exchange: Any, venue: str
) -> tuple[float | None, set[str]]:
    """Return (equity_usd, partial_unpriced_symbols).

    ``equity_usd`` is today's total account equity in USD, or None if we
    can't determine it. ``partial_unpriced_symbols`` is the set of
    non-stablecoin assets whose ticker call failed while they had qty>0 —
    a non-empty set means the equity figure is an undercount and the
    anchor should be skipped (NEW-C01-02 / NEW-C01-03).

    Keeps the semantics of the daily refresh job (v0.15.4.0 fix 2): spot
    rows contribute their marked value, derivative rows contribute
    unrealized PnL only — on unified-margin venues the USDT collateral
    backing perps already sits in the spot row and summing notional on
    top double-counts.

    Wrapped in a blanket try/except: the anchor is advisory, not load-
    bearing. Any exchange error — including mocked exchanges in tests
    that don't stub fetch_balance/fetch_positions — returns (None, set())
    so the reconstruction still ships an unanchored series rather than
    failing the whole job.
    """
    partial_unpriced: set[str] = set()
    try:
        balance = await exchange.fetch_balance()
        if not isinstance(balance, dict):
            return None, partial_unpriced
        totals = balance.get("total") or {}
        if not isinstance(totals, dict):
            return None, partial_unpriced
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
            # effort — a missing ticker records the asset as unpriced so
            # the caller can decide whether to trust the anchor.
            px = 0.0
            try:
                t = await exchange.fetch_ticker(f"{asset_upper}/USDT")
                px = float((t or {}).get("last") or 0.0) if isinstance(t, dict) else 0.0
            except Exception:  # noqa: BLE001
                px = 0.0
            # NEW-C01-02: track assets that had a positive qty but priced
            # to zero (ticker failure → anchor understates equity).
            if px == 0.0:
                partial_unpriced.add(asset_upper)
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
        return total, partial_unpriced
    except Exception as exc:  # noqa: BLE001
        logger.warning("anchor: _fetch_current_equity failed venue=%s: %s", venue, exc)
        return None, partial_unpriced


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
            rows, hit_terminus, telemetry = await _fetch_and_price_window(
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
            # H-1172: log the full traceback BEFORE sanitisation so the
            # original error reaches stdout/sentry. The 500-char audit
            # event keeps a sanitised summary for the trail; the logger
            # call captures the unredacted root cause for ops.
            logger.exception(
                "reconstruct_allocator_history unhandled exception "
                "allocator=%s key=%s venue=%s",
                allocator_id, api_key_id, venue,
            )
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
    # M-1029: wrap purge + persist in an outer try so a delete failure
    # bubbles to ``reconstruct_failed`` instead of leaving the worker
    # with a corrupted half-state (purge crashed → fresh rows would
    # DO-NOTHING against leftover stale rows). The docstring on
    # ``_purge_allocator_equity_snapshots`` already promises bubble
    # semantics; this is the catch site that closes the contract.
    # SPEC-SFH-3 (specialist apply 2026-05-16): pre-initialise to a
    # fail-safe shape so the audit-metadata builder ~70 lines down
    # cannot NameError if a future refactor reorders the emit path
    # outside the try-cover. SiblingCheckResult(True, False, None)
    # mirrors the "skip purge, no error" default — closer to the
    # actual fail-safe semantics than (False, ...) would be.
    sibling_check = SiblingCheckResult(
        has_siblings=True, lookup_failed=False, error_message=None,
    )
    try:
        purged = 0
        sibling_check = await _allocator_has_other_api_keys(
            ctx.supabase, allocator_id, api_key_id,
        )
        # C-0328 / M-1028: surface sibling-lookup failures into the audit
        # trail. The boolean fail-safe (return True ⇒ skip purge) preserves
        # data integrity but is invisible to operators — without an event
        # the user's stale curve persists indefinitely with no signal that
        # the recovery path latched on a DB error.
        if sibling_check.lookup_failed:
            _emit_audit(
                allocator_id, api_key_id,
                "allocator.equity.sibling_lookup_failed",
                {
                    "error_message": sibling_check.error_message,
                    "venue": venue,
                    "behavior": "fail_safe_skip_purge",
                },
            )
        if not sibling_check.has_siblings:
            purged = await _purge_allocator_equity_snapshots(
                ctx.supabase, allocator_id,
            )

        count = await persist_equity_snapshots(
            ctx.supabase, rows, allocator_id, depth_months,
        )
    except Exception as exc:  # noqa: BLE001
        # Same surfacing pattern as the fetch-window catch — log full
        # traceback for sentry/stdout, then sanitised audit + FAILED
        # outcome so the worker retries with backoff. H-1172.
        logger.exception(
            "reconstruct_allocator_history persist phase unhandled exception "
            "allocator=%s key=%s venue=%s",
            allocator_id, api_key_id, venue,
        )
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

    # H-1168: distinguish a clean DO-NOTHING idempotent re-run from a
    # silent regression. ``days_written == 0`` with rows in hand is
    # the exact pattern PR #68's audit-log story said it would expose;
    # tag the event so support can spot it.
    #
    # SPEC-CR-1 (specialist apply 2026-05-16): only stamp
    # ``reconstruct_unexpected_noop`` on the sole-key path where the
    # purge fires and ``count == 0`` truly means the upsert produced
    # nothing. On the multi-key path (siblings present), the purge is
    # skipped and ON CONFLICT DO NOTHING legitimately drops rows that
    # collide with a sibling's snapshot — that's the documented
    # T-07-V5b aggregation invariant, not a silent regression. Keep
    # the alarm narrow so multi-key onboarding doesn't trigger
    # false-positive support pages.
    # SPEC-SFH-1 (specialist apply 2026-05-16): when inverse-perp
    # activity was the ONLY signal we saw (telemetry recorded
    # inverse_perp_symbols AND every persisted row totalled $0), the
    # account is rendering a flat-line $0 curve — exactly the V-shape
    # silent-failure pattern the v0.15.3.x audit chain was retiring.
    # Stamp a distinct ``reconstruct_partial_unsupported`` kind so
    # the dashboard can render an "unsupported account shape" state
    # rather than implying empty equity.
    # RT-1 (inline red-team 2026-05-16): round to 2dp before equality
    # so positions that cancel to 1e-9 (float noise from realised PnL
    # close-outs) still classify as a zero-curve. Otherwise a single
    # 1e-12 residual flips the audit kind back to ``reconstruct_complete``
    # and silently loses the partial-unsupported signal.
    inverse_only_zero_curve = (
        bool(telemetry["inverse_perp_symbols"])
        and bool(rows)
        and all(
            round(float((r.get("value_usd") or 0.0)), 2) == 0.0 for r in rows
        )
    )
    if count == 0 and rows and not sibling_check.has_siblings:
        audit_kind = "allocator.equity.reconstruct_unexpected_noop"
    elif count == 0 and not rows:
        audit_kind = "allocator.equity.reconstruct_no_data"
    elif inverse_only_zero_curve:
        audit_kind = "allocator.equity.reconstruct_partial_unsupported"
    else:
        audit_kind = "allocator.equity.reconstruct_complete"

    _emit_audit(
        allocator_id, api_key_id,
        audit_kind,
        {
            "days_written": count,
            "stale_snapshots_purged": purged,
            "history_depth_months": depth_months,
            "okx_terminus_hit": hit_terminus,
            "venue": venue,
            "sibling_check_failed": sibling_check.lookup_failed,
            # Surface replay-time observability (C-0326/9/30, M-1024).
            # Keep the lists bounded by audit_metadata size by capping
            # each at 50 entries; the sets only ever grow per-symbol so
            # 50 is sufficient even for a noisy account.
            "skipped_symbols": telemetry["skipped_symbols"][:50],
            "unknown_perp_symbols": telemetry["unknown_perp_symbols"][:50],
            "inverse_perp_symbols": telemetry["inverse_perp_symbols"][:50],
            "ctval_drift_warnings": telemetry["ctval_drift_warnings"][:50],
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
        # SPEC-SFH-4 (specialist apply 2026-05-16): aggregate
        # missing-upnl symbols across the loop and emit ONE audit
        # event at the end (mirroring the telemetry pattern used by
        # the reconstruct path's skipped_symbols list). Pre-fix the
        # per-symbol emit would flood audit_events on every daily
        # refresh for any allocator with a stuck poller.
        perp_upnl_missing_symbols: list[str] = []
        # RT-2: track the true count separately from the bounded list
        # so an unusually noisy account (>50 stuck symbols) still
        # surfaces the magnitude in the audit metadata.
        perp_upnl_missing_total = 0
        for h in holdings:
            sym = (h.get("symbol") or "").upper()
            if not sym:
                continue
            htype = (h.get("holding_type") or "").lower()
            if htype == "derivative":
                # H-1161 / M-1023: distinguish "field is None" (the poll
                # job failed to populate the row) from "MTM legitimately
                # equals zero" (fresh open at entry, perfect hedge).
                # Pre-fix `float(... or 0.0)` then `if upnl == 0.0:
                # continue` collapsed both states into a silent drop —
                # the dashboard rendered "no derivative activity" for
                # users who legitimately held perps. Now: NULL → log +
                # skip; 0.0 → keep the breakdown key with value 0 so
                # the position is visible even when there's no MTM
                # signal yet.
                upnl_raw = h.get("unrealized_pnl_usd")
                if upnl_raw is None:
                    logger.info(
                        "refresh: derivative holding missing "
                        "unrealized_pnl_usd allocator=%s symbol=%s "
                        "venue=%s — skipping",
                        allocator_id, sym, venue,
                    )
                    # RT-2 (inline red-team 2026-05-16): bound the
                    # in-loop dedupe list at 50 to keep the O(N) `in`
                    # check cheap and the metadata payload predictable.
                    # missing_count tracks the true total via the
                    # separate counter so magnitude survives the cap.
                    perp_upnl_missing_total += 1
                    if (
                        sym not in perp_upnl_missing_symbols
                        and len(perp_upnl_missing_symbols) < 50
                    ):
                        perp_upnl_missing_symbols.append(sym)
                    continue
                try:
                    upnl = float(upnl_raw)
                except (TypeError, ValueError):
                    logger.warning(
                        "refresh: derivative holding has non-numeric "
                        "unrealized_pnl_usd=%r allocator=%s symbol=%s",
                        upnl_raw, allocator_id, sym,
                    )
                    continue
                # H-1157 / H-1165 / H-1169: emit under the canonical
                # 3-part key shape used by the reconstruct path. The
                # refresh holdings.symbol column is stored stripped
                # (no ``/``), so we split it back into base+quote.
                base, quote = split_holdings_symbol_to_base_quote(sym)
                key = breakdown_key_for_perp(base, quote)
                breakdown[key] = round(breakdown.get(key, 0.0) + upnl, 2)
                total += upnl
            else:
                v = float(h.get("value_usd") or 0.0)
                breakdown[sym] = round(breakdown.get(sym, 0.0) + v, 2)
                total += v

        # SPEC-SFH-4: emit ONE aggregated perp_upnl_missing event at
        # the end of the loop (symbols cap at 50, missing_count is
        # the true total via the separate RT-2 counter).
        if perp_upnl_missing_symbols:
            _emit_audit(
                allocator_id, api_key_id,
                "allocator.equity.perp_upnl_missing",
                {
                    "symbols": perp_upnl_missing_symbols,
                    "missing_count": perp_upnl_missing_total,
                    "venue": venue,
                },
            )

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
        # H-1172: surface the full traceback to stdout/sentry before
        # sanitising for the audit-trail summary.
        logger.exception(
            "refresh_allocator_equity_daily unhandled exception "
            "allocator=%s key=%s venue=%s",
            allocator_id, api_key_id, venue,
        )
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

from collections import defaultdict

import math


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

    # Synthetic starting NAV used when the caller does not supply one.
    # Daily returns are computed as ``daily_pnl / nav_yesterday`` which
    # demands a finite, non-zero base. 100_000 USDT is a realistic
    # placeholder for a self-reported strategy where capital is unknown
    # (matches the convention in services/metrics.py + analytics_runner.py
    # where starting NAV is implicit). Tests that need an absolute return
    # number can pass starting_nav explicitly.
    DEFAULT_STARTING_NAV: float = 100_000.0

    def __init__(
        self,
        trades: list,  # list[Trade] — annotation kept loose to avoid circular import
        mark_prices: dict[str, float] | None = None,
        starting_nav: float | None = None,
    ) -> None:
        self.trades = sorted(trades, key=lambda t: t.timestamp)
        self.mark_prices = mark_prices or {}
        self.starting_nav = float(
            starting_nav if starting_nav is not None else self.DEFAULT_STARTING_NAV
        )
        self._funding_pnl_by_day: dict[date, float] = {}
        self._curve_cache: pd.DataFrame | None = None
        # CR-perf-2 — cache reconstruct_positions output. to_metrics_snapshot
        # and to_equity_curve_daily both call reconstruct_positions; pre-fix
        # this fired _match_positions_fifo twice for every snapshot read.
        self._positions_cache: list | None = None

    # ------------------------------------------------------------------
    # Position reconstruction (in-memory, not persisted)
    # ------------------------------------------------------------------

    def reconstruct_positions(self) -> "list[Position]":
        """In-memory FIFO matching (NOT persisted to DB).

        Calls existing services.position_reconstruction._match_positions_fifo
        (private — Phase 19 / MC-2 Option B). CR-perf-2 — result cached on
        self._positions_cache; the cache is invalidated by attach_funding
        the same way self._curve_cache is.
        """
        if self._positions_cache is not None:
            return self._positions_cache

        from services.ingestion.adapter import Position
        from services.position_reconstruction import _match_positions_fifo

        positions_by_symbol: dict[str, list[dict]] = defaultdict(list)
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
            # Explicit decision (review): a corrupt zero/non-finite-entry
            # position dropped by _match_positions_fifo IS surfaced — it emits
            # an unconditional logger.warning. This in-memory equity path has no
            # persisted data_quality_flags channel (unlike the DB-backed
            # reconstruct_positions in position_reconstruction.py), so we
            # deliberately do NOT thread a dropped_flags accumulator here — it
            # would be write-only state that nothing reads.
            matched = _match_positions_fifo(symbol, fills, strategy_id="<in-memory>")
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

        positions_typed = [
            Position(**_position_dict_to_position_kwargs(p)) for p in all_positions
        ]
        self._positions_cache = positions_typed
        return positions_typed

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

        realized_by_date: dict[date, float] = defaultdict(float)
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
        df["equity"] = self.starting_nav + df["daily_pnl"].cumsum()
        # Daily return = daily_pnl / nav_yesterday. Day 1 returns 0.0.
        prev_equity = df["equity"].shift(1).fillna(self.starting_nav)
        # prev_equity is guaranteed > 0 because starting_nav > 0 and the
        # cumulative PnL would have to exceed -starting_nav for it to flip
        # negative — unrealistic for a synthetic seed but guarded with a
        # mask.
        prev_equity = prev_equity.where(prev_equity > 0, other=self.starting_nav)
        df["daily_return"] = (df["daily_pnl"] / prev_equity).fillna(0.0)
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
        if std == 0 or math.isnan(std):
            return None
        return float((excess.mean() / std) * (periods ** 0.5))

    def compute_max_drawdown(self) -> float | None:
        df = self.to_equity_curve_daily()
        if df.empty:
            return None
        equity = df["equity"]
        running_max = equity.cummax()
        # equity is ``starting_nav + cum(daily_pnl)`` so running_max ≥
        # starting_nav > 0 — safe denominator.
        denom = running_max.where(running_max != 0, other=self.starting_nav)
        dd = (equity - running_max) / denom
        return float(dd.min())

    # ------------------------------------------------------------------
    # MetricsSnapshot composition
    # ------------------------------------------------------------------

    def to_metrics_snapshot(self) -> "MetricsSnapshot":
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


def _position_dict_to_position_kwargs(p: dict) -> dict:
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
