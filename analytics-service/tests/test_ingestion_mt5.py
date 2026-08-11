"""Phase 135 (MT5SRC-01, 135-01) — Mt5Adapter unit + registration pins.

The mt5 ingestion adapter mirrors ``SfoxAdapter``/``DeribitAdapter`` (the
broker-dailies analogs): its ``compute_metrics`` FAILS LOUD so MT5 returns can
only ever flow through the deal-ledger daily-NAV reconstruction (Phase 136,
``combine_mt5_deal_ledger``) → the broker-dailies ONE backbone, never a
fill-based ``process_key`` metrics snapshot (the BYB-02 silently-empty/wrong-
track-record corruption class). ``fetch_raw`` is likewise fail-loud (no
synchronous consumer — the raise is the tripwire against invented mapping).

MT5 adds a behavioral probe sFOX lacks: the investor-vs-master rejection. These
tests drive ``Mt5Adapter.validate`` against the Phase-134 ``Mt5Client``'s injected
``_connect`` transport double (the same offline contract fixture pattern —
no ``mt5linux`` install, no network, no live terminal).

Regression gates — WHY each case matters (Rule 9):
  - compute_metrics fail-loud: a fill-based mt5 snapshot is the BYB-02 corruption
    class; the message names the Phase-136 deal-ledger path so a future refactor
    that "helpfully" delegates to EquityCurveBuilder reddens.
  - validate master-reject (T-135-01, EoP): a trade-capable (master) login must
    be REJECTED so it is NEVER encrypted/persisted as read-only.
  - validate auth honesty (T-135-03, fail-closed): only a clear auth signal
    blames the credentials (→ AUTH_FAILED, byte-identical to the ccxt arm so the
    TS classifier maps KEY_AUTH_FAILED with zero edits). A wrong-server signal is
    distinguishable; an unrecognized transient PROPAGATES (never auth-failed, never
    valid).
  - close() on EVERY path: the terminal session must never leak — asserted on
    success, master-reject, auth-fail, and propagating-transient paths.
  - registration lockstep: get_adapter("mt5") resolves + caches; the Source
    Literal and SUPPORTED_SOURCES admit mt5 TOGETHER with the factory.
"""
from __future__ import annotations

import asyncio
import threading
import time
import typing
from types import SimpleNamespace

import pytest

from services import mt5_concurrency
from services.closed_sets import (
    MT5_MASTER_PASSWORD_DETAIL,
    MT5_WRONG_SERVER_DETAIL,
    mt5_enabled_server,
)
from services.exchange import AUTH_FAILED_DETAIL
from services.ingestion import IngestionAdapter
from services.ingestion.adapter import KeySubmissionRequest, MetricsSnapshot
from services.ingestion.mt5 import Mt5Adapter
from services.mt5_client import Mt5Client, Mt5ClientError
from services.mt5_validation import classify_mt5_login_error


