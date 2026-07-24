"""Pure, I/O-free MT5 DEAL_TYPE classifier + server-time→UTC day seam.

This module mirrors ``services/deribit_txn.py``'s pure-classification-core
discipline: it imports ONLY the standard library + typing (no network, no
pandas), so the correctness tests are network-free and revert-proof. It is the
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
"""
from __future__ import annotations

import math
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Literal

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


def deal_utc_day(time_value: Any, server_utc_offset_s: int) -> str:
    """Normalize a broker-server-time deal timestamp to its UTC calendar day
    (ISO ``YYYY-MM-DD``) — the ONE server-time→UTC seam (mt5-spike-gonogo.md §7).

    MT5 ``history_deals_get`` returns ``time`` in the broker's server timezone
    (a whole/half-hour offset from UTC), VERBATIM (mt5_client.py:237-239).
    ``server_utc_offset_s`` is the recorded server-ahead-of-UTC offset in seconds;
    subtract it BEFORE bucketing so a near-midnight deal cannot drift onto the
    wrong day (Pitfall 1). The offset value itself is ``[ASSUMED A2]`` until the
    live spike (Phase 134/139) confirms it per broker.

    A missing / undatable / non-numeric / non-finite time RAISES — a deal we
    cannot date must never be silently dropped (mirror
    ``deribit_txn._row_utc_day``'s fail-loud posture)."""
    if isinstance(server_utc_offset_s, bool) or not isinstance(server_utc_offset_s, int):
        raise Mt5DealClassificationError(
            "MT5 server_utc_offset_s must be an int (seconds) — fail loud"
        )
    if isinstance(time_value, datetime):
        aware = (
            time_value
            if time_value.tzinfo is not None
            else time_value.replace(tzinfo=timezone.utc)
        )
        epoch = aware.timestamp()
    elif isinstance(time_value, bool) or not isinstance(time_value, (int, float)):
        raise Mt5DealClassificationError(
            f"MT5 deal time={time_value!r} is not a datable epoch/datetime — fail loud"
        )
    else:
        if not math.isfinite(time_value):
            raise Mt5DealClassificationError(
                "MT5 deal time is non-finite (NaN/Inf) — fail loud"
            )
        epoch = float(time_value)
    try:
        utc_epoch = epoch - server_utc_offset_s
        return datetime.fromtimestamp(utc_epoch, tz=timezone.utc).date().isoformat()
    except (OverflowError, OSError, ValueError) as exc:
        raise Mt5DealClassificationError(
            "MT5 deal time is out of the datable epoch range — fail loud"
        ) from exc
