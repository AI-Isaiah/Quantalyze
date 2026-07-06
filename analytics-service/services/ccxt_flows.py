"""Pure ccxt deposit/withdrawal → dated EVENT-TIME USD external-flow adapter
(FLOW-03, Phase 76-02).

This is the ccxt analog of Deribit's ``deribit_dated_external_flows_usd``
(``services/deribit_txn.py``): it converts already-fetched ccxt transfer rows
into the shared ``ExternalFlow(utc_day_iso, usd_signed)`` contract for the
flow-aware TWR core, applying (1) a per-venue OWN-TRANSFER exclusion filter and
(2) an EVENT-TIME coin→USD valuation that FAILS LOUD when a same-UTC-day price is
absent. It carries the SAME silent-corruption risk as the Deribit producer: a
non-stable coin flow valued at 1.0 / a current price / dropped is a fabricated
±100% day that mis-anchors the TWR base — so every non-stable flow is valued at
its same-day close from the injected ``price_index``, or the whole
reconstruction fails loud.

Pure/I-O split (RESEARCH Q2): this module owns the MATH only. The I/O price
resolver and the promoted transfer fetch are supplied by the 76-04 wiring —
exactly as ``deribit_ingest`` supplies ``supplemental_index`` to the pure
``deribit_dated_external_flows_usd``. There is NO existing event-time
transfer→USD helper; the injected ``price_index`` is the ONLY price source and
this module performs no ccxt / network / pandas work.

CANONICAL PRICE-INDEX KEY (plan-checker W4): ``price_index`` is keyed by
``tuple[str, str]`` = ``(utc_day_iso, currency_upper)`` where ``utc_day_iso`` is
the 'YYYY-MM-DD' string produced by the shared ``_row_utc_day`` helper and
``currency_upper`` is the UPPERCASE ccxt currency code. The 76-04 index builder
MUST emit this EXACT key shape — a ``datetime.date`` / ``datetime`` key or a
lowercase code would silently miss every lookup and fail loud as a spurious
``NavReconstructionError``.

Per-venue own-transfer semantics (introspected ccxt 4.5.59 — RESEARCH Pattern 2):
  * binance — ``parse_transaction`` maps ``transferType != 0`` into the unified
    ``internal`` flag, so an external transfer has ``internal is False`` and an
    own-transfer has ``internal is True``. Keep iff ``row['internal'] is False``.
  * bybit — ``parse_transaction`` sets ``internal = None`` (do NOT use it). Read
    the raw ``info.withdrawType`` ('0' = on-chain); deposit records are on-chain
    by nature (kept), off-chain/internal withdrawals ('1', ...) are dropped.
  * okx — the deposit-/withdrawal-history endpoints structurally exclude own
    funding↔trading moves and also leave ``internal = None``; every fetched row
    is external, so all are kept (applying the Binance ``is False`` filter here
    would wrongly drop every None-internal row).

Purity: stdlib + typing + the imported shared contract only (``ExternalFlow``,
``_row_utc_day``, ``STABLECOINS``, ``NavReconstructionError``) — no ccxt, no
pandas, no numpy, no network/file I/O.
"""
from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from services.closed_sets import STABLECOINS
from services.deribit_txn import _row_utc_day
from services.external_flows import ExternalFlow
from services.nav_twr import NavReconstructionError

# Canonical price-index key: (utc_day_iso 'YYYY-MM-DD', UPPERCASE currency code).
# Declared here so the 76-04 index builder rides the exact same key shape (W4).
PriceIndex = Mapping[tuple[str, str], float]

# Sentinel distinguishing an ABSENT `amount` field (schema drift → fail loud)
# from a present-but-zero amount (a legitimate observed-no-cash no-op).
_MISSING: Any = object()

_VENUE_BINANCE = "binance"
_VENUE_BYBIT = "bybit"
_VENUE_OKX = "okx"
_KNOWN_VENUES = frozenset({_VENUE_BINANCE, _VENUE_BYBIT, _VENUE_OKX})


def _is_external(row: Mapping[str, Any], venue: str, *, kind: str) -> bool:
    """Per-venue own-transfer exclusion — ``True`` keeps an external flow,
    ``False`` drops an own-transfer. ``venue`` is already normalised/validated by
    the caller; ``kind`` is the lowercased ccxt ``type``."""
    if venue == _VENUE_BINANCE:
        # ccxt maps binance transferType!=0 -> internal=True; external == False.
        return row.get("internal") is False
    if venue == _VENUE_BYBIT:
        # ccxt leaves internal=None for bybit; deposits are on-chain by nature,
        # withdrawals must carry raw info.withdrawType == '0' (on-chain).
        if kind == "deposit":
            return True
        info = row.get("info")
        withdraw_type = info.get("withdrawType") if isinstance(info, Mapping) else None
        return str(withdraw_type) == "0"
    # okx: deposit/withdraw-history rows are structurally external-only.
    return True


