"""The ONE pure seam that says whether, and when, an OKX account switched from its stable
unit into a coin, and that splits its daily P&L at that switch.

Phase 256 OKXUNITSWITCH plan 01 (SC-1, SC-2, SC-7). An account whose P&L was in a stable coin
and then moved into spot BTC has bills in two units. The fetch refuses such an account by name
(``daily_pnl_non_usd_okx``); this module is what lets a later plan read it instead: it derives
the switch day from data (never a constant for any account) and, where the data cannot say, it
returns a named refusal rather than a guessed date.

Purity: stdlib + typing ONLY, plus ``services.price_rule.is_stable_value`` (itself a leaf that
imports only ``services.closed_sets``). This module is a LEAF beside ``account_unit.py`` and
follows its contract: it performs no I/O, never imports ``job_worker`` or an exchange module,
logs nothing, and no exception or refusal text carries venue text (T-256-01). The coin code and
the holdings symbols are third-party text; the coin is fullmatched against ``[A-Z]{2,10}`` before
use and every refusal is one token of the closed ``UNIT_SWITCH_REFUSALS`` set.

THREE CLOCKS, normalised here and nowhere else (RESEARCH "Switch rule"):

* a bill is bucketed by its UTC day;
* a holdings row stamped ``asof D`` is written about 01:00Z on D, so it describes the END of UTC
  day ``D - 1`` (``end_of_day_holdings_from_rows`` shifts it);
* a mark's ``mark_day`` is already the closed day itself.

BOUNDARY RULE (CONTEXT "Boundary day"): ``S`` is the LAST USD return day. The coin base level is
the end of ``S`` (no return is booked for ``S`` in the coin, as for day 0 of any series), and the
first coin return day is ``S + 1``. Every day therefore appears in exactly one return chain: none
is dropped and none is counted in both units. ``UnitSwitch.first_coin_return_day`` is what
CONTEXT calls the stored switch day; no field is named ``switch_day`` because CONTEXT and RESEARCH
used that word for two different days.

SWITCH DAY (founder rulings 2026-11-27 on CR-01, "Move switch to coin majority", and on R2-01, "95%
coin and stays"): ``S`` is the first end-of-day on which the coin is at least ``COIN_SWITCH_SHARE``
(95 %) of the observed spot holdings (a later switch back needs seven consecutive days under half,
R3-03). It comes ONLY from observed end-of-day holdings: a coin bill never pins it
(a still-mostly-stable account would be reported as 100% coin) and the live balance only confirms the
coin is still held. Coin bills dated on or before ``S`` (transition fees) are valued in USD at their
own day's close and booked into the USD segment by ``split_daily_pnl_at_switch``;
``COIN_LEAD_TOLERANCE_DAYS`` bounds how long before ``S`` the first coin bill may be.
"""
from __future__ import annotations

import math
import re
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Final

from services.price_rule import is_stable_value

# The same code shape ``account_unit`` accepts for a currency, held to upper case: a census coin
# that fails it is not a coin code at all and is never looked up.
_COIN_CODE_RE = re.compile(r"[A-Z]{2,10}")

# How many days coin bills may precede the first coin-majority day before the switch refuses
# (CONTEXT "Decided autonomously", founder-visible product choice). Beyond it, weeks of a
# mostly-stable account would be reported in the coin.
COIN_LEAD_TOLERANCE_DAYS: Final[int] = 14

# The switching coin has "arrived" at an end of day when its share of the day's spot value is at least
# this (founder ruling 2026-11-27, R2-01, "95% coin and stays"): a 75 % coin account is still mostly in
# its stable unit, and the days it spends there are not coin days.
COIN_SWITCH_SHARE: Final[float] = 0.95

# After S, the account has switched back only when the coin is under ``SWITCH_BACK_SHARE`` of the
# end-of-day value on ``SWITCH_BACK_DAYS`` consecutive days (founder ruling 2026-11-27, R3-03,
# "<50% for 7 days"). ``COIN_SWITCH_SHARE`` decides only WHEN the switch happens: a night under 95 %
# after S, or a short stretch under 50 %, changes nothing, and neither does a single live reading.
SWITCH_BACK_SHARE: Final[float] = 0.5
SWITCH_BACK_DAYS: Final[int] = 7

