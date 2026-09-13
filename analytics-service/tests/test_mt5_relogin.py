"""Phase 164.6.2 plan 02 — the MT5 BOOT HEAL, and the three things it must be
incapable of doing.

WHAT IS UNDER TEST. `services/mt5_relogin.py` re-establishes the shared Wine
terminal's broker session from `MT5_LOGIN` / `MT5_PASSWORD` / `MT5_SERVER`, once,
at the analytics worker's own startup (criterion 1, D-08). It is the FIRST code
path in this repo that routes one of those credentials, which is why plan 01 — the
by-value redaction on the credentialed `initialize()` arm — was an ORDERED
precondition rather than a convention.

THE THREE INCAPABILITIES, and why each is tested the way it is:

  1. **IT CANNOT RAISE.** `main.lifespan`'s `_crash_handler` calls `SHUTDOWN.set()`
     on ANY background-task exception, so a raising heal stops the dispatch,
     watchdog and enqueue loops while `/health` — the worker-heartbeat verdict,
     with its own startup grace — keeps answering. That is a SILENT ANALYTICS
     OUTAGE caused by an MT5 gateway nobody needed. The property is asserted
     BEHAVIOURALLY (every internal step made to raise, the coroutine still returns
     `None` AND emits a record) and STRUCTURALLY (the function's AST carries one
     top-level `except Exception` and nothing outside it) — because a future edit
     can add a statement outside the guard without any behaviour test noticing.
  2. **IT CANNOT BLOCK THE EVENT LOOP.** `rpyc.classic.connect` carries no timeout
     of its own, so the client must be constructed INSIDE the `to_thread` body
     where the caller's `wait_for` bounds it. Proved by recording the OS thread
     identity at construction, not by reading the source.
  3. **IT CANNOT TOUCH THE TERMINAL OUTSIDE ITS OWN LEASE.** Exactly one lease
     acquisition, bounded, with the client built and closed inside it.

DOUBLES, not mocks (the contract suite's idiom, copied deliberately). The
in-memory MT5 double is driven by a scenario dict through `Mt5Client`'s `_connect`
seam, so the REAL client — the real fence, the real redaction, the real ms
ceilings — is exercised and only the wire is faked. ⛔ A `MagicMock` would answer
`initialize(login=…)` and `initialize()` identically and the central branch of this
module would be untested.

⛔ NO REAL CREDENTIAL APPEARS HERE, and none ever may: the repo is PUBLIC and
`.planning/` is tracked. Every value below is obviously synthetic (D-04). ⛔ There
is also no `skipif` on a credential being present — doubles only means there is
nothing to gate on, and a test that skips in CI is a test that never runs.

⛔ NO TEST EXECUTES `main.lifespan`. It starts job-claiming loops; a local run
claims REAL prod compute jobs. The lifespan pins here are SOURCE/AST inspection,
the repo's own precedent (`tests/test_secret_misconfig_signal.py`,
`tests/test_local_worker_prod_guard.py`).
"""
from __future__ import annotations

import ast
import asyncio
import inspect
import logging
import textwrap
import threading
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

from services import mt5_concurrency, mt5_relogin
from services.mt5_client import Mt5Client
from services.mt5_concurrency import Mt5TerminalBusyError

# --------------------------------------------------------------------------- #
# The obviously-fake credential register. ⛔ Never a real login, password or
# broker server — this repo is PUBLIC (D-04).
# --------------------------------------------------------------------------- #
_FAKE_LOGIN = "4242424"
_FAKE_PASSWORD = "n0t-a-real-password"
_FAKE_SERVER = "Broker-Demo-2"
_FAKE_HOST = "gateway.test"
_FAKE_PORT = "18812"

_CREDENTIAL_LITERALS = (_FAKE_LOGIN, _FAKE_PASSWORD, _FAKE_SERVER)

_LOGGER_NAME = "quantalyze.analytics.mt5_relogin"


