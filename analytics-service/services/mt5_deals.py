"""Pure, I/O-free MT5 DEAL_TYPE classifier + server-time→UTC day seam.

This module mirrors ``services/deribit_txn.py``'s pure-classification-core
discipline: it imports ONLY the standard library, typing and one other
stdlib-only leaf, ``services.mt5_server_clock`` (no network, no pandas, no import
cycle: the clock imports nothing from ``services``), so the correctness tests are
network-free and revert-proof. It is the
ONE place the MT5 ``DEAL_TYPE`` table lives — ``combine_mt5_deal_ledger`` imports
from here rather than re-implementing the table (the backbone-unification
principle: nothing re-classifies).

Classification is an ALLOW-LIST, not a block-list (the deribit-``correction``
lesson, [[project_deribit_correction_txn_type_unhandled]]): an unknown or
ambiguous ``DEAL_TYPE`` FAILS LOUD rather than being silently dropped or coerced
to a flow. Capital can never masquerade as trading performance.

DEAL_TYPE enum (MetaTrader5 standard values — ``[ASSUMED]`` for the ambiguous
middle until the 134/139 live spike; the exact CHARGE/INTEREST/CANCELED/DIVIDEND/
TAX classification is locked behind the plan 136-05 human-verify checkpoint, see
136-RESEARCH.md Q2):

    BUY=0, SELL=1                          → trading (market fills, realized PnL)
    BALANCE=2   [VERIFIED mt5_spike.py:88] → external_flow (deposit/withdrawal)
    CREDIT=3, BONUS=6                      → external_flow (broker credit/bonus)
    COMMISSION family 7..11                → trading (recurring/agent commission cost)
    CHARGE=4      [ASSUMED — 136-05]       → FAIL LOUD (cost vs flow undecided)
    CORRECTION=5  [ASSUMED — 136-05]       → FAIL LOUD (never assume trading/capital)
    INTEREST=12   [ASSUMED — 136-05]       → FAIL LOUD (return vs flow undecided)
    BUY/SELL_CANCELED 13/14 [ASSUMED]      → FAIL LOUD (no economic effect? confirm)
    DIVIDEND 15/16, TAX=17 [ASSUMED]       → FAIL LOUD (return vs cost undecided)
    any unlisted int                       → FAIL LOUD

DEAL_ENTRY enum (FLOWTIMING D-10; closes RESEARCH assumption A1):

    IN=0, OUT=1, INOUT=2 (reverse), OUT_BY=3 (closed by an opposite position)
        [VERIFIED — vendor package MetaTrader5 5.0.6231 (cp312 win_amd64 wheel,
        sha256 b94b1f8f52087ae36dfac5f352a96f5d04fe308704d9515f82cf5d1470bc31d4),
        file MetaTrader5/__init__.py (sha256 2e3bc321ab35b5c9e6c777665f381bc686bbf60791160838a0e84406dc0052cf),
        block ``# ENUM_DEAL_ENTRY``: DEAL_ENTRY_IN = 0, DEAL_ENTRY_OUT = 1,
        DEAL_ENTRY_INOUT = 2, DEAL_ENTRY_OUT_BY = 3. The same file's
        ``ENUM_DEAL_TYPE`` block agrees with the DEAL_TYPE table above.
        Read as text, never imported or executed.]
    any other int, or a non-int       → unresolvable (``deal_entry_code`` is None)
"""
from __future__ import annotations

import math
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from fractions import Fraction
from typing import Any, Literal

from services.mt5_server_clock import Mt5ServerClock, fixed_server_clock

_EPOCH0 = datetime(1970, 1, 1, tzinfo=timezone.utc)

# The realized-PnL / trading-cost types whose ``profit+swap+commission+fee`` is
# folded into daily trading PnL. BUY/SELL are market fills; 7..11 are the
# COMMISSION family (per-deal, daily, monthly, agent daily/monthly) — a cost that
# reduces equity, NOT an external flow.
_MT5_TRADING_DEAL_TYPES: frozenset[int] = frozenset({0, 1, 7, 8, 9, 10, 11})

