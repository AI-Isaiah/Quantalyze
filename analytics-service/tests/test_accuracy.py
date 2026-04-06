"""Golden-data analytics accuracy tests.

Hand-computes expected Sharpe, Sortino, CAGR, max drawdown, and volatility
using numpy/pandas directly (NOT quantstats), then asserts that
compute_all_metrics output matches within reasonable tolerance.
"""

import math

import numpy as np
import pandas as pd
import pytest

from services.metrics import compute_all_metrics
from services.transforms import trades_to_daily_returns


# ---------------------------------------------------------------------------
# Fixed synthetic returns: 90 trading days, crypto-like profile
#   ~0.5% daily mean, ~3% daily vol
# ---------------------------------------------------------------------------
def _build_fixed_returns() -> pd.Series:
    """90-day fixed synthetic daily returns. Seeded for reproducibility."""
    np.random.seed(2024)
    n = 90
    dates = pd.bdate_range("2024-01-02", periods=n)
    raw = np.random.normal(0.005, 0.03, n)
    # Inject a small drawdown (days 40-55) to exercise max-drawdown logic
    raw[40:50] = np.random.RandomState(2024).normal(-0.02, 0.025, 10)
    raw[50:55] = np.random.RandomState(2025).normal(0.003, 0.015, 5)
    return pd.Series(raw, index=dates, name="returns")


FIXED_RETURNS = _build_fixed_returns()


# ---------------------------------------------------------------------------
# Hand-computed reference values (numpy/pandas only, no quantstats)
# ---------------------------------------------------------------------------
def _hand_sharpe(returns: pd.Series, periods: int = 252) -> float:
    """Annualized Sharpe ratio: (mean * periods) / (std * sqrt(periods)).

    QuantStats uses rf=0 by default and annualizes daily returns with 252.
    """
    excess = returns  # rf = 0
    return float((excess.mean() * periods) / (excess.std(ddof=1) * np.sqrt(periods)))


def _hand_sortino(returns: pd.Series, periods: int = 252, target: float = 0.0) -> float:
    """Annualized Sortino ratio using downside deviation.

    downside_dev = sqrt(mean(min(r - target, 0)^2)) * sqrt(periods)
    sortino = (mean * periods) / downside_dev
    """
    diff = returns - target
    downside = diff.clip(upper=0)
    downside_sq = (downside ** 2).mean()
    downside_dev = np.sqrt(downside_sq) * np.sqrt(periods)
    if downside_dev == 0:
        return float("inf")
    return float((returns.mean() * periods) / downside_dev)


def _hand_cagr(returns: pd.Series) -> float:
    """CAGR from daily returns series.

    total_return = prod(1 + r_i) - 1
    years = n_days / 252
    cagr = (1 + total_return)^(1/years) - 1
    """
    cumulative = (1 + returns).prod()
    n_days = len(returns)
    years = n_days / 252.0
    if years == 0:
        return 0.0
    return float(cumulative ** (1.0 / years) - 1)


def _hand_max_drawdown(returns: pd.Series) -> float:
    """Max drawdown (negative value) from daily returns."""
    cumulative = (1 + returns).cumprod()
    running_max = cumulative.cummax()
    drawdown = (cumulative - running_max) / running_max
    return float(drawdown.min())


def _hand_volatility(returns: pd.Series, periods: int = 252) -> float:
    """Annualized volatility: std * sqrt(252)."""
    return float(returns.std(ddof=1) * np.sqrt(periods))


