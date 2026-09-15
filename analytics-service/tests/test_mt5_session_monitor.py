"""Phase 164.6.4 plan 02, task 2 — THE SESSION MONITOR, and the one thing it must
be structurally incapable of doing: ENDING.

WHAT IS UNDER TEST. `services/mt5_session_monitor.py` is the trigger the system
did not have. Phase 164.6.2's boot heal is deployed, armed and IDLE — it fires
once at analytics startup, and wave 5 MEASURED that analytics startup is not
correlated with the terminal losing its session (no analytics deployment at all on
the day it lapsed). The exposure is the DARK WINDOW, `≥2h34m` confirmed inside a
`≈8h05m` bracket, against a recovery of at most `00:03:43`.

⛔ THE DEFECT CLASS THIS FILE EXISTS TO PREVENT IS THE FIX'S OWN. A keepalive that
dies silently on tick 3 behind a green worker reproduces, inside the remedy,
exactly the failure the phase was booked for. `main.lifespan`'s `_crash_handler`
calls `SHUTDOWN.set()` on ANY background-task exception, so a raising loop does
not merely stop polling — it stops dispatch, watchdog and enqueue behind a green
`/health`. The loop therefore needs TWO properties, not one:

  * OUTER CONTAINMENT — it cannot raise out to `_crash_handler`; and
  * INNER PER-TICK SURVIVAL — a tick that fails must not end the loop.

⛔ Reusing the heal's exactly-one-`Try` predicate would assert only the first, and
on a loop the naive guard is WORSE than none: the handler ENDS THE LOOP. Both
halves are therefore measured BEHAVIOURALLY here; plan 03 owns the calibrated AST
gates for the structural half.

⛔ NO REAL CREDENTIAL APPEARS HERE and none ever may — the repo is PUBLIC and
`.planning/` is tracked (D-04). ⛔ NO TEST EXECUTES `main.lifespan`: it starts
job-claiming loops and a local run claims REAL prod compute jobs.
"""
from __future__ import annotations

import ast
import asyncio
import inspect
import logging
import os
import pathlib
import re
import subprocess
import sys
import textwrap
from typing import Final

import pytest

import main_worker
from services import mt5_concurrency, mt5_relogin, mt5_session_episodes
from services import mt5_session_monitor as monitor
from services.mt5_client import Mt5Client

# ⛔ IMPORTED, NEVER COPIED (plan 03, key_links). `_heal_guard_defects` is THE ONE
# never-raises predicate; plan 02 widened it with a keyword-only `required_names`
# precisely so a second module could reach it without a second copy. A copied
# structural gate is the drift shape this repo has a dated record of, and the COPY
# is what rots. `tests/` is a package and `pytest.ini` sets `pythonpath = .`, so
# this import is a plain one — MEASURED to work before it was written.
from tests.test_mt5_relogin import _HEAL_GUARD_MUTANTS, _heal_guard_defects

# The obviously-fake register, matching `tests/test_mt5_relogin.py` byte for byte.
_FAKE_LOGIN = "4242424"
_FAKE_PASSWORD = "n0t-a-real-password"
_FAKE_SERVER = "Broker-Demo-2"
_FAKE_HOST = "gateway.test"
_FAKE_PORT = "18812"

_MONITOR_LOGGER = "quantalyze.analytics.mt5_session_monitor"
_RELOGIN_LOGGER = "quantalyze.analytics.mt5_relogin"

#: Fast enough that a unit test can observe several ticks; ⛔ the FLOOR is lowered
#: alongside it, exactly as `test_a_hung_terminal_is_abandoned_at_the_budget_and_
#: raises_nothing` lowers the budget floor, and for the same stated reason: the
#: real parse and the real range check still run, and the only thing moved is the
#: bound whose whole purpose is to be too large to observe in a unit test.
_TEST_CADENCE_S = 0.01

#: ⛔ `lifespan`'s shutdown gather waits 10 s and then CANCELS. A loop that cannot
#: exit inside that window is logged as a failure to exit cleanly on EVERY deploy,
#: so the exit is asserted against a bound derived from that number rather than
#: against "it eventually stopped".
_LIFESPAN_GATHER_BUDGET_S = 10.0


@pytest.fixture(autouse=True)
def _reset_state():
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    mt5_session_episodes._reset_session_episode_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()
    mt5_relogin._reset_relogin_log_throttle_for_tests()
    mt5_session_episodes._reset_session_episode_state_for_tests()


class _FakeRpycConn:
    def __init__(self) -> None:
        self.close_calls = 0

    def close(self) -> None:
        self.close_calls += 1


class _FakeMt5:
    """The relogin suite's double, trimmed to what the monitor reaches.

    ⭐ The bare and credentialed forms stay SEPARATE keys, because criterion 3 is
    exactly the claim that one of them is never called. A double answering both
    identically could not express it.
    """

    def __init__(self, scenario: dict) -> None:
        self._scenario = scenario
        self._MetaTrader5__conn = _FakeRpycConn()
        self.initialize_kwargs: list[dict] = []
        self.call_order: list[str] = []
        self.credentialed_accepted = False

    def initialize(self, **kwargs):
        credentialed = "login" in kwargs
        self.initialize_kwargs.append(dict(kwargs))
        self.call_order.append(
            "initialize_credentialed" if credentialed else "initialize"
        )
        post_heal = not credentialed and self.credentialed_accepted
        if post_heal:
            return self._scenario.get("initialize_after_heal", True)
        result = self._scenario.get(
            "initialize_credentialed" if credentialed else "initialize", True
        )
        if credentialed and result:
            self.credentialed_accepted = True
        return result

    def last_error(self):
        if self.credentialed_accepted and "last_error_after_heal" in self._scenario:
            return self._scenario["last_error_after_heal"]
        return self._scenario.get("last_error", (0, "unknown"))

    def shutdown(self):  # pragma: no cover — the monitor must never call it (D-35)
        raise AssertionError(
            "the session monitor called mt5.shutdown() — that destroys the ONE "
            "shared IPC pipe for EVERY concurrent caller (D-35)"
        )


class _FakeCronRuns:
    """The in-memory episode sink. Deliberately minimal: this file's subject is
    the LOOP, and the row semantics are gated in `tests/test_mt5_relogin.py`."""

    def __init__(self) -> None:
        self.rows: list[dict] = []

    def table(self, name: str):
        assert name == "cron_runs"
        return _FakeQuery(self)


class _FakeQuery:
    def __init__(self, sink: _FakeCronRuns) -> None:
        self._sink = sink
        self._filters: list[tuple[str, object]] = []
        self._op: str | None = None
        self._payload: dict | None = None

    def select(self, _columns: str):
        self._op = "select"
        return self

    def insert(self, payload: dict):
        self._op = "insert"
        self._payload = payload
        return self

    def update(self, payload: dict, count: str | None = None):
        # ⛔ WR-12 (round 2) — `count` accepted so `_close_row`'s real
        # `.update(payload, count="exact")` call does not raise here. This
        # module's own subject is the LOOP, not the row semantics (those are
        # gated in `tests/test_mt5_relogin.py`), so `count` is unused: the
        # fake's `.execute()` always echoes representation `.data`, which
        # keeps `_close_row`'s fallback path exercising the same thing it did
        # before this round.
        self._op = "update"
        self._payload = payload
        return self

    def eq(self, column: str, value):
        self._filters.append((column, value))
        return self

    def order(self, column: str, desc: bool = False):
        self._order = (column, desc)
        return self

    def execute(self):
        matched = [
            r
            for r in self._sink.rows
            if all(r.get(c) == v for c, v in self._filters)
        ]
        if self._op == "select":
            matched.sort(key=lambda r: r.get("started_at") or "", reverse=True)
            return _FakeResponse([dict(r) for r in matched])
        if self._op == "insert":
            row = dict(self._payload or {})
            row.setdefault("id", f"row-{len(self._sink.rows) + 1}")
            row.setdefault("completed_at", None)
            row.setdefault("error", None)
            self._sink.rows.append(row)
            return _FakeResponse([dict(row)])
        for row in matched:
            row.update(dict(self._payload or {}))
        return _FakeResponse([dict(r) for r in matched])


class _FakeResponse:
    def __init__(self, data: list[dict]) -> None:
        self.data = data


def _set_full_env(monkeypatch: pytest.MonkeyPatch, *, enabled: str = "true") -> None:
    monkeypatch.setenv("MT5_ENABLED", enabled)
    monkeypatch.setenv("MT5_LOGIN", _FAKE_LOGIN)
    monkeypatch.setenv("MT5_PASSWORD", _FAKE_PASSWORD)
    monkeypatch.setenv("MT5_SERVER", _FAKE_SERVER)
    monkeypatch.setenv("MT5_GATEWAY_HOST", _FAKE_HOST)
    monkeypatch.setenv("MT5_GATEWAY_PORT", _FAKE_PORT)


def _install_client(monkeypatch: pytest.MonkeyPatch, scenario: dict) -> _FakeMt5:
    fake = _FakeMt5(scenario)

    def _connect(*, host, port, timeout):
        return fake

    def _factory(host: str, port: int, **kwargs) -> Mt5Client:
        return Mt5Client(host, port, _connect=_connect, **kwargs)

    monkeypatch.setattr(mt5_relogin, "Mt5Client", _factory)
    return fake


@pytest.fixture
def fast_cadence(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(monitor, "_MT5_SESSION_POLL_INTERVAL_FLOOR_S", 0.001)
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, str(_TEST_CADENCE_S))


@pytest.fixture
def shutdown(monkeypatch: pytest.MonkeyPatch) -> asyncio.Event:
    """A PER-TEST `SHUTDOWN`, never the shared module-level one.

    ⛔ Setting the real `main_worker.SHUTDOWN` would leak into every other test in
    the session — and under `-n auto --dist loadgroup` that is a flake mechanism,
    not a theory.
    """
    event = asyncio.Event()
    monkeypatch.setattr(main_worker, "SHUTDOWN", event)
    return event


@pytest.fixture
def sink(monkeypatch: pytest.MonkeyPatch) -> _FakeCronRuns:
    fake = _FakeCronRuns()
    monkeypatch.setattr(mt5_session_episodes, "get_supabase", lambda: fake)
    return fake


async def _run_until(
    predicate, shutdown_event: asyncio.Event, *, timeout: float = 5.0
) -> asyncio.Task:
    """Start the loop, wait for ``predicate()``, then ask it to stop and JOIN it.

    ⛔ The join is bounded by the same 10 s `lifespan` allows, so "it exited" is a
    MEASUREMENT against the real budget rather than a hope.
    """
    task = asyncio.create_task(monitor.mt5_session_monitor_loop())
    deadline = asyncio.get_running_loop().time() + timeout
    while not predicate():
        assert not task.done(), f"the loop ENDED early: {task.exception()!r}"
        assert asyncio.get_running_loop().time() < deadline, "predicate never held"
        await asyncio.sleep(0.005)
    shutdown_event.set()
    await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)
    return task


async def test_CRITERION_2_a_dark_reading_drives_the_heal_with_no_human_and_no_restart(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, shutdown, sink
) -> None:
    """⭐ THE PHASE'S POINT, MEASURED. Nothing restarts, nobody opens a VNC
    session, and the terminal's `-6` is answered on the loop's own cadence.

    Before this, `heal_mt5_terminal_session` could only fire at analytics startup
    — and wave 5 measured no analytics deployment at all on the day the session
    lapsed, so nothing in the system was able to notice or act for ≥2h34m.
    """
    _set_full_env(monkeypatch)
    fake = _install_client(
        monkeypatch,
        {
            "initialize": False,
            "last_error": (-6, "Terminal: Authorization failed"),
            "initialize_credentialed": True,
            "initialize_after_heal": True,
        },
    )

    await _run_until(lambda: "initialize_credentialed" in fake.call_order, shutdown)

    assert "initialize_credentialed" in fake.call_order, (
        "the monitor observed a `-6` and never drove the credentialed heal — the "
        "loop notices nothing and the phase is inert"
    )
    # the credential-free detector ran FIRST, and the heal only after it
    assert fake.call_order[0] == "initialize"
    # ...and the transition reached the durable sink, under the monitor's name.
    states = [r["metadata"]["state"] for r in sink.rows]
    assert mt5_session_episodes.STATE_DARK in states, states
    assert all(
        r["metadata"]["opened_by"] == mt5_relogin.HEAL_SOURCE_SESSION_MONITOR
        for r in sink.rows
    ), [r["metadata"]["opened_by"] for r in sink.rows]
    assert all(
        r["metadata"]["poll_interval_s"] == _TEST_CADENCE_S for r in sink.rows
    ), "the DETECTION POLL INTERVAL in effect did not ride into the row"


