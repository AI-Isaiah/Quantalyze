import pytest
import pandas as pd
import numpy as np
from services.transforms import trades_to_daily_returns, downsample_series, cap_data_points


class TestTradesToDailyReturns:
    def test_basic_trades(self, sample_trades):
        returns = trades_to_daily_returns(sample_trades)
        assert isinstance(returns, pd.Series)
        assert len(returns) > 0
        # Should have one return per trading day
        assert len(returns) == 3  # 3 unique dates

    def test_empty_trades(self):
        returns = trades_to_daily_returns([])
        assert isinstance(returns, pd.Series)
        assert len(returns) == 0

    def test_single_day_trades(self):
        trades = [
            {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "16500", "quantity": "0.1", "fee": "0", "order_type": "market"},
            {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "16600", "quantity": "0.1", "fee": "0", "order_type": "market"},
        ]
        returns = trades_to_daily_returns(trades)
        assert len(returns) == 1

    def test_returns_are_finite(self, sample_trades):
        returns = trades_to_daily_returns(sample_trades)
        for val in returns.values:
            assert np.isfinite(val), f"Non-finite return: {val}"

    def test_fees_reduce_returns(self):
        """Same trades with and without fees — fees should reduce net return."""
        no_fee_trades = [
            {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "100", "quantity": "1", "fee": "0", "order_type": "market"},
            {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "110", "quantity": "1", "fee": "0", "order_type": "market"},
        ]
        fee_trades = [
            {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "100", "quantity": "1", "fee": "5", "order_type": "market"},
            {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "110", "quantity": "1", "fee": "5", "order_type": "market"},
        ]
        r_no_fee = trades_to_daily_returns(no_fee_trades)
        r_fee = trades_to_daily_returns(fee_trades)
        # The return with fees should be less
        assert float(r_fee.iloc[0]) < float(r_no_fee.iloc[0])


class TestDownsampleSeries:
    def test_already_small(self):
        series = [{"date": "2023-01-01", "value": 1.0}]
        result = downsample_series(series, 90)
        assert result == [1.0]

    def test_downsample_to_target(self):
        series = [{"date": f"2023-01-{i:02d}", "value": float(i)} for i in range(1, 201)]
        result = downsample_series(series, 90)
        assert len(result) == 90

    def test_preserves_values(self):
        series = [{"date": "d1", "value": 1.0}, {"date": "d2", "value": 2.0}]
        result = downsample_series(series, 90)
        assert result == [1.0, 2.0]


class TestCapDataPoints:
    def test_under_limit(self):
        data = [1, 2, 3]
        assert cap_data_points(data, 5000) == [1, 2, 3]

    def test_over_limit(self):
        data = list(range(100))
        result = cap_data_points(data, 50)
        assert len(result) == 50
        # Should keep most recent (last 50)
        assert result[0] == 50
        assert result[-1] == 99
