import pytest
import pandas as pd
import numpy as np
import json
from pathlib import Path


FIXTURES_DIR = Path(__file__).parent / "fixtures"


@pytest.fixture
def golden_returns() -> pd.Series:
    """500 trading days of synthetic returns with known statistical properties.

    Constructed so expected metrics can be verified analytically:
    - Mean daily return ~0.05% (annualized ~13%)
    - Std daily return ~1.5% (annualized vol ~24%)
    - Contains a drawdown period (days 200-250) and a recovery
    - Mix of positive and negative days (~55% positive)
    """
    np.random.seed(42)
    n_days = 500
    dates = pd.bdate_range("2023-01-01", periods=n_days)

    # Normal returns with slight positive drift
    base_returns = np.random.normal(0.0005, 0.015, n_days)

    # Inject a drawdown period (days 200-250)
    base_returns[200:230] = np.random.normal(-0.015, 0.02, 30)
    base_returns[230:250] = np.random.normal(0.005, 0.01, 20)

    return pd.Series(base_returns, index=dates, name="returns")


@pytest.fixture
def zero_vol_returns() -> pd.Series:
    """Returns with zero volatility — should produce Inf Sharpe."""
    dates = pd.bdate_range("2023-01-01", periods=100)
    return pd.Series(0.001, index=dates, name="returns")


@pytest.fixture
def single_trade_returns() -> pd.Series:
    """Minimum viable: 2 days of returns."""
    dates = pd.bdate_range("2023-01-01", periods=2)
    return pd.Series([0.05, -0.02], index=dates, name="returns")


@pytest.fixture
def empty_returns() -> pd.Series:
    """Empty returns series."""
    return pd.Series(dtype=float, name="returns")


@pytest.fixture
def benchmark_returns() -> pd.Series:
    """BTC-like benchmark returns aligned with golden_returns dates."""
    np.random.seed(123)
    dates = pd.bdate_range("2023-01-01", periods=500)
    return pd.Series(
        np.random.normal(0.0003, 0.025, 500),
        index=dates,
        name="BTC",
    )


@pytest.fixture
def sample_trades() -> list[dict]:
    """Realistic trade records for testing transforms."""
    return [
        {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16500.00", "quantity": "0.1", "fee": "1.65", "order_type": "market"},
        {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16600.00", "quantity": "0.1", "fee": "1.66", "order_type": "market"},
        {"timestamp": "2023-01-03T09:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16550.00", "quantity": "0.2", "fee": "3.31", "order_type": "limit"},
        {"timestamp": "2023-01-03T15:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16400.00", "quantity": "0.2", "fee": "3.28", "order_type": "market"},
        {"timestamp": "2023-01-04T11:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16450.00", "quantity": "0.15", "fee": "2.47", "order_type": "limit"},
        {"timestamp": "2023-01-04T16:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16700.00", "quantity": "0.15", "fee": "2.51", "order_type": "market"},
    ]