# ANOTHER coin that is itself a majority of the spot value (``two_coins``): a plain majority, unrelated
# to the switch threshold above.
COIN_MAJORITY_SHARE: Final[float] = 0.5

# The only coins that can switch: those with stored daily closes (``benchmark.read_btc_closes``).
# A coin with no price source cannot be converted for the USD headline CONTEXT "Readers" requires,
# so it refuses by name instead of switching.
PRICED_SWITCH_COINS: Final[frozenset[str]] = frozenset({"BTC"})

# The closed refusal set (the style of ``READ_INCOMPLETE_TOKENS``). Every return value of
# ``derive_unit_switch`` and ``split_daily_pnl_at_switch`` that is not a result is one of these.
UNIT_SWITCH_REFUSALS: Final[frozenset[str]] = frozenset(
    {
        "no_coin_evidence",
        "coin_bills_without_majority",
        "two_coins",
        "switch_back",
        "ambiguous_boundary",
        "holdings_unavailable",
        "bills_precede_majority_beyond_tolerance",
        "coin_without_price_source",
        "switch_day_unpriced",
        "coin_segment_unpriced",
    }
)

# coin code -> (first UTC day ISO, bill count), built by the fetch from bills with a non-zero
# ``pnl + fee`` in a non-stable, regex-valid ``ccy``.
CoinBillCensus = Mapping[str, tuple[str, int]]

# (end-of-day ISO day, {symbol: value_usd}), ascending, spot rows only.
EndOfDayHoldings = Sequence[tuple[str, Mapping[str, float]]]


@dataclass(frozen=True, slots=True)
class UnitSwitch:
    """An account's one switch from its stable unit into ``coin``.

    ``last_usd_day`` is S (the last USD return day); ``first_coin_return_day`` is S + 1, the day
    CONTEXT calls the stored switch day."""

    coin: str
    last_usd_day: str
    first_coin_return_day: str


# The async keyword type the fetch gains in plan 03. Declared here as an alias only: this module
# performs no I/O.
UnitSwitchResolver = Callable[[CoinBillCensus], Awaitable[UnitSwitch | str]]


def _parse_day(raw: object) -> date | None:
    """An ISO ``YYYY-MM-DD`` day (a ``date`` passes through), or ``None`` for anything else."""
    if isinstance(raw, date):
        return raw
    if isinstance(raw, str):
        try:
            return date.fromisoformat(raw[:10])
        except ValueError:
            return None
    return None


def _parse_value(raw: object) -> float | None:
    """A finite, non-negative number, or ``None``. A bool is not a value."""
    if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if not math.isfinite(value) or value < 0.0:
        return None
    return value


def _parse_holdings_row(row: Mapping[str, object]) -> tuple[date, str, float] | None:
    """One spot ``allocator_holdings`` row as (asof, upper-cased symbol, value), or ``None`` when its
    asof, symbol or value does not parse (the row is unusable, never a zero)."""
    asof = _parse_day(row.get("asof"))
    symbol = row.get("symbol")
    value = _parse_value(row.get("value_usd"))
    if asof is None or value is None or not isinstance(symbol, str):
        return None
    symbol = symbol.strip().upper()
    return (asof, symbol, value) if symbol else None


def unusable_holdings_rows(rows: Iterable[Mapping[str, object]]) -> tuple[int, int]:
    """(spot rows, spot rows that do not parse) over ``rows``: what ``end_of_day_holdings_from_rows``
    skips, so the caller can log it and refuse when most of the history is unusable."""
    spot = unusable = 0
    for row in rows:
        if row.get("holding_type") != "spot":
            continue
        spot += 1
        if _parse_holdings_row(row) is None:
            unusable += 1
    return spot, unusable


