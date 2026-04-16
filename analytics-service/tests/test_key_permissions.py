"""Sprint 5 Task 5.8 — unit tests for services/key_permissions.py.

Three layers:
  1. Per-exchange parser fixtures (read-only / read+trade / read+trade+withdraw)
  2. TTL cache: miss → call exchange; hit → no call; expiry → re-call.
  3. Dispatcher: routes by exchange.id, unknown ids degrade gracefully.

All exchange interactions are mocked — no network or DB.
"""

import asyncio
import time

import pytest
from unittest.mock import AsyncMock, MagicMock

from services import key_permissions
from services.key_permissions import (
    detect_binance_permissions,
    detect_bybit_permissions,
    detect_okx_permissions,
    detect_permissions,
)


# ---------------------------------------------------------------------------
# Per-exchange parsers
# ---------------------------------------------------------------------------


class TestBinanceParser:
    @pytest.mark.asyncio
    async def test_read_only(self):
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(return_value={
            "enableReading": True,
            "enableSpotAndMarginTrading": False,
            "enableFutures": False,
            "enableWithdrawals": False,
        })
        result = await detect_binance_permissions(ex)
        assert result == {"read": True, "trade": False, "withdraw": False}

    @pytest.mark.asyncio
    async def test_read_plus_trade(self):
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(return_value={
            "enableSpotAndMarginTrading": True,
            "enableFutures": False,
            "enableWithdrawals": False,
        })
        result = await detect_binance_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": False}

    @pytest.mark.asyncio
    async def test_read_plus_trade_plus_withdraw(self):
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(return_value={
            "enableSpotAndMarginTrading": True,
            "enableFutures": True,
            "enableWithdrawals": True,
        })
        result = await detect_binance_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": True}

    @pytest.mark.asyncio
    async def test_futures_only_counts_as_trade(self):
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(return_value={
            "enableSpotAndMarginTrading": False,
            "enableFutures": True,
            "enableWithdrawals": False,
        })
        result = await detect_binance_permissions(ex)
        # Spot-only OR futures-only both flip the trade bit.
        assert result["trade"] is True

    @pytest.mark.asyncio
    async def test_exchange_error_fails_closed(self):
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(side_effect=Exception("network"))
        result = await detect_binance_permissions(ex)
        # Fail-closed: assume worst case so wizard rejects.
        assert result == {"read": True, "trade": True, "withdraw": True}


class TestOkxParser:
    @pytest.mark.asyncio
    async def test_read_only(self):
        ex = AsyncMock()
        ex.id = "okx"
        ex.private_get_account_config = AsyncMock(return_value={
            "data": [{"perm": "read_only"}],
        })
        result = await detect_okx_permissions(ex)
        assert result == {"read": True, "trade": False, "withdraw": False}

    @pytest.mark.asyncio
    async def test_read_plus_trade(self):
        ex = AsyncMock()
        ex.id = "okx"
        ex.private_get_account_config = AsyncMock(return_value={
            "data": [{"perm": "read,trade"}],
        })
        result = await detect_okx_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": False}

    @pytest.mark.asyncio
    async def test_read_plus_trade_plus_withdraw(self):
        ex = AsyncMock()
        ex.id = "okx"
        ex.private_get_account_config = AsyncMock(return_value={
            "data": [{"permType": "read,trade,withdraw"}],
        })
        result = await detect_okx_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": True}

    @pytest.mark.asyncio
    async def test_exchange_error_falls_back_to_read_only(self):
        # Legacy behavior: balance fetch already proved read works, so a
        # permission-endpoint failure should still treat the key as read-only.
        ex = AsyncMock()
        ex.id = "okx"
        ex.private_get_account_config = AsyncMock(side_effect=Exception("flaky"))
        result = await detect_okx_permissions(ex)
        assert result == {"read": True, "trade": False, "withdraw": False}


