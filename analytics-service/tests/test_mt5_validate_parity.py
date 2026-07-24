"""Phase 135 / WR-01 regression — the MT5 pre-probe credential validation must
classify EVERY missing/blank credential combination IDENTICALLY on both call
sites (the FastAPI ``_validate_mt5_key`` router branch and the
``Mt5Adapter.validate`` worker branch).

Before the fix the two paths hand-implemented the guard set independently and
DIVERGED: the adapter lacked the router's blank-password guard, and the two used
different check ordering (router: server -> login -> password; adapter: login ->
server). A doubly-blank login+server request therefore classified as
``MT5_WRONG_SERVER`` through the router but ``AUTH_FAILED`` through the adapter —
the exact drift the single ``mt5_validation`` seam exists to prevent. Both now
call ``parse_mt5_credentials``, so the classification cannot drift.

These tests FAIL against the pre-fix divergent code (the doubly-blank case
returns two different details; the blank-password case burns a live client build
on the adapter path) and PASS once both sides defer to the one seam.
"""
from __future__ import annotations

import asyncio
import sys

import pytest
from fastapi import HTTPException
from unittest.mock import MagicMock

from services.closed_sets import MT5_WRONG_SERVER_DETAIL
from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion.adapter import KeySubmissionRequest
from services.ingestion.mt5 import Mt5Adapter


@pytest.fixture()
def exchange_module(monkeypatch):
    """Import ``routers.exchange`` with slowapi stubbed (no-op Limiter). The
    pre-probe guards under test run BEFORE the MT5_ENABLED gate / any client
    construction, so no gateway env or live transport is needed here."""

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

    sys.modules.pop("routers.exchange", None)
    from routers import exchange

    yield exchange
    sys.modules.pop("routers.exchange", None)


def _adapter_req(*, api_key, api_secret, passphrase):
    return KeySubmissionRequest(
        flow_type="onboard",
        source="mt5",
        context={
            "api_key": api_key,
            "api_secret": api_secret,
            "passphrase": passphrase,
        },
    )


def _router_detail(exchange_module, *, api_key, api_secret, passphrase):
    with pytest.raises(HTTPException) as ei:
        asyncio.run(
            exchange_module._validate_mt5_key(api_key, api_secret, passphrase)
        )
    assert ei.value.status_code == 400
    return ei.value.detail


def test_doubly_blank_login_and_server_classifies_identically(exchange_module):
    """A request blank in BOTH login and server must classify the SAME through
    the router and the adapter. (Pre-fix: router -> wrong_server, adapter ->
    auth_failed — divergent.)"""
    router_detail = _router_detail(
        exchange_module, api_key="", api_secret="some-pw", passphrase=""
    )

    result = asyncio.run(
        Mt5Adapter().validate(
            _adapter_req(api_key="", api_secret="some-pw", passphrase="")
        )
    )

    # The seam's canonical (router) ordering checks server first -> wrong_server.
    assert result.human_message == router_detail
    assert result.human_message == MT5_WRONG_SERVER_DETAIL
    assert result.error_code == "MT5_WRONG_SERVER"
    assert result.valid is False


def test_blank_password_rejected_offline_on_both_paths(
    exchange_module, monkeypatch
):
    """A blank investor password must fail CLOSED (AUTH_FAILED) offline on BOTH
    paths, WITHOUT constructing a client / burning a live probe. (Pre-fix: the
    adapter had no blank-password guard and reached the client build.)"""
    # Router: any Mt5Client construction here is a regression.
    exchange_module.Mt5Client = MagicMock(
        side_effect=AssertionError("router must not build a client for a blank password")
    )
    # Adapter: any _build_client call here is a regression.
    monkeypatch.setattr(
        "services.ingestion.mt5._build_client",
        MagicMock(side_effect=AssertionError("adapter must not build a client for a blank password")),
    )
    # Gateway env set so the ONLY thing that can stop an unguarded old adapter is
    # the (now-hoisted) offline password guard — not a missing-env short-circuit.
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    router_detail = _router_detail(
        exchange_module, api_key="123456", api_secret="   ", passphrase="Broker-Demo"
    )

    result = asyncio.run(
        Mt5Adapter().validate(
            _adapter_req(api_key="123456", api_secret="   ", passphrase="Broker-Demo")
        )
    )

    assert result.human_message == router_detail
    assert result.human_message == AUTH_FAILED_DETAIL
    assert result.error_code == "AUTH_FAILED"
    assert result.valid is False
