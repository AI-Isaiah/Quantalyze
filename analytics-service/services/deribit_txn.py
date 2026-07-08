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

* ⚠️ PHASE 82 (options-aware, native path only) — the "sums `change`" pin above
  is AMENDED for OPTION rows: inside a currency's summary coverage window
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
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
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

# --- native options P&L channel (Phase 82, options-aware daily P&L) -----------
# The `options_settlement_summary` type is Deribit's own daily MTM decomposition
# (`realized_pl` = session realized, `unrealized_pl` = session DELTA — a
# LOAD-BEARING per-session change, not a level). On the NATIVE path it is
# CLASSIFIED (contributes `realized_pl + unrealized_pl`); its row `change` is
# always 0.0 (nonzero → fail loud). In the USD sibling it stays DELIBERATELY
# unclassified (P70 H3, :437-444) — zero-change → ignored, nonzero → loud.
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
# and `correction` (an ambiguous manual adjustment that CAN be a real
# credit/debit). Leaving them unclassified in the USD path means a nonzero-`change`
# occurrence FAILS LOUD via the unknown-type guard below (never a silent skip),
# while their normal zero-`change` form is harmlessly ignored.
#
# ⚠️ PHASE 82 (native path only): `options_settlement_summary` IS now classified
# by `txn_rows_to_native_daily` via `_NATIVE_OPTIONS_SUMMARY_TYPES` — it carries
# the option book's session MTM (`realized_pl + unrealized_pl`) into native_pnl
# (its `change` is always 0.0; a nonzero change fails loud there). The USD sibling
# `txn_rows_to_daily_records` is UNCHANGED: summary stays unclassified (zero-change
# ignored, nonzero → loud). `correction` remains unclassified on BOTH paths. Every
# UNKNOWN type carrying nonzero `change` fails loud the same way.


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
        # below — a USD-family flow never consumes an index.)
        row_type = str(row.get("type", ""))
        if row_type not in CASH_BEARING_TYPES and row_type not in _EXTERNAL_FLOW_TYPES:
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
    day_ccy_index = _day_ccy_own_index(
        rows, indexable_currencies=indexable_currencies
    )

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


# ===========================================================================
# Phase 83 — daily option mark-to-market attribution (pure replay + ΔMTM).
#
# The Phase-82 coverage-gated attribution lumped each options_settlement_summary's
# (realized_pl + unrealized_pl) — a per-SESSION delta spanning MANY days — onto the
# ONE settlement day. Phase 83 REDISTRIBUTES that P&L across the days it accrued by
# marking the open option book DAILY: replay the signed post-trade `position` per
# instrument, mark it at the 1D chart close (fetched by the adapter), and take the
# day-over-day book delta ΔMTM. This is a REDISTRIBUTION that PRESERVES the total
# (telescoping: Σ_d ΔMTM = Book[last_marked_day] − 0), so the closure gates stay
# green by construction. Pure/pandas-free (the AST purity guard still holds).
# ===========================================================================


@dataclass(frozen=True)
class OptionInstrumentReplay:
    """Per-instrument end-of-day open-position replay (Phase 83, Q2).

    ``positions`` maps each event ``utc_day`` → the signed post-trade position
    AFTER the last option ``trade``/``delivery`` row of that day (shorts negative;
    a delivery that fully expires zeroes it). Days BETWEEN events carry the last
    value forward (a balance is constant between ledger events — resolved by
    :func:`option_mtm_daily`, never stored densely). ``first_day``/``last_day`` are
    the earliest/latest event days (the marked span cap — a position cannot outlive
    its expiry, so ``last_day`` already caps the fetch/mark span; no expiry parse)."""

    currency: str
    first_day: str
    last_day: str
    positions: dict[str, float] = field(default_factory=dict)


