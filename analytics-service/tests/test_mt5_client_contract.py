"""Offline contract tests for services.mt5_client.Mt5Client (MT5GW-02).

This is the LOAD-BEARING CI gate phases 135 (Source registration / validate) and
136 (equity reconstruction) stub against. It MUST be green with ZERO live
dependencies — no live terminal, no network, no `mt5linux` install, no
Windows-only `MetaTrader5` import. The contract is exercised through an injected
`_connect` seam returning an in-memory RPyC/MT5-shaped double, never a MagicMock:
the double is shaped like the real bridge so the kwarg wiring (login timeout,
rpyc request timeout) is asserted for real (test-the-wiring lesson, P115), not
against the impl's own formula.

Regression gates — WHY each case matters (Rule 9):
  - lazy transport import: `import services.mt5_client` must NOT import `mt5linux`.
    The package is not installed until the plan 134-03 human-verify gate clears;
    a module-level import would red the WHOLE analytics suite in CI today. The
    transport import lives inside the default connect factory only.
  - None (error) vs () (honest empty) on history_deals_get: conflating an error
    read with "zero deals" FABRICATES a flat account — the exact no-invented-data
    violation `api_verified` exists to defeat. None -> typed raise via
    last_error(); () -> honest []; populated -> native dicts.
  - netref -> native materialization: RPyC hands back live proxies. If the client
    leaks a proxy, the caller holds a transport object that dies with the
    connection. Every structured read returns a plain dict.
  - secret hygiene (T-134-01): the investor password/server/login must NEVER
    appear in an Mt5ClientError message or any log surface — mt5linux
    f-string-interpolates the password into the remotely-eval'd code, so a leaked
    error string is a real credential disclosure.
  - dual-timeout ordering (T-134-04, Pitfall 3): the MT5 login IPC timeout (ms)
    must stay strictly below the rpyc sync_request_timeout (s) so MT5 fails its
    own pipe first and rpyc surfaces a clean error instead of a raw abort — a hung
    terminal must fail loud fast, never wedge the sequential worker (v1.11 WEDGE).
  - the ordering is a CLASS rule, not a login rule (153.3 / D-24): `initialize()`
    ran for months on MetaTrader5's 60000ms vendor default — 2x the rpyc bound —
    because the guard covered `login()` alone. Every timeout-carrying MT5 call is
    registered in `MT5_IPC_TIMEOUTS_MS`, the guard iterates the whole table, and
    the registry's completeness is DERIVED FROM SOURCE below so a third such call
    cannot land unregistered.
  - idempotent close: a teardown failure must never mask the caller's error, and
    shutdown() must never be called twice.
"""
from __future__ import annotations

import ast
import json
import pathlib
import re
import sys
import threading
import time
import types
from typing import NamedTuple

import pytest
from structlog.testing import capture_logs

import services.mt5_client as mt5_client_mod
from services import mt5_concurrency
from services.mt5_client import (
    MT5_INITIALIZE_TIMEOUT_MS,
    MT5_IPC_TIMEOUTS_MS,
    MT5_LOGIN_TIMEOUT_MS,
    MT5_REQUEST_TIMEOUT_S,
    Mt5Client,
    Mt5ClientError,
    Mt5SessionAbandoned,
    Mt5Session,
    begin_mt5_lease_occupancy,
    bump_mt5_terminal_epoch,
    end_mt5_lease_occupancy,
)


@pytest.fixture(autouse=True)
def _reset_terminal_state():
    """WIZFORM-ABANDON / D-36: clear the process-wide per-terminal state (the
    ``asyncio.Lock`` registry AND the epoch registry) around every test here.

    The epoch cases below BUMP a terminal's generation; a bump leaked out of one
    test would fence a client another test builds for the same ``host:port``, and
    under ``-n auto --dist loadgroup`` that is a sixth flake mechanism in a suite
    that already carries five documented ones (RESEARCH Pitfall 8). ONE shared
    reset, so a future third registry has exactly one home."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


class _FakeNamedTuple:
    """Emulates a netref namedtuple: exposes _asdict() only (like an RPyC proxy).

    Deliberately NOT a real namedtuple and NOT a dict — the client must go through
    `._asdict()` and coerce to a native dict, so the double only offers that seam.
    """

    def __init__(self, **fields) -> None:
        self._fields_dict = dict(fields)

    def _asdict(self) -> dict:
        return dict(self._fields_dict)


class _RemoteNamespace(dict):
    """The rpyc server namespace. A callable fetched from it runs with the owning
    connection's `remote_frame_active` flag raised, which is how an offline test
    tells CLIENT-side work from FAR-side work in a single process."""

    def __init__(self, conn) -> None:
        super().__init__()
        self._conn = conn

    def __getitem__(self, key):
        value = super().__getitem__(key)
        if not callable(value):
            return value

        def _on_the_far_side(*args, **kwargs):
            self._conn.remote_frame_active = True
            try:
                return value(*args, **kwargs)
            finally:
                self._conn.remote_frame_active = False

        return _on_the_far_side


class _WireFencedDeals:
    """A netref-shaped deal tuple that REFUSES per-element access from the client.

    This is the cost model, made executable. Against the live gateway each local
    touch of a deal proxy is an RPyC round-trip; 493 deals cost 29.9s that way
    (MEASURED 2026-08-13) and blew the 40s read bound. In-process that cost is
    invisible, so the double converts it into the thing a test can see: iterating
    from the client side is an error, iterating from the far side is fine.
    """

    def __init__(self, rows, conn) -> None:
        self._rows = tuple(rows)
        self._conn = conn

    def __iter__(self):
        if not self._conn.remote_frame_active:
            raise AssertionError(
                "per-deal access happened on the CLIENT side of the wire — that is "
                "one RPyC round-trip per deal (60ms/deal live), the MT5DEAL-01 "
                "defect that made derive_broker_dailies unrunnable"
            )
        return iter(self._rows)

    def __len__(self):
        return len(self._rows)


class _FakeRpycConn:
    """The rpyc connection object `mt5linux.MetaTrader5` hangs off its name-mangled
    `_MetaTrader5__conn` attribute — the ONLY transport-close seam 0.1.9 exposes
    (its `shutdown` forwards to MetaTrader5, which is the very thing `release()`
    must not do). Shaped, not mocked, so `Mt5Client.release()` genuinely EXERCISES
    the transport-close branch offline instead of always falling through to the
    "no transport close reachable" warning.
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self.close_calls = 0
        self._config: dict = {}
        # rpyc classic's remote-namespace seam. Shaped, not mocked: `execute()`
        # really execs the source into a namespace dict, so the contract tests
        # exercise the REAL remote materializer source (`_REMOTE_MATERIALIZE_SRC`)
        # offline rather than a re-implementation of it that could silently drift.
        self.namespace: dict = _RemoteNamespace(self)
        self.execute_calls = 0
        # True only while a function fetched from `namespace` is executing — the
        # offline stand-in for "this frame is running on the far side of the wire".
        # `_WireFencedDeals` reads it to catch per-deal access on the CLIENT side.
        self.remote_frame_active = False

    def execute(self, src: str) -> None:
        self.execute_calls += 1
        exec(src, self.namespace)  # noqa: S102 — the point is to run the real source

    def close(self):
        self.close_calls += 1
        if self._scenario.get("transport_close_raises"):
            raise RuntimeError("transport close boom")