@pytest.fixture(autouse=True)
def _reset_mt5_terminal_locks():
    """MT5CONC-02: clear the ONE process-wide per-terminal ``asyncio.Lock``
    registry around every test in this module, exactly as
    ``tests/test_mt5_concurrency.py`` does.

    Load-bearing since ``Mt5Adapter.validate`` started taking the lease: these
    tests each run their own ``asyncio.run`` loop, and a Lock left in the registry
    by one of them would be re-entered from a DIFFERENT loop by the next — plus a
    Lock a failing test left HELD would hang every subsequent validate here.

    Since WIZFORM-ABANDON / D-36 it also clears the per-terminal EPOCH registry,
    via the ONE shared helper (RESEARCH Pitfall 8: a leaked epoch fences a client
    another test builds for the same key — a sixth flake mechanism)."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


# --------------------------------------------------------------------------- #
# Offline Mt5Client transport double (the Phase-134 contract fixture pattern)
# --------------------------------------------------------------------------- #


class _FakeNamedTuple:
    """Emulates a netref namedtuple: exposes _asdict() only (like an RPyC proxy).
    The client must materialize via ``._asdict()`` — the double only offers that
    seam, never a plain dict."""

    def __init__(self, **fields) -> None:
        self._fields_dict = dict(fields)

    def _asdict(self) -> dict:
        return dict(self._fields_dict)


class _FakeRpycConn:
    """The rpyc connection object `mt5linux.MetaTrader5` hangs off its name-mangled
    `_MetaTrader5__conn` attribute — the ONLY transport-close seam 0.1.9 exposes,
    and since 153.3-06 / **D-35** the ONLY thing `Mt5Client.close()` touches.

    Present so the adapter's `finally: close()` genuinely EXERCISES the transport
    teardown offline, instead of falling through to the "no transport close
    reachable" WARNING branch and leaving the six session-never-leaks assertions
    below asserting against a path production never takes.
    """

    def __init__(self) -> None:
        self.close_calls = 0

    def close(self):
        self.close_calls += 1


class _FakeMt5:
    """In-memory RPyC/MT5-shaped double driven by a scenario dict.

    Scenario keys (all optional): login (default True), account, terminal,
    order_check, last_error (default (0, "unknown")), login_raises (login RAISES
    this), terminal_info_raises (terminal_info RAISES this).
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self.shutdown_calls = 0
        # Single leading underscore ⇒ NOT re-mangled by this class; the attribute
        # name is byte-identical to the one mt5linux 0.1.9 sets.
        self._MetaTrader5__conn = _FakeRpycConn()

    @property
    def close_calls(self) -> int:
        """The observable the six 'the session never leaks' assertions now use.

        ⚠️ RE-POINTED by 153.3-06 / **D-35**, never deleted. Each of those
        assertions encodes *"the session never leaks on this path"* — an intent
        that survives intact. Only its MECHANISM changed: the adapter's
        `finally: client.close()` used to end the SHARED terminal IPC (which was
        the bug — one caller's teardown was every caller's `-10004`) and now
        releases only OUR rpyc socket. `shutdown_calls` is asserted alongside and
        must be 0 on every one of these paths."""
        return self._MetaTrader5__conn.close_calls

    def initialize(self, **kwargs):
        # **kwargs: initialize() carries its own `timeout=` ms ceiling (153.3 / D-24).
        # Real login() attaches the terminal IPC via initialize() before login().
        exc = self._scenario.get("initialize_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("initialize", True)

    def login(self, login, **kwargs):
        exc = self._scenario.get("login_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("login", True)

    def account_info(self):
        return self._scenario.get("account")

    def terminal_info(self):
        # D-31: the terminal's OWN state — the signal every read_only verdict is
        # now gated on. A scenario that omits "terminal" returns None, which the
        # client treats as an ERROR (never as data), so an unset key exercises
        # the unreadable-terminal refusal rather than silently passing.
        exc = self._scenario.get("terminal_info_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("terminal")

    def order_check(self, **request):  # client passes KEYWORDS (mt5linux eval form)
        return self._scenario.get("order_check")

    def last_error(self):
        return self._scenario.get("last_error", (0, "unknown"))

    def shutdown(self):
        self.shutdown_calls += 1


def _install_client(monkeypatch, scenario: dict) -> _FakeMt5:
    """Patch the adapter's _build_client to return a real Mt5Client wrapping the
    in-memory double, and set the gateway env. Returns the fake so tests can assert
    the teardown ran — `close_calls` (our rpyc socket) since 153.3-06 / D-35, and
    `shutdown_calls == 0` (the shared terminal IPC, which we must never touch)."""
    fake = _FakeMt5(scenario)

    def _connect(*, host, port, timeout):
        return fake

    def _fake_build(host: str, port: int) -> Mt5Client:
        return Mt5Client(host, port, _connect=_connect)

    monkeypatch.setattr("services.ingestion.mt5._build_client", _fake_build)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")
    return fake


def _req(api_key="123456", api_secret="investor-pw", passphrase="Broker-Demo"):
    # Credential-slot reuse: login → api_key, investor password → api_secret,
    # broker server → passphrase.
    return KeySubmissionRequest(
        flow_type="onboard",
        source="mt5",
        context={
            "api_key": api_key,
            "api_secret": api_secret,
            "passphrase": passphrase,
        },
    )


_METRICS_SENTINEL = MetricsSnapshot(
    sharpe=None,
    twr=None,
    ytd=None,
    max_drawdown=None,
    total_pnl=None,
    trade_count=0,
    win_rate=None,
)

# login=123456 matches the parsed login from _req's api_key="123456" so the RED-TEAM
# login bracket (account_info().login == expected, pre+post) passes on the happy path.
_INVESTOR_ACCOUNT = _FakeNamedTuple(trade_allowed=False, balance=1000.0, login=123456)
# An investor order_check is rejected with the DOCUMENTED investor code
# TRADE_RETCODE_TRADE_DISABLED (10017) — [DOC] enum_trade_return_codes.
#
# D-31 HISTORY: this fixture used to be retcode=10027 with NO terminal read at
# all, and that pair WAS the fail-open scenario — under MetaQuotes' default-ON
# "Disable automatic trading through the external Python API" a MASTER password
# produces exactly those two negatives, and the old two-signal rule returned
# ValidationResult(valid=True, read_only=True) for it.
_INVESTOR_ORDER_CHECK = _FakeNamedTuple(retcode=10017, comment="Trade disabled")
# The terminal ITSELF permits trading and is attached to a trade server, so an
# account-level refusal is attributable to the ACCOUNT. Required for any
# read_only verdict (D-31).
_HEALTHY_TERMINAL = _FakeNamedTuple(connected=True, trade_allowed=True, build=4410)


# --------------------------------------------------------------------------- #
# Fail-loud RETURNS axis
# --------------------------------------------------------------------------- #


def test_compute_metrics_fails_loud_naming_the_deal_ledger_path() -> None:
    adapter = Mt5Adapter()
    with pytest.raises(NotImplementedError) as exc:
        adapter.compute_metrics([])
    msg = str(exc.value)
    # Names the Phase-136 deal-ledger ONE-path so a future EquityCurveBuilder
    # delegation (the corruption path) can't slip in silently.
    assert "combine_mt5_deal_ledger" in msg
    assert "BYB-02" in msg


def test_fetch_raw_fails_loud() -> None:
    adapter = Mt5Adapter()
    with pytest.raises(NotImplementedError) as exc:
        asyncio.run(adapter.fetch_raw({"api_key": "123"}))
    assert "Phase 136" in str(exc.value)


# --------------------------------------------------------------------------- #
# validate — investor accepted, master rejected, fail-closed honesty, close()
# --------------------------------------------------------------------------- #


def test_validate_investor_valid_readonly_and_close(monkeypatch) -> None:
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _HEALTHY_TERMINAL,
        },
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is True
    assert result.read_only is True  # STRUCTURAL (no trade surface), not probed
    assert result.error_code is None
    assert fake.close_calls == 1  # close() on the success path (D-35: our socket)
    assert fake.shutdown_calls == 0  # …and the SHARED terminal IPC is untouched


def test_validate_terminal_trade_disabled_never_returns_readonly(monkeypatch) -> None:
    """⭐ D-31 SECURITY REGRESSION at the ADAPTER seam — the CLASS half of the fix.

    `is_trade_capable` had TWO call sites. Fixing only the router would leave
    `Mt5Adapter.validate` fail-OPEN, which is the instance-not-class defect this
    milestone has been bitten by repeatedly — so THIS test is the one that proves
    the fix is a class fix. It is red against a router-only remedy.

    Same inputs as the router regression: the terminal is connected but its own
    trade permission is off (MetaQuotes' default-ON "Disable automatic trading
    through the external Python API"), under which a MASTER password produces the
    identical two negatives. The adapter must NOT return
    ValidationResult(valid=True, read_only=True); it refuses with the same
    server-misconfiguration disposition it already uses for an unconfigured
    gateway, because no retry can clear a setting in our own terminal.
    """
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _FakeNamedTuple(connected=True, trade_allowed=False),
        },
    )

    with pytest.raises(RuntimeError) as exc:
        asyncio.run(Mt5Adapter().validate(_req()))

    # Names the operator remedy, never the user's credentials.
    msg = str(exc.value)
    assert "server misconfiguration" in msg
    assert "investor-pw" not in msg
    assert "Broker-Demo" not in msg
    assert fake.close_calls == 1  # close() still runs on the refusal path
    assert fake.shutdown_calls == 0


