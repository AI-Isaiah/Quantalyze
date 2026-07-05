"""Deribit transaction-log correctness core — PURE, I/O-free (P70 RISKY).

This is the single place the Deribit ledger's silent-corruption risks (sign
flips, cross-time conversion, funding double-count) are killed with revert-proof
tests BEFORE any I/O code exists. It imports nothing beyond stdlib + typing (no
ccxt, no supabase, no pandas, no services.exchange), so options can never reach
perp fill math through this module and the correctness tests stay network-free.

LOCKED design pins (analytics-service/docs/deribit-ingestion-design.md):

* D-05 — `classify_instrument` lives here as a SINGLE definition, lifted verbatim
  from the ground-truth harness; the harness imports it back (scope-gate
  precedent). Never raises on untrusted exchange input.

* A1 (Wave-0, live) — `type=settlement` rows carry an event-time `index_price`
  (account 3: 218/218 present; `mark_price` absent). Inverse coin->USD =
  `coin_delta x index_price` at the row's OWN timestamp.

* D-07/D-08 — Inverse coin->USD uses the row's OWN event-time `index_price`,
  NEVER a current/period-end index (cross-time is category-invalid). The ledger's
  credit(+)/debit(-) sign is authoritative and trusted verbatim; sign is NEVER
  re-derived from position side (that is where hand-rolled inverse calcs flip).
  Only INVERSE (coin-margined) needs conversion; linear (`_USDC`/`_USDT`/`_EURR`
  or a USD-family settlement currency) is already USD.

* A3 / D-10 — On perpetuals funding is realized INSIDE the `settlement` cash
  delta (`interest_pl` is a breakdown line, NOT an additional cashflow); there is
  NO separate `funding` transaction type. Summing the cash-bearing rows ONCE per
  UTC day already includes funding — a separate funding line would double-count.
"""
from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

# ---------------------------------------------------------------------------
# Instrument classification — inverse / linear / option / future (D-05).
# Lifted verbatim from scripts.deribit_ground_truth; that harness now imports
# these names from here (single definition).
# ---------------------------------------------------------------------------

# Deribit linear (USDC/USDT/EURR-margined) instruments carry the quote currency
# via an underscore segment (e.g. BTC_USDC-PERPETUAL); inverse (coin-margined)
# do not (e.g. BTC-PERPETUAL).
_LINEAR_MARGIN_MARKERS: tuple[str, ...] = ("_USDC", "_USDT", "_EURR")
# A dated-expiry future tail, e.g. "-27MAR26".
_FUTURE_EXPIRY_RE: re.Pattern[str] = re.compile(r"-\d{1,2}[A-Z]{3}\d{2}$")

# USD-family settlement currencies whose cash delta is already denominated in
# USD (no index multiplication). Complements the instrument-name markers: a
# linear row is detectable by instrument name OR settlement currency.
_LINEAR_CURRENCIES: frozenset[str] = frozenset({"USDC", "USDT", "USD", "EURR"})


def classify_instrument(instrument_name: str) -> str:
    """Classify a Deribit instrument name. Never raises on unknown input.

    Returns one of: ``inverse_perpetual``, ``linear_perpetual``, ``option``,
    ``future``, ``unknown``. Untrusted exchange input (T-70-05) is classified,
    not crashed on.
    """
    if not isinstance(instrument_name, str) or not instrument_name:
        return "unknown"
    name = instrument_name.upper()
    is_linear = any(marker in name for marker in _LINEAR_MARGIN_MARKERS)
    if name.endswith(("-C", "-P")):
        return "option"
    if name.endswith("-PERPETUAL"):
        return "linear_perpetual" if is_linear else "inverse_perpetual"
    if _FUTURE_EXPIRY_RE.search(name):
        return "future"
    return "unknown"


# ---------------------------------------------------------------------------
# Inverse coin->USD conversion at event-time index_price (D-07/D-08).
# ---------------------------------------------------------------------------


def _row_is_linear(row: Mapping[str, Any]) -> bool:
    """A row settles in USD already (no index multiplication) when its
    instrument classifies linear, carries a linear margin marker, OR its
    settlement ``currency`` is one of the USD-family currencies."""
    instrument = str(row.get("instrument_name", ""))
    name = instrument.upper()
    if classify_instrument(instrument) == "linear_perpetual":
        return True
    if any(marker in name for marker in _LINEAR_MARGIN_MARKERS):
        return True
    currency = str(row.get("currency", "")).upper()
    return currency in _LINEAR_CURRENCIES


def txn_cashflow_to_usd(row: Mapping[str, Any]) -> float:
    """Convert a transaction-log row's cash delta to signed USD.

    * Linear / USD-family settlement -> the ``cashflow`` passes through unchanged
      (already USD; multiplying by ``index_price`` would inflate it).
    * Inverse (coin-margined) -> ``cashflow x index_price`` at the row's OWN
      event-time index_price. If ``index_price`` is absent/None on an inverse
      row, raise ``ValueError`` naming the row id — NEVER a current-price
      fallback (the cross-time category error forbidden by D-07).

    The ``cashflow`` SIGN is trusted verbatim (credit +/debit -); it is NEVER
    re-derived from position side.
    """
    cashflow = float(row.get("cashflow", 0.0) or 0.0)
    if _row_is_linear(row):
        return cashflow
    index_price = row.get("index_price")
    if index_price is None:
        raise ValueError(
            "inverse Deribit row "
            f"id={row.get('id')!r} instrument={row.get('instrument_name')!r} "
            "is missing an event-time index_price; refusing a current/period-end "
            "price fallback (D-07 cross-time conversion is category-invalid)"
        )
    return cashflow * float(index_price)
