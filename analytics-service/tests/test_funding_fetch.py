"""Tests for analytics-service/services/funding_fetch.py.

Exercises the three exchange-specific funding normalizers
(Binance fapiPrivate_get_income, OKX account_bills type=8, Bybit
v5_account_transaction_log SETTLEMENT) plus the top-level dispatcher.

All tests mock the CCXT async exchange — no network calls.
"""
from __future__ import annotations

from decimal import Decimal
from unittest.mock import AsyncMock

import pytest

from services.funding_fetch import (
    _bucket_8h,
    fetch_funding,
    fetch_funding_binance,
    fetch_funding_bybit,
    fetch_funding_okx,
)


STRATEGY_ID = "00000000-0000-0000-0000-000000000001"


# ---------------------------------------------------------------------------
# Binance
# ---------------------------------------------------------------------------

class TestFetchFundingBinance:
    @pytest.mark.asyncio
    async def test_single_page_two_rows(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.012345",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "abc123",
            },
            {
                "symbol": "ETHUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "0.005",
                "asset": "USDT",
                "time": 1700003000000,
                "tranId": "def456",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        first = rows[0]
        assert first["exchange"] == "binance"
        assert first["symbol"] == "BTCUSDT"
        assert first["strategy_id"] == STRATEGY_ID
        assert first["amount"] == Decimal("-0.012345")
        assert first["currency"] == "USDT"
        # Match key must be deterministic + include 8-hour bucket
        assert STRATEGY_ID in first["match_key"]
        assert "binance" in first["match_key"]
        assert "BTCUSDT" in first["match_key"]
        # Verify incomeType filter was passed to the API call
        call_args = mock_exchange.fapiPrivate_get_income.await_args
        params = call_args.args[0] if call_args.args else call_args.kwargs.get("params", {})
        assert params.get("incomeType") == "FUNDING_FEE"

    @pytest.mark.asyncio
    async def test_non_funding_rows_filtered_even_if_returned(self) -> None:
        """Defense in depth: even if the exchange returns a non-funding row,
        the normalizer must drop it."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "REALIZED_PNL",
                "income": "10.0",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "x1",
            },
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700003000000,
                "tranId": "x2",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 1
        assert rows[0]["amount"] == Decimal("-0.01")

    @pytest.mark.asyncio
    async def test_pagination_advances_startTime(self) -> None:
        """Second page request must advance startTime past the last row's timestamp."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"

        page1 = [
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "p1-1",
            },
        ] * 1000  # full page triggers pagination
        page2: list[dict] = []  # empty terminates

        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=[page1, page2]
        )
        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=1600000000000
        )
        # Should have made 2 calls (page1 full → fetch again, page2 empty → stop)
        assert mock_exchange.fapiPrivate_get_income.await_count == 2


# ---------------------------------------------------------------------------
# OKX
# ---------------------------------------------------------------------------

