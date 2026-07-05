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
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
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


# ---------------------------------------------------------------------------
# USD equity anchor (D-02 / anchor-shift class) — pure, I/O-free.
# ---------------------------------------------------------------------------


def deribit_equity_to_usd(
    summaries: Sequence[Mapping[str, Any]],
    index_prices: Mapping[str, float],
) -> float:
    """Sum per-currency Deribit account equity into a single USD figure — the
    initial-capital anchor for the daily reconstruction.

    * USD-family currencies (``USDC``/``USDT``/``USD``/``EURR``) pass through
      unchanged (their equity is already USD).
    * A coin-margined currency's coin equity is multiplied by its USD index
      price (``index_prices[currency]``, the event/mark index → USD). If that
      price is absent, raise ``ValueError`` naming the currency — NEVER fall back
      to the raw coin quantity (a coin/non-USD base silently mis-scales EVERY
      return: the ``broker_dailies`` anchor-shift class).

    Returns the total account equity in USD. Never returns a raw coin quantity.
    """
    total = 0.0
    for summ in summaries:
        if not isinstance(summ, Mapping):
            continue
        ccy = str(summ.get("currency", "")).upper()
        if not ccy:
            continue
        equity = float(summ.get("equity", 0.0) or 0.0)
        if ccy in _LINEAR_CURRENCIES:
            total += equity  # already USD
            continue
        price = index_prices.get(ccy)
        if price is None:
            raise ValueError(
                "deribit equity anchor: missing USD index price for "
                f"coin-margined currency {ccy!r}; refusing a coin/non-USD equity "
                "anchor (the broker_dailies anchor-shift class mis-scales every "
                "return when the base is a raw coin quantity)"
            )
        total += equity * float(price)
    return total


# ---------------------------------------------------------------------------
# Cash-bearing single-sum partition -> daily_pnl records (A3 / D-10).
# ---------------------------------------------------------------------------

# Pinned EXACTLY to the Wave-0 evidence type universe
# (account_3_txn_log_type_counts_all_scopes = {trade, settlement, transfer,
# delivery, usdc_reward, deposit}), plus `withdrawal` as the defensible
# informational counterpart of `deposit`.
#
# CASH_BEARING = realized trading PnL cash (funding is INSIDE settlement — A3 —
# so settlement is summed ONCE and already includes funding; there is NO
# separate funding type, and a separate funding line would double-count, D-10).
# `trade` rows carry ZERO cashflow (A3) but stay in the set so a future nonzero
# trade cashflow is summed, not silently dropped.
CASH_BEARING_TYPES: frozenset[str] = frozenset(
    {"trade", "settlement", "delivery"}
)
# INFORMATIONAL = capital flows / rewards, NOT trading PnL — excluded from the
# daily return series.
INFORMATIONAL_TYPES: frozenset[str] = frozenset(
    {"transfer", "deposit", "withdrawal", "usdc_reward"}
)
# NOTE: every UNOBSERVED type (options_settlement_summary, negative_balance_fee,
# correction, swap, ...) is deliberately in NEITHER set. Pre-parking one is
# unsafe BOTH ways — a mis-parked cash-bearing type is silently DROPPED, and an
# options_settlement_summary that aggregates the SAME cash as per-instrument
# `delivery` rows would silently DOUBLE-COUNT. Leaving them out makes the
# fail-loud guard below force an evidence-grounded decision the first time one
# ever appears carrying cashflow.


def _row_utc_day(ts: Any) -> str:
    """UTC calendar day (ISO ``YYYY-MM-DD``) for a Deribit txn-log timestamp.

    The txn-log carries epoch-milliseconds; datetime / ISO-string forms are
    tolerated for robustness. Raises ValueError on an uninterpretable timestamp
    — a cash-bearing row we cannot date must fail loud, never be silently
    dropped (D-07: never lose realized cash)."""
    if isinstance(ts, datetime):
        aware = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).date().isoformat()
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        return datetime.fromtimestamp(ts / 1000, tz=timezone.utc).date().isoformat()
    if isinstance(ts, str):
        try:
            parsed = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            pass
        else:
            aware = (
                parsed
                if parsed.tzinfo is not None
                else parsed.replace(tzinfo=timezone.utc)
            )
            return aware.astimezone(timezone.utc).date().isoformat()
    raise ValueError(f"uninterpretable transaction-log timestamp: {ts!r}")


def txn_rows_to_daily_records(
    rows: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Sum cash-bearing transaction-log cash deltas by UTC day into a SINGLE
    list of ``daily_pnl``-shaped records (mirrors
    ``broker_dailies.funding_rows_to_daily_pnl_records``).

    Per row:
      * ``type`` in ``INFORMATIONAL_TYPES`` -> skipped (capital flow / reward);
      * ``type`` in ``CASH_BEARING_TYPES`` -> its ``txn_cashflow_to_usd`` (D-07:
        the conversion propagates a raise on a missing inverse index_price)
        added to that row's UTC-day bucket. A zero-cashflow row (e.g. A3 trade
        rows) contributes 0 without requiring an index_price;
      * ANY OTHER (unobserved) ``type`` carrying nonzero cashflow -> ValueError
        naming the type (fail loud — never a silent cash loss or double-count).

    This is the single, count-once realized stream — funding is already inside
    ``settlement`` (A3/D-10), so there is NO funding return value. Emits ONE
    ``daily_pnl`` record per UTC day: ``side`` encodes the sign ("buy" for a
    positive day-sum, "sell" for negative), ``price`` is the absolute USD, and
    ``timestamp`` is ISO8601 UTC at 00:00:00. Consumed by
    ``trades_to_daily_returns_with_status``.
    """
    by_day: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", ""))
        if row_type in INFORMATIONAL_TYPES:
            continue
        cashflow = float(row.get("cashflow", 0.0) or 0.0)
        if row_type in CASH_BEARING_TYPES:
            # Zero-cashflow rows (A3 trade rows) contribute 0 and never require
            # an index_price; only convert when there is cash to convert.
            usd = txn_cashflow_to_usd(row) if cashflow != 0.0 else 0.0
            day = _row_utc_day(row.get("timestamp"))
            by_day[day] = by_day.get(day, 0.0) + usd
            continue
        # Unobserved type: silence is unsafe both ways — fail loud on any cash.
        if cashflow != 0.0:
            raise ValueError(
                f"unobserved Deribit transaction-log type {row_type!r} carries "
                f"nonzero cashflow ({cashflow}); it is in neither CASH_BEARING "
                "nor INFORMATIONAL — classify it against fresh evidence before "
                "ingesting (never silently drop nor double-count realized cash)"
            )
    return [
        {
            "exchange": "",
            "symbol": "DERIBIT",
            "side": "buy" if amount >= 0 else "sell",
            "price": abs(amount),
            "quantity": 1,
            "fee": 0,
            "fee_currency": "USD",
            "timestamp": f"{day}T00:00:00+00:00",
            "order_type": "daily_pnl",
        }
        for day, amount in sorted(by_day.items())
    ]