async def test_CRITERION_3_an_already_authorized_terminal_is_never_sent_a_credential(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, shutdown, sink
) -> None:
    """⛔ THE MONITOR NEVER LOGS IN TO MEASURE (criterion 3, D-1).

    Question THREE is UNSETTLED (`R1: true`, `r2 pending`), so the account-change
    hazard is neither confirmed nor refuted and must be treated as LIVE. A loop
    that healed unconditionally on a cadence would multiply that hazard — and the
    `_raise_last` exposure — on a schedule, forever. The measurement is the FAKE's
    own record: across many ticks, not ONE call carried a `login` kwarg.
    """
    _set_full_env(monkeypatch)
    fake = _install_client(monkeypatch, {"initialize": True})

    await _run_until(lambda: len(fake.call_order) >= 3, shutdown)

    assert fake.call_order, "the loop never touched the terminal at all"
    assert all(c == "initialize" for c in fake.call_order), fake.call_order
    assert all("login" not in kw for kw in fake.initialize_kwargs), (
        "a credential was sent to a terminal that did not need one — criterion 3 "
        "forbids logging in as a side effect of MEASURING, and a disclosure "
        "surface opened for nothing is the worst kind"
    )
    # ⭐ PER TRANSITION, NEVER PER TICK: three healthy readings, ONE open run.
    assert len(sink.rows) == 1, (
        f"{len(sink.rows)} rows for {len(fake.call_order)} healthy ticks — at a "
        f"ten-minute cadence a per-tick write is ~144 rows/day forever into a "
        f"shared, gated table, for no information"
    )


async def test_A_TICK_THAT_RAISES_DOES_NOT_END_THE_LOOP(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, shutdown, caplog
) -> None:
    """⛔ THE INNER PER-TICK SURVIVAL HALF, and it is the half the naive guard
    gets wrong.

    Reusing the heal's exactly-one-`Try` predicate on a loop yields a handler that
    ENDS THE LOOP — a keepalive dying silently on tick 3 behind a green worker,
    i.e. this phase's own defect class arriving inside its own fix. Tick 1 raises
    a bare `RuntimeError` past the tick's own guard; tick 2 must still run.
    """
    ticks: list[int] = []

    async def _raise_once() -> None:
        ticks.append(len(ticks))
        if len(ticks) == 1:
            raise RuntimeError("tick 1 escaped its own guard")

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _raise_once)

    with caplog.at_level(logging.ERROR, logger=_MONITOR_LOGGER):
        await _run_until(lambda: len(ticks) >= 3, shutdown)

    assert len(ticks) >= 3, (
        f"the loop stopped after {len(ticks)} tick(s) — a handler that ends the "
        f"loop is a keepalive that dies silently behind a green worker"
    )
    assert any(
        "the LOOP CONTINUES" in r.getMessage() for r in caplog.records
    ), [r.getMessage() for r in caplog.records]


async def test_A_RAISING_TICK_NEVER_REACHES_THE_CRASH_HANDLER(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, shutdown
) -> None:
    """⛔ THE OUTER CONTAINMENT HALF. `_crash_handler` calls `SHUTDOWN.set()` on
    ANY background-task exception, which stops dispatch, watchdog and enqueue
    behind a green `/health` — a SILENT ANALYTICS OUTAGE caused by an MT5 gateway
    nobody needed. The loop task must therefore complete with NO exception.
    """

    async def _always_raises() -> None:
        raise RuntimeError("every tick fails")

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _always_raises)

    task = asyncio.create_task(monitor.mt5_session_monitor_loop())
    await asyncio.sleep(0.1)
    assert not task.done(), "the loop ended while every tick was failing"
    shutdown.set()
    await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)
    assert task.exception() is None, (
        f"the loop raised {task.exception()!r} — `_crash_handler` would call "
        f"SHUTDOWN.set() and take the worker down behind a green /health"
    )


async def test_the_disabled_kill_switch_reading_is_COUNTED_not_merely_logged(
    monkeypatch: pytest.MonkeyPatch, sink: _FakeCronRuns
) -> None:
    """⛔ WR-03. `_log_configuration_fault_once` throttles the disabled-switch
    log line to ONE per process — invisible after the first tick. The tick must
    ALSO record the refusal as a `not_measured` reading, so the SAME blind-run
    counter and escalation that already covers `busy_skip`/`budget_abandoned`/
    the `code=0` sentinel also covers a kill switch flipped off and forgotten.
    """
    monkeypatch.setenv("MT5_ENABLED", "false")

    for _ in range(3):
        await monitor.run_mt5_session_monitor_tick()

    assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 3, (
        "the disabled-switch tick did not extend the blind-run counter — the "
        "throttled log line is the ONLY evidence it left, and that line fires "
        "once per process"
    )
    assert sink.rows == [], (
        "a not_measured reading must write NOTHING to the durable sink — only "
        "the in-process counter and the eventual log LEVEL are affected"
    )


async def test_the_first_ITERATION_waits_BEFORE_ticking_so_the_boot_heal_owns_the_window(
    monkeypatch: pytest.MonkeyPatch, shutdown: asyncio.Event
) -> None:
    """⛔ WR-02. `main.lifespan` starts `mt5_boot_heal` and `mt5_session_monitor`
    back to back in the same gather, so a loop that ticks IMMEDIATELY drives two
    tasks against the ONE shared terminal at the same instant on every deploy.
    The loop must wait for (approximately) one full poll interval before its
    first tick, so the boot heal owns the boot window uncontested.

    ⛔ IN-08 (round 2) — THE "DOES NOT TICK IMMEDIATELY" HALF LIVES IN
    `test_the_first_ITERATION_does_NOT_tick_before_a_LARGE_cadence_elapses`,
    driven against a cadence far too large for ANY realistic scheduler delay
    to close — never against a wall-clock race on a SHORT cadence. This test
    keeps only the direction that is safe under load: load can only make the
    first tick fire LATER relative to the cadence, never earlier.
    """
    cadence_s = 0.2
    monkeypatch.setattr(monitor, "_MT5_SESSION_POLL_INTERVAL_FLOOR_S", 0.001)
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, str(cadence_s))

    started = asyncio.get_running_loop().time()
    tick_offsets: list[float] = []

    async def _record_tick() -> None:
        tick_offsets.append(asyncio.get_running_loop().time() - started)

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _record_tick)

    task = asyncio.create_task(monitor.mt5_session_monitor_loop())
    await asyncio.wait_for(
        _wait_until(lambda: len(tick_offsets) >= 1), timeout=cadence_s * 10
    )
    assert tick_offsets[0] >= cadence_s * 0.5, (
        f"the first tick fired {tick_offsets[0]:.3f}s after start against a "
        f"{cadence_s}s cadence — it must wait for (approximately) one full "
        "interval before ticking, so the boot heal owns the boot window"
    )

    shutdown.set()
    await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)


async def test_the_first_ITERATION_does_NOT_tick_before_a_LARGE_cadence_elapses(
    monkeypatch: pytest.MonkeyPatch, shutdown: asyncio.Event
) -> None:
    """⛔ IN-08 (round 2). The negative half of WR-02's property — "it did NOT
    tick immediately" — used to be asserted after a real `asyncio.sleep(cadence_s
    * 0.25)` against a 0.2s cadence: a 0.05s margin. Under `-n auto` on a loaded
    box a starved event loop can overshoot that margin, the loop's own 0.2s wait
    elapses for real, the first tick lands, and the gate REDS on a CORRECT
    implementation.

    ⭐ DRIVING THE CLOCK INSTEAD OF THE WALL: the cadence here is 300s — a
    margin no realistic scheduler delay closes against the real ~0.05s sleep
    below (a ~6000x safety factor) — so the assertion is robust regardless of
    box load. The ORDERING claim this test drives does not need a real
    cadence; the "fires at approximately the right time" half is covered
    separately, against a short cadence, by
    `test_the_first_ITERATION_waits_BEFORE_ticking_so_the_boot_heal_owns_the_window`.
    """
    monkeypatch.setattr(monitor, "session_poll_interval_s", lambda: 300.0)

    tick_offsets: list[float] = []

    async def _record_tick() -> None:
        tick_offsets.append(asyncio.get_running_loop().time())

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _record_tick)

    task = asyncio.create_task(monitor.mt5_session_monitor_loop())
    await asyncio.sleep(0.05)
    assert tick_offsets == [], (
        "the loop ticked before its own (300s) cadence elapsed — it races the "
        "boot heal for the ONE shared terminal on every deploy"
    )

    shutdown.set()
    await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)


async def _wait_until(predicate, *, poll_s: float = 0.005) -> None:
    while not predicate():
        await asyncio.sleep(poll_s)


async def test_a_tick_that_outruns_its_own_cadence_is_BOUNDED_and_logged_distinctly(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture, sink
) -> None:
    """⛔ WR-06. The heal's own `to_thread` budget bounds only its BLOCKING body —
    the bounded lease acquire and the recorder's Supabase round trips (up to six,
    each carrying postgrest-py's 120 s default) are UNBOUNDED at the tick level. A
    tick whose heal call outlives the configured cadence must be cut off AT the
    cadence rather than left to stretch it silently, and the log must name the
    budget bite distinctly from a generic fault.

    ⛔ WR-07 (round 2) — THE DEADLINE BITE MUST BE COUNTED, not merely logged.
    Before the fix this arm was the ONE non-measuring exit outside
    `_CONSECUTIVE_NOT_MEASURED_READINGS`: a degraded Supabase cutting off every
    tick at this deadline froze the counter at whatever it was and
    `blind_run_escalation_threshold` could never fire. `sink` is installed so
    this recording call stays OFFLINE — before this fix the arm made no DB
    call at all, so nothing installed one.
    """
    cadence_s = 0.05
    monkeypatch.setattr(monitor, "_MT5_SESSION_POLL_INTERVAL_FLOOR_S", 0.001)
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, str(cadence_s))
    monkeypatch.setenv("MT5_ENABLED", "true")

    started = asyncio.get_running_loop().time()

    async def _never_finishes(*, source: str, poll_interval_s: float | None) -> None:
        await asyncio.sleep(100.0)

    monkeypatch.setattr(monitor, "heal_mt5_terminal_session", _never_finishes)

    with caplog.at_level(logging.ERROR, logger=_MONITOR_LOGGER):
        await monitor.run_mt5_session_monitor_tick()

    elapsed = asyncio.get_running_loop().time() - started
    assert elapsed < 2.0, (
        f"the tick took {elapsed:.2f}s against a {cadence_s}s cadence — an "
        "UNBOUNDED heal call is exactly the silent cadence stretch WR-06 exists "
        "to bound"
    )
    messages = [r.getMessage() for r in caplog.records]
    assert any("did not complete inside its own" in m for m in messages), messages
    assert not any("exc_class=" in m for m in messages), (
        "the budget bite fell through to the generic exc_class-carrying fault "
        "line rather than its own distinct message — an operator could no longer "
        "tell a slow sink from a broken gateway"
    )
    assert mt5_session_episodes._CONSECUTIVE_NOT_MEASURED_READINGS == 1, (
        "the tick's own deadline bite did not extend the blind-run counter — it "
        "is the one non-measuring exit that used to escape it entirely"
    )
    assert sink.rows == [], "a tick-deadline reading must write NOTHING durably"


