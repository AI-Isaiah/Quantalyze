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

* ⚠️ THE FIELD IS `change`, NOT `cashflow` (P70 re-probe, 2026-07-05). Deribit's
  schema: `change` = "Change in cash balance. For trades: fees and options
  premium; for settlement: session PNL and perpetual funding" — the fee-inclusive
  balance-reconciling delta (Σ`change` = exact balance delta). `cashflow` =
  "Realized SESSION PnL since last settlement" — deferred, fee-EXCLUDED, 0 at
  fill time for perps. Summing `cashflow` DROPS every trading fee and mis-times
  PnL (a BYB-02-class silent over-statement). The daily return sums `change`.
  Evidence: docs/evidence/drb02-deribit-field-semantics-2026-07-05.json.

* D-07/D-08 — Inverse coin->USD uses the row's OWN event-time `index_price`,
  NEVER a current/period-end index (cross-time is category-invalid). The ledger's
  credit(+)/debit(-) `change` sign is authoritative and trusted verbatim; sign is
  NEVER re-derived from position side (that is where hand-rolled inverse calcs
  flip). Only INVERSE (coin-margined) needs conversion; linear (`_USDC`/`_USDT`/
  `_EURR` or a USD-family settlement currency) is already USD.

* Funding — On perpetuals funding is realized INSIDE the `settlement` `change`
  delta (schema: settlement `change` = "session PNL and perpetual funding";
  `interest_pl` is a breakdown line, NOT an additional cashflow); there is NO
  separate `funding` transaction type. Summing the return-bearing rows' `change`
  ONCE per UTC day already includes funding — a separate funding line double-counts.
