import pytest
import pandas as pd
import numpy as np
from services.transforms import (
    trades_to_daily_returns,
    trades_to_daily_returns_with_status,
    downsample_series,
    cap_data_points,
)


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


class TestTradesToDailyReturnsWithStatus:
    """audit-2026-05-07 #9 — lock the heuristic-capital fallback contract
    end-to-end. Pre-fix the heuristic path was silently triggered when
    `fetch_usdt_balance` returned None on any exception, and the result
    rendered as canonical CAGR/Sharpe on the public factsheet (off by
    5–10× per the function's own docstring). The new
    `trades_to_daily_returns_with_status` returns metadata so the caller
    can set `data_quality_flags.heuristic_capital_used` and
    `strategy_analytics.computation_status='complete_with_warnings'`."""

    def _daily_pnl_trades(self) -> list[dict]:
        return [
            {
                "timestamp": "2026-04-01T10:00:00Z",
                "symbol": "PORTFOLIO",
                "side": "buy",
                "price": "100",
                "quantity": "1",
                "fee": "0",
                "order_type": "daily_pnl",
            },
            {
                "timestamp": "2026-04-02T10:00:00Z",
                "symbol": "PORTFOLIO",
                "side": "sell",
                "price": "50",
                "quantity": "1",
                "fee": "0",
                "order_type": "daily_pnl",
            },
        ]

    def test_legitimate_balance_returns_complete_status_no_heuristic(self):
        """Real balance read above the dust threshold => no heuristic,
        no warnings, computation_status_hint='complete'."""
        trades = self._daily_pnl_trades()
        # 100k well above the $200 dust threshold for these trades.
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=100_000.0, balance_error=False
        )
        assert len(returns) == 2
        assert meta["used_heuristic_capital"] is False
        assert meta["balance_error"] is False
        assert meta["computation_status_hint"] == "complete"

    def test_balance_error_propagates_to_warnings(self):
        """The audit's headline case: exchange API failed, caller
        passes balance_error=True. Even though account_balance is also
        None (so the heuristic ALSO fires), the meta MUST carry both
        flags so the DQF UI can distinguish "transient API error" from
        "CSV upload, no balance available"."""
        trades = self._daily_pnl_trades()
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=None, balance_error=True
        )
        assert len(returns) == 2
        assert meta["used_heuristic_capital"] is True, (
            "account_balance=None forces the heuristic-capital fallback "
            "branch; meta MUST surface that"
        )
        assert meta["balance_error"] is True, (
            "balance_error=True from caller MUST round-trip; pre-fix "
            "this signal was destroyed at fetch_usdt_balance and the "
            "factsheet rendered the degraded result as canonical"
        )
        assert meta["computation_status_hint"] == "complete_with_warnings"

    def test_no_balance_csv_upload_uses_heuristic_no_error(self):
        """CSV upload path: no balance available, but no API failure
        either. Heuristic fires (so DQF gets heuristic_capital_used=True)
        but balance_error stays False."""
        trades = self._daily_pnl_trades()
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=None, balance_error=False
        )
        assert len(returns) == 2
        assert meta["used_heuristic_capital"] is True
        assert meta["balance_error"] is False
        # ANY DQF flag => 'complete_with_warnings'. Mirrors the project
        # convention used elsewhere in analytics_runner.
        assert meta["computation_status_hint"] == "complete_with_warnings"

    def test_individual_trades_path_also_surfaces_heuristic_flag(self):
        """The non-daily_pnl branch (individual trades) had its own
        heuristic-capital fallback (`abs(...).iloc[0] or 10000`).
        Equivalent silent-degradation surface — must also surface the
        flag through meta."""
        # Use sample_trades-style individual fills with no order_type
        trades = [
            {
                "timestamp": "2026-04-01T10:00:00Z",
                "symbol": "BTCUSDT",
                "side": "buy",
                "price": "100",
                "quantity": "1",
                "fee": "0",
                "order_type": "market",
            },
            {
                "timestamp": "2026-04-02T10:00:00Z",
                "symbol": "BTCUSDT",
                "side": "sell",
                "price": "110",
                "quantity": "1",
                "fee": "0",
                "order_type": "market",
            },
        ]
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=None, balance_error=False
        )
        assert len(returns) >= 1
        assert meta["used_heuristic_capital"] is True
        assert meta["computation_status_hint"] == "complete_with_warnings"

    def test_empty_trades_returns_complete_when_no_balance_error(self):
        """Empty trades is a legitimate empty result, not a degraded
        run. heuristic flag stays False; computation_status hint
        respects the caller's balance_error input."""
        returns, meta = trades_to_daily_returns_with_status(
            [], account_balance=None, balance_error=False
        )
        assert len(returns) == 0
        assert meta["used_heuristic_capital"] is False
        assert meta["balance_error"] is False
        assert meta["computation_status_hint"] == "complete"

    def test_empty_trades_with_balance_error_still_surfaces_warning(self):
        """If the caller couldn't fetch balance AND there are no trades
        in the window, balance_error must still propagate so the run is
        marked complete_with_warnings rather than complete."""
        returns, meta = trades_to_daily_returns_with_status(
            [], account_balance=None, balance_error=True
        )
        assert len(returns) == 0
        assert meta["balance_error"] is True
        assert meta["computation_status_hint"] == "complete_with_warnings"

    def test_legacy_wrapper_returns_only_series(self):
        """`trades_to_daily_returns` (the legacy wrapper) must keep
        returning a bare pd.Series so existing callers (analytics_runner,
        portfolio router) continue to work without a coordinated
        signature change. Drops the meta — that's exactly what the audit
        flagged as the silent-degradation surface, so callers feeding
        DQF should migrate to the *_with_status form."""
        trades = self._daily_pnl_trades()
        result = trades_to_daily_returns(trades, account_balance=None)
        assert isinstance(result, pd.Series)
        assert len(result) == 2


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