def test_validate_unreadable_terminal_propagates_transient_never_readonly(
    monkeypatch,
) -> None:
    """An unreadable terminal yields no capability signal, so the two account
    negatives prove nothing — refuse. The adapter takes its TRANSIENT disposition
    (propagate) rather than the permanent operator arm, because a detached/
    unreadable bridge clears on retry. Never valid, never read_only."""
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            # No "terminal" key -> terminal_info() returns None -> the client
            # treats it as an ERROR and raises, which the validate path catches
            # and turns into "no signal".
        },
    )

    with pytest.raises(Mt5ClientError) as exc:
        asyncio.run(Mt5Adapter().validate(_req()))

    # The message must NOT carry a wrong_server/auth token, or a caller running
    # classify_mt5_login_error over it would blame the user's broker server for
    # our gateway's condition.
    assert classify_mt5_login_error(exc.value) == "transient"
    assert fake.close_calls == 1  # session never leaks on the unreadable-terminal path
    assert fake.shutdown_calls == 0


def test_validate_disconnected_terminal_is_transient_never_readonly(
    monkeypatch,
) -> None:
    """A terminal detached from the trade server is a documented SIBLING cause of
    the account-level refusal ([DOC] MQL5 "Trade permission"), so investor mode is
    not attributable — refuse, transiently, never read_only."""
    fake = _install_client(
        monkeypatch,
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _FakeNamedTuple(connected=False, trade_allowed=True),
        },
    )

    with pytest.raises(Mt5ClientError) as exc:
        asyncio.run(Mt5Adapter().validate(_req()))

    assert classify_mt5_login_error(exc.value) == "transient"
    assert fake.close_calls == 1  # session never leaks on the disconnected-terminal path
    assert fake.shutdown_calls == 0


