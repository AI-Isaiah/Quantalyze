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

# The ONE USD-family settlement-currency set (single source of truth, §3.2).
# A currency whose cash delta is already denominated in USD (no index multiply).
# Promoted here from ``deribit_txn._LINEAR_CURRENCIES`` (which now ALIASES this
# frozenset) so the native core (Phase 79-02) and the Deribit ingest share ONE
# definition that cannot drift. Membership additions are evidence-cited code
# edits (never config/DB/venue metadata): DAI is added over the historical
# {USD, USDC, USDT, EURR} floor as a USD-pegged stablecoin — behavior-neutral for
# Deribit (no DAI wallet exists there, so ``_row_is_linear`` never sees it) and
# correct for the venue-agnostic native channel where a DAI flow is USD-family.
USD_FAMILY: frozenset[str] = frozenset({"USD", "USDC", "USDT", "EURR", "DAI"})


class ExternalFlow(NamedTuple):
    """One dated external cash flow, USD-authoritative with an additive native
    channel.

    Deposit / reward-in POSITIVE, withdrawal NEGATIVE. ``utc_day_iso`` is the
    shared ``_row_utc_day`` day-key ('YYYY-MM-DD'). The first two fields unpack
    positionally as ``(utc_day_iso, usd_signed)`` — the drop-in shape the core's
    indexed access already consumes (``day_raw, usd_raw = flow[0], flow[1]``),
    and the verbatim type the Phase 76 ccxt adapters emit.

    Field semantics (§2.2):
      * ``usd_signed`` keeps its EXACT current meaning — the flow's event-time
        USD value — and stays AUTHORITATIVE for the legacy USD-space path. It is
        never re-derived from the native channel.
      * ``currency`` / ``quantity`` are the additive NATIVE channel (Phase 79+).
        ``currency`` is the settlement currency (UPPERCASE); ``quantity`` is the
        signed native-unit amount. The invariant is
        ``usd_signed == quantity × same-day mark``; for a branch-1 (USD-family)
        flow ``quantity == usd_signed`` with mark ≡ 1.0 (an identity, never
        back-solving). The native core reads ONLY
        ``(utc_day_iso, currency, quantity)`` and never trusts a producer-side
        ``usd_signed``.

    Defaults (``currency='USD'``, ``quantity=None``) keep every existing 2-arg
    producer (deribit_txn.py:670, ccxt_flows.py:295) byte-identical (§2.3).
    """

    utc_day_iso: str
    usd_signed: float
    currency: str = "USD"
    quantity: float | None = None


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

    Indexed access (``flow[0]``/``flow[1]``) rather than a positional 2-unpack so
    the extended 4-field ``ExternalFlow`` and a bare ``(day, usd)`` 2-tuple both
    validate. The optional native channel (``currency``/``quantity``) is
    shape-checked via ``getattr`` so a bare 2-tuple still passes (§2.2).
    """
    day, usd = flow[0], flow[1]
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
    # Native channel (additive) — bare 2-tuples default to the legacy shape.
    currency = getattr(flow, "currency", "USD")
    if not isinstance(currency, str) or not currency or currency != currency.upper():
        raise ValueError(
            f"ExternalFlow.currency must be a non-empty UPPERCASE str; got {currency!r}"
        )
    quantity = getattr(flow, "quantity", None)
    if quantity is not None:
        if isinstance(quantity, bool) or not isinstance(quantity, (int, float)):
            raise ValueError(
                f"ExternalFlow.quantity must be None or a real number; got {quantity!r}"
            )
        if not math.isfinite(float(quantity)):
            raise ValueError(
                f"ExternalFlow.quantity must be finite (no NaN/inf); got {quantity!r}"
            )
    return flow
