"""MT5SRC-02 — the `is_mt5` read-only branch in the worker `validate_key` path.

MT5 is NOT a ccxt exchange (it speaks RPyC to a terminal bridge, never ccxt), so
`routers/exchange.py::validate_key` must NOT route it through
`create_exchange`/`EXCHANGE_CLASSES`. Instead the branch proves auth+read via the
Phase-134 read-only `Mt5Client` (login -> account_info -> order_check probe, NEVER
the trade-submit method) and returns an HONEST shape: `read_only=True` asserted
STRUCTURALLY (the facade has no trade surface — sFOX A1 posture) PLUS a behavioral
investor-vs-master probe sFOX has no analog for.

This suite clones `test_sfox_validate.py`'s posture (offline, injected transport
double, byte-exact detail-string pins) and adds the MT5 divergences.

Regression gates — WHY each case matters (Rule 9):
  - go-dark gate (T-135-13): with MT5_ENABLED off, a mt5 /validate-key request must
    fail CLOSED with the honest "not yet available" 400 BEFORE any client is
    constructed or any live probe fires — never a live probe pre-go-live.
  - master-reject EoP (T-135-09): a trade-capable (master) login MUST be rejected
    with the targeted 400 so it is NEVER encrypted/persisted as read-only (the TS
    caller only proceeds to /encrypt-key after {valid:true}). Defensive either-signal
    rule — trade_allowed OR an accepted order_check retcode both reject.
  - AUTH-string byte-identity: bad creds map to the EXACT ccxt AUTH_FAILED string so
    the cross-language TS classifyKeyValidationError returns KEY_AUTH_FAILED with ZERO
    TS edits. A reworded detail silently breaks classification — pinned as a literal
    imported from the closed-set source, never retyped.
  - three DISTINGUISHABLE failure paths: bad-creds (AUTH_FAILED) vs master
    (MT5_MASTER_PASSWORD_DETAIL) vs wrong/missing-server (MT5_WRONG_SERVER_DETAIL)
    are each a distinct string so the wizard surfaces distinct remedies.
  - fail-CLOSED + HONEST on transient/timeout (F4): a hung bridge or an
    unrecognized error maps to the shared NETWORK_ERROR_DETAIL — a 400 that fails
    CLOSED (never {"valid": true}) and never blames the credentials.
  - server-misconfig is a 503, never the user's key: missing MT5_GATEWAY_HOST/PORT
    is OUR fault, logged secret-free.
  - close() on EVERY path after construction: the terminal session must never leak.
  - ccxt path untouched: a binance request must still flow through create_exchange
    -> validate_key_permissions — pinned so branch placement can't perturb ccxt.
  - grep-gate invariant: `order_send(` must never appear in the router source (the
    branch is order_check-only, read-only by construction).
"""
from __future__ import annotations

import asyncio
import pathlib
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from services.closed_sets import (
    MT5_DISABLED_DETAIL,
    MT5_MASTER_PASSWORD_DETAIL,
    MT5_WRONG_SERVER_DETAIL,
)
from services.exchange import AUTH_FAILED_DETAIL, NETWORK_ERROR_DETAIL
from services.mt5_client import Mt5ClientError


@pytest.fixture()
def exchange_router(monkeypatch):
    """Import routers.exchange with slowapi stubbed (no-op Limiter) and the MT5
    go-dark gate + gateway env pinned ON for the ENABLED-path tests. The disabled
    default is covered by the dedicated gate-off test (which delenv's MT5_ENABLED)."""

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

    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    sys.modules.pop("routers.exchange", None)
    from routers import exchange as exchange_router

    yield exchange_router

    sys.modules.pop("routers.exchange", None)


