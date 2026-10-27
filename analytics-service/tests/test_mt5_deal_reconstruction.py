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
import random
from datetime import date, datetime, timedelta, timezone
from fractions import Fraction

import numpy as np
import pandas as pd
import pytest

from services.account_unit import USD_FLOORS, classify_account_currency
from services.allocator_equity_derive import _SELF_CHECK_ABS, _SELF_CHECK_REL
from services.broker_dailies import (
    combine_mt5_deal_ledger,
    mt5_day_pnl,
    reconstruct_mt5_nav_levels,
)
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
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
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
        deals, account_equity=95_500.0, account_balance=95_500.0, server_utc_offset_s=0
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
        deals, account_equity=100_500.0, account_balance=100_500.0, server_utc_offset_s=0
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
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
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
        combine_mt5_deal_ledger(deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0)


def test_combiner_returns_sibling_shape() -> None:
    """The combiner returns the byte-identical sibling shape: a float Series on an
    ascending daily DatetimeIndex (unit [us]) + a plain dict meta."""
    returns, meta = combine_mt5_deal_ledger(
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
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
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
    )
    vals = returns.to_numpy()
    assert (vals < 0).any()      # at least one strictly negative day
    assert (vals <= 1.0).all()   # no > 100% day → cannot be mistaken for prices


# ---------------------------------------------------------------------------
# Task 4 (CR-01 regression) — a REAL sub-$1000 equity anchor is HONORED, never
# swapped for a fabricated ≥$10k heuristic-capital base.
#
# Before the fix, combine_mt5_deal_ledger delegated to the CSV-oriented
# trades_to_daily_returns_with_status, whose dust gate DISCARDS any anchor
# <= $1000 and substitutes heuristic_base = max(mean_abs_pnl*100, |Σpnl|, 10_000).
# For an MT5 account with equity in (100, 1000] this (a) rescaled the returns
# 5–10×, (b) inflated the reconstructed prev_nav above the DUST_NAV_FLOOR (then $1000, $100
# since 167.1.2 D-27; the sub-$100 oracle below keeps the dust branch alive) so
# the DQ-01 dust guard never fired and the account slipped past the material-equity
# floor, and (c) published the wrong series stamped api_verified. MT5 ALWAYS has an
# authoritative account_info().equity read, so the heuristic base must never be
# reachable. These oracles pin the two honest outcomes: a small account whose prior
# reconstructed NAV is still above the dust floor reconstructs CORRECTLY off the
# real anchor; a genuinely-dust account fails the DQ-01 dust guard honestly (<2
# usable days → the job-worker material-equity floor rejects it) — never a silent
# rescale off a fabricated base.
# ---------------------------------------------------------------------------


def test_sub_1000_equity_reconstructs_off_real_anchor_not_fabricated_base() -> None:
    """CR-01. Equity $900 (sub-$1000) after two losing days. The reconstruction
    MUST anchor to the REAL $900 equity, not a fabricated ≥$10k base.

    Hand arithmetic (equity 900, balance 900 ⇒ open_unrealized 0; two trading days
    on consecutive UTC days, no flows):
      day1 (06-02): SELL profit −600 → day PnL −600
      day2 (06-03): SELL profit −500 → day PnL −500
      Σpnl = −1100
      terminal NAV = anchor equity = 900
      backward roll (NAV_{t−1} = NAV_t − pnl_t):
        NAV(06-03) = 900
        NAV(06-02) = 900 − (−500) = 1_400
        base (pre-history) = 1_400 − (−600) = 2_000
      flow-in-numerator returns r_t = (NAV_t − NAV_{t−1})/NAV_{t−1}:
        day1: (1_400 − 2_000)/2_000 = −600/2_000 = −0.30
        day2: (900 − 1_400)/1_400   = −500/1_400 = −0.3571428571428571…
      Both prior NAVs (2_000, 1_400) are ABOVE the $100 dust floor (D-27), so both days
      are interpretable — NO dust guard, 2 usable days.

    The FABRICATED-base series the buggy code produced (heuristic_base =
    max(550*100, 1100, 10_000) = 55_000, anchor 53_900) would instead be
    ≈ −600/55_000 = −0.0109 and ≈ −500/54_400 = −0.0092 — a ~27× rescale — with
    used_heuristic_capital=True. This test reddens against that.
    """
    deals = [
        {"type": 1, "entry": 1, "profit": -600.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 1, "entry": 1, "profit": -500.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 3)},
    ]
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=900.0, account_balance=900.0, server_utc_offset_s=0
    )
    vals = returns.to_numpy()
    assert len(returns) == 2                                    # 06-02, 06-03 dense
    assert vals[0] == pytest.approx(-600 / 2_000, abs=1e-12)    # −0.30, REAL base
    assert vals[1] == pytest.approx(-500 / 1_400, abs=1e-12)    # off real prior NAV
    # The honest core reconstructs from the real anchor: NO heuristic base, NO dust
    # guard (both prior NAVs are above the $100 floor, D-27), 2 usable days.
    assert not meta.get("used_heuristic_capital")
    assert not meta.get("dust_nav_guard")
    assert int(returns.notna().sum()) == 2
    # The fabricated-base rescale the fix defeats (≈ −0.0109 off a $55k base):
    assert vals[0] != pytest.approx(-600 / 55_000, abs=1e-6)


def test_genuinely_dust_equity_fails_dust_guard_not_rescaled() -> None:
    """CR-01 (the other honest outcome). Equity $50 whose entire reconstructed NAV
    path stays below the $100 dust floor. (167.1.2 D-27 moved the USD floor from $1000 to
    $100: the oracle was a $500 account with profits +40/-20, re-aimed ten times smaller so
    it still exercises the dust branch.) The honest core dust-guards EVERY day
    (NaN) → <2 usable days → the job-worker material-equity floor rejects the
    account PERMANENT. It is NEVER silently rescaled off a fabricated ≥$10k base.

    Hand arithmetic (equity 50, balance 50 ⇒ open_unrealized 0; consecutive UTC
    days, no flows):
      day1 (06-02): BUY profit +4  → day PnL +4
      day2 (06-03): SELL profit −2 → day PnL −2
      Σpnl = +2
      terminal NAV = 50
      backward roll:
        NAV(06-03) = 50
        NAV(06-02) = 50 − (−2) = 52
        base       = 52 − 4    = 48
      prior NAVs are {48 (day1), 52 (day2)} — BOTH 0 < prev < $100 ⇒
      dust_nav_guard fires on both days ⇒ both returns NaN ⇒ 0 usable days.

    The buggy heuristic path (base max(3*100, 2, 10_000)=10_000, anchor 10_002)
    instead emitted +4/10_000=+0.0004 and ≈ −2/10_004 with NO dust guard and 2
    usable days — an empty-but-green track record fabricated off $10k. This test
    reddens against that.
    """
    deals = [
        {"type": 0, "entry": 1, "profit": 4.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 1, "entry": 1, "profit": -2.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 3)},
    ]
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=50.0, account_balance=50.0, server_utc_offset_s=0
    )
    # Honest DQ-01 dust rejection, NOT a fabricated base:
    assert not meta.get("used_heuristic_capital")
    assert meta.get("dust_nav_guard") is True
    assert int(returns.notna().sum()) < 2   # <2 usable ⇒ material-equity floor rejects
    assert meta.get("computation_status_hint") == "complete_with_warnings"


# ---------------------------------------------------------------------------
# WR-01 regression — the external-flow money fold must fail loud on a bool,
# identically to the trading channel (deal_cash_effect → _coerce_money).
# ---------------------------------------------------------------------------


def test_flow_channel_rejects_bool_profit_like_trading_channel() -> None:
    """WR-01. A BALANCE/CREDIT/BONUS deal whose ``profit`` arrived as a bool is
    schema drift. The trading fold already rejects bool (via mt5_deals._coerce_money
    inside deal_cash_effect); the flow fold must reject it identically instead of
    silently coercing float(True)==1.0 into a $1 capital flow. A bool ``profit`` on
    the day-4 BALANCE deposit therefore fails the WHOLE combine loud (nothing
    partial), never a silent $1 flow.

    Before the fix the flow fold used nav_twr._coerce_float, which accepts bool
    (float(True) is finite) → the combine returned a corrupted-but-'complete'
    series with no raise. This test reddens against that."""
    deals = _canonical_deposit_deals()
    # Turn the day-4 BALANCE deposit's profit into a bool (schema drift).
    deals[1] = {**deals[1], "profit": True}
    with pytest.raises(Mt5DealClassificationError):
        combine_mt5_deal_ledger(
            deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
        )


# ---------------------------------------------------------------------------
# Phase 164.5.4 A-01 — reconstruct_mt5_nav_levels: the NAV-LEVELS sibling
#
# WHY THESE EXIST. ``combine_mt5_deal_ledger`` emits a RETURN series;
# ``allocator_equity_snapshots.value_usd`` is a LEVELS column. The backfill job needs
# dollar balances, and writing daily percentage changes into a dollar-balance field is a
# silent money bug with no exception and no red test. These oracles pin the LEVELS.
#
# ORACLE DISCIPLINE, unchanged from the top of this file: every expected level below is
# a HAND-DERIVED literal with the paper arithmetic shown, never regenerated from the SUT.
#
# ⚠️ THE LEVEL INDEX IS THE UNION OF PNL DAYS AND FLOW DAYS AND IS SPARSE. For the
# canonical fixture that is 06-02 / 06-04 / 06-05 — day3 (06-03) carries neither a deal
# nor a flow and is therefore ABSENT, where the RETURNS series gap-fills it to 0.0.
#
# The canonical backward roll (NAV_{t−1} = NAV_t − pnl_t − F_t), anchored to the REALIZED
# terminal (equity − open uPnL wedge):
#   pnl  = {06-02: +400, 06-04: +300, 06-05: −200}
#   flow = {06-04: +10_000}
#   06-05 = terminal
#   06-04 = terminal − (−200) − 0        = terminal + 200
#   06-02 = 06-04 − 300 − 10_000         = terminal − 10_100
# ---------------------------------------------------------------------------

# The repo's OWN self-check band, imported BY SYMBOL from
# ``allocator_equity_derive`` (``_SELF_CHECK_ABS`` + ``_SELF_CHECK_REL``) rather than
# restated as literals here, so a future tightening moves this gate with it. A looser
# tolerance would let a real roll bug pass as rounding, which is the whole hazard.
def _assert_band(actual: float, expected: float, what: str) -> None:
    """Assert ``actual`` equals ``expected`` inside the repo's self-check band
    ``_SELF_CHECK_ABS + _SELF_CHECK_REL·|expected|`` — the same band
    ``allocator_equity_derive`` holds its own forward/backward roll to."""
    tol = _SELF_CHECK_ABS + _SELF_CHECK_REL * abs(expected)
    assert abs(actual - expected) <= tol, (
        f"{what}: {actual!r} is outside the self-check band around {expected!r} "
        f"(tolerance {tol!r})"
    )


def test_levels_terminal_anchors_to_the_realized_balance() -> None:
    """THE ANCHOR PIN. The last level is the REALIZED terminal — the account BALANCE —
    never the live equity, because the open-position uPnL wedge is subtracted BEFORE the
    backward roll. Every interior day is therefore realized-basis too, so no
    reconstructed day carries floating uPnL and there is no step discontinuity at the
    anchor day.

    This fixture deliberately carries a NON-ZERO wedge (equity 111_000, balance 110_500 ⇒
    uPnL 500) — with equity == balance the distinction is unobservable and anchoring to
    the wrong one would be absorbed silently. Hand arithmetic:
      terminal = 111_000 − (111_000 − 110_500) = 110_500
      06-04    = 110_500 + 200                 = 110_700
      06-02    = 110_700 − 300 − 10_000        = 100_400
    """
    nav, _meta = reconstruct_mt5_nav_levels(
        _canonical_deposit_deals(),
        account_equity=111_000.0,
        account_balance=110_500.0,
        server_utc_offset_s=0,
    )
    _assert_band(float(nav.iloc[-1]), 110_500.0, "terminal level")
    # ⛔ The wrong anchor: the live equity, uPnL still inside it.
    assert float(nav.iloc[-1]) != pytest.approx(111_000.0, abs=1.0)
    _assert_band(float(nav.loc[pd.Timestamp("2025-06-04")]), 110_700.0, "06-04 level")
    _assert_band(float(nav.loc[pd.Timestamp("2025-06-02")]), 100_400.0, "06-02 level")


