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
import threading
import time
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException
from structlog.testing import capture_logs

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
from services import mt5_concurrency
from tests.limiter_stub import evict_module, patch_shared_limiter


@pytest.fixture(autouse=True)
def _reset_mt5_terminal_locks():
    """153.3-04: the validate path now takes the process-wide terminal lease, so a
    Lock minted here must never leak into another test — including the concurrency
    and derive suites, which share this ONE registry when pytest runs all of them.

    Load-bearing beyond hygiene: an ``asyncio.Lock`` binds to the event loop on its
    first CONTENDED use, and pytest-asyncio gives each test a fresh loop — a lock
    carried over from a contended case would raise "bound to a different event
    loop" in the next one.

    Since WIZFORM-ABANDON / D-36 it also clears the per-terminal EPOCH registry,
    via the ONE shared helper (RESEARCH Pitfall 8: a leaked epoch fences a client
    another test builds for the same key — a sixth flake mechanism)."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


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
    *, login_raises=None, account=None, order_check=None, order_check_raises=None,
    terminal=None,
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
    if order_check_raises is not None:
        # The real client raises here when MT5 returns None and last_error() is
        # read (`_raise_last`) — which is what a terminal that refuses the probe
        # produces.
        client.order_check = MagicMock(side_effect=order_check_raises)
    else:
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


def _install_real_mt5_client(router, transport):
    """Patch the router's constructor to build the **REAL** ``Mt5Client`` over an
    injected transport double; return the factory spy.

    ⭐ The real class, deliberately. The two cases that use this helper are about
    behaviour that lives OUTSIDE the router — D-24's construction-time ordering
    guard, and ``terminal_info``'s materialize step running outside
    ``_guarded_read`` — so a ``MagicMock`` client would FABRICATE the very thing
    under test and the guard could not fail. ``_connect`` is the same injection
    seam ``test_mt5_client_contract.py`` uses, so no socket is opened.
    """
    from services.mt5_client import Mt5Client as _RealMt5Client

    def _build(*args, **kwargs):
        return _RealMt5Client(*args, _connect=lambda **_ignored: transport, **kwargs)

    factory = MagicMock(side_effect=_build)
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


async def test_a_conclusive_terminal_verdict_is_not_pre_empted_by_an_erroring_probe(
    exchange_router,
):
    """⭐ D-31's refusal must not be pre-empted by the probe it no longer needs, on
    the exact configuration D-31 was written for.

    Once the terminal has reported ``trade_allowed: false``, the verdict is already
    ``undetermined`` — branch 5 of ``classify_trade_capability`` looks at no probe
    result at all. Running ``order_check`` anyway was not free: under MetaQuotes'
    default-ON *"Disable automatic trading through the external Python API"* — the
    setting that MAKES ``trade_allowed`` false — the probe is refused, and its
    error takes an ENTIRELY DIFFERENT route out. ``classify_mt5_login_error``'s
    ``_WRONG_SERVER_TOKENS`` contain "terminal", so the refusal below classifies
    ``wrong_server`` and the user is told **their broker server is wrong** — a
    400 accusation against the user, for a checkbox in OUR gateway terminal, which
    silently replaces the 500 that would have paged the operator who can actually
    fix it.

    ⚠️ THE ERRORING PROBE IS THE POINT. A version of this test whose ``order_check``
    SUCCEEDS never reaches the bug: a successful probe returns a retcode the
    classifier already ignores under branch 5, so the verdict is unchanged and the
    guard cannot fail.

    ⛔ Narrowing only. Skipping the probe cannot widen what is classified
    ``read_only``: branch 5 reaches ``undetermined`` for EVERY probe value, and the
    single verdict the probe could still have changed — ``trade_capable`` via
    retcode 10009 — is itself a refusal, and is unobtainable anyway from a terminal
    that refuses Python probes. The POSITIVE master signal survives untouched: it
    comes from ``account_info().trade_allowed``, which is read BEFORE the terminal
    and is asserted by the master-reject tests above.
    """
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        # What a terminal with the Python-API option ON answers: None from
        # order_check, then last_error() -> a "Terminal:" message. Note the text
        # contains "terminal", which is a _WRONG_SERVER_TOKENS member.
        order_check_raises=Mt5ClientError(
            -8, "Terminal: AutoTrading disabled by the client terminal"
        ),
        # Connected, so this is not a bridge blip — the terminal itself refuses.
        terminal={"connected": True, "trade_allowed": False},
    )
    _install_mt5_client(router, client)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    # D-31's PERMANENT operator refusal wins. Literals hand-typed. Asserted
    # BEFORE the mechanism below, because the verdict is what the user and the
    # operator actually get; "the probe did not run" is only how.
    assert ei.value.status_code == 500
    assert ei.value.detail["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert ei.value.detail["retryable"] is False
    assert not (ei.value.headers or {}).get("Retry-After")
    # ⛔ Never the accusation against the user that the probe's error produced.
    assert ei.value.detail["detail"] != MT5_WRONG_SERVER_DETAIL
    assert ei.value.detail["detail"] != AUTH_FAILED_DETAIL
    assert "read_only" not in repr(ei.value.detail)
    # And the mechanism: the probe never ran, because the terminal signal was
    # already conclusive.
    client.order_check.assert_not_called()
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
    misconfig case runs).

    153.3 / D-32 — EXTENDED over the structlog stream (T-153.3-23). The stdlib
    `logger` sweep below cannot see the new `mt5.stage` events at all: they go to
    structlog, a second and entirely separate egress. A sweep that checked only
    the mock logger would have stayed green while every stage event carried the
    interpolated remote source line.
    """
    router = exchange_router
    client = _make_client(
        account={"trade_allowed": False, "login": 123456},
        order_check=_INVESTOR_ORDER_CHECK,
        terminal={"connected": True, "trade_allowed": False},
    )
    _install_mt5_client(router, client)
    mock_logger = MagicMock()
    monkeypatch.setattr(router, "logger", mock_logger)

    with capture_logs() as captured:
        with pytest.raises(HTTPException):
            await _call(
                router,
                _make_req(
                    api_key="123456", api_secret="s3cr3t-pw", passphrase="MyBroker-Live"
                ),
            )

    secrets = ("123456", "s3cr3t-pw", "MyBroker-Live")
    for meth in ("exception", "error", "warning", "info", "debug"):
        for call in getattr(mock_logger, meth).call_args_list:
            rendered = repr(call)
            for secret in secrets:
                assert secret not in rendered
    # At least one WARNING was emitted, so the sweep above is not vacuous.
    assert mock_logger.warning.call_args_list

    # The SECOND egress: every structured event emitted during this request.
    events = [e for e in captured if e.get("event") == "mt5.stage"]
    assert events, "the structlog half of the sweep is vacuous — no event captured"
    rendered_events = repr(events)
    for secret in secrets:
        assert secret not in rendered_events, (
            f"a credential reached the mt5.stage telemetry: {secret!r}"
        )


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


