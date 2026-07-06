"""Broker API key full-history → daily-return series → standard CSV route.

Goal: when a broker API key is added, download its entire history, derive a
daily-return series, and compile the usual strategy factsheet by reusing the
CSV analytics route (``compute_analytics_from_csv`` → ``run_csv_strategy_analytics``
→ ``compute_all_metrics``). No per-trade reconstruction is required: once we
have a daily-return series, the standard CSV pipeline does the rest.

Why realized PnL + funding (not realized alone)
------------------------------------------------
A daily series built from realized trading PnL alone is wrong for crypto-perp
strategies because **funding is the dominant return driver**. On a live Bybit
read-key (190k principal → 245.6k over ~5 months) the split was:

    realized trading PnL  +15,773  (+8.3%)
    funding PnL           +38,766  (+20.4%)   <-- two-thirds of the profit
    open unrealized          -680  (-0.4%)
    -------------------------------------
    total                 +53,859  (~+28.3%)  vs equity +29.3%

``fetch_daily_pnl`` EXCLUDES funding by design (C-0319), so a realized-only
series reported +6.8% (Sharpe 0.49) where the truth is ~+28.8% (Sharpe 1.27).
Combining realized PnL + funding and anchoring initial capital to the account's
current total equity (NAV incl. unrealized) reproduces the true figure.

Anchoring (anchor-to-today, reconstruct backward)
-------------------------------------------------
``trades_to_daily_returns_with_status`` derives initial capital as
``current_equity - total_pnl`` and rolls the equity curve forward from there.
Because total_pnl now includes funding, the derived initial capital matches the
real principal and the most-recent equity equals today's real (read) equity;
reconstruction error accrues into the distant past, not the present.

Event-time external flows (v1.8 FLOW-03)
----------------------------------------
As of Phase 76, read-only keys DO enumerate deposits/withdrawals on the ccxt
venues (binance/okx/bybit) via the promoted ``fetch_ccxt_transfers`` (76-01) and
value them at their same-UTC-day close (``ccxt_rows_to_dated_flows``, 76-02). The
``derive_broker_dailies`` else-branch (``job_worker``) threads the resulting
``external_flows`` into ``combine_realized_and_funding`` → the honest core's
backward NAV roll, which applies the ONE flow correction to the chain-linked TWR
numerator. A mid-window deposit/withdrawal is therefore NO LONGER an accepted,
flagged limitation for the ccxt venues — it is captured. The equity anchor still
injects capital deposited BEFORE the fetchable retention window (OKX ~90d /
Bybit ~365d); that pre-terminus gap is surfaced by the DQ-02 coverage terminus
(``flow_coverage_incomplete`` → ``complete_with_warnings``), never silently
attributed to performance.
"""
from __future__ import annotations

import logging
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

import pandas as pd

from services.transforms import trades_to_daily_returns_with_status

logger = logging.getLogger(__name__)


def _funding_iso_day(ts: Any) -> str | None:
    """Coerce a FundingFeeRow timestamp (datetime, per the producer contract)
    to a UTC ISO calendar day. Tolerates epoch-ms / ISO-string for robustness
    across producers; returns None when the value can't be interpreted."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        aware = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).date().isoformat()
    try:
        return datetime.fromtimestamp(int(ts) / 1000, tz=timezone.utc).date().isoformat()
    except (TypeError, ValueError, OverflowError, OSError):
        pass
    try:
        return datetime.fromisoformat(str(ts).replace("Z", "+00:00")).astimezone(
            timezone.utc
        ).date().isoformat()
    except (TypeError, ValueError):
        return None


def funding_rows_to_daily_pnl_records(
    funding_rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Aggregate signed funding fees into per-day records shaped exactly like
    ``fetch_daily_pnl`` output (``order_type='daily_pnl'``; ``side`` encodes the
    sign — 'buy' for net-positive funding, 'sell' for net-negative;
    ``price`` is the absolute USD amount). This lets the combined stream flow
    through ``trades_to_daily_returns_with_status`` unchanged."""
    by_day: dict[str, float] = {}
    for row in funding_rows:
        iso = _funding_iso_day(row.get("timestamp"))
        if iso is None:
            continue
        try:
            amt = float(row["amount"])
        except (TypeError, ValueError, KeyError):
            continue
        by_day[iso] = by_day.get(iso, 0.0) + amt
    return [
        {
            "exchange": "",
            "symbol": "FUNDING",
            "side": "buy" if v >= 0 else "sell",
            "price": abs(v),
            "quantity": 1,
            "fee": 0,
            "fee_currency": "USDT",
            "timestamp": f"{day}T00:00:00+00:00",
            "order_type": "daily_pnl",
        }
        for day, v in sorted(by_day.items())
    ]


def gap_fill_daily_returns(returns: pd.Series) -> pd.Series:
    """Reindex to EVERY calendar day in ``[first, last]``, filling no-activity
    days with a 0.0 return (equity flat). Delivers the "all days" requirement
    and guarantees the ascending, gap-free DatetimeIndex ``compute_all_metrics``
    requires. No-op on an empty series."""
    if returns.empty:
        return returns
    returns = returns.sort_index()
    full_idx = pd.date_range(returns.index.min(), returns.index.max(), freq="D")
    return returns.reindex(full_idx, fill_value=0.0).astype("float64")


def combine_realized_and_funding(
    realized_pnl_records: list[dict[str, Any]],
    funding_rows: Sequence[Mapping[str, Any]],
    account_balance: float | None,
    balance_error: bool = False,
    *,
    external_flows: Sequence[Any] | None = None,
    open_unrealized_usd: float = 0.0,
) -> tuple[pd.Series, dict[str, Any]]:
    """Combine realized daily PnL + funding into one anchored, gap-filled
    daily-return series. Returns ``(returns, meta)`` where ``meta`` is the
    ``NavTWRMeta`` from ``trades_to_daily_returns_with_status`` (carries
    ``used_heuristic_capital`` / ``balance_error`` plus any DQ-01 NAV-denominator
    guard flags for the DQ pipeline).

    ``external_flows`` / ``open_unrealized_usd`` are threaded straight to the
    honest core (``reconstruct_nav_and_twr``). They default to ``None`` / ``0.0``
    so every existing caller is byte-identical; sourcing/valuing real flows is
    Phase 75's job. An in-window flow adjusts the chain-linked TWR numerator; a
    flow dated outside the return window fails loud (``NavReconstructionError``)
    rather than silently dropping realized cash."""
    combined = list(realized_pnl_records) + funding_rows_to_daily_pnl_records(funding_rows)
    returns, meta = trades_to_daily_returns_with_status(
        combined,
        account_balance=account_balance,
        balance_error=balance_error,
        external_flows=external_flows,
        open_unrealized_usd=open_unrealized_usd,
    )
    returns = gap_fill_daily_returns(returns)
    return returns, dict(meta)