# The external-capital types removed from the return NUMERATOR (never trading
# performance). BALANCE=2 is the deposit/withdrawal signal established in the
# spike ([VERIFIED mt5_spike.py:88]); CREDIT=3 and BONUS=6 are broker capital
# grants, not the user's trading PnL.
_MT5_EXTERNAL_FLOW_DEAL_TYPES: frozenset[int] = frozenset({2, 3, 6})

# The two sets MUST be disjoint — a type in both would be simultaneously folded
# as PnL AND as an external flow (order-dependent silent corruption). Enforced at
# import (deribit_txn.py:552 precedent).
assert not (_MT5_TRADING_DEAL_TYPES & _MT5_EXTERNAL_FLOW_DEAL_TYPES), (
    "MT5 trading and external-flow DEAL_TYPE sets must be disjoint"
)


# DEAL_ENTRY codes, pinned from the vendor package (module header). An entry code
# outside this set is unresolvable, never a default: the fold sends the day to
# the day-level rule (D-07) instead of guessing which deal opened a position.
MT5_DEAL_ENTRY_IN = 0
MT5_DEAL_ENTRY_OUT = 1
MT5_DEAL_ENTRY_INOUT = 2
MT5_DEAL_ENTRY_OUT_BY = 3
_MT5_KNOWN_DEAL_ENTRIES: frozenset[int] = frozenset(
    {
        MT5_DEAL_ENTRY_IN,
        MT5_DEAL_ENTRY_OUT,
        MT5_DEAL_ENTRY_INOUT,
        MT5_DEAL_ENTRY_OUT_BY,
    }
)


class Mt5DealClassificationError(ValueError):
    """An MT5 deal could not be classified against the locked allow-lists, or a
    money/time field failed fail-loud coercion — permanent and structural (an
    unknown/ambiguous DEAL_TYPE, an undatable timestamp, a non-finite amount),
    NOT a transient network condition. Subclasses ``ValueError`` so a job-worker
    callsite can disposition it PERMANENT, mirroring
    ``nav_twr.NavReconstructionError`` / ``deribit_txn.LedgerValuationError``.

    Leak-safety (T-136-03): the message carries the DEAL_TYPE CODE and the
    offending FIELD NAME only — NEVER a raw USD amount (the nav_twr / native_nav
    leak-safe raise convention). Capital figures must not leak through an error
    string.
    """


def _deal_type_code(deal: Mapping[str, Any]) -> int:
    """Extract a strict integer DEAL_TYPE code or fail loud.

    ``bool`` is rejected even though it is an ``int`` subclass — ``True`` would
    otherwise masquerade as ``SELL`` (1). A missing / float / string / None type
    is schema drift and fails loud rather than being truncated into a
    classification."""
    raw = deal.get("type")
    if isinstance(raw, bool) or not isinstance(raw, int):
        raise Mt5DealClassificationError(
            f"MT5 deal DEAL_TYPE={raw!r} is not an integer enum code — fail loud "
            "(schema drift; never truncate/coerce a type into a classification)"
        )
    return raw


def classify_deal(deal: Mapping[str, Any]) -> Literal["trading", "external_flow"]:
    """Classify one MT5 deal row by its ``type`` (``DEAL_TYPE_*`` int).

    Returns ``"trading"`` (realized PnL / cost, folded into daily returns) or
    ``"external_flow"`` (capital in/out, subtracted from the return numerator).
    Raises ``Mt5DealClassificationError`` for CORRECTION and every other
    ambiguous / unlisted type — an ALLOW-LIST, not a block-list, so an
    unrecognized type can never silently leak into (or out of) the series."""
    type_code = _deal_type_code(deal)
    if type_code in _MT5_TRADING_DEAL_TYPES:
        return "trading"
    if type_code in _MT5_EXTERNAL_FLOW_DEAL_TYPES:
        return "external_flow"
    raise Mt5DealClassificationError(
        f"MT5 DEAL_TYPE {type_code} is not classifiable — not in the trading "
        "(BUY/SELL/COMMISSION) or external-flow (BALANCE/CREDIT/BONUS) allow-list. "
        "Ambiguous/unknown types (CHARGE/CORRECTION/INTEREST/CANCELED/DIVIDEND/TAX) "
        "fail loud pending the 136-05 human-verify checkpoint."
    )