class _FakeMt5:
    """In-memory RPyC/MT5-shaped double driven by a scenario dict.

    Scenario keys (all optional):
      login            -> value login() returns (default True)
      account          -> value account_info() returns
      terminal         -> value terminal_info() returns
      deals            -> value history_deals_get() returns
      order_check      -> value order_check() returns
      last_error       -> tuple last_error() returns (default (0, "unknown"))
      shutdown_raises  -> if truthy, shutdown() raises
      transport_close_raises -> if truthy, the rpyc transport close() raises
      no_transport     -> if truthy, the double exposes NO `_MetaTrader5__conn` at
                          all, so release() takes its "no transport close
                          reachable" branch
      login_raises     -> if set, login() RAISES this exception (transport error)
      account_raises   -> if set, account_info() RAISES this exception
      terminal_info_raises -> if set, terminal_info() RAISES this exception
      last_error_raises -> if set, last_error() RAISES this exception (transport
                           died on the last_error() round-trip itself)
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        if not scenario.get("no_transport"):
            # Single leading underscore ⇒ NOT re-mangled by this class; the
            # attribute name is byte-identical to the one mt5linux 0.1.9 sets.
            self._MetaTrader5__conn = _FakeRpycConn(scenario)
        self.login_calls: list[tuple] = []
        self.initialize_kwargs: list[dict] = []
        self.shutdown_calls = 0
        self.initialize_calls = 0
        self.call_order: list[str] = []
        self.deals_window: tuple | None = None
        self.order_check_kwargs: dict | None = None

    def initialize(self, **kwargs):
        # The real terminal needs initialize() before any call (attaches IPC).
        # **kwargs because initialize() carries its own `timeout=` ms ceiling
        # (153.3 / D-24) — a double that refused it would TypeError on every login.
        # Recorded (like login's kwargs) so the ms ceiling is asserted for real
        # rather than against the impl's own formula.
        self.initialize_kwargs.append(dict(kwargs))
        self.initialize_calls += 1
        self.call_order.append("initialize")
        exc = self._scenario.get("initialize_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("initialize", True)

    def login(self, login, **kwargs):
        self.login_calls.append((login, kwargs))
        self.call_order.append("login")
        exc = self._scenario.get("login_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("login", True)

    def account_info(self):
        exc = self._scenario.get("account_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("account")

    def terminal_info(self):
        exc = self._scenario.get("terminal_info_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("terminal")

    def history_deals_get(self, from_ts, to_ts):
        self.deals_window = (from_ts, to_ts)  # record the (coerced) bounds
        return self._scenario.get("deals")

    def order_check(self, **request):
        # mt5linux evals order_check(*args, **kwargs); the client passes KEYWORDS.
        self.order_check_kwargs = dict(request)
        return self._scenario.get("order_check")

    def last_error(self):
        exc = self._scenario.get("last_error_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("last_error", (0, "unknown"))

    def shutdown(self):
        self.shutdown_calls += 1
        if self._scenario.get("shutdown_raises"):
            raise RuntimeError("shutdown boom")


def _make(scenario: dict):
    """Return (connect, fake, record). `record` captures the connect kwargs so the
    rpyc sync_request_timeout wiring can be asserted; `fake` exposes call logs.
    `record["connects"]` counts connect() invocations so restart's re-connect
    (connects == 2 after one restart) is provable while the single shared `fake`
    keeps its call logs (shutdown_calls, login_calls) across the rebuild."""
    fake = _FakeMt5(scenario)
    record: dict = {"connects": 0}

    def _connect(*, host, port, timeout):
        record["host"] = host
        record["port"] = port
        record["timeout"] = timeout
        record["connects"] += 1
        return fake

    return _connect, fake, record


# -- Lazy transport import ---------------------------------------------------


def test_module_import_does_not_require_mt5linux():
    """Importing the client must NOT import mt5linux (lazy transport import).

    mt5linux is uninstalled until the 134-03 human-verify gate; a module-level
    import would red the whole analytics suite in CI. The import lives inside the
    default connect factory only.
    """
    # services.mt5_client is already imported at module top of this test file.
    assert "mt5linux" not in sys.modules


# -- login: typed fail-loud + secret hygiene + dual-timeout ------------------


def test_login_failure_raises_typed_error_no_secret():
    """login() returning falsy -> Mt5ClientError carrying last_error() code; the
    investor password must NOT leak into the message (T-134-01)."""
    connect, _fake, _rec = _make(
        {"login": False, "last_error": (134, "auth failed for account 123")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.login(123, password="s3cr3t-pw", server="Broker-Demo")
    assert "s3cr3t-pw" not in str(exc_info.value)
    assert exc_info.value.code == 134


def test_login_transport_raise_is_scrubbed_and_typed():
    """CR-01: a transport-RAISED exception (not a falsy return) whose text embeds
    the interpolated credentials must be caught and re-raised as a scrubbed,
    typed Mt5ClientError. This is the exact disclosure vector the module docstring
    names: mt5linux f-string-interpolates the password into the remotely-eval'd
    code, so a leaked rpyc remote-traceback string is a real credential
    disclosure. The client OWNS the scrub for this path; it must not rely on a
    caller routing the exception through the redact processor. Fails against the
    unwrapped `self._mt5.login(...)` call (raw RuntimeError escapes untyped)."""
    connect, _fake, _rec = _make(
        {
            "login_raises": RuntimeError(
                "rpyc remote error while eval'ing "
                "login(123, password='hunter2', server='Broker-Demo')"
            )
        }
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.login(123, password="hunter2", server="Broker-Demo")
    msg = str(exc_info.value)
    assert "hunter2" not in msg
    assert "Broker-Demo" not in msg
    assert "123" not in msg


def test_read_transport_raise_is_scrubbed_and_typed():
    """CR-01: the transport-raise wrap covers EVERY raw read, not just login. A
    non-login read that raises at the transport must also surface as a scrubbed,
    typed Mt5ClientError rather than a raw untyped transport exception. Fails
    against the unwrapped `self._mt5.account_info()` call."""
    connect, _fake, _rec = _make(
        {"account_raises": RuntimeError("rpyc timeout; apikey=SUPERSECRET leaked")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.account_info()
    assert "SUPERSECRET" not in str(exc_info.value)


def test_login_calls_initialize_before_login():
    """REGRESSION (soak, 2026-07-25): login() MUST call initialize() FIRST — the real
    MT5 terminal returns -10004 'No IPC connection' on any call before initialize()
    attaches the IPC pipe. Invisible offline because the double answered login()
    without needing an IPC; only running the soak against the live gateway exposed it.
    Verified live: initialize()->login()->account_info() reads the real account."""
    connect, fake, _rec = _make({"login": True})
    client = Mt5Client("host", 18812, _connect=connect)
    client.login(123, password="pw", server="Broker-Demo")
    assert fake.initialize_calls == 1
    # initialize STRICTLY before login (order pinned, not just presence)
    assert fake.call_order[:2] == ["initialize", "login"]


def test_login_raises_when_initialize_fails_and_skips_login():
    """A falsy initialize() (terminal down / no IPC) -> typed raise via last_error,
    and login() is NEVER attempted — no credential round-trip against a dead
    terminal. Fails against a login() that skips the initialize() guard."""
    connect, fake, _rec = _make(
        {"initialize": False, "last_error": (-10004, "No IPC connection")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.login(123, password="pw", server="Broker-Demo")
    assert exc_info.value.code == -10004
    assert fake.login_calls == []  # login not attempted after a failed initialize


def test_login_initialize_transport_raise_is_typed():
    """A transport-RAISED exception from initialize() (dead rpyc bridge) surfaces as a
    typed, scrubbed Mt5ClientError, never a raw transport exception — same fail-loud
    discipline as the login() call itself."""
    connect, _fake, _rec = _make(
        {"initialize_raises": RuntimeError("rpyc remote error: bridge down")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.login(123, password="pw", server="Broker-Demo")


def test_login_stage_refusal_is_the_only_path_raising_the_marker():
    """Phase 167 CR-01 — `Mt5LoginRefusedError` means "the terminal answered the
    sign-in itself, and said no", and NOTHING else may raise it.

    The wizard and the holdings poll both tell a user their credentials failed
    on this type (via `is_mt5_login_refusal`). If a pre-credential or transport
    stage raised it, a gateway wedge would be reported as a wrong password on
    every MT5 key at once.

    Positive: a falsy `login()` raises the marker, carrying the terminal's code,
    with the credential redacted exactly as the parent type's would be."""
    from services.mt5_client import Mt5LoginRefusedError

    connect, _fake, _rec = _make(
        {"login": False, "last_error": (0, "Invalid account 123 on Broker-Demo")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5LoginRefusedError) as exc_info:
        client.login(123, password="s3cr3t-pw", server="Broker-Demo")
    assert exc_info.value.code == 0
    assert isinstance(exc_info.value, Mt5ClientError)
    msg = str(exc_info.value)
    assert "s3cr3t-pw" not in msg
    assert "Broker-Demo" not in msg


@pytest.mark.parametrize(
    "scenario",
    [
        pytest.param(
            {"initialize": False, "last_error": (-10004, "No IPC connection")},
            id="initialize-falsy",
        ),
        pytest.param(
            {"initialize_raises": EOFError("stream has been closed")},
            id="initialize-transport-raise",
        ),
        pytest.param(
            {"login_raises": RuntimeError("rpyc remote error")},
            id="login-transport-raise",
        ),
        pytest.param(
            {"login": False, "last_error_raises": ConnectionResetError("reset")},
            id="login-falsy-but-last_error-round-trip-died",
        ),
        pytest.param(
            {"login": False, "last_error": None},
            id="login-falsy-but-last_error-answered-nothing",
        ),
        # 167 SFH MEDIUM-1 — a truthy answer we cannot read (a one-element
        # tuple, so `err[1]` is an IndexError). `_raise_last` coerces it to
        # code 0, which `is_mt5_login_refusal` would call a refusal if the
        # marker survived the coercion.
        pytest.param(
            {"login": False, "last_error": (0,)},
            id="login-falsy-malformed-last_error",
        ),
    ],
)
def test_login_failures_with_no_sign_in_answer_are_not_the_marker(scenario):
    """Phase 167 CR-01 — the negative half. Each of these fails inside `login()`
    WITHOUT the terminal having answered the sign-in, so each must stay a plain
    `Mt5ClientError`, which callers treat as a transport fault.

    The malformed case also pins that the redaction and the coerced code are
    unchanged: the message is the fixed "malformed" text and the code is 0."""
    from services.mt5_client import Mt5LoginRefusedError

    connect, _fake, _rec = _make(scenario)
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.login(123, password="pw", server="Broker-Demo")
    assert not isinstance(exc_info.value, Mt5LoginRefusedError), (
        f"{scenario!r} raised the login-refusal marker, but the terminal never "
        "answered the sign-in — a transport fault would be reported as a "
        "credential failure"
    )
    if scenario.get("last_error") == (0,):
        assert exc_info.value.code == 0
        assert "malformed last_error shape" in str(exc_info.value)
        assert "Broker-Demo" not in str(exc_info.value)


def test_post_login_read_failure_is_not_the_marker():
    """Phase 167 CR-01 — `account_info()` returning None after a successful login
    raises through the SAME `_raise_last` site, and must stay a plain
    `Mt5ClientError`: the credential was already accepted."""
    from services.mt5_client import Mt5LoginRefusedError

    connect, _fake, _rec = _make(
        {"login": True, "account": None, "last_error": (-10004, "No IPC connection")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    client.login(123, password="pw", server="Broker-Demo")
    with pytest.raises(Mt5ClientError) as exc_info:
        client.account_info()
    assert exc_info.value.code == -10004
    assert not isinstance(exc_info.value, Mt5LoginRefusedError)


def test_order_check_passed_as_keywords_not_positional_dict():
    """REGRESSION (soak, 2026-07-25): order_check MUST be called with KEYWORDS, not a
    positional dict. mt5linux 0.1.9 evals ``mt5.order_check(*args, **kwargs)`` and MT5
    rejects a positional dict with retcode -2 'Unnamed arguments not allowed' (verified
    live on the prod gateway); ``**request`` -> ``order_check(action=…, symbol=…)`` which
    MT5 accepts. Fails against a positional ``order_check(request)`` call."""
    connect, fake, _rec = _make(
        {"order_check": _FakeNamedTuple(retcode=0, comment="Done")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    client.order_check({"action": 1, "symbol": "EURUSD", "volume": 0.01})
    assert fake.order_check_kwargs == {"action": 1, "symbol": "EURUSD", "volume": 0.01}


def test_history_deals_get_coerces_datetime_bounds_to_int_epoch():
    """REGRESSION (soak, 2026-07-25): mt5linux 0.1.9's remote eval has NO ``datetime``
    import, so a datetime window bound f-string-interpolates as ``datetime.datetime(…)``
    and remote-NameErrors (the soak passes tz-aware datetimes; the worker passes ints).
    The client coerces datetime -> int epoch seconds so BOTH callers work. Fails against
    a passthrough that forwards the datetime verbatim."""
    from datetime import datetime, timezone

    connect, fake, _rec = _make({"deals": ()})
    client = Mt5Client("host", 18812, _connect=connect)
    dt_from = datetime(2026, 3, 1, tzinfo=timezone.utc)
    dt_to = datetime(2026, 7, 1, tzinfo=timezone.utc)
    client.history_deals_get(dt_from, dt_to)
    assert fake.deals_window == (int(dt_from.timestamp()), int(dt_to.timestamp()))
    assert all(isinstance(b, int) for b in fake.deals_window)


def test_login_passes_ipc_timeout_below_rpyc_timeout():
    """login() must pass the MT5 IPC login timeout (ms), and it must stay strictly
    below the rpyc sync_request_timeout (s) so MT5 fails its own pipe first
    (Pitfall 3 / T-134-04)."""
    connect, fake, _rec = _make({"login": True})
    client = Mt5Client("host", 18812, _connect=connect)
    client.login(123, password="pw", server="Broker-Demo")
    _login_arg, kwargs = fake.login_calls[0]
    assert kwargs["timeout"] == MT5_LOGIN_TIMEOUT_MS
    assert MT5_LOGIN_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000


def test_connect_receives_request_timeout():
    """The ctor request_timeout_s must be threaded into connect(timeout=...) — that
    is the rpyc sync_request_timeout knob. The value stays strictly ABOVE the MT5
    login IPC timeout (20000ms) so the WR-01 dual-timeout ordering guard passes."""
    connect, _fake, record = _make({})
    Mt5Client("host", 18812, _connect=connect, request_timeout_s=25.0)
    assert record["timeout"] == 25.0


def test_default_connect_matches_real_mt5linux_0_1_9_ctor(monkeypatch):
    """REGRESSION (red-team FABLE, 2026-07-25): the REAL `_default_connect` factory
    (not the injected double) must call mt5linux 0.1.9's actual constructor —
    ``MetaTrader5(host, port)``, which takes NO ``timeout`` param — and wire the
    rpyc ``sync_request_timeout`` onto the private connection itself.

    WHY THIS MATTERS: the shipped code called ``MetaTrader5(host, port, timeout)``.
    The pinned 0.1.9 wheel's ctor is ``__init__(self, host, port)``, so a third
    positional raises ``TypeError: takes from 1 to 3 positional arguments but 4
    were given`` on EVERY real connect — the go-live soak gate (scripts.mt5_spike →
    Mt5Client) could never pass and every mt5 job would crash at the flip. It was
    invisible because ALL other contract tests inject a ``_connect`` double whose
    signature happens to accept ``timeout``, and mt5linux is never installed in CI.
    This test injects a fake ``mt5linux`` whose ctor is byte-for-byte 0.1.9's
    signature, so the constructor-arity contract is pinned and this whole class of
    "double masks the real wheel" bug fails loud. Fails (TypeError) pre-fix.
    """
    from services.mt5_client import _default_connect

    captured: dict = {}

    class _FakeConn:
        def __init__(self) -> None:
            self._config: dict = {}

        def execute(self, *_a, **_k) -> None:  # 0.1.9 ctor calls conn.execute(...)
            pass

    class _FakeMetaTrader5:
        # EXACTLY mt5linux 0.1.9's signature: (self, host, port) — NO timeout knob.
        def __init__(self, host: str = "localhost", port: int = 18812) -> None:
            captured["ctor_args"] = (host, port)
            # name-mangled `self.__conn`, as the real 0.1.9 class stores it.
            self._MetaTrader5__conn = _FakeConn()

    fake_module = types.ModuleType("mt5linux")
    fake_module.MetaTrader5 = _FakeMetaTrader5  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "mt5linux", fake_module)

    client = _default_connect(host="gw.internal", port=8001, timeout=42.0)

    # 1. the ctor received ONLY (host, port) — the third positional is gone.
    assert captured["ctor_args"] == ("gw.internal", 8001)
    # 2. the rpyc per-request timeout was wired onto the private connection.
    assert client._MetaTrader5__conn._config["sync_request_timeout"] == 42.0


def test_inverting_request_timeout_is_rejected():
    """WR-01: a request_timeout_s that puts the rpyc round-trip ceiling AT OR BELOW
    the MT5 login IPC timeout inverts the load-bearing dual-timeout ordering
    (`MT5_LOGIN_TIMEOUT_MS < request_timeout_s*1000`), reopening the v1.11 WEDGE-01
    wedge class the docstring warns against. It must fail loud at construction, not
    silently. Fails against the unguarded __init__ (constructs without raising)."""
    connect, _fake, _rec = _make({})
    # login IPC timeout is 20000ms; a 10s rpyc ceiling (10000ms) is below it.
    with pytest.raises(ValueError):
        Mt5Client("host", 18812, _connect=connect, request_timeout_s=10.0)


def test_default_construction_satisfies_timeout_ordering():
    """WR-01: the DEFAULT construction must NOT trip the ordering guard (20000ms
    login IPC timeout < 30000ms rpyc ceiling), so the guard rejects only genuine
    inversions."""
    connect, _fake, _rec = _make({})
    Mt5Client("host", 18812, _connect=connect)  # must not raise
    assert MT5_LOGIN_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000


# -- 153.3 / D-24: the ordering is a CLASS rule, and the registry is complete --


def _timeout_carrying_mt5_calls(source: str) -> set[str]:
    """Derive FROM SOURCE the set of ``self._mt5.<name>(...)`` calls that are passed
    a ``timeout=`` keyword.

    Whole-line comments are stripped first, so a comment that merely NAMES a call
    (``# self._mt5.foo(timeout=...)``) can neither satisfy nor break the assertion.
    Argument text is taken by walking to the matching close-paren rather than by a
    line-local regex, because ``login(...)`` spans four lines.
    """
    body = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    )
    found: set[str] = set()
    for match in re.finditer(r"self\._mt5\.(\w+)\(", body):
        depth, i = 0, match.end() - 1
        while i < len(body):
            if body[i] == "(":
                depth += 1
            elif body[i] == ")":
                depth -= 1
                if depth == 0:
                    break
            i += 1
        if re.search(r"\btimeout\s*=", body[match.end() : i]):
            found.add(match.group(1))
    return found


def test_every_timeout_carrying_mt5_call_is_registered():
    """153.3 / D-24 — THE mechanism that stops the defect class recurring.

    The ordering guard can only protect calls it knows about. `initialize()` was
    bound nowhere and registered nowhere, so the guard — which checked
    MT5_LOGIN_TIMEOUT_MS alone — was structurally blind to it, and every
    production login was censored at the 30s rpyc ceiling (9/9 correlated
    failures, 2026-08-06/08). Point-fixing `initialize()` would re-ship the class:
    a THIRD timeout-carrying call could land tomorrow, unregistered, unguarded and
    green.

    So the set of timeout-carrying calls is derived from `mt5_client.py` ON DISK
    and every member must be a registry key. The >= 2 floor is load-bearing: a
    regex that silently stopped matching would otherwise pass by matching nothing
    (a vacuous green is exactly how the original defect hid).
    """
    source = pathlib.Path(mt5_client_mod.__file__).read_text()
    derived = _timeout_carrying_mt5_calls(source)

    assert len(derived) >= 2, (
        "the source-derived set collapsed — the extraction is broken, not the code; "
        f"derived={derived!r}"
    )
    # The direct regression for the un-timed call: initialize() must carry a ceiling.
    assert "initialize" in derived, (
        "self._mt5.initialize(...) is not passed a timeout= — this is D-24 itself: "
        "MetaTrader5's 60000ms vendor default applies, 2x the rpyc bound"
    )
    unregistered = derived - set(MT5_IPC_TIMEOUTS_MS)
    assert not unregistered, (
        f"MT5 call(s) {sorted(unregistered)} carry their own timeout but are absent "
        "from MT5_IPC_TIMEOUTS_MS — the ordering guard cannot see them (D-24)"
    )


def test_timeout_call_extractor_ignores_comments_and_untimed_calls():
    """The extractor above is itself under test, on synthetic source.

    Without this, the completeness gate could rot in either direction and stay
    green: a commented-out call could SATISFY it (masking that the real call was
    deleted), or a comment could BREAK it (training the next reader to weaken the
    assertion). Multi-line arguments must be seen, because `login(...)` spans four
    lines in the real file.
    """
    synthetic = "\n".join(
        [
            "    def login(self):",
            "        # self._mt5.commented_out(timeout=1)  <- a comment, not a call",
            "        self._mt5.untimed()",
            "        self._mt5.bound(timeout=5)",
            "        self._mt5.spread(",
            "            arg,",
            "            timeout=7,",
            "        )",
        ]
    )
    assert _timeout_carrying_mt5_calls(synthetic) == {"bound", "spread"}


@pytest.mark.parametrize("call_name", sorted(MT5_IPC_TIMEOUTS_MS))
def test_every_registered_ipc_timeout_is_below_the_rpyc_bound(call_name):
    """Every registered IPC ceiling — not just login's — must sit strictly below the
    rpyc round-trip bound, or that call can never deliver an MT5-level answer.

    Parametrized over the registry so a newly-registered call is checked the moment
    it is added, without anyone remembering to write a test for it.
    """
    assert MT5_IPC_TIMEOUTS_MS[call_name] < MT5_REQUEST_TIMEOUT_S * 1000


def test_shipped_timeout_chain_is_the_hand_typed_inequality():
    """The SHIPPED chain, pinned as literals rather than recomputed from the table
    under test (a self-referential oracle would pass for any consistent set of
    numbers, including an inverted one).

    Expected relation, typed by hand: 20000ms initialize < 30000ms rpyc bound, and
    20000ms login < 30000ms rpyc bound.

    ⚠️ This reds if the defaults move OR if MT5_*_TIMEOUT_* is exported in the test
    environment. Both are things a reader must see: every other assertion in this
    file (e.g. `test_inverting_request_timeout_is_rejected`, which picks 10.0s
    precisely because it is below the 20000ms login ceiling) silently assumes this
    chain.
    """
    assert MT5_IPC_TIMEOUTS_MS == {"initialize": 20000, "login": 20000}
    assert MT5_REQUEST_TIMEOUT_S == 30.0
    assert 20000 < 30 * 1000  # the ordering, written out


def test_login_passes_initialize_ipc_timeout():
    """D-24 DIRECT REGRESSION for the un-timed call.

    `self._mt5.initialize()` carried NO `timeout=`, so MetaTrader5's vendor default
    of 60000ms applied INSIDE a 30s rpyc bound — the first MT5 call of every login
    was structurally incapable of answering in time. Asserted against the recorded
    kwargs on the double (test-the-wiring), not against the client's own constant
    expression. Fails against the bare `initialize()` call (no `timeout` key).
    """
    connect, fake, _rec = _make({"login": True})
    client = Mt5Client("host", 18812, _connect=connect)
    client.login(123, password="pw", server="Broker-Demo")
    assert fake.initialize_kwargs[0]["timeout"] == MT5_INITIALIZE_TIMEOUT_MS
    assert MT5_INITIALIZE_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000


# -- 153.3 / D-25: the chain is PER-INSTANCE, the module constants stay put ----


def test_per_instance_overrides_reach_both_mt5_calls():
    """The validate path's chain (plan 153.3-03): a LONGER rpyc bound plus longer
    per-call IPC ceilings, built per instance so the SEQUENTIAL worker's module
    constants never move (D-25 — moving them reopens v1.11 WEDGE-01).

    Both calls must read the OVERRIDDEN values. A client that lengthened only
    `request_timeout_s` would still log in under the worker's 20000ms IPC ceiling —
    "longer" only at the top, which is the truncation EVIDENCE Correction C-3
    describes.
    """
    connect, fake, record = _make({"login": True})
    client = Mt5Client(
        "host",
        18812,
        _connect=connect,
        request_timeout_s=90.0,
        initialize_timeout_ms=60000,
        login_timeout_ms=60000,
    )
    client.login(123, password="pw", server="Broker-Demo")

    assert record["timeout"] == 90.0  # the rpyc bound is the instance's, too
    assert fake.initialize_kwargs[0]["timeout"] == 60000
    _login_arg, kwargs = fake.login_calls[0]
    assert kwargs["timeout"] == 60000
    # and the module constants are untouched by that construction
    assert MT5_IPC_TIMEOUTS_MS == {"initialize": 20000, "login": 20000}


def test_longer_request_timeout_without_overrides_uses_module_defaults():
    """A longer rpyc bound alone leaves the IPC ceilings at the module defaults —
    the overrides are opt-in, so the three non-validate construction sites
    (`job_worker.py`, `services/ingestion/mt5.py`, `scripts/mt5_spike.py`, all of
    which pass neither) keep today's behaviour byte-for-byte."""
    connect, fake, _rec = _make({"login": True})
    client = Mt5Client("host", 18812, _connect=connect, request_timeout_s=90.0)
    client.login(123, password="pw", server="Broker-Demo")

    assert fake.initialize_kwargs[0]["timeout"] == MT5_INITIALIZE_TIMEOUT_MS
    _login_arg, kwargs = fake.login_calls[0]
    assert kwargs["timeout"] == MT5_LOGIN_TIMEOUT_MS


def test_inverting_initialize_override_is_rejected_and_names_the_call():
    """⭐ THE class-vs-instance test. An `initialize` IPC ceiling at or above the
    effective rpyc bound inverts the ordering exactly as the shipped 60000ms
    default did, and must fail loud AT CONSTRUCTION — the only posture that makes a
    bad MT5_INITIALIZE_TIMEOUT_MS visible before a hung production login.

    Deliberately exercises the SECOND member of the class, not `login`: a guard
    that was point-fixed to bind `initialize()` while still checking only
    MT5_LOGIN_TIMEOUT_MS constructs this client happily, and this is the assertion
    that reds. The message must NAME the offending call, because "some timeout
    inverted" is not actionable at 3am.
    """
    connect, _fake, _rec = _make({})
    with pytest.raises(ValueError) as exc_info:
        # 30000ms IPC ceiling >= the default 30.0s (30000ms) rpyc bound.
        Mt5Client("host", 18812, _connect=connect, initialize_timeout_ms=30000)
    message = str(exc_info.value)
    assert "initialize" in message
    assert "login" not in message  # it names the OFFENDER, not the whole table
    assert "WEDGE-01" in message


def test_per_instance_ipc_timeouts_survive_restart():
    """restart() rebuilds the transport with the SAME wiring (MT5CONC-01). The
    resolved IPC ceilings live on the instance, so a rebuilt validate client must
    NOT silently drop back to the worker's module constants — that would make the
    post-restart retry run the very chain the override exists to avoid."""
    connect, fake, record = _make({"login": True})
    client = Mt5Client(
        "host",
        18812,
        _connect=connect,
        request_timeout_s=90.0,
        initialize_timeout_ms=60000,
        login_timeout_ms=60000,
    )
    client.login(123, password="pw", server="Broker-Demo")

    client.restart()
    assert record["connects"] == 2
    assert record["timeout"] == 90.0  # the instance's rpyc bound, on the rebuild

    client.login(123, password="pw", server="Broker-Demo")
    assert fake.initialize_kwargs[-1]["timeout"] == 60000
    _login_arg, kwargs = fake.login_calls[-1]
    assert kwargs["timeout"] == 60000


# -- account_info: None -> raise; populated -> native dict -------------------


def test_account_info_none_raises_via_last_error():
    """account_info() None is an error, not an empty account -> typed raise."""
    connect, _fake, _rec = _make({"account": None, "last_error": (5, "terminal down")})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.account_info()
    assert exc_info.value.code == 5


@pytest.mark.parametrize(
    "malformed",
    [
        ("only-one",),          # wrong-length tuple -> err[1] IndexError
        42,                     # non-subscriptable scalar -> err[0] TypeError
        {"code": 1},            # dict without int keys -> err[0] KeyError
        ("not-an-int", "text"), # err[0] present but int() fails -> ValueError
    ],
)
def test_raise_last_malformed_shape_still_typed(malformed):
    """WR-02: `_raise_last` is the SINGLE fail-loud choke point. A truthy-but-
    malformed `last_error()` shape (wrong-length tuple, non-subscriptable scalar,
    dict, non-int code) must still yield a typed, scrubbed Mt5ClientError — never a
    raw IndexError/TypeError/KeyError/ValueError that bypasses the typed-error
    discipline the design leans on. Fails against the unguarded `err[0]/err[1]` +
    `int(code)` unpack (raw exception escapes)."""
    connect, _fake, _rec = _make({"account": None, "last_error": malformed})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.account_info()


def test_raise_last_transport_raise_is_typed_and_scrubbed():
    """RED-TEAM: last_error() is itself a raw transport call. If the connection
    dies on THAT round-trip (right after the None-return that triggered
    _raise_last), the exception must still be converted to a typed, scrubbed
    Mt5ClientError — never a raw rpyc traceback escaping the single fail-loud choke
    point (which would 500 the router / skip the worker classify arms and could
    carry unscrubbed remote text). Reddens if the last_error() call is unwrapped."""
    boom = RuntimeError("rpyc EOFError mid-last_error: password='hunter2'")
    connect, _fake, _rec = _make({"account": None, "last_error_raises": boom})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as ei:
        client.account_info()
    # Typed (not the raw RuntimeError) and scrubbed (no leaked credential text).
    assert "hunter2" not in str(ei.value)


def test_mt5_session_repr_does_not_leak_credentials():
    """RED-TEAM: the Mt5Session dataclass auto-__repr__ must NOT emit the plaintext
    investor password / login / broker server — any %r/f-string/structlog
    serialization would otherwise leak them (the repr-leak class). repr(session)
    must contain none of the three credential values. Reddens if the field(repr=
    False) markers are removed."""
    connect, _fake, _rec = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    session = Mt5Session(
        client=client,
        login=50123456,
        investor_password="s3cr3t-investor-pw",
        server="TopBroker-Live-7",
    )
    text = repr(session)
    assert "s3cr3t-investor-pw" not in text
    assert "50123456" not in text
    assert "TopBroker-Live-7" not in text


def test_account_info_materialized_to_native_dict():
    """account_info() netref -> a plain native dict (never the live proxy)."""
    connect, _fake, _rec = _make(
        {
            "account": _FakeNamedTuple(
                login=123, equity=1000.0, currency="USD", trade_allowed=False
            )
        }
    )
    client = Mt5Client("host", 18812, _connect=connect)
    info = client.account_info()
    assert isinstance(info, dict)
    assert not isinstance(info, _FakeNamedTuple)
    assert info["equity"] == 1000.0
    assert info["currency"] == "USD"
    assert info["trade_allowed"] is False


# -- terminal_info: the D-31 capability signal, same read discipline ----------


def test_terminal_info_materialized_to_native_dict():
    """terminal_info() netref -> a plain native dict (never the live proxy).

    The two fields the Phase-153.3 capability rule consumes (`connected`,
    `trade_allowed`) must survive materialization as native booleans; a leaked
    proxy would die with the connection before the verdict is taken.
    """
    connect, _fake, _rec = _make(
        {
            "terminal": _FakeNamedTuple(
                connected=True, trade_allowed=True, community_account=False
            )
        }
    )
    client = Mt5Client("host", 18812, _connect=connect)
    info = client.terminal_info()
    assert isinstance(info, dict)
    assert not isinstance(info, _FakeNamedTuple)
    assert info["connected"] is True
    assert info["trade_allowed"] is True


def test_terminal_info_none_raises_via_last_error():
    """D-31 REGRESSION: a `None` terminal_info() is an ERROR, never data.

    This is the case that must not be softened into `{}` or `None`-as-a-value:
    the capability rule reads `connected` / `trade_allowed` off this dict, and a
    silently-empty read would make BOTH look false — which under a rule that
    treated the read as data (rather than as an error) is precisely how an
    unreadable terminal turns into a confident verdict. `None` -> typed
    Mt5ClientError carrying the last_error() code.
    """
    connect, _fake, _rec = _make(
        {"terminal": None, "last_error": (-10004, "No IPC connection")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.terminal_info()
    assert exc_info.value.code == -10004


def test_terminal_info_transport_raise_is_scrubbed_and_typed():
    """A transport-RAISED terminal_info() surfaces scrubbed + typed, never a raw
    rpyc exception (clone of the account_info read-transport guard, T-134-01)."""
    connect, _fake, _rec = _make(
        {
            "terminal_info_raises": RuntimeError(
                "rpyc timeout; apikey=SUPERSECRET leaked"
            )
        }
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.terminal_info()
    assert "SUPERSECRET" not in str(exc_info.value)


def test_terminal_info_degenerate_shape_raises():
    """A terminal_info() return without ._asdict() is degenerate -> fail loud,
    never coerced into an empty dict (which would read as "terminal says no")."""

    class _NoAsdict:
        pass

    connect, _fake, _rec = _make({"terminal": _NoAsdict()})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.terminal_info()


# -- history_deals_get: the load-bearing None != () != populated trio --------


def test_history_deals_none_is_error_not_empty():
    """deals None -> Mt5ClientError. NEVER an empty list: conflating error with
    empty fabricates a flat account (the no-invented-data violation)."""
    connect, _fake, _rec = _make({"deals": None, "last_error": (1, "IPC fail")})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.history_deals_get(0, 1)


def test_history_deals_empty_tuple_is_honest_empty():
    """deals () -> [] (honest empty window), no raise."""
    connect, _fake, _rec = _make({"deals": ()})
    client = Mt5Client("host", 18812, _connect=connect)
    assert client.history_deals_get(0, 1) == []


def test_history_deals_populated_materializes_each_deal():
    """A populated tuple -> a list of plain dicts; the raw server-time epoch is
    returned VERBATIM (no tz conversion in the client — that seam is Phase 136)."""
    connect, _fake, _rec = _make(
        {
            "deals": (
                _FakeNamedTuple(
                    profit=10.0,
                    swap=-1.0,
                    commission=-0.5,
                    fee=0.0,
                    time=1700000000,
                    time_msc=1700000000123,
                ),
                _FakeNamedTuple(
                    profit=-3.0,
                    swap=0.0,
                    commission=-0.5,
                    fee=0.0,
                    time=1700086400,
                    time_msc=1700086400456,
                ),
            )
        }
    )
    client = Mt5Client("host", 18812, _connect=connect)
    deals = client.history_deals_get(0, 1)
    assert isinstance(deals, list)
    assert len(deals) == 2
    assert all(isinstance(d, dict) for d in deals)
    assert deals[0]["profit"] == 10.0
    # server-time epoch verbatim, no conversion
    assert deals[0]["time"] == 1700000000
    assert deals[1]["time"] == 1700086400


def test_deal_materialization_costs_no_client_side_per_deal_access():
    """⭐ MT5DEAL-01 REGRESSION. Materializing N deals must cost O(1) wire crossings,
    not O(N).

    WHY THIS MATTERS, not just what it does: `[_materialize(d) for d in deals]` reads
    like local work but `deals` is an rpyc netref, so it is a round-trip per element
    and per field. MEASURED on the live gateway from inside the worker container
    2026-08-13: 60ms/deal, 29.9s for 493 deals, against a 40s `wait_for`. Every
    `mt5.stage` event said `ok=true` and no rpyc `sync_request_timeout` (30s) could
    fire, because the cost was never inside ONE bounded call — so the only symptom a
    user ever saw was FLIPRETRY-01, on every retry, forever, for the first account
    with real history.

    ⛔ This test must fail if the loop moves back to the client, which is why the
    double refuses per-element access outside a far-side frame rather than merely
    counting calls. It is deliberately NOT an assertion about elapsed time: in-process
    the defect is fast, and a timing oracle here would pass while production hangs.
    """
    connect, fake, _rec = _make({})
    conn = fake._MetaTrader5__conn
    rows = [_FakeNamedTuple(profit=float(i), time=1700000000 + i) for i in range(64)]
    fake._scenario["deals"] = _WireFencedDeals(rows, conn)

    client = Mt5Client("host", 18812, _connect=connect)
    deals = client.history_deals_get(0, 1)

    assert len(deals) == 64
    assert all(isinstance(d, dict) for d in deals)
    assert deals[7]["profit"] == 7.0
    assert deals[7]["time"] == 1700000007
    # O(1) in the deal count: the source is pushed once and invoked once, whether
    # there are 64 deals or 64,000.
    assert conn.execute_calls == 1


def test_deal_materialization_reports_absent_transport_rather_than_falling_back():
    """No rpyc transport ⇒ typed raise, NEVER a quiet client-side comprehension.

    A fallback here would be the worst outcome available: correct results, restored
    60ms/deal, and no signal at all — the defect back in production wearing a green
    test suite.
    """
    connect, _fake, _rec = _make({"no_transport": True, "deals": ()})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.history_deals_get(0, 1)


def test_materialize_degenerate_shape_raises():
    """A deal without ._asdict() is a degenerate shape -> fail loud, never coerce."""

    class _NoAsdict:
        pass

    connect, _fake, _rec = _make({"deals": (_NoAsdict(),)})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.history_deals_get(0, 1)


# -- close: bounded + idempotent ---------------------------------------------


def test_close_is_idempotent_and_swallows_teardown_errors(caplog):
    """A teardown that raises must not propagate; a second close() is a no-op (the
    transport is closed exactly once).

    ⚠️ RE-CUT by 153.3-06 / **D-35**. The observable moved from `shutdown_calls` to
    the transport close, because `close()` no longer calls `mt5.shutdown()` at all
    — see `test_close_alone_never_reaches_shutdown`. The INTENT is unchanged and is
    what matters: a teardown failure must never mask the caller's error, and a
    double close must not double-tear-down.
    """
    connect, fake, _rec = _make({"transport_close_raises": True})
    client = Mt5Client("host", 18812, _connect=connect)
    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        client.close()  # must not raise even though the transport close boom-s
        client.close()  # idempotent no-op
    assert fake._MetaTrader5__conn.close_calls == 1
    assert fake.shutdown_calls == 0
    assert any("Mt5Client.close" in r.getMessage() for r in caplog.records), (
        "a swallowed teardown failure must still be LOGGED, never silent"
    )


# -- release: our transport dies, the shared IPC pipe does NOT (153.3 / D-30) --
#
# WHY (Rule 9): mt5linux serves every rpyc connection from ONE ThreadedServer
# process over ONE shared MetaTrader5 module instance holding ONE IPC pipe
# (153-EVIDENCE-mt5-platform §A2 / Correction C-1). A `shutdown()` issued by one
# request therefore destroys that pipe for every CONCURRENT caller, who observe
# `-10004 No IPC connection` — a denial of service against ourselves, which the
# per-request `finally: client.close()` in routers/exchange.py was performing on
# every single validate. These cases pin the separation of "release my lease" from
# "shut the terminal down".


def test_release_closes_the_transport_and_never_shuts_down():
    """⭐ The direct D-30 regression: release() closes OUR rpyc socket and does NOT
    reach shutdown(). If it ever did, a concurrent validate/derive against the same
    gateway would lose its IPC pipe mid-probe."""
    connect, fake, _rec = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    client.release()
    assert fake._MetaTrader5__conn.close_calls == 1
    assert fake.shutdown_calls == 0


def test_release_makes_the_shutdown_path_unreachable():
    """⭐ release() then close(): shutdown_calls stays 0.

    This is the stronger statement — not "the request path happens not to call
    close()" but "after a release, close() CANNOT reach shutdown() on that
    instance". An "also call close() for safety" regression at any call site is
    therefore harmless, and this test is what says so."""
    connect, fake, _rec = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    client.release()
    client.close()
    assert fake.shutdown_calls == 0
    assert fake._MetaTrader5__conn.close_calls == 1


def test_release_is_idempotent():
    """A second release() is a no-op — the transport is closed exactly once
    (mirrors close()'s `_closed` latch)."""
    connect, fake, _rec = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    client.release()
    client.release()
    assert fake._MetaTrader5__conn.close_calls == 1
    assert fake.shutdown_calls == 0


def test_release_swallows_a_raising_transport_close(caplog):
    """A teardown failure must never mask the caller's verdict — the same posture
    close() takes for a raising shutdown(). It is LOGGED, never silent."""
    connect, fake, _rec = _make({"transport_close_raises": True})
    client = Mt5Client("host", 18812, _connect=connect)
    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        client.release()  # must NOT raise
    assert fake._MetaTrader5__conn.close_calls == 1
    assert fake.shutdown_calls == 0
    assert any("release" in r.getMessage() for r in caplog.records)


def test_release_without_a_reachable_transport_close_warns_loudly(caplog):
    """⛔ Never a silent no-op. If the transport shape changes (or a double offers
    no `_MetaTrader5__conn`), the abandoned connection must be REPORTED — an
    un-closed, un-reported socket is a leak nobody can see. Reddens if the branch
    is turned into a bare `return`."""
    connect, fake, _rec = _make({"no_transport": True})
    client = Mt5Client("host", 18812, _connect=connect)
    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        client.release()
    assert fake.shutdown_calls == 0
    assert any(
        "no rpyc transport close reachable" in r.getMessage() for r in caplog.records
    )


def test_close_alone_never_reaches_shutdown():
    """⭐ THE DIRECT **D-35** REGRESSION. A bare `close()` — the verb the WORKER
    paths call — closes OUR transport and reaches `mt5.shutdown()` ZERO times.

    ⚠️ This case is the DELIBERATE RE-CUT of plan 153.3-03's
    `test_close_alone_still_calls_shutdown_exactly_once`, which pinned
    `shutdown_calls == 1` and was annotated KNOWINGLY TEMPORARY with D-35 named as
    its owner. It flipped to `== 0` because D-35 deletes the teardown at the SINK
    rather than at the call sites: D-30 had taken `shutdown()` off the REQUEST path
    only, leaving `services/exchange.py`'s `aclose_exchange` mt5 arm and
    `services/ingestion/mt5.py`'s adapter `finally` still reaching it — and
    `main.py:83-91` runs the worker loops INSIDE the API process, so those are one
    `await` from a user's validate. Removing the call from `close()` fixes both
    without editing either.

    WHY (Rule 9): `mt5linux` serves every rpyc connection from ONE `ThreadedServer`
    over ONE shared `MetaTrader5` instance holding ONE IPC pipe (EVIDENCE §A2 /
    C-1), so one caller's `shutdown()` is every caller's `-10004`. The pin that
    survives is structural, not path-based: `tests/test_mt5_shutdown_roster.py`
    derives the whole `shutdown()` roster from source.
    """
    connect, fake, _rec = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    client.close()
    assert fake.shutdown_calls == 0
    # …and the session still does not LEAK: our socket is released (Pitfall 6).
    assert fake._MetaTrader5__conn.close_calls == 1


def test_close_twice_closes_the_transport_exactly_once():
    """Idempotence stated on the NEW observable: two closes, one socket teardown.
    A `close()` that re-closed an already-closed rpyc socket on every call would
    turn the epilogue into a source of transport errors."""
    connect, fake, _rec = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    client.close()
    client.close()
    assert fake._MetaTrader5__conn.close_calls == 1
    assert fake.shutdown_calls == 0


def test_close_and_release_are_observationally_identical():
    """⭐ Two public names, ONE implementation (`_teardown_transport`). If they ever
    diverge, one of them has regrown a `shutdown()` — which is exactly the class
    D-35 closed. Asserted by driving each on its own client and comparing the
    observables, not by reading the source."""
    connect_a, fake_a, _ra = _make({})
    connect_b, fake_b, _rb = _make({})
    Mt5Client("host", 18812, _connect=connect_a).close()
    Mt5Client("host", 18812, _connect=connect_b).release()
    assert (
        fake_a._MetaTrader5__conn.close_calls,
        fake_a.shutdown_calls,
    ) == (
        fake_b._MetaTrader5__conn.close_calls,
        fake_b.shutdown_calls,
    ) == (1, 0)


def test_close_without_a_reachable_transport_close_warns_loudly(caplog):
    """⛔ Never a silent no-op — the `close()` half of the same guard `release()`
    carries. After D-35 `close()` performs ONLY the transport teardown, so a
    transport shape it cannot reach means it does nothing at all; that must be
    REPORTED, or the socket leak is invisible."""
    connect, fake, _rec = _make({"no_transport": True})
    client = Mt5Client("host", 18812, _connect=connect)
    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        client.close()
    assert fake.shutdown_calls == 0
    assert any(
        "no rpyc transport close reachable" in r.getMessage() for r in caplog.records
    )


def test_release_never_appears_in_the_shutdown_call_sites():
    """Source gate: release()'s body contains no `shutdown` text at all.

    A pin at the level that matters — STRUCTURAL, not path-based: release() must
    contain no shutdown call, not merely avoid one on the paths a test happens to
    walk. ⚠️ Since 153.3-06 / **D-35** the same is true of `close()` and of every
    other function in the tree except `restart()`, and that far stronger statement
    is derived from source for the WHOLE service by
    `tests/test_mt5_shutdown_roster.py`. This case is retained as the narrow,
    fast-reading pin on the verb D-30 introduced."""
    source = pathlib.Path(mt5_client_mod.__file__).read_text()
    body = source.split("    def release(self) -> None:", 1)[1]
    body = body.split("    def restart(self) -> None:", 1)[0]
    # Judge EXECUTABLE text only: drop the docstring (which necessarily discusses
    # shutdown) and the comment lines.
    _, _, after_open = body.partition('"""')
    _, _, code = after_open.partition('"""')
    code = "\n".join(
        line for line in code.splitlines() if not line.strip().startswith("#")
    )
    assert code.strip(), "the release() body was not extracted — the gate is vacuous"
    assert "shutdown" not in code


# -- restart: bounded-by-caller shutdown + re-connect (MT5CONC-01) -----------


def test_restart_reconnects():
    """restart() tears down the wedged terminal (shutdown once) and re-establishes
    the transport via the stored _connect factory (connects == 2 after one
    restart), leaving a working read surface. A blocked RPyC pipe never self-
    unblocks, so the ACTIVE teardown + rebuild is what makes the next DB-backoff
    retry productive rather than three wasted attempts into failed_final."""
    connect, fake, record = _make(
        {"account": _FakeNamedTuple(login=123, equity=1000.0)}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    assert record["connects"] == 1  # ctor connected once

    client.restart()

    assert fake.shutdown_calls == 1  # old transport told to shut down
    assert record["connects"] == 2  # factory re-invoked → fresh transport
    # The rebuilt transport is live: a read works against the returned fake.
    assert client.account_info()["equity"] == 1000.0


def test_restart_closes_the_stale_socket_and_leaves_the_fresh_one_open():
    """⭐ 153.3-06 / D-35: restart() disposes the stale connection COMPLETELY —
    `shutdown()` (the one permitted teardown) AND our own rpyc socket.

    WHY (Rule 9): telling the terminal to shut its IPC down never closed OUR end of
    the pipe, so every restart leaked one socket against the gateway's
    `ThreadedServer` — a slow resource bleed on the exact recovery path that runs
    when the terminal is already unhealthy. The fresh connection must be untouched
    by any of it, or recovery destroys what it just built."""
    stale = _FakeMt5({})
    fresh = _FakeMt5({"account": _FakeNamedTuple(login=123, equity=2000.0)})
    conns = {"n": 0}

    def _connect(*, host, port, timeout):
        conns["n"] += 1
        return stale if conns["n"] == 1 else fresh

    client = Mt5Client("host", 18812, _connect=_connect)
    client.restart()

    assert stale.shutdown_calls == 1  # the ONE permitted, lease-held teardown
    assert stale._MetaTrader5__conn.close_calls == 1  # …and our socket, no longer leaked
    assert fresh.shutdown_calls == 0
    assert fresh._MetaTrader5__conn.close_calls == 0
    # The fresh connection is the LIVE one and is fully usable.
    assert client.account_info()["equity"] == 2000.0


def test_restart_survives_shutdown_raise():
    """A wedged pipe that RAISES on teardown must never abort the recovery:
    restart() swallows the shutdown error (mirroring close()'s posture) and STILL
    reconnects (connects == 2). Without this, a terminal too broken to shut down
    cleanly would also be too broken to ever restart — the worst case."""
    connect, _fake, record = _make({"shutdown_raises": True})
    client = Mt5Client("host", 18812, _connect=connect)

    client.restart()  # must NOT raise even though shutdown() boom-s

    assert record["connects"] == 2  # reconnect happened despite the teardown raise


def test_restart_reconnects_before_stale_shutdown_can_block():
    """WR-01: restart() must rebuild + swap in the fresh connection BEFORE it tries
    to tear down the stale one, so a stale shutdown() that BLOCKS can never defeat
    the restart.

    WHY (Rule 9): a restart triggered by the derive read-timeout branch runs while
    the timed-out `_mt5_read` OS thread is ABANDONED but still driving the SAME rpyc
    connection. rpyc classic is not concurrent-request-safe, so shutdown() on that
    stale connection can itself HANG. Under the OLD shutdown-first ordering a hanging
    stale-shutdown was abandoned by the bounded caller (`_mt5_bounded_restart`'s
    wait_for) BEFORE the reconnect ran — leaving NO fresh terminal for the next retry
    and defeating the restart. The invariant this pins: by the time the stale
    shutdown blocks, the fresh connection is ALREADY the live connection.

    Offline + BOUNDED: the stale shutdown blocks on a test-controlled Event that is
    released and the thread joined, so CI never really hangs. (The true live rpyc
    concurrency behavior — whether shutdown() on a connection an abandoned reader is
    parked on is safe — is validated in the Phase-139 gateway spike [ASSUMED].)

    Fails against the shutdown-FIRST ordering: connect is never reached while the
    stale shutdown blocks, so the second connect never happens (connects stays 1).
    """
    release = threading.Event()

    class _BlockingShutdownFake:
        def __init__(self, *, equity: float) -> None:
            self._equity = equity
            self.shutdown_calls = 0

        def shutdown(self):
            self.shutdown_calls += 1
            # Bounded park: released by the test below; the 5s ceiling means even a
            # broken join can never wedge CI indefinitely.
            release.wait(5.0)

        def account_info(self):
            return _FakeNamedTuple(login=123, equity=self._equity)

        def last_error(self):
            return (0, "unknown")

    stale = _BlockingShutdownFake(equity=1000.0)
    fresh = _BlockingShutdownFake(equity=2000.0)
    conns = {"n": 0}

    def _connect(*, host, port, timeout):
        conns["n"] += 1
        # ctor gets the stale connection; restart's rebuild gets the fresh one.
        return stale if conns["n"] == 1 else fresh

    client = Mt5Client("host", 18812, _connect=_connect)
    assert conns["n"] == 1

    restart_thread = threading.Thread(target=client.restart)
    restart_thread.start()
    try:
        # Wait (bounded) until the restart thread is parked in the STALE shutdown —
        # under the fix, reconnect + swap already completed before this point.
        deadline = time.monotonic() + 2.0
        while time.monotonic() < deadline and stale.shutdown_calls == 0:
            time.sleep(0.005)
        assert stale.shutdown_calls == 1, "restart never reached the stale teardown"

        # The reconnect must have happened BEFORE the (now-blocking) stale shutdown.
        # Under the old shutdown-first ordering this is still 1 and the test reds.
        assert conns["n"] == 2, (
            "restart must rebuild the transport BEFORE the stale shutdown can block; "
            f"connect invocations={conns['n']!r}"
        )
        # And the fresh connection is the LIVE one: a read now hits `fresh`, not the
        # wedged `stale` connection — so the next retry has a usable terminal.
        assert fresh.shutdown_calls == 0
        assert client.account_info()["equity"] == 2000.0
    finally:
        release.set()
        restart_thread.join(5.0)
        assert not restart_thread.is_alive(), "restart thread failed to drain"


def test_restart_clears_closed():
    """restart() resets the idempotency latch: after close() (which latches
    _closed) then restart(), a subsequent close() must actually tear the transport
    down AGAIN, proving restart cleared _closed. A restart that left _closed set
    would leave the fresh terminal un-closable, leaking the session on the next
    teardown.

    ⚠️ RE-CUT by 153.3-06 / **D-35**: the sequence was pinned on `shutdown_calls`
    (1, 2, 3); `close()` no longer shuts anything down, so the same three-step
    sequence is now read off the transport-close counter. `shutdown_calls` is
    asserted alongside it and stays at exactly ONE — restart's, the only permitted
    teardown in the tree — which is what proves the two closes did not regrow it.
    (The single shared `_make` fake is both stale and fresh here, so all four
    teardowns land on the one counter; the stale-vs-fresh separation is pinned by
    `test_restart_closes_the_stale_socket_and_leaves_the_fresh_one_open`.)"""
    connect, fake, _record = _make({})
    client = Mt5Client("host", 18812, _connect=connect)
    conn = fake._MetaTrader5__conn

    client.close()
    assert conn.close_calls == 1  # close() released our socket
    assert fake.shutdown_calls == 0  # …and reached shutdown ZERO times (D-35)
    client.restart()
    assert fake.shutdown_calls == 1  # restart's own — the ONE permitted teardown
    assert conn.close_calls == 2  # restart also disposes the stale socket
    client.close()
    assert conn.close_calls == 3  # _closed was cleared → close() works again
    assert fake.shutdown_calls == 1  # still exactly restart's, and only restart's


# -- order_check: probe only (investor-vs-master signal is a live unknown) ----


def test_order_check_none_raises_via_last_error():
    """order_check() None is an error -> typed raise carrying last_error() code."""
    connect, _fake, _rec = _make(
        {"order_check": None, "last_error": (7, "no connection")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.order_check({"action": 0})
    assert exc_info.value.code == 7


def test_order_check_materializes_result():
    """order_check() netref -> native dict with retcode/comment intact.

    The EXACT investor-vs-master retcode is [ASSUMED] until MT5SPIKE-01 leg 2 runs
    live: the client only exposes the materialized probe result. The decision rule
    is a Phase 135 call-site concern combining order_check retcode/comment with
    account_info().trade_allowed — NEVER a call to the trade path.
    """
    connect, _fake, _rec = _make(
        {"order_check": _FakeNamedTuple(retcode=10027, comment="Trade disabled")}
    )
    client = Mt5Client("host", 18812, _connect=connect)
    result = client.order_check({"action": 0})
    assert isinstance(result, dict)
    assert result["retcode"] == 10027
    assert result["comment"] == "Trade disabled"


# -- structural read-only surface guards -------------------------------------


@pytest.mark.parametrize(
    "forbidden",
    [
        "order_send",
        "order_send_async",
        "positions_get",
        "orders_get",
        "positions_total",
        "orders_total",
        "history_orders_get",
        "copy_rates_from",
        "symbol_info_tick",
        "initialize",
    ],
)
def test_read_only_surface_no_trade_methods(forbidden):
    """Read-only by CONSTRUCTION: no trade/raw-surface method may exist on the
    class. mt5linux exposes the full trading surface; a trade method appearing here
    is a trust-integrity footgun for the whole `api_verified` value prop."""
    assert not hasattr(Mt5Client, forbidden)


def test_no_getattr_passthrough():
    """No __getattr__ passthrough: a generic attribute-forwarding facade would
    silently re-expose the full mt5linux surface, including the trade path."""
    assert "__getattr__" not in vars(Mt5Client)


def test_public_surface_is_exactly_the_contract():
    """The public callable surface is EXACTLY the contract. Any accidental widening
    (a new public method wrapping the mt5linux surface) fails loud here."""
    public = {
        name
        for name in vars(Mt5Client)
        if not name.startswith("_") and callable(getattr(Mt5Client, name))
    }
    assert public == {
        "login",
        "account_info",
        # terminal_info (153.3 / D-31) is a READ of the terminal we operate — it
        # carries no user credential and wraps no trade path, so the read-only-by-
        # construction property is unchanged by its addition.
        "terminal_info",
        "history_deals_get",
        "order_check",
        "close",
        # release (153.3 / D-30) is a TEARDOWN verb, not a widening of the MT5
        # surface: it closes our own rpyc socket and wraps no mt5linux call at all.
        "release",
        "restart",
        # 164.6.2 / D-07 — the two SESSION verbs. Both wrap `initialize()` and
        # NOTHING else, so the read-only-by-construction property is unchanged:
        # `initialize` attaches the IPC pipe / authorizes an account, it is not a
        # read and it is emphatically not the trade path. They are named
        # `assert_session_authorized` / `initialize_with_credentials` and NOT
        # `initialize`, which `test_read_only_surface_no_trade_methods` forbids as a
        # raw-surface attribute — that prohibition is untouched and still bites.
        "assert_session_authorized",
        "initialize_with_credentials",
        # 164.6.5 / D-05 — the TERMINAL-PROCESS recycle. It wraps no mt5linux
        # trade or read surface: it ends the terminal process through ONE
        # committed remote constant and relaunches it with the same bare
        # `initialize()` the detector above uses. Named apart from `restart`,
        # which reconnects the rpyc SOCKET and never touches the terminal.
        "recycle_terminal_process",
    }


# --------------------------------------------------------------------------- #
# 153.3 / D-32 — PER-STAGE TIMING: stage + duration_ms, on BOTH outcomes
#
# WHY these matter (Rule 9). This client contained NO clock. Nine correlated
# production failures (2026-08-06/08) were all right-censored at the rpyc
# ceiling, and not one SUCCESSFUL stage duration has ever been recorded anywhere
# — which is why the whole validate chain is a judgement call rather than a
# measurement (D-27). An instrument that emits nothing looks EXACTLY like one
# that was never wired, so every case below asserts on the captured event and its
# VALUE, never on the presence of a call.
#
# The event NAME and the nine stage names are hand-typed here on purpose: they
# are the aggregation key Phase 155 will group by, and an oracle that imported
# them from the module under test could not fail a rename.
# --------------------------------------------------------------------------- #

_STAGE_EVENT_NAME = "mt5.stage"


def _stage_events(captured, stage=None):
    """The captured `mt5.stage` events, optionally filtered to one stage."""
    events = [e for e in captured if e.get("event") == _STAGE_EVENT_NAME]
    if stage is not None:
        events = [e for e in events if e.get("stage") == stage]
    return events


def test_a_successful_read_emits_stage_and_a_real_duration():
    """A successful round-trip emits `stage` + a non-negative integer
    `duration_ms` — and the number is a MEASUREMENT, not a placeholder.

    The read is made to take ~30ms so the assertion can be `>= 20`, not
    `>= 0`. A `duration_ms` hard-wired to zero (a mis-scaled unit, a clock read
    twice at the same instant, an emitter that never sees the call) satisfies
    "a duration field is present" and is worth nothing to Phase 155.
    """
    connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=1000.0)})
    client = Mt5Client("mt5-gw.internal", 18812, _connect=connect)

    def _slow_account_info():
        time.sleep(0.03)
        return _FakeNamedTuple(equity=1000.0)

    fake.account_info = _slow_account_info

    with capture_logs() as captured:
        assert client.account_info() == {"equity": 1000.0}

    events = _stage_events(captured, "account_info")
    assert len(events) == 1, f"expected exactly one account_info event: {captured}"
    event = events[0]
    assert event["ok"] is True
    assert isinstance(event["duration_ms"], int)
    assert event["duration_ms"] >= 20, (
        "the emitted duration does not track real elapsed time — a ~30ms read "
        f"reported {event['duration_ms']}ms"
    )
    # Infrastructure identity only: the lock key, never a user value.
    assert event["terminal_key"] == "mt5-gw.internal:18812"


def test_a_failing_read_emits_its_event_and_reraises_the_identical_error():
    """⭐ THE assertion that catches instrumentation swallowing an error.

    Two independent failure modes are covered, and both are silent:
      * a bracket that only emits on success measures a population that EXCLUDES
        exactly the failures the timing exists to explain (the nine censored
        production logins were all failures);
      * a bracket that catches the exception to emit, and then re-raises a
        DIFFERENT one — or converts it — changes the caller's verdict. The
        router classifies on `Mt5ClientError.code`; a changed type silently
        re-routes a transient into an auth failure.

    The expected message is HAND-TYPED, not rebuilt from `Mt5ClientError`, so a
    conversion that produced a consistent-but-different string cannot pass.
    """
    connect, _fake, _rec = _make(
        {"account_raises": RuntimeError("rpyc connection closed by peer")}
    )
    client = Mt5Client("mt5-gw.internal", 18812, _connect=connect)

    with capture_logs() as captured:
        with pytest.raises(Mt5ClientError) as exc_info:
            client.account_info()

    assert type(exc_info.value) is Mt5ClientError
    assert exc_info.value.code == 0
    assert str(exc_info.value) == (
        "MT5 client error (code=0): rpyc connection closed by peer"
    )

    events = _stage_events(captured, "account_info")
    assert len(events) == 1, f"the FAILING stage emitted no event: {captured}"
    assert events[0]["ok"] is False
    # The raw transport class, not the uniform Mt5ClientError every failure would
    # otherwise report — this is what makes a censor separable from a fast error.
    assert events[0]["error_class"] == "RuntimeError"
    assert isinstance(events[0]["duration_ms"], int)


def test_every_mt5_round_trip_emits_its_stage_event():
    """Every one of the TEN MT5 round-trips emits — asserted by driving each
    method against the double and comparing the collected stage names to a
    hand-typed set.

    ⭐ `history_deals_materialize` is the tenth, and it is here because it was
    MISSING for a whole phase: the per-deal materialization was untimed, so the 30s
    it burned on the live gateway appeared in no event and the only visible symptom
    was a 40s outer timeout with every stage reporting `ok=true` (MT5DEAL-01).

    ⛔ The expected set is typed out here rather than read from
    `services.mt5_client`: an oracle that derives its expectation from the thing
    under test cannot fail, and "add the method, forget the bracket" is precisely
    the omission this case exists to catch.
    """
    connect, fake, _rec = _make(
        {
            "account": _FakeNamedTuple(login=123456, equity=1000.0),
            "terminal": _FakeNamedTuple(connected=True, trade_allowed=True),
            "deals": (),
            "order_check": _FakeNamedTuple(retcode=10017),
        }
    )
    client = Mt5Client("mt5-gw.internal", 18812, _connect=connect)
    # close() and release() BOTH latch `_closed`, so one instance can exercise
    # only one of them — the second client is what makes close() reachable.
    closer = Mt5Client("mt5-gw.internal", 18812, _connect=connect)

    with capture_logs() as captured:
        client.login(123456, "investor-pw", "Broker-Demo")  # initialize + login
        client.account_info()
        client.terminal_info()
        client.history_deals_get(0, 1)
        client.order_check({"action": 0})
        client.restart()  # clears _closed, so release() below is still reachable
        client.release()
        closer.close()

    assert {e["stage"] for e in _stage_events(captured)} == {
        "initialize",
        "login",
        "account_info",
        "terminal_info",
        "history_deals_get",
        "history_deals_materialize",
        "order_check",
        "close",
        "release",
        "restart",
    }
    # Not vacuous: every event carries the two fields the whole exercise is for.
    for event in _stage_events(captured):
        assert isinstance(event["duration_ms"], int)
        assert event["duration_ms"] >= 0
        assert event["ok"] is True


def test_the_last_error_round_trip_is_timed_too():
    """`last_error()` is itself a full remote round-trip, taken AFTER the verdict
    is already known — EVIDENCE §1b records a failed attempt paying a SECOND full
    30s there. Un-timed, every failure looks like ONE round-trip and the failure
    budget reads half its true size.

    Note the account_info event is `ok=True`: a `None` RETURN is an honest,
    completed round-trip (the error is discovered afterwards, by the return
    discipline). Conflating the two would misreport the transport's latency.
    """
    connect, _fake, _rec = _make(
        {"account": None, "last_error": (-10004, "No IPC connection")}
    )
    client = Mt5Client("mt5-gw.internal", 18812, _connect=connect)

    with capture_logs() as captured:
        with pytest.raises(Mt5ClientError) as exc_info:
            client.account_info()

    assert exc_info.value.code == -10004
    assert [e["stage"] for e in _stage_events(captured)] == [
        "account_info",
        "last_error",
    ]
    assert _stage_events(captured, "account_info")[0]["ok"] is True
    assert isinstance(_stage_events(captured, "last_error")[0]["duration_ms"], int)


def test_no_credential_literal_reaches_any_stage_event():
    """⭐ T-153.3-23 — the secret sweep over the NEW telemetry surface.

    `mt5linux` f-string-interpolates the investor password into the remotely
    eval'd source, so a leaked exception STRING is a real credential disclosure —
    which is why the event carries the exception CLASS and never its message.

    THREE outcomes are swept, because they reach three different emission paths
    and only one of them is the obvious one:
      * a successful login — the credential values are live in scope;
      * a REFUSED login (a falsy return) — the `last_error` text is in scope;
      * a login whose transport RAISES with the interpolated remote source in
        the message. This is the one that matters: it is the ONLY path that
        emits `error_class`, so a sweep without it never exercises the failure
        emission at all and stays green while an `error_text` field is added.
    """
    connect, _fake, _rec = _make(
        {"account": _FakeNamedTuple(equity=1.0), "last_error": (-6, "authorization failed")}
    )
    client = Mt5Client("mt5-gw.internal", 18812, _connect=connect)
    refusing_connect, _f2, _r2 = _make(
        {"login": False, "last_error": (-6, "authorization failed for 123456")}
    )
    refusing = Mt5Client("mt5-gw.internal", 18812, _connect=refusing_connect)
    # The real disclosure vector: mt5linux builds the remote call as SOURCE TEXT
    # with the password interpolated, so a remote traceback carries it verbatim.
    raising_connect, _f3, _r3 = _make(
        {
            "login_raises": RuntimeError(
                "remote eval failed: mt5.login(123456, "
                "password='s3cr3t-pw', server='MyBroker-Live')"
            )
        }
    )
    raising = Mt5Client("mt5-gw.internal", 18812, _connect=raising_connect)

    with capture_logs() as captured:
        client.login(123456, "s3cr3t-pw", "MyBroker-Live")
        client.account_info()
        with pytest.raises(Mt5ClientError):
            refusing.login(123456, "s3cr3t-pw", "MyBroker-Live")
        with pytest.raises(Mt5ClientError):
            raising.login(123456, "s3cr3t-pw", "MyBroker-Live")

    events = _stage_events(captured)
    assert events, "the sweep is vacuous — no stage event was captured at all"
    # Not vacuous in the direction that matters: the FAILURE emission ran.
    assert any(e.get("ok") is False for e in events), (
        "no failed-stage event was captured — the sweep never reaches the "
        "emission path that carries exception information"
    )
    rendered = repr(events)
    for literal in ("123456", "s3cr3t-pw", "MyBroker-Live", "authorization failed"):
        assert literal not in rendered, (
            f"a credential (or raw last_error text) reached the telemetry: {literal!r}"
        )


def test_stage_telemetry_failure_never_changes_what_the_caller_observes(
    monkeypatch, caplog
):
    """T-153.3-24 — a broken logging pipeline must not turn a successful terminal
    read into a failed validate. Instrumentation is an ADDITION; it may never be
    load-bearing for the request's verdict.

    It must also not fail SILENTLY: an emitter that swallows its own breakage
    leaves Phase 155 reading an empty histogram and concluding "no traffic".
    """

    class _BrokenLog:
        def info(self, *_a, **_k):
            raise RuntimeError("log pipeline down")

    monkeypatch.setattr(mt5_client_mod, "_stage_logger", lambda: _BrokenLog())
    connect, _fake, _rec = _make({"account": _FakeNamedTuple(equity=1000.0)})
    client = Mt5Client("mt5-gw.internal", 18812, _connect=connect)

    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        assert client.account_info() == {"equity": 1000.0}

    assert any(
        "stage telemetry failed to emit" in r.message for r in caplog.records
    ), "the emitter swallowed its own failure silently"


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON / D-36 — THE ABANDONED-SESSION FENCE AT THE SINK
#
# WHY these matter (Rule 9). `asyncio.to_thread` work is NEVER cancelled: when
# the caller's `wait_for` fires it unwinds and RELEASES the terminal lease while
# the abandoned thread keeps driving the SAME process-global MT5 session — now
# under the NEXT holder's lease. The economic harm is not "an exception was not
# raised"; it is a touch LANDING on somebody else's terminal. Every case below is
# therefore oracled on the FAKE'S RECORDED CALL LOG — "no post-release session
# call landed" — never on the exception type alone. That oracle stays true if
# `Mt5SessionAbandoned` is renamed or re-typed, and it goes false the moment a
# touch lands, which is the harm itself.
# --------------------------------------------------------------------------- #

_TERMINAL_HOST = "mt5-gw.internal"
_TERMINAL_PORT = 18812


def _recording_account_info(fake, touches):
    """Wrap the double's `account_info` so every session touch is RECORDED.

    `_FakeMt5` logs login/initialize/order_check calls but not `account_info`, and
    the whole oracle here is "did a second touch land". Wrapping (rather than
    replacing) preserves the scenario's configured return value.
    """
    original = fake.account_info

    def _recorded():
        touches.append("account_info")
        return original()

    fake.account_info = _recorded


def test_a_touch_after_the_lease_released_is_refused_and_never_reaches_the_terminal(
    caplog,
):
    """⭐ THE FENCE (D-36 (i)). A session touch made after the lease that owned this
    session released must NOT reach the terminal.

    The oracle is the double's call log, not the raise: a fence that raised AFTER
    forwarding the call would satisfy `pytest.raises` while doing the exact damage
    it exists to prevent (a zombie thread reading another holder's account).
    """
    connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=1000.0)})
    touches: list[str] = []
    _recording_account_info(fake, touches)
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    # The FIRST touch happens under the lease that owns this session — it binds.
    assert client.account_info() == {"equity": 1000.0}
    assert touches == ["account_info"]

    # ...the caller's wait_for fires, it unwinds, and the lease releases.
    bump_mt5_terminal_epoch(client.terminal_key)

    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        with pytest.raises(Mt5SessionAbandoned):
            client.account_info()

    assert touches == ["account_info"], (
        "a session touch landed on the terminal AFTER the lease released — the "
        "zombie is driving the next holder's session, which is the entire defect"
    )
    # D-39: the raise alone is NOT loud. `asyncio.futures._copy_future_state`
    # returns early when the destination future is cancelled, so on the abandoned
    # path the exception reaches nobody and the WARNING is the only signal an
    # operator ever sees.
    assert any(
        "WIZFORM-ABANDON" in r.getMessage()
        for r in caplog.records
        if r.levelname == "WARNING"
    ), (
        "the fence refused silently — with the destination future cancelled the "
        "raise is discarded, so an unlogged refusal is invisible (D-39)"
    )


def test_a_preflight_built_client_binds_lazily_and_is_not_falsely_refused():
    """⭐ THE TEST THAT PROVES THE LAZY-BIND DECISION (D-36 AMENDED).

    `job_worker._make_mt5_session` builds its client in PREFLIGHT — outside and
    BEFORE the lease. If the generation were stamped at CONSTRUCTION, an unrelated
    lease releasing in that window would leave the fresh client permanently stale
    and refuse a perfectly legitimate derive read. Binding on FIRST TOUCH costs no
    fencing power (every zombie's first touch happened under the lease that later
    released) and removes the false positive STRUCTURALLY rather than by an
    opt-out list somebody maintains.
    """
    connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=7.0)})
    touches: list[str] = []
    _recording_account_info(fake, touches)
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    # Somebody ELSE's lease on the same terminal releases between the preflight
    # build and this client's first use.
    bump_mt5_terminal_epoch(client.terminal_key)

    assert client.account_info() == {"equity": 7.0}
    assert touches == ["account_info"], (
        "an eagerly-bound generation refused a legitimate preflight-built client"
    )


