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
  - idempotent close: a teardown failure must never mask the caller's error, and
    shutdown() must never be called twice.
"""
from __future__ import annotations

import sys
import threading
import time
import types

import pytest

from services.mt5_client import (
    MT5_LOGIN_TIMEOUT_MS,
    MT5_REQUEST_TIMEOUT_S,
    Mt5Client,
    Mt5ClientError,
    Mt5Session,
)


class _FakeNamedTuple:
    """Emulates a netref namedtuple: exposes _asdict() only (like an RPyC proxy).

    Deliberately NOT a real namedtuple and NOT a dict — the client must go through
    `._asdict()` and coerce to a native dict, so the double only offers that seam.
    """

    def __init__(self, **fields) -> None:
        self._fields_dict = dict(fields)

    def _asdict(self) -> dict:
        return dict(self._fields_dict)


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
      login_raises     -> if set, login() RAISES this exception (transport error)
      account_raises   -> if set, account_info() RAISES this exception
      terminal_info_raises -> if set, terminal_info() RAISES this exception
      last_error_raises -> if set, last_error() RAISES this exception (transport
                           died on the last_error() round-trip itself)
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self.login_calls: list[tuple] = []
        self.shutdown_calls = 0
        self.initialize_calls = 0
        self.call_order: list[str] = []
        self.deals_window: tuple | None = None
        self.order_check_kwargs: dict | None = None

    def initialize(self, **kwargs):
        # The real terminal needs initialize() before any call (attaches IPC).
        # **kwargs because initialize() carries its own `timeout=` ms ceiling
        # (153.3 / D-24) — a double that refused it would TypeError on every login.
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


def test_materialize_degenerate_shape_raises():
    """A deal without ._asdict() is a degenerate shape -> fail loud, never coerce."""

    class _NoAsdict:
        pass

    connect, _fake, _rec = _make({"deals": (_NoAsdict(),)})
    client = Mt5Client("host", 18812, _connect=connect)
    with pytest.raises(Mt5ClientError):
        client.history_deals_get(0, 1)


# -- close: bounded + idempotent ---------------------------------------------


def test_close_is_idempotent_and_swallows_shutdown_errors():
    """A shutdown() that raises must not propagate; a second close() is a no-op
    (shutdown is never called twice)."""
    connect, fake, _rec = _make({"shutdown_raises": True})
    client = Mt5Client("host", 18812, _connect=connect)
    client.close()  # must not raise even though shutdown() boom-s
    client.close()  # idempotent no-op
    assert fake.shutdown_calls == 1


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
    _closed) then restart(), a subsequent close() must actually reach shutdown()
    again (shutdown_calls advances), proving restart cleared _closed. A restart
    that left _closed set would leave the fresh terminal un-closable, leaking the
    session on the next teardown."""
    connect, fake, _record = _make({})
    client = Mt5Client("host", 18812, _connect=connect)

    client.close()
    assert fake.shutdown_calls == 1  # close() reached shutdown
    client.restart()
    assert fake.shutdown_calls == 2  # restart's own teardown
    client.close()
    assert fake.shutdown_calls == 3  # _closed was cleared → close() works again


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
        "restart",
    }
