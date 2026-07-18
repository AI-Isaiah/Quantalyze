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

from services.allocated_capital import (
    ReturnsDenominatorConfig,
    allocated_capital_returns_and_metrics,
)
from services.native_nav import NativeLedger, reconstruct_native_nav_and_twr
from services.nav_twr import _build_nav_meta, chain_linked_twr
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
    # Pin the datetime unit to `[us]` (the canonical analytics unit) so the
    # gap-filled index matches the returns index it reindexes and does not
    # depend on pandas' version-inferred `date_range` unit (#593 pandas 3.0).
    full_idx = pd.date_range(
        returns.index.min(), returns.index.max(), freq="D"
    ).as_unit("us")
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


def combine_native_ledger(
    ledger: NativeLedger,
    indexable: frozenset[str],
    *,
    denominator_config: ReturnsDenominatorConfig | None = None,
) -> tuple[pd.Series, dict[str, Any]]:
    """The NATIVE-unit sibling of ``combine_realized_and_funding`` (80-03 T1,
    §9.2). Call the landed native core (``reconstruct_native_nav_and_twr``,
    ``venue="deribit"``) and gap-fill the returns so the returned ``(returns,
    meta)`` is BYTE-for-byte the same shape the legacy sibling yields — a
    gap-filled float Series on an ascending daily DatetimeIndex + a plain dict of
    the ``NavTWRMeta``.

    Because the shape is identical, EVERYTHING downstream is untouched by the
    production switch: the CSV route, ``compute_all_metrics``, persistence, and
    the factsheet all consume ``(returns, meta)`` exactly as before — the native
    core just replaces the USD-space reconstruction as the returns source.

    ``denominator_config`` (a per-strategy ``returns_denominator_config`` override):
      * ``None`` (EVERY normal strategy) — the NAV backward-roll path above,
        BYTE-IDENTICAL to before this parameter existed;
      * PRESENT (Zavara-only allocated-capital) — returns are
        ``daily_pnl_usd(d) / allocated_capital(d)`` (Option-2 daily_pnl_usd off the
        ledger's ``native_pnl`` × ``marks``), DELIBERATELY bypassing
        ``reconstruct_native_nav_and_twr`` and its §5 inception gate (the capital is
        externally scheduled, not a reconstructed NAV). The zavara-convention
        headline metrics ride in ``meta``. The returns Series is gap-filled to the
        SAME dense daily shape so persistence is untouched.

    ``NavReconstructionError`` subclasses (``UnmarkableCurrencyError`` §3.4,
    ``InceptionReconciliationError`` §5) are NOT caught here — they propagate typed
    so the job-worker callsite can disposition them PERMANENT (no retry, no
    factsheet, scrubbed message — the ``LedgerValuationError`` discipline).

    ponytail — COUPLING INVARIANT (Bug B): the ``ledger`` MUST have been built by
    ``build_deribit_native_ledger`` with ``exclude_spot_extraction ==
    (denominator_config is not None)``. The allocated branch below consumes
    ``ledger.native_pnl`` AS IS (it assumes net-extraction spot legs are ALREADY
    dropped); the NAV branch reconstructs off a ledger that RETAINS them so §5
    closes. The job-worker derives BOTH from the SAME ``denominator_config`` so the
    modes cannot diverge. If a future caller builds a ledger in one mode and calls
    this in the other, the allocated returns would leak (or drop) spot extraction —
    keep the two signals wired to the SAME source."""
    if denominator_config is not None:
        ac_returns, ac_meta = allocated_capital_returns_and_metrics(
            ledger.native_pnl, ledger.marks, denominator_config
        )
        ac_returns = gap_fill_daily_returns(ac_returns)
        return ac_returns, dict(ac_meta)
    returns, meta = reconstruct_native_nav_and_twr(
        ledger, indexable_currencies=indexable, venue="deribit"
    )
    returns = gap_fill_daily_returns(returns)
    return returns, dict(meta)


