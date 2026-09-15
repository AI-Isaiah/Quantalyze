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

import asyncio
import logging

import pytest

import main_worker
from services import mt5_concurrency, mt5_relogin, mt5_session_episodes
from services import mt5_session_monitor as monitor
from services.mt5_client import Mt5Client

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

    def update(self, payload: dict):
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
    assert monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S == (
        mt5_relogin._MT5_RELOGIN_BUDGET_CEILING_S
    ), (
        "the FLOOR is the heal's DECLARED BUDGET CEILING, so a tick can never "
        "still be running when the next one starts and the loop cannot overlap "
        "itself against the ONE shared terminal"
    )
    assert monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S == 3600.0, (
        "the CEILING is the independent hourly prod-prober's cadence: at or above "
        "it this loop measures nothing that instrument does not already measure"
    )
    floor = monitor._MT5_SESSION_POLL_INTERVAL_FLOOR_S
    ceiling = monitor._MT5_SESSION_POLL_INTERVAL_CEILING_S
    default = monitor._MT5_SESSION_POLL_INTERVAL_DEFAULT_S
    assert floor <= default <= ceiling, (floor, default, ceiling)


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


def test_NO_SYMBOL_IN_THIS_MODULE_NAMES_THE_KEEPALIVE_INTERVAL() -> None:
    """⛔ SHIP NO SECOND KNOB "READY FOR LATER" (criterion 1, D-3, D-06).

    The keepalive interval is a DIFFERENT number, chosen in a follow-up against
    `n>1`. The first reader to find a symbol, env var, constant or default for it
    will SET it — from the single wave-5 observation, which is exactly the guess
    D-06 exists to prevent.

    ⚠️ SYMBOLS, not text. The token appears in PROSE in three `services/` files
    (`mt5_client.py` since plan 01, plus the two this plan adds) precisely because
    each one REFUSES to choose the number and says so. MEASURED 2026-09-15: 9
    prose occurrences, 0 symbols, 0 file names. ⛔ A naive `grep -i keepalive`
    gate would therefore red on the refusals themselves — plan 03 owns the
    structural gate and must be written against SYMBOLS.
    """
    import ast
    import pathlib

    root = pathlib.Path(__file__).resolve().parents[1] / "services"
    offenders: list[str] = []
    for path in sorted(root.rglob("*.py")):
        if "keepalive" in path.name.lower():
            offenders.append(f"{path.name} (FILE NAME)")
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
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
                # ⛔ An env-var NAME is a string literal ASSIGNED to a constant,
                # which is why the scan reaches into assignment VALUES — and ⛔
                # why it must NOT reach into docstrings, which is where every
                # legitimate occurrence of the token lives (the refusals).
                value = node.value
                if isinstance(value, ast.Constant) and isinstance(value.value, str):
                    names = [value.value]
            for name in names:
                if "keepalive" in name.lower():
                    offenders.append(f"{path.name}: {name!r}")
    assert offenders == [], (
        f"a keepalive-interval symbol exists in services/: {offenders}. ⛔ This "
        f"phase starts the DATASET and does not choose that number."
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