async def test_one_client_per_lease_acquisition_is_the_shape_the_lazy_bind_assumes():
    """⚠️ A **LATENT CONSTRAINT** of the lazy bind, pinned. NOT a defect today.

    `self._epoch` binds on the FIRST touch and **never rebinds**. That is what
    makes the preflight case above work, and it carries a constraint nobody wrote
    down: a single `Mt5Client` instance used under **two** lease acquisitions is
    refused on the second, because its epoch is still the FIRST lease's and the
    release in between bumped the generation. The holder would be entirely
    legitimate — it took the lease, it owns the terminal — and it would read a
    `Mt5SessionAbandoned` whose message says the lease it operated under has
    ended. Classified as transient (D-40), that is a permanent-looking retry loop.

    ⭐ **No production path does this** (checked by ast at the 153.5 verification:
    all five `mt5_terminal_lease` blocks hold exactly one lease per client
    instance). So the constraint is satisfied today by accident of structure, and
    this test is the pin that makes the accident deliberate — the half a future
    reader needs when a refusal appears on a path that plainly held the lease.

    The two halves are one control, one variable:
      * the PRODUCTION shape — a fresh client per acquisition — is never refused;
      * the REUSE shape — one client across two acquisitions — is refused, and the
        refusal is the confusing one described above.

    ⛔ **Do NOT "fix" this by changing the bind semantics.** Re-binding at
    construction is the design RESEARCH §Open Q-1 rejected (it false-positives the
    preflight build). If a call site ever legitimately needs to reuse a client
    across leases, the fix is to **rebind on LEASE ENTRY** — a new, deliberate
    mechanism the lease would have to drive — never to weaken `_assert_live`. The
    structural half ("no production function holds two leases") is pinned in
    `tests/test_mt5_concurrency.py`.
    """
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"

    # -- The PRODUCTION shape: one client per lease acquisition. ---------------
    for acquisition in (1, 2):
        async with mt5_concurrency.mt5_terminal_lease(key):
            connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=1.0)})
            touches: list[str] = []
            _recording_account_info(fake, touches)
            fresh = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

            try:
                equity = fresh.account_info()
            except Mt5SessionAbandoned:
                # The failure path is the WHOLE point of this pin, so it must be
                # legible rather than a bare exception: a reader arriving here is
                # almost certainly holding a REUSED client.
                pytest.fail(
                    f"a client built inside its OWN lease (acquisition "
                    f"{acquisition} of 2) was refused. Either a call site now "
                    f"reuses ONE Mt5Client across TWO lease acquisitions — the "
                    f"lazy bind never rebinds, so the second is falsely refused "
                    f"(W-153.5-3) — or the bind semantics changed. This is the "
                    f"shape every production call site uses, so it is a live "
                    f"outage on the derive, holdings, validate and adapter paths. "
                    f"⛔ The remedy for a genuine reuse is to REBIND ON LEASE "
                    f"ENTRY, never to weaken `_assert_live`."
                )
            assert equity == {"equity": 1.0}
            assert touches == ["account_info"]

    # -- The REUSE shape: the latent trap, so it cannot change silently. -------
    connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=2.0)})
    reused = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    async with mt5_concurrency.mt5_terminal_lease(key):
        assert reused.account_info() == {"equity": 2.0}  # binds THIS generation

    reuse_touches: list[str] = []
    _recording_account_info(fake, reuse_touches)

    async with mt5_concurrency.mt5_terminal_lease(key):
        with pytest.raises(Mt5SessionAbandoned) as excinfo:
            reused.account_info()

    assert reuse_touches == [], (
        "the reused client's second-lease touch REACHED the terminal. That would "
        "mean the lazy bind had started rebinding — which is a design change "
        "(rebind on lease entry), not a warning closure. If that is intended, it "
        "must be driven by the lease and this pin re-cut deliberately"
    )
    assert excinfo.value.stage == "account_info"


