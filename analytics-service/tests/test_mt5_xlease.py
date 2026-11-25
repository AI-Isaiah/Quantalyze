"""Tests for ``services/mt5_xlease.py`` and its wiring into ``mt5_terminal_lease``
(Phase 230 MT5NIGHTLY, plan 02, MT5D-02: the cross-process terminal lease).

THE ORACLE IS ORDERING OF TWO HOLDERS THAT SHARE ONLY THE FAKE DATABASE. Two holders in
one event loop already serialize on the in-process ``asyncio.Lock``, so a test that puts
both in one registry is green with the cross-process acquire removed (RESEARCH Pitfall
8). XPROC-01 therefore gives each "process" its OWN lock registry and lets them meet
only in ``FakeXLeaseBackend``; the control test proves the single-registry shape still
serializes, so the pair separates "the lock works" from "the database lease works".

No network, no database, no MT5 terminal.
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
import uuid
from contextvars import ContextVar

import pytest
from postgrest.exceptions import APIError

from services import mt5_client, mt5_concurrency, mt5_xlease
from services.mt5_client import HOLDER_UNATTRIBUTED, _mt5_epoch_for, mt5_terminal_holder
from services.mt5_handover import SITE_DERIVE, SITE_HOLDINGS
from tests.xlease_fakes import FakeXLeaseBackend

_XLEASE_LOGGER = "quantalyze.analytics.mt5_xlease"
_KEY = "h:1"


@pytest.fixture(autouse=True)
def _reset_terminal_state():
    """The ONE reset (``reset_terminal_state_for_tests``), before and after: a leaked
    lock or epoch must not reach the next test."""
    mt5_concurrency.reset_terminal_state_for_tests()
    yield
    mt5_concurrency.reset_terminal_state_for_tests()


async def test_xproc_01_two_holders_two_registries_one_database(monkeypatch) -> None:
    """XPROC-01 — two holders that share NO in-process lock registry but share one
    lease database never hold the same terminal at once (the cause in
    230-DISCUSSION-LOG R-3, fixed per D-01)."""
    fake = FakeXLeaseBackend()
    mt5_xlease.set_xlease_backend_for_tests(fake)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_POLL_S", 0.01)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_POLL_JITTER_S", 0.005)

    registries: dict[str, dict[str, asyncio.Lock]] = {"a": {}, "b": {}}
    proc: ContextVar[str] = ContextVar("proc")

    def _registry_of_this_process(key: str) -> asyncio.Lock:
        return registries[proc.get()].setdefault(key, asyncio.Lock())

    monkeypatch.setattr(
        mt5_concurrency, "_mt5_terminal_lock_for", _registry_of_this_process
    )

    events: list[str] = []

    async def hold(name: str) -> None:
        proc.set(name)
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            events.append(f"{name}-enter")
            await asyncio.sleep(0.05)  # a real await: an unserialized peer WOULD enter
            events.append(f"{name}-exit")

    task_a = asyncio.create_task(hold("a"))
    task_b = asyncio.create_task(hold("b"))
    # DEADMAN: a regression that never releases the row waits forever.
    await asyncio.wait_for(asyncio.gather(task_a, task_b), timeout=10.0)

    assert events == ["a-enter", "a-exit", "b-enter", "b-exit"], (
        f"XPROC-01 the second process entered before the first left (events={events}) "
        "- the cross-process lease is not serializing the terminal"
    )


async def test_xproc_01_control_one_registry_still_serializes() -> None:
    """Control: ONE registry (the production shape inside one process) serializes
    too, with the database lease granting every call. If this were red the pair
    above would be measuring the fixture, not the lease."""
    events: list[str] = []

    async def hold(name: str) -> None:
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            events.append(f"{name}-enter")
            await asyncio.sleep(0.05)
            events.append(f"{name}-exit")

    await asyncio.wait_for(asyncio.gather(hold("a"), hold("b")), timeout=10.0)

    assert events == ["a-enter", "a-exit", "b-enter", "b-exit"]


# --------------------------------------------------------------------------- #
# Task 2 — the bound, the late grant, cancellation, the wait event, redaction.
# --------------------------------------------------------------------------- #
def _digest(key: str = _KEY) -> str:
    return mt5_xlease.terminal_lease_digest(key)


@pytest.fixture
def fast_poll(monkeypatch):
    """A short poll so a contended acquire does not dominate the test's runtime."""
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_POLL_S", 0.01)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_POLL_JITTER_S", 0.005)


def _install(fake) -> None:
    mt5_xlease.set_xlease_backend_for_tests(fake)


async def _another_process_holds(fake: FakeXLeaseBackend, key: str = _KEY) -> uuid.UUID:
    """Stand in for the OTHER process: it holds the terminal in the shared database
    for an hour, with a token this process never sees."""
    foreign = uuid.uuid4()
    assert await fake.acquire(_digest(key), foreign, "house", SITE_DERIVE, 3600)
    fake.calls.clear()
    return foreign


