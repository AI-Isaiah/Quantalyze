import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt.async_support as ccxt_async

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

    def test_bybit_disables_fetch_currencies(self):
        # Regression: PR following v0.21.0.0 — Bybit's read-only keys hit
        # 403 on /v5/asset/coin/query-info during load_markets, which ccxt
        # re-raises as RateLimitExceeded. We disable fetchCurrencies for
        # Bybit so load_markets stays usable with a pure-read key.
        # Found via Railway log archaeology (correlation_id
        # 10792caf-1d0b-4ed1-8a30-8ac66e03bbf9, 2026-05-05).
        exchange = create_exchange("bybit", "key", "secret")
        assert exchange.has.get("fetchCurrencies") is False, (
            "Bybit must disable fetchCurrencies; pure-read keys 403 on "
            "/v5/asset/coin/query-info"
        )

    def test_other_exchanges_keep_fetch_currencies_default(self):
        # Companion to test_bybit_disables_fetch_currencies — make sure
        # we only flipped the flag for Bybit, not Binance / OKX. Their
        # fetch_currencies endpoints are public-data and don't need
        # elevated scopes.
        for name in ["binance", "okx"]:
            exchange = create_exchange(name, "key", "secret")
            assert exchange.has.get("fetchCurrencies") is not False, (
                f"{name} should NOT have fetchCurrencies disabled"
            )


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

    @pytest.mark.asyncio
    async def test_load_markets_failure_does_not_reject_valid_key(self):
        # Regression: a flaky load_markets must NOT cause validate to
        # reject an otherwise-valid key. Real-world trigger:
        # Bybit's /v5/asset/coin/query-info returning 403 (permission /
        # geo-block) — observed against a real read-only key on Railway,
        # 2026-05-05. fetch_balance() is what truly validates; load_markets
        # is only a metadata prime that a bad-network or scope-restricted
        # key can survive without.
        # The post-Phase-18 contract: only ccxt.RateLimitExceeded and
        # ccxt.PermissionDenied get the swallow path — every other class
        # propagates so the outer error_code branches can fire. Use
        # RateLimitExceeded here because that's the documented Bybit
        # quirk this swallow-path was originally added for.
        exchange = MagicMock()
        exchange.id = "bybit"
        exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.RateLimitExceeded(
                "simulated 403 -> RateLimitExceeded on fetch_currencies"
            )
        )
        exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 100}})

        # Patch detect_permissions so we don't touch the real CCXT methods
        with patch("services.key_permissions.detect_permissions", new=AsyncMock(return_value={
            "read": True,
            "trade": False,
            "withdraw": False,
            "probe_error": False,
        })):
            result = await validate_key_permissions(exchange)

        # validation should succeed — load_markets failure was logged + swallowed
        assert result["valid"] is True, (
            "validate_key_permissions must not reject a key when only "
            "load_markets fails; fetch_balance is the real validator"
        )
        assert result["read_only"] is True
        # error should be None / falsy because fetch_balance succeeded and
        # detect_permissions returned read-only scopes
        assert not result["error"]
        exchange.load_markets.assert_awaited_once()
        exchange.fetch_balance.assert_awaited_once()
        # Defense-in-depth markers from Finding 3: callers can correlate
        # later trade-fetch failures back to a markets-not-loaded state.
        assert result["markets_loaded"] is False
        assert result["markets_error"] is not None
        assert "RateLimitExceeded" in result["markets_error"]

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "exc_cls,expected_error_code,expected_substring",
        [
            (ccxt_async.AuthenticationError, "AUTH_FAILED", "Authentication"),
            (ccxt_async.PermissionDenied, "PERMISSION_DENIED", "denied"),
            (ccxt_async.RateLimitExceeded, "RATE_LIMITED", "rate-limited"),
            (ccxt_async.DDoSProtection, "DDOS_PROTECTION", "edge"),
            (ccxt_async.ExchangeNotAvailable, "EXCHANGE_UNAVAILABLE", "unavailable"),
            (ccxt_async.NetworkError, "NETWORK_UNAVAILABLE", "Network"),
        ],
    )
    async def test_classifies_ccxt_subclasses_to_distinct_error_codes(
        self, exc_cls, expected_error_code, expected_substring
    ):
        """Finding 2 regression: validate_key_permissions must NOT collapse
        every post-load_markets failure into a single 'verify credentials'
        message. Each ccxt subclass maps to a distinct error_code +
        clearer human-readable message so the Next layer can route the
        right envelope and operators can tell genuine bad-key from
        infra failures.
        """
        exchange = MagicMock()
        exchange.id = "binance"
        # load_markets succeeds; the failure happens on fetch_balance so
        # the outer classification handlers fire.
        exchange.load_markets = AsyncMock(return_value={})
        exchange.fetch_balance = AsyncMock(side_effect=exc_cls("simulated"))

        result = await validate_key_permissions(exchange)

        assert result["valid"] is False
        assert result["error_code"] == expected_error_code, (
            f"{exc_cls.__name__} must map to error_code={expected_error_code!r}; "
            f"got {result['error_code']!r}"
        )
        assert result["error"] is not None
        assert expected_substring.lower() in result["error"].lower(), (
            f"{exc_cls.__name__} message must contain {expected_substring!r}; "
            f"got {result['error']!r}"
        )

    @pytest.mark.asyncio
    async def test_unexpected_error_uses_distinct_code(self):
        """The bare-except backstop must use a distinct error_code so the
        Next layer can render an 'unexpected' envelope rather than a
        misleading 'verify credentials' message.
        """
        exchange = MagicMock()
        exchange.id = "binance"
        exchange.load_markets = AsyncMock(return_value={})
        exchange.fetch_balance = AsyncMock(
            side_effect=ValueError("malformed response from exchange")
        )

        result = await validate_key_permissions(exchange)

        assert result["valid"] is False
        assert result["error_code"] == "VALIDATION_UNEXPECTED"
        # The "verify your credentials" string was the pre-fix
        # misdiagnosis — it must not appear on a non-credential error.
        assert "verify your credentials" not in (result["error"] or "").lower()

    @pytest.mark.asyncio
    async def test_load_markets_propagates_non_documented_exceptions(self):
        """Finding 3 regression: load_markets must only swallow the two
        documented ccxt classes (RateLimitExceeded for the Bybit 403
        quirk; PermissionDenied for scope-restricted markets-meta).
        Every other exception class — NetworkError, ExchangeNotAvailable,
        AuthenticationError, ValueError, etc. — must propagate to the
        outer classifier so the wizard gets a real error code.

        Pre-fix: a bare `except Exception` swallowed everything and
        continued to fetch_balance, which often cache-hit for transient
        infra failures, so the key passed validation but trade-fetch
        later collapsed with no breadcrumb.
        """
        exchange = MagicMock()
        exchange.id = "bybit"
        # Simulate a real network outage during load_markets — the post-
        # Finding-3 contract says this MUST propagate, get caught by the
        # outer NetworkError handler, and surface NETWORK_UNAVAILABLE.
        exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.NetworkError(
                "simulated TCP reset / DNS / TLS"
            )
        )
        # fetch_balance must NOT be called — propagation should short-
        # circuit before we reach it.
        exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 100}}
        )

        result = await validate_key_permissions(exchange)

        assert result["valid"] is False
        assert result["error_code"] == "NETWORK_UNAVAILABLE", (
            "load_markets NetworkError must propagate to the outer "
            "classifier, not be swallowed; got error_code="
            f"{result['error_code']!r}"
        )
        # Critical: pre-fix bug had load_markets failures cache-hit
        # fetch_balance and falsely validate. Post-fix, fetch_balance
        # is unreachable when load_markets raises an undocumented class.
        exchange.fetch_balance.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_load_markets_permission_denied_is_swallowed(self):
        """Finding 3: PermissionDenied is the second documented swallow-
        path class (scope-restricted markets-meta endpoint). Verify it
        joins RateLimitExceeded in the swallow set so a key without
        markets-meta scope still validates if fetch_balance succeeds."""
        exchange = MagicMock()
        exchange.id = "bybit"
        exchange.load_markets = AsyncMock(
            side_effect=ccxt_async.PermissionDenied(
                "simulated scope-restricted markets-meta"
            )
        )
        exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 100}}
        )

        with patch(
            "services.key_permissions.detect_permissions",
            new=AsyncMock(
                return_value={
                    "read": True,
                    "trade": False,
                    "withdraw": False,
                    "probe_error": False,
                }
            ),
        ):
            result = await validate_key_permissions(exchange)

        assert result["valid"] is True
        assert result["markets_loaded"] is False
        assert result["markets_error"] is not None
        assert "PermissionDenied" in result["markets_error"]

    @pytest.mark.asyncio
    async def test_result_includes_error_code_field_on_success(self):
        """Public-shape pin: result dict must always include an
        ``error_code`` key (None on success). Callers (Next layer) rely
        on key presence rather than a try/get."""
        exchange = MagicMock()
        exchange.id = "binance"
        exchange.load_markets = AsyncMock(return_value={})
        exchange.fetch_balance = AsyncMock(return_value={"total": {"USDT": 100}})

        with patch(
            "services.key_permissions.detect_permissions",
            new=AsyncMock(
                return_value={
                    "read": True,
                    "trade": False,
                    "withdraw": False,
                    "probe_error": False,
                }
            ),
        ):
            result = await validate_key_permissions(exchange)

        assert "error_code" in result
        assert result["error_code"] is None
        assert result["valid"] is True
        # Markets loaded successfully — defense-in-depth markers confirm.
        assert result["markets_loaded"] is True
        assert result["markets_error"] is None


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
