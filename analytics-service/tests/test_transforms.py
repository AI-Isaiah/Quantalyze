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
        # 74-02: sample_trades is a net-flat round-trip whose first-day net
        # notional is ~$10; with no account_balance the honest core (dust floor
        # $1000) correctly guards that sub-dust base to NaN. This test's intent
        # is "real trades produce finite returns", so anchor it to a realistic
        # institutional balance where estimated_start > dust and no guard fires.
        returns = trades_to_daily_returns(sample_trades, account_balance=100_000.0)
        for val in returns.values:
            assert np.isfinite(val), f"Non-finite return: {val}"

    def test_fees_reduce_returns(self):
        """Same trades with and without fees — fees should reduce net return.

        74-02: anchored to a realistic $10k balance. Pre-wiring these fed the
        individual-trades heuristic a ~$10 base (dust) and produced finite-but-
        gibberish -100%/-200% returns; the honest core guards a sub-dust base to
        NaN, so a real balance is required to compare the fee effect on the same
        real base (fees enter the numerator PnL, so the fee series is lower)."""
        no_fee_trades = [
            {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "100", "quantity": "1", "fee": "0", "order_type": "market"},
            {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "110", "quantity": "1", "fee": "0", "order_type": "market"},
        ]
        fee_trades = [
            {"timestamp": "2023-01-02T10:00:00Z", "symbol": "BTCUSDT", "side": "buy", "price": "100", "quantity": "1", "fee": "5", "order_type": "market"},
            {"timestamp": "2023-01-02T14:00:00Z", "symbol": "BTCUSDT", "side": "sell", "price": "110", "quantity": "1", "fee": "5", "order_type": "market"},
        ]
        r_no_fee = trades_to_daily_returns(no_fee_trades, account_balance=10_000.0)
        r_fee = trades_to_daily_returns(fee_trades, account_balance=10_000.0)
        # The return with fees should be less
        assert float(r_fee.iloc[0]) < float(r_no_fee.iloc[0])

    def test_mixed_precision_timestamps_do_not_raise(self):
        """REGRESSION: compute_analytics ~63% terminal-failure (2026-06-01).

        Trade rows mix timestamp precision — raw fills carry microseconds
        (`...T12:34:56.123456+00:00`) while daily-PnL summary rows are
        whole-second (`...T00:00:00+00:00`). A bare ``pd.to_datetime``
        (pandas >=2.0) infers the format from element 0 and then raises
        ``time data "...T00:00:00+00:00" doesn't match format
        "%Y-%m-%dT%H:%M:%S.%f%z" at position N`` on the first row of differing
        precision — which crashed ``compute_analytics`` for every strategy
        whose trades contained a whole-second timestamp, freezing its dashboard
        KPIs. ``format="ISO8601"`` parses each value independently.

        WHY (Rule 9): the bug is invisible to single-precision fixtures — it
        only bites when a series MIXES precisions, which is exactly what real
        accumulated trade history does. Reverting the fix re-raises here.
        """
        trades = [
            {"timestamp": "2026-05-30T12:34:56.123456+00:00", "symbol": "BTCUSDT", "side": "buy", "price": "100", "quantity": "1", "fee": "0", "order_type": "market"},
            {"timestamp": "2026-05-30T18:00:00+00:00", "symbol": "BTCUSDT", "side": "sell", "price": "110", "quantity": "1", "fee": "0", "order_type": "market"},
            {"timestamp": "2026-05-31T00:00:00+00:00", "symbol": "BTCUSDT", "side": "buy", "price": "120", "quantity": "1", "fee": "0", "order_type": "market"},
        ]
        # Pre-fix this raises ValueError in pd.to_datetime. Both public entry
        # points route through the same parse (the simple form delegates to
        # *_with_status), so assert both return cleanly.
        returns = trades_to_daily_returns(trades)
        assert isinstance(returns, pd.Series)
        series, _meta = trades_to_daily_returns_with_status(trades)
        assert isinstance(series, pd.Series)


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