def test_validate_master_via_trade_allowed_rejected(monkeypatch) -> None:
    fake = _install_client(
        monkeypatch,
        {
            "account": _FakeNamedTuple(trade_allowed=True, login=123456),
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _HEALTHY_TERMINAL,
        },
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "MT5_MASTER_PASSWORD"
    # Byte-identity pin — the cross-language contract string.
    assert result.human_message == MT5_MASTER_PASSWORD_DETAIL
    assert fake.close_calls == 1  # close() on the master-reject path
    assert fake.shutdown_calls == 0


def test_validate_master_via_order_check_retcode_rejected(monkeypatch) -> None:
    # trade_allowed False but the order_check probe would be ACCEPTED (retcode
    # TRADE_RETCODE_DONE) — either positive signal rejects (Pitfall 4).
    fake = _install_client(
        monkeypatch,
        {
            "account": _FakeNamedTuple(trade_allowed=False, login=123456),
            "order_check": _FakeNamedTuple(retcode=10009, comment="Done"),
            "terminal": _HEALTHY_TERMINAL,
        },
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "MT5_MASTER_PASSWORD"
    assert result.human_message == MT5_MASTER_PASSWORD_DETAIL


def test_validate_bad_creds_maps_to_auth_failed(monkeypatch) -> None:
    # login returns falsy -> Mt5Client._raise_last reads last_error -> Mt5ClientError
    # whose text is classified 'auth' (contains "invalid"/"account"/"password").
    fake = _install_client(
        monkeypatch,
        {"login": False, "last_error": (134, "invalid account or password")},
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "AUTH_FAILED"
    # Byte-identity with services/exchange.py AUTH_FAILED_DETAIL (zero TS edits).
    assert result.human_message == AUTH_FAILED_DETAIL
    assert fake.close_calls == 1  # close() on the auth-fail path
    assert fake.shutdown_calls == 0


def test_validate_wrong_server_maps_to_wrong_server(monkeypatch) -> None:
    fake = _install_client(
        monkeypatch,
        {"login": False, "last_error": (0, "trade server not found")},
    )

    result = asyncio.run(Mt5Adapter().validate(_req()))

    assert result.valid is False
    assert result.error_code == "MT5_WRONG_SERVER"
    assert result.human_message == MT5_WRONG_SERVER_DETAIL
    assert fake.close_calls == 1  # session never leaks on the wrong-server path
    assert fake.shutdown_calls == 0


def test_validate_transient_propagates_untouched_and_closes(monkeypatch) -> None:
    # An unrecognized login error must NEVER read as auth-failed OR valid — it
    # PROPAGATES so the caller classifies it honestly (F4). close() still runs.
    fake = _install_client(
        monkeypatch,
        {"login": False, "last_error": (0, "timeout waiting for response")},
    )

    with pytest.raises(Mt5ClientError):
        asyncio.run(Mt5Adapter().validate(_req()))
    assert fake.close_calls == 1  # session never leaks on the propagating path
    assert fake.shutdown_calls == 0


def test_validate_non_numeric_login_fails_closed_without_client(monkeypatch) -> None:
    # A non-numeric MT5 login cannot authenticate — fail CLOSED with AUTH_FAILED
    # and NEVER construct a client (guard the spy).
    def _boom(host, port):
        raise AssertionError("_build_client must not be called for a bad login")

    monkeypatch.setattr("services.ingestion.mt5._build_client", _boom)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "h")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    result = asyncio.run(Mt5Adapter().validate(_req(api_key="not-a-login")))

    assert result.valid is False
    assert result.error_code == "AUTH_FAILED"
    assert result.human_message == AUTH_FAILED_DETAIL


def test_validate_blank_server_is_wrong_server(monkeypatch) -> None:
    def _boom(host, port):
        raise AssertionError("_build_client must not be called for a blank server")

    monkeypatch.setattr("services.ingestion.mt5._build_client", _boom)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "h")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    result = asyncio.run(Mt5Adapter().validate(_req(passphrase="   ")))

    assert result.valid is False
    assert result.error_code == "MT5_WRONG_SERVER"
    assert result.human_message == MT5_WRONG_SERVER_DETAIL


def test_validate_missing_gateway_env_raises_server_misconfig(monkeypatch) -> None:
    # Missing MT5_GATEWAY_HOST/PORT is a SERVER misconfig, propagated — never
    # valid, never blames the user's creds.
    monkeypatch.delenv("MT5_GATEWAY_HOST", raising=False)
    monkeypatch.delenv("MT5_GATEWAY_PORT", raising=False)
    with pytest.raises(RuntimeError, match="MT5 gateway not configured"):
        asyncio.run(Mt5Adapter().validate(_req()))


def test_validate_probe_hang_bounded_by_wait_for_ceiling(monkeypatch) -> None:
    """WR-02 (WEDGE-01 defense-in-depth): a probe that blocks PAST the outer
    ceiling must raise (TimeoutError) rather than let the sequential worker await
    a hung thread unbounded — matching the router's wait_for guard. close() still
    runs so the terminal session never leaks.

    Against the pre-fix unbounded ``await asyncio.to_thread(_probe)`` there is NO
    ``_MT5_PROBE_TIMEOUT_S`` ceiling: the probe runs to completion (no
    TimeoutError, disposition wrong) — the exact WEDGE-01 divergence this closes.
    """
    import time

    class _BlockingClient:
        def __init__(self) -> None:
            self.shutdown_calls = 0

        def login(self, *a, **k):
            # Block LONGER than the (monkeypatched-tiny) ceiling so wait_for fires
            # first. This stands in for a hang outside a bounded rpyc round-trip.
            time.sleep(1.0)

        def account_info(self):
            return {"trade_allowed": False}

        def order_check(self, request):
            return {"retcode": 10027}

        def close(self):
            self.shutdown_calls += 1

    client = _BlockingClient()
    monkeypatch.setattr(
        "services.ingestion.mt5._build_client", lambda host, port: client
    )
    # Shrink the last-resort ceiling so the test does not wait the real ~35s.
    monkeypatch.setattr("services.ingestion.mt5._MT5_PROBE_TIMEOUT_S", 0.1)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(Mt5Adapter().validate(_req()))
    assert client.shutdown_calls == 1  # close() ran even though the probe was cut off


# --------------------------------------------------------------------------- #
# THE TERMINAL LEASE — the SIBLING validate path (153.3 review of D-29)
#
# D-29 made `routers/exchange.py` take the per-terminal lease. THIS path —
# `Mt5Adapter.validate` — logs into the SAME process-global MetaTrader5 session,
# from the SAME process (`main.py`'s lifespan runs the worker loops INSIDE the API
# process), and took the lease ZERO times. A lease held by ONE of two callers of
# ONE terminal serializes NOTHING: MT5 binds one account per terminal AT A TIME,
# so the unleased login() silently re-points the terminal under the leased caller
# mid-probe. Observed before the fix:
#   ['login-start', 'login-start', 'login-end', 'release', 'login-end', 'release']
#
# ⚠️ The oracle is BLOCKING/ORDERING, never "a lease object was entered" or "a lock
# exists": a lease built on a second registry, or on a differently formatted key,
# enters and exits perfectly happily while serializing nothing — and looks fixed.
# --------------------------------------------------------------------------- #


def _expected_terminal_key(host: str, port: int) -> str:
    """The key `Mt5Client` ITSELF produces — obtained by CALLING the shipped
    property, never by retyping its format here. The three job call sites and the
    router all key on `Mt5Client.terminal_key`; if this adapter formatted the key
    differently the two would resolve to DIFFERENT Lock objects and serialize
    nothing (MT5CONC-02 / 151-RESEARCH Pitfall 2) while every lock still "works".
    """
    return Mt5Client.terminal_key.fget(SimpleNamespace(_host=host, _port=port))


class _InstrumentedConn(_FakeRpycConn):
    """The rpyc socket, recording its teardown on the shared event log — so the
    ordering oracle can see that the lease is held until the transport is given
    up, not merely until login() returns."""

    def __init__(self, events: list[str]) -> None:
        super().__init__()
        self._events = events

    def close(self):
        self._events.append("close")
        return super().close()


class _SlowLoginMt5(_FakeMt5):
    """The ONE shared Wine terminal, instrumented so the INTERLEAVE is observable.

    `login` sleeps INSIDE the worker thread (`_probe` runs via
    `asyncio.to_thread`) precisely so an UNSERIALIZED second caller genuinely
    overlaps it. An instant login would let both callers pass in either order and
    the ordering oracle would be vacuous — a guard that cannot fail.
    """

    def __init__(self, scenario: dict, events: list[str]) -> None:
        super().__init__(scenario)
        self._events = events
        # Single leading underscore ⇒ NOT re-mangled by this class either; the
        # name stays byte-identical to the one mt5linux 0.1.9 sets.
        self._MetaTrader5__conn = _InstrumentedConn(events)

    def login(self, login, **kwargs):
        self._events.append("login-start")
        time.sleep(0.1)
        self._events.append("login-end")
        return super().login(login, **kwargs)


def _install_shared_terminal(
    monkeypatch,
    events: list[str],
    factory_calls: list[tuple[str, int]] | None = None,
) -> _SlowLoginMt5:
    """Every `_build_client` call returns a FRESH `Mt5Client` over the SAME double
    — which is the production topology: one Wine terminal, one MetaTrader5 module
    instance, a new client per job."""
    fake = _SlowLoginMt5(
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _HEALTHY_TERMINAL,
        },
        events,
    )

    def _connect(*, host, port, timeout):
        return fake

    def _fake_build(host: str, port: int) -> Mt5Client:
        if factory_calls is not None:
            factory_calls.append((host, port))
        return Mt5Client(host, port, _connect=_connect)

    monkeypatch.setattr("services.ingestion.mt5._build_client", _fake_build)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")
    return fake


