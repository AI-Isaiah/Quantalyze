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
from services.external_flows import ExternalFlow
from services.mt5_deals import classify_deal, deal_cash_effect, deal_utc_day
from services.native_nav import NativeLedger, reconstruct_native_nav_and_twr
from services.nav_twr import _build_nav_meta, _coerce_float, chain_linked_twr
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
    seam, plan 120-03). Returns ``(returns, meta)``: a float Series on the DENSE
    daily OBSERVED-NAV span (ascending DatetimeIndex unit [us]) whose interior
    missing days are honest NaN gaps — NEVER 0.0-filled (F2/F6: sFOX NAV is a
    SAMPLED series, so an unobserved day is UNKNOWN, not flat) — plus a plain dict
    of the ``NavTWRMeta`` DQ-01 flags (carrying ``nav_coverage_gap_days`` when the
    span has interior holes).

    Cashflow separation (economically load-bearing): the external flow F sits in
    the numerator ``r_t = (NAV_t - NAV_{t-1} - F_t) / NAV_{t-1}`` — a deposit day
    therefore books its REAL PnL, never the deposit itself (perf-curve ≠
    equity-curve, the v1.11 carry-forward). Booking ``usd_value.pct_change()``
    instead would count a deposit as return.

    Day-0 convention (A3 [ASSUMED]): ``prev0`` = the FIRST OBSERVED ``usd_value``
    (the balance-history inception point = inception capital), so day-0 emits a
    0.0 anchor return (no spurious first-day move) and returns begin day 1. Because
    ``prev0`` already reflects any same-day funding deposit, a flow dated ON the
    day-0 anchor is FORCED to 0 (dropped) before the chain-link — WR-01 — so the
    anchor cannot emit a spurious ``−F_0/first_observed`` return; the 0.0-anchor
    claim would otherwise hold ONLY when there is no day-0 flow. This resolves
    empirically in the SFOX-06 founder ground-truth run — amend here if the live
    curve contradicts.

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

    # Normalize the flow argument up front so the CR-01 union (below) and the
    # downstream chain-link operate on one Series (never a None branch).
    flows_arg = (
        flows_by_day
        if flows_by_day is not None
        else pd.Series(dtype="float64", name="flows")
    )

    # The OBSERVED NAV span [first, last] — the dense daily grid over the days sFOX
    # actually reported a usd_value for. Computed from the ORIGINAL series BEFORE the
    # chain-link union below, so an out-of-span boundary flow can NEVER widen the
    # displayed span (F2/F6). A missing observation INSIDE this span stays NaN
    # (never 0.0-filled — that would FABRICATE a flat NAV day); the NaN propagates
    # as an honest break through the TWR.
    span_idx = pd.date_range(
        nav.index.min(), nav.index.max(), freq="D"
    ).as_unit("us")
    # CR-01: UNION the flow days into the CHAIN-LINK index BEFORE chain_linked_twr,
    # mirroring how reconstruct_nav_and_twr unions flow days via _union_flow_days.
    # sFOX's two crawls are INDEPENDENT time domains: /balance/history is an
    # end-of-day snapshot (its last point is typically YESTERDAY — the crawl edge
    # tolerance permits now−2d), while /transactions is real-time. So a
    # deposit/withdraw dated today (the ordinary "fund the account, then
    # connect/resync" flow) or a pre-inception funding deposit lands on a day
    # OUTSIDE [first_bh_day, last_bh_day]. Left un-unioned it is an ORPHAN that
    # _align_flows rejects with NavReconstructionError, permanently failing a
    # realistic onboarding account (the T-74-02/T-80-10 DoS: it escapes the sfox
    # worker branch → retried forever, no terminal stamp). Unioned, that boundary
    # flow gets a (NaN-NAV) calendar day here and yields an honest NaN return — the
    # deposit is neither counted as return nor lost, and never a crash. The
    # out-of-span union day is stripped back off below (F2/F6) so it can never
    # fabricate flat days between it and the span.
    chain_idx = span_idx
    if not flows_arg.empty:
        chain_idx = span_idx.union(flows_arg.index)
    nav = nav.reindex(chain_idx)

    # WR-01: the day-0 anchor carries NO flow-driven return. prev0 = first_observed
    # is the EOD inception equity, which ALREADY reflects any SAME-day funding
    # deposit; with a day-0 flow F_0 present, chain_linked_twr would emit
    # returns[0] = (first_observed − first_observed − F_0)/first_observed
    # = −F_0/first_observed — a spurious, economically-wrong anchor-day return that
    # re-subtracts a deposit already embedded in the inception capital (the "0.0
    # anchor" is honest ONLY when F_0 == 0). Drop any flow dated on the first index
    # day so _align_flows fills 0.0 there and the anchor stays the honest 0.0. (In
    # the rarer pre-inception-flow case the first index day is a NaN-NAV day whose
    # return is NaN regardless, so this drop is harmless there.)
    if not flows_arg.empty and nav.index[0] in flows_arg.index:
        flows_arg = flows_arg.drop(nav.index[0])

    # daily_pnl is consulted by chain_linked_twr ONLY at iloc[0], and prev0
    # overrides even that — so the implied nav.diff() is a formal argument whose
    # only load-bearing cell (iloc[0]) is a finite 0.0.
    daily_pnl = nav.diff().fillna(0.0)

    returns, flags = chain_linked_twr(
        nav=nav,
        daily_pnl=daily_pnl,
        flows_by_day=flows_arg,
        prev0=first_observed,
    )
    # F2/F6 (P120 red-team, no-invented-data): DO NOT gap_fill(0.0) the sFOX series
    # (the other combiners do, because for a ledger-COMPLETE venue an absent day is
    # genuinely flat and 0.0 is correct). sFOX NAV is a SAMPLED series, so an
    # unobserved day is UNKNOWN, never flat — a 0.0 fabricates equity ("flat, no
    # change" when the truth is "we don't know"). Left unfixed, gap_fill would
    # (a) 0.0-BRIDGE the gap between an out-of-span boundary flow (unioned into
    # chain_idx above) and the NAV span — fabricating pre-inception/post-terminus
    # flat days AND shifting the displayed inception earlier — and (b) it is simply
    # unnecessary for interior holes (they must stay UNKNOWN). Instead restrict the
    # series back to the OBSERVED NAV span: interior missing days remain honest NaN
    # gaps that derive_basis_series DROPS into gap_spans (an absent csv_daily_returns
    # row), never a fabricated 0.0; and the out-of-span union days (whose NaN returns
    # carry no information) fall away — the flow is simply not yet reflected in any
    # NAV observation (honest), never a crash (the union already booked it
    # cashflow-neutral for the chain-link). The index stays DENSE over the span
    # (date_range) so the downstream "dense Series" contract holds.
    returns = returns.reindex(span_idx)

    # Coverage honesty: an interior missing NAV day is a real coverage gap in a
    # SAMPLED series. Surface it in the meta so no consumer reads a holed span as
    # 'complete' coverage; the authoritative per-day gap_spans are still derived
    # downstream by derive_basis_series from the NaN rows.
    nav_gap_days = int(nav.reindex(span_idx).isna().sum())
    meta = dict(_build_nav_meta(flags))
    if nav_gap_days > 0:
        meta["nav_coverage_gap_days"] = nav_gap_days
        meta["computation_status_hint"] = "complete_with_warnings"
    return returns, meta


