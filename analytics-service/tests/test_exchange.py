import pytest
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import ccxt.async_support as ccxt_async

from services.exchange import create_exchange, validate_key_permissions


def _attach_paginated_chain(builder: MagicMock, rows: list[dict]) -> None:
    """Mount a chainable ``.order().range().execute()`` on ``builder`` so it
    behaves like a PostgREST builder that's been drained by
    ``paginated_select`` — the first ``.range()`` returns ``rows``,
    subsequent calls return an empty list (short-page natural stop).
    """
    state = {"called": False}

    def _range(start, end):
        sliced = MagicMock()
        if not state["called"]:
            state["called"] = True
            sliced.execute.return_value = MagicMock(data=rows)
        else:
            sliced.execute.return_value = MagicMock(data=[])
        return sliced

    order = MagicMock()
    order.range.side_effect = _range
    order.order.return_value = order
    builder.order.return_value = order


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
        # Audit-2026-05-07 H-0671 — fee is the signed value from the
        # exchange. The fixture uses fee="-0.6" (a maker rebate) and the
        # post-fix branch persists it unchanged so downstream
        # ``realized_pnl = ... - total_fees`` reduces by the rebate
        # instead of inflating the apparent fee via abs().
        assert result[0]["fee"] == -0.6
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
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
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
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
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


# ---------------------------------------------------------------------------
# Audit-2026-05-07 G12.B.* regression tests
# ---------------------------------------------------------------------------


class TestG12BColdStart:
    """Audit-2026-05-07 G12.B.1 — Binance cold-start failure must raise."""

    @pytest.mark.asyncio
    async def test_cold_start_position_fetch_failure_raises_typed(self) -> None:
        """Pre-fix: cold-start fetch_positions failure was logged as a
        warning and the function continued with symbols=[], yielding an
        empty fills list that callers treated as success. Post-fix: a
        typed ColdStartSymbolDiscoveryError must propagate so the caller
        can mark the sync_trades job for retry instead of cementing a
        false-success state."""
        import asyncio
        from services.exchange import (
            ColdStartSymbolDiscoveryError,
            fetch_raw_trades,
        )

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_positions = AsyncMock(
            side_effect=Exception("simulated 401 from /fapi/v2/positionRisk")
        )

        # supabase returns NO existing symbols → triggers cold-start path.
        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            _attach_paginated_chain(mock_eq2, [])
            _attach_paginated_chain(mock_eq1, [])
            mock_eq1.eq.return_value = mock_eq2
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with pytest.raises(ColdStartSymbolDiscoveryError):
                await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

    @pytest.mark.asyncio
    async def test_cold_start_no_open_positions_raises_typed(self) -> None:
        """Closed-position edge case: cold-start where fetch_positions
        succeeds but returns 0 open positions. Pre-fix this looked like
        success-with-zero-fills. Post-fix it must raise so the caller
        knows symbol discovery yielded nothing."""
        import asyncio
        from services.exchange import (
            ColdStartSymbolDiscoveryError,
            fetch_raw_trades,
        )

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        # All positions flat (contracts=0) → no symbols discovered.
        mock_exchange.fetch_positions = AsyncMock(return_value=[
            {"symbol": "BTC/USDT:USDT", "contracts": 0},
            {"symbol": "ETH/USDT:USDT", "contracts": 0},
        ])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            _attach_paginated_chain(mock_eq2, [])
            _attach_paginated_chain(mock_eq1, [])
            mock_eq1.eq.return_value = mock_eq2
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with pytest.raises(
                ColdStartSymbolDiscoveryError,
                match="no symbols discovered",
            ):
                await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)


class TestG12BBinanceConcurrency:
    """Audit-2026-05-07 G12.B.3 — fan-out per-symbol fetch via gather."""

    @pytest.mark.asyncio
    async def test_binance_per_symbol_uses_asyncio_gather(self) -> None:
        """Pre-fix the per-symbol loop ran sequentially. Post-fix it must
        use asyncio.gather with bounded concurrency. We patch
        asyncio.gather and assert it was called."""
        import asyncio
        import services.exchange as exchange_mod
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [
                        {"symbol": "BTCUSDT"},
                        {"symbol": "ETHUSDT"},
                        {"symbol": "SOLUSDT"},
                    ],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        # Wrap real asyncio.gather so we can assert it fires.
        real_gather = asyncio.gather
        gather_calls: list[int] = []

        async def _spy_gather(*tasks, **kwargs):
            gather_calls.append(len(tasks))
            return await real_gather(*tasks, **kwargs)

        with patch("services.db.db_execute", side_effect=_mock_db_execute), \
             patch.object(exchange_mod.asyncio, "gather", new=_spy_gather):
            await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        # Must have called asyncio.gather at least once with all 3 tasks.
        assert any(n >= 3 for n in gather_calls), (
            f"expected asyncio.gather called with >=3 tasks; got {gather_calls!r}"
        )

    @pytest.mark.asyncio
    async def test_binance_per_symbol_partial_failure_logs_and_continues(
        self,
    ) -> None:
        """When one symbol fails, gather(return_exceptions=True) catches
        it; the function logs a warning matching the prior shape and
        returns successful results for the other symbols."""
        import asyncio
        import logging
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise RuntimeError("simulated 500")
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

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "warning",
            ) as mock_warn:
                result = await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

        # 1 successful symbol → 1 fill; failed symbol logged.
        assert len(result) == 1
        assert any(
            "Binance fetch_my_trades failed for" in str(call)
            for call in mock_warn.call_args_list
        )

    @pytest.mark.asyncio
    async def test_binance_per_symbol_cancellation_propagates(self) -> None:
        """Adversarial-review regression (PR #137 follow-up).

        On Python 3.11+, asyncio.gather(return_exceptions=True) captures
        CancelledError as a result item rather than re-raising. If the
        parent task gets cancelled (15-min handler timeout, worker
        shutdown, signal), every per-symbol task receives CancelledError,
        gather "succeeds" with N exception items, and pre-fix the
        function returned an empty fills list — the same false-success
        outcome the audit named.

        Fix: scan results for CancelledError and re-raise so the outer
        wait_for / shutdown propagates correctly. This test patches
        asyncio.gather to return CancelledError items and asserts the
        function re-raises CancelledError instead of swallowing it.
        """
        import asyncio
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        # Force gather to return CancelledError items as if the parent
        # was cancelled mid-fan-out. This mirrors the Python 3.11+ behavior
        # of asyncio.gather(return_exceptions=True).
        cancellation_results = [
            asyncio.CancelledError("simulated parent cancel"),
            asyncio.CancelledError("simulated parent cancel"),
        ]

        async def _fake_gather(*tasks, return_exceptions=False):
            # Drain the coroutines so they don't leak as 'never awaited'
            # warnings during cleanup.
            for t in tasks:
                t.close()
            return cancellation_results

        with patch("services.exchange.asyncio.gather", new=_fake_gather):
            with pytest.raises(asyncio.CancelledError):
                await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

    @pytest.mark.asyncio
    async def test_binance_per_symbol_total_failure_raises_typed(self) -> None:
        """When EVERY per-symbol fetch fails, the function previously
        returned an empty fills list — same false-success outcome that
        ColdStartSymbolDiscoveryError eliminates. Post-fix, total
        per-symbol failure must raise BinancePerSymbolFetchError so the
        worker marks the job failed_retry."""
        import asyncio
        from services.exchange import (
            BinancePerSymbolFetchError,
            fetch_raw_trades,
        )

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _always_fail(symbol, since=None, limit=None):
            raise RuntimeError(f"simulated 500 for {symbol}")

        mock_exchange.fetch_my_trades = _always_fail

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with pytest.raises(BinancePerSymbolFetchError) as exc_info:
                await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )
        # Both failed symbols must be reported.
        assert sorted(exc_info.value.failed_symbols) == ["BTCUSDT", "ETHUSDT"]
        assert isinstance(exc_info.value.first_error, RuntimeError)

    @pytest.mark.asyncio
    async def test_binance_per_symbol_partial_failure_does_not_raise(
        self,
    ) -> None:
        """The partial-success contract must survive: when SOME (not
        all) symbols fail, fills from the successful symbols are
        returned and a per-symbol-failure summary is logged. A
        regression that promoted partial failure to a raise would
        break the existing test_binance_per_symbol_partial_failure
        contract; this test pins both directions explicitly."""
        import asyncio
        import logging
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            if "ETH" in symbol:
                raise RuntimeError("simulated 500")
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

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "warning",
            ) as mock_warn:
                result = await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

        # Partial success — BTCUSDT's fill landed.
        assert len(result) == 1
        # Per-symbol failure logged AND summary logged. Use call.args to
        # inspect the separate args (str(call) shows the format string,
        # not the rendered message).
        per_symbol_logged = any(
            "Binance fetch_my_trades failed for" in str(c.args[0])
            and "ETHUSDT" in c.args
            for c in mock_warn.call_args_list
        )
        summary_logged = any(
            "symbols failed" in str(c.args[0]) and c.args[1:] == (1, 2)
            for c in mock_warn.call_args_list
        )
        assert per_symbol_logged
        assert summary_logged, (
            "partial failure must log a count summary so bad-symbol rate is visible"
        )

    @pytest.mark.asyncio
    async def test_binance_semaphore_does_not_serialize_per_symbol_pages(
        self,
    ) -> None:
        """Phase A moved ``async with sem:`` from outside the per-page
        loop to inside the network call. A regression that re-wraps
        the entire 20-page loop would still let ``asyncio.gather``
        fire 5 tasks concurrently but would force each symbol to hold
        a slot for all 20 RTTs — the test below proves page-1 of
        symbol B can complete BEFORE page-2 of symbol A by
        instrumenting the call ordering."""
        import asyncio
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}

        # Two symbols, each needing 2 pages. Tracks call ORDER per symbol.
        page_counts: dict[str, int] = {}
        call_log: list[str] = []
        page_2_started = asyncio.Event()

        async def _fetch_my_trades(symbol, since=None, limit=None):
            page_counts[symbol] = page_counts.get(symbol, 0) + 1
            page = page_counts[symbol]
            call_log.append(f"{symbol}-p{page}")
            # Page 1 of symbol A waits for page 1 of symbol B to start
            # before returning, proving they ran concurrently. Page-2
            # tracking signals interleaving: symbol B's page 2 should
            # be able to fire before symbol A's page 2 if the
            # semaphore is per-call (Phase A) rather than per-loop.
            if page == 1:
                # Return a full page so a second page is needed.
                if symbol == "BTCUSDT":
                    # A short delay so B can interleave.
                    await asyncio.sleep(0.01)
                page_2_started.set()
                return [
                    {
                        "symbol": "BTC/USDT:USDT",
                        "side": "buy",
                        "price": 60000.0,
                        "amount": 0.1,
                        "datetime": "2024-01-01T00:00:00Z",
                        "order": f"ord-{symbol}-{i}",
                        "id": f"fill-{symbol}-{i}",
                        "fee": {"cost": 0.6, "currency": "USDT"},
                        "takerOrMaker": "taker",
                        "timestamp": 1700000000000 + i,
                        "info": {},
                    }
                    for i in range(1000)  # full page → triggers page 2
                ]
            return []  # short page → end loop

        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(
                    mock_eq2,
                    [{"symbol": "BTCUSDT"}, {"symbol": "ETHUSDT"}],
                )
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Both symbols ran 2 pages each.
        assert page_counts == {"BTCUSDT": 2, "ETHUSDT": 2}
        # Concurrency proof: ETHUSDT-p1 must appear in call_log
        # BEFORE BTCUSDT-p2 (i.e., page-1 fan-out completes for both
        # symbols before BTCUSDT advances to page-2). With per-loop
        # semaphore + sem=2+ that's preserved; with per-loop semaphore
        # + sem=1 it would serialize — but per-call semaphore (current
        # behavior) guarantees this regardless of sem size. We test
        # the strong invariant.
        eth_p1_idx = call_log.index("ETHUSDT-p1")
        btc_p2_idx = call_log.index("BTCUSDT-p2")
        assert eth_p1_idx < btc_p2_idx, (
            f"ETHUSDT-p1 must complete before BTCUSDT-p2 (per-call semaphore). "
            f"call_log={call_log}"
        )


