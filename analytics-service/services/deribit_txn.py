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
  PnL (a BYB-02-class silent over-statement). The daily return sums `change`
  for NON-OPTION rows. Evidence: docs/evidence/drb02-deribit-field-semantics-2026-07-05.json.

* ⚠️ PHASE 82 (options-aware, native path — MARK_TO_MARKET BASIS ONLY) — the
  amendment below applies ONLY when ``pnl_basis == mark_to_market``. Under
  ``cash_settlement`` (the DEFAULT and the shipped/Zavara basis) NONE of this runs:
  the coverage window is never consulted, option `trade`/`delivery` rows book their
  FULL cash `change` on the settlement day, and `options_settlement_summary` rows
  are INERT (their 0.0 change is ignored). Debugging the LIVE factsheet? It is
  cash_settlement — the fee-only reclass / summary channel described here is dark.
  MARK_TO_MARKET amendment: inside a currency's summary coverage window
  `[first_summary−24h, last_summary]` an option `trade`/`delivery` contributes
  `−commission` (NOT its premium `change`), and `options_settlement_summary`
  contributes `realized_pl + unrealized_pl` (a session DELTA — load-bearing).
  This REDEFINES option native_pnl from a "cash-balance delta" to an "MTM
  (settled-equity) delta" for covered option rows: the premium/payout cash is
  offset by the option book's mark value and its P&L content is carried by the
  summary channel (probe closure 9.222194 vs 9.222190 BTC). Do NOT "fix" the
  fee-only arm back to cash `change`. Outside coverage (pre-2025-01-12 rollout /
  live trailing edge) option rows stay cash-basis `change` + a
  `pre_summary_rollout_option_dailies` warning. Guard/oracle = the BALANCE
  IDENTITY (computed total == Σchange over CASH_BEARING, fail-loud), NOT the
  row-embedded equity snapshot (REJECTED: 13% day-match, mark-timing noise).
  Evidence: docs/evidence/drb-options-semantics-2026-07.json (see design pin D-11).

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
from datetime import date, datetime, timedelta, timezone
from typing import AbstractSet, Any

# Pure, I/O-free venue-agnostic dated-flow contract (Plan 75-01). Importing it
# here keeps the module network-free — external_flows.py imports stdlib + typing
# ONLY (no ccxt/pandas/supabase/services.exchange), so the purity source-scan
# guard (test_deribit_txn.py) still holds.
from services.external_flows import USD_FAMILY, ExternalFlow

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
# Aliases the single source of truth in ``external_flows.USD_FAMILY`` (identity,
# NOT a copy) so the native core (Phase 79) and Deribit ingest can never drift
# (§3.2). The set now includes DAI — behavior-neutral here (no DAI wallet on
# Deribit, so ``_row_is_linear`` never encounters it).
_LINEAR_CURRENCIES: frozenset[str] = USD_FAMILY

# The STATIC FLOOR of coin-margined (inverse) settlement currencies on Deribit —
# currencies known-resolvable to a USD index WITHOUT a probe. This is the
# degraded-mode default of the injected ``indexable_currencies`` set (§7.2), NEVER
# the ceiling: the I/O layer probes ``{ccy}_usd`` per enumerated currency and
# threads the union (floor ∪ probed) into the census consumers below, so SOL heals
# on the existing USD-space path once its ``sol_usd`` index resolves. A currency
# absent from the consulted set (e.g. a tokenized-fund wallet like BUIDL/USYC, or
# a currency whose probe raises) must FAIL LOUD rather than be blindly index-
# multiplied: we have no evidence it is coin-margined, and a wrong multiply
# silently mis-scales cash.
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
    ``future``, ``spot``, ``unknown``. Untrusted exchange input (T-70-05) is
    classified, not crashed on.

    ``spot`` names a Deribit SPOT conversion pair, e.g. ``BTC_USDC`` /
    ``ETH_USDC`` — an underscore-joined ``BASE_QUOTE`` with NO derivative suffix
    (not an option ``-C``/``-P``, not a ``-PERPETUAL``, not a dated ``-DDMONYY``
    future). Ordered LAST among the positive matches so linear derivatives that
    ALSO carry an underscore margin marker (``BTC_USDC-PERPETUAL``,
    ``BTC_USDC-27MAR26``, ``BTC_USDC-27MAR26-50000-C``) are classified by their
    suffix FIRST and never mis-read as spot. A spot leg is a capital conversion
    (BTC<->USDC), never trading P&L — on the ALLOCATED path (Bug B) its
    net-extraction legs are DROPPED from ``native_pnl`` (Zavara profit-extraction
    methodology), so classifying it distinctly is load-bearing. On the NAV path
    the spot legs are RETAINED verbatim (see ``txn_rows_to_native_daily``).
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
    # Spot conversion pair: an underscore-joined BASE_QUOTE with no derivative
    # suffix (every dated/perp/option case is already returned above). A bare
    # coin (BTC, ETH) has no underscore → stays ``unknown``.
    if "_" in name:
        return "spot"
    return "unknown"


def is_spot_extraction_leg(row: Mapping[str, Any]) -> bool:
    """True iff ``row`` is a SPOT-conversion leg that EXTRACTS value OUT of the
    trading book — a profit-taking BTC->USDC conversion, NOT trading P&L.

    Bug B (GLOBAL, both P&L bases): Deribit spot ``BTC_USDC`` trades post two
    ledger legs — a BASE-coin leg (``currency=BTC``) and a QUOTE-cash leg
    (``currency=USDC``). A SELL (extraction, taking profit out) moves the coin
    OUT (BTC ``change < 0``) and cash IN (USDC ``change > 0``); a BUY (redeploy,
    putting capital back to work) moves the coin IN (BTC ``change > 0``) and cash
    OUT (USDC ``change < 0``). zavara EXCLUDES the extraction (sell) legs from
    daily P&L and KEEPS the redeploy (buy) legs (live-verified against the
    2025-11-20 +0.29 BTC buy, which zavara keeps). On the ALLOCATED path this
    DROPS the extraction legs from ``native_pnl`` entirely (they are NOT routed to
    any flow channel — no such routing exists; ``deribit_dated_external_flows_usd``
    handles only transfer/deposit/withdrawal/usdc_reward, not ``type="trade"``
    spot legs). On the NAV path the exclusion is OFF and every spot leg is kept.

    Sign rule (base/quote-agnostic — reads the settlement ``currency`` only, no
    instrument parsing): a USD-family (quote/cash) leg with ``change > 0`` is
    sale PROCEEDS coming in; a non-USD (coin) leg with ``change < 0`` is the coin
    going out. Either is an extraction leg. A buy-side leg (coin in / cash out)
    matches NEITHER and is kept. Non-``trade`` / non-``spot`` rows are never
    extraction legs. Pure / never raises (untrusted exchange input): an
    unparseable ``change`` is treated as non-extraction (kept — the aggregator's
    own verbatim change-guards are the fail-loud path).

    NOTE: this is the PER-LEG classifier, retained for the verification harness's
    per-leg reporting. The aggregators (:func:`txn_rows_to_native_daily`,
    :func:`assert_balance_identity`) exclude on the NET-DAILY set
    (:func:`spot_net_extraction_day_pairs`) — identical to this per-leg view on a
    single-direction pair (every observed zavara day), but correct on a mixed
    sell+buy day where only the pair's NET direction should decide.
    """
    if str(row.get("type", "")) != "trade":
        return False
    if classify_instrument(str(row.get("instrument_name", ""))) != "spot":
        return False
    try:
        change = float(row.get("change", 0.0) or 0.0)
    except (TypeError, ValueError):
        return False
    currency = str(row.get("currency", "")).upper()
    if currency in USD_FAMILY:
        return change > 0.0  # cash IN = sale proceeds (extraction)
    return change < 0.0  # coin OUT = coin sold (extraction)


def spot_net_extraction_day_pairs(
    rows: Sequence[Mapping[str, Any]],
) -> frozenset[tuple[str, str]]:
    """The ``(utc_day, INSTRUMENT_NAME)`` CONVERSION PAIRS whose NET spot cash flow
    over the UTC day is an EXTRACTION — the NET-DAILY form of Bug B, and the basis
    the aggregators (:func:`txn_rows_to_native_daily`,
    :func:`assert_balance_identity`) exclude on.

    MEDIUM-1 (red-team) — net per CONVERSION PAIR, not per currency: a spot
    conversion posts MIRROR legs in two currencies (e.g. ``BTC_USDC``: a ``BTC`` leg
    and a ``USDC`` leg). Netting per ``(day, ccy)`` INDEPENDENTLY is wrong on a day
    that trades TWO pairs sharing a currency — e.g. sell ``BTC→USDC`` (extraction) AND
    buy ``ETH←USDC`` (redeploy) on the same day: the shared ``USDC`` nets across BOTH
    events, so one pair's cash leg silently flips the other's classification, dropping
    genuine intraday round-trip P&L. Netting per ``(day, instrument_name)`` keeps each
    conversion event self-contained: both legs of ONE pair are decided TOGETHER by
    THAT pair's own net cash direction.

    Per ``(day, instrument_name)``: sum the ``change`` of each currency's SPOT legs;
    the pair NET-EXTRACTS when its USD-family (cash) leg nets ``> 0`` (net cash IN —
    the account took capital out). A net-REDEPLOY (cash net ``< 0``), a wash (cash net
    ``0``), or a coin-for-coin pair with NO cash leg (a coin swap moves no capital in
    or out) all KEEP their legs. On the ALLOCATED path EVERY spot leg of a
    net-extraction pair is DROPPED from ``native_pnl`` (Zavara profit-extraction
    methodology — NOT re-routed anywhere; no flow-channel routing exists). On the
    NAV path the exclusion is off and this set is never consulted.

    Netting per day/pair — not per leg — is load-bearing on a pair carrying BOTH a
    sell and a buy: the pair is classified by its NET direction (the capital actually
    taken out / put to work), never leg-by-leg. For a single-direction pair (every
    observed zavara day) the net equals the leg, so this reproduces the validated
    per-day track EXACTLY. Pure / never raises — an undatable / unparseable spot row
    is skipped here (the aggregator's verbatim ``change``-guards are the fail-loud
    path)."""
    # per (day, instrument_name) → per-currency net change over the UTC day.
    pair_ccy_net: dict[tuple[str, str], dict[str, float]] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) != "trade":
            continue
        instr = str(row.get("instrument_name", ""))
        if classify_instrument(instr) != "spot":
            continue
        try:
            day = _row_utc_day(row.get("timestamp"))
            change = float(row.get("change", 0.0) or 0.0)
        except (ValueError, TypeError, OverflowError):
            continue
        ccy = str(row.get("currency", "")).upper()
        key = (day, instr)
        per_ccy = pair_ccy_net.setdefault(key, {})
        per_ccy[ccy] = per_ccy.get(ccy, 0.0) + change
    # ponytail — CEILING (Finding 4a): the pair is classified by its NET-CASH
    # direction over the whole UTC day, so a genuine same-day ROUND-TRIP (a buy AND a
    # sell of the SAME pair that nets to positive cash) drops BOTH legs — including
    # the buy leg that carried real intra-day round-trip trading P&L. This
    # UNDERSTATES P&L (never overstates) and NEVER triggers on Zavara's data (its
    # spot is single-direction per day — pinned by
    # test_zavara_shaped_spot_is_single_direction_per_day). Upgrade path if a
    # non-Zavara allocated account ever round-trips a pair intraday: decompose the
    # pair's legs per-fill (buy legs = redeploy/kept, sell legs = extraction/dropped)
    # instead of netting the day, so the round-trip P&L survives.
    out: set[tuple[str, str]] = set()
    for key, per_ccy in pair_ccy_net.items():
        cash_ccys = [c for c in per_ccy if c in USD_FAMILY]
        coin_ccys = [c for c in per_ccy if c not in USD_FAMILY]
        if cash_ccys:
            # The authoritative direction: net cash IN (> 0) = the account took
            # capital OUT = extraction. (A real conversion always has this cash leg.)
            cash_net = sum(per_ccy[c] for c in cash_ccys)
            if cash_net > 0.0:
                out.add(key)
        elif len(coin_ccys) == 1:
            # No cash leg recorded for the pair (a synthetic / single-sided ledger):
            # classify by the single coin's net — coin OUT (< 0) = extraction. This
            # reproduces the pre-MEDIUM-1 per-currency semantics on such a pair.
            if per_ccy[coin_ccys[0]] < 0.0:
                out.add(key)
        # else: a multi-coin swap with no cash leg moves no capital in or out → KEEP
        # (never silently drop a coin-for-coin swap's realized P&L).
    return frozenset(out)


