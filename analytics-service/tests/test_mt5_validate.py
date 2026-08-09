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
  - server-misconfig is OUR fault, never the user's key: missing
    MT5_GATEWAY_HOST/PORT answers a PERMANENT 500 (PYAPI-05 R-1 — a config gap no
    retry can clear must never feed the breaker; see docs/STATUS_CONTRACT.md
    S-02/S-03), logged secret-free.
  - release() on EVERY path after construction: the terminal session must never
    leak — INCLUDING when the end-to-end deadline fires (RESEARCH Pitfall 6). And
    it must be release(), never close() (153.3 / D-30): close() calls
    mt5.shutdown(), which on the shared single-process mt5linux gateway destroys
    the IPC pipe for every CONCURRENT caller (`-10004`) — a per-request denial of
    service against ourselves.
  - ccxt path untouched: a binance request must still flow through create_exchange
    -> validate_key_permissions — pinned so branch placement can't perturb ccxt.
  - grep-gate invariant: `order_send(` must never appear in the router source (the
    branch is order_check-only, read-only by construction).
"""
from __future__ import annotations

import asyncio
import pathlib
import sys
import time
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from services.closed_sets import (
    MT5_DISABLED_DETAIL,
    MT5_MASTER_PASSWORD_DETAIL,
    MT5_WRONG_SERVER_DETAIL,
)
from services.exchange import AUTH_FAILED_DETAIL, NETWORK_ERROR_DETAIL
from services.mt5_client import (
    MT5_REQUEST_TIMEOUT_S,
    MT5_VALIDATE_REQUEST_TIMEOUT_S,
    Mt5ClientError,
)
from tests.limiter_stub import evict_module, patch_shared_limiter


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

    # PYAPI-03: the routers no longer CONSTRUCT a Limiter, they import the
    # singleton from services.rate_limit — so rebinding `slowapi.Limiter` above
    # no longer reaches them and the REAL slowapi wrapper would reject the
    # MagicMock request this suite passes. Stub the INSTANCE too; must run
    # before the router is re-imported below. See tests/limiter_stub.py.
    patch_shared_limiter(monkeypatch)

    monkeypatch.setenv("MT5_ENABLED", "true")
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    evict_module("routers.exchange")
    from routers import exchange as exchange_router

    yield exchange_router

    evict_module("routers.exchange")


def _make_client(
    *, login_raises=None, account=None, order_check=None, terminal=None
):
    """A mock Mt5Client instance: sync login/account_info/terminal_info/
    order_check/release/close.

    BOTH teardown verbs are stubbed deliberately (153.3 / D-30): the validate path
    must call `release` on every path and must call `close` on NO path, and only a
    double that offers both can assert the second half.

    `login_raises` makes login() raise (bad creds / wrong server / transient).
    `account` / `order_check` / `terminal` are the native dicts the read methods
    return (classify_trade_capability reads account.get('trade_allowed'),
    order_check.get('retcode') and terminal's connected/trade_allowed pair).
    `terminal=None` means terminal_info() RAISES — the unreadable-terminal case,
    which must never be mistaken for a terminal that answered "no"."""
    client = MagicMock(name="Mt5Client-instance")
    if login_raises is not None:
        client.login = MagicMock(side_effect=login_raises)
    else:
        client.login = MagicMock(return_value=None)
    client.account_info = MagicMock(return_value=account if account is not None else {})
    client.order_check = MagicMock(
        return_value=order_check if order_check is not None else {}
    )
    if terminal is None:
        client.terminal_info = MagicMock(
            side_effect=Mt5ClientError(-10004, "No IPC connection")
        )
    else:
        client.terminal_info = MagicMock(return_value=terminal)
    client.release = MagicMock()
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
# An investor order_check is rejected with the DOCUMENTED investor code
# TRADE_RETCODE_TRADE_DISABLED (10017) — [DOC] enum_trade_return_codes.
#
# D-31 HISTORY: this fixture used to be `{"retcode": 10027}` with NO terminal read
# at all, and that combination WAS the fail-open scenario — under MetaQuotes'
# default-ON "Disable automatic trading through the external Python API" a MASTER
# password produces exactly those two negatives, and the old two-signal rule
# stamped it read_only. That combination now classifies "undetermined" (see the
# security regression below) and is no longer a success fixture anywhere.
_INVESTOR_ORDER_CHECK = {"retcode": 10017, "comment": "Trade disabled"}
# The terminal ITSELF permits trading and is attached to a trade server, so an
# account-level refusal is attributable to the ACCOUNT. Required for any
# read_only verdict (D-31).
_HEALTHY_TERMINAL_INFO = {"connected": True, "trade_allowed": True, "build": 4410}


# --------------------------------------------------------------------------- #
# classify_trade_capability — the tri-state seam (D-31), tested directly
#
# Every expected value below is a LITERAL typed here, never imported from
# services.mt5_validation: an oracle that reads its expectation out of the thing
# under test cannot fail (programme non-negotiable #3).
# --------------------------------------------------------------------------- #


_HEALTHY_TERMINAL = {"connected": True, "trade_allowed": True}


def test_capability_account_trade_allowed_is_trade_capable():
    """A POSITIVE account signal is conclusive and wins before any terminal
    reasoning — the pre-D-31 master-reject behaviour is preserved exactly, even
    when the terminal is healthy."""
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": True}, {"retcode": 10027}, dict(_HEALTHY_TERMINAL)
    )
    assert verdict == "trade_capable"


def test_capability_order_check_done_retcode_is_trade_capable():
    """An order_check the server WOULD accept (TRADE_RETCODE_DONE 10009) rejects
    the login on its own, even with trade_allowed false and a healthy terminal."""
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": False}, {"retcode": 10009}, dict(_HEALTHY_TERMINAL)
    )
    assert verdict == "trade_capable"


def test_capability_terminal_trade_disabled_is_undetermined():
    """⭐ D-31 SECURITY REGRESSION — the fail-OPEN this whole plan exists to close.

    The terminal is connected but its own trade permission is OFF, which is what
    MetaQuotes' DEFAULT-ON "Disable automatic trading through the external Python
    API" produces. Under that setting a **MASTER** password yields exactly these
    two negatives (trade_allowed false + a rejected order_check) — identical to an
    investor password. Concluding "read_only" here is how a trade-capable
    credential got stored stamped read-only.

    Reddens the moment the terminal trade-permission guard (branch 5) is removed.
    """
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": False},
        {"retcode": 10027},
        {"connected": True, "trade_allowed": False},
    )
    assert verdict == "undetermined"
    assert verdict != "read_only"


def test_capability_terminal_disconnected_is_undetermined():
    """[DOC] MQL5 "Trade permission" lists "no connection to the trade server" as a
    SIBLING cause of the account-level refusal, so a detached terminal makes the
    account negative unattributable to investor mode."""
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": False},
        {"retcode": 10027},
        {"connected": False, "trade_allowed": True},
    )
    assert verdict == "undetermined"


def test_capability_no_terminal_read_is_undetermined():
    """No terminal signal at all -> refuse. The two negatives prove nothing when
    we cannot rule out that our OWN terminal caused them."""
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": False}, {"retcode": 10027}, None
    )
    assert verdict == "undetermined"


@pytest.mark.parametrize(
    "terminal",
    [
        {"connected": True},  # trade_allowed field absent
        {"trade_allowed": True},  # connected field absent
        {},  # both absent
    ],
)
def test_capability_partial_terminal_shape_is_undetermined(terminal):
    """A terminal dict MISSING either load-bearing field is not a negative signal
    — it is an unreadable one. `.get()` would silently render an absent field as
    False and let a shape change masquerade as a verdict; the membership test
    refuses instead."""
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": False}, {"retcode": 10027}, terminal
    )
    assert verdict == "undetermined"


def test_capability_investor_retcode_10017_with_healthy_terminal_is_read_only():
    """⭐ The DOCUMENTED investor path, untested until D-31.

    TRADE_RETCODE_TRADE_DISABLED = 10017 is the retcode an investor session
    should produce ([DOC] enum_trade_return_codes). With the terminal reporting
    connected AND trade-permitting, the refusal is attributable to the ACCOUNT —
    the only combination under which read_only is honest.
    """
    from services.mt5_validation import classify_trade_capability

    verdict = classify_trade_capability(
        {"trade_allowed": False}, {"retcode": 10017}, dict(_HEALTHY_TERMINAL)
    )
    assert verdict == "read_only"


def test_capability_two_signal_fail_open_form_no_longer_exists():
    """The fail-OPEN form must be UNREACHABLE, not merely unused: a two-argument
    rule that can conclude read_only from two negatives is the defect itself, and
    leaving a wrapper/alias behind re-ships it at the next call site (D-31; the
    instance-vs-class lesson this repo has already paid for)."""
    import services.mt5_validation as mt5_validation

    assert not hasattr(mt5_validation, "is_trade_capable")


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
    is NEVER called for mt5; release() runs on the success path."""
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
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
    client.release.assert_called_once()
    create_exchange_spy.assert_not_called()


# --------------------------------------------------------------------------- #
# Master rejection (EoP) — never persisted; either positive signal rejects
# --------------------------------------------------------------------------- #


async def test_mt5_master_via_trade_allowed_rejected(exchange_router):
    """T-135-09: a master (trade_allowed) login is REJECTED with the byte-exact
    MT5_MASTER_PASSWORD_DETAIL and is NEVER persisted (the branch never returns
    valid:true, so the TS caller never reaches /encrypt-key). release() still runs."""
    router = exchange_router
    client = _make_client(
        account={"trade_allowed": True, "login": 123456},
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_MASTER_PASSWORD_DETAIL
    client.release.assert_called_once()


async def test_mt5_master_via_order_check_retcode_rejected(exchange_router):
    """Defensive either-signal rule (Pitfall 4): trade_allowed is False but the
    order_check probe would be ACCEPTED (retcode TRADE_RETCODE_DONE 10009) — that
    positive signal alone still rejects the master login."""
    router = exchange_router
    client = _make_client(
        account={"trade_allowed": False, "login": 123456},
        order_check={"retcode": 10009, "comment": "Done"},
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == MT5_MASTER_PASSWORD_DETAIL
    client.release.assert_called_once()


# --------------------------------------------------------------------------- #
# D-31 — the read-only fail-OPEN, closed at the ROUTER call site
# --------------------------------------------------------------------------- #


async def test_mt5_terminal_trade_disabled_never_returns_readonly(exchange_router):
    """⭐ D-31 SECURITY REGRESSION at the ROUTER seam.

    The defect: MetaQuotes ships "Disable automatic trading through the external
    Python API" ON by default. Under it a **MASTER** password produces the exact
    two negatives an investor password produces (account trade_allowed false +
    a rejected order_check), and the old two-signal rule answered
    {"valid": true, "read_only": true} — so a trade-capable credential was
    encrypted and persisted under a read-only claim we could not prove.

    The verdict is now "undetermined" and the router REFUSES. The cause is our
    OWN gateway terminal's setting, which no retry can clear, so it takes the
    PERMANENT operator arm — retryable false, no Retry-After, and nothing
    resembling a read_only success anywhere in the response.
    """
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        # Connected, so this is NOT a bridge blip — the terminal itself refuses
        # to permit trading, which is what the default Python-API option does.
        terminal={"connected": True, "trade_allowed": False},
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    detail = ei.value.detail
    # NEVER a success shape. Asserted structurally, not just by status: the whole
    # defect was a 200 carrying read_only true.
    assert not isinstance(detail, dict) or detail.get("read_only") is None
    assert "read_only" not in repr(detail)
    # PERMANENT operator fault — a setting in our terminal, not the user's key.
    assert ei.value.status_code == 500
    assert detail["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert detail["retryable"] is False
    assert not (ei.value.headers or {}).get("Retry-After")
    # Never blames the credentials.
    assert detail["detail"] != AUTH_FAILED_DETAIL
    assert detail["detail"] != MT5_MASTER_PASSWORD_DETAIL
    client.release.assert_called_once()


async def test_mt5_unreadable_terminal_is_transient_never_readonly(exchange_router):
    """An UNREADABLE terminal yields no capability signal, so the two account
    negatives prove nothing — refuse. This is our bridge blipping and it clears
    on retry, so it takes the TRANSIENT arm, NOT the operator arm, and NOT the
    wrong-server arm: classify_mt5_login_error's "ipc"/"terminal"/"connect"
    tokens would have blamed the user's broker server for our gateway's
    condition, which is why the terminal read is caught at its own call site."""
    router = exchange_router
    # terminal=None -> terminal_info() raises Mt5ClientError(-10004).
    client = _make_client(
        account=_INVESTOR_ACCOUNT, order_check=_INVESTOR_ORDER_CHECK, terminal=None
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.detail != MT5_WRONG_SERVER_DETAIL
    assert ei.value.detail != AUTH_FAILED_DETAIL
    client.release.assert_called_once()


async def test_mt5_disconnected_terminal_is_transient_never_readonly(exchange_router):
    """A terminal detached from the trade server is a documented SIBLING cause of
    the account-level refusal ([DOC] MQL5 "Trade permission"), so investor mode is
    not attributable — refuse, transiently."""
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal={"connected": False, "trade_allowed": True},
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    client.release.assert_called_once()


async def test_mt5_capability_refusal_logs_carry_no_credentials(
    exchange_router, monkeypatch
):
    """The two NEW capability WARNING lines must name a STAGE only — no login, no
    password, no broker server may reach any log call (same sweep the gateway
    misconfig case runs)."""
    router = exchange_router
    client = _make_client(
        account={"trade_allowed": False, "login": 123456},
        order_check=_INVESTOR_ORDER_CHECK,
        terminal={"connected": True, "trade_allowed": False},
    )
    _install_mt5_client(router, client)
    mock_logger = MagicMock()
    monkeypatch.setattr(router, "logger", mock_logger)

    with pytest.raises(HTTPException):
        await _call(
            router,
            _make_req(
                api_key="123456", api_secret="s3cr3t-pw", passphrase="MyBroker-Live"
            ),
        )

    for meth in ("exception", "error", "warning", "info", "debug"):
        for call in getattr(mock_logger, meth).call_args_list:
            rendered = repr(call)
            assert "123456" not in rendered
            assert "s3cr3t-pw" not in rendered
            assert "MyBroker-Live" not in rendered
    # At least one WARNING was emitted, so the sweep above is not vacuous.
    assert mock_logger.warning.call_args_list


async def test_mt5_terminal_account_mismatch_fails_closed(exchange_router):
    """RED-TEAM login bracket: if the shared terminal is on the WRONG account
    (account_info().login != the connected login — e.g. a concurrent validate
    re-logged it mid-probe), the verdict must FAIL CLOSED transient
    (NETWORK_ERROR_DETAIL), NEVER {valid:true}, and order_check must NOT even run
    (the PRE bracket refuses before the probe). release() still runs. Without the
    bracket, the capability verdict would be judged against the wrong account — a
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

    # 424 = CALLER'S EXCHANGE (STATUS_CONTRACT.md §5), remapped from 400 by
    # 140.3-06 at all seven VenueTransientHTTPException sites (C4 here). This arm
    # is an INFRA/concurrency fault the router's own comment calls "never the
    # user's key" — so a 400, which accuses the caller's request, was exactly the
    # mislabelling the `detail` assertion below already guards in the body.
    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    # PRE bracket fires right after the first account_info, before the probe.
    client.order_check.assert_not_called()
    client.release.assert_called_once()


# --------------------------------------------------------------------------- #
# Three distinguishable failure paths — bad creds / wrong server / transient
# --------------------------------------------------------------------------- #


async def test_mt5_bad_creds_maps_to_exact_auth_string(exchange_router):
    """Bad creds (login raises an Mt5ClientError classified 'auth') -> 400 with the
    byte-identical AUTH_FAILED string (KEY_AUTH_FAILED). release() runs."""
    router = exchange_router
    err = Mt5ClientError(134, "invalid account or password")
    client = _make_client(login_raises=err)
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 400
    assert ei.value.detail == AUTH_FAILED_DETAIL
    assert "authentication failed" in ei.value.detail.lower()
    client.release.assert_called_once()


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
    client.release.assert_called_once()


async def test_mt5_transient_maps_to_network_detail_not_credentials(exchange_router):
    """F4: an unrecognized (transient) login error must fail CLOSED with the SHARED
    NETWORK_ERROR_DETAIL — never {"valid": true}, never 'authentication failed'
    (a transient bridge blip is not the user's key). release() runs."""
    router = exchange_router
    err = Mt5ClientError(0, "timeout waiting for response")
    client = _make_client(login_raises=err)
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    # 424 = CALLER'S EXCHANGE (C5; see the account-mismatch case for the full
    # rationale). A transient bridge blip is neither the user's key nor a
    # malformed request.
    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    assert "authentication failed" not in ei.value.detail.lower()
    client.release.assert_called_once()


async def test_mt5_probe_timeout_maps_to_network_detail_and_releases(
    exchange_router, monkeypatch
):
    """T-135-12 (WEDGE-01): a hung RPyC probe is bounded by the PER-STAGE ceiling —
    a TimeoutError maps to the shared NETWORK_ERROR_DETAIL (transient), never a
    500, never valid. The client is constructed, so release() must still run.

    RE-CUT for 153.3-03 (D-03). This case used to fire the ceiling by counting
    `wait_for` calls and timing out call #2 — an ordinal that is only valid for one
    exact topology. Collapsing connect+probe under ONE end-to-end deadline made call
    #2 the connect stage, so the old form would have silently started testing the
    503 arm while still passing its 424 assertion... it would not, in fact, have
    passed — but a future stage insertion could shift the ordinal into an arm whose
    assertions happen to match, and that is a rot mode a test must not have. It now
    fires the ceiling the way the constants make possible: monkeypatch the STAGE
    constant to a hair and let a genuinely slow login run into it. No ordinal, so
    adding or reordering a stage cannot silently re-point this test.
    """
    router = exchange_router
    client = _make_client(account=_INVESTOR_ACCOUNT, order_check=_INVESTOR_ORDER_CHECK)
    # The probe hangs; the (mocked) construction does not, so the connect stage
    # passes under the same tiny ceiling and only the PROBE stage fires.
    client.login = MagicMock(side_effect=lambda *a, **k: time.sleep(0.3))
    _install_mt5_client(router, client)
    monkeypatch.setattr(router, "_MT5_VALIDATE_STAGE_TIMEOUT_S", 0.05)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    # 424 = CALLER'S EXCHANGE (C3; see the account-mismatch case for the full
    # rationale). A hung upstream bridge is not a malformed caller request.
    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    client.release.assert_called_once()
    client.close.assert_not_called()


async def test_mt5_end_to_end_deadline_still_releases_the_session(
    exchange_router, monkeypatch
):
    """⭐ THE WAVE-0 GAP — RESEARCH Pitfall 6.

    The failure this prevents: putting the `finally` release INSIDE the end-to-end
    `wait_for`. Then a deadline that fires mid-probe cancels the release along with
    the probe, and the RPyC session is abandoned UNRELEASED — the session leak the
    finally block exists to prevent, and a WEDGE-01-class regression that no other
    case in this file can see, because every other case reaches the finally through
    a normal raise/return rather than through a cancellation.

    Fires the deadline by monkeypatching the constant (NOT a `wait_for` ordinal), so
    the case survives a stage being added. The per-stage ceiling is left at its real
    value, so the DEADLINE is provably the bound that fired: a stage timeout would
    have produced the same 424 but would not have exercised the cancellation path.
    """
    router = exchange_router
    client = _make_client(account=_INVESTOR_ACCOUNT, order_check=_INVESTOR_ORDER_CHECK)
    client.login = MagicMock(side_effect=lambda *a, **k: time.sleep(0.3))
    _install_mt5_client(router, client)
    monkeypatch.setattr(router, "_MT5_VALIDATE_DEADLINE_S", 0.05)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    client.release.assert_called_once()
    client.close.assert_not_called()


async def test_mt5_validate_never_calls_close_on_the_success_path(exchange_router):
    """⭐ D-30, stated POSITIVELY: the validate path calls release() and calls
    close() on NO path.

    close() calls mt5.shutdown(), and mt5linux serves every rpyc connection from ONE
    ThreadedServer process over ONE shared MetaTrader5 instance holding ONE IPC pipe
    (153-EVIDENCE §A2 / C-1) — so a per-request close() tears that pipe down for
    every CONCURRENT caller, who then observe `-10004 No IPC connection`. This is
    the assertion an "also call close() for safety" regression reddens."""
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    _install_mt5_client(router, client)

    result = await _call(router, _make_req())

    assert result == {"valid": True, "read_only": True}
    client.release.assert_called_once()
    client.close.assert_not_called()


# --------------------------------------------------------------------------- #
# THE CHAIN (153.3 / D-02) — the nesting IS the property
#
# Each layer must fire strictly before the layer outside it, so a failure is
# diagnosed at the innermost layer that can name a cause. Every expected value is a
# HAND-TYPED literal or a strict inequality over the shipped constants — never a
# recomputation of the source's own formula, which could not fail.
# --------------------------------------------------------------------------- #


def test_mt5_validate_timeout_chain_is_strictly_nested(exchange_router):
    """LOGIN_MS < REQUEST_S < STAGE_S < DEADLINE_S, in milliseconds throughout.

    WHY each link matters (Rule 9):
      * IPC < rpyc — MT5 must fail its own pipe first, or rpyc censors the verdict
        with a bare abort that names no MT5 code (the D-24 defect, 9/9 production
        logins).
      * rpyc < stage — the rpyc client timeout must fire before the event-loop
        ceiling, or a hung terminal yields a bare asyncio.TimeoutError with no venue
        detail instead of a real MT5 error. This is what the `+ 5.0` diagnostic
        ordering margin buys (D-02); it is NOT a budget.
      * stage < deadline — a stage must fire before the end-to-end deadline, or the
        deadline pre-empts every diagnosable failure and every timeout becomes
        "the whole probe hung", attributable to nothing.
    Raise any inner ceiling above its parent and this reds.
    """
    router = exchange_router
    initialize_ms = router._MT5_VALIDATE_INITIALIZE_TIMEOUT_MS
    login_ms = router._MT5_VALIDATE_LOGIN_TIMEOUT_MS
    request_ms = MT5_VALIDATE_REQUEST_TIMEOUT_S * 1000
    stage_ms = router._MT5_VALIDATE_STAGE_TIMEOUT_S * 1000
    deadline_ms = router._MT5_VALIDATE_DEADLINE_S * 1000

    # The shipped numbers, hand-typed — the chain moving is a deliberate act.
    assert initialize_ms == 45_000
    assert login_ms == 45_000
    assert request_ms == 55_000
    assert stage_ms == 60_000
    assert deadline_ms == 75_000

    assert initialize_ms < request_ms, "MT5 initialize() IPC must fail before rpyc"
    assert login_ms < request_ms, "MT5 login() IPC must fail before rpyc"
    assert request_ms < stage_ms, (
        "the rpyc round-trip must fire before the event-loop stage ceiling, or a "
        "timeout carries no venue detail (D-02)"
    )
    assert stage_ms < deadline_ms, (
        "a STAGE must fire before the end-to-end deadline, or every timeout becomes "
        "un-attributable (D-03)"
    )


def test_mt5_validate_worst_case_stays_inside_the_client_budget(exchange_router):
    """D-26: the server's worst case must stay inside the CLIENT's ceiling, or the
    browser gives up first and the user sees a generic network failure instead of
    the honest verdict the server was about to produce.

    120_000 is HAND-TYPED, not imported: the TS-side budget is Phase 153.4's to own
    (`seam-budgets.invariant.test.ts`), and a Python test that imported it would
    move silently with it. Today: 75 + 10 = 85s. Plan 153.3-04 adds a bounded 20s
    lease wait for 105s, still 15s inside."""
    router = exchange_router
    worst_case_ms = (
        router._MT5_VALIDATE_DEADLINE_S + router._MT5_RELEASE_TIMEOUT_S
    ) * 1000
    assert worst_case_ms == 85_000
    assert worst_case_ms < 120_000
    # The lease wait plan 153.3-04 adds must still fit.
    assert worst_case_ms + 20_000 < 120_000


def test_worker_request_timeout_is_unmoved_by_the_validate_chain():
    """⛔ D-25: MT5_REQUEST_TIMEOUT_S is the SEQUENTIAL worker's contract and must
    stay at 30s. The validate path got its headroom per-instance precisely so this
    constant would not move; "harmonising" the two reopens the v1.11 WEDGE-01 wedge
    class (a hung terminal held past the ~90s healthz budget) for every job. The
    literal is hand-typed so the pin cannot move with the source."""
    assert MT5_REQUEST_TIMEOUT_S == 30.0
    assert MT5_VALIDATE_REQUEST_TIMEOUT_S == 55.0
    assert MT5_VALIDATE_REQUEST_TIMEOUT_S > MT5_REQUEST_TIMEOUT_S


async def test_mt5_validate_constructs_the_client_with_the_validate_chain(
    exchange_router,
):
    """D-25 wiring: the router must PASS the longer chain to Mt5Client, not merely
    define it. Asserted against the recorded construction kwargs (test-the-wiring),
    so a chain that is declared and then not plumbed through reds here."""
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    factory = _install_mt5_client(router, client)

    await _call(router, _make_req())

    factory.assert_called_once()
    kwargs = factory.call_args.kwargs
    assert kwargs["request_timeout_s"] == MT5_VALIDATE_REQUEST_TIMEOUT_S
    assert kwargs["initialize_timeout_ms"] == router._MT5_VALIDATE_INITIALIZE_TIMEOUT_MS
    assert kwargs["login_timeout_ms"] == router._MT5_VALIDATE_LOGIN_TIMEOUT_MS


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
# Server misconfig — a PERMANENT 500, never the user's key, logged secret-free
# --------------------------------------------------------------------------- #


async def test_mt5_missing_gateway_env_is_permanent_500_and_secret_free(
    exchange_router, monkeypatch
):
    """Missing MT5_GATEWAY_HOST/PORT is a SERVER misconfig, never AUTH_FAILED that
    blames the user, and the log line carries NO credential values.

    REWRITTEN 2026-07-26 (Phase 140.1 plan 03, S-02 / TRAP-9). This test used to
    pin `503 == NETWORK_ERROR_DETAIL`. The PYAPI-05 status contract
    (docs/STATUS_CONTRACT.md) reclassifies it: unset env is deterministic, so no
    retry can ever clear it, and answering 503 made the platform breaker trip,
    expire, re-probe and re-trip forever over a config gap (A-01 / A-08 / A-25).
    R-1 says a permanent fault is 500 with retryable:false so it never counts.

    The status/code below are LITERALS typed here, never imported from
    services.error_contract — an oracle that reads its expectation out of the
    thing under test cannot fail (programme non-negotiable #3). The
    no-credential-in-logs assertions are orthogonal to the status change and are
    preserved verbatim.
    """
    router = exchange_router
    monkeypatch.delenv("MT5_GATEWAY_HOST", raising=False)
    monkeypatch.delenv("MT5_GATEWAY_PORT", raising=False)

    factory = MagicMock(side_effect=AssertionError("no client when the gateway is unconfigured"))
    router.Mt5Client = factory

    mock_logger = MagicMock()
    monkeypatch.setattr(router, "logger", mock_logger)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req(api_key="123456", api_secret="s3cr3t-pw", passphrase="MyBroker-Live"))

    assert ei.value.status_code == 500
    assert ei.value.detail["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert ei.value.detail["dependency"] == "mt5-gateway"
    assert ei.value.detail["retryable"] is False
    # R-1: a permanent fault never advertises a wait.
    assert not (ei.value.headers or {}).get("Retry-After")
    # Survivor #12: an INEQUALITY against a DIFFERENT constant is not an oracle —
    # junk copy, an empty string and a stack trace all satisfy `!= AUTH_FAILED_DETAIL`,
    # so replacing the human sentence shipped green. The copy IS the contract on this
    # arm (140.3 renders it verbatim and it is the only thing telling the operator
    # that no retry can clear this), so it is pinned as a string LITERAL typed here
    # — never imported from routers.exchange, which would make the oracle read its
    # expectation out of the thing under test.
    assert ei.value.detail["detail"] == (
        "The MetaTrader gateway is not configured. This needs an operator, not a retry."
    )
    # Kept as a second guard: the copy must also never become the credential
    # accusation, whatever else it says.
    assert ei.value.detail["detail"] != AUTH_FAILED_DETAIL
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