class TestG12BFillRowFactory:
    """Audit-2026-05-07 G12.B.4 — _make_fill_dict + posSide whitelist."""

    def test_make_fill_dict_returns_required_keys(self) -> None:
        from services.exchange import _make_fill_dict

        out = _make_fill_dict(
            exchange="okx",
            symbol="BTCUSDT",
            side="buy",
            price=60000.0,
            quantity=0.1,
            fee=0.6,
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="fill-1",
            is_maker=False,
            raw_data={"foo": "bar"},
            position_direction="long",
        )
        required = {
            "exchange", "symbol", "side", "price", "quantity",
            "fee", "fee_currency", "timestamp", "order_type",
            "exchange_order_id", "exchange_fill_id", "is_fill",
            "is_maker", "cost", "raw_data",
        }
        assert required.issubset(set(out.keys()))
        # cost must derive from price * quantity.
        assert out["cost"] == 60000.0 * 0.1
        assert out["is_fill"] is True
        # position_direction stashed into raw_data, not a top-level key.
        assert out["raw_data"]["position_direction"] == "long"

    def test_make_fill_dict_skips_position_direction_when_none(self) -> None:
        from services.exchange import _make_fill_dict

        out = _make_fill_dict(
            exchange="bybit",
            symbol="BTCUSDT",
            side="sell",
            price=60000.0,
            quantity=0.1,
            fee=0.6,
            fee_currency="USDT",
            timestamp="2024-01-01T00:00:00+00:00",
            exchange_order_id="ord-1",
            exchange_fill_id="fill-1",
            is_maker=True,
            raw_data={"foo": "bar"},
            position_direction=None,
        )
        # When direction is None, raw_data must not be mutated.
        assert "position_direction" not in (out["raw_data"] or {})

    @pytest.mark.asyncio
    async def test_okx_valid_pos_side_preserved(self) -> None:
        """OKX with valid posSide=short must end up in raw_data."""
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "sell",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-1",
                    "tradeId": "trade-1",
                    "execType": "T",
                    "posSide": "short",
                },
            ]
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        assert result[0]["raw_data"]["posSide"] == "short"
        assert result[0]["raw_data"]["position_direction"] == "short"

    @pytest.mark.asyncio
    async def test_okx_bogus_pos_side_logged_and_dropped(self) -> None:
        """An out-of-whitelist posSide value must be coerced to None,
        with a warning logged. raw_data must NOT carry the invalid value
        as posSide (we only stamp the whitelisted ones)."""
        import logging
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "sell",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-1",
                    "tradeId": "trade-1",
                    "execType": "T",
                    "posSide": "bogus",
                },
            ]
        })

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        assert len(result) == 1
        # No position_direction stamped into raw_data when bogus.
        assert "position_direction" not in result[0]["raw_data"]
        # Warning fired with the expected text.
        assert any(
            "invalid posSide" in str(call)
            for call in mock_warn.call_args_list
        )


class TestG12BOverlapWindow:
    """Audit-2026-05-07 G12.B.5 — codify overlap behavior at boundaries."""

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_late_arriving_fill_outside_overlap(
        self,
    ) -> None:
        """If the exchange returns a fill whose timestamp predates the
        overlap window (since_ms - 7_200_000, i.e. 2h before window),
        current behavior is to capture it (we don't filter on the client
        side; dedup via partial unique index handles re-runs). This test
        codifies that contract — a future change that adds a hard filter
        must update this assertion intentionally.
        """
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"

        late_ts_ms = 1700000000000 - 7_200_000  # 2h before "since"

        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    "ts": str(late_ts_ms),
                    "ordId": "ord-late",
                    "tradeId": "trade-late",
                    "execType": "T",
                },
            ]
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=1700000000000
        )

        # Late-arriving fill IS captured today (overlap window is a
        # request-side hint, not a client-side filter).
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "trade-late"

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_dst_boundary_no_double_count(
        self,
    ) -> None:
        """A fill at a DST-boundary timestamp must NOT be double-counted.
        We model this by returning the same fill twice (same tradeId);
        the function returns both entries (dedup is at the DB layer via
        partial unique index, not in fetch_raw_trades). But the count
        must remain stable across calls, never silently expanding."""
        from services.exchange import fetch_raw_trades

        # Spring-forward 2024 in US Eastern: 2024-03-10 02:00 -> 03:00
        # local. UTC of equivalent moment ~ 2024-03-10T07:00:00Z =
        # 1710054000000 ms. The contract: a single fill with that
        # timestamp returns exactly one row, even on repeat calls.
        dst_ts_ms = 1710054000000

        page = {
            "data": [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    "ts": str(dst_ts_ms),
                    "ordId": "ord-dst",
                    "tradeId": "trade-dst",
                    "execType": "T",
                },
            ]
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        first = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=dst_ts_ms
        )
        second = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=dst_ts_ms
        )

        assert len(first) == 1
        assert len(second) == 1
        # Identity of the fill must be stable across runs — no silent
        # duplication of the same (exchange_fill_id, timestamp) tuple.
        assert first[0]["exchange_fill_id"] == second[0]["exchange_fill_id"]
        assert first[0]["timestamp"] == second[0]["timestamp"]