def test_levels_and_returns_agree_under_forward_replay() -> None:
    """⭐ THE AGREEMENT PIN — levels and returns describe ONE account, proven rather
    than assumed.

    WHY THIS HAS TEETH: it does NOT compare the roll to itself. It drives the FORWARD
    chain-link identity

        NAV_t = NAV_{t−1} · (1 + r_t) + F_t

    with ``combine_mt5_deal_ledger``'s INDEPENDENTLY-PRODUCED return series, and requires
    the result to land on ``reconstruct_mt5_nav_levels``' levels day by day. The two
    functions are driven through different code paths from the shared fold — one
    chain-links, the other rolls backward — so a roll-vs-identity divergence in EITHER
    reddens this. The flows are hand literals from the fixture, not read back from the
    system under test.

    Hand-derived levels (equity == balance == 110_500 ⇒ terminal 110_500):
      06-02 = 100_400 · 06-04 = 110_700 · 06-05 = 110_500
    """
    deals = _canonical_deposit_deals()
    nav, _nav_meta = reconstruct_mt5_nav_levels(
        deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
    )
    returns, _r_meta = combine_mt5_deal_ledger(
        deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
    )

    # The fixture's external flows, written as hand literals (deposit +, withdrawal −).
    flows_by_day = {pd.Timestamp("2025-06-04"): 10_000.0}

    assert list(nav.index) == [
        pd.Timestamp("2025-06-02"),
        pd.Timestamp("2025-06-04"),
        pd.Timestamp("2025-06-05"),
    ]
    _assert_band(float(nav.iloc[0]), 100_400.0, "06-02 level")

    replayed = float(nav.iloc[0])  # the only value taken from the level series
    for day in nav.index[1:]:
        r_t = float(returns.loc[day])  # the RETURNS combiner's own output
        assert math.isfinite(r_t), f"{day}: the fixture has no guard-broken day"
        replayed = replayed * (1.0 + r_t) + flows_by_day.get(day, 0.0)
        _assert_band(
            replayed, float(nav.loc[day]), f"forward replay disagrees with the level on {day}"
        )

    # And the replay lands on the hand-derived terminal, not merely on itself.
    _assert_band(replayed, 110_500.0, "replayed terminal")


def test_levels_index_is_sparse_and_never_zero_filled() -> None:
    """⛔ ``gap_fill_daily_returns`` must NEVER be applied to a level series: it fills a
    no-activity day with 0.0, which is right for a RETURN and would write a **$0 equity
    day** for a LEVEL.

    Day3 (06-03) carries neither a deal nor a flow. In the RETURNS series it is a
    gap-filled 0.0; in the LEVEL series it must be ABSENT, and no level may be 0.0.
    Making the calendar dense is the persistence layer's concern and is a forward-fill of
    the last known balance, never a zero-fill."""
    deals = _canonical_deposit_deals()
    nav, _meta = reconstruct_mt5_nav_levels(
        deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
    )
    returns, _r_meta = combine_mt5_deal_ledger(
        deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
    )
    day3 = pd.Timestamp("2025-06-03")
    assert day3 in returns.index and returns.loc[day3] == pytest.approx(0.0, abs=1e-12)
    assert day3 not in nav.index, "a no-activity day must not appear in the LEVEL series"
    assert not (nav == 0.0).any(), "a $0 level is a zero-fill, never a real balance"


def test_quiet_day_deposit_is_its_own_level_day() -> None:
    """THE FLOW-UNION PIN. A deposit on a day with NO trading deal is dated outside the
    pnl index. ``_union_flow_days`` must place it there BEFORE the roll (the HIGH-1
    precedent) — otherwise it reaches ``_align_flows`` as an ORPHAN and the whole
    reconstruction refuses. Realized cash is never lost and never silently dropped.

    Fixture: the canonical deals plus a +5_000 BALANCE deposit on 06-03, a day with no
    trading deal. Anchor equity == balance == 115_500 ⇒ terminal 115_500.
      pnl  = {06-02: +400, 06-04: +300, 06-05: −200}   (06-03 unions in at pnl 0)
      flow = {06-03: +5_000, 06-04: +10_000}
      06-05 = 115_500
      06-04 = 115_500 + 200                  = 115_700
      06-03 = 115_700 − 300 − 10_000         = 105_400
      06-02 = 105_400 − 0 − 5_000            = 100_400
    Cross-check on the pre-history capital: 100_400 − 400 − 0 = 100_000, and
    100_000 + Σpnl(500) + Σflow(15_000) = 115_500 ✓
    """
    deals = _canonical_deposit_deals()
    deals.append(
        {"type": 2, "profit": 5_000.0, "swap": 0.0, "commission": 0.0,
         "fee": 0.0, "time": _epoch(2025, 6, 3)}
    )
    nav, _meta = reconstruct_mt5_nav_levels(
        deals, account_equity=115_500.0, account_balance=115_500.0, server_utc_offset_s=0
    )
    day3 = pd.Timestamp("2025-06-03")
    assert day3 in nav.index, (
        "a quiet-day deposit must union into the level index, never be an orphan"
    )
    _assert_band(float(nav.loc[day3]), 105_400.0, "06-03 quiet-day-deposit level")
    _assert_band(float(nav.loc[pd.Timestamp("2025-06-02")]), 100_400.0, "06-02 level")
    _assert_band(float(nav.iloc[-1]), 115_500.0, "terminal level")


def test_empty_ledger_yields_an_empty_level_series_never_a_flat_curve() -> None:
    """A deposit-only account has NO track record. The levels sibling must take the SAME
    early return the returns combiner takes, for the SAME reason: an equity curve
    fabricated out of pure capital flows would assert a track record that does not exist,
    and stamping a completeness verdict on it would be worse still.

    The meta must match the returns combiner's own empty-path meta EXACTLY — including
    the deliberate ABSENCE of ``series_completeness`` (the MT5-12 exemption)."""
    flow_only = [
        {"type": 2, "profit": 50_000.0, "swap": 0.0, "commission": 0.0,
         "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 2, "profit": 10_000.0, "swap": 0.0, "commission": 0.0,
         "fee": 0.0, "time": _epoch(2025, 6, 4)},
    ]
    nav, nav_meta = reconstruct_mt5_nav_levels(
        flow_only, account_equity=60_000.0, account_balance=60_000.0, server_utc_offset_s=0
    )
    _returns, returns_meta = combine_mt5_deal_ledger(
        flow_only, account_equity=60_000.0, account_balance=60_000.0, server_utc_offset_s=0
    )
    assert nav.empty
    assert str(nav.dtype) == "float64"
    assert nav_meta == returns_meta
    assert "series_completeness" not in nav_meta


def test_levels_sibling_fails_loud_on_an_unclassifiable_deal() -> None:
    """The fold is SHARED, so the fail-loud contract is shared too: a single
    unclassifiable deal (CORRECTION=5) raises BEFORE any level series exists. Nothing
    partial, never a silently dropped row (the deribit-``correction`` lesson)."""
    deals = _canonical_deposit_deals()
    deals.append(
        {"type": 5, "profit": 1.23, "swap": 0.0, "commission": 0.0,
         "fee": 0.0, "time": _epoch(2025, 6, 5)}
    )
    with pytest.raises(Mt5DealClassificationError):
        reconstruct_mt5_nav_levels(
            deals, account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
        )


def test_flow_dominated_day_is_measured_and_its_level_is_honest() -> None:
    """164.6.6.2.3 D-05 (moved from "a flow-dominated day has an honest LEVEL but no
    RETURN"): a deposit larger than the prior NAV no longer breaks the day. The RETURN
    is measured and the LEVEL is honest, both from the same PnL-based roll
    (``NAV_{t−1} = NAV_t − pnl_t − F_t``).

    Fixture — a day whose flow is twice the prior NAV (``|F| ≥ NAV_{t−1}``):
      06-01: BUY +400                                     → pnl +400
      06-02: BALANCE +200_000 AND SELL +300                → pnl +300, flow +200_000
      06-03: SELL −200                                     → pnl −200
    Anchor equity == balance == 300_100 ⇒ terminal 300_100.
      06-03 = 300_100
      06-02 = 300_100 + 200                  = 300_300
      06-01 = 300_300 − 300 − 200_000        = 100_000
    On 06-02 the chain-link denominator is NAV(06-01) = 100_000 while F = 200_000. The
    SELL on the flow day has no ``position_id`` (this fixture predates the position
    fields), so when its position opened is unknown: the day has no timing record, the
    flow counts at the end of the day (D-07) and
    ``r = (300_300 − 100_000 − 200_000) / 100_000 = 300 / 100_000 = 0.003``. The retired
    ``flow_dominated_guard`` is absent and the day-level rule is named instead."""
    deals = [
        {"type": 0, "entry": 1, "profit": 400.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 1)},
        {"type": 2, "profit": 200_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 1, "entry": 1, "profit": 300.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 1, "entry": 1, "profit": -200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 3)},
    ]
    nav, nav_meta = reconstruct_mt5_nav_levels(
        deals, account_equity=300_100.0, account_balance=300_100.0, server_utc_offset_s=0
    )
    returns, r_meta = combine_mt5_deal_ledger(
        deals, account_equity=300_100.0, account_balance=300_100.0, server_utc_offset_s=0
    )
    flow_day = pd.Timestamp("2025-06-02")

    # The RETURN is measured: 300 / 100_000 (hand-derived above), not a NaN.
    assert float(returns.loc[flow_day]) == pytest.approx(0.003, abs=1e-12)
    # The LEVEL is present, finite and hand-derived, exactly as before.
    assert flow_day in nav.index
    _assert_band(float(nav.loc[flow_day]), 300_300.0, "flow-day level")
    _assert_band(float(nav.loc[pd.Timestamp("2025-06-01")]), 100_000.0, "06-01 level")
    _assert_band(float(nav.iloc[-1]), 300_100.0, "terminal level")

    # ONE reconstruction, one set of facts: the returns meta and the levels meta agree,
    # and neither carries the retired flag or a warning status.
    for meta in (nav_meta, r_meta):
        assert "flow_dominated_guard" not in meta
        assert meta.get("flow_timing_day_level") is True
        assert meta["computation_status_hint"] == "complete"
        assert meta["series_completeness"] == "ledger_complete"


def test_guard_broken_day_still_has_an_honest_level() -> None:
    """A DQ-01 guard-broken day has NO interpretable RETURN (NaN) but DOES have an honest
    LEVEL — because the roll is PnL-based (``NAV_{t−1} = NAV_t − pnl_t − F_t``) with no
    ``(1 + r_t)`` denominator to break. This is the measured reason A-01 rejected
    inverting the returns: an inversion refuses a non-finite return, i.e. refuses exactly
    the days the guards exist to MARK.

    The guard that marks such a day is now the live P&L-dominated one (164.6.6.2.3 D-06;
    the flow-dominance guard that used to stand here was deleted, D-05, and its day is
    pinned measured in ``test_flow_dominated_day_is_measured_and_its_level_is_honest``).

    Fixture — a day whose P&L is at least 10x the prior NAV:
      06-01: BUY −2_000                                    → pnl −2_000
      06-02: SELL +30_000                                  → pnl +30_000
      06-03: SELL −200                                     → pnl −200
    Anchor equity == balance == 31_000 ⇒ terminal 31_000.
      06-03 = 31_000
      06-02 = 31_000 + 200                   = 31_200
      06-01 = 31_200 − 30_000                =  1_200
      base  =  1_200 + 2_000                 =  3_200
    On 06-02 the chain-link denominator is NAV(06-01) = 1_200, above the 100 dust floor (D-27),
    and 30_000 ≥ 10 · 1_200, so ``pnl_dominated_guard`` breaks that day's return to NaN
    — and the $31_200 level stands regardless."""
    deals = [
        {"type": 0, "entry": 1, "profit": -2_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 1)},
        {"type": 1, "entry": 1, "profit": 30_000.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 2)},
        {"type": 1, "entry": 1, "profit": -200.0, "swap": 0.0,
         "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, 3)},
    ]
    nav, nav_meta = reconstruct_mt5_nav_levels(
        deals, account_equity=31_000.0, account_balance=31_000.0, server_utc_offset_s=0
    )
    returns, _r_meta = combine_mt5_deal_ledger(
        deals, account_equity=31_000.0, account_balance=31_000.0, server_utc_offset_s=0
    )
    broken = pd.Timestamp("2025-06-02")

    # The RETURN is unusable on that day...
    assert math.isnan(float(returns.loc[broken]))
    # ...its neighbours are measured (day 0 = −2_000 / 3_200, 06-03 = −200 / 31_200)...
    assert float(returns.loc[pd.Timestamp("2025-06-01")]) == pytest.approx(-0.625, abs=1e-12)
    assert float(returns.loc[pd.Timestamp("2025-06-03")]) == pytest.approx(
        -200.0 / 31_200.0, abs=1e-12
    )
    # ...while the LEVEL is present, finite and hand-derived.
    assert broken in nav.index
    assert math.isfinite(float(nav.loc[broken]))
    _assert_band(float(nav.loc[broken]), 31_200.0, "guard-broken-day level")
    _assert_band(float(nav.loc[pd.Timestamp("2025-06-01")]), 1_200.0, "06-01 level")
    _assert_band(float(nav.iloc[-1]), 31_000.0, "terminal level")

    # ONE reconstruction, one set of facts: the guard that broke the RETURN is reported
    # in the LEVELS meta too, rather than being a second independently-derived opinion.
    assert nav_meta.get("pnl_dominated_guard") is True
    assert "flow_dominated_guard" not in nav_meta
    assert nav_meta["computation_status_hint"] == "complete_with_warnings"
    assert nav_meta["series_completeness"] == "ledger_complete"