async def test_the_loop_exits_on_SHUTDOWN_well_inside_the_ten_second_gather(
    monkeypatch: pytest.MonkeyPatch, shutdown, sink
) -> None:
    """⛔ THE HOUSE SLEEP IDIOM, MEASURED AGAINST THE REAL BUDGET.

    A bare `asyncio.sleep(600)` would be FORCE-CANCELLED by `lifespan`'s gather on
    every deploy and logged as a failure to exit cleanly. With
    `wait_for(SHUTDOWN.wait(), ...)` the exit is prompt even at the SHIPPED
    ten-minute default, which is what this test drives — not the fast cadence.
    """
    _set_full_env(monkeypatch, enabled="false")
    # the SHIPPED default: no cadence override, no floor override.
    assert monitor.session_poll_interval_s() == 600.0, (
        "the DETECTION POLL INTERVAL default moved; re-derive it from the floor "
        "(the heal's budget ceiling) and the ceiling (the hourly prober's cadence)"
    )

    task = asyncio.create_task(monitor.mt5_session_monitor_loop())
    await asyncio.sleep(0.05)
    assert not task.done()

    started = asyncio.get_running_loop().time()
    shutdown.set()
    await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)
    elapsed = asyncio.get_running_loop().time() - started
    assert elapsed < 1.0, (
        f"the loop took {elapsed:.2f}s to notice SHUTDOWN against a 600s cadence "
        f"— it is not sleeping on the event, so every deploy force-cancels it"
    )
    assert task.exception() is None


async def test_the_kill_switch_OFF_skips_the_tick_and_NEVER_ends_the_loop(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, shutdown, caplog
) -> None:
    """⛔ SKIP, NEVER `return`. A `return` from the LOOP on a disabled switch would
    end it for the life of the process, so flipping the variable back on would
    need a REDEPLOY — and the operator would have no way to tell a disabled
    monitor from a dead one.

    ⚠️ The line NAMES the variable, because `mt5_enabled_server` is
    `.strip().lower() == "true"`: `1`, `on` and `yes` all read OFF, so an edit to
    any of them would otherwise disable detection with an EMPTY log.
    """
    _set_full_env(monkeypatch, enabled="off")
    fake = _install_client(monkeypatch, {"initialize": True})

    real_tick = monitor.run_mt5_session_monitor_tick
    ticks: list[int] = []

    async def _counting() -> None:
        ticks.append(len(ticks))
        await real_tick()

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _counting)

    with caplog.at_level(logging.WARNING, logger=_RELOGIN_LOGGER):
        await _run_until(lambda: len(ticks) >= 3, shutdown)

    assert len(ticks) >= 3, "the disabled kill switch ENDED the loop"
    assert fake.call_order == [], (
        "the kill switch is OFF and the terminal was touched anyway — the switch "
        "must be read BEFORE anything is constructed"
    )
    messages = [r.getMessage() for r in caplog.records]
    named = [m for m in messages if "MT5_ENABLED" in m]
    assert named, messages
    assert len(named) == 1, (
        f"the disabled switch logged {len(named)} times across {len(ticks)} "
        f"ticks — on a loop, an unthrottled skip line fills the operator's log "
        f"forever: {named}"
    )