class TestG12BPaginationGuards:
    """Audit-2026-05-07 G12.B.6 — stuck-cursor + page-cap warnings."""

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_bybit_stuck_cursor_terminates(
        self,
    ) -> None:
        """Bybit returning the SAME nextPageCursor on every call must
        trigger early termination + a warning, not 100 iterations of
        duplicate fills."""
        import logging
        from services.exchange import fetch_raw_trades

        page = {
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
                "nextPageCursor": "STUCK",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        # Always return the same page with the same cursor.
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Loop must terminate before the 100-page cap.
        assert mock_exchange.private_get_v5_execution_list.await_count < 100
        # Stuck-cursor warning must have fired.
        assert any(
            "Pagination stuck" in str(call) and "bybit" in str(call)
            for call in mock_warn.call_args_list
        )
        # We get exactly 2 fills: one from page 1, one from page 2 (which
        # shows up as stuck on the third try).
        assert len(result) >= 1

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_okx_empty_tradeId_on_full_page_terminates(
        self,
    ) -> None:
        """OKX with empty tradeId on the LAST row of a FULL (100-fill) page
        must trigger the stuck-cursor guard and log a warning.

        Adversarial-review hardening (PR #137 follow-up): the previous
        test exercised this guard on a 1-fill page, but a short page is
        a legitimate end-of-data signal — firing the stuck warning there
        is a false positive. The guard now ONLY fires on full pages
        (where stuck cursor would otherwise loop until the page cap).
        """
        import logging
        from services.exchange import fetch_raw_trades

        # Build a full 100-fill page where the last row has empty tradeId.
        fills = []
        for i in range(99):
            fills.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": "1700000000000",
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })
        # Tail row carries empty tradeId — that's the stuck signal.
        fills.append({
            "instId": "BTC-USDT-SWAP",
            "side": "buy",
            "fillPx": "60000",
            "fillSz": "0.1",
            "fee": "-0.6",
            "feeCcy": "USDT",
            "ts": "1700000000000",
            "ordId": "ord-tail",
            "tradeId": "",
            "execType": "T",
        })
        page = {"data": fills}

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Only one call before bail-out (the stuck guard short-circuits).
        assert mock_exchange.private_get_trade_fills_history.await_count == 1
        # Stuck-cursor warning fired with okx tag.
        assert any(
            "Pagination stuck" in str(call) and "okx" in str(call)
            for call in mock_warn.call_args_list
        )
        # All 100 fills captured before the guard fires.
        assert len(result) == 100

    @pytest.mark.asyncio
    async def test_fetch_raw_trades_okx_short_page_no_false_stuck_warning(
        self,
    ) -> None:
        """OKX short final page (<100 fills) sharing tradeId with prior
        page's cursor must NOT fire the stuck-cursor warning. The
        natural-break exit (`len(data) < 100`) takes precedence so we
        don't poison operator logs with false-positive 'stuck' warnings
        on legitimate end-of-data boundaries.

        Adversarial-review regression (PR #137 follow-up). Pre-fix, a
        legitimate short final page would log 'Pagination stuck' AND
        also suppress the page-cap warning (because natural_break=True),
        masking real truncation."""
        import logging
        from services.exchange import fetch_raw_trades

        # Single short page with 1 fill — natural end-of-data.
        page = {
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
                    "tradeId": "",  # would have tripped pre-fix
                    "execType": "T",
                },
            ]
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        assert len(result) == 1
        # No stuck-cursor warning — short page is the natural exit, not a stuck signal.
        assert not any(
            "Pagination stuck" in str(call) for call in mock_warn.call_args_list
        ), f"Short final page must not log stuck warning. Saw: {mock_warn.call_args_list}"


class TestG12BBybitIsMaker:
    """Audit-2026-05-07 G12.B.9 — coerce isMaker to bool across types."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "raw_value,expected",
        [
            (True, True),
            ("true", True),
            ("True", True),
            ("TRUE", True),
            (False, False),
            ("false", False),
            (None, False),
            # Empty string was previously caught as False by `== 'true'`
            # but isn't a documented Bybit shape; pin the safe-default so
            # a future refactor cannot promote empty strings to True.
            ("", False),
        ],
    )
    async def test_bybit_is_maker_handles_bool_and_string(
        self, raw_value, expected
    ) -> None:
        from services.exchange import fetch_raw_trades

        page = {
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
                        "isMaker": raw_value,
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        assert result[0]["is_maker"] is expected


# ─── audit-2026-05-07 #9 — fetch_usdt_balance_with_status regression ────


class TestFetchUsdtBalanceWithStatus:
    """Audit-2026-05-07 #9 — pre-fix `fetch_usdt_balance` collapsed
    "balance unavailable due to error" and "balance legitimately not
    provided" into a bare None. The new `fetch_usdt_balance_with_status`
    distinguishes them so the caller can set
    `data_quality_flags.balance_error = True` AND
    `strategy_analytics.computation_status = 'complete_with_warnings'`
    when a transient exchange-API failure forces the heuristic-capital
    fallback path. These tests lock the contract."""

    @pytest.mark.asyncio
    async def test_success_returns_balance_and_no_error(self):
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 12345.67}}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance == 12345.67
        assert balance_error is False

    @pytest.mark.asyncio
    async def test_exchange_api_exception_returns_none_with_error_true(
        self,
    ):
        """The audit's headline case: a transient OKX 5xx must NOT look
        identical to a paper account with zero balance. Pre-fix both
        landed on a bare None and the factsheet rendered the heuristic-
        capital result as canonical CAGR/Sharpe."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            side_effect=RuntimeError("OKX 5xx during balance read")
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is True, (
            "fetch_usdt_balance_with_status MUST propagate "
            "balance_error=True on any exchange-API exception so the "
            "caller can stamp data_quality_flags.balance_error and "
            "computation_status='complete_with_warnings'"
        )

    @pytest.mark.asyncio
    async def test_legitimate_zero_balance_returns_none_with_error_false(
        self,
    ):
        """A successful read against a drained / paper account is NOT an
        error. Caller treats this as legitimate-no-balance (different
        UI text from the degraded path)."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": {"USDT": 0}}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is False

    @pytest.mark.asyncio
    async def test_missing_usdt_field_returns_none_with_error_false(self):
        """An account without a USDT key is also a legitimate state —
        e.g. a futures-only account holding margin in a different
        currency. Must not be treated as a balance_error."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": {"BTC": 0.5}}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is False

    @pytest.mark.asyncio
    async def test_malformed_response_shape_returns_balance_error(self):
        """A misbehaving exchange that returns an unexpected shape
        (e.g. None, list, string) must surface as balance_error=True
        rather than silently inheriting the heuristic path. Tests the
        defensive try/except around the .get(...).get(...) chain."""
        from services.exchange import fetch_usdt_balance_with_status

        mock_exchange = MagicMock()
        # `total` field is None instead of a dict — `.get("USDT", 0)`
        # against None raises AttributeError.
        mock_exchange.fetch_balance = AsyncMock(
            return_value={"total": None}
        )
        balance, balance_error = await fetch_usdt_balance_with_status(
            mock_exchange
        )
        assert balance is None
        assert balance_error is True

    @pytest.mark.asyncio
    async def test_fetch_usdt_balance_wrapper_drops_error_flag(self):
        """The legacy `fetch_usdt_balance` wrapper is preserved for
        backwards compatibility. Confirm it still returns None on
        exception (loses the flag — that's the point of the new API)."""
        from services.exchange import fetch_usdt_balance

        mock_exchange = MagicMock()
        mock_exchange.fetch_balance = AsyncMock(
            side_effect=RuntimeError("transient")
        )
        balance = await fetch_usdt_balance(mock_exchange)
        assert balance is None


# ─── audit-2026-05-07 C-0226 / H-0667 — unparseable timestamps dropped ────