async def test_bound_another_process_holds_raises_busy_and_leaks_nothing(
    monkeypatch, fast_poll
) -> None:
    """A bounded caller finds the terminal held by another PROCESS past its bound: it
    gets the existing busy answer, and a caller that never held the terminal changes
    NOTHING about it (no stamp, no bump, no handover row, local lock released)."""
    fake = FakeXLeaseBackend()
    _install(fake)
    await _another_process_holds(fake)
    handovers: list[dict] = []

    async def _record(**kwargs) -> None:
        handovers.append(kwargs)

    monkeypatch.setattr(mt5_concurrency, "record_mt5_terminal_handover", _record)
    epoch_before = _mt5_epoch_for(_KEY)
    started = time.monotonic()

    async def _attempt() -> None:
        async with mt5_concurrency.mt5_terminal_lease(_KEY, wait_s=0.3):
            pytest.fail("the body must never run when another process holds the terminal")

    with pytest.raises(mt5_concurrency.Mt5TerminalBusyError):
        await asyncio.wait_for(_attempt(), timeout=10.0)

    assert time.monotonic() - started < 5.0
    assert not mt5_concurrency._mt5_terminal_lock_for(_KEY).locked(), (
        "the refused caller kept the in-process lock"
    )
    assert _mt5_epoch_for(_KEY) == epoch_before, "a refused caller fenced the real holder"
    assert mt5_client._MT5_LEASE_OCCUPANCY.get() is None
    assert mt5_client._MT5_LEASE_HOLDER.get() is None
    assert mt5_terminal_holder(_KEY) is None
    assert handovers == []


async def test_bound_is_one_deadline_across_the_local_and_the_database_stage(
    fast_poll,
) -> None:
    """``wait_s`` is ONE deadline. The local lock frees after 0.6 s of a 1.0 s bound;
    the database stage gets the remaining 0.4 s, so the busy answer lands at about
    1.0 s. Two deadlines (a fresh ``wait_s`` for the database stage) would land at
    about 1.6 s."""
    fake = FakeXLeaseBackend()
    _install(fake)
    await _another_process_holds(fake)
    lock = mt5_concurrency._mt5_terminal_lock_for(_KEY)
    await lock.acquire()

    async def _free_the_local_lock_later() -> None:
        await asyncio.sleep(0.6)
        lock.release()

    releaser = asyncio.create_task(_free_the_local_lock_later())
    started = time.monotonic()
    with pytest.raises(mt5_concurrency.Mt5TerminalBusyError):
        async with mt5_concurrency.mt5_terminal_lease(_KEY, wait_s=1.0):
            pytest.fail("the body must never run")
    elapsed = time.monotonic() - started
    await releaser

    assert elapsed < 1.4, (
        f"the busy answer took {elapsed:.2f}s of a 1.0s bound - the database stage "
        "got a second deadline of its own"
    )
    assert fake.count("acquire") >= 1, "the database stage was never attempted"


async def test_a_spent_bound_makes_exactly_one_attempt_and_a_free_lease_is_granted() -> None:
    """``bound_s <= 0`` is one attempt, not zero: the bound must never turn a FREE
    lease into busy (a ``wait_for`` with no time left can time out before the RPC
    future has even started)."""
    fake = FakeXLeaseBackend()
    _install(fake)
    await _another_process_holds(fake)
    with pytest.raises(mt5_xlease.XLeaseBoundExpired):
        await mt5_xlease.acquire_terminal_xlease(
            _KEY, holder=None, site=None, bound_s=0.0, on_lost=lambda: None
        )
    assert fake.count("acquire") == 1, (
        f"a spent bound must make exactly one attempt, made {fake.count('acquire')}"
    )

    free = FakeXLeaseBackend()
    _install(free)
    hold = await mt5_xlease.acquire_terminal_xlease(
        _KEY, holder=None, site=None, bound_s=-1.0, on_lost=lambda: None
    )
    assert free.holds(_digest()), "a free lease was refused because the bound was spent"
    await hold.release()
    assert not free.holds(_digest())