class TestFetchFundingOKX:
    @pytest.mark.asyncio
    async def test_single_page(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "type": "8",
                    "pnl": "-0.00234",
                    "ccy": "USDT",
                    "ts": "1700000000000",
                    "billId": "okx-bill-1",
                },
                {
                    "instId": "ETH-USDT-SWAP",
                    "type": "8",
                    "pnl": "0.0012",
                    "ccy": "USDT",
                    "ts": "1700003000000",
                    "billId": "okx-bill-2",
                },
            ]
        })

        rows = await fetch_funding_okx(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        assert rows[0]["exchange"] == "okx"
        # Symbol normalized: hyphen stripped to match funding_fees.symbol usage
        assert rows[0]["symbol"] == "BTCUSDTSWAP"
        assert rows[0]["amount"] == Decimal("-0.00234")
        assert rows[0]["currency"] == "USDT"
        # type=8 param was passed
        call_args = mock_exchange.private_get_account_bills.await_args
        params = call_args.args[0] if call_args.args else call_args.kwargs.get("params", {})
        assert params.get("type") == "8"

    @pytest.mark.asyncio
    async def test_empty_data(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(return_value={"data": []})
        rows = await fetch_funding_okx(mock_exchange, STRATEGY_ID, since_ms=None)
        assert rows == []


# ---------------------------------------------------------------------------
# Bybit (new endpoint)
# ---------------------------------------------------------------------------

class TestFetchFundingBybit:
    @pytest.mark.asyncio
    async def test_uses_transaction_log_endpoint(self) -> None:
        """Bybit funding is fetched from v5/account/transaction-log with type
        filter for SETTLEMENT/funding entries — NOT from the closed_pnl
        endpoint that mixes realized PnL."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "type": "SETTLEMENT",
                            "funding": "-0.0123",
                            "currency": "USDT",
                            "transactionTime": "1700000000000",
                            "id": "bybit-tx-1",
                        },
                        {
                            "symbol": "ETHUSDT",
                            "type": "SETTLEMENT",
                            "funding": "0.004",
                            "currency": "USDT",
                            "transactionTime": "1700003000000",
                            "id": "bybit-tx-2",
                        },
                    ],
                    "nextPageCursor": "",
                }
            }
        )

        rows = await fetch_funding_bybit(
            mock_exchange, STRATEGY_ID, since_ms=1699000000000
        )

        assert len(rows) == 2
        assert rows[0]["exchange"] == "bybit"
        assert rows[0]["symbol"] == "BTCUSDT"
        assert rows[0]["amount"] == Decimal("-0.0123")
        assert rows[0]["currency"] == "USDT"
        assert mock_exchange.private_get_v5_account_transaction_log.await_count == 1

    @pytest.mark.asyncio
    async def test_cursor_pagination(self) -> None:
        page1 = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "type": "SETTLEMENT",
                        "funding": "-0.01",
                        "currency": "USDT",
                        "transactionTime": "1700000000000",
                        "id": "p1",
                    }
                ],
                "nextPageCursor": "cursor-page2",
            }
        }
        page2 = {
            "result": {
                "list": [
                    {
                        "symbol": "ETHUSDT",
                        "type": "SETTLEMENT",
                        "funding": "0.02",
                        "currency": "USDT",
                        "transactionTime": "1700003000000",
                        "id": "p2",
                    }
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            side_effect=[page1, page2]
        )
        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 2
        assert mock_exchange.private_get_v5_account_transaction_log.await_count == 2


# ---------------------------------------------------------------------------
# Top-level fetch_funding dispatcher
# ---------------------------------------------------------------------------

class TestFetchFundingDispatcher:
    @pytest.mark.asyncio
    async def test_unsupported_exchange_raises(self) -> None:
        with pytest.raises(ValueError, match="Unsupported"):
            await fetch_funding(
                "kraken", "key", "secret", STRATEGY_ID, since_ms=None
            )


# ---------------------------------------------------------------------------
# Match key determinism
# ---------------------------------------------------------------------------

class TestMatchKeyDeterminism:
    @pytest.mark.asyncio
    async def test_same_8h_bucket_same_key(self) -> None:
        """Two funding events in the same 8-hour window for the same
        (strategy, exchange, symbol) must produce the same match_key,
        so UPSERT ON CONFLICT DO NOTHING dedups."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        # Both timestamps fall in the same 8h bucket starting at 1700006400000
        # (1700006400 = 2023-11-15 00:00:00 UTC, so 00:01 and 07:59 both in 00:00-08:00 bucket).
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700006460000,  # 00:01:00 UTC
                "tranId": "a",
            },
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700034000000,  # 07:40:00 UTC (same 00-08 bucket)
                "tranId": "b",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert len(rows) == 2
        assert rows[0]["match_key"] == rows[1]["match_key"]

    @pytest.mark.asyncio
    async def test_different_symbols_different_keys(self) -> None:
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(return_value=[
            {
                "symbol": "BTCUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "a",
            },
            {
                "symbol": "ETHUSDT",
                "incomeType": "FUNDING_FEE",
                "income": "-0.01",
                "asset": "USDT",
                "time": 1700000000000,
                "tranId": "b",
            },
        ])

        rows = await fetch_funding_binance(
            mock_exchange, STRATEGY_ID, since_ms=None
        )
        assert rows[0]["match_key"] != rows[1]["match_key"]


# ---------------------------------------------------------------------------
# I6 additional tests
# ---------------------------------------------------------------------------

class TestBinanceSwallowExchangeError:
    @pytest.mark.asyncio
    async def test_binance_swallow_exchange_error(self) -> None:
        """Exchange error on first page → swallowed, returns []."""
        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=Exception("network timeout")
        )
        rows = await fetch_funding_binance(mock_exchange, STRATEGY_ID, since_ms=None)
        assert rows == []