class TestG12BUnparseableTimestampDrops:
    """Audit-2026-05-07 C-0226 / H-0667 — pre-fix, an OKX/Bybit fill with
    a missing or non-digit timestamp silently fell back to
    ``datetime.now(timezone.utc)``. That phantom wall-clock timestamp
    then became the most-recent fill for the symbol in FIFO
    reconstruction, breaking position open/close ordering, ROI, duration
    and daily volume attribution. Post-fix the fill is dropped (with a
    logger.error) so the malformed input is visible instead of silently
    corrupting downstream analytics."""

    @pytest.mark.asyncio
    async def test_okx_unparseable_ts_dropped(self) -> None:
        import logging
        from services.exchange import fetch_raw_trades

        good_ts = "1700000000000"

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
                    "ts": good_ts,
                    "ordId": "ord-good",
                    "tradeId": "trade-good",
                    "execType": "T",
                },
                {
                    # Missing ``ts`` entirely — pre-fix this synthesized
                    # ``datetime.now()`` and persisted a phantom-now row.
                    "instId": "ETH-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "3000",
                    "fillSz": "1",
                    "fee": "-0.3",
                    "feeCcy": "USDT",
                    "ordId": "ord-bad",
                    "tradeId": "trade-bad",
                    "execType": "T",
                },
                {
                    # Non-digit ``ts`` — also pre-fix collapsed to now().
                    "instId": "SOL-USDT-SWAP",
                    "side": "sell",
                    "fillPx": "100",
                    "fillSz": "1",
                    "fee": "-0.05",
                    "feeCcy": "USDT",
                    "ts": "not-a-number",
                    "ordId": "ord-bad2",
                    "tradeId": "trade-bad2",
                    "execType": "T",
                },
            ]
        })

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Only the well-formed fill makes it through; the two bad rows
        # are dropped.
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "trade-good"
        # Both drops must emit a logger.error pinning the malformed row.
        assert mock_err.call_count == 2
        assert all(
            "unparseable ts" in str(call)
            for call in mock_err.call_args_list
        )

    @pytest.mark.asyncio
    async def test_bybit_unparseable_execTime_dropped(self) -> None:
        import logging
        from services.exchange import fetch_raw_trades

        page = {
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
                        "orderId": "ord-good",
                        "execId": "exec-good",
                        "isMaker": "false",
                    },
                    {
                        # Missing ``execTime`` — pre-fix → datetime.now().
                        "symbol": "ETHUSDT",
                        "side": "Buy",
                        "execPrice": "3000",
                        "execQty": "1",
                        "execFee": "0.3",
                        "feeCurrency": "USDT",
                        "orderId": "ord-bad",
                        "execId": "exec-bad",
                        "isMaker": "false",
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # Only the well-formed fill survives.
        assert len(result) == 1
        assert result[0]["exchange_fill_id"] == "exec-good"
        assert mock_err.call_count == 1
        assert "unparseable execTime" in str(mock_err.call_args_list[0])


# ─── audit-2026-05-07 C-0227 — pagination must not silently truncate ────


class TestG12BPaginationFailureReRaises:
    """Audit-2026-05-07 C-0227 — pre-fix the OKX/Bybit per-page exception
    handler logged a warning and ``break``'d, returning fills collected
    so far. A transient 429 / 5xx on page 7 of 12 silently truncated
    history — the caller treated it as success, leaving the allocator's
    Volume/Positions tabs stale with no data_quality_flag. Post-fix the
    exception is re-raised so the sync_trades job is marked failed_retry
    and resumes via cursor on the next attempt."""

    @pytest.mark.asyncio
    async def test_okx_per_page_failure_re_raises(self) -> None:
        from services.exchange import fetch_raw_trades

        # Page 1 succeeds with a FULL page (so the loop will try page 2);
        # page 2 raises.
        fills_page_1 = []
        for i in range(100):
            fills_page_1.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(1700000000000 + i),
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })

        call_count = {"n": 0}

        async def _fills_history(params):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return {"data": fills_page_1}
            raise RuntimeError("simulated 5xx on page 2")

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        mock_supabase = MagicMock()
        with pytest.raises(RuntimeError, match="simulated 5xx"):
            await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

    @pytest.mark.asyncio
    async def test_bybit_per_page_failure_re_raises(self) -> None:
        from services.exchange import fetch_raw_trades

        page_1 = {
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
                "nextPageCursor": "page-2-cursor",
            }
        }

        call_count = {"n": 0}

        async def _execution_list(params):
            call_count["n"] += 1
            if call_count["n"] == 1:
                return page_1
            raise RuntimeError("simulated 429 on page 2")

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = _execution_list

        mock_supabase = MagicMock()
        with pytest.raises(RuntimeError, match="simulated 429"):
            await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )


# ─── audit-2026-05-07 H-0671 — maker rebates preserve negative sign ────


class TestG12BMakerRebatePreservesSign:
    """Audit-2026-05-07 H-0671 — pre-fix the OKX/Bybit/CCXT branches all
    applied ``abs(fee)`` so a maker rebate (negative fee on the
    exchange) silently became a positive cost. Downstream
    ``realized_pnl = ... - total_fees`` then subtracted an inflated
    fee, under-reporting P&L for maker-heavy strategies. Post-fix the
    signed value flows through unchanged."""

    @pytest.mark.asyncio
    async def test_okx_maker_rebate_stays_negative(self) -> None:
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
                    "fee": "-0.4",  # maker rebate
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-1",
                    "tradeId": "trade-1",
                    "execType": "M",
                },
            ]
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        # Sign must be preserved — this is the contract H-0671 fixes.
        assert result[0]["fee"] == -0.4

    @pytest.mark.asyncio
    async def test_bybit_maker_rebate_stays_negative(self) -> None:
        from services.exchange import fetch_raw_trades

        page = {
            "result": {
                "list": [
                    {
                        "symbol": "BTCUSDT",
                        "side": "Buy",
                        "execPrice": "60000",
                        "execQty": "0.1",
                        "execFee": "-0.4",  # maker rebate
                        "feeCurrency": "USDT",
                        "execTime": "1700000000000",
                        "orderId": "ord-1",
                        "execId": "exec-1",
                        "isMaker": True,
                    },
                ],
                "nextPageCursor": "",
            }
        }

        mock_exchange = AsyncMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_execution_list = AsyncMock(
            return_value=page
        )

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )
        assert len(result) == 1
        assert result[0]["fee"] == -0.4

    def test_normalize_fill_ccxt_maker_rebate_stays_negative(self) -> None:
        """CCXT unified shape — _normalize_fill must also preserve sign.
        Used by the Binance branch via fetch_my_trades. Pre-fix this was
        ``abs(float(fee_info.get('cost', 0) or 0))``."""
        from services.exchange import _normalize_fill

        out = _normalize_fill(
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": -0.4, "currency": "USDT"},
                "takerOrMaker": "maker",
                "info": {},
            },
            "binance",
        )
        assert out["fee"] == -0.4


# ─── audit-2026-05-07 H-0662 — Binance fetch_my_trades paginates ────


class TestG12BBinancePaginationLoop:
    """Audit-2026-05-07 H-0662 — pre-fix _fetch_raw_trades_binance called
    fetch_my_trades once with limit=1000 and no pagination loop. Binance
    caps each call at 1000 rows, so a high-frequency strategy with
    >1000 fills since last_sync silently truncated. Post-fix the loop
    advances ``since`` past the last fill's timestamp until a short
    page returns or the 20-page cap fires."""

    @pytest.mark.asyncio
    async def test_binance_paginates_past_1000_fills(self) -> None:
        import asyncio
        from services.exchange import fetch_raw_trades

        # Page 1: exactly 1000 fills (full page → loop continues).
        # Page 2: 1 fill (short page → loop breaks).
        page_1 = [
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": f"ord-{i}",
                "id": f"fill-{i}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "timestamp": 1700000000000 + i,
                "info": {},
            }
            for i in range(1000)
        ]
        page_2 = [
            {
                "symbol": "BTC/USDT:USDT",
                "side": "sell",
                "price": 60500.0,
                "amount": 0.1,
                "datetime": "2024-01-01T01:00:00Z",
                "order": "ord-tail",
                "id": "fill-tail",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "timestamp": 1700001000000,
                "info": {},
            }
        ]

        call_log: list[int | None] = []

        async def _fetch_my_trades(symbol, since=None, limit=None):
            call_log.append(since)
            if len(call_log) == 1:
                return page_1
            return page_2

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(mock_eq2, [{"symbol": "BTCUSDT"}])
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            result = await fetch_raw_trades(
                mock_exchange, "strat-1", mock_supabase
            )

        # We expect both pages to be merged: 1000 + 1 = 1001.
        assert len(result) == 1001
        # Two pages were fetched, second with since advanced past the
        # last timestamp of page 1.
        assert len(call_log) == 2
        # Page 2's ``since`` must be > page 1's last timestamp.
        assert call_log[1] == page_1[-1]["timestamp"] + 1

    @pytest.mark.asyncio
    async def test_binance_pagination_hits_page_cap(self) -> None:
        """If the venue keeps returning full pages, the 20-page cap must
        eventually terminate the loop (no runaway iteration)."""
        import asyncio
        import logging
        from services.exchange import fetch_raw_trades

        # Always return a full page so the loop keeps going.
        full_page = [
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": f"ord-{i}",
                "id": f"fill-{i}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                # Tick the timestamp forward so cursor advances.
                "timestamp": 1700000000000 + i,
                "info": {},
            }
            for i in range(1000)
        ]

        call_count = {"n": 0}

        async def _fetch_my_trades(symbol, since=None, limit=None):
            call_count["n"] += 1
            # Increment timestamps so cursor moves forward; CCXT mutation
            # safe since list reconstruction below.
            return [
                {**row, "timestamp": row["timestamp"] + call_count["n"] * 1_000_000}
                for row in full_page
            ]

        mock_exchange = AsyncMock()
        mock_exchange.id = "binance"
        mock_exchange.markets = {}
        mock_exchange.fetch_my_trades = _fetch_my_trades

        mock_supabase = MagicMock()

        def _table(name):
            mock_t = MagicMock()
            mock_sel = MagicMock()
            mock_eq1 = MagicMock()
            mock_eq2 = MagicMock()
            if name == "trades":
                _attach_paginated_chain(mock_eq2, [{"symbol": "BTCUSDT"}])
                mock_eq1.eq.return_value = mock_eq2
            else:
                _attach_paginated_chain(mock_eq1, [])
            mock_sel.eq.return_value = mock_eq1
            mock_t.select.return_value = mock_sel
            return mock_t

        mock_supabase.table = _table

        async def _mock_db_execute(fn):
            return await asyncio.to_thread(fn)

        with patch("services.db.db_execute", side_effect=_mock_db_execute):
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "warning",
            ) as mock_warn:
                result = await fetch_raw_trades(
                    mock_exchange, "strat-1", mock_supabase
                )

        # Exactly 20 fetch calls — the BINANCE_PAGE_CAP.
        assert call_count["n"] == 20
        assert len(result) == 20 * 1000
        # Page-cap warning must fire.
        assert any(
            "page cap" in str(call) and "BTCUSDT" in str(call)
            for call in mock_warn.call_args_list
        )


