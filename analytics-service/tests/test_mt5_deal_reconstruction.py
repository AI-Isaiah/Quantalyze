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

import numpy as np
import pandas as pd
import pytest

from services.broker_dailies import combine_mt5_deal_ledger
from services.closed_sets import CRYPTO_VENUES
from services.metrics import compute_all_metrics, periods_per_year_for_asset_class
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


# ---------------------------------------------------------------------------
# Task 2 — combine_mt5_deal_ledger (anchor-to-equity, flow-in-numerator)
#
# THE CANONICAL HAND FIXTURE (all arithmetic paper-derived; NEVER regenerated
# from the combiner). Deals fall on 5 UTC days:
#   day1 (06-01): no deals            → the reconstructed initial-capital anchor
#   day2 (06-02): BUY close profit +500, commission −100        → day PnL +400
#   day3 (06-03): no deals                                      → flat (0.0)
#   day4 (06-04): BALANCE +10_000 (deposit) AND SELL profit +300 → PnL +300, flow +10_000
#   day5 (06-05): SELL profit −200                              → day PnL −200
#
# Anchor equity 110_500, balance 110_500 (no open positions ⇒ open_unrealized 0):
#   initial = 110_500 − Σpnl(400+0+300−200=500) − Σflow(10_000) = 100_000
# NAV closes (backward-rolled from the 110_500 anchor):
#   100_000 / 100_400 / 100_400 / 110_700 / 110_500
# Flow-in-numerator returns r_t = (NAV_t − NAV_{t−1} − F_t)/NAV_{t−1}:
#   day2: (100_400 − 100_000 − 0)/100_000      = 400/100_000   = 0.0040
#   day3: flat                                                 = 0.0
#   day4: (110_700 − 100_400 − 10_000)/100_400 = 300/100_400   (deposit is NOT a spike)
#   day5: (110_500 − 110_700 − 0)/110_700      = −200/110_700
# ---------------------------------------------------------------------------


def _epoch(year: int, month: int, day: int, hour: int = 12) -> int:
    """A broker-server-time epoch (seconds) at ``hour`` UTC on the given day. The
    fixtures use server_utc_offset_s=0, so the server clock == UTC and the deal
    buckets to its own calendar day."""
    return int(datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp())


def _canonical_deposit_deals() -> list[dict]:
    return [
        # day2 — BUY close: profit +500, commission −100 → cash effect +400
        {"type": 0, "entry": 1, "profit": 500.0, "swap": 0.0,
         "commission": -100.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        # day4 — BALANCE deposit +10_000 (external flow, never a return)
        {"type": 2, "profit": 10_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        # day4 — SELL close: profit +300 → cash effect +300
        {"type": 1, "entry": 1, "profit": 300.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 4)},
        # day5 — SELL close: profit −200 → cash effect −200
        {"type": 1, "entry": 1, "profit": -200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 5)},
    ]


def test_deposit_day_is_not_a_return_spike() -> None:
    """The load-bearing money oracle: a +10_000 deposit landing the SAME UTC day
    as +300 of trading PnL books the trading return 300/100_400, NEVER the
    (110_700−100_400)/100_400 ≈ +10.26% cash spike."""
    returns, _meta = combine_mt5_deal_ledger(
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0
    )
    vals = returns.to_numpy()
    assert len(returns) == 4  # day2..day5 dense (day3 gap-filled)
    assert vals[0] == pytest.approx(400 / 100_000, abs=1e-12)   # 0.0040
    assert vals[1] == pytest.approx(0.0, abs=1e-12)             # flat day
    assert vals[2] == pytest.approx(300 / 100_400, abs=1e-12)   # deposit-day REAL return
    assert vals[3] == pytest.approx(-200 / 110_700, abs=1e-12)
    # The spike the flow-in-numerator identity defeats:
    spike = (110_700 - 100_400) / 100_400  # ≈ +0.1026
    assert vals[2] != pytest.approx(spike, abs=1e-6)