# ---------------------------------------------------------------------------
# Test class: accuracy of compute_all_metrics against hand-computed values
# ---------------------------------------------------------------------------
class TestMetricsAccuracy:
    """Verify compute_all_metrics output matches hand-computed golden values."""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.returns = FIXED_RETURNS
        self.result = compute_all_metrics(self.returns)

    def test_sharpe_matches_hand_calculation(self):
        expected = _hand_sharpe(self.returns)
        actual = self.result["sharpe"]
        assert actual is not None, "sharpe is None"
        assert abs(actual - expected) < 0.05, (
            f"Sharpe mismatch: expected {expected:.4f}, got {actual:.4f}"
        )

    def test_sortino_matches_hand_calculation(self):
        expected = _hand_sortino(self.returns)
        actual = self.result["sortino"]
        assert actual is not None, "sortino is None"
        assert abs(actual - expected) < 0.05, (
            f"Sortino mismatch: expected {expected:.4f}, got {actual:.4f}"
        )

    def test_cagr_matches_hand_calculation(self):
        expected = _hand_cagr(self.returns)
        actual = self.result["cagr"]
        assert actual is not None, "cagr is None"
        assert abs(actual - expected) < 0.01, (
            f"CAGR mismatch: expected {expected:.6f}, got {actual:.6f}"
        )

    def test_max_drawdown_matches_hand_calculation(self):
        expected = _hand_max_drawdown(self.returns)
        actual = self.result["max_drawdown"]
        assert actual is not None, "max_drawdown is None"
        assert abs(actual - expected) < 0.01, (
            f"Max drawdown mismatch: expected {expected:.6f}, got {actual:.6f}"
        )

    def test_volatility_matches_hand_calculation(self):
        expected = _hand_volatility(self.returns)
        actual = self.result["volatility"]
        assert actual is not None, "volatility is None"
        assert abs(actual - expected) < 0.01, (
            f"Volatility mismatch: expected {expected:.6f}, got {actual:.6f}"
        )

    def test_cumulative_return_matches(self):
        expected = float((1 + self.returns).cumprod().iloc[-1] - 1)
        actual = self.result["cumulative_return"]
        assert actual is not None
        assert abs(actual - expected) < 1e-6, (
            f"Cumulative return mismatch: expected {expected:.6f}, got {actual:.6f}"
        )

    def test_max_drawdown_is_negative(self):
        assert self.result["max_drawdown"] is not None
        assert self.result["max_drawdown"] < 0

    def test_volatility_is_positive(self):
        assert self.result["volatility"] is not None
        assert self.result["volatility"] > 0