class TestDustThresholdC0233:
    """audit-2026-05-07 C-0233 regression — pre-fix the dust-balance
    threshold was `max(daily_pnl.abs().max() * 2, 100)`, scaling with the
    LARGEST single-day P&L. A strategy with one outlier day (Bybit funding
    spike, OKX inverse-perp glitch) would force the heuristic-capital
    branch even when the caller had a legitimate institutional balance,
    distorting CAGR/Sharpe by 5–10× on the public factsheet.

    Post-fix: threshold is a FIXED absolute floor ($1,000 USDT), so any
    realistic institutional balance flows through the real-capital
    branch and the factsheet renders accurate numbers."""

    def _outlier_day_trades(self) -> list[dict]:
        """One day with a $1,000,000 PnL spike — the outlier-day scenario
        the audit calls out. Pre-fix this forces `min_balance = $2M` and
        any account_balance < $2M (i.e. any realistic balance) falls
        through to the heuristic."""
        return [
            {
                "timestamp": "2026-04-01T10:00:00Z",
                "symbol": "PORTFOLIO",
                "side": "buy",
                "price": "1000000",  # $1M PnL spike on day 1
                "quantity": "1",
                "fee": "0",
                "order_type": "daily_pnl",
            },
            {
                "timestamp": "2026-04-02T10:00:00Z",
                "symbol": "PORTFOLIO",
                "side": "buy",
                "price": "5000",  # normal day
                "quantity": "1",
                "fee": "0",
                "order_type": "daily_pnl",
            },
        ]

    def test_real_balance_below_pnl_spike_still_takes_real_capital_path(self):
        """The headline case: account_balance = $1.5M (legitimate
        institutional), max daily PnL = $1M. Pre-fix, min_balance =
        $1M × 2 = $2M so a $1.5M balance (< $2M) still fired the heuristic
        branch. Post-fix, the fixed $1k floor means real balance wins and the
        factsheet renders accurate numbers.

        74-02 note: the balance was $500k pre-wiring, but $500k with a $1M
        single-day PnL is physically impossible (it implies estimated_start =
        500k - 1.005M = -505k, i.e. the account gained more than it ever held).
        The old code SILENTLY substituted the balance as the base for that
        impossible input; the honest core now flags it (negative_nav_guard),
        which is the divergence the dedicated pins own. $1.5M keeps this
        regression focused on the dust-decoupling it was written for (still
        below the old $2M PnL-derived threshold) with a physically consistent
        estimated_start = 1.5M - 1.005M = 495k > 0 (no guard)."""
        trades = self._outlier_day_trades()
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=1_500_000.0, balance_error=False
        )
        assert len(returns) == 2
        assert meta["used_heuristic_capital"] is False, (
            "real institutional balance ($1.5M, below the old $2M PnL-derived "
            "threshold) MUST flow through the real-capital branch — the fixed "
            "dust floor decouples the heuristic trigger from PnL magnitude"
        )
        assert meta["computation_status_hint"] == "complete"

    def test_genuine_dust_balance_still_falls_back_to_heuristic(self):
        """Negative control — a balance BELOW the $1k dust floor (e.g.,
        a drained paper account with $50 leftover) MUST still trigger
        the heuristic branch. The fix decouples threshold from PnL
        magnitude; it does not remove dust filtering entirely."""
        trades = self._outlier_day_trades()
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=50.0, balance_error=False
        )
        assert len(returns) == 2
        assert meta["used_heuristic_capital"] is True, (
            "balance below the $1k dust floor MUST take the heuristic "
            "branch; the audit fix preserves dust filtering"
        )

    def test_individual_trades_path_also_decoupled_from_pnl_magnitude(self):
        """The fix applies to both branches (daily_pnl AND individual
        trades). Pre-fix the individual-trades branch had its own
        `max(daily_agg["pnl"].abs().max(), 100)` threshold with the same
        PnL-coupling bug."""
        # Two trades on different days; a huge fill exceeds the balance
        # if the pre-fix threshold of max(pnl) is used.
        trades = [
            {
                "timestamp": "2026-04-01T10:00:00Z",
                "symbol": "BTCUSDT",
                "side": "buy",
                "price": "500000",  # huge notional
                "quantity": "1",
                "fee": "0",
                "order_type": "market",
            },
            {
                "timestamp": "2026-04-01T14:00:00Z",
                "symbol": "BTCUSDT",
                "side": "sell",
                "price": "510000",  # net +$10k on the day
                "quantity": "1",
                "fee": "0",
                "order_type": "market",
            },
            {
                "timestamp": "2026-04-02T10:00:00Z",
                "symbol": "BTCUSDT",
                "side": "buy",
                "price": "100",
                "quantity": "1",
                "fee": "0",
                "order_type": "market",
            },
        ]
        # $50k balance — well above the $1k dust floor, but below the
        # pre-fix threshold derived from the $510k notional.
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=50_000.0, balance_error=False
        )
        assert meta["used_heuristic_capital"] is False, (
            "individual-trades branch must also decouple dust threshold "
            "from per-day PnL magnitude; realistic balance must flow "
            "through the real-capital branch"
        )


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