# ---------------------------------------------------------------------------
# Phase 164.6.6.2 BTCNATIVE plan 01 — a BTC-sized ledger is judged against BTC floors.
#
# The USD $1000 dust floor flattened every NAV of a BTC account (a 0.02 BTC account is
# "$0.02" to it). The thresholds now come from the account's unit (D-07; D-24: BTC dust
# floor 1e-7, superseding D-20's 0.001). The arithmetic core is unchanged; only the floors
# are handed in.
# ---------------------------------------------------------------------------

_BTC = classify_account_currency("BTC").floors


def _btc_deal(profit: float, day: int, kind: int = 0) -> dict:
    return {"type": kind, "entry": 1, "profit": profit, "swap": 0.0,
            "commission": 0.0, "fee": 0.0, "time": _epoch(2025, 6, day)}


def test_btc_account_gets_real_returns_under_btc_floors() -> None:
    """Equity 0.015 BTC after two days, balance == equity (no uPnL wedge), no flows.

    Hand arithmetic (BTC):
      day1 (06-02): +0.002   day2 (06-03): -0.005
      terminal NAV = 0.015
      backward roll (NAV_{t-1} = NAV_t - pnl_t):
        NAV(06-03) = 0.015
        NAV(06-02) = 0.015 - (-0.005) = 0.020
        base       = 0.020 - 0.002    = 0.018
      returns r_t = pnl_t / NAV_{t-1}:
        day1: 0.002 / 0.018 = 1/9 = 0.1111...
        day2: -0.005 / 0.020 = -0.25
    Every prior NAV (0.018, 0.020) is above the 1e-7 BTC dust floor: no guard.
    Under the DEFAULT (USD) floors the same input is dust-guarded on both days, which is
    the defect: 0.018 BTC < 1000.
    """
    deals = [_btc_deal(0.002, 2), _btc_deal(-0.005, 3)]
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=0.015, account_balance=0.015, floors=_BTC, server_utc_offset_s=0
    )
    vals = returns.to_numpy()
    assert len(returns) == 2
    assert vals[0] == pytest.approx(1 / 9, abs=1e-12)
    assert vals[1] == pytest.approx(-0.25, abs=1e-12)
    assert not meta.get("dust_nav_guard")
    assert int(returns.notna().sum()) == 2

    # The defect, in a test: the unit-blind default judges the same ledger as dust.
    _r, usd_meta = combine_mt5_deal_ledger(
        deals, account_equity=0.015, account_balance=0.015, server_utc_offset_s=0
    )
    assert usd_meta.get("dust_nav_guard") is True


def test_btc_account_between_1e7_and_0_001_is_measured_not_guarded() -> None:
    """D-24 (founder, 2026-10-08): "it should measure more. at least to 0.0000001".

    WHY it matters: under D-20's 0.001 floor the opening stretch of an account like MM-2x
    (a prev_nav of a few thousandths of a BTC and below) read ``dust_nav_guard`` on every
    day, so a real track record began months late. The floor is 1e-7 BTC now: a prev_nav
    anywhere in [1e-7, 0.001) is a usable return denominator and the day is MEASURED.

    Case A, the decade the old floor guarded. equity 0.0007, day1 +0.0001, day2 -0.0002.
      NAV(06-03) = 0.0007
      NAV(06-02) = 0.0007 - (-0.0002) = 0.0009
      base       = 0.0009 - 0.0001    = 0.0008
      r1 = 0.0001 / 0.0008 = 0.125      r2 = -0.0002 / 0.0009 = -2/9
    Both prior NAVs (0.0008, 0.0009) are under the OLD 0.001 floor and over the new 1e-7.

    Case B, a base 3 decades lower still, just above the floor. equity 4e-7, day1 +1e-7,
      day2 -1e-7.
      NAV(06-03) = 4e-7     NAV(06-02) = 4e-7 + 1e-7 = 5e-7     base = 5e-7 - 1e-7 = 4e-7
      r1 = 1e-7 / 4e-7 = 0.25            r2 = -1e-7 / 5e-7 = -0.2
    """
    a_deals = [_btc_deal(0.0001, 2), _btc_deal(-0.0002, 3)]
    a_returns, a_meta = combine_mt5_deal_ledger(
        a_deals, account_equity=0.0007, account_balance=0.0007, floors=_BTC, server_utc_offset_s=0
    )
    assert not a_meta.get("dust_nav_guard")
    assert int(a_returns.notna().sum()) == 2
    assert a_returns.to_numpy()[0] == pytest.approx(0.125, abs=1e-12)
    assert a_returns.to_numpy()[1] == pytest.approx(-2 / 9, abs=1e-12)

    b_deals = [_btc_deal(1e-7, 2), _btc_deal(-1e-7, 3)]
    b_returns, b_meta = combine_mt5_deal_ledger(
        b_deals, account_equity=4e-7, account_balance=4e-7, floors=_BTC, server_utc_offset_s=0
    )
    assert not b_meta.get("dust_nav_guard")
    assert int(b_returns.notna().sum()) == 2
    assert b_returns.to_numpy()[0] == pytest.approx(0.25, abs=1e-9)
    assert b_returns.to_numpy()[1] == pytest.approx(-0.2, abs=1e-9)


def test_btc_account_below_1e7_is_still_dust_guarded() -> None:
    """D-24 moves the floor down, it does not remove it: a base under 1e-7 BTC (a ten
    millionth of a coin, about a cent) is still not a percentage-return denominator.

    equity 6e-8, day1 +1e-8, day2 -2e-8.
      NAV(06-03) = 6e-8     NAV(06-02) = 6e-8 + 2e-8 = 8e-8     base = 8e-8 - 1e-8 = 7e-8
    Both prior NAVs (7e-8, 8e-8) are under 1e-7, so ``dust_nav_guard`` fires on both days:
    0 usable days, never a substituted base."""
    deals = [_btc_deal(1e-8, 2), _btc_deal(-2e-8, 3)]
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=6e-8, account_balance=6e-8, floors=_BTC, server_utc_offset_s=0
    )
    assert meta.get("dust_nav_guard") is True
    assert int(returns.notna().sum()) == 0
    assert meta.get("computation_status_hint") == "complete_with_warnings"


def test_scaled_usd_fixture_under_btc_floors_equals_unscaled_under_usd_floors() -> None:
    """The unit-invariance twin (the MM-2x defect in a test). Take the USD fixture of
    ``test_sub_1000_equity_reconstructs_off_real_anchor_not_fabricated_base`` (NAVs 2000,
    1400, 900 and day PnLs -600, -500) and scale every money value by 1e-6: NAVs 0.002,
    0.0014, 0.0009 and PnLs -0.0006, -0.0005.

    The 1e-6 is a FIXTURE scale, no longer the ratio between the two dust floors (D-24 put
    the BTC floor at 1e-7, so BTC is measured far below the scaled USD floor). It is still
    an honest twin here because every prior NAV of both fixtures clears its own floor
    (USD 1000; BTC 1e-7): the guard decisions are identical, the return series must match
    to 1e-12 and the flag set must match exactly. Under the DEFAULT floors the scaled
    fixture is dust-guarded on every day, which is what flattened MM-2x."""
    usd = [_btc_deal(-600.0, 2, kind=1), _btc_deal(-500.0, 3, kind=1)]
    scaled = [_btc_deal(-0.0006, 2, kind=1), _btc_deal(-0.0005, 3, kind=1)]

    usd_returns, usd_meta = combine_mt5_deal_ledger(
        usd, account_equity=900.0, account_balance=900.0, server_utc_offset_s=0
    )
    btc_returns, btc_meta = combine_mt5_deal_ledger(
        scaled, account_equity=0.0009, account_balance=0.0009, floors=_BTC, server_utc_offset_s=0
    )
    assert btc_returns.to_numpy() == pytest.approx(usd_returns.to_numpy(), abs=1e-12)
    assert btc_meta == usd_meta
    assert not btc_meta.get("dust_nav_guard")

    # Same scaled fixture, unit-blind: every day dust-guarded (NaN), nothing usable.
    blind_returns, blind_meta = combine_mt5_deal_ledger(
        scaled, account_equity=0.0009, account_balance=0.0009, server_utc_offset_s=0
    )
    assert blind_meta.get("dust_nav_guard") is True
    assert int(blind_returns.notna().sum()) == 0


def test_default_floors_are_the_usd_row() -> None:
    """Handing USD_FLOORS explicitly is the same call as handing nothing: the
    default-preserving keyword is what keeps every other caller byte-identical."""
    deals = _canonical_deposit_deals()
    kwargs = dict(account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0)
    default_r, default_m = combine_mt5_deal_ledger(deals, **kwargs)
    explicit_r, explicit_m = combine_mt5_deal_ledger(deals, floors=USD_FLOORS, **kwargs)
    pd.testing.assert_series_equal(default_r, explicit_r)
    assert default_m == explicit_m


def test_nav_levels_meta_reads_the_same_floors_as_the_returns_path() -> None:
    """``reconstruct_mt5_nav_levels`` takes its meta from the same core call the returns
    path makes, so it must be handed the same floors: a BTC ledger that is clean under BTC
    floors must not report a USD dust guard in the LEVELS meta (one reconstruction, one
    set of facts). Same ledger as the 0.02 / 0.015 oracle: NAVs 0.020 (06-02), 0.015."""
    deals = [_btc_deal(0.002, 2), _btc_deal(-0.005, 3)]
    nav, nav_meta = reconstruct_mt5_nav_levels(
        deals, account_equity=0.015, account_balance=0.015, floors=_BTC, server_utc_offset_s=0
    )
    assert nav.iloc[0] == pytest.approx(0.020, abs=1e-12)   # NAV(06-02)
    assert nav.iloc[-1] == pytest.approx(0.015, abs=1e-12)  # terminal
    assert not nav_meta.get("dust_nav_guard")
    _r, ret_meta = combine_mt5_deal_ledger(
        deals, account_equity=0.015, account_balance=0.015, floors=_BTC, server_utc_offset_s=0
    )
    assert nav_meta == ret_meta
    # Unit-blind default reports dust: the two paths would otherwise disagree.
    _n, blind_meta = reconstruct_mt5_nav_levels(
        deals, account_equity=0.015, account_balance=0.015, server_utc_offset_s=0
    )
    assert blind_meta.get("dust_nav_guard") is True


# ---------------------------------------------------------------------------
# D-24 follow-up (founder, 2026-10-08, from his own MT5 screenshots of MM-2x): the account
# opens with a 0.1 BTC deposit on 2025-10-16 and a 1.0 BTC deposit on 2025-10-17, trades,
# withdraws nearly everything, and today holds 0.00961461 BTC with trades of about
# 0.00002 to 0.0005 BTC each. "There really is a very small equity ... those amounts
# should be exactly represented." The oracle below is built in EXACT Fraction arithmetic
# (forward NAV, returns = pnl / prior NAV) and shares no code with the reconstruction,
# which rolls floats BACKWARD from the terminal.
# ---------------------------------------------------------------------------

_MM2X_FIRST_DEPOSIT = date(2025, 10, 16)
_MM2X_MIN_BAL_SCALED = [
    # (terminal balance, scale on the small-balance trades). Scale 1 is MM-2x today; the
    # other two keep the same SHAPE at a balance under D-20's old 0.001 floor (5e-4) and
    # 4 decades under MM-2x (3e-6), where the old floor would have guarded every day.
    (Fraction("0.00961461"), Fraction(1)),
    (Fraction("0.0005"), Fraction("0.05")),
    (Fraction("0.000003"), Fraction("0.0005")),
]