# ---------------------------------------------------------------------------
# Test class: trades_to_daily_returns with known account balance
# ---------------------------------------------------------------------------
class TestTradesToDailyReturnsPnL:
    """Verify trades_to_daily_returns produces correct returns from daily PnL data."""

    def _make_daily_pnl_trades(self) -> list[dict]:
        """5 days of daily PnL trades with known dollar amounts.

        Day 1: +150  (profit)
        Day 2: -80   (loss)
        Day 3: +200  (profit)
        Day 4: -50   (loss)
        Day 5: +120  (profit)
        Total PnL = +340
        """
        return [
            {"timestamp": "2024-03-01T00:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "150", "quantity": "1", "fee": "0", "order_type": "daily_pnl"},
            {"timestamp": "2024-03-04T00:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "80", "quantity": "1", "fee": "0", "order_type": "daily_pnl"},
            {"timestamp": "2024-03-05T00:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "200", "quantity": "1", "fee": "0", "order_type": "daily_pnl"},
            {"timestamp": "2024-03-06T00:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "50", "quantity": "1", "fee": "0", "order_type": "daily_pnl"},
            {"timestamp": "2024-03-07T00:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "120", "quantity": "1", "fee": "0", "order_type": "daily_pnl"},
        ]

    def test_known_balance_returns_accuracy(self):
        """With account_balance=10340, starting capital should be 10000.

        starting = account_balance - total_pnl = 10340 - 340 = 10000
        Day 1 return: 150 / 10000 = 0.015
        Day 2 return: -80 / (10000 + 150) = -80 / 10150 ~ -0.00788
        Day 3 return: 200 / (10150 - 80) = 200 / 10070 ~ 0.01986
        Day 4 return: -50 / (10070 + 200) = -50 / 10270 ~ -0.00487
        Day 5 return: 120 / (10270 - 50) = 120 / 10220 ~ 0.01174
        """
        trades = self._make_daily_pnl_trades()
        account_balance = 10340.0  # starting 10000 + 340 total PnL

        returns = trades_to_daily_returns(trades, account_balance=account_balance)

        assert len(returns) == 5

        # Day 1: 150 / 10000
        assert abs(returns.iloc[0] - 0.015) < 1e-6

        # Day 2: -80 / 10150
        expected_d2 = -80.0 / 10150.0
        assert abs(returns.iloc[1] - expected_d2) < 1e-6

        # Day 3: 200 / 10070
        expected_d3 = 200.0 / 10070.0
        assert abs(returns.iloc[2] - expected_d3) < 1e-6

        # Day 4: -50 / 10270
        expected_d4 = -50.0 / 10270.0
        assert abs(returns.iloc[3] - expected_d4) < 1e-6

        # Day 5: 120 / 10220
        expected_d5 = 120.0 / 10220.0
        assert abs(returns.iloc[4] - expected_d5) < 1e-6

    def test_returns_sum_to_total_return(self):
        """Compounding the daily returns should recover approximately the total PnL fraction."""
        trades = self._make_daily_pnl_trades()
        account_balance = 10340.0

        returns = trades_to_daily_returns(trades, account_balance=account_balance)
        compounded = float((1 + returns).prod() - 1)
        expected = 340.0 / 10000.0  # 3.4% total return
        assert abs(compounded - expected) < 1e-4

    def test_all_returns_finite(self):
        trades = self._make_daily_pnl_trades()
        returns = trades_to_daily_returns(trades, account_balance=10340.0)
        for val in returns.values:
            assert np.isfinite(val), f"Non-finite return: {val}"


# ---------------------------------------------------------------------------
# Test class: heuristic fallback (no account_balance)
# ---------------------------------------------------------------------------
class TestHeuristicFallback:
    """When account_balance is None, the heuristic should still produce sane results."""

    def _make_daily_pnl_trades(self, n: int = 30) -> list[dict]:
        """Generate n days of daily PnL trades with realistic amounts."""
        np.random.seed(999)
        pnl_values = np.random.normal(50, 200, n)
        trades = []
        base_date = pd.Timestamp("2024-01-02")
        for i, pnl in enumerate(pnl_values):
            date = base_date + pd.Timedelta(days=i)
            side = "buy" if pnl >= 0 else "sell"
            trades.append({
                "timestamp": date.isoformat() + "Z",
                "symbol": "BTCUSDT",
                "side": side,
                "price": str(abs(pnl)),
                "quantity": "1",
                "fee": "0",
                "order_type": "daily_pnl",
            })
        return trades

    def test_heuristic_produces_returns(self):
        """Without account_balance, should still produce a returns series."""
        trades = self._make_daily_pnl_trades()
        returns = trades_to_daily_returns(trades, account_balance=None)
        assert isinstance(returns, pd.Series)
        assert len(returns) > 0

    def test_heuristic_returns_are_finite(self):
        trades = self._make_daily_pnl_trades()
        returns = trades_to_daily_returns(trades, account_balance=None)
        for val in returns.values:
            assert np.isfinite(val), f"Non-finite return: {val}"

    def test_heuristic_returns_are_reasonable_magnitude(self):
        """Heuristic returns should not be absurdly large (e.g., > 100% daily)."""
        trades = self._make_daily_pnl_trades()
        returns = trades_to_daily_returns(trades, account_balance=None)
        # Daily returns above 50% would signal a broken heuristic
        assert returns.abs().max() < 0.5, (
            f"Heuristic produced unreasonable daily return: {returns.abs().max():.4f}"
        )

    def test_heuristic_feeds_into_compute_all_metrics(self):
        """Heuristic returns should produce valid metrics without errors."""
        trades = self._make_daily_pnl_trades()
        returns = trades_to_daily_returns(trades, account_balance=None)
        result = compute_all_metrics(returns)

        assert result["sharpe"] is not None
        assert result["volatility"] is not None
        assert result["max_drawdown"] is not None
        assert not math.isinf(result["sharpe"])
        assert not math.isinf(result["volatility"])

    def test_heuristic_vs_known_balance_direction_matches(self):
        """Both approaches should agree on the sign of cumulative return."""
        trades = self._make_daily_pnl_trades()

        # With a reasonable balance
        total_pnl = sum(
            float(t["price"]) if t["side"] == "buy" else -float(t["price"])
            for t in trades
        )
        known_balance = abs(total_pnl) * 100 + total_pnl  # synthetic balance

        returns_known = trades_to_daily_returns(trades, account_balance=known_balance)
        returns_heuristic = trades_to_daily_returns(trades, account_balance=None)

        cum_known = float((1 + returns_known).prod() - 1)
        cum_heuristic = float((1 + returns_heuristic).prod() - 1)

        # Signs should match (both positive or both negative)
        if abs(cum_known) > 1e-6 and abs(cum_heuristic) > 1e-6:
            assert (cum_known > 0) == (cum_heuristic > 0), (
                f"Direction mismatch: known={cum_known:.6f}, heuristic={cum_heuristic:.6f}"
            )