# ---------------------------------------------------------------------------
# Phase 74 Wave 0 — byte-identity SNAPSHOT pins (the revert-proof safety net)
# ---------------------------------------------------------------------------
# These freeze TODAY's EXACT returns Series (pre-refactor) for the flow-less,
# estimated_start>0 input shapes that flow through
# ``trades_to_daily_returns_with_status``. Wave 2 (plan 74-02) delegates the
# daily_pnl path to ``nav_twr.reconstruct_nav_and_twr``; these pins are the
# safety net that MUST STAY GREEN across the whole phase — a delegation diff
# that changes any value on a flow-less / estimated_start>0 account fails here.
#
# The assertion pattern mirrors the SC-4 pin in test_nav_twr.py
# (``test_zero_flow_byte_identical``): rtol 1e-12, index-name excluded (the
# "returns" vs input index-name convention is cosmetic).
#
# Do NOT assert any NaN/guard behavior here — the estimated_start<=0 divergence
# / fallback-deletion pins are authored RED->GREEN inside 74-02. Every fixture
# here keeps estimated_start>0 (or is the heuristic branch) so NO guard fires.
class TestByteIdentitySnapshotPins:
    """Revert-proof byte-identity pins for the three flow-less input shapes."""

    def test_byte_identical_daily_pnl_snapshot(self):
        """Pin the daily_pnl branch (order_type='daily_pnl') on an
        estimated_start>0 account. account_balance=250k, Σpnl=1800 ->
        estimated_start=248,200 (>$1000 dust floor) so the real-balance path
        is taken and NO heuristic/guard fires. Frozen to rtol 1e-12."""
        pnls = [1200.0, -450.0, 900.0, -200.0, 650.0, -300.0]  # Σ = 1800
        account_balance = 250_000.0
        trades = [
            {
                "timestamp": f"2026-03-{i + 1:02d}T00:00:00+00:00",
                "order_type": "daily_pnl",
                "side": "buy" if p >= 0 else "sell",
                "price": abs(p),
            }
            for i, p in enumerate(pnls)
        ]
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=account_balance
        )

        expected_index = pd.DatetimeIndex(
            [f"2026-03-{i + 1:02d}" for i in range(len(pnls))]
        )
        expected_values = [
            0.004834810636583401,
            -0.0018043303929430633,
            0.003615183771841735,
            -0.0008004802881729037,
            0.0026036451031444022,
            -0.0011985617259288853,
        ]
        expected = pd.Series(expected_values, index=expected_index, name="returns")

        pd.testing.assert_series_equal(
            returns, expected, check_exact=False, rtol=1e-12,
            check_freq=False, check_names=False,
        )
        # Real-balance path: no heuristic, no guard -> 'complete'.
        assert meta["used_heuristic_capital"] is False
        assert meta["computation_status_hint"] == "complete"

    def test_byte_identical_individual_snapshot(self):
        """Pin the individual-trades branch (raw buy/sell fills with
        price/quantity/fee, NO order_type='daily_pnl') on an
        estimated_start>0 account (account_balance=50k). This is the branch
        Phase 73 SC-4 never covered (portfolio.py:2260 feeds it real fills).
        Frozen to rtol 1e-12."""
        fills = [
            ("2026-05-01", "buy", 100.0, 10.0, 2.0),
            ("2026-05-01", "sell", 105.0, 10.0, 2.0),
            ("2026-05-02", "buy", 50.0, 20.0, 1.5),
            ("2026-05-02", "sell", 52.0, 20.0, 1.5),
            ("2026-05-03", "buy", 200.0, 5.0, 3.0),
            ("2026-05-03", "sell", 190.0, 5.0, 3.0),
        ]
        trades = [
            {
                "timestamp": f"{d}T10:00:00+00:00",
                "symbol": "BTCUSDT",
                "side": s,
                "price": str(price),
                "quantity": str(qty),
                "fee": str(fee),
                "order_type": "market",
            }
            for (d, s, price, qty, fee) in fills
        ]
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=50_000.0
        )

        expected_index = pd.DatetimeIndex(["2026-05-01", "2026-05-02", "2026-05-03"])
        expected_values = [
            -0.0010788564122030646,
            -0.0008600172003440069,
            0.0008807750820722236,
        ]
        expected = pd.Series(expected_values, index=expected_index, name="returns")

        pd.testing.assert_series_equal(
            returns, expected, check_exact=False, rtol=1e-12,
            check_freq=False, check_names=False,
        )
        assert meta["used_heuristic_capital"] is False
        assert meta["computation_status_hint"] == "complete"

    def test_byte_identical_heuristic_snapshot(self):
        """HARDENING (plan-checker Warning 2): pin the HEURISTIC sub-branch
        (account_balance=None -> transforms.py:160-169, the process_key:896
        path) so the flow-less guarantee covers it too. This branch derives
        initial_capital from the PnL magnitude (off by 5-10x by design), so it
        is net-new to guard against 74-02 accidentally altering the fallback
        that estimated_start<=0 currently shares. Frozen to rtol 1e-12."""
        pnls = [1200.0, -450.0, 900.0, -200.0, 650.0, -300.0]
        trades = [
            {
                "timestamp": f"2026-03-{i + 1:02d}T00:00:00+00:00",
                "order_type": "daily_pnl",
                "side": "buy" if p >= 0 else "sell",
                "price": abs(p),
            }
            for i, p in enumerate(pnls)
        ]
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=None
        )

        expected_index = pd.DatetimeIndex(
            [f"2026-03-{i + 1:02d}" for i in range(len(pnls))]
        )
        expected_values = [
            0.019459459459459462,
            -0.0071580063626723225,
            0.014419225634178906,
            -0.00315872598052119,
            0.010298389226300502,
            -0.004704652378463147,
        ]
        expected = pd.Series(expected_values, index=expected_index, name="returns")

        pd.testing.assert_series_equal(
            returns, expected, check_exact=False, rtol=1e-12,
            check_freq=False, check_names=False,
        )
        # Heuristic fired: account_balance=None -> complete_with_warnings.
        assert meta["used_heuristic_capital"] is True
        assert meta["computation_status_hint"] == "complete_with_warnings"


