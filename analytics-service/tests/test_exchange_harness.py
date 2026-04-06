"""Exchange integration test harness.

Tests the exchange-specific logic in services/exchange.py with mocked CCXT
exchanges. Each exchange (OKX, Binance, Bybit) has its own private API shape,
pagination, deduplication, and aggregation rules -- this harness verifies
them all without touching live APIs.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt.async_support as ccxt

from services.exchange import create_exchange, fetch_daily_pnl


# ---------------------------------------------------------------------------
# Helpers: realistic mock data builders
# ---------------------------------------------------------------------------

def _okx_bill(bill_id: str, pnl: str, fee: str, ts_ms: int, inst_type: str = "SWAP") -> dict:
    """Build a realistic OKX bill record."""
    return {
        "billId": bill_id,
        "pnl": pnl,
        "fee": fee,
        "ts": str(ts_ms),
        "instType": inst_type,
        "instId": "BTC-USDT-SWAP",
        "ccy": "USDT",
        "balChg": pnl,
        "bal": "10000",
        "sz": "1",
        "subType": "1",
    }


def _binance_income(income_type: str, income: str, symbol: str, time_ms: int) -> dict:
    """Build a realistic Binance futures income record."""
    return {
        "symbol": symbol,
        "incomeType": income_type,
        "income": income,
        "asset": "USDT",
        "time": str(time_ms),
        "tranId": str(time_ms),
        "tradeId": "",
    }


def _bybit_closed_pnl(symbol: str, closed_pnl: str, created_time_ms: int) -> dict:
    """Build a realistic Bybit closed PnL record."""
    return {
        "symbol": symbol,
        "closedPnl": closed_pnl,
        "avgEntryPrice": "30000",
        "avgExitPrice": "30500",
        "qty": "0.1",
        "cumEntryValue": "3000",
        "cumExitValue": "3050",
        "createdTime": str(created_time_ms),
        "updatedTime": str(created_time_ms),
        "side": "Buy",
        "orderType": "Market",
    }


def _ts(year: int, month: int, day: int, hour: int = 0) -> int:
    """Convenience: return epoch milliseconds for a UTC datetime."""
    return int(datetime(year, month, day, hour, tzinfo=timezone.utc).timestamp() * 1000)


def _make_okx_exchange() -> MagicMock:
    """Create a MagicMock that quacks like an OKX CCXT exchange."""
    exchange = MagicMock(spec=ccxt.okx)
    exchange.id = "okx"
    exchange.private_get_account_bills = AsyncMock(return_value={"data": []})
    exchange.private_get_account_bills_archive = AsyncMock(return_value={"data": []})
    return exchange


def _make_binance_exchange() -> MagicMock:
    """Create a MagicMock that quacks like a Binance CCXT exchange."""
    exchange = MagicMock(spec=ccxt.binance)
    exchange.id = "binance"
    exchange.fapiPrivate_get_income = AsyncMock(return_value=[])
    exchange.fetch_my_trades = AsyncMock(return_value=[])
    return exchange


def _make_bybit_exchange() -> MagicMock:
    """Create a MagicMock that quacks like a Bybit CCXT exchange."""
    exchange = MagicMock(spec=ccxt.bybit)
    exchange.id = "bybit"
    exchange.private_get_v5_position_closed_pnl = AsyncMock(
        return_value={"result": {"list": []}}
    )
    exchange.fetch_closed_orders = AsyncMock(return_value=[])
    return exchange


# ===================================================================
# OKX Tests
# ===================================================================

class TestOKXFetchDailyPnl:
    """Tests for the OKX branch of fetch_daily_pnl."""

    @pytest.mark.asyncio
    async def test_basic_bill_aggregation(self):
        """Bills on the same day aggregate their pnl + fee into a single daily entry."""
        exchange = _make_okx_exchange()
        day1 = _ts(2024, 3, 15, 10)
        day1_later = _ts(2024, 3, 15, 14)
        day2 = _ts(2024, 3, 16, 9)

        bills = [
            _okx_bill("1", "50.0", "-2.0", day1),
            _okx_bill("2", "30.0", "-1.5", day1_later),
            _okx_bill("3", "-10.0", "-1.0", day2),
        ]

        # Return all bills on the first call for SWAP, empty for other types
        call_count = {"n": 0}

        async def mock_bills(params):
            call_count["n"] += 1
            if params.get("instType") == "SWAP" and call_count["n"] == 1:
                return {"data": bills}
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=mock_bills)

        # since_ms within 90 days skips archive
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)

        assert len(result) == 2
        # Day 1: (50 + -2) + (30 + -1.5) = 76.5
        day1_entry = next(r for r in result if "2024-03-15" in r["timestamp"])
        assert day1_entry["price"] == pytest.approx(76.5)
        assert day1_entry["side"] == "buy"  # positive PnL
        # Day 2: (-10 + -1) = -11
        day2_entry = next(r for r in result if "2024-03-16" in r["timestamp"])
        assert day2_entry["price"] == pytest.approx(11.0)  # abs value
        assert day2_entry["side"] == "sell"  # negative PnL

    @pytest.mark.asyncio
    async def test_since_ms_passed_to_recent_and_archive(self):
        """The since_ms filter (as 'begin' param) is forwarded to both recent and archive APIs."""
        exchange = _make_okx_exchange()

        # Use a since_ms older than 90 days so archive is also called
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=120)).timestamp() * 1000)

        recent_params_seen = []
        archive_params_seen = []

        async def capture_recent(params):
            recent_params_seen.append(dict(params))
            return {"data": []}

        async def capture_archive(params):
            archive_params_seen.append(dict(params))
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=capture_recent)
        exchange.private_get_account_bills_archive = AsyncMock(side_effect=capture_archive)

        await fetch_daily_pnl(exchange, since_ms)

        # Both recent and archive should receive begin=since_ms for all inst types
        for params in recent_params_seen:
            assert params["begin"] == str(since_ms)
        for params in archive_params_seen:
            assert params["begin"] == str(since_ms)
        # Should have called for each of the 4 instrument types
        inst_types_recent = {p["instType"] for p in recent_params_seen}
        inst_types_archive = {p["instType"] for p in archive_params_seen}
        assert inst_types_recent == {"SWAP", "FUTURES", "SPOT", "MARGIN"}
        assert inst_types_archive == {"SWAP", "FUTURES", "SPOT", "MARGIN"}

    @pytest.mark.asyncio
    async def test_bill_id_deduplication(self):
        """Bills appearing in both recent and archive are deduplicated by billId."""
        exchange = _make_okx_exchange()
        ts = _ts(2024, 1, 10, 12)
        shared_bill = _okx_bill("DUPE-001", "100.0", "-5.0", ts)

        call_count = {"recent": 0, "archive": 0}

        async def mock_recent(params):
            call_count["recent"] += 1
            if params.get("instType") == "SWAP" and call_count["recent"] == 1:
                return {"data": [shared_bill]}
            return {"data": []}

        async def mock_archive(params):
            call_count["archive"] += 1
            if params.get("instType") == "SWAP" and call_count["archive"] == 1:
                return {"data": [shared_bill]}  # same bill
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=mock_recent)
        exchange.private_get_account_bills_archive = AsyncMock(side_effect=mock_archive)

        # since_ms old enough to trigger archive
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=120)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)

        # Should be exactly 1 entry, not 2
        assert len(result) == 1
        assert result[0]["price"] == pytest.approx(95.0)  # 100 + (-5)

    @pytest.mark.asyncio
    async def test_90_day_gate_skips_archive(self):
        """When since_ms is within 90 days, archive API should NOT be called."""
        exchange = _make_okx_exchange()

        since_ms = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp() * 1000)
        await fetch_daily_pnl(exchange, since_ms)

        exchange.private_get_account_bills_archive.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_90_day_gate_fetches_archive_when_old(self):
        """When since_ms is older than 90 days, archive API IS called."""
        exchange = _make_okx_exchange()

        since_ms = int((datetime.now(timezone.utc) - timedelta(days=120)).timestamp() * 1000)
        await fetch_daily_pnl(exchange, since_ms)

        exchange.private_get_account_bills_archive.assert_awaited()

    @pytest.mark.asyncio
    async def test_90_day_gate_fetches_archive_when_no_since(self):
        """When since_ms is None (fetch all history), archive IS called."""
        exchange = _make_okx_exchange()

        await fetch_daily_pnl(exchange, since_ms=None)

        exchange.private_get_account_bills_archive.assert_awaited()

    @pytest.mark.asyncio
    async def test_pagination(self):
        """OKX pagination: pages until data is exhausted (< 100 results)."""
        exchange = _make_okx_exchange()
        ts_base = _ts(2024, 6, 1, 10)

        page1 = [_okx_bill(str(i), "10.0", "-0.5", ts_base + i * 1000) for i in range(100)]
        page2 = [_okx_bill(str(i + 100), "5.0", "-0.3", ts_base + (i + 100) * 1000) for i in range(30)]

        call_count = {"n": 0}

        async def mock_paginated(params):
            call_count["n"] += 1
            if params.get("instType") == "SWAP":
                if not params.get("after"):
                    return {"data": page1}
                else:
                    return {"data": page2}
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=mock_paginated)

        since_ms = int((datetime.now(timezone.utc) - timedelta(days=10)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)

        # All 130 bills on the same day aggregate to 1 entry
        assert len(result) == 1
        # Each page1 bill: 10 + (-0.5) = 9.5, page2 bill: 5 + (-0.3) = 4.7
        expected_pnl = 100 * 9.5 + 30 * 4.7
        assert result[0]["price"] == pytest.approx(expected_pnl)

    @pytest.mark.asyncio
    async def test_output_format(self):
        """Each daily PnL entry has the expected schema."""
        exchange = _make_okx_exchange()
        ts = _ts(2024, 5, 20, 8)

        async def mock_bills(params):
            if params.get("instType") == "SWAP":
                return {"data": [_okx_bill("1", "25.0", "-1.0", ts)]}
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=mock_bills)

        since_ms = int((datetime.now(timezone.utc) - timedelta(days=5)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)

        assert len(result) == 1
        entry = result[0]
        assert entry["exchange"] == "okx"
        assert entry["symbol"] == "PORTFOLIO"
        assert entry["order_type"] == "daily_pnl"
        assert entry["fee"] == 0
        assert entry["fee_currency"] == "USDT"
        assert entry["quantity"] == 1
        assert "2024-05-20" in entry["timestamp"]

    @pytest.mark.asyncio
    async def test_multiple_instrument_types(self):
        """Bills from different instrument types (SWAP, SPOT, etc.) all contribute to daily totals."""
        exchange = _make_okx_exchange()
        ts = _ts(2024, 4, 10, 12)

        async def mock_bills(params):
            inst = params.get("instType")
            if inst == "SWAP":
                return {"data": [_okx_bill("S1", "40.0", "-2.0", ts, "SWAP")]}
            elif inst == "SPOT":
                return {"data": [_okx_bill("SP1", "10.0", "-0.5", ts, "SPOT")]}
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=mock_bills)

        since_ms = int((datetime.now(timezone.utc) - timedelta(days=5)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)

        assert len(result) == 1
        # (40 + -2) + (10 + -0.5) = 47.5
        assert result[0]["price"] == pytest.approx(47.5)


# ===================================================================
# Binance Tests
# ===================================================================

class TestBinanceFetchDailyPnl:
    """Tests for the Binance branch of fetch_daily_pnl."""

    @pytest.mark.asyncio
    async def test_income_type_filtering(self):
        """Only REALIZED_PNL, COMMISSION, and FUNDING_FEE income types are included."""
        exchange = _make_binance_exchange()
        ts = _ts(2024, 3, 10, 14)

        income_data = [
            _binance_income("REALIZED_PNL", "150.0", "BTCUSDT", ts),
            _binance_income("COMMISSION", "-5.0", "BTCUSDT", ts + 1000),
            _binance_income("FUNDING_FEE", "-2.5", "ETHUSDT", ts + 2000),
            _binance_income("TRANSFER", "1000.0", "USDT", ts + 3000),  # excluded
            _binance_income("INTERNAL_TRANSFER", "500.0", "USDT", ts + 4000),  # excluded
        ]

        exchange.fapiPrivate_get_income = AsyncMock(return_value=income_data)

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 3  # only the 3 valid types
        symbols = [r["symbol"] for r in result]
        assert "BTCUSDT" in symbols
        assert "ETHUSDT" in symbols

    @pytest.mark.asyncio
    async def test_income_positive_and_negative(self):
        """Positive income maps to side='buy', negative to side='sell'."""
        exchange = _make_binance_exchange()
        ts = _ts(2024, 6, 1, 10)

        income_data = [
            _binance_income("REALIZED_PNL", "200.0", "BTCUSDT", ts),
            _binance_income("COMMISSION", "-8.0", "BTCUSDT", ts + 1000),
        ]

        exchange.fapiPrivate_get_income = AsyncMock(return_value=income_data)

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 2
        profit = next(r for r in result if r["price"] == pytest.approx(200.0))
        commission = next(r for r in result if r["price"] == pytest.approx(8.0))
        assert profit["side"] == "buy"
        assert commission["side"] == "sell"

    @pytest.mark.asyncio
    async def test_since_ms_passed_as_starttime(self):
        """The since_ms parameter is forwarded as 'startTime' to the Binance API."""
        exchange = _make_binance_exchange()
        since_ms = _ts(2024, 1, 1)

        await fetch_daily_pnl(exchange, since_ms)

        call_args = exchange.fapiPrivate_get_income.call_args
        params = call_args[0][0] if call_args[0] else call_args[1].get("params", {})
        assert params.get("startTime") == since_ms

    @pytest.mark.asyncio
    async def test_timestamp_conversion(self):
        """Epoch millisecond timestamps are converted to ISO format strings."""
        exchange = _make_binance_exchange()
        ts = _ts(2024, 7, 4, 12)  # 2024-07-04T12:00:00+00:00

        income_data = [_binance_income("REALIZED_PNL", "50.0", "BTCUSDT", ts)]
        exchange.fapiPrivate_get_income = AsyncMock(return_value=income_data)

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 1
        assert "2024-07-04" in result[0]["timestamp"]

    @pytest.mark.asyncio
    async def test_output_format(self):
        """Each Binance entry has the expected schema."""
        exchange = _make_binance_exchange()
        ts = _ts(2024, 2, 14, 9)

        income_data = [_binance_income("FUNDING_FEE", "-3.0", "ETHUSDT", ts)]
        exchange.fapiPrivate_get_income = AsyncMock(return_value=income_data)

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 1
        entry = result[0]
        assert entry["exchange"] == "binance"
        assert entry["symbol"] == "ETHUSDT"
        assert entry["order_type"] == "daily_pnl"
        assert entry["fee"] == 0
        assert entry["fee_currency"] == "USDT"
        assert entry["quantity"] == 1

    @pytest.mark.asyncio
    async def test_fallback_to_spot_trades(self):
        """When futures API fails, Binance falls back to fetch_my_trades for BTC/USDT."""
        exchange = _make_binance_exchange()
        exchange.fapiPrivate_get_income = AsyncMock(side_effect=Exception("Futures API unavailable"))

        mock_trades = [
            {
                "symbol": "BTC/USDT",
                "side": "buy",
                "price": 45000.0,
                "amount": 0.01,
                "fee": {"cost": 0.45, "currency": "USDT"},
                "datetime": "2024-03-01T10:00:00Z",
                "type": "market",
            }
        ]
        exchange.fetch_my_trades = AsyncMock(return_value=mock_trades)

        result = await fetch_daily_pnl(exchange, since_ms=_ts(2024, 3, 1))

        assert len(result) == 1
        assert result[0]["exchange"] == "binance"
        assert result[0]["symbol"] == "BTC/USDT"
        assert result[0]["price"] == 45000.0


# ===================================================================
# Bybit Tests
# ===================================================================

class TestBybitFetchDailyPnl:
    """Tests for the Bybit branch of fetch_daily_pnl."""

    @pytest.mark.asyncio
    async def test_basic_closed_pnl(self):
        """Bybit closed PnL records are correctly mapped to daily_pnl entries."""
        exchange = _make_bybit_exchange()
        ts = _ts(2024, 5, 10, 15)

        items = [
            _bybit_closed_pnl("BTCUSDT", "120.5", ts),
            _bybit_closed_pnl("ETHUSDT", "-30.0", ts + 60000),
        ]

        exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={"result": {"list": items}}
        )

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 2
        btc = next(r for r in result if r["symbol"] == "BTCUSDT")
        eth = next(r for r in result if r["symbol"] == "ETHUSDT")
        assert btc["price"] == pytest.approx(120.5)
        assert btc["side"] == "buy"  # positive PnL
        assert eth["price"] == pytest.approx(30.0)  # abs
        assert eth["side"] == "sell"  # negative PnL

    @pytest.mark.asyncio
    async def test_timestamp_conversion(self):
        """Epoch millisecond timestamps are converted to ISO format strings."""
        exchange = _make_bybit_exchange()
        ts = _ts(2024, 8, 15, 20)

        items = [_bybit_closed_pnl("BTCUSDT", "50.0", ts)]
        exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={"result": {"list": items}}
        )

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 1
        assert "2024-08-15" in result[0]["timestamp"]

    @pytest.mark.asyncio
    async def test_output_format(self):
        """Each Bybit entry has the expected schema."""
        exchange = _make_bybit_exchange()
        ts = _ts(2024, 9, 1, 8)

        items = [_bybit_closed_pnl("SOLUSDT", "15.0", ts)]
        exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={"result": {"list": items}}
        )

        result = await fetch_daily_pnl(exchange)

        assert len(result) == 1
        entry = result[0]
        assert entry["exchange"] == "bybit"
        assert entry["symbol"] == "SOLUSDT"
        assert entry["order_type"] == "daily_pnl"
        assert entry["fee"] == 0
        assert entry["fee_currency"] == "USDT"
        assert entry["quantity"] == 1

    @pytest.mark.asyncio
    async def test_api_failure_returns_empty(self):
        """When Bybit's closed PnL API fails, fetch_daily_pnl returns empty list (silent catch)."""
        exchange = _make_bybit_exchange()
        exchange.private_get_v5_position_closed_pnl = AsyncMock(
            side_effect=Exception("Bybit API error")
        )

        result = await fetch_daily_pnl(exchange)

        assert result == []