def _mm2x_ledger(terminal: Fraction, scale: Fraction):
    """MM-2x's shape as exact events ``(day, kind, Fraction)`` plus the exact expectation.

    Returns ``(events, expected, small_days)``: ``expected[day]`` is the exact return
    ``pnl_day / NAV_{day-1}`` (a flat gap day is exactly 0), for every day from the second
    ledger day on (day 1's 1.0 deposit carries no P&L, so its exact return is 0 on the
    0.1 base; 164.6.6.2.3 D-05 measures it, it used to be guarded). The withdrawal is DERIVED so the ledger closes to ``terminal`` with no
    residue: NAV after the withdrawal day = terminal - sum(small-balance pnl).
    """
    d0 = _MM2X_FIRST_DEPOSIT
    big = [Fraction(x) for x in ("0.021", "-0.013", "0.047", "-0.020", "0.009")]
    small = [
        Fraction(x) * scale
        for x in ("0.00002", "-0.00002", "0.0005", "-0.00025", "0.00012",
                  "0.00003", "-0.00004", "0.00031", "-0.0001", "0.000045")
    ]
    nav_after_withdrawal = terminal - sum(small)
    nav_before = Fraction("1.1") + sum(big)
    # The withdrawal day carries a small LOSS, so its P&L numerator is an ordinary
    # return. The withdrawal itself is a flow: measured at day level, never a reason to
    # guard the day (164.6.6.2.3 D-05 deleted the flow-dominance guard).
    withdrawal_day_pnl = Fraction("-0.004")
    withdrawal = nav_after_withdrawal - nav_before - withdrawal_day_pnl  # negative
    wd = d0 + timedelta(8)
    events = [(d0, "flow", Fraction("0.1")), (d0 + timedelta(1), "flow", Fraction(1))]
    events += [(d0 + timedelta(2 + i), "pnl", p) for i, p in enumerate(big)]
    events += [(wd, "pnl", withdrawal_day_pnl), (wd, "flow", withdrawal)]
    small_days = [wd + timedelta(1 + i) for i in range(len(small))]
    events += [(d, "pnl", p) for d, p in zip(small_days, small)]

    pnl_by_day: dict[date, Fraction] = {}
    flow_by_day: dict[date, Fraction] = {}
    for day, kind, amount in events:
        book = flow_by_day if kind == "flow" else pnl_by_day
        book[day] = book.get(day, Fraction(0)) + amount
    last = max(d for d, _k, _a in events)
    expected: dict[date, Fraction] = {}
    nav = Fraction(0)
    day = d0
    while day <= last:
        prev = nav
        nav = prev + pnl_by_day.get(day, Fraction(0)) + flow_by_day.get(day, Fraction(0))
        if day >= d0 + timedelta(1):
            expected[day] = pnl_by_day.get(day, Fraction(0)) / prev
        day += timedelta(1)
    assert nav == terminal  # the exact ledger closes with no residue
    return events, expected, small_days


def _mm2x_deals(events) -> list[dict]:
    deals = []
    for day, kind, amount in events:
        row = {"profit": float(amount), "swap": 0.0, "commission": 0.0, "fee": 0.0,
               "time": _epoch(day.year, day.month, day.day)}
        if kind == "flow":
            deals.append({**row, "type": 2})  # BALANCE: deposit +, withdrawal -
        else:
            deals.append({**row, "type": 0 if amount >= 0 else 1, "entry": 1})
    return deals


def _exact_prior_navs(events) -> dict[date, Fraction]:
    """The exact NAV at the START of every calendar day from the first event to the last,
    in Fraction arithmetic, rolled FORWARD from an empty account (no code shared with the
    float backward roll). ``events`` is ``(day, "pnl" | "flow", Fraction)``."""
    pnl: dict[date, Fraction] = {}
    flow: dict[date, Fraction] = {}
    for day, kind, amount in events:
        book = flow if kind == "flow" else pnl
        book[day] = book.get(day, Fraction(0)) + amount
    first = min(d for d, _k, _a in events)
    last = max(d for d, _k, _a in events)
    prior: dict[date, Fraction] = {}
    nav = Fraction(0)
    day = first
    while day <= last:
        prior[day] = nav
        nav = nav + pnl.get(day, Fraction(0)) + flow.get(day, Fraction(0))
        day += timedelta(1)
    return prior


@pytest.mark.parametrize(("terminal", "scale"), _MM2X_MIN_BAL_SCALED)
def test_mm2x_shape_every_small_balance_day_is_measured_and_exact(
    terminal: Fraction, scale: Fraction
) -> None:
    """The founder's account, exactly. Deposit 0.1, deposit 1.0, trading, a near-total
    withdrawal, then small-balance trading ending at ``terminal`` with per-trade P&L down to
    2e-5 (scaled with the balance in the two lower variants).

    Every day after the first ledger day must be MEASURED (never ``dust_nav_guard`` NaN) at
    the 1e-7 floor and equal ``pnl / prior NAV`` computed in exact Fraction arithmetic to
    1e-12. The first ledger day is NaN by design and is asserted as such, not skipped: it is
    the account's INCEPTION (164.6.6.2.3 D-01/D-12, every MT5 ledger is full-history), so it
    has no opening capital, no return and, whatever sign the float residue of the backward
    roll has, no dust or negative warning. Day 1's 1.0 deposit, ten times the prior 0.1 NAV,
    is MEASURED (D-05: no flow-dominance guard) and its exact return is 0, a deposit-only
    day. A variant below D-20's 0.001 floor is the case D-24 exists for: the old floor
    guarded every one of its small-balance days."""
    events, expected, small_days = _mm2x_ledger(terminal, scale)
    returns, meta = combine_mt5_deal_ledger(
        _mm2x_deals(events),
        account_equity=float(terminal),
        account_balance=float(terminal),
        floors=_BTC,
        server_utc_offset_s=0,
    )
    first = pd.Timestamp(_MM2X_FIRST_DEPOSIT)
    assert returns.index[0] == first
    assert math.isnan(returns.iloc[0])  # the deposit-only first day has no opening capital
    # Day 1 (the 1.0 BTC deposit on a 0.1 BTC base, the case the retired flag broke) is
    # measured, and exactly flat: the Fraction oracle in ``expected`` carries it, and this
    # pins the value by hand too (no P&L on a deposit-only day, so 0 / 0.1).
    assert returns.iloc[1] == pytest.approx(0.0, abs=1e-12)
    for day, exact in expected.items():
        got = returns.loc[pd.Timestamp(day)]
        assert not math.isnan(got), f"{day} was guarded, not measured"
        assert got == pytest.approx(float(exact), abs=1e-12), f"{day}"
    assert all(pd.Timestamp(d) in returns.index for d in small_days)
    # No guard of any kind and no retired flow flag, and no NaN beyond the first: the count of
    # NaN is exactly 1 (the inception day carries NO dust or negative flag any more, D-01).
    for guard in ("pnl_dominated_guard", "flow_dominated_guard", "dust_nav_guard",
                  "negative_nav_guard"):
        assert guard not in meta
    # How each flow day was measured (D-07, D-10). Day 1 is a deposit-only day: its record
    # resolves (the deposit has a time of day) and no position was opened, so it is a TIMED
    # day whose value is the same exact 0. Day 8 carries a withdrawal AND a trading deal
    # without a position id (this fixture predates the position fields): its open cannot be
    # resolved, so it takes the day-level rule and the strategy says so.
    assert meta.get("flow_timing_day_level") is True
    assert meta["flow_timing_day_level_days"] == 1
    assert meta["flow_timing_timed_days"] == 1
    assert int(returns.isna().sum()) == 1

    # D-25: the measured days whose EXACT prior NAV is under the BTC material equity (1e-4)
    # are flagged, and only those. The expectation comes from the Fraction forward ledger,
    # which shares no code with the float backward roll. MM-2x today (scale 1) never goes
    # under ~0.0096, so it carries no flag at all; the 3e-6 variant lives under 1e-4.
    prior = _exact_prior_navs(events)
    small = [d for d in expected if prior[d] < Fraction(1, 10000)]
    if scale == 1:
        assert not small
        assert "small_base_measured" not in meta
    if small:
        assert meta.get("small_base_measured") is True
        assert meta["small_base_measured_days"] == len(small)
        assert meta["small_base_measured_min_nav"] == pytest.approx(
            float(min(prior[d] for d in small)), rel=1e-6
        )
    else:
        assert "small_base_measured" not in meta
    # Informational: flagged days kept their exact returns (asserted above) and the chain
    # is not broken.
    assert "twr_chain_broken" not in meta


# BTC ``residual_abs_tol`` (services/account_unit.py), restated: the residue band inside which
# the base before a full-history account's first deposit is float noise, not capital.
_BTC_RESIDUE_TOL = Fraction("1e-6")


@pytest.mark.parametrize(
    "residue", ["0", "5e-8", "1e-7", "9e-7", "2e-6", "3e-5", "5e-4", "0.02", "0.2"]
)
def test_no_return_is_emitted_before_the_first_deposit(residue: str) -> None:
    """The account holds NOTHING before its first deposit, so the backward roll's opening
    capital ``NAV_0 - pnl_0 - F_0`` is exactly zero in theory and only float noise or an
    incomplete ledger leaves a residue R.

    164.6.6.2.3 D-01/D-12 (every MT5 ledger is full-history): day 0 is the INCEPTION day.
    A residue within the unit's ``residual_abs_tol`` (BTC 1e-6) is noise whatever its sign:
    day 0 has no return and no warning. A residue above it is real capital, judged as it
    always was by the negative and dust guards and, once it passes them, MEASURED; a
    deposit-only day has no P&L, so its return is exactly 0, never a gain.

    The test pins:
      * the reconstructed series STARTS on the first ledger day: no row exists for an
        earlier calendar day, so no return can be booked before the first deposit;
      * |R| <= 1e-6: day 0 is NaN (this used to depend on which side of the 1e-7 dust
        floor float noise landed, and R = 1e-7 had to accept either answer);
      * |R| > 1e-6: day 0 is measured and flat, within 1e-9 of 0.
    """
    terminal = Fraction("0.00961461")
    events, _expected, _small = _mm2x_ledger(terminal, Fraction(1))
    equity = float(terminal + Fraction(residue))
    returns, meta = combine_mt5_deal_ledger(
        _mm2x_deals(events), account_equity=equity, account_balance=equity, floors=_BTC, server_utc_offset_s=0
    )
    first = pd.Timestamp(_MM2X_FIRST_DEPOSIT)
    assert returns.index.min() == first, "a row exists before the first deposit"
    assert not (returns.index < first).any()
    day0 = returns.loc[first]
    if Fraction(residue) <= _BTC_RESIDUE_TOL:
        assert math.isnan(day0), "the inception day booked a return"
        assert "dust_nav_guard" not in meta and "negative_nav_guard" not in meta
    else:
        # Measured, and flat: the 0.1 deposit is a flow, not P&L (hand-derived 0).
        assert day0 == pytest.approx(0.0, abs=1e-9)


# (residue R, how day 0 reads). The two-day ledger isolates day 0 as a function of R alone.
_DAY0_RESIDUES = [
    # Inside the unit's residue band, either sign: the inception day. No return, no warning.
    ("0", "inception"),
    ("1e-16", "inception"),
    ("-1e-16", "inception"),
    ("5e-8", "inception"),
    ("-5e-8", "inception"),
    ("1e-7", "inception"),
    ("9e-7", "inception"),
    # Above the band: real capital. It passes the dust floor (1e-7) and is MEASURED, flat.
    ("2e-6", "measured"),
    ("3e-5", "measured"),
    ("5e-4", "measured"),
    ("0.02", "measured"),
    ("0.2", "measured"),
    # A real negative base is a defect, not noise: the negative guard is kept (D-06).
    ("-0.02", "negative"),
]


@pytest.mark.parametrize(("residue", "reading"), _DAY0_RESIDUES)
def test_day0_of_a_full_history_ledger_is_its_inception_whatever_the_residue_sign(
    residue: str, reading: str
) -> None:
    """164.6.6.2.3 D-01 (root cause recorded in the MM-2x dust-guard debug note): the
    first funding day of a full-history account is its inception, and "its near-zero start is
    not a warning, whatever the noise's sign". Before this change the sign of float residue
    decided which warning day 0 raised (``negative_nav_guard`` for -1e-17, ``dust_nav_guard``
    for +1e-17) and every MT5 account carried it.

    This ledger has exactly two days so every guard key in ``meta`` belongs to day 0 or day 1,
    and day 1 (a +0.001 trade on a 0.1 + R base, no flow) cannot trip any guard:
      deposit 0.1 on day 0, trade +0.001 on day 1, terminal equity 0.101 + R
      NAV(day 1) = 0.101 + R     NAV(day 0) = 0.101 + R - 0.001 = 0.1 + R
      day-0 prior NAV = NAV(day 0) - pnl(day 0) - flow(day 0) = 0.1 + R - 0 - 0.1 = R
    so the day-0 decision is a function of R alone, and the band is the BTC
    ``residual_abs_tol`` 1e-6 (D-12 / the debug note).
    """
    d0 = date(2025, 10, 16)
    events = [
        (d0, "flow", Fraction("0.1")),
        (d0 + timedelta(1), "pnl", Fraction("0.001")),
    ]
    equity = float(Fraction("0.101") + Fraction(residue))
    returns, meta = combine_mt5_deal_ledger(
        _mm2x_deals(events), account_equity=equity, account_balance=equity, floors=_BTC, server_utc_offset_s=0
    )
    day0 = returns.loc[pd.Timestamp(d0)]
    guards = ("negative_nav_guard", "dust_nav_guard", "pnl_dominated_guard",
              "flow_dominated_guard")
    if reading == "inception":
        assert math.isnan(day0)
        assert not any(k in meta for k in guards), f"R={residue}: {meta!r}"
        assert meta["computation_status_hint"] == "complete"
        assert "flow_timing_day_level" not in meta
    elif reading == "measured":
        # Pnl 0, flow 0.1, base R: r = (NAV_0 - R - 0.1) / R = 0 up to float noise (about
        # 1e-17 / R, far inside 1e-9 for every R here). The deposit has a time of day and
        # no position was opened, so this is a TIMED day, not a day-level one.
        assert day0 == pytest.approx(0.0, abs=1e-9)
        assert not any(k in meta for k in guards), f"R={residue}: {meta!r}"
        assert meta["computation_status_hint"] == "complete"
        assert meta["flow_timing_timed_days"] == 1
        assert "flow_timing_day_level" not in meta
    else:
        assert reading == "negative"
        assert math.isnan(day0)
        assert meta.get("negative_nav_guard") is True
        assert meta["computation_status_hint"] == "complete_with_warnings"
    # Day 1 is measured on its exact base 0.1 + R (a normal day, never flagged).
    exact_day1 = Fraction("0.001") / (Fraction("0.1") + Fraction(residue))
    assert returns.loc[pd.Timestamp(d0 + timedelta(1))] == pytest.approx(
        float(exact_day1), abs=1e-12
    )
    # D-25 (the annotation, never a warning): a MEASURED day 0 whose base R is under the BTC
    # material equity (1e-4) is counted as "measured on a very small balance": one day,
    # smallest prior NAV R. An inception or guarded day 0 is not measured, so not counted,
    # and day 1's base (0.1 + R) is never small.
    if reading == "measured" and Fraction(residue) < Fraction(1, 10000):
        assert meta.get("small_base_measured") is True
        assert meta["small_base_measured_days"] == 1
        assert meta["small_base_measured_min_nav"] == pytest.approx(
            float(Fraction(residue)), rel=1e-6
        )
    else:
        assert "small_base_measured" not in meta