async def test_two_concurrent_ingestion_validates_are_serialized_on_the_terminal(
    monkeypatch,
) -> None:
    """⭐ THE POINT. Two concurrent validates through THIS path must serialize on
    the ONE shared terminal.

    Asserted as ORDERING, not as "both succeeded": both succeed under the defect
    too whenever the interleave happens to be benign. Against the unleased adapter
    this reds with the wave-4 shape (two `login-start`s before the first
    `login-end`), which is the terminal being re-pointed under a caller mid-probe.
    """
    events: list[str] = []
    _install_shared_terminal(monkeypatch, events)

    results = await asyncio.gather(
        Mt5Adapter().validate(_req()), Mt5Adapter().validate(_req())
    )

    assert [(r.valid, r.read_only) for r in results] == [(True, True)] * 2
    assert events == ["login-start", "login-end", "close"] * 2, (
        "the second validate's login() started before the first gave up the "
        "terminal — this path is not taking the lease (or is taking one keyed "
        f"differently from Mt5Client.terminal_key). Observed: {events}"
    )


async def test_ingestion_validate_waits_on_the_lock_keyed_by_terminal_key(
    monkeypatch,
) -> None:
    """⭐ THE KEY IDENTITY, proven by CONTENTION rather than by inspection.

    A lease on the wrong key is worse than no lease: it looks fixed. So the holder
    here is the lock from the ONE shared registry under the key
    `Mt5Client.terminal_key` itself computes — the same object `job_worker`,
    `allocator_positions` and `routers/exchange.py` contend on. If this adapter
    derived the key any other way (the raw `MT5_GATEWAY_PORT` string, a host-only
    key, a private registry) it would sail straight past a held terminal and
    `blocked` would be False.

    Also asserted: a queued caller has not yet CONSTRUCTED a client. Construction
    opens the rpyc socket, which is the very thing that races, so the lease must
    already be held when it happens.
    """
    events: list[str] = []
    factory_calls: list[tuple[str, int]] = []
    _install_shared_terminal(monkeypatch, events, factory_calls)

    held = mt5_concurrency._mt5_terminal_lock_for(
        _expected_terminal_key("mt5-gw.internal", 18812)
    )
    await held.acquire()

    task = asyncio.create_task(Mt5Adapter().validate(_req()))
    try:
        await asyncio.sleep(0.15)  # ample for an unleased validate to finish
        blocked = not task.done()
        factory_while_queued = list(factory_calls)
        events_while_queued = list(events)
    finally:
        # Released unconditionally, so a failing assertion below can never strand
        # the terminal for the rest of the session.
        held.release()

    result = await task

    assert blocked, (
        "the validate ran while another caller held the terminal — it is either "
        "not leasing, leasing a differently-keyed lock, or leasing out of a "
        "second registry"
    )
    assert factory_while_queued == [], (
        "a queued validate constructed its rpyc client before holding the "
        f"terminal: {factory_while_queued}"
    )
    assert events_while_queued == []
    assert (result.valid, result.read_only) == (True, True)
    assert factory_calls == [("mt5-gw.internal", 18812)]
    assert events == ["login-start", "login-end", "close"]