# ─── audit-2026-05-07 H-0665/H-0666 — OKX cursor direction + begin per-page ──


class TestG12BOkxCursorAndBegin:
    """Audit-2026-05-07 H-0665 + H-0666 — OKX fills-history pagination.

    H-0665: cursor pagination must use ``after=<billId>`` (records older
    than the cursor) not ``before=<billId>`` (newer). DESC-sorted data
    means ``data[-1]`` is the OLDEST row; ``before`` on the oldest
    asked for records newer than it — oscillating until the 100-page
    cap silently truncated.

    H-0666: ``begin`` must be sent on every page, not only page 1. Pre-fix
    OKX defaulted to a 7-day window on later pages, silently truncating
    a 90-day backfill.
    """

    @pytest.mark.asyncio
    async def test_okx_pagination_uses_after_cursor(self) -> None:
        from services.exchange import fetch_raw_trades

        captured_params: list[dict] = []

        page_1_fills = []
        for i in range(100):
            page_1_fills.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(1700000000000 + i),
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })
        page_2 = {"data": []}

        async def _fills_history(params):
            captured_params.append(dict(params))
            if len(captured_params) == 1:
                return {"data": page_1_fills}
            return page_2

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        mock_supabase = MagicMock()
        await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )

        # Page 1: no cursor.
        assert "after" not in captured_params[0]
        assert "before" not in captured_params[0]
        # Page 2: must use ``after`` (old-direction), not ``before``.
        assert captured_params[1].get("after") == "trade-99"
        assert "before" not in captured_params[1], (
            "OKX must paginate with ``after`` to walk into older history; "
            "``before`` walks toward newer records and oscillates."
        )

    @pytest.mark.asyncio
    async def test_okx_pagination_walks_after_cursor_across_multiple_pages(
        self,
    ) -> None:
        """Multi-page walk: a regression that picked ``data[0]`` (NEWEST,
        DESC-sorted) instead of ``data[-1]`` (OLDEST) would have passed
        the single-page after-cursor test as long as `data[0]` happened
        to differ from `data[-1]`. This 3-page test pins the cursor
        source: every subsequent page's ``after`` must equal the OLDEST
        ``tradeId`` from the prior page (last entry of DESC-sorted data),
        NOT the newest."""
        from services.exchange import fetch_raw_trades

        captured_params: list[dict] = []

        # Three full pages of 100 fills each (DESC by ts in real OKX),
        # then a short page of 5 (natural stop).
        def _build_page(start_idx: int, count: int) -> list[dict]:
            return [
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    # DESC ts within page (newest first); page boundaries
                    # also descend.
                    "ts": str(1700000000000 - (start_idx + i)),
                    "ordId": f"ord-{start_idx + i}",
                    "tradeId": f"trade-{start_idx + i}",
                    "execType": "T",
                }
                for i in range(count)
            ]

        pages = [
            _build_page(0, 100),    # page 1: trade-0 (newest) ... trade-99 (oldest)
            _build_page(100, 100),  # page 2: trade-100 ... trade-199
            _build_page(200, 100),  # page 3: trade-200 ... trade-299
            _build_page(300, 5),    # page 4: short page → natural stop
        ]
        call_idx = {"n": 0}

        async def _fills_history(params):
            captured_params.append(dict(params))
            i = call_idx["n"]
            call_idx["n"] += 1
            return {"data": pages[i] if i < len(pages) else []}

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        mock_supabase = MagicMock()
        await fetch_raw_trades(mock_exchange, "strat-1", mock_supabase)

        assert len(captured_params) == 4
        # Page 1: no cursor.
        assert "after" not in captured_params[0]
        # Pages 2-4: cursor MUST be the OLDEST tradeId of the prior page
        # (last entry, DESC-sorted), NOT the newest (first entry).
        assert captured_params[1]["after"] == "trade-99", (
            "page 2 cursor must be data[-1] (oldest); a regression that "
            "picked data[0] (newest) would oscillate"
        )
        assert captured_params[2]["after"] == "trade-199"
        assert captured_params[3]["after"] == "trade-299"

    @pytest.mark.asyncio
    async def test_okx_begin_sent_on_every_page(self) -> None:
        from services.exchange import fetch_raw_trades

        captured_params: list[dict] = []

        page_1_fills = []
        for i in range(100):
            page_1_fills.append({
                "instId": "BTC-USDT-SWAP",
                "side": "buy",
                "fillPx": "60000",
                "fillSz": "0.1",
                "fee": "-0.6",
                "feeCcy": "USDT",
                "ts": str(1700000000000 + i),
                "ordId": f"ord-{i}",
                "tradeId": f"trade-{i}",
                "execType": "T",
            })

        async def _fills_history(params):
            captured_params.append(dict(params))
            if len(captured_params) == 1:
                return {"data": page_1_fills}
            return {"data": []}

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = _fills_history

        since_ms = 1690000000000  # caller-supplied window
        mock_supabase = MagicMock()
        await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase, since_ms=since_ms
        )

        # Both pages must carry the `begin` time bound (effective_since
        # = since_ms - OVERLAP_WINDOW_MS = since_ms - 3_600_000).
        expected_begin = str(since_ms - 3_600_000)
        assert len(captured_params) >= 2
        for i, p in enumerate(captured_params):
            assert p.get("begin") == expected_begin, (
                f"OKX page {i + 1} missing/wrong begin — pre-fix this was "
                f"only sent on page 1 and later pages fell back to OKX's "
                f"default 7-day window. Got: {p!r}"
            )


# ─── audit-2026-05-07 H-0673 — CCXT timestamp normalized to ISO UTC ────