def test_the_inception_rule_needs_full_history_so_a_window_keeps_its_day0_guard() -> None:
    """D-01 "Retention-windowed venues, where day 0's base is real capital, keep today's
    behaviour": the SAME folded ledger through the core WITHOUT ``full_history`` (what a
    capped venue passes) still raises the day-0 guard for a zero residue, and WITH it (what
    the MT5 combiner passes, its deal fetch being the whole record) raises none."""
    from services.broker_dailies import _fold_mt5_deals
    from services.nav_twr import reconstruct_nav_and_twr

    d0 = date(2025, 10, 16)
    events = [(d0, "flow", Fraction("0.1")), (d0 + timedelta(1), "pnl", Fraction("0.001"))]
    pnl, flows, timing = _fold_mt5_deals(_mm2x_deals(events), 0)
    kwargs = dict(external_flows=flows, floors=_BTC, timing=timing)
    _r, windowed = reconstruct_nav_and_twr(pnl, 0.101, **kwargs)
    _r, full = reconstruct_nav_and_twr(pnl, 0.101, full_history=True, **kwargs)
    assert windowed.get("negative_nav_guard") is True or windowed.get("dust_nav_guard") is True
    assert "negative_nav_guard" not in full and "dust_nav_guard" not in full


def test_legacy_deals_without_position_ids_keep_the_day_level_rule() -> None:
    """D-07: a deal row that predates the position fields (no ``position_id``, no
    ``time_msc``) cannot say when its position opened. The deposit day that holds such a
    trade is measured at day level exactly as before, and the strategy says so (an
    annotation, not a warning). Canonical ledger: +10_000 deposit and +300 P&L on 06-04,
    prior NAV 100_400, so r = 300 / 100_400 (the deposit is not a gain)."""
    returns, meta = combine_mt5_deal_ledger(
        _canonical_deposit_deals(), account_equity=110_500.0, account_balance=110_500.0, server_utc_offset_s=0
    )
    assert float(returns.loc[pd.Timestamp("2025-06-04")]) == pytest.approx(300 / 100_400, abs=1e-12)
    assert meta["flow_timing_day_level"] is True
    assert meta["flow_timing_day_level_days"] == 1
    assert "flow_timing_timed_days" not in meta
    assert meta["computation_status_hint"] == "complete"


# ---------------------------------------------------------------------------
# D-25 (founder, 2026-10-08, after plan 14 review WR-01 / SFH M1): with the dust floor at
# 1e-7 a day measured on a tiny base (a near-total withdrawal while a winning position is
# open: +500%) is kept EXACT and flagged "measured on a very small balance" whenever its
# starting balance is below the unit's ``material_equity`` (BTC 1e-4). Informational only:
# it never breaks the chain and never drops the day.
# ---------------------------------------------------------------------------


def _d25_events(day_offset_events):
    d = date(2025, 6, 1)
    return [(d + timedelta(off - 1), kind, Fraction(amount)) for off, kind, amount in day_offset_events]


def test_wr01_post_withdrawal_tiny_base_is_measured_exactly_and_flagged() -> None:
    """The reviewer's +500% case (WR-01), exactly. All amounts in BTC, built in Fraction:
      day 1: deposit 0.01          NAV 0.01
      day 2: trade +0.0001         NAV 0.0101
      day 3: withdraw 0.01009      NAV 0.00001   (a near-total withdrawal)
      day 4: trade +0.00005        NAV 0.00006
    Prior NAVs: day 2 = 0.01, day 3 = 0.0101, day 4 = 0.00001.
    Exact returns (pnl / prior NAV): day 2 = 0.0001 / 0.01 = 1/100, day 3 = 0 (the
    withdrawal is a flow, not P&L), day 4 = 0.00005 / 0.00001 = 5 (+500%).

    D-25: day 4 is MEASURED EXACTLY (+500% is kept, not dropped, not clamped) AND flagged,
    because its prior NAV 1e-5 is under the 1e-4 material equity. It is the only such day
    (day 2's 0.01 and day 3's 0.0101 are well above it), the smallest prior NAV is 1e-5, and
    the chain is not broken: the only NaN is the deposit day, a leading one."""
    events = _d25_events([
        (1, "flow", "0.01"), (2, "pnl", "0.0001"),
        (3, "flow", "-0.01009"), (4, "pnl", "0.00005"),
    ])
    prior = _exact_prior_navs(events)
    exact = {
        d: sum((a for dd, k, a in events if dd == d and k == "pnl"), Fraction(0)) / prior[d]
        for d in prior if prior[d] > 0
    }
    assert exact[date(2025, 6, 4)] == 5
    terminal = Fraction("0.00006")
    returns, meta = combine_mt5_deal_ledger(
        _mm2x_deals(events),
        account_equity=float(terminal), account_balance=float(terminal), floors=_BTC,
        server_utc_offset_s=0,
    )
    for day, value in exact.items():
        assert returns.loc[pd.Timestamp(day)] == pytest.approx(float(value), abs=1e-9), day
    assert returns.loc[pd.Timestamp("2025-06-04")] == pytest.approx(5.0, abs=1e-9)
    assert int(returns.isna().sum()) == 1 and math.isnan(returns.iloc[0])
    assert meta.get("small_base_measured") is True
    assert meta["small_base_measured_days"] == 1
    assert meta["small_base_measured_min_nav"] == pytest.approx(1e-5, rel=1e-6)
    assert "twr_chain_broken" not in meta
    assert "pnl_dominated_guard" not in meta  # +5e-5 is under 10 x 1e-5: not P&L-dominated


@pytest.mark.parametrize(
    ("equity", "flagged"),
    [(1.5e-4, False), (5e-5, True)],
)
def test_small_base_flag_follows_the_material_equity_threshold(
    equity: float, flagged: bool
) -> None:
    """Same two-day trading ledger (+1e-5, then -2e-5, no flows) at two balances.
    Exact (Fraction) arithmetic, backward from the terminal equity E:
      NAV_2 = E     NAV_1 = E + 2e-5     base = NAV_1 - 1e-5 = E + 1e-5
      r_1 = 1e-5 / (E + 1e-5)     r_2 = -2e-5 / (E + 2e-5)
    E = 1.5e-4: bases 1.6e-4 and 1.7e-4, both at or above 1e-4, NOT flagged.
    E = 5e-5:  bases 6e-5 and 7e-5, both under 1e-4, flagged (2 days, smallest 6e-5).
    The returns are exact either way; the flag never changes a number."""
    e = Fraction(str(equity))
    r1 = Fraction("0.00001") / (e + Fraction("0.00001"))
    r2 = Fraction("-0.00002") / (e + Fraction("0.00002"))
    deals = [_btc_deal(1e-5, 2), _btc_deal(-2e-5, 3, kind=1)]
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=equity, account_balance=equity, floors=_BTC, server_utc_offset_s=0
    )
    assert returns.to_numpy() == pytest.approx([float(r1), float(r2)], abs=1e-9)
    if flagged:
        assert meta["small_base_measured"] is True
        assert meta["small_base_measured_days"] == 2
        assert meta["small_base_measured_min_nav"] == pytest.approx(6e-5, rel=1e-6)
    else:
        assert "small_base_measured" not in meta
        assert "small_base_measured_days" not in meta
    assert "twr_chain_broken" not in meta
    assert meta["computation_status_hint"] == "complete"  # informational, never a warning


# ---------------------------------------------------------------------------
# 164.6.6.2.3 FLOWTIMING plan 05 (D-02/D-03/D-04/D-09/D-10): MT5 is the one venue whose
# fetched deals carry BOTH the flow instants and each position's open instant, so the fold
# builds a per-day ``DayTiming`` and a deposit changes the base only for positions opened
# AFTER it. The oracle below is exact Fraction arithmetic over the EVENT LIST (flows and
# positions with UTC millisecond instants). It imports nothing from ``services`` and does
# not look at a deal row, so it is an independent invariant, not the fold re-run.
# ---------------------------------------------------------------------------

_MS_PER_DAY = 86_400_000


def _utc_ms(d: date, hh: int = 0, mm: int = 0, ss: int = 0, ms: int = 0) -> int:
    """UTC epoch milliseconds of ``d`` at hh:mm:ss.ms."""
    whole = datetime(d.year, d.month, d.day, hh, mm, ss, tzinfo=timezone.utc)
    return int(whole.timestamp()) * 1000 + ms