def combine_mt5_deal_ledger(
    deals: Sequence[Mapping[str, Any]],
    account_equity: float,
    account_balance: float,
    *,
    server_utc_offset_s: int = 0,
) -> tuple[pd.Series, dict[str, Any]]:
    """The MT5 sibling of ``combine_native_ledger`` (:174) and
    ``combine_sfox_balance_history`` (:230) — the THIRD broker-dailies combiner.
    Fold an MT5 ``history_deals_get`` ledger into the byte-identical
    ``(returns, meta)`` shape the other two produce (a gap-filled float Series on
    an ascending daily DatetimeIndex unit ``[us]`` + a plain ``NavTWRMeta`` dict),
    so EVERYTHING downstream — ``derive_basis_series``, ``compute_all_metrics``,
    persistence, the factsheet — is untouched.

    MT5 is single-currency (broker deposit ccy, USD-family) with a LIVE
    ``account_info().equity`` anchor — there is NO per-currency coin-margined
    reconstruction (deribit's ``native_nav`` machinery). It is structurally
    CLOSEST to sFOX, but unlike sFOX's SAMPLED NAV it is a ledger-COMPLETE venue,
    so a no-activity interior day is genuinely flat (0.0 via ``gap_fill``), never
    an UNKNOWN gap.

    Steps:
      1. classify every deal via ``services.mt5_deals.classify_deal`` — an
         unclassifiable / ambiguous ``DEAL_TYPE`` raises
         ``Mt5DealClassificationError`` BEFORE any series is produced (nothing
         partial; the deribit-``correction`` fail-loud lesson);
      2. bucket per UTC day via ``deal_utc_day(time, server_utc_offset_s)`` — the
         ONE server-time→UTC normalize seam (Pitfall 1; offset is ``[ASSUMED A2]``
         until the live spike);
      3. daily trading PnL = Σ ``deal_cash_effect`` (``profit+swap+commission+fee``,
         [ASSUMED A3]) over trading-type rows per day; daily external flow = Σ the
         ``profit`` field of external-flow-type (BALANCE/CREDIT/BONUS) rows per day
         (a BALANCE deal books the deposit/withdrawal amount in ``profit``);
      4. anchor to the LIVE ``account_equity`` (anchor-to-today, reconstruct
         backward — the module's :26-32 convention) and produce flow-in-numerator
         returns ``r_t = (NAV_t − NAV_{t−1} − F_t)/NAV_{t−1}``.

    Cashflow separation (economically load-bearing): the external flow F sits in
    the NUMERATOR, so a deposit day books its REAL trading PnL, NEVER the deposit
    itself (a ``pct_change()`` on the equity curve would count the deposit as a
    return — the highest-severity money bug for this source).

    Realized-basis + uPnL wedge (v1.8 FLOW-04): the realized deal ledger books
    CLOSED PnL only, while ``account_info().equity`` = balance + floating uPnL of
    open positions. We anchor to equity and pass ``open_unrealized_usd =
    account_equity − account_balance`` so the honest core flags a material wedge
    (``unrealized_pnl_in_anchor``) rather than silently reconciling it.

    Composition: the per-day trading PnL is shaped into ``fetch_daily_pnl``-style
    ``daily_pnl`` records and the per-day flows into dated ``ExternalFlow`` entries,
    then delegated to ``combine_realized_and_funding`` so the anchor roll, the
    flow numerator, the DQ-01 guard set, the uPnL-wedge flag and ``gap_fill`` all
    come from the ONE shared engine — a bespoke ``r_t`` loop is FORBIDDEN
    (Don't Hand-Roll). The two existing siblings are NEVER touched.
    """
    trading_by_day: dict[str, float] = {}
    flow_by_day: dict[str, float] = {}
    for deal in deals:
        # classify_deal raises on an unknown/ambiguous type — it propagates so the
        # whole combine fails loud (nothing partial), never a silent drop/coerce.
        kind = classify_deal(deal)
        day = deal_utc_day(deal.get("time"), server_utc_offset_s)
        if kind == "trading":
            trading_by_day[day] = trading_by_day.get(day, 0.0) + deal_cash_effect(deal)
        else:  # external_flow — capital in/out, subtracted from the return numerator
            amount = _coerce_float(
                deal.get("profit", 0.0), field="mt5_flow_profit", row={"day": day}
            )
            flow_by_day[day] = flow_by_day.get(day, 0.0) + amount

    # Shape per-day trading PnL into daily_pnl records (the funding_rows_to_daily_pnl
    # _records shape at :108-121: side encodes the sign, price is the |USD| amount).
    records = [
        {
            "exchange": "",
            "symbol": "MT5_DAILY",
            "side": "buy" if pnl >= 0 else "sell",
            "price": abs(pnl),
            "quantity": 1,
            "fee": 0,
            "fee_currency": "USD",
            "timestamp": f"{day}T00:00:00+00:00",
            "order_type": "daily_pnl",
        }
        for day, pnl in sorted(trading_by_day.items())
    ]
    # Dated external flows (deposit +, withdrawal −); USD-family so quantity == usd.
    flows = [
        ExternalFlow(utc_day_iso=day, usd_signed=amount)
        for day, amount in sorted(flow_by_day.items())
    ]

    return combine_realized_and_funding(
        records,
        [],
        account_balance=account_equity,
        external_flows=flows,
        open_unrealized_usd=account_equity - account_balance,
    )