# --------------------------------------------------------------------------- #
# THE TERMINAL LEASE (153.3-04 / D-29) — this path used to be the ONE caller that
# skipped it.
#
# `job_worker.py` (x2) and `allocator_positions.py` all take
# `_mt5_terminal_lock_for`; `routers/exchange.py` took it ZERO times. Two wizard
# submissions therefore both called login(...) on the ONE shared Wine terminal and
# made each OTHER fail through the mismatch bracket, instead of queueing.
#
# ⚠️ The oracle is BLOCKING/ORDERING, never "a lease object was entered": a lease
# built on a second registry, or on a differently-formatted key, enters and exits
# perfectly happily while serializing nothing.
# --------------------------------------------------------------------------- #


def _expected_terminal_key(host: str, port: int) -> str:
    """The key Mt5Client itself would produce — computed by CALLING the shipped
    property, never by retyping its format here. The three job sites key on
    `Mt5Client.terminal_key`, so if the router formats the key differently the two
    resolve to DIFFERENT Lock objects and serialize nothing (MT5CONC-02 /
    151-RESEARCH Pitfall 2) while every lock still "works"."""
    from types import SimpleNamespace

    from services.mt5_client import Mt5Client

    return Mt5Client.terminal_key.fget(SimpleNamespace(_host=host, _port=port))


async def test_two_concurrent_validates_are_serialized_on_the_terminal(
    exchange_router,
):
    """⭐ THE POINT OF PLAN 153.3-04 (D-29, T-153.3-17).

    The failure this prevents: two wizard submissions interleaving `login()` on the
    ONE shared Wine terminal. MT5 binds one account per terminal AT A TIME, so the
    second login re-points the terminal under the first caller — today they make
    each OTHER fail via the mismatch bracket rather than queueing
    (153-EVIDENCE §4). Under the lease the second caller WAITS.

    Asserted as ORDERING, not as "both succeeded": both succeed under the defect too
    whenever the interleave happens to miss. `login` sleeps inside the worker thread
    precisely so an unserialized second caller WOULD overlap it.
    """
    router = exchange_router
    events: list[str] = []

    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )

    def _slow_login(*_a, **_k):
        events.append("login-start")
        time.sleep(0.1)
        events.append("login-end")

    client.login = MagicMock(side_effect=_slow_login)
    client.release = MagicMock(side_effect=lambda: events.append("release"))
    _install_mt5_client(router, client)

    results = await asyncio.gather(
        _call(router, _make_req()), _call(router, _make_req())
    )

    assert results == [{"valid": True, "read_only": True}] * 2
    assert events == ["login-start", "login-end", "release"] * 2, (
        "the second validate's login started before the first released the "
        "terminal — the lease is not being taken (or is keyed differently from "
        f"Mt5Client.terminal_key). Observed: {events}"
    )