def _coerce_money(value: Any, *, field: str) -> float:
    """Coerce an untrusted money field to a finite ``float`` or fail loud.

    Rejects ``bool`` (an ``int`` subclass whose truthiness is not a dollar
    amount), non-numeric values, and NaN/Inf. A non-finite value would sail past
    every downstream NAV-denominator guard (all ``nan <op>`` compares are False)
    and emit a silent-NaN return stamped ``complete`` — the exact
    "invalid presented as valid" harm this module exists to prevent
    (nav_twr._coerce_float discipline). The raise names the FIELD only, never the
    value (leak-safety T-136-02/03)."""
    if isinstance(value, bool):
        raise Mt5DealClassificationError(
            f"MT5 deal {field} is a bool; expected a numeric amount"
        )
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise Mt5DealClassificationError(
            f"MT5 deal {field} is non-numeric — fail loud (no silent-NaN record)"
        ) from exc
    if not math.isfinite(result):
        raise Mt5DealClassificationError(
            f"MT5 deal {field} is non-finite (NaN/Inf) — fail loud"
        )
    return result


def deal_cash_effect(deal: Mapping[str, Any]) -> float:
    """Sum a trading deal's realized cash effect: ``profit + swap + commission +
    fee``, each field summed exactly ONCE ([ASSUMED A3] fold convention — a broker
    that double-posts commission as both a field AND a separate DEAL_TYPE row is
    caught by the reconcile-to-equity gate + the 136-05 checkpoint). A missing
    field defaults to 0.0; a present-but-non-finite/non-numeric field fails loud."""
    total = 0.0
    for field in ("profit", "swap", "commission", "fee"):
        raw = deal.get(field, 0.0)
        if raw is None:
            continue
        total += _coerce_money(raw, field=field)
    return total


def _server_clock(server_utc_offset_s: Any) -> Mt5ServerClock:
    """The one clock the day and the instant share: an ``Mt5ServerClock`` as given,
    or a bare int (seconds) wrapped as the fixed form. Anything else fails loud."""
    if isinstance(server_utc_offset_s, Mt5ServerClock):
        return server_utc_offset_s
    if isinstance(server_utc_offset_s, bool) or not isinstance(server_utc_offset_s, int):
        raise Mt5DealClassificationError(
            "MT5 server_utc_offset_s must be an int (seconds) or an Mt5ServerClock "
            "— fail loud"
        )
    return fixed_server_clock(server_utc_offset_s)


def _server_epoch_seconds(time_value: Any) -> float:
    """Read a deal's broker-server ``time`` as epoch seconds or fail loud.

    The ONE place a deal's ``time`` is parsed: ``deal_utc_day`` and
    ``deal_utc_instant_ms`` both go through it, so the day and the instant can
    never read the same field two ways."""
    if isinstance(time_value, datetime):
        aware = (
            time_value
            if time_value.tzinfo is not None
            else time_value.replace(tzinfo=timezone.utc)
        )
        return aware.timestamp()
    if isinstance(time_value, bool) or not isinstance(time_value, (int, float)):
        raise Mt5DealClassificationError(
            f"MT5 deal time={time_value!r} is not a datable epoch/datetime — fail loud"
        )
    if not math.isfinite(time_value):
        raise Mt5DealClassificationError(
            "MT5 deal time is non-finite (NaN/Inf) — fail loud"
        )
    return float(time_value)


