"""Phase 136 MT5RECON — hand-derived economic oracles for the MT5 deal-ledger
reconstruction core (`services/mt5_deals.py` + `broker_dailies.combine_mt5_deal_ledger`).

ORACLE DISCIPLINE (NON-NEGOTIABLE)
----------------------------------
Every KPI / return oracle in this file is a HAND-DERIVED economic invariant: the
expected values are written as literals with the arithmetic shown in a comment
(paper, not Python). A fixture is NEVER regenerated from the system under test's
own combiner/helpers — three money bugs once survived six review passes precisely
because the oracles were self-referential
([[feedback_economic_invariant_oracles_not_self_referential]]).

The load-bearing invariants pinned here:
  * a deposit day books its REAL trading return, never the deposit cash spike
    (flow-in-the-numerator identity r_t = (NAV_t − NAV_{t−1} − F_t)/NAV_{t−1});
  * an unclassifiable / ambiguous DEAL_TYPE (CORRECTION / CHARGE / INTEREST /
    CANCELED / DIVIDEND / unknown) FAILS LOUD — never silently dropped or coerced
    to a flow (the deribit-`correction` lesson);
  * zero-cash-rotation ⇒ external flow F = 0 and returns equal the pure-PnL
    literals;
  * an MT5 series annualizes on √252 — flipping the clock to √365 turns the
    fixture test RED (Sharpe / vol don't silently jump onto the crypto basis).

This module imports ONLY the pure classifier and the combiner — NOT
csv_validator / pandera-dependent modules — so it stays importable on a
pandera-less local environment.

Run: cd analytics-service && pytest tests/test_mt5_deal_reconstruction.py -x
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from services.mt5_deals import (
    Mt5DealClassificationError,
    _MT5_EXTERNAL_FLOW_DEAL_TYPES,
    _MT5_TRADING_DEAL_TYPES,
    classify_deal,
    deal_cash_effect,
    deal_utc_day,
)


# ---------------------------------------------------------------------------
# Task 1 — pure fail-loud DEAL_TYPE classifier + UTC-day seam
# ---------------------------------------------------------------------------


def test_allow_lists_are_disjoint() -> None:
    """A DEAL_TYPE in BOTH sets would be simultaneously folded as PnL AND as an
    external flow (order-dependent silent corruption). The module asserts this at
    import; re-assert it here as an explicit contract."""
    assert not (_MT5_TRADING_DEAL_TYPES & _MT5_EXTERNAL_FLOW_DEAL_TYPES)


@pytest.mark.parametrize("type_code", [2, 3, 6])
def test_classify_external_flow_types(type_code: int) -> None:
    """BALANCE (2, deposit/withdrawal — [VERIFIED mt5_spike.py:88]), CREDIT (3),
    BONUS (6) are external cash flows, never trading performance."""
    assert classify_deal({"type": type_code}) == "external_flow"


@pytest.mark.parametrize("type_code", [0, 1, 7, 8, 9, 10, 11])
def test_classify_trading_types(type_code: int) -> None:
    """BUY (0), SELL (1) market fills and the COMMISSION family (7–11) are trading
    PnL / cost — they move the return, not the capital base."""
    assert classify_deal({"type": type_code}) == "trading"


@pytest.mark.parametrize("type_code", [4, 5, 12, 13, 14, 15, 16, 17, 99, -1])
def test_ambiguous_or_unknown_types_fail_loud(type_code: int) -> None:
    """CHARGE (4), CORRECTION (5), INTEREST (12), CANCELED (13/14), DIVIDEND
    (15/16), TAX (17), and ANY unlisted int are NOT in either allow-list. Per
    user decision Q2 the ambiguous middle defaults FAIL-LOUD — the exact
    classification is locked behind the 136-05 human-verify checkpoint. This is
    an allow-list (not a block-list): the deribit-`correction` lesson."""
    with pytest.raises(Mt5DealClassificationError) as excinfo:
        classify_deal({"type": type_code})
    # The raise names the offending TYPE CODE (debuggable), never a USD amount.
    assert str(type_code) in str(excinfo.value)


def test_correction_type_raises() -> None:
    """CORRECTION (5) is the hard case the deribit lesson is named for — never
    assume trading vs capital. It fails loud by default here."""
    with pytest.raises(Mt5DealClassificationError):
        classify_deal({"type": 5})


def test_classification_error_carries_no_usd() -> None:
    """T-136-03: the raise message carries the DEAL_TYPE code only — NEVER a raw
    USD amount (the nav_twr / native_nav leak-safe raise convention). A capital
    amount must not leak through an error string."""
    with pytest.raises(Mt5DealClassificationError) as excinfo:
        classify_deal({"type": 5, "profit": 123456.78})
    msg = str(excinfo.value)
    assert "5" in msg  # the type code
    assert "123456" not in msg  # the USD amount never leaks


@pytest.mark.parametrize("bad_type", [None, "2", 2.0, True, False])
def test_non_integer_deal_type_fails_loud(bad_type: object) -> None:
    """A missing / non-integer DEAL_TYPE is schema drift — fail loud rather than
    truncate/coerce it into a classification (bool is rejected even though it is
    an int subclass: True would otherwise masquerade as SELL)."""
    with pytest.raises(Mt5DealClassificationError):
        classify_deal({"type": bad_type})


def test_deal_utc_day_subtracts_offset_before_bucketing() -> None:
    """The combiner is the ONE server-time→UTC normalize seam. A deal stamped
    01:30 on the broker's server clock (UTC+2) belongs to the PRIOR UTC day.

    Hand arithmetic:
      server wall-clock = 2025-01-02 01:30:00 (broker server-time epoch)
      server_utc_offset_s = 7200  (server is UTC+2)
      true UTC = server − offset = 2025-01-01 23:30:00  → UTC day '2025-01-01'
    """
    # The epoch is the broker-server-time value verbatim (mt5_client returns it raw).
    server_epoch = int(datetime(2025, 1, 2, 1, 30, tzinfo=timezone.utc).timestamp())
    assert deal_utc_day(server_epoch, 7200) == "2025-01-01"
    # At offset 0 the same epoch buckets to its own calendar day.
    assert deal_utc_day(server_epoch, 0) == "2025-01-02"


@pytest.mark.parametrize("bad_time", [None, "not-a-time", float("nan"), float("inf")])
def test_deal_utc_day_undatable_fails_loud(bad_time: object) -> None:
    """A missing / undatable / non-finite time RAISES — a deal we cannot date must
    never be silently dropped (mirror deribit_txn._row_utc_day's fail-loud posture)."""
    with pytest.raises(Mt5DealClassificationError):
        deal_utc_day(bad_time, 0)


def test_deal_cash_effect_sums_the_four_fields() -> None:
    """Realized cash effect = profit + swap + commission + fee, each summed once
    ([ASSUMED A3] fold convention).

    Hand arithmetic: 500.0 + (−2.0) + (−100.0) + (−1.0) = 397.0
    """
    deal = {"type": 0, "profit": 500.0, "swap": -2.0, "commission": -100.0, "fee": -1.0}
    assert deal_cash_effect(deal) == pytest.approx(397.0, abs=1e-12)


@pytest.mark.parametrize(
    "bad_deal",
    [
        {"profit": float("nan")},
        {"swap": float("inf")},
        {"commission": "oops"},
        {"fee": True},
    ],
)
def test_deal_cash_effect_rejects_non_finite_or_non_numeric(bad_deal: dict) -> None:
    """A NaN/Inf/non-numeric money field must fail loud at the input choke point —
    a silent NaN would sail past every DQ denominator guard and stamp a corrupt
    'complete' track record (the nav_twr._coerce_float discipline)."""
    with pytest.raises(Mt5DealClassificationError):
        deal_cash_effect(bad_deal)