async def test_mt5_terminal_busy_refuses_transiently_and_never_constructs_a_client(
    exchange_router, monkeypatch
):
    """⭐ THE BOUNDED ACQUISITION (D-29). An interactive validate must be able to
    give up waiting for the terminal WITHOUT waiting for the terminal — its own
    operation deadline never starts until it HOLDS the terminal, so an unbounded
    queue wait would blow the client budget (D-26) with no verdict at all.

    Three things asserted, each with its own failure mode:
      * 424 + NETWORK_ERROR_DETAIL — the EXISTING transient arm, honestly
        recoverable ("try again" is real advice: the terminal frees up). NEVER
        valid:true (fail CLOSED) and NEVER the auth arm — a busy terminal is OUR
        infrastructure, not the user's key.
      * `Mt5Client` was never CONSTRUCTED — waiting for the terminal must not also
        burn a socket, and construction is the very thing that races.
      * the body leaks no infrastructure (WIZFORM-03 / T-153.3-20): no terminal
        key, host or port.
    """
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    factory = _install_mt5_client(router, client)

    # Somebody else holds the terminal for longer than the interactive bound.
    held = mt5_concurrency._mt5_terminal_lock_for(
        _expected_terminal_key("mt5-gw.internal", 18812)
    )
    await held.acquire()
    monkeypatch.setattr(router, "_MT5_LEASE_WAIT_S", 0.05)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    assert ei.value.status_code != 500
    assert ei.value.detail != AUTH_FAILED_DETAIL
    assert "authentication failed" not in ei.value.detail.lower()

    factory.assert_not_called()
    client.release.assert_not_called()
    client.close.assert_not_called()

    body = ei.value.detail.lower()
    for leak in ("mt5-gw.internal", "18812", "terminal", "lease", "queue", "lock"):
        assert leak not in body, f"the busy refusal leaked infrastructure: {leak!r}"

    # The real holder still holds it — a refused waiter released nothing.
    assert held.locked()
    held.release()


async def test_the_lease_wait_does_not_consume_the_operation_deadline(
    exchange_router, monkeypatch
):
    """⭐ PLACEMENT — the acquisition wait must sit OUTSIDE the end-to-end deadline.

    The failure this prevents: wrapping the lease acquisition INSIDE
    `_MT5_VALIDATE_DEADLINE_S`. Then the two budgets silently share one number and a
    caller that queued behind another submission gets a TRUNCATED probe — or, as
    here, no probe at all: it would answer 424 "hung terminal" having never touched
    the terminal, while the honest verdict was 0.2s away.

    The terminal is held for 0.5s; the OPERATION deadline is 0.3s. Correct placement
    ⇒ the deadline starts when we HOLD the terminal and the (mocked, instant) probe
    finishes well inside it. Inverted placement ⇒ the deadline fires while still
    queueing and this reds with the transient 424."""
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    _install_mt5_client(router, client)

    held = mt5_concurrency._mt5_terminal_lock_for(
        _expected_terminal_key("mt5-gw.internal", 18812)
    )
    await held.acquire()

    async def _release_later():
        await asyncio.sleep(0.5)
        held.release()

    releaser = asyncio.create_task(_release_later())
    # Far LONGER than the operation deadline, so the two cannot be confused.
    monkeypatch.setattr(router, "_MT5_LEASE_WAIT_S", 5.0)
    monkeypatch.setattr(router, "_MT5_VALIDATE_DEADLINE_S", 0.3)

    result = await _call(router, _make_req())

    await releaser
    assert result == {"valid": True, "read_only": True}, (
        "the queue wait was charged to the operation deadline — a caller that "
        "waited its turn is given a truncated probe (or none at all)"
    )
    client.release.assert_called_once()