def _required_option_position(row: Mapping[str, Any]) -> float:
    """The signed post-trade ``position`` on an option ``trade``/``delivery`` row —
    the ONLY position source (Phase 83). Absent / null / blank / non-numeric →
    ``LedgerValuationError`` (schema drift; fabricating a book mis-states MTM).
    Leak discipline: names only id/type."""
    raw = row.get("position", _MISSING)
    if raw is _MISSING or raw is None or (
        isinstance(raw, str) and not raw.strip()
    ):
        raise LedgerValuationError(
            f"option Deribit row id={row.get('id')!r} type={row.get('type')!r} has "
            "absent/null/blank position — the signed post-trade position is the "
            "ONLY source for the open-book MTM replay; refusing to fabricate a "
            "position (would silently mis-state option mark-to-market)"
        )
    try:
        return float(raw)
    except (TypeError, ValueError):
        raise LedgerValuationError(
            f"option Deribit row id={row.get('id')!r} type={row.get('type')!r} has "
            f"non-numeric position — refusing to fabricate the open-book position "
            "(would silently mis-state option mark-to-market)"
        ) from None


def replay_option_positions(
    rows: Sequence[Mapping[str, Any]],
) -> dict[str, OptionInstrumentReplay]:
    """Reconstruct per-instrument end-of-day open OPTION positions from the signed
    post-trade ``position`` field on option ``trade``/``delivery`` rows (Phase 83,
    §2 Q2). Classification-gated via :func:`classify_instrument` (option arm only)
    — perp/future/spot rows are IGNORED, so a perp-only ledger returns ``{}`` (SC-4
    byte-inert: no replay → no marks fetched → no ΔMTM).

    Rows are ordered by ``(timestamp, id)`` within each instrument before replay
    (crawl concat order is NOT trusted); the LAST row on a day sets that day's
    end-of-day position. Returns ``{instrument_name: OptionInstrumentReplay}``.

    Fail-loud (``LedgerValuationError``, id/type-only): an option row with an
    absent/null/non-numeric ``position`` (schema drift) or an undatable timestamp
    (verbatim guard class). A ``delivery`` whose post-trade position is NONZERO is
    accepted as DATA (partial delivery is Deribit's call — never asserted zero)."""
    # Group option rows by instrument, capturing each row's datable instant (fail
    # loud on an undatable timestamp — the verbatim guard class) for the sort.
    grouped: dict[str, list[tuple[float, Any, Mapping[str, Any]]]] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in ("trade", "delivery"):
            continue
        instrument = str(row.get("instrument_name", ""))
        if classify_instrument(instrument) != "option":
            continue
        try:
            instant = _row_utc_instant(row.get("timestamp"))
        except (ValueError, TypeError, OverflowError) as e:
            raise LedgerValuationError(
                f"option Deribit row id={row.get('id')!r} type={row.get('type')!r} "
                f"has an undatable timestamp={row.get('timestamp')!r} — refusing to "
                "replay an option position without a datable settlement day"
            ) from e
        rid = row.get("id")
        try:
            rid_sort: float = float(rid)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            rid_sort = 0.0
        grouped.setdefault(instrument, []).append((instant, rid_sort, row))

    out: dict[str, OptionInstrumentReplay] = {}
    for instrument, entries in grouped.items():
        entries.sort(key=lambda e: (e[0], e[1]))
        positions: dict[str, float] = {}
        currency = ""
        days: list[str] = []
        for _instant, _rid, row in entries:
            pos = _required_option_position(row)
            day = _row_utc_day(row.get("timestamp"))
            positions[day] = pos  # end-of-day = last row of the day (sorted)
            if day not in days:
                days.append(day)
            currency = str(row.get("currency", "")).upper()
        first_day = min(days)
        last_day = max(days)
        out[instrument] = OptionInstrumentReplay(
            currency=currency,
            first_day=first_day,
            last_day=last_day,
            positions=positions,
        )
    return out