def _row_is_net_extraction_spot(
    row: Mapping[str, Any],
    extraction_day_pairs: AbstractSet[tuple[str, str]],
) -> bool:
    """True iff ``row`` is a spot leg on a ``(day, instrument_name)`` conversion pair
    that NET-extracted (a member of ``extraction_day_pairs`` from
    :func:`spot_net_extraction_day_pairs`) — the net-daily exclusion predicate the
    aggregators use in place of the per-leg :func:`is_spot_extraction_leg`. Keying on
    the pair (not the currency) routes EACH leg by its OWN conversion event, so a
    currency shared across two same-day pairs (MEDIUM-1) is disambiguated. Pure /
    never raises (an undatable spot row is treated as non-extraction — kept; the
    aggregator change-guards are fail-loud)."""
    if str(row.get("type", "")) != "trade":
        return False
    instr = str(row.get("instrument_name", ""))
    if classify_instrument(instr) != "spot":
        return False
    try:
        day = _row_utc_day(row.get("timestamp"))
    except (ValueError, TypeError, OverflowError):
        return False
    return (day, instr) in extraction_day_pairs


def classify_instrument_settlement(
    instrument_name: str,
    *,
    indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES,
) -> tuple[bool, str]:
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
    if base not in indexable_currencies:
        raise ValueError(
            f"deribit instrument {name!r}: coin-settled base {base!r} is not a "
            f"known coin-margined currency {sorted(indexable_currencies)}; "
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
    row: Mapping[str, Any],
    *,
    fallback_index: float | None = None,
    indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES,
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
    if currency not in indexable_currencies:
        raise LedgerValuationError(
            f"Deribit row id={row.get('id')!r} "
            f"instrument={row.get('instrument_name')!r} type={row.get('type')!r} "
            f"settles in {currency!r} which is neither USD-family (linear) nor a "
            f"known coin-margined currency {sorted(indexable_currencies)}; refusing "
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
#
# NOTE: `correction` is DELIBERATELY NOT a static member of this set — a bare
# set-membership cannot see `info.reason`, and the founder decision (Phase 128) is
# to classify each `correction` PER ROW on its reason, NOT to assume every
# correction is trading performance. See ``correction_is_trading`` /
# ``assert_correction_classifiable`` below and the evidence block there.
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

# --- native-sibling type reclassification (v1.9 native-unit, HIGH-1) ----------
# A `swap` is an INTERNAL cross-collateral FX conversion: net ~0 in USD across its
# legs (the USD path in ``txn_rows_to_daily_records`` rightly skips it as
# INFORMATIONAL) but in NATIVE per-currency space each leg is a REAL balance delta
# (−1 BTC on the BTC leg, +60,000 USDC on the USDC leg). Skipping it in the native
# sibling makes the per-bucket backward roll fail to close → a ``full_history``
# inception FALSE-breach (a material swap) or a silently mis-stated pre-swap
# balance (a sub-tolerance swap). Because a swap leg's balance delta IS "Σ ledger
# `change` per currency per day", it legitimately belongs in native_pnl. A swap is
# an INTERNAL rebalance, NOT external capital, so it MUST enter native_pnl and MUST
# NOT enter the external-flow channel / ``F_t`` (routing it there would distort the
# TWR denominator). It is deliberately ABSENT from ``_EXTERNAL_FLOW_TYPES`` →
# count-once holds by construction (native_pnl only, never also a flow).
#
# AUDIT of the other INFORMATIONAL_TYPES (HIGH-1): the reclassed set is exactly
# ``INFORMATIONAL_TYPES − _EXTERNAL_FLOW_TYPES`` — the informational types that are
# NOT external flows. transfer/deposit/withdrawal/usdc_reward ARE external capital
# in/out and are captured by the flow channel (``report.dated_external_flows``);
# reclassing them to native_pnl would double-count and distort ``F_t``, so they
# stay INFORMATIONAL in the native sibling too. `swap` is the SOLE informational
# non-flow type, so it is the only type moved.
_NATIVE_INTERNAL_REBALANCE_TYPES: frozenset[str] = frozenset({"swap"})
# The native sibling's effective type partition: reclass `swap` from the skip set
# into the cash-bearing set (native-only — the USD sets are untouched).
_NATIVE_INFORMATIONAL_TYPES: frozenset[str] = (
    INFORMATIONAL_TYPES - _NATIVE_INTERNAL_REBALANCE_TYPES
)
_NATIVE_CASH_BEARING_TYPES: frozenset[str] = (
    CASH_BEARING_TYPES | _NATIVE_INTERNAL_REBALANCE_TYPES
)
# Invariants (import-time, mirroring the USD-set disjointness assert):
#   (1) every reclassed type is an INFORMATIONAL type that is NOT an external flow
#       (an internal rebalance between the account's own buckets) — never an
#       external-capital type (that would double-count against F_t);
#   (2) the two native sets stay disjoint (a type simultaneously summed AND skipped
#       is order-dependent silent corruption).
assert _NATIVE_INTERNAL_REBALANCE_TYPES <= (
    INFORMATIONAL_TYPES - _EXTERNAL_FLOW_TYPES
), "native-reclassed types must be INFORMATIONAL non-external-flow (internal) types"
assert not (_NATIVE_CASH_BEARING_TYPES & _NATIVE_INFORMATIONAL_TYPES), (
    "native CASH_BEARING and INFORMATIONAL sets must be disjoint"
)

# --- `correction` per-row classification (Phase 128 DERIBITFIX) ---------------
# A deribit `correction` is classified PER ROW on its ``info.reason``, NOT by
# blanket type membership (founder decision, 2026-07-19). Rationale: a blanket
# type→CASH_BEARING rule assumes EVERY correction is trading performance — a guess
# for correction kinds we have not observed. A hypothetical future CAPITAL
# correction (a deposit/withdrawal/transfer fix) summed into realized PnL would
# silently CORRUPT returns. So a correction is CASH_BEARING only when its reason
# matches a trading/PnL pattern; every OTHER correction (capital-flavored,
# unrecognized, or missing reason) FAILS LOUD — preserving the original fail-loud
# safety exactly where the risk is.
#
# ⭐EVIDENCE (read-only Railway recrawl 2026-07-19, founder-authorized,
# DERIBIT_CLIENT_ID_3): the single live `correction` row on key3 — the one the
# dogfood LedgerValuationError fired on — was
#   type=correction  change=-3.2469e-4 BTC  currency=BTC  instrument_name=null
#   id=952844476  2026-07-15  side="-"  info.reason="2026-07-15 BTC-PERPETUAL
#   funding calculation correction"
# The `info.reason` proves it adjusts BTC-PERPETUAL FUNDING. Perpetual funding is
# ALREADY cash-bearing here (realized inside `settlement.change` — "session PnL +
# perpetual funding"), so a funding-CALCULATION correction is an adjustment to
# REALIZED trading cash and is summed like settlement/funding. It matches the
# trading allow-list on "funding" (and no capital denylist keyword). A capital
# correction (deposit/withdrawal/transfer/wallet/capital) fails loud, never
# miscounted as performance — the capital denylist takes PRECEDENCE over any
# trading substring the reason may also contain (WR-01; see below).
#
# WR-01 (money-safety): a CAPITAL DENYLIST is checked FIRST and takes PRECEDENCE
# over the trading allow-list. A correction whose reason names a capital movement is
# NEVER trading performance — even if the reason ALSO contains a trading substring.
# Without this precedence, "transfer to funding account correction" (contains
# "funding"), "withdrawal fee correction" (contains "fee"), etc. would be silently
# summed into realized PnL — the exact silent capital-as-performance corruption this
# gate exists to prevent.
#
# BL-01 (money-safety, milestone review): the denylist is matched by PLAIN SUBSTRING
# (NOT word boundary) so plural/inflected capital forms — "transfers", "withdrawals",
# "wallets", "deposits" — cannot slip a ``\b`` anchor and get counted as trading.
# The denylist can afford to be broad: a spurious capital match only ADDS a fail-loud
# (the safe direction — an operator hand-classifies), and NEVER silently counts
# capital as performance. See ``_reason_contains_any`` vs the word-boundary
# ``_reason_matches_any`` used for the allow-list.
#
# RT-01 (money-safety, red team): CAPITAL-CONTEXT words added below. A deribit
# `correction` reason names cash on BOTH sides of the trading/capital line; the
# original denylist only caught reasons that literally said deposit/withdrawal/
# transfer/wallet. But "network fee refund", "reward interest correction", "funding
# of insurance account", "subaccount funding correction" are capital/flow movements
# (network/on-chain withdrawal fees ride the capital flow; `usdc_reward` is an
# EXTERNAL FLOW; insurance-fund / subaccount funding is not the user's trading PnL) —
# yet each contained a trading token and was silently summed into realized PnL with
# NO backstop (the balance-identity oracle is structurally blind to a MISROUTE — it
# and the computed side derive from the same predicate). These capital-context words
# are checked FIRST (substring) → any match FAILS LOUD. Safe direction only.
_CORRECTION_CAPITAL_REASON_KEYWORDS: tuple[str, ...] = (
    "deposit",
    "withdrawal",
    "transfer",
    "wallet",
    "capital",
    # RT-01 capital-context (flow / non-trading cash that named a trading token):
    "network",     # network/on-chain withdrawal fees ride the capital flow
    "on-chain",
    "onchain",
    "reward",      # usdc_reward is an EXTERNAL FLOW, not realized PnL
    "rebate",
    "bonus",
    "airdrop",
    "insurance",   # insurance-fund funding is not the user's trading PnL
    "subaccount",
    "sub-account",
)

# BROAD trading/PnL allow-list, consulted ONLY after the capital denylist clears.
# Matched on WORD BOUNDARIES so a short token cannot collide inside a larger word
# (belt-and-suspenders on top of the denylist). `mark` is deliberately EXCLUDED
# (collides with market/benchmark/earmarked). The remaining tokens name cash that is
# UNAMBIGUOUSLY trading on a derivatives venue.
#
# RT-01 (money-safety, red team): `fee` and `interest` were DROPPED. Unlike the
# other tokens they name cash on BOTH sides — trading (taker/maker/negative-balance
# fee, funding interest) AND capital (network/withdrawal fee, `usdc_reward`
# interest). With no oracle backstop for a misroute, an ambiguous token that has NO
# live evidence behind it (the only observed correction is a BTC-PERPETUAL funding
# calc) must FAIL LOUD, not silently classify. A real trading fee/interest correction
# now fails loud and is classified against evidence when it actually appears — the
# founder's "fail-loud > silent-wrong, classify on evidence not guesses" rule.
_CORRECTION_TRADING_REASON_KEYWORDS: tuple[str, ...] = (
    "funding",
    "settlement",
    "session",
    "pnl",
    "p&l",
    "delivery",
    "trade",
    "liquidation",
    "premium",
    "expiry",
)


def _correction_reason_raw(row: Mapping[str, Any]) -> str:
    """The RAW (un-lowered) ``info.reason`` of a row — defensive: ``info`` may be
    absent / ``None`` / a non-Mapping. Empty string when unavailable.

    RT-01 (red team): a NON-STRING reason (e.g. a schema-drifted dict
    ``{"note": "session fix"}``) returns "" — it must NOT be ``str()``-coerced and
    classified on its repr (``str(dict)`` contains "session" → would falsely match
    the trading allow-list). An empty reason falls through to FAIL LOUD, the safe
    direction for structured/unexpected schema."""
    info = row.get("info")
    if not isinstance(info, Mapping):
        return ""
    reason = info.get("reason")
    return reason if isinstance(reason, str) else ""


def _reason_matches_any(reason_lower: str, keywords: tuple[str, ...]) -> bool:
    """True iff the lowered reason contains ANY keyword on a WORD BOUNDARY (``\\b``)
    — so a short token like ``fee`` never collides inside a larger word (``market``,
    ``benchmark``). Used for the TRADING allow-list, where a false positive would
    silently count non-trading cash as performance (the unsafe direction)."""
    return any(
        re.search(rf"\b{re.escape(kw)}\b", reason_lower) is not None
        for kw in keywords
    )


def _reason_contains_any(reason_lower: str, keywords: tuple[str, ...]) -> bool:
    """True iff the lowered reason contains ANY keyword as a PLAIN SUBSTRING — so
    plural/inflected forms match (``transfers`` contains ``transfer``). Used for the
    CAPITAL denylist, where a false positive only ADDS a fail-loud (the safe
    direction), so broad substring matching is correct (BL-01)."""
    return any(kw in reason_lower for kw in keywords)


def correction_is_trading(row: Mapping[str, Any]) -> bool:
    """True iff a ``type == "correction"`` row is a TRADING/PnL correction (realized
    cash — summed like settlement/funding) per its ``info.reason``.

    PRECEDENCE (WR-01): the CAPITAL denylist (deposit/withdrawal/transfer/wallet/
    capital) is matched FIRST → a capital-flavored reason is NOT trading, even if it
    also contains a trading substring ("transfer to funding account correction"
    contains "funding" but is a capital transfer → False → the caller FAILS LOUD).
    Only when NO capital keyword matches does a trading keyword make it cash-bearing.
    The denylist is matched by SUBSTRING (catches plurals — "transfers"/"withdrawals",
    BL-01); the allow-list by WORD BOUNDARY (a short token can't collide inside a
    larger word). False for a capital / unrecognized / missing reason (the caller must
    then FAIL LOUD via :func:`assert_correction_classifiable`). Pure / never raises."""
    reason = _correction_reason_raw(row).lower()
    if _reason_contains_any(reason, _CORRECTION_CAPITAL_REASON_KEYWORDS):
        return False  # capital denylist (substring) beats ANY trading token (WR-01/BL-01)
    return _reason_matches_any(reason, _CORRECTION_TRADING_REASON_KEYWORDS)


def assert_correction_classifiable(row: Mapping[str, Any]) -> None:
    """Fail loud on a ``correction`` whose ``info.reason`` is NOT a recognized
    trading/PnL pattern (capital-flavored, unrecognized, or missing) — never
    silently count a capital adjustment as trading performance. No-op for a
    trading-reason correction (it is realized cash, handled as cash-bearing)."""
    if correction_is_trading(row):
        return
    raise LedgerValuationError(
        f"Deribit correction row id={row.get('id')!r} "
        f"reason={_correction_reason_raw(row)!r} — correction with unrecognized or "
        "possibly-capital reason; classify against fresh evidence before ingesting "
        "(do NOT silently count a capital adjustment as trading performance). Only a "
        "trading/PnL correction (reason matching one of "
        f"{list(_CORRECTION_TRADING_REASON_KEYWORDS)}) is realized cash."
    )


def _row_is_cash_bearing(row: Mapping[str, Any]) -> bool:
    """USD-path realized-cash membership: a static ``CASH_BEARING_TYPES`` member OR
    a trading-reason ``correction`` (Phase 128 per-row gate). Pure / never raises —
    a NON-trading correction returns False here, and the aggregator's
    :func:`assert_correction_classifiable` call is what fails it loud."""
    row_type = str(row.get("type", ""))
    if row_type in CASH_BEARING_TYPES:
        return True
    if row_type == "correction":
        return correction_is_trading(row)
    return False


def _row_is_native_cash_bearing(row: Mapping[str, Any]) -> bool:
    """Native-path realized-cash membership: a ``_NATIVE_CASH_BEARING_TYPES`` member
    (the USD set PLUS the reclassed internal-rebalance ``swap``) OR a trading-reason
    ``correction`` (the SAME per-row gate as the USD path, so the two paths never
    diverge on which corrections count). Pure / never raises."""
    row_type = str(row.get("type", ""))
    if row_type in _NATIVE_CASH_BEARING_TYPES:
        return True
    if row_type == "correction":
        return correction_is_trading(row)
    return False


# --- native options P&L channel (Phase 82, options-aware daily P&L) -----------
# The `options_settlement_summary` type is Deribit's own daily MTM decomposition
# (`realized_pl` = session realized, `unrealized_pl` = session DELTA — a
# LOAD-BEARING per-session change, not a level). On the NATIVE path it is CLASSIFIED
# (contributes `realized_pl + unrealized_pl`) ONLY under the MARK_TO_MARKET basis
# (the `use_mtm` gate in `txn_rows_to_native_daily`); its row `change` is always 0.0
# (nonzero → fail loud). Under CASH_SETTLEMENT (the DEFAULT / shipped basis) the
# summary is INERT — it falls through to the unknown-type guard where its 0.0 change
# is harmlessly ignored (option P&L is carried by the trade/delivery cash `change`
# instead). In the USD sibling it stays DELIBERATELY unclassified (P70 H3) —
# zero-change → ignored, nonzero → loud.
_NATIVE_OPTIONS_SUMMARY_TYPES: frozenset[str] = frozenset(
    {"options_settlement_summary"}
)
# The summary set MUST be disjoint from BOTH native sets: a type simultaneously
# summed as cash-bearing AND re-attributed via the summary channel would
# double-count (order-dependent silent corruption). Enforced at import (mirrors
# the CASH_BEARING/INFORMATIONAL disjointness asserts).
assert not (_NATIVE_OPTIONS_SUMMARY_TYPES & _NATIVE_CASH_BEARING_TYPES), (
    "native OPTIONS_SUMMARY and CASH_BEARING sets must be disjoint"
)
assert not (_NATIVE_OPTIONS_SUMMARY_TYPES & _NATIVE_INFORMATIONAL_TYPES), (
    "native OPTIONS_SUMMARY and INFORMATIONAL sets must be disjoint"
)
# One UTC day in epoch-milliseconds — the coverage-window lower-bound shift.
_COVERAGE_DAY_MS: float = 24 * 60 * 60 * 1000.0

# --- daily-P&L accrual basis (user-selectable per strategy/account) -----------
# ``cash_settlement`` (DEFAULT, zavara-validated): book each option/perp/future
#   P&L on its CASH-SETTLEMENT day — the raw ``change`` of trade/settlement/
#   delivery rows (option premium net of commission on the trade day, expiry
#   payout on the delivery day, perp session/funding on the settlement day). NO
#   ``options_settlement_summary`` MTM channel, NO coverage-window reshaping.
#   Reproduces zavara's cash-basis daily track to 4-5 decimals.
# ``mark_to_market``: Deribit's OWN daily marks — the
#   ``options_settlement_summary`` ``realized_pl + unrealized_pl`` channel that
#   spreads option session P&L across the holding days it accrued on. By design
#   this does NOT match zavara's cash-basis track (it re-dates premium off the
#   trade day) and carries the pre-rollout-straddle / §5 open-book limitations
#   documented on ``assert_balance_identity`` — a pre-rollout straddle (option
#   book open across the ~2025-01-12 summary rollout) FAILS LOUD under this basis
#   (no boundary-book V₀ anchor is computed; that machinery was removed as an
#   invalid closed form). Use ``cash_settlement`` for such accounts.
# ``smoothed_mtm`` (Phase 131, NEW third basis): the DAILY-MARK redistribution —
#   each option row books its FULL cash ``change`` (like cash_settlement) AND the
#   adapter (``build_deribit_native_ledger``) merges a per-(day,ccy) ΔMTM channel
#   ``Book[d]−Book[d−1]`` (``Book[d]=Σ_instr position×mark[d]``) computed from the
#   replayed option book and daily option marks. This SPREADS each session-lump
#   option P&L across the days it accrued → the honest daily option worth, WITHOUT
#   the mark_to_market summary-lump spikes. Total-preserving (telescoping):
#   ``Σ_d native_pnl = Σchange + Book(last settlement)``; a FLAT terminal book ⇒
#   the smoothed total equals the cash_settlement total EXACTLY. The
#   ``options_settlement_summary`` channel does NOT drive attribution under this
#   basis (it is retained ONLY as the Q3-3 reconciliation cross-check in
#   ``assert_balance_identity``). For perp-only / USD-native books the replay is
#   empty ⇒ no marks fetched ⇒ no-op merge ⇒ byte-identical to cash_settlement
#   (SC-4). ADDITIVE — cash_settlement and mark_to_market stay byte-untouched.
PNL_BASIS_CASH_SETTLEMENT: str = "cash_settlement"
PNL_BASIS_MARK_TO_MARKET: str = "mark_to_market"
PNL_BASIS_SMOOTHED_MTM: str = "smoothed_mtm"
_PNL_BASES: frozenset[str] = frozenset(
    {PNL_BASIS_CASH_SETTLEMENT, PNL_BASIS_MARK_TO_MARKET, PNL_BASIS_SMOOTHED_MTM}
)
DEFAULT_PNL_BASIS: str = PNL_BASIS_CASH_SETTLEMENT


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


# DELIBERATELY in NEITHER USD set (P70 review H3): `options_settlement_summary`
# (an ambiguous 0.0-change MTM recap). Leaving it unclassified in the USD path
# means a nonzero-`change` occurrence FAILS LOUD via the unknown-type guard below
# (never a silent skip), while its normal zero-`change` form is harmlessly ignored.
# (Phase 128: `correction` is NOT a blanket set member — it is gated PER ROW on
# info.reason: a trading/PnL correction is realized cash, every other correction
# fails loud. See ``correction_is_trading`` / ``assert_correction_classifiable``.)
#
# ⚠️ PHASE 82 (native path, MARK_TO_MARKET basis only): `options_settlement_summary`
# IS classified by `txn_rows_to_native_daily` via `_NATIVE_OPTIONS_SUMMARY_TYPES`
# ONLY when `pnl_basis == mark_to_market` — it then carries the option book's session
# MTM (`realized_pl + unrealized_pl`) into native_pnl (its `change` is always 0.0; a
# nonzero change fails loud there). Under CASH_SETTLEMENT (the DEFAULT / shipped
# basis) the native path ALSO leaves it unclassified (zero-change ignored, nonzero →
# loud), exactly like the USD sibling. The USD sibling `txn_rows_to_daily_records` is
# UNCHANGED on both bases: summary stays unclassified. Every UNKNOWN type carrying
# nonzero `change` still fails loud, and a `correction` with a non-trading reason
# fails loud too — a genuinely-new type is still classified against fresh evidence.


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


def _row_utc_instant(ts: Any) -> float:
    """A sortable UTC instant (epoch MILLISECONDS) for a Deribit txn-log
    timestamp — the SAME tolerant parsing as ``_row_utc_day`` but preserving
    intraday resolution so same-(day, currency) rows can be ordered. The
    END-OF-DAY settlement mark is the greatest instant (MEDIUM-1: the same-day
    index pick must be the event-appropriate end-of-day mark, not the
    iteration-order-dependent first row). Raises ValueError on an uninterpretable
    timestamp (mirrors ``_row_utc_day`` — never silently reorder on junk)."""
    if isinstance(ts, datetime):
        aware = ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).timestamp() * 1000.0
    if isinstance(ts, (int, float)) and not isinstance(ts, bool):
        return float(ts)
    if isinstance(ts, str):
        stripped = ts.strip()
        if stripped.lstrip("-").isdigit():
            try:
                return float(int(stripped))
            except (ValueError, OverflowError):
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
            return aware.astimezone(timezone.utc).timestamp() * 1000.0
    raise ValueError(f"uninterpretable transaction-log timestamp: {ts!r}")


def _day_ccy_own_index(
    rows: Sequence[Mapping[str, Any]],
    *,
    indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES,
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
    # MEDIUM-1: pick the END-OF-DAY mark (greatest event instant) per (day, ccy),
    # NOT the iteration-order-dependent first row. A `setdefault` first-wins made
    # the pick order-dependent when a day carried multiple index-bearing rows of
    # DIFFERENT index_price (a row-order swap flipped the valued cash). The
    # greatest-instant row is the settlement mark closest to the end-of-day flow
    # convention; a same-instant tie is broken deterministically on the GREATER
    # price (a data property, never iteration order).
    best_instant: dict[tuple[str, str], float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        index_price = row.get("index_price")
        if index_price is None:
            continue
        ccy = str(row.get("currency", "")).upper()
        if ccy not in indexable_currencies:
            continue
        try:
            day = _row_utc_day(row.get("timestamp"))
            instant = _row_utc_instant(row.get("timestamp"))
            price = float(index_price)
        except (ValueError, TypeError, OverflowError):
            continue
        if price <= 0:
            continue
        key = (day, ccy)
        prev_instant = best_instant.get(key)
        if (
            prev_instant is None
            or instant > prev_instant
            or (instant == prev_instant and price > day_ccy_index[key])
        ):
            best_instant[key] = instant
            day_ccy_index[key] = price
    return day_ccy_index


def inverse_days_needing_index(
    rows: Sequence[Mapping[str, Any]],
    *,
    indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES,
) -> set[tuple[str, str]]:
    """The ``(UTC-day ISO, CURRENCY)`` pairs a settlement-index fetch must cover:
    days on which an INVERSE (coin-margined) row that will be VALUED against a
    same-day index — a CASH_BEARING row OR an external-flow (``transfer``/
    ``deposit``/``withdrawal``/``usdc_reward``) row — with NONZERO ``change``
    exists but NO row in the batch supplies a same-day OWN ``index_price`` for
    that currency.

    These are exactly the "quiet day" rows that would otherwise fail loud in
    ``txn_change_to_usd`` for lack of any same-day index:
      * a CASH_BEARING quiet day, e.g. a ``negative_balance_fee`` on a day with no
        index-bearing settlement (the P72 live finding); and
      * an INVERSE external-flow quiet day, e.g. a BTC ``withdrawal`` on a no-trade
        day (Finding C1) — the flow producer
        (``deribit_dated_external_flows_usd``) values it against a same-day index,
        so an un-fetched inverse flow day sinks the whole job. BOTH must be
        fetched; a deposit/withdrawal structurally carries no own ``index_price``.

    The crawl consults this to decide which days to fetch
    ``public/get_delivery_prices`` for; the fetched prices feed back as the
    ``supplemental_index`` of BOTH ``txn_rows_to_daily_records`` and
    ``deribit_dated_external_flows_usd``.

    Reuses ``_day_ccy_own_index`` (Pass 1) + the exact day/ccy computation of the
    two valuers so all three never disagree. Pure; never raises — an undatable row
    is skipped here (it surfaces via the aggregator's fail-loud path, not this
    planner). Excludes zero-change rows, linear currencies, and any day already
    carrying an own index for that currency.
    """
    own_index = _day_ccy_own_index(rows, indexable_currencies=indexable_currencies)
    needed: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        # Finding C1: BOTH cash-bearing rows AND inverse external-flow rows are
        # valued against a same-day index, so BOTH quiet-day kinds need a fetch.
        # (The linear-flow case is filtered out by the indexable_currencies guard
        # below — a USD-family flow never consumes an index.) Phase 128: a
        # trading-reason `correction` is cash-bearing (``_row_is_cash_bearing``) so a
        # quiet-day inverse funding correction gets its same-day index fetched too; a
        # non-trading correction returns False here and fails loud in the aggregator.
        row_type = str(row.get("type", ""))
        if not _row_is_cash_bearing(row) and row_type not in _EXTERNAL_FLOW_TYPES:
            continue
        ccy = str(row.get("currency", "")).upper()
        if ccy not in indexable_currencies:
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


def deribit_dated_external_flows_usd(
    rows: Sequence[Mapping[str, Any]],
    *,
    supplemental_index: Mapping[tuple[str, str], float] | None = None,
    indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES,
) -> list[ExternalFlow]:
    """The ONE honest dated external-flow producer: convert the in-band
    ``_EXTERNAL_FLOW_TYPES`` rows into a per-UTC-day ``list[ExternalFlow]`` for the
    flow-aware TWR core (FLOW-02).

    Each ``transfer``/``deposit``/``withdrawal``/``usdc_reward`` row with a nonzero
    ``change`` is valued via ``txn_change_to_usd`` — the SAME single honest
    valuation path the realized sum uses (NO second inverse converter):

      * LINEAR / USD-family (USDC/USDT/USD/EURR) -> ``change`` passes through as USD
        (a $50k USDC deposit is $50k, never index-multiplied).
      * INVERSE (BTC/ETH) -> ``change x same-day settlement index``. Deposit/
        withdrawal rows structurally carry NO own ``index_price``, so the index is
        resolved (identically to ``txn_rows_to_daily_records``) as: the batch's own
        same-day index (``_day_ccy_own_index`` — a same-day index-bearing settlement
        row) FIRST, else the ``supplemental_index`` (``public/get_delivery_prices``,
        fetched for the days ``inverse_days_needing_index`` flags — Finding C1).
        Both are SAME-day → D-07-compliant. If NEITHER exists,
        ``txn_change_to_usd`` raises ``LedgerValuationError`` (fail loud) — a coin
        flow is NEVER valued at 1.0 / a current price, nor silently dropped.

    The ``change`` sign is trusted verbatim (a withdrawal -> NEGATIVE usd_signed).
    A MISSING ``change`` field (schema drift) FAILS LOUD before valuation (RISKY
    discipline): coalescing absent->0.0 would silently zero a real capital flow and
    mis-anchor the TWR base. This guard is local to the flow producer and does NOT
    alter the shared ``txn_change_to_usd`` coalesce that cash-bearing rows rely on.

    Flow rows are ``_EXTERNAL_FLOW_TYPES`` (a subset of ``INFORMATIONAL_TYPES``),
    so they are STRUCTURALLY excluded from ``txn_rows_to_daily_records``'s realized
    sum — count-once: a flow feeds F_t here exactly once and never the realized
    stream.

    Phase 80-01 (§2.3): the accumulator is keyed ``(day, ccy)`` and every entry is
    emitted as a 4-field ``ExternalFlow(utc_day_iso, usd_signed, currency,
    quantity)``, sorted ascending by ``(day, ccy)``. ``usd_signed`` KEEPS its exact
    meaning — the event-time USD value via ``txn_change_to_usd`` — and stays
    AUTHORITATIVE for the legacy USD-space path (Σ ``usd_signed`` per day is
    byte-identical to the pre-80-01 day-keyed output). ``currency`` (UPPERCASE) and
    ``quantity`` (the summed native ``change``, signed) are the additive native
    channel the native core reads (§2.2): a same-day USDC deposit + BTC withdrawal
    stays TWO flows rather than one collapsed USD sum. Supersedes the linear-only
    scalar ``deribit_linear_external_flow_usd`` (its sole consumer is removed in
    75-03).
    """
    day_ccy_index = _day_ccy_own_index(
        rows, indexable_currencies=indexable_currencies
    )
    # Parallel (day, ccy)-keyed accumulators: usd_signed (the authoritative legacy
    # leg, via txn_change_to_usd) and the native quantity (raw signed `change`).
    by_day_ccy_usd: dict[tuple[str, str], float] = {}
    by_day_ccy_qty: dict[tuple[str, str], float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in _EXTERNAL_FLOW_TYPES:
            continue
        # A flow row MUST carry a `change` field. Absent (not merely zero) is
        # schema drift — coalescing absent->0.0 would silently drop a real capital
        # flow (the TWR-base mis-anchor class). Distinguish absent from present-0.
        raw_change = row.get("change", _MISSING)
        if raw_change is _MISSING:
            raise LedgerValuationError(
                f"external-flow Deribit row id={row.get('id')!r} "
                f"type={row.get('type')!r} has NO `change` field — refusing to treat "
                "a missing balance-delta as a zero flow (schema drift would silently "
                "drop a real capital in/out and mis-anchor the flow-aware TWR base)"
            )
        # HIGH-2: a PRESENT-but-null/blank `change` (None, "", whitespace-only) is
        # schema drift too — the `or 0.0` coalesce below would turn it into a silent
        # 0.0 -> `continue` -> a DROPPED real capital flow (the original LTP068
        # dropped-flow class the absent-key guard above does NOT catch). A numeric
        # 0.0 (or "0") stays a legitimate observed-no-cash no-op.
        if raw_change is None or (
            isinstance(raw_change, str) and not raw_change.strip()
        ):
            raise LedgerValuationError(
                f"external-flow Deribit row id={row.get('id')!r} "
                f"type={row.get('type')!r} has a null/blank change={raw_change!r} — "
                "refusing to coalesce it to a zero flow (schema drift would silently "
                "drop a real capital in/out and mis-anchor the flow-aware TWR base)"
            )
        change = _coerce_float(raw_change, field="change", row=row)
        if change == 0.0:
            continue  # observed flow row, no cash — no entry, no index needed
        # An undatable flow row must fail loud as a STRUCTURAL valuation error
        # (permanent), not a bare ValueError the worker's network over-catch would
        # mistake for transient (mirrors the aggregator's wrap of the shared helper).
        try:
            day = _row_utc_day(row.get("timestamp"))
        except ValueError as e:
            raise LedgerValuationError(str(e)) from e
        ccy = str(row.get("currency", "")).upper()
        # Own/ledger same-day index ALWAYS wins; the supplemental settlement index
        # is consulted ONLY when the batch carries no same-day index for this coin
        # flow — identical resolution order to txn_rows_to_daily_records so the two
        # paths can never disagree on a day's index.
        fb = day_ccy_index.get((day, ccy))
        if fb is None and supplemental_index is not None:
            fb = supplemental_index.get((day, ccy))
        key = (day, ccy)
        # usd_signed leg — UNCHANGED resolution (own/ledger index wins, then
        # supplemental), so the legacy per-day USD sum is byte-identical.
        by_day_ccy_usd[key] = by_day_ccy_usd.get(key, 0.0) + txn_change_to_usd(
            row, fallback_index=fb, indexable_currencies=indexable_currencies
        )
        # native quantity leg — the raw signed `change` the guards already coerced
        # (no index): every coin flow carries a native quantity for the native core.
        by_day_ccy_qty[key] = by_day_ccy_qty.get(key, 0.0) + change
    return [
        ExternalFlow(day, by_day_ccy_usd[(day, ccy)], ccy, by_day_ccy_qty[(day, ccy)])
        for (day, ccy) in sorted(by_day_ccy_usd)
    ]


def txn_rows_to_daily_records(
    rows: Sequence[Mapping[str, Any]],
    *,
    supplemental_index: Mapping[tuple[str, str], float] | None = None,
    indexable_currencies: AbstractSet[str] = _INVERSE_CURRENCIES,
    exclude_spot_extraction: bool = False,
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

    ``exclude_spot_extraction`` (default ``False`` — byte-identical to every
    existing caller): the USD-space parallel of the native sibling's flag. When
    ``True`` (the ALLOCATED / Zavara path) net-extraction spot ``BTC_USDC`` legs are
    dropped from the USD day-sum too, so this stream and ``txn_rows_to_native_daily``
    stay consistent in the same mode. ``False`` sums every spot leg (pre-Bug-B).
    """
    # Pass 1: same-day per-currency event index from the batch's own index-
    # bearing rows (see _day_ccy_own_index for the M1 / untrusted-input pins).
    day_ccy_index = _day_ccy_own_index(
        rows, indexable_currencies=indexable_currencies
    )
    # Bug B — ALLOCATED PATH ONLY: net-extraction spot legs are dropped from the USD
    # sum too (same mode as the native sibling). EMPTY on the NAV path so this stream
    # is byte-identical to pre-Bug-B for every non-allocated caller.
    spot_extraction = (
        spot_net_extraction_day_pairs(rows) if exclude_spot_extraction else frozenset()
    )

    by_day: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", ""))
        if row_type in INFORMATIONAL_TYPES:
            continue
        # Bug B — ALLOCATED PATH ONLY: a net-extraction spot leg is capital
        # extraction, not trading P&L. EMPTY set on the NAV path → inert (spot legs
        # sum as before). Checked before the cash-bearing branch so the exclusion
        # matches the native sibling exactly.
        if _row_is_net_extraction_spot(row, spot_extraction):
            continue
        # Phase 128 (DERIBITFIX): a `correction` is gated PER ROW on info.reason. A
        # NON-trading correction fails loud on any cash (a possible capital
        # adjustment must NEVER be miscounted as trading performance) and harmlessly
        # ignores a zero-change annotation (no cash to misplace); a trading-reason
        # correction is realized cash and falls into the cash-bearing branch below
        # via ``_row_is_cash_bearing``.
        if row_type == "correction" and not correction_is_trading(row):
            change = _coerce_float(
                row.get("change", 0.0) or 0.0, field="change", row=row
            )
            if change != 0.0:
                assert_correction_classifiable(row)  # raises, naming the reason
            continue
        if _row_is_cash_bearing(row):
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
            # HIGH-2: a PRESENT-but-null/blank `change` (None, "", whitespace-only)
            # is schema drift too — the `or 0.0` coalesce below would silently zero
            # real realized cash and pass the completeness gate green. A numeric 0.0
            # (or "0") stays a legitimate zero-cash no-op.
            if raw_change is None or (
                isinstance(raw_change, str) and not raw_change.strip()
            ):
                raise LedgerValuationError(
                    f"cash-bearing Deribit row id={row.get('id')!r} "
                    f"type={row_type!r} has a null/blank change={raw_change!r} — "
                    "refusing to coalesce it to zero (schema drift would silently "
                    "zero realized cash and render a green-but-wrong track record)"
                )
            change = _coerce_float(raw_change, field="change", row=row)
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
            usd = txn_change_to_usd(
                row, fallback_index=fb, indexable_currencies=indexable_currencies
            )
            by_day[day] = by_day.get(day, 0.0) + usd
            continue
        # Unknown type (incl. options_settlement_summary, H3; `correction` is
        # per-row gated above — Phase 128): silence is unsafe both ways — fail loud
        # on any cash, harmlessly ignore a zero-change occurrence.
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


def _summary_coverage_windows(
    rows: Sequence[Mapping[str, Any]],
) -> dict[str, tuple[float, float]]:
    """Per-currency options-settlement coverage window (epoch-ms), derived from
    the batch's OWN ``options_settlement_summary`` rows:

        coverage_window[c] = (first_summary_ts[c] − 24h, last_summary_ts[c])

    A currency with NO summary rows is ABSENT from the dict → every option row of
    that currency stays cash-basis ``change`` (pre-rollout fallback, §1). The
    −24h lower shift covers the session PRECEDING the first summary (the first
    summary settles it); the upper bound is the last summary ts (option trades
    after it are the live partial session — cash-basis until the next crawl's
    summary lands, then convergent on recompute).

    Pure / never raises: an undatable summary ts is skipped (the
    ``assert_balance_identity`` guard is the money backstop). This is a value-inert
    pre-pass for perp-only / USD-native ledgers (no summaries → ``{}``), preserving
    SC-4 byte-identity."""
    first: dict[str, float] = {}
    last: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in _NATIVE_OPTIONS_SUMMARY_TYPES:
            continue
        try:
            instant = _row_utc_instant(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError):
            continue
        ccy = str(row.get("currency", "")).upper()
        if ccy not in first or instant < first[ccy]:
            first[ccy] = instant
        if ccy not in last or instant > last[ccy]:
            last[ccy] = instant
    return {ccy: (first[ccy] - _COVERAGE_DAY_MS, last[ccy]) for ccy in first}


def _ts_in_coverage(instant: float, window: tuple[float, float] | None) -> bool:
    """True iff ``instant`` (epoch-ms) is inside the inclusive coverage window;
    a missing window (currency never emitted a summary) is never covered."""
    if window is None:
        return False
    start, end = window
    return start <= instant <= end


def _pre_coverage_option_days(
    rows: Sequence[Mapping[str, Any]],
) -> list[tuple[str, str]]:
    """Sorted-unique ``(currency, utc_day)`` buckets carrying option
    ``trade``/``delivery`` rows that fall OUTSIDE their currency's coverage window
    (pre-rollout or trailing-edge cash-fallback). This is the list the adapter
    stamps as ``pre_summary_rollout_option_dailies`` → ``complete_with_warnings``
    (Q6). Empty for fully-covered and perp-only fixtures.

    Pure / never raises — an undatable row is skipped (the aggregator's verbatim
    ``change`` guards are the fail-loud path; this helper is advisory metadata)."""
    windows = _summary_coverage_windows(rows)
    out: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in ("trade", "delivery"):
            continue
        if classify_instrument(str(row.get("instrument_name", ""))) != "option":
            continue
        try:
            instant = _row_utc_instant(row.get("timestamp"))
            day = _row_utc_day(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError):
            continue
        ccy = str(row.get("currency", "")).upper()
        if not _ts_in_coverage(instant, windows.get(ccy)):
            out.add((ccy, day))
    return sorted(out)


def _option_activity_after_coverage(
    rows: Sequence[Mapping[str, Any]],
) -> frozenset[str]:
    """CR-01 — currencies that HAVE an options-settlement coverage window AND carry
    an option ``trade``/``delivery`` row with ``instant > window_end`` (the
    trailing-edge open-book signal).

    An option position opened/closed AFTER the last summary landed leaves the book
    non-flat across the covered span even when ``options_value == 0`` at the crawl
    instant — so the STRICT balance-identity guard (which closes ONLY for a
    flat-at-settlement book) would false-fire. This disjunct (unioned with the
    ``native_options_value != 0`` currencies at the call site) exempts such a
    currency from the strict guard; the §5 ``_assert_inception_reconciled`` gate
    remains the authoritative reconciliation.

    Reuses ``_summary_coverage_windows`` (the SAME per-currency windows the
    aggregator uses) and the option row-filter of ``_pre_coverage_option_days``,
    restricted to the trailing edge (``instant`` strictly past ``window_end``). A
    currency with NO window is ABSENT (that is the pre-rollout ``change``-fallback
    path, not an open book). Pure / never raises — an undatable row is skipped
    (the guard is the money backstop). Perp-only / USD-native → ``frozenset()``
    (SC-4 byte-inert)."""
    windows = _summary_coverage_windows(rows)
    out: set[str] = set()
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in ("trade", "delivery"):
            continue
        if classify_instrument(str(row.get("instrument_name", ""))) != "option":
            continue
        ccy = str(row.get("currency", "")).upper()
        window = windows.get(ccy)
        if window is None:
            continue  # no coverage window → pre-rollout path, not an open book
        try:
            instant = _row_utc_instant(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError):
            continue
        if instant > window[1]:  # strictly past the last summary → trailing edge
            out.add(ccy)
    return frozenset(out)


def assert_balance_identity(
    rows: Sequence[Mapping[str, Any]],
    native_daily: Mapping[str, Mapping[str, float]],
    *,
    native_floor: Mapping[str, float] | None = None,
    open_option_ccys: AbstractSet[str] = frozenset(),
    exclude_spot_extraction: bool = False,
    pnl_basis: str = DEFAULT_PNL_BASIS,
    terminal_book: Mapping[str, float] | None = None,
    native_options_value: Mapping[str, float] | None = None,
    native_options_session_upl: Mapping[str, float] | None = None,
    option_delta_mtm: Mapping[str, Mapping[str, float]] | None = None,
) -> None:
    """MANDATORY fail-loud reconcile guard (§1). Per currency ``c``, the computed
    total realized (Σ over ALL ``native_daily[c]`` day contributions) MUST equal
    ``Σ change`` over that currency's ``_NATIVE_CASH_BEARING_TYPES`` rows, to
    within ``max(floor_c, 1e-4 · throughput_c)`` where
    ``throughput_c = Σ|change|`` over those rows. On breach →
    ``LedgerValuationError`` (never ship).

    The REFERENCE row-set is ``_NATIVE_CASH_BEARING_TYPES`` (= the USD
    ``CASH_BEARING_TYPES`` PLUS the reclassed internal-rebalance ``swap``), NOT the
    USD set — using the USD set (which omits ``swap``) would false-fire by
    ``Σ(swap change)`` on any swap-bearing account.

    Closes by construction. Under CASH_SETTLEMENT (the DEFAULT / shipped basis)
    EVERY contribution IS the raw `change` (no summary channel, no coverage reshape),
    so the identity is a plain arithmetic Σ == Σ that closes trivially — its job on
    that path is to catch a DROPPED / MIS-SUMMED / mis-classified cash row (see B1:
    under cash_settlement it is the ONLY reconciliation, so no open-option exemption
    is applied). Under MARK_TO_MARKET: outside coverage the contributions ARE the
    changes; inside coverage the summary channel replaces the option cash legs
    (``residual = Σ(summary rpl+upl) − Σ_inside(change + commission)`` ≈ 0,
    probe-proven 9.222194 vs 9.222190) and the one residual money hole it catches — a
    mid-window session that LACKED a summary while options were open (its premium
    dropped with nothing carrying it) — is MARK_TO_MARKET-specific.

    ``floor_c`` (the ``$1``-equivalent NATIVE floor) is supplied by the adapter
    from the anchor mark; the pure helper defaults it to 0.0 (relative term only).
    Leak discipline (§App B): the raise names only currency + a coarse
    breach/tolerance magnitude class, never a held balance.

    CR-01 / B1 (BASIS-SCOPED) — ``open_option_ccys`` names currencies with a
    provably-OPEN option book (nonzero ``native_options_value`` and/or trailing
    option activity after the last summary). The strict identity above closes ONLY
    for a book FLAT at the last settlement (Σunrealized_pl telescopes to a terminal
    open-MTM of 0 iff flat). The exemption is legitimate ONLY under
    ``mark_to_market``: there the summary channel re-attributes option P&L and an
    OPEN book leaves a residual = the terminal open MTM that would false-fire this
    guard → a permanent FAILED on a healthy open-options account. On that
    mark_to_market/NAV path the §5 ``_assert_inception_reconciled`` gate
    (native_nav.py) is the authoritative backstop for exempted currencies (a dropped
    cash row / missing summary of size ``x`` surfaces there as ``§5 residual = x`` →
    InceptionReconciliationError, the SAME permanent-FAILED disposition).

    Under ``cash_settlement`` (the DEFAULT / Zavara basis) the caller MUST pass
    ``open_option_ccys=frozenset()`` (``build_deribit_native_ledger`` does): every
    option row books its FULL cash ``change``, so the strict Σnative==Σchange
    identity closes EXACTLY and MUST run on open-option currencies too — it is the
    ONLY fail-loud reconciliation on the allocated/cash_settlement path (§5 is
    BYPASSED there because ``combine_native_ledger`` returns the allocated-capital
    metrics before ``reconstruct_native_nav_and_twr``). Exempting a currency on that
    path would silently ship a wrong factsheet. The default ``frozenset()`` exempts
    nothing → every existing caller stays byte-identical (SC-4).

    F2 — PRE-ROLLOUT STRADDLE (INTENTIONAL fail-loud, §6 follow-up): a currency
    whose option book was held OPEN across the coverage-window START (a position
    opened >24h before the first summary, i.e. across the ~2025-01-12 rollout)
    telescopes ``Σ summary unrealized_pl`` from a NONZERO book-MTM-at-window-start
    ``V₀`` (not 0) — the pre-rollout open premium is counted verbatim outside
    coverage while the covered sessions' unrealized delta only sees ``V_N − V₀``,
    leaving an unreconciled residual = ``V₀``. Flat-at-crawl → THIS strict guard
    fires; open-at-crawl → exempted here but the §5 gate residual = ``V₀`` fires
    identically. BOTH are permanent FAILED (correct until ``V₀``-at-window-start
    handling is built — validate on live keys #2/#3 with pre-2025 option history).
    PINNED by ``test_pre_rollout_straddle_fails_loud_intentional``; do NOT loosen.

    ``exclude_spot_extraction`` MUST match the mode ``txn_rows_to_native_daily`` was
    called in for ``native_daily`` (default ``False`` = NAV path, spot retained on
    both sides; ``True`` = allocated path, spot dropped on both sides). A mismatch
    would false-fire the guard by ``Σ(spot extraction)`` — the coupling is why both
    are threaded from the SAME ``returns_denominator_config is not None`` signal."""
    floor = native_floor or {}
    # Bug B — ALLOCATED PATH ONLY (``exclude_spot_extraction``): the NET-DAILY
    # spot-extraction (day, pair) set — the SAME basis (and SAME mode) that
    # ``txn_rows_to_native_daily`` excludes on, so the reference Σchange and the
    # computed native_pnl never drift. EMPTY on the NAV path (config=None) → every
    # spot leg counts in the reference Σchange, matching the retained native_pnl.
    spot_extraction = (
        spot_net_extraction_day_pairs(rows) if exclude_spot_extraction else frozenset()
    )
    sigma_change: dict[str, float] = {}
    throughput: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        # Phase 128: the reference set includes a trading-reason `correction`
        # (``_row_is_native_cash_bearing`` — the SAME per-row gate the native
        # aggregator sums on) so a funding correction sits on BOTH sides of the
        # identity and does not false-fire; a non-trading correction is excluded
        # here exactly as the aggregator skips/fails it.
        if not _row_is_native_cash_bearing(row):
            continue
        # A net-extraction spot leg dropped from native_pnl (ALLOCATED path) MUST
        # also be excluded from this reference Σchange — else the guard false-fires
        # by Σ(spot extraction). ``spot_extraction`` is EMPTY on the NAV path, so no
        # spot leg is skipped and the reference matches the retained native_pnl.
        # Mirrors the aggregator's own net-daily skip in the SAME mode.
        if _row_is_net_extraction_spot(row, spot_extraction):
            continue
        raw = row.get("change")
        if raw is None:
            continue
        try:
            change = float(raw)  # aggregator already validated cash-bearing change
        except (TypeError, ValueError):
            continue
        ccy = str(row.get("currency", "")).upper()
        sigma_change[ccy] = sigma_change.get(ccy, 0.0) + change
        throughput[ccy] = throughput.get(ccy, 0.0) + abs(change)
    currencies = set(sigma_change) | {str(c).upper() for c in native_daily}
    for ccy in sorted(currencies):
        # CR-01: a provably-open option book cannot satisfy the flat-at-settlement
        # identity (residual = terminal open MTM). Skip the strict compare and let
        # §5 _assert_inception_reconciled be the authoritative reconciliation.
        #
        # F1 (bounded, §6 live-anchor follow-up): the exemption cannot ship an
        # UNBOUNDED wrong number (a material hole still fires §5, same permanent-
        # FAILED disposition), but the §5 silent envelope for an exempted currency
        # is WIDER than this strict per-ccy guard along three axes: (1) §5 tolerance
        # is account-level max($1, 1e-4·whole-account anchor NAV) vs this per-ccy
        # 1e-4·Σ|change|_ccy; (2) §5 values the residual at the INCEPTION mark
        # (D-07), undervaluing it ~N× for a coin appreciated N× since inception →
        # the window widens ~N×; (3) USD-family (USD/USDC/USDT/EURR/DAI) coalesce
        # into ONE signed §5 bucket so residuals NET before abs() (this per-ccy
        # guard abs()es each). DELIBERATE (do NOT modify the shared §5 gate — blast
        # radius on all native-reconstructed accounts); tighten at the first live
        # open-options onboarding. See docs/deribit-ingestion-design.md (CR-01).
        if ccy in open_option_ccys:
            continue
        computed = sum(native_daily.get(ccy, {}).values())
        reference = sigma_change.get(ccy, 0.0)
        residual = abs(computed - reference)
        tol = max(float(floor.get(ccy, 0.0)), 1e-4 * throughput.get(ccy, 0.0))
        if residual > tol:
            # LOW: the breach cause is BASIS-specific. Under cash_settlement (the
            # DEFAULT / fleet basis, no summary channel) every contribution IS the
            # raw change, so a breach means a DROPPED / MIS-CLASSIFIED cash-bearing
            # row. Under mark_to_market the summary channel can leave a hole when a
            # mid-window session lacked its options_settlement_summary.
            if pnl_basis == PNL_BASIS_MARK_TO_MARKET:
                _cause = (
                    "a mid-window session likely lacked its "
                    "options_settlement_summary; STOP and investigate that account's "
                    "summary stream"
                )
            else:
                _cause = (
                    "a cash-bearing row was likely dropped or mis-classified; STOP "
                    "and investigate that account's transaction log"
                )
            raise LedgerValuationError(
                f"Deribit balance-identity breach for currency {ccy!r}: computed "
                f"realized total diverges from Σchange over cash-bearing rows by "
                f"more than max($1-equiv, 1e-4·throughput) (residual/tolerance "
                f"class {residual / tol if tol else float('inf'):.1f}x) — "
                f"{_cause}, never loosen the tolerance (silent P&L misattribution "
                "risk)"
            )

    # SMOOTHED_MTM only (Phase 131 — additive, gated): the cash channel above ran
    # STRICT over ALL currencies (open_option_ccys is frozenset() under this basis —
    # every option row books its FULL cash change, so the flat-at-settlement identity
    # closes exactly and no exemption is needed). Now the two smoothed-only channels:
    #   (2) BOOK channel (anchor cross-check) — the replayed settled book
    #       Book(last settlement) reconciles against the venue anchor's SETTLED book
    #       (options_value − options_session_upl); an independent T-131-04 backstop
    #       (a position-field replay drift surfaces here, never as a silent wrong MTM).
    #   (3) SUMMARY cross-check (Q3-3) — over each summary coverage window,
    #       Σ(rpl+upl) == Σ(option change + commission) inside the window + ΔBook;
    #       the summaries stop DRIVING attribution but keep POLICING it.
    # Both are inert (no terminal_book / no summary rows) for perp-only / USD-native
    # ledgers → SC-4 byte-safe. cash_settlement / mark_to_market never enter here.
    if pnl_basis == PNL_BASIS_SMOOTHED_MTM and terminal_book is not None:
        _assert_smoothed_book_channel(
            terminal_book,
            native_options_value or {},
            native_options_session_upl or {},
            floor,
            throughput,
        )
        _assert_smoothed_summary_cross_check(
            rows, option_delta_mtm or {}, floor, throughput
        )


def _assert_smoothed_book_channel(
    terminal_book: Mapping[str, float],
    native_options_value: Mapping[str, float],
    native_options_session_upl: Mapping[str, float],
    floor: Mapping[str, float],
    throughput: Mapping[str, float],
) -> None:
    """SMOOTHED_MTM book channel (Q3-2): per currency the replayed settled option
    book ``Book(last settlement)`` (replay × daily marks, the Task-4 terminal_book)
    MUST reconcile against the anchor's SETTLED book =
    ``native_options_value[c] − native_options_session_upl[c]`` (both off the SAME
    summaries response), within ``max($1-equiv native floor, 1e-4·max(throughput,
    |settled anchor|))``. The daily marks are 08:00-settlement closes so they
    EXCLUDE the current session's unrealized move (which lives in
    ``options_session_upl``) — the decomposition is exact at the settled boundary.
    On breach → ``LedgerValuationError`` naming currency + a coarse magnitude class
    only (leak discipline). A perturbed anchor (replay/mark drift) fires here."""
    computed = {str(c).upper(): float(v) for c, v in terminal_book.items()}
    opt_value = {str(c).upper(): float(v) for c, v in native_options_value.items()}
    opt_sess = {
        str(c).upper(): float(v) for c, v in native_options_session_upl.items()
    }
    for ccy in sorted(set(computed) | set(opt_value)):
        settled_anchor = opt_value.get(ccy, 0.0) - opt_sess.get(ccy, 0.0)
        residual = abs(computed.get(ccy, 0.0) - settled_anchor)
        tol = max(
            float(floor.get(ccy, 0.0)),
            1e-4 * max(throughput.get(ccy, 0.0), abs(settled_anchor)),
        )
        if residual > tol:
            raise LedgerValuationError(
                f"Deribit smoothed_mtm book-channel breach for currency {ccy!r}: "
                "the replayed settled option book diverges from the anchor's settled "
                "book (options_value − options_session_upl) by more than "
                f"max($1-equiv, 1e-4·throughput) (residual/tolerance class "
                f"{residual / tol if tol else float('inf'):.1f}x) — a position-field "
                "replay drift or a stale/mis-keyed daily mark; STOP and investigate "
                "(never loosen the tolerance, silent MTM-misattribution risk)"
            )


def _assert_smoothed_summary_cross_check(
    rows: Sequence[Mapping[str, Any]],
    option_delta_mtm: Mapping[str, Mapping[str, float]],
    floor: Mapping[str, float],
    throughput: Mapping[str, float],
) -> None:
    """SMOOTHED_MTM summary cross-check (Q3-3): over each currency's
    ``options_settlement_summary`` coverage window, Deribit's OWN session P&L
    decomposition ``Σ(realized_pl + unrealized_pl)`` MUST reconcile against our
    reconstruction ``Σ(option change + commission)`` inside the window PLUS the
    smoothed book move ``ΔBook = Book(window end) − Book(window start)`` (the E3
    closure generalised to non-flat window ends via the ΔMTM series). Under
    smoothed the summaries no longer DRIVE attribution (the ΔMTM book does), so this
    is a pure POLICING channel — a material breach means the summary stream and the
    replay/mark reconstruction disagree → ``LedgerValuationError`` (currency +
    magnitude class only). INERT (no windows) for perp-only / USD-native / pre-
    rollout ledgers → SC-4 byte-safe. Never raises on undatable rows (skipped —
    the cash + book channels are the money backstops)."""
    windows = _summary_coverage_windows(rows)
    if not windows:
        return
    summary_sum: dict[str, float] = {}
    option_sum: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", ""))
        ccy = str(row.get("currency", "")).upper()
        window = windows.get(ccy)
        if window is None:
            continue
        try:
            instant = _row_utc_instant(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError):
            continue
        if not _ts_in_coverage(instant, window):
            continue
        if row_type in _NATIVE_OPTIONS_SUMMARY_TYPES:
            summary_sum[ccy] = summary_sum.get(ccy, 0.0) + _summary_contribution(row)
        elif row_type in ("trade", "delivery") and classify_instrument(
            str(row.get("instrument_name", ""))
        ) == "option":
            change = _coerce_float(
                row.get("change", 0.0) or 0.0, field="change", row=row
            )
            option_sum[ccy] = (
                option_sum.get(ccy, 0.0) + change + _option_commission(row)
            )
    for ccy, window in windows.items():
        start_ms, end_ms = window
        start_day = (
            datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).date().isoformat()
        )
        end_day = (
            datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).date().isoformat()
        )
        # ΔBook over the window = Book(end boundary) − Book(start boundary),
        # telescoped from the daily ΔMTM series. Marks are keyed by BAR-STAMP day
        # (M4): the bar stamped ``D 08:00`` COMPLETES at ``D+1 08:00``, so the
        # Book at a boundary instant ``day X 08:00`` is the day-keyed
        # ``Book[X−1]`` — the slice is therefore ``[start_day, end_day)``, NOT
        # ``(start_day, end_day]``. The old upper-shifted slice disagreed with
        # the ms cash filter at the 08:00 boundary (WR-02): it DROPPED a
        # coverage-era first trade's opening book entry (its cash IS inside the
        # ms window) and swept IN a trailing crawl-day trade's book entry (its
        # cash is OUTSIDE the ms window) — each mis-slicing the identity by a
        # full position's book value on real accounts, contradicting the settled
        # Phase-82 E3 flat-flat closure.
        delta_book = 0.0
        for day, value in option_delta_mtm.get(ccy, {}).items():
            if start_day <= day < end_day:
                delta_book += float(value)
        lhs = summary_sum.get(ccy, 0.0)
        rhs = option_sum.get(ccy, 0.0) + delta_book
        residual = abs(lhs - rhs)
        tol = max(
            float(floor.get(ccy, 0.0)),
            1e-4 * max(throughput.get(ccy, 0.0), abs(lhs), abs(rhs)),
        )
        if residual > tol:
            raise LedgerValuationError(
                f"Deribit smoothed_mtm summary cross-check breach for currency "
                f"{ccy!r}: Deribit's own Σ(realized_pl+unrealized_pl) over the "
                "options coverage window diverges from Σ(option change+commission) + "
                "ΔBook by more than max($1-equiv, 1e-4·throughput) (residual/tolerance "
                f"class {residual / tol if tol else float('inf'):.1f}x) — the summary "
                "stream and the replay/mark reconstruction disagree; STOP and "
                "investigate (never loosen the tolerance, silent MTM drift risk)"
            )


def _required_summary_field(row: Mapping[str, Any], field: str) -> float:
    """Read a REQUIRED numeric summary field (``realized_pl`` / ``unrealized_pl``)
    — both are present + numeric on every ``options_settlement_summary`` row
    (probe-verified). Absent / null / blank / non-numeric → ``LedgerValuationError``
    (schema-drift fail-loud, never attribute option P&L without both legs)."""
    raw = row.get(field, _MISSING)
    if raw is _MISSING or raw is None or (
        isinstance(raw, str) and not raw.strip()
    ):
        raise LedgerValuationError(
            f"options_settlement_summary Deribit row id={row.get('id')!r} has "
            f"absent/null {field} — both realized_pl and unrealized_pl are "
            "REQUIRED (Deribit's session P&L decomposition); refusing to attribute "
            "option P&L without it (schema drift would silently drop realized cash)"
        )
    return _coerce_float(raw, field=field, row=row)


def _summary_contribution(row: Mapping[str, Any]) -> float:
    """Native-pnl contribution of an ``options_settlement_summary`` row:
    ``realized_pl + unrealized_pl`` (``unrealized_pl`` is a session DELTA — E1,
    load-bearing). The row ``change`` is ALWAYS 0.0; a nonzero change is semantics
    drift → ``LedgerValuationError``."""
    change = _coerce_float(row.get("change", 0.0) or 0.0, field="change", row=row)
    if change != 0.0:
        raise LedgerValuationError(
            f"options_settlement_summary Deribit row id={row.get('id')!r} carries "
            f"a nonzero change — the summary recap change is always 0.0 (its P&L is "
            "in realized_pl/unrealized_pl); a nonzero change is semantics drift, "
            "classify against fresh evidence before ingesting"
        )
    return _required_summary_field(row, "realized_pl") + _required_summary_field(
        row, "unrealized_pl"
    )


def _option_commission(row: Mapping[str, Any]) -> float:
    """The POSITIVE commission on an option ``trade``/``delivery`` row (present +
    numeric on 100% of option rows — E3). Absent / null / blank / non-numeric →
    ``LedgerValuationError`` (inside coverage the fee leg is the ONLY contribution;
    fabricating it would silently mis-state P&L)."""
    raw = row.get("commission", _MISSING)
    if raw is _MISSING or raw is None or (
        isinstance(raw, str) and not raw.strip()
    ):
        raise LedgerValuationError(
            f"option Deribit row id={row.get('id')!r} type={row.get('type')!r} "
            "INSIDE coverage has absent/null commission — the premium cash is "
            "carried by the summary channel so the fee (−commission) is the only "
            "native-pnl contribution; refusing to fabricate it (E3: commission is "
            "present+numeric on every option row)"
        )
    return _coerce_float(raw, field="commission", row=row)


def _iter_utc_days(first_day: str, last_day: str) -> list[str]:
    """Every ISO ``YYYY-MM-DD`` in ``[first_day, last_day]`` inclusive — the DENSE
    calendar grid the smoothed-MTM book carries positions across (pure stdlib
    ``date`` arithmetic; the AST purity guard forbids pandas here)."""
    start = date.fromisoformat(first_day)
    end = date.fromisoformat(last_day)
    out: list[str] = []
    cursor = start
    while cursor <= end:
        out.append(cursor.isoformat())
        cursor += timedelta(days=1)
    return out


def replay_option_positions(
    rows: Sequence[Mapping[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Reconstruct the per-instrument, per-UTC-day signed OPEN option book by PURE
    replay of the signed post-trade ``position`` field on option ``trade``/
    ``delivery`` rows (M3 evidence: shorts negative, deliveries zero the position;
    no Greeks, no settlement math). NOT yet called by any production path — the
    ``smoothed_mtm`` basis wiring lands in 131-01b.

    Gated on the EXISTING :func:`classify_instrument` option arm — perp / future /
    spot rows are IGNORED (they carry their P&L on the cash ``change`` channel, not
    a marked option book). Rows are sorted by ``(timestamp, id)`` WITHIN each
    instrument before replay (crawl concat order is NOT trusted); the END-OF-DAY
    position is the ``position`` of the LAST row on that UTC day. A partial-delivery
    nonzero post-trade position is ACCEPTED as data (Deribit's call), never asserted
    zero.

    Returns ``{instrument: {currency, first_day, last_day, positions: {day:
    signed_size}}}`` where ``positions`` is keyed ONLY on event days (the caller
    :func:`option_mtm_daily` carries them forward across no-trade days).

    Fail-loud (leak-safe): an option trade/delivery row whose ``position`` is
    absent / null / blank / non-numeric raises ``LedgerValuationError`` naming the
    row ``id``/``type`` ONLY (the field is the SOLE book source — fabricating it
    would silently mis-state MTM; never echo the row payload or balances)."""
    per_instr: dict[str, list[Mapping[str, Any]]] = {}
    ccy_of: dict[str, str] = {}
    for row in rows:
        if str(row.get("type", "")) not in ("trade", "delivery"):
            continue
        instrument = str(row.get("instrument_name", ""))
        if classify_instrument(instrument) != "option":
            continue
        per_instr.setdefault(instrument, []).append(row)
        # WR-03: UPPERCASE like every other currency read site in this module —
        # the adapter merges the day-keyed ΔMTM into the UPPERCASE-keyed
        # native_pnl, so a raw-cased key would fork a phantom series bucket.
        ccy_of[instrument] = str(row.get("currency", "")).upper()
    out: dict[str, dict[str, Any]] = {}
    for instrument, instr_rows in per_instr.items():
        ordered = sorted(
            instr_rows,
            key=lambda r: (_row_utc_instant(r.get("timestamp")), str(r.get("id"))),
        )
        positions: dict[str, float] = {}
        for r in ordered:
            raw_pos = r.get("position", _MISSING)
            if raw_pos is _MISSING or raw_pos is None or (
                isinstance(raw_pos, str) and not raw_pos.strip()
            ):
                raise LedgerValuationError(
                    f"option Deribit row id={r.get('id')!r} type={r.get('type')!r} "
                    "has an absent/null/blank/non-numeric position — the signed "
                    "post-trade position is the ONLY option-book source; refusing "
                    "to fabricate it (schema drift would silently mis-state MTM)"
                )
            try:
                pos = float(raw_pos)
            except (TypeError, ValueError):
                raise LedgerValuationError(
                    f"option Deribit row id={r.get('id')!r} type={r.get('type')!r} "
                    "has an absent/null/blank/non-numeric position — the signed "
                    "post-trade position is the ONLY option-book source; refusing "
                    "to fabricate it (schema drift would silently mis-state MTM)"
                ) from None
            day = _row_utc_day(r.get("timestamp"))
            positions[day] = pos  # ascending order → last row of the day wins
        days_sorted = sorted(positions)
        out[instrument] = {
            "currency": ccy_of[instrument],
            "first_day": days_sorted[0],
            "last_day": days_sorted[-1],
            "positions": positions,
        }
    return out


def option_mtm_daily(
    positions: Mapping[str, Mapping[str, Any]],
    marks: Mapping[str, Mapping[str, float]],
) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """Per-(currency, UTC-day) ΔMTM redistribution + terminal book from the replayed
    option ``positions`` (from :func:`replay_option_positions`) and per-instrument
    daily ``marks`` (from ``fetch_deribit_option_daily_marks``). PURE (pandas/async-
    free — the AST purity guard enforces it); NOT yet called by any production path.

    Day-grid convention (pinned 83-PLAN §2-Q1): ``mark[instr][D]`` is the close of
    the 1D bar whose tick falls on UTC day ``D`` (the bar Deribit stamps at ``D``
    08:00 — its settlement boundary), keyed by the SAME
    ``strftime('%Y-%m-%d')`` UTC-day string the position replay grids on. The ≤8h
    skew between the 08:00 bar boundary and native midnight is intraday attribution
    noise WITHIN the one-day class; it cancels day-over-day so the telescoped TOTAL
    is EXACT regardless.

    Model: ``Book[c][d] = Σ_instr(currency c) position[instr][d] × mark[instr][d]``
    over a DENSE calendar grid where positions CARRY FORWARD between events but marks
    are NEVER filled; ``ΔMTM[c][d] = Book[c][d] − Book[c][d−1]``. Telescoping is
    exact: ``Σ_d ΔMTM[c][d] = Book[c][terminal] − 0`` (flat terminal ⇒ 0 ⇒ the
    ``smoothed_mtm`` total equals ``cash_settlement``). Returns
    ``(delta_mtm: {ccy: {day: ΔMTM}}, terminal_book: {ccy: Book[terminal]})``; the
    terminal book feeds 131-01b Task 5's book-channel anchor guard.

    Fail-loud (D-07): a day inside a listed instrument's held life with a NONZERO
    carried position and NO daily mark is a STRUCTURAL hole → ``LedgerValuationError``
    naming instrument + the EARLIEST missing day. NO interpolation, NO session-lump
    fallback (that lump IS the bug being removed). Instruments WHOLLY predating chart
    retention are excluded upstream (131-01b Task 4); STRADDLERS are NOT — their
    partial (head-hole) marks fall through to this same guard, so a currently-green
    options key can begin hard-failing on future recomputes as the ~2.5yr retention
    window advances (accepted D-07 consequence, surfaced in 131-02)."""
    if not positions:
        return {}, {}
    known_ccys = {str(p["currency"]) for p in positions.values()}
    global_first = min(str(p["first_day"]) for p in positions.values())
    candidate_lasts: list[str] = [str(p["last_day"]) for p in positions.values()]
    for instr_marks in marks.values():
        if instr_marks:
            candidate_lasts.append(max(instr_marks))
    global_last = max(candidate_lasts)

    instruments = sorted(positions)
    cur_pos: dict[str, float] = {instr: 0.0 for instr in instruments}
    prev_book: dict[str, float] = {ccy: 0.0 for ccy in known_ccys}
    delta_mtm: dict[str, dict[str, float]] = {}
    for day in _iter_utc_days(global_first, global_last):
        book: dict[str, float] = {ccy: 0.0 for ccy in known_ccys}
        for instr in instruments:
            pos_map = positions[instr]["positions"]
            if day in pos_map:
                cur_pos[instr] = float(pos_map[day])
            pos = cur_pos[instr]
            if pos == 0.0:
                continue
            mark = marks.get(instr, {}).get(day)
            if mark is None:
                raise LedgerValuationError(
                    f"option daily-MTM hole: instrument={instr} carries a nonzero "
                    f"position on {day} but has NO daily mark (bar) — refusing to "
                    "interpolate or fall back to the session lump (D-07: a missing "
                    "bar inside a listed instrument's life is structural, fail loud)"
                )
            ccy = str(positions[instr]["currency"])
            book[ccy] = book[ccy] + pos * float(mark)
        for ccy in known_ccys:
            change = book[ccy] - prev_book[ccy]
            if change != 0.0:
                delta_mtm.setdefault(ccy, {})[day] = change
        prev_book = book
    terminal_book = {ccy: prev_book[ccy] for ccy in known_ccys}
    return delta_mtm, terminal_book


def txn_rows_to_native_daily(
    rows: Sequence[Mapping[str, Any]],
    *,
    pnl_basis: str = DEFAULT_PNL_BASIS,
    exclude_spot_extraction: bool = False,
) -> dict[str, dict[str, float]]:
    """The ``(day, currency)``-keyed NATIVE-UNIT sibling of
    ``txn_rows_to_daily_records`` (§9.1): sum each return-bearing row's raw
    ``change`` by ``(UTC-day, currency)`` in NATIVE units — NO index multiply,
    NO ``supplemental_index``. Returns ``UPPERCASE-currency -> {utc_day_iso: Σ
    native change}`` (days ascending within each currency).

    The three ``change`` fail-loud guards (absent / null-blank / undatable-day)
    are LIFTED VERBATIM from ``txn_rows_to_daily_records`` so the two aggregators
    cannot drift (§4.1). The type-partition is the same EXCEPT the native-only
    ``swap`` reclassification (HIGH-1): ``swap`` is an INTERNAL cross-collateral
    rebalance whose per-leg native ``change`` is a real per-currency balance delta
    — INFORMATIONAL (skipped) in the USD path, but native-CASH_BEARING here so it
    enters native_pnl (else the per-bucket backward roll cannot close). It stays
    absent from ``_EXTERNAL_FLOW_TYPES`` so it never also enters ``F_t``
    (count-once). Concretely:
      * ``type`` in ``_NATIVE_INFORMATIONAL_TYPES`` (the external-flow / reward
        types: transfer / deposit / withdrawal / usdc_reward) -> skipped;
      * ``type`` in ``_NATIVE_CASH_BEARING_TYPES`` (``CASH_BEARING_TYPES`` PLUS the
        reclassed internal-rebalance ``swap``) -> its raw native ``change`` added to
        that row's ``(day, ccy)`` bucket. A quiet-day ``negative_balance_fee``
        (no instrument, no ``index_price``) contributes its native ``change``
        WITHOUT any settlement index — the P72 index dependency is GONE from
        native pnl (it shifts entirely to the 80-02 daily mark series);
      * ANY OTHER (unknown) ``type`` carrying nonzero ``change`` ->
        ``LedgerValuationError`` naming the type (fail loud), verbatim.

    The ONLY two differences from the sibling: (1) accumulate the raw
    ``_coerce_float(change)`` keyed ``(day, CCY_UPPER)`` — never
    ``txn_change_to_usd``, no index, and NO ``supplemental_index`` /
    ``indexable_currencies`` parameter (native units never need an index);
    (2) a zero-change cash-bearing row creates NO entry (native pnl has no
    all-zero-day placeholder — the native core unions flow days itself), whereas
    the USD sibling ``setdefault(day, 0.0)``.

    The dict -> ``pd.Series`` conversion (tz-naive midnight ``DatetimeIndex``,
    per ``NativeLedger.native_pnl: Mapping[str, pd.Series]``) is done by
    ``build_deribit_native_ledger`` (80-02): this module stays pandas-pure (the
    AST purity guard in test_deribit_txn.py forbids a pandas import), so — like
    the parent's ``list[dict]`` — the sibling returns plain data.

    Leak discipline (§App B): the absent/null-blank/undatable guards name only
    id/type. The unknown-type guard is lifted VERBATIM from
    ``txn_rows_to_daily_records`` — INCLUDING its ``({change})`` in the raise
    message. That embedded ``change`` is a SINGLE per-row native delta (never an
    account total or a held balance) and the guard fires ONLY on unknown-type
    schema drift; keeping the raise byte-identical to the parent is the deliberate
    anti-drift choice (§4.1) so the two aggregators cannot diverge. (Scrubbing
    ``({change})`` from BOTH raises is the alternative if per-row deltas must never
    surface at all; it is intentionally NOT done here to preserve verbatim parity.)

    ``exclude_spot_extraction`` (default ``False`` — the NAV path, byte-identical to
    pre-Bug-B): when ``True`` (the ALLOCATED / Zavara path, threaded from a non-None
    ``returns_denominator_config``) net-extraction spot ``BTC_USDC`` legs are DROPPED
    from ``native_pnl`` per Zavara's profit-extraction methodology. ``False`` retains
    every spot leg verbatim so the §5 inception reconciliation closes on a normal NAV
    account (a dropped sell leg would otherwise leave a §5 residual — no flow channel
    carries it). ``assert_balance_identity`` MUST be called in the SAME mode.
    """
    if pnl_basis not in _PNL_BASES:
        raise LedgerValuationError(
            f"unknown pnl_basis {pnl_basis!r}; expected one of "
            f"{sorted(_PNL_BASES)} — refusing to compute daily P&L on an "
            "unrecognized accrual basis"
        )
    use_mtm = pnl_basis == PNL_BASIS_MARK_TO_MARKET
    # Phase 131 SMOOTHED_MTM: the cash channel here is BYTE-IDENTICAL to
    # cash_settlement — option trade/delivery rows book their FULL cash `change`
    # (coverage_windows below is empty for every non-mtm basis, so the coverage-
    # gated −commission arm is never entered) and the summary channel contributes
    # NOTHING (handled by the smoothed summary arm below, which still enforces
    # change==0). The per-(day,ccy) ΔMTM redistribution is merged by the ADAPTER
    # (``build_deribit_native_ledger``, Task 4), NOT here — keeping this module
    # pandas/async-free (AST purity) and the signature marks-free (83-PLAN Q2).
    use_smoothed = pnl_basis == PNL_BASIS_SMOOTHED_MTM
    # Phase 82 pre-pass (MARK_TO_MARKET only): per-currency options coverage
    # windows from this batch's own summary rows. Value-inert for perp-only /
    # USD-native ledgers (no summaries → {}). In CASH_SETTLEMENT and SMOOTHED_MTM
    # the summary channel is not consulted at all — options book their raw cash
    # `change`.
    coverage_windows = _summary_coverage_windows(rows) if use_mtm else {}
    # Bug B — ALLOCATED PATH ONLY (``exclude_spot_extraction=True``, threaded from a
    # non-None ``returns_denominator_config``): the NET-DAILY spot-extraction
    # (day, pair) set. A single pre-pass nets each conversion pair's spot legs per
    # UTC day; a net-extraction pair's spot legs are ALL dropped below (Zavara
    # profit-extraction methodology). ``assert_balance_identity`` excludes on the
    # SAME set in the SAME mode so the reference Σchange and native_pnl never drift.
    #
    # ponytail: this couples the pnl-space (native_pnl) and the balance-identity
    # reference row-set — BOTH must exclude, or BOTH include, per mode. When OFF
    # (the NAV path, config=None) the set is EMPTY so every spot leg is retained
    # verbatim (pre-Bug-B behaviour; §5 inception reconciles). Upgrade path: if a
    # non-Zavara ALLOCATED account ever needs spot RETAINED, split this off a
    # dedicated config axis rather than reusing the allocated/NAV distinction.
    spot_extraction = (
        spot_net_extraction_day_pairs(rows) if exclude_spot_extraction else frozenset()
    )
    by_day_ccy: dict[tuple[str, str], float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        row_type = str(row.get("type", ""))
        # HIGH-1: the native sibling reclasses `swap` (an INTERNAL rebalance) from
        # the skip set into the cash-bearing set — its per-leg native `change` is a
        # real per-currency balance delta that belongs in native_pnl. The USD sets
        # (and thus ``txn_rows_to_daily_records``) are untouched.
        if row_type in _NATIVE_INFORMATIONAL_TYPES:
            continue
        # Bug B — ALLOCATED PATH ONLY: a spot BTC_USDC leg on a NET-EXTRACTION day
        # (the day's spot netted coin-OUT / cash-IN) is profit-taking capital, NOT
        # trading P&L — zavara DROPS the whole day's spot from the reported track. A
        # net-REDEPLOY / wash day's spot legs stay in native_pnl. ``spot_extraction``
        # is EMPTY on the NAV path (config=None), so this skip is inert there and
        # every spot leg is retained. Checked before the cash-bearing branch so it
        # applies identically under cash_settlement AND mark_to_market.
        if _row_is_net_extraction_spot(row, spot_extraction):
            continue
        # MARK_TO_MARKET only: options_settlement_summary contributes
        # realized_pl + unrealized_pl (session DELTA, load-bearing). Row change is
        # always 0.0 (nonzero → fail loud). NOT subject to the cash-bearing
        # change==0 skip (its P&L is in the summary fields, not change). Under
        # CASH_SETTLEMENT the summary row falls through to the unknown-type guard
        # where its 0.0 change is harmlessly ignored (its P&L is carried instead
        # by the option trade/delivery cash `change` on the settlement day).
        if use_mtm and row_type in _NATIVE_OPTIONS_SUMMARY_TYPES:
            contribution = _summary_contribution(row)
            try:
                day = _row_utc_day(row.get("timestamp"))
            except ValueError as e:
                raise LedgerValuationError(str(e)) from e
            if contribution == 0.0:
                continue
            ccy = str(row.get("currency", "")).upper()
            # WR-03: a nonzero-P&L summary with a blank/missing currency would
            # mis-bucket realized_pl+unrealized_pl into a "" bucket. Fail loud
            # (schema-drift discipline, consistent with _required_summary_field) —
            # never silently attribute option P&L to a blank currency.
            if not ccy:
                raise LedgerValuationError(
                    f"options_settlement_summary Deribit row id={row.get('id')!r} "
                    "has empty/missing currency yet carries nonzero "
                    "realized_pl+unrealized_pl — refusing to bucket option P&L into "
                    "a blank-currency bucket (schema drift would silently "
                    "mis-attribute realized cash)"
                )
            key = (day, ccy)
            by_day_ccy[key] = by_day_ccy.get(key, 0.0) + contribution
            continue
        # SMOOTHED_MTM only: options_settlement_summary does NOT drive attribution
        # (the per-(day,ccy) ΔMTM book, merged by the adapter, does). It
        # contributes NOTHING here — but its `change` is still ALWAYS 0.0; a
        # nonzero change is semantics drift → fail loud (mirrors the mtm arm's
        # _summary_contribution change guard, verbatim). Under smoothed the summary
        # survives ONLY as the Q3-3 reconciliation cross-check in
        # assert_balance_identity (the summaries stop driving attribution but keep
        # policing it). Gated on use_smoothed → cash_settlement / mark_to_market
        # are byte-untouched (SC-4).
        if use_smoothed and row_type in _NATIVE_OPTIONS_SUMMARY_TYPES:
            summary_change = _coerce_float(
                row.get("change", 0.0) or 0.0, field="change", row=row
            )
            if summary_change != 0.0:
                raise LedgerValuationError(
                    f"options_settlement_summary Deribit row id={row.get('id')!r} "
                    "carries a nonzero change under smoothed_mtm — the summary "
                    "recap change is always 0.0 (option P&L is redistributed via "
                    "the daily ΔMTM book); a nonzero change is semantics drift, "
                    "classify against fresh evidence before ingesting"
                )
            continue
        # Phase 128 (DERIBITFIX): a `correction` is gated PER ROW on info.reason —
        # the SAME gate as the USD sibling so the two paths never diverge on which
        # corrections count. A NON-trading correction fails loud on any cash (never
        # miscount a possible capital adjustment as trading performance) and
        # harmlessly ignores a zero-change annotation; a trading-reason correction is
        # realized cash and falls into the cash-bearing branch via
        # ``_row_is_native_cash_bearing``.
        if row_type == "correction" and not correction_is_trading(row):
            change = _coerce_float(
                row.get("change", 0.0) or 0.0, field="change", row=row
            )
            if change != 0.0:
                assert_correction_classifiable(row)  # raises, naming the reason
            continue
        if _row_is_native_cash_bearing(row):
            # [VERBATIM from txn_rows_to_daily_records] absent-`change` guard: a
            # cash-bearing row MUST carry a `change` field. Coalescing absent→0.0
            # would silently zero real cash and pass the completeness gate green.
            raw_change = row.get("change", _MISSING)
            if raw_change is _MISSING:
                raise LedgerValuationError(
                    f"cash-bearing Deribit row id={row.get('id')!r} "
                    f"type={row_type!r} has NO `change` field — refusing to treat a "
                    "missing balance-delta as zero (schema drift would silently "
                    "zero realized cash and render a green-but-wrong track record)"
                )
            # [VERBATIM] null/blank-`change` guard: a PRESENT-but-null/blank
            # change (None, "", whitespace-only) is schema drift too; a numeric
            # 0.0 (or "0") stays a legitimate zero-cash no-op.
            if raw_change is None or (
                isinstance(raw_change, str) and not raw_change.strip()
            ):
                raise LedgerValuationError(
                    f"cash-bearing Deribit row id={row.get('id')!r} "
                    f"type={row_type!r} has a null/blank change={raw_change!r} — "
                    "refusing to coalesce it to zero (schema drift would silently "
                    "zero realized cash and render a green-but-wrong track record)"
                )
            change = _coerce_float(raw_change, field="change", row=row)
            # [VERBATIM] undatable-day guard: fail loud as a STRUCTURAL valuation
            # error (permanent), not a bare ValueError the network over-catch
            # would mistake for transient.
            try:
                day = _row_utc_day(row.get("timestamp"))
            except ValueError as e:
                raise LedgerValuationError(str(e)) from e
            ccy = str(row.get("currency", "")).upper()
            # Phase 82 coverage-gated option re-attribution (classification-gated —
            # NEVER consulted for non-option rows, so the perp/future/spot path is
            # byte-identical: contribution stays `change`). Inside a currency's
            # summary coverage window an option trade/delivery contributes ONLY the
            # fee (−commission); the premium/payout cash is carried by the summary
            # channel. Outside the window (pre-rollout or trailing-edge) it keeps
            # the full `change` (cash fallback, flagged by _pre_coverage_option_days).
            contribution = change
            if row_type == "trade" or row_type == "delivery":
                cls = classify_instrument(str(row.get("instrument_name", "")))
                if cls == "option":
                    instant = _row_utc_instant(row.get("timestamp"))
                    if _ts_in_coverage(instant, coverage_windows.get(ccy)):
                        contribution = -_option_commission(row)
                    # else: cash fallback — contribution stays `change`.
                elif (
                    row_type == "delivery"
                    and cls in ("unknown", "spot")
                    and change != 0.0
                ):
                    # A delivery ALWAYS names an expiring DERIVATIVE instrument. An
                    # unknown-classified delivery with nonzero cash would mis-route
                    # expiry P&L; a SPOT-named delivery (underscore BASE_QUOTE) is
                    # nonsensical — spot does not deliver (S4: classify_instrument now
                    # returns "spot" for BTC_USDC, so it must be caught here too or an
                    # underscore-named delivery row would be booked silently). Fail
                    # loud, never guess (D-08).
                    raise LedgerValuationError(
                        f"Deribit delivery row id={row.get('id')!r} names an "
                        "unclassifiable or spot instrument yet carries nonzero cash — "
                        "refusing to guess an expiring instrument's P&L channel "
                        "(never silently mis-route delivery cash)"
                    )
            if contribution == 0.0:
                # Difference (2): native pnl has NO all-zero-day placeholder
                # (the USD sibling setdefault(day, 0.0) here). No cash → no entry.
                continue
            # Difference (1): sum the RAW native contribution — never
            # index-multiplied (no txn_change_to_usd, no supplemental_index). The
            # index dependency lives entirely in the 80-02 daily mark series.
            key = (day, ccy)
            by_day_ccy[key] = by_day_ccy.get(key, 0.0) + contribution
            continue
        # [VERBATIM] unknown-type nonzero-`change` fail-loud (H3): silence is
        # unsafe both ways — fail loud on any cash, harmlessly ignore a
        # zero-change occurrence.
        change = _coerce_float(row.get("change", 0.0) or 0.0, field="change", row=row)
        if change != 0.0:
            raise LedgerValuationError(
                f"unknown Deribit transaction-log type {row_type!r} carries "
                f"nonzero change ({change}); it is in neither CASH_BEARING nor "
                "INFORMATIONAL — classify it against fresh evidence before "
                "ingesting (never silently drop nor double-count realized cash)"
            )
    result: dict[str, dict[str, float]] = {}
    for (day, ccy), amount in sorted(by_day_ccy.items()):
        result.setdefault(ccy, {})[day] = amount
    return result
