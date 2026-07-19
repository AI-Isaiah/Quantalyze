"""F5(a) (red-team HIGH8 SECURITY) regression — verify_strategy's OUTER
exception handler must redact credentials and must NOT ship stack-locals to
Sentry via exc_info=True.

This file deliberately uses the REAL fastapi / slowapi / ccxt / starlette
packages (all installed in CI + local). Several sibling portfolio test files
install MagicMock stubs into sys.modules at import time (a local-dev fallback);
those stubs turn the slowapi-decorated `verify_strategy` into a non-awaitable
MagicMock. To stay isolation-safe regardless of collection order, we evict any
stubbed copies of the packages we need and re-import `routers.portfolio` fresh
against the real packages.
"""

from __future__ import annotations

import asyncio
import importlib
import sys
from unittest.mock import MagicMock

import pytest


def _real_portfolio_module():
    """Import routers.portfolio against the REAL fastapi/slowapi/ccxt/starlette.

    If a sibling test installed MagicMock stubs for those packages, evict them
    (and the cached routers.portfolio bound to them) so importlib re-binds to
    the genuine packages.
    """
    real_pkgs = [
        "supabase",
        "slowapi",
        "slowapi.util",
        "fastapi",
        "fastapi.routing",
        "ccxt",
        "ccxt.async_support",
        "starlette",
        "starlette.requests",
    ]
    evicted = False
    for name in real_pkgs:
        mod = sys.modules.get(name)
        if isinstance(mod, MagicMock):
            del sys.modules[name]
            evicted = True
    if evicted:
        # Drop any routers.portfolio (and its router/services deps) bound to the
        # stubbed packages so the re-import resolves the real ones.
        for name in list(sys.modules):
            if name == "routers.portfolio" or name.startswith("routers."):
                del sys.modules[name]
    # Importing the real packages now (raises if genuinely absent — which would
    # itself be a CI signal, not a silent skip).
    importlib.import_module("fastapi")
    importlib.import_module("slowapi")
    return importlib.import_module("routers.portfolio")


class TestVerifyStrategyOuterHandlerRedaction:
    def test_fetch_time_exception_with_api_key_redacted_no_exc_info(
        self, monkeypatch, caplog
    ):
        portfolio_mod = _real_portfolio_module()
        from fastapi import HTTPException
        from models.schemas import VerifyStrategyRequest
        from starlette.requests import Request as StarletteRequest

        # Confirm we are NOT running against a stubbed fastapi (HTTPException
        # must be the real class with status_code, not the bare Exception stub).
        assert hasattr(HTTPException(status_code=500, detail="x"), "status_code")

        raw_key = "AKIDLIVE0123456789abcdef"
        req = VerifyStrategyRequest(
            email="trader@example.com",
            exchange="binance",
            api_key=raw_key,
            api_secret="s" * 24,
        )

        monkeypatch.setattr(
            portfolio_mod, "_check_verify_strategy_email_rate", lambda _email: True
        )

        class _FakeExchange:
            async def close(self):
                return None

        monkeypatch.setattr(
            portfolio_mod, "create_exchange", lambda *a, **kw: _FakeExchange()
        )

        async def _ok_validation(_exchange):
            return {"error": None}

        monkeypatch.setattr(portfolio_mod, "validate_key_permissions", _ok_validation)
        monkeypatch.setattr(portfolio_mod, "get_supabase", lambda: MagicMock())

        # CCXT auth/signature errors embed the api_key in the message verbatim —
        # raise from the trade fetch so it lands in the OUTER handler.
        async def _boom(_exchange):
            raise RuntimeError(f"Invalid signature for key {raw_key}: rejected")

        monkeypatch.setattr(portfolio_mod, "fetch_all_trades", _boom)

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/verify-strategy",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "query_string": b"",
        }
        request = StarletteRequest(scope)

        with caplog.at_level("ERROR", logger="quantalyze.analytics"):
            with pytest.raises(HTTPException) as ei:
                asyncio.run(portfolio_mod.verify_strategy(request, req))

        assert ei.value.status_code == 500

        # No log record may carry the raw api_key.
        for rec in caplog.records:
            assert raw_key not in rec.getMessage(), (
                "raw api_key leaked into a verify_strategy log record"
            )

        # The outer "computation failed" record must be redacted AND have no
        # traceback attached (exc_info=True ships api_key/api_secret stack-locals
        # to Sentry).
        outer_recs = [
            r for r in caplog.records if "computation failed" in r.getMessage()
        ]
        assert outer_recs, "outer handler must emit a 'computation failed' record"
        for rec in outer_recs:
            assert "[REDACTED]" in rec.getMessage(), (
                "outer handler must run the message through _redact_credentials"
            )
            assert rec.exc_info is None, (
                "outer handler must NOT set exc_info=True — it ships api_key / "
                "api_secret stack-locals to Sentry"
            )


class TestVerifyStrategySfoxHonestRejection:
    """SFOX-05 (F7): verify_strategy rejects sfox EARLY with honest copy — never a
    misleading network/timeout envelope, never a fall-through into
    create_exchange's generic ValueError. The verify UI does not offer sfox until
    Phase 122; sfox connects via the add-key flow."""

    def test_sfox_rejected_early_with_honest_copy_no_timeout_wording(
        self, monkeypatch
    ):
        import asyncio

        portfolio_mod = _real_portfolio_module()
        from fastapi import HTTPException
        from models.schemas import VerifyStrategyRequest
        from starlette.requests import Request as StarletteRequest

        req = VerifyStrategyRequest(
            email="trader@example.com",
            exchange="sfox",
            api_key="tok_sfox_abc",
            api_secret="",
        )

        # create_exchange must NEVER be reached for sfox (it would ValueError /
        # misdirect). Neuter it so a fall-through reddens loudly.
        monkeypatch.setattr(
            portfolio_mod,
            "create_exchange",
            lambda *a, **kw: (_ for _ in ()).throw(
                AssertionError("create_exchange must NOT run for sfox")
            ),
        )

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/verify-strategy",
            "headers": [],
            "client": ("127.0.0.1", 12345),
            "query_string": b"",
        }
        request = StarletteRequest(scope)

        with pytest.raises(HTTPException) as ei:
            asyncio.run(portfolio_mod.verify_strategy(request, req))

        assert ei.value.status_code == 400
        detail = str(ei.value.detail).lower()
        # Honest copy names sfox + the add-key flow; NO network/timeout misdirection.
        assert "sfox" in detail
        assert "network" not in detail
        assert "timeout" not in detail
        assert "connection" not in detail