def test_close_still_tears_down_the_transport_on_a_stale_client():
    """D-41 — `close()` is EXEMPT from the fence and must STAY reachable.

    Since D-35 it touches only OUR OWN rpyc socket. Fencing it would strand that
    socket on precisely the abandoned path, reintroducing the Pitfall-6 leak
    `routers/exchange.py:899-948` exists to prevent — the fix causing the bug it
    is fixing.
    """
    connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=1.0)})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    client.account_info()  # bind the generation
    bump_mt5_terminal_epoch(client.terminal_key)

    client.close()  # must NOT raise

    assert fake._MetaTrader5__conn.close_calls == 1, (
        "a stale client could not close its own socket — the fence leaked the "
        "transport it was supposed to protect (D-41 / Pitfall 6)"
    )


def test_release_still_tears_down_the_transport_on_a_stale_client():
    """D-41, the other exempt teardown name. A separate client because `close()`
    latches `_closed`, so a `release()` after it would be a structural no-op and
    could observe nothing."""
    connect, fake, _rec = _make({"account": _FakeNamedTuple(equity=1.0)})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    client.account_info()  # bind the generation
    bump_mt5_terminal_epoch(client.terminal_key)

    client.release()  # must NOT raise

    assert fake._MetaTrader5__conn.close_calls == 1, (
        "a stale client could not release its own socket (D-41 / Pitfall 6)"
    )


def test_session_abandoned_cannot_be_absorbed_into_a_credential_verdict():
    """STRUCTURAL (D-42), per the `Mt5TerminalBusyError` /
    `_Mt5PostReadVerificationError` precedent: the classify/stamp arms match on
    `Mt5ClientError`. If `Mt5SessionAbandoned` subclassed it, OUR abandoned thread
    could be classified as the USER's `auth` / `wrong_server` failure and a working
    key blamed for our own timeout."""
    assert issubclass(Mt5SessionAbandoned, Exception)
    assert not issubclass(Mt5SessionAbandoned, Mt5ClientError)
    # The stage survives as an ATTRIBUTE — which is what makes keeping it out of
    # the message costless for the callers that route on it.
    assert Mt5SessionAbandoned("account_info").stage == "account_info"


@pytest.mark.parametrize(
    "stage",
    [
        "login",
        "account_info",
        "terminal_info",
        "history_deals_get",
        "order_check",
        "last_error",
        "restart",
        "connect",
        # 164.6.2 — the two new fenced stages. Added because this case's own
        # docstring claims the property holds "for EVERY stage name the fence can
        # carry", and a roster that silently stopped enumerating them would make
        # that sentence false. Both are near-misses by construction:
        # `session_authorized` contains `auth`, `initialize_credentialed` contains
        # `credential` — exactly the shape D-42 exists to keep OUT of the message.
        "session_authorized",
        "initialize_credentialed",
    ],
)
def test_session_abandoned_message_carries_no_classifier_token(stage):
    """D-42 — the refusal message must classify BLAME-FREE through
    `classify_mt5_login_error`, for EVERY stage name the fence can carry.

    A message the classifier RECOGNISES becomes a permanent user-attributed
    verdict, and the fenced stage names are the natural near-misses: before
    164.5.4 the tables held bare words and `terminal_info`/`connect`/`login`/
    `account_info` were literally members. An exception message that interpolated
    its stage — the obvious, natural way to write it — would re-run the documented
    `routers/exchange.py:678-684` incident, where an operator-side refusal became
    a 400 telling the user their BROKER SERVER was wrong.

    ⚠️ The verdict is taken from the LIVE seam in `services/mt5_validation.py` on
    purpose. The invariant is safety against whatever the classifier actually does
    TODAY; a hand-copied table would go stale and stay green while the real
    classifier changed. It is not self-referential — the seam lives in a DIFFERENT
    module from the one under test.

    ⭐ 164.5.4 — this asserted SUBSTRING-ABSENCE from the live tables until the
    anchored-phrase rewrite, which would have left the loop trivially green while
    measuring nothing. It now runs the real seam and demands `"transient"`, the
    only class that carries no blame. Strictly stronger, and it cannot be
    vacuated by a future reshape of the tables.
    """
    from services.mt5_client import Mt5ClientError
    from services.mt5_validation import (
        _AUTH_PHRASES,
        _WRONG_SERVER_PHRASES,
        classify_mt5_login_error,
    )

    # Non-empty tables, or a "transient" verdict proves only that the classifier
    # had nothing to match on.
    assert _WRONG_SERVER_PHRASES and _AUTH_PHRASES
    message = str(Mt5SessionAbandoned(stage))
    assert len(message) > 40, "the refusal message is too short to be the real copy"
    # Code 0 so `_IPC_TRANSPORT_CODES` cannot answer for the text.
    verdict = classify_mt5_login_error(Mt5ClientError(0, message))
    assert verdict == "transient", (
        f"the refusal message for stage {stage!r} classifies {verdict!r} — a "
        "fenced zombie would be classified as the USER's credential failure and a "
        "working key blamed for our abandoned thread (the "
        "routers/exchange.py:678-684 incident)"
    )


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON — FINDING #5: THE FENCED restart()
#
# WHY these matter (Rule 9). `Mt5Client.restart()` carries the ONE surviving
# `mt5.shutdown()` in the tree, and `mt5linux` serves EVERY rpyc connection from
# ONE `ThreadedServer` over ONE `MetaTrader5` instance holding ONE IPC pipe. A
# shutdown from a restart whose caller (`_mt5_bounded_restart`) already abandoned
# it at the ~10s bound therefore destroys the pipe for the NEXT holder, who
# observes `-10004 No IPC connection` — a cross-tenant outage minted by our own
# recovery path.
#
# ⭐ AN ENTRY CHECK ALONE CANNOT CLOSE THIS. The legitimate heal runs INSIDE the
# lease, so at entry the generation is always current and the check passes
# trivially; the damage happens LATER, when the bound fires mid-reconnect and the
# lease releases while the zombie is still inside the closure. The load-bearing
# check is the SECOND one, immediately before `stale.shutdown()`.
#
# ⚠️ Three cleanup invariants interact on the fenced path and no pre-153.5 case
# covered them together — skipping the shutdown must not skip the stale SOCKET
# close, the `_closed = False` cleared by the WR-01 swap must be restored, and the
# FRESH connection the WR-01 reconnect just opened must be disposed because nobody
# is left to receive it. Miss any one and the fence trades one leak for another.
# --------------------------------------------------------------------------- #


def test_a_restart_abandoned_mid_reconnect_never_reaches_the_shared_shutdown(caplog):
    """⭐ FINDING #5, and the case the plausible half-fix (entry check only) fails.

    The abandonment is scheduled DETERMINISTICALLY — no threads, no sleeps: the
    injected `_connect` seam bumps the generation as its side effect, which is
    exactly "the caller's `wait_for` fired and its lease released while this
    reconnect round-trip was in flight".

    All three cleanup invariants are asserted TOGETHER, deliberately: each one
    alone is satisfiable by an implementation that leaks one of the other two.
    """
    stale = _FakeMt5({})
    fresh = _FakeMt5({})
    conns: dict[str, int] = {"n": 0}
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"

    def _connect(*, host, port, timeout):
        conns["n"] += 1
        if conns["n"] == 1:
            return stale
        # ⭐ THE ABANDONMENT, scheduled by the test: the bounded caller gave up on
        # this restart and its lease released while the reconnect was in flight.
        bump_mt5_terminal_epoch(key)
        return fresh

    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_connect)

    # ⚠️ The refusal is CAPTURED rather than wrapped in `pytest.raises`, so the
    # EFFECT-based oracles below run on every implementation. Under the plausible
    # half-fix (entry check only) a `pytest.raises` wrapper reds first, on the
    # exception type — which is not the harm. The harm is a shutdown LANDING, and
    # assertion (a) is what must fail.
    refusals: list[BaseException] = []
    with caplog.at_level("WARNING", logger="quantalyze.analytics"):
        try:
            client.restart()
        except Mt5SessionAbandoned as exc:  # noqa: PERF203 — one call, not a loop
            refusals.append(exc)

    # (a) THE HARM ITSELF — the shared IPC pipe was never destroyed under whoever
    # holds the terminal now. This is the assertion an entry-check-only fix fails.
    assert stale.shutdown_calls == 0, (
        "an abandoned restart still issued the ONE permitted mt5.shutdown() — it "
        "destroys the single shared IPC pipe for the NEXT holder (-10004), which "
        "is finding #5 in full"
    )
    # (b) ...yet OUR OWN sockets are always ours to close (D-35). Skipping the
    # shared shutdown must not skip the stale socket close.
    assert stale._MetaTrader5__conn.close_calls == 1, (
        "the fenced path skipped the stale SOCKET close along with the shutdown — "
        "trading a cross-tenant outage for a socket leak"
    )
    # (c) ...including the fresh connection WR-01 forces us to open first, which on
    # this path is dead weight nobody will ever receive.
    assert fresh._MetaTrader5__conn.close_calls == 1, (
        "the WR-01 reconnect's FRESH socket was left open on the abandoned path — "
        "a NEW leak introduced by the fence itself"
    )
    # (d) ...and the latch cleared by the swap is restored, or a client its caller
    # already gave up on is left latched-open and `close()` no-ops forever.
    assert client._closed is True, (
        "`_closed` was left False on the abandoned path — `aclose_exchange`'s "
        "close() (exempt from the fence, and possibly already run) can never "
        "close this transport again"
    )
    # (e) D-39 — the raise alone is discarded by asyncio when the destination
    # future is cancelled, which on this path it always is. The WARNING is the
    # only signal an operator ever sees, and it must name what was SKIPPED.
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any(
        "WIZFORM-ABANDON" in m and "shutdown" in m for m in warnings
    ), (
        "the fenced restart skipped the shared shutdown SILENTLY — with the "
        f"destination future cancelled the raise reaches nobody (D-39). Got: {warnings}"
    )
    # (f) ...and it refuses rather than returning as if it had healed anything —
    # asserted LAST, because the type is the least load-bearing of the six.
    assert refusals, "the fenced restart returned normally instead of refusing"


def test_a_fence_refusal_emits_no_stage_event_while_a_real_failure_still_does():
    """⭐ 153.6 / B3 — the telemetry contract, made STRUCTURAL at the sink.

    `restart()`'s check 2 is the one fence that raises from INSIDE the `_timed`
    bracket, and it has to: three cleanup steps must run before the raise, so it
    is written inline rather than via `_assert_live` (which raises at once and
    would strand two sockets). `_timed`'s `except BaseException` therefore emitted
    an `mt5.stage restart` event for a restart that DELIBERATELY DID NOTHING.

    WHY THAT IS THE BUG (Rule 9 — the economics). `mt5.stage` `duration_ms` is the
    recovery-latency population Phase 155 reads to decide what a wedged terminal
    costs us. A refusal is not a round-trip; it is a near-zero-duration non-call.
    Feeding refusals into that population drags the measured recovery latency
    toward zero exactly when abandonment is most frequent — the census says
    recovery is cheap precisely because it never happened. `_assert_live`'s
    docstring already writes this contract down for the fences that sit outside
    the bracket (⛔ "If a COUNT is ever wanted it needs a distinct event name");
    the arm under test extends it to the one that cannot.

    ⛔ THE POSITIVE CONTROL IS NOT OPTIONAL, and it is asserted on the SAME stage
    through the SAME bracket. "No abandon event was emitted" is satisfied
    perfectly by a `_timed` that emits nothing at all — the guard would then be
    certifying that the instrument had been switched off. The second half drives a
    GENUINE reconnect failure and demands its `ok=False` event, so only the fence
    type can be suppressed.
    """
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"

    # ── HALF 1: the abandoned restart, the one fence inside the bracket ──────
    stale = _FakeMt5({})
    fresh = _FakeMt5({})
    conns: dict[str, int] = {"n": 0}

    def _connect(*, host, port, timeout):
        conns["n"] += 1
        if conns["n"] == 1:
            return stale
        # ⭐ THE ABANDONMENT, scheduled by the test exactly as the sibling case
        # above schedules it: the bounded caller gave up on this restart and its
        # lease released while the reconnect round-trip was in flight.
        bump_mt5_terminal_epoch(key)
        return fresh

    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_connect)

    with capture_logs() as refused:
        with pytest.raises(Mt5SessionAbandoned) as ei:
            client.restart()

    # Non-vacuity: the reconnect really ran, so the refusal below is check 2
    # firing mid-bracket rather than the entry check refusing before any I/O.
    assert conns["n"] == 2, "the reconnect never happened — nothing was in the bracket"

    # ⭐ THE CONTRACT, stated over EVERY stage rather than over `restart`. The
    # class name is hand-typed: an oracle importing it from the module under test
    # could not fail a rename.
    abandon_events = [
        e for e in _stage_events(refused)
        if e.get("error_class") == "Mt5SessionAbandoned"
    ]
    assert abandon_events == [], (
        "a fence REFUSAL was recorded as an mt5.stage round-trip "
        f"({abandon_events}). It is a near-zero-duration non-call, and it enters "
        "the D-32 duration_ms population Phase 155 reads for recovery latency — "
        "so the census reports recovery as cheap precisely on the runs where it "
        "never happened (B3). If a COUNT of refusals is ever wanted it needs a "
        "DISTINCT event name, exactly as _assert_live's docstring says."
    )
    assert _stage_events(refused, "restart") == [], (
        "the refused restart emitted a `restart` stage event of some other shape "
        "— the suppression must be the whole event, not merely the error_class"
    )
    # ...and the exception escapes UNCHANGED (the `_timed` docstring's ⛔).
    assert type(ei.value) is Mt5SessionAbandoned
    assert ei.value.stage == "restart"

    # ── HALF 2: the fences that already sit OUTSIDE the bracket stay silent ──
    # `_assert_live` refuses ahead of `_timed`, so no event is emitted today
    # either. Asserted anyway: the contract is "no stage event EVER carries this
    # class", and a future refactor that moved a fence inside the bracket would
    # otherwise reintroduce B3 on a stage nobody was watching.
    connect2, fake2, _rec2 = _make({"account": _FakeNamedTuple(equity=1.0)})
    client2 = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect2)
    client2.account_info()  # binds the generation
    bump_mt5_terminal_epoch(client2.terminal_key)  # ...the lease releases

    with capture_logs() as fenced_read:
        with pytest.raises(Mt5SessionAbandoned):
            client2.account_info()

    assert [
        e for e in _stage_events(fenced_read)
        if e.get("error_class") == "Mt5SessionAbandoned"
    ] == [], "a method-fence refusal reached the D-32 population"

    # ── HALF 3: THE POSITIVE CONTROL — same stage, same bracket, real failure ──
    boom = RuntimeError("rpyc connection refused by peer")
    stale3 = _FakeMt5({})
    conns3: dict[str, int] = {"n": 0}

    def _connect3(*, host, port, timeout):
        conns3["n"] += 1
        if conns3["n"] == 1:
            return stale3
        raise boom  # a GENUINE reconnect failure, not a fence refusal

    client3 = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_connect3)

    with capture_logs() as failed:
        with pytest.raises(RuntimeError):
            client3.restart()

    restart_events = _stage_events(failed, "restart")
    assert len(restart_events) == 1, (
        "a REAL restart failure stopped emitting its stage event "
        f"({failed}). The B3 suppression must be keyed on the fence TYPE alone; "
        "widened to every exception it silently deletes the failure half of the "
        "recovery-latency population — the censored measurement D-32 exists to "
        "replace."
    )
    assert restart_events[0]["ok"] is False
    assert restart_events[0]["error_class"] == "RuntimeError"
    assert isinstance(restart_events[0]["duration_ms"], int)