def end_of_day_holdings_from_rows(rows: Iterable[Mapping[str, object]]) -> EndOfDayHoldings:
    """Normalise ``allocator_holdings`` rows to end-of-day value-by-symbol, ascending.

    Keeps ``holding_type == "spot"`` rows only (a derivative leg is not a held coin balance), shifts
    each ``asof`` back one day (the row describes the END of the previous UTC day), and sums the
    finite non-negative ``value_usd`` per upper-cased symbol per day. A row with an unparseable
    asof, symbol or value is skipped: the shares are computed from what parses (the caller counts
    the skipped rows with ``unusable_holdings_rows``), and a bad row never becomes a zero."""
    by_day: dict[date, dict[str, float]] = {}
    for row in rows:
        if row.get("holding_type") != "spot":
            continue
        parsed = _parse_holdings_row(row)
        if parsed is None:
            continue
        asof, symbol, value = parsed
        day_values = by_day.setdefault(asof - timedelta(days=1), {})
        day_values[symbol] = day_values.get(symbol, 0.0) + value
    return [(day.isoformat(), by_day[day]) for day in sorted(by_day)]


@dataclass(frozen=True, slots=True)
class _Shares:
    """One observation's value shares: the census coin, the stable symbols together, and whether a
    DIFFERENT non-stable symbol is itself a majority."""

    coin: float
    stable: float
    other_coin_majority: bool


def _shares(values: Mapping[str, float], coin: str) -> _Shares | None:
    """The shares of ``values`` (value or fraction per symbol), or ``None`` when nothing positive
    and finite is held, so an empty observation is absence of evidence and never a zero share."""
    by_symbol: dict[str, float] = {}
    for symbol, value in values.items():
        if math.isfinite(value) and value > 0.0:
            key = symbol.upper()
            by_symbol[key] = by_symbol.get(key, 0.0) + value
    total = sum(by_symbol.values())
    if total <= 0.0:
        return None
    stable = sum(v for s, v in by_symbol.items() if is_stable_value(s))
    other = max(
        (v for s, v in by_symbol.items() if s != coin and not is_stable_value(s)), default=0.0
    )
    return _Shares(
        coin=by_symbol.get(coin, 0.0) / total,
        stable=stable / total,
        other_coin_majority=other / total >= COIN_MAJORITY_SHARE,
    )


def _switch_at(coin: str, last_usd_day: date) -> UnitSwitch:
    return UnitSwitch(
        coin=coin,
        last_usd_day=last_usd_day.isoformat(),
        first_coin_return_day=(last_usd_day + timedelta(days=1)).isoformat(),
    )


def _switched_back(observed: Sequence[tuple[date, _Shares]], switch_day: date) -> bool:
    """True when, after ``switch_day``, the coin is under ``SWITCH_BACK_SHARE`` on
    ``SWITCH_BACK_DAYS`` consecutive calendar days (R3-03). A day with no observation, or a day at or
    over the share, ends the stretch."""
    streak = 0
    previous: date | None = None
    for day, shares in sorted(observed, key=lambda entry: entry[0]):
        if day <= switch_day:
            continue
        if shares.coin < SWITCH_BACK_SHARE:
            streak = streak + 1 if previous is not None and day - previous == timedelta(days=1) else 1
            previous = day
            if streak >= SWITCH_BACK_DAYS:
                return True
        else:
            streak = 0
            previous = None
    return False