def _utc_day_of_server_epoch(epoch: float, server_utc_offset_s: int) -> str:
    """The UTC calendar day (ISO) of a server-time epoch, offset removed first."""
    try:
        utc_epoch = epoch - server_utc_offset_s
        return datetime.fromtimestamp(utc_epoch, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError) as exc:
        raise Mt5DealClassificationError(
            "MT5 deal time is out of the datable epoch range — fail loud"
        ) from exc


def _deal_offsets(clock: Mt5ServerClock, epoch: float) -> tuple[int, int | None]:
    """``(day offset, instant offset)`` in force at the deal's own broker wall
    second, looked up ONCE so the day and the instant always read one clock. A
    wall second the clock cannot date (an epoch ``datetime`` cannot represent, or a
    year outside the DST rule's 2007-2099 span) fails loud with text that names the
    rule's span, so it is not read as a fault in the account's own ledger."""
    try:
        wall = math.floor(epoch)
        return clock.day_offset_s(wall), clock.instant_offset_s(wall)
    except (OverflowError, OSError, ValueError) as exc:
        raise Mt5DealClassificationError(
            "MT5 deal time is outside the dates the broker server-clock rule "
            "covers (2007-2099) — fail loud"
        ) from exc


def deal_utc_day(time_value: Any, server_utc_offset_s: int | Mt5ServerClock) -> str:
    """Normalize a broker-server-time deal timestamp to its UTC calendar day
    (ISO ``YYYY-MM-DD``) — the ONE server-time→UTC seam (mt5-spike-gonogo.md §7).

    MT5 ``history_deals_get`` returns ``time`` in the broker's server timezone
    (a whole/half-hour offset from UTC), VERBATIM (mt5_client.py:237-239).
    ``server_utc_offset_s`` is the server clock: a bare int is the fixed
    server-ahead-of-UTC offset in seconds, and an ``Mt5ServerClock`` follows the
    broker's daylight-saving rule (Phase 175, D-01) and gives the offset in force
    at THIS deal's own wall second. Subtract it BEFORE bucketing so a
    near-midnight deal cannot drift onto the wrong day (Pitfall 1). Which clock
    is configured is the worker setting resolved by
    ``mt5_server_clock.resolve_mt5_server_clock``; checking it against the live
    server is Phase 155's (MT5-06), not this seam's.

    A missing / undatable / non-numeric / non-finite time RAISES — a deal we
    cannot date must never be silently dropped (mirror
    ``deribit_txn._row_utc_day``'s fail-loud posture)."""
    clock = _server_clock(server_utc_offset_s)
    epoch = _server_epoch_seconds(time_value)
    day_offset_s, _instant_offset_s = _deal_offsets(clock, epoch)
    return _utc_day_of_server_epoch(epoch, day_offset_s)