def _calendar_days(first_day: str, last_day: str) -> list[str]:
    """Inclusive ascending list of ``YYYY-MM-DD`` UTC days in ``[first_day,
    last_day]``. Pure; both bounds are already-validated ISO day strings."""
    start = datetime.strptime(first_day, "%Y-%m-%d")
    end = datetime.strptime(last_day, "%Y-%m-%d")
    out: list[str] = []
    d = start
    while d <= end:
        out.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    return out


def _position_on_day(replay: OptionInstrumentReplay, day: str) -> float:
    """Carry-forward position for ``replay`` on ``day``: the value from the last
    event-day ``≤ day`` (a balance is constant between ledger events; marks are
    NEVER filled). 0.0 before the first event day."""
    result = 0.0
    for ev_day in sorted(replay.positions):
        if ev_day <= day:
            result = replay.positions[ev_day]
        else:
            break
    return result


def option_mtm_daily(
    positions: Mapping[str, OptionInstrumentReplay],
    marks: Mapping[str, Mapping[str, float]],
) -> tuple[dict[str, dict[str, float]], dict[str, float]]:
    """Per-``(day, currency)`` day-over-day ΔMTM of the replayed open option book
    (Phase 83, §2 Q3). ``Book[c][d] = Σ_instr pos[instr][d] × mark[instr][d]`` over
    the currency's union calendar grid (positions carry forward between events;
    marks are NEVER filled), ``ΔMTM[c][d] = Book[c][d] − Book[c][d−1]``. Day-grid
    convention: bar-tick UTC day = native grid day (§2 Q1) — ``positions`` (via
    ``_row_utc_day``) and ``marks`` (via the 1D bar tick → ``%Y-%m-%d``) share it.

    Returns ``(delta_mtm, terminal_book)``:
      * ``delta_mtm[c][d]`` — the per-day ΔMTM the adapter MERGES into the cash
        ``native_daily`` (only nonzero deltas are stored);
      * ``terminal_book[c]`` — ``Book[c][last grid day]`` = ``Σ_d ΔMTM[c][d]`` (it
        telescopes from a pre-inception book of 0). Feeds the balance-identity
        book-channel cross-check (settled-book anchor).

    Fail-loud (D-07, ``LedgerValuationError`` naming instrument + day): a day inside
    an instrument's ``[first_day, last_day]`` where its position is NONZERO and its
    mark map has NO bar — a STRUCTURAL hole (the probe showed this essentially never
    happens). NO interpolation, NO session-lump fallback (that lump IS the bug being
    removed). Instruments flagged pre-retention (empty marks, expiry pre-retention)
    are EXCLUDED by the adapter BEFORE this function sees them.

    ⚠️ Boundary asymmetry (§6 live watch): an instrument whose ``last_day`` precedes
    the currency's global last grid day drops out of ``Book`` after ``last_day`` (it
    contributes 0), so an OPEN terminal position on a NON-last-day instrument would
    register a spurious ΔMTM on ``last_day+1``. Total-exact regardless (telescoped);
    the Task-8(ii) non-flat fixture is constructed with the open instrument's last
    trade on the crawl day so ``last_day`` == the grid's last day."""
    by_ccy: dict[str, list[str]] = {}
    for instrument, replay in positions.items():
        by_ccy.setdefault(replay.currency, []).append(instrument)

    delta_mtm: dict[str, dict[str, float]] = {}
    terminal_book: dict[str, float] = {}
    for ccy, instruments in by_ccy.items():
        first = min(positions[i].first_day for i in instruments)
        last = max(positions[i].last_day for i in instruments)
        prev_book = 0.0
        for day in _calendar_days(first, last):
            book = 0.0
            for instrument in instruments:
                replay = positions[instrument]
                if day < replay.first_day or day > replay.last_day:
                    continue  # instrument not active on this day → contributes 0
                pos = _position_on_day(replay, day)
                if pos == 0.0:
                    continue  # flat position → no mark needed
                mark = marks.get(instrument, {}).get(day)
                if mark is None:
                    raise LedgerValuationError(
                        f"option instrument {instrument!r} has a nonzero position "
                        f"on {day} (inside its listed life) but NO 1D daily-mark bar "
                        "— a sparse mark inside an instrument's life is STRUCTURAL "
                        "(D-07); refusing to interpolate or fall back to the session "
                        "lump (that lump is the misattribution being removed)"
                    )
                book += pos * float(mark)
            delta = book - prev_book
            if delta != 0.0:
                delta_mtm.setdefault(ccy, {})[day] = delta
            prev_book = book
        terminal_book[ccy] = prev_book
    return delta_mtm, terminal_book


