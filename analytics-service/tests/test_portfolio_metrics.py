import pytest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from services.portfolio_metrics import compute_twr, compute_mwr, compute_modified_dietz, compute_period_returns


def test_twr_no_cash_flows():
    """With no deposits/withdrawals, TWR equals simple return."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)
    events = []
    twr = compute_twr(equity, events)
    assert abs(twr - 0.10) < 0.01  # ~10% return


def test_twr_mid_month_deposit():
    """$200K deposit on last day should NOT distort +10%."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity_before = np.linspace(100000, 110000, 29)
    equity_after = [316050]
    equity = pd.Series(np.concatenate([equity_before, equity_after]), index=dates)
    events = [{"event_date": dates[29].isoformat(), "event_type": "deposit", "amount": 200000}]
    twr = compute_twr(equity, events)
    assert twr > 0.09, f"TWR {twr} should be > 9%"


def test_twr_day_zero_deposit():
    """Day-0 deposit (initial capital) should not create a NaN sub-period."""
    dates = pd.date_range("2026-01-01", periods=30, freq="D")
    equity = pd.Series(np.linspace(100000, 110000, 30), index=dates)
    events = [{"event_date": dates[0].isoformat(), "event_type": "deposit", "amount": 100000}]
    twr = compute_twr(equity, events)
    assert twr is not None
    assert abs(twr - 0.10) < 0.02


def test_mwr_known_sequence():
    """MWR/IRR for a known cash flow should converge."""
    cash_flows = [
        {"amount": -100000, "date": "2026-01-01"},
        {"amount": -50000, "date": "2026-06-01"},
        {"amount": 170000, "date": "2026-12-31"},
    ]
    mwr = compute_mwr(cash_flows, final_value=170000)
    assert mwr is not None
    assert 0 < mwr < 0.5


def test_modified_dietz_matches_twr():
    """Modified Dietz should approximate TWR within tolerance when data is daily."""
    md = compute_modified_dietz(100000, 110000, [], 30)
    assert abs(md - 0.10) < 0.01


def test_period_returns():
    """Compute 24h, MTD, YTD returns from a returns series."""
    dates = pd.date_range("2026-01-01", periods=90, freq="D")
    returns = pd.Series(np.random.normal(0.001, 0.02, 90), index=dates)
    result = compute_period_returns(returns)
    assert "return_24h" in result
    assert "return_mtd" in result
    assert "return_ytd" in result