# ---------------------------------------------------------------------------
# Phase 74 Wave 2 (plan 74-02) — the HONEST divergence pins (RED -> GREEN)
# ---------------------------------------------------------------------------
# These are the behaviour-CHANGE pins the milestone exists for. Once
# ``trades_to_daily_returns_with_status`` delegates to
# ``nav_twr.reconstruct_nav_and_twr``, an ``estimated_start <= 0`` account (the
# account whose current balance is LESS than its cumulative PnL — i.e. it gained
# more than its whole starting capital) no longer has a base FABRICATED for it.
# Pre-refactor: the ``else: initial_capital = account_balance`` substitution
# (daily_pnl :154-159 / individual :196-199) invented today's balance as the
# base and the ``prev_equity.replace(0, initial_capital)`` swap (:175 / :211)
# invented a base for a zeroed day, both stamping the fabricated magnitude
# ``complete``. Post-refactor the reconstructed non-positive base FLAGS via the
# core's ``negative_nav_guard`` and that day's return is ``np.nan`` — flag, never
# substitute (the harm class TWR-03/TWR-04 kill).
#
# Each pin is mutation-honest: it asserts the NaN-not-magnitude AND names the
# exact fabricated value the deleted branch would have produced, so it fails if
# the substitution is ever reintroduced. The source-scan pins statically ban the
# token class so a revert cannot slip past even if a fixture stops covering it.
class TestDailyPnlDelegationDivergence:
    """daily_pnl branch: estimated_start<=0 flags NaN, no base substitution."""

    def _estimated_start_nonpositive_daily_pnl(self) -> tuple[list[dict], float]:
        """balance=1500, Σpnl=2000 (day0 +3000, day1 -1000) ->
        estimated_start = 1500 - 2000 = -500 (<= 0). Real balance is above the
        $1000 dust floor so the real-anchor sub-branch is taken; the divergence
        is purely the deleted estimated_start<=0 substitution."""
        trades = [
            {
                "timestamp": "2026-03-01T00:00:00+00:00",
                "order_type": "daily_pnl",
                "side": "buy",
                "price": 3000,
            },
            {
                "timestamp": "2026-03-02T00:00:00+00:00",
                "order_type": "daily_pnl",
                "side": "sell",
                "price": 1000,
            },
        ]
        return trades, 1500.0

    def test_daily_pnl_estimated_start_nonpositive_flags_nan_not_magnitude(self):
        """The core reconstructs prev-base = terminal-roll = -500 (<=0) on day 0
        -> negative_nav_guard -> NaN + complete_with_warnings. Pre-refactor this
        day fabricated 3000/1500 = 2.0 (200% daily) and rendered as canonical."""
        trades, balance = self._estimated_start_nonpositive_daily_pnl()
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=balance
        )
        assert np.isnan(returns.iloc[0]), (
            "estimated_start<=0 day 0 MUST be np.nan (guarded), not a "
            "fabricated magnitude"
        )
        assert meta.get("negative_nav_guard") is True
        assert meta["computation_status_hint"] == "complete_with_warnings"
        # Real balance read (not the heuristic): the warning is the GUARD.
        assert meta["used_heuristic_capital"] is False

    def test_daily_pnl_fallback_deletion_no_account_balance_substitution(self):
        """Mutation-honest fallback-deletion pin: the DELETED ``else:
        initial_capital = account_balance`` branch would have divided day-0 PnL
        by the substituted balance-derived base and produced 3000/1500 == 2.0.
        Assert that exact fabricated value is ABSENT (day 0 is NaN instead)."""
        trades, balance = self._estimated_start_nonpositive_daily_pnl()
        returns, _meta = trades_to_daily_returns_with_status(
            trades, account_balance=balance
        )
        fabricated_day0 = 3000.0 / 1500.0  # what the deleted substitution yields
        assert np.isnan(returns.iloc[0])
        assert not np.isclose(
            np.nan_to_num(returns.iloc[0], nan=-999.0), fabricated_day0
        ), "the estimated_start<=0 -> account_balance substitution was reintroduced"

    def test_forbidden_daily_pnl_base_substitution_token_absent(self):
        """Source-scan (mutation-honest, revert-proof): the exact fabrication
        token ``initial_capital = account_balance`` must NOT appear anywhere in
        transforms.py source outside a full-line comment. Fails if the deleted
        daily_pnl substitution is reintroduced even under a fixture that no
        longer exercises it."""
        from pathlib import Path
        import services.transforms as transforms_mod

        src = Path(transforms_mod.__file__).read_text()
        code = "\n".join(
            ln for ln in src.splitlines() if ln.lstrip()[:1] != "#"
        )
        assert "initial_capital = account_balance" not in code, (
            "forbidden base-substitution token reintroduced in transforms.py"
        )


