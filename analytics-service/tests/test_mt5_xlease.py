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

from services import mt5_client, mt5_concurrency, mt5_xlease
from services.mt5_client import HOLDER_UNATTRIBUTED, _mt5_epoch_for, mt5_terminal_holder
from services.mt5_handover import SITE_DERIVE, SITE_HOLDINGS
from tests.xlease_fakes import FakeXLeaseBackend, GrantingXLeaseBackend

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


async def test_lease_unavailable_releases_the_local_lock_and_stamps_nothing() -> None:
    fake = FakeXLeaseBackend()
    fake.raises["acquire"] = RuntimeError("boom")
    _install(fake)
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
    caplog, fast_poll
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