def _make_client(*, login_raises=None, account=None, order_check=None):
    """A mock Mt5Client instance: sync login/account_info/order_check/close.

    `login_raises` makes login() raise (bad creds / wrong server / transient).
    `account` / `order_check` are the native dicts the read methods return
    (is_trade_capable reads .get('trade_allowed') / .get('retcode'))."""
    client = MagicMock(name="Mt5Client-instance")
    if login_raises is not None:
        client.login = MagicMock(side_effect=login_raises)
    else:
        client.login = MagicMock(return_value=None)
    client.account_info = MagicMock(return_value=account if account is not None else {})
    client.order_check = MagicMock(
        return_value=order_check if order_check is not None else {}
    )
    client.close = MagicMock()
    return client


def _install_mt5_client(router, client):
    """Patch the router's Mt5Client constructor to return `client`; return the
    factory spy so a test can assert construction args / that it never ran.
    (Mirrors the sfox suite's make_sfox_client injection, Rule 11.)"""
    factory = MagicMock(return_value=client)
    router.Mt5Client = factory
    return factory


def _make_req(exchange="mt5", api_key="123456", api_secret="investor-pw", passphrase="Broker-Demo"):
    # Credential-slot reuse: login -> api_key, investor pw -> api_secret,
    # broker server -> passphrase.
    from models.schemas import ValidateKeyRequest

    return ValidateKeyRequest(
        exchange=exchange,
        api_key=api_key,
        api_secret=api_secret,
        passphrase=passphrase,
    )


async def _call(router, req):
    return await router.validate_key(MagicMock(name="request"), req)


# "login": 123456 matches the parsed login from _make_req's api_key="123456" so the
# RED-TEAM login bracket (account_info().login == expected, pre+post the read) passes
# on the happy path — the fake terminal IS on the connected account.
_INVESTOR_ACCOUNT = {"trade_allowed": False, "balance": 1000.0, "login": 123456}
# An investor order_check is rejected (retcode != TRADE_RETCODE_DONE 10009).
_INVESTOR_ORDER_CHECK = {"retcode": 10027, "comment": "AutoTrading disabled"}


# --------------------------------------------------------------------------- #
# Go-dark gate — no live probe when disabled
# --------------------------------------------------------------------------- #


async def test_mt5_fails_closed_when_server_flag_off(exchange_router, monkeypatch):
    """T-135-13: with MT5_ENABLED off, a mt5 /validate-key request fails CLOSED
    with an honest 'not yet available' 400 BEFORE any Mt5Client is constructed —
    never a live probe, never a false AUTH_FAILED."""
    router = exchange_router
    monkeypatch.delenv("MT5_ENABLED", raising=False)

    factory = MagicMock(side_effect=AssertionError("Mt5Client must not run when MT5_ENABLED is off"))
    router.Mt5Client = factory

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_DISABLED_DETAIL
    factory.assert_not_called()


async def test_mt5_stays_fail_closed_for_non_exact_flag(exchange_router, monkeypatch):
    """Only the exact 'true' (case/space-normalized) enables mt5 — '1' / 'on' /
    '' / 'false' stay fail-closed, so a fat-fingered deploy value cannot half-open
    the gate."""
    router = exchange_router
    for flag in ("1", "on", "", "false"):
        monkeypatch.setenv("MT5_ENABLED", flag)
        factory = MagicMock(side_effect=AssertionError("no live probe when disabled"))
        router.Mt5Client = factory
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())
        assert ei.value.status_code == 400
        assert ei.value.detail == MT5_DISABLED_DETAIL


# --------------------------------------------------------------------------- #
# Success — investor login -> valid, read_only (structural), close on success
# --------------------------------------------------------------------------- #


async def test_mt5_investor_returns_valid_readonly_and_never_ccxt(exchange_router):
    """mt5 + investor creds -> {valid:true, read_only:true}; ccxt create_exchange
    is NEVER called for mt5; close() runs on the success path."""
    router = exchange_router
    client = _make_client(account=_INVESTOR_ACCOUNT, order_check=_INVESTOR_ORDER_CHECK)
    _install_mt5_client(router, client)

    create_exchange_spy = MagicMock(side_effect=AssertionError("create_exchange must not be called for mt5"))
    router.create_exchange = create_exchange_spy

    result = await _call(router, _make_req())

    assert result == {"valid": True, "read_only": True}
    client.login.assert_called_once()
    # account_info is read TWICE — the RED-TEAM login bracket re-asserts the
    # terminal account PRE (before order_check) and POST (after) the probe.
    assert client.account_info.call_count == 2
    client.order_check.assert_called_once()
    client.close.assert_called_once()
    create_exchange_spy.assert_not_called()