def _summary_channel_cross_check(
    rows: Sequence[Mapping[str, Any]],
    delta_mtm: Mapping[str, Mapping[str, float]],
    floor: Mapping[str, float],
) -> None:
    """Channel 3 (§2 Q3-3) — the summaries STOP driving attribution but keep
    POLICING it. Over each currency's summary coverage window, the E3 closure
    generalizes to a non-flat window end via the MTM series:

        Σ_window (realized_pl + unrealized_pl)
            == Σ_window (option change + commission) + [Book(end) − Book(start)]

    where ``Book(end) − Book(start) = Σ_{start_day ≤ d ≤ end_day} ΔMTM[c][d]`` (the
    pre-rollout straddle's ``V₀`` is now CARRIED by the daily marks, so the covered
    window's ΔBook sees ``V_N − V₀`` — the same telescope the summaries do → the
    straddle reconciles). A MATERIAL breach → ``LedgerValuationError`` naming
    currency + magnitude class only (a dropped/mis-stated summary of size). The
    tolerance absorbs the 08:00-bar-vs-midnight day-boundary skew (§6) via a
    relative term on the summary throughput + the window's book move; a real
    dropped summary exceeds it. Runs ONLY when the adapter threads ``delta_mtm``
    (a standalone / pure caller passes nothing → this cross-check is skipped)."""
    windows = _summary_coverage_windows(rows)
    if not windows:
        return
    summary_total: dict[str, float] = {}
    summary_throughput: dict[str, float] = {}
    option_cash: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        rtype = str(row.get("type", ""))
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
        if rtype in _NATIVE_OPTIONS_SUMMARY_TYPES:
            contrib = _summary_contribution(row)  # requires rpl+upl, change==0
            summary_total[ccy] = summary_total.get(ccy, 0.0) + contrib
            summary_throughput[ccy] = summary_throughput.get(ccy, 0.0) + abs(contrib)
        elif rtype in ("trade", "delivery"):
            if classify_instrument(str(row.get("instrument_name", ""))) != "option":
                continue
            change = _coerce_float(
                row.get("change", 0.0) or 0.0, field="change", row=row
            )
            option_cash[ccy] = option_cash.get(ccy, 0.0) + change + _option_commission(
                row
            )
    for ccy, window in windows.items():
        start_day = _row_utc_day(window[0])
        end_day = _row_utc_day(window[1])
        delta_book = sum(
            v
            for d, v in delta_mtm.get(ccy, {}).items()
            if start_day <= d <= end_day
        )
        reconstructed = option_cash.get(ccy, 0.0) + delta_book
        residual = abs(summary_total.get(ccy, 0.0) - reconstructed)
        tol = max(
            float(floor.get(ccy, 0.0)),
            1e-2 * (summary_throughput.get(ccy, 0.0) + abs(delta_book)),
        )
        if residual > tol:
            raise LedgerValuationError(
                f"Deribit summary-channel cross-check breach for currency {ccy!r}: "
                "Σ(realized_pl+unrealized_pl) over the coverage window diverges from "
                "Σ(option change+commission) + ΔBook(window) by more than "
                f"max($1-equiv, 1e-2·(Σ|summary|+|ΔBook|)) (residual/tolerance class "
                f"{residual / tol if tol else float('inf'):.1f}x) — a summary was "
                "likely dropped or mis-stated; STOP and investigate the summary "
                "stream, never loosen (silent P&L misattribution risk)"
            )