def _stamped(row: dict, utc_ms: int, offset_s: int) -> dict:
    """``row`` as the broker serves it: ``time`` (seconds) and ``time_msc`` (milliseconds)
    on the SERVER clock, which runs ``offset_s`` ahead of UTC."""
    server_ms = utc_ms + offset_s * 1000
    return {**row, "time": server_ms // 1000, "time_msc": server_ms}


_ZERO_COSTS = {"swap": 0.0, "commission": 0.0, "fee": 0.0}


def _timed_flow_deal(utc_ms: int, amount: Fraction, offset_s: int = 0) -> dict:
    """A BALANCE deal (deposit +, withdrawal -)."""
    return _stamped({"type": 2, "profit": float(amount), **_ZERO_COSTS}, utc_ms, offset_s)


def _timed_position_deals(
    position_id: int, open_ms: int, close_ms: int, pnl: Fraction, offset_s: int = 0
) -> list[dict]:
    """A position as MT5 books it: an IN deal at the open (no P&L) and an OUT deal at the
    close carrying the realized P&L."""
    opening = _stamped(
        {"type": 0, "entry": 0, "position_id": position_id, "profit": 0.0, **_ZERO_COSTS},
        open_ms, offset_s,
    )
    closing = _stamped(
        {"type": 1, "entry": 1, "position_id": position_id, "profit": float(pnl),
         **_ZERO_COSTS},
        close_ms, offset_s,
    )
    return [opening, closing]


def _timed_oracle(
    flows: list[tuple[int, Fraction]],
    positions: list[tuple[int, int, Fraction]],
) -> dict[date, Fraction | None]:
    """Exact per-UTC-day return of each day that holds an event, in Fraction arithmetic.

    ``flows``: ``(utc_ms, signed amount)``. ``positions``: ``(open_ms, close_ms, cash)``; its
    cash lands, and is realized, at the close instant (a commission is ``(t, t, cost)``).
    D-02/D-17: a position is measured against the capital in the account when it was OPENED,
    i.e. the start-of-day NAV, plus the non-zero flows of that day at or before the open (a
    flow at the same millisecond counts first, D-09), plus the FULL day P&L of that day's
    EARLIER capital levels, realized by the open or not (the D-17 telescoping base; a flow of
    exactly 0 moves nothing and splits nothing). A position opened on an earlier day belongs
    to the start-of-day base (D-04). Positions that opened after the same flows share one
    capital level and one base: that level's base is read at its first P&L-bearing open. The
    day's return links the levels: ``prod(1 + P_k / B_k) - 1``. A level with no P&L adds a
    factor of exactly 1, so a day that held capital at its start and made no money is a
    measured 0; a day that opened with no capital at all (the inception day) and made no
    money has no return (``None``)."""
    day_of = lambda ms: ms // _MS_PER_DAY  # noqa: E731
    days = sorted({day_of(ms) for ms, _a in flows} | {day_of(c) for _o, c, _p in positions})
    out: dict[date, Fraction | None] = {}
    for day in range(days[0], days[-1] + 1):
        start_nav = sum((a for ms, a in flows if day_of(ms) < day), Fraction(0)) + sum(
            (p for _o, c, p in positions if day_of(c) < day), Fraction(0)
        )
        todays = sorted((ms, a) for ms, a in flows if day_of(ms) == day and a != 0)
        entries = [(o, c, p) for o, c, p in positions if day_of(c) == day]

        def level(open_ms: int) -> int:
            if day_of(open_ms) < day:
                return 0
            return sum(1 for ms, _a in todays if ms <= open_ms)

        level_pnl = [Fraction(0)] * (len(todays) + 1)
        first_open: dict[int, int] = {}
        for open_ms, _close_ms, pnl in entries:
            k = level(open_ms)
            level_pnl[k] += pnl
            if k > 0 and pnl != 0:
                first_open[k] = min(first_open.get(k, open_ms), open_ms)
        growth: Fraction | None = None
        for k, pnl in enumerate(level_pnl):
            if pnl == 0:
                continue
            if k == 0:
                base = start_nav
            else:
                t = first_open[k]
                base = (
                    start_nav
                    + sum((a for ms, a in todays if ms <= t), Fraction(0))
                    + sum((p for o, _c, p in entries if level(o) < k), Fraction(0))
                )
            growth = (growth if growth is not None else Fraction(1)) * (1 + pnl / base)
        if growth is None and start_nav != 0:
            growth = Fraction(1)
        calendar = date(1970, 1, 1) + timedelta(day)
        if any(day_of(ms) == day for ms, _a in flows) or any(
            day_of(c) == day for _o, c, _p in positions
        ):
            out[calendar] = None if growth is None else growth - 1
    return out


def _mm2x_timed_deals(
    *,
    open_at: tuple[int, int, int, int] = (10, 0, 0, 0),
    close_at: tuple[int, int, int, int] = (15, 0, 0, 0),
    open_day_offset: int = 1,
    pnl: Fraction = Fraction("0.011"),
    offset_s: int = 0,
) -> tuple[list[dict], list[tuple[int, Fraction]], list[tuple[int, int, Fraction]]]:
    """The MM-2x shape with in-day times: 0.1 BTC deposited 08:00 on day 0, 1.0 BTC
    deposited 09:00 on day 1, one position closed on day 1 with ``pnl``. ``open_at`` is the
    open's (hh, mm, ss, ms), ``open_day_offset`` 1 = opened on day 1, 0 = overnight from day
    0. Returns ``(deals, flows, positions)``; the last two feed the oracle."""
    d0 = _MM2X_FIRST_DEPOSIT
    d1 = d0 + timedelta(1)
    flows = [
        (_utc_ms(d0, 8), Fraction("0.1")),
        (_utc_ms(d1, 9), Fraction(1)),
    ]
    open_ms = _utc_ms(d0 + timedelta(open_day_offset), *open_at)
    close_ms = _utc_ms(d1, *close_at)
    positions = [(open_ms, close_ms, pnl)]
    deals = [_timed_flow_deal(ms, amount, offset_s) for ms, amount in flows]
    deals += _timed_position_deals(1001, open_ms, close_ms, pnl, offset_s)
    return deals, flows, positions


def _terminal(flows, positions) -> float:
    return float(sum((a for _m, a in flows), Fraction(0)) + sum((p for *_x, p in positions), Fraction(0)))


def test_mm2x_timed_deposit_day_is_measured_on_the_capital_the_position_opened_on() -> None:
    """The tracer (D-02/D-03). Day 0: 0.1 BTC deposited at 08:00. Day 1: 1.0 BTC deposited
    at 09:00, then a position opened at 10:00 and closed at 15:00 for +0.011 BTC.

    Hand arithmetic: the position opened AFTER the deposit, on 0.1 + 1.0 = 1.1 BTC, so its
    return is 0.011 / 1.1 = 0.01 exactly. The end-of-day formula ((NAV_1 - NAV_0 - F) / NAV_0
    = 0.011 / 0.1) would book 0.11, eleven times too large: the deposit is capital the
    position was never run on.
    """
    deals, flows, positions = _mm2x_timed_deals()
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=_terminal(flows, positions),
        account_balance=_terminal(flows, positions), floors=_BTC,
        server_utc_offset_s=0,
    )
    d0, d1 = _MM2X_FIRST_DEPOSIT, _MM2X_FIRST_DEPOSIT + timedelta(1)
    oracle = _timed_oracle(flows, positions)
    assert oracle[d1] == Fraction(1, 100)  # the independent figure is the hand figure
    got = float(returns.loc[pd.Timestamp(d1)])
    assert got == pytest.approx(0.01, abs=1e-12)
    assert got == pytest.approx(float(oracle[d1]), abs=1e-12)
    assert got != pytest.approx(0.011 / 0.1, abs=1e-3)  # the end-of-day answer, 0.11
    # Day 0 is the inception: a deposit-only day, no return and no warning.
    assert math.isnan(float(returns.loc[pd.Timestamp(d0)]))
    for guard in ("dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard"):
        assert guard not in meta
    # Both flow days were measured on their timestamps, so none is "at day level".
    assert "flow_timing_day_level" not in meta
    assert meta["flow_timing_timed_days"] >= 1
    assert meta["computation_status_hint"] == "complete"


@pytest.mark.parametrize(
    ("what", "kwargs", "expected_str"),
    [
        # Opened 08:30, BEFORE the 09:00 deposit: cohort 0, base 0.1. D-02 "a deposit
        # changes the base only for positions opened after it".
        ("opened-before-deposit", {"open_at": (8, 30, 0, 0)}, "0.11"),
        # One millisecond before the deposit: still cohort 0 (the boundary, below the tie).
        ("one-ms-before-deposit", {"open_at": (8, 59, 59, 999)}, "0.11"),
        # The exact millisecond of the deposit: the deposit funds the trade (D-09), 1.1.
        ("same-millisecond-as-deposit", {"open_at": (9, 0, 0, 0)}, "0.01"),
        # One millisecond after: 1.1.
        ("one-ms-after-deposit", {"open_at": (9, 0, 0, 1)}, "0.01"),
        # Opened the day before, after day 0's deposit: it belongs to the start-of-day base
        # of day 1 (D-04), 0.1, whatever the clock says on day 1.
        ("carried-overnight", {"open_day_offset": 0, "open_at": (12, 0, 0, 0)}, "0.11"),
    ],
)
@pytest.mark.parametrize("offset_s", [0, 10_800])
def test_timed_deposit_day_cohort_follows_the_open_instant(
    what: str, kwargs: dict, expected_str: str, offset_s: int
) -> None:
    """Which base a position is measured against, at the boundaries (D-02, D-04, D-09), on a
    UTC server clock and on one running 3 hours ahead (D-08: instants are UTC, the same
    offset the day uses). Day-1 hand figures: 0.011 / 0.1 = 0.11 and 0.011 / 1.1 = 0.01."""
    deals, flows, positions = _mm2x_timed_deals(offset_s=offset_s, **kwargs)
    equity = _terminal(flows, positions)
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=equity, account_balance=equity, floors=_BTC,
        server_utc_offset_s=offset_s,
    )
    d1 = _MM2X_FIRST_DEPOSIT + timedelta(1)
    got = float(returns.loc[pd.Timestamp(d1)])
    assert got == pytest.approx(float(Fraction(expected_str)), abs=1e-12), what
    oracle = _timed_oracle(flows, positions)
    assert oracle[d1] == Fraction(expected_str)
    assert "flow_timing_day_level" not in meta, what