# --------------------------------------------------------------------------- #
# Master rejection (EoP) — never persisted; either positive signal rejects
# --------------------------------------------------------------------------- #


async def test_mt5_master_via_trade_allowed_rejected(exchange_router):
    """T-135-09: a master (trade_allowed) login is REJECTED with the byte-exact
    MT5_MASTER_PASSWORD_DETAIL and is NEVER persisted (the branch never returns
    valid:true, so the TS caller never reaches /encrypt-key). close() still runs."""
    router = exchange_router
    client = _make_client(
        account={"trade_allowed": True, "login": 123456},
        order_check=_INVESTOR_ORDER_CHECK,
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_MASTER_PASSWORD_DETAIL
    client.close.assert_called_once()


async def test_mt5_master_via_order_check_retcode_rejected(exchange_router):
    """Defensive either-signal rule (Pitfall 4): trade_allowed is False but the
    order_check probe would be ACCEPTED (retcode TRADE_RETCODE_DONE 10009) — that
    positive signal alone still rejects the master login."""
    router = exchange_router
    client = _make_client(
        account={"trade_allowed": False, "login": 123456},
        order_check={"retcode": 10009, "comment": "Done"},
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_MASTER_PASSWORD_DETAIL
    client.close.assert_called_once()


async def test_mt5_terminal_account_mismatch_fails_closed(exchange_router):
    """RED-TEAM login bracket: if the shared terminal is on the WRONG account
    (account_info().login != the connected login — e.g. a concurrent validate
    re-logged it mid-probe), the verdict must FAIL CLOSED transient
    (NETWORK_ERROR_DETAIL), NEVER {valid:true}, and order_check must NOT even run
    (the PRE bracket refuses before the probe). close() still runs. Without the
    bracket, is_trade_capable() would be judged against the wrong account — a
    master password could be wrongly accepted as read-only. Reddens if removed."""
    router = exchange_router
    # The connected login is 123456 (from _make_req) but the terminal reports 999999.
    client = _make_client(
        account={"trade_allowed": False, "login": 999999},
        order_check=_INVESTOR_ORDER_CHECK,
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    # PRE bracket fires right after the first account_info, before the probe.
    client.order_check.assert_not_called()
    client.close.assert_called_once()


# --------------------------------------------------------------------------- #
# Three distinguishable failure paths — bad creds / wrong server / transient
# --------------------------------------------------------------------------- #


async def test_mt5_bad_creds_maps_to_exact_auth_string(exchange_router):
    """Bad creds (login raises an Mt5ClientError classified 'auth') -> 400 with the
    byte-identical AUTH_FAILED string (KEY_AUTH_FAILED). close() runs."""
    router = exchange_router
    err = Mt5ClientError(134, "invalid account or password")
    client = _make_client(login_raises=err)
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == AUTH_FAILED_DETAIL
    assert "authentication failed" in ei.value.detail.lower()
    client.close.assert_called_once()


async def test_mt5_wrong_server_maps_to_wrong_server_detail(exchange_router):
    """Wrong server (Mt5ClientError classified 'wrong_server') -> 400 with the
    byte-exact MT5_WRONG_SERVER_DETAIL — DISTINGUISHABLE from the bad-password
    (AUTH_FAILED) detail so the wizard surfaces a distinct remedy."""
    router = exchange_router
    err = Mt5ClientError(0, "trade server not found")
    client = _make_client(login_raises=err)
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_WRONG_SERVER_DETAIL
    # distinguishable from the bad-password path
    assert ei.value.detail != AUTH_FAILED_DETAIL
    client.close.assert_called_once()


async def test_mt5_transient_maps_to_network_detail_not_credentials(exchange_router):
    """F4: an unrecognized (transient) login error must fail CLOSED with the SHARED
    NETWORK_ERROR_DETAIL — never {"valid": true}, never 'authentication failed'
    (a transient bridge blip is not the user's key). close() runs."""
    router = exchange_router
    err = Mt5ClientError(0, "timeout waiting for response")
    client = _make_client(login_raises=err)
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    assert "authentication failed" not in ei.value.detail.lower()
    client.close.assert_called_once()


async def test_mt5_probe_timeout_maps_to_network_detail_and_closes(exchange_router, monkeypatch):
    """T-135-12 (WEDGE-01): a hung RPyC probe is bounded by the wait_for ceiling —
    a TimeoutError maps to the shared NETWORK_ERROR_DETAIL (transient), never a
    500, never valid. The client is constructed, so close() must still run."""
    router = exchange_router
    client = _make_client(account=_INVESTOR_ACCOUNT, order_check=_INVESTOR_ORDER_CHECK)
    _install_mt5_client(router, client)

    # There are now THREE wait_for sites (RED-TEAM): (1) the off-loop ctor, (2) the
    # probe, (3) the off-loop close. Time out only the PROBE (call #2) so the client
    # is still constructed (ctor passes) and the finally close still runs — the exact
    # "hung probe, bounded, closes" scenario. Calls #1 and #3 run for real.
    _wf_calls = {"n": 0}

    async def _timeout_on_probe(aw, timeout=None):
        _wf_calls["n"] += 1
        if _wf_calls["n"] == 2:
            # Close the underlying to_thread coroutine so it never runs (no thread,
            # no "coroutine was never awaited" warning), then simulate the ceiling.
            if hasattr(aw, "close"):
                aw.close()
            raise asyncio.TimeoutError
        return await aw

    monkeypatch.setattr(router.asyncio, "wait_for", _timeout_on_probe)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    client.close.assert_called_once()


# --------------------------------------------------------------------------- #
# Pre-construction guards — no client built on a structurally-invalid request
# --------------------------------------------------------------------------- #


async def test_mt5_blank_server_is_wrong_server_without_client(exchange_router):
    """A missing/blank broker server -> 400 MT5_WRONG_SERVER_DETAIL BEFORE any
    client is constructed (distinct from a bad-password failure)."""
    router = exchange_router
    factory = MagicMock(side_effect=AssertionError("Mt5Client must not be built for a blank server"))
    router.Mt5Client = factory

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(passphrase="   "))

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_WRONG_SERVER_DETAIL
    factory.assert_not_called()


@pytest.mark.parametrize("login", ["not-a-login", "", "   "])
async def test_mt5_bad_login_fails_auth_without_client(exchange_router, login):
    """A non-numeric / empty MT5 login cannot authenticate -> 400 AUTH_FAILED
    BEFORE constructing a client (mirrors the sfox IN-01 up-front guard)."""
    router = exchange_router
    factory = MagicMock(side_effect=AssertionError("Mt5Client must not be built for a bad login"))
    router.Mt5Client = factory

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(api_key=login))

    assert ei.value.status_code == 400
    assert ei.value.detail == AUTH_FAILED_DETAIL
    factory.assert_not_called()


@pytest.mark.parametrize("pw", ["", "   "])
async def test_mt5_blank_investor_password_fails_auth_without_client(exchange_router, pw):
    """A blank investor password cannot authenticate -> 400 AUTH_FAILED BEFORE
    constructing a client."""
    router = exchange_router
    factory = MagicMock(side_effect=AssertionError("Mt5Client must not be built for a blank password"))
    router.Mt5Client = factory

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(api_secret=pw))

    assert ei.value.status_code == 400
    assert ei.value.detail == AUTH_FAILED_DETAIL
    factory.assert_not_called()