def test_a_restart_already_abandoned_at_entry_refuses_before_any_io():
    """The entry check is not the load-bearing one, but it is not decorative: an
    already-abandoned restart must not open a socket nobody will ever close.

    Oracle is the connect COUNT on the seam — "no fresh transport was built" —
    not the exception type.
    """
    connect, fake, record = _make({"account": _FakeNamedTuple(equity=1.0)})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    client.account_info()  # first touch binds the generation, under the lease
    assert record["connects"] == 1

    bump_mt5_terminal_epoch(client.terminal_key)  # ...the lease releases

    with pytest.raises(Mt5SessionAbandoned):
        client.restart()

    assert record["connects"] == 1, (
        "an already-abandoned restart opened a FRESH rpyc socket that nobody will "
        "ever close — refusal must precede any I/O"
    )
    assert fake.shutdown_calls == 0


def test_a_live_restart_under_a_current_generation_is_unchanged_by_the_fence():
    """⭐ THE REGRESSION HALF. The legitimate heal (MT5CONC-01) runs INSIDE the
    lease, and an exclusive per-terminal lock means the generation cannot move
    while it is held — so a restart that completes within its bound must be
    byte-equivalent to its pre-153.5 behaviour.

    A fence that also broke the heal would leave a genuinely wedged pipe with no
    remedy at all, which is strictly worse than the defect it closes.

    ⚠️ The generation is BOUND by a read before the restart, deliberately. That is
    the production shape — a restart is triggered BY a failed read, never on a
    virgin client — and an unbound client would make this case blind to a fence
    that refused every already-bound restart.
    """
    stale = _FakeMt5({"account": _FakeNamedTuple(login=123, equity=1000.0)})
    fresh = _FakeMt5({"account": _FakeNamedTuple(login=123, equity=2000.0)})
    conns: dict[str, int] = {"n": 0}

    def _connect(*, host, port, timeout):
        conns["n"] += 1
        return stale if conns["n"] == 1 else fresh

    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_connect)
    assert client.account_info()["equity"] == 1000.0  # binds the generation

    client.restart()  # nothing bumps — nobody released this lease

    assert stale.shutdown_calls == 1  # the ONE permitted, lease-held teardown
    assert stale._MetaTrader5__conn.close_calls == 1
    assert fresh.shutdown_calls == 0
    assert fresh._MetaTrader5__conn.close_calls == 0
    assert client._closed is False
    # The healed client is USABLE — the point of the whole recovery path.
    assert client.account_info()["equity"] == 2000.0


# --------------------------------------------------------------------------- #
# WIZFORM-ABANDON — FINDING #6a/#6b: THE FENCED CONSTRUCTION
#
# WHY these matter (Rule 9). The method fence (D-36 (i)) cannot reach this class:
# in #6a/#6b the abandoned thread is parked INSIDE `Mt5Client.__init__`'s blocking
# connect and makes no subsequent session call, so there is no method for a guard
# to sit in front of. And on that path nobody is left holding the client — the
# router's Pitfall-6 `finally` sees `client is None` and releases NOTHING
# (`routers/exchange.py:899-948`), the adapter's connect sits deliberately outside
# its close-`finally` ("there is no client to close yet") — so the rpyc session is
# orphaned against the gateway's `ThreadedServer` with no owner and no reaper.
#
# ⭐ THE ORACLE IS THE OPEN/CLOSE BALANCE, never "the post-connect arm fired".
# Which arm a zombie takes depends on where its thread was when the bump landed;
# an arm-specific assertion would flake on a run where the property genuinely held.
#
# ⭐ THE EXEMPTION IS STRUCTURAL, not an opt-in list. A preflight build
# (`job_worker._make_mt5_session`, outside and before the lease) holds no lease,
# therefore carries no occupancy token, therefore is not fenced — the honest
# encoding of "this construction is not happening under anyone's lease" rather
# than a special case somebody has to remember to maintain (RESEARCH Open Q-1).
# --------------------------------------------------------------------------- #


def _counting_connect(conns: list):
    """A `_connect` seam that hands back a FRESH double per call and records each
    one, so the open/close BALANCE over `conns` is observable."""

    def _connect(*, host, port, timeout):
        fake = _FakeMt5({})
        conns.append(fake)
        return fake

    return _connect


def _open_conns(conns: list) -> int:
    """How many of the sockets this seam opened are still OPEN. The balance
    oracle: it is arm-agnostic, so it stays honest whichever check fired."""
    return sum(1 for f in conns if f._MetaTrader5__conn.close_calls == 0)


def test_a_zombie_construction_disposes_its_own_socket_and_refuses(caplog):
    """⭐ FINDING #6 (a and b share this mechanism). The lease releases WHILE the
    blocking connect is in flight — the #6 shape exactly — and the client that
    lands afterwards belongs to nobody.

    ⛔ The teardown-before-raise is the load-bearing half. A bare raise after
    `connect()` leaks the socket, which is Pitfall 6 in a new costume: the exact
    leak this fence exists to close.
    """
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"
    conns: list = []
    inner = _counting_connect(conns)

    def _connect(*, host, port, timeout):
        # ⭐ THE ABANDONMENT: the caller's `wait_for` fired and its lease released
        # while this blocking connect was still on the wire.
        bump_mt5_terminal_epoch(key)
        return inner(host=host, port=port, timeout=timeout)

    token = begin_mt5_lease_occupancy(key)
    refusals: list[BaseException] = []
    try:
        with caplog.at_level("WARNING", logger="quantalyze.analytics"):
            try:
                Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_connect)
            except Mt5SessionAbandoned as exc:  # noqa: PERF203 — one call, not a loop
                refusals.append(exc)
    finally:
        end_mt5_lease_occupancy(token)

    assert conns, "the seam never ran — this case would be vacuous"
    assert _open_conns(conns) == 0, (
        "the abandoned construction left an rpyc socket OPEN with no owner — the "
        "router's Pitfall-6 finally sees `client is None` and releases nothing, so "
        "nothing will ever close it (finding #6)"
    )
    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("WIZFORM-ABANDON" in m for m in warnings), (
        f"the construction fence refused silently (D-39). Got: {warnings}"
    )
    assert refusals, "the abandoned construction returned a client to nobody"


def test_a_construction_already_abandoned_at_entry_opens_no_socket_at_all():
    """The PRE-connect arm. When the lease released before the zombie thread even
    reached `__init__`, the cheapest correct behaviour is to open nothing —
    a socket never opened is a socket that cannot leak."""
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"
    conns: list = []

    token = begin_mt5_lease_occupancy(key)
    refusals: list[BaseException] = []
    try:
        bump_mt5_terminal_epoch(key)  # the lease released first
        try:
            Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_counting_connect(conns))
        except Mt5SessionAbandoned as exc:  # noqa: PERF203 — one call, not a loop
            refusals.append(exc)
    finally:
        end_mt5_lease_occupancy(token)

    assert conns == [], (
        "an already-abandoned construction opened an rpyc socket anyway — refusal "
        "must precede the connect when the answer is already known"
    )
    assert refusals


def test_a_preflight_construction_carries_no_token_and_is_never_fenced():
    """⭐ THE Q-1 RESOLUTION, as a test. `job_worker._make_mt5_session` builds its
    client in PREFLIGHT — outside and before the lease. A construction-time epoch
    SNAPSHOT would refuse it the moment an unrelated lease released in that window,
    and its mitigation was per-call-site opt-ins plus a hand-typed pin: exactly the
    opt-out list this phase exists to avoid.

    The ContextVar removes the false positive STRUCTURALLY — no lease, no token, no
    fence — which is why there is no `fence_construction=` parameter to assert the
    absence of anywhere else.
    """
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"
    conns: list = []

    # No `begin_mt5_lease_occupancy` — this build is not happening under a lease.
    bump_mt5_terminal_epoch(key)  # somebody ELSE's lease releases in the window

    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=_counting_connect(conns))

    assert client._closed is False
    assert len(conns) == 1
    assert _open_conns(conns) == 1, (
        "a legitimate preflight-built client was fenced at construction and its "
        "socket torn down — the derive read it was built for can never happen"
    )


def test_no_constructor_parameter_opts_into_the_construction_fence():
    """The exemption must be STRUCTURAL. A `fence_construction=`-style opt-in was
    REJECTED with the Q-1 resolution, and this pin makes re-adding one a deliberate
    act rather than a quiet convenience.

    Derived from the shipped signature, never from a hand-copied list."""
    import inspect

    params = set(inspect.signature(Mt5Client.__init__).parameters)
    assert params == {
        "self",
        "host",
        "port",
        "_connect",
        "request_timeout_s",
        "initialize_timeout_ms",
        "login_timeout_ms",
    }, f"the constructor grew or lost a parameter: {sorted(params)}"


async def test_a_construction_under_a_genuinely_held_lease_cannot_be_refused():
    """⭐ THE LIVE-PATH PROOF (T-153.5-07 / the PATTERNS "live-path 503 hazard").

    `routers/exchange.py`'s connect stage wraps the construction in a broad
    `except Exception as connect_err:` that answers **503 MT5_GATEWAY_UNREACHABLE
    with the mt5-gateway breaker keyed**. If the fence could raise on a LIVE path,
    a fencing bug would present as a platform-wide outage: the breaker trips,
    expires, re-probes and re-trips.

    It structurally cannot, and this drives the SHIPPED `mt5_terminal_lease` to
    prove it rather than re-deriving anything `_assert_live` computes: the lock is
    EXCLUSIVE per terminal key, so while this lease is held no other holder exists
    to release one, and therefore the generation cannot move. The oracle is a
    property of the LOCK, not of the fence.
    """
    key = f"{_TERMINAL_HOST}:{_TERMINAL_PORT}"
    conns: list = []

    async with mt5_concurrency.mt5_terminal_lease(key):
        client = Mt5Client(
            _TERMINAL_HOST, _TERMINAL_PORT, _connect=_counting_connect(conns)
        )
        # ...and it is a usable client, not merely a non-raising one.
        assert client._closed is False
        assert _open_conns(conns) == 1

    # The lease has now released and bumped — which is what makes the assertion
    # above non-vacuous: the generation the construction was checked against is
    # genuinely one a release can move.
    assert client.terminal_key == key


# --------------------------------------------------------------------------- #
# 164.6.2 / D-07 — THE CREDENTIAL-FREE DETECTOR AND THE CREDENTIALED HEAL VERB
#
# WHY these matter (Rule 9). `Mt5Client.login` opens with a credential-LESS
# `initialize()` and raises on a falsy return — and a credential-less
# `initialize()` is EXACTLY the call that returns `-6` when the terminal has no
# authorized account. So `login()` raises before reaching its own `login()` and
# is structurally incapable of healing the fault this phase exists for (probed
# live, 2026-09-13). The heal is `initialize(login=…, password=…, server=…)`.
#
# ⛔ AND THE MOMENT A PASSWORD IS PASSED TO `initialize()`, T-134-01 APPLIES TO
# IT. `mt5linux` 0.1.9 f-string-interpolates its arguments into remotely-eval'd
# source, so a raw rpyc remote traceback carries the credentials verbatim onto a
# PUBLIC Actions log. The by-value redaction is therefore a SHIPPED CONTROL
# travelling with the credentials; the cases below are its behavioural proof and
# the parametrized gate further down fences the CLASS so a THIRD credentialed
# verb cannot land without it.
#
# ⛔ Every credential here is an obvious DOUBLE (D-04): a fake password, a
# `Broker-Demo`-shaped server, the host/port this file already uses. This repo is
# PUBLIC. No real credential, no real broker server, no account number.
# --------------------------------------------------------------------------- #

# The credential register for this section. Deliberately unmistakable as fakes.
_FAKE_LOGIN = 4242424
_FAKE_PASSWORD = "not-a-real-password-42"
_FAKE_SERVER = "Broker-Demo-2"


def test_terminal_key_has_one_spelling_reachable_without_a_client():
    """Plan 02's blocker, and the two-registries hazard it removes.

    `Mt5Client.__init__` performs a BLOCKING `rpyc.classic.connect` carrying no
    timeout of its own, so a caller that must take the terminal LEASE before it is
    willing to open a transport cannot read the key off an instance. The only
    alternative was a second hand-spelled `f"{host}:{port}"` at the lease site —
    and the lease key and the epoch key MUST be byte-identical or the fence guards
    a different terminal than the lock serializes.

    Both forms are asserted against the SAME hand-typed literal rather than
    against each other: `a == b` would pass for any two equally-wrong spellings.
    """
    expected = "mt5-gw.internal:18812"
    assert mt5_client_mod.mt5_terminal_key(_TERMINAL_HOST, _TERMINAL_PORT) == expected

    connect, _fake, _rec = _make({})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    assert client.terminal_key == expected


def test_terminal_key_property_still_reads_only_host_and_port_off_self():
    """`tests/test_ingestion_mt5.py::_expected_terminal_key` reaches this property
    through `.fget` on a `SimpleNamespace` carrying ONLY the two private
    attributes — no client, no transport, no `__init__`. The delegation must not
    have introduced a dependency on anything else on `self`.

    Pinned HERE as well as there because the constraint belongs to this contract:
    a future author reading only this file would otherwise have no warning."""
    stub = types.SimpleNamespace(_host="other-gw.internal", _port=19000)
    assert Mt5Client.terminal_key.fget(stub) == "other-gw.internal:19000"


def test_assert_session_authorized_is_a_bare_bounded_initialize():
    """The detector's happy path: it returns None, makes EXACTLY ONE `initialize`
    round-trip, and passes the registered millisecond ceiling.

    Asserted against the double's RECORDED kwargs (test-the-wiring, P115), never
    against the client's own constant expression — an oracle that recomputed the
    formula under test could not fail a dropped ceiling. D-24: an unbounded
    `initialize()` runs on MetaTrader5's 60000ms vendor default INSIDE a 30s rpyc
    bound and is structurally incapable of answering in time."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    assert client.assert_session_authorized() is None
    assert fake.initialize_calls == 1
    assert fake.initialize_kwargs[0]["timeout"] == MT5_INITIALIZE_TIMEOUT_MS
    assert MT5_INITIALIZE_TIMEOUT_MS < MT5_REQUEST_TIMEOUT_S * 1000


def test_assert_session_authorized_carries_no_credential_kwarg():
    """⛔ THE PROPERTY THAT MAKES THE DETECTOR USABLE AS A DETECTOR.

    It exists to DECIDE whether a credential should be sent. A detector that
    carried one would already have sent it — the decision would be moot — and the
    disclosure surface this plan fences would grow a second, unfenced mouth.

    Oracled on the recorded kwargs, so it goes red the moment somebody "helpfully"
    threads the credentials through for symmetry with the heal verb."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    client.assert_session_authorized()

    recorded = fake.initialize_kwargs[0]
    assert set(recorded) == {"timeout"}, (
        f"the credential-free detector passed {sorted(set(recorded) - {'timeout'})} "
        "to initialize() — it is no longer credential-free"
    )
    assert fake.login_calls == []


def test_assert_session_authorized_surfaces_minus_six_as_the_code():
    """RESEARCH question FOUR — the discriminator, WITHOUT a credential.

    `-6` (no authorized account) is the ONE fault this phase heals; `-10003` /
    `-10005` are IPC faults whose remedy is the opposite and to which re-sending a
    credential does nothing. The code must therefore survive to the caller: plan
    02 branches on it. And no `login` round-trip may be attempted — the detector
    observes, it does not act."""
    connect, fake, _rec = _make(
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
        }
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        client.assert_session_authorized()

    assert exc_info.value.code == -6
    assert fake.login_calls == []