def _confirm_stored_switch(
    prior: UnitSwitch,
    census: CoinBillCensus,
    end_of_day_holdings: EndOfDayHoldings,
    live_share: Mapping[str, float] | None,
) -> UnitSwitch | str:
    """The stored switch ``prior`` while the evidence still agrees with it, else a refusal token.

    A switch, once derived, persists (CR-02): the bills read reaches back a fixed window, so the
    coin bills that showed the switch age out and an empty census is no evidence of "no switch".
    S is never re-derived and never moves as bills age out. Newer evidence can still contradict the
    switch: a census coin other than the stored one, another coin that is a majority (``two_coins``),
    or the coin under half of the end-of-day value for seven days running after S (``switch_back``,
    R3-03). The live balance never refuses on its own."""
    if any(code.upper() != prior.coin for code in census):
        return "two_coins"
    observed: list[tuple[date, _Shares]] = []
    for day_iso, values in end_of_day_holdings:
        day = _parse_day(day_iso)
        shares = _shares(values, prior.coin)
        if day is not None and shares is not None:
            observed.append((day, shares))
    live = _shares(live_share, prior.coin) if live_share is not None else None
    if any(s.other_coin_majority for _, s in observed) or (live is not None and live.other_coin_majority):
        return "two_coins"
    if _switched_back(observed, date.fromisoformat(prior.last_usd_day)):
        return "switch_back"
    return prior


def derive_unit_switch(
    census: CoinBillCensus,
    end_of_day_holdings: EndOfDayHoldings,
    live_share: Mapping[str, float] | None,
    prior: UnitSwitch | None = None,
) -> UnitSwitch | str:
    """The account's switch into a coin, or a token of ``UNIT_SWITCH_REFUSALS``. Never a guess.

    ``census`` is the coin bills' (first UTC day, count) per coin; ``end_of_day_holdings`` is the
    normalised spot holdings (``end_of_day_holdings_from_rows``); ``live_share`` is the current
    value share per symbol, for a key whose holdings history is absent or stale.

    The arms are evaluated in this order, so each case names its own first failing condition:
    no usable census coin (``no_coin_evidence``, which also covers a census coin that is not a
    code, is a stable, or carries no parseable day), more than one census coin (``two_coins``),
    a coin with no stored closes (``coin_without_price_source``), no holdings and no live balance
    (``holdings_unavailable``), a different coin that is itself a majority (``two_coins``), no
    observed holdings (``holdings_unavailable``, or ``coin_bills_without_majority`` when the live
    balance is not the coin either), no observed day at the switch share
    (``coin_bills_without_majority``), a coin under ``SWITCH_BACK_SHARE`` on ``SWITCH_BACK_DAYS``
    consecutive days after S (``switch_back``; R3-03), a first coin bill more than
    ``COIN_LEAD_TOLERANCE_DAYS`` before S (``bills_precede_majority_beyond_tolerance``), and an S
    with no observation of the day before it (``ambiguous_boundary``).

    ``prior`` is the switch an earlier derive stored for this account (CR-02). When given, the switch
    persists: the result is ``prior`` itself unless the evidence now contradicts it, whatever the
    census (the bills window may no longer show the coin bills) and however old the bills are."""
    if prior is not None:
        return _confirm_stored_switch(prior, census, end_of_day_holdings, live_share)
    if not census:
        return "no_coin_evidence"
    if len(census) > 1:
        return "two_coins"
    ((raw_coin, (first_bill_day, _count)),) = census.items()
    coin = raw_coin.upper()
    first_bill = _parse_day(first_bill_day)
    if _COIN_CODE_RE.fullmatch(coin) is None or is_stable_value(coin) or first_bill is None:
        return "no_coin_evidence"
    if coin not in PRICED_SWITCH_COINS:
        return "coin_without_price_source"

    observed: list[tuple[date, _Shares]] = []
    for day_iso, values in end_of_day_holdings:
        day = _parse_day(day_iso)
        shares = _shares(values, coin)
        if day is not None and shares is not None:
            observed.append((day, shares))
    observed.sort(key=lambda entry: entry[0])
    live = _shares(live_share, coin) if live_share is not None else None
    if not observed and live is None:
        return "holdings_unavailable"

    if any(s.other_coin_majority for _, s in observed) or (live is not None and live.other_coin_majority):
        return "two_coins"

    # S comes ONLY from observed end-of-day holdings (CR-01, founder ruling "Move switch to coin
    # majority"): a coin bill never pins it and the live balance only confirms the coin is still
    # held. With no holdings history nothing says when the coin became the majority (SF-01).
    if not observed:
        if live is not None and live.coin < COIN_SWITCH_SHARE:
            return "coin_bills_without_majority"
        return "holdings_unavailable"
    # The coin is not (yet) the observed majority: bills or a live balance that moved after the last
    # stored holdings day do not make it one.
    if not any(s.coin >= COIN_SWITCH_SHARE for _, s in observed):
        return "coin_bills_without_majority"

    # S is the FIRST end-of-day at the switch share (R3-03): later nights under it do not move S,
    # and only SWITCH_BACK_DAYS consecutive days under half after S refuse. A live reading never
    # refuses on its own.
    run_start = next(i for i, (_, s) in enumerate(observed) if s.coin >= COIN_SWITCH_SHARE)
    switch_day = observed[run_start][0]
    if _switched_back(observed, switch_day):
        return "switch_back"
    if (switch_day - first_bill).days > COIN_LEAD_TOLERANCE_DAYS:
        return "bills_precede_majority_beyond_tolerance"
    if run_start == 0 or observed[run_start - 1][0] != switch_day - timedelta(days=1):
        return "ambiguous_boundary"
    return _switch_at(coin, switch_day)