def test_EXACTLY_ONE_cadence_knob_exists_and_it_is_the_DETECTION_POLL_INTERVAL(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ THE INTERVAL THIS PHASE IS FORBIDDEN TO CHOOSE IS A DIFFERENT NUMBER.

    Criterion 1 and D-3: wave 5 produced exactly ONE observation of each quantity,
    and an interval set from `n=1` is the guess D-06 exists to prevent. What ships
    here is a DETECTION POLL CADENCE, derived from INSTRUMENT BOUNDS and ZERO
    session-lifetime observations — which is exactly why choosing it does not
    violate criterion 1.

    The bounds are re-derived here rather than restated, so a retune of the heal's
    budget ceiling carries through instead of silently invalidating the floor.
    """
    assert monitor.MT5_SESSION_POLL_INTERVAL_ENV == "MT5_SESSION_POLL_INTERVAL_S"
    # ⛔ WR-08 (round 2) — THE FLOOR SUMS TWO CEILINGS, NOT ONE. A tick's
    # wall-clock cost is the bounded lease ACQUIRE plus the bounded heal
    # OPERATION; a floor equal to the budget ceiling alone let this tick's
    # own outer deadline (WR-06) pre-empt the heal's abandoned-thread arm at
    # the floor with the budget at its own ceiling.
    assert monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S == (
        mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S
        + mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
    ), (
        "the FLOOR is the heal's DECLARED BUDGET CEILING plus its bounded "
        "LEASE-WAIT CEILING, so a tick can never still be running when the "
        "next one starts and the loop cannot overlap itself against the ONE "
        "shared terminal — AND so this tick's own outer deadline can never "
        "pre-empt the heal's own abandoned-thread arm"
    )
    # ⛔ RE-POINTED AT THE DERIVATION (plan 03, task 2(b)). This line restated the
    # literal `3600.0`, which made the test a SECOND SOURCE OF TRUTH for a number
    # whose whole justification lives in another instrument's schedule — the
    # `[164.7-CITATION-DRIFT-01]` class. The derivation itself, and the window's
    # strictness, are asserted by
    # `test_the_declared_cadence_BOUNDS_are_DERIVATIONS_and_not_free_numbers`.
    assert monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S == _prod_prober_cadence_s(), (
        "the CEILING is the independent hourly prod-prober's cadence: at or above "
        "it this loop measures nothing that instrument does not already measure"
    )
    floor = monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S
    ceiling = monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S
    default = monitor._MT5_SESSION_POLL_INTERVAL_DEFAULT_S
    assert floor <= default <= ceiling, (floor, default, ceiling)


def test_the_FLOOR_bounds_the_heals_WORST_CASE_wall_clock_not_the_budget_alone() -> None:
    """⛔ WR-08 (round 2). The heal's worst-case wall clock is the bounded lease
    ACQUIRE plus the bounded OPERATION — the budget bounds only the `to_thread`
    body, and the acquire happens before it. At the OLD floor (the budget
    ceiling alone) a heal whose lease-wait AND budget both sit at THEIR OWN
    ceiling — both legal, independently-validated configurations — costs MORE
    than one interval, so this tick's own outer `wait_for` (WR-06) pre-empts
    the heal's `except asyncio.TimeoutError` arm and its `budget_abandoned`
    reading before either can fire — turning a COUNTED exit into an uncounted
    one. Neutering the floor back to the budget ceiling alone (300.0) reds this
    against the lease-wait ceiling's default (30.0): 300.0 < 330.0.
    """
    worst_case_heal_wall_clock_s = (
        mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S
        + mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
    )
    assert monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S >= worst_case_heal_wall_clock_s, (
        f"the floor ({monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S}s) is below the "
        f"heal's own worst-case wall clock ({worst_case_heal_wall_clock_s}s) — a "
        "tick at the floor with the budget at ITS ceiling pre-empts the heal's "
        "own abandoned-thread ERROR arm before it can fire"
    )


@pytest.mark.parametrize(
    "hostile", ["", "   ", "not-a-number", "0", "-1", "nan", "inf", "-inf", "1e400"]
)
def test_a_hostile_cadence_falls_back_to_the_derived_default(
    monkeypatch: pytest.MonkeyPatch, hostile: str
) -> None:
    """The knob's properties come from the SHIPPED `_env_float` UNCHANGED — which
    is the whole reason it is imported under its leading underscore rather than
    re-implemented. ⛔ A second copy is the drift its own gate exists to prevent.

    Absent, blank, non-numeric, zero, negative, `nan` and `inf` all take the
    default, so there is no input that reaches an `asyncio.wait_for` unvalidated
    and none that reaches the loop as an exception.
    """
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, hostile)
    assert (
        monitor.session_poll_interval_s()
        == monitor._MT5_SESSION_POLL_INTERVAL_DEFAULT_S
    )


@pytest.mark.parametrize(
    "sentinel",
    [
        # ⛔ BOTH FAULT CLASSES, and this parametrisation is not decoration. The
        # non-numeric arm and the out-of-range arm are SEPARATE messages in
        # `_env_float`, and a test driving only the first is blind to the second —
        # MEASURED 2026-09-15, when exactly that blindness let a neuter putting
        # "mt5 boot heal" back into the out-of-range message read GREEN.
        pytest.param("4242424-not-a-number", id="not-numeric"),
        pytest.param("4242424", id="out-of-range"),
    ],
)
def test_a_rejected_cadence_is_logged_ONCE_by_NAME_and_never_by_VALUE(
    monkeypatch: pytest.MonkeyPatch, caplog, sentinel: str
) -> None:
    """⛔ NAMES only — never a value, a length, a prefix or a hash
    (T-164.6.2-12): these records reach a PUBLIC Actions log and Sentry.

    ⚠️ The sentinels are DISTINCTIVE on purpose. Asserting that a short value like
    `"0"` is absent would be a false alarm against the window's own bounds
    (`[300.0, 3600.0]`) — the shipped
    `test_a_rejected_tuning_value_is_logged_ONCE_by_NAME_and_never_by_value` uses
    the same idiom for the same reason.
    """
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, sentinel)
    with caplog.at_level(logging.WARNING, logger=_RELOGIN_LOGGER):
        monitor.session_poll_interval_s()
        monitor.session_poll_interval_s()

    records = [r for r in caplog.records if r.name == _RELOGIN_LOGGER]
    assert len(records) == 1, (
        f"expected exactly ONE record across two calls, got {len(records)} — on a "
        f"LOOP an unthrottled configuration warning fills the operator's log "
        f"forever, which is strictly worse than it was for a once-per-boot heal"
    )
    message = records[0].getMessage()
    assert monitor.MT5_SESSION_POLL_INTERVAL_ENV in message
    assert sentinel not in message, (
        f"the rejected value {sentinel!r} reached the log: {message!r}"
    )
    assert "boot heal" not in message, (
        f"the configuration fault still names a BOOT HEAL, and it was reached "
        f"from the session monitor's own cadence knob: {message!r}"
    )


# =========================================================================== #
# PLAN 03, TASK 2(c) — CRITERION 1'S PROHIBITION, MADE MECHANICAL.
#
# ⛔ SHIP NO SECOND KNOB "READY FOR LATER". The keepalive interval is a DIFFERENT
# number from the detection poll cadence, and it is chosen in a follow-up against
# `n>1`. Wave 5 produced exactly ONE observation of each quantity; an interval set
# from `n=1` is the guess D-06 exists to prevent. The first reader who finds a
# symbol, env var, constant, default or file name for it WILL set it — which is
# how a refusal becomes a number without anybody deciding to.
#
# ⚠️ SYMBOLS, NEVER PROSE, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE.
# MEASURED at wave 2 and re-measured here: the token appears 9 times in
# `analytics-service/services/` and ALL NINE ARE REFUSALS — `mt5_client.py` since
# plan 01, plus the two modules wave 2 added, each of which says in its own
# docstring that it will not choose the number. A naive `grep -i keepalive` gate
# would red on the refusals themselves, i.e. it would punish the documentation
# that exists to keep the decision open.
# =========================================================================== #

#: ⛔ HAND-TYPED, AND IT LIVES IN `tests/` — NEVER INSIDE THE SCANNED TREE. A
#: scanner whose own roster constant sits in the tree it scans FINDS ITSELF, and a
#: self-matching gate is the self-invalidating class this repo has paid for. The
#: scan root is asserted to be `services/` below for the same reason.
_KEEPALIVE_TOKEN_ROSTER: Final[tuple[str, ...]] = (
    "keepalive",
    "keep_alive",
    "keep-alive",
)

#: ⛔ A PIN OVER A TRUNCATED OR EMPTY WALK PASSES IN SILENCE — an empty offender
#: list is what a walk that visited NOTHING returns, and it is byte-identical to a
#: clean tree. MEASURED 2026-09-15: 82 `.py` files under `services/`. The floor
#: sits well below that on purpose: it is not a ratchet on the module count (a
#: legitimate deletion must not red), it is the assertion that the walk saw a
#: plausible tree at all. ⛔ If it ever reds, FIX THE WALK; never lower the floor.
_SERVICES_WALK_FLOOR: Final[int] = 50

#: ⭐ THE FAILURE MESSAGE SAYS WHY, NOT JUST WHAT. A fence whose message is "a
#: forbidden name was found" invites the reader to rename the symbol.
_KEEPALIVE_FENCE_REASON: Final[str] = (
    "⛔ THE DETECTION POLL CADENCE AND THE KEEPALIVE INTERVAL ARE TWO DIFFERENT "
    "NUMBERS. The cadence shipped here is chosen from INSTRUMENT BOUNDS and ZERO "
    "session-lifetime observations, which is exactly why choosing it does not "
    "violate criterion 1. The KEEPALIVE INTERVAL is forbidden in this phase and "
    "is chosen in a follow-up against MORE THAN ONE measured session lifetime "
    "(criterion 1, D-3, and D-06 of Phase 164.6.2). Wave 5 produced exactly ONE "
    "observation of each quantity, and an interval set from n=1 is the guess D-06 "
    "exists to prevent. ⛔ Do not rename the symbol to get past this gate — "
    "delete it, and let the follow-up choose the number against the dataset this "
    "phase exists to start."
)


def _services_root() -> pathlib.Path:
    root = pathlib.Path(__file__).resolve().parents[1] / "services"
    assert root.name == "services" and root.is_dir(), root
    return root


def _keepalive_offenders(source: str, *, filename: str) -> list[str]:
    """THE FENCE, OVER SOURCE TEXT so it can be calibrated in BOTH directions.

    ⛔ NAMES, not text: file names, symbol names, argument names, attribute names,
    and the string literals ASSIGNED to constants — because an env-var name is a
    string literal assigned to a constant and would otherwise be invisible.
    ⛔ It must NOT reach into docstrings or comments, which is where every
    legitimate occurrence of the token lives.
    """
    offenders: list[str] = []
    if any(token in filename.lower() for token in _KEEPALIVE_TOKEN_ROSTER):
        offenders.append(f"{filename} (FILE NAME)")

    for node in ast.walk(ast.parse(source)):
        names: list[str] = []
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names = [node.name]
        elif isinstance(node, ast.Name):
            names = [node.id]
        elif isinstance(node, ast.Attribute):
            names = [node.attr]
        elif isinstance(node, ast.arg):
            names = [node.arg]
        elif isinstance(node, (ast.Assign, ast.AnnAssign)):
            value = node.value
            if isinstance(value, ast.Constant) and isinstance(value.value, str):
                names = [value.value]
        for name in names:
            lowered = name.lower()
            if any(token in lowered for token in _KEEPALIVE_TOKEN_ROSTER):
                offenders.append(f"{filename}: {name!r}")
    return offenders


def test_NO_SYMBOL_IN_SERVICES_NAMES_THE_KEEPALIVE_INTERVAL() -> None:
    """⛔ CRITERION 1'S PROHIBITION, WALKED OVER THE WHOLE TREE IT APPLIES TO.

    ⚠️ Renamed from `test_NO_SYMBOL_IN_THIS_MODULE_…` (wave 2): the walk was never
    scoped to one module, and a test whose name claims a narrower subject than it
    has is the defect class the monitor module's own header is written about.
    """
    root = _services_root()
    scanned: list[str] = []
    offenders: list[str] = []
    for path in sorted(root.rglob("*.py")):
        scanned.append(path.name)
        offenders.extend(
            _keepalive_offenders(
                path.read_text(encoding="utf-8"), filename=str(path.relative_to(root))
            )
        )

    assert len(scanned) >= _SERVICES_WALK_FLOOR, (
        f"the walk saw only {len(scanned)} file(s) under {root} — an empty or "
        f"truncated walk returns NO offenders and is byte-identical to a clean "
        f"tree. ⛔ Fix the walk, never the floor."
    )
    assert offenders == [], f"{offenders}\n\n{_KEEPALIVE_FENCE_REASON}"


#: A source carrying the thing the fence forbids. ⛔ Kept as a SYNTHETIC string in
#: `tests/`, never as a fixture file inside `services/` — a fixture inside the
#: scanned tree would make the real walk red on the calibration's own bait.
_KEEPALIVE_BAIT_SOURCE: Final[str] = '''\
"""A module that says it refuses to choose the keepalive interval..."""
from typing import Final

MT5_SESSION_POLL_INTERVAL_ENV: Final[str] = "MT5_SESSION_POLL_INTERVAL_S"
# ...and then ships one anyway, "ready for later".
MT5_KEEPALIVE_INTERVAL_S: Final[float] = 900.0
'''

#: The same file WITHOUT the forbidden symbol — the detection cadence only, plus
#: the prose refusals that are the whole reason this gate is written against
#: symbols. ⚠️ Without this half the fence could be a function that ALWAYS reds
#: and nobody would know until it did.
_KEEPALIVE_CLEAN_SOURCE: Final[str] = '''\
"""⛔ THIS IS THE DETECTION POLL CADENCE. IT IS NOT THE KEEPALIVE INTERVAL, and
this phase does not choose that number: an interval set from n=1 is the guess
D-06 exists to prevent. A keepalive that dies silently on tick 3 behind a green
worker is this phase's own defect class arriving inside the fix.
"""
from typing import Final

MT5_SESSION_POLL_INTERVAL_ENV: Final[str] = "MT5_SESSION_POLL_INTERVAL_S"
# The keepalive interval is chosen in a follow-up, against n>1.
_MT5_SESSION_POLL_INTERVAL_DEFAULT_S: Final[float] = 600.0


def session_poll_interval_s() -> float:
    """Read per call; the keepalive interval has no reader here at all."""
    return _MT5_SESSION_POLL_INTERVAL_DEFAULT_S
'''


def test_the_keepalive_fence_NAMES_the_offender_it_is_shown() -> None:
    """⛔ CALIBRATION, DIRECTION ONE: the fence can fire, and it says WHICH symbol."""
    offenders = _keepalive_offenders(_KEEPALIVE_BAIT_SOURCE, filename="bait.py")
    assert offenders, (
        "the fence tolerated `MT5_KEEPALIVE_INTERVAL_S: Final[float] = 900.0` — "
        "criterion 1's prohibition is prose again"
    )
    assert any("MT5_KEEPALIVE_INTERVAL_S" in offender for offender in offenders), (
        f"the fence fired but did not NAME the offender: {offenders} — a gate that "
        "says only 'something is wrong' sends the next reader hunting"
    )
    assert _keepalive_offenders("", filename="mt5_keepalive_interval.py"), (
        "a FILE NAME carrying the token is not caught — the first knob would "
        "arrive as a module, not as a constant"
    )


def test_the_keepalive_fence_is_GREEN_on_the_detection_cadence_and_on_the_refusals() -> None:
    """⛔ CALIBRATION, DIRECTION TWO, AND IT IS THE HALF THAT IS EASY TO SKIP.

    Without it the fence could be a function that ALWAYS reds and nobody would
    know until it did. It also pins the property the whole design rests on: the
    refusals — which are PROSE, in docstrings and comments, and which mention the
    forbidden token by name on purpose — must not trip the gate that exists to
    protect them.
    """
    assert _keepalive_offenders(_KEEPALIVE_CLEAN_SOURCE, filename="clean.py") == [], (
        "the fence red on a source whose ONLY keepalive occurrences are the "
        "REFUSALS — a gate that punishes the documentation keeping the decision "
        "open would be removed within a week, and the prohibition with it"
    )


async def test_A_FAILURE_OUTSIDE_THE_PER_TICK_GUARD_STILL_CANNOT_END_THE_WORKER(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, caplog
) -> None:
    """⛔ THE OUTER CONTAINMENT HALF, DRIVEN WHERE IT ACTUALLY LIVES.

    `test_A_RAISING_TICK_NEVER_REACHES_THE_CRASH_HANDLER` fails the TICK, and the
    per-tick guard catches that before the outer one is ever reached — so it
    measures the INNER property twice and the outer one not at all. MEASURED
    2026-09-15: narrowing the outer guard to `except ValueError` left it GREEN.

    The `while` HEADER is outside every inner guard, so a `SHUTDOWN` whose
    `is_set()` raises is the reachable representative of "something failed where
    only the outer guard can catch it". The loop must still complete with NO
    exception, because `main.lifespan`'s `_crash_handler` calls `SHUTDOWN.set()`
    on ANY background-task exception and would stop dispatch, watchdog and enqueue
    behind a green `/health`.
    """

    class _HostileShutdown:
        def __init__(self) -> None:
            self.calls = 0

        def is_set(self) -> bool:
            self.calls += 1
            raise RuntimeError("the shutdown event cannot answer")

        async def wait(self) -> bool:  # pragma: no cover — never reached
            raise AssertionError("the loop got past its `while` header")

    hostile = _HostileShutdown()
    monkeypatch.setattr(main_worker, "SHUTDOWN", hostile)

    with caplog.at_level(logging.ERROR, logger=_MONITOR_LOGGER):
        task = asyncio.create_task(monitor.mt5_session_monitor_loop())
        await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)

    assert hostile.calls == 1, hostile.calls
    assert task.exception() is None, (
        f"the loop raised {task.exception()!r} out to `_crash_handler`, which "
        f"calls SHUTDOWN.set() and takes dispatch, watchdog and enqueue down "
        f"behind a green /health — a SILENT ANALYTICS OUTAGE caused by an MT5 "
        f"gateway nobody needed"
    )
    assert any(
        "THE LOOP ITSELF STOPPED" in r.getMessage() for r in caplog.records
    ), (
        "the loop stopped and said NOTHING — silence is the defect class this "
        "milestone exists to remove, and from here nothing will notice a lapsed "
        "broker session until the process restarts"
    )


# =========================================================================== #
# PLAN 03, TASK 1 — THE TWO STRUCTURAL PROPERTIES, EACH WITH ITS OWN CALIBRATED
# MUTANT TABLE.
#
# A LOOP NEEDS TWO PROPERTIES AND ONE OF THEM IS NOT THE HEAL'S.
#
#   P-outer — THE TASK CAN NEVER ESCAPE. The whole body inside one `try` /
#     `except Exception`, the handler body itself guarded (IN-06), no `finally:`
#     and no `else:` (both sit OUTSIDE the handler). This is EXACTLY the shipped
#     `_heal_guard_defects`, imported above and widened by plan 02 — not copied.
#
#   P-inner — ONE TICK CAN NEVER KILL THE LOOP. Every statement of the `while`
#     body inside a guard whose bare-`Exception` handler CONTINUES.
#
# ⛔ P-outer ALONE IS WORSE THAN NOTHING ON A LOOP. Its rule is "EXACTLY ONE
# top-level statement and it must be the `try`", which for a loop puts the `while`
# INSIDE the guard — so the handler runs ONCE and the `try` is then over and THE
# LOOP IS GONE. A single transient error on tick 3 silently ends the keepalive for
# the life of the process, behind a WARNING that looks like a transient miss and a
# worker that stays green: this phase's own defect class arriving inside the fix.
# =========================================================================== #


def _tick_source() -> str:
    """P-OUTER'S SECOND SOURCE. ⛔ A SIBLING FEEDER, never an edit to
    `_heal_source` — that surface was fixed in wave 2 and plan 04 depends on it."""
    return textwrap.dedent(inspect.getsource(monitor.run_mt5_session_monitor_tick))


def _loop_source() -> str:
    """P-OUTER'S THIRD SOURCE, and P-INNER'S ONLY ONE."""
    return textwrap.dedent(inspect.getsource(monitor.mt5_session_monitor_loop))


#: ⛔ `required_names` PER SOURCE, and the loop's entry is a MEASURED CORRECTION
#: to the plan, which says "pass the kill-switch name for the tick AND the loop,
#: both of which read the switch". MEASURED 2026-09-15: the LOOP DOES NOT READ THE
#: SWITCH — `mt5_enabled_server` appears nowhere in its source, because the switch
#: is read INSIDE the tick (first statement of the tick's guard, which is where
#: criterion 3 needs it: before anything is constructed). Passing the plan's
#: literal tuple would have redded the loop against a property it correctly does
#: not have.
#:
#: What the loop owes is the SAME argument about a DIFFERENT name: the guard must
#: cover the body from the point the terminal can first be touched onward, and for
#: the loop that point is the call to the tick. `SHUTDOWN` rides along because a
#: `while` header outside the guard is precisely the escape route
#: `test_A_FAILURE_OUTSIDE_THE_PER_TICK_GUARD_STILL_CANNOT_END_THE_WORKER` found
#: ungated in wave 2.
_P_OUTER_REQUIRED_NAMES: Final[dict[str, tuple[str, ...]]] = {
    "tick": ("mt5_enabled_server",),
    "loop": ("run_mt5_session_monitor_tick", "SHUTDOWN"),
}


def _p_outer_sources() -> dict[str, str]:
    return {"tick": _tick_source(), "loop": _loop_source()}


def test_BOTH_new_symbols_satisfy_the_ONE_shared_never_raises_predicate() -> None:
    """⛔ P-OUTER OVER BOTH NEW SYMBOLS, THROUGH THE IMPORTED PREDICATE.

    `main.lifespan`'s `_crash_handler` calls `SHUTDOWN.set()` on ANY
    background-task exception, which stops dispatch, watchdog and enqueue behind a
    green `/health`. `heal_mt5_terminal_session` was built never to raise for
    exactly that reason and is AST-asserted so; a keepalive is a LOOP, so the
    hazard is PERMANENT here rather than one-shot, and both of its symbols carry
    the same property or neither does.
    """
    sources = _p_outer_sources()
    for source_id, source in sources.items():
        defects = _heal_guard_defects(
            source, required_names=_P_OUTER_REQUIRED_NAMES[source_id]
        )
        assert defects == [], (
            f"the {source_id} does not satisfy the shared never-raises predicate: "
            f"{defects}. ⛔ Fix the MODULE — never the predicate, and never a "
            "waiver: this gate also polices `heal_mt5_terminal_session` and the "
            "episode recorder, so weakening it to clear one red opens three."
        )


def test_the_GUARD_DEMONSTRABLY_COVERS_THE_TICK_CALL_and_not_merely_its_NAME() -> None:
    """⭐ A HOLE THE CALIBRATION FOUND, CLOSED AT THIS END RATHER THAN THE SHARED ONE.

    MEASURED 2026-09-15. `required_names` is implemented as a SUBSTRING test over
    `ast.dump(...)` of the guard body, so ANY occurrence of the name satisfies it —
    including a STRING LITERAL. Replacing the call with
    `await globals()['run_mt5_session_monitor_tick']()` in the shipped module left
    `test_BOTH_new_symbols_satisfy_the_ONE_shared_never_raises_predicate` **GREEN**:
    the gate saw its name and concluded the call was covered, while the guard no
    longer covers a call it can identify at all.

    ⛔ THE SHARED PREDICATE IS NOT TOUCHED TO FIX THIS. Its signature and behaviour
    were fixed in wave 2 and plan 04 imports them in this same wave; changing them
    from here is the coupling the plan forbids. The missing half is asserted HERE
    instead, where it costs one local test and no shared surface: the tick must be
    reached by a PLAIN NAMED CALL inside the guard, which is the thing
    `required_names` is a cheap proxy for.
    """
    fn = ast.parse(_loop_source()).body[0]
    assert isinstance(fn, ast.AsyncFunctionDef)
    body = [node for node in fn.body if not _is_docstring(node)]
    assert len(body) == 1 and isinstance(body[0], ast.Try), body

    named_calls = [
        node
        for node in ast.walk(body[0])
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "run_mt5_session_monitor_tick"
    ]
    assert len(named_calls) == 1, (
        f"the guard contains {len(named_calls)} plain named calls to "
        "`run_mt5_session_monitor_tick`; exactly ONE is required. A dynamic or "
        "aliased call still satisfies `required_names` — the NAME is present as a "
        "string — while nothing checks that the guard covers the only statement "
        "that can touch the terminal."
    )


#: ⛔ THE LOOP GETS ITS OWN P-OUTER TABLE, AND THE REASON IS MEASURED RATHER THAN
#: STYLISTIC. The shared `_HEAL_GUARD_MUTANTS` needles are indentation-bearing
#: strings spliced with `count=1`. Against the loop, `"    except Exception as
#: exc:"` matches THREE times (the per-tick arm and the sleep arm at 12 spaces,
#: and P-outer's own arm at 4) and the FIRST hit is the per-tick arm — so the
#: shared table would silently mutate P-INNER's guard while claiming to calibrate
#: P-outer's. The anchors below are asserted UNIQUE before they are spliced, which
#: is what makes "the mutant applied where I said it did" a measurement.
_LOOP_GUARD_MUTANTS: Final[dict[str, tuple[str, str]]] = {
    "finally-outside-the-handler": (
        "APPEND",
        "\n    finally:\n        raise RuntimeError('cleanup')\n",
    ),
    "else-outside-the-handler": (
        "APPEND",
        "\n    else:\n        raise RuntimeError('else')\n",
    ),
    "outer-handler-narrowed": (
        "    except Exception as exc:  # noqa: BLE001 — see the docstring; this "
        "is the control",
        "    except ValueError as exc:  # noqa: BLE001 — see the docstring; this "
        "is the control",
    ),
    "outer-fallback-narrower-than-the-failure": (
        "        except BaseException:  # noqa: BLE001 — see the comment; this is "
        "the control",
        "        except Exception:  # noqa: BLE001 — see the comment; this is "
        "the control",
    ),
    "outer-handler-body-grew-an-unguarded-statement": (
        "APPEND",
        "\n        logger.info('an unguarded extra %s', type(exc).__name__)\n",
    ),
    # ⛔ THE CALIBRATION FOR THIS SOURCE'S `required_names`, which is the half of
    # plan 02's widening that only becomes a gate once something drives it. An
    # ALIASED tick call is the realistic edit: the guard still wraps everything, so
    # every other arm stays green, but the gate can no longer SEE that the call it
    # is supposed to cover is inside it.
    "the-guard-no-longer-demonstrably-covers-the-tick-call": (
        "await run_mt5_session_monitor_tick()",
        "await _aliased_tick()",
    ),
}

#: The PRODUCT of sources and mutants (plan 1(b)): every source P-outer polices is
#: calibrated, not just the one the shipped table was written against.
_P_OUTER_MUTANT_TABLES: Final[dict[str, dict[str, tuple[str, str]]]] = {
    "tick": _HEAL_GUARD_MUTANTS,
    "loop": _LOOP_GUARD_MUTANTS,
}

_P_OUTER_MUTANT_CASES: Final[list[tuple[str, str]]] = [
    (source_id, mutant_id)
    for source_id, table in sorted(_P_OUTER_MUTANT_TABLES.items())
    for mutant_id in sorted(table)
]


def _splice(source: str, needle: str, replacement: str, *, mutant_id: str) -> str:
    """Apply one mutant to a COPY of the shipped source. Nothing on disk is
    touched.

    ⛔ THREE THINGS ARE ASSERTED BEFORE ANY RED IS BELIEVED, and each of them is a
    way a calibration has already passed VACUOUSLY in this repo:
      * the anchor is PRESENT — a stale anchor makes the mutant a no-op;
      * the anchor is UNIQUE — an ambiguous anchor mutates a DIFFERENT arm from
        the one the mutant is named for, so the red proves the wrong thing;
      * the text actually CHANGED — a neuter that does not apply reads as GREEN.
    """
    if needle == "APPEND":
        mutated = source.rstrip("\n") + replacement
    else:
        occurrences = source.count(needle)
        assert occurrences == 1, (
            f"the {mutant_id!r} anchor occurs {occurrences} time(s) in the "
            f"source; exactly ONE is required. 0 means the anchor is stale and "
            f"the mutant would be a no-op that reads as a pass; >1 means the "
            f"splice lands on whichever arm happens to come first, so the red "
            f"would be evidence about a DIFFERENT arm. Anchor: {needle!r}"
        )
        mutated = source.replace(needle, replacement, 1)
    assert mutated != source, (
        f"the {mutant_id!r} mutation did not change the text — a neuter that does "
        "not apply reads as GREEN"
    )
    return mutated


@pytest.mark.parametrize("source_id,mutant_id", _P_OUTER_MUTANT_CASES)
def test_P_OUTER_REDS_on_every_escape_route_in_EVERY_source_it_polices(
    source_id: str, mutant_id: str
) -> None:
    """⛔ THE CALIBRATION, RUN OVER THE PRODUCT. Without it the P-outer assertions
    are claims about the source rather than a gate: a predicate that never fires is
    indistinguishable from one that cannot.

    ⛔ EVERY MUTANT MUST BE VALID PYTHON — and that is not pedantry. A first draft
    of the shipped table spliced `finally:` BEFORE the `except:`, which is a
    SyntaxError, so the calibration "passed" without the assertion ever being
    reached. The parse therefore happens OUTSIDE any `try` here: an unparseable
    mutant must FAIL this test rather than be excused by it.
    """
    needle, replacement = _P_OUTER_MUTANT_TABLES[source_id][mutant_id]
    source = _p_outer_sources()[source_id]
    mutated = _splice(source, needle, replacement, mutant_id=mutant_id)

    defects = _heal_guard_defects(
        mutated, required_names=_P_OUTER_REQUIRED_NAMES[source_id]
    )
    assert defects, (
        f"the never-raises predicate tolerated {mutant_id!r} in the {source_id} — "
        "that escape route reaches `main.lifespan`'s `_crash_handler`, which "
        "calls SHUTDOWN.set() and stops the dispatch, watchdog and enqueue loops "
        "behind a green /health"
    )


# --------------------------------------------------------------------------- #
# P-INNER — THE LOOP CANNOT BE KILLED BY ONE TICK
# --------------------------------------------------------------------------- #


def _is_docstring(node: ast.stmt) -> bool:
    return (
        isinstance(node, ast.Expr)
        and isinstance(node.value, ast.Constant)
        and isinstance(node.value.value, str)
    )


def _handler_type(handler: ast.ExceptHandler) -> str:
    return "<bare except:>" if handler.type is None else ast.unparse(handler.type)


def _loop_survival_defects(source: str) -> list[str]:
    """P-INNER, AS A REUSABLE FUNCTION OVER SOURCE TEXT, returning NAMED defects.

    ⛔ PARAMETERISED BY SOURCE TEXT ON PURPOSE, in the same shape as
    `_heal_guard_defects`: a structural gate that is only ever run against the
    file it polices is indistinguishable from one that returns the empty list.
    The mutant table below feeds it text the shipped module never contains.

    The escape routes it names, each of which ENDS THE KEEPALIVE while the worker
    stays green and `/health` stays 200:

      1. the guard body does not hold EXACTLY ONE `while`;
      2. a statement in the `while` body is not itself a `try` — an unguarded
         statement there escapes to P-OUTER's handler, and P-outer's handler is
         OUTSIDE the `while`, so catching there ends the loop;
      3. a per-tick guard's FINAL handler does not catch bare `Exception`;
      4. a per-tick handler `break`s or `raise`s — a handler that ends the loop is
         the silent death this predicate exists to prevent; ⛔ IN-06 (round 2) —
         WIDENED to also scan the per-tick `try`'s OWN `else:`/`finally:`
         clauses, which sit OUTSIDE every handler and were invisible to a scan
         that only walked `handler.body`;
      5. that final handler's body is not EXACTLY one nested `try` with a
         `BaseException` handler and no `finally:`/`else:` (IN-06, for the same
         argument-evaluation reason as P-outer: `logger.error`'s ARGUMENTS are
         evaluated before logging is entered and stdlib `logging` does not swallow
         that evaluation);
      6. a bare `asyncio.sleep`, or no shutdown-aware wait at all — `lifespan`
         gives loops 10 seconds to exit, and a bare sleep on a ten-minute cadence
         is force-cancelled on EVERY deploy and logged as a failure to exit.

    ⚠️ ASYMMETRY, AND IT IS DELIBERATE: rule 4 (`break`/`raise`) is checked over
    EVERY handler of each per-tick guard, because an escape from any of them ends
    the loop; rules 3 and 5 are checked over the FINAL handler only, because the
    shipped sleep guard legitimately carries a narrow `except asyncio.TimeoutError:
    pass` arm ahead of its broad one — and the narrow arm FIRST is itself
    load-bearing (`asyncio.TimeoutError is TimeoutError`, whose MRO runs through
    `OSError`).
    """
    fn = ast.parse(source).body[0]
    if not isinstance(fn, ast.AsyncFunctionDef):
        return ["the parsed node is not an async function"]

    body = [node for node in fn.body if not _is_docstring(node)]
    if len(body) != 1 or not isinstance(body[0], ast.Try):
        return [
            f"P-OUTER'S SHAPE IS P-INNER'S PRECONDITION and it no longer holds: "
            f"{len(body)} top-level statements outside the docstring; exactly ONE "
            "is allowed and it must be the `try`"
        ]

    guard = body[0]
    whiles = [node for node in guard.body if isinstance(node, ast.While)]
    if len(whiles) != 1:
        return [
            f"the guard body holds {len(whiles)} top-level `while` statements; "
            "EXACTLY ONE is required — a scheduler that has stopped looping is a "
            "keepalive that runs once and never again, which is indistinguishable "
            "at runtime from the boot heal this phase exists to replace"
        ]

    loop = whiles[0]
    defects: list[str] = []

    for stmt in loop.body:
        if not isinstance(stmt, ast.Try):
            defects.append(
                f"a bare `{type(stmt).__name__}` statement sits in the `while` "
                "body OUTSIDE any per-tick guard — it escapes to P-OUTER's "
                "handler, which sits outside the `while`, so catching it THERE "
                "ends the loop for the life of the process"
            )
            continue
        if not stmt.handlers:
            defects.append(
                "a per-tick guard has NO handler at all — a `try`/`finally` in "
                "the `while` body guards nothing and re-raises everything"
            )
            continue

        for handler in stmt.handlers:
            # ⛔ WR-05 — `Return`/`Continue` WIDEN THE SAME SCAN, not a second
            # one. `return` in a per-tick handler ends `mt5_session_monitor_loop`
            # for the life of the process — the exact silent death this
            # predicate is named for, with P-outer never entered so nothing
            # logs. `continue` in the sleep handler skips the wait it just
            # failed on and produces the hot loop the handler-order comment is
            # written against. Both are escape routes `ast.Break`/`ast.Raise`
            # alone cannot see, and this is the ONLY control for the property.
            escapes = sorted(
                {
                    type(node).__name__
                    for statement in handler.body
                    for node in ast.walk(statement)
                    if isinstance(
                        node, (ast.Break, ast.Raise, ast.Return, ast.Continue)
                    )
                }
            )
            if escapes:
                defects.append(
                    f"a per-tick handler (`except {_handler_type(handler)}`) "
                    f"contains {escapes} — a handler that `break`s, `return`s, "
                    "`continue`s or re-`raise`s ENDS OR CORRUPTS THE LOOP, which "
                    "is the keepalive dying silently (or spinning hot) on tick 3 "
                    "behind a green worker"
                )

        # ⛔ IN-06 (round 2) — THE SAME SCAN, WIDENED TO THE PER-TICK `try`'s
        # OWN `else:`/`finally:`. Rule 4 above walked `handler.body` for every
        # handler; it did NOT look at `stmt.orelse`/`stmt.finalbody` — the two
        # clauses that sit OUTSIDE every handler on the SAME `try`. A
        # `finally: break` or `else: return` on a per-tick guard ends the loop
        # exactly as a handler doing it would, and is invisible to the scan
        # above: `stmt.finalbody` is a sibling of `stmt.handlers`, not a
        # descendant of any of them.
        for clause_name, clause in (("else", stmt.orelse), ("finally", stmt.finalbody)):
            clause_escapes = sorted(
                {
                    type(node).__name__
                    for statement in clause
                    for node in ast.walk(statement)
                    if isinstance(
                        node, (ast.Break, ast.Raise, ast.Return, ast.Continue)
                    )
                }
            )
            if clause_escapes:
                defects.append(
                    f"a per-tick guard's `{clause_name}:` clause contains "
                    f"{clause_escapes} — an escape there ENDS OR CORRUPTS THE "
                    "LOOP exactly as a handler doing it would, and it sits "
                    "OUTSIDE every handler this predicate otherwise scans"
                )

        final = stmt.handlers[-1]
        caught = _handler_type(final)
        if caught != "Exception":
            defects.append(
                f"a per-tick guard's FINAL handler catches `{caught}`, not bare "
                "`Exception` — see the per-mutant cost messages in "
                "`_P_INNER_HANDLER_TYPE_COSTS`; narrowing and widening are "
                "DIFFERENT hazards and this one string cannot tell them apart"
            )

        nested = [node for node in final.body if isinstance(node, ast.Try)]
        if len(final.body) != 1 or len(nested) != 1:
            defects.append(
                f"the per-tick handler body has {len(final.body)} statements and "
                f"{len(nested)} nested `try` — it must be EXACTLY one nested "
                "`try`, because its own argument evaluation is unguarded (IN-06)"
            )
        else:
            inner = nested[0]
            inner_types = [_handler_type(h) for h in inner.handlers]
            if inner_types != ["BaseException"]:
                defects.append(
                    f"the per-tick nested handler catches {inner_types}, not "
                    "['BaseException'] — a fallback narrower than the failure "
                    "class it catches is not a fallback"
                )
            if inner.finalbody or inner.orelse:
                defects.append(
                    "the per-tick nested guard grew a `finally:`/`else:` — both "
                    "sit OUTSIDE the handler, same escape route as P-outer's"
                )

    calls = [node for node in ast.walk(fn) if isinstance(node, ast.Call)]
    rendered = [ast.unparse(node.func) for node in calls]
    if any(name in ("asyncio.sleep", "sleep") for name in rendered):
        defects.append(
            "the loop uses a bare `asyncio.sleep` — `lifespan`'s shutdown gather "
            "waits 10 s and then CANCELS, so a sleep on a ten-minute cadence is "
            "force-cancelled on EVERY deploy and logged as a failure to exit "
            "cleanly"
        )

    loop_calls = [
        ast.unparse(node.func)
        for statement in loop.body
        for node in ast.walk(statement)
        if isinstance(node, ast.Call)
    ]
    if not any(name.endswith("SHUTDOWN.wait") for name in loop_calls):
        defects.append(
            "the `while` body never waits on SHUTDOWN — with no shutdown-aware "
            "wait the loop either spins without delay or cannot be asked to stop "
            "inside `lifespan`'s 10-second gather"
        )
    if not any(name.endswith("wait_for") for name in loop_calls):
        defects.append(
            "the `while` body never bounds its wait with `wait_for` — an "
            "unbounded `SHUTDOWN.wait()` would tick exactly once, at shutdown"
        )

    return defects


def test_the_loop_satisfies_P_INNER() -> None:
    """⛔ THE PROPERTY THE HEAL'S PREDICATE CANNOT STATE, and the one whose absence
    would make P-outer alone WORSE than no gate at all."""
    defects = _loop_survival_defects(_loop_source())
    assert defects == [], (
        f"`mt5_session_monitor_loop` can be killed by ONE tick: {defects}. ⛔ Fix "
        "the MODULE — a keepalive that dies silently on tick 3 behind a green "
        "worker reproduces, inside the remedy, the exact failure this phase was "
        "booked for."
    )


#: ⭐ THE THREE HANDLER-TYPE MUTANTS AND WHAT EACH ONE COSTS AT RUNTIME.
#:
#: ⛔ MEASURED, AND IT IS THE REASON THIS DICT EXISTS: the shipped
#: `_heal_guard_defects` returns the IDENTICAL string — "the handler does not
#: catch bare `Exception`" — for a handler NARROWED to `ValueError`, one WIDENED
#: to `BaseException` and one WIDENED to `OSError`. Three different hazards
#: collapse into one indistinguishable red, and a table that cannot tell them
#: apart cannot tell you which hazard it just caught. The distinguishing text
#: therefore lives HERE, in the test's own assertion message, and
#: `test_the_THREE_handler_type_mutants_are_INDISTINGUISHABLE_to_the_SHARED_predicate`
#: asserts that collapse rather than assuming it.
#:
#: ⛔ AND THE WIDENING DIRECTION IS NOT OPTIONAL. A narrowing-only table cannot
#: see either of the two traps CONTEXT D-2 records as MEASURED, and both of them
#: are edits a careful reader would make believing they were making the guard
#: SAFER.
_P_INNER_HANDLER_TYPE_COSTS: Final[dict[str, str]] = {
    "per-tick-handler-NARROWED-to-ValueError": (
        "NARROWED: a tick failure of any other class escapes the per-tick guard "
        "to P-OUTER's handler — which sits OUTSIDE the `while`, so the loop ENDS "
        "for the life of the process and nothing notices a lapsed broker session "
        "until the container restarts. (If P-outer were ever narrowed too it "
        "reaches `_crash_handler`, which calls SHUTDOWN.set().)"
    ),
    "per-tick-handler-WIDENED-to-BaseException": (
        "WIDENED to `BaseException`: this arm wraps an `await`, and "
        "`asyncio.CancelledError` is NOT an `Exception` subclass on this venv "
        "(measured, Python 3.12.13) — so the widening SWALLOWS SHUTDOWN "
        "CANCELLATION and HANGS `lifespan`'s 10-second gather on EVERY deploy. "
        "⛔ This is the edit that looks like extra safety and is the opposite."
    ),
    "per-tick-handler-WIDENED-to-OSError": (
        "WIDENED to `OSError`: `asyncio.TimeoutError is TimeoutError` and its MRO "
        "runs through `OSError`, so the tick's BUDGET EXPIRY is silently eaten "
        "and read as a completed tick — the abandoned in-flight call against the "
        "shared terminal stops being reported at all."
    ),
}

#: ⛔ A MUTANT THE PREDICATE TOLERATES IS A HOLE. This table is the proof P-inner's
#: assertions BITE rather than merely being present. Every entry must be VALID
#: PYTHON, its anchor is asserted PRESENT and UNIQUE before the splice, and the
#: mutated text is asserted DIFFERENT before any red is believed.
_LOOP_SURVIVAL_MUTANTS: Final[dict[str, tuple[str, str]]] = {
    # (1) an unguarded statement appended to the `while` body — the escape route
    # to P-outer's handler, which is outside the `while`.
    "unguarded-statement-in-the-while-body": (
        "            try:\n                await asyncio.wait_for(",
        "            logger.info('an unguarded extra statement')\n"
        "            try:\n                await asyncio.wait_for(",
    ),
    # (2)/(3) a handler that ENDS the loop. ⚠️ Spliced INSIDE the nested `try`
    # rather than beside it, deliberately: beside it the handler body would stop
    # being "exactly one nested try" and the red would come from the IN-06 rule
    # instead of from the rule this mutant is named for.
    "per-tick-handler-BREAKS": (
        "                try:\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
        "                try:\n"
        "                    break\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
    ),
    "per-tick-handler-RAISES": (
        "                try:\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
        "                try:\n"
        "                    raise RuntimeError('the tick failure ends the loop')\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
    ),
    # ⛔ WR-05 — THE TWO ESCAPE ROUTES `ast.Break`/`ast.Raise` ALONE CANNOT SEE.
    "per-tick-handler-RETURNS": (
        "                try:\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
        "                try:\n"
        "                    return\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
    ),
    "sleep-handler-CONTINUES": (
        "                try:\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: the interval wait failed '
        '— the LOOP "',
        "                try:\n"
        "                    continue\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: the interval wait failed '
        '— the LOOP "',
    ),
    # (4)(5)(6) the three handler-type mutants — ONE narrowing and TWO widenings.
    "per-tick-handler-NARROWED-to-ValueError": (
        "            except Exception as exc:  # noqa: BLE001 — the control; it "
        "CONTINUES\n                try:\n                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
        "            except ValueError as exc:  # noqa: BLE001 — the control; it "
        "CONTINUES\n                try:\n                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
    ),
    "per-tick-handler-WIDENED-to-BaseException": (
        "            except Exception as exc:  # noqa: BLE001 — the control; it "
        "CONTINUES\n                try:\n                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
        "            except BaseException as exc:  # noqa: BLE001 — the control; "
        "it CONTINUES\n                try:\n                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
    ),
    "per-tick-handler-WIDENED-to-OSError": (
        "            except Exception as exc:  # noqa: BLE001 — the control; it "
        "CONTINUES\n                try:\n                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
        "            except OSError as exc:  # noqa: BLE001 — the control; it "
        "CONTINUES\n                try:\n                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard — the "',
    ),
    # (7) IN-06's fallback, narrowed below the class it exists to catch.
    "per-tick-IN-06-fallback-NARROWED": (
        "                except BaseException:  # noqa: BLE001 — the control\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard and "',
        "                except Exception:  # noqa: BLE001 — the control\n"
        "                    logger.error(\n"
        '                        "mt5 session monitor: a tick escaped its own '
        'guard and "',
    ),
    # ⛔ IN-06 (round 2) — a `finally:` on the PER-TICK TRY ITSELF, not inside
    # any handler. Rule 4's scan walks `handler.body` for every handler of
    # each per-tick guard; `stmt.finalbody` sits OUTSIDE every handler on the
    # SAME `try` and was invisible to that scan before this fix.
    "per-tick-guard-FINALLY-ends-the-loop": (
        "                        \"could not be described — the loop continues\"\n"
        "                    )\n",
        "                        \"could not be described — the loop continues\"\n"
        "                    )\n"
        "            finally:\n"
        "                break\n",
    ),
    # (8) the house sleep idiom replaced by the bare sleep it exists to avoid.
    "shutdown-aware-wait-replaced-by-a-bare-asyncio-sleep": (
        "                await asyncio.wait_for(\n"
        "                    SHUTDOWN.wait(), timeout=session_poll_interval_s()\n"
        "                )",
        "                await asyncio.sleep(session_poll_interval_s())",
    ),
    # (9) the `while` itself excised. ⚠️ Replaced by a one-shot `for` rather than
    # by an `if`, and that is a MEASURED constraint rather than a preference: the
    # sleep guard's legitimate `break` would be OUTSIDE a loop under an `if`, so
    # the mutant would be a SyntaxError — i.e. it would test the parser instead of
    # the gate, which is exactly the vacuous pass the shipped table's own comment
    # was written about.
    "while-excised-into-a-one-shot": (
        "        while not SHUTDOWN.is_set():",
        "        for _ in range(1):  # the loop is gone",
    ),
}


@pytest.mark.parametrize("mutant_id", sorted(_LOOP_SURVIVAL_MUTANTS))
def test_P_INNER_REDS_on_every_loop_death_shape(mutant_id: str) -> None:
    """⛔ THE CALIBRATION FOR P-INNER, AND IT IS THE REASON THE PREDICATE EXISTS AS
    A SEPARATE GATE AT ALL.

    ⚠️ MEASURED 2026-09-15: ALL FOUR loop-death shapes below — an unguarded
    statement in the `while` body, a `break` in the per-tick handler, the per-tick
    handler widened to `BaseException`, and the same arm widened to `OSError` —
    pass P-OUTER **CLEAN**. P-outer is satisfied by a function that loops once and
    dies. That is not a gap in P-outer; it is the reason a loop needs two
    predicates, and this test is the evidence that the second one bites.
    """
    needle, replacement = _LOOP_SURVIVAL_MUTANTS[mutant_id]
    mutated = _splice(_loop_source(), needle, replacement, mutant_id=mutant_id)

    # Parsed OUTSIDE any `try`: an unparseable mutant must FAIL this test rather
    # than be excused by it.
    defects = _loop_survival_defects(mutated)
    cost = _P_INNER_HANDLER_TYPE_COSTS.get(
        mutant_id,
        "the loop stops ticking while the worker stays green and `/health` stays "
        "200 — nothing then notices a lapsed broker session until the container "
        "restarts, which is the ≥2h34m dark window this phase was booked for",
    )
    assert defects, (
        f"P-INNER tolerated the {mutant_id!r} mutant. What that costs at runtime: "
        f"{cost}"
    )


@pytest.mark.parametrize("mutant_id", sorted(_LOOP_SURVIVAL_MUTANTS))
def test_P_OUTER_IS_BLIND_to_every_loop_death_shape_P_INNER_catches(
    mutant_id: str,
) -> None:
    """⛔ WHY THERE ARE TWO PREDICATES, MEASURED RATHER THAN ARGUED.

    MEASURED 2026-09-15: **every single one** of P-inner's mutants passes the
    shared P-outer predicate CLEAN — the unguarded statement, the `break`, the
    `raise`, all three handler-type shapes, the narrowed IN-06 fallback, the bare
    `asyncio.sleep` and the excised `while`. P-outer is satisfied by a function
    that loops once and dies, because "the whole body is inside one guard" says
    nothing about what the guard's handler does to the loop.

    Without this test, a reviewer could reasonably conclude P-inner is a second
    copy of a gate the file already has, and delete it. This is the evidence that
    deleting it would remove ALL structural coverage of nine distinct ways the
    keepalive dies behind a green worker.

    ⛔ If this ever reds because P-outer LEARNED to catch one of them, that is good
    news: record it here. It is NEVER a reason to drop P-inner's arm.
    """
    needle, replacement = _LOOP_SURVIVAL_MUTANTS[mutant_id]
    mutated = _splice(_loop_source(), needle, replacement, mutant_id=mutant_id)

    assert (
        _heal_guard_defects(mutated, required_names=_P_OUTER_REQUIRED_NAMES["loop"])
        == []
    ), (
        f"P-outer now names a defect for {mutant_id!r}, which it was MEASURED not "
        "to see. Re-record the measurement; ⛔ do not remove P-inner's arm for it "
        "— the two predicates answer different questions and the overlap is "
        "coverage, not duplication."
    )
    assert _loop_survival_defects(mutated), (
        f"and P-INNER does not catch {mutant_id!r} either — this shape is now "
        "ungated by BOTH predicates"
    )


def test_the_THREE_handler_type_mutants_carry_PAIRWISE_DISTINCT_costs() -> None:
    """⛔ DISTINCTNESS AS A GATE RATHER THAN AN INTENTION.

    Three different hazards share one predicate string (see the test below). If
    their cost messages ever collapse into one another, the table quietly halves
    its diagnostic value and NOTHING reds. This is the assertion that reds instead.
    """
    costs = list(_P_INNER_HANDLER_TYPE_COSTS.values())
    assert len(costs) == 3, sorted(_P_INNER_HANDLER_TYPE_COSTS)
    assert len(set(costs)) == 3, (
        "two of the three handler-type cost messages are now IDENTICAL — the "
        "table can no longer tell you which of a narrowing, a swallowed shutdown "
        "cancellation and an eaten budget expiry it just caught"
    )
    for mutant_id in _P_INNER_HANDLER_TYPE_COSTS:
        assert mutant_id in _LOOP_SURVIVAL_MUTANTS, (
            f"{mutant_id!r} carries a cost message but is no longer in the mutant "
            "table — a cost for a mutant nobody runs is documentation, not a gate"
        )


def test_the_THREE_handler_type_mutants_are_INDISTINGUISHABLE_to_the_SHARED_predicate() -> None:
    """⛔ THE MEASUREMENT BEHIND THE TEST ABOVE, asserted rather than asserted-about.

    The shipped `_heal_guard_defects` reports a narrowing, a widening to
    `BaseException` and a widening to `OSError` with ONE identical string. That is
    why the distinguishing text cannot be inherited from the predicate and has to
    live in the test. ⛔ If this test ever reds because the strings became
    distinct, that is GOOD NEWS and the fix is to record it — never to re-collapse
    them.
    """
    source = _loop_source()
    anchor = (
        "    except Exception as exc:  # noqa: BLE001 — see the docstring; this "
        "is the control"
    )
    strings = set()
    for replacement_type in ("ValueError", "BaseException", "OSError"):
        mutated = _splice(
            source,
            anchor,
            anchor.replace("except Exception", f"except {replacement_type}", 1),
            mutant_id=f"outer-handler-{replacement_type}",
        )
        defects = _heal_guard_defects(
            mutated, required_names=_P_OUTER_REQUIRED_NAMES["loop"]
        )
        handler_defects = [d for d in defects if "handler" in d and "catch" in d]
        assert handler_defects, (replacement_type, defects)
        strings.update(handler_defects)

    assert len(strings) == 1, (
        "the shared predicate now distinguishes the three handler-type mutants — "
        f"{sorted(strings)}. That is an IMPROVEMENT: record it and keep the "
        "per-mutant cost messages, which say what each one costs at RUNTIME "
        "rather than which name appears in the source."
    )


# --------------------------------------------------------------------------- #
# P-INNER, BEHAVIOURALLY. A shape assertion and a behaviour assertion catch
# different things: the shape cannot see a guard that is present and wrong, and
# the behaviour cannot see an escape route at a statement that does not exist yet.
# --------------------------------------------------------------------------- #


async def test_a_tick_that_fails_MID_FLIGHT_is_followed_by_more_ticks_and_a_CLEAN_exit(
    monkeypatch: pytest.MonkeyPatch, fast_cadence, shutdown
) -> None:
    """⛔ THE Nth TICK, NOT THE FIRST — and the difference is the whole property.

    `test_A_TICK_THAT_RAISES_DOES_NOT_END_THE_LOOP` fails tick 1, which a loop
    whose guard survives exactly one failure would also pass. Failing tick 2 (with
    a healthy tick before and after it) is the shape a real gateway blip takes:
    the keepalive must resume, and it must still exit inside `lifespan`'s gather
    rather than being left in a state that only a cancellation can end.
    """
    failing_tick = 2
    ticks: list[int] = []

    async def _raise_on_the_nth() -> None:
        ticks.append(len(ticks) + 1)
        if ticks[-1] == failing_tick:
            raise RuntimeError("the Nth tick escaped its own guard")

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _raise_on_the_nth)

    task = await _run_until(lambda: len(ticks) >= failing_tick + 2, shutdown)

    assert len(ticks) >= failing_tick + 2, (
        f"tick {failing_tick} failed and the loop produced only {len(ticks)} "
        f"ticks — a guard that survives exactly one failure is not survival"
    )
    assert task.exception() is None, (
        f"the loop raised {task.exception()!r} out to `_crash_handler`, which "
        "calls SHUTDOWN.set() and stops dispatch, watchdog and enqueue behind a "
        "green /health"
    )
    assert task.done() and not task.cancelled(), (
        "the loop did not exit on its own — it had to be cancelled, which is what "
        "`lifespan` logs as a failure to exit cleanly on every deploy"
    )


async def test_a_tick_that_fails_EVERY_time_neither_ends_the_loop_NOR_spins_without_delay(
    monkeypatch: pytest.MonkeyPatch, shutdown, caplog
) -> None:
    """⛔ THE RATE IS ASSERTED FIRST, BECAUSE "THE LOOP SURVIVED" IS SATISFIED BY A
    LOOP BURNING A CORE.

    A per-tick handler that also swallowed the sleep's own failure would re-enter
    the `while` immediately: every survival assertion in this file would stay
    green while the container pinned a CPU and filled the operator's log at
    whatever rate the event loop allows. So the ORDER matters — the bound on the
    tick count is checked before the "it is still running" claim is made.

    ⚠️ The cadence is set LOCALLY rather than through `fast_cadence`: the gap
    between the permitted count and a hot loop's count is the entire measurement,
    and at the 10 ms fixture cadence that gap is only ~2 orders of magnitude of
    timing jitter away. At 50 ms over a ~300 ms window the expected count is ~6
    and a hot loop is ~4 orders above the bound.
    """
    cadence_s = 0.05
    window_s = 0.3
    permitted = 40  # ~6 expected; a hot loop reaches five figures in this window

    monkeypatch.setattr(monitor, "_MT5_SESSION_POLL_INTERVAL_FLOOR_S", 0.001)
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, str(cadence_s))

    ticks: list[int] = []

    async def _always_raises() -> None:
        ticks.append(len(ticks) + 1)
        raise RuntimeError("every tick fails")

    monkeypatch.setattr(monitor, "run_mt5_session_monitor_tick", _always_raises)

    with caplog.at_level(logging.ERROR, logger=_MONITOR_LOGGER):
        task = asyncio.create_task(monitor.mt5_session_monitor_loop())
        await asyncio.sleep(window_s)
        spun = len(ticks)
        alive = not task.done()
        shutdown.set()
        await asyncio.wait_for(task, timeout=_LIFESPAN_GATHER_BUDGET_S)

    assert spun <= permitted, (
        f"{spun} ticks in {window_s}s against a {cadence_s}s cadence — the loop "
        f"is HOT. It re-enters the `while` without delay, which pins a core and "
        f"fills the operator's log while every 'the loop survived' assertion in "
        f"this file stays green. A keepalive that survives by spinning is a "
        f"different outage, not a fixed one."
    )
    assert spun >= 1, "the loop never ticked at all — this measures nothing"
    assert alive, (
        f"the loop ENDED after {spun} failing tick(s) — a handler that ends the "
        "loop is the keepalive dying silently behind a green worker"
    )
    assert task.exception() is None, task.exception()


# =========================================================================== #
# PLAN 03, TASK 2(a)(b) — THE ONE CADENCE KNOB: VALIDATED PER CALL, AND BOUNDED
# BY DERIVATIONS RATHER THAN BY FREE NUMBERS.
#
# ⛔ PER CALL AND NEVER AT IMPORT. A module-scope `float()` on a typo'd Railway
# variable took the WHOLE analytics service down (MEASURED 2026-09-14, CR-02):
# `main.lifespan` imports from `services/` in its body, BEFORE `yield` and outside
# any `try`, so a `ValueError` at module scope aborts uvicorn startup and
# `restartPolicyType ON_FAILURE x3` finishes the job. `/health`, the dispatch
# loop, the watchdog and the enqueue loop all go with it — for a best-effort MT5
# instrument nobody was waiting on.
# ⚠️ And `nan` passes a naive range check: `nan <= x` and `x <= nan` are BOTH
# False, so a range test alone lets it through to `asyncio.wait_for`.
# =========================================================================== #


def test_the_cadence_knob_is_ABSENT_SAFE_and_returns_the_derived_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The unset case, which is how it runs in production today: the variable is
    not set on Railway and the module must not need it to be."""
    monkeypatch.delenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, raising=False)
    assert (
        monitor.session_poll_interval_s()
        == monitor._MT5_SESSION_POLL_INTERVAL_DEFAULT_S
    )


