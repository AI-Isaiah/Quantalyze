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
from tests.limiter_stub import evict_module, patch_shared_limiter


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

    # PYAPI-03: the routers no longer CONSTRUCT a Limiter, they import the
    # singleton from services.rate_limit — so rebinding `slowapi.Limiter` above
    # no longer reaches them and the REAL slowapi wrapper would reject the
    # MagicMock request this suite passes. Stub the INSTANCE too; must run
    # before the router is re-imported below. See tests/limiter_stub.py.
    patch_shared_limiter(monkeypatch)

    evict_module("routers.exchange")
    from routers import exchange

    yield exchange
    evict_module("routers.exchange")


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


# ---------------------------------------------------------------------------
# Phase 153.6 / PARITY-01 — the SHARED probe body (`services/mt5_probe.py`)
# ---------------------------------------------------------------------------
# The cases above pin the OFFLINE pre-probe seam. The block below pins the ONLINE
# probe seam that replaced the second hand-written copy: 153.3 landed three fixes
# on `routers/exchange.py` and none of them reached `services/ingestion/mt5.py`,
# because each path carried its own `_read_terminal` / `_probe` closure. There is
# now ONE body in `services/mt5_probe.py` and both paths call it, so the three
# fixes cannot land once again.
#
# These are UNIT cases over the shared body itself; the two-path cases that prove
# the CALLERS actually reach it live further below.


class _FakeProbeClient:
    """Duck-typed stand-in for ``Mt5Client``. Records every verb the probe calls,
    so "``order_check`` was never reached" is asserted as an observation rather
    than inferred from a return value."""

    def __init__(self, *, account_info, terminal_info=None, terminal_raises=None):
        self._account_info = account_info
        self._terminal_info = terminal_info
        self._terminal_raises = terminal_raises
        self.calls: list[str] = []

    def login(self, login, password, server) -> None:
        self.calls.append("login")

    def account_info(self) -> dict:
        self.calls.append("account_info")
        return dict(self._account_info)

    def terminal_info(self) -> dict:
        self.calls.append("terminal_info")
        if self._terminal_raises is not None:
            raise self._terminal_raises
        return dict(self._terminal_info or {})

    def order_check(self, request) -> dict:
        self.calls.append("order_check")
        return {"retcode": 10017}


def test_read_terminal_reraises_an_abandoned_session_before_the_broad_arm():
    """⭐ D-09 / D-14 — B1 and A2 are ONE edit.

    `Mt5SessionAbandoned` is a plain `Exception` by design (D-42), so a broad
    `except Exception` swallows it. Absorbed here it becomes a `None` terminal
    read: an operator triaging in Railway reads a gateway MATERIALIZATION fault
    that never happened, and the probe continues on a "terminal unreadable"
    premise that is false. The fence type must reach its own arm first.
    """
    from services.mt5_client import Mt5SessionAbandoned
    from services.mt5_probe import read_terminal

    client = _FakeProbeClient(
        account_info={"login": 42},
        terminal_raises=Mt5SessionAbandoned("lease moved on"),
    )

    with pytest.raises(Mt5SessionAbandoned):
        read_terminal(client, log_prefix="unit")


def test_read_terminal_materialize_failure_logs_the_class_only(caplog):
    """A2 / T-134-01. An unconverted transport raise escapes `_guarded_read`'s
    scrubbing, and `mt5linux` f-string-interpolates the password into the source
    it evaluates remotely — so the exception MESSAGE is a credential-disclosure
    surface and only the CLASS is safe to log. The read must still fail CLOSED
    (None -> "undetermined" -> refusal)."""
    from services.mt5_probe import read_terminal

    secret = "s3cr3t-investor-pw"
    client = _FakeProbeClient(
        account_info={"login": 42},
        terminal_raises=OSError(f"rpyc eval failed: login(42, {secret}, Broker)"),
    )

    with caplog.at_level("WARNING"):
        assert read_terminal(client, log_prefix="unit") is None

    logged = caplog.text
    assert "error_class=OSError" in logged, logged
    assert secret not in logged, "the exception MESSAGE reached the log (T-134-01)"


def test_run_probe_short_circuits_order_check_on_an_undetermined_terminal():
    """⭐ A1 — the exact documented incident.

    Under MetaQuotes' default-ON *"Disable automatic trading through the external
    Python API"* the terminal refuses the probe, and that refusal's
    `Mt5ClientError` leaves by a different door: `classify_mt5_login_error`'s
    `_WRONG_SERVER_TOKENS` carry "terminal", so it came out as a 400 telling the
    user their BROKER SERVER is wrong — an accusation against the user for a
    checkbox in OUR gateway. Once the seam already answers "undetermined",
    `order_check` cannot improve the verdict and must not run.

    The POST login bracket still runs: the terminal read we classify on must
    belong to OUR account, exactly as a probe result would have had to.
    """
    from services.mt5_probe import run_probe

    client = _FakeProbeClient(
        account_info={"login": 42, "trade_allowed": False},
        terminal_info={"connected": True, "trade_allowed": False},
    )

    info, probe, terminal = run_probe(
        client, login=42, investor_pw="pw", server="Broker-Demo", log_prefix="unit"
    )

    assert "order_check" not in client.calls, client.calls
    assert probe == {}
    assert terminal == {"connected": True, "trade_allowed": False}
    assert info["login"] == 42
    # POST bracket: account_info is read a SECOND time and re-asserted.
    assert client.calls.count("account_info") == 2, client.calls


def test_mt5_gateway_misconfigured_message_is_curated_and_credential_free():
    """A3's condition half. The operator-fault copy is a FIXED constant that is
    rendered to a human, so it must name no credential and must carry no token
    from the live classification tables — a message containing "terminal" or
    "server" is one `classify_mt5_login_error` call away from being re-read as
    "the user's broker server is wrong", which is the very accusation A1 removed.
    """
    from services.mt5_validation import _AUTH_TOKENS, _WRONG_SERVER_TOKENS
    from services.mt5_probe import (
        MT5_GATEWAY_MISCONFIGURED_DETAIL,
        Mt5GatewayMisconfigured,
    )

    text = MT5_GATEWAY_MISCONFIGURED_DETAIL.lower()
    assert text, "the curated constant is empty — every assertion below is vacuous"
    for token in (*_WRONG_SERVER_TOKENS, *_AUTH_TOKENS):
        assert token not in text, f"curated copy carries the classify token {token!r}"
    for word in ("password", "investor", "master", "secret"):
        assert word not in text, f"curated copy names the credential word {word!r}"

    # The exception defaults to the constant, so no call site can raise it with
    # raw remote text by omission.
    assert str(Mt5GatewayMisconfigured()) == MT5_GATEWAY_MISCONFIGURED_DETAIL
    assert isinstance(Mt5GatewayMisconfigured(), Exception)
