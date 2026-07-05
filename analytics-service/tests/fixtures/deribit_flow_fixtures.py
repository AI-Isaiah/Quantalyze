"""LTP068-shaped synthetic Deribit txn-log fixtures for Phase 75 flow scenarios.

Shared Wave-0 scaffold: the FIVE external-flow scenarios that every downstream
Phase-75 valuation/acceptance wave (75-02 dated flows, 75-03 F1 deletion, the
integration/acceptance waves) imports. The rows are LTP068-shaped — an INVERSE
(coin-margined, BTC) subaccount with material withdrawals, the exact account
whose anchor-to-today magnitude blew up (+458% cum / 229,214% CAGR in the P72
canary). They are SYNTHETIC: no real LTP068 txn-log rows exist in the repo
(75-RESEARCH.md A2/A3), so each row is hand-built from the Deribit txn-log
schema (``services/deribit_txn.py``): a Mapping with ``type`` / ``currency`` /
``change`` / ``timestamp`` (epoch-MS), plus ``index_price`` / ``instrument_name``
ONLY where a real row would carry them (a settlement carries an event-time index;
a deposit/withdrawal structurally carries NEITHER — 75-RESEARCH.md Q3).

These are IN-PROCESS stubs, NOT vcrpy cassettes — Deribit's test infra uses
in-process synthetic rows (75-RESEARCH.md Q6). Builders are PURE (no I/O) and
parametrizable (amount / day) so a wave can re-shape magnitude while keeping the
scenario's structural identity.

The FIVE scenarios (75-VALIDATION.md "Wave 0"):

  1. ``linear_flow_day_rows``            — USDC deposit on a trading day; USD
     passthrough, no index needed.
  2. ``inverse_flow_day_with_index_rows``— BTC withdrawal on a day that ALSO
     carries an index-bearing BTC settlement row → an OWN same-day index exists.
  3. ``inverse_flow_day_without_index_rows`` — BTC withdrawal on a QUIET day
     (no trade, no index-bearing row) → the Finding-C1 / fail-loud scenario.
  4. ``dominating_withdrawal_rows``      — a BTC withdrawal whose valued USD
     dwarfs prior-day NAV → the SC4 ``flow_dominated_guard`` case (NaN + warning,
     NOT ``r_t == 0``).
  5. ``pure_flow_no_trade_rows``         — a material-but-sub-NAV BTC withdrawal
     on a day with ZERO return-bearing rows → the SC4 ``r_t == 0`` case.

Known same-day settlement-index constants are exported for the valuation waves'
EVENT-TIME proof: substituting a different-day index (or 1.0 / a current price)
must change the valued USD and redden the mutation-honest tests. The indices
differ per day ON PURPOSE so a cross-time substitution is detectable.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

# --- Known same-day BTC settlement indices (USD per BTC), per UTC day. --------
# Distinct per day so a cross-time (different-day) index substitution changes the
# valued USD → the 75-02 event-time proof reddens. Scenario 3's day has NO index
# by design (the fail-loud case). Scenario 5's index is supplied by the C1 fetch
# in the valuation wave (the day carries no own index-bearing row).
BTC_INDEX_2026_03_14: float = 42000.0  # scenario 2 (inverse flow WITH own index)
BTC_INDEX_2026_03_16: float = 45000.0  # scenario 4 (dominating withdrawal)
BTC_INDEX_2026_03_17: float = 41000.0  # scenario 5 (pure-flow, index via C1 fetch)

# Reference prior-day NAV (USD) the valuation waves reconstruct against: scenario
# 4's valued withdrawal (>= this) DOMINATES it (guard fires); scenarios 2 and 5
# are strictly UNDER it (no guard — a normal / flow-neutral day).
REFERENCE_PRIOR_NAV_USD: float = 50000.0

# --- Per-scenario UTC days. ---------------------------------------------------
DAY_LINEAR: str = "2026-03-13"
DAY_INVERSE_WITH_INDEX: str = "2026-03-14"
DAY_INVERSE_NO_INDEX: str = "2026-03-15"
DAY_DOMINATING: str = "2026-03-16"
DAY_PURE_FLOW: str = "2026-03-17"


def _ms(day_iso: str, *, hour: int = 12) -> int:
    """Epoch-MS for midday UTC on ``day_iso`` ('YYYY-MM-DD').

    Midday keeps the timestamp unambiguously inside its UTC calendar day (no
    midnight-drift ambiguity), matching how the Deribit txn-log carries
    epoch-milliseconds.
    """
    dt = datetime.fromisoformat(f"{day_iso}T{hour:02d}:00:00+00:00").astimezone(
        timezone.utc
    )
    return int(dt.timestamp() * 1000)


def linear_flow_day_rows(
    *, deposit_usdc: float = 50000.0, day: str = DAY_LINEAR
) -> list[dict[str, Any]]:
    """Scenario 1 — a USDC (linear / USD-family) deposit on a trading day.

    The deposit ``change`` is already USD and passes through ``txn_change_to_usd``
    with NO index multiplication. A small linear USDC trade-fee row makes the day
    a genuine trading day (return-bearing) so downstream tests exercise a flow
    landing on the same UTC day as realized pnl.
    """
    return [
        {
            "type": "deposit",
            "currency": "USDC",
            "change": deposit_usdc,  # positive: capital IN
            "timestamp": _ms(day, hour=9),
            "id": 75_1_001,
        },
        {
            "type": "trade",
            "instrument_name": "BTC_USDC-PERPETUAL",
            "currency": "USDC",
            "change": -5.0,  # a linear trading fee (already USD)
            "timestamp": _ms(day, hour=14),
            "id": 75_1_002,
        },
    ]


def inverse_flow_day_with_index_rows(
    *,
    withdrawal_btc: float = -0.5,
    day: str = DAY_INVERSE_WITH_INDEX,
    index_price: float = BTC_INDEX_2026_03_14,
) -> list[dict[str, Any]]:
    """Scenario 2 — a BTC (inverse) withdrawal on a day that ALSO carries an
    index-bearing BTC settlement row, so an OWN same-day index exists.

    The withdrawal itself carries NO ``instrument_name`` and NO ``index_price``
    (structural — a deposit/withdrawal has no traded instrument). The paired
    zero-cash settlement row SEEDS the same-day BTC index (``index_price``) so the
    withdrawal values at ``withdrawal_btc * index_price`` via the day's own index
    — no external fetch needed. Valued USD (defaults): -0.5 * 42000 = -21000.
    """
    return [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": 0.0,  # zero cash — seeds the OWN same-day index, adds no USD
            "index_price": index_price,
            "timestamp": _ms(day, hour=8),
            "id": 75_2_001,
        },
        {
            "type": "withdrawal",
            "currency": "BTC",
            "change": withdrawal_btc,  # negative: capital OUT, in COIN units
            "timestamp": _ms(day, hour=15),
            "id": 75_2_002,
        },
    ]


def inverse_flow_day_without_index_rows(
    *, withdrawal_btc: float = -0.5, day: str = DAY_INVERSE_NO_INDEX
) -> list[dict[str, Any]]:
    """Scenario 3 — a BTC (inverse) withdrawal on a QUIET day: no trade, no
    index-bearing row, so NO own same-day index exists.

    This is the Finding-C1 / fail-loud scenario. Until the settlement-index-fetch
    planner (``inverse_days_needing_index``) is extended (75-02) to cover inverse
    ``_EXTERNAL_FLOW_TYPES`` rows, this withdrawal is invisible to the crawl and
    ``txn_change_to_usd`` raises ``LedgerValuationError`` (never valued at 1.0 /
    a current price / dropped). The row carries neither ``instrument_name`` nor
    ``index_price``.
    """
    return [
        {
            "type": "withdrawal",
            "currency": "BTC",
            "change": withdrawal_btc,  # negative: capital OUT, in COIN units
            "timestamp": _ms(day, hour=11),
            "id": 75_3_001,
        },
    ]


def dominating_withdrawal_rows(
    *,
    withdrawal_btc: float = -2.0,
    day: str = DAY_DOMINATING,
    index_price: float = BTC_INDEX_2026_03_16,
) -> list[dict[str, Any]]:
    """Scenario 4 — a BTC withdrawal whose valued USD DOMINATES prior-day NAV.

    Valued USD (defaults): -2.0 * 45000 = -90000, i.e. |F| >= the reference
    ~50000 prior NAV → the core's ``flow_dominated_guard`` breaks the chain-link
    (day is NaN + ``complete_with_warnings``), NOT ``r_t == 0``. A zero-cash
    settlement row seeds the same-day index so the withdrawal is VALUED (the guard
    is about magnitude, not a valuation failure).
    """
    return [
        {
            "type": "settlement",
            "instrument_name": "BTC-PERPETUAL",
            "currency": "BTC",
            "change": 0.0,  # zero cash — seeds the OWN same-day index
            "index_price": index_price,
            "timestamp": _ms(day, hour=7),
            "id": 75_4_001,
        },
        {
            "type": "withdrawal",
            "currency": "BTC",
            "change": withdrawal_btc,  # negative, dominating magnitude
            "timestamp": _ms(day, hour=16),
            "id": 75_4_002,
        },
    ]


def pure_flow_no_trade_rows(
    *, withdrawal_btc: float = -0.1, day: str = DAY_PURE_FLOW
) -> list[dict[str, Any]]:
    """Scenario 5 — a material-but-sub-NAV BTC withdrawal on a day with ZERO
    return-bearing rows (a pure-flow, no-trade day).

    Valued USD (defaults): -0.1 * 41000 = -4100, strictly UNDER the reference
    ~50000 prior NAV. With no pnl, backward reconstruction gives
    ``NAV_t - NAV_{t-1} == F_t`` so ``r_t == (NAV_t - NAV_{t-1} - F_t)/NAV_{t-1}
    == 0`` (the flow-neutral TWR property). The day carries NO own index-bearing
    row (a no-trade day); the valuation wave supplies ``BTC_INDEX_2026_03_17`` as
    the same-day index the extended C1 fetch resolves.
    """
    return [
        {
            "type": "withdrawal",
            "currency": "BTC",
            "change": withdrawal_btc,  # negative, sub-NAV magnitude
            "timestamp": _ms(day, hour=13),
            "id": 75_5_001,
        },
    ]