def test_withdrawal_day_neither_depresses_nor_inflates() -> None:
    """A −5_000 withdrawal on the same day as +300 PnL still books 300/100_400 —
    the outflow sits in the numerator, so it neither depresses nor inflates.

    Hand arithmetic (anchor equity 95_500, no open positions):
      initial = 95_500 − Σpnl(500) − Σflow(−5_000) = 95_500 − 500 + 5_000 = 100_000
      NAV: 100_000 / 100_400 / 100_400 / 95_700 / 95_500
      day4: (95_700 − 100_400 − (−5_000))/100_400 = 300/100_400
      day5: (95_500 − 95_700)/95_700              = −200/95_700
    """
    deals = _canonical_deposit_deals()
    deals[1] = {**deals[1], "profit": -5_000.0}  # BALANCE withdrawal on day4
    returns, _meta = combine_mt5_deal_ledger(
        deals, account_equity=95_500.0, account_balance=95_500.0
    )
    vals = returns.to_numpy()
    assert vals[0] == pytest.approx(400 / 100_000, abs=1e-12)
    assert vals[2] == pytest.approx(300 / 100_400, abs=1e-12)   # withdrawal not a dip
    assert vals[3] == pytest.approx(-200 / 95_700, abs=1e-12)


def test_zero_cash_rotation_flow_is_zero() -> None:
    """No BALANCE deals ⇒ external flow F = 0 on every day; returns equal the pure
    hand PnL literals.

    Hand arithmetic (drop the deposit; anchor equity = initial + Σpnl = 100_000 +
    500 = 100_500, no open positions):
      NAV: 100_000 / 100_400 / 100_400 / 100_700 / 100_500
      day2: 400/100_000 = 0.0040
      day4: 300/100_400
      day5: −200/100_700
    """
    deals = [d for d in _canonical_deposit_deals() if d["type"] != 2]
    returns, _meta = combine_mt5_deal_ledger(
        deals, account_equity=100_500.0, account_balance=100_500.0
    )
    vals = returns.to_numpy()
    assert len(returns) == 4
    assert vals[0] == pytest.approx(400 / 100_000, abs=1e-12)
    assert vals[1] == pytest.approx(0.0, abs=1e-12)
    assert vals[2] == pytest.approx(300 / 100_400, abs=1e-12)
    assert vals[3] == pytest.approx(-200 / 100_700, abs=1e-12)


def test_no_activity_day_is_flat_ledger_complete() -> None:
    """MT5 is a ledger-COMPLETE venue: a no-deal interior day is genuinely flat
    (0.0), not an unknown gap (contrast sFOX's sampled NAV). Day3 carries no
    deals and must read exactly 0.0."""
    returns, _meta = combine_mt5_deal_ledger(
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0
    )
    # Day3 = 2025-06-03 (the interior no-activity day).
    day3 = pd.Timestamp("2025-06-03")
    assert returns.loc[day3] == pytest.approx(0.0, abs=1e-12)


def test_unknown_deal_type_kills_the_whole_combine() -> None:
    """A single unclassifiable deal (CORRECTION=5) inside an otherwise-valid
    ledger raises BEFORE any series is produced — nothing partial is returned."""
    deals = _canonical_deposit_deals()
    deals.append(
        {"type": 5, "profit": 1.23, "swap": 0.0, "commission": 0.0,
         "fee": 0.0, "time": _epoch(2025, 6, 5)}
    )
    with pytest.raises(Mt5DealClassificationError):
        combine_mt5_deal_ledger(deals, account_equity=110_500.0, account_balance=110_500.0)


def test_combiner_returns_sibling_shape() -> None:
    """The combiner returns the byte-identical sibling shape: a float Series on an
    ascending daily DatetimeIndex (unit [us]) + a plain dict meta."""
    returns, meta = combine_mt5_deal_ledger(
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0
    )
    assert isinstance(returns, pd.Series)
    assert str(returns.dtype) == "float64"
    assert returns.index.is_monotonic_increasing
    assert returns.index.dtype == "datetime64[us]"
    assert isinstance(meta, dict)