# --------------------------------------------------------------------------- #
# Server misconfig — a 503, never the user's key, logged secret-free
# --------------------------------------------------------------------------- #


async def test_mt5_missing_gateway_env_is_503_and_secret_free(exchange_router, monkeypatch):
    """Missing MT5_GATEWAY_HOST/PORT is a SERVER misconfig -> 503
    NETWORK_ERROR_DETAIL (never a 500, never AUTH_FAILED that blames the user), and
    the log line carries NO credential values."""
    router = exchange_router
    monkeypatch.delenv("MT5_GATEWAY_HOST", raising=False)
    monkeypatch.delenv("MT5_GATEWAY_PORT", raising=False)

    factory = MagicMock(side_effect=AssertionError("no client when the gateway is unconfigured"))
    router.Mt5Client = factory

    mock_logger = MagicMock()
    monkeypatch.setattr(router, "logger", mock_logger)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(api_key="123456", api_secret="s3cr3t-pw", passphrase="MyBroker-Live"))

    assert ei.value.status_code == 503
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    factory.assert_not_called()
    # No credential value may reach ANY log line.
    for meth in ("exception", "error", "warning", "info", "debug"):
        for call in getattr(mock_logger, meth).call_args_list:
            rendered = repr(call)
            assert "123456" not in rendered
            assert "s3cr3t-pw" not in rendered
            assert "MyBroker-Live" not in rendered