def assert_balance_identity(
    rows: Sequence[Mapping[str, Any]],
    native_daily: Mapping[str, Mapping[str, float]],
    *,
    native_floor: Mapping[str, float] | None = None,
    terminal_book: Mapping[str, float] | None = None,
    anchor_settled_book: Mapping[str, float] | None = None,
    delta_mtm: Mapping[str, Mapping[str, float]] | None = None,
) -> None:
    """MANDATORY fail-loud reconcile guard (§2 Q3, Phase 83) — THREE channels.

    ``native_daily`` MUST be the PRE-MERGE CASH-ONLY daily dict (M3): channel 1
    reconciles it against Σchange, so a ΔMTM-merged dict would false-fire (Σchange +
    Book ≠ Σchange). The adapter keeps the cash-only reference for this guard and
    builds the pd.Series from the merged values.

    **Channel 1 — strict cash identity (ALL currencies, exact).** Per currency
    ``c``, ``Σ native_daily[c]`` MUST equal ``Σ change`` over that currency's
    ``_NATIVE_CASH_BEARING_TYPES`` rows, to ``max(floor_c, 1e-4·throughput_c)``.
    With Phase 83 restoring FULL option `change` and making the summary inert on the
    native path, this is a plain ARITHMETIC identity — the CR-01 open-book exemption
    is REMOVED (an open book is now VALUED in the separate MTM channel, so the cash
    channel closes for open books too; F1's widened §5 envelope dissolves). The
    reference row-set is ``_NATIVE_CASH_BEARING_TYPES`` (includes the reclassed
    ``swap``); the USD set (no ``swap``) would false-fire by ``Σ(swap change)``.

    **Channel 2 — book anchor cross-check (fail-loud, when threaded).** The computed
    ``terminal_book[c]`` (replay × marks, §2 Q3) reconciles against the anchor's
    settled book ``anchor_settled_book[c] = native_options_value[c] −
    native_options_session_upl[c]`` (both off the SAME ``get_account_summaries``).
    Tolerance ``max(floor_c, 1e-4·throughput_c)``. On breach →
    ``LedgerValuationError`` (currency + magnitude class). ⚠️ NOT verifiable at a
    flat terminal (both sides 0); first live open-book anchor is the §6 watch — a
    breach there is a loud STOP, never a tolerance loosening.

    **Channel 3 — summary cross-check (:func:`_summary_channel_cross_check`).** The
    summaries keep policing the redistribution (E3 generalized to the MTM series);
    a material breach fails loud.

    Channels 2 and 3 run ONLY when the adapter threads their inputs; a standalone /
    pure caller (``assert_balance_identity(rows, native_daily)``) runs channel 1
    only (SC-4 byte-inert). Leak discipline: raises name only currency + a coarse
    magnitude class, never a held balance."""
    floor = native_floor or {}
    sigma_change: dict[str, float] = {}
    throughput: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        if str(row.get("type", "")) not in _NATIVE_CASH_BEARING_TYPES:
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
    # Channel 1 — strict cash identity for ALL currencies (no exemption).
    currencies = set(sigma_change) | {str(c).upper() for c in native_daily}
    for ccy in sorted(currencies):
        computed = sum(native_daily.get(ccy, {}).values())
        reference = sigma_change.get(ccy, 0.0)
        residual = abs(computed - reference)
        tol = max(float(floor.get(ccy, 0.0)), 1e-4 * throughput.get(ccy, 0.0))
        if residual > tol:
            raise LedgerValuationError(
                f"Deribit balance-identity breach for currency {ccy!r}: computed "
                f"realized total diverges from Σchange over cash-bearing rows by "
                f"more than max($1-equiv, 1e-4·throughput) (residual/tolerance "
                f"class {residual / tol if tol else float('inf'):.1f}x) — a "
                "cash-bearing row was dropped or mis-classified; STOP and "
                "investigate that account's ledger, never loosen the tolerance "
                "(silent P&L misattribution risk)"
            )
    # Channel 2 — book anchor cross-check (settled-book basis; when threaded).
    if terminal_book is not None and anchor_settled_book is not None:
        book_ccys = (
            {str(c).upper() for c in terminal_book}
            | {str(c).upper() for c in anchor_settled_book}
        )
        for ccy in sorted(book_ccys):
            computed_book = float(terminal_book.get(ccy, 0.0))
            anchor_book = float(anchor_settled_book.get(ccy, 0.0))
            residual = abs(computed_book - anchor_book)
            tol = max(float(floor.get(ccy, 0.0)), 1e-4 * throughput.get(ccy, 0.0))
            if residual > tol:
                raise LedgerValuationError(
                    f"Deribit book-channel anchor breach for currency {ccy!r}: the "
                    "computed settled option book (replay × 1D marks) diverges from "
                    "the summaries' settled book (options_value − options_session_upl)"
                    f" by more than max($1-equiv, 1e-4·throughput) (residual/tolerance"
                    f" class {residual / tol if tol else float('inf'):.1f}x) — a "
                    "replay drift or a mark-basis error; STOP and investigate the "
                    "anchor/replay, never loosen the tolerance"
                )
    # Channel 3 — summary cross-check (when the MTM series is threaded).
    if delta_mtm is not None:
        _summary_channel_cross_check(rows, delta_mtm, floor)


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