def _integral_millis(value: Any) -> int | None:
    """``value`` as a plain int millisecond count, or None when it is not one:
    a bool, a fractional or non-finite float, or any non-numeric shape."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and math.isfinite(value) and value.is_integer():
        return int(value)
    return None


def deal_utc_instant_ms(
    deal: Mapping[str, Any], server_utc_offset_s: int | Mt5ServerClock
) -> int | None:
    """A deal's UTC instant in epoch MILLISECONDS, or ``None`` when it cannot be
    trusted (FLOWTIMING D-08, D-09, D-07).

    The instant is ``time_msc - server_utc_offset_s * 1000`` when the venue gives
    ``time_msc`` (millisecond precision, D-09), else the deal's own ``time`` in
    milliseconds with the same offset removed. It shares ONE offset argument and
    ONE ``time`` parser with ``deal_utc_day``, so its UTC day is always the day
    ``deal_utc_day`` gives the same deal (D-08); a second conversion would
    mis-bucket near-midnight deals.

    The only raise is the shared ``time`` parse, exactly where ``deal_utc_day``
    already raises for every deal today (same class, same message), so no derive
    that succeeds today can fail on the instant. Everything else that is wrong
    answers ``None`` — D-07: an untrustworthy instant is NO instant, and the fold
    degrades that day to the day-level rule. ``None`` is returned when
    ``time_msc`` is present but a bool, fractional, non-finite or non-numeric, or
    falls in a different second than the deal's own ``time``. Nothing is ever
    defaulted: not to ``time``, not to midnight, not to noon.

    The offset decides which UTC day a deal lands on AND, since NAVMTM D-23, on
    which side of a mark's read a flow falls: a mark is a true-UTC observation, so
    a flow is compared with it by its own instant. The offset therefore has to be
    right per deal, and it now comes from the broker's rule (Phase 175, D-01): an
    ``Mt5ServerClock`` looks up the offset in force at THIS deal's broker wall
    second, once, for the day and the instant alike (NAVMTM REVIEW-3 WR-02: a
    fixed integer was an hour off for the months the broker is on standard time).
    In the one hour a transition repeats or skips, the broker clock names two
    candidate instants or none, so the instant is ``None`` and the day uses the
    first occurrence (or the pre-transition offset), which cannot change the UTC
    day. Residual assumption A2: a broker that flips its clock at another weekend
    moment than the rule's is an hour off for the deals stamped in between."""
    clock = _server_clock(server_utc_offset_s)
    epoch = _server_epoch_seconds(deal.get("time"))
    day_offset_s, instant_offset_s = _deal_offsets(clock, epoch)
    # Same range check deal_utc_day performs, so the instant never succeeds where
    # the day raises; the day string is also the agreement oracle below.
    day = _utc_day_of_server_epoch(epoch, day_offset_s)
    if instant_offset_s is None:
        # A repeated or skipped broker hour (D-07): no trustworthy instant, never a
        # default. The day above still stands.
        return None

    raw_msc = deal.get("time_msc")
    if raw_msc is None:
        if epoch.is_integer():
            server_ms = int(epoch) * 1000
        else:
            server_ms = math.floor(Fraction(epoch) * 1000)
    else:
        msc = _integral_millis(raw_msc)
        if msc is None or msc // 1000 != math.floor(epoch):
            return None
        server_ms = msc
    instant_ms = server_ms - instant_offset_s * 1000

    # The instant must sit on the UTC day deal_utc_day gives this deal. Exact
    # integer arithmetic; a disagreement (a sub-millisecond rounding edge at a
    # midnight) is an untrustworthy instant, never a time on another day.
    try:
        instant_day = (_EPOCH0 + timedelta(milliseconds=instant_ms)).date().isoformat()
    except OverflowError:
        return None
    return instant_ms if instant_day == day else None


def deal_entry_code(deal: Mapping[str, Any]) -> int | None:
    """The deal's ``DEAL_ENTRY`` code (IN=0, OUT=1, INOUT=2, OUT_BY=3) or ``None``.

    ``None`` for an absent, ``bool``, non-int or unknown code. Unknown is
    unresolvable and is never defaulted; it never raises, because an unresolvable
    open sends the whole day to the day-level rule (D-07) rather than failing the
    derive."""
    raw = deal.get("entry")
    if isinstance(raw, bool) or not isinstance(raw, int):
        return None
    return raw if raw in _MT5_KNOWN_DEAL_ENTRIES else None


def deal_position_id(deal: Mapping[str, Any]) -> int | None:
    """The deal's ``position_id`` (a positive int ticket) or ``None``.

    ``None`` for an absent, ``bool``, non-int, zero or negative id: MT5 gives
    account-level commission/fee/balance deals ``position_id == 0``, which belong
    to no position. Never raises (D-07, same reason as ``deal_entry_code``)."""
    raw = deal.get("position_id")
    if isinstance(raw, bool) or not isinstance(raw, int) or raw <= 0:
        return None
    return raw