async def test_lease_unavailable_releases_the_local_lock_and_stamps_nothing(
    monkeypatch, fast_poll
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = RuntimeError("boom")
    _install(fake)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_ERROR_BUDGET_S", 0.2)
    epoch_before = _mt5_epoch_for(_KEY)

    with pytest.raises(mt5_concurrency.Mt5TerminalLeaseUnavailableError):
        async with mt5_concurrency.mt5_terminal_lease(_KEY):
            pytest.fail("the body must never run")

    assert not mt5_concurrency._mt5_terminal_lock_for(_KEY).locked()
    assert _mt5_epoch_for(_KEY) == epoch_before
    assert mt5_client._MT5_LEASE_OCCUPANCY.get() is None


async def test_late_grant_after_bound_expiry_is_released(monkeypatch, fast_poll) -> None:
    """Pitfall 2: an acquire that commits AFTER its caller gave up must not wedge the
    terminal for a TTL. The caller raises busy; once the late call lands, release is
    called with THAT token and the row is free."""
    fake = FakeXLeaseBackend()

    async def _slow() -> None:
        await asyncio.sleep(0.4)

    fake.before["acquire"] = _slow
    _install(fake)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_MIN_ATTEMPT_S", 0.01)

    with pytest.raises(mt5_concurrency.Mt5TerminalBusyError):
        async with mt5_concurrency.mt5_terminal_lease(_KEY, wait_s=0.1):
            pytest.fail("the body must never run")

    await asyncio.sleep(0.8)  # the late call lands, then its cleanup release does
    acquire_token = next(c[2] for c in fake.calls if c[0] == "acquire")
    assert fake.calls[-1] == ("release", _digest(), acquire_token), (
        f"the late grant was never released (calls={[c[0] for c in fake.calls]})"
    )
    assert not fake.holds(_digest()), "the terminal stayed held after a late grant"


async def test_late_grant_after_a_normal_hold_is_released_again(monkeypatch) -> None:
    """An acquire that timed out client-side, then a retry that was granted and
    released: the first call landing AFTER the hold released re-takes the row, and
    the cleanup callback must release it again."""
    fake = FakeXLeaseBackend()
    first = {"seen": False}

    async def _first_is_slow() -> None:
        if not first["seen"]:
            first["seen"] = True
            await asyncio.sleep(0.4)

    fake.before["acquire"] = _first_is_slow
    _install(fake)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_RPC_TIMEOUT_S", 0.05)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_POLL_S", 0.01)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_POLL_JITTER_S", 0.005)

    async with mt5_concurrency.mt5_terminal_lease(_KEY):
        pass
    assert not fake.holds(_digest())

    await asyncio.sleep(0.8)
    tokens = {c[2] for c in fake.calls}
    assert len(tokens) == 1, "one acquisition must use one token on every poll"
    assert fake.count("acquire") == 2
    assert fake.calls[-1][0] == "release" and fake.count("release") == 2, (
        f"the late-landing acquire was never released (calls={[c[0] for c in fake.calls]})"
    )
    assert not fake.holds(_digest()), "a late grant wedged the terminal after a normal hold"


async def test_cancel_during_the_database_release_never_strands_the_local_lock() -> None:
    """Pitfall 3 / DEC-02-A: the release now runs inside the local hold, so a
    cancellation during the RPC must still free the in-process lock for everyone."""
    fake = FakeXLeaseBackend()
    gate = asyncio.Event()

    async def _blocked() -> None:
        await gate.wait()

    fake.before["release"] = _blocked
    _install(fake)
    entered = asyncio.Event()

    async def _holder() -> None:
        async with mt5_concurrency.mt5_terminal_lease(_KEY):
            entered.set()
            await asyncio.sleep(3600)

    task = asyncio.create_task(_holder())
    await asyncio.wait_for(entered.wait(), timeout=10.0)
    task.cancel()  # the body unwinds into the finally, blocked in the release RPC
    await asyncio.sleep(0.05)
    assert not task.done(), "the release RPC was supposed to be in flight"
    task.cancel()  # cancel the holder again, while the database release is pending
    with pytest.raises(asyncio.CancelledError):
        await task

    lock = mt5_concurrency._mt5_terminal_lock_for(_KEY)
    assert not lock.locked(), "a cancelled release stranded the in-process lock"
    gate.set()  # the shielded RPC lands
    await asyncio.sleep(0.05)
    async with mt5_concurrency.mt5_terminal_lease(_KEY, wait_s=5.0):
        assert lock.locked()


async def test_in_process_handover_makes_no_refused_acquire_and_logs_no_wait(
    caplog,
) -> None:
    """DEC-02-A: two holders on ONE registry hand over with zero acquire calls
    answered False, and zero ``mt5_xlease_waited`` records. Releasing the row before
    the local lock is what keeps the event a CROSS-PROCESS signal."""
    fake = FakeXLeaseBackend()
    _install(fake)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)

    async def hold() -> None:
        async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
            await asyncio.sleep(0.05)

    await asyncio.wait_for(asyncio.gather(hold(), hold()), timeout=10.0)

    assert fake.refusals == 0, "an in-process successor met its predecessor's row"
    assert [r for r in caplog.records if getattr(r, "event_type", "") == "mt5_xlease_waited"] == []


async def test_waited_event_is_one_info_record_with_counts_only(
    monkeypatch, caplog, fast_poll
) -> None:
    """XPROC-01's shape: holder b waits on the OTHER process, and that wait is logged
    ONCE with the site and a duration, never a key. Holder a emits nothing.

    ``mt5_xlease_waited`` is the positive signal plan 09 counts each night, so its
    name is a contract."""
    fake = FakeXLeaseBackend()
    _install(fake)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)
    registries: dict[str, dict[str, asyncio.Lock]] = {"a": {}, "b": {}}
    proc: ContextVar[str] = ContextVar("proc")
    monkeypatch.setattr(
        mt5_concurrency,
        "_mt5_terminal_lock_for",
        lambda key: registries[proc.get()].setdefault(key, asyncio.Lock()),
    )
    started_a = asyncio.Event()

    async def hold(name: str, site: str) -> None:
        proc.set(name)
        if name == "b":
            await started_a.wait()
        async with mt5_concurrency.mt5_terminal_lease(_KEY, site=site):
            started_a.set()
            await asyncio.sleep(0.1)

    await asyncio.wait_for(
        asyncio.gather(hold("a", SITE_DERIVE), hold("b", SITE_HOLDINGS)), timeout=10.0
    )

    waited = [r for r in caplog.records if getattr(r, "event_type", "") == "mt5_xlease_waited"]
    assert len(waited) == 1, f"expected exactly one wait record, got {len(waited)}"
    record = waited[0]
    assert record.levelno == logging.INFO
    assert record.site == SITE_HOLDINGS, "the wait is attributed to the waiter, not the holder"
    assert isinstance(record.duration_ms, int) and record.duration_ms >= 1
    assert _KEY not in record.getMessage()