"""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

# Sentinel distinguishing an ABSENT dict key from a present ``None``/``0`` value.
_MISSING: Any = object()


class LedgerValuationError(ValueError):
    """A transaction-log row could not be structurally converted to USD —
    permanent, never a transient network condition."""


def _coerce_float(value: Any, *, field: str, row: Mapping[str, Any]) -> float:
    """Coerce an untrusted transaction-log numeric field to ``float``, raising
    ``LedgerValuationError`` (permanent, structural) — NOT a bare
    ``ValueError``/``TypeError`` the worker's network over-catch would mistake
    for transient — if the field schema-drifts to a non-numeric string or a
    non-scalar type. Mirrors the undatable-timestamp wrap so EVERY structural
    row→USD failure fails loud to a permanent wizard gate, never an infinite
    'computing' spinner."""
    try:
        return float(value)
    except (TypeError, ValueError) as e:
        raise LedgerValuationError(
            f"Deribit row id={row.get('id')!r} type={row.get('type')!r} has a "
            f"non-numeric {field} {value!r}"
        ) from e

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

# The ONLY coin-margined (inverse) settlement currencies on Deribit — the sole
# currencies whose coin `change`/equity is validly multiplied by a USD index.
# A non-linear, non-inverse currency (e.g. a tokenized-fund wallet like BUIDL/
# USYC) must FAIL LOUD rather than be blindly index-multiplied: we have no
# evidence it is coin-margined, and a wrong multiply silently mis-scales cash.
_INVERSE_CURRENCIES: frozenset[str] = frozenset({"BTC", "ETH"})

# MUST be disjoint: both converters check linear FIRST, so a currency in both
# sets would silently pass through as USD (no index multiply) — mis-scaling a
# coin delta by the index price, the exact silent-corruption this module fights.
# Enforced at import (mirrors the CASH_BEARING/INFORMATIONAL disjointness assert).
assert not (_LINEAR_CURRENCIES & _INVERSE_CURRENCIES), (
    "Deribit _LINEAR_CURRENCIES and _INVERSE_CURRENCIES must be disjoint"
)


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


def classify_instrument_settlement(instrument_name: str) -> tuple[bool, str]:
    """Return ``(is_coin_settled, base_currency)`` for a Deribit instrument by
    name — the single source of the coin-vs-USD settlement decision, shared by
    the ledger cash converter (``txn_change_to_usd`` via ``_row_is_linear``) and
    the allocator position normalizer (``positions._normalize_deribit_position``).

    Linear (USD-margined) instruments carry a ``_USDC``/``_USDT``/``_EURR``
    margin marker and settle in USD → ``(False, "")``. Everything else is
    coin-margined (inverse); its base coin MUST be a known coin-margined
    currency (BTC/ETH) or we FAIL LOUD — refusing to blind-multiply an unknown
    coin by a USD index (mirrors ``txn_change_to_usd``'s unknown-currency guard,
    the module's core silent-mis-scale defense). Handles perps, dated futures,
    and options uniformly (all covered by the marker test, unlike
    ``classify_instrument`` which collapses linear/inverse futures+options).
    """
    name = str(instrument_name or "").upper()
    if not name:
        raise ValueError(
            "deribit instrument_name is empty; cannot classify settlement"
        )
    if any(marker in name for marker in _LINEAR_MARGIN_MARKERS):
        return (False, "")
    base = name.split("-", 1)[0].split("_", 1)[0]
    if base not in _INVERSE_CURRENCIES:
        raise ValueError(
            f"deribit instrument {name!r}: coin-settled base {base!r} is not a "
            f"known coin-margined currency {sorted(_INVERSE_CURRENCIES)}; "
            "refusing to blind-multiply an unknown coin by a USD index"
        )
    return (True, base)


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


def txn_change_to_usd(
    row: Mapping[str, Any], *, fallback_index: float | None = None
) -> float:
    """Convert a transaction-log row's ``change`` (cash-balance delta, FEE-
    INCLUSIVE — the balance-reconciling field) to signed USD.

    * Linear / USD-family settlement -> the ``change`` passes through unchanged
      (already USD; multiplying by ``index_price`` would inflate it).
    * Inverse (coin-margined) -> ``change x index_price`` at the row's OWN
      event-time index_price. If the row carries no ``index_price`` (e.g. a
      ``negative_balance_fee`` row has no instrument), ``fallback_index`` (a
      SAME-UTC-DAY per-currency index built from the batch's index-bearing rows)
      is used — same-day is inside D-07's event window, unlike a period-end
      index. If BOTH are absent, raise ``ValueError`` — NEVER silently value a
      coin delta at 1.0 (that would mis-scale realized cash).

    The ``change`` SIGN is trusted verbatim (credit +/debit -); it is NEVER
    re-derived from position side.
    """
    change = _coerce_float(row.get("change", 0.0) or 0.0, field="change", row=row)
    if _row_is_linear(row):
        return change
    # Non-linear: it MUST be a known coin-margined currency (BTC/ETH). Any other
    # currency reaching here (e.g. a tokenized-fund wallet) has no basis for an
    # index multiply — fail loud rather than silently mis-scale.
    currency = str(row.get("currency", "")).upper()
    if currency not in _INVERSE_CURRENCIES:
        raise LedgerValuationError(
            f"Deribit row id={row.get('id')!r} "
            f"instrument={row.get('instrument_name')!r} type={row.get('type')!r} "
            f"settles in {currency!r} which is neither USD-family (linear) nor a "
            f"known coin-margined currency {sorted(_INVERSE_CURRENCIES)}; refusing "
            "to blind-multiply an unknown currency by a USD index"
        )
    index_price = row.get("index_price")
    if index_price is None:
        index_price = fallback_index
    if index_price is None:
        raise LedgerValuationError(
            "inverse Deribit row "
            f"id={row.get('id')!r} instrument={row.get('instrument_name')!r} "
            f"type={row.get('type')!r} currency={currency!r} "
            "has no event-time index_price and no same-day currency index "
            "fallback; refusing a current/period-end or unit price fallback "
            "(D-07 cross-time conversion is category-invalid)"
        )
    price = _coerce_float(index_price, field="index_price", row=row)
    if price <= 0:
        raise LedgerValuationError(
            f"inverse Deribit row id={row.get('id')!r} currency={currency!r} has a "
            f"non-positive index_price ({price}); refusing to value coin cash at "
            "<=0 (a silent zero/negative would corrupt the realized sum)"
        )
    return change * price


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
    * Any non-USD currency's coin equity is multiplied by its USD index price
      (``index_prices[currency]`` = ``{ccy}_usd`` index → USD). If that price is
      absent, raise ``ValueError`` naming the currency — NEVER fall back to the
      raw coin quantity (a coin/non-USD base silently mis-scales EVERY return:
      the ``broker_dailies`` anchor-shift class).

    NOTE (P70 review F3): unlike the LEDGER cash conversion (``txn_change_to_usd``,
    restricted to BTC/ETH so a wrong multiply can never corrupt the return
    SERIES), the EQUITY anchor values EVERY held currency (a live LTP account
    holds e.g. SOL dust) — a wrong/absent index here only affects the anchor, and
    an absent index correctly degrades to the heuristic-capital DQ flag upstream
    rather than dropping a real coin balance from the base. The caller
    (``fetch_deribit_account_equity_usd``) resolves a ``{ccy}_usd`` index per
    held currency.

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
        if equity == 0.0:
            continue  # no balance in this currency — no index needed
        price = index_prices.get(ccy)
        if price is None:
            raise ValueError(
                "deribit equity anchor: missing USD index price for "
                f"currency {ccy!r}; refusing a coin/non-USD equity anchor (the "
                "broker_dailies anchor-shift class mis-scales every return when "
                "the base is a raw coin quantity)"
            )
        price_f = float(price)
        if price_f <= 0:
            raise ValueError(
                "deribit equity anchor: non-positive USD index price "
                f"({price_f}) for {ccy!r}; refusing to value equity at <=0"
            )
        total += equity * price_f
    return total


# ---------------------------------------------------------------------------
# Cash-bearing single-sum partition -> daily_pnl records (A3 / D-10).
# ---------------------------------------------------------------------------

# Allow-list of RETURN-BEARING types whose `change` is summed (P70 re-probe +
# Deribit official schema). Deribit documents the `type` enum is EXTENSIBLE, so
# this is an allow-list, not a block-list — an unknown type carrying real cash
# fails loud rather than silently leaking into (or out of) the series.
#
# `change` on each captures realized cash exactly once:
#   trade                -> fees (+ option premium)
#   settlement           -> futures session PnL + perpetual funding
#   delivery             -> option/future expiry cash settlement
#   liquidation          -> forced-close PnL/fees
#   negative_balance_fee -> a genuine cost of carry (live-confirmed cash-bearing)
CASH_BEARING_TYPES: frozenset[str] = frozenset(
    {"trade", "settlement", "delivery", "liquidation", "negative_balance_fee"}
)
# EXTERNAL / INFORMATIONAL = capital flows and rewards that are DEFINITIVELY not
# trading PnL and are UNCONDITIONALLY skipped even when their `change` is nonzero
# (they routinely are): `transfer`/`deposit`/`withdrawal` are external capital
# in/out; `usdc_reward` is a platform yield subsidy; `swap` is an internal
# cross-collateral FX conversion (net ~0 in USD across its legs).
INFORMATIONAL_TYPES: frozenset[str] = frozenset(
    {
        "transfer",
        "deposit",
        "withdrawal",
        "usdc_reward",
        "swap",
    }
)
# The two sets MUST be disjoint — a type in both would be simultaneously summed
# AND skipped (order-dependent silent corruption). Enforced at import.
assert not (CASH_BEARING_TYPES & INFORMATIONAL_TYPES), (
    "Deribit CASH_BEARING_TYPES and INFORMATIONAL_TYPES must be disjoint"
)
# External capital-flow types that move value IN/OUT of the account but are NOT
# trading PnL. The equity anchor must SUBTRACT their net so a large lifetime
# transfer/withdrawal cannot distort initial_capital (review F1): with the
# anchor-to-today identity `initial = equity_today − Σrealized`, and Σrealized
# EXCLUDING these flows while equity_today REFLECTS them, the anchor is off by the
# net flow unless corrected.
_EXTERNAL_FLOW_TYPES: frozenset[str] = frozenset(
    {"transfer", "deposit", "withdrawal", "usdc_reward"}
)


def deribit_linear_external_flow_usd(
    rows: Sequence[Mapping[str, Any]],
) -> tuple[float, bool]:
    """Net USD of LINEAR (USD-family) external-flow rows, plus a flag marking
    whether any INVERSE (coin) external-flow row was seen but not valued here.

    Returns ``(net_usd, saw_unvalued_inverse_flow)``. Linear flows (the dominant
    term — Deribit transfers/withdrawals are overwhelmingly USDC/USDT) sum
    directly (already USD). An inverse (BTC/ETH) flow is NOT valued here (it would
    need a per-row index) — it sets the flag so the caller can flag heuristic
    capital rather than silently under-correct. Pure / never raises."""
    net = 0.0
    saw_inverse = False
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in _EXTERNAL_FLOW_TYPES:
            continue
        if _row_is_linear(row):
            try:
                net += float(row.get("change", 0.0) or 0.0)
            except (TypeError, ValueError):
                saw_inverse = True  # unparseable → treat as unvalued (conservative)
        else:
            saw_inverse = True
    return net, saw_inverse


# DELIBERATELY in NEITHER set (P70 review H3): `options_settlement_summary` (a
# zero-cash recap — live-confirmed Sum(change)=0; excluding it also avoids
# double-counting the real settlement/delivery rows) and `correction` (an
# ambiguous manual adjustment that CAN be a real credit/debit). Leaving them
# unclassified means a nonzero-`change` occurrence FAILS LOUD via the unknown-type
# guard below (never a silent skip), forcing an evidence-grounded decision — while
# their normal zero-`change` form is harmlessly ignored. Every UNKNOWN type
# carrying nonzero `change` fails loud the same way.


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
        # Deribit/ccxt return numerics as STRINGS — a digit-string epoch-ms
        # ("1704067200000") must NOT hard-fail the whole job (F5). Try epoch-ms
        # first, then ISO8601.
        stripped = ts.strip()
        if stripped.lstrip("-").isdigit():
            try:
                return (
                    datetime.fromtimestamp(int(stripped) / 1000, tz=timezone.utc)
                    .date()
                    .isoformat()
                )
            except (ValueError, OverflowError, OSError):
                pass
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


def _day_ccy_own_index(
    rows: Sequence[Mapping[str, Any]],
) -> dict[tuple[str, str], float]:
    """Build the same-day per-(UTC-day, currency) event index from the batch's
    OWN index-bearing rows — Pass 1 of ``txn_rows_to_daily_records``, factored so
    ``inverse_days_needing_index`` consults the IDENTICAL map (they can never
    diverge on which days already carry an own index).

    Used ONLY as a fallback for cash-bearing rows lacking their own index_price;
    never overrides a row's own event-time index. Same UTC day keeps it inside
    D-07's event window (unlike a period-end index). Seeds ONLY for INVERSE
    currencies (the only ones that ever consume the fallback) so a linear row —
    e.g. BTC_USDC-PERPETUAL carries currency=USDC but a BTC index_price — can
    never poison a USDC entry (M1); and the coercion is guarded so a malformed
    index_price on any row cannot crash the whole job (untrusted input).
    """
    day_ccy_index: dict[tuple[str, str], float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        index_price = row.get("index_price")
        if index_price is None:
            continue
        ccy = str(row.get("currency", "")).upper()
        if ccy not in _INVERSE_CURRENCIES:
            continue
        try:
            day = _row_utc_day(row.get("timestamp"))
            price = float(index_price)
        except (ValueError, TypeError, OverflowError):
            continue
        if price > 0:
            day_ccy_index.setdefault((day, ccy), price)
    return day_ccy_index


def inverse_days_needing_index(
    rows: Sequence[Mapping[str, Any]],
) -> set[tuple[str, str]]:
    """The ``(UTC-day ISO, CURRENCY)`` pairs a settlement-index fetch must cover:
    days on which an INVERSE (coin-margined) CASH_BEARING row with NONZERO
    ``change`` exists but NO row in the batch supplies a same-day OWN
    ``index_price`` for that currency.

    These are exactly the "quiet day" rows (e.g. a ``negative_balance_fee`` on a
    day with no index-bearing settlement) that would otherwise fail loud in
    ``txn_change_to_usd`` for lack of any same-day index. The crawl consults this
    to decide which days to fetch ``public/get_delivery_prices`` for; the fetched
    prices feed back as ``txn_rows_to_daily_records(..., supplemental_index=...)``.

    Reuses ``_day_ccy_own_index`` (Pass 1) + the exact day/ccy computation of
    ``txn_rows_to_daily_records`` so the two never disagree. Pure; never raises —
    an undatable row is skipped here (it surfaces via the aggregator's fail-loud
    path, not this planner). Excludes zero-change rows, linear currencies, and any
    day already carrying an own index for that currency.
    """
    own_index = _day_ccy_own_index(rows)
    needed: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in CASH_BEARING_TYPES:
            continue
        ccy = str(row.get("currency", "")).upper()
        if ccy not in _INVERSE_CURRENCIES:
            continue
        raw_change = row.get("change", _MISSING)
        if raw_change is _MISSING:
            continue
        try:
            change = float(raw_change or 0.0)
        except (TypeError, ValueError):
            continue
        if change == 0.0:
            continue
        try:
            day = _row_utc_day(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError):
            continue
        if (day, ccy) in own_index:
            continue
        needed.add((day, ccy))
    return needed


def txn_rows_to_daily_records(
    rows: Sequence[Mapping[str, Any]],
    *,
    supplemental_index: Mapping[tuple[str, str], float] | None = None,
) -> list[dict[str, Any]]:
    """Sum return-bearing transaction-log ``change`` deltas by UTC day into a
    SINGLE list of ``daily_pnl``-shaped records (mirrors
    ``broker_dailies.funding_rows_to_daily_pnl_records``).

    Per row:
      * ``type`` in ``INFORMATIONAL_TYPES`` -> skipped (external flow / reward /
        zero-cash aggregate);
      * ``type`` in ``CASH_BEARING_TYPES`` -> its ``txn_change_to_usd`` (fee-
        inclusive; D-07 conversion propagates a raise on a missing inverse
        index_price with no same-day fallback) added to that row's UTC-day
        bucket. A zero-``change`` row contributes 0 without requiring an index;
      * ANY OTHER (unknown) ``type`` carrying nonzero ``change`` -> ValueError
        naming the type (fail loud — never a silent cash loss or double-count).

    A first pass builds a per-(UTC-day, currency) index from rows that carry a
    row-level ``index_price``; it is the SAME-DAY fallback for cash-bearing rows
    that structurally lack one (e.g. ``negative_balance_fee`` has no instrument).

    ``supplemental_index`` is a SAME-DAY per-(UTC-day, currency) settlement-index
    map (from ``public/get_delivery_prices``) used ONLY when the batch itself
    carries no same-day index for a coin cash row — own-row/ledger index always
    wins; still same-day, so D-07-compliant. Keys match ``_day_ccy_own_index``
    EXACTLY (``(day_iso, CCY_UPPER)``).

    This is the single, count-once realized stream — funding is already inside
    ``settlement.change``, so there is NO separate funding return value. Emits ONE
    ``daily_pnl`` record per UTC day: ``side`` encodes the sign ("buy" for a
    positive day-sum, "sell" for negative), ``price`` is the absolute USD, and
    ``timestamp`` is ISO8601 UTC at 00:00:00. Consumed by
    ``trades_to_daily_returns_with_status``.
    """
    # Pass 1: same-day per-currency event index from the batch's own index-
    # bearing rows (see _day_ccy_own_index for the M1 / untrusted-input pins).
    day_ccy_index = _day_ccy_own_index(rows)

    by_day: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", ""))
        if row_type in INFORMATIONAL_TYPES:
            continue
        if row_type in CASH_BEARING_TYPES:
            # H2: a cash-bearing row MUST carry a `change` field. Absent (not just
            # zero) means schema drift / a field rename — the entire premise of
            # this module. Coalescing absent→0.0 would silently zero real cash and
            # pass the completeness gate green. Distinguish absent from present-0.
            raw_change = row.get("change", _MISSING)
            if raw_change is _MISSING:
                raise LedgerValuationError(
                    f"cash-bearing Deribit row id={row.get('id')!r} "
                    f"type={row_type!r} has NO `change` field — refusing to treat a "
                    "missing balance-delta as zero (schema drift would silently "
                    "zero realized cash and render a green-but-wrong track record)"
                )
            change = _coerce_float(raw_change or 0.0, field="change", row=row)
            # An undatable cash-bearing row must fail loud as a STRUCTURAL
            # valuation error (permanent), not a bare ValueError the network
            # over-catch would mistake for transient. _row_utc_day is shared, so
            # wrap at the aggregator call site rather than changing it.
            try:
                day = _row_utc_day(row.get("timestamp"))
            except ValueError as e:
                raise LedgerValuationError(str(e)) from e
            if change == 0.0:
                # Zero-change row: observed activity, no cash, no index needed.
                by_day.setdefault(day, 0.0)
                continue
            ccy = str(row.get("currency", "")).upper()
            # Own-row/ledger same-day index ALWAYS wins; the supplemental
            # settlement index (public/get_delivery_prices) is consulted ONLY when
            # the batch carries no same-day index for this coin cash row. Both are
            # same-day → D-07-compliant (never a period-end/current fallback).
            fb = day_ccy_index.get((day, ccy))
            if fb is None and supplemental_index is not None:
                fb = supplemental_index.get((day, ccy))
            usd = txn_change_to_usd(row, fallback_index=fb)
            by_day[day] = by_day.get(day, 0.0) + usd
            continue
        # Unknown type (incl. options_settlement_summary / correction, H3):
        # silence is unsafe both ways — fail loud on any cash, harmlessly ignore
        # a zero-change occurrence.
        change = _coerce_float(row.get("change", 0.0) or 0.0, field="change", row=row)
        if change != 0.0:
            raise LedgerValuationError(
                f"unknown Deribit transaction-log type {row_type!r} carries "
                f"nonzero change ({change}); it is in neither CASH_BEARING nor "
                "INFORMATIONAL — classify it against fresh evidence before "
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