class TestG12BCcxtTimestampNormalization:
    """Audit-2026-05-07 H-0673 — pre-fix, _normalize_fill wrote
    ``trade.get("datetime", "")`` straight through. An empty default
    cascaded into ``datetime.fromisoformat("")`` (silently swallowed
    by position_reconstruction) and ``new Date("")`` (Invalid Date in
    PositionsTab.tsx). Post-fix the field is a uniform ISO-8601 UTC
    string OR the fill is dropped with a logger.error."""

    def test_normalize_fill_prefers_numeric_timestamp(self) -> None:
        """CCXT unified shape carries both ``datetime`` (ISO string) and
        ``timestamp`` (millis). The numeric form is canonical; ensure we
        produce a tz-aware ISO string from it."""
        from services.exchange import _normalize_fill

        out = _normalize_fill(
            {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "",  # Pre-fix would have persisted ""
                "timestamp": 1700000000000,
                "order": "ord-1",
                "id": "fill-1",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            },
            "binance",
        )
        assert out is not None
        # Parseable, tz-aware ISO string.
        parsed = datetime.fromisoformat(out["timestamp"])
        assert parsed.tzinfo is not None
        assert int(parsed.timestamp() * 1000) == 1700000000000

    def test_normalize_fill_falls_back_to_datetime_string(self) -> None:
        """If only ``datetime`` is provided (no numeric timestamp), the
        ISO string is normalized to UTC with a +00:00 / Z suffix."""
        from services.exchange import _normalize_fill

        out = _normalize_fill(
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
            "binance",
        )
        assert out is not None
        parsed = datetime.fromisoformat(out["timestamp"])
        assert parsed.tzinfo is not None

    def test_normalize_fill_drops_fill_with_no_timestamp(self) -> None:
        """No ``datetime`` and no ``timestamp`` — pre-fix this persisted
        an empty-string field; post-fix the fill is dropped and a
        logger.error fires so the malformed row is visible."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    # NO datetime, NO timestamp.
                    "order": "ord-1",
                    "id": "fill-1",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is None
        assert mock_err.call_count == 1
        assert "unparseable timestamp" in str(mock_err.call_args_list[0])

    def test_normalize_fill_drops_bool_timestamp(self) -> None:
        """Python's ``True`` is an ``int`` subclass (``True == 1``).
        Without an explicit bool guard ``coerce_to_aware_utc(True, ...)``
        produces ``float(True)/1000 = 0.001`` → 1970-01-01T00:00:00.001
        phantom row, same FIFO-corruption shape as ``timestamp=0``."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "",
                    "timestamp": True,  # bool, int subclass
                    "order": "ord-1",
                    "id": "fill-bool",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is None, "bool timestamp must be treated as missing"
        assert mock_err.call_count == 1

    def test_normalize_fill_drops_zero_epoch_timestamp(self) -> None:
        """Numeric ``timestamp=0`` is the same FIFO-poisoning shape as the
        H-0673 bug: ``coerce_to_aware_utc(0)`` would produce a
        1970-01-01 phantom row that becomes the "earliest fill" for the
        symbol. Post-fix, epoch-zero is treated as missing — the fill is
        dropped just like an absent timestamp."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "error",
        ) as mock_err:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "",
                    "timestamp": 0,  # epoch sentinel
                    "order": "ord-1",
                    "id": "fill-zero",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is None, "epoch-zero timestamp must be treated as missing"
        assert mock_err.call_count == 1

    def test_normalize_fill_drops_missing_price_or_amount(self) -> None:
        """Pre-Phase B `_normalize_fill` silently substituted ``0`` for
        missing/non-numeric ``price`` or ``amount`` — same silent-failure
        shape as the H-0673 timestamp bug. Post-fix, both are required
        and the fill is dropped if either is missing."""
        import logging
        from services.exchange import _normalize_fill

        for missing in ("price", "amount"):
            base = {
                "symbol": "BTC/USDT:USDT",
                "side": "buy",
                "price": 60000.0,
                "amount": 0.1,
                "datetime": "2024-01-01T00:00:00Z",
                "order": "ord-1",
                "id": f"fill-missing-{missing}",
                "fee": {"cost": 0.6, "currency": "USDT"},
                "takerOrMaker": "taker",
                "info": {},
            }
            base.pop(missing)
            with patch.object(
                logging.getLogger("quantalyze.analytics"),
                "error",
            ) as mock_err:
                out = _normalize_fill(base, "binance")
            assert out is None, (
                f"fill missing {missing} must be dropped, not silently zeroed"
            )
            assert mock_err.call_count == 1
            assert "missing/non-numeric" in str(mock_err.call_args_list[0])

    def test_normalize_fill_logs_warning_on_primary_field_parse_failure(
        self,
    ) -> None:
        """When ``timestamp`` is present but unparseable AND ``datetime``
        is healthy, the fill should still land — but a WARNING must fire
        so primary-field producer drift is visible (a silent fallback
        masks an upstream poisoning bug)."""
        import logging
        from services.exchange import _normalize_fill

        with patch.object(
            logging.getLogger("quantalyze.analytics"),
            "warning",
        ) as mock_warn:
            out = _normalize_fill(
                {
                    "symbol": "BTC/USDT:USDT",
                    "side": "buy",
                    "price": 60000.0,
                    "amount": 0.1,
                    "datetime": "2024-01-01T00:00:00Z",
                    "timestamp": "not-a-number",  # garbage primary field
                    "order": "ord-1",
                    "id": "fill-fallback",
                    "fee": {"cost": 0.6, "currency": "USDT"},
                    "takerOrMaker": "taker",
                    "info": {},
                },
                "binance",
            )
        assert out is not None, "fallback to datetime should succeed"
        assert mock_warn.call_count >= 1, (
            "primary-field parse failure must log a warning, not fall through silently"
        )


# ─── audit-2026-05-07 H-0663 — OKX funding-row contract ────


class TestG12BOkxFundingRowContract:
    """Audit-2026-05-07 H-0663 — OKX's
    ``private_get_trade_fills_history`` endpoint is documented to
    return trade fills only (execType: T/M, etc.); funding rate entries
    live in ``private_get_account_bills``. This test codifies the
    contract: a fills_history response is treated as trades. If OKX
    ever changes the endpoint shape to mix funding rows in, the
    qty<=0 guard in services/position_reconstruction.py:533 would still
    skip them — but the regression test below pins the current
    behavior so an accidental change in either layer is visible.

    The test treats a hypothetical funding-shaped row (fillSz='0',
    subType='8' — the OKX bill subType for funding fee) as a non-fill:
    qty<=0 means it's filtered downstream and contributes 0 quantity.
    """

    @pytest.mark.asyncio
    async def test_okx_zero_qty_row_passes_through_with_qty_zero(self) -> None:
        from services.exchange import fetch_raw_trades

        mock_exchange = AsyncMock()
        mock_exchange.id = "okx"
        mock_exchange.private_get_trade_fills_history = AsyncMock(return_value={
            "data": [
                # Normal fill — must be ingested as qty 0.1.
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "buy",
                    "fillPx": "60000",
                    "fillSz": "0.1",
                    "fee": "-0.6",
                    "feeCcy": "USDT",
                    "ts": "1700000000000",
                    "ordId": "ord-fill",
                    "tradeId": "trade-fill",
                    "execType": "T",
                },
                # Funding-shaped row (qty=0, OKX bill subType=8) — if
                # this ever shows up in fills_history (it shouldn't),
                # the qty=0 carries through and downstream filters at
                # qty<=0 in position_reconstruction.
                {
                    "instId": "BTC-USDT-SWAP",
                    "side": "",
                    "fillPx": "0",
                    "fillSz": "0",
                    "fee": "-0.5",
                    "feeCcy": "USDT",
                    "ts": "1700001000000",
                    "ordId": "",
                    "tradeId": "trade-funding",
                    "execType": "",
                    "subType": "8",  # OKX bill funding-fee subType
                },
            ]
        })

        mock_supabase = MagicMock()
        result = await fetch_raw_trades(
            mock_exchange, "strat-1", mock_supabase
        )

        # Both rows are returned by fetch_raw_trades (no client-side
        # filter); the funding-shaped row has quantity=0 so the
        # downstream qty<=0 guard skips it.
        assert len(result) == 2
        normal = [r for r in result if r["exchange_fill_id"] == "trade-fill"][0]
        funding = [
            r for r in result if r["exchange_fill_id"] == "trade-funding"
        ][0]
        assert normal["quantity"] == 0.1
        assert funding["quantity"] == 0.0, (
            "Funding-shaped row must carry quantity=0 so the qty<=0 "
            "guard at services/position_reconstruction.py:533 filters "
            "it out without inflating fill totals."
        )


# audit-2026-05-07 silent-failure sweep regression
class TestFetchDailyPnlBybitFailLoud:
    """Pre-sweep, `fetch_daily_pnl` wrapped the Bybit closed-pnl RPC and
    the timestamp ISO-conversion loop in a single `except: pass`. Two
    distinct failure modes (RPC raise vs ISO conversion raise) silently
    collapsed into "no bybit daily_pnl" with no Railway log. Post-sweep,
    the call remains best-effort (the parent sync still wants to continue)
    BUT a WARNING is emitted naming the failure mode.
    """

    @pytest.mark.asyncio
    async def test_bybit_closed_pnl_rpc_failure_emits_warning(self, caplog):
        import logging
        from services.exchange import fetch_daily_pnl

        # Bybit ccxt mock whose closed_pnl endpoint raises.
        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            side_effect=RuntimeError("simulated Bybit closed_pnl RPC failure")
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Failure-soft contract: the call returned without raising.
        assert result == []
        # Operator visibility: a WARNING named the failure mode.
        # Review-cluster gate (audit-2026-05-07): tightened from the
        # loose 'bybit' substring filter to require the exact log prefix
        # the sweep introduced. Loose match could pass on an UNRELATED
        # future warning that happens to contain 'bybit' from a different
        # module.
        matching = [
            r for r in caplog.records
            if "Bybit closed_pnl" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Bybit closed_pnl RPC failure must produce a WARNING log "
            "with prefix 'Bybit closed_pnl' (post audit-2026-05-07 "
            "silent-failure sweep) so operators can distinguish 'Bybit "
            "blip / auth fail' from 'no closed positions on the account'."
        )
        # Pin structured-logging contract: exc_info must carry the traceback.
        assert any(r.exc_info is not None for r in matching), (
            "Bybit closed_pnl WARNING must use exc_info=True so operators "
            "get the traceback in Railway logs, not just the message"
        )
        # Pin the boundary: the inner WARNING must be THE log — the
        # outer wrapper's ERROR ('fetch_daily_pnl failed') must NOT
        # fire. A refactor that re-raises from the inner Bybit branch
        # would create a doubled WARNING+ERROR; this assertion catches it.
        assert not any(
            r.levelno == logging.ERROR
            and "fetch_daily_pnl failed" in r.getMessage()
            for r in caplog.records
        ), (
            "Bybit closed_pnl failure must NOT escalate to the outer "
            "fetch_daily_pnl ERROR — the fail-loud transformation is "
            "WARNING-only at the inner branch (best-effort enrichment)"
        )

    @pytest.mark.asyncio
    async def test_bybit_closed_pnl_item_parse_failure_emits_warning(self, caplog):
        """A malformed item INSIDE the Bybit closed_pnl response (e.g.,
        `closedPnl: 'NaN-string'` which `float()` rejects) raises inside
        the per-item loop. Pre-sweep, the outer bare-pass swallowed it
        and downstream timestamps remained malformed with no log.
        Post-sweep, a WARNING fires.

        Review-cluster gate rename (audit-2026-05-07): the prior test
        name 'test_bybit_iso_conversion_failure' was misleading — the
        actual trigger is closedPnl parsing, not the ISO conversion (the
        mock data here has a valid digit-string createdTime). Renamed
        to accurately describe what's tested. A separate test for the
        true ISO-conversion path is a follow-up (would require mocking
        datetime.fromtimestamp to raise).
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        # `float('NaN-string')` raises ValueError inside the per-item
        # parse loop, which is wrapped by the Bybit try/except.
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "closedPnl": "NaN-string",
                            "createdTime": "1700000000000",
                        }
                    ]
                }
            }
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Failure-soft contract: the call returned without raising.
        assert isinstance(result, list)
        # Operator visibility: WARNING with exact prefix.
        matching = [
            r for r in caplog.records
            if "Bybit closed_pnl" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Bybit closed_pnl item-parse failure must produce a WARNING "
            "log with prefix 'Bybit closed_pnl' (post audit-2026-05-07 "
            "silent-failure sweep)"
        )

    @pytest.mark.asyncio
    async def test_bybit_iso_conversion_overflow_emits_warning(self, caplog):
        """PR #181 take-2 silent-failure-hunter F13 + pr-test LOW #3:
        the original Bybit-branch WARNING text 'Bybit closed_pnl fetch
        / ISO-conversion failed' names TWO failure modes. The renamed
        sibling test_bybit_closed_pnl_item_parse_failure covers the
        per-item parse path; the RPC-failure test covers the RPC path.
        This test exercises the TRUE ISO-conversion failure mode: a
        createdTime that passes the isdigit() guard but overflows when
        passed to datetime.fromtimestamp via int(ts_raw) / 1000.

        Take-2 atomicity (red-team F5): in addition to emitting the
        WARNING, the failure must NOT partially mutate daily_pnl —
        either all entries are converted, or none are (atomic
        contract). After F5, the Bybit ISO conversion builds a NEW
        list before mutating daily_pnl; on mid-loop failure, the
        partial state is discarded and daily_pnl remains uniform.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        # 22-digit createdTime passes `str.isdigit()` but `int(.) / 1000`
        # overflows datetime.fromtimestamp on most platforms (year ~10^14).
        mock_exchange.private_get_v5_position_closed_pnl = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {
                            "symbol": "BTCUSDT",
                            "closedPnl": "5.0",
                            "createdTime": "9" * 22,
                        }
                    ]
                }
            }
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)

        # F5 atomicity: on ISO failure, no Bybit rows leak into daily_pnl
        # (build-then-extend means a mid-loop overflow discards the
        # partial converted list).
        assert isinstance(result, list)
        # Operator visibility: WARNING fired for the ISO-conversion path.
        matching = [
            r for r in caplog.records
            if "Bybit closed_pnl" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Bybit ISO-conversion overflow must produce a WARNING log "
            "with prefix 'Bybit closed_pnl' (PR #181 take-2 F13)"
        )


# PR #181 take-2 silent-failure-hunter F4: OKX bills aggregator pre-take2
# had no else branch on the `ts_raw.isdigit()` guard — bills with empty
# or non-digit ts were silently dropped. Now logs a WARNING with
# billId + billType for cross-exchange triage consistency.
class TestFetchDailyPnlOkxFailLoud:
    """Take-2 regression coverage for the OKX bill-aggregator silent-drop fix."""

    @pytest.mark.asyncio
    async def test_okx_bill_dropped_on_non_digit_ts_logs_warning(self, caplog):
        """A bill with a non-digit ts (e.g., ISO string from a schema drift)
        must produce a WARNING naming the billId / billType so operators
        can spot the regression instead of seeing silently truncated
        daily_pnl.
        """
        import logging
        from datetime import datetime, timezone, timedelta
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "okx"
        # Recent bills: one valid, one with non-digit ts (mimics OKX
        # returning an ISO string for a future schema-drift bill).
        valid_ts = str(int(datetime.now(timezone.utc).timestamp() * 1000))
        recent_resp = {
            "data": [
                {"ts": valid_ts, "pnl": "1.0", "fee": "0", "billId": "B1", "billType": "8"},
                {"ts": "2026-01-01T00:00:00Z", "pnl": "2.0", "fee": "0", "billId": "B2", "billType": "8"},
                {"ts": "", "pnl": "3.0", "fee": "0", "billId": "B3", "billType": "8"},
            ]
        }
        archive_resp = {"data": []}

        async def mock_recent(params):
            return recent_resp

        async def mock_archive(params):
            return archive_resp

        mock_exchange.private_get_account_bills = AsyncMock(
            side_effect=mock_recent
        )
        mock_exchange.private_get_account_bills_archive = AsyncMock(
            side_effect=mock_archive
        )

        # since_ms recent (no archive needed)
        since_ms = int((datetime.now(timezone.utc) - timedelta(days=2)).timestamp() * 1000)
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            await fetch_daily_pnl(mock_exchange, since_ms=since_ms)

        dropped = [
            r for r in caplog.records
            if "OKX bill dropped" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        # Both bad bills (ISO + empty-string) should emit a WARNING.
        assert len(dropped) >= 2, (
            "PR #181 take-2 F4: each OKX bill with non-digit ts must "
            f"emit a WARNING; observed {len(dropped)}"
        )
        msgs = " | ".join(r.getMessage() for r in dropped)
        assert "B2" in msgs, "WARNING must include billId for the ISO-ts row"
        assert "B3" in msgs, "WARNING must include billId for the empty-ts row"


# PR #181 take-2 silent-failure-hunter F3: fetch_mark_prices pre-take2
# silently dropped Binance/Bybit rows whose markPrice was missing or
# malformed. Now logs a WARNING with the symbol + the unparseable
# markPrice value. Schema drift on the ticker endpoint would corrupt
# valuation (caller treats absent symbols as flat positions) with no
# operator signal without this WARNING.
class TestFetchMarkPricesFailLoud:
    """Take-2 regression coverage for the per-row silent-drop fix."""

    @pytest.mark.asyncio
    async def test_binance_drops_unparseable_mark_price_with_warning(self, caplog):
        import logging
        from services.exchange import (
            fetch_mark_prices,
            _reset_mark_price_cache_for_tests,
        )

        _reset_mark_price_cache_for_tests()
        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        # Mixed response: BTCUSDT is fine, ETHUSDT has a non-numeric markPrice.
        mock_exchange.fapiPublic_get_premiumindex = AsyncMock(
            return_value=[
                {"symbol": "BTCUSDT", "markPrice": "60000.0"},
                {"symbol": "ETHUSDT", "markPrice": "NaN-string"},
                {"symbol": "SOLUSDT"},  # missing markPrice entirely
            ]
        )
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_mark_prices(
                mock_exchange, ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
            )
        # The good row is kept; the bad rows are dropped.
        assert result.get("BTCUSDT") == 60000.0
        assert "ETHUSDT" not in result
        assert "SOLUSDT" not in result
        # WARNINGs must name the dropped symbols.
        drops = [
            r for r in caplog.records
            if "fetch_mark_prices Binance" in r.getMessage()
            and "dropping sym=" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert len(drops) >= 2, (
            f"PR #181 take-2 F3: expected per-symbol WARNING for each "
            f"dropped row; observed {len(drops)}"
        )
        msgs = " | ".join(r.getMessage() for r in drops)
        assert "ETHUSDT" in msgs, "WARNING must name ETHUSDT drop"
        assert "SOLUSDT" in msgs, "WARNING must name SOLUSDT drop"

    @pytest.mark.asyncio
    async def test_bybit_drops_unparseable_mark_price_with_warning(self, caplog):
        import logging
        from services.exchange import (
            fetch_mark_prices,
            _reset_mark_price_cache_for_tests,
        )

        _reset_mark_price_cache_for_tests()
        mock_exchange = MagicMock()
        mock_exchange.id = "bybit"
        mock_exchange.private_get_v5_market_tickers = AsyncMock(
            return_value={
                "result": {
                    "list": [
                        {"symbol": "BTCUSDT", "markPrice": "60000.0"},
                        {"symbol": "ETHUSDT", "markPrice": "NaN-string"},
                    ]
                }
            }
        )
        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_mark_prices(
                mock_exchange, ["BTCUSDT", "ETHUSDT"]
            )
        assert result.get("BTCUSDT") == 60000.0
        assert "ETHUSDT" not in result
        drops = [
            r for r in caplog.records
            if "fetch_mark_prices Bybit" in r.getMessage()
            and "dropping sym=ETHUSDT" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert drops, (
            "PR #181 take-2 F3: ETHUSDT drop must emit a Bybit-specific "
            "WARNING naming the symbol"
        )


# Review-cluster gate (audit-2026-05-07): the Binance branch fix at
# exchange.py:552-562 — pre-gate it had NO regression test. A /simplify
# pass that drops the new WARNING would land silently.
class TestFetchDailyPnlBinanceFailLoud:
    """Pre-sweep, the Binance futures-income failure path silently
    swallowed the exception and fell back to BTC spot trades with no
    log attributing the fallback to a futures-income drift. Post-sweep,
    a WARNING fires before the fallback so operators can spot systemic
    issues (Binance schema change, auth failure masquerading as
    futures-permission denial) instead of only seeing 'BTC spot
    fallback fired' in the data.
    """

    @pytest.mark.asyncio
    async def test_binance_futures_income_failure_logs_warning_before_fallback(
        self, caplog
    ):
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        # fapiPrivate_get_income raises → WARNING + fallback to fetch_my_trades.
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=RuntimeError(
                "simulated Binance futures-income RPC failure"
            )
        )
        # The fallback returns one trade so we can verify the path was taken.
        # Note: ccxt trade dicts use `datetime` as the ISO-string key (see
        # exchange.py:572 — `t["datetime"]`), distinct from Python's
        # datetime module. The fallback ALSO reads `t["symbol"]` /
        # `t["side"]` / etc. via subscript (no .get default), so the
        # mock must populate every required key.
        mock_exchange.fetch_my_trades = AsyncMock(
            return_value=[
                {
                    "symbol": "BTC/USDT",
                    "amount": 0.1,
                    "price": 50000.0,
                    "side": "buy",
                    "fee": {"cost": 0.5, "currency": "USDT"},
                    "timestamp": 1700000000000,
                    "datetime": "2023-11-14T22:13:20.000Z",
                    "type": "market",
                }
            ]
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Failure-soft + fallback contract: result is non-empty (fallback ran).
        assert isinstance(result, list)
        assert len(result) >= 1, (
            "Binance branch must fall back to fetch_my_trades when "
            "futures-income raises; fallback produced no rows"
        )
        # Operator visibility: WARNING naming the Binance futures-income mode.
        matching = [
            r for r in caplog.records
            if "Binance futures-income" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert matching, (
            "Binance futures-income failure must produce a WARNING log with "
            "prefix 'Binance futures-income' (post audit-2026-05-07 "
            "silent-failure sweep); the prior bare-pass swallow is a "
            "regression"
        )
        # PR #181 take-2 security F7: structured-logging contract changed
        # to drop exc_info=True on this site to prevent ccxt network-class
        # exception messages from leaking the signed URL +
        # &signature=<HMAC> into the traceback. The new contract carries
        # the exception class via `exc_class=` and the scrubbed message
        # via `scrubbed=` in the WARNING template.
        assert any(
            "exc_class=" in r.getMessage() for r in matching
        ), (
            "Binance futures-income WARNING must include exc_class= label "
            "(PR #181 take-2 HMAC-leak fix)"
        )
        assert any(
            "scrubbed=" in r.getMessage() for r in matching
        ), (
            "Binance futures-income WARNING must include scrubbed= label "
            "for the redacted message (PR #181 take-2 HMAC-leak fix)"
        )
        assert all(
            r.exc_info is None for r in matching
        ), (
            "Binance futures-income WARNING must NOT use exc_info=True — "
            "the traceback's first line includes str(exc) which carries "
            "the signed URL + signature. Use scrubbed string instead."
        )

    @pytest.mark.asyncio
    async def test_binance_fallback_failure_escapes_to_outer_error(self, caplog):
        """Documents the cascade boundary (silent-failure-hunter LOW #5):
        if BOTH futures-income AND the fallback fetch_my_trades raise,
        the inner Binance WARNING fires AND the OUTER 'fetch_daily_pnl
        failed' ERROR also fires (because the fallback has no try/except
        of its own). Operators see TWO logs and can disambiguate
        'transient' vs 'systemic' Binance issues. This test pins that
        boundary so a future refactor wrapping the fallback in its own
        try/except doesn't silently swallow the cascade.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=RuntimeError("simulated futures-income failure")
        )
        mock_exchange.fetch_my_trades = AsyncMock(
            side_effect=RuntimeError("simulated spot-trades fallback failure")
        )

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            result = await fetch_daily_pnl(mock_exchange)
        # Outer wrapper still returns [] (best-effort enrichment path).
        assert result == []
        # Inner WARNING fired naming the futures-income mode.
        inner = [
            r for r in caplog.records
            if "Binance futures-income" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert inner, "inner Binance WARNING must fire"
        # Outer wrapper ERROR fired (fallback also raised, escapes to L620).
        outer = [
            r for r in caplog.records
            if "fetch_daily_pnl failed" in r.getMessage()
            and r.levelno == logging.ERROR
        ]
        assert outer, (
            "outer fetch_daily_pnl ERROR must fire when the fallback also "
            "raises — this is the documented cascade contract"
        )

    @pytest.mark.asyncio
    async def test_binance_futures_income_warning_scrubs_hmac_signature(
        self, caplog
    ):
        """PR #181 take-2 security F7: the Binance futures-income WARNING
        previously used `exc_info=True` and interpolated the raw exception.
        For ccxt network-class errors (RequestTimeout, ExchangeNotAvailable
        etc.) the exception message embeds the signed request URL, which
        ends with `&signature=<HMAC-SHA256>` for signed fapiPrivate
        endpoints. The new contract scrubs the message via
        `services.redact.scrub_freeform_string` so the HMAC is replaced
        with the REDACTED token before reaching Railway/Sentry. Pre-take2
        the HMAC plaintext landed in logs on every Binance fapi network
        failure.
        """
        import logging
        from services.exchange import fetch_daily_pnl

        mock_exchange = MagicMock()
        mock_exchange.id = "binance"
        # Simulate the shape of a ccxt RequestTimeout: `details` =
        # `id method url`, where url contains `&signature=<HMAC>`.
        # The exception's str() will carry this verbatim.
        fake_url = (
            "https://fapi.binance.com/fapi/v1/income?"
            "timestamp=1700000000000&recvWindow=5000&"
            "signature=abcdef0123456789deadbeefcafebabe1111222233334444"
        )
        signed_exc_msg = f"binance GET {fake_url}"
        mock_exchange.fapiPrivate_get_income = AsyncMock(
            side_effect=RuntimeError(signed_exc_msg)
        )
        # Fallback succeeds so we only observe the inner WARNING.
        mock_exchange.fetch_my_trades = AsyncMock(return_value=[])

        with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
            await fetch_daily_pnl(mock_exchange)

        binance_warns = [
            r for r in caplog.records
            if "Binance futures-income" in r.getMessage()
            and r.levelno == logging.WARNING
        ]
        assert binance_warns, "Binance WARNING must fire on RPC failure"
        # The raw HMAC plaintext must NOT appear anywhere in the WARNING
        # message text.
        for rec in binance_warns:
            msg = rec.getMessage()
            assert "abcdef0123456789deadbeefcafebabe1111222233334444" not in msg, (
                f"HMAC signature plaintext leaked into Binance WARNING: {msg!r}"
            )
            # exc_info must be None (we dropped it as part of the scrub fix).
            assert rec.exc_info is None, (
                "Binance WARNING must not carry exc_info=True (HMAC-leak fix)"
            )
