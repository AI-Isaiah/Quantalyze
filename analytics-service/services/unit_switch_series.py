"""The two-segment series builder for an account that moved from its stable unit into a coin.

Phase 256 OKXUNITSWITCH plan 04 (SC-2, SC-3, SC-7). Plan 01 says WHEN the account switched and
splits its daily P&L at that day (``services.unit_switch``). This module turns that split, the
funding rows, the external flows and the live anchor into the whole-history USD headline that
every reader keeps binding to, using the existing NAV/TWR engine ONCE PER UNIT:

* the USD segment is rebuilt in USD, through ``switch.last_usd_day`` (S), anchored at the coin
  base level times the stored close of S, so its terminal level is the coin segment's start level
  priced the same day;
* the coin segment is rebuilt in the coin with the coin's own floors, anchored at the live equity
  divided by the coin's live USD price, rolled backward over the coin days;
* the headline is the USD returns concatenated with the coin returns converted by
  ``convert_native_returns_to_usd`` at the stored daily closes. No figure is ever computed on a
  mixed series: the headline is all USD by construction, and carries no unit flag.

BOUNDARY (CONTEXT "Boundary day"): S is the LAST USD return day and the coin base level is the end
of S (no coin return is booked for S, as for day 0 of any series; the converter drops that day). The
first coin return day is S + 1. The two return day sets are disjoint and their union is every
derived day; ``build_switched_series`` raises ``ValueError`` if they ever overlap (a programming
error, never a data state). The two engine runs are never chained across S.

MISSING CLOSES (CONTEXT "Readers"): a coin day with no usable stored close is present in the native
coin segment and ABSENT from the headline, named in ``unpriced_days``; a close is never borrowed
from a neighbour day (T-256-10). A missing close for the latest completed day refuses
``switch_anchor_unpriced`` (the derive retries it as transient), and for S ``switch_day_unpriced``.
Days dated after the latest completed day are kept in the coin segment and are unpriced too.

MARKS (planner decision, flagged for the founder): this builder applies NO marks. The derive applies
the stored USD marks once, to the whole USD headline, with its existing unchanged block (precedent:
a BTC MT5 key is "converted to dollars at the stored daily closes, so its marks apply as nav_usd").
Re-basing per segment was considered and not taken: the apply block's downstream (key payload
terminal, writer basis, tiny-base days, marks flags) binds to ONE marked series. Known limit: the
native coin line follows the coin bills and the anchor, so a stable residual's coin-value drift
reaches the USD headline through the marks but not the coin line.

No I/O, no logging, no venue text in any return value. Refusals are returned closed-set tokens
(``unit_switch.UNIT_SWITCH_REFUSALS`` plus ``SWITCH_ANCHOR_UNPRICED``); only contract breaches raise.
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from datetime import date, timedelta
from typing import Any, Final, NamedTuple

import pandas as pd

from services.account_unit import (
    AccountCurrencyBlank,
    AccountCurrencyMalformed,
    AccountCurrencyUnsupported,
    classify_account_currency,
)
from services.broker_dailies import _funding_iso_day, combine_realized_and_funding
from services.external_flows import ExternalFlow
from services.nav_twr import NAV_TWR_GUARD_KEYS
from services.native_to_usd import _usable_closes, convert_native_returns_to_usd
from services.unit_switch import SplitPnl, UnitSwitch

# The latest completed day has no stored close yet: the derive retries it as transient (the MT5
# D-17 rule), unlike every token of ``UNIT_SWITCH_REFUSALS``, which is permanent for the data read.
SWITCH_ANCHOR_UNPRICED: Final[str] = "switch_anchor_unpriced"


class SwitchedSeries(NamedTuple):
    """The whole-history USD headline and the native coin segment of a switched account."""

    # USD daily returns over the whole history: the USD segment through S, then the coin segment
    # converted at the stored closes. All USD; no unit flag.
    headline: pd.Series
    # The USD segment's NavTWRMeta keys plus the coin segment's guard flags, merged by union.
    meta: dict[str, Any]
    usd_returns: pd.Series
    # NATIVE coin returns, index from S + 1 (the first coin return day).
    coin_returns: pd.Series
    # NATIVE daily P&L, dense over the coin return days.
    coin_day_pnl: pd.Series
    # NATIVE realized-basis NAV level at the end of each day from S to the last coin day.
    coin_nav_levels: pd.Series
    # NATIVE signed external flow per day (only days that carry one).
    coin_flow_by_day: dict[str, float]
    # NATIVE level at the end of S.
    coin_base_level: float
    # Coin return days with a formed native return and no priced headline day, ascending ISO.
    unpriced_days: tuple[str, ...]
    # The day the coin segment is based on: S, or the day before the first day the bills read covers
    # when S is older than that window (CR-02). The first coin return is the day after it.
    coin_base_day: str
    # R3-06: the USD days before S that the headline withholds because no mark values the held coin's
    # price move on them (a subset of ``unpriced_days``). They have stored closes: the reader words
    # them by their own cause, never as "no close".
    withheld_days: tuple[str, ...] = ()


def _daily_records(by_day: Mapping[str, float]) -> list[dict[str, Any]]:
    """``{day: amount}`` -> the ``daily_pnl`` record shape ``combine_realized_and_funding`` takes
    (``side`` by sign, ``price`` the absolute amount), the shape ``fetch_daily_pnl`` emits."""
    return [
        {
            "exchange": "",
            "symbol": "UNITSWITCH",
            "side": "buy" if amount >= 0 else "sell",
            "price": abs(amount),
            "quantity": 1,
            "fee": 0,
            "fee_currency": "USDT",
            "timestamp": f"{day}T00:00:00+00:00",
            "order_type": "daily_pnl",
        }
        for day, amount in sorted(by_day.items())
    ]


def _merge_meta(usd_meta: Mapping[str, Any], coin_meta: Mapping[str, Any]) -> dict[str, Any]:
    """The USD segment's meta plus the coin segment's GUARD flags, by union.

    A guard flag (``NAV_TWR_GUARD_KEYS``) or a heuristic-capital / balance-error signal fired in
    either segment is fired, and a status hint of warnings in either is warnings. The coin segment's
    ANNOTATION keys are deliberately not copied: they carry coin-valued numbers (a coin NAV, a coin
    P&L) that must never sit beside USD figures in the stored meta. With no USD segment the base
    is the coin segment's three status keys."""
    out: dict[str, Any] = dict(usd_meta) if usd_meta else {
        "used_heuristic_capital": False,
        "balance_error": False,
        "computation_status_hint": "complete",
        "series_completeness": coin_meta.get("series_completeness"),
    }
    for key in ("used_heuristic_capital", "balance_error"):
        out[key] = bool(out.get(key)) or bool(coin_meta.get(key))
    for key in NAV_TWR_GUARD_KEYS:
        if coin_meta.get(key):
            out[key] = out.get(key) or coin_meta[key]
    if "complete_with_warnings" in (
        out.get("computation_status_hint"),
        coin_meta.get("computation_status_hint"),
    ):
        out["computation_status_hint"] = "complete_with_warnings"
    return out