@pytest.mark.parametrize(
    "ipc_code",
    [-10003, -10004, -10005],
)
def test_assert_session_authorized_keeps_the_ipc_codes_distinct_from_minus_six(
    ipc_code,
):
    """The detector is only worth having if it SEPARATES the faults.

    Phase 164.1 built the distinction between "the terminal lost its broker
    session" and "the IPC pipe is broken"; a heal applied to the wrong one
    re-collapses it. Parametrized over the three IPC codes so the separation is
    proven, not assumed from the `-6` case alone."""
    connect, _fake, _rec = _make(
        {"initialize": False, "last_error": (ipc_code, "IPC fault")}
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        client.assert_session_authorized()

    assert exc_info.value.code == ipc_code
    assert exc_info.value.code != -6


def test_initialize_with_credentials_passes_the_triple_as_keywords():
    """D-07 — the heal verb's call FORM, which is the verbatim part that matters.

    `mt5linux` forwards `**kwargs` unchanged into the real `MetaTrader5` module,
    and `initialize(login=…, password=…, server=…)` is the only documented form
    that can clear a `-6`. Asserted against the recorded kwargs, plus the
    registered ms ceiling riding along (D-24).

    ⛔ And NO `login` round-trip: this is not `Mt5Client.login`. A heal that also
    called `login()` would re-point the shared terminal onto an account the caller
    never asked for."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    assert (
        client.initialize_with_credentials(
            _FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER
        )
        is None
    )

    recorded = fake.initialize_kwargs[0]
    assert recorded["login"] == _FAKE_LOGIN
    assert recorded["password"] == _FAKE_PASSWORD
    assert recorded["server"] == _FAKE_SERVER
    assert recorded["timeout"] == MT5_INITIALIZE_TIMEOUT_MS
    assert fake.login_calls == []
    assert fake.call_order == ["initialize"]


def test_initialize_with_credentials_transport_raise_discloses_nothing():
    """⛔ THE SECURITY PRECONDITION THIS WHOLE PLAN IS ORDERED AROUND (T-134-01).

    `mt5linux` 0.1.9 builds the remote call as SOURCE TEXT with the arguments
    interpolated and evals it on the far side, so a remote traceback carries the
    login, the password and the broker server VERBATIM. The transport text below
    mirrors that shape — all three literals in one string, exactly as
    `test_login_transport_raise_is_scrubbed_and_typed` does for the shipped verb.

    Each literal is asserted absent INDIVIDUALLY so a partial redaction names
    which one escaped, and the marker is asserted PRESENT so a redaction that
    "passed" by returning an empty message cannot read as green."""
    connect, _fake, _rec = _make(
        {
            "initialize_raises": RuntimeError(
                "rpyc remote error while eval'ing "
                f"mt5.initialize(login={_FAKE_LOGIN}, "
                f"password='{_FAKE_PASSWORD}', server='{_FAKE_SERVER}')"
            )
        }
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        client.initialize_with_credentials(
            _FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER
        )

    msg = str(exc_info.value)
    assert str(_FAKE_LOGIN) not in msg
    assert _FAKE_PASSWORD not in msg
    assert _FAKE_SERVER not in msg
    assert "[REDACTED]" in msg, (
        "nothing was redacted at all — an empty or unrelated message would satisfy "
        "the three absence assertions above vacuously"
    )


def test_initialize_with_credentials_falsy_return_discloses_nothing_and_keeps_the_code():
    """The FALSY arm of the heal verb.

    `_raise_last` builds its detail from the TERMINAL's own `last_error()` text,
    which `Mt5ClientError` scrubs by SHAPE only; a broker that echoes the submitted
    account or server back would disclose it. The error that escapes here is
    redacted BY VALUE.

    ⭐ THIS VERB IS NO LONGER STRONGER THAN `Mt5Client.login` — THEY ARE SYMMETRIC, and
    this docstring recorded the opposite until 2026-09-15. The asymmetry was booked as
    `[164.6.2-RAISE-LAST-SHAPE-ONLY]`, routed to a NAMED phase rather than hand-edited
    into the ROADMAP, and CLOSED by Phase 164.6.4 criterion 5: `_raise_last` now takes
    an optional keyword-only credential triple and redacts by value at the ONE shared
    site, so `login`'s falsy arm gets it too. ⛔ D-07's freeze was never broken — the
    close parameterised the shared helper, not `login()`'s body. The symmetry itself is
    pinned by
    `test_CREDENTIAL_REDACTION_the_falsy_arm_is_SYMMETRIC_across_both_drivable_verbs`
    and, derived, by
    `test_CREDENTIAL_REDACTION_neither_arm_of_any_drivable_verb_discloses_the_three`.
    The assertions below are unchanged and still hold.

    The ORIGINAL code is preserved: plan 02 does not branch on it here, but a heal
    that lost `-6` is undebuggable from a log."""
    connect, _fake, _rec = _make(
        {
            "initialize": False,
            "last_error": (
                -6,
                f"Authorization failed for {_FAKE_LOGIN} on {_FAKE_SERVER} "
                f"(password '{_FAKE_PASSWORD}')",
            ),
        }
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        client.initialize_with_credentials(
            _FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER
        )

    msg = str(exc_info.value)
    assert str(_FAKE_LOGIN) not in msg
    assert _FAKE_PASSWORD not in msg
    assert _FAKE_SERVER not in msg
    assert "[REDACTED]" in msg
    assert exc_info.value.code == -6


@pytest.mark.parametrize(
    "method_name",
    ["assert_session_authorized", "initialize_with_credentials"],
)
def test_the_new_session_verbs_refuse_a_stale_generation(method_name):
    """WIZFORM-ABANDON / D-36 — both new verbs are session touches and both must
    refuse one that arrives after the lease they began under has released.

    Oracled on the FAKE'S RECORDED CALL LOG — "no post-release round-trip landed"
    — never on the exception type alone, exactly as the D-36 block above argues:
    the economic harm is a touch LANDING on somebody else's terminal, not an
    exception going unraised.

    `Mt5SessionAbandoned` is a PLAIN Exception and must stay one: the credential
    classify/stamp arms match on `Mt5ClientError`, so a refusal that could be
    absorbed into one would blame a working key for OUR abandoned thread (D-42).
    """
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    args = (
        ()
        if method_name == "assert_session_authorized"
        else (_FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER)
    )

    # First touch binds the generation (the LAZY BIND `_assert_live` documents).
    getattr(client, method_name)(*args)
    calls_before = fake.initialize_calls
    assert calls_before == 1

    # The lease releases and bumps: this client is now a zombie.
    bump_mt5_terminal_epoch(client.terminal_key)

    with pytest.raises(Mt5SessionAbandoned):
        getattr(client, method_name)(*args)

    assert fake.initialize_calls == calls_before, (
        "the refused touch still reached the terminal — which is the harm itself"
    )
    assert not isinstance(Mt5SessionAbandoned(method_name), Mt5ClientError)


# --------------------------------------------------------------------------- #
# 164.6.2 — FENCING THE CLASS: A SIGNATURE-DERIVED CREDENTIAL-REDACTION GATE
#
# ⛔ THE HAZARD THIS EXISTS FOR IS NOT DUPLICATION, IT IS THE THIRD CALL SITE.
# `Mt5Client.login` and `Mt5Client.initialize_with_credentials` each carry their
# own copy of the by-value redaction loop, deliberately: extracting a shared
# helper would mean rewriting `login()`, whose four per-account callers are
# shipped and whose regression lands on live job processing (D-07). But a shared
# helper would not have removed the real hazard anyway — a THIRD credential-
# carrying verb landing one day without the loop. A new author simply would not
# call the helper.
#
# So the roster is DERIVED FROM SOURCE by SIGNATURE and the property is asserted
# BEHAVIOURALLY: a third drivable verb enters the parametrization by itself and
# REDS until it redacts, with no pin to remember to edit. That is strictly
# stronger than deduplication, which would only have made the text shorter.
#
# Every test in this block carries the token `CREDENTIAL_REDACTION` in its name so
# the CI verify can filter on it AND assert the filtered COUNT — a name that lost
# the token would collect nothing, and a zero-collected run reads as green.
#
# ⛔ ANTI-VACUITY (the argument `test_mt5_abandon_roster.py`'s floor makes, copied
# on purpose): every assertion below is of the form "every derived X has property
# P", and a derivation that collapsed to the EMPTY SET satisfies all of them —
# an unredacted class and a fully redacted one look identical from here. The
# hand-typed floor is what makes the difference observable.
# --------------------------------------------------------------------------- #

#: The credential triple, in the order a drivable verb must take it positionally.
CREDENTIAL_PARAMETER_TRIPLE = ("login", "password", "server")
PASSWORD_PARAMETER = "password"

#: ⛔ HAND-TYPED, and NEVER derived from the set it bounds — a size compared
#: against its own derivation cannot fail. MEASURED 2 on 2026-09-13 at this
#: commit: `login` (the shipped per-account verb) and `initialize_with_credentials`
#: (164.6.2 / D-07, the heal verb). Raise it when a third credentialed verb lands;
#: ⛔ never lower it to clear a red run.
CREDENTIALED_METHOD_FLOOR = 2


def _credential_carrying_transport_calls(
    fn: ast.FunctionDef | ast.AsyncFunctionDef,
) -> tuple[str, ...]:
    """The `self._mt5.<name>` calls INSIDE `fn` that are handed one of the
    credential parameters, in source order.

    ⭐ WHY the argument text is inspected rather than the method's own name mapped
    to a transport verb by hand. `login()` reaches the transport TWICE — a
    credential-LESS `initialize()` first, then the credentialed `login()` — and
    only the second is the arm the by-value redaction guards (the first is
    shape-scrubbed only, correctly, because no credential is in scope there). A
    driver that made the WRONG one raise would red shipped, unchanged code and the
    remedy would be a `login()` edit D-07 forbids. Identifying the call by the
    values it carries gets that right for a verb nobody has written yet, which a
    hand-map cannot.

    The walk descends into `lambda:` bodies because that is how both verbs pass
    their transport call to `_timed`.
    """
    found: list[tuple[int, str]] = []
    for node in ast.walk(fn):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        base = node.func.value
        if not (
            isinstance(base, ast.Attribute)
            and base.attr == "_mt5"
            and isinstance(base.value, ast.Name)
            and base.value.id == "self"
        ):
            continue
        referenced = {
            name.id
            for arg in [*node.args, *(kw.value for kw in node.keywords)]
            for name in ast.walk(arg)
            if isinstance(name, ast.Name)
        }
        if referenced & set(CREDENTIAL_PARAMETER_TRIPLE):
            found.append((node.lineno, node.func.attr))
    return tuple(attr for _lineno, attr in sorted(found))


def _credentialed_client_methods(
    source: str,
) -> tuple[dict[str, tuple[str, ...]], dict[str, tuple[str, ...]]]:
    """Derive, FROM SOURCE, the credential-carrying methods of `Mt5Client`.

    Returns `(drivable, residual)`:

      * DRIVABLE — its POSITIONAL parameters are exactly the credential triple, in
        order, with no keyword-only parameters. The value is the tuple of
        transport verbs it hands a credential to, which is what tells the gate
        which scenario key must raise.
      * RESIDUAL — it names the password parameter but is not drivable, so the
        gate physically cannot call it. Reported by name and asserted EMPTY: a
        future credentialed verb with a different shape must force a DELIBERATE
        driver extension rather than silently escaping the fence.

    ⛔ Never hand-list the method names here. The entire value of this gate is that
    a third credentialed verb lands in it WITHOUT a pin edit.
    """
    tree = ast.parse(source, filename="services/mt5_client.py")
    drivable: dict[str, tuple[str, ...]] = {}
    residual: dict[str, tuple[str, ...]] = {}
    for cls in (
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "Mt5Client"
    ):
        for member in cls.body:
            if not isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            positional = tuple(
                arg.arg
                for arg in (*member.args.posonlyargs, *member.args.args)
                if arg.arg != "self"
            )
            keyword_only = tuple(arg.arg for arg in member.args.kwonlyargs)
            if positional == CREDENTIAL_PARAMETER_TRIPLE and not keyword_only:
                drivable[member.name] = _credential_carrying_transport_calls(member)
            elif PASSWORD_PARAMETER in positional + keyword_only:
                residual[member.name] = positional + keyword_only
    return drivable, residual


def _methods_routed_through_the_shared_redactor(source: str) -> frozenset[str]:
    """The `Mt5Client` methods whose body references `_redact_credential_values`.

    ⛔ DERIVED, never hand-listed, for the same reason the roster above is: the
    escape-aware redaction lives in ONE helper, and the question this gate must
    answer is "which verbs actually route through it" — not "which verbs did on
    the day somebody typed the list". A third credentialed verb that calls the
    helper enters the escape gate by itself; one that does not is reported by the
    residual test below rather than silently escaping.
    """
    tree = ast.parse(source, filename="services/mt5_client.py")
    routed: set[str] = set()
    for cls in (
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "Mt5Client"
    ):
        for member in cls.body:
            if not isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if any(
                isinstance(node, ast.Name) and node.id == "_redact_credential_values"
                for node in ast.walk(member)
            ):
                routed.add(member.name)
    return frozenset(routed)


_CLIENT_SOURCE = pathlib.Path(mt5_client_mod.__file__).read_text()
_DRIVABLE, _RESIDUAL = _credentialed_client_methods(_CLIENT_SOURCE)
_ESCAPE_AWARE = frozenset(_DRIVABLE) & _methods_routed_through_the_shared_redactor(
    _CLIENT_SOURCE
)

#: ⛔ HAND-TYPED, and never derived from the set it bounds. MEASURED 2 on
#: 2026-09-15: `initialize_with_credentials` AND `login`. ⚠️ THIS COMMENT SAID 1 AND
#: NAMED `login` AS ABSENT until 2026-09-15, contradicting both the constant beside it
#: and the code — the D-07 AMENDMENT (founder, 2026-09-14) routed `login`'s
#: transport-raise arm through the shared helper and deleted its private copy of the
#: loop, and only the prose was left behind ([164.7-CITATION-DRIFT-01]). ⛔ The CONSTANT
#: was right; the comment was fixed to match it. Raise this when a THIRD verb routes
#: through the shared helper; ⛔ never lower it to clear a red run.
ESCAPE_AWARE_METHOD_FLOOR = 2


# --------------------------------------------------------------------------- #
# ⛔ THE ESCAPE CORPUS — 164.6.2 CR-01, AND THE REASON IT EXISTS IS THAT THE
# CORPUS ABOVE COULD NOT FAIL ON THIS CLASS.
#
# `mt5linux` 0.1.9 builds its remote call as SOURCE TEXT
# (`f'mt5.initialize(*{args},**{kwargs})'`), so the credentials reach a remote
# traceback as the `repr()` OF A DICT — and `repr()` ESCAPES. A by-value pass
# that matches only the unescaped literal therefore fires on an `[A-Za-z0-9-]`
# password and MISSES every password carrying a backslash, a quote pair or a
# control character. Two measured facts make that the whole control rather than
# half of it:
#
#   * `scrub_freeform_string` contributes NOTHING on the kwargs-repr shape — its
#     `SENSITIVE_KEY_VALUE` pattern needs `key` immediately followed by `[:=]`,
#     and the repr puts a closing quote between them. The by-value pass is the
#     SOLE control on the production shape, not a second layer over a first.
#   * every credential fixture in this file was `[A-Za-z0-9-]` only until
#     2026-09-14, so NO test in the corpus could fail on the escaping class. The
#     gate bit on the clean shape and was blind to the real one BY CONSTRUCTION
#     OF ITS OWN CORPUS. These cases were OBSERVED RED against the shipped
#     `_redact_credential_values` before it was fixed.
#
# ⛔ THE EXPECTED RENDERINGS ARE HAND-TYPED, never computed by calling the same
# helper the production code calls. A test that derived its expectation from the
# implementation it polices would forget exactly the form the implementation
# forgot — which is how this defect shipped green in the first place.
# --------------------------------------------------------------------------- #


class _EscapeCase(NamedTuple):
    """One credential whose `repr()` rendering differs from its raw literal.

    ``password_renderings`` / ``server_renderings`` are every byte sequence that
    value can reach a log as: the raw literal, the body `repr()` produces, and the
    body `json.dumps()` produces (they differ for the quote case). EVERY one must
    be absent from the message.
    """

    password: str
    server: str
    password_renderings: tuple[str, ...]
    server_renderings: tuple[str, ...]


_ESCAPE_CASES = (
    pytest.param(
        _EscapeCase(
            # A broker-generated password containing a single backslash.
            password=r"pa\ssw0rd",
            server=_FAKE_SERVER,
            #   raw:  pa\ssw0rd        repr/json body:  pa\\ssw0rd
            password_renderings=(r"pa\ssw0rd", r"pa\\ssw0rd"),
            server_renderings=(_FAKE_SERVER,),
        ),
        id="password-backslash",
    ),
    pytest.param(
        _EscapeCase(
            # BOTH quote types, which forces `repr` to escape the single quote
            # and `json.dumps` to escape the double one — the two renderings
            # differ, and neither equals the raw literal.
            password="pa'sw\"0rd",
            server=_FAKE_SERVER,
            #   raw:  pa'sw"0rd     repr body: pa\'sw"0rd     json body: pa'sw\"0rd
            password_renderings=("pa'sw\"0rd", "pa\\'sw\"0rd", "pa'sw\\\"0rd"),
            server_renderings=(_FAKE_SERVER,),
        ),
        id="password-both-quote-types",
    ),
    pytest.param(
        _EscapeCase(
            # A control character. `repr` renders it as the two-character
            # escape `\t`, which shares not one byte with the raw tab.
            password="pa\tssw0rd",
            server=_FAKE_SERVER,
            password_renderings=("pa\tssw0rd", r"pa\tssw0rd"),
            server_renderings=(_FAKE_SERVER,),
        ),
        id="password-tab",
    ),
    pytest.param(
        _EscapeCase(
            # ⛔ NOT ONLY THE PASSWORD. A broker SERVER string can carry an
            # escapable character too (a Windows-shaped path, a tab from a
            # mis-pasted Railway variable), and the reviewer's fix is explicitly
            # "all three values". Without this case the fix could have been
            # applied to `password` alone and stayed green.
            password=_FAKE_PASSWORD,
            server=r"Broker\Demo-2",
            password_renderings=(_FAKE_PASSWORD,),
            server_renderings=(r"Broker\Demo-2", r"Broker\\Demo-2"),
        ),
        id="server-backslash",
    ),
    pytest.param(
        _EscapeCase(
            # ⛔ B1 — SUBSTRING OVERLAP, the case every prior assertion was blind
            # to. A password containing the account number is the commonest human
            # choice for a numeric login. Redacting per-literal in a FIXED ORDER
            # consumed the login's span first, so the password's full-literal match
            # then failed and only the overlapping slice was masked:
            #     'password': 'Quant[REDACTED]!x'
            # ⛔ The full literal WAS absent, so `_assert_no_credential_value_
            # escaped` and the per-literal contract loop BOTH passed. What leaked
            # was the remainder — prefix, suffix, length, structure — while the
            # masked span was the account number the log reader already has.
            # The renderings below are the REMAINDER, not the whole value: this
            # case fails unless the redactor makes ONE global longest-first pass.
            password=f"Quant{_FAKE_LOGIN}!x",
            server=f"Broker-{_FAKE_LOGIN}-2",
            password_renderings=(f"Quant{_FAKE_LOGIN}!x", "Quant", "!x"),
            server_renderings=(f"Broker-{_FAKE_LOGIN}-2", "Broker-", "-2"),
        ),
        id="credential-substring-overlap",
    ),
    pytest.param(
        _EscapeCase(
            # ⛔ IN-01 (round 2) — A NON-ASCII CREDENTIAL, WHERE `repr()`,
            # `ascii()` AND `json.dumps()` ALL THREE DIVERGE. `repr()` keeps the
            # character verbatim, `json.dumps()` emits the `\u00e4` escape, and
            # `ascii()` emits the `\xe4` one — ONE password, THREE distinct byte
            # sequences, of which the shipped loop matched two. A broker password
            # carrying an umlaut is not exotic.
            #
            # ⛔ The renderings below are HAND-TYPED, like every other case here,
            # and that rule is the reason this gap was findable at all: a test that
            # derived its expectation by calling the same helper it polices would
            # have forgotten exactly the form the helper forgot.
            #
            # ⚠️ STATED PLAINLY: the `ä`/`\xe4` entries here are ABSENCE checks
            # in this gate's established idiom — the driven message is a kwargs
            # `repr()`, which emits neither form, exactly as the existing quote
            # case's `json` rendering does not appear in ITS message either. The
            # BITING gate for the `ascii()` form is
            # `test_CREDENTIAL_REDACTION_the_ascii_rendering_is_covered_not_merely_claimed`
            # below, which builds its message with `%a`. This case's load-bearing
            # half is the RAW non-ASCII literal.
            password="pässw0rd",
            server="Bröker-Demo-2",
            #   raw / repr body:  pässw0rd
            #   json body:        p\u00e4ssw0rd
            #   ascii body:       p\xe4ssw0rd
            password_renderings=(
                "pässw0rd",
                r"p\u00e4ssw0rd",
                r"p\xe4ssw0rd",
            ),
            server_renderings=(
                "Bröker-Demo-2",
                r"Br\u00f6ker-Demo-2",
                r"Br\xf6ker-Demo-2",
            ),
        ),
        id="credential-non-ascii",
    ),
)


def test_CREDENTIAL_REDACTION_the_ascii_rendering_is_covered_not_merely_claimed():
    """⛔ IN-01 (164.6.2 round 2) — `_credential_renderings` PROMISED AN ABSOLUTE
    AND DELIVERED TWO FORMS OF THREE.

    Its first line reads *"Every byte sequence ONE credential value can reach a log
    as"*, and the `ascii()` / `%a` / `{!a}` form was absent. MEASURED against the
    shipped helper on 2026-09-14: with `password="pässw0rd"`, the `ascii` body
    `p\\xe4ssw0rd` survived a `_redact_credential_values` pass VERBATIM while the
    raw and `json.dumps` forms were masked.

    ⛔ THIS CANNOT BE DRIVEN THROUGH THE VERB GATE ABOVE, which is why it is a
    separate case. That gate builds its message as a kwargs `repr()` — the shape
    `mt5linux` actually produces — and a `repr()` never emits the `\\xe4` form. The
    producer here is `%a`, so the message is built with `%a`.

    ⚠️ NO LIVE CALL SITE PRODUCING THIS FORM IS KNOWN — the round-2 review looked
    and found none, and this test does NOT claim one. It pins the CONTRACT the
    docstring states, on the argument that a redactor documented as covering "every
    byte sequence" is read by every future caller as a licence not to check. The
    alternative was to narrow the absolute, which is the more expensive of the two.
    """
    password = "pässw0rd"
    server = "Bröker-Demo-2"

    # `%a` is the reachable producer of this rendering. (`repr()` would keep the
    # character verbatim and is already covered by the corpus case above.)
    message = (
        "rpyc remote error while eval'ing "
        "mt5.initialize(login=%d, password=%a, server=%a)"
        % (_FAKE_LOGIN, password, server)
    )
    # The mutant-detector: the message really does carry the ascii form, so an
    # assertion below cannot pass because the form was never there.
    assert r"p\xe4ssw0rd" in message, message

    from services.mt5_client import _redact_credential_values

    out = _redact_credential_values(message, _FAKE_LOGIN, password, server)

    # ⛔ HAND-TYPED renderings, never computed from the helper under test.
    for label, rendering in (
        ("password (raw)", password),
        ("password (ascii body)", r"p\xe4ssw0rd"),
        ("server (raw)", server),
        ("server (ascii body)", r"Br\xf6ker-Demo-2"),
        ("login", str(_FAKE_LOGIN)),
    ):
        assert rendering not in out, (
            f"the by-value pass disclosed the {label} as {rendering!r}: {out!r}. "
            "⛔ `_credential_renderings` documents itself as covering EVERY byte "
            "sequence a credential can reach a log as; `ascii()` / `%a` / `{!a}` "
            "is one of them (IN-01 round 2)."
        )
    assert "[REDACTED]" in out, (
        f"nothing was redacted at all — the absences above would pass vacuously: "
        f"{out!r}"
    )


def test_CREDENTIAL_REDACTION_the_derived_roster_did_not_collapse():
    """⛔ THE LOAD-BEARING FLOOR, and the ONLY assertion in this block that a
    collapsed derivation cannot satisfy.

    The parametrized gate below is of the form "every derived verb redacts". An
    EMPTY derivation satisfies it VACUOUSLY — pytest reports an empty parameter
    set, nothing runs, and the summary says nothing failed. That is precisely how
    a source-derived gate rots into decoration. The floor is hand-typed and
    compared with `>=`, never computed from the set it bounds.
    """
    assert len(_DRIVABLE) >= CREDENTIALED_METHOD_FLOOR, (
        "the source-derived credentialed-method roster COLLAPSED — the DERIVATION "
        "is broken, not the code. Nothing below can fail while it is empty: an "
        "empty parametrization passes the redaction gate vacuously, so an "
        "unredacted client and a fully redacted one are indistinguishable from "
        f"here. derived={sorted(_DRIVABLE)!r}, floor={CREDENTIALED_METHOD_FLOOR}. "
        "⛔ Fix the derivation; never lower the floor."
    )


def test_CREDENTIAL_REDACTION_no_password_carrying_method_escapes_the_driver():
    """Any method that names the password parameter but is NOT drivable is
    reported BY NAME AND SIGNATURE, and the set is asserted empty.

    Without this, the gate's coverage would silently depend on a future author
    happening to choose the same signature shape: a verb taking
    `(login, password, server, *, timeout)` — an entirely reasonable thing to
    write — would vanish from the parametrization and the fence would report
    success over a smaller class than it claims.
    """
    assert not _RESIDUAL, (
        "these Mt5Client methods carry the password parameter but the redaction "
        f"driver cannot call them: { {k: list(v) for k, v in _RESIDUAL.items()} }. "
        "⛔ EXTEND THE DRIVER to cover the new signature shape. Weakening the "
        "derivation so it no longer sees them is the WRONG fix — it would make "
        "this gate report success over a class it no longer covers."
    )


def test_CREDENTIAL_REDACTION_the_signature_classifier_is_itself_under_test():
    """The derivation above, exercised on SYNTHETIC source — the same discipline
    `test_timeout_call_extractor_ignores_comments_and_untimed_calls` applies to the
    timeout extractor, and for the same reason: a classifier only ever run against
    the file it polices is indistinguishable from one that returns a constant.

    Four shapes, each of which has misled a reader before:
      * the drivable shape, whose credential-carrying call is the SECOND transport
        call in the body (the `login()` shape) — the first is credential-less and
        must NOT be the one selected;
      * a keyword-only variant — RESIDUAL, because the driver calls positionally;
      * a wrong-ORDER variant — RESIDUAL, because a positional driver would hand
        the password to the server parameter;
      * a method with no credential at all — neither.
    """
    synthetic = "\n".join(
        [
            "class Mt5Client:",
            "    def login(self, login, password, server):",
            "        self._mt5.initialize(timeout=self._ipc_timeouts_ms['initialize'])",
            "        self._mt5.login(login, password=password, server=server)",
            "    def kwonly(self, login, *, password, server):",
            "        self._mt5.login(login, password=password, server=server)",
            "    def misordered(self, password, login, server):",
            "        self._mt5.login(login, password=password, server=server)",
            "    def account_info(self):",
            "        return self._mt5.account_info()",
        ]
    )
    drivable, residual = _credentialed_client_methods(synthetic)

    assert drivable == {"login": ("login",)}, (
        "the classifier must select the CREDENTIAL-CARRYING transport call, not "
        f"merely the first one in the body: {drivable!r}"
    )
    assert set(residual) == {"kwonly", "misordered"}
    assert "account_info" not in drivable and "account_info" not in residual


@pytest.mark.parametrize("method_name", sorted(_DRIVABLE))
@pytest.mark.parametrize("arm", ("transport_raise", "falsy_return"))
def test_CREDENTIAL_REDACTION_neither_arm_of_any_drivable_verb_discloses_the_three(
    method_name, arm
):
    """⛔ THE PROPERTY THE WHOLE PHASE ORDERING EXISTS TO PROTECT (T-134-01).

    `mt5linux` 0.1.9 builds every remote call as SOURCE TEXT with the arguments
    f-string-interpolated and evals it on the far side, so a remote traceback
    carries the login, the password and the broker server VERBATIM onto a PUBLIC
    Actions log. `scrub_freeform_string` is SHAPE-based and cannot catch a bare
    literal arriving without its key; only the by-value pass can.

    Driven END TO END from the derivation: the method is resolved by name off the
    instance and the scenario that exercises ITS credential-carrying transport
    call is derived too — both the RAISE key and the FALSY-return key. Nothing here
    is hand-mapped, so a third credentialed verb is fenced the moment it is written.

    ⭐ BOTH ARMS, as of Phase 164.6.4 criterion 5 — and the widening is the POINT.
    This case was scoped to the transport-raise arm because the falsy arm went
    through the shared `_raise_last`, which was shape-scrubbed only; asserting
    by-value redaction there would have redded shipped code whose only remedy was a
    `login()` edit D-07 forbade. Criterion 5 closed that by parameterising the
    SHARED site instead, so the criterion lands here as a STRENGTHENING of the
    signature-derived gate rather than as the deletion of a pin: a third
    credentialed verb written later is now fenced on BOTH arms for free.

    ⛔ THE FALSY ARM ALSO ASSERTS THE CODE SURVIVES. Redaction rewrites the freeform
    TEXT and nothing else; a heal that lost its `-6` is undebuggable from a log, and
    `-6` is the one fault this phase's detector exists to distinguish.

    Each literal is asserted absent INDIVIDUALLY so a partial redaction names the
    one that escaped, and the marker is asserted present so an empty message
    cannot satisfy the three absences vacuously.
    """
    carrying = _DRIVABLE[method_name]
    assert len(carrying) == 1, (
        f"Mt5Client.{method_name} hands a credential to {list(carrying)} — the "
        "driver cannot tell which transport call to drive. Extend the "
        "derivation deliberately; do not guess."
    )
    # The echo a broker is free to put in `last_error()` / a remote traceback: the
    # submitted server and password, back at us as bare literals.
    detail = (
        "rpyc remote error while eval'ing "
        f"mt5.{carrying[0]}({_FAKE_LOGIN}, "
        f"password='{_FAKE_PASSWORD}', server='{_FAKE_SERVER}')"
    )
    if arm == "transport_raise":
        scenario = {f"{carrying[0]}_raises": RuntimeError(detail)}
    else:
        scenario = {carrying[0]: False, "last_error": (-6, detail)}

    connect, _fake, _rec = _make(scenario)
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        getattr(client, method_name)(_FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER)

    msg = str(exc_info.value)
    for label, literal in (
        ("login", str(_FAKE_LOGIN)),
        ("password", _FAKE_PASSWORD),
        ("server", _FAKE_SERVER),
    ):
        assert literal not in msg, (
            f"Mt5Client.{method_name} disclosed the {label} on its {arm} "
            f"arm: {msg!r}. ⛔ Route that arm through the by-value redaction — on "
            "the falsy arm that means passing `credentials=` to `_raise_last`. "
            "This is T-134-01 and the message reaches a PUBLIC Actions log."
        )
    assert "[REDACTED]" in msg, (
        f"Mt5Client.{method_name} produced a message with nothing redacted at all "
        f"on its {arm} arm — the three absence assertions above would pass "
        f"vacuously on an empty or unrelated string: {msg!r}"
    )
    if arm == "falsy_return":
        assert exc_info.value.code == -6, (
            f"Mt5Client.{method_name} lost the terminal's own MT5 code through the "
            f"redaction on its falsy arm (got {exc_info.value.code!r}). Only the "
            "freeform TEXT may be rewritten."
        )


def test_CREDENTIAL_REDACTION_the_escape_aware_roster_did_not_collapse():
    """⛔ THE ANTI-VACUITY FLOOR FOR THE ESCAPE GATE BELOW.

    That gate is parametrized over `_ESCAPE_AWARE × _ESCAPE_CASES`. An EMPTY
    `_ESCAPE_AWARE` collapses the product to nothing, pytest reports an empty
    parameter set, and a client that redacts no escaped rendering at all is
    indistinguishable from one that redacts every one. The floor is hand-typed
    and compared with `>=`, never computed from the set it bounds.
    """
    assert len(_ESCAPE_AWARE) >= ESCAPE_AWARE_METHOD_FLOOR, (
        "the escape-aware roster COLLAPSED — the DERIVATION is broken, not the "
        f"code. derived={sorted(_ESCAPE_AWARE)!r}, "
        f"floor={ESCAPE_AWARE_METHOD_FLOOR}. ⛔ Fix the derivation; never lower "
        "the floor."
    )
    assert _ESCAPE_CASES, "the escape corpus is empty — the gate below is vacuous"


#: The name of the ONE method that must stay credential-free, and the shared raise
#: site it may only ever call bare. Both are read by the fence below.
_CREDENTIAL_FREE_DETECTOR = "assert_session_authorized"
_SHARED_RAISE_SITE = "_raise_last"


def _detector_raise_last_calls(source: str) -> tuple[int, tuple[str, ...]]:
    """`(calls_seen, offenders)` for `_raise_last` inside the credential-free detector.

    An OFFENDER is any such call carrying ANY positional argument or ANY keyword —
    i.e. a call that hands the shared raise site a credential. `calls_seen` exists so
    the gate can refuse to pass on a derivation that found nothing: a renamed method
    or a restructured class would otherwise read as compliance.
    """
    tree = ast.parse(source, filename="services/mt5_client.py")
    calls_seen = 0
    offenders: list[str] = []
    for cls in (
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "Mt5Client"
    ):
        for member in cls.body:
            if (
                not isinstance(member, (ast.FunctionDef, ast.AsyncFunctionDef))
                or member.name != _CREDENTIAL_FREE_DETECTOR
            ):
                continue
            for node in ast.walk(member):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr == _SHARED_RAISE_SITE
                ):
                    calls_seen += 1
                    if node.args or node.keywords:
                        offenders.append(
                            f"line {node.lineno}: "
                            f"{len(node.args)} positional / "
                            f"{[kw.arg for kw in node.keywords]} keyword"
                        )
    return calls_seen, tuple(offenders)


def test_CREDENTIAL_REDACTION_the_credential_free_detector_passes_no_credential_to_the_shared_raise():
    """⛔ CRITERION 3, MADE STRUCTURAL. `Mt5Client.assert_session_authorized` is the
    CREDENTIAL-FREE detector, and its own docstring already states why: a detector that
    carried a credential could not be used to DECIDE whether to send one — it would
    already have sent it.

    That was a REMEMBERED property until criterion 5 gave `_raise_last` a `credentials=`
    parameter. Adding the parameter made the drift one keyword wide, and this phase's
    monitor calls the detector ON A CADENCE, so the surface criterion 5 just shrank would
    grow a second, unfenced mouth at exactly the moment it starts firing more often.

    The predicate is AST-based rather than textual: every `_raise_last` call inside the
    detector must carry ZERO arguments and ZERO keywords.

    ⛔ CALIBRATED. A predicate that cannot fail is worse than none, so the same predicate
    is run against a COPY of the source with `credentials=` spliced into the detector —
    never the file on disk — and the mutated text is asserted DIFFERENT from the original
    first, because a splice that failed to apply reads as a pass.
    """
    calls_seen, offenders = _detector_raise_last_calls(_CLIENT_SOURCE)

    assert calls_seen >= 1, (
        f"no `{_SHARED_RAISE_SITE}` call was found inside "
        f"`Mt5Client.{_CREDENTIAL_FREE_DETECTOR}` — the DERIVATION is broken (the "
        "method was renamed or restructured), not the code. ⛔ Fix the derivation; a "
        "gate that finds nothing reports compliance it never measured."
    )
    assert offenders == (), (
        f"`Mt5Client.{_CREDENTIAL_FREE_DETECTOR}` hands a credential to "
        f"`{_SHARED_RAISE_SITE}`: {list(offenders)}. ⛔ It is the CREDENTIAL-FREE "
        "detector — a probe that carried a credential could not be used to decide "
        "whether to send one. Remove the argument; never relax this fence."
    )

    # -- calibration: the predicate must NAME a defect when one is present ------
    start = _CLIENT_SOURCE.index(f"def {_CREDENTIAL_FREE_DETECTOR}")
    end = _CLIENT_SOURCE.index("def initialize_with_credentials", start)
    region = _CLIENT_SOURCE[start:end]
    mutated_region = region.replace(
        f"self.{_SHARED_RAISE_SITE}()",
        f"self.{_SHARED_RAISE_SITE}(credentials=(login, password, server))",
    )
    mutated = _CLIENT_SOURCE[:start] + mutated_region + _CLIENT_SOURCE[end:]
    assert mutated != _CLIENT_SOURCE, (
        "the calibration splice DID NOT APPLY — the detector's bare "
        f"`self.{_SHARED_RAISE_SITE}()` call was not found in its source region, so "
        "the red observed below would be meaningless. Fix the splice."
    )
    mutated_seen, mutated_offenders = _detector_raise_last_calls(mutated)
    assert mutated_seen == calls_seen
    assert mutated_offenders, (
        "the fence did NOT fire on a detector that passes `credentials=` to "
        f"`{_SHARED_RAISE_SITE}` — the predicate cannot fail and fences nothing."
    )
    assert "credentials" in mutated_offenders[0]


def test_CREDENTIAL_REDACTION_every_credentialed_verb_routes_through_the_shared_redactor():
    """⭐ `[164.6.2-LOGIN-ESCAPE-BLIND]` — CLOSED, and the fence STRENGTHENED.

    D-07 was AMENDED (founder, 2026-09-14) and `Mt5Client.login` now routes its
    transport-raise arm through `_redact_credential_values` instead of carrying a
    private copy of the loop. The freeze existed to keep a shipped live-path method
    out of a REFACTOR; applying the identical, already-proven escape-aware
    redaction is not one, and the residual was a LIVE disclosure on four
    per-account callers that pass a real vault password.

    ⛔ The expectation is now the EMPTY SET, which is strictly stronger than the
    `{"login"}` it replaces: EVERY credentialed verb must route through the one
    copy of the loop that knows about `repr()` escaping (CR-01). A new verb written
    without it grows this set and reds here — the next author must make that a
    decision, not an omission.
    """
    outside = frozenset(_DRIVABLE) - _ESCAPE_AWARE
    assert outside == frozenset(), (
        f"credentialed verb(s) NOT routed through `_redact_credential_values`: "
        f"{sorted(outside)}. ⛔ Route them through the shared helper — it is the "
        "only copy of the loop that knows about `repr()` escaping (CR-01). "
        "Redacting the raw literal alone lets any password carrying a backslash, "
        "a quote or a tab survive into the rendering."
    )


def test_CREDENTIAL_REDACTION_login_discloses_no_escaped_rendering_either():
    """⭐ `[164.6.2-LOGIN-ESCAPE-BLIND]` — the fix as a MEASUREMENT, not a claim.

    This case used to assert the residual EXISTED. D-07 is amended and `login`
    now shares the escape-aware helper, so it asserts the disclosure is CLOSED —
    on the SHIPPED per-account path whose four callers pass a real vault password.

    ⛔ Both renderings are asserted absent. Before the fix the `repr()` body
    survived while the raw literal did not, so asserting only the raw literal
    would pass vacuously against exactly the bug this closes.
    """
    pw = r"pa\ssw0rd"
    escaped = r"pa\\ssw0rd"  # what `repr(pw)` puts in the message body

    connect, _fake, _rec = _make(
        {
            "login_raises": RuntimeError(
                "rpyc remote error while eval'ing mt5.login(**%r)"
                % ({"login": _FAKE_LOGIN, "password": pw, "server": _FAKE_SERVER},)
            )
        }
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    with pytest.raises(Mt5ClientError) as exc_info:
        client.login(_FAKE_LOGIN, pw, _FAKE_SERVER)
    msg = str(exc_info.value)

    assert pw not in msg, "the raw password literal survived login()'s scrub"
    assert escaped not in msg, (
        "`Mt5Client.login` disclosed the `repr()`-escaped rendering of the "
        "password — [164.6.2-LOGIN-ESCAPE-BLIND] has REGRESSED. Route the arm "
        "through `_redact_credential_values`; do NOT relax this assertion."
    )
    assert "[REDACTED]" in msg


@pytest.mark.parametrize("method_name", sorted(_ESCAPE_AWARE))
@pytest.mark.parametrize("case", _ESCAPE_CASES)
def test_CREDENTIAL_REDACTION_an_escaped_rendering_discloses_none_of_the_three(
    method_name, case: _EscapeCase
):
    """⛔ CR-01 — THE FORM `mt5linux` ACTUALLY PRODUCES, WHICH THE CLEAN CORPUS
    ABOVE CANNOT REACH.

    The message is built exactly the way `mt5linux` 0.1.9 builds its remote call:
    a `repr()` of the kwargs dict. With an `[A-Za-z0-9-]` password that rendering
    is byte-identical to the raw literal and the shipped `str.replace` loop fired;
    with a backslash, a quote pair or a tab it is NOT, and the credential survived
    verbatim onto a PUBLIC Actions log.

    ⛔ EVERY rendering is asserted absent, not just the raw literal — asserting
    only the raw literal here would pass VACUOUSLY, because the raw literal does
    not appear in an escaped message at all. That vacuity is the defect, restated
    as a test-design rule.
    """
    carrying = _DRIVABLE[method_name]
    assert len(carrying) == 1, carrying
    scenario_key = f"{carrying[0]}_raises"

    kwargs = {
        "login": _FAKE_LOGIN,
        "password": case.password,
        "server": case.server,
    }
    connect, _fake, _rec = _make(
        {
            scenario_key: RuntimeError(
                "rpyc remote error while eval'ing mt5.%s(**%r)"
                % (carrying[0], kwargs)
            )
        }
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        getattr(client, method_name)(_FAKE_LOGIN, case.password, case.server)

    msg = str(exc_info.value)
    for label, renderings in (
        ("login", (str(_FAKE_LOGIN),)),
        ("password", case.password_renderings),
        ("server", case.server_renderings),
    ):
        for rendering in renderings:
            assert rendering not in msg, (
                f"Mt5Client.{method_name} disclosed the {label} as {rendering!r} "
                f"on its transport-raise arm: {msg!r}. ⛔ The by-value loop must "
                "redact every RENDERING of each literal — `repr()` escapes, and "
                "`scrub_freeform_string` is a measured no-op on the kwargs-repr "
                "shape, so this loop is the SOLE control (CR-01, T-134-01)."
            )
    assert "[REDACTED]" in msg, (
        f"Mt5Client.{method_name} produced a message with nothing redacted at all "
        f"— the absence assertions above would pass vacuously: {msg!r}"
    )


def test_CREDENTIAL_REDACTION_the_falsy_arm_is_SYMMETRIC_across_both_drivable_verbs():
    """⭐ `[164.6.2-RAISE-LAST-SHAPE-ONLY]` IS CLOSED, and this case is what pins the
    close in BOTH directions. It was `…_the_falsy_arm_asymmetry_is_measured_not_assumed`
    and it asserted the DISCLOSURE: `login`'s falsy arm went through the shared
    `_raise_last`, which scrubbed by SHAPE only, so a bare broker-server literal echoed
    back by the terminal survived into the message. The pin worked exactly as written —
    it redded the moment the fix landed, and its own message said to delete that half.

    CLOSED by Phase 164.6.4 criterion 5 (founder decision 2026-09-15, routed in from
    Phase 164.6.2 criterion 9): `_raise_last` now takes an optional keyword-only
    credential triple and redacts BY VALUE at the one shared site. ⛔ The close was NOT
    an edit to `login()`'s body — D-07's freeze stands; what changed is the shared
    helper both verbs already called.

    Both drivable verbs are driven down their FALSY arm with the SAME terminal
    `last_error()` text, which echoes the broker server back as a bare literal, and
    BOTH must now answer identically: server absent, login absent, marker present, and
    the original `-6` preserved — a heal that lost the code is undebuggable from a log.

    ⛔ BOTH PASSWORD LEGS STAY. That half was never asymmetric and never may be;
    deleting one would leave the case unable to fail on a password regression.
    """
    detail = f"Authorization failed on {_FAKE_SERVER} (password='{_FAKE_PASSWORD}')"

    healing_connect, _f1, _r1 = _make(
        {"initialize": False, "last_error": (-6, detail)}
    )
    healing = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=healing_connect)
    with pytest.raises(Mt5ClientError) as healed:
        healing.initialize_with_credentials(
            _FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER
        )

    shipped_connect, _f2, _r2 = _make({"login": False, "last_error": (-6, detail)})
    shipped = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=shipped_connect)
    with pytest.raises(Mt5ClientError) as legacy:
        shipped.login(_FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER)

    healed_msg, legacy_msg = str(healed.value), str(legacy.value)

    # The HEAL verb: by-value redacted on the falsy arm, code preserved.
    assert _FAKE_SERVER not in healed_msg
    assert str(_FAKE_LOGIN) not in healed_msg
    assert "[REDACTED]" in healed_msg
    assert healed.value.code == -6

    # The password is redacted on BOTH — that half was never asymmetric.
    assert _FAKE_PASSWORD not in healed_msg
    assert _FAKE_PASSWORD not in legacy_msg

    # ⭐ THE SHIPPED VERB, SYMMETRIC WITH THE HEAL VERB. This block asserted the
    # DISCLOSURE until criterion 5 closed it; it now asserts the positive form,
    # literal by literal so a partial redaction names the one that escaped.
    assert _FAKE_SERVER not in legacy_msg, (
        "Mt5Client.login's falsy arm disclosed the broker SERVER — "
        "[164.6.2-RAISE-LAST-SHAPE-ONLY] has REGRESSED. ⛔ The remedy is to restore "
        "the `credentials=` argument at the `_raise_last` call site, never to relax "
        "this assertion: the message reaches a PUBLIC Actions log and Sentry."
    )
    assert str(_FAKE_LOGIN) not in legacy_msg, (
        "Mt5Client.login's falsy arm disclosed the ACCOUNT — see above."
    )
    assert "[REDACTED]" in legacy_msg, (
        "Mt5Client.login's falsy arm produced a message with nothing redacted at "
        f"all — the absences above would pass vacuously: {legacy_msg!r}"
    )
    assert legacy.value.code == -6, (
        "Mt5Client.login's falsy arm lost the original MT5 code through the "
        "redaction. Only the freeform TEXT may be rewritten — a failure that lost "
        "its code is undebuggable from a log."
    )


# --------------------------------------------------------------------------- #
# 164.6.5 / D-05 (Option 2, founder-ratified 2026-09-25) — THE TERMINAL RECYCLE
#
# WHY these matter (Rule 9). The rpyc classic channel is the unauthenticated
# arbitrary-remote-code channel Phase 134 recorded as T-134-03. D-05 makes it a
# production RECOVERY path, which is safe only while every property below holds:
# the command it carries is FIXED in the source (nothing assembled at run time),
# the verb cannot be handed a credential, an abandoned session cannot fire it,
# a dead transport can never read as a success, a remote traceback is scrubbed,
# and the remote source can never touch the Wine prefix that holds the saved
# terminal state (D-07, ONE-WAY).
#
# Every test here carries the token `TERMINAL_RECYCLE` in its name so the CI
# verify can filter on it and assert a NON-ZERO count.
#
# ⛔ The function name and stage name are HAND-TYPED here, never read from the
# module: an oracle derived from the thing under test cannot fail a rename.
# --------------------------------------------------------------------------- #

_RECYCLE_FN_NAME = "_qz_recycle_terminal_process"
_RECYCLE_STAGE = "terminal_recycle"


def _install_recycle_double(conn, *, returns=None, raises=None):
    """Wrap the fake rpyc `execute` so the REAL committed source is still exec'd —
    proving it compiles and binds the hand-typed name — and then swap the bound
    function for a recording stub.

    The swap is unavoidable offline: the real body drives Win32 through `ctypes`
    and exists only in the gateway's Windows interpreter. What CAN be proven
    offline is proven for real: the exact string that crossed, the argument it
    was called with, and everything the client does around the crossing.
    """
    record: dict = {"sources": [], "calls": []}
    real_execute = conn.execute

    def _execute(src):
        record["sources"].append(src)
        real_execute(src)
        assert _RECYCLE_FN_NAME in conn.namespace, (
            "the committed recycle source did not bind the hand-typed name "
            f"{_RECYCLE_FN_NAME!r} — the client would call a name that does not exist"
        )

        def _stub(*args):
            record["calls"].append(args)
            record["order"] = record.get("order", []) + ["remote"]
            if raises is not None:
                raise raises
            return returns

        dict.__setitem__(conn.namespace, _RECYCLE_FN_NAME, _stub)

    conn.execute = _execute
    return record


def _recycle_verdict(
    matched=1,
    terminated=1,
    exited=1,
    open_errors=(),
    terminate_errors=(),
    file_versions=None,
    file_version_errors=None,
):
    return json.dumps(
        dict(
            matched=matched,
            terminated=terminated,
            exited=exited,
            open_errors=list(open_errors),
            terminate_errors=list(terminate_errors),
            file_versions=(
                [[5, 0, 0, 6182]] * matched if file_versions is None else file_versions
            ),
            file_version_errors=(
                [0] * matched if file_version_errors is None else file_version_errors
            ),
            # Round 2 (R2-SFH-04 / -06 / -07, WR-06) — the fields the committed
            # source now also returns, at their no-surprise values.
            attempted=terminated,
            unprocessed=0,
            enumerated=matched + 1,
            enumerate_error=0,
            pid_errors=[],
            file_version_exc=[None] * matched,
        )
    )


class _FakeWin32:
    """The Win32 surface `_REMOTE_TERMINAL_RECYCLE_SRC` drives, faked so the
    COMMITTED source itself can be executed offline (164.6.5 review round 1).

    ⭐ WHY: every other recycle gate swaps the remote function for a stub, so the
    body that ends the terminal — counting, refusal handling, the codes it
    returns — had never executed anywhere, offline or live. Here the real string
    is exec'd with real `ctypes` structures; only `WinDLL` and `get_last_error`
    (Windows-only) are supplied. ``procs`` is ``[(pid, image), ...]``;
    ``open_refused`` / ``terminate_refused`` map a pid to the error code the
    refusal leaves in `GetLastError`; ``not_exiting`` is the pids whose wait
    times out.
    """

    WAIT_TIMEOUT = 0x00000102

    def __init__(
        self,
        procs,
        *,
        open_refused=None,
        terminate_refused=None,
        not_exiting=(),
        version=(5, 0, 0, 6182),
        query_refused=None,
        terminate_raises=None,
        terminate_cost_ms=0,
        first_fails_with=None,
        version_dll_raises=None,
    ) -> None:
        self.procs = list(procs)
        # R2-SFH-04 — a pid whose `TerminateProcess` RAISES (a ctypes marshalling
        # error, say) rather than returning FALSE.
        self.terminate_raises = dict(terminate_raises or {})
        # WR-06 — modelled cost of each `TerminateProcess` (a slow Wine call).
        self.terminate_cost_ms = terminate_cost_ms
        # R2-SFH-06 — `Process32FirstW` fails and leaves this in GetLastError.
        self.first_fails_with = first_fails_with
        # R2-SFH-07 — `WinDLL("version")` itself raises (a missing version.dll).
        self.version_dll_raises = version_dll_raises
        # WR-06 — the modelled clock the committed source reads through
        # `time.monotonic`: only a timed-out wait and a costed terminate move it.
        self.elapsed_ms = 0
        self.wait_ms: list[int] = []
        self.open_refused = dict(open_refused or {})
        self.terminate_refused = dict(terminate_refused or {})
        self.not_exiting = set(not_exiting)
        self.query_refused = dict(query_refused or {})
        self.version = version
        self.opened_for_query: list[int] = []
        self.last_error = 0
        self.terminated: list[int] = []
        self._cursor = 0
        self.kernel32 = types.SimpleNamespace()
        for name in (
            "CreateToolhelp32Snapshot",
            "Process32FirstW",
            "Process32NextW",
            "OpenProcess",
            "TerminateProcess",
            "WaitForSingleObject",
            "CloseHandle",
            "QueryFullProcessImageNameW",
        ):
            setattr(self.kernel32, name, self._fn(getattr(self, "_" + name)))
        self.version_dll = types.SimpleNamespace()
        for name in (
            "GetFileVersionInfoSizeW",
            "GetFileVersionInfoW",
            "VerQueryValueW",
        ):
            setattr(self.version_dll, name, self._fn(getattr(self, "_" + name)))
        self._fixed = None

    @staticmethod
    def _fn(impl):
        def call(*args):
            return impl(*args)

        return call

    def _fill(self, ref) -> int:
        if self._cursor >= len(self.procs):
            return 0
        pid, image = self.procs[self._cursor]
        self._cursor += 1
        ref._obj.th32ProcessID = pid
        ref._obj.szExeFile = image
        return 1

    def _CreateToolhelp32Snapshot(self, flags, pid):
        return 4242

    def _Process32FirstW(self, snapshot, ref):
        self._cursor = 0
        if self.first_fails_with is not None:
            self.last_error = self.first_fails_with
            return 0
        return self._fill(ref)

    def _Process32NextW(self, snapshot, ref):
        return self._fill(ref)

    def _OpenProcess(self, access, inherit, pid):
        if access == 0x1000:  # PROCESS_QUERY_LIMITED_INFORMATION — the version read
            self.opened_for_query.append(pid)
            if pid in self.query_refused:
                self.last_error = self.query_refused[pid]
                return 0
            return 20_000 + pid
        if pid in self.open_refused:
            self.last_error = self.open_refused[pid]
            return 0
        return 10_000 + pid

    def _TerminateProcess(self, handle, code):
        pid = handle - 10_000
        self.elapsed_ms += self.terminate_cost_ms
        if pid in self.terminate_raises:
            raise self.terminate_raises[pid]
        if pid in self.terminate_refused:
            self.last_error = self.terminate_refused[pid]
            return 0
        self.terminated.append(pid)
        return 1

    def _WaitForSingleObject(self, handle, ms):
        self.wait_ms.append(ms)
        if handle - 10_000 in self.not_exiting:
            self.elapsed_ms += ms  # a timed-out wait costs its whole bound
            return self.WAIT_TIMEOUT
        return 0

    def _CloseHandle(self, handle):
        return 1

    def _QueryFullProcessImageNameW(self, handle, flags, buf, size_ref):
        buf.value = "C:/terminal/terminal64.exe"
        return 1

    def _GetFileVersionInfoSizeW(self, path, _handle):
        return 64

    def _GetFileVersionInfoW(self, path, _zero, length, data):
        return 1

    def _VerQueryValueW(self, data, sub_block, block_ref, len_ref):
        import ctypes
        from ctypes import wintypes

        # ⚠️ `wintypes.DWORD`, not `c_uint32`: off Windows it is `c_ulong` (8 bytes
        # on this platform), and the struct the committed source casts to is
        # built from it — a mismatched layout reads zeros (measured).
        a, b, c, d = self.version
        self._fixed = (wintypes.DWORD * 4)(
            0xFEEF04BD, 0x10000, (a << 16) | b, (c << 16) | d
        )
        block_ref._obj.value = ctypes.addressof(self._fixed)
        return 1

    def _win_dll(self, name, **_kwargs):
        if name == "version":
            if self.version_dll_raises is not None:
                raise self.version_dll_raises
            return self.version_dll
        return self.kernel32

    def run(self, monkeypatch, exit_wait_ms=5000) -> dict:
        import ctypes
        import time

        monkeypatch.setattr(ctypes, "WinDLL", self._win_dll, raising=False)
        monkeypatch.setattr(ctypes, "get_last_error", lambda: self.last_error, raising=False)
        namespace: dict = {}
        exec(mt5_client_mod._REMOTE_TERMINAL_RECYCLE_SRC, namespace)  # noqa: S102
        # The modelled clock is patched ONLY around the one call, and restored at
        # once, so nothing else in the test process reads a frozen clock.
        real_monotonic = time.monotonic
        base = real_monotonic()
        time.monotonic = lambda: base + self.elapsed_ms / 1000.0
        try:
            return json.loads(namespace[_RECYCLE_FN_NAME](exit_wait_ms))
        finally:
            time.monotonic = real_monotonic


def test_TERMINAL_RECYCLE_a_live_session_sends_the_committed_source_then_relaunches():
    """The whole recycle, in order: the COMMITTED constant crosses once, is called
    with the by-value exit wait, and only THEN is the bare bounded `initialize()`
    issued that relaunches the terminal (what the founder's 2026-09-25 spike
    MEASURED relaunching it, unattended, twice).

    The order matters: an `initialize()` issued BEFORE the terminate would attach
    to the wedged terminal that is about to be killed and report on the wrong
    process.
    """
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    conn = fake._MetaTrader5__conn
    record = _install_recycle_double(conn, returns=_recycle_verdict())
    real_initialize = fake.initialize

    def _ordered_initialize(**kwargs):
        record["order"] = record.get("order", []) + ["initialize"]
        return real_initialize(**kwargs)

    fake.initialize = _ordered_initialize

    with capture_logs() as captured:
        verdict = client.recycle_terminal_process()

    events = _stage_events(captured, _RECYCLE_STAGE)
    assert len(events) == 1 and events[0]["ok"] is True, (
        f"the recycle crossing emitted no timed stage event: {captured}"
    )
    assert verdict == {
        "matched": 1,
        "terminated": 1,
        "exited": 1,
        "attempted": 1,
        "unprocessed": 0,
        "enumerated": 2,
        "enumerate_error": 0,
        "open_errors": [],
        "terminate_errors": [],
        "pid_errors": [],
        "file_versions": [[5, 0, 0, 6182]],
        "file_version_errors": [0],
        "file_version_exc": [None],
        "authorized": True,
        "relaunch_code": None,
    }
    assert record["sources"] == [mt5_client_mod._REMOTE_TERMINAL_RECYCLE_SRC], (
        "something other than the committed constant crossed the wire"
    )
    assert record["calls"] == [(5000,)], (
        "the exit wait must cross as ONE by-value int argument — never as text"
    )
    assert record["order"] == ["remote", "initialize"]
    # The relaunch is the detector's own bare, bounded call — timeout only.
    assert fake.initialize_kwargs == [{"timeout": MT5_INITIALIZE_TIMEOUT_MS}]
    assert fake.login_calls == []


def test_TERMINAL_RECYCLE_a_relaunch_that_is_not_yet_authorized_is_recorded_not_raised():
    """By the time the relaunch runs the process is already gone. A raise there
    would hide that from the caller, so the relaunch's answer is RECORDED with
    its code preserved: `-6` (terminal up, no account yet) is a different next
    step from an IPC code, and a verdict that lost the code is undebuggable.
    `authorized` is False — never a success shape the verb did not measure."""
    connect, fake, _rec = _make(
        {"initialize": False, "last_error": (-6, "Authorization failed")}
    )
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(
        fake._MetaTrader5__conn, returns=_recycle_verdict(1, 1, 1)
    )

    verdict = client.recycle_terminal_process()

    assert verdict["terminated"] == 1
    assert verdict["authorized"] is False
    assert verdict["relaunch_code"] == -6


def test_TERMINAL_RECYCLE_the_COMMITTED_remote_body_counts_and_names_every_refusal(
    monkeypatch,
):
    """⭐ SFH-01 / SFH-09 (164.6.5 review round 1). The committed source, EXECUTED:
    it matches only `terminal64.exe` (case-insensitively), counts what it ended,
    and a refused open or terminate is COUNTED as not-terminated AND carries its
    `GetLastError()` code — so the first live run can tell "access denied" (5)
    from "the process is already gone" (87). Without the code, both read as a
    smaller `terminated` and nothing else."""
    win32 = _FakeWin32(
        [
            (11, "terminal64.exe"),
            (12, "explorer.exe"),
            (13, "TERMINAL64.EXE"),
            (14, "terminal64.exe"),
            (15, "terminal64.exe"),
        ],
        open_refused={13: 5},
        terminate_refused={14: 87},
        not_exiting={15},
    )

    verdict = win32.run(monkeypatch)

    assert {k: verdict[k] for k in (
        "matched", "terminated", "exited", "open_errors", "terminate_errors"
    )} == {
        "matched": 4,
        "terminated": 2,
        "exited": 1,
        "open_errors": [5],
        "terminate_errors": [87],
    }
    assert win32.terminated == [11, 15], "a non-terminal process was ended"


def test_TERMINAL_RECYCLE_SFH04_the_BUILD_is_read_bridge_side_before_the_terminate(
    monkeypatch,
):
    """⭐ SFH-04 (164.6.5 review round 1). On a true `-10005` the heal's own
    `terminal_info()` crosses the dead terminal IPC and is `not_captured`, so the
    D-03a build hypothesis never got evidence. The executable's file version
    does not need that IPC: the committed source reads it per matched process,
    BEFORE ending it, as four ints and never the image path. A failed read is
    an int code and must not stop the terminate."""
    win32 = _FakeWin32(
        [(31, "terminal64.exe"), (32, "terminal64.exe")],
        version=(5, 0, 0, 6182),
        query_refused={32: 5},
    )

    verdict = win32.run(monkeypatch)

    assert verdict["file_versions"] == [[5, 0, 0, 6182], None]
    assert verdict["file_version_errors"] == [0, 5]
    assert win32.terminated == [31, 32], (
        "a failed version read stopped the terminate that follows it"
    )
    assert "terminal64" not in json.dumps(verdict), "the image path left the bridge"


def test_TERMINAL_RECYCLE_the_COMMITTED_remote_body_reports_matching_NOTHING(monkeypatch):
    """`matched=0` must come back as a count, never as a success shape: an
    image-name difference under Wine would otherwise read as a recycle."""
    verdict = _FakeWin32([(21, "wineserver.exe")]).run(monkeypatch)

    assert verdict["matched"] == 0 and verdict["terminated"] == 0


def test_TERMINAL_RECYCLE_the_refusal_codes_reach_the_verdict():
    """The verb carries the remote codes into its verdict as INTS, so the caller's
    log line can name them."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(
        fake._MetaTrader5__conn,
        returns=_recycle_verdict(2, 0, 0, open_errors=[5], terminate_errors=[87]),
    )

    verdict = client.recycle_terminal_process()

    assert verdict["open_errors"] == [5]
    assert verdict["terminate_errors"] == [87]