# --------------------------------------------------------------------------- #
# ccxt regression — branch placement does not perturb the ccxt flow
# --------------------------------------------------------------------------- #


async def test_ccxt_exchange_still_uses_create_exchange_path(exchange_router):
    """binance still flows through create_exchange -> validate_key_permissions;
    Mt5Client is NOT constructed for a ccxt exchange."""
    router = exchange_router

    fake_exchange = MagicMock(name="ccxt-exchange")
    create_exchange_spy = MagicMock(return_value=fake_exchange)
    router.create_exchange = create_exchange_spy
    router.validate_key_permissions = AsyncMock(
        return_value={"valid": True, "read_only": True, "error": None}
    )
    router.aclose_exchange = AsyncMock()

    mt5_factory = MagicMock(side_effect=AssertionError("Mt5Client must not be built for ccxt"))
    router.Mt5Client = mt5_factory

    result = await _call(
        router, _make_req(exchange="binance", api_key="k", api_secret="s")
    )

    assert result == {"valid": True, "read_only": True}
    create_exchange_spy.assert_called_once()
    assert create_exchange_spy.call_args.args[0] == "binance"
    mt5_factory.assert_not_called()


# --------------------------------------------------------------------------- #
# Grep-gate invariant — the branch is order_check-only, never the trade method
# --------------------------------------------------------------------------- #


def test_router_source_never_calls_the_trade_submit_method():
    """The whole point of the read-only story: routers/exchange.py must NEVER call
    the MT5 trade-submit method. Assert the call token is absent from the source so
    the invariant survives future edits (the trade token is written here only in
    prose, without call parentheses, so this test does not trip its own gate)."""
    src = pathlib.Path(__file__).resolve().parent.parent / "routers" / "exchange.py"
    text = src.read_text()
    forbidden = "order_send" + "("
    assert forbidden not in text


def test_mt5_detail_strings_are_distinct_contract_literals():
    """No-drift guard: the three MT5 failure-path details + the shared AUTH_FAILED
    string are four DISTINCT literals (distinguishable failure paths) — a reword
    that collapsed two would silently merge the wizard remedies."""
    strings = {
        AUTH_FAILED_DETAIL,
        MT5_MASTER_PASSWORD_DETAIL,
        MT5_WRONG_SERVER_DETAIL,
        NETWORK_ERROR_DETAIL,
        MT5_DISABLED_DETAIL,
    }
    assert len(strings) == 5
    # The substring contracts the TS classifier depends on.
    assert "master password" in MT5_MASTER_PASSWORD_DETAIL.lower()
    assert "broker server" in MT5_WRONG_SERVER_DETAIL.lower()
    assert "authentication failed" in AUTH_FAILED_DETAIL.lower()