def ccxt_rows_to_dated_flows(
    rows: Sequence[Mapping[str, Any]],
    *,
    venue: str,
    price_index: PriceIndex,
) -> list[ExternalFlow]:
    """Convert ccxt deposit/withdrawal rows into a per-UTC-day
    ``list[ExternalFlow]`` (sorted ascending by day), applying the per-venue
    own-transfer filter and event-time coin→USD valuation.

    Per surviving row:
      * SIGN comes from the ccxt ``type`` (``deposit`` → +, ``withdrawal`` → −),
        the single trusted source; ``amount`` supplies MAGNITUDE only and is
        never re-signed from direction. An unsignable ``type`` fails loud.
      * A missing / null / blank ``amount`` fails loud (schema drift would
        silently drop a real capital flow and mis-anchor the TWR base — mirror
        the Deribit ``_MISSING`` guard). A numeric ``0.0`` is a no-op skip that
        needs no price.
      * VALUE: a stablecoin (``STABLECOINS``) is marked at ``1.0``; any other
        currency is valued at ``amount × price_index[(utc_day, ccy_upper)]`` —
        its SAME-UTC-day close. No same-day price → ``NavReconstructionError``
        (never 1.0, never a current price, never dropped).

    Same-UTC-day flows collapse into one summed ``ExternalFlow`` (dict-by-day,
    like the Deribit producer). The day key uses the shared ``_row_utc_day``
    helper so a midnight-adjacent flow lands on the same ``t`` as the pnl it
    offsets. ``price_index`` is the ONLY price source (injected by 76-04).
    """
    normalized = str(venue).lower()
    if normalized not in _KNOWN_VENUES:
        raise NavReconstructionError(
            f"ccxt_rows_to_dated_flows: unknown venue {venue!r} "
            f"(expected one of {sorted(_KNOWN_VENUES)})"
        )

    by_day: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        kind = str(row.get("type", "")).lower()
        if not _is_external(row, normalized, kind=kind):
            continue  # own-transfer: excluded per venue, never an F_t

        if kind == "deposit":
            sign = 1.0
        elif kind == "withdrawal":
            sign = -1.0
        else:
            raise NavReconstructionError(
                f"ccxt {normalized} flow row id={row.get('id')!r} has an "
                f"unsignable type={row.get('type')!r} (expected 'deposit' or "
                "'withdrawal') — refusing to guess the direction of a capital flow"
            )

        # A flow row MUST carry an `amount`. Absent (not merely zero) is schema
        # drift: coalescing absent->0.0 would silently drop a real capital flow.
        raw_amount = row.get("amount", _MISSING)
        if raw_amount is _MISSING:
            raise NavReconstructionError(
                f"ccxt {normalized} flow row id={row.get('id')!r} type={kind!r} "
                "has NO `amount` field — refusing to treat a missing balance-delta "
                "as a zero flow (schema drift would silently drop a real capital "
                "in/out and mis-anchor the flow-aware TWR base)"
            )
        # A present-but-null/blank amount is schema drift too — it must not
        # coalesce to a silent 0.0 dropped flow.
        if raw_amount is None or (
            isinstance(raw_amount, str) and not raw_amount.strip()
        ):
            raise NavReconstructionError(
                f"ccxt {normalized} flow row id={row.get('id')!r} type={kind!r} "
                f"has a null/blank amount={raw_amount!r} — refusing to coalesce it "
                "to a zero flow (schema drift would silently drop a real capital "
                "in/out and mis-anchor the flow-aware TWR base)"
            )
        try:
            amount = float(raw_amount)
        except (TypeError, ValueError) as exc:
            raise NavReconstructionError(
                f"ccxt {normalized} flow row id={row.get('id')!r} type={kind!r} "
                f"has a non-numeric amount={raw_amount!r}"
            ) from exc
        if not math.isfinite(amount):
            raise NavReconstructionError(
                f"ccxt {normalized} flow row id={row.get('id')!r} type={kind!r} "
                f"has a non-finite amount={raw_amount!r} (NaN/inf would sail past "
                "every NAV-denominator guard as a silent corruption)"
            )
        if amount == 0.0:
            continue  # observed flow row, no cash — no entry, no price needed

        # An undatable flow row fails loud as a STRUCTURAL (permanent) error, not
        # a bare ValueError the worker's network over-catch would deem transient.
        try:
            day = _row_utc_day(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError) as exc:
            raise NavReconstructionError(
                f"ccxt {normalized} flow row id={row.get('id')!r}: {exc}"
            ) from exc

        currency = str(row.get("currency", "")).upper()
        if currency in STABLECOINS:
            price = 1.0
        else:
            resolved = price_index.get((day, currency))
            if resolved is None:
                raise NavReconstructionError(
                    f"ccxt {normalized} flow row id={row.get('id')!r}: no "
                    f"same-UTC-day ({day}) price for non-stable {currency!r} in "
                    "the injected price index — refusing to value a coin flow at "
                    "1.0 / a current price / drop it (that would fabricate a "
                    "±return and mis-anchor the flow-aware TWR base)"
                )
            price = float(resolved)

        by_day[day] = by_day.get(day, 0.0) + sign * amount * price

    return [ExternalFlow(day, usd) for day, usd in sorted(by_day.items())]