# ===================================================================
# General / Cross-Exchange Tests
# ===================================================================

class TestEmptyExchangeResponse:
    """All exchanges handle empty responses gracefully."""

    @pytest.mark.asyncio
    async def test_okx_empty_bills(self):
        exchange = _make_okx_exchange()
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=5)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)
        assert result == []

    @pytest.mark.asyncio
    async def test_binance_empty_income(self):
        exchange = _make_binance_exchange()
        result = await fetch_daily_pnl(exchange)
        assert result == []

    @pytest.mark.asyncio
    async def test_bybit_empty_closed_pnl(self):
        exchange = _make_bybit_exchange()
        result = await fetch_daily_pnl(exchange)
        assert result == []


class TestExchangeErrorHandling:
    """Exchange API errors (timeouts, rate limits) are handled gracefully."""

    @pytest.mark.asyncio
    async def test_okx_api_timeout(self):
        """OKX timeout on bills fetch should not crash -- returns whatever was collected."""
        exchange = _make_okx_exchange()
        exchange.private_get_account_bills = AsyncMock(
            side_effect=ccxt.RequestTimeout("OKX request timed out")
        )
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=5)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)
        # Should return empty (graceful degradation), not raise
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_okx_rate_limit(self):
        """OKX rate limit error is caught and handled gracefully."""
        exchange = _make_okx_exchange()
        exchange.private_get_account_bills = AsyncMock(
            side_effect=ccxt.RateLimitExceeded("Rate limit exceeded")
        )
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=5)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_binance_api_timeout(self):
        """Binance timeout falls back to spot trades, which also times out -- returns empty."""
        exchange = _make_binance_exchange()
        exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=ccxt.RequestTimeout("Binance timeout")
        )
        exchange.fetch_my_trades = AsyncMock(
            side_effect=ccxt.RequestTimeout("Binance timeout on spot")
        )
        result = await fetch_daily_pnl(exchange)
        assert result == []

    @pytest.mark.asyncio
    async def test_binance_rate_limit_falls_back(self):
        """Binance rate limit on futures triggers the spot fallback path."""
        exchange = _make_binance_exchange()
        exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=ccxt.RateLimitExceeded("Rate limit")
        )
        exchange.fetch_my_trades = AsyncMock(return_value=[])
        result = await fetch_daily_pnl(exchange)
        # Futures failed, so fallback should have been attempted
        exchange.fetch_my_trades.assert_awaited_once()
        assert result == []

    @pytest.mark.asyncio
    async def test_bybit_api_timeout(self):
        """Bybit timeout is silently caught (the except pass block)."""
        exchange = _make_bybit_exchange()
        exchange.private_get_v5_position_closed_pnl = AsyncMock(
            side_effect=ccxt.RequestTimeout("Bybit timeout")
        )
        result = await fetch_daily_pnl(exchange)
        assert result == []

    @pytest.mark.asyncio
    async def test_okx_partial_failure_preserves_collected_data(self):
        """If archive API fails but recent succeeded, we keep the recent bills."""
        exchange = _make_okx_exchange()
        ts = _ts(2024, 2, 1, 10)

        async def mock_recent(params):
            if params.get("instType") == "SWAP":
                return {"data": [_okx_bill("1", "75.0", "-3.0", ts)]}
            return {"data": []}

        exchange.private_get_account_bills = AsyncMock(side_effect=mock_recent)
        exchange.private_get_account_bills_archive = AsyncMock(
            side_effect=ccxt.RequestTimeout("Archive timed out")
        )

        # since_ms old enough that archive would be attempted
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=120)).timestamp() * 1000)
        result = await fetch_daily_pnl(exchange, since_ms)

        # Recent bill should still be present despite archive failure
        assert len(result) == 1
        assert result[0]["price"] == pytest.approx(72.0)  # 75 + (-3)
