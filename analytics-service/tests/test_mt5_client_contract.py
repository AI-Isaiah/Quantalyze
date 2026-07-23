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

import pytest

from services.mt5_client import (
    MT5_LOGIN_TIMEOUT_MS,
    MT5_REQUEST_TIMEOUT_S,
    Mt5Client,
    Mt5ClientError,
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
      deals            -> value history_deals_get() returns
      order_check      -> value order_check() returns
      last_error       -> tuple last_error() returns (default (0, "unknown"))
      shutdown_raises  -> if truthy, shutdown() raises
      login_raises     -> if set, login() RAISES this exception (transport error)
      account_raises   -> if set, account_info() RAISES this exception
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self.login_calls: list[tuple] = []
        self.shutdown_calls = 0

    def login(self, login, **kwargs):
        self.login_calls.append((login, kwargs))
        exc = self._scenario.get("login_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("login", True)

    def account_info(self):
        exc = self._scenario.get("account_raises")
        if exc is not None:
            raise exc
        return self._scenario.get("account")

    def history_deals_get(self, from_ts, to_ts):
        return self._scenario.get("deals")

    def order_check(self, request):
        return self._scenario.get("order_check")

    def last_error(self):
        return self._scenario.get("last_error", (0, "unknown"))

    def shutdown(self):
        self.shutdown_calls += 1
        if self._scenario.get("shutdown_raises"):
            raise RuntimeError("shutdown boom")


def _make(scenario: dict):
    """Return (connect, fake, record). `record` captures the connect kwargs so the
    rpyc sync_request_timeout wiring can be asserted; `fake` exposes call logs."""
    fake = _FakeMt5(scenario)
    record: dict = {}

    def _connect(*, host, port, timeout):
        record["host"] = host
        record["port"] = port
        record["timeout"] = timeout
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
        "history_deals_get",
        "order_check",
        "close",
    }