def _convert_across_holes(native: pd.Series, close_by_day: Mapping[str, float]) -> pd.Series:
    """Native coin returns -> USD returns, where a day with no usable close is carried across.

    Per priced day ``d`` the USD return is ``F x close(d) / close(b) - 1`` with ``F`` the compounded
    ``1 + r`` of every native day after the base ``b`` up to ``d`` and ``b`` the last day with a
    close, so an interval with no holes is exactly ``convert_native_returns_to_usd``'s
    ``(1 + r) x close(d) / close(d - 1) - 1``. A day with no close has no return of its own (it is
    named by the caller) and its move rides on the next priced day. A non-finite native return (a
    guarded day) is not bridged: the chain restarts at that day."""
    days: list[pd.Timestamp] = []
    values: list[float] = []
    base: str | None = None
    factor = 1.0
    for position, (ts, raw) in enumerate(native.sort_index().items()):
        day = ts.date().isoformat()
        close = close_by_day.get(day)
        value = float(raw)
        if position == 0 or not math.isfinite(value) or base is None:
            base = day if close is not None else None
            factor = 1.0
            continue
        factor *= 1.0 + value
        if close is None:
            continue
        days.append(ts)
        values.append(factor * close / close_by_day[base] - 1.0)
        base = day
        factor = 1.0
    return pd.Series(values, index=pd.DatetimeIndex(days), name=native.name, dtype=float)


