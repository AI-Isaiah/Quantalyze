"""C-0202 regression — /fetch-trades must reject deactivated API keys.

Audit-2026-05-07 finding: the api_keys SELECT in `routers/exchange.py:fetch_trades`
had no `is_active=True` filter, so a key whose owner had revoked it (or that
the sole-source purge / admin had set inactive) would still serve /fetch-trades
calls. The deactivation gate was paper-only.

This test pins the SELECT chain shape: any future refactor that drops the
`.eq("is_active", True)` filter must fail this test loudly. The test does
NOT depend on slowapi or ccxt — it calls the handler coroutine directly
with a mocked supabase client and asserts the chained `.eq("is_active", True)`
appears in the api_keys query.
"""

from __future__ import annotations

import sys
from unittest.mock import MagicMock

import pytest


@pytest.fixture()
def stubbed_exchange_router(monkeypatch):
    """Install minimal sys.modules stubs so importing routers.exchange
    works without slowapi installed."""

    # Stub slowapi / slowapi.util so the module-level Limiter() and
    # @limiter.limit('100/hour') decorators don't blow up at import time.
    class _NoopLimiter:
        def __init__(self, *args, **kwargs):
            pass

        def limit(self, *args, **kwargs):
            def decorator(fn):
                return fn
            return decorator

    slowapi_stub = MagicMock()
    slowapi_stub.Limiter = _NoopLimiter
    slowapi_util_stub = MagicMock()
    slowapi_util_stub.get_remote_address = lambda *a, **k: "1.2.3.4"

    monkeypatch.setitem(sys.modules, "slowapi", slowapi_stub)
    monkeypatch.setitem(sys.modules, "slowapi.util", slowapi_util_stub)

    # Reload so the module picks up our stubs
    sys.modules.pop("routers.exchange", None)
    from routers import exchange as exchange_router

    yield exchange_router

    sys.modules.pop("routers.exchange", None)


class TestC0202_DeactivatedKeyRejected:
    """C-0202 — deactivated keys must not serve /fetch-trades."""

    def _make_supabase_with_strategy_and_inactive_key(self):
        """Mock that returns a strategy row but no api_key when the
        is_active=True filter is applied (simulating a deactivated key)."""
        supabase = MagicMock()

        # Track which .eq() calls were made on the api_keys query so the
        # test can assert is_active filter was applied.
        api_keys_eq_calls: list[tuple[str, object]] = []

        def strategies_chain():
            chain = MagicMock()
            chain.select.return_value = chain
            chain.eq.return_value = chain
            chain.single.return_value = chain
            chain.execute.return_value = MagicMock(
                data={"id": "s-1", "user_id": "u-1", "api_key_id": "k-1"}
            )
            return chain

        def api_keys_chain():
            chain = MagicMock()
            chain.select.return_value = chain

            def _eq(field, value):
                api_keys_eq_calls.append((field, value))
                return chain

            chain.eq.side_effect = _eq
            chain.single.return_value = chain
            # When is_active=True filter is applied, deactivated key returns
            # no row — simulating PGRST116 / empty result.
            chain.execute.return_value = MagicMock(data=None)
            return chain

        def from_table(table_name: str):
            if table_name == "strategies":
                return strategies_chain()
            if table_name == "api_keys":
                return api_keys_chain()
            return MagicMock()

        supabase.table.side_effect = from_table
        return supabase, api_keys_eq_calls

    @pytest.mark.asyncio
    async def test_inactive_key_returns_404(self, stubbed_exchange_router, monkeypatch):
        """Deactivated key → 404 'API key not found'."""
        from fastapi import HTTPException

        supabase, api_keys_eq_calls = (
            self._make_supabase_with_strategy_and_inactive_key()
        )

        # Stub get_supabase + get_kek so the handler reaches the lookup.
        monkeypatch.setattr(
            stubbed_exchange_router, "get_supabase", lambda: supabase
        )
        monkeypatch.setattr(
            stubbed_exchange_router, "get_kek", lambda: b"\x00" * 32
        )

        # Build a request that has a connected api_key_id.
        req = MagicMock()
        req.strategy_id = "s-1"
        request = MagicMock()

        with pytest.raises(HTTPException) as exc_info:
            await stubbed_exchange_router.fetch_trades(request, req)

        assert exc_info.value.status_code == 404
        assert "not found" in exc_info.value.detail.lower()

    @pytest.mark.asyncio
    async def test_api_keys_select_includes_is_active_filter(
        self, stubbed_exchange_router, monkeypatch
    ):
        """The api_keys SELECT chain must apply `.eq('is_active', True)`.

        This is the structural assertion: any refactor that drops the
        is_active filter must fail this test. Without the filter, a
        deactivated key would still serve /fetch-trades.
        """
        from fastapi import HTTPException

        supabase, api_keys_eq_calls = (
            self._make_supabase_with_strategy_and_inactive_key()
        )

        monkeypatch.setattr(
            stubbed_exchange_router, "get_supabase", lambda: supabase
        )
        monkeypatch.setattr(
            stubbed_exchange_router, "get_kek", lambda: b"\x00" * 32
        )

        req = MagicMock()
        req.strategy_id = "s-1"
        request = MagicMock()

        # We expect 404 (deactivated → no row), but the assertion below
        # is on the SELECT chain shape, not the response.
        with pytest.raises(HTTPException):
            await stubbed_exchange_router.fetch_trades(request, req)

        # Assert is_active=True filter was applied to the api_keys query.
        assert ("is_active", True) in api_keys_eq_calls, (
            "C-0202 regression: api_keys SELECT must filter is_active=True. "
            f"Observed .eq() calls on api_keys: {api_keys_eq_calls!r}"
        )
        # Also assert the id filter was applied (sanity check the chain).
        assert any(
            field == "id" for field, _ in api_keys_eq_calls
        ), "api_keys SELECT should still filter by id"