def combine_sfox_balance_history(
    usd_value: pd.Series,
    flows_by_day: pd.Series,
) -> tuple[pd.Series, dict[str, Any]]:
    """The sFOX sibling of ``combine_native_ledger`` (SFOX-05). Turn sFOX's daily
    ``usd_value`` NAV (equity) series + signed deposit/withdraw flows into a
    cashflow-neutral daily-return series by feeding the EXISTING TWR primitive
    ``nav_twr.chain_linked_twr`` — the SAME engine (flow-in-the-numerator, full
    DQ-01 guard set) deribit's reconstruction ultimately feeds. sFOX is the
    SIMPLEST broker-dailies path: it HANDS us the NAV series directly, so there is
    NO ledger reconstruction here — no native backward-roll, no bespoke ``r_t``
    loop, and no downstream scalar/backbone call (that stays at the job-worker
    seam, plan 120-03). Returns ``(returns, meta)`` in the
    BYTE-identical sibling shape: a gap-filled float Series on an ascending daily
    DatetimeIndex unit [us] + a plain dict of the ``NavTWRMeta`` DQ-01 flags.

    Cashflow separation (economically load-bearing): the external flow F sits in
    the numerator ``r_t = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}`` — a deposit day
    therefore books its REAL PnL, never the deposit itself (perf-curve ≠
    equity-curve, the v1.11 carry-forward). Booking ``usd_value.pct_change()``
    instead would count a deposit as return.

    Day-0 convention (A3 [ASSUMED]): ``prev0`` = the FIRST OBSERVED ``usd_value``
    (the balance-history inception point = inception capital), so day-0 emits a
    0.0 anchor return (no spurious first-day move) and returns begin day 1. This
    resolves empirically in the SFOX-06 founder ground-truth run — amend here if
    the live curve contradicts.

    Missing-day honesty: an UNOBSERVED interior sfox NAV day is UNKNOWN, not flat.
    We reindex the NAV to every calendar day WITHOUT value-filling, so a missing
    observation is NaN — and a NaN NAV propagates through ``chain_linked_twr`` as a
    NaN return on that day AND the following day (NaN prev). That is an honest
    break, never a bridged multi-day return, never a fabricated 0.0. (Contrast
    deribit, where ledger-completeness makes an absent day genuinely flat; there
    0.0 is correct — here it would FABRICATE equity.)

    Degenerate (honest, no invented data): empty NAV → empty Series; a single
    observed point → empty Series (no prior day = no computable return, never an
    invented row). The ``<2``-finite gate proper lives downstream in the backbone
    (plan 120-03); the DQ-01 dust/negative/flow-/pnl-dominated guards are
    inherited unchanged from ``chain_linked_twr``.
    """
    empty = pd.Series(dtype="float64", name="returns")
    if usd_value is None or len(usd_value) == 0:
        return empty, {}

    # Sort + coerce to an ascending daily DatetimeIndex unit [us] — pin the unit
    # (#593 pandas-3.0) so the reindexed calendar index and the flows index union
    # cleanly, exactly like gap_fill_daily_returns does.
    nav = usd_value.sort_index()
    nav = pd.Series(
        nav.to_numpy(dtype="float64"),
        index=pd.DatetimeIndex(nav.index).as_unit("us"),
        name="nav",
    )
    if len(nav) < 2:
        # A single observed point has no prior day → no computable return. Never
        # invent a day-0 row.
        return empty, {}

    # prev0 = the FIRST OBSERVED usd_value (A3). Captured BEFORE the reindex so an
    # inserted (missing-day) NaN can never become the inception capital.
    first_observed = float(nav.iloc[0])

    # Reindex to EVERY calendar day in [first, last] WITHOUT value-filling: a
    # missing observation stays NaN (never 0.0-filled — that would FABRICATE a
    # flat NAV day). The NaN then propagates as an honest break through the TWR.
    full_idx = pd.date_range(
        nav.index.min(), nav.index.max(), freq="D"
    ).as_unit("us")
    nav = nav.reindex(full_idx)

    # daily_pnl is consulted by chain_linked_twr ONLY at iloc[0], and prev0
    # overrides even that — so the implied nav.diff() is a formal argument whose
    # only load-bearing cell (iloc[0]) is a finite 0.0.
    daily_pnl = nav.diff().fillna(0.0)

    returns, flags = chain_linked_twr(
        nav=nav,
        daily_pnl=daily_pnl,
        flows_by_day=(
            flows_by_day
            if flows_by_day is not None
            else pd.Series(dtype="float64", name="flows")
        ),
        prev0=first_observed,
    )
    # Same shape contract as the other combiners: the index is already dense so
    # gap-fill fills NOTHING; existing NaN breaks SURVIVE (a shape no-op, never a
    # bridge across a gap).
    returns = gap_fill_daily_returns(returns)
    meta = _build_nav_meta(flags)
    return returns, dict(meta)
