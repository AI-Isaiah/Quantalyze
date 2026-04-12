import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.exchange import create_exchange, validate_key_permissions


class TestCreateExchange:
    def test_supported_exchanges(self):
        for name in ["binance", "okx", "bybit"]:
            exchange = create_exchange(name, "key", "secret")
            assert exchange is not None
            assert exchange.id == name

    def test_unsupported_exchange_raises(self):
        with pytest.raises(ValueError, match="Unsupported"):
            create_exchange("kraken", "key", "secret")

    def test_okx_passphrase(self):
        exchange = create_exchange("okx", "key", "secret", "passphrase")
        assert exchange.password == "passphrase"

    def test_binance_no_passphrase(self):
        exchange = create_exchange("binance", "key", "secret")
        assert not exchange.password  # empty string or None


class TestValidateKeyPermissions:
    @pytest.mark.asyncio
    async def test_invalid_credentials_returns_auth_error(self):
        """Invalid API credentials should return an error, not crash."""
        exchange = create_exchange("binance", "invalid-key", "invalid-secret")
        result = await validate_key_permissions(exchange)
        # Should have an error message, not crash
        assert result["error"] is not None
        assert result["valid"] is False

    @pytest.mark.asyncio
    async def test_result_structure(self):
        """validate_key_permissions always returns a dict with valid, read_only, error."""
        exchange = create_exchange("binance", "test", "test")
        result = await validate_key_permissions(exchange)
        assert "valid" in result
        assert "read_only" in result
        assert "error" in result

    @pytest.mark.asyncio
    async def test_all_exchanges_handle_bad_keys(self):
        """Every supported exchange should handle bad credentials gracefully."""
        for name in ["binance", "okx", "bybit"]:
            exchange = create_exchange(name, "bad-key", "bad-secret", "bad-pass")
            result = await validate_key_permissions(exchange)
            # Must not crash, must return error
            assert result["error"] is not None, f"{name} did not return error for bad keys"
            assert isinstance(result["error"], str)


# ---------------------------------------------------------------------------
# fetch_raw_trades
# ---------------------------------------------------------------------------

class TestFetchRawTrades:
    """Tests for services.exchange.fetch_raw_trades.

    Each test mocks the CCXT exchange instance and (where needed) the
    supabase client so no real API calls or DB queries are made.
    """

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_okx_happy_path(self) -> None:
        """OKX fills_history returns 2 fills — verify normalized output."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-1",
                    "tradeId": "trade-1",
                    "execType": "T",
                    "posSide": "long",
                },
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "sell",
                    "fillPx": "61000",
                    "fillSz": "0.1",
                    "fee": "-0.61",
                    "feeCcy": "USDT",
                    "ts": "1700001000000",
                    "ordId": "ord-2",
                    "tradeId": "trade-2",
                    "execType": "M",
                    "posSide": "long",
                },
            ]
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        assert len(result) == 2
        assert result[0]["exchange"] == "okx"
        assert result[0]["symbol"] == "BTCUSDTSWAP"
        assert result[0]["side"] == "buy"
        assert result[0]["price"] == 60000.0
        assert result[0]["quantity"] == 0.1
        assert result[0]["fee"] == 0.6
        assert result[0]["is_fill"] is True
        assert result[0]["exchange_order_id"] == "ord-1"
        assert result[0]["exchange_fill_id"] == "trade-1"
        assert result[0]["is_maker"] is False  # execType "T" = taker
        assert result[1]["is_maker"] is True  # execType "M" = maker

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_binance_per_symbol(self) -> None:
        """Binance iterates per-symbol via fetch_my_trades."""
        import asyncio
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
        ])

        # Mock supabase to return symbols from both trades and position_snapshots
        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                mock_eq2.execute.return_value = MagicMock(data=[
                    {"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}
                ])
                mock_eq1.eq.return_value = mock_eq2
            else:
                mock_eq1.execute.return_value = MagicMock(data=[])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # fetch_my_trades called for each symbol
        assert mock_exchange.fetch_my_trades.await_count >= 1
        assert all(r["is_fill"] is True for r in result)

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_bybit_cursor(self) -> None:
        """Bybit execution_list with cursor pagination — 2 pages."""
        from services.exchange import fetch_raw_trades

        page1 = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "0.6",
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": "false",
                    },
                ],
                "nextPageCursor": "cursor-page2",
            }
        }
        page2 = {
            "result": {
                "list": [
                    {
                        "symbol": "ETHUSDT",
                        "side": "Sell",
                        "execPrice": "3000",
                        "execQty": "1",
                        "execFee": "0.3",
                        "feeCurrency": "USDT",
                        "execTime": "1700001000000",
                        "orderId": "ord-2",
                        "execId": "exec-2",
                        "isMaker": "true",
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            side_effect=[page1, page2]
        )

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        assert len(result) == 2
        assert result[0]["symbol"] == "BTCUSDT"
        assert result[0]["side"] == "buy"
        assert result[0]["is_fill"] is True
        assert result[1]["symbol"] == "ETHUSDT"
        assert result[1]["side"] == "sell"
        assert result[1]["is_maker"] is True
        # Verify cursor pagination: 2 calls
        assert mock_exchange.private_get_v5_execution_list.await_count == 2

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_binance_per_symbol_403(self) -> None:
        """One symbol returns 403 (PermissionDenied), others succeed.
        Verify partial results returned (not full failure)."""
        import asyncio
        from services.exchange import fetch_raw_trades
        import ccxt.async_support as ccxt_async

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        # First symbol succeeds, second raises 403
        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise ccxt_async.PermissionDenied("403 Forbidden")
            return [
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
            ]

        mock_exchange.fetch_my_trades = _fetch_my_trades

        # Mock supabase: return 2 symbols from trades table
        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                mock_eq2.execute.return_value = MagicMock(data=[
                    {"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}
                ])
                mock_eq1.eq.return_value = mock_eq2
            else:
                mock_eq1.execute.return_value = MagicMock(data=[])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # Should have partial results from BTCUSDT, not a full failure
        assert len(result) >= 1
        assert all(r["is_fill"] is True for r in result)

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_empty(self) -> None:
        """No fills returned — verify empty list."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": []
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)
        assert result == []

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_overlap_window(self) -> None:
        """Verify since_ms is subtracted by 3600000 (1 hour overlap window)."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        captured_params: list[dict] = []

        async def _capture_params(params):
            captured_params.append(dict(params))
            return {"data": []}

        mock_exchange.private_get_trade_fills_history = _capture_params

        mock_supabase = MagicMock()
        since_ms = 1700000000000  # arbitrary timestamp

        await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=since_ms
        )

        # The effective since should be since_ms - 3_600_000
        expected_effective = str(since_ms - 3_600_000)
        assert len(captured_params) >= 1
        assert captured_params[0].get("begin") == expected_effective