def txn_rows_to_native_daily(
    rows: Sequence[Mapping[str, Any]],
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
    """
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
        # Phase 83: options_settlement_summary contributes NOTHING to the native
        # daily attribution — the option book's P&L is now REDISTRIBUTED across the
        # days it accrued via the daily-MTM channel (option_mtm_daily, merged by the
        # adapter). The summary stays CLASSIFIED-BUT-INERT here: its `change` is
        # always 0.0 (a nonzero change is semantics drift → fail loud, kept
        # verbatim), then it is skipped. Its realized_pl/unrealized_pl fields are
        # read ONLY by the Q3-3 summary-channel cross-check (assert_balance_identity),
        # where the WR-03 blank-currency + required-field guards now live.
        if row_type in _NATIVE_OPTIONS_SUMMARY_TYPES:
            change = _coerce_float(
                row.get("change", 0.0) or 0.0, field="change", row=row
            )
            if change != 0.0:
                raise LedgerValuationError(
                    f"options_settlement_summary Deribit row id={row.get('id')!r} "
                    "carries a nonzero change — the summary recap change is always "
                    "0.0 (its P&L is in realized_pl/unrealized_pl); a nonzero change "
                    "is semantics drift, classify against fresh evidence before "
                    "ingesting"
                )
            continue
        if row_type in _NATIVE_CASH_BEARING_TYPES:
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
            # Phase 83: option trade/delivery rows contribute their FULL native
            # `change` EVERYWHERE (the Phase-82 coverage-gated −commission reclass is
            # REMOVED). The premium/payout cash is now counted here and its MTM
            # content is redistributed across held days by the daily-MTM channel
            # (option_mtm_daily, merged by the adapter). This makes the cash channel
            # a plain Σchange identity again (the strict cash guard closes by
            # construction, open books included — the CR-01 exemption is removed).
            contribution = change
            if row_type == "delivery":
                cls = classify_instrument(str(row.get("instrument_name", "")))
                if cls == "unknown" and change != 0.0:
                    # A delivery ALWAYS names its expiring instrument; an
                    # unknown-classified delivery with nonzero cash would mis-route
                    # expiry P&L — fail loud, never guess (D-08).
                    raise LedgerValuationError(
                        f"Deribit delivery row id={row.get('id')!r} names an "
                        "unclassifiable instrument yet carries nonzero cash — "
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