@pytest.fixture(autouse=True)
def _reset_state():
    """WIZFORM-ABANDON / D-36 plus D-02's once-per-process throttle.

    The terminal reset is the same ONE helper the contract suite uses: a leaked
    epoch bump fences a client the next test builds for the same `host:port`, which
    under `-n auto --dist loadgroup` is a flake mechanism, not a theory. The
    throttle reset is this module's own: a log-once set that survived into the next
    test would make "it logged" and "it stayed quiet" indistinguishable.
    """
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()


# --------------------------------------------------------------------------- #
# The doubles — the contract suite's shape, trimmed to what the heal reaches.
# --------------------------------------------------------------------------- #


class _FakeRpycConn:
    """The rpyc connection `mt5linux.MetaTrader5` hangs off its name-mangled
    `_MetaTrader5__conn` attribute — the ONLY transport-close seam 0.1.9 exposes,
    and therefore the one `Mt5Client.close()` reaches. Shaped, not mocked, so the
    close branch is genuinely exercised offline."""

    def __init__(self) -> None:
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1


class _FakeMt5:
    """In-memory MT5-shaped double driven by a scenario dict.

    Scenario keys (all optional):
      ``initialize``                 -> what a BARE `initialize()` returns (True)
      ``initialize_raises``          -> exception a BARE `initialize()` raises
      ``initialize_credentialed``    -> what a CREDENTIALED `initialize()` returns
      ``initialize_credentialed_raises`` -> exception the credentialed call raises
      ``initialize_sleep_s``         -> seconds every `initialize()` blocks for
      ``last_error``                 -> the `(code, text)` tuple (default (0, ...))

    ⭐ The bare and credentialed forms are SEPARATE scenario keys because the whole
    branch under test is "answer the detector one way, the heal another". A double
    that answered both identically could not express the `-6`-then-healed sequence
    at all.
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self._MetaTrader5__conn = _FakeRpycConn()
        self.initialize_kwargs: list[dict] = []
        self.call_order: list[str] = []

    def initialize(self, **kwargs):
        credentialed = "login" in kwargs
        self.initialize_kwargs.append(dict(kwargs))
        self.call_order.append(
            "initialize_credentialed" if credentialed else "initialize"
        )
        sleep_s = self._scenario.get("initialize_sleep_s")
        if sleep_s:
            # A REAL blocking sleep, on whatever thread the call arrives on — the
            # offline stand-in for a wedged terminal. It is what lets the
            # `wait_for` bound be observed rather than asserted.
            import time as _time

            _time.sleep(sleep_s)
        key = (
            "initialize_credentialed_raises" if credentialed else "initialize_raises"
        )
        exc = self._scenario.get(key)
        if exc is not None:
            raise exc
        return self._scenario.get(
            "initialize_credentialed" if credentialed else "initialize", True
        )

    def last_error(self):
        return self._scenario.get("last_error", (0, "unknown"))

    def shutdown(self):  # pragma: no cover — the heal must never call it (D-35)
        raise AssertionError(
            "the boot heal called mt5.shutdown() — that destroys the ONE shared "
            "IPC pipe for EVERY concurrent caller (D-35)"
        )


def _install_client(monkeypatch: pytest.MonkeyPatch, scenario: dict):
    """Point `mt5_relogin.Mt5Client` at the real client wired to an in-memory wire.

    Returns ``(fake, constructions)``. ``constructions`` records
    ``(host, port, thread_ident)`` per construction, which is how both "the kill
    switch was consulted BEFORE anything was constructed" and "the client was built
    INSIDE the thread" become measurements rather than readings of the source.
    """
    fake = _FakeMt5(scenario)
    constructions: list[tuple[str, int, int]] = []

    def _connect(*, host, port, timeout):
        return fake

    def _factory(host: str, port: int, **kwargs) -> Mt5Client:
        constructions.append((host, port, threading.get_ident()))
        return Mt5Client(host, port, _connect=_connect, **kwargs)

    monkeypatch.setattr(mt5_relogin, "Mt5Client", _factory)
    return fake, constructions


def _install_lease_counter(monkeypatch: pytest.MonkeyPatch) -> list[tuple]:
    """Wrap — never replace — the REAL lease, recording `(key, wait_s)` per
    acquisition. The real one still runs, so its release discipline (the epoch
    bump, the un-stamp, the release) is still exercised."""
    acquisitions: list[tuple] = []
    real = mt5_relogin.mt5_terminal_lease

    @asynccontextmanager
    async def _counting(terminal_key: str, *, wait_s=None):
        acquisitions.append((terminal_key, wait_s))
        async with real(terminal_key, wait_s=wait_s):
            yield

    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", _counting)
    return acquisitions


def _set_full_env(monkeypatch: pytest.MonkeyPatch, *, enabled: str = "true") -> None:
    monkeypatch.setenv("MT5_ENABLED", enabled)
    monkeypatch.setenv("MT5_LOGIN", _FAKE_LOGIN)
    monkeypatch.setenv("MT5_PASSWORD", _FAKE_PASSWORD)
    monkeypatch.setenv("MT5_SERVER", _FAKE_SERVER)
    monkeypatch.setenv("MT5_GATEWAY_HOST", _FAKE_HOST)
    monkeypatch.setenv("MT5_GATEWAY_PORT", _FAKE_PORT)


def _records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == _LOGGER_NAME]


def _assert_no_credential_value_escaped(records) -> None:
    """Each of the three literals, checked INDIVIDUALLY, so a partial leak names
    which value escaped rather than reporting "something leaked"."""
    for record in records:
        message = record.getMessage()
        for literal in _CREDENTIAL_LITERALS:
            assert literal not in message, (
                f"the heal's log record disclosed a credential value "
                f"({literal!r}) in: {message!r}. ⛔ NAMES only — never a value, a "
                f"length, a prefix or a hash (T-164.6.2-12); these records reach "
                f"Railway logs and Sentry."
            )


# --------------------------------------------------------------------------- #
# The kill switch — consulted BEFORE anything is constructed (WR-08 residual)
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize("off_value", [None, "", "1", "on", "false", "yes"])
async def test_the_kill_switch_is_consulted_before_any_client_is_constructed(
    monkeypatch: pytest.MonkeyPatch, off_value
) -> None:
    """⛔ `mt5_enabled_server` is fail-CLOSED: unset, empty, "1", "on" and "false"
    all read OFF. With the switch off the heal returns having constructed NOTHING —
    provable because the `_connect` seam was never reached and the construction
    recorder is empty.

    ⚠️ `"TRUE "` is deliberately NOT in this list — see
    `test_the_kill_switch_tolerates_surrounding_whitespace_MEASURED` below, which
    records a measured contradiction between that claim and the shipped code.

    The ORDER is the point, not the return. The repo's WR-08 residual is a gate
    that sits AFTER the transport opened; repeating that shape at a second site —
    the first one that carries a credential — would be a knowing regression.
    """
    _set_full_env(monkeypatch)
    if off_value is None:
        monkeypatch.delenv("MT5_ENABLED", raising=False)
    else:
        monkeypatch.setenv("MT5_ENABLED", off_value)
    _fake, constructions = _install_client(monkeypatch, {})
    acquisitions = _install_lease_counter(monkeypatch)

    assert await mt5_relogin.heal_mt5_terminal_session() is None
    assert constructions == [], (
        "the heal constructed an Mt5Client with the kill switch OFF — the switch "
        "must be consulted before any transport is opened"
    )
    assert acquisitions == []


@pytest.mark.parametrize("on_value", ["true", "TRUE", "True", "TRUE ", " true"])
def test_the_kill_switch_tolerates_surrounding_whitespace_MEASURED(
    monkeypatch: pytest.MonkeyPatch, on_value: str
) -> None:
    """⛔ A MEASURED CONTRADICTION, recorded rather than designed around.

    `services/closed_sets.py` states — in three separate comment blocks, and the
    Phase 164.6.2 plan quotes it — that *"unset / \"\" / \"1\" / \"on\" / \"TRUE \"
    all read OFF"*. The shipped code does `(os.getenv(...) or "").strip().lower()
    == "true"`: it STRIPS BEFORE it lowercases, so `"TRUE "` and `" true"` read
    **ON**. Measured 2026-09-13 against the live function.

    This is a COMMENT that is wrong, not a gate that is broken — the switch is
    still fail-closed for every non-"true" token, and whitespace tolerance on an
    env var set by a human in a Railway text box is arguably the friendlier
    behaviour. But it is the OPPOSITE of what the comment promises a reader
    deciding whether a trailing space is safe, and the same sentence is copied onto
    `sfox_enabled_server` and one more gate in that file.

    ⛔ NOT fixed here. `services/closed_sets.py` is outside this plan's `<files>`,
    the claim appears at three sites across two independent kill switches, and
    re-wording a shipped fail-closed gate's contract from inside an unrelated
    execution is exactly the class of edit this repo forbids. Booked as
    `[164.6.2-KILLSWITCH-COMMENT-DRIFT]`. This test is the durable record: it reds
    if the SEMANTICS ever change, which is the half that matters.
    """
    monkeypatch.setenv("MT5_ENABLED", on_value)
    assert mt5_relogin.mt5_enabled_server() is True


# --------------------------------------------------------------------------- #
# D-02 — absent / invalid configuration logs ONCE, NAMES only, and returns
# --------------------------------------------------------------------------- #


async def test_absent_credentials_log_once_with_names_only_and_return(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The MEASURED normal case today: `MT5_LOGIN`/`MT5_PASSWORD`/`MT5_SERVER` are
    unset on the analytics service and stay unset until the founder sets them. The
    heal must log the MISSING NAMES, frame it as a SERVER misconfiguration, and
    return — never raise, never construct."""
    _set_full_env(monkeypatch)
    for name in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"):
        monkeypatch.delenv(name, raising=False)
    _fake, constructions = _install_client(monkeypatch, {})

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    assert len(records) == 1, f"expected exactly one record, got {records}"
    message = records[0].getMessage()
    for name in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER"):
        assert name in message
    assert "server misconfiguration" in message.lower()
    assert "credential failure" in message.lower()
    assert constructions == []


async def test_a_second_call_in_the_same_process_does_not_log_again(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """D-02's throttle. The heal runs once per boot today, but a second call in the
    same process must add NO second record — the once-per-process set is what keeps
    an unconfigured deploy from re-stating the same line forever."""
    _set_full_env(monkeypatch)
    monkeypatch.delenv("MT5_SERVER", raising=False)
    _install_client(monkeypatch, {})

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        await mt5_relogin.heal_mt5_terminal_session()
        first = len(_records(caplog))
        await mt5_relogin.heal_mt5_terminal_session()
        second = len(_records(caplog))

    assert first == 1
    assert second == 1, "the second call emitted a second record (D-02 throttle)"


async def test_structurally_invalid_credentials_log_once_and_disclose_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A non-numeric login passes the presence check and fails the ONE fail-closed
    offline parse seam (`parse_mt5_credentials`). It must log once in the SERVER
    misconfiguration register, raise nothing, construct nothing — and the record
    must carry no credential value."""
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_LOGIN", "not-a-number")
    _fake, constructions = _install_client(monkeypatch, {})

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    assert len(records) == 1
    assert "server misconfiguration" in records[0].getMessage().lower()
    _assert_no_credential_value_escaped(records)
    assert constructions == []


@pytest.mark.parametrize(
    "mutate",
    [
        pytest.param(lambda mp: mp.delenv("MT5_GATEWAY_HOST", raising=False), id="host-absent"),
        pytest.param(lambda mp: mp.delenv("MT5_GATEWAY_PORT", raising=False), id="port-absent"),
        pytest.param(lambda mp: mp.setenv("MT5_GATEWAY_PORT", "not-a-port"), id="port-not-numeric"),
    ],
)
async def test_an_unusable_gateway_endpoint_logs_once_and_constructs_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, mutate
) -> None:
    """⛔ The gateway reader does NOT copy `_make_mt5_session`'s `RuntimeError`.
    That raise is right for a JOB that cannot proceed and wrong here, where the
    caller is the worker's boot (D-02)."""
    _set_full_env(monkeypatch)
    mutate(monkeypatch)
    _fake, constructions = _install_client(monkeypatch, {})

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    assert len(records) == 1
    assert "server misconfiguration" in records[0].getMessage().lower()
    _assert_no_credential_value_escaped(records)
    assert constructions == []


# --------------------------------------------------------------------------- #
# The branch: already authorized / -6 / an IPC code
# --------------------------------------------------------------------------- #


async def test_an_already_authorized_terminal_is_never_sent_a_credential(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A truthy bare `initialize()` means a session already exists. ⛔ The
    credentialed form is then NEVER called: a credential sent to a terminal that
    did not need one is a disclosure surface opened for nothing."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, {"initialize": True})

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == ["initialize"]
    assert not any("login" in kw for kw in fake.initialize_kwargs), (
        f"the heal sent a credential to an already-authorized terminal: "
        f"{fake.initialize_kwargs}"
    )
    assert "already_authorized" in _records(caplog)[-1].getMessage()


async def test_a_minus_six_terminal_is_healed_with_the_values_from_the_environment(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ CRITERION 1's economic content, asserted against the DOUBLE'S RECORDED
    KWARGS and never against the implementation's own formula.

    `-6` is the ONE fault this heals: the saved Wine session was refused while the
    RPyC bridge is healthy. The credentialed `initialize()` is called EXACTLY ONCE
    and carries the login, password and server taken FROM THE ENVIRONMENT.
    """
    _set_full_env(monkeypatch)
    fake, constructions = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == ["initialize", "initialize_credentialed"]
    credentialed = [kw for kw in fake.initialize_kwargs if "login" in kw]
    assert len(credentialed) == 1, f"expected ONE credentialed call: {credentialed}"
    assert credentialed[0]["login"] == int(_FAKE_LOGIN)
    assert credentialed[0]["password"] == _FAKE_PASSWORD
    assert credentialed[0]["server"] == _FAKE_SERVER
    assert "healed" in _records(caplog)[-1].getMessage()
    assert [(h, p) for h, p, _t in constructions] == [(_FAKE_HOST, int(_FAKE_PORT))]


@pytest.mark.parametrize("ipc_code", [-10003, -10004, -10005])
async def test_an_ipc_fault_is_not_healed_and_the_verdict_names_the_code(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, ipc_code: int
) -> None:
    """⛔ An IPC code is a WEDGED PIPE, and its remedy is the OPPOSITE one — restart
    the terminal, look at the VNC screen. Re-sending a credential heals nothing
    there and would re-collapse exactly the distinction Phase 164.1 built and
    Phase 164.8.3 shipped."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch, {"initialize": False, "last_error": (ipc_code, "No IPC connection")}
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == ["initialize"]
    assert not any("login" in kw for kw in fake.initialize_kwargs)
    message = _records(caplog)[-1].getMessage()
    assert str(ipc_code) in message
    assert "healed" not in message.replace("not_healed", "")


# --------------------------------------------------------------------------- #
# ⛔ THE NEVER-RAISES PROPERTY — behaviourally, then structurally
# --------------------------------------------------------------------------- #


def _fail_at_kill_switch(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom() -> bool:
        raise RuntimeError("kill-switch read blew up")

    monkeypatch.setattr(mt5_relogin, "mt5_enabled_server", _boom)


def _fail_at_credential_read(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom():
        raise ValueError("credential read blew up")

    monkeypatch.setattr(mt5_relogin, "read_env_mt5_credentials", _boom)


def _fail_at_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    @asynccontextmanager
    async def _busy(terminal_key: str, *, wait_s=None):
        raise Mt5TerminalBusyError(
            "the MT5 terminal was still in use when the acquisition bound expired"
        )
        yield  # pragma: no cover — unreachable, keeps this a generator

    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", _busy)


def _fail_in_the_blocking_body(monkeypatch: pytest.MonkeyPatch) -> None:
    def _boom(*_a: object, **_k: object) -> str:
        raise KeyError("something nobody anticipated")

    monkeypatch.setattr(mt5_relogin, "_heal_blocking", _boom)


def _fail_at_construction(monkeypatch: pytest.MonkeyPatch) -> None:
    def _factory(host: str, port: int, **_k: object) -> Mt5Client:
        raise OSError("rpyc connect refused")

    monkeypatch.setattr(mt5_relogin, "Mt5Client", _factory)


@pytest.mark.parametrize(
    "inject",
    [
        pytest.param(_fail_at_kill_switch, id="kill-switch-raises"),
        pytest.param(_fail_at_credential_read, id="credential-read-raises"),
        pytest.param(_fail_at_lease, id="lease-raises-busy"),
        pytest.param(_fail_in_the_blocking_body, id="blocking-body-raises"),
        pytest.param(_fail_at_construction, id="transport-connect-raises"),
    ],
)
async def test_no_failure_mode_escapes_the_heal(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, inject
) -> None:
    """⛔ THE CONTROL THAT STANDS BETWEEN A GATEWAY OUTAGE AND AN ANALYTICS OUTAGE.

    Every one of these is raised from a DIFFERENT step, including the very first
    one inside the guard (the kill-switch read), because the guard must cover the
    body from there onward and not merely from the transport onward.

    BOTH halves are asserted: the coroutine returns `None`, AND a record was
    emitted. A swallow test without the log half cannot tell a handled failure from
    a silent one — and silence is the defect class this whole milestone exists to
    remove.
    """
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    inject(monkeypatch)

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    assert records, (
        "the heal swallowed a failure and emitted NOTHING — a silent swallow is "
        "the defect class this milestone removes"
    )
    _assert_no_credential_value_escaped(records)


async def test_a_hung_terminal_is_abandoned_at_the_budget_and_raises_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The `wait_for` bound, OBSERVED rather than asserted: the double really
    blocks its thread, and the budget really fires.

    ⚠️ The thread is NOT cancelled — it keeps running while the lease releases and
    bumps the terminal's generation, after which the zombie's next touch is refused
    by the client's own D-36 fence. That is the designed behaviour.
    """
    _set_full_env(monkeypatch)
    monkeypatch.setattr(mt5_relogin, "_MT5_RELOGIN_BUDGET_S", 0.05)
    _install_client(monkeypatch, {"initialize": True, "initialize_sleep_s": 0.4})

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    messages = [r.getMessage() for r in _records(caplog)]
    assert any("did not complete" in m for m in messages), messages


def test_the_heal_body_sits_entirely_inside_one_top_level_except_exception() -> None:
    """THE NEVER-RAISES PROPERTY AS A SHAPE, and it is not a duplicate of the
    behaviour tests.

    A future edit can add a statement OUTSIDE the guard — an env read, a log line,
    an early `import` — and no behaviour test above would notice, because none of
    them injects a failure at a statement that does not exist yet. This asserts the
    structure instead: the function's body is EXACTLY one `Try`, its single handler
    catches bare `Exception`, and the kill-switch read is INSIDE it.
    """
    source = textwrap.dedent(inspect.getsource(mt5_relogin.heal_mt5_terminal_session))
    fn = ast.parse(source).body[0]
    assert isinstance(fn, ast.AsyncFunctionDef)

    body = [
        node
        for node in fn.body
        if not (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        )
    ]
    assert len(body) == 1 and isinstance(body[0], ast.Try), (
        f"`heal_mt5_terminal_session` has {len(body)} top-level statements outside "
        f"its docstring; exactly ONE is allowed and it must be the `try`. A "
        f"statement outside the guard can raise into `main.lifespan`'s "
        f"`_crash_handler`, which calls SHUTDOWN.set() and stops the dispatch, "
        f"watchdog and enqueue loops behind a green /health."
    )

    handlers = body[0].handlers
    assert len(handlers) == 1, f"expected ONE handler, got {len(handlers)}"
    assert isinstance(handlers[0].type, ast.Name), handlers[0].type
    assert handlers[0].type.id == "Exception", (
        f"the handler catches {handlers[0].type.id}, not bare `Exception`. ⛔ "
        f"Narrowing it re-opens the crash-handler route."
    )

    dumped = ast.dump(ast.Module(body=body[0].body, type_ignores=[]))
    assert "mt5_enabled_server" in dumped, (
        "the kill-switch read is no longer inside the guard — the guard must cover "
        "the body from the kill switch onward"
    )


# --------------------------------------------------------------------------- #
# The lease, the thread, and the teardown
# --------------------------------------------------------------------------- #


async def test_exactly_one_bounded_lease_over_a_client_built_inside_the_thread(
    monkeypatch: pytest.MonkeyPatch
) -> None:
    """Three properties in one measurement, because they are one design decision.

      * ONE lease acquisition — the `==`-asserted production roster in
        `tests/test_mt5_concurrency.py` counts the STRUCTURAL half; this is the
        runtime half.
      * BOUNDED — a terminal already busy at boot means the heal is SKIPPED rather
        than queued ahead of real work. A busy terminal is a terminal somebody is
        already using, which is itself evidence the session is fine.
      * the client is constructed on ANOTHER OS THREAD — i.e. inside the
        `to_thread` body, where the caller's `wait_for` can bound the rpyc connect
        that carries no timeout of its own.
    """
    _set_full_env(monkeypatch)
    _fake, constructions = _install_client(monkeypatch, {"initialize": True})
    acquisitions = _install_lease_counter(monkeypatch)

    await mt5_relogin.heal_mt5_terminal_session()

    assert len(acquisitions) == 1, f"expected ONE lease acquisition: {acquisitions}"
    key, wait_s = acquisitions[0]
    assert key == f"{_FAKE_HOST}:{_FAKE_PORT}"
    assert wait_s is not None and wait_s > 0, (
        "the boot heal took an UNBOUNDED lease acquire — it would queue a "
        "best-effort heal ahead of real work (D-29's bounded arm exists for "
        "exactly this)"
    )

    assert len(constructions) == 1
    assert constructions[0][2] != threading.get_ident(), (
        "the Mt5Client was constructed on the EVENT LOOP's thread. "
        "`rpyc.classic.connect` carries no timeout of its own, so a blackholed "
        "mesh address would block /health against Railway's 120s "
        "healthcheckTimeout — construct inside the `to_thread` body."
    )


@pytest.mark.parametrize(
    "scenario,expect_credentialed",
    [
        pytest.param({"initialize": True}, False, id="already-authorized"),
        pytest.param(
            {
                "initialize": False,
                "last_error": (-6, "Terminal: Authorization failed"),
                "initialize_credentialed": True,
            },
            True,
            id="healed",
        ),
        pytest.param(
            {
                "initialize": False,
                "last_error": (-6, "Terminal: Authorization failed"),
                "initialize_credentialed_raises": RuntimeError(
                    f"rpyc remote error while eval'ing mt5.initialize("
                    f"{_FAKE_LOGIN}, password='{_FAKE_PASSWORD}', "
                    f"server='{_FAKE_SERVER}')"
                ),
            },
            True,
            id="heal-raises-at-the-transport",
        ),
        pytest.param(
            {"initialize_raises": RuntimeError("bridge down")}, False, id="detector-raises"
        ),
    ],
)
async def test_the_client_is_closed_on_every_path(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    scenario: dict,
    expect_credentialed: bool,
) -> None:
    """Success and failure alike. A client left open holds an rpyc session against
    the gateway's `ThreadedServer` with no owner and no reaper (Pitfall 6).

    ⭐ The `heal-raises-at-the-transport` case is also the plan-01 dependency in
    action: the transport text carries all three credential literals verbatim —
    exactly the `mt5linux` f-string interpolation T-134-01 names — and the by-value
    redaction on the credentialed arm is what keeps them out of this log.
    """
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, scenario)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake._MetaTrader5__conn.close_calls == 1, (
        f"the rpyc transport was closed {fake._MetaTrader5__conn.close_calls} "
        f"times; expected exactly once on every path"
    )
    assert any("login" in kw for kw in fake.initialize_kwargs) is expect_credentialed
    _assert_no_credential_value_escaped(_records(caplog))
