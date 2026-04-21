"""Phase 09 / Task 1 TDD tests for reconstruct_symbol_returns.

Tests the per-symbol daily-return reconstruction helper added to
analytics-service/services/equity_reconstruction.py for LIVE-01.

All tests are plain `def` (not async) per finding f1.
"""

import pandas as pd
import pytest
from services.equity_reconstruction import reconstruct_symbol_returns


def test_reconstruct_symbol_returns_golden_5_days():
    """Golden fixture: 5 consecutive days with BTC values → 4-entry returns series."""
    snapshots = [
        {"asof": "2026-01-01", "breakdown": {"BTC": 100.0, "ETH": 50.0}},
        {"asof": "2026-01-02", "breakdown": {"BTC": 110.0, "ETH": 50.0}},
        {"asof": "2026-01-03", "breakdown": {"BTC": 121.0, "ETH": 50.0}},
        {"asof": "2026-01-04", "breakdown": {"BTC": 115.0, "ETH": 50.0}},
        {"asof": "2026-01-05", "breakdown": {"BTC": 120.0, "ETH": 50.0}},
    ]
    result = reconstruct_symbol_returns(snapshots, "BTC")
    assert result is not None
    assert len(result) == 4
    # 110/100-1=0.10, 121/110-1=0.10, 115/121-1=-0.0496..., 120/115-1=0.0434...
    assert result.iloc[0] == pytest.approx(0.10, abs=1e-6)
    assert result.iloc[1] == pytest.approx(0.10, abs=1e-6)
    assert result.iloc[2] == pytest.approx(-0.049586, abs=1e-4)
    assert result.iloc[3] == pytest.approx(0.043478, abs=1e-4)


def test_reconstruct_symbol_returns_drops_absent_days():
    """Days 1-2 BTC absent → drop; Days 3-5 BTC present → 2 returns."""
    snapshots = [
        {"asof": "2026-01-01", "breakdown": {"ETH": 50.0}},
        {"asof": "2026-01-02", "breakdown": {"ETH": 50.0}},
        {"asof": "2026-01-03", "breakdown": {"BTC": 100.0, "ETH": 50.0}},
        {"asof": "2026-01-04", "breakdown": {"BTC": 110.0, "ETH": 50.0}},
        {"asof": "2026-01-05", "breakdown": {"BTC": 105.0, "ETH": 50.0}},
    ]
    result = reconstruct_symbol_returns(snapshots, "BTC")
    assert result is not None
    assert len(result) == 2
    assert result.iloc[0] == pytest.approx(0.10, abs=1e-6)
    assert result.iloc[1] == pytest.approx(-0.0454545, abs=1e-4)


def test_reconstruct_symbol_returns_zero_treated_as_missing():
    """value=0 treated as missing (consistent with migration 073's NULLIF semantics)."""
    snapshots = [
        {"asof": "2026-01-01", "breakdown": {"BTC": 0.0}},
        {"asof": "2026-01-02", "breakdown": {"BTC": 100.0}},
        {"asof": "2026-01-03", "breakdown": {"BTC": 110.0}},
    ]
    result = reconstruct_symbol_returns(snapshots, "BTC")
    assert result is not None
    assert len(result) == 1
    assert result.iloc[0] == pytest.approx(0.10, abs=1e-6)


def test_reconstruct_symbol_returns_insufficient_data_returns_none():
    """Edge cases: empty, single snapshot, symbol absent → returns None."""
    assert reconstruct_symbol_returns([], "BTC") is None
    assert reconstruct_symbol_returns(
        [{"asof": "2026-01-01", "breakdown": {"BTC": 100.0}}], "BTC"
    ) is None
    # Symbol absent entirely
    assert reconstruct_symbol_returns(
        [{"asof": "2026-01-01", "breakdown": {"ETH": 50.0}}], "BTC"
    ) is None