# --------------------------------------------------------------------------- #
# Execution-detail axis — delegation, not re-implementation
# --------------------------------------------------------------------------- #


def test_compute_fingerprint_delegates_and_returns() -> None:
    fp = Mt5Adapter().compute_fingerprint([], _METRICS_SENTINEL)
    assert fp.version == 1


def test_reconstruct_positions_delegates_and_returns() -> None:
    positions = asyncio.run(Mt5Adapter().reconstruct_positions([]))
    assert positions == []


def test_mt5_adapter_satisfies_protocol() -> None:
    assert isinstance(Mt5Adapter(), IngestionAdapter)


# --------------------------------------------------------------------------- #
# Registration lockstep (Phase 135 MT5SRC-01)
# --------------------------------------------------------------------------- #


def test_get_adapter_mt5_resolves_and_caches() -> None:
    from services.ingestion import ADAPTERS, get_adapter

    ADAPTERS.pop("mt5", None)
    adapter = get_adapter("mt5")
    assert isinstance(adapter, Mt5Adapter)
    # Cached: a second call returns the SAME instance.
    assert get_adapter("mt5") is adapter


def test_unknown_source_still_rejected() -> None:
    from services.ingestion import get_adapter

    with pytest.raises(ValueError, match="Unsupported source"):
        get_adapter("kraken")


