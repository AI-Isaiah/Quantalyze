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

import pathlib
import re
import sys
import threading
import time
import types

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
    """Every one of the NINE MT5 round-trips emits — asserted by driving each
    method against the double and comparing the collected stage names to a
    hand-typed set.

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
    ],
)
def test_session_abandoned_message_carries_no_classifier_token(stage):
    """D-42 — the refusal message must be DISJOINT from the classifier's substring
    tables, for EVERY stage name the fence can carry.

    `classify_mt5_login_error` matches by SUBSTRING, and the fenced stage names are
    themselves members of those tables: `terminal_info`/`connect` contain
    `terminal`/`connect`, `login`/`account_info` contain `login`/`account`. So an
    exception message that interpolated its stage — the obvious, natural way to
    write it — would re-run the documented `routers/exchange.py:678-684` incident,
    where an operator-side refusal became a 400 telling the user their BROKER
    SERVER was wrong.

    ⚠️ The tables are imported LIVE from `services/mt5_validation.py` on purpose.
    The invariant is disjointness from whatever the classifier actually matches on
    TODAY; a hand-copied table would go stale and stay green while the real
    classifier gained a token. It is not self-referential — the table lives in a
    DIFFERENT module from the one under test.
    """
    from services.mt5_validation import _AUTH_TOKENS, _WRONG_SERVER_TOKENS

    message = str(Mt5SessionAbandoned(stage)).lower()
    for token in (*_WRONG_SERVER_TOKENS, *_AUTH_TOKENS):
        assert token not in message, (
            f"the refusal message for stage {stage!r} contains the classifier "
            f"token {token!r} — a fenced zombie would be classified as the USER's "
            "credential failure and a working key blamed for our abandoned thread "
            "(the routers/exchange.py:678-684 incident)"
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