def _random_timed_ledger(seed: int, offset_s: int):
    """A seeded multi-day MT5 ledger: deposits and withdrawals at random instants (some
    sharing a millisecond with a position open), positions opened the same day or carried
    overnight, and a commission on every opening deal. Returns ``(deals, flows, positions)``
    in the oracle's terms (UTC milliseconds, Fractions)."""
    rng = random.Random(seed)
    d0 = date(2025, 10, 16)
    n_days = 6
    flows: list[tuple[int, Fraction]] = []
    positions: list[tuple[int, int, Fraction]] = []
    commissions: list[tuple[int, Fraction]] = []
    nav = Fraction(0)
    first_deposit = Fraction(rng.randint(8000, 20000))
    flows.append((_utc_ms(d0, 0, 0, 5), first_deposit))
    nav += first_deposit
    pid = 5000
    deals: list[dict] = [_timed_flow_deal(_utc_ms(d0, 0, 0, 5), first_deposit, offset_s)]
    open_pool: list[tuple[int, int, int]] = []  # (pid, open_ms, day index) carried positions
    for day_i in range(n_days):
        day = d0 + timedelta(day_i)
        today_flow_ms: list[int] = []
        for _ in range(rng.choice([0, 0, 1, 1, 2])):
            if day_i == 0:
                break
            ms = _utc_ms(day, rng.randint(0, 23), rng.randint(0, 59), rng.randint(0, 59),
                         rng.randint(0, 999))
            amount = Fraction(rng.randint(500, 9000))
            if rng.random() < 0.4:
                amount = -min(amount, nav // 4)
            flows.append((ms, amount))
            nav += amount
            today_flow_ms.append(ms)
            deals.append(_timed_flow_deal(ms, amount, offset_s))
        # positions that CLOSE today: carried ones opened on an earlier day, and new ones.
        for _ in range(rng.randint(0, 3)):
            lo = _utc_ms(day, 1) if day_i == 0 else _utc_ms(day)
            close_ms = rng.randint(lo + 60_000, _utc_ms(day, 23, 59, 59))
            if day_i > 0 and rng.random() < 0.35:
                open_ms = rng.randint(_utc_ms(d0 + timedelta(rng.randint(0, day_i - 1)), 1),
                                      _utc_ms(day) - 1)
            elif today_flow_ms and rng.random() < 0.4:
                open_ms = rng.choice(today_flow_ms)  # a tie with a flow
                close_ms = max(close_ms, open_ms + 1000)
            else:
                open_ms = rng.randint(lo, close_ms - 1)
            commission = -Fraction(rng.randint(0, 40), 100)
            pnl = Fraction(rng.randint(-250, 400), 1) + Fraction(rng.randint(0, 99), 100)
            pid += 1
            opening, closing = _timed_position_deals(pid, open_ms, close_ms, pnl, offset_s)
            opening["commission"] = float(commission)
            deals += [opening, closing]
            positions.append((open_ms, close_ms, pnl))
            if commission != 0:
                positions.append((open_ms, open_ms, commission))
            nav += pnl + commission
    return deals, flows, positions


@pytest.mark.parametrize("offset_s", [0, 10_800, -7_200])
@pytest.mark.parametrize("seed", range(40))
def test_timed_returns_match_the_fraction_oracle_on_random_multi_day_ledgers(
    seed: int, offset_s: int
) -> None:
    """Property: on seeded multi-day ledgers (flows at random instants, ties between a flow
    and an open, overnight positions, commissions on the opening deals, deal order shuffled,
    a server clock ahead of or behind UTC) every event day's return equals the exact
    Fraction oracle's ``prod(1 + P_k / B_k) - 1`` to 1e-9, and a day the oracle cannot
    measure (a deposit-only day) is NaN."""
    deals, flows, positions = _random_timed_ledger(seed, offset_s)
    random.Random(seed ^ 0x5EED).shuffle(deals)
    equity = _terminal(flows, positions)
    returns, meta = combine_mt5_deal_ledger(
        deals, account_equity=equity, account_balance=equity, server_utc_offset_s=offset_s
    )
    oracle = _timed_oracle(flows, positions)
    assert oracle
    for day, exact in oracle.items():
        got = float(returns.loc[pd.Timestamp(day)])
        if exact is None:
            assert math.isnan(got), f"{day} should have no return"
        else:
            assert got == pytest.approx(float(exact), abs=1e-9), f"{day}"
    for guard in ("dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard"):
        assert guard not in meta
    assert "flow_timing_day_level" not in meta  # every instant is resolvable here


def test_timing_keys_are_days_of_the_nav_index_in_the_same_unit() -> None:
    """The core looks a timed day up by the NAV index Timestamp, so a key of another unit or
    on another day would silently never be read: every key is in the index (D-02)."""
    from services.broker_dailies import _fold_mt5_deals
    from services.nav_twr import _flows_to_daily_usd, _union_flow_days

    for seed in range(8):
        deals, _flows, _positions = _random_timed_ledger(seed, 10_800)
        pnl, flow_list, timing = _fold_mt5_deals(deals, 10_800)
        index = _union_flow_days(pnl, _flows_to_daily_usd(flow_list)).index
        assert timing
        assert set(timing) <= set(index)
        assert all(key.unit == index.unit for key in timing)
        # Only flow days are timed: no instant is read for any other day (D-07).
        assert {key.date().isoformat() for key in timing} <= {f.utc_day_iso for f in flow_list}


# ---------------------------------------------------------------------------
# 164.6.6.2.3 D-16 (round 1 WR-02): the base a position opened on includes the P&L realized
# earlier the same day, and a flow of nothing changes nothing. Written from the reviewer's
# reproduction and from the two invariants, in dollars (USD floors), not from the formula.
# ---------------------------------------------------------------------------


def _wr02_ledger(flow: Fraction | None) -> tuple[list[dict], float]:
    """USD account. Day 0: 10,000 deposited 08:00. Day 1: a position opened 09:00 and closed
    09:30 for +1,000; a flow of ``flow`` at 10:00 (omitted when ``None``); a second position
    opened 11:00 and closed 12:00 for +1,000. Returns ``(deals, terminal equity)``."""
    d0, d1 = _D0, _D1
    deals = [_timed_flow_deal(_utc_ms(d0, 8), Fraction(10_000))]
    deals += _timed_position_deals(7001, _utc_ms(d1, 9), _utc_ms(d1, 9, 30), Fraction(1000))
    if flow is not None:
        deals.append(_timed_flow_deal(_utc_ms(d1, 10), flow))
    deals += _timed_position_deals(7002, _utc_ms(d1, 11), _utc_ms(d1, 12), Fraction(1000))
    equity = Fraction(10_000) + Fraction(2000) + (flow or Fraction(0))
    return deals, float(equity)


def _wr02_day_return(flow: Fraction | None) -> float:
    deals, equity = _wr02_ledger(flow)
    returns, meta = combine_mt5_deal_ledger(deals, account_equity=equity, account_balance=equity, server_utc_offset_s=0)
    assert not (set(meta) & {"dust_nav_guard", "negative_nav_guard", "pnl_dominated_guard"})
    return float(returns.loc[pd.Timestamp(_D1)])


def test_wr02_no_flow_day_is_twenty_percent() -> None:
    assert _wr02_day_return(None) == pytest.approx(0.2, abs=1e-12)


def test_wr02_a_zero_amount_balance_deal_is_a_no_op() -> None:
    """D-16 invariant. A BALANCE deal with a profit of 0 sits between the two trades: the day
    is still 20.0%, as with no deal at all. On D-03's base it was 21.0%."""
    assert _wr02_day_return(Fraction(0)) == pytest.approx(_wr02_day_return(None), abs=1e-12)
    assert _wr02_day_return(Fraction(0)) == pytest.approx(0.2, abs=1e-12)


def test_wr02_a_zero_amount_balance_deal_is_a_no_op_when_positions_overlap() -> None:
    """The same invariant where it bites: position A (09:00-13:00) is still open when B opens
    at 11:00, and a BALANCE deal of 0 sits at 10:00. The day is the plain 20.0%, not the 21.0%
    two split cohorts would give."""
    d0, d1 = _D0, _D1
    for with_zero in (False, True):
        deals = [_timed_flow_deal(_utc_ms(d0, 8), Fraction(10_000))]
        deals += _timed_position_deals(7301, _utc_ms(d1, 9), _utc_ms(d1, 13), Fraction(1000))
        if with_zero:
            deals.append(_timed_flow_deal(_utc_ms(d1, 10), Fraction(0)))
        deals += _timed_position_deals(7302, _utc_ms(d1, 11), _utc_ms(d1, 14), Fraction(1000))
        returns, _meta = combine_mt5_deal_ledger(
            deals, account_equity=12_000.0, account_balance=12_000.0, server_utc_offset_s=0
        )
        assert float(returns.loc[pd.Timestamp(d1)]) == pytest.approx(0.2, abs=1e-12), with_zero


def test_wr02_a_one_dollar_deposit_is_about_twenty_percent() -> None:
    """The reviewer's reproduction: a $1 deposit between the two trades. Exact figure:
    1.1 x (1 + 1000 / 11001) - 1."""
    assert _wr02_day_return(Fraction(1)) == pytest.approx(0.2, abs=1e-5)
    assert _wr02_day_return(Fraction(1)) == pytest.approx(
        1.1 * (1.0 + 1000.0 / 11_001.0) - 1.0, abs=1e-12
    )


@pytest.mark.parametrize("flow", [Fraction(100), Fraction(1), Fraction("0.001"), Fraction("-0.001"), Fraction(-1)])
def test_wr02_return_is_continuous_as_the_deposit_tends_to_zero(flow: Fraction) -> None:
    """D-16 invariant: |r(F) - r(0)| stays under 1e-5 per dollar of flow (true slope 9.1e-6)."""
    assert abs(_wr02_day_return(flow) - 0.2) <= 1e-5 * abs(float(flow)) + 1e-11


def test_fold_records_the_instant_each_cash_effect_was_booked() -> None:
    """D-16: the DayTiming the fold builds carries, per P&L entry, the instant of the deal that
    booked the cash: the opening deal's own instant for its (zero) cost, the closing deal's for
    the profit, and for a position carried overnight the instant its closing deal booked on the
    flow day (open None)."""
    from services.broker_dailies import _fold_mt5_deals

    d0, d1 = _D0, _D1
    carried_open, carried_close = _utc_ms(d0, 12), _utc_ms(d1, 7)
    deals = [_timed_flow_deal(_utc_ms(d0, 8), Fraction(10_000))]
    deals += _timed_position_deals(7100, carried_open, carried_close, Fraction(50))
    deals.append(_timed_flow_deal(_utc_ms(d1, 10), Fraction(500)))
    deals += _timed_position_deals(7101, _utc_ms(d1, 11), _utc_ms(d1, 12), Fraction(70))
    _pnl, _flows, timing = _fold_mt5_deals(deals, 0)
    record = timing[pd.Timestamp(d1).as_unit("us")]
    assert sorted(record.pnl, key=lambda e: e[2]) == [
        (None, 50.0, carried_close),
        (_utc_ms(d1, 11), 0.0, _utc_ms(d1, 11)),
        (_utc_ms(d1, 11), 70.0, _utc_ms(d1, 12)),
    ]


def test_overnight_cash_booked_before_a_later_open_is_in_that_opens_base() -> None:
    """D-16 end to end through the fold: a position carried from day 0 books +300 at 07:00 on
    day 1 (cohort 0 on the start-of-day base 10,000), a deposit of 1,000 lands at 10:00, and a
    position opened 11:00 earns +110. That position opened on 10,000 + 300 + 1,000 = 11,300,
    so the day is (1 + 300/10000)(1 + 110/11300) - 1."""
    d0, d1 = _D0, _D1
    deals = [_timed_flow_deal(_utc_ms(d0, 8), Fraction(10_000))]
    deals += _timed_position_deals(7200, _utc_ms(d0, 12), _utc_ms(d1, 7), Fraction(300))
    deals.append(_timed_flow_deal(_utc_ms(d1, 10), Fraction(1000)))
    deals += _timed_position_deals(7201, _utc_ms(d1, 11), _utc_ms(d1, 12), Fraction(110))
    equity = float(Fraction(10_000 + 300 + 1000 + 110))
    returns, _meta = combine_mt5_deal_ledger(deals, account_equity=equity, account_balance=equity, server_utc_offset_s=0)
    assert float(returns.loc[pd.Timestamp(d1)]) == pytest.approx(
        1.03 * (1.0 + 110.0 / 11_300.0) - 1.0, abs=1e-12
    )


# ---------------------------------------------------------------------------
# 164.6.6.2.3 plan 05 Task 2: the levels path reads the same timing; an unresolvable open
# or an untrustworthy time sends THAT flow day to the day-level rule by name (D-07) and
# never fails a derive that succeeds today.
# ---------------------------------------------------------------------------

_D0 = _MM2X_FIRST_DEPOSIT
_D1 = _D0 + timedelta(1)


def _combine(deals, equity: float, *, offset_s: int = 0):
    return combine_mt5_deal_ledger(
        deals, account_equity=equity, account_balance=equity, floors=_BTC,
        server_utc_offset_s=offset_s,
    )


def _levels(deals, equity: float, *, offset_s: int = 0):
    return reconstruct_mt5_nav_levels(
        deals, account_equity=equity, account_balance=equity, floors=_BTC,
        server_utc_offset_s=offset_s,
    )


def _assert_deposit_day_at_day_level(returns, meta, day: date = _D1) -> None:
    """The flow day took the day-level rule: the flow counts at the end of the day, so
    0.011 of P&L is measured on the 0.1 start-of-day base (0.011 / 0.1 = 0.11), and the
    strategy says so (an annotation, never a warning)."""
    assert float(returns.loc[pd.Timestamp(day)]) == pytest.approx(0.11, abs=1e-12)
    assert meta["flow_timing_day_level"] is True
    assert meta["flow_timing_day_level_days"] == 1
    assert meta["computation_status_hint"] == "complete"


def _unresolvable_open_deals(case: str) -> list[dict]:
    """The MM-2x timed ledger with ONE defect in the position that closes on the deposit day."""
    deals, _flows, _positions = _mm2x_timed_deals()
    opening, closing = deals[2], deals[3]
    assert opening["entry"] == 0 and closing["entry"] == 1
    if case == "buy-deal-without-position-id":
        closing.pop("position_id")
    elif case == "unknown-entry-code":
        closing["entry"] = 9
    elif case == "position-in-deal-missing-from-the-ledger":
        deals.remove(opening)
    elif case == "open-instant-after-the-closing-deal":
        late = _stamped({**opening}, _utc_ms(_D1, 16), 0)
        deals[2] = late
    else:  # pragma: no cover - a typo in the parametrization must not pass silently
        raise AssertionError(case)
    return deals


_UNRESOLVABLE_CASES = [
    "buy-deal-without-position-id",
    "unknown-entry-code",
    "position-in-deal-missing-from-the-ledger",
    "open-instant-after-the-closing-deal",
]


@pytest.mark.parametrize("case", _UNRESOLVABLE_CASES)
def test_an_unresolvable_open_sends_the_whole_flow_day_to_the_day_level_rule(case: str) -> None:
    """D-07 (T-164.6.6.2.3-12): a trading deal on a flow day whose position open cannot be
    resolved leaves NO ``DayTiming`` for that day: it is measured at day level and the
    annotation says so. No instant is invented (a default would give 0.01, the cohort
    answer, and would hide that the open is unknown)."""
    deals = _unresolvable_open_deals(case)
    equity = float(Fraction("1.111"))
    returns, meta = _combine(deals, equity)
    _assert_deposit_day_at_day_level(returns, meta)
    # One reconstruction, one set of facts: the levels path says the same thing.
    _nav, nav_meta = _levels(deals, equity)
    assert nav_meta == meta


def _anomalous(row: dict, how: str) -> dict:
    """``row`` with a ``time_msc`` that disagrees with its own ``time`` or is not a
    millisecond count."""
    if how == "removed":
        return {k: v for k, v in row.items() if k != "time_msc"}
    bad = {
        "other-second": row["time_msc"] + 5_000,
        "fractional": float(row["time_msc"]) + 0.5,
        "bool": True,
        "text": "not-a-number",
    }[how]
    return {**row, "time_msc": bad}


@pytest.mark.parametrize("how", ["other-second", "fractional", "bool", "text"])
@pytest.mark.parametrize("victim", ["the-flow-deal", "the-closing-deal", "the-same-day-in-deal"])
def test_a_time_anomaly_on_a_flow_day_degrades_that_day_and_never_raises(
    victim: str, how: str
) -> None:
    """D-07 (T-164.6.6.2.3-14): an inconsistent or non-integral ``time_msc`` on a deal the
    flow day needs (the deposit, the deal that closes the position, or the IN deal that
    opened it) makes the day unresolvable. The derive still succeeds, the day takes the
    day-level rule, and the annotation names it."""
    deals, _flows, _positions = _mm2x_timed_deals()
    index = {"the-flow-deal": 1, "the-same-day-in-deal": 2, "the-closing-deal": 3}[victim]
    assert deals[1]["type"] == 2  # the day-1 deposit
    deals[index] = _anomalous(deals[index], how)
    returns, meta = _combine(deals, float(Fraction("1.111")))
    _assert_deposit_day_at_day_level(returns, meta)
    _nav, nav_meta = _levels(deals, float(Fraction("1.111")))
    assert nav_meta == meta


def _quiet_day_ledger(anomaly: str | None) -> list[dict]:  # None = well-formed, "removed" = key dropped
    """The MM-2x timed ledger plus two QUIET (flow-free) days that carry timing anomalies:
    day 2 holds position X opened at 10:00 (its IN deal is the anomaly) and closed on day 3
    at 11:00, day 3 holds a 09:00 withdrawal; day 2 also holds position Y opened and closed
    in the day. X is carried overnight onto the day-3 flow day."""
    deals, _flows, _positions = _mm2x_timed_deals()
    d2, d3 = _D0 + timedelta(2), _D0 + timedelta(3)
    x_in, x_out = _timed_position_deals(2001, _utc_ms(d2, 10), _utc_ms(d3, 11), Fraction("0.004"))
    y_in, y_out = _timed_position_deals(2002, _utc_ms(d2, 11), _utc_ms(d2, 12), Fraction("0.002"))
    if anomaly is not None:
        x_in = _anomalous(x_in, anomaly)
        y_in = _anomalous(y_in, anomaly)
        y_out = _anomalous(y_out, anomaly)
    deals += [x_in, x_out, y_in, y_out, _timed_flow_deal(_utc_ms(d3, 9), Fraction("-0.3"))]
    return deals


@pytest.mark.parametrize("how", ["other-second", "fractional", "bool", "text"])
def test_a_time_anomaly_off_a_flow_day_leaves_the_derive_exactly_as_it_is_today(how: str) -> None:
    """D-07 (T-164.6.6.2.3-14): instants are read ONLY for flow-day deals, so a malformed
    ``time_msc`` on a quiet day (here the IN deal of a position carried onto a flow day, and
    both deals of a position that never touches one) changes nothing: returns, meta and
    levels equal the same ledger with that ``time_msc`` removed."""
    equity = float(Fraction("1.111") + Fraction("0.004") + Fraction("0.002") - Fraction("0.3"))
    anomalous = _quiet_day_ledger(how)
    # Two references: the same ledger with the offending time_msc REMOVED, and with it
    # well-formed. The derive must not be able to tell any of the three apart.
    for reference in (_quiet_day_ledger("removed"), _quiet_day_ledger(None)):
        r_bad, m_bad = _combine(anomalous, equity)
        r_ref, m_ref = _combine(reference, equity)
        pd.testing.assert_series_equal(r_bad, r_ref)
        assert m_bad == m_ref
        n_bad, nm_bad = _levels(anomalous, equity)
        n_ref, nm_ref = _levels(reference, equity)
        pd.testing.assert_series_equal(n_bad, n_ref)
        assert nm_bad == nm_ref
    assert "flow_timing_day_level" not in m_bad  # the flow days were still measured on time


def test_a_commission_without_a_position_is_placed_by_its_own_instant() -> None:
    """A commission-family deal (type 7) carries no position: on a flow day it is placed by
    its own instant and does not push the day to the day-level rule. At 10:00 (after the
    09:00 deposit) it is cohort 1, at 08:00 cohort 0. The oracle takes it as an event whose
    open and close are its own instant."""
    for hour in (10, 8):
        deals, flows, positions = _mm2x_timed_deals()
        fee_ms = _utc_ms(_D1, hour, 30)
        fee = Fraction("-0.001")
        deals.append(_stamped({"type": 7, "profit": float(fee), **_ZERO_COSTS}, fee_ms, 0))
        positions = [*positions, (fee_ms, fee_ms, fee)]
        equity = _terminal(flows, positions)
        returns, meta = _combine(deals, equity)
        oracle = _timed_oracle(flows, positions)
        got = float(returns.loc[pd.Timestamp(_D1)])
        assert got == pytest.approx(float(oracle[_D1]), abs=1e-12)
        # Hand figures. 10:30: the fee joins the position in cohort 1, so (0.011 - 0.001) on
        # 1.1 = 1/110. 08:30: the fee is cohort 0 (-0.001 on 0.1 = -1%), the position is
        # cohort 1 and, D-16, opened on the capital that included the fee already booked at
        # 08:30: 0.1 + 1.0 - 0.001 = 1.099, so it earns 0.011 / 1.099 and they link:
        # 0.99 * (1 + 0.011 / 1.099) - 1 = 0.99 * 1110/1099 - 1 = -1/10990. (On D-03's
        # flows-only base 1.1 this was 0.99 * 1.01 - 1 = -0.0001.)
        hand = (
            Fraction(1, 110)
            if hour == 10
            else Fraction(99, 100) * Fraction(1110, 1099) - 1
        )
        if hour == 8:
            assert hand == Fraction(-1, 10990)
        assert got == pytest.approx(float(hand), abs=1e-12)
        assert "flow_timing_day_level" not in meta


def test_levels_and_returns_meta_agree_on_the_timed_ledger_and_levels_ignore_timing() -> None:
    """T-164.6.6.2.3-13: the levels path takes its meta from a second core call, which must
    receive the same ``timing`` and ``full_history`` as the returns path, or the two disagree
    about the flow-timing facts and about day 0. And the LEVELS themselves never depend on the
    return convention: they equal a plain forward Fraction roll of the events."""
    deals, flows, positions = _mm2x_timed_deals()
    equity = _terminal(flows, positions)
    _r, ret_meta = _combine(deals, equity)
    nav, nav_meta = _levels(deals, equity)
    assert nav_meta == ret_meta
    assert ret_meta["flow_timing_timed_days"] >= 1 and "flow_timing_day_level" not in ret_meta
    # Day-end NAV by hand: day 0 = 0.1, day 1 = 0.1 + 1.0 + 0.011 = 1.111.
    assert float(nav.loc[pd.Timestamp(_D0)]) == pytest.approx(0.1, abs=1e-12)
    assert float(nav.loc[pd.Timestamp(_D1)]) == pytest.approx(1.111, abs=1e-12)

    # The same account without any time of day (no time_msc, no position ids) takes the
    # day-level rule on the trading day: a different return, the SAME levels.
    stripped = [
        {k: v for k, v in d.items() if k not in ("time_msc", "position_id")} for d in deals
    ]
    nav_plain, _m = _levels(stripped, equity)
    pd.testing.assert_series_equal(nav, nav_plain)
    r_plain, plain_meta = _combine(stripped, equity)
    assert float(r_plain.loc[pd.Timestamp(_D1)]) == pytest.approx(0.11, abs=1e-12)
    assert plain_meta["flow_timing_day_level"] is True


def test_mt5_day_pnl_is_untouched_by_the_timing() -> None:
    """``mt5_day_pnl`` reads the day P&L from the same fold and ignores the timing: per day
    the trading deals' cash on the union of trading days and flow days, a flow-only day
    being zero (day 0 here, then 0.011 on the deposit day)."""
    from services.broker_dailies import mt5_day_pnl

    deals, _flows, _positions = _mm2x_timed_deals()
    pnl = mt5_day_pnl(deals, server_utc_offset_s=0)
    assert [float(v) for v in pnl.to_numpy()] == pytest.approx([0.0, 0.011], abs=1e-15)


# ---------------------------------------------------------------------------
# Phase 175 (MT5OFFSET) SC-2 for the fold: a DST rule buckets every deal with the offset in
# force on ITS OWN date, and no single integer can.
# ---------------------------------------------------------------------------
def _straddling_the_us_fall_change_deals() -> list[dict]:
    """BROKER WALL times (the epoch is the wall clock written as if it were UTC).

    The broker follows the US rule: UTC+3 while US daylight time runs, UTC+2 from the US change
    at 2025-11-02T06:00Z. By hand:
      deposit 10_000 at wall 2025-10-01 12:00 (UTC+3)   -> true 2025-10-01T09:00Z, day 2025-10-01
      +100 close   at wall 2025-10-31 02:30 (UTC+3)     -> true 2025-10-30T23:30Z, day 2025-10-30
      +200 close   at wall 2025-11-04 02:30 (UTC+2)     -> true 2025-11-04T00:30Z, day 2025-11-04
    """
    zero = {"swap": 0.0, "commission": 0.0, "fee": 0.0}

    def _wall(y: int, mo: int, d: int, h: int, mi: int = 0) -> int:
        return int(datetime(y, mo, d, h, mi, tzinfo=timezone.utc).timestamp())

    return [
        {"type": 2, "profit": 10_000.0, "time": _wall(2025, 10, 1, 12), **zero},
        {"type": 1, "entry": 1, "profit": 100.0, "time": _wall(2025, 10, 31, 2, 30), **zero},
        {"type": 1, "entry": 1, "profit": 200.0, "time": _wall(2025, 11, 4, 2, 30), **zero},
    ]


def _trading_days(pnl: pd.Series) -> dict[str, float]:
    return {ts.strftime("%Y-%m-%d"): float(v) for ts, v in pnl.items() if float(v) != 0.0}


def test_a_ledger_straddling_the_us_fall_change_is_bucketed_per_deal_by_the_rule_and_by_no_integer() -> None:
    """Phase 175 SC-2. One integer cannot describe a broker whose clock changes: each deal is
    converted with the offset in force on its own date. Equity = balance = 10_300 = 10_000 + 100
    + 200, so the reconstruction rolls back from 10_300 with no floating wedge.

    Hand arithmetic under the rule: NAV 10_000 (2025-10-01), 10_100 after the +100 on 2025-10-30,
    10_300 after the +200 on 2025-11-04. Returns: 100 / 10_000 = 0.01 on 2025-10-30 and
    200 / 10_100 on 2025-11-04. The same ledger under a fixed UTC+3 files the +200 on 2025-11-03
    (23:30Z), under a fixed UTC+2 it files the +100 on 2025-10-31 (00:30Z): the rule's two trading
    days equal neither integer's."""
    from services.broker_dailies import mt5_day_pnl
    from services.mt5_server_clock import server_clock_for_rule

    deals = _straddling_the_us_fall_change_deals()
    rule = server_clock_for_rule("us")

    # mt5_day_pnl: the rule's trading days, and the two fixed integers' days.
    assert _trading_days(mt5_day_pnl(deals, server_utc_offset_s=rule)) == {
        "2025-10-30": 100.0,
        "2025-11-04": 200.0,
    }
    assert _trading_days(mt5_day_pnl(deals, server_utc_offset_s=10800)) == {
        "2025-10-30": 100.0,
        "2025-11-03": 200.0,
    }
    assert _trading_days(mt5_day_pnl(deals, server_utc_offset_s=7200)) == {
        "2025-10-31": 100.0,
        "2025-11-04": 200.0,
    }

    # reconstruct_mt5_nav_levels: the event days only, at the hand-derived levels.
    levels, _meta = reconstruct_mt5_nav_levels(
        deals, account_equity=10_300.0, account_balance=10_300.0, server_utc_offset_s=rule
    )
    assert {ts.strftime("%Y-%m-%d"): float(v) for ts, v in levels.items()} == pytest.approx(
        {"2025-10-01": 10_000.0, "2025-10-30": 10_100.0, "2025-11-04": 10_300.0}, abs=1e-9
    )
    fixed_3_levels, _m3 = reconstruct_mt5_nav_levels(
        deals, account_equity=10_300.0, account_balance=10_300.0, server_utc_offset_s=10800
    )
    assert "2025-11-04" not in {ts.strftime("%Y-%m-%d") for ts in fixed_3_levels.index}
    fixed_2_levels, _m2 = reconstruct_mt5_nav_levels(
        deals, account_equity=10_300.0, account_balance=10_300.0, server_utc_offset_s=7200
    )
    assert "2025-10-30" not in {ts.strftime("%Y-%m-%d") for ts in fixed_2_levels.index}

    # combine_mt5_deal_ledger: the return lands on the rule's day, not on a fixed integer's.
    returns, _rmeta = combine_mt5_deal_ledger(
        deals, account_equity=10_300.0, account_balance=10_300.0, server_utc_offset_s=rule
    )
    assert float(returns.loc[pd.Timestamp("2025-10-30")]) == pytest.approx(0.01, abs=1e-12)
    assert float(returns.loc[pd.Timestamp("2025-11-04")]) == pytest.approx(
        200.0 / 10_100.0, abs=1e-12
    )
    on_fixed_3, _m = combine_mt5_deal_ledger(
        deals, account_equity=10_300.0, account_balance=10_300.0, server_utc_offset_s=10800
    )
    # The series ends on the last event day, so under UTC+3 there is no 2025-11-04 row at all.
    assert pd.Timestamp("2025-11-04") not in on_fixed_3.index
    assert float(on_fixed_3.loc[pd.Timestamp("2025-11-03")]) != 0.0
    on_fixed_2, _m = combine_mt5_deal_ledger(
        deals, account_equity=10_300.0, account_balance=10_300.0, server_utc_offset_s=7200
    )
    assert float(on_fixed_2.loc[pd.Timestamp("2025-10-30")]) == 0.0
    assert float(on_fixed_2.loc[pd.Timestamp("2025-10-31")]) != 0.0


@pytest.mark.parametrize(
    "call",
    [
        pytest.param(
            lambda deals: combine_mt5_deal_ledger(deals, account_equity=1.0, account_balance=1.0),
            id="combine_mt5_deal_ledger",
        ),
        pytest.param(
            lambda deals: reconstruct_mt5_nav_levels(deals, account_equity=1.0, account_balance=1.0),
            id="reconstruct_mt5_nav_levels",
        ),
        pytest.param(lambda deals: mt5_day_pnl(deals), id="mt5_day_pnl"),
    ],
)
def test_a_missing_broker_clock_is_a_type_error_not_a_utc_default(call) -> None:
    """Review 175 round 1 WR-02 / SFH-03 (D-01 removes the silent "0" default). A caller that
    leaves the broker clock out must fail at the call site, not bucket every MT5 deal as if the
    broker ran on UTC (2-3 hours off, no fault raised). Reddens if any of the three public folds
    regains a default."""
    with pytest.raises(TypeError, match="server_utc_offset_s"):
        call(_canonical_deposit_deals())