def test_TERMINAL_RECYCLE_SFH06_the_counts_are_logged_even_when_the_relaunch_is_abandoned(
    caplog,
):
    """⛔ SFH-06 (164.6.5 review round 1). The lease can release WHILE the remote
    terminate is in flight (the heal's budget fired). The relaunch probe's fence
    then raises `Mt5SessionAbandoned`, the verdict dict is discarded, and the only
    evidence that the shared terminal was ENDED and not relaunched by us goes with
    it — unless the counts were logged the moment they were parsed."""
    import logging

    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    record = _install_recycle_double(
        fake._MetaTrader5__conn, returns=_recycle_verdict(1, 1, 0, terminate_errors=[])
    )
    client.assert_session_authorized()  # first touch binds the generation
    real_execute = fake._MetaTrader5__conn.execute

    def _execute_then_lease_releases(src):
        real_execute(src)
        bump_mt5_terminal_epoch(client.terminal_key)

    fake._MetaTrader5__conn.execute = _execute_then_lease_releases

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        with pytest.raises(Mt5SessionAbandoned):
            client.recycle_terminal_process()

    assert record["calls"] == [(5000,)], "the terminate did not cross"
    counts = [
        r.getMessage()
        for r in caplog.records
        if "terminate crossed" in r.getMessage()
    ]
    assert counts and "matched=1 terminated=1 exited=0" in counts[0], (
        "the relaunch was abandoned and the terminate counts never reached the "
        "log — a killed shared terminal is invisible (SFH-06)"
    )


