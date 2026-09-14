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
import math
import os
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
      ``initialize_after_heal``      -> what a BARE `initialize()` returns AFTER a
                                        credentialed one succeeded (default True)
      ``reprobe_raises``             -> exception the POST-HEAL bare `initialize()`
                                        raises (falls back to `initialize_raises`)
      ``last_error``                 -> the `(code, text)` tuple (default (0, ...))
      ``last_error_after_heal``      -> the `(code, text)` tuple once a credentialed
                                        call has been accepted (falls back to
                                        ``last_error``)

    ⭐ The bare and credentialed forms are SEPARATE scenario keys because the whole
    branch under test is "answer the detector one way, the heal another". A double
    that answered both identically could not express the `-6`-then-healed sequence
    at all.

    ⭐ AND IT IS STATEFUL ACROSS THE HEAL (WR-02). A real terminal that accepts a
    credentialed `initialize()` then answers a BARE one truthily — that is what
    "the session is authorized now" MEANS, and it is the only thing the re-probe
    can measure. `initialize_after_heal` is the knob that expresses the case the
    re-probe exists for: the broker accepted the CONNECTION and rejected the
    ACCOUNT, so the credentialed call returned truthy and the session is still
    down. A stateless double could not tell those two apart, which is exactly why
    the un-probed `healed` verdict looked correct.

    ⛔ IN-04 (round 2) — THE POST-HEAL BRANCH USED TO SHORT-CIRCUIT THE WHOLE BODY.
    `initialize_after_heal` was consulted BEFORE `initialize_raises` and
    `initialize_sleep_s`, so the double was STRUCTURALLY INCAPABLE of expressing a
    re-probe that faults at the TRANSPORT — the Wine bridge dropping, or a modal
    dialog appearing, between the credentialed call and the re-probe. That is
    precisely the case the re-probe's own verdict classifier exists for, and it is
    why it had no failing test available. The post-heal arm now consults the sleep
    and the raise first, and `last_error_after_heal` lets the SECOND round-trip
    answer a different code than the first.
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self._MetaTrader5__conn = _FakeRpycConn()
        self.initialize_kwargs: list[dict] = []
        self.call_order: list[str] = []
        self.credentialed_accepted = False
        #: ⭐ EVERY remote round-trip, `last_error` included — the quantity
        #: `_MT5_RELOGIN_ROUND_TRIPS` is a budget for. Deliberately a SECOND list
        #: rather than an addition to `call_order`: that one is asserted
        #: `==`-exactly by a dozen cases whose subject is the credential branch,
        #: and folding a bookkeeping call into it would make every one of them
        #: restate a fact they are not about.
        self.round_trips: list[str] = []

    def initialize(self, **kwargs):
        credentialed = "login" in kwargs
        self.initialize_kwargs.append(dict(kwargs))
        self.call_order.append(
            "initialize_credentialed" if credentialed else "initialize"
        )
        self.round_trips.append(
            "initialize_credentialed" if credentialed else "initialize"
        )
        post_heal = not credentialed and self.credentialed_accepted
        sleep_s = self._scenario.get("initialize_sleep_s")
        if sleep_s:
            # A REAL blocking sleep, on whatever thread the call arrives on — the
            # offline stand-in for a wedged terminal. It is what lets the
            # `wait_for` bound be observed rather than asserted.
            import time as _time

            _time.sleep(sleep_s)
        if post_heal:
            # ⭐ The re-probe is a REAL round-trip over the same wedgeable bridge,
            # so it can raise like any other. `reprobe_raises` expresses a fault
            # that appeared BETWEEN the credentialed call and the re-probe;
            # falling back to `initialize_raises` keeps a bridge that was already
            # down staying down.
            exc = self._scenario.get(
                "reprobe_raises", self._scenario.get("initialize_raises")
            )
            if exc is not None:
                raise exc
            return self._scenario.get("initialize_after_heal", True)
        key = (
            "initialize_credentialed_raises" if credentialed else "initialize_raises"
        )
        exc = self._scenario.get(key)
        if exc is not None:
            raise exc
        result = self._scenario.get(
            "initialize_credentialed" if credentialed else "initialize", True
        )
        if credentialed and result:
            self.credentialed_accepted = True
        return result

    def last_error(self):
        self.round_trips.append("last_error")
        if self.credentialed_accepted and "last_error_after_heal" in self._scenario:
            return self._scenario["last_error_after_heal"]
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


#: HIGH-1's "starting" line. It is emitted on every path that reaches the lease, so
#: a test asserting "an OUTCOME was reported" must exclude it or it would pass on
#: the strength of the announcement alone.
_STARTING_FRAGMENT = "mt5 boot heal: starting"


def _outcome_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    """Every record EXCEPT the "starting" announcement.

    ⛔ ANTI-VACUITY. HIGH-1 added a line before the lease precisely so an empty log
    becomes unambiguous — which means `assert records` is no longer evidence that
    an OUTCOME was reported. Every test whose subject is "the heal said what
    happened" must filter it out, or HIGH-1's own fix would have made those tests
    pass for free.
    """
    return [r for r in _records(caplog) if _STARTING_FRAGMENT not in r.getMessage()]


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


@pytest.mark.parametrize("off_value", [None, "", "1", "on", "false", "yes"])
async def test_the_disabled_kill_switch_return_IS_LOGGED_by_name(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, off_value
) -> None:
    """⛔ HIGH-1 — THE MODULE'S ONE UNLOGGED EXIT, CLOSED.

    This return used to emit NOTHING, which made an empty operator log
    simultaneously consistent with FIVE hypotheses: MT5 disabled, the
    `create_task` entry reverted, the import failing, the process killed before
    the task was scheduled, or `LOG_LEVEL` raised above INFO. Every OTHER early
    return in this module already logs, and `_log_configuration_fault_once`'s own
    docstring states the doctrine it violated — *"LOG-AND-PROCEED, never silence …
    silence is the defect class this milestone exists to remove"*.

    ⛔ IT MUST NAME `MT5_ENABLED`. The switch is `.strip().lower() == "true"`, so
    `1`, `on` and `yes` all read OFF (this parametrization is that claim, measured)
    — a future edit to any of them would otherwise disable the heal with an empty
    log and no way to tell it from a crash. Naming the variable in the line is what
    turns that into a one-glance answer.
    """
    _set_full_env(monkeypatch)
    if off_value is None:
        monkeypatch.delenv("MT5_ENABLED", raising=False)
    else:
        monkeypatch.setenv("MT5_ENABLED", off_value)
    _install_client(monkeypatch, {"initialize": True})

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _outcome_records(caplog)
    assert len(records) == 1, (
        f"the disabled kill switch emitted {len(records)} outcome records, "
        f"expected exactly ONE: {[r.getMessage() for r in records]}"
    )
    message = records[0].getMessage()
    assert "MT5_ENABLED" in message, (
        f"the disabled return did not NAME the kill switch: {message!r}. Without "
        "the name an operator cannot tell 'MT5 is off' from 'the heal never ran'."
    )
    assert "skipped" in message.lower()
    assert records[0].levelno == logging.INFO, (
        f"the disabled return logged at {records[0].levelname}; a deliberate "
        "operator choice is not a fault and must not sit at WARNING beside real "
        "misconfiguration (WR-01's severity ladder)"
    )
    _assert_no_credential_value_escaped(_records(caplog))


#: Every way out of `heal_mt5_terminal_session`, as a driver that provokes it.
#: ⛔ HIGH-1's claim is "there is no silent exit", and a claim of that shape is only
#: worth anything as a CENSUS. A new early return added without a log line reds
#: here rather than being discovered from an empty production log.
def _exit_kill_switch_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MT5_ENABLED", "false")


