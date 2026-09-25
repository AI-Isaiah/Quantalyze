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

from services import mt5_concurrency, mt5_relogin, mt5_session_episodes
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
    # ⭐ 164.6.5 plan 05 — re-arms the ipc_fault escalation gate. A gate one test
    # disarmed would make the next test's "fires once" depend on test ORDER.
    mt5_session_episodes._reset_session_episode_state_for_tests()
    yield
    _FakeMt5.clock = None
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    mt5_session_episodes._reset_session_episode_state_for_tests()


# --------------------------------------------------------------------------- #
# The doubles — the contract suite's shape, trimmed to what the heal reaches.
# --------------------------------------------------------------------------- #


class _FakeClock:
    """The heal's clock, advanced ONLY by the doubles' crossings (and, from WR-02,
    by the heal's own sleeps). ⭐ It is what lets the budget be MEASURED against
    the one condition it exists for — every rpyc crossing taking its full ceiling
    — without a test waiting 280 real seconds (164.6.5 review round 1, WR-04)."""

    def __init__(self) -> None:
        self.now = 1_000.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


@pytest.fixture(autouse=True)
def _fake_clock(monkeypatch: pytest.MonkeyPatch) -> "_FakeClock":
    clock = _FakeClock()
    monkeypatch.setattr(mt5_relogin, "_clock", clock.monotonic)
    monkeypatch.setattr(mt5_relogin, "_sleep", clock.sleep)
    _FakeMt5.clock = clock
    return clock




class _FakeNamespace:
    """``conn.namespace`` — a NETREF on the real transport, so ``[name]`` is its
    own rpyc crossing (WR-04), recorded as one."""

    def __init__(self, owner: "_FakeMt5 | None", entries: dict) -> None:
        self._owner = owner
        self._entries = entries

    def __getitem__(self, name: str):
        if self._owner is not None:
            self._owner._trip("recycle_lookup")
        return self._entries[name]


class _FakeRpycConn:
    """The rpyc connection `mt5linux.MetaTrader5` hangs off its name-mangled
    `_MetaTrader5__conn` attribute — the ONLY transport-close seam 0.1.9 exposes,
    and therefore the one `Mt5Client.close()` reaches. Shaped, not mocked, so the
    close branch is genuinely exercised offline.

    ⭐ 164.6.5 plan 05 — IT ALSO CARRIES THE RECYCLE SEAM (`execute` +
    `namespace`), so the heal's escalation drives the REAL plan-02 verb — the real
    fence, the real `_guarded_read`, the real verdict parse and the real relaunch
    probe — and only the Win32 body on the far side of the wire is faked. It
    records EXACTLY what crossed: the executed source and the arguments of the
    remote call, which is what "no credential reaches the recycle" is asserted
    against. ``recycle_raises`` in the owner's scenario makes the remote call
    raise; a successful call marks the owner ``recycled`` so its next bare
    `initialize()` answers ``initialize_after_recycle``.
    """

    def __init__(self, owner: "_FakeMt5 | None" = None) -> None:
        self.close_calls = 0
        self._owner = owner
        self.executed: list[str] = []
        self.recycle_calls: list[tuple[tuple, dict]] = []

    def close(self) -> None:
        self.close_calls += 1

    def execute(self, source: str) -> None:
        # ⛔ WR-04 — an rpyc CROSSING, bounded only by `sync_request_timeout`, and
        # counted as one. The double used to record nothing here, so the gate that
        # "counts the path, never restates it" counted 8 because the double
        # under-reported the recycle's three crossings as one.
        if self._owner is not None:
            self._owner._trip("recycle_execute")
        self.executed.append(source)

    @property
    def namespace(self) -> "_FakeNamespace":
        from services import mt5_client as _mt5_client

        return _FakeNamespace(
            self._owner, {_mt5_client._REMOTE_TERMINAL_RECYCLE_FN: self._recycle}
        )

    def _recycle(self, *args, **kwargs) -> str:
        import json as _json

        self.recycle_calls.append((args, dict(kwargs)))
        owner = self._owner
        assert owner is not None, "the recycle seam needs its owning double"
        owner.call_order.append("recycle")
        owner._trip("recycle")
        exc = owner._scenario.get("recycle_raises")
        if exc is not None:
            raise exc
        owner.recycled = True
        owner.recycled_at = _FakeMt5.clock.now if _FakeMt5.clock is not None else 0.0
        hook = owner._scenario.get("after_recycle_crossed")
        if hook is not None:
            hook()
        # ⭐ WR-03 / SFH-01 — the counts are a SCENARIO KNOB. A double that always
        # answered (1, 1, 1) made every "the recycle landed" test pass by
        # construction: no case could express a recycle that ended nothing.
        matched, terminated, exited = owner._scenario.get("recycle_counts", (1, 1, 1))
        if terminated == 0:
            # Nothing was ended, so the next bare `initialize()` attaches to the
            # SAME, still-running terminal: the pre-recycle answers stand.
            owner.recycled = False
        return _json.dumps(
            {
                "matched": matched,
                "terminated": terminated,
                "exited": exited,
                "open_errors": owner._scenario.get("open_errors", []),
                "terminate_errors": owner._scenario.get("terminate_errors", []),
            }
        )


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
      ``terminal_info`` / ``account_info`` -> what those reads return (default
                                        ``None``, i.e. the terminal cannot answer)
      ``recycle_raises``             -> exception the remote recycle call raises
      ``initialize_after_recycle``   -> what a BARE `initialize()` returns once the
                                        terminal was recycled (falls back to
                                        ``initialize``)
      ``last_error_after_recycle``   -> the `(code, text)` tuple once recycled
                                        (falls back to ``last_error``)

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

    #: The shared `_FakeClock` (set by the autouse fixture). Every crossing
    #: advances it by the scenario's ``crossing_cost_s`` (default 0).
    clock: "_FakeClock | None" = None

    def _trip(self, name: str) -> None:
        """ONE rpyc crossing: recorded, and charged against the fake clock."""
        self.round_trips.append(name)
        if _FakeMt5.clock is not None:
            _FakeMt5.clock.now += self._scenario.get("crossing_costs", {}).get(
                name, self._scenario.get("crossing_cost_s", 0.0)
            )

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self._MetaTrader5__conn = _FakeRpycConn(self)
        #: 164.6.5 plan 05 — set by a successful remote recycle.
        self.recycled = False
        self.recycled_at = 0.0
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
        self._trip("initialize_credentialed" if credentialed else "initialize")
        post_heal = not credentialed and self.credentialed_accepted
        sleep_s = self._scenario.get("initialize_sleep_s")
        if sleep_s:
            # A REAL blocking sleep, on whatever thread the call arrives on — the
            # offline stand-in for a wedged terminal. It is what lets the
            # `wait_for` bound be observed rather than asserted.
            import time as _time

            _time.sleep(sleep_s)
        if not credentialed and self.recycled:
            # ⭐ 164.6.5 plan 05 — the terminal was ended and relaunched; what a
            # bare `initialize()` answers now is the scenario's post-recycle
            # state, defaulting to the pre-recycle one (a wedge that persists).
            after = self._scenario.get("relaunch_authorized_after_s")
            if after is not None and _FakeMt5.clock is not None:
                # ⭐ WR-02 — a relaunch that takes TIME, as the live spike measured
                # (86 s kill-to-authorized): answering only once that long has
                # passed on the heal's clock since the terminate crossed.
                return _FakeMt5.clock.now - self.recycled_at >= after
            return self._scenario.get(
                "initialize_after_recycle", self._scenario.get("initialize", True)
            )
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

    def terminal_info(self):
        self.call_order.append("terminal_info")
        self._trip("terminal_info")
        return self._scenario.get("terminal_info")

    def account_info(self):
        self.call_order.append("account_info")
        self._trip("account_info")
        return self._scenario.get("account_info")

    def login(self, *args, **kwargs):
        # ⭐ 164.6.5 SFH-05 — the JOB path's per-call login, reached only by the
        # gate proving a recovery the job path saw re-arms the escalation.
        self.call_order.append("login")
        self._trip("login")
        return self._scenario.get("login", True)

    def last_error(self):
        self._trip("last_error")
        if self.recycled and "last_error_after_recycle" in self._scenario:
            return self._scenario["last_error_after_recycle"]
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