def test_digest_is_64_hex_and_collapses_spellings_and_hides_the_key() -> None:
    digest = mt5_xlease.terminal_lease_digest("h:1")
    assert re.fullmatch(r"[0-9a-f]{64}", digest)
    assert mt5_xlease.terminal_lease_digest(" H:1 ") == digest
    assert mt5_xlease.terminal_lease_digest("h:2") != digest
    hidden = mt5_xlease.terminal_lease_digest("host.example:8001")
    assert "host" not in hidden and "8001" not in hidden


async def test_redaction_nothing_a_full_hold_writes_carries_the_terminal_key(
    monkeypatch, caplog, fast_poll
) -> None:
    """Scan the logs, every exception message and the fake's stored row for the raw
    key, its host part and its port, over a granted hold, a refused bounded caller
    and a backend failure whose OWN text carries the host."""
    key = "gateway-host.example:8001"
    leaks = ("gateway-host", "example", "8001", key)
    caplog.set_level(logging.DEBUG)
    fake = FakeXLeaseBackend()
    _install(fake)
    messages: list[str] = []

    async with mt5_concurrency.mt5_terminal_lease(key, site=SITE_DERIVE):
        pass

    foreign = await _another_process_holds(fake, key)
    try:
        async with mt5_concurrency.mt5_terminal_lease(key, wait_s=0.05):
            pass
    except mt5_concurrency.Mt5TerminalBusyError as exc:
        messages += [str(exc), repr(exc)]
    await fake.release(_digest(key), foreign)

    fake.raises["acquire"] = RuntimeError(f"connection to {key} refused")
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_ERROR_BUDGET_S", 0.2)
    try:
        async with mt5_concurrency.mt5_terminal_lease(key):
            pass
    except mt5_concurrency.Mt5TerminalLeaseUnavailableError as exc:
        messages += [str(exc), repr(exc)]
        assert exc.__cause__ is None

    stored = [
        f"{digest} {row.holder} {row.site}" for digest, row in fake.rows.items()
    ]
    haystack = "\n".join(messages + stored + [r.getMessage() for r in caplog.records])
    assert messages and stored
    for leak in leaks:
        assert leak not in haystack, f"{leak!r} reached a row, a log line or an exception"
    assert all(row.holder == HOLDER_UNATTRIBUTED or row.holder for row in fake.rows.values())


# --------------------------------------------------------------------------- #
# Task 3 — renewal while the body runs, the self-fence, timing validation, reset.
# --------------------------------------------------------------------------- #
@pytest.fixture
def quick_renew(monkeypatch):
    """Renew every 50 ms and call the lease lost after 250 ms of silence."""
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_RENEW_INTERVAL_S", 0.05)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_LOST_AFTER_S", 0.25)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_TTL_S", 2.0)


async def _grant(lost: list[int]) -> mt5_xlease.XLeaseHold:
    return await mt5_xlease.acquire_terminal_xlease(
        _KEY, holder=None, site=SITE_DERIVE, bound_s=None, on_lost=lambda: lost.append(1)
    )


async def test_renew_a_long_body_keeps_its_lease_by_renewing_with_its_own_token(
    quick_renew,
) -> None:
    fake = FakeXLeaseBackend()
    _install(fake)

    async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
        await asyncio.sleep(0.35)  # seven renew intervals
        assert fake.holds(_digest()), "the lease lapsed under a body that was still running"

    acquire_token = next(c[2] for c in fake.calls if c[0] == "acquire")
    renews = [c for c in fake.calls if c[0] == "renew"]
    assert len(renews) >= 2, f"expected at least two renews, got {len(renews)}"
    assert {c[2] for c in renews} == {acquire_token}, "a renew used a token it never acquired"


async def test_lost_when_renew_answers_false_fences_the_body_and_stops_renewing(
    quick_renew, caplog
) -> None:
    fake = FakeXLeaseBackend()
    _install(fake)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)
    epoch_before = _mt5_epoch_for(_KEY)

    async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
        # Another process takes the row (its expiry on the database clock passed):
        # this holder's next renew is answered False.
        fake.rows[_digest()].owner_token = uuid.uuid4()
        await asyncio.sleep(0.3)
        assert _mt5_epoch_for(_KEY) == epoch_before + 1, (
            "a lost lease did not bump the terminal epoch while the body still ran"
        )
        renews_when_lost = fake.count("renew")
        await asyncio.sleep(0.2)
        assert fake.count("renew") == renews_when_lost, "renewal continued after the loss"

    lost = [r for r in caplog.records if getattr(r, "event_type", "") == "mt5_xlease_lost"]
    assert len(lost) == 1 and lost[0].levelno == logging.ERROR
    assert _KEY not in lost[0].getMessage()
    assert lost[0].site == SITE_DERIVE