def test_source_literal_admits_mt5() -> None:
    from services.ingestion import SUPPORTED_SOURCES
    from services.ingestion.adapter import Source

    assert "mt5" in typing.get_args(Source)
    assert "mt5" in SUPPORTED_SOURCES


# --------------------------------------------------------------------------- #
# Go-dark server gate — mt5_enabled_server truth table (fail-closed)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, False),  # unset
        ("", False),
        ("1", False),
        ("on", False),
        ("false", False),
        ("true", True),
        ("True", True),
        ("TRUE ", True),  # .strip().lower() normalization
    ],
)
def test_mt5_enabled_server_truth_table(monkeypatch, value, expected) -> None:
    if value is None:
        monkeypatch.delenv("MT5_ENABLED", raising=False)
    else:
        monkeypatch.setenv("MT5_ENABLED", value)
    assert mt5_enabled_server() is expected


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON — FINDING #6b: the WORKER connect-stage leak, end to end
#
# WHY this matters (Rule 9). `Mt5Adapter.validate`'s connect sits DELIBERATELY
# outside the close-`finally` below it — its own comment says why ("there is no
# client to close yet"), and that is correct as far as it goes. What it did not
# account for is `asyncio.to_thread` work outliving its `wait_for`: the abandoned
# thread finishes `_build_client` AFTER the caller unwound, producing an rpyc
# session against the gateway's ONE `ThreadedServer` that no `finally` in this file
# can see and nothing will ever close. Same mechanism as #6a, different path — and
# the second member of the class is exactly what this milestone has paid sixteen
# times for skipping.
# --------------------------------------------------------------------------- #


async def test_a_connect_stage_timeout_leaves_no_rpyc_socket_open(monkeypatch) -> None:
    """⭐ FINDING #6b at the PATH level.

    ⚠️ Same BALANCE oracle as the #6a sibling, for the same reason: which arm of
    the construction fence fires depends on where the zombie's thread was when the
    lease's bump landed, so "the conn the zombie opened was closed" would flake on
    a run where the property genuinely held. Assert that no conn REMAINS open.

    ⚠️ CI-hang discipline: bounded waits only, gate set in a `finally`, the zombie
    joined on a signal IT sets.
    """
    from services.mt5_client import Mt5SessionAbandoned

    gate = threading.Event()
    finished = threading.Event()
    conns: list = []
    outcomes: list[BaseException] = []

    def _blocking_connect(*, host, port, timeout):
        # BOUNDED — a gate the test somehow fails to set reds this case rather than
        # stalling the suite for the 300s THREAD_JOIN_TIMEOUT.
        gate.wait(0.25)
        fake = _FakeMt5({})
        conns.append(fake)
        return fake

    def _fake_build(host: str, port: int) -> Mt5Client:
        # The REAL client over the injected seam: the construction fence IS the
        # behaviour under test, so a stub client would fabricate it.
        try:
            return Mt5Client(host, port, _connect=_blocking_connect)
        except BaseException as exc:  # noqa: BLE001 — recorded, then re-raised
            outcomes.append(exc)
            raise
        finally:
            finished.set()

    monkeypatch.setattr("services.ingestion.mt5._build_client", _fake_build)
    # §Q6 patch-target table: `_MT5_PROBE_TIMEOUT_S` is READ by
    # `services.ingestion.mt5`, so it is patched there. Patching a re-export would
    # be a SILENT no-op and the real ~35s bound would stay in force (the E2 trap).
    monkeypatch.setattr("services.ingestion.mt5._MT5_PROBE_TIMEOUT_S", 0.05)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    try:
        with pytest.raises(asyncio.TimeoutError):
            await Mt5Adapter().validate(_req())
    finally:
        gate.set()  # ⛔ never leave the zombie parked

    assert finished.wait(5.0), "the abandoned construction never finished"

    open_conns = [c for c in conns if c._MetaTrader5__conn.close_calls == 0]
    assert open_conns == [], (
        "the abandoned connect-stage thread left an rpyc session open against the "
        "gateway's ThreadedServer — this path's connect sits outside the "
        "close-finally, so nothing here will ever close it (finding #6b)"
    )
    # Non-vacuity: the zombie really ran and really was refused.
    assert outcomes and isinstance(outcomes[0], Mt5SessionAbandoned), (
        f"the zombie construction was not fenced at all: {outcomes}"
    )
    # The terminal key the lease bumped is the one this client would have used —
    # obtained by CALLING the shipped property, never by retyping its format
    # (MT5CONC-02 / Pitfall 2: a divergent key fences nothing while looking fixed).
    assert _expected_terminal_key("mt5-gw.internal", 18812) == "mt5-gw.internal:18812"


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON / D-40 — the refusal's CLASSIFICATION at the ADAPTER seam
#
# WHY this matters (Rule 9). This adapter's documented disposition for every
# transient is to PROPAGATE the exception untouched (never `valid`, never
# `auth_failed`, never `wrong_server`) and let the caller classify it honestly —
# the sFOX F4 posture. An abandoned-session refusal is a transient by
# construction, so propagation is already the correct behaviour and the explicit
# arm added beside it changes nothing today. It is written down anyway, and
# pinned here, so a future broad `except Exception` around the probe cannot
# silently absorb the refusal into a credential verdict — the class D-42 makes
# structurally impossible at the sink and this arm keeps impossible at the seam.
# --------------------------------------------------------------------------- #