async def test_validate_leases_the_key_mt5client_itself_would_produce(exchange_router):
    """⭐ The key-format assertion. The router must hold the lease BEFORE
    constructing the client (construction opens the racing rpyc socket), so it
    cannot ask `Mt5Client.terminal_key` for the key — it re-derives it from the same
    host/port. A divergent format ("mt5-gw.internal-18812", or a lowercased host)
    yields a DIFFERENT Lock object from the one the three job sites take, and the
    wizard would serialize only against ITSELF while still racing every worker job.

    Also asserts the lock is genuinely HELD during the probe — a lease that acquired
    a Lock nobody else uses would satisfy the key assertion alone."""
    router = exchange_router
    expected_key = _expected_terminal_key("mt5-gw.internal", 18812)
    observed: list[bool] = []

    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    # Runs INSIDE the probe thread, i.e. while the lease is held.
    client.login = MagicMock(
        side_effect=lambda *a, **k: observed.append(
            mt5_concurrency._MT5_TERMINAL_LOCKS.get(expected_key) is not None
            and mt5_concurrency._MT5_TERMINAL_LOCKS[expected_key].locked()
        )
    )
    _install_mt5_client(router, client)

    assert await _call(router, _make_req()) == {"valid": True, "read_only": True}

    assert list(mt5_concurrency._MT5_TERMINAL_LOCKS) == [expected_key], (
        "the router leased a key the job sites do not use — two Lock objects for "
        "the ONE terminal, and zero serialization against the worker"
    )
    assert observed == [True], (
        "the terminal lock was not held while the probe ran — the lease is not "
        "wrapping the probe"
    )
    # Released on the way out: a stranded lock wedges every future caller.
    assert not mt5_concurrency._MT5_TERMINAL_LOCKS[expected_key].locked()


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
    move silently with it.

    EXTENDED by plan 153.3-04: the lease wait is now part of the TRUE end-to-end
    worst case and is included here. D-04's shape — the lock-queue wait sits INSIDE
    the client's budget, because the browser is waiting through it exactly as it
    waits through the probe. 20 (lease) + 75 (deadline) + 10 (release) = 105s, 15s
    inside the ceiling. Spending that headroom twice is what this test refuses."""
    router = exchange_router
    worst_case_ms = (
        router._MT5_LEASE_WAIT_S
        + router._MT5_VALIDATE_DEADLINE_S
        + router._MT5_RELEASE_TIMEOUT_S
    ) * 1000
    assert worst_case_ms == 105_000
    assert worst_case_ms < 120_000
    # The lease wait is a REAL term, not a rounding allowance: it must be the
    # interactive bound, and it must not have quietly become unbounded/zero.
    assert router._MT5_LEASE_WAIT_S == 20.0
    assert mt5_concurrency._MT5_LEASE_WAIT_S == router._MT5_LEASE_WAIT_S


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
# D-31's fail-closed guard — the MATERIALIZATION hole
# --------------------------------------------------------------------------- #


class _Netref:
    """A namedtuple-shaped stand-in for the rpyc netref MT5 returns.

    ``Mt5Client._materialize`` accepts anything exposing ``_asdict()``; this is the
    healthy shape, used for the reads that are NOT under test here."""

    def __init__(self, **fields):
        self._fields = fields

    def _asdict(self):
        return dict(self._fields)


class _NetrefDeadOnAttributeFetch:
    """A netref whose ATTRIBUTE FETCH is itself a remote round-trip, and the
    connection is already gone when ``_materialize`` reaches for ``_asdict``."""

    def __getattr__(self, name):
        raise EOFError("stream has been closed")


class _NetrefDeadOnAsdictCall:
    """A netref that answers the ``_asdict`` fetch and then dies on the CALL — the
    other half of the same materialization window."""

    def _asdict(self):
        raise EOFError("stream has been closed")


@pytest.mark.parametrize(
    "dead_netref",
    [_NetrefDeadOnAttributeFetch, _NetrefDeadOnAsdictCall],
    ids=["dies-on-attribute-fetch", "dies-on-asdict-call"],
)
async def test_terminal_transport_failure_at_materialization_still_refuses(
    exchange_router, dead_netref
):
    """⭐ D-31 must fail CLOSED through the MATERIALIZATION window too.

    ``_read_terminal`` narrowed its fail-closed catch to ``Mt5ClientError``, but
    ``Mt5Client.terminal_info`` materializes the rpyc netref OUTSIDE
    ``_guarded_read`` — that is the ONE step of the read whose failure is not
    converted to a typed error. So a transport failure in that window escaped the
    refusal entirely, on a guard whose entire purpose is that an unreadable
    terminal yields NO signal.

    ⚠️ THE WINDOW IS THE POINT. ``terminal_info()`` is CALLED successfully here and
    RETURNS a netref — ``_guarded_read`` has already handed control back — and only
    the subsequent materialization dies. A test that made the CALL raise never
    reaches this bug at all: that path is already an ``Mt5ClientError`` and is
    already caught (see the unreadable-terminal case above). The doubles below
    cannot raise at call time by construction; their bodies only return.

    The correct outcome is the one D-31 exists to produce: no terminal signal ->
    "undetermined" -> refusal. Never a read_only success built on two account
    negatives we cannot attribute, and never an accusation against the user's
    broker server — ``classify_mt5_login_error``'s ``_WRONG_SERVER_TOKENS`` carry
    "terminal", "ipc" and "connect", so OUR gateway's transport fault must never be
    allowed to reach it.
    """
    router = exchange_router
    calls = []
    transport = MagicMock(name="mt5-transport")
    transport.account_info = MagicMock(return_value=_Netref(**_INVESTOR_ACCOUNT))
    transport.order_check = MagicMock(return_value=_Netref(**_INVESTOR_ORDER_CHECK))

    def _terminal_info():
        # Records entry, then RETURNS a netref. There is no raise on this path —
        # the round-trip succeeded and the guarded region is already over.
        calls.append("returned-a-netref")
        return dead_netref()

    transport.terminal_info = _terminal_info
    _install_real_mt5_client(router, transport)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    # The call itself succeeded — the failure was strictly at materialization.
    assert calls == ["returned-a-netref"]
    # Refusal, fail-CLOSED and transient (our bridge blipped; it clears on retry).
    assert ei.value.status_code == 424
    assert ei.value.detail == NETWORK_ERROR_DETAIL
    # ⛔ Never the two mistranslations. A wrong-server verdict here blames the user
    # for a fault in our gateway; an auth verdict blames their credentials.
    assert ei.value.detail != MT5_WRONG_SERVER_DETAIL
    assert ei.value.detail != AUTH_FAILED_DETAIL
    # ⛔ And never a permissive verdict: an unreadable terminal yields NO signal.
    assert "read_only" not in repr(ei.value.detail)


# --------------------------------------------------------------------------- #
# D-24's ordering guard — a PERMANENT operator fault, never a gateway outage
# --------------------------------------------------------------------------- #


async def test_inverted_ipc_timeout_chain_is_a_permanent_operator_fault(
    exchange_router, monkeypatch
):
    """⭐ D-24's ordering guard fires CORRECTLY and was MISTRANSLATED on the way out.

    The scenario is a real operator action, not a synthetic one: set
    ``MT5_VALIDATE_REQUEST_TIMEOUT_S=40`` and leave
    ``MT5_VALIDATE_INITIALIZE_TIMEOUT_MS`` at its 45 000 default. The ceiling
    ordering inverts and ``Mt5Client.__init__`` refuses to construct — and because
    it refuses INSIDE the connect ``to_thread``, the broad "connect failure is
    server/bridge, not the key" arm answered **503 MT5_GATEWAY_UNREACHABLE,
    retryable, with a Retry-After**.

    WHY THAT IS THE BUG (Rule 9 — the economics, not the implementation's own
    formula): the misconfiguration is PERMANENT. Every MT5 validate then says "the
    gateway is not responding, try again shortly" — advice nobody can act on for a
    fault only an operator can clear — and every one of those 503s keys the
    ``mt5-gateway`` breaker, which trips, expires, re-probes and re-trips forever
    (A-08/A-25/C-17). A 500 is SERVICE-PERMANENT and therefore breaker-INERT:
    ``src/lib/seam-discriminator.ts`` classifies it ``counts:false`` /
    ``breakerKey:null``, where a 503 yields ``counts:true`` and a key. That is why
    the assertions below are on the RESPONSE SHAPE and not merely on "an error was
    raised" — the status IS the breaker decision.

    The REAL ``Mt5Client`` runs here, so this also pins the router's discriminator
    to the guard's ACTUAL message: reword the guard and this test reds, rather than
    the router silently falling back to the 503.
    """
    router = exchange_router
    transport = MagicMock(name="mt5-transport")
    factory = _install_real_mt5_client(router, transport)
    # 40.0s -> 40 000ms, BELOW the 45 000ms initialize ceiling: inverted.
    monkeypatch.setattr(router, "MT5_VALIDATE_REQUEST_TIMEOUT_S", 40.0)

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    # Every literal hand-typed (programme non-negotiable #3).
    assert ei.value.status_code == 500
    assert ei.value.status_code != 503, (
        "a 503 keys the mt5-gateway breaker on a fault no retry can ever clear — "
        "the self-sustaining trip/expire/re-probe loop A-08/A-25 records"
    )
    body = ei.value.detail
    assert body["code"] == "MT5_GATEWAY_UNCONFIGURED"
    assert body["dependency"] == "mt5-gateway"
    assert body["retryable"] is False
    # R-1: a permanent fault never advertises a wait.
    assert not (ei.value.headers or {}).get("Retry-After")
    # And never the transient copy, which asks the user to do the one thing that
    # cannot possibly work.
    assert (
        body["detail"]
        != "The MetaTrader gateway is not responding. Try again shortly."
    )
    assert "read_only" not in repr(body)
    # The guard refused BEFORE any transport was opened — construction is where the
    # effective values meet, and nothing reached the wire.
    factory.assert_called_once()
    transport.initialize.assert_not_called()
    transport.login.assert_not_called()


async def test_an_unrelated_construction_valueerror_stays_transient(exchange_router):
    """⛔ The permanent arm may only NARROW what reaches the 503 — never widen what
    reaches the 500.

    A construction ``ValueError`` that is NOT D-24's ordering guard is, from this
    router's vantage point, indistinguishable from a transport fault, so it keeps
    its existing transient classification. This is the negative obligation on the
    fix: a router that reclassified EVERY ValueError would answer "this needs an
    operator, not a retry" for faults that clear on their own, and — because a 500
    is breaker-inert — a genuinely failing dependency would stop being counted at
    all. Catching the class instead of the specific failure reds here.
    """
    router = exchange_router
    router.Mt5Client = MagicMock(side_effect=ValueError("something else entirely"))

    with pytest.raises(HTTPException) as ei:
        await _call(router, _make_req())

    assert ei.value.status_code == 503
    assert ei.value.detail["code"] == "MT5_GATEWAY_UNREACHABLE"
    assert ei.value.detail["dependency"] == "mt5-gateway"
    assert ei.value.detail["retryable"] is True
    assert (ei.value.headers or {}).get("Retry-After") == "30"


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


# --------------------------------------------------------------------------- #
# 153.3 / D-32 — THE QUEUE WAIT AND THE VERDICT, MEASURED SEPARATELY
#
# WHY (Rule 9). Two things this path could never answer before:
#   1. "how long did the terminal read take" vs "how long did we QUEUE for the
#      terminal". EVIDENCE §4: a budget derived from a single-user total is wrong
#      for user #2 BY CONSTRUCTION, because user #2's total contains user #1's
#      read. Only a split measurement separates them after the fact.
#   2. "how long does a validate take, by VERDICT". An instrument that fires only
#      on success measures a population that excludes exactly the failures the
#      45 000/55/60/75/20/10 chain was guessed against (D-27) — and every one of
#      the nine production observations we have is a failure.
#
# The event name and the outcome vocabulary are HAND-TYPED here: they are the
# aggregation keys Phase 155 groups by, so an oracle that imported them from
# `routers/exchange.py` could not fail a rename or a re-categorisation.
# --------------------------------------------------------------------------- #

_STAGE_EVENT_NAME = "mt5.stage"


def _mt5_events(captured, stage):
    """The captured `mt5.stage` events for one stage."""
    return [
        e
        for e in captured
        if e.get("event") == _STAGE_EVENT_NAME and e.get("stage") == stage
    ]


async def test_the_happy_path_emits_a_lease_wait_and_a_read_only_outcome(
    exchange_router,
):
    """The success path emits BOTH events: the (uncontended) queue wait and one
    terminal outcome carrying `outcome="read_only"`.

    `duration_ms` is asserted to be an int, not merely present — a field that is
    always `None`, or a float of seconds mislabelled as milliseconds, satisfies
    "the event has a duration" and is worthless to the phase that consumes it.
    """
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    _install_mt5_client(router, client)

    with capture_logs() as captured:
        assert await _call(router, _make_req()) == {"valid": True, "read_only": True}

    lease = _mt5_events(captured, "lease_wait")
    assert len(lease) == 1, f"no lease_wait event was emitted: {captured}"
    assert lease[0]["ok"] is True
    assert isinstance(lease[0]["duration_ms"], int)
    assert lease[0]["terminal_key"] == _expected_terminal_key("mt5-gw.internal", 18812)

    validate = _mt5_events(captured, "validate")
    assert len(validate) == 1, "a validate must terminate in EXACTLY one outcome event"
    assert validate[0]["outcome"] == "read_only"
    assert validate[0]["ok"] is True
    assert isinstance(validate[0]["duration_ms"], int)


async def test_a_busy_terminal_emits_a_measured_lease_wait_and_a_lease_busy_outcome(
    exchange_router, monkeypatch
):
    """⭐ The refusal path. A validate given up at the acquisition bound is the
    LONGEST queue wait there is, and it is the single observation a decision to
    move `_MT5_LEASE_WAIT_S` turns on.

    The bound is 0.2s and the wait is asserted `>= 100`ms, so the event carries a
    REAL measurement of the queue wait. An instrument that emitted `0` here — or
    that emitted nothing, because the emission sat inside the lease body the
    refusal never enters — would report that nobody ever waits.
    """
    router = exchange_router
    client = _make_client(
        account=_INVESTOR_ACCOUNT,
        order_check=_INVESTOR_ORDER_CHECK,
        terminal=_HEALTHY_TERMINAL_INFO,
    )
    _install_mt5_client(router, client)

    held = mt5_concurrency._mt5_terminal_lock_for(
        _expected_terminal_key("mt5-gw.internal", 18812)
    )
    await held.acquire()
    monkeypatch.setattr(router, "_MT5_LEASE_WAIT_S", 0.2)

    with capture_logs() as captured:
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())

    assert ei.value.status_code == 424
    held.release()

    lease = _mt5_events(captured, "lease_wait")
    assert len(lease) == 1, f"the REFUSED wait emitted no lease_wait event: {captured}"
    assert lease[0]["ok"] is False
    assert lease[0]["duration_ms"] >= 100, (
        "the refused queue wait was not measured — reported "
        f"{lease[0]['duration_ms']}ms for a wait that ran to a 200ms bound"
    )

    validate = _mt5_events(captured, "validate")
    assert len(validate) == 1
    assert validate[0]["outcome"] == "lease_busy"
    assert validate[0]["ok"] is False


async def test_the_end_to_end_deadline_still_emits_its_terminal_outcome_event(
    exchange_router, monkeypatch
):
    """⭐ The category that MUST NOT be missing. A deadline expiry is the failure
    mode the whole 153.3 sub-phase exists to explain, and it is reached through a
    CANCELLATION rather than through a normal raise — the one path an emission
    bolted onto the return statement would silently skip.

    An instrumentation that only fires on the paths that return normally
    measures a population that excludes exactly the failures we are trying to
    explain, which is the same defect as the pre-153.3 censored logs.
    """
    router = exchange_router
    client = _make_client(account=_INVESTOR_ACCOUNT, order_check=_INVESTOR_ORDER_CHECK)
    client.login = MagicMock(side_effect=lambda *a, **k: time.sleep(0.3))
    _install_mt5_client(router, client)
    monkeypatch.setattr(router, "_MT5_VALIDATE_DEADLINE_S", 0.05)

    with capture_logs() as captured:
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())

    assert ei.value.status_code == 424
    validate = _mt5_events(captured, "validate")
    assert len(validate) == 1, (
        "the end-to-end deadline path emitted no terminal outcome event — the "
        f"telemetry is blind to the failure it exists to explain: {captured}"
    )
    assert validate[0]["outcome"] == "deadline_exceeded"
    assert validate[0]["ok"] is False
    # The queue wait was uncontended and still measured: the two are independent.
    assert len(_mt5_events(captured, "lease_wait")) == 1


@pytest.mark.parametrize(
    ("kwargs", "expected_outcome"),
    [
        ({"api_key": ""}, "auth"),
        ({"passphrase": ""}, "wrong_server"),
    ],
)
async def test_pre_probe_refusals_carry_their_own_outcome_category(
    exchange_router, kwargs, expected_outcome
):
    """The two offline credential-shape refusals still terminate in an outcome
    event, and in DISTINCT categories.

    These never touch the terminal, so they can never appear in a measurement
    hung off the release block — yet they are the fastest verdicts the endpoint
    produces, and lumping them in with the terminal reads would drag the p50 of
    every other category down.
    """
    router = exchange_router
    _install_mt5_client(router, _make_client())

    with capture_logs() as captured:
        with pytest.raises(HTTPException):
            await _call(router, _make_req(**kwargs))

    validate = _mt5_events(captured, "validate")
    assert len(validate) == 1
    assert validate[0]["outcome"] == expected_outcome
    assert validate[0]["ok"] is False
    # No terminal was involved, so no lease was taken and none is reported.
    assert _mt5_events(captured, "lease_wait") == []


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON — FINDING #6a: the ROUTER connect-stage leak, end to end
#
# WHY this matters (Rule 9). `client: Mt5Client | None = None` is assigned from
# INSIDE `_connect_and_probe`, and the Pitfall-6 release block below it is guarded
# by `if client is not None:`. On a connect-stage timeout that assignment never
# happens, so the `finally` releases NOTHING — while the abandoned `to_thread`
# keeps going and constructs an rpyc session against the gateway's ONE
# `ThreadedServer` that no code path will ever close. Not a slow bleed: one
# orphaned socket per timed-out validate, on exactly the path that runs when the
# gateway is already unhealthy.
# --------------------------------------------------------------------------- #


async def test_a_connect_stage_timeout_leaves_no_rpyc_socket_open(
    exchange_router, monkeypatch
):
    """⭐ FINDING #6a at the PATH level — the sink's construction fence, observed
    through the route that actually produces the zombie.

    ⚠️ THE ORACLE IS THE OPEN/CLOSE BALANCE, not "the post-connect arm fired".
    Which arm the zombie takes depends on where its thread was when the lease's
    bump landed: if it enters `__init__` AFTER the release, the PRE-connect check
    refuses and no socket is ever opened, and an arm-specific close-count assertion
    would red on a run where the leak property genuinely HELD. Balance is the
    property; the arm is an implementation detail of the race.

    ⚠️ CI-HANG DISCIPLINE. pytest-asyncio's loop teardown joins the default
    executor for `THREAD_JOIN_TIMEOUT = 300`s, so an unbounded park here would
    stall the suite for five minutes instead of redding. Every wait is bounded, the
    gate is set in a `finally`, and the zombie is joined on a signal IT sets —
    never a sleep.
    """
    router = exchange_router
    gate = threading.Event()
    finished = threading.Event()
    conns: list = []
    outcomes: list[BaseException] = []

    class _CountedConn:
        def __init__(self) -> None:
            self.close_calls = 0
            self._config: dict = {}

        def close(self):
            self.close_calls += 1

    class _CountedTransport:
        """Only the transport-close seam mt5linux 0.1.9 exposes — this case never
        gets as far as a session call."""

        def __init__(self) -> None:
            # Single leading underscore ⇒ NOT re-mangled here; byte-identical to
            # the attribute mt5linux 0.1.9 sets.
            self._MetaTrader5__conn = _CountedConn()

    def _blocking_connect(**_ignored):
        # The gateway connect that outlives its bound. BOUNDED (0.25s), so a gate
        # the test somehow fails to set reds this case rather than hanging CI.
        gate.wait(0.25)
        transport = _CountedTransport()
        conns.append(transport)
        return transport

    from services.mt5_client import Mt5Client as _RealMt5Client
    from services.mt5_client import Mt5SessionAbandoned

    def _build(*args, **kwargs):
        # The REAL class, deliberately: the behaviour under test is the sink's
        # construction fence, and a MagicMock client would FABRICATE it.
        try:
            return _RealMt5Client(*args, _connect=_blocking_connect, **kwargs)
        except BaseException as exc:  # noqa: BLE001 — recorded, then re-raised
            outcomes.append(exc)
            raise
        finally:
            finished.set()

    router.Mt5Client = MagicMock(side_effect=_build)
    # §Q6 patch-target table: this constant is READ by `routers.exchange`, so it is
    # patched on the module object the fixture yields. Patching it anywhere else is
    # a SILENT no-op (the E2 trap) and the real ceiling would stay in force.
    monkeypatch.setattr(router, "_MT5_VALIDATE_STAGE_TIMEOUT_S", 0.05)

    try:
        with pytest.raises(HTTPException) as ei:
            await _call(router, _make_req())
        # The route's own existing connect-timeout envelope, unchanged by the fence.
        assert ei.value.status_code == 503
        assert ei.value.detail["code"] == "MT5_GATEWAY_UNREACHABLE"
    finally:
        gate.set()  # ⛔ never leave the zombie parked

    assert finished.wait(5.0), "the abandoned construction never finished"

    open_conns = [c for c in conns if c._MetaTrader5__conn.close_calls == 0]
    assert open_conns == [], (
        "the abandoned connect-stage thread left an rpyc session open against the "
        "gateway's ThreadedServer — this route's Pitfall-6 finally sees "
        "`client is None` and releases nothing, so nothing ever will (finding #6a)"
    )
    # Non-vacuity: the zombie really ran and really was refused, so the balance
    # above is a fence result rather than a thread that never happened.
    assert outcomes and isinstance(outcomes[0], Mt5SessionAbandoned), (
        f"the zombie construction was not fenced at all: {outcomes}"
    )