def test_a_FINITE_cadence_ABOVE_the_ceiling_falls_back_to_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ THE END A HOSTILE CORPUS CANNOT REACH. `45s`/`""` are rejected at
    `float()`, `0`/`-1` by the sign and `inf`/`nan` by `math.isfinite` — not one
    of them is a FINITE value above the ceiling, so deleting the ceiling
    comparison outright would leave every one of those cases GREEN (this is WR-03
    round 2, and it is why that test exists in the relogin suite).

    ⛔ The probe is DERIVED from the bound, so a retune of the heal's budget
    ceiling or of the prober's cadence carries through instead of stranding a
    hand-typed number here.
    """
    ceiling = monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S
    monkeypatch.delenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, raising=False)
    default = monitor.session_poll_interval_s()

    over = ceiling + 1.0
    assert over > default, (over, default)
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, repr(over))
    assert monitor.session_poll_interval_s() == default, (
        f"a cadence of {over}s — above the ceiling — was HONOURED. At or above "
        "the hourly prober's own cadence this loop measures nothing that "
        "instrument does not already measure, so it would add contention for the "
        "ONE shared terminal without adding information."
    )


def test_a_FINITE_cadence_BELOW_the_floor_falls_back_to_the_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ THE OTHER END, AND IT IS THE DANGEROUS ONE. A cadence below the heal's
    DECLARED BUDGET CEILING lets tick N+1 start while tick N is still running —
    the loop overlapping ITSELF against the ONE shared terminal, which is the
    contention criterion 4 forbids, reached by a typo rather than by a decision.
    """
    floor = monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S
    monkeypatch.delenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, raising=False)
    default = monitor.session_poll_interval_s()

    under = floor / 2.0
    assert 0.0 < under < default, (under, default)
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, repr(under))
    assert monitor.session_poll_interval_s() == default, (
        f"a cadence of {under}s — below the floor ({floor}s, the heal's declared "
        "budget ceiling) — was HONOURED, so a slow tick can still be running when "
        "the next one starts and the loop overlaps itself against the shared "
        "terminal"
    )