# ---------------------------------------------------------------------------
# Task 3 — √252-not-√365 mutation guard + Python crypto-registry guard +
#          quantstats price-detection guard
# ---------------------------------------------------------------------------

# The canonical fixture's HAND return values (Task 2), written as literals — the
# oracle NEVER regenerated from the combiner or from compute_all_metrics.
_CANONICAL_RETURNS = [0.0040, 0.0, 300 / 100_400, -200 / 110_700]

# sqrt(252) and sqrt(365) — the verified constants (test_mt5_golden_fixtures T1
# uses sqrt(252) = 15.8745078663877). MT5 is a TRADITIONAL asset class, so risk
# annualizes on the √252 (weekday) clock, NOT the √365 crypto clock.
_SQRT_252 = math.sqrt(252)  # 15.874507866387544
_SQRT_365 = math.sqrt(365)  # 19.10497317454280


def test_annualizes_252_not_365() -> None:
    """MUTATION GUARD. The reconstructed MT5 series annualizes volatility on √252.
    If the engine ever resolves MT5 onto the crypto √365 clock, the SUT volatility
    becomes std×√365 = std×√252 × √(365/252) — a DIFFERENT number — and the
    ``== expected_vol_252`` assert below turns RED (the Sharpe/vol jump is the
    mutation kill).

    Volatility literal, hand-derived from the fixture returns via an INDEPENDENT
    sample-std (numpy ddof=1) — independent of both the combiner AND quantstats:
        r = [0.0040, 0.0, 0.00298804780876..., -0.00180668473351...]
        n = 4;  mean = Σr / 4;  sample var = Σ(r−mean)² / (n−1)
        expected_vol_252 = sqrt(sample var) × sqrt(252)
        expected_vol_365 = sqrt(sample var) × sqrt(365)   (the crypto-clock value)
    """
    sample_std = float(np.std(np.array(_CANONICAL_RETURNS), ddof=1))
    expected_vol_252 = sample_std * _SQRT_252
    expected_vol_365 = sample_std * _SQRT_365

    # MT5 = traditional → 252 (the guard against the unknown→crypto √365 trap).
    periods = periods_per_year_for_asset_class("traditional")
    assert periods == 252

    series = pd.Series(
        _CANONICAL_RETURNS,
        index=pd.date_range("2025-06-02", periods=4, freq="D").as_unit("us"),
        name="returns",
    )
    result = compute_all_metrics(series, periods_per_year=periods)

    # (1) the SUT rides the √252 clock — the load-bearing assert a clock-flip reddens.
    assert result["volatility"] == pytest.approx(expected_vol_252, rel=1e-9)
    # (2) the √365 clock is a DEMONSTRABLY DIFFERENT literal (documents the kill).
    assert expected_vol_252 != pytest.approx(expected_vol_365, rel=1e-9)
    assert expected_vol_365 == pytest.approx(
        expected_vol_252 * math.sqrt(365 / 252), rel=1e-12
    )


def test_mt5_not_in_python_crypto_registry() -> None:
    """'mt5' must stay OUT of the single-sourced Python √365 registry
    (``services.closed_sets.CRYPTO_VENUES``, the MD-01 source). This guards the
    DEFERRED unknown→crypto latent-bug class: a future 'add mt5 to CRYPTO_VENUES'
    regression reddens HERE before it can silently annualize MT5 on √365."""
    assert "mt5" not in CRYPTO_VENUES


def test_returns_series_unambiguous_for_quantstats() -> None:
    """Pitfall 4 / the DEFERRED quantstats Sharpe sign-flip bug: quantstats 0.0.81
    ``_prepare_returns`` mis-reads an all-non-negative series with a >100% day as
    PRICES. The reconstructed MT5 series must carry at least one strictly negative
    value and no value > 1.0 so the price-vs-returns heuristic can never flip."""
    returns, _meta = combine_mt5_deal_ledger(
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0
    )
    vals = returns.to_numpy()
    assert (vals < 0).any()      # at least one strictly negative day
    assert (vals <= 1.0).all()   # no > 100% day → cannot be mistaken for prices