def _exit_credentials_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MT5_PASSWORD", raising=False)


def _exit_credentials_invalid(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MT5_LOGIN", "not-a-number")


def _exit_gateway_absent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MT5_GATEWAY_HOST", raising=False)


def _exit_gateway_port_not_numeric(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MT5_GATEWAY_PORT", "not-a-port")


def _exit_normal_verdict(monkeypatch: pytest.MonkeyPatch) -> None:
    return None


@pytest.mark.parametrize(
    "provoke",
    [
        pytest.param(_exit_kill_switch_off, id="kill-switch-off"),
        pytest.param(_exit_credentials_absent, id="credentials-absent"),
        pytest.param(_exit_credentials_invalid, id="credentials-invalid"),
        pytest.param(_exit_gateway_absent, id="gateway-absent"),
        pytest.param(_exit_gateway_port_not_numeric, id="gateway-port-not-numeric"),
        pytest.param(_exit_normal_verdict, id="normal-verdict"),
    ],
)
async def test_NO_exit_from_the_heal_is_silent(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, provoke
) -> None:
    """⛔ HIGH-1 AS A CENSUS, not as a single case.

    The heal is a fire-and-forget task on the boot path; the operator's ONLY
    artefact is the log. So every way out of it must leave exactly that artefact,
    and the property worth gating is the universal one rather than the one exit
    that happened to be found. ⛔ The "starting" announcement is EXCLUDED from the
    count (`_outcome_records`), or HIGH-1's own fix would make this pass for free
    on every path that reaches the lease.
    """
    _set_full_env(monkeypatch)
    provoke(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert _outcome_records(caplog), (
        "this exit from the heal emitted NO outcome record — an empty operator "
        "log then means 'MT5 disabled' and 'the task never ran' at the same time, "
        "which is the defect class this milestone exists to remove (HIGH-1)"
    )
    _assert_no_credential_value_escaped(_records(caplog))


async def test_the_heal_ANNOUNCES_itself_before_it_takes_the_lease(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ HIGH-1's second half, and the ORDER is the property.

    An outcome line alone still leaves an empty log ambiguous whenever the heal
    dies between the task being scheduled and the outcome being decided — a lease
    that never returns, a `to_thread` that never comes back, a SIGKILL mid-budget.
    The announcement is what makes an empty log mean "the task never ran" and
    nothing else, and it is only worth that if it lands BEFORE the first thing that
    can hang.

    The ordering is MEASURED, not read off the source: the lease wrapper records
    how many records existed at acquisition time.
    """
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    seen_at_acquire: list[list[str]] = []
    real = mt5_relogin.mt5_terminal_lease

    @asynccontextmanager
    async def _recording(terminal_key: str, *, wait_s=None):
        seen_at_acquire.append([r.getMessage() for r in _records(caplog)])
        async with real(terminal_key, wait_s=wait_s):
            yield

    monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", _recording)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert len(seen_at_acquire) == 1
    assert any(_STARTING_FRAGMENT in m for m in seen_at_acquire[0]), (
        "the heal took the terminal lease having announced NOTHING. A heal that "
        "then hangs in the lease or in `to_thread` leaves an empty log that is "
        "indistinguishable from a task that never started (HIGH-1). Recorded at "
        f"acquisition: {seen_at_acquire[0]!r}"
    )


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
# ⛔ THE TWO TUNING KNOBS — CR-02 / WR-06. A TYPO MUST NOT TAKE THE SERVICE DOWN,
# AND A PARSEABLE-BUT-ABSURD VALUE MUST NOT DISABLE THE HEAL OR STARVE THE BATCH.
# --------------------------------------------------------------------------- #

_TUNING_ENV_NAMES = ("MT5_RELOGIN_BUDGET_S", "MT5_RELOGIN_LEASE_WAIT_S")

#: Every value an operator can plausibly leave in a Railway variable, and what
#: each one did BEFORE this gate. ⛔ `"45s"`, `""` and `"60 x"` aborted uvicorn
#: startup at IMPORT — measured 2026-09-14,
#: `ValueError: could not convert string to float: '45s'` — and
#: `restartPolicyType ON_FAILURE x3` then took the WHOLE analytics service down.
#: `"0"` disabled the heal silently on every boot forever; `"inf"`/`"nan"` removed
#: the bound and held the terminal lease while the unbounded batch acquires
#: queued behind it.
_HOSTILE_TUNING_VALUES = ("45s", "", "   ", "60 x", "0", "-1", "inf", "-inf", "nan")


@pytest.mark.parametrize("name", _TUNING_ENV_NAMES)
@pytest.mark.parametrize("value", _HOSTILE_TUNING_VALUES)
def test_a_malformed_tuning_variable_cannot_abort_the_import(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
) -> None:
    """⛔ THE CRITICAL HALF (CR-02): RE-IMPORTING THE MODULE MUST NOT RAISE.

    `main.lifespan` does `from services.mt5_relogin import heal_mt5_terminal_session`
    in its body, BEFORE `yield` and outside any `try`. A `ValueError` at module
    scope therefore propagates out of the lifespan context manager and aborts
    uvicorn startup — the dispatch loop, the watchdog, the enqueue loop and
    `/health`, all gone, for a best-effort heal of a gateway nobody needed. That
    is verbatim the outcome D-08's comment in `main.lifespan` says the
    `create_task` shape prevents.

    ⚠️ `importlib.reload` is deliberately NOT used (the repo's own standing rule).
    The property under test is that NOTHING is parsed at import, so a fresh
    interpreter is the honest oracle — asserted by the subprocess case below —
    and this case asserts the module-level names simply do not exist any more,
    which is what makes the import safe in the first place.
    """
    monkeypatch.setenv(name, value)
    # The import is already done; the load-bearing assertion is that no
    # module-level constant holds a parsed value that a reimport would redo.
    assert not hasattr(mt5_relogin, "_MT5_RELOGIN_BUDGET_S"), (
        "the budget is a module-level parsed constant again — a malformed "
        "MT5_RELOGIN_BUDGET_S would abort uvicorn startup at import (CR-02)"
    )
    assert not hasattr(mt5_relogin, "_MT5_RELOGIN_LEASE_WAIT_S"), (
        "the lease wait is a module-level parsed constant again (CR-02)"
    )


def test_a_malformed_tuning_variable_cannot_abort_a_FRESH_import() -> None:
    """The same property in a FRESH interpreter, which is the only place an
    import-time parse can actually be observed.

    ⛔ This is the case that REDS on the shipped-before-CR-02 shape. The in-process
    case above can only assert the absence of a name; this one runs the import the
    way uvicorn runs it, against the exact variable value that took the service
    down.
    """
    import subprocess
    import sys

    env = dict(os.environ)
    env["MT5_RELOGIN_BUDGET_S"] = "45s"
    env["MT5_RELOGIN_LEASE_WAIT_S"] = "two seconds"
    proc = subprocess.run(
        [sys.executable, "-c", "import services.mt5_relogin"],
        cwd=str(Path(__file__).resolve().parents[1]),
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        "importing `services.mt5_relogin` with a malformed tuning variable "
        f"RAISED — this aborts uvicorn startup before `yield` and ON_FAILURE x3 "
        f"takes the whole analytics service down (CR-02). stderr:\n{proc.stderr}"
    )


@pytest.mark.parametrize("value", _HOSTILE_TUNING_VALUES)
async def test_a_hostile_budget_falls_back_to_the_derived_default_and_still_heals(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, value: str
) -> None:
    """⛔ WR-06 — `0` MUST NOT SILENTLY DISABLE THE HEAL AND `inf` MUST NOT HOLD
    THE TERMINAL LEASE.

    Both are values `float()` accepts, and both were previously handed verbatim to
    `asyncio.wait_for`. `0` cancelled immediately and logged "did not complete" on
    every boot FOREVER — indistinguishable from a transient gateway problem. `inf`
    removed the bound entirely while every batch caller acquires the same lease
    with `wait_s=None`, i.e. unbounded, so a best-effort heal took out the derive.

    The oracle is BEHAVIOURAL, not a read of the constant: with a hostile value the
    heal still reaches the terminal and still reports a real verdict.
    """
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_RELOGIN_BUDGET_S", value)
    fake, _c = _install_client(monkeypatch, {"initialize": True})

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == ["initialize"], (
        f"MT5_RELOGIN_BUDGET_S={value!r} stopped the heal from reaching the "
        "terminal at all — a tuning typo must fall back to the derived default, "
        "never disable the heal (WR-06)"
    )
    messages = [r.getMessage() for r in _records(caplog)]
    assert any("already_authorized" in m for m in messages), messages
    _assert_no_credential_value_escaped(_records(caplog))


@pytest.mark.parametrize("value", _HOSTILE_TUNING_VALUES)
async def test_a_hostile_lease_wait_falls_back_to_the_derived_default(
    monkeypatch: pytest.MonkeyPatch, value: str
) -> None:
    """The same, for the acquire bound. ⛔ The assertion that matters is that the
    lease is still acquired with a FINITE POSITIVE bound: `wait_s=0` would make
    the heal skip on every boot and `wait_s=inf` would put a best-effort heal
    ahead of real work in the terminal queue for as long as that work takes —
    the exact thing this bound exists to prevent (D-29)."""
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_RELOGIN_LEASE_WAIT_S", value)
    acquisitions = _install_lease_counter(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert len(acquisitions) == 1
    _key, wait_s = acquisitions[0]
    assert wait_s is not None and math.isfinite(wait_s) and wait_s > 0, (
        f"MT5_RELOGIN_LEASE_WAIT_S={value!r} reached the lease as {wait_s!r}. A "
        "tuning typo must fall back to the derived default (WR-06)."
    )


@pytest.mark.parametrize(
    "name,value,expected",
    [
        ("MT5_RELOGIN_BUDGET_S", "12.5", 12.5),
        ("MT5_RELOGIN_LEASE_WAIT_S", "5", 5.0),
    ],
)
def test_a_LEGITIMATE_tuning_value_is_still_honoured(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str, expected: float
) -> None:
    """⛔ ANTI-VACUITY for the two tests above: a reader that IGNORED the
    environment entirely and always returned the default would satisfy every
    hostile-value assertion. This is the half that can only pass if the knob is
    genuinely read."""
    reader = (
        mt5_relogin._relogin_budget_s
        if name == "MT5_RELOGIN_BUDGET_S"
        else mt5_relogin._relogin_lease_wait_s
    )
    monkeypatch.delenv(name, raising=False)
    default = reader()
    monkeypatch.setenv(name, value)
    assert reader() == expected
    assert default != expected, (
        "the legitimate value happens to EQUAL the derived default, so this case "
        "cannot distinguish a real read from a hardcoded return — pick another."
    )


@pytest.mark.parametrize("name", _TUNING_ENV_NAMES)
def test_a_rejected_tuning_value_is_logged_ONCE_by_NAME_and_never_by_value(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, name: str
) -> None:
    """D-02's posture, applied to the knobs: log-and-proceed, once per process,
    NAMES only. ⛔ Silence is the defect class this milestone exists to remove, so
    "it fell back to the default" must be visible in the operator's log — and the
    value must not be, because T-164.6.2-12 is names-only and an exception at one
    site is how a rule stops being one."""
    sentinel = "4242424-not-a-number"
    monkeypatch.setenv(name, sentinel)
    reader = (
        mt5_relogin._relogin_budget_s
        if name == "MT5_RELOGIN_BUDGET_S"
        else mt5_relogin._relogin_lease_wait_s
    )

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        reader()
        reader()

    records = _records(caplog)
    assert len(records) == 1, (
        f"expected exactly ONE record across two calls, got {len(records)} — the "
        "D-02 once-per-process throttle is not covering this reason key"
    )
    message = records[0].getMessage()
    assert name in message
    assert sentinel not in message, (
        f"the rejected value {sentinel!r} reached the log: {message!r}. ⛔ NAMES "
        "only — never a value, a length, a prefix or a hash (T-164.6.2-12)."
    )


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

    # ⭐ THREE calls, and the THIRD is WR-02's re-probe: the credential-free
    # detector run AGAIN, inside the same lease and the same budget, because the
    # credentialed call's own boolean is documented-as-untrustworthy and was
    # nonetheless the sole basis for the `healed` verdict.
    assert fake.call_order == [
        "initialize",
        "initialize_credentialed",
        "initialize",
    ]
    assert len([kw for kw in fake.initialize_kwargs if "login" in kw]) == 1, (
        "the credentialed form must be called EXACTLY once — the re-probe is the "
        "credential-FREE detector, and a probe that carried a credential could "
        "not be used to decide whether to send one"
    )
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
    record = _records(caplog)[-1]
    message = record.getMessage()
    assert str(ipc_code) in message
    assert "healed" not in message.replace("not_healed", "")

    # ⛔ WR-01 (severity). A wedged terminal behind a modal login dialog is a REAL
    # gateway outage; it was emitted at INFO while a merely-unset
    # `MT5_GATEWAY_PORT` is emitted at WARNING by `_log_configuration_fault_once`.
    # A severity inversion inside a milestone whose purpose is removing silent
    # failure.
    assert record.levelno == logging.WARNING, (
        f"a `not_healed` verdict was logged at {record.levelname}, not WARNING — "
        "it is logged BELOW a config typo while naming a real gateway outage"
    )
    # ⛔ WR-01 (detail). `code=0` is the sentinel `_raise_last` uses for THREE
    # distinct faults, so the code alone cannot be the whole verdict.
    assert "No IPC connection" in message, (
        "the verdict threw away the already-scrubbed failure detail — the "
        "operator's only artefact was a bare code, and `code=0` names three "
        "different faults (WR-01)"
    )
    _assert_no_credential_value_escaped(_records(caplog))


async def test_a_heal_the_broker_did_not_honour_is_NOT_reported_as_healed(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ WR-02 — THE VERDICT IS MEASURED, NOT ASSUMED.

    `_heal_blocking` used to return `healed` on the sole basis that
    `initialize_with_credentials` did not raise — i.e. it named the verdict after
    exactly the signal both docstrings say, twice and emphatically, must never be
    trusted ("the oracle is the NEXT probe, never this call's own boolean"). There
    was no next probe anywhere in the module, in `main.lifespan`, or on the boot
    path.

    THE CASE THIS CATCHES, and it is the silent-UNKNOWN class the milestone has
    spent four phases closing: the broker accepts the CONNECTION and rejects the
    ACCOUNT — a password rotated twice, a server rename. The credentialed
    `initialize()` returns TRUTHY, the gateway is still down, and the log read
    `healed`. An operator reads a green line and looks elsewhere.
    """
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
            # The terminal STILL has no authorized account after the heal.
            "initialize_after_heal": False,
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == [
        "initialize",
        "initialize_credentialed",
        "initialize",
    ]
    record = _records(caplog)[-1]
    message = record.getMessage()
    assert "still_unauthorized" in message, (
        f"the heal reported {message!r} for a terminal that is STILL at -6. The "
        "credentialed call's own boolean is not an oracle — re-probe (WR-02)."
    )
    assert message.replace("not_healed", "").count("healed") == 0
    assert record.levelno == logging.WARNING
    _assert_no_credential_value_escaped(_records(caplog))


async def test_the_budget_covers_every_round_trip_the_worst_case_path_makes(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ WR-02 (round 2) — THE BUDGET'S DERIVATION, MEASURED AGAINST THE PATH.

    `_MT5_RELOGIN_ROUND_TRIPS` was 4 and the path makes 5. The table's last row was
    missed: the re-probe is a DETECTOR, and a detector that answers falsy goes on to
    `_raise_last` -> `last_error()` exactly as the first one does.

    The five-trip path is not exotic. It is the path that produces
    `still_unauthorized` / `heal_sent_ipc_fault_on_reprobe` — the single most
    VALUABLE verdict this module emits, the one that says a human must act. At
    5 x 30 s = 150 s against a 130 s budget the `wait_for` fired mid-`last_error`
    on a slow Wine bridge, the lease released and bumped the generation, a zombie
    thread was left in flight against the shared terminal, and the operator got the
    generic `did not complete` INSTEAD of the verdict — precisely when a heal is
    most needed.

    ⛔ THE COUNT IS MEASURED FROM THE DOUBLE, NEVER RESTATED. A gate that asserted
    `_MT5_RELOGIN_ROUND_TRIPS == 5` against a hand-typed 5 would pin a number; this
    pins the DERIVATION, so a sixth round-trip added to the path reds here rather
    than silently re-opening the window.
    """
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
            "initialize_after_heal": False,
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.round_trips == [
        "initialize",
        "last_error",
        "initialize_credentialed",
        "initialize",
        "last_error",
    ], f"the worst-case path changed shape: {fake.round_trips}"

    measured = len(fake.round_trips)
    assert mt5_relogin._MT5_RELOGIN_ROUND_TRIPS >= measured, (
        f"the `-6` path makes {measured} bounded round-trips and the budget is "
        f"derived from only {mt5_relogin._MT5_RELOGIN_ROUND_TRIPS}. On a slow Wine "
        "bridge the `wait_for` fires MID-round-trip: the lease releases, bumps the "
        "generation, and abandons an in-flight call against the SHARED terminal, "
        "while the operator gets `did not complete` instead of the verdict."
    )

    monkeypatch.delenv("MT5_RELOGIN_BUDGET_S", raising=False)
    budget = mt5_relogin._relogin_budget_s()
    assert budget >= measured * mt5_relogin._MT5_REQUEST_TIMEOUT_S, (
        f"the derived default budget {budget}s does not cover {measured} x "
        f"{mt5_relogin._MT5_REQUEST_TIMEOUT_S}s of rpyc ceilings"
    )
    assert budget <= mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S, (
        f"the derived default {budget}s now EXCEEDS its own ceiling "
        f"{mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S}s — the ceiling is derived "
        "from the 15-minute dispatch ceiling the unbounded batch acquires wait "
        "against, so raising it means arguing about THAT, not about this line"
    )


@pytest.mark.parametrize("ipc_code", [-10003, -10004, -10005])
async def test_an_ipc_fault_ON_THE_REPROBE_is_not_reported_as_still_unauthorized(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, ipc_code: int
) -> None:
    """⛔ WR-01 (round 2) — THE RE-PROBE USED TO REPORT A SESSION VERDICT IT HAD NOT
    MEASURED.

    The FIRST probe branches, and this module argues at length for why: `-6` is
    ours, and anything else is an IPC fault whose remedy is the OPPOSITE one, so
    conflating them "re-collapses exactly the distinction Phase 164.1 built". The
    SECOND probe did not branch — EVERY code became `still_unauthorized`.

    THE REACHABLE SEQUENCE, and it is this test: the heal succeeds, and then the
    Wine bridge drops (`-10004`) or a modal dialog appears (`-10005`) before the
    re-probe returns. The verdict read `not_healed:still_unauthorized:code=-10004`,
    the operator rotated the broker password — and the session was fine. The
    actual remedy was restart-the-pipe / look at the VNC screen.

    ⛔ WR-02 existed to stop the log asserting unmeasured session state. This arm
    reintroduced it in the other direction.

    ⚠️ This test is why IN-04 had to land first: `_FakeMt5` consulted
    `initialize_after_heal` BEFORE `initialize_raises`, so the post-heal transport
    fault below could not be expressed at all.
    """
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
            # The heal landed; the BRIDGE then dropped before the re-probe returned.
            "initialize_after_heal": False,
            "last_error_after_heal": (ipc_code, "No IPC connection"),
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == [
        "initialize",
        "initialize_credentialed",
        "initialize",
    ]
    record = _outcome_records(caplog)[-1]
    message = record.getMessage()
    assert str(ipc_code) in message
    assert "still_unauthorized" not in message, (
        f"the re-probe reported {message!r} for a code it never classified. "
        f"`{ipc_code}` is an IPC fault — a wedged pipe or a modal dialog — and "
        "the operator reading `still_unauthorized` rotates a broker password that "
        "is fine while the terminal stays wedged (WR-01 round 2)."
    )
    assert "reprobe" in message, (
        f"the verdict does not say WHERE the fault appeared: {message!r}. A fault "
        "on the re-probe means the heal was SENT and its effect is unknown, which "
        "is a different operator action than a fault on the first probe."
    )
    assert record.levelno == logging.WARNING
    _assert_no_credential_value_escaped(_records(caplog))


async def test_the_reprobe_STILL_says_still_unauthorized_for_a_genuine_minus_six(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ ANTI-VACUITY for the case above. A classifier that answered
    `heal_sent_ipc_fault_on_reprobe` for EVERY code would satisfy every assertion
    there while destroying WR-02's own verdict — the one that catches a broker
    accepting the CONNECTION and rejecting the ACCOUNT. `-6` on the re-probe is
    still, and only, `still_unauthorized`.
    """
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
            "initialize_after_heal": False,
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    message = _outcome_records(caplog)[-1].getMessage()
    assert "still_unauthorized" in message, (
        f"a genuine post-heal `-6` was reported as {message!r} — WR-02's verdict, "
        "the one that catches a broker rejecting the ACCOUNT, has been classified "
        "away"
    )
    assert "reprobe" not in message.replace("still_unauthorized", "")


async def test_a_REFUSED_credential_is_a_verdict_and_never_a_transient_miss(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ HIGH-2 — THE ONE CREDENTIAL-CARRYING CALL THAT HAD NO VERDICT.

    `initialize_with_credentials` sat UNGUARDED between two typed-handler blocks.
    The reachable case is mundane and permanent: `MT5_PASSWORD` is rotated at the
    broker and not updated in Railway. The detector correctly answers `-6`, the
    credentialed verb is refused, `_raise_last` raises `Mt5ClientError` — and it
    escaped to the entry's catch-all, where the operator read *"mt5 boot heal did
    not complete — continuing without it … the next boot will try again"*.

    That is this module's wording for a TRANSIENT fault, and the truth is the
    opposite: nothing heals on this boot or on any future one until a human edits
    a Railway variable. "The next boot will try again" is an actively misleading
    sentence there.

    ⛔ It also bypassed WR-01's severity ladder BY CONSTRUCTION — the ladder keys
    off the `not_healed:` prefix and a verdict that is never produced carries no
    prefix — so the one outcome that NAMES a human action was logged at the same
    level as a gateway blip.
    """
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            # The broker REFUSES the rotated credential. `initialize_with_credentials`
            # raises `Mt5ClientError` through `_raise_last`, exactly as the shipped
            # client does on a falsy credentialed return.
            "initialize_credentialed": False,
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert fake.call_order == ["initialize", "initialize_credentialed"], (
        "the re-probe must NOT run after a refusal — there is nothing to re-probe "
        f"and the verdict is already known: {fake.call_order}"
    )
    record = _outcome_records(caplog)[-1]
    message = record.getMessage()
    assert "credential_refused" in message, (
        f"a refused credential was reported as {message!r}. The catch-all's "
        "wording ('the next boot will try again') describes a transient miss; a "
        "rotated password is permanent until a human edits Railway (HIGH-2)."
    )
    assert "did not complete" not in message, (
        "the refusal still escaped to the entry's catch-all (HIGH-2)"
    )
    assert "code=" in message, (
        "the refusal carries no `code=` token, so it is the only failure here an "
        "operator cannot classify (WR-01's detail half)"
    )
    assert record.levelno == logging.WARNING, (
        f"a refused credential was logged at {record.levelname} — WR-01's ladder "
        "keys off the `not_healed:` prefix, and a verdict built without "
        "`_not_healed` is silently demoted to INFO"
    )
    _assert_no_credential_value_escaped(_records(caplog))


async def test_the_entry_catch_all_redacts_BY_VALUE_not_merely_by_shape(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ HIGH-2 (secondary) — THE LAST HANDLER ON THE PATH, MADE STRUCTURALLY SAFE.

    The catch-all redacted with `scrub_freeform_string` ALONE, which
    `_redact_credential_values`' own docstring records as a MEASURED NO-OP on the
    `mt5linux` kwargs-repr shape: `SENSITIVE_KEY_VALUE` needs `key` immediately
    followed by `[:=]`, and the repr puts a closing quote between them. The handler
    was therefore safe only by the CALLEE's discipline — every credential-carrying
    verb in `mt5_client` redacts before raising — and not by its own.

    ⛔ An inherited property is one refactor away from being absent, and this is the
    last handler on a path that carries a live broker password to a PUBLIC Actions
    log. The oracle here is an exception raised from a step that does NOT redact:
    `_heal_blocking` itself, replaced by one that raises the raw kwargs-repr text.
    """
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    # ⛔ The EXACT production shape: mt5linux 0.1.9 builds its remote call as
    # SOURCE TEXT, `f'mt5.initialize(*{args},**{kwargs})'`, so the credentials
    # arrive in a remote traceback as the repr() OF A DICT.
    raw = (
        "rpyc remote error while eval'ing mt5.initialize(*(),**"
        + repr(
            {
                "login": int(_FAKE_LOGIN),
                "password": _FAKE_PASSWORD,
                "server": _FAKE_SERVER,
            }
        )
        + ")"
    )

    def _raises_raw(*_a: object, **_k: object) -> str:
        raise RuntimeError(raw)

    monkeypatch.setattr(mt5_relogin, "_heal_blocking", _raises_raw)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    assert any("did not complete" in r.getMessage() for r in records), records
    _assert_no_credential_value_escaped(records)
    assert "[REDACTED]" in records[-1].getMessage(), (
        "nothing was redacted at all — the absence assertions above would then "
        "pass vacuously against a message that dropped the detail entirely"
    )


async def test_the_catch_all_still_describes_a_failure_raised_BEFORE_the_credentials(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ THE OTHER HALF OF HIGH-2 (secondary), and it is the one a naive fix breaks.

    The by-value pass needs the three values, and on the kill-switch and
    credential-read paths there are none. A handler that referenced an unbound
    local would raise `NameError` from INSIDE itself and silently demote every
    early failure to the argument-free fallback line — trading one silent class for
    another. And placeholder values would be worse than useless: a placeholder
    login of `0` would replace every `0` in the message with the marker.

    So the `None` arm shape-scrubs, and this asserts the description SURVIVES.
    """
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _fail_at_kill_switch(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    message = _outcome_records(caplog)[-1].getMessage()
    assert "did not complete" in message
    assert "RuntimeError" in message, (
        f"the pre-credential failure lost its class: {message!r} — that is the "
        "argument-free FALLBACK line, which means the handler itself raised"
    )
    assert "kill-switch read blew up" in message, (
        f"the pre-credential failure lost its description: {message!r}"
    )


async def test_a_verdict_detail_echoed_back_by_the_terminal_is_redacted_BY_VALUE(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ WR-01's detail is carried, and that is exactly why it must be redacted BY
    VALUE rather than merely shape-scrubbed.

    `Mt5ClientError.__init__` scrubs at construction, but that scrub is SHAPE
    based — and this text is the TERMINAL's own `last_error()` message, which a
    broker is free to echo the submitted account or server back into as bare
    literals. `_heal_blocking` has the three values in scope, so the shipped
    by-value control travels with them (T-164.6.2-12).

    ⛔ Without this case, WR-01's fix would have OPENED a disclosure path while
    closing a legibility one.
    """
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (
                -10004,
                f"No IPC connection for {_FAKE_LOGIN} on {_FAKE_SERVER}",
            ),
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    _assert_no_credential_value_escaped(records)
    assert "[REDACTED]" in records[-1].getMessage(), (
        "nothing was redacted at all — the absence assertions above would pass "
        "vacuously against a message that dropped the detail entirely"
    )


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
    # ⛔ The ENVIRONMENT, not a module attribute — CR-02 moved the knob to a
    # per-call read, and a `setattr` on the old constant would now be a NO-OP
    # that left the default 100 s budget in force. The 0.4 s double would finish,
    # the heal would report `healed`, and the assertion below would red while
    # LOOKING like a budget regression. Driving the real reader is also strictly
    # more: it exercises the parse and the range check this test depends on.
    monkeypatch.setenv("MT5_RELOGIN_BUDGET_S", "0.05")
    _install_client(monkeypatch, {"initialize": True, "initialize_sleep_s": 0.4})

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    messages = [r.getMessage() for r in _records(caplog)]
    assert any("did not complete" in m for m in messages), messages


def _heal_guard_defects(source: str) -> list[str]:
    """THE NEVER-RAISES PREDICATE, as a reusable function returning NAMED defects.

    Extracted from the test below so the WR-04 calibration case can MUTATE the
    source and observe the predicate go red. A structural gate that is only ever
    run against the file it polices is indistinguishable from one that returns the
    empty list — the same argument `test_the_criterion_1_predicate_reds_on_a_mutant_
    with_the_entry_excised` already makes for the lifespan pin.
    """
    fn = ast.parse(source).body[0]
    if not isinstance(fn, ast.AsyncFunctionDef):
        return ["the parsed node is not an async function"]

    body = [
        node
        for node in fn.body
        if not (
            isinstance(node, ast.Expr)
            and isinstance(node.value, ast.Constant)
            and isinstance(node.value.value, str)
        )
    ]
    defects: list[str] = []
    if len(body) != 1 or not isinstance(body[0], ast.Try):
        return [
            f"{len(body)} top-level statements outside the docstring; exactly ONE "
            "is allowed and it must be the `try`"
        ]

    guard = body[0]
    if len(guard.handlers) != 1:
        defects.append(f"expected ONE handler, got {len(guard.handlers)}")
    else:
        handler = guard.handlers[0]
        if not (
            isinstance(handler.type, ast.Name) and handler.type.id == "Exception"
        ):
            defects.append("the handler does not catch bare `Exception`")
        # ⛔ IN-06 — THE HANDLER BODY IS PART OF THE PROPERTY. `logger.warning`'s
        # ARGUMENTS are evaluated before it is entered, and stdlib `logging`
        # swallows formatting errors during emit but NOT the evaluation of its
        # arguments. `str(exc)` on an exception whose `__str__` misbehaves, or a
        # RecursionError/MemoryError at an exhausted stack, escapes the guard
        # from INSIDE it. The body must therefore be exactly one nested `Try`
        # with a `BaseException` handler.
        nested = [node for node in handler.body if isinstance(node, ast.Try)]
        if len(handler.body) != 1 or not nested:
            defects.append(
                f"the handler body has {len(handler.body)} statements and "
                f"{len(nested)} nested `try` — it must be EXACTLY one nested "
                "`try`, because its own argument evaluation is unguarded (IN-06)"
            )
        else:
            inner = nested[0]
            inner_types = [
                h.type.id
                for h in inner.handlers
                if isinstance(h.type, ast.Name)
            ]
            if inner_types != ["BaseException"]:
                defects.append(
                    f"the nested handler catches {inner_types}, not "
                    "['BaseException'] — a fallback narrower than the failure "
                    "class it catches is not a fallback"
                )
            if inner.finalbody or inner.orelse:
                defects.append(
                    "the nested guard grew a `finally:`/`else:` — same escape "
                    "route as the outer one"
                )

    # ⛔ WR-04 — `finalbody` and `orelse` sit OUTSIDE the handler. A cleanup
    # `finally:` (a metric flush, a bookkeeping line, a `logger.info` formatting a
    # value that is `None` on the early-return paths) raises straight past the
    # catch, reaches `main.lifespan`'s `_crash_handler`, and `SHUTDOWN.set()`
    # stops the dispatch, watchdog and enqueue loops behind a green `/health` —
    # the exact silent analytics outage this gate is the control for. The gate
    # asserted none of this and stayed green over both.
    if guard.finalbody:
        defects.append(
            "the guard grew a `finally:` — its body sits OUTSIDE the handler, so "
            "a raise there reaches _crash_handler and stops the worker loops "
            "behind a green /health"
        )
    if guard.orelse:
        defects.append("the guard grew an `else:` — same escape route")

    dumped = ast.dump(ast.Module(body=guard.body, type_ignores=[]))
    if "mt5_enabled_server" not in dumped:
        defects.append(
            "the kill-switch read is no longer inside the guard — the guard must "
            "cover the body from the kill switch onward"
        )
    return defects


def _heal_source() -> str:
    return textwrap.dedent(inspect.getsource(mt5_relogin.heal_mt5_terminal_session))


def test_the_heal_body_sits_entirely_inside_one_top_level_except_exception() -> None:
    """THE NEVER-RAISES PROPERTY AS A SHAPE, and it is not a duplicate of the
    behaviour tests.

    A future edit can add a statement OUTSIDE the guard — an env read, a log line,
    an early `import` — and no behaviour test above would notice, because none of
    them injects a failure at a statement that does not exist yet. This asserts the
    structure instead: the function's body is EXACTLY one `Try`, it has NO
    `finally:` and NO `else:` (WR-04 — both sit outside the handler), its single
    handler catches bare `Exception`, that handler's own body is itself guarded
    (IN-06), and the kill-switch read is INSIDE it.
    """
    assert _heal_guard_defects(_heal_source()) == []


#: The mutants, and each one is an escape route the gate was blind to before
#: WR-04/IN-06. ⛔ Every entry must RED the predicate; a mutant the predicate
#: tolerates is a hole, and this list is the proof the new assertions BITE rather
#: than merely being present. The file already uses this idiom in
#: `test_the_criterion_1_predicate_reds_on_a_mutant_with_the_entry_excised`.
#:
#: ⛔ EVERY MUTANT MUST BE VALID PYTHON, and that is not pedantry. A first draft
#: spliced `finally:` BEFORE the `except:` — which is a SyntaxError, so the
#: calibration "passed" without the `finalbody` assertion ever being reached. A
#: mutant that cannot parse tests the parser, not the gate; the assertion below
#: therefore requires a clean parse AND a named defect.
_HEAL_GUARD_MUTANTS: dict[str, tuple[str, str]] = {
    # Appended at the OUTER `try`'s indent level, after every handler, so it
    # attaches to the guard itself — the real shape a cleanup edit would take.
    "finally-outside-the-handler": (
        "APPEND",
        "\n    finally:\n        raise RuntimeError('cleanup')\n",
    ),
    "else-outside-the-handler": (
        "APPEND",
        "\n    else:\n        raise RuntimeError('else')\n",
    ),
    "narrowed-handler": (
        "    except Exception as exc:",
        "    except ValueError as exc:",
    ),
    # IN-06's two halves: a fallback NARROWER than the failure class it catches,
    # and an UNGUARDED statement added to the handler body beside the nested try.
    "fallback-narrower-than-the-failure": (
        "        except BaseException:",
        "        except Exception:",
    ),
    "handler-body-grew-an-unguarded-statement": (
        "APPEND",
        "\n        logger.info('an unguarded extra %s', type(exc).__name__)\n",
    ),
}


@pytest.mark.parametrize("mutant_id", sorted(_HEAL_GUARD_MUTANTS))
def test_the_never_raises_predicate_REDS_on_every_escape_route(mutant_id: str) -> None:
    """⛔ THE CALIBRATION. Without it, the WR-04 assertions and the IN-06 one are
    claims about the source rather than a gate: a predicate that never fires is
    indistinguishable from one that cannot.

    Each mutant is spliced into a COPY of the shipped source — nothing on disk is
    touched — and the predicate must PARSE it and then name a defect. ⛔ A splice
    that silently failed to apply would read as a passing gate, so the mutation is
    asserted to have changed the text first.
    """
    needle, replacement = _HEAL_GUARD_MUTANTS[mutant_id]
    source = _heal_source()
    if needle == "APPEND":
        mutated = source.rstrip("\n") + replacement
    else:
        assert needle in source, (
            f"the mutation anchor {needle!r} is no longer in the source — the "
            "mutant would not apply and this test would pass VACUOUSLY"
        )
        mutated = source.replace(needle, replacement, 1)
    assert mutated != source

    # ⛔ Parsed OUTSIDE the try, deliberately: an unparseable mutant must FAIL
    # this test rather than be excused by it.
    defects = _heal_guard_defects(mutated)
    assert defects, (
        f"the never-raises predicate tolerated the {mutant_id!r} mutant — that "
        "escape route reaches `main.lifespan`'s `_crash_handler`, which calls "
        "SHUTDOWN.set() and stops the dispatch, watchdog and enqueue loops behind "
        "a green /health"
    )


async def test_the_handler_body_cannot_escape_the_guard_either(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ IN-06, BEHAVIOURALLY. The structural half above says the handler body is
    wrapped; this says the wrap WORKS against the failure it exists for.

    The phase's declared standard is "structurally incapable", not "unlikely", and
    `type(exc).__name__` / `scrub_freeform_string(str(exc))` are evaluated as
    ARGUMENTS — i.e. before `logger.warning` is entered and outside any guard.
    An exception whose `__str__` raises is the reachable representative of that
    class.
    """

    class _UnprintableError(Exception):
        def __str__(self) -> str:
            raise RuntimeError("this exception cannot describe itself")

    def _boom(*_a: object, **_k: object) -> str:
        raise _UnprintableError()

    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    monkeypatch.setattr(mt5_relogin, "_heal_blocking", _boom)

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _records(caplog)
    assert records, (
        "the heal swallowed a failure and emitted NOTHING — silence is the defect "
        "class this milestone removes"
    )
    assert "did not complete" in records[-1].getMessage()


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


# --------------------------------------------------------------------------- #
# ⛔ CRITERION 1's WIRING — `main.lifespan`, by SOURCE INSPECTION ONLY.
#
# ⛔ NO TEST HERE EXECUTES `main.lifespan`. It starts job-claiming loops, and a
# local run claims REAL prod compute jobs. The repo's precedent for lifespan pins
# is AST/source inspection and there are two shipped examples to copy
# (`test_secret_misconfig_signal.py`, `test_local_worker_prod_guard.py`).
# --------------------------------------------------------------------------- #

#: The heal's public entry, as `main.lifespan` must name it.
_HEAL_SYMBOL = "heal_mt5_terminal_session"

#: ⛔ HAND-TYPED. MEASURED 2026-09-13 (Phase 164.6.2 plan 02): `main.lifespan`
#: carried FOUR `create_task` calls before this plan (dispatch_loop, watchdog_loop,
#: daily_enqueue_loop, healthz_bridge) and carries FIVE after it.
#:
#: ⭐ THIS IS THE ANTI-VACUITY LEG and it is not decoration. Without it, a
#: `_heal_task_lines` predicate that silently stopped matching — a renamed symbol,
#: a changed call shape — would report "zero calls found" and the criterion-1 pin
#: would red for the right reason; but a predicate that matched NOTHING AT ALL for
#: a different reason (a `lifespan` the walk can no longer find) would make BOTH
#: halves vacuous together. The count is measured independently of the heal's name.
_LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2 = 5


def _main_source() -> str:
    return (Path(__file__).resolve().parents[1] / "main.py").read_text()


def _lifespan_node(source: str) -> ast.AsyncFunctionDef:
    tree = ast.parse(source)
    node = next(
        (
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.AsyncFunctionDef) and n.name == "lifespan"
        ),
        None,
    )
    assert node is not None, (
        "harness: main.py no longer defines an async `lifespan` — re-anchor these "
        "pins rather than deleting them."
    )
    return node


def _heal_task_lines(source: str) -> list[int]:
    """Lines of every ``create_task(heal_mt5_terminal_session(...))`` in
    ``lifespan``.

    Both halves are required at once — the call must be to the heal AND it must be
    the argument of a `create_task`. A bare `await heal_mt5_terminal_session()`
    therefore reports ZERO here, which is correct: an inline await is the OTHER
    way this wiring takes the service down.
    """
    lines: list[int] = []
    for node in ast.walk(_lifespan_node(source)):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "create_task"
        ):
            continue
        for arg in node.args:
            if (
                isinstance(arg, ast.Call)
                and isinstance(arg.func, ast.Name)
                and arg.func.id == _HEAL_SYMBOL
            ):
                lines.append(node.lineno)
    return sorted(lines)


def _create_task_lines(source: str) -> list[int]:
    return sorted(
        node.lineno
        for node in ast.walk(_lifespan_node(source))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "create_task"
    )


def _named_call_lines(source: str, name: str) -> list[int]:
    return sorted(
        node.lineno
        for node in ast.walk(_lifespan_node(source))
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == name
    )


def test_CRITERION_1_lifespan_starts_the_heal_exactly_once_as_a_task() -> None:
    """⛔ CRITERION 1's WIRING: the analytics WORKER re-establishes the terminal's
    session ONCE at its own startup, in `main.lifespan`.

    This is the test criterion 1 requires to FAIL when the call is removed — see
    `test_the_criterion_1_predicate_reds_on_a_mutant_with_the_entry_excised` below
    for the durable, in-suite falsifier, and the plan-02 SUMMARY for the manual
    two-lever transcript.
    """
    source = _main_source()
    heal_lines = _heal_task_lines(source)
    assert len(heal_lines) == 1, (
        f"`main.lifespan` must start {_HEAL_SYMBOL}() EXACTLY ONCE inside a "
        f"create_task; found {len(heal_lines)} at {heal_lines}. Zero means the "
        f"criterion-1 wiring is gone — production would never heal a lost broker "
        f"session and the whole phase would be inert."
    )

    tasks = _create_task_lines(source)
    assert len(tasks) == _LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2, (
        f"`main.lifespan` now creates {len(tasks)} tasks; "
        f"{_LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2} were measured at 164.6.2-02. "
        f"This count is the ANTI-VACUITY leg: it is measured independently of the "
        f"heal's NAME, so a predicate that silently stopped matching cannot take "
        f"both halves of this pin down together. Re-cut it deliberately."
    )


def test_the_heal_is_never_awaited_inline_and_runs_after_both_startup_guards() -> None:
    """ORDERING, and both directions take the service down if they move.

      * BEFORE the guards -> the two SHIPPED ordering pins red
        (`test_lifespan_calls_the_startup_assertion_before_starting_the_worker`
        splits on the minimum create_task line;
        `test_merged_lifespan_calls_the_guard` splits the comment-stripped source
        at the FIRST create_task and demands the prod guard in the prefix).
      * awaited inline -> uvicorn's startup aborts on an unreachable gateway, and
        `restartPolicyMaxRetries = 3` turns that into a dead analytics service.
    """
    source = _main_source()
    heal_line = _heal_task_lines(source)[0]

    secret_check = _named_call_lines(source, "assert_platform_secrets_configured")
    prod_guard = _named_call_lines(
        source, "assert_worker_not_aimed_at_prod_off_platform"
    )
    assert len(secret_check) == 1 and len(prod_guard) == 1, (
        f"harness: expected exactly one call to each startup guard, got "
        f"{secret_check} and {prod_guard}"
    )
    assert heal_line > secret_check[0], "the heal must start AFTER the secret check"
    assert heal_line > prod_guard[0], "the heal must start AFTER the prod guard"

    # NOT awaited inline: every `await <name>(...)` in lifespan, and the heal must
    # not be among them.
    awaited = {
        node.value.func.id
        for node in ast.walk(_lifespan_node(source))
        if isinstance(node, ast.Await)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
    }
    assert _HEAL_SYMBOL not in awaited, (
        f"{_HEAL_SYMBOL} is awaited INLINE in lifespan. An await before `yield` "
        f"aborts uvicorn's startup; three of those under ON_FAILURE take the whole "
        f"analytics service down for a gateway nobody needed."
    )


def test_the_heal_task_is_named_and_tracked_like_the_worker_loops() -> None:
    """The heal joins the EXISTING `tasks` list — the one `_crash_handler` is
    attached to and the one the shutdown `gather` ranges over — rather than being
    orphaned beside it. An untracked task is neither crash-reported nor awaited at
    shutdown."""
    source = _main_source()
    lifespan = _lifespan_node(source)

    task_lists = [
        node
        for node in ast.walk(lifespan)
        if isinstance(node, ast.Assign)
        and any(
            isinstance(t, ast.Name) and t.id == "tasks" for t in node.targets
        )
        and isinstance(node.value, ast.List)
    ]
    assert len(task_lists) == 1, (
        f"harness: expected ONE `tasks = [...]` literal in lifespan, got "
        f"{len(task_lists)}"
    )
    elements = task_lists[0].value.elts

    healed = [
        el
        for el in elements
        if isinstance(el, ast.Call)
        and isinstance(el.func, ast.Attribute)
        and el.func.attr == "create_task"
        and any(
            isinstance(a, ast.Call)
            and isinstance(a.func, ast.Name)
            and a.func.id == _HEAL_SYMBOL
            for a in el.args
        )
    ]
    assert len(healed) == 1, (
        f"the heal's create_task is not a member of lifespan's `tasks` list "
        f"({len(healed)} found). Outside that list it gets no `_crash_handler` "
        f"and is not awaited by the shutdown gather — an orphan."
    )
    names = [kw.value for kw in healed[0].keywords if kw.arg == "name"]
    assert names and isinstance(names[0], ast.Constant) and names[0].value, (
        "the heal's task carries no explicit `name=` — an unnamed task reports as "
        "`Task-N` in the crash handler's log, which is unreadable at 3am."
    )


# --------------------------------------------------------------------------- #
# ⛔ THE TWO REFUSALS — T-140.1-24. Written against the LIVE objects, never
# against source text, so they measure what the handler actually answers.
# --------------------------------------------------------------------------- #


def test_the_mt5_variables_were_NOT_added_to_the_required_platform_secrets() -> None:
    """⛔ `REQUIRED_PLATFORM_SECRETS` is byte-unchanged, and the temptation is named
    here so it is REFUSED rather than rediscovered.

    That tuple is named REQUIRED. Railway's `healthcheckPath` is `/health`, and
    `config_ok` is derived from exactly this tuple — so adding an OPTIONAL variable
    to it reddens `/health`'s config verdict the moment it is unset, converting a
    thirty-second human config gap into a pod restart loop. That is T-140.1-24
    verbatim, recorded in `assert_platform_secrets_configured`'s own docstring.

    ⭐ If a future phase wants an "MT5 is configured" signal on /health, it is a
    SEPARATE key that moves neither `status` nor `config_ok` — and it is not this
    phase's.
    """
    import main

    assert main.REQUIRED_PLATFORM_SECRETS == ("SERVICE_KEY", "INTERNAL_API_TOKEN"), (
        f"REQUIRED_PLATFORM_SECRETS moved to {main.REQUIRED_PLATFORM_SECRETS}. If "
        f"an MT5 name was added: an unset OPTIONAL variable now reddens config_ok "
        f"behind Railway's healthcheckPath — a restart loop, not a signal "
        f"(T-140.1-24)."
    )
    for name in ("MT5_LOGIN", "MT5_PASSWORD", "MT5_SERVER", "MT5_ENABLED"):
        assert name not in main.REQUIRED_PLATFORM_SECRETS


async def test_the_health_body_gained_no_mt5_key() -> None:
    """⛔ `/health`'s body carries no MT5 key. `status` stays the WORKER-heartbeat
    verdict and `config_ok` stays the SECRET verdict; crossing them is the bug.

    Asserted against the LIVE handler's answer, not its source: a source-text pin
    would stay green if the key were added through a helper.
    """
    import json

    import main
    from fastapi.responses import JSONResponse

    answer = await main.health()
    body = (
        json.loads(bytes(answer.body).decode())
        if isinstance(answer, JSONResponse)
        else answer
    )
    offenders = [key for key in body if "mt5" in key.lower()]
    assert not offenders, (
        f"/health's body gained MT5 key(s) {offenders}. Railway restarts the pod "
        f"on a red /health; an MT5 term there couples a gateway nobody needs to "
        f"the analytics service's liveness (T-140.1-24)."
    )
    # And the two verdict keys are still the ones that were there.
    assert {"status", "config_ok", "config_degraded_secrets"} <= set(body)


# --------------------------------------------------------------------------- #
# ⛔ THE DURABLE FALSIFIER — criterion 1's "a test that FAILS when the call is
# removed", re-checked on EVERY CI run rather than once in a session transcript.
#
# The manual two-lever harness (byte backup -> neuter -> prove it applied ->
# observe RED -> `cmp`-verified restore) is recorded verbatim in the plan-02
# SUMMARY. A transcript proves the property ONCE, in a file nobody re-runs. This
# proves it again on every run — and it does so WITHOUT ever writing a mutant into
# the working tree, so the destructive-restore hazard the manual harness carries
# (a `git checkout --` would silently destroy the uncommitted work) simply does
# not arise here.
# --------------------------------------------------------------------------- #

#: The exact call shape the excision removes. Reading it back through the same
#: predicate the criterion-1 pin uses is the point: the mutant is judged by the
#: SHIPPED predicate, not by a second copy of it that could drift.
_HEAL_ENTRY_MARKER = f"create_task({_HEAL_SYMBOL}("

#: A surgical excision removes ONE list entry. MEASURED 2026-09-13: the line is
#: 72 characters including its indentation and newline. The ceiling is generous
#: enough to survive a rename and tight enough that a runaway deletion reds.
_MAX_EXCISED_CHARS = 200


def _excise_the_heal_entry(source: str) -> str:
    """An IN-MEMORY copy of `main.py` with the heal's `create_task` entry removed.

    ⛔ The mutant is never written to disk. This is deliberate and is the whole
    reason the durable half can be safe where the manual half needs a byte backup.
    """
    return "".join(
        line
        for line in source.splitlines(keepends=True)
        if _HEAL_ENTRY_MARKER not in line
    )


def test_the_criterion_1_predicate_reds_on_a_mutant_with_the_entry_excised() -> None:
    """⛔ CRITERION 1, DISCHARGED AS A MEASUREMENT.

    The criterion-1 predicate must return TRUE for the shipped source and FALSE for
    a source with the heal's task entry removed. A predicate that could not tell
    those apart would leave `test_CRITERION_1_lifespan_starts_the_heal_exactly_once
    _as_a_task` green over a production path that never heals anything — the whole
    phase inert behind a passing suite.

    ⭐ THE EXCISION IS PROVED SURGICAL FIRST. Without that, a green could come from
    having deleted half the file: an empty `lifespan` trivially contains no call to
    the heal, and the pin would "pass" for a reason that has nothing to do with the
    property.
    """
    source = _main_source()
    mutant = _excise_the_heal_entry(source)

    # --- the excision is surgical ------------------------------------------
    assert mutant != source, (
        f"the excision removed NOTHING — the marker {_HEAL_ENTRY_MARKER!r} no "
        f"longer matches the shipped wiring, so this falsifier is measuring an "
        f"absent mutation. ⛔ Fix the marker; a falsifier that mutates nothing "
        f"always 'passes'."
    )
    removed = len(source) - len(mutant)
    assert 0 < removed <= _MAX_EXCISED_CHARS, (
        f"the excision removed {removed} characters (ceiling "
        f"{_MAX_EXCISED_CHARS}). A runaway deletion makes the FALSE below "
        f"meaningless — an empty lifespan contains no heal call for reasons that "
        f"have nothing to do with the wiring."
    )
    ast.parse(mutant)  # the mutant must still be valid Python, or the walk is moot
    for survivor in (
        "dispatch_loop",
        "watchdog_loop",
        "daily_enqueue_loop",
        "_bridge_healthz",
    ):
        assert f"create_task({survivor}(" in mutant, (
            f"the excision also removed the {survivor} task entry — it was not "
            f"surgical and nothing below can be attributed to the heal."
        )

    # --- and the predicate tells them apart --------------------------------
    assert len(_heal_task_lines(source)) == 1, (
        "the criterion-1 predicate does not match the SHIPPED wiring — it is the "
        "predicate that is wrong, not the code."
    )
    assert _heal_task_lines(mutant) == [], (
        "the criterion-1 predicate STILL reports the heal after its task entry was "
        "excised. It is matching something other than the wiring, so removing the "
        "call would not red the pin — which is exactly the vacuous shape criterion "
        "1 forbids."
    )
    assert len(_create_task_lines(mutant)) == (
        _LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2 - 1
    ), "the count leg must fall by exactly one on the mutant"