def test_a_LEGITIMATE_cadence_is_still_honoured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """⛔ ANTI-VACUITY FOR EVERY TEST ABOVE: a reader that IGNORED the environment
    and always returned the default would satisfy all of them. This is the half
    that can only pass if the knob is genuinely read."""
    monkeypatch.delenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, raising=False)
    default = monitor.session_poll_interval_s()

    floor = monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S
    ceiling = monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S
    legitimate = (default + ceiling) / 2.0
    assert floor <= legitimate <= ceiling and legitimate != default, (
        f"harness: the probe {legitimate} is not a legitimate in-window value "
        f"DISTINCT from the default ({default}) — re-anchor it, or this case "
        "cannot distinguish a real read from a hardcoded return"
    )

    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, repr(legitimate))
    assert monitor.session_poll_interval_s() == legitimate, (
        "an in-window operator value was ignored — the knob is decorative, and a "
        "retune would need a redeploy that changes code"
    )


def test_a_malformed_cadence_cannot_abort_the_import(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The in-process half of CR-02: the load-bearing assertion is that NO
    module-level constant holds a parsed value a reimport would redo.

    ⚠️ `importlib.reload` is deliberately NOT used — the repo's own standing rule.
    A fresh interpreter is the honest oracle, and it is the case below.
    """
    monkeypatch.setenv(monitor.MT5_SESSION_POLL_INTERVAL_ENV, "45s")
    assert not hasattr(monitor, "_MT5_SESSION_POLL_INTERVAL_S"), (
        "the DETECTION POLL INTERVAL is a module-level parsed constant again — a "
        "malformed MT5_SESSION_POLL_INTERVAL_S would abort uvicorn startup at "
        "import and take the whole analytics service down (CR-02)"
    )


def test_a_malformed_cadence_cannot_abort_a_FRESH_import() -> None:
    """⛔ THE CASE THAT REDS ON THE SHIPPED-BEFORE-CR-02 SHAPE. The in-process case
    can only assert the absence of a name; this one runs the import the way uvicorn
    runs it, against the exact kind of variable value that took the service down.
    """
    env = dict(os.environ)
    env[monitor.MT5_SESSION_POLL_INTERVAL_ENV] = "45s"
    proc = subprocess.run(
        [sys.executable, "-c", "import services.mt5_session_monitor"],
        cwd=str(pathlib.Path(__file__).resolve().parents[1]),
        env=env,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, (
        "importing `services.mt5_session_monitor` with a malformed cadence "
        f"RAISED — this aborts uvicorn startup before `yield` and ON_FAILURE x3 "
        f"takes the whole analytics service down (CR-02). stderr:\n{proc.stderr}"
    )


def _prod_prober_cadence_s() -> float:
    """THE CEILING'S DERIVATION, READ FROM THE INSTRUMENT ITSELF.

    ⛔ A bound re-typed as a literal drifts from its own reason — that is the
    `[164.7-CITATION-DRIFT-01]` class, and this repo has a dated record of exactly
    it (`ARMS_FLOOR` prose said 380 while the shipped value was 384). The hourly
    prod-prober's cadence is not a Python symbol, so the derivation reads the
    schedule the workflow actually runs on.

    ⛔ EXACTLY ONE CRON SHAPE IS RECOGNISED — "at minute M of every hour". Anything
    else RAISES rather than guessing, so a schedule change reds HERE, beside the
    reason the ceiling exists, instead of silently invalidating it.
    """
    workflow = (
        pathlib.Path(__file__).resolve().parents[2]
        / ".github"
        / "workflows"
        / "prod-prober.yml"
    )
    assert workflow.is_file(), (
        f"{workflow} is missing — the DETECTION cadence CEILING is derived from "
        "the independent hourly prober's schedule, and the derivation cannot be "
        "checked without it. ⛔ Fix the path; do not replace the derivation with "
        "the literal it is there to police."
    )
    crons = re.findall(
        r'^\s*-\s*cron:\s*"([^"]+)"', workflow.read_text(encoding="utf-8"), re.M
    )
    assert len(crons) == 1, (
        f"the prod-prober now declares {len(crons)} schedules ({crons}) — decide "
        "which one the ceiling descends from and say so here"
    )
    fields = crons[0].split()
    assert len(fields) == 5, crons
    minute, hour, day_of_month, month, day_of_week = fields
    assert re.fullmatch(r"\d+", minute) and (hour, day_of_month, month, day_of_week) == (
        "*",
        "*",
        "*",
        "*",
    ), (
        f"the prod-prober's schedule {crons[0]!r} is no longer 'at minute M of "
        "every hour'. ⛔ Re-derive the DETECTION cadence CEILING from the new "
        "cadence — at or above the prober's own interval this loop measures "
        "nothing that instrument does not already measure."
    )
    return 3600.0


def test_the_declared_cadence_BOUNDS_are_DERIVATIONS_and_not_free_numbers() -> None:
    """⛔ THE MUTANT A COMPARISON-ONLY GATE CANNOT SEE: SETTING A BOUND TO `1e9`.

    Every range test above keeps passing against a ceiling of `1e9` — the
    comparison still runs, it just stops bounding anything. This is the assertion
    that each bound still equals the quantity it descends FROM, recomputed rather
    than restated:

      * FLOOR = the heal's DECLARED BUDGET CEILING plus its bounded LEASE-WAIT
        CEILING (WR-08, round 2), both taken BY SYMBOL. A tick must never still
        be running when the next one starts, or the loop overlaps itself
        against the ONE shared terminal — and a retune of EITHER ceiling must
        carry through here rather than silently invalidating this bound. The
        budget alone bounds only the heal's `to_thread` OPERATION; the bounded
        ACQUIRE happens before it and is a separate wall-clock cost.
      * CEILING = the independent hourly prod-prober's cadence, read from the
        workflow's own `schedule:`. At or above it this loop measures nothing that
        instrument does not already measure, so it would add contention without
        adding information.
      * DEFAULT strictly INSIDE that window — and STRICTLY, not `<=`: a default
        sitting ON a bound means one end of the operator's range is the fallback,
        so a rejected value and an accepted one return the same number and the
        operator cannot tell which happened.

    ⛔ ZERO SESSION-LIFETIME OBSERVATIONS ENTER ANY OF THE THREE. That is precisely
    why choosing this cadence does not violate criterion 1, and it is asserted
    rather than asserted-about by the keepalive fence above.
    """
    assert monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S == (
        mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S
        + mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S
    ), (
        "the cadence FLOOR is no longer the heal's DECLARED BUDGET CEILING plus "
        f"its LEASE-WAIT CEILING ({monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S} vs "
        f"{mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S} + "
        f"{mt5_relogin._MT5_RELOGIN_LEASE_WAIT_CEILING_S}) — it has become a free "
        "number, and the loop can now be tuned to overlap itself against the ONE "
        "shared terminal, or to pre-empt the heal's own abandoned-thread arm"
    )
    assert monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S == _prod_prober_cadence_s(), (
        "the cadence CEILING is no longer the independent hourly prober's cadence "
        f"({monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S}s vs "
        f"{_prod_prober_cadence_s()}s) — a ceiling that bounds nothing is not a "
        "bound, and this one bounds a TYPO rather than a tuning decision"
    )

    floor = monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S
    ceiling = monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S
    default = monitor._MT5_SESSION_POLL_INTERVAL_DEFAULT_S
    assert floor < default < ceiling, (
        f"the window [{floor}, {ceiling}] does not STRICTLY contain its own "
        f"default ({default}) — a bound that forbids, or coincides with, the value "
        "the module uses itself makes a rejection indistinguishable from an "
        "acceptance in the operator's log"
    )