class _EpochBumpingMt5(_FakeMt5):
    """The ONE shared Wine terminal, whose `login()` advances the terminal
    generation — i.e. the lease this session began under releases mid-probe.

    Bumping from INSIDE the transport is what makes the next session touch be
    refused by the SHIPPED `_assert_live` rather than by a hand-thrown stand-in:
    the test then proves the refusal can actually ARRIVE at this seam, not merely
    that the seam would pass the type along if it did.
    """

    def __init__(self, scenario: dict, terminal_key: str) -> None:
        super().__init__(scenario)
        self._terminal_key = terminal_key

    def login(self, login, **kwargs):
        out = super().login(login, **kwargs)
        from services.mt5_client import bump_mt5_terminal_epoch

        # The SHIPPED release hook — the same call `mt5_terminal_lease`'s finally
        # makes. Never a hand-poked registry entry.
        bump_mt5_terminal_epoch(self._terminal_key)
        return out


def test_an_abandoned_session_refusal_propagates_out_of_validate_unchanged(
    monkeypatch,
) -> None:
    """Type IDENTITY out of `validate`, plus the session-never-leaks invariant.

    ⛔ The two forbidden outcomes are excluded by construction: `pytest.raises`
    means no `ValidationResult` was returned at all, so this path can produce
    neither `valid=True` nor an `auth_failed`/`wrong_server` verdict. `close()`
    still runs in the adapter's finally — `close` is D-41-EXEMPT from the fence
    precisely so a fenced session can still give up its own socket.
    """
    from services.mt5_client import Mt5SessionAbandoned

    key = _expected_terminal_key("mt5-gw.internal", 18812)
    fake = _EpochBumpingMt5(
        {
            "account": _INVESTOR_ACCOUNT,
            "order_check": _INVESTOR_ORDER_CHECK,
            "terminal": _HEALTHY_TERMINAL,
        },
        key,
    )

    def _connect(*, host, port, timeout):
        return fake

    def _fake_build(host: str, port: int) -> Mt5Client:
        return Mt5Client(host, port, _connect=_connect)

    monkeypatch.setattr("services.ingestion.mt5._build_client", _fake_build)
    monkeypatch.setenv("MT5_GATEWAY_HOST", "mt5-gw.internal")
    monkeypatch.setenv("MT5_GATEWAY_PORT", "18812")

    with pytest.raises(Mt5SessionAbandoned) as excinfo:
        asyncio.run(Mt5Adapter().validate(_req()))

    # ⭐ Type IDENTITY, not `isinstance` of some wrapper: the whole point of the
    # adapter's transient disposition is that the caller sees the ORIGINAL
    # exception. A re-raise as `Mt5ClientError` would let
    # `classify_mt5_login_error` reach it, and its `_WRONG_SERVER_TOKENS` would
    # blame the user's broker server for our own abandoned thread.
    assert type(excinfo.value) is Mt5SessionAbandoned
    assert excinfo.value.stage == "account_info"
    assert not isinstance(excinfo.value, Mt5ClientError)
    # The session never leaks, and the SHARED terminal IPC is never torn down.
    assert fake.close_calls == 1
    assert fake.shutdown_calls == 0
