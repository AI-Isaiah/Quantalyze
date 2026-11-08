"""194 D-11/D-15: the Python twins of TS `recordClears` / `gateAnnualized` and the
unknown-class blend rule. Expected values are written from the rule, never by calling
the function under test to produce them."""

import pandas as pd
import pytest

from services.metrics import (
    ONE_YEAR_DAYS,
    annualization_state,
    blend_gate_crypto,
    blend_periods_per_year,
    record_clears,
    sharpe_lift_gate,
)


def test_one_year_constant():
    assert ONE_YEAR_DAYS == 365


@pytest.mark.parametrize(
    "span,obs,crypto,expected",
    [
        (89, None, True, False),   # crypto bound is strict at 90 calendar days
        (90, None, True, True),
        (200, 59, False, False),   # non-crypto counts observations, not days
        (84, 60, False, True),     # 60 weekday obs is 84 days: the days do not decide
        (89, None, False, False),  # interim fallback to the span (A-194-D15-02)
        (90, None, False, True),
        (None, None, True, None),  # the deciding input is unknown
        (None, None, False, None),
        (None, 70, False, True),   # non-crypto with a count never needs the span
        (500, 10, True, True),     # crypto ignores the count
    ],
)
def test_record_clears(span, obs, crypto, expected):
    assert record_clears(span, obs, crypto) is expected


def test_blend_gate_crypto_unknown_leg_counts_as_crypto():
    assert blend_gate_crypto(["traditional", None]) is True
    assert blend_gate_crypto(["crypto", "traditional"]) is True
    assert blend_gate_crypto(["traditional", "traditional"]) is False
    assert blend_gate_crypto([]) is False


def test_blend_clock_asymmetry_is_pinned_not_hidden():
    """The stored RISK clock still reads an unknown leg as 252, while the D-15 gate reads
    the same book as crypto. Moving the clock would move stored figures outside D-15's
    scope; this pin makes the two-rule asymmetry deliberate and visible
    ([194-ENGINE-CONSTANTS])."""
    assert blend_periods_per_year(["traditional", None]) == 252
    assert blend_gate_crypto(["traditional", None]) is True


def test_book_with_unknown_leg_and_70_daily_obs_fails_the_crypto_bound():
    obs, span = 70, 69  # 70 daily observations span 69 calendar days
    as_gated = record_clears(span, obs, blend_gate_crypto(["traditional", None]))
    as_plain_traditional = record_clears(span, obs, False)
    assert as_gated is False
    assert as_plain_traditional is True  # the verdict the unknown-to-traditional reading would give


@pytest.mark.parametrize(
    "a,b,window,expected",
    [
        (True, True, 364, "short"),
        (True, True, 365, "full"),
        (False, True, 400, "withheld"),
        (True, False, 400, "withheld"),
        (False, None, 400, "withheld"),  # one failed record decides, whatever the other is
        (True, None, 400, "null"),
        (None, True, 400, "null"),
        (True, True, None, "null"),
    ],
)
def test_annualization_state(a, b, window, expected):
    assert annualization_state(a, b, window) == expected


def _idx(n, start="2025-01-01"):
    return pd.date_range(start, periods=n, freq="D")


def test_sharpe_lift_gate_names_the_shorter_failing_record_when_both_fail():
    cand, book = _idx(50), _idx(70)
    span, state, failing = sharpe_lift_gate(cand, book, cand, True, True)
    assert (span, state) == (50, "withheld")
    assert failing == {"span_days": 50, "observations": 50, "crypto": True}


def test_sharpe_lift_gate_failing_record_none_unless_withheld():
    cand = _idx(400)
    span, state, failing = sharpe_lift_gate(cand, cand, cand[-60:], True, True)
    assert (span, state, failing) == (60, "short", None)


# 194 D-20 (founder, 2026-11-08, "Count returns"): a record's length is the days its
# returns COVER, first to last both counted, so N daily returns are N days. Written from
# the rule (a date_range of N daily dates), never from the function under test.
@pytest.mark.parametrize(
    "n,state",
    [(364, "short"), (365, "full"), (366, "full")],
)
def test_one_year_of_daily_returns_is_a_full_year(n, state):
    idx = _idx(n)
    span, got, failing = sharpe_lift_gate(idx, idx, idx, True, True)
    assert span == n
    assert (got, failing) == (state, None)


@pytest.mark.parametrize("n,state", [(89, "withheld"), (90, "short")])
def test_ninety_daily_crypto_returns_clear_the_record_minimum(n, state):
    idx = _idx(n)
    span, got, failing = sharpe_lift_gate(idx, idx, idx, True, True)
    assert (span, got) == (n, state)
    assert (failing is None) == (state != "withheld")
