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
from contextvars import ContextVar

import pytest

from services import mt5_concurrency, mt5_xlease
from tests.xlease_fakes import FakeXLeaseBackend


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