class TestIndividualTradesDelegationDivergence:
    """individual-trades branch (raw fills, portfolio.py:2260 path):
    estimated_start<=0 flags NaN via the delegated core, no base substitution."""

    def _estimated_start_nonpositive_individual(self) -> tuple[list[dict], float]:
        """Raw fills chosen so total_pnl > balance. Day 0 is a lone $2000 buy
        (net_notional +2000 => pnl +2000); day 1 nets +10. total_pnl = 2010 vs
        balance 1500 (> $1000 dust so the real-anchor sub-branch is taken) ->
        estimated_start = 1500 - 2010 = -510 (<= 0)."""
        fills = [
            ("2026-06-01", "buy", 2000.0, 1.0, 0.0),
            ("2026-06-02", "buy", 100.0, 1.0, 0.0),
            ("2026-06-02", "sell", 90.0, 1.0, 0.0),
        ]
        trades = [
            {
                "timestamp": f"{d}T10:00:00+00:00",
                "symbol": "BTCUSDT",
                "side": s,
                "price": str(price),
                "quantity": str(qty),
                "fee": str(fee),
                "order_type": "market",
            }
            for (d, s, price, qty, fee) in fills
        ]
        return trades, 1500.0

    def test_individual_estimated_start_nonpositive_flags_nan_not_magnitude(self):
        """Delegated core reconstructs day-0 prev-base = -510 (<=0) ->
        negative_nav_guard -> NaN + complete_with_warnings. Pre-refactor the
        individual branch fabricated 2000/1500 == 1.333 for this same input."""
        trades, balance = self._estimated_start_nonpositive_individual()
        returns, meta = trades_to_daily_returns_with_status(
            trades, account_balance=balance
        )
        assert np.isnan(returns.iloc[0]), (
            "individual-trades estimated_start<=0 day 0 MUST be np.nan (guarded)"
        )
        assert meta.get("negative_nav_guard") is True
        assert meta["computation_status_hint"] == "complete_with_warnings"
        assert meta["used_heuristic_capital"] is False

    def test_individual_fallback_deletion_no_account_balance_substitution(self):
        """Mutation-honest: the DELETED ``estimated_start if ... else
        account_balance`` substitution (transforms.py:196-199) and the
        ``prev_equity.replace(0, ...)`` swap (:211) would have divided day-0 PnL
        by the substituted balance base and produced 2000/1500 == 1.333. Assert
        that fabricated value is ABSENT (day 0 is NaN instead)."""
        trades, balance = self._estimated_start_nonpositive_individual()
        returns, _meta = trades_to_daily_returns_with_status(
            trades, account_balance=balance
        )
        fabricated_day0 = 2000.0 / 1500.0
        assert np.isnan(returns.iloc[0])
        assert not np.isclose(
            np.nan_to_num(returns.iloc[0], nan=-999.0), fabricated_day0
        ), "the individual-branch estimated_start<=0 substitution was reintroduced"

    def test_forbidden_base_substitution_tokens_absent_both_branches(self):
        """Comprehensive revert-proof source-scan: NEITHER the
        ``prev_equity.replace(0`` base swap NOR the ``else account_balance``
        substitution may appear anywhere in transforms.py source outside a
        full-line comment. Covers BOTH branches (daily_pnl :175 and individual
        :211/:199) so a revert on either path fails here even without a fixture
        that exercises it. Together with the daily_pnl token pin this bans the
        entire fabrication token class (TWR-03: fallback gone EVERYWHERE)."""
        from pathlib import Path
        import services.transforms as transforms_mod

        src = Path(transforms_mod.__file__).read_text()
        code = "\n".join(
            ln for ln in src.splitlines() if ln.lstrip()[:1] != "#"
        )
        assert ".replace(0" not in code, (
            "forbidden prev_equity.replace(0, ...) base swap reintroduced"
        )
        assert "else account_balance" not in code, (
            "forbidden estimated_start<=0 -> account_balance substitution "
            "reintroduced on the individual-trades branch"
        )