def test_TERMINAL_RECYCLE_the_remote_source_is_a_committed_literal_with_no_interpolation():
    """T-164.6.5-06. The command that crosses an arbitrary-remote-code channel
    must be FIXED in this file. Asserted structurally on the source file itself:
    the module-level assignment is an AST string CONSTANT — not an f-string, not
    a `.format`, not a concatenation — so nothing assembled at run time can reach
    the container. The prober asserts the same property one layer over on its own
    probe body (no `${` marker); the Python analog is no brace at all, which also
    rules out `str.format` placeholders.
    """
    source = pathlib.Path(mt5_client_mod.__file__).read_text()
    tree = ast.parse(source)
    assigned = [
        node.value
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(
            isinstance(t, ast.Name) and t.id == "_REMOTE_TERMINAL_RECYCLE_SRC"
            for t in node.targets
        )
    ]
    assert len(assigned) == 1, "the recycle source must be assigned exactly once"
    value = assigned[0]
    assert isinstance(value, ast.Constant) and isinstance(value.value, str), (
        f"the recycle source is a {type(value).__name__}, not a plain string "
        "literal — something is assembled at run time (T-164.6.5-06)"
    )
    src = value.value
    assert src == mt5_client_mod._REMOTE_TERMINAL_RECYCLE_SRC
    for marker in ("{", "}", "%(", "%s", "%d"):
        assert marker not in src, f"interpolation marker {marker!r} in the recycle source"
    assert f"def {_RECYCLE_FN_NAME}(" in src
    assert mt5_client_mod._REMOTE_TERMINAL_RECYCLE_FN == _RECYCLE_FN_NAME
    compile(src, "<recycle>", "exec")


def test_TERMINAL_RECYCLE_the_remote_source_can_only_end_a_process():
    """T-164.6.5-09 (D-07, ONE-WAY) and T-164.6.5-05. The remote source may end a
    process and do nothing else. A body that learned to delete, move or rewrite
    files could wipe the Wine prefix whose saved state made both measured
    unattended recoveries possible; restoring it takes a human at the VNC console.
    A body that learned to log in, trade or `shutdown()` the shared IPC would be a
    different verb wearing this one's name.

    ⚠️ Positive control at the end: a body that stopped calling `TerminateProcess`
    would pass every absence above while recycling nothing.
    """
    src = mt5_client_mod._REMOTE_TERMINAL_RECYCLE_SRC
    forbidden = (
        # filesystem mutation — the D-07 prefix
        "shutil", "rmtree", "remove", "unlink", "rename", "replace(", "open(",
        "DeleteFile", "MoveFile", "RemoveDirectory", ".wine", "drive_c", "config",
        # process launch / shell — no Linux-side command is sent
        "subprocess", "system(", "popen", "CreateProcess", "ShellExecute",
        # credentials and the MT5 surface
        "login", "password", "server", "MetaTrader5", "shutdown", "order_",
    )
    lowered = src.lower()
    present = [token for token in forbidden if token.lower() in lowered]
    assert not present, f"the recycle source reaches beyond ending a process: {present}"
    assert "TerminateProcess" in src and "terminal64.exe" in src


def test_TERMINAL_RECYCLE_the_verb_structurally_cannot_accept_a_credential():
    """T-164.6.5-05. Asserted on the SIGNATURE, not the body: a verb that takes no
    parameter cannot be handed a login, password or server by any future caller,
    and so can never carry one into a remote-executed source on a public repo.
    The terminal re-authorizes from its own persistent state or the next per-call
    login — never from this verb."""
    import inspect

    params = inspect.signature(Mt5Client.recycle_terminal_process).parameters
    assert list(params) == ["self"], (
        f"recycle_terminal_process grew parameters {list(params)[1:]} — it must "
        "take none, so no credential can ever be routed into it"
    )


def test_TERMINAL_RECYCLE_an_abandoned_session_is_refused_before_anything_crosses():
    """WIZFORM-ABANDON / D-36. A recycle fired from work that outlived its lease
    would kill the terminal under whoever holds it NOW. Oracled on the fake's
    recorded crossings, never on the exception alone — the harm is a crossing
    LANDING, not an exception going unraised."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    conn = fake._MetaTrader5__conn
    record = _install_recycle_double(conn, returns=_recycle_verdict())

    client.assert_session_authorized()  # first touch binds the generation
    initialize_before = fake.initialize_calls
    bump_mt5_terminal_epoch(client.terminal_key)  # the lease released

    with capture_logs() as captured:
        with pytest.raises(Mt5SessionAbandoned):
            client.recycle_terminal_process()

    assert record["sources"] == [], "the refused recycle still sent its source"
    assert record["calls"] == [], "the refused recycle still ran the terminate"
    assert fake.initialize_calls == initialize_before, (
        "the refused recycle still issued the relaunch"
    )
    assert _stage_events(captured, _RECYCLE_STAGE) == [], (
        "a fence refusal is not a round-trip and must emit no stage event"
    )


def test_TERMINAL_RECYCLE_an_absent_transport_raises_and_never_reports_success():
    """No rpyc transport ⇒ nothing was sent and nothing was ended. The verb must
    say so with the module's typed error — a success-shaped verdict here would
    tell the caller the terminal was recycled when it was never reached."""
    connect, fake, _rec = _make({"no_transport": True, "initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)

    with pytest.raises(Mt5ClientError) as exc_info:
        client.recycle_terminal_process()

    assert type(exc_info.value) is Mt5ClientError
    assert "not reachable" in str(exc_info.value)
    assert fake.initialize_calls == 0, "a relaunch ran after a recycle that never happened"


def test_TERMINAL_RECYCLE_a_malformed_remote_verdict_raises_and_skips_the_relaunch():
    """The remote answer is a by-value JSON string. Anything else means we do not
    know what happened on the far side, and a verdict built from it would be
    invented — typed raise, and no relaunch claimed on top of an unknown."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(fake._MetaTrader5__conn, returns="not json at all")

    with pytest.raises(Mt5ClientError) as exc_info:
        client.recycle_terminal_process()

    assert "malformed" in str(exc_info.value)
    assert fake.initialize_calls == 0


def test_TERMINAL_RECYCLE_a_remote_traceback_is_scrubbed_typed_and_timed():
    """T-164.6.5-08. A remote failure arrives as a traceback carrying the executed
    source and whatever the far side printed; raw, it would reach a public Actions
    log or Sentry. It must leave as a scrubbed, typed `Mt5ClientError` — and the
    failing crossing must still emit its stage event, or the recycle's failures
    would be censored out of the timing population."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(
        fake._MetaTrader5__conn,
        raises=RuntimeError(
            "remote traceback in _qz_recycle_terminal_process; apikey=SUPERSECRET"
        ),
    )

    with capture_logs() as captured:
        with pytest.raises(Mt5ClientError) as exc_info:
            client.recycle_terminal_process()

    assert type(exc_info.value) is Mt5ClientError
    assert "SUPERSECRET" not in str(exc_info.value)
    assert fake.initialize_calls == 0
    events = _stage_events(captured, _RECYCLE_STAGE)
    assert len(events) == 1 and events[0]["ok"] is False
    assert events[0]["error_class"] == "RuntimeError"


# --------------------------------------------------------------------------- #
# 164.6.5 review round 2 — Topic B, the remote recycle source.
# --------------------------------------------------------------------------- #


def test_TERMINAL_RECYCLE_R2SFH04_a_malformed_DIAGNOSTIC_field_keeps_the_counts_and_relaunch(
    caplog,
):
    """⛔ R2-SFH-04. By the time the payload is parsed every `TerminateProcess` has
    already run. The diagnostic fields come from Win32 code that has never run
    live, so a shape surprise in ONE of them used to fail the whole parse: the
    counts never reached the log, the relaunch was never issued, and the caller
    logged "whether the process was ended is not known" about a process that WAS
    ended. A malformed diagnostic field must become a named placeholder; the
    counts and the relaunch must survive it."""
    import logging

    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(
        fake._MetaTrader5__conn,
        returns=_recycle_verdict(
            2, 2, 1, file_versions=[["x", "y"], None], file_version_errors="garbage"
        ),
    )

    with caplog.at_level(logging.WARNING, logger="quantalyze.analytics"):
        verdict = client.recycle_terminal_process()

    assert (verdict["matched"], verdict["terminated"], verdict["exited"]) == (2, 2, 1)
    assert verdict["file_versions"] == "unparsed"
    assert verdict["file_version_errors"] == "unparsed"
    assert verdict["open_errors"] == [], "one bad field took a good one down with it"
    assert fake.initialize_calls == 1, "the relaunch was skipped over a diagnostic field"
    lines = [r.getMessage() for r in caplog.records if "terminate crossed" in r.getMessage()]
    assert lines and "matched=2 terminated=2 exited=1" in lines[0], (
        "the counts did not reach the log when a diagnostic field was malformed"
    )


def test_TERMINAL_RECYCLE_R2SFH04_a_malformed_ESSENTIAL_count_still_raises():
    """The other half of the split: the three counts ARE the verdict. When they
    cannot be read the verb does not know what happened, and it says so."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    _install_recycle_double(
        fake._MetaTrader5__conn, returns=json.dumps(dict(matched=1, terminated="two"))
    )

    with pytest.raises(Mt5ClientError) as exc_info:
        client.recycle_terminal_process()

    assert "malformed" in str(exc_info.value)
    assert fake.initialize_calls == 0


def test_TERMINAL_RECYCLE_R2SFH04_a_raise_after_the_first_terminate_is_COUNTED_in_the_bridge(
    monkeypatch,
):
    """⛔ R2-SFH-04. A remote raise on a LATER pid (a ctypes marshalling error, for
    example) used to escape the function after the first terminate had landed.
    `_guarded_read` then turned it into a code-0 error and the verdict read as
    "not known", while a terminal was already down. The committed body now
    catches per process, keeps going, and returns the counts with the failing
    exception's CLASS NAME, so "terminate attempted" survives."""
    import ctypes

    win32 = _FakeWin32(
        [(41, "terminal64.exe"), (42, "terminal64.exe"), (43, "terminal64.exe")],
        terminate_raises={42: ctypes.ArgumentError("argument 1: bad handle")},
    )

    verdict = win32.run(monkeypatch)

    assert verdict["matched"] == 3
    assert verdict["attempted"] == 3, "the raising terminate was not counted as attempted"
    assert verdict["terminated"] == 2
    assert verdict["pid_errors"] == ["ArgumentError"]
    assert win32.terminated == [41, 43], "one raising pid stopped the rest"
    assert "bad handle" not in json.dumps(verdict), "remote free text left the bridge"


def test_TERMINAL_RECYCLE_WR06_many_stray_terminals_cannot_overrun_the_rpyc_bound(
    monkeypatch,
):
    """⛔ WR-06. The loop runs inside ONE rpyc request. Each timed-out exit wait
    used to cost the full per-process bound, so eight stray `terminal64.exe`
    processes modelled 8 x 5 s = 40 s against a 30 s `sync_request_timeout`: the
    request timed out, the counts were lost, and a terminate that LANDED read as
    "not known". Every process must still be ended, and the modelled runtime
    must stay under half the bound (three exit waits' worth)."""
    procs = [(50 + i, "terminal64.exe") for i in range(8)]
    win32 = _FakeWin32(procs, not_exiting={pid for pid, _ in procs})

    verdict = win32.run(monkeypatch, exit_wait_ms=5000)

    assert win32.terminated == [pid for pid, _ in procs], "a stray terminal was left running"
    assert verdict["terminated"] == 8 and verdict["exited"] == 0
    assert verdict["unprocessed"] == 0
    assert win32.elapsed_ms <= 3 * 5000, (
        f"the remote body modelled {win32.elapsed_ms} ms of waiting inside one rpyc "
        "request bounded at 30 s — several strays overrun it (WR-06)"
    )


def test_TERMINAL_RECYCLE_WR06_slow_win32_calls_stop_the_loop_and_report_partial_counts(
    monkeypatch,
):
    """WR-06, the other way to overrun: the Win32 calls themselves are slow under
    Wine (unmeasured). The body stops starting new processes once its budget is
    spent and REPORTS how many it never reached, so `matched != terminated` reads
    as a partial recycle and not as a timeout that lost everything."""
    procs = [(60 + i, "terminal64.exe") for i in range(6)]
    win32 = _FakeWin32(procs, terminate_cost_ms=6000)

    verdict = win32.run(monkeypatch, exit_wait_ms=5000)

    assert verdict["matched"] == 6
    assert verdict["attempted"] == 3 and verdict["terminated"] == 3
    assert verdict["unprocessed"] == 3
    assert win32.wait_ms == [0, 0, 0], "an exhausted budget still waited"


def test_TERMINAL_RECYCLE_WR06_the_exit_wait_shrinks_with_the_instance_request_timeout():
    """WR-06. The in-bridge budget is three exit waits, so the exit wait that
    crosses must be at most a sixth of THIS client's `sync_request_timeout` — a
    client built with a shorter bound must not inherit the 30 s arithmetic."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(
        _TERMINAL_HOST, _TERMINAL_PORT, _connect=connect, request_timeout_s=24
    )
    record = _install_recycle_double(fake._MetaTrader5__conn, returns=_recycle_verdict())

    client.recycle_terminal_process()

    assert record["calls"] == [(4000,)]
    assert 6 * mt5_client_mod._TERMINAL_EXIT_WAIT_MS <= MT5_REQUEST_TIMEOUT_S * 1000, (
        "the default exit wait no longer fits three waits in half the default bound"
    )


def test_TERMINAL_RECYCLE_R2SFH06_a_failed_enumeration_is_not_zero_matches(monkeypatch):
    """⛔ R2-SFH-06. `Process32FirstW` failing (a `dwSize` Wine rejects, say) and
    "no terminal running" both produced `matched=0`. The body now returns how many
    processes it WALKED and the first call's `GetLastError()`, as ints."""
    procs = [(71, "wineserver.exe"), (72, "services.exe")]

    failed = _FakeWin32(procs, first_fails_with=24).run(monkeypatch)
    empty = _FakeWin32(procs).run(monkeypatch)

    assert (failed["matched"], failed["enumerated"], failed["enumerate_error"]) == (0, 0, 24)
    assert (empty["matched"], empty["enumerated"], empty["enumerate_error"]) == (0, 2, 0)


def test_TERMINAL_RECYCLE_R2SFH07_a_raising_version_read_names_its_exception_class(
    monkeypatch,
):
    """⛔ R2-SFH-07. `except Exception` in the version read kept only `-1`, so a
    missing `version.dll` under Wine and a ctypes signature mismatch read the
    same. It now keeps the exception's CLASS NAME (bridge-local, never remote free
    text) beside the `-1`, and the terminate that follows still runs."""
    win32 = _FakeWin32(
        [(81, "terminal64.exe")], version_dll_raises=OSError("version.dll not found")
    )

    verdict = win32.run(monkeypatch)

    assert verdict["file_version_errors"] == [-1]
    assert verdict["file_version_exc"] == ["OSError"]
    assert "not found" not in json.dumps(verdict)
    assert win32.terminated == [81]


def test_TERMINAL_RECYCLE_R2SFH07_a_free_text_exception_field_never_reaches_the_verdict():
    """The class-name fields are strings, so the client admits only an identifier
    shape. Anything else — a message, a path — becomes the placeholder."""
    connect, fake, _rec = _make({"initialize": True})
    client = Mt5Client(_TERMINAL_HOST, _TERMINAL_PORT, _connect=connect)
    payload = json.loads(_recycle_verdict())
    payload["file_version_exc"] = ["C:/users/someone/terminal64.exe not found"]
    payload["pid_errors"] = ["ArgumentError"]
    _install_recycle_double(fake._MetaTrader5__conn, returns=json.dumps(payload))

    verdict = client.recycle_terminal_process()

    assert verdict["file_version_exc"] == "unparsed"
    assert verdict["pid_errors"] == ["ArgumentError"]


def test_TERMINAL_RECYCLE_IN01_every_Win32_function_called_has_its_signature_declared(
    monkeypatch,
):
    """IN-01. Under the faked `WinDLL` an `argtypes` / `restype` assignment is a
    plain attribute write, so a function called WITHOUT one passes every offline
    gate and marshals with ctypes' int defaults on the live bridge: a HANDLE
    truncated to 32 bits, a DWORD read as a signed int. This asserts, on the
    EXECUTED body, that every function the source calls had `argtypes` set, and
    that every function returning something other than BOOL had `restype` set.

    ⚠️ It proves the declarations exist. It does NOT prove they are right under
    Wine — live marshalling is still unmeasured (WINDOWS.md entry 68).
    """
    import re

    src = mt5_client_mod._REMOTE_TERMINAL_RECYCLE_SRC
    called = {
        (dll, fn)
        for dll, fn in re.findall(r"\b(kernel32|ver)\.([A-Za-z0-9]+)\(", src)
    }
    assert ("kernel32", "TerminateProcess") in called, "the call scan found nothing"
    win32 = _FakeWin32(
        [(91, "terminal64.exe")],
    )

    win32.run(monkeypatch)

    dlls = {"kernel32": win32.kernel32, "ver": win32.version_dll}
    missing_argtypes = sorted(
        f"{dll}.{fn}" for dll, fn in called if not hasattr(getattr(dlls[dll], fn), "argtypes")
    )
    assert not missing_argtypes, f"called without argtypes: {missing_argtypes}"
    non_bool = {
        "CreateToolhelp32Snapshot",
        "OpenProcess",
        "WaitForSingleObject",
        "GetFileVersionInfoSizeW",
    }
    missing_restype = sorted(
        fn
        for dll, fn in called
        if fn in non_bool and not hasattr(getattr(dlls[dll], fn), "restype")
    )
    assert not missing_restype, f"non-BOOL return without restype: {missing_restype}"