@dataclass(frozen=True, slots=True)
class SplitPnl:
    """A daily P&L series split at the switch. Every input day is in exactly one of the two."""

    usd_by_day: dict[str, float]
    coin_by_day: dict[str, float]


def _usable_close(closes: Mapping[str, float], day: str) -> float | None:
    """The stored close for ``day`` when finite and positive (the ``native_to_usd`` rule), else
    ``None``. A close is never borrowed from a neighbour day."""
    close = closes.get(day)
    if close is None or not math.isfinite(close) or close <= 0.0:
        return None
    return close


def split_daily_pnl_at_switch(
    stable_by_day: Mapping[str, float],
    coin_by_day: Mapping[str, float],
    switch: UnitSwitch,
    closes: Mapping[str, float],
) -> SplitPnl | str:
    """Put every day of the stable and coin P&L in exactly one unit, or refuse by name.

    Days are ISO UTC ``YYYY-MM-DD`` keys. Through ``switch.last_usd_day`` (S) the day is a USD return
    day: stable P&L is already USD, and a coin amount dated on or before S (a transition fee bill
    before the coin became the majority, or a bill dated S itself) is valued at its OWN day's stored
    close and booked in the USD segment, never in the coin (CR-01). From ``first_coin_return_day``
    (S + 1) the day is a coin return day: a coin amount keeps its native value and a stable amount
    is divided by its own day's close.

    A needed close that is missing, non-finite or not positive refuses (``switch_day_unpriced`` for
    a coin amount on or before S: a USD day cannot be left out of the chain, so the account is named
    rather than given a figure with the amount missing); a stable amount after S with no close is
    left out of the coin and the day is named by the builder (``unpriced_days``), never priced at a
    neighbour's close (T-256-10). A zero amount needs no close."""
    switch_day = date.fromisoformat(switch.last_usd_day)
    usd: dict[str, float] = {}
    coin: dict[str, float] = {}

    for day in sorted(coin_by_day):
        amount = coin_by_day[day]
        if date.fromisoformat(day) > switch_day:
            coin[day] = coin.get(day, 0.0) + amount
            continue
        close = _usable_close(closes, day)
        if close is None and amount != 0.0:
            return "switch_day_unpriced"
        usd[day] = usd.get(day, 0.0) + (amount * close if close is not None else 0.0)

    for day in sorted(stable_by_day):
        amount = stable_by_day[day]
        if date.fromisoformat(day) <= switch_day:
            usd[day] = usd.get(day, 0.0) + amount
            continue
        close = _usable_close(closes, day)
        # No close: the amount cannot be expressed in the coin without borrowing a neighbour's
        # price, so it is left out and the day is named unpriced (WR-02, SF-03), not a refusal.
        coin[day] = coin.get(day, 0.0) + (amount / close if close is not None else 0.0)

    return SplitPnl(usd_by_day=usd, coin_by_day=coin)