class TestOKXArchiveEndpoint:
    @pytest.mark.asyncio
    async def test_okx_calls_archive_endpoint_for_old_since(self) -> None:
        """since_ms older than 90d → archive endpoint must be awaited."""
        from datetime import datetime, timezone
        import time

        old_since_ms = int(
            (datetime.now(timezone.utc).timestamp() - 100 * 86400) * 1000
        )
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": []}
        )
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": []}
        )

        await fetch_funding_okx(mock_exchange, STRATEGY_ID, since_ms=old_since_ms)

        mock_exchange.private_get_account_bills_archive.assert_awaited()

    @pytest.mark.asyncio
    async def test_okx_dedups_archive_overlap(self) -> None:
        """Same row returned from both recent + archive → deduped to len=1."""
        shared_row = {
            "instId": "BTC-USDT-SWAP",
            "type": "8",
            "pnl": "-0.01",
            "ccy": "USDT",
            "ts": "1700000000000",
            "billId": "shared-bill",
        }
        from datetime import datetime, timezone

        old_since_ms = int(
            (datetime.now(timezone.utc).timestamp() - 100 * 86400) * 1000
        )
        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        # Both endpoints return the same row → match_key dedup keeps 1
        mock_exchange.private_get_account_bills = AsyncMock(
            return_value={"data": [shared_row]}
        )
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            return_value={"data": [shared_row]}
        )

        rows = await fetch_funding_okx(mock_exchange, STRATEGY_ID, since_ms=old_since_ms)
        assert len(rows) == 1


class TestBybitChangeFallback:
    @pytest.mark.asyncio
    async def test_bybit_falls_back_to_change_field(self) -> None:
        """When 'funding' is absent, Bybit parser falls back to 'change' field."""
        from decimal import Decimal

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_account_transaction_log = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "type": "SETTLEMENT",
                            # No 'funding' key — falls back to 'change'
                            "change": "-0.0055",
                            "currency": "USDT",
                            "transactionTime": "1700000000000",
                            "id": "bybit-fallback",
                        }
                    ],
                    "nextPageCursor": "",
                }
            }
        )

        rows = await fetch_funding_bybit(mock_exchange, STRATEGY_ID, since_ms=None)
        assert len(rows) == 1
        assert rows[0]["amount"] == Decimal("-0.0055")


class TestBucket8hBoundary:
    def test_bucket_8h_boundary(self) -> None:
        """07:59:59 and 08:00:00 must fall in different buckets."""
        from datetime import datetime, timezone

        ts_before = datetime(2024, 1, 1, 7, 59, 59, tzinfo=timezone.utc)
        ts_on = datetime(2024, 1, 1, 8, 0, 0, tzinfo=timezone.utc)

        bucket_before = _bucket_8h(ts_before)
        bucket_on = _bucket_8h(ts_on)

        assert bucket_before != bucket_on
        assert "T00:" in bucket_before  # 00:00 window
        assert "T08:" in bucket_on      # 08:00 window