@pytest.mark.parametrize(
    "provoke",
    [
        pytest.param(_exit_credentials_absent, id="credentials-absent"),
        pytest.param(_exit_credentials_invalid, id="credentials-invalid"),
        pytest.param(_exit_gateway_absent, id="gateway-absent"),
        pytest.param(_exit_gateway_port_not_numeric, id="gateway-port-not-numeric"),
    ],
)
async def test_a_configuration_refusal_is_COUNTED_as_a_not_measured_reading(
    monkeypatch: pytest.MonkeyPatch, sink: "_FakeCronRuns", provoke
) -> None:
    """⛔ WR-03. `_log_configuration_fault_once` throttles each of these arms to
    ONE line per process — invisible after the first tick on the session
    monitor's cadence. The heal must ALSO record the refusal as a
    `not_measured` reading, so the SAME blind-run counter and escalation that
    already covers `busy_skip`/`budget_abandoned`/the `code=0` sentinel also
    covers a Railway variable that was never set, or a triple that stopped
    parsing.
    """
    _set_full_env(monkeypatch)
    provoke(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    for _ in range(3):
        assert (
            await mt5_relogin.heal_mt5_terminal_session(
                source=mt5_relogin.HEAL_SOURCE_SESSION_MONITOR,
                poll_interval_s=600.0,
            )
            is None
        )

    assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 3, (
        "the configuration-refusal path did not extend the blind-run counter — "
        "the throttled log line is the ONLY evidence it left, and it fires "
        "once per process"
    )
    assert sink.rows == [], (
        "a not_measured reading must write NOTHING to the durable sink"
    )


@pytest.mark.parametrize(
    "provoke,expected_kind",
    [
        pytest.param(
            _exit_credentials_absent,
            mt5_session_episodes.KIND_CREDENTIALS_NOT_CONFIGURED,
            id="credentials-absent",
        ),
        pytest.param(
            _exit_credentials_invalid,
            mt5_session_episodes.KIND_CREDENTIALS_NOT_CONFIGURED,
            id="credentials-invalid",
        ),
        pytest.param(
            _exit_gateway_absent,
            mt5_session_episodes.KIND_GATEWAY_NOT_CONFIGURED,
            id="gateway-absent",
        ),
        pytest.param(
            _exit_gateway_port_not_numeric,
            mt5_session_episodes.KIND_GATEWAY_NOT_CONFIGURED,
            id="gateway-port-not-numeric",
        ),
    ],
)
async def test_IN_07_the_two_configuration_arms_record_DISTINGUISHABLE_kinds(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    provoke,
    expected_kind: str,
) -> None:
    """⛔ IN-07 (round 2). Before the fix, BOTH arms recorded the SAME
    `KIND_NOT_CONFIGURED`, so after the throttled once-per-process log line
    scrolled, the recurring per-tick "reading MEASURED NOTHING" evidence named
    neither the variable nor WHICH check refused — a credentials fault and a
    gateway fault were indistinguishable in the only evidence left. The class
    in a row and the class in a log line are pinned to each other on purpose
    (the module's own comment); two genuinely different operator faults must
    not share one class.
    """
    _set_full_env(monkeypatch)
    provoke(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    episodes_logger = "quantalyze.analytics.mt5_session_episodes"
    with caplog.at_level(logging.INFO, logger=episodes_logger):
        assert (
            await mt5_relogin.heal_mt5_terminal_session(
                source=mt5_relogin.HEAL_SOURCE_SESSION_MONITOR,
                poll_interval_s=600.0,
            )
            is None
        )

    messages = [
        r.getMessage() for r in caplog.records if r.name == episodes_logger
    ]
    assert any(f"kind={expected_kind}" in m for m in messages), (
        f"expected kind={expected_kind!r} in the recurring per-tick evidence, "
        f"got: {messages}"
    )


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
#:
#: ⛔ WR-03 (round 2) — `"3600"` AND `"301"` ARE THE LOAD-BEARING ADDITIONS, AND
#: THEIR ABSENCE MADE THE CEILING A CLAIM RATHER THAN A GATE. Every value above
#: except `inf`/`-inf`/`nan` is rejected by `float()` or by the SIGN, and
#: `inf`/`nan` are rejected by the `math.isfinite` clause — NOT by the comparison.
#: So no case in this corpus set either knob to a FINITE value above its ceiling,
#: and deleting `value <= effective_ceiling` outright, or setting the ceiling to
#: `1e9`, left the whole suite GREEN. Both are finite and both are above BOTH
#: knobs' ceilings (30 s lease wait, 300 s budget), so they exercise the
#: comparison at both sites.
#:
#: ⛔ `"0.5"` IS THE OTHER END (IN-03 round 2), and it was accepted SILENTLY. A
#: sub-round-trip budget is strictly WORSE than `0`: zero cancels before the
#: thread starts, `0.5` lets it start and then expires MID-`initialize_with_
#: credentials` on the `-6` path, so every boot abandons a credentialed call
#: against the shared terminal.
_HOSTILE_TUNING_VALUES = (
    "45s",
    "",
    "   ",
    "60 x",
    "0",
    "-1",
    "inf",
    "-inf",
    "nan",
    "3600",
    "301",
    "0.5",
)


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
    # ⛔ WR-03 (round 2) — THE WINDOW, for the same reason as the lease knob above.
    # "the heal still reached the terminal" is satisfied by a 3600 s budget as
    # happily as by a 160 s one, so the behavioural oracle alone cannot see a
    # deleted ceiling comparison. Read BY SYMBOL, never restated.
    budget = mt5_relogin._relogin_budget_s()
    assert (
        mt5_relogin._MT5_RELOGIN_BUDGET_FLOOR_S
        <= budget
        <= mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S
    ), (
        f"MT5_RELOGIN_BUDGET_S={value!r} resolved to {budget!r}, OUTSIDE its own "
        f"declared window [{mt5_relogin._MT5_RELOGIN_BUDGET_FLOOR_S}, "
        f"{mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S}]."
    )
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
    # ⛔ WR-03 (round 2) — THE WINDOW, not merely "positive and finite". The weaker
    # assertion is what let `"3600"` sail through: 3600 is positive and finite, so
    # a deleted ceiling comparison stayed GREEN here. The bounds are read BY SYMBOL
    # so a retune of `MT5_REQUEST_TIMEOUT_S` — which both descend from — carries
    # through instead of stranding a hand-typed number.
    assert (
        mt5_relogin._MT5_RELOGIN_LEASE_WAIT_FLOOR_S
        <= wait_s
        <= mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
    ), (
        f"MT5_RELOGIN_LEASE_WAIT_S={value!r} reached the lease as {wait_s!r}, "
        f"OUTSIDE its own declared window "
        f"[{mt5_relogin._MT5_RELOGIN_LEASE_WAIT_FLOOR_S}, "
        f"{mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S}]. Above the ceiling a "
        "best-effort heal queues ahead of real work for longer than a single "
        "round-trip takes, which contradicts the whole 'a busy terminal is "
        "evidence the session is fine, so skip' posture this bound expresses."
    )


@pytest.mark.parametrize(
    "name,value,expected",
    [
        # ⚠️ 45, not the 12.5 this case used to carry: IN-03 (round 2) floored the
        # budget at ONE ROUND-TRIP (30 s), so 12.5 is no longer a LEGITIMATE value
        # — it is one of the sub-round-trip values the floor exists to reject, and
        # leaving it here would have turned an anti-vacuity case into a second
        # assertion that the floor does not work. 45 sits inside [30, 300] and is
        # not the derived default, which is what this case needs.
        ("MT5_RELOGIN_BUDGET_S", "45", 45.0),
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


#: `(env name, reader, floor symbol, ceiling symbol, default symbol)` for the two
#: knobs. ⛔ Read BY SYMBOL from the module, never restated: a bound restated in a
#: test is a second source of truth that drifts, and this repo has a dated record
#: of exactly that (`ARMS_FLOOR` prose said 380, the shipped value was 384).
_TUNING_KNOBS = (
    pytest.param(
        "MT5_RELOGIN_BUDGET_S",
        "_relogin_budget_s",
        "_MT5_RELOGIN_BUDGET_FLOOR_S",
        "_MT5_RELOGIN_BUDGET_CEILING_S",
        id="budget",
    ),
    pytest.param(
        "MT5_RELOGIN_LEASE_WAIT_S",
        "_relogin_lease_wait_s",
        "_MT5_RELOGIN_LEASE_WAIT_FLOOR_S",
        "_MT5_RELOGIN_LEASE_WAIT_CEILING_S",
        id="lease-wait",
    ),
)


@pytest.mark.parametrize("name,reader_name,floor_name,ceiling_name", _TUNING_KNOBS)
def test_a_FINITE_value_ABOVE_the_ceiling_falls_back_to_the_default(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    reader_name: str,
    floor_name: str,
    ceiling_name: str,
) -> None:
    """⛔ WR-03 (round 2) — THE RANGE CEILING HAD NO TEST THAT COULD FAIL.

    The hostile corpus rejects `45s`/`60 x`/`""` at `float()`, `0`/`-1` by the
    SIGN, and `inf`/`-inf`/`nan` at the `math.isfinite` clause. Not one case set
    either knob to a FINITE value above its ceiling, so deleting
    `value <= effective_ceiling` outright — or setting the ceiling to `1e9` — left
    the whole suite GREEN. The ceiling existed as a claim and not as a gate.

    ⛔ The bound is read BY SYMBOL and the probe is derived from it, so a retune of
    `MT5_REQUEST_TIMEOUT_S` (which BOTH bounds descend from) carries through here
    instead of stranding a hand-typed number.
    """
    reader = getattr(mt5_relogin, reader_name)
    ceiling = getattr(mt5_relogin, ceiling_name)

    monkeypatch.delenv(name, raising=False)
    default = reader()

    over = ceiling + 1.0
    assert over > default, (
        f"harness: {ceiling_name}+1 ({over}) is not above the derived default "
        f"({default}), so this probe cannot distinguish a rejection from a "
        "coincidence — re-anchor it"
    )
    monkeypatch.setenv(name, repr(over))
    assert reader() == default, (
        f"{name}={over!r} — a FINITE value above {ceiling_name} ({ceiling}) — was "
        f"HONOURED. `{ceiling_name}` bounds a TYPO, not a tuning decision: an "
        "over-large budget holds the terminal lease while every batch caller "
        "queues behind it with `wait_s=None`, i.e. unbounded."
    )


@pytest.mark.parametrize("name,reader_name,floor_name,ceiling_name", _TUNING_KNOBS)
def test_a_FINITE_value_BELOW_the_floor_falls_back_to_the_default(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    reader_name: str,
    floor_name: str,
    ceiling_name: str,
) -> None:
    """⛔ IN-03 (round 2) — THE KNOB HAD A CEILING AND NO FLOOR, AND THAT ASYMMETRY
    WAS ITSELF THE HAZARD.

    `MT5_RELOGIN_BUDGET_S=0` was rejected; `0.5` and `0.001` were accepted
    SILENTLY (measured). A sub-round-trip budget is strictly WORSE than zero: zero
    cancels before the thread starts, whereas `0.5` lets it start and then expires
    MID-`initialize_with_credentials` on the `-6` path — so EVERY boot leaves a
    credentialed call carrying the broker password in flight against the shared
    terminal after the lease released and bumped the generation. That is the
    abandoned-thread state WR-03's whole derivation exists to avoid, reached by a
    typo rather than by a hang.

    ⛔ A knob that rejects `inf` and `0` READS as range-checked. An operator has no
    reason to go looking for the end that is not.
    """
    reader = getattr(mt5_relogin, reader_name)
    floor = getattr(mt5_relogin, floor_name)

    monkeypatch.delenv(name, raising=False)
    default = reader()

    under = floor / 2.0
    assert 0.0 < under < default, (
        f"harness: {floor_name}/2 ({under}) is not a positive value below the "
        f"derived default ({default}) — re-anchor this probe"
    )
    monkeypatch.setenv(name, repr(under))
    assert reader() == default, (
        f"{name}={under!r} — a positive, finite value BELOW {floor_name} "
        f"({floor}) — was HONOURED. Below one round-trip the budget expires "
        "mid-call and abandons an in-flight credentialed `initialize()` against "
        "the SHARED terminal on every boot (IN-03 round 2)."
    )


def test_the_declared_BOUNDS_are_derivations_and_not_free_numbers() -> None:
    """⛔ WR-03 (round 2), THE OTHER MUTANT: SETTING A CEILING TO `1e9`.

    A gate on the comparison alone does not see this. Every range test above keeps
    passing against a ceiling of `1e9`, because the comparison still runs — it just
    stops bounding anything. `_MT5_RELOGIN_BUDGET_CEILING_S`'s own comment says it
    "bounds a TYPO, not a tuning decision; raising it means arguing about the
    dispatch ceiling, not about this line", and this is that sentence made
    enforceable.

    BOTH bounds are DERIVED and both derivations are checked against the symbol
    they descend from, never against a restated number:

      * the lease-wait ceiling is ONE rpyc round-trip — waiting LONGER for a
        terminal somebody else is driving than a single round-trip takes
        contradicts the "a busy terminal is evidence the session is fine, so skip"
        posture the bound exists to express;
      * the budget ceiling is ONE THIRD of the 15-minute dispatch ceiling the
        batch callers wait against with `wait_s=None`, i.e. UNBOUNDED — so even a
        maximally mis-tuned budget leaves a derive job two thirds of its own
        ceiling. That ceiling is `job_worker._DERIVE_OUTER_BUDGET_S`, imported here
        rather than retyped;
      * the budget FLOOR is one round-trip, for the reason IN-03 (round 2) gives.
    """
    from services.job_worker import _DERIVE_OUTER_BUDGET_S

    assert (
        mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
        == mt5_relogin._MT5_REQUEST_TIMEOUT_S
    ), (
        "the lease-wait ceiling is no longer ONE rpyc round-trip "
        f"({mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S} vs "
        f"{mt5_relogin._MT5_REQUEST_TIMEOUT_S}) — it has become a free number"
    )
    assert (
        mt5_relogin._MT5_RELOGIN_BUDGET_FLOOR_S == mt5_relogin._MT5_REQUEST_TIMEOUT_S
    ), (
        "the budget floor is no longer ONE rpyc round-trip "
        f"({mt5_relogin._MT5_RELOGIN_BUDGET_FLOOR_S} vs "
        f"{mt5_relogin._MT5_REQUEST_TIMEOUT_S})"
    )
    assert mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S * 3 == _DERIVE_OUTER_BUDGET_S, (
        f"the budget ceiling ({mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S}) is no "
        f"longer one third of the dispatch ceiling ({_DERIVE_OUTER_BUDGET_S}). ⛔ "
        "Raising it means arguing about the dispatch ceiling the unbounded batch "
        "acquires wait against, not about that line."
    )

    # The ordering invariant, for both knobs: a window must be non-empty and the
    # default must sit inside it, or the clamps in `_env_float` are the only thing
    # keeping the module usable.
    for floor, default, ceiling in (
        (
            mt5_relogin._MT5_RELOGIN_BUDGET_FLOOR_S,
            mt5_relogin._relogin_budget_s(),
            mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S,
        ),
        (
            mt5_relogin._MT5_RELOGIN_LEASE_WAIT_FLOOR_S,
            mt5_relogin._MT5_RELOGIN_LEASE_WAIT_DEFAULT_S,
            mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S,
        ),
    ):
        assert 0.0 < floor <= default <= ceiling, (
            f"the window [{floor}, {ceiling}] does not contain its own default "
            f"({default}) — a bound that forbids the value the module uses itself "
            "is not a bound, it is a bug (WR-06's argument, both ends)"
        )


@pytest.mark.parametrize(
    "clamp,name,raw,default,floor,ceiling",
    [
        pytest.param(
            "max(ceiling, default)",
            "GSD_TEST_CEILING_BELOW_DEFAULT",
            "50",
            50.0,
            1.0,
            10.0,
            id="ceiling-below-its-own-default",
        ),
        pytest.param(
            "min(floor, default)",
            "GSD_TEST_FLOOR_ABOVE_DEFAULT",
            "2",
            2.0,
            30.0,
            300.0,
            id="floor-above-its-own-default",
        ),
    ],
)
def test_a_BOUND_that_excludes_its_own_default_still_accepts_the_default(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    clamp: str,
    name: str,
    raw: str,
    default: float,
    floor: float,
    ceiling: float,
) -> None:
    """⛔ THE TWO CLAMPS. `max(ceiling, default)` WAS THE ENTIRE CONTENT OF COMMIT
    `fbbf7bf0` AND HAD NO ASSERTION ANYWHERE; `min(floor, default)` arrived with
    IN-03 and would have re-opened the same hole from the other end.

    Both defaults descend from `MT5_REQUEST_TIMEOUT_S`, which is itself tunable, so
    a large retune there can push a default OUTSIDE its own window. A bound that
    forbids the value the module would happily use itself is not a bound, it is a
    bug: every operator value is rejected AND the fallback is a number the range
    check has just declared invalid.

    ⛔ THE ORACLE IS THE LOG RECORD, NOT THE RETURN VALUE, and a first draft of this
    test got that wrong: a REJECTED value falls back to the default, so `got ==
    default` is satisfied by both outcomes and both clamp mutants stayed GREEN
    against it. Acceptance and rejection are distinguishable only by whether the
    out-of-range fault was logged.

    ⛔ Driven through `_env_float` directly, because the shipped constants are
    (correctly) not in that relationship — the property belongs to the HELPER, and a
    test that could only run while the constants were broken could never run.
    """
    monkeypatch.setenv(name, raw)

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        got = mt5_relogin._env_float(name, default, floor=floor, ceiling=ceiling)

    assert got == default
    assert _records(caplog) == [], (
        f"a window [{floor}, {ceiling}] that excludes its own default ({default}) "
        f"REJECTED the default itself — `{clamp}` is gone. The return value alone "
        "cannot see this (a rejection falls back to the default); the operator's "
        "log can, and it now reads as a misconfiguration on a correctly-configured "
        f"deploy: {[r.getMessage() for r in _records(caplog)]}"
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
    # ⛔ IN-02 — `"healed" in message` CANNOT DISTINGUISH `healed` FROM
    # `not_healed`, because one is a SUBSTRING of the other. This assertion was the
    # positive half of the criterion-1 pin and it passed against EVERY verdict this
    # module can emit except `already_authorized` — including
    # `not_healed:still_unauthorized`, the exact outcome WR-02 exists to separate
    # from this one. The sibling case a few lines down already uses the right
    # idiom; it is used here too, plus the LEVEL, because WR-01's ladder puts a
    # success at INFO and every failure at WARNING or above.
    record = _outcome_records(caplog)[-1]
    message = record.getMessage()
    assert message.replace("not_healed", "").count("healed") == 1, (
        f"expected the positive `healed` verdict, got {message!r}. ⛔ A bare "
        "`\"healed\" in message` is satisfied by `not_healed:...` too — the two "
        "verdicts this phase exists to tell apart differ by a prefix."
    )
    assert record.levelno == logging.INFO, (
        f"the `healed` verdict was logged at {record.levelname}; WR-01's ladder "
        "puts a success at INFO and every `not_healed:` verdict above it, so the "
        "level is a second, independent oracle for which verdict this is"
    )
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

    # ⭐ 164.6.5 plan 05 — `-10005` (bridge answered, terminal did not) now
    # ESCALATES to a terminal-process recycle: capture the evidence, recycle,
    # relaunch. The other two codes still touch nothing past the probe. In NO
    # case is a credential sent — that is the half this parametrization guards.
    if ipc_code == -10005:
        # ⭐ 164.6.5 WR-02 — the relaunch is WATCHED: after the verb's own
        # relaunch probe come the bare, credential-free relaunch polls, and
        # nothing else.
        assert fake.call_order[:4] == [
            "initialize",
            "terminal_info",
            "recycle",
            "initialize",
        ]
        assert set(fake.call_order[4:]) <= {"initialize"}, fake.call_order
    else:
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


# --------------------------------------------------------------------------- #
# ⭐ 164.6.5 plan 05 (criterion 3, D-08) — THE HEAL ACTS ON `ipc_fault`.
#
# Production read `not_healed:ipc_fault` FIVE consecutive times on 2026-09-21:
# the heal cannot drive a terminal whose IPC is dead, so it never reached a login
# attempt. It now ESCALATES the `-10005` class (the bridge answered, the terminal
# did not) to the plan-02 terminal-process recycle — once per run of readings,
# inside the one lease, never with a credential, and never raising.
#
# ⛔ Every gate below was observed RED under a neuter of the production behaviour
# it names before it was restored (recorded in the plan's SUMMARY).
# --------------------------------------------------------------------------- #

_IPC_TIMEOUT = -10005
_IPC_TIMEOUT_TEXT = "IPC timeout"
_WEDGED = {"initialize": False, "last_error": (_IPC_TIMEOUT, _IPC_TIMEOUT_TEXT)}

#: The `-10005` verdict as it stood BEFORE this plan — MEASURED by running this
#: file's verdict gate against the pre-plan `mt5_relogin.py` (see the SUMMARY).
#: ⛔ A literal on purpose: composing it with `_not_healed` would pass for any
#: edit that changed the composition inside `_heal_blocking` too.
_PRE_ESCALATION_IPC_TIMEOUT_VERDICT = (
    "not_healed:ipc_fault:code=-10005:MT5 client error (code=-10005): IPC timeout"
)

_ESCALATION_KINDS = (
    mt5_session_episodes.KIND_IPC_FAULT_RECYCLED,
    mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_NO_ACCOUNT,
    mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_STILL_FAULTED,
    mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_FAILED,
    mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_NOT_LANDED,
    mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_RELAUNCH_PENDING,
)


def _capture_outcomes(monkeypatch: pytest.MonkeyPatch) -> list:
    """Replace the episode sink with a list, so each test reads the STRUCTURED
    `HealOutcome` the heal produced rather than parsing a log line — and no
    Supabase client is ever reached."""
    outcomes: list = []

    async def _record(outcome, *, source, poll_interval_s):
        outcomes.append(outcome)

    monkeypatch.setattr(mt5_relogin, "record_mt5_heal_outcome", _record)
    return outcomes


def _recycle_count(fake) -> int:
    return len(fake._MetaTrader5__conn.recycle_calls)


async def _heal_n_times(n: int) -> None:
    for _ in range(n):
        assert await mt5_relogin.heal_mt5_terminal_session() is None


async def test_ESCALATION_five_consecutive_ipc_timeouts_produce_exactly_ONE_recycle(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⭐ FIVE IS THE MEASURED PRODUCTION SEQUENCE, not an arbitrary count.

    ⛔ THE DEBOUNCE IS THE DIFFERENCE BETWEEN A RECOVERY AND AN OUTAGE. At a
    ten-minute cadence an un-debounced escalation recycles the ONE shared
    terminal every ten minutes for as long as the recycle does not help, and
    each recycle drops the IPC for every other caller. The terminal here stays
    wedged after the recycle, which is exactly when a second attempt would fire.
    """
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    outcomes = _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(5)

    assert _recycle_count(fake) == 1, (
        f"five consecutive readings of ONE wedge produced {_recycle_count(fake)} "
        "recycles — the debounce is what stops the heal recycling a shared "
        "terminal on every tick"
    )
    assert [o.escalation_kind for o in outcomes] == [
        mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_STILL_FAULTED,
        None,
        None,
        None,
        None,
    ]
    debounced = [
        r for r in _records(caplog) if "is NOT repeated" in r.getMessage()
    ]
    assert len(debounced) == 4, "each suppressed attempt must still be SAID"


async def test_ESCALATION_re_arms_after_a_reading_of_a_different_class(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A reading that is not the escalating class ENDS the run, so the next wedge
    is a new run and earns its own one attempt. ⛔ Without this, one wedge would
    spend the only recycle this process will ever make."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    outcomes = _capture_outcomes(monkeypatch)

    await _heal_n_times(2)  # one wedge: one recycle, one debounced reading
    assert _recycle_count(fake) == 1

    fake._scenario["initialize_after_recycle"] = True  # the terminal recovered
    await _heal_n_times(1)
    assert outcomes[-1].first_kind == mt5_session_episodes.KIND_ALREADY_AUTHORIZED

    fake._scenario["initialize_after_recycle"] = False  # ...and wedged again
    await _heal_n_times(2)
    assert _recycle_count(fake) == 2, (
        "a new wedge after an authorized reading did not escalate — the gate "
        "was never re-armed"
    )


@pytest.mark.parametrize(
    "answered,rewedge",
    [
        pytest.param(
            {"initialize_after_recycle": True},
            {"initialize_after_recycle": False},
            id="relaunch-AUTHORIZED",
        ),
        pytest.param(
            {"last_error_after_recycle": (-6, "Terminal: Authorization failed")},
            {"last_error_after_recycle": (_IPC_TIMEOUT, _IPC_TIMEOUT_TEXT)},
            id="relaunch-answered-NO-ACCOUNT",
        ),
    ],
)
async def test_ESCALATION_CR01_a_recycle_that_WORKED_re_arms_so_the_NEXT_wedge_is_recycled(
    monkeypatch: pytest.MonkeyPatch, answered: dict, rewedge: dict
) -> None:
    """⛔ CR-01 (164.6.5 review round 1). The relaunch probe MEASURED the terminal
    answering, so the run of faults is over. The failure it guards: a client
    validation re-wedges the terminal BEFORE the next tick sees it healthy, so no
    authorized first-probe reading ever arrives — and a gate that only a
    first-probe reading could re-arm debounced every later `-10005` until a
    redeploy. Wedge -> recycle that works -> wedge on the very NEXT tick must be
    TWO recycles, with no healthy tick in between."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, {**_WEDGED, **answered})
    outcomes = _capture_outcomes(monkeypatch)

    await _heal_n_times(1)
    assert _recycle_count(fake) == 1
    assert outcomes[0].escalation_kind in (
        mt5_session_episodes.KIND_IPC_FAULT_RECYCLED,
        mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_NO_ACCOUNT,
    )

    fake._scenario.update(rewedge)  # re-wedged before any tick saw it healthy
    await _heal_n_times(1)

    assert outcomes[1].first_kind == mt5_session_episodes.KIND_IPC_FAULT
    assert _recycle_count(fake) == 2, (
        "a recycle whose relaunch MEASURED the terminal answering left the gate "
        "disarmed, so the next wedge was debounced instead of recycled (CR-01)"
    )


@pytest.mark.parametrize(
    "neutral_code",
    [
        pytest.param(0, id="the-unattributed-sentinel"),
        pytest.param(-10003, id="ipc-init-failed"),
        pytest.param(-10004, id="bridge-DETACHED"),
    ],
)
async def test_ESCALATION_WR08_a_reading_that_measured_no_answer_does_NOT_re_arm(
    monkeypatch: pytest.MonkeyPatch, neutral_code: int
) -> None:
    """⛔ WR-08 (164.6.5 review round 1). `0` is `_raise_last`'s sentinel for
    "last_error() itself failed" — it measured NOTHING — and `-10003` / `-10004`
    are the terminal not answering either. A bridge that intermittently times
    out `last_error()` during a wedge reads `-10005, 0, -10005, 0 ...`; if the
    middle reading re-arms the gate, the shared terminal is recycled every other
    tick (every 20 minutes), the periodic outage the debounce exists to prevent.
    `-10005, <neutral>, -10005` must be ONE recycle."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    _capture_outcomes(monkeypatch)

    await _heal_n_times(1)
    assert _recycle_count(fake) == 1

    fake._scenario["last_error_after_recycle"] = (neutral_code, "no answer")
    await _heal_n_times(1)
    fake._scenario["last_error_after_recycle"] = (_IPC_TIMEOUT, _IPC_TIMEOUT_TEXT)
    await _heal_n_times(1)

    assert _recycle_count(fake) == 1, (
        f"a `{neutral_code}` reading between two wedged readings re-armed the "
        "gate and the terminal was recycled again (WR-08)"
    )


async def test_ESCALATION_SFH05_a_recovery_ONLY_the_job_path_saw_re_arms_the_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ SFH-05 (164.6.5 review round 1). While jobs hold the lease every monitor
    tick is a busy SKIP that measures nothing, so the heal's own probe never sees
    the terminal recover. A job's `login()` does: its bare `initialize()`
    answered. The next wedge after that is a NEW run and must be recycled — not
    debounced as "already attempted in this run"."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    _capture_outcomes(monkeypatch)

    await _heal_n_times(1)
    assert _recycle_count(fake) == 1

    # A job, on its own client for the SAME terminal, logs in successfully.
    healthy = _FakeMt5({"initialize": True, "login": True})
    job_client = Mt5Client(
        _FAKE_HOST, int(_FAKE_PORT), _connect=lambda **_k: healthy
    )
    job_client.login(int(_FAKE_LOGIN), _FAKE_PASSWORD, _FAKE_SERVER)

    await _heal_n_times(1)  # the terminal has wedged again

    assert _recycle_count(fake) == 2, (
        "the terminal answered the job path's login between the two wedges, "
        "yet the second wedge was debounced as the same run (SFH-05)"
    )


@pytest.mark.parametrize(
    "code",
    [
        pytest.param(-10004, id="bridge-DETACHED"),
        pytest.param(-10003, id="ipc-init-failed"),
        pytest.param(0, id="the-unattributed-sentinel"),
    ],
)
async def test_ESCALATION_never_fires_where_the_recycle_cannot_reach(
    monkeypatch: pytest.MonkeyPatch, code: int
) -> None:
    """⛔ A DETACHED bridge (`-10004`) gives the recycle nothing to talk to — the
    verb has to travel THROUGH that bridge — and the shipped remedy there is a
    redeploy. `-10003` and the `0` sentinel are not the wedge. The CALL COUNT is
    asserted, not merely the verdict: a recycle that fired and then failed would
    leave the verdict unchanged."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch, {"initialize": False, "last_error": (code, "No IPC connection")}
    )
    outcomes = _capture_outcomes(monkeypatch)

    await _heal_n_times(1)

    assert _recycle_count(fake) == 0
    assert fake.call_order == ["initialize"], (
        "nothing past the probe may touch the terminal for this class — not the "
        f"evidence capture, not the recycle: {fake.call_order}"
    )
    assert outcomes[0].escalation_kind is None


def test_the_escalation_gate_is_exactly_the_ipc_timeout_code() -> None:
    """⛔ The gate is DERIVED from the shipped `_IPC_TRANSPORT_CODES` tuple, so a
    code added to that tuple would silently widen what the heal recycles on.
    This pin makes that widening a decision."""
    assert mt5_relogin._RECYCLE_REACHABLE_IPC_CODES == frozenset({-10005})


async def test_ESCALATION_a_minus_six_still_takes_the_credentialed_heal_and_never_recycles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`-6` is the bridge answering with no account signed in: the ONE fault the
    credentialed heal exists for. It behaves exactly as before this plan."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch,
        {"initialize": False, "last_error": (-6, "Terminal: Authorization failed")},
    )
    outcomes = _capture_outcomes(monkeypatch)

    await _heal_n_times(1)

    assert fake.call_order == [
        "initialize",
        "initialize_credentialed",
        "initialize",
    ]
    assert _recycle_count(fake) == 0
    assert outcomes[0].final_kind == mt5_session_episodes.KIND_HEALED
    assert outcomes[0].escalation_kind is None


async def test_ESCALATION_a_raising_recycle_cannot_escape_the_heal(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ THE HIGHEST-SEVERITY PROPERTY. A raise out of the heal reaches the
    entry's handler and, from there, `_crash_handler` — which stops the
    dispatch, watchdog and enqueue loops while `/health` stays green: a silent
    ANALYTICS outage caused by an MT5 fault.

    Proved with a `RuntimeError` from the verb itself — a type `_heal_blocking`'s
    own `except Mt5ClientError` arms would let straight through."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    outcomes = _capture_outcomes(monkeypatch)

    def _raising(self) -> dict:
        raise RuntimeError("the recycle blew up")

    monkeypatch.setattr(Mt5Client, "recycle_terminal_process", _raising)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert len(outcomes) == 1, (
        "the heal did not return an outcome — the raise escaped `_heal_blocking`"
    )
    assert (
        outcomes[0].escalation_kind
        == mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_FAILED
    )
    assert outcomes[0].verdict == _PRE_ESCALATION_IPC_TIMEOUT_VERDICT
    failed = [
        r
        for r in _records(caplog)
        if mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_FAILED in r.getMessage()
    ]
    assert failed and failed[0].levelno == logging.ERROR
    assert "the recycle blew up" not in failed[0].getMessage(), (
        "the escalation line quoted exception TEXT; it names the class only"
    )
    assert not any("did not complete" in r.getMessage() for r in _records(caplog))


def test_ESCALATION_the_session_abandonment_exception_still_escapes_untouched(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ `Mt5SessionAbandoned` is a PLAIN exception ON PURPOSE (D-42): an
    our-infrastructure refusal must never be re-classified. The escalation's
    guard must not widen to swallow it — from the recycle OR from the capture."""
    from services.mt5_client import Mt5SessionAbandoned

    class _Client:
        terminal_key = "stub.test:1"

        def __init__(self, raise_in: str) -> None:
            self._raise_in = raise_in

        def terminal_info(self) -> dict:
            if self._raise_in == "capture":
                raise Mt5SessionAbandoned("terminal_info")
            return {"build": 1, "connected": True}

        def account_info(self) -> dict:
            return {"server": "x"}

        def recycle_terminal_process(self) -> dict:
            # ⚠️ Raises ONLY in the recycle case: if it raised in both, the
            # capture case would pass on the recycle's raise even with the
            # capture swallowing its own (measured: that neuter stayed GREEN).
            if self._raise_in == "recycle":
                raise Mt5SessionAbandoned("terminal_recycle")
            return {"matched": 1, "terminated": 1, "exited": 1,
                    "authorized": True, "relaunch_code": None}

    for raise_in in ("capture", "recycle"):
        mt5_session_episodes._reset_session_episode_state_for_tests()
        with pytest.raises(Mt5SessionAbandoned):
            mt5_relogin._escalate_ipc_fault(
                _Client(raise_in), _IPC_TIMEOUT, "unused-server"  # type: ignore[arg-type]
            )


def _escalation_client(fake) -> Mt5Client:
    return Mt5Client(_FAKE_HOST, int(_FAKE_PORT), _connect=lambda **_k: fake)


@pytest.mark.parametrize(
    "released", ["during_the_capture", "after_the_capture"]
)
def test_ESCALATION_WR01_an_escalation_abandoned_BEFORE_the_recycle_crossed_keeps_the_attempt(
    monkeypatch: pytest.MonkeyPatch, released: str
) -> None:
    """⛔ WR-01 (164.6.5 review round 1). The gate used to be claimed as the
    escalation's FIRST act, so an escalation abandoned during the evidence
    capture, or refused by the recycle verb's own first-statement fence, had
    spent the run's one attempt with NO process ended — and every later `-10005`
    was debounced until a redeploy.

    Driven through the REAL verb: the lease releases (the generation bumps)
    after the capture, so the verb's own fence refuses before anything crosses.
    The next escalation must still be allowed to recycle."""
    from services.mt5_client import Mt5SessionAbandoned, bump_mt5_terminal_epoch

    fake = _FakeMt5(dict(_WEDGED))
    client = _escalation_client(fake)
    real_capture = mt5_relogin._capture_wedge_evidence

    def _capture_with_lease_release(c, env_server, deadline):
        if released == "during_the_capture":
            c._assert_live("bind")  # first touch binds the generation
            bump_mt5_terminal_epoch(c.terminal_key)
            return real_capture(c, env_server, deadline)  # its first read is refused
        line = real_capture(c, env_server, deadline)
        bump_mt5_terminal_epoch(c.terminal_key)
        return line

    monkeypatch.setattr(
        mt5_relogin, "_capture_wedge_evidence", _capture_with_lease_release
    )
    with pytest.raises(Mt5SessionAbandoned) as refused:
        mt5_relogin._escalate_ipc_fault(client, _IPC_TIMEOUT, _FAKE_SERVER)
    if released == "after_the_capture":
        assert refused.value.stage == mt5_relogin._RECYCLE_FENCE_STAGE
    assert fake._MetaTrader5__conn.recycle_calls == [], "the refused recycle crossed"

    monkeypatch.setattr(mt5_relogin, "_capture_wedge_evidence", real_capture)
    fresh = _FakeMt5(dict(_WEDGED))
    kind = mt5_relogin._escalate_ipc_fault(
        _escalation_client(fresh), _IPC_TIMEOUT, _FAKE_SERVER
    )
    assert kind is not None and _recycle_count(fresh) == 1, (
        "an escalation refused BEFORE the recycle crossed spent the run's one "
        "attempt, so the next wedged reading was debounced (WR-01)"
    )


def test_ESCALATION_WR01_an_escalation_abandoned_AFTER_the_terminate_crossed_spends_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half, so the re-arm above cannot be widened into "re-arm on
    ANY abandonment": once the terminate has crossed, the shared terminal WAS
    recycled, and a second attempt in the same run is exactly what the debounce
    refuses. Here the lease releases while the remote call is in flight, so the
    relaunch probe's fence is the one that refuses."""
    from services.mt5_client import Mt5SessionAbandoned, bump_mt5_terminal_epoch

    fake = _FakeMt5(dict(_WEDGED))
    client = _escalation_client(fake)
    fake._scenario["after_recycle_crossed"] = lambda: bump_mt5_terminal_epoch(
        client.terminal_key
    )
    with pytest.raises(Mt5SessionAbandoned) as refused:
        mt5_relogin._escalate_ipc_fault(client, _IPC_TIMEOUT, _FAKE_SERVER)
    assert refused.value.stage != mt5_relogin._RECYCLE_FENCE_STAGE
    assert _recycle_count(fake) == 1

    fresh = _FakeMt5(dict(_WEDGED))
    assert (
        mt5_relogin._escalate_ipc_fault(
            _escalation_client(fresh), _IPC_TIMEOUT, _FAKE_SERVER
        )
        is None
    )
    assert _recycle_count(fresh) == 0


async def test_ESCALATION_the_verdict_string_did_not_move(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ `not_healed:` IS A CONTRACT downstream keys off. This plan changes what
    the heal DOES, never what an existing verdict MEANS — so the `-10005` verdict
    is byte-identical to the pre-plan one whether the escalation fired, was
    debounced, or failed, and so is the line that logs it."""
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, dict(_WEDGED))
    outcomes = _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(2)  # fired, then debounced

    assert outcomes[0].escalation_kind is not None
    assert outcomes[1].escalation_kind is None
    for outcome in outcomes:
        assert outcome.verdict == _PRE_ESCALATION_IPC_TIMEOUT_VERDICT
        assert outcome.first_kind == mt5_session_episodes.KIND_IPC_FAULT
        assert outcome.first_code == _IPC_TIMEOUT
        assert outcome.final_kind is None and outcome.final_code is None
    verdict_lines = [
        r.getMessage()
        for r in _records(caplog)
        if r.getMessage().startswith("mt5 boot heal: not_healed:")
    ]
    assert verdict_lines == [
        f"mt5 boot heal: {_PRE_ESCALATION_IPC_TIMEOUT_VERDICT}"
    ] * 2


async def test_ESCALATION_no_credential_reaches_the_recycle(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ ASSERTED STRUCTURALLY — on what CROSSED THE WIRE and what the verb was
    CALLED WITH — never by searching a log for a value. Escalating means
    recycling the process; it NEVER means another login (D-08)."""
    from services import mt5_client

    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    _capture_outcomes(monkeypatch)
    verb_calls: list[tuple[tuple, dict]] = []
    real_verb = Mt5Client.recycle_terminal_process

    def _recording(self, *args, **kwargs):
        verb_calls.append((args, dict(kwargs)))
        return real_verb(self, *args, **kwargs)

    monkeypatch.setattr(Mt5Client, "recycle_terminal_process", _recording)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert verb_calls == [((), {})], "the recycle verb was handed arguments"
    conn = fake._MetaTrader5__conn
    assert conn.executed == [mt5_client._REMOTE_TERMINAL_RECYCLE_SRC], (
        "something other than the committed recycle source crossed the wire"
    )
    assert conn.recycle_calls == [((mt5_client._TERMINAL_EXIT_WAIT_MS,), {})]
    assert "initialize_credentialed" not in fake.call_order
    assert all(
        not ({"login", "password", "server"} & set(kw))
        for kw in fake.initialize_kwargs
    ), f"a credential reached initialize(): {fake.initialize_kwargs}"
    _assert_no_credential_value_escaped(_records(caplog))


async def test_ESCALATION_the_wedge_evidence_is_captured_BEFORE_the_recycle(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⭐ `MT5-SWITCH-WEDGE-CAUSE-01`: the wedge is PROCESS state, so the recycle
    that heals it erases the only evidence for its cause. The build, the
    connection state and whether the session's broker server is the
    environment's must be READ and LOGGED before the recycle runs.

    ⛔ The server is logged as a COMPARISON, never as a name (T-164.6.2-12), and
    no account number is read into the line."""
    from collections import namedtuple

    terminal = namedtuple("TerminalInfo", "build connected")(6182, False)
    account = namedtuple("AccountInfo", "login server")(
        int(_FAKE_LOGIN), _FAKE_SERVER
    )
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch, {**_WEDGED, "terminal_info": terminal, "account_info": account}
    )
    _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert fake.call_order.index("terminal_info") < fake.call_order.index("recycle")
    assert fake.call_order.index("account_info") < fake.call_order.index("recycle")
    messages = [r.getMessage() for r in _records(caplog)]
    evidence = [i for i, m in enumerate(messages) if "pre-recycle wedge evidence" in m]
    escalated = [i for i, m in enumerate(messages) if "escalated to a terminal" in m]
    assert evidence and escalated and evidence[0] < escalated[0]
    line = messages[evidence[0]]
    assert "build=6182" in line
    assert "connected=False" in line
    assert "session_server_matches_env=True" in line
    _assert_no_credential_value_escaped(_records(caplog))


async def test_ESCALATION_an_unanswered_capture_is_recorded_not_captured_and_still_recycles(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """A wedged terminal may not answer the capture reads at all. The fields are
    then recorded `not_captured` WITH THE REASON — never filled in by logging in
    — the second read is skipped, and the recycle still runs."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert "account_info" not in fake.call_order
    assert _recycle_count(fake) == 1
    line = next(
        r.getMessage()
        for r in _records(caplog)
        if "pre-recycle wedge evidence" in r.getMessage()
    )
    assert "build=not_captured" in line
    assert "terminal_info failed: exc_class=Mt5ClientError code=-10005" in line
    assert "initialize_credentialed" not in fake.call_order


@pytest.mark.parametrize(
    "scenario,expected_kind,expected_level",
    [
        pytest.param(
            {"initialize_after_recycle": True},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLED,
            logging.INFO,
            id="back-and-authorized",
        ),
        pytest.param(
            {"last_error_after_recycle": (-6, "Terminal: Authorization failed")},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_NO_ACCOUNT,
            logging.WARNING,
            id="back-with-no-account-yet",
        ),
        pytest.param(
            {},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_STILL_FAULTED,
            logging.ERROR,
            id="still-wedged",
        ),
    ],
)
async def test_ESCALATION_the_outcome_kind_and_its_severity_follow_the_relaunch(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    scenario: dict,
    expected_kind: str,
    expected_level: int,
) -> None:
    """The four kinds exist because the REMEDIES differ. `-6` after a relaunch is
    left to the ordinary heal on the NEXT reading: the escalation itself never
    sends a credential, even when the terminal comes back unsigned-in."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, {**_WEDGED, **scenario})
    outcomes = _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert outcomes[0].escalation_kind == expected_kind
    line = next(
        r for r in _records(caplog) if "escalated to a terminal" in r.getMessage()
    )
    assert line.levelno == expected_level
    assert "initialize_credentialed" not in fake.call_order


@pytest.mark.parametrize(
    "counts,relaunch,expected_kind,expected_level",
    [
        pytest.param(
            (0, 0, 0),
            {"initialize": True},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_NOT_LANDED,
            logging.ERROR,
            id="matched-NOTHING-and-the-probe-answered",
        ),
        pytest.param(
            (1, 0, 0),
            {},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_NOT_LANDED,
            logging.ERROR,
            id="terminate-REFUSED-and-still-wedged",
        ),
        pytest.param(
            (2, 1, 1),
            {"initialize_after_recycle": True},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLE_NOT_LANDED,
            logging.ERROR,
            id="PARTIAL-one-terminal-survived",
        ),
        pytest.param(
            (1, 1, 0),
            {"initialize_after_recycle": True},
            mt5_session_episodes.KIND_IPC_FAULT_RECYCLED,
            logging.WARNING,
            id="terminated-but-exit-UNCONFIRMED",
        ),
    ],
)
async def test_ESCALATION_WR03_a_recycle_that_did_not_end_every_terminal_is_never_recycled(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    counts: tuple[int, int, int],
    relaunch: dict,
    expected_kind: str,
    expected_level: int,
) -> None:
    """⛔ WR-03 / SFH-01 (164.6.5 review round 1). The counts are the ONLY evidence
    the Wine-side terminate landed, and it has never run live. A verdict that
    ended nothing (`matched=0`: an image-name difference under Wine;
    `terminated=0`: the open or terminate refused) must never read `recycled`
    — at INFO, "nothing for anyone to do" — because the relaunch probe happened
    to attach to the SAME terminal and it answered; nor `still_faulted`, which
    says a recycle ran. A partial landing leaves a terminal alive that may be the
    wedged one. And a terminate whose exit was not confirmed is at least a
    WARNING, never INFO."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch, {**_WEDGED, **relaunch, "recycle_counts": counts}
    )
    outcomes = _capture_outcomes(monkeypatch)
    if relaunch.get("initialize") is True:
        # The terminal answers only AFTER the (non-)recycle: the first probe
        # must still read the wedge so the escalation runs at all.
        answers = iter([False, True])
        real = fake.initialize

        def _first_wedged(**kwargs):
            real(**kwargs)
            return next(answers)

        fake.initialize = _first_wedged

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert outcomes[0].escalation_kind == expected_kind
    line = next(
        r for r in _records(caplog) if "escalated to a terminal" in r.getMessage()
    )
    assert line.levelno == expected_level
    assert f"matched={counts[0]} terminated={counts[1]}" in line.getMessage()


async def test_ESCALATION_SFH09_the_refusal_codes_are_NAMED_in_the_escalation_line(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⭐ SFH-09. A recycle that did not land must say WHY on the operator's line:
    "access denied" (5) and "already gone" (87) have different remedies."""
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch,
        {
            **_WEDGED,
            "recycle_counts": (1, 0, 0),
            "terminate_errors": [5],
        },
    )
    _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    line = next(
        r.getMessage()
        for r in _records(caplog)
        if "escalated to a terminal" in r.getMessage()
    )
    assert "open_errors=[] terminate_errors=[5]" in line


async def test_ESCALATION_WR02_a_recycle_that_WORKS_slowly_is_logged_recycled_never_human_needed(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ WR-02 / SFH-02 (164.6.5 review round 1). The live spike MEASURED a cold
    relaunch reaching authorized 86 s after the kill. The verb's single relaunch
    probe is bounded at 20 s, so a WORKING recycle read an IPC code on it and was
    logged `recycled_still_faulted` at ERROR — "a human is needed" — minutes
    before the next tick found the terminal healthy. Driven here on the measured
    timeline: every not-yet-answering `initialize()` spends its 20 s IPC timeout
    and the terminal answers 86 s after the terminate crossed."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch,
        {
            **_WEDGED,
            "crossing_costs": {"initialize": 20.0},
            "relaunch_authorized_after_s": 86.0,
        },
    )
    outcomes = _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert outcomes[0].escalation_kind == mt5_session_episodes.KIND_IPC_FAULT_RECYCLED
    assert not [r for r in _records(caplog) if r.levelno >= logging.ERROR], (
        "a recycle that WORKED produced an ERROR line"
    )
    assert "initialize_credentialed" not in fake.call_order


async def test_ESCALATION_WR02_a_relaunch_the_budget_could_not_watch_is_PENDING_not_still_faulted(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """When the heal budget runs out before the settle window does (here, every
    crossing at its full rpyc ceiling), the relaunch has NOT been shown to fail.
    The kind is `relaunch_pending` at WARNING — "not yet known" — and the next
    reading decides; never `still_faulted`, never ERROR."""
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch,
        {**_WEDGED, "crossing_cost_s": mt5_relogin._MT5_REQUEST_TIMEOUT_S},
    )
    outcomes = _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert (
        outcomes[0].escalation_kind
        == mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_RELAUNCH_PENDING
    )
    line = next(
        r for r in _records(caplog) if "escalated to a terminal" in r.getMessage()
    )
    assert line.levelno == logging.WARNING


async def test_ESCALATION_WR02_still_faulted_only_after_the_WHOLE_settle_window(
    monkeypatch: pytest.MonkeyPatch, _fake_clock: "_FakeClock"
) -> None:
    """`still_faulted` is a claim that the relaunch was watched and did not
    answer. It may only be made once at least `_RELAUNCH_SETTLE_S` has passed
    since the verb returned — which is itself after the kill."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    outcomes = _capture_outcomes(monkeypatch)

    await _heal_n_times(1)

    assert (
        outcomes[0].escalation_kind
        == mt5_session_episodes.KIND_IPC_FAULT_RECYCLED_STILL_FAULTED
    )
    assert sum(_fake_clock.sleeps) >= mt5_relogin._RELAUNCH_SETTLE_S
    assert "initialize_credentialed" not in fake.call_order


async def test_ESCALATION_SFH03_a_wedge_the_recycle_did_not_cure_is_re_raised_HOURLY(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _fake_clock: "_FakeClock",
) -> None:
    """⛔ SFH-03 (164.6.5 review round 1). The debounce is on the ACTION, never on
    the ALARM. Before this, a wedge the recycle could not cure (Cause A, the
    persisted modal dialog) was ONE ERROR at hour 0 and then INFO lines for as
    long as it lasted — four days, on the record. Ten-minute ticks for four
    hours must produce one ERROR per hour, each naming the elapsed time, and
    still exactly ONE recycle."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(monkeypatch, dict(_WEDGED))
    _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        for _ in range(24):  # four hours of ten-minute ticks
            await _heal_n_times(1)
            _fake_clock.now += 600.0

    assert _recycle_count(fake) == 1
    errors = [r.getMessage() for r in _records(caplog) if r.levelno >= logging.ERROR]
    assert len(errors) == 4, (
        f"expected the attempt's ERROR plus one per further hour, got {len(errors)}: "
        f"{errors}"
    )
    # Each re-raise names the elapsed time, and none comes sooner than an hour
    # after the one before it.
    import re as _re

    elapsed = [
        int(m.group(1))
        for m in (_re.search(r"PERSISTS (\d+) min", e) for e in errors[1:])
        if m
    ]
    assert len(elapsed) == 3 and elapsed[0] >= 60, errors
    assert all(b - a >= 60 for a, b in zip(elapsed, elapsed[1:])), elapsed


@pytest.mark.parametrize("code", [-10004, -10003])
async def test_SFH03_a_NEVER_escalated_ipc_fault_that_persists_reaches_ERROR_hourly(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _fake_clock: "_FakeClock",
    code: int,
) -> None:
    """`-10004` / `-10003` are never escalated, so before this they never reached
    ERROR at all, however long they lasted. A transient one (a redeploy blip)
    must stay quiet; one that persists an hour is an ERROR, then hourly."""
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch, {"initialize": False, "last_error": (code, "No IPC connection")}
    )
    _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        for _ in range(5):  # 40 minutes: transient, no ERROR
            await _heal_n_times(1)
            _fake_clock.now += 600.0
        assert not [r for r in _records(caplog) if r.levelno >= logging.ERROR]
        for _ in range(13):  # to ~3 h
            await _heal_n_times(1)
            _fake_clock.now += 600.0

    errors = [r.getMessage() for r in _records(caplog) if r.levelno >= logging.ERROR]
    assert len(errors) == 2 and all("PERSISTED" in e for e in errors), errors


async def test_SFH03_the_terminal_answering_ends_the_persistence_run(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    _fake_clock: "_FakeClock",
) -> None:
    """A run of faults the terminal answered in the middle of is TWO runs: the
    elapsed time must not accumulate across a recovery."""
    _set_full_env(monkeypatch)
    fake, _c = _install_client(
        monkeypatch, {"initialize": False, "last_error": (-10004, "No IPC")}
    )
    _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        for _ in range(5):
            await _heal_n_times(1)
            _fake_clock.now += 600.0
        fake._scenario["initialize"] = True  # the bridge is back
        await _heal_n_times(1)
        fake._scenario["initialize"] = False
        for _ in range(5):
            await _heal_n_times(1)
            _fake_clock.now += 600.0

    assert not [r for r in _records(caplog) if r.levelno >= logging.ERROR]


@pytest.mark.parametrize("kind", _ESCALATION_KINDS)
def test_ESCALATION_every_escalation_kind_degrades_to_NOT_MEASURED(kind: str) -> None:
    """An escalation ACTS on the terminal; it does not measure the session. If
    one of its kinds ever reached the classifier, it must not claim a state."""
    reading = mt5_session_episodes.classify_reading(kind, None)
    assert reading.state == mt5_session_episodes.STATE_NOT_MEASURED


async def test_the_budget_covers_the_ESCALATION_path_too(
    monkeypatch: pytest.MonkeyPatch, _fake_clock: "_FakeClock"
) -> None:
    """⛔ WR-04 (164.6.5 review round 1) — THE BUDGET IS THE MINIMUM THAT COVERS THE
    ESCALATION'S UNCONDITIONAL PATH, MEASURED WITH EVERY RPYC CROSSING AT ITS FULL
    CEILING — the one condition the budget exists for.

    Plan 05 counted the recycle's remote call as ONE round-trip and asserted
    `>=`. Its `_remote_call` makes THREE crossings (execute, the namespace
    netref lookup, the call), and the double recorded none of the extra two, so
    the gate counted 8 because the double under-reported; honestly counted the
    path was 310 s against the 300 s ceiling. `>=` also stayed green for any
    over-provision, which lengthens the unbounded lease wait batch jobs pay.

    Both capture shapes are driven, because they spend differently: a FAILING
    `terminal_info()` pays its `last_error()`, an ANSWERING one leaves the
    budget-gated `account_info()` to decide whether it still fits."""
    from collections import namedtuple

    ceiling = mt5_relogin._MT5_REQUEST_TIMEOUT_S
    monkeypatch.delenv("MT5_RELOGIN_BUDGET_S", raising=False)
    budget = mt5_relogin._relogin_budget_s()
    _set_full_env(monkeypatch)

    measured: dict[str, int] = {}
    paths: dict[str, list[str]] = {}
    for shape, extra in (
        ("terminal_info_fails", {}),
        (
            "terminal_info_answers",
            {"terminal_info": namedtuple("TerminalInfo", "build connected")(1, False)},
        ),
    ):
        mt5_session_episodes._reset_session_episode_state_for_tests()
        fake, _c = _install_client(
            monkeypatch, {**_WEDGED, **extra, "crossing_cost_s": ceiling}
        )
        _capture_outcomes(monkeypatch)
        started = _fake_clock.now

        await _heal_n_times(1)

        assert _recycle_count(fake) == 1, f"{shape}: the recycle did not run"
        elapsed = _fake_clock.now - started
        assert elapsed <= budget, (
            f"{shape}: the path took {elapsed}s of rpyc ceilings against a "
            f"{budget}s budget — the `wait_for` fires MID-escalation (WR-03 class)"
        )
        measured[shape] = len(fake.round_trips)
        paths[shape] = list(fake.round_trips)

    assert paths["terminal_info_fails"] == [
        "initialize",
        "last_error",
        "terminal_info",
        "last_error",
        "recycle_execute",
        "recycle_lookup",
        "recycle",
        "initialize",
        "last_error",
    ], f"the escalation path changed shape: {paths['terminal_info_fails']}"
    assert "account_info" not in paths["terminal_info_answers"], (
        "the budget-gated account_info() was read although the time left could "
        "not also cover the recycle and its relaunch"
    )
    assert mt5_relogin._MT5_RELOGIN_ROUND_TRIPS == max(measured.values()), (
        f"the budget is derived from {mt5_relogin._MT5_RELOGIN_ROUND_TRIPS} "
        f"crossings and the worst unconditional path makes {max(measured.values())} "
        f"({measured}). It must be EXACTLY the minimum: fewer lets the `wait_for` "
        "fire mid-recycle, more lengthens the unbounded wait batch jobs pay."
    )
    assert budget <= mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S


async def test_WR04_a_recycle_the_budget_cannot_finish_is_never_started(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ WR-04 / SFH-06. With `MT5_RELOGIN_BUDGET_S` set below its derived default
    (a Railway override still sized for the old 5-trip path, say), killing the
    shared terminal and then being abandoned before the relaunch probe is the
    worst outcome this heal has. The recycle must not START unless the time left
    covers it and its relaunch — and the attempt must not be spent."""
    _set_full_env(monkeypatch)
    monkeypatch.setenv("MT5_RELOGIN_BUDGET_S", "160")
    fake, _c = _install_client(
        monkeypatch,
        {**_WEDGED, "crossing_cost_s": mt5_relogin._MT5_REQUEST_TIMEOUT_S},
    )
    outcomes = _capture_outcomes(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        await _heal_n_times(1)

    assert _recycle_count(fake) == 0
    assert outcomes[0].escalation_kind is None
    assert any(
        "recycle was NOT attempted" in r.getMessage() and r.levelno == logging.WARNING
        for r in _records(caplog)
    )
    monkeypatch.delenv("MT5_RELOGIN_BUDGET_S")
    fake._scenario["crossing_cost_s"] = 0.0
    await _heal_n_times(1)
    assert _recycle_count(fake) == 1, "the skipped attempt was spent anyway"


def test_HealOutcome_escalation_field_is_appended_and_defaults_to_never_ran() -> None:
    """⛔ APPENDED, so every positional construction that predates it keeps its
    meaning, and DEFAULTED to `None` — 'this step never ran'."""
    fields = mt5_session_episodes.HealOutcome._fields
    assert fields[-1] == "escalation_kind"
    assert fields[:-1] == (
        "verdict",
        "first_kind",
        "first_code",
        "final_kind",
        "final_code",
    )
    legacy = mt5_session_episodes.HealOutcome("v", "k", None, None, None)
    assert legacy.escalation_kind is None


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

    # ⛔ INFO, not WARNING (WR-05). A busy terminal is a DESIGNED skip and is now
    # reported at INFO; capturing at WARNING would silently stop observing it and
    # this case would red for a reason that is not a defect. The other injections
    # still emit at WARNING or above, which INFO capture includes.
    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    # ⛔ `_outcome_records`, not `_records`: HIGH-1's "starting" announcement fires
    # before the lease on most of these paths, so `assert records` would pass on
    # the strength of the announcement alone and this gate would stop biting.
    assert _outcome_records(caplog), (
        "the heal swallowed a failure and emitted NOTHING — a silent swallow is "
        "the defect class this milestone removes"
    )
    _assert_no_credential_value_escaped(_records(caplog))


async def test_a_BUSY_terminal_is_an_INFO_skip_and_never_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ WR-05 — A DESIGNED SKIP WAS LOGGED IDENTICALLY TO A REAL FAILURE.

    `_heal_blocking`'s own derivation argues that skipping a busy terminal is
    CORRECT and "costs the next holder exactly zero" — yet `Mt5TerminalBusyError`
    exited through the entry's catch-all as *"mt5 boot heal did not complete"* at
    WARNING, this module's wording for a transient fault. And `mt5_terminal_lease`
    fires a WARNING of its own, so a HEALTHY boot logged TWO warnings.

    ⛔ The race is the ordinary one IN-04 describes, not a corner: `dispatch_loop`
    claims a `derive_broker_dailies` job within a second or two of boot. An
    operator who learns that a healthy boot warns twice has been taught to ignore
    the channel this milestone exists to fill.

    ⚠️ `mt5_terminal_lease`'s own WARNING is deliberately NOT changed: it belongs
    to a shared helper whose other callers are the INTERACTIVE validate path,
    where "gave up waiting for the terminal" genuinely is a warning. This test
    scopes to THIS module's logger for exactly that reason.
    """
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})
    _fail_at_lease(monkeypatch)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _outcome_records(caplog)
    assert len(records) == 1, [r.getMessage() for r in records]
    record = records[0]
    message = record.getMessage()
    assert record.levelno == logging.INFO, (
        f"a busy terminal — a DESIGNED skip this module argues for at length — "
        f"was logged at {record.levelname}. Combined with the lease's own "
        "WARNING, a healthy boot then warns twice (WR-05)."
    )
    assert "did not complete" not in message, (
        f"the busy skip still exits through the entry's catch-all: {message!r}"
    )
    assert "busy terminal" in message and "session is fine" in message, (
        f"the skip does not carry the reasoning the design already argues: "
        f"{message!r} — an operator must be able to tell 'nothing to do' from "
        "'something went wrong' from the line itself"
    )


async def test_a_hung_terminal_is_abandoned_at_the_budget_and_raises_nothing(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """The `wait_for` bound, OBSERVED rather than asserted: the double really
    blocks its thread, and the budget really fires.

    ⚠️ The thread is NOT cancelled — it keeps running while the lease releases and
    bumps the terminal's generation, after which the zombie's next touch is refused
    by the client's own D-36 fence. That is the designed behaviour.

    ⛔ WR-05 — AND IT IS LOGGED AT ERROR, UNDER ITS OWN ARM. It used to share the
    catch-all's generic *"did not complete … the next boot will try again"* with a
    busy-terminal SKIP, which is the OPPOSITE event. A credentialed `initialize()`
    carrying the broker password is still in flight against the SHARED terminal on
    a thread nothing cancelled; whether the session came up is unknowable from the
    log. It is the one outcome here that leaves the SYSTEM in a state nobody
    measured, so it sits above every verdict.
    """
    _set_full_env(monkeypatch)
    # ⛔ The ENVIRONMENT, not a module attribute — CR-02 moved the knob to a
    # per-call read, and a `setattr` on the old constant would now be a NO-OP
    # that left the default 100 s budget in force. The 0.4 s double would finish,
    # the heal would report `healed`, and the assertion below would red while
    # LOOKING like a budget regression. Driving the real reader is also strictly
    # more: it exercises the parse and the range check this test depends on.
    # ⛔ IN-03 (round 2) floored the budget at ONE ROUND-TRIP, so a raw `0.05`
    # would now be REJECTED as out of range and fall back to the 160 s default —
    # the 0.4 s double would finish, the heal would report `healed`, and the
    # assertions below would red while LOOKING like a budget regression. The floor
    # is therefore lowered FOR THIS TEST, which is strictly more honest than
    # stubbing the reader: the real parse, the real range check and the real
    # `wait_for` all still run, and the only thing moved is the bound whose whole
    # purpose is to be too large to observe in a unit test.
    monkeypatch.setattr(mt5_relogin, "_MT5_RELOGIN_BUDGET_FLOOR_S", 0.01)
    monkeypatch.setenv("MT5_RELOGIN_BUDGET_S", "0.05")
    _install_client(monkeypatch, {"initialize": True, "initialize_sleep_s": 0.4})

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    records = _outcome_records(caplog)
    assert len(records) == 1, [r.getMessage() for r in records]
    record = records[0]
    message = record.getMessage()
    assert record.levelno == logging.ERROR, (
        f"the abandoned budget was logged at {record.levelname}. It is the one "
        "outcome here that leaves an in-flight call against the SHARED terminal "
        "with nobody measuring whether the session came up — it cannot share a "
        "level with a busy-terminal skip or a verdict (WR-05)."
    )
    assert "did not complete" not in message, (
        f"the budget expiry still exits through the entry's catch-all, whose "
        f"wording describes a transient miss: {message!r}"
    )
    assert "in flight" in message, (
        f"the line does not name the abandoned in-flight call: {message!r} — that "
        "is the whole reason this outcome outranks a verdict"
    )
    assert "0.1" in message or "0.0" in message, (
        f"the line does not name the budget it fired at: {message!r}"
    )


def _heal_guard_defects(
    source: str, *, required_names: tuple[str, ...] = ("mt5_enabled_server",)
) -> list[str]:
    """THE NEVER-RAISES PREDICATE, as a reusable function returning NAMED defects.

    ⭐ ``required_names`` WIDENS THE ONE PREDICATE SO A SECOND MODULE CAN REACH IT
    (164.6.4 plan 02). It defaults to the single kill-switch name this function
    hard-coded before, so every existing call site is byte-identical; the episode
    recorder is checked with an EMPTY tuple, because it carries no kill switch of
    its own — it is INSTRUMENTATION, disabled by its caller not running.
    ⛔ WIDEN the predicate, never COPY it: a copied structural gate is the drift
    shape this repo has a dated record of, and the copy is what rots.

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

    # ⛔ CALIBRATION HOLE CLOSED 2026-09-15 (164.6.4 wave 3, neuter C5 read GREEN).
    # This was `required not in ast.dump(...)` — a raw SUBSTRING test over the
    # serialised tree. `ast.dump` serialises string literals too, so
    # `globals()["run_mt5_session_monitor_tick"]()` satisfied the check while the
    # real call was gone: the name survived as a `Constant`, not as a reference.
    # The gate read green over a mutant that had removed the very thing it exists
    # to prove. Resolve an ACTUAL reference instead — `Name` for a bare read,
    # `Attribute` for a qualified one — so a literal spelling of the name cannot
    # stand in for using it.
    referenced: set[str] = set()
    for node in ast.walk(ast.Module(body=guard.body, type_ignores=[])):
        if isinstance(node, ast.Name):
            referenced.add(node.id)
        elif isinstance(node, ast.Attribute):
            referenced.add(node.attr)
    for required in required_names:
        if required not in referenced:
            defects.append(
                f"`{required}` is no longer REFERENCED inside the guard — the guard "
                f"must cover the body from that read onward (a bare string spelling "
                f"of the name does not count)"
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
#: carried FOUR `create_task` calls before that plan (dispatch_loop, watchdog_loop,
#: daily_enqueue_loop, healthz_bridge) and FIVE after it.
#:
#: ⭐ RE-CUT TO 6 ON 2026-09-15 (Phase 164.6.4 plan 02), DELIBERATELY AND IN THE
#: SAME COMMIT AS THE SIXTH ENTRY. The sixth is `mt5_session_monitor_loop`, the
#: detection loop criterion 2 requires. This pin RED as soon as `main.py` gained
#: it — 6 != 5, with its own message saying "Re-cut it deliberately" — and that is
#: THE PIN WORKING, not a regression. ⛔ It was NOT weakened to `>=`: an inequality
#: would silently tolerate a seventh task nobody decided on, and clearing a red
#: gate by relaxing it is this repo's cardinal sin. The MEASURED before/after is
#: 5 -> 6, and `test_the_criterion_1_predicate_reds_on_a_mutant_with_the_entry_
#: excised` re-confirms the "falls by exactly one" arithmetic still holds.
#:
#: ⭐ THIS IS THE ANTI-VACUITY LEG and it is not decoration. Without it, a
#: `_heal_task_lines` predicate that silently stopped matching — a renamed symbol,
#: a changed call shape — would report "zero calls found" and the criterion-1 pin
#: would red for the right reason; but a predicate that matched NOTHING AT ALL for
#: a different reason (a `lifespan` the walk can no longer find) would make BOTH
#: halves vacuous together. The count is measured independently of the heal's name.
_LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2 = 6


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


#: Phase 164.6.4 plan 02 — the SIXTH task's symbol. Pinned by NAME, exactly as
#: `_HEAL_SYMBOL` is, so removing the wiring reds rather than passing silently.
_MONITOR_SYMBOL = "mt5_session_monitor_loop"


def _monitor_task_lines(source: str) -> list[int]:
    """Lines of every ``create_task(mt5_session_monitor_loop(...))`` in
    ``lifespan``.

    BOTH halves at once, for the same reason `_heal_task_lines` requires both: a
    bare ``await mt5_session_monitor_loop()`` reports ZERO here, which is correct
    — an inline await of an INFINITE loop would hang uvicorn's startup forever,
    which is strictly worse than the heal's one-shot version of that mistake.
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
                and arg.func.id == _MONITOR_SYMBOL
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
        f"{_LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2} were measured at 164.6.4-02. "
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


def test_CRITERION_2_lifespan_starts_the_session_monitor_exactly_once_as_a_task() -> None:
    """⛔ CRITERION 2's WIRING (Phase 164.6.4 plan 02): something in the system
    NOTICES a lapsed broker session without a human and without waiting on an
    unrelated restart.

    Zero here means the phase is INERT: the boot heal above fires once at
    analytics startup, and wave 5 measured that analytics startup is not
    correlated with the terminal losing its session at all.
    """
    source = _main_source()
    monitor_lines = _monitor_task_lines(source)
    assert len(monitor_lines) == 1, (
        f"`main.lifespan` must start {_MONITOR_SYMBOL}() EXACTLY ONCE inside a "
        f"create_task; found {len(monitor_lines)} at {monitor_lines}. Zero means "
        f"nothing polls for a lapsed session and the terminal sits dark until an "
        f"unrelated restart — the measured ≥2h34m window this phase exists to "
        f"collapse."
    )

    # ⛔ NEVER awaited inline. The heal's version of this mistake aborts uvicorn
    # startup; the MONITOR's version is strictly worse — an inline await of an
    # INFINITE loop never returns, so `lifespan` never reaches its `yield`.
    awaited = {
        node.value.func.id
        for node in ast.walk(_lifespan_node(source))
        if isinstance(node, ast.Await)
        and isinstance(node.value, ast.Call)
        and isinstance(node.value.func, ast.Name)
    }
    assert _MONITOR_SYMBOL not in awaited, (
        f"{_MONITOR_SYMBOL} is awaited INLINE in lifespan — it never returns, so "
        f"`lifespan` would never reach its `yield` and the service would never "
        f"finish starting."
    )


def test_the_monitor_task_is_named_and_tracked_like_the_worker_loops() -> None:
    """It joins the EXISTING `tasks` list — the one `_crash_handler` is attached
    to and the one the shutdown `gather` ranges over.

    ⭐ That is a CONTAINMENT contract, not a crash contract: the loop's own
    top-level guard is what makes `_crash_handler` INERT for it. Outside the list
    it would be neither crash-reported nor awaited at shutdown — an orphan whose
    ten-minute `wait_for` nothing cancels.
    """
    source = _main_source()
    task_lists = [
        node
        for node in ast.walk(_lifespan_node(source))
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "tasks" for t in node.targets)
        and isinstance(node.value, ast.List)
    ]
    assert len(task_lists) == 1
    monitored = [
        el
        for el in task_lists[0].value.elts
        if isinstance(el, ast.Call)
        and isinstance(el.func, ast.Attribute)
        and el.func.attr == "create_task"
        and any(
            isinstance(a, ast.Call)
            and isinstance(a.func, ast.Name)
            and a.func.id == _MONITOR_SYMBOL
            for a in el.args
        )
    ]
    assert len(monitored) == 1, (
        f"the monitor's create_task is not a member of lifespan's `tasks` list "
        f"({len(monitored)} found) — outside it, it gets no `_crash_handler` and "
        f"is not awaited by the shutdown gather."
    )
    names = [kw.value for kw in monitored[0].keywords if kw.arg == "name"]
    assert names and isinstance(names[0], ast.Constant) and names[0].value, (
        "the monitor's task carries no explicit `name=` — an unnamed task reports "
        "as `Task-N` in the crash handler's log, which is unreadable at 3am."
    )


def test_the_criterion_2_predicate_reds_on_a_mutant_with_the_monitor_excised() -> None:
    """⛔ CRITERION 2's FALSIFIER, the same shape criterion 1's already has.

    A predicate that could not tell the shipped wiring from one with the monitor
    removed would leave the pin above green over a production path that never
    polls — the whole phase inert behind a passing suite.
    """
    source = _main_source()
    marker = f"create_task({_MONITOR_SYMBOL}("
    mutant = "".join(
        line for line in source.splitlines(keepends=True) if marker not in line
    )
    assert mutant != source, (
        f"the excision removed NOTHING — the marker {marker!r} no longer matches "
        f"the shipped wiring, so this falsifier measures an absent mutation."
    )
    removed = len(source) - len(mutant)
    assert 0 < removed <= _MAX_EXCISED_CHARS, removed
    ast.parse(mutant)
    for survivor in (
        "dispatch_loop",
        "watchdog_loop",
        "daily_enqueue_loop",
        "_bridge_healthz",
        _HEAL_SYMBOL,
    ):
        assert f"create_task({survivor}(" in mutant, survivor
    assert len(_monitor_task_lines(source)) == 1
    assert _monitor_task_lines(mutant) == [], (
        "the criterion-2 predicate STILL reports the monitor after its task entry "
        "was excised — it is matching something other than the wiring."
    )
    assert len(_create_task_lines(mutant)) == (
        _LIFESPAN_CREATE_TASK_COUNT_AT_164_6_2 - 1
    ), "the count leg must fall by exactly one on the mutant"


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
        # Added 164.6.4-02 with the sixth entry: an excision that also took the
        # monitor out would make the FALSE below un-attributable to the heal.
        "mt5_session_monitor_loop",
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


# --------------------------------------------------------------------------- #
# Phase 164.6.4 plan 02, TASK 1 — THE TRACER: one session-state transition
# reaches `public.cron_runs` end to end, through the heal that is ALREADY wired.
#
# ⛔ The sink is FAKED and the TERMINAL is faked, but nothing between them is:
# the real `heal_mt5_terminal_session`, the real `_heal_blocking`, the real
# classifier and the real `record_mt5_session_reading` all run. What is replaced
# is `services.mt5_session_episodes.get_supabase`, i.e. exactly the transport —
# the same seam `_install_client` replaces for the rpyc wire.
# --------------------------------------------------------------------------- #


class _FakeQuery:
    """A PostgREST-shaped query builder over an in-memory `cron_runs`.

    ⛔ IT HONOURS EVERY `.eq(...)` ON AN UPDATE, and that is the whole point: the
    COMPARE-AND-SET the recorder issues is `.eq("status", "running")` in the
    UPDATE's own predicate, so a fake that ignored filters would make the guarded
    and unguarded implementations indistinguishable — a harness that cannot tell
    them apart is a harness that certifies the bug.
    """

    def __init__(self, sink: "_FakeCronRuns") -> None:
        self._sink = sink
        self._filters: list[tuple[str, object]] = []
        self._order: tuple[str, bool] | None = None
        self._op: str | None = None
        self._payload: dict | None = None
        self._count_requested: str | None = None

    def select(self, _columns: str):
        self._op = "select"
        return self

    def insert(self, payload: dict):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload: dict, count: str | None = None):
        self._op = "update"
        self._payload = payload
        # ⛔ WR-12 (round 2) — stored, never interpreted by the base fake: the
        # base transport still echoes `.data` by default (representation, the
        # real client's own default), so the shipped `_close_row` fallback
        # path (`len(rows(response))`) keeps exercising exactly what it did
        # before. `_MinimalReturningCronRuns` below is the transport that
        # actually simulates `count="exact"` + `returning="minimal"`.
        self._count_requested = count
        return self

    def eq(self, column: str, value):
        self._filters.append((column, value))
        return self

    def order(self, column: str, desc: bool = False):
        self._order = (column, desc)
        return self

    def _matches(self, row: dict) -> bool:
        return all(row.get(col) == value for col, value in self._filters)

    def execute(self):
        if self._op == "select":
            matched = [dict(r) for r in self._sink.rows if self._matches(r)]
            if self._order is not None:
                column, desc = self._order
                matched.sort(key=lambda r: r.get(column) or "", reverse=desc)
            return _FakeResponse(matched)
        if self._op == "insert":
            row = dict(self._payload or {})
            row["id"] = f"row-{len(self._sink.rows) + 1}"
            # The shipped table's own column defaults (migration
            # 20260408113029): a fake that omitted them would let an assertion
            # about `completed_at` pass or fail for harness reasons.
            row.setdefault("completed_at", None)
            row.setdefault("error", None)
            row.setdefault("status", "running")
            self._sink.rows.append(row)
            self._sink.inserts.append(dict(row))
            return _FakeResponse([dict(row)])
        if self._op == "update":
            hits = [r for r in self._sink.rows if self._matches(r)]
            for row in hits:
                row.update(dict(self._payload or {}))
            self._sink.updates.append(
                {"filters": list(self._filters), "applied": len(hits)}
            )
            response = _FakeResponse([dict(r) for r in hits])
            # ⛔ WR-12 (round 2) — the base transport still echoes
            # representation `.data` (the current real default), but a
            # request carrying `count="exact"` also gets `.count` set, exactly
            # as postgrest-py does. `_close_row`'s fallback to
            # `len(rows(response))` is therefore never EXERCISED by this base
            # fake — `.count` always wins — which is why
            # `_MinimalReturningCronRuns` exists: it is the transport that
            # blanks `.data` and forces the fallback path to matter.
            if self._count_requested == "exact":
                response.count = len(hits)
            return response
        raise AssertionError(f"harness: unsupported operation {self._op!r}")


class _FakeResponse:
    def __init__(self, data: list[dict], *, count: int | None = None) -> None:
        self.data = data
        self.count = count


class _FakeCronRuns:
    def __init__(self) -> None:
        self.rows: list[dict] = []
        self.inserts: list[dict] = []
        self.updates: list[dict] = []

    def table(self, name: str) -> _FakeQuery:
        assert name == "cron_runs", (
            f"the episode recorder wrote to {name!r}; D-5 locks the sink to "
            "public.cron_runs under a NEW cron_name and forbids a migration"
        )
        return _FakeQuery(self)

    # -- readers the assertions use ---------------------------------------- #
    def open_rows(self) -> list[dict]:
        return [r for r in self.rows if r.get("status") == "running"]

    def metadata(self, row: dict) -> dict:
        meta = row.get("metadata")
        assert isinstance(meta, dict), f"harness: row has no metadata: {row!r}"
        return meta

    def states(self) -> list[str]:
        return [self.metadata(r).get("state") for r in self.rows]

    def lifetime_dataset(self) -> list[str]:
        """The query the SUCCESSOR runs — measured closes only.

        ⭐ This is the thing the compare-and-set protects. A superseded close
        stamping `close_is_measured: false` over a genuine `true` does not merely
        mislabel a row; it DELETES the episode from this list.
        """
        return [
            str(r.get("id"))
            for r in self.rows
            if r.get("status") == "ok"
            and self.metadata(r).get("close_is_measured") is True
        ]


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> _FakeCronRuns:
    fake = _FakeCronRuns()
    monkeypatch.setattr(mt5_session_episodes, "get_supabase", lambda: fake)
    mt5_session_episodes._reset_session_episode_state_for_tests()
    yield fake
    mt5_session_episodes._reset_session_episode_state_for_tests()


def _seed_open_row(fake: _FakeCronRuns, state: str, **overrides) -> dict:
    """An OPEN run already standing when the tick arrives — the ordinary case, and
    the one an analytics redeploy must not be able to truncate."""
    metadata = {
        "schema_version": mt5_session_episodes.SCHEMA_VERSION,
        "state": state,
        "opened_by": mt5_relogin.HEAL_SOURCE_BOOT,
        "opening_kind": mt5_session_episodes.KIND_ALREADY_AUTHORIZED,
        "opening_code": None,
        "poll_interval_s": None,
        "since_previous_reading_s": None,
        "first_reading_after_boot": True,
        "started_at_is_lower_bound": True,
        "reading_attributes_account": False,
        "attribution_limit": mt5_session_episodes.ATTRIBUTION_LIMIT,
    }
    metadata.update(overrides.pop("metadata", {}))
    row = {
        "id": overrides.pop("id", f"seed-{len(fake.rows) + 1}"),
        "cron_name": mt5_session_episodes.MT5_SESSION_EPISODE_CRON_NAME,
        "started_at": overrides.pop("started_at", "2026-09-15T00:00:00+00:00"),
        "completed_at": None,
        "status": "running",
        "error": None,
        "metadata": metadata,
    }
    row.update(overrides)
    fake.rows.append(row)
    return row


#: Every value that may NEVER appear in ANY field of ANY written row. The three
#: credential literals plus the gateway host and port — the endpoint is not even
#: a name (T-164.6.2-12), and rows outlive every log.
_FORBIDDEN_ROW_LITERALS = (
    _FAKE_LOGIN,
    _FAKE_PASSWORD,
    _FAKE_SERVER,
    _FAKE_HOST,
    _FAKE_PORT,
)


def _assert_no_secret_reached_any_row(fake: _FakeCronRuns) -> None:
    """FIELD BY FIELD, not a single `repr` scan of the whole store — a partial
    leak must name WHICH value escaped and WHERE."""
    import json

    for row in fake.rows:
        for column, value in row.items():
            rendered = value if isinstance(value, str) else json.dumps(value, default=str)
            for literal in _FORBIDDEN_ROW_LITERALS:
                assert literal not in rendered, (
                    f"the episode row disclosed {literal!r} in column {column!r}: "
                    f"{rendered!r}. ⛔ Rows outlive every log; the row carries the "
                    f"verdict CLASS and the CODE only, never the composed "
                    f"verdict's terminal-supplied tail (T-164.6.4-08)."
                )


async def test_TRACER_a_minus_six_that_heals_writes_exactly_TWO_rows_end_to_end(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, sink
) -> None:
    """⭐ THE TRACER, and it is the thinnest path through every layer this phase
    touches: credential-free detector -> verdict -> durable row.

    A tick that finds `-6` and heals it is TWO transitions — `authorized -> dark`
    and `dark -> authorized` — so it is exactly TWO rows, in that order, with the
    classes and codes the terminal actually answered. Before this, those
    transitions existed only as log lines that scroll past
    (`[MT5-VERDICT-SINK-01]`; MEASURED 2026-09-05, `railway logs` returned ZERO
    matching lines).
    """
    _set_full_env(monkeypatch)
    _install_client(
        monkeypatch,
        {
            "initialize": False,
            # ⛔ THE TERMINAL ECHOES THE SUBMITTED SERVER AND ACCOUNT BACK, which
            # is exactly what T-164.6.4-08 is written against and exactly what a
            # broker is free to do. `assert_session_authorized` is CREDENTIAL-FREE,
            # so its `_raise_last()` carries no triple and can only SHAPE-scrub —
            # a bare `Broker-Demo-2` survives into `str(err)`. Any edit that lets
            # that text reach a row is a disclosure on a table whose rows outlive
            # every log.
            "last_error": (
                -6,
                f"Terminal: Authorization failed for {_FAKE_SERVER} "
                f"account {_FAKE_LOGIN}",
            ),
            "initialize_credentialed": True,
            "initialize_after_heal": True,
        },
    )

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert len(sink.inserts) == 2, (
        f"a `-6`-then-heal tick must write exactly TWO rows, got "
        f"{len(sink.inserts)}: {sink.states()}"
    )
    dark, authorized = sink.rows[0], sink.rows[1]

    # --- the dark run, opened on the DETECTOR's reading -------------------- #
    dark_meta = sink.metadata(dark)
    assert dark_meta["state"] == mt5_session_episodes.STATE_DARK
    assert dark_meta["opening_kind"] == mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT
    assert dark_meta["opening_code"] == -6
    assert dark_meta["started_at_is_lower_bound"] is True
    assert dark_meta["first_reading_after_boot"] is True, (
        "the first reading of a process has NO previous reading to measure "
        "against; `since_previous_reading_s` must be None and this flag True"
    )
    assert dark_meta["since_previous_reading_s"] is None
    # ...and CLOSED by the re-probe, as a MEASURED transition.
    assert dark["status"] == "error", (
        "a DARK run closes `error` — `status='ok'` must keep meaning exactly "
        "'an authorized run whose end we MEASURED'"
    )
    assert dark_meta["close_is_measured"] is True
    assert dark_meta["closing_kind"] == mt5_session_episodes.KIND_HEALED
    assert dark["error"] == f"{mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT}:code=-6"

    # --- the authorized run, still open ----------------------------------- #
    auth_meta = sink.metadata(authorized)
    assert auth_meta["state"] == mt5_session_episodes.STATE_AUTHORIZED
    assert auth_meta["opening_kind"] == mt5_session_episodes.KIND_HEALED
    assert authorized["status"] == "running"
    assert authorized["completed_at"] is None
    assert auth_meta["since_previous_reading_s"] is not None, (
        "the SECOND reading of the process has a MEASURED wall-clock gap; ⛔ it "
        "must not be the configured cadence wearing a measured name"
    )
    assert auth_meta["first_reading_after_boot"] is False

    # --- the invariant, and the attribution limit, on EVERY row ------------ #
    assert len(sink.open_rows()) == 1, "at most ONE open row per cron_name"
    for row in sink.rows:
        meta = sink.metadata(row)
        assert row["cron_name"] == mt5_session_episodes.MT5_SESSION_EPISODE_CRON_NAME
        assert meta["reading_attributes_account"] is False
        assert meta["attribution_limit"] == mt5_session_episodes.ATTRIBUTION_LIMIT
        assert meta["opened_by"] == mt5_relogin.HEAL_SOURCE_BOOT

    # --- and nothing secret reached either the log or the rows ------------- #
    _assert_no_credential_value_escaped(_records(caplog))
    _assert_no_secret_reached_any_row(sink)


async def test_TRACER_a_healthy_tick_against_an_open_authorized_run_INSERTS_NOTHING(
    monkeypatch: pytest.MonkeyPatch, sink
) -> None:
    """⭐ PER TRANSITION, NEVER PER TICK — for NEW ROWS. At a ten-minute cadence
    a per-tick INSERT would be ~144 rows/day forever into a shared, gated
    table, for no information — and the sink's whole value is that a NEW ROW
    means something CHANGED.

    ⛔ WR-09 (round 2) — RENAMED FROM `..._writes_NOTHING`. A healthy tick now
    issues exactly ONE UPDATE (`_confirm_row`) instead of writing nothing at
    all — see `test_TRACER_a_healthy_tick_CONFIRMS_the_open_row` for that
    property. It still inserts NO new row and closes nothing.
    """
    _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED)
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert sink.inserts == [], f"a healthy tick wrote {len(sink.inserts)} row(s)"
    assert len(sink.open_rows()) == 1


async def test_TRACER_a_healthy_tick_CONFIRMS_the_open_row(
    monkeypatch: pytest.MonkeyPatch, sink
) -> None:
    """⛔ WR-09 (round 2, HIGH-2 STEADY STATE), driven end to end through the
    REAL heal. Before this fix a healthy tick left the open row's metadata
    byte-unchanged forever — a dead loop and a live healthy one were
    identical in the durable record. Now it stamps `last_confirmed_at`.

    ⛔ B3 (round 3) — NO `confirmations` COUNTER. It was a read-modify-write
    of a stale snapshot that undercounts under the two-writer overlap this
    module is designed for; `last_confirmed_at` alone is the liveness
    answer.
    """
    seeded = _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED)
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert sink.updates and sink.updates[-1]["applied"] == 1, (
        "a healthy tick did not confirm the open row"
    )
    meta = sink.metadata(seeded)
    assert meta["last_confirmed_at"]
    assert "confirmations" not in meta, (
        "a `confirmations` counter reached a row — B3 (round 3) deleted it"
    )
    assert len(sink.open_rows()) == 1


@pytest.mark.parametrize(
    "scenario_name,scenario,expect_fragment",
    [
        # A bounded-acquire expiry. ⛔ The boot heal's busy-skip RATIONALE is
        # deliberately NOT carried into the record: "a busy terminal is evidence
        # the session is fine" is a standing claim about state this tick did not
        # measure, and a terminal held by a FAILING job is where it is most wrong.
        ("busy_skip", None, "skipped"),
        # A budget abandon. The log line itself says whether the session came up
        # is "unknowable from here"; a row asserting either state would
        # contradict it.
        ("budget_abandon", {"initialize_sleep_s": 0.25}, "ABANDONED"),
    ],
)
async def test_TRACER_a_reading_that_measured_NOTHING_writes_no_row_and_closes_nothing(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sink,
    scenario_name: str,
    scenario,
    expect_fragment: str,
) -> None:
    seeded = _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED)
    _set_full_env(monkeypatch)

    if scenario_name == "busy_skip":
        @asynccontextmanager
        async def _always_busy(terminal_key: str, *, wait_s=None):
            raise Mt5TerminalBusyError(terminal_key, wait_s or 0.0)
            yield  # pragma: no cover — unreachable, keeps this a generator

        monkeypatch.setattr(mt5_relogin, "mt5_terminal_lease", _always_busy)
        _install_client(monkeypatch, {"initialize": True})
    else:
        # ⛔ The floor is lowered FOR THIS TEST exactly as
        # `test_a_hung_terminal_is_abandoned_at_the_budget_and_raises_nothing`
        # does, and for its stated reason: IN-03 (round 2) floors the budget at
        # ONE ROUND-TRIP, so a raw `0.05` would be REJECTED, fall back to the
        # 160 s default, the double would finish, and this test would assert an
        # ABANDON that never happened.
        monkeypatch.setattr(mt5_relogin, "_MT5_RELOGIN_BUDGET_FLOOR_S", 0.01)
        monkeypatch.setenv("MT5_RELOGIN_BUDGET_S", "0.05")
        _install_client(monkeypatch, scenario)

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert any(
        expect_fragment in r.getMessage() for r in _outcome_records(caplog)
    ), [r.getMessage() for r in _outcome_records(caplog)]
    assert sink.inserts == [], (
        f"the {scenario_name} reading wrote a row — it MEASURED NOTHING, so it "
        f"may neither open nor close an episode"
    )
    assert sink.updates == [], f"the {scenario_name} reading closed an episode"
    assert seeded["status"] == "running"
    assert seeded["completed_at"] is None


@pytest.mark.parametrize(
    "ipc_code,expect_state",
    [
        # ⚠️ IN-02, and it is load-bearing: `-6` is only ever observable through
        # the SECOND `last_error()` round-trip, so when THAT is the broken one the
        # fault classifies as `0` and is healed not at all. It must be recorded
        # `unattributed`, NEVER guessed into `authorized` or `dark`.
        (0, mt5_session_episodes.STATE_NOT_MEASURED),
        (-10004, mt5_session_episodes.STATE_NOT_MEASURED),
        (-10005, mt5_session_episodes.STATE_NOT_MEASURED),
        (-6, mt5_session_episodes.STATE_DARK),
    ],
)
def test_TRACER_the_reading_is_mapped_from_the_CODE_and_a_zero_is_UNATTRIBUTED(
    ipc_code: int, expect_state: str
) -> None:
    reading = mt5_session_episodes.classify_reading(
        mt5_session_episodes.KIND_IPC_FAULT, ipc_code
    )
    assert reading.state == expect_state
    assert reading.unattributed is (ipc_code == 0), (
        "`code=0` is the sentinel `_raise_last` uses for THREE distinct faults; "
        "it attributes to none of them and must say so"
    )


def test_TRACER_the_two_positive_classes_are_mapped_by_CLASS_not_by_code() -> None:
    """A clean probe RAISES NOTHING, so there is no `last_error()` to read and no
    code to map from. ⛔ Substituting `0` there would collide with the IN-02
    sentinel and turn every healthy reading into an unattributed one."""
    for kind in (
        mt5_session_episodes.KIND_ALREADY_AUTHORIZED,
        mt5_session_episodes.KIND_HEALED,
    ):
        reading = mt5_session_episodes.classify_reading(kind, None)
        assert reading.state == mt5_session_episodes.STATE_AUTHORIZED
        assert reading.unattributed is False


# --------------------------------------------------------------------------- #
# (c2) MORE THAN ONE OPEN ROW IS REACHABLE AND MUST BE HANDLED, NOT ASSUMED AWAY
# --------------------------------------------------------------------------- #


async def test_an_ORPHANED_open_row_is_closed_as_superseded_and_never_as_measured(
    monkeypatch: pytest.MonkeyPatch, sink
) -> None:
    """Railway OVERLAPS CONTAINERS ON DEPLOY — the old one drains while the new
    one boots — so two monitor loops can observe the same terminal for a window.
    A read that takes the newest row and never looks back leaves the older one
    open FOREVER, and the episode it represents is LOST from the very lifetime
    dataset criterion 1 exists to build."""
    orphan = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_DARK,
        id="orphan",
        started_at="2026-09-15T00:00:00+00:00",
    )
    live = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_DARK,
        id="live",
        started_at="2026-09-15T02:00:00+00:00",
    )
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert orphan["status"] == "error"
    assert sink.metadata(orphan)["closing_kind"] == mt5_session_episodes.KIND_SUPERSEDED
    assert sink.metadata(orphan)["close_is_measured"] is False, (
        "a superseded close must stay DISTINGUISHABLE from a genuine dark-window "
        "end, or this fix corrupts the dataset in a new way instead of an old one"
    )
    assert orphan["error"] == mt5_session_episodes.KIND_SUPERSEDED
    # the NEWEST row is the live one and it was closed as a MEASURED transition
    assert live["status"] == "error"
    assert sink.metadata(live)["close_is_measured"] is True
    assert sink.metadata(live)["closing_kind"] == mt5_session_episodes.KIND_ALREADY_AUTHORIZED
    assert len(sink.open_rows()) == 1
    assert sink.metadata(sink.open_rows()[0])["state"] == (
        mt5_session_episodes.STATE_AUTHORIZED
    )


@pytest.mark.parametrize(
    "broken_metadata",
    [
        pytest.param({"state": None}, id="state-absent"),
        pytest.param({"state": "AUTHORISED"}, id="state-malformed"),
        pytest.param({"schema_version": 99}, id="unrecognised-schema-version"),
    ],
)
async def test_a_row_NOTHING_PARSED_is_superseded_and_never_becomes_a_lifetime(
    monkeypatch: pytest.MonkeyPatch, sink, broken_metadata: dict
) -> None:
    """⛔ "Differs" is TOTAL and would otherwise swallow this case, closing a row
    NOTHING PARSED with `close_is_measured` true — fabricating a measured
    lifetime out of a row whose start state was never established."""
    broken = _seed_open_row(
        sink, mt5_session_episodes.STATE_AUTHORIZED, metadata=broken_metadata
    )
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    assert broken["status"] == "error"
    assert sink.metadata(broken)["close_is_measured"] is False
    assert sink.metadata(broken)["closing_kind"] == mt5_session_episodes.KIND_SUPERSEDED
    assert sink.lifetime_dataset() == [], (
        "a row nothing parsed reached the lifetime dataset"
    )
    assert len(sink.open_rows()) == 1


async def test_THE_COMPARE_AND_SET_a_superseded_close_cannot_overwrite_a_measured_one(
    sink,
) -> None:
    """⛔ THE RACE THE PREDICATE EXISTS FOR, DRIVEN DIRECTLY.

    Container A closes row R GENUINELY (`close_is_measured: true`). Container B —
    already mid-open, having read R as live BEFORE A's write — then issues its
    superseded close against the SAME row, from its STALE copy. With the
    compare-and-set the second write is a no-op and the episode survives; without
    it, `false` is stamped over `true` and the successor's `close_is_measured`
    filter EXCLUDES a genuinely measured episode.

    ⚠️ Reading the row first and branching in Python does NOT fix this: the
    interleave is between the read and the write, which is exactly the window a
    compare-and-set closes and a read-then-write does not.
    """
    row = _seed_open_row(sink, mt5_session_episodes.STATE_AUTHORIZED, id="R")
    stale_copy = dict(row)  # container B's read, taken BEFORE A's write

    # container A: the genuine, MEASURED close
    await mt5_session_episodes._close_row(
        row,
        state=mt5_session_episodes.STATE_AUTHORIZED,
        closing_kind=mt5_session_episodes.KIND_NO_AUTHORIZED_ACCOUNT,
        closing_code=-6,
        source=mt5_relogin.HEAL_SOURCE_SESSION_MONITOR,
        measured=True,
    )
    assert sink.lifetime_dataset() == ["R"]

    # container B: the superseded close, from its stale read
    await mt5_session_episodes._close_row(
        stale_copy,
        state=mt5_session_episodes.STATE_AUTHORIZED,
        closing_kind=mt5_session_episodes.KIND_SUPERSEDED,
        closing_code=None,
        source=mt5_relogin.HEAL_SOURCE_BOOT,
        measured=False,
    )

    assert sink.lifetime_dataset() == ["R"], (
        "the superseded close DELETED a genuinely measured episode from the "
        "lifetime dataset — the `status='running'` predicate is missing from the "
        "UPDATE, so the write landed on an already-closed row"
    )
    assert sink.metadata(row)["close_is_measured"] is True
    assert row["status"] == "ok"
    # and the no-op is MEASURED, not inferred: the second update matched 0 rows
    assert sink.updates[-1]["applied"] == 0, (
        "the second UPDATE matched a row; its predicate no longer carries "
        "status='running'"
    )
    assert ("status", "running") in sink.updates[-1]["filters"]


async def test_the_recorder_NEVER_raises_and_leaves_the_verdict_byte_identical(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    """⛔ INSTRUMENTATION MUST NOT CHANGE WHAT A CALLER OBSERVES (T-153.3-24).

    A sink that raises on every call must leave the heal's verdict line
    BYTE-IDENTICAL — the recorder runs under `main.lifespan`'s `_crash_handler`,
    which calls `SHUTDOWN.set()` on ANY background-task exception.
    """

    def _exploding_sink():
        raise RuntimeError("supabase is unreachable")

    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    with caplog.at_level(logging.INFO, logger=_LOGGER_NAME):
        monkeypatch.setattr(mt5_session_episodes, "get_supabase", _exploding_sink)
        assert await mt5_relogin.heal_mt5_terminal_session() is None

    outcomes = _outcome_records(caplog)
    assert [r.getMessage() for r in outcomes] == [
        f"mt5 boot heal: {mt5_relogin._VERDICT_ALREADY_AUTHORIZED}"
    ], [r.getMessage() for r in outcomes]


def test_the_recorder_carries_the_SAME_never_raises_shape_as_the_heal() -> None:
    """⭐ THE ONE PREDICATE, WIDENED — never a second copy.

    The recorder is checked with an EMPTY `required_names`: it carries no kill
    switch of its own, because it is INSTRUMENTATION and is disabled by its
    caller not running.
    """
    for symbol in (
        mt5_session_episodes.record_mt5_session_reading,
        mt5_session_episodes.record_mt5_heal_outcome,
    ):
        source = textwrap.dedent(inspect.getsource(symbol))
        assert _heal_guard_defects(source, required_names=()) == [], symbol.__name__


def test_required_names_is_NOT_satisfied_by_the_name_as_a_STRING_LITERAL() -> None:
    """⛔ THE CALIBRATION FOR THE HOLE C5 FOUND — and the reason this predicate is
    an AST walk rather than a substring test.

    MEASURED 2026-09-15 (164.6.4 wave 3): with `required_names` implemented as
    `required not in ast.dump(body)`, the neuter that replaced a direct call with
    `globals()["<name>"]()` read **GREEN**. `ast.dump` serialises a `Constant`'s
    value, so the name was still "present" in the dump while nothing referenced it
    — the gate certified the exact edit it exists to forbid.

    Deletion alone cannot separate a real check from that fake one: deletion bites
    on both. Only a mutant that KEEPS the spelling and DROPS the reference can, so
    that is what this drives.
    """
    literal_only = textwrap.dedent(
        '''
        async def f():
            try:
                globals()["mt5_enabled_server"]()
            except Exception:
                pass
        '''
    )
    defects = _heal_guard_defects(literal_only, required_names=("mt5_enabled_server",))
    assert any("no longer REFERENCED" in d for d in defects), (
        "the name appears ONLY as a string literal and nothing reads it — the "
        f"predicate must report it missing, got: {defects}"
    )

    # …and the control, on the REAL guard rather than a synthetic body: the shipped
    # source references the same name for real and is CLEAN, so the assertion above
    # is rejecting the missing REFERENCE and not merely rejecting everything.
    assert _heal_guard_defects(_heal_source(), required_names=("mt5_enabled_server",)) == []


def test_the_required_names_parameter_BITES() -> None:
    """⛔ THE CALIBRATION FOR THE NEW PARAMETER. Without it, `required_names` is a
    claim rather than a gate: a parameter that can never fire is indistinguishable
    from one that is ignored."""
    source = _heal_source()
    assert _heal_guard_defects(source) == []
    defects = _heal_guard_defects(
        source, required_names=("a_name_that_is_not_in_the_guard_body",)
    )
    assert defects and any(
        "a_name_that_is_not_in_the_guard_body" in d for d in defects
    ), defects
    # ...and the DEFAULT is still the kill-switch name, so every existing call
    # site is byte-identical in behaviour.
    assert (
        inspect.signature(_heal_guard_defects).parameters["required_names"].default
        == ("mt5_enabled_server",)
    )


async def test_orphans_are_closed_EVEN_WHEN_the_newest_row_needs_no_transition(
    monkeypatch: pytest.MonkeyPatch, sink
) -> None:
    """⛔ THE CASE A `limit 1` READ LOSES FOREVER, AND IT IS WHY THE READ TAKES
    ALL OPEN ROWS.

    Two containers overlap on a Railway deploy and both open a run. The next tick
    observes the state the NEWEST row already claims, so there is no transition to
    write — and a recorder that read only the newest row would return right there,
    leaving the older row open with a null `completed_at` FOREVER. The episode it
    represents is then LOST from the very lifetime dataset criterion 1 exists to
    build, and no later tick ever looks back far enough to find it.

    ⭐ The orphan here is AUTHORIZED on purpose. Its superseded close must still
    be `status='error'`, because `status='ok'` means exactly one thing — "an
    authorized run whose end we MEASURED" — and an anomaly that borrowed `ok`
    would be indistinguishable from a measured session lifetime to any reader who
    filtered on `status` alone.
    """
    orphan = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        id="orphan",
        started_at="2026-09-15T00:00:00+00:00",
    )
    newest = _seed_open_row(
        sink,
        mt5_session_episodes.STATE_AUTHORIZED,
        id="newest",
        started_at="2026-09-15T02:00:00+00:00",
    )
    _set_full_env(monkeypatch)
    _install_client(monkeypatch, {"initialize": True})

    assert await mt5_relogin.heal_mt5_terminal_session() is None

    # nothing TRANSITIONED, so nothing was opened...
    assert sink.inserts == [], "a tick with no transition wrote a row"
    # ...and the NEWEST row is untouched, still live.
    assert newest["status"] == "running"
    assert newest["completed_at"] is None
    # ...but the ORPHAN was closed, as an anomaly and never as a measurement.
    assert orphan["status"] == "error", (
        "a SUPERSEDED close borrowed `status='ok'` from the run's state. "
        "`ok` must keep meaning 'an authorized run whose end we MEASURED', or a "
        "reader filtering on status alone reads an anomaly as a session lifetime."
    )
    assert sink.metadata(orphan)["close_is_measured"] is False
    assert sink.metadata(orphan)["closing_kind"] == mt5_session_episodes.KIND_SUPERSEDED
    assert sink.metadata(orphan)["completed_at_is_notice_time"] is True, (
        "a superseded row's `completed_at` is the time we NOTICED, not a measured "
        "transition — the mirror of `started_at_is_lower_bound` at the other end"
    )
    assert sink.lifetime_dataset() == [], (
        "the orphan reached the lifetime dataset as a measured episode"
    )
    assert len(sink.open_rows()) == 1