def build_switched_series(
    *,
    switch: UnitSwitch,
    split: SplitPnl,
    funding_rows: Sequence[Mapping[str, Any]],
    external_flows: Sequence[ExternalFlow],
    anchor_usd: float,
    anchor_price: float,
    open_unrealized_usd: float,
    closes: pd.Series,
    latest_close_day: str,
    usd_full_history: bool,
    span_unpriced_days: bool = False,
    bills_from_day: str | None = None,
    usd_marks: Mapping[str, float] | None = None,
    mixed_from_day: str | None = None,
) -> SwitchedSeries | str:
    """Build the whole-history USD headline and the native coin segment, or return a refusal token.

    ``split`` is ``split_daily_pnl_at_switch``'s result (USD P&L through S, coin P&L after S);
    ``funding_rows`` and ``external_flows`` are USD (a funding row's ``amount``, a flow's
    ``usd_signed``) and are expressed in the coin at their own day's close after S;
    ``anchor_usd`` is the live equity and ``open_unrealized_usd`` its open-position wedge, both USD,
    priced into the coin at ``anchor_price``, the coin's LIVE USD price from the same balance
    response the equity came from (WR-01: dividing a live-price equity by yesterday's close would
    re-scale the whole stored history by the overnight move). ``latest_close_day`` (the latest
    completed UTC day) must still have a stored close, because its coin return is converted with it.

    Refusals: ``coin_without_price_source`` (the coin has no floors row, checked before any
    arithmetic), ``switch_anchor_unpriced``, ``switch_day_unpriced`` (S has no usable close, or is
    later than ``latest_close_day``), ``coin_segment_unpriced`` (an external flow after S on a day
    with no usable close: it cannot be left out without shifting every earlier level). A funding row
    on such a day is left out and the day named. ``span_unpriced_days`` (strategy mode) carries the
    coin level across a hole: the first priced day after it holds the compounded native returns of
    the whole run times the close ratio over it, so no return is lost and no chain breaks. Key mode
    keeps the holes (its compose segments the key at them). ``bills_from_day`` is the first UTC day
    the bills read covers (CR-02): the switch persists after its coin bills age out of that window,
    so S can be older than it. The coin days between S and the window are then NOT rebuilt (their
    P&L is unknown, and zero-return rows would overwrite the stored real ones): the coin segment is
    based on the day before the window and the USD segment, whose P&L lies before it, is not rebuilt
    either; the stored rows and the carried sidecar points keep those days. A ``split`` day on the
    wrong side of S raises ``ValueError``.

    ``usd_marks`` is the stored realized-basis USD level at the end of each marked day, and
    ``mixed_from_day`` the day the coin first shows in the bills (R2-02). The coin held on the mixed
    days (after that day, through S) moves in price and no bill carries the move, so the USD segment
    rolled back from the true equity at S over the booked P&L alone is too high before them and
    every earlier return is too low. Where a mark exists the days up to the earliest mark are
    rebuilt from THAT level (true, and before any unbooked move when it predates the coin); the
    marks block replaces every day from that mark on. A mixed day before the earliest mark (or any
    mixed day when there is no mark) has no true figure: it is left out of the headline (NaN) and
    named in ``unpriced_days``."""
    try:
        unit = classify_account_currency(switch.coin)
    except (AccountCurrencyBlank, AccountCurrencyMalformed, AccountCurrencyUnsupported):
        return "coin_without_price_source"
    if not unit.native:
        return "coin_without_price_source"

    close_by_day = {ts.date().isoformat(): close for ts, close in _usable_closes(closes).items()}
    if close_by_day.get(latest_close_day) is None:
        return SWITCH_ANCHOR_UNPRICED
    last_usd_day = switch.last_usd_day
    switch_close = close_by_day.get(last_usd_day)
    if switch_close is None or last_usd_day > latest_close_day:
        return "switch_day_unpriced"

    for day in split.usd_by_day:
        if day > last_usd_day:
            raise ValueError("a USD return day is dated after the switch day")
    for day in split.coin_by_day:
        if day <= last_usd_day:
            raise ValueError("a coin return day is not after the switch day")

    # --- coin inputs: native P&L, funding and flows after S, in the coin at their own day's close.
    coin_base_day = last_usd_day
    if bills_from_day is not None:
        day_before_window = (date.fromisoformat(bills_from_day) - timedelta(days=1)).isoformat()
        coin_base_day = max(last_usd_day, day_before_window)
    coin_pnl: dict[str, float] = {coin_base_day: 0.0, latest_close_day: 0.0}
    for day, amount in split.coin_by_day.items():
        coin_pnl[day] = coin_pnl.get(day, 0.0) + amount

    funding_usd_side: list[Mapping[str, Any]] = []
    for row in funding_rows:
        day_iso = _funding_iso_day(row.get("timestamp"))
        if day_iso is None:
            continue  # the engine skips an undatable row too; it is in neither segment
        if day_iso <= last_usd_day:
            funding_usd_side.append(row)
            continue
        if day_iso <= coin_base_day:
            continue  # inside the stretch before the bills window that is not rebuilt (CR-02)
        try:
            usd_amount = float(row["amount"])
        except (TypeError, ValueError, KeyError):
            continue
        close = close_by_day.get(day_iso)
        if close is None:
            # No close for the day: the amount cannot be expressed in the coin without a
            # neighbour's price (T-256-10), so it is left out and the day is named unpriced
            # (WR-02), the same way a coin amount on that day is. The account is kept.
            continue
        coin_pnl[day_iso] = coin_pnl.get(day_iso, 0.0) + usd_amount / close

    flows_usd_side: list[ExternalFlow] = []
    coin_flows: list[ExternalFlow] = []
    for flow in external_flows:
        flow_day = date.fromisoformat(str(flow[0])[:10]).isoformat()
        if flow_day <= last_usd_day:
            flows_usd_side.append(flow)
            continue
        if flow_day <= coin_base_day:
            continue  # inside the stretch before the bills window that is not rebuilt (CR-02)
        close = close_by_day.get(flow_day)
        if close is None:
            return "coin_segment_unpriced"
        coin_flows.append(ExternalFlow(flow_day, float(flow[1]) / close))

    # --- coin segment: anchored at the live equity in the coin (the engine's own terminal rule).
    anchor_coin = anchor_usd / anchor_price
    upl_coin = open_unrealized_usd / anchor_price
    terminal_coin = anchor_coin - upl_coin
    coin_full, coin_meta = combine_realized_and_funding(
        _daily_records(coin_pnl),
        [],
        account_balance=anchor_coin,
        external_flows=coin_flows,
        open_unrealized_usd=upl_coin,
        floors=unit.floors,
        full_history=False,
    )

    coin_index = pd.DatetimeIndex(coin_full.index)
    coin_days = [ts.date().isoformat() for ts in coin_index]
    coin_day_pnl_all = pd.Series(
        [coin_pnl.get(day, 0.0) for day in coin_days], index=coin_index, dtype="float64"
    )
    flow_by_day: dict[str, float] = {}
    for flow in coin_flows:
        flow_by_day[flow[0]] = flow_by_day.get(flow[0], 0.0) + flow[1]

    # The NAV identity from the terminal: L(d - 1) = L(d) - P_d - F_d.
    levels = [0.0] * len(coin_days)
    level = terminal_coin
    for k in range(len(coin_days) - 1, -1, -1):
        levels[k] = level
        level = level - float(coin_day_pnl_all.iloc[k]) - flow_by_day.get(coin_days[k], 0.0)
    coin_nav_levels = pd.Series(levels, index=coin_index, dtype="float64", name="coin_nav")
    coin_base_level = float(coin_nav_levels.iloc[0])

    first_coin_ts = pd.Timestamp(coin_base_day) + pd.Timedelta(days=1)
    coin_returns = coin_full[coin_full.index >= first_coin_ts]
    coin_day_pnl = coin_day_pnl_all[coin_day_pnl_all.index >= first_coin_ts]

    # --- USD segment: the engine's realized basis at S, anchored at the coin base level priced at S.
    usd_pnl = dict(split.usd_by_day)
    usd_has_history = coin_base_day == last_usd_day and bool(
        usd_pnl or funding_usd_side or flows_usd_side
    )
    usd_returns: pd.Series
    usd_meta: Mapping[str, Any]
    if usd_has_history:
        usd_pnl.setdefault(last_usd_day, 0.0)
        usd_returns, usd_meta = combine_realized_and_funding(
            _daily_records(usd_pnl),
            funding_usd_side,
            account_balance=coin_base_level * switch_close,
            external_flows=flows_usd_side,
            open_unrealized_usd=0.0,
            full_history=usd_full_history,
        )
        first_mark = min((d for d in (usd_marks or {}) if d <= last_usd_day), default=None)
        withheld_usd_days: tuple[str, ...] = ()
        if first_mark is not None:
            # R2-02: the days through the earliest mark, rolled back from that mark's own level.
            early_pnl = {d: v for d, v in usd_pnl.items() if d <= first_mark}
            early_pnl.setdefault(first_mark, 0.0)
            early, _early_meta = combine_realized_and_funding(
                _daily_records(early_pnl),
                [r for r in funding_usd_side if (_funding_iso_day(r.get("timestamp")) or "") <= first_mark],
                account_balance=float((usd_marks or {})[first_mark]),
                external_flows=[f for f in flows_usd_side if str(f[0])[:10] <= first_mark],
                open_unrealized_usd=0.0,
                full_history=usd_full_history,
            )
            usd_returns = pd.concat(
                [early, usd_returns[usd_returns.index > pd.Timestamp(first_mark)]]
            )
        if mixed_from_day is not None:
            withheld_usd_days = tuple(
                ts.date().isoformat()
                for ts in usd_returns.index
                if mixed_from_day < ts.date().isoformat() <= last_usd_day
                and (first_mark is None or ts.date().isoformat() < first_mark)
            )
            usd_returns = usd_returns.copy()
            usd_returns[[pd.Timestamp(d) for d in withheld_usd_days]] = float("nan")
    else:
        withheld_usd_days = ()
        usd_returns = pd.Series(
            [], index=pd.DatetimeIndex([]).as_unit("us"), dtype="float64", name="returns"
        )
        usd_meta = {}

    # --- headline: USD through S, then the coin days converted at the stored closes.
    converted = (
        _convert_across_holes(coin_full, close_by_day)
        if span_unpriced_days
        else convert_native_returns_to_usd(coin_full, switch.coin, closes)
    )
    converted = converted.copy()
    converted.index = pd.DatetimeIndex(converted.index).as_unit("us")
    if set(usd_returns.index) & set(converted.index):
        raise ValueError("the USD and coin return days overlap")
    headline = pd.concat([usd_returns, converted]).sort_index()
    headline.name = "returns"

    priced = {ts.date().isoformat() for ts in converted.index}
    unpriced_days = withheld_usd_days + tuple(
        day
        for day, value in zip(
            (ts.date().isoformat() for ts in coin_returns.index), coin_returns, strict=True
        )
        if pd.notna(value) and day not in priced
    )

    return SwitchedSeries(
        headline=headline,
        meta=_merge_meta(usd_meta, coin_meta),
        usd_returns=usd_returns,
        coin_returns=coin_returns,
        coin_day_pnl=coin_day_pnl,
        coin_nav_levels=coin_nav_levels,
        coin_flow_by_day=flow_by_day,
        coin_base_level=coin_base_level,
        unpriced_days=unpriced_days,
        coin_base_day=coin_base_day,
        withheld_days=withheld_usd_days,
    )
