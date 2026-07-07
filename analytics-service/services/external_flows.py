"""The ONE venue-agnostic dated external-flow contract (FLOW-01, Phase 75).

This module defines the single shape the honest core
(``nav_twr.reconstruct_nav_and_twr(external_flows=...)``) consumes for an
external cash flow, REGARDLESS of venue. Deribit produces ``list[ExternalFlow]``
here in Phase 75; the ccxt adapters (Binance/Bybit/OKX) import this SAME type
verbatim in Phase 76 — one flow shape, one contract, no per-venue divergence.

Contract (sign + units are locked by ROADMAP SC-1):

    ExternalFlow(utc_day_iso: str, usd_signed: float)
      * ``utc_day_iso`` — 'YYYY-MM-DD', the shared ``_row_utc_day`` day-key (the
        SAME UTC-day boundary the realized/funding buckets use, so a
        midnight-adjacent flow lands on the ``t`` of the pnl it offsets).
      * ``usd_signed`` — the flow's EVENT-TIME USD value. Deposit / reward-in is
        POSITIVE, withdrawal is NEGATIVE (the ledger credit(+)/debit(-) sign,
        trusted verbatim — never re-derived from direction).

Drop-in for the core: a ``NamedTuple`` unpacks positionally as ``(day, usd)``,
which is exactly ``day_raw, usd_raw = flow`` in ``nav_twr._flows_to_daily_usd``
(nav_twr.py:123-129). The core then re-dates via ``_row_utc_day`` and fail-loud
coerces via ``_coerce_float`` — so this module owns SHAPE ONLY and deliberately
does NOT re-implement that valuation/dating business logic.

Purity: stdlib + typing ONLY — no ccxt, no pandas, no numpy, no network, no
file/DB I/O, no coupling to any I/O ``services.*`` module. This mirrors the
``services/deribit_txn.py`` import discipline so the contract stays inert and
Phase 76 can import it without dragging in a valuation/I/O dependency.
"""
import math
from typing import NamedTuple


class ExternalFlow(NamedTuple):
    """One dated external cash flow in event-time USD.

    Deposit / reward-in POSITIVE, withdrawal NEGATIVE. ``utc_day_iso`` is the
    shared ``_row_utc_day`` day-key ('YYYY-MM-DD'). Unpacks positionally as
    ``(utc_day_iso, usd_signed)`` — the drop-in shape the core already consumes
    (``day_raw, usd_raw = flow``), and the verbatim type the Phase 76 ccxt
    adapters emit.
    """

    utc_day_iso: str
    usd_signed: float


def validate_flow_shape(flow: ExternalFlow) -> ExternalFlow:
    """OPTIONAL shape-only validation of an ``ExternalFlow`` (FLOW-01, T-75-01).

    Rejects the two shapes that would corrupt the core silently:
      * a non-finite ``usd_signed`` (NaN / ±inf) — it would sail past every
        downstream NAV-denominator guard (all ``nan <op>`` compares are False)
        and emit a silent NaN return stamped ``complete``;
      * an empty / whitespace ``utc_day_iso`` — a flow we cannot key onto a UTC
        day is realized cash that would otherwise be silently misplaced.

    This is SHAPE validation, NOT business logic: the core still owns the
    authoritative fail-loud ``_coerce_float`` / ``_row_utc_day`` re-checks. On
    success the flow is returned UNCHANGED (identity — no coercion/mutation), so
    a caller can inline ``validate_flow_shape(ExternalFlow(day, usd))``.
    """
    day, usd = flow
    if not isinstance(day, str) or not day.strip():
        raise ValueError(
            f"ExternalFlow.utc_day_iso must be a non-empty day string; got {day!r}"
        )
    if isinstance(usd, bool) or not isinstance(usd, (int, float)):
        raise ValueError(
            f"ExternalFlow.usd_signed must be a real number; got {usd!r}"
        )
    if not math.isfinite(float(usd)):
        raise ValueError(
            f"ExternalFlow.usd_signed must be finite (no NaN/inf); got {usd!r}"
        )
    return flow