async def test_lost_on_silence_runs_the_same_path_once_lost_after_elapses(
    quick_renew, caplog
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["renew"] = RuntimeError(f"connection to {_KEY} refused")
    _install(fake)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)
    lost: list[int] = []

    hold = await _grant(lost)
    await asyncio.sleep(0.12)
    assert lost == [], "the lease was called lost before LOST_AFTER elapsed"
    await asyncio.sleep(0.4)

    assert lost == [1], "silence past LOST_AFTER must run on_lost exactly once"
    assert hold.lost
    records = [r for r in caplog.records if getattr(r, "event_type", "") == "mt5_xlease_lost"]
    assert len(records) == 1
    assert _KEY not in "".join(r.getMessage() for r in caplog.records)
    await hold.release()


async def test_renew_task_never_lets_an_exception_escape_and_dies_with_the_holder(
    quick_renew,
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["renew"] = RuntimeError("boom")
    _install(fake)
    hold = await _grant([])
    task = hold._renew_task
    assert task is not None
    await asyncio.sleep(0.4)
    assert task.done() and not task.cancelled() and task.exception() is None, (
        "an exception inside the renew loop escaped the task (it would reach "
        "main.lifespan's crash handler)"
    )

    healthy = FakeXLeaseBackend()
    _install(healthy)
    hold2 = await _grant([])
    task2 = hold2._renew_task
    assert task2 is not None
    await hold2.release()
    await asyncio.sleep(0)
    assert task2.cancelled() or task2.done(), "releasing the hold left its renew task alive"
    await hold.release()


async def test_stop_on_exit_no_renew_happens_after_a_normal_exit(quick_renew) -> None:
    fake = FakeXLeaseBackend()
    _install(fake)

    async with mt5_concurrency.mt5_terminal_lease(_KEY):
        await asyncio.sleep(0.2)

    renews_at_exit = fake.count("renew")
    await asyncio.sleep(0.3)
    assert fake.count("renew") == renews_at_exit, "a renew fired after the lease exited"
    assert not fake.holds(_digest())


async def test_cancelling_the_holder_cancels_its_renew_task(quick_renew) -> None:
    fake = FakeXLeaseBackend()
    _install(fake)
    entered = asyncio.Event()

    async def _holder() -> None:
        async with mt5_concurrency.mt5_terminal_lease(_KEY):
            entered.set()
            await asyncio.sleep(3600)

    task = asyncio.create_task(_holder())
    await asyncio.wait_for(entered.wait(), timeout=10.0)
    await asyncio.sleep(0.12)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    renews_at_cancel = fake.count("renew")
    await asyncio.sleep(0.3)
    assert fake.count("renew") == renews_at_cancel


@pytest.mark.parametrize(
    ("poll", "renew", "ttl", "rpc", "budget", "named"),
    [
        (0.5, 0.5, 90.0, 5.0, 60.0, "_MT5_XLEASE_POLL_S"),  # poll not below renew
        (0.0, 20.0, 90.0, 15.0, 60.0, "_MT5_XLEASE_POLL_S"),  # poll not above zero
        (0.5, 90.0, 90.0, 15.0, 60.0, "_MT5_XLEASE_RENEW_INTERVAL_S"),  # renew not below ttl
        (0.5, 20.0, 90.0, 20.0, 60.0, "_MT5_XLEASE_RPC_TIMEOUT_S"),  # rpc not below renew
        (0.5, 20.0, 50.0, 15.0, 60.0, "_MT5_XLEASE_TTL_S"),  # ttl below 2*renew + rpc
        # error budget not above one RPC's timeout: a single slow call would spend it
        (0.5, 20.0, 90.0, 15.0, 15.0, "_MT5_XLEASE_ERROR_BUDGET_S"),
    ],
)
def test_timing_each_broken_inequality_raises_and_the_shipped_values_pass(
    poll: float, renew: float, ttl: float, rpc: float, budget: float, named: str
) -> None:
    with pytest.raises(ValueError, match=named):
        mt5_xlease._validate_xlease_timing(poll, renew, ttl, rpc, budget)
    mt5_xlease._validate_xlease_timing(
        mt5_xlease._MT5_XLEASE_POLL_S,
        mt5_xlease._MT5_XLEASE_RENEW_INTERVAL_S,
        mt5_xlease._MT5_XLEASE_TTL_S,
        mt5_xlease._MT5_XLEASE_RPC_TIMEOUT_S,
        mt5_xlease._MT5_XLEASE_ERROR_BUDGET_S,
    )


async def test_reset_clears_the_clients_cleanup_task_set() -> None:
    task = asyncio.create_task(asyncio.sleep(3600))
    mt5_xlease._CLEANUP_TASKS.add(task)
    mt5_concurrency.reset_terminal_state_for_tests()
    assert mt5_xlease._CLEANUP_TASKS == set()
    await asyncio.sleep(0)
    assert task.cancelled()


# --------------------------------------------------------------------------- #
# Plan 04 Task 1 — a MISSING lease RPC degrades loudly to the in-process lock.
#
# A deploy-order gap (the worker runs before the migration applies, or after a
# rollback) must not turn into a night of refused MT5 work, but it is also the ONE path
# where two processes may share the terminal, so it is loud (an ERROR event, re-logged
# on a clock) and never latched (the next acquisition asks the database again).
# --------------------------------------------------------------------------- #
_MISSING_TEXT = "Could not find the function gateway-host.example:8001/rpc/acquire"


def _missing_rpc_error() -> APIError:
    """What PostgREST raises while the function is absent from its schema cache."""
    return APIError({"message": _MISSING_TEXT, "code": "PGRST202", "details": None})


def _events(caplog, event_type: str) -> list[logging.LogRecord]:
    return [r for r in caplog.records if getattr(r, "event_type", "") == event_type]


class _ScriptedBackend:
    """A backend whose acquire answers from a script, one step per call (the last step
    repeats). A step is an async callable returning the answer or raising. Renew and
    release answer True and are recorded, so a test can assert which RPCs were called."""

    def __init__(self, acquire_script) -> None:
        self._script = list(acquire_script)
        self.calls: list[str] = []
        self.tokens: list[uuid.UUID] = []

    async def acquire(self, digest, token, holder, site, ttl_s) -> bool:
        self.calls.append("acquire")
        self.tokens.append(token)
        step = self._script.pop(0) if len(self._script) > 1 else self._script[0]
        return await step()

    async def renew(self, digest, token, ttl_s) -> bool:
        self.calls.append("renew")
        return True

    async def release(self, digest, token) -> bool:
        self.calls.append("release")
        return True


def _raises(exc: BaseException):
    async def _step() -> bool:
        raise exc

    return _step


def _answers(value: bool, delay_s: float = 0.0):
    async def _step() -> bool:
        if delay_s:
            await asyncio.sleep(delay_s)
        return value

    return _step


async def test_missing_rpc_falls_back_to_the_local_lock_and_relogs_every_900s(
    monkeypatch, caplog
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = _missing_rpc_error()
    _install(fake)
    clock = [5000.0]
    monkeypatch.setattr(mt5_xlease, "_relog_clock", lambda: clock[0])
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)
    ran: list[int] = []

    async def _one_acquisition() -> None:
        async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
            ran.append(1)
            assert mt5_concurrency._mt5_terminal_lock_for(_KEY).locked(), (
                "the fallback must still hold the in-process lock"
            )

    await _one_acquisition()
    assert ran == [1], "a missing RPC refused the body instead of falling back"
    first = _events(caplog, "mt5_xlease_unavailable")
    assert len(first) == 1, f"expected exactly one unavailable record, got {len(first)}"
    record = first[0]
    assert record.levelno == logging.ERROR
    assert record.rpc == mt5_xlease.XLEASE_ACQUIRE_RPC
    assert record.site == SITE_DERIVE
    assert "in-process" in record.getMessage(), "the line must say the terminal is serialized in-process only"
    assert record.exc_info is None
    assert _MISSING_TEXT not in record.getMessage() and _KEY not in record.getMessage()

    clock[0] += 10.0
    await _one_acquisition()
    assert len(_events(caplog, "mt5_xlease_unavailable")) == 1, (
        "a second acquisition 10 s later must not re-log"
    )

    clock[0] += 891.0  # 901 s after the first line
    await _one_acquisition()
    assert len(_events(caplog, "mt5_xlease_unavailable")) == 2, (
        "901 s after the first line the fault must be told again (never one line per process)"
    )
    assert ran == [1, 1, 1]


async def test_missing_rpc_is_never_latched_the_next_acquisition_leases_again() -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = _missing_rpc_error()
    _install(fake)

    async with mt5_concurrency.mt5_terminal_lease(_KEY):
        assert not fake.holds(_digest()), "nothing is leased while the RPC is missing"

    del fake.raises["acquire"]  # the migration applied
    fake.calls.clear()
    async with mt5_concurrency.mt5_terminal_lease(_KEY):
        assert fake.count("acquire") >= 1, "the fallback was latched: the RPC was never tried again"
        assert fake.holds(_digest()), "the lease did not become cross-process once the RPC answered"
    assert not fake.holds(_digest())


async def test_the_fallback_hold_makes_no_renew_and_no_release_call(quick_renew) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = _missing_rpc_error()
    _install(fake)
    lost: list[int] = []

    hold = await _grant(lost)
    assert hold.cross_process is False
    assert hold._renew_task is None, "the fallback hold started a renew task"
    await asyncio.sleep(0.3)  # six renew intervals, past LOST_AFTER: nothing may fire
    await hold.release()

    assert [c[0] for c in fake.calls] == ["acquire"], (
        f"the fallback hold called the backend again: {[c[0] for c in fake.calls]}"
    )
    assert lost == [] and not hold.lost


async def test_a_late_grant_from_an_earlier_poll_is_released_when_the_fallback_is_taken(
    monkeypatch, fast_poll
) -> None:
    """Poll 1 outlives its RPC bound and is granted AFTER poll 2 learns the RPC is
    missing (the migration rolled back mid-acquisition). Without releasing the pending
    future that late grant would hold the row for a whole TTL."""
    backend = _ScriptedBackend([_answers(True, delay_s=0.3), _raises(_missing_rpc_error())])
    mt5_xlease.set_xlease_backend_for_tests(backend)
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_RPC_TIMEOUT_S", 0.05)

    hold = await _grant([])
    assert hold.cross_process is False
    await asyncio.sleep(0.6)

    assert backend.calls.count("acquire") == 2
    assert backend.calls.count("release") == 1, (
        f"the late grant of the abandoned poll was never released (calls={backend.calls})"
    )
    await hold.release()
    assert backend.calls.count("release") == 1


# --------------------------------------------------------------------------- #
# Plan 04 Task 2 — every OTHER database error fails closed.
#
# T-230-12: a database fault must never let a caller onto the terminal unserialized. An
# unbounded (batch) caller tolerates consecutive errors for ERROR_BUDGET_S so a PostgREST
# blip does not burn a derive attempt (the quantity the seven nights count), then gets a
# classifiable error. A bounded caller keeps polling to ITS OWN deadline and gets busy.
# --------------------------------------------------------------------------- #
_SECRET = "SECRET-MARKER-gateway-host.example:8001"


def _small_budget(monkeypatch, seconds: float) -> None:
    monkeypatch.setattr(mt5_xlease, "_MT5_XLEASE_ERROR_BUDGET_S", seconds)


async def test_budget_unbounded_caller_fails_closed_only_after_the_budget(
    monkeypatch, fast_poll
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = RuntimeError(f"connection to {_SECRET} refused")
    _install(fake)
    _small_budget(monkeypatch, 0.3)
    epoch_before = _mt5_epoch_for(_KEY)
    started = time.monotonic()

    async def _attempt() -> None:
        async with mt5_concurrency.mt5_terminal_lease(_KEY):
            pytest.fail("the body must never run while the lease database errors")

    with pytest.raises(mt5_concurrency.Mt5TerminalLeaseUnavailableError):
        await asyncio.wait_for(_attempt(), timeout=10.0)
    elapsed = time.monotonic() - started

    assert elapsed >= 0.3, (
        f"the caller gave up after {elapsed:.2f}s, before its 0.3s error budget - one "
        "blip would burn a derive attempt"
    )
    assert elapsed < 5.0
    assert fake.count("acquire") > 1, "the caller did not keep polling through the errors"
    assert not mt5_concurrency._mt5_terminal_lock_for(_KEY).locked()
    assert _mt5_epoch_for(_KEY) == epoch_before
    assert mt5_client._MT5_LEASE_OCCUPANCY.get() is None
    assert mt5_client._MT5_LEASE_HOLDER.get() is None
    assert mt5_terminal_holder(_KEY) is None
    assert fake.rows == {}, "a failed acquisition left a lease row behind"


async def test_budget_a_database_answer_resets_the_error_window(
    monkeypatch, fast_poll
) -> None:
    """Errors for most of the budget, one refusal (the database ANSWERED), then errors
    again: the window restarts, so the caller does not give up at the original mark."""
    t0 = time.monotonic()
    state = {"refused": False}

    async def _step() -> bool:
        if time.monotonic() - t0 < 0.25 or state["refused"]:
            raise RuntimeError("blip")
        state["refused"] = True
        return False

    mt5_xlease.set_xlease_backend_for_tests(_ScriptedBackend([_step]))
    _small_budget(monkeypatch, 0.4)

    with pytest.raises(mt5_xlease.XLeaseUnavailable):
        await asyncio.wait_for(
            mt5_xlease.acquire_terminal_xlease(
                _KEY, holder=None, site=None, bound_s=None, on_lost=lambda: None
            ),
            timeout=10.0,
        )
    elapsed = time.monotonic() - t0

    assert state["refused"], "the scripted refusal never happened"
    assert elapsed >= 0.6, (
        f"gave up at {elapsed:.2f}s: an answered call did not reset the 0.4s error budget "
        "(without a reset it would give up at about 0.4s)"
    )


async def test_budget_one_rpc_error_per_acquisition_is_a_warning_with_the_class_only(
    monkeypatch, caplog, fast_poll
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = RuntimeError(f"connection to {_SECRET} refused")
    _install(fake)
    _small_budget(monkeypatch, 0.2)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)

    with pytest.raises(mt5_concurrency.Mt5TerminalLeaseUnavailableError):
        async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
            pass

    errors = _events(caplog, "mt5_xlease_rpc_error")
    assert fake.count("acquire") > 2, "the test must have polled several times"
    assert len(errors) == 1, f"expected one warning per acquisition, got {len(errors)}"
    record = errors[0]
    assert record.levelno == logging.WARNING
    assert record.rpc == mt5_xlease.XLEASE_ACQUIRE_RPC
    assert record.site == SITE_DERIVE
    assert "RuntimeError" in record.getMessage()
    assert _events(caplog, "mt5_xlease_unavailable") == [], "a non-missing error is not a missing RPC"


async def test_bounded_caller_keeps_polling_through_errors_and_gets_busy_at_its_bound(
    monkeypatch, fast_poll
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = RuntimeError("blip")
    _install(fake)
    _small_budget(monkeypatch, 0.1)  # a bounded caller must ignore the budget
    started = time.monotonic()

    with pytest.raises(mt5_concurrency.Mt5TerminalBusyError) as raised:
        async with mt5_concurrency.mt5_terminal_lease(_KEY, wait_s=0.3):
            pytest.fail("the body must never run while the lease database errors")
    elapsed = time.monotonic() - started

    assert type(raised.value) is mt5_concurrency.Mt5TerminalBusyError, (
        "a bounded caller got the batch-job classification instead of the busy answer"
    )
    assert elapsed >= 0.3, f"the busy answer came at {elapsed:.2f}s, before the 0.3s bound"
    assert fake.count("acquire") > 1
    assert not mt5_concurrency._mt5_terminal_lock_for(_KEY).locked()


async def test_renew_missing_rpc_stops_renewing_without_declaring_the_lease_lost(
    quick_renew, caplog
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["renew"] = _missing_rpc_error()
    _install(fake)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)
    epoch_before = _mt5_epoch_for(_KEY)

    async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
        await asyncio.sleep(0.5)  # ten renew intervals, past LOST_AFTER
        assert _mt5_epoch_for(_KEY) == epoch_before, (
            "a missing renew RPC fenced a holder that still owns the terminal"
        )
        assert fake.count("renew") == 1, (
            f"renewal continued against a missing RPC ({fake.count('renew')} calls)"
        )

    assert _events(caplog, "mt5_xlease_lost") == []
    missing = [
        r for r in _events(caplog, "mt5_xlease_unavailable")
        if r.rpc == mt5_xlease.XLEASE_RENEW_RPC
    ]
    assert len(missing) == 1 and missing[0].levelno == logging.ERROR


async def test_release_error_never_masks_the_bodys_exception(caplog) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["release"] = RuntimeError(f"connection to {_SECRET} refused")
    _install(fake)
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)

    with pytest.raises(ValueError, match="the body failed"):
        async with mt5_concurrency.mt5_terminal_lease(_KEY):
            raise ValueError("the body failed")

    failed = _events(caplog, "mt5_xlease_release_failed")
    assert len(failed) == 1 and failed[0].levelno == logging.WARNING
    assert "RuntimeError" in failed[0].getMessage()
    assert not mt5_concurrency._mt5_terminal_lock_for(_KEY).locked()


async def test_release_missing_rpc_is_logged_on_the_relog_clock_and_never_raises(
    monkeypatch, caplog
) -> None:
    fake = FakeXLeaseBackend()
    fake.raises["release"] = _missing_rpc_error()
    _install(fake)
    clock = [9000.0]
    monkeypatch.setattr(mt5_xlease, "_relog_clock", lambda: clock[0])
    caplog.set_level(logging.INFO, logger=_XLEASE_LOGGER)

    async with mt5_concurrency.mt5_terminal_lease(_KEY):
        pass
    clock[0] += 10.0
    async with mt5_concurrency.mt5_terminal_lease(_KEY):
        pass

    missing = _events(caplog, "mt5_xlease_unavailable")
    assert len(missing) == 1, "release shares the relog clock: a second release 10 s later must not re-log"
    assert missing[0].rpc == mt5_xlease.XLEASE_RELEASE_RPC
    assert _events(caplog, "mt5_xlease_release_failed") == [], (
        "a missing release RPC is the unavailable event, not a release failure"
    )


async def test_redaction_no_record_from_the_failure_paths_carries_the_exception_text(
    monkeypatch, caplog, fast_poll, quick_renew
) -> None:
    """Every failure path with an exception whose OWN text carries a host and port: the
    text must not reach a message, an extra field, exc_info or exc_text."""
    caplog.set_level(logging.DEBUG)
    _small_budget(monkeypatch, 0.2)
    error = RuntimeError(f"connection to {_SECRET} refused")
    missing = APIError({"message": f"no function at {_SECRET}", "code": "PGRST202"})

    for method, exc in (("acquire", error), ("acquire", missing), ("release", error),
                        ("release", missing), ("renew", missing)):
        fake = FakeXLeaseBackend()
        fake.raises[method] = exc
        _install(fake)
        mt5_concurrency.reset_terminal_state_for_tests()
        try:
            async with mt5_concurrency.mt5_terminal_lease(_KEY, site=SITE_DERIVE):
                await asyncio.sleep(0.12)
        except mt5_concurrency.Mt5TerminalLeaseUnavailableError:
            pass

    assert caplog.records
    for record in caplog.records:
        rendered = " ".join(
            [record.getMessage(), str(record.__dict__.get("exc_text")), repr(record.args)]
            + [str(v) for k, v in record.__dict__.items() if k not in {"args", "msg"}]
        )
        assert "SECRET-MARKER" not in rendered and "gateway-host" not in rendered, (
            f"exception text reached a log record: {record.getMessage()!r}"
        )
        assert record.exc_info is None, "a log record carried a traceback"