class TestBybitParser:
    @pytest.mark.asyncio
    async def test_read_only(self):
        ex = AsyncMock()
        ex.id = "bybit"
        ex.private_get_v5_user_query_api = AsyncMock(return_value={
            "result": {"permissions": {}},
        })
        result = await detect_bybit_permissions(ex)
        assert result == {"read": True, "trade": False, "withdraw": False}

    @pytest.mark.asyncio
    async def test_read_plus_trade(self):
        ex = AsyncMock()
        ex.id = "bybit"
        ex.private_get_v5_user_query_api = AsyncMock(return_value={
            "result": {"permissions": {"Spot": ["SpotTrade"]}},
        })
        result = await detect_bybit_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": False}

    @pytest.mark.asyncio
    async def test_read_plus_trade_plus_withdraw(self):
        ex = AsyncMock()
        ex.id = "bybit"
        ex.private_get_v5_user_query_api = AsyncMock(return_value={
            "result": {
                "permissions": {
                    "ContractTrade": ["Order"],
                    "Wallet": ["AccountTransfer"],
                },
            },
        })
        result = await detect_bybit_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": True}

    @pytest.mark.asyncio
    async def test_exchange_error_fails_closed(self):
        ex = AsyncMock()
        ex.id = "bybit"
        ex.private_get_v5_user_query_api = AsyncMock(side_effect=Exception("503"))
        result = await detect_bybit_permissions(ex)
        assert result == {"read": True, "trade": True, "withdraw": True}


# ---------------------------------------------------------------------------
# Dispatcher + cache
# ---------------------------------------------------------------------------


class TestDetectPermissionsCache:
    """Sprint 5 Task 5.8 cache contract:
       - First call with api_key_id → exchange call happens, result cached.
       - Subsequent call inside TTL → exchange call NOT made, returns cached.
       - After TTL expiry → exchange call happens again.
       - Calls without api_key_id bypass the cache entirely.
    """

    def setup_method(self):
        # Clear cache between tests to prevent cross-pollution.
        key_permissions._cache_clear()

    @pytest.mark.asyncio
    async def test_miss_then_hit(self, monkeypatch):
        monkeypatch.setenv("KEY_PERMISSION_CACHE_TTL", "900")
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(return_value={
            "enableSpotAndMarginTrading": False,
            "enableFutures": False,
            "enableWithdrawals": False,
        })

        first = await detect_permissions(ex, api_key_id="key-abc")
        assert first == {"read": True, "trade": False, "withdraw": False}
        assert ex.sapi_get_account_apirestrictions.await_count == 1

        # Second call with the same key_id should be cached — no new exchange call.
        second = await detect_permissions(ex, api_key_id="key-abc")
        assert second == first
        assert ex.sapi_get_account_apirestrictions.await_count == 1, (
            "Cache miss on second call — TTL cache not honoring hits"
        )

    @pytest.mark.asyncio
    async def test_expiry_recalls(self, monkeypatch):
        # Ultra-short TTL so we can verify expiry without sleeping.
        monkeypatch.setenv("KEY_PERMISSION_CACHE_TTL", "1")
        ex = AsyncMock()
        ex.id = "okx"
        ex.private_get_account_config = AsyncMock(return_value={
            "data": [{"perm": "read_only"}],
        })

        await detect_permissions(ex, api_key_id="key-xyz")
        assert ex.private_get_account_config.await_count == 1

        # Forge time forward past the TTL window using monotonic patch.
        real_monotonic = time.monotonic
        monkeypatch.setattr(
            time, "monotonic", lambda: real_monotonic() + 5,
        )

        await detect_permissions(ex, api_key_id="key-xyz")
        assert ex.private_get_account_config.await_count == 2, (
            "Cache should have expired after 1s but reused stale value"
        )

    @pytest.mark.asyncio
    async def test_no_key_id_bypasses_cache(self):
        ex = AsyncMock()
        ex.id = "bybit"
        ex.private_get_v5_user_query_api = AsyncMock(return_value={
            "result": {"permissions": {}},
        })

        await detect_permissions(ex, api_key_id=None)
        await detect_permissions(ex, api_key_id=None)
        assert ex.private_get_v5_user_query_api.await_count == 2, (
            "api_key_id=None must skip the cache so the wizard pre-store "
            "validate path doesn't see stale results"
        )

    @pytest.mark.asyncio
    async def test_unknown_exchange_returns_all_false(self):
        ex = AsyncMock()
        ex.id = "kraken"  # not in the dispatch table
        result = await detect_permissions(ex)
        assert result == {"read": False, "trade": False, "withdraw": False}

    @pytest.mark.asyncio
    async def test_per_key_isolation(self):
        # Different key ids must NOT share a cache slot.
        ex = AsyncMock()
        ex.id = "binance"
        ex.sapi_get_account_apirestrictions = AsyncMock(return_value={
            "enableSpotAndMarginTrading": False,
            "enableFutures": False,
            "enableWithdrawals": False,
        })

        await detect_permissions(ex, api_key_id="key-1")
        await detect_permissions(ex, api_key_id="key-2")
        assert ex.sapi_get_account_apirestrictions.await_count == 2
